// Multiplayer clause tests (3 and 4 seats) — Decade of Deckadence, part 1.
// Expectations come from each card's PRINTED text and the multiplayer spec (data/card-tests/mp-spec/decade-of-deckadence.json):
// a real game of 3 or 4 seats built from the real catalog printing, driven only through `perform`.

import assert from "node:assert/strict";
import { character, tactic } from "../../support/fixtures.js";
import { clause, printing, refused } from "../_clause.js";
import {
  accepts,
  act,
  activate,
  choosePlayer,
  expectIdle,
  expectPending,
  hand,
  ids,
  influence,
  KILL,
  KILL_ANY,
  lost,
  offered,
  oneEach,
  P1,
  P2,
  P3,
  P4,
  playCard,
  plain,
  priority,
  res,
  select,
  snapshot,
  table,
  zoneOf,
  type Count,
  type Table
} from "./_dod.js";
import type { PlayerId } from "../../../../engine.js";

const SEATS_OF = (count: Count): PlayerId[] => [P1, P2, P3, P4].slice(0, count);
const OPPONENTS_OF = (count: Count): PlayerId[] => SEATS_OF(count).slice(1);

// --- Deadly Striker ---------------------------------------------------------------

const DEADLY_STRIKER = "e26eb079-952b-4396-bb5d-79894ac5417e";

/** P1's Deadly Striker in play and a free kill tactic in P1's hand. */
function strikerTable(count: Count): Table {
  return table(count, [
    { key: "me", def: printing(DEADLY_STRIKER), owner: P1, zone: "play" },
    { key: "kill", def: KILL, owner: P1, zone: "hand" }
  ]);
}

clause(DEADLY_STRIKER, "0:rule", "3 seats: when it is destroyed P1 picks which opponent's faction loses 4; the other opponent and P1 are unaffected", () => {
  for (const chosen of [P2, P3]) {
    const t = strikerTable(3);
    const before = snapshot(t);
    playCard(t, P1, "kill", { selected: { t: [t.id("me")] } });
    assert.equal(zoneOf(t, "me"), "discard");
    choosePlayer(t, P1, [P2, P3], chosen);
    expectIdle(t);
    assert.equal(lost(t, before, chosen), 4, `${chosen} loses 4 influence`);
    for (const other of [P1, P2, P3].filter((seat) => seat !== chosen)) assert.equal(lost(t, before, other), 0, `${other} is unaffected`);
  }
});

clause(DEADLY_STRIKER, "0:rule", "4 seats: every opponent can be picked; only the picked one loses 4", () => {
  for (const chosen of [P2, P3, P4]) {
    const t = strikerTable(4);
    const before = snapshot(t);
    playCard(t, P1, "kill", { selected: { t: [t.id("me")] } });
    choosePlayer(t, P1, [P2, P3, P4], chosen);
    expectIdle(t);
    for (const seat of t.seats) assert.equal(lost(t, before, seat), seat === chosen ? 4 : 0, seat);
  }
});

clause(DEADLY_STRIKER, "0:rule", "3 seats: with one opponent already out nobody is asked and the last opponent loses 4", () => {
  const t = strikerTable(3);
  t.engine.state.players[P3]!.eliminated = { turn: 1 };
  const before = snapshot(t);
  playCard(t, P1, "kill", { selected: { t: [t.id("me")] } });
  expectIdle(t, "a single opponent left needs no choice");
  assert.equal(lost(t, before, P2), 4);
  assert.equal(lost(t, before, P1), 0);
});

// --- Enlightened Sarcophyle -------------------------------------------------------

const ENLIGHTENED = "249bf742-f624-4e5b-a236-a5757e64472a";

function enlightenedTable(count: Count): Table {
  return table(count, [
    { key: "me", def: printing(ENLIGHTENED), owner: P1, zone: "play" },
    { key: "kill", def: KILL, owner: P1, zone: "hand" },
    ...oneEach(SEATS_OF(count))
  ]);
}

clause(ENLIGHTENED, "0:rule", "3 seats: when a character is destroyed P1 gains 1 and both opponents lose 1, with no opponent prompt", () => {
  for (const victim of [P1, P2, P3]) {
    const t = enlightenedTable(3);
    const before = snapshot(t);
    playCard(t, P1, "kill", { selected: { t: [t.id(`c-${victim}`)] } });
    assert.equal(zoneOf(t, `c-${victim}`), "discard");
    expectIdle(t, "no opponent is asked for");
    assert.equal(lost(t, before, P1), -1, "P1 gains 1 and loses nothing");
    assert.equal(lost(t, before, P2), 1);
    assert.equal(lost(t, before, P3), 1);
  }
});

