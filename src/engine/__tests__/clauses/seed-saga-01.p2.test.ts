// Clause tests, batch seed-saga-01, part p2 (groups 7-11):
// Death of the Demon Knights, Defiler of Innocence, Desolate, Encumber, Enter The Demon Knights (Seed Saga).
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, printing, refused } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ------------------------------------------------

const FACTION_KEY: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

/** `n` already-SPENT resources (attached to the owner's faction): they count toward thresholds but can't pay. */
function spent(icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: FACTION_KEY[owner] }));
}

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const last = <T,>(a: T[]): T => a[a.length - 1];
const ctrl = (engine: SpoilsEngine, id: string): string => engine.state.cards[id].controllerId;

/** `refused` that can also print the refusal message (PROBE=1) to pin down patterns. */
function rf(fn: () => unknown, why: string, pattern?: RegExp): void {
  if (process.env.PROBE) {
    let m = "NO THROW";
    try {
      fn();
    } catch (e) {
      m = (e as Error).message;
    }
    console.log(`PROBE|${why}|${m}`);
    return;
  }
  refused(fn, why, pattern ?? /Illegal target|selection\(s\)|its (maximum|minimum)|whole number|cannot|not enough|available/i);
}

const answerTarget = (engine: SpoilsEngine, selected: string[]): void => answerPending(engine, "chooserSelectsTarget", { selected });

// =========================================================================================
// DEATH OF THE DEMON KNIGHTS
// =========================================================================================

const DD = "053823cb-77ae-494e-83a1-b19084e9038d";

function ddBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; mark?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DD), owner: P1, zone: "hand" },
      ...(o.res ?? bank("obsession", 7)),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("ed", 3, P2, "deck"),
      ...(o.mark === false ? [] : [{ key: "m", def: character({ name: "Mark" }), owner: P2, zone: "play" } as CardPlacement]),
      ...(o.extra ?? [])
    ]
  });
}

type DDBoard = ReturnType<typeof ddBoard>;
const ddPlay = (b: DDBoard, mark: string) => play(b.engine, P1, b.id("dd"), { selected: { mark: [b.id(mark)] } });
const x1: CardPlacement = { key: "x", def: character({ name: "Other" }), owner: P2, zone: "play" };

clause(DD, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(DD).subtype, [], "Death of the Demon Knights prints no subtype");
});

clause(DD, "0:extraCost", "printed type / trade / cost 5 / threshold [O][O][O]; exact cost works, one short or one icon short is refused", () => {
  const d0 = ddBoard();
  const def = d0.engine.getDefinition(d0.id("dd"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 5, "ooo"]);
  // exact: 5 ready, 3 of them [O]
  const b = ddBoard({ res: [...bank("obsession", 3), ...bank("rage", 2)] });
  ddPlay(b, "m");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing left to pay the optional 2 with, so no prompt");
  assert.equal(ready(b.engine), 0, "COST: 5 resources were paid");
  assert.equal(zoneOf(b.engine, b.id("dd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("m")), "deck");
  // one short
  const s = ddBoard({ res: [...bank("obsession", 3), ...bank("rage", 1)] });
  rf(() => ddPlay(s, "m"), "cost 5 with 4 ready", /Costs cannot be paid/);
  // one icon short: 5 ready but only two [O]
  const t = ddBoard({ res: [...bank("obsession", 2), ...bank("rage", 3)] });
  rf(() => ddPlay(t, "m"), "threshold [O][O][O] with two [O]", /Threshold requirements/);
});

clause(DD, "0:extraCost", "you can pick any character an opponent controls (including one you own but the opponent controls)", () => {
  for (const [label, mark] of [
    ["opponent-owned, opponent-controlled", { key: "z", def: character({ name: "Z" }), owner: P2, zone: "play" }],
    ["owned by me, controlled by the opponent", { key: "z", def: character({ name: "Z" }), owner: P1, controller: P2, zone: "play" }]
  ] as Array<[string, CardPlacement]>) {
    const b = ddBoard({ mark: false, extra: [mark] });
    ddPlay(b, "z");
    answerPending(b.engine, "mayPay", { pay: false });
    assert.equal(b.engine.state.pendingChoice, undefined, label);
    assert.equal(zoneOf(b.engine, b.id("z")), "deck", label);
  }
});

clause(DD, "0:extraCost", "you cannot pick: your own character, a character you own but control, an opponent's item, an opponent's character in hand or discard, a faction", () => {
  const bad: Array<[string, CardPlacement]> = [
    ["own character", { key: "z", def: character({ name: "Z" }), owner: P1, zone: "play" }],
    ["opponent-owned but controlled by me", { key: "z", def: character({ name: "Z" }), owner: P2, controller: P1, zone: "play" }],
    ["opponent's item", { key: "z", def: item({ name: "Z" }), owner: P2, zone: "play" }],
    ["opponent's character in hand", { key: "z", def: character({ name: "Z" }), owner: P2, zone: "hand" }],
    ["opponent's character in discard", { key: "z", def: character({ name: "Z" }), owner: P2, zone: "discard" }]
  ];
  for (const [label, card] of bad) {
    const b = ddBoard({ mark: false, extra: [card] });
    rf(() => ddPlay(b, "z"), label);
    assert.notEqual(zoneOf(b.engine, b.id("z")), "deck", label);
  }
  const b = ddBoard({ mark: false });
  rf(() => play(b.engine, P1, b.id("dd"), { selected: { mark: [b.engine.state.players[P2].factionId!] } }), "opponent's faction");
  const c = ddBoard({ mark: false });
  rf(() => play(c.engine, P1, c.id("dd"), { selected: { mark: [] } }), "no pick at all");
});

clause(DD, "0:extraCost", "you may pay 2 more: accepting spends exactly 2 more resources", () => {
  const b = ddBoard({ extra: [x1] });
  ddPlay(b, "m");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1, "the caster decides whether to pay");
  assert.equal(ready(b.engine), 2, "the 5 for the card are already paid; the optional 2 are not yet");
  answerPending(b.engine, "mayPay", { pay: true });
  answerTarget(b.engine, ["x"].map((k) => b.id(k)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 0, "5 + 2 resources paid");
});

clause(DD, "0:extraCost", "declining the 2 keeps them and the opponent picks nothing", () => {
  const b = ddBoard({ extra: [x1] });
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined, "no second pick when the 2 weren't paid");
  assert.equal(ready(b.engine), 2, "2 resources kept");
  assert.equal(zoneOf(b.engine, b.id("x")), "play");
  assert.equal(zoneOf(b.engine, b.id("m")), "deck");
});

clause(DD, "0:extraCost", "with only 5 resources you cannot pay the optional 2", () => {
  const b = ddBoard({ res: bank("obsession", 5), extra: [x1] });
  ddPlay(b, "m");
  const pc = pending(b.engine);
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    rf(() => answerPending(b.engine, "mayPay", { pay: true }), "paying 2 with no resources left");
    answerPending(b.engine, "mayPay", { pay: false });
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("x")), "play", "the other character is untouched");
  assert.equal(zoneOf(b.engine, b.id("m")), "deck");
});

