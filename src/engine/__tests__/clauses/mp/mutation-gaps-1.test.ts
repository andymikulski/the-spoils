// Multiplayer clause tests added after `mp-mutate` (docs/TESTING.md): each one fails when a player word in the card's data
// is swapped for another ("opponent" -> "any" / "opponents"), because it checks WHICH cards the open pick offers (only the
// chosen / defending opponent's cards, never P1's own or another opponent's), not only the final board. Cards: Cryptic
// Athenaeum, Deceptive Muddler, I Drink Your Milkshake!, Perturbatious Warlock, Living God of Thabbash, Swarm of Gnats,
// Essence of Obsession. Expectations come from each card's PRINTED text.

import assert from "node:assert/strict";
import { bank, location } from "../../per-card/_harness.js";
import { mpClause, printing } from "../_clause.js";
import { item, resourceCard } from "../../support/fixtures.js";
import { battle, drive, ids, killTactic, others, pickable, plain } from "./_seats2ndEdition.js";
import { offeredCards } from "./_mpSeats.js";
import { character, passTurn, runPrompts } from "./_seedKit.js";
import { activate, choosePlayer, deckOf, handOf, open, P1, P2, playCard, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import * as s2 from "./_seed-2.js";
import type { PlayerId } from "../../../../engine.js";

const sorted = (list: readonly string[]): string[] => [...list].sort();

/** Every seat's hand: two characters, an item and a resource card (keys `ch0-<seat>` ...), a few deck cards and a character in play. */
function hands(count: Count): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    { key: `ch0-${seat}`, def: character({ name: `Char A ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `ch1-${seat}`, def: character({ name: `Char B ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `it-${seat}`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `rs-${seat}`, def: resourceCard({ name: `Resource ${seat}` }), owner: seat, zone: "hand" as const },
    ...[0, 1, 2, 3].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })),
    { key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const }
  ]);
}

/** Runs every open prompt: the chosen opponent (if asked) is `pick`, the discard pick takes `ch0-<picker>`; returns the cards each pick offered. */
function runAndRecordOffers(t: Table, pick: PlayerId): { offers: Array<{ picker: PlayerId; cards: string[] }>; asked: PlayerId[]; hand: string[] } {
  const hand = sorted(handOf(t, pick));
  const offers: Array<{ picker: PlayerId; cards: string[] }> = [];
  const asked = runPrompts(t, (pc) => {
    if (pc.kind === "choosePlayer") return { playerId: pick };
    if (pc.kind === "chooserSelectsTarget") {
      offers.push({ picker: pc.playerId, cards: sorted(offeredCards(t.engine)) });
      return { selected: [t.id(`ch0-${pc.playerId}`)] };
    }
    return { index: 0 };
  });
  return { offers, hand, asked: asked.filter((entry) => entry.kind === "chooserSelectsTarget").map((entry) => entry.playerId) };
}

/** The pick must be asked of `pick` alone and offer exactly the cards of `pick`'s hand. */
function assertOfferedOnlyHandOf(t: Table, pick: PlayerId, result: ReturnType<typeof runAndRecordOffers>): void {
  assert.deepEqual(result.asked, [pick], "only the chosen opponent is asked to pick");
  assert.equal(result.offers.length, 1, "one pick was offered");
  assert.deepEqual(result.offers[0]!.cards, result.hand, `the pick offers exactly ${pick}'s hand (no card of P1 or of another opponent)`);
}

// =================================================================================
// Perturbatious Warlock
// When this card enters play, your opponent puts a card from their hand on the top of their deck.
// =================================================================================

const WARLOCK = "7d385558-dd68-4c00-9c20-0a60daf86d86";

for (const count of [3, 4] as const) {
  mpClause(WARLOCK, "0:rule", count, `${count} seats: the pick offers only the chosen opponent's hand cards, never P1's or another opponent's`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "pw", def: printing(WARLOCK), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 4, P1)]);
      playCard(t, P1, "pw");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      const result = runAndRecordOffers(t, pick);
      assertOfferedOnlyHandOf(t, pick, result);
      assert.equal(deckOf(t, pick)[0], t.id("ch0-" + pick), "the picked card is on top of the chosen opponent's deck");
    }
  });
}