clause(ENLIGHTENED, "0:rule", "4 seats: P1 gains 1 and P2, P3 and P4 each lose 1; an eliminated seat is skipped", () => {
  const t = enlightenedTable(4);
  const before = snapshot(t);
  playCard(t, P1, "kill", { selected: { t: [t.id("c-p2")] } });
  expectIdle(t);
  assert.deepEqual(t.seats.map((seat) => lost(t, before, seat)), [-1, 1, 1, 1]);
  const out = enlightenedTable(4);
  out.engine.state.players[P3]!.eliminated = { turn: 1 };
  const base = snapshot(out);
  playCard(out, P1, "kill", { selected: { t: [out.id("c-p2")] } });
  assert.deepEqual(out.seats.map((seat) => lost(out, base, seat)), [-1, 1, 0, 1], "only P2 and P4 lose 1");
});

// --- Insidious Brainworm ------------------------------------------------------------

const BRAINWORM = "0fca82df-12d4-4a50-abe5-1ed3c79d3fc1";

function brainwormTable(count: Count): Table {
  return table(count, [{ key: "me", def: printing(BRAINWORM), owner: P1, zone: "hand" }, ...res({ obsession: 8 })]);
}

clause(BRAINWORM, "0:rule", "3 seats: when it enters play both opponents lose 3 and P1 does not, with no opponent prompt", () => {
  const t = brainwormTable(3);
  const before = snapshot(t);
  playCard(t, P1, "me");
  assert.equal(zoneOf(t, "me"), "play");
  expectIdle(t, "no opponent is asked for");
  assert.deepEqual(t.seats.map((seat) => lost(t, before, seat)), [0, 3, 3]);
});

clause(BRAINWORM, "0:rule", "4 seats: P2, P3 and P4 each lose 3; with P3 out only P2 and P4 do", () => {
  const t = brainwormTable(4);
  const before = snapshot(t);
  playCard(t, P1, "me");
  expectIdle(t);
  assert.deepEqual(t.seats.map((seat) => lost(t, before, seat)), [0, 3, 3, 3]);
  const out = brainwormTable(4);
  out.engine.state.players[P3]!.eliminated = { turn: 1 };
  const base = snapshot(out);
  playCard(out, P1, "me");
  assert.deepEqual(out.seats.map((seat) => lost(out, base, seat)), [0, 3, 0, 3]);
});

// --- Brainbath ------------------------------------------------------------------------

const BRAINBATH = "3bd6878a-1a14-402f-93eb-a23afac654b0";

