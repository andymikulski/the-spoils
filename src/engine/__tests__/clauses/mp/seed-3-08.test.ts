// Multiplayer clause tests for Seed 3, part 8 (Ipsighast, Unscrupuls of Victory, Giada, Octo-Ba-Ba, The Great Wall).
// Every test is a real 3- or 4-seat game with the real printing, driven through `perform`.

import assert from "node:assert/strict";
import { character, tactic } from "../../support/fixtures.js";
import { clause, printing, refused } from "../_clause.js";
import { answer, cardsOf, deckOf, expectChoice, handOf, kill, offered, othersOf, P1, P2, P3, pending, pickTargets, seatsOf, settle, staples, table, tokensOn, zoneOf } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";

// =====================================================================================
// Ipsighast, the Lustful
// =====================================================================================

const IPSIGHAST = "3b6e1bd0-98bb-423e-adcd-eda67697c487"; // EXHUMATION -- COST: Pay 3. Pick a character in an opponent's discard pile. -- EFFECT: Remove that character from the game. This turn, this card gains COVERT. You may put the top 3 cards of that opponent's deck into their discard pile.

function exhumeTable(count: number): Table {
  return table(count, [
    { key: "ips", def: printing(IPSIGHAST), owner: P1 },
    ...staples("deception", 3),
    ...seatsOf(count).flatMap((seat): CardPlacement[] => [
      { key: `dead-${seat}`, def: character({ name: `Fallen ${seat}` }), owner: seat, zone: "discard" },
      ...cardsOf(`deck-${seat}-`, 5, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` }))
    ])
  ]);
}
const exhume = { type: "activateAbility", playerId: P1, abilityId: "ipsighast-exhume" } as const;

for (const count of [3, 4] as const) {
  clause(IPSIGHAST, "1:ability:ipsighast-exhume", `${count} seats: the pick may be a character in any opponent's discard pile (not the controller's own); the picked card's owner settles which opponent's deck is milled; no opponent is chosen`, () => {
    for (const victim of othersOf(count)) {
      const t = exhumeTable(count);
      const needs = t.engine.getPlayRequirements({ ...exhume, cardId: t.id("ips") });
      assert.equal(needs.length, 1);
      assert.equal(needs[0]!.kind, "pick", "the first thing asked is the pick, not an opponent");
      assert.deepEqual(
        [...(needs[0] as { candidates: string[] }).candidates].sort(),
        othersOf(count).map((seat) => t.id(`dead-${seat}`)).sort(),
        "every opponent's character is offered, the controller's own is not"
      );
      refused(() => t.engine.perform({ ...exhume, cardId: t.id("ips"), selected: { c: [t.id("dead-p1")] } }), "the controller's own discard pile");
      const decks = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
      t.engine.perform({ ...exhume, cardId: t.id("ips"), selected: { c: [t.id(`dead-${victim}`)] } });
      settle(t);
      assert.equal(zoneOf(t, `dead-${victim}`), "removed", "the picked character is removed from the game");
      expectChoice(t, "mayPay", P1);
      answer(t, P1, { kind: "mayPay", pay: true });
      assert.equal(deckOf(t, victim).length, decks[victim]! - 3, "the top 3 cards of that opponent's deck were put into their discard pile");
      for (const other of t.seats.filter((seat) => seat !== victim)) assert.equal(deckOf(t, other).length, decks[other], `${other}'s deck is untouched`);
      assert.equal(pending(t), undefined);
    }
  });
}

// =====================================================================================
// Unscrupuls of Victory
// =====================================================================================

const UNSCRUPULS = "b91d33d1-aeed-4953-b57b-463204b25bc6"; // If you control at least [O][O], an opponent discards 1 card. ... If you control at least [D][D], search an opponent's deck for 1 card and put it into their discard pile. ...

function unscrupulsTable(count: number): Table {
  return table(count, [
    { key: "u", def: printing(UNSCRUPULS), owner: P1, zone: "hand" },
    ...staples("obsession", 2),
    ...staples("deception", 2),
    ...othersOf(count).flatMap((seat) => [
      ...cardsOf(`hand-${seat}-`, 2, seat, "hand", (i) => character({ name: `Hand ${seat} ${i}` })),
      ...cardsOf(`deck-${seat}-`, 3, seat, "deck", (i) => character({ name: `Deck ${seat} ${i}` }))
    ])
  ]);
}

for (const count of [3, 4] as const) {
  clause(UNSCRUPULS, "0:rule", `${count} seats: the controller chooses one opponent before targets (exactly one selection); only that opponent discards, and only that opponent's deck is searched and shuffled`, () => {
    for (const chosen of othersOf(count)) {
      const t = unscrupulsTable(count);
      const needs = t.engine.getPlayRequirements({ type: "playCard", playerId: P1, cardId: t.id("u") });
      assert.deepEqual(needs, [{ kind: "players", choices: [{ id: "opponent", candidates: othersOf(count) }] }], "one selection, the first requirement");
      refused(() => t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("u") }), "no opponent chosen", /Choose your opponent/);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("u"), players: { opponent: chosen } });
      settle(t);
      expectChoice(t, "chooserSelectsTarget", chosen);
      assert.deepEqual([...offered(t)].sort(), handOf(t, chosen).sort(), "the chosen opponent chooses among their own hand");
      const hands = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
      pickTargets(t, chosen, [handOf(t, chosen)[0]!]);
      expectChoice(t, "chooserSelectsTarget", P1);
      assert.deepEqual([...offered(t)].sort(), deckOf(t, chosen).sort(), "the search offers only the chosen opponent's deck");
      const found = deckOf(t, chosen)[0]!;
      pickTargets(t, P1, [found]);
      assert.equal(pending(t), undefined, "no second opponent selection");
      assert.equal(t.engine.state.cards[found]!.zone, "discard");
      assert.equal(handOf(t, chosen).length, hands[chosen]! - 1);
      for (const other of othersOf(count).filter((seat) => seat !== chosen)) {
        assert.equal(handOf(t, other).length, hands[other], `${other}'s hand is untouched`);
        assert.equal(deckOf(t, other).length, 3, `${other}'s deck is untouched`);
      }
    }
  });
}

