// Settings: trainer identity, OpenAI token (link code / paste / OAuth),
// lobby server address, and data info.
import { claimLinkCode, clearToken, fetchOAuthConfig, getStoredToken, setApiKey, startOAuth, } from "./auth.js";
import { deliverBackup, restoreFromZip } from "./backup.js";
import { apiBase, setApiBase } from "./config.js";
import * as db from "./db.js";
import { lobbyServerUrl } from "./lobbyui.js";
import { busyOverlay, clear, el, overlay, toast } from "./ui.js";
function pickAndRestore(rerender) {
    const input = el("input", { type: "file", accept: ".zip,application/zip,application/x-zip-compressed" });
    input.style.display = "none";
    document.body.append(input);
    input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file)
            return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ov = overlay(el("div", { class: "dialog" }, el("h3", {}, "Restore backup"), el("p", { class: "muted small" }, "“Everything” also restores trainer identity, walking progress and your held item " +
            "(replacing this phone's current state). “Monsters only” just adds the creatures and eggs."), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { ov.close(); void doRestore(bytes, "monsters-only", rerender); } }, "Monsters only"), el("button", { class: "btn primary", onclick: () => { ov.close(); void doRestore(bytes, "everything", rerender); } }, "Everything"))));
    };
    input.click();
}
async function doRestore(bytes, mode, rerender) {
    const busy = busyOverlay("Restoring…");
    try {
        const res = await restoreFromZip(bytes, mode);
        busy.close();
        toast(`Restored ${res.monsters} monster${res.monsters === 1 ? "" : "s"}${res.eggs ? `, ${res.eggs} egg${res.eggs === 1 ? "" : "s"}` : ""}${res.stateRestored ? " + progress" : ""}.`);
        rerender();
    }
    catch (err) {
        busy.close();
        toast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function renderSettings(root, rerender) {
    clear(root);
    const trainer = await db.getTrainer();
    const monsters = await db.allMonsters();
    // --- trainer
    const nameInput = el("input", { class: "input", value: trainer.name, maxlength: "24" });
    const saveName = el("button", { class: "btn", onclick: async () => {
            await db.setTrainerName(nameInput.value);
            toast("Trainer name saved.");
        } }, "Save");
    // --- OpenAI token
    const stored = getStoredToken();
    const tokenStatus = el("p", { class: stored ? "ok" : "muted" }, stored
        ? `Connected (${stored.kind === "oauth" ? "OAuth token" : "API key"} ···${stored.token.slice(-4)})`
        : "Not connected — captures, evolutions and hatching need an OpenAI token.");
    const linkInput = el("input", { class: "input", placeholder: "LINK CODE", maxlength: "10", autocapitalize: "characters" });
    const linkBtn = el("button", { class: "btn primary", onclick: async () => {
            try {
                await claimLinkCode(linkInput.value);
                toast("Token linked!");
                rerender();
            }
            catch (err) {
                toast(err instanceof Error ? err.message : String(err));
            }
        } }, "Claim");
    const keyInput = el("input", { class: "input", placeholder: "sk-…", type: "password" });
    const keyBtn = el("button", { class: "btn", onclick: () => {
            if (keyInput.value.trim().length < 20) {
                toast("That doesn't look like a key.");
                return;
            }
            setApiKey(keyInput.value);
            toast("Key saved on this device.");
            rerender();
        } }, "Save");
    const oauthRow = el("div", {});
    void fetchOAuthConfig().then((cfg) => {
        if (cfg.enabled) {
            oauthRow.append(el("button", { class: "btn primary wide", onclick: () => void startOAuth(cfg).catch((e) => toast(String(e))) }, "🔐 Authorize via OAuth"));
        }
        else {
            oauthRow.append(el("p", { class: "muted small" }, "OAuth sign-in appears here when the server operator configures a provider " +
                "(OpenAI has no public end-user OAuth for API access today, so use a link code instead)."));
        }
    });
    const disconnectBtn = stored
        ? el("button", { class: "btn danger", onclick: () => { clearToken(); toast("Token removed."); rerender(); } }, "Disconnect")
        : null;
    // --- lobby server
    const lobbyInput = el("input", { class: "input", value: lobbyServerUrl() });
    const lobbySave = el("button", { class: "btn", onclick: () => {
            localStorage.setItem("gomon.lobby.server", lobbyInput.value.trim());
            toast("Lobby server saved.");
        } }, "Save");
    const origin = location.origin;
    root.append(el("h2", {}, "Settings"), el("section", { class: "card" }, el("h3", {}, "Trainer"), el("div", { class: "row" }, nameInput, saveName), el("p", { class: "muted small" }, `id ${trainer.id.slice(0, 8)}… · ${monsters.length} monsters in your dex`)), el("section", { class: "card" }, el("h3", {}, "OpenAI connection"), tokenStatus, el("h4", {}, "Easiest: link code"), el("p", { class: "muted small" }, `On a computer, open ${origin}/link.html, paste your key there, and type the short code it gives you here. ` +
        "The key crosses the server once, in memory only."), el("div", { class: "row" }, linkInput, linkBtn), el("h4", {}, "Or paste the key directly"), el("div", { class: "row" }, keyInput, keyBtn), el("h4", {}, "Or OAuth"), oauthRow, disconnectBtn, el("p", { class: "muted small" }, "Your token is stored only on this phone and sent only to api.openai.com.")), el("section", { class: "card" }, el("h3", {}, "Multiplayer (lobbylink)"), el("p", { class: "muted small" }, "Address of the lobbylink signaling server used for battles, breeding and trades."), el("div", { class: "row" }, lobbyInput, lobbySave)), el("section", { class: "card" }, el("h3", {}, "Sync server (optional)"), el("p", { class: "muted small" }, "Where monsters are backed up and link codes live. Leave empty when the game is served " +
        "by its own server; set it when this copy is hosted as static files (e.g. GitHub Pages). " +
        "Without it, the game still fully works — just no DB backup or link codes."), el("div", { class: "row" }, (() => {
        const inp = el("input", { class: "input", placeholder: "https://example.org", value: apiBase() });
        const btn = el("button", { class: "btn", onclick: () => { setApiBase(inp.value); toast("Sync server saved."); } }, "Save");
        return el("div", { class: "row", style: "flex:1; margin:0" }, inp, btn);
    })())), el("section", { class: "card" }, el("h3", {}, "Backup & restore"), el("p", { class: "muted small" }, "Package everything — monsters (as their real JPEGs), eggs, trainer, walking progress — " +
        "into one .zip and send it to iCloud, Dropbox or Files via the share sheet. Restore it " +
        "on any phone. Backups never contain your OpenAI token."), el("div", { class: "row" }, el("button", { class: "btn primary", onclick: async () => {
            try {
                const { monsters, eggs } = await deliverBackup();
                toast(`Backup ready: ${monsters} monster${monsters === 1 ? "" : "s"}${eggs ? `, ${eggs} egg${eggs === 1 ? "" : "s"}` : ""}.`);
            }
            catch (err) {
                toast(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        } }, "⬇ Export backup"), el("button", { class: "btn", onclick: () => pickAndRestore(rerender) }, "⬆ Restore"))), el("section", { class: "card" }, el("h3", {}, "About"), el("p", { class: "muted small" }, "GoMon turns your walks into monsters: every 500 m earns a GoBall (catch what you " +
        "photograph) or a TM (mint a new move from a photo). While you hold an unused item, " +
        "walking still banks partial progress toward the next one — up to a hidden 50-80% cap — " +
        "so glance at your phone every km or so and spend your finds; staring at the screen " +
        "earns nothing extra. Every monster's JPEG holds all its stats, so saving it to your " +
        "photo reel is a real, tradable, re-importable monster.")));
}
