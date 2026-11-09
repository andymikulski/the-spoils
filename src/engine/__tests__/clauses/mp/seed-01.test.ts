// Multiplayer clause tests for the Seed set (3 and 4 seats), part 1: the clauses whose data changed. Expectations come
// from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { bank } from "../../per-card/_harness.js";
import { resourceCard } from "../../support/fixtures.js";
import { clause, clauseMismatch, printing } from "../_clause.js";
import {
  answerFor,
  assertOpponentAsked,
  choosePlayer,
  countIn,
  deckOf,
  eventsOf,
  fillSeats,
  handOf,
  open,
  opponents,
  P1,
  P2,
  P3,
  P4,
  passTurn,
  playAction,
  playCard,
  runPrompts,
  seatBefore,
  seatsOf,
  sizes,
  table,
  type Count,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

// =================================================================================
// Thabbashite Wizard
// When this card enters play, both players may draw up to 2 cards.
// =================================================================================

const TWIZARD = "2c419c3a-cd05-4d6c-b6c4-6d2e64655218";

function wizardTable(count: Count): Table {
  return table(count, [{ key: "tw", def: printing(TWIZARD), owner: P1, zone: "hand" }, ...fillSeats(count, 1, 4), ...bank("obsession", 3, P1)]);
}

for (const count of [3, 4] as const) {
  clause(TWIZARD, "0:rule", `${count} seats: both players are P1 and the opponent P1 chooses; only those two may draw, the others draw nothing`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = wizardTable(count);
      const before = sizes(t);
      playCard(t, P1, "tw");
      choosePlayer(t, P1, opponents(t), pick);
      // the active player first, then clockwise
      answerFor(t, P1, "chooseNumber", { value: 2 });
      assert.equal(open(t)?.kind, "chooseNumber");
      assert.equal(open(t)?.playerId, pick, "the chosen opponent decides next");
      answerFor(t, pick, "chooseNumber", { value: 2 });
      assert.equal(open(t), undefined);
      for (const seat of t.seats) assert.equal(before[seat]!.deck - countIn(t, seat, "deck"), seat === P1 || seat === pick ? 2 : 0, `${seat}'s draw`);
    }
  });
}

clause(TWIZARD, "0:rule", "3 seats: each of the two may draw 0, 1 or 2 (accepting and declining); the third seat is never asked", () => {
  for (const [mine, theirs] of [
    [0, 0],
    [1, 2],
    [2, 0]
  ] as const) {
    const t = wizardTable(3);
    const before = sizes(t);
    playCard(t, P1, "tw");
    choosePlayer(t, P1, [P2, P3], P3);
    answerFor(t, P1, "chooseNumber", { value: mine });
    answerFor(t, P3, "chooseNumber", { value: theirs });
    assert.equal(open(t), undefined, "P2 is never asked");
    assert.equal(before[P1]!.deck - countIn(t, P1, "deck"), mine);
    assert.equal(before[P3]!.deck - countIn(t, P3, "deck"), theirs);
    assert.equal(before[P2]!.deck - countIn(t, P2, "deck"), 0);
  }
});

// =================================================================================
// Forbidden Knowledge
// You may look at your opponent's hand, the top card of their deck, and their face-down resources. Draw a card.
// =================================================================================

const FK = "40a1b99a-a5b6-4356-b84c-3cc41a5e6db2";

function fkTable(count: Count): Table {
  return table(count, [
    { key: "fk", def: printing(FK), owner: P1, zone: "hand" },
    ...fillSeats(count, 2, 4),
    ...seatsOf(count).flatMap((seat) => [
      { key: `fd-${seat}-a`, def: resourceCard({ name: `Face-down ${seat} a` }), owner: seat, zone: "play" as const, faceDown: true },
      { key: `fd-${seat}-b`, def: resourceCard({ name: `Face-down ${seat} b` }), owner: seat, zone: "play" as const, faceDown: true }
    ]),
    ...bank("obsession", 4, P1)
  ]);
}

