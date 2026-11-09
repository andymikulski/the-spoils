// Multiplayer clause tests, Holy Heist part 1: the clauses whose data changed for three or more seats (spec:
// data/card-tests/mp-spec/holy-heist.json, status "changes"). Real printings, real 3- and 4-seat games, `perform` only.

import assert from "node:assert/strict";
import { mpClause, printing } from "../_clause.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";
import { item, location as locationCard, tactic } from "../../support/fixtures.js";
import {
  P1, P2, P3, P4, activate, answer, attackOpen, bank, character, controllerOf, damageOf, discardOf, factionOf, filler, handOf, influenceOf, others, pending, pick, pickCandidates,
  play, playRequirements, refusal, resolvePendingResponses, seatsOf, sorted, table, tokens, volition, zoneOf,
  type CardPlacement, type Seats, type Table
} from "./_holy-heist.js";

// --- Forbidden Bibliotheca -----------------------------------------------------------------------------------------
// CHECK OUT -- COST: Deplete this card. Remove 2 tokens from this card. -- EFFECT: Each opponent discards 2 cards.

const BIB = "dd781007-94ae-48b3-a0dc-7a3a3d983bcf";

function bibTable(count: Seats): Table {
  return table(count, [
    { key: "bib", def: printing(BIB), owner: P1, zone: "play", counters: { token: 4 } },
    ...bank("obsession", 4, P1),
    ...filler("m", 3, P1),
    ...seatsOf(count).slice(1).flatMap((seat) => filler(`h${seat}-`, 3, seat))
  ]);
}

function checkOut(count: Seats): void {
  const t = bibTable(count);
  const opponents = others(count, P1);
  activate(t, P1, "bib", "bib-checkout");
  assert.equal(tokens(t, "bib"), 2, "COST: two tokens removed");
  assert.equal(t.engine.state.cards[t.id("bib")]!.depleted, true, "COST: depleted");
  // The opponents discard one after another, the active player's seat first and then clockwise (CR 402.2), each choosing from their own hand.
  for (const [index, seat] of opponents.entries()) {
    const pc = pending(t);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, seat, `${seat} chooses next`);
    for (const other of seatsOf(count).filter((s) => s !== seat))
      assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: seat, choice: { kind: "chooserSelectsTarget", selected: [t.id(`h${other}-0`)] } } as never), /./, `${seat} cannot discard ${other}'s card`);
    assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: seat, choice: { kind: "chooserSelectsTarget", selected: [t.id("m0"), t.id(`h${seat}-0`)] } } as never), /./, "not the controller's card either");
    pick(t, seat, `h${seat}-0`, `h${seat}-2`);
    for (const done of opponents.slice(0, index + 1)) {
      assert.equal(zoneOf(t, `h${done}-0`), "discard");
      assert.equal(zoneOf(t, `h${done}-2`), "discard");
      assert.equal(zoneOf(t, `h${done}-1`), "hand", "exactly two");
    }
    for (const later of opponents.slice(index + 1)) assert.equal(handOf(t, later).length, 3, `${later} has not discarded yet`);
  }
  assert.equal(pending(t), undefined);
  assert.equal(handOf(t, P1).length, 3, "the controller's hand is untouched");
}

mpClause(BIB, "4:ability:bib-checkout", 3, "3 seats: P1 checks out; P2 and P3 each choose and discard 2 cards from their own hand, in that order; P1's hand is unchanged", () => checkOut(3));
mpClause(BIB, "4:ability:bib-checkout", 4, "4 seats: P2, P3 and P4 each discard 2 cards of their own choice, in that order; P1 does not", () => checkOut(4));

// --- 0v3rw0rk3d 31f ------------------------------------------------------------------------------------------------
// [E][E][E][E][E][E]: Locations opponents control lose 1 structure.

const ELF = "7dd26a5f-d0dc-4231-b70a-d11b189f28db";
const location = (name: string): CardDefinition => locationCard({ name, structure: 5 });

function elfTable(count: Seats, elitism: number): Table {
  return table(count, [
    { key: "elf", def: printing(ELF), owner: P1, zone: "play" },
    ...bank("elitism", elitism, P1),
    ...seatsOf(count).map((seat) => ({ key: `loc-${seat}`, def: location(`Loc ${seat}`), owner: seat, zone: "play" as const }))
  ]);
}

