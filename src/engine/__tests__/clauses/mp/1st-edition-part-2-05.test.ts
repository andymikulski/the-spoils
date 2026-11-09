// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 5: battle text, where "your opponent"
// is the other side of the battle (MPQ-P8) and no opponent is ever asked for, and lasting conditions on "your opponent".
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/1st-edition-part-2.json.

import assert from "node:assert/strict";
import { clause, printing, refused } from "../_clause.js";
import {
  activate,
  activateAction,
  answerPending,
  answerPick,
  assertAsksOpponent,
  character,
  choosePlayer,
  deckOf,
  drawTactic,
  events,
  fightOut,
  fillers,
  finisher,
  fund,
  handOf,
  item,
  killTactic,
  location,
  open,
  openPick,
  orderStart,
  P1,
  P2,
  P3,
  P4,
  pass,
  passUntil,
  perSeat,
  pickableBy,
  pickFrom,
  playAction,
  playCard,
  resolvePendingResponses,
  resourceCard,
  seatsOf,
  stack,
  table,
  tactic,
  zoneOf,
  type CardPlacement,
  type Count,
  type PlayerId,
  type Table
} from "./_support1stEditionPart2.js";

const others = (count: Count): PlayerId[] => seatsOf(count).slice(1);
const handKeys = (seat: PlayerId, n: number): string[] => Array.from({ length: n }, (_, i) => `h-${seat}-${i}`);
const idsOf = (t: Table, keys: string[]): string[] => keys.map((key) => t.id(key));
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const infl = (t: Table, seat: PlayerId): number => t.engine.state.players[seat]!.influence;
const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;
/** The turn goes all the way round to P1's next turn (so a card played this turn can attack). */
const round = (t: Table): void => {
  pass(t, P1);
  orderStart(t);
  passUntil(t, P1);
};
const snapshot = (t: Table) => Object.fromEntries(t.seats.map((seat) => [seat, { hand: [...handOf(t, seat)], deck: [...deckOf(t, seat)], discard: [...t.engine.state.players[seat]!.discard] }]));

/** A prompt answer for a battle: the `chooserSelectsTarget` is answered with `choose(candidates)` after recording who picks and what is offered. */
function picking(t: Table, offers: Array<{ playerId: PlayerId; candidates: string[] }>, choose: (candidates: string[]) => string[]) {
  return (pc: { kind: string }): unknown => {
    if (pc.kind !== "chooserSelectsTarget") return undefined;
    const prompt = openPick(t);
    offers.push({ playerId: prompt.playerId, candidates: sorted(prompt.candidates) });
    return { kind: "chooserSelectsTarget", selected: choose(prompt.candidates) };
  };
}

// =================================================================================
// Deceptive Muddler
// If this card inflicts damage to a faction, your opponent must put a card from their hand on the top of their deck.
// =================================================================================

const MUDDLER = "b28841ab-18e2-4a2e-aeb1-94b124f7baae";

function muddlerTable(count: Count, hand = 3): Table {
  return table(count, [
    { key: "mud", def: printing(MUDDLER), owner: P1, zone: "play" },
    ...others(count).map((seat): CardPlacement => ({ key: `loc-${seat}`, def: location({ name: `Place ${seat}`, life: 9 } as never), owner: seat, zone: "play" })),
    ...perSeat(count, { hand, deck: 3 })
  ]);
}

