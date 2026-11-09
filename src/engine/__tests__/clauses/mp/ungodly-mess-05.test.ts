// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 5: clauses the spec marks `unchanged` (the data already says what the
// text means at N seats), proven at 3 seats (and 4 where a fourth seat adds something): Arrakis Eternity, Extremely Tiny Bonnet of
// Invisibility, Flesh Deliquesce, Quotidian Quagmire, Theological Opportunist, Zenobian Mechanics Explained, Demolition Investment,
// Thabbashite Glutton, War Racketeer, Yenassa Shipping LLP, Frantic Jerryrigging, Moment of Annihilation, Purloining Performance,
// Thabbashite Weapons Expert.
import assert from "node:assert/strict";
import type { PlayerId } from "../../../../engine.js";
import { bank, character, item, resourceCard, volition, resolvePendingResponses } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { mpClause, printing, refused } from "../_clause.js";
import { attachedCount } from "../_turn.js";
import { P1, P2, P3, P4, act, answerChoice, choose, chooseIndex, handOf, influence, mayPay, offered, pending, play, playRaw, playerAsk, requirements, seated, spent, table, type Table } from "./_ungodly-mess.js";

const ARRAKIS = "6ad7ed02-abe6-4b2a-a60a-1e12888c2e77"; // Arrakis Eternity
const BONNET = "808bd2ba-7b76-4d81-b733-425078db481a"; // Extremely Tiny Bonnet of Invisibility
const FLESH = "94a4916f-0dcf-48d0-b1ab-62aa40c26070"; // Flesh Deliquesce
const QUAGMIRE = "e89bc47b-90e9-48c3-8da8-1ce22e2847e0"; // Quotidian Quagmire
const OPPORTUNIST = "fb3bed57-05e1-44b3-a8c4-2f03bc876476"; // Theological Opportunist
const ZENOBIAN = "e1c896c0-6e2b-46af-9dbb-008146423145"; // Zenobian Mechanics Explained
const DEMOLITION = "453db85c-818d-4e89-a019-9abf16307109"; // Demolition Investment
const GLUTTON = "a0243e83-005c-4bec-8454-0bbb86489d3c"; // Thabbashite Glutton
const RACKETEER = "a49c3c32-ad10-4ffe-8814-aa68ddb666fa"; // War Racketeer
const YENASSA = "453a6b4d-a4c3-46f7-a9cc-9e043cde9f50"; // Yenassa Shipping, LLP
const JERRY = "a9c7ba1c-1080-4a81-932a-ab573c7a193f"; // Frantic Jerryrigging
const MOMENT = "c35705f0-9e26-4e6d-a682-0ff4d029166f"; // Moment of Annihilation
const PURLOIN = "ed4e38e3-0557-4bbf-92c3-6e02a2596bd3"; // Purloining Performance
const WEAPONS = "e8cd0ae5-9aba-4996-8a29-3f160b2d96f2"; // Thabbashite Weapons Expert

const factionOf = (t: Table, who: PlayerId): string => t.engine.state.players[who]!.factionId!;
const handCards = (owner: PlayerId, n: number, seats: number) =>
  seated(owner, seats) ? Array.from({ length: n }, (_, i) => ({ key: `h-${owner}-${i}`, def: character({ name: `Card ${owner} ${i}` }), owner, zone: "hand" as const })) : [];
const chars = (owner: PlayerId, names: string[], seats: number) => (seated(owner, seats) ? names.map(name => ({ key: name, def: character({ name }), owner })) : []);
const declareAttack = (t: Table, who: PlayerId, attackers: string[], target: PlayerId) =>
  t.engine.perform({ type: "declareAttack", playerId: who, attackerIds: attackers.map(key => t.id(key)), target: { type: "faction", playerId: target } } as never);

// ===================================================================================================================
// Arrakis Eternity: RECUR -- COST: Pay 2. Pick a player. Remove this card from the game. -- EFFECT: That player discards 3 cards.
// ===================================================================================================================

function arrakisTable(seats: number) {
  return table(seats, [
    { key: "ae", def: printing(ARRAKIS), owner: P1, zone: "discard" },
    ...bank("obsession", 3, P1),
    ...handCards(P1, 4, seats),
    ...handCards(P2, 4, seats),
    ...handCards(P3, 4, seats),
    ...handCards(P4, 4, seats)
  ]);
}
const arrakisAction = (t: Table, who: PlayerId) => ({ type: "activateAbility", playerId: P1, cardId: t.id("ae"), abilityId: "recur", selected: { p: [factionOf(t, who)] }, variables: {} });

