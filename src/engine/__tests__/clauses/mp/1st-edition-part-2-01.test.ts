// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 1: the clauses whose data changed.
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/1st-edition-part-2.json.

import assert from "node:assert/strict";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import {
  activate,
  activateAction,
  answerPending,
  answerPick,
  assertAsksOpponent,
  character,
  choosePlayer,
  deckOf,
  fillers,
  finisher,
  fund,
  handOf,
  openPick,
  pass,
  orderStart,
  killTactic,
  open,
  othersOf,
  P1,
  P2,
  P3,
  P4,
  perSeat,
  pickableBy,
  playAction,
  playCard,
  resolvePendingResponses,
  seatsOf,
  table,
  zoneOf,
  type CardPlacement,
  type Count,
  type PlayerId,
  type Table
} from "./_support1stEditionPart2.js";

/** A character of P2's with an ability ("zap": its controller draws a card), used to put an ability on the stack. */
const zapper = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "zap", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

const rw = (t: Table) => t.engine.state.responseWindow;

/**
 * P2 (the active player) uses a character's ability; P3 (4 seats: P3 and P4) passes; P1 then plays `key` (a card whose
 * text says "Your opponent cannot respond to this card") naming `pick` as its opponent. The named opponent is never
 * offered the window and cannot respond; every other opponent is offered it, and the card resolves only after they pass.
 */
function noResponseRun(count: Count, key: string, pick: PlayerId): Table {
  const t = table(
    count,
    [
      { key, def: printing(key === "sub" ? SUB5 : PUPPET), owner: P1, zone: "hand" },
      { key: "foe", def: zapper("Foe Zapper"), owner: P2, zone: "play" },
      { key: "foe2", def: zapper("Second Zapper"), owner: P2, zone: "play" },
      ...fund(P1),
      ...perSeat(count, { hand: 2, deck: 4 })
    ],
    P2
  );
  t.engine.perform(activateAction(t, P2, "foe", "zap") as never);
  // the ability is on the stack and open to every other player, clockwise from P2's left; P1 waits for its turn to respond
  while (rw(t)?.phase === "acceptingResponses" && rw(t)!.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: rw(t)!.priorityPlayerId } as never);
  assert.equal(rw(t)?.priorityPlayerId, P1, "P1 has priority to respond to the ability");
  // the opponent is chosen with the action, before anything else, from every other player
  assertAsksOpponent(t, playAction(t, P1, key), t.seats.slice(1));
  t.engine.perform(playAction(t, P1, key, { players: { opponent: pick } }) as never);
  return t;
}

function noResponseScenario(count: Count, key: string, check: (t: Table, pick: PlayerId) => void): void {
  for (const pick of seatsOf(count).slice(1)) {
    const t = noResponseRun(count, key, pick);
    const stackTop = t.engine.state.responseStack[t.engine.state.responseStack.length - 1]!;
    assert.equal(stackTop.sourceId, t.id(key), "the card is on top of the stack");
    // The chosen opponent is skipped: the first player offered the window is the next seat that is not the chosen opponent.
    const others = othersOf(t, P1).filter((seat) => seat !== pick);
    assert.equal(rw(t)?.phase, "acceptingResponses");
    assert.equal(rw(t)?.priorityPlayerId, others[0], "the first opponent who may respond is offered the window");
    refused(() => t.engine.perform({ type: "passPriority", playerId: pick } as never), `${pick}, the chosen opponent, cannot act on the card`, /priority/i);
    // every other opponent in turn is offered the window; the card does not resolve until all have passed
    for (const seat of others) {
      assert.equal(rw(t)?.priorityPlayerId, seat, `${seat} is offered the window`);
      assert.ok(t.engine.state.responseStack.some((item) => item.sourceId === t.id(key)), "the card waits while an opponent may still respond");
      t.engine.perform({ type: "passPriority", playerId: seat } as never);
    }
    resolvePendingResponses(t.engine);
    assert.equal(zoneOf(t, key), "discard", "the card has resolved");
    check(t, pick);
  }
}

