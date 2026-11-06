// EU1: `TargetDeclaration.minCount`: "pick at least N". On an optional pick it makes "none, or between N and `count`"
// ("You may deplete 3 tokens": 0 or 3, never 1 or 2). Synthetic fixtures; the printed card (Micromajig Party) is in its
// clause tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ActivatedAbility, CardDefinition, PickStep, PlayAction, TargetDeclaration } from "../../engine.js";
import { answerPlayRequirement } from "../../engine.js";
import { buildGame, character, P1, resolvePendingResponses, tactic } from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";

const ready = { controller: "self" as const, zone: "play" as const, type: "character" as const, depleted: false };
const tokens = (n: number): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `t${i}`, def: character({ name: `Tok${i}` }), owner: P1 }));

/** "EXTRA COST: you may deplete 3 characters. Gain 1 influence. If you depleted 3, return this card to your hand." */
function cheapOrExact(declaration: Partial<TargetDeclaration>, name = "Pledge"): CardDefinition {
  const ability: ActivatedAbility = {
    id: "go",
    type: "activated",
    targets: [{ id: "tok", selector: ready, count: 3, optional: true, minCount: 3, ...declaration }],
    costs: [{ type: "depleteSelected", declarationId: "tok" }],
    effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
  };
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [ability] },
    selfDisposition: {
      to: "hand",
      condition: { type: "numberCompare", left: { type: "selectionCount", id: "tok" }, operator: ">=", right: 3 }
    }
  } as Partial<CardDefinition>);
}

const playAction = (cardId: string, picked?: string[]): PlayAction =>
  ({ type: "playCard", playerId: P1, cardId, ...(picked ? { selected: { tok: picked } } : {}) }) as PlayAction;
const pickStep = (engine: ReturnType<typeof buildGame>["engine"], action: PlayAction): PickStep | undefined =>
  engine.getPlayRequirements(action).find((r): r is PickStep => r.kind === "pick");

describe("EU1 — minCount on an optional pick: none, or at least N", () => {
  const board = (n: number, declaration: Partial<TargetDeclaration> = {}) =>
    buildGame({ cards: [...tokens(n), { key: "card", def: cheapOrExact(declaration), owner: P1, zone: "hand" }] });

  test("0 and exactly 3 play; 1, 2 are refused (and so is more than count)", () => {
    for (const [picked, ok] of [[0, true], [1, false], [2, false], [3, true], [4, false]] as const) {
      const { engine, id } = board(4);
      const ids = Array.from({ length: picked }, (_, i) => id(`t${i}`));
      const action = playAction(id("card"), ids);
      assert.equal(engine.checkAction(action).ok, ok, `${picked} picked`);
      if (!ok) {
        assert.throws(() => engine.perform(action as never), /requires none, or 3 selection/);
        assert.equal(engine.state.cards[id("card")].zone, "hand", "nothing was paid");
        for (const i of ids) assert.equal(engine.state.cards[i].depleted ?? false, false);
      }
    }
  });

  test("the cost is paid only when the pick was 3 (selfDisposition reads the same pick)", () => {
    const three = board(3);
    three.engine.perform(playAction(three.id("card"), [0, 1, 2].map(i => three.id(`t${i}`))) as never);
    resolvePendingResponses(three.engine);
    assert.equal(three.engine.state.cards[three.id("card")].zone, "hand");
    assert.equal(three.engine.state.cards[three.id("t0")].depleted, true);

    const none = board(3);
    none.engine.perform(playAction(none.id("card"), []) as never);
    resolvePendingResponses(none.engine);
    assert.equal(none.engine.state.cards[none.id("card")].zone, "discard");
    assert.equal(none.engine.state.cards[none.id("t0")].depleted ?? false, false);
  });

  test("getPlayRequirements reports min 3, max 3 and orNone; checkPlaySelection agrees with perform", () => {
    const { engine, id } = board(4);
    const action = playAction(id("card"));
    const step = pickStep(engine, action)!;
    assert.equal(step.min, 3);
    assert.equal(step.max, 3);
    assert.equal(step.orNone, true);
    assert.equal(step.forced, false, "an optional pick is never forced");
    assert.equal(step.candidates.length, 4);
    for (const n of [0, 1, 2, 3, 4]) {
      const cardIds = Array.from({ length: n }, (_, i) => id(`t${i}`));
      const check = engine.checkPlaySelection(action, "tok", cardIds);
      assert.equal(check.ok, n === 0 || n === 3, `checkPlaySelection with ${n}`);
      assert.equal(check.ok, engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "tok", cardIds })).ok);
    }
  });

  test("with fewer than N cards to take, nobody is asked: only 'none' is legal", () => {
    const { engine, id } = board(2);
    assert.equal(pickStep(engine, playAction(id("card"))), undefined);
    assert.equal(engine.checkAction(playAction(id("card"), [id("t0"), id("t1")])).ok, false);
    assert.equal(engine.checkAction(playAction(id("card"), [])).ok, true);
  });

  test("minCount below count: none, or 2..3", () => {
    const { engine, id } = board(4, { minCount: 2 });
    const step = pickStep(engine, playAction(id("card")))!;
    assert.deepEqual([step.min, step.max, step.orNone], [2, 3, true]);
    const ok = (n: number) => engine.checkAction(playAction(id("card"), Array.from({ length: n }, (_, i) => id(`t${i}`)))).ok;
    assert.deepEqual([0, 1, 2, 3].map(ok), [true, false, true, true]);
  });

  test("a mandatory pick with minCount is just a lower bound (no orNone)", () => {
    const { engine, id } = board(4, { optional: false, minCount: 2 });
    const step = pickStep(engine, playAction(id("card")))!;
    assert.deepEqual([step.min, step.max, step.orNone], [2, 3, undefined]);
    const ok = (n: number) => engine.checkAction(playAction(id("card"), Array.from({ length: n }, (_, i) => id(`t${i}`)))).ok;
    assert.deepEqual([0, 1, 2, 3].map(ok), [false, false, true, true]);
  });

  test("minCount may be an expression, floored at 0 and capped at count", () => {
    const { engine, id } = board(4, { minCount: { type: "add", values: [4, 5] } });
    const step = pickStep(engine, playAction(id("card")))!;
    assert.deepEqual([step.min, step.max, step.orNone], [3, 3, true]);
  });

  test("a declaration without minCount keeps the 0..count range", () => {
    const { engine, id } = buildGame({
      cards: [
        ...tokens(4),
        { key: "card", def: cheapOrExact({ minCount: undefined }), owner: P1, zone: "hand" }
      ]
    });
    const step = pickStep(engine, playAction(id("card")))!;
    assert.deepEqual([step.min, step.max, step.orNone], [0, 3, undefined]);
  });
});

