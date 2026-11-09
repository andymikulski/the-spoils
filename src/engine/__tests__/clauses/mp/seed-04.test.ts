// Multiplayer clause tests for the Seed set (3 and 4 seats), part 4: "your opponent's deck" (searches, either deck) and
// damage to "your opponent's faction". Expectations come from each card's PRINTED text, the multiplayer atoms
// (data/rule-tests/source/multiplayer.txt) and data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { bank } from "../../per-card/_harness.js";
import { tactic } from "../../support/fixtures.js";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import {
  abilityAction,
  activate,
  answerFor,
  assertOpponentAsked,
  character,
  choosePlayer,
  countIn,
  deckOf,
  eventsOf,
  mixedHands,
  open,
  opponents,
  P1,
  passTurn,
  playAction,
  playCard,
  runPrompts,
  seatsOf,
  sizes,
  table,
  type CardPlacement,
  type Count,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

/** Cards of `pick`'s deck are named so a wrongly offered card of another seat is a different id. */
const deckKey = (seat: PlayerId, i: number) => `d-${seat}-${i}`;

/**
 * P1 is asked to pick a card from `pick`'s deck (an optional or mandatory search): any other seat's deck card is refused, then
 * `key` is taken. Afterwards only `pick`'s deck was searched and shuffled, and `key` is in `pick`'s discard pile.
 */
function searchOpponentDeck(t: Table, pick: PlayerId, key: string): void {
  const pc = open(t);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "P1 searches");
  for (const seat of t.seats.filter((s) => s !== pick)) {
    refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(deckKey(seat, 1))] }), `${seat}'s deck is not the chosen opponent's deck`);
  }
  answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(key)] });
  assert.equal(t.engine.state.cards[t.id(key)]!.zone, "discard", "the card went to its owner's discard pile");
  assert.equal(t.engine.state.cards[t.id(key)]!.ownerId, pick);
  assert.deepEqual(eventsOf(t, "deckSearched").map((event) => event.playerId), [pick], "only the chosen opponent's deck was searched");
  assert.deepEqual(eventsOf(t, "deckShuffled").map((event) => event.playerId), [pick], "only the chosen opponent's deck was shuffled");
}

/** Nobody but `pick` lost a deck card; every other deck keeps its exact order. */
function otherDecksUntouched(t: Table, before: Record<PlayerId, string[]>, pick: PlayerId): void {
  for (const seat of t.seats.filter((s) => s !== pick)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
}

const deckOrders = (t: Table): Record<PlayerId, string[]> => Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));

// =================================================================================
// Essence of Deception
// Choose one of the following as this card's rules text:
//   OPTION 1: Search your opponent's deck for a card. Put it into their discard pile.
//   OPTION 2: Pick a character. This turn, the character gains 1 speed.
//   OPTION 3: Pick a character. If damage has been inflicted to the character this turn, destroy it.
// =================================================================================

const ESSENCE_D = "01005d53-34a2-4a29-99f9-9a71dc23cdf0";

const zap = tactic({
  name: "Zap",
  behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
});

function essenceDTable(count: Count): Table {
  return table(count, [{ key: "ed", def: printing(ESSENCE_D), owner: P1, zone: "hand" }, { key: "zap", def: zap, owner: P1, zone: "hand" }, ...mixedHands(count), ...bank("deception", 6, P1)]);
}

