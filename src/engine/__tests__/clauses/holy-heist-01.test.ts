// Clause tests — batch holy-heist-01. See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-01`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { endTurn, developResource, developResources } from "./_turn.js";

// --- shared helpers (this file only) ---------------------------------------

const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const ready = (engine: SpoilsEngine, player: PlayerId) => engine.getAvailableResourceCount(player);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters.token ?? 0;
const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;

/** Answers the open pending choice (asserting its kind and who must answer it), then drains response windows. */
function answerChoice(engine: SpoilsEngine, kind: string, playerId: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}`);
  assert.equal(pc.kind, kind, `pending choice kind`);
  assert.equal(pc.playerId, playerId, `${kind} must be answered by ${playerId}`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
  resolvePendingResponses(engine);
}

/** `n` vanilla cards in `owner`'s deck, keyed `<prefix>0..n-1`, top of deck first. */
function deckCards(prefix: string, n: number, owner: PlayerId) {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: character({ name: `${prefix.toUpperCase()}${i}` }),
    owner,
    zone: "deck" as const
  }));
}

/** `n` vanilla cards in `owner`'s hand, keyed `<prefix>0..n-1`. */
function handCards(prefix: string, n: number, owner: PlayerId) {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: character({ name: `${prefix.toUpperCase()}${i}` }),
    owner,
    zone: "hand" as const
  }));
}

// --- Additional Tribute ------------------------------------------------------
// EXTRA COST: Deploy this only in response to a non-tactic card being deployed.
// If you control [V][V][V], you may look at the top card of your deck. If you do,
// you may put it on the bottom.
// Any opponent may pay 1. If they do, draw a card and terminate this card.
// Otherwise, terminate the non-tactic card being deployed.

const TRIBUTE = "a64326fe-e6a2-4398-ad70-88e4584fb7af";

/**
 * P2 (active) is deploying `foe`; P1 holds Additional Tribute. The foe card has
 * been played, so P1 may respond. Returns before P1 does anything.
 */
function tributeBoard(
  opts: {
    foe?: CardDefinition;
    p1Obsession?: number;
    p1Volition?: number;
    p2Resources?: number;
    p2Volition?: number;
  } = {}
) {
  const foe = opts.foe ?? character({ name: "Foe", cost: 0 });
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
      { key: "foe", def: foe, owner: P2, zone: "hand" },
      ...bank("obsession", opts.p1Obsession ?? 4, P1),
      ...volition(opts.p1Volition ?? 0, P1),
      ...bank("rage", opts.p2Resources ?? 3, P2),
      ...volition(opts.p2Volition ?? 0, P2),
      ...deckCards("a", 4, P1),
      ...deckCards("z", 4, P2)
    ]
  });
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("foe"), selected: {} } as never);
  return game;
}

/** P1 responds with Additional Tribute and the stack unwinds until the first pending choice (or the end). */
function respondWithTribute(game: ReturnType<typeof tributeBoard>) {
  game.engine.perform({ type: "playCard", playerId: P1, cardId: game.id("at"), selected: {} } as never);
  resolvePendingResponses(game.engine);
}

clause(TRIBUTE, "0:extraCost", "can be deployed in response to a character, item or location being deployed", () => {
  const foes: CardDefinition[] = [
    character({ name: "Foe", cost: 0 }),
    item({ name: "Foe", cost: 0 }),
    location({ name: "Foe", cost: 0, structure: 2 })
  ];
  for (const foe of foes) {
    const game = tributeBoard({ foe });
    assert.equal(game.engine.getCardPlayability(P1, game.id("at")).legalTiming, true, `a ${foe.type} is being deployed`);
    respondWithTribute(game);
    drain(game.engine, declineAll);
    assert.equal(zoneOf(game.engine, game.id("at")), "discard", `Additional Tribute resolved (${foe.type})`);
    assert.equal(zoneOf(game.engine, game.id("foe")), "discard", `the ${foe.type} was terminated`);
  }
});

clause(TRIBUTE, "0:extraCost", "cannot be deployed when nothing is being deployed (own turn, no response window)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1)]
  });
  assert.equal(engine.getCardPlayability(P1, id("at")).legalTiming, false);
  assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("at"), selected: {} } as never));
  assert.equal(zoneOf(engine, id("at")), "hand");
});

clause(TRIBUTE, "0:extraCost", "cannot be deployed in response to a tactic being deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
      { key: "t", def: tactic({ name: "Foe Tactic", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("t"), selected: {} } as never);
  assert.ok(engine.state.responseWindow, "the opponent's tactic is on the stack");
  assert.equal(engine.getCardPlayability(P1, id("at")).legalTiming, false);
  assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("at"), selected: {} } as never));
  assert.equal(zoneOf(engine, id("at")), "hand");
});

clause(TRIBUTE, "0:extraCost", "cannot be deployed in response to an ability, or to the opponent ending their turn", () => {
  const useless = character({
    name: "Worker",
    behavior: { abilities: [{ id: "work", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const base = () =>
    buildGame({
      playerA: { faction: developFaction() },
      activePlayerId: P2,
      cards: [
        { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
        { key: "w", def: useless, owner: P2, zone: "play" },
        ...bank("obsession", 4, P1),
        ...deckCards("z", 2, P2)
      ]
    });

  const abilityGame = base();
  activateWithoutResolving(abilityGame.engine, P2, abilityGame.id("w"), "work");
  assert.ok(abilityGame.engine.state.responseWindow, "the ability is on the stack");
  const abilityPlayability = abilityGame.engine.getCardPlayability(P1, abilityGame.id("at"));
  assert.equal(abilityPlayability.thresholdMet && abilityPlayability.availableResources >= 2, true, "only the timing is wrong");
  assert.equal(abilityPlayability.legalTiming, false);
  assert.throws(() =>
    abilityGame.engine.perform({ type: "playCard", playerId: P1, cardId: abilityGame.id("at"), selected: {} } as never)
  );

  const endTurnGame = base();
  endTurnGame.engine.perform({ type: "endTurn", playerId: P2 } as never);
  assert.ok(endTurnGame.engine.state.responseWindow, "the opponent is ending their turn");
  assert.equal(endTurnGame.engine.getCardPlayability(P1, endTurnGame.id("at")).legalTiming, false);
  assert.throws(() =>
    endTurnGame.engine.perform({ type: "playCard", playerId: P1, cardId: endTurnGame.id("at"), selected: {} } as never)
  );
});

/** Raw `playCard` without draining the response window (the harness `play` drains it). */
function playRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}
): void {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

function activateWithoutResolving(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: {}, variables: {} } as never);
}

clause(TRIBUTE, "0:extraCost", "costs 2 (paid on deploy) and needs [O]; refused one resource short or without the threshold", () => {
  const game = tributeBoard({ p1Obsession: 4 });
  game.engine.perform({ type: "playCard", playerId: P1, cardId: game.id("at"), selected: {} } as never);
  assert.equal(ready(game.engine, P1), 2, "exactly 2 of the 4 ready resources were paid");

  const short = tributeBoard({ p1Obsession: 1 });
  assert.throws(() => short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("at"), selected: {} } as never));
  assert.equal(zoneOf(short.engine, short.id("at")), "hand");

  const exact = tributeBoard({ p1Obsession: 2 });
  exact.engine.perform({ type: "playCard", playerId: P1, cardId: exact.id("at"), selected: {} } as never);
  assert.equal(ready(exact.engine, P1), 0, "2 resources is exactly enough");

  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("rage", 4, P1)
    ]
  });
  noThreshold.engine.perform({ type: "playCard", playerId: P2, cardId: noThreshold.id("foe"), selected: {} } as never);
  assert.throws(() =>
    noThreshold.engine.perform({ type: "playCard", playerId: P1, cardId: noThreshold.id("at"), selected: {} } as never)
  );
});

clause(TRIBUTE, "2:rule", "if the opponent declines to pay 1, the non-tactic card being deployed is terminated (to its owner's discard)", () => {
  const game = tributeBoard();
  const oppBefore = ready(game.engine, P2);
  const handBefore = handOf(game.engine, P1).length;
  respondWithTribute(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "mayPay", "the opponent is offered the payment");
  assert.equal(pc?.playerId, P2, "the OPPONENT decides, not the Additional Tribute's controller");
  assert.equal(zoneOf(game.engine, game.id("foe")), "deploying", "still being deployed until the opponent decides");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "terminated: the deployed card goes to its owner's discard pile");
  assert.equal(game.engine.state.cards[game.id("foe")].ownerId, P2);
  assert.equal(zoneOf(game.engine, game.id("at")), "discard", "the tactic itself is spent");
  assert.equal(ready(game.engine, P2), oppBefore, "the opponent paid nothing");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "no card drawn (only Additional Tribute left the hand)");
});

clause(TRIBUTE, "2:rule", "if the opponent pays 1, the controller draws a card, this card is terminated and the deployed card still resolves", () => {
  const game = tributeBoard();
  const oppBefore = ready(game.engine, P2);
  const p1HandBefore = handOf(game.engine, P1).length;
  const p2HandBefore = handOf(game.engine, P2).length;
  const p1DeckTop = deckOf(game.engine, P1)[0];
  respondWithTribute(game);
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(ready(game.engine, P2), oppBefore - 1, "the opponent actually paid 1");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play", "the non-tactic card was NOT terminated");
  assert.equal(zoneOf(game.engine, game.id("at")), "discard", "Additional Tribute is terminated");
  assert.equal(handOf(game.engine, P1).length, p1HandBefore - 1 + 1, "controller drew a card (-1 for playing the tactic, +1 drawn)");
  assert.equal(zoneOf(game.engine, p1DeckTop), "hand", "the card drawn is the top of the controller's deck");
  assert.equal(handOf(game.engine, P2).length, p2HandBefore, "the paying opponent drew nothing");
});

clause(TRIBUTE, "2:rule", "an opponent with no resource to pay is not offered the payment: the deployed card is terminated", () => {
  const game = tributeBoard({ p2Resources: 0 });
  respondWithTribute(game);
  // Either the choice is never opened, or it can't be accepted; in both cases the card is terminated.
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
});

clause(TRIBUTE, "1:rule", "with [V][V][V] the controller may look at the top card and put it on the bottom", () => {
  const game = tributeBoard({ p1Volition: 3 });
  const top = deckOf(game.engine, P1)[0];
  const size = deckOf(game.engine, P1).length;
  respondWithTribute(game);
  const pc = pending(game.engine) as PendingChoiceLike & { optionCount: number };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the controller decides");
  answerChoice(game.engine, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  const deck = deckOf(game.engine, P1);
  assert.equal(deck.length, size, "no card left the deck");
  assert.equal(deck[deck.length - 1], top, "the looked-at top card is now on the bottom");
  assert.notEqual(deck[0], top);
});

clause(TRIBUTE, "1:rule", "with [V][V][V] the controller may decline to bottom it: the top card stays on top", () => {
  const game = tributeBoard({ p1Volition: 3 });
  const before = [...deckOf(game.engine, P1)];
  respondWithTribute(game);
  answerChoice(game.engine, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 0 });
  assert.deepEqual(deckOf(game.engine, P1), before, "the deck is untouched");
});

clause(TRIBUTE, "1:rule", "does nothing without [V][V][V] (two face-down resources; opponent's Volition does not count)", () => {
  const game = tributeBoard({ p1Volition: 2, p2Volition: 4 });
  const before = [...deckOf(game.engine, P1)];
  respondWithTribute(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "mayPay", "straight to the opponent's payment: no look-at-the-top choice was offered");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  // The deck only lost the card drawn from the top by the "pay" branch; nothing was moved to the bottom.
  assert.deepEqual(deckOf(game.engine, P1), before.slice(1));
});

clause(TRIBUTE, "1:rule", "also works with more than three face-down resources ([V][V][V] is a minimum)", () => {
  const game = tributeBoard({ p1Volition: 4 });
  respondWithTribute(game);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsOption");
});

clause(TRIBUTE, "1:rule", "face-up resources are not [V]: five face-up Obsession resources do not offer the look", () => {
  const game = tributeBoard({ p1Obsession: 5, p1Volition: 0 });
  respondWithTribute(game);
  assert.equal(pending(game.engine)?.kind, "mayPay", "no look-at-the-top choice");
});

clause(TRIBUTE, "1:rule", "the look happens before the opponent's payment: bottoming the top card means the paid-for draw takes the NEXT card", () => {
  const game = tributeBoard({ p1Volition: 3 });
  const [first, second] = deckOf(game.engine, P1);
  respondWithTribute(game);
  answerChoice(game.engine, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(zoneOf(game.engine, second), "hand", "the card drawn is the one that was second");
  assert.equal(zoneOf(game.engine, first), "deck", "the bottomed card was not drawn");
  const deck = deckOf(game.engine, P1);
  assert.equal(deck[deck.length - 1], first);
});

clause(TRIBUTE, "1:rule", "the look applies in both branches: with [V][V][V] and an opponent who declines, the top card is still bottomed", () => {
  const game = tributeBoard({ p1Volition: 3 });
  const first = deckOf(game.engine, P1)[0];
  respondWithTribute(game);
  answerChoice(game.engine, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  const deck = deckOf(game.engine, P1);
  assert.equal(deck[deck.length - 1], first);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
});

clause(TRIBUTE, "2:rule", "an opponent with exactly 1 ready resource can pay it", () => {
  const game = tributeBoard({ p2Resources: 1 });
  respondWithTribute(game);
  assert.equal(pending(game.engine)?.kind, "mayPay");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(ready(game.engine, P2), 0);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

clause(TRIBUTE, "2:rule", "a terminated item or location also goes to its owner's discard pile", () => {
  for (const foe of [item({ name: "Foe", cost: 0 }), location({ name: "Foe", cost: 0, structure: 2 })]) {
    const game = tributeBoard({ foe });
    respondWithTribute(game);
    answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
    assert.equal(zoneOf(game.engine, game.id("foe")), "discard", foe.type);
    assert.ok(game.engine.state.players[P2].discard.includes(game.id("foe")), `${foe.type} is in the OPPONENT's discard pile`);
  }
});

// --- Bewilderbeast -----------------------------------------------------------
// When an opponent discards any number of cards, this card gains X strength and
// X life this turn, where X is the number of cards discarded.

const BEAST = "61af506c-d6e4-4b48-aa10-e959b670aaa3";

/** An item whose ability makes a player discard `count` cards of their own choice (synthetic source of real discards). */
function discarder(count: number, victim: "opponent" | "self"): CardDefinition {
  return item({
    name: `Discarder-${victim}-${count}`,
    behavior: {
      abilities: [
        {
          id: "discard",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: victim === "opponent" ? "opponent" : "controller",
              declaration: { id: "d", selector: { controller: victim === "opponent" ? "opponent" : "self", zone: "hand" }, count },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
            }
          ]
        }
      ]
    }
  });
}

/** An item whose ability moves `count` cards of the opponent's hand to the BOTTOM OF THEIR DECK (leaves the hand, but is not a discard). */
function handBottomer(count: number): CardDefinition {
  return item({
    name: `Bottomer-${count}`,
    behavior: {
      abilities: [
        {
          id: "bottom",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "opponent",
              declaration: { id: "d", selector: { controller: "opponent", zone: "hand" }, count },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "deck", position: "bottom" }] }]
            }
          ]
        }
      ]
    }
  });
}

/** Answers a chooserSelectsTarget by picking the first `count` keys of `keys` that are still in hand. */
function pickFirst(game: ReturnType<typeof buildGame>, keys: string[]) {
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const n = (pc.declaration as { count: number }).count;
    const known = (k: string): boolean => {
      try {
        return game.engine.state.cards[game.id(k)].zone === "hand";
      } catch {
        return false;
      }
    };
    const chosen = keys.filter(known).slice(0, n).map(game.id);
    return { kind: "chooserSelectsTarget", selected: chosen };
  };
}

function beastBoard(opts: { oppHand: number; ownHand?: number; count: number; victim?: "opponent" | "self" }) {
  return buildGame({
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "dis", def: discarder(opts.count, opts.victim ?? "opponent"), owner: P1, zone: "play" },
      ...handCards("o", opts.oppHand, P2),
      ...handCards("m", opts.ownHand ?? 0, P1)
    ]
  });
}

const OPP_HAND_KEYS = ["o0", "o1", "o2", "o3", "o4"];

clause(BEAST, "0:rule", "gains X strength and X life when an opponent discards X cards (X = 1, 2, 3)", () => {
  const printed = printing(BEAST);
  for (const x of [1, 2, 3]) {
    const game = beastBoard({ oppHand: 4, count: x });
    activate(game.engine, P1, game.id("dis"), "discard");
    drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
    assert.equal(game.engine.state.players[P2].discard.length, x, `opponent discarded ${x}`);
    assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + x, `strength, X=${x}`);
    assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life! + x, `life, X=${x}`);
    assert.equal(game.engine.getStat(game.id("bb"), "speed"), printed.speed, `speed unchanged, X=${x}`);
  }
});

clause(BEAST, "0:rule", "X is the number of cards actually discarded: asked to discard 2 from a 1-card hand it gains 1; from an empty hand it gains nothing", () => {
  const printed = printing(BEAST);
  const one = beastBoard({ oppHand: 1, count: 2 });
  activate(one.engine, P1, one.id("dis"), "discard");
  drain(one.engine, pickFirst(one, OPP_HAND_KEYS));
  assert.equal(one.engine.state.players[P2].discard.length, 1);
  assert.equal(one.engine.getStat(one.id("bb"), "strength"), printed.strength! + 1);
  assert.equal(one.engine.getStat(one.id("bb"), "life"), printed.life! + 1);

  const none = beastBoard({ oppHand: 0, count: 2 });
  activate(none.engine, P1, none.id("dis"), "discard");
  drain(none.engine, pickFirst(none, OPP_HAND_KEYS));
  assert.equal(none.engine.getStat(none.id("bb"), "strength"), printed.strength);
  assert.equal(none.engine.getStat(none.id("bb"), "life"), printed.life);
});

clause(BEAST, "0:rule", "separate discards in the same turn accumulate (1 then 2 = +3/+3)", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "one", def: discarder(1, "opponent"), owner: P1, zone: "play" },
      { key: "two", def: discarder(2, "opponent"), owner: P1, zone: "play" },
      ...handCards("o", 4, P2)
    ]
  });
  activate(game.engine, P1, game.id("one"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 1);
  activate(game.engine, P1, game.id("two"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 3);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life! + 3);
});

clause(BEAST, "0:rule", "does not gain when its own controller discards", () => {
  const printed = printing(BEAST);
  const game = beastBoard({ oppHand: 2, ownHand: 3, count: 2, victim: "self" });
  activate(game.engine, P1, game.id("dis"), "discard");
  drain(game.engine, pickFirst(game, ["m0", "m1", "m2"]));
  assert.equal(game.engine.state.players[P1].discard.length, 2, "the controller did discard 2");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life);
});

clause(BEAST, "0:rule", "does not gain when an opponent's cards leave their hand without being discarded", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "bot", def: handBottomer(2), owner: P1, zone: "play" },
      ...handCards("o", 3, P2)
    ]
  });
  activate(game.engine, P1, game.id("bot"), "bottom");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(handOf(game.engine, P2).length, 1, "two cards left the opponent's hand");
  assert.equal(game.engine.state.players[P2].discard.length, 0, "...but none was discarded");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life);
});

clause(BEAST, "0:rule", "'an opponent' is relative to the beast's controller: P2's Bewilderbeast does not gain from P2's own discards", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    activePlayerId: P2,
    cards: [
      { key: "bb", def: printing(BEAST), owner: P2, zone: "play" },
      { key: "mine", def: discarder(2, "self"), owner: P2, zone: "play" },
      ...handCards("m", 3, P2),
      ...handCards("o", 3, P1)
    ]
  });
  activate(game.engine, P2, game.id("mine"), "discard");
  drain(game.engine, pickFirst(game, ["m0", "m1", "m2"]));
  assert.equal(game.engine.state.players[P2].discard.length, 2, "its controller did discard 2");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life);
});

clause(BEAST, "0:rule", "'an opponent' is relative to the beast's controller: P2's Bewilderbeast gains from P1's discards", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    activePlayerId: P1,
    cards: [
      { key: "bb", def: printing(BEAST), owner: P2, zone: "play" },
      { key: "theirs", def: discarder(2, "self"), owner: P1, zone: "play" },
      ...handCards("m", 3, P2),
      ...handCards("o", 3, P1)
    ]
  });
  activate(game.engine, P1, game.id("theirs"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(game.engine.state.players[P1].discard.length, 2);
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 2, "the opponent (P1) discarding 2 gives +2");
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life! + 2);
});

clause(BEAST, "0:rule", "each Bewilderbeast you control gains X (it is the card's own trigger)", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    cards: [
      { key: "bb1", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "bb2", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "dis", def: discarder(2, "opponent"), owner: P1, zone: "play" },
      ...handCards("o", 2, P2)
    ]
  });
  activate(game.engine, P1, game.id("dis"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  for (const key of ["bb1", "bb2"]) {
    assert.equal(game.engine.getStat(game.id(key), "strength"), printed.strength! + 2, `${key} strength`);
    assert.equal(game.engine.getStat(game.id(key), "life"), printed.life! + 2, `${key} life`);
  }
});

clause(BEAST, "0:rule", "only this card gains: other characters are unaffected", () => {
  const game = buildGame({
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "friend", def: character({ name: "Friend", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "dis", def: discarder(2, "opponent"), owner: P1, zone: "play" },
      ...handCards("o", 2, P2)
    ]
  });
  activate(game.engine, P1, game.id("dis"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  for (const key of ["friend", "foe"]) {
    assert.equal(game.engine.getStat(game.id(key), "strength"), 2, `${key} strength`);
    assert.equal(game.engine.getStat(game.id(key), "life"), 2, `${key} life`);
  }
});

clause(BEAST, "0:rule", "the gain lasts for the rest of the turn and ends when the turn ends", () => {
  const printed = printing(BEAST);
  const game = beastBoard({ oppHand: 2, count: 2 });
  activate(game.engine, P1, game.id("dis"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 2, "still on later in the same turn");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2, "the next turn has begun");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength, "strength back to printed");
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life, "life back to printed");
  endTurn(game.engine, P2);
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength, "and it does not come back");
});

clause(BEAST, "0:rule", "a discard during the opponent's own turn gives a bonus that ends with THAT turn", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    activePlayerId: P2,
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "theirs", def: discarder(2, "self"), owner: P2, zone: "play" },
      ...handCards("o", 3, P2)
    ]
  });
  activate(game.engine, P2, game.id("theirs"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 2);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life);
});

clause(BEAST, "0:rule", "a Bewilderbeast that is not in play yet (in hand) collects nothing from an earlier discard", () => {
  const printed = printing(BEAST);
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "hand" },
      { key: "dis", def: discarder(2, "opponent"), owner: P1, zone: "play" },
      ...handCards("o", 2, P2),
      ...bank("obsession", 5, P1)
    ]
  });
  activate(game.engine, P1, game.id("dis"), "discard");
  drain(game.engine, pickFirst(game, OPP_HAND_KEYS));
  play(game.engine, P1, game.id("bb"));
  assert.equal(zoneOf(game.engine, game.id("bb")), "play");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life);
});

// --- Close Call --------------------------------------------------------------
// EXTRA COST: Pick a character you control.
// Put the character into its owner's hand. Put this card into play under its
// owner's control as a face-down resource instead of into their discard pile.

const CALL = "9d26a50a-5978-4efd-8b94-df7bd81b226c";

function callBoard(extra: CardPlacement[] = [], resources = 3, obsession = true) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CALL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank(obsession ? "obsession" : "rage", resources, P1),
      ...extra
    ]
  });
}

clause(CALL, "0:extraCost", "the picked character is the extra cost: any character you control can be picked, and it is picked on deploy", () => {
  const game = callBoard();
  playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  // Still in the response window: the card is being deployed with its extra cost paid.
  assert.equal(zoneOf(game.engine, game.id("cc")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "hand");
});

clause(CALL, "0:extraCost", "is refused with no pick, and with no character to pick", () => {
  const noPick = callBoard();
  assert.throws(() => playRaw(noPick.engine, P1, noPick.id("cc")), "no pick");
  assert.equal(zoneOf(noPick.engine, noPick.id("cc")), "hand");
  assert.equal(zoneOf(noPick.engine, noPick.id("mine")), "play");

  const noCharacters = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CALL), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  assert.throws(() => playRaw(noCharacters.engine, P1, noCharacters.id("cc"), { selected: { c: [noCharacters.id("foe")] } }));
  assert.equal(zoneOf(noCharacters.engine, noCharacters.id("cc")), "hand");
});

clause(CALL, "0:extraCost", "cannot pick a character an opponent controls", () => {
  const game = callBoard();
  assert.throws(() => playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("foe")] } }));
  assert.equal(zoneOf(game.engine, game.id("cc")), "hand");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(ready(game.engine, P1), 3, "nothing was paid");
});

clause(CALL, "0:extraCost", "cannot pick a non-character you control (item, location, face-up resource, face-down resource)", () => {
  const game = callBoard([
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
    ...volition(1, P1)
  ]);
  const faceDown = game.engine.state.players[P1].play.find(c => game.engine.state.cards[c].faceDown)!;
  const faceUp = game.engine.state.players[P1].play.find(c => game.engine.getDefinition(c).type === "resource" && !game.engine.state.cards[c].faceDown)!;
  for (const [what, target] of [["item", game.id("itm")], ["location", game.id("loc")], ["face-down resource", faceDown], ["face-up resource", faceUp]] as const) {
    assert.throws(() => playRaw(game.engine, P1, game.id("cc"), { selected: { c: [target] } }), what);
  }
  assert.equal(zoneOf(game.engine, game.id("cc")), "hand");
});

clause(CALL, "0:extraCost", "cannot pick a character that is not in play, and picks exactly one", () => {
  const game = callBoard([
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" }
  ]);
  assert.throws(() => playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("inHand")] } }), "a character in hand");
  assert.throws(() => playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine"), game.id("mine2")] } }), "two characters");
  assert.equal(zoneOf(game.engine, game.id("cc")), "hand");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("mine2")), "play");
});

clause(CALL, "0:extraCost", "a character you control but do not own can be picked", () => {
  const game = callBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("stolen")] } });
  assert.equal(zoneOf(game.engine, game.id("stolen")), "hand");
});

clause(CALL, "1:rule", "puts the picked character into its owner's hand (not another), and nothing else in play moves", () => {
  const game = callBoard();
  const handBefore = handOf(game.engine, P1).length;
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("mine")), "handOf(game.engine, P1).includes(game.id(\"mine\"))");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1 + 1, "Close Call left the hand, the character joined it");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play", "the opponent's character is untouched");
});

clause(CALL, "1:rule", "a stolen character goes to ITS OWNER's hand, not the picker's", () => {
  const game = callBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("stolen")] } });
  assert.ok(handOf(game.engine, P2).includes(game.id("stolen")), "in the owner's hand");
  assert.ok(!handOf(game.engine, P1).includes(game.id("stolen")), "not in the controller's hand");
});

clause(CALL, "1:rule", "the character sheds its damage when it returns to hand and is a fresh character when redeployed", () => {
  const game = callBoard([{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P1, zone: "play", damage: 2, depleted: true }]);
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("hurt")] } });
  assert.equal(zoneOf(game.engine, game.id("hurt")), "hand");
  assert.equal(game.engine.state.cards[game.id("hurt")].damage, 0, "damage is gone");
  assert.equal(game.engine.state.cards[game.id("hurt")].depleted, false, "no longer depleted");
});