clause(DD, "0:extraCost", "if you pay: that character's controller (the opponent) picks another character they control", () => {
  const b = ddBoard({ extra: [x1, { key: "y", def: character({ name: "Y" }), owner: P2, zone: "play" }] });
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: true });
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the marked character's controller makes the pick");
  answerTarget(b.engine, [b.id("y")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("y")), "deck");
  assert.equal(zoneOf(b.engine, b.id("x")), "play", "the character that was not picked stays");
  assert.equal(zoneOf(b.engine, b.id("m")), "deck");
});

clause(DD, "0:extraCost", "the controller picks 'another' character: not the marked one, not an item, not hand/discard, not the caster's characters", () => {
  const cards: CardPlacement[] = [
    x1,
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
    { key: "inh", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "ind", def: character({ name: "InDisc" }), owner: P2, zone: "discard" },
    { key: "y", def: character({ name: "Y" }), owner: P2, zone: "play" }
  ];
  const b = ddBoard({ extra: cards });
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: true });
  for (const k of ["m", "mine", "it", "inh", "ind"]) {
    rf(() => answerTarget(b.engine, [b.id(k)]), `picking ${k}`);
  }
  rf(() => answerTarget(b.engine, [b.id("x"), b.id("y")]), "picking two characters when 'another character' is one");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  answerTarget(b.engine, [b.id("x")]);
  assert.equal(zoneOf(b.engine, b.id("x")), "deck");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(zoneOf(b.engine, b.id("inh")), "hand");
  assert.equal(zoneOf(b.engine, b.id("ind")), "discard");
  assert.equal(zoneOf(b.engine, b.id("y")), "play", "only ONE other character is picked");
});

clause(DD, "0:extraCost", "the 'picks another character' is mandatory: the controller cannot pick nothing while another exists", () => {
  const b = ddBoard({ extra: [x1] });
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: true });
  rf(() => answerTarget(b.engine, []), "picking nobody while another character exists");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(DD, "0:extraCost", "if the controller has no other character, paying the 2 still works and nothing else moves", () => {
  const b = ddBoard();
  ddPlay(b, "m");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("m")), "deck");
  assert.equal(ready(b.engine), 0);
});

clause(DD, "1:rule", "puts the marked character on the bottom of its OWNER's deck (not shuffled, not the top)", () => {
  const b = ddBoard({ extra: [{ key: "own", def: character({ name: "Own" }), owner: P1, controller: P2, zone: "play" }] });
  const p1 = deckOf(b.engine, P1);
  const p2 = deckOf(b.engine, P2);
  ddPlay(b, "own");
  answerPending(b.engine, "mayPay", { pay: false });
  const after1 = deckOf(b.engine, P1);
  assert.equal(after1[after1.length - 1], b.id("own"), "bottom of the owner's (P1) deck");
  assert.deepEqual(after1.slice(0, -1).filter((c) => c !== p1[0]), p1.slice(1), "rest of the deck keeps its order (top card was drawn)");
  assert.deepEqual(deckOf(b.engine, P2), p2, "the controller's deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("m")), "play");
});

clause(DD, "1:rule", "both characters go to the bottom of their owners' decks (different owners)", () => {
  const b = ddBoard({ extra: [{ key: "own", def: character({ name: "Own" }), owner: P1, controller: P2, zone: "play" }] });
  const p2 = deckOf(b.engine, P2);
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: true });
  answerTarget(b.engine, [b.id("own")]);
  assert.deepEqual(deckOf(b.engine, P2), [...p2, b.id("m")], "marked character: bottom of P2's deck");
  assert.equal(last(deckOf(b.engine, P1)), b.id("own"), "picked character: bottom of its owner's (P1) deck");
});

clause(DD, "1:rule", "both characters from one owner land on the bottom of that deck, ahead of nothing else", () => {
  const b = ddBoard({ extra: [x1] });
  const p2 = deckOf(b.engine, P2);
  ddPlay(b, "m");
  answerPending(b.engine, "mayPay", { pay: true });
  answerTarget(b.engine, [b.id("x")]);
  const d = deckOf(b.engine, P2);
  assert.deepEqual(d.slice(0, 3), p2, "existing cards stay on top in order");
  assert.deepEqual([...d.slice(3)].sort(), [b.id("m"), b.id("x")].sort());
});

