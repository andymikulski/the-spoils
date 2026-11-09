// Multiplayer clause tests that close the player-word mutation gaps (`npm run card-tests -- mp-mutate`) of: Dragon Tank,
// Rosy Palmer and Her Five Friends, Degenerate Molestation, Discommodiousness, Eccentric Inquisition, Lucky Bastard.
// Expectations come from each card's PRINTED text.

import assert from "node:assert/strict";
import { mpClause, printing } from "../_clause.js";
import { bank, character, item, tactic } from "../../per-card/_harness.js";
import { choosePlayer, others, P1, pending, seatsFor, setDeck, settle, table, zoneOf } from "./_seed-2.js";
import * as seats from "./_seats2ndEdition.js";
import * as base from "./_seatsSeed2ndFirstP2.js";
import * as sup from "./_support1stEditionPart2.js";
import type { Count } from "./_seatsSeed2ndFirstP2.js";

const COUNTS = [3, 4] as const;

// =================================================================================
// Rosy Palmer, and Her Five Friends
// When this card is destroyed, reveal the top 5 cards of an opponent's deck. You may choose a revealed character. If you
// do, put it into play under your control. That player puts the remaining cards on the bottom of their deck in any order.
// =================================================================================

const ROSY = "4d801a32-d054-413d-9eaf-d915a82139b1";

const smite = () =>
  tactic({ name: "Smite", behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

const DECK_KEYS = ["a", "b", "c", "d", "e", "f", "g"];

for (const count of COUNTS) {
  mpClause(ROSY, "1:rule", count, `${count} seats: no character among the top 5 of the chosen opponent's deck: that opponent (not P1, not another opponent) puts all five on the bottom of their deck`, () => {
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "rosy", def: printing(ROSY), owner: P1, zone: "play" },
        { key: "smite", def: smite(), owner: P1, zone: "hand" },
        // Every other deck (P1's own included) shows characters in its top 5; only the chosen opponent's top 5 holds none.
        ...seatsFor(count).flatMap((seat) =>
          DECK_KEYS.map((key, index) => ({
            key: `${key}-${seat}`,
            def: seat === chosen && index < 5 ? item({ name: `Junk ${key} ${seat}` }) : character({ name: `Recruit ${key} ${seat}` }),
            owner: seat,
            zone: "deck" as const
          }))
        )
      ]);
      for (const seat of t.seats) setDeck(t, seat, DECK_KEYS.map((key) => `${key}-${seat}`));
      const decks = Object.fromEntries(t.seats.map((seat) => [seat, [...t.engine.state.players[seat]!.deck]]));
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("smite"), selected: { t: [t.id("rosy")] } } as never);
      settle(t);
      assert.equal(zoneOf(t, "rosy"), "discard", "Rosy Palmer was destroyed");
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      assert.equal(pending(t)?.kind, "reorderDeck", "no revealed character to choose: straight to putting the five on the bottom");
      assert.equal(pending(t)?.playerId, chosen, "the chosen opponent (the one whose cards were revealed) puts them on the bottom");
      const rest = pending(t)!.cardIds as string[];
      assert.deepEqual([...rest].sort(), decks[chosen]!.slice(0, 5).sort(), "exactly the top 5 of the chosen opponent's deck");
      const order = [...rest].reverse();
      t.engine.perform({ type: "resolvePendingChoice", playerId: chosen, choice: { kind: "reorderDeck", order } } as never);
      settle(t);
      assert.deepEqual(t.engine.state.players[chosen]!.deck, [...decks[chosen]!.slice(5), ...order], "the five went to the bottom of the chosen opponent's deck in the chosen order");
      for (const seat of t.seats.filter((s) => s !== chosen)) assert.deepEqual(t.engine.state.players[seat]!.deck, decks[seat], `${seat}'s deck is untouched`);
      assert.equal(pending(t), undefined, "nothing is left open");
    }
  });
}

// =================================================================================
// Degenerate Molestation
// Pick an opponent. That player discards a card. You may deploy a non-resource card with numeric cost X or less for free,
// where X is the numeric cost of the discarded card. Repeat this card's effect until that player has no cards in their hand.
// =================================================================================

const MOLEST_2ND = "12cfc4e1-e8f7-431e-a37a-593210181b0c";
const MOLEST_1ST = "d0f8ae01-7941-4b39-9292-1ad30f8eec9d";
const MOLEST_BETA = "f77f9b48-ebfb-4f8f-a32d-46a0309da781";

