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

describe("RULES.md §7 — ordering simultaneous triggers mid-resolution", () => {
  test("three simultaneous enters-play triggers resolve in the chosen order and the response window still closes", () => {
    // Regression: the first trigger's effect frame raised the ordering
    // choice for the other two and parked its (already finished) remainder;
    // answering `orderTriggers` never resumed parked frames, so the stale
    // frame blocked the response window from ever closing (the game froze
    // with an empty stack — Dwarvish Grimalkin with 9 Greed).
    const drawOnEnter = (id: string): TriggeredAbility => ({
      id,
      type: "triggered",
      event: "cardEnteredPlay",
      condition: { type: "sourceIsEventCard" },
      effects: [{ type: "draw", player: "controller", amount: 1 }]
    });
    const { engine, id } = buildGame({
      cards: [
        {
          key: "triple",
          def: character({ name: "Triple Drawer", behavior: { abilities: [drawOnEnter("a"), drawOnEnter("b"), drawOnEnter("c")] } }),
          owner: P1,
          zone: "hand"
        },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `deck${i}`, def: character({ name: `Deck Card ${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("triple") });
    const ordered: string[] = [];
    for (let guard = 0; guard < 50 && (engine.state.responseWindow || engine.state.pendingChoice); guard++) {
      const pending = engine.state.pendingChoice;
      if (pending?.kind === "orderTriggers") {
        const next = pending.triggers[pending.triggers.length - 1];
        ordered.push(next.abilityId);
        engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next } });
      } else {
        resolvePendingResponses(engine);
      }
    }

    assert.equal(engine.state.responseWindow, undefined, "the response window closed");
    assert.deepEqual(engine.state.pendingEffectFrames, []);
    assert.equal(engine.getFlowView().mode, "main");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 3, "played the card, then drew three");
    assert.equal(ordered.length, 2, "asked for an order twice: 3 waiting, then 2");
  });
});