clause(DD, "1:rule", "draw a card: the caster draws exactly one (with and without paying the 2); the opponent draws none", () => {
  for (const pay of [false, true]) {
    const b = ddBoard({ extra: [x1] });
    const top = deckOf(b.engine, P1)[0];
    const oppHand = handOf(b.engine, P2).length;
    ddPlay(b, "m");
    answerPending(b.engine, "mayPay", { pay });
    if (pay) answerTarget(b.engine, [b.id("x")]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.deepEqual(handOf(b.engine, P1), [top], `pay=${pay}: the top card of my deck is in my hand (the tactic left it)`);
    assert.equal(handOf(b.engine, P2).length, oppHand, "the opponent draws nothing");
    assert.equal(zoneOf(b.engine, b.id("dd")), "discard");
  }
});

// =========================================================================================
// DEFILER OF INNOCENCE
// =========================================================================================

const DI = "48097f03-931c-4241-bfed-2ccd8e731546";

function diBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; zone?: "hand" | "play"; depleted?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "di", def: printing(DI), owner: P1, zone: o.zone ?? "play", depleted: o.depleted },
      ...(o.res ?? bank("obsession", 4)),
      ...(o.extra ?? [])
    ]
  });
}
type DIBoard = ReturnType<typeof diBoard>;
const corrupt = (b: DIBoard, target: string) => activate(b.engine, P1, b.id("di"), "corrupt", { selected: { c: [b.id(target)] } });
const ally: CardPlacement = { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" };
const foe: CardPlacement = { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" };

clause(DI, "0:ability:corrupt", "printed character / arcanist / wizard / cost 2 / [O][O][O][O] / 2 str 3 spd 1 life; exact cost works, one short or one icon short is refused", () => {
  const b0 = diBoard({ zone: "hand", res: bank("obsession", 4) });
  const def = b0.engine.getDefinition(b0.id("di"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.subtype], ["character", "arcanist", 2, "oooo", ["wizard"]]);
  // exact: 2 ready pay, two more [O] are already spent
  const b = diBoard({ zone: "hand", res: [...bank("obsession", 2), ...spent("obsession", 2)] });
  play(b.engine, P1, b.id("di"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
  assert.equal(ready(b.engine), 0, "COST: 2 resources paid");
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("di"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 1);
  // one short
  const s = diBoard({ zone: "hand", res: [...bank("obsession", 1), ...spent("obsession", 3)] });
  rf(() => play(s.engine, P1, s.id("di")), "cost 2 with 1 ready", /Costs cannot be paid/);
  // one icon short: 4 ready but only three [O]
  const t = diBoard({ zone: "hand", res: [...bank("obsession", 3), ...bank("rage", 1)] });
  rf(() => play(t.engine, P1, t.id("di")), "threshold [O]x4 with three [O]", /Threshold requirements/);
});

clause(DI, "0:ability:corrupt", "COST: pay 2; refused with only 1 resource ready", () => {
  const b = diBoard({ extra: [ally] });
  corrupt(b, "ally");
  assert.equal(ready(b.engine), 2, "2 of 4 resources were paid");
  const s = diBoard({ res: bank("obsession", 1), extra: [ally] });
  rf(() => corrupt(s, "ally"), "pay 2 with 1 ready", /Ability costs cannot be paid/);
  assert.ok(!s.engine.getKeywords(s.id("ally")).includes("covert"), "!s.engine.getKeywords(s.id(\"ally\")).includes(\"covert\")");
});

clause(DI, "0:ability:corrupt", "any character in play can be picked (mine, theirs, the Defiler itself) and gains COVERT; others do not", () => {
  const b = diBoard({ extra: [ally, foe, { key: "bystander", def: character({ name: "By" }), owner: P1, zone: "play" }] });
  for (const k of ["ally", "foe", "di"]) assert.ok(!b.engine.getKeywords(b.id(k)).includes("covert"), `${k} not covert beforehand`);
  corrupt(b, "foe");
  assert.ok(b.engine.getKeywords(b.id("foe")).includes("covert"), "opponent's character gains COVERT");
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "!b.engine.getKeywords(b.id(\"ally\")).includes(\"covert\")");
  corrupt(b, "ally");
  assert.ok(b.engine.getKeywords(b.id("ally")).includes("covert"), "my character gains COVERT");
  assert.ok(!b.engine.getKeywords(b.id("bystander")).includes("covert"), "an unpicked character does not");
  const c = diBoard({ extra: [ally] });
  corrupt(c, "di");
  assert.ok(c.engine.getKeywords(c.id("di")).includes("covert"), "it can target itself");
  assert.ok(!c.engine.getKeywords(c.id("ally")).includes("covert"), "!c.engine.getKeywords(c.id(\"ally\")).includes(\"covert\")");
});

clause(DI, "0:ability:corrupt", "the pick must be a character in play: not an item, not a hand/discard character, not a faction", () => {
  const cases: Array<[string, CardPlacement]> = [
    ["item in play", { key: "z", def: item({ name: "Z" }), owner: P1, zone: "play" }],
    ["character in hand", { key: "z", def: character({ name: "Z" }), owner: P1, zone: "hand" }],
    ["character in discard", { key: "z", def: character({ name: "Z" }), owner: P1, zone: "discard" }],
    ["character in the opponent's hand", { key: "z", def: character({ name: "Z" }), owner: P2, zone: "hand" }]
  ];
  for (const [label, card] of cases) {
    const b = diBoard({ extra: [card] });
    rf(() => corrupt(b, "z"), label);
    assert.ok(!b.engine.getKeywords(b.id("z")).includes("covert"), label);
  }
  const b = diBoard({ extra: [ally] });
  rf(() => activate(b.engine, P1, b.id("di"), "corrupt", { selected: { c: [b.engine.state.players[P2].factionId!] } }), "faction");
  corrupt(b, "ally");
  assert.ok(b.engine.getKeywords(b.id("ally")).includes("covert"), "control: a legal pick works");
});

clause(DI, "0:ability:corrupt", "the Defiler does not need to be ready to use CORRUPT (its cost is only 'Pay 2')", () => {
  const b = diBoard({ extra: [ally], depleted: true });
  corrupt(b, "ally");
  assert.ok(b.engine.getKeywords(b.id("ally")).includes("covert"), "b.engine.getKeywords(b.id(\"ally\")).includes(\"covert\")");
  assert.equal(b.engine.state.cards[b.id("di")].depleted, true);
});

clause(DI, "0:ability:corrupt", "the COVERT lasts this turn only: still there later in the turn, gone after the turn ends; it can be used again next turn", () => {
  const b = diBoard({ extra: [ally, foe] });
  corrupt(b, "ally");
  resolvePendingResponses(b.engine);
  assert.ok(b.engine.getKeywords(b.id("ally")).includes("covert"), "still covert later in the same turn");
  endTurn(b.engine, P1);
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "not covert after the turn ends");
  endTurn(b.engine, P2);
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "and not on my next turn either");
});

clause(DI, "0:ability:corrupt", "'this turn' is the whole turn, not just the battle: after a battle ends the granted COVERT is still there until the turn is over", () => {
  const b = diBoard({ extra: [ally, foe] });
  corrupt(b, "ally");
  resolvePendingResponses(b.engine);
  fightThrough(b.engine, P1, [b.id("ally")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.ok(b.engine.getKeywords(b.id("ally")).includes("covert"), "still covert after the battle, later in the same turn");
  endTurn(b.engine, P1);
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "gone after the turn ends");
});


clause(DI, "0:ability:corrupt", "a granted COVERT works: the covert attacker cannot be blocked by a non-COVERT character", () => {
  const blocker: CardPlacement = { key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" };
  const plain = diBoard({ extra: [ally, blocker] });
  declareAttackBy(plain.engine, P1, [plain.id("ally")]);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.equal(pending(plain.engine)?.kind === "declareBlockers" ? "blocking" : "ok", "ok", "control: without CORRUPT the block is legal");
  const b = diBoard({ extra: [ally, blocker] });
  corrupt(b, "ally");
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  rf(() => declareBlockers(b.engine, P2, [b.id("blk")]), "non-covert blocker against a covert attacker", /covert/i);
});

clause(DI, "1:ability:defile", "COST: deplete this card; refused when already depleted", () => {
  const hand: CardPlacement = { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" };
  const b = diBoard({ extra: [hand] });
  assert.equal(b.engine.state.cards[b.id("di")].depleted, false);
  activate(b.engine, P1, b.id("di"), "defile");
  answerTarget(b.engine, [b.id("c1")]);
  assert.equal(b.engine.state.cards[b.id("di")].depleted, true, "COST: depleted");
  const d = diBoard({ extra: [hand], depleted: true });
  rf(() => activate(d.engine, P1, d.id("di"), "defile"), "already depleted", /Ability costs cannot be paid/);
  assert.equal(zoneOf(d.engine, d.id("c1")), "hand");
});

clause(DI, "1:ability:defile", "the controller chooses a CHARACTER in the opponent's hand and the opponent discards exactly that one", () => {
  const cards: CardPlacement[] = [
    { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" },
    { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "hand" },
    { key: "tt", def: tactic({ name: "TT" }), owner: P2, zone: "hand" },
    { key: "ii", def: item({ name: "II" }), owner: P2, zone: "hand" },
    { key: "ll", def: location({ name: "LL" }), owner: P2, zone: "hand" },
    { key: "rr", def: resourceCard({ name: "RR" }), owner: P2, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" }
  ];
  const b = diBoard({ extra: cards });
  activate(b.engine, P1, b.id("di"), "defile");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose, not the opponent");
  for (const k of ["tt", "ii", "ll", "rr", "mine"]) rf(() => answerTarget(b.engine, [b.id(k)]), `picking ${k}`);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerTarget(b.engine, [b.id("c2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("c2")), "into the opponent's discard pile");
  for (const k of ["c1", "tt", "ii", "ll", "rr"]) assert.equal(zoneOf(b.engine, b.id(k)), "hand", `${k} stays`);
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "my own hand is untouched");
});

clause(DI, "1:ability:defile", "the choice is mandatory: with a character in the opponent's hand, choosing nothing is refused", () => {
  const b = diBoard({ extra: [{ key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" }] });
  activate(b.engine, P1, b.id("di"), "defile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  rf(() => answerTarget(b.engine, []), "an empty pick while a character is available");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  answerTarget(b.engine, [b.id("c1")]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard", "control: choosing the character discards it");
});


clause(DI, "1:ability:defile", "only the opponent's hand is looked at: a character in MY hand and in the opponent's board/discard are not choosable", () => {
  const cards: CardPlacement[] = [
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
    { key: "onb", def: character({ name: "OnBoard" }), owner: P2, zone: "play" },
    { key: "ond", def: character({ name: "OnDisc" }), owner: P2, zone: "discard" },
    { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" }
  ];
  const b = diBoard({ extra: cards });
  activate(b.engine, P1, b.id("di"), "defile");
  for (const k of ["mine", "onb", "ond"]) rf(() => answerTarget(b.engine, [b.id(k)]), `picking ${k}`);
  answerTarget(b.engine, [b.id("c1")]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("onb")), "play");
  assert.equal(zoneOf(b.engine, b.id("ond")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
});

clause(DI, "1:ability:defile", "with no character in the opponent's hand, nothing is discarded (the cost is still paid)", () => {
  const cards: CardPlacement[] = [
    { key: "tt", def: tactic({ name: "TT" }), owner: P2, zone: "hand" },
    { key: "rr", def: resourceCard({ name: "RR" }), owner: P2, zone: "hand" }
  ];
  const b = diBoard({ extra: cards });
  const before = handOf(b.engine, P2);
  activate(b.engine, P1, b.id("di"), "defile");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P2), before);
  assert.deepEqual(discardOf(b.engine, P2), []);
  assert.equal(b.engine.state.cards[b.id("di")].depleted, true);
});

// =========================================================================================
// DESOLATE
// =========================================================================================

const DS = "9627e39b-275c-4039-9c38-391568989439";
const MUTILATED = "946891f2-c6c7-4894-b8e4-b897ebd74472";

function chr(key: string, strength: number, owner: PlayerId = P1, extra: Partial<CardPlacement> = {}): CardPlacement {
  return { key, def: character({ name: key, strength, life: 4 }), owner, zone: "play", ...extra };
}

function dsBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...(o.res ?? [...bank("obsession", 3), ...bank("rage", 2)]),
      ...(o.extra ?? [])
    ]
  });
}
type DSBoard = ReturnType<typeof dsBoard>;
const dsPlay = (b: DSBoard, x: number) => play(b.engine, P1, b.id("ds"), { variables: { x } });

clause(DS, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(DS).subtype, [], "Desolate prints no subtype");
});

clause(DS, "0:extraCost", "printed type / trade / cost 3 / threshold [O]; exact cost works, one short or one icon short is refused", () => {
  const d0 = dsBoard();
  const def = d0.engine.getDefinition(d0.id("ds"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 3, "o"]);
  const b = dsBoard({ res: [...bank("obsession", 1), ...bank("rage", 2)] });
  dsPlay(b, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 0, "COST: 3 resources paid");
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
  const s = dsBoard({ res: [...bank("obsession", 1), ...bank("rage", 1)] });
  rf(() => dsPlay(s, 0), "cost 3 with 2 ready", /Costs cannot be paid/);
  const t = dsBoard({ res: bank("rage", 3) });
  rf(() => dsPlay(t, 0), "threshold [O] with no [O]", /Threshold requirements/);
});

clause(DS, "0:extraCost", "X may be anything from 0 up to the number of [O] you control, and no higher", () => {
  for (const x of [0, 1, 2, 3]) {
    const b = dsBoard({ extra: [chr("a", x)] });
    dsPlay(b, x);
    assert.equal(zoneOf(b.engine, b.id("a")), "discard", `X=${x} is allowed and destroys a ${x}-strength character`);
  }
  const b = dsBoard({ extra: [chr("a", 4)] });
  rf(() => dsPlay(b, 4), "X=4 with three [O]");
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
});

clause(DS, "0:extraCost", "X is bounded by [O] icons only: rage doesn't count, the opponent's [O] don't, spent [O] do", () => {
  const r = dsBoard({ res: [...bank("obsession", 1), ...bank("rage", 4), ...bank("obsession", 5, P2)], extra: [chr("a", 2)] });
  rf(() => dsPlay(r, 2), "X=2 with a single [O] of mine (4 rage, 5 opposing [O])");
  assert.equal(zoneOf(r.engine, r.id("a")), "play");
  dsPlay(r, 1);
  assert.equal(zoneOf(r.engine, r.id("ds")), "discard", "control: X=1 works");
  const s = dsBoard({ res: [...bank("obsession", 1), ...bank("rage", 2), ...spent("obsession", 2)], extra: [chr("a", 3)] });
  dsPlay(s, 3);
  assert.equal(zoneOf(s.engine, s.id("a")), "discard", "spent [O] still count as controlled: X=3 with 1 ready + 2 spent [O]");
  const u = dsBoard({ res: [...bank("obsession", 1), ...bank("rage", 2), ...spent("obsession", 2)], extra: [chr("a", 4)] });
  rf(() => dsPlay(u, 4), "X=4 with three [O] (one ready, two spent)");
});

clause(DS, "0:extraCost", "the [O] that pay the cost are still [O] you control (X up to 3 when three [O] pay the 3)", () => {
  const b = dsBoard({ res: bank("obsession", 3), extra: [chr("a", 3)] });
  dsPlay(b, 3);
  assert.equal(ready(b.engine), 0);
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
});

clause(DS, "0:extraCost", "X must be a whole number of at least 0 (no negative, no fraction)", () => {
  const b = dsBoard({ extra: [chr("a", 2)] });
  rf(() => dsPlay(b, -1), "X=-1");
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
});

clause(DS, "0:extraCost", "a fractional X (1.5) is refused", () => {
  const b = dsBoard({ extra: [chr("a", 2)] });
  rf(() => dsPlay(b, 1.5), "X=1.5");
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
});

clause(DS, "1:rule", "destroys every character with exactly X strength, from both sides; characters with other strengths survive", () => {
  const cards = [chr("m1", 2), chr("m2", 3), chr("m0", 0), chr("o1", 2, P2), chr("o2", 1, P2), chr("o3", 4, P2), chr("og", 2, P1, { controller: P2 })];
  const b = dsBoard({ extra: cards });
  dsPlay(b, 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["m1", "o1", "og"]) assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} (strength 2) is destroyed`);
  for (const k of ["m2", "m0", "o2", "o3"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} (not 2) survives`);
  assert.ok(discardOf(b.engine, P2).includes(b.id("o1")), "discardOf(b.engine, P2).includes(b.id(\"o1\"))");
  assert.ok(discardOf(b.engine, P1).includes(b.id("og")), "a card goes to its owner's discard");
});

clause(DS, "1:rule", "X=0 destroys the 0-strength characters only; X=3 the 3-strength ones only", () => {
  const cards = [chr("a0", 0), chr("b0", 0, P2), chr("a1", 1), chr("a3", 3), chr("b3", 3, P2)];
  const z = dsBoard({ extra: cards });
  dsPlay(z, 0);
  assert.deepEqual(["a0", "b0", "a1", "a3", "b3"].map((k) => zoneOf(z.engine, z.id(k))), ["discard", "discard", "play", "play", "play"]);
  const t = dsBoard({ extra: cards });
  dsPlay(t, 3);
  assert.deepEqual(["a0", "b0", "a1", "a3", "b3"].map((k) => zoneOf(t.engine, t.id(k))), ["play", "play", "play", "discard", "discard"]);
});

clause(DS, "1:rule", "only characters in play are destroyed: not hand/discard characters, items, locations or resources", () => {
  const cards: CardPlacement[] = [
    chr("inplay", 2),
    { key: "inhand", def: character({ name: "H", strength: 2 }), owner: P1, zone: "hand" },
    { key: "indisc", def: character({ name: "D", strength: 2 }), owner: P2, zone: "discard" },
    { key: "it", def: item({ name: "It", strength: 2 }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Loc", strength: 2 }), owner: P2, zone: "play" }
  ];
  const b = dsBoard({ extra: cards });
  dsPlay(b, 2);
  assert.equal(zoneOf(b.engine, b.id("inplay")), "discard");
  assert.equal(zoneOf(b.engine, b.id("inhand")), "hand");
  assert.equal(zoneOf(b.engine, b.id("indisc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  for (const k of Object.keys(b.engine.state.cards)) if (k.startsWith("bank")) assert.equal(zoneOf(b.engine, k), "play");
});

clause(DS, "1:rule", "'with X strength' is the CURRENT strength (a +1 buff counts)", () => {
  const cards = [chr("buffed", 2), chr("mine", 1), chr("plain3", 3, P2)];
  const b = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mut", def: printing(MUTILATED), owner: P1, zone: "hand" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...bank("obsession", 6),
      ...bank("rage", 6),
      ...cards
    ]
  });
  play(b.engine, P1, b.id("mut"), { selected: { mine: [b.id("mine")], buff: [b.id("buffed")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("buffed"), "strength"), 3, "setup: the buff is on");
  dsPlay(b, 2);
  assert.equal(zoneOf(b.engine, b.id("buffed")), "play", "printed strength 2, current 3: X=2 spares it");
  const c = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mut", def: printing(MUTILATED), owner: P1, zone: "hand" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...bank("obsession", 6),
      ...bank("rage", 6),
      ...cards
    ]
  });
  play(c.engine, P1, c.id("mut"), { selected: { mine: [c.id("mine")], buff: [c.id("buffed")] } });
  dsPlay(c, 3);
  assert.equal(zoneOf(c.engine, c.id("buffed")), "discard", "current 3: X=3 destroys it");
  assert.equal(zoneOf(c.engine, c.id("plain3")), "discard");
});

// =========================================================================================
// ENCUMBER
// =========================================================================================

const EN = "55946c3c-d213-4948-9656-53bb189e4d49";

function enBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; zone?: "hand" | "discard" | "removed"; owner?: PlayerId } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "en", def: printing(EN), owner: o.owner ?? P1, zone: o.zone ?? "hand" },
      ...(o.res ?? [...bank("obsession", 1), ...bank("rage", 3)]),
      ...(o.extra ?? [])
    ]
  });
}
type ENBoard = ReturnType<typeof enBoard>;
const enPlay = (b: ENBoard, t: string) => play(b.engine, P1, b.id("en"), { selected: { t: [b.id(t)] } });

