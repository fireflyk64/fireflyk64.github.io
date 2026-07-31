// Distance tracking: fuses GPS (geolocation watch) with an accelerometer
// pedometer (devicemotion peak detection). Walking distance fills a monball
// meter — every BALL_METERS of credited walking earns one monball.
//
// Fusion rule: while GPS is "healthy" (a recent accurate fix), distance comes
// from accepted GPS segments; when GPS is stale/denied/indoors, pedometer
// steps × stride length are credited instead — never both, so no double count.
import { kvGet, kvSet } from "./db.js";
import { creditInv, initialInv, ITEM_METERS, refundHeld, rollItemKind, rollOverflowCap, useHeld, } from "./inventory.js";
export { ITEM_METERS };
const MAX_ACCURACY_M = 40; // reject fixes worse than this
const MAX_SPEED_MPS = 3.5; // ~12.6 km/h: walking/jogging only, no driving credit
const GPS_HEALTHY_MS = 20000; // GPS considered live if an accepted fix within this window
const STRIDE_M = 0.74;
const STEP_MIN_INTERVAL_MS = 280;
const SAVE_INTERVAL_MS = 5000;
function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
export class Tracker {
    state = { odometerM: 0, inv: initialInv(), stepCount: 0 };
    /** Whether TMs are worth awarding (the player owns at least one monster). */
    tmEligible = false;
    tracking = false;
    watchId = null;
    lastFix = null;
    lastAcceptedAt = 0;
    speedMps = 0;
    motionOk = false;
    lastError;
    lastPosition = null;
    // pedometer internals
    emaGravity = 9.81;
    emaMag = 0;
    lastStepAt = 0;
    motionHandler = (ev) => this.onMotion(ev);
    distanceListeners = [];
    itemListeners = [];
    changeListeners = [];
    saveTimer = null;
    async load() {
        const saved = await kvGet("tracker");
        if (saved) {
            this.state = {
                odometerM: saved.odometerM ?? 0,
                stepCount: saved.stepCount ?? 0,
                inv: saved.inv ?? initialInv(),
            };
            // migrate the pre-inventory shape ({balls, ballProgressM})
            if (!saved.inv && typeof saved.balls === "number") {
                if (saved.balls > 0)
                    this.state.inv.held = "ball";
                this.state.inv[saved.balls > 0 ? "bankedM" : "progressM"] =
                    Math.min(saved.ballProgressM ?? 0, this.state.inv.overflowCapM);
            }
        }
        this.notify();
    }
    setTmEligible(eligible) {
        this.tmEligible = eligible;
    }
    snapshot() {
        return {
            ...this.state,
            tracking: this.tracking,
            gpsOk: Date.now() - this.lastAcceptedAt < GPS_HEALTHY_MS,
            motionOk: this.motionOk,
            lastError: this.lastError,
            speedMps: this.speedMps,
        };
    }
    /** Latest raw GPS position (for coarse capture location tagging). */
    coarsePlace() {
        const p = this.lastPosition;
        if (!p)
            return undefined;
        // Round to ~1km so embedded/shared metadata never carries a precise home location.
        return {
            lat: Math.round(p.coords.latitude * 100) / 100,
            lon: Math.round(p.coords.longitude * 100) / 100,
        };
    }
    onDistance(cb) { this.distanceListeners.push(cb); }
    onItem(cb) { this.itemListeners.push(cb); }
    onChange(cb) { this.changeListeners.push(cb); }
    /** Must be called from a user gesture on iOS (motion permission prompt). */
    async start() {
        if (this.tracking)
            return;
        this.tracking = true;
        this.lastError = undefined;
        if ("geolocation" in navigator) {
            this.watchId = navigator.geolocation.watchPosition((pos) => this.onFix(pos), (err) => { this.lastError = `GPS: ${err.message}`; this.notify(); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
        }
        else {
            this.lastError = "Geolocation unavailable";
        }
        const dme = DeviceMotionEvent;
        try {
            if (typeof dme.requestPermission === "function") {
                const res = await dme.requestPermission();
                if (res !== "granted")
                    this.lastError = "Motion permission denied";
            }
            window.addEventListener("devicemotion", this.motionHandler);
            this.motionOk = true;
        }
        catch {
            this.lastError = "Motion sensor unavailable";
        }
        this.saveTimer = setInterval(() => void this.save(), SAVE_INTERVAL_MS);
        this.notify();
    }
    stop() {
        if (!this.tracking)
            return;
        this.tracking = false;
        if (this.watchId !== null)
            navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
        window.removeEventListener("devicemotion", this.motionHandler);
        this.motionOk = false;
        if (this.saveTimer)
            clearInterval(this.saveTimer);
        this.saveTimer = null;
        void this.save();
        this.notify();
    }
    /** Consume the held item if it matches; banked meters roll into the next. */
    async useItem(kind) {
        if (this.state.inv.held !== kind)
            return false;
        this.state.inv = useHeld(this.state.inv);
        await this.save();
        this.notify();
        return true;
    }
    /** Return a consumed item (e.g. generation failed). */
    async refundItem(kind) {
        this.state.inv = refundHeld(this.state.inv, kind);
        await this.save();
        this.notify();
    }
    /** Dev/demo helper: credit distance manually. */
    credit(meters) {
        this.creditDistance(meters);
    }
    onFix(pos) {
        this.lastPosition = pos;
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const t = pos.timestamp || Date.now();
        if (accuracy > MAX_ACCURACY_M)
            return;
        const prev = this.lastFix;
        this.lastFix = { lat, lon, t };
        this.lastAcceptedAt = Date.now();
        if (!prev) {
            this.notify();
            return;
        }
        const dt = (t - prev.t) / 1000;
        if (dt <= 0 || dt > 120)
            return;
        const d = haversineM(prev.lat, prev.lon, lat, lon);
        const v = d / dt;
        this.speedMps = v;
        // Ignore jitter (< accuracy floor) and anything faster than a jog.
        if (d < 2 || v > MAX_SPEED_MPS)
            return;
        this.creditDistance(d);
    }
    onMotion(ev) {
        const a = ev.accelerationIncludingGravity;
        if (!a || a.x === null || a.y === null || a.z === null)
            return;
        const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        // Slow EMA tracks gravity baseline; fast EMA smooths noise.
        this.emaGravity = this.emaGravity * 0.99 + mag * 0.01;
        this.emaMag = this.emaMag * 0.7 + (mag - this.emaGravity) * 0.3;
        const now = Date.now();
        // A step: smoothed magnitude crosses ~1.2 m/s² above baseline, debounced.
        if (this.emaMag > 1.2 && now - this.lastStepAt > STEP_MIN_INTERVAL_MS) {
            this.lastStepAt = now;
            this.state.stepCount++;
            // Only credit steps while GPS is not delivering good fixes.
            if (Date.now() - this.lastAcceptedAt >= GPS_HEALTHY_MS) {
                this.creditDistance(STRIDE_M);
            }
            else {
                this.notify();
            }
        }
    }
    creditDistance(d) {
        this.state.odometerM += d;
        const res = creditInv(this.state.inv, d, () => rollItemKind(Math.random, this.tmEligible), () => rollOverflowCap());
        this.state.inv = res.state;
        for (const cb of this.distanceListeners)
            cb(d);
        if (res.awarded) {
            for (const cb of this.itemListeners)
                cb(res.awarded);
            void this.save();
        }
        this.notify();
    }
    async save() {
        await kvSet("tracker", this.state);
    }
    notify() {
        const snap = this.snapshot();
        for (const cb of this.changeListeners)
            cb(snap);
    }
}
export const tracker = new Tracker();
