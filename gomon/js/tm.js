// TM flow: spend a held TM, photograph something interesting, and ChatGPT
// mints a move from it (type, power, style). Then teach it to one of your
// monsters, replacing one of its four move slots. The new moveset is written
// into the monster's metadata and re-embedded in its JPEG.
import * as db from "./db.js";
import { getToken } from "./auth.js";
import { saveMetaUpdate } from "./game.js";
import { defaultMovesFor, movesFor } from "./model.js";
import { moveFromPhoto, OpenAIError } from "./openai.js";
import { tracker } from "./sensors.js";
import { busyOverlay, el, jpegUrl, overlay, toast, typeBadge } from "./ui.js";
export function startTmFlow(onDone, goSettings) {
    if (tracker.snapshot().inv.held !== "tm") {
        toast("No TM to use right now.");
        return;
    }
    if (!getToken()) {
        toast("Connect your OpenAI token first (Settings).");
        goSettings();
        return;
    }
    const input = el("input", { type: "file", accept: "image/*", capture: "environment" });
    input.style.display = "none";
    document.body.append(input);
    input.onchange = () => {
        const file = input.files?.[0];
        input.remove();
        if (file)
            previewAndMint(file, onDone);
    };
    input.click();
}
function previewAndMint(photo, onDone) {
    const url = URL.createObjectURL(photo);
    const ov = overlay(el("div", { class: "reveal" }, el("h2", {}, "Technical Machine"), el("img", { class: "reveal-img photo", src: url, alt: "your photo" }), el("p", { class: "muted" }, "Burn this TM to turn what you found into a brand-new move."), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { ov.close(); URL.revokeObjectURL(url); } }, "Cancel"), el("button", { class: "btn primary", onclick: () => { ov.close(); URL.revokeObjectURL(url); void mint(photo, onDone); } }, "💿 Burn TM!"))));
}
async function mint(photo, onDone) {
    if (!(await tracker.useItem("tm"))) {
        toast("The TM is gone!");
        return;
    }
    const busy = busyOverlay("Encoding move…");
    try {
        busy.setStatus("Studying your photo…");
        const move = await moveFromPhoto(photo);
        busy.close();
        revealMove(move, onDone);
    }
    catch (err) {
        busy.close();
        await tracker.refundItem("tm");
        if (err instanceof OpenAIError && (err.status === 401 || err.status === 403)) {
            toast("OpenAI rejected the token — reconnect in Settings.");
        }
        else {
            toast(`TM failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
function moveCard(m) {
    return el("div", { class: "move-card" }, el("div", { class: "move-card-name" }, m.name), el("div", { class: "move-card-meta" }, typeBadge(m.type), el("span", {}, ` ${m.kind} · power ${m.power} · ${Math.round(m.acc * 100)}%`)));
}
function revealMove(move, onDone) {
    const ov = overlay(el("div", { class: "reveal" }, el("h2", {}, `The TM contains ${move.name}!`), moveCard(move), el("p", { class: "muted" }, "Teach it to one of your monsters — it replaces a move slot."), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { ov.close(); onDone(); toast("Move saved nowhere — TM spent. Teach faster next time!"); } }, "Discard"), el("button", { class: "btn primary", onclick: () => { ov.close(); void pickMonster(move, onDone); } }, "Teach"))));
}
async function pickMonster(move, onDone) {
    const monsters = await db.allMonsters();
    if (!monsters.length) {
        toast("No monsters to teach!");
        return;
    }
    const ov = overlay(el("div", { class: "dialog picker-list" }, el("h3", {}, `Teach ${move.name} to…`), ...monsters.map((m) => el("div", { class: "picker-row", onclick: () => { ov.close(); void pickSlot(m, move, onDone); } }, el("img", { src: jpegUrl(m.jpeg), alt: m.meta.name }), el("span", {}, `${m.meta.name} · Lv ${m.meta.level}`), ...m.meta.types.map(typeBadge))), el("button", { class: "btn wide", onclick: () => { ov.close(); void pickMonster(move, onDone); } }, "Back")));
}
async function pickSlot(rec, move, onDone) {
    const current = movesFor(rec.meta);
    const ov = overlay(el("div", { class: "dialog" }, el("h3", {}, `Replace which move on ${rec.meta.name}?`), moveCard(move), el("div", { class: "slot-list" }, ...current.map((m, i) => el("button", { class: "btn wide slot-btn", onclick: () => { ov.close(); void teach(rec, move, i, onDone); } }, `${i + 1}. ${m.name} (${m.type} · ${m.power})`))), el("button", { class: "btn ghost wide", onclick: () => { ov.close(); void pickMonster(move, onDone); } }, "Back")));
}
async function teach(rec, move, slot, onDone) {
    // materialize the current effective moveset, then replace the chosen slot
    const moves = movesFor(rec.meta).slice();
    moves[slot] = move;
    // avoid duplicate ids (same TM twice): keep first occurrence, refill defaults
    const seen = new Set();
    const deduped = moves.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    for (const d of defaultMovesFor(rec.meta.types)) {
        if (deduped.length >= 4)
            break;
        if (!seen.has(d.id)) {
            deduped.push(d);
            seen.add(d.id);
        }
    }
    await saveMetaUpdate(rec, { ...rec.meta, moves: deduped });
    toast(`${rec.meta.name} learned ${move.name}!`);
    onDone();
}
