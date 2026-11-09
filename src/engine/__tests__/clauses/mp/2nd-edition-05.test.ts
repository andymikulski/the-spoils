// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 6: tactics and abilities that say "your
// opponent" and look at, take from or hit that opponent's hand, deck or discard pile (The Deranger, Quotidian Virtuoso,
// Ritual of the Ominous Urn, Ritual of the Shattering Teeth, Stolen Inspiration, Discommodiousness, Orgy Den Smoke Out,
// Epiphany Ball, Jackmove, Grand Theft All). The opponent is chosen with the play or activation, before any target.
// Expectations come from each card's PRINTED text, the multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, item, resourceCard, tactic } from "../../per-card/_harness.js";
import { mpClause, printing } from "../_clause.js";
import { COUNTS, drive, eliminateAllBut, ids, opponentChoice, others, pickable, plain, refused } from "./_seats2ndEdition.js";
import { deckOf, handOf, P1, P2, playCard, playersNeeded, playRaw, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const discardOf = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.discard;
const playAction = (t: Table, key: string, extra: Record<string, unknown> = {}) => ({ type: "playCard", playerId: P1, cardId: t.id(key), ...extra }) as never;
const abilityAction = (t: Table, key: string, abilityId: string, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: P1, cardId: t.id(key), abilityId, ...extra }) as never;
const handKeys = (seat: PlayerId, n = 3): string[] => Array.from({ length: n }, (_, i) => `hand-${seat}-${i}`);
const hands = (count: Count, n = 3): CardPlacement[] => seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, n, seat, "hand"));
const revealedBy = (t: Table, owner: PlayerId): number =>
  t.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed" && (entry.event as { ownerId?: string }).ownerId === owner).length;

// =================================================================================
// The Deranger
// LOBOTOMIZE -- COST: Deplete this card. -- EFFECT: Look at your opponent's hand and choose 2 or fewer non-resource cards
// in it. Your opponent discards those cards. Your opponent takes control of this card.
// =================================================================================

const DERANGER = "98836f41-4b3b-400b-b63b-45878afff2fb";

const derangerTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(DERANGER), owner: P1, zone: "play" },
    ...hands(count),
    ...seatsOf(count).slice(1).map((seat) => ({ key: `staple-${seat}`, def: resourceCard({ name: `Staple ${seat}` }), owner: seat, zone: "hand" as const }))
  ]);

for (const count of COUNTS) {
  mpClause(DERANGER, "0:ability:lobotomize", count, `${count} seats: P1 chooses up to 2 non-resource cards of the chosen opponent's hand only; that opponent (not another) takes control of the card`, () => {
    for (const opponent of others(count)) {
      const t = derangerTable(count);
      assert.deepEqual(playersNeeded(t, abilityAction(t, "card", "lobotomize")), opponentChoice(count));
      t.engine.perform(abilityAction(t, "card", "lobotomize", { players: { opponent } }));
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "h") {
          assert.deepEqual(pickable(t), ids(t, ...handKeys(opponent)).sort(), "only the chosen opponent's non-resource cards (the resource card is not offered)");
          refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids(t, `staple-${opponent}`) } } as never), "a resource card");
          return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-0`, `hand-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "h"]]);
      assert.equal(zoneOf(t, `hand-${opponent}-0`), "discard");
      assert.equal(zoneOf(t, `hand-${opponent}-1`), "discard");
      assert.equal(zoneOf(t, `hand-${opponent}-2`), "hand");
      assert.equal(t.engine.state.cards[t.id("card")]!.controllerId, opponent, "the chosen opponent takes control of The Deranger");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 4, `${seat}'s hand is untouched`);
      // The new controller is offered the choice among ITS opponents.
      t.engine.state.cards[t.id("card")]!.depleted = false;
      assert.deepEqual(
        playersNeeded(t, { type: "activateAbility", playerId: opponent, cardId: t.id("card"), abilityId: "lobotomize" } as never)?.[0]?.candidates.slice().sort(),
        seatsOf(count).filter((seat) => seat !== opponent).sort(),
        "the new controller chooses among its own opponents (P1 included)"
      );
    }
    const t = derangerTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, abilityAction(t, "card", "lobotomize")), undefined);
    t.engine.perform(abilityAction(t, "card", "lobotomize"));
    drive(t);
    assert.equal(t.engine.state.cards[t.id("card")]!.controllerId, P2, "P2 is bound automatically and takes control");
  });
}

