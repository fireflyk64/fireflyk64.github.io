// Lobby screen: pick a monster, then battle, breed, or trade with a friend
// over lobbylink (WebRTC), or run a practice battle locally. Room codes are
// short and shareable ("meet me in GOMON-KWX42").
import { Battle, effectPhrase, pickAiMove } from "./battle.js";
import * as db from "./db.js";
import { awardXp, getBuddy, importJpeg, makeEgg, releaseMonster } from "./game.js";
import { MonSession, randomRoomCode } from "./lobby.js";
import { movesFor, xpForWin } from "./model.js";
import { clear, confirmDialog, el, jpegUrl, overlay, toast, typeBadge } from "./ui.js";
export function lobbyServerUrl() {
    return localStorage.getItem("gomon.lobby.server") ?? `${location.protocol}//${location.hostname}:8787`;
}
export async function renderLobby(root, rerender) {
    clear(root);
    const ctx = { rerender };
    const monsters = await db.allMonsters();
    const buddy = await getBuddy();
    let selected = buddy ?? monsters[0];
    if (!monsters.length) {
        root.append(el("h2", {}, "Lobby"), el("p", { class: "muted center" }, "Catch a monster first — then come battle, breed and trade."));
        return;
    }
    // --- monster picker
    const pickerImg = el("img", { class: "picker-img" });
    const pickerName = el("div", { class: "picker-name" });
    function setSelected(rec) {
        selected = rec;
        pickerImg.src = jpegUrl(rec.jpeg);
        pickerName.textContent = `${rec.meta.name} · Lv ${rec.meta.level}`;
    }
    if (selected)
        setSelected(selected);
    const pickBtn = el("button", { class: "btn ghost" }, "change");
    pickBtn.onclick = () => {
        const ov = overlay(el("div", { class: "dialog picker-list" }, el("h3", {}, "Choose your monster"), ...monsters.map((m) => el("div", { class: "picker-row", onclick: () => { setSelected(m); ov.close(); } }, el("img", { src: jpegUrl(m.jpeg), alt: m.meta.name }), el("span", {}, `${m.meta.name} · Lv ${m.meta.level}`), ...m.meta.types.map(typeBadge))), el("button", { class: "btn wide", onclick: () => ov.close() }, "Cancel")));
    };
    // --- mode + room controls
    let mode = "battle";
    const modeBtns = ["battle", "breed", "trade"].map((m) => el("button", { class: `btn mode${m === mode ? " active" : ""}`, onclick: (ev) => {
            mode = m;
            for (const b of modeRow.children)
                b.classList.remove("active");
            ev.currentTarget.classList.add("active");
        } }, m));
    const modeRow = el("div", { class: "mode-row" }, ...modeBtns);
    const codeInput = el("input", { class: "input", placeholder: "ROOM CODE", maxlength: "8", autocapitalize: "characters" });
    const status = el("div", { class: "lobby-status" });
    const log = (msg) => {
        status.append(el("div", {}, msg));
        status.scrollTop = status.scrollHeight;
    };
    const hostBtn = el("button", { class: "btn primary" }, "Create room");
    const joinBtn = el("button", { class: "btn" }, "Join");
    hostBtn.onclick = () => { if (selected)
        void runSession(randomRoomCode(), true); };
    joinBtn.onclick = () => {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length < 4) {
            toast("Enter the room code your friend created.");
            return;
        }
        if (selected)
            void runSession(code, false);
    };
    const practiceBtn = el("button", { class: "btn ghost wide" }, "🤖 Practice battle (offline)");
    practiceBtn.onclick = () => {
        if (!selected)
            return;
        const others = monsters.filter((m) => m.uuid !== selected.uuid);
        const foe = others[Math.floor(Math.random() * others.length)] ?? selected;
        runBattleUI(selected, { meta: foe.meta, jpeg: new Uint8Array(foe.jpeg) }, Math.floor(Math.random() * 2 ** 31), true, null, ctx);
    };
    root.append(el("h2", {}, "Lobby"), el("div", { class: "picker" }, pickerImg, pickerName, pickBtn), modeRow, el("div", { class: "room-row" }, hostBtn, codeInput, joinBtn), practiceBtn, status);
    // --- session driving ------------------------------------------------------
    async function runSession(code, isCreator) {
        if (!selected)
            return;
        const mine = selected;
        const trainer = await db.getTrainer();
        let session = null;
        let peerMon = null;
        let peerTrainer = "???";
        let seed = null;
        let started = false;
        let confirmedByMe = false;
        let confirmedByPeer = false;
        let monSent = false;
        const maybeStart = () => {
            if (started || !session || !peerMon)
                return;
            if (mode === "battle") {
                if (session.isHost && seed === null) {
                    seed = Math.floor(Math.random() * 2 ** 31);
                    void session.sendSeed(seed);
                }
                if (seed !== null) {
                    started = true;
                    const hostMon = [mine, peerMon];
                    runBattleUI(hostMon[0], hostMon[1], seed, session.isHost, session, ctx);
                }
            }
            else if (mode === "breed") {
                started = true;
                void makeEgg(mine, peerMon, peerTrainer).then(() => {
                    log(`You received an egg from ${mine.meta.name} × ${peerMon.meta.name}! Walk 1 km to hatch it.`);
                    toast("Egg received! Check the Walk screen.");
                    session?.close();
                });
            }
            else if (mode === "trade") {
                started = true;
                void offerTrade();
            }
        };
        const maybeFinishTrade = async () => {
            if (!confirmedByMe || !confirmedByPeer || !peerMon)
                return;
            await importJpeg(new Uint8Array(peerMon.jpeg));
            await releaseMonster(mine.uuid);
            log(`Trade complete — welcome, ${peerMon.meta.name}!`);
            toast(`Traded ${mine.meta.name} for ${peerMon.meta.name}!`);
            session?.close();
            ctx.rerender();
        };
        async function offerTrade() {
            const ok = await confirmDialog(`Trade your ${mine.meta.name} for ${peerTrainer}'s ${peerMon?.meta.name}? Your monster leaves with them.`, "Trade");
            if (!ok) {
                session?.close();
                log("Trade declined.");
                return;
            }
            confirmedByMe = true;
            await session?.sendConfirm();
            log("Waiting for the other trainer to confirm…");
            void maybeFinishTrade();
        }
        try {
            log(`${isCreator ? "Creating" : "Joining"} room ${code} (${mode})…`);
            session = await MonSession.join(lobbyServerUrl(), code, mode, isCreator, {
                onStatus: log,
                onPeerHello: (name, peerMode) => {
                    peerTrainer = name;
                    log(`${name} is here${peerMode !== mode ? ` — but they picked "${peerMode}", you picked "${mode}"!` : "."}`);
                    if (!monSent) {
                        monSent = true;
                        void session.sendMon(mine.meta, new Uint8Array(mine.jpeg));
                    }
                },
                onPeerMon: (mon) => {
                    peerMon = mon;
                    log(`${peerTrainer} brought ${mon.meta.name} (Lv ${mon.meta.level}).`);
                    maybeStart();
                },
                onSeed: (s) => {
                    seed = s;
                    maybeStart();
                },
                onMove: (turn, idx) => battleMoveHandlers?.(turn, idx),
                onConfirm: () => {
                    confirmedByPeer = true;
                    log(`${peerTrainer} confirmed the trade.`);
                    void maybeFinishTrade();
                },
                onPeerLeft: () => {
                    log("The other trainer left.");
                    battleAbortHandler?.();
                },
                onError: (e) => log(`⚠ ${e}`),
            });
            log(`Connected as ${session.isHost ? "host" : "guest"}. Room code: ${code}`);
            if (isCreator) {
                codeInput.value = code;
                log("Share this code with your friend!");
            }
            await session.sendHello(trainer.name, trainer.id);
        }
        catch (err) {
            log(`⚠ ${err instanceof Error ? err.message : String(err)}`);
            toast("Could not join the lobby — check the lobby server in Settings.");
        }
    }
}
// ---------------------------------------------------------------------------
// Battle UI — short timed turns with next-turn input registration.
//
// Time is sliced into 3.5-second phases. Whatever move you have selected
// when a phase ends is committed as your input for that turn; if you touch
// nothing, your previous selection repeats. The results you're watching are
// always the *previous* turn's — your taps register for the NEXT one, so the
// skill is anticipation, not reaction speed. Both peers commit inputs by
// turn number and resolve in lockstep (a phase's resolution waits until the
// opponent's input for that turn arrives), which also hides network latency.
// ---------------------------------------------------------------------------
const TURN_MS = 3500;
// Registered by runBattleUI so lobby session events reach the battle.
let battleMoveHandlers = null;
let battleAbortHandler = null;
function runBattleUI(mine, peer, seed, iAmHost, session, ctx) {
    // Host is always side 0 so both peers build the identical battle.
    const meMeta = mine.meta;
    const themMeta = peer.meta;
    const sideA = iAmHost ? meMeta : themMeta;
    const sideB = iAmHost ? themMeta : meMeta;
    const battle = new Battle(sideA, sideB, seed);
    const mySide = iAmHost ? 0 : 1;
    const theirSide = iAmHost ? 1 : 0;
    const myMoves = movesFor(meMeta);
    const myUrl = jpegUrl(mine.jpeg);
    const theirUrl = jpegUrl(peer.jpeg);
    // --- input pipeline state
    let phase = 0; // turn currently being committed
    let myChoice = 0; // selected next move (persists = repeat)
    const myInputs = [];
    const theirInputs = new Map();
    let resolvedThrough = -1;
    let finished = false;
    let phaseTimer = null;
    // --- DOM
    const enemyHp = el("div", { class: "hp-fill" });
    const myHp = el("div", { class: "hp-fill" });
    const logBox = el("div", { class: "battle-log" });
    const moveRow = el("div", { class: "move-row" });
    const countFill = el("div", { class: "count-fill" });
    const phaseLabel = el("div", { class: "phase-label" }, "Choose your opening move!");
    const enemyImg = el("img", { src: theirUrl, alt: themMeta.name });
    const myImg = el("img", { src: myUrl, alt: meMeta.name });
    const battleBox = el("div", { class: "battle" }, el("div", { class: "battle-side enemy" }, enemyImg, el("div", { class: "battle-info" }, el("div", { class: "battle-name" }, `${themMeta.name} Lv ${themMeta.level}`), el("div", { class: "badges" }, ...themMeta.types.map(typeBadge)), el("div", { class: "hp-bar" }, enemyHp))), el("div", { class: "battle-side me" }, myImg, el("div", { class: "battle-info" }, el("div", { class: "battle-name" }, `${meMeta.name} Lv ${meMeta.level}`), el("div", { class: "badges" }, ...meMeta.types.map(typeBadge)), el("div", { class: "hp-bar" }, myHp))), el("div", { class: "countdown" }, countFill), phaseLabel, logBox, moveRow);
    const ov = overlay(battleBox);
    const blog = (s) => {
        if (!s)
            return;
        logBox.append(el("div", {}, s));
        logBox.scrollTop = logBox.scrollHeight;
    };
    function refreshHp() {
        const meC = battle.sides[mySide];
        const themC = battle.sides[theirSide];
        myHp.style.width = `${(meC.hp / meC.maxHp) * 100}%`;
        enemyHp.style.width = `${(themC.hp / themC.maxHp) * 100}%`;
        const col = (f) => (f > 0.5 ? "#4caf50" : f > 0.2 ? "#f5c518" : "#e5484d");
        myHp.style.background = col(meC.hp / meC.maxHp);
        enemyHp.style.background = col(themC.hp / themC.maxHp);
    }
    const moveButtons = myMoves.map((m, i) => {
        const b = el("button", { class: "btn move-btn", onclick: () => selectMove(i) }, el("span", { class: "move-name" }, m.name), el("span", { class: "move-meta" }, `${m.type} · ${m.power} · ${Math.round(m.acc * 100)}%`));
        moveRow.append(b);
        return b;
    });
    function selectMove(i) {
        if (finished)
            return;
        myChoice = i;
        moveButtons.forEach((b, j) => b.classList.toggle("sel", j === i));
        if (navigator.vibrate)
            navigator.vibrate(8);
    }
    selectMove(0);
    function startPhase() {
        if (finished)
            return;
        phaseLabel.textContent = phase === 0
            ? "Choose your opening move!"
            : `Turn ${phase + 1} — your pick lands NEXT turn`;
        // restart countdown bar animation
        countFill.style.transition = "none";
        countFill.style.width = "100%";
        void countFill.offsetWidth; // reflow
        countFill.style.transition = `width ${TURN_MS}ms linear`;
        countFill.style.width = "0%";
        phaseTimer = setTimeout(commitPhase, TURN_MS);
    }
    function commitPhase() {
        if (finished)
            return;
        const t = phase;
        myInputs[t] = myChoice;
        blog(`▶ ${meMeta.name} locks in ${myMoves[myChoice].name} for turn ${t + 1}.`);
        if (session) {
            void session.sendMove(t, myChoice);
        }
        else {
            theirInputs.set(t, pickAiMove(battle, theirSide));
        }
        phase++;
        tryResolve();
    }
    battleMoveHandlers = (t, idx) => {
        theirInputs.set(t, idx);
        tryResolve();
    };
    battleAbortHandler = () => {
        if (finished)
            return;
        blog("The opponent fled!");
        endBattle(true, false);
    };
    function tryResolve() {
        while (!battle.over) {
            const t = resolvedThrough + 1;
            if (t >= phase || myInputs[t] === undefined || !theirInputs.has(t))
                break;
            const moveA = mySide === 0 ? myInputs[t] : theirInputs.get(t);
            const moveB = mySide === 0 ? theirInputs.get(t) : myInputs[t];
            const events = battle.resolveTurn(moveA, moveB);
            for (const ev of events) {
                const actorMeta = ev.actor === mySide ? meMeta : themMeta;
                const targetImg = ev.actor === mySide ? enemyImg : myImg;
                if (!ev.hit) {
                    blog(`${actorMeta.name}'s ${ev.moveName} missed!`);
                    continue;
                }
                blog(`${actorMeta.name} used ${ev.moveName}! ${ev.crit ? "Critical hit! " : ""}${effectPhrase(ev.effect)} (-${ev.damage})`);
                targetImg.classList.remove("hit");
                void targetImg.offsetWidth;
                targetImg.classList.add("hit");
                if (ev.crit || ev.effect >= 2) {
                    battleBox.classList.remove("shake");
                    void battleBox.offsetWidth;
                    battleBox.classList.add("shake");
                }
                if (ev.ko)
                    targetImg.classList.add("ko");
                if (ev.damage > 0 && navigator.vibrate)
                    navigator.vibrate(ev.crit ? [30, 40, 30] : 20);
            }
            refreshHp();
            resolvedThrough = t;
        }
        if (battle.over) {
            endBattle(battle.winner === mySide, true);
        }
        else if (resolvedThrough === phase - 1) {
            startPhase();
        }
        else {
            phaseLabel.textContent = "Waiting for the other trainer…";
        }
    }
    function endBattle(iWon, awardXpToWinner) {
        finished = true;
        if (phaseTimer)
            clearTimeout(phaseTimer);
        battleMoveHandlers = null;
        battleAbortHandler = null;
        countFill.style.transition = "none";
        countFill.style.width = "0%";
        phaseLabel.textContent = iWon ? "Victory!" : "Defeat…";
        blog(iWon ? `${themMeta.name} is out — you win!` : `${meMeta.name} fainted — you lose…`);
        for (const b of moveButtons)
            b.disabled = true;
        const done = el("button", { class: "btn primary wide" }, iWon ? "Claim victory!" : "Retreat…");
        done.onclick = async () => {
            if (iWon && awardXpToWinner) {
                const { levelsGained } = await awardXp(mine, xpForWin(themMeta.level));
                toast(levelsGained > 0 ? `${meMeta.name} won and leveled up!` : `${meMeta.name} gained XP!`);
            }
            else if (iWon) {
                toast("The opponent fled — no XP.");
            }
            session?.close();
            ov.close();
            URL.revokeObjectURL(myUrl);
            URL.revokeObjectURL(theirUrl);
            ctx.rerender();
        };
        moveRow.append(done);
    }
    refreshHp();
    blog("Battle start! Short turns — what you tap lands on the NEXT turn.");
    startPhase();
}
