// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 2 (Twisted Marionette, Voidal Bask, Wasted Wickedness, Zenobian
// Mechanics Explained, Lockbox of the Aeons, Foreclosure Overseer, Yenassa Shipping LLP, Candy Skull Commander).
import assert from "node:assert/strict";
import { autoResolveBattle, bank, character, item, tactic } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { declareAttackBy } from "../_battle.js";
import { clause, drain, printing, refused } from "../_clause.js";
import { P1, P2, P3, P4, act, choose, choosePlayer, handOf, hasKey, mayPay, offered, pending, play, playerAsk, ready, seated, table, type Table } from "./_ungodly-mess.js";
import type { PlayerId } from "../../../../engine.js";

const MARIONETTE = "f78f043a-1c35-49ae-939f-3e0efabdd810"; // Twisted Marionette
const BASK = "a750d103-edca-4c5d-8724-e289ed80463e"; // Voidal Bask
const WASTED = "feb21afe-1749-4041-b5b0-0586c4bc4964"; // Wasted Wickedness
const ZENOBIAN = "e1c896c0-6e2b-46af-9dbb-008146423145"; // Zenobian Mechanics Explained
const LOCKBOX = "2475968c-7bb5-43c1-8225-1bf9d8fdc059"; // Lockbox of the Aeons
const LOCKBOX2 = "0049c804-79a6-4981-85fe-3137949e3970"; // Lockbox of the Aeons (2nd printing)
const FORECLOSURE = "d56e0e61-ff37-4424-b089-83d879c37d98"; // Foreclosure Overseer
const YENASSA = "453a6b4d-a4c3-46f7-a9cc-9e043cde9f50"; // Yenassa Shipping, LLP
const YENASSA2 = "684d5f70-bf07-4b3a-95bc-c06c4aa11c81"; // Yenassa Shipping, LLP (2nd printing)
const SKULL = "4897e844-426b-4333-bc8b-3377d4ff6339"; // Candy Skull Commander

