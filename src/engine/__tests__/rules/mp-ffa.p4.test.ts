// Multiplayer (free-for-all) rules, part 4: starting an N-player game.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-setup, MPX-draw, MPX-seat, MPX-turn,
// MPX-knitting. Rulings: RQ-mp-4, RQ-mp-6. Rules: CR 601.1.
//
// Every game here is built by `createFactionGame` from real catalog factions and a deck of the five staple
// resources, so the faction's own setup rules (starting resources, opening hand, mulligan) are the ones tested.

import { describe } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../data.js";
import {
  createFactionGame,
  createTwoPlayerFactionGame,
  type CardDefinition,
  type FactionGameSetupOptions,
  type PlayerId,
  type SpoilsEngine
} from "../../../engine.js";
import { P1, P2, P3, P4 } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { passWindows } from "./r08-turn-deploy.shared.js";
import { refused, rule } from "./_rule.js";

const named = (name: string, type: string): CardDefinition => {
  const found = CARD_CATALOG.find(card => card.name === name && card.type === type);
  assert.ok(found, `catalog has ${name}`);
  return found;
};

const TOURNAMENT = named("The Tournament Faction", "faction"); // 2 staples, draws 8 first / 9 second
const SOCIETY = named("The Society of Magical Propriety", "faction"); // Obsession-or-any slot + any card, draws 10 / 9
const ALLIANCE = named("The Evil Alliance", "faction"); // 2 staples, draws 7 / 8
const IMPERIAL = named("Imperial Army", "faction"); // 2 Rage, draws 3 / 3
const KNITTING = named("The Knitting Coalition", "faction"); // 2 Greed, draws 3 / 4, its opponents use that rule
const UNION = named("The Union of Unextraordinary Miners", "faction"); // X staples + 1 Deception, draws 5 / 6

const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"].map(name => named(name, "resource"));

const SEATS = [P1, P2, P3, P4];

/** Seats a game of `factions` in the order given (P1, P2, ...), every deck faction + 8 of each staple. */
function game(factions: CardDefinition[], options: FactionGameSetupOptions = {}): SpoilsEngine {
  const definitions = [...new Set([...factions, ...STAPLES])];
  return createFactionGame(definitions, {
    players: factions.map((faction, seat) => ({
      id: SEATS[seat]!,
      name: `Player ${seat + 1}`,
      deckDefinitionIds: [faction.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))]
    })),
    ...options
  });
}

const handSize = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId]!.hand.length;
const handSizes = (engine: SpoilsEngine, count: number) => SEATS.slice(0, count).map(id => handSize(engine, id));
const resources = (engine: SpoilsEngine, playerId: PlayerId) =>
  engine.state.players[playerId]!.play.filter(id => engine.getDefinition(id).type === "resource");
const resourceNames = (engine: SpoilsEngine, playerId: PlayerId) =>
  resources(engine, playerId).map(id => engine.getDefinition(id).name);

/** Seat counts under test, each with a table of factions that start differently. */
const TABLES: Array<{ seats: number; factions: CardDefinition[] }> = [
  { seats: 3, factions: [TOURNAMENT, SOCIETY, ALLIANCE] },
  { seats: 4, factions: [TOURNAMENT, SOCIETY, ALLIANCE, IMPERIAL] }
];
const OPENING_FIRST: Record<string, number> = {
  [TOURNAMENT.name]: 8,
  [SOCIETY.name]: 10,
  [ALLIANCE.name]: 7,
  [IMPERIAL.name]: 3
};
const OPENING_SECOND: Record<string, number> = {
  [TOURNAMENT.name]: 9,
  [SOCIETY.name]: 9,
  [ALLIANCE.name]: 8,
  [IMPERIAL.name]: 3
};

/** The deciding player of `seed`'s game, from a fresh game that waits for the first-player answer. */
function deciderOf(factions: CardDefinition[], seed: number): { engine: SpoilsEngine; deciderId: PlayerId } {
  const engine = game(factions, { chooseFirstPlayer: true, seed });
  const choice = engine.getFirstPlayerChoice();
  assert.ok(choice, "setup waits for the first-player decision");
  return { engine, deciderId: choice.deciderId };
}

/** Settles a turn start's prompts: Restore and Develop in order, and a faction's optional start-of-turn payment declined. */
function settleOpeningTurn(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 10; guard++) {
    settleTurnStart(engine);
    const pending = engine.state.pendingChoice;
    if (pending?.kind !== "mayPay") return;
    engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "mayPay", pay: false } });
  }
}

