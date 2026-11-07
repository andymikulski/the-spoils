// Clause tests — batch open-beta-01. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-01`. Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import { printedCost, printedStats } from "./_printed.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";
import { endTurn } from "./_turn.js";

// --- file-local helpers -------------------------------------------------------

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: typeof P1 | typeof P2 = P1) => engine.getAvailableResourceCount(player);

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: typeof P1 | typeof P2, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** The current battle, read through a function so TypeScript does not narrow it after an earlier assertion. */
const battleOf = (engine: SpoilsEngine) => engine.state.battle;

// --- Arcanist's Almanac ----------------------------------------------------
// FORESIGHT -- COST: Deplete this card. -- EFFECT: Look at the top 5 cards of
// either deck and put them back in any order.

const ALMANAC = "f09cc7b1-96fd-47e5-946d-324962b9efe9";

function almanacBoard(deckOwner: typeof P1 | typeof P2) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "aa", def: printing(ALMANAC), owner: P1, zone: "play" },
      ...Array.from({ length: 7 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: deckOwner, zone: "deck" as const }))
    ]
  });
}

clause(ALMANAC, "0:ability:almanac-foresight", "depletes itself, shows exactly the top 5 of the opponent's deck, and its controller puts them back in the chosen order", () => {
  const { engine, id } = almanacBoard(P2);
  const deckBefore = [...engine.state.players[P2].deck];
  activate(engine, P1, id("aa"), "almanac-foresight", { selected: { deckOwner: [engine.state.players[P2].factionId!] } });

  assert.equal(engine.state.cards[id("aa")].depleted, true, "COST: Deplete this card");
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Almanac's controller does the looking");
  assert.deepEqual(pc.cardIds, deckBefore.slice(0, 5), "exactly the top 5 cards");

  const order = [...pc.cardIds].reverse();
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.deepEqual(engine.state.players[P2].deck, [...order, ...deckBefore.slice(5)], "put back on top in any order; the rest untouched");
});

clause(ALMANAC, "0:ability:almanac-foresight", "can look at its controller's own deck ('either deck')", () => {
  const { engine, id } = almanacBoard(P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activate(engine, P1, id("aa"), "almanac-foresight", { selected: { deckOwner: [engine.state.players[P1].factionId!] } });
  const pc = engine.state.pendingChoice as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, deckBefore.slice(0, 5));
});

clause(ALMANAC, "0:ability:almanac-foresight", "cannot be used while depleted (its cost is depleting it)", () => {
  const { engine, id } = almanacBoard(P2);
  engine.state.cards[id("aa")].depleted = true;
  assert.throws(() =>
    activate(engine, P1, id("aa"), "almanac-foresight", { selected: { deckOwner: [engine.state.players[P2].factionId!] } })
  );
});

// --- Compulsive Creeper ----------------------------------------------------
// While you have an even number of cards in your hand, this card gains 1
// strength, 1 life, and 1 speed.

const CREEPER = "b7967785-218d-4f67-a330-fcfdb0345ff9";

function creeperWithHand(handSize: number) {
  return buildGame({
    cards: [
      { key: "cc", def: printing(CREEPER), owner: P1, zone: "play" },
      ...Array.from({ length: handSize }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      // The opponent's hand never counts — "your hand".
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(CREEPER, "0:rule", "gains 1 strength, 1 life and 1 speed with an even hand (2 cards, and 0 cards)", () => {
  const printed = printing(CREEPER);
  for (const handSize of [2, 0]) {
    const { engine, id } = creeperWithHand(handSize);
    assert.equal(engine.getStat(id("cc"), "strength"), printed.strength! + 1, `strength, hand ${handSize}`);
    assert.equal(engine.getStat(id("cc"), "life"), printed.life! + 1, `life, hand ${handSize}`);
    assert.equal(engine.getStat(id("cc"), "speed"), printed.speed! + 1, `speed, hand ${handSize}`);
  }
});

clause(CREEPER, "0:rule", "has its printed stats with an odd hand", () => {
  const printed = printing(CREEPER);
  const { engine, id } = creeperWithHand(1);
  assert.equal(engine.getStat(id("cc"), "strength"), printed.strength);
  assert.equal(engine.getStat(id("cc"), "life"), printed.life);
  assert.equal(engine.getStat(id("cc"), "speed"), printed.speed);
});

// --- 12 Man Brunch of Doom -------------------------------------------------
// COST: Pick a value for X. Deplete X characters you control. Then, pick a
// character. -- EFFECT: If the character has X+X strength or less, destroy it.
// Tactic, cost 2, threshold [O][O].

const BRUNCH = "1ad7bd62-c728-4e65-91fe-b74cda698f05";

function brunchBoard(targetStrength: number, extra: { obsession?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "m3", def: character({ name: "Mine3" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: targetStrength, life: 9 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      ...bank("obsession", extra.obsession ?? 5, P1),
      ...bank("greed", extra.greed ?? 0, P1)
    ]
  });
}

for (const [x, strength] of [
  [0, 0],
  [1, 2],
  [2, 4]
] as const) {
  clause(BRUNCH, "0:ability", `X=${x}: pays 2, depletes exactly ${x} chosen characters, destroys a character with strength ${strength} (= X+X)`, () => {
    const { engine, id } = brunchBoard(strength);
    const depleted = ["m1", "m2"].slice(0, x).map(id);
    const before = ready(engine);
    play(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
    assert.equal(engine.state.cards[id("foe")].zone, "discard", "strength X+X or less: destroyed");
    for (const key of ["m1", "m2", "m3"]) {
      assert.equal(engine.state.cards[id(key)].depleted, depleted.includes(id(key)), `${key} depleted only if it was one of the X chosen`);
    }
    assert.equal(engine.state.cards[id("b")].zone, "discard", "the tactic ends in its owner's discard pile");
    assert.equal(engine.state.cards[id("bystander")].zone, "play", "an unpicked character is untouched");
  });
}

for (const [x, strength] of [
  [0, 1],
  [1, 3],
  [2, 5]
] as const) {
  clause(BRUNCH, "0:ability", `X=${x}: a character with strength ${strength} (> X+X) survives, but the costs are still paid`, () => {
    const { engine, id } = brunchBoard(strength);
    const depleted = ["m1", "m2"].slice(0, x).map(id);
    const before = ready(engine);
    play(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

    assert.equal(engine.state.cards[id("foe")].zone, "play", "strength above X+X: not destroyed");
    assert.equal(engine.state.cards[id("foe")].damage ?? 0, 0);
    assert.equal(before - ready(engine), 2);
    for (const cardId of depleted) assert.equal(engine.state.cards[cardId].depleted, true);
    assert.equal(engine.state.cards[id("b")].zone, "discard");
  });
}

clause(BRUNCH, "0:ability", "the picked character may be one of your own, even one just depleted for X", () => {
  const { engine, id } = brunchBoard(9);
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("m1")] } });
  assert.equal(engine.state.cards[id("m1")].zone, "discard");
  assert.equal(engine.state.cards[id("m2")].zone, "play", "the other characters are untouched");
});

clause(BRUNCH, "0:ability", "the strength check uses the character's current strength, not its printed strength", () => {
  const weakener = item({
    name: "Weakener",
    attachTo: "character",
    behavior: {
      abilities: [{ id: "weaken", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -3 }] }]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 9 }), owner: P2, zone: "play" },
      { key: "weakener", def: weakener, owner: P2, zone: "play", attachedToKey: "foe" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the test's weakening item works");
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "discard", "current strength 2 <= X+X = 2");
});

clause(BRUNCH, "0:ability", "is refused one resource short of its cost of 2", () => {
  const short = brunchBoard(0, { obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [short.id("foe")] } }));
  assert.equal(short.engine.state.cards[short.id("b")].zone, "hand", "nothing was played");

  const exact = brunchBoard(0, { obsession: 2 });
  play(exact.engine, P1, exact.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [exact.id("foe")] } });
  assert.equal(exact.engine.state.cards[exact.id("foe")].zone, "discard", "exactly 2 resources is enough");
});

clause(BRUNCH, "0:ability", "is refused without [O][O] even with enough other resources", () => {
  const noThreshold = brunchBoard(0, { obsession: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [noThreshold.id("foe")] } }));
  const withThreshold = brunchBoard(0, { obsession: 2, greed: 5 });
  play(withThreshold.engine, P1, withThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [withThreshold.id("foe")] } });
  assert.equal(withThreshold.engine.state.cards[withThreshold.id("foe")].zone, "discard");
});

clause(BRUNCH, "0:ability", "needs exactly X characters of yours that can be depleted: wrong count, already depleted, or the opponent's are refused", () => {
  const { engine, id } = brunchBoard(0);
  const attempt = (depleted: string[], x = depleted.length) => () =>
    playRaw(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

  assert.throws(attempt([id("m1"), id("m1")]), "cannot deplete the same character twice for X=2");
  assert.throws(attempt([id("bystander")]), "cannot deplete an opponent's character");
  assert.throws(attempt([id("m1")], 2), "X=2 needs two characters depleted");
  assert.throws(attempt([id("m1"), id("m2")], 1), "X=1 needs exactly one character depleted");
  assert.throws(attempt([], -1), "X cannot be negative");

  engine.state.cards[id("m1")].depleted = true;
  assert.throws(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m2")], picked: [id("foe")] } });
  assert.equal(engine.state.cards[id("m2")].depleted, true, "a ready character is fine");
});

clause(BRUNCH, "0:ability", "X cannot exceed the number of characters you control", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1")], picked: [id("foe")] } }));
});

clause(BRUNCH, "0:ability", "the picked card must be a character (not an item, a location or a faction)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  const attempt = (picked: string) => () =>
    playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction cannot be picked (CR 202.9)");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

// --- Air Travel ------------------------------------------------------------
// COST: Pick a character. -- EFFECT: The character gains COVERT this turn.
// Then, draw a card. Tactic, cost 2, threshold [O].

const AIR_TRAVEL = "855cc9b5-b179-462c-85f0-e8e56f37fe59";

function airTravelBoard(opts: { obsession?: number; greed?: number; turn?: number } = {}) {
  return buildGame({
    turn: opts.turn ?? 1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "a2", def: character({ name: "A2" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" },
      { key: "b2", def: character({ name: "B2" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(AIR_TRAVEL, "0:ability", "pays 2, gives the picked character COVERT and no other character, then its controller draws a card", () => {
  const { engine, id } = airTravelBoard();
  const before = ready(engine);
  const topOfDeck = engine.state.players[P1].deck[0];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });

  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "the picked character gains COVERT");
  assert.equal(engine.getKeywords(id("other")).includes("covert"), false, "another of your characters does not");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false, "an opponent's character does not");
  assert.equal(engine.state.cards[id("at")].zone, "discard");
  // hand: Air Travel left it (-1), one card was drawn (+1)
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "draws exactly one card");
  assert.equal(engine.state.cards[topOfDeck].zone, "hand", "the drawn card is the top card of the deck");
  assert.equal(engine.state.players[P1].deck.length, 1);
});

clause(AIR_TRAVEL, "0:ability", "can pick an opponent's character: it gains COVERT, and the tactic's controller (not the picked character's) draws", () => {
  const { engine, id } = airTravelBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  const p2Hand = engine.state.players[P2].hand.length;
  play(engine, P1, id("at"), { selected: { target: [id("foe")] } });

  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "engine.getKeywords(id(\"foe\")).includes(\"covert\")");
  assert.equal(engine.state.players[P1].hand.length, p1Hand - 1 + 1, "the controller drew");
  assert.equal(engine.state.players[P2].hand.length, p2Hand, "the opponent did not");
  assert.equal(engine.state.players[P2].deck.length, 2);
});

clause(AIR_TRAVEL, "0:ability", "the character is covert for real: a party of only it cannot be blocked by a non-covert character", () => {
  const withoutIt = airTravelBoard({ turn: 2 });
  const blocker = withoutIt.id("foe");
  withoutIt.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [withoutIt.id("mine")], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(withoutIt.engine);
  withoutIt.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [blocker] });
  assert.deepEqual(withoutIt.engine.state.battle?.blockingParty, [blocker], "control: with no COVERT a plain character can block");

  const { engine, id } = airTravelBoard({ turn: 2 });
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(engine);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] }), "a non-covert character cannot block a covert party");
});

clause(AIR_TRAVEL, "0:ability", "COVERT lasts this turn only", () => {
  const { engine, id } = airTravelBoard();
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "granted this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false, "gone when the turn ends");
});

clause(AIR_TRAVEL, "0:ability", "is refused one resource short of its cost of 2, and without [O]", () => {
  const short = airTravelBoard({ obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("at"), { selected: { target: [short.id("mine")] } }));

  const noThreshold = airTravelBoard({ obsession: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("at"), { selected: { target: [noThreshold.id("mine")] } }));

  const exact = airTravelBoard({ obsession: 2 });
  play(exact.engine, P1, exact.id("at"), { selected: { target: [exact.id("mine")] } });
  assert.ok(exact.engine.getKeywords(exact.id("mine")).includes("covert"), "[O] and exactly 2 resources is enough");
});

clause(AIR_TRAVEL, "0:ability", "the picked card must be a character (not an item, a location or a faction)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("thing")] } }), "item");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("place")] } }), "location");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [engine.state.players[P1].factionId!] } }), "faction");
  playRaw(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

// --- Arcana Department -----------------------------------------------------
// Attacking and blocking parties must have an even number of members.
// Location, cost 3, threshold [O][O][O], structure 5.

const DEPARTMENT = "bcac170a-c55d-4c35-a3a3-b7d167445e5b";

function departmentBoard(opts: { departmentIn?: boolean; controller?: typeof P1 | typeof P2 } = {}) {
  const dept = opts.departmentIn === false ? [] : [{ key: "dept", def: printing(DEPARTMENT), owner: opts.controller ?? P1, zone: "play" as const }];
  return buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      ...dept,
      ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const })),
      ...["b1", "b2", "b3", "b4"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const }))
    ]
  });
}

const attackWith = (engine: SpoilsEngine, ids: string[]) =>
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids, target: { type: "faction", playerId: P2 } });

clause(DEPARTMENT, "0:rule", "an attacking party must have an even number of members (1 and 3 refused, 2 and 4 allowed)", () => {
  for (const [size, legal] of [
    [1, false],
    [2, true],
    [3, false],
    [4, true]
  ] as const) {
    const { engine, id } = departmentBoard();
    const party = ["a1", "a2", "a3", "a4"].slice(0, size).map(id);
    if (legal) {
      attackWith(engine, party);
      assert.deepEqual([...(engine.state.battle?.attackingParty ?? [])].sort(), [...party].sort(), `${size} attackers is legal`);
    } else {
      assert.throws(() => attackWith(engine, party), `${size} attackers is refused`);
      assert.equal(engine.state.battle, undefined);
    }
  }
});

clause(DEPARTMENT, "0:rule", "without the Department an odd attacking party is fine", () => {
  const { engine, id } = departmentBoard({ departmentIn: false });
  attackWith(engine, [id("a1")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("a1")]);
});

clause(DEPARTMENT, "0:rule", "a blocking party must have an even number of members (1 and 3 refused, 2 allowed)", () => {
  for (const [size, legal] of [
    [1, false],
    [2, true],
    [3, false]
  ] as const) {
    const { engine, id } = departmentBoard();
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    const blockers = ["b1", "b2", "b3", "b4"].slice(0, size).map(id);
    if (legal) {
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
      assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [...blockers].sort(), `${size} blockers is legal`);
    } else {
      assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers }), `${size} blockers is refused`);
    }
  }
});

clause(DEPARTMENT, "0:rule", "declaring no blockers is still allowed (there is no blocking party to be odd)", () => {
  const { engine, id } = departmentBoard();
  attackWith(engine, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], []);
});

clause(DEPARTMENT, "0:rule", "without the Department an odd blocking party is fine", () => {
  const { engine, id } = departmentBoard({ departmentIn: false });
  attackWith(engine, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("b1")]);
});

clause(DEPARTMENT, "0:rule", "applies to both players' parties, whoever controls the Department", () => {
  for (const controller of [P1, P2] as const) {
    const { engine, id } = departmentBoard({ controller });
    assert.throws(() => attackWith(engine, [id("a1")]), `P1's odd attack is refused (Department controlled by ${controller})`);
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] }), `P2's odd block is refused (Department controlled by ${controller})`);
  }
});

// --- Arcana Experiment -----------------------------------------------------
// COST: Play this only if there are at least 5 cards in your deck. Deplete up
// to 5 characters you control. X is the number of characters you deplete.
// EFFECT: Search your deck for 5 cards and reveal them. Your opponent picks X
// of those cards. Put those cards into your hand and the rest into your discard
// pile. Tactic, cost 7, threshold [O][O][O][O].

const EXPERIMENT = "6e63449c-4363-494b-b90a-db1147b4b9a1";

function experimentBoard(opts: { deck?: number; chars?: number; obsession?: number; greed?: number; oppDeck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.chars ?? 6 }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1, zone: "play" as const })),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: opts.deck ?? 8 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.oppDeck ?? 8 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const FOUND = ["d1", "d3", "d4", "d6", "d7"]; // five cards of the searched deck, deliberately not the top five

/**
 * Plays Arcana Experiment. Only "Deplete up to 5 characters" is in the COST (`selected.depleted`); "Search your deck
 * for 5 cards" is the EFFECT, so the caster chooses `selected.found` when the tactic resolves (E3b).
 */
function playAe(engine: SpoilsEngine, player: typeof P1 | typeof P2, cardId: string, opts: { selected: { depleted?: string[]; found?: string[] } }): void {
  const { found, ...atPlay } = opts.selected;
  play(engine, player, cardId, { selected: atPlay });
  const pc = engine.state.pendingChoice;
  if (found && pc?.kind === "chooserSelectsTarget" && pc.playerId === player) {
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: found } } as never);
    resolvePendingResponses(engine);
  }
}

for (let x = 0; x <= 5; x++) {
  clause(EXPERIMENT, "0:ability", `X=${x}: pays 7, depletes ${x} characters, reveals 5 searched cards, the opponent picks ${x} of them for your hand and the other ${5 - x} go to your discard pile`, () => {
    const { engine, id } = experimentBoard();
    const depleted = ["m0", "m1", "m2", "m3", "m4"].slice(0, x).map(id);
    const found = FOUND.map(id);
    const before = ready(engine);
    const handBefore = [...engine.state.players[P1].hand];
    const deckBefore = [...engine.state.players[P1].deck];
    const oppDeckBefore = [...engine.state.players[P2].deck];
    const oppHandBefore = [...engine.state.players[P2].hand];

    playAe(engine, P1, id("ae"), { selected: { depleted, found } });

    assert.equal(before - ready(engine), 7, "the printed cost of 7 is paid");
    for (const key of ["m0", "m1", "m2", "m3", "m4", "m5"]) {
      assert.equal(engine.state.cards[id(key)].depleted, depleted.includes(id(key)), `${key}: depleted only if chosen for X`);
    }
    const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
    assert.equal(reveals.length, 1, "the 5 searched cards are revealed once");
    const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
    assert.deepEqual([...ev.cardIds].sort(), [...found].sort(), "exactly the searched cards are revealed");
    assert.equal(ev.viewerId, "all", "revealed to everyone");

    // Whichever x of the five the opponent picks:
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    const pick = found.slice(0, x);
    if (x === 0 && !pc) {
      // nothing to pick for X=0: the engine may skip the prompt
    } else {
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P2, "your OPPONENT picks");
      engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: pick } } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.pendingChoice, undefined);

    for (const cardId of pick) assert.equal(engine.state.cards[cardId].zone, "hand", "a picked card goes to your hand");
    for (const cardId of found.slice(x)) assert.equal(engine.state.cards[cardId].zone, "discard", "an unpicked searched card goes to your discard pile");
    assert.deepEqual([...engine.state.players[P1].hand].sort(), [...handBefore.filter((c) => c !== id("ae")), ...pick].sort(), "the hand gains exactly the picked cards");
    assert.equal(engine.state.players[P1].discard.filter((c) => c !== id("ae")).length, 5 - x, "exactly the unpicked cards are discarded (plus the tactic itself)");
    const unsearched = deckBefore.filter((c) => !found.includes(c));
    assert.deepEqual([...engine.state.players[P1].deck].sort(), [...unsearched].sort(), "the rest of the deck stays in the deck");
    assert.deepEqual(engine.state.players[P2].deck, oppDeckBefore, "the opponent's deck is untouched");
    assert.deepEqual(engine.state.players[P2].hand, oppHandBefore, "the opponent's hand is untouched");
    assert.equal(engine.state.cards[id("ae")].zone, "discard", "the tactic ends in your discard pile");
  });
}

