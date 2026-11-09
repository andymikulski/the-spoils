// Shared helpers for the multiplayer clause tests of the real catalog printings (clauses/mp/*.test.ts): a table of 3 or
// 4 seats built from `buildGame`, real `perform` calls, and small readers of the pending choice / response window.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { bank, buildGame, character, noDevelopFaction, P1, P2, resolvePendingResponses } from "../../per-card/_harness.js";
import { P3, P4, type CardPlacement } from "../../support/fixtures.js";
import { settleState, type PendingChoiceLike } from "../_clause.js";

export { P1, P2, P3, P4, bank, character, resolvePendingResponses };
export type { CardPlacement };

export const SEATS: PlayerId[] = [P1, P2, P3, P4];
export const seatsFor = (count: number): PlayerId[] => SEATS.slice(0, count);

export interface SeatTable {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

/** A table of `count` seats (P1 active, factions without a Develop Rule) holding `cards`. */
export function seatTable(
  count: number,
  cards: CardPlacement[],
  options: { activePlayerId?: PlayerId; turn?: number; random?: () => number; factions?: Partial<Record<PlayerId, CardDefinition>> } = {}
): SeatTable {
  const { factions, ...rest } = options;
  const faction = (who: PlayerId): CardDefinition => factions?.[who] ?? noDevelopFaction();
  const built = buildGame({
    playerA: { faction: faction(P1) },
    playerB: { faction: faction(P2) },
    extraPlayers: Array.from({ length: count - 2 }, (_, i) => ({ faction: faction(SEATS[i + 2]!) })),
    cards,
    ...rest
  });
  return { engine: built.engine, id: built.id, seats: seatsFor(count) };
}

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (deck order: index 0 is the top). */
export function fill(prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"], make: (i: number) => CardDefinition = (i) => character({ name: `${prefix}${i}` })): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: make(i), owner, zone }));
}

export const pendingOf = (engine: SpoilsEngine): PendingChoiceLike | undefined => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
export const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
export const handOf = (engine: SpoilsEngine, who: PlayerId): CardInstanceId[] => engine.state.players[who]!.hand;
export const deckOf = (engine: SpoilsEngine, who: PlayerId): CardInstanceId[] => engine.state.players[who]!.deck;
export const discardOf = (engine: SpoilsEngine, who: PlayerId): CardInstanceId[] => engine.state.players[who]!.discard;
export const influenceOf = (engine: SpoilsEngine, who: PlayerId): number => engine.state.players[who]!.influence;

/** Raw `playCard` (the response window stays open). `players` names the block's opponent (and any player choice). */
export function playCard(engine: SpoilsEngine, who: PlayerId, cardId: CardInstanceId, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "playCard", playerId: who, cardId, selected: {}, variables: {}, ...extra } as never);
}

/** Raw `activateAbility`. */
export function activate(engine: SpoilsEngine, who: PlayerId, cardId: CardInstanceId, abilityId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "activateAbility", playerId: who, cardId, abilityId, selected: {}, variables: {}, ...extra } as never);
}

/** What `getPlayRequirements` says an action needs first (the `players` requirement, if any), as candidate lists by choice id. */
export function playerRequirement(engine: SpoilsEngine, action: Record<string, unknown>): { id: string; candidates: PlayerId[] }[] | undefined {
  const needs = engine.getPlayRequirements(action as never);
  const first = needs[0] as unknown as { kind: string; choices?: { id: string; candidates: PlayerId[] }[] } | undefined;
  return first?.kind === "players" ? first.choices : undefined;
}

/** Answers the open prompt of `who`; asserts its kind. */
export function answer(engine: SpoilsEngine, kind: string, choice: Record<string, unknown>, who?: PlayerId): void {
  const pc = pendingOf(engine);
  assert.ok(pc, `expected an open ${kind} prompt`);
  assert.equal(pc.kind, kind, `the open prompt is ${pc.kind}`);
  if (who !== undefined) assert.equal(pc.playerId, who, `the ${kind} prompt is for ${pc.playerId}, not ${who}`);
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind, ...choice } } as never);
}

