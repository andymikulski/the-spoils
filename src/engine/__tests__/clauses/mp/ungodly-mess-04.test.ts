// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 4 (Big McLargehuge, Corrosive Waste Dispenser, Geldale City-Fortress,
// Gor-blach the Endowed, Thabbashite Weapons Expert, Brainbath).
import assert from "node:assert/strict";
import { bank, character, item, resolvePendingResponses, tactic, volition } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { mpClause, printing, refused } from "../_clause.js";
import { P1, P2, P3, P4, act, activate, answerChoice, choose, chooseIndex, choosePlayer, handOf, influence, mayPay, offered, pass, pending, play, playRaw, seated, table, type Table } from "./_ungodly-mess.js";
import type { PlayerId } from "../../../../engine.js";

const BIG = "9f159c52-0b48-4661-b3cd-9269e4bad55d"; // Big McLargehuge
const CORROSIVE = "083e0cca-f86f-4922-9bf5-04d254ebfc4e"; // Corrosive Waste Dispenser
const GELDALE = "f4ab5680-e5ab-47b1-bf3d-953d54adc79b"; // Geldale, City-Fortress
const GOR = "c257a1c0-f7f4-4bfc-a82a-5b63999808d0"; // Gor-blach the Endowed
const WEAPONS = "e8cd0ae5-9aba-4996-8a29-3f160b2d96f2"; // Thabbashite Weapons Expert
const BRAINBATH = "2bf6045a-5b3f-4189-ae91-28837c0d7b83"; // Brainbath

