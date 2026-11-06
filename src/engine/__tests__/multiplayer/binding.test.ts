// "Your opponent" with three or more players (MP 2; docs/MULTIPLAYER-PLAN.md D4, E2, E3).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, resolvePendingResponses, tactic } from "../support/fixtures.js";

const SEATS = [{ id: "p1" }, { id: "p2" }, { id: "p3" }].map(seat => ({ ...seat, faction: noDevelopFaction() }));

/** "Your opponent loses 2 influence." */
const DRAIN: CardDefinition = character({
  name: "Drainer",
  behavior: {
    abilities: [{ id: "drain", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }]
  }
});

/** "Pick a character an opponent controls. Its controller loses 1 influence and the character takes 1 damage." */
const ZAP: CardDefinition = character({
  name: "Zapper",
  behavior: {
    abilities: [
      {
        id: "zap",
        type: "activated",
        costs: [],
        targets: [{ id: "c", selector: { type: "character", controller: "opponent" }, count: 1 }],
        effects: [
          { type: "dealDamage", target: { type: "selected", id: "c" }, amount: 1 },
          { type: "modifyInfluence", player: "opponent", amount: -1 }
        ]
      }
    ]
  }
});

/** "When an opponent plays a card, that player loses 1 influence." */
const WATCHER: CardDefinition = character({
  name: "Watcher",
  behavior: {
    abilities: [
      {
        id: "watch",
        type: "triggered",
        event: "cardPlayed",
        condition: { type: "eventPlayerIs", player: "opponent" },
        effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
      }
    ]
  }
});

/** "At the end of your turn, your opponent loses 1 influence." — nothing in the event names an opponent. */
const TOLL: CardDefinition = character({
  name: "Toll",
  behavior: {
    abilities: [
      {
        id: "toll",
        type: "triggered",
        event: "turnEnding",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
      }
    ]
  }
});

/** "Your opponents' characters get -1 strength." — a static: every opponent (D4). */
const AURA: CardDefinition = character({
  name: "Aura",
  behavior: {
    abilities: [
      {
        id: "aura",
        type: "continuous",
        modifiers: [{ selector: { type: "character", controller: "opponent" }, stat: "strength", operation: "add", value: -1 }]
      }
    ]
  }
});

const GRUNT = character({ name: "Grunt", strength: 3, life: 5 });
const SPARK = tactic({ name: "Spark", behavior: { abilities: [{ id: "spark", type: "activated", costs: [], effects: [] }] } });

function influence(engine: ReturnType<typeof buildGame>["engine"]) {
  return Object.fromEntries(Object.values(engine.state.players).map(p => [p.id, p.influence]));
}

describe("an ability names the opponent it is about (D4)", () => {
  test("with several opponents the ability must name one", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "d", def: DRAIN, owner: "p1" }] });
    assert.throws(
      () => engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("d"), abilityId: "drain" }),
      /Choose which opponent/
    );
  });

  test("the requirements list asks for the opponent, offering every opponent", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "d", def: DRAIN, owner: "p1" }] });
    const requirements = engine.getPlayRequirements({ type: "activateAbility", playerId: "p1", cardId: id("d"), abilityId: "drain" });
    assert.deepEqual(requirements[0], { kind: "opponent", candidates: ["p2", "p3"] });
  });

  test("the named opponent is the one affected", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "d", def: DRAIN, owner: "p1" }] });
    const before = influence(engine);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("d"), abilityId: "drain", opponentId: "p3" });
    resolvePendingResponses(engine);
    const after = influence(engine);
    assert.equal(after.p3, before.p3 - 2);
    assert.equal(after.p2, before.p2);
  });

  test("a player who is not an opponent cannot be named", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "d", def: DRAIN, owner: "p1" }] });
    assert.throws(
      () => engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("d"), abilityId: "drain", opponentId: "p1" }),
      /not one of your opponents/
    );
  });

  test("with a single opponent nothing is asked (classic)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "d", def: DRAIN, owner: "p1" }] });
    const before = influence(engine);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("d"), abilityId: "drain" });
    resolvePendingResponses(engine);
    assert.equal(influence(engine).p2, before.p2 - 2);
  });
});