for (const count of [3, 4] as const) {
  clause(MUDDLER, "1:rule", `${count} seats: the faction it damages is the opponent: only that player puts a card from their hand on top of their deck, and nobody is asked who the opponent is`, () => {
    for (const pick of others(count)) {
      const t = muddlerTable(count);
      const before = snapshot(t);
      const offers: Array<{ playerId: PlayerId; candidates: string[] }> = [];
      const shown = fightOut(t, P1, ["mud"], { faction: pick }, [], picking(t, offers, (candidates) => [candidates[1]!]));
      assert.deepEqual(shown, [`chooserSelectsTarget:${pick}`], "only the damaged faction's owner is asked, once");
      assert.deepEqual(offers, [{ playerId: pick, candidates: sorted(idsOf(t, handKeys(pick, 3))) }], "from their own hand only");
      assert.deepEqual(deckOf(t, pick)[0], before[pick]!.hand[1], "the chosen card is on top of their deck");
      assert.equal(handOf(t, pick).length, 2);
      for (const seat of t.seats.filter((s) => s !== pick)) {
        assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${seat}'s hand is unchanged`);
        assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}'s deck is unchanged`);
      }
    }
  });

  clause(MUDDLER, "1:rule", `${count} seats: an empty hand means nothing happens, and damage to a location does not trigger it`, () => {
    const pick = others(count)[0]!;
    // an empty hand
    const empty = muddlerTable(count, 0);
    assert.deepEqual(fightOut(empty, P1, ["mud"], { faction: pick }), [], "nothing to put back: nobody is asked");
    // damage to a location, not to a faction
    const t = muddlerTable(count);
    const before = snapshot(t);
    assert.deepEqual(fightOut(t, P1, ["mud"], { card: `loc-${pick}` }), []);
    for (const seat of t.seats) assert.deepEqual(handOf(t, seat), before[seat]!.hand);
  });
}

// =================================================================================
// Venomous Sacspider
// If this card is destroyed by battle damage, your opponent must discard their hand.
// =================================================================================

const SACSPIDER = "b374445f-2ac5-40b2-bfc5-5ee47771db6c";

for (const count of [3, 4] as const) {
  clause(SACSPIDER, "0:rule", `${count} seats: the other side of the battle discards their hand, whoever that is; no other player does, and nobody is asked`, () => {
    for (const attacker of others(count)) {
      // defending: the attacker discards its hand
      const t = table(
        count,
        [
          { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
          { key: "atk", def: character({ name: "Attacker", strength: 5, life: 9 }), owner: attacker, zone: "play" },
          ...perSeat(count, { hand: 2, deck: 2 })
        ],
        attacker
      );
      const before = snapshot(t);
      fightOut(t, attacker, ["atk"], { faction: P1 }, ["spider"]);
      assert.equal(zoneOf(t, "spider"), "discard", "destroyed by battle damage");
      assert.deepEqual(handOf(t, attacker), [], "the attacker discarded their hand");
      for (const seat of t.seats.filter((s) => s !== attacker)) assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${seat}'s hand is unchanged`);
    }
    // attacking: the defending player discards their hand
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blocker", strength: 5, life: 9 }), owner: defender, zone: "play" },
        ...perSeat(count, { hand: 2, deck: 2 })
      ]);
      const before = snapshot(t);
      fightOut(t, P1, ["spider"], { faction: defender }, ["blk"]);
      assert.equal(zoneOf(t, "spider"), "discard");
      assert.deepEqual(handOf(t, defender), [], "the defending player discarded their hand");
      for (const seat of t.seats.filter((s) => s !== defender)) assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${seat}'s hand is unchanged`);
    }
  });
}

// =================================================================================
// Clockman Pickpocket / Cute Cutpurse
// While your opponent controls an item and this card is the only member of an attacking party, this card cannot be
// blocked.
// Pickpocket: If this card inflicts damage to a faction, your opponent must pick an item they control. If they do, take
//   control of that item and destroy this card.
// Cutpurse: If this card inflicts damage to a faction, you must pick an item your opponent controls. Destroy that item.
// =================================================================================

const PICKPOCKET = "cc55231b-da46-435a-95ef-d26fc8de31c0";
const CUTPURSE = "46d4519b-b2ff-4306-9489-9ce28ecc3a5b";

/**
 * P1 plays the thief (`id`), selects `bound` as its opponent, and the table goes round to P1's next turn, when it can
 * attack. Every other seat has a blocker and `items` lists who controls an item.
 */
