// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 01: the "your opponent" cards that make one chosen
// opponent discard, look, lose cards or pay. Expectations come from the printed text of each clause
// (data/card-tests/mp-spec/seed-2.json); engine data only drives the engine.

import assert from "node:assert/strict";
import { mpClause, printing, refused } from "../_clause.js";
import {
  allIn, answerTargets, askedPlayers, character, deckOf, handSize, hands, idsOf, item, others, P1, P2, P3, pending, perSeat, pickable, requirements, resources, seatsFor,
  setDeck, settle, statOf, table, tactic, zoneOf
} from "./_seed-2.js";

const THAUMATURGE = "e2126c92-6654-406e-9bcc-c2682df3696f";
const PERTURB = "35c6055b-db4e-428b-ab6a-7caaf564f62f";
const REDONKULOUS = "464b99b7-c1b7-43ae-9248-68f7614fd2cb";
const RITUAL = "e93a6fc4-da98-4698-b44f-3d1269903dfb";
const PECULATE = "2db3791b-3472-44b9-ad9b-ea65743ea4fc";
const TIME_TRAVELER = "95faefae-3b2a-454b-a2a5-f10544095ff8";
const EPIC_SMACKDOWN = "0642737a-cb86-402f-bca9-293ea6c252cc";
const PLUNGING_SHRIEVER = "afecc5f2-5714-46ee-9279-b6827de2ee46";
const SMOTHERING = "48ac4062-dca5-469f-8b39-54f4519e137d";

const COUNTS = [3, 4] as const;

// =====================================================================================
// Imperial Thaumaturge
// =====================================================================================

for (const count of COUNTS) {
  mpClause(THAUMATURGE, "0:ability:tickle", count, `${count} seats: "Your opponent discards a card": the opponent is chosen first (any other seat), and only that opponent discards`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [{ key: "th", def: printing(THAUMATURGE), owner: P1, zone: "play" }, ...resources("elitism", 2), ...hands(count)]);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("th"), abilityId: "tickle" } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1), "P1 is offered exactly the other seats");
      refused(() => t.engine.perform(action as never), "an activation without naming the opponent", /opponent/i);
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.equal(pending(t)?.playerId, chosen, "the chosen opponent chooses their discard");
      assert.deepEqual(pickable(t), idsOf(t, [`h0-${chosen}`, `h1-${chosen}`]), "only the chosen opponent's hand is offered");
      t.engine.perform({ type: "resolvePendingChoice", playerId: chosen, choice: { kind: "chooserSelectsTarget", selected: [t.id(`h0-${chosen}`)] } });
      settle(t);
      assert.equal(zoneOf(t, `h0-${chosen}`), "discard");
      assert.equal(handSize(t, chosen), 1);
      for (const other of others(count, chosen)) assert.equal(handSize(t, other), 2, `${other} is untouched`);
    }
  });
}

mpClause(THAUMATURGE, "0:ability:tickle", 3, "3 seats: with one opponent left nobody is asked who", () => {
  const t = table(3, [{ key: "th", def: printing(THAUMATURGE), owner: P1, zone: "play" }, ...resources("elitism", 2), ...hands(3)]);
  t.engine.state.players[P2]!.eliminated = { turn: 1 };
  const action = { type: "activateAbility", playerId: P1, cardId: t.id("th"), abilityId: "tickle" } as const;
  assert.equal(askedPlayers(t, action), undefined);
  t.engine.perform(action as never);
  settle(t);
  assert.equal(pending(t)?.playerId, P3, "the only opponent left discards");
});

// =====================================================================================
// Perturb
// =====================================================================================

for (const count of COUNTS) {
  mpClause(PERTURB, "0:rule", count, `${count} seats: "your opponent's hand": the chosen opponent's non-resource cards are offered, that card is discarded, the follow-up pick names no player`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "spell", def: printing(PERTURB), owner: P1, zone: "hand" },
        ...resources("obsession", 5),
        ...hands(count, 2, "h"),
        ...perSeat(count, "r", "hand", (seat) => tactic({ name: `Tac ${seat}` })),
        ...perSeat(count, "c", "play", (seat) => character({ name: `Char ${seat}` }))
      ]);
      const action = { type: "playCard", playerId: P1, cardId: t.id("spell") } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      refused(() => t.engine.perform(action as never), "no opponent named", /opponent/i);
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      assert.equal(pending(t)?.playerId, P1, "the controller looks at the hand and picks");
      assert.deepEqual(pickable(t), idsOf(t, [`h0-${chosen}`, `h1-${chosen}`, `r-${chosen}`]), "non-resource cards of the chosen opponent only");
      answerTargets(t, P1, [t.id(`h0-${chosen}`)]);
      assert.equal(zoneOf(t, `h0-${chosen}`), "discard", "the chosen opponent discards that card");
      // "You may pick a card of the same type": no player is named, so every character in play qualifies.
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.deepEqual(pickable(t), idsOf(t, seatsFor(count).map((seat) => `c-${seat}`)));
      const bystander = others(count, P1, chosen)[0]!;
      answerTargets(t, P1, [t.id(`c-${bystander}`)]);
      settle(t);
      assert.equal(zoneOf(t, `c-${bystander}`), "hand", "put into its owner's hand");
      for (const other of others(count, P1, chosen)) assert.equal(zoneOf(t, `h0-${other}`), "hand", `${other}'s hand was never touched`);
    }
  });
}

