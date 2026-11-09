// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 02: the clauses whose data changed (Hideous Hexapede of
// Horror, Resistance Fighter) and the battle / lasting-text cards. Expectations come from the printed text of each
// clause (data/card-tests/mp-spec/seed-2.json); engine data only drives the engine.

import assert from "node:assert/strict";
import { mpClause, printing, refused } from "../_clause.js";
import {
  answerTargets, askedPlayers, character, deckOf, handSize, hands, idsOf, influenceOf, others, P1, P2, P3, P4, pending, perSeat, requirements, resources, seatsFor, settle,
  statOf, table, zoneOf
} from "./_seed-2.js";
import type { CardPlacement } from "./_seed-2.js";

const HEXAPEDE = "de6f188a-119d-4da0-9965-70b258c40ec5";
const RESISTANCE_FIGHTER = "54acfe5d-ccfe-4f8e-b324-65b65e6d927f";

const COUNTS = [3, 4] as const;

// =====================================================================================
// Hideous Hexapede of Horror
// =====================================================================================

/** Hexapede in P1's play with six [O], two characters per seat, and in every seat 7 cards in hand, 7 in the discard pile and 8 in the deck. */
function hexapedeBoard(count: number, influence = 20) {
  const cards: CardPlacement[] = [
    { key: "hex", def: printing(HEXAPEDE), owner: P1, zone: "play" },
    ...resources("obsession", 6),
    ...seatsFor(count).flatMap((seat) => [0, 1].map((i) => ({ key: `c${i}-${seat}`, def: character({ name: `Char ${i} ${seat}` }), owner: seat, zone: "play" as const }))),
    ...hands(count, 7, "h"),
    ...seatsFor(count).flatMap((seat) => [
      ...Array.from({ length: 7 }, (_, i) => ({ key: `d${i}-${seat}`, def: character({ name: `Disc ${i} ${seat}` }), owner: seat, zone: "discard" as const })),
      ...deckOf(`k${seat}-`, 8, seat)
    ])
  ];
  return table(count, cards, { influence: Object.fromEntries(seatsFor(count).map((seat) => [seat, influence])) });
}

const keys = (prefix: string, n: number, seat: string): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}-${seat}`);

/** The six picked characters: both of P1's, P2's and P3's (and P4's first one at four seats the sixth is P4's). */
const victims = (count: number): string[] => (count === 3 ? [...keys("c", 2, P1), ...keys("c", 2, P2), ...keys("c", 2, P3)] : [...keys("c", 2, P1), ...keys("c", 2, P2), "c0-p3", "c0-p4"]);

for (const count of COUNTS) {
  mpClause(HEXAPEDE, "0:ability:hellish-hex", count, `${count} seats: every faction takes 6 but only you and the chosen opponent remove cards from hand, discard pile and deck`, () => {
    for (const chosen of others(count, P1)) {
      const t = hexapedeBoard(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("hex"), abilityId: "hellish-hex", selected: { victims: victims(count).map((key) => t.id(key)) } } as const;
      assert.deepEqual(askedPlayers(t, { type: "activateAbility", playerId: P1, cardId: t.id("hex"), abilityId: "hellish-hex" }), others(count, P1), "the opponent is chosen with the activation, before the targets");
      const needs = requirements(t, { type: "activateAbility", playerId: P1, cardId: t.id("hex"), abilityId: "hellish-hex", players: { opponent: chosen } });
      assert.equal(needs[0]!.kind, "pick");
      refused(() => t.engine.perform(action as never), "no opponent named", /opponent/i);
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      // "Both players remove 6 cards in their hand ... discard pile ... top 6 of their deck": the controller first (active player), then the chosen opponent.
      for (const who of [P1, chosen]) {
        assert.equal(pending(t)?.kind, "chooserSelectsTarget");
        assert.equal(pending(t)?.playerId, who);
        answerTargets(t, who, keys("h", 6, who).map((key) => t.id(key)));
        settle(t);
        assert.equal(pending(t)?.playerId, who);
        answerTargets(t, who, keys("d", 6, who).map((key) => t.id(key)));
        settle(t);
      }
      assert.equal(pending(t), undefined, "nobody else removes anything");
      for (const seat of seatsFor(count)) {
        const pair = seat === P1 || seat === chosen;
        assert.equal(influenceOf(t, seat), 14, `${seat}'s faction takes 6 (all factions)`);
        assert.equal(handSize(t, seat), pair ? 1 : 7, `${seat}'s hand`);
        const destroyed = victims(count).filter((key) => key.endsWith(`-${seat}`)).length + (seat === P1 ? 1 : 0); // + the Hexapede itself
        assert.equal(t.engine.state.players[seat]!.discard.length, (pair ? 1 : 7) + destroyed, `${seat}'s discard pile (its destroyed characters land there)`);
        assert.equal(t.engine.state.players[seat]!.deck.length, pair ? 2 : 8, `${seat}'s deck`);
      }
      for (const key of victims(count)) assert.equal(zoneOf(t, key), "discard", `${key} took 6 damage`);
    }
  });
}

