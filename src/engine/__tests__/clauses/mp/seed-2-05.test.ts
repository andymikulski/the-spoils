// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 05: continuous and turn-based "your opponent" text
// (Padamose, Tumescent Guilt Bladder, Ass, Vast Mastabatorium, Rosy Palmer, Swinish Elder). Expectations come from the
// printed text of each clause (data/card-tests/mp-spec/seed-2.json); engine data only drives the engine.

import assert from "node:assert/strict";
import { clause, printing, refused } from "../_clause.js";
import {
  activateAs, answerPlayer, answerTargets, askedPlayers, character, choosePlayer, controllerOf, deckOf, endTurn, handSize, hands, idsOf, influenceOf, item, others, P1, P2, P3, pending,
  perSeat, pickable, playAs, resourceCard, resources, seatsFor, setDeck, settle, statOf, table, tactic, tokensOn, zoneOf
} from "./_seed-2.js";
import type { PlayerId } from "../../../../engine.js";
import type { Table } from "./_seed-2.js";

const PADAMOSE = "1be3f538-efa8-4269-ace1-af5a0ddcdefd";
const TUMESCENT = "0b790bde-153c-42d9-8038-feb93e327764";
const ASS = "e3fae5c4-c6ed-4c28-af91-2d85d11fceb1";
const MASTABATORIUM = "ab1abe6e-7428-492b-8eb1-0f0ceef7e512";
const ROSY = "4d801a32-d054-413d-9eaf-d915a82139b1";
const SWINISH_ELDER = "414bcffa-7213-40f1-810f-9563a33cc619";

const COUNTS = [3, 4] as const;

/** Answers `orderTriggers` prompts (first trigger first) until another prompt or none is open. */
function orderAll(t: Table): void {
  for (let guard = 0; pending(t)?.kind === "orderTriggers" && guard < 8; guard++) {
    t.engine.perform({ type: "resolvePendingChoice", playerId: pending(t)!.playerId, choice: { kind: "orderTriggers", next: (pending(t)!.triggers as never[])[0] } });
    settle(t);
  }
}

