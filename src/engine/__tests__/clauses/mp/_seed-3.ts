// Shared helpers for the Seed 3 multiplayer clause tests (clauses/mp/seed-3-*.test.ts): a table of 3 or 4 seats built
// from the real catalog printings, plus small drivers for the choices a "your opponent" block raises.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { bank } from "../../per-card/_harness.js";
import type { StapleIcon } from "../../per-card/_harness.js";
import { buildGame, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";

export { P1, P2, P3, P4, resolvePendingResponses };
export type { CardPlacement, PlayerId, SpoilsEngine, CardDefinition, CardInstanceId };

export const SEAT_IDS: PlayerId[] = [P1, P2, P3, P4];
export const seatsOf = (count: number): PlayerId[] => SEAT_IDS.slice(0, count);
/** The seats after P1 (the controller of the card under test). */
export const othersOf = (count: number): PlayerId[] => seatsOf(count).slice(1);

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => CardInstanceId;
  seats: PlayerId[];
}

export interface TableOptions {
  /** The active player (default P1). */
  active?: PlayerId;
  /** Faction cards by seat; every seat without one has a faction with no Develop Rule (no start-of-turn prompts). */
  factions?: Partial<Record<PlayerId, CardDefinition>>;
  influence?: Partial<Record<PlayerId, number>>;
  turn?: number;
}

/** A game at `count` seats with `cards` placed. Setup is complete; nothing else is in play. */
export function table(count: number, cards: CardPlacement[], options: TableOptions = {}): Table {
  const seats = seatsOf(count);
  const faction = (seat: PlayerId): CardDefinition => options.factions?.[seat] ?? noDevelopFaction();
  const setup = (seat: PlayerId) => ({
    faction: faction(seat),
    ...(options.influence?.[seat] !== undefined ? { influence: options.influence[seat] } : {})
  });
  const built = buildGame({
    playerA: setup(P1),
    playerB: setup(P2),
    extraPlayers: seats.slice(2).map(setup),
    cards,
    activePlayerId: options.active ?? P1,
    ...(options.turn !== undefined ? { turn: options.turn } : {})
  });
  return { engine: built.engine, id: built.id, seats };
}

/** `n` face-up staple resources of `icon` in play for `owner`. */
export const staples = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] => bank(icon, n, owner);

/** `n` plain cards of `def` for `owner` in `zone`, keyed `<prefix>0..`. */
export function cardsOf(prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"], def: (index: number) => CardDefinition): CardPlacement[] {
  return Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: def(index), owner, zone }));
}

export const pending = (t: Table) => t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; [key: string]: unknown } | undefined;
export const zoneOf = (t: Table, key: string) => t.engine.state.cards[t.id(key)]!.zone;
export const influence = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;
export const handOf = (t: Table, who: PlayerId): CardInstanceId[] => [...t.engine.state.players[who]!.hand];
export const deckOf = (t: Table, who: PlayerId): CardInstanceId[] => [...t.engine.state.players[who]!.deck];
export const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;
export const tokensOn = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.counters?.token ?? 0;

/** Lets every response pass until the stack resolves or a choice opens. */
export const settle = (t: Table): void => resolvePendingResponses(t.engine);

/** Answers the open choice as `who`, then lets the responses pass again. */
export function answer(t: Table, who: PlayerId, choice: Record<string, unknown>): void {
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice } as never);
  settle(t);
}

/** Asserts the open choice is of `kind` and belongs to `who`, and returns it. */
export function expectChoice(t: Table, kind: string, who: PlayerId): NonNullable<ReturnType<typeof pending>> {
  const pc = pending(t);
  assert.ok(pc, `expected a ${kind} choice for ${who}, none is open`);
  assert.equal(pc.kind, kind, `open choice is ${pc.kind}`);
  assert.equal(pc.playerId, who, `the ${kind} choice belongs to ${pc.playerId}`);
  return pc;
}

/** The cards the open chooserSelectsTarget offers its chooser (the engine's own candidate check). */
export function offered(t: Table): CardInstanceId[] {
  const pc = pending(t) as unknown as { kind: string; playerId: PlayerId; declaration: { selector: never }; context: never };
  assert.equal(pc?.kind, "chooserSelectsTarget", "a chooserSelectsTarget is open");
  return t.engine.targetCandidates(pc.declaration.selector, pc.context, pc.playerId).map((card) => card.id);
}

/** `who` picks `ids` for the open chooserSelectsTarget. */
export const pickTargets = (t: Table, who: PlayerId, ids: CardInstanceId[]): void => answer(t, who, { kind: "chooserSelectsTarget", selected: ids });

/** A tactic that moves one chosen character to its owner's hand (id `b`, declaration `t`). */
export const bounce = (name = "Bounce") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    } as CardDefinition["behavior"]
  });

/** A tactic that destroys one chosen character (id `k`, declaration `t`). */
export const kill = (name = "Kill") =>
  tactic({
    name,
    cost: 0,
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