/** Answers every mulligan with "keep", clockwise, and returns the order in which the players were asked. */
function keepEveryHand(engine: SpoilsEngine): PlayerId[] {
  const asked: PlayerId[] = [];
  for (let guard = 0; engine.state.setup.phase === "mulligan"; guard++) {
    assert.ok(guard < 10, "the mulligan step ends");
    const setup = engine.state.setup;
    assert.ok(setup.phase === "mulligan", "setup is at the mulligan step");
    const playerId = setup.order[setup.currentIndex]!;
    asked.push(playerId);
    engine.perform({ type: "mulligan", playerId, cardIds: [] });
  }
  return asked;
}

for (const { seats, factions } of TABLES) {
  const ids = SEATS.slice(0, seats);

  describe(`MPX-setup — ${seats} seats: seats and the first-player decision`, () => {
    rule(["MPX-setup", "MPX-seat"], `${seats} seats: the seats are the players in the order given, and every faction starts in play`, () => {
      const engine = game(factions, { firstPlayerId: P1 });
      assert.deepEqual(engine.getSeats(), ids, "seat order is the order the players were given");
      for (const [seat, id] of ids.entries()) {
        const factionId = engine.state.players[id]!.factionId;
        assert.ok(factionId, `${id} has a faction`);
        assert.equal(engine.state.cards[factionId]!.zone, "play", `${id}'s faction starts in play (CR 601.1a)`);
        assert.equal(engine.getDefinition(factionId).name, factions[seat]!.name, `${id} sits with their own faction`);
        assert.equal(engine.state.players[id]!.influence, factions[seat]!.faction!.startingInfluence);
      }
    });

    rule(["MPX-setup", "CR 601.1c"], `${seats} seats: the player who decides who goes first is one of the players, and different seeds pick different players`, () => {
      const deciders = new Set<PlayerId>();
      for (let seed = 1; seed <= 60; seed++) {
        const { engine, deciderId } = deciderOf(factions, seed);
        assert.ok(ids.includes(deciderId), `seed ${seed}: the decider ${deciderId} is a player`);
        const setup = engine.state.setup;
        assert.ok(setup.phase === "chooseFirstPlayer", "setup is waiting for that player");
        assert.deepEqual(setup.order, [deciderId], "only the decider is asked");
        deciders.add(deciderId);
      }
      assert.deepEqual([...deciders].sort(), [...ids].sort(), "every player is picked by some seed");
    });

    rule(["MPX-setup", "CR 601.1c"], `${seats} seats: the same seed picks the same decider`, () => {
      assert.equal(deciderOf(factions, 17).deciderId, deciderOf(factions, 17).deciderId);
    });

    rule(["MPX-setup", "CR 601.1c"], `${seats} seats: the decider may name any player, themselves included, and that player takes the first turn`, () => {
      const { deciderId } = deciderOf(factions, 3);
      for (const chosen of ids) {
        const { engine } = deciderOf(factions, 3);
        assert.equal(engine.getFirstPlayerChoice()?.deciderId, deciderId, "same seed, same decider");
        engine.perform({ type: "chooseFirstPlayer", playerId: deciderId, firstPlayerId: chosen });
        assert.equal(engine.state.activePlayerId, chosen, `${chosen} was chosen to go first${chosen === deciderId ? " (the decider)" : ""}`);
        assert.equal(engine.state.setup.phase, "mulligan", "setup goes on to the mulligan step");
      }
    });

    rule(["MPX-setup", "CR 601.1c"], `${seats} seats: nobody but the decider may answer, and a name that is not a player is refused`, () => {
      const { engine, deciderId } = deciderOf(factions, 3);
      const bystander = ids.find(id => id !== deciderId)!;
      refused(
        () => engine.perform({ type: "chooseFirstPlayer", playerId: bystander, firstPlayerId: bystander }),
        "only the player picked at random decides",
        /does not decide who goes first/
      );
      refused(
        () => engine.perform({ type: "chooseFirstPlayer", playerId: deciderId, firstPlayerId: "nobody" }),
        "the first player must be one of the players",
        /Player 'nobody' not found/
      );
      assert.equal(engine.state.setup.phase, "chooseFirstPlayer", "control: the refused answers changed nothing");
      engine.perform({ type: "chooseFirstPlayer", playerId: deciderId, firstPlayerId: deciderId });
      assert.equal(engine.state.setup.phase, "mulligan", "control: the decider's own answer is accepted");
    });

    rule(["MPX-setup", "CR 601.1c"], `${seats} seats: nothing is drawn until the first player is known; the starting resources are already in play`, () => {
      const { engine } = deciderOf(factions, 5);
      for (const id of ids) {
        assert.equal(handSize(engine, id), 0, `${id} has not drawn yet`);
        assert.equal(resources(engine, id).length, 2, `${id}'s starting resources are in play`);
      }
    });
  });

  describe(`MPX-draw — ${seats} seats: opening hands by who goes first`, () => {
    rule("MPX-draw", `${seats} seats: the first player draws "going first", every other seat "going second", whoever goes first`, () => {
      for (const first of ids) {
        const engine = game(factions, { firstPlayerId: first, seed: 9 });
        ids.forEach((id, seat) => {
          const name = factions[seat]!.name;
          const expected = id === first ? OPENING_FIRST[name]! : OPENING_SECOND[name]!;
          assert.equal(handSize(engine, id), expected, `first player ${first}: ${id} (${name}) draws ${expected}`);
        });
      }
    });

    rule("MPX-draw", `${seats} seats: when the decider picks P3 to go first, P3 draws "going first" and P1, P2 and every later seat "going second"`, () => {
      const { engine, deciderId } = deciderOf(factions, 11);
      engine.perform({ type: "chooseFirstPlayer", playerId: deciderId, firstPlayerId: P3 });
      assert.equal(engine.state.activePlayerId, P3);
      assert.deepEqual(
        handSizes(engine, seats),
        ids.map((id, seat) => (id === P3 ? OPENING_FIRST : OPENING_SECOND)[factions[seat]!.name]!),
        "each seat's opening hand"
      );
    });

    rule("MPX-draw", `${seats} seats: the decider's preview of each choice matches what each player then draws`, () => {
      const { engine } = deciderOf(factions, 11);
      const choice = engine.getFirstPlayerChoice()!;
      assert.deepEqual(Object.keys(choice.openingDraw).sort(), [...ids].sort(), "every player is a candidate");
      for (const first of ids) {
        ids.forEach((id, seat) => {
          const name = factions[seat]!.name;
          assert.equal(
            choice.openingDraw[first]![id],
            id === first ? OPENING_FIRST[name] : OPENING_SECOND[name],
            `if ${first} goes first, ${id} draws ${choice.openingDraw[first]![id]}`
          );
        });
      }
    });
  });

  describe(`MPX-knitting — ${seats} seats: HIDDEN INFLUENCE applies to every opponent`, () => {
    const table = [KNITTING, TOURNAMENT, SOCIETY, ALLIANCE].slice(0, seats);

    rule(["MPX-knitting", "MPX-draw"], `${seats} seats: with The Knitting Coalition first, it draws 3 and every opponent draws 4, whatever their own faction prints`, () => {
      const engine = game(table, { firstPlayerId: P1, seed: 4 });
      assert.deepEqual(handSizes(engine, seats), [3, 4, 4, 4].slice(0, seats));
    });

    rule(["MPX-knitting", "MPX-draw"], `${seats} seats: with another player first, that player draws the Coalition's "going first" 3 and every other seat its "going second" 4`, () => {
      const engine = game(table, { firstPlayerId: P3, seed: 4 });
      assert.deepEqual(handSizes(engine, seats), [4, 4, 3, 4].slice(0, seats));
    });

    rule(["MPX-knitting", "MPX-draw"], `${seats} seats: the decider's preview already uses the Coalition's numbers for every opponent`, () => {
      const { engine } = deciderOf(table, 2);
      const choice = engine.getFirstPlayerChoice()!;
      assert.equal(choice.openingDraw[P2]![P2], 3, "the first opponent draws 3 going first, not their own 8");
      assert.equal(choice.openingDraw[P1]![P2], 4, "and 4 going second, not their own 9");
      assert.equal(choice.openingDraw[P1]![P1], 3, "the Coalition itself keeps its own 3 going first");
    });
  });

  describe(`MPX-setup — ${seats} seats: starting resources`, () => {
    rule(["MPX-setup", "CR 601.1b", "CR 601.1d"], `${seats} seats: every player's starting resources are in play face-up, each by their own faction's rule`, () => {
      const engine = game(factions, { firstPlayerId: P1, seed: 6 });
      for (const [seat, id] of ids.entries()) {
        const inPlay = engine.state.players[id]!.play.filter(cardId => cardId !== engine.state.players[id]!.factionId);
        assert.equal(inPlay.length, 2, `${id} (${factions[seat]!.name}) starts with two cards in play`);
        for (const cardId of inPlay) assert.equal(engine.state.cards[cardId]!.faceDown, false, "flipped face-up");
        assert.ok(
          inPlay.every(cardId => engine.state.cards[cardId]!.ownerId === id),
          "each from their own deck"
        );
      }
      assert.deepEqual(resourceNames(engine, P1), ["Rage", "Rage"], "The Tournament Faction: 2 staples in deck order");
      assert.equal(resourceNames(engine, P2).length, 2, "The Society of Magical Propriety: a resource and any card");
    });

    rule(["MPX-setup", "CR 601.1b"], `${seats} seats: with the staple choice on, the players are asked in turn, clockwise from the first player`, () => {
      const engine = game(factions.map(() => TOURNAMENT), { firstPlayerId: P3, chooseStartingResources: true, seed: 8 });
      const setup = engine.state.setup;
      assert.ok(setup.phase === "chooseStartingResources", "setup is choosing starting resources");
      const expected = seats === 3 ? [P3, P1, P2] : [P3, P4, P1, P2];
      assert.deepEqual(setup.order, expected, "clockwise from P3, wrapping past the last seat");
      for (const id of ids) assert.equal(handSize(engine, id), 0, "nothing is drawn while resources are being chosen");

      const outOfTurn = expected[1]!;
      refused(
        () => engine.perform({ type: "chooseStartingResources", playerId: outOfTurn, cardIds: [] }),
        "only the player whose turn it is chooses",
        /not this player's starting-resource decision/
      );
      for (const id of expected) {
        const choice = engine.getStartingResourceChoice(id)!;
        assert.equal(choice.count, 2);
        engine.perform({ type: "chooseStartingResources", playerId: id, cardIds: choice.candidateCardIds.slice(0, 2) });
      }
      assert.equal(engine.state.setup.phase, "mulligan", "setup moves on once every player has chosen");
      for (const id of ids) {
        assert.equal(resources(engine, id).length, 2, `${id} has their two chosen resources`);
        assert.equal(handSize(engine, id), id === P3 ? 8 : 9, `${id} then draws by seat`);
      }
    });
  });

  describe(`MPX-setup / MPX-turn — ${seats} seats: mulligans, the first turn and turn order`, () => {
    rule(["MPX-setup", "CR 601.1g"], `${seats} seats: mulligans go clockwise starting with the first player`, () => {
      for (const first of ids) {
        const engine = game(factions, { firstPlayerId: first, seed: 12 });
        const setup = engine.state.setup;
        assert.ok(setup.phase === "mulligan", "setup is at the mulligan step");
        assert.deepEqual(setup.order, engine.getPlayersInSeatOrder(first), `first player ${first}: clockwise from them`);
        assert.equal(setup.order[0], first, "the first player mulligans first");
        assert.equal(setup.order.length, seats, "every faction here grants a mulligan");
      }
    });

    rule(["MPX-setup", "CR 601.1f", "CR 601.1g"], `${seats} seats: every player's mulligan works in their turn, and out of turn is refused`, () => {
      const engine = game(factions, { firstPlayerId: P3, seed: 12 });
      const order = engine.getPlayersInSeatOrder(P3);
      for (const [turn, id] of order.entries()) {
        const other = order[(turn + 1) % order.length]!;
        refused(
          () => engine.perform({ type: "mulligan", playerId: other, cardIds: [] }),
          "a player mulligans only when it is their turn to",
          /not this player's mulligan decision/
        );
        const player = engine.state.players[id]!;
        const before = player.hand.length;
        const sent = player.hand.slice(0, 2);
        engine.perform({ type: "mulligan", playerId: id, cardIds: sent });
        assert.equal(player.hand.length, before, `${id} draws as many as they sent back`);
        for (const cardId of sent) {
          const card = engine.state.cards[cardId]!;
          assert.ok(card.zone === "deck" || card.zone === "hand", "sent cards went to the bottom of the deck (or were redrawn)");
        }
        assert.deepEqual(engine.state.mulligan[id]?.length, 2, `${id}'s mulligan is recorded`);
        assert.equal(
          engine.state.setup.phase,
          turn === order.length - 1 ? "complete" : "mulligan",
          "the step ends after the last player"
        );
      }
    });

    rule(["MPX-setup", "MPX-turn", "CR 601.1h"], `${seats} seats: the first turn is the chosen player's, and turns then pass clockwise`, () => {
      const { engine, deciderId } = deciderOf(factions, 21);
      engine.perform({ type: "chooseFirstPlayer", playerId: deciderId, firstPlayerId: P3 });
      assert.deepEqual(keepEveryHand(engine), engine.getPlayersInSeatOrder(P3), "mulligans clockwise from P3");
      assert.equal(engine.state.started, true, "the game began");
      assert.equal(engine.state.turn, 1);
      assert.equal(engine.state.activePlayerId, P3, "the first turn belongs to the chosen first player");

      const sequence: PlayerId[] = [P3];
      settleOpeningTurn(engine);
      for (let turn = 0; turn < seats; turn++) {
        engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
        passWindows(engine);
        settleOpeningTurn(engine);
        sequence.push(engine.state.activePlayerId);
      }
      assert.deepEqual(
        sequence,
        [...engine.getPlayersInSeatOrder(P3), P3],
        "P3, then clockwise through every seat, then back to P3"
      );
      assert.equal(engine.state.turn, seats + 1, "one turn per pass");
    });
  });
}

