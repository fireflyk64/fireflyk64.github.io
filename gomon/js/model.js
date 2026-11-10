// GoMon core data model: monster metadata schema (embedded into JPEGs),
// elemental type chart, stat math, and deterministic move derivation.
// This module is pure (no DOM, no node APIs) so it runs in browser and tests.
export const SCHEMA = "gomon/1";
export const TYPE_NAMES = [
    "normal", "fire", "water", "grass", "electric", "ice",
    "rock", "wind", "poison", "spirit", "metal", "bug",
];
export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
// ---------------------------------------------------------------------------
// Type chart
// ---------------------------------------------------------------------------
/** typeChart[attacker][defender] = damage multiplier (missing = 1). */
const CHART = {
    normal: { rock: 0.5, metal: 0.5, spirit: 0.5 },
    fire: { grass: 2, ice: 2, bug: 2, metal: 2, fire: 0.5, water: 0.5, rock: 0.5 },
    water: { fire: 2, rock: 2, water: 0.5, grass: 0.5 },
    grass: { water: 2, rock: 2, fire: 0.5, grass: 0.5, poison: 0.5, wind: 0.5, bug: 0.5 },
    electric: { water: 2, wind: 2, electric: 0.5, grass: 0.5, rock: 0 },
    ice: { grass: 2, wind: 2, rock: 2, fire: 0.5, ice: 0.5, metal: 0.5 },
    rock: { fire: 2, ice: 2, wind: 2, bug: 2, metal: 0.5, rock: 0.5 },
    wind: { grass: 2, bug: 2, poison: 2, electric: 0.5, rock: 0.5, metal: 0.5 },
    poison: { grass: 2, spirit: 2, poison: 0.5, rock: 0.5, metal: 0 },
    spirit: { spirit: 2, poison: 2, normal: 0, metal: 0.5 },
    metal: { ice: 2, rock: 2, fire: 0.5, water: 0.5, electric: 0.5, metal: 0.5 },
    bug: { grass: 2, spirit: 2, poison: 2, fire: 0.5, wind: 0.5, metal: 0.5 },
};
export function typeEffect(attack, defenderTypes) {
    let mult = 1;
    for (const d of defenderTypes)
        mult *= CHART[attack]?.[d] ?? 1;
    return mult;
}
export function isTypeName(s) {
    return TYPE_NAMES.includes(s);
}
/** Coerce arbitrary model-output strings into 1-2 valid types. */
export function sanitizeTypes(raw) {
    const out = [];
    if (Array.isArray(raw)) {
        for (const t of raw) {
            if (typeof t === "string" && isTypeName(t.toLowerCase()) && out.length < 2) {
                const name = t.toLowerCase();
                if (!out.includes(name))
                    out.push(name);
            }
        }
    }
    return out.length ? out : ["normal"];
}
const MOVE_TABLE = {
    normal: [
        { id: "tackle", name: "Tackle", type: "normal", power: 50, kind: "physical", acc: 1 },
        { id: "hyper-hum", name: "Hyper Hum", type: "normal", power: 70, kind: "special", acc: 0.95 },
    ],
    fire: [
        { id: "ember-claw", name: "Ember Claw", type: "fire", power: 65, kind: "physical", acc: 0.95 },
        { id: "flare-burst", name: "Flare Burst", type: "fire", power: 80, kind: "special", acc: 0.9 },
    ],
    water: [
        { id: "fin-slap", name: "Fin Slap", type: "water", power: 65, kind: "physical", acc: 0.95 },
        { id: "geyser-jet", name: "Geyser Jet", type: "water", power: 80, kind: "special", acc: 0.9 },
    ],
    grass: [
        { id: "vine-whip", name: "Vine Whip", type: "grass", power: 65, kind: "physical", acc: 0.95 },
        { id: "petal-storm", name: "Petal Storm", type: "grass", power: 80, kind: "special", acc: 0.9 },
    ],
    electric: [
        { id: "spark-tackle", name: "Spark Tackle", type: "electric", power: 65, kind: "physical", acc: 0.95 },
        { id: "volt-arc", name: "Volt Arc", type: "electric", power: 80, kind: "special", acc: 0.9 },
    ],
    ice: [
        { id: "frost-fang", name: "Frost Fang", type: "ice", power: 65, kind: "physical", acc: 0.95 },
        { id: "glacier-beam", name: "Glacier Beam", type: "ice", power: 80, kind: "special", acc: 0.9 },
    ],
    rock: [
        { id: "boulder-bash", name: "Boulder Bash", type: "rock", power: 75, kind: "physical", acc: 0.9 },
        { id: "sand-blast", name: "Sand Blast", type: "rock", power: 60, kind: "special", acc: 0.95 },
    ],
    wind: [
        { id: "gale-slash", name: "Gale Slash", type: "wind", power: 65, kind: "physical", acc: 0.95 },
        { id: "cyclone", name: "Cyclone", type: "wind", power: 80, kind: "special", acc: 0.9 },
    ],
    poison: [
        { id: "toxin-jab", name: "Toxin Jab", type: "poison", power: 65, kind: "physical", acc: 0.95 },
        { id: "venom-cloud", name: "Venom Cloud", type: "poison", power: 80, kind: "special", acc: 0.9 },
    ],
    spirit: [
        { id: "shade-claw", name: "Shade Claw", type: "spirit", power: 65, kind: "physical", acc: 0.95 },
        { id: "wisp-wail", name: "Wisp Wail", type: "spirit", power: 80, kind: "special", acc: 0.9 },
    ],
    metal: [
        { id: "iron-ram", name: "Iron Ram", type: "metal", power: 75, kind: "physical", acc: 0.9 },
        { id: "chrome-ray", name: "Chrome Ray", type: "metal", power: 60, kind: "special", acc: 0.95 },
    ],
    bug: [
        { id: "pincer-snap", name: "Pincer Snap", type: "bug", power: 65, kind: "physical", acc: 0.95 },
        { id: "swarm-drone", name: "Swarm Drone", type: "bug", power: 80, kind: "special", acc: 0.9 },
    ],
};
/** Type-derived default moveset: both moves per type, padded with normal. */
export function defaultMovesFor(types) {
    const moves = [];
    for (const t of types.slice(0, 2))
        moves.push(...MOVE_TABLE[t]);
    for (const m of MOVE_TABLE.normal) {
        if (moves.length < 4 && !moves.some((x) => x.id === m.id))
            moves.push(m);
    }
    return moves.slice(0, 4);
}
/** Clamp an arbitrary (e.g. model-generated) move into legal bounds. */
export function sanitizeMove(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const r = raw;
    const name = typeof r["name"] === "string" && r["name"].trim() ? r["name"].trim().slice(0, 18) : null;
    const type = typeof r["type"] === "string" && isTypeName(String(r["type"]).toLowerCase())
        ? String(r["type"]).toLowerCase() : null;
    if (!name || !type)
        return null;
    const power = typeof r["power"] === "number" ? Math.round(Math.min(90, Math.max(40, r["power"]))) : 65;
    const kind = r["kind"] === "special" ? "special" : "physical";
    const acc = typeof r["acc"] === "number" ? Math.min(1, Math.max(0.7, r["acc"])) : 0.95;
    const id = typeof r["id"] === "string" && r["id"]
        ? r["id"].slice(0, 32)
        : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
    return { id, name, type, power, kind, acc };
}
/**
 * Deterministic moveset: stored custom moves first (TM-taught), padded with
 * type-derived defaults. Both battle peers compute this from metadata alone.
 */
