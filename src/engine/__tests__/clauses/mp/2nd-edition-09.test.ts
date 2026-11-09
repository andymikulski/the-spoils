// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 10: text with no "your opponent" choice whose
// meaning at a larger table still has to be proven (Guardforce Morphmajig: "if your opponent plays a card", Auction House:
// bidding in turn order, Cheats McGuillicutty: "revealed ... to every player"). Expectations come from each card's PRINTED
// text, the multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, developFaction, resourceCard, tactic } from "../../per-card/_harness.js";
import { buildGame } from "../../support/fixtures.js";
import { developPlay } from "../../support/develop.js";
import { clause, printing } from "../_clause.js";
import { COUNTS, drive, ids, others, plain, refused } from "./_seats2ndEdition.js";
import { P1, P2, P3, P4, deckOf, endTurn, handOf, open, playCard, resolvePendingResponses, seatsOf, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

/** A real table whose factions have the Develop Rule's choices (draw / play a resource), P1 first unless `active` says otherwise. */
function devTable(count: Count, cards: CardPlacement[], active: PlayerId = P1): Table {
  const built = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: developFaction() })),
    activePlayerId: active,
    cards
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}

const tokensOn = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.counters?.token ?? 0;
const noop = (name: string) => tactic({ name, behavior: { abilities: [{ id: "go", type: "activated", effects: [] }] } as never });

// =================================================================================
// Guardforce Morphmajig
// This card can attack even if it has not been in play under your control since the start of the turn.
// If you play a card, put a token on this card. (Playing a resource doesn't count.)
// If your opponent plays a card, remove a token from this card. (Playing a resource doesn't count.)
// This card gains 1 strength and 1 life for each token on it.
// =================================================================================

const GUARDFORCE = "0b06764e-d38c-4c62-bb15-7a71e79e1e2c";

const guardTable = (count: Count, opts: { tokens?: number; zone?: "hand" | "play"; active?: PlayerId } = {}): Table =>
  devTable(
    count,
    [
      { key: "card", def: printing(GUARDFORCE), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : {} },
      ...bank("elitism", 5, P1),
      { key: "p1-char", def: character({ name: "P1 char" }), owner: P1, zone: "hand" },
      { key: "p1-res", def: resourceCard({ name: "P1 resource" }), owner: P1, zone: "hand" },
      ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
        { key: `${seat}-char`, def: character({ name: `${seat} char` }), owner: seat, zone: "hand" },
        { key: `${seat}-res`, def: resourceCard({ name: `${seat} resource` }), owner: seat, zone: "hand" },
        { key: `${seat}-tactic`, def: noop(`${seat} tactic`), owner: seat, zone: "hand" },
        ...plain(`deck-${seat}-`, 3, seat, "deck"),
        { key: `target-${seat}`, def: character({ name: `Target ${seat}` }), owner: seat, zone: "play" }
      ]),
      ...plain("deck-p1-", 3, P1, "deck")
    ],
    opts.active
  );