describe("MPX-setup — the Union of Unextraordinary Miners with several opponents", () => {
  const unionTable = (seats: number) => [TOURNAMENT, UNION, KNITTING, ALLIANCE].slice(0, seats);

  for (const seats of [3, 4]) {
    rule(["MPX-setup", "MPX-select"], `${seats} seats: the Union's controller chooses the opponent it matches; only that opponent is topped up`, () => {
      const factions = unionTable(seats);
      for (const chosen of SEATS.slice(0, seats).filter(id => id !== P2)) {
        const engine = game(factions, {
          firstPlayerId: P1,
          seed: 5,
          startingResourceX: { [P2]: 3 },
          startingResourceOpponent: { [P2]: chosen }
        });
        assert.equal(resources(engine, P2).length, 4, "the Union starts with 3 staples and 1 Deception");
        assert.ok(resourceNames(engine, P2).includes("Deception"), "and the Union's own Deception");
        for (const id of SEATS.slice(0, seats)) {
          if (id === P2) continue;
          assert.equal(
            resources(engine, id).length,
            id === chosen ? 4 : 2,
            `${id}: ${id === chosen ? "topped up to match the Union" : "keeps its usual starting resources"}`
          );
        }
      }
    });

    rule(["MPX-setup", "MPX-select"], `${seats} seats: the Union's opponent must be named, and must be another player`, () => {
      const factions = unionTable(seats);
      const build = (opponent: Record<PlayerId, PlayerId> | undefined) =>
        game(factions, { firstPlayerId: P1, startingResourceX: { [P2]: 3 }, ...(opponent ? { startingResourceOpponent: opponent } : {}) });
      refused(() => build(undefined), "with several opponents the Union must choose one", /must choose which opponent/);
      refused(() => build({ [P2]: P2 }), "the Union cannot choose itself", /must choose which opponent/);
      refused(() => build({ [P2]: "nobody" }), "the Union cannot choose a non-player", /must choose which opponent/);
      assert.equal(resources(build({ [P2]: P1 }), P1).length, 4, "control: a named opponent is accepted");
    });
  }

  rule(["MPX-setup", "MPX-select"], "2 seats: the only opponent is implied; nobody is asked and the top-up goes to them", () => {
    const engine = createFactionGame([UNION, TOURNAMENT, ...STAPLES], {
      players: [
        { id: P1, name: "Player 1", deckDefinitionIds: [UNION.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))] },
        { id: P2, name: "Player 2", deckDefinitionIds: [TOURNAMENT.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))] }
      ],
      firstPlayerId: P1,
      startingResourceX: { [P1]: 3 }
    });
    assert.equal(resources(engine, P1).length, 4);
    assert.equal(resources(engine, P2).length, 4, "topped up without being asked to choose");
  });

  rule(["MPX-setup", "MPX-select", "CR 601.1b"], "3 seats with the staple choice on: the chosen opponent picks the extra staples in a second round, clockwise setup order kept", () => {
    const factions = [TOURNAMENT, UNION, TOURNAMENT];
    const engine = game(factions, {
      firstPlayerId: P3,
      chooseStartingResources: true,
      seed: 14,
      startingResourceX: { [P2]: 3 },
      startingResourceOpponent: { [P2]: P1 }
    });
    const first = engine.state.setup;
    assert.ok(first.phase === "chooseStartingResources", "setup is choosing starting resources");
    assert.deepEqual(first.order, [P3, P1, P2], "clockwise from the first player, P3");

    for (const id of first.order) {
      const choice = engine.getStartingResourceChoice(id)!;
      engine.perform({ type: "chooseStartingResources", playerId: id, cardIds: choice.candidateCardIds.slice(0, choice.count) });
    }
    const topUp = engine.state.setup;
    assert.ok(topUp.phase === "chooseStartingResources" && topUp.topUp === true, "a top-up round follows");
    assert.deepEqual(topUp.order, [P1], "only the Union's chosen opponent is asked");
    assert.deepEqual(topUp.counts, { [P1]: 2 }, "enough staples to reach the Union's 4");
    const choice = engine.getStartingResourceChoice(P1)!;
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: choice.candidateCardIds.slice(0, 2) });

    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(resources(engine, P1).length, 4, "P1 matches the Union");
    assert.equal(resources(engine, P2).length, 4);
    assert.equal(resources(engine, P3).length, 2, "P3 was not chosen: its usual two");
  });
});

