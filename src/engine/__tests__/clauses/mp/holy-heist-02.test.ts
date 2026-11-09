// Multiplayer clause tests, Holy Heist part 2: the clauses with an inserted choice or the "any opponent may
// pay" offer. Written from the printed text.

import assert from "node:assert/strict";
import { clause, printing } from "../_clause.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";
import { item, tactic } from "../../support/fixtures.js";
import { developResource } from "../_turn.js";
import {
  P1, P2, P3, activate, answer, bank, character, choosePlayer, candidates, controllerOf, damageOf, deckOf, discardOf, factionOf, filler, handOf, offer, pending, pick, pickCandidates, pickIds,
  play, playOpen, playRequirements, refusal, resolvePendingResponses, sorted, table, tokens, volition, zoneOf,
  type Table
} from "./_holy-heist.js";

const SPENT = (t: Table, who: PlayerId): number => t.engine.getAvailableResourceCount(who);

// --- Additional Tribute --------------------------------------------------------------------------------------------
// EXTRA COST: Deploy this only in response to a non-tactic card being deployed.
// If you control [V][V][V], you may look at the top card of your deck. If you do, you may put it on the bottom.
// Any opponent may pay 1. If they do, draw a card and terminate this card. Otherwise, terminate the non-tactic card being deployed.

const TRIBUTE = "a64326fe-e6a2-4398-ad70-88e4584fb7af";