/** "Smite": a free tactic that destroys a chosen character. */
const smite = () => tactic({ name: "Smite", behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

// =====================================================================================
// Padamose, Emperor of Marduun
// =====================================================================================

/** Padamose in P1's hand with six [R]; every seat controls a "mau" character, an Arcanist character and a "sword of great justice" character. */
function padamoseBoard(count: number, extra: Parameters<typeof table>[1] = []) {
  return table(count, [
    { key: "pada", def: printing(PADAMOSE), owner: P1, zone: "hand" },
    ...resources("rage", 6),
    ...perSeat(count, "mau", "play", (seat) => character({ name: `Mau ${seat}`, subtype: ["mau"], strength: 3, life: 4 })),
    ...perSeat(count, "arc", "play", (seat) => character({ name: `Arcanist ${seat}`, trade: "arcanist", strength: 3, life: 4 })),
    ...perSeat(count, "sword", "play", (seat) => character({ name: `Sword ${seat}`, subtype: ["sword of great justice"], strength: 3, life: 4 })),
    ...extra
  ]);
}
const stats = (t: Table, key: string): [number, number] => [statOf(t, key, "strength"), statOf(t, key, "life")];

for (const count of COUNTS) {
  clause(PADAMOSE, "1:rule", `${count} seats: "All your 'sword of great justice' characters gain 1 strength and 1 life": only mine`, () => {
    for (const chosen of others(count, P1)) {
      const t = padamoseBoard(count);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pada") } as never);
      settle(t);
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      assert.deepEqual(stats(t, "sword-p1"), [4, 5], "my swords gain 1/1");
      for (const other of others(count, P1)) assert.deepEqual(stats(t, `sword-${other}`), [3, 4], `${other}'s swords are not mine`);
    }
  });

  clause(PADAMOSE, "2:rule", `${count} seats: "All your opponent's 'mau' characters and Arcanist characters lose 1 strength and 1 life": the opponent chosen when the text starts applying, nobody else`, () => {
    for (const chosen of others(count, P1)) {
      const t = padamoseBoard(count);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pada") } as never);
      settle(t);
      assert.equal(pending(t)?.kind, "choosePlayer", "the opponent is chosen when the text starts applying");
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      for (const seat of seatsFor(count)) {
        const hit = seat === chosen;
        assert.deepEqual(stats(t, `mau-${seat}`), hit ? [2, 3] : [3, 4], `${seat}'s "mau" character`);
        assert.deepEqual(stats(t, `arc-${seat}`), hit ? [2, 3] : [3, 4], `${seat}'s Arcanist character`);
      }
    }
  });
}

clause(PADAMOSE, "2:rule", "3 seats: with one opponent left nobody is asked", () => {
  const t = padamoseBoard(3);
  t.engine.state.players[P2]!.eliminated = { turn: 1 };
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pada") } as never);
  settle(t);
  assert.equal(pending(t), undefined);
  assert.deepEqual(stats(t, "mau-p3"), [2, 3]);
  assert.deepEqual(stats(t, "mau-p1"), [3, 4]);
});

for (const count of COUNTS) {
  clause(PADAMOSE, "2:rule", `${count} seats: if the chosen opponent is eliminated the controller chooses again`, () => {
    const t = padamoseBoard(count, [
      { key: "drain", def: tactic({ name: "Drain", behavior: { abilities: [{ id: "drain", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }] }] } }), owner: P1, zone: "hand" }
    ]);
    t.engine.state.players[P2]!.influence = 1;
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pada") } as never);
    settle(t);
    choosePlayer(t, P1, others(count, P1), P2);
    settle(t);
    assert.deepEqual(stats(t, "mau-p2"), [2, 3]);
    // Knock P2 out with a real card (naming P2 as that card's opponent).
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("drain"), players: { opponent: P2 } } as never);
    settle(t);
    assert.ok(t.engine.state.players[P2]!.eliminated, "P2 is out");
    if (count === 3) {
      assert.equal(pending(t), undefined, "only P3 is left: nobody is asked");
    } else {
      choosePlayer(t, P1, [P3, "p4"], "p4");
      settle(t);
      assert.deepEqual(stats(t, "mau-p3"), [3, 4]);
    }
    const next = count === 3 ? "p3" : "p4";
    assert.deepEqual(stats(t, `mau-${next}`), [2, 3], "the new opponent's characters lose 1/1");
    assert.deepEqual(stats(t, "mau-p1"), [3, 4]);
  });
}

// =====================================================================================
// Tumescent Guilt Bladder
// =====================================================================================

/** Bladder in P1's play with `tokens` tokens; every seat has a resource in hand; P1 is active. */
function bladderBoard(count: number, tokens: number, active: PlayerId = P1) {
  return table(
    count,
    [
      { key: "tgb", def: printing(TUMESCENT), owner: P1, zone: "play", counters: { token: tokens } },
      ...perSeat(count, "res", "hand", (seat) => resourceCard({ name: `Coin ${seat}` })),
      ...hands(count, 1, "h")
    ],
    { active }
  );
}

for (const count of COUNTS) {
  clause(TUMESCENT, "0:rule", `${count} seats: "At the end of your turn": a token, my faction loses X influence and I may play a resource at the end of my turn only`, () => {
    const t = bladderBoard(count, 0);
    const influence = Object.fromEntries(seatsFor(count).map((seat) => [seat, influenceOf(t, seat)]));
    t.engine.perform({ type: "endTurn", playerId: P1 });
    settle(t);
    assert.equal(pending(t)?.kind, "chooserSelectsTarget", "I may play a resource");
    assert.equal(pending(t)?.playerId, P1);
    answerTargets(t, P1, [t.id("res-p1")]);
    settle(t);
    assert.equal(tokensOn(t, "tgb"), 1);
    assert.equal(influence[P1]! - influenceOf(t, P1), 1, "my faction loses X = 1");
    assert.equal(zoneOf(t, "res-p1"), "play");
    // The opponents' turns end without it.
    for (const seat of others(count, P1)) {
      assert.equal(t.engine.state.activePlayerId, seat);
      endTurn(t, seat);
      assert.equal(pending(t)?.kind === "chooserSelectsTarget" && pending(t)?.playerId === seat, false, `${seat}'s end of turn does not set it off`);
      if (seat !== seatsFor(count)[count - 1]) assert.equal(pending(t), undefined);
    }
    assert.equal(tokensOn(t, "tgb"), 1, "still one token");
    for (const seat of others(count, P1)) assert.equal(influence[seat]! - influenceOf(t, seat), 0);
  });
}

