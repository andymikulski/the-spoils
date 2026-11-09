// Multiplayer clause tests for Seed 3, part 3 (Spatchcocking). Every test is a real 3- or 4-seat game with the real
// printing, driven through `perform`.

import assert from "node:assert/strict";
import { character, item, location, resourceCard, tactic } from "../../support/fixtures.js";
import { clause, printing } from "../_clause.js";
import { answer, expectChoice, handOf, offered, othersOf, P1, pending, pickTargets, seatsOf, settle, staples, table, zoneOf } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";

const SPATCH = "d23a3fbd-0bf3-4937-9b29-570c55a418b8"; // Each player chooses a card of each non-resource type they control. Put all remaining non-resource cards into their owner's hand. -- RECUR: [O][O][O][O] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game. -- EFFECT: Each opponent reveals their hand, chooses a card of each non-resource type in it, and discards the remaining non-resource cards.

/** Two characters, two items, two locations and a resource in play for `seat`. */
const board = (seat: PlayerId): CardPlacement[] => [
  ...[0, 1].map((i) => ({ key: `c${i}-${seat}`, def: character({ name: `Char ${seat} ${i}` }), owner: seat })),
  ...[0, 1].map((i) => ({ key: `i${i}-${seat}`, def: item({ name: `Item ${seat} ${i}` }), owner: seat })),
  ...[0, 1].map((i) => ({ key: `l${i}-${seat}`, def: location({ name: `Place ${seat} ${i}` }), owner: seat })),
  { key: `r-${seat}`, def: resourceCard({ name: `Res ${seat}` }), owner: seat }
];

/** Answers every `chooserSelectsTarget` with the first card offered, recording whose choice it was. */
function drive(t: Table): PlayerId[] {
  const order: PlayerId[] = [];
  for (let guard = 0; guard < 60 && pending(t); guard++) {
    const pc = pending(t)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    order.push(pc.playerId);
    pickTargets(t, pc.playerId, [offered(t)[0]!]);
  }
  return order;
}
const firstOfEach = (order: PlayerId[]): PlayerId[] => order.filter((seat, index) => index === 0 || seat !== order[index - 1]);

// The card is played by P1 while `active` has the turn: `active` plays a bait tactic first so P1 can respond.
function playSpatchcocking(t: Table, active: PlayerId): void {
  if (active === P1) {
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("spatch") });
    settle(t);
    return;
  }
  t.engine.perform({ type: "playCard", playerId: active, cardId: t.id("bait") });
  while (t.engine.state.responseWindow?.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("spatch") });
  settle(t);
}

for (const [count, active] of [[3, P1], [3, "p2"], [4, P1], [4, "p3"]] as const) {
  clause(SPATCH, "0:rule", `${count} seats, ${active} active: every player (the controller and each opponent) chooses one card of each non-resource type they control, active player first and then clockwise; the rest go to their owners' hands and resources stay`, () => {
    const seats = seatsOf(count);
    const t = table(
      count,
      [
        { key: "spatch", def: printing(SPATCH), owner: P1, zone: "hand" },
        ...staples("obsession", 4),
        { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: active, zone: "hand" },
        ...seats.flatMap(board)
      ],
      { active }
    );
    playSpatchcocking(t, active);
    const start = seats.indexOf(active);
    const expected = [...seats.slice(start), ...seats.slice(0, start)];
    const order = drive(t);
    assert.deepEqual(firstOfEach(order), expected, "choices go active player first, then clockwise");
    for (const seat of seats) {
      assert.equal(order.filter((who) => who === seat).length > 0, true, `${seat} chose`);
      assert.equal(zoneOf(t, `c0-${seat}`), "play", `${seat}'s chosen character stays`);
      assert.equal(zoneOf(t, `c1-${seat}`), "hand", `${seat}'s other character goes to its owner's hand`);
      assert.equal(zoneOf(t, `i0-${seat}`), "play");
      assert.equal(zoneOf(t, `i1-${seat}`), "hand");
      assert.equal(zoneOf(t, `l0-${seat}`), "play");
      assert.equal(zoneOf(t, `l1-${seat}`), "hand");
      assert.equal(zoneOf(t, `r-${seat}`), "play", `${seat}'s resource is not a non-resource card`);
    }
  });
}

