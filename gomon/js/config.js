// Where the optional GoMon API server lives. Empty (default) = same origin,
// which is right when the Node server serves the app. When the app is
// deployed as pure static files (e.g. GitHub Pages or a university homepage),
// point this at a GoMon server elsewhere — or leave it unset and the game
// simply skips DB sync and link codes (everything else works, since OpenAI
// and lobbylink are contacted directly).
const KEY = "gomon.api.server";
export function apiBase() {
    return (localStorage.getItem(KEY) ?? "").replace(/\/+$/, "");
}
export function setApiBase(url) {
    const v = url.trim().replace(/\/+$/, "");
    if (v)
        localStorage.setItem(KEY, v);
    else
        localStorage.removeItem(KEY);
}
/** Build an API URL: apiUrl("api/monsters") — relative when no base is set. */
export function apiUrl(path) {
    const base = apiBase();
    return base ? `${base}/${path}` : path;
}
