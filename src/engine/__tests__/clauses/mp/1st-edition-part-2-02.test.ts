// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 2: cards played or activated by their
// controller with "your opponent" (the opponent is chosen with the action, before any pick).
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/1st-edition-part-2.json.

import assert from "node:assert/strict";
import { bank, volition } from "../../per-card/_harness.js";
import { mpClause, printing, refused } from "../_clause.js";
import {
  activate,
  activateAction,
  answerPending,
  answerPick,
  assertAsksOpponent,
  character,
  deckOf,
  drawTactic,
  events,
  fillers,
  finisher,
  fund,
  handOf,
  item,
  killTactic,
  open,
  openPick,
  othersOf,
  P1,
  P2,
  P3,
  P4,
  pass,
  perSeat,
  pickableBy,
  pickFrom,
  playAction,
  playCard,
  resolvePendingResponses,
  resourceCard,
  seatsOf,
  stack,
  table,
  zoneOf,
  type CardPlacement,
  type Count,
  type PlayerId,
  type Table
} from "./_support1stEditionPart2.js";

const others = (count: Count): PlayerId[] => seatsOf(count).slice(1);
/** The keys of `seat`'s hand cards made by `perSeat(..., { hand: n })`. */
const handKeys = (seat: PlayerId, n: number): string[] => Array.from({ length: n }, (_, i) => `h-${seat}-${i}`);
const deckKeys = (seat: PlayerId, n: number): string[] => Array.from({ length: n }, (_, i) => `d-${seat}-${i}`);
const idsOf = (t: Table, keys: string[]): string[] => keys.map((key) => t.id(key));
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** The hands and decks of every seat, as copies, to prove who was not touched. */
const snapshot = (t: Table) => Object.fromEntries(t.seats.map((seat) => [seat, { hand: [...handOf(t, seat)], deck: [...deckOf(t, seat)], discard: [...t.engine.state.players[seat]!.discard] }]));
const untouched = (t: Table, before: ReturnType<typeof snapshot>, seat: PlayerId, what = `${seat}`): void => {
  assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${what}: hand unchanged`);
  assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${what}: deck unchanged`);
  assert.deepEqual(t.engine.state.players[seat]!.discard, before[seat]!.discard, `${what}: discard pile unchanged`);
};

// =================================================================================
// Eccentric Inquisition
// Reveal the top 7 cards of your opponent's deck. Remove all revealed tactics from the game and put the remaining
// cards on the bottom of your opponent's deck in any order.
// For the rest of the game, you may play tactics removed from the game by this card as though they were in your hand
// and without having the proper resource icons.
// =================================================================================

const INQUISITION = "847cd807-e515-4c1f-8c4d-fa0ffd7b217d";

/** Every seat's deck: 9 cards, tactics (threshold [R][R]) at positions 1 and 4. */
const tacticDecks = (count: Count): CardPlacement[] =>
  seatsOf(count).flatMap((seat) =>
    stack(`d-${seat}-`, 9, seat, "deck", (i) => (i === 1 || i === 4 ? drawTactic(`Tactic ${seat} ${i}`, "rr") : character({ name: `Card ${seat} ${i}` })))
  );

function inquisitionTable(count: Count): Table {
  return table(count, [
    { key: "inq", def: printing(INQUISITION), owner: P1, zone: "hand" },
    { key: "inq2", def: printing(INQUISITION), owner: P1, zone: "hand" },
    ...tacticDecks(count),
    ...fillers("pad", 2, P1, "hand"),
    ...bank("obsession", 10, P1)
  ]);
}

/** P1 plays an Inquisition (`key`) naming `pick`, orders the 5 non-tactics reversed. */
function inquisition(t: Table, key: string, pick: PlayerId): void {
  assertAsksOpponent(t, playAction(t, P1, key), t.seats.slice(1));
  const before = snapshot(t);
  const topSeven = deckKeys(pick, 9).slice(0, 7);
  const revealedBefore = events(t, "cardsRevealed").filter((event) => event.zone === "deck").length;
  playCard(t, P1, key, { players: { opponent: pick } });
  // the top 7 cards of the chosen opponent's deck are revealed to every player, and no other deck is revealed
  const revealed = events(t, "cardsRevealed").filter((event) => event.zone === "deck").slice(revealedBefore);
  assert.equal(revealed.length, 1, "exactly one deck is revealed");
  assert.equal(revealed[0]!.ownerId, pick);
  assert.equal(revealed[0]!.viewerId, "all");
  assert.deepEqual(revealed[0]!.cardIds, idsOf(t, topSeven));
  // the revealed tactics are removed from the game; P1 puts the rest on the bottom in the order it chooses
  const pc = open(t);
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc?.playerId, P1, "the controller orders the cards, not the deck's owner");
  const rest = [0, 2, 3, 5, 6].map((i) => t.id(`d-${pick}-${i}`));
  const raw = t.engine.state.pendingChoice as unknown as { deckOwnerId: PlayerId; cardIds: string[] };
  assert.equal(raw.deckOwnerId, pick);
  assert.deepEqual(sorted(raw.cardIds), sorted(rest));
  answerPending(t.engine, "reorderDeck", { order: [...rest].reverse() });
  assert.equal(open(t), undefined);
  for (const i of [1, 4]) assert.equal(zoneOf(t, `d-${pick}-${i}`), "removed", "the revealed tactics are removed from the game");
  assert.deepEqual(deckOf(t, pick), [t.id(`d-${pick}-7`), t.id(`d-${pick}-8`), ...[...rest].reverse()], "the others go on the bottom in P1's order");
  for (const seat of t.seats.filter((s) => s !== pick)) {
    if (seat === P1) continue;
    assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}'s deck is untouched`);
  }
}

