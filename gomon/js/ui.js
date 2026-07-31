// Small DOM helpers shared by all screens.
import { TYPE_COLORS } from "./model.js";
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (typeof v === "function") {
            node.addEventListener(k.replace(/^on/, ""), v);
        }
        else if (k === "class") {
            node.className = String(v);
        }
        else if (typeof v === "boolean") {
            if (v)
                node.setAttribute(k, "");
        }
        else {
            node.setAttribute(k, String(v));
        }
    }
    for (const c of children) {
        if (c === null || c === undefined)
            continue;
        node.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return node;
}
export function clear(node) {
    while (node.firstChild)
        node.removeChild(node.firstChild);
}
let toastTimer = null;
export function toast(msg, ms = 3200) {
    let t = document.getElementById("toast");
    if (!t) {
        t = el("div", { id: "toast" });
        document.body.append(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer)
        clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
/** Full-screen overlay; returns a close function. */
export function overlay(...children) {
    const root = el("div", { class: "overlay" }, ...children);
    document.body.append(root);
    return { root, close: () => root.remove() };
}
export function typeBadge(t) {
    const b = el("span", { class: "type-badge" }, t);
    b.style.background = TYPE_COLORS[t];
    return b;
}
export function jpegBlob(bytes) {
    const copy = new Uint8Array(bytes); // detach from any larger buffer
    return new Blob([copy.buffer], { type: "image/jpeg" });
}
export function jpegUrl(bytes) {
    const blob = bytes instanceof Uint8Array ? jpegBlob(bytes) : new Blob([bytes], { type: "image/jpeg" });
    return URL.createObjectURL(blob);
}
export function fmtKm(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}
export function statBar(label, value, max = 150) {
    const fill = el("div", { class: "stat-fill" });
    fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
    fill.style.background = value >= 100 ? "#4caf50" : value >= 60 ? "#f5c518" : "#f2662d";
    return el("div", { class: "stat-row" }, el("span", { class: "stat-label" }, label), el("span", { class: "stat-val" }, String(value)), el("div", { class: "stat-bar" }, fill));
}
export function busyOverlay(title) {
    const status = el("div", { class: "busy-status" }, "…");
    const { close } = overlay(el("div", { class: "busy-box" }, el("div", { class: "busy-ball" }), el("h2", {}, title), status));
    return { setStatus: (s) => (status.textContent = s), close };
}
export function confirmDialog(question, action) {
    return new Promise((resolve) => {
        const { close } = overlay(el("div", { class: "dialog" }, el("p", {}, question), el("div", { class: "dialog-buttons" }, el("button", { class: "btn", onclick: () => { close(); resolve(false); } }, "Cancel"), el("button", { class: "btn danger", onclick: () => { close(); resolve(true); } }, action))));
    });
}
