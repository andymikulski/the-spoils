/* data.ts
 *
 * The real card database and per-card fidelity, kept as a separate
 * entry point from ./engine.ts: the engine (src/engine, src/types) is pure
 * and UI-free, and doesn't know this data exists. This module is for
 * consumers that actually want to build decks/games against the real card
 * catalog rather than synthetic fixtures. Decklists are the consumer's own;
 * none ship here.
 */

import cards from "./data/cards.js";
import cardFidelityJson from "./data/card-fidelity.js";
import type { CardDefinition, CardDefinitionId } from "./types/index.js";

export { CARD_SETS, type CardSetInfo } from "./sets.js";

/**
 * Each set's printings as its own export, named `CARDS_` + the set id in
 * upper snake case (`CARDS_SEED_SAGA`, `CARDS_1ST_EDITION`). These come from
 * the same modules as `the-spoils/sets/<id>`; import that instead to load a
 * single set without the rest of the catalog.
 */
export * from "./data/cards.js";

/**
 * The full card database: every printing of every set, sourced from
 * data/cards/<set id>.json and concatenated in `CARD_SETS` order. To load a
 * single set, import `the-spoils/sets/<id>` instead.
 */
export const CARD_CATALOG: CardDefinition[] = cards;

/**
 * How faithfully the engine reproduces a card's printed text:
 * - `full`    — every mechanically-meaningful clause is obeyed. Cosmetic-only
 *   deviations don't count (a "reveal"/"look at" verb with no downstream
 *   reference; "pick a player" collapsing to the sole opponent in 2-player).
 * - `partial` — a documented concession changes how at least one line plays.
 *   The card still resolves and is broadly usable; see `notes`.
 * - `stub`    — the card's core function isn't modelled.
 */
export type CardFidelity = "full" | "partial" | "stub";

export interface CardFidelityReport {
  /** Every catalog card id -> its fidelity level. */
  fidelity: Record<CardDefinitionId, CardFidelity>;
  /** Concession detail, keyed by id, for every card below `full`. */
  notes: Record<CardDefinitionId, string>;
  /** `{ full, partial, stub }` tallies. */
  counts: Record<CardFidelity, number>;
}

/**
 * Per-card fidelity to printed text, generated from `data/card-coverage.json`
 * by `scripts/build-coverage.cjs`. A deck builder can badge or gate cards
 * that aren't `full` (see `CardFidelityReport`).
 */
export const CARD_FIDELITY = cardFidelityJson as unknown as CardFidelityReport;

/** Convenience: a card's fidelity level, defaulting to `full` for unknown ids. */
export function cardFidelity(id: CardDefinitionId): CardFidelity {
  return CARD_FIDELITY.fidelity[id] ?? "full";
}
