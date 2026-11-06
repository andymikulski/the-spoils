// Clause tests — batch 1st-edition-part-2-01. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-01`. Expectations come from
// each card's PRINTED text (1st Edition Part 2 printing) and RULES.md / the CR;
// engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as baseBuildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { battleOf, covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert, declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { endTurn, spentResources, developOffers, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

/** `buildGame` with a fixed random source, so shuffles, coin flips and random picks are deterministic (tests that assert a shuffle pass their own). */
const buildGame = (options: Parameters<typeof baseBuildGame>[0] = {}) => baseBuildGame({ ...options, random: options.random ?? (() => 0.5) });

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);

/** Answers the open `chooserSelectsTarget` choice with `selected` (draining the response window afterwards). */
function pick(engine: SpoilsEngine, selected: CardInstanceId[]): void {
  answerPending(engine, "chooserSelectsTarget", { selected });
}

/** Same as `pick` but WITHOUT draining the response window, and by an explicit player (for refusal checks). */
function pickRaw(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const pc = pending(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: player ?? pc!.playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `chooseNumber` choice. */
function chooseNumber(engine: SpoilsEngine, value: number): void {
  answerPending(engine, "chooseNumber", { value });
}

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number): CardDefinition {
  return tactic({
    name: `Pump${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
function bounceTactic(): CardDefinition {
  return tactic({
    name: "Bounce",
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

/** A free tactic that destroys one picked non-resource card of any type (id `k`, declaration `t`). */
function smiteTactic(): CardDefinition {
  return tactic({
    name: "Smite",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

// =============================================================================
// Ambiguity Embiggener
// =============================================================================
// At the start of each player's turn, that player picks a number for X. Both
// players put X cards from their hand on the bottom of their deck in any order.
// (If a player has less than X cards they put their entire hand on the bottom.)
// Both players put the top Y cards of their deck into their hand, where Y is the
// number of cards that player put on the bottom of their deck.
// Item, cost 3, threshold [O][O].

const EMBIGGENER = "88ddad6c-4df5-4baa-b1b8-c7492f67d42e";

function embiggenerBoard(opts: { p1Hand?: number; p2Hand?: number; p1Deck?: number; p2Deck?: number; controller?: Pid; zone?: "play" | "hand"; startActive?: Pid; copies?: number } = {}) {
  const zone = opts.zone ?? "play";
  const copies = Array.from({ length: opts.copies ?? 1 }, (_, i) => ({
    key: i === 0 ? "emb" : `emb${i + 1}`,
    def: printing(EMBIGGENER),
    owner: P1 as Pid,
    zone,
    controller: zone === "play" ? opts.controller : undefined
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.startActive ?? P2,
    cards: [
      ...copies,
      ...fillers("p1h", opts.p1Hand ?? 3, P1, "hand"),
      ...fillers("p1d", opts.p1Deck ?? 5, P1, "deck"),
      ...fillers("p2h", opts.p2Hand ?? 3, P2, "hand"),
      ...fillers("p2d", opts.p2Deck ?? 5, P2, "deck")
    ]
  });
}

type Board = ReturnType<typeof embiggenerBoard>;

/** Answers the whole Embiggener sequence: the active player names `x`, then each player puts `picks[player]` (ids) on the bottom. Fails on any other kind of choice. */
function runEmbiggener(b: Board, x: number, picks: Partial<Record<Pid, CardInstanceId[]>>): void {
  drain(b.engine, (pc: PendingChoiceLike) => {
    if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: x };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: picks[pc.playerId as Pid] ?? [] };
    throw new Error(`unexpected pending choice ${pc.kind}`);
  });
}

const ids = (b: Board, keys: string[]) => keys.map((key) => b.id(key));

clause(EMBIGGENER, "0:rule", "at the start of its controller's turn the player whose turn it is picks the number X", () => {
  const b = embiggenerBoard();
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "P1's turn has started");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooseNumber", "the first thing asked is a number");
  assert.equal(pc.playerId, P1, "the player whose turn it is picks X");
});

clause(EMBIGGENER, "0:rule", "at the start of the OPPONENT's turn the opponent picks X (not the Embiggener's controller)", () => {
  const b = embiggenerBoard({ startActive: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "the Embiggener also triggers at the start of the opponent's turn");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P2, "it is P2's turn, so P2 picks X");
});

clause(EMBIGGENER, "0:rule", "X=2 on P1's turn: both players put 2 cards from their hand on the bottom of their deck and put the top 2 cards of their deck into their hand", () => {
  const b = embiggenerBoard({ p1Hand: 3, p2Hand: 3, p1Deck: 5, p2Deck: 5 });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  // the active player puts cards on the bottom first, then the other player
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "P1 (the active player) chooses first");
  pick(b.engine, ids(b, ["p1h0", "p1h2"]));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2, "then P2 chooses their own cards");
  pick(b.engine, ids(b, ["p2h1", "p2h2"]));
  assert.equal(b.engine.state.pendingChoice, undefined);

  // P1: hand p1h1 + the two cards that were on top of the deck
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("p1h1"), p1Deck[0], p1Deck[1]].sort(), "P1 kept one card and put the old top 2 cards into hand");
  assert.deepEqual(deckOf(b.engine, P1).slice(0, 3), p1Deck.slice(2), "P1's deck lost its top 2 cards");
  assert.deepEqual([...deckOf(b.engine, P1).slice(3)].sort(), [b.id("p1h0"), b.id("p1h2")].sort(), "and the 2 chosen cards are at the bottom");
  // P2: the same, for their own cards
  assert.deepEqual([...handOf(b.engine, P2)].sort(), [b.id("p2h0"), p2Deck[0], p2Deck[1]].sort(), "P2 kept one card and put the old top 2 cards into hand");
  assert.deepEqual(deckOf(b.engine, P2).slice(0, 3), p2Deck.slice(2));
  assert.deepEqual([...deckOf(b.engine, P2).slice(3)].sort(), [b.id("p2h1"), b.id("p2h2")].sort());
});

clause(EMBIGGENER, "0:rule", "X=1 on P2's turn: P2 picks X, both players cycle 1 card (the active player first)", () => {
  const b = embiggenerBoard({ startActive: P1, p1Hand: 2, p2Hand: 2 });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "chooseNumber");
  assert.equal(pending(b.engine)?.playerId, P2);
  chooseNumber(b.engine, 1);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2, "P2 is the active player, so chooses first");
  pick(b.engine, ids(b, ["p2h0"]));
  assert.equal(pending(b.engine)?.playerId, P1);
  pick(b.engine, ids(b, ["p1h1"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("p1h0"), p1Deck[0]].sort());
  assert.equal(deckOf(b.engine, P1)[deckOf(b.engine, P1).length - 1], b.id("p1h1"), "the chosen card is on the bottom");
  assert.deepEqual([...handOf(b.engine, P2)].sort(), [b.id("p2h1"), p2Deck[0]].sort());
  assert.equal(deckOf(b.engine, P2)[deckOf(b.engine, P2).length - 1], b.id("p2h0"));
});

clause(EMBIGGENER, "0:rule", "X=0: nobody puts anything on the bottom and nobody puts cards into hand", () => {
  const b = embiggenerBoard();
  const p1Hand = [...handOf(b.engine, P1)];
  const p2Hand = [...handOf(b.engine, P2)];
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  endTurn(b.engine, P2);
  runEmbiggener(b, 0, {});
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), p1Hand);
  assert.deepEqual(handOf(b.engine, P2), p2Hand);
  assert.deepEqual(deckOf(b.engine, P1), p1Deck);
  assert.deepEqual(deckOf(b.engine, P2), p2Deck);
});

clause(EMBIGGENER, "0:rule", "X can be as large as the hands: X=3 with 3-card hands cycles the whole hand for the top 3 cards", () => {
  const b = embiggenerBoard({ p1Hand: 3, p2Hand: 3, p1Deck: 6, p2Deck: 6 });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  const p1Hand = [...handOf(b.engine, P1)];
  const p2Hand = [...handOf(b.engine, P2)];
  endTurn(b.engine, P2);
  runEmbiggener(b, 3, { [P1]: p1Hand, [P2]: p2Hand });
  assert.deepEqual([...handOf(b.engine, P1)].sort(), p1Deck.slice(0, 3).sort());
  assert.deepEqual([...handOf(b.engine, P2)].sort(), p2Deck.slice(0, 3).sort());
  assert.deepEqual(deckOf(b.engine, P1).slice(0, 3), p1Deck.slice(3));
  assert.deepEqual([...deckOf(b.engine, P1).slice(3)].sort(), p1Hand.sort());
  assert.deepEqual([...deckOf(b.engine, P2).slice(3)].sort(), p2Hand.sort());
});

clause(EMBIGGENER, "0:rule", "a player with less than X cards puts their entire hand on the bottom and takes that many (their Y) from the top; the other player is unaffected by that", () => {
  const b = embiggenerBoard({ p1Hand: 1, p2Hand: 4, p1Deck: 5, p2Deck: 5 });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 3);
  // P1 has 1 card: they put it on the bottom (1 pick is all that is possible)
  pick(b.engine, ids(b, ["p1h0"]));
  // P2 has 4 cards: exactly 3 of them
  pick(b.engine, ids(b, ["p2h0", "p2h1", "p2h2"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), [p1Deck[0]], "P1 put their 1 card on the bottom and put only 1 card (Y = 1) into hand");
  assert.equal(deckOf(b.engine, P1).length, 5);
  assert.equal(deckOf(b.engine, P1)[4], b.id("p1h0"));
  assert.equal(handOf(b.engine, P2).length, 4, "P2 put 3 on the bottom and put 3 into hand, keeping the 4th");
  assert.ok(handOf(b.engine, P2).includes(b.id("p2h3")), "handOf(b.engine, P2).includes(b.id(\"p2h3\"))");
  for (const card of p2Deck.slice(0, 3)) assert.equal(zoneOf(b.engine, card), "hand", "P2 took the top 3 cards");
});

clause(EMBIGGENER, "0:rule", "a player with an EMPTY hand puts nothing on the bottom and takes nothing (Y = 0)", () => {
  const b = embiggenerBoard({ p1Hand: 0, p2Hand: 3 });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Deck = [...deckOf(b.engine, P2)];
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  // P1 has nothing to pick: the only choice left is P2's
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, ids(b, ["p2h0", "p2h1"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), [], "P1 still has no cards");
  assert.deepEqual(deckOf(b.engine, P1), p1Deck, "and their deck is unchanged");
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.ok(handOf(b.engine, P2).includes(p2Deck[0]) && handOf(b.engine, P2).includes(p2Deck[1]), "handOf(b.engine, P2).includes(p2Deck[0]) && handOf(b.engine, P2).includes(p2Deck[1])");
});

clause(EMBIGGENER, "0:rule", "the cards go on the bottom 'in any order': the picker decides which of the two ends up lower", () => {
  /** The keys of the two bottom cards of P1's deck (top to bottom) after choosing `order`. */
  const bottomTwo = (order: string[]) => {
    const b = embiggenerBoard({ p1Hand: 2, p2Hand: 0, p1Deck: 6, p2Deck: 0 });
    endTurn(b.engine, P2);
    chooseNumber(b.engine, 2);
    pick(b.engine, ids(b, order));
    return deckOf(b.engine, P1)
      .slice(-2)
      .map((card) => ["p1h0", "p1h1"].find((key) => b.id(key) === card));
  };
  const ab = bottomTwo(["p1h0", "p1h1"]);
  const ba = bottomTwo(["p1h1", "p1h0"]);
  assert.deepEqual([...ab].sort(), ["p1h0", "p1h1"], "the two chosen cards are the two bottom cards");
  assert.deepEqual([...ba].sort(), ["p1h0", "p1h1"]);
  assert.notDeepEqual(ab, ba, "choosing the cards in the other order puts them in the other order");
  assert.deepEqual(ab, [...ba].reverse());
});

clause(EMBIGGENER, "0:rule", "exactly X cards must be put on the bottom: fewer than X (including none) is refused while the hand has enough cards", () => {
  const b = embiggenerBoard({ p1Hand: 3 });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  assert.equal(pending(b.engine)?.playerId, P1);
  refused(() => pickRaw(b.engine, ids(b, ["p1h0"])), "1 card is not X=2");
  refused(() => pickRaw(b.engine, []), "no cards is not X=2");
  assert.equal(zoneOf(b.engine, b.id("p1h0")), "hand", "nothing moved");
  pickRaw(b.engine, ids(b, ["p1h0", "p1h1"]));
  assert.equal(zoneOf(b.engine, b.id("p1h0")), "deck", "exactly X is accepted");
});

clause(EMBIGGENER, "0:rule", "more than X cards cannot be put on the bottom", () => {
  const b = embiggenerBoard({ p1Hand: 3 });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 1);
  refused(() => pickRaw(b.engine, ids(b, ["p1h0", "p1h1"])));
  refused(() => pickRaw(b.engine, ids(b, ["p1h0", "p1h1", "p1h2"])));
  assert.equal(zoneOf(b.engine, b.id("p1h0")), "hand");
  pickRaw(b.engine, ids(b, ["p1h2"]));
  assert.equal(zoneOf(b.engine, b.id("p1h2")), "deck");
});

clause(EMBIGGENER, "0:rule", "the second player is held to X as well: fewer than X is refused for the non-active player", () => {
  const b = embiggenerBoard({ p1Hand: 3, p2Hand: 3 });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  pick(b.engine, ids(b, ["p1h0", "p1h1"]));
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => pickRaw(b.engine, ids(b, ["p2h0"])), "P2 must also put 2 cards on the bottom");
  refused(() => pickRaw(b.engine, []));
  pickRaw(b.engine, ids(b, ["p2h0", "p2h1"]));
  assert.equal(zoneOf(b.engine, b.id("p2h0")), "deck");
});

clause(EMBIGGENER, "0:rule", "cards must come from the picking player's own hand: the opponent's hand, play, the discard pile and the deck are refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "emb", def: printing(EMBIGGENER), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck")
    ]
  });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 1);
  assert.equal(pending(b.engine)?.playerId, P1);
  refused(() => pickRaw(b.engine, [b.id("theirs")]), "the opponent's hand");
  refused(() => pickRaw(b.engine, [b.id("inPlay")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("inDiscard")]), "a card in the discard pile");
  refused(() => pickRaw(b.engine, [b.id("d0")]), "a card already in the deck");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P1].factionId!]), "the faction card");
  pickRaw(b.engine, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "deck");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "hand", "the opponent's hand is untouched");
});

clause(EMBIGGENER, "0:rule", "the same card cannot be picked twice to reach X", () => {
  const b = embiggenerBoard({ p1Hand: 3 });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  refused(() => pickRaw(b.engine, ids(b, ["p1h0", "p1h0"])));
  assert.equal(zoneOf(b.engine, b.id("p1h0")), "hand");
});

clause(EMBIGGENER, "0:rule", "X must be a whole number of at least 0: negative and fractional numbers are refused", () => {
  const b = embiggenerBoard();
  endTurn(b.engine, P2);
  refused(() => chooseNumber(b.engine, -1), "negative");
  refused(() => chooseNumber(b.engine, 1.5), "fractional (CR 410.2)");
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "the choice is still open");
  chooseNumber(b.engine, 0);
  assert.equal(pending(b.engine), undefined, "0 is a legal X: choosing 0 cards is not a decision, so no prompt is opened (SYS-25)");
});

clause(EMBIGGENER, "0:rule", "the opponent of the player whose turn it is cannot pick X", () => {
  const b = embiggenerBoard();
  endTurn(b.engine, P2);
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseNumber", value: 1 } } as never));
  assert.equal(pending(b.engine)?.kind, "chooseNumber");
});

clause(EMBIGGENER, "0:rule", "the top Y cards are taken AFTER the cards were put on the bottom: with an empty deck the cards just put there come straight back", () => {
  const b = embiggenerBoard({ p1Hand: 2, p1Deck: 0, p2Hand: 0, p2Deck: 0 });
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  pick(b.engine, ids(b, ["p1h0", "p1h1"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 2, "both cards were put on the (empty) deck's bottom and are the top 2 cards of the deck again");
  assert.equal(deckOf(b.engine, P1).length, 0);
});

clause(EMBIGGENER, "0:rule", "a deck with fewer than Y cards gives what it has once the bottomed cards are counted (3 in hand, 1 in deck, X=2)", () => {
  const b = embiggenerBoard({ p1Hand: 3, p1Deck: 1, p2Hand: 0, p2Deck: 0 });
  const topCard = deckOf(b.engine, P1)[0];
  endTurn(b.engine, P2);
  chooseNumber(b.engine, 2);
  pick(b.engine, ids(b, ["p1h0", "p1h1"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  // deck was [top]; after bottoming it is [top, p1h0, p1h1]; the top 2 cards are top + p1h0
  assert.equal(handOf(b.engine, P1).length, 3, "hand: p1h2 + the top 2 cards of the new deck");
  assert.ok(handOf(b.engine, P1).includes(topCard), "handOf(b.engine, P1).includes(topCard)");
  assert.ok(handOf(b.engine, P1).includes(b.id("p1h2")), "handOf(b.engine, P1).includes(b.id(\"p1h2\"))");
  assert.deepEqual(deckOf(b.engine, P1).length, 1);
});

clause(EMBIGGENER, "0:rule", "it triggers at the start of EVERY player's turn, turn after turn", () => {
  const b = embiggenerBoard({ startActive: P1, p1Hand: 2, p2Hand: 2, p1Deck: 8, p2Deck: 8 });
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.playerId, P2, "P2's turn");
  runEmbiggener(b, 0, {});
  assert.equal(b.engine.state.pendingChoice, undefined);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "P1's turn");
  assert.equal(pending(b.engine)?.playerId, P1);
  runEmbiggener(b, 0, {});
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "and P2's next turn");
  assert.equal(pending(b.engine)?.playerId, P2);
});

clause(EMBIGGENER, "0:rule", "it works the same when the opponent controls the Embiggener", () => {
  const b = embiggenerBoard({ controller: P2, p1Hand: 2, p2Hand: 2 });
  const p1Deck = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooseNumber");
  assert.equal(pending(b.engine)?.playerId, P1, "still the player whose turn it is");
  chooseNumber(b.engine, 1);
  pick(b.engine, ids(b, ["p1h0"]));
  pick(b.engine, ids(b, ["p2h0"]));
  assert.ok(handOf(b.engine, P1).includes(p1Deck[0]), "handOf(b.engine, P1).includes(p1Deck[0])");
  assert.equal(zoneOf(b.engine, b.id("p2h0")), "deck");
});

clause(EMBIGGENER, "0:rule", "it only works while in play: an Embiggener in hand does nothing at the start of a turn", () => {
  const b = embiggenerBoard({ zone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(EMBIGGENER, "0:rule", "it stops working once it leaves play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "emb", def: printing(EMBIGGENER), owner: P1, zone: "play" },
      { key: "smite", def: smiteTactic(), owner: P2, zone: "hand" },
      ...fillers("p1h", 2, P1, "hand"),
      ...fillers("p1d", 3, P1, "deck")
    ]
  });
  play(b.engine, P2, b.id("smite"), { selected: { t: [b.id("emb")] } });
  assert.equal(zoneOf(b.engine, b.id("emb")), "discard");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no X is asked for");
});

clause(EMBIGGENER, "0:rule", "two Embiggeners trigger separately: X is picked and cycled once per copy", () => {
  const b = embiggenerBoard({ copies: 2, p1Hand: 3, p2Hand: 3, p1Deck: 8, p2Deck: 8 });
  endTurn(b.engine, P2);
  let numbers = 0;
  let picks = 0;
  drain(b.engine, (pc: PendingChoiceLike) => {
    if (pc.kind === "orderTriggers") return declineAll(pc);
    if (pc.kind === "chooseNumber") {
      numbers++;
      return { kind: "chooseNumber", value: 1 };
    }
    assert.equal(pc.kind, "chooserSelectsTarget");
    picks++;
    return { kind: "chooserSelectsTarget", selected: [handOf(b.engine, pc.playerId as Pid)[0]] };
  });
  assert.equal(numbers, 2, "X is picked once per Embiggener");
  assert.equal(picks, 4, "each player puts a card on the bottom once per Embiggener");
  assert.equal(handOf(b.engine, P1).length, 3, "each cycle returns the hand to 3 cards");
  assert.equal(handOf(b.engine, P2).length, 3);
});

// =============================================================================
// Ameliorate
// =============================================================================
// Put any number of cards from your hand on the bottom of your deck in any order.
// Put the top X cards of your deck into your hand, where X is the number of cards
// you put on the bottom plus 1. Tactic, cost 1, threshold [O][O][O].

const AMELIORATE = "5a6a4268-1c9c-4a97-8d54-3c247dc82e72";

function ameliorateBoard(opts: { hand?: number; deck?: number; obsession?: number; greed?: number; spentObsession?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "am", def: printing(AMELIORATE), owner: P1, zone: "hand" },
      ...fillers("h", opts.hand ?? 3, P1, "hand"),
      ...fillers("d", opts.deck ?? 6, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...fillers("od", 3, P2, "deck"),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...spentResources(P1, 0)
    ]
  });
}

/** Plays Ameliorate and leaves its "put cards on the bottom" choice open. */
function ameliorateAndWait(b: ReturnType<typeof ameliorateBoard>) {
  play(b.engine, P1, b.id("am"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "Ameliorate asks which hand cards go on the bottom");
  assert.equal(pending(b.engine)?.playerId, P1, "its controller chooses");
}

clause(AMELIORATE, "0:rule", "pays 1, puts the 2 chosen hand cards on the bottom of the deck and puts the top 3 cards (2 + 1) into the hand", () => {
  const b = ameliorateBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  const before = ready(b.engine);
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h0", "h2"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1 is paid");
  assert.equal(zoneOf(b.engine, b.id("am")), "discard", "the tactic ends in its owner's discard pile");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("h1"), ...deckBefore.slice(0, 3)].sort(), "hand: the card kept plus the old top 3 cards");
  assert.deepEqual(deckOf(b.engine, P1).slice(0, 3), deckBefore.slice(3), "the rest of the deck is untouched");
  assert.deepEqual([...deckOf(b.engine, P1).slice(3)].sort(), [b.id("h0"), b.id("h2")].sort(), "the two chosen cards are on the bottom");
});

clause(AMELIORATE, "0:rule", "putting none on the bottom still puts the top 1 card (0 + 1) into the hand", () => {
  const b = ameliorateBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  ameliorateAndWait(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 3 + 1, "3 cards kept plus 1 drawn");
  assert.equal(zoneOf(b.engine, deckBefore[0]), "hand");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore.slice(1), "exactly one card left the deck and nothing went onto it");
});

clause(AMELIORATE, "0:rule", "putting 1 on the bottom puts the top 2 cards into the hand", () => {
  const b = ameliorateBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h1"]));
  assert.equal(handOf(b.engine, P1).length, 2 + 2);
  assert.equal(zoneOf(b.engine, deckBefore[0]), "hand");
  assert.equal(zoneOf(b.engine, deckBefore[1]), "hand");
  assert.equal(zoneOf(b.engine, deckBefore[2]), "deck");
  assert.equal(deckOf(b.engine, P1)[deckOf(b.engine, P1).length - 1], b.id("h1"));
});

clause(AMELIORATE, "0:rule", "'any number' reaches the whole hand: all 3 on the bottom puts the top 4 cards into the hand", () => {
  const b = ameliorateBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h0", "h1", "h2"]));
  assert.deepEqual([...handOf(b.engine, P1)].sort(), deckBefore.slice(0, 4).sort());
  assert.deepEqual(deckOf(b.engine, P1).slice(0, 2), deckBefore.slice(4));
  assert.equal(deckOf(b.engine, P1).length, deckBefore.length - 4 + 3);
});

clause(AMELIORATE, "0:rule", "the cards go on the bottom 'in any order': the picker decides which ends up lower", () => {
  const bottomTwo = (order: string[]) => {
    const b = ameliorateBoard();
    ameliorateAndWait(b);
    pick(b.engine, ids(b, order));
    return deckOf(b.engine, P1)
      .slice(-2)
      .map((card) => ["h0", "h1"].find((key) => b.id(key) === card));
  };
  const ab = bottomTwo(["h0", "h1"]);
  const ba = bottomTwo(["h1", "h0"]);
  assert.deepEqual([...ab].sort(), ["h0", "h1"]);
  assert.deepEqual([...ba].sort(), ["h0", "h1"]);
  assert.deepEqual(ab, [...ba].reverse(), "the other order puts them the other way round");
});

clause(AMELIORATE, "0:rule", "the top X cards are taken after the cards went on the bottom: a short deck hands some of them straight back", () => {
  const b = ameliorateBoard({ hand: 3, deck: 2 });
  const [d0, d1] = deckOf(b.engine, P1);
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h0", "h1"]));
  // deck [d0, d1, h0, h1]: the top 3 cards are d0, d1 and h0
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("h2"), d0, d1, b.id("h0")].sort());
  assert.deepEqual(deckOf(b.engine, P1), [b.id("h1")]);
});

clause(AMELIORATE, "0:rule", "with an empty deck the cards just put on the bottom come straight back (fewer than X are available)", () => {
  const b = ameliorateBoard({ hand: 2, deck: 0 });
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h0", "h1"]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 2, "the 2 cards are the whole deck; X=3 takes what is there");
  assert.equal(deckOf(b.engine, P1).length, 0);
});

clause(AMELIORATE, "0:rule", "with no other card in hand there is nothing to put on the bottom: just the top 1 card is put into the hand", () => {
  const b = ameliorateBoard({ hand: 0 });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("am"));
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), [deckBefore[0]]);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore.slice(1));
});

clause(AMELIORATE, "0:rule", "only cards of YOUR HAND can go on the bottom: the opponent's hand, play, the discard pile, the deck, Ameliorate itself and the faction are refused", () => {
  const b = ameliorateBoard();
  ameliorateAndWait(b);
  refused(() => pickRaw(b.engine, [b.id("oh0")]), "the opponent's hand");
  refused(() => pickRaw(b.engine, [b.id("inPlay")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("inDiscard")]), "a card in the discard pile");
  refused(() => pickRaw(b.engine, [b.id("d0")]), "a card already in the deck");
  refused(() => pickRaw(b.engine, [b.id("am")]), "Ameliorate itself is not in the hand while it resolves");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P1].factionId!]), "the faction card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open after the refusals");
  pick(b.engine, ids(b, ["h0"]));
  assert.equal(zoneOf(b.engine, b.id("h0")), "deck");
  assert.equal(zoneOf(b.engine, b.id("oh0")), "hand", "the opponent's hand is untouched");
});

clause(AMELIORATE, "0:rule", "the same card cannot be put on the bottom twice (to inflate X)", () => {
  const b = ameliorateBoard();
  ameliorateAndWait(b);
  refused(() => pickRaw(b.engine, ids(b, ["h0", "h0"])));
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
});

clause(AMELIORATE, "0:rule", "the opponent's cards are untouched", () => {
  const b = ameliorateBoard();
  const oppHand = [...handOf(b.engine, P2)];
  const oppDeck = [...deckOf(b.engine, P2)];
  ameliorateAndWait(b);
  pick(b.engine, ids(b, ["h0"]));
  assert.deepEqual(handOf(b.engine, P2), oppHand);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
});

clause(AMELIORATE, "0:rule", "costs 1: refused with no ready resource even though the [O][O][O] threshold is met", () => {
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "am", def: printing(AMELIORATE), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...spentResources(P1, 0),
      ...bank("obsession", 3, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }))
    ]
  });
  assert.equal(ready(spent.engine), 0, "all three Obsession are spent");
  refused(() => playRaw(spent.engine, P1, spent.id("am")), "cannot pay 1");
  assert.equal(zoneOf(spent.engine, spent.id("am")), "hand");
  const exact = ameliorateBoard({ obsession: 3 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("am"));
  assert.equal(before - ready(exact.engine), 1, "with a ready resource it costs exactly 1");
});

clause(AMELIORATE, "0:rule", "needs [O][O][O]: refused with only 2 Obsession even with plenty of other resources", () => {
  const short = ameliorateBoard({ obsession: 2, greed: 5 });
  refused(() => playRaw(short.engine, P1, short.id("am")), "[O][O] is not [O][O][O]");
  assert.equal(zoneOf(short.engine, short.id("am")), "hand", "nothing was played");
  assert.equal(ready(short.engine), 7, "and nothing was paid");
  const ok = ameliorateBoard({ obsession: 3, greed: 5 });
  ameliorateAndWait(ok);
  pick(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("am")), "discard", "with [O][O][O] it resolves");
});

// =============================================================================
// Arcanology Recruitment Officer
// =============================================================================
// At the start of your turn, you must pick a character your opponent controls.
// That character gains COVERT until the start of your next turn.
// Character, cost 4, threshold [O][O], 3 strength / 3 speed / 3 life.

const ARO = "7b05e4a8-cff1-441c-91bc-de6f671f8b12";

function aroBoard(opts: { startActive?: Pid; zone?: "play" | "hand"; controller?: Pid; copies?: number; foes?: boolean } = {}) {
  const zone = opts.zone ?? "play";
  const copies = Array.from({ length: opts.copies ?? 1 }, (_, i) => ({
    key: i === 0 ? "aro" : `aro${i + 1}`,
    def: printing(ARO),
    owner: P1 as Pid,
    zone,
    controller: zone === "play" ? opts.controller : undefined
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.startActive ?? P2,
    cards: [
      ...copies,
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...(opts.foes === false
        ? []
        : [
            { key: "f1", def: character({ name: "Foe1", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "f2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" as const }
          ]),
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      ...volition(1, P2),
      ...bank("rage", 1, P2)
    ]
  });
}

clause(ARO, "0:rule", "at the start of your turn you pick a character your opponent controls, and it gains COVERT", () => {
  const b = aroBoard();
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false, "control: not covert beforehand");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine);
  assert.ok(pc, "a pick is required");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the ARO's controller picks");
  pick(b.engine, [b.id("f1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "the picked character gains COVERT");
});

clause(ARO, "0:rule", "only the picked character gains COVERT: not the opponent's other character, not your own characters", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  assert.equal(hasKeyword(b.engine, b.id("f2"), "covert"), false, "the opponent's other character");
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false, "your own character");
  assert.equal(hasKeyword(b.engine, b.id("aro"), "covert"), false, "the ARO itself");
});

clause(ARO, "0:rule", "either of the opponent's characters can be picked", () => {
  for (const key of ["f1", "f2"]) {
    const b = aroBoard();
    endTurn(b.engine, P2);
    pick(b.engine, [b.id(key)]);
    assert.ok(hasKeyword(b.engine, b.id(key), "covert"), `${key} was picked`);
  }
});

clause(ARO, "0:rule", "you MUST pick: choosing nothing is refused while the opponent controls a character", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  refused(() => pickRaw(b.engine, []), "an empty pick is refused");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still required");
  pick(b.engine, [b.id("f2")]);
  assert.ok(hasKeyword(b.engine, b.id("f2"), "covert"), "hasKeyword(b.engine, b.id(\"f2\"), \"covert\")");
});

clause(ARO, "0:rule", "exactly one character is picked (two at once is refused)", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  refused(() => pickRaw(b.engine, ids(b, ["f1", "f2"])));
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false);
  assert.equal(hasKeyword(b.engine, b.id("f2"), "covert"), false);
});

clause(ARO, "0:rule", "the pick must be a character your OPPONENT controls: your own characters, the ARO itself, items, locations, resources and factions are refused", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  const faceDown = b.engine.state.players[P2].play.find((c) => b.engine.state.cards[c].faceDown)!;
  assert.ok(faceDown, "the board has a face-down resource of the opponent's");
  refused(() => pickRaw(b.engine, [b.id("mine")]), "your own character");
  refused(() => pickRaw(b.engine, [b.id("aro")]), "the ARO itself");
  refused(() => pickRaw(b.engine, [b.id("foeItem")]), "the opponent's item");
  refused(() => pickRaw(b.engine, [b.id("foeLoc")]), "the opponent's location");
  refused(() => pickRaw(b.engine, [faceDown]), "the opponent's face-down resource");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P2].factionId!]), "the opponent's faction (CR 202.9)");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(b.engine, [b.id("f1")]);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "a legal pick works");
});

clause(ARO, "0:rule", "if your opponent controls no character there is nothing to pick: no choice is asked and the turn simply starts", () => {
  const b = aroBoard({ foes: false });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ARO, "0:rule", "it triggers at the start of YOUR turn only, not at the start of the opponent's turn", () => {
  const b = aroBoard({ startActive: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the opponent's turn has started");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick is asked");
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
});

clause(ARO, "0:rule", "'your turn' is the controller's turn: an ARO controlled by the opponent picks among its owner's characters at the start of the opponent's turn", () => {
  const b = aroBoard({ startActive: P1, controller: P2 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "P2 controls the ARO, so P2's turn start triggers it");
  assert.equal(pc.playerId, P2);
  refused(() => pickRaw(b.engine, [b.id("f1")]), "P2's own character is not 'a character your opponent controls'");
  pick(b.engine, [b.id("mine")]);
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "P1's character gained COVERT");
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false);
});

clause(ARO, "0:rule", "the COVERT lasts through your own turn AND the opponent's turn in between", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "during your turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "still covert during the opponent's own turn");
});

clause(ARO, "0:rule", "the COVERT ends at the start of your next turn (when you pick again, the old pick is no longer covert)", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "your next turn has started");
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false, "the earlier COVERT is gone at the start of your next turn");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "and you pick again");
  pick(b.engine, [b.id("f2")]);
  assert.ok(hasKeyword(b.engine, b.id("f2"), "covert"), "the new pick is covert");
  assert.equal(hasKeyword(b.engine, b.id("f1"), "covert"), false, "the old pick stays non-covert");
});

clause(ARO, "0:rule", "picking the same character again at the next start of turn keeps it covert", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "hasKeyword(b.engine, b.id(\"f1\"), \"covert\")");
});

clause(ARO, "0:rule", "the COVERT stays even if the ARO leaves play after the pick (it lasts until the start of your next turn)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "aro", def: printing(ARO), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "Foe1" }), owner: P2, zone: "play" },
      { key: "smite", def: smiteTactic(), owner: P2, zone: "hand" }
    ]
  });
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  // P1 ends the turn; on P2's turn P2 destroys the ARO
  endTurn(b.engine, P1);
  play(b.engine, P2, b.id("smite"), { selected: { t: [b.id("aro")] } });
  assert.equal(zoneOf(b.engine, b.id("aro")), "discard");
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "the granted COVERT does not depend on the ARO staying in play");
});

clause(ARO, "0:rule", "it only works while in play: an ARO in hand does nothing at the start of your turn", () => {
  const b = aroBoard({ zone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ARO, "0:rule", "the COVERT is real: the picked character attacking alone cannot be blocked by a non-covert character", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  declareAttackBy(b.engine, P2, [b.id("f1")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] }), "a non-covert character cannot block a covert party");
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine"), b.id("mine2")] }));
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(ARO, "0:rule", "control: a character that was not picked can still be blocked by a non-covert character", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("f2")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("mine")]);
});

clause(ARO, "0:rule", "a party is only covert when every member is: the picked character attacking with an ordinary one can be blocked", () => {
  const b = aroBoard();
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("f1"), b.id("f2")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("mine")]);
});

clause(ARO, "0:rule", "two AROs trigger separately: each requires a pick, and both picked characters are covert", () => {
  const b = aroBoard({ copies: 2 });
  endTurn(b.engine, P2);
  const targets = ["f1", "f2"];
  let picks = 0;
  drain(b.engine, (pc: PendingChoiceLike) => {
    if (pc.kind === "orderTriggers") return declineAll(pc);
    assert.equal(pc.kind, "chooserSelectsTarget");
    return { kind: "chooserSelectsTarget", selected: [b.id(targets[picks++])] };
  });
  assert.equal(picks, 2, "two picks were required");
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "hasKeyword(b.engine, b.id(\"f1\"), \"covert\")");
  assert.ok(hasKeyword(b.engine, b.id("f2"), "covert"), "hasKeyword(b.engine, b.id(\"f2\"), \"covert\")");
});

// =============================================================================
// Cloaked Creeper
// =============================================================================
// COVERT. While this card is a member of an attacking party, the party is COVERT.
// Character (lurker), cost 2, threshold [O][O][O], 1 strength / 1 speed / 1 life.

const CREEPER = "2437c2d0-0578-4d66-826b-c1184c9bd72d";

clause(CREEPER, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(CREEPER));
clause(CREEPER, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(CREEPER));
// (The shared "a party with a non-covert member is not covert" helper cannot be used for this card: its second paragraph
// deliberately makes ANY party containing the Creeper covert, which the 1:rule tests below assert.)
clause(CREEPER, "0:kw:COVERT", "a party made only of covert characters (the Creeper and a covert friend) is covert: ordinary blockers are refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "creeper", def: printing(CREEPER), owner: P1, zone: "play" },
      { key: "covertFriend", def: character({ name: "CovertFriend", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("creeper"), b.id("covertFriend")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] }));
});
clause(CREEPER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(CREEPER));

function creeperBoard(attacker: Pid = P1, opts: { weakenAlly?: boolean } = {}) {
  const defender = other(attacker);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "creeper", def: printing(CREEPER), owner: attacker, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: attacker, zone: "play" },
      { key: "ally2", def: character({ name: "Ally2", strength: 2, life: 3, speed: 2 }), owner: attacker, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker", strength: 1, life: 5, speed: 1 }), owner: defender, zone: "play" },
      { key: "plainBlocker2", def: character({ name: "PlainBlocker2", strength: 1, life: 5, speed: 1 }), owner: defender, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", strength: 1, life: 5, speed: 1, behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" },
      { key: "killer", def: killTactic(), owner: defender, zone: "hand" }
    ]
  });
}

const blockWith = (engine: SpoilsEngine, defender: Pid, ids: CardInstanceId[]) => engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: ids });

clause(CREEPER, "1:rule", "attacking together with ordinary characters makes the whole party covert: an ordinary blocker cannot block it (alone or with a covert blocker)", () => {
  const b = creeperBoard();
  declareAttackBy(b.engine, P1, [b.id("creeper"), b.id("ally")]);
  refused(() => blockWith(b.engine, P2, [b.id("plainBlocker")]), "an ordinary character cannot block the covert party");
  refused(() => blockWith(b.engine, P2, [b.id("plainBlocker"), b.id("covertBlocker")]), "nor join a covert blocker");
  blockWith(b.engine, P2, [b.id("covertBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")], "a covert character can block it");
});

clause(CREEPER, "1:rule", "a party of the Creeper and two ordinary characters is covert too", () => {
  const b = creeperBoard();
  declareAttackBy(b.engine, P1, [b.id("creeper"), b.id("ally"), b.id("ally2")]);
  refused(() => blockWith(b.engine, P2, [b.id("plainBlocker")]));
  refused(() => blockWith(b.engine, P2, [b.id("plainBlocker"), b.id("plainBlocker2")]));
  blockWith(b.engine, P2, [b.id("covertBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")]);
});

clause(CREEPER, "1:rule", "control: the same ordinary attacker WITHOUT the Creeper in its party can be blocked by an ordinary character", () => {
  const b = creeperBoard();
  declareAttackBy(b.engine, P1, [b.id("ally"), b.id("ally2")]);
  blockWith(b.engine, P2, [b.id("plainBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")]);
});

clause(CREEPER, "1:rule", "the Creeper staying home does not cloak an attack made without it (it must be a member of the attacking party)", () => {
  const b = creeperBoard();
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  blockWith(b.engine, P2, [b.id("plainBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")]);
  assert.equal(hasKeyword(b.engine, b.id("ally"), "covert"), false);
});

clause(CREEPER, "1:rule", "it works for the other player's Creeper too (P2 attacking P1)", () => {
  const b = creeperBoard(P2);
  declareAttackBy(b.engine, P2, [b.id("creeper"), b.id("ally")]);
  refused(() => blockWith(b.engine, P1, [b.id("plainBlocker")]));
  blockWith(b.engine, P1, [b.id("covertBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")]);
});

clause(CREEPER, "1:rule", "being in a BLOCKING party does not make that party covert: an ordinary character cannot join the Creeper in blocking a covert attacker", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "creeper", def: printing(CREEPER), owner: P1, zone: "play" },
      { key: "ordinary", def: character({ name: "Ordinary" }), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("covertAttacker")]);
  refused(() => blockWith(b.engine, P1, [b.id("creeper"), b.id("ordinary")]), "an ordinary character still cannot block a covert party, Creeper or not");
  blockWith(b.engine, P1, [b.id("creeper")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("creeper")], "the Creeper itself (COVERT) can block it");
});

clause(CREEPER, "1:rule", "the party is covert only while the Creeper is a member: the Creeper destroyed before blockers leaves an ordinary attacker that can be blocked", () => {
  const b = creeperBoard();
  declareAttackOpenWindow(b.engine, P1, [b.id("creeper"), b.id("ally")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the defender may respond");
  playRaw(b.engine, P2, b.id("killer"), { selected: { t: [b.id("creeper")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("creeper")), "discard", "the Creeper is gone");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("ally")], "only the ordinary character is left in the party");
  blockWith(b.engine, P2, [b.id("plainBlocker")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")], "an ordinary blocker may block it now");
});

clause(CREEPER, "1:rule", "the COVERT is only for the party: once the battle is over the ordinary character is not covert", () => {
  const b = creeperBoard();
  declareAttackBy(b.engine, P1, [b.id("creeper"), b.id("ally")]);
  blockWith(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
  assert.equal(hasKeyword(b.engine, b.id("ally"), "covert"), false, "the ally did not keep COVERT");
  assert.equal(hasKeyword(b.engine, b.id("ally2"), "covert"), false);
});

clause(CREEPER, "1:rule", "outside a battle the Creeper's allies are ordinary (no standing aura)", () => {
  const b = creeperBoard();
  assert.equal(hasKeyword(b.engine, b.id("creeper"), "covert"), true, "the Creeper itself is covert");
  assert.equal(hasKeyword(b.engine, b.id("ally"), "covert"), false);
  assert.equal(hasKeyword(b.engine, b.id("plainBlocker"), "covert"), false);
});

// =============================================================================
// Deceptive Muddler
// =============================================================================
// COVERT. If this card inflicts damage to a faction, your opponent must put a card
// from their hand on the top of their deck.
// Character (muddler), cost 4, threshold [O], 2 strength / 3 speed / 1 life.

const MUDDLER = "b28841ab-18e2-4a2e-aeb1-94b124f7baae";

clause(MUDDLER, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(MUDDLER));
clause(MUDDLER, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(MUDDLER));
clause(MUDDLER, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(MUDDLER));
clause(MUDDLER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MUDDLER));

function muddlerBoard(opts: { attacker?: Pid; attackerHand?: number; defenderHand?: number; weaken?: number } = {}) {
  const attacker = opts.attacker ?? P1;
  const defender = other(attacker);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "mud", def: printing(MUDDLER), owner: attacker, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: attacker, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", strength: 1, life: 9, speed: 1, behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" },
      { key: "defInPlay", def: character({ name: "DefInPlay" }), owner: defender, zone: "play" },
      { key: "defDiscard", def: character({ name: "DefDiscard" }), owner: defender, zone: "discard" },
      ...(opts.weaken
        ? [
            {
              key: "weakener",
              def: item({
                name: "Weakener",
                attachTo: "character",
                behavior: { abilities: [{ id: "weaken", type: "continuous" as const, modifiers: [{ target: "attachedTo" as const, stat: "strength" as const, operation: "add" as const, value: -opts.weaken }] }] }
              }),
              owner: attacker,
              zone: "play" as const,
              attachedToKey: "mud"
            }
          ]
        : []),
      ...fillers("atkHand", opts.attackerHand ?? 2, attacker, "hand"),
      ...fillers("defHand", opts.defenderHand ?? 3, defender, "hand"),
      ...fillers("defDeck", 3, defender, "deck"),
      ...fillers("atkDeck", 3, attacker, "deck")
    ]
  });
}

/** The attacker attacks the opponent's faction with `attackers` (ids); no blockers are declared; battle damage resolves until a choice appears or the battle ends. */
function unblockedAttack(b: ReturnType<typeof muddlerBoard>, attackers: CardInstanceId[], attacker: Pid = P1): void {
  declareAttackBy(b.engine, attacker, attackers);
  b.engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: [] });
  autoResolveBattle(b.engine);
}

clause(MUDDLER, "1:rule", "unblocked damage to the opponent's faction makes the opponent put a card of their hand on the top of their deck", () => {
  const b = muddlerBoard();
  const handBefore = [...handOf(b.engine, P2)];
  const deckBefore = [...deckOf(b.engine, P2)];
  const influence = b.engine.state.players[P2].influence;
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(b.engine.state.players[P2].influence, influence - 2, "the Muddler's 2 strength was inflicted on the faction");
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent has a card to put back");
  assert.equal(pc.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("defHand1")]);
  assert.equal(zoneOf(b.engine, b.id("defHand1")), "deck");
  assert.deepEqual(deckOf(b.engine, P2), [b.id("defHand1"), ...deckBefore], "the chosen card is on the TOP of the deck");
  assert.deepEqual(handOf(b.engine, P2), handBefore.filter((c) => c !== b.id("defHand1")), "and left the hand");
});

clause(MUDDLER, "1:rule", "the OPPONENT (the faction's controller) chooses which card, not the Muddler's controller", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => pickRaw(b.engine, [b.id("defHand0")], P1), "P1 cannot answer P2's decision");
});

clause(MUDDLER, "1:rule", "any card of the opponent's hand can be chosen", () => {
  for (const key of ["defHand0", "defHand1", "defHand2"]) {
    const b = muddlerBoard();
    unblockedAttack(b, [b.id("mud")]);
    pick(b.engine, [b.id(key)]);
    assert.equal(deckOf(b.engine, P2)[0], b.id(key), `${key} went on top`);
  }
});

clause(MUDDLER, "1:rule", "the opponent MUST put a card: choosing none is refused while they have a card in hand", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(b.engine, []), "declining is not allowed");
  assert.equal(zoneOf(b.engine, b.id("defHand0")), "hand");
});

clause(MUDDLER, "1:rule", "exactly one card is put on top (two at once is refused)", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud")]);
  refused(() => pickRaw(b.engine, ids2(b, ["defHand0", "defHand1"])));
  assert.equal(zoneOf(b.engine, b.id("defHand0")), "hand");
  pick(b.engine, [b.id("defHand0")]);
  assert.equal(handOf(b.engine, P2).length, 2);
});

function ids2(b: { id: (key: string) => CardInstanceId }, keys: string[]): CardInstanceId[] {
  return keys.map((key) => b.id(key));
}

clause(MUDDLER, "1:rule", "the card must come from the OPPONENT's hand: the Muddler's controller's own hand cards are refused", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud")]);
  refused(() => pickRaw(b.engine, [b.id("atkHand0")]), "the attacker's hand card");
  assert.equal(zoneOf(b.engine, b.id("atkHand0")), "hand", "and it stayed in the attacker's hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open for a legal card");
  pick(b.engine, [b.id("defHand0")]);
  assert.equal(zoneOf(b.engine, b.id("defHand0")), "deck");
});

clause(MUDDLER, "1:rule", "cards in play, the discard pile or the deck of the opponent are not 'a card from their hand'", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud")]);
  refused(() => pickRaw(b.engine, [b.id("defInPlay")]), "in play");
  refused(() => pickRaw(b.engine, [b.id("defDiscard")]), "in the discard pile");
  refused(() => pickRaw(b.engine, [b.id("defDeck0")]), "already in the deck");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P2].factionId!]), "the faction");
  pick(b.engine, [b.id("defHand2")]);
  assert.equal(deckOf(b.engine, P2)[0], b.id("defHand2"));
});

clause(MUDDLER, "1:rule", "only ONE card goes back even though the opponent has several (the rest of the hand stays)", () => {
  const b = muddlerBoard({ defenderHand: 5 });
  unblockedAttack(b, [b.id("mud")]);
  pick(b.engine, [b.id("defHand4")]);
  assert.equal(handOf(b.engine, P2).length, 4);
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(MUDDLER, "1:rule", "with an empty hand the opponent has nothing to put on top: no choice and the battle just ends", () => {
  const b = muddlerBoard({ defenderHand: 0, attackerHand: 0 });
  const deckBefore = [...deckOf(b.engine, P2)];
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
  assert.deepEqual(deckOf(b.engine, P2), deckBefore);
});

clause(MUDDLER, "1:rule", "with an empty hand the opponent is not asked to pick: the Muddler's controller's own hand is no substitute", () => {
  const b = muddlerBoard({ defenderHand: 0, attackerHand: 2 });
  const attackerHand = [...handOf(b.engine, P1)];
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "the opponent has no card to put on top, so nothing is asked");
  assert.deepEqual(handOf(b.engine, P1), attackerHand, "the attacker's hand is untouched");
});

clause(MUDDLER, "1:rule", "it triggers once for its damage even when other attackers hit the faction in the same battle", () => {
  const b = muddlerBoard();
  unblockedAttack(b, [b.id("mud"), b.id("ally")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("defHand0")]);
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second prompt");
  assert.equal(handOf(b.engine, P2).length, 2, "exactly one card went back");
});

clause(MUDDLER, "1:rule", "damage to a CHARACTER does not trigger it: blocked by a covert character, the opponent keeps their hand", () => {
  const b = muddlerBoard();
  const handBefore = [...handOf(b.engine, P2)];
  declareAttackBy(b.engine, P1, [b.id("mud")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covertBlocker")] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("covertBlocker")].damage ?? 0, 2, "the Muddler damaged the blocker");
  assert.deepEqual(handOf(b.engine, P2), handBefore, "and nothing went back");
});

clause(MUDDLER, "1:rule", "damage inflicted by ANOTHER attacker does not trigger it", () => {
  const b = muddlerBoard();
  const handBefore = [...handOf(b.engine, P2)];
  const influence = b.engine.state.players[P2].influence;
  unblockedAttack(b, [b.id("ally")]);
  assert.equal(b.engine.state.players[P2].influence, influence - 2, "the ally hit the faction");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P2), handBefore);
});

clause(MUDDLER, "1:rule", "an attack that inflicts 0 damage does not trigger it (strength reduced to 0)", () => {
  const b = muddlerBoard({ weaken: 2 });
  assert.equal(b.engine.getStat(b.id("mud"), "strength"), 0);
  const handBefore = [...handOf(b.engine, P2)];
  const influence = b.engine.state.players[P2].influence;
  unblockedAttack(b, [b.id("mud")]);
  assert.equal(b.engine.state.players[P2].influence, influence);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P2), handBefore);
});

clause(MUDDLER, "1:rule", "'your opponent' is whoever the Muddler's controller plays against: P2's Muddler hitting P1 makes P1 put a card on top", () => {
  const b = muddlerBoard({ attacker: P2, attackerHand: 2, defenderHand: 3 });
  unblockedAttack(b, [b.id("mud")], P2);
  const pc = pending(b.engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P1, "P1 (the faction's controller) chooses");
  pick(b.engine, [b.id("defHand1")]);
  assert.equal(deckOf(b.engine, P1)[0], b.id("defHand1"));
  assert.equal(handOf(b.engine, P2).length, 2, "P2's own hand is untouched");
});

// =============================================================================
// Dimensional Rift
// =============================================================================
// TELEPORT -- COST: Pay 4. Deplete this card. Pick a character.
// EFFECT: Put the character into its owner's hand.
// Location, cost 0, threshold [O][O][O][O][O], structure 1.

const RIFT = "79146bd7-cc3c-4a56-9071-feca013f73a8";

function riftBoard(opts: { greed?: number; riftDepleted?: boolean; controller?: Pid; characters?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rift", def: printing(RIFT), owner: P1, zone: "play", controller: opts.controller, depleted: opts.riftDepleted },
      ...(opts.characters === false
        ? []
        : [
            { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" as const },
            { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play" as const, controller: P1 }
          ]),
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("greed", opts.greed ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const teleport = (b: ReturnType<typeof riftBoard>, target: string, player: Pid = P1) =>
  activate(b.engine, player, b.id("rift"), "teleport", { selected: { c: [b.id(target)] } });

clause(RIFT, "0:ability:teleport", "pays 4, depletes the Rift and puts the picked character into its owner's hand", () => {
  const b = riftBoard();
  const before = ready(b.engine);
  teleport(b, "foe");
  assert.equal(before - ready(b.engine), 4, "COST: Pay 4");
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, true, "COST: Deplete this card");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "the character is in a hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("foe")), "its owner's hand");
  assert.equal(zoneOf(b.engine, b.id("rift")), "play", "the Rift stays in play");
});

clause(RIFT, "0:ability:teleport", "one of your own characters can be picked and goes to your hand", () => {
  const b = riftBoard();
  teleport(b, "mine");
  assert.ok(handOf(b.engine, P1).includes(b.id("mine")), "handOf(b.engine, P1).includes(b.id(\"mine\"))");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "other characters are untouched");
});

clause(RIFT, "0:ability:teleport", "a character you control but do not own goes to its OWNER's hand (CR 301.4a / 305.1)", () => {
  const b = riftBoard();
  assert.equal(b.engine.state.cards[b.id("stolen")].controllerId, P1);
  teleport(b, "stolen");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "its owner's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), false);
});

clause(RIFT, "0:ability:teleport", "only the picked character moves: the other characters, the item and the location stay in play", () => {
  const b = riftBoard();
  teleport(b, "foe");
  for (const key of ["mine", "stolen", "thing", "place", "rift"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays in play`);
});

clause(RIFT, "0:ability:teleport", "the pick must be a character: items, locations, the Rift itself and factions are refused", () => {
  const b = riftBoard();
  const attempt = (cardId: CardInstanceId) => () => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [cardId] });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.id("rift")), "the Rift itself");
  refused(attempt(b.engine.state.players[P2].factionId!), "a faction");
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, false, "nothing was paid by the refused attempts");
  assert.equal(ready(b.engine), 6);
  teleport(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "a character is accepted");
});

