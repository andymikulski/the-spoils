// Batch r07-zones-actions, part 3 (docs/TESTING.md): CR 312 Search, CR 313 Shuffle, CR 314 Terminate.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardType, Effect, GameEvent, SpoilsEngine, Zone } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule, ruleOpen } from "./_rule.js";

const pick = (id: string) => ({ type: "selected" as const, id });

/** A zero-cost tactic whose single ability runs `effects`. */
const spell = (name: string, effects: Effect[]): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", effects }] } });

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const events = (engine: SpoilsEngine, type: GameEvent["type"]) =>
  engine.getLog().filter(entry => entry.event?.type === type).map(entry => entry.event!);
const shuffles = (engine: SpoilsEngine) => events(engine, "deckShuffled") as Array<{ type: "deckShuffled"; playerId: string }>;
const answer = (engine: SpoilsEngine, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);

/** A small deterministic stream so shuffles are reproducible. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` named characters in `owner`'s deck, `${prefix}0` on top. */
const deckOf = (n: number, owner = P1, prefix = "d"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

/** `n` named tactics in `owner`'s deck. */
const tacticsIn = (n: number, owner = P1, prefix = "t"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: tactic({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

/**
 * "Search a deck for a card [of `type`] and put it into your hand." The pick is optional when `optional` is set
 * ("you may search"; a typed search can always fail). No shuffle is authored: the engine owes the shuffle.
 */
const tutor = (options: { optional: boolean; type?: CardType; owner?: "self" | "opponent"; zone?: Zone }): CardDefinition =>
  spell("Tutor", [
    {
      type: "chooserSelectsTarget",
      chooser: "controller",
      declaration: {
        id: "found",
        selector: { owner: options.owner ?? "self", zone: options.zone ?? "deck", ...(options.type ? { type: options.type } : {}) },
        count: 1,
        optional: options.optional
      },
      effects: [{ type: "moveCard", target: pick("found"), to: "hand", toPlayer: "controller" }]
    }
  ]);

const play = (built: ReturnType<typeof buildGame>, key: string, player = P1) => {
  built.engine.perform({ type: "playCard", playerId: player, cardId: built.id(key) });
  resolvePendingResponses(built.engine);
};

const deckNames = (engine: SpoilsEngine, player: string) => engine.state.players[player]!.deck.map(cardId => engine.getDefinition(cardId).name);

describe("CR 312 — search", () => {
  rule("CR 312.1", "a searched deck is shuffled afterwards: one shuffle for the searcher, after the found card moved", () => {
    const built = buildGame({
      random: mulberry(11),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "tactic" }), owner: P1, zone: "hand" }, ...tacticsIn(1), ...deckOf(7)]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the searcher is asked what to find");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("t0")] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("t0")), "hand", "the card was found");
    const found = shuffles(engine);
    assert.equal(found.length, 1, "the deck was shuffled once");
    assert.equal(found[0]!.playerId, P1, "the searched deck is shuffled");
    const log = engine.getLog();
    const movedAt = log.findIndex(entry => entry.event?.type === "cardMoved" && (entry.event as { cardId: string }).cardId === id("t0"));
    const shuffledAt = log.findIndex(entry => entry.event?.type === "deckShuffled");
    assert.ok(movedAt >= 0 && shuffledAt > movedAt, "the shuffle came after the card was taken");
    assert.equal(engine.state.players[P1].deck.length, 7, "the other seven cards are all still in the deck");
  });

  rule("CR 312.1", "the shuffle after a search really reorders the deck (same cards, new order for this seed)", () => {
    const built = buildGame({
      random: mulberry(5),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "tactic" }), owner: P1, zone: "hand" }, ...tacticsIn(1), ...deckOf(9)]
    });
    const { engine, id } = built;
    const orderBefore = engine.state.players[P1].deck.filter(cardId => cardId !== id("t0"));
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("t0")] });
    resolvePendingResponses(engine);
    const orderAfter = engine.state.players[P1].deck;
    assert.deepEqual([...orderAfter].sort(), [...orderBefore].sort(), "the same nine cards");
    assert.notDeepEqual(orderAfter, orderBefore, "in a different order");
  });

  rule("CR 312.1", "a search that finds nothing to pick (no matching card in the deck) still shuffles the deck", () => {
    const built = buildGame({
      random: mulberry(3),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "tactic" }), owner: P1, zone: "hand" }, ...deckOf(6)]
    });
    play(built, "tutor");
    assert.equal(built.engine.state.pendingChoice, undefined, "nothing to find, so nothing to ask");
    assert.equal(shuffles(built.engine).length, 1, "the deck was searched, so it is shuffled");
    assert.equal(built.engine.state.players[P1].deck.length, 6, "no card left the deck");
  });

  rule("CR 312.1", "searching the OPPONENT's deck shuffles the opponent's deck (its owner), not the searcher's", () => {
    const built = buildGame({
      random: mulberry(9),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "tactic", owner: "opponent" }), owner: P1, zone: "hand" }, ...tacticsIn(1, P2, "o"), ...deckOf(4, P2, "p"), ...deckOf(4)]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("o0")] });
    resolvePendingResponses(engine);
    const found = shuffles(engine);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.playerId, P2, "it is the searched deck's owner whose deck is shuffled");
  });

  rule("CR 312.1", "looking into a zone other than a deck (the discard pile) is not a search: no shuffle", () => {
    const built = buildGame({
      random: mulberry(2),
      cards: [
        { key: "tutor", def: tutor({ optional: false, zone: "discard" }), owner: P1, zone: "hand" },
        { key: "old", def: character({ name: "Old" }), owner: P1, zone: "discard" },
        ...deckOf(3)
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("old")] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("old")), "hand", "the card was taken from the discard pile");
    assert.equal(shuffles(engine).length, 0, "no deck was searched, none shuffled");
  });

  rule("CR 312.1", "a 'you may search' that the player declines is no search at all, so no shuffle (ruling Q2)", () => {
    const built = buildGame({
      random: mulberry(4),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "tactic" }), owner: P1, zone: "hand" }, ...tacticsIn(1), ...deckOf(4)]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [], declined: true });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("t0")), "deck", "nothing was taken");
    assert.equal(shuffles(engine).length, 0, "a declined search does not shuffle");
  });

  rule("CR 312.2", "example: 'search for an item' with no item in the deck fails, and the deck is still shuffled", () => {
    const built = buildGame({
      random: mulberry(6),
      cards: [{ key: "tutor", def: tutor({ optional: true, type: "item" }), owner: P1, zone: "hand" }, ...deckOf(5)]
    });
    play(built, "tutor");
    assert.equal(built.engine.state.pendingChoice, undefined, "no item to find");
    assert.equal(built.engine.state.players[P1].deck.length, 5);
    assert.equal(built.engine.state.players[P1].hand.length, 0, "the spell was the only card, nothing was found");
    assert.equal(shuffles(built.engine).length, 1);
  });

  rule("CR 312.2", "example: 'search for an item' with an item in the deck may still fail by choice", () => {
    const built = buildGame({
      random: mulberry(6),
      cards: [
        { key: "tutor", def: tutor({ optional: true, type: "item" }), owner: P1, zone: "hand" },
        { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "deck" },
        ...deckOf(5)
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "an item is available to find");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("gizmo")), "deck", "the player chose to fail: the item stays in the deck");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(shuffles(engine).length, 1, "a failed search still shuffles the deck");
  });

  rule("CR 312.2", "example: 'search for an item' finds the item when the player chooses to (control for the failure)", () => {
    const built = buildGame({
      random: mulberry(6),
      cards: [
        { key: "tutor", def: tutor({ optional: true, type: "item" }), owner: P1, zone: "hand" },
        { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "deck" },
        ...deckOf(5)
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tutor") });
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("gizmo")] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("gizmo")), "hand");
  });

  rule("CR 312.2", "example: 'search your deck for a card' must find a card: choosing nothing is refused while the deck has cards", () => {
    const make = () =>
      buildGame({ random: mulberry(8), cards: [{ key: "tutor", def: tutor({ optional: false }), owner: P1, zone: "hand" }, ...deckOf(3)] });
    const control = make();
    control.engine.perform({ type: "playCard", playerId: P1, cardId: control.id("tutor") });
    resolvePendingResponses(control.engine);
    answer(control.engine, P1, { kind: "chooserSelectsTarget", selected: [control.id("d1")] });
    resolvePendingResponses(control.engine);
    assert.equal(zone(control.engine, control.id("d1")), "hand", "control: finding a card works");
    const built = make();
    built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("tutor") });
    resolvePendingResponses(built.engine);
    refused(() => answer(built.engine, P1, { kind: "chooserSelectsTarget", selected: [] }), "fail an unrestricted search of a non-empty deck");
    assert.equal(built.engine.state.players[P1].deck.length, 3, "nothing moved");
    assert.equal(built.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the search is still waiting for a card");
  });

  rule("CR 312.2", "example: 'search your deck for a card' with an empty deck: nothing to find, no prompt, no error", () => {
    const built = buildGame({ random: mulberry(8), cards: [{ key: "tutor", def: tutor({ optional: false }), owner: P1, zone: "hand" }] });
    play(built, "tutor");
    assert.equal(built.engine.state.pendingChoice, undefined, "no prompt for an empty deck");
    assert.equal(zone(built.engine, built.id("tutor")), "discard", "the card resolved");
  });
});

