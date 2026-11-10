// Two-player GoMon sessions (battle / breed / trade) over lobbylink WebRTC
// DataChannels. The vendored lobbylink client (lobbylink.ts) handles rooms,
// signaling, NAT traversal and reliable chunked transfer; this module speaks
// the GoMon session protocol on top of it:
//
//   hello   {t, trainer, trainerId, mode}     both sides, on join
//   mon     {t, meta, jpegB64}                the monster each side brings
//   seed    {t, seed}                         battle only, host → guest
//   move    {t, turn, idx}                    battle, each turn, both ways
//   confirm {t}                               trade only, both ways
//   bye     {t}                               polite hangup
//
// Monster JPEGs ride inside the JSON as base64 — reliable messages may be up
// to 16 MiB, far above any sprite. Battles resolve deterministically on both
// phones from the shared seed (see battle.ts), so no referee is needed.
import { P2PGame, LobbyError } from "./lobbylink.js";
import { normalizeMeta } from "./model.js";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomRoomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    let code = "";
    for (const b of bytes)
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return code;
}
function bytesToB64(bytes) {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
export class MonSession {
    game;
    events;
    saidHello = false;
    closed = false;
    code;
    mode;
    constructor(game, code, mode, events) {
        this.game = game;
        this.code = code;
        this.mode = mode;
        this.events = events;
        game.onEvent((ev) => this.handle(ev));
    }
    get selfId() {
        return this.game.selfId;
    }
    /** Host is player 0 — the side that generates the battle seed. */
    get isHost() {
        return this.game.selfId === 0;
    }
    get peerId() {
        return this.game.selfId === 0 ? 1 : 0;
    }
    static async join(server, code, mode, create, events) {
        const game = await P2PGame.connect({
            server,
            code: `GOMON-${code}`,
            create: create ? { maxPlayers: 2, allowLateJoin: true, allowReconnect: true } : undefined,
            storageKey: `gomon-room-${code}`,
            storage: "session",
        });
        return new MonSession(game, code, mode, events);
    }
    handle(ev) {
        switch (ev.type) {
            case "message": {
                if (ev.kind !== "reliable")
                    return;
                try {
                    this.dispatch(JSON.parse(new TextDecoder().decode(ev.data)));
                }
                catch {
                    this.events.onError?.("Garbled message from peer");
                }
                return;
            }
            case "peer-state":
                if (ev.state === "connected") {
                    this.events.onStatus?.("Peer connected");
                    void this.resendHello();
                }
                return;
            case "player-joined":
                this.events.onStatus?.("A challenger appears…");
                return;
            case "player-left":
                this.events.onPeerLeft?.();
                return;
            case "signaling-closed":
                if (ev.code === "replaced" || ev.code === "session-superseded" || ev.code === "room-expired") {
                    this.events.onError?.(`Session ended: ${ev.code}`);
                }
                return;
            case "lobby-error":
                this.events.onError?.(ev.message);
                return;
            default:
                return;
        }
    }
    dispatch(msg) {
        switch (msg["t"]) {
            case "hello":
                this.events.onPeerHello?.(String(msg["trainer"] ?? "???"), msg["mode"]);
                return;
            case "mon": {
                const meta = normalizeMeta(msg["meta"]);
                const b64 = msg["jpegB64"];
                if (!meta || typeof b64 !== "string") {
                    this.events.onError?.("Peer sent an invalid monster");
                    return;
                }
                this.events.onPeerMon?.({ meta, jpeg: b64ToBytes(b64) });
                return;
            }
            case "seed":
                if (typeof msg["seed"] === "number")
                    this.events.onSeed?.(msg["seed"]);
                return;
            case "move":
                if (typeof msg["turn"] === "number" && typeof msg["idx"] === "number") {
                    this.events.onMove?.(msg["turn"], msg["idx"]);
                }
                return;
            case "confirm":
                this.events.onConfirm?.();
                return;
            case "bye":
                this.events.onPeerLeft?.();
                return;
            default:
                return;
        }
    }
    async send(payload) {
        if (this.closed)
            return;
        try {
            await this.game.sendReliable(this.peerId, new TextEncoder().encode(JSON.stringify(payload)));
        }
        catch (err) {
            if (err instanceof LobbyError && err.code === "invalid-target") {
                // peer not seated yet — hello will be resent on peer-state connected
                return;
            }
            this.events.onError?.(err instanceof Error ? err.message : String(err));
        }
    }
    hello = null;
    async sendHello(trainer, trainerId) {
        this.hello = { trainer, trainerId };
        this.saidHello = true;
        await this.send({ v: 1, t: "hello", trainer, trainerId, mode: this.mode });
    }
    async resendHello() {
        if (this.saidHello && this.hello) {
            await this.send({ v: 1, t: "hello", ...this.hello, mode: this.mode });
        }
    }
    async sendMon(meta, jpeg) {
        await this.send({ v: 1, t: "mon", meta, jpegB64: bytesToB64(jpeg) });
    }
    async sendSeed(seed) {
        await this.send({ v: 1, t: "seed", seed });
    }
    async sendMove(turn, idx) {
        await this.send({ v: 1, t: "move", turn, idx });
    }
    async sendConfirm() {
        await this.send({ v: 1, t: "confirm" });
    }
    close() {
        if (this.closed)
            return;
        void this.send({ v: 1, t: "bye" }).finally(() => {
            this.closed = true;
            this.game.close();
        });
    }
}