for (const count of [3, 4] as const) {
  mpClause(INQUISITION, "0:rule", count, `${count} seats: the chosen opponent's top 7 cards are revealed to everyone, their tactics removed, the rest put on the bottom; the others' decks are untouched`, () => {
    for (const pick of others(count)) inquisition(inquisitionTable(count), "inq", pick);
  });

  mpClause(INQUISITION, "1:rule", count, `${count} seats: only the controller may play the tactics removed from an opponent's deck, ignoring icons`, () => {
    const t = inquisitionTable(count);
    const [first, second] = others(count) as [PlayerId, PlayerId];
    inquisition(t, "inq", first);
    inquisition(t, "inq2", second);
    for (const [pick, key] of [[first, `d-${first}-1`], [second, `d-${second}-4`]] as const) {
      // nobody else may play it
      for (const seat of t.seats.filter((s) => s !== P1)) {
        assert.equal(t.engine.checkAction({ type: "playCard", playerId: seat, cardId: t.id(key) } as never).ok, false, `${seat} cannot play a tactic removed from ${pick}'s deck`);
      }
      assert.equal(t.engine.checkAction({ type: "playCard", playerId: P1, cardId: t.id(key) } as never).ok, true, "the controller can, without the [R][R] it does not have");
      const hand = handOf(t, P1).length;
      playCard(t, P1, key);
      assert.equal(handOf(t, P1).length, hand + 1, "the removed tactic was played (it draws a card)");
    }
  });
}

// =================================================================================
// Eldridge Gosche — DISRUPT
// Remove 3 tokens from this card. -- Look at your opponent's hand and pick a card. Your opponent must discard that card.
// =================================================================================

const GOSCHE = "11f9caf2-79de-478a-a87f-c2fcfb90e11a";

for (const count of [3, 4] as const) {
  mpClause(GOSCHE, "3:ability:disrupt", count, `${count} seats: the opponent is chosen first; P1 picks a card from that opponent's hand only and that opponent discards it`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "gos", def: printing(GOSCHE), owner: P1, zone: "play", counters: { token: 3 } }, ...perSeat(count, { hand: 3, deck: 3 })]);
      assertAsksOpponent(t, activateAction(t, P1, "gos", "disrupt"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "gos", "disrupt", { players: { opponent: pick } });
      pickFrom(t, P1, handKeys(pick, 3), [handKeys(pick, 3)[1]!]);
      assert.equal(zoneOf(t, handKeys(pick, 3)[1]!), "discard");
      assert.deepEqual(handOf(t, pick), idsOf(t, [handKeys(pick, 3)[0]!, handKeys(pick, 3)[2]!]));
      for (const seat of t.seats.filter((s) => s !== pick)) untouched(t, before, seat);
      assert.equal(t.engine.state.cards[t.id("gos")]!.counters?.token ?? 0, 0, "3 tokens were removed");
    }
  });
}

// =================================================================================
// Quotidian Disappearance
// Your opponent must pick a non-resource card they control. If they do, put that card into its owner's hand.
// =================================================================================

const DISAPPEARANCE = "7c522a1a-aa18-4afa-955e-2a047ff91ecb";