/** P1 holds the card and two cards of its own; every opponent holds cards (a different number each), so only the chosen one's hand may end the repetition. */
const molestTable = (printingId: string, count: Count): base.Table =>
  base.table(count, [
    { key: "card", def: printing(printingId), owner: P1, zone: "hand" },
    ...bank("obsession", 10, P1),
    { key: "own-0", def: character({ name: "Own Zero", cost: 9 }), owner: P1, zone: "hand" },
    { key: "own-1", def: character({ name: "Own One", cost: 9 }), owner: P1, zone: "hand" },
    ...base.seatsOf(count).slice(1).flatMap((seat, i) => seats.plain(`hand-${seat}-`, i + 2, seat, "hand"))
  ]);

const molestRepeats = (printingId: string, count: Count): void => {
  for (const chosen of seats.others(count)) {
    const t = molestTable(printingId, count);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, base.handOf(t, seat).length]));
    base.playRaw(t, P1, "card", { players: { opponent: chosen } });
    const discards: string[] = [];
    seats.drive(t, (pc) => {
      if (pc.declaration?.id === "d") {
        discards.push(pc.playerId);
        return { kind: "chooserSelectsTarget", selected: [seats.pickable(t)[0]!] };
      }
      return undefined;
    });
    assert.deepEqual(discards, Array(before[chosen]!).fill(chosen), "the chosen opponent discards once per card in their hand, then the repetition stops");
    assert.equal(t.engine.state.winner, undefined, "the repetition ended when the chosen opponent's hand was empty (it did not go on because of other hands: no endless loop)");
    assert.equal(base.handOf(t, chosen).length, 0, "the chosen opponent's hand is empty");
    for (const seat of seats.others(count, chosen)) assert.equal(base.handOf(t, seat).length, before[seat], `${seat}'s hand is untouched and not counted`);
    assert.deepEqual([base.zoneOf(t, "own-0"), base.zoneOf(t, "own-1")], ["hand", "hand"], "P1's own hand is untouched (the cost-9 cards are too dear for the free play)");
    assert.equal(base.open(t), undefined, "nothing is left open");
  }
};

for (const count of COUNTS) {
  const title = `${count} seats: the repetition ends when the chosen opponent's hand is empty, whatever the other hands (P1's and the other opponents') hold`;
  mpClause(MOLEST_2ND, "1:rule", count, title, () => molestRepeats(MOLEST_2ND, count));
  mpClause(MOLEST_1ST, "2:rule", count, title, () => molestRepeats(MOLEST_1ST, count));
  mpClause(MOLEST_BETA, "2:rule", count, title, () => molestRepeats(MOLEST_BETA, count));
}

// =================================================================================
// Discommodiousness
// An opponent reveals their hand. Shuffle all tactics revealed this way into their deck. That player draws X cards, where X
// is the number of tactics shuffled into their deck. Draw a card.
// =================================================================================

const DISCOMMODIOUS_2ND = "02d85379-a5cb-40ae-bbd4-dd6337f680a1";
const DISCOMMODIOUS_1ST = "42334135-ad09-4e14-b243-597d4a44384e";

/** P1 holds the card and ONE tactic; every opponent holds THREE tactics and a character, and has a long deck of distinct cards (so a shuffle would show). */
const discommodeTable = (printingId: string, count: Count): sup.Table =>
  sup.table(count, [
    { key: "disc", def: printing(printingId), owner: P1, zone: "hand" },
    { key: "mine-tac", def: sup.tactic({ name: "Mine", cost: 0 }), owner: P1, zone: "hand" },
    ...sup.fillers("mine-", 8, P1, "deck"),
    ...sup.seatsOf(count).slice(1).flatMap((seat): sup.CardPlacement[] => [
      ...[0, 1, 2].map((i) => ({ key: `tac-${seat}-${i}`, def: sup.tactic({ name: `Tactic ${seat} ${i}`, cost: 0 }), owner: seat, zone: "hand" as const })),
      { key: `char-${seat}`, def: sup.character({ name: `Char ${seat}` }), owner: seat, zone: "hand" },
      ...sup.fillers(`deck-${seat}-`, 10, seat, "deck")
    ]),
    ...sup.fund(P1)
  ]);