describe("MPX-setup — createFactionGame refuses a table that is not a game", () => {
  const seat = (id: PlayerId, faction: CardDefinition) => ({
    id,
    name: id,
    deckDefinitionIds: [faction.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))]
  });
  const defs = [TOURNAMENT, ...STAPLES];

  rule("MPX-setup", "a game needs at least two players", () => {
    refused(() => createFactionGame(defs, { players: [seat(P1, TOURNAMENT)] }), "one player is not a game", /at least two players/);
    refused(() => createFactionGame(defs, { players: [] }), "no players is not a game", /at least two players/);
    assert.equal(createFactionGame(defs, { players: [seat(P1, TOURNAMENT), seat(P2, TOURNAMENT)] }).getSeats().length, 2, "control: two is");
  });

  rule("MPX-setup", "every player needs a distinct id", () => {
    refused(
      () => createFactionGame(defs, { players: [seat(P1, TOURNAMENT), seat(P2, TOURNAMENT), seat(P1, TOURNAMENT)] }),
      "two players cannot share an id",
      /distinct id/
    );
  });

  rule("MPX-setup", "the first player named by the caller must be one of the players", () => {
    const players = [seat(P1, TOURNAMENT), seat(P2, TOURNAMENT), seat(P3, TOURNAMENT)];
    refused(() => createFactionGame(defs, { players, firstPlayerId: P4 }), "P4 is not seated", /must identify one of the players/);
    assert.equal(createFactionGame(defs, { players, firstPlayerId: P3 }).state.activePlayerId, P3, "control: a seated player is accepted");
  });
});