/** `active` is deploying `foe` (a character, or a tactic); P1 holds Additional Tribute; P2 and P3 each have 3 ready resources. */
function tributeTable(active: PlayerId, opts: { foe?: CardDefinition; volition?: number } = {}): Table {
  return table(
    3,
    [
      { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
      { key: "foe", def: opts.foe ?? character({ name: "Foe", cost: 0 }), owner: active, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...volition(opts.volition ?? 0, P1),
      ...bank("rage", 3, P2),
      ...bank("rage", 3, P3),
      ...filler("dk", 4, P1, "deck"),
      ...filler("z2-", 3, P2, "deck"),
      ...filler("z3-", 3, P3, "deck")
    ],
    { active }
  );
}
const respondWithTribute = (t: Table): void => {
  playOpen(t, P1, "at");
  resolvePendingResponses(t.engine);
};

clause(TRIBUTE, "0:extraCost", "3 seats: P1 may deploy it in response to a non-tactic card P2 or P3 deploys; refused in response to a tactic, with nothing being deployed, and to P1's own deployment", () => {
  for (const deployer of [P2, P3] as const) {
    const t = tributeTable(deployer);
    playOpen(t, deployer, "foe");
    while (t.engine.state.responseWindow?.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
    assert.equal(t.engine.getCardPlayability(P1, t.id("at")).legalTiming, true, `a card ${deployer} deploys`);
    assert.deepEqual(playRequirements(t, P1, "at").filter((r) => r.kind === "players"), []);
    playOpen(t, P1, "at");
    assert.equal(zoneOf(t, "at"), "deploying", "it is on the stack");
  }
  const tacticFoe = tributeTable(P2, { foe: tactic({ name: "Foe Tactic", cost: 0 }) });
  playOpen(tacticFoe, P2, "foe");
  assert.equal(tacticFoe.engine.getCardPlayability(P1, tacticFoe.id("at")).legalTiming, false);
  const idle = tributeTable(P1);
  assert.equal(idle.engine.getCardPlayability(P1, idle.id("at")).legalTiming, false, "nothing is being deployed");
  const own = tributeTable(P1);
  playOpen(own, P1, "foe");
  assert.equal(own.engine.getCardPlayability(P1, own.id("at")).legalTiming, false, "P1 cannot respond to P1's own deployment");
  refusal(() => playOpen(own, P1, "at"));
});

clause(TRIBUTE, "1:rule", "3 seats: with [V][V][V] P1 alone may look at the top card of P1's deck and put it on the bottom; without the threshold the look is not offered", () => {
  const t = tributeTable(P3, { volition: 3 });
  playOpen(t, P3, "foe");
  const top = deckOf(t, P1)[0]!;
  respondWithTribute(t);
  assert.equal(pending(t)?.kind, "chooserSelectsOption");
  assert.equal(pending(t)?.playerId, P1, "only the controller looks");
  const z2 = [...deckOf(t, P2)];
  const z3 = [...deckOf(t, P3)];
  answer(t, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(deckOf(t, P1).slice(-1)[0], top, "the looked-at card is on the bottom of P1's deck");
  assert.deepEqual(deckOf(t, P2), z2);
  assert.deepEqual(deckOf(t, P3), z3);
  const without = tributeTable(P3);
  playOpen(without, P3, "foe");
  respondWithTribute(without);
  assert.notEqual(pending(without)?.kind, "chooserSelectsOption", "no look without the threshold");
});

clause(TRIBUTE, "2:rule", "3 seats: the payment of 1 is offered to P2 first, then P3; the first to pay settles it (P1 draws, the card resolves, the other is not asked); if both decline the card being deployed is terminated and P1 draws nothing", () => {
  const paid = tributeTable(P3);
  playOpen(paid, P3, "foe");
  const handBefore = handOf(paid, P1).length;
  respondWithTribute(paid);
  assert.equal(pending(paid)?.kind, "mayPay");
  assert.equal(pending(paid)?.playerId, P2, "clockwise from P1's left: P2 first");
  const readyBefore = SPENT(paid, P2);
  offer(paid, P2, true);
  assert.equal(pending(paid), undefined, "P3 is never asked");
  assert.equal(readyBefore - SPENT(paid, P2), 1, "P2 paid 1");
  assert.equal(SPENT(paid, P3), 3, "P3 paid nothing");
  assert.equal(handOf(paid, P1).length, handBefore - 1 + 1, "P1, not the payer, drew a card");
  assert.equal(handOf(paid, P2).length, 0);
  assert.equal(zoneOf(paid, "foe"), "play", "the character resolved");
  assert.equal(zoneOf(paid, "at"), "discard");

  const second = tributeTable(P3);
  playOpen(second, P3, "foe");
  respondWithTribute(second);
  offer(second, P2, false);
  assert.equal(pending(second)?.playerId, P3, "P2 declined: P3 is asked next");
  const p1Before = handOf(second, P1).length;
  offer(second, P3, true);
  assert.equal(handOf(second, P1).length, p1Before + 1, "P1 draws");
  assert.equal(zoneOf(second, "foe"), "play");

  const none = tributeTable(P3);
  playOpen(none, P3, "foe");
  respondWithTribute(none);
  offer(none, P2, false);
  const before = handOf(none, P1).length;
  offer(none, P3, false);
  assert.equal(zoneOf(none, "foe"), "discard", "terminated");
  assert.equal(handOf(none, P1).length, before, "P1 draws nothing");
});

// --- Offering of False Friendship ----------------------------------------------------------------------------------
// EXTRA COST: Pick a character.
// Any opponent may pay 2. If they do, terminate this card. Otherwise, put that character and characters with the same name as that character on the bottom of their owner's deck.

const OFFERING = "7e7c80fc-1697-426e-b962-768196f6f2da";

function offeringTable(): Table {
  return table(3, [
    { key: "of", def: printing(OFFERING), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    ...bank("rage", 3, P2),
    ...bank("rage", 3, P3),
    { key: "e1", def: character({ name: "Echo" }), owner: P1, zone: "play" },
    { key: "e2", def: character({ name: "Echo" }), owner: P2, zone: "play" },
    { key: "e3", def: character({ name: "Echo" }), owner: P3, zone: "play" },
    { key: "other", def: character({ name: "Other" }), owner: P3, zone: "play" }
  ]);
}

clause(OFFERING, "0:extraCost", "3 seats: any character in play can be picked (P1's, P2's or P3's) and no opponent is selected at play", () => {
  const t = offeringTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "of", "c")), sorted(["e1", "e2", "e3", "other"].map((k) => t.id(k))));
  assert.deepEqual(playRequirements(t, P1, "of").filter((r) => r.kind === "players"), []);
  play(t, P1, "of", { selected: { c: [t.id("e2")] } });
  assert.equal(pending(t)?.kind, "mayPay", "the offer comes at resolution");
});

clause(OFFERING, "1:rule", "3 seats: 2 is offered to P2 then P3; a payment terminates the card and nothing moves (the other is not asked); if both decline every Echo goes to the bottom of its owner's deck", () => {
  const first = offeringTable();
  play(first, P1, "of", { selected: { c: [first.id("e2")] } });
  assert.equal(pending(first)?.playerId, P2);
  offer(first, P2, true);
  assert.equal(pending(first), undefined, "P3 is not asked after a payment");
  for (const key of ["e1", "e2", "e3", "other"]) assert.equal(zoneOf(first, key), "play");
  assert.equal(zoneOf(first, "of"), "discard");
  assert.equal(SPENT(first, P2), 1);

  const second = offeringTable();
  play(second, P1, "of", { selected: { c: [second.id("e2")] } });
  offer(second, P2, false);
  assert.equal(pending(second)?.playerId, P3);
  offer(second, P3, true);
  for (const key of ["e1", "e2", "e3"]) assert.equal(zoneOf(second, key), "play");

  const both = offeringTable();
  play(both, P1, "of", { selected: { c: [both.id("e2")] } });
  offer(both, P2, false);
  offer(both, P3, false);
  for (const key of ["e1", "e2", "e3"]) assert.equal(zoneOf(both, key), "deck", `${key} is on the bottom of its owner's deck`);
  assert.equal(deckOf(both, P2).slice(-1)[0], both.id("e2"));
  assert.equal(deckOf(both, P3).slice(-1)[0], both.id("e3"));
  assert.equal(deckOf(both, P1).slice(-1)[0], both.id("e1"));
  assert.equal(zoneOf(both, "other"), "play");
});

// --- Thabbashite Barbeque ------------------------------------------------------------------------------------------
// EXTRA COST: Pick a non-resource card.
// Any opponent may pay 2. If they do, put this card into its owner's hand and terminate it. Otherwise, put the picked card into its owner's hand.
// Look at an opponent's hand and choose a non-resource card in it. That player discards the card.

const BARBEQUE = "cb0c54e5-f40b-4fb7-aeb2-01d0ab697f4f";

function barbequeTable(): Table {
  return table(3, [
    { key: "bq", def: printing(BARBEQUE), owner: P1, zone: "hand" },
    ...bank("obsession", 4, P1),
    ...bank("rage", 3, P2),
    ...bank("rage", 3, P3),
    { key: "picked", def: character({ name: "Picked" }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "item3", def: item({ name: "Item Three" }), owner: P3, zone: "play" },
    ...filler("h2-", 2, P2, "hand"),
    ...filler("h3-", 2, P3, "hand"),
    { key: "res3", def: character({ name: "Res" }), owner: P3, zone: "hand" }
  ]);
}

clause(BARBEQUE, "0:extraCost", "3 seats: any non-resource card in play can be picked (P1's, P2's or P3's) and no opponent is selected at play", () => {
  const t = barbequeTable();
  const ids = pickCandidates(t, P1, "bq", "picked");
  for (const key of ["picked", "mine", "item3"]) assert.ok(ids.includes(t.id(key)), `${key} can be picked`);
  assert.equal(ids.includes(factionOf(t, P2)), false, "never a faction");
  assert.deepEqual(playRequirements(t, P1, "bq").filter((r) => r.kind === "players"), []);
});

clause(BARBEQUE, "1:rule", "3 seats: 2 is offered to P2 then P3, and a payment returns Barbeque to P1's hand, keeps the picked card and looks at no hand; if both decline the picked card goes to its owner's hand, then P1 chooses one opponent, looks at only that player's hand and that player discards a non-resource card", () => {
  const paid = barbequeTable();
  play(paid, P1, "bq", { selected: { picked: [paid.id("picked")] } });
  assert.equal(pending(paid)?.playerId, P2);
  offer(paid, P2, true);
  assert.equal(pending(paid), undefined, "P3 is not asked and no hand is looked at");
  assert.equal(zoneOf(paid, "bq"), "hand", "Barbeque went back to its owner's hand");
  assert.equal(zoneOf(paid, "picked"), "play");

  const t = barbequeTable();
  play(t, P1, "bq", { selected: { picked: [t.id("picked")] } });
  offer(t, P2, false);
  assert.equal(pending(t)?.playerId, P3, "P2 declined: P3 is asked");
  offer(t, P3, false);
  assert.equal(zoneOf(t, "picked"), "hand", "the picked card went to its owner's hand");
  assert.equal(controllerOf(t, "picked"), P2);
  assert.equal(pending(t)?.kind, "choosePlayer");
  assert.equal(pending(t)?.playerId, P1, "the controller picks the opponent whose hand is looked at, whoever was offered the payment");
  assert.deepEqual(candidates(t), [P2, P3]);
  choosePlayer(t, P1, P3);
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.equal(pending(t)?.playerId, P1);
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("h2-0")] } } as never), /./, "P2's hand is not looked at");
  pick(t, P1, "h3-0");
  assert.equal(zoneOf(t, "h3-0"), "discard");
  assert.equal(discardOf(t, P3).length, 1, "P3 discarded it");
  assert.equal(handOf(t, P2).length, 3, "P2's hand is unchanged (its two cards and the returned card)");
});

