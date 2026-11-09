// Helpers shared by the 2nd Edition multiplayer clause files (`2nd-edition*.test.ts` in this folder).

import assert from "node:assert/strict";
import { autoResolveBattle, character } from "../../per-card/_harness.js";
import { answerPending } from "../_board.js";
import { declineAll, drain, refused } from "../_clause.js";
import type { PlayerId } from "../../../../engine.js";
import { buildGame, noDevelopFaction } from "../../support/fixtures.js";
import { P1, P2, endTurn, playersNeeded, playRaw, resolvePendingResponses, seatsOf, table, zoneOf, open, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";

export const COUNTS = [3, 4] as const;
export const others = (count: Count, ...except: PlayerId[]): PlayerId[] => seatsOf(count).slice(1).filter((seat) => !except.includes(seat));
export const ids = (t: Table, ...keys: string[]) => keys.map((key) => t.id(key));

/** Cards for `seat`'s hand, keyed `<prefix>0..`. */
export const handCards = (seat: PlayerId, defs: Array<ReturnType<typeof character>>, prefix = `h-${seat}-`): CardPlacement[] => defs.map((def, i) => ({ key: `${prefix}${i}`, def, owner: seat, zone: "hand" }));
/** `n` plain characters named `<label> <i>` for `seat` in `zone`. */
export const plain = (label: string, n: number, seat: PlayerId, zone: CardPlacement["zone"]): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${label}${i}`, def: character({ name: `${label} ${i}` }), owner: seat, zone }));

export const passPriority = (t: Table): PlayerId => {
  const who = t.engine.state.responseWindow!.priorityPlayerId;
  t.engine.perform({ type: "passPriority", playerId: who });
  return who;
};

/** Everyone who is offered the card `key` (on top of the stack), in order, until it resolves. */
export function offersFor(t: Table, key: string): PlayerId[] {
  const offered: PlayerId[] = [];
  for (let guard = 0; guard < 12; guard++) {
    const window = t.engine.state.responseWindow;
    const top = t.engine.state.responseStack[t.engine.state.responseStack.length - 1];
    if (window?.phase !== "acceptingResponses" || top?.sourceId !== t.id(key)) break;
    offered.push(passPriority(t));
  }
  return offered;
}

export interface Silenced {
  /** The board: the card (key "card") in P1's hand and what its play needs. */
  cards: (count: Count) => CardPlacement[];
  /** The player whose turn it is. */
  active?: PlayerId;
  /** Brings the game to the point where P1 may play the card (a response to something, a tactic played earlier). */
  prepare?: (t: Table) => void;
}

function silencedTable(spec: Silenced, count: Count): Table {
  const t = table(count, spec.cards(count), spec.active ?? P1);
  spec.prepare?.(t);
  return t;
}

/** "Your opponent cannot respond to this card": the opponent is asked for, the named one is skipped, the others are offered the card clockwise, the controller never is. */
export function silencedFlow(spec: Silenced, count: Count): void {
  {
    const t = silencedTable(spec, count);
    assert.deepEqual(playersNeeded(t, { type: "playCard", playerId: P1, cardId: t.id("card") }), [{ id: "opponent", candidates: seatsOf(count).slice(1) }], "P1 is asked which opponent cannot respond");
  }
  for (const silenced of others(count)) {
    const t = silencedTable(spec, count);
    playRaw(t, P1, "card", { players: { opponent: silenced } });
    const offered = offersFor(t, "card");
    assert.deepEqual(offered, others(count, silenced), `the player who cannot respond (${silenced}) is skipped; everyone else is offered the card clockwise`);
    resolvePendingResponses(t.engine);
    assert.notEqual(zoneOf(t, "card"), "hand", "it was played");
  }
  // Only one opponent left: it is the opponent, nobody is asked, and nobody can respond.
  const t = silencedTable(spec, count);
  for (const gone of others(count).slice(1)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
  assert.equal(playersNeeded(t, { type: "playCard", playerId: P1, cardId: t.id("card") }), undefined, "no choice with one opponent left");
  playRaw(t, P1, "card");
  assert.deepEqual(offersFor(t, "card"), [], "the only opponent cannot respond, so nobody is offered the card");
}

export const ability = (effects: unknown[]) => ({ abilities: [{ id: "go", type: "activated", effects }] }) as never;

/** P2's character "ping" uses an ability on P2's turn; every player ahead of P1 passes, so P1 may respond. */
export function respondToAbility(t: Table): void {
  t.engine.perform({ type: "activateAbility", playerId: P2, cardId: t.id("ping"), abilityId: "go" } as never);
  for (let guard = 0; guard < 6 && t.engine.state.responseWindow!.priorityPlayerId !== P1; guard++) passPriority(t);
  assert.equal(t.engine.state.responseWindow!.priorityPlayerId, P1, "P1 may respond");
}
export const pinger = (): CardPlacement => ({ key: "ping", def: character({ name: "Pinger", behavior: ability([{ type: "draw", player: "controller", amount: 1 }]) }), owner: P2 });

/** Asserts the open prompt is a `kind` prompt for `who`, and answers it with `choice`. */
export function answerFor(t: Table, who: PlayerId, kind: string, choice: Record<string, unknown>): void {
  const pc = open(t);
  assert.ok(pc, `a ${kind} prompt for ${who} should be open`);
  assert.equal(pc.kind, kind);
  assert.equal(pc.playerId, who, `${kind} is answered by ${who}`);
  answerPending(t.engine, kind, choice);
}
export const pickFor = (t: Table, who: PlayerId, selected: string[]): void => answerFor(t, who, "chooserSelectsTarget", { selected });

/** The candidate card ids of the open pick prompt. */
export function candidatesOf(t: Table): string[] {
  const pc = t.engine.state.pendingChoice as unknown as { candidates?: string[] } | undefined;
  assert.ok(pc?.candidates, "an open prompt with candidates");
  return pc.candidates;
}

/** The cards the open `chooserSelectsTarget` prompt lets its chooser pick (what the engine would accept), sorted. */
export function pickable(t: Table): string[] {
  const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration?: { selector: unknown }; context?: unknown } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget", "a pick prompt is open");
  const engine = t.engine as unknown as { targetCandidates(selector: unknown, context: unknown, pickerId: string): Array<{ id: string }> };
  return engine.targetCandidates(pc!.declaration!.selector, pc!.context, pc!.playerId).map((card) => card.id).sort();
}

/** Eliminates every opponent of P1 except `keep` (a table where only one opponent is left). */
export function eliminateAllBut(t: Table, keep: PlayerId = P2): void {
  for (const seat of t.seats.slice(1)) if (seat !== keep) t.engine.state.players[seat]!.eliminated = { turn: 1 };
}

/** The `{ id: "opponent", candidates }` entry a play or activation needs first at a table of `count` seats. */
export const opponentChoice = (count: Count) => [{ id: "opponent", candidates: seatsOf(count).slice(1) }];

export interface Asked {
  who: PlayerId;
  kind: string;
  /** The declaration id of a pick prompt. */
  decl?: string;
}

/**
 * Answers every open prompt with `answer` (declining whatever it returns `undefined` for) until none is left, and
 * returns who was asked what, in order.
 */
export function drive(t: Table, answer: (pc: { kind: string; playerId: PlayerId; declaration?: { id: string }; [key: string]: unknown }, asked: Asked[]) => unknown | undefined = () => undefined): Asked[] {
  const asked: Asked[] = [];
  resolvePendingResponses(t.engine);
  drain(t.engine, (pc) => {
    const entry: Asked = { who: pc.playerId as PlayerId, kind: pc.kind, ...((pc.declaration as { id?: string } | undefined)?.id ? { decl: (pc.declaration as { id: string }).id } : {}) };
    asked.push(entry);
    return answer(pc as never, asked) ?? declineAll(pc);
  });
  return asked;
}

/**
 * `attacker` attacks `defender`'s faction (or the card `targetKey`) with the characters `attackerKeys`; the defender
 * blocks with `blockerKeys`; the battle is played to its end. Every prompt on the way is answered by `answer`
 * (declining what it returns `undefined` for) and recorded.
 */
export function battle(
  t: Table,
  attacker: PlayerId,
  attackerKeys: string[],
  defender: PlayerId,
  blockerKeys: string[] = [],
  answer: (pc: { kind: string; playerId: PlayerId; declaration?: { id: string }; [key: string]: unknown }) => unknown | undefined = () => undefined,
  targetKey?: string
): Asked[] {
  const asked: Asked[] = [];
  const target = targetKey ? { type: "card", cardId: t.id(targetKey) } : { type: "faction", playerId: defender };
  t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackerKeys.map((key) => t.id(key)), target } as never);
  resolvePendingResponses(t.engine);
  const handle = (pc: { kind: string; playerId: PlayerId; declaration?: { id: string }; [key: string]: unknown }): unknown => {
    // A lasting "your opponent" of a card that was set straight into play is selected on the first action; not part of the battle.
    if (pc.kind === "choosePlayer" && (pc.bind as { type?: string } | undefined)?.type === "lasting") return { kind: "choosePlayer", playerId: (pc.candidates as string[])[0] };
    asked.push({ who: pc.playerId, kind: pc.kind, ...(pc.declaration?.id ? { decl: pc.declaration.id } : {}) });
    return answer(pc) ?? declineAll(pc);
  };
  drain(t.engine, handle);
  if (t.engine.state.battle) {
    t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: blockerKeys.map((key) => t.id(key)) } as never);
    for (let guard = 0; guard < 30 && (t.engine.state.battle || t.engine.state.pendingChoice); guard++) {
      if (t.engine.state.pendingChoice) drain(t.engine, handle);
      else autoResolveBattle(t.engine);
    }
  }
  assert.equal(t.engine.state.battle, undefined, "the battle finished");
  return asked;
}

export { refused };

/** `table` with a fixed random source (a coin flip: `() => 0.1` always wins, `() => 0.9` always loses). */
export function tableWithRandom(count: Count, cards: CardPlacement[], random: () => number, active: PlayerId = P1): Table {
  const built = buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    activePlayerId: active,
    random,
    cards
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}
export const WIN = () => 0.1;
export const LOSE = () => 0.9;

/** Answers whatever is open the way a passive table would: first trigger first, first opponent, first option, decline the rest. */
export const passive = (pc: { kind: string; [key: string]: unknown }): unknown => {
  if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
  if (pc.kind === "choosePlayer") return { kind: "choosePlayer", playerId: (pc.candidates as string[])[0] };
  return declineAll(pc);
};

/** Passes turns (every prompt answered passively) until `target`'s turn is about to start, then starts it and answers only the trigger ordering. */
export function startOfTurn(t: Table, target: PlayerId): void {
  const order = seatsOf(t.seats.length as Count).filter((seat) => !t.engine.state.players[seat]!.eliminated);
  const before = order[(order.indexOf(target) + order.length - 1) % order.length]!;
  for (let guard = 0; guard < 8 && t.engine.state.activePlayerId !== before; guard++) {
    endTurn(t, t.engine.state.activePlayerId);
    drain(t.engine, passive);
  }
  assert.equal(t.engine.state.activePlayerId, before);
  endTurn(t, before);
  assert.equal(t.engine.state.activePlayerId, target, `it is ${target}'s turn`);
  while (open(t)?.kind === "orderTriggers") {
    const pc = t.engine.state.pendingChoice as unknown as { playerId: string; triggers: unknown[] };
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers[0] } } as never);
  }
}

/** A tactic of P1 that destroys the character named `name` (anyone's). */
export const killTactic = (name: string) =>
  ({
    id: `kill-${name}`,
    name: `Kill ${name}`,
    type: "tactic",
    set: "Test",
    trade: "universal",
    rarity: "common",
    cost: 0,
    threshold: 0,
    subtype: [],
    text: "",
    behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", name }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  }) as never;
