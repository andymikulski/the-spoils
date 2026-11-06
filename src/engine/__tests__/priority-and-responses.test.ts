import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
import type { TargetDeclaration } from "../../engine.js";

const TARGET_DECL: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];

/** A tactic whose whole effect is "deal 1 damage to the opponent's faction". */
const pingTactic = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          effects: [
            { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }
          ]
        }
      ]
    }
  });

describe("RULES.md §7 (CR §607) — responding to actions", () => {
  test("deploying a card opens a response window; only the opponent is handed priority", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });

    const w = engine.state.responseWindow;
    assert.ok(w, "w");
    assert.equal(w?.kind, "action");
    assert.equal(w?.phase, "acceptingResponses");
    assert.equal(w?.priorityPlayerId, P2);
    // An `action` window is driven entirely by its stack item — no top-level
    // responder queue (CR §607.2b: no priority-passing system).
    assert.deepEqual(w?.pendingResponders, []);
  });

  test("a plain (non-Tactic, non-TACTICAL) card cannot be deployed as a response", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
        { key: "plainCharacter", def: character({ name: "Plain" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("plainCharacter") })
    );
  });

  test("a Tactic can always be deployed as a response", () => {
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

  test("a TACTICAL card may be deployed as a response despite not being a Tactic", () => {
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

    // A TACTICAL character still resolves into play, not the discard pile.
    assert.equal(engine.state.cards[id("flashCharacter")].zone, "play");
    assert.equal(engine.state.cards[id("flashCharacter")].controllerId, P2);
  });

  test("nested responses resolve last-in, first-out (CR §607.2a)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mark", def: character({ name: "Mark" }), owner: P1, depleted: false },
        {
          key: "deplete",
          def: tactic({
            name: "Deplete Mark",
            behavior: {
              abilities: [
                {
                  id: "a",
                  type: "activated",
                  targets: TARGET_DECL,
                  effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
                }
              ]
            }
          }),
          owner: P1,
          zone: "hand"
        },
        {
          key: "restore",
          def: tactic({
            name: "Restore Mark",
            behavior: {
              abilities: [
                {
                  id: "a",
                  type: "activated",
                  targets: TARGET_DECL,
                  effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
                }
              ]
            }
          }),
          owner: P2,
          zone: "hand"
        }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("deplete"),
      selected: { t: [id("mark")] }
    });
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("restore"),
      selected: { t: [id("mark")] }
    });

    resolvePendingResponses(engine);

    // Restore (added last) resolves first, then Deplete resolves last.
    assert.equal(engine.state.cards[id("mark")].depleted, true);
  });

  describe("CR §607.1 — you cannot respond to your own action", () => {
    test("the acting player is never handed priority and cannot pass or respond to their own card", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
          { key: "p1Response", def: tactic({ name: "P1 Response" }), owner: P1, zone: "hand" }
        ]
      });

      engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });

      assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
      assert.equal(engine.state.priorityPlayerId, P2);

      // P1 owns the action on the stack — they have no priority pass of
      // their own (CR §607.2b) and cannot stack a response onto it.
      assert.throws(() => engine.perform({ type: "passPriority", playerId: P1 }));
      assert.throws(() =>
        engine.perform({ type: "playCard", playerId: P1, cardId: id("p1Response") })
      );
    });

    test("the acting player cannot activate an ability in response to their own action", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "opener", def: tactic({ name: "Opener" }), owner: P1, zone: "hand" },
          {
            key: "engine",
            def: character({
              name: "Ability Engine",
              behavior: {
                abilities: [
                  {
                    id: "go",
                    type: "activated",
                    effects: [{ type: "draw", player: "controller", amount: 1 }]
                  }
                ]
              }
            }),
            owner: P1
          }
        ]
      });

      engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });

      assert.throws(() =>
        engine.perform({
          type: "activateAbility",
          playerId: P1,
          cardId: id("engine"),
          abilityId: "go"
        })
      );
    });
  });

  test("an `action` window closes as soon as the opponent passes — no second pass from the actor", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "opener", def: pingTactic("Ping"), owner: P1, zone: "hand" }]
    });
    const startInfluence = engine.state.players[P2].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");

    // One decline from the opponent is enough (CR §604.1g / §607.2b).
    engine.perform({ type: "passPriority", playerId: P2 });
    assert.equal(engine.state.responseWindow?.phase, "resolving");

    engine.perform({ type: "advanceFlow" });

    assert.equal(engine.state.responseWindow, undefined);
    assert.equal(engine.state.responseStack.length, 0);
    assert.equal(engine.state.cards[id("opener")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, startInfluence - 1);
    assert.equal(engine.getFlowView().mode, "main");
  });

  test("after a nested response resolves, the opponent gets a fresh window on the original action (CR §607.2)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: pingTactic("A"), owner: P1, zone: "hand" },
        { key: "b", def: pingTactic("B"), owner: P2, zone: "hand" },
        { key: "c", def: pingTactic("C"), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    // P2 responds to A with B.
    engine.perform({ type: "playCard", playerId: P2, cardId: id("b") });

    // Priority is now P1's — but only to respond to B, the item P2 just
    // added. P1 declines.
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
    engine.perform({ type: "passPriority", playerId: P1 });
    assert.equal(engine.state.responseWindow?.phase, "resolving");

    // B resolves; the window re-opens for P2 to make another response to A.
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    assert.equal(engine.state.responseStack.length, 1, "A is still waiting");

    // P2 takes that opportunity: a second response, stacked on A.
    engine.perform({ type: "playCard", playerId: P2, cardId: id("c") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);

    resolvePendingResponses(engine);

    assert.equal(engine.state.responseWindow, undefined);
    assert.equal(engine.state.cards[id("a")].zone, "discard");
    assert.equal(engine.state.cards[id("b")].zone, "discard");
    assert.equal(engine.state.cards[id("c")].zone, "discard");
  });

  test("CR §607.1 — an `endTurn` announcement is answered only by the opponent, and one pass ends it", () => {
    const { engine } = buildGame({ cards: [] });

    engine.perform({ type: "endTurn", playerId: P1 });

    const w = engine.state.responseWindow;
    assert.equal(w?.kind, "endTurn");
    assert.equal(w?.priorityPlayerId, P2);
    assert.deepEqual(w?.pendingResponders, [P2]);

    // The turn-ender gets no pass of their own.
    assert.throws(() => engine.perform({ type: "passPriority", playerId: P1 }));

    engine.perform({ type: "passPriority", playerId: P2 });
    assert.equal(engine.state.responseWindow?.phase, "resolving");

    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.responseWindow, undefined);
    assert.equal(engine.state.activePlayerId, P2, "the turn actually changed");
  });

  describe("CR §608.1c / §609.1a — battle response windows are two-sided (attacker, then defender)", () => {
    test("the attacker acts first, then the defender; each single pass advances", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "atk", def: character({ name: "Atk", strength: 2 }), owner: P1 }
        ]
      });

      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("atk")],
        target: { type: "faction", playerId: P2 }
      });

      const w = engine.state.responseWindow;
      assert.equal(w?.kind, "battleAfterAttackers");
      assert.equal(w?.priorityPlayerId, P1);
      assert.deepEqual(w?.pendingResponders, [P1, P2]);

      // Attacker declines -> hand off to the defender, same window.
      engine.perform({ type: "passPriority", playerId: P1 });
      assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
      assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);

      // Defender declines -> window done, battle proceeds to blocking.
      engine.perform({ type: "passPriority", playerId: P2 });
      assert.equal(engine.state.responseWindow?.phase, "resolving");
      engine.perform({ type: "advanceFlow" });
      assert.equal(engine.state.responseWindow, undefined);
      assert.equal(engine.state.battle?.phase, "blocking");
    });

    test("the attacker may deploy several tactics in a row before the defender's turn", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "atk", def: character({ name: "Atk", strength: 2 }), owner: P1 },
          { key: "t1", def: pingTactic("Ping 1"), owner: P1, zone: "hand" },
          { key: "t2", def: pingTactic("Ping 2"), owner: P1, zone: "hand" }
        ]
      });
      const startInfluence = engine.state.players[P2].influence;

      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("atk")],
        target: { type: "faction", playerId: P2 }
      });

      engine.perform({ type: "playCard", playerId: P1, cardId: id("t1") });
      // Defender declines to respond to the first tactic.
      engine.perform({ type: "passPriority", playerId: P2 });
      engine.perform({ type: "advanceFlow" });

      // The window comes back to the attacker for another tactic.
      assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
      assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("t2") });

      resolvePendingResponses(engine);

      assert.equal(engine.state.players[P2].influence, startInfluence - 2, "both tactics resolved");
      assert.equal(engine.state.battle?.phase, "blocking");
    });
  });
});