clause(CALL, "1:rule", "a character with tokens that is returned to hand loses them (CR 409.2): it is redeployed with none", () => {
  const game = callBoard([{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P1, zone: "play", counters: { token: 2 } }]);
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("hurt")] } });
  assert.equal(zoneOf(game.engine, game.id("hurt")), "hand");
  assert.equal(tokens(game.engine, game.id("hurt")), 0, "tokens disappear when the card leaves play");
  play(game.engine, P1, game.id("hurt"));
  assert.equal(zoneOf(game.engine, game.id("hurt")), "play");
  assert.equal(tokens(game.engine, game.id("hurt")), 0, "the redeployed character is a new card with no tokens");
});

clause(CALL, "1:rule", "Close Call itself enters play under its owner's control as a face-down resource, not into the discard pile", () => {
  const game = callBoard();
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  const card = game.engine.state.cards[game.id("cc")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.equal(card.ownerId, P1);
  assert.ok(game.engine.state.players[P1].play.includes(game.id("cc")), "game.engine.state.players[P1].play.includes(game.id(\"cc\"))");
  assert.ok(!game.engine.state.players[P1].discard.includes(game.id("cc")), "not in the discard pile");
});

clause(CALL, "1:rule", "as a face-down resource it is just a resource providing one Volition", () => {
  const game = callBoard();
  const volitionBefore = game.engine.getThresholds(P1).volition ?? 0;
  const resourcesBefore = game.engine.getThresholds(P1);
  const readyBefore = ready(game.engine, P1);
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  assert.equal((game.engine.getThresholds(P1).volition ?? 0) - volitionBefore, 1, "+1 Volition");
  assert.equal(game.engine.getThresholds(P1).obsession, resourcesBefore.obsession, "no other icon gained");
  assert.deepEqual(game.engine.getCardTypes(game.id("cc")), ["resource"], "a face-down card is only a resource");
  assert.equal(game.engine.isResource(game.id("cc")), true);
  // 3 ready resources paid for Close Call, leaving the new face-down resource as the only unattached one.
  assert.equal(ready(game.engine, P1), readyBefore - 3 + 1);
});

clause(CALL, "1:rule", "a deployed Close Call keeps working as a normal tactic: costs 3 and needs [O]", () => {
  const game = callBoard();
  playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  assert.equal(ready(game.engine, P1), 0, "all 3 ready resources were paid");

  const short = callBoard([], 2);
  assert.throws(() => playRaw(short.engine, P1, short.id("cc"), { selected: { c: [short.id("mine")] } }), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("cc")), "hand");

  const noThreshold = callBoard([], 5, false);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("cc"), { selected: { c: [noThreshold.id("mine")] } }), "no [O]");
});

function callWithResponseKill() {
  const killer = tactic({
    name: "Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const game = callBoard([{ key: "killer", def: killer, owner: P2, zone: "hand" }]);
  playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("killer"), selected: { t: [game.id("mine")] } } as never);
  resolvePendingResponses(game.engine);
  return game;
}

clause(CALL, "1:rule", "if the picked character is destroyed in response, Close Call still becomes a face-down resource", () => {
  const game = callWithResponseKill();
  assert.equal(zoneOf(game.engine, game.id("cc")), "play");
  assert.equal(game.engine.state.cards[game.id("cc")].faceDown, true);
  assert.ok(!game.engine.state.players[P1].discard.includes(game.id("cc")), "!game.engine.state.players[P1].discard.includes(game.id(\"cc\"))");
});

clause(CALL, "1:rule", "a character destroyed in response is NOT fetched back from the discard pile into the hand (CR 402.4)", () => {
  const game = callWithResponseKill();
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard", "it died, and stays in the discard pile");
  assert.ok(!handOf(game.engine, P1).includes(game.id("mine")), "not in the hand");
});

// --- Confessions of Countless Souls ------------------------------------------
// EXTRA COST: Choose a number for X. Put X characters you control into the void.
// Pick X+1 characters.
// Put those characters into their owner's hand. Look at the top X+1 cards of your
// deck. You may put any number of those cards on the bottom of your deck in any
// order. Put the remaining cards on the top of your deck in any order.

const CONFESSIONS = "dd583c2e-106b-4186-8614-cb320e838015";

