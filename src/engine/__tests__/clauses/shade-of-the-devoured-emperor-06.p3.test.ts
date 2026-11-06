// Clause tests — batch shade-of-the-devoured-emperor-06, part p3 (groups 11-15, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses,
  autoResolveBattle
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { pending, readyResources, zoneOf, fillers } from "./_board.js";
import { clause, drain, declineAll, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";

type Board = ReturnType<typeof buildGame>;

// ===================================================================================
// Totally Random Kid
// ===================================================================================
const KID = "fc31573d-7f46-4e68-ab94-9ea36a3dbe90";

const pumpTactic = (n: number) =>
  tactic({
    name: "Pump",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: n, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

function kidBoard(extra: CardPlacement[] = [], deckSize = 8): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "kid", def: printing(KID), owner: P1, zone: "play" },
      ...fillers("od", deckSize, P2, "deck"),
      ...fillers("md", 6, P1, "deck"),
      { key: "i0", def: item({ name: "Free Item", cost: 0 }), owner: P2, zone: "play" },
      { key: "i1", def: item({ name: "Cheap Item", cost: 1 }), owner: P2, zone: "play" },
      { key: "i2", def: item({ name: "Two Item", cost: 2 }), owner: P2, zone: "play" },
      { key: "i3", def: item({ name: "Three Item", cost: 3 }), owner: P2, zone: "play" },
      { key: "i4", def: item({ name: "Four Item", cost: 4 }), owner: P2, zone: "play" },
      { key: "mine1", def: item({ name: "My Item", cost: 1 }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

const pickIt = (ids: CardInstanceId[]) => (pc: PendingChoiceLike) =>
  pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { it: ids } } : declineAll(pc);

/** The Kid attacks the opponent's faction, unblocked, and the battle is driven to its end answering with `answer`. */
function kidHitsFaction(b: Board, answer: (pc: PendingChoiceLike) => unknown, attackers: CardInstanceId[] = [b.id("kid")]) {
  fightThrough(b.engine, P1, attackers, { type: "faction", playerId: P2 }, [], undefined, answer);
}

const deckOf = (b: Board, p: PlayerId) => [...b.engine.state.players[p].deck];
const discardOf = (b: Board, p: PlayerId) => [...b.engine.state.players[p].discard];
const influenceOf = (b: Board, p: PlayerId) => b.engine.state.players[p].influence;

clause(KID, "0:rule", "Kid unblocked at printed strength 1: the opponent's top 1 card is milled (X = damage inflicted = 1), and the faction took exactly that damage", () => {
  const b = kidBoard();
  const deck = deckOf(b, P2);
  const mineDeck = deckOf(b, P1);
  const before = influenceOf(b, P2);
  kidHitsFaction(b, pickIt([]));
  assert.equal(before - influenceOf(b, P2), 1, "the faction took 1 battle damage");
  assert.deepEqual(deckOf(b, P2), deck.slice(1), "the TOP card left the deck");
  assert.deepEqual(discardOf(b, P2), deck.slice(0, 1), "...and is in the opponent's discard pile");
  assert.deepEqual(deckOf(b, P1), mineDeck, "my own deck is untouched");
  assert.equal(discardOf(b, P1).length, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

for (const [pump, x] of [[2, 3], [4, 5]] as const) {
  clause(KID, "0:rule", `X is the damage the Kid inflicted: strength 1 + ${pump} pump = ${x} damage mills the top ${x} cards`, () => {
    const b = kidBoard([{ key: "pump", def: pumpTactic(pump), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("pump"), { selected: { t: [b.id("kid")] } });
    assert.equal(b.engine.getStat(b.id("kid"), "strength"), 1 + pump, "control: the Kid is pumped");
    const deck = deckOf(b, P2);
    const before = influenceOf(b, P2);
    kidHitsFaction(b, pickIt([]));
    assert.equal(before - influenceOf(b, P2), x, "the faction took X damage");
    assert.deepEqual(deckOf(b, P2), deck.slice(x));
    assert.deepEqual(discardOf(b, P2), deck.slice(0, x), "the top X cards, in the opponent's discard pile");
  });
}

clause(KID, "0:rule", "a deck smaller than X: the whole deck is milled and nothing breaks", () => {
  const b = kidBoard([{ key: "pump", def: pumpTactic(4), owner: P1, zone: "hand" }], 2);
  play(b.engine, P1, b.id("pump"), { selected: { t: [b.id("kid")] } });
  const deck = deckOf(b, P2);
  assert.equal(deck.length, 2);
  kidHitsFaction(b, pickIt([]));
  assert.deepEqual(deckOf(b, P2), []);
  assert.deepEqual(discardOf(b, P2).sort(), [...deck].sort());
});

clause(KID, "0:rule", "the item pick: with X = 1 any item (either controller) with numeric cost 0 or 1 can be picked and is destroyed", () => {
  for (const key of ["i0", "i1", "mine1"]) {
    const b = kidBoard();
    const deck = deckOf(b, P2);
    kidHitsFaction(b, pickIt([b.id(key)]));
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} is destroyed`);
    for (const other of ["i0", "i1", "mine1", "i2", "i3", "i4"].filter(k => k !== key)) assert.equal(zoneOf(b.engine, b.id(other)), "play", `${other} stays`);
    assert.deepEqual(discardOf(b, P2).filter(c => deck.includes(c)), deck.slice(0, 1), "the mill still happened");
    assert.equal(zoneOf(b.engine, b.id("kid")), "play");
  }
});

clause(KID, "0:rule", "the item pick: with X = 1 an item costing more than X (2, 3, 4) is not pickable", () => {
  const b = kidBoard();
  declareAttackBy(b.engine, P1, [b.id("kid")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  resolvePendingResponses(b.engine);
  autoResolveBattle(b.engine);
  const pc = pending(b.engine);
  assert.ok(pc, "the pick is offered");
  for (const key of ["i2", "i3", "i4"]) {
    refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { it: [b.id(key)] } } } as never), `${key} costs more than X`);
  }
  // positive control on the same prompt
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { it: [b.id("i1")] } } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard");
  for (const key of ["i2", "i3", "i4"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");
});

/** Attack the opponent's faction unblocked and stop at the Kid's item-pick prompt. */
function battleToPick(b: Board, attackers: CardInstanceId[] = [b.id("kid")]): PendingChoiceLike | undefined {
  declareAttackBy(b.engine, P1, attackers);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  return pending(b.engine);
}
const answerPick = (b: Board, ids: CardInstanceId[]) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { it: ids } } } as never);
  resolvePendingResponses(b.engine);
};
const ITEM_KEYS = ["i0", "i1", "i2", "i3", "i4", "mine1"];

clause(KID, "0:rule", "the item pick is a 'may': declining destroys no item, while the mill still happens", () => {
  const b = kidBoard();
  const deck = deckOf(b, P2);
  const pc = battleToPick(b);
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P1, "the Kid's controller picks");
  answerPick(b, []);
  for (const key of ITEM_KEYS) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays`);
  assert.deepEqual(discardOf(b, P2), deck.slice(0, 1), "only the milled card is in the discard pile");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

for (const [pump, x] of [[2, 3]] as const) {
  clause(KID, "0:rule", `the item pick scales with X: at X = ${x} an item costing ${x} (exactly X) or 2 is destroyed; one costing 4 is refused`, () => {
    for (const key of ["i3", "i2"]) {
      const b = kidBoard([{ key: "pump", def: pumpTactic(pump), owner: P1, zone: "hand" }]);
      play(b.engine, P1, b.id("pump"), { selected: { t: [b.id("kid")] } });
      assert.ok(battleToPick(b), "the pick is offered");
      refused(() => answerPick(b, [b.id("i4")]), "an item costing 4 is more than X = 3");
      answerPick(b, [b.id(key)]);
      assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} destroyed`);
      assert.equal(zoneOf(b.engine, b.id("i4")), "play");
      assert.equal(b.engine.state.pendingChoice, undefined);
    }
  });
}

clause(KID, "0:rule", "the pick is for items only: a character or a location is not pickable even when cheap", () => {
  const b = kidBoard([
    { key: "chr", def: character({ name: "Bystander", cost: 0 }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Cheap Place", cost: 0 }), owner: P2, zone: "play" }
  ]);
  assert.ok(battleToPick(b), "battleToPick(b)");
  refused(() => answerPick(b, [b.id("chr")]), "a character is not an item");
  refused(() => answerPick(b, [b.id("loc")]), "a location is not an item");
  answerPick(b, [b.id("i0")]);
  assert.equal(zoneOf(b.engine, b.id("i0")), "discard", "positive control: an item is");
  assert.equal(zoneOf(b.engine, b.id("chr")), "play");
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
});

clause(KID, "0:rule", "blocked: the Kid damages a character, not a faction, so nothing is milled and no item pick appears", () => {
  const wall = character({ name: "Wall", cost: 0, strength: 0, life: 3, speed: 1 });
  const b = kidBoard([{ key: "wall", def: wall, owner: P2, zone: "play" }]);
  const deck = deckOf(b, P2);
  declareAttackBy(b.engine, P1, [b.id("kid")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("wall")] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(b.engine.state.cards[b.id("wall")].damage, 1, "control: the Kid did damage the blocker");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b, P2), deck);
  assert.equal(discardOf(b, P2).length, 0);
  for (const key of ITEM_KEYS) assert.equal(zoneOf(b.engine, b.id(key)), "play");
});

clause(KID, "0:rule", "another character's battle damage to the faction does not trigger the Kid", () => {
  const buddy = character({ name: "Buddy", cost: 0, strength: 2, life: 2, speed: 2 });
  const b = kidBoard([{ key: "buddy", def: buddy, owner: P1, zone: "play" }]);
  const deck = deckOf(b, P2);
  const before = influenceOf(b, P2);
  declareAttackBy(b.engine, P1, [b.id("buddy")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(before - influenceOf(b, P2), 2, "control: the faction took the damage");
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined, "the Kid did not trigger");
  assert.deepEqual(deckOf(b, P2), deck);
  for (const key of ITEM_KEYS) assert.equal(zoneOf(b.engine, b.id(key)), "play");
});

clause(KID, "0:rule", "in a party only the Kid's own damage counts: X is the Kid's 1, not the party's total", () => {
  const buddy = character({ name: "Buddy", cost: 0, strength: 3, life: 2, speed: 4 });
  const b = kidBoard([{ key: "buddy", def: buddy, owner: P1, zone: "play" }]);
  const deck = deckOf(b, P2);
  const before = influenceOf(b, P2);
  assert.ok(battleToPick(b, [b.id("kid"), b.id("buddy")]), "the Kid's pick is offered");
  refused(() => answerPick(b, [b.id("i2")]), "X is 1, so a 2-cost item is out of reach");
  answerPick(b, [b.id("i1")]);
  assert.equal(before - influenceOf(b, P2), 4, "control: the party dealt 1 + 3 to the faction");
  assert.deepEqual(discardOf(b, P2).filter(c => deck.includes(c)), deck.slice(0, 1), "only 1 card milled");
  assert.deepEqual(deckOf(b, P2), deck.slice(1));
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard");
});

clause(KID, "0:rule", "Kid deploys for 2 with [D], is refused one resource short or without a Deception icon, and has printed stats 1 / 4 / 1", () => {
  const mk = (res: CardPlacement[]) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "me", def: printing(KID), owner: P1, zone: "hand" }, ...res] });
  const ok = mk(bank("deception", 2));
  play(ok.engine, P1, ok.id("me"));
  assert.equal(zoneOf(ok.engine, ok.id("me")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 2");
  assert.deepEqual([ok.engine.getStat(ok.id("me"), "strength"), ok.engine.getStat(ok.id("me"), "speed"), ok.engine.getStat(ok.id("me"), "life")], [1, 4, 1]);
  const short = mk(bank("deception", 1));
  refused(() => playRaw(short.engine, P1, short.id("me")), "one resource short");
  const noIcon = mk(bank("rage", 2));
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("me")), "no [D] icon");
});

// ===================================================================================
// Clockman Skydocks
// ===================================================================================
const SKY = "0146d330-33ea-4847-8d52-25810a946e40";

type IconWord = "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
const LETTER: Record<IconWord, string> = { rage: "r", greed: "g", deception: "d", elitism: "e", obsession: "o", volition: "v" };
const ICON_WORDS = Object.keys(LETTER) as IconWord[];
const attachAll = (ps: CardPlacement[]): CardPlacement[] => ps.map(p => ({ ...p, attachedToKey: "__factionA" }));

/** A hand card with a threshold and no numeric cost; `type` picks the card type. */
function thrCard(key: string, threshold: string, type: "character" | "item" | "tactic" | "location" = "character", owner: PlayerId = P1): CardPlacement {
  const over = { name: key, cost: 0, threshold } as never;
  const def = type === "character" ? character(over) : type === "item" ? item(over) : type === "location" ? location(over) : tactic(over);
  return { key, def, owner, zone: "hand" };
}

type SkyOpts = { rage?: number; greed?: number; deception?: number; vol?: number; spentVol?: number; spentGreed?: number; hand?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId; turn?: number };
function skyBoard(o: SkyOpts = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "cs", def: printing(SKY), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 0),
      ...bank("greed", o.greed ?? 0),
      ...bank("deception", o.deception ?? 0),
      ...volition(o.vol ?? 0),
      ...attachAll(volition(o.spentVol ?? 0)),
      ...attachAll(bank("greed", o.spentGreed ?? 0)),
      ...fillers("pd", 6, P1, "deck"),
      ...fillers("od", 6, P2, "deck"),
      ...(o.hand ?? []),
      ...(o.extra ?? [])
    ]
  });
}

type SkyAbility = { id: string; pay: number; max: number };
const BDAY: SkyAbility = { id: "cs-bday", pay: 1, max: 1 };
const OVERTIME: SkyAbility = { id: "cs-overtime", pay: 2, max: 6 };
/** Enough face-down resources for OVERTIME's [V][V][V][V][V] (and nothing else needing them). */
const volFor = (a: SkyAbility) => (a === OVERTIME ? 6 : 0);

/** Activate Skydocks, check the icon prompt is the controller's resource-icon choice, answer it. */
function nameIcon(b: Board, a: SkyAbility, icon: IconWord): void {
  activate(b.engine, P1, b.id("cs"), a.id);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "nameValue", "an icon is chosen");
  assert.equal(pc?.playerId, P1, "by the controller");
  assert.equal(pc?.valueKind, "resourceIcon");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: icon } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
}
const deployOk = (b: Board, key: string, selected: Record<string, CardInstanceId[]> = {}) => {
  playRaw(b.engine, P1, b.id(key), { selected });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id(key)), key.startsWith("Tac") ? "discard" : "play", `${key} was played`);
};
const deployRefused = (b: Board, key: string, why: string) => {
  refused(() => playRaw(b.engine, P1, b.id(key)), why);
  assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} stays in hand`);
};

// --- BUSINESS DAY / OVERTIME: cost ---------------------------------------------------------
function costIsPaid(a: SkyAbility) {
  const b = skyBoard({ rage: 1, greed: 4, vol: volFor(a) });
  const ready = readyResources(b.engine, P1);
  assert.equal(b.engine.state.cards[b.id("cs")].depleted ?? false, false);
  activate(b.engine, P1, b.id("cs"), a.id);
  // "Choose a resource icon" is part of the cost: the costs are paid together once the icon is chosen.
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
  assert.equal(b.engine.state.cards[b.id("cs")].depleted, true, "COST: deplete this card");
  assert.equal(ready - readyResources(b.engine, P1), a.pay, `COST: pay ${a.pay}`);
}
function iconChosenAsCost(a: SkyAbility) {
  const b = skyBoard({ rage: 1, greed: 4, vol: volFor(a) });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("cs"), abilityId: a.id, selected: {}, variables: {} } as never);
  // E3a: the play is atomic - nothing is paid while the cost prompt is open (the costs are paid together once it is answered).
  assert.equal(b.engine.state.cards[b.id("cs")].depleted ?? false, false, "nothing is paid while the icon is still to be chosen");
  assert.equal(pending(b.engine)?.kind, "nameValue", "'Choose a resource icon' is a COST: the controller chooses on activation");
  assert.equal(pending(b.engine)?.playerId, P1);
  assert.equal(b.engine.state.responseWindow, undefined, "the ability is not on the stack (no response window) until every cost is paid");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
  assert.equal(b.engine.state.cards[b.id("cs")].depleted, true, "once the icon is chosen, the other costs are paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
}
function refusedWhenDepleted(a: SkyAbility) {
  const b = skyBoard({ rage: 1, greed: 4, vol: volFor(a) });
  b.engine.state.cards[b.id("cs")].depleted = true;
  refused(() => activate(b.engine, P1, b.id("cs"), a.id), "Skydocks is already depleted");
  assert.equal(b.engine.state.pendingChoice, undefined);
  // control: undepleted, it works
  const ok = skyBoard({ rage: 1, greed: 4, vol: volFor(a) });
  activate(ok.engine, P1, ok.id("cs"), a.id);
  assert.equal(pending(ok.engine)?.kind, "nameValue");
}
function refusedWhenUnaffordable(a: SkyAbility) {
  // exactly `pay - 1` ready resources: refused
  const short = skyBoard({ spentGreed: 4, greed: a.pay - 1, spentVol: volFor(a) });
  assert.equal(readyResources(short.engine, P1), a.pay - 1);
  refused(() => activate(short.engine, P1, short.id("cs"), a.id), `only ${a.pay - 1} resources are available`);
  assert.equal(short.engine.state.cards[short.id("cs")].depleted ?? false, false, "refused: nothing was paid");
  // exactly `pay` ready resources: works
  const exact = skyBoard({ spentGreed: 4, greed: a.pay, spentVol: volFor(a) });
  assert.equal(readyResources(exact.engine, P1), a.pay);
  activate(exact.engine, P1, exact.id("cs"), a.id);
  assert.equal(pending(exact.engine)?.kind, "nameValue");
  exact.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
  assert.equal(readyResources(exact.engine, P1), 0);
}

clause(SKY, "1:ability:cs-bday", "COST: pays 1 and depletes Skydocks", () => costIsPaid(BDAY));
clause(SKY, "1:ability:cs-bday", "'Choose a resource icon' is part of the printed COST, but the icon is only chosen when the ability resolves", () => iconChosenAsCost(BDAY));
clause(SKY, "1:ability:cs-bday", "refused while Skydocks is depleted", () => refusedWhenDepleted(BDAY));
clause(SKY, "1:ability:cs-bday", "refused when 1 resource cannot be paid, works with exactly 1", () => refusedWhenUnaffordable(BDAY));

clause(SKY, "2:ability:cs-overtime", "COST: pays 2 and depletes Skydocks", () => costIsPaid(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "'Choose a resource icon' is part of the printed COST, but the icon is only chosen when the ability resolves", () => iconChosenAsCost(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "refused while Skydocks is depleted", () => refusedWhenDepleted(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "refused when 2 resources cannot be paid, works with exactly 2", () => refusedWhenUnaffordable(OVERTIME));

clause(SKY, "2:ability:cs-overtime", "needs [V][V][V][V][V]: refused with only four Volition icons (plenty of other resources), works with five", () => {
  const four = skyBoard({ vol: 4, rage: 3, greed: 3 });
  refused(() => activate(four.engine, P1, four.id("cs"), "cs-overtime"), "4 Volition icons are one short");
  assert.equal(four.engine.state.cards[four.id("cs")].depleted ?? false, false);
  const five = skyBoard({ vol: 5, rage: 3 });
  activate(five.engine, P1, five.id("cs"), "cs-overtime");
  assert.equal(pending(five.engine)?.kind, "nameValue", "five Volition icons are enough");
  const none = skyBoard({ rage: 6, greed: 6 });
  refused(() => activate(none.engine, P1, none.id("cs"), "cs-overtime"), "no Volition at all");
});

clause(SKY, "1:ability:cs-bday", "BUSINESS DAY has no threshold: it works with no Volition icons at all", () => {
  const b = skyBoard({ rage: 1 });
  activate(b.engine, P1, b.id("cs"), "cs-bday");
  assert.equal(pending(b.engine)?.kind, "nameValue");
});

// --- effect: reduce the next card's threshold requirement of the chosen icon -------------------
function reducesByMax(a: SkyAbility) {
  const rs = (n: number) => "r".repeat(n);
  // a card needing max+1 [R] with a single Rage: refused, then playable after naming Rage
  const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand: [thrCard("A", rs(a.max + 1))] });
  deployRefused(b, "A", `${a.max + 1} Rage needed, 1 owned`);
  nameIcon(b, a, "rage");
  deployOk(b, "A");
  // a card needing max+2 [R] with a single Rage is still out of reach: the reduction is capped at max
  const c = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand: [thrCard("B", rs(a.max + 2))] });
  nameIcon(c, a, "rage");
  deployRefused(c, "B", `the reduction is only ${a.max}`);
  // ...but with two Rage it is exactly in reach
  const d = skyBoard({ rage: 2, greed: 3, vol: volFor(a), hand: [thrCard("B", rs(a.max + 2))] });
  deployRefused(d, "B", "control: unreduced");
  nameIcon(d, a, "rage");
  deployOk(d, "B");
}
function reducesSmallRequirementsToNothing(a: SkyAbility) {
  // a requirement smaller than the reduction is simply removed (no Rage owned at all)
  const small = "r".repeat(Math.min(2, a.max));
  const b = skyBoard({ greed: 3, vol: volFor(a), hand: [thrCard("A", small)] });
  deployRefused(b, "A", "no Rage");
  nameIcon(b, a, "rage");
  deployOk(b, "A");
}
function onlyTheNamedIcon(a: SkyAbility) {
  // card "gr": 1 Rage owned, no Greed. Naming Greed lets it in; naming Rage or Deception does not.
  const mk = () => skyBoard({ rage: 1, deception: 3, vol: volFor(a), hand: [thrCard("A", "gr")] });
  const ok = mk();
  deployRefused(ok, "A", "no Greed");
  nameIcon(ok, a, "greed");
  deployOk(ok, "A");
  for (const wrong of ["rage", "deception", "elitism"] as const) {
    const b = mk();
    nameIcon(b, a, wrong);
    deployRefused(b, "A", `naming ${wrong} does not remove the Greed requirement`);
  }
}
function anyIconCanBeChosen(a: SkyAbility) {
  for (const named of ICON_WORDS) {
    // one of each icon is owned; every hand card needs one more of its icon than is owned
    const volOwned = Math.max(1, volFor(a));
    const hand = ICON_WORDS.map(w => thrCard(`X${w}`, LETTER[w].repeat(w === "volition" ? volOwned + 1 : 2)));
    const b = skyBoard({ rage: 1, greed: 1, deception: 1, vol: volOwned, hand, extra: [...bank("elitism", 1), ...bank("obsession", 1)] });
    nameIcon(b, a, named);
    for (const w of ICON_WORDS.filter(w => w !== named)) deployRefused(b, `X${w}`, `${w} was not the named icon (${named} was)`);
    deployOk(b, `X${named}`);
  }
}
function onlyTheNextCard(a: SkyAbility) {
  const hand = [thrCard("A", "r".repeat(a.max + 1)), thrCard("B", "r".repeat(a.max + 1))];
  const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand });
  nameIcon(b, a, "rage");
  deployOk(b, "A");
  deployRefused(b, "B", "the reduction was used up by the first card");
}
function nextCardWithoutThresholdUsesItUp(a: SkyAbility) {
  const hand = [thrCard("A", ""), thrCard("B", "r".repeat(a.max + 1))];
  const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand });
  nameIcon(b, a, "rage");
  deployOk(b, "A");
  deployRefused(b, "B", "the NEXT card (with no threshold at all) used the reduction up");
}
function anyCardType(a: SkyAbility) {
  for (const type of ["character", "item", "location", "tactic"] as const) {
    const key = type === "tactic" ? "Tac" : "A";
    const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand: [thrCard(key, "r".repeat(a.max + 1), type)] });
    deployRefused(b, key, `${type}: unreduced`);
    nameIcon(b, a, "rage");
    deployOk(b, key);
  }
}
function numericCostUntouched(a: SkyAbility) {
  const costly = { key: "A", def: character({ name: "A", cost: 2, threshold: "r".repeat(a.max + 1) } as never), owner: P1, zone: "hand" as const };
  const b = skyBoard({ rage: 1, greed: 4, vol: volFor(a), hand: [costly] });
  nameIcon(b, a, "rage");
  const ready = readyResources(b.engine, P1);
  deployOk(b, "A");
  assert.equal(ready - readyResources(b.engine, P1), 2, "its numeric cost of 2 is still paid in full");
  // and it still needs those 2 resources
  const poor = skyBoard({ rage: 1, spentGreed: 4, greed: a.pay, spentVol: volFor(a), hand: [costly] });
  nameIcon(poor, a, "rage");
  assert.equal(readyResources(poor.engine, P1), 1);
  deployRefused(poor, "A", "numeric cost is not reduced: 1 resource is short of its 2");
}
function persistsAcrossTurns(a: SkyAbility) {
  const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand: [thrCard("A", "r".repeat(a.max + 1))] });
  nameIcon(b, a, "rage");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.turn, 3);
  deployOk(b, "A");
}
function opponentUnaffected(a: SkyAbility) {
  const ping = item({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "ping", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const freeTactic = tactic({ name: "Free", cost: 0, behavior: { abilities: [{ id: "f", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const b = skyBoard({
    rage: 1,
    greed: 3,
    vol: volFor(a),
    hand: [thrCard("A", "r".repeat(a.max + 1)), thrCard("OppRage", "r".repeat(a.max + 1), "tactic", P2), { key: "OppFree", def: freeTactic, owner: P2, zone: "hand" }],
    extra: [{ key: "ping", def: ping, owner: P1, zone: "play" }, ...bank("rage", 1, P2)]
  });
  nameIcon(b, a, "rage");
  // P1 activates something so that P2 gets a response window
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("ping"), abilityId: "ping", selected: {}, variables: {} } as never);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "control: P2 may respond");
  refused(() => b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("OppRage"), selected: {}, variables: {} } as never), "P1's reduction does not apply to P2's card");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("OppFree"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("OppFree")), "discard", "control: P2 did play a card in response");
  // that play was not 'the next card YOU play': my reduction is intact
  deployOk(b, "A");
}

clause(SKY, "1:ability:cs-bday", "EFFECT: the next card's requirement of the chosen icon drops by exactly 1", () => reducesByMax(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: a requirement of the chosen icon that is fully covered by the reduction is simply gone", () => reducesSmallRequirementsToNothing(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: only the chosen icon is reduced (mixed threshold)", () => onlyTheNamedIcon(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: any of the six icons can be chosen and reduces only itself", () => anyIconCanBeChosen(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: only the next card is reduced", () => onlyTheNextCard(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: the next card, even one with no threshold, uses the reduction up", () => nextCardWithoutThresholdUsesItUp(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: applies to any type of card (character, item, location, tactic)", () => anyCardType(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: only the threshold is reduced, the numeric cost is still paid", () => numericCostUntouched(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: the printed text has no 'this turn', so the reduction waits for the next card even across turns", () => persistsAcrossTurns(BDAY));
clause(SKY, "1:ability:cs-bday", "EFFECT: 'the next card YOU play': the opponent's cards are neither reduced nor use it up", () => opponentUnaffected(BDAY));

clause(SKY, "2:ability:cs-overtime", "EFFECT: the next card's requirement of the chosen icon drops by up to 6 (capped at 6)", () => reducesByMax(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: a requirement smaller than 6 is simply gone", () => reducesSmallRequirementsToNothing(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: only the chosen icon is reduced (mixed threshold)", () => onlyTheNamedIcon(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: any of the six icons can be chosen and reduces only itself", () => anyIconCanBeChosen(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: only the next card is reduced", () => onlyTheNextCard(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: the next card, even one with no threshold, uses the reduction up", () => nextCardWithoutThresholdUsesItUp(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: applies to any type of card (character, item, location, tactic)", () => anyCardType(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: only the threshold is reduced, the numeric cost is still paid", () => numericCostUntouched(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: the printed text has no 'this turn', so the reduction waits for the next card even across turns", () => persistsAcrossTurns(OVERTIME));
clause(SKY, "2:ability:cs-overtime", "EFFECT: 'the next card YOU play': the opponent's cards are neither reduced nor use it up", () => opponentUnaffected(OVERTIME));

function activationsStack(a: SkyAbility) {
  const need = "r".repeat(2 * a.max + 1);
  // after ONE activation a card needing 2*max+1 Rage is still out of reach with a single Rage...
  const one = skyBoard({ rage: 1, greed: 4, vol: volFor(a), hand: [thrCard("A", need)] });
  nameIcon(one, a, "rage");
  deployRefused(one, "A", "one activation only reduces by max");
  // ...after TWO activations (Skydocks restored in between) both reductions apply to the next card
  const two = skyBoard({ rage: 1, greed: 4, vol: volFor(a) + 1, hand: [thrCard("A", need)] });
  nameIcon(two, a, "rage");
  two.engine.state.cards[two.id("cs")].depleted = false;
  nameIcon(two, a, "rage");
  deployOk(two, "A");
}
clause(SKY, "1:ability:cs-bday", "EFFECT: two activations both reduce the next card (they stack)", () => activationsStack(BDAY));
clause(SKY, "2:ability:cs-overtime", "EFFECT: two activations both reduce the next card (they stack)", () => activationsStack(OVERTIME));

/** Printed text: "the next card you DEPLOY". Developing a resource is not deploying, so it does NOT use the reduction up (rules triage 2026-10-20). */
function developKeepsIt(a: SkyAbility, faceDownCharacter: boolean) {
  const dev = faceDownCharacter
    ? { key: "R", def: character({ name: "R", cost: 0 } as never), owner: P1, zone: "hand" as const }
    : { key: "R", def: resourceCard({ name: "R", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const };
  const need = "r".repeat(a.max + 1);
  const hand = [dev, thrCard("B", need)];
  // control: without developing, the reduction applies to B
  const control = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand, active: P1 });
  nameIcon(control, a, "rage");
  deployOk(control, "B");
  // developing a resource first does not use the reduction up: B (a deploy) is still reduced
  const b = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand, active: P1 });
  nameIcon(b, a, "rage");
  developResource(b.engine, P1, b.id("R"), faceDownCharacter);
  assert.equal(zoneOf(b.engine, b.id("R")), "play", "the resource was developed");
  deployOk(b, "B");
  // ...and the deploy did use it up: with no new activation a second such card is out of reach
  const c = skyBoard({ rage: 1, greed: 3, vol: volFor(a), hand: [dev, thrCard("B", need), thrCard("C", need)], active: P1 });
  nameIcon(c, a, "rage");
  developResource(c.engine, P1, c.id("R"), faceDownCharacter);
  deployOk(c, "B");
  deployRefused(c, "C", "the deploy of B used the next-deploy reduction up");
}
clause(SKY, "1:ability:cs-bday", "EFFECT: developing a resource face-up is not a deploy, so it does not use up 'the next card you deploy'", () => developKeepsIt(BDAY, false));
clause(SKY, "1:ability:cs-bday", "EFFECT: developing a card face-down as a resource is not a deploy, so it does not use up 'the next card you deploy'", () => developKeepsIt(BDAY, true));
clause(SKY, "2:ability:cs-overtime", "EFFECT: developing a resource face-up is not a deploy, so it does not use up 'the next card you deploy'", () => developKeepsIt(OVERTIME, false));
clause(SKY, "2:ability:cs-overtime", "EFFECT: developing a card face-down as a resource is not a deploy, so it does not use up 'the next card you deploy'", () => developKeepsIt(OVERTIME, true));

// --- UNIQUE SKYDOCKS ------------------------------------------------------------------
function skyUniqueBoard(extra: CardPlacement[], o: { turn?: number; active?: PlayerId } = {}): Board {
  return skyBoard({ vol: 3, extra, turn: o.turn, active: o.active });
}
clause(SKY, "0:unique", "controlling a second Skydocks makes you keep one: choosing the new one destroys the old one", () => {
  const b = skyUniqueBoard([{ key: "cs2", def: printing(SKY), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("cs2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("cs"), b.id("cs2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("cs2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("cs2")), "play");
  assert.equal(zoneOf(b.engine, b.id("cs")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(SKY, "0:unique", "choosing the old Skydocks keeps it and destroys the new one", () => {
  const b = skyUniqueBoard([{ key: "cs2", def: printing(SKY), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("cs2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("cs") } } as never);
  assert.equal(zoneOf(b.engine, b.id("cs")), "play");
  assert.equal(zoneOf(b.engine, b.id("cs2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(SKY, "0:unique", "the restriction is per player: the opponent may control their own Skydocks, no choice and no destruction", () => {
  const b = skyUniqueBoard(
    [
      { key: "cs2", def: printing(SKY), owner: P2, zone: "hand" },
      ...volition(2, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("cs2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cs")), "play");
  assert.equal(zoneOf(b.engine, b.id("cs2")), "play");
});
clause(SKY, "0:unique", "Skydocks deploys for its printed cost of 1 with [V], is refused with no resource or with no Volition icon, and has structure 4", () => {
  const mk = (res: CardPlacement[]) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "me", def: printing(SKY), owner: P1, zone: "hand" }, ...res] });
  const ok = mk(volition(1));
  play(ok.engine, P1, ok.id("me"));
  assert.equal(zoneOf(ok.engine, ok.id("me")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 1");
  assert.equal(ok.engine.getStat(ok.id("me"), "structure"), 4);
  const none = mk([]);
  refused(() => playRaw(none.engine, P1, none.id("me")), "no resource to pay with");
  const noIcon = mk(bank("rage", 3));
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("me")), "no Volition icon for [V]");
});

// ===================================================================================
// Remains of Foreman Pete, the Clock Man
// ===================================================================================
const PETE = "ef8e7666-c491-4bdd-96e8-880193a5b01b";
const stapleRes = (name: string, icon: IconWord = "rage") => resourceCard({ name, resource: { provides: [icon], staple: true } } as never);
const plainRes = (name: string, icon: IconWord = "rage") => resourceCard({ name, resource: { provides: [icon], staple: false } } as never);
const inHand = (key: string, def: ReturnType<typeof character>, owner: PlayerId = P1): CardPlacement => ({ key, def, owner, zone: "hand" });
const fdCard = (key: string, def: ReturnType<typeof character>, owner: PlayerId = P1, controller?: PlayerId): CardPlacement => ({ key, def, owner, controller, zone: "play", faceDown: true });
const attachedTo = (p: CardPlacement, owner: PlayerId = P1): CardPlacement => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" });

type PeteOpts = { vol?: number; spentVol?: number; rage?: number; hand?: CardPlacement[]; extra?: CardPlacement[]; deck?: number; peteOwner?: PlayerId; peteController?: PlayerId; active?: PlayerId; turn?: number };
function peteBoard(o: PeteOpts = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "fp", def: printing(PETE), owner: o.peteOwner ?? P1, controller: o.peteController, zone: "play" },
      ...volition(o.vol ?? 0),
      ...attachAll(volition(o.spentVol ?? 0)),
      ...bank("rage", o.rage ?? 0),
      ...fillers("pd", o.deck ?? 6, P1, "deck"),
      ...fillers("od", 6, P2, "deck"),
      ...(o.hand ?? []),
      ...(o.extra ?? [])
    ]
  });
}
const handOf = (b: Board, p: PlayerId) => [...b.engine.state.players[p].hand];
const attachedNow = (b: Board, p: PlayerId) => attachedCount(b.engine, p);

// --- UNIQUE FOREMAN PETE ------------------------------------------------------------------
clause(PETE, "0:unique", "controlling a second Foreman Pete makes you keep one: choosing the new one destroys the old one", () => {
  const b = peteBoard({ vol: 4, hand: [inHand("fp2", printing(PETE))] });
  play(b.engine, P1, b.id("fp2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("fp"), b.id("fp2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("fp2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("fp2")), "play");
  assert.equal(zoneOf(b.engine, b.id("fp")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PETE, "0:unique", "choosing the old Foreman Pete keeps it and destroys the new one", () => {
  const b = peteBoard({ vol: 4, hand: [inHand("fp2", printing(PETE))] });
  play(b.engine, P1, b.id("fp2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("fp") } } as never);
  assert.equal(zoneOf(b.engine, b.id("fp")), "play");
  assert.equal(zoneOf(b.engine, b.id("fp2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PETE, "0:unique", "the restriction is per player: the opponent may control their own Foreman Pete, no choice and no destruction", () => {
  const b = peteBoard({ turn: 2, active: P2, extra: [{ key: "fp2", def: printing(PETE), owner: P2, zone: "hand" }, ...volition(4, P2)] });
  play(b.engine, P2, b.id("fp2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("fp")), "play");
  assert.equal(zoneOf(b.engine, b.id("fp2")), "play");
});
clause(PETE, "0:unique", "Foreman Pete deploys for its printed cost of 3 with [V][V], is refused one resource short or without Volition icons", () => {
  const mk = (res: CardPlacement[]) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "me", def: printing(PETE), owner: P1, zone: "hand" }, ...res] });
  const ok = mk(volition(3));
  play(ok.engine, P1, ok.id("me"));
  assert.equal(zoneOf(ok.engine, ok.id("me")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 3");
  const short = mk(volition(2));
  refused(() => playRaw(short.engine, P1, short.id("me")), "one resource short (2 Volition icons are enough for [V][V])");
  const noIcon = mk(bank("rage", 5));
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("me")), "plenty of resources but no Volition icon");
  const oneIcon = mk([...volition(1), ...bank("rage", 4)]);
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("me")), "only one Volition icon");
});

// --- CLOCK IN ------------------------------------------------------------------------------
const clockInBoard = (o: PeteOpts = {}) =>
  peteBoard({
    vol: 3,
    hand: [inHand("stp1", stapleRes("Staple One")), inHand("stp2", stapleRes("Staple Two", "greed")), inHand("plain", plainRes("Plain Res")), inHand("chr", character({ name: "Char", cost: 0 }))],
    ...o
  });
const clockIn = (b: Board, staple?: string) =>
  activate(b.engine, P1, b.id("fp"), "foreman-pete-clock-in", staple ? { selected: { staple: [b.id(staple)] } } : {});

clause(PETE, "1:ability:foreman-pete-clock-in", "COST: the chosen staple resource is discarded from my hand and 2 resources are paid; EFFECT: I draw exactly 1 card", () => {
  const b = clockInBoard();
  const deck = [...b.engine.state.players[P1].deck];
  const oppHand = handOf(b, P2);
  const oppDeck = [...b.engine.state.players[P2].deck];
  const ready = readyResources(b.engine, P1);
  clockIn(b, "stp2");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("stp2")), "discard", "the chosen staple was discarded");
  assert.equal(zoneOf(b.engine, b.id("stp1")), "hand", "the other staple stays");
  assert.equal(ready - readyResources(b.engine, P1), 2, "COST: pay 2");
  assert.deepEqual([...b.engine.state.players[P1].deck], deck.slice(1), "exactly one card left my deck");
  assert.ok(handOf(b, P1).includes(deck[0]), "the top card is now in my hand");
  assert.equal(handOf(b, P1).length, 4 - 1 + 1, "4 in hand - the staple + 1 drawn");
  assert.deepEqual(handOf(b, P2), oppHand, "the opponent's hand is untouched");
  assert.deepEqual([...b.engine.state.players[P2].deck], oppDeck, "the opponent's deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("fp")), "play");
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown ?? false, false, "Foreman Pete is not used up (not depleted/flipped)");
});
clause(PETE, "1:ability:foreman-pete-clock-in", "COST: choosing the other staple discards that one instead", () => {
  const b = clockInBoard();
  clockIn(b, "stp1");
  assert.equal(zoneOf(b.engine, b.id("stp1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("stp2")), "hand");
});
clause(PETE, "1:ability:foreman-pete-clock-in", "COST: only a STAPLE resource in my hand can be discarded: not a non-staple resource, a character, a staple in play, or the opponent's staple", () => {
  const b = clockInBoard({ extra: [{ key: "inplay", def: stapleRes("Staple In Play"), owner: P1, zone: "play" }, inHand("oppstp", stapleRes("Opp Staple"), P2)] });
  const hand = handOf(b, P1);
  for (const [key, why] of [["plain", "a resource that is not a staple"], ["chr", "a character"], ["inplay", "a staple resource in play (not in hand)"], ["oppstp", "the opponent's staple"]] as const) {
    refused(() => clockIn(b, key), `${why} cannot be discarded for the cost`);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.deepEqual(handOf(b, P1), hand, `${key}: nothing was discarded or drawn`);
  }
  assert.equal(readyResources(b.engine, P1), 3 + 1, "nothing was paid by the refused attempts (the in-play staple is ready too)");
  clockIn(b, "stp1"); // control
  assert.equal(zoneOf(b.engine, b.id("stp1")), "discard");
});
clause(PETE, "1:ability:foreman-pete-clock-in", "COST: refused when I hold no staple resource to discard (other resources and characters don't count)", () => {
  const b = peteBoard({ vol: 3, hand: [inHand("plain", plainRes("Plain Res")), inHand("chr", character({ name: "Char", cost: 0 }))] });
  refused(() => clockIn(b), "no staple in hand");
  refused(() => clockIn(b, "plain"), "a non-staple resource");
  assert.equal(readyResources(b.engine, P1), 3);
  assert.equal(handOf(b, P1).length, 2);
});
clause(PETE, "1:ability:foreman-pete-clock-in", "COST: refused when 2 resources can't be paid, works with exactly 2", () => {
  const short = clockInBoard({ vol: 1, spentVol: 2 });
  assert.equal(readyResources(short.engine, P1), 1);
  refused(() => clockIn(short, "stp1"), "only 1 resource is available");
  assert.equal(zoneOf(short.engine, short.id("stp1")), "hand", "refused: the staple was not discarded");
  const exact = clockInBoard({ vol: 2, spentVol: 1 });
  assert.equal(readyResources(exact.engine, P1), 2);
  clockIn(exact, "stp1");
  assert.equal(zoneOf(exact.engine, exact.id("stp1")), "discard");
  assert.equal(readyResources(exact.engine, P1), 0);
});
clause(PETE, "1:ability:foreman-pete-clock-in", "needs [V][V][V]: refused with two Volition icons (and plenty of other resources), works with three", () => {
  const two = clockInBoard({ vol: 2, rage: 4 });
  refused(() => clockIn(two, "stp1"), "2 Volition icons are one short");
  assert.equal(zoneOf(two.engine, two.id("stp1")), "hand");
  const three = clockInBoard({ vol: 3, rage: 4 });
  clockIn(three, "stp1");
  assert.equal(zoneOf(three.engine, three.id("stp1")), "discard");
});

// --- WORK IT -------------------------------------------------------------------------------
const workItBoard = (o: PeteOpts & { spendFds?: boolean } = {}) => {
  const fd = (p: CardPlacement) => (o.spendFds ? attachedTo(p) : p);
  return peteBoard({
    vol: o.vol ?? 2,
    spentVol: o.spentVol,
    rage: o.rage,
    extra: [fd(fdCard("fd1", plainRes("Face Down One"))), fd(fdCard("fd2", character({ name: "Hidden Hero", cost: 0 }))), { key: "up", def: plainRes("Face Up Res"), owner: P1, zone: "play" }, fdCard("oppfd", plainRes("Opp Face Down"), P2), ...(o.extra ?? [])],
    hand: [inHand("stp", stapleRes("Hand Staple")), inHand("chr", character({ name: "Hand Char", cost: 0 })), inHand("oppcard", character({ name: "Opp Hand", cost: 0 }), P2), ...(o.hand ?? [])]
  });
};
const workIt = (b: Board, fd: string) => activate(b.engine, P1, b.id("fp"), "foreman-pete-work-it", { selected: { fd: [b.id(fd)] } });
const answerPlay = (b: Board, res?: string) => {
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the 'you may play a resource' prompt");
  assert.equal(pc?.playerId, P1);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: res ? [b.id(res)] : [] } } as never);
  resolvePendingResponses(b.engine);
};

clause(PETE, "2:ability:foreman-pete-work-it", "COST: pays 2; EFFECT: the picked face-down resource goes into my hand, face-up again; declining the play leaves everything in hand", () => {
  const b = workItBoard({ spendFds: true });
  const ready = readyResources(b.engine, P1);
  workIt(b, "fd1");
  assert.equal(ready - readyResources(b.engine, P1), 2, "COST: pay 2");
  answerPlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("fd1")), "hand", "that card is in my hand");
  assert.ok(handOf(b, P1).includes(b.id("fd1")), "handOf(b, P1).includes(b.id(\"fd1\"))");
  assert.equal(b.engine.state.cards[b.id("fd1")].faceDown ?? false, false);
  assert.equal(zoneOf(b.engine, b.id("fd2")), "play", "the other face-down card stays");
  assert.equal(zoneOf(b.engine, b.id("stp")), "hand", "declined: no resource was played");
  assert.equal(zoneOf(b.engine, b.id("chr")), "hand");
});
clause(PETE, "2:ability:foreman-pete-work-it", "EFFECT: 'you may play a resource' - a character from my hand can be played (face-down, as a resource)", () => {
  const b = workItBoard();
  workIt(b, "fd1");
  answerPlay(b, "chr");
  assert.equal(zoneOf(b.engine, b.id("chr")), "play");
  assert.equal(b.engine.state.cards[b.id("chr")].faceDown, true, "a non-resource can only be played face-down");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PETE, "2:ability:foreman-pete-work-it", "EFFECT: 'you may play a resource' - the card Work It just returned can itself be played again", () => {
  const b = workItBoard();
  workIt(b, "fd1");
  answerPlay(b, "fd1");
  assert.equal(zoneOf(b.engine, b.id("fd1")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PETE, "2:ability:foreman-pete-work-it", "EFFECT: 'you may play a resource' - a real resource card is played into play (face-up)", () => {
  const b = workItBoard();
  workIt(b, "fd1");
  answerPlay(b, "stp");
  assert.equal(zoneOf(b.engine, b.id("stp")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PETE, "2:ability:foreman-pete-work-it", "'play a resource' lets me choose face-up or face-down for an actual resource card", () => holdResourceFace(() => {
  const b = workItBoard();
  workIt(b, "fd1");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("stp")] } } as never);
  const asked = b.engine.state.pendingChoice !== undefined && zoneOf(b.engine, b.id("stp")) === "hand";
  const faceDown = zoneOf(b.engine, b.id("stp")) === "play" && b.engine.state.cards[b.id("stp")].faceDown === true;
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to say face-up or face-down; the engine put it in play face-up without asking");
}));
clause(PETE, "2:ability:foreman-pete-work-it", "EFFECT: the play must be a card from MY hand: the opponent's hand card is refused", () => {
  const b = workItBoard();
  workIt(b, "fd1");
  refused(() => answerPlay(b, "oppcard"), "a card in the opponent's hand");
  assert.equal(zoneOf(b.engine, b.id("oppcard")), "hand");
  answerPlay(b, "stp"); // control
  assert.equal(zoneOf(b.engine, b.id("stp")), "play");
});
clause(PETE, "2:ability:foreman-pete-work-it", "COST: the pick must be a FACE-DOWN card I control: a face-up resource, the opponent's face-down card, a hand card and Pete himself are refused", () => {
  const b = workItBoard();
  const ready = readyResources(b.engine, P1);
  for (const key of ["up", "oppfd", "stp", "fp"]) {
    refused(() => workIt(b, key), `${key} is not a face-down resource I control`);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(readyResources(b.engine, P1), ready, `${key}: nothing was paid`);
  }
  assert.equal(zoneOf(b.engine, b.id("up")), "play");
  assert.equal(zoneOf(b.engine, b.id("oppfd")), "play");
  workIt(b, "fd1"); // control
  answerPlay(b);
  assert.equal(zoneOf(b.engine, b.id("fd1")), "hand");
});
clause(PETE, "2:ability:foreman-pete-work-it", "COST: a face-down CHARACTER is a face-down resource too: it can be picked and returns to my hand as that character", () => {
  const b = workItBoard();
  workIt(b, "fd2");
  answerPlay(b);
  assert.equal(zoneOf(b.engine, b.id("fd2")), "hand");
  assert.equal(b.engine.state.cards[b.id("fd2")].faceDown ?? false, false);
  assert.equal(zoneOf(b.engine, b.id("fd1")), "play", "the other face-down card stays");
});
clause(PETE, "2:ability:foreman-pete-work-it", "COST: refused when no face-down resource is in play (face-up resources don't count)", () => {
  const b = peteBoard({ rage: 4, vol: 0, extra: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  refused(() => activate(b.engine, P1, b.id("fp"), "foreman-pete-work-it", { selected: {} }), "nothing face-down to pick");
  assert.equal(readyResources(b.engine, P1), 4);
});
clause(PETE, "2:ability:foreman-pete-work-it", "COST: refused when 2 resources can't be paid, works with exactly 2", () => {
  const one = workItBoard({ vol: 1, spentVol: 1, spendFds: true });
  one.engine.state.cards[one.id("up")].attachedTo = one.engine.state.players[P1].factionId!;
  assert.equal(readyResources(one.engine, P1), 1);
  refused(() => workIt(one, "fd1"), "only 1 resource is available");
  assert.equal(zoneOf(one.engine, one.id("fd1")), "play", "refused: the card didn't move");
  const exact = workItBoard({ vol: 2, spentVol: 1, spendFds: true });
  exact.engine.state.cards[exact.id("up")].attachedTo = exact.engine.state.players[P1].factionId!;
  assert.equal(readyResources(exact.engine, P1), 2);
  workIt(exact, "fd1");
  answerPlay(exact);
  assert.equal(zoneOf(exact.engine, exact.id("fd1")), "hand");
});
clause(PETE, "2:ability:foreman-pete-work-it", "needs [V][V]: refused with one Volition icon (and plenty of other resources), works with two", () => {
  const one = peteBoard({ rage: 4, extra: [fdCard("fd1", plainRes("Face Down One"))] });
  refused(() => workIt(one, "fd1"), "1 Volition icon is one short");
  assert.equal(zoneOf(one.engine, one.id("fd1")), "play");
  const two = peteBoard({ rage: 4, extra: [fdCard("fd1", plainRes("Face Down One")), fdCard("fd3", plainRes("Face Down Three"))] });
  workIt(two, "fd1");
  answerPlay(two);
  assert.equal(zoneOf(two.engine, two.id("fd1")), "hand");
});
clause(PETE, "2:ability:foreman-pete-work-it", "'Put that card into YOUR hand': a face-down card I control but the opponent owns comes into MY hand", () => {
  const b = workItBoard({ extra: [fdCard("stolen", plainRes("Stolen Face Down"), P2, P1)] });
  workIt(b, "stolen");
  answerPlay(b);
  assert.ok(handOf(b, P1).includes(b.id("stolen")), "the card is in my (the activating player's) hand");
  assert.ok(!handOf(b, P2).includes(b.id("stolen")), "...not in the opponent's hand");
});

// --- CLOCK OUT -----------------------------------------------------------------------------
const clockOutBoard = (o: PeteOpts & { attached?: CardPlacement[] } = {}) =>
  peteBoard({ ...o, extra: [...(o.attached ?? []), ...(o.extra ?? [])] });
// "Detach a resource" is mandatory EFFECT text: the pick is asked when the ability resolves (not at activation).
const clockOutStart = (b: Board) => activate(b.engine, P1, b.id("fp"), "foreman-pete-clock-out", {});
const answerDetach = (b: Board, det: string) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id(det)] } } as never);
  resolvePendingResponses(b.engine);
};
const clockOut = (b: Board, det?: string) => {
  clockOutStart(b);
  if (det) answerDetach(b, det);
};

clause(PETE, "3:ability:foreman-pete-clock-out", "COST: Foreman Pete is flipped face-down (and stays in play as a resource); EFFECT: the picked resource is detached from my faction", () => {
  const sp = attachAll(volition(3));
  const b = clockOutBoard({ attached: sp });
  assert.equal(attachedNow(b, P1), 3);
  clockOut(b, sp[0].key);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("fp")), "play");
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown, true, "Pete is face-down");
  assert.equal(attachedNow(b, P1), 2, "exactly one resource was detached");
  assert.equal(b.engine.state.cards[b.id(sp[0].key)].attachedTo ?? null, null, "the picked one");
  assert.ok(b.engine.state.cards[b.id(sp[1].key)].attachedTo, "the others stay attached");
  assert.ok(b.engine.state.cards[b.id(sp[2].key)].attachedTo, "b.engine.state.cards[b.id(sp[2].key)].attachedTo");
});
clause(PETE, "3:ability:foreman-pete-clock-out", "EFFECT: a face-up resource can be detached too", () => {
  const sp = attachAll(volition(1));
  const rg = attachedTo(bank("rage", 1)[0]);
  const b = clockOutBoard({ attached: [...sp, rg] });
  clockOut(b, rg.key);
  assert.equal(b.engine.state.cards[b.id(rg.key)].attachedTo ?? null, null);
  assert.ok(b.engine.state.cards[b.id(sp[0].key)].attachedTo, "b.engine.state.cards[b.id(sp[0].key)].attachedTo");
});
clause(PETE, "3:ability:foreman-pete-clock-out", "'Flip this card face-down' is the printed COST: Pete is already face-down when the ability goes on the stack", () => {
  const sp = attachAll(volition(2));
  const b = clockOutBoard({ attached: sp });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("fp"), abilityId: "foreman-pete-clock-out", selected: { det: [b.id(sp[0].key)] }, variables: {} } as never);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent has priority to respond");
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown, true, "COST: Pete is face-down before the opponent can respond");
});
clause(PETE, "3:ability:foreman-pete-clock-out", "'Detach a resource' is mandatory: an activation without a pick still detaches one", () => {
  const sp = attachAll(volition(3));
  const b = clockOutBoard({ attached: sp });
  clockOut(b);
  assert.equal(b.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "with resources attached I must detach one: the pick is asked");
  assert.equal(attachedNow(b, P1), 3, "nothing is detached before I answer");
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "declining the pick is not allowed: the detach is mandatory");
  answerDetach(b, sp[0].key);
  assert.equal(attachedNow(b, P1), 2, "exactly one resource was detached");
});
clause(PETE, "3:ability:foreman-pete-clock-out", "only a resource ATTACHED to my faction can be picked to detach: an unattached resource is refused", () => {
  const sp = attachAll(volition(1));
  const free = bank("rage", 2);
  const b = clockOutBoard({ attached: sp, extra: free });
  clockOutStart(b);
  refused(() => answerDetach(b, free[0].key), "an unattached resource is not attached to my faction");
  assert.equal(attachedNow(b, P1), 1, "refused: nothing was detached");
  answerDetach(b, sp[0].key); // control
  assert.equal(attachedNow(b, P1), 0);
});
clause(PETE, "3:ability:foreman-pete-clock-out", "EFFECT: it must be MY faction's resource: the opponent's attached resource is refused and stays attached", () => {
  const sp = attachAll(volition(1));
  const theirs = attachedTo(bank("rage", 1, P2)[0], P2);
  const b = clockOutBoard({ attached: sp, extra: [theirs] });
  clockOutStart(b);
  refused(() => answerDetach(b, theirs.key), "the opponent's resource");
  assert.ok(b.engine.state.cards[b.id(theirs.key)].attachedTo, "b.engine.state.cards[b.id(theirs.key)].attachedTo");
  answerDetach(b, sp[0].key); // control
  assert.ok(b.engine.state.cards[b.id(theirs.key)].attachedTo, "still attached after the control run");
  assert.equal(attachedNow(b, P2), 1);
});
clause(PETE, "3:ability:foreman-pete-clock-out", "with nothing attached the ability still works: Pete is flipped and no resource is lost", () => {
  const b = clockOutBoard({ vol: 2 });
  assert.equal(attachedNow(b, P1), 0);
  clockOut(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown, true);
  assert.equal(attachedNow(b, P1), 0);
});
clause(PETE, "3:ability:foreman-pete-clock-out", "needs [V]: refused with no Volition icon (only face-up Rage), works with one", () => {
  const rg = attachedTo(bank("rage", 2)[0]);
  const none = clockOutBoard({ attached: [rg], rage: 2 });
  refused(() => clockOut(none, rg.key), "no Volition icon");
  assert.equal(none.engine.state.cards[none.id("fp")].faceDown ?? false, false);
  const sp = attachAll(volition(1));
  const ok = clockOutBoard({ attached: sp });
  clockOut(ok, sp[0].key);
  assert.equal(ok.engine.state.cards[ok.id("fp")].faceDown, true);
});
clause(PETE, "3:ability:foreman-pete-clock-out", "'under its owner's control': Pete owned by the opponent but controlled by me ends up face-down under the OPPONENT's control", () => {
  const sp = attachAll(volition(2));
  const b = clockOutBoard({ attached: sp, peteOwner: P2, peteController: P1 });
  assert.equal(b.engine.state.cards[b.id("fp")].controllerId, P1, "control: I control it first");
  clockOut(b, sp[0].key);
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("fp")].controllerId, P2, "face-down under its owner's control");
});
clause(PETE, "3:ability:foreman-pete-clock-out", "flipped face-down Pete is a plain resource: it gives a Volition icon and loses its abilities", () => {
  const sp = attachAll(volition(3));
  const b = clockOutBoard({
    attached: sp,
    hand: [thrCard("A", "vvvv"), inHand("stp", stapleRes("Staple"))]
  });
  deployRefused(b, "A", "3 Volition icons are one short of [V][V][V][V]");
  clockOut(b, sp[0].key);
  assert.equal(b.engine.state.cards[b.id("fp")].faceDown, true);
  deployOk(b, "A");
  const csp = attachAll(volition(2));
  const c = clockOutBoard({ attached: csp, vol: 1, hand: [inHand("stp", stapleRes("Staple"))] });
  clockOut(c, csp[0].key);
  refused(() => clockIn(c, "stp"), "a face-down card has no rules text: Clock In is gone");
});

// ===================================================================================
// Time to Retire
// ===================================================================================
const TTR = "71389741-e470-4ab1-81b1-2629192813a2";

type TtrOpts = { vol?: number; rage?: number; spentVol?: number; noChars?: boolean; hand?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId; turn?: number; ttrZone?: "hand" | "faceDown" };
function ttrBoard(o: TtrOpts = {}): Board {
  const ttr: CardPlacement =
    o.ttrZone === "faceDown" ? { key: "ttr", def: printing(TTR), owner: P1, zone: "play", faceDown: true } : { key: "ttr", def: printing(TTR), owner: P1, zone: "hand" };
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      ttr,
      ...(o.noChars ? [] : [{ key: "c1", def: character({ name: "Mine One", cost: 0 }), owner: P1, zone: "play" as const }, { key: "c2", def: character({ name: "Mine Two", cost: 0 }), owner: P1, zone: "play" as const }]),
      { key: "oc", def: character({ name: "Theirs", cost: 0 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "An Item", cost: 0 }), owner: P1, zone: "play" },
      { key: "rg", def: plainRes("Rage Res"), owner: P1, zone: "play" },
      { key: "orr", def: plainRes("Their Res"), owner: P2, zone: "play" },
      ...volition(o.vol ?? 2),
      ...attachAll(volition(o.spentVol ?? 0)),
      ...bank("rage", o.rage ?? 0),
      ...fillers("pd", 6, P1, "deck"),
      ...fillers("od", 6, P2, "deck"),
      ...(o.hand ?? []),
      ...(o.extra ?? [])
    ]
  });
}
const ttrPlay = (b: Board, ch: string) => play(b.engine, P1, b.id("ttr"), { selected: { ch: [b.id(ch)] } });
const answerRes = (b: Board, res?: string) => {
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the 'you may put a resource into its owner's hand' prompt");
  assert.equal(pc?.playerId, P1);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: res ? [b.id(res)] : [] } } as never);
  resolvePendingResponses(b.engine);
};

clause(TTR, "0:ability", "EXTRA COST: pick a character I control; the tactic costs 2; EFFECT: the picked character is flipped face-down (declining the resource keeps everything else)", () => {
  const b = ttrBoard();
  const ready = readyResources(b.engine, P1);
  ttrPlay(b, "c1");
  assert.equal(ready - readyResources(b.engine, P1), 2, "pays exactly 2");
  answerRes(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play", "the character stays in play");
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true, "...face-down");
  assert.equal(b.engine.state.cards[b.id("c2")].faceDown ?? false, false, "my other character is unchanged");
  assert.equal(b.engine.state.cards[b.id("oc")].faceDown ?? false, false, "the opponent's character is unchanged");
  assert.equal(zoneOf(b.engine, b.id("rg")), "play", "declined: the resource stays");
  assert.equal(zoneOf(b.engine, b.id("ttr")), "discard", "the tactic is spent");
  assert.equal(b.engine.state.cards[b.id("c1")].controllerId, P1);
});
clause(TTR, "0:ability", "EFFECT: the other character can be the one picked", () => {
  const b = ttrBoard();
  ttrPlay(b, "c2");
  answerRes(b);
  assert.equal(b.engine.state.cards[b.id("c2")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown ?? false, false);
});
clause(TTR, "0:ability", "EFFECT: 'you may put a resource you control into its owner's hand': accepted, the resource goes to my hand and the character is still flipped", () => {
  const b = ttrBoard();
  ttrPlay(b, "c1");
  answerRes(b, "rg");
  assert.equal(zoneOf(b.engine, b.id("rg")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("rg")), "handOf(b, P1).includes(b.id(\"rg\"))");
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("orr")), "play", "the opponent's resource stays");
});
clause(TTR, "0:ability", "EFFECT: the resource can be face-down, or attached to my faction (spent); a face-down one returns to hand face-up", () => {
  const sp = attachAll(volition(1));
  const b = ttrBoard({ extra: sp });
  ttrPlay(b, "c1");
  answerRes(b, sp[0].key);
  assert.equal(zoneOf(b.engine, b.id(sp[0].key)), "hand");
  assert.equal(b.engine.state.cards[b.id(sp[0].key)].faceDown ?? false, false);
  const vol = volition(1);
  const c = ttrBoard({ extra: vol });
  ttrPlay(c, "c1");
  answerRes(c, vol[0].key);
  assert.equal(zoneOf(c.engine, c.id(vol[0].key)), "hand");
});
clause(TTR, "0:ability", "EFFECT: only a RESOURCE I control may be put into hand: the opponent's resource, my characters, my items and the picked character are refused", () => {
  const b = ttrBoard();
  ttrPlay(b, "c1");
  for (const key of ["orr", "c2", "itm", "c1", "oc"]) {
    refused(() => answerRes(b, key), `${key} is not a resource I control`);
    assert.equal(zoneOf(b.engine, b.id(key)), "play");
  }
  answerRes(b, "rg"); // control
  assert.equal(zoneOf(b.engine, b.id("rg")), "hand");
});
clause(TTR, "0:ability", "EFFECT: 'its owner's hand': a resource I control but the opponent owns goes to the OPPONENT's hand", () => {
  const b = ttrBoard({ extra: [{ key: "stolen", def: plainRes("Stolen Res"), owner: P2, controller: P1, zone: "play" }] });
  ttrPlay(b, "c1");
  answerRes(b, "stolen");
  assert.ok(handOf(b, P2).includes(b.id("stolen")), "in its owner's hand");
  assert.ok(!handOf(b, P1).includes(b.id("stolen")), "not mine");
});
clause(TTR, "0:ability", "EFFECT: 'under its owner's control': a character I control but the opponent owns ends up face-down under the OPPONENT's control", () => {
  const b = ttrBoard({ extra: [{ key: "stolenChar", def: character({ name: "Stolen Char", cost: 0 }), owner: P2, controller: P1, zone: "play" }] });
  assert.equal(b.engine.state.cards[b.id("stolenChar")].controllerId, P1, "control: I control it");
  ttrPlay(b, "stolenChar");
  answerRes(b);
  assert.equal(b.engine.state.cards[b.id("stolenChar")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("stolenChar")].controllerId, P2, "face-down under its owner's control");
});
clause(TTR, "0:ability", "EXTRA COST: the pick must be a character I control: the opponent's character, an item, a resource and a hand card are refused", () => {
  const b = ttrBoard({ hand: [{ key: "hc", def: character({ name: "Hand Char", cost: 0 }), owner: P1, zone: "hand" }] });
  const ready = readyResources(b.engine, P1);
  for (const key of ["oc", "itm", "rg", "hc"]) {
    refused(() => ttrPlay(b, key), `${key} is not a character I control`);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(readyResources(b.engine, P1), ready, `${key}: nothing was paid`);
    assert.equal(zoneOf(b.engine, b.id("ttr")), "hand");
  }
  ttrPlay(b, "c1"); // control
  answerRes(b);
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true);
});
clause(TTR, "0:ability", "EXTRA COST: a face-down card is a resource, not a character, so it can't be the pick", () => {
  const b = ttrBoard({ extra: [fdCard("fdc", character({ name: "Hidden Char", cost: 0 }))] });
  refused(() => ttrPlay(b, "fdc"), "a face-down character is just a resource");
  assert.equal(zoneOf(b.engine, b.id("ttr")), "hand");
});
clause(TTR, "0:ability", "EXTRA COST: refused when I control no character at all", () => {
  const b = ttrBoard({ noChars: true });
  refused(() => ttrPlay(b, "oc"), "only the opponent has a character");
  refused(() => play(b.engine, P1, b.id("ttr"), { selected: {} }), "no character to pick");
  assert.equal(zoneOf(b.engine, b.id("ttr")), "hand");
});
clause(TTR, "0:ability", "costs exactly 2 and needs [V]: refused one resource short or without a Volition icon, plays with exactly 2", () => {
  const spendRg = (b: Board) => {
    b.engine.state.cards[b.id("rg")].attachedTo = b.engine.state.players[P1].factionId!;
  };
  const short = ttrBoard({ vol: 1 });
  spendRg(short);
  assert.equal(readyResources(short.engine, P1), 1);
  refused(() => ttrPlay(short, "c1"), "one resource short of 2");
  assert.equal(zoneOf(short.engine, short.id("ttr")), "hand");
  const noIcon = ttrBoard({ vol: 0, rage: 3 });
  spendRg(noIcon);
  assert.equal(readyResources(noIcon.engine, P1), 3);
  refused(() => ttrPlay(noIcon, "c1"), "no Volition icon for [V]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ttr")), "hand");
  const exact = ttrBoard({ vol: 1, rage: 1 });
  spendRg(exact);
  assert.equal(readyResources(exact.engine, P1), 2, "one Volition icon is enough for [V]");
  ttrPlay(exact, "c1");
  answerRes(exact);
  assert.equal(readyResources(exact.engine, P1), 1, "paid exactly 2 (the 1 left is the character that was just flipped face-down: a new resource)");
  assert.equal(zoneOf(exact.engine, exact.id("ttr")), "discard");
});
clause(TTR, "0:ability", "a tactic can be played in response to the opponent's action (it flips my character then)", () => {
  const ping = item({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "ping", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const b = ttrBoard({ turn: 2, active: P2, extra: [{ key: "ping", def: ping, owner: P2, zone: "play" }] });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("ping"), abilityId: "ping", selected: {}, variables: {} } as never);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ttr"), selected: { ch: [b.id("c1")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  answerRes(b);
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("ttr")), "discard");
});