// =================================================================================
// Quotidian Virtuoso
// DISRUPT -- COST: Pay 2. Discard a card. Deplete this card. -- EFFECT: Look at your opponent's hand and choose a card in
// it. Your opponent discards that card.
// =================================================================================

const VIRTUOSO = "01a6dcbe-e7ad-41a9-87f7-8e22f1cc11ef";

const virtuosoTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(VIRTUOSO), owner: P1, zone: "play" },
    ...plain("mine", 2, P1, "hand"),
    ...hands(count),
    ...bank("obsession", 2, P1)
  ]);

for (const count of COUNTS) {
  mpClause(VIRTUOSO, "0:ability:disrupt", count, `${count} seats: P1 looks at and chooses a card of the chosen opponent's hand only, and that opponent discards it`, () => {
    for (const opponent of others(count)) {
      const t = virtuosoTable(count);
      assert.deepEqual(playersNeeded(t, abilityAction(t, "card", "disrupt")), opponentChoice(count));
      t.engine.perform(abilityAction(t, "card", "disrupt", { players: { opponent }, selected: { d: ids(t, "mine0") } }));
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "h") {
          assert.deepEqual(pickable(t), ids(t, ...handKeys(opponent)).sort(), "only the chosen opponent's hand is offered");
          return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "h"]]);
      assert.equal(zoneOf(t, "mine0"), "discard", "P1 discarded a card as a cost");
      assert.equal(zoneOf(t, `hand-${opponent}-1`), "discard");
      assert.equal(t.engine.state.cards[t.id("card")]!.depleted, true);
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
    }
    const t = virtuosoTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, abilityAction(t, "card", "disrupt")), undefined);
    t.engine.perform(abilityAction(t, "card", "disrupt", { selected: { d: ids(t, "mine0") } }));
    drive(t, (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0") } : undefined));
    assert.equal(zoneOf(t, "hand-p2-0"), "discard", "P2 is bound automatically");
  });
}

// =================================================================================
// Ritual of the Ominous Urn
// Your opponent discards a card. You may search your deck for a card of the same type as the discarded card and reveal
// it. If you do, put it into your hand.
// =================================================================================

const URN = "0d9750c3-d284-4097-88bd-8c20bb922900";

const urnTable = (count: Count, emptyHandOf?: PlayerId): Table =>
  table(count, [
    { key: "card", def: printing(URN), owner: P1, zone: "hand" },
    ...bank("obsession", 4, P1),
    { key: "deck-char", def: character({ name: "Deck character" }), owner: P1, zone: "deck" },
    { key: "deck-item", def: item({ name: "Deck item" }), owner: P1, zone: "deck" },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] =>
      seat === emptyHandOf ? [] : [{ key: `hand-${seat}-char`, def: character({ name: `Char ${seat}` }), owner: seat, zone: "hand" }, { key: `hand-${seat}-item`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "hand" }]
    )
  ]);

