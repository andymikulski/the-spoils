// E7b: the numeric cost is ONE running total (CR 406.3): the cost number plus every "pay N" extra cost, then every
// increase, then every reduction ("reduce the next numeric cost you pay", cost modifiers, taxes), floored at 0
// (CR 406.6) and with "to a minimum of N" not raising a value already below N (CR 410.5). These tests drive synthetic
// cards through the mechanism; the printed cards have their own clause tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import type { SpoilsEngine } from "../../engine.js";

type AnyDef = ReturnType<typeof character>;

const ready = (engine: SpoilsEngine, player = P1) => engine.getAvailableResourceCount(player);
const resources = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));
const reduceNext = (amount: number, extra: Record<string, unknown> = {}) => ({ type: "reduceNextCost", player: "controller", amount, ...extra });
const playCard = (engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
const activate = (engine: SpoilsEngine, player: string, cardId: string, abilityId = "go", extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, ...extra } as never);

function withAbility(name: string, costs: unknown[], over: Partial<AnyDef> = {}): AnyDef {
  return character({
    name,
    strength: 2,
    life: 3,
    ...over,
    behavior: { abilities: [{ id: "go", type: "activated", costs, effects: [] }] } as never
  });
}

function pendingReductions(engine: SpoilsEngine): number {
  return engine.state.costReductions.reduce((n, r) => n + r.amount, 0);
}