for (const count of COUNTS) {
  clause(TUMESCENT, "1:rule", `${count} seats: "At the start of each turn ... your opponent takes control of it": the controller chooses which opponent when the trigger resolves, and the new controller chooses among their own opponents`, () => {
    for (const chosen of others(count, P1)) {
      const t = bladderBoard(count, 2);
      t.engine.perform({ type: "endTurn", playerId: P1 });
      settle(t);
      answerTargets(t, P1, [t.id("res-p1")]); // "You may play a resource"
      settle(t);
      assert.equal(tokensOn(t, "tgb"), 3);
      orderAll(t);
      assert.equal(pending(t)?.kind, "choosePlayer", "at the start of the next turn the opponent is chosen as the trigger resolves");
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      assert.equal(controllerOf(t, "tgb"), chosen, "the chosen opponent takes control");
      assert.equal(tokensOn(t, "tgb"), 0, "all tokens are removed");
      for (const other of others(count, P1, chosen)) assert.notEqual(controllerOf(t, "tgb"), other);
      assert.equal(pending(t), undefined);
      // The new controller's own opponents are the other players (the old controller among them).
      t.engine.state.cards[t.id("tgb")]!.counters = { token: 3 };
      // "At the start of each turn": the next turn's start sets it off again, for its new controller.
      endTurn(t, t.engine.state.activePlayerId);
      if (pending(t)?.kind === "chooserSelectsTarget") {
        // The new controller's own end of turn came first: "You may play a resource".
        answerTargets(t, chosen, [t.id(`res-${chosen}`)]);
        settle(t);
      }
      orderAll(t);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, chosen, "the new controller chooses");
      assert.deepEqual([...(pending(t)!.candidates as PlayerId[])].sort(), others(count, chosen), "among their own opponents");
    }
  });
}

// =====================================================================================
// Ass
// =====================================================================================

/** Ass in P1's play; every opponent controls and owns a character, P2 also holds one owned by P3 and the reverse, and P1 is active. */
function assBoard(count: number) {
  return table(
    count,
    [
      { key: "ass", def: printing(ASS), owner: P1, zone: "play" },
      ...perSeat(count, "own", "play", (seat) => character({ name: `Own ${seat}` })),
      { key: "lent-p3-to-p2", def: character({ name: "Lent to P2" }), owner: P3, controller: P2, zone: "play" },
      { key: "lent-p2-to-p3", def: character({ name: "Lent to P3" }), owner: P2, controller: P3, zone: "play" }
    ],
    { active: P1 }
  );
}

/** Ends P1's turn and answers the two "your opponent" selections of Ass and the picks that follow. */
function endTurnWithAss(t: Table, count: number, pickOpponent: PlayerId, takeOpponent: PlayerId, pick?: string): void {
  t.engine.perform({ type: "endTurn", playerId: P1 });
  settle(t);
  orderAll(t);
  for (let guard = 0; pending(t) && guard < 8; guard++) {
    const pc = pending(t)!;
    if (pc.kind === "choosePlayer") {
      const answer = pc.abilityId === "borrowed-body" ? pickOpponent : takeOpponent;
      choosePlayer(t, P1, others(count, P1), answer);
    } else if (pc.kind === "chooserSelectsTarget") {
      assert.equal(pc.playerId, pickOpponent, "only the chosen opponent picks");
      assert.deepEqual(pickable(t), idsOf(t, [`own-${pickOpponent}`]), "a character they both control and own");
      answerTargets(t, pickOpponent, [t.id(pick ?? `own-${pickOpponent}`)]);
    } else break;
    settle(t);
    orderAll(t);
  }
}

