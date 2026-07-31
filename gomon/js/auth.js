// OpenAI credential handling. Three ways to get a token onto the phone,
// because typing a 160-character key on mobile is misery:
//
//  1. Link code — open /link.html on a desktop, paste the key there, get a
//     short one-time code, type just the code on the phone. The key passes
//     through the GoMon server in memory only (TTL few minutes, single read).
//  2. OAuth 2.0 Authorization Code + PKCE — a full standards-compliant flow,
//     enabled when the server's /api/oauth config points at a provider.
//     OpenAI does not currently offer public end-user OAuth for API access,
//     so out of the box this stays disabled; point it at your own
//     OAuth-fronted proxy if you run one.
//  3. Manual paste, as a fallback.
//
// The token is stored locally (localStorage) and used directly from the
// device for all OpenAI calls; it is never written to the game database.
import { apiUrl } from "./config.js";
const TOKEN_KEY = "gomon.openai.token";
const VERIFIER_KEY = "gomon.oauth.verifier";
const STATE_KEY = "gomon.oauth.state";
export function getStoredToken() {
    try {
        const raw = localStorage.getItem(TOKEN_KEY);
        if (!raw)
            return null;
        const t = JSON.parse(raw);
        return typeof t.token === "string" && t.token ? t : null;
    }
    catch {
        return null;
    }
}
export function getToken() {
    return getStoredToken()?.token ?? null;
}
export function setApiKey(key) {
    const token = { kind: "api-key", token: key.trim() };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}
// --- link-code handoff ------------------------------------------------------
export async function claimLinkCode(code) {
    const res = await fetch(apiUrl(`api/link/${encodeURIComponent(code.trim().toUpperCase())}`));
    if (res.status === 404)
        throw new Error("Code not found or already used — codes are one-time and expire fast.");
    if (!res.ok)
        throw new Error(`Link failed (${res.status})`);
    const body = (await res.json());
    if (!body.secret)
        throw new Error("Malformed link response");
    setApiKey(body.secret);
}
export async function fetchOAuthConfig() {
    try {
        const res = await fetch(apiUrl("api/oauth"));
        if (!res.ok)
            return { enabled: false };
        return (await res.json());
    }
    catch {
        return { enabled: false };
    }
}
function b64url(bytes) {
    let s = "";
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Redirect to the provider's authorize endpoint (PKCE S256). */
export async function startOAuth(cfg) {
    if (!cfg.enabled || !cfg.authorizeUrl || !cfg.clientId)
        throw new Error("OAuth is not configured on this server");
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const redirect = new URL(location.pathname, location.href).toString();
    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    if (cfg.scopes)
        url.searchParams.set("scope", cfg.scopes);
    location.assign(url.toString());
}
/**
 * Handle a ?code=...&state=... redirect if present. Returns true when a
 * token was obtained (caller should refresh its auth UI).
 */
export async function completeOAuthIfCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state)
        return false;
    const wantState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    history.replaceState(null, "", location.pathname); // scrub query
    if (!wantState || state !== wantState || !verifier)
        return false;
    const cfg = await fetchOAuthConfig();
    if (!cfg.enabled || !cfg.tokenUrl || !cfg.clientId)
        return false;
    const redirect = new URL(location.pathname, location.href).toString();
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: cfg.clientId,
        code_verifier: verifier,
    });
    const res = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!res.ok)
        throw new Error(`OAuth token exchange failed (${res.status})`);
    const tok = (await res.json());
    if (!tok.access_token)
        throw new Error("OAuth token response missing access_token");
    const stored = {
        kind: "oauth",
        token: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
    return true;
}
/** Handle ?link=CODE deep links (from the desktop link page's QR-ish URL). */
export async function claimDeepLinkIfPresent() {
    const params = new URLSearchParams(location.search);
    const code = params.get("link");
    if (!code)
        return false;
    history.replaceState(null, "", location.pathname);
    await claimLinkCode(code);
    return true;
}