function confBoard(opts: { resources?: number; deck?: number; obsession?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CONFESSIONS), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
      { key: "e", def: character({ name: "E" }), owner: P2, zone: "play" },
      { key: "f", def: character({ name: "F" }), owner: P2, zone: "play" },
      ...deckCards("d", opts.deck ?? 5, P1),
      ...bank(opts.obsession === false ? "rage" : "obsession", opts.resources ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type ConfBoard = ReturnType<typeof confBoard>;

/** Plays Confessions with the given X and picks (by placement key). Leaves the response window open unless `resolve`. */
function playConfessions(game: ConfBoard, x: number, tovoid: string[], bounce: string[], resolve = true): void {
  playRaw(game.engine, P1, game.id("co"), {
    variables: { x },
    selected: { tovoid: tovoid.map(game.id), bounce: bounce.map(game.id) }
  });
  if (resolve) resolvePendingResponses(game.engine);
}

const reorderChoice = (engine: SpoilsEngine) => pending(engine) as unknown as PendingChoiceLike & { cardIds: string[]; to?: string };

clause(CONFESSIONS, "0:extraCost", "X = 0: puts no character into the void and picks exactly 1 character", () => {
  const game = confBoard();
  playConfessions(game, 0, [], ["b"]);
  for (const key of ["a", "c"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} untouched`);
  assert.equal(game.engine.state.players[P1].void.length, 0, "nothing was put into the void");
  assert.equal(zoneOf(game.engine, game.id("b")), "hand");
});

clause(CONFESSIONS, "0:extraCost", "X = 1: puts 1 character you control into the void, and picks 2 characters", () => {
  const game = confBoard();
  playConfessions(game, 1, ["a"], ["b", "e"]);
  assert.equal(zoneOf(game.engine, game.id("a")), "void");
  assert.equal(zoneOf(game.engine, game.id("b")), "hand");
  assert.equal(zoneOf(game.engine, game.id("e")), "hand");
  assert.equal(zoneOf(game.engine, game.id("c")), "play", "unpicked characters stay");
  assert.equal(zoneOf(game.engine, game.id("f")), "play", "unpicked characters stay");
});

clause(CONFESSIONS, "0:extraCost", "X = 2: puts 2 characters into the void, and picks 3 characters", () => {
  const game = confBoard();
  playConfessions(game, 2, ["a", "b"], ["c", "e", "f"]);
  assert.equal(zoneOf(game.engine, game.id("a")), "void");
  assert.equal(zoneOf(game.engine, game.id("b")), "void");
  for (const key of ["c", "e", "f"]) assert.equal(zoneOf(game.engine, game.id(key)), "hand", key);
});

clause(CONFESSIONS, "0:extraCost", "voided characters go to their owner's void, not the discard pile", () => {
  const game = confBoard();
  playConfessions(game, 2, ["a", "b"], ["c", "e", "f"]);
  assert.deepEqual([...game.engine.state.players[P1].void].sort(), [game.id("a"), game.id("b")].sort());
  assert.equal(game.engine.state.players[P1].discard.includes(game.id("a")), false);
});

clause(CONFESSIONS, "0:extraCost", "X is the number of characters you control that go into the void: the wrong number of voided characters is refused", () => {
  const cases: Array<[string, number, string[], string[]]> = [
    ["X=1 with no voided character", 1, [], ["b", "e"]],
    ["X=1 with two voided characters", 1, ["a", "b"], ["c", "e"]],
    ["X=0 with a voided character", 0, ["a"], ["b"]],
    ["X=2 with one voided character", 2, ["a"], ["b", "c", "e"]]
  ];
  for (const [label, x, tovoid, bounce] of cases) {
    const game = confBoard();
    assert.throws(() => playConfessions(game, x, tovoid, bounce), label);
    assert.equal(zoneOf(game.engine, game.id("co")), "hand", `${label}: still in hand`);
    assert.equal(ready(game.engine, P1), 3, `${label}: nothing was paid`);
  }
});

clause(CONFESSIONS, "0:extraCost", "cannot put an opponent's character into the void", () => {
  const game = confBoard();
  assert.throws(() => playConfessions(game, 1, ["e"], ["a", "b"]));
  assert.equal(zoneOf(game.engine, game.id("e")), "play");
  assert.equal(zoneOf(game.engine, game.id("co")), "hand");
});

clause(CONFESSIONS, "0:extraCost", "cannot void a non-character (item, face-down resource) or a character that is not in play", () => {
  const game = confBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...volition(1, P1)
    ]
  });
  const faceDown = game.engine.state.players[P1].play.find(c => game.engine.state.cards[c].faceDown)!;
  assert.throws(() => playConfessions(game, 1, ["itm"], ["a", "b"]), "item");
  assert.throws(() => playConfessions(game, 1, ["inHand"], ["a", "b"]), "character in hand");
  assert.throws(
    () => playRaw(game.engine, P1, game.id("co"), { variables: { x: 1 }, selected: { tovoid: [faceDown], bounce: [game.id("a"), game.id("b")] } }),
    "face-down resource"
  );
  assert.equal(zoneOf(game.engine, game.id("co")), "hand");
});

clause(CONFESSIONS, "0:extraCost", "X cannot exceed the number of characters you control: 3 voided needs 3 own characters", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CONFESSIONS), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      { key: "e", def: character({ name: "E" }), owner: P2, zone: "play" },
      { key: "f", def: character({ name: "F" }), owner: P2, zone: "play" },
      { key: "g", def: character({ name: "G" }), owner: P2, zone: "play" },
      ...deckCards("d", 5, P1),
      ...bank("obsession", 3, P1)
    ]
  });
  assert.throws(() =>
    playRaw(game.engine, P1, game.id("co"), {
      variables: { x: 3 },
      selected: { tovoid: [game.id("a"), game.id("b"), game.id("e")], bounce: [game.id("f"), game.id("g")] }
    })
  );
  assert.equal(zoneOf(game.engine, game.id("co")), "hand");
});

clause(CONFESSIONS, "0:extraCost", "picks exactly X+1 characters: too few or too many is refused", () => {
  const cases: Array<[string, number, string[], string[]]> = [
    ["X=1 picking 1", 1, ["a"], ["b"]],
    ["X=1 picking 3", 1, ["a"], ["b", "c", "e"]],
    ["X=0 picking 0", 0, [], []],
    ["X=0 picking 2", 0, [], ["b", "c"]]
  ];
  for (const [label, x, tovoid, bounce] of cases) {
    const game = confBoard();
    assert.throws(() => playConfessions(game, x, tovoid, bounce), label);
    assert.equal(zoneOf(game.engine, game.id("co")), "hand", label);
  }
});

clause(CONFESSIONS, "0:extraCost", "the X+1 picked characters can be any characters in play: yours, the opponent's, or both", () => {
  for (const bounce of [["b", "c"], ["e", "f"], ["b", "e"]]) {
    const game = confBoard();
    playConfessions(game, 1, ["a"], bounce);
    for (const key of bounce) assert.equal(zoneOf(game.engine, game.id(key)), "hand", `${bounce.join("+")}: ${key}`);
  }
});

clause(CONFESSIONS, "0:extraCost", "cannot pick a non-character, a face-down card or a card outside play among the X+1", () => {
  const game = confBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "oppItm", def: item({ name: "OppItm" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "oppFd", def: character({ name: "OppFd" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["itm", "oppItm", "inHand", "oppFd"]) {
    assert.throws(() => playConfessions(game, 0, [], [key]), key);
  }
  assert.equal(zoneOf(game.engine, game.id("co")), "hand");
});

clause(CONFESSIONS, "0:extraCost", "a character put into the void as the cost cannot also be one of the X+1 picked characters", () => {
  const game = confBoard();
  // `a` leaves play as the cost, so by the time the next part of the cost picks X+1 characters it can't be picked.
  assert.throws(() => playConfessions(game, 1, ["a"], ["a", "b"]));
  assert.equal(zoneOf(game.engine, game.id("co")), "hand", "the illegal play was refused");
  assert.equal(zoneOf(game.engine, game.id("a")), "play");
});

clause(CONFESSIONS, "0:extraCost", "the voided characters are already in the void while the tactic is still waiting for responses (it is a cost, not an effect)", () => {
  const game = confBoard();
  playConfessions(game, 1, ["a"], ["b", "e"], false);
  assert.ok(game.engine.state.responseWindow, "the tactic is on the stack, unresolved");
  assert.equal(zoneOf(game.engine, game.id("a")), "void", "EXTRA COST: already in the void");
  assert.equal(zoneOf(game.engine, game.id("b")), "play", "the picks are only moved on resolution");
});

clause(CONFESSIONS, "0:extraCost", "the numeric cost 3 is paid on deploy; one resource short, or without [O][O], is refused", () => {
  const paid = confBoard();
  playConfessions(paid, 0, [], ["b"], false);
  assert.equal(ready(paid.engine, P1), 0, "3 resources paid");

  const short = confBoard({ resources: 2 });
  assert.throws(() => playConfessions(short, 0, [], ["b"]));
  assert.equal(zoneOf(short.engine, short.id("co")), "hand");

  const noThreshold = confBoard({ resources: 5, obsession: false });
  assert.throws(() => playConfessions(noThreshold, 0, [], ["b"]));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("co")), "hand");

  const oneObsession = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CONFESSIONS), owner: P1, zone: "hand" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      ...bank("obsession", 1, P1),
      ...bank("rage", 4, P1),
      ...deckCards("d", 3, P1)
    ]
  });
  assert.throws(
    () => playRaw(oneObsession.engine, P1, oneObsession.id("co"), { variables: { x: 0 }, selected: { tovoid: [], bounce: [oneObsession.id("b")] } }),
    "[O][O] needs two Obsession"
  );
});

clause(CONFESSIONS, "1:rule", "puts the picked characters into their OWNERS' hands (an opponent's character goes to the opponent)", () => {
  const game = confBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  playConfessions(game, 1, ["a"], ["stolen", "e"]);
  assert.ok(handOf(game.engine, P2).includes(game.id("stolen")), "stolen character goes home to P2");
  assert.ok(handOf(game.engine, P2).includes(game.id("e")), "handOf(game.engine, P2).includes(game.id(\"e\"))");
  assert.ok(!handOf(game.engine, P1).includes(game.id("stolen")), "!handOf(game.engine, P1).includes(game.id(\"stolen\"))");
  assert.ok(!handOf(game.engine, P1).includes(game.id("e")), "!handOf(game.engine, P1).includes(game.id(\"e\"))");
});

clause(CONFESSIONS, "1:rule", "the picked characters of the controller go to the controller's hand and the tactic goes to the discard pile", () => {
  const game = confBoard();
  playConfessions(game, 1, ["a"], ["b", "c"]);
  assert.ok(handOf(game.engine, P1).includes(game.id("b")), "handOf(game.engine, P1).includes(game.id(\"b\"))");
  assert.ok(handOf(game.engine, P1).includes(game.id("c")), "handOf(game.engine, P1).includes(game.id(\"c\"))");
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("co")), "discard");
});

clause(CONFESSIONS, "1:rule", "looks at exactly the top X+1 cards of the controller's deck (X = 0, 1, 2)", () => {
  const picks: Array<[number, string[], string[]]> = [
    [0, [], ["b"]],
    [1, ["a"], ["b", "c"]],
    [2, ["a", "b"], ["c", "e", "f"]]
  ];
  for (const [x, tovoid, bounce] of picks) {
    const game = confBoard();
    const deck = [...deckOf(game.engine, P1)];
    playConfessions(game, x, tovoid, bounce);
    const pc = reorderChoice(game.engine);
    assert.equal(pc.kind, "reorderDeck", `X=${x}`);
    assert.equal(pc.playerId, P1, "the controller looks");
    assert.deepEqual(pc.cardIds, deck.slice(0, x + 1), `exactly the top ${x + 1}`);
  }
});

clause(CONFESSIONS, "1:rule", "only the controller's own deck is looked at: the opponent's deck is never touched", () => {
  const game = confBoard({ extra: deckCards("z", 4, P2) });
  const oppDeck = [...deckOf(game.engine, P2)];
  playConfessions(game, 1, ["a"], ["b", "e"]);
  const pc = reorderChoice(game.engine);
  assert.deepEqual(pc.cardIds, deckOf(game.engine, P1).slice(0, 2));
  assert.equal(pc.cardIds.some(c => oppDeck.includes(c)), false);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: pc.cardIds, bottom: [] });
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
});

clause(CONFESSIONS, "1:rule", "may put any number of the looked-at cards on the bottom in any order, and the rest on top in any order", () => {
  const game = confBoard();
  const [t0, t1, t2, t3, t4] = deckOf(game.engine, P1);
  playConfessions(game, 2, ["a", "b"], ["c", "e", "f"]);
  const pc = reorderChoice(game.engine);
  assert.deepEqual(pc.cardIds, [t0, t1, t2]);
  // t2 stays on top; t1 then t0 (reversed) go to the bottom.
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [t2], bottom: [t1, t0] });
  assert.deepEqual(deckOf(game.engine, P1), [t2, t3, t4, t1, t0]);
});

clause(CONFESSIONS, "1:rule", "may keep all looked-at cards on top, reordered", () => {
  const game = confBoard();
  const [t0, t1, t2, t3, t4] = deckOf(game.engine, P1);
  playConfessions(game, 2, ["a", "b"], ["c", "e", "f"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [t2, t0, t1], bottom: [] });
  assert.deepEqual(deckOf(game.engine, P1), [t2, t0, t1, t3, t4]);
});

clause(CONFESSIONS, "1:rule", "may put every looked-at card on the bottom, in the chosen order", () => {
  const game = confBoard();
  const [t0, t1, t2, t3, t4] = deckOf(game.engine, P1);
  playConfessions(game, 2, ["a", "b"], ["c", "e", "f"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [], bottom: [t1, t2, t0] });
  assert.deepEqual(deckOf(game.engine, P1), [t3, t4, t1, t2, t0]);
});

clause(CONFESSIONS, "1:rule", "X = 0 looks at one card, which may stay on top or go to the bottom", () => {
  const stay = confBoard();
  const [s0, s1] = deckOf(stay.engine, P1);
  playConfessions(stay, 0, [], ["b"]);
  answerChoice(stay.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [s0], bottom: [] });
  assert.equal(deckOf(stay.engine, P1)[0], s0);
  assert.equal(deckOf(stay.engine, P1)[1], s1);

  const bottom = confBoard();
  const [b0, b1] = deckOf(bottom.engine, P1);
  playConfessions(bottom, 0, [], ["b"]);
  answerChoice(bottom.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [], bottom: [b0] });
  assert.equal(deckOf(bottom.engine, P1)[0], b1);
  const deck = deckOf(bottom.engine, P1);
  assert.equal(deck[deck.length - 1], b0);
});

clause(CONFESSIONS, "1:rule", "the bounced characters are not part of the deck: the deck loses and gains no cards", () => {
  const game = confBoard();
  const size = deckOf(game.engine, P1).length;
  playConfessions(game, 1, ["a"], ["b", "c"]);
  const pc = reorderChoice(game.engine);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: pc.cardIds, bottom: [] });
  assert.equal(deckOf(game.engine, P1).length, size);
});

clause(CONFESSIONS, "1:rule", "with fewer than X+1 cards in the deck, looks at as many as there are", () => {
  const game = confBoard({ deck: 1 });
  const deck = [...deckOf(game.engine, P1)];
  playConfessions(game, 1, ["a"], ["b", "c"]);
  const pc = reorderChoice(game.engine);
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, deck);
});

clause(CONFESSIONS, "1:rule", "a picked character destroyed in response is not fetched back from the discard pile to the hand (CR 402.4)", () => {
  const killer = tactic({
    name: "Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const game = confBoard({ extra: [{ key: "killer", def: killer, owner: P2, zone: "hand" }] });
  playConfessions(game, 0, [], ["b"], false);
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("killer"), selected: { t: [game.id("b")] } } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b")), "discard");
  assert.ok(!handOf(game.engine, P1).includes(game.id("b")), "!handOf(game.engine, P1).includes(game.id(\"b\"))");
});

// --- Eldridge Gosche, Godstealer ---------------------------------------------
// UNIQUE ELDRIDGE
// When this card enters play or is destroyed, you may pick 3 or fewer non-resource
// cards you control. If you do, put up to 3 tokens divided however you want on
// those cards.
// READY THE RITE -- COST: Remove 2 tokens from this card. Pick a tactic you own in
// the void or in your discard pile. -- EFFECT: Put the tactic into your hand.
// TRIBUTE -- COST: Pay 1. Destroy this card. Pick a player. -- EFFECT: That player
// discards 2 cards. Draw a card.

const ELDRIDGE = "6d511d44-9e80-443b-b67c-ae9625d671dd";

type EldGame = ReturnType<typeof buildGame>;

/** Eldridge in P1's hand (to deploy) with a small board: own characters c0 c1, own item itm, opposing opp + oppItm, 6 [O]. */
function eldDeployBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "opp", def: character({ name: "Opp" }), owner: P2, zone: "play" },
      { key: "oppItm", def: item({ name: "OppItm" }), owner: P2, zone: "play" },
      ...bank("obsession", 6, P1),
      ...extra
    ]
  });
}

/** Eldridge already in play (as `eg`), same supporting cast. */
function eldInPlayBoard(opts: { tokens?: number; depleted?: boolean; extra?: CardPlacement[]; resources?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : {}, depleted: opts.depleted },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "opp", def: character({ name: "Opp" }), owner: P2, zone: "play" },
      { key: "oppItm", def: item({ name: "OppItm" }), owner: P2, zone: "play" },
      ...bank("obsession", opts.resources ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

interface EldScript {
  /** Placement keys to pick for the sprinkle trigger (either trigger). */
  pick?: string[];
  /** The number of tokens to place ("up to 3"). */
  n?: number;
  /** Tokens per placement key; must sum to `n`. */
  shares?: Record<string, number>;
  /** Placement key to keep when the Unique rule asks. */
  keep?: string;
}

/** A `drain` answerer driving Eldridge's trigger prompts; anything else is declined. */
function eldScript(game: EldGame, script: EldScript) {
  return (pc: PendingChoiceLike): unknown => {
    switch (pc.kind) {
      case "selectTargets":
        return { kind: "selectTargets", selected: { sprinkle: (script.pick ?? []).map(game.id) } };
      case "chooseNumber":
        return { kind: "chooseNumber", value: script.n ?? 0 };
      case "distributeAmong": {
        const shares: Record<string, number> = {};
        for (const [key, amount] of Object.entries(script.shares ?? {})) shares[game.id(key)] = amount;
        return { kind: "distributeAmong", shares };
      }
      case "uniqueSurvivor":
        return { kind: "uniqueSurvivor", keep: script.keep ? game.id(script.keep) : (pc.candidates as string[])[0] };
      default:
        return declineAll(pc);
    }
  };
}

const tokenCounts = (game: EldGame, keys: string[]) => Object.fromEntries(keys.map(k => [k, tokens(game.engine, game.id(k))]));

function deployEldridge(script: EldScript, extra: CardPlacement[] = []): EldGame {
  const game = eldDeployBoard(extra);
  play(game.engine, P1, game.id("eg"));
  drain(game.engine, eldScript(game, script));
  return game;
}

// -- UNIQUE ELDRIDGE ------------------------------------------------------------

clause(ELDRIDGE, "0:unique", "controlling a second ELDRIDGE makes you keep one: choosing the new one destroys the old one", () => {
  const second = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg1", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "eg2", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(second.engine, P1, second.id("eg2"));
  const seen: string[] = [];
  drain(second.engine, pc => {
    seen.push(pc.kind);
    return eldScript(second, { keep: "eg2", pick: [] })(pc);
  });
  assert.ok(seen.includes("uniqueSurvivor"), "the controller was asked which to keep");
  assert.equal(zoneOf(second.engine, second.id("eg2")), "play", "the chosen one stays");
  assert.equal(zoneOf(second.engine, second.id("eg1")), "discard", "the other is destroyed");
});

clause(ELDRIDGE, "0:unique", "choosing the old one keeps it and destroys the new one", () => {
  const second = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg1", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "eg2", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(second.engine, P1, second.id("eg2"));
  drain(second.engine, eldScript(second, { keep: "eg1", pick: [] }));
  assert.equal(zoneOf(second.engine, second.id("eg1")), "play");
  assert.equal(zoneOf(second.engine, second.id("eg2")), "discard");
});

clause(ELDRIDGE, "0:unique", "the choice belongs to the controller of the duplicates", () => {
  const second = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg1", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "eg2", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(second.engine, P1, second.id("eg2"));
  let pc = pending(second.engine);
  let guard = 0;
  while (pc && pc.kind !== "uniqueSurvivor" && guard++ < 5) {
    answerChoice(second.engine, pc.kind, pc.playerId, eldScript(second, { pick: [] })(pc) as Record<string, unknown>);
    pc = pending(second.engine);
  }
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [second.id("eg1"), second.id("eg2")].sort());
});

clause(ELDRIDGE, "0:unique", "the restriction is per player: an opponent may control their own Eldridge", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(ELDRIDGE), owner: P2, zone: "play" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(game.engine, P1, game.id("mine"));
  drain(game.engine, eldScript(game, { pick: [] }));
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
});

clause(ELDRIDGE, "0:unique", "another card with the same UNIQUE designation counts as a duplicate, whatever its name (keep the old one: the new Eldridge is destroyed)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Not Eldridge", unique: "eldridge" }), owner: P1, zone: "play" },
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(game.engine, P1, game.id("eg"));
  const seen: string[] = [];
  drain(game.engine, pc => {
    seen.push(pc.kind);
    return eldScript(game, { keep: "other", pick: [] })(pc);
  });
  assert.ok(seen.includes("uniqueSurvivor"), "the controller was asked which to keep");
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
  assert.equal(zoneOf(game.engine, game.id("eg")), "discard");
});

clause(ELDRIDGE, "0:unique", "another card with the same UNIQUE designation counts as a duplicate (keep the new Eldridge: the old one is destroyed and the game carries on)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Not Eldridge", unique: "eldridge" }), owner: P1, zone: "play" },
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(game.engine, P1, game.id("eg"));
  drain(game.engine, eldScript(game, { keep: "eg", pick: [] }));
  assert.equal(zoneOf(game.engine, game.id("eg")), "play");
  assert.equal(zoneOf(game.engine, game.id("other")), "discard");
  assert.equal(game.engine.state.responseWindow, undefined, "the deploy finished: the game is not stuck in a resolving window");
});

clause(ELDRIDGE, "0:unique", "a card with a different UNIQUE designation is not a duplicate", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Someone", unique: "someone" }), owner: P1, zone: "play" },
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(game.engine, P1, game.id("eg"));
  const seen: string[] = [];
  drain(game.engine, pc => {
    seen.push(pc.kind);
    return eldScript(game, { pick: [] })(pc);
  });
  assert.ok(!seen.includes("uniqueSurvivor"), "!seen.includes(\"uniqueSurvivor\")");
  assert.equal(zoneOf(game.engine, game.id("eg")), "play");
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
});

// -- When this card enters play ---------------------------------------------------

clause(ELDRIDGE, "1:rule", "on entering play it offers a pick of up to 3 cards to its controller", () => {
  const game = eldDeployBoard();
  play(game.engine, P1, game.id("eg"));
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(game.engine, game.id("eg")), "play");
});

clause(ELDRIDGE, "1:rule", "pick 3 cards and put 1 token on each", () => {
  const game = deployEldridge({ pick: ["c0", "itm", "c1"], n: 3, shares: { c0: 1, itm: 1, c1: 1 } });
  assert.deepEqual(tokenCounts(game, ["c0", "c1", "itm", "eg"]), { c0: 1, c1: 1, itm: 1, eg: 0 });
});

clause(ELDRIDGE, "1:rule", "tokens are divided however you want: 2 + 1 across two picked cards, or all 3 on one", () => {
  const split = deployEldridge({ pick: ["c0", "c1"], n: 3, shares: { c0: 2, c1: 1 } });
  assert.deepEqual(tokenCounts(split, ["c0", "c1", "itm"]), { c0: 2, c1: 1, itm: 0 });
  const all = deployEldridge({ pick: ["c0", "c1"], n: 3, shares: { c1: 3 } });
  assert.deepEqual(tokenCounts(all, ["c0", "c1", "itm"]), { c0: 0, c1: 3, itm: 0 });
  const single = deployEldridge({ pick: ["itm"], n: 3, shares: { itm: 3 } });
  assert.deepEqual(tokenCounts(single, ["c0", "c1", "itm"]), { c0: 0, c1: 0, itm: 3 });
});

clause(ELDRIDGE, "1:rule", "'up to 3' tokens: it can put fewer, 2 or 1 or none", () => {
  const two = deployEldridge({ pick: ["c0", "c1"], n: 2, shares: { c0: 1, c1: 1 } });
  assert.deepEqual(tokenCounts(two, ["c0", "c1", "itm", "eg"]), { c0: 1, c1: 1, itm: 0, eg: 0 });
  const one = deployEldridge({ pick: ["c0", "c1"], n: 1, shares: { c1: 1 } });
  assert.deepEqual(tokenCounts(one, ["c0", "c1", "itm", "eg"]), { c0: 0, c1: 1, itm: 0, eg: 0 });
  const none = deployEldridge({ pick: ["c0", "c1"], n: 0, shares: {} });
  assert.deepEqual(tokenCounts(none, ["c0", "c1", "itm", "eg"]), { c0: 0, c1: 0, itm: 0, eg: 0 });
});

clause(ELDRIDGE, "1:rule", "'you may': picking no card puts no tokens anywhere", () => {
  const game = deployEldridge({ pick: [] });
  assert.deepEqual(tokenCounts(game, ["c0", "c1", "itm", "eg", "opp", "oppItm"]), { c0: 0, c1: 0, itm: 0, eg: 0, opp: 0, oppItm: 0 });
  assert.equal(pending(game.engine), undefined, "nothing is left pending");
});

clause(ELDRIDGE, "1:rule", "it may pick fewer than 3 cards even when more could be picked", () => {
  const game = deployEldridge({ pick: ["c1"], n: 2, shares: { c1: 2 } });
  assert.deepEqual(tokenCounts(game, ["c0", "c1", "itm", "eg"]), { c0: 0, c1: 2, itm: 0, eg: 0 });
});

clause(ELDRIDGE, "1:rule", "Eldridge can pick itself (it is a non-resource card its controller controls once it is in play)", () => {
  const game = deployEldridge({ pick: ["eg", "c0"], n: 3, shares: { eg: 2, c0: 1 } });
  assert.deepEqual(tokenCounts(game, ["eg", "c0", "c1"]), { eg: 2, c0: 1, c1: 0 });
});

clause(ELDRIDGE, "1:rule", "the picks may be characters, items and locations alike", () => {
  const game = deployEldridge({ pick: ["itm", "loc", "c0"], n: 3, shares: { itm: 1, loc: 1, c0: 1 } }, [
    { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(tokenCounts(game, ["itm", "loc", "c0"]), { itm: 1, loc: 1, c0: 1 });
});

clause(ELDRIDGE, "1:rule", "cannot pick more than 3 cards", () => {
  const game = eldDeployBoard();
  play(game.engine, P1, game.id("eg"));
  assert.throws(() =>
    game.engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { sprinkle: [game.id("c0"), game.id("c1"), game.id("itm"), game.id("eg")] } }
    } as never)
  );
  assert.equal(pending(game.engine)?.kind, "selectTargets", "still waiting for a legal pick");
});

clause(ELDRIDGE, "1:rule", "cannot pick cards the opponent controls", () => {
  const game = eldDeployBoard();
  play(game.engine, P1, game.id("eg"));
  for (const key of ["opp", "oppItm"]) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { sprinkle: [game.id(key)] } } } as never),
      key
    );
  }
});

clause(ELDRIDGE, "1:rule", "cannot pick resources (face-up or face-down), factions, or cards outside play", () => {
  const game = eldDeployBoard([
    ...volition(1, P1),
    { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
    { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" }
  ]);
  play(game.engine, P1, game.id("eg"));
  const faceDown = game.engine.state.players[P1].play.find(c => game.engine.state.cards[c].faceDown)!;
  const faceUp = game.engine.state.players[P1].play.find(c => game.engine.getDefinition(c).type === "resource" && !game.engine.state.cards[c].faceDown)!;
  const attempts: Array<[string, string]> = [
    ["face-down resource", faceDown],
    ["face-up resource", faceUp],
    ["own faction", game.engine.state.players[P1].factionId!],
    ["card in hand", game.id("handChar")],
    ["card in discard pile", game.id("discChar")]
  ];
  for (const [label, target] of attempts) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { sprinkle: [target] } } } as never),
      label
    );
  }
});

clause(ELDRIDGE, "1:rule", "at most 3 tokens: asking for 4 is refused", () => {
  const game = eldDeployBoard();
  play(game.engine, P1, game.id("eg"));
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [game.id("c0"), game.id("c1")] } });
  assert.equal(pending(game.engine)?.kind, "chooseNumber");
  assert.throws(() => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value: 4 } } as never));
});

clause(ELDRIDGE, "1:rule", "the tokens may only go on the picked cards, and no more than 3 in total", () => {
  const game = eldDeployBoard();
  play(game.engine, P1, game.id("eg"));
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [game.id("c0"), game.id("c1")] } });
  answerChoice(game.engine, "chooseNumber", P1, { kind: "chooseNumber", value: 3 });
  assert.equal(pending(game.engine)?.kind, "distributeAmong");
  const attempt = (shares: Record<string, number>) =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  assert.throws(() => attempt({ [game.id("opp")]: 3 }), "tokens on a card that wasn't picked");
  assert.throws(() => attempt({ [game.id("itm")]: 1, [game.id("c0")]: 2 }), "tokens on a card that wasn't picked, mixed in");
  assert.throws(() => attempt({ [game.id("c0")]: 4 }), "4 tokens");
  assert.throws(() => attempt({ [game.id("c0")]: 2, [game.id("c1")]: 2 }), "2 + 2 tokens");
  assert.equal(pending(game.engine)?.kind, "distributeAmong", "still waiting for a legal answer");
  attempt({ [game.id("c0")]: 1, [game.id("c1")]: 2 });
  assert.deepEqual(tokenCounts(game, ["c0", "c1", "itm", "opp"]), { c0: 1, c1: 2, itm: 0, opp: 0 });
});

clause(ELDRIDGE, "1:rule", "a different card of the controller entering play does not trigger it", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(pending(game.engine), undefined, "Eldridge's trigger did not fire");
});

clause(ELDRIDGE, "1:rule", "also triggers when it is put into play by an effect rather than deployed", () => {
  const reanimator = item({
    name: "Reanimator",
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator, owner: P1, zone: "play" },
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "discard" },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" }
    ]
  });
  activate(game.engine, P1, game.id("re"), "raise", { selected: { t: [game.id("eg")] } });
  assert.equal(zoneOf(game.engine, game.id("eg")), "play");
  drain(game.engine, eldScript(game, { pick: ["c0"], n: 2, shares: { c0: 2 } }));
  assert.equal(tokens(game.engine, game.id("c0")), 2);
});

// -- When this card is destroyed --------------------------------------------------

/** A free tactic that destroys one chosen character. */
function destroyer(): CardDefinition {
  return tactic({
    name: "Destroyer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

function destroyEldridge(script: EldScript, extra: CardPlacement[] = []): EldGame {
  const game = eldInPlayBoard({ extra: [{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }, ...extra] });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("eg")] } });
  drain(game.engine, eldScript(game, script));
  return game;
}

clause(ELDRIDGE, "1:rule", "when it is destroyed, its controller may pick up to 3 other cards and divide up to 3 tokens", () => {
  const game = destroyEldridge({ pick: ["c0", "itm", "c1"], n: 3, shares: { c0: 2, itm: 1 } });
  assert.equal(zoneOf(game.engine, game.id("eg")), "discard");
  assert.deepEqual(tokenCounts(game, ["c0", "c1", "itm"]), { c0: 2, c1: 0, itm: 1 });
});

clause(ELDRIDGE, "1:rule", "when destroyed it can put fewer tokens, or decline to pick", () => {
  const fewer = destroyEldridge({ pick: ["c0"], n: 1, shares: { c0: 1 } });
  assert.deepEqual(tokenCounts(fewer, ["c0", "c1", "itm"]), { c0: 1, c1: 0, itm: 0 });
  const none = destroyEldridge({ pick: [] });
  assert.deepEqual(tokenCounts(none, ["c0", "c1", "itm"]), { c0: 0, c1: 0, itm: 0 });
});

clause(ELDRIDGE, "1:rule", "when destroyed it cannot pick itself (it is no longer in play), the opponent's cards or resources", () => {
  const game = eldInPlayBoard({ extra: [{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("eg")] } });
  assert.equal(pending(game.engine)?.kind, "selectTargets");
  for (const key of ["eg", "opp", "oppItm"]) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { sprinkle: [game.id(key)] } } } as never),
      key
    );
  }
});

clause(ELDRIDGE, "1:rule", "when destroyed, cannot pick more than 3 cards", () => {
  const game = eldInPlayBoard({
    extra: [
      { key: "dtor", def: destroyer(), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" }
    ]
  });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("eg")] } });
  assert.throws(() =>
    game.engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { sprinkle: [game.id("c0"), game.id("c1"), game.id("c2"), game.id("itm")] } }
    } as never)
  );
});

clause(ELDRIDGE, "1:rule", "the destroyed trigger does not fire when another character of the controller is destroyed", () => {
  const game = eldInPlayBoard({ extra: [{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("c0")] } });
  assert.equal(zoneOf(game.engine, game.id("c0")), "discard");
  assert.equal(pending(game.engine), undefined, "no Eldridge trigger for someone else's death");
  assert.equal(zoneOf(game.engine, game.id("eg")), "play");
});

clause(ELDRIDGE, "1:rule", "the destroyed trigger does not fire when Eldridge leaves play without being destroyed (returned to hand)", () => {
  const game = eldInPlayBoard({ extra: [{ key: "dtor", def: bounceOne(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("eg")] } });
  assert.equal(zoneOf(game.engine, game.id("eg")), "hand");
  assert.equal(pending(game.engine), undefined);
});

/** A free tactic that returns one chosen character to its owner's hand. */
function bounceOne(): CardDefinition {
  return tactic({
    name: "Bouncer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

clause(ELDRIDGE, "1:rule", "a face-down Eldridge is just a resource: destroying it triggers nothing", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fd", def: printing(ELDRIDGE), owner: P1, zone: "play", faceDown: true },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" },
      { key: "k", def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("k"), { selected: { t: [game.id("fd")] } });
  assert.equal(zoneOf(game.engine, game.id("fd")), "discard");
  assert.equal(pending(game.engine), undefined, "the face-down card's trigger is dormant");
});

clause(ELDRIDGE, "1:rule", "an opponent's Eldridge dying does not trigger mine", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "theirs", def: printing(ELDRIDGE), owner: P2, zone: "play" },
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "play" },
      { key: "theirC", def: character({ name: "TheirC" }), owner: P2, zone: "play" },
      { key: "dtor", def: destroyer(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("theirs")] } });
  assert.equal(zoneOf(game.engine, game.id("theirs")), "discard");
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P2, "only the dying Eldridge's own controller is asked, not mine");
  assert.equal((pc as unknown as { sourceId: string }).sourceId, game.id("theirs"));
  answerChoice(game.engine, "selectTargets", P2, { kind: "selectTargets", selected: { sprinkle: [] } });
  assert.equal(pending(game.engine), undefined, "my Eldridge did not trigger");
});

// -- READY THE RITE ---------------------------------------------------------------

const tacticDef = (name: string) => tactic({ name, cost: 0 });

function riteBoard(tokenCount: number, extra: CardPlacement[] = [], depleted = false) {
  return eldInPlayBoard({
    tokens: tokenCount,
    depleted,
    extra: [
      { key: "inDiscard", def: tacticDef("Discarded Tactic"), owner: P1, zone: "discard" },
      { key: "inVoid", def: tacticDef("Voided Tactic"), owner: P1, zone: "void" },
      ...extra
    ]
  });
}

clause(ELDRIDGE, "2:ability:eldridge-rite", "removes 2 tokens from itself and puts a tactic from your discard pile into your hand", () => {
  const game = riteBoard(2);
  activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } });
  assert.equal(tokens(game.engine, game.id("eg")), 0, "2 tokens removed");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("inDiscard")), "handOf(game.engine, P1).includes(game.id(\"inDiscard\"))");
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "can fetch a tactic from the void as well", () => {
  const game = riteBoard(2);
  activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inVoid")] } });
  assert.equal(zoneOf(game.engine, game.id("inVoid")), "hand");
  assert.equal(tokens(game.engine, game.id("eg")), 0);
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "removes exactly 2 tokens, however many it has (3 left 1, 5 left 3)", () => {
  for (const [start, left] of [[3, 1], [5, 3]]) {
    const game = riteBoard(start);
    activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } });
    assert.equal(tokens(game.engine, game.id("eg")), left, `${start} tokens`);
  }
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "the tokens are removed as a cost, before the ability resolves", () => {
  const game = riteBoard(2);
  game.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: game.id("eg"),
    abilityId: "eldridge-rite",
    selected: { t: [game.id("inDiscard")] },
    variables: {}
  } as never);
  assert.ok(game.engine.state.responseWindow, "the ability is waiting for responses");
  assert.equal(tokens(game.engine, game.id("eg")), 0, "COST: already removed");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "discard", "the tactic is only fetched on resolution");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "hand");
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "cannot be used with fewer than 2 tokens on Eldridge (1 token, or none)", () => {
  for (const count of [0, 1]) {
    const game = riteBoard(count);
    assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } }), `${count} tokens`);
    assert.equal(zoneOf(game.engine, game.id("inDiscard")), "discard");
    assert.equal(tokens(game.engine, game.id("eg")), count);
  }
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "tokens on other cards do not pay for it", () => {
  const game = riteBoard(1, [{ key: "loaded", def: character({ name: "Loaded" }), owner: P1, zone: "play", counters: { token: 5 } }]);
  assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } }));
  assert.equal(tokens(game.engine, game.id("loaded")), 5);
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "cannot pick a tactic that is not yours (in the opponent's discard pile or void)", () => {
  const game = riteBoard(2, [
    { key: "theirDiscard", def: tacticDef("Their Discarded"), owner: P2, zone: "discard" },
    { key: "theirVoid", def: tacticDef("Their Voided"), owner: P2, zone: "void" }
  ]);
  for (const key of ["theirDiscard", "theirVoid"]) {
    assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id(key)] } }), key);
  }
  assert.equal(tokens(game.engine, game.id("eg")), 2, "nothing was paid");
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "cannot pick anything that is not a tactic (a character in the discard pile or void)", () => {
  const game = riteBoard(2, [
    { key: "deadChar", def: character({ name: "Dead" }), owner: P1, zone: "discard" },
    { key: "voidChar", def: character({ name: "Voided" }), owner: P1, zone: "void" },
    { key: "deadItem", def: item({ name: "DeadItem" }), owner: P1, zone: "discard" }
  ]);
  for (const key of ["deadChar", "voidChar", "deadItem"]) {
    assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id(key)] } }), key);
  }
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "cannot pick a tactic from your hand, deck, or a face-down card in play", () => {
  const game = riteBoard(2, [
    { key: "inHand", def: tacticDef("In Hand"), owner: P1, zone: "hand" },
    { key: "inDeck", def: tacticDef("In Deck"), owner: P1, zone: "deck" },
    { key: "downTactic", def: tacticDef("Down"), owner: P1, zone: "play", faceDown: true }
  ]);
  for (const key of ["inHand", "inDeck", "downTactic"]) {
    assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id(key)] } }), key);
  }
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "needs a pick: with no pick (or no tactic available) it cannot be used", () => {
  const noPick = riteBoard(2);
  assert.throws(() => activate(noPick.engine, P1, noPick.id("eg"), "eldridge-rite"), "no pick");
  assert.equal(tokens(noPick.engine, noPick.id("eg")), 2);

  const nothingToPick = eldInPlayBoard({ tokens: 2 });
  assert.throws(() => activate(nothingToPick.engine, P1, nothingToPick.id("eg"), "eldridge-rite"), "no tactics in the discard or void");
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "picks exactly one tactic: two is refused", () => {
  const game = riteBoard(2);
  assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard"), game.id("inVoid")] } }));
  assert.equal(tokens(game.engine, game.id("eg")), 2);
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "has no deplete cost: works while Eldridge is depleted and leaves its state alone", () => {
  const game = riteBoard(2, [], true);
  activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } });
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "hand");
  const fresh = riteBoard(2);
  activate(fresh.engine, P1, fresh.id("eg"), "eldridge-rite", { selected: { t: [fresh.id("inDiscard")] } });
  assert.equal(fresh.engine.state.cards[fresh.id("eg")].depleted, false, "using it does not deplete");
  assert.equal(ready(fresh.engine, P1), 3, "and costs no resources");
});

clause(ELDRIDGE, "2:ability:eldridge-rite", "can be used again while 2 tokens remain, and is refused once they run out", () => {
  const game = riteBoard(4, [{ key: "second", def: tacticDef("Second"), owner: P1, zone: "discard" }]);
  activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inDiscard")] } });
  activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("second")] } });
  assert.equal(tokens(game.engine, game.id("eg")), 0);
  assert.equal(zoneOf(game.engine, game.id("second")), "hand");
  assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-rite", { selected: { t: [game.id("inVoid")] } }));
});

// -- TRIBUTE ----------------------------------------------------------------------

function tributeEldBoard(opts: { oppHand?: number; ownHand?: number; resources?: number; deck?: number } = {}) {
  return eldInPlayBoard({
    resources: opts.resources ?? 3,
    extra: [...handCards("o", opts.oppHand ?? 3, P2), ...handCards("m", opts.ownHand ?? 3, P1), ...deckCards("d", opts.deck ?? 4, P1)]
  });
}

const factionOf = (game: EldGame, player: PlayerId) => game.engine.state.players[player].factionId!;

clause(ELDRIDGE, "3:ability:eldridge-tribute", "pays 1 and destroys Eldridge as costs (both already done while the ability waits for responses)", () => {
  const game = tributeEldBoard();
  const before = ready(game.engine, P1);
  game.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: game.id("eg"),
    abilityId: "eldridge-tribute",
    selected: { p: [factionOf(game, P2)] },
    variables: {}
  } as never);
  assert.ok(game.engine.state.responseWindow, "waiting for responses");
  assert.equal(ready(game.engine, P1), before - 1, "paid exactly 1");
  assert.equal(zoneOf(game.engine, game.id("eg")), "discard", "destroyed as a cost");
  assert.equal(handOf(game.engine, P2).length, 3, "the effect has not happened yet");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "a picked opponent discards 2 cards of THEIR choice, and Eldridge's controller draws a card", () => {
  const game = tributeEldBoard();
  const myHand = handOf(game.engine, P1).length;
  const topOfMyDeck = deckOf(game.engine, P1)[0];
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P2)] } });
  // The destroyed trigger may be waiting first; decline it.
  let pc = pending(game.engine);
  if (pc?.kind === "selectTargets") answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
  pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the picked player chooses what to discard");
  answerChoice(game.engine, "chooserSelectsTarget", P2, { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o2")] });
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("o2")), "discard");
  assert.equal(zoneOf(game.engine, game.id("o1")), "hand", "only 2 cards are discarded");
  assert.equal(handOf(game.engine, P2).length, 1);
  assert.equal(handOf(game.engine, P1).length, myHand + 1, "the controller drew 1 and discarded nothing");
  assert.equal(zoneOf(game.engine, topOfMyDeck), "hand", "from the top of the controller's deck");
  assert.equal(handOf(game.engine, P2).includes(topOfMyDeck), false);
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "picking yourself: you discard 2 of your choice, then draw a card", () => {
  const game = tributeEldBoard();
  const topOfMyDeck = deckOf(game.engine, P1)[0];
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P1)] } });
  if (pending(game.engine)?.kind === "selectTargets") answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  // The drawn card is not yet in hand, so it can't be one of the 2 discards.
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("m0"), topOfMyDeck] } } as never)
  , "the card drawn afterwards is not a legal discard");
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [game.id("m0"), game.id("m1")] });
  assert.equal(zoneOf(game.engine, game.id("m0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("m1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("m2")), "hand");
  assert.equal(zoneOf(game.engine, topOfMyDeck), "hand", "then drew");
  assert.equal(handOf(game.engine, P2).length, 3, "the opponent's hand is untouched");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "an opponent with no cards in hand discards nothing, and you still draw", () => {
  const none = tributeEldBoard({ oppHand: 0, ownHand: 0 });
  const topNone = deckOf(none.engine, P1)[0];
  activate(none.engine, P1, none.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(none, P2)] } });
  drain(none.engine, declineAll);
  assert.equal(zoneOf(none.engine, topNone), "hand", "still draws");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "a picked opponent with only 1 card in hand discards that 1 card (and not the controller's cards instead)", () => {
  const game = tributeEldBoard({ oppHand: 1, ownHand: 3 });
  const top = deckOf(game.engine, P1)[0];
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P2)] } });
  if (pending(game.engine)?.kind === "selectTargets") answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerChoice(game.engine, "chooserSelectsTarget", P2, { kind: "chooserSelectsTarget", selected: [game.id("o0")] });
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard");
  assert.equal(zoneOf(game.engine, top), "hand", "the controller drew");
  for (const key of ["m0", "m1", "m2"]) assert.equal(zoneOf(game.engine, game.id(key)), "hand", `${key} untouched`);
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "the picked opponent can only discard cards from THEIR OWN hand, never the controller's", () => {
  const game = tributeEldBoard({ oppHand: 3, ownHand: 3 });
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P2)] } });
  if (pending(game.engine)?.kind === "selectTargets") answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("m0"), game.id("m1")] } } as never)
  , "the Eldridge controller's hand is not the picked player's hand");
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("m1")] } } as never)
  , "mixing in one of the controller's cards");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "picking yourself: you can only discard from your own hand, never the opponent's", () => {
  const game = tributeEldBoard({ oppHand: 3, ownHand: 3 });
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P1)] } });
  if (pending(game.engine)?.kind === "selectTargets") answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o1")] } } as never)
  , "the opponent's hand is not yours to discard from");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "the destroy cost triggers 'when this card is destroyed' (tokens go on the controller's other cards)", () => {
  const game = tributeEldBoard();
  activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P2)] } });
  drain(game.engine, pc => {
    if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { sprinkle: [game.id("c0")] } };
    if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 3 };
    if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: { [game.id("c0")]: 3 } };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o1")] };
    return declineAll(pc);
  });
  assert.equal(tokens(game.engine, game.id("c0")), 3);
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard", "and the effect still resolved");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "cannot be used without a resource to pay (all resources already spent)", () => {
  const game = tributeEldBoard({ resources: 0 });
  assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [factionOf(game, P2)] } }));
  assert.equal(zoneOf(game.engine, game.id("eg")), "play", "Eldridge was not destroyed");
  assert.equal(handOf(game.engine, P2).length, 3);
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "must pick a player: no pick, or a non-player card, is refused", () => {
  const noPick = tributeEldBoard();
  assert.throws(() => activate(noPick.engine, P1, noPick.id("eg"), "eldridge-tribute"));
  assert.equal(zoneOf(noPick.engine, noPick.id("eg")), "play");
  for (const key of ["c0", "opp"]) {
    const game = tributeEldBoard();
    assert.throws(() => activate(game.engine, P1, game.id("eg"), "eldridge-tribute", { selected: { p: [game.id(key)] } }), key);
    assert.equal(zoneOf(game.engine, game.id("eg")), "play");
  }
});

// --- Forbidden Bibliotheca ---------------------------------------------------
// UNIQUE BIBLIOTHECA. Location, cost 3, [O][O][O][O], printed structure 0.
// This card enters play with 3 tokens on it.
// This card gains 1 structure for each token on it.
// RESEARCH -- COST: Deplete this card. Put a token on this card. Pay 2. --
//   EFFECT: Draw 2 cards. Put a card from your hand on the bottom of your deck.
// CHECK OUT -- COST: Deplete this card. Remove 2 tokens from this card. --
//   EFFECT: Each opponent discards 2 cards.

const BIB = "dd781007-94ae-48b3-a0dc-7a3a3d983bcf";

/** Bibliotheca in hand (to deploy) with `resources` [O], plus a deck of cards. */
function bibDeployBoard(opts: { resources?: number; obsession?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bib", def: printing(BIB), owner: P1, zone: "hand" },
      ...bank(opts.obsession === false ? "rage" : "obsession", opts.resources ?? 4, P1),
      ...deckCards("d", 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Bibliotheca in play (as `bib`) with `tokens` tokens, an empty-handed controller and a stocked deck; resources are [O]. */
function bibBoard(opts: { tokens?: number; depleted?: boolean; resources?: number; damage?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bib", def: printing(BIB), owner: P1, zone: "play", counters: { token: opts.tokens ?? 3 }, depleted: opts.depleted, damage: opts.damage },
      ...bank("obsession", opts.resources ?? 4, P1),
      ...deckCards("d", 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type BibGame = ReturnType<typeof bibBoard>;

const structureOf = (game: BibGame) => game.engine.getStat(game.id("bib"), "structure");

clause(BIB, "0:unique", "controlling two Forbidden Bibliothecas makes you keep one, and the other is destroyed", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bib1", def: printing(BIB), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "bib2", def: printing(BIB), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("bib2"));
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [game.id("bib1"), game.id("bib2")].sort());
  answerChoice(game.engine, "uniqueSurvivor", P1, { kind: "uniqueSurvivor", keep: game.id("bib1") });
  assert.equal(zoneOf(game.engine, game.id("bib1")), "play");
  assert.equal(zoneOf(game.engine, game.id("bib2")), "discard");
});

clause(BIB, "0:unique", "choosing the newer one destroys the older one", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bib1", def: printing(BIB), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "bib2", def: printing(BIB), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("bib2"));
  answerChoice(game.engine, "uniqueSurvivor", P1, { kind: "uniqueSurvivor", keep: game.id("bib2") });
  assert.equal(zoneOf(game.engine, game.id("bib2")), "play");
  assert.equal(zoneOf(game.engine, game.id("bib1")), "discard");
  assert.equal(tokens(game.engine, game.id("bib2")), 3, "the survivor still has its entering tokens");
});

clause(BIB, "0:unique", "the restriction is per player: the opponent may control their own", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: printing(BIB), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(BIB), owner: P2, zone: "play", counters: { token: 3 } },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("mine"));
  assert.equal(pending(game.engine), undefined, "no Unique conflict");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
});

clause(BIB, "1:rule", "enters play with 3 tokens on it and stays in play", () => {
  const game = bibDeployBoard();
  play(game.engine, P1, game.id("bib"));
  assert.equal(zoneOf(game.engine, game.id("bib")), "play", "not destroyed for having 0 structure on the way in");
  assert.equal(tokens(game.engine, game.id("bib")), 3);
});

clause(BIB, "1:rule", "costs 3 and needs [O][O][O][O] to deploy", () => {
  const paid = bibDeployBoard({ resources: 5 });
  playRaw(paid.engine, P1, paid.id("bib"));
  assert.equal(ready(paid.engine, P1), 2, "exactly 3 of 5 resources paid");

  const short = bibDeployBoard({ resources: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bib")), "cost 3 with 2 resources");

  const threeObsession = bibDeployBoard({
    resources: 3,
    extra: bank("rage", 3, P1)
  });
  assert.throws(() => playRaw(threeObsession.engine, P1, threeObsession.id("bib")), "only three [O]");

  const wrongIcons = bibDeployBoard({ resources: 6, obsession: false });
  assert.throws(() => playRaw(wrongIcons.engine, P1, wrongIcons.id("bib")), "no [O] at all");
  assert.equal(zoneOf(wrongIcons.engine, wrongIcons.id("bib")), "hand");
});

clause(BIB, "1:rule", "also gets 3 tokens when it is put into play by an effect instead of deployed", () => {
  const reanimator = item({
    name: "Reanimator",
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "location" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator, owner: P1, zone: "play" },
      { key: "bib", def: printing(BIB), owner: P1, zone: "discard" }
    ]
  });
  activate(game.engine, P1, game.id("re"), "raise", { selected: { t: [game.id("bib")] } });
  assert.equal(zoneOf(game.engine, game.id("bib")), "play");
  assert.equal(tokens(game.engine, game.id("bib")), 3);
});

clause(BIB, "1:rule", "another card entering play does not give it tokens", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bib", def: printing(BIB), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(tokens(game.engine, game.id("bib")), 1);
});

clause(BIB, "2:rule", "has structure equal to its tokens: 3 tokens = 3 structure on entering play", () => {
  const game = bibDeployBoard();
  play(game.engine, P1, game.id("bib"));
  assert.equal(game.engine.getStat(game.id("bib"), "structure"), 3);
});

clause(BIB, "2:rule", "gains exactly 1 structure per token (1, 2, 5 and 7 tokens)", () => {
  for (const count of [1, 2, 5, 7]) {
    const game = bibBoard({ tokens: count });
    assert.equal(structureOf(game), count, `${count} tokens`);
  }
});

clause(BIB, "2:rule", "structure follows the tokens as they change", () => {
  const game = bibBoard({ tokens: 3 });
  assert.equal(structureOf(game), 3);
  game.engine.state.cards[game.id("bib")].counters.token = 5;
  assert.equal(structureOf(game), 5, "more tokens, more structure");
  game.engine.state.cards[game.id("bib")].counters.token = 1;
  assert.equal(structureOf(game), 1, "fewer tokens, less structure");
});

/** P2 attacks P1's Bibliotheca (with `tokenCount` tokens) with a lone attacker of the given strength, and the battle is resolved. */
function bibUnderAttack(tokenCount: number, strength: number) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "bib", def: printing(BIB), owner: P1, zone: "play", counters: { token: tokenCount } },
      { key: "foe", def: character({ name: "Foe", strength, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("foe")], target: { type: "card", cardId: game.id("bib") } });
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(game.engine);
  return game;
}

clause(BIB, "2:rule", "a Bibliotheca with 3 tokens is destroyed by 3 damage", () => {
  const game = bibUnderAttack(3, 3);
  assert.equal(zoneOf(game.engine, game.id("bib")), "discard");
});

clause(BIB, "2:rule", "a Bibliotheca with 3 tokens survives 2 damage, and keeps the damage", () => {
  const game = bibUnderAttack(3, 2);
  assert.equal(zoneOf(game.engine, game.id("bib")), "play");
  assert.equal(game.engine.state.cards[game.id("bib")].damage, 2);
});

clause(BIB, "2:rule", "more tokens means more durable: 4 tokens survive 3 damage and die to 4", () => {
  const survives = bibUnderAttack(4, 3);
  assert.equal(zoneOf(survives.engine, survives.id("bib")), "play");
  assert.equal(survives.engine.state.cards[survives.id("bib")].damage, 3);
  const dies = bibUnderAttack(4, 4);
  assert.equal(zoneOf(dies.engine, dies.id("bib")), "discard");
});

clause(BIB, "2:rule", "with no tokens it has 0 structure and is destroyed (damage 0 >= structure 0)", () => {
  const game = bibBoard({ tokens: 3, extra: [{ key: "kill", def: tokenRemover(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("bib")] } });
  assert.equal(tokens(game.engine, game.id("bib")), 0);
  assert.equal(zoneOf(game.engine, game.id("bib")), "discard");
});

/** A free tactic that removes all tokens from one chosen location (a way to drop Bibliotheca's tokens). */
function tokenRemover(): CardDefinition {
  return tactic({
    name: "Token Remover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 99 }]
        }
      ]
    }
  });
}

// -- RESEARCH --------------------------------------------------------------------

/** Activates RESEARCH and leaves the response window open (for checking costs before resolution). */
function startResearch(game: BibGame) {
  game.engine.perform({ type: "activateAbility", playerId: P1, cardId: game.id("bib"), abilityId: "bib-research", selected: {}, variables: {} } as never);
}

/** Runs RESEARCH to the point where the controller has to pick a card to bottom. */
function researchToBottomChoice(game: BibGame) {
  startResearch(game);
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "asked to put a card on the bottom");
  return pc!;
}

clause(BIB, "3:ability:bib-research", "depletes itself and pays 2 as costs", () => {
  const game = bibBoard({ resources: 4 });
  startResearch(game);
  assert.equal(game.engine.state.cards[game.id("bib")].depleted, true, "COST: deplete this card");
  assert.equal(ready(game.engine, P1), 2, "COST: pay 2 of the 4 resources");
});

clause(BIB, "3:ability:bib-research", "the token is put on the card as a COST (already there while the ability waits for responses)", () => {
  const game = bibBoard({ tokens: 3 });
  startResearch(game);
  assert.ok(game.engine.state.responseWindow, "the ability is waiting for responses");
  assert.equal(tokens(game.engine, game.id("bib")), 4, "COST: Put a token on this card");
  assert.equal(game.engine.state.players[P1].hand.length, 0, "the draw is only the effect");
});

clause(BIB, "3:ability:bib-research", "ends with one more token (and one more structure) than it started with", () => {
  const game = bibBoard({ tokens: 3 });
  researchToBottomChoice(game);
  const hand = handOf(game.engine, P1);
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [hand[0]] });
  assert.equal(tokens(game.engine, game.id("bib")), 4);
  assert.equal(structureOf(game), 4);
});

clause(BIB, "3:ability:bib-research", "draws 2 cards, then puts a card from hand on the bottom of the deck: net +1 card in hand", () => {
  const game = bibBoard();
  const deckBefore = [...deckOf(game.engine, P1)];
  const pc = researchToBottomChoice(game);
  assert.equal(pc.playerId, P1, "the controller chooses");
  const hand = [...handOf(game.engine, P1)];
  assert.deepEqual(hand, deckBefore.slice(0, 2), "drew the top 2 cards");
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [hand[1]] });
  assert.deepEqual(handOf(game.engine, P1), [hand[0]], "one of the two drawn cards was put away");
  const deck = deckOf(game.engine, P1);
  assert.equal(deck.length, deckBefore.length - 2 + 1);
  assert.equal(deck[deck.length - 1], hand[1], "on the bottom of the deck");
  assert.deepEqual(deck.slice(0, -1), deckBefore.slice(2), "the rest of the deck is untouched and in order");
});

clause(BIB, "3:ability:bib-research", "the card put on the bottom can be a card that was already in hand (it may be any card in hand)", () => {
  const game = bibBoard({ extra: handCards("h", 2, P1) });
  const pc = researchToBottomChoice(game);
  assert.equal(handOf(game.engine, P1).length, 4);
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [game.id("h0")] });
  assert.equal(zoneOf(game.engine, game.id("h0")), "deck");
  const deck = deckOf(game.engine, P1);
  assert.equal(deck[deck.length - 1], game.id("h0"));
  assert.equal(handOf(game.engine, P1).length, 3);
  void pc;
});

clause(BIB, "3:ability:bib-research", "puts exactly one card on the bottom: none, or two, is refused", () => {
  const game = bibBoard({ extra: handCards("h", 2, P1) });
  researchToBottomChoice(game);
  const attempt = (selected: string[]) =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  assert.throws(() => attempt([]), "none");
  assert.throws(() => attempt([game.id("h0"), game.id("h1")]), "two");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still waiting");
});

clause(BIB, "3:ability:bib-research", "only a card from YOUR hand can be put on the bottom", () => {
  const game = bibBoard({ extra: handCards("o", 2, P2) });
  researchToBottomChoice(game);
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("o0")] } } as never)
  );
  assert.equal(zoneOf(game.engine, game.id("o0")), "hand", "the opponent's card did not move");
});

clause(BIB, "3:ability:bib-research", "cannot be used while depleted (and does not draw or pay)", () => {
  const game = bibBoard({ depleted: true });
  assert.throws(() => startResearch(game));
  assert.equal(ready(game.engine, P1), 4);
  assert.equal(tokens(game.engine, game.id("bib")), 3);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(BIB, "3:ability:bib-research", "needs 2 resources: refused with 1, works with exactly 2", () => {
  const one = bibBoard({ resources: 1 });
  assert.throws(() => startResearch(one));
  assert.equal(one.engine.state.cards[one.id("bib")].depleted, false, "nothing was paid, nothing depleted");
  assert.equal(tokens(one.engine, one.id("bib")), 3);

  const two = bibBoard({ resources: 2 });
  startResearch(two);
  assert.equal(ready(two.engine, P1), 0);
});

clause(BIB, "3:ability:bib-research", "can only be used once per turn: depleting it is a cost", () => {
  const game = bibBoard({ resources: 6 });
  researchToBottomChoice(game);
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [handOf(game.engine, P1)[0]] });
  assert.throws(() => startResearch(game), "already depleted");
});

// -- CHECK OUT -------------------------------------------------------------------

function startCheckOut(game: BibGame) {
  game.engine.perform({ type: "activateAbility", playerId: P1, cardId: game.id("bib"), abilityId: "bib-checkout", selected: {}, variables: {} } as never);
}

clause(BIB, "4:ability:bib-checkout", "depletes itself and removes 2 tokens as costs (before the ability resolves)", () => {
  const game = bibBoard({ tokens: 4, extra: handCards("o", 3, P2) });
  startCheckOut(game);
  assert.ok(game.engine.state.responseWindow, "waiting for responses");
  assert.equal(game.engine.state.cards[game.id("bib")].depleted, true, "COST: deplete this card");
  assert.equal(tokens(game.engine, game.id("bib")), 2, "COST: remove 2 tokens");
  assert.equal(structureOf(game), 2, "structure follows");
  assert.equal(handOf(game.engine, P2).length, 3, "the discard is only the effect");
});

clause(BIB, "4:ability:bib-checkout", "each opponent discards 2 cards of THEIR choice", () => {
  const game = bibBoard({ tokens: 4, extra: [...handCards("o", 3, P2), ...handCards("m", 3, P1)] });
  startCheckOut(game);
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent chooses");
  answerChoice(game.engine, "chooserSelectsTarget", P2, { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o2")] });
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("o2")), "discard");
  assert.equal(zoneOf(game.engine, game.id("o1")), "hand", "exactly 2 are discarded");
  for (const key of ["m0", "m1", "m2"]) assert.equal(zoneOf(game.engine, game.id(key)), "hand", `${key}: the controller's own hand is untouched`);
});

clause(BIB, "4:ability:bib-checkout", "the opponent cannot discard cards from the controller's hand instead", () => {
  const game = bibBoard({ tokens: 4, extra: [...handCards("o", 3, P2), ...handCards("m", 3, P1)] });
  startCheckOut(game);
  resolvePendingResponses(game.engine);
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("m0"), game.id("m1")] } } as never)
  );
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("m1")] } } as never)
  );
});

