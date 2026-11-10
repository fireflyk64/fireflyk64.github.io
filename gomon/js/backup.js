// Full progress backup & restore as a single ZIP the player can push to
// iCloud / Dropbox / Files through the share sheet and pull back later.
//
// The archive is deliberately human-usable: monsters ship as their actual
// self-contained JPEGs (metadata embedded — see jpegmeta.ts), so opening the
// backup in any file manager shows your creatures, and any single JPEG can
// be re-imported on its own. manifest.json carries everything that isn't a
// monster: trainer identity, odometer/held-item state, buddy choice, and
// egg incubation progress. The OpenAI token is deliberately NOT included —
// backups are meant to be safe to park on cloud drives.
import * as db from "./db.js";
import { importJpeg } from "./game.js";
import { extractMeta } from "./jpegmeta.js";
import { normalizeMeta } from "./model.js";
import { tracker } from "./sensors.js";
import { zipRead, zipWrite } from "./zip.js";
const SCHEMA = "gomon-backup/1";
function safeName(s) {
    return s.replace(/[^\w-]+/g, "_").slice(0, 24) || "mon";
}
// --- export -----------------------------------------------------------------
export async function buildBackupZip() {
    const monsters = await db.allMonsters();
    const eggs = await db.allEggs();
    const trainer = await db.getTrainer();
    const buddy = (await db.kvGet("buddy")) ?? null;
    const snap = tracker.snapshot();
    const entries = [];
    for (const m of monsters) {
        entries.push({
            name: `monsters/${safeName(m.meta.name)}-${m.uuid.slice(0, 8)}.jpg`,
            data: new Uint8Array(m.jpeg),
        });
    }
    const eggRefs = [];
    for (const egg of eggs) {
        const a = `eggs/${egg.uuid.slice(0, 8)}-a.jpg`;
        const b = `eggs/${egg.uuid.slice(0, 8)}-b.jpg`;
        entries.push({ name: a, data: new Uint8Array(egg.parentA.jpeg) });
        entries.push({ name: b, data: new Uint8Array(egg.parentB.jpeg) });
        eggRefs.push({
            uuid: egg.uuid,
            metersRequired: egg.metersRequired,
            metersWalked: egg.metersWalked,
            createdAt: egg.createdAt,
            partnerTrainer: egg.partnerTrainer,
            parentA: a,
            parentB: b,
        });
    }
    const manifest = {
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        trainer,
        buddy,
        tracker: { odometerM: snap.odometerM, inv: snap.inv, stepCount: snap.stepCount },
        eggs: eggRefs,
        monsterCount: monsters.length,
    };
    entries.unshift({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    return { bytes: zipWrite(entries), monsters: monsters.length, eggs: eggs.length };
}
/** Build the backup and hand it to the OS (share sheet → iCloud/Dropbox/…,
 * or a plain download when sharing isn't available). */
export async function deliverBackup() {
    const { bytes, monsters, eggs } = await buildBackupZip();
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `gomon-backup-${stamp}.zip`;
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy.buffer], { type: "application/zip" });
    const file = new File([blob], name, { type: "application/zip" });
    const nav = navigator;
    if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
            await nav.share({ files: [file], title: "GoMon backup" });
            return { monsters, eggs };
        }
        catch (err) {
            if (err.name === "AbortError")
                return { monsters, eggs };
            // fall through to download
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { monsters, eggs };
}
export async function restoreFromZip(bytes, mode) {
    const entries = await zipRead(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    let manifest = null;
    const manifestEntry = entries.find((e) => e.name === "manifest.json" || e.name.endsWith("/manifest.json"));
    if (manifestEntry) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(manifestEntry.data));
            if (parsed.schema === SCHEMA)
                manifest = parsed;
        }
        catch { /* treat as loose jpg zip */ }
    }
    // monsters: every jpg that isn't an egg parent (works even for a plain
    // zip of exported monster photos with no manifest at all)
    let monsters = 0;
    for (const e of entries) {
        if (!/\.jpe?g$/i.test(e.name))
            continue;
        if (/(^|\/)eggs\//.test(e.name))
            continue;
        if (await importJpeg(e.data))
            monsters++;
    }
    // eggs
    let eggCount = 0;
    if (manifest) {
        for (const ref of manifest.eggs) {
            const a = byName.get(ref.parentA);
            const b = byName.get(ref.parentB);
            if (!a || !b)
                continue;
            const metaA = normalizeMeta(extractMeta(a.data));
            const metaB = normalizeMeta(extractMeta(b.data));
            if (!metaA || !metaB)
                continue;
            await db.putEgg({
                uuid: ref.uuid,
                parentA: { meta: metaA, jpeg: a.data.slice().buffer },
                parentB: { meta: metaB, jpeg: b.data.slice().buffer },
                metersRequired: Math.max(1, Number(ref.metersRequired) || 1000),
                metersWalked: Math.max(0, Number(ref.metersWalked) || 0),
                createdAt: Number(ref.createdAt) || Date.now(),
                partnerTrainer: String(ref.partnerTrainer ?? "?"),
            });
            eggCount++;
        }
    }
    // full state
    let stateRestored = false;
    if (mode === "everything" && manifest) {
        if (manifest.trainer?.id && manifest.trainer?.name) {
            await db.kvSet("trainer", { id: manifest.trainer.id, name: manifest.trainer.name });
        }
        if (manifest.buddy && (await db.getMonster(manifest.buddy))) {
            await db.kvSet("buddy", manifest.buddy);
        }
        if (manifest.tracker) {
            await tracker.restoreState(manifest.tracker);
        }
        stateRestored = true;
    }
    return { monsters, eggs: eggCount, stateRestored };
}