clause(EXPERIMENT, "0:ability", "the opponent must pick exactly X of the searched cards: too few, too many or a card that was not searched is refused", () => {
  const board = () => experimentBoard();
  const attempt = (selected: string[]) => {
    const { engine, id } = board();
    playAe(engine, P1, id("ae"), { selected: { depleted: ["m0", "m1"].map(id), found: FOUND.map(id) } });
    const names = selected.map((key) => id(key));
    return () => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: names } } as never);
  };
  assert.throws(attempt(["d1"]), "X=2: one card is too few");
  assert.throws(attempt(["d1", "d3", "d4"]), "X=2: three cards is too many");
  assert.throws(attempt(["d1", "d0"]), "X=2: d0 was not one of the searched cards");
  assert.throws(attempt(["d1", "d1"]), "X=2: the same card twice");
  attempt(["d1", "d3"])();
});

clause(EXPERIMENT, "0:ability", "is refused with 4 cards in your deck (your opponent's deck and your hand do not count) and allowed with exactly 5", () => {
  const four = experimentBoard({ deck: 4, oppDeck: 12 });
  assert.throws(() => playRaw(four.engine, P1, four.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3"].map(four.id) } }), "4 cards: refused even if the opponent has 12");
  assert.equal(four.engine.state.cards[four.id("ae")].zone, "hand");
  assert.equal(four.engine.getCardPlayability(P1, four.id("ae")).playable, false, "not playable with 4 cards in the deck, though the cost and threshold are met");

  const five = experimentBoard({ deck: 5 });
  assert.equal(five.engine.getCardPlayability(P1, five.id("ae")).playable, true, "playable with exactly 5 cards in the deck");
  playAe(five.engine, P1, five.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3", "d4"].map(five.id) } });
  drain(five.engine, declineAll);
  assert.equal(five.engine.state.cards[five.id("d0")].zone, "discard", "exactly 5 cards in the deck is enough (X=0: all five are discarded)");
});

clause(EXPERIMENT, "0:ability", "is refused one resource short of its cost of 7, and without [O][O][O][O]", () => {
  const short = experimentBoard({ obsession: 6 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ae"), { selected: { depleted: [], found: FOUND.map(short.id) } }));

  const noThreshold = experimentBoard({ obsession: 3, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ae"), { selected: { depleted: [], found: FOUND.map(noThreshold.id) } }), "only three [O]");

  const exact = experimentBoard({ obsession: 7 });
  playAe(exact.engine, P1, exact.id("ae"), { selected: { depleted: [], found: FOUND.map(exact.id) } });
  drain(exact.engine, declineAll);
  assert.equal(exact.engine.state.cards[exact.id("ae")].zone, "discard");
  const fourO = experimentBoard({ obsession: 4, greed: 3 });
  playAe(fourO.engine, P1, fourO.id("ae"), { selected: { depleted: [], found: FOUND.map(fourO.id) } });
  drain(fourO.engine, declineAll);
  assert.equal(fourO.engine.state.cards[fourO.id("ae")].zone, "discard", "four [O] plus three other resources is enough");
});

clause(EXPERIMENT, "0:ability", "you may deplete at most 5 characters, only your own, only ones not already depleted", () => {
  const { engine, id } = experimentBoard({ chars: 7 });
  const attempt = (depleted: string[]) => () => playRaw(engine, P1, id("ae"), { selected: { depleted, found: FOUND.map(id) } });
  assert.throws(attempt(["m0", "m1", "m2", "m3", "m4", "m5"].map(id)), "six characters is more than 'up to 5'");
  assert.throws(attempt([id("foe")]), "an opponent's character cannot be depleted");
  assert.throws(attempt(["m0", "m0"].map(id)), "the same character twice");
  engine.state.cards[id("m1")].depleted = true;
  assert.throws(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
  assert.throws(attempt([id("h1")]), "a card in hand is not a character you control in play");
  attempt(["m0", "m2", "m3", "m4", "m5"].map(id))();
  assert.ok(engine.state.responseWindow, "five ready characters of your own is accepted");
});

clause(EXPERIMENT, "0:ability", "the 5 searched cards must come from your own deck, and be 5 distinct cards", () => {
  // "Search your deck for 5 cards" is the EFFECT: the caster chooses them when the tactic resolves (E3b), and a bad answer leaves the search open.
  const { engine, id } = experimentBoard();
  play(engine, P1, id("ae"), { selected: { depleted: [id("m0")] } });
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the search is open");
  assert.equal(engine.state.pendingChoice?.playerId, P1);
  const attempt = (found: string[]) => () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: found.map(id) } } as never);
  assert.throws(attempt(["d0", "d1", "d2", "d3", "e0"]), "a card from the opponent's deck");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "h1"]), "a card from your hand");
  assert.throws(attempt(["d0", "d1", "d2", "d3"]), "only four cards");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "d4", "d5"]), "six cards");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "d3"]), "the same card twice");
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "every bad answer left the search open");
  attempt(["d0", "d1", "d2", "d3", "d4"])();
  assert.equal(engine.state.pendingChoice?.playerId, P2, "a good answer moves on to the opponent's choice");
});

// --- Ashes of Zenobia ------------------------------------------------------
// UNIQUE ASHES OF ZENOBIA. At the start of your turn, draw a card.
// NULLIFY -- COST: Pay 5. -- EFFECT: Both players must put a character they
// control into its owner's hand. Item, cost 7, threshold [O][O][O][O].

const ASHES = "b3c323b0-c7ea-4970-a286-92df7d2fe2f3";

function ashesBoard(opts: { obsession?: number; ashesController?: typeof P1 | typeof P2; second?: "hand" | "play" | "oppPlay" | "none" } = {}) {
  const second = opts.second ?? "none";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play", controller: opts.ashesController ?? P1 },
      ...(second === "none"
        ? []
        : [
            {
              key: "az2",
              def: printing(ASHES),
              owner: second === "oppPlay" ? P2 : P1,
              zone: second === "hand" ? ("hand" as const) : ("play" as const)
            }
          ]),
      { key: "mine1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "theirs1", def: character({ name: "Theirs1" }), owner: P2, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      ...["a1", "a2", "a3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 8, P1)
    ]
  });
}

clause(ASHES, "0:unique", "playing a second copy forces you to choose one to keep; the other is destroyed (keep the new one)", () => {
  const { engine, id } = ashesBoard({ second: "hand" });
  play(engine, P1, id("az2"), {});
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses which copy to keep");
  assert.deepEqual([...pc.candidates].sort(), [id("az"), id("az2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az2") } } as never);
  assert.equal(engine.state.cards[id("az2")].zone, "play");
  assert.equal(engine.state.cards[id("az")].zone, "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ASHES, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = ashesBoard({ second: "hand" });
  play(engine, P1, id("az2"), {});
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az") } } as never);
  assert.equal(engine.state.cards[id("az")].zone, "play");
  assert.equal(engine.state.cards[id("az2")].zone, "discard");
});

clause(ASHES, "0:unique", "only the controller's own copies count: the opponent can deploy their own copy while you have one, with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      { key: "az2", def: printing(ASHES), owner: P2, zone: "hand" },
      ...bank("obsession", 7, P2)
    ]
  });
  play(engine, P2, id("az2"), {});
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice for either player");
  assert.equal(engine.state.cards[id("az")].zone, "play");
  assert.equal(engine.state.cards[id("az2")].zone, "play");
});

clause(ASHES, "1:rule", "at the start of your turn, you draw a card (and not at the start of the opponent's turn)", () => {
  const { engine, id } = ashesBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  const p1Top = engine.state.players[P1].deck[0];
  const p2Hand = engine.state.players[P2].hand.length;
  endTurn(engine, P1); // P2's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "no draw at the start of the OPPONENT's turn");
  assert.equal(engine.state.players[P2].hand.length, p2Hand, "the opponent has no Ashes: no draw for them either");
  endTurn(engine, P2); // P1's turn starts
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 1, "draws exactly one card at the start of your turn");
  assert.equal(engine.state.cards[p1Top].zone, "hand", "the drawn card is the top of your deck");
  assert.equal(engine.state.players[P2].hand.length, p2Hand);
  void id;
});

clause(ASHES, "1:rule", "'your turn' is the controller's turn: an Ashes controlled by the opponent draws for the opponent, not for its owner", () => {
  const { engine } = ashesBoard({ ashesController: P2 });
  const p1Hand = engine.state.players[P1].hand.length;
  const p2Hand = engine.state.players[P2].hand.length;
  endTurn(engine, P1); // P2's turn starts: P2 controls the Ashes
  assert.equal(engine.state.players[P2].hand.length, p2Hand + 1, "its controller draws at the start of their turn");
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "its owner does not");
  endTurn(engine, P2); // P1's turn starts
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "still no draw for the owner at the start of their own turn");
  assert.equal(engine.state.players[P2].hand.length, p2Hand + 1);
});

clause(ASHES, "1:rule", "the draw happens on every one of your turns", () => {
  const { engine } = ashesBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 2, "a second draw on the next turn");
});

function nullifyAnswers(engine: SpoilsEngine, picks: { [player: string]: string[] }) {
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: picks[pc.playerId] ?? [] };
    return declineAll(pc);
  });
}