for (const count of [3, 4] as const) {
  clause(FK, "0:rule", `${count} seats: the opponent is chosen first; P1 sees only the chosen opponent's hand and top deck card, then draws`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = fkTable(count);
      assertOpponentAsked(t, playAction(t, P1, "fk"));
      const before = sizes(t);
      const top = deckOf(t, pick)[0]!;
      const hand = [...handOf(t, pick)];
      playCard(t, P1, "fk", { players: { opponent: pick } });
      assert.equal(open(t), undefined);
      const shown = eventsOf(t, "cardsRevealed").filter((event) => event.viewerId === P1);
      const holder = (zone: string) => shown.filter((event) => event.zone === zone);
      assert.deepEqual(holder("hand").map((event) => event.ownerId), [pick], "only the chosen opponent's hand is shown");
      assert.deepEqual([...(holder("hand")[0]!.cardIds as string[])].sort(), [...hand].sort());
      assert.deepEqual(holder("deck").map((event) => [event.ownerId, event.cardIds]), [[pick, [top]]], "only the top card of the chosen opponent's deck is shown");
      assert.equal(shown.some((event) => event.ownerId !== pick), false, "nothing of any other seat is shown");
      assert.equal(before[P1]!.deck - countIn(t, P1, "deck"), 1, "P1 draws a card");
      for (const seat of t.seats.filter((s) => s !== P1)) assert.equal(countIn(t, seat, "hand"), before[seat]!.hand, `${seat}'s hand is unchanged`);
    }
  });
}

// "...and their face-down resources": no reveal form reaches face-down cards in play (`reveal` knows only a hand and a
// deck top; `revealCards` is reserved for printings that print "reveal").
for (const count of [3, 4] as const) {
  clauseMismatch(FK, "0:rule", "MP-seed-5", `${count} seats: P1 also sees the chosen opponent's face-down resources, and no other seat's`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = fkTable(count);
      playCard(t, P1, "fk", { players: { opponent: pick } });
      const resources = eventsOf(t, "cardsRevealed").filter((event) => event.viewerId === P1 && event.zone === "play");
      assert.deepEqual(resources.map((event) => event.ownerId), [pick]);
      assert.deepEqual([...(resources[0]!.cardIds as string[])].sort(), [t.id(`fd-${pick}-a`), t.id(`fd-${pick}-b`)].sort(), "its face-down resources, and not P1's own or any other opponent's");
    }
  });
}

// =================================================================================
// Obscene Communion
// At the start of each player's turn, that player chooses one of the following:
//   OPTION 1: Both players draw a card. Both players put a card from their hand on the bottom of their deck.
//   OPTION 2: Both players put a resource they control into its owner's hand. Both players may play a resource.
//   OPTION 3: Both players discard a card.
//   OPTION 4: Both players put a card from their hand on the top of their deck.
// =================================================================================

const COMMUNION = "604a992d-9d16-41db-b9f7-7face9e9a3da";

function communionCards(count: Count): Parameters<typeof table>[1] {
  return [
    { key: "oc", def: printing(COMMUNION), owner: P1, zone: "play" },
    ...fillSeats(count, 3, 4),
    ...seatsOf(count).flatMap((seat) => [
      { key: `r-${seat}-a`, def: resourceCard({ name: `Res ${seat} a` }), owner: seat, zone: "play" as const },
      { key: `r-${seat}-b`, def: resourceCard({ name: `Res ${seat} b` }), owner: seat, zone: "play" as const }
    ])
  ];
}

/** The turn of `turnSeat` starts: its active player is asked for an opponent (own opponents only), then the option. Returns the table at the option prompt. */
function communionStart(count: Count, turnSeat: PlayerId, pick: PlayerId, option: number, extra: Parameters<typeof table>[1] = []): Table & { before: ReturnType<typeof sizes>; tops: Record<PlayerId, string> } {
  const t = table(count, [...communionCards(count), ...extra], seatBefore({ seats: seatsOf(count) } as Table, turnSeat));
  passTurn(t);
  assert.equal(t.engine.state.activePlayerId, turnSeat);
  const candidates = t.seats.filter((seat) => seat !== turnSeat);
  choosePlayer(t, turnSeat, candidates, pick);
  const before = sizes(t);
  const tops = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat)[0]!]));
  answerFor(t, turnSeat, "chooserSelectsOption", { index: option });
  return Object.assign(t, { before, tops });
}

