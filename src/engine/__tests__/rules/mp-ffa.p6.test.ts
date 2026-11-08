// Multiplayer (free-for-all) rules, part 6: bidding, endless loops and hidden information.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-bid, MPX-loop, MPX-hidden (1).
// Every numbered point is tested at 3 and at 4 seats.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { HIDDEN_DEFINITION_ID, redactFlowViewFor, redactLogFor, redactStateFor, isCardHiddenFrom } from "../../../engine.js";
import cardsJson from "../../../data/cards.js";
import {
  buildGame,
  character,
  noDevelopFaction,
  P1,
  P2,
  P3,
  P4,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { refused, rule, ruleExempt, ruleOpen } from "./_rule.js";

const SEATS = [P1, P2, P3, P4];
const seatsFor = (count: number): PlayerId[] => SEATS.slice(0, count);
const TABLES = [3, 4] as const;

/** Seats whose factions have no develop rule, so turns can pass without start-of-turn prompts. */
const plainSeats = (count: number) => ({
  playerA: { faction: noDevelopFaction() },
  playerB: { faction: noDevelopFaction() },
  extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() }))
});

const ACTIVATED = (effects: unknown[]) =>
  ({ abilities: [{ id: "go", type: "activated", effects }] }) as CardDefinition["behavior"];

// ---------------------------------------------------------------------------
// MPX-bid — CR 413. The engine's only bidding is the `auctionForCard` effect.
// ---------------------------------------------------------------------------

interface AuctionOptions {
  /** Detached resources each seat controls, in seat order (a bid is capped by this). */
  resources: number[];
  /** Whose turn it is (default P1). The prize is in this player's deck. */
  active?: PlayerId;
  /** Seats that have lost before the bidding opens. */
  eliminated?: PlayerId[];
}

function auctionBoard(options: AuctionOptions) {
  const count = options.resources.length;
  const seats = seatsFor(count);
  const active = options.active ?? P1;
  const house = character({
    name: "Auction Block",
    behavior: ACTIVATED([{ type: "auctionForCard", revealFor: "controller" }])
  });
  const built = buildGame({
    ...plainSeats(count),
    activePlayerId: active,
    turn: seats.indexOf(active) + 1,
    cards: [
      { key: "house", def: house, owner: active },
      { key: "skipped", def: tactic({ name: "Skipped" }), owner: active, zone: "deck" as const },
      { key: "prize", def: character({ name: "Prize" }), owner: active, zone: "deck" as const },
      ...seats.flatMap((owner, seat) =>
        Array.from({ length: options.resources[seat] }, (_, i) => ({
          key: `res-${owner}-${i}`,
          def: resourceCard({ name: `Res ${owner} ${i}` }),
          owner
        }))
      )
    ]
  });
  for (const lost of options.eliminated ?? []) built.engine.state.players[lost].eliminated = { turn: 1 };
  built.engine.perform({ type: "activateAbility", playerId: active, cardId: built.id("house"), abilityId: "go" });
  resolvePendingResponses(built.engine);
  const initial = Object.fromEntries(seats.map((owner, seat) => [owner, options.resources[seat]])) as Record<PlayerId, number>;
  return { ...built, initial };
}

type AuctionGame = ReturnType<typeof auctionBoard>;

const prompt = (g: AuctionGame) => {
  const pending = g.engine.state.pendingChoice;
  return pending?.kind === "auctionBid" ? pending : undefined;
};
const bid = (g: AuctionGame, playerId: PlayerId, amount: number) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "auctionBid", bid: amount } });
const spent = (g: AuctionGame, owner: PlayerId) => g.initial[owner] - g.engine.getAvailableResourceCount(owner);
const prize = (g: AuctionGame) => g.engine.state.cards[g.id("prize")]!;

/** Plays `moves` ([player, bid] pairs), checking before each that the prompt is that player's. */
function play(g: AuctionGame, moves: Array<[PlayerId, number]>): void {
  for (const [who, amount] of moves) {
    assert.equal(prompt(g)?.playerId, who, `the prompt should be ${who}'s before their bid of ${amount}`);
    bid(g, who, amount);
  }
}