for (const count of [3, 4] as const) {
  clause(ESSENCE_D, "0:rule", `${count} seats: the option choice involves only P1; only OPTION 1 then asks for an opponent`, () => {
    const t = essenceDTable(count);
    const first = t.engine.getPlayRequirements(playAction(t, P1, "ed") as never);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.kind, "mode");
    assertOpponentAsked(t, playAction(t, P1, "ed", { mode: 0 }));
    for (const mode of [1, 2]) {
      const requirements = t.engine.getPlayRequirements(playAction(t, P1, "ed", { mode }) as never);
      assert.equal(requirements.some((requirement) => requirement.kind === "players"), false, `option ${mode + 1} asks for no player`);
    }
  });

  clause(ESSENCE_D, "1:option:OPTION 1", `${count} seats: OPTION 1 searches only the chosen opponent's deck (P1 may take only a card from it), puts the card into that deck owner's discard pile and shuffles only that deck`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = essenceDTable(count);
      const before = deckOrders(t);
      playCard(t, P1, "ed", { mode: 0, players: { opponent: pick } });
      searchOpponentDeck(t, pick, deckKey(pick, 2));
      otherDecksUntouched(t, before, pick);
      assert.equal(countIn(t, pick, "deck"), 3);
    }
  });

  clause(ESSENCE_D, "2:option:OPTION 2", `${count} seats: OPTION 2 picks any player's character; it gains 1 speed this turn; nobody is asked for an opponent`, () => {
    for (const target of seatsOf(count)) {
      const t = essenceDTable(count);
      const speeds = Object.fromEntries(t.seats.map((seat) => [seat, t.engine.getStat(t.id(`c-${seat}`), "speed")]));
      playCard(t, P1, "ed", { mode: 1, selected: { c: [t.id(`c-${target}`)] } });
      assert.equal(open(t), undefined);
      for (const seat of t.seats) assert.equal(t.engine.getStat(t.id(`c-${seat}`), "speed"), speeds[seat]! + (seat === target ? 1 : 0), `${seat}'s character speed`);
    }
  });

  clause(ESSENCE_D, "3:option:OPTION 3", `${count} seats: OPTION 3 destroys a picked character (any player's) that was damaged this turn, and not one that was not; nobody is asked for an opponent`, () => {
    for (const target of seatsOf(count)) {
      const damaged = seatsOf(count).filter((s) => s !== target).slice(-1)[0]!;
      const t = essenceDTable(count);
      playCard(t, P1, "zap", { selected: { t: [t.id(`c-${target}`)] } });
      assert.equal(t.engine.state.cards[t.id(`c-${target}`)]!.zone, "play");
      // an undamaged character is not destroyed
      const u = essenceDTable(count);
      playCard(u, P1, "zap", { selected: { t: [u.id(`c-${target}`)] } });
      playCard(u, P1, "ed", { mode: 2, selected: { c: [u.id(`c-${damaged}`)] } });
      assert.equal(u.engine.state.cards[u.id(`c-${damaged}`)]!.zone, "play", "no damage this turn: not destroyed");
      playCard(t, P1, "ed", { mode: 2, selected: { c: [t.id(`c-${target}`)] } });
      assert.equal(open(t), undefined);
      assert.equal(t.engine.state.cards[t.id(`c-${target}`)]!.zone, "discard", `${target}'s damaged character was destroyed`);
      for (const seat of t.seats.filter((s) => s !== target)) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.zone, "play");
    }
  });
}

// =================================================================================
// Heist Training Grounds
// With [D][D][D]: At the start of your turn, you may pick a character. If you do, it gains COVERT this turn.
// With [D]x5: At the start of your turn, you may search your opponent's deck for a card. If you do, put it into their discard pile.
// With [D]x7: At the start of your turn, your opponent discards a card at random.
// =================================================================================

const HEIST = "8791105b-7df3-4998-aa65-ab966d007869";

function heistTable(count: Count, deception: number): Table {
  return table(count, [{ key: "htg", def: printing(HEIST), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("deception", deception, P1)], seatsOf(count).slice(-1)[0]!);
}

for (const count of [3, 4] as const) {
  clause(HEIST, "1:rule@ddd", `${count} seats: at the start of P1's turn P1 may pick any character (any seat's); it gains COVERT this turn; nothing fires on the other turns`, () => {
    for (const target of seatsOf(count)) {
      const t = heistTable(count, 3);
      assert.equal(passTurn(t), P1);
      assert.equal(open(t)?.kind, "chooserSelectsTarget");
      assert.equal(open(t)?.playerId, P1);
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`c-${target}`)] });
      assert.equal(open(t), undefined, "no opponent is asked");
      for (const seat of t.seats) assert.equal(t.engine.getKeywords(t.id(`c-${seat}`)).includes("covert"), seat === target, `${seat}'s character`);
      for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined, `nothing is asked at ${seat}'s turn start`);
    }
  });

  clause(HEIST, "2:rule@ddddd", `${count} seats: at the start of P1's turn P1 may search only the chosen opponent's deck; the card goes to that deck's discard pile and only that deck is shuffled; nothing fires on the other turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = heistTable(count, 5);
      const before = deckOrders(t);
      assert.equal(passTurn(t), P1);
      // the 3-icon paragraph asks for a character first (declined), then the search names its opponent
      const prompts: string[] = [];
      for (let guard = 0; guard < 6; guard++) {
        const pc = open(t);
        if (!pc) break;
        prompts.push(pc.kind);
        if (pc.kind === "choosePlayer") answerFor(t, P1, "choosePlayer", { playerId: pick });
        else if (pc.kind === "chooserSelectsTarget" && prompts.length === 1) answerFor(t, P1, "chooserSelectsTarget", { selected: [] });
        else break;
      }
      searchOpponentDeck(t, pick, deckKey(pick, 3));
      assert.deepEqual(prompts.filter((kind) => kind === "choosePlayer").length, 1, "one opponent choice for the search paragraph");
      otherDecksUntouched(t, before, pick);
      for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined);
    }
  });

  clause(HEIST, "3:rule@ddddddd", `${count} seats: at the start of P1's turn a random card of only the chosen opponent's hand is discarded; nothing fires on the other turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = heistTable(count, 7);
      const before = sizes(t);
      const handsBefore = Object.fromEntries(t.seats.map((seat) => [seat, [...t.engine.state.players[seat]!.hand]]));
      assert.equal(passTurn(t), P1);
      runPrompts(t, (pc) => (pc.kind === "choosePlayer" ? { playerId: pick } : { selected: [] }));
      const discarded = handsBefore[pick]!.filter((id) => t.engine.state.cards[id]!.zone === "discard");
      assert.equal(discarded.length, 1, "exactly one card of the chosen opponent's hand was discarded at random");
      for (const seat of t.seats.filter((s) => s !== P1 && s !== pick)) {
        assert.deepEqual(t.engine.state.players[seat]!.hand, handsBefore[seat], `${seat}'s hand is untouched`);
        assert.equal(countIn(t, seat, "discard"), before[seat]!.discard);
      }
      for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined);
    }
  });
}

