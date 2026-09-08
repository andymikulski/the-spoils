import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, item, P1, P2, resourceCard, tactic } from "./support/fixtures.js";

describe("RULES.md §4 — getCardPlayability mirrors what playCard actually accepts", () => {
  test("playable when threshold is met and enough resources are unattached", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1", resource: { provides: ["rage"] } }), owner: P1 },
        { key: "rage2", def: resourceCard({ name: "Rage 2", resource: { provides: ["rage"] } }), owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2, threshold: "r" }), owner: P1, zone: "hand" }
      ]
    });

    assert.deepEqual(engine.getCardPlayability(P1, id("gadget")), {
      playable: true,
      legalTiming: true,
      thresholdMet: true,
      numericCost: 2,
      availableResources: 2
    });

    // The public query and the real thing agree.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget") });
    assert.equal(engine.state.cards[id("gadget")].zone, "deploying");
  });

  test("not playable with too few unattached resources, and perform() rejects it too", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1" }), owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    const result = engine.getCardPlayability(P1, id("gadget"));
    assert.equal(result.playable, false);
    assert.equal(result.legalTiming, true);
    assert.equal(result.thresholdMet, true);
    assert.equal(result.numericCost, 2);
    assert.equal(result.availableResources, 1);

    assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget") }));
  });

  test("not playable when the printed threshold isn't met", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "bigAttack", def: tactic({ name: "Big Attack", threshold: "rr" }), owner: P1, zone: "hand" }]
    });

    const result = engine.getCardPlayability(P1, id("bigAttack"));
    assert.equal(result.playable, false);
    assert.equal(result.thresholdMet, false);
  });

  test("a pending cost reduction lowers the reported numeric cost", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1" }), owner: P1 },
        { key: "gadget", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    assert.equal(engine.getCardPlayability(P1, id("gadget")).playable, false);

    engine.state.costReductions.push({ id: "reduction-1", playerId: P1, amount: 1, createdTurn: engine.state.turn });

    const result = engine.getCardPlayability(P1, id("gadget"));
    assert.equal(result.numericCost, 1);
    assert.equal(result.playable, true);
  });

  test("not playable when it isn't that player's turn/priority", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P2, zone: "hand" }],
      activePlayerId: P1
    });

    assert.equal(engine.getCardPlayability(P2, id("gadget")).legalTiming, false);
  });

  test("the develop rule is not a gate — a card is playable before it's used", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" }]
    });

    assert.equal(engine.state.developsUsedThisTurn, 0);
    assert.equal(engine.getCardPlayability(P1, id("gadget")).legalTiming, true);
  });

  test("in a response window, only a tactic or TACTICAL card is playable, even for whoever holds priority", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "plainItem", def: item({ name: "Plain Item", cost: 0 }), owner: P2, zone: "hand" },
        { key: "quickTactic", def: tactic({ name: "Quick Tactic", cost: 0 }), owner: P2, zone: "hand" }
      ],
      responseWindow: {
        id: "w1",
        kind: "action",
        phase: "acceptingResponses",
        priorityPlayerId: P2,
        pendingResponders: [],
        continuation: { type: "main" }
      }
    });

    assert.equal(engine.getCardPlayability(P2, id("plainItem")).legalTiming, false);
    assert.equal(engine.getCardPlayability(P2, id("quickTactic")).legalTiming, true);
  });

  test("a card not sitting in that player's hand is never playable", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "play" }]
    });

    assert.equal(engine.getCardPlayability(P1, id("gadget")).legalTiming, false);
  });

  test("RULES.md §6 — a resource card in hand is never playable via a normal card play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1" }), owner: P1 },
        { key: "spareResource", def: resourceCard({ name: "Spare Resource", cost: 0 }), owner: P1, zone: "hand" }
      ]
    });

    // CR §203.1: a resource is played only when an effect instructs you to
    // (the develop rule, or a card effect) — it must never show up as a
    // normal deployable card.
    assert.equal(engine.getCardPlayability(P1, id("spareResource")).legalTiming, false);
    assert.deepEqual(engine.getPlayableHandCards(P1), []);

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spareResource") })
    );
  });

  // A tactic can carry a play-timing restriction of its own beyond the
  // response-window rules ("EXTRA COST: Deploy this only on your turn" —
  // Hasty Pursuit, modeled as an `isActivePlayer` condition). It's a timing
  // gate, so a failing one reads as `legalTiming: false`, not a surprise at
  // perform() time.
  const onYourTurnOnly = () =>
    tactic({
      name: "On Your Turn Only",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "on-your-turn-only",
            type: "activated",
            condition: { type: "isActivePlayer", player: "controller" },
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

  test("a tactic's own 'only on your turn' condition greys it out in an opponent's response window", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "tac", def: onYourTurnOnly(), owner: P2, zone: "hand" }],
      activePlayerId: P1,
      responseWindow: {
        id: "w1",
        kind: "action",
        phase: "acceptingResponses",
        priorityPlayerId: P2,
        pendingResponders: [],
        continuation: { type: "main" }
      }
    });

    // The response-window type check passes (it *is* a tactic) — its own
    // "only on your turn" condition is what fails, and perform() agrees.
    assert.equal(engine.getCardPlayability(P2, id("tac")).legalTiming, false);
    assert.throws(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("tac") }));
  });

  test("that same condition passes on the card owner's own turn", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "tac", def: onYourTurnOnly(), owner: P1, zone: "hand" }],
      activePlayerId: P1
    });

    assert.equal(engine.getCardPlayability(P1, id("tac")).playable, true);
  });

  test("a play condition gated on a not-yet-chosen 'choose a number for X' is left to perform()", () => {
    const pickX = tactic({
      name: "Pick X",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "pick-x",
            type: "activated",
            condition: {
              type: "numberCompare",
              left: { type: "variable", id: "x" },
              operator: ">",
              right: 0
            },
            targets: [
              {
                id: "fodder",
                selector: { controller: "self", zone: "discard", type: "tactic" },
                count: { type: "variable", id: "x" }
              }
            ],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "tac", def: pickX, owner: P1, zone: "hand" }],
      activePlayerId: P1
    });

    // X reads as 0 pre-selection, so probing "X > 0" would wrongly report
    // the card unplayable. legalTiming stays true; perform() is still the
    // real gate once X is chosen.
    assert.equal(engine.getCardPlayability(P1, id("tac")).legalTiming, true);
  });
});

describe("getPlayableHandCards", () => {
  test("filters a hand down to just the cards that are currently deployable", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rage1", def: resourceCard({ name: "Rage 1" }), owner: P1 },
        { key: "affordable", def: item({ name: "Affordable", cost: 1 }), owner: P1, zone: "hand" },
        { key: "tooExpensive", def: item({ name: "Too Expensive", cost: 5 }), owner: P1, zone: "hand" },
        { key: "wrongThreshold", def: item({ name: "Wrong Threshold", cost: 0, threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });

    assert.deepEqual(engine.getPlayableHandCards(P1), [id("affordable")]);
  });
});