clause(RIFT, "0:ability:teleport", "a face-down resource is not a character and cannot be picked", () => {
  const b = riftBoard({ extra: volition(1, P2) });
  const faceDown = b.engine.state.players[P2].play.find((c) => b.engine.state.cards[c].faceDown)!;
  assert.ok(faceDown, "faceDown");
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [faceDown] }));
  assert.equal(zoneOf(b.engine, faceDown), "play");
});

clause(RIFT, "0:ability:teleport", "exactly one character is picked (none, or two, is refused)", () => {
  const b = riftBoard();
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [] }), "no pick");
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", {}), "no declaration");
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [b.id("foe"), b.id("mine")] }), "two picks");
  assert.equal(ready(b.engine), 6, "nothing was paid");
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, false);
});

clause(RIFT, "0:ability:teleport", "is refused one resource short of 4 (3 ready), and accepted with exactly 4", () => {
  const short = riftBoard({ greed: 3 });
  refused(() => playRawAbility(short.engine, P1, short.id("rift"), "teleport", { c: [short.id("foe")] }));
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");
  assert.equal(short.engine.state.cards[short.id("rift")].depleted, false, "the Rift was not depleted");
  const exact = riftBoard({ greed: 4 });
  teleport(exact, "foe");
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand");
  assert.equal(ready(exact.engine), 0, "all 4 were spent");
});

clause(RIFT, "0:ability:teleport", "the 4 can be paid with any resources (no icon is required for the ability)", () => {
  const b = riftBoard({ greed: 0, extra: [...bank("rage", 2, P1), ...bank("deception", 2, P1)] });
  teleport(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(RIFT, "0:ability:teleport", "a depleted Rift cannot be used (its cost is depleting it)", () => {
  const b = riftBoard({ riftDepleted: true });
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [b.id("foe")] }));
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(ready(b.engine), 6, "nothing was paid");
});

clause(RIFT, "0:ability:teleport", "it can be used only once per turn: the Rift stays depleted, so a second use is refused", () => {
  const b = riftBoard({ greed: 10 });
  teleport(b, "foe");
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [b.id("mine")] }));
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(RIFT, "0:ability:teleport", "it can be used again after the Rift is restored at the start of its controller's next turn", () => {
  const b = riftBoard({ greed: 10 });
  teleport(b, "foe");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, false, "restored");
  teleport(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
});

clause(RIFT, "0:ability:teleport", "there must be a character to pick: with no character in play it cannot be used and nothing is paid", () => {
  const b = riftBoard({ characters: false });
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [] }));
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, false);
  assert.equal(ready(b.engine), 6);
});

clause(RIFT, "0:ability:teleport", "only the Rift's controller can use it", () => {
  const b = riftBoard();
  refused(() => playRawAbility(b.engine, P2, b.id("rift"), "teleport", { c: [b.id("foe")] }));
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(RIFT, "0:ability:teleport", "a Rift controlled by the opponent works for the opponent (the controller pays and picks)", () => {
  const b = riftBoard({ controller: P2, active: P2, extra: bank("greed", 4, P2) });
  const before = ready(b.engine, P2);
  refused(() => playRawAbility(b.engine, P1, b.id("rift"), "teleport", { c: [b.id("foe")] }), "its owner no longer controls it");
  activate(b.engine, P2, b.id("rift"), "teleport", { selected: { c: [b.id("mine")] } });
  assert.equal(before - ready(b.engine, P2), 4);
  assert.ok(handOf(b.engine, P1).includes(b.id("mine")), "P1's character went to P1's hand");
});

clause(RIFT, "0:ability:teleport", "damage on the character is gone when it leaves play (CR 408.9)", () => {
  const b = riftBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 2 }] });
  assert.equal(b.engine.state.cards[b.id("hurt")].damage, 2);
  teleport(b, "hurt");
  assert.equal(zoneOf(b.engine, b.id("hurt")), "hand");
  assert.equal(b.engine.state.cards[b.id("hurt")].damage ?? 0, 0);
});

clause(RIFT, "0:ability:teleport", "tokens on the character disappear when it leaves play (CR 409.2): it is in hand with no tokens", () => {
  const b = riftBoard({ extra: [{ key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 2 } }] });
  assert.equal(tokensOn(b.engine, b.id("marked")), 2);
  teleport(b, "marked");
  assert.equal(zoneOf(b.engine, b.id("marked")), "hand");
  assert.equal(tokensOn(b.engine, b.id("marked")), 0, "the tokens are gone");
});

clause(RIFT, "0:ability:teleport", "it can be used in response on the opponent's turn: teleporting the character a tactic targets leaves that tactic without a target", () => {
  const b = riftBoard({
    active: P2,
    extra: [{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }]
  });
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond");
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("rift"), abilityId: "teleport", selected: { c: [b.id("foe")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "the character was teleported before the tactic resolved");
  assert.equal(b.engine.state.cards[b.id("rift")].depleted, true);
  assert.equal(b.engine.state.responseWindow, undefined, "everything resolved");
  assert.equal(zoneOf(b.engine, b.id("pump")), "discard", "the pump tactic still resolved (to nothing) and was discarded");
});

clause(RIFT, "0:ability:teleport", "teleporting an attacker in response to its attack takes it out of the battle", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rift", def: printing(RIFT), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("rift"), abilityId: "teleport", selected: { c: [b.id("atk")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "hand");
  assert.deepEqual(battleOf(b.engine)?.attackingParty ?? [], [], "no attacker is left in the battle");
});