function thiefTable(count: Count, id: string, bound: PlayerId, items: PlayerId[], extra: CardPlacement[] = []): Table {
  const t = table(count, [
    { key: "thief", def: printing(id), owner: P1, zone: "hand" },
    { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
    ...fund(P1),
    ...others(count).map((seat): CardPlacement => ({ key: `blk-${seat}`, def: character({ name: `Blocker ${seat}`, life: 9 }), owner: seat, zone: "play" })),
    ...items.map((seat): CardPlacement => ({ key: `item-${seat}`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "play" })),
    ...extra,
    ...perSeat(count, { hand: 1, deck: 2 })
  ]);
  playCard(t, P1, "thief");
  choosePlayer(t, P1, t.seats.slice(1), bound);
  return t;
}

/** Whether `defender` may declare `blk-<defender>` as a blocker against `attackers` attacking its faction (right now, on P1's turn). */
function canBlock(t: Table, defender: PlayerId, attackers: string[]): boolean {
  t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers.map((key) => t.id(key)), target: { type: "faction", playerId: defender } } as never);
  resolvePendingResponses(t.engine);
  return t.engine.checkAction({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`blk-${defender}`)] } as never).ok;
}

/** The unblockability test shared by the Pickpocket and the Cutpurse (same printed first paragraph). */
function unblockable(count: Count, id: string): void {
    const seats = others(count);
    const [first, second] = seats as [PlayerId, PlayerId];
    // the selected opponent controls an item, another one does not: unblockable (attacking the one without an item)
    let t = thiefTable(count, id, first, [first]);
    round(t);
    assert.equal(canBlock(t, second, ["thief"]), false, "the selected opponent controls an item and it attacks alone: cannot be blocked");
    // only another opponent controls an item: it can be blocked
    t = thiefTable(count, id, first, [second]);
    round(t);
    assert.equal(canBlock(t, second, ["thief"]), true, "an item controlled by another opponent does not count");
    // not the only member of the party
    t = thiefTable(count, id, first, [first]);
    round(t);
    assert.equal(canBlock(t, second, ["thief", "mate"]), true, "not the only member of the party: it can be blocked");
    // the selected opponent is eliminated: the controller selects again (only the others are left)
    t = thiefTable(count, id, first, [second], [{ key: "fin", def: finisher(first), owner: P1, zone: "hand" }]);
    playCard(t, P1, "fin");
    assert.ok(t.engine.state.players[first]!.eliminated);
    const left = seats.filter((s) => s !== first);
    if (left.length > 1) {
      assert.equal(open(t)?.kind, "choosePlayer");
      choosePlayer(t, P1, left, second);
    } else assert.equal(open(t), undefined, "one opponent left: no choice is offered");
    round(t);
    assert.equal(canBlock(t, left.find((s) => s !== second) ?? second, ["thief"]), false, "the new selection controls an item: it cannot be blocked");
}

for (const count of [3, 4] as const) {
  clause(PICKPOCKET, "0:rule", `${count} seats: Clockman Pickpocket cannot be blocked only while the opponent P1 selected controls an item`, () => unblockable(count, PICKPOCKET));
  clause(CUTPURSE, "0:rule", `${count} seats: Cute Cutpurse cannot be blocked only while the opponent P1 selected controls an item`, () => unblockable(count, CUTPURSE));
}