// --- Unloyal Necromorph --------------------------------------------------------------------------------------------
// If this card would be destroyed, any opponent may pay 2. If they do, that player takes control of this card instead ...

const NECRO = "420418bb-f8a7-435a-a0eb-1dec094e3805";

function necroTable(): Table {
  return table(3, [
    { key: "necro", def: printing(NECRO), owner: P1, zone: "play", damage: 2 },
    { key: "kill", def: tactic({ name: "Kill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
    ...bank("greed", 3, P2),
    ...bank("greed", 3, P3)
  ]);
}
const replacementAnswer = (t: Table, who: PlayerId, apply: boolean): void => answer(t, "replacementChoice", who, { kind: "replacementChoice", apply });

clause(NECRO, "0:rule", "3 seats: the payment of 2 is offered to P2 first, then P3; the first to pay takes control (P3 is never asked, and damage this turn is reduced to 0); if both decline it is destroyed", () => {
  const first = necroTable();
  play(first, P1, "kill", { selected: { t: [first.id("necro")] } });
  assert.equal(pending(first)?.kind, "replacementChoice");
  assert.equal(pending(first)?.playerId, P2, "clockwise from P1's left: P2 is offered it, nobody is asked to select an opponent");
  replacementAnswer(first, P2, true);
  assert.equal(pending(first), undefined, "P3 is never asked");
  assert.equal(controllerOf(first, "necro"), P2);
  assert.equal(damageOf(first, "necro"), 0);
  assert.equal(SPENT(first, P2), 1);
  assert.equal(SPENT(first, P3), 3);

  const second = necroTable();
  play(second, P1, "kill", { selected: { t: [second.id("necro")] } });
  replacementAnswer(second, P2, false);
  assert.equal(pending(second)?.playerId, P3);
  replacementAnswer(second, P3, true);
  assert.equal(controllerOf(second, "necro"), P3);

  const none = necroTable();
  play(none, P1, "kill", { selected: { t: [none.id("necro")] } });
  replacementAnswer(none, P2, false);
  replacementAnswer(none, P3, false);
  assert.equal(zoneOf(none, "necro"), "discard");
});

// --- Canny Bailiff -------------------------------------------------------------------------------------------------
// While an opponent is deploying a tactic, its numeric cost is increased to a minimum of 3.

const BAILIFF = "efac6670-d61f-42ba-aee9-e897b774e395";

clause(BAILIFF, "0:rule", "3 seats: a cost-1 tactic costs 3 for P2 and for P3, a cost-5 tactic stays 5, P1's own cost-1 tactic is unchanged", () => {
  const t = table(
    3,
    [
      { key: "cb", def: printing(BAILIFF), owner: P1, zone: "play" },
      { key: "cheap1", def: tactic({ name: "Cheap One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "cheap2", def: tactic({ name: "Cheap Two", cost: 1 }), owner: P2, zone: "hand" },
      { key: "cheap3", def: tactic({ name: "Cheap Three", cost: 1 }), owner: P3, zone: "hand" },
      { key: "dear2", def: tactic({ name: "Dear Two", cost: 5 }), owner: P2, zone: "hand" },
      { key: "dear3", def: tactic({ name: "Dear Three", cost: 5 }), owner: P3, zone: "hand" },
      ...bank("rage", 6, P1),
      ...bank("rage", 6, P2),
      ...bank("rage", 6, P3)
    ]
  );
  const cost = (who: PlayerId, key: string): number | undefined => t.engine.getCardPlayability(who, t.id(key)).numericCost;
  assert.equal(cost(P2, "cheap2"), 3);
  assert.equal(cost(P3, "cheap3"), 3);
  assert.equal(cost(P2, "dear2"), 5);
  assert.equal(cost(P3, "dear3"), 5);
  assert.equal(cost(P1, "cheap1"), 1);
});

// --- iDumb De-Itemizer ---------------------------------------------------------------------------------------------
// RESET -- COST: Only an opponent may use this ability. Pay 3. -- EFFECT: This turn, this card loses all rules text.

const IDUMB = "a0403283-f513-4822-9e8d-afc862ff08b3";

clause(IDUMB, "2:ability:idumb-reset", "3 seats: P2 can use RESET (paying 3 of P2's own resources) and so can P3; P1 cannot; nothing else about the three players changes", () => {
  for (const user of [P2, P3] as const) {
    const t = table(3, [
      { key: "host", def: item({ name: "Host" }), owner: P1, zone: "play" },
      { key: "idumb", def: printing(IDUMB), owner: P1, zone: "play", attachedToKey: "host" },
      ...bank("greed", 4, P1),
      ...bank("rage", 4, P2),
      ...bank("rage", 4, P3)
    ], { active: user });
    refusal(() => activate(t, P1, "idumb", "idumb-reset"));
    const before = Object.fromEntries(t.seats.map((seat) => [seat, SPENT(t, seat)]));
    activate(t, user, "idumb", "idumb-reset");
    for (const seat of t.seats) assert.equal(before[seat]! - SPENT(t, seat), seat === user ? 3 : 0, `${seat}: only ${user} paid`);
    assert.equal(t.engine.state.cards[t.id("idumb")]!.zone, "play");
  }
});

// --- Chum, the Ugliest Sarume --------------------------------------------------------------------------------------
// EXTRA COST: Pick a card in a discard pile. X is its numeric cost.
// When this card enters play, if you picked a card as part of its cost, remove that card from the game. Search an opponent's deck for a card with numeric cost X or less and put it into their discard pile.

const CHUM = "30b358cd-6c60-4e9e-b341-7d04fd80e135";

function chumTable(): Table {
  return table(3, [
    { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
    ...bank("deception", 2, P1),
    { key: "d1", def: character({ name: "In P1 Pile", cost: 1 }), owner: P1, zone: "discard" },
    { key: "d2", def: character({ name: "In P2 Pile", cost: 3 }), owner: P2, zone: "discard" },
    { key: "d3", def: character({ name: "In P3 Pile", cost: 2 }), owner: P3, zone: "discard" },
    { key: "t2", def: character({ name: "Cheap Two", cost: 2 }), owner: P2, zone: "deck" },
    { key: "t3", def: character({ name: "Cheap Three", cost: 3 }), owner: P3, zone: "deck" },
    { key: "big3", def: character({ name: "Big Three", cost: 6 }), owner: P3, zone: "deck" },
    ...filler("z2-", 2, P2, "deck", { cost: 6 }),
    ...filler("z3-", 2, P3, "deck", { cost: 6 })
  ]);
}

clause(CHUM, "1:extraCost", "3 seats: cards in P1's, P2's and P3's discard piles are all legal picks and no opponent is selected at play", () => {
  const t = chumTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "chum", "pick")), sorted(["d1", "d2", "d3"].map((k) => t.id(k))));
  assert.deepEqual(playRequirements(t, P1, "chum").filter((r) => r.kind === "players"), []);
});

clause(CHUM, "2:rule", "3 seats: with P2's cost-3 card picked it is removed from the game; P1 chooses P3 when it enters play, searches only P3's deck for a card of cost 3 or less into P3's discard pile; P2's deck is untouched", () => {
  const t = chumTable();
  play(t, P1, "chum", { selected: { pick: [t.id("d2")] } });
  assert.equal(zoneOf(t, "d2"), "removed", "the picked card is removed from the game");
  assert.equal(pending(t)?.kind, "choosePlayer");
  assert.equal(pending(t)?.playerId, P1);
  assert.deepEqual(candidates(t), [P2, P3]);
  choosePlayer(t, P1, P3);
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("t2")] } } as never), /./, "P2's deck is not searched");
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("big3")] } } as never), /./, "cost 6 is above X = 3");
  pick(t, P1, "t3");
  assert.equal(zoneOf(t, "t3"), "discard");
  assert.equal(discardOf(t, P3).includes(t.id("t3")), true, "into P3's discard pile");
  assert.equal(zoneOf(t, "t2"), "deck", "P2's deck is untouched");
});