// --- FLIP UP: 2 [V] ---------------------------------------------------------------------------
const flipUpTtr = (b: Board, ch?: string) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("ttr"), selected: ch ? { ch: [b.id(ch)] } : {}, variables: {} });

clause(TTR, "1:flipUp", "FLIP UP 2 [V]: a face-down Time to Retire in play flips up for 2 and then resolves (the picked character is flipped face-down, the tactic is spent)", () => {
  const b = ttrBoard({ ttrZone: "faceDown" });
  assert.equal(b.engine.state.cards[b.id("ttr")].faceDown, true);
  flipUpTtr(b, "c1");
  resolvePendingResponses(b.engine);
  answerRes(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true, "the picked character was flipped face-down");
  assert.equal(zoneOf(b.engine, b.id("ttr")), "discard", "the flipped-up tactic is spent");
  assert.equal(b.engine.state.cards[b.id("c2")].faceDown ?? false, false);
});
clause(TTR, "1:flipUp", "FLIP UP: the optional resource return works the same way", () => {
  const b = ttrBoard({ ttrZone: "faceDown" });
  flipUpTtr(b, "c1");
  resolvePendingResponses(b.engine);
  answerRes(b, "rg");
  assert.equal(zoneOf(b.engine, b.id("rg")), "hand");
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true);
});
clause(TTR, "1:flipUp", "FLIP UP is refused when the 2 can't be paid (one resource short), works with exactly 2", () => {
  const mk = (ready: number) => {
    const b = ttrBoard({ ttrZone: "faceDown", vol: 3, spentVol: 0 });
    // leave exactly `ready` resources ready: the face-down Time to Retire itself is one of them
    const ids = b.engine.state.players[P1].play.filter(id => b.engine.isResource(id) && id !== b.id("ttr") && !b.engine.state.cards[id].attachedTo);
    const factionId = b.engine.state.players[P1].factionId!;
    for (const id of ids.slice(0, ids.length - (ready - 1))) b.engine.state.cards[id].attachedTo = factionId;
    return b;
  };
  const short = mk(1);
  assert.equal(readyResources(short.engine, P1), 1);
  refused(() => flipUpTtr(short, "c1"), "only 1 resource is ready");
  assert.equal(short.engine.state.cards[short.id("ttr")].faceDown, true, "still face-down");
  const exact = mk(2);
  assert.equal(readyResources(exact.engine, P1), 2);
  flipUpTtr(exact, "c1");
  resolvePendingResponses(exact.engine);
  answerRes(exact);
  assert.equal(zoneOf(exact.engine, exact.id("ttr")), "discard");
});
clause(TTR, "1:flipUp", "FLIP UP [V] is met by a Volition icon from other face-down resources: with them it flips up", () => {
  const ok = ttrBoard({ ttrZone: "faceDown", vol: 1, rage: 3 });
  flipUpTtr(ok, "c1");
  resolvePendingResponses(ok.engine);
  answerRes(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ttr")), "discard");
  assert.equal(ok.engine.state.cards[ok.id("c1")].faceDown, true);
});
clause(TTR, "1:flipUp", "FLIP UP [V]: the face-down card's OWN Volition icon is counted toward its threshold", () => {
  const none = ttrBoard({ ttrZone: "faceDown", vol: 0, rage: 3 });
  none.engine.state.cards[none.id("rg")].attachedTo = none.engine.state.players[P1].factionId!;
  refused(() => flipUpTtr(none, "c1"), "no Volition icon besides the card itself, which is face-up (and played 'as though from hand') once flipped");
  assert.equal(none.engine.state.cards[none.id("ttr")].faceDown, true);
});
clause(TTR, "1:flipUp", "FLIP UP keeps the extra cost: a character I control must be picked (refused for the opponent's character or with none)", () => {
  const b = ttrBoard({ ttrZone: "faceDown" });
  refused(() => flipUpTtr(b, "oc"), "the opponent's character");
  refused(() => flipUpTtr(b), "no pick");
  assert.equal(b.engine.state.cards[b.id("ttr")].faceDown, true);
  const none = ttrBoard({ ttrZone: "faceDown", noChars: true });
  refused(() => flipUpTtr(none, "oc"), "I control no character");
});
clause(TTR, "1:flipUp", "FLIP UP is a tactic: it may be flipped up in response to the opponent's action", () => {
  const ping = item({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "ping", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const b = ttrBoard({ ttrZone: "faceDown", turn: 2, active: P2, extra: [{ key: "ping", def: ping, owner: P2, zone: "play" }] });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("ping"), abilityId: "ping", selected: {}, variables: {} } as never);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  flipUpTtr(b, "c1");
  resolvePendingResponses(b.engine);
  answerRes(b);
  assert.equal(b.engine.state.cards[b.id("c1")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("ttr")), "discard");
});

// ===================================================================================
// 6r4wny 60dy9u4rd5
// ===================================================================================
const BG = "8007e216-d21d-490c-ad3e-eae9677ee725";

const zapTactic = (n: number) =>
  tactic({
    name: "Zap",
    cost: 0,
    behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }] }
  } as never);
