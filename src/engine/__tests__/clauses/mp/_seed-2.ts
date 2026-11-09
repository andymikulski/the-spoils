// Helpers for the seed-2 multiplayer clause tests (3 and 4 seats): a table of real seats, the actions a player takes
// through `perform`, and small readers for the open prompt.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, GameAction, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { bank, buildGame, noDevelopFaction, P1, P2, resolvePendingResponses, resourceCard } from "../../per-card/_harness.js";
import { P3, P4 } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";
import "../_clause.js";

export { bank, character, item, location, tactic, resourceCard, P1, P2, resolvePendingResponses } from "../../per-card/_harness.js";
export { P3, P4 };
export type { CardPlacement };

export const SEATS: PlayerId[] = [P1, P2, P3, P4];
export const seatsFor = (count: number): PlayerId[] => SEATS.slice(0, count);
export const others = (count: number, ...except: PlayerId[]): PlayerId[] => seatsFor(count).filter((seat) => !except.includes(seat));

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

export interface TableOptions {
  active?: PlayerId;
  turn?: number;
  /** Per-seat factions (default: a faction with no Develop Rule, so turns pass without start-of-turn prompts). */
  factions?: Partial<Record<PlayerId, CardDefinition>>;
  influence?: Partial<Record<PlayerId, number>>;
}

/** A game of `count` seats (P1 first, clockwise) holding `cards`. */
export function table(count: number, cards: CardPlacement[], options: TableOptions = {}): Table {
  const seats = seatsFor(count);
  const faction = (seat: PlayerId): { faction: CardDefinition; influence?: number } => ({
    faction: options.factions?.[seat] ?? noDevelopFaction(),
    ...(options.influence?.[seat] !== undefined ? { influence: options.influence[seat] } : {})
  });
  const built = buildGame({
    playerA: faction(P1),
    playerB: faction(P2),
    extraPlayers: seats.slice(2).map((seat) => faction(seat)),
    cards,
    ...(options.active ? { activePlayerId: options.active } : {}),
    ...(options.turn ? { turn: options.turn } : {})
  });
  return { engine: built.engine, id: built.id, seats };
}

/** One placement per seat: a card `key-<seat>` of `def(seat)` in `zone` for that seat. */
export function perSeat(count: number, key: string, zone: CardPlacement["zone"], def: (seat: PlayerId) => CardDefinition, extra: Partial<CardPlacement> = {}): CardPlacement[] {
  return seatsFor(count).map((seat) => ({ key: `${key}-${seat}`, def: def(seat), owner: seat, zone, ...extra }));
}

/** `n` staple resources of `icon`, for `owner`. */
export const resources = (icon: Parameters<typeof bank>[0], n: number, owner: PlayerId = P1): CardPlacement[] => bank(icon, n, owner);

export const pending = (t: Table) => t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; [key: string]: unknown } | undefined;

export function perform(t: Table, action: GameAction): void {
  t.engine.perform(action);
}

/** What `getPlayRequirements` of `action` asks first, as a plain object. */
export const requirements = (t: Table, action: object) => (t.engine.getPlayRequirements(action as never) as unknown) as Array<{ kind: string; [key: string]: unknown }>;

/** The candidates of the `players` requirement, or undefined when the action does not ask for a player. */
export function askedPlayers(t: Table, action: object): PlayerId[] | undefined {
  const needs = requirements(t, action);
  const first = needs.find((need) => need.kind === "players");
  if (!first) return undefined;
  const choices = first.choices as Array<{ id: string; candidates: PlayerId[] }>;
  assert.equal(choices.length, 1, "exactly one player is asked for");
  assert.equal(choices[0]!.id, "opponent");
  return choices[0]!.candidates;
}

import { character } from "../../per-card/_harness.js";

export const answerPlayer =(t: Table, who: PlayerId, playerId: PlayerId): void =>
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "choosePlayer", playerId } });

export const answerTargets = (t: Table, who: PlayerId, selected: CardInstanceId[]): void =>
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } });

export const zoneOf = (t: Table, key: string) => t.engine.state.cards[t.id(key)]!.zone;
export const controllerOf = (t: Table, key: string) => t.engine.state.cards[t.id(key)]!.controllerId;
export const influenceOf = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;
export const handSize = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.hand.length;
export const deckSize = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.deck.length;
export const tokensOn = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.counters?.token ?? 0;

/** Passes every response so the open stack resolves; stops at a pending choice. */
export const settle = (t: Table): void => resolvePendingResponses(t.engine);