for (const count of COUNTS) {
  mpClause(URN, "0:rule", count, `${count} seats: only the chosen opponent discards (their choice), then P1 may search P1's own deck for a card of the same type`, () => {
    for (const opponent of others(count)) {
      const t = urnTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      playRaw(t, P1, "card", { players: { opponent } });
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "disc") return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-item`) };
        if (pc.declaration?.id === "found") {
          assert.deepEqual(pickable(t), ids(t, "deck-item"), "a card of the same type as the discarded card, from P1's own deck");
          return { kind: "chooserSelectsTarget", selected: ids(t, "deck-item") };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[opponent, "disc"], [P1, "found"]], "the chosen opponent discards, then P1 searches");
      assert.equal(zoneOf(t, `hand-${opponent}-item`), "discard");
      assert.equal(zoneOf(t, "deck-item"), "hand");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 2, `${seat}'s hand is untouched`);
    }
    // An empty chosen hand: nothing is discarded and nothing is searched.
    {
      const t = urnTable(count, P2);
      playRaw(t, P1, "card", { players: { opponent: P2 } });
      assert.deepEqual(drive(t), []);
      assert.equal(zoneOf(t, "deck-char"), "deck");
      assert.equal(zoneOf(t, "deck-item"), "deck");
    }
    const t = urnTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card");
    assert.equal(drive(t, (pc) => (pc.declaration?.id === "disc" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-char") } : undefined))[0]!.who, P2, "P2 is bound automatically and discards");
  });
}

// =================================================================================
// Ritual of the Shattering Teeth
// Choose a number for X. Pay X+X. -- Look at your opponent's hand and choose X or fewer cards in it. Your opponent
// discards those cards.
// =================================================================================

const TEETH = "a4e9bfdd-dc54-40ec-ac20-374ca334f6e6";

const teethTable = (count: Count): Table => table(count, [{ key: "card", def: printing(TEETH), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1), ...hands(count, 4)]);

for (const count of COUNTS) {
  mpClause(TEETH, "0:ability", count, `${count} seats: with X = 2 P1 pays 4 and chooses 2 or fewer cards of the chosen opponent's hand only; that opponent discards exactly those`, () => {
    for (const opponent of others(count)) {
      for (const take of [2, 1]) {
        const t = teethTable(count);
        assert.deepEqual(playersNeeded(t, playAction(t, "card", { variables: { x: 2 } })), opponentChoice(count));
        playRaw(t, P1, "card", { players: { opponent }, variables: { x: 2 } });
        const asked = drive(t, (pc) => {
          if (pc.declaration?.id === "h") {
            assert.deepEqual(pickable(t), ids(t, ...handKeys(opponent, 4)).sort(), "only the chosen opponent's hand is offered");
            return { kind: "chooserSelectsTarget", selected: ids(t, ...handKeys(opponent, 4).slice(0, take)) };
          }
          return undefined;
        });
        assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "h"]]);
        assert.equal(handOf(t, opponent).length, 4 - take, `the opponent discards exactly the ${take} chosen card(s)`);
        assert.equal(t.engine.getAvailableResourceCount(P1), 0, "X+X = 4 resources were paid");
        for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 4, `${seat}'s hand is untouched`);
      }
    }
    const t = teethTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card", { variables: { x: 2 } })), undefined);
    playRaw(t, P1, "card", { variables: { x: 2 } });
    drive(t, (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0", "hand-p2-1") } : undefined));
    assert.equal(handOf(t, P2).length, 2, "P2 is bound automatically");
  });
}

// =================================================================================
// Stolen Inspiration
// Look at your opponent's hand and choose a non-resource card in it. Your opponent discards that card. You may play a
// non-resource card with numeric cost X or less for free, where X is half the numeric cost of the discarded card, rounded up.
// =================================================================================

const INSPIRATION = "7a32d945-fe61-448f-9cc7-d6aac8312c57";

const inspirationTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(INSPIRATION), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "cheap", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "hand" },
    { key: "pricey", def: character({ name: "Pricey", cost: 4 }), owner: P1, zone: "hand" },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `big-${seat}`, def: character({ name: `Big ${seat}`, cost: 5 }), owner: seat, zone: "hand" },
      { key: `small-${seat}`, def: character({ name: `Small ${seat}`, cost: 1 }), owner: seat, zone: "hand" },
      { key: `staple-${seat}`, def: resourceCard({ name: `Staple ${seat}` }), owner: seat, zone: "hand" }
    ])
  ]);

for (const count of COUNTS) {
  mpClause(INSPIRATION, "0:rule", count, `${count} seats: P1 chooses a non-resource card of the chosen opponent's hand only; then P1 may play a card of cost X or less (half the discarded cost, rounded up) for free`, () => {
    for (const opponent of others(count)) {
      const t = inspirationTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      playRaw(t, P1, "card", { players: { opponent } });
      let offered: string[] = [];
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "discarded") {
          assert.deepEqual(pickable(t), ids(t, `big-${opponent}`, `small-${opponent}`).sort(), "only non-resource cards of the chosen opponent's hand");
          return { kind: "chooserSelectsTarget", selected: ids(t, `big-${opponent}`) };
        }
        if (pc.kind === "deployForFree") {
          offered = [...(pc.candidates as string[])].sort();
          return { kind: "deployForFree", cardId: t.id("cheap") };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => a.who), [P1, P1]);
      assert.deepEqual(offered, ids(t, "cheap"), "a cost-5 discard allows cost 3 or less (half, rounded up): the cost-4 card is not offered");
      assert.equal(zoneOf(t, `big-${opponent}`), "discard");
      assert.equal(zoneOf(t, "cheap"), "play");
      assert.equal(zoneOf(t, "pricey"), "hand");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
    }
    const t = inspirationTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card");
    drive(t, (pc) => (pc.declaration?.id === "discarded" ? { kind: "chooserSelectsTarget", selected: ids(t, "big-p2") } : undefined));
    assert.equal(zoneOf(t, "big-p2"), "discard", "P2 is bound automatically");
  });
}