const smash = (name: string) =>
  tactic({
    name: `Smash ${name}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", name }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  } as never);

// ===================================================================================================================
// Big McLargehuge
// When this card leaves play, you may play a resource or pick an opponent and that player destroys a face-down resource they
// control.
// ===================================================================================================================

function bigTable(seats: number) {
  return table(seats, [
    { key: "big", def: printing(BIG), owner: P1 },
    { key: "smash", def: smash("Big McLargehuge"), owner: P1, zone: "hand" },
    { key: "handres", def: character({ name: "Hand card" }), owner: P1, zone: "hand" },
    ...volition(2, P2),
    ...(seated(P3, seats) ? volition(2, P3) : []),
    ...(seated(P4, seats) ? volition(2, P4) : [])
  ]);
}
const faceDownOf = (t: Table, who: PlayerId): string[] =>
  Object.values(t.engine.state.cards)
    .filter(card => card.zone === "play" && card.faceDown && card.controllerId === who)
    .map(card => card.id);

mpClause(BIG, "2:rule", 3, "3 seats: choosing the opponent option asks which opponent (P2 or P3); only that player destroys one of their own face-down resources", () => {
  const t = bigTable(3);
  const p2 = faceDownOf(t, P2);
  const p3 = faceDownOf(t, P3);
  play(t, P1, "smash", { selected: { t: [t.id("big")] } });
  assert.equal(zoneOf(t.engine, t.id("big")), "discard");
  assert.equal(pending(t)!.kind, "chooserSelectsOption");
  assert.equal(pending(t)!.playerId, P1);
  chooseIndex(t, 1);
  const ask = pending(t)!;
  assert.equal(ask.kind, "choosePlayer");
  assert.equal(ask.playerId, P1);
  assert.deepEqual(ask.candidates, [P2, P3]);
  choosePlayer(t, P3);
  assert.equal(pending(t)!.kind, "chooserSelectsTarget");
  assert.equal(pending(t)!.playerId, P3, "the picked opponent (not P2) destroys");
  assert.deepEqual([...offered(t)].sort(), [...p3].sort(), "only P3's face-down resources");
  refused(() => choose(t, [p2[0]!]), "a face-down resource of P2");
  choose(t, [p3[0]!]);
  assert.notEqual(zoneOf(t.engine, p3[0]!), "play");
  assert.equal(zoneOf(t.engine, p3[1]!), "play");
  assert.deepEqual(faceDownOf(t, P2).sort(), [...p2].sort(), "P2's resources are unchanged");

  const second = bigTable(3);
  play(second, P1, "smash", { selected: { t: [second.id("big")] } });
  chooseIndex(second, 1);
  choosePlayer(second, P2);
  assert.equal(pending(second)!.playerId, P2);
  choose(second, [faceDownOf(second, P2)[0]!]);
  assert.equal(faceDownOf(second, P2).length, 1);
  assert.equal(faceDownOf(second, P3).length, 2, "P3 is not affected");

  const resource = bigTable(3);
  play(resource, P1, "smash", { selected: { t: [resource.id("big")] } });
  chooseIndex(resource, 0);
  assert.equal(pending(resource)!.kind, "chooserSelectsTarget", "the other option offers no opponent pick");
  assert.equal(pending(resource)!.playerId, P1);

  const two = bigTable(2);
  play(two, P1, "smash", { selected: { t: [two.id("big")] } });
  chooseIndex(two, 1);
  assert.equal(pending(two)!.kind, "chooserSelectsTarget", "one opponent left: nobody is asked which");
  assert.equal(pending(two)!.playerId, P2);
});

mpClause(BIG, "2:rule", 4, "4 seats: the opponent pick offers P2, P3 and P4", () => {
  const t = bigTable(4);
  play(t, P1, "smash", { selected: { t: [t.id("big")] } });
  chooseIndex(t, 1);
  assert.deepEqual(pending(t)!.candidates, [P2, P3, P4]);
  choosePlayer(t, P4);
  assert.equal(pending(t)!.playerId, P4);
  assert.deepEqual([...offered(t)].sort(), [...faceDownOf(t, P4)].sort());
});

// ===================================================================================================================
// Corrosive Waste Dispenser
// CONVERT -- COST: Remove a token from this card. Destroy a non-"micromajig" character you control. -- EFFECT: Each opponent
// destroys a character they control.
// ===================================================================================================================

function corrosiveTable(seats: number, o: { p3Characters?: boolean } = {}) {
  const chars = (owner: PlayerId, names: string[]) => (seated(owner, seats) ? names.map(name => ({ key: name, def: character({ name }), owner })) : []);
  return table(seats, [
    { key: "cwd", def: printing(CORROSIVE), owner: P1, counters: { token: 4 } },
    ...bank("rage", 2, P1),
    ...chars(P1, ["P1 a", "P1 b"]),
    ...chars(P2, ["P2 a", "P2 b"]),
    ...(o.p3Characters === false ? [] : chars(P3, ["P3 a", "P3 b"])),
    ...chars(P4, ["P4 a", "P4 b"])
  ]);
}
const convert = (t: Table) => activate(t, P1, "cwd", "convert", { selected: { sac: [t.id("P1 a")] } });

mpClause(CORROSIVE, "2:ability:convert", 3, "3 seats: each opponent, P2 then P3, destroys a character they control; each chooses from their own characters only; P1 is asked nothing beyond the cost", () => {
  const t = corrosiveTable(3);
  convert(t);
  assert.equal(zoneOf(t.engine, t.id("P1 a")), "discard", "the cost destroys one of P1's own characters");
  assert.equal(t.engine.state.cards[t.id("cwd")]!.counters?.token, 3);
  assert.equal(pending(t)!.kind, "chooserSelectsTarget");
  assert.equal(pending(t)!.playerId, P2, "P2 decides first (active player, then clockwise)");
  assert.deepEqual([...offered(t)].sort(), [t.id("P2 a"), t.id("P2 b")].sort(), "only P2's characters");
  refused(() => choose(t, [t.id("P3 a")]), "a character of P3 offered to P2");
  choose(t, [t.id("P2 b")]);
  assert.equal(pending(t)!.playerId, P3, "then P3");
  assert.deepEqual([...offered(t)].sort(), [t.id("P3 a"), t.id("P3 b")].sort(), "only P3's characters");
  choose(t, [t.id("P3 a")]);
  assert.equal(pending(t), undefined);
  assert.equal(zoneOf(t.engine, t.id("P2 b")), "discard");
  assert.equal(zoneOf(t.engine, t.id("P3 a")), "discard");
  assert.equal(zoneOf(t.engine, t.id("P2 a")), "play");
  assert.equal(zoneOf(t.engine, t.id("P3 b")), "play");
  assert.equal(zoneOf(t.engine, t.id("P1 b")), "play", "P1's other character is not destroyed");
});

mpClause(CORROSIVE, "2:ability:convert", 3, "3 seats: an opponent with no character destroys nothing and is not asked", () => {
  const t = corrosiveTable(3, { p3Characters: false });
  convert(t);
  assert.equal(pending(t)!.playerId, P2);
  choose(t, [t.id("P2 a")]);
  assert.equal(pending(t), undefined, "P3 has no character: nothing to destroy");
  assert.equal(zoneOf(t.engine, t.id("P2 a")), "discard");
});

mpClause(CORROSIVE, "2:ability:convert", 4, "4 seats: P2, P3 and P4 each destroy a character they control, in that order; P1 does not", () => {
  const t = corrosiveTable(4);
  convert(t);
  for (const who of [P2, P3, P4]) {
    assert.equal(pending(t)!.playerId, who);
    assert.deepEqual([...offered(t)].sort(), [t.id(`P${who[1]} a`), t.id(`P${who[1]} b`)].sort());
    choose(t, [t.id(`P${who[1]} a`)]);
  }
  assert.equal(pending(t), undefined);
  for (const who of ["P2", "P3", "P4"]) {
    assert.equal(zoneOf(t.engine, t.id(`${who} a`)), "discard");
    assert.equal(zoneOf(t.engine, t.id(`${who} b`)), "play");
  }
  assert.equal(zoneOf(t.engine, t.id("P1 b")), "play");
});

// ===================================================================================================================
// Geldale, City-Fortress
// Your opponents may only play tactics during their own turn.
// ===================================================================================================================

function geldaleTable(seats: number, active: PlayerId) {
  const tac = (owner: PlayerId) => (seated(owner, seats) ? [{ key: `tac-${owner}`, def: tactic({ name: `Tactic ${owner}`, cost: 0 }), owner, zone: "hand" as const }] : []);
  return table(seats, [{ key: "g", def: printing(GELDALE), owner: P1 }, ...tac(P1), ...tac(P2), ...tac(P3), ...tac(P4), { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: active, zone: "hand" }], active);
}
const TAC_REFUSAL = /tactic|turn|cannot|only|restrict/i;
const playsTactic = (t: Table, who: PlayerId) => play(t, who, `tac-${who}`);

function geldaleFor(seats: number) {
  const opponents = [P2, P3, P4].slice(0, seats - 1);
  // P1's turn: every opponent is refused in turn as the window passes around; P1's own tactic is fine.
  const mine = geldaleTable(seats, P1);
  playRaw(mine, P1, "bait");
  for (const who of opponents) {
    refused(() => playsTactic(mine, who), `${who}'s tactic during P1's turn`, TAC_REFUSAL);
    assert.equal(zoneOf(mine.engine, mine.id(`tac-${who}`)), "hand");
    pass(mine, who);
  }
  const own = geldaleTable(seats, P1);
  playsTactic(own, P1);
  assert.equal(zoneOf(own.engine, own.id("tac-p1")), "discard", "P1 can play tactics on its own turn");
  // Each opponent's own turn: that opponent may, the other opponents may not, P1 (not restricted) may respond.
  for (const who of opponents) {
    const turn = geldaleTable(seats, who);
    playsTactic(turn, who);
    assert.equal(zoneOf(turn.engine, turn.id(`tac-${who}`)), "discard", `${who} may play tactics during their own turn`);
    const window = geldaleTable(seats, who);
    playRaw(window, who, "bait");
    for (const other of opponents.filter(o => o !== who)) {
      // the priority goes clockwise from the left of the player who played; skip those that do not hold it yet
      while (window.engine.state.responseWindow?.priorityPlayerId !== other && window.engine.state.responseWindow?.priorityPlayerId !== P1) pass(window, window.engine.state.responseWindow!.priorityPlayerId as PlayerId);
      if (window.engine.state.responseWindow?.priorityPlayerId === other) {
        refused(() => playsTactic(window, other), `${other}'s tactic during ${who}'s turn`, TAC_REFUSAL);
        assert.equal(zoneOf(window.engine, window.id(`tac-${other}`)), "hand");
        pass(window, other);
      }
    }
    while (window.engine.state.responseWindow?.priorityPlayerId !== P1) pass(window, window.engine.state.responseWindow!.priorityPlayerId as PlayerId);
    playsTactic(window, P1);
    assert.equal(zoneOf(window.engine, window.id("tac-p1")), "discard", `P1 may respond to ${who}'s play with a tactic`);
  }
}
mpClause(GELDALE, "0:rule", 3, "3 seats: P2 and P3 can each play tactics only during their own turn; P1 is unaffected", () => geldaleFor(3));
mpClause(GELDALE, "0:rule", 4, "4 seats: P2, P3 and P4 can each play tactics only during their own turn; P1 is unaffected", () => geldaleFor(4));