// --- Craniata Nester -----------------------------------------------------------------------------------------------
// When a card that provides at least [V] enters play under your control, you may pick an opponent. If you do, put the top card of their deck into their discard pile.

const NESTER = "1a1d1224-d3ac-4a6f-bf31-01cd5477f1d7";

function nesterTable(): Table {
  return table(
    3,
    [
      { key: "cn", def: printing(NESTER), owner: P1, zone: "play" },
      { key: "vres", def: { ...character({ name: "VRes" }), type: "resource", resource: { provides: ["volition"], staple: false } } as unknown as CardDefinition, owner: P1, zone: "hand" },
      ...filler("z2-", 3, P2, "deck"),
      ...filler("z3-", 3, P3, "deck")
    ],
    { p1Develops: true }
  );
}

clause(NESTER, "0:rule", "3 seats: a resource providing [V] enters play under P1: P1 may pick an opponent (P2 and P3 are offered) and the top card of that opponent's deck goes to their discard pile; P2's deck is unchanged; declining does nothing", () => {
  const t = nesterTable();
  const z2 = [...deckOf(t, P2)];
  const z3 = [...deckOf(t, P3)];
  developResource(t.engine, P1, t.id("vres"), false);
  assert.equal(pending(t)?.kind, "chooserSelectsOption");
  assert.equal(pending(t)?.playerId, P1, "may");
  answer(t, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(pending(t)?.kind, "choosePlayer");
  assert.deepEqual(candidates(t), [P2, P3]);
  choosePlayer(t, P1, P3);
  assert.deepEqual(discardOf(t, P3), [z3[0]], "the top card of P3's deck");
  assert.deepEqual(deckOf(t, P3), z3.slice(1));
  assert.deepEqual(deckOf(t, P2), z2, "P2's deck is unchanged");

  const declined = nesterTable();
  developResource(declined.engine, P1, declined.id("vres"), false);
  answer(declined, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 0 });
  assert.equal(pending(declined), undefined);
  assert.equal(discardOf(declined, P2).length + discardOf(declined, P3).length, 0);
});

