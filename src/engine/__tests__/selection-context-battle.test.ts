// A trigger's `selectTargets` prompt carries its context (`pending.context`), so `getSelectionRequirements` can judge
// an event-reading pick exactly as the answer is judged. Kept apart from selection-context.test.ts because the battle
// helpers come from the clause harness (it patches `perform`; each test file runs in its own process).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PendingChoice, PickStep, PlayRequirement } from "../../engine.js";
import { buildGame, cardDef, developFaction, item, P1, P2 } from "./per-card/_harness.js";
import { fightThrough } from "./clauses/_battle.js";
import { fillers } from "./clauses/_board.js";
import { declineAll } from "./clauses/_clause.js";

const pickOf = (steps: PlayRequirement[]) => steps.find((step): step is PickStep => step.kind === "pick");

/** Totally Random Kid (strength 1) hits the opponent's faction: "You may pick an item with X or less numeric cost
 *  and destroy it", X = the damage it inflicted (the event's amount). */
describe("selectTargets carries the trigger's context", () => {
  test("Totally Random Kid's item pick lists exactly the items the engine accepts (cost <= the damage dealt)", () => {
    const game = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "kid", def: cardDef("Shade of the Devoured Emperor", "Totally Random Kid"), owner: P1, zone: "play" },
        ...fillers("od", 6, P2, "deck"),
        ...fillers("md", 6, P1, "deck"),
        { key: "i0", def: item({ name: "Free Item", cost: 0 }), owner: P2, zone: "play" },
        { key: "i1", def: item({ name: "Cheap Item", cost: 1 }), owner: P2, zone: "play" },
        { key: "i2", def: item({ name: "Two Item", cost: 2 }), owner: P2, zone: "play" }
      ]
    });
    let checked = false;
    fightThrough(game.engine, P1, [game.id("kid")], { type: "faction", playerId: P2 }, [], undefined, (pc) => {
      if (pc.kind !== "selectTargets") return declineAll(pc);
      const pending = game.engine.state.pendingChoice as Extract<PendingChoice, { kind: "selectTargets" }>;
      assert.ok(pending.context?.event, "the prompt carries the trigger's event");
      const input = {
        sourceId: pending.sourceId,
        controllerId: pending.playerId,
        ...(pending.abilityId ? { abilityId: pending.abilityId } : {}),
        declarations: pending.declarations,
        costs: [],
        selected: {},
        variables: {}
      };
      const pick = pickOf(game.engine.getSelectionRequirements({ ...input, context: pending.context }));
      assert.ok(pick, "the item pick is asked");
      assert.deepEqual([...pick.candidates].sort(), [game.id("i0"), game.id("i1")].sort(), "X = 1: the 0- and 1-cost items");
      for (const cardId of pick.candidates) {
        const verdict = game.engine.checkAction({
          type: "resolvePendingChoice",
          playerId: pending.playerId,
          choice: { kind: "selectTargets", selected: { [pick.requirement.id]: [cardId] } }
        });
        assert.deepEqual(verdict, { ok: true }, `${cardId} is accepted`);
      }
      const tooDear = game.engine.checkAction({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "selectTargets", selected: { [pick.requirement.id]: [game.id("i2")] } }
      });
      assert.equal(tooDear.ok, false, "the 2-cost item is refused");
      checked = true;
      return { kind: "selectTargets", selected: { [pick.requirement.id]: [] } };
    });
    assert.ok(checked, "the Kid's prompt was reached");
  });
});
