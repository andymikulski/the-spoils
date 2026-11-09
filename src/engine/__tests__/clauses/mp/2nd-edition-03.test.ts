// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 4: tactics and abilities whose text says "your
// opponent" and that act on that opponent's hand, deck or choices (Arcana Experiment, Eccentric Inquisition,
// Ecto-Distillation, Eldridge Gosche, Forget). The opponent is chosen with the play or activation, before any target.
// Expectations come from each card's PRINTED text, the multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, tactic } from "../../per-card/_harness.js";
import { clause, printing } from "../_clause.js";
import { COUNTS, drive, eliminateAllBut, ids, opponentChoice, others, pickable, plain, refused } from "./_seats2ndEdition.js";
import { deckOf, handOf, P1, P2, playCard, playersNeeded, playRaw, seatsOf, table, zoneOf, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const discardOf = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.discard;
const playAction = (t: Table, key: string, extra: Record<string, unknown> = {}) => ({ type: "playCard", playerId: P1, cardId: t.id(key), ...extra }) as never;
const abilityAction = (t: Table, key: string, abilityId: string, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: P1, cardId: t.id(key), abilityId, ...extra }) as never;

// =================================================================================
// Arcana Experiment
// Play this only if you have at least 5 cards in your deck. Deplete up to 5 characters you control. X is the number of
// characters you deplete this way. -- Search your deck for 5 cards and reveal them. Your opponent chooses X of those
// cards. Put the chosen cards into your hand and the rest into your discard pile.
// =================================================================================

const ARCANA = "4300e226-bceb-4fcc-b9d0-097971b17dc4";

const arcanaTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(ARCANA), owner: P1, zone: "hand" },
    ...plain("mine", 3, P1, "play"),
    ...plain("deck", 8, P1, "deck"),
    ...seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, 2, seat, "hand")),
    ...bank("obsession", 7, P1)
  ]);

for (const count of COUNTS) {
  clause(ARCANA, "0:ability", `${count} seats: P1 searches P1's own deck for 5 cards and only the opponent P1 chose picks X of them`, () => {
    for (const opponent of others(count)) {
      const t = arcanaTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count), "the opponent is chosen with the play, before the targets");
      const top5 = deckOf(t, P1).slice(0, 5);
      playRaw(t, P1, "card", { players: { opponent }, selected: { depleted: ids(t, "mine0", "mine1", "mine2") } });
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "found") return { kind: "chooserSelectsTarget", selected: top5 };
        if (pc.declaration?.id === "chosen") return { kind: "chooserSelectsTarget", selected: top5.slice(0, 3) };
        return undefined;
      });
      assert.deepEqual(asked.filter((a) => a.decl).map((a) => [a.who, a.decl]), [[P1, "found"], [opponent, "chosen"]], "P1 searches, then only the chosen opponent chooses");
      assert.ok(!asked.some((a) => a.who !== P1 && a.who !== opponent), "no other player is asked anything");
      for (const key of top5.slice(0, 3)) assert.ok(handOf(t, P1).includes(key), "the 3 chosen cards (X = 3 characters depleted) go to P1's hand");
      for (const key of top5.slice(3)) assert.ok(discardOf(t, P1).includes(key), "the rest go to P1's discard pile");
      for (const seat of others(count)) assert.equal(handOf(t, seat).length, 2, `${seat}'s hand is untouched`);
    }
    // Only one opponent left: nobody is asked.
    const t = arcanaTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card", { selected: { depleted: ids(t, "mine0", "mine1") } });
    const asked = drive(t, (pc) => (pc.declaration?.id === "found" ? { kind: "chooserSelectsTarget", selected: deckOf(t, P1).slice(0, 5) } : pc.declaration?.id === "chosen" ? { kind: "chooserSelectsTarget", selected: pickable(t).slice(0, 2) } : undefined));
    assert.deepEqual(asked.filter((a) => a.decl).map((a) => a.who), [P1, P2], "P2 is bound automatically and is the one who chooses");
  });
}

// =================================================================================
// Eccentric Inquisition
// Reveal the top 7 cards of your opponent's deck. Remove all tactics revealed this way from the game. Put the remaining
// cards on the bottom of your opponent's deck in any order. For the rest of the game, you may play tactics removed from
// the game by this card as though they were in your hand without meeting their threshold.
// =================================================================================

const INQUISITION = "9dadce7a-caff-45f9-9c42-a4b0a38e6298";

function inquisitionTable(count: Count): Table {
  return table(count, [
    { key: "card", def: printing(INQUISITION), owner: P1, zone: "hand" },
    ...bank("obsession", 4, P1),
    ...seatsOf(count).slice(1).flatMap((seat) => [
      // top 7: a tactic at the 2nd and 5th place, then 3 more cards below the revealed ones
      ...Array.from({ length: 10 }, (_, i) => ({
        key: `${seat}-deck${i}`,
        def: i === 1 || i === 4 ? tactic({ name: `Tactic ${seat} ${i}`, threshold: "rrrr" as never }) : character({ name: `Card ${seat} ${i}` }),
        owner: seat,
        zone: "deck" as const
      }))
    ])
  ]);
}

