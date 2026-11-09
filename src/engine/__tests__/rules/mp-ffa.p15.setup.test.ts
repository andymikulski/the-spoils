// Multiplayer (free-for-all) rules, part 13b: numbers fixed by the table at the start of the game (The Evil Alliance's X),
// at three and four seats with a two-seat equivalence check.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-vocab-each, MPX-setup, MPX-seat; CR 601.1.
//
// Every game is built by `createFactionGame` from the catalog's Evil Alliance with the data form each card should use
// (`faction.perExtraOpponent`) and a deck of the five staple resources.

import { describe } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../data.js";
import { createFactionGame, CREATED_ABILITY_ID, type CardDefinition, type CreatedAbilitySpec, type PlayerId, type SpoilsEngine } from "../../../engine.js";
import { buildGame, character, defaultFactionDefinition, factionCard, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { rule } from "./_rule.js";

const named = (name: string, type: string): CardDefinition => {
  const found = CARD_CATALOG.find(card => card.name === name && card.type === type);
  assert.ok(found, `catalog has ${name}`);
  return found;
};

const TOURNAMENT = named("The Tournament Faction", "faction");
const PRINTED_ALLIANCE = named("The Evil Alliance", "faction");
/** The Evil Alliance as it is authored for a table of any size: the one-opponent figures plus what each further opponent adds. */
const ALLIANCE: CardDefinition = {
  ...PRINTED_ALLIANCE,
  faction: { ...PRINTED_ALLIANCE.faction!, perExtraOpponent: { influence: 10, startingResources: 1, developUses: 1 } }
};
const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"].map(name => named(name, "resource"));
const SEATS = [P1, P2, P3, P4];

/** A game of `factions` seated in the order given, every deck its faction + 8 of each staple. */
function game(factions: CardDefinition[]): SpoilsEngine {
  const definitions = [...new Set([...factions, ...STAPLES])];
  return createFactionGame(definitions, {
    players: factions.map((faction, seat) => ({
      id: SEATS[seat]!,
      name: `Player ${seat + 1}`,
      deckDefinitionIds: [faction.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))]
    }))
  });
}

/** A table of `count` seats with the Alliance in the first seat. */
const table = (count: number): CardDefinition[] => [ALLIANCE, ...Array<CardDefinition>(count - 1).fill(TOURNAMENT)];

const resourcesOf = (engine: SpoilsEngine, who: PlayerId): number =>
  engine.state.players[who]!.play.filter(id => engine.getDefinition(id).type === "resource").length;

/** Keeps every opening hand, then lets `beforeTurn` act, then settles the first turn start (every Develop prompt answered with a draw). Returns the first player's draws. */
function firstTurnDraws(engine: SpoilsEngine, beforeTurn: () => void = () => {}): number {
  for (let guard = 0; engine.state.setup.phase === "mulligan"; guard++) {
    assert.ok(guard < 10, "the mulligan step ends");
    const setup = engine.state.setup;
    assert.ok(setup.phase === "mulligan", "setup is at the mulligan step");
    engine.perform({ type: "mulligan", playerId: setup.order[setup.currentIndex]!, cardIds: [] });
  }
  beforeTurn();
  const before = engine.state.players[P1]!.hand.length;
  settleTurnStart(engine);
  return engine.state.players[P1]!.hand.length - before;
}

describe("MPX-vocab-each / MPX-setup — The Evil Alliance's X is the number of opponents at the start of the game", () => {
  for (const count of [2, 3, 4]) {
    const x = count - 1;

    rule(["MPX-vocab-each", "MPX-setup"], `${count} seats: X is ${x}, so the Alliance starts with ${15 + 10 * x} influence and the other seats with their own printed figure`, () => {
      const engine = game(table(count));
      assert.equal(engine.state.players[P1]!.influence, 15 + 10 * x);
      for (const other of SEATS.slice(1, count)) assert.equal(engine.state.players[other]!.influence, TOURNAMENT.faction!.startingInfluence);
    });

    rule(["MPX-vocab-each", "MPX-setup"], `${count} seats: it starts with 1+X = ${1 + x} staple resources in play, the other seats with their own count`, () => {
      const engine = game(table(count));
      assert.equal(resourcesOf(engine, P1), 1 + x);
      for (const other of SEATS.slice(1, count)) assert.equal(resourcesOf(engine, other), TOURNAMENT.faction!.setup.startingResources.count);
    });

    rule(["MPX-vocab-each", "MPX-setup"], `${count} seats: the Develop Rule is done X = ${x} times, each a fresh draw-or-play choice`, () => {
      assert.equal(firstTurnDraws(game(table(count))), x);
    });

    rule(["MPX-vocab-each", "MPX-setup"], `${count} seats: X is fixed when the game starts: an elimination does not lower the Develop Rule's uses`, () => {
      const engine = game(table(count));
      const draws = firstTurnDraws(engine, () => {
        engine.state.players[P2]!.eliminated = { turn: 1 };
      });
      assert.equal(draws, x, `still ${x} draws with P2 out`);
    });
  }

  rule(["MPX-vocab-each", "MPX-setup"], "2 seats: the printed figures are unchanged (25 influence, 2 staples, one Develop Rule use)", () => {
    const withField = game(table(2));
    const without = game([PRINTED_ALLIANCE, TOURNAMENT]);
    assert.equal(withField.state.players[P1]!.influence, 25);
    assert.equal(without.state.players[P1]!.influence, 25);
    assert.equal(resourcesOf(withField, P1), 2);
    assert.equal(resourcesOf(without, P1), 2);
    assert.equal(firstTurnDraws(withField), 1);
    assert.equal(firstTurnDraws(without), 1);
  });
});