mpClause(HEXAPEDE, "0:ability:hellish-hex", 4, "4 seats: the factions of players outside the pair that reach 0 together lose together and the game goes on with the pair", () => {
  const t = hexapedeBoard(4);
  t.engine.state.players[P3]!.influence = 6;
  t.engine.state.players[P4]!.influence = 6;
  t.engine.perform({
    type: "activateAbility", playerId: P1, cardId: t.id("hex"), abilityId: "hellish-hex",
    selected: { victims: victims(4).map((key) => t.id(key)) }, players: { opponent: P2 }
  } as never);
  settle(t);
  for (const who of [P1, P2]) {
    answerTargets(t, who, keys("h", 6, who).map((key) => t.id(key)));
    settle(t);
    answerTargets(t, who, keys("d", 6, who).map((key) => t.id(key)));
    settle(t);
  }
  assert.ok(t.engine.state.players[P3]!.eliminated, "P3 reached 0 in the same unit as P4");
  assert.ok(t.engine.state.players[P4]!.eliminated, "P4 reached 0 in the same unit as P3");
  assert.equal(t.engine.state.players[P1]!.eliminated, undefined);
  assert.equal(t.engine.state.players[P2]!.eliminated, undefined);
  assert.equal(influenceOf(t, P1), 14);
  assert.equal(handSize(t, P3), 0, "an eliminated player's cards leave the game");
});

// =====================================================================================
// Resistance Fighter
// =====================================================================================

/** Fighter plus `extra` cards; `others` is a list of [key, owner, controller]. */
function fighterBoard(count: number, extra: Array<[string, string, string]>) {
  return table(count, [
    { key: "fighter", def: printing(RESISTANCE_FIGHTER), owner: P1, zone: "play" },
    ...extra.map(([key, owner, controller]) => ({ key, def: character({ name: key }), owner, controller, zone: "play" as const }))
  ]);
}

for (const count of COUNTS) {
  mpClause(RESISTANCE_FIGHTER, "1:rule", count, `${count} seats: "a character you don't own" is a character owned by any other player: +2 strength, +2 life, +1 speed`, () => {
    const base = fighterBoard(count, [["mine", P1, P1]]);
    const [s, l, v] = [statOf(base, "fighter", "strength"), statOf(base, "fighter", "life"), statOf(base, "fighter", "speed")];
    // No other player's character under my control: no bonus, whatever the others control.
    const quiet = fighterBoard(count, [["mine", P1, P1], ["theirs-2", P2, P2], ["theirs-3", P3, P3], ["lent", P1, P2]]);
    assert.deepEqual([statOf(quiet, "fighter", "strength"), statOf(quiet, "fighter", "life"), statOf(quiet, "fighter", "speed")], [s, l, v], "characters controlled by someone else, or owned by me, give nothing");
    for (const owner of others(count, P1)) {
      const t = fighterBoard(count, [["mine", P1, P1], [`stolen-${owner}`, owner, P1]]);
      assert.deepEqual([statOf(t, "fighter", "strength"), statOf(t, "fighter", "life"), statOf(t, "fighter", "speed")], [s + 2, l + 2, v + 1], `a character owned by ${owner} that I control`);
    }
    // The bonus ends when the last such character leaves my control.
    const t = fighterBoard(count, [["stolen-p3", P3, P1]]);
    t.engine.state.cards[t.id("stolen-p3")]!.controllerId = P3;
    assert.equal(statOf(t, "fighter", "strength"), s, "the bonus ends");
  });
}