function brainbathTable(count: Count, handSizes: Partial<Record<PlayerId, number>> = {}): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(BRAINBATH), owner: P1, zone: "discard" },
    ...res({ obsession: 6 }),
    ...plain("p1h", 2, P1, "hand"),
    ...plain("d", 3, P1, "deck"),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}h`, handSizes[seat] ?? 2, seat, "hand"))
  ]);
}

clause(BRAINBATH, "1:ability:recur", "3 seats: RECUR makes P2 then P3 each choose and discard their own card; P1 discards nothing and draws once", () => {
  const t = brainbathTable(3);
  activate(t, P1, "me", "recur");
  expectPending(t, "chooserSelectsTarget", P2);
  assert.deepEqual(new Set(offered(t)), new Set(ids(t, ["p2h0", "p2h1"])), "P2 is offered P2's hand only");
  assert.equal(accepts(t, P2, { kind: "chooserSelectsTarget", selected: [t.id("p3h0")] }), false, "P3's card cannot be chosen by P2");
  select(t, P2, ["p2h1"]);
  expectPending(t, "chooserSelectsTarget", P3);
  assert.deepEqual(new Set(offered(t)), new Set(ids(t, ["p3h0", "p3h1"])), "P3 is offered P3's hand only");
  select(t, P3, ["p3h0"]);
  expectIdle(t);
  assert.equal(zoneOf(t, "p2h1"), "discard");
  assert.equal(zoneOf(t, "p3h0"), "discard");
  assert.equal(zoneOf(t, "p2h0"), "hand");
  assert.equal(zoneOf(t, "p3h1"), "hand");
  assert.equal(hand(t, P1).length, 3, "P1 kept both cards and drew one");
  assert.equal(zoneOf(t, "me"), "void", "the cost voided Brainbath");
});

clause(BRAINBATH, "1:ability:recur", "3 seats: with P3 eliminated only P2 discards and nobody asks P3", () => {
  const t = brainbathTable(3);
  t.engine.state.players[P3]!.eliminated = { turn: 1 };
  activate(t, P1, "me", "recur");
  expectPending(t, "chooserSelectsTarget", P2);
  select(t, P2, ["p2h0"]);
  expectIdle(t);
  assert.equal(zoneOf(t, "p3h0"), "hand");
  assert.equal(zoneOf(t, "p3h1"), "hand");
});

clause(BRAINBATH, "1:ability:recur", "4 seats: P2, P3 and P4 discard in that order, an empty hand is skipped, then P1 draws once", () => {
  const t = brainbathTable(4, { p3: 0 });
  activate(t, P1, "me", "recur");
  expectPending(t, "chooserSelectsTarget", P2);
  select(t, P2, ["p2h0"]);
  expectPending(t, "chooserSelectsTarget", P4);
  assert.deepEqual(new Set(offered(t)), new Set(ids(t, ["p4h0", "p4h1"])));
  select(t, P4, ["p4h1"]);
  expectIdle(t);
  assert.equal(zoneOf(t, "p2h0"), "discard");
  assert.equal(zoneOf(t, "p4h1"), "discard");
  assert.equal(hand(t, P3).length, 0);
  assert.equal(hand(t, P1).length, 3);
});

// --- Luteorunic Behemoth ----------------------------------------------------------------

const BEHEMOTH = "40841abf-5c44-4a67-8597-2675a2cad9bb";

function behemothTable(count: Count, spare: Partial<Record<PlayerId, number>> = {}): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(BEHEMOTH), owner: P1, zone: "hand" },
    ...res({ elitism: 12 }),
    ...plain("p1c", 2, P1, "play"),
    ...seats.slice(1).flatMap((seat) => [...plain(`${seat}c`, spare[seat] ?? 5, seat, "play"), ...res({ rage: 2 }, seat)])
  ]);
}

clause(BEHEMOTH, "0:rule", "3 seats: when deployed P2 then P3 each choose and destroy 4 of their own non-staple cards; P1's cards and staples are untouched", () => {
  const t = behemothTable(3);
  playCard(t, P1, "me");
  expectPending(t, "chooserSelectsTarget", P2);
  const mine = ids(t, ["p2c0", "p2c1", "p2c2", "p2c3", "p2c4"]);
  assert.deepEqual(new Set(offered(t)), new Set(mine), "P2 is offered P2's non-staple cards only");
  select(t, P2, ["p2c0", "p2c1", "p2c2", "p2c3"]);
  expectPending(t, "chooserSelectsTarget", P3);
  assert.deepEqual(new Set(offered(t)), new Set(ids(t, ["p3c0", "p3c1", "p3c2", "p3c3", "p3c4"])));
  select(t, P3, ["p3c1", "p3c2", "p3c3", "p3c4"]);
  expectIdle(t);
  for (const key of ["p2c0", "p2c1", "p2c2", "p2c3", "p3c1", "p3c2", "p3c3", "p3c4"]) assert.equal(zoneOf(t, key), "discard", key);
  for (const key of ["p2c4", "p3c0", "p1c0", "p1c1", "me"]) assert.equal(zoneOf(t, key), "play", key);
  const staples = Object.values(t.engine.state.cards).filter((card) => card.ownerId !== P1 && t.engine.getDefinition(card.id).resource);
  assert.equal(staples.length, 4);
  assert.ok(staples.every((card) => card.zone === "play"), "staple cards are never destroyed");
});

clause(BEHEMOTH, "0:rule", "3 seats: an opponent with fewer than 4 non-staple cards destroys all they have", () => {
  const t = behemothTable(3, { p3: 2 });
  playCard(t, P1, "me");
  select(t, P2, ["p2c0", "p2c1", "p2c2", "p2c3"]);
  if (t.engine.state.pendingChoice) select(t, P3, ["p3c0", "p3c1"]);
  expectIdle(t);
  assert.equal(zoneOf(t, "p3c0"), "discard");
  assert.equal(zoneOf(t, "p3c1"), "discard");
});

clause(BEHEMOTH, "0:rule", "4 seats: P2, then P3, then P4 each destroy 4 non-staple cards they control; P1 destroys nothing", () => {
  const t = behemothTable(4);
  playCard(t, P1, "me");
  for (const seat of [P2, P3, P4]) {
    expectPending(t, "chooserSelectsTarget", seat);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [0, 1, 2, 3, 4].map((n) => `${seat}c${n}`))), `${seat} is offered only ${seat}'s cards`);
    select(t, seat, [0, 1, 2, 3].map((n) => `${seat}c${n}`));
  }
  expectIdle(t);
  for (const seat of [P2, P3, P4]) assert.equal(zoneOf(t, `${seat}c4`), "play");
  assert.equal(zoneOf(t, "p1c0"), "play");
  assert.equal(zoneOf(t, "p1c1"), "play");
});

