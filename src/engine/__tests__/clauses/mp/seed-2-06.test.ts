// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 06: turn-based text of the controller or "each opponent's
// turn" (Braggadocian Aide, Prophetic Assistant, The Poshernacle) and the PROVIDES clauses. Expectations come from the
// printed text of each clause (data/card-tests/mp-spec/seed-2.json); engine data only drives the engine.

import assert from "node:assert/strict";
import { mpClause, printing, refused } from "../_clause.js";
import {
  answerPick, deckOf, endTurn, item, handSize, hands, idsOf, influenceOf, others, P1, pending, perSeat, pickable, resourceCard, resources, seatsFor, settle, table, tactic, zoneOf
} from "./_seed-2.js";
import type { CardPlacement, Table } from "./_seed-2.js";
import { character } from "./_seed-2.js";

const BRAGGADOCIAN = "0c2563df-d5fa-4444-a48e-9506e158f5b8";
const PROPHETIC = "a9d9be90-b1ba-4cea-9abb-1b570317441d";
const POSHERNACLE = "ad08166f-f1cd-4ce8-b6d7-239f48d83d00";
const RESISTANCE_FIGHTER = "54acfe5d-ccfe-4f8e-b324-65b65e6d927f";

const COUNTS = [3, 4] as const;

/** Answers `orderTriggers` prompts (first trigger first) until another prompt or none is open. */
function orderAll(t: Table): void {
  for (let guard = 0; pending(t)?.kind === "orderTriggers" && guard < 8; guard++) {
    t.engine.perform({ type: "resolvePendingChoice", playerId: pending(t)!.playerId, choice: { kind: "orderTriggers", next: (pending(t)!.triggers as never[])[0] } });
    settle(t);
  }
}

// =====================================================================================
// Braggadocian Aide
// =====================================================================================

/** A threshold-[icon] tactic for every seat, free to play (it needs the icon only). */
const gated = (icon: string, seat: string) => tactic({ name: `Gated ${seat}`, cost: 0, threshold: icon });

/** `aide` (provides the icon) in P1's play; every seat holds a free card that needs that icon. The active player is `active`. */
function providesBoard(count: number, aideId: string, icon: string, active: string) {
  return table(
    count,
    [{ key: "aide", def: printing(aideId), owner: P1, zone: "play" }, ...perSeat(count, "gate", "hand", (seat) => gated(icon, seat))],
    { active }
  );
}

for (const count of COUNTS) {
  mpClause(BRAGGADOCIAN, "0:provides", count, `${count} seats: PROVIDES: [E] works for its controller and for nobody else`, () => {
    const mine = providesBoard(count, BRAGGADOCIAN, "e", P1);
    mine.engine.perform({ type: "playCard", playerId: P1, cardId: mine.id("gate-p1") } as never);
    settle(mine);
    assert.notEqual(zoneOf(mine, "gate-p1"), "hand", "I can meet [E]");
    for (const other of others(count, P1)) {
      const t = providesBoard(count, BRAGGADOCIAN, "e", other);
      refused(() => t.engine.perform({ type: "playCard", playerId: other, cardId: t.id(`gate-${other}`) } as never), `${other} cannot meet [E]`);
      assert.equal(zoneOf(t, `gate-${other}`), "hand");
    }
  });

  mpClause(RESISTANCE_FIGHTER, "0:provides", count, `${count} seats: PROVIDES: [D] works for its controller and for nobody else`, () => {
    const mine = providesBoard(count, RESISTANCE_FIGHTER, "d", P1);
    mine.engine.perform({ type: "playCard", playerId: P1, cardId: mine.id("gate-p1") } as never);
    settle(mine);
    assert.notEqual(zoneOf(mine, "gate-p1"), "hand", "I can meet [D]");
    for (const other of others(count, P1)) {
      const t = providesBoard(count, RESISTANCE_FIGHTER, "d", other);
      refused(() => t.engine.perform({ type: "playCard", playerId: other, cardId: t.id(`gate-${other}`) } as never), `${other} cannot meet [D]`);
      assert.equal(zoneOf(t, `gate-${other}`), "hand");
    }
  });
}

