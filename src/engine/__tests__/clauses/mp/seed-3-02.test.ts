// Multiplayer clause tests for Seed 3, part 2 (Geiseric, Pony Slaystation, The Stone of Shame). Every test is a real
// 3- or 4-seat game with the real printing, driven through `perform`.

import assert from "node:assert/strict";
import { character, item, tactic } from "../../support/fixtures.js";
import { clause, printing } from "../_clause.js";
import { answer, bounce, expectChoice, othersOf, P1, P2, pending, settle, staples, table, tokensOn, zoneOf } from "./_seed-3.js";
import type { PlayerId, Table } from "./_seed-3.js";

/** A tactic that moves one chosen item to its owner's hand. */
const bounceItem = () =>
  tactic({
    name: "Item Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "ib", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    } as never
  });

const bounceOf = (t: Table, key: string, spell = "bounce") => {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id(spell), selected: { t: [t.id(key)] } });
  settle(t);
};

// =====================================================================================
// Geiseric, the Souleater
// =====================================================================================

const GEISERIC = "c9801386-03b5-4348-8706-f81fec9819bd"; // If a character would be put into an opponent's hand from play, you may pay 1. If you do, remove it from the game and put a token on this card instead.

function geisericTable(count: number) {
  return table(count, [
    { key: "g", def: printing(GEISERIC), owner: P1 },
    ...staples("rage", 3),
    { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
    { key: "ib", def: bounceItem(), owner: P1, zone: "hand" },
    ...[P1, ...othersOf(count)].map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}` }), owner: seat })),
    { key: "i-p2", def: item({ name: "Item p2" }), owner: P2 }
  ]);
}

for (const count of [3, 4] as const) {
  clause(GEISERIC, "1:rule", `${count} seats: a character of any one opponent put into that opponent's hand may be removed instead (no opponent is chosen); one of the controller's own is bounced normally`, () => {
    for (const seat of othersOf(count)) {
      const t = geisericTable(count);
      bounceOf(t, `c-${seat}`);
      expectChoice(t, "replacementChoice", P1);
      answer(t, P1, { kind: "replacementChoice", apply: true });
      assert.equal(zoneOf(t, `c-${seat}`), "removed", `${seat}'s character is removed from the game`);
      assert.equal(tokensOn(t, "g"), 1);
      for (const other of othersOf(count).filter((s) => s !== seat)) assert.equal(zoneOf(t, `c-${other}`), "play", `${other}'s character is untouched`);
    }
    const own = geisericTable(count);
    bounceOf(own, "c-p1");
    assert.equal(pending(own), undefined, "no option for a character put into the controller's own hand");
    assert.equal(zoneOf(own, "c-p1"), "hand");
    assert.equal(tokensOn(own, "g"), 0);
  });
}

clause(GEISERIC, "1:rule", "3 seats: declining the option on a P2 character sends it to P2's hand; an item put into an opponent's hand gets no option", () => {
  const t = geisericTable(3);
  bounceOf(t, "c-p2");
  expectChoice(t, "replacementChoice", P1);
  answer(t, P1, { kind: "replacementChoice", apply: false });
  assert.equal(zoneOf(t, "c-p2"), "hand");
  assert.equal(tokensOn(t, "g"), 0);
  const items = geisericTable(3);
  bounceOf(items, "i-p2", "ib");
  assert.equal(pending(items), undefined, "an item is not a character: no option");
  assert.equal(zoneOf(items, "i-p2"), "hand");
});

// =====================================================================================
// Pony Slaystation
// =====================================================================================

const PONY = "d1fc04ec-fef0-4031-8e4c-9ce7c1273015"; // When a character with 3 strength or less enters play under an opponent's control, destroy that character and inflict X damage to this card, where X is that character's strength.

function ponyTable(count: number, active: PlayerId, strengths: Partial<Record<PlayerId, number>>) {
  return table(
    count,
    [
      { key: "pony", def: printing(PONY), owner: P1 },
      ...Object.entries(strengths).map(([seat, strength]) => ({ key: `new-${seat}`, def: character({ name: `Newcomer ${seat}`, strength, life: 5 }), owner: seat as PlayerId, zone: "hand" as const }))
    ],
    { active }
  );
}
const enter = (t: Table, seat: PlayerId) => {
  t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id(`new-${seat}`) });
  settle(t);
};
const damageOn = (t: Table, key: string) => t.engine.state.cards[t.id(key)]!.damage;

for (const count of [3, 4] as const) {
  clause(PONY, "0:rule", `${count} seats: a small character entering under any opponent's control is destroyed and damages Pony Slaystation; no opponent is chosen; a big one and the controller's own are untouched`, () => {
    for (const seat of othersOf(count)) {
      const t = ponyTable(count, seat, { [seat]: 2 });
      enter(t, seat);
      assert.equal(pending(t), undefined, "no chooseOpponent step");
      assert.equal(zoneOf(t, `new-${seat}`), "discard", `${seat}'s 2-strength character is destroyed`);
      assert.equal(damageOn(t, "pony"), 2, "Pony takes damage equal to that character's strength");
    }
    const big = ponyTable(count, P2, { [P2]: 4 });
    enter(big, P2);
    assert.equal(zoneOf(big, "new-p2"), "play", "a 4-strength character is not destroyed");
    assert.equal(damageOn(big, "pony"), 0);
    const own = ponyTable(count, P1, { [P1]: 2 });
    enter(own, P1);
    assert.equal(zoneOf(own, "new-p1"), "play", "the controller's own character is untouched");
    assert.equal(damageOn(own, "pony"), 0);
  });
}

// =====================================================================================
// The Stone of Shame
// =====================================================================================

const SHAME = "91803a23-9aff-4665-87cf-ff3e40580ede"; // If a character would be put into a player's hand, destroy it instead.

clause(SHAME, "0:rule", "3 seats: a character put into any player's hand (the controller's, or either opponent's) is destroyed instead; an item goes to the hand normally", () => {
  for (const seat of [P1, ...othersOf(3)]) {
    const t = table(3, [
      { key: "stone", def: printing(SHAME), owner: P1 },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      { key: "ib", def: bounceItem(), owner: P1, zone: "hand" },
      ...[P1, ...othersOf(3)].map((s) => ({ key: `c-${s}`, def: character({ name: `Char ${s}` }), owner: s })),
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: seat }
    ]);
    bounceOf(t, `c-${seat}`);
    assert.equal(zoneOf(t, `c-${seat}`), "discard", `${seat}'s character is destroyed instead of going to ${seat}'s hand`);
    for (const other of [P1, ...othersOf(3)].filter((s) => s !== seat)) assert.equal(zoneOf(t, `c-${other}`), "play");
    bounceOf(t, "gizmo", "ib");
    assert.equal(zoneOf(t, "gizmo"), "hand", "an item put into a hand is not a character");
  }
});
