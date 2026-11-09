// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 3 (Carnival Whipmaster, Conniving Puppeteer, Moment of Annihilation,
// Omahkapi'si Pi'kssii, Purloining Performance).
import assert from "node:assert/strict";
import { bank, character, item, resolvePendingResponses, tactic } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { clause, printing, refused } from "../_clause.js";
import { P1, P2, P3, P4, act, activate, answerChoice, choosePlayer, chooseIndex, handOf, pending, play, playRaw, playerAsk, ready, seated, table, type Table } from "./_ungodly-mess.js";
import type { PlayerId } from "../../../../engine.js";

const WHIP = "2f3399c9-e12b-423d-88e7-e23850939fab"; // Carnival Whipmaster
const PUPPETEER = "540939e9-45c3-4f51-bc1c-2078048463e2"; // Conniving Puppeteer
const MOMENT = "c35705f0-9e26-4e6d-a682-0ff4d029166f"; // Moment of Annihilation
const OMAHKAPI = "7a1759c9-392a-4655-94c7-8d9893904130"; // Omahkapi'si Pi'kssii
const PURLOIN = "ed4e38e3-0557-4bbf-92c3-6e02a2596bd3"; // Purloining Performance

const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;

// ===================================================================================================================
// Carnival Whipmaster
// GRAND THEFT -- COST: Destroy this card. -- EFFECT: Take control of one character and one item an opponent controls.
// (You must take control of one of each type.)
// ===================================================================================================================

function whipTable(seats: number, o: { split?: boolean } = {}) {
  const owns = (owner: PlayerId, withChar: boolean, withItem: boolean) =>
    seated(owner, seats)
      ? [
          ...(withChar ? [{ key: `ch-${owner}`, def: character({ name: `Char ${owner}` }), owner }] : []),
          ...(withItem ? [{ key: `it-${owner}`, def: item({ name: `Item ${owner}` }), owner }] : [])
        ]
      : [];
  return table(seats, [
    { key: "wm", def: printing(WHIP), owner: P1 },
    ...owns(P1, true, true),
    ...owns(P2, true, !o.split),
    ...owns(P3, !o.split, true),
    ...owns(P4, true, true)
  ]);
}
const steal = (t: Table, ch: string, it: string) => activate(t, P1, "wm", "grand-theft", { selected: { ch: [t.id(ch)], it: [t.id(it)] } });

clause(WHIP, "1:ability:grand-theft", "3 seats: the character and the item both come from one opponent; the other opponent's cards are untouched", () => {
  const t = whipTable(3);
  refused(() => steal(t, "ch-p2", "it-p3"), "a character of P2 with an item of P3");
  assert.equal(zoneOf(t.engine, t.id("wm")), "play", "nothing was paid");
  refused(() => steal(t, "ch-p3", "it-p2"), "a character of P3 with an item of P2");
  refused(() => steal(t, "ch-p1", "it-p2"), "P1's own character");
  refused(() => steal(t, "ch-p2", "it-p1"), "P1's own item");
  steal(t, "ch-p2", "it-p2");
  assert.equal(zoneOf(t.engine, t.id("wm")), "discard", "the cost destroys this card");
  assert.equal(controllerOf(t, "ch-p2"), P1);
  assert.equal(controllerOf(t, "it-p2"), P1);
  assert.equal(controllerOf(t, "ch-p3"), P3, "P3's character is untouched");
  assert.equal(controllerOf(t, "it-p3"), P3, "P3's item is untouched");

  const second = whipTable(3);
  steal(second, "ch-p3", "it-p3");
  assert.equal(controllerOf(second, "ch-p3"), P1);
  assert.equal(controllerOf(second, "it-p3"), P1);
  assert.equal(controllerOf(second, "ch-p2"), P2);
  assert.equal(controllerOf(second, "it-p2"), P2);
});