for (const count of COUNTS) {
  clause(ASS, "0:rule", `${count} seats: "your opponent picks a character they control and own ... take control of that character": the chosen opponent picks and nobody else is asked`, () => {
    for (const chosen of others(count, P1)) {
      const t = assBoard(count);
      endTurnWithAss(t, count, chosen, chosen);
      assert.equal(controllerOf(t, `own-${chosen}`), P1, "I take control of the character they picked");
      for (const other of others(count, P1, chosen)) assert.equal(controllerOf(t, `own-${other}`), other, `${other}'s characters are untouched`);
      assert.equal(controllerOf(t, "lent-p3-to-p2"), P2);
      assert.equal(controllerOf(t, "lent-p2-to-p3"), P3);
    }
  });

  clause(ASS, "1:rule", `${count} seats: "your opponent takes control of this card": a separate block, the opponent is chosen independently of the first clause's`, () => {
    for (const chosen of others(count, P1)) {
      const first = others(count, P1, chosen)[0]!;
      const t = assBoard(count);
      endTurnWithAss(t, count, first, chosen);
      assert.equal(controllerOf(t, "ass"), chosen, "the chosen opponent takes control of Ass");
      for (const other of others(count, P1, chosen)) assert.notEqual(controllerOf(t, "ass"), other);
      assert.equal(controllerOf(t, `own-${first}`), P1, "the first clause's opponent was a different player");
    }
  });
}

// =====================================================================================
// Vast Mastabatorium
// =====================================================================================

function mastaBoard(count: number) {
  return table(count, [
    { key: "mast", def: printing(MASTABATORIUM), owner: P1, zone: "play" },
    ...resources("deception", 4),
    ...seatsFor(count).flatMap((seat) => deckOf(`k-${seat}-`, 4, seat))
  ]);
}

for (const count of COUNTS) {
  clause(MASTABATORIUM, "0:ability:you-know-you-want-to", `${count} seats: "At the end of the turn ... your opponent takes control of it": the opponent chosen when the ability was activated, nobody else`, () => {
    for (const chosen of others(count, P1)) {
      const t = mastaBoard(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("mast"), abilityId: "you-know-you-want-to" } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      refused(() => t.engine.perform(action as never), "no opponent named", /opponent/i);
      const hand = handSize(t, P1);
      activateAs(t, "mast", "you-know-you-want-to", { players: { opponent: chosen } });
      assert.equal(handSize(t, P1), hand + 1, "I draw a card");
      assert.equal(controllerOf(t, "mast"), P1, "it changes hands only at the end of the turn");
      endTurn(t, P1);
      assert.equal(tokensOn(t, "mast"), 1);
      assert.equal(controllerOf(t, "mast"), chosen, "the chosen opponent takes control");
    }
  });

  clause(MASTABATORIUM, "0:ability:you-know-you-want-to", `${count} seats: two activations in one turn choosing different opponents each hand it over to their own chosen opponent`, () => {
    const t = mastaBoard(count);
    const [first, second] = others(count, P1);
    activateAs(t, "mast", "you-know-you-want-to", { players: { opponent: first } });
    activateAs(t, "mast", "you-know-you-want-to", { players: { opponent: second } });
    endTurn(t, P1);
    assert.equal(tokensOn(t, "mast"), 2, "one token per activation");
    assert.equal(controllerOf(t, "mast"), second, "the later delayed effect hands it to its own chosen opponent");
    for (const other of others(count, P1, first, second)) assert.notEqual(controllerOf(t, "mast"), other);
  });
}

// =====================================================================================
// Rosy Palmer, and Her Five Friends
// =====================================================================================

