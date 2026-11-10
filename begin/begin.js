// BEGIN in the browser.
//
// Single player: the identical Rust engine (begin-core + begin::session)
// compiled to wasm — transcript-identical to the native console.
// Multiplayer: join a console host over lobbylink (WebRTC DataChannels);
// this page is a dumb terminal for the frames the host renders, exactly
// like `begin join <code>` (crates/begin/src/net.rs run_client).

import { Terminal } from "./vendor/xterm.mjs";

const menu = document.getElementById("menu");
const termDiv = document.getElementById("term");

let term = null;
function makeTerm() {
  term = new Terminal({
    cols: 80,
    rows: 25,
    convertEol: true, // session frames use bare \n like the console
    cursorBlink: true,
    fontFamily: '"DejaVu Sans Mono", Menlo, Consolas, monospace',
    fontSize: 16,
    theme: { background: "#000000", foreground: "#bbffbb", cursor: "#33ff33" },
  });
  menu.classList.add("off");
  termDiv.classList.add("on");
  term.open(termDiv);
  window.__term = term; // test hook
  installReader();
  fitFont();
  window.addEventListener("resize", fitFont);
  term.focus();
  return term;
}

// keep 80 columns on screen by shrinking the font on small windows
function fitFont() {
  const cell = termDiv.clientWidth / 81;
  const size = Math.max(8, Math.min(18, Math.floor(cell * 1.9)));
  term.options.fontSize = size;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ANSI text-blink emulation ----
// xterm.js parses SGR 5 but never animates it; the console relies on the
// terminal emulator to blink. We re-render the last full frame on a timer,
// blanking blink spans on the off phase — torpedo streaks, destruct
// countdowns and blast asterisks flash just like the native console.
const hasBlink = (s) => /\x1b\[(?:[0-9;]*;)?5(?:;[0-9;]*)?m/.test(s);
function blinkOff(s) {
  let out = "", blink = false;
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      let j = i + 2;
      while (j < s.length && !/[a-zA-Z]/.test(s[j])) j++;
      if (s[j] === "m") {
        const params = s.slice(i + 2, j).split(";").filter((x) => x !== "");
        if (params.length === 0 || params.includes("0")) blink = false;
        if (params.includes("5")) blink = true;
        if (params.includes("25")) blink = false;
      }
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (blink && s[i] >= " ") {
      out += " ";
      i++;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}
let blinkTimer = null;
let getInputBuf = () => "";
function showFrame(ansi) {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  term.write(ansi);
  if (hasBlink(ansi)) {
    const off = blinkOff(ansi);
    let phase = false;
    blinkTimer = setInterval(() => {
      phase = !phase;
      term.write((phase ? off : ansi) + getInputBuf());
    }, 400);
  }
}
function stopBlink() {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
}

// ---- a tiny readline: local echo, backspace, history ----
let onLineCb = null;
function setLineHandler(fn) {
  onLineCb = fn;
}
function installReader() {
  let buf = "";
  getInputBuf = () => buf;
  const history = [];
  let hist = -1;
  const onLine = (l) => onLineCb && onLineCb(l);
  term.onData((data) => {
    for (const ch of data) {
      if (ch === "\r") {
        term.write("\r\n");
        history.unshift(buf);
        if (history.length > 100) history.pop();
        hist = -1;
        const line = buf;
        buf = "";
        onLine(line);
      } else if (ch === "\x7f" || ch === "\b") {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          term.write("\b \b");
        }
      } else if (ch === "\x1b") {
        // swallow escape sequences (arrows come as \x1b[A etc.)
        continue;
      } else if (ch === "[" && buf === "" && data.startsWith("\x1b")) {
        continue;
      } else if (data === "\x1b[A" || data === "\x1b[B") {
        // history up/down (whole-sequence case)
        break;
      } else if (ch >= " ") {
        buf += ch;
        term.write(ch);
      }
    }
    // arrow-key history (data arrives as one sequence)
    if (data === "\x1b[A" || data === "\x1b[B") {
      if (data === "\x1b[A") hist = Math.min(hist + 1, history.length - 1);
      else hist = Math.max(hist - 1, -1);
      term.write("\b \b".repeat(buf.length));
      buf = hist >= 0 ? history[hist] : "";
      term.write(buf);
    }
  });
}

// ================= single player (wasm) =================

let engine = null;
async function loadEngine() {
  if (engine) return engine;
  const resp = await fetch("begin_web.wasm");
  const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), {});
  const e = instance.exports;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const result = () => {
    const p = e.begin_result_ptr(), l = e.begin_result_len();
    return JSON.parse(dec.decode(new Uint8Array(e.memory.buffer, p, l)));
  };
  // call an export that takes (ptr, len) with a UTF-8 string, return output
  const withStr = (fn, line, ...pre) => {
    const b = enc.encode(line);
    const p = e.begin_alloc(b.length || 1);
    new Uint8Array(e.memory.buffer, p, b.length).set(b);
    fn(...pre, p, b.length);
    e.begin_dealloc(p, b.length || 1);
    return result();
  };
  engine = { e, result, withStr };
  return engine;
}

