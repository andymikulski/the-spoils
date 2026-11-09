// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 1. One 3-seat test per `changes` clause of
// data/card-tests/mp-spec/ungodly-mess.json (plus a 4-seat test where the text is "each opponent" or a fourth seat adds something),
// written from the printed text: the chosen or affected opponent IS affected, the other opponent(s) are NOT (or are, for "each"),
// and the opponent selection is asked exactly when the text says so and two or more opponents remain.
import assert from "node:assert/strict";
import type { PlayerId } from "../../../../engine.js";
import { bank, character } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { mpClause, printing, refused } from "../_clause.js";
import { attachedCount } from "../_turn.js";
import { P1, P2, P3, P4, act, choose, handOf, keys, pending, play, playerAsk, ready, spent, table, type Table } from "./_ungodly-mess.js";

const BONNET = "808bd2ba-7b76-4d81-b733-425078db481a"; // Extremely Tiny Bonnet of Invisibility
const FLESH = "94a4916f-0dcf-48d0-b1ab-62aa40c26070"; // Flesh Deliquesce
const SEANCE = "58fd9f77-2796-4601-be97-d5015bb05145"; // Seance Ritualist
const PENUMBRA = "8817125b-0cc8-43ba-a08e-c6711a79ecaa"; // Thabbashite Penumbra

// ===================================================================================================================
// Extremely Tiny Bonnet of Invisibility
// EXTRA COST: Pick an opponent. That player may detach up to 2 resources from their faction.
// ===================================================================================================================

function bonnetTable(count: number, picked: { p2: number; p3: number; p4?: number }) {
  const spentBy = { p2: spent(P2, picked.p2, count), p3: spent(P3, picked.p3, count), p4: spent(P4, picked.p4 ?? 0, count) };
  const t = table(count, [
    { key: "bon", def: printing(BONNET), owner: P1, zone: "hand" },
    { key: "host", def: character({ name: "Host" }), owner: P1 },
    ...bank("obsession", 2, P1),
    ...spentBy.p2,
    ...spentBy.p3,
    ...spentBy.p4
  ]);
  return { t, p2: keys(spentBy.p2), p3: keys(spentBy.p3), p4: keys(spentBy.p4) };
}
const bonnetAction = (t: Table, picked?: PlayerId) => ({ type: "playCard", playerId: P1, cardId: t.id("bon"), selected: { attachTo: [t.id("host")] }, variables: {}, ...(picked ? { players: { picked } } : {}) });

mpClause(BONNET, "1:extraCost", 3, "3 seats: Pick an opponent is asked once and offers P2 and P3 (never P1); only the picked opponent detaches, from their own faction", () => {
  const first = bonnetTable(3, { p2: 3, p3: 3 });
  assert.deepEqual(playerAsk(first.t, bonnetAction(first.t)), { id: "picked", candidates: [P2, P3] });
  refused(() => first.t.engine.perform(bonnetAction(first.t, P1) as never), "yourself is not an opponent");
  act(first.t, bonnetAction(first.t, P2));
  const pc = pending(first.t)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the picked opponent (not P1, not P3) detaches");
  refused(() => choose(first.t, [first.t.id(first.p3[0]!)]), "a resource of the other opponent");
  choose(first.t, [first.t.id(first.p2[0]!), first.t.id(first.p2[1]!)]);
  assert.equal(attachedCount(first.t.engine, P2), 1, "two of P2's three detached (0, 1 and 2 are all accepted)");
  assert.equal(attachedCount(first.t.engine, P3), 3, "P3's resources are untouched");
  assert.equal(zoneOf(first.t.engine, first.t.id("bon")), "play");

  const second = bonnetTable(3, { p2: 3, p3: 3 });
  act(second.t, bonnetAction(second.t, P3));
  assert.equal(pending(second.t)!.playerId, P3, "only P3 is asked when P3 is picked");
  refused(() => choose(second.t, [second.t.id(second.p2[0]!)]), "P2's resource when P3 was picked");
  choose(second.t, [second.t.id(second.p3[0]!)]);
  assert.equal(attachedCount(second.t.engine, P3), 2);
  assert.equal(attachedCount(second.t.engine, P2), 3, "P2 is untouched");

  const two = bonnetTable(2, { p2: 3, p3: 0 });
  assert.equal(playerAsk(two.t, bonnetAction(two.t)), undefined, "with one opponent left nobody is asked which");
  act(two.t, bonnetAction(two.t));
  assert.equal(pending(two.t)!.playerId, P2);
});

