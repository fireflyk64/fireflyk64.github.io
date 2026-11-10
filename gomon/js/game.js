// Game orchestration: the capture pipeline (photo → OpenAI → self-contained
// JPEG → IndexedDB → server sync), evolution, breeding/hatching, buddy
// walking credit, import/export of monster JPEGs, and best-effort sync to
// the site's SQL database.
import { apiUrl } from "./config.js";
import * as db from "./db.js";
import { embedMeta, extractMeta } from "./jpegmeta.js";
import { clampStats, grantXp, normalizeMeta, pendingEvolution, SCHEMA, uuidv4, XP_PER_KM, xpForLevel, } from "./model.js";
import * as ai from "./openai.js";
import { tracker } from "./sensors.js";
import { jpegBlob } from "./ui.js";
export const EGG_HATCH_METERS = 1000;
// --- server sync (best effort — the game is fully playable offline) ---------
async function syncMonster(rec) {
    try {
        const trainer = await db.getTrainer();
        const bytes = new Uint8Array(rec.jpeg);
        let b64 = "";
        const CHUNK = 0x8000;
        let s = "";
        for (let i = 0; i < bytes.length; i += CHUNK)
            s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        b64 = btoa(s);
        await fetch(apiUrl("api/monsters"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ownerId: trainer.id, ownerName: trainer.name, meta: rec.meta, jpegB64: b64 }),
        });
    }
    catch {
        // offline or server down — local copy is authoritative anyway
    }
}
async function unsyncMonster(uuid) {
    try {
        const trainer = await db.getTrainer();
        await fetch(apiUrl(`api/monsters/${encodeURIComponent(uuid)}?owner=${encodeURIComponent(trainer.id)}`), { method: "DELETE" });
    }
    catch { /* best effort */ }
}
// --- capture ----------------------------------------------------------------
export async function captureFromPhoto(photo, onProgress) {
    const trainer = await db.getTrainer();
    const evoCount = ai.rollEvolutionCount();
    onProgress("Studying your photo…");
    const spec = await ai.describeMonsterFromPhoto(photo, evoCount);
    onProgress(`It's ${spec.species}! Drawing its sprite…`);
    const sprite = await ai.pixelSpriteFromPhoto(photo, spec);
    const uuid = uuidv4();
    const meta = {
        schema: SCHEMA,
        uuid,
        name: spec.species,
        species: spec.species,
        description: spec.description,
        types: spec.types,
        baseStats: spec.baseStats,
        level: 5,
        xp: 0,
        stage: 0,
        evolvesTo: spec.evolutions.length ? spec.evolutions : undefined,
        family: uuid,
        origin: {
            trainer: trainer.name,
            trainerId: trainer.id,
            capturedAt: new Date().toISOString(),
            place: tracker.coarsePlace(),
            photoNote: spec.photoNote,
            kind: "capture",
        },
        buddyMeters: 0,
    };
    onProgress("Sealing it into the GoBall…");
    const jpeg = embedMeta(sprite, meta);
    const rec = { uuid, meta, jpeg: jpeg.buffer, addedAt: Date.now() };
    await db.putMonster(rec);
    tracker.setTmEligible(true);
    void syncMonster(rec);
    return rec;
}
// --- evolution --------------------------------------------------------------
export function evolutionReady(meta) {
    return pendingEvolution(meta);
}
export async function evolveMonster(rec, onProgress) {
    const evo = pendingEvolution(rec.meta);
    if (!evo)
        throw new Error("Not ready to evolve");
    onProgress(`${rec.meta.name} is evolving…`);
    const sprite = await ai.evolutionSprite(jpegBlob(new Uint8Array(rec.jpeg)), evo, evo.types ?? rec.meta.types);
    const keptName = rec.meta.name !== rec.meta.species; // preserve nicknames
    const meta = {
        ...rec.meta,
        name: keptName ? rec.meta.name : evo.name,
        species: evo.name,
        description: evo.description || rec.meta.description,
        types: evo.types ?? rec.meta.types,
        baseStats: clampStats({
            hp: Math.round(rec.meta.baseStats.hp * evo.statMult),
            atk: Math.round(rec.meta.baseStats.atk * evo.statMult),
            def: Math.round(rec.meta.baseStats.def * evo.statMult),
            spa: Math.round(rec.meta.baseStats.spa * evo.statMult),
            spd: Math.round(rec.meta.baseStats.spd * evo.statMult),
            spe: Math.round(rec.meta.baseStats.spe * evo.statMult),
        }),
        stage: rec.meta.stage + 1,
        evolvesTo: rec.meta.evolvesTo?.slice(1).length ? rec.meta.evolvesTo.slice(1) : undefined,
        origin: { ...rec.meta.origin, kind: "evolve" },
    };
    const jpeg = embedMeta(sprite, meta);
    const updated = { ...rec, meta, jpeg: jpeg.buffer };
    await db.putMonster(updated);
    void syncMonster(updated);
    return updated;
}
// --- breeding & eggs --------------------------------------------------------
export async function makeEgg(mine, theirs, partnerTrainer) {
    const egg = {
        uuid: uuidv4(),
        parentA: { meta: mine.meta, jpeg: mine.jpeg },
        parentB: { meta: theirs.meta, jpeg: theirs.jpeg.slice().buffer },
        metersRequired: EGG_HATCH_METERS,
        metersWalked: 0,
        createdAt: Date.now(),
        partnerTrainer,
    };
    await db.putEgg(egg);
    return egg;
}
export async function hatchEgg(egg, onProgress) {
    const trainer = await db.getTrainer();
    const a = egg.parentA.meta;
    const b = egg.parentB.meta;
    onProgress("The egg is glowing…");
    const spec = await ai.breedSpec({ species: a.species, types: a.types, baseStats: a.baseStats, description: a.description }, { species: b.species, types: b.types, baseStats: b.baseStats, description: b.description });
    onProgress(`Something is emerging… it's ${spec.species}!`);
    const sprite = await ai.breedSprite(jpegBlob(new Uint8Array(egg.parentA.jpeg)), jpegBlob(new Uint8Array(egg.parentB.jpeg)), spec.species);
    const uuid = uuidv4();
    const meta = {
        schema: SCHEMA,
        uuid,
        name: spec.species,
        species: spec.species,
        description: spec.description,
        types: spec.types,
        baseStats: spec.baseStats,
        level: 5,
        xp: 0,
        stage: 0,
        family: a.family,
        parents: [a.uuid, b.uuid],
        origin: {
            trainer: trainer.name,
            trainerId: trainer.id,
            capturedAt: new Date().toISOString(),
            kind: "breed",
        },
        buddyMeters: 0,
    };
    const jpeg = embedMeta(sprite, meta);
    const rec = { uuid, meta, jpeg: jpeg.buffer, addedAt: Date.now() };
    await db.putMonster(rec);
    await db.deleteEgg(egg.uuid);
    void syncMonster(rec);
    return rec;
}
// --- import / export --------------------------------------------------------
export async function importJpeg(bytes) {
    const raw = extractMeta(bytes);
    const meta = raw ? normalizeMeta(raw) : null;
    if (!meta)
        return null;
    const existing = await db.getMonster(meta.uuid);
    const rec = {
        uuid: meta.uuid,
        meta,
        jpeg: bytes.slice().buffer,
        addedAt: existing?.addedAt ?? Date.now(),
    };
    await db.putMonster(rec);
    tracker.setTmEligible(true);
    void syncMonster(rec);
    return rec;
}
/** Save the self-contained JPEG to the photo reel (share sheet or download). */
export async function exportMonster(rec) {
    const name = `${rec.meta.name.replace(/[^\w-]+/g, "_")}-gomon.jpg`;
    const blob = new Blob([rec.jpeg], { type: "image/jpeg" });
    const file = new File([blob], name, { type: "image/jpeg" });
    const nav = navigator;
    if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
            await nav.share({ files: [file], title: rec.meta.name });
            return;
        }
        catch (err) {
            if (err.name === "AbortError")
                return;
            // fall through to download
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function releaseMonster(uuid) {
    await db.deleteMonster(uuid);
    const buddy = await db.kvGet("buddy");
    if (buddy === uuid)
        await db.kvSet("buddy", "");
    tracker.setTmEligible((await db.allMonsters()).length > 0);
    void unsyncMonster(uuid);
}
// --- xp / persistence helpers ----------------------------------------------
export async function saveMetaUpdate(rec, meta) {
    const jpeg = embedMeta(new Uint8Array(rec.jpeg), meta);
    const updated = { ...rec, meta, jpeg: jpeg.buffer };
    await db.putMonster(updated);
    void syncMonster(updated);
    return updated;
}
export async function awardXp(rec, xp) {
    const { meta, levelsGained } = grantXp(rec.meta, xp);
    const updated = await saveMetaUpdate(rec, meta);
    return { rec: updated, levelsGained };
}
// --- buddy walking ----------------------------------------------------------
let pendingBuddyMeters = 0;
let flushing = false;
/** Wire the tracker to buddy XP and egg incubation. Call once at startup. */
export function attachWalkCredit(onEggReady, onBuddyLevel) {
    tracker.onDistance((deltaM) => {
        pendingBuddyMeters += deltaM;
        if (pendingBuddyMeters >= 25 && !flushing) {
            const meters = pendingBuddyMeters;
            pendingBuddyMeters = 0;
            flushing = true;
            void flushWalkCredit(meters, onEggReady, onBuddyLevel).finally(() => (flushing = false));
        }
    });
}
async function flushWalkCredit(meters, onEggReady, onBuddyLevel) {
    // eggs incubate with every credited meter
    const eggs = await db.allEggs();
    for (const egg of eggs) {
        const before = egg.metersWalked;
        egg.metersWalked = Math.min(egg.metersRequired, egg.metersWalked + meters);
        await db.putEgg(egg);
        if (before < egg.metersRequired && egg.metersWalked >= egg.metersRequired)
            onEggReady(egg);
    }
    // buddy earns XP per km walked together
    const buddyId = await db.kvGet("buddy");
    if (!buddyId)
        return;
    const rec = await db.getMonster(buddyId);
    if (!rec)
        return;
    const buddyMeters = (rec.meta.buddyMeters ?? 0) + meters;
    const wholeKmBefore = Math.floor((rec.meta.buddyMeters ?? 0) / 1000);
    const wholeKmAfter = Math.floor(buddyMeters / 1000);
    let meta = { ...rec.meta, buddyMeters };
    let levels = 0;
    if (wholeKmAfter > wholeKmBefore) {
        const res = grantXp(meta, (wholeKmAfter - wholeKmBefore) * XP_PER_KM);
        meta = res.meta;
        levels = res.levelsGained;
    }
    await saveMetaUpdate(rec, meta);
    if (levels > 0)
        onBuddyLevel();
}
export async function getBuddy() {
    const buddyId = await db.kvGet("buddy");
    if (!buddyId)
        return undefined;
    return db.getMonster(buddyId);
}
export async function setBuddy(uuid) {
    await db.kvSet("buddy", uuid);
}
export { xpForLevel };