// --- Escort Ally --------------------------------------------------------------------------

const ESCORT_ALLY = "0007c001-1606-422f-b1a8-cdc4c7afbce9";

function allyTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(ESCORT_ALLY), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "P1 char", life: 5 }), owner: P1, zone: "play" },
    { key: "mine2", def: character({ name: "P1 other char", life: 5 }), owner: P1, zone: "play" },
    { key: "kill-p1", def: KILL, owner: P1, zone: "hand" },
    { key: "bait", def: tactic({ name: "Bait" }), owner: P1, zone: "hand" },
    ...seats.slice(1).flatMap((seat) => [
      { key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 5 }), owner: seat, zone: "play" as const },
      { key: `kill-${seat}`, def: KILL, owner: seat, zone: "hand" as const }
    ])
  ]);
}

/** P1 uses SUBSTITUTE, then plays a bait tactic; `killer` answers it by destroying `targetKey`. */
function substituteThenKill(t: Table, killer: PlayerId, targetKey: string): void {
  activate(t, P1, "me", "escort-ally-substitute");
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
  while (priority(t) !== killer) t.engine.perform({ type: "passPriority", playerId: priority(t)! });
  act(t, { type: "playCard", playerId: killer, cardId: t.id(`kill-${killer}`), selected: { t: [t.id(targetKey)] } } as never);
}

clause(ESCORT_ALLY, "0:ability:escort-ally-substitute", "3 seats: after SUBSTITUTE neither P2's nor P3's cards can destroy a P1 character, P1's own and others' still can", () => {
  for (const killer of [P2, P3]) {
    const t = allyTable(3);
    substituteThenKill(t, killer, "mine");
    assert.equal(zoneOf(t, "me"), "discard", "Escort Ally was destroyed as the cost");
    assert.equal(zoneOf(t, "mine"), "play", `${killer}'s card cannot destroy P1's character`);
  }
  const own = allyTable(3);
  activate(own, P1, "me", "escort-ally-substitute");
  playCard(own, P1, "kill-p1", { selected: { t: [own.id("mine2")] } });
  assert.equal(zoneOf(own, "mine2"), "discard", "P1's own card still destroys a P1 character");
  const other = allyTable(3);
  substituteThenKill(other, P2, "c-p3");
  assert.equal(zoneOf(other, "c-p3"), "discard", "a P2 card still destroys a P3 character");
});

clause(ESCORT_ALLY, "0:ability:escort-ally-substitute", "4 seats: the protection holds against P2, P3 and P4 alike; a P2 card still destroys a P4 character", () => {
  for (const killer of [P2, P3, P4]) {
    const t = allyTable(4);
    substituteThenKill(t, killer, "mine");
    assert.equal(zoneOf(t, "mine"), "play", `${killer}'s card cannot destroy P1's character`);
  }
  const own = allyTable(4);
  activate(own, P1, "me", "escort-ally-substitute");
  playCard(own, P1, "kill-p1", { selected: { t: [own.id("mine2")] } });
  assert.equal(zoneOf(own, "mine2"), "discard");
  const other = allyTable(4);
  substituteThenKill(other, P2, "c-p4");
  assert.equal(zoneOf(other, "c-p4"), "discard");
});

// --- Temple of Rantzigore -------------------------------------------------------------------

const TEMPLE = "66d4842a-f209-4ff8-bf29-935596d08bb7";

const stats = (t: Table, key: string): number[] => (["strength", "life", "speed"] as const).map((stat) => t.engine.getStat(t.id(key), stat));

function templeTable(count: Count, extra: Parameters<typeof table>[1] = [], options: Parameters<typeof table>[2] = {}): Table {
  const seats = SEATS_OF(count);
  return table(
    count,
    [
      { key: "me", def: printing(TEMPLE), owner: P1, zone: "play" },
      ...seats.map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, strength: 3, life: 4, speed: 3 }), owner: seat, zone: "play" as const })),
      ...extra
    ],
    options
  );
}

