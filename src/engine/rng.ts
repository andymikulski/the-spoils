// -----------------------------------------------------------------------------
// Deterministic RNG
// -----------------------------------------------------------------------------
//
// All game randomness (deck shuffles, coin flips, `{type:"random"}` numeric
// expressions and target selection) draws from a single mulberry32 stream
// whose state lives on `GameState.rngState` — a plain number that travels
// with the rest of the state through structuredClone/JSON/save/share, so:
//   - resuming a saved or shared game continues its random sequence exactly
//     where it left off, and
//   - replaying the same starting seed against the same action log
//     reproduces a game bit-for-bit, for debugging or networking.

/** Current position in the stream. Advances on every draw. */
export type RngState = number;

/** A fresh, unpredictable seed for games that don't need a caller-chosen one. */
export function randomSeed(): RngState {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** mulberry32: small, fast, decent-quality deterministic PRNG. Not cryptographic. */
function step(state: RngState): { value: number; next: RngState } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a >>> 0 };
}

/** Draws the next value from `holder.rngState`, persisting the advanced state back onto it. */
export function drawRandom(holder: { rngState: RngState }): number {
  const { value, next } = step(holder.rngState);
  holder.rngState = next;
  return value;
}

export function shuffleInPlace<T>(items: T[], next: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
