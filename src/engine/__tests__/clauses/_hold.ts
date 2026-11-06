// The "leave this prompt open" switches of the clause suite (see the note above `holdResourceFace` in `_clause.ts`).
// They live apart from `_clause.ts` because importing that module patches `SpoilsEngine.prototype.perform` for the whole
// test file; helpers such as `_turn.ts` need the switches without installing the patch.

import type { SpoilsEngine } from "../../../engine.js";

export const holds = { face: false, cost: false };

/** Runs `fn` with the `playResource` prompt left open (for tests about the face-up / face-down choice itself). */
export function holdResourceFace<T>(fn: () => T): T {
  const was = holds.face;
  holds.face = true;
  try {
    return fn();
  } finally {
    holds.face = was;
  }
}
/** Runs `fn` with the cost prompts (which card to destroy, which `oneOf` branch) left open. */
export function holdCostChoices<T>(fn: () => T): T {
  const was = holds.cost;
  holds.cost = true;
  try {
    return fn();
  } finally {
    holds.cost = was;
  }
}

/**
 * Runs `run` with every faction's Develop Rule offering nothing (their `develop.choices` emptied), then puts the choices
 * back. The Develop Rule cannot be skipped, so a turn start that a test only passes through (the prompt it is answering
 * ends the turn) would otherwise draw a card and shift the test's hand / deck counts. The result is the turn start of
 * a faction with empty `develop.choices`, as `trigger-ordering.test.ts`'s "barren" faction has.
 */
export function withoutDevelopChoices<T>(engine: SpoilsEngine, run: () => T): T {
  const develops = new Set<{ choices: unknown[] }>();
  for (const id of Object.keys(engine.state.players)) {
    const develop = engine.getFactionDefinition(id)?.turn.develop;
    if (develop) develops.add(develop as { choices: unknown[] });
  }
  const saved = [...develops].map((develop) => [develop, develop.choices] as const);
  for (const develop of develops) develop.choices = [];
  try {
    return run();
  } finally {
    for (const [develop, choices] of saved) develop.choices = choices;
  }
}