clause(BIB, "4:ability:bib-checkout", "an opponent with a single card discards it; with no cards discards nothing", () => {
  const one = bibBoard({ tokens: 4, extra: [...handCards("o", 1, P2), ...handCards("m", 2, P1)] });
  startCheckOut(one);
  resolvePendingResponses(one.engine);
  answerChoice(one.engine, "chooserSelectsTarget", P2, { kind: "chooserSelectsTarget", selected: [one.id("o0")] });
  assert.equal(zoneOf(one.engine, one.id("o0")), "discard");
  assert.equal(zoneOf(one.engine, one.id("m0")), "hand");

  const none = bibBoard({ tokens: 4, extra: handCards("m", 2, P1) });
  startCheckOut(none);
  resolvePendingResponses(none.engine);
  drain(none.engine, declineAll);
  assert.equal(pending(none.engine), undefined);
  assert.equal(none.engine.state.players[P2].discard.length, 0);
  assert.equal(zoneOf(none.engine, none.id("m0")), "hand");
});

clause(BIB, "4:ability:bib-checkout", "removes exactly 2 tokens (4 -> 2, 5 -> 3)", () => {
  for (const [start, left] of [[4, 2], [5, 3]]) {
    const game = bibBoard({ tokens: start, extra: handCards("o", 2, P2) });
    startCheckOut(game);
    resolvePendingResponses(game.engine);
    drain(game.engine, pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o1")] } : declineAll(pc)));
    assert.equal(tokens(game.engine, game.id("bib")), left, `${start} tokens`);
    assert.equal(structureOf(game), left);
  }
});

clause(BIB, "4:ability:bib-checkout", "cannot be used with fewer than 2 tokens", () => {
  const game = bibBoard({ tokens: 1, extra: handCards("o", 2, P2) });
  assert.throws(() => startCheckOut(game));
  assert.equal(tokens(game.engine, game.id("bib")), 1);
  assert.equal(game.engine.state.cards[game.id("bib")].depleted, false);
});

clause(BIB, "4:ability:bib-checkout", "cannot be used while depleted", () => {
  const game = bibBoard({ tokens: 4, depleted: true, extra: handCards("o", 2, P2) });
  assert.throws(() => startCheckOut(game));
  assert.equal(tokens(game.engine, game.id("bib")), 4);
});

clause(BIB, "4:ability:bib-checkout", "costs no resources", () => {
  const game = bibBoard({ tokens: 4, resources: 0, extra: handCards("o", 2, P2) });
  startCheckOut(game);
  assert.equal(game.engine.state.cards[game.id("bib")].depleted, true);
});

clause(BIB, "4:ability:bib-checkout", "damage already on the location counts against the structure it keeps: 2 damage with 4 tokens survives, 3 damage does not", () => {
  const survives = bibBoard({ tokens: 4, damage: 1, extra: handCards("o", 2, P2) });
  startCheckOut(survives);
  resolvePendingResponses(survives.engine);
  drain(survives.engine, pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [survives.id("o0"), survives.id("o1")] } : declineAll(pc)));
  assert.equal(zoneOf(survives.engine, survives.id("bib")), "play", "structure 2, damage 1");

  const dies = bibBoard({ tokens: 4, damage: 2, extra: handCards("o", 2, P2) });
  startCheckOut(dies);
  resolvePendingResponses(dies.engine);
  drain(dies.engine, pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [dies.id("o0"), dies.id("o1")] } : declineAll(pc)));
  assert.equal(zoneOf(dies.engine, dies.id("bib")), "discard", "structure 2, damage 2");
});

// --- Gruesome Sand Beaver ----------------------------------------------------
// COVERT
// EXTRA COST: Pick a face-down resource you control and put it into its owner's hand.
// Character, cost 3, [O][O][O], 4/3/2.

const BEAVER = "b06870bd-3309-497b-83ca-6a2bbed38391";

const covertDef = (name: string, over: Partial<CardDefinition> = {}) => character({ name, strength: 1, life: 5, speed: 1, behavior: { keywords: ["covert"] }, ...over });

/** P1 (active) attacks P2's faction with `attackers` (placement keys); returns the game with the blocker step open. */
function attackWith(game: ReturnType<typeof buildGame>, attackers: string[]) {
  game.engine.perform({
    type: "declareAttack",
    playerId: P1,
    attackerIds: attackers.map(game.id),
    target: { type: "faction", playerId: P2 }
  });
  resolvePendingResponses(game.engine);
}

const declareBlock = (game: ReturnType<typeof buildGame>, blockers: string[]) =>
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map(game.id) });

function beaverCombat(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "bv", def: printing(BEAVER), owner: P1, zone: "play" }, ...extra]
  });
}

clause(BEAVER, "0:kw:COVERT", "has the COVERT keyword", () => {
  const game = beaverCombat();
  assert.ok(game.engine.getKeywords(game.id("bv")).includes("covert"), "game.engine.getKeywords(game.id(\"bv\")).includes(\"covert\")");
});

clause(BEAVER, "0:kw:COVERT", "cannot be blocked by a character without COVERT", () => {
  const game = beaverCombat([{ key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }]);
  attackWith(game, ["bv"]);
  assert.throws(() => declareBlock(game, ["plain"]));
  assert.ok(game.engine.state.battle?.blockingParty.length === 0 || game.engine.state.battle?.blockingParty === undefined, "no block took place");
});

clause(BEAVER, "0:kw:COVERT", "can be blocked by a character with COVERT", () => {
  const game = beaverCombat([{ key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" }]);
  attackWith(game, ["bv"]);
  declareBlock(game, ["spy"]);
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("spy")]);
});

clause(BEAVER, "0:kw:COVERT", "a blocking party that includes a non-COVERT character is not legal against it", () => {
  const game = beaverCombat([
    { key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" },
    { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }
  ]);
  attackWith(game, ["bv"]);
  assert.throws(() => declareBlock(game, ["spy", "plain"]));
});

clause(BEAVER, "0:kw:COVERT", "an attacking party that also holds a non-COVERT character is not a covert party: anyone can block", () => {
  const game = beaverCombat([
    { key: "mate", def: character({ name: "Mate", life: 9 }), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }
  ]);
  attackWith(game, ["bv", "mate"]);
  declareBlock(game, ["plain"]);
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("plain")]);
});

clause(BEAVER, "0:kw:COVERT", "as a blocker it can block a COVERT party", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "bv", def: printing(BEAVER), owner: P1, zone: "play" },
      { key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" }
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("spy")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("bv")] });
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("bv")]);
});

clause(BEAVER, "0:kw:COVERT", "as a blocker it can only block COVERT parties (covert characters may block only covert parties)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "bv", def: printing(BEAVER), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("plain")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  assert.throws(() => game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("bv")] }));
});

clause(BEAVER, "0:kw:COVERT", "an unblocked covert attack hits the faction for the Beaver's strength", () => {
  const game = beaverCombat([{ key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }]);
  const influenceBefore = game.engine.state.players[P2].influence;
  attackWith(game, ["bv"]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.players[P2].influence, influenceBefore - 4);
});

// -- EXTRA COST ---------------------------------------------------------------------

/** Beaver in hand with `banks` [O], one face-down resource (`fd`) of P1's, and spare cards for pick-refusal tests. */
function beaverDeployBoard(opts: { banks?: number; extra?: CardPlacement[]; faceDown?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bv", def: printing(BEAVER), owner: P1, zone: "hand" },
      ...bank("obsession", opts.banks ?? 3, P1),
      ...Array.from({ length: opts.faceDown ?? 1 }, (_, i) => ({ key: `fd${i}`, def: character({ name: `Down${i}` }), owner: P1, zone: "play" as const, faceDown: true })),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BEAVER, "1:extraCost", "deploys by returning one of your face-down resources to your hand; stats 4/3/2 and COVERT", () => {
  const game = beaverDeployBoard();
  const printed = printing(BEAVER);
  play(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd0")] } });
  assert.equal(zoneOf(game.engine, game.id("bv")), "play");
  assert.equal(zoneOf(game.engine, game.id("fd0")), "hand", "the face-down resource returned to hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("fd0")), "handOf(game.engine, P1).includes(game.id(\"fd0\"))");
  assert.equal(game.engine.state.cards[game.id("fd0")].faceDown, false, "it is an ordinary card in hand again");
  assert.equal(game.engine.getStat(game.id("bv"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("bv"), "life"), printed.life);
  assert.equal(game.engine.getStat(game.id("bv"), "speed"), printed.speed);
});

clause(BEAVER, "1:extraCost", "only the picked face-down resource returns; the others stay in play", () => {
  const game = beaverDeployBoard({ faceDown: 3 });
  play(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd1")] } });
  assert.equal(zoneOf(game.engine, game.id("fd1")), "hand");
  assert.equal(zoneOf(game.engine, game.id("fd0")), "play");
  assert.equal(zoneOf(game.engine, game.id("fd2")), "play");
  assert.equal(game.engine.state.cards[game.id("fd0")].faceDown, true);
});

clause(BEAVER, "1:extraCost", "costs 3 and needs [O][O][O]: pays exactly 3 resources (the returned one is not one of them)", () => {
  const game = beaverDeployBoard({ banks: 5 });
  const before = ready(game.engine, P1);
  assert.equal(before, 6, "5 banks and 1 face-down resource");
  play(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd0")] } });
  assert.equal(ready(game.engine, P1), 2, "6 - 1 returned - 3 paid");
});

clause(BEAVER, "1:extraCost", "refused one resource short: 3 [O] banks are needed besides the face-down resource that is returned", () => {
  const game = beaverDeployBoard({ banks: 2 });
  assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd0")] } }));
  assert.equal(zoneOf(game.engine, game.id("bv")), "hand");
  assert.equal(zoneOf(game.engine, game.id("fd0")), "play", "the face-down resource did not return");
});

clause(BEAVER, "1:extraCost", "refused without [O][O][O] (rage resources and face-down resources do not meet the threshold)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bv", def: printing(BEAVER), owner: P1, zone: "hand" },
      ...bank("rage", 5, P1),
      ...bank("obsession", 2, P1),
      ...volition(2, P1)
    ]
  });
  const fd = game.engine.state.players[P1].play.find(c => game.engine.state.cards[c].faceDown)!;
  assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [fd] } }));
  assert.equal(zoneOf(game.engine, game.id("bv")), "hand");
});

clause(BEAVER, "1:extraCost", "needs a pick: refused with no face-down resource picked, and with no face-down resource to pick", () => {
  const noPick = beaverDeployBoard();
  assert.throws(() => playRaw(noPick.engine, P1, noPick.id("bv")));
  assert.equal(zoneOf(noPick.engine, noPick.id("bv")), "hand");

  const none = beaverDeployBoard({ faceDown: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("bv")));
  assert.equal(zoneOf(none.engine, none.id("bv")), "hand");
});

clause(BEAVER, "1:extraCost", "cannot pick a face-up resource, even your own", () => {
  const game = beaverDeployBoard({ banks: 4 });
  const faceUp = game.engine.state.players[P1].play.find(c => game.engine.getDefinition(c).type === "resource" && !game.engine.state.cards[c].faceDown)!;
  assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [faceUp] } }));
  assert.equal(zoneOf(game.engine, faceUp), "play");
});

clause(BEAVER, "1:extraCost", "cannot pick a face-down resource an opponent controls", () => {
  const game = beaverDeployBoard({ extra: [{ key: "theirDown", def: character({ name: "TheirDown" }), owner: P2, zone: "play", faceDown: true }] });
  assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("theirDown")] } }));
  assert.equal(zoneOf(game.engine, game.id("theirDown")), "play");
});

clause(BEAVER, "1:extraCost", "cannot pick a face-up non-resource: a character or an item in play", () => {
  const game = beaverDeployBoard({
    extra: [
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" }
    ]
  });
  for (const key of ["ch", "it"]) assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [game.id(key)] } }), key);
  assert.equal(zoneOf(game.engine, game.id("ch")), "play");
});

clause(BEAVER, "1:extraCost", "picks exactly one: two face-down resources is refused", () => {
  const game = beaverDeployBoard({ faceDown: 2 });
  assert.throws(() => playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd0"), game.id("fd1")] } }));
  assert.equal(zoneOf(game.engine, game.id("fd0")), "play");
  assert.equal(zoneOf(game.engine, game.id("fd1")), "play");
});

clause(BEAVER, "1:extraCost", "a face-down resource you control but do not own goes to its OWNER's hand", () => {
  const game = beaverDeployBoard({
    extra: [{ key: "stolenDown", def: character({ name: "StolenDown" }), owner: P2, zone: "play", faceDown: true, controller: P1 }]
  });
  play(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("stolenDown")] } });
  assert.ok(handOf(game.engine, P2).includes(game.id("stolenDown")), "in its owner's hand");
  assert.ok(!handOf(game.engine, P1).includes(game.id("stolenDown")), "!handOf(game.engine, P1).includes(game.id(\"stolenDown\"))");
});

clause(BEAVER, "1:extraCost", "the picked face-down resource is already back in hand while the Beaver waits for responses (it is a cost)", () => {
  const game = beaverDeployBoard();
  playRaw(game.engine, P1, game.id("bv"), { selected: { fd: [game.id("fd0")] } });
  assert.ok(game.engine.state.responseWindow, "the Beaver is on the stack");
  assert.equal(zoneOf(game.engine, game.id("fd0")), "hand", "EXTRA COST: already returned");
});

// --- Guardbeast of Thabbash --------------------------------------------------
// [O][O][O][O]: COVERT
// [V][V][V][V]: This character can block COVERT parties and non-COVERT parties.
// Character, cost 7, [O], 4/3/5.

const GUARD = "f2890e06-fa66-41a2-b0f0-6e4b4807a907";

interface GuardOpts {
  /** Face-up [O] resources P1 controls. */
  o?: number;
  /** Face-down resources (each [V]) P1 controls. */
  v?: number;
  /** P2's own [O] / [V] (must never count for P1's Guardbeast). */
  oppO?: number;
  oppV?: number;
  extra?: CardPlacement[];
}