for (const count of [3, 4] as const) {
  mpClause(DISAPPEARANCE, "0:rule", count, `${count} seats: the chosen opponent picks one of their own non-resource cards, which goes to its owner's hand`, () => {
    for (const pick of others(count)) {
      const stolen = pick === P2 ? P3 : P2;
      const t = table(count, [
        { key: "qd", def: printing(DISAPPEARANCE), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => [
          { key: `c-${seat}-a`, def: character({ name: `Char ${seat} A` }), owner: seat },
          { key: `c-${seat}-b`, def: character({ name: `Char ${seat} B` }), owner: seat }
        ]),
        { key: "stolen", def: character({ name: "Stolen" }), owner: stolen, controller: pick },
        ...bank("obsession", 2, P1),
        { key: "res0", def: resourceCard({ name: "Res" }), owner: pick, zone: "play" }
      ]);
      assertAsksOpponent(t, playAction(t, P1, "qd"), t.seats.slice(1));
      playCard(t, P1, "qd", { players: { opponent: pick } });
      // the opponent picks, among the non-resource cards it controls only (including one it controls but does not own)
      const offered = [`c-${pick}-a`, `c-${pick}-b`, "stolen"];
      const prompt = openPick(t);
      assert.equal(prompt.playerId, pick, "the chosen opponent picks, not the controller");
      assert.ok(!prompt.candidates.includes(t.id("res0")), "no resource is offered");
      assert.deepEqual(sorted(prompt.candidates), sorted(idsOf(t, offered)), "only cards the chosen opponent controls are offered");
      answerPick(t, ["stolen"]);
      assert.equal(zoneOf(t, "stolen"), "hand");
      assert.ok(handOf(t, stolen).includes(t.id("stolen")), "a card goes to its OWNER's hand");
      assert.equal(handOf(t, pick).includes(t.id("stolen")), false);
      for (const seat of t.seats.filter((s) => s !== pick)) for (const key of [`c-${seat}-a`, `c-${seat}-b`]) assert.equal(zoneOf(t, key), "play", `${seat}'s cards stay`);
    }
  });
}

// =================================================================================
// Quotidian Virtuoso — DISRUPT
// Pay 2. Discard a card. Deplete this card. -- Look at your opponent's hand and pick a card. Your opponent must
// discard that card.
// =================================================================================

const VIRTUOSO = "b1f959d9-c5cd-4a7c-9b1b-dfcac62fd6a6";

for (const count of [3, 4] as const) {
  mpClause(VIRTUOSO, "0:ability:disrupt", count, `${count} seats: the opponent is chosen with the activation; P1 picks from that opponent's hand only and that opponent discards it`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "qv", def: printing(VIRTUOSO), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 3, deck: 3 })]);
      assertAsksOpponent(t, activateAction(t, P1, "qv", "disrupt"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "qv", "disrupt", { players: { opponent: pick }, selected: { d: [t.id("h-p1-0")] } });
      assert.equal(zoneOf(t, "h-p1-0"), "discard", "P1 discarded a card as the cost");
      assert.equal(t.engine.state.cards[t.id("qv")]!.depleted, true, "the Virtuoso is depleted");
      pickFrom(t, P1, handKeys(pick, 3), [handKeys(pick, 3)[2]!]);
      assert.equal(zoneOf(t, handKeys(pick, 3)[2]!), "discard");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
      assert.equal(handOf(t, pick).length, 2);
    }
  });
}

// =================================================================================
// Ritual of the Knob & Pull
// Pick a character. X is that character's strength. -- If your opponent controls at least X face-down resources,
// destroy the character.
// =================================================================================

const KNOB = "dbc439b3-5628-43ef-bbc1-ea7523e85fb0";

function knobRun(count: Count, pick: PlayerId, down: Record<PlayerId, number>): boolean {
  const t = table(count, [
    { key: "knob", def: printing(KNOB), owner: P1, zone: "hand" },
    { key: "target", def: character({ name: "Target", strength: 3, life: 9 }), owner: P1, zone: "play" },
    ...fund(P1),
    ...seatsOf(count).flatMap((seat) => (seat === P1 ? [] : volition(down[seat] ?? 0, seat)))
  ]);
  assertAsksOpponent(t, playAction(t, P1, "knob"), t.seats.slice(1));
  playCard(t, P1, "knob", { players: { opponent: pick }, selected: { c: [t.id("target")] } });
  return zoneOf(t, "target") === "discard";
}

for (const count of [3, 4] as const) {
  mpClause(KNOB, "0:ability", count, `${count} seats: only the chosen opponent's face-down resources count, never the others' or their total`, () => {
    const seats = others(count);
    for (const pick of seats) {
      // the chosen opponent has 3 (X = 3): destroyed, whatever the others hold
      assert.equal(knobRun(count, pick, { [pick]: 3 }), true, `${pick} controls 3 face-down resources`);
      // the chosen opponent has 1 while another has 3: survives
      const rich = seats.find((s) => s !== pick)!;
      assert.equal(knobRun(count, pick, { [pick]: 1, [rich]: 3 }), false, `${pick} has only 1, ${rich}'s 3 do not count`);
      // 2 + 2 combined is 4 but X = 3 is not met by either one
      assert.equal(knobRun(count, pick, { [pick]: 2, [rich]: 2 }), false, "totals across opponents do not count");
    }
  });
}