const exileTactic = () =>
  tactic({
    name: "Exile",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  } as never);

type BgOpts = { rage?: number; greed?: number; extra?: CardPlacement[] };
function bgBoard(o: BgOpts = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "bg", def: printing(BG), owner: P1, zone: "hand" },
      { key: "ward", def: character({ name: "Ward", cost: 0, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 0, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "oc", def: character({ name: "Their Blocker", cost: 0, strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "An Item", cost: 0 }), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 5),
      ...bank("greed", o.greed ?? 0),
      ...fillers("pd", 4, P1, "deck"),
      ...fillers("od", 4, P2, "deck"),
      { key: "zap2", def: zapTactic(2), owner: P1, zone: "hand" },
      { key: "zap3", def: zapTactic(3), owner: P1, zone: "hand" },
      { key: "zap5", def: zapTactic(5), owner: P1, zone: "hand" },
      { key: "kill", def: tactic({ name: "Kill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } } as never), owner: P1, zone: "hand" },
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } } as never), owner: P1, zone: "hand" },
      { key: "exile", def: exileTactic(), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}
/** Deploy 6r4wny picking `ward` as the character to protect. */
function bgDeployed(o: BgOpts = {}): Board {
  const b = bgBoard(o);
  play(b.engine, P1, b.id("bg"), { selected: { ward: [b.id("ward")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("bg")), "play", "control: 6r4wny is in play");
  return b;
}
const dmg = (b: Board, key: string) => b.engine.state.cards[b.id(key)].damage ?? 0;

clause(BG, "0:ability", "EXTRA COST: pick a character I control; 6r4wny deploys for 5 with [R][R] and has printed stats 3 / 3 / 5", () => {
  const b = bgBoard();
  const ready = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("bg"), { selected: { ward: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("bg")), "play");
  assert.equal(ready - readyResources(b.engine, P1), 5, "pays exactly 5");
  assert.deepEqual([b.engine.getStat(b.id("bg"), "strength"), b.engine.getStat(b.id("bg"), "speed"), b.engine.getStat(b.id("bg"), "life")], [3, 3, 5]);
  assert.equal(b.engine.state.cards[b.id("ward")].faceDown ?? false, false, "the picked character is not otherwise changed");
});
clause(BG, "0:ability", "EXTRA COST: either of my characters can be the pick", () => {
  const b = bgBoard();
  play(b.engine, P1, b.id("bg"), { selected: { ward: [b.id("other")] } });
  assert.equal(zoneOf(b.engine, b.id("bg")), "play");
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("other")] } });
  assert.equal(dmg(b, "other"), 0, "the picked 'other' is protected");
  assert.equal(dmg(b, "bg"), 2);
});
clause(BG, "0:ability", "EXTRA COST: the pick must be a character I control: the opponent's character and an item are refused", () => {
  const b = bgBoard();
  const ready = readyResources(b.engine, P1);
  for (const key of ["oc", "itm"]) {
    refused(() => playRaw(b.engine, P1, b.id("bg"), { selected: { ward: [b.id(key)] } }), `${key} is not a character I control`);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id("bg")), "hand");
    assert.equal(readyResources(b.engine, P1), ready, `${key}: nothing was paid`);
  }
  play(b.engine, P1, b.id("bg"), { selected: { ward: [b.id("ward")] } }); // control
  assert.equal(zoneOf(b.engine, b.id("bg")), "play");
});
clause(BG, "0:ability", "EXTRA COST: refused when I control no character to pick", () => {
  const c = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "bg", def: printing(BG), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "Their Blocker", cost: 0 }), owner: P2, zone: "play" },
      ...bank("rage", 5)
    ]
  });
  refused(() => playRaw(c.engine, P1, c.id("bg"), { selected: {} }), "no pick at all");
  refused(() => playRaw(c.engine, P1, c.id("bg"), { selected: { ward: [c.id("oc")] } }), "only the opponent's character");
  assert.equal(zoneOf(c.engine, c.id("bg")), "hand");
});
clause(BG, "0:ability", "6r4wny costs 5 and needs [R][R]: refused one resource short or without Rage icons", () => {
  const short = bgBoard({ rage: 4 });
  refused(() => playRaw(short.engine, P1, short.id("bg"), { selected: { ward: [short.id("ward")] } }), "4 resources are one short");
  assert.equal(zoneOf(short.engine, short.id("bg")), "hand");
  const noIcon = bgBoard({ rage: 0, greed: 6 });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("bg"), { selected: { ward: [noIcon.id("ward")] } }), "plenty of resources but no Rage icon");
  const oneIcon = bgBoard({ rage: 1, greed: 5 });
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("bg"), { selected: { ward: [oneIcon.id("ward")] } }), "only one Rage icon");
  const ok = bgBoard({ rage: 2, greed: 3 });
  play(ok.engine, P1, ok.id("bg"), { selected: { ward: [ok.id("ward")] } });
  assert.equal(zoneOf(ok.engine, ok.id("bg")), "play");
});