mpClause(ARRAKIS, "1:ability:recur", 3, "3 seats: Pick a player offers the factions of P1, P2 and P3 (no opponent is chosen); the picked player discards 3 cards of their own choice", () => {
  const t = arrakisTable(3);
  assert.equal(playerAsk(t, arrakisAction(t, P3)), undefined, "no chooseOpponent step");
  const pick = requirements(t, { ...arrakisAction(t, P3), selected: {} }).find(need => need.kind === "pick")!;
  assert.deepEqual([...pick.candidates!].sort(), [P1, P2, P3].map(who => factionOf(t, who)).sort(), "every player's faction is a legal pick");
  act(t, arrakisAction(t, P3));
  assert.notEqual(zoneOf(t.engine, t.id("ae")), "discard", "removed from the game");
  assert.equal(pending(t)!.playerId, P3, "P3 (not P2) chooses");
  assert.deepEqual([...offered(t)].sort(), t.engine.state.players[P3]!.hand.slice().sort(), "from P3's hand");
  refused(() => choose(t, [t.id("h-p2-0"), t.id("h-p2-1"), t.id("h-p2-2")]), "cards of P2");
  choose(t, [t.id("h-p3-0"), t.id("h-p3-1"), t.id("h-p3-2")]);
  assert.equal(handOf(t.engine, P3).length, 1);
  assert.equal(handOf(t.engine, P2).length, 4, "P2's hand is unchanged");
  assert.equal(handOf(t.engine, P1).length, 4, "P1's hand is unchanged");

  const own = arrakisTable(3);
  act(own, arrakisAction(own, P1));
  assert.equal(pending(own)!.playerId, P1, "picking yourself: P1 discards");
  choose(own, [own.id("h-p1-0"), own.id("h-p1-1"), own.id("h-p1-2")]);
  assert.equal(handOf(own.engine, P1).length, 1);
  assert.equal(handOf(own.engine, P2).length, 4);
});

// ===================================================================================================================
// Extremely Tiny Bonnet of Invisibility: The attached character gains COVERT.
// ===================================================================================================================

function bonnetCovert(picked: PlayerId) {
  const t = table(3, [
    { key: "bon", def: printing(BONNET), owner: P1, zone: "hand" },
    { key: "host", def: character({ name: "Host", speed: 3 }), owner: P1 },
    { key: "foe2", def: character({ name: "Foe 2" }), owner: P2 },
    { key: "foe3", def: character({ name: "Foe 3" }), owner: P3 },
    ...bank("obsession", 2, P1),
    ...spent(P2, 2, 3),
    ...spent(P3, 2, 3)
  ]);
  act(t, { type: "playCard", playerId: P1, cardId: t.id("bon"), selected: { attachTo: [t.id("host")] }, variables: {}, players: { picked } });
  choose(t, []);
  assert.ok(t.engine.getKeywords(t.id("host")).includes("covert"), "t.engine.getKeywords(t.id('host')).includes('covert')");
  assert.equal(t.engine.getKeywords(t.id("foe2")).includes("covert"), false, "P2's character does not gain COVERT");
  assert.equal(t.engine.getKeywords(t.id("foe3")).includes("covert"), false, "P3's character does not gain COVERT");
  declareAttack(t, P1, ["host"], picked === P2 ? P3 : P2);
  resolvePendingResponses(t.engine);
  const defender = picked === P2 ? P3 : P2;
  refused(() => t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(defender === P2 ? "foe2" : "foe3")] } as never), `${defender}'s non-COVERT character blocking the COVERT attacker`);
  t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] } as never);
}
mpClause(BONNET, "2:rule", 3, "3 seats: the attached character has COVERT whichever opponent was picked in the cost (P2), and the opponents' characters do not", () => bonnetCovert(P2));
mpClause(BONNET, "2:rule", 3, "3 seats: ... also when the opponent picked in the cost was P3", () => bonnetCovert(P3));

// ===================================================================================================================
// Flesh Deliquesce: X is the number of detached resources that player controls ... If the character has X strength or less, destroy it.
// ===================================================================================================================