describe("MPX-bid (1) — every player in the game takes part in a bid", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule("MPX-bid", `${count} seats: every seat is asked in turn when nobody passes`, () => {
      const g = auctionBoard({ resources: seats.map(() => 9) });
      play(g, seats.map((who, i): [PlayerId, number] => [who, i + 1]));
      assert.equal(prompt(g)?.playerId, P1, "after a full round the first bidder is asked again");
      assert.equal(prompt(g)?.highBid, count, "with the last bid standing");
    });

    rule("MPX-bid", `${count} seats: a player who is not the active player or the other player can win the bid`, () => {
      const g = auctionBoard({ resources: seats.map(() => 5) });
      const last = seats[count - 1];
      play(g, [
        [P1, 1],
        [P2, 2],
        ...(count === 4 ? ([[P3, 0]] as Array<[PlayerId, number]>) : []),
        ...(count === 3 ? ([[P3, 3]] as Array<[PlayerId, number]>) : ([[P4, 3]] as Array<[PlayerId, number]>)),
        [P1, 0],
        [P2, 0]
      ]);
      assert.equal(prompt(g), undefined, "the bidding is over");
      assert.equal(prize(g).controllerId, last, "the last seat won");
      assert.equal(prize(g).zone, "play");
      assert.equal(spent(g, last), 3, "and paid the winning bid");
    });

    rule(["MPX-bid", "MPX-elim"], `${count} seats: a player who has lost does not take part`, () => {
      const lost = P2;
      const remaining = seats.filter(s => s !== lost);
      const g = auctionBoard({ resources: seats.map(() => 5), eliminated: [lost] });
      const asked: PlayerId[] = [];
      for (let amount = 1; amount <= remaining.length + 1; amount++) {
        const who = prompt(g)!.playerId;
        asked.push(who);
        bid(g, who, amount);
      }
      assert.deepEqual(asked, [...remaining, remaining[0]], "only the players still in the game are asked, round after round");
      // The first seat holds the lead; everyone else passes in turn.
      while (prompt(g)) bid(g, prompt(g)!.playerId, 0);
      assert.equal(prize(g).controllerId, remaining[0], "the winner is a player still in the game");
      assert.equal(spent(g, lost), 0, "the player who lost paid nothing");
    });

    rule(["MPX-bid", "MPX-elim"], `${count} seats: with only the others eliminated down to two players, the bidding is between those two`, () => {
      const out = seats.filter(s => s !== P1 && s !== P3);
      const g = auctionBoard({ resources: seats.map(() => 5), eliminated: out });
      play(g, [
        [P1, 1],
        [P3, 2]
      ]);
      assert.equal(prompt(g)?.playerId, P1, "P1 and P3 alternate");
      bid(g, P1, 0);
      assert.equal(prize(g).controllerId, P3, "the remaining bidder wins");
    });
  }
});

describe("MPX-bid (2) — bidding begins with the active player and goes clockwise, skipping players who have passed", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule("MPX-bid", `${count} seats: bidding starts with the active player, whichever seat it is, and wraps past the last seat`, () => {
      for (const [index, active] of seats.entries()) {
        const g = auctionBoard({ resources: seats.map(() => 9), active });
        const expected = [...seats.slice(index), ...seats.slice(0, index)];
        const asked: PlayerId[] = [];
        for (let bidAmount = 1; bidAmount <= count; bidAmount++) {
          asked.push(prompt(g)!.playerId);
          bid(g, prompt(g)!.playerId, bidAmount);
        }
        assert.deepEqual(asked, expected, `${active}'s turn: clockwise from ${active}`);
      }
    });

    rule("MPX-bid", `${count} seats: the prompt goes clockwise past a seat that is not next to the bidder`, () => {
      const g = auctionBoard({ resources: seats.map(() => 9), active: P3 });
      assert.equal(prompt(g)?.playerId, P3, "the active player first");
      bid(g, P3, 1);
      assert.equal(prompt(g)?.playerId, count === 3 ? P1 : P4, "then the seat to their left");
    });

    rule("MPX-bid", `${count} seats: a player who has passed is skipped in later rounds`, () => {
      const g = auctionBoard({ resources: seats.map(() => 9) });
      bid(g, P1, 1);
      bid(g, P2, 0);
      // P2 has passed; everyone else keeps bidding round after round.
      const rest = seats.filter(s => s !== P2);
      let amount = 2;
      let asked: PlayerId[] = [];
      for (let i = 0; i < rest.length - 1 + rest.length; i++) {
        const who = prompt(g)!.playerId;
        asked.push(who);
        bid(g, who, amount++);
      }
      assert.ok(!asked.includes(P2), "P2 is never asked again");
      assert.deepEqual(asked.slice(0, rest.length - 1), rest.slice(1), "the first round after P2's pass continues clockwise");
      assert.deepEqual(asked.slice(rest.length - 1), rest, "and the next round is the unpassed seats only");
    });
  }
});

