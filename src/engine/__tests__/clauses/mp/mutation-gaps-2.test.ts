// Multiplayer clause tests added after `mp-mutate` (docs/TESTING.md): each one fails when a player word in the card's data
// is swapped for another ("opponent" -> "any" / "opponents"), because it checks WHICH cards the open pick offers and WHO is
// prompted, not only the final board. Cards: Free Trade Agreement, Stupidify, Brainbath, Voidal Poisoning, Meat of the Mountain,
// Executive Poaching. Expectations come from each card's PRINTED text.

import assert from "node:assert/strict";
import { bank, character, item, resourceCard } from "../../per-card/_harness.js";
import { mpClause, declineAll, printing } from "../_clause.js";
import { COUNTS, answerFor, pickable, plain, startOfTurn } from "./_seats2ndEdition.js";
import { activate, choosePlayer, deckOf, handOf, open, P1, P2, P3, playCard, resolvePendingResponses, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import * as s2 from "./_seed-2.js";
import type { PlayerId } from "../../../../engine.js";

// =================================================================================
// Free Trade Agreement
// At the start of each player's turn, that player chooses one of the following:
// OPTION 1: That player may draw a card and their opponent may play a resource.
// OPTION 2: That player may play a resource and their opponent may draw a card.
// =================================================================================

const FTA = "6a09105b-8cde-488e-ae5b-89ebc81beade";

function ftaTable(count: Count): Table {
  return table(count, [
    { key: "fta", def: printing(FTA), owner: P1, zone: "play" },
    ...seatsOf(count).flatMap((seat): CardPlacement[] => [
      ...Array.from({ length: 8 }, (_, i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })),
      ...Array.from({ length: 2 }, (_, i) => ({ key: `c-${seat}-${i}`, def: character({ name: `Card ${seat} ${i}` }), owner: seat, zone: "hand" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `r-${seat}-${i}`, def: resourceCard({ name: `Resource ${seat} ${i}` }), owner: seat, zone: "hand" as const }))
    ])
  ]);
}

interface Seen {
  who: PlayerId;
  kind: string;
  /** For a card pick: every card the pick offers, sorted. */
  offered?: string[];
}

/** Answers every prompt until none is open (mayPay accepted, a pick takes the picker's first resource), recording who was asked what. */
function playOut(t: Table): Seen[] {
  const seen: Seen[] = [];
  for (let guard = 0; guard < 20; guard++) {
    resolvePendingResponses(t.engine);
    const pc = open(t) as unknown as { kind: string; playerId: PlayerId; [key: string]: unknown } | undefined;
    if (!pc) return seen;
    let choice: unknown;
    if (pc.kind === "mayPay") choice = { kind: "mayPay", pay: true };
    else if (pc.kind === "chooserSelectsTarget") {
      seen.push({ who: pc.playerId, kind: pc.kind, offered: pickable(t) });
      choice = { kind: "chooserSelectsTarget", selected: [t.id(`r-${pc.playerId}-0`)] };
      t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
      continue;
    } else choice = declineAll(pc as never);
    seen.push({ who: pc.playerId, kind: pc.kind });
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  }
  throw new Error("playOut: too many prompts");
}

const sortedHand = (t: Table, who: PlayerId): string[] => [...handOf(t, who)].sort();

/** `actor` starts its turn, selects `opponent` and chooses option `index`. */
function startAndChoose(t: Table, actor: PlayerId, opponent: PlayerId, index: number): void {
  startOfTurn(t, actor);
  const candidates = seatsOf(t.seats.length as Count).filter((seat) => seat !== actor);
  choosePlayer(t, actor, candidates, opponent);
  answerFor(t, actor, "chooserSelectsOption", { index });
}

