// Shared board helpers for the Decade of Deckadence multiplayer clause tests (decade-of-deckadence-NN.test.ts):
// a real 3- or 4-seat game built from the real catalog printings, driven only through `perform`.

import assert from "node:assert/strict";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import type { StapleIcon } from "../../per-card/_harness.js";
import type { CardDefinition, CardInstanceId, GameAction, PlayerId, SpoilsEngine, Zone } from "../../../../engine.js";

export { P1, P2, P3, P4, character, tactic, resolvePendingResponses };

export const SEATS: PlayerId[] = [P1, P2, P3, P4];
export type Count = 3 | 4;

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

export interface TableOptions {
  activePlayerId?: PlayerId;
  turn?: number;
}

/** A game of `count` seats in which no faction has a Develop Rule, so a turn can pass without start-of-turn prompts. */
export function table(count: Count, cards: CardPlacement[], options: TableOptions = {}): Table {
  const seats = SEATS.slice(0, count);
  const built = buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    ...options,
    cards
  });
  return { engine: built.engine, id: built.id, seats };
}

/** Staple resources for P1 (or `owner`): `res({ obsession: 6 })`. */
export function res(icons: Partial<Record<StapleIcon, number>>, owner: PlayerId = P1): CardPlacement[] {
  return (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));
}

/** `n` plain cards `<prefix>0..n-1` of `owner` in `zone`. */
export function plain(prefix: string, n: number, owner: PlayerId, zone: Zone, def: (index: number) => CardDefinition = (i) => character({ name: `${prefix} ${i}`, speed: 1 })): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: def(index), owner, zone }));
}