describe("MPX-bid (3) — raise or pass; a player who cannot raise must pass; a player who passed cannot bid again", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);
    const last = seats[count - 1];

    rule("MPX-bid", `${count} seats: a bid at or below the standing bid is refused for every seat, a higher one accepted`, () => {
      const g = auctionBoard({ resources: seats.map(() => 9) });
      play(g, seats.slice(0, count - 1).map((who, i): [PlayerId, number] => [who, i + 2]));
      const standing = count; // the last bid made was `count` (P{count-1} bid (count-1)+1)
      refused(() => bid(g, last, standing), "equal to the standing bid", /exceed/);
      refused(() => bid(g, last, 1), "below the standing bid", /exceed/);
      assert.equal(prompt(g)?.playerId, last, "the refusals left the prompt open");
      bid(g, last, standing + 1);
      assert.equal(prompt(g)?.highBid, standing + 1, "control: a higher bid is accepted");
    });

    rule("MPX-bid", `${count} seats: a player cannot bid more than their detached resources, and must pass when they cannot raise`, () => {
      const resources = seats.map((_, i) => (i === count - 1 ? 1 : 9));
      const g = auctionBoard({ resources });
      play(g, seats.slice(0, count - 1).map((who, i): [PlayerId, number] => [who, i + 2]));
      assert.equal(prompt(g)?.playerId, last);
      assert.equal(prompt(g)?.maxBid, 1, "the last seat can bid at most 1");
      refused(() => bid(g, last, count + 1), "more than the last seat can pay", /more than the detached resources/);
      refused(() => bid(g, last, 1), "1 does not beat the standing bid", /exceed/);
      bid(g, last, 0);
      assert.equal(prompt(g)?.playerId, P1, "control: the pass was accepted and the next seat is asked");
    });

    rule("MPX-bid", `${count} seats: a player who has passed is not asked again, and cannot bid out of turn`, () => {
      const g = auctionBoard({ resources: seats.map(() => 9) });
      play(g, [
        [P1, 1],
        [P2, 0]
      ]);
      refused(() => bid(g, P2, 5), "a player who passed may not bid again", /not your decision/);
      for (const who of seats.slice(2)) bid(g, who, who === P3 ? 2 : 3);
      assert.equal(prompt(g)?.playerId, P1, "the next round skips P2");
      bid(g, P1, 9);
      assert.notEqual(prompt(g)?.playerId, P2, "P2 is still skipped");
    });

    rule("MPX-bid", `${count} seats: a player forced to pass for lack of resources may not bid again either`, () => {
      const resources = seats.map((_, i) => (i === 1 ? 0 : 9));
      const g = auctionBoard({ resources });
      bid(g, P1, 1);
      assert.equal(prompt(g)?.playerId, P2);
      assert.equal(prompt(g)?.maxBid, 0, "P2 has nothing to bid with");
      refused(() => bid(g, P2, 2), "a bid with no detached resources", /more than the detached resources/);
      bid(g, P2, 0);
      for (const who of seats.slice(2)) bid(g, who, who === P3 ? 2 : 3);
      assert.equal(prompt(g)?.playerId, P1, "P2 is not asked again");
    });
  }
});

describe("MPX-bid (4) — bidding ends when one player has not passed: they win, all others lose", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule("MPX-bid", `${count} seats: the bid stays open until every seat but the high bidder has passed, then the high bidder wins`, () => {
      const g = auctionBoard({ resources: seats.map(() => 5) });
      bid(g, P1, 2);
      const others = seats.slice(1);
      for (const [i, who] of others.entries()) {
        assert.ok(prompt(g), `${who} has not passed yet, so the bidding goes on`);
        assert.equal(prompt(g)?.playerId, who);
        bid(g, who, 0);
        if (i < others.length - 1) assert.equal(prize(g).zone, "deploying", "nothing is settled while a player is still to pass");
      }
      assert.equal(prompt(g), undefined, "only the high bidder has not passed: the bidding is over");
      assert.equal(prize(g).zone, "play", "the winner gets the character");
      assert.equal(prize(g).controllerId, P1, "under the winner's control");
      assert.equal(spent(g, P1), 2, "the winner paid the winning bid");
    });

    rule("MPX-bid", `${count} seats: every other player loses the bid: they pay nothing, even after bidding`, () => {
      const g = auctionBoard({ resources: seats.map(() => 6) });
      play(g, seats.map((who, i): [PlayerId, number] => [who, i + 1]));
      // The last seat holds the lead (count); everyone else passes in turn.
      for (const who of seats.slice(0, count - 1)) {
        assert.equal(prompt(g)?.playerId, who);
        bid(g, who, 0);
      }
      assert.equal(prompt(g), undefined);
      const winner = seats[count - 1];
      assert.equal(prize(g).controllerId, winner);
      assert.equal(spent(g, winner), count, "the winner pays the winning bid");
      for (const loser of seats.slice(0, count - 1)) {
        assert.equal(spent(g, loser), 0, `${loser} lost the bid and pays nothing`);
      }
    });

    rule("MPX-bid", `${count} seats: a seat that passes while two or more others still bid does not end the bidding`, () => {
      const g = auctionBoard({ resources: seats.map(() => 5) });
      play(g, [
        [P1, 1],
        [P2, 0]
      ]);
      assert.ok(prompt(g), "two or more players have not passed, so the bidding goes on");
      assert.equal(prize(g).zone, "deploying");
    });
  }
});

describe("MPX-bid (5) — the points RQ-r11-3 leaves open stay open at every table size", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    ruleOpen("MPX-bid", "RQ-r11-3", `${count} seats: when every seat but one has passed without a bid, the one that remains wins the bid at once`, () => {
      const g = auctionBoard({ resources: seats.map(() => 3) });
      for (const who of seats.slice(0, count - 1)) bid(g, who, 0);
      assert.equal(prompt(g), undefined, "only 1 player remains, so the bidding is over");
      assert.equal(prize(g).controllerId, seats[count - 1], "the remaining player wins the bid");
    });

    ruleOpen("MPX-bid", "RQ-r11-3", `${count} seats: when everyone passes, nobody wins and the character returns to the deck`, () => {
      const g = auctionBoard({ resources: seats.map(() => 3) });
      for (const who of seats) bid(g, who, 0);
      assert.equal(prompt(g), undefined, "the bidding is over");
      assert.equal(prize(g).zone, "deck", "nobody won the character");
    });
  }
});