clause(ASHES, "2:ability:nullify", "pays 5; each player puts a character they control into its owner's hand, the others stay", () => {
  const { engine, id } = ashesBoard();
  const before = ready(engine);
  activate(engine, P1, id("az"), "nullify");
  assert.equal(before - ready(engine), 5, "NULLIFY costs exactly 5");
  const asked: string[] = [];
  drain(engine, (pc) => {
    asked.push(pc.playerId);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id(pc.playerId === P1 ? "mine2" : "theirs1")] };
    return declineAll(pc);
  });
  assert.deepEqual([...asked].sort(), [P1, P2], "each player makes their own choice");
  assert.equal(engine.state.cards[id("mine2")].zone, "hand");
  assert.equal(engine.state.cards[id("theirs1")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("mine2")), true);
  assert.equal(engine.state.players[P2].hand.includes(id("theirs1")), true);
  for (const key of ["mine1", "theirs2", "az", "thing"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} stays in play`);
});

clause(ASHES, "2:ability:nullify", "is refused one resource short of 5", () => {
  const short = ashesBoard({ obsession: 4 });
  assert.throws(() => activate(short.engine, P1, short.id("az"), "nullify"));
  assert.equal(short.engine.state.cards[short.id("mine1")].zone, "play");
  const exact = ashesBoard({ obsession: 5 });
  activate(exact.engine, P1, exact.id("az"), "nullify");
  nullifyAnswers(exact.engine, { [P1]: [exact.id("mine1")], [P2]: [exact.id("theirs1")] });
  assert.equal(exact.engine.state.cards[exact.id("mine1")].zone, "hand", "exactly 5 is enough");
});

clause(ASHES, "2:ability:nullify", "a player cannot put a character they do not control (or a non-character) into hand", () => {
  const attempt = (player: typeof P1 | typeof P2, key: string) => {
    const { engine, id } = ashesBoard();
    activate(engine, P1, id("az"), "nullify");
    // answer P1 first if the engine asks the active player first
    const pc = engine.state.pendingChoice as unknown as { playerId: string };
    if (pc.playerId !== player) {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id(pc.playerId === P1 ? "mine1" : "theirs1")] } } as never);
    }
    return () => engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
  };
  assert.throws(attempt(P1, "theirs1"), "P1 cannot pick the opponent's character");
  assert.throws(attempt(P2, "mine1"), "P2 cannot pick P1's character");
  assert.throws(attempt(P1, "az"), "an item is not a character");
  assert.throws(attempt(P2, "thing"), "an item is not a character");
  attempt(P1, "mine1")();
});

clause(ASHES, "2:ability:nullify", "the choice is mandatory ('must'): declining to pick while you control a character is refused", () => {
  const { engine, id } = ashesBoard();
  activate(engine, P1, id("az"), "nullify");
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } } as never));
});

clause(ASHES, "2:ability:nullify", "a character goes to its OWNER's hand, so a character you control but do not own returns to its owner", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      ...bank("obsession", 5, P1)
    ]
  });
  activate(engine, P1, id("az"), "nullify");
  nullifyAnswers(engine, { [P1]: [id("stolen")], [P2]: [id("lent")] });
  assert.equal(engine.state.cards[id("stolen")].zone, "hand");
  assert.equal(engine.state.players[P2].hand.includes(id("stolen")), true, "P1 controlled it, P2 owns it: it goes to P2's hand");
  assert.equal(engine.state.players[P1].hand.includes(id("stolen")), false);
  assert.equal(engine.state.cards[id("lent")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("lent")), true, "P2 controlled it, P1 owns it: it goes to P1's hand");
});

clause(ASHES, "2:ability:nullify", "a player with no character does nothing; the other player still puts one into hand", () => {
  for (const lacking of [P1, P2] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
        ...(lacking === P1 ? [] : [{ key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" as const }]),
        ...(lacking === P2 ? [] : [{ key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" as const }]),
        ...bank("obsession", 5, P1)
      ]
    });
    activate(engine, P1, id("az"), "nullify");
    nullifyAnswers(engine, { [P1]: lacking === P1 ? [] : [id("mine")], [P2]: lacking === P2 ? [] : [id("theirs")] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id(lacking === P1 ? "theirs" : "mine")].zone, "hand", `player lacking a character: ${lacking}`);
    assert.equal(engine.state.cards[id("az")].zone, "play");
  }
});

// --- Degenerate Molestation ------------------------------------------------
// Your opponent cannot respond to this card.
// Your opponent must discard a card. You may play a non-resource card with cost
// X or less for free, where X is cost of the discarded card. (You still need
// the proper resource icons.)
// Repeat this effect until your opponent has no cards in their hand.
// Tactic, cost 10, threshold [O][O][O][O].

const MOLESTATION = "f77f9b48-ebfb-4f8f-a32d-46a0309da781";

type Def = ReturnType<typeof character>;

function molestationBoard(p1Hand: Def[], p2Hand: Def[], opts: { obsession?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
      ...p1Hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...p2Hand.map((def) => ({ key: `o:${def.name}`, def, owner: P2, zone: "hand" as const })),
      ...["x1", "x2", "x3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** What the free-play prompt currently offers P1, as card names. */
function offered(engine: SpoilsEngine): string[] {
  const pc = engine.state.pendingChoice as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "deployForFree", "P1 is asked whether to play a card for free");
  return pc.candidates.map((c) => engine.getDefinition(c).name).sort();
}

const choosePlayer = (engine: SpoilsEngine) => (engine.state.pendingChoice as unknown as { playerId: string }).playerId;

/** P2 discards the card with key `discardKey` (a P2 hand key). */
function opponentDiscards(engine: SpoilsEngine, id: (key: string) => string, discardKey: string) {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what they discard");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id(discardKey)] } } as never);
  resolvePendingResponses(engine);
}

function freePlay(engine: SpoilsEngine, cardId?: string) {
  assert.equal(choosePlayer(engine), P1, "the caster decides on the free play");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId } } as never);
  resolvePendingResponses(engine);
}

clause(MOLESTATION, "0:rule", "the opponent gets no response window: the tactic resolves entirely on its own", () => {
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  const window = engine.state.responseWindow;
  assert.ok(!window || (window.priorityPlayerId !== P2 && !(window.stackResponders ?? []).includes(P2)), "no window opens for the opponent");
  assert.equal(engine.state.pendingChoice !== undefined, true, "the effect has already started (the opponent must discard)");
  opponentDiscards(engine, id, "o:Victim");
  assert.equal(engine.state.cards[id("dm")].zone, "discard");
});

clause(MOLESTATION, "0:rule", "control: an ordinary tactic does open a response window for the opponent", () => {
  const plain = tactic({ name: "Plain", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "plain", def: plain, owner: P1, zone: "hand" }]
  });
  playRaw(engine, P1, id("plain"));
  assert.ok(engine.state.responseWindow, "an ordinary tactic can be responded to");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(MOLESTATION, "0:rule", "pays 10 and is refused one resource short, or without [O][O][O][O]", () => {
  const one = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 9 });
  assert.throws(() => playRaw(one.engine, P1, one.id("dm")));
  const noThreshold = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 3, greed: 9 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm")));
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 10 });
  const before = ready(engine);
  playRaw(engine, P1, id("dm"));
  assert.equal(before - ready(engine), 10, "the printed cost of 10 is paid");
});

clause(MOLESTATION, "1:rule", "the opponent chooses which card of their hand to discard; it goes to their discard pile and nothing else of theirs is discarded", () => {
  const { engine, id } = molestationBoard([], [character({ name: "A", cost: 1 }), character({ name: "B", cost: 2 }), character({ name: "C", cost: 3 })]);
  playRaw(engine, P1, id("dm"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent picks");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("o:B")] } } as never);
  assert.equal(engine.state.cards[id("o:B")].zone, "discard");
  assert.equal(engine.state.players[P2].discard.includes(id("o:B")), true);
  // the effect repeats, so the next card to go is chosen by the opponent too; here we only look at the first
});

clause(MOLESTATION, "1:rule", "the discard must come from the opponent's hand, not yours", () => {
  const { engine, id } = molestationBoard([character({ name: "Mine", cost: 1 })], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("h:Mine")] } } as never), "P1's own card");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "'must discard' - not choosing is refused");
  assert.equal(engine.state.cards[id("h:Mine")].zone, "hand");
});

clause(MOLESTATION, "1:rule", "you may play a non-resource card with cost X or less (X = the discarded card's cost) for free; cost exactly X is allowed, X+1 is not", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "Cheap", cost: 1 }), character({ name: "Exact", cost: 3 }), character({ name: "TooDear", cost: 4 }), character({ name: "Huge", cost: 9 })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["Cheap", "Exact"], "only cards of cost 3 or less are offered");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:TooDear") } } as never), "cost 4 is more than X=3");
  const resourcesLeft = ready(engine);
  freePlay(engine, id("h:Exact"));
  assert.equal(engine.state.cards[id("h:Exact")].zone, "play", "the card is played");
  assert.equal(ready(engine), resourcesLeft, "...for free: no resources spent");
  assert.equal(engine.state.cards[id("h:Cheap")].zone, "hand", "only one card is played per iteration");
});

clause(MOLESTATION, "1:rule", "X is the cost of the discarded card: a cost-0 discard offers only cost-0 cards, a cost-6 discard offers up to 6", () => {
  for (const [victimCost, expected] of [
    [0, ["Free"]],
    [6, ["Cost6", "Free", "Mid"]]
  ] as const) {
    const { engine, id } = molestationBoard(
      [character({ name: "Free", cost: 0 }), character({ name: "Mid", cost: 2 }), character({ name: "Cost6", cost: 6 }), character({ name: "Cost7", cost: 7 })],
      [character({ name: "Victim", cost: victimCost })]
    );
    playRaw(engine, P1, id("dm"));
    opponentDiscards(engine, id, "o:Victim");
    assert.deepEqual(offered(engine), [...expected].sort(), `X=${victimCost}`);
  }
});

clause(MOLESTATION, "1:rule", "'may': declining plays nothing and leaves the cards in hand", () => {
  const { engine, id } = molestationBoard([character({ name: "Cheap", cost: 1 })], [character({ name: "Victim", cost: 3 })]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  const resources = ready(engine);
  freePlay(engine, undefined);
  assert.equal(engine.state.cards[id("h:Cheap")].zone, "hand");
  assert.equal(ready(engine), resources);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MOLESTATION, "1:rule", "only non-resource cards: a resource-type card in hand is never offered, whatever its cost", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "Cheap", cost: 1 }), { ...character({ name: "Staple", cost: 0 }), type: "resource", resource: { provides: ["rage"], staple: true } } as Def],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["Cheap"]);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Staple") } } as never));
});

clause(MOLESTATION, "1:rule", "you still need the proper resource icons: choosing a card whose threshold you do not meet is refused, one you meet is played", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never }), character({ name: "NeedsObsession", cost: 1, threshold: "o" as never })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.ok(offered(engine).includes("NeedsObsession"), "a card whose threshold you meet can be chosen");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:NeedsRage") } } as never), "no [R] icons: refused");
  assert.equal(engine.state.cards[id("h:NeedsRage")].zone, "hand");
  freePlay(engine, id("h:NeedsObsession"));
  assert.equal(engine.state.cards[id("h:NeedsObsession")].zone, "play");
  assert.equal(engine.state.cards[id("h:NeedsRage")].zone, "hand");
});

clause(MOLESTATION, "1:rule", "only cards from YOUR HAND can be played this way (not your deck, your discard pile, or the opponent's hand)", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "InHand", cost: 1 })],
    [character({ name: "Victim", cost: 3 }), character({ name: "TheirOther", cost: 1 })],
    {
      extra: [
        { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
        { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" }
      ]
    }
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["InHand"]);
});

for (const [label, def, check] of [
  ["character", character({ name: "Guy", cost: 2 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(e.state.cards[id("h:Guy")].zone, "play")],
  ["item", item({ name: "Widget", cost: 2 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(e.state.cards[id("h:Widget")].zone, "play")],
  ["location", location({ name: "Hall", cost: 2, structure: 3 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(e.state.cards[id("h:Hall")].zone, "play")],
  [
    "tactic",
    tactic({ name: "Cantrip", cost: 2, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
    (e: SpoilsEngine, id: (k: string) => string) => {
      assert.equal(e.state.cards[id("h:Cantrip")].zone, "discard", "a tactic resolves and goes to the discard pile");
      assert.equal(e.state.cards[id("x1")].zone, "hand", "...and its effect happened (it drew a card)");
    }
  ]
] as const) {
  clause(MOLESTATION, "1:rule", `the free play can be a ${label}`, () => {
    const { engine, id } = molestationBoard([def as Def], [character({ name: "Victim", cost: 3 })]);
    playRaw(engine, P1, id("dm"));
    opponentDiscards(engine, id, "o:Victim");
    assert.deepEqual(offered(engine), [def.name]);
    freePlay(engine, id(`h:${def.name}`));
    drain(engine, declineAll);
    check(engine, id);
  });
}

clause(MOLESTATION, "1:rule", "with nothing affordable to play, the opponent's discard still happens and nothing is played", () => {
  const { engine, id } = molestationBoard([character({ name: "Huge", cost: 9 })], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("o:Victim")].zone, "discard");
  assert.equal(engine.state.cards[id("h:Huge")].zone, "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MOLESTATION, "1:rule", "an opponent with no cards in hand: nothing is discarded, nothing is played, and the tactic still resolves", () => {
  const { engine, id } = molestationBoard([character({ name: "Cheap", cost: 1 })], []);
  playRaw(engine, P1, id("dm"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("h:Cheap")].zone, "hand");
  assert.equal(engine.state.cards[id("dm")].zone, "discard");
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(MOLESTATION, "2:rule", "repeats until the opponent's hand is empty: three cards means three discards (each chosen by the opponent) and up to three free plays", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "P1", cost: 1 }), character({ name: "P2", cost: 2 }), character({ name: "P3", cost: 3 })],
    [character({ name: "V1", cost: 1 }), character({ name: "V2", cost: 2 }), character({ name: "V3", cost: 3 })]
  );
  const resources = ready(engine);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:V1");
  assert.deepEqual(offered(engine), ["P1"], "iteration 1: X=1");
  freePlay(engine, id("h:P1"));

  assert.equal(engine.state.players[P2].hand.length, 2, "two cards left, so it repeats");
  opponentDiscards(engine, id, "o:V3");
  assert.deepEqual(offered(engine), ["P2", "P3"], "iteration 2: X=3 (the card played in iteration 1 is gone from hand)");
  freePlay(engine, id("h:P3"));

  assert.equal(engine.state.players[P2].hand.length, 1);
  opponentDiscards(engine, id, "o:V2");
  assert.deepEqual(offered(engine), ["P2"], "iteration 3: X=2");
  freePlay(engine, undefined);

  assert.equal(engine.state.pendingChoice, undefined, "the opponent's hand is empty, so it stops");
  assert.equal(engine.state.players[P2].hand.length, 0);
  for (const key of ["o:V1", "o:V2", "o:V3"]) assert.equal(engine.state.cards[id(key)].zone, "discard");
  assert.equal(engine.state.cards[id("h:P1")].zone, "play");
  assert.equal(engine.state.cards[id("h:P3")].zone, "play");
  assert.equal(engine.state.cards[id("h:P2")].zone, "hand", "declined in iteration 3");
  assert.equal(resources - ready(engine), 10, "the free plays cost nothing: only the tactic's own 10");
  assert.equal(engine.state.cards[id("dm")].zone, "discard");
});

clause(MOLESTATION, "2:rule", "a single-card hand needs exactly one iteration; a large hand is emptied completely", () => {
  const one = molestationBoard([], [character({ name: "Only", cost: 1 })]);
  playRaw(one.engine, P1, one.id("dm"));
  opponentDiscards(one.engine, one.id, "o:Only");
  drain(one.engine, declineAll);
  assert.equal(one.engine.state.players[P2].hand.length, 0);

  const names = ["N1", "N2", "N3", "N4", "N5", "N6"];
  const many = molestationBoard([], names.map((name) => character({ name, cost: 1 })));
  playRaw(many.engine, P1, many.id("dm"));
  for (const name of names) opponentDiscards(many.engine, many.id, `o:${name}`);
  assert.equal(many.engine.state.pendingChoice, undefined);
  assert.equal(many.engine.state.players[P2].hand.length, 0, "six cards, six iterations");
  assert.equal(many.engine.state.players[P2].discard.length, 6);
});

// --- Ecto-Distillation -----------------------------------------------------
// COST: Name a card. -- EFFECT: Your opponent must search your deck for all
// copies of the card. Put one in your hand and the rest in your discard pile.
// Tactic, cost 4, threshold [O][O][O].

const DISTILLATION = "37f34e7c-dbb2-4393-ad6a-bac2a3571ba9";

function distillationBoard(opts: { copies?: number; obsession?: number; greed?: number } = {}) {
  const copies = opts.copies ?? 3;
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" },
      ...Array.from({ length: copies }, (_, i) => ({ key: `t${i + 1}`, def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "deck" as const })),
      { key: "lookalike", def: character({ name: "Target Practice" }), owner: P1, zone: "deck" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "deck" },
      { key: "inHand", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "discard" },
      { key: "oppCopy1", def: character({ id: "target-def", name: "Target" }), owner: P2, zone: "deck" },
      { key: "oppCopy2", def: character({ id: "target-def", name: "Target" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Names `named`, lets the first copy be taken to hand wherever a copy must be chosen. Returns who was asked what. */
function distill(engine: SpoilsEngine, id: (k: string) => string, named: string, pick: string[]) {
  const asked: Array<{ kind: string; playerId: string }> = [];
  drain(engine, (pc) => {
    asked.push({ kind: pc.kind, playerId: pc.playerId });
    if (pc.kind === "nameValue") return { kind: "nameValue", value: named };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: pick.map(id) };
    return declineAll(pc);
  });
  return asked;
}

clause(DISTILLATION, "0:ability", "you name a card (not your opponent), and the tactic costs 4", () => {
  const { engine, id } = distillationBoard();
  const before = ready(engine);
  play(engine, P1, id("ed"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; valueKind: string };
  assert.equal(pc.kind, "nameValue");
  assert.equal(pc.playerId, P1, "the caster names the card");
  assert.equal(pc.valueKind, "cardName", "a CARD is named");
  assert.equal(before - ready(engine), 0, "nothing is paid until the name (part of the cost) is given");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
});

clause(DISTILLATION, "0:ability", "all copies of the named card are taken from your deck: one goes to your hand, the rest to your discard pile", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const handBefore = engine.state.players[P1].hand.length;
  const discardBefore = engine.state.players[P1].discard.length;
  play(engine, P1, id("ed"));
  distill(engine, id, "Target", ["t2"]);

  const zones = ["t1", "t2", "t3"].map((key) => engine.state.cards[id(key)].zone);
  assert.equal(zones.filter((z) => z === "hand").length, 1, "exactly one copy goes to your hand");
  assert.equal(zones.filter((z) => z === "discard").length, 2, "the rest go to your discard pile");
  assert.equal(zones.filter((z) => z === "deck").length, 0, "no copy is left in the deck");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "hand: tactic left, one copy arrived");
  assert.equal(engine.state.players[P1].discard.length, discardBefore + 2 + 1, "discard: two copies and the tactic");
  assert.equal(engine.state.cards[id("ed")].zone, "discard");
});

clause(DISTILLATION, "0:ability", "only copies in YOUR DECK are affected: other cards, look-alike names, your hand, your discard pile and the opponent's deck stay put", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, "Target", ["t1"]);
  assert.equal(engine.state.cards[id("other")].zone, "deck", "a differently named card stays in the deck");
  assert.equal(engine.state.cards[id("lookalike")].zone, "deck", "'Target Practice' is not a copy of 'Target'");
  assert.equal(engine.state.cards[id("inHand")].zone, "hand", "a copy already in your hand stays there");
  assert.equal(engine.state.cards[id("inDiscard")].zone, "discard", "a copy already in your discard pile stays there");
  assert.equal(engine.state.cards[id("oppCopy1")].zone, "deck", "the opponent's deck is not searched");
  assert.equal(engine.state.cards[id("oppCopy2")].zone, "deck");
});

clause(DISTILLATION, "0:ability", "a single copy goes to your hand and nothing else is discarded", () => {
  const { engine, id } = distillationBoard({ copies: 1 });
  const discardBefore = engine.state.players[P1].discard.length;
  play(engine, P1, id("ed"));
  distill(engine, id, "Target", ["t1"]);
  assert.equal(engine.state.cards[id("t1")].zone, "hand");
  assert.equal(engine.state.players[P1].discard.length, discardBefore + 1, "only the tactic itself joins the discard pile");
});

clause(DISTILLATION, "0:ability", "naming a card with no copy in your deck finds nothing and changes nothing", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const handBefore = [...engine.state.players[P1].hand];
  const deckBefore = [...engine.state.players[P1].deck];
  play(engine, P1, id("ed"));
  distill(engine, id, "Nonexistent Card", []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual([...engine.state.players[P1].hand].sort(), handBefore.filter((c) => c !== id("ed")).sort());
  assert.deepEqual([...engine.state.players[P1].deck].sort(), deckBefore.sort());
  assert.equal(engine.state.cards[id("ed")].zone, "discard");
});

clause(DISTILLATION, "0:ability", "the named card decides what is taken: naming 'Other' takes 'Other' and leaves the Targets", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, "Other", ["other"]);
  assert.equal(engine.state.cards[id("other")].zone, "hand");
  for (const key of ["t1", "t2", "t3"]) assert.equal(engine.state.cards[id(key)].zone, "deck");
});

clause(DISTILLATION, "0:ability", "is refused one resource short of 4, and without [O][O][O]", () => {
  const short = distillationBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ed")));
  const noThreshold = distillationBoard({ obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ed")));
  const exact = distillationBoard({ obsession: 4 });
  play(exact.engine, P1, exact.id("ed"));
  assert.equal(exact.engine.state.pendingChoice?.kind, "nameValue", "exactly 4 resources with [O][O][O] is enough");
});

clause(DISTILLATION, "0:ability", "your OPPONENT does the searching: the player asked to pick which copy goes to the hand is the opponent", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
  resolvePendingResponses(engine);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget", "someone must search the deck for the copies");
  assert.equal(pc.playerId, P2, "'Your opponent must search your deck'");
});

// --- Forget ----------------------------------------------------------------
// COST: Pick a non-resource card. -- EFFECT: Put the card into its owner's
// hand. Then, look at your opponent's hand and pick a card. Your opponent must
// discard that card. Tactic, cost 5, threshold [O][O].

const FORGET = "ea9b719e-c8ee-4911-9dfd-dd4ecfa842ce";

function forgetBoard(opts: { obsession?: number; greed?: number; oppHand?: string[] } = {}) {
  const oppHand = opts.oppHand ?? ["oh1", "oh2", "oh3"];
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...oppHand.map((key) => ({ key, def: character({ name: key.toUpperCase() }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 7, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Forget on `target`, answers the follow-up pick with `discardKey`. */
function forgetAndDiscard(engine: SpoilsEngine, id: (k: string) => string, target: string, discardKey?: string) {
  play(engine, P1, id("fg"), { selected: { bounced: [id(target)] } });
  if (discardKey) {
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you look at the hand and pick");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(discardKey)] } } as never);
    resolvePendingResponses(engine);
  }
}

for (const [target, owner] of [
  ["myChar", P1],
  ["myItem", P1],
  ["myLoc", P1],
  ["foeChar", P2],
  ["foeItem", P2],
  ["foeLoc", P2]
] as const) {
  clause(FORGET, "0:ability", `pays 5, puts the picked ${target} into its owner's hand, then you pick a card of the opponent's hand and they discard it`, () => {
    const { engine, id } = forgetBoard();
    const before = ready(engine);
    forgetAndDiscard(engine, id, target, "oh2");

    assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
    assert.equal(engine.state.cards[id(target)].zone, "hand");
    assert.equal(engine.state.players[owner].hand.includes(id(target)), true, "in its owner's hand");
    assert.equal(engine.state.cards[id("oh2")].zone, "discard", "the picked card is discarded");
    assert.equal(engine.state.players[P2].discard.includes(id("oh2")), true);
    for (const key of ["oh1", "oh3"]) assert.equal(engine.state.cards[id(key)].zone, "hand", `${key}: only the picked card is discarded`);
    assert.equal(engine.state.cards[id("myHand")].zone, "hand", "your own hand is not touched");
    assert.equal(engine.state.cards[id("fg")].zone, "discard");
  });
}

clause(FORGET, "0:ability", "a card you control but do not own goes to its OWNER's hand (and one the opponent controls goes to yours)", () => {
  const stolen = forgetBoard();
  forgetAndDiscard(stolen.engine, stolen.id, "stolen", "oh1");
  assert.equal(stolen.engine.state.players[P2].hand.includes(stolen.id("stolen")), true, "owned by P2: goes to P2's hand");
  assert.equal(stolen.engine.state.players[P1].hand.includes(stolen.id("stolen")), false);

  const lent = forgetBoard();
  forgetAndDiscard(lent.engine, lent.id, "lent", "oh1");
  assert.equal(lent.engine.state.players[P1].hand.includes(lent.id("lent")), true, "owned by P1: goes to P1's hand");
});

clause(FORGET, "0:ability", "the card just put into the opponent's hand can itself be the card you pick (the hand is looked at AFTER the bounce)", () => {
  const { engine, id } = forgetBoard({ oppHand: [] });
  forgetAndDiscard(engine, id, "foeChar", "foeChar");
  assert.equal(engine.state.cards[id("foeChar")].zone, "discard", "bounced to their hand, then discarded from it");
  assert.equal(engine.state.players[P2].discard.includes(id("foeChar")), true);
});

clause(FORGET, "0:ability", "you pick from the OPPONENT's hand only: your own hand (including a card you just bounced) is refused", () => {
  const { engine, id } = forgetBoard();
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  const attempt = (key: string) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
  assert.throws(attempt("myHand"), "a card from your own hand");
  assert.throws(attempt("myChar"), "the character you just returned to your own hand");
  assert.throws(attempt("foeChar"), "a card in play");
  assert.throws(attempt("inDiscard"), "a card in a discard pile");
  attempt("oh1")();
  assert.equal(engine.state.cards[id("oh1")].zone, "discard");
});

clause(FORGET, "0:ability", "picking a card from the opponent's hand is not optional while they hold cards: picking none or two is refused", () => {
  const { engine, id } = forgetBoard();
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  const attempt = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(attempt([]), "none");
  assert.throws(attempt(["oh1", "oh2"]), "two cards");
  attempt(["oh3"])();
  assert.equal(engine.state.cards[id("oh3")].zone, "discard");
  assert.equal(engine.state.cards[id("oh1")].zone, "hand");
  assert.equal(engine.state.cards[id("oh2")].zone, "hand");
});

clause(FORGET, "0:ability", "with no cards in the opponent's hand (and none bounced to it), nothing is discarded and the tactic still resolves", () => {
  const { engine, id } = forgetBoard({ oppHand: [] });
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("myChar")].zone, "hand");
  assert.equal(engine.state.players[P2].discard.length, 0);
  assert.equal(engine.state.cards[id("fg")].zone, "discard");
});

clause(FORGET, "0:ability", "only a non-resource card can be picked: staple resources, face-down cards, factions, cards in hand and cards in a discard pile are refused", () => {
  const { engine, id } = forgetBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("fg"), { selected: { bounced: [cardId] } });
  assert.ok(resourceId, "the board has a resource in play");
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(attempt(id("myHand")), "a card in your hand is not in play");
  assert.throws(attempt(id("oh1")), "a card in the opponent's hand");
  assert.throws(attempt(id("inDiscard")), "a card in a discard pile");
  assert.equal(engine.state.cards[id("fg")].zone, "hand", "nothing was played");
  attempt(id("foeItem"))();
  assert.ok(engine.state.responseWindow, "a non-resource permanent is accepted");
});

clause(FORGET, "0:ability", "is refused one resource short of 5, and without [O][O]", () => {
  const short = forgetBoard({ obsession: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("fg"), { selected: { bounced: [short.id("myChar")] } }));
  const noThreshold = forgetBoard({ obsession: 1, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("fg"), { selected: { bounced: [noThreshold.id("myChar")] } }));
  const exact = forgetBoard({ obsession: 5 });
  forgetAndDiscard(exact.engine, exact.id, "myChar", "oh1");
  assert.equal(exact.engine.state.cards[exact.id("myChar")].zone, "hand");
});

// --- COVERT (shared checks; each COVERT card calls these through its own printing) ---
// COVERT: a party made only of covert characters is a covert party; only covert
// characters may block it, and covert characters may block only covert parties
// (RULES.md 9, CR 507.3).

function covertBoard(printingId: string, attacker: typeof P1 | typeof P2) {
  const defender = attacker === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "subject", def: printing(printingId), owner: attacker, zone: "play" },
      { key: "plainAlly", def: character({ name: "PlainAlly" }), owner: attacker, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: defender, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" }
    ]
  });
}

function declareAttackBy(engine: SpoilsEngine, player: typeof P1 | typeof P2, attackerIds: string[]) {
  const defender = player === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: defender } });
  resolvePendingResponses(engine);
}

function covertHasKeyword(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  assert.ok(engine.getKeywords(id("subject")).includes("covert"), "engine.getKeywords(id(\"subject\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("plainAlly")).includes("covert"), false, "control: an ordinary character is not covert");
}

function covertCannotBeBlockedByNonCovert(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker"), id("covertBlocker")] }), "...nor join a covert blocker in the blocking party");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("covertBlocker")], "a covert character may block it");
}

function covertPartyNeedsEveryMemberCovert(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject"), id("plainAlly")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plainBlocker")], "with a non-covert party member the party is not covert, so anyone may block");
}

function covertBlocksOnlyCovertParties(printingId: string) {
  // P2 attacks with plain characters; the card under test (P1's, covert) is a would-be blocker
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P1, zone: "play" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("plainAttacker")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("subject")] }), "a covert character may block only a covert party");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plainBlocker")], "control: a plain character can block the plain attacker");

  const covertParty = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(covertParty.engine, P2, [covertParty.id("covertAttacker")]);
  covertParty.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [covertParty.id("subject")] });
  assert.deepEqual(covertParty.engine.state.battle?.blockingParty, [covertParty.id("subject")], "it can block a covert party");
}

// --- Insidious Ecto-Manipulator --------------------------------------------
// COVERT. At the start of your turn, you may pick a non-resource card you
// control. If you do, put a token on that card.

const INSIDIOUS = "c46cdf47-bad8-411c-a89f-387d69c1e115";

clause(INSIDIOUS, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(INSIDIOUS));

function insidiousBoard(opts: { controller?: typeof P1 | typeof P2; ieZone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ie", def: printing(INSIDIOUS), owner: P1, zone: opts.ieZone ?? "play", controller: opts.controller },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "handCard", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      { key: "discarded", def: character({ name: "Discarded" }), owner: P1, zone: "discard" },
      ...["a1", "a2", "a3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", 2, P1)
    ]
  });
}

const tokens = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].counters?.token ?? 0;
const ALL_INSIDIOUS_KEYS = ["ie", "ally", "myItem", "myLoc", "foe", "foeItem", "stolen", "lent", "faceDown", "handCard", "discarded"];

/** Both players pass turns until P1's next turn starts; the Insidious trigger prompt is then open. */
function toMyTurnStart(engine: SpoilsEngine) {
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt at the start of the OPPONENT's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
}

for (const [key, what] of [
  ["ie", "itself"],
  ["ally", "another character"],
  ["myItem", "an item"],
  ["myLoc", "a location"],
  ["stolen", "a character it controls but does not own"]
] as const) {
  clause(INSIDIOUS, "1:rule", `at the start of your turn you may pick ${what} you control and it gets one token (and nothing else does)`, () => {
    const { engine, id } = insidiousBoard();
    toMyTurnStart(engine);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
    resolvePendingResponses(engine);
    for (const other of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(other)), other === key ? 1 : 0, `${other} tokens`);
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(INSIDIOUS, "1:rule", "'may': picking nothing puts no token anywhere", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  resolvePendingResponses(engine);
  for (const key of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(INSIDIOUS, "1:rule", "a card that already has tokens gets one more", () => {
  const { engine, id } = insidiousBoard();
  engine.state.cards[id("myItem")].counters = { token: 2 };
  toMyTurnStart(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("myItem")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("myItem")), 3);
});

clause(INSIDIOUS, "1:rule", "only one card is picked: picking two is refused", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("ally"), id("myItem")] } } as never));
});

clause(INSIDIOUS, "1:rule", "can only pick non-resource cards YOU control: resources, face-down cards, factions, the opponent's cards, and cards outside play are refused", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  assert.ok(resourceId, "resourceId");
  const attempt = (cardId: string) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is a resource");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(id("foe")), "the opponent's character");
  assert.throws(attempt(id("foeItem")), "the opponent's item");
  assert.throws(attempt(id("lent")), "a card the opponent controls (even though you own it)");
  assert.throws(attempt(id("handCard")), "a card in your hand");
  assert.throws(attempt(id("discarded")), "a card in your discard pile");
  attempt(id("ally"))();
  assert.equal(tokens(engine, id("ally")), 1);
});

clause(INSIDIOUS, "1:rule", "does not trigger at the start of the opponent's turn", () => {
  const { engine, id } = insidiousBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt for P1 on P2's turn");
  for (const key of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(INSIDIOUS, "1:rule", "'your turn' is its controller's turn: an Insidious controlled by the opponent triggers for them, not for its owner", () => {
  const { engine, id } = insidiousBoard({ controller: P2 });
  endTurn(engine, P1); // P2's turn begins: P2 controls it
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the controller chooses");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("lent")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("lent")), 1, "P2 may pick a card P2 controls");
  endTurn(engine, P2); // P1's turn begins
  assert.equal(engine.state.pendingChoice, undefined, "its owner gets nothing at the start of their own turn");
});

clause(INSIDIOUS, "1:rule", "does not trigger while it is not in play (in hand)", () => {
  const { engine } = insidiousBoard({ ieZone: "hand" });
  toMyTurnStart(engine);
  assert.equal(engine.state.pendingChoice, undefined);
});

// --- Knobby Stave ----------------------------------------------------------
// This card enters play with 2 tokens on it.
// DISRUPT -- COST: Remove 2 tokens from this card. -- EFFECT: Your opponent
// must discard a card. Item, cost 0, threshold [O][O].

const STAVE = "bb153366-ff1b-44f8-8e82-f005d31120a2";

function staveBoard(opts: { tokens?: number; oppHand?: number; obsession?: number; stave?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ks", def: printing(STAVE), owner: P1, zone: opts.stave ?? "play", counters: opts.stave === "hand" ? undefined : { token: opts.tokens ?? 2 } },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 3 }, (_, i) => ({ key: `oh${i + 1}`, def: character({ name: `OH${i + 1}` }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 0, P1)
    ]
  });
}

clause(STAVE, "0:rule", "enters play with 2 tokens on it, costing nothing", () => {
  const { engine, id } = staveBoard({ stave: "hand", obsession: 2 });
  const before = ready(engine);
  play(engine, P1, id("ks"));
  assert.equal(engine.state.cards[id("ks")].zone, "play");
  assert.equal(tokens(engine, id("ks")), 2, "exactly 2 tokens");
  assert.equal(ready(engine), before, "cost 0: no resources are paid");
});

clause(STAVE, "0:rule", "needs [O][O] to be deployed even though it costs 0", () => {
  const one = staveBoard({ stave: "hand", obsession: 1 });
  assert.throws(() => playRaw(one.engine, P1, one.id("ks")));
  assert.equal(one.engine.state.cards[one.id("ks")].zone, "hand");
  const none = staveBoard({ stave: "hand", obsession: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("ks")));
});

clause(STAVE, "1:ability:disrupt", "removes exactly 2 tokens (from 2 leaves 0, from 3 leaves 1) and the opponent discards a card of their choice", () => {
  for (const [start, left] of [
    [2, 0],
    [3, 1]
  ] as const) {
    const { engine, id } = staveBoard({ tokens: start });
    activate(engine, P1, id("ks"), "disrupt");
    assert.equal(tokens(engine, id("ks")), left, `tokens after DISRUPT from ${start}`);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the OPPONENT chooses what to discard");
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oh2")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("oh2")].zone, "discard");
    assert.equal(engine.state.players[P2].discard.includes(id("oh2")), true);
    for (const key of ["oh1", "oh3"]) assert.equal(engine.state.cards[id(key)].zone, "hand", `${key}: exactly one card is discarded`);
    assert.equal(engine.state.cards[id("myHand")].zone, "hand", "your own hand is untouched");
    assert.equal(engine.state.cards[id("ks")].zone, "play", "the Stave stays in play");
  }
});

clause(STAVE, "1:ability:disrupt", "the discard must be a card from the opponent's hand: your own card, or none, is refused", () => {
  const { engine, id } = staveBoard();
  activate(engine, P1, id("ks"), "disrupt");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("myHand")] } } as never));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [] } } as never));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oh1"), id("oh2")] } } as never));
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oh1")] } } as never);
  assert.equal(engine.state.cards[id("oh1")].zone, "discard");
});

clause(STAVE, "1:ability:disrupt", "needs 2 tokens: refused with 1 token or none", () => {
  for (const have of [0, 1]) {
    const { engine, id } = staveBoard({ tokens: have });
    assert.throws(() => activate(engine, P1, id("ks"), "disrupt"), `${have} tokens`);
    assert.equal(tokens(engine, id("ks")), have, "nothing was removed");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P2].hand.length, 3);
  }
});

clause(STAVE, "1:ability:disrupt", "with 4 tokens it can be used twice, discarding two cards in all", () => {
  const { engine, id } = staveBoard({ tokens: 4 });
  for (const discard of ["oh1", "oh3"]) {
    activate(engine, P1, id("ks"), "disrupt");
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id(discard)] } } as never);
    resolvePendingResponses(engine);
  }
  assert.equal(tokens(engine, id("ks")), 0);
  assert.equal(engine.state.players[P2].hand.length, 1);
  assert.throws(() => activate(engine, P1, id("ks"), "disrupt"), "no tokens left");
});

clause(STAVE, "1:ability:disrupt", "with no cards in the opponent's hand the tokens are still spent and nothing happens to them", () => {
  const { engine, id } = staveBoard({ oppHand: 0 });
  activate(engine, P1, id("ks"), "disrupt");
  drain(engine, declineAll);
  assert.equal(tokens(engine, id("ks")), 0);
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(STAVE, "1:ability:disrupt", "an opponent cannot use your Stave", () => {
  const { engine, id } = staveBoard();
  assert.throws(() => activate(engine, P2, id("ks"), "disrupt"));
  assert.equal(tokens(engine, id("ks")), 2);
});

// --- Lugubrian Octopod -----------------------------------------------------
// COVERT. If this card inflicts damage to a faction, your opponent must
// discard 2 cards. Character, 1 strength / 1 speed / 1 life.

const OCTOPOD = "9637226d-3115-48cd-bf92-b6946d7eafed";

clause(OCTOPOD, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(OCTOPOD));

function octopodBoard(opts: { attacker?: typeof P1 | typeof P2; defenderHand?: number; weakened?: boolean } = {}) {
  const attacker = opts.attacker ?? P1;
  const defender = attacker === P1 ? P2 : P1;
  const weakener = item({
    name: "Weakener",
    attachTo: "character",
    behavior: { abilities: [{ id: "weaken", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -1 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "oct", def: printing(OCTOPOD), owner: attacker, zone: "play" },
      ...(opts.weakened ? [{ key: "weakener", def: weakener, owner: attacker, zone: "play" as const, attachedToKey: "oct" }] : []),
      { key: "covertAlly", def: character({ name: "CovertAlly", strength: 2, life: 3, speed: 2, behavior: { keywords: ["covert"] } }), owner: attacker, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", strength: 1, life: 4, speed: 1, behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" },
      { key: "theirLoc", def: location({ name: "TheirLoc", structure: 5 }), owner: defender, zone: "play" },
      ...Array.from({ length: opts.defenderHand ?? 3 }, (_, i) => ({ key: `dh${i + 1}`, def: character({ name: `DH${i + 1}` }), owner: defender, zone: "hand" as const })),
      { key: "attackerHand", def: character({ name: "AttackerHand" }), owner: attacker, zone: "hand" }
    ]
  });
}

function fight(engine: SpoilsEngine, attacker: typeof P1 | typeof P2, attackers: string[], target: { type: "faction"; playerId: string } | { type: "card"; cardId: string }, blockers: string[]) {
  const defender = attacker === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackers, target });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: blockers });
  autoResolveBattle(engine);
}

/** Answers the discard prompt(s): the discarding player gives up their first `keys`. */
function discardChoices(engine: SpoilsEngine, id: (k: string) => string, keys: string[]) {
  const asked: Array<{ kind: string; playerId: string }> = [];
  drain(engine, (pc) => {
    asked.push({ kind: pc.kind, playerId: pc.playerId });
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: keys.map(id) };
    return declineAll(pc);
  });
  return asked;
}

clause(OCTOPOD, "1:rule", "when it damages a faction (unblocked), the opponent discards 2 cards of their choice, in addition to losing influence", () => {
  const { engine, id } = octopodBoard();
  const influence = engine.state.players[P2].influence;
  fight(engine, P1, [id("oct")], { type: "faction", playerId: P2 }, []);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses their discards");
  discardChoices(engine, id, ["dh1", "dh3"]);
  assert.equal(engine.state.players[P2].influence, influence - 1, "the Octopod's 1 damage was inflicted on the faction");
  assert.equal(engine.state.cards[id("dh1")].zone, "discard");
  assert.equal(engine.state.cards[id("dh3")].zone, "discard");
  assert.equal(engine.state.cards[id("dh2")].zone, "hand", "exactly two cards are discarded");
  assert.equal(engine.state.cards[id("attackerHand")].zone, "hand", "your hand is untouched");
});

clause(OCTOPOD, "1:rule", "an opponent with only 1 card discards it; with no cards nothing happens", () => {
  const one = octopodBoard({ defenderHand: 1 });
  fight(one.engine, P1, [one.id("oct")], { type: "faction", playerId: P2 }, []);
  discardChoices(one.engine, one.id, ["dh1"]);
  assert.equal(one.engine.state.cards[one.id("dh1")].zone, "discard");

  const none = octopodBoard({ defenderHand: 0 });
  fight(none.engine, P1, [none.id("oct")], { type: "faction", playerId: P2 }, []);
  drain(none.engine, declineAll);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(none.engine.state.players[P2].discard.length, 0);
});

clause(OCTOPOD, "1:rule", "does not trigger when its damage goes to a character (a covert blocker)", () => {
  const { engine, id } = octopodBoard();
  fight(engine, P1, [id("oct")], { type: "faction", playerId: P2 }, [id("covertBlocker")]);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("covertBlocker")].damage, 1, "the Octopod hit the blocker");
  assert.equal(engine.state.players[P2].hand.length, 3, "no discards");
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(OCTOPOD, "1:rule", "does not trigger when its damage goes to a location", () => {
  const { engine, id } = octopodBoard();
  fight(engine, P1, [id("oct")], { type: "card", cardId: id("theirLoc") }, []);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("theirLoc")].damage, 1, "the Octopod hit the location");
  assert.equal(engine.state.players[P2].hand.length, 3, "no discards");
});

clause(OCTOPOD, "1:rule", "does not trigger when ANOTHER character damages the faction", () => {
  const { engine, id } = octopodBoard();
  fight(engine, P1, [id("covertAlly")], { type: "faction", playerId: P2 }, []);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].influence, 30 - 2, "the ally dealt 2 damage to the faction (default faction starts at 30)");
  assert.equal(engine.state.players[P2].hand.length, 3, "but the Octopod did not inflict it, so no discards");
});

clause(OCTOPOD, "1:rule", "attacking with another character, the Octopod's own damage still triggers it exactly once", () => {
  const { engine, id } = octopodBoard({ defenderHand: 5 });
  fight(engine, P1, [id("oct"), id("covertAlly")], { type: "faction", playerId: P2 }, []);
  const asked = discardChoices(engine, id, ["dh1", "dh2"]);
  assert.equal(asked.filter((a) => a.kind === "chooserSelectsTarget").length, 1, "one trigger, one discard prompt");
  assert.equal(engine.state.players[P2].hand.length, 3, "5 cards minus exactly 2");
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(OCTOPOD, "1:rule", "'your opponent' is the Octopod controller's opponent: when the opponent attacks with it, the other player discards", () => {
  const { engine, id } = octopodBoard({ attacker: P2 });
  fight(engine, P2, [id("oct")], { type: "faction", playerId: P1 }, []);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.playerId, P1, "the defending player discards");
  discardChoices(engine, id, ["dh1", "dh2"]);
  assert.equal(engine.state.players[P1].hand.length, 1, "3 cards minus 2");
  assert.equal(engine.state.cards[id("attackerHand")].zone, "hand", "the Octopod's controller keeps their cards");
});

clause(OCTOPOD, "1:rule", "inflicting 0 damage inflicts nothing: a weakened (0 strength) Octopod does not trigger", () => {
  const { engine, id } = octopodBoard({ weakened: true });
  assert.equal(engine.getStat(id("oct"), "strength"), 0, "the test's weakening item works");
  const influence = engine.state.players[P2].influence;
  fight(engine, P1, [id("oct")], { type: "faction", playerId: P2 }, []);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].influence, influence, "no damage");
  assert.equal(engine.state.players[P2].hand.length, 3, "so no discards");
});

// --- Lugubrious Finger Trap ------------------------------------------------
// ATTACH TO CHARACTER. The attached character cannot attack or block.
// Item (gear), cost 3, threshold [O].

const FINGER_TRAP = "a59b90bd-20f7-4ea2-ba2f-82ebaecd48d8";

function fingerTrapBoard(opts: { obsession?: number; greed?: number; trapZone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "trap", def: printing(FINGER_TRAP), owner: P1, zone: opts.trapZone ?? "hand", attachedToKey: opts.trapZone === "play" ? "mine" : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(FINGER_TRAP, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays 3", () => {
  for (const hostKey of ["mine", "foe"] as const) {
    const { engine, id } = fingerTrapBoard();
    const before = ready(engine);
    play(engine, P1, id("trap"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(engine.state.cards[id("trap")].zone, "play");
    assert.equal(engine.state.cards[id("trap")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("trap")].controllerId, P1, "the Trap's controller is its player, whoever the host belongs to");
    assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  }
});

clause(FINGER_TRAP, "0:attach", "is refused for a host that is not a character (item, location, faction, face-down card)", () => {
  const { engine, id } = fingerTrapBoard();
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("trap"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(() => playRaw(engine, P1, id("trap"), { selected: {} }), "no host chosen");
  assert.equal(engine.state.cards[id("trap")].zone, "hand");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "a character host is accepted");
});

clause(FINGER_TRAP, "0:attach", "is refused one resource short of 3, and without [O]", () => {
  const short = fingerTrapBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("trap"), { selected: { attachTo: [short.id("mine")] } }));
  const noThreshold = fingerTrapBoard({ obsession: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("trap"), { selected: { attachTo: [noThreshold.id("mine")] } }));
  const exact = fingerTrapBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("trap"), { selected: { attachTo: [exact.id("mine")] } });
  assert.equal(exact.engine.state.cards[exact.id("trap")].zone, "play");
});

clause(FINGER_TRAP, "1:rule", "the attached character cannot attack, alone or in a party; other characters can, and so can the same character without the Trap", () => {
  const trapped = fingerTrapBoard({ trapZone: "play" });
  assert.throws(() => declareAttackBy(trapped.engine, P1, [trapped.id("mine")]), "the attached character cannot attack");
  assert.throws(() => declareAttackBy(trapped.engine, P1, [trapped.id("mine"), trapped.id("mate")]), "...nor as part of a party");
  assert.equal(trapped.engine.state.battle, undefined, "no battle was started by the refused attacks");
  declareAttackBy(trapped.engine, P1, [trapped.id("mate")]);
  assert.deepEqual(battleOf(trapped.engine)?.attackingParty, [trapped.id("mate")], "an unattached character can attack");

  const free = fingerTrapBoard();
  declareAttackBy(free.engine, P1, [free.id("mine")]);
  assert.deepEqual(free.engine.state.battle?.attackingParty, [free.id("mine")], "control: without the Trap the same character attacks");
});

clause(FINGER_TRAP, "1:rule", "the attached character cannot block; other characters can", () => {
  const { engine, id } = fingerTrapBoard();
  // P2 owns the host this time: attach P1's Trap to P2's Foe, then P2 is attacked
  play(engine, P1, id("trap"), { selected: { attachTo: [id("foe")] } });
  endTurn(engine, P1);
  endTurn(engine, P2);
  // P1's turn again (turn 4): attack P2
  declareAttackBy(engine, P1, [id("mine")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] }), "the attached character cannot block");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe"), id("foe2")] }), "...nor as part of a blocking party");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe2")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("foe2")], "an unattached character can block");
});

clause(FINGER_TRAP, "1:rule", "an opponent's character wearing your Trap cannot attack on their own turn", () => {
  const { engine, id } = fingerTrapBoard();
  play(engine, P1, id("trap"), { selected: { attachTo: [id("foe")] } });
  endTurn(engine, P1); // P2's turn
  assert.equal(engine.state.activePlayerId, P2);
  assert.throws(() => declareAttackBy(engine, P2, [id("foe")]), "cannot attack");
  declareAttackBy(engine, P2, [id("foe2")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("foe2")]);
});

clause(FINGER_TRAP, "1:rule", "once the Trap leaves play the restriction is lifted", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "smash", def: smash, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "trap", def: printing(FINGER_TRAP), owner: P2, zone: "play", attachedToKey: "mine" }
    ]
  });
  assert.throws(() => declareAttackBy(engine, P1, [id("mine")]), "restricted while the Trap is attached");
  play(engine, P1, id("smash"), { selected: { t: [id("trap")] } });
  assert.equal(engine.state.cards[id("trap")].zone, "discard");
  declareAttackBy(engine, P1, [id("mine")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("mine")], "the character can attack again");
});

// --- Master Ritualist ------------------------------------------------------
// QUOTIDIAN INSTRUCTION -- COST: Deplete this card. -- EFFECT: Search your deck
// for a tactic and put it into your hand. Character, cost 9, threshold [O][O].

const RITUALIST = "fbbffe5f-fa1f-43b7-bd89-264a17a09cb3";

function ritualistBoard(opts: { attackEligible?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play", attackEligible: opts.attackEligible },
      { key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" },
      { key: "tac2", def: tactic({ name: "Tac2" }), owner: P1, zone: "deck" },
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "deck" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "deck" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: P2, zone: "deck" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner: P1, zone: "hand" },
      { key: "discTac", def: tactic({ name: "DiscTac" }), owner: P1, zone: "discard" }
    ]
  });
}

function searchPick(engine: SpoilsEngine, selected: string[], player: typeof P1 | typeof P2 = P1) {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

clause(RITUALIST, "0:ability:qi", "depletes itself, then you search your deck for a tactic and put it into your hand", () => {
  const { engine, id } = ritualistBoard();
  const handBefore = engine.state.players[P1].hand.length;
  activate(engine, P1, id("mr"), "qi");
  assert.equal(engine.state.cards[id("mr")].depleted, true, "COST: deplete this card");
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you do the searching");
  searchPick(engine, [id("tac2")]);
  assert.equal(engine.state.cards[id("tac2")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.length, handBefore + 1, "exactly one card into hand");
  assert.equal(engine.state.cards[id("tac1")].zone, "deck", "the other tactic stays in the deck");
  assert.equal(engine.state.cards[id("chr")].zone, "deck");
  assert.equal(engine.state.cards[id("itm")].zone, "deck");
});

clause(RITUALIST, "0:ability:qi", "only a tactic in your own deck can be found: characters, items, the opponent's tactics and tactics outside the deck are refused", () => {
  const { engine, id } = ritualistBoard();
  activate(engine, P1, id("mr"), "qi");
  for (const [key, why] of [
    ["chr", "a character"],
    ["itm", "an item"],
    ["oppTac", "a tactic in the OPPONENT's deck"],
    ["handTac", "a tactic in your hand"],
    ["discTac", "a tactic in your discard pile"]
  ] as const) {
    assert.throws(() => searchPick(engine, [id(key)]), why);
  }
  assert.throws(() => searchPick(engine, [id("tac1"), id("tac2")]), "only one tactic");
  searchPick(engine, [id("tac1")]);
  assert.equal(engine.state.cards[id("tac1")].zone, "hand");
});

clause(RITUALIST, "0:ability:qi", "a search with criteria may fail: finding nothing is allowed and puts nothing in hand (CR 312.2)", () => {
  const { engine, id } = ritualistBoard();
  const handBefore = [...engine.state.players[P1].hand];
  activate(engine, P1, id("mr"), "qi");
  searchPick(engine, []);
  assert.deepEqual(engine.state.players[P1].hand, handBefore);
  assert.equal(engine.state.cards[id("mr")].depleted, true, "the cost was paid anyway");
});

clause(RITUALIST, "0:ability:qi", "with no tactic in the deck, the ability still costs a deplete and finds nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" },
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "deck" }
    ]
  });
  activate(engine, P1, id("mr"), "qi");
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("mr")].depleted, true);
  assert.equal(engine.state.cards[id("chr")].zone, "deck");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RITUALIST, "0:ability:qi", "cannot be used while depleted, but is usable again once restored at the start of your next turn", () => {
  const { engine, id } = ritualistBoard();
  activate(engine, P1, id("mr"), "qi");
  searchPick(engine, [id("tac1")]);
  assert.throws(() => activate(engine, P1, id("mr"), "qi"), "depleted: cost cannot be paid again");
  assert.equal(engine.state.cards[id("tac2")].zone, "deck", "nothing else was fetched");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("mr")].depleted, false, "restored");
  activate(engine, P1, id("mr"), "qi");
  searchPick(engine, [id("tac2")]);
  assert.equal(engine.state.cards[id("tac2")].zone, "hand");
});

clause(RITUALIST, "0:ability:qi", "can be used the turn it enters play, and only by its controller", () => {
  const { engine, id } = ritualistBoard({ attackEligible: false });
  assert.throws(() => activate(engine, P2, id("mr"), "qi"), "the opponent cannot use it");
  assert.equal(engine.state.cards[id("mr")].depleted, false);
  activate(engine, P1, id("mr"), "qi");
  searchPick(engine, [id("tac1")]);
  assert.equal(engine.state.cards[id("tac1")].zone, "hand", "abilities are usable the turn a character arrives (CR 204.3a)");
});

// --- Mephitic Nullifier ----------------------------------------------------
// FLASH-BANG -- COST: Destroy this card. Pick a character you control. --
// EFFECT: Put the character into its owner's hand. Character, cost 4.

const NULLIFIER = "d56eb93a-2971-4b24-8135-624469d9dc61";

function nullifierBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mn", def: printing(NULLIFIER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", damage: 1, depleted: true },
      { key: "ally2", def: character({ name: "Ally2" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
    ]
  });
}

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "destroys itself as the cost, then the picked character you control goes to its owner's hand (and nothing else moves)", () => {
  const { engine, id } = nullifierBoard();
  activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [id("ally")] } });
  assert.equal(engine.state.cards[id("mn")].zone, "discard", "COST: destroy this card");
  assert.equal(engine.state.players[P1].discard.includes(id("mn")), true);
  assert.equal(engine.state.cards[id("ally")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("ally")), true);
  for (const key of ["ally2", "thing", "foe", "stolen", "lent"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} is untouched`);
});

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "a character you control but do not own goes to its OWNER's hand", () => {
  const { engine, id } = nullifierBoard();
  activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [id("stolen")] } });
  assert.equal(engine.state.cards[id("stolen")].zone, "hand");
  assert.equal(engine.state.players[P2].hand.includes(id("stolen")), true, "owned by P2");
  assert.equal(engine.state.players[P1].hand.includes(id("stolen")), false);
  assert.equal(engine.state.cards[id("mn")].zone, "discard");
});

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "only a character YOU control can be picked: not the opponent's, not a card you own but they control, not items, factions, face-down cards or cards outside play", () => {
  const { engine, id } = nullifierBoard();
  const attempt = (cardId: string) => () => activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [cardId] } });
  assert.throws(attempt(id("foe")), "the opponent's character");
  assert.throws(attempt(id("lent")), "a character you own but the opponent controls");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(id("inHand")), "a card in hand");
  assert.throws(() => activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: {} }), "no pick at all");
  assert.equal(engine.state.cards[id("mn")].zone, "play", "a refused activation destroys nothing");
  attempt(id("ally2"))();
  assert.equal(engine.state.cards[id("ally2")].zone, "hand");
});

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "only its controller can use it", () => {
  const { engine, id } = nullifierBoard();
  assert.throws(() => activate(engine, P2, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [id("foe")] } }));
  assert.equal(engine.state.cards[id("mn")].zone, "play");
});

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "the cost destroys this card BEFORE the pick, so with no OTHER character you control there is nothing legal to pick and it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mn", def: printing(NULLIFIER), owner: P1, zone: "play" }]
  });
  assert.throws(() => activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [id("mn")] } }), "this card is destroyed first, so it is not 'a character you control' when you pick");
  assert.equal(engine.state.cards[id("mn")].zone, "play");
});

