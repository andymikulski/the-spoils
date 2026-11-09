// Multiplayer clause tests for Seed 3, part 10 (The Knitting Coalition). Every test is a real 3- or 4-seat game with
// the real printing, driven through `perform`: the setup rules through `createFactionGame`, the turn rules and the
// faction's abilities through a table with the faction card in play.

import assert from "node:assert/strict";
import { character, resourceCard } from "../../support/fixtures.js";
import { developFaction } from "../../per-card/_harness.js";
import { clause, printing, refused } from "../_clause.js";
import { endTurn } from "../_turn.js";
import { answer, cardsOf, controllerOf, expectChoice, handOf, offered, pickTargets, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";
import { ALLIANCE_OF_TWO, factionGame, handSize, IMPERIAL, resourcesOf, TOURNAMENT } from "./_seed-3-factions.js";
import { P1, P2, P3, P4 } from "./_seed-3-factions.js";

const KNITTING = "c58d0e3c-4f76-4665-aca4-2ba01a42d863"; // STARTING RESOURCES: 2 Greed. STARTING DRAW: 3 going first, 4 going second. HIDDEN INFLUENCE ... PULLING STRINGS ... RESTORE RULE ... INFLATIONARY FORCES - DRAW / RESOURCE: Both players may use this ability. Pay 2.

const coalition = () => printing(KNITTING);
/** The Coalition in seat 1, then factions that start with different draws (Tournament 8/9, Evil Alliance 7/8, Imperial 3/3). */
const FOES = [TOURNAMENT, ALLIANCE_OF_TWO, IMPERIAL];

for (const count of [3, 4] as const) {
  clause(KNITTING, "0:rule", `${count} seats: the Coalition can be played in a ${count}-seat game and the other seats keep their own factions`, () => {
    const engine = factionGame([coalition(), ...FOES.slice(0, count - 1)], { firstPlayerId: P1 });
    assert.equal(engine.getDefinition(engine.state.players[P1]!.factionId!).name, "The Knitting Coalition");
    assert.equal(engine.state.players[P1]!.influence, 28);
    FOES.slice(0, count - 1).forEach((faction, index) => {
      const seat = [P2, P3, P4][index]!;
      assert.equal(engine.getDefinition(engine.state.players[seat]!.factionId!).name, faction.name);
      const own = faction === ALLIANCE_OF_TWO ? 15 + 10 * (count - 1) : faction.faction!.startingInfluence; // The Evil Alliance counts its opponents (X)
      assert.equal(engine.state.players[seat]!.influence, own);
    });
  });

  clause(KNITTING, "1:rule:STARTING RESOURCES", `${count} seats: the Coalition's controller starts with 2 Greed resources; the other seats start with their own factions' resources`, () => {
    const engine = factionGame([coalition(), ...FOES.slice(0, count - 1)], { firstPlayerId: P1 });
    assert.deepEqual(resourcesOf(engine, P1), ["Greed", "Greed"]);
    assert.equal(resourcesOf(engine, P2).length, 2, "the Tournament Faction's own 2 staples");
    assert.equal(resourcesOf(engine, P3).length, count, "the Evil Alliance's own 1+X staples, X = the number of its opponents");
    if (count === 4) assert.deepEqual(resourcesOf(engine, P4), ["Rage", "Rage"], "Imperial Army starts with 2 Rage, not Greed");
  });
}

clause(KNITTING, "2:rule:STARTING DRAW", "3 seats: in the first seat the Coalition draws 3 (going first); in the second or third seat it draws 4 (every seat after the first uses going second)", () => {
  assert.equal(handSize(factionGame([coalition(), TOURNAMENT, ALLIANCE_OF_TWO], { firstPlayerId: P1 }), P1), 3);
  assert.equal(handSize(factionGame([TOURNAMENT, coalition(), ALLIANCE_OF_TWO], { firstPlayerId: P1 }), P2), 4);
  assert.equal(handSize(factionGame([TOURNAMENT, ALLIANCE_OF_TWO, coalition()], { firstPlayerId: P1 }), P3), 4);
  // Seat order, not who plays first: in the first seat but going second the Coalition draws 4 too.
  assert.equal(handSize(factionGame([coalition(), TOURNAMENT, ALLIANCE_OF_TWO], { firstPlayerId: P2 }), P1), 4);
});

for (const count of [3, 4] as const) {
  clause(KNITTING, "3:rule:HIDDEN INFLUENCE", `${count} seats: every opponent ignores their own faction's STARTING DRAW and uses the Coalition's: 3 going first, 4 going second (seat order after the first seat is going second)`, () => {
    const factions = [coalition(), ...FOES.slice(0, count - 1)];
    const engine = factionGame(factions, { firstPlayerId: P1 });
    assert.equal(handSize(engine, P1), 3);
    for (const seat of [P2, P3, P4].slice(0, count - 1)) assert.equal(handSize(engine, seat), 4, `${seat} uses the Coalition's going-second draw`);
    const second = factionGame(factions, { firstPlayerId: P2 });
    assert.equal(handSize(second, P2), 3, "P2 going first uses the Coalition's going-first draw");
    assert.equal(handSize(second, P1), 4);
    for (const seat of [P3, P4].slice(0, count - 2)) assert.equal(handSize(second, seat), 4);
  });
}

// --- the turn rules, on a table with the Coalition in play ------------------------------

const withCoalition = (count: number, cards: CardPlacement[], active: PlayerId = P1): Table =>
  table(count, cards, {
    active,
    factions: { [P1]: coalition(), ...Object.fromEntries(seatsOf(count).slice(1).map((seat) => [seat, developFaction()])) }
  });

for (const count of [3, 4] as const) {
  clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", `${count} seats: no opponent has a Develop Rule (none is offered at the start of any opponent's turn), nor does the Coalition's controller`, () => {
    const t = withCoalition(count, seatsOf(count).flatMap((seat) => cardsOf(`d-${seat}-`, 3, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` }))));
    for (const seat of seatsOf(count)) assert.deepEqual(t.engine.getDevelopChoices(seat), [], `${seat} has no Develop Rule`);
    const decks = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
    for (const seat of seatsOf(count)) {
      endTurn(t.engine, seat, "draw");
      assert.equal(t.engine.state.pendingChoice, undefined, "no develop prompt at the start of the next turn");
    }
    for (const seat of t.seats) assert.equal(handOf(t, seat).length, decks[seat], `${seat} drew nothing from the Develop Rule`);
  });
}

clause(KNITTING, "5:rule:RESTORE RULE", "3 seats: at the start of the controller's turn the controller restores their depleted cards and detaches their resources; the opponents' cards are not restored then", () => {
  const spent = (seat: PlayerId): CardPlacement[] => [
    { key: `c-${seat}`, def: character({ name: `Char ${seat}` }), owner: seat, depleted: true },
    { key: `r-${seat}`, def: resourceCard({ name: `Res ${seat}` }), owner: seat, attachedToKey: seat === P1 ? "__factionA" : seat === P2 ? "__factionB" : "__faction_p3" }
  ];
  const t = withCoalition(3, seatsOf(3).flatMap(spent), P3);
  endTurn(t.engine, P3);
  assert.equal(t.engine.state.activePlayerId, P1);
  assert.equal(t.engine.state.cards[t.id("c-p1")]!.depleted, false, "the controller's depleted character is restored");
  assert.equal(t.engine.state.cards[t.id("r-p1")]!.attachedTo, undefined, "the controller's resource is detached");
  assert.equal(t.engine.state.cards[t.id("c-p2")]!.depleted, true, "P2's cards are not restored now");
  assert.notEqual(t.engine.state.cards[t.id("r-p2")]!.attachedTo, undefined);
  assert.equal(t.engine.state.cards[t.id("c-p3")]!.depleted, true);
});

// --- INFLATIONARY FORCES: "Both players may use this ability" (every opponent too) --------

function forcesTable(count: number, user: PlayerId, resources = 2): Table {
  return withCoalition(
    count,
    [
      ...seatsOf(count).flatMap((seat) => cardsOf(`d-${seat}-`, 3, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` }))),
      ...seatsOf(count).flatMap((seat) => cardsOf(`rh-${seat}-`, 1, seat, "hand", (i) => resourceCard({ name: `Seed ${seat} ${i}` }))),
      ...staples("rage", resources, user)
    ],
    user
  );
}
const factionOf = (t: Table): string => t.engine.state.players[P1]!.factionId!;