describe("MPX-bid — a real card: Auction House", () => {
  const auctionHouse = (cardsJson as CardDefinition[]).find(c => c.name === "Auction House" && c.set === "1st Edition Part 2");

  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule("MPX-bid", `${count} seats: Auction House bids clockwise from the player whose turn starts, all seats taking part`, () => {
      assert.ok(auctionHouse, "Auction House is in the catalog");
      const built = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "house", def: structuredClone(auctionHouse), owner: P1, zone: "play" },
          { key: "skipped", def: tactic({ name: "Skipped" }), owner: P2, zone: "deck" },
          { key: "prize", def: character({ name: "Prize" }), owner: P2, zone: "deck" },
          ...seats.flatMap(owner =>
            Array.from({ length: 4 }, (_, i) => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner }))
          )
        ]
      });
      built.engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(built.engine);
      settleTurnStart(built.engine);
      assert.equal(built.engine.state.activePlayerId, P2, "P2's turn starts");
      const asked: PlayerId[] = [];
      for (let amount = 1; amount <= count; amount++) {
        const pending = built.engine.state.pendingChoice;
        assert.equal(pending?.kind, "auctionBid");
        if (pending?.kind !== "auctionBid") return;
        asked.push(pending.playerId);
        built.engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "auctionBid", bid: amount } });
        resolvePendingResponses(built.engine);
      }
      assert.deepEqual(asked, [...seats.slice(1), P1], "P2 first, then clockwise, wrapping to P1");
      // Everyone but the last bidder passes.
      for (const who of asked.slice(0, count - 1)) {
        built.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "auctionBid", bid: 0 } });
        resolvePendingResponses(built.engine);
      }
      assert.equal(built.engine.state.pendingChoice, undefined, "one player has not passed: the bidding is over");
      assert.equal(built.engine.state.cards[built.id("prize")]!.controllerId, P1, "the last bidder won");
      assert.equal(built.engine.state.cards[built.id("prize")]!.zone, "play");
    });
  }
});

// ---------------------------------------------------------------------------
// MPX-loop — CR 414.
// ---------------------------------------------------------------------------