// ===================================================================================================================
// Gor-blach the Endowed
// GET IN THERE: [V][V][V] -- COST: Deplete this card. Pick a blocked character you control. X is its strength. Pay X.
// -- EFFECT: Destroy the character. Inflict X damage to an opponent's faction. Inflict X damage to this card.
// ===================================================================================================================

function gorBlocked(seats: number) {
  const t = table(seats, [
    { key: "gb", def: printing(GOR), owner: P1 },
    { key: "a1", def: character({ name: "A1", strength: 2, life: 9, speed: 3 }), owner: P1 },
    { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 1 }), owner: P2 },
    ...volition(5, P1)
  ]);
  t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("a1")], target: { type: "faction", playerId: P2 } } as never);
  resolvePendingResponses(t.engine);
  t.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [t.id("blk")] } as never);
  return t;
}

mpClause(GOR, "1:ability:get-in-there", 3, "3 seats: the controller chooses which opponent's faction takes X damage (not forced to be the blocking defender); the others take none", () => {
  const t = gorBlocked(3);
  const before = { [P2]: influence(t.engine, P2), [P3]: influence(t.engine, P3), [P1]: influence(t.engine, P1) };
  activate(t, P1, "gb", "get-in-there", { selected: { c: [t.id("a1")] } });
  assert.equal(zoneOf(t.engine, t.id("a1")), "discard", "the character is destroyed first");
  const ask = pending(t)!;
  assert.equal(ask.kind, "choosePlayer");
  assert.equal(ask.playerId, P1);
  assert.deepEqual(ask.candidates, [P2, P3], "the blocking defender P2 is not forced");
  choosePlayer(t, P3);
  assert.equal(influence(t.engine, P3), before[P3]! - 2, "P3's faction takes X = 2 damage");
  assert.equal(influence(t.engine, P2), before[P2], "P2's faction takes none");
  assert.equal(influence(t.engine, P1), before[P1], "P1's own faction takes none");
  assert.equal(t.engine.state.cards[t.id("gb")]!.damage, 2, "Gor-blach takes X damage");

  const second = gorBlocked(3);
  const p2 = influence(second.engine, P2);
  const p3 = influence(second.engine, P3);
  activate(second, P1, "gb", "get-in-there", { selected: { c: [second.id("a1")] } });
  choosePlayer(second, P2);
  assert.equal(influence(second.engine, P2), p2 - 2);
  assert.equal(influence(second.engine, P3), p3);

  const two = gorBlocked(2);
  activate(two, P1, "gb", "get-in-there", { selected: { c: [two.id("a1")] } });
  assert.equal(pending(two), undefined, "one opponent left: nobody is asked");
  assert.equal(two.engine.state.cards[two.id("gb")]!.damage, 2);
});

