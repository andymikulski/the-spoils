// -----------------------------------------------------------------------------
// Showdown (docs/rules/showdown-rules.md)
// -----------------------------------------------------------------------------

import type { CardInstanceId, PlayerId } from "./ids.js";

/** Which side a Hero is secretly loyal to (SD 6). */
export type Loyalty = "heroes" | "villain";

/**
 * The Allegiance cards dealt to the Heroes before the game (SD 6). The
 * printed Allegiance card set is not part of the catalog, so the deck is
 * described here as data: `cards` lists the loyalty printed on each card in
 * the deck, which is shuffled with the game's RNG and dealt one per Hero.
 * It must hold at least as many cards as there are Heroes; undealt cards are
 * set aside unseen.
 *
 * Only `src/engine/showdown.ts` reads this shape, so a future model of the
 * real Allegiance cards replaces it there without touching the rest of the
 * engine.
 */
export interface AllegianceDeckConfig {
  cards: Loyalty[];
}

/** One Hero's dealt Allegiance card. */
export interface AllegianceCard {
  loyalty: Loyalty;
  /** Turned face-up (SD-SLE 5). While face-down only its holder and the Villain may look at it (SD 7). */
  faceUp: boolean;
}

/** Showdown's shared table state. Present exactly when `GameState.format.kind === "showdown"`. */
export interface ShowdownState {
  /** Allegiance card per Hero (SD 6). */
  allegiance: Record<PlayerId, AllegianceCard>;
  /** The shared Hero Deck, top first (SD 3). Its cards sit in no player's zones until claimed; the claimer becomes their owner. */
  heroDeck: CardInstanceId[];
  /** Face-up Temptation Pile (SD 11). */
  temptationPile: CardInstanceId[];
  /** The shared Slightly Less Evil Alliance faction card every Hero may use (SD 5, SD-SLE 1), if one is on the table. */
  sharedFactionId?: CardInstanceId;
}
