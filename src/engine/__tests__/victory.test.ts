import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { autoResolveBattle, buildGame, character, P1, P2, resolvePendingResponses } from "./support/fixtures.js";

describe("RULES.md §1 — victory", () => {
  test(
    "a player at 0 influence loses the game",
    { todo: "engine gap: nothing checks for 0 influence and ends the game — see RULES.md §1" },
    () => {
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

      const flow = engine.getFlowView();
      // There is currently no "gameOver"/winner concept on GameFlowView at all.
      assert.ok((flow as unknown as { winner?: unknown }).winner !== undefined);
    }
  );
});