async function startLocal(quick) {
  makeTerm();
  term.write("\x1b[90mLoading engine...\x1b[0m\r\n");
  const { e, result, withStr } = await loadEngine();
  const feed = (line) => withStr(e.begin_feed, line);

  // sequential output queue so Hold delays don't interleave
  let chain = Promise.resolve();
  const emit = (items) =>
    (chain = chain.then(async () => {
      for (const it of items) {
        if (it.k === "frame") showFrame(it.ansi);
        else if (it.k === "text") { stopBlink(); term.write(it.t + "\r\n"); }
        else if (it.k === "prompt") term.write(it.t);
        else if (it.k === "hold") await sleep(it.ms);
        else if (it.k === "done") {
          stopBlink();
          term.write(
            "\r\n\x1b[90mSimulation ended — reload the page to play again.\x1b[0m\r\n"
          );
        }
      }
    }));

  const seed = (Math.random() * 0xffffffff) >>> 0;
  e.begin_new(seed, 0, quick ? 1 : 0, 0, 0, 0);
  emit(result());
  setLineHandler((line) => emit(feed(line)));
}

// ================= join a console host =================

async function startJoin(code, server) {
  makeTerm();
  const grey = (t) => term.write(`\x1b[90m${t}\x1b[0m\r\n`);
  grey(`Joining room ${code} on ${server}...`);
  let game;
  try {
    const { P2PGame } = await import("./vendor/p2p-client.js");
    game = await P2PGame.connect({
      server,
      code,
      storage: "session",
      storageKey: `begin-${code}`,
    });
  } catch (err) {
    term.write(`\x1b[91mCould not join: ${err.message || err}\x1b[0m\r\n`);
    return;
  }
  grey(`Connected as player ${game.selfId}. Waiting for the host to start...`);

  // the host is the lowest-numbered occupied seat that isn't us
  const hostOf = () =>
    game.players
      .filter((p) => p.occupied && p.id !== game.selfId)
      .map((p) => p.id)
      .reduce((a, b) => Math.min(a, b), Infinity);

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let chain = Promise.resolve();
  let over = false;

  game.onEvent((ev) => {
    if (ev.type === "message" && ev.kind === "reliable") {
      let v;
      try {
        v = JSON.parse(dec.decode(ev.data));
      } catch {
        return;
      }
      chain = chain.then(async () => {
        if (v.t === "frame") {
          showFrame(v.data || "");
          if (v.flash) await sleep(140); // hold the flash frame briefly
        } else if (v.t === "info") {
          grey(v.text || "");
        } else if (v.t === "over") {
          stopBlink();
          term.write(`\r\n\x1b[92m${v.text || ""}\x1b[0m\r\n`);
          over = true;
          game.close();
          grey("Game over — reload the page to play again.");
        }
      });
    } else if (ev.type === "player-left" && ev.playerId === hostOf() && !over) {
      chain = chain.then(() => grey("The host has left."));
    }
  });

  setLineHandler(async (line) => {
    if (over) return;
    const payload = enc.encode(JSON.stringify({ t: "line", text: line }));
    try {
      await game.sendReliable(hostOf(), payload);
    } catch {
      grey("Lost the host.");
      over = true;
    }
    if (line.trim().toLowerCase() === "quit") {
      over = true;
      game.close();
      grey("Left the game — reload the page to play again.");
    }
  });
}


// ================= host a room from the browser =================

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () =>
  Array.from({ length: 5 }, () => CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]).join("");

