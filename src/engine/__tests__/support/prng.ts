// Deterministic PRNG for full-game simulations. Not cryptographic — just
// stable across runs/platforms so a "play an entire game" test is
// reproducible (same seed -> same shuffle, same coin flips, same bot
// decisions) instead of flaking on whatever Math.random() happens to do.

/** mulberry32: small, fast, decent-quality deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;

  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
