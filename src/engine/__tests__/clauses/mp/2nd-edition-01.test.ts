// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 2: "either deck" (Arcanist's Almanac, Nearby
// Serpent), "both players" (Ashes of Zenobia) and "your opponent may do the same" (3p1ph4ny 31f). Expectations come from
// each card's PRINTED text, the multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, tactic } from "../../per-card/_harness.js";
import { clause, printing } from "../_clause.js";
import { COUNTS, answerFor, candidatesOf, ids, others, pickable, pickFor, pinger, plain, refused, respondToAbility } from "./_seats2ndEdition.js";
import { choosePlayer, deckOf, handOf, open, P1, P2, P3, playCard, playersNeeded, resolvePendingResponses, seatsOf, table, zoneOf, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const factionOf = (t: Table, who: PlayerId): string => t.engine.state.players[who]!.factionId!;
const topFive = (t: Table, who: PlayerId): string[] => deckOf(t, who).slice(0, 5);

// =================================================================================
// Arcanist's Almanac
// FORESIGHT -- COST: Deplete this card. -- EFFECT: Look at up to the top 5 cards of either deck. Put them back in any order.
// "Either deck": the controller's deck, or the deck of the one opponent the controller chooses (MPQ-P6).
// =================================================================================

const ALMANAC = "28addfe9-b290-465c-a241-ce788297665a";

const almanacTable = (count: Count): Table =>
  table(count, [{ key: "alm", def: printing(ALMANAC), owner: P1, zone: "play" }, ...seatsOf(count).flatMap((seat) => plain(`d${seat}-`, 6, seat, "deck"))]);

const foresight = (t: Table, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: P1, cardId: t.id("alm"), abilityId: "almanac-foresight", ...extra }) as never;

/** The deck pick's candidates once `opponent` is chosen (every deck the pick may name, as the owning factions). */
const decksOffered = (t: Table, opponent?: PlayerId): string[] => {
  const needs = t.engine.getPlayRequirements(foresight(t, opponent ? { players: { opponent } } : {}));
  const pick = needs.find((need) => need.kind === "pick");
  assert.ok(pick && pick.kind === "pick", "the deck pick is asked");
  return [...pick.candidates].sort();
};