// --- Inebriated Defenestration -------------------------------------------------------------------------------------
// Put the top 5 cards of an opponent's deck into their discard pile. Draw 2 cards.

const DEFEN = "ebac9b53-26af-491e-b251-a43a908d992f";

clause(DEFEN, "0:rule", "3 seats: at resolution P1 is offered P2 and P3 and picks P3: the top 5 cards of P3's deck go to P3's discard pile, P2's deck is unchanged, P1 draws 2; a second run picking P2 mills only P2", () => {
  for (const [picked, bystander] of [[P3, P2], [P2, P3]] as const) {
    const t = table(3, [
      { key: "df", def: printing(DEFEN), owner: P1, zone: "hand" },
      ...bank("deception", 5, P1),
      ...filler("dk", 4, P1, "deck"),
      ...filler("z2-", 8, P2, "deck"),
      ...filler("z3-", 8, P3, "deck")
    ]);
    assert.deepEqual(playRequirements(t, P1, "df").filter((r) => r.kind === "players"), [], "no opponent is selected at play");
    play(t, P1, "df");
    assert.equal(pending(t)?.kind, "choosePlayer", "offered when the effect resolves");
    assert.deepEqual(candidates(t), [P2, P3]);
    const pickedTop = deckOf(t, picked).slice(0, 5);
    const bystanderDeck = [...deckOf(t, bystander)];
    choosePlayer(t, P1, picked);
    assert.deepEqual(discardOf(t, picked), pickedTop);
    assert.deepEqual(deckOf(t, bystander), bystanderDeck);
    assert.equal(discardOf(t, bystander).length, 0);
    assert.equal(handOf(t, P1).length, 2, "P1 drew 2 cards");
  }
});