// --- Napiform Protuberance -------------------------------------------------
// ATTACH TO CHARACTER. This card enters play with 1 token on it. At the start
// of your turn, you may put a token on this card. The attached character loses
// 1 strength, 1 life, and 1 speed for each token on this card.
// Item (gear), cost 2, threshold [O].

const NAPIFORM = "37093105-be92-4b4d-86bb-d994eaf0fff0";

function napiformBoard(opts: { zone?: "hand" | "play"; tokens?: number; hostOwner?: typeof P1 | typeof P2; controller?: typeof P1 | typeof P2; obsession?: number; greed?: number } = {}) {
  const zone = opts.zone ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "np",
        def: printing(NAPIFORM),
        owner: P1,
        controller: opts.controller,
        zone,
        attachedToKey: zone === "play" ? "host" : undefined,
        counters: zone === "play" ? { token: opts.tokens ?? 1 } : undefined
      },
      { key: "host", def: character({ name: "Host", strength: 6, life: 6, speed: 6 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 6, life: 6, speed: 6 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 6, speed: 6 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      ...["a1", "a2"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const stats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

clause(NAPIFORM, "0:attach", "attaches to a character (yours or the opponent's) for its cost of 2", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = napiformBoard();
    const before = ready(engine);
    play(engine, P1, id("np"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(engine.state.cards[id("np")].zone, "play");
    assert.equal(engine.state.cards[id("np")].attachedTo, id(hostKey));
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  }
});

clause(NAPIFORM, "0:attach", "is refused for an item, a location, a faction or a face-down card; and without [O] or one resource short", () => {
  const { engine, id } = napiformBoard();
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("np"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.equal(engine.state.cards[id("np")].zone, "hand");

  const short = napiformBoard({ obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("np"), { selected: { attachTo: [short.id("host")] } }));
  const noThreshold = napiformBoard({ obsession: 0, greed: 4 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("np"), { selected: { attachTo: [noThreshold.id("host")] } }));
});

clause(NAPIFORM, "1:rule", "enters play with exactly 1 token on it", () => {
  const { engine, id } = napiformBoard();
  play(engine, P1, id("np"), { selected: { attachTo: [id("host")] } });
  assert.equal(tokens(engine, id("np")), 1);
});

clause(NAPIFORM, "2:rule", "at the start of your turn you may put a token on it: accepting adds one, declining adds none", () => {
  for (const accept of [true, false]) {
    const { engine, id } = napiformBoard({ zone: "play", tokens: 1 });
    endTurn(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "nothing is offered at the start of the opponent's turn");
    assert.equal(tokens(engine, id("np")), 1);
    endTurn(engine, P2);
    assert.equal(engine.state.activePlayerId, P1);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.ok(pc, "a choice is offered at the start of YOUR turn");
    assert.equal(pc.playerId, P1);
    if (pc.kind === "mayPay") {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: accept } } as never);
    } else if (pc.kind === "chooserSelectsOption") {
      const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
      const index = options.findIndex((o) => (accept ? /token/i.test(o.label ?? "") : /decline/i.test(o.label ?? "")));
      assert.ok(index >= 0, "the prompt has a put-a-token option and a decline option");
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
    } else {
      assert.equal(pc.kind, "chooserSelectsTarget");
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: accept ? [id("np")] : [] } } as never);
    }
    resolvePendingResponses(engine);
    assert.equal(tokens(engine, id("np")), accept ? 2 : 1, accept ? "a token was added" : "no token was added");
    assert.equal(engine.state.pendingChoice, undefined);
  }
});