for (const count of COUNTS) {
  clause(GUARDFORCE, "0:rule", `${count} seats: it can attack the turn it enters play, the faction of any opponent`, () => {
    for (const defender of others(count)) {
      const t = guardTable(count, { zone: "hand" });
      playCard(t, P1, "card");
      assert.equal(zoneOf(t, "card"), "play");
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids(t, "card"), target: { type: "faction", playerId: defender } } as never);
      assert.ok(t.engine.state.battle, `it attacked ${defender}'s faction the turn it entered play`);
      assert.equal(t.engine.state.battle!.defenderPlayerId, defender);
    }
  });

  clause(GUARDFORCE, "1:rule", `${count} seats: a card P1 plays adds a token; a resource P1 plays does not; a card an opponent plays never adds one`, () => {
    const t = guardTable(count);
    playCard(t, P1, "p1-char");
    assert.equal(tokensOn(t, "card"), 1, "P1 played a card: +1 token");
    developPlay(t.engine, P1, t.id("p1-res"));
    assert.equal(zoneOf(t, "p1-res"), "play");
    assert.equal(tokensOn(t, "card"), 1, "playing a resource does not count");
    for (const seat of others(count)) {
      const u = guardTable(count, { active: seat });
      playCard(u, seat, `${seat}-char`);
      assert.equal(tokensOn(u, "card"), 0, `${seat} played a card: it never adds a token (nothing to remove either)`);
    }
  });

  clause(GUARDFORCE, "2:rule", `${count} seats: a non-resource card played by any opponent removes a token (nobody is asked to choose); a resource, or P1's own card, does not; at 0 nothing is removed`, () => {
    for (const seat of others(count)) {
      const t = guardTable(count, { tokens: 3, active: seat });
      playCard(t, seat, `${seat}-char`);
      assert.equal(tokensOn(t, "card"), 2, `${seat}'s card removed a token`);
      assert.equal(open(t), undefined, "nobody is asked to choose an opponent: any opponent's play is enough");
      developPlay(t.engine, seat, t.id(`${seat}-res`));
      assert.equal(zoneOf(t, `${seat}-res`), "play");
      assert.equal(tokensOn(t, "card"), 2, "a resource play does not count");
      playCard(t, seat, `${seat}-tactic`);
      assert.equal(tokensOn(t, "card"), 1, "a tactic is a card too");
    }
    // P1's own card adds a token, it does not remove one.
    {
      const t = guardTable(count, { tokens: 3 });
      playCard(t, P1, "p1-char");
      assert.equal(tokensOn(t, "card"), 4);
    }
    // At 0 tokens nothing is removed.
    {
      const t = guardTable(count, { tokens: 0, active: P2 });
      playCard(t, P2, "p2-char");
      assert.equal(tokensOn(t, "card"), 0);
    }
    // Three tokens: both opponents' plays remove one each (an opponent, any opponent).
    {
      const t = guardTable(count, { tokens: 3, active: P2 });
      playCard(t, P2, "p2-char");
      endTurn(t, P2);
      drive(t);
      assert.equal(t.engine.state.activePlayerId, P3);
      playCard(t, P3, "p3-char");
      assert.equal(tokensOn(t, "card"), 1, "P2's play and P3's play each removed a token");
    }
    // An eliminated seat plays nothing: only the remaining opponent's plays remove tokens.
    {
      const t = guardTable(count, { tokens: 3, active: P2 });
      for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
      playCard(t, P2, "p2-char");
      assert.equal(tokensOn(t, "card"), 2);
    }
  });

  clause(GUARDFORCE, "3:rule", `${count} seats: it gains 1 strength and 1 life per token, following tokens added by P1's plays and removed by opponents' plays, at any table size`, () => {
    const t = guardTable(count, { tokens: 3 });
    const base = { strength: t.engine.getStat(t.id("card"), "strength"), life: t.engine.getStat(t.id("card"), "life") };
    assert.equal(base.strength, 3 + 3);
    assert.equal(base.life, 3 + 3);
    playCard(t, P1, "p1-char");
    assert.equal(t.engine.getStat(t.id("card"), "strength"), 3 + 4, "a token added by P1's play raises the bonus at once");
    assert.equal(t.engine.getStat(t.id("card"), "life"), 3 + 4);
    const u = guardTable(count, { tokens: 3, active: P2 });
    playCard(u, P2, "p2-char");
    assert.equal(u.engine.getStat(u.id("card"), "strength"), 3 + 2, "a token removed by an opponent's play lowers it at once");
    assert.equal(u.engine.getStat(u.id("card"), "life"), 3 + 2);
  });
}

// =================================================================================
// Auction House
// At the start of each player's turn, that player reveals cards from the top of their deck until a character is revealed or
// no cards are left. If a character is revealed, players take turns bidding on the character (starting with the active
// player). Players cannot bid a number greater than the number of detached resources they control. Whichever player makes
// the winning bid pays that many resources and puts the character into play under their control. Shuffle all other revealed
// cards into their owner's deck.
// =================================================================================

const AUCTION = "ae9ae5db-e784-4193-ad45-400f7ba900bc";

const READY: Record<string, number> = { p1: 3, p2: 1, p3: 4, p4: 2 };

function auctionTable(count: Count, active: PlayerId): Table {
  return devTable(
    count,
    [
      { key: "house", def: printing(AUCTION), owner: P1, zone: "play" },
      ...seatsOf(count).flatMap((seat): CardPlacement[] => [
        { key: `deck-${seat}-it`, def: { ...character({ name: `Item ${seat}` }), type: "item" as const }, owner: seat, zone: "deck" },
        { key: `deck-${seat}-res`, def: resourceCard({ name: `Res ${seat}` }), owner: seat, zone: "deck" },
        { key: `deck-${seat}-prize`, def: character({ name: `Prize ${seat}` }), owner: seat, zone: "deck" },
        ...plain(`deck-${seat}-rest`, 3, seat, "deck"),
        ...bank("greed", READY[seat]!, seat)
      ])
    ],
    active
  );
}