// =================================================================================
// Ritual of the Ominous Urn
// Your opponent must discard a card. You may search your deck for a card of the same type as the discarded card,
// reveal it, and put it into your hand.
// =================================================================================

const URN = "8bdf8634-d49d-43f6-b267-15978fab6227";

for (const count of [3, 4] as const) {
  mpClause(URN, "0:rule", count, `${count} seats: only the chosen opponent discards (their choice), then P1 searches its own deck for the same type`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "urn", def: printing(URN), owner: P1, zone: "hand" },
        { key: "d1-char", def: character({ name: "P1 Char In Deck" }), owner: P1, zone: "deck" },
        { key: "d1-tac", def: drawTactic("P1 Tactic In Deck"), owner: P1, zone: "deck" },
        ...fund(P1),
        ...perSeat(count, { hand: 2, deck: 2 })
      ]);
      assertAsksOpponent(t, playAction(t, P1, "urn"), t.seats.slice(1));
      const before = snapshot(t);
      playCard(t, P1, "urn", { players: { opponent: pick } });
      pickFrom(t, pick, handKeys(pick, 2), [handKeys(pick, 2)[0]!]);
      assert.equal(zoneOf(t, handKeys(pick, 2)[0]!), "discard", "the chosen opponent discarded the card of their choice");
      // P1 may search ITS OWN deck for a character (the discarded card's type)
      const search = openPick(t);
      assert.equal(search.playerId, P1);
      assert.deepEqual(sorted(search.candidates), sorted([t.id("d1-char"), ...deckKeys(P1, 2).map((k) => t.id(k))]), "only characters of P1's own deck are offered");
      answerPick(t, ["d1-char"]);
      assert.equal(zoneOf(t, "d1-char"), "hand");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });
}

// =================================================================================
// The Deranger — LOBOTOMIZE
// Deplete this card. -- Look at your opponent's hand and pick 2 or fewer non-resource cards. Your opponent must
// discard those cards. Your opponent takes control of this card.
// =================================================================================

const DERANGER = "cebf2a7c-905e-433d-b6ab-bcdc2aafacbf";

for (const count of [3, 4] as const) {
  mpClause(DERANGER, "0:ability:lobotomize", count, `${count} seats: the chosen opponent loses up to 2 non-resource cards and takes control of the Deranger; nobody else does`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "der", def: printing(DERANGER), owner: P1, zone: "play" },
        ...perSeat(count, { hand: 3, deck: 3 }),
        ...seatsOf(count).map((seat): CardPlacement => ({ key: `res-${seat}`, def: resourceCard({ name: `Res ${seat}` }), owner: seat, zone: "hand" }))
      ]);
      assertAsksOpponent(t, activateAction(t, P1, "der", "lobotomize"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "der", "lobotomize", { players: { opponent: pick } });
      // up to 2 non-resource cards of the chosen opponent's hand are offered
      const offer = openPick(t);
      assert.equal(offer.playerId, P1);
      assert.deepEqual(sorted(offer.candidates), sorted(idsOf(t, handKeys(pick, 3))), "only the chosen opponent's non-resource cards");
      assert.equal(offer.max, 2);
      answerPick(t, handKeys(pick, 3).slice(0, 2));
      for (const key of handKeys(pick, 3).slice(0, 2)) assert.equal(zoneOf(t, key), "discard");
      assert.equal(t.engine.state.cards[t.id("der")]!.controllerId, pick, "the chosen opponent takes control of the Deranger");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
      // later the new controller uses it: ITS opponents are offered, not itself
      while (t.engine.state.activePlayerId !== pick) pass(t, t.engine.state.activePlayerId);
      assertAsksOpponent(t, activateAction(t, pick, "der", "lobotomize"), t.seats.filter((s) => s !== pick));
    }
  });
}

// =================================================================================
// Anesthetizing Opulence
// Pick a character. -- Destroy the character. Your opponent draws a card.
// =================================================================================

const OPULENCE = "9540ce6d-7f45-4fd9-8f71-093a8e438d50";

for (const count of [3, 4] as const) {
  mpClause(OPULENCE, "0:ability", count, `${count} seats: any character is destroyed, and the chosen opponent (not the character's owner) draws a card`, () => {
    for (const pick of others(count)) {
      const owner = others(count).find((s) => s !== pick)!;
      const t = table(count, [
        { key: "opu", def: printing(OPULENCE), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner, zone: "play" },
        ...fund(P1),
        ...perSeat(count, { hand: 1, deck: 4 })
      ]);
      assertAsksOpponent(t, playAction(t, P1, "opu"), t.seats.slice(1));
      const before = snapshot(t);
      playCard(t, P1, "opu", { players: { opponent: pick }, selected: { c: [t.id("victim")] } });
      assert.equal(zoneOf(t, "victim"), "discard");
      assert.equal(handOf(t, pick).length, before[pick]!.hand.length + 1, "the chosen opponent drew");
      assert.equal(deckOf(t, pick)[0], before[pick]!.deck[1], "from the top of its own deck");
      assert.deepEqual(t.engine.state.players[owner]!.discard.slice(-1), [t.id("victim")], "the victim went to its owner's discard pile");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) {
        assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${seat}: hand unchanged`);
        assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}: deck unchanged`);
      }
      assert.equal(handOf(t, P1).length, 1, "P1 drew nothing (its own hand card is still the only one)");
    }
  });
}