for (const count of COUNTS) {
  mpClause(FTA, "1:option:OPTION 1", count, `${count} seats: OPTION 1 offers the selected opponent only that opponent's own hand to play a resource from, and prompts nobody else`, () => {
    for (const [actor, opponent] of [[P2, P3], [P2, P1], [P3, P1], [P3, P2]] as Array<[PlayerId, PlayerId]>) {
      const t = ftaTable(count);
      const hands = Object.fromEntries(t.seats.map((seat) => [seat, sortedHand(t, seat)]));
      startAndChoose(t, actor, opponent, 0);
      const seen = playOut(t);
      // The actor's draw is a may-pay; the opponent then picks the resource from its own hand.
      assert.deepEqual(seen.map((entry) => [entry.who, entry.kind]), [[actor, "mayPay"], [opponent, "chooserSelectsTarget"]], `${actor} may draw, then only ${opponent} picks a resource (${count} seats)`);
      assert.deepEqual(seen[1]!.offered, hands[opponent], `${opponent} is offered exactly its own hand: not ${actor}'s, the controller's or another opponent's (${count} seats)`);
      assert.equal(zoneOf(t, `r-${opponent}-0`), "play", `${opponent}'s resource was played`);
      for (const seat of t.seats.filter((s) => s !== opponent)) assert.equal(zoneOf(t, `r-${seat}-0`), "hand", `${seat} played nothing`);
    }
  });

  mpClause(FTA, "2:option:OPTION 2", count, `${count} seats: OPTION 2 asks the actor to play a resource and then prompts only the selected opponent about drawing`, () => {
    for (const [actor, opponent] of [[P3, P1], [P3, P2], [P2, P3], [P2, P1]] as Array<[PlayerId, PlayerId]>) {
      const t = ftaTable(count);
      const decks = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
      const hands = Object.fromEntries(t.seats.map((seat) => [seat, sortedHand(t, seat)]));
      startAndChoose(t, actor, opponent, 1);
      const seen = playOut(t);
      assert.deepEqual(seen.map((entry) => [entry.who, entry.kind]), [[actor, "chooserSelectsTarget"], [opponent, "mayPay"]], `${actor} picks a resource, then only ${opponent} may draw (${count} seats)`);
      assert.deepEqual(seen[0]!.offered, hands[actor], `${actor} is offered its own hand (${count} seats)`);
      for (const seat of t.seats) assert.equal(decks[seat]! - deckOf(t, seat).length, seat === opponent ? 1 : 0, `${seat} drew ${seat === opponent ? 1 : 0} (${count} seats)`);
    }
  });
}

// =================================================================================
// Stupidify / Brainbath / Voidal Poisoning: "your opponent discards"
// The discarding opponent is offered only its OWN hand. The final board alone cannot show this when the opponent happens to
// pick its own cards, so these tests check the exact card list the pick offers: not P1's hand, not another opponent's.
// =================================================================================

/** Every seat's hand: two characters, an item and a resource card (keys `ch0-<seat>`, `ch1-<seat>`, `it-<seat>`, `rs-<seat>`). */
function discardHands(count: Count): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    { key: `ch0-${seat}`, def: character({ name: `Char A ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `ch1-${seat}`, def: character({ name: `Char B ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `it-${seat}`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `rs-${seat}`, def: resourceCard({ name: `Resource ${seat}` }), owner: seat, zone: "hand" as const },
    ...[0, 1, 2, 3].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const }))
  ]);
}

/**
 * Answers the discard prompt: it must be the only prompt, asked of `pick`, and offer exactly the cards `pick` held in hand
 * before the play (`handBefore`). Then `pick` discards `keys`.
 */
function discardFromOwnHand(t: Table, pick: PlayerId, handBefore: string[], keys: string[]): void {
  resolvePendingResponses(t.engine);
  const pc = open(t) as unknown as { kind: string; playerId: PlayerId } | undefined;
  assert.ok(pc, "the discard pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget", "the open prompt is the discard pick");
  assert.equal(pc.playerId, pick, `only ${pick}, the chosen opponent, picks the discard`);
  assert.deepEqual(pickable(t), [...handBefore].sort(), `${pick} is offered exactly its own hand: not P1's cards and not another opponent's`);
  t.engine.perform({ type: "resolvePendingChoice", playerId: pick, choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => t.id(key)) } } as never);
  resolvePendingResponses(t.engine);
  assert.equal(open(t), undefined, "no further prompt after the discard");
}