/** Answers every prompt picking the first listed card key for the asking player; returns who was asked. */
function takeFirst(t: Table, key: (who: PlayerId, declarationId: string) => string) {
  return runPrompts(t, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { selected: [t.id(key(pc.playerId, (pc.declaration as { id: string }).id))] };
    return { index: 0 };
  });
}

const turnsOf = (count: Count): Array<[PlayerId, PlayerId[]]> =>
  seatsOf(count).map((seat) => [seat, seatsOf(count).filter((s) => s !== seat)]);

clause(COMMUNION, "0:rule", "3 seats: the trigger fires at the start of every player's turn and the active player (never P1 on another's turn) chooses the option", () => {
  for (const [turnSeat, others] of turnsOf(3)) {
    const t = table(3, communionCards(3), seatBefore({ seats: seatsOf(3) } as Table, turnSeat));
    passTurn(t);
    assert.equal(t.engine.state.activePlayerId, turnSeat);
    const opponentChoice = open(t);
    assert.equal(opponentChoice?.kind, "choosePlayer");
    assert.equal(opponentChoice?.playerId, turnSeat, "the active player selects, not the card's controller");
    assert.deepEqual([...opponentChoice!.candidates!].sort(), [...others].sort());
    answerFor(t, turnSeat, "choosePlayer", { playerId: others[0] });
    const option = open(t);
    assert.equal(option?.kind, "chooserSelectsOption");
    assert.equal(option?.playerId, turnSeat, "the active player chooses the option");
  }
});

clause(COMMUNION, "0:rule", "4 seats: it fires at the start of all four turns, each active player (P4 on P4's turn too) choosing the option", () => {
  for (const [turnSeat, others] of turnsOf(4)) {
    const t = table(4, communionCards(4), seatBefore({ seats: seatsOf(4) } as Table, turnSeat));
    passTurn(t);
    const opponentChoice = open(t);
    assert.equal(opponentChoice?.kind, "choosePlayer");
    assert.equal(opponentChoice?.playerId, turnSeat);
    assert.deepEqual([...opponentChoice!.candidates!].sort(), [...others].sort(), "three opponents are offered");
    answerFor(t, turnSeat, "choosePlayer", { playerId: others[others.length - 1] });
    assert.equal(open(t)?.kind, "chooserSelectsOption");
    assert.equal(open(t)?.playerId, turnSeat);
  }
});

/** Every (turn seat, pick) pair worth running at a table. */
const communionRuns = (count: Count): Array<[PlayerId, PlayerId]> =>
  count === 3
    ? [
        [P2, P3],
        [P2, P1],
        [P1, P2],
        [P1, P3],
        [P3, P1],
        [P3, P2]
      ]
    : [
        [P2, P3],
        [P2, P4],
        [P2, P1],
        [P4, P1],
        [P4, P2],
        [P4, P3],
        [P1, P3]
      ];

