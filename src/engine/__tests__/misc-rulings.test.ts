import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { ActivatedAbility } from "../../engine.js";

describe("RULES.md §12 — impossible instructions don't invalidate the rest", () => {
  test("an ability that deals lethal damage and then destroys the same target doesn't crash", () => {
    const overkillThenDestroy: ActivatedAbility = {
      id: "overkillThenDestroy",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
      effects: [
        { type: "dealDamage", target: { type: "selected", id: "target" }, amount: 99 },
        { type: "destroy", target: { type: "selected", id: "target" } }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [overkillThenDestroy] } }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "overkillThenDestroy",
        selected: { target: [id("victim")] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("destroying an already-destroyed target a second time is a no-op, not an error", () => {
    const destroyTwice: ActivatedAbility = {
      id: "destroyTwice",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
      effects: [
        { type: "destroy", target: { type: "selected", id: "target" } },
        { type: "destroy", target: { type: "selected", id: "target" } }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [destroyTwice] } }), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "destroyTwice",
        selected: { target: [id("victim")] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("paying a destroy-cost with an already-gone target doesn't crash the whole activation", () => {
    // A trigger fires from the same batch and kills the intended cost
    // target before the cost itself is paid.
    const sacrificeSomethingElse: ActivatedAbility = {
      id: "sacrifice",
      type: "activated",
      costs: [{ type: "destroy", target: { type: "selected", id: "sac" } }],
      targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
      effects: []
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [sacrificeSomethingElse] } }), owner: P1 },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1 }
      ]
    });

    // Destroy the intended cost target out from under the ability before
    // it's activated, the way an earlier response in the same window might.
    engine.state.cards[id("fodder")].zone = "discard";

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "sacrifice",
        selected: { sac: [id("fodder")] }
      })
    );
  });
});
