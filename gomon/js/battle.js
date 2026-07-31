// Turn-based battle engine. Fully deterministic given (seed, both monster
// metas, move choices), so two lobbylink peers exchange only move indices
// each turn and resolve the whole battle identically on both phones.
import { movesFor, mulberry32, statsAt, typeEffect } from "./model.js";
function makeCombatant(meta) {
    const stats = statsAt(meta.baseStats, meta.level);
    return { meta, moves: movesFor(meta), stats, maxHp: stats.hp, hp: stats.hp };
}
export class Battle {
    sides;
    rng;
    _winner = null;
    /** Both peers must construct with the same seed and the same side order. */
    constructor(a, b, seed) {
        this.sides = [makeCombatant(a), makeCombatant(b)];
        this.rng = mulberry32(seed);
    }
    get over() {
        return this._winner !== null;
    }
    get winner() {
        return this._winner;
    }
    /** Resolve one full turn given both sides' chosen move indices. */
    resolveTurn(moveA, moveB) {
        if (this.over)
            return [];
        const choices = [moveA, moveB];
        const events = [];
        const order = this.turnOrder();
        for (const actor of order) {
            if (this.over)
                break;
            const defender = (1 - actor);
            const ev = this.act(actor, defender, choices[actor]);
            events.push(ev);
            if (ev.ko)
                this._winner = actor;
        }
        return events;
    }
    turnOrder() {
        const [a, b] = this.sides;
        if (a.stats.spe !== b.stats.spe)
            return a.stats.spe > b.stats.spe ? [0, 1] : [1, 0];
        return this.rng() < 0.5 ? [0, 1] : [1, 0];
    }
    act(actorIdx, defenderIdx, moveIdx) {
        const actor = this.sides[actorIdx];
        const defender = this.sides[defenderIdx];
        const move = actor.moves[Math.max(0, Math.min(actor.moves.length - 1, Math.floor(moveIdx)))];
        const hit = this.rng() < move.acc;
        if (!hit) {
            return {
                actor: actorIdx, moveName: move.name, hit: false, crit: false,
                effect: 1, damage: 0, targetHpAfter: defender.hp, ko: false,
            };
        }
        const crit = this.rng() < 1 / 16;
        const effect = typeEffect(move.type, defender.meta.types);
        const stab = actor.meta.types.includes(move.type) ? 1.5 : 1;
        const atk = move.kind === "physical" ? actor.stats.atk : actor.stats.spa;
        const def = move.kind === "physical" ? defender.stats.def : defender.stats.spd;
        const level = actor.meta.level;
        const baseDmg = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * move.power * atk) / def) / 50) + 2;
        const variance = 0.85 + this.rng() * 0.15;
        const damage = Math.max(effect === 0 ? 0 : 1, Math.floor(baseDmg * effect * stab * (crit ? 1.5 : 1) * variance));
        defender.hp = Math.max(0, defender.hp - (effect === 0 ? 0 : damage));
        return {
            actor: actorIdx, moveName: move.name, hit: true, crit,
            effect, damage: effect === 0 ? 0 : damage, targetHpAfter: defender.hp, ko: defender.hp <= 0,
        };
    }
}
/** Simple deterministic move choice for practice battles (no RNG). */
export function pickAiMove(battle, side) {
    const actor = battle.sides[side];
    const defender = battle.sides[(1 - side)];
    let best = 0;
    let bestScore = -1;
    actor.moves.forEach((m, i) => {
        const stab = actor.meta.types.includes(m.type) ? 1.5 : 1;
        const atk = m.kind === "physical" ? actor.stats.atk : actor.stats.spa;
        const def = m.kind === "physical" ? defender.stats.def : defender.stats.spd;
        const score = m.power * m.acc * stab * typeEffect(m.type, defender.meta.types) * (atk / def);
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}
export function effectPhrase(effect) {
    if (effect === 0)
        return "It had no effect!";
    if (effect >= 2)
        return "It's super effective!";
    if (effect < 1)
        return "It's not very effective…";
    return "";
}