clause(NAPIFORM, "2:rule", "'your turn' is the controller's: on a host the opponent owns it is still the Napiform controller's turn that counts", () => {
  const { engine, id } = napiformBoard({ zone: "play", tokens: 1, hostOwner: P2 });
  endTurn(engine, P1); // P2's turn: the host's owner is active, but P1 controls the Napiform
  assert.equal(engine.state.pendingChoice, undefined, "no prompt on the host owner's turn");
  endTurn(engine, P2);
  assert.ok(engine.state.pendingChoice, "the prompt comes on the Napiform controller's turn");
  assert.equal((engine.state.pendingChoice as unknown as { playerId: string }).playerId, P1);
  void id;
});

for (const n of [0, 1, 2, 3, 4]) {
  clause(NAPIFORM, "3:rule", `with ${n} token(s) on it, the attached character loses ${n} strength, ${n} life and ${n} speed; nobody else does`, () => {
    const { engine, id } = napiformBoard({ zone: "play", tokens: n });
    assert.deepEqual(stats(engine, id("host")), [6 - n, 6 - n, 6 - n], "the attached character");
    assert.deepEqual(stats(engine, id("bystander")), [6, 6, 6], "another of your characters");
    assert.deepEqual(stats(engine, id("foe")), [6, 6, 6], "an opponent's character");
  });
}

clause(NAPIFORM, "3:rule", "the penalty follows the token count as it changes, and ends when the Napiform leaves play", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "smash", def: smash, owner: P1, zone: "hand" },
      { key: "np", def: printing(NAPIFORM), owner: P1, zone: "play", attachedToKey: "host", counters: { token: 1 } },
      { key: "host", def: character({ name: "Host", strength: 6, life: 6, speed: 6 }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stats(engine, id("host")), [5, 5, 5]);
  engine.state.cards[id("np")].counters = { token: 3 };
  assert.deepEqual(stats(engine, id("host")), [3, 3, 3], "more tokens, bigger penalty");
  play(engine, P1, id("smash"), { selected: { t: [id("np")] } });
  assert.equal(engine.state.cards[id("np")].zone, "discard");
  assert.deepEqual(stats(engine, id("host")), [6, 6, 6], "gone with the Napiform");
});

clause(NAPIFORM, "3:rule", "applies to an opponent's character too (the host is whoever it is attached to)", () => {
  const { engine, id } = napiformBoard({ zone: "play", tokens: 2, hostOwner: P2 });
  assert.deepEqual(stats(engine, id("host")), [4, 4, 4]);
});

// --- Nearby Serpent --------------------------------------------------------
// COVERT. When this card enters play, look at up to the top 5 cards of either
// deck and put them back in any order. Character, cost 3, threshold [O][O][O].

const SERPENT = "9b13c156-b7f9-4678-93ff-062a78e3bc5a";

clause(SERPENT, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(SERPENT));
clause(SERPENT, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(SERPENT));
clause(SERPENT, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(SERPENT));
clause(SERPENT, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(SERPENT));