function elfCheck(count: Seats): void {
  const t = elfTable(count, 6);
  assert.equal(t.engine.getStat(t.id("loc-p1"), "structure"), 5, "the controller's own locations lose none");
  for (const seat of others(count, P1)) assert.equal(t.engine.getStat(t.id(`loc-${seat}`), "structure"), 4, `${seat}'s location loses 1`);
  const without = elfTable(count, 5);
  for (const seat of seatsOf(count)) assert.equal(without.engine.getStat(without.id(`loc-${seat}`), "structure"), 5, "without the threshold nobody loses structure");
}

mpClause(ELF, "1:rule@eeeeee", 3, "3 seats: with [E] x6 the locations P2 controls and the locations P3 controls each lose 1 structure; P1's lose none; without the threshold nobody's do", () => elfCheck(3));
mpClause(ELF, "1:rule@eeeeee", 4, "4 seats: P2's, P3's and P4's locations each lose 1 structure; P1's do not", () => elfCheck(4));

// --- Underdog ------------------------------------------------------------------------------------------------------
// This card gains X strength, where X is the number of characters in play that your opponents own.

const UNDERDOG = "d000169f-1416-41e4-a603-3fc3bed83e46";

function underdogCheck(count: Seats): void {
  const cards: CardPlacement[] = [
    { key: "dog", def: printing(UNDERDOG), owner: P1, zone: "play" },
    ...filler("a", 2, P1, "play"),
    ...filler("b", 2, P2, "play"),
    ...filler("c", 1, P3, "play"),
    ...(count === 4 ? filler("d", 2, P4, "play") : [])
  ];
  const t = table(count, cards);
  const base = printing(UNDERDOG).strength ?? 0;
  const bonus = () => t.engine.getStat(t.id("dog"), "strength") - base;
  assert.equal(bonus(), count === 4 ? 5 : 3, "every opponent's characters, counted together");
  // Ownership decides: a character P1 owns under P2's control does not count, a P3-owned one under P2's control does.
  t.engine.state.cards[t.id("a0")]!.controllerId = P2;
  t.engine.state.cards[t.id("c0")]!.controllerId = P2;
  assert.equal(bonus(), count === 4 ? 5 : 3, "the control changes do not change the count by owner");
  // A P3-owned character leaves play: one fewer.
  t.engine.state.cards[t.id("c0")]!.zone = "discard";
  t.engine.state.players[P3]!.play = t.engine.state.players[P3]!.play.filter((id) => id !== t.id("c0"));
  t.engine.state.players[P2]!.play = t.engine.state.players[P2]!.play.filter((id) => id !== t.id("c0"));
  assert.equal(bonus(), count === 4 ? 4 : 2);
}

mpClause(UNDERDOG, "0:rule", 3, "3 seats: P2 owns 2 and P3 owns 1 character in play: +3 strength by owner; P1's own characters never count; a P3-owned character leaving drops it to +2", () => underdogCheck(3));
mpClause(UNDERDOG, "0:rule", 4, "4 seats: with P4 owning 2 characters Underdog gains 5 strength", () => underdogCheck(4));

// --- Thabbashite Urchin --------------------------------------------------------------------------------------------
// [V][V][V]: While an opponent controls an item, this card cannot be blocked.

const URCHIN = "e4730213-75fc-4614-9466-1b3c1e42e630";

mpClause(URCHIN, "0:rule@vvv", 3, "3 seats: [V][V][V] and an item controlled by P3 (not P2) makes it unblockable; an item only P1 controls does not; when P3's item leaves it can be blocked again", () => {
  const t = table(3, [
    { key: "urchin", def: printing(URCHIN), owner: P1, zone: "play" },
    ...volition(3, P1),
    { key: "own-item", def: item({ name: "Own Item" }), owner: P1, zone: "play" },
    ...filler("blocker", 1, P2, "play"),
    { key: "their-item", def: item({ name: "Their Item" }), owner: P3, zone: "play" }
  ]);
  const unblockable = (): boolean => t.engine.hasKeyword(t.id("urchin"), "cannotBeBlocked");
  assert.equal(unblockable(), true, "P3 controls an item (P2 controls none)");
  t.engine.state.cards[t.id("their-item")]!.zone = "discard";
  t.engine.state.players[P3]!.play = t.engine.state.players[P3]!.play.filter((id) => id !== t.id("their-item"));
  assert.equal(unblockable(), false, "only P1's own item remains: it does not count");
  const flipped = table(3, [
    { key: "urchin", def: printing(URCHIN), owner: P1, zone: "play" },
    ...volition(2, P1),
    { key: "their-item", def: item({ name: "Their Item" }), owner: P2, zone: "play" }
  ]);
  assert.equal(flipped.engine.hasKeyword(flipped.id("urchin"), "cannotBeBlocked"), false, "without [V][V][V] it can be blocked");
});