clause(EN, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(EN).subtype, [], "Encumber prints no subtype");
});

clause(EN, "0:extraCost", "printed type / trade / cost 4 / threshold [O]; exact cost works, one short or one icon short is refused", () => {
  const tgt = chr("tg", 1, P2);
  const d0 = enBoard({ extra: [tgt] });
  const def = d0.engine.getDefinition(d0.id("en"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 4, "o"]);
  const b = enBoard({ extra: [tgt] });
  enPlay(b, "tg");
  assert.equal(ready(b.engine), 0, "COST: 4 resources paid");
  assert.equal(zoneOf(b.engine, b.id("en")), "discard");
  const s = enBoard({ res: [...bank("obsession", 1), ...bank("rage", 2)], extra: [tgt] });
  rf(() => enPlay(s, "tg"), "cost 4 with 3 ready", /Costs cannot be paid/);
  const t = enBoard({ res: bank("rage", 4), extra: [tgt] });
  rf(() => enPlay(t, "tg"), "threshold [O] with no [O]", /Threshold requirements/);
});

clause(EN, "0:extraCost", "you can pick any character or location in play (mine or theirs)", () => {
  const cases: Array<[string, CardPlacement]> = [
    ["opponent's character", chr("z", 1, P2)],
    ["my character", chr("z", 1, P1)],
    ["opponent's location", { key: "z", def: location({ name: "Z" }), owner: P2, zone: "play" }],
    ["my location", { key: "z", def: location({ name: "Z" }), owner: P1, zone: "play" }]
  ];
  for (const [label, card] of cases) {
    const b = enBoard({ extra: [card] });
    enPlay(b, "z");
    assert.equal(b.engine.state.pendingChoice, undefined, label);
    assert.equal(zoneOf(b.engine, b.id("z")), "hand", label);
  }
});