const revealedBy = (t: Table, owner: PlayerId): number =>
  t.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed" && (entry.event as { ownerId?: string }).ownerId === owner).length;

for (const count of COUNTS) {
  clause(INQUISITION, "0:rule", `${count} seats: the top 7 of the chosen opponent's deck are revealed to everyone, its tactics are removed, the rest go to the bottom in P1's order; no other deck is touched`, () => {
    for (const opponent of others(count)) {
      const t = inquisitionTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      const before = Object.fromEntries(seatsOf(count).slice(1).map((seat) => [seat, [...deckOf(t, seat)]]));
      playRaw(t, P1, "card", { players: { opponent } });
      let five: string[] = [];
      const asked = drive(t, (pc) => {
        if (pc.kind === "reorderDeck") {
          five = [...(pc.cardIds as string[])];
          return { kind: "reorderDeck", order: [...five].reverse() };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.kind]), [[P1, "reorderDeck"]], "P1 orders the cards that go to the bottom");
      assert.equal(revealedBy(t, opponent), 1, "the opponent's top 7 were revealed");
      for (const seat of others(count, opponent)) assert.equal(revealedBy(t, seat), 0, `${seat}'s deck was not revealed`);
      const removed = [1, 4].map((i) => before[opponent]![i]!);
      for (const key of removed) assert.equal(t.engine.state.cards[key]!.zone, "removed", "revealed tactics are removed from the game");
      const rest = before[opponent]!.slice(0, 7).filter((key) => !removed.includes(key));
      assert.deepEqual([...five].sort(), [...rest].sort());
      assert.deepEqual(deckOf(t, opponent), [...before[opponent]!.slice(7), ...[...five].reverse()], "the other cards go to the bottom in the order P1 chose");
      for (const seat of others(count, opponent)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
      // For the rest of the game P1 (only) may play the removed tactics without meeting their threshold.
      refused(() => t.engine.perform({ type: "playCard", playerId: opponent, cardId: removed[0]! } as never), "the opponent cannot play a removed tactic");
      t.engine.perform({ type: "playCard", playerId: P1, cardId: removed[0]! } as never);
      assert.notEqual(t.engine.state.cards[removed[0]!]!.zone, "removed", "P1 played the removed tactic (threshold [R][R][R][R] ignored)");
    }
    // A chosen opponent with fewer than 7 cards reveals all of them.
    {
      const t = table(count, [
        { key: "card", def: printing(INQUISITION), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1),
        ...plain("short", 3, P2, "deck"),
        ...plain("long", 9, seatsOf(count)[2]!, "deck")
      ]);
      playRaw(t, P1, "card", { players: { opponent: P2 } });
      drive(t, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : undefined));
      assert.equal(revealedBy(t, P2), 1);
      assert.equal(deckOf(t, P2).length, 3);
      assert.equal(deckOf(t, seatsOf(count)[2]!).length, 9);
    }
    // Only one opponent left: nobody is asked.
    const t = inquisitionTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card");
    assert.equal(revealedBy(t, P2), 1, "P2 is bound automatically");
  });
}

// =================================================================================
// Ecto-Distillation
// Name a card. -- Search your deck for any number of copies of the card and reveal them. Put 1 into your hand and the rest
// into your discard pile. Your opponent may search your deck for any number of copies of the card. If they do, put them
// into your discard pile.
// =================================================================================

const ECTO = "ab9cdd87-c394-4108-a787-805193911891";
const target = (): ReturnType<typeof character> => character({ id: "ecto-target", name: "Target" });

function ectoTable(count: Count): Table {
  return table(count, [
    { key: "card", def: printing(ECTO), owner: P1, zone: "hand" },
    ...["t1", "t2", "t3"].map((key) => ({ key, def: target(), owner: P1, zone: "deck" as const })),
    ...plain("other", 3, P1, "deck"),
    ...bank("obsession", 3, P1),
    ...bank("deception", 1, P1)
  ]);
}

