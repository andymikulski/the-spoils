import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { TriggeredAbility } from "../../engine.js";

const WATCHER_ABILITY: TriggeredAbility = {
  id: "onEnter",
  type: "triggered",
  event: "cardEnteredPlay",
  targets: [{ id: "target", selector: { controller: "opponent", type: "character" }, count: 1 }],
  effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: 2 }]
};

describe("RULES.md §7 — ambiguous triggered-ability targets", () => {
  test("an ambiguous target pauses on a player decision instead of guessing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: character({ name: "Watcher", behavior: { abilities: [WATCHER_ABILITY] } }), owner: P1 },
        { key: "foe1", def: character({ name: "Foe 1", life: 5 }), owner: P2 },
        { key: "foe2", def: character({ name: "Foe 2", life: 5 }), owner: P2 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);

    // Two legal targets, one slot — the engine can't guess which the
    // controller means, so both foes are untouched and a choice is pending.
    assert.equal(engine.state.cards[id("foe1")].damage, 0);
    assert.equal(engine.state.cards[id("foe2")].damage, 0);

    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "selectTargets");
    assert.equal(pending?.playerId, P1);
    if (pending?.kind === "selectTargets") {
      assert.equal(pending.sourceId, id("watcher"));
      assert.equal(pending.abilityId, "onEnter");
      assert.equal(pending.declarations.length, 1);
      assert.equal(pending.declarations[0].id, "target");
    }

    assert.equal(engine.getFlowView().mode, "pendingChoice");
  });

  test("the player's choice decides which candidate is actually hit", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: character({ name: "Watcher", behavior: { abilities: [WATCHER_ABILITY] } }), owner: P1 },
        { key: "foe1", def: character({ name: "Foe 1", life: 5 }), owner: P2 },
        { key: "foe2", def: character({ name: "Foe 2", life: 5 }), owner: P2 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [id("foe2")] } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("foe1")].damage, 0);
    assert.equal(engine.state.cards[id("foe2")].damage, 2);
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("only the ability's controller may answer, and only with a legal candidate", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: character({ name: "Watcher", behavior: { abilities: [WATCHER_ABILITY] } }), owner: P1 },
        { key: "foe1", def: character({ name: "Foe 1", life: 5 }), owner: P2 },
        { key: "foe2", def: character({ name: "Foe 2", life: 5 }), owner: P2 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "selectTargets", selected: { target: [id("foe2")] } }
      })
    );

    // Not a legal candidate for this declaration (controller: "opponent" — this is P1's own card).
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "selectTargets", selected: { target: [id("watcher")] } }
      })
    );
  });

  test("an unambiguous trigger (exactly one legal candidate) resolves on its own", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: character({ name: "Watcher", behavior: { abilities: [WATCHER_ABILITY] } }), owner: P1 },
        { key: "onlyFoe", def: character({ name: "Only Foe", life: 5 }), owner: P2 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("onlyFoe")].damage, 2);
  });
});
