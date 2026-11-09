// Multiplayer clause tests (3 and 4 seats) for Seed 2, part 04: I Drink Your Milkshake!, Mustache Aficionado, Mistaken
// Identity, Lucky Bastard and Spry Archer. Expectations come from the printed text of each clause.

import assert from "node:assert/strict";
import { mpClause, printing, refused } from "../_clause.js";
import {
  answerPlayer, answerTargets, askedPlayers, character, choosePlayer, deckOf, handSize, hands, idsOf, others, P1, P2, P3, P4, pending, perSeat, pickable, resourceCard, resources,
  seatsFor, settle, table, tactic, zoneOf
} from "./_seed-2.js";
import type { CardPlacement } from "./_seed-2.js";
import { autoResolveBattle } from "../../per-card/_harness.js";
import type { PlayerId } from "../../../../engine.js";

const MILKSHAKE = "6f1bdb80-2506-4724-bf83-950a81cc531a";
const MISTAKEN_IDENTITY = "e38f4972-a3c7-47b4-adb2-25177eda9065";
const MUSTACHE = "1dffc074-b158-4134-b52e-9e6e56541cf0";
const LUCKY_BASTARD = "85fcf752-5566-427e-a993-49531a2f38b0";
const SPRY_ARCHER = "98321c0c-3aef-4820-8636-9353e3c8a3b0";

const COUNTS = [3, 4] as const;

// =====================================================================================
// I Drink Your Milkshake!
// =====================================================================================

const FOO = character({ name: "Foo", cost: 0 });

/** IDYM in P1's hand with four [D]; "Foo" is on top of every opponent's deck (and a second "Foo" in each of their hands). */
function milkshakeBoard(count: number) {
  return table(count, [
    { key: "shake", def: printing(MILKSHAKE), owner: P1, zone: "hand" },
    ...resources("deception", 4),
    ...others(count, P1).flatMap((seat) => [
      { key: `foo-deck-${seat}`, def: FOO, owner: seat, zone: "deck" as const },
      ...deckOf(`k-${seat}-`, 3, seat),
      { key: `foo-hand-${seat}`, def: FOO, owner: seat, zone: "hand" as const }
    ])
  ]);
}

/** P1 plays IDYM naming `chosen` and searching their deck for "Foo". */
function search(t: ReturnType<typeof milkshakeBoard>, chosen: PlayerId): void {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("shake"), players: { opponent: chosen }, selected: { dig: [t.id(`foo-deck-${chosen}`)] } } as never);
  settle(t);
}

/** After the search it is `who`'s turn and they play their "Foo". */
function playFoo(t: ReturnType<typeof milkshakeBoard>, who: PlayerId): void {
  t.engine.state.activePlayerId = who;
  t.engine.state.priorityPlayerId = who;
  t.engine.perform({ type: "playCard", playerId: who, cardId: t.id(`foo-hand-${who}`) } as never);
}

