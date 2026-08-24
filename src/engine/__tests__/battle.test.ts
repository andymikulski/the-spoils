import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  location,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";

describe("RULES.md §8 — battle: attacking a location", () => {
  test("an unblocked attack on a location damages it directly, not the faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 3 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2 }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "card", cardId: id("fort") }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("fort")].damage, 3);
    assert.equal(engine.state.players[P2].influence, before);
  });

  test("a location destroyed by accumulated battle damage moves to discard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 5 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "card", cardId: id("fort") }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("fort")].zone, "discard");
  });

  test("a character (not a location) cannot be attacked directly", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("attacker")],
        target: { type: "card", cardId: id("victim") }
      })
    );
  });
});

describe("RULES.md §8 — battle: unblocked", () => {
  test("an unblocked attacker damages the defending faction's influence, not a character", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "attacker", def: character({ name: "Attacker", strength: 4 }), owner: P1 }]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P2].influence, before - 4);
    assert.equal(engine.state.battle, undefined);
    assert.equal(engine.state.cards[id("attacker")].depleted, true);
  });

  test("influence loss from an attack is not tracked as character damage", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "attacker", def: character({ name: "Attacker", strength: 4 }), owner: P1 }]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    const factionCard = engine.state.cards[engine.state.players[P2].factionId!];
    assert.equal(factionCard.damage, 0);
  });
});

describe("RULES.md §8 — battle: blocked", () => {
  test("a blocked attacker damages the blocker instead of the faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 3 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", life: 5 }), owner: P2 }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P2].influence, before);
    assert.equal(engine.state.cards[id("blocker")].damage, 3);
  });

  test("a blocker dealt lethal damage is destroyed, and still deals its own damage back", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 5, speed: 1 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", life: 3, strength: 2, speed: 1 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("blocker")].zone, "discard");
    // Same speed group: both sides assign before either dies, so the
    // attacker still takes the blocker's damage even though the blocker dies.
    assert.equal(engine.state.cards[id("attacker")].damage, 2);
  });

  test("a blocker cannot be declared while depleted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker" }), owner: P2, depleted: true }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] })
    );
  });
});

describe("RULES.md §8 — battle: speed groups", () => {
  test("a faster attacker can kill a blocker before the blocker deals any damage back", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Fast Attacker", strength: 5, speed: 3 }), owner: P1 },
        { key: "blocker", def: character({ name: "Slow Blocker", life: 3, strength: 4, speed: 1 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("blocker")].zone, "discard");
    // The blocker died in the speed-3 group before it ever got to assign
    // damage in a speed-1 group of its own.
    assert.equal(engine.state.cards[id("attacker")].damage, 0);
  });
});

describe("RULES.md §6/§9 — attack eligibility and Aggro", () => {
  test("a character that just entered play cannot attack without Aggro", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "freshCharacter", def: character({ name: "Fresh" }), owner: P1, attackEligible: false }]
    });

    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("freshCharacter")],
        target: { type: "faction", playerId: P2 }
      })
    );
  });

  test("a character with Aggro can attack the turn it entered play", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "freshAggro",
          def: character({ name: "Fresh Aggro", behavior: { keywords: ["aggro"] } }),
          owner: P1,
          attackEligible: false
        }
      ]
    });

    assert.doesNotThrow(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("freshAggro")],
        target: { type: "faction", playerId: P2 }
      })
    );
  });
});

describe("RULES.md §9 — Covert", () => {
  test("a Covert attacking party can only be blocked by Covert characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("sneak")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });

  test("a Covert character can block a Covert attacking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P1 },
        { key: "counterSneak", def: character({ name: "Counter-Sneak", behavior: { keywords: ["covert"] } }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("sneak")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.doesNotThrow(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("counterSneak")] })
    );
  });

  test("a non-Covert attacking party can be blocked by any character, Covert or not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.doesNotThrow(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });
});

describe("RULES.md §8 — blocking eligibility", () => {
  test("a face-down card (a resource) cannot block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
        { key: "hiddenResource", def: character({ name: "Hidden" }), owner: P2, faceDown: true }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("hiddenResource")] })
    );
  });
});

describe("RULES.md §8 — a character removed from the battle mid-resolution", () => {
  test("a character whose control changes is immediately pulled from its party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 5 }), owner: P1 },
        {
          key: "thief",
          def: character({
            name: "Thief",
            behavior: {
              abilities: [
                {
                  id: "steal",
                  type: "activated",
                  targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
                  effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
                }
              ]
            }
          }),
          owner: P2
        }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });

    // Attacker passes; defender responds by stealing the attacker mid-window.
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("thief"),
      abilityId: "steal",
      selected: { t: [id("attacker")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("attacker")].controllerId, P2);

    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    // The erstwhile attacker defected before ever assigning damage — P2
    // takes none.
    assert.equal(engine.state.players[P2].influence, before);
    assert.equal(engine.state.battle, undefined);
  });
});
