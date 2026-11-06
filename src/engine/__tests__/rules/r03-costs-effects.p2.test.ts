// Batch r03-costs-effects, part 2 (docs/TESTING.md): CR 406 Numeric Cost, CR 410 Numbers.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule, ruleOpen } from "./_rule.js";

type AnyDef = CardDefinition;

const sel = (id: string) => ({ type: "selected", id });

/** `n` unattached resources owned by `owner`. */
const ready = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));

/** `n` resources owned by `owner` that are already attached to that player's faction (spent). */
const spent = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `s${owner}${i}`,
    def: resourceCard({ name: `S${owner}${i}` }),
    owner,
    attachedToKey: owner === P1 ? "__factionA" : "__factionB"
  }));

const unattached = (engine: SpoilsEngine, player = P1): number => engine.getAvailableResourceCount(player);

/** How many resources are attached to `player`'s faction right now. */
function attachedCount(engine: SpoilsEngine, player = P1): number {
  const faction = engine.state.players[player].factionId;
  return Object.values(engine.state.cards).filter(card => card.attachedTo === faction && engine.isResource(card.id)).length;
}

const playCard = (engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
const activate = (engine: SpoilsEngine, player: string, cardId: string, abilityId = "go", extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, ...extra } as never);
const answer = (engine: SpoilsEngine, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const influence = (engine: SpoilsEngine, player = P1) => engine.state.players[player].influence;

/** A character with one activated ability `go`. */
function withAbility(name: string, ability: Record<string, unknown>, over: Partial<AnyDef> = {}): AnyDef {
  return character({
    name,
    strength: 2,
    life: 3,
    ...over,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...ability }] } as never
  });
}

/** A tactic whose play source (its first activated ability) has the given fields. */
function spell(name: string, ability: Record<string, unknown>, over: Partial<AnyDef> = {}): AnyDef {
  return tactic({ name, ...over, behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...ability }] } as never });
}

const payCost = (amount: number) => ({ type: "payResources", amount });

/** A tactic that makes "reduce the next numeric cost you pay" of `amount` (no card-type, no card-only restriction). */
const discountTactic = (name: string, amount: number, extra: Record<string, unknown> = {}): AnyDef =>
  spell(name, { effects: [{ type: "reduceNextCost", player: "controller", amount, ...extra }] });

/** A continuous ability that changes the numeric cost of deploys. */
const costModifierCard = (name: string, modifiers: Array<Record<string, unknown>>): AnyDef =>
  character({
    name,
    behavior: { abilities: [{ id: "cm", type: "continuous", modifiers: [], costModifiers: modifiers }] } as never
  });

