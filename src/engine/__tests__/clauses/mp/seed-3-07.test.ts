// Multiplayer clause tests for Seed 3, part 7 (Community Chest). Every test is a real 3- or 4-seat game with the real
// printing, driven through `perform`.

import assert from "node:assert/strict";
import { character } from "../../support/fixtures.js";
import { mpClause, printing } from "../_clause.js";
import { endTurn } from "../_turn.js";
import { answer, cardsOf, deckOf, expectChoice, handOf, othersOf, P1, P2, P3, P4, pending, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";

const CHEST = "fe7095e0-d918-420c-9303-fbc5054d2564"; // At the start of each player's turn, both players may draw a card or play a resource. -- If you control at least [D] and choose to put this card on the bottom of your deck as part of your mulligan at the start of a game, you may reveal it. If you do, draw a card at the start of your turn.

const decks = (count: number): CardPlacement[] => seatsOf(count).flatMap((seat) => cardsOf(`d-${seat}-`, 4, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` })));

/** Runs the pair's prompts (a may-pay, then the draw option) and returns the order of the players who were asked. */
function runPair(t: Table, take: (seat: PlayerId) => boolean = () => true): PlayerId[] {
  const asked: PlayerId[] = [];
  for (let guard = 0; guard < 12 && pending(t); guard++) {
    const pc = pending(t)!;
    asked.push(pc.playerId);
    if (pc.kind === "mayPay") answer(t, pc.playerId, { kind: "mayPay", pay: take(pc.playerId) });
    else if (pc.kind === "chooserSelectsOption") answer(t, pc.playerId, { kind: "chooserSelectsOption", index: 0 });
    else throw new Error(`unexpected prompt ${pc.kind}`);
  }
  return asked;
}

const chestTable = (count: number, active: PlayerId): Table =>
  table(count, [{ key: "chest", def: printing(CHEST), owner: P1 }, ...decks(count)], { active });

for (const count of [3, 4] as const) {
  mpClause(CHEST, "1:rule", count, `${count} seats: at the start of an opponent's turn the controller chooses one opponent, and only the controller and that opponent may draw or play a resource, in turn order from the active player`, () => {
    const t = chestTable(count, P1);
    const chosen = count === 3 ? P3 : P4;
    endTurn(t.engine, P1); // P2's turn starts
    const choice = expectChoice(t, "choosePlayer", P1);
    assert.deepEqual(choice.candidates, othersOf(count), "one selection among every opponent");
    const before = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
    answer(t, P1, { kind: "choosePlayer", playerId: chosen });
    const asked = runPair(t);
    // Order: active player P2 first, then clockwise: the chosen opponent comes before the controller.
    assert.deepEqual([...new Set(asked)], [chosen, P1], "only the pair is asked, the chosen opponent first (clockwise from P2)");
    assert.equal(handOf(t, chosen).length, before[chosen]! + 1);
    assert.equal(handOf(t, P1).length, before[P1]! + 1);
    for (const other of t.seats.filter((seat) => seat !== chosen && seat !== P1)) assert.equal(handOf(t, other).length, before[other], `${other} gets nothing`);
  });

  mpClause(CHEST, "1:rule", count, `${count} seats: at the start of each turn, including the controller's own and each other opponent's, the controller chooses an opponent again (one selection per resolution)`, () => {
    // P3 (or P4) ends a turn, the controller's own turn starts.
    const last = seatsOf(count)[count - 1]!;
    const t = chestTable(count, last);
    endTurn(t.engine, last);
    const choice = expectChoice(t, "choosePlayer", P1);
    assert.deepEqual(choice.candidates, othersOf(count));
    answer(t, P1, { kind: "choosePlayer", playerId: P2 });
    const asked = runPair(t);
    assert.deepEqual([...new Set(asked)], [P1, P2], "on the controller's own turn the pair acts controller first, then P2");
    // The next turn start (P2's) asks again.
    endTurn(t.engine, P1);
    expectChoice(t, "choosePlayer", P1);
  });
}

mpClause(CHEST, "1:rule", 3, "3 seats: a declined or taken option only affects that player; the unchosen opponent never draws", () => {
  const t = chestTable(3, P1);
  endTurn(t.engine, P1);
  answer(t, P1, { kind: "choosePlayer", playerId: P3 });
  const before = [handOf(t, P1).length, handOf(t, P2).length, handOf(t, P3).length];
  runPair(t, (seat) => seat !== P3);
  assert.deepEqual([handOf(t, P1).length, handOf(t, P2).length, handOf(t, P3).length], [before[0]! + 1, before[1], before[2]], "P3 declined, P1 drew, P2 (active but not chosen) did nothing");
});

mpClause(CHEST, "2:rule", 3, "3 seats: with the mulligan reveal made, only the controller draws an extra card at the start of the controller's own turn", () => {
  const seats = seatsOf(3);
  const t = table(3, [
    { key: "chest", def: printing(CHEST), owner: P1, zone: "deck", counters: { revealed: 1 } },
    ...staples("deception", 1),
    ...decks(3)
  ]);
  // The opening mulligan put the card on the bottom of P1's deck.
  t.engine.state.mulligan[P1] = [t.id("chest")];
  t.engine.state.players[P1]!.deck = [...t.engine.state.players[P1]!.deck.filter((id) => id !== t.id("chest")), t.id("chest")];
  const drawn = (seat: PlayerId) => handOf(t, seat).length;
  const start = Object.fromEntries(seats.map((seat) => [seat, drawn(seat)]));
  endTurn(t.engine, P1); // P2's turn starts
  settle(t);
  assert.equal(drawn(P1), start[P1], "P2's turn start gives P1 no extra draw");
  endTurn(t.engine, P2); // P3's turn starts
  assert.equal(drawn(P1), start[P1], "P3's turn start gives P1 no extra draw");
  endTurn(t.engine, P3); // P1's turn starts
  assert.equal(pending(t), undefined);
  assert.equal(drawn(P1), start[P1]! + 1, "P1's own turn start draws a card");
  assert.equal(drawn(P2), start[P2]);
  assert.equal(drawn(P3), start[P3]);
  void P4;
});