clause(EN, "0:extraCost", "you cannot pick an item, a resource, a faction, or a character/location outside play", () => {
  const cases: Array<[string, CardPlacement]> = [
    ["item in play", { key: "z", def: item({ name: "Z" }), owner: P2, zone: "play" }],
    ["my item in play", { key: "z", def: item({ name: "Z" }), owner: P1, zone: "play" }],
    ["character in hand", chr("z", 1, P2, { zone: "hand" })],
    ["character in discard", chr("z", 1, P2, { zone: "discard" })],
    ["location in discard", { key: "z", def: location({ name: "Z" }), owner: P2, zone: "discard" }],
    ["opposing resource in play", { key: "z", def: resourceCard({ name: "Z" }), owner: P2, zone: "play" }]
  ];
  for (const [label, card] of cases) {
    const b = enBoard({ extra: [card] });
    rf(() => enPlay(b, "z"), label);
    assert.notEqual(zoneOf(b.engine, b.id("en")), "discard", label);
  }
  const b = enBoard();
  rf(() => play(b.engine, P1, b.id("en"), { selected: { t: [b.engine.state.players[P2].factionId!] } }), "opposing faction");
  const c = enBoard();
  rf(() => play(c.engine, P1, c.id("en"), { selected: { t: [] } }), "no pick");
});

clause(EN, "1:rule", "the picked character or location goes into its OWNER's hand (not the controller's), nothing else moves", () => {
  const cards: CardPlacement[] = [
    { key: "z", def: character({ name: "Z" }), owner: P2, controller: P1, zone: "play" },
    chr("other", 1, P2),
    { key: "myloc", def: location({ name: "ML" }), owner: P1, controller: P2, zone: "play" }
  ];
  const b = enBoard({ extra: cards });
  enPlay(b, "z");
  assert.ok(handOf(b.engine, P2).includes(b.id("z")), "owner's (P2) hand");
  assert.ok(!handOf(b.engine, P1).includes(b.id("z")), "!handOf(b.engine, P1).includes(b.id(\"z\"))");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  const c = enBoard({ extra: cards });
  enPlay(c, "myloc");
  assert.ok(handOf(c.engine, P1).includes(c.id("myloc")), "a location owned by me but controlled by the opponent returns to MY hand");
  assert.equal(zoneOf(c.engine, c.id("z")), "play");
});