// --- Subdermal Micromajig ------------------------------------------------------------------------------------------
// EXTRA COST: Pick an opponent. Destroy a Micromajig token you control.
// Destroy an attacking character that player controls. That player puts a Micromajig token into play under their control.

const SM = "7a303331-f7dd-4abc-b223-ef0b033db6b9";

function smTable(): Table {
  const t = table(
    3,
    [
      { key: "sm", def: printing(SM), owner: P1, zone: "hand" },
      { key: "tok", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "Raider Two" }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Idle Two" }), owner: P2, zone: "play" },
      { key: "a3", def: character({ name: "Raider Three" }), owner: P3, zone: "play" },
      ...bank("elitism", 4, P1)
    ],
    { active: P2 }
  );
  t.engine.state.cards[t.id("tok")]!.isToken = true;
  return t;
}
const microTokens = (t: Table, who: string): number =>
  Object.values(t.engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === who && c.isToken && t.engine.getDefinition(c.id).name === "Micromajig").length;

mpClause(SM, "0:extraCost", 3, "3 seats: the opponent pick offers P2's and P3's factions and not P1's; P1 picks P3 and no other opponent step appears", () => {
  const t = smTable();
  attackOpen(t, P2, ["a2"], { type: "faction", playerId: P1 });
  assert.deepEqual(sorted(pickCandidates(t, P1, "sm", "p")), sorted([factionOf(t, P2), factionOf(t, P3)]));
  assert.deepEqual(playRequirements(t, P1, "sm").filter((r) => r.kind === "players"), [], "no opponent is selected for the block");
  refusal(() => play(t, P1, "sm", { selected: { p: [factionOf(t, P1)], tok: [t.id("tok")] } }));
  play(t, P1, "sm", { selected: { p: [factionOf(t, P3)], tok: [t.id("tok")] } });
  assert.equal(microTokens(t, P1), 0, "the token was destroyed as the cost");
});

mpClause(SM, "1:rule", 3, "3 seats: P2 attacks P1's faction and P1 picks P2: P2's attacker is destroyed and P2 (not P3) puts a Micromajig token into play", () => {
  const t = smTable();
  attackOpen(t, P2, ["a2"], { type: "faction", playerId: P1 });
  play(t, P1, "sm", { selected: { p: [factionOf(t, P2)], tok: [t.id("tok")] } });
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.equal(pending(t)?.playerId, P1);
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("a3")] } } as never), /./, "P3's character is not a legal target");
  pick(t, P1, "a2");
  assert.equal(zoneOf(t, "a2"), "discard");
  assert.equal(zoneOf(t, "b2"), "play", "P2's other characters are untouched");
  assert.equal(zoneOf(t, "a3"), "play");
  assert.equal(microTokens(t, P2), 1, "the picked player puts the token into play");
  assert.equal(microTokens(t, P3), 0);
  assert.equal(microTokens(t, P1), 0);
});

mpClause(SM, "1:rule", 3, "3 seats: P2's character is the only attacker and P1 picks P3: P2's character survives and P3 still puts a Micromajig token into play", () => {
  const t = smTable();
  attackOpen(t, P2, ["a2"], { type: "faction", playerId: P1 });
  play(t, P1, "sm", { selected: { p: [factionOf(t, P3)], tok: [t.id("tok")] } });
  if (pending(t)) {
    assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("a2")] } } as never), /./, "P2's attacker is not controlled by the picked player");
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
    resolvePendingResponses(t.engine);
  }
  assert.equal(zoneOf(t, "a2"), "play");
  assert.equal(zoneOf(t, "a3"), "play");
  assert.equal(microTokens(t, P3), 1);
  assert.equal(microTokens(t, P2), 0);
});

// --- Thieving Casino -----------------------------------------------------------------------------------------------
// CASH OUT -- COST: Deplete this card. Pick a character in an opponent's discard pile. X is its numeric cost. Pay X+4. -- EFFECT: Put it into play under your control.