/** Aide in P1's play, three resources attached to P1's faction and one attached to each opponent's. */
function aideBoard(count: number) {
  const attached = (key: string, owner: string, faction: string): CardPlacement => ({ key, def: resourceCard({ name: key }), owner, zone: "play", attachedToKey: faction });
  return table(count, [
    { key: "aide", def: printing(BRAGGADOCIAN), owner: P1, zone: "play" },
    attached("a1", P1, "__factionA"),
    attached("a2", P1, "__factionA"),
    attached("a3", P1, "__factionA"),
    attached("x-p2", "p2", "__factionB"),
    ...(count > 2 ? [attached("x-p3", "p3", "__faction_p3")] : []),
    ...(count > 3 ? [attached("x-p4", "p4", "__faction_p4")] : [])
  ]);
}

for (const count of COUNTS) {
  mpClause(BRAGGADOCIAN, "1:rule", count, `${count} seats: "At the start of your opponent's turn": at the start of every opponent's turn I may detach a resource from my faction, never at the start of my own turn`, () => {
    const t = aideBoard(count);
    const mineAttached = ["a1", "a2", "a3"];
    let detached = 0;
    for (const seat of others(count, P1)) {
      // The previous player ends their turn and `seat`'s turn starts.
      const ender = t.engine.state.activePlayerId;
      endTurn(t, ender);
      orderAll(t);
      assert.equal(t.engine.state.activePlayerId, seat);
      assert.equal(pending(t)?.playerId, P1, `at the start of ${seat}'s turn I am offered the pick, nobody else is`);
      assert.deepEqual(pickable(t), idsOf(t, mineAttached.filter((key) => t.engine.state.cards[t.id(key)]!.attachedTo !== undefined)), "only resources attached to my own faction");
      answerPick(t, P1, [t.id(mineAttached[detached]!)]);
      settle(t);
      detached++;
      assert.equal(t.engine.state.cards[t.id(mineAttached[detached - 1]!)]!.attachedTo, undefined, "detached from my faction");
    }
    // Back to my own turn: nothing is offered.
    endTurn(t, t.engine.state.activePlayerId);
    assert.equal(t.engine.state.activePlayerId, P1);
    assert.equal(pending(t)?.kind === "selectTargets" || pending(t)?.kind === "chooserSelectsTarget", false, "nothing at the start of my own turn");
  });
}

// =====================================================================================
// Prophetic Assistant
// =====================================================================================

function propheticBoard(count: number) {
  return table(count, [
    { key: "seer", def: printing(PROPHETIC), owner: P1, zone: "play" },
    ...seatsFor(count).flatMap((seat) => [
      { key: `top-${seat}`, def: resourceCard({ name: `Staple ${seat}` }), owner: seat, zone: "deck" as const },
      ...deckOf(`k-${seat}-`, 3, seat)
    ])
  ]);
}

for (const count of COUNTS) {
  mpClause(PROPHETIC, "0:rule", count, `${count} seats: "At the end of your turn" I may reveal the top card of my deck (shown to every player); a staple resource goes to my hand; not at the end of an opponent's turn`, () => {
    const t = propheticBoard(count);
    for (const seat of seatsFor(count)) t.engine.state.players[seat]!.deck = [t.id(`top-${seat}`), ...t.engine.state.players[seat]!.deck.filter((id) => id !== t.id(`top-${seat}`))];
    const decks = Object.fromEntries(others(count, P1).map((seat) => [seat, [...t.engine.state.players[seat]!.deck]]));
    t.engine.perform({ type: "endTurn", playerId: P1 });
    settle(t);
    assert.equal(pending(t)?.kind, "mayPay");
    assert.equal(pending(t)?.playerId, P1);
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    settle(t);
    assert.equal(zoneOf(t, "top-p1"), "hand", "the staple resource goes to my hand");
    for (const [seat, deck] of Object.entries(decks)) assert.deepEqual(t.engine.state.players[seat]!.deck, deck, `${seat}'s deck is untouched`);
    // The opponents' turns end without any prompt for me.
    for (const seat of others(count, P1)) {
      assert.equal(t.engine.state.activePlayerId, seat);
      endTurn(t, seat);
      assert.notEqual(pending(t)?.kind, "mayPay", `${seat}'s end of turn does not set it off`);
    }
    for (const [seat, deck] of Object.entries(decks)) assert.deepEqual(t.engine.state.players[seat]!.deck, deck, `${seat}'s deck is still untouched`);
  });
}

