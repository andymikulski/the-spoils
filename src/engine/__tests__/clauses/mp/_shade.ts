// Shared board helpers for the Shade of the Devoured Emperor multiplayer clause tests (shade-of-the-devoured-emperor-*.test.ts).
// P1 is the controller of the card under test; P2 sits to its left.
import assert from "node:assert/strict";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../../support/fixtures.js";
import type { CardDefinition, GameAction, PlayerId, SpoilsEngine } from "../../../../engine.js";

export { P1, P2, P3, P4 };
export type Pid = PlayerId;
export type Board = ReturnType<typeof buildGame>;
export type Placement = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>[number];
export type Answers = Record<string, Pid>;
export type PC = { kind: string; playerId: Pid; [key: string]: unknown };
type Extra = { selected?: Record<string, string[]>; players?: Answers; variables?: Record<string, number>; mode?: number };

export const SEATS: Pid[] = [P1, P2, P3, P4];

/** A game of `seats` players (no develop rule, so nothing is asked at turn changes) with `cards` placed. */
export function table(seats: 3 | 4, cards: Placement[], options: { active?: Pid; turn?: number; influence?: Partial<Record<Pid, number>> } = {}): Board {
  const at = (player: Pid) => ({ faction: noDevelopFaction(), ...(options.influence?.[player] !== undefined ? { influence: options.influence[player]! } : {}) });
  return buildGame({
    playerA: at(P1),
    playerB: at(P2),
    extraPlayers: SEATS.slice(2, seats).map(at),
    cards,
    ...(options.active ? { activePlayerId: options.active } : {}),
    ...(options.turn ? { turn: options.turn } : {})
  });
}

export const pcOf = (e: SpoilsEngine): PC | undefined => e.state.pendingChoice as unknown as PC | undefined;
export const infl = (e: SpoilsEngine, p: Pid): number => e.state.players[p].influence;
export const zone = (b: Board, key: string): string => b.engine.state.cards[b.id(key)]!.zone;
export const hand = (e: SpoilsEngine, p: Pid): string[] => e.state.players[p].hand;
export const deck = (e: SpoilsEngine, p: Pid): string[] => e.state.players[p].deck;
export const controllerOf = (b: Board, key: string): Pid => b.engine.state.cards[b.id(key)]!.controllerId;
export const tokens = (b: Board, key: string): number => b.engine.state.cards[b.id(key)]!.counters?.token ?? 0;
export const stat = (b: Board, key: string, name: "strength" | "life" | "speed"): number => b.engine.getStat(b.id(key), name);
export const alive = (e: SpoilsEngine, p: Pid): boolean => !e.state.players[p].eliminated;

