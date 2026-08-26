import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, location, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { ActivatedAbility } from "../../engine.js";

function zapAbility(amount: number): ActivatedAbility {
  return {
    id: "zap",
    type: "activated",
    targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
    effects: [
      { type: "dealDamage", target: { type: "selected", id: "target" }, amount }
    ]
  };
}

describe("RULES.md §11 — state-based actions", () => {
  test("a character destroyed by lethal damage moves to discard", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "zapper",
          def: character({ name: "Zapper", behavior: { abilities: [zapAbility(5)] } }),
          owner: P1
        },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("a character that survives sub-lethal damage stays in play, damaged", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "zapper",
          def: character({ name: "Zapper", behavior: { abilities: [zapAbility(2)] } }),
          owner: P1
        },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "play");
    assert.equal(engine.state.cards[id("victim")].damage, 2);
  });

  test(
    "a location destroyed by damage moves to discard",
    () => {
      const { engine, id } = buildGame({
        cards: [
          {
            key: "zapper",
            def: character({ name: "Zapper", behavior: { abilities: [zapAbility(5)] } }),
            owner: P1
          },
          { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2 }
        ]
      });

      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("zapper"),
        abilityId: "zap",
        selected: { target: [id("fort")] }
      });
      resolvePendingResponses(engine);

      assert.equal(engine.state.cards[id("fort")].zone, "discard");
    }
  );
});

describe("RULES.md §2 — zones", () => {
  test("destroyed cards go to discard, not void", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "zapper",
          def: character({ name: "Zapper", behavior: { abilities: [zapAbility(99)] } }),
          owner: P1
        },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "discard");
    assert.notEqual(victim.zone, "void");
  });

  test("'removed from the game' is a distinct, permanent zone — not discard or void", () => {
    const removeAbility: ActivatedAbility = {
      id: "banish",
      type: "activated",
      targets: [{ id: "target", selector: { zone: "discard" }, count: 1 }],
      effects: [{ type: "removeFromGame", target: { type: "selected", id: "target" } }]
    };

    const { engine, id } = buildGame({
      cards: [
        {
          key: "banisher",
          def: character({ name: "Banisher", behavior: { abilities: [removeAbility] } }),
          owner: P1
        },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("banisher"),
      abilityId: "banish",
      selected: { target: [id("corpse")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("corpse")].zone, "removed");
    assert.ok(engine.state.players[P2].removed.includes(id("corpse")));
    assert.ok(!engine.state.players[P2].discard.includes(id("corpse")));
    assert.ok(!engine.state.players[P2].void.includes(id("corpse")));
  });

  test("removing an already-gone card from the game is a no-op, not an error", () => {
    const removeTwice: ActivatedAbility = {
      id: "banishTwice",
      type: "activated",
      targets: [{ id: "target", selector: { zone: "discard" }, count: 1 }],
      effects: [
        { type: "removeFromGame", target: { type: "selected", id: "target" } },
        { type: "removeFromGame", target: { type: "selected", id: "target" } }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        {
          key: "banisher",
          def: character({ name: "Banisher", behavior: { abilities: [removeTwice] } }),
          owner: P1
        },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("banisher"),
        abilityId: "banishTwice",
        selected: { target: [id("corpse")] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("corpse")].zone, "removed");
  });

  test("a card leaving play loses its damage and depletion — neither is meaningful outside the play zone", () => {
    const bounceAbility: ActivatedAbility = {
      id: "bounce",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
      effects: [{ type: "moveCard", target: { type: "selected", id: "target" }, to: "hand" }]
    };

    const { engine, id } = buildGame({
      cards: [
        {
          key: "bouncer",
          def: character({ name: "Bouncer", behavior: { abilities: [bounceAbility] } }),
          owner: P1
        },
        {
          key: "victim",
          def: character({ name: "Victim", life: 3 }),
          owner: P2,
          damage: 2,
          depleted: true
        }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("bouncer"),
      abilityId: "bounce",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "hand");
    assert.equal(victim.damage, 0);
    assert.equal(victim.depleted, false);
  });
});
