import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  P1,
  bank,
  buildGame,
  cardDef,
  developFaction,
  tactic
} from "./per-card/_harness.js";
import { flipUpNow } from "./clauses/_clause.js";
import { attachedCount } from "./clauses/_turn.js";

// A face-down tactic that has its own printed FLIP UP (cost 1) and also gains the
// Gloamspike-granted one (its regular numeric cost, 3): two FLIP UP options (Q35).
const GLOAM = "Woadenworm Gloamspike, Thabbashite Prince";
const twoOptionTactic = () => ({
  ...tactic({ name: "Two Ways", cost: 3, threshold: "o", flipUp: { cost: 1, threshold: "o" } }),
  id: "e9b-two-ways"
});

function board(obsession = 6) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "g", def: cardDef("Seed 2", GLOAM), owner: P1, zone: "play" },
      { key: "fd", def: twoOptionTactic(), owner: P1, zone: "play", faceDown: true },
      ...bank("obsession", obsession, P1)
    ]
  });
}

const ready = (b: ReturnType<typeof board>) => b.engine.getAvailableResourceCount(P1);
/** Resources spent so far (the face-down card itself is a ready resource until it flips, so ready-count deltas are off by one). */
const spent = (b: ReturnType<typeof board>) => attachedCount(b.engine, P1);

describe("explicit FLIP UP option (Q35 follow-up)", () => {
  test("the card has two options: the printed one, then the granted one", () => {
    const b = board();
    const options = b.engine.getFlipUpOptions(b.id("fd"));
    assert.deepEqual(options.map((o) => o.cost), [1, 3]);
  });

  test("omitted: the first affordable option (the printed one) is used", () => {
    const b = board();
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd") });
    assert.equal(spent(b), 1, "paid the printed FLIP UP cost of 1");
  });

  test("flipUpOption 1 pays the granted option (its numeric cost, 3)", () => {
    const b = board();
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), flipUpOption: 1 });
    assert.equal(spent(b), 3, "paid the granted FLIP UP cost of 3");
    assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false);
  });

  test("flipUpOption 0 names the printed option explicitly", () => {
    const b = board();
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), flipUpOption: 0 });
    assert.equal(spent(b), 1);
  });

  test("an unknown option is refused and nothing is paid", () => {
    for (const bad of [2, -1, 0.5]) {
      const b = board();
      const before = ready(b);
      assert.throws(
        () => b.engine.perform({ type: "flipUp", playerId: P1, cardId: b.id("fd"), flipUpOption: bad } as never),
        /Unknown FLIP UP option/,
        `option ${bad}`
      );
      assert.equal(ready(b), before, "nothing was paid");
      assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
    }
  });

  test("a named option that cannot be afforded is refused, even though the other one could be paid", () => {
    // 1 [O] + the face-down card itself (it may pay for its own FLIP UP): the printed cost (1) is affordable, the granted one (3) is not.
    const b = board(1);
    assert.throws(
      () => b.engine.perform({ type: "flipUp", playerId: P1, cardId: b.id("fd"), flipUpOption: 1 } as never),
      /cannot be paid|Not enough|FLIP UP/i
    );
    assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), flipUpOption: 0 });
    assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false, "control: the printed option works");
  });
});
