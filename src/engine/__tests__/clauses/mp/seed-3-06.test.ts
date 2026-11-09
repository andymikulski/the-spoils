// Multiplayer clause tests for Seed 3, part 6 (Hilarious Refrigerator Alarm). Every test is a real 3- or 4-seat game with
// the real printing, driven through `perform`.

import assert from "node:assert/strict";
import { tactic } from "../../support/fixtures.js";
import { mpClause, printing } from "../_clause.js";
import { answer, expectChoice, othersOf, P1, pending, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";

const ALARM = "febadb33-11cf-4dec-815b-5e86d03488f0"; // All other unresolved cards are terminated. -- If an opponent deployed at least 2 cards with the same name this turn, put up to 2 Micromajig tokens into play under your control. Otherwise, each opponent may put 3 Micromajig tokens into play under their control.

const FOO = tactic({ name: "Foo", cost: 0 });
const BAR = tactic({ name: "Bar", cost: 0 });

/** Passes priority until `who` holds it. */
function reach(t: Table, who: PlayerId): void {
  for (let guard = 0; guard < 10 && t.engine.state.responseWindow?.priorityPlayerId !== who; guard++) {
    t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  }
  assert.equal(t.engine.state.responseWindow?.priorityPlayerId, who, `${who} gets priority`);
}

/** `deploys` is the cards (keys) each opponent deploys this turn, in response to baits of P1's. */
function alarmTable(count: number, deploys: Partial<Record<PlayerId, Array<"foo" | "bar">>>): Table {
  const cards: CardPlacement[] = [{ key: "alarm", def: printing(ALARM), owner: P1, zone: "hand" }, ...staples("elitism", 2)];
  let baits = 0;
  for (const [seat, names] of Object.entries(deploys)) {
    names!.forEach((name, index) => {
      cards.push({ key: `${seat}-${name}-${index}`, def: name === "foo" ? FOO : BAR, owner: seat as PlayerId, zone: "hand" });
      cards.push({ key: `bait-${seat}-${index}`, def: tactic({ name: `Bait ${baits++}`, cost: 0 }), owner: P1, zone: "hand" });
    });
  }
  const t = table(count, cards);
  for (const [seat, names] of Object.entries(deploys)) {
    names!.forEach((name, index) => {
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id(`bait-${seat}-${index}`) });
      reach(t, seat as PlayerId);
      t.engine.perform({ type: "playCard", playerId: seat as PlayerId, cardId: t.id(`${seat}-${name}-${index}`) });
      settle(t);
    });
  }
  return t;
}

const microsOf = (t: Table, seat: PlayerId): number =>
  Object.values(t.engine.state.cards).filter((card) => card.isToken && card.zone === "play" && card.controllerId === seat).length;
const playAlarm = (t: Table): void => {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("alarm") });
  settle(t);
};

for (const count of [3, 4] as const) {
  mpClause(ALARM, "0:rule", count, `${count} seats: every other unresolved card (each opponent's) is terminated when it resolves`, () => {
    const t = table(count, [
      { key: "alarm", def: printing(ALARM), owner: P1, zone: "hand" },
      ...staples("elitism", 2),
      ...othersOf(count).flatMap((seat): CardPlacement[] => [{ key: `foo-${seat}`, def: FOO, owner: seat, zone: "hand" }]),
      { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: P1, zone: "hand" }
    ]);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
    for (const seat of othersOf(count)) {
      reach(t, seat);
      t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id(`foo-${seat}`) });
    }
    reach(t, P1);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("alarm") });
    // Priority returns around the table; nobody responds further.
    let guard = 0;
    while (t.engine.state.responseStack.length > 0 && !pending(t) && guard++ < 40) {
      const window = t.engine.state.responseWindow!;
      t.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
      if (t.engine.state.responseStack.length === 0) break;
    }
    // Whatever else is on the stack once the Alarm has resolved, no opponent's card is.
    for (const item of t.engine.state.responseStack) assert.notEqual(t.engine.state.cards[item.sourceId]!.controllerId !== P1, true, "no opponent card is left unresolved");
    for (const seat of othersOf(count)) assert.equal(t.engine.state.cards[t.id(`foo-${seat}`)]!.zone, "discard", `${seat}'s card was terminated, not resolved`);
  });

  mpClause(ALARM, "1:rule", count, `${count} seats: if any one opponent deployed 2 same-name cards this turn, only the controller puts up to 2 tokens into play; no opponent is asked`, () => {
    for (const seat of othersOf(count)) {
      const t = alarmTable(count, { [seat]: ["foo", "foo"] });
      playAlarm(t);
      const choice = expectChoice(t, "chooseNumber", P1);
      assert.equal(choice.max, 2);
      answer(t, P1, { kind: "chooseNumber", value: 2 });
      assert.equal(pending(t), undefined, "no opponent is asked whether to put tokens");
      assert.equal(microsOf(t, P1), 2, "the controller gets the tokens");
      for (const other of othersOf(count)) assert.equal(microsOf(t, other), 0, `${other} gets none`);
    }
  });

  mpClause(ALARM, "1:rule", count, `${count} seats: when no single opponent deployed 2 same-name cards (even if the same name was deployed twice in total), each opponent is asked separately, in turn order, whether to put 3 tokens into play under their own control`, () => {
    const deploys: Partial<Record<PlayerId, Array<"foo" | "bar">>> = { p2: ["foo", "bar"], p3: ["foo"] };
    const t = alarmTable(count, deploys);
    playAlarm(t);
    assert.equal(microsOf(t, P1), 0, "the controller gets no tokens");
    const asked: PlayerId[] = [];
    for (let guard = 0; guard < 8 && pending(t); guard++) {
      const pc = pending(t)!;
      assert.equal(pc.kind, "mayPay");
      asked.push(pc.playerId);
      // The third opponent (4 seats) declines; the others accept.
      answer(t, pc.playerId, { kind: "mayPay", pay: pc.playerId !== "p4" });
    }
    assert.deepEqual(asked, othersOf(count), "every opponent is asked once, in turn order");
    assert.equal(microsOf(t, P1), 0);
    for (const seat of othersOf(count)) assert.equal(microsOf(t, seat), seat === "p4" ? 0 : 3, `${seat}'s tokens`);
    void seatsOf;
  });
}