// =====================================================================================
// Giada, the Elegant
// =====================================================================================

const GIADA = "0b67c755-4053-4bfb-9aef-e3a990501e0d"; // This card loses 1 strength and 1 life for each token on it. -- If this card would be destroyed by an opposing card or effect, you may put a token on it instead. If you do, deplete it and remove it from battle. Reduce the amount of damage already inflicted to this character to 0.

clause(GIADA, "1:rule", "3 seats: Giada loses 1 strength and 1 life per token on her, whatever the other players' cards do", () => {
  const t = table(3, [
    { key: "giada", def: printing(GIADA), owner: P1, counters: { token: 2 } },
    { key: "c-p2", def: character({ name: "Char p2", strength: 5, life: 5 }), owner: P2, counters: { token: 3 } },
    { key: "c-p3", def: character({ name: "Char p3", strength: 5, life: 5 }), owner: P3, counters: { token: 3 } }
  ]);
  const printed = (stat: "strength" | "life") => printing(GIADA)[stat]!;
  assert.equal(t.engine.getStat(t.id("giada"), "strength"), printed("strength") - 2);
  assert.equal(t.engine.getStat(t.id("giada"), "life"), printed("life") - 2);
  t.engine.state.cards[t.id("giada")]!.counters = { token: 3 };
  assert.equal(t.engine.getStat(t.id("giada"), "strength"), printed("strength") - 3, "one more token, one more point");
  t.engine.state.cards[t.id("giada")]!.counters = {};
  assert.equal(t.engine.getStat(t.id("giada"), "strength"), printed("strength"), "tokens on other cards do not matter");
});