// Stupidify (Seed): "Your opponent discards 2 cards." / RECUR "Your opponent discards a card."
const STUPIDIFY = "baef7715-05a4-4082-b546-c458ce97eeb2";

for (const count of COUNTS) {
  mpClause(STUPIDIFY, "0:rule", count, `${count} seats: the chosen opponent's discard pick offers only that opponent's own hand`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "st", def: printing(STUPIDIFY), owner: P1, zone: "hand" }, ...discardHands(count), ...bank("obsession", 6, P1)]);
      const before = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
      const pickHand = handOf(t, pick).map((id) => id as string);
      playCard(t, P1, "st", { players: { opponent: pick } });
      discardFromOwnHand(t, pick, pickHand, [`ch0-${pick}`, `it-${pick}`]);
      assert.equal(handOf(t, pick).length, before[pick]! - 2, `${pick} discarded 2 cards`);
      for (const seat of seatsOf(count).slice(1).filter((s) => s !== pick)) assert.equal(handOf(t, seat).length, before[seat], `${seat}'s hand is unchanged`);
    }
  });

  mpClause(STUPIDIFY, "1:ability:recur", count, `${count} seats: RECUR's discard pick offers only the chosen opponent's own hand`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "st", def: printing(STUPIDIFY), owner: P1, zone: "discard" }, ...discardHands(count), ...bank("obsession", 6, P1)]);
      const pickHand = handOf(t, pick).map((id) => id as string);
      activate(t, P1, "st", "recur", { players: { opponent: pick } });
      discardFromOwnHand(t, pick, pickHand, [`rs-${pick}`]);
      assert.equal(zoneOf(t, "st"), "removed", "Stupidify was removed from the game");
      assert.equal(handOf(t, pick).length, 3, `${pick} discarded 1 card`);
    }
  });
}

// Brainbath (Seed): RECUR "Your opponent discards a card. Draw a card."
const BRAINBATH = "a037259c-6b3d-4e9a-ae5d-ca91c19c6817";

for (const count of COUNTS) {
  mpClause(BRAINBATH, "1:ability:recur", count, `${count} seats: RECUR's discard pick offers only the chosen opponent's own hand`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "bb", def: printing(BRAINBATH), owner: P1, zone: "discard" }, ...discardHands(count), ...bank("obsession", 6, P1)]);
      const pickHand = handOf(t, pick).map((id) => id as string);
      activate(t, P1, "bb", "recur", { players: { opponent: pick } });
      discardFromOwnHand(t, pick, pickHand, [`ch1-${pick}`]);
      assert.equal(handOf(t, pick).length, 3, `${pick} discarded 1 card`);
      assert.equal(zoneOf(t, "bb"), "removed", "Brainbath was removed from the game");
    }
  });
}

// Meat of the Mountain (Seed 2): "AT LEAST 3 TOKENS: That player may play a resource." reached here by REMOVING a token
// from 4 (the other tests reach 3 by adding one). The drawer is an opponent of the card's controller, so the resource comes
// from the drawer's own hand: a hand of the controller or of the opponent the drawer selected is not the drawer's.
const MEAT = "60eab41e-55d8-428c-991a-de347296fa4f";

function meatBoard(count: number, drawer: PlayerId, tokens: number) {
  return s2.table(
    count,
    [
      { key: "meat", def: printing(MEAT), owner: P1, zone: "play", counters: { token: tokens } },
      ...s2.perSeat(count, "dr", "play", (seat) =>
        s2.item({ name: `Study ${seat}`, behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } })
      ),
      ...s2.perSeat(count, "res", "hand", (seat) => s2.resourceCard({ name: `Coin ${seat}` })),
      ...s2.hands(count, 3, "h"),
      ...s2.seatsFor(count).flatMap((seat) => s2.deckOf(`k-${seat}-`, 5, seat)),
      ...s2.resources("obsession", 1, drawer)
    ],
    { active: drawer }
  );
}

