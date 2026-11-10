// Capture flow: + button → camera → photo preview → throw monball →
// OpenAI generation pipeline → reveal card.
import { captureFromPhoto, setBuddy } from "./game.js";
import { getToken } from "./auth.js";
import { OpenAIError } from "./openai.js";
import { tracker } from "./sensors.js";
import { busyOverlay, el, jpegUrl, overlay, statBar, toast, typeBadge } from "./ui.js";
export function startCaptureFlow(onDone, goSettings) {
    if (tracker.snapshot().inv.held !== "ball") {
        toast("No GoBall! Walk to earn one.");
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
            previewAndThrow(file, onDone);
    };
    input.click();
}
function previewAndThrow(photo, onDone) {
    const url = URL.createObjectURL(photo);
    const ov = overlay(el("div", { class: "reveal" }, el("h2", {}, "A wild something appeared!"), el("img", { class: "reveal-img photo", src: url, alt: "your photo" }), el("p", { class: "muted" }, "Throw your GoBall to turn what you found into a monster."), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { ov.close(); URL.revokeObjectURL(url); } }, "Cancel"), el("button", { class: "btn primary", onclick: () => { ov.close(); URL.revokeObjectURL(url); void throwBall(photo, onDone); } }, "⚪ Throw GoBall!"))));
}
async function throwBall(photo, onDone) {
    if (!(await tracker.useItem("ball"))) {
        toast("The GoBall is gone!");
        return;
    }
    const busy = busyOverlay("Capturing…");
    try {
        const rec = await captureFromPhoto(photo, busy.setStatus);
        busy.close();
        const url = jpegUrl(rec.jpeg);
        const evoNote = rec.meta.evolvesTo?.length
            ? `Can evolve ${rec.meta.evolvesTo.length}× (first at Lv ${rec.meta.evolvesTo[0].atLevel}).`
            : "This is its final form.";
        const ov = overlay(el("div", { class: "reveal" }, el("h2", {}, `Gotcha! ${rec.meta.name} was caught!`), el("img", { class: "reveal-img", src: url, alt: rec.meta.name }), el("div", { class: "badges" }, ...rec.meta.types.map(typeBadge)), el("p", {}, rec.meta.description), el("p", { class: "muted" }, evoNote), el("div", { class: "stats" }, statBar("HP", rec.meta.baseStats.hp), statBar("ATK", rec.meta.baseStats.atk), statBar("DEF", rec.meta.baseStats.def), statBar("SpA", rec.meta.baseStats.spa), statBar("SpD", rec.meta.baseStats.spd), statBar("SPE", rec.meta.baseStats.spe)), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { ov.close(); onDone(); } }, "Done"), el("button", {
            class: "btn primary",
            onclick: () => { void setBuddy(rec.uuid).then(() => { ov.close(); onDone(); }); },
        }, "Make Buddy"))));
    }
    catch (err) {
        busy.close();
        // generation never happened — give the ball back
        await tracker.refundItem("ball");
        if (err instanceof OpenAIError && (err.status === 401 || err.status === 403)) {
            toast("OpenAI rejected the token — reconnect in Settings.");
        }
        else {
            toast(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