const CASINO = "c1fdf3be-4790-4560-a4a0-920a951833a4";

mpClause(CASINO, "1:ability:thieving-casino-cashout", 3, "3 seats: the pick offers the characters in P2's and P3's discard piles but not P1's own; P1 takes P3's cost-2 character for X+4 = 6 and P2's pile is unchanged", () => {
  const t = table(3, [
    { key: "tc", def: printing(CASINO), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "discard" },
    { key: "c2", def: character({ name: "Two Corpse", cost: 3 }), owner: P2, zone: "discard" },
    { key: "c3", def: character({ name: "Three Corpse", cost: 2 }), owner: P3, zone: "discard" },
    { key: "spare", def: character({ name: "Spare", cost: 2 }), owner: P3, zone: "hand" },
    ...bank("deception", 8, P1)
  ]);
  assert.deepEqual(sorted(pickCandidates(t, P1, "tc", "ch", { abilityId: "thieving-casino-cashout" })), sorted([t.id("c2"), t.id("c3")]));
  const ready = t.engine.getAvailableResourceCount(P1);
  activate(t, P1, "tc", "thieving-casino-cashout", { selected: { ch: [t.id("c3")] } });
  assert.equal(ready - t.engine.getAvailableResourceCount(P1), 6, "X + 4 with X = 2");
  assert.equal(t.engine.state.cards[t.id("tc")]!.depleted, true);
  assert.equal(zoneOf(t, "c3"), "play");
  assert.equal(controllerOf(t, "c3"), P1, "under P1's control");
  assert.equal(zoneOf(t, "c2"), "discard", "P2's pile is unchanged");
  refusal(() => activate(table(3, [
    { key: "tc", def: printing(CASINO), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "discard" },
    ...bank("deception", 8, P1)
  ]), P1, "tc", "thieving-casino-cashout", { selected: { ch: [] } }));
});

// --- Gathering of Unlikely Heroes ----------------------------------------------------------------------------------
// EXTRA COST: Deploy this only during your turn and not during a battle. Pick an opponent.

const GATHERING = "b8166db8-01ba-4103-bfee-dfece934c330";

function gatheringTable(active: PlayerId): Table {
  return table(
    3,
    [
      { key: "guh", def: printing(GATHERING), owner: P1, zone: "hand" },
      ...volition(1, P1),
      ...bank("obsession", 3, P1),
      ...filler("deck", 3, P1, "deck"),
      { key: "atk1", def: character({ name: "Attacker One" }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker Two" }), owner: P2, zone: "play" },
      ...filler("p3c", 1, P3, "play")
    ],
    { active }
  );
}

mpClause(GATHERING, "0:extraCost", 3, "3 seats: on P1's own turn outside a battle the opponent pick offers P2's and P3's factions; refused during P2's turn and during any battle", () => {
  const t = gatheringTable(P1);
  assert.deepEqual(sorted(pickCandidates(t, P1, "guh", "p")), sorted([factionOf(t, P2), factionOf(t, P3)]));
  assert.deepEqual(playRequirements(t, P1, "guh").filter((r) => r.kind === "players"), []);
  assert.equal(t.engine.getCardPlayability(P1, t.id("guh")).legalTiming, true);

  const theirTurn = gatheringTable(P2);
  assert.equal(theirTurn.engine.getCardPlayability(P1, theirTurn.id("guh")).legalTiming, false, "not during P2's turn");
  assert.equal(refusal(() => play(theirTurn, P1, "guh", { selected: { p: [factionOf(theirTurn, P3)] } })).length > 0, true);

  const elsewhere = gatheringTable(P2);
  elsewhere.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [elsewhere.id("atk2")], target: { type: "faction", playerId: P3 } } as never);
  assert.ok(elsewhere.engine.state.battle, "P2 attacks P3: a battle P1 is not in");
  assert.equal(elsewhere.engine.getCardPlayability(P1, elsewhere.id("guh")).legalTiming, false, "not during a battle that P1 is not in");

  const own = gatheringTable(P1);
  own.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [own.id("atk1")], target: { type: "faction", playerId: P2 } } as never);
  assert.equal(own.engine.getCardPlayability(P1, own.id("guh")).legalTiming, false, "not during P1's own battle");
});

// --- Dizzying Blow -------------------------------------------------------------------------------------------------
// EXTRA COST: Pick a character that is attacking your faction. Inflict 1 damage to the character and remove it from the battle. Draw a card.