clause(WHIP, "1:ability:grand-theft", "3 seats: when P2 controls only a character and P3 only an item, no single opponent has one of each and no pair is accepted", () => {
  const t = whipTable(3, { split: true });
  refused(() => steal(t, "ch-p2", "it-p3"), "a character of P2 with an item of P3");
  assert.equal(zoneOf(t.engine, t.id("wm")), "play");
  assert.equal(controllerOf(t, "ch-p2"), P2);
  assert.equal(controllerOf(t, "it-p3"), P3);
});

clause(WHIP, "1:ability:grand-theft", "4 seats: the pair may come from P4 and nobody else's cards change hands", () => {
  const t = whipTable(4);
  refused(() => steal(t, "ch-p4", "it-p2"), "a character of P4 with an item of P2");
  steal(t, "ch-p4", "it-p4");
  assert.equal(controllerOf(t, "ch-p4"), P1);
  assert.equal(controllerOf(t, "it-p4"), P1);
  for (const key of ["ch-p2", "it-p2", "ch-p3", "it-p3"]) assert.notEqual(controllerOf(t, key), P1);
});

// ===================================================================================================================
// Conniving Puppeteer
// BETRAY -- COST: Pick a non-tactic card in an opponent's discard pile. Destroy this card. -- EFFECT: Put the card into play
// under your control.
// ===================================================================================================================

clause(PUPPETEER, "0:ability:betray", "3 seats: non-tactic cards in any opponent's discard pile are legal picks; tactics and P1's own pile are not", () => {
  const board = () =>
    table(3, [
      { key: "pp", def: printing(PUPPETEER), owner: P1 },
      { key: "d2c", def: character({ name: "P2 discarded character" }), owner: P2, zone: "discard" },
      { key: "d2t", def: tactic({ name: "P2 discarded tactic" }), owner: P2, zone: "discard" },
      { key: "d3i", def: item({ name: "P3 discarded item" }), owner: P3, zone: "discard" },
      { key: "d1c", def: character({ name: "P1 discarded character" }), owner: P1, zone: "discard" }
    ]);
  const betray = (t: Table, key: string) => activate(t, P1, "pp", "betray", { selected: { c: [t.id(key)] } });
  const t = board();
  refused(() => betray(t, "d2t"), "a tactic in P2's pile");
  refused(() => betray(t, "d1c"), "a card in P1's own pile");
  assert.equal(zoneOf(t.engine, t.id("pp")), "play");
  betray(t, "d3i");
  assert.equal(zoneOf(t.engine, t.id("pp")), "discard", "the cost destroys the Puppeteer");
  assert.equal(zoneOf(t.engine, t.id("d3i")), "play", "P3's item enters play");
  assert.equal(controllerOf(t, "d3i"), P1, "under P1's control");
  assert.equal(zoneOf(t.engine, t.id("d2c")), "discard", "P2's pile is untouched");
  const second = board();
  betray(second, "d2c");
  assert.equal(zoneOf(second.engine, second.id("d2c")), "play");
  assert.equal(controllerOf(second, "d2c"), P1);
  assert.equal(zoneOf(second.engine, second.id("d3i")), "discard");
});

// ===================================================================================================================
// Moment of Annihilation
// EXTRA COST: You may remove up to 3 non-character cards in an opponent's discard pile from the game. If you do, reduce this
// card's numeric cost by the number of cards removed. Pick a character. -- If the character has 4 life or less, destroy it.
// ===================================================================================================================

function momentTable(seats: number) {
  const pile = (owner: PlayerId) =>
    seated(owner, seats)
      ? [
          { key: `i1-${owner}`, def: item({ name: `Item 1 ${owner}` }), owner, zone: "discard" as const },
          { key: `i2-${owner}`, def: item({ name: `Item 2 ${owner}` }), owner, zone: "discard" as const },
          { key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner, zone: "discard" as const }
        ]
      : [];
  return table(seats, [
    { key: "ma", def: printing(MOMENT), owner: P1, zone: "hand" },
    ...bank("deception", 5, P1),
    { key: "victim", def: character({ name: "Victim", life: 2 }), owner: P2 },
    ...pile(P1),
    ...pile(P2),
    ...pile(P3),
    ...pile(P4)
  ]);
}
const momentAction = (t: Table, pile: PlayerId | undefined, removed: string[]) => ({
  type: "playCard",
  playerId: P1,
  cardId: t.id("ma"),
  selected: { rm: removed.map(key => t.id(key)), c: [t.id("victim")] },
  variables: {},
  ...(pile ? { players: { pile } } : {})
});