clause(TEMPLE, "1:rule", "3 seats: P2's and P3's characters lose 1 strength, 1 life and 1 speed, P1's do not, a later P3 arrival is hit, and it ends with the Temple", () => {
  const t = templeTable(3);
  assert.deepEqual(stats(t, "c-p1"), [3, 4, 3]);
  assert.deepEqual(stats(t, "c-p2"), [2, 3, 2]);
  assert.deepEqual(stats(t, "c-p3"), [2, 3, 2]);
  expectIdle(t, "the Temple asks nobody for an opponent");
  const arrival = templeTable(3, [{ key: "late", def: character({ name: "Late", strength: 3, life: 4, speed: 3 }), owner: P3, zone: "hand" }], { activePlayerId: P3, turn: 3 });
  playCard(arrival, P3, "late");
  assert.equal(zoneOf(arrival, "late"), "play");
  assert.deepEqual(stats(arrival, "late"), [2, 3, 2], "a P3 character entering later is affected");
  const gone = templeTable(3, [{ key: "demolish", def: KILL_ANY, owner: P1, zone: "hand" }]);
  playCard(gone, P1, "demolish", { selected: { t: [gone.id("me")] } });
  assert.equal(zoneOf(gone, "me"), "discard");
  for (const seat of [P1, P2, P3]) assert.deepEqual(stats(gone, `c-${seat}`), [3, 4, 3], `${seat}'s stats returned`);
});

clause(TEMPLE, "1:rule", "4 seats: characters of P2, P3 and P4 each lose 1/1/1 and P1's do not", () => {
  const t = templeTable(4);
  assert.deepEqual(stats(t, "c-p1"), [3, 4, 3]);
  for (const seat of [P2, P3, P4]) assert.deepEqual(stats(t, `c-${seat}`), [2, 3, 2], seat);
});

// --- The Ministry of Other Smaller Smaller Ministries --------------------------------------

const MINISTRY = "03793397-ca23-4bda-b0ec-3a1597874ab8";

function ministryTable(count: Count, active: PlayerId, ready: number): Table {
  const seats = SEATS_OF(count);
  return table(
    count,
    [
      { key: "me", def: printing(MINISTRY), owner: P1, zone: "play" },
      ...seats.map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, strength: 2, life: 4, speed: 2 }), owner: seat, zone: "play" as const })),
      ...res({ greed: ready }, active)
    ],
    { activePlayerId: active, turn: seats.indexOf(active) + 1 }
  );
}

const readyOf = (t: Table, player: PlayerId): number => t.engine.getAvailableResourceCount(player);
const attack = (t: Table, player: PlayerId, target: PlayerId): void =>
  act(t, { type: "declareAttack", playerId: player, attackerIds: [t.id(`c-${player}`)], target: { type: "faction", playerId: target } });

clause(MINISTRY, "0:rule", "3 seats: forming an attacking party costs P2 2 and costs P3 2; P1's own party costs nothing", () => {
  for (const attacker of [P2, P3]) {
    const poor = ministryTable(3, attacker, 1);
    refused(() => attack(poor, attacker, P1), `${attacker} cannot pay 2 with 1 resource`);
    assert.equal(poor.engine.state.battle, undefined);
    const exact = ministryTable(3, attacker, 2);
    attack(exact, attacker, P1);
    assert.ok(exact.engine.state.battle, `${attacker} formed a party`);
    assert.equal(readyOf(exact, attacker), 0, `${attacker} paid 2`);
  }
  const own = table(3, [
    { key: "me", def: printing(MINISTRY), owner: P1, zone: "play" },
    { key: "c-p1", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
    ...res({ greed: 3 }, P1)
  ]);
  attack(own, P1, P2);
  assert.ok(own.engine.state.battle);
  assert.equal(readyOf(own, P1), 3, "the controller pays nothing");
});

clause(MINISTRY, "0:rule", "4 seats: P2, P3 and P4 each pay 2 to form an attacking party; P1 pays nothing", () => {
  for (const attacker of [P2, P3, P4]) {
    const poor = ministryTable(4, attacker, 1);
    refused(() => attack(poor, attacker, P1), `${attacker} cannot pay 2 with 1 resource`);
    const rich = ministryTable(4, attacker, 3);
    attack(rich, attacker, P1);
    assert.ok(rich.engine.state.battle);
    assert.equal(readyOf(rich, attacker), 1, `${attacker} paid exactly 2`);
  }
});