describe("MPX-setup — two seats are the general setup", () => {
  const seatOf = (id: PlayerId, faction: CardDefinition) => ({
    id,
    name: id,
    deckDefinitionIds: [faction.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))]
  });

  const variants: Array<[string, FactionGameSetupOptions]> = [
    ["a fixed first player", { firstPlayerId: P2, seed: 31 }],
    ["a random decider", { chooseFirstPlayer: true, seed: 32 }],
    ["staple choices", { chooseStartingResources: true, seed: 33 }],
    ["both", { chooseFirstPlayer: true, chooseStartingResources: true, seed: 34, startingResourceX: { [P1]: 4 } }]
  ];

  for (const [label, options] of variants) {
    rule("MPX-setup", `createTwoPlayerFactionGame is createFactionGame with two players: the same state (${label})`, () => {
      const [a, b] = [seatOf(P1, UNION), seatOf(P2, KNITTING)];
      const definitions = [UNION, KNITTING, ...STAPLES];
      const general = createFactionGame(definitions, { ...options, players: [a, b] });
      const twoPlayer = createTwoPlayerFactionGame(definitions, a, b, options);
      assert.deepEqual(general.state, twoPlayer.state);
    });
  }

  rule("MPX-setup", "two seats still decide by the same random draw: the decider is one of the two", () => {
    const deciders = new Set<PlayerId>();
    for (let seed = 1; seed <= 20; seed++) deciders.add(deciderOf([TOURNAMENT, ALLIANCE], seed).deciderId);
    assert.deepEqual([...deciders].sort(), [P1, P2]);
  });
});