for (const count of COUNTS) {
  mpClause(MILKSHAKE, "0:rule", count, `${count} seats: "search your opponent's deck": the opponent is chosen first, only that deck is searched and shuffled, the card is removed face-down`, () => {
    for (const chosen of others(count, P1)) {
      const t = milkshakeBoard(count);
      const action = { type: "playCard", playerId: P1, cardId: t.id("shake") } as const;
      assert.deepEqual(askedPlayers(t, action), others(count, P1));
      const untouched = Object.fromEntries(others(count, chosen, P1).map((seat) => [seat, [...t.engine.state.players[seat]!.deck]]));
      for (const other of others(count, chosen, P1)) {
        refused(() => t.engine.perform({ ...action, players: { opponent: chosen }, selected: { dig: [t.id(`foo-deck-${other}`)] } } as never), `a search of ${other}'s deck`);
      }
      search(t, chosen);
      assert.equal(zoneOf(t, `foo-deck-${chosen}`), "removed");
      assert.equal(t.engine.state.cards[t.id(`foo-deck-${chosen}`)]!.faceDown, true, "face-down");
      for (const [seat, deck] of Object.entries(untouched)) assert.deepEqual(t.engine.state.players[seat]!.deck, deck, `${seat}'s deck is neither searched nor shuffled`);
    }
  });

  mpClause(MILKSHAKE, "0:rule", count, `${count} seats: when the searched opponent plays a card with the same name, no opponent is chosen, I may play the removed card free and terminate their card`, () => {
    const t = milkshakeBoard(count);
    search(t, P2);
    playFoo(t, P2);
    assert.equal(pending(t)?.kind, "chooserSelectsTarget", "no choosePlayer step: the opponent is the one who played");
    assert.equal(pending(t)?.playerId, P1);
    assert.deepEqual(pickable(t), idsOf(t, ["foo-deck-p2"]));
    answerTargets(t, P1, [t.id("foo-deck-p2")]);
    assert.equal(pending(t)?.kind, "deployForFree");
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: t.id("foo-deck-p2") } } as never);
    settle(t);
    assert.equal(zoneOf(t, "foo-deck-p2"), "play");
    assert.equal(t.engine.state.cards[t.id("foo-deck-p2")]!.controllerId, P1, "under my control");
    assert.notEqual(zoneOf(t, "foo-hand-p2"), "play", "their card was terminated");
  });

  // The removed card belongs to P2 (its deck was searched), but P3 (or P4) playing a "Foo" sets the trigger off too: the card to reveal is the one
  // this card removed, whoever owns it.
  mpClause(MILKSHAKE, "0:rule", count, `${count} seats: another opponent playing a card with the same name sets it off with no opponent choice, and the card removed from the searched opponent's deck can be revealed`, () => {
    const t = milkshakeBoard(count);
    search(t, P2);
    const player = others(count, P1, P2)[0]!;
    playFoo(t, player);
    assert.equal(pending(t)?.kind, "chooserSelectsTarget", "the trigger fires for any opponent's card, with no choosePlayer step");
    assert.equal(pending(t)?.playerId, P1);
    assert.deepEqual(pickable(t), idsOf(t, ["foo-deck-p2"]), "the removed card (owned by P2) can be revealed");
    answerTargets(t, P1, [t.id("foo-deck-p2")]);
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: t.id("foo-deck-p2") } } as never);
    settle(t);
    assert.equal(zoneOf(t, "foo-deck-p2"), "play");
    assert.notEqual(zoneOf(t, `foo-hand-${player}`), "play", "their card was terminated");
  });
}

// =====================================================================================
// Mustache Aficionado
// =====================================================================================

// "Both players look at the top 3 cards of their deck ... Both players choose one of their opponent's piles": the controller and the one chosen opponent.
// The data names no opponent (partitionAndPick has no player field), so the engine asks for none and cannot run the showdown beyond two seats.
mpClause(MUSTACHE, "0:ability:mustache-showdown", 3, "3 seats: the opponent is chosen before the showdown, only you and that opponent split and pick piles, the other deck is untouched", () => {
  for (const chosen of others(3, P1)) {
    const t = table(3, [
      { key: "stache", def: printing(MUSTACHE), owner: P1, zone: "play" },
      ...seatsFor(3).flatMap((seat) => [1, 2, 3, 4].map((i) => ({ key: `k${i}-${seat}`, def: character({ name: `K${i} ${seat}`, cost: i + (seat === P1 ? 0 : 1) }), owner: seat, zone: "deck" as const })))
    ]);
    for (const seat of seatsFor(3)) t.engine.state.players[seat]!.deck = [1, 2, 3, 4].map((i) => t.id(`k${i}-${seat}`));
    const action = { type: "activateAbility", playerId: P1, cardId: t.id("stache"), abilityId: "mustache-showdown" } as const;
    assert.deepEqual(askedPlayers(t, action), others(3, P1), "the opponent is chosen with the activation");
    const bystander = others(3, P1, chosen)[0]!;
    const bystanderDeck = [...t.engine.state.players[bystander]!.deck];
    t.engine.perform({ ...action, players: { opponent: chosen } } as never);
    settle(t);
    // Each of the pair divides their own top 3 into two piles; P1's piles cost 1 and 5, the opponent's 2 and 7.
    const split = (who: PlayerId) => [[t.id(`k1-${who}`)], [t.id(`k2-${who}`), t.id(`k3-${who}`)]];
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "partitionCards", piles: split(P1) } });
    assert.equal(pending(t)?.kind, "partitionCards");
    assert.equal(pending(t)?.playerId, chosen, "the chosen opponent splits next, nobody else");
    t.engine.perform({ type: "resolvePendingChoice", playerId: chosen, choice: { kind: "partitionCards", piles: split(chosen) } });
    assert.equal(pending(t)?.kind, "pickPile");
    assert.equal(pending(t)?.playerId, P1);
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });
    assert.equal(pending(t)?.playerId, chosen);
    t.engine.perform({ type: "resolvePendingChoice", playerId: chosen, choice: { kind: "pickPile", index: 1 } });
    // P1's chosen pile (the opponent's [k1], cost 2) loses to the opponent's chosen pile (P1's [k2, k3], cost 5): P1 takes one card of it.
    assert.equal(pending(t)?.kind, "takeFromPile");
    assert.equal(pending(t)?.playerId, P1);
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "takeFromPile", cardIds: [t.id("k2-p1")] } });
    settle(t);
    assert.equal(zoneOf(t, "k2-p1"), "hand");
    assert.deepEqual(t.engine.state.players[bystander]!.deck, bystanderDeck, `${bystander}'s deck is untouched`);
    assert.equal(pending(t), undefined);
  }
});