// =====================================================================================
// Ritual of the Double Monkey
// =====================================================================================

for (const count of COUNTS) {
  mpClause(RITUAL, "0:rule", count, `${count} seats: "Your opponent discards a card ... another card ... another card": always the same chosen opponent, one more discard at 3 and at 8 [O]`, () => {
    for (const [obsession, discards] of [[3, 2], [8, 3]] as const) {
      for (const chosen of others(count, P1)) {
        const t = table(count, [
          { key: "spell", def: printing(RITUAL), owner: P1, zone: "hand" },
          ...resources("obsession", obsession),
          ...hands(count, 5)
        ]);
        const action = { type: "playCard", playerId: P1, cardId: t.id("spell") } as const;
        assert.deepEqual(askedPlayers(t, action), others(count, P1), "one opponent selection for the whole card");
        t.engine.perform({ ...action, players: { opponent: chosen } } as never);
        settle(t);
        for (let n = 0; n < discards; n++) {
          assert.equal(pending(t)?.kind, "chooserSelectsTarget", `discard ${n + 1}`);
          assert.equal(pending(t)?.playerId, chosen, "the chosen opponent chooses each discard");
          assert.deepEqual(pickable(t).sort(), idsOf(t, [0, 1, 2, 3, 4].map((i) => `h${i}-${chosen}`).filter((key) => zoneOf(t, key) === "hand")));
          answerTargets(t, chosen, [t.id(`h${n}-${chosen}`)]);
          settle(t);
        }
        assert.equal(pending(t), undefined);
        assert.equal(handSize(t, chosen), 5 - discards);
        for (const other of others(count, chosen)) assert.equal(handSize(t, other), other === P1 ? 5 : 5, `${other} discards nothing`);
      }
    }
  });
}

// =====================================================================================
// Redonkulous
// =====================================================================================

/** Redonkulous face-down in P1's play (for FLIP UP) or in hand, six [O], P2 with 5 cards in hand and every other opponent with 2. */
function redonkulousBoard(count: number, faceDown: boolean) {
  return table(count, [
    faceDown
      ? { key: "spell", def: printing(REDONKULOUS), owner: P1, zone: "play" as const, faceDown: true }
      : { key: "spell", def: printing(REDONKULOUS), owner: P1, zone: "hand" as const },
    ...resources("obsession", 6),
    ...perSeat(count, "c", "play", (seat) => character({ name: `Char ${seat}` })),
    ...hands(count, 2, "h").filter((card) => card.owner !== P2),
    ...hands(count, 5, "h").filter((card) => card.owner === P2)
  ]);
}

for (const count of COUNTS) {
  mpClause(REDONKULOUS, "0:ability", count, `${count} seats: FLIP UP: "your opponent discards 2 cards" and the 3-or-fewer check read the one chosen opponent only`, () => {
    // P2 has 5 cards: discarding 2 leaves 3, so the picked character is removed from the game; P3 has 2: discarding 2 leaves 0.
    for (const chosen of others(count, P1)) {
      const t = redonkulousBoard(count, true);
      const action = { type: "flipUp", playerId: P1, cardId: t.id("spell"), selected: { char: [t.id("c-p1")] } } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1), "the opponent is chosen with the flip");
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.equal(pending(t)?.playerId, chosen);
      assert.deepEqual(pickable(t), idsOf(t, [...Array(chosen === P2 ? 5 : 2).keys()].map((i) => `h${i}-${chosen}`)));
      answerTargets(t, chosen, [t.id(`h0-${chosen}`), t.id(`h1-${chosen}`)]);
      settle(t);
      assert.equal(handSize(t, chosen), chosen === P2 ? 3 : 0);
      for (const other of others(count, chosen, P1)) assert.equal(handSize(t, other), other === P2 ? 5 : 2, `${other} discards nothing`);
      assert.equal(zoneOf(t, "c-p1"), "removed", "the chosen opponent has 3 or fewer cards left: the character is removed from the game");
    }
  });

  mpClause(REDONKULOUS, "0:ability", count, `${count} seats: played normally nobody discards, and "3 or fewer cards" reads the chosen opponent's hand, not another opponent's`, () => {
    for (const chosen of others(count, P1)) {
      const t = redonkulousBoard(count, false);
      const action = { type: "playCard", playerId: P1, cardId: t.id("spell"), selected: { char: [t.id("c-p3")] } } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      assert.equal(pending(t), undefined, "no discard when not played with FLIP UP");
      for (const seat of others(count, P1)) assert.equal(handSize(t, seat), seat === P2 ? 5 : 2);
      // P2 holds 5 cards (more than 3), every other opponent 2: only the chosen opponent's hand decides.
      assert.equal(zoneOf(t, "c-p3"), chosen === P2 ? "play" : "removed");
    }
  });
}

