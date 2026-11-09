// Helpers shared by the 1st Edition Part 2 multiplayer clause test files (`1st-edition-part-2*.test.ts`).

import assert from "node:assert/strict";
import { autoResolveBattle, banks, character, item, killTactic, location, tactic, resourceCard } from "../../per-card/_harness.js";
import type { CardDefinition, CardInstanceId, PlayerId } from "../../../../engine.js";
import { answerPending, pending } from "../_board.js";
import { declineAll, drain, type PendingChoiceLike } from "../_clause.js";
import { choosePlayer, handOf, deckOf, open, P1, P2, P3, P4, playCard, activate, resolvePendingResponses, seatsOf, stack, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";

export { banks, character, item, killTactic, location, tactic, resourceCard };
export { answerPending, pending, choosePlayer, handOf, deckOf, open, P1, P2, P3, P4, playCard, activate, resolvePendingResponses, seatsOf, stack, table, zoneOf };
export type { CardPlacement, Count, Table, CardDefinition, CardInstanceId, PlayerId };

/** Plenty of staple resources of every icon for `owner` (pays any threshold and any numeric cost the tests need). */
export const fund = (owner: PlayerId = P1, n = 4): CardPlacement[] => banks(n, owner);

/** Plain characters `<prefix>0..n-1` for `owner` in `zone`. */
export function fillers(prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"]): CardPlacement[] {
  return stack(prefix, n, owner, zone, (i) => character({ name: `${prefix} ${i}` }));
}

/** Every seat gets `hand` cards in hand (`h-<seat>-i`), `deck` in its deck (`d-<seat>-i`) and `discard` in its discard pile (`x-<seat>-i`). */
export function perSeat(count: Count, sizes: { hand?: number; deck?: number; discard?: number }): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    ...fillers(`h-${seat}-`, sizes.hand ?? 0, seat, "hand"),
    ...fillers(`d-${seat}-`, sizes.deck ?? 0, seat, "deck"),
    ...fillers(`x-${seat}-`, sizes.discard ?? 0, seat, "discard")
  ]);
}

/** The seats other than `who`. */
export const othersOf = (t: Table, who: PlayerId = P1): PlayerId[] => t.seats.filter((seat) => seat !== who);

/** The open `chooserSelectsTarget`: who picks, and exactly which cards the engine accepts for the pick. */
export function openPick(t: Table): { playerId: PlayerId; candidates: CardInstanceId[]; min: number; max: number } {
  const pc = pending(t.engine);
  assert.ok(pc && pc.kind === "chooserSelectsTarget", `a chooserSelectsTarget prompt should be open, got ${pc?.kind}`);
  const p = pc as unknown as {
    playerId: PlayerId;
    declaration: never;
    context: { sourceId: string; controllerId: string; abilityId?: string; selected: Record<string, string[]>; variables?: Record<string, number> };
  };
  const [step] = t.engine.getSelectionRequirements({
    sourceId: p.context.sourceId,
    controllerId: p.context.controllerId,
    pickerId: p.playerId,
    abilityId: p.context.abilityId,
    declarations: [p.declaration],
    costs: [],
    selected: p.context.selected,
    variables: p.context.variables ?? {},
    context: p.context
  } as never) as Array<{ kind: string; candidates: CardInstanceId[]; min: number; max: number }>;
  assert.ok(step && step.kind === "pick", "the prompt has a pick step");
  return { playerId: p.playerId, candidates: [...step.candidates], min: step.min, max: step.max };
}

/** Asserts the open pick belongs to `who` and offers exactly `keys`' cards (any order), then answers it with `chosen`. */
export function pickFrom(t: Table, who: PlayerId, offered: string[], chosen: string[]): void {
  const pick = openPick(t);
  assert.equal(pick.playerId, who, "the player who picks");
  assert.deepEqual([...pick.candidates].sort(), offered.map((key) => t.id(key)).sort(), "exactly these cards are offered");
  answerPending(t.engine, "chooserSelectsTarget", { selected: chosen.map((key) => t.id(key)) });
}

/** Answers the open pick with `chosen` (nothing is asserted about the offer). */
export const answerPick = (t: Table, chosen: string[]): void => answerPending(t.engine, "chooserSelectsTarget", { selected: chosen.map((key) => t.id(key)) });

/** The cards of `who`'s hand, as keys (for the keys given). */
export const inHand = (t: Table, who: PlayerId, keys: string[]): string[] => keys.filter((key) => handOf(t, who).includes(t.id(key)));

/** `playersNeeded`'s candidates for the `opponent` answer of `action`, or undefined when nobody is asked. */
export function opponentChoices(t: Table, action: Record<string, unknown>): PlayerId[] | undefined {
  const needs = t.engine.getPlayRequirements(action as never);
  const first = needs[0];
  if (!first || first.kind !== "players") return undefined;
  const entry = (first.choices as Array<{ id: string; candidates: PlayerId[] }>).find((choice) => choice.id === "opponent");
  return entry ? [...entry.candidates] : undefined;
}

/** What a play or activation has to name first: exactly `expected` for the `opponent` answer. */
export function assertAsksOpponent(t: Table, action: Record<string, unknown>, expected: PlayerId[]): void {
  assert.deepEqual(opponentChoices(t, action)?.sort(), [...expected].sort(), "the opponent is asked first, offering every other player still in the game");
}