export function movesFor(meta) {
    const custom = (meta.moves ?? []).map(sanitizeMove).filter((m) => m !== null).slice(0, 4);
    const moves = [...custom];
    for (const m of defaultMovesFor(meta.types)) {
        if (moves.length < 4 && !moves.some((x) => x.id === m.id))
            moves.push(m);
    }
    return moves.slice(0, 4);
}
// ---------------------------------------------------------------------------
// Stats & leveling
// ---------------------------------------------------------------------------
export const MAX_LEVEL = 50;
export function clampStats(raw) {
    const clamp = (v, lo, hi, dflt) => {
        const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
        return Math.max(lo, Math.min(hi, n));
    };
    return {
        hp: clamp(raw?.hp, 20, 150, 50),
        atk: clamp(raw?.atk, 20, 150, 50),
        def: clamp(raw?.def, 20, 150, 50),
        spa: clamp(raw?.spa, 20, 150, 50),
        spd: clamp(raw?.spd, 20, 150, 50),
        spe: clamp(raw?.spe, 20, 150, 50),
    };
}
/** Effective stats at a level (Pokémon-like growth curves). */
export function statsAt(base, level) {
    const other = (b) => Math.floor((2 * b * level) / 100) + 5;
    return {
        hp: Math.floor((2 * base.hp * level) / 100) + level + 10,
        atk: other(base.atk),
        def: other(base.def),
        spa: other(base.spa),
        spd: other(base.spd),
        spe: other(base.spe),
    };
}
export function levelForXp(xp) {
    return Math.min(MAX_LEVEL, 5 + Math.floor(Math.cbrt(Math.max(0, xp))));
}
export function xpForLevel(level) {
    const l = Math.max(5, Math.min(MAX_LEVEL, level));
    return Math.pow(l - 5, 3);
}
/** XP awarded for defeating a monster of the given level. */
export function xpForWin(opponentLevel) {
    return 25 + opponentLevel * 6;
}
/** XP awarded per km of buddy walking. */
export const XP_PER_KM = 30;
/** Apply xp, returning the updated meta and how many levels were gained. */
export function grantXp(meta, xp) {
    const newXp = meta.xp + Math.max(0, Math.round(xp));
    const newLevel = levelForXp(newXp);
    const gained = Math.max(0, newLevel - meta.level);
    return { meta: { ...meta, xp: newXp, level: Math.max(meta.level, newLevel) }, levelsGained: gained };
}
/** The evolution available right now, if any. */
export function pendingEvolution(meta) {
    const next = meta.evolvesTo?.[0];
    if (next && meta.level >= next.atLevel)
        return next;
    return undefined;
}
// ---------------------------------------------------------------------------
// Validation / normalization of metadata found in imported JPEGs
// ---------------------------------------------------------------------------
export function normalizeMeta(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const r = raw;
    if (r["schema"] !== SCHEMA)
        return null;
    if (typeof r["uuid"] !== "string" || typeof r["species"] !== "string")
        return null;
    const origin = (typeof r["origin"] === "object" && r["origin"] !== null ? r["origin"] : {});
    const evolvesTo = Array.isArray(r["evolvesTo"])
        ? r["evolvesTo"].flatMap((e) => {
            if (typeof e !== "object" || e === null)
                return [];
            const ev = e;
            if (typeof ev["name"] !== "string")
                return [];
            return [{
                    name: ev["name"],
                    description: typeof ev["description"] === "string" ? ev["description"] : "",
                    imagePrompt: typeof ev["imagePrompt"] === "string" ? ev["imagePrompt"] : "",
                    statMult: typeof ev["statMult"] === "number" ? Math.min(2, Math.max(1, ev["statMult"])) : 1.25,
                    types: ev["types"] ? sanitizeTypes(ev["types"]) : undefined,
                    atLevel: typeof ev["atLevel"] === "number" ? ev["atLevel"] : 16,
                }];
        })
        : undefined;
    const level = typeof r["level"] === "number" ? Math.max(1, Math.min(MAX_LEVEL, Math.round(r["level"]))) : 5;
    const meta = {
        schema: SCHEMA,
        uuid: r["uuid"],
        name: typeof r["name"] === "string" && r["name"] ? r["name"] : r["species"],
        species: r["species"],
        description: typeof r["description"] === "string" ? r["description"] : "",
        types: sanitizeTypes(r["types"]),
        baseStats: clampStats(r["baseStats"]),
        level,
        xp: typeof r["xp"] === "number" ? Math.max(0, r["xp"]) : xpForLevel(level),
        stage: typeof r["stage"] === "number" ? Math.max(0, Math.min(2, Math.round(r["stage"]))) : 0,
        evolvesTo,
        family: typeof r["family"] === "string" ? r["family"] : r["uuid"],
        parents: Array.isArray(r["parents"]) && r["parents"].length === 2 &&
            typeof r["parents"][0] === "string" && typeof r["parents"][1] === "string"
            ? [r["parents"][0], r["parents"][1]] : undefined,
        origin: {
            trainer: typeof origin["trainer"] === "string" ? origin["trainer"] : "unknown",
            trainerId: typeof origin["trainerId"] === "string" ? origin["trainerId"] : "unknown",
            capturedAt: typeof origin["capturedAt"] === "string" ? origin["capturedAt"] : "1970-01-01T00:00:00Z",
            place: (typeof origin["place"] === "object" && origin["place"] !== null &&
                typeof origin["place"]["lat"] === "number" &&
                typeof origin["place"]["lon"] === "number")
                ? { lat: origin["place"].lat, lon: origin["place"].lon }
                : undefined,
            photoNote: typeof origin["photoNote"] === "string" ? origin["photoNote"] : undefined,
            kind: origin["kind"] === "capture" || origin["kind"] === "evolve" || origin["kind"] === "breed"
                ? origin["kind"] : "import",
        },
        buddyMeters: typeof r["buddyMeters"] === "number" ? r["buddyMeters"] : 0,
        moves: Array.isArray(r["moves"])
            ? r["moves"].map(sanitizeMove).filter((m) => m !== null).slice(0, 4)
            : undefined,
    };
    if (meta.moves && meta.moves.length === 0)
        delete meta.moves;
    return meta;
}
// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------
/** Deterministic 32-bit seeded RNG (mulberry32) — identical on both peers. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function uuidv4() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID();
    const b = new Uint8Array(16);
    c?.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const TYPE_COLORS = {
    normal: "#9aa0a6", fire: "#f2662d", water: "#3d8bfd", grass: "#4caf50",
    electric: "#f5c518", ice: "#7fd4e8", rock: "#b08d57", wind: "#8fd3c7",
    poison: "#a55fc4", spirit: "#7568c4", metal: "#8e9bab", bug: "#a3b939",
};
