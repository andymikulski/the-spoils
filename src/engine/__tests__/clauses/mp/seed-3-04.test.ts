// Multiplayer clause tests for Seed 3, part 4 (Vilghame Manewaft). Every test is a real 3- or 4-seat game with the real
// printing, driven through `perform`.

import assert from "node:assert/strict";
import { character, tactic } from "../../support/fixtures.js";
import { mpClause, printing } from "../_clause.js";
import { answer, expectChoice, othersOf, P1, P2, P3, P4, pending, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";

const VILGHAME = "3534079d-0983-4521-a905-589de7d4b9d8"; // UNIQUE VILGHAME -- Your opponent must pay 1 to deploy a tactic. -- The first resource each opponent plays each turn enters play attached to that player's faction.

/** Passes priority until `who` holds it. */
function reach(t: Table, who: PlayerId): void {
  for (let guard = 0; guard < 10 && t.engine.state.responseWindow?.priorityPlayerId !== who; guard++) {
    t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  }
  assert.equal(t.engine.state.responseWindow?.priorityPlayerId, who, `${who} gets priority`);
}

const trick = (name: string) => tactic({ name, cost: 1 });

// --- clause 1: "Your opponent must pay 1 to deploy a tactic" -------------------------------

function taxTable(count: number): Table {
  const seats = seatsOf(count);
  return table(count, [
    { key: "v", def: printing(VILGHAME), owner: P1, zone: "hand" },
    ...staples("greed", 6),
    ...seats.flatMap((seat): CardPlacement[] => [
      { key: `trick-${seat}`, def: trick(`Trick ${seat}`), owner: seat, zone: "hand" },
      ...(seat === P1 ? [] : staples("rage", 1, seat))
    ]),
    { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: P1, zone: "hand" }
  ]);
}

/** P1 plays Vilghame and selects `chosen` (the only prompt of the play). */
function enterWith(t: Table, chosen: PlayerId): void {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("v") });
  settle(t);
  const choice = expectChoice(t, "choosePlayer", P1);
  assert.deepEqual(choice.candidates, othersOf(t.seats.length), "every opponent is offered, once, and not the controller");
  answer(t, P1, { kind: "choosePlayer", playerId: chosen });
  assert.equal(pending(t), undefined);
}

/** Whether `seat` could deploy its cost-1 tactic with exactly one resource (that is, it pays no extra). */
const canPlayTrick = (t: Table, seat: PlayerId): boolean => t.engine.checkAction({ type: "playCard", playerId: seat, cardId: t.id(`trick-${seat}`) }).ok;

for (const count of [3, 4] as const) {
  mpClause(VILGHAME, "1:rule", count, `${count} seats: the controller chooses one opponent when Vilghame enters play; only that opponent pays 1 more to deploy a tactic`, () => {
    const t = taxTable(count);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("v") });
    settle(t);
    const choice = expectChoice(t, "choosePlayer", P1);
    assert.deepEqual(choice.candidates, othersOf(count));
    answer(t, P1, { kind: "choosePlayer", playerId: P2 });
    assert.equal(canPlayTrick(t, P1), true, "the controller pays the normal cost");
    // The others respond to a bait, one at a time.
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
    reach(t, P2);
    assert.equal(canPlayTrick(t, P2), false, "the chosen opponent needs 2 resources for a cost-1 tactic");
    t.engine.perform({ type: "passPriority", playerId: P2 });
    for (const other of othersOf(count).filter((seat) => seat !== P2)) {
      reach(t, other);
      assert.equal(canPlayTrick(t, other), true, `${other} (not chosen) pays the normal cost`);
    }
  });
}

mpClause(VILGHAME, "1:rule", 3, "3 seats: when the chosen opponent is eliminated the controller chooses again (only P3 is left, so nobody is asked) and P3 now pays 1 more", () => {
  const t = taxTable(3);
  enterWith(t, P2);
  t.engine.state.players[P2]!.eliminated = { turn: 1 };
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
  assert.equal(pending(t), undefined, "no choice is offered: one opponent is left");
  reach(t, P3);
  assert.equal(canPlayTrick(t, P3), false, "P3 now pays 1 more");
});

// --- clause 2: the first resource each opponent plays each turn ----------------------------

const sprout = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sprout",
          type: "activated",
          targets: [{ id: "r", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1 }],
          effects: [{ type: "playResource", target: { type: "selected", id: "r" }, faceDown: "auto" }]
        }
      ]
    } as never
  });

const seedling = (name: string): never => ({ ...character({ name }), type: "resource", resource: { provides: ["rage"], staple: true } }) as never;

/** P1 (active) plays Vilghame and chooses P2; every seat has two sprouts (tactics that play a resource) and two resources in hand. */
function tithesTable(count: number): Table {
  const seats = seatsOf(count);
  const t = table(count, [
    { key: "v", def: printing(VILGHAME), owner: P1, zone: "hand" },
    ...staples("greed", 5),
    ...othersOf(count).flatMap((seat) => staples("rage", 3, seat)),
    ...seats.flatMap((seat): CardPlacement[] => [
      { key: `sprout1-${seat}`, def: sprout(`Sprout ${seat} a`), owner: seat, zone: "hand" },
      { key: `sprout2-${seat}`, def: sprout(`Sprout ${seat} b`), owner: seat, zone: "hand" },
      { key: `res1-${seat}`, def: seedling(`Seedling ${seat} a`), owner: seat, zone: "hand" },
      { key: `res2-${seat}`, def: seedling(`Seedling ${seat} b`), owner: seat, zone: "hand" }
    ]),
    { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: P1, zone: "hand" },
    { key: "bait2", def: tactic({ name: "Bait Two", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  enterWith(t, P2);
  return t;
}

const attached = (t: Table, key: string): boolean => t.engine.state.cards[t.id(key)]!.attachedTo !== undefined;
const sproutFor = (t: Table, seat: PlayerId, n: 1 | 2): void => {
  reach(t, seat);
  t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id(`sprout${n}-${seat}`), selected: { r: [t.id(`res${n}-${seat}`)] } });
};

for (const count of [3, 4] as const) {
  mpClause(VILGHAME, "2:rule", count, `${count} seats: the first resource each opponent plays in a turn enters attached to that opponent's own faction, counted per opponent; the controller's resource and an opponent's second one enter normally`, () => {
    const t = tithesTable(count);
    // P1 plays the controller's own resource first, then a bait that every opponent answers with a resource.
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("sprout1-p1"), selected: { r: [t.id("res1-p1")] } });
    settle(t);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
    for (const seat of othersOf(count)) sproutFor(t, seat, 1);
    settle(t);
    assert.equal(pending(t), undefined);
    assert.equal(attached(t, "res1-p1"), false, "the controller's resource enters normally");
    for (const seat of othersOf(count)) assert.equal(attached(t, `res1-${seat}`), true, `${seat}'s first resource this turn is attached to ${seat}'s faction`);
    // Their second resource of the turn is not the first.
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait2") });
    for (const seat of othersOf(count)) sproutFor(t, seat, 2);
    settle(t);
    for (const seat of othersOf(count)) assert.equal(attached(t, `res2-${seat}`), false, `${seat}'s second resource this turn enters normally`);
    void P3;
    void P4;
  });
}