for (const count of COUNTS) {
  clause(ALMANAC, "0:ability:almanac-foresight", `${count} seats: either deck is the controller's or the chosen opponent's; no other deck is offered or reordered`, () => {
    for (const opponent of others(count)) {
      {
        const t = almanacTable(count);
        assert.deepEqual(playersNeeded(t, foresight(t)), [{ id: "opponent", candidates: seatsOf(count).slice(1) }], "the opponent is chosen before the deck");
        assert.deepEqual(decksOffered(t, opponent), [factionOf(t, P1), factionOf(t, opponent)].sort(), "exactly two decks: P1's and the chosen opponent's");
      }
      for (const whose of [opponent, P1]) {
        const t = almanacTable(count);
        const before = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
        t.engine.perform(foresight(t, { players: { opponent }, selected: { deckOwner: [factionOf(t, whose)] } }));
        resolvePendingResponses(t.engine);
        const pc = open(t);
        assert.equal(pc?.kind, "reorderDeck");
        assert.equal(pc?.playerId, P1);
        const five = topFive(t, whose);
        answerFor(t, P1, "reorderDeck", { order: [...five].reverse() });
        assert.deepEqual(deckOf(t, whose), [...five.reverse(), ...before[whose]!.slice(5)], "the looked-at deck's top 5 are in the new order and nothing left it");
        for (const seat of t.seats.filter((s) => s !== whose)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck keeps its order`);
        assert.equal(t.engine.state.cards[t.id("alm")]!.depleted, true, "FORESIGHT depleted the card");
      }
    }
    // A pick of a deck that is neither P1's nor the chosen opponent's is refused.
    {
      const t = almanacTable(count);
      const stranger = others(count, P2)[0]!;
      refused(() => t.engine.perform(foresight(t, { players: { opponent: P2 }, selected: { deckOwner: [factionOf(t, stranger)] } })), "a deck of a player who is not the chosen opponent");
    }
    // "Up to": looking at none of the 5 is legal.
    {
      const t = almanacTable(count);
      const before = [...deckOf(t, P2)];
      t.engine.perform(foresight(t, { players: { opponent: P2 }, selected: { deckOwner: [factionOf(t, P2)] } }));
      resolvePendingResponses(t.engine);
      answerFor(t, P1, "reorderDeck", { order: [] });
      assert.deepEqual(deckOf(t, P2), before);
    }
    // Only one opponent left: nobody is asked, and the decks offered are P1's and that opponent's.
    {
      const t = almanacTable(count);
      for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
      assert.equal(playersNeeded(t, foresight(t)), undefined);
      assert.deepEqual(decksOffered(t), [factionOf(t, P1), factionOf(t, P2)].sort());
    }
  });
}

// =================================================================================
// Nearby Serpent
// COVERT. When this card enters play, look at up to the top 5 cards of either deck. Put them back in any order.
// =================================================================================

const SERPENT = "f96cbc48-3e51-48d9-9ac6-3537d1c78e6d";

const serpentTable = (count: Count): Table =>
  table(count, [{ key: "serpent", def: printing(SERPENT), owner: P1, zone: "hand" }, ...bank("obsession", 3, P1), ...seatsOf(count).flatMap((seat) => plain(`d${seat}-`, 6, seat, "deck"))]);

for (const count of COUNTS) {
  clause(SERPENT, "1:rule", `${count} seats: the opponent is chosen when the trigger resolves; either deck is P1's or that opponent's, and no other deck is offered or reordered`, () => {
    for (const opponent of others(count)) {
      for (const whose of [opponent, P1]) {
        const t = serpentTable(count);
        const before = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
        playCard(t, P1, "serpent");
        choosePlayer(t, P1, seatsOf(count).slice(1), opponent);
        assert.deepEqual(pickable(t), [factionOf(t, P1), factionOf(t, opponent)].sort(), "exactly two decks: P1's and the chosen opponent's");
        pickFor(t, P1, [factionOf(t, whose)]);
        const five = topFive(t, whose);
        answerFor(t, P1, "reorderDeck", { order: [...five].reverse() });
        assert.deepEqual(deckOf(t, whose), [...five.reverse(), ...before[whose]!.slice(5)]);
        for (const seat of t.seats.filter((s) => s !== whose)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck keeps its order`);
      }
    }
    // "Up to": none of the 5 is legal.
    {
      const t = serpentTable(count);
      const before = [...deckOf(t, P2)];
      playCard(t, P1, "serpent");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      pickFor(t, P1, [factionOf(t, P2)]);
      answerFor(t, P1, "reorderDeck", { order: [] });
      assert.deepEqual(deckOf(t, P2), before);
    }
    // Only one opponent left: nobody is asked, and the decks offered are P1's and that opponent's.
    {
      const t = serpentTable(count);
      for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
      playCard(t, P1, "serpent");
      assert.equal(open(t)?.kind, "chooserSelectsTarget", "the deck pick comes first: no opponent choice");
      assert.deepEqual(pickable(t), [factionOf(t, P1), factionOf(t, P2)].sort());
    }
  });
}

// =================================================================================
// Ashes of Zenobia
// NULLIFY -- COST: Pay 5. -- EFFECT: Both players put a character they control into its owner's hand.
// "Both players" (MP 3): the controller and the one opponent chosen when the ability is used.
// =================================================================================

const ASHES = "b175a535-2a58-4df1-806d-6828e76d2868";

function ashesTable(count: Count): Table {
  return table(count, [
    { key: "ashes", def: printing(ASHES), owner: P1, zone: "play" },
    ...bank("obsession", 5, P1),
    ...seatsOf(count).flatMap((seat) => plain(`c${seat}-`, 2, seat, "play")),
    // P1 controls a character that P2 owns
    { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }
  ]);
}

