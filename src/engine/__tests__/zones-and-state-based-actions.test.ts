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
          { key: "fort", def: location({ name: "Fort", life: 3 }), owner: P2 }
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
});