clause(EN, "1:rule", "the tactic itself goes to the discard pile and the target's old controller keeps the rest of the board", () => {
  const b = enBoard({ extra: [chr("z", 1, P2), chr("keep", 1, P2)] });
  enPlay(b, "z");
  assert.ok(discardOf(b.engine, P1).includes(b.id("en")), "discardOf(b.engine, P1).includes(b.id(\"en\"))");
  assert.equal(zoneOf(b.engine, b.id("keep")), "play");
  assert.equal(handOf(b.engine, P2).filter((c) => c === b.id("z")).length, 1);
});

clause(EN, "2:ability:recur", "RECUR works from my discard pile with threshold [O] and 'Pay 2': pays 2, removes this card from the game", () => {
  const hand: CardPlacement = { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" };
  const b = enBoard({ zone: "discard", res: [...bank("obsession", 1), ...bank("rage", 3)], extra: [hand] });
  activate(b.engine, P1, b.id("en"), "recur");
  answerTarget(b.engine, [b.id("c1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 2, "COST: 2 of 4 resources paid");
  assert.equal(zoneOf(b.engine, b.id("en")), "removed", "COST: removed from the game");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("en")), "!discardOf(b.engine, P1).includes(b.id(\"en\"))");
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
});

clause(EN, "2:ability:recur", "RECUR: refused with 1 resource ready; refused without an [O] (threshold); the spent [O] still satisfies the threshold", () => {
  const hand: CardPlacement = { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" };
  const s = enBoard({ zone: "discard", res: bank("obsession", 1), extra: [hand] });
  rf(() => activate(s.engine, P1, s.id("en"), "recur"), "pay 2 with 1 ready", /Ability costs cannot be paid/);
  assert.equal(zoneOf(s.engine, s.id("en")), "discard");
  const t = enBoard({ zone: "discard", res: bank("rage", 3), extra: [hand] });
  rf(() => activate(t.engine, P1, t.id("en"), "recur"), "threshold [O] with no [O]", /Ability threshold requirements/);
  assert.equal(zoneOf(t.engine, t.id("en")), "discard");
  const u = enBoard({ zone: "discard", res: [...spent("obsession", 1), ...bank("rage", 2)], extra: [hand] });
  activate(u.engine, P1, u.id("en"), "recur");
  answerTarget(u.engine, [u.id("c1")]);
  assert.equal(zoneOf(u.engine, u.id("c1")), "discard", "a spent [O] satisfies the threshold; the 2 are paid from ready rage");
  assert.equal(ready(u.engine), 0);
});

clause(EN, "2:ability:recur", "'use this only if this card is in your discard pile': refused from hand, from the void, and from the OPPONENT's discard pile", () => {
  const hand: CardPlacement = { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "hand" };
  const res = [...bank("obsession", 1), ...bank("rage", 3)];
  for (const [label, zone, owner, pat] of [
    ["in my hand", "hand", P1, /Source must be in zone 'discard'/],
    ["removed from the game", "removed", P1, /Source must be in zone 'discard'/],
    ["in the opponent's discard", "discard", P2, /You do not control/]
  ] as Array<[string, "hand" | "removed" | "discard", PlayerId, RegExp]>) {
    const b = enBoard({ zone, owner, res, extra: [hand] });
    rf(() => activate(b.engine, P1, b.id("en"), "recur"), label, pat);
    assert.equal(zoneOf(b.engine, b.id("c1")), "hand", label);
  }
  const ok = enBoard({ zone: "discard", res, extra: [hand] });
  activate(ok.engine, P1, ok.id("en"), "recur");
  answerTarget(ok.engine, [ok.id("c1")]);
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "discard", "control: from my discard pile it works");
});

clause(EN, "2:ability:recur", "I choose any NON-RESOURCE card in the opponent's hand (character, item, location, tactic); the opponent discards exactly it", () => {
  for (const [label, card] of [
    ["character", { key: "pick", def: character({ name: "P" }), owner: P2, zone: "hand" }],
    ["item", { key: "pick", def: item({ name: "P" }), owner: P2, zone: "hand" }],
    ["location", { key: "pick", def: location({ name: "P" }), owner: P2, zone: "hand" }],
    ["tactic", { key: "pick", def: tactic({ name: "P" }), owner: P2, zone: "hand" }]
  ] as Array<[string, CardPlacement]>) {
    const others: CardPlacement[] = [
      { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "hand" },
      { key: "rr", def: resourceCard({ name: "RR" }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" }
    ];
    const b = enBoard({ zone: "discard", extra: [card, ...others] });
    activate(b.engine, P1, b.id("en"), "recur");
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", label);
    assert.equal(pc.playerId, P1, `${label}: I choose`);
    answerTarget(b.engine, [b.id("pick")]);
    assert.equal(b.engine.state.pendingChoice, undefined, label);
    assert.equal(zoneOf(b.engine, b.id("pick")), "discard", label);
    assert.ok(discardOf(b.engine, P2).includes(b.id("pick")), label);
    for (const k of ["o1", "rr", "mine"]) assert.equal(zoneOf(b.engine, b.id(k)), "hand", `${label}: ${k} stays`);
  }
});

clause(EN, "2:ability:recur", "the choice is mandatory: with a non-resource card in the opponent's hand, choosing nothing is refused", () => {
  const b = enBoard({ zone: "discard", extra: [{ key: "pick", def: tactic({ name: "P" }), owner: P2, zone: "hand" }] });
  activate(b.engine, P1, b.id("en"), "recur");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  rf(() => answerTarget(b.engine, []), "an empty pick while a card is available");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  answerTarget(b.engine, [b.id("pick")]);
  assert.equal(zoneOf(b.engine, b.id("pick")), "discard", "control: choosing the card discards it");
});


clause(EN, "2:ability:recur", "a resource card in the opponent's hand, my own hand cards, and non-hand cards cannot be chosen", () => {
  const cards: CardPlacement[] = [
    { key: "rr", def: resourceCard({ name: "RR" }), owner: P2, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
    { key: "onb", def: character({ name: "OnB" }), owner: P2, zone: "play" },
    { key: "ond", def: character({ name: "OnD" }), owner: P2, zone: "discard" },
    { key: "ok", def: tactic({ name: "Ok" }), owner: P2, zone: "hand" }
  ];
  const b = enBoard({ zone: "discard", extra: cards });
  activate(b.engine, P1, b.id("en"), "recur");
  for (const k of ["rr", "mine", "onb", "ond"]) rf(() => answerTarget(b.engine, [b.id(k)]), `picking ${k}`);
  answerTarget(b.engine, [b.id("ok")]);
  assert.equal(zoneOf(b.engine, b.id("ok")), "discard");
  assert.equal(zoneOf(b.engine, b.id("rr")), "hand");
});

clause(EN, "2:ability:recur", "with only resource cards in the opponent's hand, nothing is discarded (the costs are still paid)", () => {
  const b = enBoard({ zone: "discard", extra: [{ key: "rr", def: resourceCard({ name: "RR" }), owner: P2, zone: "hand" }] });
  activate(b.engine, P1, b.id("en"), "recur");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rr")), "hand");
  assert.equal(zoneOf(b.engine, b.id("en")), "removed");
  assert.equal(ready(b.engine), 2);
});

// =========================================================================================
// ENTER THE DEMON KNIGHTS
// =========================================================================================

const ET = "1848963f-93a8-4eae-8977-f76b2547bce5";

function hc(key: string, over: Record<string, unknown> = {}, owner: PlayerId = P1, zone: "hand" | "play" | "discard" = "hand"): CardPlacement {
  return { key, def: character({ name: key, cost: 2, ...over }), owner, zone };
}
const DK = { subtype: ["geiseric", "demon knight"] };
const GS = { unique: "gloamspike" };

function etBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "et", def: printing(ET), owner: P1, zone: "hand" },
      ...(o.res ?? [...bank("obsession", 3), ...bank("rage", 1)]),
      ...(o.extra ?? [hc("c1"), hc("c2"), hc("c3")])
    ]
  });
}
type ETBoard = ReturnType<typeof etBoard>;
const etPlay = (b: ETBoard, keys: string[]) => play(b.engine, P1, b.id("et"), { selected: { revealed: keys.map((k) => b.id(k)) } });
/** Cast with the three revealed and have the opponent choose `pick`. */
function etRun(b: ETBoard, keys: string[], pick: string): void {
  etPlay(b, keys);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  answerTarget(b.engine, [b.id(pick)]);
  assert.equal(b.engine.state.pendingChoice, undefined);
}