/** The action that plays `key`. */
export const playAction = (t: Table, who: PlayerId, key: string, extra: Record<string, unknown> = {}) => ({ type: "playCard", playerId: who, cardId: t.id(key), ...extra });
/** The action that activates `abilityId` of `key`. */
export const activateAction = (t: Table, who: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, ...extra });

/** Passes the turn from `who` to the next seat, closing every response window (no prompts are expected: the seats have no Develop choices). */
export function pass(t: Table, who: PlayerId): void {
  t.engine.perform({ type: "endTurn", playerId: who } as never);
  resolvePendingResponses(t.engine);
}

/**
 * Answers the "order your triggers" prompts a turn start raises (taking the first listed each time, or the one whose
 * source card is `first`), then closes the response windows. Leaves any other prompt open.
 */
export function orderStart(t: Table, first?: string): void {
  for (let n = 0; n < 10; n++) {
    const pc = pending(t.engine) as unknown as { kind: string; playerId: PlayerId; triggers: Array<{ sourceId?: string; cardId?: string }> } | undefined;
    if (!pc || pc.kind !== "orderTriggers") break;
    const wanted = first ? pc.triggers.find((trigger) => (trigger.sourceId ?? trigger.cardId) === t.id(first)) : undefined;
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: wanted ?? pc.triggers[0] } } as never);
  }
  resolvePendingResponses(t.engine);
}

export const seatOf = (t: Table, index: number): PlayerId => t.seats[index]!;

/** Answers the open prompts of a battle: a "choose a player" prompt fails the test (battle text never asks for the opponent, MPQ-P8), everything else is declined unless `answer` handles it. */
export type BattleAnswer = (pc: PendingChoiceLike) => unknown | undefined;

/**
 * `attacker` attacks `target` with `attackers` (keys); the defender declares `blockers` (keys, possibly none); the battle
 * runs to its end, with every pending choice answered by `answer` (default: decline) and every response window passed.
 * Returns the list of prompts that were shown, as `kind:playerId`.
 */
export function fightOut(
  t: Table,
  attacker: PlayerId,
  attackers: string[],
  target: { faction: PlayerId } | { card: string },
  blockers: string[] = [],
  answer: BattleAnswer = () => undefined
): string[] {
  const shown: string[] = [];
  const to = "faction" in target ? { type: "faction", playerId: target.faction } : { type: "card", cardId: t.id(target.card) };
  const defender = "faction" in target ? target.faction : t.engine.state.cards[t.id(target.card)]!.controllerId;
  t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackers.map((key) => t.id(key)), target: to } as never);
  resolvePendingResponses(t.engine);
  const handle = (pc: PendingChoiceLike): unknown => {
    shown.push(`${pc.kind}:${pc.playerId}`);
    assert.notEqual(pc.kind, "choosePlayer", "battle text never asks for the opponent: it is the other side of the battle");
    return answer(pc) ?? declineAll(pc);
  };
  if (t.engine.state.pendingChoice) drain(t.engine, handle);
  t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: blockers.map((key) => t.id(key)) } as never);
  for (let guard = 0; (t.engine.state.battle || t.engine.state.pendingChoice) && guard < 40; guard++) {
    if (t.engine.state.pendingChoice) drain(t.engine, handle);
    else autoResolveBattle(t.engine);
  }
  assert.equal(t.engine.state.battle, undefined, "the battle finished");
  return shown;
}

/** Passes the turn around the table until it is `who`'s turn, settling every turn start's "order your triggers" prompt on the way. */
export function passUntil(t: Table, who: PlayerId): void {
  for (let guard = 0; t.engine.state.activePlayerId !== who && guard < 10; guard++) {
    pass(t, t.engine.state.activePlayerId);
    orderStart(t);
  }
}

/** The logged events of `type` so far (`cardsRevealed`, `cardDestroyed`, ...), loosely typed. */
export const events = (t: Table, type: string): Array<Record<string, unknown>> =>
  t.engine.getLog().flatMap((entry) => (entry.event?.type === type ? [entry.event as unknown as Record<string, unknown>] : []));

/** A free tactic with a threshold of `icons` (`"rr"`): playing it draws its controller one card. */
export const drawTactic = (name: string, icons = ""): CardDefinition =>
  tactic({ name, cost: 0, threshold: icons, behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never });

/** A free tactic that takes `who`'s faction to 0 when played (a real elimination). */
export const finisher = (who: PlayerId): CardDefinition =>
  tactic({
    name: `Finish ${who}`,
    cost: 0,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: { type: "player", id: who }, amount: -99 }] }] } as never
  });

/** The cards that may be picked by `who` for pick `declaration` of the card `key` in their hand, as keys among `among`. */
export function pickableBy(t: Table, who: PlayerId, key: string, declaration: string, among: string[], extra: Record<string, unknown> = {}): string[] {
  const offered = t.engine.getPickCandidates({ type: "playCard", playerId: who, cardId: t.id(key), ...extra } as never, declaration);
  return among.filter((k) => offered.includes(t.id(k)));
}