mpClause(GOR, "1:ability:get-in-there", 4, "4 seats: the choice offers P2, P3 and P4", () => {
  const t = gorBlocked(4);
  const p4 = influence(t.engine, P4);
  activate(t, P1, "gb", "get-in-there", { selected: { c: [t.id("a1")] } });
  assert.deepEqual(pending(t)!.candidates, [P2, P3, P4]);
  choosePlayer(t, P4);
  assert.equal(influence(t.engine, P4), p4 - 2);
  assert.equal(influence(t.engine, P2), influence(t.engine, P3));
});

// ===================================================================================================================
// Thabbashite Weapons Expert
// At the start of your turn, X is this card's strength and you may destroy this character. If you do, inflict X damage to
// each opponent's faction or pick an item with numeric cost X or less and destroy it.
// ===================================================================================================================

function weaponsTable(seats: number) {
  return table(
    seats,
    [
      { key: "we", def: printing(WEAPONS), owner: P1 },
      { key: "i1", def: item({ name: "Item P1", cost: 1 }), owner: P1 },
      { key: "i2", def: item({ name: "Item P2", cost: 2 }), owner: P2 },
      { key: "i3", def: item({ name: "Item P3", cost: 1 }), owner: P3 },
      { key: "dear", def: item({ name: "Dear item", cost: 5 }), owner: P3 }
    ],
    seats === 3 ? P3 : P4
  );
}
/** The turn passes to P1; the trigger stops at "you may destroy this character". */
const startP1Turn = (t: Table, previous: PlayerId): void => {
  act(t, { type: "endTurn", playerId: previous });
  // the turn start queues P1's rules and this trigger together: P1 orders them, the Weapons Expert's first
  while (pending(t)?.kind === "orderTriggers") {
    const triggers = pending(t)!.triggers as Array<{ sourceId?: string }>;
    const next = triggers.find(trigger => trigger.sourceId === t.id("we")) ?? triggers[0];
    answerChoice(t, { kind: "orderTriggers", next });
  }
};