/** A character whose mandatory trigger gains 1 influence every time its controller's influence changes: once started it never ends. */
const forever = () =>
  character({
    name: "Forever",
    behavior: {
      abilities: [
        { id: "again", type: "triggered", event: "influenceChanged", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
      ]
    }
  });

const gainOne = (name: string) => tactic({ name, behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });

describe("MPX-loop (1) — a loop no player in the game can end is a draw between all the players in the game", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule("MPX-loop", `${count} seats: an endless loop of mandatory effects ends the game as a draw, nobody wins`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "forever", def: forever(), owner: P1 },
          { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spark") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.winner, "draw", "a loop nobody can stop is a draw");
      for (const seat of seats) assert.equal(engine.isEliminated(seat), false, `${seat} is still in the game: the draw is between all of them`);
      assert.equal(engine.state.responseWindow, undefined, "the loop's leftover stack is dropped");
    });

    rule("MPX-loop", `${count} seats: a loop started by a player who is not the first seat is a draw as well`, () => {
      const started = seats[count - 1];
      const { engine, id } = buildGame({
        ...plainSeats(count),
        activePlayerId: started,
        cards: [
          { key: "forever", def: forever(), owner: started },
          { key: "spark", def: gainOne("Spark"), owner: started, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: started, cardId: id("spark") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.winner, "draw");
    });

    rule(["MPX-loop", "MPX-elim"], `${count} seats: the draw is between the players still in the game; a player who already lost stays out`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "forever", def: forever(), owner: P1 },
          { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
        ]
      });
      engine.state.players[P2].eliminated = { turn: 1 };
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spark") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.winner, "draw", "a draw, not a win for anyone");
      assert.equal(engine.isEliminated(P2), true, "P2 stays out");
      for (const seat of seats.filter(s => s !== P2)) assert.equal(engine.isEliminated(seat), false);
    });

    rule("MPX-loop", `${count} seats: a repetition a player can voluntarily end is not an endless loop`, () => {
      const optional = character({
        name: "Optional Again",
        behavior: {
          abilities: [
            {
              id: "again",
              type: "triggered",
              event: "influenceChanged",
              effects: [
                {
                  type: "chooserSelectsOption",
                  chooser: "controller",
                  options: [
                    { label: "Again", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
                    { label: "Stop", effects: [] }
                  ]
                }
              ]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "optional", def: optional, owner: P1 },
          { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spark") });
      resolvePendingResponses(engine);
      const answer = (label: string) => {
        const pending = engine.state.pendingChoice;
        assert.equal(pending?.kind, "chooserSelectsOption", "an option prompt is open");
        if (pending?.kind !== "chooserSelectsOption") return;
        const index = pending.options.findIndex(o => o.label === label);
        engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsOption", index } });
        resolvePendingResponses(engine);
      };
      for (let round = 0; round < 6; round++) answer("Again");
      assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "still only asking after 6 rounds");
      answer("Stop");
      assert.equal(engine.state.winner, undefined, "no draw");
      assert.equal(engine.state.pendingChoice, undefined, "declining ended the repetition");
    });

    rule("MPX-loop", `${count} seats: effects that end by themselves are not a loop`, () => {
      const bounded = character({
        name: "Bounded",
        behavior: {
          abilities: [
            {
              id: "again",
              type: "triggered",
              event: "influenceChanged",
              condition: { type: "numberCompare", left: { type: "counter", target: "source", counter: "token" }, operator: "<", right: 3 },
              effects: [
                { type: "addCounter", target: "source", counter: "token", amount: 1 },
                { type: "modifyInfluence", player: "controller", amount: 1 }
              ]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "bounded", def: bounded, owner: P1 },
          { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spark") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.winner, undefined);
      assert.equal(engine.state.players[P1].influence, 25 + 1 + 3);
    });
  }
});

describe("MPX-loop (2) — any other player in the game may interrupt a voluntary loop at any point", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    for (const responder of seats.slice(1)) {
      rule(["MPX-loop", "MPX-respond"], `${count} seats: ${responder} can interrupt a repetition; the series then carries on`, () => {
        const cycler = character({ name: "Cycler", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
        const { engine, id } = buildGame({
          ...plainSeats(count),
          cards: [
            { key: "cycler", def: cycler, owner: P1 },
            { key: "reply", def: tactic({ name: "Reply" }), owner: responder, zone: "hand" }
          ]
        });
        const priority = () => engine.state.responseWindow?.priorityPlayerId;
        // Three repetitions go through with every other seat given the chance to respond and declining.
        for (let repetition = 1; repetition <= 3; repetition++) {
          engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
          const offered: PlayerId[] = [];
          while (engine.state.responseWindow?.phase === "acceptingResponses") {
            offered.push(priority()!);
            engine.perform({ type: "passPriority", playerId: priority()! });
          }
          assert.deepEqual(offered, seats.slice(1), `repetition ${repetition}: every other seat is offered the chance, clockwise`);
          resolvePendingResponses(engine);
        }
        assert.equal(engine.state.players[P1].influence, 28, "the three repetitions resolved");
        // Fourth repetition: the responder interrupts.
        engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
        for (const seat of seats.slice(1, seats.indexOf(responder))) engine.perform({ type: "passPriority", playerId: seat });
        assert.equal(priority(), responder, "the offer reaches the responder");
        engine.perform({ type: "playCard", playerId: responder, cardId: id("reply") });
        assert.equal(engine.state.responseStack.length, 2, "the response sits above the 4th repetition");
        resolvePendingResponses(engine);
        assert.equal(engine.state.cards[id("reply")]!.zone, "discard", "the response resolved");
        assert.equal(engine.state.players[P1].influence, 29, "then the 4th repetition completed");
        engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
        resolvePendingResponses(engine);
        assert.equal(engine.state.players[P1].influence, 30, "the series continues after the interruption");
      });
    }

    rule("MPX-loop", `${count} seats: the player running the loop cannot respond to their own repetition`, () => {
      const cycler = character({ name: "Cycler", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
      const { engine, id } = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "cycler", def: cycler, owner: P1 },
          { key: "own", def: tactic({ name: "Own" }), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
      refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("own") }), "you cannot respond to your own actions", /priority/i);
    });
  }
});

ruleExempt(
  "MPX-loop",
  "Points (3) to (5) (demonstrate the loop, each involved player names a repeat count, the smallest count wins, the first involved player clockwise from the active seat picks the stopping point) are an agreement procedure between people. The engine has no loop shortcut or repeat action, only individual actions with a response window after each, so there is no mechanism that depends on the table size."
);

// ---------------------------------------------------------------------------
// MPX-hidden (1) — hidden information, from every viewer's side. (2) needs the
// "your opponent" binding and is not covered here.
// ---------------------------------------------------------------------------

/** A board where every seat has one card in each hidden place, plus public cards. */
function hiddenBoard(count: number, extra: Parameters<typeof buildGame>[0] = {}) {
  const seats = seatsFor(count);
  const built = buildGame({
    ...plainSeats(count),
    ...extra,
    cards: [
      ...seats.flatMap(owner => [
        { key: `hand-${owner}`, def: tactic({ name: `Hand of ${owner}` }), owner, zone: "hand" as const },
        { key: `deck-${owner}`, def: tactic({ name: `Deck of ${owner}` }), owner, zone: "deck" as const },
        { key: `deck2-${owner}`, def: tactic({ name: `Deck 2 of ${owner}` }), owner, zone: "deck" as const },
        { key: `down-${owner}`, def: resourceCard({ name: `Down of ${owner}` }), owner, zone: "play" as const, faceDown: true },
        { key: `up-${owner}`, def: character({ name: `Up of ${owner}` }), owner, zone: "play" as const },
        { key: `disc-${owner}`, def: tactic({ name: `Discard of ${owner}` }), owner, zone: "discard" as const }
      ]),
      ...(extra.cards ?? [])
    ]
  });
  return { ...built, seats };
}

type Board = ReturnType<typeof hiddenBoard>;

const hiddenFrom = (board: Board, state: Board["engine"]["state"], key: string): boolean =>
  state.cards[board.id(key)].definitionId === HIDDEN_DEFINITION_ID;

describe("MPX-hidden (1) — hand, deck and face-down cards are hidden from every other player", () => {
  for (const count of TABLES) {
    const board = () => hiddenBoard(count);

    rule(["MPX-hidden", "CR 403.2a"], `${count} seats: each viewer sees their own hand and none of the others`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const owner of b.seats) {
          assert.equal(hiddenFrom(b, view, `hand-${owner}`), owner !== viewer, `${viewer} looking at ${owner}'s hand`);
        }
      }
    });

    rule(["MPX-hidden", "CR 403.2a"], `${count} seats: a spectator sees no hand`, () => {
      const b = board();
      const view = redactStateFor(b.engine.state, "spectator");
      for (const owner of b.seats) assert.ok(hiddenFrom(b, view, `hand-${owner}`), `${owner}'s hand`);
    });

    rule(["MPX-hidden", "CR 403.1a"], `${count} seats: a deck's contents are hidden from every viewer, its owner included`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const owner of b.seats) {
          assert.ok(hiddenFrom(b, view, `deck-${owner}`), `${viewer} looking at ${owner}'s deck`);
          assert.ok(hiddenFrom(b, view, `deck2-${owner}`), `${viewer} looking at ${owner}'s second deck card`);
        }
      }
    });

    rule(["MPX-hidden", "CR 403.1a"], `${count} seats: showing a viewer their own deck shows them nobody else's`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer, { ownDeckVisible: true });
        for (const owner of b.seats) {
          assert.equal(hiddenFrom(b, view, `deck-${owner}`), owner !== viewer, `${viewer} looking at ${owner}'s deck`);
        }
      }
    });

    rule(["MPX-hidden", "CR 403.1a"], `${count} seats: cards a viewer was shown from a deck are visible to that viewer only`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const shown = b.seats.find(s => s !== viewer)!;
        const view = redactStateFor(b.engine.state, viewer, { visibleCardIds: new Set([b.id(`deck-${shown}`)]) });
        for (const owner of b.seats) {
          assert.equal(hiddenFrom(b, view, `deck-${owner}`), owner !== shown, `${viewer}: only the shown card of ${shown} is visible`);
        }
        for (const other of b.seats.filter(s => s !== viewer)) {
          const unaware = redactStateFor(b.engine.state, other);
          assert.ok(hiddenFrom(b, unaware, `deck-${shown}`), `${other} was not shown it`);
        }
      }
    });

    rule("MPX-hidden", `${count} seats: a face-down card in play is seen only by its controller`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const owner of b.seats) {
          assert.equal(hiddenFrom(b, view, `down-${owner}`), owner !== viewer, `${viewer} looking at ${owner}'s face-down resource`);
        }
      }
      const spectator = redactStateFor(b.engine.state, "spectator");
      for (const owner of b.seats) assert.ok(hiddenFrom(b, spectator, `down-${owner}`), `spectator looking at ${owner}'s face-down resource`);
    });

    rule("MPX-hidden", `${count} seats: face-up in-play and discard cards are visible to every viewer`, () => {
      const b = board();
      for (const viewer of [...b.seats, "spectator" as const]) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const owner of b.seats) {
          assert.ok(!hiddenFrom(b, view, `up-${owner}`), `${viewer} sees ${owner}'s character`);
          assert.ok(!hiddenFrom(b, view, `disc-${owner}`), `${viewer} sees ${owner}'s discard`);
        }
      }
    });

    rule("MPX-hidden", `${count} seats: a card held in another player's hand is seen by its holder only, not by its owner or the rest`, () => {
      const b = board();
      const card = b.engine.state.cards[b.id("hand-p2")];
      const holder = b.seats[count - 1];
      card.heldBy = holder;
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        assert.equal(hiddenFrom(b, view, "hand-p2"), viewer !== holder, `${viewer} looking at p2's card held by ${holder}`);
      }
    });

    rule("MPX-hidden", `${count} seats: a face-down card in the void is seen by the player who put it there and by nobody else`, () => {
      const b = board();
      const voided = b.engine.state.cards[b.id("up-p1")];
      voided.zone = "void";
      voided.faceDown = true;
      const by = b.seats[count - 1];
      voided.faceDownBy = by;
      for (const viewer of b.seats) {
        assert.equal(b.engine.canViewerSeeVoidedCard(viewer, b.id("up-p1")), viewer === by, `engine: ${viewer}`);
        const view = redactStateFor(b.engine.state, viewer, { canSeeVoided: cardId => b.engine.canViewerSeeVoidedCard(viewer, cardId) });
        assert.equal(hiddenFrom(b, view, "up-p1"), viewer !== by, `redacted state: ${viewer}`);
        const fallback = redactStateFor(b.engine.state, viewer);
        assert.equal(hiddenFrom(b, fallback, "up-p1"), viewer !== by, `redacted state without the engine hook: ${viewer}`);
      }
      assert.ok(hiddenFrom(b, redactStateFor(b.engine.state, "spectator"), "up-p1"), "spectator");
    });

    rule("MPX-hidden", `${count} seats: isCardHiddenFrom agrees with the redacted state for every viewer`, () => {
      const b = board();
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const [cardId, card] of Object.entries(b.engine.state.cards)) {
          assert.equal(isCardHiddenFrom(card, viewer), view.cards[cardId].definitionId === HIDDEN_DEFINITION_ID, `${viewer}: ${cardId}`);
        }
      }
    });

    rule("MPX-hidden", `${count} seats: a masked card keeps its id and zone and loses what could identify it`, () => {
      const b = board();
      const secret = b.engine.state.cards[b.id("hand-p2")];
      secret.namedValues = { named: "Secret" };
      secret.linkedTargets = { k: [b.id("hand-p1")] } as never;
      for (const viewer of b.seats.filter(s => s !== P2)) {
        const masked = redactStateFor(b.engine.state, viewer).cards[b.id("hand-p2")];
        assert.equal(masked.id, secret.id);
        assert.equal(masked.zone, "hand");
        assert.equal(masked.namedValues, undefined);
        assert.equal(masked.linkedTargets, undefined);
      }
    });

    rule("MPX-hidden", `${count} seats: no viewer gets the RNG state`, () => {
      const b = board();
      for (const viewer of [...b.seats, "spectator" as const]) {
        assert.equal(redactStateFor(b.engine.state, viewer).rngState, 0, `${viewer}`);
      }
    });
  }
});

