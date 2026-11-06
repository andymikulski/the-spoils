// -----------------------------------------------------------------------------
// Seats, turn order and opponents
// -----------------------------------------------------------------------------
//
// Pure reads over `GameState` that answer "who sits where" and "who opposes
// whom" for every table format. Shared by setup and the engine so the two
// never disagree.

import type { GameState, PlayerId } from "../types/index.js";
import { assert } from "./utilities.js";
import { showdownOpponents } from "./showdown.js";

/** Whether `playerId` is still in the game (not eliminated). */
export function isLiving(state: GameState, playerId: PlayerId): boolean {
  return !state.players[playerId]?.eliminated;
}

/** Every seat in turn order, starting at `firstId` (eliminated seats included). */
export function seatsFrom(state: GameState, firstId: PlayerId): PlayerId[] {
  const seats = state.turnOrder;
  const start = seats.indexOf(firstId);
  assert(start >= 0, `'${firstId}' has no seat at this table.`);
  return [...seats.slice(start), ...seats.slice(0, start)];
}

/** Every living seat in turn order, starting at `firstId` (which is included only if it is living). */
export function livingSeatsFrom(state: GameState, firstId: PlayerId): PlayerId[] {
  return seatsFrom(state, firstId).filter(id => isLiving(state, id));
}

/** Every living seat in turn order, starting at the active player. */
export function livingSeats(state: GameState): PlayerId[] {
  return livingSeatsFrom(state, state.activePlayerId);
}

/** Every living seat after `playerId` in turn order, wrapping around, without `playerId` itself. */
export function otherLivingSeats(state: GameState, playerId: PlayerId): PlayerId[] {
  return seatsFrom(state, playerId)
    .slice(1)
    .filter(id => isLiving(state, id));
}

/** The next living seat after `playerId` in turn order (`playerId` itself if it is the only one left). */
export function nextLivingSeat(state: GameState, playerId: PlayerId): PlayerId {
  return otherLivingSeats(state, playerId)[0] ?? playerId;
}

/**
 * Every living player `playerId` may treat as "your opponent", in turn order
 * after `playerId`.
 *
 * - classic / free-for-all: every other living player (MP 2).
 * - Showdown: the Villain's opponents are the Heroes (SD 13); a Hero's is the
 *   Villain (SD 14), or the other Heroes once that Hero's Allegiance card is
 *   face-up showing loyalty to the Villain (SD 15).
 */
export function opponentsOf(state: GameState, playerId: PlayerId): PlayerId[] {
  const others = otherLivingSeats(state, playerId);
  if (state.format.kind !== "showdown") return others;
  const allowed = new Set(showdownOpponents(state, playerId));
  return others.filter(id => allowed.has(id));
}

/** Whether `otherId` is one of `playerId`'s opponents (see {@link opponentsOf}). */
export function isOpponentOf(state: GameState, playerId: PlayerId, otherId: PlayerId): boolean {
  return opponentsOf(state, playerId).includes(otherId);
}