// =================================================================================
// Shadowy Mugger
// When this card enters play, you may search your opponent's deck for a card. If you do, put it into their discard pile.
// =================================================================================

const MUGGER = "8c9857e6-ba59-4e6d-9459-148426e2bb4a";

for (const count of [3, 4] as const) {
  clause(MUGGER, "1:rule", `${count} seats: P1 chooses the opponent when the trigger resolves, searches only that opponent's deck, the card goes to its discard pile and only that deck is shuffled`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "sm", def: printing(MUGGER), owner: P1, zone: "hand" }, ...mixedHands(count), ...bank("deception", 4, P1)]);
      const before = deckOrders(t);
      playCard(t, P1, "sm");
      choosePlayer(t, P1, opponents(t), pick);
      searchOpponentDeck(t, pick, deckKey(pick, 1));
      otherDecksUntouched(t, before, pick);
    }
  });
}

// =================================================================================
// Pant Swipe
// Remove the top 4 cards of your opponent's deck from the game face-down. (You are still allowed to look at them.)
// For the rest of the game, you may play the removed cards as though they were in your hand even if you cannot meet their threshold.
// =================================================================================

const PANT_SWIPE = "0fae8376-e4e6-4f0c-ae33-8be60ca717a9";

function swipeTable(count: Count): Table {
  const decks: CardPlacement[] = seatsOf(count).flatMap((seat) =>
    [0, 1, 2, 3, 4, 5].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}`, cost: 1, threshold: "rrr" }), owner: seat, zone: "deck" as const }))
  );
  return table(count, [{ key: "ps", def: printing(PANT_SWIPE), owner: P1, zone: "hand" }, ...decks, ...bank("deception", 9, P1)]);
}

for (const count of [3, 4] as const) {
  clause(PANT_SWIPE, "0:rule", `${count} seats: the opponent is chosen first; the top 4 cards of only that opponent's deck are removed from the game`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = swipeTable(count);
      assertOpponentAsked(t, playAction(t, P1, "ps"));
      const before = deckOrders(t);
      playCard(t, P1, "ps", { players: { opponent: pick } });
      const top = before[pick]!.slice(0, 4);
      for (const id of top) assert.equal(t.engine.state.cards[id]!.zone, "removed", "removed from the game");
      assert.deepEqual(deckOf(t, pick), before[pick]!.slice(4), "the rest of the chosen opponent's deck stays");
      otherDecksUntouched(t, before, pick);
    }
  });

  clauseMismatch(PANT_SWIPE, "0:rule", "MP-seed-4", `${count} seats: the removed cards are face-down, so only P1 may look at them and no other seat (the owner, the third player) sees them`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = swipeTable(count);
      const before = deckOrders(t);
      playCard(t, P1, "ps", { players: { opponent: pick } });
      for (const id of before[pick]!.slice(0, 4)) {
        assert.equal(t.engine.state.cards[id]!.faceDown, true, "removed face-down");
        assert.equal(t.engine.canViewerSeeVoidedCard(P1, id), true, "P1 may look at it");
        for (const seat of t.seats.filter((s) => s !== P1)) assert.equal(t.engine.canViewerSeeVoidedCard(seat, id), false, `${seat} may not look at it`);
      }
    }
  });

  clause(PANT_SWIPE, "1:rule", `${count} seats: for the rest of the game P1 (and no one else) may play the four removed cards as though in hand, ignoring their threshold`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = swipeTable(count);
      const before = deckOrders(t);
      playCard(t, P1, "ps", { players: { opponent: pick } });
      const removed = before[pick]!.slice(0, 4);
      const listed = t.engine.getPlayableFromOutsideHand(P1);
      assert.deepEqual(listed.map((entry) => entry.cardId).sort(), [...removed].sort(), "P1 may play exactly the four removed cards");
      assert.ok(listed.every((entry) => entry.ignoreThreshold && entry.playability.playable));
      for (const seat of t.seats.filter((s) => s !== P1)) assert.equal(t.engine.getPlayableFromOutsideHand(seat).length, 0, `${seat} gets no play grant`);
      playCard(t, P1, `d-${pick}-0`);
      assert.equal(t.engine.state.cards[removed[0]!]!.zone, "play");
      assert.equal(t.engine.state.cards[removed[0]!]!.controllerId, P1);
      assert.equal(t.engine.state.cards[before[pick]![4]!]!.zone, "deck", "a card that was not removed stays in the deck");
    }
  });
}