describe("MPX-hidden (1) — what a card makes public is public to every viewer, and only that", () => {
  for (const count of TABLES) {
    const withReveal = (zone: "hand" | "deckTop", of: "self" | "any") => {
      const lamp = character({
        name: "Lamp",
        behavior: { abilities: [{ id: "lamp", type: "continuous", modifiers: [], grantsReveal: { zone, of } }] }
      });
      return hiddenBoard(count, { cards: [{ key: "lamp", def: lamp, owner: P1, zone: "play" }] });
    };

    rule("MPX-hidden", `${count} seats: "your hand is revealed" shows the controller's hand to every other viewer, not anyone else's`, () => {
      const b = withReveal("hand", "self");
      const revealed = b.engine.getFlowView().revealed;
      assert.deepEqual(revealed.hands, [P1]);
      for (const viewer of [...b.seats, "spectator" as const]) {
        const view = redactStateFor(b.engine.state, viewer, { revealed });
        for (const owner of b.seats) {
          const shown = owner === P1 || owner === viewer;
          assert.equal(hiddenFrom(b, view, `hand-${owner}`), !shown, `${viewer} looking at ${owner}'s hand`);
        }
      }
    });

    rule("MPX-hidden", `${count} seats: "the top card of your deck is revealed" shows only that card, of the controller's deck, to every viewer`, () => {
      const b = withReveal("deckTop", "self");
      const revealed = b.engine.getFlowView().revealed;
      assert.deepEqual(revealed.deckTop.map(e => e.playerId), [P1]);
      const top = b.engine.state.players[P1].deck[0];
      for (const viewer of [...b.seats, "spectator" as const]) {
        const view = redactStateFor(b.engine.state, viewer, { revealed });
        assert.equal(view.cards[top].definitionId === HIDDEN_DEFINITION_ID, false, `${viewer} sees the top card of P1's deck`);
        for (const owner of b.seats) assert.ok(hiddenFrom(b, view, `deck2-${owner}`), `${viewer}: the rest of ${owner}'s deck stays hidden`);
        for (const owner of b.seats.filter(s => s !== P1)) assert.ok(hiddenFrom(b, view, `deck-${owner}`), `${viewer}: ${owner}'s top card is not revealed`);
      }
    });

    rule("MPX-hidden", `${count} seats: without the revealed list nothing is un-hidden (fail closed)`, () => {
      const b = withReveal("hand", "any");
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer);
        for (const owner of b.seats) assert.equal(hiddenFrom(b, view, `hand-${owner}`), owner !== viewer);
      }
    });

    rule("MPX-hidden", `${count} seats: a reveal granted over every player's hand shows every hand to every viewer`, () => {
      const b = withReveal("hand", "any");
      const revealed = b.engine.getFlowView().revealed;
      assert.deepEqual([...revealed.hands].sort(), b.seats);
      for (const viewer of b.seats) {
        const view = redactStateFor(b.engine.state, viewer, { revealed });
        for (const owner of b.seats) assert.ok(!hiddenFrom(b, view, `hand-${owner}`), `${viewer} sees ${owner}'s hand`);
      }
    });
  }
});

