import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame } from "../../engine.js";
import {
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resourceCard
} from "./support/fixtures.js";

// Two distinct staple resource definitions and a plain filler character.
const RAGE = resourceCard({ id: "sr-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
const GREED = resourceCard({ id: "sr-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
const FILLER = character({ id: "sr-filler", name: "Filler", life: 2 });

/** A faction that starts with 2 freely-chosen staples and offers a mulligan. */
const CHOOSE_FACTION = factionCard({
  id: "sr-faction",
  name: "Choosers",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 2, goingSecond: 2 },
      mulligan: { count: 1, mode: "replaceAny" }
    }
  })
});

/** Same, but pinned to a specific resource — no free choice. */
const PINNED_FACTION = factionCard({
  id: "sr-pinned-faction",
  name: "Pinned",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, names: ["Rage", "Rage"] },
      openingHand: { goingFirst: 2, goingSecond: 2 },
      mulligan: { count: 1, mode: "replaceAny" }
    }
  })
});

/**
 * Like CHOOSE_FACTION, but "any 2 *different* staple resources" — the
 * `distinctStaples` flag (Unlikely Heroes). The plain form above still
 * allows two of the same.
 */
const DISTINCT_FACTION = factionCard({
  id: "sr-distinct-faction",
  name: "Distincters",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, stapleOnly: true, distinctStaples: true },
      openingHand: { goingFirst: 2, goingSecond: 2 },
      mulligan: { count: 1, mode: "replaceAny" }
    }
  })
});

const DEFS = [CHOOSE_FACTION, PINNED_FACTION, DISTINCT_FACTION, RAGE, GREED, FILLER];

/** deck = faction + `rage` Rage + `greed` Greed + filler up to `size` cards. */
function deck(factionId: string, rage: number, greed: number, size = 14): string[] {
  const staples = [
    ...Array.from({ length: rage }, () => RAGE.id),
    ...Array.from({ length: greed }, () => GREED.id)
  ];
  const fillerCount = size - 1 - staples.length;
  return [
    factionId,
    ...staples,
    ...Array.from({ length: Math.max(0, fillerCount) }, () => FILLER.id)
  ];
}

function newGame(
  p1Deck: string[],
  p2Deck: string[],
  opts: Parameters<typeof createFactionGame>[2] = {}
) {
  return createFactionGame(
    DEFS,
    [{ id: P1, name: "Alice", deckDefinitionIds: p1Deck },
    { id: P2, name: "Bob", deckDefinitionIds: p2Deck }],
    { firstPlayerId: P1, ...opts }
  );
}

const resourcesInPlay = (engine: ReturnType<typeof newGame>, pid: string) =>
  engine.state.players[pid].play.filter(cid => engine.getDefinition(cid).type === "resource").length;