const bidPrompt = (t: Table) => {
  const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; highBid: number; maxBid: number; characterId: string } | undefined;
  assert.equal(pc?.kind, "auctionBid", "a bid is asked for");
  return pc!;
};
const bid = (t: Table, who: PlayerId, amount: number): void => {
  assert.equal(bidPrompt(t).playerId, who, `${who} is asked to bid`);
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "auctionBid", bid: amount } } as never);
  resolvePendingResponses(t.engine);
};
/** Starts the turn of the seat after `active` (answering only the trigger ordering of the turn start). */
function startTurnAfter(t: Table, active: PlayerId): void {
  endTurn(t, active);
  for (let guard = 0; guard < 6 && open(t)?.kind === "orderTriggers"; guard++) {
    const pc = t.engine.state.pendingChoice as unknown as { playerId: string; triggers: Array<{ abilityId: string }> };
    const next = pc.triggers.find((trigger) => trigger.abilityId === "restoreRule") ?? pc.triggers[0];
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next } } as never);
  }
}

clause(AUCTION, "0:rule", "3 seats: the active player reveals from their own deck; bidding goes active player, then clockwise; caps are each player's detached resources; the winner pays and gets the character; the rest are shuffled into the revealer's deck", () => {
  {
    const t = auctionTable(3, P3);
    const decks = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
    startTurnAfter(t, P3);
    assert.equal(t.engine.state.activePlayerId, P1);
    const prize = t.id("deck-p1-prize");
    assert.equal(bidPrompt(t).characterId, prize, "P1 reveals from P1's own deck");
    bid(t, P1, 1);
    assert.equal(bidPrompt(t).playerId, P2, "then clockwise: P2");
    assert.equal(bidPrompt(t).maxBid, 1, "P2 has 1 detached resource");
    refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "auctionBid", bid: 2 } } as never), "P2 cannot bid above its 1 detached resource");
    bid(t, P2, 0);
    assert.equal(bidPrompt(t).playerId, P3, "then P3");
    assert.equal(bidPrompt(t).maxBid, 4, "P3 has 4 detached resources");
    bid(t, P3, 2);
    assert.equal(bidPrompt(t).playerId, P1, "bidding goes round again to P1 (P2 passed and may not bid again)");
    assert.equal(bidPrompt(t).maxBid, 3);
    refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "auctionBid", bid: 4 } } as never), "P1 cannot bid above its 3 detached resources");
    const ready = t.engine.getAvailableResourceCount(P3);
    bid(t, P1, 0);
    assert.notEqual(open(t)?.kind, "auctionBid", "the last bidder left wins: no more bids are asked for");
    assert.equal(zoneOf(t, "deck-p1-prize"), "play");
    assert.equal(t.engine.state.cards[prize]!.controllerId, P3, "the winning bidder puts the character into play under their control");
    assert.equal(ready - t.engine.getAvailableResourceCount(P3), 2, "P3 paid 2 resources");
    for (const key of ["deck-p1-it", "deck-p1-res"]) assert.ok(deckOf(t, P1).includes(t.id(key)), `${key} was shuffled into P1's deck (its owner)`);
    assert.deepEqual(deckOf(t, P2), decks.p2, "P2's deck is untouched");
    assert.deepEqual(deckOf(t, P3), decks.p3, "P3's deck is untouched");
  }
  // At P2's turn start P2 reveals from P2's deck and bidding starts with P2, then P3, then P1.
  {
    const t = auctionTable(3, P1);
    startTurnAfter(t, P1);
    assert.equal(t.engine.state.activePlayerId, P2);
    assert.equal(bidPrompt(t).characterId, t.id("deck-p2-prize"), "P2 reveals from P2's own deck");
    assert.equal(bidPrompt(t).playerId, P2, "bidding starts with the active player");
    bid(t, P2, 1);
    bid(t, P3, 0);
    assert.equal(bidPrompt(t).playerId, P1, "then P1, last in turn order");
    bid(t, P1, 0);
    assert.equal(t.engine.state.cards[t.id("deck-p2-prize")]!.controllerId, P2);
  }
});