for (const count of [3, 4] as const) {
  clause(COMMUNION, "1:option:OPTION 1", `${count} seats: both players are the active player and the one opponent they pick: only those two draw a card and put a card from hand on the bottom of their deck`, () => {
    for (const [turnSeat, pick] of communionRuns(count)) {
      const t = communionStart(count, turnSeat, pick, 0);
      const { before, tops } = t;
      const asked = takeFirst(t, (who) => `h-${who}-0`);
      const pair = [turnSeat, pick];
      assert.deepEqual(asked.map((entry) => entry.playerId), pair, "only the pair put a card back, the active player first");
      for (const seat of t.seats) {
        if (pair.includes(seat)) {
          assert.ok(handOf(t, seat).includes(tops[seat]!), `${seat} drew the top card of its deck`);
          assert.equal(deckOf(t, seat).slice(-1)[0], t.id(`h-${seat}-0`), `${seat} put a card from its hand on the bottom of its deck`);
          assert.equal(countIn(t, seat, "hand"), before[seat]!.hand);
          assert.equal(countIn(t, seat, "deck"), before[seat]!.deck);
        } else {
          assert.deepEqual(sizes(t)[seat], before[seat], `${seat} did nothing`);
        }
      }
    }
  });

  clause(COMMUNION, "2:option:OPTION 2", `${count} seats: only the active player and the opponent they pick put a resource they control into its owner's hand and may play a resource`, () => {
    for (const [turnSeat, pick] of communionRuns(count)) {
      // P1 owns a resource that the picked opponent controls
      const stolen = { key: "stolen", def: resourceCard({ name: "Stolen resource" }), owner: P1, controller: pick === P1 ? undefined : pick, zone: "play" as const };
      const t = communionStart(count, turnSeat, pick, 1, pick === P1 ? [] : [stolen]);
      const { before } = t;
      const pair = [turnSeat, pick];
      const asked = takeFirst(t, (who, id) => (id === "r" ? (who === pick && pick !== P1 ? "stolen" : `r-${who}-a`) : `h-${who}-0`));
      assert.deepEqual(new Set(asked.map((entry) => entry.playerId)), new Set(pair), "only the pair is asked anything");
      for (const seat of t.seats) {
        const resources = t.engine.state.players[seat]!.play.filter((id) => t.engine.state.cards[id]!.controllerId === seat && t.engine.getDefinition(id).type === "resource").length;
        if (pair.includes(seat)) {
          const bounced = seat === pick && pick !== P1 ? "stolen" : `r-${seat}-a`;
          assert.notEqual(t.engine.state.cards[t.id(bounced)]!.zone, "play", `${seat}'s resource left play`);
          assert.equal(t.engine.state.cards[t.id(`h-${seat}-0`)]!.zone, "play", `${seat} played a resource`);
        } else {
          assert.equal(resources, 2, `${seat} kept both resources`);
          const gotStolen = seat === P1 && pick !== P1 ? 1 : 0;
          assert.deepEqual(sizes(t)[seat], { ...before[seat]!, hand: before[seat]!.hand + gotStolen }, `${seat} did nothing (P1 only gets its own resource back)`);
        }
      }
      if (pick !== P1 && !(turnSeat === P1)) assert.ok(handOf(t, P1).includes(t.id("stolen")), "the resource went to its owner's hand (P1)");
    }
  });

  clause(COMMUNION, "3:option:OPTION 3", `${count} seats: only the active player and the opponent they pick discard a card of their own choice`, () => {
    for (const [turnSeat, pick] of communionRuns(count)) {
      const t = communionStart(count, turnSeat, pick, 2);
      const { before } = t;
      const pair = [turnSeat, pick];
      const asked = takeFirst(t, (who) => `h-${who}-1`);
      assert.deepEqual(new Set(asked.map((entry) => entry.playerId)), new Set(pair));
      for (const seat of t.seats) {
        if (pair.includes(seat)) {
          assert.equal(t.engine.state.cards[t.id(`h-${seat}-1`)]!.zone, "discard");
          assert.equal(countIn(t, seat, "hand"), before[seat]!.hand - 1);
        } else assert.deepEqual(sizes(t)[seat], before[seat]);
      }
    }
  });

  clause(COMMUNION, "4:option:OPTION 4", `${count} seats: only the active player and the opponent they pick put a card from their hand on top of their own deck`, () => {
    for (const [turnSeat, pick] of communionRuns(count)) {
      const t = communionStart(count, turnSeat, pick, 3);
      const { before } = t;
      const pair = [turnSeat, pick];
      const asked = takeFirst(t, (who) => `h-${who}-2`);
      assert.deepEqual(new Set(asked.map((entry) => entry.playerId)), new Set(pair));
      for (const seat of t.seats) {
        if (pair.includes(seat)) {
          assert.equal(deckOf(t, seat)[0], t.id(`h-${seat}-2`), `${seat}'s card is on top of its own deck`);
          assert.equal(countIn(t, seat, "hand"), before[seat]!.hand - 1);
        } else assert.deepEqual(sizes(t)[seat], before[seat]);
      }
    }
  });
}
