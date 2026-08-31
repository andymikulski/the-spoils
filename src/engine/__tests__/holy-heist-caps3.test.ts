// Holy Heist capability unit tests, batch 3 (bigger mechanics: battle-damage
// transforms, attach-tactics, void-play grants, pile splits, split scry,
// ability-activation restriction, move-selected cost).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";

// --- transformBattleDamage: redirectToSelf (Don't Trip) -----------------

describe("capability: transformBattleDamage redirectToSelf", () => {
  test("an attacker's battle damage lands on itself instead of the target", () => {
    const rig = item({
      name: "Trip Wire",
      behavior: {
        abilities: [
          {
            id: "trip",
            type: "activated",
            targets: [{ id: "who", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              {
                type: "transformBattleDamage",
                target: { type: "selected", id: "who" },
                role: "dealer",
                kind: "redirectToSelf",
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "rig", def: rig, owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Charger", strength: 4, life: 6, speed: 3 }), owner: P1, zone: "play" },
        { key: "def", def: character({ name: "Blocker", strength: 0, life: 6, speed: 1 }), owner: P2, zone: "play" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("rig"), abilityId: "trip", selected: { who: [id("atk")] } });
    resolvePendingResponses(engine);

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("atk")].damage, 4, "redirected onto the attacker");
    assert.equal(engine.state.players[P2].influence, 25, "faction took no damage");
  });
});

// --- transformBattleDamage: bounceSelf (Vexing Nullifier receiver side) ---

describe("capability: transformBattleDamage bounceSelf", () => {
  test("a character dealing battle damage to the marked card bounces it to hand", () => {
    const vexing = character({
      name: "Vexer",
      strength: 0,
      life: 6,
      speed: 1,
      behavior: {
        abilities: [
          {
            id: "vex",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [
              {
                type: "transformBattleDamage",
                target: "source",
                role: "receiver",
                kind: "bounceSelf",
                duration: { type: "whileSourceInPlay" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Puncher", strength: 3, speed: 3 }), owner: P2, zone: "play" },
        { key: "vex", def: vexing, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("vex") });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("atk")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("vex")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("vex")].zone, "hand", "bounced instead of damaged");
  });
});

// --- attach-tactic-resolves-into-play -----------------------------------

describe("capability: a tactic with attachTo resolves into play attached", () => {
  test("stays in play attached to its host and its abilities are live", () => {
    const mutation = tactic({
      name: "Grafted Claw",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "mut", def: mutation, owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", strength: 1 }), owner: P1, zone: "play" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("mut"),
      selected: { attachTo: [id("host")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mut")].zone, "play", "tactic stayed in play");
    assert.equal(engine.state.cards[id("mut")].attachedTo, id("host"));
    assert.equal(engine.getStat(id("host"), "strength"), 3, "its continuous buff is live");
  });
});

// --- restrict-ability-activation (cannotUseAbilities) -------------------

describe("capability: cannotUseAbilities restriction", () => {
  test("an aura shuts off activated abilities on matching cards", () => {
    const jammer = character({
      name: "Ability Jammer",
      behavior: {
        abilities: [
          {
            id: "jam",
            type: "continuous",
            modifiers: [],
            restrictions: [
              { selector: { zone: "play", type: "location" }, restriction: "cannotUseAbilities" }
            ]
          }
        ]
      }
    });

    const machine = location({
      name: "Gadget Works",
      behavior: {
        abilities: [
          { id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "jam", def: jammer, owner: P1, zone: "play" },
        { key: "mach", def: machine, owner: P1, zone: "play" }
      ]
    });

    assert.equal(
      engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("mach")),
      false,
      "location ability hidden while jammed"
    );
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mach"), abilityId: "go" })
    );
  });
});

// --- lookAndReorder to: "split" ---------------------------------------

describe("capability: lookAndReorder split (any number to bottom, rest on top)", () => {
  test("chooser partitions the looked-at cards between top and bottom", () => {
    const scry = item({
      name: "Split Scry",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            effects: [{ type: "lookAndReorder", player: "controller", count: 3, to: "split" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: scry, owner: P1, zone: "play" },
        { key: "c1", def: character({ id: "c1", name: "One" }), owner: P1, zone: "deck" },
        { key: "c2", def: character({ id: "c2", name: "Two" }), owner: P1, zone: "deck" },
        { key: "c3", def: character({ id: "c3", name: "Three" }), owner: P1, zone: "deck" },
        { key: "c4", def: character({ id: "c4", name: "Four" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "s" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    // keep c2 on top, send c1 & c3 to the bottom
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "reorderDeck", order: [id("c2")], bottom: [id("c3"), id("c1")] }
    });
    resolvePendingResponses(engine);

    const deck = engine.state.players[P1].deck;
    assert.equal(deck[0], id("c2"), "kept card back on top");
    assert.equal(deck[1], id("c4"), "untouched card next");
    assert.deepEqual(deck.slice(-2), [id("c3"), id("c1")], "the rest went to the bottom in order");
  });
});

// --- separateIntoPiles (Profane Proposal) ------------------------------

describe("capability: separateIntoPiles effect", () => {
  test("splitter partitions a selection; each pile gets its own disposition", () => {
    const proposal = item({
      name: "Two Piles",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [
              { id: "found", selector: { owner: "self", zone: "deck", type: "character" }, count: 3, distinctNames: true }
            ],
            effects: [
              {
                type: "separateIntoPiles",
                splitter: "opponent",
                selected: "found",
                pile1: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }],
                pile2: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "deck" }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "p", def: proposal, owner: P1, zone: "play" },
        { key: "a", def: character({ id: "a", name: "Ay" }), owner: P1, zone: "deck" },
        { key: "b", def: character({ id: "b", name: "Bee" }), owner: P1, zone: "deck" },
        { key: "c", def: character({ id: "c", name: "Cee" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("p"),
      abilityId: "go",
      selected: { found: [id("a"), id("b"), id("c")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "pileAssignment");
    assert.equal(engine.state.pendingChoice?.playerId, P2, "the opponent splits");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "pileAssignment", pile1: [id("a")], pile2: [id("b"), id("c")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].zone, "hand", "pile 1 → hand");
    assert.equal(engine.state.cards[id("b")].zone, "deck", "pile 2 → deck");
    assert.equal(engine.state.cards[id("c")].zone, "deck");
  });
});

// --- grantVoidPlay + deploy from the void -----------------------------

describe("capability: grantVoidPlay (deploy a voided card as though from hand)", () => {
  test("a granted void card can be deployed, ignoring threshold", () => {
    const enabler = item({
      name: "Void Ticket",
      behavior: {
        abilities: [
          {
            id: "grant",
            type: "activated",
            targets: [{ id: "v", selector: { owner: "self", zone: "void", type: "character" }, count: 1 }],
            effects: [
              { type: "grantVoidPlay", selected: "v", player: "controller", ignoreThreshold: true }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "tkt", def: enabler, owner: P1, zone: "play" },
        {
          key: "buried",
          def: character({ id: "buried", name: "Buried One", cost: 0, threshold: "rrrrrr" }),
          owner: P1,
          zone: "void"
        }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tkt"), abilityId: "grant", selected: { v: [id("buried")] } });
    resolvePendingResponses(engine);

    engine.perform({ type: "playCard", playerId: P1, cardId: id("buried") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("buried")].zone, "play", "deployed from the void");
    assert.equal(engine.state.voidPlayGrants.length, 0, "grant consumed when it left the void");
  });
});

// --- moveSelected cost (Uhluhtc Niudla) -------------------------------

describe("capability: moveSelected cost", () => {
  test("paying moves the chosen card to the named zone", () => {
    const relic = item({
      name: "Prevail Relic",
      behavior: {
        abilities: [
          {
            id: "prevail",
            type: "activated",
            costs: [
              {
                type: "moveSelected",
                id: "spent",
                player: "controller",
                selector: { zone: "play", type: "resource" },
                count: 1,
                to: "hand"
              }
            ],
            effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "relic", def: relic, owner: P1, zone: "play" },
        { key: "res", def: character({ id: "res", name: "R" }), owner: P1, zone: "play", faceDown: true }
      ]
    });

    const before = engine.state.players[P1].influence;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("relic"),
      abilityId: "prevail",
      selected: { spent: [id("res")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("res")].zone, "hand", "resource returned to hand as the cost");
    assert.equal(engine.state.players[P1].influence, before + 2);
  });
});

// --- canBlockAnyParty keyword (Guardbeast of Thabbash) ----------------

describe("capability: canBlockAnyParty keyword", () => {
  test("a Covert character with it can still block a non-Covert party", () => {
    const guard = character({
      name: "Guardbeast",
      strength: 2,
      life: 6,
      speed: 3,
      behavior: { keywords: ["covert", "canBlockAnyParty"] }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Plain Attacker", strength: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "guard", def: guard, owner: P2, zone: "play" }
      ]
    });

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);

    assert.doesNotThrow(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });
});