clause(AUCTION, "0:rule", "4 seats: bidding order is the active player then clockwise; a player who passes may not return; with a seat eliminated no prompt goes to it; the winner pays and gets the character", () => {
  {
    const t = auctionTable(4, P2);
    const decks = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
    startTurnAfter(t, P2);
    assert.equal(t.engine.state.activePlayerId, P3);
    assert.equal(bidPrompt(t).characterId, t.id("deck-p3-prize"), "P3 reveals from P3's own deck");
    bid(t, P3, 1);
    bid(t, P4, 2);
    bid(t, P1, 0); // P1 passes first and may not return
    assert.equal(bidPrompt(t).playerId, P2, "P2 is next (P1 passed)");
    assert.equal(bidPrompt(t).maxBid, 1);
    bid(t, P2, 0);
    assert.equal(bidPrompt(t).playerId, P3, "P3 may still raise: it has not passed");
    const ready = t.engine.getAvailableResourceCount(P4);
    bid(t, P3, 0);
    assert.notEqual(open(t)?.kind, "auctionBid");
    assert.equal(t.engine.state.cards[t.id("deck-p3-prize")]!.controllerId, P4, "P4 is the last bidder left and wins");
    assert.equal(ready - t.engine.getAvailableResourceCount(P4), 2, "P4 pays its winning bid of 2");
    assert.ok(deckOf(t, P3).includes(t.id("deck-p3-it")), "the other revealed cards are shuffled into P3's deck");
    for (const seat of [P1, P2, P4]) assert.deepEqual(deckOf(t, seat), decks[seat], `${seat}'s deck is untouched`);
  }
  // P4 is eliminated: the bidders are P1 to P3 only, and no prompt goes to P4.
  {
    const t = auctionTable(4, P2);
    t.engine.state.players[P4]!.eliminated = { turn: 1 };
    startTurnAfter(t, P2);
    assert.equal(t.engine.state.activePlayerId, P3);
    const seen: PlayerId[] = [];
    for (let guard = 0; guard < 6 && open(t)?.kind === "auctionBid"; guard++) {
      const pc = bidPrompt(t);
      seen.push(pc.playerId);
      bid(t, pc.playerId, pc.playerId === P3 ? 1 : 0);
    }
    assert.deepEqual(seen, [P3, P1, P2], "bidders are P3, P1, P2 in turn order; P4 is never asked");
    assert.equal(t.engine.state.cards[t.id("deck-p3-prize")]!.controllerId, P3);
  }
});

// =================================================================================
// Cheats McGuillicutty
// CHEAT -- COST: Deplete this card. -- EFFECT: Reveal the top card of your deck. You may play it. (You can't play resources
// with this ability.)
// =================================================================================

const CHEATS = "078b8b9a-b559-44b9-b86d-7cee8727b3ad";

const cheatsTable = (count: Count, top: "character" | "resource"): Table =>
  devTable(count, [
    { key: "card", def: printing(CHEATS), owner: P1, zone: "play" },
    ...bank("deception", 2, P1),
    { key: "top", def: top === "resource" ? resourceCard({ name: "Top resource" }) : character({ name: "Top character", cost: 0 }), owner: P1, zone: "deck" },
    ...plain("deck-p1-", 3, P1, "deck"),
    ...seatsOf(count).slice(1).flatMap((seat) => plain(`deck-${seat}-`, 3, seat, "deck"))
  ]);

for (const count of COUNTS) {
  clause(CHEATS, "3:ability:cheat", `${count} seats: the top card of P1's deck is revealed to every player; P1 may play it unless it is a resource; no other deck is touched`, () => {
    for (const top of ["character", "resource"] as const) {
      const t = cheatsTable(count, top);
      const decks = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
      t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "cheat" } as never);
      drive(t, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: t.id("top") } : undefined));
      const reveals = t.engine.getLog().map((entry) => entry.event).filter((event) => event?.type === "cardsRevealed") as Array<{ ownerId: string; viewerId: string; cardIds: string[] }>;
      assert.ok(reveals.some((event) => event.ownerId === P1 && event.viewerId === "all" && event.cardIds.includes(t.id("top"))), "the top card was revealed to every player");
      assert.ok(reveals.every((event) => event.ownerId === P1), "only P1's deck was revealed");
      assert.equal(t.engine.state.cards[t.id("card")]!.depleted, true);
      if (top === "character") assert.equal(zoneOf(t, "top"), "play", "P1 played the revealed card");
      else assert.equal(deckOf(t, P1)[0], t.id("top"), "a resource cannot be played with this ability: it stays on top");
      for (const seat of others(count)) assert.deepEqual(deckOf(t, seat), decks[seat], `${seat}'s deck is untouched`);
    }
    // P1 may decline to play it.
    const t = cheatsTable(count, "character");
    t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "cheat" } as never);
    drive(t);
    assert.equal(deckOf(t, P1)[0], t.id("top"), "declined: the card stays on top");
  });
}