// =================================================================================
// Living God of Thabbash
// When a character you control leaves play, your opponent discards a card.
// =================================================================================

const LIVING_GOD = "bc206d76-e136-4096-8ebb-a3abe1288b83";

for (const count of [3, 4] as const) {
  mpClause(LIVING_GOD, "0:rule", count, `${count} seats: the discard pick offers only the chosen opponent's hand cards, never P1's or another opponent's`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "lg", def: printing(LIVING_GOD), owner: P1, zone: "play" }, ...hands(count), ...bank("obsession", 6, P1)]);
      activate(t, P1, "lg", "higher-calling", { selected: { c: [t.id("c-p1")] } });
      choosePlayer(t, P1, t.seats.slice(1), pick);
      const result = runAndRecordOffers(t, pick);
      assertOfferedOnlyHandOf(t, pick, result);
      assert.equal(t.engine.state.cards[t.id(`ch0-${pick}`)]!.zone, "discard", "the chosen opponent discarded");
    }
  });
}

// =================================================================================
// Essence of Obsession
// OPTION 1: Your opponent discards a card.
// =================================================================================

const ESSENCE_O = "e4260352-6b62-41dc-a031-6dbc0faccb73";

for (const count of [3, 4] as const) {
  mpClause(ESSENCE_O, "1:option:OPTION 1", count, `${count} seats: OPTION 1's discard pick offers only the chosen opponent's hand cards, never P1's or another opponent's`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "eo", def: printing(ESSENCE_O), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 6, P1)]);
      playCard(t, P1, "eo", { mode: 0, players: { opponent: pick } });
      const result = runAndRecordOffers(t, pick);
      assertOfferedOnlyHandOf(t, pick, result);
      assert.equal(t.engine.state.cards[t.id(`ch0-${pick}`)]!.zone, "discard", "the chosen opponent discarded");
    }
  });
}

// =================================================================================
// Cryptic Athenaeum
// With [O]x5: At the start of your turn, your opponent discards a card.
// =================================================================================

const ATHENAEUM = "12b6d2a3-5b34-4914-bcc4-20ddb1ad39ba";

for (const count of [3, 4] as const) {
  mpClause(ATHENAEUM, "2:rule@ooooo", count, `${count} seats: the discard pick offers only the chosen opponent's hand cards, never P1's or another opponent's`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "ca", def: printing(ATHENAEUM), owner: P1, zone: "play" }, ...hands(count), ...bank("obsession", 5, P1)], seatsOf(count).slice(-1)[0]!);
      assert.equal(passTurn(t), P1);
      const result = runAndRecordOffers(t, pick);
      assertOfferedOnlyHandOf(t, pick, result);
      assert.equal(t.engine.state.cards[t.id(`ch0-${pick}`)]!.zone, "discard", "the chosen opponent discarded");
      assert.equal(open(t), undefined, "nothing is left open");
    }
  });
}

// =================================================================================
// Deceptive Muddler
// COVERT. If this card inflicts damage to a faction, your opponent puts a card from their hand on the top of their deck if they can.
// =================================================================================

const MUDDLER = "47d266d5-3281-4b0a-85c5-b5f37e7a862f";

