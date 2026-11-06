// Clause tests — batch seed-3-01, part p1 (groups 1-7: Cowslaw, Devilfang
// Thunderhoof, Geiseric the Souleater, God's Autograph, Pony Slaystation,
// Spatchcocking, The Stone of Shame). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-3-01`. Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { fight, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ obsession: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** `getStat` for a stat that may be undefined on the definition. */
const stat = (engine: SpoilsEngine, id: CardInstanceId, name: "strength" | "speed" | "life" | "structure"): number | undefined =>
  engine.getStat(id, name) as number | undefined;

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
const pickTargets = (selected: CardInstanceId[]) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc);

// =====================================================================================
// Cowslaw
// =====================================================================================

const COWSLAW = "0833ee0d-bce2-43b5-bb59-c01271b2aad5"; // tactic, cost 1, threshold o -- COST: Choose X > 0. Remove X tactics in your discard pile from the game. -- EFFECT: You may search your deck for a tactic with numeric cost X or less and reveal it. If you do, put it into your hand. -- FLIP UP: 1 [O] and draw a card.

interface CowOpts {
  /** Where Cowslaw is. */
  cow?: "hand" | "discard" | "play" | "deck";
  res?: Icons;
  random?: () => number;
}

/**
 * Cowslaw plus: own tactics d0..d2 in my discard (and a character "dchar"), the opponent's tactic "odisc" in their discard,
 * a deck of tactics t0 (cost 0), t1 (cost 1), t2 (cost 2), t3 (cost 3), a character "dc" and an item "di", the opponent's deck tactic "ot1" (cost 1),
 * a tactic "htac" (cost 1) in my hand, and filler cards underneath.
 */
function cowBoard(o: CowOpts = {}) {
  return devBoard(
    [
      { key: "cow", def: printing(COWSLAW), owner: P1, zone: o.cow ?? "hand" },
      { key: "d0", def: tactic({ name: "Discarded 0", cost: 1 }), owner: P1, zone: "discard" },
      { key: "d1", def: tactic({ name: "Discarded 1", cost: 1 }), owner: P1, zone: "discard" },
      { key: "d2", def: tactic({ name: "Discarded 2", cost: 1 }), owner: P1, zone: "discard" },
      { key: "dchar", def: character({ name: "Discarded Char" }), owner: P1, zone: "discard" },
      { key: "odisc", def: tactic({ name: "Opp Discarded", cost: 1 }), owner: P2, zone: "discard" },
      { key: "t0", def: tactic({ name: "Tac Zero", cost: 0 }), owner: P1, zone: "deck" },
      { key: "dc", def: character({ name: "Deck Char", cost: 1 }), owner: P1, zone: "deck" },
      { key: "t1", def: tactic({ name: "Tac One", cost: 1 }), owner: P1, zone: "deck" },
      { key: "t2", def: tactic({ name: "Tac Two", cost: 2 }), owner: P1, zone: "deck" },
      { key: "di", def: item({ name: "Deck Item", cost: 1 }), owner: P1, zone: "deck" },
      { key: "t3", def: tactic({ name: "Tac Three", cost: 3 }), owner: P1, zone: "deck" },
      ...fillers("f", 6, P1, "deck"),
      { key: "ot1", def: tactic({ name: "Opp Deck Tac", cost: 1 }), owner: P2, zone: "deck" },
      ...fillers("of", 3, P2, "deck"),
      { key: "htac", def: tactic({ name: "Hand Tac", cost: 1 }), owner: P1, zone: "hand" },
      ...res(o.res ?? { obsession: 3 })
    ],
    { random: o.random }
  );
}
type CowGame = ReturnType<typeof cowBoard>;

const castCow = (g: CowGame, x: number, fodder: string[], search: string[]): void =>
  play(g.engine, P1, g.id("cow"), { variables: { x }, selected: { fodder: fodder.map(g.id), search: search.map(g.id) } });

