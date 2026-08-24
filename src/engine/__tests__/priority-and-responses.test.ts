import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2, resolvePendingResponses, tactic } from "./support/fixtures.js";
import type { TargetDeclaration } from "../../engine.js";

const TARGET_DECL: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];

describe("RULES.md §7 — priority and response windows", () => {
  test("playing a card opens a response window and hands priority to the opponent", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "someTactic", def: tactic({ name: "Some Tactic" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("someTactic") });

    assert.ok(engine.state.responseWindow);
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  });

  test("a plain (non-Tactic, non-Tactical) card cannot be deployed into a response window", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "someTactic", def: tactic({ name: "Some Tactic" }), owner: P1, zone: "hand" },
        { key: "plainCharacter", def: character({ name: "Plain" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("someTactic") });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("plainCharacter") })
    );
  });

  test("a Tactic can always be deployed into a response window", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
        { key: "response", def: tactic({ name: "Response" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("response") });

    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("opener")].zone, "discard");
    assert.equal(engine.state.cards[id("response")].zone, "discard");
  });

  test("the most recently added response resolves first (LIFO)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mark", def: character({ name: "Mark" }), owner: P1, depleted: false },
        {
          key: "deplete",
          def: tactic({
            name: "Deplete Mark",
            behavior: { abilities: [{ id: "a", type: "activated", targets: TARGET_DECL, effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] }
          }),
          owner: P1,
          zone: "hand"
        },
        {
          key: "restore",
          def: tactic({
            name: "Restore Mark",
            behavior: { abilities: [{ id: "a", type: "activated", targets: TARGET_DECL, effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
          }),
          owner: P2,
          zone: "hand"
        }
      ]
    });

    // P1 plays "Deplete Mark" as a normal turn action...
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("deplete"),
      selected: { t: [id("mark")] }
    });

    // ...P2 responds with "Restore Mark", added on top of the stack.
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("restore"),
      selected: { t: [id("mark")] }
    });

    resolvePendingResponses(engine);

    // LIFO: Restore (added last) resolves first, then Deplete resolves last —
    // so Mark ends up depleted, not restored.
    assert.equal(engine.state.cards[id("mark")].depleted, true);
  });

  test("a card with the Tactical keyword can be deployed into a response window despite not being a Tactic", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
        {
          key: "flashCharacter",
          def: character({ name: "Flash Guy", behavior: { keywords: ["tactical"] } }),
          owner: P2,
          zone: "hand"
        }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("flashCharacter") });

    resolvePendingResponses(engine);

    // Characters resolve into play, not discard — unlike Tactics.
    assert.equal(engine.state.cards[id("flashCharacter")].zone, "play");
    assert.equal(engine.state.cards[id("flashCharacter")].controllerId, P2);
  });

  test("a response window closes only after both players pass consecutively", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");

    engine.perform({ type: "passPriority", playerId: P2 });
    // Only one pass so far — window is still open, waiting on P1.
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);

    engine.perform({ type: "passPriority", playerId: P1 });
    // Two consecutive passes — window is now resolving.
    assert.equal(engine.state.responseWindow?.phase, "resolving");
  });
});