/** Raw `activateAbility` WITHOUT draining the response window (for refusal checks). */
function playRawAbility(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, abilityId: string, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

// =============================================================================
// Eccentric Inquisition
// =============================================================================
// Reveal the top 7 cards of your opponent's deck. Remove all revealed tactics from
// the game and put the remaining cards on the bottom of your opponent's deck in any
// order.
// For the rest of the game, you may play tactics removed from the game by this card
// as though they were in your hand and without having the proper resource icons.
// Tactic, cost 2, threshold [O][O][O][O].

const INQUISITION = "847cd807-e515-4c1f-8c4d-fa0ffd7b217d";

/** A tactic that draws its controller a card (ability id `draw`), with the given numeric cost and threshold. */
function drawTactic(name: string, cost: number, threshold = ""): CardDefinition {
  return tactic({
    name,
    cost,
    ...(threshold ? { threshold } : {}),
    behavior: { abilities: [{ id: "draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
}

/**
 * A deck spelled out top to bottom, one letter per card, keyed `o0`, `o1`, ...:
 * c = character, i = item, l = location, r = staple resource, T = tactic (cost 2, needs [R][R][R]), U = tactic (cost 3, needs [R][R][R]).
 */
function deckSpec(shape: string, owner: Pid = P2): CardPlacement[] {
  return [...shape].map((letter, index) => {
    const name = `Spec${index}`;
    const def =
      letter === "c"
        ? character({ name })
        : letter === "i"
          ? item({ name })
          : letter === "l"
            ? location({ name })
            : letter === "r"
              ? resourceCard({ name })
              : drawTactic(name, letter === "T" ? 2 : 3, "rrr");
    return { key: `o${index}`, def, owner, zone: "deck" as const };
  });
}

const DEFAULT_SHAPE = "cTccUccTcc"; // tactics at 1 (cost 2), 4 (cost 3) inside the top 7, and 7 (cost 2) just outside it

function inquisitionBoard(opts: { shape?: string; obsession?: number; caster?: Pid; extra?: CardPlacement[] } = {}) {
  const caster = opts.caster ?? P1;
  const victim = other(caster);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: caster,
    cards: [
      { key: "ei", def: printing(INQUISITION), owner: caster, zone: "hand" },
      ...deckSpec(opts.shape ?? DEFAULT_SHAPE, victim),
      ...fillers("mine", 5, caster, "deck"),
      ...fillers("theirHand", 2, victim, "hand"),
      ...bank("obsession", opts.obsession ?? 6, caster),
      ...(opts.extra ?? [])
    ]
  });
}

type InqBoard = ReturnType<typeof inquisitionBoard>;

/** Casts the Inquisition naming `voidedKeys` (the revealed tactics) and stops at the first open choice. */
function castInquisition(b: InqBoard, voidedKeys: string[], caster: Pid = P1): void {
  play(b.engine, caster, b.id("ei"), { selected: { voided: voidedKeys.map((key) => b.id(key)) } });
}

/** Answers the caster's "put the rest on the bottom" choice with `keys` (top-to-bottom order the cards will end up in). */
function orderBottom(b: InqBoard, keys: string[]): void {
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
  answerPending(b.engine, "reorderDeck", { order: keys.map((key) => b.id(key)) });
}

const keyIds = (b: { id: (key: string) => CardInstanceId }, keys: string[]): CardInstanceId[] => keys.map((key) => b.id(key));
const outOfGame = (engine: SpoilsEngine, cardId: CardInstanceId) => ["void", "removed"].includes(zoneOf(engine, cardId));

clause(INQUISITION, "0:rule", "pays 2, reveals the top 7 cards of the opponent's deck", () => {
  const b = inquisitionBoard();
  const top7 = deckOf(b.engine, P2).slice(0, 7);
  const before = ready(b.engine);
  castInquisition(b, ["o1", "o4"]);
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2 is paid");
  const reveal = b.engine
    .getLog()
    .map((entry) => entry.event)
    .find((event) => event?.type === "cardsRevealed" && event.zone === "deck");
  assert.ok(reveal && reveal.type === "cardsRevealed", "a reveal of deck cards was recorded");
  assert.deepEqual(reveal.cardIds, top7, "exactly the top 7 cards, in order");
  assert.equal(reveal.ownerId, P2, "of the OPPONENT's deck");
  assert.equal(reveal.viewerId, "all", "revealed to everyone");
});

clause(INQUISITION, "0:rule", "all revealed tactics leave the opponent's deck (here two of the seven)", () => {
  const b = inquisitionBoard();
  castInquisition(b, ["o1", "o4"]);
  for (const key of ["o1", "o4"]) {
    assert.ok(outOfGame(b.engine, b.id(key)), `${key} is out of the deck`);
    assert.equal(deckOf(b.engine, P2).includes(b.id(key)), false);
    assert.equal(handOf(b.engine, P2).includes(b.id(key)), false);
    assert.equal(discardOf(b.engine, P2).includes(b.id(key)), false, "it was removed, not discarded");
  }
});

clause(INQUISITION, "0:rule", "the revealed tactics are removed FROM THE GAME (the out-of-game area, CR 403.6), not sent to the Void (CR 403.7)", () => {
  const b = inquisitionBoard();
  castInquisition(b, ["o1", "o4"]);
  assert.equal(zoneOf(b.engine, b.id("o1")), "removed");
  assert.equal(zoneOf(b.engine, b.id("o4")), "removed");
});

clause(INQUISITION, "0:rule", "a tactic just below the top 7 is not revealed and stays in the deck", () => {
  const b = inquisitionBoard();
  castInquisition(b, ["o1", "o4"]);
  assert.equal(zoneOf(b.engine, b.id("o7")), "deck", "the 8th card is a tactic but was not revealed");
});

clause(INQUISITION, "0:rule", "the other revealed cards (characters here) go on the BOTTOM of the opponent's deck in the order the caster chooses", () => {
  const b = inquisitionBoard();
  const deckBefore = [...deckOf(b.engine, P2)];
  castInquisition(b, ["o1", "o4"]);
  const pc = pending(b.engine);
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Inquisition's controller chooses the order, not the deck's owner");
  assert.equal(pc.deckOwnerId, P2, "it is the opponent's deck");
  assert.deepEqual([...(pc.cardIds as string[])].sort(), keyIds(b, ["o0", "o2", "o3", "o5", "o6"]).sort(), "the five revealed non-tactics");
  orderBottom(b, ["o6", "o5", "o3", "o2", "o0"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), keyIds(b, ["o7", "o8", "o9", "o6", "o5", "o3", "o2", "o0"]), "unrevealed cards first, then the chosen order");
  assert.deepEqual(deckOf(b.engine, P2).slice(0, 3), deckBefore.slice(7), "the unrevealed cards kept their order");
});

clause(INQUISITION, "0:rule", "'in any order': the opposite order is possible too", () => {
  const b = inquisitionBoard();
  castInquisition(b, ["o1", "o4"]);
  orderBottom(b, ["o0", "o2", "o3", "o5", "o6"]);
  assert.deepEqual(deckOf(b.engine, P2).slice(3), keyIds(b, ["o0", "o2", "o3", "o5", "o6"]));
});

clause(INQUISITION, "0:rule", "every kind of non-tactic is put on the bottom: characters, items, locations and resources alike", () => {
  const b = inquisitionBoard({ shape: "cTilrTccc" });
  castInquisition(b, ["o1", "o5"]);
  assert.deepEqual([...(pending(b.engine)?.cardIds as string[])].sort(), keyIds(b, ["o0", "o2", "o3", "o4", "o6"]).sort());
  orderBottom(b, ["o0", "o2", "o3", "o4", "o6"]);
  assert.deepEqual(deckOf(b.engine, P2), keyIds(b, ["o7", "o8", "o0", "o2", "o3", "o4", "o6"]));
  for (const key of ["o0", "o2", "o3", "o4", "o6"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck");
});

clause(INQUISITION, "0:rule", "with no tactic among the top 7 nothing is removed and all 7 cards go to the bottom", () => {
  const b = inquisitionBoard({ shape: "cccccccTcc" });
  castInquisition(b, []);
  assert.equal((pending(b.engine)?.cardIds as string[]).length, 7);
  orderBottom(b, ["o3", "o1", "o0", "o2", "o6", "o5", "o4"]);
  assert.deepEqual(deckOf(b.engine, P2), keyIds(b, ["o7", "o8", "o9", "o3", "o1", "o0", "o2", "o6", "o5", "o4"]));
  assert.equal(zoneOf(b.engine, b.id("o7")), "deck", "the tactic outside the top 7 is untouched");
});

clause(INQUISITION, "0:rule", "when all 7 revealed cards are tactics all are removed and there is nothing to put on the bottom", () => {
  const b = inquisitionBoard({ shape: "TUTUTUTcc" });
  castInquisition(b, ["o0", "o1", "o2", "o3", "o4", "o5", "o6"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no ordering choice");
  for (let i = 0; i < 7; i++) assert.ok(outOfGame(b.engine, b.id(`o${i}`)), `o${i}`);
  assert.deepEqual(deckOf(b.engine, P2), keyIds(b, ["o7", "o8"]));
});

clause(INQUISITION, "0:rule", "a deck of fewer than 7 cards: everything in it is revealed (tactics removed, the rest put on the bottom)", () => {
  const b = inquisitionBoard({ shape: "cTcc" });
  castInquisition(b, ["o1"]);
  assert.ok(outOfGame(b.engine, b.id("o1")), "outOfGame(b.engine, b.id(\"o1\"))");
  assert.deepEqual([...(pending(b.engine)?.cardIds as string[])].sort(), keyIds(b, ["o0", "o2", "o3"]).sort());
  orderBottom(b, ["o3", "o2", "o0"]);
  assert.deepEqual(deckOf(b.engine, P2), keyIds(b, ["o3", "o2", "o0"]));
});

clause(INQUISITION, "0:rule", "an empty opponent deck: it can be played, reveals nothing and resolves", () => {
  const b = inquisitionBoard({ shape: "" });
  castInquisition(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ei")), "discard", "the tactic resolved and went to its owner's discard pile");
});

clause(INQUISITION, "0:rule", "the Inquisition itself goes to its owner's discard pile", () => {
  const b = inquisitionBoard();
  castInquisition(b, ["o1", "o4"]);
  orderBottom(b, ["o0", "o2", "o3", "o5", "o6"]);
  assert.equal(zoneOf(b.engine, b.id("ei")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("ei")), "discardOf(b.engine, P1).includes(b.id(\"ei\"))");
});

clause(INQUISITION, "0:rule", "the caster's own deck and the opponent's hand are untouched", () => {
  const b = inquisitionBoard();
  const myDeck = [...deckOf(b.engine, P1)];
  const theirHand = [...handOf(b.engine, P2)];
  castInquisition(b, ["o1", "o4"]);
  orderBottom(b, ["o0", "o2", "o3", "o5", "o6"]);
  assert.deepEqual(deckOf(b.engine, P1), myDeck);
  assert.deepEqual(handOf(b.engine, P2), theirHand);
});

// E3a: "Reveal the top 7 ... Remove all revealed tactics" is rules text (an EFFECT), not a cost: nothing is named when
// it is played, so the old "naming only some of them is refused" checks (which asserted a play-time pick) are
// replaced by what the printed card does: every revealed tactic is removed, and only those.
clause(INQUISITION, "0:rule", "ALL revealed tactics are removed, and nothing is named to say which: both tactics among the top 7 go", () => {
  const b = inquisitionBoard();
  castInquisition(b, []);
  assert.ok(outOfGame(b.engine, b.id("o1")) && outOfGame(b.engine, b.id("o4")), "outOfGame(b.engine, b.id(\"o1\")) && outOfGame(b.engine, b.id(\"o4\"))");
});

clause(INQUISITION, "0:rule", "only REVEALED TACTICS are removed: a revealed non-tactic, a tactic below the top 7 and the caster's own tactics stay", () => {
  const b = inquisitionBoard({ extra: [{ key: "mineTac", def: drawTactic("MineTac", 1), owner: P1, zone: "deck" }] });
  castInquisition(b, []);
  assert.equal(outOfGame(b.engine, b.id("o0")), false, "a revealed non-tactic stays");
  assert.equal(outOfGame(b.engine, b.id("o7")), false, "a tactic below the top 7 stays");
  assert.equal(outOfGame(b.engine, b.id("mineTac")), false, "the caster's own tactic stays");
  assert.ok(outOfGame(b.engine, b.id("o1")) && outOfGame(b.engine, b.id("o4")), "the revealed tactics are removed");
});

clause(INQUISITION, "0:rule", "costs 2: refused with 1 ready resource although the [O][O][O][O] threshold is met", () => {
  const spent = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "ei", def: printing(INQUISITION), owner: P1, zone: "hand" },
      ...deckSpec("cTc"),
      ...bank("obsession", 4, P1).map((placement, index) => (index < 3 ? { ...placement, attachedToKey: "__factionA" } : placement))
    ]
  });
  assert.equal(ready(spent.engine), 1);
  refused(() => playRaw(spent.engine, P1, spent.id("ei"), { selected: { voided: [spent.id("o1")] } }));
  assert.equal(zoneOf(spent.engine, spent.id("ei")), "hand");
});

clause(INQUISITION, "0:rule", "needs [O][O][O][O]: refused with 3 Obsession even with plenty of other resources", () => {
  const short = inquisitionBoard({ obsession: 3, extra: bank("rage", 5, P1) });
  refused(() => castInquisition(short, ["o1", "o4"]));
  assert.equal(zoneOf(short.engine, short.id("ei")), "hand");
  const ok = inquisitionBoard({ obsession: 4 });
  castInquisition(ok, ["o1", "o4"]);
  assert.ok(outOfGame(ok.engine, ok.id("o1")), "with [O][O][O][O] it resolves");
});

clause(INQUISITION, "0:rule", "'Remove all revealed tactics' is part of the EFFECT: the tactic can be played without naming the tactics beforehand (they are found when it resolves)", () => {
  const b = inquisitionBoard();
  playRaw(b.engine, P1, b.id("ei"));
  assert.ok(b.engine.state.responseWindow, "the tactic was played and waits for the opponent's response");
  resolvePendingResponses(b.engine);
  assert.ok(outOfGame(b.engine, b.id("o1")) && outOfGame(b.engine, b.id("o4")), "both revealed tactics were removed when it resolved");
});

clause(INQUISITION, "0:rule", "the top 7 are revealed when it RESOLVES: after a response that draws the top card, the tactic that moved into the top 7 is removed too", () => {
  const b = inquisitionBoard({ extra: [{ key: "respond", def: drawTactic("Respond", 0), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("ei"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("respond"));
  resolvePendingResponses(b.engine);
  // P2 drew o0, so the top 7 are now o1..o7: tactics o1, o4 and o7
  for (const key of ["o1", "o4", "o7"]) assert.ok(outOfGame(b.engine, b.id(key)), `${key} was among the top 7 when the Inquisition resolved`);
});

// --- 1:rule: playing the removed tactics ---------------------------------------

/** Casts the Inquisition on the default deck (removing o1 = cost 2, o4 = cost 3) and answers the ordering choice. */
function inquisitionDone(opts: { obsession?: number; extra?: CardPlacement[]; caster?: Pid } = {}): InqBoard {
  const caster = opts.caster ?? P1;
  const b = inquisitionBoard(opts);
  castInquisition(b, ["o1", "o4"], caster);
  orderBottom(b, ["o0", "o2", "o3", "o5", "o6"]);
  return b;
}

clause(INQUISITION, "1:rule", "you may play a removed tactic from there: it needs [R][R][R], which you do not control, and still resolves", () => {
  const b = inquisitionDone({ obsession: 6 });
  assert.equal(b.engine.getThresholds(P1).rage ?? 0, 0, "the caster has no Rage");
  const handBefore = handOf(b.engine, P1).length;
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("o1"));
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "its effect happened: the caster drew a card");
  assert.ok(handOf(b.engine, P1).includes(top), "handOf(b.engine, P1).includes(top)");
});

clause(INQUISITION, "1:rule", "the removed tactic's numeric cost is still paid (2 for the cost-2 tactic)", () => {
  const b = inquisitionDone({ obsession: 6 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("o1"));
  assert.equal(before - ready(b.engine), 2);
});

clause(INQUISITION, "1:rule", "the numeric cost is not waived: a cost-3 removed tactic is refused with only 2 ready resources and accepted with 3", () => {
  const short = inquisitionDone({ obsession: 4 });
  assert.equal(ready(short.engine), 2);
  refused(() => playRaw(short.engine, P1, short.id("o4")));
  assert.ok(outOfGame(short.engine, short.id("o4")), "still waiting");
  const enough = inquisitionDone({ obsession: 5 });
  assert.equal(ready(enough.engine), 3);
  const before = ready(enough.engine);
  play(enough.engine, P1, enough.id("o4"));
  assert.equal(before - ready(enough.engine), 3);
  assert.equal(zoneOf(enough.engine, enough.id("o4")), "discard");
});

clause(INQUISITION, "1:rule", "a played removed tactic ends in its OWNER's discard pile (the opponent's) and cannot be played again", () => {
  const b = inquisitionDone({ obsession: 8 });
  play(b.engine, P1, b.id("o1"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("o1")), "the opponent owns it");
  assert.equal(discardOf(b.engine, P1).includes(b.id("o1")), false);
  refused(() => playRaw(b.engine, P1, b.id("o1")), "once it is in the discard pile the permission is used up");
});

clause(INQUISITION, "1:rule", "every removed tactic can be played, not just one", () => {
  const b = inquisitionDone({ obsession: 9 });
  play(b.engine, P1, b.id("o1"));
  play(b.engine, P1, b.id("o4"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("o4")), "discard");
});

clause(INQUISITION, "1:rule", "only tactics removed by this card: a tactic in the Void by some other means cannot be played", () => {
  const b = inquisitionDone({
    obsession: 8,
    extra: [{ key: "stray", def: drawTactic("Stray", 0), owner: P2, zone: "void" }]
  });
  refused(() => playRaw(b.engine, P1, b.id("stray")), "not removed by the Inquisition");
  play(b.engine, P1, b.id("o1"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard", "control: a removed tactic is accepted");
});

clause(INQUISITION, "1:rule", "a tactic that stayed in the deck cannot be played from there (only removed ones)", () => {
  const b = inquisitionDone({ obsession: 8 });
  assert.equal(zoneOf(b.engine, b.id("o7")), "deck");
  refused(() => playRaw(b.engine, P1, b.id("o7")));
});

clause(INQUISITION, "1:rule", "the permission is the CASTER's: the opponent cannot play the tactics that were taken from their own deck", () => {
  const b = inquisitionDone({ obsession: 8, extra: [...bank("rage", 6, P2)] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  refused(() => playRaw(b.engine, P2, b.id("o1")), "P2 owns it but it is not in P2's hand");
  assert.ok(outOfGame(b.engine, b.id("o1")), "outOfGame(b.engine, b.id(\"o1\"))");
});

clause(INQUISITION, "1:rule", "'for the rest of the game': the permission is still there several turns later", () => {
  const b = inquisitionDone({ obsession: 8 });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.ok(outOfGame(b.engine, b.id("o1")), "outOfGame(b.engine, b.id(\"o1\"))");
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("o1"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1);
});

clause(INQUISITION, "1:rule", "'as though they were in your hand': a removed tactic can be played in response on the opponent's turn", () => {
  const b = inquisitionDone({ obsession: 8, extra: [{ key: "pump", def: pumpTactic(1), owner: P2, zone: "hand" }, { key: "theirGuy", def: character({ name: "TheirGuy" }), owner: P2, zone: "play" }] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("theirGuy")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  const handBefore = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("o1"));
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "it resolved under the caster's control");
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
});

clause(INQUISITION, "1:rule", "it works for the other player as well: P2's Inquisition lets P2 play the tactics it removed from P1's deck", () => {
  const b = inquisitionDone({ caster: P2, obsession: 8 });
  const handBefore = handOf(b.engine, P2).length;
  const top = deckOf(b.engine, P2)[0];
  play(b.engine, P2, b.id("o1"));
  assert.equal(handOf(b.engine, P2).length, handBefore + 1, "P2 drew a card");
  assert.ok(handOf(b.engine, P2).includes(top), "handOf(b.engine, P2).includes(top)");
  assert.ok(discardOf(b.engine, P1).includes(b.id("o1")), "P1 owns it");
  endTurn(b.engine, P2);
  refused(() => playRaw(b.engine, P1, b.id("o4")), "and P1 cannot play the other one");
});

// =============================================================================
// Ectological Hazard Suit
// =============================================================================
// ATTACH TO CHARACTER.
// When this card enters play, put a token on the attached character.
// The attached character gains 1 strength and 1 life for each token on it.
// HANDOFF -- COST: Pay 1. Deplete a character you control that is not in a battle.
// EFFECT: Attach this card to the character.
// Item (gear), cost 3, threshold [O][O].

const SUIT = "e667dbee-fc6b-4353-b580-ab4c38a3aeb7";

function suitBoard(opts: { obsession?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type SuitBoard = ReturnType<typeof suitBoard>;
const suitPlay = (b: SuitBoard, hostKey: string) => play(b.engine, P1, b.id("suit"), { selected: { attachTo: [b.id(hostKey)] } });
const statLine = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** A board with the Suit already attached to `mine`, which carries `tokens` tokens. */
function suitOnHost(tokens: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1),
      ...extra
    ]
  });
}

clause(SUIT, "0:attach", "attaches to a character you control: it enters play attached to that character and the printed cost of 3 is paid", () => {
  const b = suitBoard();
  const before = ready(b.engine);
  suitPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("suit")), "play");
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined, "no other character gets it");
});

clause(SUIT, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller) and you still control the Suit", () => {
  const b = suitBoard();
  suitPlay(b, "foe");
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("suit")].controllerId, P1);
});

clause(SUIT, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card, a resource", () => {
  const b = suitBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.engine.state.players[P2].factionId!), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  refused(attempt(b.id("res")), "a resource");
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(SUIT, "0:attach", "is refused for a character that is not in play (in hand or in a discard pile)", () => {
  const b = suitBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand");
});

clause(SUIT, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const b = suitBoard();
  refused(() => playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("suit"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand");
});

clause(SUIT, "0:attach", "cannot be played at all when there is no character in play to attach to", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "suit", def: printing(SUIT), owner: P1, zone: "hand" }, ...bank("obsession", 3, P1)]
  });
  refused(() => playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [] } }));
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand");
});

clause(SUIT, "0:attach", "is refused one resource short of its cost of 3, and without [O][O] even with enough other resources", () => {
  const short = suitBoard({ obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("suit"), { selected: { attachTo: [short.id("mine")] } }), "2 resources for a cost of 3");
  const noThreshold = suitBoard({ obsession: 1, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("suit"), { selected: { attachTo: [noThreshold.id("mine")] } }), "one [O] is not [O][O]");
  const exact = suitBoard({ obsession: 2, extra: bank("greed", 1, P1) });
  suitPlay(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("suit")), "play", "[O][O] plus a third resource is enough");
});

clause(SUIT, "0:attach", "when the host is destroyed the Suit leaves play with it (to its owner's discard pile)", () => {
  const b = suitOnHost(0, [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("suit")), "discard", "the attached card follows its host out of play (CR 301.4)");
});

clause(SUIT, "0:attach", "when the host returns to its owner's hand the Suit leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const b = suitOnHost(0, [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand", "the Suit went to its owner's hand, like its host");
});

clause(SUIT, "1:rule", "when it enters play a token is put on the attached character", () => {
  const b = suitBoard();
  suitPlay(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
});

clause(SUIT, "1:rule", "the token goes on the attached character only: not on the Suit, not on another character", () => {
  const b = suitBoard();
  suitPlay(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("suit")), 0, "not on the Suit");
  assert.equal(tokensOn(b.engine, b.id("mine2")), 0);
  assert.equal(tokensOn(b.engine, b.id("foe")), 0);
});

clause(SUIT, "1:rule", "the token is added to the ones already there (2 tokens become 3)", () => {
  const b = suitBoard({ extra: [{ key: "marked", def: character({ name: "Marked", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", counters: { token: 2 } }] });
  suitPlay(b, "marked");
  assert.equal(tokensOn(b.engine, b.id("marked")), 3);
});

clause(SUIT, "1:rule", "the token goes on an opponent's character when the Suit is attached to it", () => {
  const b = suitBoard();
  suitPlay(b, "foe");
  assert.equal(tokensOn(b.engine, b.id("foe")), 1);
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
});

clause(SUIT, "1:rule", "the token is put on when the Suit ENTERS play, not while it waits for responses", () => {
  const b = suitBoard();
  playRaw(b.engine, P1, b.id("suit"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("suit")), "deploying");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0, "no token yet");
  resolvePendingResponses(b.engine);
  assert.equal(tokensOn(b.engine, b.id("mine")), 1, "the token arrives when it enters play");
});

clause(SUIT, "1:rule", "no token is put on a Suit that is already in play (a Suit placed on the board adds nothing)", () => {
  const b = suitOnHost(0);
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
});

clause(SUIT, "2:rule", "the attached character gains 1 strength and 1 life for each token on it (0 tokens: nothing)", () => {
  for (const tokenCount of [0, 1, 2, 4]) {
    const b = suitOnHost(tokenCount);
    assert.deepEqual(statLine(b.engine, b.id("mine")), [2 + tokenCount, 3 + tokenCount, 2], `${tokenCount} token(s): +${tokenCount} strength, +${tokenCount} life, speed unchanged`);
  }
});

clause(SUIT, "2:rule", "playing the Suit: the freshly placed token makes the host 3/4 right away", () => {
  const b = suitBoard();
  suitPlay(b, "mine");
  assert.deepEqual(statLine(b.engine, b.id("mine")), [3, 4, 2]);
});

clause(SUIT, "2:rule", "the bonus follows the number of tokens as it changes", () => {
  const b = suitOnHost(1);
  assert.deepEqual(statLine(b.engine, b.id("mine")), [3, 4, 2]);
  b.engine.state.cards[b.id("mine")].counters.token = 3;
  assert.deepEqual(statLine(b.engine, b.id("mine")), [5, 6, 2], "more tokens, more bonus");
  b.engine.state.cards[b.id("mine")].counters.token = 0;
  assert.deepEqual(statLine(b.engine, b.id("mine")), [2, 3, 2], "no tokens, no bonus");
});

clause(SUIT, "2:rule", "only the tokens on the ATTACHED character count: tokens on the Suit itself and on other characters do not", () => {
  const b = suitOnHost(1);
  b.engine.state.cards[b.id("suit")].counters.token = 5;
  b.engine.state.cards[b.id("mine2")].counters.token = 5;
  assert.deepEqual(statLine(b.engine, b.id("mine")), [3, 4, 2], "only the host's own token counts");
  assert.deepEqual(statLine(b.engine, b.id("mine2")), [2, 3, 2], "another character with tokens gets nothing");
  assert.deepEqual(statLine(b.engine, b.id("foe")), [2, 3, 2]);
});

clause(SUIT, "2:rule", "the bonus is lost when the Suit leaves play", () => {
  const b = suitOnHost(2, [{ key: "smite", def: smiteTactic(), owner: P1, zone: "hand" }]);
  assert.deepEqual(statLine(b.engine, b.id("mine")), [4, 5, 2]);
  play(b.engine, P1, b.id("smite"), { selected: { t: [b.id("suit")] } });
  assert.equal(zoneOf(b.engine, b.id("suit")), "discard");
  assert.deepEqual(statLine(b.engine, b.id("mine")), [2, 3, 2], "the host is back to its printed stats (it keeps its tokens)");
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
});

clause(SUIT, "2:rule", "two Suits on one character each add 1 per token (2 tokens: +4/+4)", () => {
  const b = suitBoard({
    obsession: 6,
    extra: [{ key: "suit2", def: printing(SUIT), owner: P1, zone: "hand" }]
  });
  suitPlay(b, "mine");
  play(b.engine, P1, b.id("suit2"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(tokensOn(b.engine, b.id("mine")), 2, "each Suit put a token on entering");
  assert.deepEqual(statLine(b.engine, b.id("mine")), [2 + 4, 3 + 4, 2]);
});

clause(SUIT, "2:rule", "the extra life is real: damage up to the new life does not destroy the host", () => {
  const b = suitOnHost(1, [{ key: "hurt", def: character({ name: "Hurt", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  b.engine.state.cards[b.id("mine")].damage = 3;
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "3 damage on 4 life");
});

clause(SUIT, "3:ability:handoff", "pays 1, depletes the picked character and attaches the Suit to it (it leaves its old host)", () => {
  const b = suitOnHost(2);
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("mine2")] } });
  assert.equal(before - ready(b.engine), 1, "COST: Pay 1");
  assert.equal(b.engine.state.cards[b.id("mine2")].depleted, true, "COST: Deplete a character you control");
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine2"), "EFFECT: attached to that character");
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, false, "the old host is not depleted");
  assert.equal(zoneOf(b.engine, b.id("suit")), "play");
});

clause(SUIT, "3:ability:handoff", "the bonus moves with the Suit: the old host loses it, the new host gains it for ITS tokens", () => {
  const b = suitOnHost(2, [{ key: "marked", def: character({ name: "Marked", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play", counters: { token: 3 } }]);
  assert.deepEqual(statLine(b.engine, b.id("mine")), [4, 5, 2]);
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("marked")] } });
  assert.deepEqual(statLine(b.engine, b.id("mine")), [2, 3, 2], "the old host lost the bonus");
  assert.deepEqual(statLine(b.engine, b.id("marked")), [1 + 3, 1 + 3, 1], "the new host gains 1 per token it has (3)");
});

clause(SUIT, "3:ability:handoff", "re-attaching does not put another token on the new host (the Suit does not enter play again)", () => {
  const b = suitOnHost(2);
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("mine2")] } });
  assert.equal(tokensOn(b.engine, b.id("mine2")), 0);
  assert.equal(tokensOn(b.engine, b.id("mine")), 2, "the old host keeps its tokens");
  assert.deepEqual(statLine(b.engine, b.id("mine2")), [2, 3, 2], "the new host has no tokens, so no bonus");
});

clause(SUIT, "3:ability:handoff", "it can be handed to the character it is already attached to (it is a character you control that is not in a battle)", () => {
  const b = suitOnHost(1);
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true);
});

clause(SUIT, "3:ability:handoff", "the Suit can be taken from an opponent's character and handed to one of yours", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  assert.equal(b.engine.state.cards[b.id("suit")].controllerId, P1);
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
  assert.deepEqual(statLine(b.engine, b.id("foe")), [2, 3, 2], "the opponent's character lost the bonus");
});

clause(SUIT, "3:ability:handoff", "the character depleted must be one YOU control: an opponent's character is refused", () => {
  const b = suitOnHost(1);
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [b.id("foe")] }));
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  assert.equal(ready(b.engine), 4, "nothing was paid");
});