clause(MOMENT, "0:extraCost", "3 seats: one opponent's pile is chosen (P2 or P3), all removed cards come from it and the cost drops by their number", () => {
  const t = momentTable(3);
  assert.deepEqual(playerAsk(t, momentAction(t, undefined, [])), { id: "pile", candidates: [P2, P3] });
  refused(() => t.engine.perform(momentAction(t, P1, []) as never), "yourself is not an opponent");
  refused(() => t.engine.perform(momentAction(t, P3, ["i1-p2"]) as never), "a card from P2's pile when P3 is chosen");
  refused(() => t.engine.perform(momentAction(t, P3, ["i1-p3", "i1-p2"]) as never), "one card from each pile");
  refused(() => t.engine.perform(momentAction(t, P3, ["c-p3"]) as never), "a character in the chosen pile");
  refused(() => t.engine.perform(momentAction(t, P3, ["i1-p1"]) as never), "a card from P1's own pile");
  assert.equal(zoneOf(t.engine, t.id("ma")), "hand");
  act(t, momentAction(t, P3, ["i1-p3", "i2-p3"]));
  assert.equal(zoneOf(t.engine, t.id("ma")), "discard");
  assert.equal(ready(t.engine, P1), 5 - 3, "cost 5 reduced by the 2 removed cards");
  assert.notEqual(zoneOf(t.engine, t.id("i1-p3")), "discard", "the removed cards left the discard pile");
  assert.notEqual(zoneOf(t.engine, t.id("i2-p3")), "discard");
  assert.equal(zoneOf(t.engine, t.id("i1-p2")), "discard", "P2's pile is untouched");
  assert.equal(zoneOf(t.engine, t.id("victim")), "discard", "the picked character (not tied to the opponent) is destroyed");

  const second = momentTable(3);
  act(second, momentAction(second, P2, ["i1-p2"]));
  assert.equal(ready(second.engine, P1), 5 - 4);
  assert.equal(zoneOf(second.engine, second.id("i1-p3")), "discard");

  const none = momentTable(3);
  act(none, momentAction(none, P2, []));
  assert.equal(ready(none.engine, P1), 0, "removing none: the cost is not reduced");

  const two = momentTable(2);
  assert.equal(playerAsk(two, momentAction(two, undefined, [])), undefined, "one opponent left: nobody is asked which pile");
});

clause(MOMENT, "0:extraCost", "4 seats: the choice offers P2, P3 and P4", () => {
  const t = momentTable(4);
  assert.deepEqual(playerAsk(t, momentAction(t, undefined, [])), { id: "pile", candidates: [P2, P3, P4] });
  act(t, momentAction(t, P4, ["i1-p4", "i2-p4"]));
  assert.equal(ready(t.engine, P1), 5 - 3);
  assert.equal(zoneOf(t.engine, t.id("i1-p3")), "discard");
});

// ===================================================================================================================
// Omahkapi'si Pi'kssii
// While there are at least 10 cards in an opponent's discard pile, that player cannot pick this card.
// FLEX -- COST: Pay 2. Pick a card in an opponent's discard pile. -- EFFECT: Remove that card from the game. If you do, this
// card gains 2 strength this turn.
// ===================================================================================================================

const filler = (owner: PlayerId, n: number) => Array.from({ length: n }, (_, i) => ({ key: `f-${owner}-${i}`, def: character({ name: `Filler ${owner} ${i}` }), owner, zone: "discard" as const }));

