// Walk screen: live buddy diorama, monball meter, odometer, egg tray.
import * as db from "./db.js";
import { getBuddy, hatchEgg } from "./game.js";
import { ITEM_METERS, tracker } from "./sensors.js";
import { createWalkScene } from "./sprites.js";
import { busyOverlay, clear, el, fmtKm, jpegUrl, overlay, toast } from "./ui.js";
let scene = null;
let lastMoveAt = 0;
// renderWalk runs on every tab switch; tracker listeners and the idle timer
// are registered once and act on whichever DOM the latest render installed.
let wiredTracker = false;
let refreshCurrent = null;
export async function renderWalk(root, showMonster) {
    clear(root);
    scene?.dispose();
    const canvas = el("canvas", { class: "walk-canvas" });
    const buddyLabel = el("div", { class: "walk-buddy-label" }, "No buddy yet — catch a monster!");
    const heldLabel = el("span", { class: "hud-big" }, "–");
    const meterFill = el("div", { class: "meter-fill" });
    const meterText = el("div", { class: "meter-text" }, "");
    const odo = el("span", {}, "0 m");
    const steps = el("span", {}, "0");
    const gps = el("span", {}, "–");
    const startBtn = el("button", { class: "btn primary wide" }, "▶ Start walking");
    const eggTray = el("div", { class: "egg-tray" });
    const hud = el("div", { class: "walk-hud" }, el("div", { class: "hud-item" }, el("span", { class: "hud-label" }, "held "), heldLabel), el("div", { class: "hud-item" }, el("span", { class: "hud-label" }, "walked "), odo), el("div", { class: "hud-item" }, el("span", { class: "hud-label" }, "steps "), steps), el("div", { class: "hud-item" }, el("span", { class: "hud-label" }, "GPS "), gps));
    root.append(el("div", { class: "walk-scene" }, canvas, buddyLabel), hud, el("div", { class: "meter" }, meterFill, meterText), startBtn, eggTray);
    const params = new URLSearchParams(location.search);
    if (params.get("dev") === "1" || ["localhost", "127.0.0.1"].includes(location.hostname)) {
        root.append(el("button", { class: "btn ghost wide", onclick: () => tracker.credit(100) }, "⚙ dev: +100 m"));
    }
    scene = createWalkScene(canvas);
    const buddy = await getBuddy();
    if (buddy) {
        scene.setBuddy(buddy.jpeg);
        buddyLabel.textContent = `${buddy.meta.name} · Lv ${buddy.meta.level} · together ${fmtKm(buddy.meta.buddyMeters ?? 0)}`;
        buddyLabel.onclick = () => showMonster(buddy.uuid);
    }
    function refresh() {
        const s = tracker.snapshot();
        const inv = s.inv;
        heldLabel.textContent = inv.held === "ball" ? "⚪ GoBall" : inv.held === "tm" ? "💿 TM" : "–";
        odo.textContent = fmtKm(s.odometerM);
        steps.textContent = String(s.stepCount);
        gps.textContent = s.tracking ? (s.gpsOk ? "●" : "○") : "–";
        gps.className = s.gpsOk ? "gps-ok" : "gps-bad";
        if (inv.held === null) {
            meterFill.classList.remove("banked");
            meterFill.style.width = `${(inv.progressM / ITEM_METERS) * 100}%`;
            meterText.textContent = `${Math.round(inv.progressM)} / ${ITEM_METERS} m to your next item`;
        }
        else {
            meterFill.classList.add("banked");
            meterFill.style.width = `${(inv.bankedM / ITEM_METERS) * 100}%`;
            const capped = inv.bankedM >= inv.overflowCapM;
            const itemName = inv.held === "ball" ? "GoBall" : "TM";
            meterText.textContent = capped
                ? `bank FULL — walking is wasted, use your ${itemName}!`
                : `+${Math.round(inv.bankedM)} m banked — tap ＋ to use your ${itemName}`;
        }
        startBtn.textContent = s.tracking ? "⏸ Pause walking" : "▶ Start walking";
        if (s.lastError && s.tracking)
            buddyLabel.dataset["err"] = s.lastError;
    }
    refreshCurrent = refresh;
    if (!wiredTracker) {
        wiredTracker = true;
        tracker.onChange(() => refreshCurrent?.());
        tracker.onDistance(() => {
            lastMoveAt = Date.now();
            scene?.setWalking(true);
        });
        setInterval(() => {
            if (Date.now() - lastMoveAt > 3000)
                scene?.setWalking(false);
        }, 1000);
    }
    startBtn.onclick = () => {
        const s = tracker.snapshot();
        if (s.tracking) {
            tracker.stop();
        }
        else {
            void tracker.start().then(() => {
                const after = tracker.snapshot();
                if (after.lastError)
                    toast(after.lastError);
            });
        }
    };
    async function refreshEggs() {
        const eggs = await db.allEggs();
        clear(eggTray);
        if (!eggs.length)
            return;
        eggTray.append(el("h3", {}, "Eggs"));
        for (const egg of eggs) {
            const pct = Math.min(100, (egg.metersWalked / egg.metersRequired) * 100);
            const ready = egg.metersWalked >= egg.metersRequired;
            const fill = el("div", { class: "meter-fill egg" });
            fill.style.width = `${pct}%`;
            const btn = ready
                ? el("button", { class: "btn primary", onclick: () => void doHatch(egg) }, "Hatch!")
                : el("span", { class: "egg-dist" }, `${fmtKm(Math.max(0, egg.metersRequired - egg.metersWalked))} to go`);
            eggTray.append(el("div", { class: "egg-row" }, el("span", { class: "egg-icon" }, "🥚"), el("div", { class: "egg-mid" }, el("div", { class: "egg-parents" }, `${egg.parentA.meta.name} × ${egg.parentB.meta.name}`), el("div", { class: "meter small" }, fill)), btn));
        }
    }
    async function doHatch(egg) {
        const busy = busyOverlay("Hatching…");
        try {
            const rec = await hatchEgg(egg, busy.setStatus);
            busy.close();
            const url = jpegUrl(rec.jpeg);
            const ov = overlay(el("div", { class: "reveal" }, el("h2", {}, `${rec.meta.name} hatched!`), el("img", { class: "reveal-img", src: url, alt: rec.meta.name }), el("p", {}, rec.meta.description), el("button", { class: "btn primary wide", onclick: () => { ov.close(); void refreshEggs(); } }, "Welcome!")));
        }
        catch (err) {
            busy.close();
            toast(err instanceof Error ? err.message : String(err));
            void refreshEggs();
        }
    }
    refresh();
    void refreshEggs();
}
