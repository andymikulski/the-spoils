// Shared helpers for the multiplayer clause tests (clauses/mp/*.test.ts): a table of 3 or 4 seats with real
// catalog printings, driven through the engine's public actions only.

import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { buildGame, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import { declineAll, drain, printing } from "../_clause.js";
import type { PendingChoiceLike } from "../_clause.js";

export { P1, P2, P3, P4, bank, declineAll, drain, printing };
export type { CardPlacement, PendingChoiceLike };

export const SEATS: PlayerId[] = [P1, P2, P3, P4];
export const seatsOf = (count: number): PlayerId[] => SEATS.slice(0, count);

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

/** A `count`-seat game (3 or 4) with no Develop choices, `cards` placed, P1 (or `active`) to move. */
export function table(count: number, cards: CardPlacement[], active: PlayerId = P1): Table {
  const built = buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    activePlayerId: active,
    turn: SEATS.indexOf(active) + 1,
    random: () => 0.5,
    cards
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}

/** `n` ready resources of one staple icon for `owner`. */
export const res = (icon: Parameters<typeof bank>[0], n: number, owner: PlayerId = P1): CardPlacement[] => bank(icon, n, owner);

/** `n` plain placements `<prefix>0..n-1` for `owner` in `zone` (`def(i)` builds each card). */
export function many(prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"], def: (i: number) => CardPlacement["def"]): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: def(i), owner, zone }));
}

export const pending = (engine: SpoilsEngine): PendingChoiceLike | undefined => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
export const zoneOf = (engine: SpoilsEngine, id: CardInstanceId): string => engine.state.cards[id]!.zone;
export const hand = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p]!.hand];
export const deck = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p]!.deck];
export const influence = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p]!.influence;

type Opts = { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number>; players?: Record<string, PlayerId>; mode?: number };

/** `playerId` plays `cardId` (a pick, named players, ...) and lets the responses pass; stops at a pending choice. */
export function play(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, opts: Opts = {}): void {
  engine.perform({
    type: "playCard",
    playerId,
    cardId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.players ? { players: opts.players } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {})
  } as never);
  resolvePendingResponses(engine);
}

/** `playerId` activates `abilityId` of `cardId` and lets the responses pass. */
export function activate(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, abilityId: string, opts: Opts = {}): void {
  engine.perform({
    type: "activateAbility",
    playerId,
    cardId,
    abilityId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.players ? { players: opts.players } : {})
  } as never);
  resolvePendingResponses(engine);
}

/** The engine's own list of what a play or an ability use still needs (`players` choices first, then picks). */
export function requirements(engine: SpoilsEngine, action: Record<string, unknown>): Array<{ kind: string; [key: string]: unknown }> {
  return engine.getPlayRequirements(action as never) as never;
}

/** The candidate players of the `players` requirement, or `undefined` when no player is asked for. */
export function askedPlayers(engine: SpoilsEngine, action: Record<string, unknown>): Array<{ id: string; candidates: PlayerId[] }> | undefined {
  const need = requirements(engine, action).find((entry) => entry.kind === "players");
  return need ? (need.choices as Array<{ id: string; candidates: PlayerId[] }>) : undefined;
}

/** Answers the open pending choice (asserting its kind) and lets responses pass. */
export function answer(engine: SpoilsEngine, kind: string, choice: Record<string, unknown> = {}): void {
  const pc = pending(engine);
  if (!pc) throw new Error(`answer(): no pending choice (expected ${kind})`);
  if (pc.kind !== kind) throw new Error(`answer(): pending choice is ${pc.kind}, expected ${kind}`);
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind, ...choice } } as never);
  resolvePendingResponses(engine);
}

/** Answers a `choosePlayer` prompt with `playerId`. */
export const choosePlayer = (engine: SpoilsEngine, playerId: PlayerId): void => answer(engine, "choosePlayer", { playerId });

export const ready = (engine: SpoilsEngine, p: PlayerId): number => engine.getAvailableResourceCount(p);