const infl = (t: Table, seat: PlayerId): number => t.engine.state.players[seat]!.influence;
const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;

// =================================================================================
// Mutiny Grant
// Pick a character your opponent controls. Your faction loses X influence, where X is the numeric cost of that
// character. -- This turn, you control the character. Restore the character.
// =================================================================================

const MUTINY = "1dc62434-5a69-44ce-acde-488436a14de8";

for (const count of [3, 4] as const) {
  mpClause(MUTINY, "0:ability", count, `${count} seats: only the chosen opponent's characters can be picked; P1 pays their cost and controls it this turn`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "mg", def: printing(MUTINY), owner: P1, zone: "hand" },
        ...seatsOf(count).filter((s) => s !== P1).map((seat): CardPlacement => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, cost: 3 }), owner: seat, zone: "play", depleted: true })),
        ...fund(P1),
        ...perSeat(count, { hand: 1, deck: 2 })
      ]);
      assertAsksOpponent(t, playAction(t, P1, "mg"), t.seats.slice(1));
      assert.deepEqual(
        pickableBy(t, P1, "mg", "pick", others(count).map((s) => `c-${s}`), { players: { opponent: pick } }),
        [`c-${pick}`],
        "the pick offers only characters the chosen opponent controls"
      );
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      playCard(t, P1, "mg", { players: { opponent: pick }, selected: { pick: [t.id(`c-${pick}`)] } });
      assert.equal(infl(t, P1), before[P1]! - 3, "P1's faction lost X = the numeric cost");
      for (const seat of others(count)) assert.equal(infl(t, seat), before[seat], `${seat}'s faction is unaffected`);
      assert.equal(controllerOf(t, `c-${pick}`), P1, "P1 controls it this turn");
      assert.equal(t.engine.state.cards[t.id(`c-${pick}`)]!.depleted, false, "restored");
      for (const seat of others(count).filter((s) => s !== pick)) assert.equal(controllerOf(t, `c-${seat}`), seat);
      pass(t, P1);
      assert.equal(controllerOf(t, `c-${pick}`), pick, "control returns at the end of the turn");
    }
  });
}

// =================================================================================
// Discommodiousness
// Your opponent must reveal their hand and shuffle all tactics from it into their deck. Your opponent draws X cards,
// where X is the number of tactics shuffled into their deck. Draw a card.
// =================================================================================

const DISCOMMODIOUSNESS = "42334135-ad09-4e14-b243-597d4a44384e";

for (const count of [3, 4] as const) {
  mpClause(DISCOMMODIOUSNESS, "0:rule", count, `${count} seats: only the chosen opponent reveals their hand and replaces its tactics; the others are untouched`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "disc", def: printing(DISCOMMODIOUSNESS), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => [
          { key: `t-${seat}-0`, def: drawTactic(`Tactic ${seat} 0`), owner: seat, zone: "hand" as const },
          { key: `t-${seat}-1`, def: drawTactic(`Tactic ${seat} 1`), owner: seat, zone: "hand" as const }
        ]),
        ...perSeat(count, { hand: 2, deck: 6 }),
        ...fund(P1)
      ]);
      assertAsksOpponent(t, playAction(t, P1, "disc"), t.seats.slice(1));
      const before = snapshot(t);
      playCard(t, P1, "disc", { players: { opponent: pick } });
      const shown = events(t, "cardsRevealed").filter((event) => event.zone === "hand");
      assert.equal(shown.length, 1);
      assert.equal(shown[0]!.ownerId, pick, "only the chosen opponent's hand is revealed");
      assert.equal(shown[0]!.viewerId, "all", "to every player");
      assert.equal(handOf(t, pick).length, before[pick]!.hand.length, "it shuffled 2 tactics away and drew 2");
      for (const key of handKeys(pick, 2)) assert.ok(handOf(t, pick).includes(t.id(key)), "its other cards stay in hand");
      assert.equal(handOf(t, P1).length, before[P1]!.hand.length - 1 + 1, "P1 drew a card (and played the tactic)");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });
}

// =================================================================================
// Epiphany Ball — SUDDEN INSIGHT / Inside Information — PROFIT / Splattergun — UNLOAD
// "... Your opponent takes control of this card."
// =================================================================================