describe("a pick of an opponent's card names the opponent (E2)", () => {
  const board = () =>
    buildGame({
      players: SEATS,
      cards: [
        { key: "z", def: ZAP, owner: "p1" },
        { key: "g2", def: GRUNT, owner: "p2" },
        { key: "g3", def: GRUNT, owner: "p3" }
      ]
    });

  test("no opponent need be named: the picked character's controller is the one", () => {
    const { engine, id } = board();
    const before = influence(engine);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("z"), abilityId: "zap", selected: { c: [id("g3")] } });
    resolvePendingResponses(engine);
    assert.equal(influence(engine).p3, before.p3 - 1);
    assert.equal(influence(engine).p2, before.p2);
    assert.equal(engine.state.cards[id("g3")].damage, 1);
  });

  test("a pick that does not belong to the named opponent is refused", () => {
    const { engine, id } = board();
    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: "p1",
        cardId: id("z"),
        abilityId: "zap",
        selected: { c: [id("g2")] },
        opponentId: "p3"
      })
    );
  });
});

/** "Each opponent loses 1 influence." */
const QUAKE: CardDefinition = character({
  name: "Quake",
  behavior: {
    abilities: [
      {
        id: "quake",
        type: "activated",
        costs: [],
        effects: [{ type: "forEachPlayer", players: "opponents", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }]
      }
    ]
  }
});

/** "Any opponent may pay 0 to make your faction lose 3 influence." */
const OFFER: CardDefinition = character({
  name: "Offer",
  behavior: {
    abilities: [
      {
        id: "offer",
        type: "activated",
        costs: [],
        effects: [
          {
            type: "anyPlayerMayPay",
            players: "opponents",
            costs: [],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
          }
        ]
      }
    ]
  }
});

/** "Your opponent's characters get -1 strength this turn." — a lasting effect the block creates. */
const WITHER: CardDefinition = character({
  name: "Wither",
  behavior: {
    abilities: [
      {
        id: "wither",
        type: "activated",
        costs: [],
        effects: [
          {
            type: "createAreaModifier",
            selector: { type: "character", controller: "opponent" },
            stat: "strength",
            operation: "add",
            value: -1,
            duration: { type: "untilEndOfTurn" }
          }
        ]
      }
    ]
  }
});

describe("a lasting effect keeps its block's opponent (D4)", () => {
  test("'your opponent's characters' created for p3 affects p3's characters only", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [
        { key: "w", def: WITHER, owner: "p1" },
        { key: "g2", def: GRUNT, owner: "p2" },
        { key: "g3", def: GRUNT, owner: "p3" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("w"), abilityId: "wither", opponentId: "p3" });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("g3"), "strength"), 2);
    assert.equal(engine.getStat(id("g2"), "strength"), 3);
  });
});

/** "Both players draw a card." (MP 3) */
const BOTH: CardDefinition = character({
  name: "Both",
  behavior: {
    abilities: [
      {
        id: "both",
        type: "activated",
        costs: [],
        effects: [{ type: "forEachPlayer", players: "controllerAndOpponent", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }]
      }
    ]
  }
});

/** "Each opponent discards a card. Then you lose 1 influence." */
const TOLLGATE: CardDefinition = character({
  name: "Tollgate",
  behavior: {
    abilities: [
      {
        id: "toll",
        type: "activated",
        costs: [],
        effects: [
          {
            type: "forEachPlayer",
            players: "opponents",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "opponent",
                declaration: { id: "d", selector: { zone: "hand", controller: "opponent" }, count: 1 },
                effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }]
              }
            ]
          },
          { type: "modifyInfluence", player: "controller", amount: -1 }
        ]
      }
    ]
  }
});