function guardBoard(opts: GuardOpts = {}, active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "gb", def: printing(GUARD), owner: P1, zone: "play" },
      ...bank("obsession", opts.o ?? 0, P1),
      ...volition(opts.v ?? 0, P1),
      ...bank("obsession", opts.oppO ?? 0, P2),
      ...volition(opts.oppV ?? 0, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const keywordsOf = (game: ReturnType<typeof buildGame>, key: string) => game.engine.getKeywords(game.id(key));

// -- [O][O][O][O]: COVERT ----------------------------------------------------------

clause(GUARD, "0:rule@oooo", "has COVERT while its controller controls [O][O][O][O]", () => {
  for (const o of [4, 5]) {
    const game = guardBoard({ o });
    assert.ok(keywordsOf(game, "gb").includes("covert"), `${o} [O]`);
  }
});

clause(GUARD, "0:rule@oooo", "has no COVERT with only 0, 1, 2 or 3 [O]", () => {
  for (const o of [0, 1, 2, 3]) {
    const game = guardBoard({ o });
    assert.ok(!keywordsOf(game, "gb").includes("covert"), `${o} [O]`);
  }
});

clause(GUARD, "0:rule@oooo", "other icons do not make up the [O]: four Rage resources, or four face-down resources, give no COVERT", () => {
  const rage = guardBoard({ extra: bank("rage", 4, P1) });
  assert.ok(!keywordsOf(rage, "gb").includes("covert"), "four [R]");
  const down = guardBoard({ v: 4 });
  assert.ok(!keywordsOf(down, "gb").includes("covert"), "four [V]");
  const mixed = guardBoard({ o: 2, extra: bank("rage", 2, P1) });
  assert.ok(!keywordsOf(mixed, "gb").includes("covert"), "two [O] and two [R]");
});

clause(GUARD, "0:rule@oooo", "the opponent's [O] do not count", () => {
  const game = guardBoard({ o: 2, oppO: 4 });
  assert.ok(!keywordsOf(game, "gb").includes("covert"), "!keywordsOf(game, \"gb\").includes(\"covert\")");
});

clause(GUARD, "0:rule@oooo", "COVERT is lost again when a resource leaves and [O][O][O][O] no longer holds", () => {
  const game = guardBoard({ o: 4, extra: [{ key: "k", def: resourceKiller(), owner: P1, zone: "hand" }] });
  assert.ok(keywordsOf(game, "gb").includes("covert"), "keywordsOf(game, \"gb\").includes(\"covert\")");
  const target = game.engine.state.players[P1].play.find(c => game.engine.getDefinition(c).type === "resource")!;
  play(game.engine, P1, game.id("k"), { selected: { t: [target] } });
  assert.equal(zoneOf(game.engine, target), "discard");
  assert.ok(!keywordsOf(game, "gb").includes("covert"), "3 [O] left");
});

/** A free tactic that destroys one chosen resource. */
function resourceKiller(): CardDefinition {
  return tactic({
    name: "Resource Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kr",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource", controller: "self" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

clause(GUARD, "0:rule@oooo", "resources spent on costs are still controlled: COVERT stays after paying with all four [O]", () => {
  const spender = item({
    name: "Spender",
    behavior: { abilities: [{ id: "spend", type: "activated", costs: [{ type: "payResources", amount: 4 }], effects: [] }] }
  });
  const game = guardBoard({ o: 4, extra: [{ key: "sp", def: spender, owner: P1, zone: "play" }] });
  activate(game.engine, P1, game.id("sp"), "spend");
  assert.equal(ready(game.engine, P1), 0, "all four are attached");
  assert.ok(keywordsOf(game, "gb").includes("covert"), "keywordsOf(game, \"gb\").includes(\"covert\")");
});

clause(GUARD, "0:rule@oooo", "with [O][O][O][O] an attack by the Guardbeast is a covert party: a non-COVERT character cannot block it", () => {
  const game = guardBoard({ o: 4, extra: [{ key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }] });
  attackWith(game, ["gb"]);
  assert.throws(() => declareBlock(game, ["plain"]));
});

clause(GUARD, "0:rule@oooo", "with [O][O][O] only, an attack by the Guardbeast can be blocked by a non-COVERT character", () => {
  const game = guardBoard({ o: 3, extra: [{ key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }] });
  attackWith(game, ["gb"]);
  declareBlock(game, ["plain"]);
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("plain")]);
});

clause(GUARD, "0:rule@oooo", "with [O][O][O][O] a COVERT character can block the Guardbeast's attack", () => {
  const game = guardBoard({ o: 4, extra: [{ key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" }] });
  attackWith(game, ["gb"]);
  declareBlock(game, ["spy"]);
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("spy")]);
});

// -- [V][V][V][V]: can block COVERT and non-COVERT parties --------------------------

/** P2 attacks P1 with `attacker` ("plain" or "spy"); P1 tries to block with `blockers`. Returns whether the block was accepted. */
function canBlock(opts: GuardOpts, attacker: "plain" | "spy", blockers: string[] = ["gb"], extra: CardPlacement[] = []): boolean {
  const game = guardBoard(
    {
      ...opts,
      extra: [
        { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" },
        { key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" },
        ...(opts.extra ?? []),
        ...extra
      ]
    },
    P2
  );
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id(attacker)], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  try {
    game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers.map(game.id) });
  } catch {
    return false;
  }
  return game.engine.state.battle?.blockingParty.length === blockers.length;
}

clause(GUARD, "1:rule@vvvv", "with [V][V][V][V] (and no COVERT of its own) it can block a COVERT party", () => {
  assert.equal(canBlock({ v: 4 }, "spy"), true);
});

clause(GUARD, "1:rule@vvvv", "with [V][V][V][V] it can still block a non-COVERT party", () => {
  assert.equal(canBlock({ v: 4 }, "plain"), true);
});

clause(GUARD, "1:rule@vvvv", "without [V][V][V][V] (3 face-down resources) and without COVERT it cannot block a COVERT party, but still blocks a non-COVERT one", () => {
  assert.equal(canBlock({ v: 3 }, "spy"), false);
  assert.equal(canBlock({ v: 3 }, "plain"), true);
});

clause(GUARD, "1:rule@vvvv", "other icons are not [V]: four face-up resources do not let it block a COVERT party", () => {
  assert.equal(canBlock({ o: 3 }, "spy"), false);
  assert.equal(canBlock({ extra: bank("rage", 4, P1) }, "spy"), false);
});

clause(GUARD, "1:rule@vvvv", "the opponent's face-down resources do not count", () => {
  assert.equal(canBlock({ v: 1, oppV: 4 }, "spy"), false);
});

clause(GUARD, "1:rule@vvvv", "with COVERT of its own ([O][O][O][O]) but no [V]: blocks COVERT parties only, not non-COVERT ones", () => {
  assert.equal(canBlock({ o: 4 }, "spy"), true);
  assert.equal(canBlock({ o: 4 }, "plain"), false);
});

clause(GUARD, "1:rule@vvvv", "with both [O][O][O][O] (COVERT) and [V][V][V][V]: blocks COVERT parties AND non-COVERT parties", () => {
  assert.equal(canBlock({ o: 4, v: 4 }, "spy"), true);
  assert.equal(canBlock({ o: 4, v: 4 }, "plain"), true);
});

clause(GUARD, "1:rule@vvvv", "with COVERT and only 3 [V] it is stuck with the covert restriction (cannot block a non-COVERT party)", () => {
  assert.equal(canBlock({ o: 4, v: 3 }, "plain"), false);
  assert.equal(canBlock({ o: 4, v: 3 }, "spy"), true);
});

clause(GUARD, "1:rule@vvvv", "the permission is only for the Guardbeast: another non-COVERT blocker still cannot join a block against a COVERT party", () => {
  const extra: CardPlacement[] = [{ key: "mate", def: character({ name: "Mate", life: 9 }), owner: P1, zone: "play" }];
  assert.equal(canBlock({ v: 4 }, "spy", ["mate"], extra), false, "mate alone");
  assert.equal(canBlock({ v: 4 }, "spy", ["gb", "mate"], extra), false, "Guardbeast plus mate");
  assert.equal(canBlock({ v: 4 }, "plain", ["gb", "mate"], extra), true, "against a non-COVERT party they can both block");
});

clause(GUARD, "1:rule@vvvv", "a second character of yours does not gain the ability to block COVERT parties", () => {
  const extra: CardPlacement[] = [{ key: "mate", def: character({ name: "Mate", life: 9 }), owner: P1, zone: "play" }];
  assert.equal(canBlock({ v: 4 }, "spy", ["mate"], extra), false);
});

// --- Hate of Man -------------------------------------------------------------
// This character loses 1 life and all non-Arcanist characters lose 1 strength for
// each token on this card.
// SPREAD THE HATE -- COST: Pay 2. Deplete this card. -- EFFECT: Put a token on this card.
// Character, cost 2, [O][O], 1/1/2 (strength/speed/life), Arcanist.

const HATE = "57e9f3a9-92c5-4e35-8a1b-31c27b204cfc";

/** An item giving every character +5 life, so Hate of Man can carry several tokens without dying in the middle of a test. */
function lifeAura(): CardDefinition {
  return item({
    name: "Life Aura",
    behavior: {
      abilities: [
        {
          id: "aura",
          type: "continuous",
          modifiers: [{ selector: { zone: "play", type: "character" }, stat: "life", operation: "add", value: 5 }]
        }
      ]
    }
  });
}

const tradeChar = (name: string, trade: CardDefinition["trade"], strength = 4) => character({ name, trade, strength, life: 9 });

function hateBoard(tokenCount: number, extra: CardPlacement[] = [], aura = true) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hom", def: printing(HATE), owner: P1, zone: "play", counters: tokenCount ? { token: tokenCount } : {} },
      ...(aura ? [{ key: "aura", def: lifeAura(), owner: P1, zone: "play" as const }] : []),
      { key: "myWarlord", def: tradeChar("My Warlord", "warlord"), owner: P1, zone: "play" },
      { key: "foeRogue", def: tradeChar("Foe Rogue", "rogue"), owner: P2, zone: "play" },
      ...extra
    ]
  });
}

const str = (game: ReturnType<typeof buildGame>, key: string) => game.engine.getStat(game.id(key), "strength");
const lifeOf = (game: ReturnType<typeof buildGame>, key: string) => game.engine.getStat(game.id(key), "life");

clause(HATE, "0:rule", "with no tokens it changes nothing: printed life and everyone's printed strength", () => {
  const game = hateBoard(0, [], false);
  assert.equal(lifeOf(game, "hom"), printing(HATE).life);
  assert.equal(str(game, "myWarlord"), 4);
  assert.equal(str(game, "foeRogue"), 4);
});

clause(HATE, "0:rule", "loses 1 life for each token on it (1, 2 and 3 tokens)", () => {
  const printed = printing(HATE);
  for (const count of [1, 2, 3]) {
    const game = hateBoard(count);
    assert.equal(lifeOf(game, "hom"), printed.life! + 5 - count, `${count} tokens`);
  }
});

clause(HATE, "0:rule", "its own strength and speed are not changed by its tokens (it is an Arcanist)", () => {
  const printed = printing(HATE);
  const game = hateBoard(3);
  assert.equal(str(game, "hom"), printed.strength);
  assert.equal(game.engine.getStat(game.id("hom"), "speed"), printed.speed);
});

clause(HATE, "0:rule", "every non-Arcanist character loses 1 strength per token, whoever controls it (1, 2, 3 tokens)", () => {
  for (const count of [1, 2, 3]) {
    const game = hateBoard(count);
    assert.equal(str(game, "myWarlord"), 4 - count, `own warlord, ${count} tokens`);
    assert.equal(str(game, "foeRogue"), 4 - count, `opposing rogue, ${count} tokens`);
  }
});

clause(HATE, "0:rule", "every non-Arcanist trade is affected: warlord, banker, gearsmith, rogue and universal characters", () => {
  const game = hateBoard(2, [
    { key: "banker", def: tradeChar("Banker", "banker"), owner: P1, zone: "play" },
    { key: "gear", def: tradeChar("Gearsmith", "gearsmith"), owner: P2, zone: "play" },
    { key: "uni", def: tradeChar("Universal", "universal"), owner: P1, zone: "play" }
  ]);
  for (const key of ["myWarlord", "foeRogue", "banker", "gear", "uni"]) assert.equal(str(game, key), 2, key);
});

clause(HATE, "0:rule", "Arcanist characters are not affected, whoever controls them (including other Hate of Mans)", () => {
  const game = hateBoard(2, [
    { key: "myArc", def: tradeChar("My Arcanist", "arcanist"), owner: P1, zone: "play" },
    { key: "foeArc", def: tradeChar("Foe Arcanist", "arcanist"), owner: P2, zone: "play" }
  ]);
  assert.equal(str(game, "myArc"), 4);
  assert.equal(str(game, "foeArc"), 4);
});

clause(HATE, "0:rule", "strength cannot drop below 0 (CR 410.4): a 1-strength character with 3 tokens on Hate of Man has 0 strength, not -2", () => {
  const game = hateBoard(3, [{ key: "weak", def: character({ name: "Weak", trade: "warlord", strength: 1, life: 9 }), owner: P2, zone: "play" }]);
  assert.equal(str(game, "weak"), 0);
});

clause(HATE, "0:rule", "only tokens on this card count: tokens on other cards change nothing", () => {
  const game = hateBoard(1, [{ key: "loaded", def: character({ name: "Loaded", trade: "warlord", strength: 4, life: 9 }), owner: P2, zone: "play", counters: { token: 4 } }]);
  assert.equal(str(game, "myWarlord"), 3, "only the 1 token on Hate of Man");
  assert.equal(str(game, "loaded"), 3, "its own 4 tokens are irrelevant");
  assert.equal(lifeOf(game, "hom"), printing(HATE).life! + 5 - 1);
});

clause(HATE, "0:rule", "two Hate of Mans stack: each applies its own tokens to everyone, and only reduces its own life", () => {
  const printed = printing(HATE);
  const game = hateBoard(1, [{ key: "hom2", def: printing(HATE), owner: P2, zone: "play", counters: { token: 2 } }]);
  assert.equal(str(game, "myWarlord"), 4 - 3, "1 + 2 tokens");
  assert.equal(str(game, "foeRogue"), 4 - 3);
  assert.equal(lifeOf(game, "hom"), printed.life! + 5 - 1, "first loses 1 life");
  assert.equal(lifeOf(game, "hom2"), printed.life! + 5 - 2, "second loses 2 life");
  assert.equal(str(game, "hom"), printed.strength, "Arcanists stay put");
});

clause(HATE, "0:rule", "the strength loss ends when Hate of Man leaves play", () => {
  const game = hateBoard(2, [{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }]);
  assert.equal(str(game, "foeRogue"), 2);
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("hom")] } });
  assert.equal(zoneOf(game.engine, game.id("hom")), "discard");
  assert.equal(str(game, "foeRogue"), 4);
  assert.equal(str(game, "myWarlord"), 4);
});

clause(HATE, "0:rule", "the life it loses makes it die sooner: with 1 token, 1 damage destroys it; with none, 1 damage does not", () => {
  const hurt = tactic({
    name: "Ping",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ping",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const withToken = hateBoard(1, [{ key: "ping", def: hurt, owner: P1, zone: "hand" }], false);
  play(withToken.engine, P1, withToken.id("ping"), { selected: { t: [withToken.id("hom")] } });
  assert.equal(zoneOf(withToken.engine, withToken.id("hom")), "discard", "life 1, 1 damage");

  const noToken = hateBoard(0, [{ key: "ping", def: hurt, owner: P1, zone: "hand" }], false);
  play(noToken.engine, P1, noToken.id("ping"), { selected: { t: [noToken.id("hom")] } });
  assert.equal(zoneOf(noToken.engine, noToken.id("hom")), "play", "life 2, 1 damage");
});

clause(HATE, "0:rule", "a Hate of Man whose tokens bring its life to 0 is destroyed (2 tokens on a 2-life character)", () => {
  const game = hateBoard(2, [{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }], false);
  assert.equal(lifeOf(game, "hom"), 0, "control: the 2 tokens take its life to 0");
  // Any action runs the state-based check; destroying someone else's character is a neutral one.
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("foeRogue")] } });
  assert.equal(zoneOf(game.engine, game.id("hom")), "discard", "0 life with 0 damage is lethal (damage >= life)");
});

// -- SPREAD THE HATE ----------------------------------------------------------------

function startSpread(game: ReturnType<typeof buildGame>) {
  game.engine.perform({ type: "activateAbility", playerId: P1, cardId: game.id("hom"), abilityId: "hate-of-man-spread", selected: {}, variables: {} } as never);
}

function spreadBoard(opts: { resources?: number; tokens?: number; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hom", def: printing(HATE), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : {}, depleted: opts.depleted },
      { key: "aura", def: lifeAura(), owner: P1, zone: "play" },
      { key: "foe", def: tradeChar("Foe", "rogue"), owner: P2, zone: "play" },
      ...bank("obsession", opts.resources ?? 4, P1)
    ]
  });
}

clause(HATE, "1:ability:hate-of-man-spread", "pays 2 resources and depletes itself as costs", () => {
  const game = spreadBoard({ resources: 4 });
  startSpread(game);
  assert.equal(ready(game.engine, P1), 2, "paid exactly 2 of 4");
  assert.equal(game.engine.state.cards[game.id("hom")].depleted, true);
});

clause(HATE, "1:ability:hate-of-man-spread", "puts a token on it when it resolves (not before), and the token takes effect", () => {
  const game = spreadBoard();
  startSpread(game);
  assert.equal(tokens(game.engine, game.id("hom")), 0, "the token is the EFFECT, not a cost");
  resolvePendingResponses(game.engine);
  assert.equal(tokens(game.engine, game.id("hom")), 1);
  assert.equal(str(game, "foe"), 3, "the foe lost 1 strength");
  assert.equal(lifeOf(game, "hom"), printing(HATE).life! + 5 - 1);
});

clause(HATE, "1:ability:hate-of-man-spread", "adds one token per use: a second use after restoring makes 2", () => {
  const game = spreadBoard({ resources: 4, tokens: 1 });
  startSpread(game);
  resolvePendingResponses(game.engine);
  assert.equal(tokens(game.engine, game.id("hom")), 2);
  assert.equal(str(game, "foe"), 2);
  game.engine.state.cards[game.id("hom")].depleted = false;
  startSpread(game);
  resolvePendingResponses(game.engine);
  assert.equal(tokens(game.engine, game.id("hom")), 3);
});

clause(HATE, "1:ability:hate-of-man-spread", "cannot be used while depleted: it is used once per restore", () => {
  const game = spreadBoard({ depleted: true });
  assert.throws(() => startSpread(game));
  assert.equal(ready(game.engine, P1), 4, "nothing was paid");
  assert.equal(tokens(game.engine, game.id("hom")), 0);

  const used = spreadBoard();
  startSpread(used);
  resolvePendingResponses(used.engine);
  assert.throws(() => startSpread(used), "depleted by its first use");
});

clause(HATE, "1:ability:hate-of-man-spread", "needs 2 resources: refused with 1, allowed with exactly 2", () => {
  const one = spreadBoard({ resources: 1 });
  assert.throws(() => startSpread(one));
  assert.equal(one.engine.state.cards[one.id("hom")].depleted, false);
  assert.equal(tokens(one.engine, one.id("hom")), 0);

  const two = spreadBoard({ resources: 2 });
  startSpread(two);
  resolvePendingResponses(two.engine);
  assert.equal(tokens(two.engine, two.id("hom")), 1);
  assert.equal(ready(two.engine, P1), 0);
});

clause(HATE, "1:ability:hate-of-man-spread", "can be used the turn it enters play (abilities have no summoning sickness)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hom", def: printing(HATE), owner: P1, zone: "hand" },
      { key: "aura", def: lifeAura(), owner: P1, zone: "play" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("hom"));
  assert.equal(zoneOf(game.engine, game.id("hom")), "play");
  activate(game.engine, P1, game.id("hom"), "hate-of-man-spread");
  assert.equal(tokens(game.engine, game.id("hom")), 1);
});

clause(HATE, "1:ability:hate-of-man-spread", "the opponent cannot use it", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "hom", def: printing(HATE), owner: P1, zone: "play" },
      ...bank("obsession", 4, P1),
      ...bank("rage", 4, P2)
    ]
  });
  assert.throws(() => game.engine.perform({ type: "activateAbility", playerId: P2, cardId: game.id("hom"), abilityId: "hate-of-man-spread", selected: {}, variables: {} } as never));
  assert.equal(tokens(game.engine, game.id("hom")), 0);
});

// --- Ignatius Gloamspike -----------------------------------------------------
// UNIQUE IGNATIOUS
// When this card attacks, look at the top 2 cards of your deck. You may put any
// number of those cards on the bottom of your deck in any order. Put the remaining
// cards on the top of your deck in any order.
// When this card inflicts damage to a faction, look at the top 2 cards of the
// faction's controller's deck. Put any number of those cards on the bottom of their
// deck in any order. Put the remaining cards on the top of their deck in any order.
// Draw a card.
// Character, cost 4, [O][O][O], 1/3/5 (strength/speed/life).

const IGNATIUS = "7b6a4bfc-b116-4695-a4d8-86f59e0b140c";

function ignatiusBoard(extra: CardPlacement[] = [], opts: { deckA?: number; deckB?: number; igOwner?: PlayerId; active?: PlayerId } = {}) {
  const igOwner = opts.igOwner ?? P1;
  const active = opts.active ?? igOwner;
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "ig", def: printing(IGNATIUS), owner: igOwner, zone: "play" },
      ...deckCards("d", opts.deckA ?? 5, P1),
      ...deckCards("z", opts.deckB ?? 5, P2),
      ...extra
    ]
  });
}

type IgGame = ReturnType<typeof ignatiusBoard>;

function igAttack(game: IgGame, attackers: string[], target: { type: "faction"; playerId: PlayerId } | { type: "card"; key: string } = { type: "faction", playerId: P2 }, attacker: PlayerId = P1): void {
  game.engine.perform({
    type: "declareAttack",
    playerId: attacker,
    attackerIds: attackers.map(game.id),
    target: target.type === "faction" ? target : { type: "card", cardId: game.id(target.key) }
  });
}

const igReorder = (game: IgGame) => pending(game.engine) as unknown as PendingChoiceLike & { cardIds: string[]; deckOwnerId?: string; to?: string };

clause(IGNATIUS, "0:unique", "controlling a second IGNATIOUS (another Ignatius) makes you keep one; the other is destroyed", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ig1", def: printing(IGNATIUS), owner: P1, zone: "play" },
      { key: "ig2", def: printing(IGNATIUS), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("ig2"));
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  answerChoice(game.engine, "uniqueSurvivor", P1, { kind: "uniqueSurvivor", keep: game.id("ig1") });
  assert.equal(zoneOf(game.engine, game.id("ig1")), "play");
  assert.equal(zoneOf(game.engine, game.id("ig2")), "discard");
});

clause(IGNATIUS, "0:unique", "choosing the newer Ignatius destroys the older one", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ig1", def: printing(IGNATIUS), owner: P1, zone: "play" },
      { key: "ig2", def: printing(IGNATIUS), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("ig2"));
  answerChoice(game.engine, "uniqueSurvivor", P1, { kind: "uniqueSurvivor", keep: game.id("ig2") });
  assert.equal(zoneOf(game.engine, game.id("ig2")), "play");
  assert.equal(zoneOf(game.engine, game.id("ig1")), "discard");
});

clause(IGNATIUS, "0:unique", "a different card with the same IGNATIOUS designation counts as a duplicate", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Ignatious, Tactician Crafter", unique: "ignatious" }), owner: P1, zone: "play" },
      { key: "ig", def: printing(IGNATIUS), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("ig"));
  assert.equal(pending(game.engine)?.kind, "uniqueSurvivor");
  answerChoice(game.engine, "uniqueSurvivor", P1, { kind: "uniqueSurvivor", keep: game.id("other") });
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
  assert.equal(zoneOf(game.engine, game.id("ig")), "discard");
});

clause(IGNATIUS, "0:unique", "the restriction is per player: the opponent may control their own Ignatius", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: printing(IGNATIUS), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(IGNATIUS), owner: P2, zone: "play" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("mine"));
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
});

clause(IGNATIUS, "0:unique", "a card with a different designation is not a duplicate", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Someone", unique: "someone" }), owner: P1, zone: "play" },
      { key: "ig", def: printing(IGNATIUS), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(game.engine, P1, game.id("ig"));
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("ig")), "play");
});

// -- When this card attacks --------------------------------------------------------

clause(IGNATIUS, "1:rule", "when it attacks, its controller looks at exactly the top 2 cards of their own deck", () => {
  const game = ignatiusBoard();
  const deck = [...deckOf(game.engine, P1)];
  igAttack(game, ["ig"]);
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, deck.slice(0, 2));
  assert.equal(pc.to, "split", "may bottom any number");
  assert.ok(pc.deckOwnerId === undefined || pc.deckOwnerId === P1, "their own deck");
});

clause(IGNATIUS, "1:rule", "may put one card on the bottom and the other on top", () => {
  const game = ignatiusBoard();
  const [t0, t1, t2, t3, t4] = deckOf(game.engine, P1);
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [t1], bottom: [t0] });
  assert.deepEqual(deckOf(game.engine, P1), [t1, t2, t3, t4, t0]);
});

clause(IGNATIUS, "1:rule", "may put both on the bottom in either order", () => {
  const a = ignatiusBoard();
  const [a0, a1, a2, a3, a4] = deckOf(a.engine, P1);
  igAttack(a, ["ig"]);
  answerChoice(a.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [], bottom: [a1, a0] });
  assert.deepEqual(deckOf(a.engine, P1), [a2, a3, a4, a1, a0]);

  const b = ignatiusBoard();
  const [b0, b1, b2, b3, b4] = deckOf(b.engine, P1);
  igAttack(b, ["ig"]);
  answerChoice(b.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [], bottom: [b0, b1] });
  assert.deepEqual(deckOf(b.engine, P1), [b2, b3, b4, b0, b1]);
});

clause(IGNATIUS, "1:rule", "may keep both on top, swapped or in the same order", () => {
  const swapped = ignatiusBoard();
  const [s0, s1, s2, s3, s4] = deckOf(swapped.engine, P1);
  igAttack(swapped, ["ig"]);
  answerChoice(swapped.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [s1, s0], bottom: [] });
  assert.deepEqual(deckOf(swapped.engine, P1), [s1, s0, s2, s3, s4]);

  const same = ignatiusBoard();
  const before = [...deckOf(same.engine, P1)];
  igAttack(same, ["ig"]);
  answerChoice(same.engine, "reorderDeck", P1, { kind: "reorderDeck", order: before.slice(0, 2), bottom: [] });
  assert.deepEqual(deckOf(same.engine, P1), before);
});

clause(IGNATIUS, "1:rule", "only the top 2 are involved: the rest of the deck is untouched, and the opponent's deck is not looked at", () => {
  const game = ignatiusBoard();
  const oppDeck = [...deckOf(game.engine, P2)];
  const [t0, t1, ...rest] = deckOf(game.engine, P1);
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [t1], bottom: [t0] });
  assert.deepEqual(deckOf(game.engine, P1).slice(1, -1), rest);
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
});

clause(IGNATIUS, "1:rule", "with a 1-card deck it looks at that 1 card", () => {
  const game = ignatiusBoard([], { deckA: 1 });
  const deck = [...deckOf(game.engine, P1)];
  igAttack(game, ["ig"]);
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, deck);
});

clause(IGNATIUS, "1:rule", "triggers once when it attacks as part of a larger party", () => {
  const game = ignatiusBoard([{ key: "mate", def: character({ name: "Mate", life: 9 }), owner: P1, zone: "play" }]);
  igAttack(game, ["ig", "mate"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  assert.equal(pending(game.engine), undefined, "asked only once");
});

clause(IGNATIUS, "1:rule", "does not trigger when a different character attacks while Ignatius stays home", () => {
  const game = ignatiusBoard([{ key: "mate", def: character({ name: "Mate", life: 9 }), owner: P1, zone: "play" }]);
  igAttack(game, ["mate"]);
  assert.equal(pending(game.engine), undefined);
});

clause(IGNATIUS, "1:rule", "does not trigger when Ignatius blocks (defending is not attacking)", () => {
  const game = ignatiusBoard([{ key: "foe", def: character({ name: "Foe", life: 9 }), owner: P1, zone: "play" }], { igOwner: P2, active: P1 });
  // P2 owns Ignatius here; P1 is the active player attacking with `foe`.
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("foe")], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("ig")] });
  assert.equal(pending(game.engine), undefined, "blocking triggers nothing");
});

clause(IGNATIUS, "1:rule", "the trigger belongs to the Ignatius' controller: an opposing Ignatius attacking looks at ITS controller's deck", () => {
  const game = ignatiusBoard([], { igOwner: P2 });
  const p1Deck = [...deckOf(game.engine, P1)];
  const p2Deck = [...deckOf(game.engine, P2)];
  igAttack(game, ["ig"], { type: "faction", playerId: P1 }, P2);
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P2);
  assert.deepEqual(pc.cardIds, p2Deck.slice(0, 2));
  assert.deepEqual(deckOf(game.engine, P1), p1Deck);
});

clause(IGNATIUS, "1:rule", "also triggers when it attacks a location rather than a faction", () => {
  const game = ignatiusBoard([{ key: "loc", def: location({ name: "Loc", structure: 9 }), owner: P2, zone: "play" }]);
  const deck = [...deckOf(game.engine, P1)];
  igAttack(game, ["ig"], { type: "card", key: "loc" });
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, deck.slice(0, 2));
});

// -- When this card inflicts damage to a faction -----------------------------------

/**
 * Ignatius attacks P2's faction, the attack trigger is answered by keeping the order, nobody blocks,
 * and the battle runs until the damage trigger asks for its arrangement.
 */
function ignatiusUnblockedHit(extra: CardPlacement[] = [], opts: { deckB?: number } = {}) {
  const game = ignatiusBoard(extra, opts);
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  return game;
}

clause(IGNATIUS, "2:rule", "after hitting a faction its controller looks at the top 2 cards of THE FACTION CONTROLLER's deck", () => {
  const game = ignatiusBoard();
  const oppDeck = [...deckOf(game.engine, P2)];
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "Ignatius' controller decides");
  assert.equal(pc.deckOwnerId, P2, "about the faction controller's deck");
  assert.deepEqual(pc.cardIds, oppDeck.slice(0, 2));
});