mpClause(FLESH, "1:rule", 3, "3 seats: X comes only from the picked opponent (P2: 1, P3: 4); the character pick is unrestricted", () => {
  const run = (picked: PlayerId, target: string): boolean => {
    const t = table(3, [
      { key: "fd", def: printing(FLESH), owner: P1, zone: "hand" },
      ...bank("obsession", 5, P1),
      ...bank("rage", 1, P2),
      ...bank("rage", 4, P3),
      { key: "p3s1", def: character({ name: "P3 s1", strength: 1 }), owner: P3 },
      { key: "p3s2", def: character({ name: "P3 s2", strength: 2 }), owner: P3 },
      { key: "p2s1", def: character({ name: "P2 s1", strength: 1 }), owner: P2 },
      { key: "p2s4", def: character({ name: "P2 s4", strength: 4 }), owner: P2 },
      { key: "p2s5", def: character({ name: "P2 s5", strength: 5 }), owner: P2 }
    ]);
    play(t, P1, "fd", { selected: { c: [t.id(target)] }, players: { picked } });
    return zoneOf(t.engine, t.id(target)) === "discard";
  };
  assert.equal(run(P2, "p3s1"), true, "P2 picked, X = 1: a P3 character with 1 strength is destroyed");
  assert.equal(run(P2, "p3s2"), false, "a P3 character with 2 strength survives");
  assert.equal(run(P2, "p2s1"), true, "a P2 character with 1 strength is destroyed too");
  assert.equal(run(P3, "p2s4"), true, "P3 picked, X = 4: a P2 character with 4 strength is destroyed");
  assert.equal(run(P3, "p2s5"), false, "5 strength survives");
});

// ===================================================================================================================
// Quotidian Quagmire: EXTRA COST: Pick a character. That character's controller may detach up to 2 resources from their faction.
// -- This turn, the character loses 1 speed. Draw a card.
// ===================================================================================================================

function quagmireTable(seats: number) {
  return table(seats, [
    { key: "qq", def: printing(QUAGMIRE), owner: P1, zone: "hand" },
    ...bank("obsession", 4, P1),
    { key: "dk", def: character({ name: "Deck card" }), owner: P1, zone: "deck" },
    { key: "own", def: character({ name: "P1 char", speed: 3 }), owner: P1 },
    { key: "c2", def: character({ name: "P2 char", speed: 3 }), owner: P2 },
    { key: "c3", def: character({ name: "P3 char", speed: 3 }), owner: P3 },
    ...spent(P1, 2, seats),
    ...spent(P2, 3, seats),
    ...spent(P3, 3, seats)
  ]);
}
const quagmireAction = (t: Table, target: string) => ({ type: "playCard", playerId: P1, cardId: t.id("qq"), selected: { c: [t.id(target)] }, variables: {} });
const speed = (t: Table, key: string): number => t.engine.getStat(t.id(key), "speed");

mpClause(QUAGMIRE, ["0:extraCost", "1:rule"], 3, "3 seats: the picked character's controller (P3, not P2 or P1) is asked to detach up to 2 of their resources; then it loses 1 speed and P1 draws", () => {
  const t = quagmireTable(3);
  assert.equal(playerAsk(t, quagmireAction(t, "c3")), undefined, "no opponent is chosen: the pick is a character");
  act(t, quagmireAction(t, "c3"));
  assert.equal(pending(t)!.playerId, P3, "the character's controller is asked");
  refused(() => choose(t, [t.engine.state.players[P2]!.play.find(id => t.engine.state.cards[id]!.attachedTo)!]), "a resource of P2");
  choose(t, t.engine.state.players[P3]!.play.filter(id => t.engine.state.cards[id]!.attachedTo === factionOf(t, P3)).slice(0, 2));
  assert.equal(pending(t), undefined);
  assert.equal(attachedCount(t.engine, P3), 1, "two of P3's resources were detached");
  assert.equal(attachedCount(t.engine, P2), 3, "P2's resources untouched");
  assert.equal(speed(t, "c3"), 2, "the picked character loses 1 speed");
  assert.equal(speed(t, "c2"), 3, "P2's characters keep their speed");
  assert.equal(handOf(t.engine, P1).includes(t.id("dk")), true, "P1 draws a card");

  const two = quagmireTable(3);
  act(two, quagmireAction(two, "c2"));
  assert.equal(pending(two)!.playerId, P2, "picking P2's character: P2 is asked, P3 is not");
  choose(two, []);
  assert.equal(attachedCount(two.engine, P2), 3, "detaching none is allowed");
  assert.equal(speed(two, "c2"), 2);

  const own = quagmireTable(3);
  act(own, quagmireAction(own, "own"));
  assert.equal(pending(own)!.playerId, P1, "picking P1's own character: P1 decides");
});