const BLOW = "b6b6b202-7629-49e6-a451-7b2e3feb6c11";

function blowTable(active: PlayerId): Table {
  return table(
    3,
    [
      { key: "blow", def: printing(BLOW), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...filler("dk", 4, P1, "deck"),
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "Attack Two", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2b", def: character({ name: "Attack Two B", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "a3", def: character({ name: "Attack Three", strength: 2, life: 5, speed: 3 }), owner: P3, zone: "play" },
      { key: "loc", def: locationCard({ name: "Loc", structure: 9 }), owner: P1, zone: "play" }
    ],
    { active }
  );
}

mpClause(BLOW, "0:extraCost", 3, "3 seats: P2 attacks P1's faction: P2's attackers are legal picks; P3 attacking P2, P2 attacking P1's location, and P1's own characters are not", () => {
  const t = blowTable(P2);
  attackOpen(t, P2, ["a2"], { type: "faction", playerId: P1 });
  assert.deepEqual(pickCandidates(t, P1, "blow", "c"), [t.id("a2")], "only the attacking character of the attack on P1's faction");
  assert.deepEqual(playRequirements(t, P1, "blow").filter((r) => r.kind === "players"), [], "no chooseOpponent step");

  const onPlayer = blowTable(P3);
  attackOpen(onPlayer, P3, ["a3"], { type: "faction", playerId: P2 });
  assert.deepEqual(pickCandidates(onPlayer, P1, "blow", "c"), [], "P3 attacks P2's faction: not an attack on P1's faction");

  const onLocation = blowTable(P2);
  attackOpen(onLocation, P2, ["a2"], { type: "card", cardId: onLocation.id("loc") });
  assert.deepEqual(pickCandidates(onLocation, P1, "blow", "c"), [], "P2 attacks P1's location, not the faction");

  const third = blowTable(P3);
  attackOpen(third, P3, ["a3"], { type: "faction", playerId: P1 });
  assert.deepEqual(pickCandidates(third, P1, "blow", "c"), [third.id("a3")], "whichever opponent attacks P1's faction");
});

mpClause(BLOW, "1:rule", 3, "3 seats: the picked attacker takes 1 damage and leaves the battle, and P1 (not P2, not P3) draws a card; the same when P3 is the attacker", () => {
  for (const attacker of [P2, P3] as const) {
    const key = attacker === P2 ? "a2" : "a3";
    const t = blowTable(attacker);
    attackOpen(t, attacker, [key], { type: "faction", playerId: P1 });
    const hands = { p1: handOf(t, P1).length, p2: handOf(t, P2).length, p3: handOf(t, P3).length };
    play(t, P1, "blow", { selected: { c: [t.id(key)] } });
    assert.equal(damageOf(t, key), 1);
    assert.equal(t.engine.state.battle?.attackingParty.includes(t.id(key)) ?? false, false, "removed from the battle");
    assert.equal(handOf(t, P1).length, hands.p1 - 1 + 1, "P1 drew a card");
    assert.equal(handOf(t, P2).length, hands.p2);
    assert.equal(handOf(t, P3).length, hands.p3);
    for (const other of ["a2", "a2b", "a3"].filter((k) => k !== key)) assert.equal(damageOf(t, other), 0, `${other} is untouched`);
  }
});

// --- Phantasmagoric Tollbooth --------------------------------------------------------------------------------------
// [R][R][R][R][R][R]: When a character an opponent owns is put into their discard pile from anywhere, you may pay 1. If you do, pick a faction and inflict 1 damage to it.

const TOLL = "d70efc6c-9a6e-41ab-92a2-cb97662f172f";
const killer = (): CardDefinition =>
  tactic({
    name: "Kill",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

function tollTable(rage = 8): Table {
  return table(3, [
    { key: "toll", def: printing(TOLL), owner: P1, zone: "play" },
    { key: "kill", def: killer(), owner: P1, zone: "hand" },
    ...bank("rage", rage, P1),
    { key: "c2", def: character({ name: "P2 Owned" }), owner: P2, zone: "play", controller: P3 },
    { key: "c3", def: character({ name: "P3 Owned" }), owner: P3, zone: "play" },
    { key: "c1", def: character({ name: "P1 Owned" }), owner: P1, zone: "play", controller: P2 }
  ]);
}

mpClause(TOLL, "2:rule@rrrrrr", 3, "3 seats: a character P2 owns (under P3's control) is destroyed: P1 may pay 1 and pick any faction; a P3-owned one triggers it too; a P1-owned one under P2's control does not", () => {
  for (const [victim, factionPlayer] of [["c2", P3], ["c3", P2], ["c2", P1]] as const) {
    const t = tollTable();
    play(t, P1, "kill", { selected: { t: [t.id(victim)] } });
    assert.equal(pending(t)?.kind, "mayPay", `${victim}`);
    assert.equal(pending(t)?.playerId, P1, "the controller is asked");
    const before = Object.fromEntries(t.seats.map((seat) => [seat, influenceOf(t, seat)]));
    const ready = t.engine.getAvailableResourceCount(P1);
    answer(t, "mayPay", P1, { kind: "mayPay", pay: true });
    assert.equal(ready - t.engine.getAvailableResourceCount(P1), 1, "paid 1");
    answer(t, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [factionOf(t, factionPlayer)] });
    for (const seat of t.seats) assert.equal(before[seat]! - influenceOf(t, seat), seat === factionPlayer ? 1 : 0, `${seat}'s faction after picking ${factionPlayer}'s`);
  }
  const own = tollTable();
  play(own, P1, "kill", { selected: { t: [own.id("c1")] } });
  assert.equal(zoneOf(own, "c1"), "discard");
  assert.equal(pending(own), undefined, "a character P1 owns going to P1's discard pile from under P2's control does not trigger it");
});

// --- Raging Ferocity -----------------------------------------------------------------------------------------------
// FLIP IT: [R] -- COST: ... Reveal this card. Pick a player. X is number of resources that player controls. Y is the number of resources you control. Pay 4.
// -- EFFECT: Put this card into play face-up. Inflict X - Y damage to the picked player's faction.

const FEROCITY = "9192b2fa-b568-4ac1-bfd9-b9cb31d8fa42";

function ferocityTable(): Table {
  return table(3, [
    { key: "rf", def: printing(FEROCITY), owner: P1, zone: "play", faceDown: true },
    ...bank("rage", 5, P1),
    ...bank("greed", 10, P2),
    ...bank("greed", 8, P3)
  ]);
}

mpClause(FEROCITY, "2:ability:flip-it", 3, "3 seats: X counts only the picked player's resources: picking P2 (10 vs P1's 6) deals 4 to P2's faction only, picking P3 (8) deals 2 to P3's, picking P1 deals none", () => {
  for (const [picked, damage] of [[P2, 4], [P3, 2], [P1, 0]] as const) {
    const t = ferocityTable();
    const before = Object.fromEntries(t.seats.map((seat) => [seat, influenceOf(t, seat)]));
    assert.deepEqual(playRequirements(t, P1, "rf", "flip-it").filter((r) => r.kind === "players"), [], "no chooseOpponent step");
    activate(t, P1, "rf", "flip-it", { selected: { fac: [factionOf(t, picked)] } });
    assert.equal(t.engine.state.cards[t.id("rf")]!.faceDown, false, "flipped face up");
    for (const seat of t.seats) assert.equal(before[seat]! - influenceOf(t, seat), seat === picked ? damage : 0, `${seat} after picking ${picked}`);
  }
});

// --- Craniata Nester -----------------------------------------------------------------------------------------------
// This card gains 1 strength and 1 life for each character card in each opponent's discard pile.

const NESTER = "1a1d1224-d3ac-4a6f-bf31-01cd5477f1d7";

function nesterCheck(count: Seats): void {
  const base = printing(NESTER);
  const t = table(count, [
    { key: "nest", def: base, owner: P1, zone: "play" },
    ...filler("m", 3, P1, "discard"),
    ...filler("a", 2, P2, "discard"),
    { key: "tac", def: tactic({ name: "Spent" }), owner: P2, zone: "discard" },
    ...filler("b", 1, P3, "discard"),
    ...(count === 4 ? filler("d", 2, P4, "discard") : [])
  ]);
  const bonus = (stat: "strength" | "life"): number => t.engine.getStat(t.id("nest"), stat) - (stat === "strength" ? base.strength ?? 0 : base.life ?? 0);
  const expected = count === 4 ? 5 : 3;
  assert.equal(bonus("strength"), expected, "every opponent's character cards counted together; tactics and P1's own do not count");
  assert.equal(bonus("life"), expected);
  t.engine.state.cards[t.id("b0")]!.zone = "play";
  t.engine.state.players[P3]!.discard = [];
  assert.equal(bonus("strength"), expected - 1, "a character card leaving P3's pile drops the bonus by one");
}

mpClause(NESTER, "1:rule", 3, "3 seats: P2's pile holds 2 character cards and a tactic, P3's 1, P1's own 3: +3 / +3; a character card leaving P3's pile makes it +2 / +2", () => nesterCheck(3));
mpClause(NESTER, "1:rule", 4, "4 seats: with P4's pile holding 2 character cards the bonus is +5 / +5", () => nesterCheck(4));

// --- Cheats, the Dirty Rotten --------------------------------------------------------------------------------------
// EXTRA COST: Pick an opponent.
// When this card enters play, if you picked an opponent as part of its cost, search that player's deck for 4 non-resource cards with different names, reveal them and put them into the void. If you do, randomly put 2 of those cards into their discard pile. ...

const CHEATS = "6d385d6a-39e5-4b8f-b68b-3519ca99268a";

function cheatsTable(): Table {
  return table(3, [
    { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
    ...bank("deception", 5, P1),
    ...["a", "b", "c", "d", "e"].map((n) => ({ key: `two-${n}`, def: character({ name: `Two ${n}` }), owner: P2, zone: "deck" as const })),
    ...["a", "b", "c", "d", "e"].map((n) => ({ key: `three-${n}`, def: character({ name: `Three ${n}` }), owner: P3, zone: "deck" as const })),
    ...filler("mine", 3, P1, "deck")
  ]);
}

mpClause(CHEATS, "1:extraCost", 3, "3 seats: the opponent pick offers P2's and P3's factions and not P1's; P1 picks P3 and no further opponent step appears", () => {
  const t = cheatsTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "cheats", "opp")), sorted([factionOf(t, P2), factionOf(t, P3)]));
  assert.deepEqual(playRequirements(t, P1, "cheats").filter((r) => r.kind === "players"), []);
  refusal(() => play(t, P1, "cheats", { selected: { opp: [factionOf(t, P1)] } }));
  play(t, P1, "cheats", { selected: { opp: [factionOf(t, P3)] } });
  assert.equal(zoneOf(t, "cheats"), "play");
});

