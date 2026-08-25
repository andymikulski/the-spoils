/* data.ts
 *
 * The real card database and preconstructed decklists, kept as a separate
 * entry point from ./engine.ts: the engine (src/engine, src/types) is pure
 * and UI-free, and doesn't know this data exists. This module is for
 * consumers that actually want to build decks/games against the real card
 * catalog rather than synthetic fixtures.
 */

import cardsJson from "./data/cards.js";
import arcanistDeckIds from "./data/decks/arcanist-ids.js";
import warlordDeckIds from "./data/decks/warlord-ids.js";
import type { CardDefinition, CardDefinitionId } from "./types/index.js";

/** The full card database (2101+ cards), sourced from data/cards.json. */
export const CARD_CATALOG = cardsJson as CardDefinition[];

// Real preconstructed decklists. Each includes one copy of its faction
// card, mixed in with the rest; duplicates are expected wherever a deck
// contains multiple copies of a card.
export const ARCANIST_DECK: CardDefinitionId[] = arcanistDeckIds;
export const WARLORD_DECK: CardDefinitionId[] = warlordDeckIds;