// ===================================================================================================================
// Theological Opportunist: This card loses strength and life equal to the number of cards in all hands.
// ===================================================================================================================

mpClause(OPPORTUNIST, "0:rule", 3, "3 seats: counts the cards in every player's hand (P1 1, P2 2, P3 3: -6/-6); a card more or less in any hand changes it by one", () => {
  const base = printing(OPPORTUNIST);
  const loss = (p1: number, p2: number, p3: number): number[] => {
    const t = table(3, [{ key: "to", def: printing(OPPORTUNIST), owner: P1 }, ...handCards(P1, p1, 3), ...handCards(P2, p2, 3), ...handCards(P3, p3, 3)]);
    return [base.strength! - t.engine.getStat(t.id("to"), "strength"), base.life! - t.engine.getStat(t.id("to"), "life")];
  };
  assert.deepEqual(loss(1, 2, 3), [6, 6]);
  assert.deepEqual(loss(1, 2, 4), [7, 7], "a card drawn by P3 makes it one smaller");
  assert.deepEqual(loss(1, 1, 3), [5, 5], "a card P2 plays from hand makes it one larger");
  assert.deepEqual(loss(0, 0, 3), [3, 3], "it is not limited to the controller's hand");
  assert.deepEqual(loss(0, 2, 0), [2, 2], "nor to one opponent's hand");
});

// ===================================================================================================================
// Zenobian Mechanics Explained: ... Put the character into its owner's hand. If you control an attacking party of at least 2 members,
// that player discards a card.
// ===================================================================================================================

function zenobianBattle(attackers: string[]) {
  const t = table(3, [
    { key: "zme", def: printing(ZENOBIAN), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "a1", def: character({ name: "A1", strength: 1, life: 4, speed: 1 }), owner: P1 },
    { key: "a2", def: character({ name: "A2", strength: 1, life: 4, speed: 1 }), owner: P1 },
    { key: "c3", def: character({ name: "P3 char" }), owner: P3 },
    ...handCards(P2, 2, 3),
    ...handCards(P3, 2, 3)
  ]);
  declareAttack(t, P1, attackers, P2);
  play(t, P1, "zme", { selected: { c: [t.id("c3")] } });
  return t;
}
mpClause(ZENOBIAN, "1:rule", 3, "3 seats: with a party of 2 the owner of the returned character (P3, not P2) discards a card of their choice; with a party of 1 nobody does", () => {
  const t = zenobianBattle(["a1", "a2"]);
  assert.equal(zoneOf(t.engine, t.id("c3")), "hand");
  assert.equal(pending(t)!.playerId, P3);
  assert.ok(offered(t).every(id => handOf(t.engine, P3).includes(id)), "from P3's hand");
  assert.ok(!offered(t).some(id => handOf(t.engine, P2).includes(id)), "!offered(t).some(id => handOf(t.engine, P2).includes(id))");
  const before = handOf(t.engine, P2).length;
  choose(t, [offered(t)[0]!]);
  assert.equal(handOf(t.engine, P2).length, before, "P2's hand is never affected");
  const one = zenobianBattle(["a1"]);
  assert.equal(pending(one), undefined, "a party of 1: nobody discards");
  assert.equal(zoneOf(one.engine, one.id("c3")), "hand");
});

// ===================================================================================================================
// Demolition Investment: EXTRA COST: Pick a player. Your faction loses 3 influence. -- That player reveals a face-down resource they
// control. Your faction gains influence equal to that card's numeric cost. Destroy that card.
// ===================================================================================================================

function demolitionTable(seats: number, o: { p3Resources?: boolean } = {}) {
  const fd = (owner: PlayerId, cost: number) => (seated(owner, seats) ? [{ key: `fd-${owner}`, def: resourceCard({ name: `Face-down ${owner}`, cost }), owner, zone: "play" as const, faceDown: true }] : []);
  return table(seats, [{ key: "di", def: printing(DEMOLITION), owner: P1, zone: "hand" }, ...bank("greed", 4, P1), ...fd(P2, 3), ...(o.p3Resources === false ? [] : fd(P3, 5)), ...fd(P4, 2)]);
}
const demolition = (t: Table, who: PlayerId) => ({ type: "playCard", playerId: P1, cardId: t.id("di"), selected: { p: [factionOf(t, who)] }, variables: {} });