const EPIPHANY = "5f6c7c41-3be8-44ce-9293-454a35772c0f";
const INSIDE = "ce20a6a6-4cf6-4b28-96d1-8b68c1441c10";
const SPLATTERGUN = "69c99fee-c4fd-45ff-9d04-da0cc01ecd54";

for (const count of [3, 4] as const) {
  mpClause(EPIPHANY, "0:ability:insight", count, `${count} seats: P1 searches its own deck, then only the chosen opponent takes control of the Ball`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "ball", def: printing(EPIPHANY), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 3 })]);
      assertAsksOpponent(t, activateAction(t, P1, "ball", "insight"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "ball", "insight", { players: { opponent: pick } });
      const search = openPick(t);
      assert.equal(search.playerId, P1);
      assert.deepEqual(sorted(search.candidates), sorted(idsOf(t, deckKeys(P1, 3))), "P1 searches its own deck only");
      answerPick(t, [deckKeys(P1, 3)[1]!]);
      assert.ok(handOf(t, P1).includes(t.id(deckKeys(P1, 3)[1]!)), "handOf(t, P1).includes(t.id(deckKeys(P1, 3)[1]!))");
      assert.equal(controllerOf(t, "ball"), pick, "the chosen opponent takes control");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
      assert.equal(others(count).filter((s) => controllerOf(t, "ball") === s).length, 1, "exactly one opponent controls it");
    }
  });

  mpClause(INSIDE, "0:ability:profit", count, `${count} seats: P1 draws 4, then only the chosen opponent takes control`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "ii", def: printing(INSIDE), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 6 })]);
      assertAsksOpponent(t, activateAction(t, P1, "ii", "profit"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "ii", "profit", { players: { opponent: pick } });
      assert.equal(handOf(t, P1).length, before[P1]!.hand.length + 4, "P1 drew 4 cards");
      assert.equal(controllerOf(t, "ii"), pick);
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });

  mpClause(SPLATTERGUN, "0:ability:unload", count, `${count} seats: the picked target takes 3 damage (any player's), and only the chosen opponent takes control of the Splattergun`, () => {
    for (const pick of others(count)) {
      const owner = others(count).find((s) => s !== pick)!;
      const t = table(count, [{ key: "gun", def: printing(SPLATTERGUN), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 2 })]);
      assertAsksOpponent(t, activateAction(t, P1, "gun", "unload"), t.seats.slice(1));
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      const faction = t.engine.state.players[owner]!.factionId!;
      activate(t, P1, "gun", "unload", { players: { opponent: pick }, selected: { tgt: [faction] } });
      assert.equal(infl(t, owner), before[owner]! - 3, "the picked faction took 3 damage");
      for (const seat of t.seats.filter((s) => s !== owner)) assert.equal(infl(t, seat), before[seat], `${seat}'s faction is unaffected`);
      assert.equal(controllerOf(t, "gun"), pick, "the chosen opponent (not the faction's owner) takes control");
    }
  });
}

// =================================================================================
// Misappropriation Machine — STEAL
// Deplete this card. Pick a character or item in your opponent's discard pile. -- Put the character or item into
// play under your control. Your opponent takes control of this card.
// =================================================================================

const MACHINE = "5afd2312-a6aa-4aca-bc1e-2fb4eb78183d";

for (const count of [3, 4] as const) {
  mpClause(MACHINE, "0:ability:steal", count, `${count} seats: only the chosen opponent's discard pile is offered; that opponent takes control of the Machine`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "mm", def: printing(MACHINE), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 2, discard: 2 })]);
      assertAsksOpponent(t, activateAction(t, P1, "mm", "steal"), t.seats.slice(1));
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("mm"), abilityId: "steal", players: { opponent: pick } };
      const offered = t.engine.getPickCandidates(action as never, "pick");
      const discardKeys = (seat: PlayerId): string[] => [0, 1].map((i) => `x-${seat}-${i}`);
      assert.deepEqual(sorted(offered), sorted(idsOf(t, discardKeys(pick))), "only the chosen opponent's discard pile");
      activate(t, P1, "mm", "steal", { players: { opponent: pick }, selected: { pick: [t.id(discardKeys(pick)[0]!)] } });
      assert.equal(zoneOf(t, discardKeys(pick)[0]!), "play");
      assert.equal(controllerOf(t, discardKeys(pick)[0]!), P1, "put into play under P1's control");
      assert.equal(controllerOf(t, "mm"), pick, "the chosen opponent takes control of the Machine");
    }
  });
}

// =================================================================================
// Fool's Gold — TRADE
// Pick an item your opponent controls. Pay X, where X is that card's numeric cost. Destroy this card. -- Take control
// of the item.
// =================================================================================

const GOLD = "d2ef3385-bff6-42cf-8045-e5568e59efdf";