clause(IGNATIUS, "2:rule", "the opponent's top cards can be sent to the bottom in any order, the rest left on top in any order", () => {
  const game = ignatiusUnblockedHit();
  const [z0, z1, z2, z3, z4] = deckOf(game.engine, P2);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [z1], bottom: [z0] });
  assert.deepEqual(deckOf(game.engine, P2), [z1, z2, z3, z4, z0]);
});

clause(IGNATIUS, "2:rule", "both of the opponent's cards can go to the bottom in a chosen order, or stay on top reordered", () => {
  const a = ignatiusUnblockedHit();
  const [a0, a1, a2, a3, a4] = deckOf(a.engine, P2);
  answerChoice(a.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [], bottom: [a1, a0] });
  assert.deepEqual(deckOf(a.engine, P2), [a2, a3, a4, a1, a0]);

  const b = ignatiusUnblockedHit();
  const [b0, b1, b2, b3, b4] = deckOf(b.engine, P2);
  answerChoice(b.engine, "reorderDeck", P1, { kind: "reorderDeck", order: [b1, b0], bottom: [] });
  assert.deepEqual(deckOf(b.engine, P2), [b1, b0, b2, b3, b4]);
});

clause(IGNATIUS, "2:rule", "afterwards its controller draws a card from their own deck (the opponent's hand and deck sizes are unchanged)", () => {
  const game = ignatiusUnblockedHit();
  const myTop = deckOf(game.engine, P1)[0];
  const myHand = handOf(game.engine, P1).length;
  const oppHand = handOf(game.engine, P2).length;
  const oppDeckSize = deckOf(game.engine, P2).length;
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P2).slice(0, 2), bottom: [] });
  assert.equal(handOf(game.engine, P1).length, myHand + 1);
  assert.equal(zoneOf(game.engine, myTop), "hand", "from the top of the controller's deck");
  assert.equal(handOf(game.engine, P2).length, oppHand);
  assert.equal(deckOf(game.engine, P2).length, oppDeckSize);
});

clause(IGNATIUS, "2:rule", "the faction damage still hits: the faction loses influence equal to Ignatius' strength", () => {
  const game = ignatiusBoard();
  const before = game.engine.state.players[P2].influence;
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.players[P2].influence, before - 1);
});

clause(IGNATIUS, "2:rule", "with a 1-card opposing deck it looks at that 1 card", () => {
  const game = ignatiusUnblockedHit([], { deckB: 1 });
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.cardIds.length, 1);
});

clause(IGNATIUS, "2:rule", "does not trigger when Ignatius is blocked and its damage goes to a character", () => {
  const game = ignatiusBoard([{ key: "blocker", def: character({ name: "Blocker", life: 9, strength: 0 }), owner: P2, zone: "play" }]);
  const myHand = handOf(game.engine, P1).length;
  const before = game.engine.state.players[P2].influence;
  igAttack(game, ["ig"]);
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("blocker")] });
  autoResolveBattle(game.engine);
  assert.equal(pending(game.engine), undefined, "no second prompt");
  assert.equal(game.engine.state.cards[game.id("blocker")].damage, 1, "the damage went to the blocker");
  assert.equal(game.engine.state.players[P2].influence, before);
  assert.equal(handOf(game.engine, P1).length, myHand, "no card drawn");
});

clause(IGNATIUS, "2:rule", "does not trigger when it damages a location", () => {
  const game = ignatiusBoard([{ key: "loc", def: location({ name: "Loc", structure: 9 }), owner: P2, zone: "play" }]);
  const myHand = handOf(game.engine, P1).length;
  igAttack(game, ["ig"], { type: "card", key: "loc" });
  answerChoice(game.engine, "reorderDeck", P1, { kind: "reorderDeck", order: deckOf(game.engine, P1).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("loc")].damage, 1);
  assert.equal(pending(game.engine), undefined, "no second prompt");
  assert.equal(handOf(game.engine, P1).length, myHand, "no card drawn");
});

clause(IGNATIUS, "2:rule", "does not trigger when ANOTHER character of its controller damages the faction", () => {
  const game = ignatiusBoard([{ key: "mate", def: character({ name: "Mate", life: 9, strength: 2 }), owner: P1, zone: "play" }]);
  const myHand = handOf(game.engine, P1).length;
  const oppDeck = [...deckOf(game.engine, P2)];
  const before = game.engine.state.players[P2].influence;
  igAttack(game, ["mate"]);
  assert.equal(pending(game.engine), undefined, "Ignatius is not attacking");
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.players[P2].influence, before - 2);
  assert.equal(pending(game.engine), undefined);
  assert.equal(handOf(game.engine, P1).length, myHand);
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
});

clause(IGNATIUS, "2:rule", "an opposing Ignatius hitting my faction gives ITS controller the arrangement of MY deck and its draw", () => {
  const game = ignatiusBoard([], { igOwner: P2 });
  const myDeck = [...deckOf(game.engine, P1)];
  const theirHand = handOf(game.engine, P2).length;
  igAttack(game, ["ig"], { type: "faction", playerId: P1 }, P2);
  answerChoice(game.engine, "reorderDeck", P2, { kind: "reorderDeck", order: deckOf(game.engine, P2).slice(0, 2), bottom: [] });
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(game.engine);
  const pc = igReorder(game);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P2);
  assert.equal(pc.deckOwnerId, P1);
  assert.deepEqual(pc.cardIds, myDeck.slice(0, 2));
  answerChoice(game.engine, "reorderDeck", P2, { kind: "reorderDeck", order: [], bottom: [pc.cardIds[0], pc.cardIds[1]] });
  assert.equal(handOf(game.engine, P2).length, theirHand + 1);
});

// --- Meh, another Living God -------------------------------------------------
// FLIP UP: 7 [O]
// Character, cost 8, [O], 6/1/6 (strength/speed/life), subtype god.

const MEH = "ac36f169-a54b-4992-aa1e-b9a4cf2aac70";

function mehBoard(opts: { obsession?: number; rage?: number; oppObsession?: number; faceDown?: boolean; active?: PlayerId; zone?: "play" | "hand" } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "meh", def: printing(MEH), owner: P1, zone: opts.zone ?? "play", faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown ?? true : undefined },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("obsession", opts.oppObsession ?? 0, P2)
    ]
  });
}

type MehGame = ReturnType<typeof mehBoard>;

const flipUp = (game: MehGame, player: PlayerId = P1) =>
  flipUpNow(game.engine, { type: "flipUp", playerId: player, cardId: game.id("meh"), selected: {}, variables: {} });

clause(MEH, "0:flipUp", "a face-down Meh flips up into a face-up character in play with its printed stats", () => {
  const printed = printing(MEH);
  const game = mehBoard({ obsession: 7 });
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
  flipUp(game);
  resolvePendingResponses(game.engine);
  const meh = game.engine.state.cards[game.id("meh")];
  assert.equal(meh.zone, "play");
  assert.equal(meh.faceDown, false);
  assert.deepEqual(game.engine.getCardTypes(game.id("meh")), ["character"]);
  assert.equal(game.engine.getStat(game.id("meh"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("meh"), "speed"), printed.speed);
  assert.equal(game.engine.getStat(game.id("meh"), "life"), printed.life);
  assert.equal(game.engine.isResource(game.id("meh")), false, "no longer a resource");
});

clause(MEH, "0:flipUp", "pays exactly 7 (not its normal cost of 8)", () => {
  const game = mehBoard({ obsession: 9 });
  assert.equal(ready(game.engine, P1), 10, "9 banks and the face-down Meh");
  flipUp(game);
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, false);
  assert.equal(ready(game.engine, P1), 2, "10 - 7 paid - 1 (Meh stopped being a resource)");
});

clause(MEH, "0:flipUp", "with exactly 7 [O] banks, all 7 are spent", () => {
  const game = mehBoard({ obsession: 7 });
  flipUp(game);
  assert.equal(ready(game.engine, P1), 0);
  assert.equal(game.engine.state.cards[game.id("meh")].zone, "play");
});

clause(MEH, "0:flipUp", "the card may help pay for its own FLIP UP (CR 507.4b): 6 other resources plus itself are enough", () => {
  const game = mehBoard({ obsession: 6 });
  flipUp(game);
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, false, "flipped up");
  assert.equal(ready(game.engine, P1), 0);
});

clause(MEH, "0:flipUp", "is refused when short: 5 other resources plus itself is only 6", () => {
  const game = mehBoard({ obsession: 5 });
  assert.throws(() => flipUp(game));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true, "still face-down");
  assert.equal(ready(game.engine, P1), 6, "nothing was paid");
});

clause(MEH, "0:flipUp", "needs [O]: seven Rage resources are enough resources but not the threshold", () => {
  const game = mehBoard({ rage: 8 });
  assert.throws(() => flipUp(game));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
  assert.equal(ready(game.engine, P1), 9);
});

clause(MEH, "0:flipUp", "a single [O] among the resources is enough for the threshold (6 Rage + 1 Obsession)", () => {
  const game = mehBoard({ rage: 6, obsession: 1 });
  flipUp(game);
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, false);
  assert.equal(ready(game.engine, P1), 0, "7 banks all paid; the face-down Meh left the pool");
});

clause(MEH, "0:flipUp", "the opponent's [O] do not meet the threshold", () => {
  const game = mehBoard({ rage: 8, oppObsession: 3 });
  assert.throws(() => flipUp(game));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
});

clause(MEH, "0:flipUp", "a face-down resource's own Volition does not provide the [O]", () => {
  // Only Meh itself and one Rage resource: no Obsession anywhere.
  const game = mehBoard({ rage: 6 });
  assert.throws(() => flipUp(game));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
});

clause(MEH, "0:flipUp", "FLIP UP does not change when a character can be deployed: it is refused on the opponent's turn", () => {
  const game = mehBoard({ obsession: 8, active: P2 });
  assert.throws(() => flipUp(game));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
  assert.equal(ready(game.engine, P1), 9, "nothing was paid");
});

clause(MEH, "0:flipUp", "the flipped-up Meh is a new character: it cannot attack the turn it was flipped", () => {
  const game = mehBoard({ obsession: 7 });
  flipUp(game);
  resolvePendingResponses(game.engine);
  assert.throws(() =>
    game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("meh")], target: { type: "faction", playerId: P2 } })
  );
});

clause(MEH, "0:flipUp", "cannot be flipped up when it is already face-up, or from the hand", () => {
  const faceUp = mehBoard({ obsession: 8, faceDown: false });
  assert.throws(() => flipUp(faceUp), "already face-up");

  const inHand = mehBoard({ obsession: 8, zone: "hand" });
  assert.throws(() => flipUp(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("meh")), "hand");
});

clause(MEH, "0:flipUp", "only its controller can flip it up", () => {
  const game = mehBoard({ obsession: 8 });
  assert.throws(() => flipUp(game, P2));
  assert.equal(game.engine.state.cards[game.id("meh")].faceDown, true);
});

clause(MEH, "0:flipUp", "FLIP UP is an alternative: deployed from hand it costs the normal 8 with [O] (7 resources are one short)", () => {
  const eight = mehBoard({ obsession: 8, zone: "hand" });
  playRaw(eight.engine, P1, eight.id("meh"));
  assert.equal(ready(eight.engine, P1), 0, "8 paid");
  resolvePendingResponses(eight.engine);
  assert.equal(zoneOf(eight.engine, eight.id("meh")), "play");

  const seven = mehBoard({ obsession: 7, zone: "hand" });
  assert.throws(() => playRaw(seven.engine, P1, seven.id("meh")));
  assert.equal(zoneOf(seven.engine, seven.id("meh")), "hand");

  const noThreshold = mehBoard({ rage: 9, zone: "hand" });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("meh")));
});

// --- COVERT scenarios shared by the cards that print COVERT ---------------------------

const plainDef = () => character({ name: "Plain", life: 9 });

/** P1 (active) attacks P2's faction with `attackerDef` (plus optional extra attackers); P2 tries to block with `blockers`. */
function covertAttackBlocked(attackerDef: CardDefinition, blockers: CardDefinition[], mates: CardDefinition[] = []): boolean {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "atk", def: attackerDef, owner: P1, zone: "play" },
      ...mates.map((def, i) => ({ key: `mate${i}`, def, owner: P1, zone: "play" as const })),
      ...blockers.map((def, i) => ({ key: `blk${i}`, def, owner: P2, zone: "play" as const }))
    ]
  });
  game.engine.perform({
    type: "declareAttack",
    playerId: P1,
    attackerIds: ["atk", ...mates.map((_, i) => `mate${i}`)].map(game.id),
    target: { type: "faction", playerId: P2 }
  });
  resolvePendingResponses(game.engine);
  try {
    game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map((_, i) => game.id(`blk${i}`)) });
  } catch {
    return false;
  }
  return game.engine.state.battle?.blockingParty.length === blockers.length;
}

/** P2 (active) attacks P1's faction with `attackerDef`; P1 tries to block with `blockerDef`. */
function covertDefends(blockerDef: CardDefinition, attackerDef: CardDefinition): boolean {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "blk", def: blockerDef, owner: P1, zone: "play" },
      { key: "atk", def: attackerDef, owner: P2, zone: "play" }
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("atk")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  try {
    game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("blk")] });
  } catch {
    return false;
  }
  return game.engine.state.battle?.blockingParty.length === 1;
}

// --- Night-basking Basilisk --------------------------------------------------
// COVERT
// EXTRA COST: If you control [O][O][O][O][O][O], reduce the numeric cost of this card by 4.
// Character, cost 6, [O], 3/3/2 (strength/speed/life).

const BASILISK = "0350dd91-0ba4-43d6-b470-bb66d4746bef";

clause(BASILISK, "0:kw:COVERT", "has the COVERT keyword", () => {
  const game = buildGame({ cards: [{ key: "nb", def: printing(BASILISK), owner: P1, zone: "play" }] });
  assert.ok(game.engine.getKeywords(game.id("nb")).includes("covert"), "game.engine.getKeywords(game.id(\"nb\")).includes(\"covert\")");
});

clause(BASILISK, "0:kw:COVERT", "cannot be blocked by a character without COVERT", () => {
  assert.equal(covertAttackBlocked(printing(BASILISK), [plainDef()]), false);
});

clause(BASILISK, "0:kw:COVERT", "can be blocked by a character with COVERT", () => {
  assert.equal(covertAttackBlocked(printing(BASILISK), [covertDef("Spy")]), true);
});

clause(BASILISK, "0:kw:COVERT", "a blocking party that includes a non-COVERT character is illegal against it", () => {
  assert.equal(covertAttackBlocked(printing(BASILISK), [covertDef("Spy"), plainDef()]), false);
});

clause(BASILISK, "0:kw:COVERT", "an attacking party with a non-COVERT mate is not covert: a non-COVERT character can block", () => {
  assert.equal(covertAttackBlocked(printing(BASILISK), [plainDef()], [plainDef()]), true);
});

clause(BASILISK, "0:kw:COVERT", "as a blocker it can block a COVERT party but not a non-COVERT one", () => {
  assert.equal(covertDefends(printing(BASILISK), covertDef("Spy")), true);
  assert.equal(covertDefends(printing(BASILISK), plainDef()), false);
});

function basiliskBoard(opts: { obsession?: number; rage?: number; oppObsession?: number; faceDown?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "nb", def: printing(BASILISK), owner: P1, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...volition(opts.faceDown ?? 0, P1),
      ...bank("obsession", opts.oppObsession ?? 0, P2)
    ]
  });
}

clause(BASILISK, "1:extraCost", "with [O]x6 its numeric cost is 4 less: it costs 2", () => {
  const game = basiliskBoard({ obsession: 6 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 2);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 4, "exactly 2 of the 6 resources were paid");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("nb")), "play");
});

clause(BASILISK, "1:extraCost", "with more than six [O] the reduction is still exactly 4 (7 [O] still costs 2)", () => {
  const game = basiliskBoard({ obsession: 8 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 2);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 6);
});

clause(BASILISK, "1:extraCost", "with only five [O] there is no reduction: the full 6 is paid (5 [O] and 5 [R] pay 6 of 10)", () => {
  const game = basiliskBoard({ obsession: 5, rage: 5 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 6);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 4, "6 of 10 paid");
});

clause(BASILISK, "1:extraCost", "with only five [O] and nothing else it cannot be deployed: 5 resources cannot pay 6", () => {
  const game = basiliskBoard({ obsession: 5 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 6);
  assert.throws(() => playRaw(game.engine, P1, game.id("nb")));
  assert.equal(zoneOf(game.engine, game.id("nb")), "hand");
  assert.equal(ready(game.engine, P1), 5, "nothing was paid");
});

clause(BASILISK, "1:extraCost", "a face-down resource is [V], not [O]: five [O] and one face-down resource pay the full 6", () => {
  const game = basiliskBoard({ obsession: 5, faceDown: 1 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 6);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 0);
});

clause(BASILISK, "1:extraCost", "the opponent's [O] do not count towards the six", () => {
  const game = basiliskBoard({ obsession: 3, rage: 4, oppObsession: 6 });
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 6);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 1);
});

clause(BASILISK, "1:extraCost", "it still needs [O] to deploy and is refused with six Rage resources", () => {
  const game = basiliskBoard({ rage: 8 });
  assert.throws(() => playRaw(game.engine, P1, game.id("nb")));
  assert.equal(zoneOf(game.engine, game.id("nb")), "hand");
});

clause(BASILISK, "1:extraCost", "the reduced cost is a real cost: with six [O] but only 1 ready resource left (5 already spent) it is refused", () => {
  const game = basiliskBoard({ obsession: 6 });
  const spent = game.engine.state.players[P1].play.slice(-5);
  for (const cardId of spent) game.engine.state.cards[cardId].attachedTo = game.engine.state.players[P1].factionId!;
  assert.equal(ready(game.engine, P1), 1);
  assert.throws(() => playRaw(game.engine, P1, game.id("nb")));
  assert.equal(zoneOf(game.engine, game.id("nb")), "hand");
});

clause(BASILISK, "1:extraCost", "the condition counts [O] you control even when they are spent (attached): six [O], 4 spent, still costs 2 and is affordable", () => {
  const game = basiliskBoard({ obsession: 6 });
  const spent = game.engine.state.players[P1].play.slice(-4);
  for (const cardId of spent) game.engine.state.cards[cardId].attachedTo = game.engine.state.players[P1].factionId!;
  assert.equal(ready(game.engine, P1), 2);
  assert.equal(game.engine.getCardPlayability(P1, game.id("nb")).numericCost, 2);
  playRaw(game.engine, P1, game.id("nb"));
  assert.equal(ready(game.engine, P1), 0);
});

// --- Obsessive Concentration -------------------------------------------------
// This resource may only be played from your hand face-down.
// PROVIDES: [O]
// FLIP IT: [O] -- COST: Use this only while this card is a face-down resource. Reveal this
// card. Pay 4. -- EFFECT: Put this card into play face-up. Draw 3 cards. If you do, put 3 cards
// from your hand on the bottom of your deck.

const CONC = "91a709fd-3225-4576-a200-e4bac342bdda";

const developPlay = (game: ReturnType<typeof buildGame>, key: string, faceDown: boolean) =>
  developResource(game.engine, P1, game.id(key), faceDown);

function concHandBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "oc", def: printing(CONC), owner: P1, zone: "hand" },
      { key: "plainObs", def: resourceCard({ name: "Plain Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" }
    ]
  });
}

clause(CONC, "0:rule", "cannot be played face-up from hand with the Develop Rule", () => {
  const game = concHandBoard();
  developPlay(game, "oc", false); // asked to play it face-up: the Develop Rule only plays it face-down
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("oc")), "play");
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true, "never face-up");
  assert.equal(game.engine.getThresholds(P1).obsession ?? 0, 0);
});

clause(CONC, "0:rule", "can be played face-down from hand with the Develop Rule", () => {
  const game = concHandBoard();
  developPlay(game, "oc", true);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("oc")), "play");
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true);
  assert.equal(game.engine.getThresholds(P1).volition, 1, "a face-down resource is [V]");
  assert.equal(game.engine.getThresholds(P1).obsession ?? 0, 0);
});

clause(CONC, "0:rule", "the face-up restriction is this card's: an ordinary Obsession resource can still be played face-up", () => {
  const game = concHandBoard();
  developPlay(game, "plainObs", false);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("plainObs")].faceDown, false);
  assert.equal(game.engine.getThresholds(P1).obsession, 1);
});

clause(CONC, "0:rule", "cannot be played face-up even as part of a two-resource play", () => {
  const game = buildGame({
    playerA: {
      faction: developFaction({
        faction: {
          startingInfluence: 30,
          setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
          turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource", count: 2 }] } }
        }
      })
    },
    cards: [
      { key: "oc", def: printing(CONC), owner: P1, zone: "hand" },
      { key: "plainObs", def: resourceCard({ name: "Plain Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" }
    ]
  });
  developResources(game.engine, P1, [game.id("oc"), game.id("plainObs")], false);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("oc")), "play");
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true, "never face-up, even in a two-resource play");
  assert.equal(game.engine.state.cards[game.id("plainObs")].faceDown, false, "the other resource of the play is unaffected");
});

clause(CONC, "0:rule", "is not deployed as a card with playCard (a resource is only played by an effect, face-down)", () => {
  const game = concHandBoard();
  assert.throws(() => playRaw(game.engine, P1, game.id("oc")));
  assert.equal(zoneOf(game.engine, game.id("oc")), "hand");
});

clause(CONC, "1:provides", "face-up in play it provides exactly one [O] and nothing else", () => {
  const game = buildGame({ cards: [{ key: "oc", def: printing(CONC), owner: P1, zone: "play" }] });
  assert.deepEqual(game.engine.getThresholds(P1), { obsession: 1 });
  assert.equal(game.engine.getAvailableResourceCount(P1), 1);
});

clause(CONC, "1:provides", "two of them provide two [O]", () => {
  const game = buildGame({
    cards: [
      { key: "oc1", def: printing(CONC), owner: P1, zone: "play" },
      { key: "oc2", def: printing(CONC), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(game.engine.getThresholds(P1), { obsession: 2 });
});

clause(CONC, "1:provides", "the icon goes to its controller only, and face-down it provides [V] instead of [O]", () => {
  const up = buildGame({ cards: [{ key: "oc", def: printing(CONC), owner: P1, zone: "play" }] });
  assert.deepEqual(up.engine.getThresholds(P2), {}, "the opponent gets nothing");
  const down = buildGame({ cards: [{ key: "oc", def: printing(CONC), owner: P1, zone: "play", faceDown: true }] });
  assert.deepEqual(down.engine.getThresholds(P1), { volition: 1 }, "face-down it is just a resource with [V]");
});

// -- FLIP IT -----------------------------------------------------------------------

function flipItBoard(opts: { obsession?: number; rage?: number; hand?: number; deck?: number; faceDown?: boolean; oppHand?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "oc", def: printing(CONC), owner: P1, zone: "play", faceDown: opts.faceDown ?? true },
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...handCards("h", opts.hand ?? 2, P1),
      ...deckCards("d", opts.deck ?? 6, P1),
      ...handCards("o", opts.oppHand ?? 0, P2)
    ]
  });
}

type FlipGame = ReturnType<typeof flipItBoard>;

const startFlipIt = (game: FlipGame) =>
  game.engine.perform({ type: "activateAbility", playerId: P1, cardId: game.id("oc"), abilityId: "flip-it", selected: {}, variables: {} } as never);

const attachedCount = (game: FlipGame) =>
  game.engine.state.players[P1].play.filter(c => game.engine.state.cards[c].attachedTo !== undefined).length;

clause(CONC, "2:ability:flip-it", "pays 4 as a cost (4 resources are attached to the faction while it waits for responses)", () => {
  const game = flipItBoard({ obsession: 5 });
  startFlipIt(game);
  assert.ok(game.engine.state.responseWindow, "waiting for responses");
  assert.equal(attachedCount(game), 4, "exactly 4 resources were paid");
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true, "still face-down until it resolves");
});

clause(CONC, "2:ability:flip-it", "reveals the card as part of the cost", () => {
  const game = flipItBoard();
  startFlipIt(game);
  const revealed = game.engine.getLog().some(e => e.event?.type === "cardsRevealed" && (e.event as { cardIds: string[] }).cardIds.includes(game.id("oc")));
  assert.ok(revealed, "a cardsRevealed event names the Obsessive Concentration");
});

clause(CONC, "2:ability:flip-it", "puts the card into play face-up, providing [O] instead of [V]", () => {
  const game = flipItBoard();
  const before = game.engine.getThresholds(P1);
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("oc")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  const after = game.engine.getThresholds(P1);
  assert.equal(after.obsession, (before.obsession ?? 0) + 1, "one more [O]");
  assert.equal(after.volition ?? 0, (before.volition ?? 0) - 1, "one less [V]");
  assert.equal(game.engine.getDefinition(game.id("oc")).type, "resource");
});

clause(CONC, "2:ability:flip-it", "draws 3 cards from the top of the deck, then puts 3 cards from hand on the bottom (net hand size unchanged)", () => {
  const game = flipItBoard({ hand: 2 });
  const deck = [...deckOf(game.engine, P1)];
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.equal(handOf(game.engine, P1).length, 5, "2 in hand + 3 drawn");
  assert.deepEqual(deck.slice(0, 3).every(c => handOf(game.engine, P1).includes(c)), true, "the top 3 were drawn");
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [game.id("h0"), deck[0], deck[2]] });
  assert.equal(handOf(game.engine, P1).length, 2, "5 - 3");
  const newDeck = deckOf(game.engine, P1);
  assert.equal(newDeck.length, deck.length - 3 + 3);
  assert.deepEqual(new Set(newDeck.slice(-3)), new Set([game.id("h0"), deck[0], deck[2]]), "the chosen 3 are on the bottom");
  assert.deepEqual(newDeck.slice(0, deck.length - 3), deck.slice(3), "the rest of the deck is unchanged");
});

clause(CONC, "2:ability:flip-it", "the 3 cards put on the bottom can be any cards from hand: the original hand cards, not the drawn ones", () => {
  const game = flipItBoard({ hand: 3 });
  const deck = [...deckOf(game.engine, P1)];
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [game.id("h0"), game.id("h1"), game.id("h2")] });
  assert.deepEqual([...handOf(game.engine, P1)].sort(), deck.slice(0, 3).sort(), "the drawn cards stay in hand");
  assert.deepEqual(new Set(deckOf(game.engine, P1).slice(-3)), new Set([game.id("h0"), game.id("h1"), game.id("h2")]));
});

clause(CONC, "2:ability:flip-it", "must put exactly 3 cards: 2 or 4 is refused", () => {
  const game = flipItBoard({ hand: 3 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  const attempt = (selected: string[]) =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  assert.throws(() => attempt([game.id("h0"), game.id("h1")]), "two");
  assert.throws(() => attempt([game.id("h0"), game.id("h1"), game.id("h2"), handOf(game.engine, P1)[3]]), "four");
  assert.throws(() => attempt([]), "none");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
});

clause(CONC, "2:ability:flip-it", "can only put cards from your own hand on the bottom", () => {
  const game = flipItBoard({ hand: 3, oppHand: 3 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  assert.throws(() =>
    game.engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("h0"), game.id("h1")] }
    } as never)
  );
  assert.equal(zoneOf(game.engine, game.id("o0")), "hand");
});