for (const count of COUNTS) {
  clause(ECTO, "0:ability", `${count} seats: P1 searches P1's own deck; only the opponent P1 chose may search P1's deck for the remaining copies`, () => {
    for (const opponent of others(count)) {
      for (const oppTakes of [true, false]) {
        const t = ectoTable(count);
        assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
        playRaw(t, P1, "card", { players: { opponent } });
        const asked = drive(t, (pc) => {
          if (pc.kind === "nameValue") return { kind: "nameValue", value: "Target" };
          if (pc.declaration?.id === "found") return { kind: "chooserSelectsTarget", selected: ids(t, "t1", "t2") };
          if (pc.declaration?.id === "one") return { kind: "chooserSelectsTarget", selected: ids(t, "t1") };
          if (pc.declaration?.id === "opp") return { kind: "chooserSelectsTarget", selected: oppTakes ? ids(t, "t3") : [] };
          return undefined;
        });
        assert.deepEqual(asked.map((a) => a.who), [P1, P1, P1, opponent], "P1 names, searches and picks; only the chosen opponent is offered the search of P1's deck");
        assert.equal(zoneOf(t, "t1"), "hand");
        assert.equal(zoneOf(t, "t2"), "discard");
        assert.equal(zoneOf(t, "t3"), oppTakes ? "discard" : "deck", oppTakes ? "the opponent searched P1's deck and the copy went to P1's discard pile" : "declined: nothing moves");
      }
    }
    // Only one opponent left: nobody is asked.
    const t = ectoTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card");
    const asked = drive(t, (pc) => (pc.kind === "nameValue" ? { kind: "nameValue", value: "Target" } : undefined));
    assert.equal(asked[asked.length - 1]!.who, P2, "P2 is bound automatically and is offered the search");
  });
}

// =================================================================================
// Eldridge Gosche
// DISRUPT -- COST: Remove 3 tokens from this card. -- EFFECT: Look at your opponent's hand and choose a card in it. Your
// opponent discards that card.
// =================================================================================

const ELDRIDGE = "5529932d-de79-4d8d-bc55-c5240e86bd09";

const eldridgeTable = (count: Count, tokens = 3): Table =>
  table(count, [
    { key: "card", def: printing(ELDRIDGE), owner: P1, zone: "play", counters: { token: tokens } },
    ...seatsOf(count).flatMap((seat) => plain(`hand-${seat}-`, 3, seat, "hand"))
  ]);

for (const count of COUNTS) {
  clause(ELDRIDGE, "3:ability:disrupt", `${count} seats: P1 looks at and chooses a card of the chosen opponent's hand only, and that opponent discards it`, () => {
    for (const opponent of others(count)) {
      const t = eldridgeTable(count);
      assert.deepEqual(playersNeeded(t, abilityAction(t, "card", "disrupt")), opponentChoice(count));
      t.engine.perform(abilityAction(t, "card", "disrupt", { players: { opponent } }));
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "h") {
          assert.deepEqual(pickable(t), ids(t, `hand-${opponent}-0`, `hand-${opponent}-1`, `hand-${opponent}-2`).sort(), "only the chosen opponent's hand is offered");
          return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "h"]]);
      assert.equal(zoneOf(t, `hand-${opponent}-1`), "discard");
      assert.equal(t.engine.state.cards[t.id("card")]!.counters?.token ?? 0, 0, "3 tokens were removed");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
      assert.equal(handOf(t, opponent).length, 2);
    }
    // With fewer than 3 tokens it cannot be used.
    {
      const t = eldridgeTable(count, 2);
      refused(() => t.engine.perform(abilityAction(t, "card", "disrupt", { players: { opponent: P2 } })), "fewer than 3 tokens");
    }
    // Only one opponent left: nobody is asked.
    const t = eldridgeTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, abilityAction(t, "card", "disrupt")), undefined);
    t.engine.perform(abilityAction(t, "card", "disrupt"));
    drive(t, (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0") } : undefined));
    assert.equal(zoneOf(t, "hand-p2-0"), "discard", "P2 is bound automatically");
  });
}

// =================================================================================
// Forget
// Pick a non-resource card. -- Put the card into its owner's hand. Look at your opponent's hand and choose a card in it.
// Your opponent discards that card.
// =================================================================================

const FORGET = "a4f1535c-b3fa-46fa-93cd-d0b9f3abb10c";

const forgetTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(FORGET), owner: P1, zone: "hand" },
    ...plain("bounce", 1, P1, "play"),
    ...seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, 3, seat, "hand")),
    ...bank("obsession", 5, P1)
  ]);

for (const count of COUNTS) {
  clause(FORGET, "0:ability", `${count} seats: the picked card returns to its owner's hand, then P1 chooses a card in the chosen opponent's hand only and that opponent discards it`, () => {
    for (const opponent of others(count)) {
      const t = forgetTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      playRaw(t, P1, "card", { players: { opponent }, selected: { bounced: ids(t, "bounce0") } });
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "discarded") {
          assert.deepEqual(pickable(t), ids(t, `hand-${opponent}-0`, `hand-${opponent}-1`, `hand-${opponent}-2`).sort(), "only the chosen opponent's hand is offered");
          return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-2`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "discarded"]]);
      assert.equal(zoneOf(t, "bounce0"), "hand", "the picked card went to its owner's hand");
      assert.equal(zoneOf(t, `hand-${opponent}-2`), "discard");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
    }
    const t = forgetTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card", { selected: { bounced: ids(t, "bounce0") } });
    drive(t, (pc) => (pc.declaration?.id === "discarded" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0") } : undefined));
    assert.equal(zoneOf(t, "hand-p2-0"), "discard", "P2 is bound automatically");
  });
}