/** A tactic that destroys the card in play named `name`. */
const smash = (name: string) =>
  tactic({
    name: `Smash ${name}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", name }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  } as never);

/** A tactic that puts a target card of `zone` into its owner's hand. */
const mover = (zone: string) =>
  tactic({
    name: `Mover ${zone}`,
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  } as never);

/** A tactic that does nothing (a response to play, or a card to be refused). */
const idle = (name: string) => tactic({ name, cost: 0 });

const chars = (owner: PlayerId, names: string[], seats: number) =>
  seated(owner, seats) ? names.map(name => ({ key: `${name}`, def: character({ name }), owner })) : [];

// ===================================================================================================================
// Twisted Marionette
// When this card inflicts battle damage to a faction, you may pay 1. If you do, that faction's controller puts a character
// they control into its owner's hand.
// ===================================================================================================================

function marionetteTable(seats: number) {
  return table(seats, [
    { key: "tm", def: printing(MARIONETTE), owner: P1 },
    ...bank("rage", 3, P1),
    ...chars(P2, ["P2 a", "P2 b"], seats),
    ...chars(P3, ["P3 a", "P3 b"], seats),
    ...chars(P4, ["P4 a"], seats)
  ]);
}
/** P1's Marionette attacks `target`'s faction unblocked; the battle stops at the "you may pay 1" prompt. */
function marionetteHits(t: Table, target: PlayerId): void {
  declareAttackBy(t.engine, P1, [t.id("tm")], { type: "faction", playerId: target });
  t.engine.perform({ type: "declareBlockers", playerId: target, blockerIds: [] } as never);
  autoResolveBattle(t.engine);
}

clause(MARIONETTE, "0:rule", "3 seats: the damaged faction's controller (not the other opponent) puts one of their own characters into hand; no opponent is chosen", () => {
  const t = marionetteTable(3);
  marionetteHits(t, P3);
  assert.equal(pending(t)!.kind, "mayPay");
  assert.equal(pending(t)!.playerId, P1, "the Marionette's controller may pay 1");
  mayPay(t, true);
  assert.equal(ready(t.engine, P1), 2, "1 is paid");
  const pc = pending(t)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P3, "P3, the damaged faction's controller (not P2, not P1), chooses");
  assert.ok(hasKey(t, offered(t), ["P3 a", "P3 b"]) && offered(t).length === 2, "only P3's characters are candidates");
  refused(() => choose(t, [t.id("P2 a")]), "a character of P2, who was not damaged");
  choose(t, [t.id("P3 b")]);
  assert.equal(zoneOf(t.engine, t.id("P3 b")), "hand");
  assert.equal(zoneOf(t.engine, t.id("P3 a")), "play");
  assert.equal(zoneOf(t.engine, t.id("P2 a")), "play", "P2's characters stay");
  assert.equal(zoneOf(t.engine, t.id("P2 b")), "play");

  const second = marionetteTable(3);
  marionetteHits(second, P2);
  mayPay(second, true);
  assert.equal(pending(second)!.playerId, P2, "attacking P2's faction: P2 is the one asked");
  assert.ok(offered(second).every(id => [second.id("P2 a"), second.id("P2 b")].includes(id)));
  choose(second, [second.id("P2 a")]);
  assert.equal(zoneOf(second.engine, second.id("P2 a")), "hand");
  assert.equal(zoneOf(second.engine, second.id("P3 a")), "play");

  const declined = marionetteTable(3);
  marionetteHits(declined, P3);
  mayPay(declined, false);
  assert.equal(pending(declined), undefined, "declining the payment: nothing happens");
  assert.equal(ready(declined.engine, P1), 3);
  assert.equal(zoneOf(declined.engine, declined.id("P3 a")), "play");
});

clause(MARIONETTE, "0:rule", "4 seats: attacking P4's faction asks only P4, from P4's characters", () => {
  const t = marionetteTable(4);
  marionetteHits(t, P4);
  mayPay(t, true);
  assert.equal(pending(t)!.playerId, P4);
  assert.deepEqual(offered(t), [t.id("P4 a")]);
  choose(t, [t.id("P4 a")]);
  for (const key of ["P2 a", "P2 b", "P3 a", "P3 b"]) assert.equal(zoneOf(t.engine, t.id(key)), "play");
});

// ===================================================================================================================
// Voidal Bask
// When this card leaves play, look at an opponent's hand and chose a card in it. That player discards that card.
// ===================================================================================================================

function baskTable(seats: number) {
  const hand = (owner: PlayerId, n: number) => (seated(owner, seats) ? Array.from({ length: n }, (_, i) => ({ key: `h-${owner}-${i}`, def: character({ name: `Card ${owner} ${i}` }), owner, zone: "hand" as const })) : []);
  return table(seats, [
    { key: "bask", def: printing(BASK), owner: P1 },
    { key: "smash", def: smash("Voidal Bask"), owner: P1, zone: "hand" },
    ...hand(P1, 2),
    ...hand(P2, 2),
    ...hand(P3, 2),
    ...hand(P4, 2)
  ]);
}

clause(BASK, "0:rule", "3 seats: the controller is offered P2 and P3, sees only the chosen opponent's hand, and that player discards the chosen card", () => {
  const t = baskTable(3);
  play(t, P1, "smash", { selected: { t: [t.id("bask")] } });
  assert.equal(zoneOf(t.engine, t.id("bask")), "discard");
  const ask = pending(t)!;
  assert.equal(ask.kind, "choosePlayer");
  assert.equal(ask.playerId, P1, "the controller chooses which opponent");
  assert.deepEqual(ask.candidates, [P2, P3]);
  choosePlayer(t, P3);
  const pick = pending(t)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1, "the controller chooses the card");
  assert.deepEqual([...offered(t)].sort(), [t.id("h-p3-0"), t.id("h-p3-1")].sort(), "only P3's hand is looked at: not P2's, not P1's");
  refused(() => choose(t, [t.id("h-p2-0")]), "a card in the hand of the other opponent");
  choose(t, [t.id("h-p3-1")]);
  assert.equal(zoneOf(t.engine, t.id("h-p3-1")), "discard", "P3 discards that card");
  assert.equal(handOf(t.engine, P3).length, 1);
  assert.equal(handOf(t.engine, P2).length, 2, "P2's hand is unchanged");

  const second = baskTable(3);
  play(second, P1, "smash", { selected: { t: [second.id("bask")] } });
  choosePlayer(second, P2);
  assert.deepEqual([...offered(second)].sort(), [second.id("h-p2-0"), second.id("h-p2-1")].sort());
  choose(second, [second.id("h-p2-0")]);
  assert.equal(handOf(second.engine, P2).length, 1);
  assert.equal(handOf(second.engine, P3).length, 2);

  const two = baskTable(2);
  play(two, P1, "smash", { selected: { t: [two.id("bask")] } });
  assert.equal(pending(two)!.kind, "chooserSelectsTarget", "one opponent left: nobody is asked which");
  assert.deepEqual([...offered(two)].sort(), [two.id("h-p2-0"), two.id("h-p2-1")].sort());
});

clause(BASK, "0:rule", "4 seats: the choice offers P2, P3 and P4 and only the chosen opponent's hand is offered", () => {
  const t = baskTable(4);
  play(t, P1, "smash", { selected: { t: [t.id("bask")] } });
  assert.deepEqual(pending(t)!.candidates, [P2, P3, P4]);
  choosePlayer(t, P4);
  assert.deepEqual([...offered(t)].sort(), [t.id("h-p4-0"), t.id("h-p4-1")].sort());
});

// ===================================================================================================================
// Wasted Wickedness
// EXTRA COST: Pick a player. X is the number of different staple resources that player controls. Pay X+X.
// -- That player puts X non-resource cards they control into their owners' hands.
// The first mode picks an opponent, the second yourself (the frozen two-player play uses `mode`).
// ===================================================================================================================

function wastedTable(seats: number) {
  return table(seats, [
    { key: "ww", def: printing(WASTED), owner: P1, zone: "hand" },
    // P1 controls 3 different staple types (and 8 resources to pay with), P2 two, P3 one.
    ...bank("obsession", 4, P1),
    ...bank("rage", 2, P1),
    ...bank("greed", 2, P1),
    ...bank("rage", 2, P2),
    ...bank("greed", 1, P2),
    ...(seated(P3, seats) ? bank("rage", 1, P3) : []),
    { key: "m1", def: character({ name: "M1" }), owner: P1 },
    { key: "m2", def: character({ name: "M2" }), owner: P1 },
    { key: "m3", def: character({ name: "M3" }), owner: P1 },
    { key: "a1", def: character({ name: "A1" }), owner: P2 },
    { key: "a2", def: character({ name: "A2" }), owner: P2 },
    ...chars(P3, ["b1", "b2"], seats)
  ]);
}
const wastedAction = (t: Table, mode: number, picked?: PlayerId) => ({ type: "playCard", playerId: P1, cardId: t.id("ww"), selected: {}, variables: {}, mode, ...(picked ? { players: { picked } } : {}) });

clause(WASTED, ["0:extraCost", "1:rule"], "3 seats: Pick a player offers every player: an opponent (P2 or P3, asked once) or yourself; X, the payment and the returned cards are the picked player's", () => {
  const t = wastedTable(3);
  assert.deepEqual(playerAsk(t, wastedAction(t, 0)), { id: "picked", candidates: [P2, P3] }, "picking an opponent offers both opponents, never P1");
  assert.equal(playerAsk(t, wastedAction(t, 1)), undefined, "picking yourself asks for no opponent");
  refused(() => t.engine.perform(wastedAction(t, 0, P1) as never), "yourself through the opponent pick");

  // Picking P3: X = 1, pay 2; P3 puts 1 non-resource card it controls into its owner's hand.
  act(t, wastedAction(t, 0, P3));
  assert.equal(ready(t.engine, P1), 8 - 2, "X = 1 (P3's one staple type): X + X = 2 is paid");
  assert.equal(pending(t)!.playerId, P3, "the picked player chooses the cards");
  assert.deepEqual([...offered(t)].sort(), [t.id("b1"), t.id("b2")].sort(), "only P3's non-resource, non-faction cards");
  refused(() => choose(t, [t.id("a1")]), "a card of P2");
  choose(t, [t.id("b2")]);
  assert.equal(zoneOf(t.engine, t.id("b2")), "hand");
  assert.equal(zoneOf(t.engine, t.id("b1")), "play");
  assert.equal(zoneOf(t.engine, t.id("a1")), "play", "P2's cards are unchanged");

  // Picking P2: X = 2, pay 4; P2 chooses 2 cards.
  const second = wastedTable(3);
  act(second, wastedAction(second, 0, P2));
  assert.equal(ready(second.engine, P1), 8 - 4, "X = 2 (P2's two staple types): 4 is paid");
  assert.equal(pending(second)!.playerId, P2);
  assert.deepEqual([...offered(second)].sort(), [second.id("a1"), second.id("a2")].sort());
  choose(second, [second.id("a1"), second.id("a2")]);
  assert.equal(zoneOf(second.engine, second.id("a1")), "hand");
  assert.equal(zoneOf(second.engine, second.id("b1")), "play");

  // Picking yourself: X = 3, pay 6; P1 chooses 3 of its own cards.
  const mine = wastedTable(3);
  act(mine, wastedAction(mine, 1));
  assert.equal(ready(mine.engine, P1), 8 - 6, "X = 3 (P1's own staples): 6 is paid");
  assert.equal(pending(mine)!.playerId, P1);
  assert.deepEqual([...offered(mine)].sort(), [mine.id("m1"), mine.id("m2"), mine.id("m3")].sort());
  choose(mine, [mine.id("m1"), mine.id("m2"), mine.id("m3")]);
  assert.equal(zoneOf(mine.engine, mine.id("m1")), "hand");
  assert.equal(zoneOf(mine.engine, mine.id("a1")), "play");

  const two = wastedTable(2);
  assert.equal(playerAsk(two, wastedAction(two, 0)), undefined, "one opponent left: nobody is asked which");
});

clause(WASTED, ["0:extraCost", "1:rule"], "4 seats: picking an opponent offers P2, P3 and P4 and affects only the picked one", () => {
  const t = wastedTable(4);
  assert.deepEqual(playerAsk(t, wastedAction(t, 0)), { id: "picked", candidates: [P2, P3, P4] });
});

// ===================================================================================================================
// Zenobian Mechanics Explained
// EXTRA COST: Choose a character an opponent controls. -- Put the character into its owner's hand.
// ===================================================================================================================

function zenobianTable(seats: number) {
  return table(seats, [
    { key: "zme", def: printing(ZENOBIAN), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "mine", def: character({ name: "Mine" }), owner: P1 },
    { key: "c2", def: character({ name: "C2" }), owner: P2 },
    ...chars(P3, ["c3"], seats),
    ...chars(P4, ["c4"], seats)
  ]);
}
const zenobianAction = (t: Table, key: string) => ({ type: "playCard", playerId: P1, cardId: t.id("zme"), selected: { c: [t.id(key)] }, variables: {} });

clause(ZENOBIAN, "0:extraCost", "3 seats: the character of either opponent is a legal pick, your own is not, and no opponent is chosen", () => {
  const t = zenobianTable(3);
  assert.equal(playerAsk(t, zenobianAction(t, "c2")), undefined, "no opponent is asked for");
  refused(() => t.engine.perform(zenobianAction(t, "mine") as never), "my own character");
  assert.equal(zoneOf(t.engine, t.id("zme")), "hand");
  act(t, zenobianAction(t, "c2"));
  assert.equal(zoneOf(t.engine, t.id("c2")), "hand", "P2's character returns to its owner's hand");
  assert.equal(zoneOf(t.engine, t.id("c3")), "play", "P3's character is untouched");
  const second = zenobianTable(3);
  act(second, zenobianAction(second, "c3"));
  assert.equal(zoneOf(second.engine, second.id("c3")), "hand", "P3's character is a legal pick too");
  assert.equal(zoneOf(second.engine, second.id("c2")), "play");
});

clause(ZENOBIAN, "0:extraCost", "4 seats: P4's character is a legal pick as well", () => {
  const t = zenobianTable(4);
  act(t, zenobianAction(t, "c4"));
  assert.equal(zoneOf(t.engine, t.id("c4")), "hand");
  for (const key of ["c2", "c3"]) assert.equal(zoneOf(t.engine, t.id(key)), "play");
});

// ===================================================================================================================
// Lockbox of the Aeons
// Your opponents cannot use FLIP UP and cards cannot be put into your opponents' hands from the void, discard pile or play
// ===================================================================================================================

const flippable = () =>
  tactic({ name: "FT", cost: 3, flipUp: { cost: 1, threshold: "r" } as never, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);

/** Lockbox in play for P1 (when `lockbox`), a face-down flippable card and 3 resources per seat, and a card of each owner in each zone to move. */
function lockTable(seats: number, id: string, o: { lockbox?: boolean; active?: PlayerId } = {}) {
  const cards = [];
  for (const owner of [P1, P2, P3, P4].slice(0, seats)) {
    cards.push(
      { key: `ft-${owner}`, def: flippable(), owner, zone: "play" as const, faceDown: true },
      ...bank("rage", 3, owner),
      { key: `play-${owner}`, def: character({ name: `InPlay ${owner}` }), owner },
      { key: `disc-${owner}`, def: character({ name: `InDiscard ${owner}` }), owner, zone: "discard" as const },
      { key: `void-${owner}`, def: character({ name: `InVoid ${owner}` }), owner, zone: "void" as const },
      { key: `dk-${owner}`, def: character({ name: `InDeck ${owner}` }), owner, zone: "deck" as const }
    );
  }
  return table(
    seats,
    [
      ...(o.lockbox === false ? [] : [{ key: "lb", def: printing(id), owner: P1, zone: "play" as const }]),
      { key: "mvPlay", def: mover("play"), owner: P1, zone: "hand" },
      { key: "mvDisc", def: mover("discard"), owner: P1, zone: "hand" },
      { key: "mvVoid", def: mover("void"), owner: P1, zone: "hand" },
      { key: "smash", def: smash("Lockbox of the Aeons"), owner: P1, zone: "hand" },
      ...[P2, P3, P4].slice(0, seats - 1).map(who => ({ key: `mvD-${who}`, def: mover("discard"), owner: P1, zone: "hand" as const })),
      ...cards
    ],
    o.active ?? P1
  );
}
const flip = (t: Table, who: PlayerId) => act(t, { type: "flipUp", playerId: who, cardId: t.id(`ft-${who}`), selected: {}, variables: {} });
const moveBack = (t: Table, mover: string, owner: PlayerId, zone: "play" | "disc" | "void") => play(t, P1, mover, { selected: { t: [t.id(`${zone}-${owner}`)] } });
const MOVES = [["mvPlay", "play", "play"], ["mvDisc", "disc", "discard"], ["mvVoid", "void", "void"]] as const;

function lockFor(seats: number, id: string) {
  const opponents = [P2, P3, P4].slice(0, seats - 1);
  // Every opponent: FLIP UP refused, cards cannot be put into their hands; the controller is unaffected.
  for (const who of opponents) {
    const t = lockTable(seats, id, { active: who });
    const readyBefore = ready(t.engine, who);
    refused(() => flip(t, who), `${who}'s FLIP UP under P1's Lockbox`, /cannot play cards using FLIP UP right now/);
    assert.equal(t.engine.state.cards[t.id(`ft-${who}`)]!.faceDown, true);
    assert.equal(ready(t.engine, who), readyBefore, "nothing paid");
  }
  const mine = lockTable(seats, id);
  flip(mine, P1);
  assert.equal(zoneOf(mine.engine, mine.id("ft-p1")), "discard", "P1's own FLIP UP is unaffected");
  for (const [mv, zone, name] of MOVES) {
    for (const who of opponents) {
      const t = lockTable(seats, id);
      moveBack(t, mv, who, zone);
      assert.equal(zoneOf(t.engine, t.id(`${zone}-${who}`)), name, `${who}'s card cannot be put into ${who}'s hand from ${name}`);
      assert.equal(handOf(t.engine, who).includes(t.id(`${zone}-${who}`)), false);
    }
    const own = lockTable(seats, id);
    moveBack(own, mv, P1, zone);
    assert.equal(zoneOf(own.engine, own.id(`${zone}-p1`)), "hand", `P1's own card still returns from ${name}`);
    const free = lockTable(seats, id, { lockbox: false });
    moveBack(free, mv, P2, zone);
    assert.equal(zoneOf(free.engine, free.id(`${zone}-p2`)), "hand", "control: without the Lockbox it returns");
  }
  // When P1 stops controlling the Lockbox all of it works again, for every opponent.
  const gone = lockTable(seats, id);
  play(gone, P1, "smash", { selected: { t: [gone.id("lb")] } });
  assert.equal(zoneOf(gone.engine, gone.id("lb")), "discard");
  for (const who of opponents) moveBack(gone, `mvD-${who}`, who, "disc");
  for (const who of opponents) assert.equal(zoneOf(gone.engine, gone.id(`disc-${who}`)), "hand", `${who}: off after the Lockbox leaves play`);
  const flipAgain = lockTable(seats, id, { lockbox: false, active: P3 });
  flip(flipAgain, P3);
  assert.equal(zoneOf(flipAgain.engine, flipAgain.id("ft-p3")), "discard");
}
clause(LOCKBOX, "0:rule", "3 seats: both opponents cannot FLIP UP and no card can be put into either opponent's hand; P1 is unaffected; it ends when the Lockbox leaves", () => lockFor(3, LOCKBOX));
clause(LOCKBOX2, "0:rule", "3 seats (2nd printing): both opponents cannot FLIP UP and no card can be put into either opponent's hand; P1 is unaffected", () => lockFor(3, LOCKBOX2));
clause(LOCKBOX, "0:rule", "4 seats: P2, P3 and P4 are all locked out; P1 is unaffected", () => lockFor(4, LOCKBOX));