clause(CONC, "2:ability:flip-it", "'If you do': when no card can be drawn (empty deck) nothing is put on the bottom", () => {
  const game = flipItBoard({ hand: 3, deck: 0 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, false, "the card was still flipped up");
  assert.equal(pending(game.engine), undefined, "no card was drawn, so no 'put 3 on the bottom' step");
  assert.equal(handOf(game.engine, P1).length, 3);
  assert.equal(deckOf(game.engine, P1).length, 0);
});

// Q49 (user, 2026-10-21): "If you do" needs the whole "Draw 3 cards"; a short draw is not "you do".
clause(CONC, "2:ability:flip-it", "'If you do' (Q49): a SHORT draw (deck of 2) is not 'you do': the 2 cards stay in hand and nothing is put on the bottom", () => {
  const game = flipItBoard({ hand: 3, deck: 2 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, false, "the card was still flipped up");
  assert.equal(pending(game.engine), undefined, "only 2 of the 3 cards were drawn, so no 'put 3 on the bottom' step");
  assert.equal(handOf(game.engine, P1).length, 5, "the 2 drawn cards join the 3 in hand");
  assert.equal(deckOf(game.engine, P1).length, 0);
});

clause(CONC, "2:ability:flip-it", "needs [O]: refused with only Rage resources", () => {
  const game = flipItBoard({ obsession: 0, rage: 6 });
  assert.throws(() => startFlipIt(game));
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true);
  assert.equal(attachedCount(game), 0);
});

clause(CONC, "2:ability:flip-it", "one [O] among the resources is enough for the threshold (1 Obsession + 4 Rage)", () => {
  const game = flipItBoard({ obsession: 1, rage: 4 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, false);
});

clause(CONC, "2:ability:flip-it", "needs 4 resources to pay: refused with 2 other resources plus itself (3)", () => {
  const game = flipItBoard({ obsession: 2 });
  assert.throws(() => startFlipIt(game));
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true);
  assert.equal(attachedCount(game), 0, "nothing was paid");
});

clause(CONC, "2:ability:flip-it", "cannot be used while the card is a face-up resource", () => {
  const game = flipItBoard({ faceDown: false, obsession: 5 });
  assert.throws(() => startFlipIt(game));
  assert.equal(attachedCount(game), 0);
});

clause(CONC, "2:ability:flip-it", "cannot be used again once it is face-up", () => {
  const game = flipItBoard({ obsession: 9, hand: 3 });
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [game.id("h0"), game.id("h1"), game.id("h2")] });
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, false);
  assert.throws(() => startFlipIt(game));
});

clause(CONC, "2:ability:flip-it", "only its controller can use it", () => {
  const game = flipItBoard();
  assert.throws(() => game.engine.perform({ type: "activateAbility", playerId: P2, cardId: game.id("oc"), abilityId: "flip-it", selected: {}, variables: {} } as never));
  assert.equal(game.engine.state.cards[game.id("oc")].faceDown, true);
});

clause(CONC, "2:ability:flip-it", "the flipped-up card is a fresh resource: it is not attached to the faction even if it helped pay", () => {
  const game = flipItBoard({ obsession: 4 });
  // 4 other resources are enough, but whichever 4 were chosen the face-up card itself must end up unspent.
  startFlipIt(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("oc")].attachedTo, undefined);
  assert.equal(game.engine.getAvailableResourceIds(P1).includes(game.id("oc")), true);
});

// --- Offering of False Friendship --------------------------------------------
// EXTRA COST: Pick a character.
// Any opponent may pay 2. If they do, terminate this card. Otherwise, put that character
// and characters with the same name as that character on the bottom of their owner's deck.
// Tactic, cost 3, [O][O].

const OFFERING = "7e7c80fc-1697-426e-b962-768196f6f2da";

const twinDef = character({ name: "Twin", id: "hh-offering-twin", life: 5 });

function offeringBoard(opts: { p1Resources?: number; p2Resources?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "off", def: printing(OFFERING), owner: P1, zone: "hand" },
      { key: "twinA", def: twinDef, owner: P2, zone: "play" },
      { key: "twinB", def: twinDef, owner: P2, zone: "play" },
      { key: "myTwin", def: twinDef, owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", life: 5 }), owner: P2, zone: "play" },
      ...bank("obsession", opts.p1Resources ?? 3, P1),
      ...bank("rage", opts.p2Resources ?? 3, P2),
      ...deckCards("a", 3, P1),
      ...deckCards("z", 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type OffGame = ReturnType<typeof offeringBoard>;

/** Plays the Offering picking `pick`; stops at the opponent's decision (or the end). */
function playOffering(game: OffGame, pick: string): void {
  playRaw(game.engine, P1, game.id("off"), { selected: { c: [game.id(pick)] } });
  resolvePendingResponses(game.engine);
}

const bottomOf = (game: OffGame, player: PlayerId, n: number) => new Set(deckOf(game.engine, player).slice(-n));

clause(OFFERING, "0:extraCost", "any character in play can be picked: an opponent's, or your own", () => {
  for (const pick of ["twinA", "other", "myTwin"]) {
    const game = offeringBoard();
    playOffering(game, pick);
    assert.equal(pending(game.engine)?.kind, "mayPay", `${pick}: the opponent is offered the payment`);
  }
});

clause(OFFERING, "0:extraCost", "the pick is made when it is deployed and required: with no pick, or two picks, it is refused", () => {
  const none = offeringBoard();
  assert.throws(() => playRaw(none.engine, P1, none.id("off")));
  assert.equal(zoneOf(none.engine, none.id("off")), "hand");

  const two = offeringBoard();
  assert.throws(() => playRaw(two.engine, P1, two.id("off"), { selected: { c: [two.id("twinA"), two.id("other")] } }));
  assert.equal(zoneOf(two.engine, two.id("off")), "hand");
});

clause(OFFERING, "0:extraCost", "cannot pick a non-character (an item or location), a face-down card, or a character outside play", () => {
  const game = offeringBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
      { key: "down", def: character({ name: "Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  for (const key of ["itm", "loc", "down", "inHand", "inDiscard"]) {
    assert.throws(() => playRaw(game.engine, P1, game.id("off"), { selected: { c: [game.id(key)] } }), key);
  }
  assert.equal(zoneOf(game.engine, game.id("off")), "hand");
});

clause(OFFERING, "0:extraCost", "costs 3 and needs [O][O]: paid on deploy; refused when short or without the threshold", () => {
  const paid = offeringBoard({ p1Resources: 5 });
  playRaw(paid.engine, P1, paid.id("off"), { selected: { c: [paid.id("twinA")] } });
  assert.equal(ready(paid.engine, P1), 2, "exactly 3 of 5 paid");

  const short = offeringBoard({ p1Resources: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("off"), { selected: { c: [short.id("twinA")] } }));

  const noThreshold = offeringBoard({ p1Resources: 0, extra: bank("rage", 5, P1) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("off"), { selected: { c: [noThreshold.id("twinA")] } }));

  const oneObsession = offeringBoard({ p1Resources: 1, extra: bank("rage", 4, P1) });
  assert.throws(() => playRaw(oneObsession.engine, P1, oneObsession.id("off"), { selected: { c: [oneObsession.id("twinA")] } }), "[O][O] needs two");
});

clause(OFFERING, "1:rule", "the opponent (not the controller) is the one offered the payment", () => {
  const game = offeringBoard();
  playOffering(game, "twinA");
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2);
});

clause(OFFERING, "1:rule", "if the opponent does not pay, the picked character and all characters with its name go to the bottom of their owners' decks", () => {
  const game = offeringBoard();
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  for (const key of ["twinA", "twinB", "myTwin"]) assert.equal(zoneOf(game.engine, game.id(key)), "deck", key);
  assert.deepEqual(bottomOf(game, P2, 2), new Set([game.id("twinA"), game.id("twinB")]), "P2's twins on the bottom of P2's deck");
  assert.equal(deckOf(game.engine, P1)[deckOf(game.engine, P1).length - 1], game.id("myTwin"), "my twin on the bottom of MY deck");
  assert.equal(deckOf(game.engine, P2).length, 5);
  assert.equal(deckOf(game.engine, P1).length, 4);
});

clause(OFFERING, "1:rule", "a character with a different name is not affected", () => {
  const game = offeringBoard();
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
});

clause(OFFERING, "1:rule", "picking a character whose name nobody else shares moves only that character", () => {
  const game = offeringBoard();
  playOffering(game, "other");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.equal(zoneOf(game.engine, game.id("other")), "deck");
  const deck = deckOf(game.engine, P2);
  assert.equal(deck[deck.length - 1], game.id("other"));
  for (const key of ["twinA", "twinB", "myTwin"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", key);
});

clause(OFFERING, "1:rule", "picking your own character works the same way: it and its namesakes are bottomed", () => {
  const game = offeringBoard();
  playOffering(game, "myTwin");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  for (const key of ["twinA", "twinB", "myTwin"]) assert.equal(zoneOf(game.engine, game.id(key)), "deck", key);
});

clause(OFFERING, "1:rule", "only characters share the name effect: a same-named item, and a same-named face-down card, stay put", () => {
  const game = offeringBoard({
    extra: [
      { key: "twinItem", def: item({ name: "Twin" }), owner: P2, zone: "play" },
      { key: "twinDown", def: character({ name: "Twin" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.equal(zoneOf(game.engine, game.id("twinItem")), "play", "an item is not a character");
  assert.equal(zoneOf(game.engine, game.id("twinDown")), "play", "a face-down card is not a character");
  assert.equal(zoneOf(game.engine, game.id("twinB")), "deck");
});

clause(OFFERING, "1:rule", "a same-named character in a hand, discard pile or deck is not 'in play' and is not moved", () => {
  const game = offeringBoard({
    extra: [
      { key: "twinHand", def: twinDef, owner: P2, zone: "hand" },
      { key: "twinDisc", def: twinDef, owner: P2, zone: "discard" }
    ]
  });
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.equal(zoneOf(game.engine, game.id("twinHand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("twinDisc")), "discard");
});

clause(OFFERING, "1:rule", "a stolen character (controlled by one player, owned by the other) goes to its OWNER's deck", () => {
  const game = offeringBoard({ extra: [{ key: "stolen", def: twinDef, owner: P2, zone: "play", controller: P1 }] });
  playOffering(game, "myTwin");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: false });
  assert.ok(deckOf(game.engine, P2).includes(game.id("stolen")), "owner's deck");
  assert.ok(!deckOf(game.engine, P1).includes(game.id("stolen")), "!deckOf(game.engine, P1).includes(game.id(\"stolen\"))");
});

clause(OFFERING, "1:rule", "if the opponent pays 2, nothing is moved and the Offering is terminated (to the discard pile)", () => {
  const game = offeringBoard();
  const before = ready(game.engine, P2);
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(ready(game.engine, P2), before - 2, "the opponent really paid 2");
  for (const key of ["twinA", "twinB", "myTwin", "other"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", key);
  assert.equal(zoneOf(game.engine, game.id("off")), "discard");
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(OFFERING, "1:rule", "an opponent with exactly 2 resources may pay; one with fewer than 2 is not offered the payment and the effect happens", () => {
  const exact = offeringBoard({ p2Resources: 2 });
  playOffering(exact, "twinA");
  assert.equal(pending(exact.engine)?.kind, "mayPay");
  answerChoice(exact.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(ready(exact.engine, P2), 0);
  assert.equal(zoneOf(exact.engine, exact.id("twinA")), "play");

  const short = offeringBoard({ p2Resources: 1 });
  playOffering(short, "twinA");
  drain(short.engine, declineAll);
  assert.equal(zoneOf(short.engine, short.id("twinA")), "deck", "could not pay: the picked character is bottomed");
  assert.equal(ready(short.engine, P2), 1, "nothing was paid");
});

clause(OFFERING, "1:rule", "the controller is never the payer: the controller's resources are untouched when the opponent pays or declines", () => {
  const game = offeringBoard({ p1Resources: 6 });
  playOffering(game, "twinA");
  answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay: true });
  assert.equal(ready(game.engine, P1), 3, "6 - 3 for the Offering itself, nothing more");
});

// --- Predatory Lamp ----------------------------------------------------------
// COVERT
// When this card enters play, you may pick a character with COVERT. If you do, that
// character loses COVERT while this card is in play.
// Character, cost 3, [O], 1/3/1 (strength/speed/life), lurker.

const LAMP = "81210e8c-62b8-4536-b078-00611f6542fd";

clause(LAMP, "0:kw:COVERT", "has the COVERT keyword", () => {
  const game = buildGame({ cards: [{ key: "pl", def: printing(LAMP), owner: P1, zone: "play" }] });
  assert.ok(game.engine.getKeywords(game.id("pl")).includes("covert"), "game.engine.getKeywords(game.id(\"pl\")).includes(\"covert\")");
});

clause(LAMP, "0:kw:COVERT", "cannot be blocked by a character without COVERT, but can be blocked by one with COVERT", () => {
  assert.equal(covertAttackBlocked(printing(LAMP), [plainDef()]), false);
  assert.equal(covertAttackBlocked(printing(LAMP), [covertDef("Spy")]), true);
});

clause(LAMP, "0:kw:COVERT", "a blocking party that includes a non-COVERT character is illegal against it", () => {
  assert.equal(covertAttackBlocked(printing(LAMP), [covertDef("Spy"), plainDef()]), false);
});

clause(LAMP, "0:kw:COVERT", "an attacking party with a non-COVERT mate is not covert", () => {
  assert.equal(covertAttackBlocked(printing(LAMP), [plainDef()], [plainDef()]), true);
});

clause(LAMP, "0:kw:COVERT", "as a blocker it can block a COVERT party but not a non-COVERT one", () => {
  assert.equal(covertDefends(printing(LAMP), covertDef("Spy")), true);
  assert.equal(covertDefends(printing(LAMP), plainDef()), false);
});

function lampBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(LAMP), owner: P1, zone: "hand" },
      { key: "oppSpy", def: covertDef("Opp Spy"), owner: P2, zone: "play" },
      { key: "mySpy", def: covertDef("My Spy"), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P1),
      ...extra
    ]
  });
}

type LampGame = ReturnType<typeof lampBoard>;

const hasCovert = (game: LampGame, key: string) => game.engine.getKeywords(game.id(key)).includes("covert");

function deployLamp(game: LampGame, pick: string | undefined): void {
  play(game.engine, P1, game.id("pl"));
  assert.equal(zoneOf(game.engine, game.id("pl")), "play");
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "selectTargets", "the controller is asked for the optional pick");
  assert.equal(pc?.playerId, P1);
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { v: pick ? [game.id(pick)] : [] } });
}

clause(LAMP, "1:rule", "the picked opposing COVERT character loses COVERT", () => {
  const game = lampBoard();
  assert.ok(hasCovert(game, "oppSpy"), "hasCovert(game, \"oppSpy\")");
  deployLamp(game, "oppSpy");
  assert.ok(!hasCovert(game, "oppSpy"), "!hasCovert(game, \"oppSpy\")");
});

clause(LAMP, "1:rule", "the picked COVERT character may be your own", () => {
  const game = lampBoard();
  deployLamp(game, "mySpy");
  assert.ok(!hasCovert(game, "mySpy"), "!hasCovert(game, \"mySpy\")");
});

clause(LAMP, "1:rule", "only the picked character loses COVERT: other COVERT characters keep it, and so does the Lamp", () => {
  const game = lampBoard();
  deployLamp(game, "oppSpy");
  assert.ok(hasCovert(game, "mySpy"), "an unpicked covert character");
  assert.ok(hasCovert(game, "pl"), "the Lamp itself");
});

clause(LAMP, "1:rule", "'you may': declining the pick leaves every character's COVERT alone", () => {
  const game = lampBoard();
  deployLamp(game, undefined);
  for (const key of ["oppSpy", "mySpy", "pl"]) assert.ok(hasCovert(game, key), key);
});

clause(LAMP, "1:rule", "the Lamp can pick itself (it is a character with COVERT in play when its trigger resolves)", () => {
  const game = lampBoard();
  deployLamp(game, "pl");
  assert.ok(!hasCovert(game, "pl"), "!hasCovert(game, \"pl\")");
  assert.ok(hasCovert(game, "oppSpy"), "hasCovert(game, \"oppSpy\")");
});

clause(LAMP, "1:rule", "can only pick a character that has COVERT: a plain character is refused", () => {
  const game = lampBoard();
  play(game.engine, P1, game.id("pl"));
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { v: [game.id("plain")] } } } as never)
  );
  assert.equal(pending(game.engine)?.kind, "selectTargets", "still waiting for a legal pick");
});

clause(LAMP, "1:rule", "can pick only one character", () => {
  const game = lampBoard();
  play(game.engine, P1, game.id("pl"));
  assert.throws(() =>
    game.engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { v: [game.id("oppSpy"), game.id("mySpy")] } }
    } as never)
  );
});

clause(LAMP, "1:rule", "cannot pick a COVERT card that is not a character in play (a face-down card, an item with COVERT, a character in hand)", () => {
  const game = lampBoard([
    { key: "downSpy", def: covertDef("Down Spy"), owner: P2, zone: "play", faceDown: true },
    { key: "covertItem", def: item({ name: "Covert Item", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
    { key: "handSpy", def: covertDef("Hand Spy"), owner: P2, zone: "hand" }
  ]);
  play(game.engine, P1, game.id("pl"));
  for (const key of ["downSpy", "covertItem", "handSpy"]) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { v: [game.id(key)] } } } as never),
      key
    );
  }
});

clause(LAMP, "1:rule", "the effect is not 'this turn': it lasts across turns while the Lamp stays in play", () => {
  const game = lampBoard();
  deployLamp(game, "oppSpy");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.ok(!hasCovert(game, "oppSpy"), "two turns later");
});

clause(LAMP, "1:rule", "the character gets COVERT back when the Lamp is destroyed", () => {
  const game = lampBoard([{ key: "dtor", def: destroyer(), owner: P1, zone: "hand" }]);
  deployLamp(game, "oppSpy");
  play(game.engine, P1, game.id("dtor"), { selected: { t: [game.id("pl")] } });
  assert.equal(zoneOf(game.engine, game.id("pl")), "discard");
  assert.ok(hasCovert(game, "oppSpy"), "COVERT restored");
});

clause(LAMP, "1:rule", "the character gets COVERT back when the Lamp returns to hand", () => {
  const game = lampBoard([{ key: "bounce", def: bounceOne(), owner: P1, zone: "hand" }]);
  deployLamp(game, "oppSpy");
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("pl")] } });
  assert.equal(zoneOf(game.engine, game.id("pl")), "hand");
  assert.ok(hasCovert(game, "oppSpy"), "hasCovert(game, \"oppSpy\")");
});

clause(LAMP, "1:rule", "a character that lost COVERT can be blocked by a non-COVERT character (its party is no longer covert)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(LAMP), owner: P1, zone: "hand" },
      { key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" },
      { key: "wall", def: plainDef(), owner: P1, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(game.engine, P1, game.id("pl"));
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { v: [game.id("spy")] } });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("spy")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("wall")] });
  assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("wall")]);
});

clause(LAMP, "1:rule", "a character that keeps COVERT (not picked) still cannot be blocked by a non-COVERT character", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(LAMP), owner: P1, zone: "hand" },
      { key: "spy", def: covertDef("Spy"), owner: P2, zone: "play" },
      { key: "wall", def: plainDef(), owner: P1, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(game.engine, P1, game.id("pl"));
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { v: [] } });
  endTurn(game.engine, P1);
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("spy")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  assert.throws(() => game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("wall")] }));
});

clause(LAMP, "1:rule", "another card of yours entering play does not trigger the Lamp", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(LAMP), owner: P1, zone: "play" },
      { key: "oppSpy", def: covertDef("Opp Spy"), owner: P2, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(pending(game.engine), undefined);
  assert.ok(game.engine.getKeywords(game.id("oppSpy")).includes("covert"), "game.engine.getKeywords(game.id(\"oppSpy\")).includes(\"covert\")");
});

clause(LAMP, "1:rule", "costs 3 and needs [O]", () => {
  const paid = lampBoard();
  playRaw(paid.engine, P1, paid.id("pl"));
  assert.equal(ready(paid.engine, P1), 0);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pl", def: printing(LAMP), owner: P1, zone: "hand" }, ...bank("obsession", 2, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("pl")));

  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pl", def: printing(LAMP), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pl")));
});

// --- Profane Proposal --------------------------------------------------------
// EXTRA COST: Pick an opponent.
// Search your deck for 5 cards with different names and reveal them. That player
// separates those cards into two piles. Put one pile into your hand and shuffle the
// other into your deck.
// Tactic, cost 6, [O][O][O].

const PROPOSAL = "7f75ce4c-b81e-45a9-973a-1bbe50fb43e4";

/** `names` become P1's deck, top first, as d0, d1, ...; cards with the same name share a definition. */
function proposalBoard(names: string[], opts: { resources?: number; random?: () => number; extra?: CardPlacement[] } = {}) {
  const defs = new Map<string, CardDefinition>();
  const defFor = (name: string) => {
    if (!defs.has(name)) defs.set(name, character({ name, id: `pp-def-${name}` }));
    return defs.get(name)!;
  };
  return buildGame({
    playerA: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "pp", def: printing(PROPOSAL), owner: P1, zone: "hand" },
      ...names.map((name, i) => ({ key: `d${i}`, def: defFor(name), owner: P1, zone: "deck" as const })),
      ...deckCards("z", 4, P2),
      ...bank("obsession", opts.resources ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type PPGame = ReturnType<typeof proposalBoard>;

const SEVEN = ["A", "B", "C", "D", "E", "F", "G"];

/** Plays Proposal against P2 finding `found` (keys); stops at the first pending choice. */
function playProposal(game: PPGame, found: string[], opponent: string | undefined = "faction"): void {
  castProposal(game, opponent);
  searchProposal(game, found);
}

/** Deploys Proposal picking `opponent` (the EXTRA COST); the search itself is asked when it resolves. */
function castProposal(game: PPGame, opponent: string | undefined = "faction"): void {
  const p = opponent === "faction" ? [game.engine.state.players[P2].factionId!] : opponent ? [game.id(opponent)] : [];
  playRaw(game.engine, P1, game.id("pp"), { selected: { p } });
  resolvePendingResponses(game.engine);
}

/** Answers the search prompt (raised while the tactic resolves) with `found` (keys). */
function searchProposal(game: PPGame, found: string[]): void {
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search is asked when the tactic resolves");
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: found.map(game.id) });
}

const FIVE = ["d0", "d1", "d2", "d3", "d4"];

clause(PROPOSAL, "0:extraCost", "picks an opponent (their faction) as part of deploying", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "pileAssignment");
  assert.equal(pc?.playerId, P2, "the picked opponent will separate the piles");
});

clause(PROPOSAL, "0:extraCost", "cannot pick yourself, a character, or nothing", () => {
  const own = proposalBoard(SEVEN);
  assert.throws(() => playRaw(own.engine, P1, own.id("pp"), { selected: { p: [own.engine.state.players[P1].factionId!] } }), "own faction");
  assert.equal(zoneOf(own.engine, own.id("pp")), "hand");

  const chara = proposalBoard(SEVEN, { extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  assert.throws(() => playRaw(chara.engine, P1, chara.id("pp"), { selected: { p: [chara.id("foe")] } }), "a character");

  const none = proposalBoard(SEVEN);
  assert.throws(() => playRaw(none.engine, P1, none.id("pp"), { selected: { p: [] } }), "nobody");
  assert.equal(zoneOf(none.engine, none.id("pp")), "hand");
});

clause(PROPOSAL, "0:extraCost", "costs 6 and needs [O][O][O]: pays exactly 6; refused when short or without the threshold", () => {
  const paid = proposalBoard(SEVEN, { resources: 8 });
  playRaw(paid.engine, P1, paid.id("pp"), { selected: { p: [paid.engine.state.players[P2].factionId!] } });
  assert.equal(ready(paid.engine, P1), 2, "6 of 8 paid");

  const short = proposalBoard(SEVEN, { resources: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("pp"), { selected: { p: [short.engine.state.players[P2].factionId!] } }));
  assert.equal(zoneOf(short.engine, short.id("pp")), "hand");

  const twoObsession = proposalBoard(SEVEN, { resources: 2, extra: bank("rage", 5, P1) });
  assert.throws(() =>
    playRaw(twoObsession.engine, P1, twoObsession.id("pp"), { selected: { p: [twoObsession.engine.state.players[P2].factionId!] } })
  , "only two [O]");
});

clause(PROPOSAL, "1:rule", "searches the controller's own deck: the 5 cards must be from it (not the opponent's deck, not a hand)", () => {
  for (const bad of ["z0", "inHand"]) {
    const game = proposalBoard(SEVEN, { extra: [{ key: "inHand", def: character({ name: "H" }), owner: P1, zone: "hand" }] });
    castProposal(game);
    assert.throws(() => searchProposal(game, [...FIVE.slice(0, 4), bad]), bad === "z0" ? "an opposing deck card" : "a card in hand");
    assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal search");
    assert.equal(zoneOf(game.engine, game.id(bad)), bad === "z0" ? "deck" : "hand", "the illegal card was not taken");
    for (const k of FIVE.slice(0, 4)) assert.equal(zoneOf(game.engine, game.id(k)), "deck", "nothing was found");
  }
});

clause(PROPOSAL, "1:rule", "the 5 cards must have different names: two cards with the same name are refused", () => {
  const game = proposalBoard(["A", "B", "C", "D", "A", "E", "F"]);
  assert.throws(() => playProposal(game, ["d0", "d1", "d2", "d3", "d4"]), "A twice");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal search");
  for (const k of ["d0", "d1", "d2", "d3", "d4"]) assert.equal(zoneOf(game.engine, game.id(k)), "deck", "nothing was found");
});

clause(PROPOSAL, "1:rule", "can find 5 differently named cards from a deck that also holds copies (the player picks which copy)", () => {
  const game = proposalBoard(["A", "A", "B", "B", "C", "C", "D", "D", "E", "E"]);
  playProposal(game, ["d1", "d3", "d5", "d6", "d8"]);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "pileAssignment");
  assert.deepEqual([...(pc?.cardIds as string[])].sort(), ["d1", "d3", "d5", "d6", "d8"].map(game.id).sort());
});

clause(PROPOSAL, "1:rule", "a search may find fewer than 5 (CR 312.2): with only 3 differently named cards in the deck, the card can still be played and finds those 3", () => {
  const game = proposalBoard(["A", "B", "C", "A", "B", "C", "A"]);
  playProposal(game, ["d0", "d1", "d2"]);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "pileAssignment");
  assert.deepEqual([...(pc?.cardIds as string[])].sort(), ["d0", "d1", "d2"].map(game.id).sort());
});

clause(PROPOSAL, "1:rule", "reveals the 5 found cards", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  const revealed = game.engine
    .getLog()
    .filter(e => e.event?.type === "cardsRevealed")
    .flatMap(e => (e.event as { cardIds: string[] }).cardIds);
  for (const key of FIVE) assert.ok(revealed.includes(game.id(key)), `${key} was revealed`);
  assert.ok(!revealed.includes(game.id("d5")), "cards that were not found are not revealed");
});

clause(PROPOSAL, "1:rule", "the piles are separated by the picked opponent and consist of exactly the 5 found cards", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "pileAssignment");
  assert.equal(pc?.playerId, P2);
  assert.deepEqual([...(pc?.cardIds as string[])].sort(), FIVE.map(game.id).sort());
});

clause(PROPOSAL, "1:rule", "a split must use each found card exactly once: a missing, repeated or foreign card is refused", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  const [a, b, c, d, e] = FIVE.map(game.id);
  const attempt = (pile1: string[], pile2: string[]) =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pileAssignment", pile1, pile2 } } as never);
  assert.throws(() => attempt([a, b], [c, d]), "missing e");
  assert.throws(() => attempt([a, b, c], [c, d, e]), "c twice");
  assert.throws(() => attempt([a, b], [c, d, game.id("d5")]), "a card that was not found");
  assert.equal(pending(game.engine)?.kind, "pileAssignment", "still waiting");
});

/** The opponent splits the found cards `pile1 / pile2` (by key). */
function splitPiles(game: PPGame, pile1: string[], pile2: string[]): void {
  answerChoice(game.engine, "pileAssignment", P2, { kind: "pileAssignment", pile1: pile1.map(game.id), pile2: pile2.map(game.id) });
}