clause(SUIT, "3:ability:handoff", "it must be a character: the Suit itself, an item, a location, a faction and a face-down card are refused", () => {
  const b = suitOnHost(1, [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }
  ]);
  for (const cardId of [b.id("suit"), b.id("thing"), b.id("place"), b.id("hidden"), b.engine.state.players[P1].factionId!]) {
    refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [cardId] }));
  }
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
  activate(b.engine, P1, b.id("suit"), "handoff", { selected: { w: [b.id("mine2")] } });
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine2"), "control: a character works");
});

clause(SUIT, "3:ability:handoff", "a character that is already depleted cannot be depleted again, so it is refused", () => {
  const b = suitOnHost(1);
  b.engine.state.cards[b.id("mine2")].depleted = true;
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [b.id("mine2")] }));
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
  assert.equal(ready(b.engine), 4, "and nothing was paid");
});

clause(SUIT, "3:ability:handoff", "exactly one character is picked (none, or two, is refused)", () => {
  const b = suitOnHost(1);
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [] }));
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", {}));
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [b.id("mine"), b.id("mine2")] }));
  assert.equal(ready(b.engine), 4);
});

clause(SUIT, "3:ability:handoff", "is refused with no ready resource to pay 1, accepted with exactly 1", () => {
  const none = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 1, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }))
    ]
  });
  assert.equal(ready(none.engine), 0);
  refused(() => playRawAbility(none.engine, P1, none.id("suit"), "handoff", { w: [none.id("mine2")] }));
  assert.equal(none.engine.state.cards[none.id("mine2")].depleted, false);
  const one = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 1, P1)
    ]
  });
  activate(one.engine, P1, one.id("suit"), "handoff", { selected: { w: [one.id("mine2")] } });
  assert.equal(one.engine.state.cards[one.id("suit")].attachedTo, one.id("mine2"));
  assert.equal(ready(one.engine), 0);
});

clause(SUIT, "3:ability:handoff", "a character in a battle cannot be depleted for it: a blocker is refused, a character outside the battle is accepted", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "suit", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("blocker")] });
  // the attacker acts first in the battle's response window, then the defender
  while (b.engine.state.responseWindow && b.engine.state.responseWindow.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow.priorityPlayerId });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may use abilities now");
  refused(() => playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [b.id("blocker")] }), "the blocker is in a battle");
  assert.equal(b.engine.state.cards[b.id("blocker")].depleted, false);
  playRawAbility(b.engine, P1, b.id("suit"), "handoff", { w: [b.id("bystander")] });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("bystander"), "a character that is not in the battle is accepted");
  assert.equal(b.engine.state.cards[b.id("bystander")].depleted, true);
});

clause(SUIT, "3:ability:handoff", "only the Suit's controller can use it", () => {
  const b = suitOnHost(1);
  refused(() => playRawAbility(b.engine, P2, b.id("suit"), "handoff", { w: [b.id("foe")] }));
  assert.equal(b.engine.state.cards[b.id("suit")].attachedTo, b.id("mine"));
});

// =============================================================================
// Eldridge Gosche
// =============================================================================
// UNIQUE ELDRIDGE.
// At the start of your turn, you may pick 2 or fewer non-resource cards you control.
// If you do, put up to 2 tokens divided however you want on those cards.
// EJECT -- COST: Remove 3 tokens from this card. Pick a non-resource card.
//   EFFECT: Put the card into its owner's hand.
// DISRUPT -- COST: Remove 3 tokens from this card.
//   EFFECT: Look at your opponent's hand and pick a card. Your opponent must discard that card.
// Character (ritualist), cost 8, threshold [O][O], 4 strength / 3 speed / 5 life.

const ELDRIDGE = "11f9caf2-79de-478a-a87f-c2fcfb90e11a";
const GODSTEALER = "6d511d44-9e80-443b-b67c-ae9625d671dd"; // Eldridge Gosche, Godstealer (Holy Heist): also UNIQUE ELDRIDGE

function eldridgeBoard(opts: { tokens?: number; depleted?: boolean; startActive?: Pid; zone?: "play" | "hand"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.startActive ?? P2,
    cards: [
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : {}, depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "MyRage" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "ohRes", def: resourceCard({ name: "TheirRage" }), owner: P2, zone: "hand" },
      { key: "ohTac", def: tactic({ name: "TheirTactic" }), owner: P2, zone: "hand" },
      ...fillers("oh", 2, P2, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

type EldBoard = ReturnType<typeof eldridgeBoard>;

/** Answers Eldridge's start-of-turn prompts: `option` 0 = distribute / 1 = decline, the picks, the number, the shares (keys → tokens). */
function eldridgeScript(b: EldBoard, script: { option?: number; picks?: string[]; n?: number; shares?: Record<string, number> }) {
  return (pc: PendingChoiceLike): unknown => {
    switch (pc.kind) {
      case "chooserSelectsOption":
        return { kind: "chooserSelectsOption", index: script.option ?? 0 };
      case "chooserSelectsTarget":
        return { kind: "chooserSelectsTarget", selected: keyIds(b, script.picks ?? []) };
      case "chooseNumber":
        return { kind: "chooseNumber", value: script.n ?? 0 };
      case "distributeAmong": {
        const shares: Record<string, number> = {};
        for (const [key, amount] of Object.entries(script.shares ?? {})) shares[b.id(key)] = amount;
        return { kind: "distributeAmong", shares };
      }
      default:
        throw new Error(`unexpected pending choice ${pc.kind}`);
    }
  };
}

/** P2 ends their turn, so P1's turn (and Eldridge's trigger) starts; the whole script is answered. */
function eldridgeTurn(b: EldBoard, script: Parameters<typeof eldridgeScript>[1]): void {
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  drain(b.engine, eldridgeScript(b, script));
}

const tokenMap = (b: EldBoard, keys: string[]) => Object.fromEntries(keys.map((key) => [key, tokensOn(b.engine, b.id(key))]));

// -- UNIQUE ELDRIDGE --------------------------------------------------------------

function uniqueBoard(second: "gosche" | "godstealer" | "other") {
  const secondDef = second === "gosche" ? printing(ELDRIDGE) : second === "godstealer" ? printing(GODSTEALER) : character({ name: "Not Eldridge", unique: "eldridge" });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "first", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "second", def: secondDef, owner: P1, zone: "hand" },
      ...bank("obsession", 10, P1)
    ]
  });
}

const answerUnique = (b: ReturnType<typeof uniqueBoard>, keep: string) =>
  drain(b.engine, (pc) => {
    if (pc.kind === "uniqueSurvivor") return { kind: "uniqueSurvivor", keep: b.id(keep) };
    return declineAll(pc);
  });

clause(ELDRIDGE, "0:unique", "controlling a second ELDRIDGE makes you keep one: the controller is asked, with both as candidates", () => {
  const b = uniqueBoard("gosche");
  play(b.engine, P1, b.id("second"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller of the duplicates chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("first"), b.id("second")].sort());
});

clause(ELDRIDGE, "0:unique", "keeping the old Eldridge destroys the new one", () => {
  const b = uniqueBoard("gosche");
  play(b.engine, P1, b.id("second"));
  answerUnique(b, "first");
  assert.equal(zoneOf(b.engine, b.id("first")), "play");
  assert.equal(zoneOf(b.engine, b.id("second")), "discard");
  assert.equal(b.engine.state.responseWindow, undefined, "the game carries on");
});

clause(ELDRIDGE, "0:unique", "keeping the NEW Eldridge destroys the old one and the game carries on", () => {
  const b = uniqueBoard("gosche");
  play(b.engine, P1, b.id("second"));
  answerUnique(b, "second");
  assert.equal(zoneOf(b.engine, b.id("second")), "play");
  assert.equal(zoneOf(b.engine, b.id("first")), "discard");
  assert.equal(b.engine.state.responseWindow, undefined, "the deploy finished: the game is not stuck in a resolving window");
});

clause(ELDRIDGE, "0:unique", "the restriction is per player: an opponent may control their own Eldridge", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(ELDRIDGE), owner: P2, zone: "play" },
      ...bank("obsession", 10, P1)
    ]
  });
  play(b.engine, P1, b.id("mine"));
  assert.notEqual(pending(b.engine)?.kind, "uniqueSurvivor", "no conflict is raised");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

clause(ELDRIDGE, "0:unique", "a different card with the same UNIQUE designation counts as a duplicate, whatever its name (keep the old one: the new Eldridge is destroyed)", () => {
  const b = uniqueBoard("other");
  play(b.engine, P1, b.id("second"));
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "the two cards conflict");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(ELDRIDGE, "0:unique", "Eldridge Gosche, Godstealer is also UNIQUE ELDRIDGE: with the Gosche in play it forces a choice too", () => {
  const b = uniqueBoard("godstealer");
  play(b.engine, P1, b.id("second"));
  const seen: string[] = [];
  drain(b.engine, (pc) => {
    seen.push(pc.kind);
    if (pc.kind === "uniqueSurvivor") return { kind: "uniqueSurvivor", keep: b.id("first") };
    return declineAll(pc); // the Godstealer's own enters-play trigger asks for picks first: decline them
  });
  assert.ok(seen.includes("uniqueSurvivor"), "the two Eldridges conflict and the controller is asked which to keep");
  assert.equal(zoneOf(b.engine, b.id("first")), "play");
  assert.equal(zoneOf(b.engine, b.id("second")), "discard", "the other one is destroyed");
});

clause(ELDRIDGE, "0:unique", "a card with a different UNIQUE designation is not a duplicate", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "other", def: character({ name: "Someone", unique: "someone" }), owner: P1, zone: "play" },
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: "hand" },
      ...bank("obsession", 10, P1)
    ]
  });
  play(b.engine, P1, b.id("eld"));
  assert.notEqual(pending(b.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(b.engine, b.id("eld")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

// -- the start-of-turn rule ---------------------------------------------------------

clause(ELDRIDGE, "1:rule", "at the start of your turn you are offered the choice, and you may decline: nothing happens", () => {
  const b = eldridgeBoard();
  endTurn(b.engine, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "Eldridge's controller decides");
  assert.equal(pc?.optionCount, 2, "pick cards, or decline");
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(b.engine.state.pendingChoice, undefined, "declining ends it");
  assert.deepEqual(tokenMap(b, ["eld", "mine", "mine2", "thing", "place", "stolen"]), { eld: 0, mine: 0, mine2: 0, thing: 0, place: 0, stolen: 0 });
});

clause(ELDRIDGE, "1:rule", "two cards, 2 tokens divided 1 and 1", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine", "thing"], n: 2, shares: { mine: 1, thing: 1 } });
  assert.deepEqual(tokenMap(b, ["mine", "thing", "mine2", "place", "eld"]), { mine: 1, thing: 1, mine2: 0, place: 0, eld: 0 });
});

clause(ELDRIDGE, "1:rule", "two cards, both tokens on one of them (divided however you want: 2 and 0)", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine", "place"], n: 2, shares: { place: 2 } });
  assert.deepEqual(tokenMap(b, ["mine", "place"]), { mine: 0, place: 2 });
});

clause(ELDRIDGE, "1:rule", "one card: up to 2 tokens, all of them on that card", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine2"], n: 2, shares: { mine2: 2 } });
  assert.deepEqual(tokenMap(b, ["mine2", "mine", "eld"]), { mine2: 2, mine: 0, eld: 0 });
});

clause(ELDRIDGE, "1:rule", "'up to 2 tokens': a single token is fine (one card, 1 token)", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine"], n: 1, shares: { mine: 1 } });
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
});

clause(ELDRIDGE, "1:rule", "'up to 2 tokens': two cards picked but only one token placed", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine", "mine2"], n: 1, shares: { mine2: 1 } });
  assert.deepEqual(tokenMap(b, ["mine", "mine2"]), { mine: 0, mine2: 1 });
});

clause(ELDRIDGE, "1:rule", "'up to 2 tokens': 0 tokens is allowed (cards picked, none placed)", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine", "mine2"], n: 0 });
  assert.deepEqual(tokenMap(b, ["mine", "mine2", "eld"]), { mine: 0, mine2: 0, eld: 0 });
});

clause(ELDRIDGE, "1:rule", "'if you do': agreeing but picking no card puts no tokens on anything", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: [], n: 2, shares: {} });
  assert.deepEqual(tokenMap(b, ["eld", "mine", "mine2", "thing", "place", "stolen"]), { eld: 0, mine: 0, mine2: 0, thing: 0, place: 0, stolen: 0 });
});

clause(ELDRIDGE, "1:rule", "every kind of non-resource card you control can be picked: a character, an item, a location, Eldridge himself, and a card you took control of", () => {
  for (const key of ["mine", "thing", "place", "eld", "stolen"]) {
    const b = eldridgeBoard();
    eldridgeTurn(b, { picks: [key], n: 1, shares: { [key]: 1 } });
    assert.equal(tokensOn(b.engine, b.id(key)), 1, `${key} received the token`);
  }
});

clause(ELDRIDGE, "1:rule", "'cards you control': the opponent's cards, resources (face-up and face-down), the faction and cards outside play are refused", () => {
  const b = eldridgeBoard();
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: CardInstanceId) => () => pickRaw(b.engine, [cardId]);
  refused(attempt(b.id("foe")), "the opponent's character");
  refused(attempt(b.id("foeItem")), "the opponent's item");
  refused(attempt(b.id("foePlace")), "the opponent's location");
  refused(attempt(b.id("res")), "a face-up resource");
  refused(attempt(b.id("hidden")), "a face-down resource");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.engine.state.players[P2].factionId!), "the opponent's faction");
  refused(attempt(b.id("inHand")), "a card in your hand");
  refused(attempt(b.id("inDiscard")), "a card in your discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(b.engine, [b.id("mine")]);
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "a legal pick is accepted");
});

clause(ELDRIDGE, "1:rule", "'2 or fewer': three cards are refused", () => {
  const b = eldridgeBoard();
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  refused(() => pickRaw(b.engine, keyIds(b, ["mine", "mine2", "thing"])));
  pickRaw(b.engine, keyIds(b, ["mine", "mine2"]));
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "two cards are accepted");
});

clause(ELDRIDGE, "1:rule", "the same card cannot be picked twice", () => {
  const b = eldridgeBoard();
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  refused(() => pickRaw(b.engine, keyIds(b, ["mine", "mine"])));
});

clause(ELDRIDGE, "1:rule", "no more than 2 tokens in total: dividing 3 or more tokens is refused", () => {
  const b = eldridgeBoard();
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  pick(b.engine, keyIds(b, ["mine", "mine2"]));
  refused(() => chooseNumber(b.engine, 3), "up to 2 tokens");
  assert.equal(pending(b.engine)?.kind, "chooseNumber");
  chooseNumber(b.engine, 2);
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  const share = (shares: Record<string, number>) => () =>
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([key, amount]) => [b.id(key), amount])) } } as never);
  refused(share({ mine: 2, mine2: 1 }), "3 tokens in total");
  refused(share({ mine: 3 }), "3 tokens on one card");
  refused(share({ thing: 1 }), "a card that was not picked");
  assert.equal(pending(b.engine)?.kind, "distributeAmong", "the choice is still open");
  share({ mine: 1, mine2: 1 })();
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
  assert.equal(tokensOn(b.engine, b.id("mine2")), 1);
});

clause(ELDRIDGE, "1:rule", "the tokens are added to the ones already on the card", () => {
  const b = eldridgeBoard({ tokens: 3 });
  eldridgeTurn(b, { picks: ["eld"], n: 2, shares: { eld: 2 } });
  assert.equal(tokensOn(b.engine, b.id("eld")), 5);
});

clause(ELDRIDGE, "1:rule", "it triggers only at the start of YOUR turn, not at the start of the opponent's", () => {
  const b = eldridgeBoard({ startActive: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is offered on the opponent's turn");
});

clause(ELDRIDGE, "1:rule", "it triggers at the start of every one of your turns", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["mine"], n: 1, shares: { mine: 1 } });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the second turn offers it again");
  drain(b.engine, eldridgeScript(b, { picks: ["mine"], n: 2, shares: { mine: 2 } }));
  assert.equal(tokensOn(b.engine, b.id("mine")), 3);
});

clause(ELDRIDGE, "1:rule", "'your turn' is the controller's: an Eldridge controlled by the opponent serves them at the start of their turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: "play", controller: P2 },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine)?.playerId, P2, "P2 controls Eldridge, so P2 is offered the choice");
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  refused(() => pickRaw(b.engine, [b.id("mine")]), "P1's character is not a card P2 controls");
  pick(b.engine, [b.id("theirs")]);
});

clause(ELDRIDGE, "1:rule", "it only works while in play: an Eldridge in hand does nothing at the start of your turn", () => {
  const b = eldridgeBoard({ zone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// -- EJECT ---------------------------------------------------------------------------

const eject = (b: EldBoard, target: string) => activate(b.engine, P1, b.id("eld"), "eject", { selected: { c: [b.id(target)] } });
const ejectRaw = (b: EldBoard, targetId: CardInstanceId) => playRawAbility(b.engine, P1, b.id("eld"), "eject", { c: [targetId] });

clause(ELDRIDGE, "2:ability:eject", "removes exactly 3 tokens from Eldridge and puts the picked card into its owner's hand", () => {
  const b = eldridgeBoard({ tokens: 5, startActive: P1 });
  eject(b, "foe");
  assert.equal(tokensOn(b.engine, b.id("eld")), 2, "5 - 3 tokens");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("foe")), "the opponent's hand");
});

clause(ELDRIDGE, "2:ability:eject", "with exactly 3 tokens it uses them all up", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  eject(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("eld")), 0);
  assert.ok(handOf(b.engine, P1).includes(b.id("mine")), "handOf(b.engine, P1).includes(b.id(\"mine\"))");
});

clause(ELDRIDGE, "2:ability:eject", "is refused with only 2 tokens (nothing is picked, nothing removed)", () => {
  const b = eldridgeBoard({ tokens: 2, startActive: P1 });
  refused(() => ejectRaw(b, b.id("foe")));
  assert.equal(tokensOn(b.engine, b.id("eld")), 2);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const none = eldridgeBoard({ tokens: 0, startActive: P1 });
  refused(() => ejectRaw(none, none.id("foe")));
});

clause(ELDRIDGE, "2:ability:eject", "any non-resource card can be picked, whoever controls it: characters, items and locations of either player", () => {
  for (const [key, ownerHand] of [
    ["mine", P1],
    ["foe", P2],
    ["thing", P1],
    ["foeItem", P2],
    ["place", P1],
    ["foePlace", P2]
  ] as const) {
    const b = eldridgeBoard({ tokens: 3, startActive: P1 });
    eject(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key}`);
    assert.ok(handOf(b.engine, ownerHand).includes(b.id(key)), `${key} is in its owner's hand`);
  }
});

clause(ELDRIDGE, "2:ability:eject", "Eldridge can pick himself (he is a non-resource card)", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  eject(b, "eld");
  assert.equal(zoneOf(b.engine, b.id("eld")), "hand");
});

clause(ELDRIDGE, "2:ability:eject", "a card you control but do not own goes to its OWNER's hand", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  eject(b, "stolen");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "its owner's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), false);
});

clause(ELDRIDGE, "2:ability:eject", "the pick must be a non-resource card: face-up and face-down resources and factions are refused", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  refused(() => ejectRaw(b, b.id("res")), "a face-up resource");
  refused(() => ejectRaw(b, b.id("hidden")), "a face-down resource");
  refused(() => ejectRaw(b, b.engine.state.players[P1].factionId!), "your faction");
  refused(() => ejectRaw(b, b.engine.state.players[P2].factionId!), "the opponent's faction");
  assert.equal(tokensOn(b.engine, b.id("eld")), 3, "nothing was paid by the refused attempts");
  eject(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "control: a non-resource card works");
});

clause(ELDRIDGE, "2:ability:eject", "the pick must be in play (a card in a hand or discard pile cannot be picked)", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  refused(() => ejectRaw(b, b.id("inHand")));
  refused(() => ejectRaw(b, b.id("inDiscard")));
  assert.equal(tokensOn(b.engine, b.id("eld")), 3);
});

clause(ELDRIDGE, "2:ability:eject", "exactly one card is picked (none, or two, is refused)", () => {
  const b = eldridgeBoard({ tokens: 6, startActive: P1 });
  refused(() => playRawAbility(b.engine, P1, b.id("eld"), "eject", { c: [] }));
  refused(() => playRawAbility(b.engine, P1, b.id("eld"), "eject", {}));
  refused(() => playRawAbility(b.engine, P1, b.id("eld"), "eject", { c: [b.id("foe"), b.id("mine")] }));
  assert.equal(tokensOn(b.engine, b.id("eld")), 6);
});

clause(ELDRIDGE, "2:ability:eject", "a depleted Eldridge can still use it (the cost is tokens, not depleting)", () => {
  const b = eldridgeBoard({ tokens: 3, depleted: true, startActive: P1 });
  eject(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(ELDRIDGE, "2:ability:eject", "only Eldridge's controller can use it", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  refused(() => playRawAbility(b.engine, P2, b.id("eld"), "eject", { c: [b.id("mine")] }));
  assert.equal(tokensOn(b.engine, b.id("eld")), 3);
});

clause(ELDRIDGE, "2:ability:eject", "tokens on the ejected card disappear when it leaves play (CR 409.2)", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1, extra: [{ key: "marked", def: character({ name: "Marked" }), owner: P1, zone: "play", counters: { token: 2 } }] });
  eject(b, "marked");
  assert.equal(zoneOf(b.engine, b.id("marked")), "hand");
  assert.equal(tokensOn(b.engine, b.id("marked")), 0);
});

clause(ELDRIDGE, "2:ability:eject", "tokens placed at the start of turn pay for it: two turns of 2 tokens make an EJECT possible", () => {
  const b = eldridgeBoard();
  eldridgeTurn(b, { picks: ["eld"], n: 2, shares: { eld: 2 } });
  refused(() => ejectRaw(b, b.id("foe")), "only 2 tokens so far");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  drain(b.engine, eldridgeScript(b, { picks: ["eld"], n: 2, shares: { eld: 2 } }));
  assert.equal(tokensOn(b.engine, b.id("eld")), 4);
  eject(b, "foe");
  assert.equal(tokensOn(b.engine, b.id("eld")), 1);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

// -- DISRUPT -------------------------------------------------------------------------

const disrupt = (b: EldBoard) => activate(b.engine, P1, b.id("eld"), "disrupt");

clause(ELDRIDGE, "3:ability:disrupt", "removes exactly 3 tokens, then you pick a card in the opponent's hand and they discard it", () => {
  const b = eldridgeBoard({ tokens: 4, startActive: P1 });
  disrupt(b);
  assert.equal(tokensOn(b.engine, b.id("eld")), 1, "4 - 3 tokens");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Eldridge's controller picks");
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("oh1")), "the opponent's discard pile");
  assert.equal(handOf(b.engine, P2).length, 3, "only that card left their hand");
});