mpClause(WEAPONS, "0:rule", 3, "3 seats: the damage option hits the faction of each opponent (P2 and P3) for X = 2, never P1's", () => {
  const t = weaponsTable(3);
  const before = [P1, P2, P3].map(who => influence(t.engine, who));
  startP1Turn(t, P3);
  assert.equal(pending(t)!.kind, "mayPay");
  assert.equal(pending(t)!.playerId, P1);
  mayPay(t, true);
  assert.equal(zoneOf(t.engine, t.id("we")), "discard", "destroyed");
  assert.equal(pending(t)!.kind, "chooserSelectsOption");
  chooseIndex(t, 0);
  assert.equal(pending(t), undefined, "each opponent is hit without choosing one");
  assert.equal(influence(t.engine, P2), before[1]! - 2);
  assert.equal(influence(t.engine, P3), before[2]! - 2);
  assert.equal(influence(t.engine, P1), before[0], "P1's faction takes none");
});

mpClause(WEAPONS, "0:rule", 3, "3 seats: the other option (an item with cost X or less) offers the items of every player and is not about opponents", () => {
  const t = weaponsTable(3);
  startP1Turn(t, P3);
  mayPay(t, true);
  chooseIndex(t, 1);
  const options = offered(t);
  for (const key of ["i1", "i2", "i3"]) assert.ok(options.includes(t.id(key)), `${key} is a legal pick`);
  assert.ok(!options.includes(t.id("dear")), "cost 5 is more than X = 2");
});