async function startHost(players, quick, server) {
  makeTerm();
  const grey = (t) => term.write(`\x1b[90m${t}\x1b[0m\r\n`);
  term.write("\x1b[90mLoading engine...\x1b[0m\r\n");
  const { e, result, withStr } = await loadEngine();
  const seed = (Math.random() * 0xffffffff) >>> 0;

  // --- pregame: the same setup dialogue as the console host ---
  if (!quick) {
    const done = await new Promise((resolve) => {
      const show = (items) => {
        for (const it of items) {
          if (it.k === "text") term.write(it.t + "\r\n");
          else if (it.k === "prompt") term.write(it.t);
          else if (it.k === "go") return resolve(true);
          else if (it.k === "quit") return resolve(false);
        }
      };
      e.setup_new(seed, 0);
      show(result());
      setLineHandler((line) => show(withStr(e.setup_feed, line)));
    });
    setLineHandler(null);
    if (!done) {
      grey("Setup cancelled — reload the page to start over.");
      return;
    }
  }

  // --- open the room and wait for everyone ---
  const code = makeCode();
  let game;
  try {
    const { P2PGame } = await import("./vendor/p2p-client.js");
    grey(`Creating room ${code} on ${server} for ${players} players...`);
    game = await P2PGame.connect({
      server,
      code,
      create: { maxPlayers: players, waitUntilFull: true, allowReconnect: true },
      storage: "session",
      storageKey: `begin-host-${code}`,
    });
  } catch (err) {
    term.write(`\x1b[91mCould not create the room: ${err.message || err}\x1b[0m\r\n`);
    return;
  }
  term.write(`\x1b[97mRoom code: ${code}\x1b[0m  (console players: begin join ${code}` +
    (server === "https://pqrstuvw.xyz/lobbylink" ? "" : ` --server ${server}`) +
    `; browser players use Join room)\r\n`);

  const occupiedOthers = () =>
    game.players.filter((p) => p.occupied && p.id !== game.selfId).map((p) => p.id);

  await new Promise((resolve) => {
    if (occupiedOthers().length >= players - 1) return resolve();
    game.onEvent((ev) => {
      if (ev.type === "player-joined") {
        grey(`Player ${ev.playerId} has joined.`);
        if (occupiedOthers().length >= players - 1) resolve();
      }
      if (ev.type === "started") resolve();
    });
  });
  grey("All hands aboard. Spawning fleets...");

  // seat map: sorted player ids <-> seats 1..N (same rule as the console)
  const pids = occupiedOthers().sort((a, b) => a - b);
  const names = pids.map((p) => `Player ${p}`);
  const seatOf = (pid) => pids.indexOf(pid) + 1;
  const enc = new TextEncoder();

  // --- route HostCore output: seat 0 locally, the rest over the wire ---
  let chain = Promise.resolve();
  let ended = false;
  const route = (items) =>
    (chain = chain.then(async () => {
      for (const it of items) {
        if (it.t === "hold") {
          await sleep(it.ms);
        } else if (it.t === "ended") {
          ended = true;
          setTimeout(() => game.close(), 800);
          stopBlink2();
          term.write("\r\n\x1b[90mGame over — reload the page to play again.\x1b[0m\r\n");
        } else if (it.t === "error") {
          term.write(`\x1b[91m${it.text}\x1b[0m\r\n`);
        } else if (it.seat === 0) {
          if (it.t === "frame") showFrame(it.data);
          else if (it.t === "info") grey(it.text);
          else if (it.t === "over") {
            stopBlink();
            term.write(`\r\n${it.text}\r\n`);
          }
        } else {
          const pid = pids[it.seat - 1];
          const wire =
            it.t === "frame"
              ? it.flash
                ? { t: "frame", data: it.data, flash: true }
                : { t: "frame", data: it.data }
              : it.t === "info"
                ? { t: "info", text: it.text }
                : { t: "over", text: it.text };
          try {
            await game.sendReliable(pid, enc.encode(JSON.stringify(wire)));
          } catch {}
        }
      }
    }));
  // "ended" writes its notice after the seat-0 Over that precedes it;
  // stopBlink2 is just stopBlink named apart to keep the order readable
  const stopBlink2 = stopBlink;

  const hostStart = () => {
    const b = enc.encode(JSON.stringify(names));
    const p = e.begin_alloc(b.length || 1);
    new Uint8Array(e.memory.buffer, p, b.length).set(b);
    const rc = e.host_start(seed, 0, quick ? 1 : 0, 0, 1, p, b.length);
    e.begin_dealloc(p, b.length || 1);
    return rc;
  };
  if (hostStart() !== 0) {
    route(result());
    return;
  }
  route(result());

  const dec = new TextDecoder();
  game.onEvent((ev) => {
    if (ended) return;
    if (ev.type === "message" && ev.kind === "reliable") {
      let v;
      try {
        v = JSON.parse(dec.decode(ev.data));
      } catch {
        return;
      }
      if (v.t === "line") {
        route(withStr((pp, ll) => e.host_line(seatOf(ev.from), pp, ll), v.text || ""));
      }
    } else if (ev.type === "player-left" && seatOf(ev.playerId) > 0) {
      e.host_disconnect(seatOf(ev.playerId));
      route(result());
    } else if (ev.type === "player-rejoined" && seatOf(ev.playerId) > 0) {
      e.host_reconnect(seatOf(ev.playerId));
      route(result());
    }
  });

  setLineHandler((line) => {
    if (ended) return;
    route(withStr((pp, ll) => e.host_line(0, pp, ll), line));
  });
}

// ================= menu wiring =================

const params = new URLSearchParams(location.search);
if (params.get("server")) document.getElementById("server").value = params.get("server");

document.getElementById("single").onclick = () => startLocal(false);
document.getElementById("quick").onclick = () => startLocal(true);
document.getElementById("host").onclick = () => {
  const players = parseInt(document.getElementById("players").value, 10) || 2;
  const quick = document.getElementById("hostquick").checked;
  const server = document.getElementById("server").value.trim();
  startHost(players, quick, server);
};
document.getElementById("join").onclick = () => {
  const code = document.getElementById("code").value.trim().toUpperCase();
  const server = document.getElementById("server").value.trim();
  if (code) startJoin(code, server);
};
document.getElementById("code").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("join").onclick();
});
// deep link: ?join=CODE
if (params.get("join")) startJoin(params.get("join").toUpperCase(), document.getElementById("server").value);