// --- RECUR ----------------------------------------------------------------------------

/** P1 has Spatchcocking in the discard pile; each opponent holds two of each non-resource type and a resource. */
function recurTable(count: number, active: PlayerId): Table {
  const hand = (seat: PlayerId): CardPlacement[] => [
    ...[0, 1].map((i) => ({ key: `c${i}-${seat}`, def: character({ name: `Char ${seat} ${i}` }), owner: seat, zone: "hand" as const })),
    ...[0, 1].map((i) => ({ key: `i${i}-${seat}`, def: item({ name: `Item ${seat} ${i}` }), owner: seat, zone: "hand" as const })),
    ...[0, 1].map((i) => ({ key: `l${i}-${seat}`, def: location({ name: `Place ${seat} ${i}` }), owner: seat, zone: "hand" as const })),
    ...[0, 1].map((i) => ({ key: `t${i}-${seat}`, def: tactic({ name: `Trick ${seat} ${i}`, cost: 0 }), owner: seat, zone: "hand" as const })),
    { key: `r-${seat}`, def: resourceCard({ name: `Res ${seat}` }), owner: seat, zone: "hand" }
  ];
  return table(
    count,
    [
      { key: "spatch", def: printing(SPATCH), owner: P1, zone: "discard" },
      { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: active, zone: "hand" },
      ...staples("obsession", 4),
      ...othersOf(count).flatMap(hand)
    ],
    { active }
  );
}

function useRecur(t: Table, active: PlayerId): void {
  const action = { type: "activateAbility", playerId: P1, cardId: t.id("spatch"), abilityId: "spatchcocking-recur" } as const;
  if (active !== P1) {
    t.engine.perform({ type: "playCard", playerId: active, cardId: t.id("bait") });
    while (t.engine.state.responseWindow?.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  }
  assert.deepEqual(t.engine.getPlayRequirements(action), [], "no opponent is asked for: every opponent does it");
  t.engine.perform(action);
  settle(t);
}

for (const [count, active] of [[3, P1], [3, "p3"], [4, P1], [4, "p4"]] as const) {
  clause(SPATCH, "1:ability:spatchcocking-recur", `${count} seats, ${active} active: every opponent (not just one) reveals their hand, chooses a card of each non-resource type in it and discards the rest, active player first then clockwise skipping the controller; resources stay; the controller's hand is untouched`, () => {
    const t = recurTable(count, active);
    useRecur(t, active);
    const opponents = othersOf(count);
    const seats = seatsOf(count);
    const start = seats.indexOf(active);
    const expected = [...seats.slice(start), ...seats.slice(0, start)].filter((seat) => seat !== P1);
    const order = drive(t);
    assert.deepEqual(firstOfEach(order), expected, "each opponent chooses in turn order, the controller is skipped");
    for (const seat of opponents) {
      assert.equal(zoneOf(t, `c0-${seat}`), "hand", `${seat} keeps the chosen character`);
      assert.equal(zoneOf(t, `c1-${seat}`), "discard", `${seat} discards the other character`);
      assert.equal(zoneOf(t, `i1-${seat}`), "discard");
      assert.equal(zoneOf(t, `l1-${seat}`), "discard");
      assert.equal(zoneOf(t, `t1-${seat}`), "discard");
      assert.equal(zoneOf(t, `r-${seat}`), "hand", `${seat}'s resource is not a non-resource card`);
    }
    assert.equal(zoneOf(t, "spatch"), "removed", "removed from the game as a cost");
    assert.equal(handOf(t, P1).length, active === P1 ? 1 : 0, "the controller's hand is untouched (only the bait is in it)");
    void expectChoice;
    void answer;
  });
}