clause(ELDRIDGE, "3:ability:disrupt", "any card of the opponent's hand can be picked, of any type (a resource and a tactic included)", () => {
  for (const key of ["oh0", "oh1", "ohRes", "ohTac"]) {
    const b = eldridgeBoard({ tokens: 3, startActive: P1 });
    disrupt(b);
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key}`);
    assert.equal(handOf(b.engine, P2).length, 3);
  }
});

clause(ELDRIDGE, "3:ability:disrupt", "uses up exactly 3 tokens (3 become 0) and is refused with 2", () => {
  const short = eldridgeBoard({ tokens: 2, startActive: P1 });
  refused(() => playRawAbility(short.engine, P1, short.id("eld"), "disrupt"));
  assert.equal(tokensOn(short.engine, short.id("eld")), 2);
  assert.equal(handOf(short.engine, P2).length, 4, "no card was discarded");
  const exact = eldridgeBoard({ tokens: 3, startActive: P1 });
  disrupt(exact);
  pick(exact.engine, [exact.id("oh0")]);
  assert.equal(tokensOn(exact.engine, exact.id("eld")), 0);
});

clause(ELDRIDGE, "3:ability:disrupt", "you must pick one card: picking none is refused while the opponent has cards", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  disrupt(b);
  refused(() => pickRaw(b.engine, []));
  refused(() => pickRaw(b.engine, keyIds(b, ["oh0", "oh1"])), "two cards");
  assert.equal(handOf(b.engine, P2).length, 4);
});

clause(ELDRIDGE, "3:ability:disrupt", "the card must be in the OPPONENT's hand: your own hand, play and discard pile are refused", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1, extra: fillers("ph", 2, P1, "hand") });
  disrupt(b);
  refused(() => pickRaw(b.engine, [b.id("ph0")]), "your own hand");
  refused(() => pickRaw(b.engine, [b.id("foe")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("inDiscard")]), "a discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ph0")), "hand");
});

clause(ELDRIDGE, "3:ability:disrupt", "with the opponent's hand empty the tokens are still spent and nothing is discarded", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "ph", def: character({ name: "PH" }), owner: P1, zone: "hand" }
    ]
  });
  disrupt(b as unknown as EldBoard);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("eld")), 0, "the tokens were spent");
  assert.deepEqual(handOf(b.engine, P1), [b.id("ph")], "and your own hand was not touched");
});

clause(ELDRIDGE, "3:ability:disrupt", "a depleted Eldridge can still use it, and 6 tokens pay for it twice", () => {
  const b = eldridgeBoard({ tokens: 6, depleted: true, startActive: P1 });
  disrupt(b);
  pick(b.engine, [b.id("oh0")]);
  disrupt(b);
  pick(b.engine, [b.id("oh1")]);
  assert.equal(tokensOn(b.engine, b.id("eld")), 0);
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(ELDRIDGE, "3:ability:disrupt", "only Eldridge's controller can use it", () => {
  const b = eldridgeBoard({ tokens: 3, startActive: P1 });
  refused(() => playRawAbility(b.engine, P2, b.id("eld"), "disrupt"));
  assert.equal(tokensOn(b.engine, b.id("eld")), 3);
});

// =============================================================================
// Emphatic Ecto-Manipulator
// =============================================================================
// COST: You may pick a character you control.
// When this card enters play, if you picked a character as part of its cost then put
// 2 tokens on that character. (If you didn't pay this card's cost then you cannot put
// tokens.)
// Character (ecto-manipulator), cost 5, threshold [O][O], 3 strength / 3 speed / 3 life.

const EMPHATIC = "3d8e8296-ede6-4d43-bbe3-9f94c74d65f2";

function emphaticBoard(opts: { obsession?: number; extra?: CardPlacement[]; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "em", def: printing(EMPHATIC), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(opts.faceDown === false ? [] : [{ key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play" as const, faceDown: true }]),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type EmphBoard = ReturnType<typeof emphaticBoard>;
const emphaticPlay = (b: EmphBoard, pickKey?: string) => play(b.engine, P1, b.id("em"), { selected: pickKey ? { pick: [b.id(pickKey)] } : {} });

clause(EMPHATIC, "0:ability", "you may pick a character you control as part of the cost, and the printed cost of 5 is paid", () => {
  const b = emphaticBoard();
  const before = ready(b.engine);
  emphaticPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("em")), "play", "the character was deployed");
  assert.equal(before - ready(b.engine), 5, "the printed cost of 5 is paid");
});

clause(EMPHATIC, "0:ability", "picking is optional: it is deployed without a pick", () => {
  const b = emphaticBoard();
  emphaticPlay(b);
  assert.equal(zoneOf(b.engine, b.id("em")), "play");
});

clause(EMPHATIC, "0:ability", "only a character YOU control can be picked: an opponent's character, items, locations, factions, face-down cards and cards outside play are refused", () => {
  const b = emphaticBoard();
  const attempt = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("em"), { selected: { pick: [cardId] } });
  refused(attempt(b.id("foe")), "the opponent's character");
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.id("hidden")), "a face-down card (only a resource)");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in the discard pile");
  refused(attempt(b.id("em")), "the Ecto-Manipulator itself is not in play yet");
  assert.equal(zoneOf(b.engine, b.id("em")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "a character you control is accepted");
});

clause(EMPHATIC, "0:ability", "at most one character can be picked", () => {
  const b = emphaticBoard();
  refused(() => playRaw(b.engine, P1, b.id("em"), { selected: { pick: [b.id("mine"), b.id("mine2")] } }));
  assert.equal(zoneOf(b.engine, b.id("em")), "hand");
});

clause(EMPHATIC, "0:ability", "is refused one resource short of its cost of 5, and without [O][O] even with enough other resources", () => {
  const short = emphaticBoard({ obsession: 4, faceDown: false });
  assert.equal(ready(short.engine), 4);
  refused(() => playRaw(short.engine, P1, short.id("em"), { selected: { pick: [short.id("mine")] } }));
  assert.equal(zoneOf(short.engine, short.id("em")), "hand");
  const noThreshold = emphaticBoard({ obsession: 1, extra: bank("greed", 6, P1), faceDown: false });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("em"), {}));
  const exact = emphaticBoard({ obsession: 2, extra: bank("greed", 3, P1), faceDown: false });
  emphaticPlay(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("em")), "play");
});

clause(EMPHATIC, "1:rule", "when it enters play, 2 tokens are put on the character you picked", () => {
  const b = emphaticBoard();
  emphaticPlay(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
});

clause(EMPHATIC, "1:rule", "the tokens go on the picked character only: not on the Ecto-Manipulator, not on your other characters", () => {
  const b = emphaticBoard();
  emphaticPlay(b, "mine2");
  assert.equal(tokensOn(b.engine, b.id("mine2")), 2);
  for (const key of ["mine", "em", "thing", "place", "foe"]) assert.equal(tokensOn(b.engine, b.id(key)), 0, key);
});

clause(EMPHATIC, "1:rule", "the tokens are added to the ones the character already has (1 becomes 3)", () => {
  const b = emphaticBoard({ extra: [{ key: "marked", def: character({ name: "Marked" }), owner: P1, zone: "play", counters: { token: 1 } }] });
  emphaticPlay(b, "marked");
  assert.equal(tokensOn(b.engine, b.id("marked")), 3);
});

clause(EMPHATIC, "1:rule", "'if you picked a character': without a pick no tokens are put on anything", () => {
  const b = emphaticBoard();
  emphaticPlay(b);
  for (const key of ["mine", "mine2", "em", "thing", "place", "foe"]) assert.equal(tokensOn(b.engine, b.id(key)), 0, key);
});

clause(EMPHATIC, "1:rule", "the tokens arrive when it ENTERS play, not while it waits for responses", () => {
  const b = emphaticBoard();
  playRaw(b.engine, P1, b.id("em"), { selected: { pick: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("em")), "deploying");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0, "not yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("em")), "play");
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
});

clause(EMPHATIC, "1:rule", "'if you didn't pay this card's cost then you cannot put tokens': put into play by an effect, it puts no tokens anywhere", () => {
  const summon = tactic({
    name: "Summon",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = emphaticBoard({ extra: [{ key: "summon", def: summon, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("summon"), { selected: { t: [b.id("em")] } });
  if (pending(b.engine)) drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("em")), "play", "it was put into play without being deployed");
  for (const key of ["mine", "mine2", "em", "thing", "place", "foe"]) assert.equal(tokensOn(b.engine, b.id(key)), 0, `${key} got no tokens`);
});

clause(EMPHATIC, "1:rule", "if the picked character left play in response, no tokens can be put on it (tokens exist only on cards in play, CR 409.1)", () => {
  const b = emphaticBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("em"), { selected: { pick: [b.id("mine")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "the picked character was destroyed in response");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0, "no tokens on a card that is not in play");
  assert.equal(zoneOf(b.engine, b.id("em")), "play");
});

// =============================================================================
// Entangle
// =============================================================================
// COST: Pick 2 or fewer characters.
// EFFECT: This turn, the characters lose 1 speed. Draw a card.
// Tactic, cost 3, threshold [O][O][O].

const ENTANGLE = "51e17074-b46e-4ba5-963b-34e1585e3208";

function entangleBoard(opts: { obsession?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "en", def: printing(ENTANGLE), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "d", def: character({ name: "D", strength: 2, life: 3, speed: 0 }), owner: P2, zone: "play" },
      { key: "e", def: character({ name: "E", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("mine", 3, P1, "deck"),
      ...fillers("theirs", 3, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type EntBoard = ReturnType<typeof entangleBoard>;
const speeds = (b: EntBoard, keys: string[]) => keys.map((key) => b.engine.getStat(b.id(key), "speed"));
const entanglePlay = (b: EntBoard, keys: string[]) => play(b.engine, P1, b.id("en"), { selected: { picks: keys.map((key) => b.id(key)) } });

clause(ENTANGLE, "0:ability", "two picked characters (one of yours, one of theirs) lose 1 speed; the others do not", () => {
  const b = entangleBoard();
  entanglePlay(b, ["a", "c"]);
  assert.deepEqual(speeds(b, ["a", "c"]), [2, 2], "3 -> 2 for both");
  assert.deepEqual(speeds(b, ["b", "e"]), [2, 1], "unpicked characters keep their speed");
});

clause(ENTANGLE, "0:ability", "the loss is exactly 1 speed (not more) and strength and life are untouched", () => {
  const b = entangleBoard();
  entanglePlay(b, ["a"]);
  assert.deepEqual(statLine(b.engine, b.id("a")), [2, 3, 2]);
});

clause(ENTANGLE, "0:ability", "pays 3 and draws a card for its controller", () => {
  const b = entangleBoard();
  const before = ready(b.engine);
  const top = deckOf(b.engine, P1)[0];
  const handBefore = handOf(b.engine, P1).length;
  const theirHand = handOf(b.engine, P2).length;
  entanglePlay(b, ["a", "c"]);
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "Entangle left the hand, one card was drawn");
  assert.ok(handOf(b.engine, P1).includes(top), "the top card of the deck");
  assert.equal(handOf(b.engine, P2).length, theirHand, "the opponent draws nothing");
  assert.equal(zoneOf(b.engine, b.id("en")), "discard");
});

clause(ENTANGLE, "0:ability", "one picked character: only that one loses speed", () => {
  const b = entangleBoard();
  entanglePlay(b, ["e"]);
  assert.deepEqual(speeds(b, ["e", "c", "a"]), [0, 3, 3]);
});

clause(ENTANGLE, "0:ability", "'2 or fewer' includes none: nobody loses speed but you still draw", () => {
  const b = entangleBoard();
  const handBefore = handOf(b.engine, P1).length;
  entanglePlay(b, []);
  assert.deepEqual(speeds(b, ["a", "b", "c", "d", "e"]), [3, 2, 3, 0, 1]);
  assert.equal(handOf(b.engine, P1).length, handBefore, "one card played, one drawn");
});

clause(ENTANGLE, "0:ability", "three characters cannot be picked", () => {
  const b = entangleBoard();
  refused(() => playRaw(b.engine, P1, b.id("en"), { selected: { picks: ids2(b, ["a", "b", "c"]) } }));
  assert.equal(zoneOf(b.engine, b.id("en")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
});

clause(ENTANGLE, "0:ability", "only characters can be picked: items, locations, factions, face-down cards and cards outside play are refused", () => {
  const b = entangleBoard();
  const attempt = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("en"), { selected: { picks: [cardId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.engine.state.players[P2].factionId!), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("en")), "hand");
  attempt(b.id("a"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(ENTANGLE, "0:ability", "the same character cannot be picked twice", () => {
  const b = entangleBoard();
  refused(() => playRaw(b.engine, P1, b.id("en"), { selected: { picks: ids2(b, ["a", "a"]) } }));
});

clause(ENTANGLE, "0:ability", "the speed loss lasts this turn only: it is gone when the next turn starts", () => {
  const b = entangleBoard();
  entanglePlay(b, ["a", "c"]);
  assert.deepEqual(speeds(b, ["a", "c"]), [2, 2]);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.deepEqual(speeds(b, ["a", "c"]), [3, 3], "back to their printed speed");
});

clause(ENTANGLE, "0:ability", "speed cannot go below 0 (CR 410.4): a 0-speed character stays at 0", () => {
  const b = entangleBoard();
  entanglePlay(b, ["d"]);
  assert.equal(b.engine.getStat(b.id("d"), "speed"), 0);
});

clause(ENTANGLE, "0:ability", "is refused one resource short of its cost of 3, and without [O][O][O] even with enough other resources", () => {
  const short = entangleBoard({ obsession: 2, extra: [] });
  refused(() => playRaw(short.engine, P1, short.id("en"), { selected: { picks: [] } }), "2 resources for a cost of 3");
  const noThreshold = entangleBoard({ obsession: 2, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("en"), { selected: { picks: [] } }), "[O][O] is not [O][O][O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("en")), "hand");
  const ok = entangleBoard({ obsession: 3, extra: bank("greed", 5, P1) });
  entanglePlay(ok, ["a"]);
  assert.equal(zoneOf(ok.engine, ok.id("en")), "discard");
});

// =============================================================================
// Gnat
// =============================================================================
// If this card leaves play, your opponent must discard a card.
// Character (lurker), cost 1, threshold [O], 1 strength / 3 speed / 1 life.

const GNAT = "d65c3554-ba90-45e8-ab26-4f8d42d498b7";

/** A free tactic that moves one picked card (any zone selector given) to `to` (id `mv`, declaration `t`). */
function moverTactic(to: "hand" | "deck" | "void" | "removed" | "discard", zone: "play" | "hand" = "play"): CardDefinition {
  return tactic({
    name: `Mover-${to}-${zone}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: zone === "hand" ? { zone: "hand", owner: "self" } : { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }]
        }
      ]
    }
  });
}

function gnatBoard(opts: { controller?: Pid; oppHand?: number; ownHand?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gnat", def: printing(GNAT), owner: P1, zone: "play", controller: opts.controller },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "toDeck", def: moverTactic("deck"), owner: P1, zone: "hand" },
      { key: "toVoid", def: moverTactic("void"), owner: P1, zone: "hand" },
      { key: "toRemoved", def: moverTactic("removed"), owner: P1, zone: "hand" },
      { key: "foeGuy", def: character({ name: "FoeGuy" }), owner: P2, zone: "play" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      ...fillers("ph", opts.ownHand ?? 2, P1, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

type GnatBoard = ReturnType<typeof gnatBoard>;
const killGnat = (b: GnatBoard) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("gnat")] } });

clause(GNAT, "0:rule", "when it is destroyed the opponent must discard a card of their choice", () => {
  const b = gnatBoard();
  killGnat(b);
  assert.equal(zoneOf(b.engine, b.id("gnat")), "discard");
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent has a card to discard");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses which");
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("oh1")), "their own discard pile");
  assert.equal(handOf(b.engine, P2).length, 2, "exactly one card was discarded");
});

clause(GNAT, "0:rule", "any card of the opponent's hand can be the one discarded", () => {
  for (const key of ["oh0", "oh1", "oh2"]) {
    const b = gnatBoard();
    killGnat(b);
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
  }
});

clause(GNAT, "0:rule", "the opponent MUST discard: choosing no card is refused while they have a card in hand", () => {
  const b = gnatBoard();
  killGnat(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(b.engine, []), "declining is not allowed");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(GNAT, "0:rule", "only one card is discarded (two at once is refused)", () => {
  const b = gnatBoard();
  killGnat(b);
  refused(() => pickRaw(b.engine, ids2(b, ["oh0", "oh1"])));
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(GNAT, "0:rule", "the discarded card comes from the opponent's HAND: their cards in play and discard pile and your own hand are refused", () => {
  const b = gnatBoard();
  killGnat(b);
  refused(() => pickRaw(b.engine, [b.id("foeGuy")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("foeDiscard")]), "already in the discard pile");
  refused(() => pickRaw(b.engine, [b.id("ph0")]), "the Gnat controller's own hand");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P2].factionId!]), "their faction");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "hand", "your hand is untouched");
});

clause(GNAT, "0:rule", "with an empty hand the opponent discards nothing (no choice is asked)", () => {
  const b = gnatBoard({ oppHand: 0 });
  killGnat(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("gnat")), "discard");
});

clause(GNAT, "0:rule", "'leaves play' means any way: put into its owner's hand also makes the opponent discard", () => {
  const b = gnatBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("gnat")] } });
  assert.equal(zoneOf(b.engine, b.id("gnat")), "hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNAT, "0:rule", "'leaves play' means any way: put into its owner's deck also makes the opponent discard", () => {
  const b = gnatBoard({ extra: fillers("pd", 2, P1, "deck") });
  play(b.engine, P1, b.id("toDeck"), { selected: { t: [b.id("gnat")] } });
  assert.equal(zoneOf(b.engine, b.id("gnat")), "deck");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNAT, "0:rule", "'leaves play' means any way: sent to the void also makes the opponent discard", () => {
  const b = gnatBoard();
  play(b.engine, P1, b.id("toVoid"), { selected: { t: [b.id("gnat")] } });
  assert.equal(zoneOf(b.engine, b.id("gnat")), "void");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNAT, "0:rule", "'leaves play' means any way: removed from the game also makes the opponent discard", () => {
  const b = gnatBoard();
  play(b.engine, P1, b.id("toRemoved"), { selected: { t: [b.id("gnat")] } });
  assert.equal(zoneOf(b.engine, b.id("gnat")), "removed");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNAT, "0:rule", "destroyed in battle it triggers as well", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "gnat", def: printing(GNAT), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("gnat")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gnat")), "discard", "the Gnat died blocking");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2, "the Gnat's controller's opponent (the attacker) discards");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNAT, "0:rule", "it does not trigger when it merely enters play or while it stays in play", () => {
  const b = gnatBoard();
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const deploy = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gnat", def: printing(GNAT), owner: P1, zone: "hand" }, ...bank("obsession", 2, P1), ...fillers("oh", 2, P2, "hand")]
  });
  play(deploy.engine, P1, deploy.id("gnat"));
  assert.equal(zoneOf(deploy.engine, deploy.id("gnat")), "play");
  assert.equal(deploy.engine.state.pendingChoice, undefined, "entering play asks for no discard");
  assert.equal(handOf(deploy.engine, P2).length, 2);
});