// ===================================================================================================================
// Foreclosure Overseer
// While this card is depleted, your opponents must pay 1 to deploy cards.
// ===================================================================================================================

/** P1 deploys the Overseer from hand (so its text starts applying), depletes it unless `ready`, and the turn passes to `active`. */
function foreclosureTable(seats: number, o: { ready?: boolean; active?: PlayerId } = {}) {
  const per = (owner: PlayerId) =>
    seated(owner, seats)
      ? [{ key: `hand-${owner}`, def: character({ name: `Deploy ${owner}`, cost: 1 }), owner, zone: "hand" as const }, ...bank("rage", 2, owner)]
      : [];
  const t = table(seats, [{ key: "fo", def: printing(FORECLOSURE), owner: P1, zone: "hand" }, ...bank("greed", 4, P1), ...per(P1), ...per(P2), ...per(P3), ...per(P4)]);
  play(t, P1, "fo");
  return t;
}
/** Hands the turn to `active` with the Overseer depleted (or not). */
function foreclosureTurn(t: Table, active: PlayerId, depleted: boolean): void {
  t.engine.state.cards[t.id("fo")]!.depleted = depleted;
  t.engine.state.activePlayerId = active;
  t.engine.state.priorityPlayerId = active;
}

for (const [seats, who] of [[3, P2], [3, P3], [4, P4]] as const)
  clause(FORECLOSURE, "0:rule", `${seats} seats: while depleted, ${who} pays 1 more to deploy a cost 1 card (2 in all), as does every other opponent; P1 pays nothing extra; nobody is asked which opponent`, () => {
    const taxed = foreclosureTable(seats);
    assert.equal(pending(taxed), undefined, "\"your opponents\" is every opponent: no opponent is chosen");
    foreclosureTurn(taxed, who, true);
    const before = ready(taxed.engine, who);
    play(taxed, who, `hand-${who}`);
    assert.equal(zoneOf(taxed.engine, taxed.id(`hand-${who}`)), "play");
    assert.equal(before - ready(taxed.engine, who), 2, `${who} paid the printed 1 plus 1 more`);
    const mine = foreclosureTable(seats);
    foreclosureTurn(mine, P1, true);
    const mineBefore = ready(mine.engine, P1);
    play(mine, P1, "hand-p1");
    assert.equal(mineBefore - ready(mine.engine, P1), 1, "P1's own deployment costs no extra");
    const untaxed = foreclosureTable(seats);
    foreclosureTurn(untaxed, who, false);
    const untaxedBefore = ready(untaxed.engine, who);
    play(untaxed, who, `hand-${who}`);
    assert.equal(untaxedBefore - ready(untaxed.engine, who), 1, "a ready Overseer taxes nobody");
  });