describe("chooseStartingResources setup phase", () => {
  test("off by default: a multi-staple deck still gets deck-order staples, no phase", () => {
    const engine = newGame(deck(CHOOSE_FACTION.id, 4, 4), deck(CHOOSE_FACTION.id, 4, 4));

    assert.equal(engine.state.setup.phase, "mulligan");
    // Deck order is Rage before Greed, so both starting resources are Rage.
    const p1Res = engine.state.players[P1].play
      .map(cid => engine.getDefinition(cid).name)
      .filter(name => name === "Rage" || name === "Greed");
    assert.deepEqual(p1Res, ["Rage", "Rage"]);
  });

  test("opt-in + a single staple type: no phase (choice would be trivial)", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 6, 0),
      deck(CHOOSE_FACTION.id, 6, 0),
      { chooseStartingResources: true }
    );
    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(resourcesInPlay(engine, P1), 2);
  });

  test("opt-in + name-pinned faction: no phase even with a mixed deck", () => {
    const engine = newGame(
      deck(PINNED_FACTION.id, 3, 3),
      deck(PINNED_FACTION.id, 3, 3),
      { chooseStartingResources: true }
    );
    assert.equal(engine.state.setup.phase, "mulligan");
  });

  test("opt-in + 2+ staple types: enters the phase, defers shuffle + opening hands", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4),
      deck(CHOOSE_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );

    const setup = engine.state.setup;
    assert.equal(setup.phase, "chooseStartingResources");
    assert(setup.phase === "chooseStartingResources", "setup.phase === \"chooseStartingResources\"");
    assert.deepEqual(setup.order, [P1, P2]);
    assert.equal(setup.currentIndex, 0);
    assert.deepEqual(setup.counts, { [P1]: 2, [P2]: 2 });

    // Nothing placed, drawn, or shuffled yet.
    assert.equal(resourcesInPlay(engine, P1), 0);
    assert.equal(engine.state.players[P1].hand.length, 0);
    assert.equal(engine.getFlowView().mode, "setup");
  });

  test("each seat picks its staples; then setup advances to the mulligan with hands dealt", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4),
      deck(CHOOSE_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );

    const p1Choice = engine.getStartingResourceChoice(P1);
    assert(p1Choice, "p1Choice");
    assert.equal(p1Choice.count, 2);
    // 4 Rage + 4 Greed available.
    assert.equal(p1Choice.candidateCardIds.length, 8);

    // P1 takes one Rage + one Greed.
    const rageId = p1Choice.candidateCardIds.find(id => engine.getDefinition(id).name === "Rage")!;
    const greedId = p1Choice.candidateCardIds.find(id => engine.getDefinition(id).name === "Greed")!;
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rageId, greedId] });

    assert.equal(engine.state.players[P1].play.includes(rageId), true);
    assert.equal(engine.state.players[P1].play.includes(greedId), true);
    assert.equal(resourcesInPlay(engine, P1), 2);
    // Still P2's turn to choose — setup not finished.
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    assert.equal(engine.state.players[P1].hand.length, 0);

    // Not P1's decision anymore.
    assert.equal(engine.getStartingResourceChoice(P1), null);

    const p2Choice = engine.getStartingResourceChoice(P2)!;
    engine.perform({
      type: "chooseStartingResources",
      playerId: P2,
      cardIds: p2Choice.candidateCardIds.filter(id => engine.getDefinition(id).name === "Greed").slice(0, 2)
    });

    // Both chose -> finishFactionSetup ran: mulligan step, opening hands dealt.
    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(engine.state.players[P1].hand.length, 2);
    assert.equal(engine.state.players[P2].hand.length, 2);
    assert.equal(resourcesInPlay(engine, P2), 2);
    assert.equal(
      engine.state.players[P2].play
        .map(cid => engine.getDefinition(cid).name)
        .filter(name => name === "Rage" || name === "Greed").join(","),
      "Greed,Greed"
    );
  });

  test("only one player has a choice: the other's staples are placed immediately", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4), // P1: mixed -> chooses
      deck(CHOOSE_FACTION.id, 6, 0), // P2: all Rage -> no choice
      { chooseStartingResources: true }
    );

    const setup = engine.state.setup;
    assert(setup.phase === "chooseStartingResources", "setup.phase === \"chooseStartingResources\"");
    assert.deepEqual(setup.order, [P1]);
    assert.equal(resourcesInPlay(engine, P2), 2); // placed up front

    const choice = engine.getStartingResourceChoice(P1)!;
    engine.perform({
      type: "chooseStartingResources",
      playerId: P1,
      cardIds: choice.candidateCardIds.slice(0, 2)
    });
    assert.equal(engine.state.setup.phase, "mulligan");
  });

  test("rejects a wrong count, a non-staple, a card not in deck, and a duplicate", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4),
      deck(CHOOSE_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );
    const choice = engine.getStartingResourceChoice(P1)!;
    const [a, b] = choice.candidateCardIds;
    const fillerId = engine.state.players[P1].deck.find(
      id => engine.getDefinition(id).type === "character"
    )!;
    const p2Staple = engine.getStartingResourceChoice(P2) ??
      { candidateCardIds: engine.state.players[P2].deck };

    assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [a] }), /exactly 2/);
    assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [a, fillerId] }), /staple resources/);
    assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [a, a] }), /selected twice/);
    assert.throws(
      () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [a, engine.state.players[P2].deck[1]] }),
      /from your deck/
    );

    // A well-formed pick still works afterward.
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [a, b] });
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    assert.equal(engine.state.setup.currentIndex, 1);
  });

  test("no other action is legal while the phase is open", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4),
      deck(CHOOSE_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );
    assert.throws(
      () => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }),
      /Starting resources must be chosen/
    );
    assert.throws(
      () => engine.perform({ type: "endTurn", playerId: P1 }),
      /Starting resources must be chosen/
    );
  });

  test("matchOpponentCount still equalizes after an interactive choice", () => {
    const MINER = factionCard({
      id: "sr-miner",
      name: "Miner",
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: {
          startingResources: {
            count: 2,
            chosenStaples: { min: 1, max: 5 },
            matchOpponentCount: true
          },
          openingHand: { goingFirst: 2, goingSecond: 2 },
          mulligan: { count: 1, mode: "replaceAny" }
        }
      })
    });
    const plain = factionCard({
      id: "sr-plain",
      name: "Plain",
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: {
          startingResources: { count: 2, stapleOnly: true },
          openingHand: { goingFirst: 2, goingSecond: 2 },
          mulligan: { count: 1, mode: "replaceAny" }
        }
      })
    });

    const engine = createFactionGame(
      [MINER, plain, RAGE, GREED, FILLER],
      [{ id: P1, name: "Alice", deckDefinitionIds: deck(MINER.id, 4, 4) },
      { id: P2, name: "Bob", deckDefinitionIds: deck(plain.id, 6, 0) }],
      { firstPlayerId: P1, chooseStartingResources: true, startingResourceX: { [P1]: 3 } }
    );

    const setup = engine.state.setup;
    assert(setup.phase === "chooseStartingResources", "setup.phase === \"chooseStartingResources\"");
    assert.equal(setup.counts[P1], 3);

    const choice = engine.getStartingResourceChoice(P1)!;
    engine.perform({
      type: "chooseStartingResources",
      playerId: P1,
      cardIds: choice.candidateCardIds.slice(0, 3)
    });

    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(resourcesInPlay(engine, P1), 3);
    assert.equal(resourcesInPlay(engine, P2), 3); // topped up 2 -> 3
  });

  test("plain stapleOnly form: two of the SAME staple kind is a legal pick", () => {
    const engine = newGame(
      deck(CHOOSE_FACTION.id, 4, 4),
      deck(CHOOSE_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );
    const choice = engine.getStartingResourceChoice(P1)!;
    assert.equal(choice.distinct, false);
    const twoRage = choice.candidateCardIds
      .filter(id => engine.getDefinition(id).name === "Rage")
      .slice(0, 2);
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: twoRage });
    assert.equal(resourcesInPlay(engine, P1), 2);
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    assert.equal(engine.state.setup.currentIndex, 1);
  });
});

