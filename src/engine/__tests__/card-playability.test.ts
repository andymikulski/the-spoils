import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition } from "../../engine.js";
import { buildGame, character, item, P1, P2, resourceCard, tactic } from "./support/fixtures.js";

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

    assert.equal(engine.state.pendingChoice, undefined);
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

// "EXTRA COST: reduce this card's numeric cost by..." — a reduction the player
// only earns by making a pick can't be read off the printed cost. These use
// synthetic cards with deliberately different caps / rates than any real card,
// so they fail if the engine is tuned to one card's numbers or shape.
describe("getCardPlayability — a card's own numeric-cost reduction (costAdjust)", () => {
  type PlaySource = Pick<
    NonNullable<NonNullable<CardDefinition["behavior"]>["onPlay"]>,
    "targets" | "costs" | "costAdjust"
  >;

  /** "Remove up to `max` cards in an opponent's discard pile; reduce this card's cost by `perCard` for each." */
  const removeFromDiscard = (max: number, perCard = 1): PlaySource => ({
    targets: [{ id: "rem", selector: { owner: "opponent", zone: "discard" }, count: max, optional: true }],
    costs: [{ type: "sacrificeSelected", declarationId: "rem", disposition: "removeFromGame" }],
    costAdjust: { type: "multiply", values: [{ type: "selectionCount", id: "rem" }, -perCard] }
  });

  const resources = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `res${i}`, def: resourceCard({ name: `Res ${i}` }), owner: P1 }));
  const oppDiscard = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `d${i}`,
      def: character({ name: `Discarded ${i}` }),
      owner: P2,
      zone: "discard" as const
    }));

  test("offered when the best case is affordable; refused, quoting the best case, when it isn't", () => {
    // Cost 5, up to 2 removable at 1 apiece, 3 resources.
    const setup = (discardCount: number) =>
      buildGame({
        cards: [
          { key: "gadget", def: item({ name: "Gadget", cost: 5, behavior: { onPlay: removeFromDiscard(2) } }), owner: P1, zone: "hand" },
          ...resources(3),
          ...oppDiscard(discardCount)
        ]
      });

    const enough = setup(2);
    const enoughResult = enough.engine.getCardPlayability(P1, enough.id("gadget"));
    assert.equal(enoughResult.numericCost, 3);
    assert.equal(enoughResult.playable, true);

    // Only one removable card: best case is 4, which 3 resources can't cover.
    const short = setup(1);
    const shortResult = short.engine.getCardPlayability(P1, short.id("gadget"));
    assert.equal(shortResult.numericCost, 4);
    assert.equal(shortResult.playable, false);
  });

  test("the pick cap and the per-card rate come from the card's own data", () => {
    // Up to 3 cards at 2 off apiece: cost 9 -> 3.
    const { engine, id } = buildGame({
      cards: [
        { key: "gadget", def: item({ name: "Gadget", cost: 9, behavior: { onPlay: removeFromDiscard(3, 2) } }), owner: P1, zone: "hand" },
        ...resources(3),
        ...oppDiscard(5)
      ]
    });
    const result = engine.getCardPlayability(P1, id("gadget"));
    assert.equal(result.numericCost, 3);
    assert.equal(result.playable, true);
  });

  test("perform re-checks the real cost against the picks actually made", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gadget", def: item({ name: "Gadget", cost: 5, behavior: { onPlay: removeFromDiscard(2) } }), owner: P1, zone: "hand" },
        ...resources(3),
        ...oppDiscard(2)
      ]
    });

    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget"), selected: { rem: [id("d0")] } }),
      /costs 4 resources, but only 3 are available/
    );
    assert.equal(engine.state.cards[id("gadget")].zone, "hand");
    assert.equal(engine.state.cards[id("d0")].zone, "discard");

    engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget"), selected: { rem: [id("d0"), id("d1")] } });
    assert.equal(engine.state.cards[id("gadget")].zone, "deploying");
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });

  test("doesn't assume a bigger pick is cheaper: the best pick size is found by trying them all", () => {
    // Up to 3 picks, but the discount only applies to a pick of exactly 2.
    const exactlyTwo: PlaySource = {
      ...removeFromDiscard(3),
      costAdjust: {
        type: "conditional",
        if: { type: "numberCompare", left: { type: "selectionCount", id: "rem" }, operator: "=", right: 2 },
        then: -4,
        else: 0
      }
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "gadget", def: item({ name: "Gadget", cost: 5, behavior: { onPlay: exactlyTwo } }), owner: P1, zone: "hand" },
        ...resources(1),
        ...oppDiscard(3)
      ]
    });

    const result = engine.getCardPlayability(P1, id("gadget"));
    assert.equal(result.numericCost, 1);
    assert.equal(result.playable, true);

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget"), selected: { rem: [id("d0"), id("d1"), id("d2")] } })
    );
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget"), selected: { rem: [id("d0"), id("d1")] } });
    assert.equal(engine.state.cards[id("gadget")].zone, "deploying");
  });

  test("a tactic declares it on its play source, and pays the reduced cost when played", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "spell",
          def: tactic({
            name: "Spell",
            cost: 4,
            behavior: { abilities: [{ id: "body", type: "activated", ...removeFromDiscard(2), effects: [] }] }
          }),
          owner: P1,
          zone: "hand"
        },
        ...resources(2),
        ...oppDiscard(2)
      ]
    });

    const result = engine.getCardPlayability(P1, id("spell"));
    assert.equal(result.numericCost, 2);
    assert.equal(result.playable, true);

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell"), selected: { rem: [id("d0")] } })
    );
    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell"), selected: { rem: [id("d0"), id("d1")] } });
    assert.equal(engine.state.cards[id("spell")].zone, "deploying");
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });

  test("a modal tactic is judged on its cheapest mode, and each mode pays its own cost", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "spell",
          def: tactic({
            name: "Spell",
            cost: 4,
            behavior: {
              modes: [
                { label: "Plain", effects: [] },
                { label: "Discounted", ...removeFromDiscard(2), effects: [] }
              ]
            }
          }),
          owner: P1,
          zone: "hand"
        },
        ...resources(2),
        ...oppDiscard(2)
      ]
    });

    const result = engine.getCardPlayability(P1, id("spell"));
    assert.equal(result.numericCost, 2);
    assert.equal(result.playable, true);

    // The plain mode still costs the full 4.
    assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("spell"), mode: 0 }));
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("spell"),
      mode: 1,
      selected: { rem: [id("d0"), id("d1")] }
    });
    assert.equal(engine.state.cards[id("spell")].zone, "deploying");
  });
});