// ---------------------------------------------------------------------------
// Slightly Less Evil Alliance: TEAMWORK ("Pay 2. Pick a card you control. Choose another player. The player takes
// control of the card.").
// ---------------------------------------------------------------------------

const TEAMWORK = factionCard({
  name: "Teamwork Faction",
  faction: defaultFactionDefinition({
    turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [] } },
    abilities: [
      {
        id: "teamwork",
        name: "Teamwork",
        type: "activated",
        costs: [{ type: "payResources", amount: 2 }],
        targets: [{ id: "c", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
        playerChoices: [{ id: "p", from: "opponents" }],
        effects: [{ type: "takeControl", target: { type: "selected", id: "c" }, controller: { type: "chosenPlayer", id: "p" } }]
      }
    ]
  })
});

function teamworkGame(count: number) {
  return buildGame({
    playerA: { faction: TEAMWORK },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    cards: [
      { key: "mine", def: character({ name: "Mine" }), owner: P1 },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `res-${i}`, def: resourceCard({ name: `Res ${i}` }), owner: P1 }))
    ]
  });
}

const teamwork = (built: ReturnType<typeof teamworkGame>, players?: Record<string, PlayerId>): void =>
  built.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: built.engine.state.players[P1]!.factionId!,
    abilityId: "teamwork",
    selected: { c: [built.id("mine")] },
    ...(players ? { players } : {})
  });

describe("MPX-vocab-players / MPX-vocab-an — TEAMWORK gives a card to \"another player\", one chosen by the controller", () => {
  for (const count of [2, 3, 4]) {
    const seats = SEATS.slice(0, count);
    for (const chosen of seats.slice(1)) {
      rule(["MPX-vocab-players", "MPX-vocab-an"], `${count} seats: the controller chooses ${chosen}: only ${chosen} takes control of the card`, () => {
        const built = teamworkGame(count);
        teamwork(built, count > 2 ? { p: chosen } : undefined);
        resolvePendingResponses(built.engine);
        assert.equal(built.engine.state.cards[built.id("mine")]!.controllerId, chosen);
        assert.equal(built.engine.state.cards[built.id("mine")]!.ownerId, P1, "ownership is unchanged");
      });
    }

    if (count > 2) {
      rule(["MPX-vocab-players"], `${count} seats: the controller is not a player the choice accepts`, () => {
        const built = teamworkGame(count);
        assert.throws(() => teamwork(built, { p: P1 }));
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The Open R&D Faction: "both players create the rules text for an ability ... both players can use it".
// ---------------------------------------------------------------------------

const OPEN_RD = factionCard({
  name: "Open R&D",
  faction: defaultFactionDefinition({
    turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [] } },
    playerCreatedAbility: true
  })
});
const WRITTEN: CreatedAbilitySpec = { costs: [{ kind: "pay", amount: 1 }], effect: { kind: "gainInfluence", amount: 1 } };
const FINISH_P2 = tactic({
  name: "Finish P2",
  behavior: {
    abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: { type: "player", id: P2 }, amount: -99 }] }]
  } as CardDefinition["behavior"]
});

function writtenGame(count: number, opponent?: PlayerId) {
  const seats = SEATS.slice(0, count);
  const built = buildGame({
    playerA: { faction: OPEN_RD },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    cards: [
      { key: "kill", def: FINISH_P2, owner: P1, zone: "hand" },
      ...seats.flatMap(owner => Array.from({ length: 3 }, (_, i) => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner })))
    ]
  });
  assert.equal(built.engine.applyCreatedFactionAbility(WRITTEN, opponent), 1);
  return built;
}

const rdCard = (engine: SpoilsEngine): string => engine.state.players[P1]!.factionId!;
const useWritten = (engine: SpoilsEngine, who: PlayerId): void => {
  engine.state.activePlayerId = who;
  engine.state.priorityPlayerId = who;
  engine.perform({ type: "activateAbility", playerId: who, cardId: rdCard(engine), abilityId: CREATED_ABILITY_ID });
  resolvePendingResponses(engine);
};
const lists = (engine: SpoilsEngine, who: PlayerId): boolean => {
  engine.state.activePlayerId = who;
  engine.state.priorityPlayerId = who;
  return engine.getAvailableActivatedAbilities(who).some(entry => entry.cardId === rdCard(engine) && entry.ability.id === CREATED_ABILITY_ID);
};