// =================================================================================
// Discommodiousness
// Your opponent reveals their hand. Shuffle all tactics revealed this way into their deck. Your opponent draws X cards,
// where X is the number of tactics shuffled into their deck. Draw a card.
// =================================================================================

const DISCOMMODIOUSNESS = "02d85379-a5cb-40ae-bbd4-dd6337f680a1";

const discommodeTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(DISCOMMODIOUSNESS), owner: P1, zone: "hand" },
    ...bank("elitism", 2, P1),
    ...plain("mine", 4, P1, "deck"),
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `tac-${seat}-0`, def: tactic({ name: `Tactic ${seat} 0` }), owner: seat, zone: "hand" },
      { key: `tac-${seat}-1`, def: tactic({ name: `Tactic ${seat} 1` }), owner: seat, zone: "hand" },
      { key: `other-${seat}`, def: character({ name: `Other ${seat}` }), owner: seat, zone: "hand" },
      ...plain(`deck-${seat}-`, 4, seat, "deck")
    ])
  ]);

for (const count of COUNTS) {
  mpClause(DISCOMMODIOUSNESS, "0:rule", count, `${count} seats: only the chosen opponent reveals their hand, shuffles its tactics into their deck and draws that many; P1 draws a card`, () => {
    for (const opponent of others(count)) {
      const t = discommodeTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      const deckBefore = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
      playCard(t, P1, "card", { players: { opponent } });
      assert.equal(revealedBy(t, opponent), 1, "the chosen opponent's hand was revealed to everyone");
      const reveal = t.engine.getLog().map((entry) => entry.event).find((event) => event?.type === "cardsRevealed") as { viewerId?: string } | undefined;
      assert.equal(reveal?.viewerId, "all");
      for (const seat of others(count, opponent)) assert.equal(revealedBy(t, seat), 0, `${seat}'s hand was not revealed`);
      assert.equal(handOf(t, opponent).length, 3, "1 other card + X = 2 cards drawn");
      assert.equal(deckBefore[opponent]! - deckOf(t, opponent).length, 0, "2 tactics shuffled in, 2 drawn");
      assert.equal(zoneOf(t, `other-${opponent}`), "hand");
      assert.equal(deckBefore.p1! - deckOf(t, P1).length, 1, "P1 drew a card");
      for (const seat of others(count, opponent)) {
        assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
        assert.equal(deckOf(t, seat).length, 4);
        assert.equal(zoneOf(t, `tac-${seat}-0`), "hand");
      }
    }
    const t = discommodeTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card");
    assert.equal(revealedBy(t, P2), 1, "P2 is bound automatically");
  });
}

// =================================================================================
// Orgy Den Smoke Out
// Your opponent discards a card at random. Put the top 2 cards of their deck into their discard pile.
// =================================================================================

const ORGY = "e6a43a11-e448-42fa-a45a-856116077af9";

const orgyTable = (count: Count, emptyHandOf?: PlayerId): Table =>
  table(count, [
    { key: "card", def: printing(ORGY), owner: P1, zone: "hand" },
    ...bank("deception", 2, P1),
    ...seatsOf(count).slice(1).flatMap((seat) => [...(seat === emptyHandOf ? [] : plain(`hand-${seat}-`, 3, seat, "hand")), ...plain(`deck-${seat}-`, 5, seat, "deck")])
  ]);

