import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  P1,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";

describe("RULES.md §4 — thresholds", () => {
  test("a card cannot be played without meeting its threshold", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage", resource: { provides: ["rage"] } }), owner: P1 },
        { key: "bigAttack", def: tactic({ name: "Big Attack", threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("bigAttack") })
    );
  });

  test("meeting the threshold does not consume it — two threshold-gated cards can be played off the same resources", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1", resource: { provides: ["rage"] } }), owner: P1 },
        { key: "rage2", def: resourceCard({ name: "Rage 2", resource: { provides: ["rage"] } }), owner: P1 },
        { key: "attackA", def: tactic({ name: "Attack A", threshold: "rr" }), owner: P1, zone: "hand" },
        { key: "attackB", def: tactic({ name: "Attack B", threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("attackA") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("attackB") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("attackA")].zone, "discard");
    assert.equal(engine.state.cards[id("attackB")].zone, "discard");
  });
});

describe("RULES.md §4 — numeric costs", () => {
  test("playing a card attaches that many unattached resources to the controller's faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    assert.equal(engine.getAvailableResourceCount(P1), 3);

    engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget") });
    resolvePendingResponses(engine);

    assert.equal(engine.getAvailableResourceCount(P1), 1);
    assert.equal(engine.state.cards[id("gadget")].zone, "play");
  });

  test("a card cannot be played without enough unattached resources", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget") })
    );
  });
});

describe("RULES.md §4 — Volition", () => {
  test("a face-down resource provides Volition regardless of the underlying card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hiddenResource", def: character({ name: "Anything" }), owner: P1, faceDown: true },
        { key: "storyCard", def: tactic({ name: "Story Card", trade: "universal", threshold: "v" }), owner: P1, zone: "hand" }
      ]
    });

    const thresholds = engine.getThresholds(P1);
    assert.equal(thresholds.volition, 1);

    engine.perform({ type: "playCard", playerId: P1, cardId: id("storyCard") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("storyCard")].zone, "discard");
  });

  test("a face-up resource of a known trade does not provide Volition", () => {
    const { engine } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage", resource: { provides: ["rage"] } }), owner: P1 }
      ]
    });

    const thresholds = engine.getThresholds(P1);
    assert.equal(thresholds.volition ?? 0, 0);
    assert.equal(thresholds.rage, 1);
  });
});