for (const count of COUNTS) {
  mpClause(MEAT, "4:rule", count, `${count} seats: removing a token down to 3 lets an opponent's draw play a resource from the drawer's own hand only`, () => {
    for (const drawer of s2.seatsFor(count).slice(1)) {
      for (const chosen of s2.others(count, drawer)) {
        const t = meatBoard(count, drawer, 4);
        s2.activateAs(t, `dr-${drawer}`, "draw1", {}, drawer);
        s2.choosePlayer(t, drawer, s2.others(count, drawer), chosen);
        const menu = s2.pending(t);
        assert.equal(menu?.kind, "chooserSelectsOption", "the drawer chooses add / remove / nothing");
        assert.equal(menu?.playerId, drawer, "only the player who drew chooses");
        t.engine.perform({ type: "resolvePendingChoice", playerId: drawer, choice: { kind: "chooserSelectsOption", index: 2 } });
        s2.settle(t);
        assert.equal(s2.tokensOn(t, "meat"), 3, "a token was removed: 3 left");
        const pick = s2.pending(t);
        assert.equal(pick?.kind, "chooserSelectsTarget", `${drawer} is asked which resource to play (the card allows it at 3 tokens)`);
        assert.equal(pick?.playerId, drawer, "the drawer picks");
        // the drawer's hand now includes the card it just drew
        const ownHand = [...t.engine.state.players[drawer]!.hand].sort();
        assert.equal(ownHand.length, 5, "3 plain cards, the resource and the drawn card");
        assert.deepEqual(s2.pickable(t), ownHand, `exactly ${drawer}'s own hand is offered: not P1's, not ${chosen}'s`);
        s2.answerTargets(t, drawer, [t.id(`res-${drawer}`)]);
        s2.settle(t);
        assert.equal(s2.zoneOf(t, `res-${drawer}`), "play", "the drawer's resource was played");
        assert.equal(s2.controllerOf(t, `res-${drawer}`), drawer, "the drawer controls it");
        for (const other of s2.others(count, drawer)) assert.equal(s2.zoneOf(t, `res-${other}`), "hand", `${other} played nothing`);
      }
    }
  });
}

// Voidal Poisoning (2nd Edition): "2 TOKENS - Your opponent discards a card."
const POISON = "19153f74-edc7-4fdf-bce9-925f4ec5cdff";

const poisonTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(POISON), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "mine", def: character({ name: "Token holder", life: 5 }), owner: P1, zone: "play", counters: { token: 6 } },
    ...plain("own-hand", 3, P1, "hand"),
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `char-${seat}`, def: character({ name: `Char ${seat}`, life: 5 }), owner: seat, zone: "play", counters: { token: 5 } },
      ...plain(`hand-${seat}-`, 4, seat, "hand")
    ]),
    ...plain("deck", 6, P1, "deck")
  ]);

for (const count of COUNTS) {
  mpClause(POISON, "3:rule", count, `${count} seats: the 2 TOKENS discard pick offers only the chosen opponent's own hand (not P1's, not another opponent's)`, () => {
    for (const opponent of seatsOf(count).slice(1)) {
      const t = poisonTable(count);
      playCard(t, P1, "card", { players: { opponent } });
      const pickHand = handOf(t, opponent).map((id) => id as string);
      answerFor(t, P1, "spendCountersMenu", { optionIndex: 2, sources: [t.id("mine"), t.id("mine")] });
      const pc = open(t) as unknown as { kind: string; playerId: PlayerId };
      assert.equal(pc.kind, "chooserSelectsTarget", "the discard pick opens");
      assert.equal(pc.playerId, opponent, "the chosen opponent picks");
      assert.deepEqual(pickable(t), [...pickHand].sort(), `${opponent} is offered exactly its own 4 cards`);
      answerFor(t, opponent, "chooserSelectsTarget", { selected: [t.id(`hand-${opponent}-0`)] });
      assert.equal(handOf(t, opponent).length, 3, `${opponent} discarded one card`);
    }
  });
}