/** A character `owner` owns and controls, in play. */
export const unit = (owner: Pid, key: string, over: Partial<CardDefinition> = {}): Placement => ({ key, def: character({ name: `Char ${key}`, ...over }), owner, zone: "play" });
/** `n` characters in `owner`'s hand / deck (filler to draw, discard or look at). */
export const filler = (owner: Pid, where: "hand" | "deck" | "discard", n: number, prefix = where): Placement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}-${owner}-${i}`, def: character({ name: `Filler ${prefix} ${owner} ${i}` }), owner, zone: where }));

export const play = (b: Board, who: Pid, key: string, extra: Extra = {}): GameAction => ({ type: "playCard", playerId: who, cardId: b.id(key), ...extra });
export const use = (b: Board, who: Pid, key: string, abilityId: string, extra: Omit<Extra, "mode"> = {}): GameAction => ({
  type: "activateAbility",
  playerId: who,
  cardId: b.id(key),
  abilityId,
  ...extra
});

/** Performs `action`, then lets every response pass (stops at the first pending choice). */
export function go(b: Board, action: GameAction): void {
  b.engine.perform(action);
  resolvePendingResponses(b.engine);
}
export function answer(b: Board, who: Pid, choice: unknown): void {
  b.engine.perform({ type: "resolvePendingChoice", playerId: who, choice } as never);
  resolvePendingResponses(b.engine);
}
export const pickOption = (b: Board, who: Pid, index: number): void => answer(b, who, { kind: "chooserSelectsOption", index });
export const pickCards = (b: Board, who: Pid, keys: string[]): void => answer(b, who, { kind: "chooserSelectsTarget", selected: keys.map((key) => b.id(key)) });
export const pay = (b: Board, who: Pid, yes: boolean, kind: "mayPay" | "anyPlayerMayPay" | "alternatingPay" = "mayPay"): void => answer(b, who, { kind, pay: yes });
export const choosePlayer = (b: Board, who: Pid, playerId: Pid): void => answer(b, who, { kind: "choosePlayer", playerId });

/** The first requirement list `getPlayRequirements` gives for `action`. */
export const needs = (b: Board, action: GameAction) => b.engine.getPlayRequirements(action as never);

/** The cards a pending `chooserSelectsTarget` offers its chooser. */
export function offered(b: Board): string[] {
  const pc = pcOf(b.engine) as unknown as { playerId: Pid; declaration: never; context: { sourceId: string; controllerId: Pid } };
  const found = b.engine.getSelectionRequirements({
    sourceId: pc.context.sourceId,
    controllerId: pc.context.controllerId,
    pickerId: pc.playerId,
    declarations: [pc.declaration],
    costs: [],
    selected: {},
    variables: {},
    context: pc.context as never
  } as never);
  return ((found[0] as { candidates?: string[] } | undefined)?.candidates ?? []).slice();
}
/** The candidates of the pick `needs` lists for `action`: the pick declared as `id`, else the first one. */
export function pickCandidates(b: Board, action: GameAction, id?: string): string[] {
  const found = needs(b, action).find((r) => r.kind === "pick" && (id === undefined || (r as unknown as { requirement: { id: string } }).requirement.id === id)) as { candidates?: string[] } | undefined;
  return (found?.candidates ?? []).slice();
}

/** Answers every `orderTriggers` prompt (a turn start raising several triggers) by taking the first one each time. */
export function settleOrder(b: Board): void {
  for (let guard = 0; guard < 10 && pcOf(b.engine)?.kind === "orderTriggers"; guard++) {
    const pc = pcOf(b.engine) as unknown as { playerId: Pid; triggers: unknown[] };
    answer(b, pc.playerId, { kind: "orderTriggers", next: pc.triggers[0] });
  }
}

/** A tactic in P1's hand that makes `victim`'s faction lose 99 influence: a real action that eliminates them. */
export const doom = (victim: Pid, key = "doom"): Placement => ({
  key,
  owner: P1,
  zone: "hand",
  def: tactic({ name: `Doom ${victim}`, behavior: { abilities: [{ id: "doom", type: "activated", effects: [{ type: "modifyInfluence", player: { type: "player", id: victim }, amount: -99 }] }] } })
});

/** Plays a battle through with `onChoice` answering prompts (it returns a choice, or undefined to stop on that prompt). */
export function fight(b: Board, onChoice: (pc: PC) => unknown | undefined): void {
  const e = b.engine;
  for (let guard = 0; guard < 80 && e.state.battle; guard++) {
    const pc = pcOf(e);
    if (pc) {
      const choice = onChoice(pc);
      assert.ok(choice !== undefined, `unexpected prompt ${pc.kind} for ${pc.playerId}`);
      e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
      continue;
    }
    if (e.state.responseWindow) {
      resolvePendingResponses(e);
      continue;
    }
    const battle = e.state.battle!;
    if (battle.phase === "blocking") {
      e.perform({ type: "declareBlockers", playerId: battle.defenderPlayerId, blockerIds: [] });
      continue;
    }
    const view = e.getBattleView();
    if (view?.actingPlayerId) {
      e.perform({
        type: "assignBattleDamage",
        playerId: view.actingPlayerId,
        assignments: view.damageSources
          .filter((source) => source.strength > 0 && source.legalTargets.length > 0)
          .map((source) => ({ sourceId: source.cardId, target: source.legalTargets[0]!, amount: source.strength }))
      });
    } else {
      e.perform({ type: "advanceFlow" });
    }
  }
}