function serpentBoard(opts: { deck1?: number; deck2?: number; obsession?: number; greed?: number; serpentZone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ns", def: printing(SERPENT), owner: P1, zone: opts.serpentZone ?? "hand" },
      { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.deck1 ?? 8 }, (_, i) => ({ key: `a${i}`, def: character({ name: `A${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.deck2 ?? 8 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

function serpentLooks(engine: SpoilsEngine, whose: typeof P1 | typeof P2) {
  const pick = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pick.kind, "chooserSelectsTarget", "you pick which deck");
  assert.equal(pick.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [engine.state.players[whose].factionId!] } } as never);
  resolvePendingResponses(engine);
}

for (const whose of [P1, P2] as const) {
  clause(SERPENT, "1:rule", `on entering play, you look at the top 5 cards of ${whose === P1 ? "your own" : "the opponent's"} deck and put them back in the order you choose`, () => {
    const { engine, id } = serpentBoard();
    const before = engine.state.players[whose].deck.slice();
    const otherBefore = engine.state.players[whose === P1 ? P2 : P1].deck.slice();
    const paid = ready(engine);
    play(engine, P1, id("ns"));
    assert.equal(paid - ready(engine), 3, "the printed cost of 3 is paid");
    serpentLooks(engine, whose);

    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; cardIds: string[] };
    assert.equal(pc.kind, "reorderDeck");
    assert.equal(pc.playerId, P1, "the Serpent's controller does the looking and the ordering");
    assert.deepEqual(pc.cardIds, before.slice(0, 5), "exactly the top 5 cards of the chosen deck");

    const order = [pc.cardIds[3], pc.cardIds[0], pc.cardIds[4], pc.cardIds[1], pc.cardIds[2]];
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
    resolvePendingResponses(engine);
    assert.deepEqual(engine.state.players[whose].deck, [...order, ...before.slice(5)], "back on top in the chosen order, the rest untouched");
    assert.deepEqual(engine.state.players[whose === P1 ? P2 : P1].deck, otherBefore, "the other deck is untouched");
    assert.equal(engine.state.cards[id("ns")].zone, "play");
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(SERPENT, "1:rule", "'up to the top 5': a deck with fewer than 5 cards shows all of them, and an empty deck shows nothing", () => {
  const three = serpentBoard({ deck2: 3 });
  const before = three.engine.state.players[P2].deck.slice();
  play(three.engine, P1, three.id("ns"));
  serpentLooks(three.engine, P2);
  const pc = three.engine.state.pendingChoice as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, before, "all 3 cards");
  const order = [...before].reverse();
  three.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.deepEqual(three.engine.state.players[P2].deck, order);

  const empty = serpentBoard({ deck2: 0 });
  play(empty.engine, P1, empty.id("ns"));
  serpentLooks(empty.engine, P2);
  drain(empty.engine, declineAll);
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(empty.engine.state.cards[empty.id("ns")].zone, "play");
});

clause(SERPENT, "1:rule", "the new order must be a rearrangement of exactly the cards looked at", () => {
  const { engine, id } = serpentBoard();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P2);
  const pc = engine.state.pendingChoice as unknown as { cardIds: string[] };
  const attempt = (order: string[]) => () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.throws(attempt(pc.cardIds.slice(1)), "the top card left out while deeper ones are kept (\"up to the top 5\" only shortens the look from the bottom)");
  assert.throws(attempt([...pc.cardIds.slice(0, 4), id("b6")]), "a card from further down the deck");
  assert.throws(attempt([...pc.cardIds.slice(0, 4), pc.cardIds[0]]), "a card twice");
  attempt([...pc.cardIds])();
});

clause(SERPENT, "1:rule", "triggers when THIS card enters play, not when another card does", () => {
  const { engine, id } = serpentBoard({ serpentZone: "play" });
  play(engine, P1, id("other"));
  assert.equal(engine.state.cards[id("other")].zone, "play", "another character entered play");
  assert.equal(engine.state.pendingChoice, undefined, "the Serpent already in play does not trigger");
});

clause(SERPENT, "1:rule", "does not trigger at the start of a turn, only on entering play", () => {
  const { engine } = serpentBoard({ serpentZone: "play" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SERPENT, "1:rule", "is refused one resource short of 3, and without [O][O][O]", () => {
  const short = serpentBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ns")));
  const noThreshold = serpentBoard({ obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ns")));
  const exact = serpentBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("ns"));
  assert.equal(exact.engine.state.cards[exact.id("ns")].zone, "play");
});

// --- Ominous Oozling -------------------------------------------------------
// COVERT. Character, cost 8, threshold [O][O], 5 strength / 3 speed / 4 life.

const OOZLING = "91df6435-631c-414b-866a-107c7d055757";

clause(OOZLING, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(OOZLING));
clause(OOZLING, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(OOZLING));
clause(OOZLING, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(OOZLING));
clause(OOZLING, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(OOZLING));

// --- Quotidian Assassination -----------------------------------------------
// COST: Pick a character. -- EFFECT: Put the character into its owner's hand.
// Tactic, cost 2, threshold [O].

const ASSASSINATION = "c532e23b-4ef7-4d19-a7f7-5f6acaee4ff8";

function assassinationBoard(opts: { obsession?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qa", def: printing(ASSASSINATION), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", damage: 1, depleted: true, counters: { token: 2 } },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

for (const [target, owner] of [
  ["mine", P1],
  ["foe", P2],
  ["stolen", P2],
  ["lent", P1]
] as const) {
  clause(ASSASSINATION, "0:ability", `pays 2 and puts the picked character (${target}) into its owner's hand; other characters stay`, () => {
    const { engine, id } = assassinationBoard();
    const before = ready(engine);
    play(engine, P1, id("qa"), { selected: { target: [id(target)] } });
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
    assert.equal(engine.state.cards[id(target)].zone, "hand");
    assert.equal(engine.state.players[owner].hand.includes(id(target)), true, `in ${owner}'s hand (its owner)`);
    for (const key of ["mine", "mine2", "foe", "foe2", "stolen", "lent"]) {
      if (key !== target) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} stays in play`);
    }
    assert.equal(engine.state.cards[id("qa")].zone, "discard");
  });
}

clause(ASSASSINATION, "0:ability", "a character leaving play sheds its damage and depletion", () => {
  const { engine, id } = assassinationBoard();
  play(engine, P1, id("qa"), { selected: { target: [id("mine")] } });
  const card = engine.state.cards[id("mine")];
  assert.equal(card.damage ?? 0, 0);
  assert.equal(card.depleted, false);
});

clause(ASSASSINATION, "0:ability", "a character put into its owner's hand loses its tokens (CR 409.2)", () => {
  const { engine, id } = assassinationBoard();
  play(engine, P1, id("qa"), { selected: { target: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].counters?.token ?? 0, 0);
});

clause(ASSASSINATION, "0:ability", "only a character in play can be picked: not an item, location, faction, face-down card, or a card outside play", () => {
  const { engine, id } = assassinationBoard();
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("qa"), { selected: { target: [cardId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction (FAQ: Quotidian Assassination cannot pick a faction)");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your own faction");
  assert.throws(() => playRaw(engine, P1, id("qa"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("qa"), { selected: { target: [id("foe"), id("foe2")] } }), "two characters");
  assert.equal(engine.state.cards[id("qa")].zone, "hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(ASSASSINATION, "0:ability", "is refused one resource short of 2, and without [O]", () => {
  const short = assassinationBoard({ obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("qa"), { selected: { target: [short.id("foe")] } }));
  const noThreshold = assassinationBoard({ obsession: 0, greed: 4 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("qa"), { selected: { target: [noThreshold.id("foe")] } }));
  const exact = assassinationBoard({ obsession: 2 });
  play(exact.engine, P1, exact.id("qa"), { selected: { target: [exact.id("foe")] } });
  assert.equal(exact.engine.state.cards[exact.id("foe")].zone, "hand");
});

// --- Quotidian Ejector -----------------------------------------------------
// This card enters play with 2 tokens on it.
// EJECT -- COST: Remove 2 tokens from this card. Pick a non-resource card. --
// EFFECT: Put the card into its owner's hand. Character, cost 3, threshold [O][O].

const EJECTOR = "2215daf8-cf15-4762-8e94-c985124712f2";

function ejectorBoard(opts: { zone?: "hand" | "play"; tokens?: number; obsession?: number; greed?: number } = {}) {
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qe", def: printing(EJECTOR), owner: P1, zone, counters: zone === "play" ? { token: opts.tokens ?? 2 } : undefined },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", damage: 1 },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(EJECTOR, "0:rule", "enters play with exactly 2 tokens on it, for its cost of 3", () => {
  const { engine, id } = ejectorBoard({ zone: "hand" });
  const before = ready(engine);
  play(engine, P1, id("qe"));
  assert.equal(engine.state.cards[id("qe")].zone, "play");
  assert.equal(tokens(engine, id("qe")), 2);
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
});

clause(EJECTOR, "0:rule", "is refused one resource short of 3, and without [O][O]", () => {
  const short = ejectorBoard({ zone: "hand", obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("qe")));
  const noThreshold = ejectorBoard({ zone: "hand", obsession: 1, greed: 4 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("qe")));
  const exact = ejectorBoard({ zone: "hand", obsession: 2, greed: 1 });
  play(exact.engine, P1, exact.id("qe"));
  assert.equal(exact.engine.state.cards[exact.id("qe")].zone, "play");
});

for (const [target, owner] of [
  ["mine", P1],
  ["myItem", P1],
  ["myLoc", P1],
  ["foe", P2],
  ["foeItem", P2],
  ["foeLoc", P2],
  ["stolen", P2]
] as const) {
  clause(EJECTOR, "1:ability:quotidian-ejector-eject", `removes 2 tokens and puts the picked ${target} into its owner's hand; nothing else moves`, () => {
    const { engine, id } = ejectorBoard({ tokens: 3 });
    activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id(target)] } });
    assert.equal(tokens(engine, id("qe")), 1, "2 of 3 tokens removed");
    assert.equal(engine.state.cards[id(target)].zone, "hand");
    assert.equal(engine.state.players[owner].hand.includes(id(target)), true, `in ${owner}'s hand`);
    for (const key of ["mine", "myItem", "myLoc", "foe", "foeItem", "foeLoc", "stolen", "qe"]) {
      if (key !== target) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} stays in play`);
    }
  });
}

clause(EJECTOR, "1:ability:quotidian-ejector-eject", "it may pick itself: the Ejector goes to its owner's hand after paying the 2 tokens, and nothing else moves", () => {
  const { engine, id } = ejectorBoard({ tokens: 2 });
  activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("qe")] } });
  assert.equal(engine.state.cards[id("qe")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("qe")), true);
  for (const key of ["mine", "myItem", "myLoc", "foe", "foeItem", "foeLoc", "stolen"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} stays in play`);
});

clause(EJECTOR, "0:rule", "an Ejector that left play and is deployed again enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const { engine, id } = ejectorBoard({ tokens: 3 });
  activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("qe")] } });
  assert.equal(engine.state.cards[id("qe")].zone, "hand");
  play(engine, P1, id("qe"));
  assert.equal(engine.state.cards[id("qe")].zone, "play");
  assert.equal(tokens(engine, id("qe")), 2, "tokens disappear when a card leaves play (CR 409.2), so it starts again from 2");
});

clause(EJECTOR, "1:ability:quotidian-ejector-eject", "a card leaving play sheds its damage", () => {
  const { engine, id } = ejectorBoard();
  activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].damage ?? 0, 0);
});

clause(EJECTOR, "1:ability:quotidian-ejector-eject", "only a non-resource card in play can be picked: not a resource, face-down card, faction, or a card in hand or a discard pile", () => {
  const { engine, id } = ejectorBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [cardId] } });
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(id("inHand")), "a card in hand");
  assert.throws(attempt(id("inDiscard")), "a card in your discard pile");
  assert.throws(() => activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: {} }), "no pick");
  assert.throws(() => activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("foe"), id("mine")] } }), "two cards");
  assert.equal(tokens(engine, id("qe")), 2, "refused activations remove no tokens");
  attempt(id("foe"))();
  assert.equal(engine.state.cards[id("foe")].zone, "hand");
});

clause(EJECTOR, "1:ability:quotidian-ejector-eject", "needs 2 tokens: refused with 1 or 0", () => {
  for (const have of [0, 1]) {
    const { engine, id } = ejectorBoard({ tokens: have });
    assert.throws(() => activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("foe")] } }), `${have} tokens`);
    assert.equal(engine.state.cards[id("foe")].zone, "play");
    assert.equal(tokens(engine, id("qe")), have);
  }
});

clause(EJECTOR, "1:ability:quotidian-ejector-eject", "only its controller can use it, and it can be used again while tokens remain", () => {
  const { engine, id } = ejectorBoard({ tokens: 4 });
  assert.throws(() => activate(engine, P2, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("mine")] } }));
  activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("foe")] } });
  activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("foeItem")] } });
  assert.equal(tokens(engine, id("qe")), 0);
  assert.equal(engine.state.cards[id("foe")].zone, "hand");
  assert.equal(engine.state.cards[id("foeItem")].zone, "hand");
});

// --- Quotidian Misfire -----------------------------------------------------
// This turn, if a card would be put into a player's hand from anywhere,
// instead put it into that player's discard pile. (This includes cards from
// your deck and cards you draw.) Tactic, cost 2, threshold [O][O].

const MISFIRE = "ea372d50-f915-41fc-b170-267e0e430132";
const REMEMBER = "2bb93344-f467-4c54-8090-df1562fff717";

const giftTactic = () =>
  tactic({ name: "Gift", cost: 0, behavior: { abilities: [{ id: "gift", type: "activated", effects: [{ type: "draw", player: "opponent", amount: 1 }] }] } });
const bounceDef = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
const studyDef = () =>
  character({
    name: "Scholar",
    behavior: { abilities: [{ id: "study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function misfireBoard(opts: { obsession?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceDef(), owner: P1, zone: "hand" },
      { key: "gift", def: giftTactic(), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "scholar", def: studyDef(), owner: P1, zone: "play" },
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" },
      { key: "remember", def: printing(REMEMBER), owner: P1, zone: "hand" },
      { key: "tacInDeck", def: tactic({ name: "TacInDeck" }), owner: P1, zone: "deck" },
      { key: "tacInDiscard", def: tactic({ name: "TacInDiscard" }), owner: P1, zone: "discard" },
      ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3", "b4"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MISFIRE, "0:rule", "pays 2 and itself ends in the discard pile, not the hand", () => {
  const { engine, id } = misfireBoard();
  const before = ready(engine);
  play(engine, P1, id("qm"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(engine.state.cards[id("qm")].zone, "discard");
});

clause(MISFIRE, "0:rule", "is refused one resource short of 2, and without [O][O]", () => {
  const short = misfireBoard({ obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("qm")));
  const noThreshold = misfireBoard({ obsession: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("qm")));
  const exact = misfireBoard({ obsession: 2 });
  play(exact.engine, P1, exact.id("qm"));
  assert.equal(exact.engine.state.cards[exact.id("qm")].zone, "discard");
});

clause(MISFIRE, "0:rule", "control: without Misfire a bounced character goes to its owner's hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("bounce"), { selected: { t: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "hand");
});

for (const [target, owner] of [
  ["mine", P1],
  ["foe", P2],
  ["stolen", P2]
] as const) {
  clause(MISFIRE, "0:rule", `this turn, a character (${target}) that would be put into a hand is put into its owner's discard pile instead`, () => {
    const { engine, id } = misfireBoard();
    play(engine, P1, id("qm"));
    const handsBefore = [engine.state.players[P1].hand.length, engine.state.players[P2].hand.length];
    play(engine, P1, id("bounce"), { selected: { t: [id(target)] } });
    assert.equal(engine.state.cards[id(target)].zone, "discard");
    assert.equal(engine.state.players[owner].discard.includes(id(target)), true, `in ${owner}'s discard pile`);
    assert.equal(engine.state.players[P1].hand.length, handsBefore[0] - 1, "only the Bounce tactic left your hand; nothing arrived");
    assert.equal(engine.state.players[P2].hand.length, handsBefore[1], "the opponent's hand did not grow");
  });
}

clause(MISFIRE, "0:rule", "a card you draw (from the Develop Rule) goes from the deck to your discard pile instead of your hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const top = engine.state.players[P1].deck[0];
  const handBefore = engine.state.players[P1].hand.length;
  const deckBefore = engine.state.players[P1].deck.length;
  developDraw(engine, P1);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[top].zone, "discard", "the drawn card is discarded");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "nothing reached the hand");
  assert.equal(engine.state.players[P1].deck.length, deckBefore - 1, "it did leave the deck");
});

clause(MISFIRE, "0:rule", "a card drawn by a card effect also goes to the discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const top = engine.state.players[P1].deck[0];
  const handBefore = engine.state.players[P1].hand.length;
  activate(engine, P1, id("scholar"), "study");
  assert.equal(engine.state.cards[top].zone, "discard");
  assert.equal(engine.state.players[P1].hand.length, handBefore);
});

clause(MISFIRE, "0:rule", "it affects every player: the opponent's draw goes to THEIR discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const oppTop = engine.state.players[P2].deck[0];
  const handBefore = engine.state.players[P2].hand.length;
  play(engine, P1, id("gift"));
  assert.equal(engine.state.cards[oppTop].zone, "discard");
  assert.equal(engine.state.players[P2].discard.includes(oppTop), true, "the opponent's own discard pile");
  assert.equal(engine.state.players[P1].discard.includes(oppTop), false);
  assert.equal(engine.state.players[P2].hand.length, handBefore);
});

clause(MISFIRE, "0:rule", "control: without Misfire the same effects draw into the hand", () => {
  const { engine, id } = misfireBoard();
  const top = engine.state.players[P1].deck[0];
  activate(engine, P1, id("scholar"), "study");
  assert.equal(engine.state.cards[top].zone, "hand");
  const oppTop = engine.state.players[P2].deck[0];
  play(engine, P1, id("gift"));
  assert.equal(engine.state.cards[oppTop].zone, "hand");
});

clause(MISFIRE, "0:rule", "a card found by searching your deck goes to the discard pile instead of your hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  activate(engine, P1, id("mr"), "qi");
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tacInDeck")] } : declineAll(pc)));
  assert.equal(engine.state.cards[id("tacInDeck")].zone, "discard", "the tutored tactic is discarded");
  assert.equal(engine.state.players[P1].hand.includes(id("tacInDeck")), false);
});

clause(MISFIRE, "0:rule", "it applies 'from anywhere': a tactic returned from the discard pile by Remember stays in the discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  play(engine, P1, id("remember"), { selected: { target: [id("tacInDiscard")] } });
  assert.equal(engine.state.cards[id("tacInDiscard")].zone, "discard");
  assert.equal(engine.state.players[P1].hand.includes(id("tacInDiscard")), false);
});

clause(MISFIRE, "0:rule", "cards already in a hand stay there, and a card played from hand into play is unaffected", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  assert.equal(engine.state.cards[id("keep")].zone, "hand");
  assert.equal(engine.state.cards[id("oppHand")].zone, "hand");
  play(engine, P1, id("keep"));
  assert.equal(engine.state.cards[id("keep")].zone, "play", "deploying is not 'put into a hand'");
});

clause(MISFIRE, "0:rule", "lasts this turn only: on the next turns draws go to the hand again", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const p2Top = engine.state.players[P2].deck[0];
  developDraw(engine, P2);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[p2Top].zone, "hand", "the opponent's draw on their turn is a normal draw");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const p1Top = engine.state.players[P1].deck[0];
  activate(engine, P1, id("scholar"), "study");
  assert.equal(engine.state.cards[p1Top].zone, "hand", "and so is yours on your next turn");
});

// --- Remember --------------------------------------------------------------
// COST: Pick a tactic in your discard pile. -- EFFECT: Put the tactic into your
// hand. Tactic, cost 3, threshold [O].