describe("CR 313 — shuffle", () => {
  const reshuffle = (player: "controller" | "opponent" = "controller") => spell("Reshuffle", [{ type: "shuffleDeck", player }]);

  rule("CR 313.1", "shuffling randomizes the deck: same cards, different order, and a shuffle is recorded", () => {
    const built = buildGame({ random: mulberry(21), cards: [{ key: "s", def: reshuffle(), owner: P1, zone: "hand" }, ...deckOf(12)] });
    const { engine } = built;
    const before = [...engine.state.players[P1].deck];
    play(built, "s");
    const after = engine.state.players[P1].deck;
    assert.deepEqual([...after].sort(), [...before].sort(), "no card gained or lost");
    assert.notDeepEqual(after, before, "the order changed");
    assert.equal(shuffles(engine).length, 1);
  });

  rule("CR 313.1", "a shuffle is not one fixed permutation: different random streams give different orders", () => {
    const run = (seed: number) => {
      const built = buildGame({ random: mulberry(seed), cards: [{ key: "s", def: reshuffle(), owner: P1, zone: "hand" }, ...deckOf(12)] });
      play(built, "s");
      return deckNames(built.engine, P1).join(",");
    };
    const orders = new Set([run(1), run(2), run(3), run(4)]);
    assert.ok(orders.size >= 3, `four seeds gave ${orders.size} distinct orders; a shuffle must sufficiently randomize`);
  });

  rule("CR 313.1", "shuffling one deck leaves the other deck, both hands and the discard piles untouched", () => {
    const built = buildGame({
      random: mulberry(21),
      cards: [{ key: "s", def: reshuffle(), owner: P1, zone: "hand" }, ...deckOf(8), ...deckOf(8, P2, "o"), { key: "gone", def: character({ name: "Gone" }), owner: P1, zone: "discard" }]
    });
    const { engine } = built;
    const theirs = [...engine.state.players[P2].deck];
    play(built, "s");
    assert.deepEqual(engine.state.players[P2].deck, theirs, "the opponent's deck order is unchanged");
    assert.deepEqual(engine.state.players[P1].discard.includes(built.id("gone")), true);
  });

  rule("CR 313.1", "the shuffle instruction can name the opponent's deck: only that deck is shuffled", () => {
    const built = buildGame({
      random: mulberry(21),
      cards: [{ key: "s", def: reshuffle("opponent"), owner: P1, zone: "hand" }, ...deckOf(8), ...deckOf(12, P2, "o")]
    });
    const { engine } = built;
    const mine = [...engine.state.players[P1].deck];
    const theirs = [...engine.state.players[P2].deck];
    play(built, "s");
    assert.deepEqual(engine.state.players[P1].deck, mine, "my deck is unchanged");
    assert.notDeepEqual(engine.state.players[P2].deck, theirs, "their deck was reordered");
    assert.equal(shuffles(engine)[0]!.playerId, P2);
  });

  /** "Shuffle your discarded tactics into your deck": moves N cards, then shuffles. */
  const shuffleIn = () =>
    spell("Recycle", [
      { type: "forEach", selector: { zone: "discard", owner: "self", type: "tactic" }, effects: [{ type: "moveCard", target: pick("__candidate"), to: "deck" }] },
      { type: "shuffleDeck", player: "controller" }
    ]);
  const discardedTactics = (n: number): CardPlacement[] =>
    Array.from({ length: n }, (_, i) => ({ key: `old${i}`, def: tactic({ name: `Old${i}` }), owner: P1, zone: "discard" as const }));

  rule("CR 313.2", "shuffling 0 cards into a deck performs no shuffle: the deck keeps its order", () => {
    const built = buildGame({ random: mulberry(30), cards: [{ key: "s", def: shuffleIn(), owner: P1, zone: "hand" }, ...deckOf(10)] });
    const { engine } = built;
    const before = [...engine.state.players[P1].deck];
    play(built, "s");
    assert.equal(shuffles(engine).length, 0, "no shuffle happened");
    assert.deepEqual(engine.state.players[P1].deck, before, "the deck is exactly as it was");
  });

  rule("CR 313.2", "shuffling 1 card into a deck does shuffle it", () => {
    const built = buildGame({ random: mulberry(30), cards: [{ key: "s", def: shuffleIn(), owner: P1, zone: "hand" }, ...discardedTactics(1), ...deckOf(10)] });
    play(built, "s");
    assert.equal(zone(built.engine, built.id("old0")), "deck", "the card was added");
    assert.equal(built.engine.state.players[P1].deck.length, 11);
    assert.equal(shuffles(built.engine).length, 1, "and the deck was shuffled");
  });

  rule("CR 313.2", "shuffling 3 cards into a deck shuffles once", () => {
    const built = buildGame({ random: mulberry(30), cards: [{ key: "s", def: shuffleIn(), owner: P1, zone: "hand" }, ...discardedTactics(3), ...deckOf(10)] });
    play(built, "s");
    assert.equal(built.engine.state.players[P1].deck.length, 13);
    assert.equal(shuffles(built.engine).length, 1, "one shuffle for the group");
  });

  /** "Reveal cards until a tactic; shuffle the other revealed cards into your deck" (the rest default is shuffle). */
  const surprise = () =>
    spell("Surprise", [
      {
        type: "revealFromTopUntil",
        player: "controller",
        match: { type: "cardTypeIs", target: pick("__candidate"), cardType: "tactic" },
        bindAs: "hit",
        onMatch: [{ type: "moveCard", target: pick("hit"), to: "hand" }]
      }
    ]);

  rule("CR 313.2", "revealed cards shuffled back: with other revealed cards the deck is shuffled", () => {
    const built = buildGame({
      random: mulberry(12),
      cards: [{ key: "s", def: surprise(), owner: P1, zone: "hand" }, ...deckOf(2), ...tacticsIn(1), ...deckOf(5, P1, "e")]
    });
    play(built, "s");
    assert.equal(zone(built.engine, built.id("t0")), "hand", "the tactic was found");
    assert.equal(shuffles(built.engine).length, 1, "the 2 other revealed cards were shuffled into the deck");
  });

  rule("CR 313.2", "when the match is the first card there are no other revealed cards, so nothing is shuffled", () => {
    const built = buildGame({
      random: mulberry(12),
      cards: [{ key: "s", def: surprise(), owner: P1, zone: "hand" }, ...tacticsIn(1), ...deckOf(5)]
    });
    const before = built.engine.state.players[P1].deck.filter(cardId => cardId !== built.id("t0"));
    play(built, "s");
    assert.equal(zone(built.engine, built.id("t0")), "hand");
    assert.equal(shuffles(built.engine).length, 0, "0 cards were shuffled in: no shuffle");
    assert.deepEqual(built.engine.state.players[P1].deck, before, "the rest of the deck kept its order");
  });
});