/** Answers a `chooserSelectsTarget` prompt with `selected`. */
export const pickIds = (engine: SpoilsEngine, selected: CardInstanceId[], who?: PlayerId): void => answer(engine, "chooserSelectsTarget", { selected }, who);

/** The `players` requirement's candidates, or the `choosePlayer` prompt's candidates, whichever is open. */
export const candidatesOf = (engine: SpoilsEngine): PlayerId[] => ((pendingOf(engine) as unknown as { candidates: PlayerId[] }).candidates ?? []).slice();

/** Everyone who has been offered a response to the top stack item, in order, until it resolves: passes each in turn. Returns the passers. */
export function passAround(engine: SpoilsEngine): PlayerId[] {
  const passers: PlayerId[] = [];
  let guard = 0;
  while (engine.state.responseWindow && !engine.state.pendingChoice && guard++ < 200) {
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") {
      passers.push(window.priorityPlayerId);
      engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
    } else {
      engine.perform({ type: "advanceFlow" } as never);
    }
  }
  return passers;
}

/** Takes `who`'s faction to 0 influence and lets the state-based check eliminate them, as in a game (their cards leave the game). */
export function eliminate(engine: SpoilsEngine, who: PlayerId): void {
  engine.state.players[who]!.influence = 0;
  settleState(engine);
  assert.ok(engine.state.players[who]!.eliminated, `${who} is eliminated`);
}

export function ready(engine: SpoilsEngine, who: PlayerId): number {
  return engine.getAvailableResourceCount(who);
}

export interface Asked {
  kind: string;
  playerId: PlayerId;
  /** The target declaration's id of a `chooserSelectsTarget` prompt. */
  decl?: string;
}

/**
 * Lets every response pass and answers each prompt that opens with `answerFor` (which returns the choice, or `undefined`
 * to stop and leave that prompt open) until nothing is pending. Returns who was asked what, in order.
 */
export function drive(engine: SpoilsEngine, answerFor: (pc: PendingChoiceLike & { declaration?: { id: string } }) => Record<string, unknown> | undefined, budget = 40): Asked[] {
  const asked: Asked[] = [];
  for (let guard = 0; guard < budget; guard++) {
    passAround(engine);
    const pc = pendingOf(engine) as (PendingChoiceLike & { declaration?: { id: string } }) | undefined;
    if (!pc) break;
    const choice = answerFor(pc);
    if (choice === undefined) break;
    asked.push({ kind: pc.kind, playerId: pc.playerId, decl: pc.declaration?.id });
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, ...choice } } as never);
  }
  return asked;
}

/** The cards the open `chooserSelectsTarget` prompt would accept (the engine's own candidate list for its declaration). */
export function offeredCards(engine: SpoilsEngine): CardInstanceId[] {
  const pc = pendingOf(engine) as unknown as { kind: string; playerId: PlayerId; declaration: { selector: unknown; count?: unknown }; context: unknown };
  assert.equal(pc?.kind, "chooserSelectsTarget", "a pick is open");
  return engine.targetCandidates(pc.declaration.selector as never, pc.context as never, pc.playerId).map((card) => card.id);
}

/** The seats other than P1, clockwise. */
export const opponentsAt = (count: number): PlayerId[] => seatsFor(count).slice(1);

/** Asserts the action asks the controller for "your opponent" first, offering every other player still in the game. */
export function expectOpponentAsked(t: SeatTable, action: Record<string, unknown>, among: PlayerId[] = opponentsAt(t.seats.length)): void {
  const needs = playerRequirement(t.engine, action);
  assert.ok(needs, "the opponent choice is asked before anything else");
  assert.deepEqual(needs[0], { id: "opponent", candidates: among });
}

/** Asserts the action asks for no opponent (one opponent left, or a block that says no "your opponent"). */
export function expectNotAsked(t: SeatTable, action: Record<string, unknown>): void {
  assert.equal(playerRequirement(t.engine, action), undefined, "no opponent choice is offered");
}

/** The opponents to run a scenario for: the first and the last one (at 3 seats these are every opponent). */
export const choices = (count: number): PlayerId[] => {
  const opps = opponentsAt(count);
  return opps.length > 2 ? [opps[0]!, opps[opps.length - 1]!] : opps;
};