clause(GNAT, "0:rule", "a Gnat that leaves your HAND (not play) does not make the opponent discard", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "gnat", def: printing(GNAT), owner: P1, zone: "hand" },
      { key: "toDiscard", def: moverTactic("discard", "hand"), owner: P1, zone: "hand" },
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  play(b.engine, P1, b.id("toDiscard"), { selected: { t: [b.id("gnat")] } });
  assert.equal(zoneOf(b.engine, b.id("gnat")), "discard", "the Gnat was discarded from hand");
  assert.equal(b.engine.state.pendingChoice, undefined, "it never was in play");
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(GNAT, "0:rule", "'your opponent' is the opponent of the Gnat's controller: a Gnat you took control of makes its owner discard when it leaves play, not you", () => {
  const b = gnatBoard({ controller: P2 });
  // P2 controls the (P1-owned) Gnat; P1 destroys it, so the controller's opponent is P1
  killGnat(b);
  assert.equal(zoneOf(b.engine, b.id("gnat")), "discard");
  const pc = pending(b.engine);
  assert.ok(pc, "somebody must discard");
  assert.equal(pc.playerId, P1, "the opponent of the Gnat's CONTROLLER (P2) is P1");
  pick(b.engine, [b.id("ph0")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard");
  assert.equal(handOf(b.engine, P2).length, 3, "the controller's own hand is untouched");
});

clause(GNAT, "0:rule", "each Gnat triggers by itself (two Gnats leaving play make the opponent discard twice)", () => {
  const b = gnatBoard({ extra: [{ key: "gnat2", def: printing(GNAT), owner: P1, zone: "play" }, { key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  killGnat(b);
  pick(b.engine, [b.id("oh0")]);
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("gnat2")] } });
  pick(b.engine, [b.id("oh1")]);
  assert.equal(handOf(b.engine, P2).length, 1);
});

// =============================================================================
// Infatuated Armchair
// =============================================================================
// If this card leaves play, you may look at the top 2 cards of either deck. If you
// do, put 1 card on the bottom of that deck and 1 card on the top. Draw a card.
// Character (lurker), cost 4, threshold [O], 2 strength / 3 speed / 2 life.

const ARMCHAIR = "ab4bed28-7665-4017-b829-4c95c366a61e";

function armchairBoard(opts: { ownDeck?: number; oppDeck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "chair", def: printing(ARMCHAIR), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...fillers("d", opts.ownDeck ?? 6, P1, "deck"),
      ...fillers("e", opts.oppDeck ?? 6, P2, "deck"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
}

type ChairBoard = ReturnType<typeof armchairBoard>;
const optionIndex = (b: ChairBoard, pattern: RegExp): number => {
  const options = (pending(b.engine) as unknown as { options: Array<{ label?: string }> }).options;
  const index = options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern}`);
  return index;
};

clause(ARMCHAIR, "0:rule", "when it leaves play you are offered to look at your own deck, the opponent's deck, or neither", () => {
  const b = armchairBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  assert.equal(zoneOf(b.engine, b.id("chair")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "its controller decides");
  assert.equal(pc?.optionCount, 3, "your deck / the opponent's deck / decline");
});

clause(ARMCHAIR, "0:rule", "your own deck: you see exactly the top 2 cards, put one on the bottom and one on top, then draw (the card you left on top)", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /your deck|own/i) });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual(pc?.cardIds, deck.slice(0, 2), "exactly the top 2 cards");
  answerPending(b.engine, "reorderDeck", { order: [deck[1]], bottom: [deck[0]] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [deck[1]], "the card put on top was drawn");
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(2), deck[0]], "the other card is on the bottom; the rest is untouched");
});

clause(ARMCHAIR, "0:rule", "your own deck, the other way round: the first card goes on the bottom, so the second is drawn... and vice versa", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /your deck|own/i) });
  answerPending(b.engine, "reorderDeck", { order: [deck[0]], bottom: [deck[1]] });
  assert.ok(handOf(b.engine, P1).includes(deck[0]), "the top card stayed on top and was drawn");
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(2), deck[1]]);
});

clause(ARMCHAIR, "0:rule", "the opponent's deck: you see ITS top 2 cards and arrange them; you then draw from your OWN deck", () => {
  const b = armchairBoard();
  const mine = [...deckOf(b.engine, P1)];
  const theirs = [...deckOf(b.engine, P2)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /opponent/i) });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc?.playerId, P1, "the Armchair's controller arranges the opponent's cards");
  assert.equal(pc?.deckOwnerId, P2);
  assert.deepEqual(pc?.cardIds, theirs.slice(0, 2));
  answerPending(b.engine, "reorderDeck", { order: [theirs[1]], bottom: [theirs[0]] });
  assert.deepEqual(deckOf(b.engine, P2), [theirs[1], ...theirs.slice(2), theirs[0]], "one on top, one on the bottom of the opponent's deck");
  assert.ok(handOf(b.engine, P1).includes(mine[0]), "the card drawn is the top card of YOUR deck");
  assert.deepEqual(deckOf(b.engine, P1), mine.slice(1));
  assert.equal(handOf(b.engine, P2).length, 2, "the opponent draws nothing");
});

clause(ARMCHAIR, "0:rule", "declining the look still draws a card ('Draw a card.' is not part of the 'if you do')", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  const theirs = [...deckOf(b.engine, P2)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /decline|no/i) });
  assert.equal(b.engine.state.pendingChoice, undefined, "no looking, no arranging");
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [deck[0]], "but a card is drawn");
  assert.deepEqual(deckOf(b.engine, P1), deck.slice(1));
  assert.deepEqual(deckOf(b.engine, P2), theirs, "the opponent's deck is untouched");
});

clause(ARMCHAIR, "0:rule", "exactly 1 card goes on the bottom and 1 on the top: putting both on top, or both on the bottom, is refused", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /your deck|own/i) });
  const answer = (order: string[], bottom: string[]) => () =>
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order, bottom } } as never);
  refused(answer([deck[0], deck[1]], []), "both on top");
  refused(answer([], [deck[0], deck[1]]), "both on the bottom");
  assert.equal(pending(b.engine)?.kind, "reorderDeck", "the choice is still open");
  answer([deck[1]], [deck[0]])();
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(2), deck[0]]);
});

clause(ARMCHAIR, "0:rule", "the looked-at cards must be exactly the top 2: other cards and incomplete answers are refused", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /your deck|own/i) });
  const answer = (order: string[], bottom: string[]) => () =>
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order, bottom } } as never);
  refused(answer([deck[2]], [deck[0]]), "a card that was not looked at");
  refused(answer([deck[1]], []), "one card missing");
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
});

clause(ARMCHAIR, "0:rule", "'leaves play' means any way: put into its owner's hand triggers it too", () => {
  const b = armchairBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("chair")] } });
  assert.equal(zoneOf(b.engine, b.id("chair")), "hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /decline|no/i) });
  assert.ok(handOf(b.engine, P1).includes(deck[0]), "a card was drawn");
});

clause(ARMCHAIR, "0:rule", "it does not trigger when it enters play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "chair", def: printing(ARMCHAIR), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1), ...fillers("d", 3, P1, "deck")]
  });
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("chair"));
  assert.equal(zoneOf(b.engine, b.id("chair")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "nothing was drawn");
});

clause(ARMCHAIR, "0:rule", "with an empty deck there is nothing to look at and nothing to draw", () => {
  const b = armchairBoard({ ownDeck: 0 });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("chair")] } });
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(b, /decline|no/i) });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(b.engine, P1).length, 0);
});

// =============================================================================
// Insect Appreciator
// =============================================================================
// When an attacking or blocking party is formed that includes this card, it must
// have an even number of members.
// Character (obsessor), cost 3, threshold [O][O], 3 strength / 3 speed / 3 life.

const APPRECIATOR = "43276113-4afd-4e0f-a4c6-ff41c9a51cb2";

function appreciatorBoard(opts: { side?: Pid; zone?: "play" | "hand"; copies?: number; active?: Pid } = {}) {
  const side = opts.side ?? P1;
  const zone = opts.zone ?? "play";
  const copies = Array.from({ length: opts.copies ?? 1 }, (_, i) => ({ key: i === 0 ? "app" : `app${i + 1}`, def: printing(APPRECIATOR), owner: side, zone }));
  const chars = (owner: Pid, prefix: string) =>
    ["1", "2", "3", "4"].map((n) => ({ key: `${prefix}${n}`, def: character({ name: `${prefix}${n}`, strength: 1, life: 9, speed: 2 }), owner, zone: "play" as const }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [...copies, ...chars(P1, "a"), ...chars(P2, "b")]
  });
}

const attackWith = (engine: SpoilsEngine, attackerIds: CardInstanceId[]) =>
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds, target: { type: "faction", playerId: P2 } });

clause(APPRECIATOR, "0:rule", "an attacking party that includes it must have an even number of members (1 and 3 refused; 2 and 4 allowed)", () => {
  for (const [others, legal] of [
    [0, false],
    [1, true],
    [2, false],
    [3, true]
  ] as const) {
    const b = appreciatorBoard();
    const party = [b.id("app"), ...["a1", "a2", "a3"].slice(0, others).map((key) => b.id(key))];
    if (legal) {
      attackWith(b.engine, party);
      assert.deepEqual([...(battleOf(b.engine)?.attackingParty ?? [])].sort(), [...party].sort(), `${party.length} attackers is legal`);
    } else {
      refused(() => attackWith(b.engine, party), `${party.length} attackers is refused`);
      assert.equal(battleOf(b.engine), undefined, "no battle started");
      for (const cardId of party) assert.equal(b.engine.state.cards[cardId].depleted, false, "and nobody was depleted by the refused attack");
    }
  }
});

clause(APPRECIATOR, "0:rule", "a party that does NOT include it is unaffected: 1 and 3 attackers are fine", () => {
  for (const size of [1, 2, 3]) {
    const b = appreciatorBoard();
    const party = ["a1", "a2", "a3"].slice(0, size).map((key) => b.id(key));
    attackWith(b.engine, party);
    assert.deepEqual([...(battleOf(b.engine)?.attackingParty ?? [])].sort(), [...party].sort(), `${size} attackers without the Appreciator`);
  }
});

clause(APPRECIATOR, "0:rule", "a blocking party that includes it must have an even number of members (1 and 3 refused; 2 allowed)", () => {
  for (const [others, legal] of [
    [0, false],
    [1, true],
    [2, false]
  ] as const) {
    const b = appreciatorBoard({ side: P2 });
    attackWith(b.engine, [b.id("a1")]);
    resolvePendingResponses(b.engine);
    const party = [b.id("app"), ...["b1", "b2"].slice(0, others).map((key) => b.id(key))];
    if (legal) {
      b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: party });
      assert.deepEqual([...(battleOf(b.engine)?.blockingParty ?? [])].sort(), [...party].sort(), `${party.length} blockers is legal`);
    } else {
      refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: party }), `${party.length} blockers is refused`);
    }
  }
});

clause(APPRECIATOR, "0:rule", "a blocking party without it is unaffected (1 and 3 blockers are fine), and declaring no blockers is fine", () => {
  for (const size of [0, 1, 3]) {
    const b = appreciatorBoard({ side: P2 });
    attackWith(b.engine, [b.id("a1")]);
    resolvePendingResponses(b.engine);
    const party = ["b1", "b2", "b3"].slice(0, size).map((key) => b.id(key));
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: party });
    assert.deepEqual([...(battleOf(b.engine)?.blockingParty ?? [])].sort(), [...party].sort(), `${size} blockers`);
  }
});

clause(APPRECIATOR, "0:rule", "it constrains the parties it is in on its OWN side only: the opponent's odd attack is fine while your Appreciator stays home", () => {
  const b = appreciatorBoard({ side: P1, active: P2 });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("b1")], target: { type: "faction", playerId: P1 } });
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("b1")]);
});

clause(APPRECIATOR, "0:rule", "two Appreciators in one party: 2 is even and allowed; 3 is refused", () => {
  const ok = appreciatorBoard({ copies: 2 });
  attackWith(ok.engine, [ok.id("app"), ok.id("app2")]);
  assert.equal(battleOf(ok.engine)?.attackingParty.length, 2);
  const bad = appreciatorBoard({ copies: 2 });
  refused(() => attackWith(bad.engine, [bad.id("app"), bad.id("app2"), bad.id("a1")]));
});

clause(APPRECIATOR, "0:rule", "an Appreciator in hand constrains nothing", () => {
  const b = appreciatorBoard({ zone: "hand" });
  attackWith(b.engine, [b.id("a1")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")]);
});

clause(APPRECIATOR, "0:rule", "once the Appreciator is gone its party restriction is gone too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "app", def: printing(APPRECIATOR), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "a1" }), owner: P1, zone: "play" },
      { key: "smite", def: smiteTactic(), owner: P1, zone: "hand" }
    ]
  });
  refused(() => attackWith(b.engine, [b.id("app")]), "control: while it is in play, the Appreciator alone (1 member) is refused");
  play(b.engine, P1, b.id("smite"), { selected: { t: [b.id("app")] } });
  assert.equal(zoneOf(b.engine, b.id("app")), "discard");
  attackWith(b.engine, [b.id("a1")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")], "a single attacker is fine again");
});

// =============================================================================
// Kinky Asp
// =============================================================================
// COVERT. Character (lurker), cost 5, threshold [O][O], 4 strength / 3 speed / 2 life.

const ASP = "4e6447f0-b5af-4395-8054-ef4b0f9d2a55";

clause(ASP, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(ASP));
clause(ASP, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(ASP));
clause(ASP, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(ASP));
clause(ASP, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(ASP));

// =============================================================================
// Puddle of Goo
// =============================================================================
// COVERT. Character (lurker), cost 1, threshold [O], 1 strength / 3 speed / 1 life.

const GOO = "40728412-251d-4646-a3c2-ec22f43c3101";

clause(GOO, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(GOO));
clause(GOO, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(GOO));
clause(GOO, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(GOO));
clause(GOO, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(GOO));

// =============================================================================
// Maladjustment
// =============================================================================
// COST: Pick a resource you control. (You can pick face-down resources.)
// EFFECT: Put the resource into your hand. You may play a resource.
// Tactic, cost 1, threshold [O].

const MALADJUSTMENT = "556c61ec-857e-4773-80fb-b180513696f4";

/** A face-up staple Obsession resource card. */
const obsessionCard = (key: string, owner: Pid, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: resourceCard({ name: `Obsession ${key}`, trade: "universal", resource: { provides: ["obsession"], staple: true } }),
  owner,
  zone: "play",
  ...extra
});

function maladBoard(opts: { resources?: number; faceDown?: boolean; extra?: CardPlacement[]; spentFirst?: boolean } = {}) {
  const count = opts.resources ?? 3;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mal", def: printing(MALADJUSTMENT), owner: P1, zone: "hand" },
      ...Array.from({ length: count }, (_, i) => obsessionCard(`r${i + 1}`, P1, i === 0 && opts.spentFirst ? { attachedToKey: "__factionA" } : {})),
      ...(opts.faceDown === false ? [] : [{ key: "fd", def: character({ name: "FaceDownGuy" }), owner: P1, zone: "play" as const, faceDown: true }]),
      obsessionCard("foeRes", P2),
      { key: "foeFd", def: character({ name: "FoeFaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      { key: "hc2", def: character({ name: "HandCard2" }), owner: P1, zone: "hand" },
      { key: "handRes", def: resourceCard({ name: "HandRage" }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "TheirHandCard" }), owner: P2, zone: "hand" },
      { key: "inDiscardRes", def: resourceCard({ name: "DiscardedRage" }), owner: P1, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type MalBoard = ReturnType<typeof maladBoard>;
const maladPlay = (b: MalBoard, resourceKey: string) => play(b.engine, P1, b.id("mal"), { selected: { res: [b.id(resourceKey)] } });

clause(MALADJUSTMENT, "0:ability", "pays 1 and puts the picked face-up resource into your hand, then offers to play a resource", () => {
  const b = maladBoard({ faceDown: false });
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("mal"), { selected: { res: [b.id("r1")] } });
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1 is paid while the tactic waits for responses");
  assert.equal(zoneOf(b.engine, b.id("r1")), "play", "the resource moves only when the tactic resolves");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "EFFECT: put the resource into your hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "'You may play a resource'");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(MALADJUSTMENT, "0:ability", "'you may play a resource': declining leaves the resource in your hand", () => {
  const b = maladBoard();
  maladPlay(b, "r1");
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("r1")), "handOf(b.engine, P1).includes(b.id(\"r1\"))");
  assert.equal(zoneOf(b.engine, b.id("mal")), "discard", "the tactic ends in the discard pile");
});

clause(MALADJUSTMENT, "0:ability", "you may play the same resource again, face-up: it comes back into play", () => {
  const b = maladBoard({ faceDown: false });
  maladPlay(b, "r1");
  pick(b.engine, [b.id("r1")]);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
  assert.equal(b.engine.state.cards[b.id("r1")].faceDown, false, "an actual resource card is played face-up");
});

clause(MALADJUSTMENT, "0:ability", "you may play any other card from your hand as a resource: a non-resource card goes in face-down (providing Volition)", () => {
  const b = maladBoard({ faceDown: false });
  const volitionBefore = b.engine.getThresholds(P1).volition ?? 0;
  maladPlay(b, "r1");
  pick(b.engine, [b.id("hc")]);
  assert.equal(zoneOf(b.engine, b.id("hc")), "play");
  assert.equal(b.engine.state.cards[b.id("hc")].faceDown, true);
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, volitionBefore + 1, "it provides Volition");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "the bounced resource stays in hand");
});

clause(MALADJUSTMENT, "0:ability", "you can pick a FACE-DOWN resource: it goes to your hand (face-up) and can be played again", () => {
  const b = maladBoard();
  maladPlay(b, "fd");
  assert.equal(zoneOf(b.engine, b.id("fd")), "hand");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false, "in your hand it is just a card");
  pick(b.engine, [b.id("fd")]);
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true, "a non-resource card can only be played face-down");
});

clause(MALADJUSTMENT, "0:ability", "only ONE resource is played (two at once is refused)", () => {
  const b = maladBoard();
  maladPlay(b, "r1");
  refused(() => pickRaw(b.engine, ids2(b, ["hc", "hc2"])));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("hc")]);
  assert.equal(zoneOf(b.engine, b.id("hc2")), "hand");
});

clause(MALADJUSTMENT, "0:ability", "the resource played must come from YOUR hand: the opponent's hand, cards in play and your discard pile are refused", () => {
  const b = maladBoard();
  maladPlay(b, "r1");
  refused(() => pickRaw(b.engine, [b.id("oh")]), "the opponent's hand");
  refused(() => pickRaw(b.engine, [b.id("mine")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("inDiscardRes")]), "a card in the discard pile");
  pick(b.engine, [b.id("handRes")]);
  assert.equal(zoneOf(b.engine, b.id("handRes")), "play", "control: an actual resource from your hand is accepted");
});

clause(MALADJUSTMENT, "0:ability", "the replayed resource is a fresh, ready resource: a spent (attached) resource comes back ready", () => {
  const b = maladBoard({ faceDown: false, resources: 3, spentFirst: true });
  assert.equal(ready(b.engine), 2, "r1 is spent, r2 and r3 are ready");
  assert.ok(b.engine.state.cards[b.id("r1")].attachedTo, "r1 is attached to the faction");
  maladPlay(b, "r1");
  pick(b.engine, [b.id("r1")]);
  assert.equal(b.engine.state.cards[b.id("r1")].attachedTo, undefined, "it is no longer attached");
  assert.equal(ready(b.engine), 2, "1 paid for the tactic, 1 spent resource became ready again");
});

clause(MALADJUSTMENT, "0:ability", "without replaying it the bounced resource is simply gone from the board (one fewer resource)", () => {
  const b = maladBoard({ faceDown: false, resources: 3 });
  assert.equal(ready(b.engine), 3);
  maladPlay(b, "r2");
  pick(b.engine, []);
  assert.equal(ready(b.engine), 3 - 1 - 1, "1 paid, 1 returned to hand");
});

clause(MALADJUSTMENT, "0:ability", "a resource you control but do not own goes into YOUR hand ('your hand')", () => {
  const b = maladBoard({ extra: [obsessionCard("stolenRes", P2, { controller: P1 })] });
  assert.equal(b.engine.state.cards[b.id("stolenRes")].controllerId, P1);
  maladPlay(b, "stolenRes");
  assert.equal(zoneOf(b.engine, b.id("stolenRes")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("stolenRes")), "in the Maladjustment player's hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("stolenRes")), false);
  pick(b.engine, []);
});

clause(MALADJUSTMENT, "0:ability", "the pick must be a resource YOU control: the opponent's resources (face-up and face-down), characters, items and factions are refused", () => {
  const b = maladBoard();
  const attempt = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("mal"), { selected: { res: [cardId] } });
  refused(attempt(b.id("foeRes")), "the opponent's resource");
  refused(attempt(b.id("foeFd")), "the opponent's face-down resource");
  refused(attempt(b.id("mine")), "a character");
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.id("handRes")), "a resource card in your hand");
  refused(attempt(b.id("inDiscardRes")), "a resource card in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("mal")), "hand", "nothing was played");
  attempt(b.id("r1"))();
  assert.ok(b.engine.state.responseWindow, "your own resource is accepted");
});

clause(MALADJUSTMENT, "0:ability", "exactly one resource is picked (none, or two, is refused)", () => {
  const b = maladBoard();
  refused(() => playRaw(b.engine, P1, b.id("mal"), { selected: { res: [] } }));
  refused(() => playRaw(b.engine, P1, b.id("mal"), {}));
  refused(() => playRaw(b.engine, P1, b.id("mal"), { selected: { res: ids2(b, ["r1", "r2"]) } }));
  assert.equal(zoneOf(b.engine, b.id("mal")), "hand");
});

clause(MALADJUSTMENT, "0:ability", "playing the extra resource does not use up the Develop Rule", () => {
  const b = maladBoard();
  assert.ok(developOffers(b.engine, P1).length > 0, "the Develop Rule offers something");
  maladPlay(b, "r1");
  pick(b.engine, [b.id("hc")]);
  assert.ok(developOffers(b.engine, P1).length > 0, "the Develop Rule is still available");
  developPlay(b.engine, P1, b.id("hc2"), true);
  assert.equal(zoneOf(b.engine, b.id("hc2")), "play");
});

clause(MALADJUSTMENT, "0:ability", "'You may play a resource': an actual resource card can be played face-down (CR 203.2) - the player gets to choose", () => holdResourceFace(() => {
  const b = maladBoard();
  maladPlay(b, "r1");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("handRes")] } } as never);
  resolvePendingResponses(b.engine);
  const asked = b.engine.state.pendingChoice !== undefined && zoneOf(b.engine, b.id("handRes")) === "hand";
  const faceDown = zoneOf(b.engine, b.id("handRes")) === "play" && b.engine.state.cards[b.id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(MALADJUSTMENT, "0:ability", "is refused without [O] even with plenty of other resources, and with no ready resource to pay 1", () => {
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mal", def: printing(MALADJUSTMENT), owner: P1, zone: "hand" },
      { key: "g1", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("mal"), { selected: { res: [noThreshold.id("g1")] } }));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mal")), "hand");
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mal", def: printing(MALADJUSTMENT), owner: P1, zone: "hand" },
      obsessionCard("r1", P1, { attachedToKey: "__factionA" })
    ]
  });
  assert.equal(ready(spent.engine), 0);
  refused(() => playRaw(spent.engine, P1, spent.id("mal"), { selected: { res: [spent.id("r1")] } }), "[O] is met but nothing is left to pay 1");
  const ok = maladBoard({ faceDown: false, resources: 1 });
  maladPlay(ok, "r1");
  pick(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("r1")), "hand", "with a single [O] resource it can be paid and played");
});

// =============================================================================
// Obsessive Compulsion
// =============================================================================
// Look at the top 3 cards of your deck. You may put any number of those cards on the
// bottom of your deck in any order. Put the remaining cards on the top of your deck
// in any order. Draw a card.
// Tactic, cost 1, threshold [O].

const COMPULSION = "2d436db8-8973-4f0b-b830-a343ab068908";

function compulsionBoard(opts: { deck?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "oc", def: printing(COMPULSION), owner: P1, zone: "hand" },
      { key: "ph", def: character({ name: "PH" }), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...bank("obsession", opts.obsession ?? 1, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type OcBoard = ReturnType<typeof compulsionBoard>;
/** Plays it and answers the look: `top` stay on top in that order, `bottom` go to the bottom in that order (all deck positions, d0 = top). */
function compulse(b: OcBoard, top: string[], bottom: string[]): void {
  play(b.engine, P1, b.id("oc"));
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
  answerPending(b.engine, "reorderDeck", { order: keyIds(b, top), bottom: keyIds(b, bottom) });
}

clause(COMPULSION, "0:rule", "you look at exactly the top 3 cards of your deck (your decision, in order)", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("oc"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual(pc?.cardIds, deck.slice(0, 3), "the top 3 cards, top first");
});

clause(COMPULSION, "0:rule", "none on the bottom: the 3 cards stay on top in the order you choose, and you draw the first of them", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  compulse(b, ["d2", "d0", "d1"], []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [b.id("d2")], "the card now on top was drawn");
  assert.deepEqual(deckOf(b.engine, P1), [b.id("d0"), b.id("d1"), ...deck.slice(3)], "the rest of the top 3 in your order, then the untouched deck");
});

clause(COMPULSION, "0:rule", "one card on the bottom: it goes under the deck, the other two stay on top, and you draw the top one", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  compulse(b, ["d2", "d1"], ["d0"]);
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [b.id("d2")]);
  assert.deepEqual(deckOf(b.engine, P1), [b.id("d1"), ...deck.slice(3), b.id("d0")]);
});

clause(COMPULSION, "0:rule", "two cards on the bottom (in the order you choose), one on top, then you draw the top card", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  compulse(b, ["d1"], ["d2", "d0"]);
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [b.id("d1")]);
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(3), b.id("d2"), b.id("d0")]);
});

clause(COMPULSION, "0:rule", "the bottom cards go 'in any order': the opposite order is possible", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  compulse(b, ["d1"], ["d0", "d2"]);
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(3), b.id("d0"), b.id("d2")]);
});

clause(COMPULSION, "0:rule", "all three on the bottom: the 4th card of the deck becomes the top card and is drawn", () => {
  const b = compulsionBoard();
  const deck = [...deckOf(b.engine, P1)];
  compulse(b, [], ["d1", "d0", "d2"]);
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [b.id("d3")], "'draw a card' comes last, so it takes the new top card");
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(4), b.id("d1"), b.id("d0"), b.id("d2")]);
});

clause(COMPULSION, "0:rule", "the draw takes one card for the controller only; the opponent's deck and hand are untouched", () => {
  const b = compulsionBoard();
  const theirDeck = [...deckOf(b.engine, P2)];
  const theirHand = [...handOf(b.engine, P2)];
  const handBefore = handOf(b.engine, P1).length;
  compulse(b, ["d0", "d1", "d2"], []);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "Compulsion left the hand, one card was drawn");
  assert.deepEqual(deckOf(b.engine, P2), theirDeck);
  assert.deepEqual(handOf(b.engine, P2), theirHand);
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
});

clause(COMPULSION, "0:rule", "the answer must account for exactly the 3 looked-at cards: foreign, missing and duplicated cards are refused", () => {
  const b = compulsionBoard();
  play(b.engine, P1, b.id("oc"));
  const answer = (top: string[], bottom: string[]) => () =>
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: keyIds(b, top), bottom: keyIds(b, bottom) } } as never);
  refused(answer(["d0", "d1", "d3"], []), "a card that was not looked at");
  refused(answer(["d0", "d1"], []), "a card missing");
  refused(answer(["d0", "d0", "d1"], []), "a duplicate");
  refused(answer(["d0", "d1"], ["d1", "d2"]), "a card on both piles");
  assert.equal(pending(b.engine)?.kind, "reorderDeck", "the choice is still open");
  answer(["d0", "d1", "d2"], [])();
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(COMPULSION, "0:rule", "a deck of only 2 cards: you look at those 2 and draw one of them", () => {
  const b = compulsionBoard({ deck: 2 });
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("oc"));
  assert.deepEqual(pending(b.engine)?.cardIds, deck, "only 2 cards to look at");
  answerPending(b.engine, "reorderDeck", { order: [deck[1], deck[0]], bottom: [] });
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [deck[1]]);
  assert.deepEqual(deckOf(b.engine, P1), [deck[0]]);
});

clause(COMPULSION, "0:rule", "an empty deck: nothing to look at or draw, and the tactic still resolves", () => {
  const b = compulsionBoard({ deck: 0 });
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("oc"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1);
});

clause(COMPULSION, "0:rule", "pays 1 and needs [O]: refused without Obsession even with other resources, accepted with exactly 1 Obsession", () => {
  const noThreshold = compulsionBoard({ obsession: 0, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("oc")));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("oc")), "hand");
  const ok = compulsionBoard({ obsession: 1 });
  const before = ready(ok.engine);
  compulse(ok, ["d0", "d1", "d2"], []);
  assert.equal(before - ready(ok.engine), 1, "the printed cost of 1 is paid");
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "oc", def: printing(COMPULSION), owner: P1, zone: "hand" }, ...fillers("d", 3, P1, "deck"), ...bank("obsession", 1, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }))]
  });
  refused(() => playRaw(spent.engine, P1, spent.id("oc")), "[O] is met but nothing is left to pay 1");
});

// =============================================================================
// Odious Diva
// =============================================================================
// Your opponent's hand is revealed at all times.
// DISAPPROVE -- COST: Pay 2. Name a card.
// EFFECT: Look at your opponent's hand. Your opponent must put a card with the chosen
// name on the bottom of their deck. If they do, they draw a card.
// Character (diva), cost 2, threshold [O][O], 1 strength / 3 speed / 2 life.

const DIVA = "b7c7b011-86ef-46db-8b26-c659ad1f24c1";

function divaBoard(opts: { greed?: number; controller?: Pid; zone?: "play" | "hand"; copies?: number; theirHand?: Array<{ key: string; name: string }> } = {}) {
  const zone = opts.zone ?? "play";
  const theirHand = opts.theirHand ?? [
    { key: "nem1", name: "Nemesis" },
    { key: "nem2", name: "Nemesis" },
    { key: "other", name: "Bystander" }
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "diva", def: printing(DIVA), owner: P1, zone, controller: zone === "play" ? opts.controller : undefined },
      ...(opts.copies && opts.copies > 1 ? [{ key: "diva2", def: printing(DIVA), owner: P1, zone }] : []),
      ...theirHand.map((card) => ({ key: card.key, def: character({ name: card.name }), owner: P2, zone: "hand" as const })),
      ...fillers("p1h", 2, P1, "hand"),
      { key: "nemInPlay", def: character({ name: "Nemesis" }), owner: P2, zone: "play" },
      { key: "nemInDiscard", def: character({ name: "Nemesis" }), owner: P2, zone: "discard" },
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", opts.greed ?? 4, P1)
    ]
  });
}

type DivaBoard = ReturnType<typeof divaBoard>;
const revealedHands = (engine: SpoilsEngine) => engine.getFlowView().revealed.hands;

/**
 * Uses DISAPPROVE. "Name a card" is part of the COST, so the Diva's controller names it while using the ability:
 * with `name` the card is named, and the opponent's response window is drained (the opponent's pick, if any, is
 * then open); without it the naming prompt is left open.
 */
function disapprove(b: DivaBoard, name?: string): void {
  playRawAbility(b.engine, P1, b.id("diva"), "disapprove");
  if (name === undefined) return;
  answerPending(b.engine, "nameValue", { value: name });
  resolvePendingResponses(b.engine);
}

clause(DIVA, "0:rule", "while it is in play the opponent's hand is revealed (and your own is not)", () => {
  const b = divaBoard();
  assert.deepEqual(revealedHands(b.engine), [P2]);
});

clause(DIVA, "0:rule", "no hand is revealed when there is no Odious Diva in play", () => {
  const inHand = divaBoard({ zone: "hand" });
  assert.deepEqual(revealedHands(inHand.engine), [], "a Diva in hand reveals nothing");
  const none = buildGame({ playerA: { faction: developFaction() }, cards: fillers("h", 2, P2, "hand") });
  assert.deepEqual(revealedHands(none.engine), []);
});

clause(DIVA, "0:rule", "a Diva controlled by the opponent reveals the Diva's owner's hand (your opponent's hand is the other player's)", () => {
  const b = divaBoard({ controller: P2 });
  assert.deepEqual(revealedHands(b.engine), [P1], "P2 controls the Diva, so P1's hand is revealed");
});

clause(DIVA, "0:rule", "the hand stops being revealed once the Diva leaves play", () => {
  const gone = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "diva", def: printing(DIVA), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  assert.deepEqual(revealedHands(gone.engine), [P2]);
  play(gone.engine, P1, gone.id("kill"), { selected: { t: [gone.id("diva")] } });
  assert.equal(zoneOf(gone.engine, gone.id("diva")), "discard");
  assert.deepEqual(revealedHands(gone.engine), []);
});

clause(DIVA, "0:rule", "two Divas still reveal the hand (it is simply revealed)", () => {
  const b = divaBoard({ copies: 2 });
  assert.deepEqual(revealedHands(b.engine), [P2]);
});

clause(DIVA, "1:ability:disapprove", "pays 2, then the opponent puts a card with the named name on the bottom of their deck and draws a card", () => {
  const b = divaBoard();
  const deck = [...deckOf(b.engine, P2)];
  const before = ready(b.engine);
  playRawAbility(b.engine, P1, b.id("diva"), "disapprove");
  assert.equal(pending(b.engine)?.kind, "nameValue", "'Name a card' is part of the cost: it is asked as the ability is used");
  assert.equal(pending(b.engine)?.playerId, P1, "the Diva's controller names the card");
  assert.equal(before - ready(b.engine), 0, "nothing is paid until the cost is complete");
  answerPending(b.engine, "nameValue", { value: "Nemesis" });
  assert.equal(before - ready(b.engine), 2, "COST: Pay 2");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent puts the card on the bottom");
  pick(b.engine, [b.id("nem1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("nem1")), "deck", "the Nemesis is in the deck now");
  assert.equal(deckOf(b.engine, P2)[deckOf(b.engine, P2).length - 1], b.id("nem1"), "on the BOTTOM");
  assert.ok(handOf(b.engine, P2).includes(deck[0]), "then they drew the top card of the deck");
});

clause(DIVA, "1:ability:disapprove", "'If they do, they draw a card': the hand size stays the same (one card out, one drawn)", () => {
  const b = divaBoard();
  const handBefore = handOf(b.engine, P2).length;
  disapprove(b, "Bystander");
  pick(b.engine, [b.id("other")]);
  assert.equal(handOf(b.engine, P2).length, handBefore);
  assert.equal(handOf(b.engine, P2).includes(b.id("other")), false);
});

clause(DIVA, "1:ability:disapprove", "only ONE card with the name is put on the bottom even if the opponent has two (the other stays in hand), and only one card is drawn", () => {
  const b = divaBoard();
  const deckBefore = deckOf(b.engine, P2).length;
  disapprove(b, "Nemesis");
  pick(b.engine, [b.id("nem2")]);
  assert.ok(handOf(b.engine, P2).includes(b.id("nem1")), "the second Nemesis is still in hand");
  assert.equal(handOf(b.engine, P2).length, 3, "one out, one drawn");
  assert.equal(deckOf(b.engine, P2).length, deckBefore, "one card on the bottom, one drawn from the top");
});

clause(DIVA, "1:ability:disapprove", "the opponent MUST put a matching card on the bottom: choosing none is refused while they hold one", () => {
  const b = divaBoard();
  disapprove(b, "Nemesis");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(b.engine, []), "declining is not allowed");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(DIVA, "1:ability:disapprove", "the card must carry the NAMED name: a card with another name is refused", () => {
  const b = divaBoard();
  disapprove(b, "Nemesis");
  refused(() => pickRaw(b.engine, [b.id("other")]), "Bystander is not a Nemesis");
  assert.equal(zoneOf(b.engine, b.id("other")), "hand");
  pick(b.engine, [b.id("nem1")]);
  assert.ok(deckOf(b.engine, P2).includes(b.id("nem1")), "deckOf(b.engine, P2).includes(b.id(\"nem1\"))");
});

clause(DIVA, "1:ability:disapprove", "only a card in the opponent's HAND counts: a Nemesis in play or in their discard pile is refused", () => {
  const b = divaBoard();
  disapprove(b, "Nemesis");
  refused(() => pickRaw(b.engine, [b.id("nemInPlay")]), "in play");
  refused(() => pickRaw(b.engine, [b.id("nemInDiscard")]), "in the discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(DIVA, "1:ability:disapprove", "naming a card the opponent does not hold in hand does nothing: nothing goes to the bottom and they do NOT draw", () => {
  const b = divaBoard();
  const hand = [...handOf(b.engine, P2)];
  const deck = [...deckOf(b.engine, P2)];
  disapprove(b, "Not In Their Hand");
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice for the opponent");
  assert.deepEqual(handOf(b.engine, P2), hand);
  assert.deepEqual(deckOf(b.engine, P2), deck, "'if they do' - they did not put a card, so they do not draw");
});

clause(DIVA, "1:ability:disapprove", "a near-miss name does not match (the name must be the chosen name)", () => {
  const b = divaBoard();
  disapprove(b, "Nemesi");
  assert.equal(b.engine.state.pendingChoice, undefined, "no card is called Nemesi");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(DIVA, "1:ability:disapprove", "the Diva's controller's own hand is never affected, even for a card of the same name", () => {
  const b = divaBoard({ theirHand: [{ key: "nem1", name: "Nemesis" }] });
  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "diva", def: printing(DIVA), owner: P1, zone: "play" },
      { key: "myNem", def: character({ name: "Nemesis" }), owner: P1, zone: "hand" },
      { key: "nem1", def: character({ name: "Nemesis" }), owner: P2, zone: "hand" },
      ...fillers("e", 2, P2, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  disapprove(mine as unknown as DivaBoard, "Nemesis");
  pick(mine.engine, [mine.id("nem1")]);
  assert.equal(zoneOf(mine.engine, mine.id("myNem")), "hand", "your own Nemesis stays in hand");
  assert.equal(b.engine.state.players[P2].hand.length, 1);
});

clause(DIVA, "1:ability:disapprove", "with an empty opponent hand it does nothing (the 2 are still paid)", () => {
  const b = divaBoard({ theirHand: [] });
  const before = ready(b.engine);
  disapprove(b, "Nemesis");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 2);
});

clause(DIVA, "1:ability:disapprove", "is refused one resource short of the 2 it costs, and accepted with exactly 2", () => {
  const short = divaBoard({ greed: 1 });
  refused(() => playRawAbility(short.engine, P1, short.id("diva"), "disapprove"));
  assert.equal(ready(short.engine), 1, "nothing was paid");
  const exact = divaBoard({ greed: 2 });
  disapprove(exact, "Nemesis");
  assert.equal(ready(exact.engine), 0);
});

clause(DIVA, "1:ability:disapprove", "it is not depleted by use: it can be used again the same turn", () => {
  const b = divaBoard({ greed: 4 });
  disapprove(b, "Nemesis");
  pick(b.engine, [b.id("nem1")]);
  assert.equal(b.engine.state.cards[b.id("diva")].depleted, false);
  disapprove(b, "Nemesis");
  pick(b.engine, [b.id("nem2")]);
  assert.ok(deckOf(b.engine, P2).includes(b.id("nem1")) && deckOf(b.engine, P2).includes(b.id("nem2")), "deckOf(b.engine, P2).includes(b.id(\"nem1\")) && deckOf(b.engine, P2).includes(b.id(\"nem2\"))");
});

clause(DIVA, "1:ability:disapprove", "only the Diva's controller can use it", () => {
  const b = divaBoard();
  refused(() => playRawAbility(b.engine, P2, b.id("diva"), "disapprove"));
  assert.equal(ready(b.engine), 4);
});

clause(DIVA, "1:ability:disapprove", "'Name a card' is a COST: the card is named when the ability is used, before the opponent can respond", () => {
  const b = divaBoard();
  playRawAbility(b.engine, P1, b.id("diva"), "disapprove");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "nameValue", "the Diva's controller is asked to name a card as part of paying costs");
  assert.equal(pc?.playerId, P1);
  assert.equal(b.engine.state.responseWindow, undefined, "the opponent's response window has not opened yet (costs are paid before the opponent may respond)");
});

// =============================================================================
// Quotidian Disappearance
// =============================================================================
// Your opponent must pick a non-resource card they control. If they do, put that card
// into its owner's hand.
// Tactic, cost 0, threshold [O].

const DISAPPEARANCE = "7c522a1a-aa18-4afa-955e-2a047ff91ecb";

function disappearanceBoard(opts: { foes?: boolean; obsession?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "qd", def: printing(DISAPPEARANCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mineItem", def: item({ name: "MineItem" }), owner: P1, zone: "play" },
      ...(opts.foes === false
        ? []
        : [
            { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" as const },
            { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" as const },
            { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" as const },
            { key: "stolenByThem", def: character({ name: "StolenByThem" }), owner: P1, zone: "play" as const, controller: P2 }
          ]),
      { key: "foeRes", def: resourceCard({ name: "FoeRage" }), owner: P2, zone: "play" },
      { key: "foeFd", def: character({ name: "FoeFaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "stolenByMe", def: character({ name: "StolenByMe" }), owner: P2, zone: "play", controller: P1 },
      { key: "oh", def: character({ name: "TheirHand" }), owner: P2, zone: "hand" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 1, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type DisBoard = ReturnType<typeof disappearanceBoard>;
const castDisappearance = (b: DisBoard) => {
  play(b.engine, P1, b.id("qd"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
};

clause(DISAPPEARANCE, "0:rule", "your opponent (not you) picks a non-resource card they control, and it goes into its owner's hand", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  assert.equal(pending(b.engine)?.playerId, P2, "the opponent chooses");
  pick(b.engine, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("foe")), "handOf(b.engine, P2).includes(b.id(\"foe\"))");
  assert.equal(zoneOf(b.engine, b.id("qd")), "discard", "the tactic ends in its owner's discard pile");
});

clause(DISAPPEARANCE, "0:rule", "every kind of non-resource card they control can be the pick: a character, an item and a location", () => {
  for (const key of ["foe", "foeItem", "foePlace"]) {
    const b = disappearanceBoard();
    castDisappearance(b);
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
    assert.ok(handOf(b.engine, P2).includes(b.id(key)), `${key} is in its owner's hand`);
  }
});

clause(DISAPPEARANCE, "0:rule", "your opponent MUST pick: choosing nothing is refused while they control a non-resource card", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  refused(() => pickRaw(b.engine, []), "declining is not allowed");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(DISAPPEARANCE, "0:rule", "exactly one card is picked (two at once is refused)", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  refused(() => pickRaw(b.engine, ids2(b, ["foe", "foeItem"])));
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "play");
});

clause(DISAPPEARANCE, "0:rule", "only a card THEY control: your own cards and cards you took from them are refused", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  refused(() => pickRaw(b.engine, [b.id("mine")]), "the caster's character");
  refused(() => pickRaw(b.engine, [b.id("mineItem")]), "the caster's item");
  refused(() => pickRaw(b.engine, [b.id("stolenByMe")]), "a card the caster controls (owned by the opponent)");
  pick(b.engine, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(DISAPPEARANCE, "0:rule", "the pick must be a NON-RESOURCE card: resources (face-up and face-down), the faction and cards outside play are refused", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  refused(() => pickRaw(b.engine, [b.id("foeRes")]), "a face-up resource");
  refused(() => pickRaw(b.engine, [b.id("foeFd")]), "a face-down resource");
  refused(() => pickRaw(b.engine, [b.engine.state.players[P2].factionId!]), "their faction");
  refused(() => pickRaw(b.engine, [b.id("oh")]), "a card in their hand");
  refused(() => pickRaw(b.engine, [b.id("foeDiscard")]), "a card in their discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(b.engine, [b.id("foeItem")]);
});

clause(DISAPPEARANCE, "0:rule", "a card they control but do not own goes to its OWNER's hand (your hand here)", () => {
  const b = disappearanceBoard();
  castDisappearance(b);
  pick(b.engine, [b.id("stolenByThem")]);
  assert.equal(zoneOf(b.engine, b.id("stolenByThem")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("stolenByThem")), "its owner's hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("stolenByThem")), false);
});

clause(DISAPPEARANCE, "0:rule", "with no non-resource card on their side nothing is asked and nothing happens (the tactic still resolves)", () => {
  const b = disappearanceBoard({ foes: false });
  play(b.engine, P1, b.id("qd"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("qd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeRes")), "play", "their resources stay");
});

clause(DISAPPEARANCE, "0:rule", "costs nothing (cost 0) but needs [O]: playable with no ready resource, refused without Obsession", () => {
  const spent = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qd", def: printing(DISAPPEARANCE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", 1, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }))
    ]
  });
  assert.equal(ready(spent.engine), 0);
  play(spent.engine, P1, spent.id("qd"));
  assert.equal(pending(spent.engine)?.kind, "chooserSelectsTarget", "playable with nothing left to pay: its cost is 0");
  const noThreshold = disappearanceBoard({ obsession: 0, extra: bank("greed", 4, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("qd")));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("qd")), "hand");
});