// =================================================================================
// Subsection 5, Paragraph 12
// Your opponent cannot respond to this card.
// Play this only in response to an ability that's source was not a faction. -- The ability has no effect and cannot be
// used again this turn. Draw a card.
// =================================================================================

const SUB5 = "8fbf09c1-9f8e-4c2e-8695-fd6f95a4fa8a";

for (const count of [3, 4] as const) {
  clauseMismatch(SUB5, "0:rule", "MP-1st-edition-part-2-2", `${count} seats: the chosen opponent cannot respond, every other opponent can, and the card resolves only after they pass`, () => {
    noResponseScenario(count, "sub", (t) => {
      assert.equal(handOf(t, P2).length, 2, "the terminated ability drew nothing for its controller");
      assert.equal(handOf(t, P1).length, 3, "P1 drew a card from the card itself");
      // "cannot be used again this turn"
      refused(() => t.engine.perform(activateAction(t, P2, "foe", "zap") as never), "the terminated ability is locked for the turn");
    });
  });
}

// =================================================================================
// Exploding Sock Puppet!
// Your opponent cannot respond to this card.
// Play this only in response to a character's ability. -- The ability has no effect. Destroy the character.
// =================================================================================

const PUPPET = "ab111049-6ba1-430e-8d27-f647bcd5ac35";

for (const count of [3, 4] as const) {
  clauseMismatch(PUPPET, "0:rule", "MP-1st-edition-part-2-2", `${count} seats: the chosen opponent cannot respond, every other opponent can, and the character is destroyed`, () => {
    noResponseScenario(count, "pup", (t) => {
      assert.equal(zoneOf(t, "foe"), "discard", "the character whose ability it was is destroyed");
      assert.equal(zoneOf(t, "foe2"), "play", "no other character is destroyed");
      assert.equal(handOf(t, P2).length, 2, "the ability had no effect");
    });
  });
}

// =================================================================================
// Martial Artist / Martial Arts Trainee
// Your opponent cannot pick this card.
// =================================================================================

const MARTIAL_ARTIST = "b2ceefd9-cf5e-459b-adba-6c0f3a806c58";
const TRAINEE = "3142de68-bfda-45ce-b3a6-c1b085f51664";

/** Who of the seats still in the game may pick `ma` with their own kill tactic, right now. */
const pickersOf = (t: Table): PlayerId[] =>
  t.seats.filter((seat) => !t.engine.state.players[seat]!.eliminated && pickableBy(t, seat, `kill-${seat}`, "t", ["ma"]).length > 0);

function elusiveRun(count: Count, printingId: string, pick: PlayerId): void {
  const t = table(count, [
    { key: "ma", def: printing(printingId), owner: P1, zone: "hand" },
    ...seatsOf(count).map((seat): CardPlacement => ({ key: `kill-${seat}`, def: killTactic({ name: `Kill ${seat}` }), owner: seat, zone: "hand" })),
    { key: "fin", def: finisher(pick), owner: P1, zone: "hand" },
    ...fund(P1),
    ...perSeat(count, { hand: 1, deck: 3 })
  ]);
  playCard(t, P1, "ma");
  assert.equal(open(t)?.kind, "choosePlayer", "the controller selects an opponent when the effect starts applying");
  choosePlayer(t, P1, t.seats.slice(1), pick);
  assert.equal(open(t), undefined);
  // only the selected opponent cannot pick it: the controller and every other opponent can
  assert.deepEqual(pickersOf(t), t.seats.filter((seat) => seat !== pick), `every seat but ${pick} may pick it`);
  // the selection lasts: nothing else changes it
  assert.equal(zoneOf(t, "ma"), "play");
  // the selected opponent is eliminated: the controller selects again, from the players left
  playCard(t, P1, "fin");
  assert.ok(t.engine.state.players[pick]!.eliminated, "the selected opponent has lost");
  const left = t.seats.filter((seat) => seat !== P1 && seat !== pick);
  let again: PlayerId = left[0]!;
  if (left.length > 1) {
    assert.equal(open(t)?.kind, "choosePlayer");
    choosePlayer(t, P1, left, left[left.length - 1]!);
    again = left[left.length - 1]!;
  } else assert.equal(open(t), undefined, "one opponent left: no choice is offered");
  assert.deepEqual(pickersOf(t), t.seats.filter((seat) => seat !== pick && seat !== again), "the new selection cannot pick it; the other living players can");
  // a real action: the new selection's pick is refused, nothing else is changed
  const active = t.seats.find((seat) => seat !== P1 && !t.engine.state.players[seat]!.eliminated)!;
  t.engine.perform({ type: "endTurn", playerId: P1 } as never);
  resolvePendingResponses(t.engine);
  assert.equal(t.engine.state.activePlayerId, active);
  if (active === again) refused(() => t.engine.perform({ type: "playCard", playerId: active, cardId: t.id(`kill-${active}`), selected: { t: [t.id("ma")] } } as never), "the selected opponent cannot pick it");
  else {
    t.engine.perform({ type: "playCard", playerId: active, cardId: t.id(`kill-${active}`), selected: { t: [t.id("ma")] } } as never);
    resolvePendingResponses(t.engine);
    assert.equal(zoneOf(t, "ma"), "discard", "another opponent can pick it");
  }
}

