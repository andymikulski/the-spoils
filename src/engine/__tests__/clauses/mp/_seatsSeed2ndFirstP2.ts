// Shared helpers for the 3- and 4-seat clause tests of the Seed, 2nd Edition and 1st Edition Part 2 sets
// (docs/MULTIPLAYER-PLAN.md, Phase 5). A real game of 3 or 4 seats (P1 is the controller, P2 sits to its left),
// real catalog printings, real actions through `perform`.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, GameAction, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { buildGame, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, type CardPlacement } from "../../support/fixtures.js";
import { answerPending, pending } from "../_board.js";
import { drain, declineAll, type PendingChoiceLike } from "../_clause.js";

export { P1, P2, P3, P4, resolvePendingResponses };
export type { CardPlacement };

export type Count = 3 | 4;
export const seatsOf = (count: Count): PlayerId[] => [P1, P2, P3, P4].slice(0, count);

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

/**
 * A table of `count` seats (seat order P1, P2, P3[, P4]) holding `cards`. Every seat's faction has no Develop choices,
 * so a turn can pass without start-of-turn prompts. `active` is the player whose turn it is (default P1).
 */
export function table(count: Count, cards: CardPlacement[], active: PlayerId = P1): Table {
  const built = buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    activePlayerId: active,
    cards
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}

/** `n` plain cards of `def` for `owner` in `zone`, keyed `<prefix>0..n-1` (a deck's first key is its top card). */
export function stack(prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"], def: (index: number) => CardDefinition): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: def(index), owner, zone }));
}

export const zoneOf = (t: Table, key: string) => t.engine.state.cards[t.id(key)]!.zone;
export const handOf = (t: Table, who: PlayerId) => t.engine.state.players[who]!.hand;
export const deckOf = (t: Table, who: PlayerId) => t.engine.state.players[who]!.deck;
export const influenceOf = (t: Table, who: PlayerId) => t.engine.state.players[who]!.influence;

/** The open pending choice's kind, whose it is, and (for a player choice) its candidates. */
export const open = (t: Table): { kind: string; playerId: PlayerId; candidates?: PlayerId[] } | undefined => {
  const pc = pending(t.engine);
  return pc ? { kind: pc.kind, playerId: pc.playerId, ...(Array.isArray(pc.candidates) ? { candidates: pc.candidates as PlayerId[] } : {}) } : undefined;
};

/** Asserts a "choose a player" prompt is open for `who` offering exactly `candidates` (in any order), then answers it with `pick`. */
export function choosePlayer(t: Table, who: PlayerId, candidates: PlayerId[], pick: PlayerId): void {
  const pc = pending(t.engine);
  assert.ok(pc, "a choosePlayer prompt should be open");
  assert.equal(pc.kind, "choosePlayer");
  assert.equal(pc.playerId, who, "the player who answers the opponent choice");
  assert.deepEqual([...(pc.candidates as PlayerId[])].sort(), [...candidates].sort());
  answerPending(t.engine, "choosePlayer", { playerId: pick });
}

/** Asserts no pending choice is open and nothing is waiting in a response window. */
export function settled(t: Table): void {
  resolvePendingResponses(t.engine);
  assert.equal(t.engine.state.pendingChoice, undefined, "nothing should be asked");
}

/** The players a played card needs named first (`getPlayRequirements`' `players` entry), or undefined when none is needed. */
export function playersNeeded(t: Table, action: GameAction): Array<{ id: string; candidates: PlayerId[] }> | undefined {
  const needs = t.engine.getPlayRequirements(action as never);
  const first = needs[0];
  return first && first.kind === "players" ? (first.choices as Array<{ id: string; candidates: PlayerId[] }>) : undefined;
}

/** `playerId` plays `key` (with `players` / `selected` when given); response windows are left open. */
export function playRaw(t: Table, playerId: PlayerId, key: string, extra: Record<string, unknown> = {}): void {
  t.engine.perform({ type: "playCard", playerId, cardId: t.id(key), ...extra } as never);
}

/** `playerId` plays `key` and every response window closes with passes, so the card resolves. */
export function playCard(t: Table, playerId: PlayerId, key: string, extra: Record<string, unknown> = {}): void {
  playRaw(t, playerId, key, extra);
  resolvePendingResponses(t.engine);
}

/** `playerId` activates `abilityId` of `key`, and every response window closes with passes. */
export function activate(t: Table, playerId: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): void {
  t.engine.perform({ type: "activateAbility", playerId, cardId: t.id(key), abilityId, ...extra } as never);
  resolvePendingResponses(t.engine);
}

/** Answers pending choices with `answerFor`, declining everything it does not handle. */
export function drainWith(t: Table, answerFor: (pc: PendingChoiceLike) => unknown | undefined): void {
  drain(t.engine, (pc) => answerFor(pc) ?? declineAll(pc));
}

/** The pass-the-turn dance: `playerId` ends the turn, every response closes, and the next seat's turn starts. */
export function endTurn(t: Table, playerId: PlayerId): void {
  t.engine.perform({ type: "endTurn", playerId } as never);
  resolvePendingResponses(t.engine);
}