clause(DISAPPEARANCE, "0:rule", "it can be played in response (a tactic): the opponent returns a card to hand before their own tactic resolves", () => {
  const b = disappearanceBoard({ active: P2, extra: [{ key: "pump", def: pumpTactic(2), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("qd"));
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

// =============================================================================
// Quotidian Virtuoso
// =============================================================================
// DISRUPT -- COST: Pay 2. Discard a card. Deplete this card.
// EFFECT: Look at your opponent's hand and pick a card. Your opponent must discard that card.
// Character (ritualist), cost 5, threshold [O][O], 3 strength / 3 speed / 3 life.

const VIRTUOSO = "b1f959d9-c5cd-4a7c-9b1b-dfcac62fd6a6";

function virtuosoBoard(opts: { greed?: number; myHand?: number; theirHand?: number; depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "qv", def: printing(VIRTUOSO), owner: P1, zone: "play", depleted: opts.depleted },
      ...fillers("ph", opts.myHand ?? 3, P1, "hand"),
      ...fillers("oh", opts.theirHand ?? 3, P2, "hand"),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type VirBoard = ReturnType<typeof virtuosoBoard>;
const disruptRaw = (b: VirBoard, discardKey: string | undefined) => playRawAbility(b.engine, P1, b.id("qv"), "disrupt", discardKey ? { d: [b.id(discardKey)] } : {});

clause(VIRTUOSO, "0:ability:disrupt", "pays 2, discards the chosen card of your hand and depletes the Virtuoso as the COST (before the opponent can respond)", () => {
  const b = virtuosoBoard();
  const before = ready(b.engine);
  disruptRaw(b, "ph1");
  assert.equal(before - ready(b.engine), 2, "COST: Pay 2");
  assert.equal(zoneOf(b.engine, b.id("ph1")), "discard", "COST: Discard a card");
  assert.ok(discardOf(b.engine, P1).includes(b.id("ph1")), "into your own discard pile");
  assert.equal(b.engine.state.cards[b.id("qv")].depleted, true, "COST: Deplete this card");
  assert.ok(b.engine.state.responseWindow, "the opponent may respond only after the costs are paid");
});

clause(VIRTUOSO, "0:ability:disrupt", "then you pick a card in the opponent's hand and they discard it", () => {
  const b = virtuosoBoard();
  disruptRaw(b, "ph1");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Virtuoso's controller picks");
  pick(b.engine, [b.id("oh2")]);
  assert.equal(zoneOf(b.engine, b.id("oh2")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("oh2")), "their discard pile");
  assert.equal(handOf(b.engine, P2).length, 2, "only that card");
  assert.equal(handOf(b.engine, P1).length, 2, "your hand lost only the cost card");
});

clause(VIRTUOSO, "0:ability:disrupt", "any card of the opponent's hand can be picked", () => {
  for (const key of ["oh0", "oh1", "oh2"]) {
    const b = virtuosoBoard();
    activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph0")] } });
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
  }
});

clause(VIRTUOSO, "0:ability:disrupt", "you must pick one: picking none is refused while the opponent has cards", () => {
  const b = virtuosoBoard();
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph0")] } });
  refused(() => pickRaw(b.engine, []));
  refused(() => pickRaw(b.engine, ids2(b, ["oh0", "oh1"])), "two cards");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(VIRTUOSO, "0:ability:disrupt", "the picked card must be in the OPPONENT's hand: your hand, cards in play and discard piles are refused", () => {
  const b = virtuosoBoard();
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph0")] } });
  refused(() => pickRaw(b.engine, [b.id("ph1")]), "your own hand");
  refused(() => pickRaw(b.engine, [b.id("foe")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("inDiscard")]), "a discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oh0")]);
});

clause(VIRTUOSO, "0:ability:disrupt", "the card discarded as the cost must come from your hand: the opponent's hand, play and the discard pile are refused", () => {
  const b = virtuosoBoard();
  refused(() => disruptRaw(b, "oh0"), "the opponent's hand");
  refused(() => disruptRaw(b, "inPlay"), "a card in play");
  refused(() => disruptRaw(b, "inDiscard"), "a card already in the discard pile");
  assert.equal(ready(b.engine), 3, "nothing was paid by the refused attempts");
  assert.equal(b.engine.state.cards[b.id("qv")].depleted, false);
  disruptRaw(b, "ph0");
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard", "control: a card of your hand works");
});

clause(VIRTUOSO, "0:ability:disrupt", "exactly one card is discarded for the cost: none and two are refused", () => {
  const b = virtuosoBoard();
  refused(() => disruptRaw(b, undefined), "no discard chosen");
  refused(() => playRawAbility(b.engine, P1, b.id("qv"), "disrupt", { d: ids2(b, ["ph0", "ph1"]) }), "two cards");
  assert.equal(handOf(b.engine, P1).length, 3);
  assert.equal(ready(b.engine), 3);
});

clause(VIRTUOSO, "0:ability:disrupt", "with an empty hand there is nothing to discard, so it cannot be used", () => {
  const b = virtuosoBoard({ myHand: 0 });
  refused(() => disruptRaw(b, undefined));
  assert.equal(ready(b.engine), 3);
  assert.equal(b.engine.state.cards[b.id("qv")].depleted, false);
});

clause(VIRTUOSO, "0:ability:disrupt", "a card of any type can be the discarded cost, a resource card included", () => {
  const b = virtuosoBoard({ extra: [{ key: "handRes", def: resourceCard({ name: "HandRage" }), owner: P1, zone: "hand" }] });
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("handRes")] } });
  assert.equal(zoneOf(b.engine, b.id("handRes")), "discard");
});

clause(VIRTUOSO, "0:ability:disrupt", "a depleted Virtuoso cannot pay 'Deplete this card': it is refused, and nothing else is paid", () => {
  const b = virtuosoBoard({ depleted: true });
  refused(() => disruptRaw(b, "ph0"));
  assert.equal(zoneOf(b.engine, b.id("ph0")), "hand");
  assert.equal(ready(b.engine), 3);
});

clause(VIRTUOSO, "0:ability:disrupt", "it can be used once per turn (it stays depleted) and again after it is restored", () => {
  const b = virtuosoBoard({ greed: 6 });
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph0")] } });
  pick(b.engine, [b.id("oh0")]);
  refused(() => disruptRaw(b, "ph1"), "depleted");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.cards[b.id("qv")].depleted, false, "restored at the start of your turn");
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph1")] } });
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
});

clause(VIRTUOSO, "0:ability:disrupt", "is refused one resource short of the 2 it costs, accepted with exactly 2", () => {
  const short = virtuosoBoard({ greed: 1 });
  refused(() => disruptRaw(short, "ph0"));
  assert.equal(zoneOf(short.engine, short.id("ph0")), "hand");
  assert.equal(short.engine.state.cards[short.id("qv")].depleted, false);
  const exact = virtuosoBoard({ greed: 2 });
  activate(exact.engine, P1, exact.id("qv"), "disrupt", { selected: { d: [exact.id("ph0")] } });
  pick(exact.engine, [exact.id("oh0")]);
  assert.equal(ready(exact.engine), 0);
});

clause(VIRTUOSO, "0:ability:disrupt", "with an empty opponent hand the costs are paid and nothing is discarded", () => {
  const b = virtuosoBoard({ theirHand: 0 });
  activate(b.engine, P1, b.id("qv"), "disrupt", { selected: { d: [b.id("ph0")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard");
  assert.equal(b.engine.state.cards[b.id("qv")].depleted, true);
});

clause(VIRTUOSO, "0:ability:disrupt", "only the Virtuoso's controller can use it", () => {
  const b = virtuosoBoard();
  refused(() => playRawAbility(b.engine, P2, b.id("qv"), "disrupt", { d: [b.id("oh0")] }));
  assert.equal(handOf(b.engine, P2).length, 3);
});

// =============================================================================
// Recollection Bazaar
// =============================================================================
// RECALL -- COST: Pick a resource you control. (You can pick face-down resources.)
// EFFECT: Put the resource into your hand.
// Location, cost 0, threshold [O][O], structure 5.

const BAZAAR = "e5a8f861-fbbd-4c45-8b1d-2ddec10120bd";

function bazaarBoard(opts: { extra?: CardPlacement[]; controller?: Pid; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "baz", def: printing(BAZAAR), owner: P1, zone: "play", controller: opts.controller },
      obsessionCard("r1", P1),
      obsessionCard("r2", P1),
      obsessionCard("spent", P1, { attachedToKey: "__factionA" }),
      { key: "fd", def: character({ name: "FaceDownGuy" }), owner: P1, zone: "play", faceDown: true },
      obsessionCard("foeRes", P2),
      { key: "foeFd", def: character({ name: "FoeFaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "handRes", def: resourceCard({ name: "HandRage" }), owner: P1, zone: "hand" },
      { key: "discardRes", def: resourceCard({ name: "DiscardedRage" }), owner: P1, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type BazBoard = ReturnType<typeof bazaarBoard>;
const recall = (b: BazBoard, key: string) => activate(b.engine, P1, b.id("baz"), "recall", { selected: { res: [b.id(key)] } });
const recallRaw = (b: BazBoard, cardId: CardInstanceId) => playRawAbility(b.engine, P1, b.id("baz"), "recall", { res: [cardId] });

clause(BAZAAR, "0:ability:recall", "puts the picked face-up resource into your hand, and the Bazaar is neither depleted nor does it cost anything", () => {
  const b = bazaarBoard();
  const readyBefore = ready(b.engine);
  recall(b, "spent");
  assert.equal(zoneOf(b.engine, b.id("spent")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("spent")), "handOf(b.engine, P1).includes(b.id(\"spent\"))");
  assert.equal(b.engine.state.cards[b.id("baz")].depleted, false, "no deplete in the cost");
  assert.equal(ready(b.engine), readyBefore, "nothing was paid (the picked resource was a spent one)");
});

clause(BAZAAR, "0:ability:recall", "you can pick a FACE-DOWN resource: it goes to your hand", () => {
  const b = bazaarBoard();
  recall(b, "fd");
  assert.equal(zoneOf(b.engine, b.id("fd")), "hand");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false, "face-up in your hand");
});

clause(BAZAAR, "0:ability:recall", "it can be used any number of times: nothing in the cost limits it", () => {
  const b = bazaarBoard();
  recall(b, "r1");
  recall(b, "r2");
  recall(b, "fd");
  for (const key of ["r1", "r2", "fd"]) assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
});

clause(BAZAAR, "0:ability:recall", "a resource you control but do not own goes into YOUR hand", () => {
  const b = bazaarBoard({ extra: [obsessionCard("stolenRes", P2, { controller: P1 })] });
  recall(b, "stolenRes");
  assert.ok(handOf(b.engine, P1).includes(b.id("stolenRes")), "handOf(b.engine, P1).includes(b.id(\"stolenRes\"))");
  assert.equal(handOf(b.engine, P2).includes(b.id("stolenRes")), false);
});

clause(BAZAAR, "0:ability:recall", "the pick must be a resource YOU control: the opponent's resources (face-up and face-down), characters, items, factions and resources outside play are refused", () => {
  const b = bazaarBoard();
  refused(() => recallRaw(b, b.id("foeRes")), "the opponent's resource");
  refused(() => recallRaw(b, b.id("foeFd")), "the opponent's face-down resource");
  refused(() => recallRaw(b, b.id("mine")), "a character");
  refused(() => recallRaw(b, b.id("thing")), "an item");
  refused(() => recallRaw(b, b.id("baz")), "the Bazaar itself");
  refused(() => recallRaw(b, b.engine.state.players[P1].factionId!), "your faction");
  refused(() => recallRaw(b, b.id("handRes")), "a resource card in your hand");
  refused(() => recallRaw(b, b.id("discardRes")), "a resource card in the discard pile");
  recall(b, "r1");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "control: your own resource works");
});

clause(BAZAAR, "0:ability:recall", "exactly one resource is picked (none, or two, is refused)", () => {
  const b = bazaarBoard();
  refused(() => playRawAbility(b.engine, P1, b.id("baz"), "recall", { res: [] }));
  refused(() => playRawAbility(b.engine, P1, b.id("baz"), "recall", {}));
  refused(() => playRawAbility(b.engine, P1, b.id("baz"), "recall", { res: ids2(b, ["r1", "r2"]) }));
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
});

clause(BAZAAR, "0:ability:recall", "only the Bazaar's controller can use it", () => {
  const b = bazaarBoard();
  refused(() => playRawAbility(b.engine, P2, b.id("baz"), "recall", { res: [b.id("foeRes")] }));
  assert.equal(zoneOf(b.engine, b.id("foeRes")), "play");
});

clause(BAZAAR, "0:ability:recall", "a Bazaar controlled by the opponent lets THEM recall their own resources", () => {
  const b = bazaarBoard({ controller: P2, active: P2 });
  activate(b.engine, P2, b.id("baz"), "recall", { selected: { res: [b.id("foeRes")] } });
  assert.ok(handOf(b.engine, P2).includes(b.id("foeRes")), "handOf(b.engine, P2).includes(b.id(\"foeRes\"))");
  refused(() => playRawAbility(b.engine, P2, b.id("baz"), "recall", { res: [b.id("r1")] }), "P1's resource is not one P2 controls");
});

clause(BAZAAR, "0:ability:recall", "it can be used in response on the opponent's turn", () => {
  const b = bazaarBoard({ active: P2, extra: [{ key: "pump", def: pumpTactic(1), owner: P2, zone: "hand" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRawAbility(b.engine, P1, b.id("baz"), "recall", { res: [b.id("r1")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
});

// =============================================================================
// Ritual of the Knob & Pull
// =============================================================================
// COST: Pick a character. X is that character's strength.
// EFFECT: If your opponent controls at least X face-down resources, destroy the character.
// Tactic, cost 3, threshold [O][O].

const KNOB = "dbc439b3-5628-43ef-bbc1-ea7523e85fb0";

function knobBoard(opts: { strength?: number; theirFaceDown?: number; myFaceDown?: number; theirFaceUp?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rkp", def: printing(KNOB), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: opts.strength ?? 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(opts.theirFaceDown ?? 2, P2),
      ...volition(opts.myFaceDown ?? 0, P1),
      ...bank("rage", opts.theirFaceUp ?? 0, P2),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type KnobBoard = ReturnType<typeof knobBoard>;
const knobPlay = (b: KnobBoard, target = "foe") => play(b.engine, P1, b.id("rkp"), { selected: { c: [b.id(target)] } });

clause(KNOB, "0:ability", "X = the picked character's strength: with exactly X face-down resources of the opponent's it is destroyed", () => {
  const b = knobBoard({ strength: 2, theirFaceDown: 2 });
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foe")), "destroyed: into its owner's discard pile");
});

clause(KNOB, "0:ability", "with one face-down resource fewer than X the character survives", () => {
  const b = knobBoard({ strength: 3, theirFaceDown: 2 });
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(b.engine.state.cards[b.id("foe")].damage ?? 0, 0);
});

clause(KNOB, "0:ability", "'at least X': more face-down resources than X destroys it as well", () => {
  const b = knobBoard({ strength: 1, theirFaceDown: 4 });
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
});

clause(KNOB, "0:ability", "X is read from the strength: strength 3 with 3 face-down is destroyed, strength 4 with 3 is not", () => {
  const destroyed = knobBoard({ strength: 3, theirFaceDown: 3 });
  knobPlay(destroyed);
  assert.equal(zoneOf(destroyed.engine, destroyed.id("foe")), "discard");
  const survives = knobBoard({ strength: 4, theirFaceDown: 3 });
  knobPlay(survives);
  assert.equal(zoneOf(survives.engine, survives.id("foe")), "play");
});

clause(KNOB, "0:ability", "X = 0 (a character with 0 strength): 'at least 0' is always true, so it is destroyed even if the opponent has no face-down resource", () => {
  const b = knobBoard({ strength: 0, theirFaceDown: 0 });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 0);
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
});

clause(KNOB, "0:ability", "the strength used is the character's CURRENT strength (a strength boost raises X)", () => {
  const b = knobBoard({
    strength: 1,
    theirFaceDown: 2,
    extra: [
      {
        key: "booster",
        def: item({ name: "Booster", attachTo: "character", behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] } }),
        owner: P2,
        zone: "play",
        attachedToKey: "foe"
      }
    ]
  });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "X = 3 > 2 face-down resources");
});

clause(KNOB, "0:ability", "only the OPPONENT's face-down resources count: yours do not", () => {
  const b = knobBoard({ strength: 2, theirFaceDown: 1, myFaceDown: 5 });
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "1 face-down resource of theirs < X = 2, however many you have");
});

clause(KNOB, "0:ability", "only FACE-DOWN resources count: the opponent's face-up resources do not", () => {
  const b = knobBoard({ strength: 1, theirFaceDown: 0, theirFaceUp: 5 });
  knobPlay(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "five face-up resources are not face-down resources");
});

clause(KNOB, "0:ability", "your own character can be picked too, and is judged against the opponent's face-down resources", () => {
  const b = knobBoard({ theirFaceDown: 3 });
  knobPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "strength 3, the opponent controls 3 face-down resources");
  const safe = knobBoard({ theirFaceDown: 2 });
  knobPlay(safe, "mine");
  assert.equal(zoneOf(safe.engine, safe.id("mine")), "play");
});

clause(KNOB, "0:ability", "pays 3 and the tactic goes to its owner's discard pile, whether or not the character is destroyed", () => {
  for (const faceDown of [0, 5]) {
    const b = knobBoard({ strength: 2, theirFaceDown: faceDown });
    const before = ready(b.engine);
    knobPlay(b);
    assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
    assert.equal(zoneOf(b.engine, b.id("rkp")), "discard");
  }
});

clause(KNOB, "0:ability", "'X is that character's strength' is fixed when the cost is paid: a strength boost played in response does not raise X", () => {
  const b = knobBoard({ strength: 2, theirFaceDown: 2, extra: [{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("rkp"), { selected: { c: [b.id("foe")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 5, "the pump did resolve");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "X was 2 when the tactic was played (the opponent controls 2 face-down resources)");
});

clause(KNOB, "0:ability", "the pick must be a character: items, locations and factions are refused", () => {
  const b = knobBoard();
  const attempt = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("rkp"), { selected: { c: [cardId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  refused(attempt(b.engine.state.players[P2].factionId!), "the opponent's faction");
  assert.equal(zoneOf(b.engine, b.id("rkp")), "hand", "nothing was played");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(KNOB, "0:ability", "a face-down card is a resource, not a character, and cannot be picked", () => {
  const b = knobBoard({ theirFaceDown: 2 });
  const faceDown = b.engine.state.players[P2].play.find((c) => b.engine.state.cards[c].faceDown)!;
  refused(() => playRaw(b.engine, P1, b.id("rkp"), { selected: { c: [faceDown] } }), "a face-down resource");
});

clause(KNOB, "0:ability", "exactly one character is picked (none, or two, is refused)", () => {
  const b = knobBoard();
  refused(() => playRaw(b.engine, P1, b.id("rkp"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("rkp"), {}), "no declaration");
  refused(() => playRaw(b.engine, P1, b.id("rkp"), { selected: { c: ids2(b, ["foe", "mine"]) } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("rkp")), "hand");
});

clause(KNOB, "0:ability", "is refused one resource short of its cost of 3 and without [O][O] even with plenty of other resources", () => {
  const short = knobBoard({ obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("rkp"), { selected: { c: [short.id("foe")] } }), "2 resources for a cost of 3");
  const noThreshold = knobBoard({ obsession: 1, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("rkp"), { selected: { c: [noThreshold.id("foe")] } }), "one [O] is not [O][O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rkp")), "hand");
  const ok = knobBoard({ obsession: 2, extra: bank("greed", 1, P1) });
  knobPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("rkp")), "discard");
});

// =============================================================================
// Ritual of the Ominous Urn
// =============================================================================
// Your opponent must discard a card. You may search your deck for a card of the same
// type as the discarded card, reveal it, and put it into your hand.
// Tactic, cost 4, threshold [O].

const URN = "8bdf8634-d49d-43f6-b267-15978fab6227";

type CardKind = "character" | "tactic" | "item" | "location" | "resource";
const kindCard = (kind: CardKind, name: string): CardDefinition =>
  kind === "character" ? character({ name }) : kind === "tactic" ? tactic({ name }) : kind === "item" ? item({ name }) : kind === "location" ? location({ name }) : resourceCard({ name });

function urnBoard(opts: { obsession?: number; theirHand?: Array<{ key: string; kind: CardKind }>; random?: () => number; extra?: CardPlacement[] } = {}) {
  const theirHand: Array<{ key: string; kind: CardKind }> = opts.theirHand ?? [
    { key: "oChar", kind: "character" },
    { key: "oTac", kind: "tactic" },
    { key: "oItem", kind: "item" },
    { key: "oLoc", kind: "location" },
    { key: "oRes", kind: "resource" }
  ];
  const myDeck: Array<{ key: string; kind: CardKind }> = [
    { key: "dChar1", kind: "character" },
    { key: "dTac1", kind: "tactic" },
    { key: "dChar2", kind: "character" },
    { key: "dItem", kind: "item" },
    { key: "dLoc", kind: "location" },
    { key: "dRes", kind: "resource" },
    { key: "dTac2", kind: "tactic" },
    { key: "dFill", kind: "character" }
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "urn", def: printing(URN), owner: P1, zone: "hand" },
      ...theirHand.map((card) => ({ key: card.key, def: kindCard(card.kind, `Their ${card.key}`), owner: P2, zone: "hand" as const })),
      ...myDeck.map((card) => ({ key: card.key, def: kindCard(card.kind, `My ${card.key}`), owner: P1, zone: "deck" as const })),
      { key: "theirDeckChar", def: character({ name: "TheirDeckChar" }), owner: P2, zone: "deck" },
      { key: "myHandChar", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type UrnBoard = ReturnType<typeof urnBoard>;
/** Plays the Urn and stops at the opponent's discard choice. */
function urnPlay(b: UrnBoard): void {
  play(b.engine, P1, b.id("urn"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the opponent is asked to discard");
  assert.equal(pending(b.engine)?.playerId, P2);
}

clause(URN, "0:rule", "pays 4, the opponent (not you) picks a card of their hand and discards it", () => {
  const b = urnBoard();
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P2).length;
  playRaw(b.engine, P1, b.id("urn"));
  assert.equal(before - ready(b.engine), 4, "the printed cost of 4 is paid");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("oTac")]);
  assert.equal(zoneOf(b.engine, b.id("oTac")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("oTac")), "their own discard pile");
  assert.equal(handOf(b.engine, P2).length, handBefore - 1);
});

clause(URN, "0:rule", "your opponent MUST discard: choosing no card is refused while they have a card in hand", () => {
  const b = urnBoard();
  urnPlay(b);
  refused(() => pickRaw(b.engine, []), "declining is not allowed");
  assert.equal(handOf(b.engine, P2).length, 5);
});

clause(URN, "0:rule", "exactly one card is discarded (two at once is refused)", () => {
  const b = urnBoard();
  urnPlay(b);
  refused(() => pickRaw(b.engine, ids2(b, ["oChar", "oTac"])));
  assert.equal(handOf(b.engine, P2).length, 5);
});

clause(URN, "0:rule", "the discarded card comes from the opponent's HAND: your hand, their deck and cards in play are refused", () => {
  const b = urnBoard({ extra: [{ key: "oPlay", def: character({ name: "TheirInPlay" }), owner: P2, zone: "play" }] });
  urnPlay(b);
  refused(() => pickRaw(b.engine, [b.id("myHandChar")]), "your own hand");
  refused(() => pickRaw(b.engine, [b.id("theirDeckChar")]), "their deck");
  refused(() => pickRaw(b.engine, [b.id("oPlay")]), "their battlefield");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("oChar")]);
  assert.equal(zoneOf(b.engine, b.id("myHandChar")), "hand");
});

for (const [kind, discarded, wanted, unwanted] of [
  ["character", "oChar", "dChar2", ["dTac1", "dItem", "dLoc", "dRes"]],
  ["tactic", "oTac", "dTac2", ["dChar1", "dItem", "dLoc", "dRes"]],
  ["item", "oItem", "dItem", ["dChar1", "dTac1", "dLoc", "dRes"]],
  ["location", "oLoc", "dLoc", ["dChar1", "dTac1", "dItem", "dRes"]],
  ["resource", "oRes", "dRes", ["dChar1", "dTac1", "dItem", "dLoc"]]
] as const) {
  clause(URN, "0:rule", `discarded ${kind}: you may search your deck for a ${kind} only, reveal it and put it into your hand`, () => {
    const b = urnBoard();
    urnPlay(b);
    pick(b.engine, [b.id(discarded)]);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget", "you are offered the search");
    assert.equal(pc?.playerId, P1, "the Urn's controller searches");
    for (const key of unwanted) refused(() => pickRaw(b.engine, [b.id(key)]), `a ${key} is not a ${kind}`);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still searching");
    pick(b.engine, [b.id(wanted)]);
    assert.equal(zoneOf(b.engine, b.id(wanted)), "hand");
    assert.ok(handOf(b.engine, P1).includes(b.id(wanted)), "handOf(b.engine, P1).includes(b.id(wanted))");
    for (const key of unwanted) assert.equal(zoneOf(b.engine, b.id(key)), "deck", `${key} stays in the deck`);
  });
}

clause(URN, "0:rule", "the search is of YOUR deck: the opponent's deck is not searched", () => {
  const b = urnBoard();
  urnPlay(b);
  pick(b.engine, [b.id("oChar")]);
  refused(() => pickRaw(b.engine, [b.id("theirDeckChar")]), "their deck");
  pick(b.engine, [b.id("dChar1")]);
  assert.equal(zoneOf(b.engine, b.id("theirDeckChar")), "deck");
});

clause(URN, "0:rule", "only ONE card is found (two at once is refused)", () => {
  const b = urnBoard();
  urnPlay(b);
  pick(b.engine, [b.id("oChar")]);
  refused(() => pickRaw(b.engine, ids2(b, ["dChar1", "dChar2"])));
  assert.equal(zoneOf(b.engine, b.id("dChar1")), "deck");
});

clause(URN, "0:rule", "'you may search': declining finds nothing and nothing enters your hand", () => {
  const b = urnBoard();
  const handBefore = [...handOf(b.engine, P1)];
  urnPlay(b);
  pick(b.engine, [b.id("oChar")]);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), handBefore.filter((c) => c !== b.id("urn")), "no card was added to your hand");
  assert.equal(zoneOf(b.engine, b.id("dChar1")), "deck");
});

clause(URN, "0:rule", "the found card is revealed", () => {
  const b = urnBoard();
  urnPlay(b);
  pick(b.engine, [b.id("oItem")]);
  pick(b.engine, [b.id("dItem")]);
  const reveal = b.engine
    .getLog()
    .map((entry) => entry.event)
    .find((event) => event?.type === "cardsRevealed" && event.cardIds.includes(b.id("dItem")));
  assert.ok(reveal && reveal.type === "cardsRevealed", "the found card was revealed");
  assert.equal(reveal.viewerId, "all");
});

clause(URN, "0:rule", "no card of the discarded card's type in your deck: nothing to search for, the tactic still resolves", () => {
  const b = urnBoard({ extra: [] });
  for (const key of ["dLoc"]) b.engine.state.cards[b.id(key)].zone = "discard";
  b.engine.state.players[P1].deck = b.engine.state.players[P1].deck.filter((c) => c !== b.id("dLoc"));
  b.engine.state.players[P1].discard.push(b.id("dLoc"));
  urnPlay(b);
  pick(b.engine, [b.id("oLoc")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no location in the deck: no search");
  assert.equal(zoneOf(b.engine, b.id("urn")), "discard");
});

clause(URN, "0:rule", "with the opponent's hand empty nothing is discarded, so there is no type to search for", () => {
  const b = urnBoard({ theirHand: [] });
  const myHand = [...handOf(b.engine, P1)].filter((c) => c !== b.id("urn"));
  play(b.engine, P1, b.id("urn"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard, so no search is offered");
  assert.deepEqual(handOf(b.engine, P1), myHand);
  assert.equal(zoneOf(b.engine, b.id("urn")), "discard");
});

clause(URN, "0:rule", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const b = urnBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  urnPlay(b);
  pick(b.engine, [b.id("oChar")]);
  pick(b.engine, [b.id("dChar2")]);
  const unshuffled = before.filter((c) => c !== b.id("dChar2"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.notDeepEqual(deckOf(b.engine, P1), unshuffled, "but their order changed: the deck was shuffled");
});

clause(URN, "0:rule", "is refused one resource short of 4, and without [O] even with plenty of other resources", () => {
  const short = urnBoard({ obsession: 3 });
  refused(() => playRaw(short.engine, P1, short.id("urn")), "3 resources for a cost of 4");
  const noThreshold = urnBoard({ obsession: 0, extra: bank("greed", 6, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("urn")), "no [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("urn")), "hand");
  const ok = urnBoard({ obsession: 1, extra: bank("greed", 3, P1) });
  urnPlay(ok);
  assert.equal(handOf(ok.engine, P2).length, 5, "with [O] and 4 resources it resolves and the opponent is asked to discard");
});

// =============================================================================
// Rummaging Millipede
// =============================================================================
// COVERT. When this card enters play, you may pick a tactic in your discard pile. If
// you do, put that tactic into your hand.
// Character (lurker), cost 5, threshold [O][O], 3 strength / 3 speed / 1 life.

const MILLIPEDE = "91748250-8687-4e0b-84a4-4380bc3c2bab";

clause(MILLIPEDE, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MILLIPEDE));

function millipedeBoard(opts: { obsession?: number; extra?: CardPlacement[]; tactics?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "hand" },
      ...(opts.tactics === false
        ? []
        : [
            { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" as const },
            { key: "tacB", def: tactic({ name: "TacB" }), owner: P1, zone: "discard" as const }
          ]),
      { key: "chrD", def: character({ name: "ChrD" }), owner: P1, zone: "discard" },
      { key: "itemD", def: item({ name: "ItemD" }), owner: P1, zone: "discard" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: P2, zone: "discard" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner: P1, zone: "hand" },
      { key: "deckTac", def: tactic({ name: "DeckTac" }), owner: P1, zone: "deck" },
      { key: "playChar", def: character({ name: "PlayChar" }), owner: P1, zone: "play" },
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type MilBoard = ReturnType<typeof millipedeBoard>;
function millipedePlay(b: MilBoard): void {
  play(b.engine, P1, b.id("mm"));
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
}

clause(MILLIPEDE, "1:rule", "when it enters play you may pick a tactic in your discard pile, and it goes into your hand", () => {
  const b = millipedeBoard();
  const before = ready(b.engine);
  millipedePlay(b);
  assert.equal(before - ready(b.engine), 5, "the printed cost of 5 is paid");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "its controller picks");
  pick(b.engine, [b.id("tacA")]);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("tacA")), "handOf(b.engine, P1).includes(b.id(\"tacA\"))");
  assert.equal(zoneOf(b.engine, b.id("tacB")), "discard", "the other tactic stays in the discard pile");
});

clause(MILLIPEDE, "1:rule", "either tactic can be picked", () => {
  for (const key of ["tacA", "tacB"]) {
    const b = millipedeBoard();
    millipedePlay(b);
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
  }
});

clause(MILLIPEDE, "1:rule", "'you may': picking nothing leaves every tactic in the discard pile", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tacB")), "discard");
});

clause(MILLIPEDE, "1:rule", "only a TACTIC in YOUR discard pile: characters and items there, the opponent's discard pile, your hand, deck and play are refused", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  refused(() => pickRaw(b.engine, [b.id("chrD")]), "a character in your discard pile");
  refused(() => pickRaw(b.engine, [b.id("itemD")]), "an item in your discard pile");
  refused(() => pickRaw(b.engine, [b.id("oppTac")]), "a tactic in the opponent's discard pile");
  refused(() => pickRaw(b.engine, [b.id("handTac")]), "a tactic in your hand");
  refused(() => pickRaw(b.engine, [b.id("deckTac")]), "a tactic in your deck");
  refused(() => pickRaw(b.engine, [b.id("playChar")]), "a card in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(b.engine, [b.id("tacB")]);
  assert.equal(zoneOf(b.engine, b.id("tacB")), "hand");
});

clause(MILLIPEDE, "1:rule", "only ONE tactic is returned (two at once is refused)", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  refused(() => pickRaw(b.engine, ids2(b, ["tacA", "tacB"])));
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
});

clause(MILLIPEDE, "1:rule", "with no tactic in your discard pile there is nothing to pick: no choice is asked", () => {
  const b = millipedeBoard({ tactics: false });
  millipedePlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("chrD")), "discard");
});

clause(MILLIPEDE, "1:rule", "the tactic returns when it ENTERS play, not while the Millipede waits for responses", () => {
  const b = millipedeBoard();
  playRaw(b.engine, P1, b.id("mm"));
  assert.equal(zoneOf(b.engine, b.id("mm")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is picked yet");
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "now it has entered play");
});

clause(MILLIPEDE, "1:rule", "it does not trigger when it leaves play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "play" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mm")] } });
  assert.equal(zoneOf(b.engine, b.id("mm")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
});

clause(MILLIPEDE, "1:rule", "is refused one resource short of its cost of 5, and without [O][O] even with plenty of other resources", () => {
  const short = millipedeBoard({ obsession: 4 });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "4 resources for a cost of 5");
  const noThreshold = millipedeBoard({ obsession: 1, extra: bank("greed", 6, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("mm")), "one [O] is not [O][O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mm")), "hand");
});

// =============================================================================
// The Deranger
// =============================================================================
// LOBOTOMIZE -- COST: Deplete this card.
// EFFECT: Look at your opponent's hand and pick 2 or fewer non-resource cards. Your
// opponent must discard those cards. Your opponent takes control of this card.
// Item, cost 3, threshold [O][O].

const DERANGER = "cebf2a7c-905e-433d-b6ab-bcdc2aafacbf";

function derangerBoard(opts: { theirHand?: boolean; depleted?: boolean; extra?: CardPlacement[]; controller?: Pid; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "dr", def: printing(DERANGER), owner: P1, zone: "play", depleted: opts.depleted, controller: opts.controller },
      ...(opts.theirHand === false
        ? []
        : [
            { key: "c1", def: character({ name: "TheirC1" }), owner: P2, zone: "hand" as const },
            { key: "c2", def: character({ name: "TheirC2" }), owner: P2, zone: "hand" as const },
            { key: "c3", def: character({ name: "TheirC3" }), owner: P2, zone: "hand" as const },
            { key: "tac", def: tactic({ name: "TheirTactic" }), owner: P2, zone: "hand" as const },
            { key: "res", def: resourceCard({ name: "TheirRage" }), owner: P2, zone: "hand" as const }
          ]),
      ...fillers("ph", 2, P1, "hand"),
      { key: "foeInPlay", def: character({ name: "FoeInPlay" }), owner: P2, zone: "play" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type DerBoard = ReturnType<typeof derangerBoard>;
const lobotomize = (b: DerBoard, player: Pid = P1) => activate(b.engine, player, b.id("dr"), "lobotomize");

clause(DERANGER, "0:ability:lobotomize", "depletes the Deranger as the COST (before the opponent can respond), then you pick up to 2 of the opponent's non-resource cards", () => {
  const b = derangerBoard();
  playRawAbility(b.engine, P1, b.id("dr"), "lobotomize");
  assert.equal(b.engine.state.cards[b.id("dr")].depleted, true, "COST: Deplete this card");
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P1, "control has not changed yet");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "you pick");
});

clause(DERANGER, "0:ability:lobotomize", "two picked cards are discarded from the opponent's hand into THEIR discard pile", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, ids2(b, ["c1", "tac"]));
  for (const key of ["c1", "tac"]) {
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
    assert.ok(discardOf(b.engine, P2).includes(b.id(key)), `${key} is in their discard pile`);
  }
  assert.deepEqual(
    handOf(b.engine, P2).map((c) => b.engine.getDefinition(c).name).sort(),
    ["TheirC2", "TheirC3", "TheirRage"].sort(),
    "the other cards stay in their hand"
  );
});

clause(DERANGER, "0:ability:lobotomize", "'2 or fewer': one card, or none, can be picked", () => {
  const one = derangerBoard();
  lobotomize(one);
  pick(one.engine, [one.id("c2")]);
  assert.equal(zoneOf(one.engine, one.id("c2")), "discard");
  assert.equal(handOf(one.engine, P2).length, 4);
  const none = derangerBoard();
  lobotomize(none);
  pick(none.engine, []);
  assert.equal(handOf(none.engine, P2).length, 5, "nothing was discarded");
});

clause(DERANGER, "0:ability:lobotomize", "three cards cannot be picked", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, ids2(b, ["c1", "c2", "c3"])));
  assert.equal(handOf(b.engine, P2).length, 5);
});

clause(DERANGER, "0:ability:lobotomize", "the picks must be NON-RESOURCE cards: a resource card in their hand is refused (a tactic is fine)", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, [b.id("res")]), "a resource card");
  refused(() => pickRaw(b.engine, ids2(b, ["c1", "res"])), "a resource card as the second pick");
  pick(b.engine, ids2(b, ["tac", "c1"]));
  assert.equal(zoneOf(b.engine, b.id("tac")), "discard");
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "the picks must come from the OPPONENT's hand: your hand, cards in play and discard piles are refused", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, [b.id("ph0")]), "your own hand");
  refused(() => pickRaw(b.engine, [b.id("foeInPlay")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("foeDiscard")]), "a card in their discard pile");
  pick(b.engine, [b.id("c3")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "the same card cannot be picked twice", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, ids2(b, ["c1", "c1"])));
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "afterwards your opponent takes control of the Deranger", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, ids2(b, ["c1", "c2"]));
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P2);
  assert.ok(b.engine.state.players[P2].play.includes(b.id("dr")), "it is in the opponent's play area");
  assert.equal(b.engine.state.players[P1].play.includes(b.id("dr")), false);
  assert.equal(b.engine.state.cards[b.id("dr")].ownerId, P1, "ownership never changes");
});