for (const count of [3, 4] as const) {
  clause(PICKPOCKET, "1:rule", `${count} seats: the defending player picks one of their own items, P1 takes it and the Pickpocket is destroyed; no other player is involved`, () => {
    for (const pick of others(count)) {
      const other = others(count).find((s) => s !== pick)!;
      const t = thiefTable(count, PICKPOCKET, other, [pick, other]);
      round(t);
      const offers: Array<{ playerId: PlayerId; candidates: string[] }> = [];
      const shown = fightOut(t, P1, ["thief"], { faction: pick }, [], picking(t, offers, (candidates) => [candidates[0]!]));
      assert.deepEqual(shown, [`chooserSelectsTarget:${pick}`], "only the damaged player is asked");
      assert.deepEqual(offers, [{ playerId: pick, candidates: [t.id(`item-${pick}`)] }], "only the damaged player's items are offered");
      assert.equal(controllerOf(t, `item-${pick}`), P1, "P1 takes control of the item");
      assert.equal(zoneOf(t, "thief"), "discard", "the Pickpocket is destroyed");
      assert.equal(controllerOf(t, `item-${other}`), other, "no other player's item is taken");
    }
  });

  clause(PICKPOCKET, "1:rule", `${count} seats: a damaged player with no item loses nothing and the Pickpocket stays`, () => {
    const pick = others(count)[0]!;
    const t = thiefTable(count, PICKPOCKET, pick, [others(count)[1]!]);
    round(t);
    assert.deepEqual(fightOut(t, P1, ["thief"], { faction: pick }), [], "no item: nobody is asked");
    assert.equal(zoneOf(t, "thief"), "play");
  });

  clause(CUTPURSE, "1:rule", `${count} seats: P1 picks an item of the defending player only and destroys it`, () => {
    for (const pick of others(count)) {
      const other = others(count).find((s) => s !== pick)!;
      const t = thiefTable(count, CUTPURSE, other, [pick, other]);
      round(t);
      const offers: Array<{ playerId: PlayerId; candidates: string[] }> = [];
      const shown = fightOut(t, P1, ["thief"], { faction: pick }, [], picking(t, offers, (candidates) => [candidates[0]!]));
      assert.deepEqual(shown, ["chooserSelectsTarget:p1"], "P1 picks");
      assert.deepEqual(offers, [{ playerId: P1, candidates: [t.id(`item-${pick}`)] }], "only the defending player's items are offered");
      assert.equal(zoneOf(t, `item-${pick}`), "discard");
      assert.equal(zoneOf(t, `item-${other}`), "play", "the other opponent's item is not offered");
    }
  });

  clause(CUTPURSE, "1:rule", `${count} seats: nothing is destroyed when the defending player controls no item`, () => {
    const pick = others(count)[0]!;
    const t = thiefTable(count, CUTPURSE, pick, [others(count)[1]!]);
    round(t);
    assert.deepEqual(fightOut(t, P1, ["thief"], { faction: pick }), [], "no item: nothing is asked");
    assert.equal(zoneOf(t, `item-${others(count)[1]}`), "play");
  });
}

// =================================================================================
// Mendacious Brigand
// If this card is blocked, you may pick a blocking character and a character your opponent controls that is not in a
// battle. If you do, remove the blocking character from the battle and add the other character to the blocking party.
// =================================================================================

const BRIGAND = "fd6ca900-19ab-4786-b4db-7e3c7dbac204";

for (const count of [3, 4] as const) {
  clause(BRIGAND, "0:rule", `${count} seats: your opponent is the defender: P1 may pick a character of the defending player's that is not in the battle, and nobody is asked who the opponent is`, () => {
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "brig", def: printing(BRIGAND), owner: P1, zone: "play" },
        ...others(count).flatMap((seat): CardPlacement[] => [
          { key: `blk-${seat}`, def: character({ name: `Blocker ${seat}`, life: 9 }), owner: seat, zone: "play" },
          { key: `spare-${seat}`, def: character({ name: `Spare ${seat}`, life: 9 }), owner: seat, zone: "play" }
        ]),
        ...perSeat(count, { deck: 2 })
      ]);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("brig")], target: { type: "faction", playerId: defender } } as never);
      resolvePendingResponses(t.engine);
      t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`blk-${defender}`)] } as never);
      const pc = open(t);
      assert.ok(pc && pc.kind !== "choosePlayer", "the opponent is not asked for");
      assert.equal(pc?.playerId, P1, "P1 makes the picks");
      const spare = others(count).filter((s) => s !== defender);
      // a character of another opponent is refused; the defending player's spare character is accepted
      for (const seat of spare) {
        assert.equal(
          t.engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: pc!.kind, selected: { blk: [t.id(`blk-${defender}`)], add: [t.id(`spare-${seat}`)] } } } as never).ok,
          false,
          `${seat}'s character cannot be added`
        );
      }
      answerPending(t.engine, pc!.kind, { selected: { blk: [t.id(`blk-${defender}`)], add: [t.id(`spare-${defender}`)] } });
      const battle = t.engine.state.battle!;
      assert.deepEqual(battle.blockingParty, [t.id(`spare-${defender}`)], "the blocker was removed from the battle and the defender's other character added");
    }
  });
}
