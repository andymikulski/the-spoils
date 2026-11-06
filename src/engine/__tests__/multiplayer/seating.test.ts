// Multiplayer seating, setup and turn rotation (docs/rules/multiplayer-guidelines.md;
// RULES.md §5 "engine-derived, D5"; docs/MULTIPLAYER-PLAN.md D5/D6).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame, opponentsOf, otherLivingSeats } from "../../../engine.js";
import { character, defaultFactionDefinition, factionCard, resourceCard } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"] } });
const FILLER = character({ name: "Filler", life: 2 });

const FACTION = factionCard({
  name: "Testers",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, names: ["Rage"] },
      openingHand: { goingFirst: 3, goingSecond: 4 }
    }
  })
});

const SEATS = ["p1", "p2", "p3"] as const;

function deckOf(count: number) {
  return [RAGE.id, RAGE.id, ...Array.from({ length: count - 2 }, () => FILLER.id)];
}

function threePlayerGame(firstPlayerId: string = "p1") {
  return createFactionGame(
    [FACTION, RAGE, FILLER],
    SEATS.map(id => ({ id, name: id.toUpperCase(), factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(12) })),
    { firstPlayerId, seed: 7 }
  );
}

/** Ends the active player's turn and lets every other player decline to respond. */
function endTurnAllPass(engine: ReturnType<typeof threePlayerGame>): string[] {
  const ender = engine.state.activePlayerId;
  engine.perform({ type: "endTurn", playerId: ender });
  const offered: string[] = [];
  while (engine.state.responseWindow) {
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") {
      offered.push(window.priorityPlayerId);
      engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    } else {
      engine.perform({ type: "advanceFlow" });
    }
  }
  return offered;
}

describe("multiplayer seating (D5)", () => {
  test("three seats default to a free-for-all, seated in the order given", () => {
    const engine = threePlayerGame();
    assert.deepEqual(engine.state.format, { kind: "freeForAll" });
    assert.deepEqual(engine.state.turnOrder, ["p1", "p2", "p3"]);
  });

  test("a classic game refuses a third seat", () => {
    assert.throws(
      () =>
        createFactionGame(
          [FACTION, RAGE, FILLER],
          SEATS.map(id => ({ id, name: id, factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(12) })),
          { format: { kind: "classic" } }
        ),
      /exactly two players/
    );
  });

  test("the first player draws the going-first hand; every other seat the going-second hand", () => {
    const engine = threePlayerGame("p2");
    assert.equal(engine.state.players.p2.hand.length, 3);
    assert.equal(engine.state.players.p3.hand.length, 4);
    assert.equal(engine.state.players.p1.hand.length, 4);
  });

  test("every player is every other player's opponent in a free-for-all (MP 2)", () => {
    const engine = threePlayerGame();
    assert.deepEqual(opponentsOf(engine.state, "p1"), ["p2", "p3"]);
    assert.deepEqual(opponentsOf(engine.state, "p3"), ["p1", "p2"]);
    assert.deepEqual(otherLivingSeats(engine.state, "p2"), ["p3", "p1"]);
  });
});

describe("multiplayer turn rotation and responses (D5, D6)", () => {
  test("turns pass to the next seat and wrap around", () => {
    const engine = threePlayerGame();
    const actives: string[] = [];
    for (let i = 0; i < 4; i++) {
      settleTurnStart(engine);
      actives.push(engine.state.activePlayerId);
      endTurnAllPass(engine);
    }
    assert.deepEqual(actives, ["p1", "p2", "p3", "p1"]);
  });

  test("ending a turn offers a response to every other player in seat order", () => {
    const engine = threePlayerGame();
    settleTurnStart(engine);
    assert.deepEqual(endTurnAllPass(engine), ["p2", "p3"]);
    settleTurnStart(engine);
    assert.deepEqual(endTurnAllPass(engine), ["p3", "p1"]);
  });
});