clause(BG, "1:rule", "damage that would be dealt to the picked character is dealt to 6r4wny instead (effect damage: the ward takes none)", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("ward")] } });
  assert.equal(dmg(b, "ward"), 0, "the picked character is not damaged");
  assert.equal(dmg(b, "bg"), 2, "6r4wny takes the 2");
  assert.equal(zoneOf(b.engine, b.id("ward")), "play");
});
clause(BG, "1:rule", "...even damage that would kill the picked character (3 on a life-3 ward): it survives, 6r4wny takes all 3", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("zap3"), { selected: { t: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("ward")), "play");
  assert.equal(dmg(b, "ward"), 0);
  assert.equal(dmg(b, "bg"), 3);
  assert.equal(zoneOf(b.engine, b.id("bg")), "play", "life 5 survives 3");
});
clause(BG, "1:rule", "...and if the redirected damage kills 6r4wny (5 on life 5) it is destroyed while the picked character is untouched", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("zap5"), { selected: { t: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("ward")), "play");
  assert.equal(dmg(b, "ward"), 0);
  assert.equal(zoneOf(b.engine, b.id("bg")), "discard", "6r4wny took lethal damage instead");
});
clause(BG, "1:rule", "battle damage too: a blocker striking the picked character hits 6r4wny instead", () => {
  const b = bgDeployed();
  fightThrough(b.engine, P1, [b.id("ward")], { type: "faction", playerId: P2 }, [b.id("oc")]);
  assert.equal(dmg(b, "ward"), 0, "the ward took none of the blocker's 2");
  assert.equal(dmg(b, "bg"), 2, "6r4wny took it");
  assert.equal(dmg(b, "oc"), 1, "control: the ward still dealt its own 1 to the blocker");
});
clause(BG, "1:rule", "only the PICKED character is covered: damage to my other character, the opponent's character, and 6r4wny itself is normal", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("other")] } });
  assert.equal(dmg(b, "other"), 2, "my other character takes its own damage");
  assert.equal(dmg(b, "bg"), 0);
  play(b.engine, P1, b.id("zap3"), { selected: { t: [b.id("oc")] } });
  assert.equal(dmg(b, "oc"), 3, "the opponent's character takes its own damage");
  assert.equal(dmg(b, "bg"), 0);
  const c = bgDeployed();
  play(c.engine, P1, c.id("zap2"), { selected: { t: [c.id("bg")] } });
  assert.equal(dmg(c, "bg"), 2, "6r4wny takes damage aimed at it once");
  assert.equal(dmg(c, "ward"), 0);
});
clause(BG, "1:rule", "the damage rule is off before 6r4wny is deployed and again after it leaves play", () => {
  const b = bgBoard();
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("ward")] } });
  assert.equal(dmg(b, "ward"), 2, "not deployed yet: the ward takes its own damage");
  const c = bgDeployed();
  play(c.engine, P1, c.id("kill"), { selected: { t: [c.id("bg")] } });
  assert.equal(zoneOf(c.engine, c.id("bg")), "discard", "control: 6r4wny was destroyed");
  play(c.engine, P1, c.id("zap2"), { selected: { t: [c.id("ward")] } });
  assert.equal(dmg(c, "ward"), 2, "after it left play the ward is dealt damage normally");
});
clause(BG, "1:rule", "if the picked character would be destroyed, 6r4wny is destroyed in that way instead", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("ward")), "play", "the picked character survives");
  assert.equal(zoneOf(b.engine, b.id("bg")), "discard", "6r4wny is destroyed instead");
});
clause(BG, "1:rule", "if the picked character would return to hand, 6r4wny returns to hand instead", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("ward")), "play", "the picked character stays");
  assert.equal(zoneOf(b.engine, b.id("bg")), "hand", "6r4wny leaves play in that way (to its owner's hand)");
  assert.ok(handOf(b, P1).includes(b.id("bg")), "handOf(b, P1).includes(b.id(\"bg\"))");
});
clause(BG, "1:rule", "if the picked character would be removed from the game, 6r4wny is removed instead", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("exile"), { selected: { t: [b.id("ward")] } });
  assert.equal(zoneOf(b.engine, b.id("ward")), "play", "the picked character stays");
  assert.notEqual(zoneOf(b.engine, b.id("bg")), "play", "6r4wny left play");
  assert.notEqual(zoneOf(b.engine, b.id("bg")), "discard", "...by being removed from the game, not destroyed");
});
clause(BG, "1:rule", "leaving play is only redirected for the picked character: destroying/bouncing my other character just does that", () => {
  const b = bgDeployed();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("other")] } });
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bg")), "play");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("oc")] } });
  assert.equal(zoneOf(b.engine, b.id("oc")), "hand", "the opponent's character is bounced normally");
  assert.equal(zoneOf(b.engine, b.id("bg")), "play");
});