for (const count of COUNTS) {
  clause(ROSY, "1:rule", `${count} seats: "reveal the top 5 cards of your opponent's deck": the opponent is chosen when the trigger resolves, only their deck is revealed, the rest goes to the bottom of their deck`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "rosy", def: printing(ROSY), owner: P1, zone: "play" },
        { key: "smite", def: smite(), owner: P1, zone: "hand" },
        ...others(count, P1).flatMap((seat) =>
          ["i1", "c1", "i2", "c2", "i3", "x6", "x7"].map((key) => ({
            key: `${key}-${seat}`,
            def: key.startsWith("c") ? character({ name: `Recruit ${key} ${seat}` }) : item({ name: `Junk ${key} ${seat}` }),
            owner: seat,
            zone: "deck" as const
          }))
        )
      ]);
      for (const seat of others(count, P1)) setDeck(t, seat, ["i1", "c1", "i2", "c2", "i3", "x6", "x7"].map((key) => `${key}-${seat}`));
      // x6 and x7 are the 6th and 7th cards: x6 is a character that must NOT be offered (it is not in the top 5).
      t.engine.state.cards[t.id(`x6-${chosen}`)]!.definitionId = t.engine.state.cards[t.id(`c1-${chosen}`)]!.definitionId;
      const bystanderDecks = Object.fromEntries(others(count, P1, chosen).map((seat) => [seat, [...t.engine.state.players[seat]!.deck]]));
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("smite"), selected: { t: [t.id("rosy")] } } as never);
      settle(t);
      assert.equal(zoneOf(t, "rosy"), "discard");
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.equal(pending(t)?.playerId, P1, "I choose among the revealed characters");
      assert.deepEqual(pickable(t), idsOf(t, [`c1-${chosen}`, `c2-${chosen}`]), "only the characters among the top 5 of the chosen opponent's deck");
      answerTargets(t, P1, [t.id(`c2-${chosen}`)]);
      settle(t);
      assert.equal(zoneOf(t, `c2-${chosen}`), "play");
      assert.equal(controllerOf(t, `c2-${chosen}`), P1, "under my control");
      assert.equal(pending(t)?.kind, "reorderDeck");
      assert.equal(pending(t)?.playerId, chosen, "the chosen opponent puts the rest on the bottom");
      const rest = pending(t)!.cardIds as string[];
      assert.equal(rest.length, 4);
      t.engine.perform({ type: "resolvePendingChoice", playerId: chosen, choice: { kind: "reorderDeck", order: [...rest].reverse() } });
      settle(t);
      assert.deepEqual(t.engine.state.players[chosen]!.deck.slice(-4), [...rest].reverse());
      for (const [seat, deck] of Object.entries(bystanderDecks)) assert.deepEqual(t.engine.state.players[seat]!.deck, deck, `${seat}'s deck is untouched`);
    }
  });
}

// =====================================================================================
// Swinish Elder
// =====================================================================================

/** An item that plays a resource from its controller's hand (the resource play that sets the Elder off). */
const maker = (seat: PlayerId) =>
  item({
    name: `Maker ${seat}`,
    behavior: {
      abilities: [
        {
          id: "mk",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "r", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1 },
              effects: [{ type: "playResource", target: { type: "selected", id: "r" }, faceDown: "auto" }]
            }
          ]
        }
      ]
    }
  });

function elderBoard(count: number, active: PlayerId) {
  return table(
    count,
    [
      { key: "elder", def: printing(SWINISH_ELDER), owner: P1, zone: "play" },
      ...resources("greed", 2),
      ...perSeat(count, "mk", "play", maker),
      ...perSeat(count, "res", "hand", (seat) => resourceCard({ name: `Coin ${seat}` }))
    ],
    { active }
  );
}

for (const count of COUNTS) {
  clause(SWINISH_ELDER, "0:rule", `${count} seats: when any opponent plays a resource I may pay 1 to attach it to that opponent's faction, with no opponent choice`, () => {
    for (const player of others(count, P1)) {
      for (const pay of [true, false]) {
        const t = elderBoard(count, player);
        activateAs(t, `mk-${player}`, "mk", {}, player);
        assert.equal(pending(t)?.kind, "chooserSelectsTarget");
        assert.equal(pending(t)?.playerId, player, "the player picks the resource to play");
        answerTargets(t, player, [t.id(`res-${player}`)]);
        settle(t);
        assert.equal(pending(t)?.kind, "mayPay", "no choosePlayer step: the opponent is the one who played the resource");
        assert.equal(pending(t)?.playerId, P1);
        t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay } });
        settle(t);
        const attached = t.engine.state.cards[t.id(`res-${player}`)]!.attachedTo;
        if (pay) assert.equal(attached, t.engine.state.players[player]!.factionId, "attached to the faction of the opponent who played it");
        else assert.equal(attached, undefined, "paying is optional: declining attaches nothing");
        for (const other of others(count, player)) assert.equal(t.engine.state.cards[t.id(`res-${other}`)]!.zone, "hand", `${other} played nothing`);
      }
    }
  });
}

clause(SWINISH_ELDER, "0:rule", "3 seats: my own resource play does not set it off", () => {
  const t = elderBoard(3, P1);
  activateAs(t, "mk-p1", "mk", {}, P1);
  answerTargets(t, P1, [t.id("res-p1")]);
  settle(t);
  assert.equal(pending(t), undefined);
  assert.equal(t.engine.state.cards[t.id("res-p1")]!.attachedTo, undefined);
});
