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
import type { ActivatedAbility } from "../../engine.js";

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

  test("a face-down card's own activated abilities cannot be activated — it's an anonymous resource", () => {
    // Same principle findTriggers/getContinuousModifiers already apply to
    // triggered and continuous abilities on a face-down source: a card
    // played face-down as a resource exposes nothing but Volition.
    const gadget: ActivatedAbility = {
      id: "gadget-zap",
      type: "activated",
      effects: []
    };

    const { engine, id } = buildGame({
      cards: [
        {
          key: "hiddenGadget",
          def: item({ name: "Zapper", behavior: { abilities: [gadget] } }),
          owner: P1,
          faceDown: true
        }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("hiddenGadget"), abilityId: "gadget-zap" })
    );
  });
});

describe("RULES.md §4/§10 — discard costs require an explicit choice", () => {
  function discardTwoAbility(): ActivatedAbility {
    return {
      id: "discardTwo",
      type: "activated",
      costs: [{ type: "discard", id: "toDiscard", player: "controller", selector: {}, count: 2 }],
      effects: []
    };
  }

  test("activation is rejected without an explicit discard selection", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [discardTwoAbility()] } }), owner: P1 },
        { key: "handA", def: character({ name: "Hand A" }), owner: P1, zone: "hand" },
        { key: "handB", def: character({ name: "Hand B" }), owner: P1, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("caster"), abilityId: "discardTwo" })
    );
  });

  test("the player's explicit selection decides exactly which cards are discarded", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [discardTwoAbility()] } }), owner: P1 },
        { key: "handA", def: character({ name: "Hand A" }), owner: P1, zone: "hand" },
        { key: "handB", def: character({ name: "Hand B" }), owner: P1, zone: "hand" },
        { key: "handC", def: character({ name: "Hand C" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("caster"),
      abilityId: "discardTwo",
      selected: { toDiscard: [id("handA"), id("handC")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("handA")].zone, "discard");
    assert.equal(engine.state.cards[id("handC")].zone, "discard");
    assert.equal(engine.state.cards[id("handB")].zone, "hand");
  });

  test("a selection naming a card the player doesn't control is rejected", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [discardTwoAbility()] } }), owner: P1 },
        { key: "handA", def: character({ name: "Hand A" }), owner: P1, zone: "hand" },
        { key: "handB", def: character({ name: "Hand B" }), owner: P1, zone: "hand" },
        { key: "notMine", def: character({ name: "Not Mine" }), owner: "p2", zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "discardTwo",
        selected: { toDiscard: [id("handA"), id("notMine")] }
      })
    );
  });

  test("selecting the same card twice is rejected", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [discardTwoAbility()] } }), owner: P1 },
        { key: "handA", def: character({ name: "Hand A" }), owner: P1, zone: "hand" },
        { key: "handB", def: character({ name: "Hand B" }), owner: P1, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "discardTwo",
        selected: { toDiscard: [id("handA"), id("handA")] }
      })
    );
  });
});
