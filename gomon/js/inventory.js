// Walking-reward inventory: a single held item slot (GoBall or TM) plus a
// banked-overflow meter. Pure state machine (no imports, no I/O) so the
// tracker drives it and tests exercise it directly.
//
// Design goal: reward looking around, not staring at the screen. While your
// item slot is empty, every credited meter fills the progress meter; at
// ITEM_METERS you're handed a GoBall (catch something nearby) or a TM
// (photograph something to mint a new move). While you're *holding* an
// unused item, walking still banks progress toward the next one — but only
// up to a cap rolled randomly between 50% and 80% of a full meter. Past the
// cap, meters are wasted. So the optimal cadence is "check the phone every
// km or so, then look back up": you never need to watch it, but hoarding
// with your head down costs you.
export const ITEM_METERS = 500;
export const OVERFLOW_MIN = 0.5;
export const OVERFLOW_MAX = 0.8;
/** Chance a completed meter yields a GoBall (else a TM). */
export const BALL_CHANCE = 0.65;
export function initialInv() {
    return { held: null, progressM: 0, bankedM: 0, overflowCapM: ITEM_METERS * OVERFLOW_MAX };
}
export function rollOverflowCap(rand = Math.random) {
    return Math.round(ITEM_METERS * (OVERFLOW_MIN + rand() * (OVERFLOW_MAX - OVERFLOW_MIN)));
}
export function rollItemKind(rand = Math.random, canUseTm = true) {
    return canUseTm && rand() >= BALL_CHANCE ? "tm" : "ball";
}
/**
 * Credit walked meters. `rollKind`/`rollCap` are injected so callers control
 * randomness (and tests are deterministic).
 */
export function creditInv(s, meters, rollKind, rollCap) {
    let d = Math.max(0, meters);
    const state = { ...s };
    let awarded;
    let wastedM = 0;
    if (state.held === null) {
        state.progressM += d;
        if (state.progressM >= ITEM_METERS) {
            const leftover = state.progressM - ITEM_METERS;
            awarded = rollKind();
            state.held = awarded;
            state.progressM = 0;
            state.overflowCapM = rollCap();
            // leftover from the awarding stride flows into the bank
            state.bankedM = Math.min(leftover, state.overflowCapM);
            wastedM = leftover - state.bankedM;
        }
    }
    else {
        const room = Math.max(0, state.overflowCapM - state.bankedM);
        const add = Math.min(d, room);
        state.bankedM += add;
        wastedM = d - add;
    }
    return { state, awarded, wastedM };
}
/** Consume the held item; banked progress rolls into the next meter. */
export function useHeld(s) {
    if (s.held === null)
        return s;
    return { held: null, progressM: s.bankedM, bankedM: 0, overflowCapM: s.overflowCapM };
}
/** Put an item back (e.g. generation failed). Falls back to progress credit
 * if the slot has been refilled in the meantime. */
export function refundHeld(s, kind) {
    if (s.held === null) {
        return { ...s, held: kind };
    }
    // slot occupied again — bank a full meter's worth instead (may waste some)
    return { ...s, bankedM: Math.min(s.overflowCapM, s.bankedM + ITEM_METERS) };
}