for (const count of COUNTS) {
  mpClause(ORGY, "0:rule", count, `${count} seats: the chosen opponent discards a card at random and the top 2 cards of their deck go to their discard pile; no other player is touched`, () => {
    for (const opponent of others(count)) {
      const t = orgyTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      const deck = [...deckOf(t, opponent)];
      playCard(t, P1, "card", { players: { opponent } });
      assert.equal(handOf(t, opponent).length, 2, "one card of the chosen opponent's hand was discarded at random");
      assert.ok(handKeys(opponent).filter((key) => zoneOf(t, key) === "discard").length === 1, "handKeys(opponent).filter((key) => zoneOf(t, key) === 'discard').length === 1");
      assert.deepEqual(deckOf(t, opponent), deck.slice(2), "the top 2 cards of their deck were milled");
      assert.ok(deck.slice(0, 2).every((id) => discardOf(t, opponent).includes(id)), "deck.slice(0, 2).every((id) => discardOf(t, opponent).includes(id))");
      for (const seat of others(count, opponent)) {
        assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
        assert.equal(deckOf(t, seat).length, 5, `${seat}'s deck is untouched`);
      }
    }
    // An empty chosen hand: nothing is discarded, the deck still mills.
    {
      const t = orgyTable(count, P2);
      playCard(t, P1, "card", { players: { opponent: P2 } });
      assert.equal(deckOf(t, P2).length, 3);
      assert.equal(discardOf(t, P2).length, 2);
    }
    const t = orgyTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card");
    assert.equal(deckOf(t, P2).length, 3, "P2 is bound automatically");
  });
}

// =================================================================================
// Epiphany Ball
// SUDDEN INSIGHT -- COST: Deplete this card. -- EFFECT: Search your deck for a card. Put it into your hand. Your opponent
// takes control of this card.
// =================================================================================

const BALL = "601204ef-80f0-4bc6-85f3-9282aa9a4c5a";

const ballTable = (count: Count): Table => table(count, [{ key: "card", def: printing(BALL), owner: P1, zone: "play" }, ...plain("deck", 4, P1, "deck")]);

for (const count of COUNTS) {
  mpClause(BALL, "0:ability:insight", count, `${count} seats: P1 searches P1's own deck; the chosen opponent (not another) takes control of the card`, () => {
    for (const opponent of others(count)) {
      const t = ballTable(count);
      assert.deepEqual(playersNeeded(t, abilityAction(t, "card", "insight")), opponentChoice(count));
      t.engine.perform(abilityAction(t, "card", "insight", { players: { opponent } }));
      const asked = drive(t, (pc) => (pc.declaration?.id === "c" ? { kind: "chooserSelectsTarget", selected: ids(t, "deck2") } : undefined));
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "c"]]);
      assert.equal(zoneOf(t, "deck2"), "hand", "P1 searched P1's own deck");
      assert.equal(t.engine.state.cards[t.id("card")]!.controllerId, opponent, "the chosen opponent takes control");
      // The new controller chooses among ITS opponents.
      t.engine.state.cards[t.id("card")]!.depleted = false;
      assert.deepEqual(
        playersNeeded(t, { type: "activateAbility", playerId: opponent, cardId: t.id("card"), abilityId: "insight" } as never)?.[0]?.candidates.slice().sort(),
        seatsOf(count).filter((seat) => seat !== opponent).sort()
      );
    }
    const t = ballTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, abilityAction(t, "card", "insight")), undefined);
    t.engine.perform(abilityAction(t, "card", "insight"));
    drive(t, (pc) => (pc.declaration?.id === "c" ? { kind: "chooserSelectsTarget", selected: ids(t, "deck0") } : undefined));
    assert.equal(t.engine.state.cards[t.id("card")]!.controllerId, P2, "P2 is bound automatically and takes control");
  });
}

// =================================================================================
// Jackmove
// Choose a number for X. Pay X+X. -- Reveal up to the top X cards of your opponent's deck. Put all revealed characters and
// items into play under your control. Put the remaining cards into your opponent's discard pile.
// =================================================================================

const JACKMOVE = "37c534eb-781f-4386-b0be-afdb268efd05";

const jackmoveTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(JACKMOVE), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `deck-${seat}-0`, def: character({ name: `Top char ${seat}` }), owner: seat, zone: "deck" },
      { key: `deck-${seat}-1`, def: { ...character({ name: `Top spell ${seat}` }), type: "tactic" as const }, owner: seat, zone: "deck" },
      { key: `deck-${seat}-2`, def: item({ name: `Top item ${seat}` }), owner: seat, zone: "deck" },
      ...plain(`deck-${seat}-rest`, 3, seat, "deck")
    ])
  ]);

for (const count of COUNTS) {
  mpClause(JACKMOVE, "0:ability", count, `${count} seats: with X = 3 the top 3 of the chosen opponent's deck are revealed; its characters and items enter play under P1's control, the rest go to that opponent's discard pile`, () => {
    for (const opponent of others(count)) {
      const t = jackmoveTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card", { variables: { x: 3 } })), opponentChoice(count));
      const before = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
      playCard(t, P1, "card", { players: { opponent }, variables: { x: 3 } });
      assert.equal(revealedBy(t, opponent), 1, "the chosen opponent's top cards were revealed");
      for (const seat of others(count, opponent)) assert.equal(revealedBy(t, seat), 0);
      for (const key of [`deck-${opponent}-0`, `deck-${opponent}-2`]) {
        assert.equal(zoneOf(t, key), "play", "characters and items enter play");
        assert.equal(t.engine.state.cards[t.id(key)]!.controllerId, P1, "under P1's control");
      }
      assert.equal(zoneOf(t, `deck-${opponent}-1`), "discard", "the remaining card goes to the opponent's discard pile");
      assert.deepEqual(deckOf(t, opponent), before[opponent]!.slice(3));
      for (const seat of others(count, opponent)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
    }
    const t = jackmoveTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card", { variables: { x: 3 } })), undefined);
    playCard(t, P1, "card", { variables: { x: 3 } });
    assert.equal(zoneOf(t, "deck-p2-0"), "play", "P2 is bound automatically");
  });
}

// =================================================================================
// Grand Theft All
// Put up to 4 non-tactic cards in your opponent's discard pile into play under your control.
// =================================================================================

const THEFT = "799e4e63-e1ab-4f7e-bd5c-f5534b770686";

const theftTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(THEFT), owner: P1, zone: "hand" },
    ...bank("deception", 10, P1),
    { key: "mine-discard", def: character({ name: "P1 discarded" }), owner: P1, zone: "discard" },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      ...plain(`loot-${seat}-`, 3, seat, "discard"),
      { key: `spell-${seat}`, def: tactic({ name: `Spell ${seat}` }), owner: seat, zone: "discard" }
    ])
  ]);

for (const count of COUNTS) {
  mpClause(THEFT, "0:rule", count, `${count} seats: P1 puts up to 4 non-tactic cards from the chosen opponent's discard pile (only) into play under P1's control`, () => {
    for (const opponent of others(count)) {
      const t = theftTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      playRaw(t, P1, "card", { players: { opponent } });
      drive(t, (pc) => {
        if (pc.declaration?.id === "cs") {
          assert.deepEqual(pickable(t), ids(t, `loot-${opponent}-0`, `loot-${opponent}-1`, `loot-${opponent}-2`).sort(), "only non-tactic cards of the chosen opponent's discard pile");
          return { kind: "chooserSelectsTarget", selected: ids(t, `loot-${opponent}-0`, `loot-${opponent}-1`) };
        }
        return undefined;
      });
      for (const i of [0, 1]) {
        assert.equal(zoneOf(t, `loot-${opponent}-${i}`), "play");
        assert.equal(t.engine.state.cards[t.id(`loot-${opponent}-${i}`)]!.controllerId, P1);
      }
      assert.equal(zoneOf(t, `loot-${opponent}-2`), "discard");
      assert.equal(zoneOf(t, `spell-${opponent}`), "discard");
      for (const seat of others(count, opponent)) assert.equal(zoneOf(t, `loot-${seat}-0`), "discard", `${seat}'s discard pile is untouched`);
      assert.equal(zoneOf(t, "mine-discard"), "discard");
    }
    const t = theftTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card");
    drive(t, (pc) => (pc.declaration?.id === "cs" ? { kind: "chooserSelectsTarget", selected: ids(t, "loot-p2-0") } : undefined));
    assert.equal(zoneOf(t, "loot-p2-0"), "play", "P2 is bound automatically");
  });
}
