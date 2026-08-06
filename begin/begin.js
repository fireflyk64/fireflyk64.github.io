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
function lineReader(onLine) {
  let buf = "";
  getInputBuf = () => buf;
  const history = [];
  let hist = -1;
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

async function startLocal(quick) {
  makeTerm();
  term.write("\x1b[90mLoading engine...\x1b[0m\r\n");
  const resp = await fetch("begin_web.wasm");
  const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), {});
  const e = instance.exports;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const result = () => {
    const p = e.begin_result_ptr(), l = e.begin_result_len();
    return JSON.parse(dec.decode(new Uint8Array(e.memory.buffer, p, l)));
  };
  const feed = (line) => {
    const b = enc.encode(line);
    const p = e.begin_alloc(b.length || 1);
    new Uint8Array(e.memory.buffer, p, b.length).set(b);
    e.begin_feed(p, b.length);
    e.begin_dealloc(p, b.length || 1);
    return result();
  };

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
  lineReader((line) => emit(feed(line)));
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

  lineReader(async (line) => {
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

// ================= menu wiring =================

const params = new URLSearchParams(location.search);
if (params.get("server")) document.getElementById("server").value = params.get("server");

document.getElementById("single").onclick = () => startLocal(false);
document.getElementById("quick").onclick = () => startLocal(true);
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