mpClause(CHEATS, "2:rule", 3, "3 seats: with P3 picked P1 searches P3's deck (not P2's) for 4 different non-resource cards, they go to the void and 2 at random to P3's discard pile; P2's deck is untouched", () => {
  for (const [picked, other] of [[P3, "two"], [P2, "three"]] as const) {
    const t = cheatsTable();
    const pickedKey = picked === P3 ? "three" : "two";
    play(t, P1, "cheats", { selected: { opp: [factionOf(t, picked)] } });
    assert.equal(pending(t)?.kind, "chooserSelectsTarget");
    assert.equal(pending(t)?.playerId, P1, "the controller searches");
    assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id(`${other}-a`), t.id(`${other}-b`), t.id(`${other}-c`), t.id(`${other}-d`)] } } as never), /./, "the other opponent's deck is not searched");
    assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("mine0"), t.id(`${pickedKey}-b`), t.id(`${pickedKey}-c`), t.id(`${pickedKey}-d`)] } } as never), /./, "not P1's own deck");
    pick(t, P1, ...["a", "b", "c", "d"].map((n) => `${pickedKey}-${n}`));
    const zones = ["a", "b", "c", "d"].map((n) => zoneOf(t, `${pickedKey}-${n}`));
    assert.equal(zones.filter((z) => z === "discard").length, 2, "2 of them at random go to the discard pile");
    assert.equal(zones.filter((z) => z === "void").length, 2, "the rest stay in the void");
    assert.equal(discardOf(t, picked).length, 2, "the discard pile is the picked player's");
    assert.equal(zoneOf(t, `${pickedKey}-e`), "deck");
    for (const n of ["a", "b", "c", "d", "e"]) assert.equal(zoneOf(t, `${other}-${n}`), "deck", `the other opponent's ${n} stays in the deck`);
  }
});