for (const count of [3, 4] as const) {
  mpClause(MUDDLER, "1:rule", count, `${count} seats: the pick offers only the defending player's hand cards, never P1's or another opponent's`, () => {
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "card", def: printing(MUDDLER), owner: P1, zone: "play" },
        ...seatsOf(count).flatMap((seat) => plain(`hand-${seat}-`, 3, seat, "hand"))
      ]);
      let offered: string[] | undefined;
      const asked = battle(t, P1, ["card"], defender, [], (pc) => {
        if (pc.declaration?.id !== "h") return undefined;
        offered = pickable(t);
        return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${defender}-1`) };
      });
      assert.deepEqual(asked.map((a) => a.who), [defender], "only the defending player is asked");
      assert.deepEqual(offered, sorted(ids(t, `hand-${defender}-0`, `hand-${defender}-1`, `hand-${defender}-2`)), "only the defending player's hand is offered");
      assert.equal(deckOf(t, defender)[0], t.id(`hand-${defender}-1`), "it went on top of the defending player's deck");
    }
  });
}

// =================================================================================
// Swarm of Gnats
// When this card enters or leaves play, your opponent discards a card.
// =================================================================================

const SWARM = "88855760-2a12-4d04-8e88-213f36effba4";

for (const count of [3, 4] as const) {
  mpClause(SWARM, "0:rule", count, `${count} seats: entering and leaving play each offer only the chosen opponent's hand cards, never P1's or another opponent's`, () => {
    const t = table(count, [
      { key: "swarm", def: printing(SWARM), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic("Swarm of Gnats"), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1),
      ...seatsOf(count).flatMap((seat) => plain(`hand-${seat}-`, 3, seat, "hand"))
    ]);
    const [first, second] = others(count) as [PlayerId, PlayerId];
    const offers: string[][] = [];
    const answer = (who: PlayerId) => (pc: { declaration?: { id: string } }) => {
      if (pc.declaration?.id !== "toDiscard") return undefined;
      offers.push(pickable(t));
      return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${who}-0`) };
    };
    playCard(t, P1, "swarm");
    choosePlayer(t, P1, t.seats.slice(1), first);
    drive(t, answer(first));
    assert.deepEqual(offers[0], sorted(ids(t, `hand-${first}-1`, `hand-${first}-2`, `hand-${first}-0`)), "entering play offers only the chosen opponent's hand");
    playCard(t, P1, "kill", { selected: { t: ids(t, "swarm") } });
    choosePlayer(t, P1, t.seats.slice(1), second);
    drive(t, answer(second));
    assert.deepEqual(offers[1], sorted(ids(t, `hand-${second}-1`, `hand-${second}-2`, `hand-${second}-0`)), "leaving play offers only the newly chosen opponent's hand");
    assert.equal(offers.length, 2, "one pick each time");
  });
}

// =================================================================================
// I Drink Your Milkshake!
// If an opponent plays a card with the same name as the one removed from the game, you may reveal the removed card ...
// =================================================================================

const MILKSHAKE = "6f1bdb80-2506-4724-bf83-950a81cc531a";
const FOO = s2.character({ name: "Foo", cost: 0 });

for (const count of [3, 4] as const) {
  mpClause(MILKSHAKE, "0:rule", count, `${count} seats: the removed card offered for the reveal is only one an opponent owned; a removed card of P1's own is never offered`, () => {
    const t = s2.table(count, [
      { key: "shake", def: printing(MILKSHAKE), owner: P1, zone: "hand" },
      ...s2.resources("deception", 4),
      // A "Foo" of P1's own that sits in the removed zone as if this card had removed it: not an opponent's card.
      { key: "own-removed", def: FOO, owner: P1, zone: "removed" },
      ...s2.others(count, P1).flatMap((seat) => [
        { key: `foo-deck-${seat}`, def: FOO, owner: seat, zone: "deck" as const },
        ...s2.deckOf(`k-${seat}-`, 3, seat),
        { key: `foo-hand-${seat}`, def: FOO, owner: seat, zone: "hand" as const }
      ])
    ]);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("shake"), players: { opponent: P2 }, selected: { dig: [t.id("foo-deck-p2")] } } as never);
    s2.settle(t);
    assert.equal(zoneOf(t, "foo-deck-p2"), "removed", "the searched opponent's Foo was removed");
    t.engine.state.cards[t.id("own-removed")]!.voidedBy = t.id("shake");
    const player = s2.others(count, P1, P2)[0]!;
    t.engine.state.activePlayerId = player;
    t.engine.state.priorityPlayerId = player;
    t.engine.perform({ type: "playCard", playerId: player, cardId: t.id(`foo-hand-${player}`) } as never);
    assert.equal(s2.pending(t)?.kind, "chooserSelectsTarget", "the reveal pick is open");
    assert.deepEqual(s2.pickable(t), s2.idsOf(t, ["foo-deck-p2"]), "only the opponent's removed card is offered, not P1's own");
  });
}