mpClause(BONNET, "1:extraCost", 4, "4 seats: the pick offers P2, P3 and P4; only the picked opponent is asked and affected", () => {
  const b = bonnetTable(4, { p2: 3, p3: 3, p4: 3 });
  assert.deepEqual(playerAsk(b.t, bonnetAction(b.t)), { id: "picked", candidates: [P2, P3, P4] });
  act(b.t, bonnetAction(b.t, P4));
  assert.equal(pending(b.t)!.playerId, P4);
  choose(b.t, [b.t.id(b.p4[0]!)]);
  assert.equal(attachedCount(b.t.engine, P4), 2);
  assert.equal(attachedCount(b.t.engine, P2), 3);
  assert.equal(attachedCount(b.t.engine, P3), 3);
});

// ===================================================================================================================
// Flesh Deliquesce
// EXTRA COST: Pick an opponent. X is the number of detached resources that player controls. Pick a character.
// -- If the character has X strength or less, destroy it.
// ===================================================================================================================

function fleshTable(count: number) {
  return table(count, [
    { key: "fd", def: printing(FLESH), owner: P1, zone: "hand" },
    ...bank("obsession", 5, P1),
    ...bank("rage", 1, P2),
    ...bank("rage", 4, P3),
    ...(count > 3 ? bank("rage", 6, P4) : []),
    { key: "big2", def: character({ name: "Big P2", strength: 3 }), owner: P2 },
    { key: "small3", def: character({ name: "Small P3", strength: 1 }), owner: P3 },
    { key: "mid3", def: character({ name: "Mid P3", strength: 4 }), owner: P3 },
    { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1 }
  ]);
}
const fleshAction = (t: Table, picked: PlayerId | undefined, target: string) => ({ type: "playCard", playerId: P1, cardId: t.id("fd"), selected: { c: [t.id(target)] }, variables: {}, ...(picked ? { players: { picked } } : {}) });

mpClause(FLESH, "0:extraCost", 3, "3 seats: the opponent pick offers P2 and P3; X counts only the picked opponent's detached resources; the character pick is not limited to that opponent", () => {
  const t = fleshTable(3);
  assert.deepEqual(playerAsk(t, fleshAction(t, undefined, "big2")), { id: "picked", candidates: [P2, P3] });
  refused(() => t.engine.perform(fleshAction(t, P1, "big2") as never), "yourself is not an opponent");
  // P2 picked: X = 1 (P3's four detached resources are not counted). A character of P3 is a legal pick and dies (strength 1 <= 1); P3's strength 4 one would not.
  play(t, P1, "fd", fleshAction(t, P2, "small3"));
  assert.equal(zoneOf(t.engine, t.id("small3")), "discard", "X = 1: a strength 1 character of the OTHER opponent is a legal pick and is destroyed");
  const second = fleshTable(3);
  play(second, P1, "fd", fleshAction(second, P2, "mid3"));
  assert.equal(zoneOf(second.engine, second.id("mid3")), "play", "X = 1, not 4 (P3's detached resources are not counted): strength 4 survives");
  // P3 picked: X = 4.
  const third = fleshTable(3);
  play(third, P1, "fd", fleshAction(third, P3, "mid3"));
  assert.equal(zoneOf(third.engine, third.id("mid3")), "discard", "X = 4: strength 4 or less is destroyed");
  const fourth = fleshTable(3);
  play(fourth, P1, "fd", fleshAction(fourth, P3, "big2"));
  assert.equal(zoneOf(fourth.engine, fourth.id("big2")), "discard", "X = 4 destroys P2's strength 3 character");
  const two = table(2, [
    { key: "fd", def: printing(FLESH), owner: P1, zone: "hand" },
    ...bank("obsession", 5, P1),
    ...bank("rage", 1, P2),
    { key: "big2", def: character({ name: "Big P2", strength: 3 }), owner: P2 }
  ]);
  assert.equal(playerAsk(two, fleshAction(two, undefined, "big2")), undefined, "one opponent left: nobody is asked");
  play(two, P1, "fd", fleshAction(two, undefined, "big2"));
  assert.equal(zoneOf(two.engine, two.id("big2")), "play", "X = 1 (P2's detached resources): strength 3 survives");
});

