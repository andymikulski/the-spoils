// Small generic board / choice helpers for clause tests (docs/TESTING.md),
// requested by the open-beta-03 pilot to cut per-batch boilerplate.

import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { character, resolvePendingResponses } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { withoutDevelopChoices } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { isDevelopPrompt, settleStartFirst } from "./_turn.js";

/** The open pending choice (loosely typed), or undefined. */
export const pending = (engine: SpoilsEngine): PendingChoiceLike | undefined =>
  engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;

/** Answers the open pending choice with `choice` (asserting its kind) and drains response windows. Throws if none is open or the kind differs. */
export function answerPending(engine: SpoilsEngine, kind: string, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  if (!pc) throw new Error(`answerPending(): no pending choice (expected ${kind})`);
  if (pc.kind !== kind) throw new Error(`answerPending(): pending choice is ${pc.kind}, expected ${kind}`);
  const answeredDevelop = isDevelopPrompt(engine);
  // The Develop Rule cannot be skipped: a turn that starts as a result offers the factions no Develop choices (it only passes through).
  const answer = (): void => {
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind, ...choice } } as never);
    resolvePendingResponses(engine);
  };
  if (answeredDevelop) answer();
  else withoutDevelopChoices(engine, answer);
  // A turn that starts as a result raises the faction's Restore / Develop Rule alongside the cards' triggers: settle them
  // (it is not what these tests drive), so the next prompt is a card's own.
  if (!answeredDevelop && kind !== "orderTriggers") settleStartFirst(engine);
}

/**
 * `n` placements of plain filler cards (`character({ name })` by default) with
 * keys `<prefix>0..n-1` — deck / hand / discard padding. In a deck, index 0 is
 * placed first; check `engine.state.players[p].deck` for the resulting order.
 */
export function fillers(
  prefix: string,
  n: number,
  owner: PlayerId,
  zone: CardPlacement["zone"],
  def: (index: number) => CardDefinition = (index) => character({ name: `${prefix} ${index}` })
): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: def(index), owner, zone }));
}

/** `playerId` declares `blockerIds` (possibly none) in the current battle. */
export function declareBlockers(engine: SpoilsEngine, playerId: PlayerId, blockerIds: CardInstanceId[]): void {
  engine.perform({ type: "declareBlockers", playerId, blockerIds });
}

/** Zone of a card instance. */
export const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;

/** Tokens on a card instance. */
export const tokensOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters?.token ?? 0;

/** Resources `playerId` can still spend. */
export const readyResources = (engine: SpoilsEngine, playerId: PlayerId): number => engine.getAvailableResourceCount(playerId);
