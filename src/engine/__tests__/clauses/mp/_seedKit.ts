// Helpers shared by the Seed multiplayer clause files (seed-01 ... seed-NN).

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, GameAction, PlayerId } from "../../../../engine.js";
import { character } from "../../per-card/_harness.js";
import { buildGame, defaultFactionDefinition, factionCard, item, noDevelopFaction, resourceCard } from "../../support/fixtures.js";
import { answerPending } from "../_board.js";
import { refused } from "../_clause.js";
import {
  choosePlayer,
  open,
  P1,
  P2,
  P3,
  P4,
  playersNeeded,
  resolvePendingResponses,
  seatsOf,
  stack,
  table,
  type CardPlacement,
  type Count,
  type Table
} from "./_seatsSeed2ndFirstP2.js";

export { answerPending, character, choosePlayer, open, P1, P2, P3, P4, playersNeeded, refused, resolvePendingResponses, seatsOf, stack, table };
export type { CardPlacement, Count, Table };
export { activate, deckOf, handOf, playCard, playRaw, settled, zoneOf } from "./_seatsSeed2ndFirstP2.js";

/**
 * Every seat's hand: two characters, an item and a resource card (keys `ch0-<seat>`, `ch1-<seat>`, `it-<seat>`,
 * `rs-<seat>`), four deck cards (`d-<seat>-0..3`, 0 on top) and one character in play (`c-<seat>`).
 */
export function mixedHands(count: Count): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    { key: `ch0-${seat}`, def: character({ name: `Char A ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `ch1-${seat}`, def: character({ name: `Char B ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `it-${seat}`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `rs-${seat}`, def: resourceCard({ name: `Resource ${seat}` }), owner: seat, zone: "hand" as const },
    ...[0, 1, 2, 3].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })),
    { key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const }
  ]);
}

/** A faction with no Restore Rule and no Develop choices: its owner's start of turn restores and draws nothing. */
export const quietFaction = (): CardDefinition =>
  factionCard({
    faction: defaultFactionDefinition({ turn: { restore: { detachResources: false, restoreNonResources: false }, develop: { choices: [] } } })
  });

/**
 * Like `table`, with chosen factions: `factions[seat]` is that seat's faction card (default: no Develop choices),
 * `quiet` gives every other seat a faction with no Restore or Develop rule.
 */
export function tableWith(count: Count, cards: CardPlacement[], factions: Partial<Record<PlayerId, CardDefinition>> = {}, active: PlayerId = P1, quiet = false): Table {
  const seats = seatsOf(count);
  const factionOf = (seat: PlayerId): CardDefinition => factions[seat] ?? (quiet ? quietFaction() : noDevelopFaction());
  const built = buildGame({
    playerA: { faction: factionOf(P1) },
    playerB: { faction: factionOf(P2) },
    extraPlayers: seats.slice(2).map((seat) => ({ faction: factionOf(seat) })),
    activePlayerId: active,
    cards
  });
  return { engine: built.engine, id: built.id, seats };
}

/** Passes priority for whoever holds it until `who` holds it in the open response window. */
export function passUntil(t: Table, who: PlayerId): void {
  for (let guard = 0; guard < 8; guard++) {
    const window = t.engine.state.responseWindow;
    assert.ok(window?.phase === "acceptingResponses", "the response window is open");
    if (window.priorityPlayerId === who) return;
    t.engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
  }
  assert.fail(`${who} never got priority`);
}

/** Opponents of P1 at a table. */
export const opponents = (t: Table): PlayerId[] => t.seats.slice(1);

