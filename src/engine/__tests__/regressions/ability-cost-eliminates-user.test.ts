// An activated ability whose cost is paid in influence can take its user's faction to 0. At three or more seats that
// player is eliminated as the cost is paid (RQ-mp-3: their stack items are removed), and the ability must not then be
// put on the stack under an eliminated controller. Found by the seat fuzz (4 seats seed 104, 3 seats seed 108,
// 5 seats seed 104 of `npm run fuzz -- --first 100`: "p3 has lost but still has the ability on the stack").

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { character, item, P1, P2, P3, P4 } from "../support/fixtures.js";
import { ACTIVATED, board, TABLES } from "../rules/_mpTable.js";

describe("an ability paid for with the user's last influence", () => {
  for (const count of TABLES) {
    test(`${count} seats: the user is out, the ability never reaches the stack, the table plays on`, () => {
      const gasp = item({
        name: "Last Gasp",
        behavior: ACTIVATED({ costs: [{ type: "loseInfluence", amount: 3 }], effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] })
      });
      const t = board(count, character({ name: "Spell" }), [{ key: "gasp", def: gasp, owner: P1 }]);
      const engine = t.engine;
      engine.state.players[P1]!.influence = 3;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("gasp"), abilityId: "go" });

      assert.ok(engine.state.players[P1]!.eliminated, "paying down to 0 influence eliminates P1");
      assert.equal(engine.state.winner, undefined, "the others play on");
      assert.deepEqual(
        engine.getFlowView().responseStack.filter(stackItem => stackItem.controllerId === P1),
        [],
        "nothing of the eliminated player is on the stack"
      );
      assert.equal(engine.getLog().some(entry => entry.event?.type === "abilityActivated"), false, "the ability was not used");
      assert.notEqual(engine.state.activePlayerId, P1);
      for (const other of [P2, P3, P4].slice(0, count - 1)) assert.equal(engine.state.players[other]!.eliminated, undefined);
    });
  }
});