clause(ET, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(ET).subtype, [], "Enter The Demon Knights prints no subtype");
});

clause(ET, "0:extraCost", "printed type / trade / cost 4 / threshold [O][O][O]; exact cost works, one short or one icon short is refused", () => {
  const d0 = etBoard();
  const def = d0.engine.getDefinition(d0.id("et"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 4, "ooo"]);
  const b = etBoard();
  etRun(b, ["c1", "c2", "c3"], "c1");
  assert.equal(ready(b.engine), 0, "COST: 4 resources paid (the entering characters were free)");
  assert.equal(zoneOf(b.engine, b.id("et")), "discard");
  const s = etBoard({ res: [...bank("obsession", 3)] });
  rf(() => etPlay(s, ["c1", "c2", "c3"]), "cost 4 with 3 ready", /Costs cannot be paid/);
  const t = etBoard({ res: [...bank("obsession", 2), ...bank("rage", 2)] });
  rf(() => etPlay(t, ["c1", "c2", "c3"]), "threshold [O][O][O] with two [O]", /Threshold requirements/);
});

clause(ET, "0:extraCost", "deploy only when NOT during a battle", () => {
  const atk = hc("atk", {}, P1, "play");
  const ok = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), atk] });
  etRun(ok, ["c1", "c2", "c3"], "c1");
  assert.equal(zoneOf(ok.engine, ok.id("et")), "discard", "control: outside battle it works");
  const b = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), atk, hc("blk", {}, P2, "play")] });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "setup: a battle is underway");
  rf(() => etPlay(b, ["c1", "c2", "c3"]), "deploying during a battle", /battle/i);
  assert.equal(zoneOf(b.engine, b.id("et")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
  // the defender, who may cast tactics in the response window, still cannot cast this one
  const win = (card: CardPlacement) =>
    buildGame({
      random: () => 0,
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [card, ...bank("obsession", 3, P2), ...bank("rage", 1, P2), hc("c1", {}, P2), hc("c2", {}, P2), hc("c3", {}, P2), hc("atk2", {}, P1, "play")]
    });
  const ctl = win({ key: "ctl", def: tactic({ name: "Ctl", cost: 0 }), owner: P2, zone: "hand" });
  declareAttackOpenWindow(ctl.engine, P1, [ctl.id("atk2")]);
  play(ctl.engine, P2, ctl.id("ctl"));
  assert.equal(zoneOf(ctl.engine, ctl.id("ctl")), "discard", "control: a tactic CAN be deployed in this window");
  const d = win({ key: "et2", def: printing(ET), owner: P2, zone: "hand" });
  declareAttackOpenWindow(d.engine, P1, [d.id("atk2")]);
  rf(() => play(d.engine, P2, d.id("et2"), { selected: { revealed: ["c1", "c2", "c3"].map((k) => d.id(k)) } }), "the defender casting it during the battle", /cannot be deployed right now/);
  assert.equal(zoneOf(d.engine, d.id("et2")), "hand");
  assert.equal(zoneOf(d.engine, d.id("c1")), "hand");
});

clause(ET, "0:extraCost", "reveal exactly 3 characters from your hand: 2 or 4 picks are refused, and 3 characters are needed in hand", () => {
  const b2 = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), hc("c4")] });
  rf(() => etPlay(b2, ["c1", "c2"]), "only 2 revealed");
  rf(() => etPlay(b2, ["c1", "c2", "c3", "c4"]), "4 revealed");
  rf(() => etPlay(b2, []), "none revealed");
  assert.equal(zoneOf(b2.engine, b2.id("et")), "hand");
  etRun(b2, ["c1", "c2", "c4"], "c4");
  assert.equal(zoneOf(b2.engine, b2.id("c4")), "play", "control: 3 of 4 works");
  const few = etBoard({ extra: [hc("c1"), hc("c2")] });
  rf(() => etPlay(few, ["c1", "c2"]), "only 2 characters in hand");
  assert.equal(zoneOf(few.engine, few.id("et")), "hand");
});

clause(ET, "0:extraCost", "the revealed characters must have numeric cost 6 or less (6 is fine, 7 is not)", () => {
  const six = etBoard({ extra: [hc("c1", { cost: 6 }), hc("c2", { cost: 0 }), hc("c3", { cost: 6 })] });
  etRun(six, ["c1", "c2", "c3"], "c1");
  assert.equal(zoneOf(six.engine, six.id("c1")), "play");
  const seven = etBoard({ extra: [hc("c1", { cost: 7 }), hc("c2"), hc("c3")] });
  rf(() => etPlay(seven, ["c1", "c2", "c3"]), "a cost-7 character among the revealed");
  assert.equal(zoneOf(seven.engine, seven.id("et")), "hand");
  const only = etBoard({ extra: [hc("c1", { cost: 7 }), hc("c2", { cost: 9 }), hc("c3", { cost: 8 })] });
  rf(() => etPlay(only, ["c1", "c2", "c3"]), "all three above cost 6");
});

clause(ET, "0:extraCost", "revealed cards must be characters in MY hand (not tactics/items, not the opponent's hand, not cards in play)", () => {
  const cases: Array<[string, CardPlacement]> = [
    ["a tactic in hand", { key: "bad", def: tactic({ name: "bad", cost: 1 }), owner: P1, zone: "hand" }],
    ["an item in hand", { key: "bad", def: item({ name: "bad", cost: 1 }), owner: P1, zone: "hand" }],
    ["a character in the opponent's hand", hc("bad", {}, P2, "hand")],
    ["a character of mine in play", hc("bad", {}, P1, "play")],
    ["a character of mine in discard", hc("bad", {}, P1, "discard")]
  ];
  for (const [label, card] of cases) {
    const b = etBoard({ extra: [hc("c1"), hc("c2"), card] });
    rf(() => etPlay(b, ["c1", "c2", "bad"]), label);
    assert.equal(zoneOf(b.engine, b.id("et")), "hand", label);
  }
});