// --- Theological Theft ---------------------------------------------------------------------------------------------
// EXTRA COST: Choose a number for X. Pick X players.
// Each of those players puts the top 10 cards of their deck into their discard pile. Pick X characters in an opponent's discard pile. Put those characters into play under your control.

const THEFT = "9d9b004f-6491-4e6e-a79b-dd2a479c637f";

function theftTable(): Table {
  return table(3, [
    { key: "tt", def: printing(THEFT), owner: P1, zone: "hand" },
    ...bank("deception", 8, P1),
    ...filler("z1-", 12, P1, "deck"),
    ...filler("z2-", 12, P2, "deck"),
    ...filler("z3-", 12, P3, "deck")
  ]);
}

clause(THEFT, "0:extraCost", "3 seats: X can be chosen from 0 to 3; with X = 2 two different players are picked; the same player twice is refused; X = 3 picks all three", () => {
  const t = theftTable();
  const f = (who: PlayerId): string => factionOf(t, who);
  assert.deepEqual(playRequirements(t, P1, "tt").filter((r) => r.kind === "players"), [], "no opponent is selected");
  refusal(() => play(t, P1, "tt", { variables: { x: 4 }, selected: { players: [f(P1), f(P2), f(P3), f(P1)] } }));
  refusal(() => play(t, P1, "tt", { variables: { x: 2 }, selected: { players: [f(P2), f(P2)] } }));
  assert.equal(zoneOf(t, "tt"), "hand", "nothing was played");
  const three = theftTable();
  play(three, P1, "tt", { variables: { x: 3 }, selected: { players: [factionOf(three, P1), factionOf(three, P2), factionOf(three, P3)] } });
  for (const seat of [P1, P2, P3] as const) assert.equal(discardOf(three, seat).length, 10, `${seat} milled 10`);
});