describe("MPX-hidden (1) — a choice is shown in full only to the player who makes it", () => {
  for (const count of TABLES) {
    rule("MPX-hidden", `${count} seats: the bidder sees the auction prompt, every other viewer sees only its kind and who decides`, () => {
      const g = auctionBoard({ resources: seatsFor(count).map(() => 3) });
      const pending = g.engine.state.pendingChoice!;
      assert.equal(pending.kind, "auctionBid");
      for (const viewer of [...seatsFor(count), "spectator" as const]) {
        const view = redactStateFor(g.engine.state, viewer);
        const flow = redactFlowViewFor(g.engine.getFlowView(), viewer);
        for (const shown of [view.pendingChoice, flow.pendingChoice]) {
          if (viewer === pending.playerId) {
            assert.deepEqual(shown, pending, `${viewer} decides and sees it whole`);
          } else {
            assert.deepEqual(shown, { id: pending.id, kind: "auctionBid", playerId: pending.playerId }, `${viewer} sees the minimal form`);
          }
        }
        assert.equal(view.pendingAuction, undefined, `${viewer}: the auction continuation is stripped`);
      }
    });

    rule(["MPX-hidden", "CR 403.1a"], `${count} seats: the cards a player looks at in their own deck are listed to that player only`, () => {
      const seats = seatsFor(count);
      const looker = seats[count - 1];
      const spell = tactic({ name: "Look", behavior: ACTIVATED([{ type: "lookAndReorder", player: "controller", count: 2 }]) });
      const b = hiddenBoard(count, { activePlayerId: looker, cards: [{ key: "look", def: spell, owner: looker, zone: "hand" }] });
      b.engine.perform({ type: "playCard", playerId: looker, cardId: b.id("look") });
      resolvePendingResponses(b.engine);
      const pending = b.engine.state.pendingChoice!;
      assert.equal(pending.playerId, looker);
      assert.equal(pending.kind, "reorderDeck");
      for (const viewer of seats) {
        const shown = redactStateFor(b.engine.state, viewer).pendingChoice as unknown as Record<string, unknown>;
        if (viewer === looker) assert.deepEqual(shown, pending);
        else assert.deepEqual(shown, { id: pending.id, kind: "reorderDeck", playerId: looker }, `${viewer} learns nothing about the cards`);
      }
    });
  }
});