// ===================================================================================================================
// Yenassa Shipping, LLP
// This card gains 2 strength and 2 life for each item your opponents control.
// ===================================================================================================================

function yenassaTable(seats: number, id: string, items: { p1: number; p2: number; p3: number; p4: number }) {
  const itemsOf = (owner: PlayerId, n: number) => (seated(owner, seats) ? Array.from({ length: n }, (_, i) => ({ key: `item-${owner}-${i}`, def: item({ name: `Item ${owner} ${i}` }), owner })) : []);
  return table(seats, [{ key: "y", def: printing(id), owner: P1 }, ...itemsOf(P1, items.p1), ...itemsOf(P2, items.p2), ...itemsOf(P3, items.p3), ...itemsOf(P4, items.p4)]);
}
const yenassaStats = (t: Table) => [t.engine.getStat(t.id("y"), "strength"), t.engine.getStat(t.id("y"), "life")];

function yenassaCounts(id: string) {
  const base = printing(id);
  const bonus = (t: Table) => yenassaStats(t).map((value, i) => value - (i === 0 ? base.strength! : base.life!));
  assert.deepEqual(bonus(yenassaTable(3, id, { p1: 0, p2: 0, p3: 0, p4: 0 })), [0, 0]);
  assert.deepEqual(bonus(yenassaTable(3, id, { p1: 1, p2: 1, p3: 2, p4: 0 })), [6, 6], "P2's 1 and P3's 2 items are counted together; P1's own item is not");
  assert.deepEqual(bonus(yenassaTable(3, id, { p1: 1, p2: 1, p3: 1, p4: 0 })), [4, 4], "when P3 loses an item it becomes +4 / +4");
  assert.deepEqual(bonus(yenassaTable(3, id, { p1: 5, p2: 1, p3: 2, p4: 0 })), [6, 6], "P1 gaining items changes nothing");
  assert.deepEqual(bonus(yenassaTable(3, id, { p1: 0, p2: 0, p3: 2, p4: 0 })), [4, 4], "one opponent's items count on their own");
  assert.deepEqual(bonus(yenassaTable(2, id, { p1: 0, p2: 2, p3: 0, p4: 0 })), [4, 4], "two seats: the one opponent's items");
}
clause(YENASSA, "1:rule", "3 seats: counts the items of every opponent together (+2/+2 each), not P1's own", () => yenassaCounts(YENASSA));
clause(YENASSA2, "1:rule", "3 seats (2nd printing): counts the items of every opponent together (+2/+2 each), not P1's own", () => yenassaCounts(YENASSA2));
clause(YENASSA, "1:rule", "4 seats: the items of P2, P3 and P4 are all counted", () => {
  const base = printing(YENASSA);
  const t = yenassaTable(4, YENASSA, { p1: 2, p2: 1, p3: 2, p4: 3 });
  assert.deepEqual(yenassaStats(t), [base.strength! + 12, base.life! + 12], "6 items of P2, P3 and P4: +12 / +12");
});

