import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2, resolvePendingResponses, resourceCard } from "./support/fixtures.js";
import type { PendingChoice, TriggeredAbility } from "../../engine.js";

const MARK_SELECTOR = { zone: "play" as const, type: "character" as const, subtype: "mark" };

function depleteOnTurnStart(): TriggeredAbility {
  return {
    id: "depleteMark",
    type: "triggered",
    event: "turnStarted",
    targets: [{ id: "t", selector: MARK_SELECTOR, count: 1 }],
    effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
  };
}

function restoreOnTurnStart(): TriggeredAbility {
  return {
    id: "restoreMark",
    type: "triggered",
    event: "turnStarted",
    targets: [{ id: "t", selector: MARK_SELECTOR, count: 1 }],
    effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
  };
}

describe("RULES.md §7 — ordering multiple triggers firing at once", () => {
  test("two triggers from one player's cards pause on that player's ordering decision", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "depleter", def: character({ name: "Depleter", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "restorer", def: character({ name: "Restorer", behavior: { abilities: [restoreOnTurnStart()] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1);
    if (pending?.kind === "orderTriggers") {
      const keys = pending.triggers.map(t => `${t.sourceId}:${t.abilityId}`).sort();
      assert.deepEqual(
        keys,
        [`${id("depleter")}:depleteMark`, `${id("restorer")}:restoreMark`].sort()
      );
    }
  });

  test("the chosen order decides the outcome — deplete-then-restore ends restored", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "depleter", def: character({ name: "Depleter", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "restorer", def: character({ name: "Restorer", behavior: { abilities: [restoreOnTurnStart()] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    // Pick the deplete trigger to happen next; the lone remaining restore
    // trigger then resolves on its own (CR §503.4a — no second prompt for a
    // single leftover).
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: {
        kind: "orderTriggers",
        next: { sourceId: id("depleter"), abilityId: "depleteMark" }
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("mark")].depleted, false);
  });

  test("the reverse order ends the other way — restore-then-deplete ends depleted", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "depleter", def: character({ name: "Depleter", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "restorer", def: character({ name: "Restorer", behavior: { abilities: [restoreOnTurnStart()] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: {
        kind: "orderTriggers",
        next: { sourceId: id("restorer"), abilityId: "restoreMark" }
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mark")].depleted, true);
  });

  test("only the deciding player may answer, and only with a trigger from the batch", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "depleter", def: character({ name: "Depleter", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "restorer", def: character({ name: "Restorer", behavior: { abilities: [restoreOnTurnStart()] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: {
          kind: "orderTriggers",
          next: { sourceId: id("depleter"), abilityId: "depleteMark" }
        }
      })
    );

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: {
          kind: "orderTriggers",
          next: { sourceId: id("mark"), abilityId: "nope" }
        }
      })
    );
  });

  test("triggers from both players' cards are ordered by the active player", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "p1trigger", def: character({ name: "P1 Trigger", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "p2trigger", def: character({ name: "P2 Trigger", behavior: { abilities: [restoreOnTurnStart()] } }), owner: P2 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    // Turn 2 is P2's — the trigger batch fires for P2's turn start, but it
    // includes a card controlled by P1 too, so the *active* player (P2)
    // decides, not either card's controller alone.
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P2);
    assert.equal(engine.state.activePlayerId, P2);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: {
          kind: "orderTriggers",
          next: { sourceId: id("p1trigger"), abilityId: "depleteMark" }
        }
      })
    );
  });

  test("a single trigger with no siblings resolves immediately, no ordering pause", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "depleter", def: character({ name: "Depleter", behavior: { abilities: [depleteOnTurnStart()] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1, depleted: false }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("mark")].depleted, true);
  });

  test("CR §503.4a — deciding one at a time: resolving the first pick can strip a target from the rest", () => {
    // Two "at start of turn" triggers on the same Mark: one destroys it,
    // the other *may* buff it. Resolving the destroy first leaves the
    // (optional) buff with no legal target — it auto-declines rather than
    // being locked in by an up-front permutation.
    const destroyMark: TriggeredAbility = {
      id: "destroyMark",
      type: "triggered",
      event: "turnStarted",
      targets: [{ id: "t", selector: MARK_SELECTOR, count: 1 }],
      effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
    };
    const buffMark: TriggeredAbility = {
      id: "buffMark",
      type: "triggered",
      event: "turnStarted",
      targets: [{ id: "t", selector: MARK_SELECTOR, count: 1, optional: true }],
      effects: [
        {
          type: "createModifier",
          target: { type: "selected", id: "t" },
          stat: "strength",
          operation: "add",
          value: 5,
          duration: { type: "permanent" }
        }
      ]
    };

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "destroyer", def: character({ name: "Destroyer", behavior: { abilities: [destroyMark] } }), owner: P1 },
        { key: "buffer", def: character({ name: "Buffer", behavior: { abilities: [buffMark] } }), owner: P1 },
        { key: "mark", def: character({ name: "Mark", strength: 1, life: 5, subtype: ["mark"] }), owner: P1 }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "orderTriggers");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: {
        kind: "orderTriggers",
        next: { sourceId: id("destroyer"), abilityId: "destroyMark" }
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mark")].zone, "discard");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("declining a `mayPay` in one batched trigger still resolves the rest (Party Clowns)", () => {
    // Party Clowns' the-gangs-all-here: "at the start of your turn, you may
    // pay 1 ..." — one trigger per copy in play. Picking one to resolve then
    // *declining* its pay must not strand its unresolved siblings: the queue
    // has to keep going and re-prompt for the next one.
    const mayPayInfluence = (abilityId: string): TriggeredAbility => ({
      id: abilityId,
      type: "triggered",
      event: "turnStarted",
      condition: { type: "eventPlayerIs", player: "controller" },
      effects: [
        {
          type: "mayPay",
          player: "controller",
          costs: [{ type: "payResources", amount: 1 }],
          effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
        }
      ]
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "clownA", def: character({ name: "Party Clowns A", behavior: { abilities: [mayPayInfluence("gang-a")] } }), owner: P1 },
        { key: "clownB", def: character({ name: "Party Clowns B", behavior: { abilities: [mayPayInfluence("gang-b")] } }), owner: P1 }
      ]
    });

    const startInfluence = engine.state.players[P1].influence;

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    // Both triggers fired at once — order them. (Each `pendingChoice` is read
    // into a fresh local so `assert.equal`'s narrowing doesn't leak forward
    // and collapse the next read to `never`.)
    const ordering: PendingChoice | undefined = engine.state.pendingChoice;
    assert.equal(ordering?.kind, "orderTriggers");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "orderTriggers", next: { sourceId: id("clownA"), abilityId: "gang-a" } }
    });
    resolvePendingResponses(engine);

    // First picked trigger asks to pay — decline it.
    const firstPay: PendingChoice | undefined = engine.state.pendingChoice;
    assert.equal(firstPay?.kind, "mayPay");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "mayPay", pay: false }
    });
    resolvePendingResponses(engine);

    // The lone remaining trigger must still come up (regression: it used to
    // silently stay queued, leaving pendingChoice undefined until some later
    // action pumped the queue).
    const leftover: PendingChoice | undefined = engine.state.pendingChoice;
    assert.equal(leftover?.kind, "mayPay");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "mayPay", pay: false }
    });
    resolvePendingResponses(engine);

    const settled: PendingChoice | undefined = engine.state.pendingChoice;
    assert.equal(settled, undefined);
    assert.equal(engine.state.players[P1].influence, startInfluence);
  });
});