// --- Profane Proposal ----------------------------------------------------------------------------------------------
// EXTRA COST: Pick an opponent.

const PROFANE = "7f75ce4c-b81e-45a9-973a-1bbe50fb43e4";

mpClause(PROFANE, "0:extraCost", 3, "3 seats: the opponent pick offers P2's and P3's factions and not P1's; P1 picks P3 and no further opponent step appears", () => {
  const t = table(3, [
    { key: "pp", def: printing(PROFANE), owner: P1, zone: "hand" },
    ...bank("obsession", 6, P1),
    ...filler("deck", 6, P1, "deck")
  ]);
  assert.deepEqual(sorted(pickCandidates(t, P1, "pp", "p")), sorted([factionOf(t, P2), factionOf(t, P3)]));
  assert.deepEqual(playRequirements(t, P1, "pp").filter((r) => r.kind === "players"), []);
  refusal(() => play(t, P1, "pp", { selected: { p: [factionOf(t, P1)] } }));
  play(t, P1, "pp", { selected: { p: [factionOf(t, P3)] } });
  assert.equal(pending(t)?.kind, "chooserSelectsTarget", "it was played with P3 picked: the search is next");
  assert.equal(pending(t)?.playerId, P1, "the search is P1's");
});

// --- Blitz of Destruction ------------------------------------------------------------------------------------------
// EXTRA COST: Pick a player that controls more resources than you.
// That player destroys a face-down resource they control.

