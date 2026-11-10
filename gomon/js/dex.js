// MonDex: the collection grid, monster detail sheet, import/export.
// Every monster's JPEG is self-contained, so "Share/Save" puts a tradable
// creature in your photo reel and "Import" brings one back (yours or a
// friend's).
import * as db from "./db.js";
import { evolutionReady, evolveMonster, exportMonster, importJpeg, releaseMonster, setBuddy } from "./game.js";
import { movesFor, statsAt, xpForLevel } from "./model.js";
import { busyOverlay, clear, confirmDialog, el, fmtKm, jpegUrl, overlay, statBar, toast, typeBadge } from "./ui.js";
export async function renderDex(root, rerender) {
    clear(root);
    const monsters = await db.allMonsters();
    const buddyId = await db.kvGet("buddy");
    const importBtn = el("button", { class: "btn ghost" }, "⬆ Import JPEG");
    importBtn.onclick = () => {
        const input = el("input", { type: "file", accept: "image/jpeg,image/*", multiple: true });
        input.style.display = "none";
        document.body.append(input);
        input.onchange = async () => {
            const files = Array.from(input.files ?? []);
            input.remove();
            let ok = 0;
            for (const f of files) {
                const rec = await importJpeg(new Uint8Array(await f.arrayBuffer()));
                if (rec)
                    ok++;
            }
            toast(ok ? `Imported ${ok} monster${ok > 1 ? "s" : ""}!` : "No GoMon metadata found in that image.");
            if (ok)
                rerender();
        };
        input.click();
    };
    root.append(el("div", { class: "dex-head" }, el("h2", {}, `MonDex · ${monsters.length}`), importBtn));
    if (!monsters.length) {
        root.append(el("p", { class: "muted center" }, "No monsters yet. Walk to earn a GoBall, then tap + and photograph something interesting!"));
        return;
    }
    const grid = el("div", { class: "dex-grid" });
    for (const rec of monsters) {
        const url = jpegUrl(rec.jpeg);
        const card = el("div", { class: "dex-card", onclick: () => showMonsterDetail(rec.uuid, rerender) }, el("img", { src: url, alt: rec.meta.name, loading: "lazy" }), el("div", { class: "dex-name" }, rec.meta.name), el("div", { class: "dex-sub" }, el("span", {}, `Lv ${rec.meta.level}`), ...rec.meta.types.map(typeBadge)), buddyId === rec.uuid ? el("div", { class: "buddy-tag" }, "★ buddy") : null);
        grid.append(card);
    }
    root.append(grid);
}
export async function showMonsterDetail(uuid, rerender) {
    const rec = await db.getMonster(uuid);
    if (!rec)
        return;
    const meta = rec.meta;
    const url = jpegUrl(rec.jpeg);
    const eff = statsAt(meta.baseStats, meta.level);
    const nextEvo = meta.evolvesTo?.[0];
    const evoNow = evolutionReady(meta);
    const nextLevelXp = xpForLevel(meta.level + 1);
    const origin = [`Caught by ${meta.origin.trainer}`];
    if (meta.origin.capturedAt.startsWith("19") === false) {
        origin.push(new Date(meta.origin.capturedAt).toLocaleDateString());
    }
    if (meta.origin.place)
        origin.push(`near ${meta.origin.place.lat.toFixed(2)}, ${meta.origin.place.lon.toFixed(2)}`);
    if (meta.origin.photoNote)
        origin.push(`inspired by ${meta.origin.photoNote}`);
    const ov = overlay(el("div", { class: "detail" }, el("button", { class: "detail-close", onclick: () => ov.close() }, "✕"), el("img", { class: "detail-img", src: url, alt: meta.name }), el("h2", {}, meta.name), el("div", { class: "muted" }, meta.name !== meta.species ? `${meta.species} · ` : "", `Lv ${meta.level} · stage ${meta.stage + 1}`), el("div", { class: "badges" }, ...meta.types.map(typeBadge)), el("p", {}, meta.description), meta.parents
        ? el("p", { class: "muted" }, `Hatched from an egg — child of two monsters.`)
        : null, el("p", { class: "muted" }, origin.join(" · ")), el("div", { class: "stats" }, statBar("HP", eff.hp, 220), statBar("ATK", eff.atk, 220), statBar("DEF", eff.def, 220), statBar("SpA", eff.spa, 220), statBar("SpD", eff.spd, 220), statBar("SPE", eff.spe, 220)), el("div", { class: "moves-list" }, el("h4", {}, "Moves"), ...movesFor(meta).map((m) => el("div", { class: "move-line" }, typeBadge(m.type), el("span", { class: "move-line-name" }, m.name), el("span", { class: "move-line-meta" }, `${m.kind === "physical" ? "phys" : "spec"} · ${m.power} · ${Math.round(m.acc * 100)}%`)))), el("p", { class: "muted" }, `XP ${meta.xp} (next level at ${nextLevelXp}) · walked together ${fmtKm(meta.buddyMeters ?? 0)}`), nextEvo && !evoNow
        ? el("p", { class: "muted" }, `Evolves into ${nextEvo.name} at Lv ${nextEvo.atLevel}.`)
        : null, !meta.evolvesTo?.length ? el("p", { class: "muted" }, "Final form.") : null, el("div", { class: "detail-actions" }, el("button", { class: "btn primary", onclick: async () => { await setBuddy(uuid); toast(`${meta.name} is now your buddy!`); ov.close(); rerender(); } }, "★ Buddy"), el("button", { class: "btn", onclick: () => void exportMonster(rec).then(() => toast("Saved — it's a real, tradable JPEG.")) }, "⬇ Share/Save"), evoNow
        ? el("button", {
            class: "btn evolve",
            onclick: async () => {
                ov.close();
                const busy = busyOverlay("Evolution!");
                try {
                    const updated = await evolveMonster(rec, busy.setStatus);
                    busy.close();
                    toast(`${meta.name} evolved into ${updated.meta.species}!`);
                    rerender();
                    void showMonsterDetail(uuid, rerender);
                }
                catch (err) {
                    busy.close();
                    toast(`Evolution failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            },
        }, `⚡ Evolve → ${evoNow.name}`)
        : null, el("button", {
        class: "btn danger",
        onclick: async () => {
            if (await confirmDialog(`Release ${meta.name}? Export it first if you want it back later.`, "Release")) {
                await releaseMonster(uuid);
                toast(`${meta.name} was released. Bye!`);
                ov.close();
                rerender();
            }
        },
    }, "Release"))));
}