const discommodeOnlyChosen = (printingId: string, count: Count): void => {
  for (const chosen of sup.seatsOf(count).slice(1)) {
    const t = discommodeTable(printingId, count);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, { hand: [...sup.handOf(t, seat)], deck: [...sup.deckOf(t, seat)] }]));
    sup.playCard(t, P1, "disc", { players: { opponent: chosen } });
    assert.equal(sup.handOf(t, chosen).length, 4, "the chosen opponent shuffled their 3 tactics away and drew X = 3 (their own tactics, not P1's single one): character + 3 drawn");
    assert.ok(sup.handOf(t, chosen).includes(t.id(`char-${chosen}`)), "the character stayed in hand");
    assert.equal(sup.deckOf(t, chosen).length, before[chosen]!.deck.length, "3 tactics shuffled in, 3 drawn");
    assert.equal(sup.handOf(t, P1).length, before[P1]!.hand.length - 1 + 1, "P1 played the card and drew exactly one");
    assert.ok(sup.handOf(t, P1).includes(t.id("mine-tac")), "P1's own tactic stays in hand");
    for (const seat of sup.seatsOf(count).slice(1).filter((s) => s !== chosen)) {
      assert.deepEqual(sup.handOf(t, seat), before[seat]!.hand, `${seat}'s hand is untouched`);
      assert.deepEqual(sup.deckOf(t, seat), before[seat]!.deck, `${seat}'s deck is untouched and not shuffled`);
    }
  }
};

for (const count of COUNTS) {
  const title = `${count} seats: X counts the chosen opponent's tactics (not P1's) and only the chosen opponent's deck is shuffled`;
  mpClause(DISCOMMODIOUS_2ND, "0:rule", count, title, () => discommodeOnlyChosen(DISCOMMODIOUS_2ND, count));
  mpClause(DISCOMMODIOUS_1ST, "0:rule", count, title, () => discommodeOnlyChosen(DISCOMMODIOUS_1ST, count));
}

// =================================================================================
// Eccentric Inquisition
// Reveal the top 7 cards of an opponent's deck. Put all tactics revealed this way into the void. Put the remaining cards
// on the bottom of that player's deck in any order. ...
// =================================================================================

const INQUISITION = "847cd807-e515-4c1f-8c4d-fa0ffd7b217d";

/** The chosen opponent's top 7 hold two tactics (positions 1 and 4); P1's own deck and the other opponents' decks hold none or four, so only the chosen deck's tactic count gives 5 remaining cards. */
const inquisitionTable = (count: Count, chosen: string): sup.Table =>
  sup.table(count, [
    { key: "inq", def: printing(INQUISITION), owner: P1, zone: "hand" },
    ...sup.fund(P1),
    ...sup.seatsOf(count).flatMap((seat) =>
      sup.stack(`d-${seat}-`, 9, seat, "deck", (i) => {
        const tactics = seat === chosen ? [1, 4] : seat === P1 ? [] : [0, 1, 2, 3];
        return tactics.includes(i) ? sup.drawTactic(`Tactic ${seat} ${i}`, "rr") : sup.character({ name: `Card ${seat} ${i}` });
      })
    )
  ]);

const inquisitionCounts = (count: Count): void => {
  for (const chosen of sup.seatsOf(count).slice(1)) {
    const t = inquisitionTable(count, chosen);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, [...sup.deckOf(t, seat)]]));
    sup.playCard(t, P1, "inq", { players: { opponent: chosen } });
    const pc = sup.pending(t.engine) as unknown as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[] } | undefined;
    assert.equal(pc?.kind, "reorderDeck", "P1 orders what is left of the revealed cards");
    assert.equal(pc?.deckOwnerId, chosen, "it is the chosen opponent's deck");
    const rest = [0, 2, 3, 5, 6].map((i) => t.id(`d-${chosen}-${i}`));
    assert.deepEqual([...pc!.cardIds].sort(), [...rest].sort(), "exactly the 5 revealed non-tactics of the chosen opponent's top 7 (the 2 tactics went to the void), counted from that deck alone");
    sup.answerPending(t.engine, "reorderDeck", { order: rest });
    for (const i of [1, 4]) assert.equal(sup.zoneOf(t, `d-${chosen}-${i}`), "removed", "the chosen opponent's revealed tactics left the deck");
    assert.deepEqual(sup.deckOf(t, chosen), [t.id(`d-${chosen}-7`), t.id(`d-${chosen}-8`), ...rest], "the 5 non-tactics are on the bottom of the chosen opponent's deck");
    for (const seat of t.seats.filter((s) => s !== chosen)) assert.deepEqual(sup.deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
  }
};

for (const count of COUNTS) {
  mpClause(INQUISITION, "0:rule", count, `${count} seats: the number of tactics taken out is counted in the chosen opponent's top 7 only, whatever P1's and the other decks hold`, () => inquisitionCounts(count));
}