clause(THEFT, "1:rule", "3 seats: P2 and P3 picked (X = 2): each (not P1) mills 10; P1 then picks 2 characters from one opponent's discard pile (P3's) and takes them; cards from two piles are refused; P1's own pile is not a source; picking P1 and P3 has P1 mill 10 and not P2", () => {
  const t = theftTable();
  play(t, P1, "tt", { variables: { x: 2 }, selected: { players: [factionOf(t, P2), factionOf(t, P3)] } });
  assert.equal(discardOf(t, P1).length, 1 - 1, "P1 did not mill");
  assert.equal(discardOf(t, P2).length, 10);
  assert.equal(discardOf(t, P3).length, 10);
  assert.equal(pending(t)?.kind, "choosePlayer");
  assert.deepEqual(candidates(t), [P2, P3]);
  choosePlayer(t, P1, P3);
  const p3 = discardOf(t, P3).slice(0, 2);
  const p2 = discardOf(t, P2)[0]!;
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [p3[0]!, p2] } } as never), /./, "one card from each pile is refused");
  pickIds(t, P1, ...p3);
  for (const id of p3) {
    assert.equal(t.engine.state.cards[id]!.zone, "play");
    assert.equal(t.engine.state.cards[id]!.controllerId, P1);
  }
  assert.equal(discardOf(t, P2).length, 10, "P2's pile is intact");

  const second = theftTable();
  play(second, P1, "tt", { variables: { x: 2 }, selected: { players: [factionOf(second, P1), factionOf(second, P3)] } });
  assert.equal(discardOf(second, P1).length, 10, "P1 mills 10");
  assert.equal(discardOf(second, P3).length, 10);
  assert.equal(discardOf(second, P2).length, 0, "P2 does not");
});

