// -----------------------------------------------------------------------------
// Running game log
// -----------------------------------------------------------------------------

import type { GameEvent } from "./events.js";
import type { PlayerId } from "./ids.js";

/**
 * Coarse category for a `GameLogEntry`, so a renderer can show/hide whole
 * classes of line (e.g. mute `zone` churn, keep `action` / `response`).
 * Derived centrally from the entry's event/marker — not a rules concept.
 */
export type GameLogKind =
  | "turn" // a turn started / a turn is ending
  | "action" // a deploy / ability activation / attack made as a normal turn action
  | "response" // a deploy / ability activation made into an open response window
  | "resolution" // a response-stack item beginning to resolve
  | "trigger" // a triggered ability resolving
  | "draw" // cards drawn, discarded, revealed, or a deck searched
  | "resource" // a resource played
  | "battle" // battle lifecycle, attackers, blockers, battle damage
  | "damage" // damage dealt (to a card, location, or faction)
  | "zone" // enters play, destroyed, moved, depleted, restored, counters, picked
  | "info"; // anything else (coin flips, etc.)

/**
 * One line in the running game log (`GameState.gameLog`). Informational
 * only — no rule keys off it; the engine records it purely so a UI / replay
 * tool can show players, in order, everything that has happened.
 *
 * Entries are appended in emit order. Replay them top-to-bottom and indent
 * each by `depth` and a response to an action reads as nested one level in,
 * a response to that response two levels in, and so on — mirroring the LIFO
 * order in which the response stack unwinds (RULES.md §7).
 */
export interface GameLogEntry {
  /** 1-based, gap-free, monotonic — the entry's position in the whole game. */
  seq: number;

  /** `GameState.turn` at the moment this was recorded. */
  turn: number;

  /** The active (turn) player at the moment this was recorded. */
  activePlayerId: PlayerId;

  /**
   * Response-stack nesting when this was recorded: 0 during the normal turn
   * flow, 1 for a response to a turn action, 2 for a response to that
   * response, and so on. A renderer indents by this.
   */
  depth: number;

  /** Coarse category — see `GameLogKind`. */
  kind: GameLogKind;

  /** One-line, human-readable summary, already free of indentation. */
  message: string;

  /**
   * The underlying engine event, for entries that are event-backed (the
   * overwhelming majority). Exactly one of `event` / `marker` is set.
   */
  event?: GameEvent;

  /**
   * Set instead of `event` for the structural markers that aren't game
   * events but matter for reading a response chain or a battle:
   * - `responseWindowOpened` — the opponent has been handed a chance to respond.
   * - `priorityPassed` — a player declined to respond / passed priority; the
   *   message names what was on offer (the attack, a pending stack item, a
   *   battle-damage step) so consecutive declines don't read alike.
   * - `stackItemResolving` — a card / ability on the response stack is now resolving.
   * - `triggerResolving` — a triggered ability is now resolving.
   * - `blockersDeclared` — the defender declared their blocking party (or none).
   * - `battleDamageAssigned` — a battle character assigned its damage to a target.
   */
  marker?:
    | "responseWindowOpened"
    | "priorityPassed"
    | "stackItemResolving"
    | "triggerResolving"
    | "blockersDeclared"
    | "battleDamageAssigned";
}