clause(COWSLAW, "0:ability", "X=1: one tactic from my discard pile is removed from the game, the searched tactic of cost 1 goes to my hand, and Cowslaw ends in my discard pile", () => {
  const g = cowBoard();
  castCow(g, 1, ["d0"], ["t1"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed", "the fodder is removed from the game, not discarded");
  assert.equal(zoneOf(g.engine, g.id("d1")), "discard", "other discarded tactics are untouched");
  assert.equal(zoneOf(g.engine, g.id("d2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("t1")), "hand", "the found tactic is put into my hand");
  assert.equal(zoneOf(g.engine, g.id("cow")), "discard");
  assert.equal(handOf(g.engine, P1).length, 2, "Hand Tac plus the found tactic");
});

clause(COWSLAW, "0:ability", "X=2: exactly two tactics are removed from the game, and a tactic with numeric cost 2 can be searched for", () => {
  const g = cowBoard();
  castCow(g, 2, ["d0", "d2"], ["t2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed");
  assert.equal(zoneOf(g.engine, g.id("d2")), "removed");
  assert.equal(zoneOf(g.engine, g.id("d1")), "discard", "the tactic that was not chosen stays in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("t2")), "hand");
});

clause(COWSLAW, "0:ability", "X=3: three tactics are removed from the game, and a cost-3 tactic can be searched for", () => {
  const g = cowBoard();
  castCow(g, 3, ["d0", "d1", "d2"], ["t3"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["d0", "d1", "d2"]) assert.equal(zoneOf(g.engine, g.id(k)), "removed", k);
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

clause(COWSLAW, "0:ability", "the printed cost of 1 is paid", () => {
  const g = cowBoard();
  const before = ready(g.engine);
  castCow(g, 1, ["d0"], ["t1"]);
  assert.equal(before - ready(g.engine), 1);
});

clause(COWSLAW, "0:ability", "the extra cost is paid when Cowslaw is deployed: the fodder is already gone while the card waits for responses", () => {
  const g = cowBoard();
  playRaw(g.engine, P1, g.id("cow"), { variables: { x: 2 }, selected: { fodder: [g.id("d0"), g.id("d1")], search: [g.id("t1")] } });
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed");
  assert.equal(zoneOf(g.engine, g.id("d1")), "removed");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck", "the search has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("t1")), "hand");
});

clause(COWSLAW, "0:ability", "X must be greater than 0: 0 and negative numbers are refused, 1 is accepted", () => {
  for (const x of [0, -1]) {
    const g = cowBoard();
    refused(() => castCow(g, x, [], ["t0"]), `X=${x}: X must be greater than 0 (the same board plays at X=1 below)`, /cannot be deployed right now|whole number/);
    assert.equal(zoneOf(g.engine, g.id("t0")), "deck", `X=${x}: nothing was searched`);
    assert.equal(zoneOf(g.engine, g.id("cow")), "hand");
  }
  const ok = cowBoard();
  castCow(ok, 1, ["d0"], ["t0"]);
  assert.equal(zoneOf(ok.engine, ok.id("t0")), "hand");
});

clause(COWSLAW, "0:ability", "X is a number: a fractional X is refused", () => {
  const g = cowBoard();
  refused(() => castCow(g, 1.5, ["d0"], ["t1"]), "X=1.5");
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("cow")), "hand");
});

clause(COWSLAW, "0:ability", "exactly X tactics must be removed: one too few or one too many is refused", () => {
  const few = cowBoard();
  refused(() => castCow(few, 2, ["d0"], ["t1"]), "X=2 with one tactic");
  assert.equal(zoneOf(few.engine, few.id("d0")), "discard");
  const none = cowBoard();
  refused(() => castCow(none, 1, [], ["t1"]), "X=1 with no tactic");
  const many = cowBoard();
  refused(() => castCow(many, 1, ["d0", "d1"], ["t1"]), "X=1 with two tactics");
  assert.equal(zoneOf(many.engine, many.id("d0")), "discard");
  assert.equal(zoneOf(many.engine, many.id("d1")), "discard");
});

clause(COWSLAW, "0:ability", "X cannot exceed the tactics in my discard pile", () => {
  const g = devBoard([
    { key: "cow", def: printing(COWSLAW), owner: P1, zone: "hand" },
    { key: "d0", def: tactic({ name: "Only One", cost: 1 }), owner: P1, zone: "discard" },
    { key: "t0", def: tactic({ name: "Tac Zero", cost: 0 }), owner: P1, zone: "deck" },
    ...res({ obsession: 3 })
  ]);
  refused(() => castCow(g as CowGame, 2, ["d0"], ["t0"]), "X=2 with one tactic available");
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
  castCow(g as CowGame, 1, ["d0"], ["t0"]);
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed");
});

clause(COWSLAW, "0:ability", "only tactics in MY discard pile can be removed: characters, the opponent's tactics, and tactics in other zones are refused", () => {
  const fodderFor = (key: string) => () => {
    const g = cowBoard();
    refused(() => castCow(g, 1, [key], ["t1"]), key);
    assert.equal(zoneOf(g.engine, g.id("t1")), "deck", `${key}: nothing was found`);
    assert.equal(zoneOf(g.engine, g.id("cow")), "hand");
  };
  fodderFor("dchar")(); // a character in my discard pile
  fodderFor("odisc")(); // the opponent's tactic in their discard pile
  fodderFor("htac")(); // a tactic in my hand
  fodderFor("t0")(); // a tactic in my deck
  const ok = cowBoard();
  castCow(ok, 1, ["d1"], ["t1"]);
  assert.equal(zoneOf(ok.engine, ok.id("d1")), "removed");
  assert.equal(zoneOf(ok.engine, ok.id("odisc")), "discard");
});

clause(COWSLAW, "0:ability", "the search finds a tactic of cost X or less: cost 0 and cost 1 for X=2 are fine, cost 3 for X=2 is refused", () => {
  for (const key of ["t0", "t1", "t2"]) {
    const g = cowBoard();
    castCow(g, 2, ["d0", "d1"], [key]);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} (cost <= 2)`);
  }
  const g = cowBoard();
  refused(() => castCow(g, 2, ["d0", "d1"], ["t3"]), "cost 3 with X=2");
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard", "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("t3")), "deck");
});

clause(COWSLAW, "0:ability", "for X=1, tactics of cost 2 and 3 cannot be searched for", () => {
  for (const key of ["t2", "t3"]) {
    const g = cowBoard();
    refused(() => castCow(g, 1, ["d0"], [key]), key);
    assert.equal(zoneOf(g.engine, g.id(key)), "deck");
  }
});

clause(COWSLAW, "0:ability", "only tactics can be searched for: a character and an item in my deck, a tactic in my discard pile or hand, and the opponent's deck tactic are refused", () => {
  for (const key of ["dc", "di", "d1", "htac", "ot1"]) {
    const g = cowBoard();
    refused(() => castCow(g, 1, ["d0"], [key]), key);
    assert.equal(zoneOf(g.engine, g.id("d0")), "discard", `${key}: nothing was paid`);
  }
});

clause(COWSLAW, "0:ability", "'numeric cost' is the printed cost number (CR 406.1/406.2): a tactic with no printed cost counts as cost 0, and an in-play reducer does not lower a tactic's numeric cost in the deck", () => {
  const reducer = character({
    name: "Tactic Discounter",
    behavior: {
      abilities: [{ id: "disc", type: "continuous", modifiers: [], costModifiers: [{ affects: "controller", delta: -1, selector: { zone: "any", type: "tactic" } }] }]
    }
  });
  const build = () =>
    devBoard([
      { key: "cow", def: printing(COWSLAW), owner: P1, zone: "hand" },
      { key: "d0", def: tactic({ name: "Discarded 0", cost: 1 }), owner: P1, zone: "discard" },
      { key: "none", def: { ...tactic({ name: "No Cost Tactic" }), cost: undefined as unknown as number }, owner: P1, zone: "deck" },
      { key: "two", def: tactic({ name: "Printed Two", cost: 2 }), owner: P1, zone: "deck" },
      { key: "one", def: tactic({ name: "Printed One", cost: 1 }), owner: P1, zone: "deck" },
      ...fillers("f", 4, P1, "deck"),
      { key: "disc", def: reducer, owner: P1, zone: "play" },
      ...res({ obsession: 3 })
    ]);
  // a tactic with no printed cost has numeric cost 0, so it is found for X=1
  const a = build();
  castCow(a as CowGame, 1, ["d0"], ["none"]);
  assert.equal(zoneOf(a.engine, a.id("none")), "hand", "no printed cost = numeric cost 0 (CR 406.2)");
  // a tactic of printed cost 1 is found for X=1 (positive control)
  const b = build();
  castCow(b as CowGame, 1, ["d0"], ["one"]);
  assert.equal(zoneOf(b.engine, b.id("one")), "hand");
  // printed cost 2 is not <= 1, even though my in-play reducer makes it cost 1 to deploy
  const c = build();
  refused(() => castCow(c as CowGame, 1, ["d0"], ["two"]), "printed cost 2 with X=1 despite a reducer", /search|target|cost/i);
  assert.equal(zoneOf(c.engine, c.id("two")), "deck");
  assert.equal(zoneOf(c.engine, c.id("d0")), "discard", "nothing was paid");
});

clause(COWSLAW, "0:ability", "searches for ONE tactic: choosing two is refused", () => {
  const g = cowBoard();
  refused(() => castCow(g, 1, ["d0"], ["t0", "t1"]), "two tactics");
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck");
});

clause(COWSLAW, "0:ability", "'you may search': declining finds nothing, but the X tactics were already removed and Cowslaw is spent", () => {
  const g = cowBoard();
  const handBefore = handOf(g.engine, P1);
  castCow(g, 1, ["d0"], []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed", "the cost is paid regardless");
  assert.deepEqual(handOf(g.engine, P1).sort(), handBefore.filter((c) => c !== g.id("cow")).sort(), "no card was added to my hand");
  for (const k of ["t0", "t1", "t2", "t3"]) assert.equal(zoneOf(g.engine, g.id(k)), "deck", k);
  assert.equal(zoneOf(g.engine, g.id("cow")), "discard");
});

clause(COWSLAW, "0:ability", "the found tactic is revealed to everyone", () => {
  const g = cowBoard();
  castCow(g, 1, ["d0"], ["t1"]);
  const reveals = g.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [g.id("t1")], "the tactic that was found");
  assert.equal(ev.viewerId, "all");
});

clause(COWSLAW, "0:ability", "only the searched card moves: the rest of my deck and the opponent's cards are unaffected (as a set)", () => {
  const g = cowBoard({ random: () => 0 });
  const mineBefore = deckOf(g.engine, P1);
  const theirsBefore = deckOf(g.engine, P2);
  const theirHand = handOf(g.engine, P2);
  castCow(g, 1, ["d0"], ["t1"]);
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), mineBefore.filter((c) => c !== g.id("t1")).sort(), "exactly the found card left my deck");
  assert.deepEqual(deckOf(g.engine, P2), theirsBefore, "the opponent's deck is untouched, in order");
  assert.deepEqual(handOf(g.engine, P2), theirHand);
  assert.equal(zoneOf(g.engine, g.id("odisc")), "discard");
});

clause(COWSLAW, "0:ability", "my deck is shuffled afterwards (CR 312.1) when a tactic is found", () => {
  const g = cowBoard({ random: () => 0 });
  const before = deckOf(g.engine, P1);
  castCow(g, 1, ["d0"], ["t1"]);
  const unshuffled = before.filter((c) => c !== g.id("t1"));
  assert.notDeepEqual(deckOf(g.engine, P1), unshuffled, "the order changed: shuffled");
});

clause(COWSLAW, "0:ability", "my deck is shuffled afterwards (CR 312.1) even when I choose to find nothing", () => {
  const g = cowBoard({ random: () => 0 });
  const before = deckOf(g.engine, P1);
  castCow(g, 1, ["d0"], []);
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(deckOf(g.engine, P1), before, "the order changed: shuffled");
});

clause(COWSLAW, "0:ability", "the cost of 1 [O] must be affordable and its threshold [O] met", () => {
  const poor = cowBoard({ res: {} });
  refused(() => castCow(poor, 1, ["d0"], ["t1"]), "no resources");
  assert.equal(zoneOf(poor.engine, poor.id("d0")), "discard");
  const wrongIcon = cowBoard({ res: { rage: 3 } });
  refused(() => castCow(wrongIcon, 1, ["d0"], ["t1"]), "no [O]");
  assert.equal(zoneOf(wrongIcon.engine, wrongIcon.id("d0")), "discard");
  const ok = cowBoard({ res: { obsession: 1 } });
  castCow(ok, 1, ["d0"], ["t1"]);
  assert.equal(zoneOf(ok.engine, ok.id("t1")), "hand");
});

clause(COWSLAW, "0:ability", "cannot be deployed from the discard pile (a tactic is deployed from hand)", () => {
  const g = cowBoard({ cow: "discard" });
  refused(() => castCow(g, 1, ["d0"], ["t1"]), "from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
});

// --- FLIP UP: 1 [O] and draw a card ---------------------------------------------------
// CR 507.4: flipping a face-down card up plays it as though from hand, paying the FLIP UP cost; "and draw a card" is
// a FLIP UP extra cost (507.4c), after which Cowslaw resolves like the tactic it is (choose X, remove X tactics, search).

interface FlipOpts {
  res?: Icons;
  cow?: "faceDown" | "hand";
}

function cowFlipBoard(o: FlipOpts = {}) {
  return devBoard([
    o.cow === "hand"
      ? { key: "cow", def: printing(COWSLAW), owner: P1, zone: "hand" }
      : { key: "cow", def: printing(COWSLAW), owner: P1, zone: "play", faceDown: true },
    { key: "d0", def: tactic({ name: "Discarded 0", cost: 1 }), owner: P1, zone: "discard" },
    { key: "d1", def: tactic({ name: "Discarded 1", cost: 1 }), owner: P1, zone: "discard" },
    ...fillers("f", 4, P1, "deck"),
    { key: "t1", def: tactic({ name: "Tac One", cost: 1 }), owner: P1, zone: "deck" },
    { key: "t2", def: tactic({ name: "Tac Two", cost: 2 }), owner: P1, zone: "deck" },
    ...fillers("of", 3, P2, "deck"),
    ...res(o.res ?? { obsession: 2 })
  ]);
}
type FlipGame = ReturnType<typeof cowFlipBoard>;

const flipCow = (g: FlipGame, x: number, fodder: string[], search: string[]): void => {
  flipUpRaw(g.engine, P1, g.id("cow"), { fodder: fodder.map(g.id), search: search.map(g.id) }, { x });
  resolvePendingResponses(g.engine);
};

clause(COWSLAW, "1:flipUp", "a face-down Cowslaw is a resource in my pool", () => {
  const g = cowFlipBoard();
  assert.equal(g.engine.isResource(g.id("cow")), true);
  assert.equal(ready(g.engine), 3, "two Obsession plus the face-down Cowslaw");
});

clause(COWSLAW, "1:flipUp", "FLIP UP draws exactly one card: the top card of my deck is in my hand, and Cowslaw ends in my discard pile", () => {
  const g = cowFlipBoard();
  const top = deckOf(g.engine, P1)[0];
  const deckBefore = deckOf(g.engine, P1).length;
  flipCow(g, 1, ["d0"], ["t1"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "hand", "the top card of my deck was drawn");
  assert.equal(handOf(g.engine, P1).length, 2, "the drawn card plus the searched tactic");
  assert.equal(deckOf(g.engine, P1).length, deckBefore - 2, "exactly one card drawn and one found");
  assert.equal(zoneOf(g.engine, g.id("cow")), "discard");
  assert.equal(g.engine.state.cards[g.id("cow")].faceDown, false);
});

clause(COWSLAW, "1:flipUp", "the flipped-up Cowslaw resolves as the tactic: X tactics are removed from the game and a tactic of cost X or less is found", () => {
  const g = cowFlipBoard();
  flipCow(g, 2, ["d0", "d1"], ["t2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d0")), "removed");
  assert.equal(zoneOf(g.engine, g.id("d1")), "removed");
  assert.equal(zoneOf(g.engine, g.id("t2")), "hand");
});

clause(COWSLAW, "1:flipUp", "the flipped-up tactic keeps its restrictions: X must be greater than 0, X tactics must be removed, and the search is limited to cost X or less", () => {
  const zero = cowFlipBoard();
  refused(() => flipCow(zero, 0, [], ["t1"]), "X=0: X must be greater than 0 (the same board flips at X=1, below)", /cannot be flipped up right now/);
  const oneOk = cowFlipBoard();
  flipCow(oneOk, 1, ["d0"], ["t1"]);
  assert.equal(zoneOf(oneOk.engine, oneOk.id("t1")), "hand", "control: X=1 on the same board flips up");
  assert.equal(zero.engine.state.cards[zero.id("cow")].faceDown, true, "still face-down");
  const wrongCount = cowFlipBoard();
  refused(() => flipCow(wrongCount, 2, ["d0"], ["t1"]), "X=2 with one tactic");
  assert.equal(zoneOf(wrongCount.engine, wrongCount.id("d0")), "discard");
  const tooBig = cowFlipBoard();
  refused(() => flipCow(tooBig, 1, ["d0"], ["t2"]), "cost 2 tactic with X=1");
  assert.equal(zoneOf(tooBig.engine, tooBig.id("t2")), "deck");
  assert.equal(tooBig.engine.state.cards[tooBig.id("cow")].faceDown, true);
});

clause(COWSLAW, "1:flipUp", "FLIP UP pays 1 and no more: at most one other resource is spent, the rest stay ready", () => {
  const g = cowFlipBoard({ res: { obsession: 3 } });
  assert.equal(ready(g.engine), 4, "three Obsession plus the face-down Cowslaw");
  flipCow(g, 1, ["d0"], ["t1"]);
  const spent = g.engine.state.players[P1].play.filter((c) => g.engine.state.cards[c].attachedTo !== undefined && g.engine.isResource(c)).length;
  assert.ok(spent <= 1, `at most one resource is spent (Cowslaw may pay for itself), got ${spent}`);
  assert.equal(ready(g.engine), 3 - spent, "Cowslaw left the pool; nothing else changed");
});

clause(COWSLAW, "1:flipUp", "FLIP UP needs [O]: with only other icons or only the opponent's [O] it is refused (the card stays face-down), with one [O] it is accepted", () => {
  const wrong = cowFlipBoard({ res: { rage: 3 } });
  refused(() => flipCow(wrong, 1, ["d0"], ["t1"]), "no [O]");
  assert.equal(wrong.engine.state.cards[wrong.id("cow")].faceDown, true, "still face-down");
  assert.equal(zoneOf(wrong.engine, wrong.id("cow")), "play");
  assert.equal(zoneOf(wrong.engine, wrong.id("d0")), "discard");
  const opp = devBoard([
    { key: "cow", def: printing(COWSLAW), owner: P1, zone: "play", faceDown: true },
    { key: "d0", def: tactic({ name: "Discarded 0", cost: 1 }), owner: P1, zone: "discard" },
    ...fillers("f", 3, P1, "deck"),
    ...res({ rage: 2 }),
    ...res({ obsession: 3 }, P2)
  ]);
  refused(() => flipUpRaw(opp.engine, P1, opp.id("cow"), {}, { x: 1 }), "the opponent's [O] do not count");
  const ok = cowFlipBoard({ res: { obsession: 1 } });
  flipCow(ok, 1, ["d0"], ["t1"]);
  assert.equal(zoneOf(ok.engine, ok.id("cow")), "discard");
  assert.equal(zoneOf(ok.engine, ok.id("t1")), "hand");
});

clause(COWSLAW, "1:flipUp", "its own Volition does not provide the [O]: a lone face-down Cowslaw cannot flip itself up", () => {
  const g = cowFlipBoard({ res: {} });
  refused(() => flipCow(g, 1, ["d0"], ["t1"]), "no [O] besides itself");
  assert.equal(g.engine.state.cards[g.id("cow")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
});

clause(COWSLAW, "1:flipUp", "only a face-down Cowslaw can be flipped up: one in my hand is refused", () => {
  const g = cowFlipBoard({ cow: "hand" });
  const top = deckOf(g.engine, P1)[0];
  refused(() => flipCow(g, 1, ["d0"], ["t1"]), "FLIP UP from hand");
  assert.equal(zoneOf(g.engine, top), "deck", "nothing was drawn");
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
});

// =====================================================================================
// Devilfang Thunderhoof
// =====================================================================================

const THUNDER = "186b8e6c-7c64-42e9-b885-bf7b26fdf387"; // character, cost 5, threshold o, str 1 / spd 3 / life 4 -- UNIQUE THUNDERHOOF -- ETB tokens = [O] you control -- +1 strength per token -- DISRUPT: Pay 2. Remove a token. Pick an opponent. Your opponent discards a card.

/** Thunderhoof in hand with `mine` resources (cost 5 means five are spent); the opponent has resources `theirs` and cards to discard. */
function thunderHandBoard(mine: Icons, theirs: Icons = {}, extra: CardPlacement[] = []) {
  return devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "hand" },
    { key: "oc", def: character({ name: "Other Char", cost: 0 }), owner: P1, zone: "hand" },
    ...res(mine),
    ...res(theirs, P2),
    ...extra
  ]);
}

const uniqueBoard = (oldCounters: Record<string, number> = { token: 2 }) =>
  devBoard([
    { key: "old", def: printing(THUNDER), owner: P1, zone: "play", counters: oldCounters },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);

const keepSurvivor = (engine: SpoilsEngine, keep: CardInstanceId): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);

clause(THUNDER, "0:unique", "has UNIQUE THUNDERHOOF: a second Thunderhoof under my control makes me choose one to keep; keeping the new one destroys the old one", () => {
  const g = uniqueBoard();
  play(g.engine, P1, g.id("new"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("old"), g.id("new")].sort());
  keepSurvivor(g.engine, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "discard", "the extra copy is destroyed");
});

clause(THUNDER, "0:unique", "I can keep the older Thunderhoof instead; the new one is destroyed", () => {
  const g = uniqueBoard();
  play(g.engine, P1, g.id("new"));
  expectPending(g.engine, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("old"));
  assert.equal(zoneOf(g.engine, g.id("old")), "play");
  assert.equal(zoneOf(g.engine, g.id("new")), "discard");
  assert.equal(tokensOn(g.engine, g.id("old")), 2, "the survivor keeps its tokens");
});

clause(THUNDER, "0:unique", "only a card in the pending choice can be kept: an unrelated card is refused", () => {
  const g = devBoard([
    { key: "old", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    { key: "by", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(g.engine, P1, g.id("new"));
  expectPending(g.engine, "uniqueSurvivor");
  refused(() => keepSurvivor(g.engine, g.id("by")), "a bystander cannot be the survivor", /unique|survivor|candidate|keep|choice/i);
  assert.equal(zoneOf(g.engine, g.id("by")), "play");
  expectPending(g.engine, "uniqueSurvivor");
});

clause(THUNDER, "0:unique", "after I choose which Thunderhoof to keep, the deployment finishes: the response window closes and the game goes on", () => {
  const g = uniqueBoard();
  play(g.engine, P1, g.id("new"));
  expectPending(g.engine, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("new"));
  resolvePendingResponses(g.engine); // soft-locks: 'did not converge'
  assert.equal(g.engine.state.responseWindow, undefined, "no stuck response window");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(THUNDER, "0:unique", "the identifier is THUNDERHOOF: another card carrying UNIQUE THUNDERHOOF also counts, a different identifier does not", () => {
  const same = devBoard([
    { key: "old", def: character({ name: "Other Thunder", unique: "thunderhoof" }), owner: P1, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(same.engine, P1, same.id("new"));
  expectPending(same.engine, "uniqueSurvivor");
  const diff = devBoard([
    { key: "old", def: character({ name: "Other Unique", unique: "somethingelse" }), owner: P1, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(diff.engine, P1, diff.id("new"));
  assert.equal(diff.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(diff.engine, diff.id("old")), "play");
  assert.equal(zoneOf(diff.engine, diff.id("new")), "play");
});

clause(THUNDER, "0:unique", "UNIQUE only restricts MY cards: the opponent may control their own Thunderhoof", () => {
  const g = devBoard([
    { key: "theirs", def: printing(THUNDER), owner: P2, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(g.engine, P1, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
});

clause(THUNDER, "1:rule", "when it enters play it gets one token per [O] I control: 1, 3 and 5 [O]", () => {
  for (const [obsession, rage] of [[1, 4], [3, 2], [5, 0]] as const) {
    const g = thunderHandBoard({ obsession, rage });
    play(g.engine, P1, g.id("th"));
    assert.equal(zoneOf(g.engine, g.id("th")), "play");
    assert.equal(tokensOn(g.engine, g.id("th")), obsession, `${obsession} [O]`);
  }
});

clause(THUNDER, "1:rule", "only MY [O] count: the opponent's [O] resources and face-down Volition resources do not", () => {
  const g = thunderHandBoard({ obsession: 1, rage: 4 }, { obsession: 3 });
  play(g.engine, P1, g.id("th"));
  assert.equal(tokensOn(g.engine, g.id("th")), 1, "the opponent's three [O] do not count");
  const v = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 2 }),
    ...volition(2)
  ]);
  play(v.engine, P1, v.id("th"));
  assert.equal(zoneOf(v.engine, v.id("th")), "play");
  assert.equal(tokensOn(v.engine, v.id("th")), 1, "Volition is not [O]");
});

clause(THUNDER, "1:rule", "Thunderhoof costs 5 and needs [O]: four resources, or five with no [O], are refused", () => {
  const four = thunderHandBoard({ obsession: 2, rage: 2 });
  refused(() => play(four.engine, P1, four.id("th")), "four resources");
  assert.equal(zoneOf(four.engine, four.id("th")), "hand");
  const noIcon = thunderHandBoard({ rage: 5 });
  refused(() => play(noIcon.engine, P1, noIcon.id("th")), "no [O]");
  const ok = thunderHandBoard({ obsession: 1, rage: 4 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("th"));
  assert.equal(before - ready(ok.engine), 5);
});

clause(THUNDER, "1:rule", "the trigger is only for Thunderhoof itself entering play: another character entering later gives it no tokens", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "oc", def: character({ name: "Other Char", cost: 0 }), owner: P1, zone: "hand" },
    { key: "oc2", def: character({ name: "Their Char", cost: 0 }), owner: P2, zone: "hand" },
    ...res({ obsession: 3 })
  ]);
  assert.equal(tokensOn(g.engine, g.id("th")), 0, "placed directly: it never 'entered play', so no tokens");
  play(g.engine, P1, g.id("oc"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("th")), 0);
});

clause(THUNDER, "1:rule", "tokens are not left behind: if it leaves play it loses its tokens and gets a fresh count when it re-enters", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: { token: 4 } },
    { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 7 })
  ]);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("th")] } });
  assert.equal(zoneOf(g.engine, g.id("th")), "hand");
  assert.equal(tokensOn(g.engine, g.id("th")), 0, "CR 409.2: the tokens disappear");
  play(g.engine, P1, g.id("th"));
  assert.equal(tokensOn(g.engine, g.id("th")), 1, "one [O] gives one token, not 4 + 1");
});

clause(THUNDER, "2:rule", "gains 1 strength per token: 0, 1 and 4 tokens give 1, 2 and 5 strength; speed and life are unchanged", () => {
  for (const tokens of [0, 1, 4]) {
    const g = devBoard([{ key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} }]);
    assert.equal(stat(g.engine, g.id("th"), "strength"), 1 + tokens, `${tokens} tokens`);
    assert.equal(stat(g.engine, g.id("th"), "speed"), 3);
    assert.equal(stat(g.engine, g.id("th"), "life"), 4);
  }
});

clause(THUNDER, "2:rule", "only counts tokens on THIS card, and only this card gains strength", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "mate", def: character({ name: "Mate", strength: 2, life: 3 }), owner: P1, zone: "play", counters: { token: 3 } },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" }
  ]);
  assert.equal(stat(g.engine, g.id("th"), "strength"), 1, "tokens on another character do not count");
  assert.equal(stat(g.engine, g.id("mate"), "strength"), 2, "no bonus for the other character");
  assert.equal(stat(g.engine, g.id("foe"), "strength"), 2);
});

clause(THUNDER, "2:rule", "the bonus follows the tokens: removing a token with DISRUPT lowers the strength by 1", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: { token: 3 } },
    ...res({ rage: 4 })
  ]);
  assert.equal(stat(g.engine, g.id("th"), "strength"), 4);
  activate(g.engine, P1, g.id("th"), "thunderhoof-disrupt");
  drain(g.engine, pickTargets([]));
  assert.equal(tokensOn(g.engine, g.id("th")), 2);
  assert.equal(stat(g.engine, g.id("th"), "strength"), 3);
});

clause(THUNDER, "2:rule", "the strength bonus is real in a battle: with 2 tokens it deals 3 damage to a blocker (destroying a 3-life one), with no tokens only 1", () => {
  const board = (tokens: number) =>
    devBoard([
      { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} },
      { key: "foe", def: character({ name: "Foe", strength: 0, life: 3 }), owner: P2, zone: "play" }
    ]);
  const strong = board(2);
  fight(strong.engine, P1, [strong.id("th")], { type: "faction", playerId: P2 }, [strong.id("foe")]);
  assert.equal(zoneOf(strong.engine, strong.id("foe")), "discard", "3 damage kills the 3-life blocker");
  const weak = board(0);
  fight(weak.engine, P1, [weak.id("th")], { type: "faction", playerId: P2 }, [weak.id("foe")]);
  assert.equal(zoneOf(weak.engine, weak.id("foe")), "play", "1 damage does not");
  assert.equal(weak.engine.state.cards[weak.id("foe")].damage, 1);
});

// --- DISRUPT --------------------------------------------------------------------------

function disruptBoard(o: { tokens?: number; res?: Icons; oppHand?: number; myHand?: number } = {}) {
  return devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: o.tokens === 0 ? {} : { token: o.tokens ?? 3 } },
    ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
    ...fillers("mh", o.myHand ?? 1, P1, "hand"),
    ...res(o.res ?? { rage: 4 })
  ]);
}
type DisruptGame = ReturnType<typeof disruptBoard>;
const disrupt = (g: DisruptGame): void => activate(g.engine, P1, g.id("th"), "thunderhoof-disrupt");

clause(THUNDER, "3:ability:thunderhoof-disrupt", "the opponent chooses which card to discard; only that card goes to their discard pile", () => {
  const g = disruptBoard();
  disrupt(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what they discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oh2")), "hand");
  assert.equal(handOf(g.engine, P2).length, 2, "exactly one card");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "any card in the opponent's hand can be the one discarded", () => {
  for (const key of ["oh0", "oh1", "oh2"]) {
    const g = disruptBoard();
    disrupt(g);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
    assert.deepEqual(discardOf(g.engine, P2), [g.id(key)]);
  }
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "my own hand is not touched, and the opponent cannot discard one of my cards instead", () => {
  const g = disruptBoard();
  disrupt(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "my card is not theirs to discard");
  assert.equal(zoneOf(g.engine, g.id("mh0")), "hand");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(zoneOf(g.engine, g.id("mh0")), "hand");
  assert.deepEqual(discardOf(g.engine, P1), []);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "the opponent discards exactly ONE card: discarding none or two is refused", () => {
  const g = disruptBoard();
  disrupt(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "discarding nothing");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] }), "discarding two");
  assert.equal(handOf(g.engine, P2).length, 3, "nothing was discarded by the refused answers");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh2")] });
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "an opponent with one card in hand discards it; with an empty hand nothing happens", () => {
  const one = disruptBoard({ oppHand: 1 });
  disrupt(one);
  drain(one.engine, pickTargets([one.id("oh0")]));
  assert.equal(zoneOf(one.engine, one.id("oh0")), "discard");
  const none = disruptBoard({ oppHand: 0 });
  disrupt(none);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(none.engine, none.id("th")), 2, "the cost was still paid");
  assert.equal(handOf(none.engine, P2).length, 0);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "COST: pays 2 resources (not 1 or 3) and removes one token", () => {
  const g = disruptBoard({ res: { rage: 4 } });
  const before = ready(g.engine);
  disrupt(g);
  drain(g.engine, pickTargets([g.id("oh0")]));
  assert.equal(before - ready(g.engine), 2, "exactly two resources are spent");
  assert.equal(tokensOn(g.engine, g.id("th")), 2, "exactly one token removed");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "the cost is paid before the opponent answers (while the discard choice is open)", () => {
  const g = disruptBoard({ res: { rage: 4 } });
  const before = ready(g.engine);
  disrupt(g);
  expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(before - ready(g.engine), 2);
  assert.equal(tokensOn(g.engine, g.id("th")), 2);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "cannot be used without a token on this card, even with plenty of resources", () => {
  const g = disruptBoard({ tokens: 0 });
  refused(() => disrupt(g), "no token to remove");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P2).length, 3);
  assert.equal(ready(g.engine), 4, "nothing was paid");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "cannot be used with fewer than 2 ready resources", () => {
  const one = disruptBoard({ res: { rage: 1 } });
  refused(() => disrupt(one), "one resource");
  assert.equal(tokensOn(one.engine, one.id("th")), 3, "no token was removed");
  assert.equal(handOf(one.engine, P2).length, 3);
  const two = disruptBoard({ res: { rage: 2 } });
  disrupt(two);
  drain(two.engine, pickTargets([two.id("oh0")]));
  assert.equal(zoneOf(two.engine, two.id("oh0")), "discard");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "can be used again for each remaining token (one token per use)", () => {
  const g = disruptBoard({ tokens: 2, res: { rage: 6 } });
  disrupt(g);
  drain(g.engine, pickTargets([g.id("oh0")]));
  disrupt(g);
  drain(g.engine, pickTargets([g.id("oh1")]));
  assert.equal(tokensOn(g.engine, g.id("th")), 0);
  assert.equal(handOf(g.engine, P2).length, 1);
  assert.equal(ready(g.engine), 2);
  refused(() => disrupt(g), "out of tokens");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "tokens on other cards cannot pay for it", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play", counters: { token: 3 } },
    ...fillers("oh", 2, P2, "hand"),
    ...res({ rage: 4 })
  ]);
  refused(() => activate(g.engine, P1, g.id("th"), "thunderhoof-disrupt"), "Thunderhoof has no tokens");
  assert.equal(tokensOn(g.engine, g.id("mate")), 3);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "the opponent cannot use my Thunderhoof's DISRUPT", () => {
  const g = disruptBoard();
  refused(() => activate(g.engine, P2, g.id("th"), "thunderhoof-disrupt"), "not their card", /controller|control|own|priority|your/i);
  assert.equal(tokensOn(g.engine, g.id("th")), 3);
});

// =====================================================================================
// Geiseric, the Souleater
// =====================================================================================

const GEISERIC = "c9801386-03b5-4348-8706-f81fec9819bd"; // character, cost 3, threshold ooo, str 3 / spd 3 / life 2 -- UNIQUE GEISERIC -- character put into opponent's hand from play: may pay 1 instead, remove it from the game, token on this -- SOUL CONSUMPTION: Pay 2, remove a token: look at top 2, 1 to hand, 1 to bottom

/** A free tactic that moves one chosen ITEM in play to its owner's hand. */
const bounceItemTactic = (): CardDefinition =>
  tactic({
    name: "Bounce Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bi",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

/** A free tactic that moves one chosen character in a discard pile to its owner's hand. */
const raiseTactic = (): CardDefinition =>
  tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

interface GeiOpts {
  /** Who owns / controls Geiseric. Default P1. */
  geiOwner?: PlayerId;
  geiController?: PlayerId;
  geiZone?: "play" | "hand" | "discard";
  tokens?: number;
  /** Ready staple resources for P1 / P2. */
  mine?: Icons;
  theirs?: Icons;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function geiBoard(o: GeiOpts = {}) {
  return devBoard(
    [
      {
        key: "g",
        def: printing(GEISERIC),
        owner: o.geiOwner ?? P1,
        controller: o.geiController,
        zone: o.geiZone ?? "play",
        counters: o.tokens ? { token: o.tokens } : {}
      },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "obounce", def: bounceTactic(), owner: P2, zone: "hand" },
      { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Their Thing" }), owner: P2, zone: "play" },
      ...res(o.mine ?? { rage: 4 }),
      ...res(o.theirs ?? { rage: 4 }, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active ?? P1 }
  );
}
type GeiGame = ReturnType<typeof geiBoard>;

const bounce = (g: GeiGame, target: string, who: PlayerId = P1): void =>
  play(g.engine, who, g.id(who === P1 ? "bounce" : "obounce"), { selected: { t: [g.id(target)] } });

clause(GEISERIC, "0:unique", "has UNIQUE GEISERIC: a second Geiseric under my control makes me choose one to keep, and the other is destroyed", () => {
  const g = geiBoard({ extra: [{ key: "g2", def: printing(GEISERIC), owner: P1, zone: "hand" }, ...res({ obsession: 3 })] });
  play(g.engine, P1, g.id("g2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("g"), g.id("g2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("g2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("g2")), "play");
  assert.equal(zoneOf(g.engine, g.id("g")), "discard");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the deployment finishes");
});

clause(GEISERIC, "0:unique", "I can keep the older Geiseric instead", () => {
  const g = geiBoard({ tokens: 1, extra: [{ key: "g2", def: printing(GEISERIC), owner: P1, zone: "hand" }, ...res({ obsession: 3 })] });
  play(g.engine, P1, g.id("g2"));
  expectPending(g.engine, "uniqueSurvivor");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("g") } } as never);
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
  assert.equal(zoneOf(g.engine, g.id("g2")), "discard");
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
});

clause(GEISERIC, "0:unique", "UNIQUE only restricts MY cards: the opponent may control their own Geiseric; a different identifier is no conflict", () => {
  const theirs = geiBoard({ extra: [{ key: "g2", def: printing(GEISERIC), owner: P2, zone: "play" }] });
  assert.equal(theirs.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(theirs.engine, theirs.id("g")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("g2")), "play");
  const diff = geiBoard({ extra: [{ key: "u", def: character({ name: "Other", unique: "other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(diff.engine, P1, diff.id("u"));
  assert.equal(diff.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(diff.engine, diff.id("u")), "play");
  assert.equal(zoneOf(diff.engine, diff.id("g")), "play");
});

clause(GEISERIC, "0:unique", "Geiseric costs 3 and needs [O][O][O]: two resources, or three with only two [O], are refused", () => {
  const two = devBoard([{ key: "g", def: printing(GEISERIC), owner: P1, zone: "hand" }, ...res({ obsession: 2 })]);
  refused(() => play(two.engine, P1, two.id("g")), "two resources");
  const noIcons = devBoard([{ key: "g", def: printing(GEISERIC), owner: P1, zone: "hand" }, ...res({ obsession: 2, rage: 2 })]);
  refused(() => play(noIcons.engine, P1, noIcons.id("g")), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("g")), "hand");
  const ok = devBoard([{ key: "g", def: printing(GEISERIC), owner: P1, zone: "hand" }, ...res({ obsession: 3, rage: 1 })]);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("g"));
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(stat(ok.engine, ok.id("g"), "strength"), 3);
  assert.equal(stat(ok.engine, ok.id("g"), "speed"), 3);
  assert.equal(stat(ok.engine, ok.id("g"), "life"), 2);
});

clause(GEISERIC, "1:rule", "my opponent's character put into their hand from play: I may pay 1 instead; it is removed from the game and a token goes on Geiseric", () => {
  const g = geiBoard();
  const before = ready(g.engine);
  const theirHand = handOf(g.engine, P2).length;
  bounce(g, "victim");
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P1, "Geiseric's controller decides");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("victim")), "removed", "removed from the game");
  assert.equal(handOf(g.engine, P2).length, theirHand, "it never reached their hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 1, "a token on Geiseric");
  assert.equal(before - ready(g.engine), 1, "I paid exactly 1");
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
});

clause(GEISERIC, "1:rule", "'you may': declining lets the character go to their hand; no token, nothing paid", () => {
  const g = geiBoard();
  const before = ready(g.engine);
  bounce(g, "victim");
  expectPending(g.engine, "replacementChoice");
  answerPending(g.engine, "replacementChoice", { apply: false });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  assert.equal(before - ready(g.engine), 0, "no payment");
});

clause(GEISERIC, "1:rule", "'pay 1': if I cannot pay it, the character simply goes to their hand", () => {
  const g = geiBoard({ mine: {} });
  assert.equal(ready(g.engine), 0);
  bounce(g, "victim");
  assert.equal(g.engine.state.pendingChoice, undefined, "no unaffordable offer");
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "one resource is enough, and exactly one is spent", () => {
  const g = geiBoard({ mine: { rage: 1 } });
  bounce(g, "victim");
  expectPending(g.engine, "replacementChoice");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("victim")), "removed");
  assert.equal(ready(g.engine), 0);
});

clause(GEISERIC, "1:rule", "it applies however the character is put into their hand: also when THEY bounce their own character on their turn", () => {
  const g = geiBoard({ active: P2 });
  bounce(g, "victim", P2);
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P1, "Geiseric's controller, not the one who played the tactic");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("victim")), "removed");
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.equal(ready(g.engine, P1), 3, "I paid the 1");
  assert.equal(ready(g.engine, P2), 4, "they paid nothing");
});

clause(GEISERIC, "1:rule", "my OWN character put into my hand is not replaced", () => {
  const g = geiBoard();
  bounce(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "only CHARACTERS: an opponent's item put into their hand is not replaced", () => {
  const g = geiBoard({ extra: [{ key: "bi", def: bounceItemTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bi"), { selected: { t: [g.id("thing")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("thing")), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "only FROM PLAY: an opponent's character returned to their hand from their discard pile is not replaced", () => {
  const g = geiBoard({
    extra: [
      { key: "raise", def: raiseTactic(), owner: P1, zone: "hand" },
      { key: "dead", def: character({ name: "Dead Guy" }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("dead")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("dead")), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "only FROM PLAY: an opponent who draws a character from their deck is not replaced", () => {
  const drawTactic = tactic({
    name: "Make Them Draw",
    cost: 0,
    behavior: { abilities: [{ id: "md", type: "activated", effects: [{ type: "draw", player: "opponent", amount: 1 }] }] }
  });
  const g = geiBoard({
    extra: [
      { key: "md", def: drawTactic, owner: P1, zone: "hand" },
      { key: "topc", def: character({ name: "Their Top Card" }), owner: P2, zone: "deck" },
      ...fillers("of", 2, P2, "deck")
    ]
  });
  const top = deckOf(g.engine, P2)[0];
  play(g.engine, P1, g.id("md"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "hand");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "each stolen character adds a token: two steals give 2 tokens and cost 2", () => {
  const g = geiBoard({ extra: [{ key: "victim2", def: character({ name: "Victim Two" }), owner: P2, zone: "play" }, { key: "bounce2", def: bounceTactic(), owner: P1, zone: "hand" }] });
  const before = ready(g.engine);
  bounce(g, "victim");
  answerPending(g.engine, "replacementChoice", { apply: true });
  play(g.engine, P1, g.id("bounce2"), { selected: { t: [g.id("victim2")] } });
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
  assert.equal(before - ready(g.engine), 2);
  assert.equal(zoneOf(g.engine, g.id("victim")), "removed");
  assert.equal(zoneOf(g.engine, g.id("victim2")), "removed");
});

clause(GEISERIC, "1:rule", "the opponent's Geiseric works against ME: my character put into my hand is removed (their choice to pay 1), their own is not", () => {
  const g = geiBoard({ geiOwner: P2 });
  bounce(g, "mine");
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P2, "Geiseric's controller (my opponent) decides");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("mine")), "removed");
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.equal(ready(g.engine, P2), 3, "they paid");
  assert.equal(ready(g.engine, P1), 4, "I paid nothing");
  const own = geiBoard({ geiOwner: P2 });
  bounce(own, "victim");
  assert.equal(own.engine.state.pendingChoice, undefined, "their own character, their own Geiseric: no replacement");
  assert.equal(zoneOf(own.engine, own.id("victim")), "hand");
});

clause(GEISERIC, "1:rule", "'your opponent's hand' is the OWNER's hand: a character I own but my opponent controls goes to MY hand, so it is not replaced", () => {
  const g = geiBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen From Me" }), owner: P1, controller: P2, zone: "play" }] });
  bounce(g, "stolen");
  assert.equal(g.engine.state.pendingChoice, undefined, "it goes to my own hand");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("stolen")), "handOf(g.engine, P1).includes(g.id(\"stolen\"))");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GEISERIC, "1:rule", "'your opponent's hand' is the OWNER's hand: a character my opponent owns but I control goes to THEIR hand, so it IS replaced", () => {
  const g = geiBoard({ extra: [{ key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" }] });
  bounce(g, "borrowed");
  const pc = pending(g.engine);
  assert.ok(pc, "a replacement choice is offered");
  assert.equal(pc.kind, "replacementChoice");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("borrowed")), "removed");
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
});

clause(GEISERIC, "1:rule", "the rule is only on while Geiseric is in play: from my hand or discard pile it does nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = geiBoard({ geiZone: zone });
    bounce(g, "victim");
    assert.equal(g.engine.state.pendingChoice, undefined, zone);
    assert.equal(zoneOf(g.engine, g.id("victim")), "hand", zone);
  }
});

clause(GEISERIC, "1:rule", "once Geiseric has left play the rule is off again", () => {
  const g = geiBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("g")] } });
  assert.equal(zoneOf(g.engine, g.id("g")), "discard");
  bounce(g, "victim");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
});

// --- SOUL CONSUMPTION -----------------------------------------------------------------

function consumeBoard(o: { tokens?: number; mine?: Icons; deck?: number } = {}) {
  return devBoard([
    { key: "g", def: printing(GEISERIC), owner: P1, zone: "play", counters: o.tokens === 0 ? {} : { token: o.tokens ?? 2 } },
    ...fillers("c", o.deck ?? 6, P1, "deck"),
    ...fillers("oc", 4, P2, "deck"),
    { key: "h", def: character({ name: "Already In Hand" }), owner: P1, zone: "hand" },
    ...res(o.mine ?? { rage: 4 })
  ]);
}
type ConsumeGame = ReturnType<typeof consumeBoard>;
const consume = (g: ConsumeGame): void => activate(g.engine, P1, g.id("g"), "geiseric-consume");
const orderTop = (g: ConsumeGame, order: string[]): void => answerPending(g.engine, "reorderDeck", { order: order.map(g.id) });

clause(GEISERIC, "2:ability:geiseric-consume", "looks at the top 2 cards of MY deck: I am asked to arrange exactly those two", () => {
  const g = consumeBoard();
  const top2 = deckOf(g.engine, P1).slice(0, 2);
  const theirs = deckOf(g.engine, P2);
  consume(g);
  const pc = expectPending(g.engine, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [...top2].sort(), "the top 2 cards of my deck");
  assert.deepEqual(deckOf(g.engine, P2), theirs, "the opponent's deck is not touched");
});

clause(GEISERIC, "2:ability:geiseric-consume", "one of the two goes into my hand and the other to the bottom of my deck: choosing the second one for my hand", () => {
  const g = consumeBoard();
  const before = deckOf(g.engine, P1);
  consume(g);
  orderTop(g, ["c1", "c0"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "my choice goes into my hand");
  assert.deepEqual(deckOf(g.engine, P1), [...before.slice(2), g.id("c0")], "the other is on the bottom; the rest of the deck is unchanged and in order");
  assert.equal(handOf(g.engine, P1).length, 2, "exactly one card gained");
});

clause(GEISERIC, "2:ability:geiseric-consume", "choosing the first one for my hand puts the second one on the bottom", () => {
  const g = consumeBoard();
  const before = deckOf(g.engine, P1);
  consume(g);
  orderTop(g, ["c0", "c1"]);
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
  assert.deepEqual(deckOf(g.engine, P1), [...before.slice(2), g.id("c1")]);
});

clause(GEISERIC, "2:ability:geiseric-consume", "with a 2-card deck: one card to hand, the other stays as the whole deck", () => {
  const g = consumeBoard({ deck: 2 });
  consume(g);
  orderTop(g, ["c1", "c0"]);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.deepEqual(deckOf(g.engine, P1), [g.id("c0")]);
});

clause(GEISERIC, "2:ability:geiseric-consume", "COST: pays 2 resources and removes one token (paid up front, while the arrangement is open)", () => {
  const g = consumeBoard({ tokens: 3 });
  const before = ready(g.engine);
  consume(g);
  expectPending(g.engine, "reorderDeck");
  assert.equal(before - ready(g.engine), 2, "exactly two resources");
  assert.equal(tokensOn(g.engine, g.id("g")), 2, "exactly one token");
  orderTop(g, ["c0", "c1"]);
  assert.equal(before - ready(g.engine), 2);
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
});

clause(GEISERIC, "2:ability:geiseric-consume", "cannot be used without a token on Geiseric", () => {
  const g = consumeBoard({ tokens: 0 });
  refused(() => consume(g), "no token");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(ready(g.engine), 4, "nothing was paid");
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(GEISERIC, "2:ability:geiseric-consume", "cannot be used with fewer than 2 ready resources", () => {
  const g = consumeBoard({ mine: { rage: 1 } });
  refused(() => consume(g), "one resource");
  assert.equal(tokensOn(g.engine, g.id("g")), 2, "no token was removed");
  const ok = consumeBoard({ mine: { rage: 2 } });
  consume(ok);
  orderTop(ok, ["c0", "c1"]);
  assert.equal(zoneOf(ok.engine, ok.id("c0")), "hand");
});

clause(GEISERIC, "2:ability:geiseric-consume", "needs one token per use: with 2 tokens it works twice, then not again", () => {
  const g = consumeBoard({ mine: { rage: 6 } });
  consume(g);
  orderTop(g, ["c0", "c1"]);
  consume(g);
  const pc = expectPending(g.engine, "reorderDeck");
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [g.id("c2"), g.id("c3")].sort(), "the next two cards");
  orderTop(g, ["c3", "c2"]);
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  refused(() => consume(g), "out of tokens");
});

clause(GEISERIC, "2:ability:geiseric-consume", "the arrangement must name exactly the two cards that were looked at", () => {
  const g = consumeBoard();
  consume(g);
  refused(() => orderTop(g, ["c0"]), "only one card");
  refused(() => orderTop(g, ["c0", "c2"]), "a card that was not looked at");
  refused(() => orderTop(g, ["c0", "c0"]), "the same card twice");
  expectPending(g.engine, "reorderDeck");
  assert.equal(handOf(g.engine, P1).length, 1, "nothing moved");
});

clause(GEISERIC, "2:ability:geiseric-consume", "the opponent cannot use my Geiseric's ability", () => {
  const g = consumeBoard({ tokens: 2 });
  refused(() => activate(g.engine, P2, g.id("g"), "geiseric-consume"), "not their card", /controller|control|own|priority|your/i);
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
});

// =====================================================================================
// God's Autograph
// =====================================================================================

const AUTOGRAPH = "30831c20-41d4-46db-a154-60682fe9319b"; // item, cost 2, threshold oo -- All non-resource cards gain the rules text Unique X, where X is the card's name.

interface AutoOpts {
  autoZone?: "hand" | "play" | "discard";
  autoOwner?: PlayerId;
  res?: Icons;
  extra?: CardPlacement[];
}

function autoBoard(o: AutoOpts = {}) {
  return devBoard([
    { key: "auto", def: printing(AUTOGRAPH), owner: o.autoOwner ?? P1, zone: o.autoZone ?? "play" },
    ...res(o.res ?? { obsession: 2 }),
    ...(o.extra ?? [])
  ]);
}

const keepOne = (engine: SpoilsEngine, player: PlayerId, keep: CardInstanceId): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep } } as never);

clause(AUTOGRAPH, "0:rule", "a character gains Unique X where X is its name; an item and a location too, mine and the opponent's", () => {
  const g = autoBoard({
    extra: [
      { key: "ch", def: character({ name: "Nameless" }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Hideout" }), owner: P1, zone: "play" },
      { key: "och", def: character({ name: "Stranger" }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(g.engine.getEffectiveUnique(g.id("ch")), "Nameless");
  assert.equal(g.engine.getEffectiveUnique(g.id("it")), "Gizmo");
  assert.equal(g.engine.getEffectiveUnique(g.id("lo")), "Hideout");
  assert.equal(g.engine.getEffectiveUnique(g.id("och")), "Stranger", "the opponent's cards too: ALL non-resource cards");
});

clause(AUTOGRAPH, "0:rule", "resource cards do not gain Unique: staple resources and face-down cards (which are resources) keep their duplicates", () => {
  const g = autoBoard({
    res: { obsession: 2, rage: 2 },
    extra: [
      { key: "fd1", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "fd2", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  for (const id of g.engine.state.players[P1].play) {
    if (g.engine.isResource(id)) assert.equal(g.engine.getEffectiveUnique(id), undefined, `${g.engine.getDefinition(id).name} is a resource`);
  }
  assert.equal(g.engine.isResource(g.id("fd1")), true);
  assert.equal(g.engine.state.pendingChoice, undefined, "duplicate resources and face-down cards are fine");
  assert.equal(zoneOf(g.engine, g.id("fd1")), "play");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play");
});

clause(AUTOGRAPH, "0:rule", "while it is in play I may not control two cards with the same name: playing a second copy makes me keep one and destroy the other", () => {
  const g = autoBoard({
    extra: [
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(g.engine.state.pendingChoice, undefined, "one copy is fine");
  play(g.engine, P1, g.id("d2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("d1"), g.id("d2")].sort());
  keepOne(g.engine, P1, g.id("d1"));
  assert.equal(zoneOf(g.engine, g.id("d1")), "play");
  assert.equal(zoneOf(g.engine, g.id("d2")), "discard", "the extra copy is destroyed");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the deployment finishes");
});

clause(AUTOGRAPH, "0:rule", "I choose which copy to keep: keeping the new one destroys the old one", () => {
  const g = autoBoard({
    extra: [
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("d2"));
  keepOne(g.engine, P1, g.id("d2"));
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
  assert.equal(zoneOf(g.engine, g.id("d1")), "discard");
});

clause(AUTOGRAPH, "0:rule", "it applies to items and locations as well as characters", () => {
  for (const make of [(n: string) => item({ name: n, cost: 0 }), (n: string) => location({ name: n, cost: 0 })]) {
    const g = autoBoard({
      extra: [
        { key: "d1", def: make("Dup"), owner: P1, zone: "play" },
        { key: "d2", def: make("Dup"), owner: P1, zone: "hand" }
      ]
    });
    play(g.engine, P1, g.id("d2"));
    expectPending(g.engine, "uniqueSurvivor");
    keepOne(g.engine, P1, g.id("d1"));
    assert.equal(zoneOf(g.engine, g.id("d2")), "discard");
  }
});

clause(AUTOGRAPH, "0:rule", "the identifier is the NAME: different names are no conflict", () => {
  const g = autoBoard({
    extra: [
      { key: "d1", def: character({ name: "Twin A", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin B", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("d2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d1")), "play");
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
});

clause(AUTOGRAPH, "0:rule", "Unique only restricts each player's OWN cards: both players may control a copy of the same name", () => {
  const g = autoBoard({
    extra: [
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d1")), "play");
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
});

clause(AUTOGRAPH, "0:rule", "it binds ALL players: with my Autograph in play, my opponent with two copies of a name must choose one to keep", () => {
  const g2 = devBoard(
    [
      { key: "auto", def: printing(AUTOGRAPH), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P2, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P2, zone: "hand" }
    ],
    { activePlayerId: P2 }
  );
  play(g2.engine, P2, g2.id("d2"));
  const pc = expectPending(g2.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P2, "the player who controls the copies chooses");
  keepOne(g2.engine, P2, g2.id("d2"));
  assert.equal(zoneOf(g2.engine, g2.id("d2")), "play");
  assert.equal(zoneOf(g2.engine, g2.id("d1")), "discard");
});

clause(AUTOGRAPH, "0:rule", "deploying God's Autograph itself with duplicates already in play makes me choose which to keep right away", () => {
  const g = autoBoard({
    autoZone: "hand",
    extra: [
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(g.engine.state.pendingChoice, undefined, "no Autograph yet: duplicates are fine");
  play(g.engine, P1, g.id("auto"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("d1"), g.id("d2")].sort());
  keepOne(g.engine, P1, g.id("d2"));
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
  assert.equal(zoneOf(g.engine, g.id("d1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("auto")), "play");
});

clause(AUTOGRAPH, "0:rule", "a second God's Autograph is itself a non-resource card named God's Autograph: I must keep only one", () => {
  const g = autoBoard({ extra: [{ key: "auto2", def: printing(AUTOGRAPH), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("auto2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("auto"), g.id("auto2")].sort());
  keepOne(g.engine, P1, g.id("auto"));
  assert.equal(zoneOf(g.engine, g.id("auto")), "play");
  assert.equal(zoneOf(g.engine, g.id("auto2")), "discard");
});

clause(AUTOGRAPH, "0:rule", "the rule is off when God's Autograph is not in play (in my hand or in the discard pile)", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = autoBoard({
      autoZone: zone,
      extra: [
        { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
        { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(g.engine.getEffectiveUnique(g.id("d1")), undefined, zone);
    play(g.engine, P1, g.id("d2"));
    assert.equal(g.engine.state.pendingChoice, undefined, zone);
    assert.equal(zoneOf(g.engine, g.id("d2")), "play", zone);
  }
});

clause(AUTOGRAPH, "0:rule", "and off again once it has left play", () => {
  const g = autoBoard({
    res: { obsession: 2 },
    extra: [
      { key: "kill", def: tactic({ name: "Kill Item", cost: 0, behavior: { abilities: [{ id: "ki", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "play" },
      { key: "d2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(g.engine.getEffectiveUnique(g.id("d1")), "Twin");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("auto")] } });
  assert.equal(zoneOf(g.engine, g.id("auto")), "discard");
  assert.equal(g.engine.getEffectiveUnique(g.id("d1")), undefined);
  play(g.engine, P1, g.id("d2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("d1")), "play");
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
});

clause(AUTOGRAPH, "0:rule", "it is an item of cost 2 needing [O][O]: deployed for exactly 2, refused one short and without the [O] icons", () => {
  const g = autoBoard({ autoZone: "hand", res: { obsession: 2, rage: 1 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("auto"));
  assert.equal(before - ready(g.engine), 2);
  assert.equal(zoneOf(g.engine, g.id("auto")), "play");
  assert.equal(g.engine.getDefinition(g.id("auto")).type, "item");
  const short = devBoard([
    { key: "auto", def: printing(AUTOGRAPH), owner: P1, zone: "hand" },
    ...res({ obsession: 2 }).map((c, i) => (i === 0 ? { ...c, attachedToKey: "__factionA" } : c))
  ]);
  refused(() => play(short.engine, P1, short.id("auto")), "one resource short");
  const noIcons = autoBoard({ autoZone: "hand", res: { rage: 3, obsession: 1 } });
  refused(() => play(noIcons.engine, P1, noIcons.id("auto")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("auto")), "hand");
});

// =====================================================================================
// Pony Slaystation
// =====================================================================================

const PONY = "d1fc04ec-fef0-4031-8e4c-9ce7c1273015"; // location, cost 3, threshold ooo, structure 3 -- When a character with 3 strength or less enters play under an opponent's control, destroy that character and inflict X damage to this card, where X is that character's strength.

interface PonyOpts {
  ponyZone?: "play" | "hand" | "discard";
  ponyOwner?: PlayerId;
  active?: PlayerId;
  hand?: CardPlacement[];
}

function ponyBoard(o: PonyOpts = {}) {
  const owner = o.ponyOwner ?? P1;
  return devBoard(
    [
      { key: "pony", def: printing(PONY), owner, zone: o.ponyZone ?? "play" },
      ...(o.hand ?? []),
      ...res({ rage: 6 }, P1),
      ...res({ rage: 6 }, P2)
    ],
    { activePlayerId: o.active ?? P2 }
  );
}
type PonyGame = ReturnType<typeof ponyBoard>;

const entrant = (key: string, strength: number, owner: PlayerId = P2, extra: Partial<CardDefinition> = {}): CardPlacement => ({
  key,
  def: character({ name: `Entrant ${key}`, strength, life: 5, cost: 1, ...extra }),
  owner,
  zone: "hand"
});
const damageOn = (g: PonyGame, key = "pony"): number => g.engine.state.cards[g.id(key)].damage ?? 0;

clause(PONY, "0:rule", "a character with 2 strength entering under my opponent's control is destroyed, and Pony Slaystation takes 2 damage", () => {
  const g = ponyBoard({ hand: [entrant("e", 2)] });
  play(g.engine, P2, g.id("e"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("e")), "discard", "destroyed: in its owner's discard pile");
  assert.equal(damageOn(g), 2);
  assert.equal(zoneOf(g.engine, g.id("pony")), "play", "3 structure survives 2 damage");
});

clause(PONY, "0:rule", "X is the character's strength: 1 strength inflicts 1 damage and 0 strength inflicts none", () => {
  for (const [str, dmg] of [[1, 1], [0, 0]] as const) {
    const g = ponyBoard({ hand: [entrant("e", str)] });
    play(g.engine, P2, g.id("e"));
    assert.equal(zoneOf(g.engine, g.id("e")), "discard", `strength ${str}`);
    assert.equal(damageOn(g), dmg, `strength ${str}`);
  }
});

clause(PONY, "0:rule", "'3 strength or less' includes exactly 3: it is destroyed, Pony takes 3 damage and is destroyed too (structure 3)", () => {
  const g = ponyBoard({ hand: [entrant("e", 3)] });
  play(g.engine, P2, g.id("e"));
  assert.equal(zoneOf(g.engine, g.id("e")), "discard");
  assert.equal(zoneOf(g.engine, g.id("pony")), "discard", "3 damage destroys a structure-3 location");
});

clause(PONY, "0:rule", "a character with 4 strength is not affected: it stays in play and Pony takes no damage", () => {
  for (const str of [4, 7]) {
    const g = ponyBoard({ hand: [entrant("e", str)] });
    play(g.engine, P2, g.id("e"));
    assert.equal(zoneOf(g.engine, g.id("e")), "play", `strength ${str}`);
    assert.equal(damageOn(g), 0, `strength ${str}`);
    assert.equal(zoneOf(g.engine, g.id("pony")), "play");
  }
});

clause(PONY, "0:rule", "damage adds up over several entering characters until Pony is destroyed", () => {
  const g = ponyBoard({ hand: [entrant("e1", 1), entrant("e2", 1), entrant("e3", 1)] });
  play(g.engine, P2, g.id("e1"));
  assert.equal(damageOn(g), 1);
  play(g.engine, P2, g.id("e2"));
  assert.equal(damageOn(g), 2);
  assert.equal(zoneOf(g.engine, g.id("pony")), "play");
  play(g.engine, P2, g.id("e3"));
  assert.equal(zoneOf(g.engine, g.id("pony")), "discard", "3 damage in total destroys it");
  for (const k of ["e1", "e2", "e3"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
});

clause(PONY, "0:rule", "only characters under an OPPONENT's control: my own weak character entering play is left alone", () => {
  const g = ponyBoard({ active: P1, hand: [entrant("mine", 2, P1)] });
  play(g.engine, P1, g.id("mine"));
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(damageOn(g), 0);
});

clause(PONY, "0:rule", "only characters: an item entering play under my opponent's control is left alone", () => {
  const g = ponyBoard({ hand: [{ key: "thing", def: item({ name: "Gadget", cost: 1 }), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("thing"));
  assert.equal(zoneOf(g.engine, g.id("thing")), "play");
  assert.equal(damageOn(g), 0);
});

clause(PONY, "0:rule", "'opponent' is relative to Pony's controller: Pony under my opponent's control destroys MY weak characters, not theirs", () => {
  const g = ponyBoard({ ponyOwner: P2, active: P1, hand: [entrant("mine", 2, P1)] });
  play(g.engine, P1, g.id("mine"));
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(damageOn(g), 2);
  const own = ponyBoard({ ponyOwner: P2, active: P2, hand: [entrant("theirs", 2, P2)] });
  play(own.engine, P2, own.id("theirs"));
  assert.equal(zoneOf(own.engine, own.id("theirs")), "play");
  assert.equal(damageOn(own), 0);
});

clause(PONY, "0:rule", "it is the strength as it enters play that counts: a printed-2 character with +2 strength enters as a 4 and is left alone", () => {
  const boost = { behavior: { abilities: [{ id: "boost", type: "continuous" as const, modifiers: [{ target: "source" as const, stat: "strength" as const, operation: "add" as const, value: 2 }] }] } };
  const g = ponyBoard({ hand: [entrant("e", 2, P2, boost)] });
  play(g.engine, P2, g.id("e"));
  assert.equal(g.engine.getStat(g.id("e"), "strength"), 4);
  assert.equal(zoneOf(g.engine, g.id("e")), "play");
  assert.equal(damageOn(g), 0);
});

clause(PONY, "0:rule", "and a printed-4 character with -2 strength enters as a 2: destroyed, and X is that current strength (2 damage)", () => {
  const weak = { behavior: { abilities: [{ id: "weak", type: "continuous" as const, modifiers: [{ target: "source" as const, stat: "strength" as const, operation: "add" as const, value: -2 }] }] } };
  const g = ponyBoard({ hand: [entrant("e", 4, P2, weak)] });
  play(g.engine, P2, g.id("e"));
  assert.equal(zoneOf(g.engine, g.id("e")), "discard");
  assert.equal(damageOn(g), 2);
});

clause(PONY, "0:rule", "it triggers on any way of entering play, not just deploying: a weak character my opponent puts into play from their discard pile is destroyed", () => {
  const reanimate = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character", controller: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = ponyBoard({
    hand: [
      { key: "re", def: reanimate, owner: P2, zone: "hand" },
      { key: "zombie", def: character({ name: "Zombie", strength: 2, life: 4 }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P2, g.id("re"), { selected: { t: [g.id("zombie")] } });
  assert.equal(zoneOf(g.engine, g.id("zombie")), "discard", "it entered play and was destroyed");
  assert.equal(damageOn(g), 2);
});

clause(PONY, "0:rule", "the rule is only on while Pony Slaystation is in play: from my hand or discard pile nothing is destroyed", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = ponyBoard({ ponyZone: zone, hand: [entrant("e", 1)] });
    play(g.engine, P2, g.id("e"));
    assert.equal(zoneOf(g.engine, g.id("e")), "play", zone);
  }
});

clause(PONY, "0:rule", "and off again once Pony is destroyed", () => {
  const g = ponyBoard({ hand: [entrant("e1", 3), entrant("e2", 1)] });
  play(g.engine, P2, g.id("e1"));
  assert.equal(zoneOf(g.engine, g.id("pony")), "discard");
  play(g.engine, P2, g.id("e2"));
  assert.equal(zoneOf(g.engine, g.id("e2")), "play");
});

clause(PONY, "0:rule", "Pony Slaystation itself is a location of cost 3 needing [O][O][O], structure 3: deployed for exactly 3, refused one short and without the icons", () => {
  const g = devBoard([{ key: "pony", def: printing(PONY), owner: P1, zone: "hand" }, ...res({ obsession: 3, rage: 1 })]);
  const before = ready(g.engine);
  play(g.engine, P1, g.id("pony"));
  assert.equal(before - ready(g.engine), 3);
  assert.equal(zoneOf(g.engine, g.id("pony")), "play");
  assert.equal(stat(g.engine, g.id("pony"), "structure"), 3);
  const short = devBoard([
    { key: "pony", def: printing(PONY), owner: P1, zone: "hand" },
    ...res({ obsession: 3 }).map((c, i) => (i === 0 ? { ...c, attachedToKey: "__factionA" } : c))
  ]);
  refused(() => play(short.engine, P1, short.id("pony")), "one resource short");
  const noIcons = devBoard([{ key: "pony", def: printing(PONY), owner: P1, zone: "hand" }, ...res({ obsession: 2, rage: 3 })]);
  refused(() => play(noIcons.engine, P1, noIcons.id("pony")), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("pony")), "hand");
});

// =====================================================================================
// Spatchcocking
// =====================================================================================

const SPAT = "d23a3fbd-0bf3-4937-9b29-570c55a418b8"; // tactic, cost 4, threshold oooo -- Each player chooses a card of each non-resource type they control. Put all remaining non-resource cards into their owner's hand. -- RECUR [O][O][O][O]: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game. Each opponent reveals their hand, chooses a card of each non-resource type in it, and discards the remaining non-resource cards.

type KeepType = "character" | "item" | "location" | "tactic";
type Keeps = Partial<Record<PlayerId, Partial<Record<KeepType, string>>>>;

/** Answers every "choose a card of this type" prompt: `keeps[player][type]` is the key kept (nothing if absent). Returns the prompts seen as "player:type". */
function answerKeeps(g: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, keeps: Keeps): string[] {
  const seen: string[] = [];
  let guard = 0;
  while (guard++ < 20) {
    const pc = pending(g.engine);
    if (!pc) break;
    assert.equal(pc.kind, "chooserSelectsTarget", `unexpected prompt ${pc.kind}`);
    const type = (pc.declaration as { selector: { type: KeepType } }).selector.type;
    const key = keeps[pc.playerId as PlayerId]?.[type];
    seen.push(`${pc.playerId}:${type}`);
    answerPending(g.engine, "chooserSelectsTarget", { selected: key ? [g.id(key)] : [] });
  }
  return seen;
}

interface SpatOpts {
  spat?: "hand" | "discard" | "play" | "removed";
  mine?: Icons;
  oppHand?: CardPlacement[];
  myHand?: CardPlacement[];
  extra?: CardPlacement[];
  active?: PlayerId;
}

/** Two of each non-resource type for each player in play (a1/a2 characters, i1/i2 items, l1/l2 locations; b/j/m for the opponent), plus resources. */
function spatBoard(o: SpatOpts = {}) {
  const pair = (prefix: string, mk: (n: string) => CardDefinition, owner: PlayerId): CardPlacement[] =>
    [1, 2].map((n) => ({ key: `${prefix}${n}`, def: mk(`${prefix}${n}`), owner, zone: "play" as const }));
  return devBoard(
    [
      { key: "sp", def: printing(SPAT), owner: P1, zone: o.spat ?? "hand" },
      ...pair("a", (n) => character({ name: `Mine ${n}` }), P1),
      ...pair("i", (n) => item({ name: `Mine ${n}` }), P1),
      ...pair("l", (n) => location({ name: `Mine ${n}` }), P1),
      ...pair("b", (n) => character({ name: `Theirs ${n}` }), P2),
      ...pair("j", (n) => item({ name: `Theirs ${n}` }), P2),
      ...pair("m", (n) => location({ name: `Theirs ${n}` }), P2),
      ...res(o.mine ?? { obsession: 4 }),
      ...res({ rage: 2 }, P2),
      ...(o.myHand ?? []),
      ...(o.oppHand ?? []),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active ?? P1 }
  );
}
type SpatGame = ReturnType<typeof spatBoard>;
function engineCast(g: SpatGame): void {
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("sp"), selected: {}, variables: {} } as never);
  resolvePendingResponses(g.engine);
}
const castSpat = engineCast;
const inHand = (g: SpatGame, player: PlayerId, key: string): boolean => handOf(g.engine, player).includes(g.id(key));
const FULL_KEEPS: Keeps = {
  [P1]: { character: "a1", item: "i2", location: "l1" },
  [P2]: { character: "b2", item: "j1", location: "m2" }
};

clause(SPAT, "0:rule", "each player keeps the card they chose of each non-resource type; every other one goes to its owner's hand", () => {
  const g = spatBoard();
  castSpat(g);
  const prompts = answerKeeps(g, FULL_KEEPS);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(prompts.includes("p1:character") && prompts.includes("p1:item") && prompts.includes("p1:location"), `my picks were asked: ${prompts}`);
  assert.ok(prompts.includes("p2:character") && prompts.includes("p2:item") && prompts.includes("p2:location"), `their picks were asked: ${prompts}`);
  for (const k of ["a1", "i2", "l1", "b2", "j1", "m2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} kept`);
  for (const k of ["a2", "i1", "l2"]) assert.ok(inHand(g, P1, k), `${k} returned to my hand`);
  for (const k of ["b1", "j2", "m1"]) assert.ok(inHand(g, P2, k), `${k} returned to their hand`);
});

clause(SPAT, "0:rule", "any card of each type can be the one kept: choosing the other pair for every type", () => {
  const g = spatBoard();
  castSpat(g);
  answerKeeps(g, { [P1]: { character: "a2", item: "i1", location: "l2" }, [P2]: { character: "b1", item: "j2", location: "m1" } });
  for (const k of ["a2", "i1", "l2", "b1", "j2", "m1"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} kept`);
  for (const k of ["a1", "i2", "l1"]) assert.ok(inHand(g, P1, k), `${k} returned`);
  for (const k of ["b2", "j1", "m2"]) assert.ok(inHand(g, P2, k), `${k} returned`);
});

clause(SPAT, "0:rule", "a player must choose a card of each non-resource type they control: choosing nothing for a type they control is refused", () => {
  const g = spatBoard();
  castSpat(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal((pc.declaration as { selector: { type: string } }).selector.type, "character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "choosing no character while controlling two");
  assert.equal(zoneOf(g.engine, g.id("a1")), "play", "nothing bounced by the refused answer");
});

clause(SPAT, "0:rule", "they choose ONE card of a type: two of the same type are refused", () => {
  const g = spatBoard();
  castSpat(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1"), g.id("a2")] }), "two characters");
  expectPending(g.engine, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1")] });
});

clause(SPAT, "0:rule", "a player can only choose a card they control, of the type asked: the opponent's card and a card of another type are refused", () => {
  const g = spatBoard();
  castSpat(g);
  const first = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(first.playerId, P1);
  assert.equal((first.declaration as { selector: { type: string } }).selector.type, "character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("b1")] }), "the opponent's character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("i1")] }), "my item as the character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("l1")] }), "my location as the character");
  expectPending(g.engine, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1")] });
  assert.equal(zoneOf(g.engine, g.id("a1")), "play");
});

clause(SPAT, "0:rule", "resource cards are not affected: face-up staples and face-down cards stay in play, and so do the factions", () => {
  const g = spatBoard({
    extra: [
      { key: "fd", def: character({ name: "Hidden Mine" }), owner: P1, zone: "play", faceDown: true },
      { key: "ofd", def: character({ name: "Hidden Theirs" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  const resources = [...g.engine.state.players[P1].play, ...g.engine.state.players[P2].play].filter((c) => g.engine.isResource(c));
  assert.ok(resources.length >= 8, "staple resources and face-down cards");
  castSpat(g);
  answerKeeps(g, FULL_KEEPS);
  for (const c of resources) assert.equal(g.engine.state.cards[c].zone, "play", `${g.engine.getDefinition(c).name} stays in play`);
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("ofd")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.engine.state.players[P1].factionId!), "play");
  assert.equal(zoneOf(g.engine, g.engine.state.players[P2].factionId!), "play");
});

clause(SPAT, "0:rule", "a face-down card is a resource, not a character: it is not offered as a character to keep", () => {
  const g = spatBoard({ extra: [{ key: "fd", def: character({ name: "Hidden Mine" }), owner: P1, zone: "play", faceDown: true }] });
  castSpat(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd")] }), "a face-down card is a resource");
  answerKeeps(g, FULL_KEEPS);
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
});

clause(SPAT, "0:rule", "cards in other zones are untouched: my hand, deck, discard pile and the opponent's hand stay where they are", () => {
  const g = spatBoard({
    myHand: [{ key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" }],
    oppHand: [{ key: "ohc", def: character({ name: "Their Hand Char" }), owner: P2, zone: "hand" }],
    extra: [
      { key: "dd", def: character({ name: "Dead Mine" }), owner: P1, zone: "discard" },
      { key: "odd", def: character({ name: "Dead Theirs" }), owner: P2, zone: "discard" },
      ...fillers("dk", 2, P1, "deck"),
      ...fillers("odk", 2, P2, "deck")
    ]
  });
  const mineDeck = deckOf(g.engine, P1);
  const theirsDeck = deckOf(g.engine, P2);
  castSpat(g);
  answerKeeps(g, FULL_KEEPS);
  assert.equal(zoneOf(g.engine, g.id("dd")), "discard");
  assert.equal(zoneOf(g.engine, g.id("odd")), "discard");
  assert.deepEqual(deckOf(g.engine, P1), mineDeck);
  assert.deepEqual(deckOf(g.engine, P2), theirsDeck);
  assert.ok(inHand(g, P1, "hc") && inHand(g, P2, "ohc"), "inHand(g, P1, \"hc\") && inHand(g, P2, \"ohc\")");
});

clause(SPAT, "0:rule", "a card goes to its OWNER's hand: a character I control but my opponent owns returns to THEIR hand; one I own but they control returns to MINE", () => {
  const g = spatBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  castSpat(g);
  answerKeeps(g, FULL_KEEPS);
  assert.ok(inHand(g, P2, "borrowed"), "owned by the opponent");
  assert.ok(!inHand(g, P1, "borrowed"), "!inHand(g, P1, \"borrowed\")");
  assert.ok(inHand(g, P1, "stolen"), "owned by me");
  assert.ok(!inHand(g, P2, "stolen"), "!inHand(g, P2, \"stolen\")");
});

clause(SPAT, "0:rule", "a player with a single card of each type keeps all of them; a player with none of a type has nothing to choose or lose", () => {
  const g = devBoard([
    { key: "sp", def: printing(SPAT), owner: P1, zone: "hand" },
    { key: "a1", def: character({ name: "Only Char" }), owner: P1, zone: "play" },
    { key: "b1", def: character({ name: "Their Only Char" }), owner: P2, zone: "play" },
    { key: "j1", def: item({ name: "Their Only Item" }), owner: P2, zone: "play" },
    ...res({ obsession: 4 })
  ]);
  castSpat(g);
  answerKeeps(g, { [P1]: { character: "a1" }, [P2]: { character: "b1", item: "j1" } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["a1", "b1", "j1"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", k);
});

clause(SPAT, "0:rule", "tactics in play are non-resource cards too: each player keeps one tactic they control and the other goes to its owner's hand", () => {
  const g = spatBoard({
    extra: [
      { key: "t1", def: tactic({ name: "Mine Tac 1" }), owner: P1, zone: "play" },
      { key: "t2", def: tactic({ name: "Mine Tac 2" }), owner: P1, zone: "play" },
      { key: "u1", def: tactic({ name: "Theirs Tac 1" }), owner: P2, zone: "play" },
      { key: "u2", def: tactic({ name: "Theirs Tac 2" }), owner: P2, zone: "play" }
    ]
  });
  castSpat(g);
  const prompts = answerKeeps(g, { ...FULL_KEEPS, [P1]: { ...FULL_KEEPS[P1], tactic: "t2" }, [P2]: { ...FULL_KEEPS[P2], tactic: "u1" } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(prompts.includes("p1:tactic") && prompts.includes("p2:tactic"), `tactic picks were asked: ${prompts}`);
  assert.equal(zoneOf(g.engine, g.id("t2")), "play", "my chosen tactic stays");
  assert.equal(zoneOf(g.engine, g.id("u1")), "play", "their chosen tactic stays");
  assert.ok(inHand(g, P1, "t1"), "my other tactic returns to my hand");
  assert.ok(inHand(g, P2, "u2"), "their other tactic returns to their hand");
  assert.equal(zoneOf(g.engine, g.id("sp")), "discard", "Spatchcocking itself is not a remaining card in play");
});

clause(SPAT, "0:rule", "the printed cost of 4 is paid, and Spatchcocking ends in my discard pile", () => {
  const g = spatBoard({ mine: { obsession: 4, rage: 2 } });
  const before = ready(g.engine);
  castSpat(g);
  answerKeeps(g, FULL_KEEPS);
  assert.equal(before - ready(g.engine), 4);
  assert.equal(zoneOf(g.engine, g.id("sp")), "discard");
});

clause(SPAT, "0:rule", "it costs 4 and needs [O][O][O][O]: three resources, or four with only three [O], are refused", () => {
  const poor = spatBoard({ mine: { obsession: 3 } });
  refused(() => engineCast(poor), "three resources");
  assert.equal(zoneOf(poor.engine, poor.id("sp")), "hand");
  const noIcons = spatBoard({ mine: { obsession: 3, rage: 3 } });
  refused(() => engineCast(noIcons), "only three [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("a2")), "play", "nothing happened");
  const short = devBoard([
    { key: "sp", def: printing(SPAT), owner: P1, zone: "hand" },
    ...res({ obsession: 4 }).map((c, i) => (i === 0 ? { ...c, attachedToKey: "__factionA" } : c))
  ]);
  refused(() => play(short.engine, P1, short.id("sp")), "one resource short (the [O] threshold is still met)");
});

// --- RECUR ----------------------------------------------------------------------------

const hnd = (key: string, def: CardDefinition, owner: PlayerId = P2): CardPlacement => ({ key, def, owner, zone: "hand" });
const recurHand = (): CardPlacement[] => [
  hnd("hc1", character({ name: "H Char 1" })),
  hnd("hc2", character({ name: "H Char 2" })),
  hnd("hi1", item({ name: "H Item 1" })),
  hnd("hi2", item({ name: "H Item 2" })),
  hnd("hl1", location({ name: "H Loc 1" })),
  hnd("hl2", location({ name: "H Loc 2" })),
  hnd("ht1", tactic({ name: "H Tac 1" })),
  hnd("ht2", tactic({ name: "H Tac 2" })),
  hnd("hr1", bank("rage", 1, P2)[0].def),
  hnd("hr2", bank("greed", 1, P2)[0].def)
];

function recurBoard(o: { spat?: SpatOpts["spat"]; mine?: Icons; oppHand?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "sp", def: printing(SPAT), owner: P1, zone: o.spat ?? "discard" },
    { key: "mc", def: character({ name: "My Hand Char" }), owner: P1, zone: "hand" },
    { key: "mi", def: item({ name: "My Hand Item" }), owner: P1, zone: "hand" },
    { key: "pc", def: character({ name: "Their Board Char" }), owner: P2, zone: "play" },
    ...fillers("od", 3, P2, "deck"),
    ...(o.oppHand ?? recurHand()),
    ...res(o.mine ?? { obsession: 4 })
  ]);
}
type RecurGame = ReturnType<typeof recurBoard>;
const recur = (g: RecurGame): void => activate(g.engine, P1, g.id("sp"), "spatchcocking-recur");
const inHandBy = (g: RecurGame, player: PlayerId, key: string): boolean => handOf(g.engine, player).includes(g.id(key));
const RECUR_KEEPS: Keeps = { [P2]: { character: "hc2", item: "hi1", location: "hl2", tactic: "ht1" } };

clause(SPAT, "1:ability:spatchcocking-recur", "from my discard pile: my opponent keeps one card of each non-resource type in their hand and discards the rest; their resources stay in hand", () => {
  const g = recurBoard();
  recur(g);
  const first = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(first.playerId, P2, "my opponent chooses what to keep");
  const prompts = answerKeeps(g, RECUR_KEEPS);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const t of ["character", "item", "location", "tactic"]) assert.ok(prompts.includes(`p2:${t}`), `asked about ${t}: ${prompts}`);
  for (const k of ["hc2", "hi1", "hl2", "ht1", "hr1", "hr2"]) assert.equal(zoneOf(g.engine, g.id(k)), "hand", `${k} stays in hand`);
  for (const k of ["hc1", "hi2", "hl1", "ht2"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", `${k} discarded`);
  assert.deepEqual(
    discardOf(g.engine, P2).sort(),
    ["hc1", "hi2", "hl1", "ht2"].map(g.id).sort(),
    "exactly the unchosen non-resource cards, in their owner's discard pile"
  );
});

clause(SPAT, "1:ability:spatchcocking-recur", "any card of each type can be the one kept", () => {
  const g = recurBoard();
  recur(g);
  answerKeeps(g, { [P2]: { character: "hc1", item: "hi2", location: "hl1", tactic: "ht2" } });
  for (const k of ["hc1", "hi2", "hl1", "ht2"]) assert.equal(zoneOf(g.engine, g.id(k)), "hand", k);
  for (const k of ["hc2", "hi1", "hl2", "ht1"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
});

clause(SPAT, "1:ability:spatchcocking-recur", "my own hand is not affected, and neither are the opponent's cards in play, deck or discard pile", () => {
  const g = recurBoard();
  const deck = deckOf(g.engine, P2);
  recur(g);
  answerKeeps(g, RECUR_KEEPS);
  assert.ok(inHandBy(g, P1, "mc") && inHandBy(g, P1, "mi"), "my hand is untouched");
  assert.equal(zoneOf(g.engine, g.id("pc")), "play");
  assert.deepEqual(deckOf(g.engine, P2), deck);
  assert.deepEqual(discardOf(g.engine, P1), [], "nothing of mine was discarded (Spatchcocking itself is removed from the game)");
});

clause(SPAT, "1:ability:spatchcocking-recur", "my opponent reveals their hand to everyone", () => {
  const g = recurBoard();
  const hand = handOf(g.engine, P2);
  recur(g);
  const reveals = g.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.ok(reveals.length >= 1, "a reveal was logged");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual([...ev.cardIds].sort(), [...hand].sort(), "the whole hand");
  assert.equal(ev.viewerId, "all");
});

clause(SPAT, "1:ability:spatchcocking-recur", "COST: pays 4 and removes Spatchcocking from the game (not to the discard pile)", () => {
  const g = recurBoard({ mine: { obsession: 4, rage: 2 } });
  const before = ready(g.engine);
  recur(g);
  assert.equal(before - ready(g.engine), 4);
  assert.equal(zoneOf(g.engine, g.id("sp")), "removed");
  answerKeeps(g, RECUR_KEEPS);
  assert.equal(zoneOf(g.engine, g.id("sp")), "removed");
  assert.equal(before - ready(g.engine), 4);
});

clause(SPAT, "1:ability:spatchcocking-recur", "'use this only if this card is in your discard pile': from my hand, in play or removed from the game it cannot be used", () => {
  for (const zone of ["hand", "removed"] as const) {
    const g = recurBoard({ spat: zone });
    refused(() => recur(g), `from ${zone}`, /Activated ability not found|zone|discard|not available|cannot/i);
    assert.equal(zoneOf(g.engine, g.id("sp")), zone);
    assert.equal(zoneOf(g.engine, g.id("hc1")), "hand", "nothing was discarded");
    assert.equal(ready(g.engine), 4, "nothing was paid");
  }
  const ok = recurBoard();
  recur(ok);
  assert.equal(zoneOf(ok.engine, ok.id("sp")), "removed");
});

clause(SPAT, "1:ability:spatchcocking-recur", "needs 4 resources and [O][O][O][O]: three resources, or four with only three [O], are refused", () => {
  const poor = recurBoard({ mine: { obsession: 3 } });
  refused(() => recur(poor), "three resources");
  assert.equal(zoneOf(poor.engine, poor.id("sp")), "discard");
  const noIcons = recurBoard({ mine: { obsession: 3, rage: 3 } });
  refused(() => recur(noIcons), "only three [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("sp")), "discard");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("hc1")), "hand");
});

clause(SPAT, "1:ability:spatchcocking-recur", "'chooses a card of each type': my opponent cannot keep two of a type, nor a card from my hand", () => {
  const g = recurBoard();
  recur(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  assert.equal((pc.declaration as { selector: { type: string } }).selector.type, "character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hc1"), g.id("hc2")] }), "two characters");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mc")] }), "my character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hi1")] }), "an item as the character");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hr1")] }), "a resource card");
  assert.equal(zoneOf(g.engine, g.id("hc1")), "hand");
});

clause(SPAT, "1:ability:spatchcocking-recur", "my opponent must choose a card of each non-resource type in their hand: choosing nothing for a type they hold is refused", () => {
  const g = recurBoard();
  recur(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "choosing no character while holding two");
  assert.equal(zoneOf(g.engine, g.id("hc1")), "hand", "nothing discarded by the refused answer");
});

clause(SPAT, "1:ability:spatchcocking-recur", "a type they have no card of needs no choice: with only characters in hand, one is kept and the rest discarded", () => {
  const g = recurBoard({ oppHand: [hnd("hc1", character({ name: "H Char 1" })), hnd("hc2", character({ name: "H Char 2" })), hnd("hr1", bank("rage", 1, P2)[0].def)] });
  recur(g);
  answerKeeps(g, { [P2]: { character: "hc1" } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("hc1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hc2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("hr1")), "hand");
});

clause(SPAT, "1:ability:spatchcocking-recur", "with a hand of only resources, or an empty hand, nothing is discarded (the cost is still paid)", () => {
  const onlyRes = recurBoard({ oppHand: [hnd("hr1", bank("rage", 1, P2)[0].def), hnd("hr2", bank("greed", 1, P2)[0].def)] });
  recur(onlyRes);
  assert.equal(onlyRes.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(onlyRes.engine, onlyRes.id("hr1")), "hand");
  assert.equal(zoneOf(onlyRes.engine, onlyRes.id("hr2")), "hand");
  assert.equal(zoneOf(onlyRes.engine, onlyRes.id("sp")), "removed");
  const empty = recurBoard({ oppHand: [] });
  recur(empty);
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(empty.engine, empty.id("sp")), "removed");
  assert.equal(ready(empty.engine), 0, "4 paid");
});

clause(SPAT, "1:ability:spatchcocking-recur", "a single card of each type is kept (no discards)", () => {
  const g = recurBoard({ oppHand: [hnd("hc1", character({ name: "H Char 1" })), hnd("hi1", item({ name: "H Item 1" })), hnd("ht1", tactic({ name: "H Tac 1" }))] });
  recur(g);
  answerKeeps(g, { [P2]: { character: "hc1", item: "hi1", tactic: "ht1" } });
  for (const k of ["hc1", "hi1", "ht1"]) assert.equal(zoneOf(g.engine, g.id(k)), "hand", k);
  assert.deepEqual(discardOf(g.engine, P2), []);
});

// =====================================================================================
// The Stone of Shame
// =====================================================================================

const SHAME = "91803a23-9aff-4665-87cf-ff3e40580ede"; // item, cost 2, threshold ooo -- If a character is put into a player's hand, destroy it instead.

interface ShameOpts {
  shameZone?: "play" | "hand" | "discard";
  shameOwner?: PlayerId;
  extra?: CardPlacement[];
  active?: PlayerId;
}

function shameBoard(o: ShameOpts = {}) {
  return devBoard(
    [
      { key: "shame", def: printing(SHAME), owner: o.shameOwner ?? P1, zone: o.shameZone ?? "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "bi", def: bounceItemTactic(), owner: P1, zone: "hand" },
      { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Their Thing" }), owner: P2, zone: "play" },
      ...res({ rage: 4 }),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active ?? P1 }
  );
}
type ShameGame = ReturnType<typeof shameBoard>;
const shameBounce = (g: ShameGame, target: string): void => play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id(target)] } });

clause(SHAME, "0:rule", "an opponent's character that would be put into their hand from play is destroyed instead", () => {
  const g = shameBoard();
  const theirHand = handOf(g.engine, P2).length;
  shameBounce(g, "victim");
  assert.equal(g.engine.state.pendingChoice, undefined, "a mandatory replacement: no choice");
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "destroyed");
  assert.ok(discardOf(g.engine, P2).includes(g.id("victim")), "in its owner's discard pile");
  assert.equal(handOf(g.engine, P2).length, theirHand, "it never reached their hand");
});

clause(SHAME, "0:rule", "'a player's hand': my own character put into my hand is destroyed too", () => {
  const g = shameBoard();
  shameBounce(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("mine")), "discardOf(g.engine, P1).includes(g.id(\"mine\"))");
  assert.ok(!handOf(g.engine, P1).includes(g.id("mine")), "!handOf(g.engine, P1).includes(g.id(\"mine\"))");
});

clause(SHAME, "0:rule", "it does not matter who controls the Stone of Shame: the opponent's Stone also destroys characters that would go to a hand", () => {
  const g = shameBoard({ shameOwner: P2 });
  shameBounce(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  const g2 = shameBoard({ shameOwner: P2 });
  shameBounce(g2, "victim");
  assert.equal(zoneOf(g2.engine, g2.id("victim")), "discard");
});

clause(SHAME, "0:rule", "only characters: an item put into a hand still goes to the hand", () => {
  const g = shameBoard();
  play(g.engine, P1, g.id("bi"), { selected: { t: [g.id("thing")] } });
  assert.equal(zoneOf(g.engine, g.id("thing")), "hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SHAME, "0:rule", "the Stone is itself an item: if it is put into a hand it goes there", () => {
  const g = shameBoard();
  play(g.engine, P1, g.id("bi"), { selected: { t: [g.id("shame")] } });
  assert.equal(zoneOf(g.engine, g.id("shame")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("shame")), "handOf(g.engine, P1).includes(g.id(\"shame\"))");
});

clause(SHAME, "0:rule", "the rule is only on while the Stone is in play: from my hand or discard pile characters go to the hand", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = shameBoard({ shameZone: zone });
    shameBounce(g, "victim");
    assert.equal(zoneOf(g.engine, g.id("victim")), "hand", zone);
  }
});

clause(SHAME, "0:rule", "and off again once the Stone has left play", () => {
  const g = shameBoard({ extra: [{ key: "kill", def: tactic({ name: "Kill Item", cost: 0, behavior: { abilities: [{ id: "ki", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("shame")] } });
  assert.equal(zoneOf(g.engine, g.id("shame")), "discard");
  shameBounce(g, "victim");
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
});

clause(SHAME, "0:rule", "'a character is put into a player's hand' is not limited to play: a character returned from a discard pile to a hand is destroyed instead (stays in the discard pile)", () => {
  const g = shameBoard({
    extra: [
      { key: "raise", def: raiseTactic(), owner: P1, zone: "hand" },
      { key: "dead", def: character({ name: "Dead Guy" }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("dead")] } });
  assert.notEqual(zoneOf(g.engine, g.id("dead")), "hand", "it is never put into the hand");
  assert.equal(zoneOf(g.engine, g.id("dead")), "discard");
});

clause(SHAME, "0:rule", "'a character is put into a player's hand' includes drawing it: a character drawn from the deck is destroyed instead (CR 306.1: to draw is to put the top card into your hand)", () => {
  const drawTactic = tactic({
    name: "Draw One",
    cost: 0,
    behavior: { abilities: [{ id: "d1", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = shameBoard({
    extra: [
      { key: "dt", def: drawTactic, owner: P1, zone: "hand" },
      { key: "topc", def: character({ name: "Top Card" }), owner: P1, zone: "deck" },
      ...fillers("dk", 2, P1, "deck")
    ]
  });
  play(g.engine, P1, g.id("dt"));
  assert.notEqual(zoneOf(g.engine, g.id("topc")), "hand", "the drawn character is destroyed instead");
  assert.equal(zoneOf(g.engine, g.id("topc")), "discard");
});

clause(SHAME, "0:rule", "it is an item of cost 2 needing [O][O][O]: deployed for exactly 2, refused one short and without the icons", () => {
  const g = devBoard([{ key: "shame", def: printing(SHAME), owner: P1, zone: "hand" }, ...res({ obsession: 3, rage: 1 })]);
  const before = ready(g.engine);
  play(g.engine, P1, g.id("shame"));
  assert.equal(before - ready(g.engine), 2);
  assert.equal(zoneOf(g.engine, g.id("shame")), "play");
  const short = devBoard([
    { key: "shame", def: printing(SHAME), owner: P1, zone: "hand" },
    ...res({ obsession: 3 }).map((c, i) => (i < 2 ? { ...c, attachedToKey: "__factionA" } : c))
  ]);
  refused(() => play(short.engine, P1, short.id("shame")), "one resource short");
  const noIcons = devBoard([{ key: "shame", def: printing(SHAME), owner: P1, zone: "hand" }, ...res({ obsession: 2, rage: 3 })]);
  refused(() => play(noIcons.engine, P1, noIcons.id("shame")), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("shame")), "hand");
});