describe("E7b — one running numeric cost", () => {
  test("cost number + extra 'pay N' - reduction, as one total (each pay floored at 0 on its own)", () => {
    const heavy = tactic({
      name: "Heavy",
      cost: 2,
      behavior: { abilities: [{ id: "b", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [] }] } as never
    });
    const { engine, id } = buildGame({
      cards: [{ key: "h", def: heavy, owner: P1, zone: "hand" }, ...resources(8)]
    });
    engine.state.costReductions.push({ id: "red", playerId: P1, amount: 4, createdTurn: engine.state.turn });
    const before = ready(engine);
    playCard(engine, P1, id("h"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine), 1, "2 + 3 - 4");
    assert.equal(pendingReductions(engine), 0, "used up");
  });

  test("an ability's 'pay N' takes the pending reduction and uses it up; a depleting-only ability does not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pay", def: withAbility("Pay", [{ type: "payResources", amount: 3 }]), owner: P1 },
        { key: "free", def: withAbility("Free", [{ type: "deplete", target: "source" }]), owner: P1 },
        ...resources(6)
      ]
    });
    engine.state.costReductions.push({ id: "red", playerId: P1, amount: 2, createdTurn: engine.state.turn });
    activate(engine, P1, id("free"));
    resolvePendingResponses(engine);
    assert.equal(pendingReductions(engine), 2, "no numeric cost paid: nothing used up");
    const before = ready(engine);
    activate(engine, P1, id("pay"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine), 1, "3 - 2");
    assert.equal(pendingReductions(engine), 0);
  });

  test("'the next CARD you play' (cardsOnly) never reaches an ability; a card-type reduction reaches an ability only when it says so", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pay", def: withAbility("Pay", [{ type: "payResources", amount: 3 }]), owner: P1 },
        { key: "thing", def: item({ name: "Thing", behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [] }] } as never }), owner: P1 },
        ...resources(9)
      ]
    });
    engine.state.costReductions.push({ id: "cards", playerId: P1, amount: 2, cardsOnly: true, createdTurn: engine.state.turn });
    engine.state.costReductions.push({ id: "item", playerId: P1, amount: 1, cardType: "item", createdTurn: engine.state.turn });
    let before = ready(engine);
    activate(engine, P1, id("pay"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine), 3, "neither reduction reaches a character's ability");
    before = ready(engine);
    activate(engine, P1, id("thing"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine), 3, "an item's ability is still 'not an item' for a reduction that does not say 'item's ability'");
    assert.equal(engine.state.costReductions.length, 2);
    engine.state.costReductions[1].includeAbilities = true;
    engine.state.cards[id("thing")].depleted = false;
    // (the ability has no deplete cost, so it can be used again)
    before = ready(engine);
    activate(engine, P1, id("thing"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine), 2, "with includeAbilities the item reduction reaches the item's ability");
  });

  test("an ability tax creates a cost when the ability printed none, and the pending reduction then reduces it", () => {
    const tax = character({
      name: "Tax",
      behavior: { abilities: [{ id: "t", type: "continuous", modifiers: [], abilityCostModifiers: [{ scope: "opponentCharacters", delta: 2 }] }] } as never
    });
    const { engine, id } = buildGame({
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "tax", def: tax, owner: P1, zone: "play" },
        { key: "free", def: withAbility("Free", []), owner: P2 },
        ...resources(3, P2)
      ]
    });
    assert.equal(
      engine.getAvailableActivatedAbilities(P2).length,
      1,
      "affordable with 3"
    );
    engine.state.costReductions.push({ id: "red", playerId: P2, amount: 1, createdTurn: engine.state.turn });
    const before = ready(engine, P2);
    activate(engine, P2, id("free"));
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine, P2), 1, "the tax of 2 reduced by the pending 1");
    assert.equal(pendingReductions(engine), 0);
  });

  test("the ability list does not offer an ability its tax makes unaffordable", () => {
    const tax = character({
      name: "Tax",
      behavior: { abilities: [{ id: "t", type: "continuous", modifiers: [], abilityCostModifiers: [{ scope: "opponentCharacters", delta: 2 }] }] } as never
    });
    const { engine } = buildGame({
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "tax", def: tax, owner: P1, zone: "play" },
        { key: "free", def: withAbility("Free", []), owner: P2 },
        ...resources(1, P2)
      ]
    });
    assert.deepEqual(engine.getAvailableActivatedAbilities(P2), [], "1 ready resource cannot pay the 2");
  });

  test("'to a minimum of N' on an ability cost does not raise a cost-0 ability (CR 410.5) and stops a reduction at N", () => {
    const market = character({
      name: "Market",
      behavior: { abilities: [{ id: "m", type: "continuous", modifiers: [], abilityCostModifiers: [{ scope: "controlledCharacters", delta: -2, minCost: 1 }] }] } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "market", def: market, owner: P1, zone: "play" },
        { key: "zero", def: withAbility("Zero", []), owner: P1 },
        { key: "three", def: withAbility("Three", [{ type: "payResources", amount: 3 }]), owner: P1 },
        { key: "two", def: withAbility("Two", [{ type: "payResources", amount: 2 }]), owner: P1 },
        ...resources(6)
      ]
    });
    const cost = (key: string): number => {
      const before = ready(engine);
      activate(engine, P1, id(key));
      resolvePendingResponses(engine);
      return before - ready(engine);
    };
    assert.equal(cost("zero"), 0, "a free ability stays free");
    assert.equal(cost("three"), 1, "3 - 2");
    assert.equal(cost("two"), 1, "2 - 2 stops at the minimum of 1");
  });

  test("FLIP UP is a deploy: it takes the pending reduction on its numeric cost and uses it up", () => {
    const flipper = character({
      name: "Flipper",
      cost: 5,
      flipUp: { cost: 3, threshold: "" } as never
    } as never);
    const { engine, id } = buildGame({
      cards: [{ key: "f", def: flipper, owner: P1, zone: "play", faceDown: true }, ...resources(5)]
    });
    engine.state.costReductions.push({ id: "red", playerId: P1, amount: 2, createdTurn: engine.state.turn });
    const before = ready(engine);
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("f"), selected: {}, variables: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("f")].faceDown, false);
    assert.equal(before - ready(engine), 1 + 1, "FLIP UP 3 - 2 = 1 paid, and the card itself stopped being a resource");
    assert.equal(pendingReductions(engine), 0);
  });
});

describe("E7b — 'must pay N to pick' (pickTax)", () => {
  const charm = character({
    name: "Charm",
    behavior: {
      abilities: [{ id: "tax", type: "continuous", modifiers: [], pickTax: [{ affects: "opponent", amount: 1, selector: { type: "character", controller: "self" } }] }]
    } as never
  });
  const hit = tactic({
    name: "Hit",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    } as never
  });

  test("a pick of the taxed character costs the picker 1 on top of a cost-0 tactic; their own characters are free", () => {
    const { engine, id } = buildGame({
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "charm", def: charm, owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
        { key: "hit", def: hit, owner: P2, zone: "hand" },
        { key: "hit2", def: { ...hit, name: "Hit Two" } as never, owner: P2, zone: "hand" },
        ...resources(2, P2)
      ]
    });
    const before = ready(engine, P2);
    playCard(engine, P2, id("hit2"), { selected: { t: [id("foe")] } });
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine, P2), 0, "their own character: nothing to pay");
    playCard(engine, P2, id("hit"), { selected: { t: [id("mine")] } });
    resolvePendingResponses(engine);
    assert.equal(before - ready(engine, P2), 1, "my character: 1");
    assert.equal(engine.state.cards[id("mine")].damage, 1);
  });
});