// ===================================================================================================================
// Candy Skull Commander
// Whenever an opponent forms an attacking party, you may pay 2. If you do, you may flip a coin. If you win the flip, all of
// your characters gain 1 speed this turn.
// ===================================================================================================================

function skullTable(seats: number, active: PlayerId) {
  const attacker = (owner: PlayerId) => (seated(owner, seats) ? [{ key: `atk-${owner}`, def: character({ name: `Attacker ${owner}`, strength: 1, life: 5, speed: 2 }), owner }] : []);
  return table(
    seats,
    [
      { key: "s", def: printing(SKULL), owner: P1 },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 2 }), owner: P1 },
      ...attacker(P1),
      ...attacker(P2),
      ...attacker(P3),
      ...attacker(P4),
      ...bank("rage", 3, P1)
    ],
    active,
    () => 0
  );
}
const speedOf = (t: Table, key: string) => t.engine.getStat(t.id(key), "speed");
const flips = (t: Table) => t.engine.getLog().filter(entry => (entry.event as { type?: string } | undefined)?.type === "coinFlipped").length;
const attacks = (t: Table, who: PlayerId, target: PlayerId) =>
  t.engine.perform({ type: "declareAttack", playerId: who, attackerIds: [t.id(`atk-${who}`)], target: { type: "faction", playerId: target } } as never);