// =====================================================================================
// Peculate
// =====================================================================================

for (const count of COUNTS) {
  mpClause(PECULATE, "0:ability", count, `${count} seats: "a card in your opponent's discard pile": only the chosen opponent's discard pile can be picked, and the card enters play under your control`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "spell", def: printing(PECULATE), owner: P1, zone: "hand" },
        ...resources("deception", 5),
        ...perSeat(count, "d", "discard", (seat) => character({ name: `Loot ${seat}`, cost: 1 }))
      ]);
      const action = { type: "playCard", playerId: P1, cardId: t.id("spell") } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1), "the opponent is asked before the pick");
      const needs = requirements(t, { ...action, players: { opponent: chosen } } as never);
      assert.equal(needs[0]!.kind, "pick");
      assert.deepEqual([...(needs[0]!.candidates as string[])].sort(), idsOf(t, [`d-${chosen}`]), "only the chosen opponent's discard pile");
      for (const other of others(count, chosen)) {
        refused(() => t.engine.perform({ ...action, players: { opponent: chosen }, selected: { loot: [t.id(`d-${other}`)] } } as never), `a card from ${other}'s discard pile`);
      }
      t.engine.perform({ ...action, players: { opponent: chosen }, selected: { loot: [t.id(`d-${chosen}`)] } } as never);
      settle(t);
      assert.equal(zoneOf(t, `d-${chosen}`), "play");
      assert.equal(t.engine.state.cards[t.id(`d-${chosen}`)]!.controllerId, P1, "under my control");
      for (const other of others(count, chosen)) if (other !== P1) assert.equal(zoneOf(t, `d-${other}`), "discard");
    }
  });
}

// =====================================================================================
// Time Traveler Tourist Trap
// =====================================================================================

for (const count of COUNTS) {
  mpClause(TIME_TRAVELER, "1:ability:micromajig-apocalypse", count, `${count} seats: "the number of cards in your opponent's deck": counted in the chosen opponent's deck only`, () => {
    const sizes: Record<string, number> = { p2: 7, p3: 3, p4: 5 };
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "trap", def: printing(TIME_TRAVELER), owner: P1, zone: "play", counters: { token: 20 } },
        ...resources("elitism", 6),
        ...others(count, P1).flatMap((seat) => deckOf(`k-${seat}-`, sizes[seat]!, seat))
      ]);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("trap"), abilityId: "micromajig-apocalypse" } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      const tokens = Object.values(t.engine.state.cards).filter((card) => card.zone === "play" && card.controllerId === P1 && t.engine.getDefinition(card.id).name === "Micromajig");
      assert.equal(tokens.length, sizes[chosen], `one Micromajig token per card in ${chosen}'s deck, the other decks are ignored`);
    }
  });
}

// =====================================================================================
// Epic Smackdown
// =====================================================================================