// --- Suicide Smash -------------------------------------------------------------------------------------------------
// EXTRA COST: Pick a character you control. X is its strength. Destroy it. Pick a location.
// If you control [V][V][V], inflict 3 damage to an opponent's faction. Inflict X damage to the location. If it is destroyed by that damage, draw a card.

const SMASH = "519a6b1a-f64e-4fe1-b586-39b32f7b328a";

function smashTable(threshold: boolean): Table {
  return table(3, [
    { key: "ss", def: printing(SMASH), owner: P1, zone: "hand" },
    ...bank("rage", 2, P1),
    ...(threshold ? volition(3, P1) : []),
    { key: "sac", def: character({ name: "Sacrifice", strength: 3 }), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" },
    { key: "loc", def: { ...character({ name: "Loc" }), type: "location", structure: 3 } as unknown as CardDefinition, owner: P2, zone: "play" },
    ...filler("dk", 3, P1, "deck")
  ]);
}

clause(SMASH, "0:extraCost", "3 seats: only P1's own characters can be picked for the sacrifice, the location may be anyone's, and no opponent is selected at play", () => {
  const t = smashTable(true);
  assert.deepEqual(pickCandidates(t, P1, "ss", "sac"), [t.id("sac")]);
  assert.deepEqual(pickCandidates(t, P1, "ss", "loc"), [t.id("loc")]);
  assert.deepEqual(playRequirements(t, P1, "ss").filter((r) => r.kind === "players"), []);
});

clause(SMASH, "1:rule", "3 seats: with [V][V][V] P1 is offered P2 and P3 when the effect resolves and picks P3: P3's faction takes 3 and P2's none; the location takes X and P1 draws when it is destroyed; without the threshold no faction is damaged", () => {
  for (const [picked, bystander] of [[P3, P2], [P2, P3]] as const) {
    const t = smashTable(true);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, t.engine.state.players[seat]!.influence]));
    play(t, P1, "ss", { selected: { sac: [t.id("sac")], loc: [t.id("loc")] } });
    assert.equal(pending(t)?.kind, "choosePlayer");
    assert.deepEqual(candidates(t), [P2, P3]);
    choosePlayer(t, P1, picked);
    assert.equal(before[picked]! - t.engine.state.players[picked]!.influence, 3);
    assert.equal(before[bystander]! - t.engine.state.players[bystander]!.influence, 0);
    assert.equal(before[P1]! - t.engine.state.players[P1]!.influence, 0);
    assert.equal(zoneOf(t, "loc"), "discard", "X = 3 destroyed the location");
    assert.equal(handOf(t, P1).length, 1, "P1 drew a card");
  }
  const none = smashTable(false);
  const before = Object.fromEntries(none.seats.map((seat) => [seat, none.engine.state.players[seat]!.influence]));
  play(none, P1, "ss", { selected: { sac: [none.id("sac")], loc: [none.id("loc")] } });
  assert.equal(pending(none), undefined, "no opponent is asked without the threshold");
  for (const seat of none.seats) assert.equal(none.engine.state.players[seat]!.influence, before[seat]);
});