describe("EU1 — minCount on a chooser's pick", () => {
  test("chooserSelectsTarget: an optional pick of 2 is none or exactly 2", () => {
    const ability: ActivatedAbility = {
      id: "go",
      type: "activated",
      effects: [
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "p", selector: { zone: "play", type: "character" }, count: 2, optional: true, minCount: 2 },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
        } as never
      ]
    };
    const answer = (n: number) => {
      const { engine, id } = buildGame({
        cards: [
          ...tokens(3),
          { key: "card", def: tactic({ name: "Pair", cost: 0, behavior: { abilities: [ability] } }), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("card") } as never);
      resolvePendingResponses(engine);
      const pending = engine.state.pendingChoice;
      if (pending?.kind !== "chooserSelectsTarget") return "no prompt";
      const selected = Array.from({ length: n }, (_, i) => id(`t${i}`));
      try {
        engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
        return "ok";
      } catch {
        return "refused";
      }
    };
    assert.deepEqual([0, 1, 2, 3].map(answer), ["ok", "refused", "ok", "refused"]);
  });
});

describe("EU1 — minCount on a triggered ability's targets (selectTargets)", () => {
  test("an optional pick of 2 is none or exactly 2", () => {
    const watcher = character({
      name: "Watcher",
      behavior: {
        abilities: [
          {
            id: "w",
            type: "triggered",
            event: "cardEnteredPlay",
            targets: [{ id: "p", selector: { zone: "play", type: "character", name: "Tok" }, count: 2, optional: true, minCount: 2 }],
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      } as never
    });
    const answer = (n: number) => {
      const { engine, id } = buildGame({
        cards: [
          ...Array.from({ length: 3 }, (_, i) => ({ key: `k${i}`, def: character({ name: "Tok" }), owner: P1 }) as CardPlacement),
          { key: "w", def: watcher, owner: P1 },
          { key: "r", def: tactic({ name: "x" }), owner: P1, zone: "hand" }
        ]
      });
      // Put a resource into play through the engine's own event path.
      (engine as unknown as { emit(e: object): void }).emit({ type: "cardEnteredPlay", cardId: id("k0"), playerId: P1, from: "hand" });
      (engine as unknown as { processImmediateQueue(): void }).processImmediateQueue();
      const pending = engine.state.pendingChoice;
      if (pending?.kind !== "selectTargets") return `no prompt (${pending?.kind})`;
      const selected = Array.from({ length: n }, (_, i) => id(`k${i}`));
      try {
        engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { p: selected } } } as never);
        return "ok";
      } catch {
        return "refused";
      }
    };
    assert.deepEqual([0, 1, 2, 3].map(answer), ["ok", "refused", "ok", "refused"]);
  });
});