describe("MPX-hidden (1) — the log tells each viewer only what they may know", () => {
  const lines = (log: readonly { message: string }[]) => log.map(entry => entry.message).join("\n");

  for (const count of TABLES) {
    const seats = seatsFor(count);
    const holder = seats[count - 1];

    const reveal = (viewer: "all" | { type: "player"; id: PlayerId }) => {
      const spell = tactic({
        name: "Peek",
        behavior: ACTIVATED([{ type: "reveal", of: { type: "player", id: holder }, zone: "hand", viewer }])
      });
      const b = hiddenBoard(count, { cards: [{ key: "peek", def: spell, owner: P1, zone: "hand" }] });
      b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("peek") });
      resolvePendingResponses(b.engine);
      return b;
    };

    const logFor = (b: Board, viewer: PlayerId | "spectator") => redactLogFor(b.engine.getLog(), b.engine.state.cards, viewer);

    rule("MPX-hidden", `${count} seats: a hand shown to one player is named in the log to that player and the hand's owner only`, () => {
      const b = reveal({ type: "player", id: P2 });
      const secret = `Hand of ${holder}`;
      for (const viewer of seats) {
        const text = lines(logFor(b, viewer));
        const mayKnow = viewer === P2 || viewer === holder;
        assert.equal(text.includes(secret), mayKnow, `${viewer} ${mayKnow ? "was shown" : "was not shown"} ${holder}'s hand`);
      }
      assert.ok(!lines(logFor(b, "spectator")).includes(secret), "a spectator is not shown it either");
      const other = seats.find(s => s !== P2 && s !== holder && s !== P1);
      if (other) assert.match(lines(logFor(b, other)), /looks at 1 card from p\d's hand/, "the others only learn that a look happened");
    });

    rule("MPX-hidden", `${count} seats: a hand revealed to all players is named in the log to every viewer`, () => {
      const b = reveal("all");
      const secret = `Hand of ${holder}`;
      for (const viewer of [...seats, "spectator" as const]) {
        assert.ok(lines(logFor(b, viewer)).includes(secret), `${viewer} sees the revealed hand`);
      }
    });

    rule("MPX-hidden", `${count} seats: a card drawn is named to its drawer and to nobody else`, () => {
      const drawer = holder;
      const spell = tactic({ name: "Draw", behavior: ACTIVATED([{ type: "draw", player: "controller", amount: 1 }]) });
      const b = hiddenBoard(count, {
        activePlayerId: drawer,
        cards: [
          { key: "draw", def: spell, owner: drawer, zone: "hand" },
          { key: "topcard", def: tactic({ name: "Drawn Secret" }), owner: drawer, zone: "deck" }
        ]
      });
      b.engine.state.players[drawer].deck.splice(0, b.engine.state.players[drawer].deck.length, b.id("topcard"), ...b.engine.state.players[drawer].deck.filter(c => c !== b.id("topcard")));
      b.engine.perform({ type: "playCard", playerId: drawer, cardId: b.id("draw") });
      resolvePendingResponses(b.engine);
      assert.ok(b.engine.state.players[drawer].hand.includes(b.id("topcard")), "the card was drawn");
      for (const viewer of seats) {
        assert.equal(lines(logFor(b, viewer)).includes("Drawn Secret"), viewer === drawer, `${viewer}`);
      }
      assert.ok(!lines(logFor(b, "spectator")).includes("Drawn Secret"), "spectator");
    });
  }
});