clause(ET, "0:extraCost", "the reveal is public: all 3 chosen cards are revealed, the 4th hand card is not", () => {
  const b = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), hc("c4")] });
  etPlay(b, ["c1", "c2", "c3"]);
  const rev = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.ok(rev.length >= 1, "a cardsRevealed event was logged");
  const text = JSON.stringify(rev);
  for (const k of ["c1", "c2", "c3"]) assert.ok(text.includes(b.id(k)), `${k} revealed`);
  assert.ok(!text.includes(b.id("c4")), "the unchosen hand card is not revealed");
});

clause(ET, "0:extraCost", "'pick an opponent': the (only) opponent is the one who chooses afterwards", () => {
  const b = etBoard();
  etPlay(b, ["c1", "c2", "c3"]);
  const pc = pending(b.engine)!;
  assert.equal(pc.playerId, P2);
  answerTarget(b.engine, [b.id("c2")]);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(ET, "1:rule", "the opponent chooses ONE of the revealed characters; it enters play under my control; the other two stay in hand", () => {
  for (const pick of ["c1", "c2", "c3"]) {
    const b = etBoard();
    etRun(b, ["c1", "c2", "c3"], pick);
    for (const k of ["c1", "c2", "c3"]) {
      if (k === pick) {
        assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} (chosen) enters play`);
        assert.equal(ctrl(b.engine, b.id(k)), P1, "under my control");
        assert.equal(b.engine.state.cards[b.id(k)].ownerId, P1);
      } else {
        assert.equal(zoneOf(b.engine, b.id(k)), "hand", `${k} stays in hand`);
      }
    }
  }
});

clause(ET, "1:rule", "the opponent can only choose among the revealed characters", () => {
  const b = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), hc("c4"), hc("foe", {}, P2, "hand")] });
  etPlay(b, ["c1", "c2", "c3"]);
  rf(() => answerTarget(b.engine, [b.id("c4")]), "choosing an unrevealed character of mine");
  rf(() => answerTarget(b.engine, [b.id("foe")]), "choosing a card from their own hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerTarget(b.engine, [b.id("c3")]);
  assert.equal(zoneOf(b.engine, b.id("c3")), "play");
  assert.equal(zoneOf(b.engine, b.id("c4")), "hand");
});

clause(ET, "1:rule", "revealed UNIQUE GLOAMSPIKE and 'demon knight' cards ALSO enter play under my control; plain ones do not", () => {
  const b = etBoard({ extra: [hc("c1"), hc("dk", DK), hc("gs", GS)] });
  etRun(b, ["c1", "dk", "gs"], "c1");
  for (const k of ["c1", "dk", "gs"]) {
    assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} in play`);
    assert.equal(ctrl(b.engine, b.id(k)), P1, `${k} under my control`);
  }
  const c = etBoard({ extra: [hc("c1"), hc("c2"), hc("gs", GS)] });
  etRun(c, ["c1", "c2", "gs"], "c2");
  assert.deepEqual(["c1", "c2", "gs"].map((k) => zoneOf(c.engine, c.id(k))), ["hand", "play", "play"], "plain c1 stays; chosen c2 and revealed gloamspike enter");
  const d = etBoard({ extra: [hc("c1"), hc("dk", DK), hc("c3")] });
  etRun(d, ["c1", "dk", "c3"], "c3");
  assert.deepEqual(["c1", "dk", "c3"].map((k) => zoneOf(d.engine, d.id(k))), ["hand", "play", "play"], "plain c1 stays; chosen c3 and revealed demon knight enter");
});

clause(ET, "1:rule", "when the chosen character is itself a demon knight / gloamspike it enters once; the others follow their own rules", () => {
  const b = etBoard({ extra: [hc("dk", DK), hc("c2"), hc("gs", GS)] });
  etRun(b, ["dk", "c2", "gs"], "dk");
  assert.deepEqual(["dk", "c2", "gs"].map((k) => zoneOf(b.engine, b.id(k))), ["play", "hand", "play"]);
  const entered = (e: ETBoard, k: string) =>
    e.engine.getLog().filter((entry) => entry.event?.type === "cardEnteredPlay" && (entry.event as { cardId?: string }).cardId === e.id(k)).length;
  assert.equal(entered(b, "dk"), 1, "the chosen demon knight enters play exactly once (not again as a revealed demon knight)");
  assert.equal(entered(b, "gs"), 1);
  const c = etBoard({ extra: [hc("dk1", DK), hc("dk2", DK), hc("c3")] });
  etRun(c, ["dk1", "dk2", "c3"], "dk2");
  assert.deepEqual(["dk1", "dk2", "c3"].map((k) => zoneOf(c.engine, c.id(k))), ["play", "play", "hand"], "two demon knights both enter; plain c3 stays");
  const d = etBoard({ extra: [hc("gs", GS), hc("c2"), hc("c3")] });
  etRun(d, ["gs", "c2", "c3"], "c3");
  assert.deepEqual(["gs", "c2", "c3"].map((k) => zoneOf(d.engine, d.id(k))), ["play", "hand", "play"], "chosen plain c3 plus the revealed gloamspike");
});

clause(ET, "1:rule", "near misses do not enter: a subtype that merely contains 'demon' or 'knight', a different UNIQUE name", () => {
  const b = etBoard({ extra: [hc("c1"), hc("nd", { subtype: ["demon"] }), hc("nk", { subtype: ["knight"] })] });
  etRun(b, ["c1", "nd", "nk"], "c1");
  assert.deepEqual(["c1", "nd", "nk"].map((k) => zoneOf(b.engine, b.id(k))), ["play", "hand", "hand"]);
  const c = etBoard({ extra: [hc("c1"), hc("ou", { unique: "someone else" }), hc("c3")] });
  etRun(c, ["c1", "ou", "c3"], "c1");
  assert.deepEqual(["c1", "ou", "c3"].map((k) => zoneOf(c.engine, c.id(k))), ["play", "hand", "hand"]);
});

clause(ET, "1:rule", "only REVEALED demon knights / gloamspikes enter: unrevealed ones in hand stay there", () => {
  const b = etBoard({ extra: [hc("c1"), hc("c2"), hc("c3"), hc("dk", DK), hc("gs", GS)] });
  etRun(b, ["c1", "c2", "c3"], "c1");
  assert.equal(zoneOf(b.engine, b.id("dk")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gs")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
});

clause(ET, "1:rule", "entering characters are put into play, not deployed: their cost is not paid", () => {
  const b = etBoard({ extra: [hc("c1", { cost: 6 }), hc("dk", { ...DK, cost: 6 }), hc("gs", { ...GS, cost: 6 })] });
  etRun(b, ["c1", "dk", "gs"], "c1");
  assert.equal(ready(b.engine), 0, "only the tactic's 4 resources were spent");
  for (const k of ["c1", "dk", "gs"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});