/** Plays `key` from hand as `who` (default P1) and settles the response window. */
export function playAs(t: Table, key: string, extra: Record<string, unknown> = {}, who: PlayerId = P1): void {
  t.engine.perform({ type: "playCard", playerId: who, cardId: t.id(key), ...extra } as GameAction);
  settle(t);
}

/** Activates ability `abilityId` of `key` as `who` (default P1) and settles the response window. */
export function activateAs(t: Table, key: string, abilityId: string, extra: Record<string, unknown> = {}, who: PlayerId = P1): void {
  t.engine.perform({ type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, ...extra } as GameAction);
  settle(t);
}

/** Filler hand cards (plain characters) for `owner`, keys `<prefix>0..n-1`. */
export function handOf(prefix: string, n: number, owner: PlayerId, make: (index: number) => CardDefinition): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: make(index), owner, zone: "hand" as const }));
}

/** Filler deck cards, top first. */
export function deckOf(prefix: string, n: number, owner: PlayerId, make: (index: number) => CardDefinition = (index) => character({ name: `${prefix}${index}` })): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: make(index), owner, zone: "deck" as const }));
}

/** Ids of the cards the open `chooserSelectsTarget` prompt offers its player, sorted. */
export function pickable(t: Table): CardInstanceId[] {
  const pc = pending(t);
  assert.ok(pc?.kind === "chooserSelectsTarget" || pc?.kind === "selectTargets", `a pick is open (found ${pc?.kind})`);
  const declaration = (pc!.kind === "selectTargets" ? (pc!.declarations as unknown[])[0] : pc!.declaration) as { selector: never };
  return t.engine
    .targetCandidates(declaration.selector, pc!.context as never, pc!.playerId)
    .map((card) => card.id)
    .sort();
}

/** Answers the open pick (`chooserSelectsTarget`, or the single declaration of a `selectTargets`) with `ids`. */
export function answerPick(t: Table, who: PlayerId, ids: CardInstanceId[]): void {
  const pc = pending(t);
  if (pc?.kind === "selectTargets") {
    const declarations = pc.declarations as Array<{ id: string }>;
    t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "selectTargets", selected: { [declarations[0]!.id]: ids } } });
  } else answerTargets(t, who, ids);
}

/** The ids of `keys`, sorted (to compare with `pickable`). */
export const idsOf = (t: Table, keys: string[]): CardInstanceId[] => keys.map((key) => t.id(key)).sort();

export const statOf = (t: Table, key: string, stat: "strength" | "life" | "speed") => t.engine.getStat(t.id(key), stat) as number;

/** `n` plain characters in every seat's hand: `<prefix><i>-<seat>`. */
export function hands(count: number, n = 2, prefix = "h", make?: (seat: PlayerId, index: number) => CardDefinition): CardPlacement[] {
  return seatsFor(count).flatMap((seat) =>
    Array.from({ length: n }, (_, i) => ({
      key: `${prefix}${i}-${seat}`,
      def: make ? make(seat, i) : character({ name: `${prefix}${i} ${seat}` }),
      owner: seat,
      zone: "hand" as const
    }))
  );
}

/** Ends `who`'s turn (default the active player) and lets every response pass; whatever the turn change raises stays pending. */
export function endTurn(t: Table, who: PlayerId = t.engine.state.activePlayerId): void {
  t.engine.perform({ type: "endTurn", playerId: who });
  settle(t);
}

/** Answers the open `choosePlayer` prompt with `playerId` after checking who is asked and which players are offered. */
export function choosePlayer(t: Table, asked: PlayerId, offered: PlayerId[], playerId: PlayerId): void {
  const pc = pending(t);
  assert.equal(pc?.kind, "choosePlayer", `a choosePlayer prompt is open (found ${pc?.kind})`);
  assert.equal(pc!.playerId, asked, "the right player chooses");
  assert.deepEqual([...(pc!.candidates as PlayerId[])].sort(), [...offered].sort(), "the offered players");
  answerPlayer(t, asked, playerId);
}

/** Orders `who`'s deck: `keys` top first (the cards must already be in that deck). */
export function setDeck(t: Table, who: PlayerId, keys: string[]): void {
  t.engine.state.players[who]!.deck = keys.map((key) => t.id(key));
}

export const topOf = (t: Table, who: PlayerId): CardInstanceId | undefined => t.engine.state.players[who]!.deck[0];

/** Whether every key in `keys` sits in `zone`. */
export const allIn = (t: Table, keys: string[], zone: string): boolean => keys.every((key) => zoneOf(t, key) === zone);

export { resourceCard as plainResource };