mpClause(DEMOLITION, "0:extraCost", 3, "3 seats: Pick a player offers P1, P2 and P3 (no opponent is chosen); P1's faction loses 3 influence", () => {
  const t = demolitionTable(3);
  assert.equal(playerAsk(t, demolition(t, P1)), undefined);
  const pick = requirements(t, { ...demolition(t, P1), selected: {} }).find(need => need.kind === "pick")!;
  assert.deepEqual([...pick.candidates!].sort(), [P1, P2, P3].map(who => factionOf(t, who)).sort());
  const before = influence(t.engine, P1);
  act(t, demolition(t, P2));
  assert.ok(influence(t.engine, P1) < before + 1, "the cost is paid: 3 lost, then the destroyed card's cost gained");
});
mpClause(DEMOLITION, "1:rule", 3, "3 seats: only the picked player (P3, not P2) reveals one of their face-down resources: P1 gains its cost and it is destroyed", () => {
  const t = demolitionTable(3);
  const before = influence(t.engine, P1);
  act(t, demolition(t, P3));
  assert.equal(pending(t)!.playerId, P3, "the picked player reveals");
  choose(t, [t.id("fd-p3")]);
  assert.equal(influence(t.engine, P1), before - 3 + 5, "3 lost, 5 (the card's numeric cost) gained");
  assert.notEqual(zoneOf(t.engine, t.id("fd-p3")), "play", "destroyed");
  assert.equal(zoneOf(t.engine, t.id("fd-p2")), "play", "P2's resources are untouched");
  const none = demolitionTable(3, { p3Resources: false });
  const noneBefore = influence(none.engine, P1);
  act(none, demolition(none, P3));
  assert.equal(pending(none), undefined, "no face-down resource: nothing is revealed");
  assert.equal(influence(none.engine, P1), noneBefore - 3);
});

// ===================================================================================================================
// Thabbashite Glutton: When this card attacks, you may pick a card in a discard pile. If you do, remove it from the game.
// ===================================================================================================================

mpClause(GLUTTON, "0:rule@ggvv", 3, "3 seats: with the threshold met, cards in any player's discard pile (P1's, P2's, P3's, even P3 who is not in the battle) are legal picks, and it may be declined", () => {
  const board = () =>
    table(3, [
      { key: "gl", def: printing(GLUTTON), owner: P1 },
      ...bank("greed", 2, P1),
      ...volition(2, P1),
      { key: "d1", def: character({ name: "P1 discard" }), owner: P1, zone: "discard" },
      { key: "d2", def: character({ name: "P2 discard" }), owner: P2, zone: "discard" },
      { key: "d3", def: character({ name: "P3 discard" }), owner: P3, zone: "discard" }
    ]);
  const t = board();
  declareAttack(t, P1, ["gl"], P2);
  assert.equal(pending(t)!.kind, "chooserSelectsTarget");
  assert.equal(pending(t)!.playerId, P1);
  assert.deepEqual([...offered(t)].sort(), ["d1", "d2", "d3"].map(key => t.id(key)).sort());
  choose(t, [t.id("d3")]);
  assert.equal(zoneOf(t.engine, t.id("d3")), "removed", "P3's card is removed from the game");
  assert.equal(zoneOf(t.engine, t.id("d2")), "discard");
  const declined = board();
  declareAttack(declined, P1, ["gl"], P2);
  choose(declined, []);
  for (const key of ["d1", "d2", "d3"]) assert.equal(zoneOf(declined.engine, declined.id(key)), "discard");
});

// ===================================================================================================================
// War Racketeer: When this card enters play, draw a card for each character in play.
// ===================================================================================================================