for (const count of COUNTS) {
  mpClause(EPIC_SMACKDOWN, "0:ability", count, `${count} seats: X characters of one chosen opponent are destroyed by that opponent (or all of theirs when they control fewer than X); other opponents lose nothing`, () => {
    // P2 controls 3 characters, P3 one, P4 two; X = 2.
    const counts: Record<string, number> = { p2: 3, p3: 1, p4: 2 };
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "spell", def: printing(EPIC_SMACKDOWN), owner: P1, zone: "hand" },
        ...resources("rage", 3),
        { key: "s0", def: character({ name: "Mine 0" }), owner: P1, zone: "play" },
        { key: "s1", def: character({ name: "Mine 1" }), owner: P1, zone: "play" },
        ...others(count, P1).flatMap((seat) => Array.from({ length: counts[seat]! }, (_, i) => ({ key: `o${i}-${seat}`, def: character({ name: `Theirs ${i} ${seat}` }), owner: seat, zone: "play" as const }))),
        ...deckOf("draw", 2, P1, (i) => character({ name: `Draw ${i}` }))
      ]);
      const action = { type: "playCard", playerId: P1, cardId: t.id("spell"), variables: { x: 2 }, selected: { sacX: [t.id("s0"), t.id("s1")] } } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      const owned = Array.from({ length: counts[chosen]! }, (_, i) => `o${i}-${chosen}`);
      if (counts[chosen]! >= 2) {
        assert.equal(pending(t)?.kind, "chooserSelectsTarget");
        assert.equal(pending(t)?.playerId, chosen, "the chosen opponent destroys their own characters");
        assert.deepEqual(pickable(t), idsOf(t, owned), "only the chosen opponent's characters");
        answerTargets(t, chosen, [t.id(owned[0]!), t.id(owned[1]!)]);
        settle(t);
        assert.equal(owned.filter((key) => zoneOf(t, key) === "discard").length, 2);
      } else {
        assert.equal(pending(t), undefined, "fewer than X characters: all of theirs are destroyed with no choice");
        assert.ok(allIn(t, owned, "discard"), "allIn(t, owned, 'discard')");
      }
      for (const other of others(count, P1, chosen)) {
        for (let i = 0; i < counts[other]!; i++) assert.equal(zoneOf(t, `o${i}-${other}`), "play", `${other}'s characters are untouched`);
      }
      assert.equal(handSize(t, P1), 1, "I draw a card");
    }
  });
}

// =====================================================================================
// Plunging Shriever
// =====================================================================================

for (const count of COUNTS) {
  mpClause(PLUNGING_SHRIEVER, "1:ability:fly-away", count, `${count} seats: "an item in your opponent's discard pile": only the chosen opponent's discard pile is offered`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "bird", def: printing(PLUNGING_SHRIEVER), owner: P1, zone: "play" },
        ...perSeat(count, "i", "discard", (seat) => item({ name: `Trinket ${seat}` }))
      ]);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("bird"), abilityId: "fly-away" } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      const needs = requirements(t, { ...action, players: { opponent: chosen } } as never);
      assert.equal(needs[0]!.kind, "pick");
      assert.deepEqual([...(needs[0]!.candidates as string[])].sort(), idsOf(t, [`i-${chosen}`]));
      for (const other of others(count, chosen)) {
        refused(() => t.engine.perform({ ...action, players: { opponent: chosen }, selected: { gone: [t.id(`i-${other}`)] } } as never), `an item from ${other}'s discard pile`);
      }
      t.engine.perform({ ...action, players: { opponent: chosen }, selected: { gone: [t.id(`i-${chosen}`)] } } as never);
      settle(t);
      assert.equal(zoneOf(t, `i-${chosen}`), "removed");
      assert.equal(t.engine.state.cards[t.id("bird")]!.faceDown, true, "flipped face-down");
      for (const other of others(count, chosen, P1)) assert.equal(zoneOf(t, `i-${other}`), "discard");
    }
  });
}

// =====================================================================================
// Smothering Corpulence
// =====================================================================================

for (const count of COUNTS) {
  mpClause(SMOTHERING, "0:ability", count, `${count} seats: "both players remove the top card of their deck ... your opponent's removed card": only you and the chosen opponent remove a card, X compares their two cards`, () => {
    const cost: Record<string, number> = { p2: 5, p3: 3, p4: 4 };
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "spell", def: printing(SMOTHERING), owner: P1, zone: "hand" },
        ...resources("deception", 4),
        { key: "victim", def: character({ name: "Victim", life: 10 }), owner: P3, zone: "play" },
        ...seatsFor(count).flatMap((seat) => [
          { key: `top-${seat}`, def: character({ name: `Top ${seat}`, cost: seat === P1 ? 1 : cost[seat]! }), owner: seat, zone: "deck" as const },
          { key: `next-${seat}`, def: character({ name: `Next ${seat}` }), owner: seat, zone: "deck" as const }
        ])
      ]);
      for (const seat of seatsFor(count)) setDeck(t, seat, [`top-${seat}`, `next-${seat}`]);
      const action = { type: "playCard", playerId: P1, cardId: t.id("spell"), selected: { c: [t.id("victim")] } } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      t.engine.perform({ ...action, players: { opponent: chosen } } as never);
      settle(t);
      assert.equal(zoneOf(t, `top-${chosen}`), "removed", "the chosen opponent removes their top card");
      assert.equal(zoneOf(t, "top-p1"), "removed", "I remove mine");
      for (const other of others(count, P1, chosen)) assert.equal(zoneOf(t, `top-${other}`), "deck", `${other} removes nothing`);
      assert.equal(statOf(t, "victim", "life"), 10 - (cost[chosen]! - 1), "X is the chosen opponent's card cost minus mine");
      assert.equal(zoneOf(t, "next-p1"), "hand", "I draw a card");
    }
  });
}
