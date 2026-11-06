import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { autoResolveBattle, buildGame, character, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import { developDraw, settleTurnStart } from "./support/develop.js";

describe("RULES.md §1 — victory", () => {
  test("a player at 0 influence loses the game", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 3 },
      cards: [{ key: "attacker", def: character({ name: "Finisher", strength: 3 }), owner: P1 }]
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

    assert.equal(engine.state.players[P2].influence, 0);
    assert.equal(engine.state.winner, P1);
    assert.equal(engine.getFlowView().winner, P1);
    assert.equal(engine.getFlowView().mode, "gameOver");
  });

  test("dropping a faction below 0 (not just to exactly 0) still ends the game", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 2 },
      cards: [{ key: "attacker", def: character({ name: "Overkill", strength: 9 }), owner: P1 }]
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

    assert.ok(engine.state.players[P2].influence <= 0, "engine.state.players[P2].influence <= 0");
    assert.equal(engine.state.winner, P1);
  });

  test("no further actions can be performed once the game has ended", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 3 },
      cards: [{ key: "attacker", def: character({ name: "Finisher", strength: 3 }), owner: P1 }]
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

    assert.throws(() => engine.perform({ type: "passPriority", playerId: P1 }));
  });

  test("CR §102.1a / §306.2 — running out of cards to draw does not lose the game", () => {
    const { engine } = buildGame({ cards: [] });

    // P1's deck is empty (buildGame places no deck cards). Draw well past it.
    assert.equal(engine.state.players[P1].deck.length, 0);
    developDraw(engine, P1);
    for (let i = 0; i < 5; i++) {
      engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(engine);
      settleTurnStart(engine, "draw");
      engine.perform({ type: "endTurn", playerId: P2 });
      resolvePendingResponses(engine);
      settleTurnStart(engine, "draw");
    }

    assert.equal(engine.state.winner, undefined);
    assert.equal(engine.getFlowView().mode, "main");
  });

  test("both factions hitting 0 influence at once is a draw", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 0 },
      playerB: { influence: 0 },
      cards: [
        {
          key: "noop",
          def: character({ name: "No-op", behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }),
          owner: P1
        }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("noop"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.winner, "draw");
  });
});