clause(OMAHKAPI, "2:ability:flex", "3 seats: cards in P2's and P3's discard piles are legal picks, P1's own pile is not; the picked card leaves the game and only this card gains strength", () => {
  const board = () =>
    table(3, [
      { key: "om", def: printing(OMAHKAPI), owner: P1 },
      ...bank("deception", 2, P1),
      { key: "p2c", def: character({ name: "P2 pile card" }), owner: P2, zone: "discard" },
      { key: "p3c", def: character({ name: "P3 pile card" }), owner: P3, zone: "discard" },
      { key: "p1c", def: character({ name: "P1 pile card" }), owner: P1, zone: "discard" }
    ]);
  // The 1:rule text of this card (still its 2-player data, see the tests below) asks P1 to name an opponent once it applies: answered here, it is not what this clause is about.
  const flex = (t: Table, key: string) => {
    activate(t, P1, "om", "flex", { selected: { c: [t.id(key)] } });
    if (pending(t)?.kind === "choosePlayer") choosePlayer(t, P2);
  };
  const t = board();
  const strength = t.engine.getStat(t.id("om"), "strength");
  refused(() => flex(t, "p1c"), "a card in P1's own pile");
  assert.equal(ready(t.engine, P1), 2, "nothing paid");
  flex(t, "p3c");
  assert.equal(ready(t.engine, P1), 0, "pays 2");
  assert.notEqual(zoneOf(t.engine, t.id("p3c")), "discard", "P3's card is removed from the game");
  assert.equal(zoneOf(t.engine, t.id("p2c")), "discard", "P2's pile is unchanged");
  assert.equal(t.engine.getStat(t.id("om"), "strength"), strength + 2);
  const second = board();
  flex(second, "p2c");
  assert.notEqual(zoneOf(second.engine, second.id("p2c")), "discard");
  assert.equal(zoneOf(second.engine, second.id("p3c")), "discard");
});

// The condition is judged per opponent and the restriction binds only that opponent. The vocabulary has no form for that
// ("cannotBePickedByOpponents" covers every opponent, and a count of piles has no per-opponent reading), so the data keeps the
// 2-player spelling and these two tests record what the text says.
/** P2 and P3 both try to pick the Omahkapi'si (a character in play under P1) with a tactic of their own; true when the pick is accepted. */
function picksOmahkapi(t: Table, who: PlayerId): boolean {
  return t.engine.targetCandidates({ type: "character", controller: "opponents" } as never, { sourceId: t.id(`tac-${who}`), controllerId: who, selected: {} } as never, who).some(card => card.id === t.id("om"));
}
function omahkapiTable(pile2: number, pile3: number, pile1 = 0) {
  return table(3, [
    { key: "om", def: printing(OMAHKAPI), owner: P1 },
    { key: "tac-p2", def: tactic({ name: "Picker 2" }), owner: P2, zone: "hand" },
    { key: "tac-p3", def: tactic({ name: "Picker 3" }), owner: P3, zone: "hand" },
    ...filler(P2, pile2),
    ...filler(P3, pile3),
    ...filler(P1, pile1)
  ]);
}

clause(OMAHKAPI, "1:rule", "3 seats: with 10 cards in P2's discard pile and 9 in P3's, P2 cannot pick it and P3 can; nobody is asked to choose an opponent", () => {
  const t = omahkapiTable(10, 9);
  assert.equal(pending(t), undefined, "'an opponent' is never chosen by the controller");
  assert.equal(picksOmahkapi(t, P2), false, "P2 has 10 cards in its pile");
  assert.equal(picksOmahkapi(t, P3), true, "P3 has only 9");
  const swapped = omahkapiTable(9, 10);
  assert.equal(picksOmahkapi(swapped, P2), true);
  assert.equal(picksOmahkapi(swapped, P3), false);
});

clause(OMAHKAPI, "1:rule", "3 seats: the piles are not added together (6 and 6 block neither), and P1's own pile has no effect", () => {
  const t = omahkapiTable(6, 6, 20);
  assert.equal(picksOmahkapi(t, P2), true);
  assert.equal(picksOmahkapi(t, P3), true);
  const both = omahkapiTable(10, 10);
  assert.equal(picksOmahkapi(both, P2), false);
  assert.equal(picksOmahkapi(both, P3), false);
});

