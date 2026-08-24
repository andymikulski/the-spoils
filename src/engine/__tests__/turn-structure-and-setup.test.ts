import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTwoPlayerFactionGame } from "../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard
} from "./support/fixtures.js";

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"] } });
const FILLER = character({ name: "Filler", life: 2 });

const FACTION = factionCard({
  name: "Testers",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, names: ["Rage"] },
      openingHand: { goingFirst: 3, goingSecond: 4 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: {
        clearCharacterDamage: true,
        detachResources: true,
        restoreNonResources: true
      },
      develop: {
        choices: [
          { type: "draw", count: 1 },
          { type: "playResource", count: 1 }
        ]
      }
    }
  })
});

function deckOf(count: number) {
  return [RAGE.id, RAGE.id, ...Array.from({ length: count - 2 }, () => FILLER.id)];
}

function newFactionGame() {
  return createTwoPlayerFactionGame(
    [FACTION, RAGE, FILLER],
    { id: P1, name: "Alice", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) },
    { id: P2, name: "Bob", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) },
    { firstPlayerId: P1 }
  );
}

describe("RULES.md §5 — setup", () => {
  test("starting influence, starting resources, and opening hand sizes come from the faction", () => {
    const engine = newFactionGame();

    assert.equal(engine.state.players[P1].influence, 10);
    assert.equal(engine.state.players[P2].influence, 10);

    // 2 starting resources for each player were found and moved into play.
    const p1Resources = engine.state.players[P1].play.filter(id =>
      engine.getDefinition(id).name === "Rage"
    );
    assert.equal(p1Resources.length, 2);

    // First player draws 3 (goingFirst), second draws 4 (goingSecond).
    assert.equal(engine.state.players[P1].hand.length, 3);
    assert.equal(engine.state.players[P2].hand.length, 4);
  });

  test("setup starts in the mulligan step when the faction offers one", () => {
    const engine = newFactionGame();

    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(engine.state.started, false);
  });

  test("a replace-any mulligan swaps chosen cards for the same number of new ones, once per player", () => {
    const engine = newFactionGame();

    const p1HandBefore = [...engine.state.players[P1].hand];
    const mulliganed = [p1HandBefore[0]];

    engine.perform({ type: "mulligan", playerId: P1, cardIds: mulliganed });

    assert.equal(engine.state.players[P1].hand.length, 3);
    assert.ok(!engine.state.players[P1].hand.includes(mulliganed[0]));

    // It is now P2's decision.
    assert.equal((engine.state.setup as { order: string[] }).order[1], P2);

    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    // Both players have mulliganed; setup completes and turn 1 begins in develop.
    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.started, true);
    assert.equal(engine.state.turnPhase, "develop");
    assert.equal(engine.state.activePlayerId, P1);
  });

  test("mulligan cannot happen again once setup is complete", () => {
    const engine = newFactionGame();

    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    assert.throws(() =>
      engine.perform({ type: "mulligan", playerId: P1, cardIds: [] })
    );
  });
});

describe("RULES.md §6 — the develop step", () => {
  test("choosing 'draw' adds a card to hand and moves to the main phase", () => {
    const engine = newFactionGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    const before = engine.state.players[P1].hand.length;
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.equal(engine.state.turnPhase, "main");
    assert.equal(engine.state.priorityPlayerId, P1);
  });

  test("choosing 'playResource' plays the named hand card(s) as resources", () => {
    const engine = newFactionGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    const fillerInHand = engine.state.players[P1].hand.find(
      id => engine.getDefinition(id).name === "Filler"
    )!;

    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: fillerInHand, faceDown: true }] }
    });

    assert.equal(engine.state.cards[fillerInHand].zone, "play");
    assert.equal(engine.state.cards[fillerInHand].faceDown, true);
    assert.equal(engine.state.turnPhase, "main");
  });

  test("a normal turn action cannot be taken before the develop decision is made", () => {
    const engine = newFactionGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    assert.throws(() =>
      engine.perform({ type: "endTurn", playerId: P1 })
    );
  });
});

describe("RULES.md §6 — start-of-turn restore", () => {
  test("ending a turn restores the next active player's board", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        {
          key: "p2Character",
          def: character({ name: "Bruiser", life: 5 }),
          owner: P2,
          damage: 3,
          depleted: true
        },
        { key: "p2Resource", def: resourceCard({ name: "Fuel" }), owner: P2 }
      ]
    });

    // Attach P2's resource to P2's faction, as a numeric-cost payment would.
    engine.state.cards[id("p2Resource")].attachedTo = engine.state.players[P2].factionId;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.turn, 2);
    assert.equal(engine.state.activePlayerId, P2);

    assert.equal(engine.state.cards[id("p2Character")].damage, 0);
    assert.equal(engine.state.cards[id("p2Character")].depleted, false);
    assert.equal(engine.state.cards[id("p2Resource")].attachedTo, undefined);
  });

  test("attack eligibility resets to the new active player's settled board", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        { key: "p1Character", def: character({ name: "Settled P1" }), owner: P1 },
        { key: "p2Character", def: character({ name: "Settled P2" }), owner: P2 }
      ]
    });

    assert.equal(engine.state.cards[id("p1Character")].attackEligibleTurn, 1);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    // Turn passed to P2: P2's settled character becomes eligible this turn...
    assert.equal(engine.state.cards[id("p2Character")].attackEligibleTurn, 2);
    // ...and P1's is cleared, since it isn't P1's turn.
    assert.equal(engine.state.cards[id("p1Character")].attackEligibleTurn, undefined);
  });
});
