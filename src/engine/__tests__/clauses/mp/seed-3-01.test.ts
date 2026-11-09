// Multiplayer clause tests for Seed 3, part 1 (Devilfang Thunderhoof ... Stone of Shame). Every test is a real
// 3- or 4-seat game with the real printing, driven through `perform`. Expectations come from the printed text and
// data/card-tests/mp-spec/seed-3.json.

import assert from "node:assert/strict";
import { character, item, tactic } from "../../support/fixtures.js";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import { answer, bounce, cardsOf, controllerOf, expectChoice, handOf, kill, offered, othersOf, P1, P2, P3, P4, pending, pickTargets, settle, staples, table, tokensOn, zoneOf } from "./_seed-3.js";
import type { PlayerId, Table } from "./_seed-3.js";

// =====================================================================================
// Devilfang Thunderhoof
// =====================================================================================

const THUNDER = "186b8e6c-7c64-42e9-b885-bf7b26fdf387"; // DISRUPT -- COST: Pay 2. Remove a token from this card. Pick an opponent. -- EFFECT: That player discards a card.

function thunderTable(count: number) {
  const hands = othersOf(count).flatMap((seat) => cardsOf(`h-${seat}-`, 2, seat, "hand", (i) => character({ name: `Card ${seat} ${i}` })));
  return table(count, [{ key: "th", def: printing(THUNDER), owner: P1, counters: { token: 2 } }, ...staples("rage", 2), ...hands]);
}
const disrupt = (t: Table, who?: PlayerId) =>
  t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("th"), abilityId: "thunderhoof-disrupt", ...(who ? { players: { who } } : {}) });

for (const count of [3, 4] as const) {
  clause(THUNDER, "3:ability:thunderhoof-disrupt", `${count} seats: the cost picks one opponent (exactly one selection), and only that opponent discards a card of their own hand`, () => {
    for (const picked of othersOf(count)) {
      const t = thunderTable(count);
      const needs = t.engine.getPlayRequirements({ type: "activateAbility", playerId: P1, cardId: t.id("th"), abilityId: "thunderhoof-disrupt" });
      assert.deepEqual(needs, [{ kind: "players", choices: [{ id: "who", candidates: othersOf(count) }] }], "one opponent selection, offering every opponent and not the controller");
      refused(() => disrupt(t), "no opponent picked", /Choose/i);
      disrupt(t, picked);
      settle(t);
      assert.equal(tokensOn(t, "th"), 1, "the token was removed as a cost");
      expectChoice(t, "chooserSelectsTarget", picked);
      assert.deepEqual(
        offered(t).sort(),
        handOf(t, picked).sort(),
        "the picked opponent chooses among the cards in their own hand"
      );
      const keep = handOf(t, picked)[0]!;
      const toss = handOf(t, picked)[1]!;
      const before = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
      pickTargets(t, picked, [toss]);
      assert.equal(pending(t), undefined, "nobody else is asked anything");
      assert.equal(t.engine.state.cards[toss]!.zone, "discard");
      assert.equal(t.engine.state.cards[keep]!.zone, "hand");
      for (const seat of t.seats) assert.equal(handOf(t, seat).length, before[seat]! - (seat === picked ? 1 : 0), `${seat}'s hand`);
    }
  });
}

clause(THUNDER, "3:ability:thunderhoof-disrupt", "3 seats: a card of the other opponent's hand cannot be discarded, and the controller (not an opponent) cannot be picked", () => {
  const t = thunderTable(3);
  refused(() => disrupt(t, P1), "yourself as the picked opponent");
  disrupt(t, P2);
  settle(t);
  expectChoice(t, "chooserSelectsTarget", P2);
  const theirs = handOf(t, P3)[0]!;
  assert.ok(!offered(t).includes(theirs), "P3's cards are not offered to P2");
  refused(() => pickTargets(t, P2, [theirs]), "a card of the other opponent's hand");
  pickTargets(t, P2, [handOf(t, P2)[0]!]);
  assert.equal(handOf(t, P3).length, 2);
});
