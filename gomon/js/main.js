// App entry: boot, service worker, tab navigation, capture button, and the
// glue between the walk tracker and buddy/egg progression.
import { claimDeepLinkIfPresent, completeOAuthIfCallback } from "./auth.js";
import { startCaptureFlow } from "./capture.js";
import * as db from "./db.js";
import { renderDex, showMonsterDetail } from "./dex.js";
import { attachWalkCredit } from "./game.js";
import { renderLobby } from "./lobbyui.js";
import { tracker } from "./sensors.js";
import { renderSettings } from "./settings.js";
import { startTmFlow } from "./tm.js";
import { toast } from "./ui.js";
import { renderWalk } from "./walk.js";
const screens = {
    walk: document.getElementById("screen-walk"),
    dex: document.getElementById("screen-dex"),
    lobby: document.getElementById("screen-lobby"),
    settings: document.getElementById("screen-settings"),
};
let active = "walk";
function show(tab) {
    active = tab;
    for (const [name, node] of Object.entries(screens)) {
        node.classList.toggle("active", name === tab);
    }
    for (const btn of document.querySelectorAll("[data-tab]")) {
        btn.classList.toggle("active", btn.dataset["tab"] === tab);
    }
    void renderActive();
}
async function renderActive() {
    const rerender = () => void renderActive();
    switch (active) {
        case "walk":
            await renderWalk(screens.walk, (uuid) => void showMonsterDetail(uuid, rerender));
            return;
        case "dex":
            await renderDex(screens.dex, rerender);
            return;
        case "lobby":
            await renderLobby(screens.lobby, rerender);
            return;
        case "settings":
            await renderSettings(screens.settings, rerender);
            return;
    }
}
async function boot() {
    if ("serviceWorker" in navigator) {
        // fire-and-forget: never let the offline shell block first paint
        navigator.serviceWorker.register("sw.js").catch(() => { });
    }
    await tracker.load();
    try {
        if (await completeOAuthIfCallback())
            toast("OpenAI connected via OAuth!");
    }
    catch (err) {
        toast(`OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        if (await claimDeepLinkIfPresent())
            toast("OpenAI token linked!");
    }
    catch (err) {
        toast(`Link failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    attachWalkCredit((egg) => toast(`An egg is ready to hatch! (${egg.parentA.meta.name} × ${egg.parentB.meta.name})`), () => toast("Your buddy leveled up from walking with you!"));
    tracker.onItem((kind) => toast(kind === "ball" ? "You earned a GoBall! Photograph something to catch it. 🎉" : "You found a TM! Photograph something to mint a move. 💿"));
    // TMs only drop once you own a monster to teach
    tracker.setTmEligible((await db.allMonsters()).length > 0);
    for (const btn of document.querySelectorAll("[data-tab]")) {
        btn.addEventListener("click", () => show(btn.dataset["tab"]));
    }
    // the + button spends whatever you're holding: GoBall → catch, TM → new move
    const capBtn = document.getElementById("capture-btn");
    capBtn.addEventListener("click", () => {
        const held = tracker.snapshot().inv.held;
        if (held === "tm") {
            startTmFlow(() => show("dex"), () => show("settings"));
        }
        else {
            startCaptureFlow(() => show("dex"), () => show("settings"));
        }
    });
    // pulse the button while an item is waiting to be spent
    const reflectHeld = () => {
        const held = tracker.snapshot().inv.held;
        capBtn.classList.toggle("has-item", held !== null);
        capBtn.dataset["held"] = held ?? "";
    };
    tracker.onChange(reflectHeld);
    reflectHeld();
    show("walk");
}
void boot();