mpClause(RACKETEER, "0:rule", 3, "3 seats: draws one card for each character in play under any player (1 + 2 + 3 + itself = 7)", () => {
  const t = table(3, [
    { key: "wr", def: printing(RACKETEER), owner: P1, zone: "hand" },
    ...bank("greed", 7, P1),
    ...chars(P1, ["m1"], 3),
    ...chars(P2, ["o1", "o2"], 3),
    ...chars(P3, ["q1", "q2", "q3"], 3),
    ...Array.from({ length: 9 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Deck ${i}` }), owner: P1, zone: "deck" as const }))
  ]);
  play(t, P1, "wr");
  assert.equal(handOf(t.engine, P1).length, 7, "6 other characters plus the Racketeer");
});

// ===================================================================================================================
// Yenassa Shipping, LLP: All items gain the rules text "At the start of your turn, you may pay 1. If you don't, destroy this card."
// ===================================================================================================================

mpClause(YENASSA, "2:rule", 3, "3 seats: every item is judged only at the start of its own controller's turn (P2's item on P2's turn), not at the others'", () => {
  const t = table(
    3,
    [
      { key: "y", def: printing(YENASSA), owner: P1 },
      { key: "i1", def: item({ name: "Item P1" }), owner: P1 },
      { key: "i2", def: item({ name: "Item P2" }), owner: P2 },
      { key: "i3", def: item({ name: "Item P3" }), owner: P3 },
      ...bank("greed", 1, P2)
    ]
  );
  act(t, { type: "endTurn", playerId: P1 });
  while (pending(t)?.kind === "orderTriggers") answerChoice(t, { kind: "orderTriggers", next: (pending(t)!.triggers as unknown[])[0] });
  const pc = pending(t)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P2, "P2, the item's controller, decides");
  mayPay(t, false);
  assert.equal(pending(t), undefined, "only one item is judged on P2's turn");
  assert.notEqual(zoneOf(t.engine, t.id("i2")), "play", "P2's item is destroyed");
  assert.equal(zoneOf(t.engine, t.id("i1")), "play", "P1's item does nothing on P2's turn");
  assert.equal(zoneOf(t.engine, t.id("i3")), "play", "P3's item does nothing on P2's turn");
});

// ===================================================================================================================
// Frantic Jerryrigging: EXTRA COST: Destroy an item you control. X is its numeric cost. -- Search your deck for an item with numeric cost
// X+2 or less ... or destroy an item your opponent controls with numeric cost X+2 or less.
// ===================================================================================================================

function jerryTable(seats: number) {
  return table(seats, [
    { key: "fj", def: printing(JERRY), owner: P1, zone: "hand" },
    ...bank("elitism", 3, P1),
    { key: "mine", def: item({ name: "Mine", cost: 1 }), owner: P1 },
    { key: "p2cheap", def: item({ name: "P2 cheap", cost: 2 }), owner: P2 },
    { key: "p2dear", def: item({ name: "P2 dear", cost: 5 }), owner: P2 },
    ...(seated(P3, seats) ? [{ key: "p3cheap", def: item({ name: "P3 cheap", cost: 2 }), owner: P3 }] : []),
    { key: "deckitem", def: item({ name: "Deck item", cost: 1 }), owner: P1, zone: "deck" }
  ]);
}
const jerry = (t: Table, opponent?: PlayerId) => ({ type: "playCard", playerId: P1, cardId: t.id("fj"), selected: { it: [t.id("mine")] }, variables: {}, ...(opponent ? { players: { opponent } } : {}) });

mpClause(JERRY, ["0:extraCost", "1:rule"], 3, "3 seats: the opponent is chosen when it is played (offering P2 and P3), the cost always comes from P1's own items, and the destroy option offers only the chosen opponent's items", () => {
  const t = jerryTable(3);
  assert.deepEqual(playerAsk(t, jerry(t)), { id: "opponent", candidates: [P2, P3] });
  act(t, jerry(t, P2));
  assert.equal(zoneOf(t.engine, t.id("mine")), "discard", "P1's own item is the cost");
  chooseIndex(t, 1);
  assert.deepEqual(offered(t), [t.id("p2cheap")], "only P2's item with cost <= X+2 = 3 (not P2's cost 5, not P3's cost 2)");
  choose(t, [t.id("p2cheap")]);
  assert.notEqual(zoneOf(t.engine, t.id("p2cheap")), "play");
  assert.equal(zoneOf(t.engine, t.id("p3cheap")), "play");

  const second = jerryTable(3);
  act(second, jerry(second, P3));
  chooseIndex(second, 1);
  assert.deepEqual(offered(second), [second.id("p3cheap")], "choosing P3 offers only P3's items");

  const search = jerryTable(3);
  assert.deepEqual(playerAsk(search, jerry(search)), { id: "opponent", candidates: [P2, P3] }, "asked even if the search option is taken later");
  act(search, jerry(search, P2));
  chooseIndex(search, 0);
  assert.ok(offered(search).every(id => search.engine.state.cards[id]!.ownerId === P1 && search.engine.state.cards[id]!.zone === "deck"), "the search is of P1's own deck");
  choose(search, [search.id("deckitem")]);
  assert.equal(zoneOf(search.engine, search.id("p2cheap")), "play", "nothing happens to P2");
  assert.equal(zoneOf(search.engine, search.id("p3cheap")), "play", "nothing happens to P3");

  const two = jerryTable(2);
  assert.equal(playerAsk(two, jerry(two)), undefined, "one opponent left: nobody is asked");
});

// ===================================================================================================================
// Moment of Annihilation: Pick a character. -- If the character has 4 life or less, destroy it.
// ===================================================================================================================

mpClause(MOMENT, "1:rule", 3, "3 seats: a character of P1, P2 or P3 is a legal pick; 4 life or less is destroyed, 5 survives", () => {
  const run = (key: string): string => {
    const t = table(3, [
      { key: "ma", def: printing(MOMENT), owner: P1, zone: "hand" },
      ...bank("deception", 5, P1),
      { key: "c1", def: character({ name: "c1", life: 4 }), owner: P1 },
      { key: "c2", def: character({ name: "c2", life: 4 }), owner: P2 },
      { key: "c3", def: character({ name: "c3", life: 4 }), owner: P3 },
      { key: "big", def: character({ name: "big", life: 5 }), owner: P3 }
    ]);
    act(t, { type: "playCard", playerId: P1, cardId: t.id("ma"), selected: { rm: [], c: [t.id(key)] }, variables: {}, players: { pile: P2 } });
    return zoneOf(t.engine, t.id(key));
  };
  for (const key of ["c1", "c2", "c3"]) assert.equal(run(key), "discard", `${key} is destroyed`);
  assert.equal(run("big"), "play", "5 life survives");
});

// ===================================================================================================================
// Purloining Performance: If you control an attacking party of at least 2 members, you may put up to 3 cards ... into their discard pile.
// ===================================================================================================================

mpClause(PURLOIN, "1:rule", 3, "3 seats: with a party of 1 member the discard option is not offered; P2's deck and discard pile never change", () => {
  const t = table(3, [
    { key: "pp", def: printing(PURLOIN), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1),
    { key: "a1", def: character({ name: "A1", strength: 1, life: 5, speed: 2 }), owner: P1 },
    ...Array.from({ length: 6 }, (_, i) => ({ key: `d2-${i}`, def: character({ name: `P2 deck ${i}` }), owner: P2, zone: "deck" as const })),
    ...Array.from({ length: 6 }, (_, i) => ({ key: `d3-${i}`, def: character({ name: `P3 deck ${i}` }), owner: P3, zone: "deck" as const }))
  ]);
  const p2 = [...t.engine.state.players[P2]!.deck];
  declareAttack(t, P1, ["a1"], P2);
  playRaw(t, P1, "pp", { players: { picked: P3 } });
  resolvePendingResponses(t.engine);
  answerChoice(t, { kind: "reorderDeck", order: t.engine.state.players[P3]!.deck.slice(0, 4) });
  assert.equal(pending(t), undefined, "no discard option with a party of 1");
  assert.deepEqual(t.engine.state.players[P2]!.deck, p2);
  assert.equal(t.engine.state.players[P2]!.discard.length, 0);
  assert.equal(t.engine.state.players[P3]!.discard.length, 0);
});

// ===================================================================================================================
// Thabbashite Weapons Expert: [V][V][V][V][V]: This card gains 2 strength.
// ===================================================================================================================

mpClause(WEAPONS, "1:rule@vvvvv", 3, "3 seats: with five [V] it has 2 more strength, without them it does not, whatever the number of opponents", () => {
  const base = printing(WEAPONS).strength!;
  const withV = table(3, [{ key: "we", def: printing(WEAPONS), owner: P1 }, ...volition(5, P1)]);
  assert.equal(withV.engine.getStat(withV.id("we"), "strength"), base + 2);
  const without = table(3, [{ key: "we", def: printing(WEAPONS), owner: P1 }, ...volition(4, P1)]);
  assert.equal(without.engine.getStat(without.id("we"), "strength"), base);
  const two = table(2, [{ key: "we", def: printing(WEAPONS), owner: P1 }, ...volition(5, P1)]);
  assert.equal(two.engine.getStat(two.id("we"), "strength"), base + 2);
});