for (const count of [3, 4] as const) {
  clause(MARTIAL_ARTIST, "0:rule", `${count} seats: only the opponent selected as the effect starts applying cannot pick it; the selection is made again when that player is eliminated`, () => {
    for (const pick of seatsOf(count).slice(1)) elusiveRun(count, MARTIAL_ARTIST, pick);
  });
  clause(TRAINEE, "0:rule", `${count} seats: only the opponent selected as the effect starts applying cannot pick it; the selection is made again when that player is eliminated`, () => {
    for (const pick of seatsOf(count).slice(1)) elusiveRun(count, TRAINEE, pick);
  });
}

// =================================================================================
// Ambiguity Embiggener
// At the start of each player's turn, that player picks a number for X. Both players put X cards from their hand on the
// bottom of their deck in any order. (If a player has less than X cards they put their entire hand on the bottom.)
// Both players put the top Y cards of their deck into their hand, where Y is the number of cards that player put on the
// bottom of their deck.
//
// Implements the spec's test3 / test4 literally: "both players" is the controller and the opponent the controller
// selects when the trigger resolves (MP 3), while the player whose turn it starts picks X.
// =================================================================================

const EMBIGGENER = "88ddad6c-4df5-4baa-b1b8-c7492f67d42e";

/**
 * P1 controls the Embiggener; the turn passes to `turnOf` and its start trigger resolves. P1 selects `pick`, `turnOf`
 * picks X = `x`, and the pair (P1 and `pick`) each put X cards on the bottom and draw as many.
 */
