// `getSelectionRequirements({ ..., context })`: a prompt's picks are judged in the prompt's own resolution context,
// exactly as `resolvePendingChoice` judges the answer. Without it, a pick whose selector reads the triggering event
// ("a character with less strength than THAT character had") has no event to read and lists nothing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PendingChoice, PickStep, PlayRequirement } from "../../engine.js";
import { bank, buildGame, cardDef, character, developFaction, killTactic, play, P1, P2 } from "./per-card/_harness.js";

/** Gosche's Restoration Fortress: "When a character you control with a token on it leaves play, you may pick a
 *  character with less strength than that character had and restore it." Tok (strength 3, a token) is destroyed. */
function fortressPrompt() {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "fort", def: cardDef("Ungodly Mess", "Gosche's Restoration Fortress"), owner: P1, zone: "play" },
      { key: "tok", def: character({ name: "Tok", strength: 3, life: 9 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "mylow", def: character({ name: "MyLow", strength: 1, life: 9 }), owner: P1, zone: "play", depleted: true },
      { key: "low", def: character({ name: "Low", strength: 2, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "eq", def: character({ name: "Eq", strength: 3, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1)
    ]
  });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("tok")] } });
  const pending = game.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsTarget" }> | undefined;
  assert.equal(pending?.kind, "chooserSelectsTarget", "the Fortress asks for its restore pick");
  return { game, pending: pending! };
}

const pickOf = (steps: PlayRequirement[]) => steps.find((step): step is PickStep => step.kind === "pick");

describe("getSelectionRequirements with the prompt's context", () => {
  test("a pick that reads the triggering event lists exactly the cards the engine accepts", () => {
    const { game, pending } = fortressPrompt();
    const input = {
      sourceId: pending.context.sourceId,
      controllerId: pending.context.controllerId,
      pickerId: pending.playerId,
      declarations: [pending.declaration],
      costs: [],
      selected: {},
      variables: {}
    };
    const pick = pickOf(game.engine.getSelectionRequirements({ ...input, context: pending.context }));
    assert.ok(pick, "a pick is asked");
    const ids = (keys: string[]) => keys.map((key) => game.id(key)).sort();
    assert.deepEqual([...pick.candidates].sort(), ids(["mylow", "low"]), "strength below Tok's 3: MyLow and Low");

    // Agreement: every listed card is accepted as the answer; a strength-3 card is refused.
    for (const cardId of pick.candidates) {
      const verdict = game.engine.checkAction({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [cardId] }
      });
      assert.deepEqual(verdict, { ok: true }, `${cardId} is accepted`);
    }
    const refusedVerdict = game.engine.checkAction({
      type: "resolvePendingChoice",
      playerId: pending.playerId,
      choice: { kind: "chooserSelectsTarget", selected: [game.id("eq")] }
    });
    assert.equal(refusedVerdict.ok, false, "Eq (strength 3, not less) is refused");

    // Without the prompt's context there is no event to compare against.
    const blind = pickOf(game.engine.getSelectionRequirements(input));
    assert.notDeepEqual(blind?.candidates.slice().sort(), pick.candidates.slice().sort(), "the context is what makes the list right");
  });

  test("a stale entry for the pick being asked does not count as already answered", () => {
    const { game, pending } = fortressPrompt();
    const context = { ...pending.context, selected: { ...pending.context.selected, [pending.declaration.id]: [game.id("eq")] } };
    const pick = pickOf(
      game.engine.getSelectionRequirements({
        sourceId: context.sourceId,
        controllerId: context.controllerId,
        pickerId: pending.playerId,
        declarations: [pending.declaration],
        costs: [],
        selected: {},
        variables: {},
        context
      })
    );
    assert.ok(pick, "still asked");
    assert.ok(!pick.candidates.includes(game.id("eq")));
  });

  test("asking leaves the live game untouched", () => {
    const { game, pending } = fortressPrompt();
    const before = JSON.stringify(game.engine.state);
    game.engine.getSelectionRequirements({
      sourceId: pending.context.sourceId,
      controllerId: pending.context.controllerId,
      declarations: [pending.declaration],
      costs: [],
      selected: {},
      variables: {},
      context: pending.context
    });
    assert.equal(JSON.stringify(game.engine.state), before);
  });
});