describe("CR 314 — terminate", () => {
  /** A tactic that costs the opponent 2 influence and gives its controller 3 (two effects). */
  const strike = (name = "Strike"): CardDefinition =>
    spell(name, [
      { type: "modifyInfluence", player: "opponent", amount: -2 },
      { type: "modifyInfluence", player: "controller", amount: 3 }
    ]);
  const cancelCard = (): CardDefinition => spell("Cancel", [{ type: "terminate", target: "respondedToCard" }]);
  const cancelItem = (): CardDefinition => spell("CancelItem", [{ type: "terminate", scope: "respondedItem" }]);

  /** P1 plays `strike`; P2 responds with `answerKey`; everything is settled. */
  function duel(built: ReturnType<typeof buildGame>, answerKey: string | undefined): void {
    built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("strike") });
    if (answerKey) built.engine.perform({ type: "playCard", playerId: P2, cardId: built.id(answerKey) });
    resolvePendingResponses(built.engine);
  }

  rule("CR 314.1", "control: an unanswered tactic resolves and both of its effects happen", () => {
    const built = buildGame({ cards: [{ key: "strike", def: strike(), owner: P1, zone: "hand" }] });
    duel(built, undefined);
    assert.equal(built.engine.state.players[P2].influence, 23);
    assert.equal(built.engine.state.players[P1].influence, 28);
  });

  rule("CR 314.1", "terminating a tactic stops it before it resolves and puts it into its owner's discard pile", () => {
    const built = buildGame({
      cards: [
        { key: "strike", def: strike(), owner: P1, zone: "hand" },
        { key: "cancel", def: cancelCard(), owner: P2, zone: "hand" }
      ]
    });
    duel(built, "cancel");
    const { engine, id } = built;
    assert.equal(zone(engine, id("strike")), "discard", "the terminated card is in the discard pile");
    assert.ok(engine.state.players[P1].discard.includes(id("strike")), "its owner's pile");
    assert.equal(engine.state.players[P2].influence, 25, "its first effect never happened");
    assert.equal(engine.state.players[P1].influence, 25, "and nor did its second: all its instructions ceased");
    assert.equal(zone(engine, id("cancel")), "discard", "the terminator itself resolved normally");
    assert.equal(engine.state.responseStack.length, 0);
  });

  rule("CR 314.1", "terminating by 'the newest item on the stack' works the same way", () => {
    const built = buildGame({
      cards: [
        { key: "strike", def: strike(), owner: P1, zone: "hand" },
        { key: "cancel", def: cancelItem(), owner: P2, zone: "hand" }
      ]
    });
    duel(built, "cancel");
    assert.equal(zone(built.engine, built.id("strike")), "discard");
    assert.equal(built.engine.state.players[P2].influence, 25, "no effect happened");
  });

  /** A character whose ability does two things. */
  const worker = (): CardDefinition =>
    character({
      name: "Worker",
      behavior: {
        abilities: [
          {
            id: "work",
            type: "activated",
            effects: [
              { type: "modifyInfluence", player: "opponent", amount: -2 },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

  rule(["CR 314.1", "CR 314.2"], "terminating an ability (an effect on the stack) stops it: none of its instructions happen and its source stays where it is", () => {
    const built = buildGame({
      cards: [
        { key: "worker", def: worker(), owner: P1 },
        { key: "d0", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "cancel", def: cancelItem(), owner: P2, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("worker"), abilityId: "work" });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("cancel") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, 25, "the ability's damage never happened");
    assert.equal(zone(engine, id("d0")), "deck", "and its draw never happened");
    assert.equal(zone(engine, id("worker")), "play", "only an ability was stopped: its source card stays in play");
    assert.equal(engine.state.responseStack.length, 0);
  });

  rule("CR 314.1", "control: the same ability, unanswered, does both things", () => {
    const built = buildGame({
      cards: [{ key: "worker", def: worker(), owner: P1 }, { key: "d0", def: character({ name: "Top" }), owner: P1, zone: "deck" }]
    });
    const { engine, id } = built;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("worker"), abilityId: "work" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, 23);
    assert.equal(zone(engine, id("d0")), "hand");
  });

  ruleOpen("CR 314.2", "RQ-r07-1", "terminating a resolved tactic whose lasting effect is still in force (+2 strength this turn) ends that effect", () => {
    const buff = tactic({
      name: "Buff",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "createModifier", target: pick("t"), stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const undo = spell("Undo", [{ type: "terminate", target: pick("old") }]);
    (undo.behavior!.abilities![0] as { targets?: unknown }).targets = [{ id: "old", selector: { zone: "discard", name: "Buff" }, count: 1 }];
    const built = buildGame({
      cards: [
        { key: "buff", def: buff, owner: P1, zone: "hand" },
        { key: "undo", def: undo, owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 1 }), owner: P1 }
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("buff"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("c"), "strength"), 3, "the effect is in force");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("undo"), selected: { old: [id("buff")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("c"), "strength"), 1, "terminating the effect ended its impact");
  });
});