// =================================================================================
// Rigged Tables
// SIZE UP  Deplete this card. Look at the top card of either deck.
// RIG  Pay 1. Put the top card of either deck on the bottom.
// =================================================================================

const TABLES = "48f100ed-f3bb-4dcd-b4b7-78ac791fe579";

function tablesTable(count: Count): Table {
  return table(count, [{ key: "rt", def: printing(TABLES), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("deception", 4, P1)]);
}

for (const count of [3, 4] as const) {
  clause(TABLES, "0:ability:size-up", `${count} seats: SIZE UP names the opponent first, then P1 looks at the top card of P1's deck or of the chosen opponent's deck (two options only)`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const own of [true, false]) {
        const t = tablesTable(count);
        assertOpponentAsked(t, abilityAction(t, P1, "rt", "size-up"));
        activate(t, P1, "rt", "size-up", { players: { opponent: pick } });
        const choice = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; optionCount: number };
        assert.equal(choice.kind, "chooserSelectsOption");
        assert.equal(choice.playerId, P1);
        assert.equal(choice.optionCount, 2, "P1's deck or the chosen opponent's deck, never the third seat's");
        answerFor(t, P1, "chooserSelectsOption", { index: own ? 0 : 1 });
        const look = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; deckOwnerId: PlayerId; cardIds: string[] };
        assert.equal(look.kind, "reorderDeck");
        assert.equal(look.playerId, P1, "P1 looks");
        assert.equal(look.deckOwnerId, own ? P1 : pick, "the deck looked at");
        assert.deepEqual(look.cardIds, [deckOf(t, look.deckOwnerId)[0]], "only the top card");
        answerFor(t, P1, "reorderDeck", { order: look.cardIds });
      }
    }
  });

  clause(TABLES, "1:ability:rig", `${count} seats: RIG names the opponent first, then puts the top card of P1's deck or of the chosen opponent's deck on the bottom of that deck; no other deck changes`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const own of [true, false]) {
        const t = tablesTable(count);
        assertOpponentAsked(t, abilityAction(t, P1, "rt", "rig"));
        const before = deckOrders(t);
        activate(t, P1, "rt", "rig", { players: { opponent: pick } });
        const choice = t.engine.state.pendingChoice as unknown as { optionCount: number };
        assert.equal(choice.optionCount, 2);
        answerFor(t, P1, "chooserSelectsOption", { index: own ? 0 : 1 });
        const moved = own ? P1 : pick;
        assert.deepEqual(deckOf(t, moved), [...before[moved]!.slice(1), before[moved]![0]], `the top card of ${moved}'s deck went to its bottom`);
        for (const seat of t.seats.filter((s) => s !== moved)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
      }
    }
  });
}

// =================================================================================
// Sly Bilker
// SIZE UP  Pay 1. Look at the top card of either deck.
// =================================================================================

const BILKER = "36815079-5262-4a87-b922-cd06177f6ba5";

for (const count of [3, 4] as const) {
  clause(BILKER, "0:ability:size-up", `${count} seats: SIZE UP names the opponent first, then P1 looks at the top card of P1's deck or of the chosen opponent's deck (two options only)`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const own of [true, false]) {
        const t = table(count, [{ key: "sb", def: printing(BILKER), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("deception", 3, P1)]);
        assertOpponentAsked(t, abilityAction(t, P1, "sb", "size-up"));
        activate(t, P1, "sb", "size-up", { players: { opponent: pick } });
        const choice = t.engine.state.pendingChoice as unknown as { kind: string; optionCount: number };
        assert.equal(choice.kind, "chooserSelectsOption");
        assert.equal(choice.optionCount, 2);
        answerFor(t, P1, "chooserSelectsOption", { index: own ? 0 : 1 });
        const look = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; deckOwnerId: PlayerId; cardIds: string[] };
        assert.equal(look.deckOwnerId, own ? P1 : pick);
        assert.equal(look.playerId, P1);
        assert.deepEqual(look.cardIds, [deckOf(t, look.deckOwnerId)[0]]);
        answerFor(t, P1, "reorderDeck", { order: look.cardIds });
      }
    }
  });
}
