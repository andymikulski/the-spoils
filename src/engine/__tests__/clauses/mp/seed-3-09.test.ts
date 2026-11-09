// Multiplayer clause tests for Seed 3, part 9 (Shieldmane Grandchest). Every test is a real 3- or 4-seat game with the
// real printing, driven through `perform`.

import assert from "node:assert/strict";
import { character } from "../../support/fixtures.js";
import { mpClause, printing } from "../_clause.js";
import { autoResolveBattle } from "../../support/fixtures.js";
import { answer, expectChoice, othersOf, P1, P2, P3, pending, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { PlayerId, Table } from "./_seed-3.js";

const CHEST = "452bed36-af64-4986-905b-6074fd01437b"; // UNIQUE GRANDCHEST -- When battle damage is inflicted to a character you control, reduce the amount by 2. -- When battle damage is inflicted to a character an opponent controls, increase the amount by 2.

/** P1 plays Shieldmane (the only prompt is the opponent selection) and chooses `chosen`; every seat has a 4-strength, 10-life character, P1 has a 3-strength one that can attack. */
function wardTable(count: number): Table {
  return table(count, [
    { key: "sg", def: printing(CHEST), owner: P1, zone: "hand" },
    ...staples("rage", 8),
    { key: "attacker", def: character({ name: "Attacker", strength: 3, life: 10 }), owner: P1 },
    ...othersOf(count).map((seat) => ({ key: `blocker-${seat}`, def: character({ name: `Blocker ${seat}`, strength: 4, life: 10 }), owner: seat }))
  ]);
}
const enterAndChoose = (t: Table, chosen: PlayerId): void => {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("sg") });
  settle(t);
  const choice = expectChoice(t, "choosePlayer", P1);
  assert.deepEqual(choice.candidates, othersOf(t.seats.length), "the controller selects one opponent, once, when it enters play");
  answer(t, P1, { kind: "choosePlayer", playerId: chosen });
  assert.equal(pending(t), undefined);
};
const damage = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.damage;
const brawl = (t: Table, defender: PlayerId): void => {
  t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("attacker")], target: { type: "faction", playerId: defender } });
  settle(t);
  t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`blocker-${defender}`)] });
  autoResolveBattle(t.engine);
};

for (const count of [3, 4] as const) {
  mpClause(CHEST, "1:rule", count, `${count} seats: battle damage to the controller's own characters is reduced by 2, whichever opponent they fight`, () => {
    const t = wardTable(count);
    enterAndChoose(t, P2);
    brawl(t, count === 3 ? P3 : P2);
    assert.equal(damage(t, "attacker"), 2, "4 battle damage reduced by 2");
  });

  mpClause(CHEST, "2:rule", count, `${count} seats: battle damage to the chosen opponent's characters is increased by 2; the other opponents' characters take it unchanged`, () => {
    const chosenFight = wardTable(count);
    enterAndChoose(chosenFight, P2);
    brawl(chosenFight, P2);
    assert.equal(damage(chosenFight, "blocker-p2"), 5, "3 battle damage to the chosen opponent's character plus 2");
    for (const other of othersOf(count).filter((seat) => seat !== P2)) {
      const t = wardTable(count);
      enterAndChoose(t, P2);
      brawl(t, other);
      assert.equal(damage(t, `blocker-${other}`), 3, `${other} is not the chosen opponent: no increase`);
    }
    void seatsOf;
  });
}

mpClause(CHEST, "2:rule", 3, "3 seats: when the chosen opponent is eliminated the controller chooses again (only P3 is left, so nobody is asked) and P3's characters take 2 more", () => {
  const t = wardTable(3);
  enterAndChoose(t, P2);
  t.engine.state.players[P2]!.eliminated = { turn: 1 };
  brawl(t, P3);
  assert.equal(pending(t), undefined, "no choice is offered");
  assert.equal(damage(t, "blocker-p3"), 5);
});