function embiggenerTurn(t: Table, previous: PlayerId, turnOf: PlayerId, pick: PlayerId, x: number, handSizes: Record<PlayerId, number>): void {
  const deckBefore = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
  const handBefore = Object.fromEntries(t.seats.map((seat) => [seat, [...handOf(t, seat)]]));
  pass(t, previous);
  assert.equal(t.engine.state.activePlayerId, turnOf);
  orderStart(t, "emb");
  // P1 (the Embiggener's controller) selects the opponent that "both players" pairs it with, from every opponent
  choosePlayer(t, P1, t.seats.slice(1), pick);
  // the player whose turn it is picks X
  assert.equal(open(t)?.kind, "chooseNumber");
  assert.equal(open(t)?.playerId, turnOf, "the player whose turn it is picks the number");
  answerPending(t.engine, "chooseNumber", { value: x });
  // the pair acts in turn order starting from the active player, so seats outside the pair are skipped
  const order = t.seats.slice(t.seats.indexOf(turnOf)).concat(t.seats.slice(0, t.seats.indexOf(turnOf))).filter((seat) => seat === P1 || seat === pick);
  const put: Record<PlayerId, string[]> = {};
  for (const seat of order) {
    const n = Math.min(x, handSizes[seat]!);
    const chosen = [...handOf(t, seat)].slice(0, n);
    if (n > 0) {
      const pick = openPick(t);
      assert.equal(pick.playerId, seat, "each of the two picks its own cards");
      assert.deepEqual([...pick.candidates].sort(), [...handOf(t, seat)].sort(), "only the picker's own hand is offered");
      answerPending(t.engine, "chooserSelectsTarget", { selected: chosen });
    }
    put[seat] = chosen;
  }
  assert.equal(open(t), undefined, "nobody else is asked anything");
  for (const seat of t.seats) {
    if (!order.includes(seat)) {
      assert.deepEqual(handOf(t, seat), handBefore[seat], `${seat} is not one of the two players: hand untouched`);
      assert.deepEqual(deckOf(t, seat), deckBefore[seat], `${seat} is not one of the two players: deck untouched`);
      continue;
    }
    const y = put[seat]!.length;
    assert.equal(handOf(t, seat).length, handBefore[seat]!.length, `${seat} put ${y} cards on the bottom and drew ${y}`);
    // the cards put on the bottom are the bottom of the deck; the top Y cards of the deck before went to the hand
    assert.deepEqual(deckOf(t, seat).slice(deckOf(t, seat).length - y).sort(), [...put[seat]!].sort(), `${seat} put its own cards on the bottom of its own deck`);
    for (const card of deckBefore[seat]!.slice(0, y)) assert.ok(handOf(t, seat).includes(card), `${seat} drew the top ${y} cards of its own deck`);
  }
}

function embiggenerTable(count: Count, active: PlayerId, hands: Record<PlayerId, number> = {}): Table {
  return table(
    count,
    [
      { key: "emb", def: printing(EMBIGGENER), owner: P1, zone: "play" },
      ...seatsOf(count).flatMap((seat) => [...fillers(`h-${seat}-`, hands[seat] ?? 3, seat, "hand"), ...fillers(`d-${seat}-`, 5, seat, "deck")])
    ],
    active
  );
}

clauseMismatch(EMBIGGENER, "0:rule", "MP-1st-edition-part-2-1", "3 seats: both players are P1 and the opponent P1 selects; the player whose turn it is picks X and may be neither of them", () => {
  const sizes = { [P1]: 3, [P2]: 1, [P3]: 3 };
  // the start of P3's turn: P1 selects P2; P3 (not in the pair) picks X = 2; P2 holds only 1 card, so puts that one and draws 1
  embiggenerTurn(embiggenerTable(3, P2, { [P2]: 1 }), P2, P3, P2, 2, sizes);
  // the start of P1's turn: P1 picks X and selects P3; P2 is untouched
  const t = embiggenerTable(3, P3);
  embiggenerTurn(t, P3, P1, P3, 1, { [P1]: 3, [P2]: 3, [P3]: 3 });
  // the start of P2's turn: P1 selects P3, P2 picks X; P1 and P3 act (P3 first, going clockwise from P2), P2 does not
  embiggenerTurn(t, P1, P2, P3, 2, { [P1]: 3, [P2]: 3, [P3]: 3 });
});

clauseMismatch(EMBIGGENER, "0:rule", "MP-1st-edition-part-2-1", "4 seats: the pair acts active-player-first then clockwise, and the two other seats are untouched", () => {
  const sizes = { [P1]: 3, [P2]: 3, [P3]: 3, [P4]: 3 };
  // the start of P4's turn: P1 selects P3 (offered P2, P3, P4); P4 picks X = 1; the pair acts P1 then P3
  embiggenerTurn(embiggenerTable(4, P3), P3, P4, P3, 1, sizes);
  // the start of P2's turn: P1 selects P4; P2 picks X; the pair acts P4 then P1 (clockwise from P2); P3 untouched
  embiggenerTurn(embiggenerTable(4, P1), P1, P2, P4, 2, sizes);
});
