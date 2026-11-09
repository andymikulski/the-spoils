// Multiplayer clause tests, seed-saga part 1: 3- and 4-seat tables, real catalog printings, public actions only.
// Spec: data/card-tests/mp-spec/seed-saga.json.
import assert from "node:assert/strict";
import { refused, mpClause } from "../_clause.js";
import { clause } from "../_clause.js";
import { activate, askedPlayers, answer, hand, many, pending, play, printing, res, table, zoneOf, P1, P2, P3, P4 } from "./_mp.js";
import { character } from "../../support/fixtures.js";

const STUPID = "f76b5c48-1fab-4235-8279-9785524413b0"; // tactic: an opponent discards 2 cards; RECUR: an opponent discards a card

const seats = (count: number) => (count === 3 ? [P1, P2, P3] : [P1, P2, P3, P4]);

for (const count of [3, 4] as const) {
  const stupid = (where: "hand" | "discard" = "hand") =>
    table(count, [
      { key: "c", def: printing(STUPID), owner: P1, zone: where },
      ...res("obsession", 3, P1),
      ...seats(count)
        .slice(1)
        .flatMap((p) => many(`h-${p}-`, 3, p, "hand", (i) => character({ name: `${p} card ${i}` })))
    ]);

  mpClause(STUPID, "0:rule", count, `${count} seats: the opponent is chosen with the play; only that opponent discards 2 of their cards`, () => {
    for (const chosen of seats(count).slice(1)) {
      const t = stupid();
      assert.deepEqual(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("c") }), [{ id: "opp", candidates: seats(count).slice(1) }]);
      refused(() => play(t.engine, P1, t.id("c")), "no opponent named");
      play(t.engine, P1, t.id("c"), { players: { opp: chosen } });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, chosen, "the chosen opponent picks what they discard");
      const own = hand(t.engine, chosen);
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`h-${seats(count).find((p) => p !== chosen && p !== P1)}-0`)] }), "another opponent's card");
      answer(t.engine, "chooserSelectsTarget", { selected: [own[0]!, own[1]!] });
      assert.equal(zoneOf(t.engine, own[0]!), "discard");
      assert.equal(zoneOf(t.engine, own[1]!), "discard");
      assert.equal(zoneOf(t.engine, own[2]!), "hand");
      for (const other of seats(count).slice(1).filter((p) => p !== chosen)) assert.equal(hand(t.engine, other).length, 3, `${other} untouched`);
    }
  });

  mpClause(STUPID, "1:ability:recur", count, `${count} seats: RECUR asks for one opponent with the use; only that opponent discards 1 card`, () => {
    for (const chosen of seats(count).slice(1)) {
      const t = stupid("discard");
      assert.deepEqual(askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("c"), abilityId: "recur" }), [{ id: "opp", candidates: seats(count).slice(1) }]);
      activate(t.engine, P1, t.id("c"), "recur", { players: { opp: chosen } });
      const pc = pending(t.engine)!;
      assert.equal(pc.playerId, chosen);
      const own = hand(t.engine, chosen);
      answer(t.engine, "chooserSelectsTarget", { selected: [own[2]!] });
      assert.equal(zoneOf(t.engine, own[2]!), "discard");
      assert.equal(hand(t.engine, chosen).length, 2);
      for (const other of seats(count).slice(1).filter((p) => p !== chosen)) assert.equal(hand(t.engine, other).length, 3, `${other} untouched`);
    }
  });
}