for (const count of [3, 4] as const) {
  mpClause(GOLD, "0:ability:trade", count, `${count} seats: only items the chosen opponent controls can be picked; P1 takes control of the item`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "gold", def: printing(GOLD), owner: P1, zone: "play" },
        ...others(count).map((seat): CardPlacement => ({ key: `i-${seat}`, def: item({ name: `Item ${seat}`, cost: 2 }), owner: seat, zone: "play" })),
        ...fund(P1)
      ]);
      assertAsksOpponent(t, activateAction(t, P1, "gold", "trade"), t.seats.slice(1));
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("gold"), abilityId: "trade", players: { opponent: pick } };
      assert.deepEqual(t.engine.getPickCandidates(action as never, "pick"), [t.id(`i-${pick}`)], "only the chosen opponent's items");
      activate(t, P1, "gold", "trade", { players: { opponent: pick }, selected: { pick: [t.id(`i-${pick}`)] } });
      assert.equal(controllerOf(t, `i-${pick}`), P1);
      assert.equal(zoneOf(t, "gold"), "discard", "Fool's Gold was destroyed");
      for (const seat of others(count).filter((s) => s !== pick)) assert.equal(controllerOf(t, `i-${seat}`), seat, "other opponents keep their items");
    }
  });
}

// =================================================================================
// Forcible Depredator — PLUNDER
// Pay 2. Discard a card. Deplete this card. -- Put the top 3 cards of your opponent's deck into their discard pile.
// =================================================================================

const DEPREDATOR = "a1716f04-f2d4-454f-917f-0b55eb9fbb73";

for (const count of [3, 4] as const) {
  mpClause(DEPREDATOR, "0:ability:plunder", count, `${count} seats: the top 3 cards of only the chosen opponent's deck go to their discard pile`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "dep", def: printing(DEPREDATOR), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 2, deck: 6 })]);
      assertAsksOpponent(t, activateAction(t, P1, "dep", "plunder"), t.seats.slice(1));
      const before = snapshot(t);
      activate(t, P1, "dep", "plunder", { players: { opponent: pick }, selected: { d: [t.id("h-p1-0")] } });
      assert.deepEqual(deckOf(t, pick), before[pick]!.deck.slice(3), "the top 3 cards left the chosen opponent's deck");
      assert.deepEqual(t.engine.state.players[pick]!.discard.slice(-3).sort(), before[pick]!.deck.slice(0, 3).sort(), "into its discard pile");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });
}

// =================================================================================
// Orgy Den Smoke Out
// Your opponent must discard a card at random. Put the top 2 cards of their deck into their discard pile.
// =================================================================================

const SMOKE_OUT = "92083650-6785-4b9a-ba1c-542a348b22aa";

for (const count of [3, 4] as const) {
  mpClause(SMOKE_OUT, "0:rule", count, `${count} seats: only the chosen opponent discards at random and has 2 cards put into their discard pile`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "oso", def: printing(SMOKE_OUT), owner: P1, zone: "hand" }, ...fund(P1), ...perSeat(count, { hand: 3, deck: 5 })]);
      assertAsksOpponent(t, playAction(t, P1, "oso"), t.seats.slice(1));
      const before = snapshot(t);
      playCard(t, P1, "oso", { players: { opponent: pick } });
      assert.equal(handOf(t, pick).length, 2, "one card was discarded at random");
      assert.ok(handOf(t, pick).every((card) => before[pick]!.hand.includes(card)), "handOf(t, pick).every((card) => before[pick]!.hand.includes(card))");
      assert.deepEqual(deckOf(t, pick), before[pick]!.deck.slice(2), "the top 2 cards of the deck left it");
      assert.equal(t.engine.state.players[pick]!.discard.length, 3, "1 discarded + 2 from the deck");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });
}

// =================================================================================
// Recreant Cad — SNEAK
// Use this only if your opponent has at least 10 cards in their discard pile. Pay 1. Remove 2 cards in your opponent's
// discard pile from the game. -- This turn, this card gains COVERT.
// =================================================================================

const CAD = "bad0a682-9807-466b-8d9b-3ac48a34cdb2";

