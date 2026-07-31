// Local persistence: IndexedDB for monsters (self-contained JPEG bytes +
// parsed metadata), breeding eggs, and a small key-value store for game
// state (trainer profile, odometer, monballs, buddy selection).
import { uuidv4 } from "./model.js";
const DB_NAME = "gomon";
const DB_VERSION = 1;
let dbPromise = null;
function open() {
    if (dbPromise)
        return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("monsters"))
                db.createObjectStore("monsters", { keyPath: "uuid" });
            if (!db.objectStoreNames.contains("eggs"))
                db.createObjectStore("eggs", { keyPath: "uuid" });
            if (!db.objectStoreNames.contains("kv"))
                db.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexeddb open failed"));
    });
    return dbPromise;
}
function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
        tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
    });
}
function reqResult(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("request failed"));
    });
}
// --- monsters ---------------------------------------------------------------
export async function putMonster(rec) {
    const db = await open();
    const tx = db.transaction("monsters", "readwrite");
    tx.objectStore("monsters").put(rec);
    await txDone(tx);
}
export async function getMonster(uuid) {
    const db = await open();
    return reqResult(db.transaction("monsters").objectStore("monsters").get(uuid));
}
export async function allMonsters() {
    const db = await open();
    const rows = await reqResult(db.transaction("monsters").objectStore("monsters").getAll());
    return rows.sort((a, b) => b.addedAt - a.addedAt);
}
export async function deleteMonster(uuid) {
    const db = await open();
    const tx = db.transaction("monsters", "readwrite");
    tx.objectStore("monsters").delete(uuid);
    await txDone(tx);
}
// --- eggs -------------------------------------------------------------------
export async function putEgg(rec) {
    const db = await open();
    const tx = db.transaction("eggs", "readwrite");
    tx.objectStore("eggs").put(rec);
    await txDone(tx);
}
export async function allEggs() {
    const db = await open();
    const rows = await reqResult(db.transaction("eggs").objectStore("eggs").getAll());
    return rows.sort((a, b) => a.createdAt - b.createdAt);
}
export async function deleteEgg(uuid) {
    const db = await open();
    const tx = db.transaction("eggs", "readwrite");
    tx.objectStore("eggs").delete(uuid);
    await txDone(tx);
}
// --- key-value --------------------------------------------------------------
export async function kvGet(key) {
    const db = await open();
    return reqResult(db.transaction("kv").objectStore("kv").get(key));
}
export async function kvSet(key, value) {
    const db = await open();
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    await txDone(tx);
}
// --- trainer profile --------------------------------------------------------
export async function getTrainer() {
    let t = await kvGet("trainer");
    if (!t) {
        t = { id: uuidv4(), name: `Trainer-${Math.floor(1000 + Math.random() * 9000)}` };
        await kvSet("trainer", t);
    }
    return t;
}
export async function setTrainerName(name) {
    const t = await getTrainer();
    const updated = { ...t, name: name.trim() || t.name };
    await kvSet("trainer", updated);
    return updated;
}
