// Batch r03-costs-effects, part 1 (docs/TESTING.md): CR 309 Pay, CR 401 Costs.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

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
describe("CR 309 — pay", () => {
  rule("CR 309.1", "paying 2 attaches exactly 2 resources to the payer's faction and leaves the rest unattached", () => {
    const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }, ...ready(4)] });
    const faction = engine.state.players[P1].factionId;
    castAndResolve(engine, id("gadget"));
    assert.equal(attachedCount(engine), 2, "two resources attached to the faction");
    assert.equal(unattached(engine), 2, "the other two are still unattached");
    const attachedIds = Object.values(engine.state.cards).filter(c => c.attachedTo === faction && engine.isResource(c.id));
    assert.equal(attachedIds.length, 2, "attached specifically to the faction card");
  });

  rule("CR 309.1", "paying 0 attaches nothing", () => {
    const { engine, id } = buildGame({ cards: [{ key: "free", def: item({ name: "Free", cost: 0 }), owner: P1, zone: "hand" }, ...ready(2)] });
    castAndResolve(engine, id("free"));
    assert.equal(attachedCount(engine), 0, "no resource was attached");
    assert.equal(unattached(engine), 2);
  });

  rule("CR 309.1", "paying exactly as many resources as are available is allowed; one too few is refused", () => {
    const exact = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" }, ...ready(3)] });
    castAndResolve(exact.engine, exact.id("gadget"));
    assert.equal(attachedCount(exact.engine), 3, "all three resources attached");
    assert.equal(unattached(exact.engine), 0);
    const short = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "hand" }, ...ready(2)] });
    refused(() => playCard(short.engine, P1, short.id("gadget")), "cost 3 with only 2 resources");
    assert.equal(zone(short.engine, short.id("gadget")), "hand", "nothing was played");
    assert.equal(attachedCount(short.engine), 0, "nothing was attached");
  });

  rule("CR 309.1", "an instruction to pay inside an effect attaches that many resources too", () => {
    const offer = withAbility("Offer", { effects: [{ type: "mayPay", player: "controller", costs: [payCost(2)], effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({ cards: [{ key: "offer", def: offer, owner: P1 }, { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }, ...ready(4)] });
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 2, "two resources attached by the effect's pay instruction");
    assert.equal(engine.state.players[P1].hand.length, 1, "and the paid-for effect happened");
  });

  rule("CR 309.1", "an ability's pay instruction attaches that many resources", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: withAbility("Src", { costs: [payCost(3)] }), owner: P1 }, ...ready(5)] });
    activate(engine, P1, id("src"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 3);
  });

  rule("CR 309.1a", "resources already attached to anything cannot pay: with every resource attached the payment is refused", () => {
    const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 1 }), owner: P1, zone: "hand" }, ...spent(3)] });
    assert.equal(unattached(engine), 0, "setup: every resource is attached");
    refused(() => playCard(engine, P1, id("gadget")), "paying 1 with only attached resources");
    assert.equal(zone(engine, id("gadget")), "hand");
  });

  rule("CR 309.1a", "only the unattached resources are used: with 1 free and 2 attached, paying 1 works and attaches the free one", () => {
    const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 1 }), owner: P1, zone: "hand" }, ...spent(2), ...ready(1)] });
    castAndResolve(engine, id("gadget"));
    assert.equal(zone(engine, id("gadget")), "play", "control: payable with the one free resource");
    assert.equal(attachedCount(engine), 3, "the free resource joined the two already attached");
    assert.equal(unattached(engine), 0);
  });

  rule("CR 309.1a", "paying 2 with 1 free resource and 5 attached ones is refused (attached resources do not count)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }, ...spent(5), ...ready(1)] });
    refused(() => playCard(engine, P1, id("gadget")), "cost 2 with one unattached resource");
    assert.equal(attachedCount(engine), 5, "the attached ones are untouched");
    assert.equal(unattached(engine), 1, "and the free one was not used");
  });

  rule("CR 309.1a", "an ability's pay instruction cannot use attached resources either", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: withAbility("Src", { costs: [payCost(2)] }), owner: P1 }, ...spent(4), ...ready(1)] });
    refused(() => activate(engine, P1, id("src")), "ability pay 2 with one unattached resource");
    assert.equal(attachedCount(engine), 4);
  });

  rule("CR 309.1b", "losing influence as a cost is not paying: no resource is attached", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: withAbility("Src", { costs: [{ type: "loseInfluence", amount: 3 }] }), owner: P1 }, ...ready(2)] });
    const before = influence(engine);
    activate(engine, P1, id("src"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine), before - 3, "the faction lost 3 influence");
    assert.equal(attachedCount(engine), 0, "no resource was attached");
    assert.equal(unattached(engine), 2);
  });

  rule("CR 309.1b", "a cost of losing influence is not a numeric cost: a pending 'reduce the next numeric cost' neither reduces it nor is used up", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discountTactic("Discount", 2), owner: P1, zone: "hand" },
        { key: "tithe", def: withAbility("Tithe", { costs: [{ type: "loseInfluence", amount: 3 }] }), owner: P1 },
        { key: "pay", def: withAbility("Pay", { costs: [payCost(3)] }), owner: P1 },
        ...ready(4)
      ]
    });
    castAndResolve(engine, id("discount"));
    const before = influence(engine);
    activate(engine, P1, id("tithe"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine), before - 3, "the full 3 influence was lost");
    activate(engine, P1, id("pay"));
    resolvePendingResponses(engine);
    assert.equal(attachedCount(engine), 1, "the reduction was still pending for the real pay instruction: 3 - 2 = 1");
  });

  rule("CR 309.1b", "paying a numeric cost does not cost influence", () => {
    const { engine, id } = buildGame({ cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }, ...ready(3)] });
    const before = influence(engine);
    castAndResolve(engine, id("gadget"));
    assert.equal(influence(engine), before, "influence is unchanged by paying");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 401 — costs", () => {
  rule("CR 401.1", "a cost is any action the player must take: every step of an ability's cost is taken when it is used", () => {
    const src = withAbility("Src", {
      costs: [{ type: "deplete", target: "source" }, { type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }, payCost(1)],
      effects: [{ type: "draw", player: "controller", amount: 1 }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: src, owner: P1 },
        { key: "h1", def: tactic({ name: "Hand One" }), owner: P1, zone: "hand" },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...ready(2)
      ]
    });
    activate(engine, P1, id("src"), "go", { selected: { d: [id("h1")] } });
    assert.equal(engine.state.cards[id("src")]!.depleted, true, "deplete was taken");
    assert.equal(zone(engine, id("h1")), "discard", "the discard was taken");
    assert.equal(attachedCount(engine), 1, "the pay was taken");
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 1, "and then the effect happened");
  });

  rule("CR 401.1", "a cost is taken when the card is played, before the opponent can respond (a tactic's extra cost)", () => {
    const strike = spell("Strike", { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }], effects: [] });
    const { engine, id } = buildGame({
      cards: [
        { key: "strike", def: strike, owner: P1, zone: "hand" },
        { key: "fodder", def: tactic({ name: "Fodder" }), owner: P1, zone: "hand" }
      ]
    });
    playCard(engine, P1, id("strike"), { selected: { d: [id("fodder")] } });
    assert.ok(engine.state.responseWindow, "the opponent's response window is open");
    assert.equal(zone(engine, id("fodder")), "discard", "the cost was already paid while the opponent may still respond");
  });

  rule("CR 401.1", "a cost may be a restriction on when it can be satisfied: unmet, the action cannot be taken (control: met, it can)", () => {
    const guarded = withAbility("Guarded", { costs: [{ type: "deplete", target: "source" }], condition: { type: "isActivePlayer", player: "controller" } });
    const board = () =>
      buildGame({
        cards: [
          { key: "guarded", def: guarded, owner: P2 },
          { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" }
        ]
      });
    const { engine, id } = board();
    playCard(engine, P1, id("opener"));
    refused(() => activate(engine, P2, id("guarded")), "use-only-on-your-turn ability in a response on the opponent's turn", /timing|condition|cannot|not/i);
    assert.equal(engine.state.cards[id("guarded")]!.depleted, false, "nothing was paid for the refused use");
    const open = withAbility("Open", { costs: [{ type: "deplete", target: "source" }] });
    const unrestricted = buildGame({ cards: [{ key: "open", def: open, owner: P2 }, { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" }] });
    playCard(unrestricted.engine, P1, unrestricted.id("opener"));
    activate(unrestricted.engine, P2, unrestricted.id("open"));
    assert.equal(unrestricted.engine.state.cards[unrestricted.id("open")]!.depleted, true, "control: the same response without the restriction is allowed");
    const control = buildGame({ activePlayerId: P2, turn: 2, cards: [{ key: "guarded", def: guarded, owner: P2 }] });
    activate(control.engine, P2, control.id("guarded"));
    assert.equal(control.engine.state.cards[control.id("guarded")]!.depleted, true, "control: on its controller's own turn the use goes through");
  });

  rule("CR 401.1a", "a pay instruction written in an effect, outside the cost section, is a cost: it needs the resources and takes them", () => {
    const offer = withAbility("Offer", { effects: [{ type: "mayPay", player: "controller", costs: [payCost(2)], effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }] }] });
    const rich = buildGame({ cards: [{ key: "offer", def: offer, owner: P1 }, ...ready(2)] });
    const before = influence(rich.engine);
    activate(rich.engine, P1, rich.id("offer"));
    resolvePendingResponses(rich.engine);
    answer(rich.engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(rich.engine);
    assert.equal(influence(rich.engine), before + 4, "paid, so the effect happened");
    assert.equal(attachedCount(rich.engine), 2);
    const poor = buildGame({ cards: [{ key: "offer", def: offer, owner: P1 }, ...ready(1)] });
    const poorBefore = influence(poor.engine);
    activate(poor.engine, P1, poor.id("offer"));
    resolvePendingResponses(poor.engine);
    assert.equal(poor.engine.state.pendingChoice, undefined, "an unaffordable payment is not even offered");
    assert.equal(influence(poor.engine), poorBefore, "unaffordable: the paid-for effect did not happen");
    assert.equal(attachedCount(poor.engine), 0, "and nothing was attached");
  });

  rule("CR 401.1a", "no other instruction counts as a cost outside the cost section: removing a token in an effect needs no token, removing one as a cost does", () => {
    const asEffect = spell("AsEffect", { effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] });
    const asEffectGame = buildGame({ cards: [{ key: "spell", def: asEffect, owner: P1, zone: "hand" }] });
    castAndResolve(asEffectGame.engine, asEffectGame.id("spell"));
    assert.equal(zone(asEffectGame.engine, asEffectGame.id("spell")), "discard", "the tactic with the instruction in its effect was played despite having nothing to remove");
    const asCost = withAbility("AsCost", { costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] });
    const asCostGame = buildGame({ cards: [{ key: "src", def: asCost, owner: P1 }] });
    refused(() => activate(asCostGame.engine, P1, asCostGame.id("src")), "removing a token as a cost with none to remove", /token|cost|counter|cannot/i);
  });

  rule("CR 401.2", "a cost with an instruction that cannot be completed cannot be satisfied: the ability is refused and nothing is paid", () => {
    const src = withAbility("Src", { costs: [{ type: "deplete", target: "source" }, { type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }] });
    const empty = buildGame({ cards: [{ key: "src", def: src, owner: P1 }] });
    refused(() => activate(empty.engine, P1, empty.id("src"), "go", { selected: { d: [] } }), "discard cost with an empty hand");
    assert.equal(empty.engine.state.cards[empty.id("src")]!.depleted, false, "the earlier step was not left paid");
    const stocked = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, { key: "h", def: tactic({ name: "H" }), owner: P1, zone: "hand" }] });
    activate(stocked.engine, P1, stocked.id("src"), "go", { selected: { d: [stocked.id("h")] } });
    assert.equal(stocked.engine.state.cards[stocked.id("src")]!.depleted, true, "control: with a card to discard the cost is satisfied");
  });

  rule("CR 401.2", "a card whose cost cannot be satisfied cannot be played (tactic with a discard cost and an empty hand)", () => {
    const strike = spell("Strike", { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 2 }] });
    const board = (handSize: number) =>
      buildGame({
        cards: [
          { key: "strike", def: strike, owner: P1, zone: "hand" },
          ...Array.from({ length: handSize }, (_, i) => ({ key: `h${i}`, def: tactic({ name: `H${i}` }), owner: P1, zone: "hand" as const }))
        ]
      });
    const short = board(1);
    refused(() => playCard(short.engine, P1, short.id("strike"), { selected: { d: [short.id("h0")] } }), "discard 2 with only one other card in hand");
    assert.equal(zone(short.engine, short.id("strike")), "hand", "the card was not played");
    assert.equal(zone(short.engine, short.id("h0")), "hand", "and the one card was not discarded");
    const enough = board(2);
    playCard(enough.engine, P1, enough.id("strike"), { selected: { d: [enough.id("h0"), enough.id("h1")] } });
    assert.equal(zone(enough.engine, enough.id("h0")), "discard", "control: exactly enough cards, played");
  });

  rule("CR 401.2", "a cost that is a restriction not met cannot be satisfied, so the action cannot be taken (control: during a battle it can)", () => {
    const ability = withAbility("Gated", { costs: [{ type: "deplete", target: "source" }], condition: { type: "battleActive" } });
    const board = () =>
      buildGame({
        cards: [
          { key: "gated", def: ability, owner: P1, attackEligible: false },
          { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
          { key: "foe", def: character({ name: "Foe" }), owner: P2 }
        ]
      });
    const outside = board();
    refused(() => activate(outside.engine, P1, outside.id("gated")), "ability restricted to battle, used outside battle");
    assert.equal(outside.engine.state.cards[outside.id("gated")]!.depleted, false, "nothing paid");
    const inside = board();
    inside.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [inside.id("attacker")], target: { type: "faction" } } as never);
    activate(inside.engine, P1, inside.id("gated"));
    assert.equal(inside.engine.state.cards[inside.id("gated")]!.depleted, true, "control: with a battle under way the restriction is met and the cost paid");
  });

  rule(["CR 401.2a"], "satisfying a cost as the opponent needs knowledge of their hand: 'discard a character' from a hand that is not revealed is refused", () => {
    // The Billionaire-style borrower pays every cost "as though" it were the opponent (asOpponent).
    const borrower = character({
      name: "Borrower",
      behavior: { abilities: [{ id: "borrow", type: "continuous", modifiers: [], canUseOpponentAbilities: "asOpponent" }] } as never
    });
    const machine = withAbility("Machine", { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand", type: "character" }, count: 1 }] });
    const game = () =>
      buildGame({
        cards: [
          { key: "borrower", def: borrower, owner: P1 },
          { key: "machine", def: machine, owner: P2 },
          { key: "theirChar", def: character({ name: "Their Character" }), owner: P2, zone: "hand" }
        ]
      });
    const hidden = game();
    refused(
      () => activate(hidden.engine, P1, hidden.id("machine"), "go", { selected: { d: [hidden.id("theirChar")] } }),
      "choosing a character in an opponent's hand that is not revealed",
      /reveal|know|hand|cannot/i
    );
  });

  rule(["CR 401.2a"], "satisfying a cost as the opponent works when their hand is revealed by an ongoing effect (control for the knowledge rule)", () => {
    const borrower = character({
      name: "Borrower",
      behavior: { abilities: [{ id: "borrow", type: "continuous", modifiers: [], canUseOpponentAbilities: "asOpponent" }] } as never
    });
    const diva = character({
      name: "Diva",
      behavior: { abilities: [{ id: "show", type: "continuous", modifiers: [], grantsReveal: { zone: "hand", of: "opponent" } }] } as never
    });
    const machine = withAbility("Machine", { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand", type: "character" }, count: 1 }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "borrower", def: borrower, owner: P1 },
        { key: "diva", def: diva, owner: P1 },
        { key: "machine", def: machine, owner: P2 },
        { key: "theirChar", def: character({ name: "Their Character" }), owner: P2, zone: "hand" }
      ]
    });
    activate(engine, P1, id("machine"), "go", { selected: { d: [id("theirChar")] } });
    assert.equal(zone(engine, id("theirChar")), "discard", "the opponent's revealed character was discarded to pay the cost");
  });

  rule("CR 401.3", "extra costs are completed in the order listed: a draw cost before a hand-size bind is counted, after it is not", () => {
    const handSize = { type: "count", selector: { controller: "self", zone: "hand" } };
    const draw = { type: "effects", effects: [{ type: "draw", player: "controller", amount: 1 }] };
    const bind = { type: "bindVariable", id: "x", value: handSize };
    const run = (costs: unknown[]) => {
      const src = withAbility("Src", { costs, effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }] });
      const { engine, id } = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }] });
      const before = influence(engine);
      activate(engine, P1, id("src"));
      resolvePendingResponses(engine);
      return influence(engine) - before;
    };
    assert.equal(run([draw, bind]), 1, "draw first, then X = hand size 1");
    assert.equal(run([bind, draw]), 0, "bind first, then draw: X = hand size 0");
  });

  rule("CR 401.3", "pay instructions are the exception to written order: they are paid last, after the other extra costs", () => {
    // 'Pay 2' written first, then 'put a resource into the discard pile': the moved resource cannot also pay.
    const ram = withAbility("Ram", {
      costs: [payCost(2), { type: "moveSelected", id: "m", player: "controller", selector: { type: "resource" }, count: 1, to: "discard" }],
      effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
    });
    const board = (n: number) => buildGame({ cards: [{ key: "ram", def: ram, owner: P1 }, ...ready(n)] });
    const two = board(2);
    refused(() => activate(two.engine, P1, two.id("ram"), "go", { selected: { m: [two.id(`r${P1}0`)] } }), "pay 2 plus giving up a resource with only 2 resources");
    assert.equal(unattached(two.engine), 2, "nothing was paid");
    assert.equal(zone(two.engine, two.id(`r${P1}0`)), "play", "the resource was not given up");
    const three = board(3);
    activate(three.engine, P1, three.id("ram"), "go", { selected: { m: [three.id(`r${P1}0`)] } });
    resolvePendingResponses(three.engine);
    assert.equal(zone(three.engine, three.id(`r${P1}0`)), "discard", "control: with 3 resources one is given up and two pay");
    assert.equal(attachedCount(three.engine), 2);
  });

  rule("CR 401.3", "if a step cannot be completed the whole action is illegal and everything done so far is undone", () => {
    const src = withAbility("Src", {
      costs: [{ type: "effects", effects: [{ type: "draw", player: "controller", amount: 1 }] }, { type: "deplete", target: "source" }, payCost(5)]
    });
    const { engine, id } = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }, ...ready(1)] });
    refused(() => activate(engine, P1, id("src")), "a pay of 5 with 1 resource after a draw and a deplete");
    assert.equal(engine.state.players[P1].hand.length, 0, "the drawn card is back");
    assert.equal(zone(engine, id("d0")), "deck", "in the deck");
    assert.equal(engine.state.cards[id("src")]!.depleted, false, "the deplete is undone");
    assert.equal(attachedCount(engine), 0, "nothing paid");
  });

  rule("CR 401.3", "a step that fails in the middle of a longer list leaves the earlier steps unpaid (discard cannot be completed after a deplete and a token)", () => {
    const src = withAbility("Src", {
      costs: [
        { type: "effects", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
        { type: "deplete", target: "source" },
        { type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }
      ]
    });
    const { engine, id } = buildGame({ cards: [{ key: "src", def: src, owner: P1 }] });
    refused(() => activate(engine, P1, id("src"), "go", { selected: { d: [] } }), "discard with an empty hand");
    assert.equal(engine.state.cards[id("src")]!.counters.token ?? 0, 0, "the token put on as the first step is undone");
    assert.equal(engine.state.cards[id("src")]!.depleted, false, "the deplete is undone");
  });

  rule("CR 401.3a", "a restriction written as an extra cost must be satisfied like any other: unmet it blocks the use and the other costs stay unpaid", () => {
    const restricted = spell("Restricted", { costs: [payCost(1)], condition: { type: "isActivePlayer", player: "controller" } });
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
        { key: "restricted", def: restricted, owner: P2, zone: "hand" },
        ...ready(2, P2)
      ]
    });
    playCard(engine, P1, id("opener"));
    const free = buildGame({ cards: [{ key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" }, { key: "plain", def: spell("Plain", { costs: [payCost(1)] }), owner: P2, zone: "hand" }, ...ready(2, P2)] });
    playCard(free.engine, P1, free.id("opener"));
    playCard(free.engine, P2, free.id("plain"));
    assert.equal(attachedCount(free.engine, P2), 1, "control: the same tactic without the restriction can be cast in that window and its pay is taken");
    refused(() => playCard(engine, P2, id("restricted")), "a 'use this only during your turn' tactic cast in the opponent's turn", /deploy|timing|condition|cannot/i);
    assert.equal(zone(engine, id("restricted")), "hand", "not played");
    assert.equal(attachedCount(engine, P2), 0, "and the pay was not taken");
  });

  rule("CR 401.3a", "the same restriction is satisfied on the player's own turn (positive control)", () => {
    const restricted = spell("Restricted", { costs: [payCost(1)], condition: { type: "isActivePlayer", player: "controller" } });
    const { engine, id } = buildGame({ cards: [{ key: "restricted", def: restricted, owner: P1, zone: "hand" }, ...ready(2)] });
    castAndResolve(engine, id("restricted"));
    assert.equal(zone(engine, id("restricted")), "discard", "played and resolved");
    assert.equal(attachedCount(engine), 1, "the other cost was paid");
  });

  rule("CR 401.3b", "a cost that makes the card lose something cannot be satisfied unless the card has it: no tokens, refused; exactly enough, allowed", () => {
    const src = withAbility("Src", { costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 2 }] });
    const none = buildGame({ cards: [{ key: "src", def: src, owner: P1 }] });
    refused(() => activate(none.engine, P1, none.id("src")), "removing 2 tokens from a card with none", /token|counter|cost|cannot/i);
    const one = buildGame({ cards: [{ key: "src", def: src, owner: P1, counters: { token: 1 } }] });
    refused(() => activate(one.engine, P1, one.id("src")), "removing 2 tokens from a card with 1", /token|counter|cost|cannot/i);
    assert.equal(one.engine.state.cards[one.id("src")]!.counters.token, 1, "the one token is still there");
    const two = buildGame({ cards: [{ key: "src", def: src, owner: P1, counters: { token: 2 } }] });
    activate(two.engine, P1, two.id("src"));
    assert.equal(two.engine.state.cards[two.id("src")]!.counters.token ?? 0, 0, "control: with exactly 2 tokens the cost is paid");
  });

  rule("CR 401.3b", "a cost of putting the card itself out of the game cannot be satisfied if the card is not where it can be removed from", () => {
    // 'Remove this card from the game' is only usable from the zone the ability is used from.
    const recur = tactic({
      name: "Recur",
      behavior: {
        abilities: [{ id: "go", type: "activated", activationZone: "discard", costs: [{ type: "removeFromGame", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
      } as never
    });
    const inDiscard = buildGame({ cards: [{ key: "recur", def: recur, owner: P1, zone: "discard" }, { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }] });
    activate(inDiscard.engine, P1, inDiscard.id("recur"));
    resolvePendingResponses(inDiscard.engine);
    assert.equal(zone(inDiscard.engine, inDiscard.id("recur")), "removed", "control: used from the discard pile, the card removed itself");
    const inHand = buildGame({ cards: [{ key: "recur", def: recur, owner: P1, zone: "hand" }, { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }] });
    refused(() => activate(inHand.engine, P1, inHand.id("recur")), "using a discard-pile ability from the hand", /ability not found|zone|cannot|not/i);
    assert.equal(zone(inHand.engine, inHand.id("recur")), "hand", "the card did not remove itself");
  });
});