function cadTable(count: Count, discards: Record<PlayerId, number>): Table {
  return table(count, [
    { key: "cad", def: printing(CAD), owner: P1, zone: "play" },
    ...fund(P1),
    ...seatsOf(count).flatMap((seat) => (seat === P1 ? [] : fillers(`x-${seat}-`, discards[seat] ?? 0, seat, "discard")))
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(CAD, "0:ability:sneak", count, `${count} seats: the 10-card requirement and the 2 removed cards are the chosen opponent's discard pile only`, () => {
    const seats = others(count);
    const [first, second] = seats as [PlayerId, PlayerId];
    // the first opponent has 12, every other opponent has 4: only choosing the first works
    const t = cadTable(count, { [first]: 12, ...Object.fromEntries(seats.slice(1).map((s) => [s, 4])) });
    const attempt = (who: PlayerId) => t.engine.checkAction({ type: "activateAbility", playerId: P1, cardId: t.id("cad"), abilityId: "sneak", players: { opponent: who }, selected: { rfg: [t.id(`x-${who}-0`), t.id(`x-${who}-1`)] } } as never).ok;
    assert.equal(attempt(second), false, `${second} has fewer than 10 cards in its discard pile`);
    assert.equal(attempt(first), true, `${first} has 12`);
    const action = { type: "activateAbility", playerId: P1, cardId: t.id("cad"), abilityId: "sneak", players: { opponent: first } };
    assert.deepEqual(sorted(t.engine.getPickCandidates(action as never, "rfg")), sorted(idsOf(t, Array.from({ length: 12 }, (_, i) => `x-${first}-${i}`))), "only the chosen opponent's discard pile is offered");
    activate(t, P1, "cad", "sneak", { players: { opponent: first }, selected: { rfg: [t.id(`x-${first}-0`), t.id(`x-${first}-1`)] } });
    assert.equal(zoneOf(t, `x-${first}-0`), "removed");
    assert.equal(zoneOf(t, `x-${first}-1`), "removed");
    assert.equal(zoneOf(t, `x-${second}-0`), "discard", "the other opponent's pile is untouched");
    assert.ok(t.engine.hasKeyword(t.id("cad"), "covert"), "the Cad gains COVERT this turn");
    // nobody has 10: it cannot be used for any choice
    const none = cadTable(count, Object.fromEntries(seats.map((s) => [s, 9])));
    for (const who of seats) {
      assert.equal(none.engine.checkAction({ type: "activateAbility", playerId: P1, cardId: none.id("cad"), abilityId: "sneak", players: { opponent: who }, selected: { rfg: [none.id(`x-${who}-0`), none.id(`x-${who}-1`)] } } as never).ok, false);
    }
    // two opponents have 10+: choosing the second removes cards from the second's pile only
    const both = cadTable(count, { [first]: 12, [second]: 10 });
    activate(both, P1, "cad", "sneak", { players: { opponent: second }, selected: { rfg: [both.id(`x-${second}-3`), both.id(`x-${second}-4`)] } });
    assert.equal(zoneOf(both, `x-${second}-3`), "removed");
    assert.equal(zoneOf(both, `x-${first}-3`), "discard");
  });
}

// =================================================================================
// Blow Up
// Pick an item. -- Destroy the item. Your opponent's faction loses 3 influence.
// =================================================================================

const BLOW_UP = "efa9c2c1-5448-4733-a6c4-471f7d625c02";

for (const count of [3, 4] as const) {
  mpClause(BLOW_UP, "0:ability", count, `${count} seats: any item may be picked; only the chosen opponent's faction loses 3 influence`, () => {
    for (const pick of others(count)) {
      const owner = others(count).find((s) => s !== pick)!;
      const t = table(count, [
        { key: "bu", def: printing(BLOW_UP), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "Doomed" }), owner, zone: "play" },
        ...fund(P1)
      ]);
      assertAsksOpponent(t, playAction(t, P1, "bu"), t.seats.slice(1));
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      playCard(t, P1, "bu", { players: { opponent: pick }, selected: { it: [t.id("it")] } });
      assert.equal(zoneOf(t, "it"), "discard");
      assert.equal(infl(t, pick), before[pick]! - 3, "the chosen opponent's faction lost 3");
      for (const seat of t.seats.filter((s) => s !== pick)) assert.equal(infl(t, seat), before[seat], `${seat}'s faction is unaffected (even the item's owner)`);
    }
  });
}

// =================================================================================
// Murderous Commander — CUNNING PLAN
// Pay 2. Discard a card. Deplete this card. -- Inflict 2 damage to your opponent's faction.
// =================================================================================

const COMMANDER = "84515285-34dc-4b75-95d4-51a6c072b970";

for (const count of [3, 4] as const) {
  mpClause(COMMANDER, "0:ability:plan", count, `${count} seats: 2 damage to only the chosen opponent's faction`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "cmd", def: printing(COMMANDER), owner: P1, zone: "play" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 1 })]);
      assertAsksOpponent(t, activateAction(t, P1, "cmd", "plan"), t.seats.slice(1));
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      activate(t, P1, "cmd", "plan", { players: { opponent: pick }, selected: { d: [t.id("h-p1-0")] } });
      assert.equal(infl(t, pick), before[pick]! - 2);
      for (const seat of t.seats.filter((s) => s !== pick)) assert.equal(infl(t, seat), before[seat], `${seat} is unaffected`);
    }
  });
}
