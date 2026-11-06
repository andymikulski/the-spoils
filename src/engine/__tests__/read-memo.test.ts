// withReadMemo: the opt-in per-version read memo. Reads inside a scope must equal reads outside it, the memo must end
// with the scope and with every engine mutation (perform), and an engine cloned/rebuilt from the state starts clean.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, developFaction, play, tactic, volition, P1, P2 } from "./per-card/_harness.js";
import { SpoilsEngine } from "../SpoilsEngine.js";
import type { Stat } from "../../types/index.js";

const ALL_STATS: Stat[] = ["strength", "life", "speed", "influence", "structure"];

const buffed = () =>
  character({
    name: "Buffed",
    strength: 1,
    behavior: {
      abilities: [{ id: "own", type: "continuous", keywords: [{ target: "source", keyword: "tactical" }], modifiers: [{ target: "source", stat: "strength", operation: "add", value: 4 }] }]
    }
  });

const smash = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const game = () =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "buffed", def: buffed(), owner: P1, zone: "play" },
      { key: "smash", def: smash(), owner: P1, zone: "hand" },
      ...volition(2, P1)
    ] as never
  });

function snapshot(engine: SpoilsEngine, ids: string[]): unknown {
  return {
    thresholds: [engine.getThresholds(P1), engine.getThresholds(P2)],
    protections: engine.getActiveProtections(),
    cards: ids.map(id => ({
      stats: ALL_STATS.map(stat => [engine.getStat(id, stat), engine.getStatModifiers(id, stat)]),
      keywords: engine.getKeywords(id),
      keywordSources: engine.getKeywordGrantSources(id),
      restrictions: engine.getRestrictions(id),
      restrictionSources: engine.getRestrictionSources(id)
    }))
  };
}

describe("withReadMemo", () => {
  test("reads inside a scope equal reads outside it, and repeated reads are independent copies", () => {
    const g = game();
    const ids = Object.keys(g.engine.state.cards);
    const plain = snapshot(g.engine, ids);
    const scoped = g.engine.withReadMemo(() => [snapshot(g.engine, ids), snapshot(g.engine, ids)]);
    assert.deepEqual(scoped[0], plain);
    assert.deepEqual(scoped[1], plain);
    g.engine.withReadMemo(() => {
      const first = g.engine.getThresholds(P1);
      first.obsession = 99;
      assert.notEqual(g.engine.getThresholds(P1).obsession, 99, "a caller editing its copy cannot poison the memo");
    });
  });

  test("perform inside a scope drops the memo: later reads see the new state", () => {
    const g = game();
    const buffedId = g.id("buffed");
    g.engine.withReadMemo(() => {
      assert.equal(g.engine.getStat(buffedId, "strength"), 5);
      assert.deepEqual(g.engine.getKeywords(buffedId), ["tactical"]);
      play(g.engine, P1, g.id("smash"), { selected: { t: [buffedId] } });
      assert.equal(g.engine.state.cards[buffedId].zone, "discard");
      assert.equal(g.engine.getStat(buffedId, "strength"), 1);
      assert.deepEqual(g.engine.getKeywords(buffedId), []);
      assert.equal(g.engine.getStat(buffedId, "strength"), 1);
    });
  });

  test("the memo ends with the scope: a direct state edit afterwards is seen; a rebuilt engine starts clean", () => {
    const g = game();
    const buffedId = g.id("buffed");
    g.engine.withReadMemo(() => assert.equal(g.engine.getStat(buffedId, "strength"), 5));
    g.engine.state.modifiers.push({
      id: "m1",
      targetId: buffedId,
      stat: "strength",
      operation: "add",
      value: 10,
      duration: { type: "permanent" },
      createdTurn: g.engine.state.turn
    } as never);
    assert.equal(g.engine.getStat(buffedId, "strength"), 15);

    const outer = g.engine;
    const rebuilt = outer.withReadMemo(() => {
      assert.equal(outer.getStat(buffedId, "strength"), 15);
      const copy = new SpoilsEngine(Object.values(outer.definitions), structuredClone(outer.state));
      copy.state.modifiers.length = 0;
      return copy.getStat(buffedId, "strength");
    });
    assert.equal(rebuilt, 5, "a clone built inside a scope does not inherit the memo");
  });
});