/** Finishes any remaining pending choice by picking the first option, so the game is left quiet. */
function finishQuietly(game: PPGame): void {
  drain(game.engine, pc => (pc.kind === "pickPile" ? { kind: "pickPile", index: 0 } : declineAll(pc)));
}

clause(PROPOSAL, "1:rule", "exactly one pile goes to the controller's hand and the other goes back into the deck (a 2 / 3 split)", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  splitPiles(game, ["d0", "d1"], ["d2", "d3", "d4"]);
  finishQuietly(game);
  const inHand = FIVE.filter(k => zoneOf(game.engine, game.id(k)) === "hand");
  const inDeck = FIVE.filter(k => zoneOf(game.engine, game.id(k)) === "deck");
  assert.equal(inHand.length + inDeck.length, 5, "every found card is in the hand or the deck");
  const isPile = (keys: string[], pile: string[]) => keys.length === pile.length && pile.every(k => keys.includes(k));
  assert.ok(isPile(inHand, ["d0", "d1"]) || isPile(inHand, ["d2", "d3", "d4"]), `hand holds exactly one whole pile, got ${inHand.join(",")}`);
});

clause(PROPOSAL, "1:rule", "a 5 / 0 split: either all five go to hand or all five go back into the deck", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  splitPiles(game, FIVE, []);
  finishQuietly(game);
  const inHand = FIVE.filter(k => zoneOf(game.engine, game.id(k)) === "hand");
  assert.ok(inHand.length === 5 || inHand.length === 0, `got ${inHand.length} in hand`);
});

clause(PROPOSAL, "1:rule", "the CONTROLLER chooses which pile goes to their hand, after the opponent has separated them", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  splitPiles(game, ["d0", "d1"], ["d2", "d3", "d4"]);
  const pc = pending(game.engine);
  assert.ok(pc, "the controller is asked which pile to take");
  assert.equal(pc.playerId, P1, "and it is the controller who decides");
  assert.equal(FIVE.filter(k => zoneOf(game.engine, game.id(k)) === "hand").length, 0, "nothing has moved before the controller chooses");
});

clause(PROPOSAL, "1:rule", "the controller takes the pile they choose: the first or the second, and the other pile goes back into the deck", () => {
  for (const [index, taken, left] of [[0, ["d0", "d1"], ["d2", "d3", "d4"]], [1, ["d2", "d3", "d4"], ["d0", "d1"]]] as const) {
    const game = proposalBoard(SEVEN);
    playProposal(game, FIVE);
    splitPiles(game, ["d0", "d1"], ["d2", "d3", "d4"]);
    const pc = pending(game.engine);
    assert.equal(pc?.kind, "chooserSelectsOption");
    assert.equal(pc?.playerId, P1, "the controller chooses");
    assert.equal(pc?.optionCount, 2);
    answerChoice(game.engine, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index });
    finishQuietly(game);
    for (const k of taken) assert.equal(zoneOf(game.engine, game.id(k)), "hand", `option ${index}: ${k} is in my hand`);
    for (const k of left) assert.equal(zoneOf(game.engine, game.id(k)), "deck", `option ${index}: ${k} went back into the deck`);
  }
});

clause(PROPOSAL, "1:rule", "cards of the deck that were not found stay in the deck, and the opponent's deck and hand are untouched", () => {
  const game = proposalBoard(SEVEN);
  const oppDeck = [...deckOf(game.engine, P2)];
  playProposal(game, FIVE);
  splitPiles(game, ["d0", "d1", "d2"], ["d3", "d4"]);
  finishQuietly(game);
  assert.equal(zoneOf(game.engine, game.id("d5")), "deck");
  assert.equal(zoneOf(game.engine, game.id("d6")), "deck");
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
  assert.equal(handOf(game.engine, P2).length, 0);
});

clause(PROPOSAL, "1:rule", "the deck is shuffled after the search and the other pile goes in (rigged RNG: different results for different shuffles)", () => {
  const outcome = (rng: () => number) => {
    const game = proposalBoard(SEVEN, { random: rng });
    playProposal(game, FIVE);
    splitPiles(game, ["d0", "d1"], ["d2", "d3", "d4"]);
    finishQuietly(game);
    return deckOf(game.engine, P1);
  };
  const identity = outcome(() => 0.9999999);
  const reversed = outcome(() => 0);
  assert.notDeepEqual(identity, reversed, "the arrangement of the deck depends on the shuffle");
});

clause(PROPOSAL, "1:rule", "the Proposal itself goes to the discard pile after resolving", () => {
  const game = proposalBoard(SEVEN);
  playProposal(game, FIVE);
  splitPiles(game, ["d0", "d1"], ["d2", "d3", "d4"]);
  finishQuietly(game);
  assert.equal(zoneOf(game.engine, game.id("pp")), "discard");
});

// --- Puerile Ecto-Manipulator ------------------------------------------------
// When this card enters play you may pick a non-resource card. If you do, put a token
// on the card.
// Character, cost 1, [O], 1/3/1 (strength/speed/life).

const ECTO = "2a429a6d-402e-4d98-8479-58eb348335d7";

function ectoBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pem", def: printing(ECTO), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Loc" }), owner: P2, zone: "play" },
      ...bank("obsession", 2, P1),
      ...extra
    ]
  });
}

type EctoGame = ReturnType<typeof ectoBoard>;

function deployEcto(game: EctoGame): void {
  play(game.engine, P1, game.id("pem"));
  assert.equal(zoneOf(game.engine, game.id("pem")), "play");
  assert.equal(pending(game.engine)?.kind, "selectTargets", "the controller is asked for the optional pick");
  assert.equal(pending(game.engine)?.playerId, P1);
}

const pickEcto = (game: EctoGame, keys: string[]) =>
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { nr: keys.map(game.id) } });

clause(ECTO, "0:rule", "puts a token on the picked character of its controller", () => {
  const game = ectoBoard();
  deployEcto(game);
  pickEcto(game, ["mine"]);
  assert.equal(tokens(game.engine, game.id("mine")), 1);
});

clause(ECTO, "0:rule", "the non-resource card may be an opposing character, an item, or a location, in either player's control", () => {
  for (const key of ["foe", "myItem", "foeLoc"]) {
    const game = ectoBoard();
    deployEcto(game);
    pickEcto(game, [key]);
    assert.equal(tokens(game.engine, game.id(key)), 1, key);
  }
});

clause(ECTO, "0:rule", "it can pick itself", () => {
  const game = ectoBoard();
  deployEcto(game);
  pickEcto(game, ["pem"]);
  assert.equal(tokens(game.engine, game.id("pem")), 1);
});

clause(ECTO, "0:rule", "only the picked card gets the token, and exactly one token", () => {
  const game = ectoBoard();
  deployEcto(game);
  pickEcto(game, ["mine"]);
  assert.equal(tokens(game.engine, game.id("mine")), 1, "exactly one");
  for (const key of ["foe", "myItem", "foeLoc", "pem"]) assert.equal(tokens(game.engine, game.id(key)), 0, `${key} untouched`);
});

clause(ECTO, "0:rule", "the token stacks on a card that already has tokens", () => {
  const game = ectoBoard([{ key: "loaded", def: character({ name: "Loaded" }), owner: P1, zone: "play", counters: { token: 2 } }]);
  deployEcto(game);
  pickEcto(game, ["loaded"]);
  assert.equal(tokens(game.engine, game.id("loaded")), 3);
});

clause(ECTO, "0:rule", "'you may': picking nothing puts no token anywhere", () => {
  const game = ectoBoard();
  deployEcto(game);
  pickEcto(game, []);
  for (const key of ["mine", "foe", "myItem", "foeLoc", "pem"]) assert.equal(tokens(game.engine, game.id(key)), 0, key);
  assert.equal(pending(game.engine), undefined);
});

clause(ECTO, "0:rule", "cannot pick a resource, face-up or face-down", () => {
  const game = ectoBoard(volition(1, P1));
  const faceDown = game.engine.state.players[P1].play.find(c => game.engine.state.cards[c].faceDown)!;
  const faceUp = game.engine.state.players[P1].play.find(c => game.engine.getDefinition(c).type === "resource" && !game.engine.state.cards[c].faceDown)!;
  deployEcto(game);
  for (const [label, target] of [["face-down resource", faceDown], ["face-up resource", faceUp]] as const) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { nr: [target] } } } as never),
      label
    );
  }
  assert.equal(tokens(game.engine, faceDown), 0);
  assert.equal(tokens(game.engine, faceUp), 0);
});

clause(ECTO, "0:rule", "cannot pick a faction (CR 202.9: a bare 'non-resource card' does not reach factions)", () => {
  const game = ectoBoard();
  deployEcto(game);
  for (const player of [P1, P2]) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { nr: [game.engine.state.players[player].factionId!] } } } as never),
      `faction of ${player}`
    );
  }
});

clause(ECTO, "0:rule", "cannot pick a card that is not in play (hand, deck, discard pile)", () => {
  const game = ectoBoard([
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ]);
  deployEcto(game);
  for (const key of ["inHand", "inDeck", "inDiscard"]) {
    assert.throws(
      () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { nr: [game.id(key)] } } } as never),
      key
    );
  }
});

clause(ECTO, "0:rule", "picks at most one card: two is refused", () => {
  const game = ectoBoard();
  deployEcto(game);
  assert.throws(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { nr: [game.id("mine"), game.id("foe")] } } } as never)
  );
  assert.equal(pending(game.engine)?.kind, "selectTargets");
});

clause(ECTO, "0:rule", "the token is permanent (not 'this turn'): still there after two turns", () => {
  const game = ectoBoard();
  deployEcto(game);
  pickEcto(game, ["mine"]);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(tokens(game.engine, game.id("mine")), 1);
});

clause(ECTO, "0:rule", "another card entering play does not trigger it", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pem", def: printing(ECTO), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(pending(game.engine), undefined);
  assert.equal(tokens(game.engine, game.id("pem")), 0);
  assert.equal(tokens(game.engine, game.id("newbie")), 0);
});

clause(ECTO, "0:rule", "also triggers when it is put into play by an effect instead of deployed", () => {
  const reanimator = item({
    name: "Reanimator",
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator, owner: P1, zone: "play" },
      { key: "pem", def: printing(ECTO), owner: P1, zone: "discard" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  activate(game.engine, P1, game.id("re"), "raise", { selected: { t: [game.id("pem")] } });
  assert.equal(zoneOf(game.engine, game.id("pem")), "play");
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { nr: [game.id("mine")] } });
  assert.equal(tokens(game.engine, game.id("mine")), 1);
});

clause(ECTO, "0:rule", "a face-down Puerile Ecto-Manipulator (a resource) has no trigger when it is put into play face-down", () => {
  const reanimator = item({
    name: "Reanimator",
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", faceDown: true }]
        }
      ]
    }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator, owner: P1, zone: "play" },
      { key: "pem", def: printing(ECTO), owner: P1, zone: "discard" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  activate(game.engine, P1, game.id("re"), "raise", { selected: { t: [game.id("pem")] } });
  assert.equal(game.engine.state.cards[game.id("pem")].faceDown, true);
  assert.equal(pending(game.engine), undefined, "a face-down card is only a resource: no trigger");
});

clause(ECTO, "0:rule", "costs 1 and needs [O] to deploy", () => {
  const paid = ectoBoard();
  playRaw(paid.engine, P1, paid.id("pem"));
  assert.equal(ready(paid.engine, P1), 1);
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pem", def: printing(ECTO), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pem")));
  const noResources = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pem", def: printing(ECTO), owner: P1, zone: "hand" }] });
  assert.throws(() => playRaw(noResources.engine, P1, noResources.id("pem")));
});

// --- Extra coverage: deploy costs and edge cases ----------------------------------

/** Deploys the card under test from hand with `obsession` [O] banks (plus `rage` Rage); returns whether it was accepted and how many resources are left. */
function deployWith(id: string, obsession: number, rage = 0): { accepted: boolean; left: number; zone: string } {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("rage", rage, P1)]
  });
  try {
    playRaw(game.engine, P1, game.id("c"));
  } catch {
    return { accepted: false, left: ready(game.engine, P1), zone: zoneOf(game.engine, game.id("c")) };
  }
  return { accepted: true, left: ready(game.engine, P1), zone: zoneOf(game.engine, game.id("c")) };
}

clause(BEAST, "0:rule", "deploys for its printed cost 5 with [O][O]: refused at 4 resources or with one [O]", () => {
  assert.deepEqual(deployWith(BEAST, 5), { accepted: true, left: 0, zone: "deploying" });
  assert.equal(deployWith(BEAST, 7).left, 2, "exactly 5 paid");
  assert.equal(deployWith(BEAST, 4).accepted, false, "one resource short");
  assert.equal(deployWith(BEAST, 1, 6).accepted, false, "only one [O]");
  assert.equal(deployWith(BEAST, 0, 6).accepted, false, "no [O]");
});

clause(BEAST, "0:rule", "has its printed stats 3/3/3 in play", () => {
  const game = buildGame({ cards: [{ key: "bb", def: printing(BEAST), owner: P1, zone: "play" }] });
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), 3);
  assert.equal(game.engine.getStat(game.id("bb"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), 3);
  assert.deepEqual(game.engine.getSubtypes(game.id("bb")).sort(), ["beast", "monstrosity"]);
});

clause(BEAST, "0:rule", "a card an opponent discards as a COST also counts as a discard", () => {
  const printed = printing(BEAST);
  const tollbooth = item({
    name: "Toll",
    behavior: {
      abilities: [
        {
          id: "toll",
          type: "activated",
          costs: [{ type: "discard", id: "paid", player: "controller", selector: { zone: "hand", controller: "self" }, count: 2 }],
          effects: []
        }
      ]
    }
  });
  const game = buildGame({
    activePlayerId: P2,
    cards: [
      { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "toll", def: tollbooth, owner: P2, zone: "play" },
      ...handCards("o", 3, P2)
    ]
  });
  activate(game.engine, P2, game.id("toll"), "toll", { selected: { paid: [game.id("o0"), game.id("o1")] } });
  assert.equal(game.engine.state.players[P2].discard.length, 2, "the opponent did discard 2 as a cost");
  assert.equal(game.engine.getStat(game.id("bb"), "strength"), printed.strength! + 2);
  assert.equal(game.engine.getStat(game.id("bb"), "life"), printed.life! + 2);
});

clause(GUARD, "0:rule@oooo", "deploys for its printed cost 7 with [O]: refused at 6 resources or without [O]", () => {
  assert.deepEqual(deployWith(GUARD, 7), { accepted: true, left: 0, zone: "deploying" });
  assert.equal(deployWith(GUARD, 9).left, 2, "exactly 7 paid");
  assert.equal(deployWith(GUARD, 6).accepted, false, "one resource short");
  assert.equal(deployWith(GUARD, 0, 9).accepted, false, "no [O]");
});

clause(GUARD, "0:rule@oooo", "has its printed stats 4/3/5 in play", () => {
  const game = guardBoard();
  assert.equal(game.engine.getStat(game.id("gb"), "strength"), 4);
  assert.equal(game.engine.getStat(game.id("gb"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("gb"), "life"), 5);
});

clause(HATE, "0:rule", "deploys for its printed cost 2 with [O][O]: refused one short or with one [O]", () => {
  assert.deepEqual(deployWith(HATE, 2), { accepted: true, left: 0, zone: "deploying" });
  assert.equal(deployWith(HATE, 4).left, 2, "exactly 2 paid");
  assert.equal(deployWith(HATE, 1).accepted, false, "one resource short");
  assert.equal(deployWith(HATE, 1, 3).accepted, false, "only one [O]");
});

clause(HATE, "0:rule", "has its printed stats 1/1/2 in play and no tokens", () => {
  const game = hateBoard(0, [], false);
  assert.equal(str(game, "hom"), 1);
  assert.equal(game.engine.getStat(game.id("hom"), "speed"), 1);
  assert.equal(lifeOf(game, "hom"), 2);
  assert.equal(tokens(game.engine, game.id("hom")), 0, "it enters play with no tokens");
});

clause(IGNATIUS, "0:unique", "deploys for its printed cost 4 with [O][O][O]: refused one short or with only two [O]", () => {
  assert.deepEqual(deployWith(IGNATIUS, 4), { accepted: true, left: 0, zone: "deploying" });
  assert.equal(deployWith(IGNATIUS, 6).left, 2, "exactly 4 paid");
  assert.equal(deployWith(IGNATIUS, 3).accepted, false, "one resource short");
  assert.equal(deployWith(IGNATIUS, 2, 4).accepted, false, "only two [O]");
});

clause(IGNATIUS, "0:unique", "has its printed stats 1/3/5 in play", () => {
  const game = ignatiusBoard();
  assert.equal(game.engine.getStat(game.id("ig"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("ig"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("ig"), "life"), 5);
});

clause(ELDRIDGE, "0:unique", "deploys for its printed cost 6 with [O][O][O]: refused one short or with only two [O]", () => {
  assert.equal(deployWith(ELDRIDGE, 6).accepted, true);
  assert.equal(deployWith(ELDRIDGE, 8).left, 2, "exactly 6 paid");
  assert.equal(deployWith(ELDRIDGE, 5).accepted, false, "one resource short");
  assert.equal(deployWith(ELDRIDGE, 2, 6).accepted, false, "only two [O]");
});

clause(ELDRIDGE, "0:unique", "has its printed stats 4/3/5 in play", () => {
  const game = eldInPlayBoard();
  assert.equal(game.engine.getStat(game.id("eg"), "strength"), 4);
  assert.equal(game.engine.getStat(game.id("eg"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("eg"), "life"), 5);
});

clause(ELDRIDGE, "1:rule", "a card you control but do not own can be picked, and a card the opponent controls but you own cannot", () => {
  const game = eldDeployBoard([
    { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
    { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }
  ]);
  play(game.engine, P1, game.id("eg"));
  assert.throws(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { sprinkle: [game.id("lent")] } } } as never),
    "controlled by the opponent"
  );
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [game.id("stolen")] } });
  answerChoice(game.engine, "chooseNumber", P1, { kind: "chooseNumber", value: 1 });
  answerChoice(game.engine, "distributeAmong", P1, { kind: "distributeAmong", shares: { [game.id("stolen")]: 1 } });
  assert.equal(tokens(game.engine, game.id("stolen")), 1);
});

clause(TRIBUTE, "1:rule", "with [V][V][V] but an empty deck there is nothing to look at: the card still resolves", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "at", def: printing(TRIBUTE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("obsession", 2, P1),
      ...volition(3, P1),
      ...bank("rage", 2, P2)
    ]
  });
  playRaw(game.engine, P2, game.id("foe"));
  playRaw(game.engine, P1, game.id("at"));
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("at")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
});

clause(TRIBUTE, "2:rule", "a terminated card never enters play, so its 'enters play' triggers do not happen", () => {
  const drawOnEntry = character({
    name: "Entrant",
    cost: 0,
    behavior: {
      abilities: [{ id: "etb-draw", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const run = (pay: boolean) => {
    const game = tributeBoard({ foe: drawOnEntry });
    const handBefore = handOf(game.engine, P2).length;
    respondWithTribute(game);
    answerChoice(game.engine, "mayPay", P2, { kind: "mayPay", pay });
    return { game, drew: handOf(game.engine, P2).length - handBefore };
  };
  const declined = run(false);
  assert.equal(declined.drew, 0, "terminated: no draw");
  assert.equal(zoneOf(declined.game.engine, declined.game.id("foe")), "discard");
  const paid = run(true);
  assert.equal(paid.drew, 1, "it resolved: the entry trigger drew a card");
  assert.equal(zoneOf(paid.game.engine, paid.game.id("foe")), "play");
});

clause(CALL, "1:rule", "can be deployed in response on the opponent's turn to save a character (a tactic can be played in response)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "cc", def: printing(CALL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foeSpell", def: tactic({ name: "Foe Kill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  playRaw(game.engine, P2, game.id("foeSpell"), { selected: { t: [game.id("mine")] } });
  playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "hand", "saved from the kill spell");
  assert.equal(game.engine.state.cards[game.id("cc")].faceDown, true);
});

clause(CALL, "1:rule", "with no character of the opponent's and no other cards, only the one picked character moves", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CALL), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(game.engine, P1, game.id("cc"), { selected: { c: [game.id("a")] } });
  assert.equal(zoneOf(game.engine, game.id("a")), "hand");
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
});

clause(CONFESSIONS, "1:rule", "the looked-at cards must be split completely: a missing, repeated or foreign card in the answer is refused", () => {
  const game = confBoard();
  const [t0, t1, t2, t3] = deckOf(game.engine, P1);
  playConfessions(game, 1, ["a"], ["b", "c"]);
  assert.deepEqual(reorderChoice(game.engine).cardIds, [t0, t1]);
  const attempt = (order: string[], bottom: string[]) =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order, bottom } } as never);
  assert.throws(() => attempt([t0], []), "t1 missing");
  assert.throws(() => attempt([t0, t0], [t1]), "t0 twice");
  assert.throws(() => attempt([t0, t1, t2], []), "a card that was not looked at");
  assert.throws(() => attempt([t0], [t1, t3]), "a foreign card on the bottom");
  assert.equal(pending(game.engine)?.kind, "reorderDeck", "still waiting for a legal answer");
});

clause(CONFESSIONS, "0:extraCost", "X = 0 needs no character of your own: it can bounce one opposing character while you control none", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CONFESSIONS), owner: P1, zone: "hand" },
      { key: "e", def: character({ name: "E" }), owner: P2, zone: "play" },
      ...deckCards("d", 3, P1),
      ...bank("obsession", 3, P1)
    ]
  });
  playRaw(game.engine, P1, game.id("co"), { variables: { x: 0 }, selected: { tovoid: [], bounce: [game.id("e")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("e")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("e")), "handOf(game.engine, P2).includes(game.id(\"e\"))");
});

// --- Extra coverage: interactions that stress the clauses ----------------------------

/** A free tactic that terminates the card or ability it responds to. */
function counterspell(): CardDefinition {
  return tactic({
    name: "Counterspell",
    cost: 0,
    behavior: { abilities: [{ id: "counter", type: "activated", effects: [{ type: "terminate", scope: "respondedItem" }] }] }
  });
}

clause(CALL, "1:rule", "if Close Call is terminated in response, nothing is returned and Close Call goes to the discard pile, not into play as a resource", () => {
  const game = callBoard([{ key: "counter", def: counterspell(), owner: P2, zone: "hand" }]);
  playRaw(game.engine, P1, game.id("cc"), { selected: { c: [game.id("mine")] } });
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("counter"), selected: {} } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "the character was not returned");
  assert.equal(zoneOf(game.engine, game.id("cc")), "discard", "a terminated card goes to its owner's discard pile (CR 314.1)");
});

clause(CONFESSIONS, "1:rule", "if Confessions is terminated in response, no character is returned and no deck is looked at", () => {
  const game = confBoard({ extra: [{ key: "counter", def: counterspell(), owner: P2, zone: "hand" }] });
  const deck = [...deckOf(game.engine, P1)];
  playConfessions(game, 0, [], ["b"], false);
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("counter"), selected: {} } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  assert.equal(pending(game.engine), undefined, "nothing to look at");
  assert.deepEqual(deckOf(game.engine, P1), deck);
  assert.equal(zoneOf(game.engine, game.id("co")), "discard");
});

clause(LAMP, "1:rule", "'loses' beats 'gains' (CR 402.6): a character picked by the Lamp stays without COVERT even when another effect grants it COVERT", () => {
  const cloak = item({
    name: "Covert Cloak",
    behavior: {
      abilities: [{ id: "cloak", type: "continuous", modifiers: [], keywords: [{ selector: { zone: "play", type: "character" }, keyword: "covert" }] }]
    }
  });
  const game = lampBoard([{ key: "cloak", def: cloak, owner: P2, zone: "play" }]);
  // Without the Lamp's pick the cloak gives COVERT to every character, including the plain one.
  assert.ok(hasCovert(game, "plain"), "the cloak grants COVERT");
  deployLamp(game, "oppSpy");
  assert.ok(!hasCovert(game, "oppSpy"), "the picked character stays without COVERT");
  assert.ok(hasCovert(game, "plain"), "unpicked characters still gain it");
});

clause(ELDRIDGE, "1:rule", "when Eldridge dies in battle (lethal damage, not a tactic) its controller still gets the pick", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "c0", def: character({ name: "C0", life: 9 }), owner: P1, zone: "play" },
      { key: "brute", def: character({ name: "Brute", strength: 9, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("brute")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("eg")] });
  autoResolveBattle(game.engine);
  assert.equal(pending(game.engine)?.kind, "selectTargets", "the destroyed trigger asks for its pick");
  assert.equal(pending(game.engine)?.playerId, P1);
  assert.equal(zoneOf(game.engine, game.id("eg")), "discard");
  answerChoice(game.engine, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [game.id("c0")] } });
  answerChoice(game.engine, "chooseNumber", P1, { kind: "chooseNumber", value: 3 });
  answerChoice(game.engine, "distributeAmong", P1, { kind: "distributeAmong", shares: { [game.id("c0")]: 3 } });
  assert.equal(tokens(game.engine, game.id("c0")), 3);
});

clause(BIB, "4:ability:bib-checkout", "paying the cost that drops its structure to its damage destroys the Bibliotheca at once, before the ability resolves", () => {
  const game = bibBoard({ tokens: 4, damage: 2, extra: handCards("o", 2, P2) });
  startCheckOut(game);
  assert.ok(game.engine.state.responseWindow, "the ability is waiting for responses");
  assert.equal(zoneOf(game.engine, game.id("bib")), "discard", "structure 2, damage 2: destroyed immediately (CR 207.5)");
});

// -- Abilities still resolve when their source leaves play in response (CR 502.4) ------------

/** A free tactic that destroys one chosen card of any non-resource type in play. */
function destroyAnything(): CardDefinition {
  return tactic({
    name: "Destroy Anything",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "resource" } }] }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

clause(ELDRIDGE, "2:ability:eldridge-rite", "still fetches the tactic when Eldridge is destroyed in response (the ability resolves as paid, CR 502.4)", () => {
  const game = riteBoard(2, [{ key: "kill", def: destroyAnything(), owner: P2, zone: "hand" }]);
  game.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: game.id("eg"),
    abilityId: "eldridge-rite",
    selected: { t: [game.id("inDiscard")] },
    variables: {}
  } as never);
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("kill"), selected: { t: [game.id("eg")] } } as never);
  resolvePendingResponses(game.engine);
  drain(game.engine, eldScript(game, { pick: [] }));
  assert.equal(zoneOf(game.engine, game.id("eg")), "discard", "Eldridge died");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "hand", "but the ability still resolved");
});

clause(BIB, "3:ability:bib-research", "still draws 2 and puts a card on the bottom when the Bibliotheca is destroyed in response (CR 502.4)", () => {
  const game = bibBoard({ extra: [{ key: "kill", def: destroyAnything(), owner: P2, zone: "hand" }] });
  const deck = [...deckOf(game.engine, P1)];
  startResearch(game);
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("kill"), selected: { t: [game.id("bib")] } } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("bib")), "discard");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the ability resolved: pick a card to put away");
  assert.deepEqual(handOf(game.engine, P1), deck.slice(0, 2));
  answerChoice(game.engine, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [deck[1]] });
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BIB, "4:ability:bib-checkout", "still makes the opponent discard 2 when the Bibliotheca is destroyed in response (CR 502.4)", () => {
  const game = bibBoard({ tokens: 4, extra: [{ key: "kill", def: destroyAnything(), owner: P2, zone: "hand" }, ...handCards("o", 3, P2)] });
  startCheckOut(game);
  game.engine.perform({ type: "playCard", playerId: P2, cardId: game.id("kill"), selected: { t: [game.id("bib")] } } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("bib")), "discard");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerChoice(game.engine, "chooserSelectsTarget", P2, { kind: "chooserSelectsTarget", selected: [game.id("o0"), game.id("o1")] });
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("o1")), "discard");
});
