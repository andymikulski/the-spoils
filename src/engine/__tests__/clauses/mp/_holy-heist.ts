// Shared boards and helpers for the Holy Heist multiplayer clause tests (clauses/mp/holy-heist-*.test.ts): real catalog
// printings on a real 3- or 4-seat game, driven only through `perform`.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses } from "../../support/fixtures.js";
import { developFaction } from "../../per-card/_harness.js";
import type { CardPlacement } from "../../support/fixtures.js";
import { bank, volition } from "../../per-card/_harness.js";

export { bank, volition, character, P1, P2, P3, P4, resolvePendingResponses };
export type { CardPlacement };

export type Seats = 3 | 4;
export const SEATS: PlayerId[] = [P1, P2, P3, P4];
export const seatsOf = (count: Seats): PlayerId[] => SEATS.slice(0, count);
export const others = (count: Seats, ...except: PlayerId[]): PlayerId[] => seatsOf(count).filter((seat) => !except.includes(seat));

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

/** A real game of `count` seats (factions without a develop rule, so no start-of-turn prompts) with `cards` placed; `active` takes the turn. */
export function table(count: Seats, cards: CardPlacement[], opts: { active?: PlayerId; turn?: number; p1Develops?: boolean } = {}): Table {
  const built = buildGame({
    playerA: { faction: opts.p1Develops ? developFaction() : noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    cards,
    ...(opts.active ? { activePlayerId: opts.active } : {}),
    ...(opts.turn ? { turn: opts.turn } : {})
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}

export type Pending = { kind: string; playerId: string; [key: string]: unknown };
export const pending = (t: Table): Pending | undefined => t.engine.state.pendingChoice as unknown as Pending | undefined;
export const zoneOf = (t: Table, key: string): string => t.engine.state.cards[t.id(key)]!.zone;
export const handOf = (t: Table, who: PlayerId): CardInstanceId[] => t.engine.state.players[who]!.hand;
export const deckOf = (t: Table, who: PlayerId): CardInstanceId[] => t.engine.state.players[who]!.deck;
export const discardOf = (t: Table, who: PlayerId): CardInstanceId[] => t.engine.state.players[who]!.discard;
export const influenceOf = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;
export const tokens = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.counters.token ?? 0;
export const damageOf = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.damage;
export const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;

/** `n` vanilla characters keyed `<prefix>0..n-1`. */
export function filler(prefix: string, n: number, owner: PlayerId, zone: "hand" | "deck" | "discard" | "play" = "hand", over: Partial<CardDefinition> = {}): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}`, ...over }), owner, zone }));
}

/** Asserts a pending choice of `kind` addressed to `who` is open, answers it, then lets any response window finish. */
export function answer(t: Table, kind: string, who: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(t);
  assert.ok(pc, `expected an open pending choice (${kind}) for ${who}`);
  assert.equal(pc.kind, kind, "pending choice kind");
  assert.equal(pc.playerId, who, `${kind} must be answered by ${who}`);
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice } as never);
  resolvePendingResponses(t.engine);
}

export const choosePlayer = (t: Table, who: PlayerId, playerId: PlayerId): void => answer(t, "choosePlayer", who, { kind: "choosePlayer", playerId });
export const pick = (t: Table, who: PlayerId, ...selected: string[]): void =>
  answer(t, "chooserSelectsTarget", who, { kind: "chooserSelectsTarget", selected: selected.map((key) => t.id(key)) });

/** The candidates of an open `choosePlayer` prompt. */
export const candidates = (t: Table): PlayerId[] => (pending(t) as unknown as { candidates: PlayerId[] }).candidates;

/** Plays `key` (from `who`'s hand) and leaves the response window open. */
export function playOpen(t: Table, who: PlayerId, key: string, extra: Record<string, unknown> = {}): void {
  t.engine.perform({ type: "playCard", playerId: who, cardId: t.id(key), selected: {}, ...extra } as never);
}
/** Plays `key` and passes every response so it resolves, stopping at the first pending choice. */
export function play(t: Table, who: PlayerId, key: string, extra: Record<string, unknown> = {}): void {
  playOpen(t, who, key, extra);
  resolvePendingResponses(t.engine);
}
export function activateOpen(t: Table, who: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): void {
  t.engine.perform({ type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, selected: {}, variables: {}, ...extra } as never);
}
export function activate(t: Table, who: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): void {
  activateOpen(t, who, key, abilityId, extra);
  resolvePendingResponses(t.engine);
}

/** The message of the error `fn` throws (fails the test when it does not throw). */
export function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("expected the engine to refuse this");
}

/** What `getPlayRequirements` asks for before anything else: the players step, if any. */
export function playRequirements(t: Table, who: PlayerId, key: string, abilityId?: string): Array<{ kind: string; [key: string]: unknown }> {
  const engine = t.engine as unknown as { getPlayRequirements(action: unknown): Array<{ kind: string }> };
  return engine.getPlayRequirements(
    abilityId
      ? { type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, selected: {}, variables: {} }
      : { type: "playCard", playerId: who, cardId: t.id(key), selected: {}, variables: {} }
  );
}

export const factionOf = (t: Table, who: PlayerId): CardInstanceId => t.engine.state.players[who]!.factionId!;

/** The ids `getPickCandidates` offers for pick `declarationId` of `key` (a card in hand, or an ability of a card in play). */
export function pickCandidates(t: Table, who: PlayerId, key: string, declarationId: string, extra: { abilityId?: string; selected?: Record<string, string[]>; players?: Record<string, PlayerId> } = {}): CardInstanceId[] {
  const engine = t.engine as unknown as { getPickCandidates(action: unknown, declarationId: string): CardInstanceId[] };
  const { abilityId, ...rest } = extra;
  return engine.getPickCandidates(
    abilityId
      ? { type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, selected: {}, variables: {}, ...rest }
      : { type: "playCard", playerId: who, cardId: t.id(key), selected: {}, variables: {}, ...rest },
    declarationId
  );
}

/** `who` attacks `target` and passes priority, leaving the declaration window open for the defender. */
export function attackOpen(t: Table, who: PlayerId, attackers: string[], target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId }): void {
  t.engine.perform({ type: "declareAttack", playerId: who, attackerIds: attackers.map((key) => t.id(key)), target } as never);
  t.engine.perform({ type: "passPriority", playerId: who } as never);
}

export const sorted = (ids: readonly string[]): string[] => [...ids].sort();

export const pickIds = (t: Table, who: PlayerId, ...selected: string[]): void =>
  answer(t, "chooserSelectsTarget", who, { kind: "chooserSelectsTarget", selected });

/** Answers an `anyPlayerMayPay` offer addressed to `who`. */
export const offer = (t: Table, who: PlayerId, pay: boolean): void => answer(t, "anyPlayerMayPay", who, { kind: "anyPlayerMayPay", pay });