describe("distinctStaples faction — 'any N different staple resources'", () => {
  test("deck-order auto-pick takes different kinds, not two of the first", () => {
    const engine = newGame(
      deck(DISTINCT_FACTION.id, 4, 4),
      deck(DISTINCT_FACTION.id, 4, 4)
    );
    assert.equal(engine.state.setup.phase, "mulligan");
    const p1Res = engine.state.players[P1].play
      .map(cid => engine.getDefinition(cid).name)
      .filter(name => name === "Rage" || name === "Greed");
    assert.deepEqual(p1Res, ["Rage", "Greed"]);
  });

  test("a single-kind deck falls back to two of that kind (different is impossible)", () => {
    const engine = newGame(
      deck(DISTINCT_FACTION.id, 6, 0),
      deck(DISTINCT_FACTION.id, 6, 0)
    );
    assert.equal(resourcesInPlay(engine, P1), 2);
    assert.deepEqual(
      engine.state.players[P1].play
        .map(cid => engine.getDefinition(cid).name)
        .filter(name => name === "Rage" || name === "Greed"),
      ["Rage", "Rage"]
    );
  });

  test("interactive: choice.distinct is set, and two of the same kind is rejected", () => {
    const engine = newGame(
      deck(DISTINCT_FACTION.id, 4, 4),
      deck(DISTINCT_FACTION.id, 4, 4),
      { chooseStartingResources: true }
    );
    const choice = engine.getStartingResourceChoice(P1)!;
    assert.equal(choice.distinct, true);

    const [rage1, rage2] = choice.candidateCardIds.filter(
      id => engine.getDefinition(id).name === "Rage"
    );
    assert.throws(
      () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rage1, rage2] }),
      /different from each other/
    );

    // One Rage + one Greed goes through.
    const greed = choice.candidateCardIds.find(id => engine.getDefinition(id).name === "Greed")!;
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rage1, greed] });
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    assert.equal(engine.state.setup.currentIndex, 1);
  });
});
