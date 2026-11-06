// -----------------------------------------------------------------------------
// Table format: how many players sit down, who opposes whom, how a game ends
// -----------------------------------------------------------------------------

import type { PlayerId } from "./ids.js";
import type { AllegianceDeckConfig } from "./showdown.js";

/**
 * The table format a game is played under, fixed at setup and stored on
 * `GameState.format` (it travels through saves and replays).
 *
 * - `classic` — the two-player game the Comprehensive Rules describe.
 * - `freeForAll` — two or more players, each the opponent of every other
 *   (Multi-Player Guidelines, `docs/rules/multiplayer-guidelines.md`). "Your
 *   opponent" in a block of rules text is one other player chosen for that
 *   block (MP 2).
 * - `showdown` — one Villain against two or more Heroes
 *   (`docs/rules/showdown-rules.md`). Opponents follow SD 13–15.
 *
 * Deck legality (epic cards, Limited, tournament play) is independent of the
 * table format; see `DeckConstructionOptions`.
 */
export type GameFormat =
  | { kind: "classic" }
  | { kind: "freeForAll" }
  | ShowdownFormat;

export interface ShowdownFormat {
  kind: "showdown";
  /** The Villain (SD 1). Every other seat is a Hero. */
  villainId: PlayerId;
  /**
   * How Allegiance cards are dealt to the Heroes (SD 6). Omitted at setup:
   * `defaultAllegianceDeck` for the number of Heroes; always set on
   * `GameState.format`.
   */
  allegiance?: AllegianceDeckConfig;
}

export type GameFormatKind = GameFormat["kind"];

/**
 * How a finished game ended. `winners` lists every player on the winning
 * side, including players who were eliminated earlier but whose side won
 * (a Showdown Hero knocked out before the Villain fell). A draw has no
 * winners.
 */
export type GameResult =
  | { outcome: "victory"; winners: PlayerId[] }
  | { outcome: "draw"; winners: [] };

/** Why a player left the game before it ended. */
export interface PlayerElimination {
  /** `GameState.turn` on which the player was eliminated. */
  turn: number;
  reason: "influence" | "emptyDeck";
}