const payAndFlip = (t: Table) => drain(t.engine, (pc: { kind: string }) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : { kind: pc.kind }));

clause(SKULL, "0:rule", "3 seats: any opponent forming an attacking party fires it, wherever it is aimed; P1's own attack does not", () => {
  // P2 attacks P3's faction: P1 is not the defender.
  const a = skullTable(3, P2);
  attacks(a, P2, P3);
  assert.equal(pending(a)!.kind, "mayPay", "the trigger fires for P1");
  assert.equal(pending(a)!.playerId, P1);
  payAndFlip(a);
  assert.equal(ready(a.engine, P1), 1, "P1 paid 2");
  assert.equal(flips(a), 1);
  assert.equal(speedOf(a, "s"), 4);
  assert.equal(speedOf(a, "ally"), 3, "all of P1's characters gain 1 speed");
  assert.equal(speedOf(a, "atk-p2"), 2, "no one else does");
  assert.equal(speedOf(a, "atk-p3"), 2);
  // P3 attacks P2's faction.
  const b = skullTable(3, P3);
  attacks(b, P3, P2);
  assert.equal(pending(b)?.kind, "mayPay");
  payAndFlip(b);
  assert.equal(speedOf(b, "ally"), 3);
  // P2 attacks P1's faction (P1 is the defender).
  const c = skullTable(3, P2);
  attacks(c, P2, P1);
  assert.equal(pending(c)?.kind, "mayPay");
  payAndFlip(c);
  assert.equal(speedOf(c, "ally"), 3);
  // P1's own attack: it does not fire.
  const own = skullTable(3, P1);
  attacks(own, P1, P2);
  assert.equal(pending(own), undefined);
  assert.equal(flips(own), 0);
  assert.equal(ready(own.engine, P1), 3);
  assert.equal(speedOf(own, "ally"), 2);
  // Declining to pay does nothing.
  const declined = skullTable(3, P2);
  attacks(declined, P2, P3);
  mayPay(declined, false);
  assert.equal(pending(declined), undefined);
  assert.equal(ready(declined.engine, P1), 3);
  assert.equal(flips(declined), 0);
  assert.equal(speedOf(declined, "ally"), 2);
});

clause(SKULL, "0:rule", "4 seats: an attack by P4 (aimed at P3) fires it as well", () => {
  const t = skullTable(4, P4);
  attacks(t, P4, P3);
  assert.equal(pending(t)?.kind, "mayPay");
  payAndFlip(t);
  assert.equal(speedOf(t, "ally"), 3);
  assert.equal(ready(t.engine, P1), 1);
});
