// Shared scaffolding of the Ungodly Mess multiplayer clause tests (mp/ungodly-mess-NN.test.ts): a table of 2 to 4 seats
// built from real catalog printings, plays and activations through `perform`, and readers for what the engine asks.
import type { PlayerId, SpoilsEngine } from "../../../../engine.js";
import { bank, buildGame, P1, P2, resolvePendingResponses } from "../../per-card/_harness.js";
import { P3, P4, type CardPlacement } from "../../support/fixtures.js";
import { plainSeats } from "../../rules/_mpTable.js";
import { pending as pendingChoice } from "../_board.js";

export { P1, P2, P3, P4 };
export type Table = ReturnType<typeof buildGame> & { seats: PlayerId[] };
export const SEATS = [P1, P2, P3, P4];

/**
 * A table of `count` seats (turn 2, `active` to move), real seats without a Develop Rule so nothing is drawn or asked.
 * `random` overrides the engine's coin.
 */
export function table(count: number, cards: CardPlacement[], active: PlayerId = P1, random?: () => number): Table {
  const built = buildGame({ ...plainSeats(count), turn: 2, activePlayerId: active, cards, ...(random ? { random } : {}) });
  return { ...built, seats: SEATS.slice(0, count) };
}

/** Whether `owner` sits at a table of `seats` seats (a placement for a missing seat would be unknown). */
export const seated = (owner: PlayerId, seats: number): boolean => SEATS.indexOf(owner) < seats;

/** Performs `action` and lets every response pass; stops at a pending choice. */
export const act = (t: Table, action: Record<string, unknown>): void => {
  t.engine.perform(action as never);
  resolvePendingResponses(t.engine);
};
export const play = (t: Table, who: PlayerId, key: string, extra: Record<string, unknown> = {}): void =>
  act(t, { type: "playCard", playerId: who, cardId: t.id(key), selected: {}, variables: {}, ...extra });
/** `play` without letting the responses pass: the card waits on the stack. */
export const playRaw = (t: Table, who: PlayerId, key: string, extra: Record<string, unknown> = {}): void =>
  t.engine.perform({ type: "playCard", playerId: who, cardId: t.id(key), selected: {}, variables: {}, ...extra } as never);
export const activate = (t: Table, who: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): void =>
  act(t, { type: "activateAbility", playerId: who, cardId: t.id(key), abilityId, selected: {}, variables: {}, ...extra });
export const pass = (t: Table, who: PlayerId): void => t.engine.perform({ type: "passPriority", playerId: who } as never);

export const pending = (t: Table) => pendingChoice(t.engine);
export const answerChoice = (t: Table, choice: Record<string, unknown>): void => {
  const pc = pendingChoice(t.engine)!;
  act(t, { type: "resolvePendingChoice", playerId: pc.playerId, choice });
};
export const choose = (t: Table, selected: string[]): void => answerChoice(t, { kind: "chooserSelectsTarget", selected });
export const chooseIndex = (t: Table, index: number): void => answerChoice(t, { kind: "chooserSelectsOption", index });
export const choosePlayer = (t: Table, playerId: PlayerId): void => answerChoice(t, { kind: "choosePlayer", playerId });
export const mayPay = (t: Table, pay: boolean): void => answerChoice(t, { kind: "mayPay", pay });

type Requirement = { kind: string; choices?: Array<{ id: string; candidates: PlayerId[] }>; candidates?: string[] };
/** What the engine asks for before the play or activation `action` can be performed. */
export const requirements = (t: Table, action: Record<string, unknown>): Requirement[] => t.engine.getPlayRequirements(action as never) as unknown as Requirement[];
/** The player choice the action asks for (`undefined` when none is asked). */
export const playerAsk = (t: Table, action: Record<string, unknown>): { id: string; candidates: PlayerId[] } | undefined =>
  requirements(t, action).find(need => need.kind === "players")?.choices?.[0];

/** The cards the open `chooserSelectsTarget` offers its chooser. */
export function offered(t: Table): string[] {
  const pc = pendingChoice(t.engine) as unknown as { kind: string; playerId: PlayerId; declaration: { selector: never }; context: never };
  return t.engine.targetCandidates(pc.declaration.selector, pc.context, pc.playerId).map(card => card.id);
}

export const handOf = (e: SpoilsEngine, who: PlayerId): string[] => [...e.state.players[who]!.hand];
export const ready = (e: SpoilsEngine, who: PlayerId): number => e.getAvailableResourceCount(who);
export const influence = (e: SpoilsEngine, who: PlayerId): number => e.state.players[who]!.influence;
export const keys = (placements: CardPlacement[]): string[] => placements.map(placement => placement.key);
export const hasKey = (t: Table, ids: string[], keyList: string[]): boolean => keyList.every(key => ids.includes(t.id(key)));

/** `n` rage resources of `owner` already attached to (spent on) their faction. */
export function spent(owner: PlayerId, n: number, seats: number): CardPlacement[] {
  if (!seated(owner, seats)) return [];
  const faction = owner === P1 ? "__factionA" : owner === P2 ? "__factionB" : `__faction_${owner}`;
  return bank("rage", n, owner).map(placement => ({ ...placement, attachedToKey: faction }));
}