/** One plain character per seat in play, keyed `c-<seat>`. */
export function oneEach(seats: PlayerId[]): CardPlacement[] {
  return seats.map((owner) => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}`, life: 5 }), owner, zone: "play" as const }));
}

/** A free tactic that destroys the picked character (the way a card in these tests gets destroyed). */
export const KILL = tactic({
  name: "Test Kill",
  behavior: {
    abilities: [
      {
        id: "k",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  } as CardDefinition["behavior"]
});

// --- actions ------------------------------------------------------------------

export const pending = (t: Table) => t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; candidates?: PlayerId[]; [key: string]: unknown } | undefined;

/** Performs `action`, then lets every open response window close (stopping at a pending choice). */
export function act(t: Table, action: GameAction): void {
  t.engine.perform(action);
  resolvePendingResponses(t.engine);
}

export function playCard(t: Table, player: PlayerId, key: string, extra: Record<string, unknown> = {}): void {
  act(t, { type: "playCard", playerId: player, cardId: t.id(key), ...extra } as GameAction);
}

export function activate(t: Table, player: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): void {
  act(t, { type: "activateAbility", playerId: player, cardId: t.id(key), abilityId, ...extra } as GameAction);
}

/** The pending choice, which must be of `kind` for `player`. */
export function expectPending(t: Table, kind: string, player: PlayerId): NonNullable<ReturnType<typeof pending>> {
  const choice = pending(t);
  assert.ok(choice, `a ${kind} choice for ${player} is pending`);
  assert.equal(choice.kind, kind);
  assert.equal(choice.playerId, player);
  return choice;
}

/** No choice is pending and no response window is open. */
export function expectIdle(t: Table, why = "nothing is pending"): void {
  assert.equal(pending(t), undefined, why);
}

/** `chooser` answers the pending "which player" question with `playerId`, after checking who is asked and the offered players. */
export function choosePlayer(t: Table, chooser: PlayerId, offered: PlayerId[], playerId: PlayerId): void {
  const choice = expectPending(t, "choosePlayer", chooser);
  assert.deepEqual([...(choice.candidates ?? [])].sort(), [...offered].sort(), "the players offered");
  t.engine.perform({ type: "resolvePendingChoice", playerId: chooser, choice: { kind: "choosePlayer", playerId } });
  resolvePendingResponses(t.engine);
}

/** The cards the pending `chooserSelectsTarget` offers its chooser. */
export function offered(t: Table): CardInstanceId[] {
  const choice = pending(t) as unknown as {
    kind: string;
    playerId: PlayerId;
    declaration: never;
    context: { sourceId: string; controllerId: PlayerId; abilityId?: string; selected: Record<string, string[]>; variables?: Record<string, number> };
  };
  assert.equal(choice?.kind, "chooserSelectsTarget");
  const steps = t.engine.getSelectionRequirements({
    sourceId: choice.context.sourceId,
    controllerId: choice.context.controllerId,
    pickerId: choice.playerId,
    ...(choice.context.abilityId ? { abilityId: choice.context.abilityId } : {}),
    declarations: [choice.declaration],
    costs: [],
    selected: choice.context.selected,
    variables: choice.context.variables ?? {},
    context: choice.context
  } as never);
  const pick = steps.find((step) => step.kind === "pick") as { candidates: CardInstanceId[] } | undefined;
  assert.ok(pick, "the choice offers a pick");
  return [...pick.candidates];
}

/** `chooser` selects `keys` in the pending `chooserSelectsTarget`, which must be theirs. */
export function select(t: Table, chooser: PlayerId, keys: string[]): void {
  expectPending(t, "chooserSelectsTarget", chooser);
  t.engine.perform({ type: "resolvePendingChoice", playerId: chooser, choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => t.id(key)) } });
  resolvePendingResponses(t.engine);
}

/** Answers the pending `chooserSelectsOption` of `chooser` with option `index`. */
export function option(t: Table, chooser: PlayerId, index: number): void {
  expectPending(t, "chooserSelectsOption", chooser);
  t.engine.perform({ type: "resolvePendingChoice", playerId: chooser, choice: { kind: "chooserSelectsOption", index } });
  resolvePendingResponses(t.engine);
}

/** Answers the pending `mayPay` of `chooser`. */
export function mayPay(t: Table, chooser: PlayerId, pay: boolean): void {
  expectPending(t, "mayPay", chooser);
  t.engine.perform({ type: "resolvePendingChoice", playerId: chooser, choice: { kind: "mayPay", pay } });
  resolvePendingResponses(t.engine);
}

// --- reading the board --------------------------------------------------------

export const influence = (t: Table, player: PlayerId): number => t.engine.state.players[player]!.influence;
export const hand = (t: Table, player: PlayerId): CardInstanceId[] => [...t.engine.state.players[player]!.hand];
export const deck = (t: Table, player: PlayerId): CardInstanceId[] => [...t.engine.state.players[player]!.deck];
export const discard = (t: Table, player: PlayerId): CardInstanceId[] => [...t.engine.state.players[player]!.discard];
export const zoneOf = (t: Table, key: string): Zone => t.engine.state.cards[t.id(key)]!.zone;
export const factionOf = (t: Table, player: PlayerId): CardInstanceId => t.engine.state.players[player]!.factionId!;

export type Snapshot = Record<PlayerId, number>;
/** Every seat's influence now. */
export const snapshot = (t: Table): Snapshot => Object.fromEntries(t.seats.map((seat) => [seat, influence(t, seat)]));
/** How much influence `player` lost since `before`. */
export const lost = (t: Table, before: Snapshot, player: PlayerId): number => before[player]! - influence(t, player);

/** Hand sizes of every seat. */
export const handSizes = (t: Table): Record<PlayerId, number> => Object.fromEntries(t.seats.map((seat) => [seat, hand(t, seat).length]));

/** A free tactic that destroys one picked card of any type (a location, a character...). */
export const KILL_ANY = tactic({
  name: "Test Demolish",
  behavior: {
    abilities: [
      {
        id: "k",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  } as CardDefinition["behavior"]
});

/** Whether the engine accepts `choice` for the pending choice of `player`, without performing it. */
export function accepts(t: Table, player: PlayerId, choice: Record<string, unknown>): boolean {
  return t.engine.checkAction({ type: "resolvePendingChoice", playerId: player, choice } as GameAction).ok;
}

/** The ids of cards `keys`. */
export const ids = (t: Table, keys: string[]): CardInstanceId[] => keys.map((key) => t.id(key));

/** The cards the pending `selectTargets` (a trigger's pick) offers for declaration `declarationId`. */
export function offeredTargets(t: Table, declarationId: string): CardInstanceId[] {
  const choice = pending(t) as unknown as {
    kind: string;
    playerId: PlayerId;
    sourceId: string;
    abilityId?: string;
    declarations: Array<{ id: string }>;
    context?: unknown;
  };
  assert.equal(choice?.kind, "selectTargets");
  const steps = t.engine.getSelectionRequirements({
    sourceId: choice.sourceId,
    controllerId: choice.playerId,
    ...(choice.abilityId ? { abilityId: choice.abilityId } : {}),
    declarations: choice.declarations,
    costs: [],
    selected: {},
    variables: {},
    ...(choice.context ? { context: choice.context } : {})
  } as never);
  const pick = steps.find((step) => step.kind === "pick" && (step as unknown as { requirement: { id: string } }).requirement.id === declarationId) as { candidates: CardInstanceId[] } | undefined;
  assert.ok(pick, `the choice offers pick ${declarationId}`);
  return [...pick.candidates];
}

/** `player` answers the pending `selectTargets` with `selected` (declaration id to card keys). */
export function pickTargets(t: Table, player: PlayerId, selected: Record<string, string[]>): void {
  expectPending(t, "selectTargets", player);
  const mapped = Object.fromEntries(Object.entries(selected).map(([id, keys]) => [id, keys.map((key) => t.id(key))]));
  t.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "selectTargets", selected: mapped } });
  resolvePendingResponses(t.engine);
}

/** What a play or ability use still needs from `player` (`getPlayRequirements`), for the action as built so far. */
export function needs(t: Table, action: Record<string, unknown>) {
  return t.engine.getPlayRequirements({ selected: {}, variables: {}, ...action } as never) as unknown as Array<{
    kind: string;
    choices?: Array<{ id: string; candidates: PlayerId[] }>;
    candidates?: CardInstanceId[];
    requirement?: { id: string };
  }>;
}

/** The open response window's priority player. */
export const priority = (t: Table): PlayerId | undefined => t.engine.state.responseWindow?.priorityPlayerId;