mpClause(FLESH, "0:extraCost", 4, "4 seats: the pick offers P2, P3 and P4; only the picked opponent's detached resources count", () => {
  const t = fleshTable(4);
  assert.deepEqual(playerAsk(t, fleshAction(t, undefined, "mid3")), { id: "picked", candidates: [P2, P3, P4] });
  play(t, P1, "fd", fleshAction(t, P4, "mid3"));
  assert.equal(zoneOf(t.engine, t.id("mid3")), "discard", "X = 6 (P4's detached resources)");
  const other = fleshTable(4);
  play(other, P1, "fd", fleshAction(other, P2, "mid3"));
  assert.equal(zoneOf(other.engine, other.id("mid3")), "play", "X = 1 when P2 is picked");
});

// ===================================================================================================================
// Seance Ritualist
// VIOLATE -- COST: Deplete this card. Pick an opponent. X is the number of tokens on this card. Pay X.
// -- EFFECT: That player discards X cards. Put a token on this card.
// ===================================================================================================================

function seanceTable(count: number, tokens = 2) {
  const hands = (owner: PlayerId) => Array.from({ length: 4 }, (_, i) => ({ key: `h-${owner}-${i}`, def: character({ name: `Card ${owner} ${i}` }), owner, zone: "hand" as const }));
  return table(count, [
    { key: "sr", def: printing(SEANCE), owner: P1, counters: { token: tokens } },
    ...bank("rage", 6, P1),
    ...hands(P1),
    ...hands(P2),
    ...(count > 2 ? hands(P3) : []),
    ...(count > 3 ? hands(P4) : [])
  ]);
}
const seanceAction = (t: Table, picked?: PlayerId) => ({ type: "activateAbility", playerId: P1, cardId: t.id("sr"), abilityId: "violate", selected: {}, variables: {}, ...(picked ? { players: { picked } } : {}) });

mpClause(SEANCE, "0:ability:violate", 3, "3 seats: the pick offers P2 and P3; only the picked opponent chooses and discards X cards, and a token is put on this card", () => {
  const t = seanceTable(3);
  assert.deepEqual(playerAsk(t, seanceAction(t)), { id: "picked", candidates: [P2, P3] });
  refused(() => t.engine.perform(seanceAction(t, P1) as never), "yourself is not an opponent");
  const handsBefore = Object.fromEntries(t.seats.map(seat => [seat, handOf(t.engine, seat).length]));
  act(t, seanceAction(t, P2));
  const pc = pending(t)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the picked opponent chooses the discards");
  refused(() => choose(t, [t.id("h-p3-0"), t.id("h-p3-1")]), "cards in the other opponent's hand");
  refused(() => choose(t, [t.id("h-p1-0"), t.id("h-p1-1")]), "cards in the controller's hand");
  choose(t, [t.id("h-p2-0"), t.id("h-p2-3")]);
  assert.equal(handOf(t.engine, P2).length, handsBefore[P2]! - 2);
  assert.equal(handOf(t.engine, P3).length, handsBefore[P3], "P3's hand is unchanged");
  assert.equal(handOf(t.engine, P1).length, handsBefore[P1], "P1's hand is unchanged");
  assert.equal(t.engine.state.cards[t.id("sr")]!.counters?.token, 3, "a token is put on the Ritualist");

  // Second activation (3 tokens, pay 3), picking P3: only P3 discards, 3 cards.
  t.engine.state.cards[t.id("sr")]!.depleted = false;
  act(t, seanceAction(t, P3));
  assert.equal(pending(t)!.playerId, P3);
  choose(t, [t.id("h-p3-0"), t.id("h-p3-1"), t.id("h-p3-2")]);
  assert.equal(handOf(t.engine, P3).length, handsBefore[P3]! - 3);
  assert.equal(handOf(t.engine, P2).length, handsBefore[P2]! - 2, "P2 is not affected by the second activation");

  const two = seanceTable(2);
  assert.equal(playerAsk(two, seanceAction(two)), undefined, "one opponent left: nobody is asked which");
  act(two, seanceAction(two));
  assert.equal(pending(two)!.playerId, P2);
});

