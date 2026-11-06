// Elimination and game results with three or more players (docs/MULTIPLAYER-PLAN.md D3, D8).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame, isLiving, opponentsOf, type GameFormat, type SpoilsEngine } from "../../../engine.js";
import { buildGame, character, defaultFactionDefinition, factionCard, noDevelopFaction, resolvePendingResponses, resourceCard } from "../support/fixtures.js";
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

function deckOf(count: number) {
  return [RAGE.id, RAGE.id, ...Array.from({ length: count - 2 }, () => FILLER.id)];
}

function game(seats: string[], format?: GameFormat): SpoilsEngine {
  const engine = createFactionGame(
    [FACTION, RAGE, FILLER],
    seats.map(id => ({ id, name: id.toUpperCase(), factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(12) })),
    { firstPlayerId: seats[0], seed: 3, ...(format ? { format } : {}) }
  );
  settleTurnStart(engine);
  return engine;
}

/** Ends the active player's turn, every other player declining to respond, and settles the next turn's start. */
function passTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  while (engine.state.responseWindow) {
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") {
      engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    } else {
      engine.perform({ type: "advanceFlow" });
    }
  }
  if (!engine.state.result) settleTurnStart(engine);
}

/** Drops `playerId`'s faction to 0 influence and lets the state-based check run (on the next action). */
function knockOut(engine: SpoilsEngine, ...playerIds: string[]): void {
  for (const playerId of playerIds) engine.state.players[playerId].influence = 0;
}

function ownedCardZones(engine: SpoilsEngine, playerId: string): Set<string> {
  return new Set(
    Object.values(engine.state.cards)
      .filter(card => card.ownerId === playerId)
      .map(card => card.zone)
  );
}

describe("free-for-all elimination (D3, D8)", () => {
  test("a player at 0 influence is eliminated and the game goes on", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p2");
    passTurn(engine);
    assert.equal(engine.state.result, undefined);
    assert.equal(isLiving(engine.state, "p2"), false);
    assert.equal(engine.state.players.p2.eliminated?.reason, "influence");
    assert.ok(engine.getLog().some(entry => entry.event?.type === "playerEliminated"), "a playerEliminated event is logged");
  });

  test("every card the eliminated player owns leaves the game", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p2");
    passTurn(engine);
    assert.deepEqual([...ownedCardZones(engine, "p2")], ["removed"]);
  });

  test("the eliminated player no longer takes turns or counts as an opponent", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p2");
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "p3", "p1's turn passes straight to p3");
    assert.deepEqual(opponentsOf(engine.state, "p1"), ["p3"]);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "p1");
  });

  test("the last player standing wins", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p2");
    passTurn(engine);
    knockOut(engine, "p3");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: ["p1"] });
  });

  test("two players falling together leave the third as the winner", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p2", "p3");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: ["p1"] });
  });

  test("everyone left falling together is a draw", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p1", "p2", "p3");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "draw", winners: [] });
  });

  test("an active player who is eliminated loses the rest of their turn", () => {
    const engine = game(["p1", "p2", "p3"]);
    knockOut(engine, "p1");
    // Any action runs the state-based check; p1's turn then passes at once.
    engine.perform({ type: "endTurn", playerId: "p1" });
    while (engine.state.responseWindow) {
      const window = engine.state.responseWindow;
      engine.perform(
        window.phase === "acceptingResponses"
          ? { type: "passPriority", playerId: window.priorityPlayerId }
          : { type: "advanceFlow" }
      );
    }
    assert.equal(isLiving(engine.state, "p1"), false);
    assert.equal(engine.state.activePlayerId, "p2");
  });
});

describe("turns counted ahead are re-counted after an elimination", () => {
  test("'your next turn' still means your next turn once a seat is gone", () => {
    const SKIPPER = character({
      name: "Skipper",
      behavior: { abilities: [{ id: "skip", type: "activated", costs: [], effects: [{ type: "skipRestoreRule", player: "controller" }] }] }
    });
    const { engine, id } = buildGame({
      players: ["p1", "p2", "p3"].map(seat => ({ id: seat, faction: noDevelopFaction() })),
      cards: [{ key: "s", def: SKIPPER, owner: "p1" }]
    });
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("s"), abilityId: "skip" });
    resolvePendingResponses(engine);
    assert.deepEqual(engine.state.restoreRuleSkips.p1, [4], "three seats: p1's next turn is turn 4");
    engine.state.players.p2.influence = 0;
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    assert.equal(isLiving(engine.state, "p2"), false);
    assert.deepEqual(engine.state.restoreRuleSkips.p1, [3], "two seats left: p1's next turn is turn 3");
  });
});

describe("classic two-player results", () => {
  test("a faction at 0 ends the game at once — nobody is merely eliminated", () => {
    const engine = game(["p1", "p2"]);
    knockOut(engine, "p2");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: ["p1"] });
    assert.equal(engine.state.players.p2.eliminated, undefined);
  });
});

describe("Showdown sides (D3)", () => {
  const SHOWDOWN: GameFormat = { kind: "showdown", villainId: "v", allegiance: { cards: ["heroes", "heroes", "heroes"] } };

  test("the Villain falling hands every loyal Hero the win — eliminated ones included", () => {
    const engine = game(["v", "h1", "h2"], SHOWDOWN);
    knockOut(engine, "h1");
    passTurn(engine);
    assert.equal(engine.state.result, undefined);
    knockOut(engine, "v");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: ["h1", "h2"] });
  });

  test("the Villain wins once every loyal Hero is out", () => {
    const engine = game(["v", "h1", "h2"], SHOWDOWN);
    knockOut(engine, "h1", "h2");
    passTurn(engine);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: ["v"] });
  });
});