const BLITZ = "3f5aab3e-81e1-46be-98e7-b55fbd60c047";

function blitzTable(mine: number, p2: number, p3: number): Table {
  return table(3, [
    { key: "blitz", def: printing(BLITZ), owner: P1, zone: "hand" },
    ...bank("rage", mine, P1),
    ...volition(p2, P2),
    ...volition(p3, P3)
  ]);
}
const faceDownOf = (t: Table, who: PlayerId): string[] =>
  Object.values(t.engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === who && c.faceDown).map((c) => c.id);

mpClause(BLITZ, "0:extraCost", 3, "3 seats: P1 controls 3 resources, P2 5, P3 2: only P2 qualifies; with P3 at 4 both do; with nobody above P1 the card cannot be played; P1 cannot pick itself", () => {
  const t = blitzTable(3, 5, 2);
  assert.deepEqual(playRequirements(t, P1, "blitz"), [{ kind: "players", choices: [{ id: "p", candidates: [P2, P3] }] }], "the player is named with the play (a player choice, not a card pick)");
  refusal(() => play(t, P1, "blitz", { players: { p: P3 } }));
  refusal(() => play(t, P1, "blitz", { players: { p: P1 } }));
  refusal(() => play(t, P1, "blitz"));
  assert.equal(zoneOf(t, "blitz"), "hand", "nothing was played");
  play(t, P1, "blitz", { players: { p: P2 } });
  assert.notEqual(zoneOf(t, "blitz"), "hand", "P2 controls more resources than P1");

  const both = blitzTable(3, 5, 4);
  play(both, P1, "blitz", { players: { p: P3 } });
  assert.notEqual(zoneOf(both, "blitz"), "hand", "with 4 resources P3 also controls more");

  const none = blitzTable(3, 3, 2);
  refusal(() => play(none, P1, "blitz", { players: { p: P2 } }));
  refusal(() => play(none, P1, "blitz", { players: { p: P3 } }));
  assert.equal(zoneOf(none, "blitz"), "hand");
});

mpClause(BLITZ, "1:rule", 3, "3 seats: the picked player (P2, not P3) chooses and destroys a face-down resource they control; picking P3 (4 resources) has only P3 choose", () => {
  for (const [picked, bystander, p2, p3] of [[P2, P3, 5, 2], [P3, P2, 2, 4]] as const) {
    const t = blitzTable(3, p2, p3);
    const pickedBefore = faceDownOf(t, picked);
    const bystanderBefore = faceDownOf(t, bystander);
    play(t, P1, "blitz", { players: { p: picked } });
    const pc = pending(t);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, picked, "the picked player chooses");
    assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: picked, choice: { kind: "chooserSelectsTarget", selected: [bystanderBefore[0]!] } } as never), /./, "not the other player's resource");
    answer(t, "chooserSelectsTarget", picked, { kind: "chooserSelectsTarget", selected: [pickedBefore[0]!] });
    assert.equal(faceDownOf(t, picked).length, pickedBefore.length - 1);
    assert.equal(faceDownOf(t, bystander).length, bystanderBefore.length, "the other player's resources are unchanged");
  }
});