for (const count of [3, 4] as const) {
  clause(GIADA, "2:rule", `${count} seats: a tactic of any opponent that would destroy Giada may be replaced by a token, deplete and removal from battle; her controller's own effect gets no such option`, () => {
    for (const seat of othersOf(count)) {
      const t = table(
        count,
        [
          { key: "giada", def: printing(GIADA), owner: P1 },
          { key: "kill", def: kill(), owner: seat, zone: "hand" }
        ],
        { active: seat }
      );
      t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id("kill"), selected: { t: [t.id("giada")] } });
      settle(t);
      expectChoice(t, "replacementChoice", P1);
      answer(t, P1, { kind: "replacementChoice", apply: true });
      assert.equal(zoneOf(t, "giada"), "play", `Giada survives ${seat}'s tactic`);
      assert.equal(tokensOn(t, "giada"), 1);
      assert.equal(t.engine.state.cards[t.id("giada")]!.depleted, true);
    }
    const own = table(count, [{ key: "giada", def: printing(GIADA), owner: P1 }, { key: "kill", def: kill(), owner: P1, zone: "hand" }]);
    own.engine.perform({ type: "playCard", playerId: P1, cardId: own.id("kill"), selected: { t: [own.id("giada")] } });
    settle(own);
    assert.equal(pending(own), undefined, "no option against the controller's own effect");
    assert.equal(zoneOf(own, "giada"), "discard", "Giada is destroyed");
  });
}

// =====================================================================================
// Octo-Ba-Ba, the Devourer
// =====================================================================================

const OCTO = "60ce2f1b-bb70-4195-a6db-e0caa629ce2a"; // When a character an opponent controls is destroyed, put a token on this card.

for (const count of [3, 4] as const) {
  clause(OCTO, "1:rule", `${count} seats: a character of any opponent being destroyed puts a token on Octo-Ba-Ba, with no opponent chosen; the controller's own character does not`, () => {
    const t = table(count, [
      { key: "octo", def: printing(OCTO), owner: P1 },
      ...seatsOf(count).map((seat) => ({ key: `kill-${seat}`, def: kill(`Kill ${seat}`), owner: P1, zone: "hand" as const })),
      ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}` }), owner: seat }))
    ]);
    let tokens = 0;
    for (const seat of othersOf(count)) {
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id(`kill-${seat}`), selected: { t: [t.id(`c-${seat}`)] } });
      settle(t);
      assert.equal(pending(t), undefined, "no chooseOpponent step");
      assert.equal(tokensOn(t, "octo"), ++tokens, `${seat}'s character destroyed gives a token`);
    }
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("kill-p1"), selected: { t: [t.id("c-p1")] } });
    settle(t);
    assert.equal(zoneOf(t, "c-p1"), "discard");
    assert.equal(tokensOn(t, "octo"), tokens, "the controller's own character gives no token");
  });
}

clause(OCTO, "1:rule", "3 seats: eliminating one opponent changes nothing about the other's characters", () => {
  const t = table(3, [
    { key: "octo", def: printing(OCTO), owner: P1 },
    { key: "kill", def: kill(), owner: P1, zone: "hand" },
    { key: "c-p3", def: character({ name: "Char p3" }), owner: P3 }
  ]);
  t.engine.state.players[P2]!.eliminated = { turn: 1 };
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("kill"), selected: { t: [t.id("c-p3")] } });
  settle(t);
  assert.equal(tokensOn(t, "octo"), 1);
});

// =====================================================================================
// The Great Wall of Keeping Stuff Out
// =====================================================================================

const WALL = "8866ccbf-a8dc-4c2f-8dbc-4d879b5b10cf"; // When a player deploys a tactic, terminate it and inflict 1 damage to this card.

for (const count of [3, 4] as const) {
  clause(WALL, "0:rule", `${count} seats: a tactic deployed by any player (the controller or any opponent) is terminated and damages the Wall by 1; other cards are unaffected`, () => {
    for (const seat of seatsOf(count)) {
      const t = table(
        count,
        [
          { key: "wall", def: printing(WALL), owner: P1 },
          { key: "trick", def: tactic({ name: `Trick ${seat}`, cost: 0 }), owner: seat, zone: "hand" },
          { key: "guy", def: character({ name: `Guy ${seat}` }), owner: seat, zone: "hand" }
        ],
        { active: seat }
      );
      t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id("trick") });
      settle(t);
      assert.equal(t.engine.state.cards[t.id("wall")]!.damage, 1, `${seat}'s tactic damages the Wall`);
      assert.equal(zoneOf(t, "trick"), "discard", "terminated");
      t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id("guy") });
      settle(t);
      assert.equal(zoneOf(t, "guy"), "play", "a non-tactic is unaffected");
      assert.equal(t.engine.state.cards[t.id("wall")]!.damage, 1);
    }
  });
}