/** Plays `cardId` as P1 and lets every response window close. */
function castAndResolve(engine: SpoilsEngine, cardId: string, extra: Record<string, unknown> = {}): void {
  playCard(engine, P1, cardId, extra);
  resolvePendingResponses(engine);
}

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 406 — numeric cost", () => {
  rule("CR 406.1", "the numeric cost of a card that is not being played is its cost number, whatever is pending", () => {
    const reader = spell("Reader", {
      targets: [{ id: "c", selector: { owner: "self", zone: "hand" }, count: 1 }],
      costs: [{ type: "bindVariable", id: "x", value: { type: "cardCost", target: sel("c") } }],
      effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 2), owner: P1, zone: "hand" },
        { key: "reader", def: reader, owner: P1, zone: "hand" },
        { key: "big", def: item({ name: "Big", cost: 4 }), owner: P1, zone: "hand" }
      ]
    });
    castAndResolve(engine, id("discount"));
    const before = influence(engine);
    castAndResolve(engine, id("reader"), { selected: { c: [id("big")] } });
    assert.equal(influence(engine) - before, 4, "the card in hand reads as its printed cost number 4 even with a reduction pending");
  });

  rule("CR 406.1", "a card's cost number is what it costs to deploy when nothing modifies it", () => {
    for (const cost of [1, 3, 5]) {
      const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: `Gadget${cost}`, cost }), owner: P1, zone: "hand" }, ...ready(6)] });
      castAndResolve(engine, id("gadget"));
      assert.equal(attachedCount(engine), cost, `cost number ${cost} is paid`);
    }
  });

  rule("CR 406.2", "a card without a cost number has numeric cost 0: it deploys with no resources", () => {
    const noCost = { ...item({ name: "No Cost" }), cost: undefined } as unknown as AnyDef;
    const { engine, id } = buildGame({ cards: [{ key: "n", def: noCost, owner: P1, zone: "hand" }] });
    castAndResolve(engine, id("n"));
    assert.equal(zone(engine, id("n")), "play", "deployed with no resources available");
    assert.equal(attachedCount(engine), 0);
  });

  rule("CR 406.2", "a card without a cost number reads as numeric cost 0 when another card looks at it", () => {
    const reader = spell("Reader", {
      targets: [{ id: "c", selector: { owner: "self", zone: "hand" }, count: 1 }],
      costs: [{ type: "bindVariable", id: "x", value: { type: "cardCost", target: sel("c") } }],
      effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }, { type: "modifyInfluence", player: "controller", amount: 1 }]
    });
    const noCost = { ...item({ name: "No Cost" }), cost: undefined } as unknown as AnyDef;
    const { engine, id } = buildGame({ cards: [{ key: "reader", def: reader, owner: P1, zone: "hand" }, { key: "n", def: noCost, owner: P1, zone: "hand" }] });
    const before = influence(engine);
    castAndResolve(engine, id("reader"), { selected: { c: [id("n")] } });
    assert.equal(influence(engine) - before, 1, "X was 0 (plus the control +1)");
  });

  rule("CR 406.3", "while a card is played its numeric cost starts at its cost number and an extra 'pay' is added to it: cost 2 + pay 3 pays 5", () => {
    const heavy = item({ name: "Heavy", cost: 2, behavior: { onPlay: { costs: [payCost(3)] } } as never });
    const rich = buildGame({ cards: [{ key: "h", def: heavy, owner: P1, zone: "hand" }, ...ready(6)] });
    castAndResolve(rich.engine, rich.id("h"));
    assert.equal(attachedCount(rich.engine), 5, "2 + 3 resources attached");
    const short = buildGame({ cards: [{ key: "h", def: heavy, owner: P1, zone: "hand" }, ...ready(4)] });
    refused(() => playCard(short.engine, P1, short.id("h")), "total 5 with 4 resources");
    assert.equal(zone(short.engine, short.id("h")), "hand");
  });

  rule("CR 406.3", "an extra 'pay' is not paid on its own: a reduction applies to the running total, not just to the cost number", () => {
    // cost 1 + pay 2 = 3; a reduction of 3 brings the total to 0. (If it only reduced the cost number: 0 + 2 = 2.)
    const heavy = item({ name: "Heavy", cost: 1, behavior: { onPlay: { costs: [payCost(2)] } } as never });
    const { engine, id } = buildGame({
      cards: [{ key: "discount", def: discountTactic("Discount", 3), owner: P1, zone: "hand" }, { key: "h", def: heavy, owner: P1, zone: "hand" }, ...ready(4)]
    });
    castAndResolve(engine, id("discount"));
    castAndResolve(engine, id("h"));
    assert.equal(zone(engine, id("h")), "play");
    assert.equal(attachedCount(engine), 0, "(1 + 2) - 3 = 0 resources paid");
  });

  rule("CR 406.3", "increases are applied before reductions: a cost-0 card taxed +2 and reduced by 1 costs 1, not 2", () => {
    const tax = costModifierCard("Tax", [{ affects: "controller", delta: 2 }]);
    const { engine, id } = buildGame({
      cards: [
        { key: "tax", def: tax, owner: P1 },
        { key: "discount", def: discountTactic("Discount", 1), owner: P1, zone: "hand" },
        { key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("discount"));
    const base = attachedCount(engine);
    castAndResolve(engine, id("gadget"));
    assert.equal(zone(engine, id("gadget")), "play");
    assert.equal(attachedCount(engine) - base, 1, "0 + 2 - 1 = 1 (not max(0, 0 - 1) + 2 = 2)");
  });

  rule("CR 406.3", "several increases are all applied: two +1 taxes on a cost-2 card make it cost 4", () => {
    const taxA = costModifierCard("Tax A", [{ affects: "controller", delta: 1 }]);
    const taxB = costModifierCard("Tax B", [{ affects: "controller", delta: 1 }]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: taxA, owner: P1 },
        { key: "b", def: taxB, owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 4, "2 + 1 + 1");
  });

  rule("CR 406.3", "several reductions are all applied: two -1 reductions pending for the same next cost make a cost-3 card cost 1", () => {
    const twoDiscounts = spell("Two Discounts", {
      effects: [
        { type: "reduceNextCost", player: "controller", amount: 1 },
        { type: "reduceNextCost", player: "controller", amount: 1 }
      ]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "two", def: twoDiscounts, owner: P1, zone: "hand" },
        { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("two"));
    assert.equal(engine.state.costReductions.length, 2, "setup: two reductions are pending");
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 1, "3 - 1 - 1");
  });

  rule("CR 406.3", "reductions may be applied in any order: the player gets the lower total when a 'to a minimum' reduction and a plain one interact", () => {
    // cost 3; reduce by 2 to a minimum of 2, and reduce by 1. Order (plain, then min): 3-1=2, 2-2 stops at 2 => 2.
    // Order (min, then plain): 3-2 stops at 2? (3-2=1 stops at the minimum 2) => 2, 2-1 = 1 => 1. The player picks the order, so 1.
    const market = costModifierCard("Market", [{ affects: "controller", delta: -2, minCost: 2 }]);
    const { engine, id } = buildGame({
      cards: [
        { key: "market", def: market, owner: P1 },
        { key: "discount", def: discountTactic("Discount", 1), owner: P1, zone: "hand" },
        { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("discount"));
    const base = attachedCount(engine);
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine) - base, 1, "the best order for the player: 3 - 2 (stopping at 2... then 1 more) = 1");
  });

  rule(["CR 406.3", "CR 406.3a"], "the numeric cost is paid last: after the other extra costs are satisfied (a discard cost that cannot be met leaves the resources unspent)", () => {
    const strike = spell("Strike", { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }], effects: [] }, { cost: 2 });
    const { engine, id } = buildGame({ cards: [{ key: "strike", def: strike, owner: P1, zone: "hand" }, ...ready(3)] });
    refused(() => playCard(engine, P1, id("strike"), { selected: { d: [] } }), "a discard cost with an empty hand");
    assert.equal(attachedCount(engine), 0, "the 2 resources were not paid before the failing step");
  });

  rule("CR 406.3a", "numeric costs are always paid last: a resource given up by another cost cannot also pay the numeric cost", () => {
    const ram = spell("Ram", { costs: [{ type: "moveSelected", id: "m", player: "controller", selector: { type: "resource" }, count: 1, to: "discard" }] }, { cost: 2 });
    const board = (n: number) => buildGame({ cards: [{ key: "ram", def: ram, owner: P1, zone: "hand" }, ...ready(n)] });
    const two = board(2);
    refused(() => playCard(two.engine, P1, two.id("ram"), { selected: { m: [two.id(`r${P1}0`)] } }), "cost 2 plus giving up a resource with 2 resources");
    assert.equal(zone(two.engine, two.id("ram")), "hand");
    const three = board(3);
    castAndResolve(three.engine, three.id("ram"), { selected: { m: [three.id(`r${P1}0`)] } });
    assert.equal(zone(three.engine, three.id(`r${P1}0`)), "discard", "control: with 3 the resource is given up");
    assert.equal(attachedCount(three.engine), 2, "and two others pay");
  });

  rule("CR 406.4", "an ability's numeric cost is its pay instruction: a pay 2 ability costs 2", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: withAbility("Src", { costs: [payCost(2)] }), owner: P1 }, ...ready(4)] });
    activate(engine, P1, id("src"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 2);
  });

  rule("CR 406.4", "an ability's numeric cost is a running total like a card's: two pay instructions are added and a reduction applies to the sum", () => {
    const src = withAbility("Src", { costs: [payCost(2), payCost(3)] });
    const plain = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, ...ready(6)] });
    activate(plain.engine, P1, plain.id("src"));
    resolvePendingResponses(plain.engine);
    assert.equal(attachedCount(plain.engine), 5, "2 + 3");
    const reduced = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, { key: "discount", def: discountTactic("Discount", 4), owner: P1, zone: "hand" }, ...ready(6)] });
    castAndResolve(reduced.engine, reduced.id("discount"));
    activate(reduced.engine, P1, reduced.id("src"));
    resolvePendingResponses(reduced.engine);
    assert.equal(attachedCount(reduced.engine), 1, "(2 + 3) - 4 = 1");
  });

  rule("CR 406.4", "an ability with no pay instruction has no numeric cost: a pending reduction does not touch it and is kept", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 2), owner: P1, zone: "hand" },
        { key: "free", def: withAbility("Free", { costs: [{ type: "deplete", target: "source" }] }), owner: P1 },
        { key: "pay", def: withAbility("Pay", { costs: [payCost(3)] }), owner: P1 },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("free"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 0, "the free ability paid no resources");
    assert.equal(engine.state.costReductions.reduce((n, r) => n + r.amount, 0), 2, "the reduction is still pending: nothing was reduced by it");
    activate(engine, P1, id("pay"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 1, "the reduction then applies to a real numeric cost: 3 - 2");
  });

  ruleOpen(["CR 406.4"], "RQ-r03-2", "an ability with no pay instruction has no numeric cost at all: does a standing 'opponents must pay 2 to use a character's ability' still make it cost 2", () => {
    const tax = character({
      name: "Tax",
      behavior: { abilities: [{ id: "t", type: "continuous", modifiers: [], abilityCostModifiers: [{ scope: "opponentCharacters", delta: 2 }] }] } as never
    });
    const { engine, id } = buildGame({
      turn: 2,
      activePlayerId: P2,
      cards: [{ key: "tax", def: tax, owner: P1 }, { key: "free", def: withAbility("Free", {}), owner: P2 }, ...ready(3, P2)]
    });
    activate(engine, P2, id("free"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine, P2), 2, "the open reading: the card text that says 'must pay 2' creates the numeric cost");
  });

  rule("CR 406.5", "an effect that says 'pay' a number is a numeric cost: the pending 'reduce the next numeric cost' applies to it", () => {
    const offer = withAbility("Offer", { effects: [{ type: "mayPay", player: "controller", costs: [payCost(3)], effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 1), owner: P1, zone: "hand" },
        { key: "offer", def: offer, owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(5)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 2, "3 - 1");
    assert.equal(engine.state.costReductions.length, 0, "the reduction was used up by it");
  });

  rule("CR 406.5a", "any applicable numeric cost reduction applies to an effect's pay: a reduction that exceeds it brings it to 0", () => {
    const offer = withAbility("Offer", { effects: [{ type: "mayPay", player: "controller", costs: [payCost(2)], effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 5), owner: P1, zone: "hand" },
        { key: "offer", def: offer, owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(1)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 0, "2 - 5 floors at 0: nothing paid");
    assert.equal(engine.state.players[P1].hand.length, 1, "and the paid-for draw happened");
  });

  const offerPay4 = () =>
    item({
      name: "Pay Four",
      behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "mayPay", player: "controller", costs: [payCost(4)], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }] } as never
    });

  rule("CR 406.5b", "an effect-based numeric cost is not an item's numeric cost: a standing 'items cost 1 less' does not reduce it (Example)", () => {
    const rebate = costModifierCard("Rebate", [{ affects: "controller", delta: -1, selector: { type: "item", zone: "hand" } }]);
    const { engine, id } = buildGame({
      cards: [
        { key: "rebate", def: rebate, owner: P1 },
        { key: "offer", def: offerPay4(), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(6)
      ]
    });
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 4, "the full 4 was paid, not 3");
  });

  rule("CR 406.5b", "Example verbatim: 'the numeric cost of your items is reduced by 1' and an item leaves play that says 'when this card leaves play, you may pay 4': the 4 is not reduced", () => {
    const rebate = costModifierCard("Rebate", [{ affects: "controller", delta: -1, selector: { type: "item", zone: "hand" } }]);
    const idol = item({
      name: "Idol",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "leave",
            type: "triggered",
            event: "cardDestroyed",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "mayPay", player: "controller", costs: [payCost(4)], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
          }
        ]
      } as never
    });
    const smash = spell("Smash", { targets: [{ id: "t", selector: { type: "item" }, count: 1 }], effects: [{ type: "destroy", target: sel("t") }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "rebate", def: rebate, owner: P1 },
        { key: "idol", def: idol, owner: P1 },
        { key: "smash", def: smash, owner: P1, zone: "hand" },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(6)
      ]
    });
    castAndResolve(engine, id("smash"), { selected: { t: [id("idol")] } });
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("idol")), "discard", "the item left play");
    assert.equal(attachedCount(engine), 4, "the full 4 was paid, the items' reduction did not apply");
  });

  rule("CR 406.5b", "a reduction that names a card type ('the next item') does not work on an effect-based numeric cost", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Item Discount", 2, { cardType: "item" }), owner: P1, zone: "hand" },
        { key: "offer", def: offerPay4(), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(6)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 4, "an item-only reduction did not reduce the effect's pay 4");
  });

  rule("CR 406.5b", "a generalized reduction ('reduce the next numeric cost you pay this turn by 1') does apply to the effect-based cost (Example)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 1), owner: P1, zone: "hand" },
        { key: "offer", def: offerPay4(), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(6)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 3, "4 - 1");
  });

  rule("CR 406.5b", "the same standing item reduction does reduce the item's own numeric cost while it is being played (control)", () => {
    const rebate = costModifierCard("Rebate", [{ affects: "controller", delta: -1, selector: { type: "item", zone: "hand" } }]);
    const { engine, id } = buildGame({
      cards: [
        { key: "rebate", def: rebate, owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 4 }), owner: P1, zone: "hand" },
        ...ready(6)
      ]
    });
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 3, "the item's own cost 4 is reduced to 3");
  });

  rule("CR 406.6", "a numeric cost never goes below 0: a cost-1 card with a reduction of 5 costs 0, and nothing is refunded", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 5), owner: P1, zone: "hand" },
        { key: "gadget", def: item({ name: "Gadget", cost: 1 }), owner: P1, zone: "hand" },
        ...spent(2),
        ...ready(1)
      ]
    });
    castAndResolve(engine, id("discount"));
    castAndResolve(engine, id("gadget"));
    assert.equal(zone(engine, id("gadget")), "play");
    assert.equal(attachedCount(engine), 2, "no resource was attached for the reduced cost, none was freed either");
    assert.equal(unattached(engine), 1, "the free resource is still free");
  });

  rule("CR 406.6", "a cost reduced to exactly 0 is 0 and one reduced by one less is 1 (boundary)", () => {
    const exact = buildGame({ cards: [{ key: "discount", def: discountTactic("Discount", 3), owner: P1, zone: "hand" }, { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" }, ...ready(4)] });
    castAndResolve(exact.engine, exact.id("discount"));
    castAndResolve(exact.engine, exact.id("gadget"));
    assert.equal(attachedCount(exact.engine), 0, "3 - 3 = 0");
    const under = buildGame({ cards: [{ key: "discount", def: discountTactic("Discount", 2), owner: P1, zone: "hand" }, { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" }, ...ready(4)] });
    castAndResolve(under.engine, under.id("discount"));
    castAndResolve(under.engine, under.id("gadget"));
    assert.equal(attachedCount(under.engine), 1, "3 - 2 = 1");
  });

  rule("CR 406.6", "an ability's numeric cost never goes below 0 either", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 9), owner: P1, zone: "hand" },
        { key: "src", def: withAbility("Src", { costs: [payCost(1)] }), owner: P1 },
        ...ready(1)
      ]
    });
    castAndResolve(engine, id("discount"));
    activate(engine, P1, id("src"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 0, "1 - 9 stays at 0");
    assert.equal(unattached(engine), 1);
  });

  rule("CR 406.7", "a card deployed with Flip Up starts its running total at the Flip Up cost, not the cost number: cost 5, FLIP UP 3 pays 3", () => {
    const flipper = character({ name: "Flipper", cost: 5, flipUp: { cost: 3, threshold: "" } } as never);
    const { engine, id } = buildGame({ cards: [{ key: "f", def: flipper, owner: P1, zone: "play", faceDown: true }, ...ready(6)] });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("f") } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("f")]!.faceDown, false, "flipped up");
    assert.equal(attachedCount(engine), 3, "exactly the Flip Up cost was paid");
  });

  rule("CR 406.7", "Flip Up adds the card's extra costs to the running total: FLIP UP 3 with an extra 'pay 2' pays 5 in all", () => {
    const flipper = character({ name: "Flipper", cost: 5, flipUp: { cost: 3, threshold: "" }, behavior: { onPlay: { costs: [payCost(2)] } } } as never);
    const { engine, id } = buildGame({ cards: [{ key: "f", def: flipper, owner: P1, zone: "play", faceDown: true }, ...ready(8)] });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("f") } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("f")]!.faceDown, false);
    assert.equal(attachedCount(engine), 5, "3 (Flip Up cost) + 2 (extra) resources");
  });

  rule("CR 406.7", "Flip Up applies cost increases as normal: a +1 tax makes FLIP UP 3 total 4", () => {
    const tax = costModifierCard("Tax", [{ affects: "controller", delta: 1 }]);
    const flipper = character({ name: "Flipper", cost: 5, flipUp: { cost: 3, threshold: "" } } as never);
    const { engine, id } = buildGame({ cards: [{ key: "tax", def: tax, owner: P1 }, { key: "f", def: flipper, owner: P1, zone: "play", faceDown: true }, ...ready(8)] });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("f") } as never);
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 4, "3 + 1");
  });

  rule("CR 406.7", "Flip Up cannot be done without the resources for the balance: FLIP UP 3 with only 2 other resources is refused", () => {
    const flipper = character({ name: "Flipper", cost: 5, flipUp: { cost: 3, threshold: "" } } as never);
    const board = (n: number) => buildGame({ cards: [{ key: "f", def: flipper, owner: P1, zone: "play", faceDown: true }, ...ready(n)] });
    // The face-down card is itself a resource and may pay toward its own Flip Up, so it counts as one of the three.
    const short = board(1);
    refused(() => short.engine.perform({ type: "flipUp", playerId: P1, cardId: short.id("f") } as never), "FLIP UP 3 with a total of 2 resources");
    assert.equal(short.engine.state.cards[short.id("f")]!.faceDown, true, "still face-down");
    const enough = board(2);
    enough.engine.perform({ type: "flipUp", playerId: P1, cardId: enough.id("f") } as never);
    resolvePendingResponses(enough.engine);
    assert.equal(enough.engine.state.cards[enough.id("f")]!.faceDown, false, "control: with 3 resources in all it flips");
  });

  ruleOpen(["CR 406.7"], "RQ-r03-1", "Flip Up with a cost reduction larger than the extras: the Flip Up cost is already paid, so does a reduction lower what is paid at all", () => {
    // FLIP UP 3 with a reduction of 2: final numeric cost 1, balance = 1 - 3 < 0. Is the Flip Up cost refunded / reduced?
    const flipper = character({ name: "Flipper", cost: 5, flipUp: { cost: 3, threshold: "" } } as never);
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 2), owner: P1, zone: "hand" },
        { key: "f", def: flipper, owner: P1, zone: "play", faceDown: true },
        ...ready(8)
      ]
    });
    castAndResolve(engine, id("discount"));
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("f") } as never);
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 3, "the open reading: the Flip Up cost was already paid in full");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 410 — numbers", () => {
  const evenGate = (n: number) =>
    withAbility("Gate", {
      condition: { type: "numberCompare", left: { type: "modulo", value: n, by: 2 }, operator: "=", right: 0 },
      costs: [{ type: "deplete", target: "source" }]
    });
  const usable = (n: number): boolean => {
    const { engine, id } = buildGame({ cards: [{ key: "gate", def: evenGate(n), owner: P1 }] });
    try {
      activate(engine, P1, id("gate"));
      return engine.state.cards[id("gate")]!.depleted;
    } catch {
      return false;
    }
  };

  rule("CR 410.1", "an even number is a multiple of 2: 2, 4 and 10 are even, 1, 3 and 7 are not", () => {
    for (const n of [2, 4, 10]) assert.equal(usable(n), true, `${n} is even`);
    for (const n of [1, 3, 7]) assert.equal(usable(n), false, `${n} is not even`);
  });

  rule("CR 410.1a", "0 is an even number", () => {
    assert.equal(usable(0), true, "0 counts as even");
  });

  rule("CR 410.1", "the party size rule 'even number of members' accepts 2 and 4, rejects 1 and 3", () => {
    const evenParty = (name: string) =>
      character({ name, behavior: { abilities: [{ id: "p", type: "continuous", modifiers: [], partyRestriction: { role: "attacking", parity: "even" } }] } as never });
    const attack = (members: number) => {
      const cards: CardPlacement[] = [
        { key: "lead", def: evenParty("Lead"), owner: P1 },
        ...Array.from({ length: members - 1 }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1 })),
        { key: "target", def: character({ name: "Target" }), owner: P2 }
      ];
      const { engine, id } = buildGame({ cards });
      const attackers = ["lead", ...Array.from({ length: members - 1 }, (_, i) => `m${i}`)].map(id);
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target: { type: "faction" } } as never);
    };
    attack(2);
    attack(4);
    refused(() => attack(1), "an attacking party of 1 where an even number is required", /even|party|member/i);
    refused(() => attack(3), "an attacking party of 3 where an even number is required", /even|party|member/i);
  });

  const chooser = (bounds: Record<string, unknown>) =>
    spell("Chooser", {
      variableBounds: { x: bounds },
      effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }]
    });
  const choose = (value: number, bounds: Record<string, unknown> = { min: 0, max: 5 }) => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: chooser(bounds), owner: P1, zone: "hand" }] });
    const before = influence(engine);
    playCard(engine, P1, id("c"), { variables: { x: value } });
    resolvePendingResponses(engine);
    return influence(engine) - before;
  };

  rule("CR 410.2", "a number chosen for a variable must be a whole number: 1, 2 and 3 are accepted", () => {
    assert.equal(choose(1), 1);
    assert.equal(choose(2), 2);
    assert.equal(choose(3), 3);
  });

  rule("CR 410.2", "a negative number or a fraction is not a whole number and cannot be chosen", () => {
    refused(() => choose(-1, {}), "choosing -1 for X", /number|whole|variable|X|bound/i);
    refused(() => choose(2.5, {}), "choosing 2.5 for X", /number|whole|variable|X|bound/i);
    refused(() => choose(0.5, {}), "choosing 0.5 for X", /number|whole|variable|X|bound/i);
    assert.equal(choose(2, {}), 2, "control: 2 with the same unbounded variable");
  });

  rule("CR 410.2a", "0 is a whole number: X may be chosen as 0", () => {
    assert.equal(choose(0), 0, "X = 0 was accepted and resolved");
    assert.equal(choose(0, {}), 0, "X = 0 is accepted for an unbounded variable too");
  });

  rule("CR 410.3", "when a number is increased and reduced at the same time, increases come first then reductions: strength 1 with +3 and -3 ends at 1, whichever was applied first", () => {
    const pump = (name: string, value: number) =>
      spell(name, { targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: sel("t"), stat: "strength", operation: "add", value, duration: { type: "untilEndOfTurn" } }] });
    const run = (first: number, second: number) => {
      const { engine, id } = buildGame({
        cards: [
          { key: "hero", def: character({ name: "Hero", strength: 1, life: 5 }), owner: P1 },
          { key: "a", def: pump("A", first), owner: P1, zone: "hand" },
          { key: "b", def: pump("B", second), owner: P1, zone: "hand" }
        ]
      });
      castAndResolve(engine, id("a"), { selected: { t: [id("hero")] } });
      castAndResolve(engine, id("b"), { selected: { t: [id("hero")] } });
      return engine.getStat(id("hero"), "strength");
    };
    assert.equal(run(3, -3), 1, "+3 then -3");
    assert.equal(run(-3, 3), 1, "-3 then +3: the increase is still applied first, so no floor in between");
  });

  rule("CR 410.3", "several increases and reductions together: strength 2 with -4, +1, +2 ends at 1 (increases first, so 2 + 1 + 2 - 4)", () => {
    const pump = (name: string, value: number) =>
      spell(name, { targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: sel("t"), stat: "strength", operation: "add", value, duration: { type: "untilEndOfTurn" } }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero", strength: 2, life: 5 }), owner: P1 },
        { key: "a", def: pump("A", -4), owner: P1, zone: "hand" },
        { key: "b", def: pump("B", 1), owner: P1, zone: "hand" },
        { key: "c", def: pump("C", 2), owner: P1, zone: "hand" }
      ]
    });
    castAndResolve(engine, id("a"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, id("b"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, id("c"), { selected: { t: [id("hero")] } });
    assert.equal(engine.getStat(id("hero"), "strength"), 1);
  });

  rule("CR 410.4", "an effect that tries to reduce a number below 0 leaves it at 0: strength 1 reduced by 3 is 0", () => {
    const shrink = spell("Shrink", {
      targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
      effects: [{ type: "createModifier", target: sel("t"), stat: "strength", operation: "add", value: -3, duration: { type: "untilEndOfTurn" } }]
    });
    const { engine, id } = buildGame({ cards: [{ key: "hero", def: character({ name: "Hero", strength: 1, life: 5, speed: 2 }), owner: P1 }, { key: "s", def: shrink, owner: P1, zone: "hand" }] });
    castAndResolve(engine, id("s"), { selected: { t: [id("hero")] } });
    assert.equal(engine.getStat(id("hero"), "strength"), 0, "floored at 0");
    assert.equal(engine.getStat(id("hero"), "speed"), 2, "an unaffected stat is unchanged");
  });

  rule("CR 410.4", "reducing a number to exactly 0 gives 0, one less reduction leaves 1 (boundary)", () => {
    const shrink = (n: number) =>
      spell(`Shrink${n}`, {
        targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
        effects: [{ type: "createModifier", target: sel("t"), stat: "speed", operation: "add", value: -n, duration: { type: "untilEndOfTurn" } }]
      });
    for (const [n, expected] of [[1, 1], [2, 0]] as const) {
      const { engine, id } = buildGame({ cards: [{ key: "hero", def: character({ name: "Hero", speed: 2 }), owner: P1 }, { key: "s", def: shrink(n), owner: P1, zone: "hand" }] });
      castAndResolve(engine, id("s"), { selected: { t: [id("hero")] } });
      assert.equal(engine.getStat(id("hero"), "speed"), expected, `speed 2 reduced by ${n}`);
    }
  });

  rule("CR 410.4", "a faction's influence never goes below 0 from a loss effect", () => {
    const drain = spell("Drain", { effects: [{ type: "modifyInfluence", player: "opponent", amount: -50 }] });
    const { engine, id } = buildGame({ playerB: { influence: 3 }, cards: [{ key: "d", def: drain, owner: P1, zone: "hand" }] });
    castAndResolve(engine, id("d"));
    assert.equal(influence(engine, P2), 0, "influence stops at 0");
  });

  rule("CR 410.4", "a damage reduction that would go below 0 stops at 0: 1 damage reduced by 5 is 0", () => {
    const warded = character({
      name: "Warded",
      life: 5,
      behavior: { abilities: [{ id: "w", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "character" }, delta: -5 }] }] } as never
    });
    const ping = spell("Ping", {
      targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
      effects: [{ type: "dealDamage", target: sel("t"), amount: 1 }]
    });
    const { engine, id } = buildGame({ cards: [{ key: "w", def: warded, owner: P2 }, { key: "ping", def: ping, owner: P1, zone: "hand" }] });
    castAndResolve(engine, id("ping"), { selected: { t: [id("w")] } });
    assert.equal(engine.state.cards[id("w")]!.damage, 0, "not negative damage");
  });

  rule("CR 410.5", "a 'to a minimum of N' reduction does not raise a value already below N (Example): cost 0 reduced by 1 to a minimum of 1 stays 0", () => {
    const market = costModifierCard("Market", [{ affects: "controller", delta: -1, minCost: 1 }]);
    const { engine, id } = buildGame({ cards: [{ key: "market", def: market, owner: P1 }, { key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" }, ...ready(2)] });
    castAndResolve(engine, id("gadget"));
    assert.equal(zone(engine, id("gadget")), "play");
    assert.equal(attachedCount(engine), 0, "still 0, not raised to the minimum of 1");
  });

  rule("CR 410.5", "the minimum does stop a reduction that would go under it: cost 3 reduced by 5 to a minimum of 1 costs 1", () => {
    const market = costModifierCard("Market", [{ affects: "controller", delta: -5, minCost: 1 }]);
    const { engine, id } = buildGame({ cards: [{ key: "market", def: market, owner: P1 }, { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" }, ...ready(4)] });
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 1, "stops at the minimum of 1");
  });

  rule("CR 410.5", "a value exactly at the minimum is not changed by the reduction: cost 1 reduced by 1 to a minimum of 1 costs 1", () => {
    const market = costModifierCard("Market", [{ affects: "controller", delta: -1, minCost: 1 }]);
    const { engine, id } = buildGame({ cards: [{ key: "market", def: market, owner: P1 }, { key: "gadget", def: item({ name: "Gadget", cost: 1 }), owner: P1, zone: "hand" }, ...ready(4)] });
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 1);
  });
});