describe("MPX-both / MPX-lasting — the ability the players wrote is usable by the controller and the one opponent who wrote it with them", () => {
  for (const count of [3, 4]) {
    const opponents = SEATS.slice(1, count);
    for (const chosen of opponents) {
      rule(["MPX-both", "MPX-lasting"], `${count} seats, ${chosen} wrote it with P1: P1 and ${chosen} may use it, nobody else`, () => {
        const { engine } = writtenGame(count, chosen);
        assert.equal(lists(engine, P1), true);
        assert.equal(lists(engine, chosen), true);
        for (const other of opponents.filter(seat => seat !== chosen)) {
          assert.equal(lists(engine, other), false, `${other} is not offered it`);
          assert.throws(() => useWritten(engine, other), `${other} may not use it`);
        }
        const before = engine.state.players[chosen]!.influence;
        useWritten(engine, chosen);
        assert.equal(engine.state.players[chosen]!.influence, before + 1, "the user gains the influence, as themselves");
        assert.equal(engine.state.players[P1]!.influence, 25, "the controller is not the one affected");
      });
    }
  }

  rule(["MPX-both", "MPX-lasting"], "4 seats: when the player who wrote it is eliminated, P1 selects again among those left", () => {
    const { engine, id } = writtenGame(4, P2);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill") });
    resolvePendingResponses(engine);
    assert.ok(engine.state.players[P2]!.eliminated, "P2 is out");
    const asked = engine.state.pendingChoice;
    assert.equal(asked?.kind, "choosePlayer");
    assert.equal(asked?.playerId, P1);
    assert.deepEqual(asked && "candidates" in asked ? asked.candidates : undefined, [P3, P4]);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "choosePlayer", playerId: P4 } });
    assert.equal(lists(engine, P4), true);
    assert.equal(lists(engine, P3), false);
  });

  rule(["MPX-both", "MPX-lasting"], "3 seats: when the player who wrote it is eliminated, the only opponent left is the pair, nobody is asked", () => {
    const { engine, id } = writtenGame(3, P2);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill") });
    resolvePendingResponses(engine);
    assert.ok(engine.state.players[P2]!.eliminated, "P2 is out");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(lists(engine, P3), true);
  });

  rule(["MPX-both"], "2 seats: both players may use it, as before", () => {
    const { engine } = writtenGame(2);
    assert.equal(lists(engine, P1), true);
    assert.equal(lists(engine, P2), true);
  });
});

// ---------------------------------------------------------------------------
// Item 8: The Knitting Coalition's PULLING STRINGS ("Your opponent ignores their faction's DEVELOP RULE") applies to every
// opponent (RQ-mp-6, MPX-knitting).
// ---------------------------------------------------------------------------

describe("MPX-knitting — PULLING STRINGS suppresses the Develop Rule of every opponent", () => {
  const KNITTING = named("The Knitting Coalition", "faction");
  for (const count of [2, 3, 4]) {
    rule(["MPX-knitting"], `${count} seats: no opponent of the Coalition has a Develop Rule; the Coalition's own seat and a table without it are unchanged`, () => {
      const withCoalition = game([KNITTING, ...Array<CardDefinition>(count - 1).fill(TOURNAMENT)]);
      for (const opponent of SEATS.slice(1, count)) assert.deepEqual(withCoalition.getDevelopChoices(opponent), [], `${opponent} ignores their Develop Rule`);
      assert.deepEqual(withCoalition.getDevelopChoices(P1), [], "the Coalition has none of its own");
      const without = game(Array<CardDefinition>(count).fill(TOURNAMENT));
      for (const seat of SEATS.slice(0, count)) assert.equal(without.getDevelopChoices(seat).length, 2, `${seat} keeps draw-or-play`);
    });

    rule(["MPX-knitting"], `${count} seats: the first turn of each opponent starts with no Develop prompt`, () => {
      const engine = game([KNITTING, ...Array<CardDefinition>(count - 1).fill(TOURNAMENT)]);
      for (let guard = 0; engine.state.setup.phase === "mulligan"; guard++) {
        const setup = engine.state.setup;
        assert.ok(setup.phase === "mulligan" && guard < 10, "the mulligan step ends");
        engine.perform({ type: "mulligan", playerId: setup.order[setup.currentIndex]!, cardIds: [] });
      }
      for (const seat of SEATS.slice(0, count)) {
        settleTurnStart(engine);
        assert.equal(engine.state.activePlayerId, seat);
        assert.equal(engine.state.pendingChoice, undefined, `${seat}'s turn starts with nothing to decide`);
        engine.perform({ type: "endTurn", playerId: seat });
        while (engine.state.responseWindow && !engine.state.pendingChoice) {
          const window = engine.state.responseWindow;
          engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
        }
      }
    });
  }
});