mpClause(SEANCE, "0:ability:violate", 4, "4 seats: the pick offers P2, P3 and P4; only the picked opponent discards", () => {
  const t = seanceTable(4);
  assert.deepEqual(playerAsk(t, seanceAction(t)), { id: "picked", candidates: [P2, P3, P4] });
  act(t, seanceAction(t, P4));
  assert.equal(pending(t)!.playerId, P4);
  choose(t, [t.id("h-p4-0"), t.id("h-p4-1")]);
  for (const seat of [P1, P2, P3]) assert.equal(handOf(t.engine, seat).length, 4, `${seat}'s hand is unchanged`);
  assert.equal(handOf(t.engine, P4).length, 2);
});

// ===================================================================================================================
// Thabbashite Penumbra
// COST: Pick an opponent. X is the number of different staple resources that player controls. Pay 6-X.
// EFFECT: This turn, this card gains 1 life and COVERT
// ===================================================================================================================

function penumbraTable(count: number) {
  return table(count, [
    { key: "pen", def: printing(PENUMBRA), owner: P1 },
    ...bank("rage", 6, P1),
    ...bank("rage", 1, P2),
    ...bank("greed", 1, P2),
    ...(count > 2 ? bank("rage", 3, P3) : []),
    ...(count > 3 ? [...bank("rage", 1, P4), ...bank("greed", 1, P4), ...bank("deception", 1, P4)] : [])
  ]);
}
const penumbraAction = (t: Table, picked?: PlayerId) => ({ type: "activateAbility", playerId: P1, cardId: t.id("pen"), abilityId: "veil", selected: {}, variables: {}, ...(picked ? { players: { picked } } : {}) });

mpClause(PENUMBRA, "0:ability:veil", 3, "3 seats: the pick offers P2 and P3; X counts only the picked opponent's different staple types (6 - X is paid)", () => {
  const t = penumbraTable(3);
  assert.deepEqual(playerAsk(t, penumbraAction(t)), { id: "picked", candidates: [P2, P3] });
  refused(() => t.engine.perform(penumbraAction(t, P1) as never), "yourself is not an opponent");
  const life = t.engine.getStat(t.id("pen"), "life");
  act(t, penumbraAction(t, P2));
  assert.equal(ready(t.engine, P1), 6 - 4, "P2 controls 2 different staple types: X = 2, so 6 - 2 = 4 is paid");
  assert.equal(t.engine.getStat(t.id("pen"), "life"), life + 1);
  assert.ok(t.engine.getKeywords(t.id("pen")).includes("covert"), "t.engine.getKeywords(t.id('pen')).includes('covert')");

  const second = penumbraTable(3);
  act(second, penumbraAction(second, P3));
  assert.equal(ready(second.engine, P1), 6 - 5, "P3 controls 1 staple type (three Rage count once): X = 1, so 5 is paid");
  assert.equal(second.engine.getStat(second.id("pen"), "life"), life + 1);

  const two = penumbraTable(2);
  assert.equal(playerAsk(two, penumbraAction(two)), undefined, "one opponent left: nobody is asked which");
  act(two, penumbraAction(two));
  assert.equal(ready(two.engine, P1), 6 - 4);
});

mpClause(PENUMBRA, "0:ability:veil", 4, "4 seats: the pick offers P2, P3 and P4; X counts the picked opponent only", () => {
  const t = penumbraTable(4);
  assert.deepEqual(playerAsk(t, penumbraAction(t)), { id: "picked", candidates: [P2, P3, P4] });
  act(t, penumbraAction(t, P4));
  assert.equal(ready(t.engine, P1), 6 - 3, "P4 controls 3 staple types: X = 3, so 6 - 3 = 3 is paid");
});