const nullify = (t: Table, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: P1, cardId: t.id("ashes"), abilityId: "nullify", ...extra }) as never;

for (const count of COUNTS) {
  clause(ASHES, "2:ability:nullify", `${count} seats: both players are P1 and the opponent P1 chooses; only those two put a character into its owner's hand`, () => {
    for (const opponent of others(count)) {
      const t = ashesTable(count);
      assert.deepEqual(playersNeeded(t, nullify(t)), [{ id: "opponent", candidates: seatsOf(count).slice(1) }], "the opponent is chosen with the activation");
      t.engine.perform(nullify(t, { players: { opponent } }));
      resolvePendingResponses(t.engine);
      // the active player (P1) first, then the chosen opponent
      assert.equal(open(t)?.playerId, P1);
      assert.ok(pickable(t).includes(t.id("stolen")) && pickable(t).includes(t.id("cp1-0")), "P1 may pick any character P1 controls");
      assert.ok(!pickable(t).includes(t.id(`c${opponent}-0`)), "never a character of the opponent");
      pickFor(t, P1, [t.id("stolen")]);
      assert.equal(open(t)?.playerId, opponent, "then the chosen opponent");
      assert.deepEqual(pickable(t), ids(t, `c${opponent}-0`, `c${opponent}-1`).sort(), "the opponent may pick only characters the opponent controls");
      pickFor(t, opponent, [t.id(`c${opponent}-1`)]);
      assert.equal(open(t), undefined, "nobody else is prompted");
      assert.ok(handOf(t, P2).includes(t.id("stolen")), "a character P1 controls but P2 owns returns to its owner's hand");
      assert.equal(zoneOf(t, `c${opponent}-1`), "hand");
      for (const seat of others(count, opponent)) {
        for (const key of [`c${seat}-0`, `c${seat}-1`]) assert.equal(zoneOf(t, key), "play", `${seat}'s characters stay`);
      }
      assert.equal(zoneOf(t, "cp1-0"), "play", "P1 put only one character into hand");
    }
    // Only one opponent left: nobody is asked.
    const t = ashesTable(count);
    for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
    assert.equal(playersNeeded(t, nullify(t)), undefined);
    t.engine.perform(nullify(t));
    resolvePendingResponses(t.engine);
    pickFor(t, P1, [t.id("cp1-0")]);
    pickFor(t, P2, [t.id("cp2-0")]);
    assert.equal(open(t), undefined);
  });
}

// =================================================================================
// 3p1ph4ny 31f
// When this card enters play, you may play a non-tactic card for free. If you do, your opponent may do the same.
// =================================================================================

const EPIPHANY = "3398fc6e-d1fd-487d-85f2-59486e3256eb";

function epiphanyTable(count: Count, active: PlayerId = P1): Table {
  return table(
    count,
    [
      { key: "e", def: printing(EPIPHANY), owner: P1, zone: "hand" },
      { key: "p1-char", def: character({ name: "P1 free character", cost: 9 }), owner: P1, zone: "hand" },
      { key: "p1-tactic", def: tactic({ name: "P1 tactic", cost: 1 }), owner: P1, zone: "hand" },
      ...seatsOf(count).slice(1).flatMap((seat) => [
        { key: `${seat}-char`, def: character({ name: `${seat} free character`, cost: 7 }), owner: seat, zone: "hand" as const },
        { key: `${seat}-tactic`, def: tactic({ name: `${seat} tactic`, cost: 1 }), owner: seat, zone: "hand" as const }
      ]),
      ...bank("elitism", 5, P1)
    ],
    active
  );
}

