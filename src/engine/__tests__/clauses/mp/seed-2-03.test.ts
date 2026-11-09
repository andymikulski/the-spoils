// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 03: Meat of the Mountain ("that player" and "that player's
// opponent" written from the point of view of whichever player drew). Expectations come from the printed text.

import assert from "node:assert/strict";
import { mpClause, printing, refused } from "../_clause.js";
import {
  activateAs, answerPlayer, answerTargets, character, choosePlayer, deckOf, handSize, hands, idsOf, item, location, others, P1, pending, perSeat, pickable, resourceCard, resources,
  seatsFor, settle, table, tokensOn, zoneOf
} from "./_seed-2.js";
import type { PlayerId } from "../../../../engine.js";

const MEAT = "60eab41e-55d8-428c-991a-de347296fa4f";

/** A free "draw a card" ability on an item each player controls (the draw that sets Meat of the Mountain off). */
const drawItem = (seat: PlayerId) =>
  item({ name: `Study ${seat}`, behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** Meat in P1's play with `tokens` tokens; `drawer` is the active player. Every seat has a drawing item, a deck, three characters and a resource in hand, a character and a location in play. */
function meatBoard(count: number, drawer: PlayerId, tokens: number) {
  return table(
    count,
    [
      { key: "meat", def: printing(MEAT), owner: P1, zone: "play", counters: { token: tokens } },
      ...perSeat(count, "dr", "play", drawItem),
      ...perSeat(count, "c", "play", (seat) => character({ name: `Char ${seat}` })),
      ...perSeat(count, "loc", "play", (seat) => location({ name: `Place ${seat}` })),
      ...perSeat(count, "res", "hand", (seat) => resourceCard({ name: `Coin ${seat}` })),
      ...hands(count, 3, "h"),
      ...seatsFor(count).flatMap((seat) => deckOf(`k-${seat}-`, 5, seat)),
      ...resources("obsession", 1, drawer)
    ],
    { active: drawer }
  );
}
type Board = ReturnType<typeof meatBoard>;

const draw = (t: Board, who: PlayerId) => activateAs(t, `dr-${who}`, "draw1", {}, who);
const option = (t: Board, who: PlayerId, index: number) => {
  assert.equal(pending(t)?.kind, "chooserSelectsOption");
  assert.equal(pending(t)?.playerId, who, "only the player who drew chooses");
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsOption", index } });
  settle(t);
};
/** The draw, then the drawer's choice of one of their own opponents (offered because the block names "that player's opponent"). */
function drawThenChoose(t: Board, count: number, who: PlayerId, opponent: PlayerId): void {
  draw(t, who);
  choosePlayer(t, who, others(count, who), opponent);
}

for (const count of [3, 4] as const) {
  mpClause(MEAT, "0:rule", count, `${count} seats: a draw by any player (you or an opponent) sets it off once, and only the player who drew chooses whether to add or remove a token`, () => {
    for (const drawer of seatsFor(count)) {
      const t = meatBoard(count, drawer, 0);
      const handBefore = Object.fromEntries(seatsFor(count).map((seat) => [seat, handSize(t, seat)]));
      drawThenChoose(t, count, drawer, others(count, drawer)[0]!);
      assert.equal(pending(t)?.kind, "chooserSelectsOption");
      assert.equal(pending(t)?.playerId, drawer);
      for (const other of others(count, drawer)) {
        assert.equal(t.engine.checkAction({ type: "resolvePendingChoice", playerId: other, choice: { kind: "chooserSelectsOption", index: 0 } }).ok, false, `${other} cannot choose for ${drawer}`);
      }
      refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: drawer, choice: { kind: "chooserSelectsOption", index: 2 } }), "removing a token from a card with none", /./);
      option(t, drawer, 0);
      assert.equal(pending(t), undefined, "one draw sets it off once");
      assert.equal(tokensOn(t, "meat"), 0);
      assert.equal(handSize(t, drawer), handBefore[drawer]! + 1);
      for (const other of others(count, drawer)) assert.equal(handSize(t, other), handBefore[other]!);
    }
  });

  mpClause(MEAT, "1:rule", count, `${count} seats: 0 TOKENS: "that player's opponent discards a card": one of the drawer's own opponents (which can be you), selected by the drawer, and nobody else discards`, () => {
    for (const drawer of seatsFor(count)) {
      for (const chosen of others(count, drawer)) {
        const t = meatBoard(count, drawer, 1);
        drawThenChoose(t, count, drawer, chosen);
        option(t, drawer, 2); // remove the token: 0 tokens
        assert.equal(tokensOn(t, "meat"), 0);
        assert.equal(pending(t)?.kind, "chooserSelectsTarget");
        assert.equal(pending(t)?.playerId, chosen, "the drawer's chosen opponent discards, not the card's controller (unless they were chosen)");
        const hand = seatsFor(count).flatMap((seat) => [...Array(3).keys()].map((i) => `h${i}-${seat}`).concat([`res-${seat}`]).filter((key) => seat === chosen));
        assert.deepEqual(pickable(t), idsOf(t, hand), "only the chosen opponent's hand is offered");
        answerTargets(t, chosen, [t.id(`h0-${chosen}`)]);
        settle(t);
        assert.equal(zoneOf(t, `h0-${chosen}`), "discard");
        assert.equal(handSize(t, chosen), 3, "4 cards minus the discard");
        for (const other of others(count, chosen, drawer)) assert.equal(handSize(t, other), 4, `${other} discards nothing`);
        assert.equal(handSize(t, drawer), 5, "the drawer only drew");
        assert.equal(pending(t), undefined);
      }
    }
  });

  mpClause(MEAT, "2:rule", count, `${count} seats: 1 TOKEN: the player who drew looks at the top 2 cards of their own deck, 1 into their hand, 1 on the bottom`, () => {
    for (const drawer of seatsFor(count)) {
      const t = meatBoard(count, drawer, 0);
      drawThenChoose(t, count, drawer, others(count, drawer)[0]!);
      option(t, drawer, 1); // add a token: 1 token
      assert.equal(pending(t)?.kind, "mayPay");
      assert.equal(pending(t)?.playerId, drawer);
      t.engine.perform({ type: "resolvePendingChoice", playerId: drawer, choice: { kind: "mayPay", pay: true } });
      settle(t);
      const look = pending(t)!;
      assert.equal(look.kind, "reorderDeck");
      assert.equal(look.playerId, drawer);
      const [first, second] = look.cardIds as string[];
      assert.deepEqual([first, second], t.engine.state.players[drawer]!.deck.slice(0, 2), "the top 2 cards of the drawer's own deck");
      const others4 = Object.fromEntries(others(count, drawer).map((seat) => [seat, [...t.engine.state.players[seat]!.deck]]));
      t.engine.perform({ type: "resolvePendingChoice", playerId: drawer, choice: { kind: "reorderDeck", order: [first!, second!] } });
      settle(t);
      assert.ok(t.engine.state.players[drawer]!.hand.includes(first!), "one into the hand");
      const deck = t.engine.state.players[drawer]!.deck;
      assert.equal(deck[deck.length - 1], second, "one on the bottom");
      for (const [seat, deck] of Object.entries(others4)) assert.deepEqual(t.engine.state.players[seat]!.deck, deck, `${seat}'s deck is untouched`);
    }
  });

  mpClause(MEAT, "3:rule", count, `${count} seats: 2 TOKENS: the player who drew may pick any character or location and put it into its owner's hand`, () => {
    for (const drawer of seatsFor(count)) {
      const t = meatBoard(count, drawer, 1);
      drawThenChoose(t, count, drawer, others(count, drawer)[0]!);
      option(t, drawer, 1); // add a token: 2 tokens
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.equal(pending(t)?.playerId, drawer);
      assert.deepEqual(pickable(t), idsOf(t, seatsFor(count).flatMap((seat) => [`c-${seat}`, `loc-${seat}`])), "any character or location, of any player");
      const target = others(count, drawer)[1] ?? others(count, drawer)[0]!;
      const before = handSize(t, target);
      answerTargets(t, drawer, [t.id(`c-${target}`)]);
      settle(t);
      assert.equal(zoneOf(t, `c-${target}`), "hand", "back to its owner's hand");
      assert.equal(handSize(t, target), before + 1);
      assert.equal(pending(t), undefined);
    }
  });

  mpClause(MEAT, "4:rule", count, `${count} seats: AT LEAST 3 TOKENS: the player who drew may play a resource from their own hand`, () => {
    for (const drawer of seatsFor(count)) {
      const t = meatBoard(count, drawer, 2);
      drawThenChoose(t, count, drawer, others(count, drawer)[0]!);
      option(t, drawer, 1); // add a token: 3 tokens
      assert.equal(pending(t)?.kind, "chooserSelectsTarget");
      assert.equal(pending(t)?.playerId, drawer);
      const offered = pickable(t);
      assert.ok(offered.includes(t.id(`res-${drawer}`)), "the drawer's resource is offered");
      for (const id of offered) assert.equal(t.engine.state.cards[id]!.ownerId, drawer, "only cards of the drawer's own hand");
      answerTargets(t, drawer, [t.id(`res-${drawer}`)]);
      settle(t);
      assert.equal(zoneOf(t, `res-${drawer}`), "play");
      assert.equal(t.engine.state.cards[t.id(`res-${drawer}`)]!.controllerId, drawer);
      for (const other of others(count, drawer)) assert.equal(zoneOf(t, `res-${other}`), "hand", `${other} plays nothing`);
    }
  });
}

mpClause(MEAT, "0:rule", 3, "3 seats: with one opponent left the drawer is not asked for an opponent", () => {
  const t = meatBoard(3, P1, 1);
  t.engine.state.players["p3"]!.eliminated = { turn: 1 };
  draw(t, P1);
  assert.equal(pending(t)?.kind, "chooserSelectsOption", "no choosePlayer prompt with one opponent left");
  assert.equal(pending(t)?.playerId, P1);
});
