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

const VILLAIN_FACTION = factionCard({ ...FACTION, id: "testers-villain", name: "Testers (Villain)", faction: { ...FACTION.faction!, showdownRole: "villain" } });
const SHARED_FACTION = factionCard({ name: "Shared", faction: { ...defaultFactionDefinition(), showdownRole: "heroes" } });

function deckOf(count: number) {
  return [RAGE.id, RAGE.id, ...Array.from({ length: count - 2 }, () => FILLER.id)];
}

function game(seats: string[], format?: GameFormat): SpoilsEngine {
  // A Showdown table: the Villain's faction and the Heroes' shared one (SD 2, SD 5), and a Hero Deck (SD 3).
  const villainId = format?.kind === "showdown" ? format.villainId : undefined;
  const engine = createFactionGame(
    [FACTION, VILLAIN_FACTION, SHARED_FACTION, RAGE, FILLER],
    seats.map(id => ({
      id,
      name: id.toUpperCase(),
      factionDefinitionId: id === villainId ? VILLAIN_FACTION.id : FACTION.id,
      deckDefinitionIds: deckOf(12)
    })),
    {
      firstPlayerId: seats[0],
      seed: 3,
      ...(format ? { format } : {}),
      ...(villainId !== undefined ? { showdown: { heroDeck: [FILLER.id], sharedFactionDefinitionId: SHARED_FACTION.id } } : {})
    }
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

describe("an effect bound to an opponent who is gone", () => {
  test("a delayed 'your opponent loses 1' bound to an eliminated player reaches nobody else", () => {
    const LATER = character({
      name: "Later",
      behavior: {
        abilities: [
          {
            id: "later",
            type: "activated",
            costs: [],
            effects: [{ type: "scheduleEffect", when: "endOfTurn", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      players: ["p1", "p2", "p3"].map(seat => ({ id: seat, faction: noDevelopFaction() })),
      cards: [{ key: "l", def: LATER, owner: "p1" }]
    });
    engine.perform({ type: "activateAbility", playerId: "p1", cardId: id("l"), abilityId: "later", opponentId: "p2" });
    resolvePendingResponses(engine);
    engine.state.players.p2.influence = 0;
    const p3Before = engine.state.players.p3.influence;
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    assert.equal(isLiving(engine.state, "p2"), false);
    assert.equal(engine.state.players.p3.influence, p3Before, "p3 is not hit in p2's place");
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

describe("an eliminated player takes no further part in what is resolving (D8)", () => {
  test("\"each player chooses\": a player knocked out by an earlier choice is not asked", () => {
    const victim = character({ name: "Victim" });
    // "Each player chooses: their pick's controller loses 100 influence, or nothing."
    const roulette = {
      ...character({ name: "unused" }),
      id: "roulette",
      name: "Roulette",
      type: "tactic" as const,
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated" as const,
            targets: [{ id: "t", selector: { zone: "play" as const, type: "character" as const }, count: 1 }],
            effects: [
              {
                type: "forEachPlayer" as const,
                effects: [
                  {
                    type: "chooserSelectsOption" as const,
                    chooser: "controller" as const,
                    options: [
                      { label: "Drain", effects: [{ type: "modifyInfluence" as const, player: { type: "controllerOf" as const, target: { type: "selected" as const, id: "t" } }, amount: -100 }] },
                      { label: "Nothing", effects: [] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    };
    const seats = ["p1", "p2", "p3"].map(id => ({ id, faction: noDevelopFaction() }));
    const { engine, id } = buildGame({
      players: seats,
      cards: [
        { key: "v", def: victim, owner: "p2", zone: "play" },
        { key: "r", def: roulette as never, owner: "p1", zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: id("r"), selected: { t: [id("v")] } } as never);
    resolvePendingResponses(engine);
    const asked: string[] = [];
    for (let guard = 0; guard < 6 && engine.state.pendingChoice?.kind === "chooserSelectsOption"; guard++) {
      const playerId = engine.state.pendingChoice.playerId;
      asked.push(playerId);
      engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsOption", index: playerId === "p1" ? 0 : 1 } } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(isLiving(engine.state, "p2"), false, "p1's choice knocked p2 out");
    assert.deepEqual(asked, ["p1", "p3"], "p2, out of the game, is not asked");
    assert.equal(engine.state.result, undefined, "p1 and p3 play on");
  });
});