mpClause(WEAPONS, "0:rule", 4, "4 seats: P2's, P3's and P4's factions each take X damage; P1's takes none", () => {
  const t = weaponsTable(4);
  const before = [P1, P2, P3, P4].map(who => influence(t.engine, who));
  startP1Turn(t, P4);
  mayPay(t, true);
  chooseIndex(t, 0);
  [P2, P3, P4].forEach((who, i) => assert.equal(influence(t.engine, who), before[i + 1]! - 2, `${who} takes 2`));
  assert.equal(influence(t.engine, P1), before[0]);
});

// ===================================================================================================================
// Brainbath
// RECUR: [O][O] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game.
// -- EFFECT: An opponent discards a card. Draw a card.
// ===================================================================================================================

function brainbathTable(seats: number) {
  const hand = (owner: PlayerId) => (seated(owner, seats) ? Array.from({ length: 3 }, (_, i) => ({ key: `h-${owner}-${i}`, def: character({ name: `Card ${owner} ${i}` }), owner, zone: "hand" as const })) : []);
  return table(seats, [
    { key: "bb", def: printing(BRAINBATH), owner: P1, zone: "discard" },
    ...bank("obsession", 5, P1),
    { key: "draw", def: character({ name: "To draw" }), owner: P1, zone: "deck" },
    ...hand(P1),
    ...hand(P2),
    ...hand(P3),
    ...hand(P4)
  ]);
}

mpClause(BRAINBATH, "1:ability:recur", 3, "3 seats: at resolution the controller chooses P2 or P3; only that opponent discards a card from their own hand, then P1 draws", () => {
  const t = brainbathTable(3);
  activate(t, P1, "bb", "recur");
  assert.notEqual(zoneOf(t.engine, t.id("bb")), "discard", "this card is removed from the game as the cost");
  const ask = pending(t)!;
  assert.equal(ask.kind, "choosePlayer");
  assert.equal(ask.playerId, P1);
  assert.deepEqual(ask.candidates, [P2, P3]);
  choosePlayer(t, P3);
  assert.equal(pending(t)!.kind, "chooserSelectsTarget");
  assert.equal(pending(t)!.playerId, P3, "the chosen opponent chooses the discard");
  assert.deepEqual([...offered(t)].sort(), [t.id("h-p3-0"), t.id("h-p3-1"), t.id("h-p3-2")].sort(), "from P3's hand only");
  refused(() => choose(t, [t.id("h-p2-0")]), "a card in P2's hand");
  choose(t, [t.id("h-p3-1")]);
  assert.equal(zoneOf(t.engine, t.id("h-p3-1")), "discard");
  assert.equal(handOf(t.engine, P3).length, 2);
  assert.equal(handOf(t.engine, P2).length, 3, "P2's hand is unchanged");
  assert.equal(zoneOf(t.engine, t.id("draw")), "hand", "P1 then draws a card");

  const second = brainbathTable(3);
  activate(second, P1, "bb", "recur");
  choosePlayer(second, P2);
  assert.equal(pending(second)!.playerId, P2);
  choose(second, [second.id("h-p2-0")]);
  assert.equal(handOf(second.engine, P2).length, 2);
  assert.equal(handOf(second.engine, P3).length, 3);

  const two = brainbathTable(2);
  activate(two, P1, "bb", "recur");
  assert.equal(pending(two)!.kind, "chooserSelectsTarget", "one opponent left: nobody is asked which");
  assert.equal(pending(two)!.playerId, P2);
});

mpClause(BRAINBATH, "1:ability:recur", 4, "4 seats: the choice offers P2, P3 and P4", () => {
  const t = brainbathTable(4);
  activate(t, P1, "bb", "recur");
  assert.deepEqual(pending(t)!.candidates, [P2, P3, P4]);
  choosePlayer(t, P4);
  assert.equal(pending(t)!.playerId, P4);
  choose(t, [t.id("h-p4-0")]);
  assert.equal(handOf(t.engine, P4).length, 2);
  for (const who of [P2, P3]) assert.equal(handOf(t.engine, who).length, 3);
});