for (const [count, users] of [[3, [P1, P2, P3]], [4, [P1, P2, P3, P4]]] as const) {
  clause(KNITTING, "6:ability", `${count} seats: the controller and every opponent can use INFLATIONARY FORCES - DRAW: the user pays 2 of their own resources and draws for themselves; nobody else draws`, () => {
    for (const user of users) {
      const t = forcesTable(count, user);
      const hands = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
      t.engine.perform({ type: "activateAbility", playerId: user, cardId: factionOf(t), abilityId: "knitting-draw" });
      settle(t);
      for (const seat of t.seats) assert.equal(handOf(t, seat).length, hands[seat]! + (seat === user ? 1 : 0), `${seat}'s hand after ${user} used it`);
      assert.equal(t.engine.getAvailableResourceCount(user), 0, "the user paid 2 of their own resources");
      const poor = forcesTable(count, user, 1);
      refused(() => poor.engine.perform({ type: "activateAbility", playerId: user, cardId: factionOf(poor), abilityId: "knitting-draw" }), `${user} has fewer than 2 ready resources`);
    }
  });

  clause(KNITTING, "7:ability", `${count} seats: the controller and every opponent can use INFLATIONARY FORCES - RESOURCE: the user pays 2 of their own resources and plays a resource from their own hand under their own control`, () => {
    for (const user of users) {
      const t = forcesTable(count, user);
      t.engine.perform({ type: "activateAbility", playerId: user, cardId: factionOf(t), abilityId: "knitting-resource" });
      settle(t);
      expectChoice(t, "chooserSelectsTarget", user);
      assert.deepEqual(offered(t).sort(), handOf(t, user).sort(), "the user picks from their own hand");
      const pick = handOf(t, user).find((id) => t.engine.getDefinition(id).type === "resource")!;
      pickTargets(t, user, [pick]);
      assert.equal(t.engine.state.cards[pick]!.zone, "play");
      assert.equal(t.engine.state.cards[pick]!.controllerId, user, "under the user's control, not the Coalition controller's");
      const poor = forcesTable(count, user, 1);
      refused(() => poor.engine.perform({ type: "activateAbility", playerId: user, cardId: factionOf(poor), abilityId: "knitting-resource" }), `${user} has fewer than 2 ready resources`);
    }
    void answer;
  });
}

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "3 seats, the Coalition in the second seat: both of its opponents (the seats on either side) lose their Develop Rule, not just one", () => {
  const t = table(3, [], { factions: { [P2]: coalition(), [P1]: developFaction(), [P3]: developFaction() } });
  assert.deepEqual(t.engine.getDevelopChoices(P1), [], "P1 ignores its Develop Rule");
  assert.deepEqual(t.engine.getDevelopChoices(P3), [], "P3 ignores its Develop Rule");
});