clause(DERANGER, "0:ability:lobotomize", "the opponent takes control even if you pick no card", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P2);
});

clause(DERANGER, "0:ability:lobotomize", "the opponent takes control even if they have no card in hand", () => {
  const b = derangerBoard({ theirHand: false });
  lobotomize(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no hand to look at, nothing to pick");
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P2);
});

clause(DERANGER, "0:ability:lobotomize", "once the opponent controls it you can no longer use it", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, []);
  refused(() => playRawAbility(b.engine, P1, b.id("dr"), "lobotomize"));
});

clause(DERANGER, "0:ability:lobotomize", "it stays depleted under the new controller until it is restored at the start of THEIR turn, and then they can use it on you", () => {
  const b = derangerBoard({ extra: fillers("ph", 0, P1, "hand") });
  lobotomize(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.cards[b.id("dr")].depleted, true, "still depleted");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.cards[b.id("dr")].depleted, false, "restored at the start of the new controller's turn");
  activate(b.engine, P2, b.id("dr"), "lobotomize");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2, "now P2 looks at P1's hand");
  pick(b.engine, [b.id("ph0")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("ph0")), "P1's discard pile");
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P1, "and P1 takes control again");
});

clause(DERANGER, "0:ability:lobotomize", "a depleted Deranger cannot be used (its cost is depleting it) and nothing happens", () => {
  const b = derangerBoard({ depleted: true });
  refused(() => playRawAbility(b.engine, P1, b.id("dr"), "lobotomize"));
  assert.equal(handOf(b.engine, P2).length, 5);
  assert.equal(b.engine.state.cards[b.id("dr")].controllerId, P1);
});

clause(DERANGER, "0:ability:lobotomize", "only the Deranger's controller can use it", () => {
  const b = derangerBoard();
  refused(() => playRawAbility(b.engine, P2, b.id("dr"), "lobotomize"));
  assert.equal(b.engine.state.cards[b.id("dr")].depleted, false);
});

// =============================================================================
// Toxic Cultivator
// =============================================================================
// While you control an even number of characters, reduce the numeric cost of your
// tactics by 1, to a minimum of 1.
// Character (cultivator), cost 2, threshold [O][O], 1 strength / 3 speed / 1 life.

const CULTIVATOR = "0467bfd8-73bc-425e-9f6e-44a7f28ff00a";

/** `others` more characters of yours in play next to the Cultivator; tactics of cost 0, 1, 2, 3 and 5 plus a cost-3 item and character in hand. */
function cultivatorBoard(opts: { others?: number; copies?: number; oppChars?: number; faceDownChars?: number; extra?: CardPlacement[]; greed?: number } = {}) {
  const copies = Array.from({ length: opts.copies ?? 1 }, (_, i) => ({ key: i === 0 ? "tc" : `tc${i + 1}`, def: printing(CULTIVATOR), owner: P1 as Pid, zone: "play" as const }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      ...copies,
      ...Array.from({ length: opts.others ?? 1 }, (_, i) => ({ key: `m${i + 1}`, def: character({ name: `M${i + 1}` }), owner: P1 as Pid, zone: "play" as const })),
      ...Array.from({ length: opts.oppChars ?? 0 }, (_, i) => ({ key: `f${i + 1}`, def: character({ name: `F${i + 1}` }), owner: P2 as Pid, zone: "play" as const })),
      ...Array.from({ length: opts.faceDownChars ?? 0 }, (_, i) => ({ key: `fd${i + 1}`, def: character({ name: `FD${i + 1}` }), owner: P1 as Pid, zone: "play" as const, faceDown: true })),
      ...[0, 1, 2, 3, 5].map((cost) => ({ key: `t${cost}`, def: drawTactic(`Tac${cost}`, cost), owner: P1 as Pid, zone: "hand" as const })),
      { key: "itemC", def: item({ name: "ItemC", cost: 3 }), owner: P1, zone: "hand" },
      { key: "charC", def: character({ name: "CharC", cost: 3 }), owner: P1, zone: "hand" },
      { key: "oppTac", def: drawTactic("OppTac3", 3), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", opts.greed ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type CultBoard = ReturnType<typeof cultivatorBoard>;
const costOf = (b: CultBoard, key: string, player: Pid = P1) => b.engine.getCardPlayability(player, b.id(key)).numericCost;
/** The numeric costs of the cost-1, 2, 3 and 5 tactics in hand (the cost-0 one has its own test). */
const tacticCosts = (b: CultBoard) => [1, 2, 3, 5].map((cost) => costOf(b, `t${cost}`));

clause(CULTIVATOR, "0:rule", "with an even number of characters (2) your tactics cost 1 less, to a minimum of 1", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4], "costs 1,2,3,5 -> 1 (already at the minimum), 1 (the minimum), 2, 4");
});

clause(CULTIVATOR, "0:rule", "a cost of 0 stays 0: 'to a minimum of 1' does not raise a value that was already below 1 (CR 410.5)", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "t0"), 0);
});

clause(CULTIVATOR, "0:rule", "a cost-0 tactic is unchanged with an odd count (control for the cost-0 test)", () => {
  const b = cultivatorBoard({ others: 0 });
  assert.equal(costOf(b, "t0"), 0);
});

clause(CULTIVATOR, "0:rule", "a cost of 1 stays 1 and a cost of 2 drops to 1 (the minimum)", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "t1"), 1);
  assert.equal(costOf(b, "t2"), 1);
});

clause(CULTIVATOR, "0:rule", "with an ODD number of characters (the Cultivator alone, or 3) tactics cost their printed cost", () => {
  for (const others of [0, 2]) {
    const b = cultivatorBoard({ others });
    assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], `${others + 1} characters`);
  }
});

clause(CULTIVATOR, "0:rule", "4 characters is even again", () => {
  const b = cultivatorBoard({ others: 3 });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4]);
});

clause(CULTIVATOR, "0:rule", "the reduction really is what you pay: a cost-3 tactic costs 2 resources with 2 characters and 3 with 3", () => {
  const even = cultivatorBoard({ others: 1 });
  const before = ready(even.engine);
  play(even.engine, P1, even.id("t3"));
  assert.equal(before - ready(even.engine), 2);
  const odd = cultivatorBoard({ others: 2 });
  const beforeOdd = ready(odd.engine);
  play(odd.engine, P1, odd.id("t3"));
  assert.equal(beforeOdd - ready(odd.engine), 3);
});

clause(CULTIVATOR, "0:rule", "only tactics are reduced: an item and a character of cost 3 still cost 3", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "itemC"), 3);
  assert.equal(costOf(b, "charC"), 3);
});

clause(CULTIVATOR, "0:rule", "it counts characters YOU control: the opponent's characters do not make the count even", () => {
  const b = cultivatorBoard({ others: 0, oppChars: 1 });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "you control 1 character, they control 1");
  const evenMine = cultivatorBoard({ others: 1, oppChars: 1 });
  assert.deepEqual(tacticCosts(evenMine), [1, 1, 2, 4], "you control 2 characters (their 1 does not matter)");
});

clause(CULTIVATOR, "0:rule", "face-down cards are resources, not characters, so they do not count", () => {
  const b = cultivatorBoard({ others: 0, faceDownChars: 1 });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "1 character plus a face-down resource is still an odd count");
});

clause(CULTIVATOR, "0:rule", "a character you control but do not own counts", () => {
  const b = cultivatorBoard({ others: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4]);
});

clause(CULTIVATOR, "0:rule", "only YOUR tactics are reduced: the opponent's tactic keeps its cost", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "oppTac", P2), 3);
});

clause(CULTIVATOR, "0:rule", "it switches off the moment the count turns odd (a character leaves play) and on again when it is even", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("m1")] } });
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard");
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "one character left: odd");
});

clause(CULTIVATOR, "0:rule", "it stops when the Cultivator itself leaves play", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tc")] } });
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard");
  b.engine.state.cards[b.id("m1")].counters = {};
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "no Cultivator, no reduction (1 character left)");
});

clause(CULTIVATOR, "0:rule", "the reduction needs the Cultivator: without it, an even count changes nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" },
      { key: "t3", def: drawTactic("Tac3", 3), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(b.engine.getCardPlayability(P1, b.id("t3")).numericCost, 3);
});

clause(CULTIVATOR, "0:rule", "a Cultivator in hand reduces nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "tc", def: printing(CULTIVATOR), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
      { key: "t3", def: drawTactic("Tac3", 3), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(b.engine.getCardPlayability(P1, b.id("t3")).numericCost, 3);
});

clause(CULTIVATOR, "0:rule", "two Cultivators (2 characters, an even count) each reduce by 1: a cost-5 tactic costs 3, a cost-2 tactic still costs 1", () => {
  const b = cultivatorBoard({ copies: 2, others: 0 });
  assert.deepEqual(tacticCosts(b), [1, 1, 1, 3], "5 - 2 = 3, 3 - 2 = 1, 2 - 2 -> minimum 1, 1 stays 1");
});

// =============================================================================
// Unnatural Alteration
// =============================================================================
// COST: Play this only during your turn and not during a battle. Pick a character you
// control.
// EFFECT: Destroy the character. If you do, X is that character's numeric cost. Search
// your deck for a character with numeric cost X+3 or less and reveal it. You may play
// that card for free. (You still need the proper resource icons and must pay any
// additional costs.) If you don't, put it into your hand.
// Tactic, cost 4, threshold [O].

const ALTERATION = "c1c2efc5-f032-4c05-89fa-ab3c97a73aba";

function alterationBoard(opts: { sacCost?: number; obsession?: number; active?: Pid; random?: () => number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards: [
      { key: "ua", def: printing(ALTERATION), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sacrifice", cost: opts.sacCost ?? 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      // the deck, top to bottom (with a sacrifice of cost 2, X + 3 = 5)
      { key: "f5", def: character({ name: "Cost5", cost: 5 }), owner: P1, zone: "deck" },
      { key: "f6", def: character({ name: "Cost6", cost: 6 }), owner: P1, zone: "deck" },
      { key: "f1", def: character({ name: "Cost1", cost: 1 }), owner: P1, zone: "deck" },
      { key: "dItem", def: item({ name: "DeckItem", cost: 1 }), owner: P1, zone: "deck" },
      { key: "dTac", def: tactic({ name: "DeckTactic", cost: 0 }), owner: P1, zone: "deck" },
      { key: "dLoc", def: location({ name: "DeckLocation", cost: 0 }), owner: P1, zone: "deck" },
      { key: "fOp", def: character({ name: "NeedsGreed", cost: 0, threshold: "ggg" }), owner: P1, zone: "deck" },
      {
        key: "fTax",
        def: character({ name: "Taxed", cost: 3, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } }),
        owner: P1,
        zone: "deck"
      },
      { key: "theirDeckChar", def: character({ name: "TheirDeckChar", cost: 1 }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type AltBoard = ReturnType<typeof alterationBoard>;
const alterationPlay = (b: AltBoard, sac = "sac") => play(b.engine, P1, b.id("ua"), { selected: { c: [b.id(sac)] } });
const optionByLabel = (b: AltBoard, pattern: RegExp): number => {
  const options = (pending(b.engine) as unknown as { options: Array<{ label?: string }> }).options;
  const index = options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern}`);
  return index;
};

clause(ALTERATION, "0:ability", "pays 4, destroys the picked character of yours, then you search your deck", () => {
  const b = alterationBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("ua"), { selected: { c: [b.id("sac")] } });
  assert.equal(before - ready(b.engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play", "the character is destroyed by the effect, when it resolves");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "destroyed: into its owner's discard pile");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the search");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(b.engine, b.id("ua")), "deploying");
});

clause(ALTERATION, "0:ability", "X = the destroyed character's numeric cost: with cost 2 a character of cost 5 (X+3) may be found, cost 6 may not", () => {
  const b = alterationBoard({ sacCost: 2 });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f6")]), "cost 6 > X+3 = 5");
  pick(b.engine, [b.id("f5")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "a character with lower cost may be found as well (cost 1 <= X+3)", () => {
  const b = alterationBoard({ sacCost: 2 });
  alterationPlay(b);
  pick(b.engine, [b.id("f1")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "X = 4: a sacrificed character of cost 4 allows cost 7 but not cost 8", () => {
  const b = alterationBoard({
    sacCost: 4,
    extra: [
      { key: "f7", def: character({ name: "Cost7", cost: 7 }), owner: P1, zone: "deck" },
      { key: "f8", def: character({ name: "Cost8", cost: 8 }), owner: P1, zone: "deck" }
    ]
  });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f8")]), "cost 8 > X+3 = 7");
  pick(b.engine, [b.id("f7")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "X = 0 (a sacrificed character of cost 0): only characters of cost 3 or less, cost 5 is refused", () => {
  const b = alterationBoard({ sacCost: 0 });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f5")]), "cost 5 > X+3 = 3");
  pick(b.engine, [b.id("f1")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "the card found must be a CHARACTER from YOUR deck: an item, a tactic, a location and the opponent's deck are refused", () => {
  const b = alterationBoard();
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("dItem")]), "an item");
  refused(() => pickRaw(b.engine, [b.id("dTac")]), "a tactic");
  refused(() => pickRaw(b.engine, [b.id("dLoc")]), "a location");
  refused(() => pickRaw(b.engine, [b.id("theirDeckChar")]), "the opponent's deck");
  refused(() => pickRaw(b.engine, [b.id("other")]), "a character in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still searching");
  pick(b.engine, [b.id("f5")]);
});

clause(ALTERATION, "0:ability", "'you may play that card for free': playing it puts it into play without paying its cost number", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  const readyBefore = ready(b.engine);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /free|play|deploy/i) });
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  answerPending(b.engine, "deployForFree", { cardId: b.id("f5") });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("f5")), "play", "the found character is in play");
  assert.equal(ready(b.engine), readyBefore, "its cost number of 5 was not paid");
  assert.equal(handOf(b.engine, P1).includes(b.id("f5")), false, "and it did not go to the hand as well");
});

clause(ALTERATION, "0:ability", "'if you don't (play it), put it into your hand'", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /hand/i) });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("f5")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("f5")), "handOf(b.engine, P1).includes(b.id(\"f5\"))");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard", "the tactic resolved");
});

clause(ALTERATION, "0:ability", "deciding to play it but then declining the free deploy leaves the card in your hand ('if you don't')", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /free|play|deploy/i) });
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  answerPending(b.engine, "deployForFree", {});
  assert.equal(zoneOf(b.engine, b.id("f5")), "hand", "you did not play it, so it goes into your hand");
});

clause(ALTERATION, "0:ability", "'You still need the proper resource icons': a found character whose threshold you do not meet cannot be played for free", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("fOp")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /free|play|deploy/i) });
  if (pending(b.engine)?.kind === "deployForFree") {
    refused(() => answerPending(b.engine, "deployForFree", { cardId: b.id("fOp") }), "[G][G][G] is not met");
    assert.notEqual(zoneOf(b.engine, b.id("fOp")), "play");
  } else {
    assert.notEqual(zoneOf(b.engine, b.id("fOp")), "play", "it was not played");
  }
});

clause(ALTERATION, "0:ability", "a free deploy that the icons allow does work (the threshold is met)", () => {
  const b = alterationBoard({ extra: bank("greed", 3, P1) });
  alterationPlay(b);
  pick(b.engine, [b.id("fOp")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /free|play|deploy/i) });
  answerPending(b.engine, "deployForFree", { cardId: b.id("fOp") });
  assert.equal(zoneOf(b.engine, b.id("fOp")), "play");
});

clause(ALTERATION, "0:ability", "'must pay any additional costs': a found character with an extra cost still pays it when played for free", () => {
  const b = alterationBoard();
  const influence = b.engine.state.players[P1].influence;
  alterationPlay(b);
  pick(b.engine, [b.id("fTax")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /free|play|deploy/i) });
  answerPending(b.engine, "deployForFree", { cardId: b.id("fTax") });
  assert.equal(zoneOf(b.engine, b.id("fTax")), "play");
  assert.equal(b.engine.state.players[P1].influence, influence - 2, "its extra cost (lose 2 influence) was paid");
});

clause(ALTERATION, "0:ability", "'search ... You may': finding nothing still destroys the character, and nothing enters your hand or play", () => {
  const b = alterationBoard();
  const handBefore = [...handOf(b.engine, P1)].filter((c) => c !== b.id("ua"));
  alterationPlay(b);
  pick(b.engine, []);
  // (whatever the engine asks next, there is no card to play or take)
  if (pending(b.engine)?.kind === "chooserSelectsOption") answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /hand/i) });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
});

clause(ALTERATION, "0:ability", "finding nothing leaves nothing to play or take: no 'play it for free / put it into your hand' question is asked", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "no card was found, so there is nothing to decide about");
});

clause(ALTERATION, "0:ability", "no character of cost X+3 or less in the deck: nothing to find, the character is still destroyed", () => {
  const b = alterationBoard({ sacCost: 0, extra: [] });
  for (const key of ["f5", "f6", "f1", "fOp", "fTax"]) {
    b.engine.state.cards[b.id(key)].zone = "discard";
    b.engine.state.players[P1].deck = b.engine.state.players[P1].deck.filter((c) => c !== b.id(key));
    b.engine.state.players[P1].discard.push(b.id(key));
  }
  alterationPlay(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to search for");
});

clause(ALTERATION, "0:ability", "'If you do': if the picked character left play in response (so it was not destroyed) nothing is searched for", () => {
  const b = alterationBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("ua"), { selected: { c: [b.id("sac")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("sac")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "hand", "the character was returned to its owner's hand in response");
  assert.equal(b.engine.state.pendingChoice, undefined, "it was not destroyed, so there is no search");
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard");
});

clause(ALTERATION, "0:ability", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const b = alterationBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  answerPending(b.engine, "chooserSelectsOption", { index: optionByLabel(b, /hand/i) });
  const unshuffled = before.filter((c) => c !== b.id("f5"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.notDeepEqual(deckOf(b.engine, P1), unshuffled, "but their order changed: the deck was shuffled");
});

clause(ALTERATION, "0:ability", "the found character is revealed", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f1")]);
  const reveal = b.engine
    .getLog()
    .map((entry) => entry.event)
    .find((event) => event?.type === "cardsRevealed" && event.cardIds.includes(b.id("f1")));
  assert.ok(reveal && reveal.type === "cardsRevealed", "reveal && reveal.type === \"cardsRevealed\"");
  assert.equal(reveal.viewerId, "all");
});

clause(ALTERATION, "0:ability", "the picked card must be a character YOU control: an opponent's character, items and locations are refused", () => {
  const b = alterationBoard();
  const attempt = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [cardId] } });
  refused(attempt(b.id("foe")), "the opponent's character");
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "your faction");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  attempt(b.id("other"))();
  assert.ok(b.engine.state.responseWindow, "your own character is accepted");
});

clause(ALTERATION, "0:ability", "exactly one character is picked (none, or two, is refused)", () => {
  const b = alterationBoard();
  refused(() => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("ua"), {}), "no declaration");
  refused(() => playRaw(b.engine, P1, b.id("ua"), { selected: { c: ids2(b, ["sac", "other"]) } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
});

clause(ALTERATION, "0:ability", "'Play this only during your turn': refused as a response on the opponent's turn", () => {
  const theirTurn = alterationBoard({ active: P2, extra: [{ key: "pump", def: pumpTactic(1), owner: P2, zone: "hand" }] });
  playRaw(theirTurn.engine, P2, theirTurn.id("pump"), { selected: { t: [theirTurn.id("foe")] } });
  assert.equal(theirTurn.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond with a tactic");
  refused(() => playRaw(theirTurn.engine, P1, theirTurn.id("ua"), { selected: { c: [theirTurn.id("sac")] } }), "not during the opponent's turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("ua")), "hand");
  assert.equal(theirTurn.engine.getCardPlayability(P1, theirTurn.id("ua")).playable, false);
  const myTurn = alterationBoard();
  assert.equal(myTurn.engine.getCardPlayability(P1, myTurn.id("ua")).playable, true, "control: playable on your own turn");
});

clause(ALTERATION, "0:ability", "'and not during a battle': refused while a battle is going on, allowed again once it is over", () => {
  const b = alterationBoard({ extra: [{ key: "atk", def: character({ name: "Atk", cost: 1 }), owner: P1, zone: "play" }] });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(b.engine), "a battle is on");
  refused(() => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [b.id("sac")] } }), "during a battle");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
  alterationPlay(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "control: after the battle it works");
});

clause(ALTERATION, "0:ability", "is refused one resource short of its cost of 4, and without [O] even with plenty of other resources", () => {
  const short = alterationBoard({ obsession: 3 });
  refused(() => playRaw(short.engine, P1, short.id("ua"), { selected: { c: [short.id("sac")] } }), "3 resources for a cost of 4");
  const noThreshold = alterationBoard({ obsession: 0, extra: bank("greed", 6, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ua"), { selected: { c: [noThreshold.id("sac")] } }), "no [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ua")), "hand");
  const ok = alterationBoard({ obsession: 1, extra: bank("greed", 3, P1) });
  alterationPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("sac")), "discard");
});

// =============================================================================
// Near misses: triggers that must NOT fire for another card, the wrong event or the wrong target
// =============================================================================

clause(GNAT, "0:rule", "another character leaving play does not trigger it", () => {
  const b = gnatBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("other")] } });
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "the Gnat stayed in play: nobody discards");
  assert.equal(zoneOf(b.engine, b.id("gnat")), "play");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(ARMCHAIR, "0:rule", "another character leaving play does not trigger it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "chair", def: printing(ARMCHAIR), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("other")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("chair")), "play");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "no card was drawn");
});

clause(MILLIPEDE, "1:rule", "another character entering play does not trigger it (only the Millipede itself entering does)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "play" },
      { key: "newGuy", def: character({ name: "NewGuy", cost: 1 }), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("newGuy"));
  assert.equal(zoneOf(b.engine, b.id("newGuy")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick is offered");
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
});

clause(SUIT, "1:rule", "another Suit entering play does not put a token on the first Suit's host", () => {
  const b = suitBoard({ obsession: 3, extra: [{ key: "suit0", def: printing(SUIT), owner: P1, zone: "play", attachedToKey: "mine" }] });
  suitPlay(b, "mine2");
  assert.equal(tokensOn(b.engine, b.id("mine2")), 1, "the new Suit's host gets its token");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0, "the first Suit's host gets none");
});

clause(MUDDLER, "1:rule", "damage to a LOCATION is not damage to a faction: attacking the opponent's location does not trigger it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mud", def: printing(MUDDLER), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 9 }), owner: P2, zone: "play" },
      ...fillers("oh", 2, P2, "hand"),
      ...fillers("ph", 2, P1, "hand")
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("mud")], { type: "card", cardId: b.id("loc") });
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("loc")].damage, 2, "the Muddler damaged the location");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P2).length, 2, "and nothing went back");
});

clause(ARO, "0:rule", "a character that already has COVERT can be picked and simply stays covert (a card has only one instance of the keyword, CR 507.3e)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "aro", def: printing(ARO), owner: P1, zone: "play" },
      { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("sneak")]);
  assert.equal((b.engine.getKeywords(b.id("sneak")) as string[]).filter((keyword) => keyword === "covert").length, 1, "COVERT appears once");
});

// @@APPEND@@