// =====================================================================================
// The Poshernacle
// =====================================================================================

/** The Poshernacle in P1's play with a card in P1's deck; the player before P1 is active, so ending their turn starts P1's. */
function poshBoard(count: number, active: string) {
  return table(
    count,
    [
      { key: "posh", def: printing(POSHERNACLE), owner: P1, zone: "play" },
      // An ability to use, so that "you may use an ability" has something to offer.
      { key: "study", def: item({ name: "Study", behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" },
      ...seatsFor(count).flatMap((seat) => deckOf(`k-${seat}-`, 4, seat)),
      ...hands(count, 1, "h")
    ],
    { active }
  );
}

/** Ends the turn of the player before P1 and settles the prompts of the start of P1's turn, recording which kinds were asked. */
function startOfMyTurn(t: Table, count: number, answers: { draw: boolean }): string[] {
  const asked: string[] = [];
  endTurn(t, seatsFor(count)[count - 1]!);
  for (let guard = 0; pending(t) && guard < 10; guard++) {
    const pc = pending(t)!;
    asked.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "orderTriggers") t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: (pc.triggers as never[])[0] } });
    else if (pc.kind === "useAnyAbility") t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "useAnyAbility" } });
    else if (pc.kind === "mayPay") t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: answers.draw } });
    else break;
    settle(t);
  }
  return asked;
}

for (const count of COUNTS) {
  const last = seatsFor(count)[count - 1]!;
  mpClause(POSHERNACLE, "1:rule", count, `${count} seats: "At the start of your turn, you may use an ability": offered to me alone, at the start of my turn only`, () => {
    const t = poshBoard(count, last);
    const asked = startOfMyTurn(t, count, { draw: false });
    assert.ok(asked.includes("useAnyAbility:p1"), "I am offered the ability use");
    assert.ok(asked.every((entry) => entry.endsWith(":p1")), "nobody else is asked anything");
    // At the start of an opponent's turn nothing is offered to anyone.
    const next = poshBoard(count, P1);
    next.engine.perform({ type: "endTurn", playerId: P1 });
    settle(next);
    assert.equal(pending(next), undefined, "nothing fires at the start of an opponent's turn");
  });

  mpClause(POSHERNACLE, "2:rule", count, `${count} seats: "At the start of your turn, you may draw a card": I draw, the opponents do not, and nothing fires at their turn starts`, () => {
    const t = poshBoard(count, last);
    const before = Object.fromEntries(seatsFor(count).map((seat) => [seat, handSize(t, seat)]));
    const asked = startOfMyTurn(t, count, { draw: true });
    assert.ok(asked.includes("mayPay:p1"), "I am asked whether to draw");
    assert.equal(handSize(t, P1), before[P1]! + 1, "I draw a card");
    for (const other of others(count, P1)) assert.equal(handSize(t, other), before[other], `${other} draws nothing`);
    const next = poshBoard(count, P1);
    const hand = handSize(next, P1);
    next.engine.perform({ type: "endTurn", playerId: P1 });
    settle(next);
    for (const other of others(count, P1)) assert.equal(handSize(next, other), 1, "no draw at an opponent's turn start");
    assert.equal(handSize(next, P1), hand);
  });

  mpClause(POSHERNACLE, "3:rule", count, `${count} seats: "At the start of your turn, your faction gains 1 influence": mine only, at my turn start only`, () => {
    const t = poshBoard(count, last);
    const before = Object.fromEntries(seatsFor(count).map((seat) => [seat, influenceOf(t, seat)]));
    startOfMyTurn(t, count, { draw: false });
    assert.equal(influenceOf(t, P1), before[P1]! + 1, "my faction gains 1");
    for (const other of others(count, P1)) assert.equal(influenceOf(t, other), before[other], `${other}'s faction gains nothing`);
    const next = poshBoard(count, P1);
    const mine = influenceOf(next, P1);
    next.engine.perform({ type: "endTurn", playerId: P1 });
    settle(next);
    assert.equal(influenceOf(next, P1), mine, "nothing at the start of an opponent's turn");
  });
}
