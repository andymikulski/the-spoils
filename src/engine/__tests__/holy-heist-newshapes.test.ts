// Integration tests for the Holy Heist cards flagged `reusesProvenShape:
// false` — genuinely novel ability shapes that need their own case (the
// convention `card-behaviors.test.ts` follows). Profane Proposal is covered
// in card-behaviors.test.ts; the split-scry / pile / void-loot primitives
// also have unit coverage in holy-heist-caps*.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";

// Change of Tactics — "X is the number of characters in the attacking
// party. Deplete X non-attacking characters. -- Remove all attacking
// characters from the battle. Add the depleted characters to the attacking
// party." (party swap via removeFromBattle + addToBattle over a
// variable-count depleteSelected).
describe("card behavior: Change of Tactics (attacking-party swap)", () => {
  test("swaps the attacking party for depleted reserves", () => {
    // Same ability body as the tactic, carried on an in-play item so the
    // test drives the party-swap mechanic without the tactic deploy-timing
    // choreography (the `condition` still gates on battle role + damage).
    const tacticDef = item({
      name: "Change of Tactics",
      behavior: {
        abilities: [
          {
            id: "change-of-tactics",
            type: "activated",
            condition: {
              type: "and",
              conditions: [
                { type: "battleRole", role: "attacker" },
                {
                  type: "numberCompare",
                  left: { type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] } },
                  operator: ">=",
                  right: 1
                },
                { type: "battleDamageAssigned", operator: "=", value: 0 }
              ]
            },
            targets: [
              {
                id: "dep",
                selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" } }] },
                count: { type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] } }
              }
            ],
            costs: [{ type: "depleteSelected", declarationId: "dep" }],
            effects: [
              { type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] }, effects: [{ type: "removeFromBattle", target: { type: "selected", id: "__candidate" } }] },
              { type: "forEach", selected: "dep", effects: [{ type: "addToBattle", target: { type: "selected", id: "__candidate" }, side: "attacking" }] },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "cot", def: tacticDef, owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Front Liner", strength: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "reserve", def: character({ name: "Reserve", strength: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "block", def: character({ name: "Wall", strength: 0, life: 8, speed: 1 }), owner: P2, zone: "play" }
      ]
    });

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("block")] });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cot"), abilityId: "change-of-tactics", selected: { dep: [id("reserve")] } });
    resolvePendingResponses(engine);

    const battle = engine.state.battle;
    assert.ok(battle);
    assert.deepEqual(battle.attackingParty, [id("reserve")], "reserve swapped in, front liner out");
    assert.equal(engine.state.cards[id("reserve")].depleted, true);
  });
});

// Cheats, the Dirty Rotten — void 4 loot from the opponent's deck, discard
// 2 at random, and grant "deploy from the void as though from hand".
describe("card behavior: Cheats, the Dirty Rotten (void-loot + grantVoidPlay)", () => {
  test("voids 4, discards 2 at random, deploys the rest from the void", () => {
    // Cheats' ETB body, carried on an activated item ability so the loot
    // pipeline is driven without the onPlay-pick + ETB-trigger plumbing.
    const cheats = item({
      name: "Cheats, the Dirty Rotten",
      behavior: {
        abilities: [
          {
            id: "cheats-etb",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "loot", selector: { owner: "opponent", zone: "deck", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "resource" } }] }, count: 4, distinctNames: true },
                effects: [
                  { type: "forEach", selected: "loot", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }] },
                  { type: "randomFromSelection", selected: "loot", count: 2, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] },
                  { type: "grantVoidPlay", selected: "loot", player: "controller", ignoreThreshold: true }
                ]
              },
              { type: "shuffleDeck", player: "opponent" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      random: () => 0,
      cards: [
        { key: "cheats", def: cheats, owner: P1, zone: "play" },
        { key: "d1", def: character({ id: "cd1", name: "Loot One", cost: 0, threshold: "rrr" }), owner: P2, zone: "deck" },
        { key: "d2", def: character({ id: "cd2", name: "Loot Two", cost: 0, threshold: "rrr" }), owner: P2, zone: "deck" },
        { key: "d3", def: character({ id: "cd3", name: "Loot Three", cost: 0, threshold: "rrr" }), owner: P2, zone: "deck" },
        { key: "d4", def: character({ id: "cd4", name: "Loot Four", cost: 0, threshold: "rrr" }), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cheats"), abilityId: "cheats-etb" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("d1"), id("d2"), id("d3"), id("d4")] }
    });
    resolvePendingResponses(engine);

    const zones = ["d1", "d2", "d3", "d4"].map(k => engine.state.cards[id(k)].zone);
    assert.equal(zones.filter(z => z === "discard").length, 2, "2 randomly discarded");
    assert.equal(zones.filter(z => z === "void").length, 2, "2 stay in the void");

    const stillVoid = ["d1", "d2", "d3", "d4"].map(k => id(k)).find(x => engine.state.cards[x].zone === "void");
    assert.ok(stillVoid, "at least one loot card is still in the void");
    engine.perform({ type: "playCard", playerId: P1, cardId: stillVoid });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[stillVoid].zone, "play", "deployed straight from the void, ignoring threshold");
  });
});

// Confessions of Countless Souls — X-scaled: X to the void, X+1 bounced,
// look at top X+1 and split them top/bottom.
describe("card behavior: Confessions of Countless Souls (X-scaled void/bounce/split-scry)", () => {
  test("X=1: 1 to the void, 2 bounced, top 2 split", () => {
    const conf = tactic({
      name: "Confessions of Countless Souls",
      behavior: {
        abilities: [
          {
            id: "confessions",
            type: "activated",
            variables: {},
            targets: [
              { id: "tovoid", selector: { controller: "self", zone: "play", type: "character" }, count: { type: "variable", id: "x" } },
              { id: "bounce", selector: { zone: "play", type: "character" }, count: { type: "add", values: [{ type: "variable", id: "x" }, 1] } }
            ],
            effects: [
              { type: "forEach", selected: "tovoid", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }] },
              { type: "forEach", selected: "bounce", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] },
              { type: "lookAndReorder", player: "controller", count: { type: "add", values: [{ type: "variable", id: "x" }, 1] }, to: "split" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "conf", def: conf, owner: P1, zone: "hand" },
        { key: "v", def: character({ id: "cf-v", name: "Sacrifice" }), owner: P1, zone: "play" },
        { key: "b1", def: character({ id: "cf-b1", name: "Bounce A" }), owner: P1, zone: "play" },
        { key: "b2", def: character({ id: "cf-b2", name: "Bounce B" }), owner: P2, zone: "play" },
        { key: "t1", def: character({ id: "cf-t1", name: "Top A" }), owner: P1, zone: "deck" },
        { key: "t2", def: character({ id: "cf-t2", name: "Top B" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("conf"),
      variables: { x: 1 },
      selected: { tovoid: [id("v")], bounce: [id("b1"), id("b2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("v")].zone, "void");
    assert.equal(engine.state.cards[id("b1")].zone, "hand");
    assert.equal(engine.state.cards[id("b2")].zone, "hand");

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "reorderDeck", order: [id("t2")], bottom: [id("t1")] }
    });
    resolvePendingResponses(engine);
    const deck = engine.state.players[P1].deck;
    assert.equal(deck[0], id("t2"), "kept card on top");
    assert.equal(deck[deck.length - 1], id("t1"), "other to the bottom");
  });
});