const freePrompt = (t: Table, who: PlayerId): string[] => {
  const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] } | undefined;
  assert.equal(pc?.kind, "deployForFree", `a free-play offer for ${who}`);
  assert.equal(pc.playerId, who);
  return [...pc.candidates].sort();
};
const freeAnswer = (t: Table, who: PlayerId, key?: string): void => {
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "deployForFree", ...(key ? { cardId: t.id(key) } : {}) } } as never);
  resolvePendingResponses(t.engine);
};

for (const count of COUNTS) {
  clause(EPIPHANY, "0:rule", `${count} seats: if P1 plays a card for free, only the opponent P1 chooses may do the same; if P1 does not, nobody else is offered anything`, () => {
    for (const opponent of others(count)) {
      const t = epiphanyTable(count);
      playCard(t, P1, "e");
      choosePlayer(t, P1, seatsOf(count).slice(1), opponent);
      assert.deepEqual(freePrompt(t, P1), [t.id("p1-char")], "a tactic is not a non-tactic card");
      refused(() => freeAnswer(t, P1, "p1-tactic"), "a tactic cannot be played for free");
      freeAnswer(t, P1, "p1-char");
      assert.equal(zoneOf(t, "p1-char"), "play");
      assert.deepEqual(freePrompt(t, opponent), [t.id(`${opponent}-char`)], "only the chosen opponent is offered, a non-tactic card of their own hand");
      freeAnswer(t, opponent, `${opponent}-char`);
      assert.equal(zoneOf(t, `${opponent}-char`), "play");
      assert.equal(open(t), undefined);
      for (const seat of others(count, opponent)) assert.equal(zoneOf(t, `${seat}-char`), "hand", `${seat} was offered nothing`);
    }
    // The chosen opponent may decline.
    {
      const t = epiphanyTable(count);
      playCard(t, P1, "e");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      freeAnswer(t, P1, "p1-char");
      freePrompt(t, P2);
      freeAnswer(t, P2);
      assert.equal(zoneOf(t, "p2-char"), "hand");
      assert.equal(open(t), undefined);
    }
    // P1 declines: nobody else is offered anything.
    {
      const t = epiphanyTable(count);
      playCard(t, P1, "e");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      freePrompt(t, P1);
      freeAnswer(t, P1);
      assert.equal(open(t), undefined, "neither opponent is offered a free play");
      for (const seat of seatsOf(count).slice(1)) assert.equal(zoneOf(t, `${seat}-char`), "hand");
    }
    // It enters play on P2's turn (P1 puts it into play in response to P2's ability): P1, not the active player, still chooses.
    {
      const t = table(
        count,
        [
          { key: "e", def: printing(EPIPHANY), owner: P1, zone: "discard" },
          { key: "revive", def: tactic({ name: "Revive", behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "x", selector: { zone: "discard", owner: "self", name: "3p1ph4ny 31f" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "x" }, controller: "controller" }] }] } }), owner: P1, zone: "hand" },
          { key: "p1-char", def: character({ name: "P1 free character", cost: 9 }), owner: P1, zone: "hand" },
          pinger(),
          ...seatsOf(count).slice(1).map((seat) => ({ key: `${seat}-char`, def: character({ name: `${seat} free character`, cost: 7 }), owner: seat, zone: "hand" as const }))
        ],
        P2
      );
      respondToAbility(t);
      playCard(t, P1, "revive", { selected: { x: [t.id("e")] } });
      assert.equal(zoneOf(t, "e"), "play");
      choosePlayer(t, P1, seatsOf(count).slice(1), P3);
      freePrompt(t, P1);
      freeAnswer(t, P1, "p1-char");
      assert.deepEqual(freePrompt(t, P3), [t.id("p3-char")], "the opponent P1 chose (not the active player) is offered");
    }
    // Only one opponent left: nobody is asked to choose.
    {
      const t = epiphanyTable(count);
      for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
      playCard(t, P1, "e");
      assert.equal(open(t)?.kind, "deployForFree", "no opponent choice with one opponent left");
      freeAnswer(t, P1, "p1-char");
      freePrompt(t, P2);
    }
  });
}