function rememberBoard(opts: { obsession?: number; greed?: number; discardTactics?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rem", def: printing(REMEMBER), owner: P1, zone: "hand" },
      ...(opts.discardTactics === false
        ? []
        : [
            { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" as const },
            { key: "tacB", def: tactic({ name: "TacB" }), owner: P1, zone: "discard" as const }
          ]),
      { key: "chrInDiscard", def: character({ name: "ChrInDiscard" }), owner: P1, zone: "discard" },
      { key: "itemInDiscard", def: item({ name: "ItemInDiscard" }), owner: P1, zone: "discard" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: P2, zone: "discard" },
      { key: "tacInHand", def: tactic({ name: "TacInHand" }), owner: P1, zone: "hand" },
      { key: "tacInDeck", def: tactic({ name: "TacInDeck" }), owner: P1, zone: "deck" },
      { key: "tacTactical", def: tactic({ name: "TacOnTable" }), owner: P1, zone: "play" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(REMEMBER, "0:ability", "pays 3 and puts the picked tactic from your discard pile into your hand (and only that one)", () => {
  const { engine, id } = rememberBoard();
  const before = ready(engine);
  play(engine, P1, id("rem"), { selected: { target: [id("tacB")] } });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.state.cards[id("tacB")].zone, "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("tacB")), true);
  assert.equal(engine.state.cards[id("tacA")].zone, "discard", "the other tactic stays in the discard pile");
  assert.equal(engine.state.cards[id("rem")].zone, "discard", "Remember itself ends in the discard pile");
});

clause(REMEMBER, "0:ability", "only a TACTIC in YOUR discard pile can be picked: not a character or item there, not the opponent's tactic, nor a tactic elsewhere", () => {
  const { engine, id } = rememberBoard();
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("rem"), { selected: { target: [cardId] } });
  assert.throws(attempt(id("chrInDiscard")), "a character in your discard pile");
  assert.throws(attempt(id("itemInDiscard")), "an item in your discard pile");
  assert.throws(attempt(id("oppTac")), "a tactic in the OPPONENT's discard pile");
  assert.throws(attempt(id("tacInHand")), "a tactic in your hand");
  assert.throws(attempt(id("tacInDeck")), "a tactic in your deck");
  assert.throws(() => playRaw(engine, P1, id("rem"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("rem"), { selected: { target: [id("tacA"), id("tacB")] } }), "two tactics");
  assert.equal(engine.state.cards[id("rem")].zone, "hand");
  attempt(id("tacA"))();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(REMEMBER, "0:ability", "cannot be played with no tactic in your discard pile", () => {
  const { engine, id } = rememberBoard({ discardTactics: false });
  assert.throws(() => playRaw(engine, P1, id("rem"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("rem"), { selected: { target: [id("oppTac")] } }));
  assert.equal(engine.state.cards[id("rem")].zone, "hand");
});

clause(REMEMBER, "0:ability", "is refused one resource short of 3, and without [O]", () => {
  const short = rememberBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rem"), { selected: { target: [short.id("tacA")] } }));
  const noThreshold = rememberBoard({ obsession: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rem"), { selected: { target: [noThreshold.id("tacA")] } }));
  const exact = rememberBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("rem"), { selected: { target: [exact.id("tacA")] } });
  assert.equal(exact.engine.state.cards[exact.id("tacA")].zone, "hand");
});

// --- Ritual of the Screaming Cheese ----------------------------------------
// Your opponent must pick one of the following:
// OPTION 1: They discard 2 cards.   OPTION 2: They discard a card at random.
// Tactic, cost 1, threshold [O].

const CHEESE = "0f2fc8b5-c078-4ccb-b7c1-8c34b62413e4";

function cheeseBoard(opts: { oppHand?: number; obsession?: number; greed?: number; random?: () => number } = {}) {
  return buildGame({
    random: opts.random,
    playerA: { faction: developFaction() },
    cards: [
      { key: "rsc", def: printing(CHEESE), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      { key: "myHand2", def: character({ name: "MyHand2" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 4 }, (_, i) => ({ key: `oh${i + 1}`, def: character({ name: `OH${i + 1}` }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const optionPick = (engine: SpoilsEngine, index: number) =>
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index } } as never);

clause(CHEESE, "0:rule", "your OPPONENT picks which option (you do not), between exactly two; the cost of 1 is paid", () => {
  const { engine, id } = cheeseBoard();
  const before = ready(engine);
  play(engine, P1, id("rsc"));
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; optionCount: number };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  assert.equal(pc.optionCount, 2);
  assert.throws(() => optionPick(engine, 2), "there is no third option");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } } as never), "the caster cannot choose for them");
});

clause(CHEESE, "0:rule", "is refused one resource short of 1... i.e. with none, and without [O]", () => {
  const none = cheeseBoard({ obsession: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("rsc")));
  const noThreshold = cheeseBoard({ obsession: 0, greed: 4 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rsc")));
  const exact = cheeseBoard({ obsession: 1 });
  play(exact.engine, P1, exact.id("rsc"));
  assert.equal(exact.engine.state.pendingChoice?.kind, "chooserSelectsOption");
});

clause(CHEESE, "1:option:OPTION 1", "they discard 2 cards: the opponent chooses which two of their hand, and nothing else is discarded", () => {
  const { engine, id } = cheeseBoard();
  play(engine, P1, id("rsc"));
  optionPick(engine, 0);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent picks their own discards");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oh2"), id("oh4")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("oh2")].zone, "discard");
  assert.equal(engine.state.cards[id("oh4")].zone, "discard");
  assert.equal(engine.state.cards[id("oh1")].zone, "hand");
  assert.equal(engine.state.cards[id("oh3")].zone, "hand");
  assert.equal(engine.state.players[P2].discard.length, 2, "exactly two cards");
  assert.equal(engine.state.cards[id("myHand")].zone, "hand", "your hand is untouched");
  assert.equal(engine.state.cards[id("rsc")].zone, "discard");
});

clause(CHEESE, "1:option:OPTION 1", "exactly two cards must be discarded, from their own hand: one, three, none, or one of YOUR cards is refused", () => {
  const { engine, id } = cheeseBoard();
  play(engine, P1, id("rsc"));
  optionPick(engine, 0);
  const attempt = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(attempt(["oh1"]), "only one");
  assert.throws(attempt(["oh1", "oh2", "oh3"]), "three");
  assert.throws(attempt([]), "none");
  assert.throws(attempt(["oh1", "myHand"]), "one of the caster's cards");
  assert.throws(attempt(["oh1", "oh1"]), "the same card twice");
  attempt(["oh1", "oh2"])();
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(CHEESE, "1:option:OPTION 1", "with only 1 card in hand they discard that one; with none, nothing happens", () => {
  const one = cheeseBoard({ oppHand: 1 });
  play(one.engine, P1, one.id("rsc"));
  optionPick(one.engine, 0);
  drain(one.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [one.id("oh1")] } : declineAll(pc)));
  assert.equal(one.engine.state.cards[one.id("oh1")].zone, "discard");

  const none = cheeseBoard({ oppHand: 0 });
  play(none.engine, P1, none.id("rsc"));
  optionPick(none.engine, 0);
  drain(none.engine, declineAll);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(none.engine.state.players[P2].discard.length, 0);
  assert.equal(none.engine.state.cards[none.id("myHand")].zone, "hand");
});

clause(CHEESE, "2:option:OPTION 2", "they discard a card at random: exactly one card, with no choice for the opponent, and the card depends on the random roll", () => {
  const discardedWith = (roll: number) => {
    const { engine, id } = cheeseBoard({ random: () => roll });
    play(engine, P1, id("rsc"));
    optionPick(engine, 1);
    assert.equal(engine.state.pendingChoice, undefined, "no card is chosen by the opponent");
    const gone = ["oh1", "oh2", "oh3", "oh4"].filter((key) => engine.state.cards[id(key)].zone === "discard");
    assert.equal(gone.length, 1, "exactly one card is discarded");
    assert.equal(engine.state.players[P2].discard.length, 1);
    assert.equal(engine.state.cards[id("myHand")].zone, "hand", "your hand is untouched");
    assert.equal(engine.state.cards[id("rsc")].zone, "discard");
    return gone[0];
  };
  const low = discardedWith(0);
  const high = discardedWith(0.999);
  assert.notEqual(low, high, "different rolls pick different cards, so the pick really is random");
  assert.equal(discardedWith(0), low, "the same roll picks the same card");
});

clause(CHEESE, "2:option:OPTION 2", "with only 1 card in hand it is the one discarded; with none, nothing happens", () => {
  const one = cheeseBoard({ oppHand: 1, random: () => 0.5 });
  play(one.engine, P1, one.id("rsc"));
  optionPick(one.engine, 1);
  assert.equal(one.engine.state.cards[one.id("oh1")].zone, "discard");

  const none = cheeseBoard({ oppHand: 0 });
  play(none.engine, P1, none.id("rsc"));
  optionPick(none.engine, 1);
  drain(none.engine, declineAll);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(none.engine.state.players[P2].discard.length, 0);
});

// --- Ritual of the Shattering Teeth ----------------------------------------
// COST: Pick a value for X. Pay twice X. -- EFFECT: Look at your opponent's
// hand and pick up to X cards. Your opponent must discard those cards.
// Tactic, cost 0, threshold [O][O][O].

const TEETH = "a9d3f161-920e-4d8c-aa3d-9b1174f2fb6a";

function teethBoard(opts: { oppHand?: number; obsession?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rst", def: printing(TEETH), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 5 }, (_, i) => ({ key: `oh${i + 1}`, def: character({ name: `OH${i + 1}` }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Teeth for X; if the engine asks for picks, answers with `picks` (opponent-hand keys). */
function teethPlay(engine: SpoilsEngine, id: (k: string) => string, x: number, picks: string[]) {
  play(engine, P1, id("rst"), { variables: { x } });
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you look at the hand and pick");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: picks.map(id) } } as never);
    resolvePendingResponses(engine);
  }
}

for (const x of [0, 1, 2, 3]) {
  clause(TEETH, "0:ability", `X=${x}: pays twice X (${2 * x}) and the opponent discards exactly the ${x} card(s) you pick`, () => {
    const { engine, id } = teethBoard();
    const before = ready(engine);
    const picks = ["oh1", "oh3", "oh5"].slice(0, x);
    teethPlay(engine, id, x, picks);
    assert.equal(before - ready(engine), 2 * x, "pays twice X (the printed cost is 0)");
    for (const key of ["oh1", "oh2", "oh3", "oh4", "oh5"]) {
      assert.equal(engine.state.cards[id(key)].zone, picks.includes(key) ? "discard" : "hand", `${key}`);
    }
    assert.equal(engine.state.players[P2].discard.length, x);
    assert.equal(engine.state.cards[id("myHand")].zone, "hand", "your hand is untouched");
    assert.equal(engine.state.cards[id("rst")].zone, "discard");
  });
}

clause(TEETH, "0:ability", "'up to X': you may pick fewer than X cards, or none, and only those are discarded", () => {
  for (const picks of [["oh2"], [], ["oh4", "oh5"]]) {
    const { engine, id } = teethBoard();
    const before = ready(engine);
    teethPlay(engine, id, 3, picks);
    assert.equal(before - ready(engine), 6, "X=3 is paid in full whatever you pick");
    assert.equal(engine.state.players[P2].discard.length, picks.length, `picked ${picks.length}`);
    for (const key of picks) assert.equal(engine.state.cards[id(key)].zone, "discard");
  }
});

clause(TEETH, "0:ability", "you cannot pick more than X cards, nor cards that are not in the opponent's hand", () => {
  const { engine, id } = teethBoard();
  play(engine, P1, id("rst"), { variables: { x: 2 } });
  const attempt = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(attempt(["oh1", "oh2", "oh3"]), "three cards for X=2");
  assert.throws(attempt(["myHand"]), "a card from your own hand");
  assert.throws(attempt(["oh1", "oh1"]), "the same card twice");
  attempt(["oh1", "oh2"])();
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(TEETH, "0:ability", "with fewer cards in their hand than X, they discard what you pick from what they have", () => {
  const { engine, id } = teethBoard({ oppHand: 1 });
  teethPlay(engine, id, 3, ["oh1"]);
  assert.equal(engine.state.cards[id("oh1")].zone, "discard");
});

clause(TEETH, "0:ability", "an opponent with no hand: the cost is still paid and nothing is discarded", () => {
  const { engine, id } = teethBoard({ oppHand: 0 });
  const before = ready(engine);
  play(engine, P1, id("rst"), { variables: { x: 2 } });
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 4);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(TEETH, "0:ability", "cannot pay twice X without the resources: X=2 needs 4 (3 refused, 4 allowed), X=0 needs none", () => {
  const three = teethBoard({ obsession: 3 });
  assert.throws(() => playRaw(three.engine, P1, three.id("rst"), { variables: { x: 2 } }), "3 resources cannot pay for X=2");
  assert.equal(three.engine.state.cards[three.id("rst")].zone, "hand");
  playRaw(three.engine, P1, three.id("rst"), { variables: { x: 1 } });
  assert.ok(three.engine.state.responseWindow, "...but X=1 (2 resources) can");

  const four = teethBoard({ obsession: 4 });
  teethPlay(four.engine, four.id, 2, ["oh1", "oh2"]);
  assert.equal(four.engine.state.players[P2].discard.length, 2, "exactly 4 resources pays for X=2");
  assert.equal(ready(four.engine), 0);

  const zero = teethBoard({ obsession: 3 });
  teethPlay(zero.engine, zero.id, 0, []);
  assert.equal(zero.engine.state.cards[zero.id("rst")].zone, "discard", "X=0 is free (but still needs [O][O][O])");
});

clause(TEETH, "0:ability", "needs [O][O][O] even when the cost is 0: two [O] (or other resources) are not enough", () => {
  const two = teethBoard({ obsession: 2, greed: 6 });
  assert.throws(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 0 } }));
  assert.throws(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 1 } }));
  const three = teethBoard({ obsession: 3, greed: 0 });
  playRaw(three.engine, P1, three.id("rst"), { variables: { x: 0 } });
  assert.ok(three.engine.state.responseWindow || three.engine.state.pendingChoice || three.engine.state.cards[three.id("rst")].zone === "discard", "three.engine.state.responseWindow || three.engine.state.pendingChoice || three.engine.state.cards[three.id(\"rst\")].zone === \"discard\"");
});

clause(TEETH, "0:ability", "X cannot be negative", () => {
  const { engine, id } = teethBoard();
  assert.throws(() => playRaw(engine, P1, id("rst"), { variables: { x: -1 } }));
  assert.equal(engine.state.cards[id("rst")].zone, "hand");
});

// --- Additional coverage (sentences that need a second look) -----------------

clause(BRUNCH, "0:ability", "the picked character may be an opponent's character that is already depleted", () => {
  const { engine, id } = brunchBoard(1);
  engine.state.cards[id("foe")].depleted = true;
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "discard");
});

clause(BRUNCH, "0:ability", "the character is destroyed (into its owner's discard pile), and a stolen one goes to its owner's pile", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", strength: 1 }), owner: P2, zone: "play", controller: P1 },
      ...bank("obsession", 5, P1)
    ]
  });
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("stolen")] } });
  assert.equal(engine.state.cards[id("stolen")].zone, "discard");
  assert.equal(engine.state.players[P2].discard.includes(id("stolen")), true, "its owner's discard pile");
});

clause(AIR_TRAVEL, "0:ability", "a character that is already depleted can be picked and gains COVERT", () => {
  const { engine, id } = airTravelBoard();
  engine.state.cards[id("mine")].depleted = true;
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
});

clause(AIR_TRAVEL, "0:ability", "a face-down card (only a resource) cannot be picked", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("faceDown")] } }));
  assert.equal(engine.state.cards[id("at")].zone, "hand");
});

clause(AIR_TRAVEL, "0:ability", "with an empty deck the character still gains COVERT and the tactic resolves", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
  assert.equal(engine.state.cards[id("at")].zone, "discard");
});

clause(DEPARTMENT, "0:rule", "stops applying once the Department leaves play", () => {
  const smash = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "raze", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "raze", def: smash, owner: P1, zone: "hand" },
      { key: "dept", def: printing(DEPARTMENT), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "a1", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.throws(() => attackWith(engine, [id("a1")]), "refused while the Department stands");
  play(engine, P1, id("raze"), { selected: { t: [id("dept")] } });
  assert.equal(engine.state.cards[id("dept")].zone, "discard");
  attackWith(engine, [id("a1")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("a1")], "an odd party is legal again");
});

clause(DEPARTMENT, "0:rule", "the parity of one side does not depend on the other: 2 attackers may face 4 blockers, and 4 attackers 2 blockers", () => {
  for (const [attackers, blockers] of [
    [2, 4],
    [4, 2]
  ] as const) {
    const { engine, id } = departmentBoard();
    attackWith(engine, ["a1", "a2", "a3", "a4"].slice(0, attackers).map(id));
    resolvePendingResponses(engine);
    const party = ["b1", "b2", "b3", "b4"].slice(0, blockers).map(id);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: party });
    assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [...party].sort());
  }
});

clause(EXPERIMENT, "0:ability", "only characters can be depleted for X: an item, a face-down card or a faction is refused", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "m0", def: character({ name: "M0" }), owner: P1, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", 8, P1)
    ]
  });
  const found = ["d0", "d1", "d2", "d3", "d4"].map(id);
  const attempt = (depleted: string[]) => () => playRaw(engine, P1, id("ae"), { selected: { depleted, found } });
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P1].factionId!]), "your faction");
  attempt([id("m0")])();
  assert.equal(engine.state.cards[id("m0")].depleted, true);
});

clause(STAVE, "0:rule", "a Stave that left play and is deployed again enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const bouncer = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bounce", def: bouncer, owner: P1, zone: "hand" },
      { key: "ks", def: printing(STAVE), owner: P1, zone: "play", counters: { token: 3 } },
      ...bank("obsession", 2, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("ks")] } });
  assert.equal(engine.state.cards[id("ks")].zone, "hand");
  play(engine, P1, id("ks"));
  assert.equal(engine.state.cards[id("ks")].zone, "play");
  assert.equal(tokens(engine, id("ks")), 2, "tokens disappear when a card leaves play (CR 409.2)");
});

clause(NAPIFORM, "1:rule", "a Napiform that left play and is deployed again enters with exactly 1 token, not its old tokens plus 1", () => {
  const bouncer = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bounce", def: bouncer, owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 6, life: 6, speed: 6 }), owner: P1, zone: "play" },
      { key: "np", def: printing(NAPIFORM), owner: P1, zone: "play", attachedToKey: "host", counters: { token: 3 } },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("np")] } });
  assert.equal(engine.state.cards[id("np")].zone, "hand");
  play(engine, P1, id("np"), { selected: { attachTo: [id("host")] } });
  assert.equal(engine.state.cards[id("np")].zone, "play");
  assert.equal(tokens(engine, id("np")), 1, "tokens disappear when a card leaves play (CR 409.2)");
  assert.deepEqual(stats(engine, id("host")), [5, 5, 5]);
});

clause(CREEPER, "0:rule", "follows the hand size as it changes: playing a card from an even hand turns the bonus off, drawing turns it back on", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CREEPER), owner: P1, zone: "play" },
      { key: "h1", def: character({ name: "H1", cost: 0 }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2", cost: 0 }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
    ]
  });
  const printed = printing(CREEPER);
  const total = () => [engine.getStat(id("cc"), "strength"), engine.getStat(id("cc"), "life"), engine.getStat(id("cc"), "speed")];
  assert.deepEqual(total(), [printed.strength! + 1, printed.life! + 1, printed.speed! + 1], "2 cards: bonus on");
  play(engine, P1, id("h1"));
  assert.deepEqual(total(), [printed.strength, printed.life, printed.speed], "1 card: bonus off");
  developDraw(engine, P1);
  assert.deepEqual(total(), [printed.strength! + 1, printed.life! + 1, printed.speed! + 1], "2 cards again: bonus back on");
});

clause(CREEPER, "0:rule", "larger even hands (4) give the bonus and larger odd hands (3, 5) do not; the bonus is 1, not scaled by hand size", () => {
  const printed = printing(CREEPER);
  for (const [size, bonus] of [
    [3, 0],
    [4, 1],
    [5, 0]
  ] as const) {
    const { engine, id } = buildGame({
      cards: [
        { key: "cc", def: printing(CREEPER), owner: P1, zone: "play" },
        ...Array.from({ length: size }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const }))
      ]
    });
    assert.equal(engine.getStat(id("cc"), "strength"), printed.strength! + bonus, `hand ${size}`);
    assert.equal(engine.getStat(id("cc"), "life"), printed.life! + bonus, `hand ${size}`);
    assert.equal(engine.getStat(id("cc"), "speed"), printed.speed! + bonus, `hand ${size}`);
  }
});

clause(CREEPER, "0:rule", "only this card gains the bonus: other characters of yours and the opponent's are unchanged", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "cc", def: printing(CREEPER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getStat(id("cc"), "strength"), printing(CREEPER).strength! + 1, "the Creeper itself gets the bonus");
  for (const key of ["ally", "foe"]) {
    assert.deepEqual([engine.getStat(id(key), "strength"), engine.getStat(id(key), "life"), engine.getStat(id(key), "speed")], [2, 2, 2], key);
  }
});

clause(CREEPER, "0:rule", "counts the hand of the Creeper's CONTROLLER: an opponent-controlled Creeper looks at its controller's hand", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "cc", def: printing(CREEPER), owner: P1, zone: "play", controller: P2 },
      { key: "ownerHand1", def: character({ name: "OH1" }), owner: P1, zone: "hand" },
      { key: "controllerHand1", def: character({ name: "CH1" }), owner: P2, zone: "hand" },
      { key: "controllerHand2", def: character({ name: "CH2" }), owner: P2, zone: "hand" }
    ]
  });
  // owner P1 has 1 card (odd), controller P2 has 2 (even): the bonus follows P2
  assert.equal(engine.getStat(id("cc"), "strength"), printing(CREEPER).strength! + 1);
});

clause(CREEPER, "0:rule", "a Creeper that is not in play (in hand) has no bonus effect on the board", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "cc", def: printing(CREEPER), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" }
    ]
  });
  // 2 cards in hand (the Creeper itself and H1): even, but the Creeper is not in play
  assert.equal(engine.getStat(id("cc"), "strength"), printing(CREEPER).strength, "no bonus outside play");
});