// ===================================================================================================================
// Purloining Performance
// EXTRA COST: Pick an opponent. -- Look at the top 4 cards of that player's deck and put them back in any order. If you control
// an attacking party of at least 2 members, you may put up to 3 cards from the top of that player's deck into their discard pile.
// ===================================================================================================================

function purloinTable(seats: number) {
  const deck = (owner: PlayerId) => (seated(owner, seats) ? Array.from({ length: 8 }, (_, i) => ({ key: `dk-${owner}-${i}`, def: character({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const })) : []);
  return table(seats, [
    { key: "pp", def: printing(PURLOIN), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1),
    { key: "a1", def: character({ name: "Attacker 1", strength: 1, life: 5, speed: 2 }), owner: P1 },
    { key: "a2", def: character({ name: "Attacker 2", strength: 1, life: 5, speed: 2 }), owner: P1 },
    ...deck(P1),
    ...deck(P2),
    ...deck(P3),
    ...deck(P4)
  ]);
}
const deckOf = (t: Table, who: PlayerId): string[] => [...t.engine.state.players[who]!.deck];
const performance = (t: Table, picked?: PlayerId) => ({ type: "playCard", playerId: P1, cardId: t.id("pp"), selected: {}, variables: {}, ...(picked ? { players: { picked } } : {}) });

clause(PURLOIN, "0:extraCost", "3 seats: the opponent pick offers P2 and P3; only the picked opponent's top 4 cards are looked at, and nothing else is asked", () => {
  const t = purloinTable(3);
  assert.deepEqual(playerAsk(t, performance(t)), { id: "picked", candidates: [P2, P3] });
  refused(() => t.engine.perform(performance(t, P1) as never), "yourself is not an opponent");
  const top = deckOf(t, P3).slice(0, 4);
  const p2Deck = deckOf(t, P2);
  act(t, performance(t, P3));
  const pc = pending(t)! as unknown as { kind: string; playerId: PlayerId; deckOwnerId: PlayerId; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the controller looks");
  assert.equal(pc.deckOwnerId, P3, "at the picked opponent's deck");
  assert.deepEqual(pc.cardIds, top);
  answerChoice(t, { kind: "reorderDeck", order: [...top].reverse() });
  assert.equal(pending(t), undefined, "no other pick or opponent step follows");
  assert.deepEqual(deckOf(t, P3).slice(0, 4), [...top].reverse(), "put back in the order chosen");
  assert.deepEqual(deckOf(t, P2), p2Deck, "P2's deck is untouched");

  const second = purloinTable(3);
  const topTwo = deckOf(second, P2).slice(0, 4);
  act(second, performance(second, P2));
  assert.equal((pending(second) as unknown as { deckOwnerId: PlayerId }).deckOwnerId, P2);
  assert.deepEqual((pending(second) as unknown as { cardIds: string[] }).cardIds, topTwo);

  const two = purloinTable(2);
  assert.equal(playerAsk(two, performance(two)), undefined, "one opponent left: nobody is asked which");
});

clause(PURLOIN, "0:extraCost", "3 seats: with an attacking party of 2 the cards are put into the PICKED opponent's discard pile, not the defender's", () => {
  const t = purloinTable(3);
  t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("a1"), t.id("a2")], target: { type: "faction", playerId: P2 } } as never);
  const p2Deck = deckOf(t, P2);
  const p3Deck = deckOf(t, P3);
  playRaw(t, P1, "pp", { players: { picked: P3 } });
  resolvePendingResponses(t.engine);
  answerChoice(t, { kind: "reorderDeck", order: deckOf(t, P3).slice(0, 4) });
  const options = pending(t)!;
  assert.equal(options.kind, "chooserSelectsOption");
  assert.equal(options.playerId, P1);
  chooseIndex(t, 2);
  assert.deepEqual(handOf(t.engine, P1), []);
  assert.equal(t.engine.state.players[P3]!.discard.filter(id => p3Deck.includes(id)).length, 2, "2 cards from the top of P3's deck are milled");
  assert.equal(deckOf(t, P2).length, p2Deck.length, "the defender P2's deck is untouched");
  assert.equal(t.engine.state.players[P2]!.discard.length, 0);
});
