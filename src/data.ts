/* data.ts
 *
 * The real card database and preconstructed decklists, kept as a separate
 * entry point from ./engine.ts: the engine (src/engine, src/types) is pure
 * and UI-free, and doesn't know this data exists. This module is for
 * consumers that actually want to build decks/games against the real card
 * catalog rather than synthetic fixtures.
 */

import cardsJson from "./data/cards.js";
import cardFidelityJson from "./data/card-fidelity.js";
import arcanistDeckIds from "./data/decks/arcanist-ids.js";
import warlordDeckIds from "./data/decks/warlord-ids.js";
import seed3SamplerIds from "./data/decks/seed3-sampler-ids.js";
import type { CardDefinition, CardDefinitionId } from "./types/index.js";

/** The full card database (every printing of every set), sourced from data/cards.json. */
export const CARD_CATALOG = cardsJson as CardDefinition[];

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

// Real preconstructed decklists. Each includes one copy of its faction
// card, mixed in with the rest; duplicates are expected wherever a deck
// contains multiple copies of a card.
export const ARCANIST_DECK: CardDefinitionId[] = arcanistDeckIds;
export const WARLORD_DECK: CardDefinitionId[] = warlordDeckIds;

/**
 * A Seed 3 feature-testing deck — **not** a legal tournament deck. One
 * Seed 3 faction card plus a copy of every Seed 3 card that exercises a
 * distinct engine mechanic, padded with 1st-Edition basic resources across
 * all five icons so each is castable. Use it to drive every Seed 3 code
 * path through a real game / renderer.
 */
export const SEED3_SAMPLER_DECK: CardDefinitionId[] = seed3SamplerIds;