describe("effects after a 'for each player' wait for every player (resume order)", () => {
  test("the effect after 'each opponent discards' resolves only after the last opponent has chosen", () => {
    const FILL = character({ name: "Fill" });
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [
        { key: "t", def: TOLLGATE, owner: "p1" },
        { key: "a2", def: FILL, owner: "p2", zone: "hand" },
        { key: "b2", def: FILL, owner: "p2", zone: "hand" },
        { key: "a3", def: FILL, owner: "p3", zone: "hand" },
        { key: "b3", def: FILL, owner: "p3", zone: "hand" }
      ]
    });
    const before = influence(engine).p1;
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("t"), abilityId: "toll" });
    resolvePendingResponses(engine);
    const choosers: string[] = [];
    while (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      const pending = engine.state.pendingChoice;
      choosers.push(pending.playerId);
      assert.equal(influence(engine).p1, before, `not yet: ${pending.playerId} is still choosing`);
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [engine.state.players[pending.playerId].hand[0]] }
      });
      resolvePendingResponses(engine);
    }
    assert.deepEqual(choosers, ["p2", "p3"]);
    assert.equal(influence(engine).p1, before - 1);
  });
});

describe("both players (MP 3)", () => {
  test("'both players' is the controller and the named opponent", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "b", def: BOTH, owner: "p1" }] });
    const before = influence(engine);
    assert.throws(() => engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("b"), abilityId: "both" }), /Choose which opponent/);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("b"), abilityId: "both", opponentId: "p3" });
    resolvePendingResponses(engine);
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1 - 1, before.p2, before.p3 - 1]);
  });
});

describe("each opponent (E1) and any opponent may pay (E5)", () => {
  test("'each opponent' needs no opponent named and reaches every opponent once", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "q", def: QUAKE, owner: "p1" }] });
    const before = influence(engine);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("q"), abilityId: "quake" });
    resolvePendingResponses(engine);
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1, before.p2 - 1, before.p3 - 1]);
  });

  test("'any opponent may pay' is offered to the opponents only, in turn order", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "o", def: OFFER, owner: "p1" }] });
    const before = influence(engine);
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("o"), abilityId: "offer" });
    resolvePendingResponses(engine);
    const offeredTo: string[] = [];
    while (engine.state.pendingChoice?.kind === "anyPlayerMayPay") {
      const pending = engine.state.pendingChoice;
      offeredTo.push(pending.playerId);
      const pay = pending.playerId === "p3";
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "anyPlayerMayPay", pay } });
      resolvePendingResponses(engine);
    }
    assert.deepEqual(offeredTo, ["p2", "p3"]);
    assert.equal(influence(engine).p1, before.p1 - 3, "the payer's opponent is the card's controller");
  });
});

describe("triggers (E3) and statics", () => {
  test("an opponent's action names the opponent its trigger is about", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      activePlayerId: "p2",
      cards: [
        { key: "w", def: WATCHER, owner: "p1" },
        { key: "s", def: SPARK, owner: "p2", zone: "hand" }
      ]
    });
    const before = influence(engine);
    engine.perform({ type: "playCard", playerId: "p2", cardId: id("s") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "nothing to ask");
    assert.equal(influence(engine).p2, before.p2 - 1);
    assert.equal(influence(engine).p3, before.p3);
  });

  test("a trigger nothing names asks its controller which opponent", () => {
    const { engine, id } = buildGame({ players: SEATS, cards: [{ key: "t", def: TOLL, owner: "p1" }] });
    void id;
    const before = influence(engine);
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooseOpponent");
    assert.deepEqual(pending?.kind === "chooseOpponent" ? pending.candidates : [], ["p2", "p3"]);
    engine.perform({ type: "resolvePendingChoice", playerId: "p1", choice: { kind: "chooseOpponent", opponentId: "p2" } });
    resolvePendingResponses(engine);
    assert.equal(influence(engine).p2, before.p2 - 1);
    assert.equal(influence(engine).p3, before.p3);
  });

  test("a static 'your opponents' character' reaches every opponent", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [
        { key: "a", def: AURA, owner: "p1" },
        { key: "g1", def: GRUNT, owner: "p1" },
        { key: "g2", def: GRUNT, owner: "p2" },
        { key: "g3", def: GRUNT, owner: "p3" }
      ]
    });
    assert.equal(engine.getStat(id("g1"), "strength"), 3);
    assert.equal(engine.getStat(id("g2"), "strength"), 2);
    assert.equal(engine.getStat(id("g3"), "strength"), 2);
  });
});