/** Plain filler cards for every seat: `h-<seat>-0..<hand-1>` in hand and `d-<seat>-0..<deck-1>` in the deck. */
export function fillSeats(count: Count, hand = 3, deck = 5): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    ...stack(`h-${seat}-`, hand, seat, "hand", (i) => character({ name: `Hand ${seat} ${i}` })),
    ...stack(`d-${seat}-`, deck, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` }))
  ]);
}

/** Asserts that `action` first asks P1 for its opponent, offering exactly `candidates` (default: every other seat). */
export function assertOpponentAsked(t: Table, action: GameAction, candidates: PlayerId[] = opponents(t)): void {
  const choices = playersNeeded(t, action);
  assert.ok(choices, "the play should ask for the opponent first");
  assert.equal(choices[0]!.id, "opponent");
  assert.deepEqual([...choices[0]!.candidates].sort(), [...candidates].sort());
}

/** Asserts that `action` asks for no opponent (the text names none, or the opponent is fixed by the situation). */
export function assertNoOpponentAsked(t: Table, action: GameAction): void {
  const choices = playersNeeded(t, action);
  assert.ok(!choices || !choices.some((choice) => choice.id === "opponent"), "no opponent should be asked");
}

/** The activateAbility action of `playerId` for `key` / `abilityId`. */
export const abilityAction = (t: Table, playerId: PlayerId, key: string, abilityId: string, extra: Record<string, unknown> = {}): GameAction =>
  ({ type: "activateAbility", playerId, cardId: t.id(key), abilityId, ...extra }) as GameAction;

/** The playCard action of `playerId` for `key`. */
export const playAction = (t: Table, playerId: PlayerId, key: string, extra: Record<string, unknown> = {}): GameAction =>
  ({ type: "playCard", playerId, cardId: t.id(key), ...extra }) as GameAction;

/** Asserts a pending choice of `kind` is open for `who`, and answers it with `choice`. */
export function answerFor(t: Table, who: PlayerId, kind: string, choice: Record<string, unknown>): void {
  const pc = open(t);
  assert.ok(pc, `a ${kind} prompt for ${who} should be open`);
  assert.equal(pc.kind, kind);
  assert.equal(pc.playerId, who, `${kind} is answered by ${who}`);
  answerPending(t.engine, kind, choice);
}

/** `who` picks the card `key` for the open card-pick prompt. */
export const pickCard = (t: Table, who: PlayerId, key: string): void => answerFor(t, who, "chooserSelectsTarget", { selected: [t.id(key)] });

/** `who` picks none for an optional card-pick prompt. */
export const pickNone = (t: Table, who: PlayerId): void => answerFor(t, who, "chooserSelectsTarget", { selected: [] });

/** `who` answers an option prompt with option `index`. */
export const pickOption = (t: Table, who: PlayerId, index: number): void => answerFor(t, who, "chooserSelectsOption", { index });

/** The open prompt's kind, or undefined. */
export const openKind = (t: Table): string | undefined => open(t)?.kind;

/** Answers any "order your triggers" prompt with the first trigger offered, until something else is pending. */
export function orderTriggers(t: Table): void {
  for (let guard = 0; guard < 20; guard++) {
    const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; triggers?: unknown[] } | undefined;
    if (!pc || pc.kind !== "orderTriggers") return;
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers![0] } } as never);
    resolvePendingResponses(t.engine);
  }
}

/** The active player ends the turn; the next seat's turn starts and its trigger-ordering prompts are answered. */
export function passTurn(t: Table): PlayerId {
  const active = t.engine.state.activePlayerId;
  t.engine.perform({ type: "endTurn", playerId: active } as never);
  resolvePendingResponses(t.engine);
  orderTriggers(t);
  return t.engine.state.activePlayerId;
}

/** Cards of `owner` in `zone` of the engine, as keys' ids. */
export const ids = (t: Table, keys: string[]): CardInstanceId[] => keys.map((key) => t.id(key));

/** Number of cards the player has in `zone`. */
export const countIn = (t: Table, who: PlayerId, zone: "hand" | "deck" | "discard" | "play"): number => t.engine.state.players[who]![zone].length;

/** Snapshot of hand / deck / discard sizes per seat. */
export function sizes(t: Table): Record<PlayerId, { hand: number; deck: number; discard: number }> {
  return Object.fromEntries(t.seats.map((seat) => [seat, { hand: countIn(t, seat, "hand"), deck: countIn(t, seat, "deck"), discard: countIn(t, seat, "discard") }]));
}

/** The influence of every seat. */
export const influences = (t: Table): Record<PlayerId, number> => Object.fromEntries(t.seats.map((seat) => [seat, t.engine.state.players[seat]!.influence]));

export interface Prompt {
  kind: string;
  playerId: PlayerId;
  declarationId?: string;
}

/**
 * Answers every open prompt with `handler` (it returns the choice without its `kind`) until none is open, and returns
 * who was asked what, in order. Trigger-ordering prompts are answered with the first trigger.
 */
export function runPrompts(t: Table, handler: (pc: { kind: string; playerId: PlayerId; [key: string]: unknown }) => Record<string, unknown>, budget = 60): Prompt[] {
  const asked: Prompt[] = [];
  for (let guard = 0; guard < budget; guard++) {
    resolvePendingResponses(t.engine);
    const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; declaration?: { id: string }; triggers?: unknown[]; [key: string]: unknown } | undefined;
    if (!pc) return asked;
    if (pc.kind === "orderTriggers") {
      t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers![0] } } as never);
      continue;
    }
    asked.push({ kind: pc.kind, playerId: pc.playerId, ...(pc.declaration ? { declarationId: pc.declaration.id } : {}) });
    answerPending(t.engine, pc.kind, handler(pc));
  }
  throw new Error("runPrompts: too many prompts");
}

/** Every event of `type` in the game log. */
export function eventsOf(t: Table, type: string): Array<Record<string, unknown>> {
  return t.engine.getLog().flatMap((entry) => (entry.event?.type === type ? [entry.event as unknown as Record<string, unknown>] : []));
}

/** The previous seat in turn order (the player whose turn ends into `seat`'s). */
export const seatBefore = (t: Table, seat: PlayerId): PlayerId => t.seats[(t.seats.indexOf(seat) + t.seats.length - 1) % t.seats.length]!;