// =====================================================================================
// Mistaken Identity
// =====================================================================================

/** "Hex": a tactic that picks a character as an extra cost and destroys it. */
const hex = () => tactic({ name: "Hex", behavior: { abilities: [{ id: "hex", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

for (const count of COUNTS) {
  mpClause(MISTAKEN_IDENTITY, "0:ability", count, `${count} seats: "your opponent had picked the other character": the player of the card answered, whoever it is, nobody is asked to choose`, () => {
    for (const caster of others(count, P1)) {
      const t = table(
        count,
        [
          { key: "mi", def: printing(MISTAKEN_IDENTITY), owner: P1, zone: "hand" },
          { key: "hex", def: hex(), owner: caster, zone: "hand" },
          ...resources("deception", 2),
          { key: "first", def: character({ name: "First" }), owner: P1, zone: "play" },
          { key: "other", def: character({ name: "Other" }), owner: others(count, P1, caster)[0]!, zone: "play" }
        ],
        { active: caster }
      );
      t.engine.perform({ type: "playCard", playerId: caster, cardId: t.id("hex"), selected: { t: [t.id("first")] } } as never);
      // The responders pass in turn until it is P1's turn to respond.
      for (let guard = 0; t.engine.state.responseWindow!.priorityPlayerId !== P1 && guard < 5; guard++) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
      const action = { type: "playCard", playerId: P1, cardId: t.id("mi"), selected: { other: [t.id("other")] } } as const;
      assert.equal(askedPlayers(t, action), undefined, "no opponent is asked for");
      t.engine.perform(action as never);
      assert.notEqual(pending(t)?.kind, "choosePlayer");
      settle(t);
      assert.equal(zoneOf(t, "other"), "discard", "the effect happened as though the card's player had picked the other character");
      assert.equal(zoneOf(t, "first"), "play");
    }
  });
}

// =====================================================================================
// Lucky Bastard
// =====================================================================================

mpClause(LUCKY_BASTARD, "0:rule", 3, "3 seats: when it enters play I draw a card; the opponents draw nothing", () => {
  const t = table(3, [
    { key: "lucky", def: printing(LUCKY_BASTARD), owner: P1, zone: "hand" },
    ...resources("deception", 7),
    ...seatsFor(3).flatMap((seat) => deckOf(`k-${seat}-`, 3, seat))
  ]);
  const before = Object.fromEntries(seatsFor(3).map((seat) => [seat, handSize(t, seat)]));
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("lucky") } as never);
  settle(t);
  assert.equal(pending(t), undefined, "nobody is asked for an opponent");
  assert.equal(handSize(t, P1), before[P1]! - 1 + 1, "played one card, drew one");
  for (const other of others(3, P1)) assert.equal(handSize(t, other), before[other]);
});

/** "Smite": a free tactic that destroys a chosen character. */
const smite = () => tactic({ name: "Smite", behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

for (const count of COUNTS) {
  mpClause(LUCKY_BASTARD, "1:rule", count, `${count} seats: "both players remove the top card of their deck": the opponent is chosen when the replacement applies, only you and that opponent remove a card, the choice is offered again at the next destruction`, () => {
    for (const chosen of others(count, P1)) {
      const rich = chosen === P2; // alternate which branch is tested: my card costs 5, theirs 2 (or the reverse)
      const t = table(count, [
        { key: "lucky", def: printing(LUCKY_BASTARD), owner: P1, zone: "play" },
        { key: "smite1", def: smite(), owner: P1, zone: "hand" },
        { key: "smite2", def: smite(), owner: P1, zone: "hand" },
        ...seatsFor(count).flatMap((seat) => [
          { key: `top-${seat}`, def: character({ name: `Top ${seat}`, cost: seat === P1 ? (rich ? 5 : 1) : rich ? 2 : 6 }), owner: seat, zone: "deck" as const },
          { key: `under-${seat}`, def: character({ name: `Under ${seat}`, cost: 0 }), owner: seat, zone: "deck" as const }
        ])
      ]);
      for (const seat of seatsFor(count)) {
        const deck = t.engine.state.players[seat]!.deck;
        t.engine.state.players[seat]!.deck = [t.id(`top-${seat}`), ...deck.filter((id) => id !== t.id(`top-${seat}`))];
      }
      const handBefore = handSize(t, P1);
      const smiteAction = { type: "playCard", playerId: P1, cardId: t.id("smite1"), selected: { t: [t.id("lucky")] } } as const;
      t.engine.perform(smiteAction as never);
      settle(t);
      assert.equal(pending(t)?.kind, "choosePlayer", "the opponent is chosen when the replacement applies");
      choosePlayer(t, P1, others(count, P1), chosen);
      settle(t);
      assert.equal(zoneOf(t, `top-${chosen}`), "removed", "the chosen opponent removes their top card");
      assert.equal(zoneOf(t, "top-p1"), "removed", "I remove mine");
      for (const other of others(count, P1, chosen)) assert.equal(zoneOf(t, `top-${other}`), "deck", `${other} removes nothing`);
      if (rich) {
        assert.equal(zoneOf(t, "lucky"), "play", "my card costs at least as much: it survives");
        assert.equal(handSize(t, P1), handBefore - 1 + 1, "and I draw a card (the Smite left my hand)");
        // The next destruction offers the choice again, now to a different opponent where there is one.
        const second = others(count, P1, chosen)[0] ?? chosen;
        t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("smite2"), selected: { t: [t.id("lucky")] } } as never);
        settle(t);
        assert.equal(pending(t)?.kind, "choosePlayer", "asked again");
        choosePlayer(t, P1, others(count, P1), second);
        settle(t);
        if (second !== chosen) assert.equal(zoneOf(t, `top-${second}`), "removed");
      } else {
        assert.equal(zoneOf(t, "lucky"), "removed", "their card costs more: Lucky Bastard is removed from the game");
      }
    }
  });
}

// =====================================================================================
// Spry Archer
// =====================================================================================

/** An archer ready to attack in P1's play, every seat with a character in play. */
function archerBoard(count: number, extra: CardPlacement[] = []) {
  return table(count, [
    { key: "archer", def: printing(SPRY_ARCHER), owner: P1, zone: "play" },
    ...perSeat(count, "c", "play", (seat) => character({ name: `Char ${seat}`, life: 5 })),
    ...extra
  ]);
}

for (const count of COUNTS) {
  mpClause(SPRY_ARCHER, "0:rule", count, `${count} seats: "inflict 1 damage to your opponent's faction": the defending player's faction, no opponent is chosen`, () => {
    for (const defender of others(count, P1)) {
      const t = archerBoard(count);
      const before = Object.fromEntries(seatsFor(count).map((seat) => [seat, t.engine.state.players[seat]!.influence]));
      assert.equal(askedPlayers(t, { type: "declareAttack", playerId: P1, attackerIds: [t.id("archer")] } as never), undefined);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("archer")], target: { type: "faction", playerId: defender } });
      settle(t);
      assert.notEqual(pending(t)?.kind, "choosePlayer", "no chooseOpponent step");
      assert.equal(before[defender]! - t.engine.state.players[defender]!.influence, 1, "the defender's faction takes 1 damage");
      for (const other of others(count, defender)) assert.equal(before[other]! - t.engine.state.players[other]!.influence, 0, `${other}'s faction takes none`);
    }
  });

  mpClause(SPRY_ARCHER, "1:rule@rrrr", count, `${count} seats: with [R][R][R][R] I may pick any character (any player's) to take 1 damage, with no opponent choice`, () => {
    const t = archerBoard(count, resources("rage", 4));
    t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("archer")], target: { type: "faction", playerId: P2 } });
    settle(t);
    // Two of my triggers at once (the faction damage and the pick): I order them.
    for (let guard = 0; pending(t)?.kind === "orderTriggers" && guard < 4; guard++) {
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: (pending(t)!.triggers as never[])[0] } });
      settle(t);
    }
    assert.ok(pending(t), "the optional pick is offered");
    assert.notEqual(pending(t)?.kind, "choosePlayer");
    assert.equal(pending(t)?.playerId, P1);
    const shot = t.id(`c-${others(count, P1, P2)[0]!}`);
    if (pending(t)!.kind === "selectTargets") t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: Object.fromEntries(((pending(t)!.declarations as Array<{ id: string }>) ?? []).map((d) => [d.id, [shot]])) } });
    else answerTargets(t, P1, [shot]);
    settle(t);
    assert.equal(t.engine.state.cards[shot]!.damage, 1, "1 damage to the picked character");
    for (const seat of seatsFor(count)) if (t.id(`c-${seat}`) !== shot) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.damage, 0);
  });
}