// --- Timing: tactics and abilities may be used in response (RULES.md 3.4, 7, 10) ---

function respondBoard(printingId: string) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "card", def: printing(printingId), owner: P1, zone: printingId === NULLIFIER ? "play" : "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
}

clause(ASSASSINATION, "0:ability", "can be played in response to the opponent's attack, taking the attacker out of play and ending the attack", () => {
  const { engine, id } = respondBoard(ASSASSINATION);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("attacker")], target: { type: "faction", playerId: P1 } });
  assert.ok(engine.state.responseWindow, "the attack opens a response window");
  engine.perform({ type: "passPriority", playerId: P2 }); // the attacker acts first and passes; then the defender may respond
  const influence = engine.state.players[P1].influence;
  playRaw(engine, P1, id("card"), { selected: { target: [id("attacker")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("attacker")].zone, "hand", "the attacker was returned to its owner's hand");
  assert.deepEqual(engine.state.battle?.attackingParty ?? [], [], "no attacker is left in the battle");
  assert.equal(engine.state.battle?.phase ?? "finished", "finished", "so the battle is over");
  // E10e: an emptied attacking party ends the battle outright; nothing is left to advance.
  assert.equal(engine.state.battle, undefined);
  assert.equal(engine.state.players[P1].influence, influence, "no damage was done");
});

clause(ASSASSINATION, "0:ability", "cannot be played on the opponent's turn when there is nothing to respond to", () => {
  const { engine, id } = respondBoard(ASSASSINATION);
  assert.throws(() => playRaw(engine, P1, id("card"), { selected: { target: [id("attacker")] } }));
  assert.equal(engine.state.cards[id("attacker")].zone, "play");
});

clause(AIR_TRAVEL, "0:ability", "can be played in response on the opponent's turn", () => {
  const { engine, id } = respondBoard(AIR_TRAVEL);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("attacker")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("card"), { selected: { target: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
});

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "can be used in response to an opponent's tactic, rescuing the targeted character before the tactic resolves", () => {
  const killer = tactic({
    name: "Killer",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mn", def: printing(NULLIFIER), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "killer", def: killer, owner: P2, zone: "hand" }
    ]
  });
  playRaw(engine, P2, id("killer"), { selected: { t: [id("mine")] } });
  assert.ok(engine.state.responseWindow, "P1 may respond");
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mn"), abilityId: "mephitic-nullifier-flash-bang", selected: { target: [id("mine")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("mine")].zone, "hand", "rescued to hand, not destroyed");
  assert.equal(engine.state.cards[id("mn")].zone, "discard");
  assert.equal(engine.state.cards[id("killer")].zone, "discard", "the Killer tactic then finds no target and is spent");
});

// --- Nearby Serpent: 'up to' ----------------------------------------------------

clause(SERPENT, "1:rule", "'look at UP TO the top 5': you may look at fewer than 5 cards and put just those back in any order", () => {
  const { engine, id } = serpentBoard();
  const before = engine.state.players[P1].deck.slice();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P1);
  const pc = engine.state.pendingChoice as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  // Looking at only the top 3: the other cards of the deck are never shown and keep their places.
  const topThree = before.slice(0, 3);
  const order = [topThree[2], topThree[0], topThree[1]];
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(engine.state.players[P1].deck, [...order, ...before.slice(3)], "only the top 3 were reordered");
});

clause(DISTILLATION, "0:ability", "'Name a card' is a COST: the card is named when the tactic is played, before the opponent can respond", () => {
  const { engine, id } = distillationBoard();
  playRaw(engine, P1, id("ed"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "nameValue", "the caster is asked to name a card as part of paying costs");
  assert.equal(pc?.playerId, P1);
  assert.equal(engine.state.responseWindow, undefined, "the opponent's response window has not opened yet (costs are paid before the opponent may respond)");
});

// --- Printed cost, threshold, type, subtype and stats (T3c3 mutation pass) ----------------------
// One cost/threshold test and one type/stats test per card, attached to the card's first clause. The numbers
// are the printed ones, written out here (not read from the card data).

const aChar = (key: string, owner: typeof P1 | typeof P2 = P1) => ({ key, def: character({ name: key }), owner, zone: "play" as const });

clause(BRUNCH, "0:ability", "printed cost 2 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({
    id: BRUNCH,
    cost: 2,
    threshold: "oo",
    extra: [aChar("mine"), aChar("foe", P2)],
    selected: (id) => ({ depleted: [id("mine")], picked: [id("foe")] }),
    variables: { x: 1 }
  })
);

clause(AIR_TRAVEL, "0:ability", "printed cost 2 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({ id: AIR_TRAVEL, cost: 2, threshold: "o", extra: [aChar("mine")], selected: (id) => ({ target: [id("mine")] }) })
);

clause(DEPARTMENT, "0:rule", "printed cost 3 and threshold [O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: DEPARTMENT, cost: 3, threshold: "ooo" })
);
clause(DEPARTMENT, "0:rule", "is a location with structure 5 and no subtype", () =>
  printedStats({ id: DEPARTMENT, type: "location", subtype: [], structure: 5 })
);

clause(EXPERIMENT, "0:ability", "printed cost 7 and threshold [O][O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({
    id: EXPERIMENT,
    cost: 7,
    threshold: "oooo",
    extra: Array.from({ length: 6 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
    selected: (id) => ({ found: [0, 1, 2, 3, 4].map((i) => id(`dk${i}`)) })
  })
);

clause(ALMANAC, "0:ability:almanac-foresight", "printed cost 4 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short; an item with no subtype", () => {
  printedCost({ id: ALMANAC, cost: 4, threshold: "oo" });
  printedStats({ id: ALMANAC, type: "item", subtype: [] });
});

clause(ASHES, "0:unique", "printed cost 7 and threshold [O][O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short; an item with no subtype", () => {
  printedCost({ id: ASHES, cost: 7, threshold: "oooo" });
  printedStats({ id: ASHES, type: "item", subtype: [] });
});

clause(CREEPER, "0:rule", "printed cost 3 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({ id: CREEPER, cost: 3, threshold: "o" })
);
clause(CREEPER, "0:rule", "is a lurker with 2 strength, 2 speed and 1 life while its controller holds an odd number of cards", () =>
  printedStats({ id: CREEPER, type: "character", subtype: ["lurker"], strength: 2, speed: 2, life: 1, extra: [{ key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" }] })
);

clause(MOLESTATION, "0:rule", "printed cost 10 and threshold [O][O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: MOLESTATION, cost: 10, threshold: "oooo" })
);

clause(DISTILLATION, "0:ability", "printed cost 4 and threshold [O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: DISTILLATION, cost: 4, threshold: "ooo", name: "Target" })
);

clause(FORGET, "0:ability", "printed cost 5 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: FORGET, cost: 5, threshold: "oo", extra: [aChar("mine")], selected: (id) => ({ bounced: [id("mine")] }) })
);

clause(INSIDIOUS, "0:kw:COVERT", "printed cost 4 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: INSIDIOUS, cost: 4, threshold: "oo" })
);
clause(INSIDIOUS, "0:kw:COVERT", "is an ecto-manipulator with 2 strength, 3 speed and 2 life", () =>
  printedStats({ id: INSIDIOUS, type: "character", subtype: ["ecto-manipulator"], strength: 2, speed: 3, life: 2 })
);

clause(STAVE, "0:rule", "printed cost 0 and threshold [O][O]: deploys for no resources with two [O] already spent, refused with only one [O]; an item with no subtype", () => {
  printedCost({ id: STAVE, cost: 0, threshold: "oo" });
  printedStats({ id: STAVE, type: "item", subtype: [] });
});

clause(OCTOPOD, "0:kw:COVERT", "printed cost 4 and threshold [O][O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: OCTOPOD, cost: 4, threshold: "oooo" })
);
clause(OCTOPOD, "0:kw:COVERT", "is a lurker with 1 strength, 1 speed and 1 life", () =>
  printedStats({ id: OCTOPOD, type: "character", subtype: ["lurker"], strength: 1, speed: 1, life: 1 })
);

clause(FINGER_TRAP, "0:attach", "printed cost 3 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]; a gear item", () => {
  printedCost({ id: FINGER_TRAP, cost: 3, threshold: "o", extra: [aChar("host")], selected: (id) => ({ attachTo: [id("host")] }) });
  printedStats({ id: FINGER_TRAP, type: "item", subtype: ["gear"] });
});

clause(RITUALIST, "0:ability:qi", "printed cost 9 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: RITUALIST, cost: 9, threshold: "oo" })
);
clause(RITUALIST, "0:ability:qi", "is a ritualist with 1 strength, 3 speed and 1 life", () =>
  printedStats({ id: RITUALIST, type: "character", subtype: ["ritualist"], strength: 1, speed: 3, life: 1 })
);

clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "printed cost 4 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({ id: NULLIFIER, cost: 4, threshold: "o" })
);
clause(NULLIFIER, "0:ability:mephitic-nullifier-flash-bang", "is a ritualist with 2 strength, 3 speed and 2 life", () =>
  printedStats({ id: NULLIFIER, type: "character", subtype: ["ritualist"], strength: 2, speed: 3, life: 2 })
);

clause(NAPIFORM, "0:attach", "printed cost 2 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]; a gear item", () => {
  printedCost({ id: NAPIFORM, cost: 2, threshold: "o", extra: [aChar("host")], selected: (id) => ({ attachTo: [id("host")] }) });
  printedStats({ id: NAPIFORM, type: "item", subtype: ["gear"] });
});

clause(SERPENT, "0:kw:COVERT", "printed cost 3 and threshold [O][O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: SERPENT, cost: 3, threshold: "ooo" })
);
clause(SERPENT, "0:kw:COVERT", "is a lurker with 2 strength, 1 speed and 1 life", () =>
  printedStats({ id: SERPENT, type: "character", subtype: ["lurker"], strength: 2, speed: 1, life: 1 })
);

clause(OOZLING, "0:kw:COVERT", "printed cost 8 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: OOZLING, cost: 8, threshold: "oo" })
);
clause(OOZLING, "0:kw:COVERT", "is a lurker with 5 strength, 3 speed and 4 life", () =>
  printedStats({ id: OOZLING, type: "character", subtype: ["lurker"], strength: 5, speed: 3, life: 4 })
);

clause(ASSASSINATION, "0:ability", "printed cost 2 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({ id: ASSASSINATION, cost: 2, threshold: "o", extra: [aChar("mine")], selected: (id) => ({ target: [id("mine")] }) })
);

clause(EJECTOR, "0:rule", "printed cost 3 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: EJECTOR, cost: 3, threshold: "oo" })
);
clause(EJECTOR, "0:rule", "is a ritualist with 1 strength, 3 speed and 1 life", () =>
  printedStats({ id: EJECTOR, type: "character", subtype: ["ritualist"], strength: 1, speed: 3, life: 1 })
);

clause(MISFIRE, "0:rule", "printed cost 2 and threshold [O][O]: deploys with exactly that, refused one resource short, refused one [O] short", () =>
  printedCost({ id: MISFIRE, cost: 2, threshold: "oo" })
);

clause(REMEMBER, "0:ability", "printed cost 3 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({
    id: REMEMBER,
    cost: 3,
    threshold: "o",
    extra: [{ key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "discard" }],
    selected: (id) => ({ target: [id("tac")] })
  })
);

clause(CHEESE, "0:rule", "printed cost 1 and threshold [O]: deploys with exactly that, refused one resource short, refused without [O]", () =>
  printedCost({ id: CHEESE, cost: 1, threshold: "o" })
);

clause(TEETH, "0:ability", "printed cost 0 and threshold [O][O][O]: deploys for no resources with three [O] already spent, refused with only two [O]", () =>
  printedCost({ id: TEETH, cost: 0, threshold: "ooo", variables: { x: 0 } })
);

// --- Mutation-pass additions (T3c3): shuffles after searches, other cards entering play, mandatory discards, keywords ---

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const deckOf = (engine: SpoilsEngine, player: typeof P1 | typeof P2) => [...engine.state.players[player].deck];

clause(EXPERIMENT, "0:ability", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const { engine, id } = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "M0" }), owner: P1, zone: "play" },
      ...Array.from({ length: 10 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", 8, P1)
    ]
  });
  const found = ["d2", "d3", "d4", "d5", "d6"].map(id);
  const remaining = deckOf(engine, P1).filter((c) => !found.includes(c));
  playAe(engine, P1, id("ae"), { selected: { depleted: [id("m0")], found } });
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [found[0]] } : declineAll(pc)));
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...remaining].sort(), "the five searched cards left the deck, the rest stayed");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(remaining, 0), "and the remaining deck was shuffled");
});

function shuffleDistillationBoard() {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" },
      { key: "o1", def: character({ name: "Other1" }), owner: P1, zone: "deck" },
      { key: "t1", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "deck" },
      { key: "o2", def: character({ name: "Other2" }), owner: P1, zone: "deck" },
      { key: "t2", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "deck" },
      { key: "o3", def: character({ name: "Other3" }), owner: P1, zone: "deck" },
      { key: "o4", def: character({ name: "Other4" }), owner: P1, zone: "deck" },
      ...bank("obsession", 8, P1)
    ]
  });
}

clause(DISTILLATION, "0:ability", "the searched deck is shuffled afterwards (CR 312.1), whether copies were found or not", () => {
  const found = shuffleDistillationBoard();
  const remaining = deckOf(found.engine, P1).filter((c) => c !== found.id("t1") && c !== found.id("t2"));
  play(found.engine, P1, found.id("ed"));
  distill(found.engine, found.id, "Target", ["t1"]);
  assert.deepEqual(deckOf(found.engine, P1), shuffledWithConstant(remaining, 0), "copies taken out, the rest shuffled");

  const none = shuffleDistillationBoard();
  const before = deckOf(none.engine, P1);
  play(none.engine, P1, none.id("ed"));
  distill(none.engine, none.id, "Nonexistent Card", []);
  assert.deepEqual(deckOf(none.engine, P1), shuffledWithConstant(before, 0), "naming a card with no copies still shuffles the searched deck");
});

function shuffleRitualistBoard(withTactics: boolean) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" },
      ...(withTactics ? [{ key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" as const }] : []),
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "deck" },
      ...(withTactics ? [{ key: "tac2", def: tactic({ name: "Tac2" }), owner: P1, zone: "deck" as const }] : []),
      { key: "c3", def: character({ name: "C3" }), owner: P1, zone: "deck" },
      { key: "c4", def: character({ name: "C4" }), owner: P1, zone: "deck" }
    ]
  });
}

clause(RITUALIST, "0:ability:qi", "the searched deck is shuffled afterwards when a tactic is found (CR 312.1)", () => {
  const { engine, id } = shuffleRitualistBoard(true);
  const remaining = deckOf(engine, P1).filter((c) => c !== id("tac1"));
  activate(engine, P1, id("mr"), "qi");
  searchPick(engine, [id("tac1")]);
  assert.equal(engine.state.cards[id("tac1")].zone, "hand");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(remaining, 0), "the deck was shuffled after the tactic left it");
});

clause(RITUALIST, "0:ability:qi", "the deck is shuffled even when the search finds nothing (declined, or no tactic in the deck)", () => {
  const declined = shuffleRitualistBoard(true);
  const before = deckOf(declined.engine, P1);
  activate(declined.engine, P1, declined.id("mr"), "qi");
  searchPick(declined.engine, []);
  assert.deepEqual(deckOf(declined.engine, P1), shuffledWithConstant(before, 0), "a search that finds nothing still shuffles the deck");

  const empty = shuffleRitualistBoard(false);
  const beforeEmpty = deckOf(empty.engine, P1);
  activate(empty.engine, P1, empty.id("mr"), "qi");
  drain(empty.engine, declineAll);
  assert.deepEqual(deckOf(empty.engine, P1), shuffledWithConstant(beforeEmpty, 0), "searching a deck with no tactic still shuffles it");
});

clause(ALMANAC, "0:ability:almanac-foresight", "with fewer than 5 cards in the deck it shows all of them", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "aa", def: printing(ALMANAC), owner: P1, zone: "play" },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P2, zone: "deck" as const }))
    ]
  });
  const deckBefore = [...engine.state.players[P2].deck];
  activate(engine, P1, id("aa"), "almanac-foresight", { selected: { deckOwner: [engine.state.players[P2].factionId!] } });
  const pc = engine.state.pendingChoice as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, deckBefore, "all 3 cards of a 3-card deck");
});

clause(STAVE, "0:rule", "only the Stave's own entry gives it tokens: another card entering play later adds none", () => {
  const { engine, id } = staveBoard({ obsession: 3 });
  assert.equal(tokens(engine, id("ks")), 2);
  play(engine, P1, id("myHand"));
  assert.equal(engine.state.cards[id("myHand")].zone, "play", "another card entered play");
  assert.equal(tokens(engine, id("ks")), 2, "the Stave gained no tokens from it");
});

clause(NAPIFORM, "1:rule", "only the item's own entry gives it a token: another card entering play later adds none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "np", def: printing(NAPIFORM), owner: P1, zone: "play", attachedToKey: "host", counters: { token: 1 } },
      { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("newcomer"));
  assert.equal(engine.state.cards[id("newcomer")].zone, "play", "another card entered play");
  assert.equal(engine.state.cards[id("np")].counters?.token ?? 0, 1, "the item gained no token from it");
});

clause(EJECTOR, "0:rule", "only the Ejector's own entry gives it tokens: another card entering play later adds none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qe", def: printing(EJECTOR), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("newcomer"));
  assert.equal(engine.state.cards[id("newcomer")].zone, "play", "another card entered play");
  assert.equal(engine.state.cards[id("qe")].counters?.token ?? 0, 2, "the Ejector gained no tokens from it");
});

clause(OCTOPOD, "1:rule", "the discard is mandatory and exactly 2: choosing one card, or none, is refused", () => {
  const { engine, id } = octopodBoard();
  fight(engine, P1, [id("oct")], { type: "faction", playerId: P2 }, []);
  const pick = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(pick([]), "choosing no cards is refused");
  assert.throws(pick(["dh1"]), "choosing one card is refused");
  assert.throws(pick(["dh1", "dh2", "dh3"]), "choosing three cards is refused");
  assert.equal(engine.state.cards[id("dh1")].zone, "hand", "nothing was discarded by the refused picks");
  pick(["dh1", "dh2"])();
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("dh1")].zone, "discard");
  assert.equal(engine.state.cards[id("dh2")].zone, "discard");
  assert.equal(engine.state.cards[id("dh3")].zone, "hand");
});

clause(OOZLING, "0:kw:COVERT", "has COVERT and no other keyword (it does not attack the turn it enters play)", () => {
  const { engine, id } = buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "oz", def: printing(OOZLING), owner: P1, zone: "play", attackEligible: false }]
  });
  assert.deepEqual(engine.getKeywords(id("oz")), ["covert"], "exactly COVERT");
  assert.throws(
    () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("oz")], target: { type: "faction", playerId: P2 } }),
    "without AGGRO it cannot attack the turn it enters play"
  );
});

clause(ASHES, "0:unique", "the designation is ASHES OF ZENOBIA: another UNIQUE ASHES OF ZENOBIA card I control makes me keep one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "hand" },
      { key: "other", def: item({ name: "Not Ashes", unique: "ashes of zenobia" } as never), owner: P1, zone: "play" },
      ...bank("obsession", 7, P1)
    ]
  });
  play(engine, P1, id("az"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor", "a differently named card with the same designation counts");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("az"), id("other")].sort());
});
