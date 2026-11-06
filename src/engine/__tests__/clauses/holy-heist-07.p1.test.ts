// Clause tests — batch holy-heist-07, part p1 (groups 1-8, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-07 --groups 1-8 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

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
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

/** Two-player board with the generic Develop-capable factions. */
function duo(cards: CardPlacement[], opts: { active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards
  });
}
type Game = ReturnType<typeof duo>;

const fac = (engine: SpoilsEngine, p: PlayerId): CardInstanceId => engine.state.players[p].factionId!;
const influence = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
const kws = (engine: SpoilsEngine, cardId: CardInstanceId): string[] => engine.getKeywords(cardId) as string[];
const flips = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "coinFlipped");

/** The FLIP UP action for a face-down card of `player`. */
function flipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, extra: Record<string, unknown> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, ...extra });
  resolvePendingResponses(engine);
}

/** P1 starts their turn: it is P2's turn, P2 ends it. Returns with whatever pick the start-of-turn trigger opened. */
const startP1Turn = (engine: SpoilsEngine): void => endTurn(engine, P2);

// =====================================================================================
// Theological Theft — tactic (rogue), cost 8, threshold [D][D][D][D]
// EXTRA COST: Choose a number for X. Pick X players. -- Each of those players puts the top 10 cards of their deck into
// their discard pile. Pick X characters in an opponent's discard pile. Put those characters into play under your
// control. -- FLIP UP: 7 [D][D][D][D]
// =====================================================================================

const THEFT = "9d9b004f-6491-4e6e-a79b-dd2a479c637f";

function theftBoard(o: { d?: number; g?: number; face?: boolean; oppDeck?: number; extra?: CardPlacement[] } = {}) {
  return duo([
    { key: "tt", def: printing(THEFT), owner: P1, zone: o.face ? "play" : "hand", faceDown: o.face },
    { key: "c1", def: character({ name: "Corpse1", cost: 2 }), owner: P2, zone: "discard" },
    { key: "c2", def: character({ name: "Corpse2", cost: 3 }), owner: P2, zone: "discard" },
    { key: "mine", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
    { key: "oitem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
    { key: "oplay", def: character({ name: "OppInPlay" }), owner: P2, zone: "play" },
    ...fillers("od", o.oppDeck ?? 12, P2, "deck"),
    ...fillers("md", 12, P1, "deck"),
    ...bank("deception", o.d ?? 8, P1),
    ...bank("greed", o.g ?? 0, P1),
    ...(o.extra ?? [])
  ]);
}

/**
 * Casts with X and the picked players (the EXTRA COST). The "Pick X characters in an opponent's discard pile" is part of
 * the rules text, so it is asked when the tactic resolves, after the decks are milled: `chars` answers that prompt.
 */
const theftCast = (g: Game, x: number, players: PlayerId[], chars: string[]) => {
  play(g.engine, P1, g.id("tt"), { variables: { x }, selected: { players: players.map((p) => fac(g.engine, p)) } });
  theftPick(g, chars);
};
/** Answers the mid-resolution character pick, if one is open (X=0 may open none). */
const theftPick = (g: Game, chars: string[]) => {
  if (pending(g.engine)?.kind === "chooserSelectsTarget") answerPending(g.engine, "chooserSelectsTarget", { selected: chars.map((k) => g.id(k)) });
};
/** Casts and stops at the character prompt (to test what may be picked). */
const theftCastToPrompt = (g: Game, x: number, players: PlayerId[]) => {
  play(g.engine, P1, g.id("tt"), { variables: { x }, selected: { players: players.map((p) => fac(g.engine, p)) } });
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the character pick is asked while the tactic resolves");
};

/** The top `n` of `before` are in `owner`'s discard pile and the rest of the deck is untouched and in order. */
function assertMilled(g: Game, owner: PlayerId, before: CardInstanceId[], n: number, label: string): void {
  for (const cardId of before.slice(0, n)) assert.equal(g.engine.state.cards[cardId].zone, "discard", `${label}: ${g.engine.state.cards[cardId].zone} should be discard`);
  assert.deepEqual(deckOf(g.engine, owner), before.slice(n), `${label}: the rest of the deck is untouched and in order`);
}

clause(THEFT, "0:extraCost", "X=1: pick one player and one character; the printed cost of 8 is paid and the tactic is spent", () => {
  const g = theftBoard();
  const before = readyResources(g.engine, P1);
  theftCast(g, 1, [P2], ["c1"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(before - readyResources(g.engine, P1), 8, "cost 8 paid (the extra cost itself adds no payment)");
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
});

clause(THEFT, "0:extraCost", "X=2: two players are picked, two characters are picked", () => {
  const g = theftBoard();
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  theftCast(g, 2, [P1, P2], ["c1", "c2"]);
  assert.equal(pending(g.engine), undefined);
  assertMilled(g, P1, p1Deck, 10, "P1 (picked)");
  assertMilled(g, P2, p2Deck, 10, "P2 (picked)");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(THEFT, "0:extraCost", "X=0: no players and no characters are picked and nothing happens (the cost is still paid)", () => {
  const g = theftBoard();
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  const before = readyResources(g.engine, P1);
  theftCast(g, 0, [], []);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(deckOf(g.engine, P1), p1Deck);
  assert.deepEqual(deckOf(g.engine, P2), p2Deck);
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
  assert.equal(before - readyResources(g.engine, P1), 8);
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard");
});

clause(THEFT, "0:extraCost", "X cannot exceed the number of players (3 with two players is refused; 2 is the control)", () => {
  const g = theftBoard();
  refused(() => theftCast(g, 3, [P1, P2, P2], ["c1", "c2", "mine"]), "X=3 with only two players", undefined);
  assert.equal(zoneOf(g.engine, g.id("tt")), "hand", "nothing was cast");
  theftCast(g, 2, [P1, P2], ["c1", "c2"]);
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard", "control: X=2 casts");
});

clause(THEFT, "0:extraCost", "X must be a whole number of at least 0 (-1 and 0.5 are refused)", () => {
  const g = theftBoard();
  refused(() => theftCast(g, -1, [], []), "X=-1");
  refused(() => theftCast(g, 0.5, [P2], ["c1"]), "X=0.5");
  assert.equal(zoneOf(g.engine, g.id("tt")), "hand");
  theftCast(g, 1, [P2], ["c1"]);
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard", "control: X=1");
});

clause(THEFT, "0:extraCost", "exactly X players must be picked: one player for X=2 and two for X=1 are refused; the same player twice is refused", () => {
  const g = theftBoard();
  refused(() => theftCast(g, 2, [P2], ["c1", "c2"]), "X=2 with one player");
  refused(() => theftCast(g, 1, [P1, P2], ["c1"]), "X=1 with two players");
  refused(() => theftCast(g, 2, [P2, P2], ["c1", "c2"]), "X=2 with the same player twice");
  assert.equal(zoneOf(g.engine, g.id("tt")), "hand");
  theftCast(g, 2, [P1, P2], ["c1", "c2"]);
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard", "control: two different players");
});

clause(THEFT, "0:extraCost", "only players can be picked: a character is not a player", () => {
  const g = theftBoard();
  refused(
    () => play(g.engine, P1, g.id("tt"), { variables: { x: 1 }, selected: { players: [g.id("oplay")] } }),
    "a character picked as the player"
  );
  assert.equal(zoneOf(g.engine, g.id("tt")), "hand");
});

clause(THEFT, "1:rule", "X=1 on the opponent: exactly their top 10 cards go to their discard pile in order; your own deck is untouched", () => {
  const g = theftBoard();
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  theftCast(g, 1, [P2], ["c1"]);
  assertMilled(g, P2, p2Deck, 10, "opponent");
  assert.deepEqual(deckOf(g.engine, P1), p1Deck, "you were not picked: your deck is untouched");
});

clause(THEFT, "1:rule", "picking yourself mills YOUR top 10 (any player may be picked) and not the opponent's", () => {
  const g = theftBoard();
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  theftCast(g, 1, [P1], ["c1"]);
  assertMilled(g, P1, p1Deck, 10, "you");
  assert.deepEqual(deckOf(g.engine, P2), p2Deck, "the opponent was not picked");
});

clause(THEFT, "1:rule", "a deck with fewer than 10 cards is milled entirely and the rest of the card still resolves", () => {
  const g = theftBoard({ oppDeck: 4 });
  const p2Deck = deckOf(g.engine, P2);
  assert.equal(p2Deck.length, 4);
  theftCast(g, 1, [P2], ["c1"]);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(deckOf(g.engine, P2), [], "the whole 4-card deck was milled");
  for (const cardId of p2Deck) assert.equal(zoneOf(g.engine, cardId), "discard");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "and the character was still reanimated");
});

clause(THEFT, "1:rule", "the picked characters enter play under YOUR control (the opponent still owns them); unpicked discard characters stay", () => {
  const g = theftBoard();
  theftCast(g, 2, [P2, P1], ["c1", "c2"]);
  for (const key of ["c1", "c2"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
    assert.equal(controllerOf(g.engine, g.id(key)), P1, `${key} is controlled by the caster`);
    assert.equal(g.engine.state.cards[g.id(key)].ownerId, P2, `${key} is still owned by the opponent`);
    assert.ok(g.engine.state.players[P1].play.includes(g.id(key)), `${key} is in the caster's play list`);
  }
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "your own discard character was not picked");
  assert.equal(zoneOf(g.engine, g.id("oitem")), "discard", "the item stays");
});

clause(THEFT, "1:rule", "only X=1 character moves when X=1: the second discard character is not taken", () => {
  const g = theftBoard();
  theftCast(g, 1, [P2], ["c2"]);
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
});

clause(THEFT, "1:rule", "characters must be in an OPPONENT's discard pile: your own discard, an opponent's item, and an opponent's character in play are refused", () => {
  for (const [key, why, zone] of [
    ["mine", "a character in your own discard pile", "discard"],
    ["oitem", "an item in the opponent's discard pile", "discard"],
    ["oplay", "a character in the opponent's play", "play"]
  ] as const) {
    const b = theftBoard();
    theftCastToPrompt(b, 1, [P2]);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] }), why, /Illegal target/);
    assert.equal(zoneOf(b.engine, b.id(key)), zone, `${key} stays where it was`);
    assert.equal(controllerOf(b.engine, b.id(key)), key === "mine" ? P1 : P2, `${key} was not taken`);
  }
  const g = theftBoard();
  theftCast(g, 1, [P2], ["c1"]);
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "control: an opponent's discarded character");
});

clause(THEFT, "1:rule", "exactly X characters are picked: two for X=1 and one for X=2 are refused", () => {
  const one = theftBoard();
  theftCastToPrompt(one, 1, [P2]);
  refused(() => answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("c1"), one.id("c2")] }), "two characters for X=1", /requires/);
  assert.equal(zoneOf(one.engine, one.id("c1")), "discard");
  assert.equal(zoneOf(one.engine, one.id("c2")), "discard");
  const two = theftBoard();
  theftCastToPrompt(two, 2, [P1, P2]);
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("c1")] }), "one character for X=2", /requires/);
  assert.equal(zoneOf(two.engine, two.id("c1")), "discard");
});

clause(THEFT, "1:rule",
  "the characters are picked AFTER the decks are milled: a card just milled from the top of the opponent's deck can be reanimated",
  () => {
    const g = theftBoard();
    const top = deckOf(g.engine, P2)[0];
    // Printed order: mill first, THEN "pick X characters in an opponent's discard pile". The top card was milled, so it is pickable.
    theftCastToPrompt(g, 1, [P2]);
    assert.equal(zoneOf(g.engine, top), "discard", "already milled when the pick is asked");
    answerPending(g.engine, "chooserSelectsTarget", { selected: [top] });
    assert.equal(zoneOf(g.engine, top), "play", "the freshly milled character was put into play");
    assert.equal(controllerOf(g.engine, top), P1);
  }
);

clause(THEFT, "1:rule", "the cost of 8 is exact: 7 resources refuse, 8 cast", () => {
  const short = theftBoard({ d: 7 });
  refused(() => theftCast(short, 1, [P2], ["c1"]), "one short of 8");
  assert.equal(zoneOf(short.engine, short.id("tt")), "hand");
  assert.equal(zoneOf(short.engine, short.id("c1")), "discard");
  const ok = theftBoard({ d: 8 });
  theftCast(ok, 1, [P2], ["c1"]);
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(THEFT, "1:rule", "the [D][D][D][D] threshold is required: eight Greed resources are enough resources but not the threshold; three [D] is one short", () => {
  const greed = theftBoard({ d: 0, g: 8 });
  refused(() => theftCast(greed, 1, [P2], ["c1"]), "no [D] at all");
  const three = theftBoard({ d: 3, g: 5 });
  refused(() => theftCast(three, 1, [P2], ["c1"]), "only three [D]");
  assert.equal(zoneOf(three.engine, three.id("tt")), "hand");
  const four = theftBoard({ d: 4, g: 4 });
  theftCast(four, 1, [P2], ["c1"]);
  assert.equal(zoneOf(four.engine, four.id("c1")), "play", "control: four [D] among eight");
});

clause(THEFT, "2:flipUp", "a face-down Theft flips up for exactly 7, resolves as the tactic (X=1: mill 10, reanimate) and ends in the discard pile", () => {
  const g = theftBoard({ face: true, d: 9 });
  const p2Deck = deckOf(g.engine, P2);
  assert.equal(readyResources(g.engine, P1), 10, "9 banks and the face-down Theft");
  flipUp(g.engine, P1, g.id("tt"), { variables: { x: 1 }, selected: { players: [fac(g.engine, P2)] } });
  theftPick(g, ["c1"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(readyResources(g.engine, P1), 2, "10 - 7 paid - 1 (the card stopped being a resource)");
  assertMilled(g, P2, p2Deck, 10, "opponent");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
  assert.equal(controllerOf(g.engine, g.id("c1")), P1);
  assert.equal(zoneOf(g.engine, g.id("tt")), "discard");
});

clause(THEFT, "2:flipUp", "FLIP UP with X=2 picks two players and two characters just like a hand cast", () => {
  const g = theftBoard({ face: true, d: 6 });
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  flipUp(g.engine, P1, g.id("tt"), {
    variables: { x: 2 },
    selected: { players: [fac(g.engine, P1), fac(g.engine, P2)] }
  });
  theftPick(g, ["c1", "c2"]);
  assertMilled(g, P1, p1Deck, 10, "P1");
  assertMilled(g, P2, p2Deck, 10, "P2");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(readyResources(g.engine, P1), 0, "7 paid: 6 banks and the card itself");
});

clause(THEFT, "2:flipUp", "FLIP UP is refused one short (5 banks plus itself = 6) and without [D][D][D][D] (3 [D] + 4 Greed)", () => {
  const short = theftBoard({ face: true, d: 5 });
  refused(() => flipUp(short.engine, P1, short.id("tt"), { variables: { x: 1 }, selected: { players: [fac(short.engine, P2)] } }), "6 resources");
  assert.equal(short.engine.state.cards[short.id("tt")].faceDown, true);
  assert.equal(readyResources(short.engine, P1), 6, "nothing was paid");
  const noThreshold = theftBoard({ face: true, d: 3, g: 4 });
  refused(
    () => flipUp(noThreshold.engine, P1, noThreshold.id("tt"), { variables: { x: 1 }, selected: { players: [fac(noThreshold.engine, P2)] } }),
    "7 resources but only three [D]"
  );
  assert.equal(noThreshold.engine.state.cards[noThreshold.id("tt")].faceDown, true);
  const ok = theftBoard({ face: true, d: 4, g: 2 });
  flipUp(ok.engine, P1, ok.id("tt"), { variables: { x: 1 }, selected: { players: [fac(ok.engine, P2)] } });
  theftPick(ok, ["c1"]);
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "play", "control: exactly 7 resources with four [D]");
});

// =====================================================================================
// Thieving Casino — location (rogue), cost 4, threshold [D], 4 structure
// At the start of your turn, flip a coin. If you win, pick a player and put the top 4 cards of their deck into their
// discard pile. -- CASH OUT -- COST: Deplete this card. Pick a character in an opponent's discard pile. X is its
// numeric cost. Pay X+4. -- EFFECT: Put it into play under your control.
// =====================================================================================

const CASINO = "c1fdf3be-4790-4560-a4a0-920a951833a4";

function casinoBoard(o: { random?: () => number; d?: number; extra?: CardPlacement[]; casino?: "play" | "discard" } = {}) {
  return duo(
    [
      { key: "tc", def: printing(CASINO), owner: P1, zone: o.casino ?? "play" },
      ...fillers("od", 8, P2, "deck"),
      ...fillers("md", 8, P1, "deck"),
      { key: "corpse", def: character({ name: "Corpse", cost: 3 }), owner: P2, zone: "discard" },
      { key: "free", def: character({ name: "Free", cost: 0 }), owner: P2, zone: "discard" },
      { key: "big", def: character({ name: "Big", cost: 6 }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "MyCorpse", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oitem", def: item({ name: "OppItem", cost: 1 }), owner: P2, zone: "discard" },
      { key: "oplay", def: character({ name: "OppInPlay", cost: 1 }), owner: P2, zone: "play" },
      ...bank("deception", o.d ?? 12, P1),
      ...(o.extra ?? [])
    ],
    { active: P2, random: o.random }
  );
}

const WIN = () => 0.1; // a coin flip is won when the RNG is below 0.5
const LOSE = () => 0.9;

clause(CASINO, "0:rule", "won flip, pick the opponent: the top 4 cards of THEIR deck (and only those) go to their discard pile; your deck is untouched", () => {
  const g = casinoBoard({ random: WIN });
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  startP1Turn(g.engine);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "you pick a player after winning");
  assert.equal(pending(g.engine)?.playerId, P1, "the casino's controller picks");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [fac(g.engine, P2)] });
  assert.equal(pending(g.engine), undefined);
  assertMilled(g, P2, p2Deck, 4, "opponent");
  // P1's own deck: the turn's draw (if any) is the only change allowed, never a mill.
  assert.deepEqual(deckOf(g.engine, P1).slice(-(p1Deck.length - 1)), p1Deck.slice(-(p1Deck.length - 1)));
  for (const cardId of p1Deck) assert.notEqual(zoneOf(g.engine, cardId), "discard", "no card of yours was milled");
});

clause(CASINO, "0:rule", "won flip, pick yourself: your own top 4 cards are milled and the opponent's deck is untouched", () => {
  const g = casinoBoard({ random: WIN });
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  startP1Turn(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [fac(g.engine, P1)] });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(deckOf(g.engine, P2), p2Deck, "the opponent was not picked");
  assert.equal(p1Deck.filter((cardId) => zoneOf(g.engine, cardId) === "discard").length, 4, "exactly 4 of your cards were milled");
});

clause(CASINO, "0:rule", "lost flip: nothing is picked and nothing is milled", () => {
  const g = casinoBoard({ random: LOSE });
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  startP1Turn(g.engine);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined, "no pick is offered after losing");
  assert.deepEqual(deckOf(g.engine, P2), p2Deck);
  for (const cardId of [...p1Deck, ...p2Deck]) assert.notEqual(zoneOf(g.engine, cardId), "discard");
});

clause(CASINO, "0:rule", "the player pick must be a player: a character cannot be milled-by-proxy", () => {
  const g = casinoBoard({ random: WIN });
  startP1Turn(g.engine);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oplay")] }), "a character is not a player");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [fac(g.engine, P2)] });
  assert.equal(pending(g.engine), undefined, "control: a player works");
});

clause(CASINO, "0:rule", "a deck with fewer than 4 cards is milled entirely", () => {
  const g = duo(
    [
      { key: "tc", def: printing(CASINO), owner: P1, zone: "play" },
      ...fillers("od", 2, P2, "deck"),
      ...fillers("md", 5, P1, "deck")
    ],
    { active: P2, random: WIN }
  );
  const p2Deck = deckOf(g.engine, P2);
  startP1Turn(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [fac(g.engine, P2)] });
  assert.deepEqual(deckOf(g.engine, P2), []);
  for (const cardId of p2Deck) assert.equal(zoneOf(g.engine, cardId), "discard");
});

clause(CASINO, "0:rule", "it triggers only at the start of YOUR turn: the start of the opponent's turn flips no coin and mills nothing", () => {
  const g = casinoBoard({ random: WIN });
  g.engine.state.activePlayerId = P1;
  const p1Deck = deckOf(g.engine, P1);
  const p2Deck = deckOf(g.engine, P2);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "the opponent's turn started");
  assert.equal(pending(g.engine), undefined);
  assert.equal(flips(g.engine).length, 0, "no coin was flipped");
  for (const cardId of [...p1Deck, ...p2Deck]) assert.notEqual(zoneOf(g.engine, cardId), "discard");
});

clause(CASINO, "0:rule", "a casino that is no longer in play does nothing at the start of your turn", () => {
  const g = casinoBoard({ random: WIN, casino: "discard" });
  const p2Deck = deckOf(g.engine, P2);
  startP1Turn(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(deckOf(g.engine, P2), p2Deck);
  assert.equal(flips(g.engine).length, 0);
});

clause(CASINO, "0:rule",
  "the start-of-turn coin is a real coin flip by you: a coinFlipped event for you is recorded, a flip is won below 0.5",
  () => {
    const win = casinoBoard({ random: WIN });
    startP1Turn(win.engine);
    const won = flips(win.engine) as unknown as Array<{ event: { playerId: string; won: boolean } }>;
    assert.equal(won.length, 1, "one coin flip");
    assert.equal(won[0].event.playerId, P1, "you flipped");
    assert.equal(won[0].event.won, true, "and won");
    const lose = casinoBoard({ random: LOSE });
    startP1Turn(lose.engine);
    const lost = flips(lose.engine) as unknown as Array<{ event: { playerId: string; won: boolean } }>;
    assert.equal(lost.length, 1);
    assert.equal(lost[0].event.won, false);
  }
);

const cashOut = (g: Game, target: string) => activate(g.engine, P1, g.id("tc"), "thieving-casino-cashout", { selected: { ch: [g.id(target)] } });
const casinoOnMyTurn = (o: Parameters<typeof casinoBoard>[0] = {}) => {
  const g = casinoBoard(o);
  g.engine.state.activePlayerId = P1;
  return g;
};

clause(CASINO, "1:ability:thieving-casino-cashout", "COST: deplete the casino and pay the character's cost + 4 (cost 3 -> 7); EFFECT: it enters play under your control", () => {
  const g = casinoOnMyTurn();
  const before = readyResources(g.engine, P1);
  cashOut(g, "corpse");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("tc")].depleted, true, "COST: deplete this card");
  assert.equal(before - readyResources(g.engine, P1), 7, "X = 3, pay X+4 = 7");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play");
  assert.equal(controllerOf(g.engine, g.id("corpse")), P1);
  assert.equal(g.engine.state.cards[g.id("corpse")].ownerId, P2, "still owned by the opponent");
  assert.equal(zoneOf(g.engine, g.id("free")), "discard", "other discard characters stay");
});

clause(CASINO, "1:ability:thieving-casino-cashout", "X is the numeric cost: a cost-0 character costs 4 and a cost-6 character costs 10", () => {
  const zero = casinoOnMyTurn();
  const before0 = readyResources(zero.engine, P1);
  cashOut(zero, "free");
  assert.equal(before0 - readyResources(zero.engine, P1), 4, "X=0: pay 4");
  assert.equal(zoneOf(zero.engine, zero.id("free")), "play");
  const six = casinoOnMyTurn();
  const before6 = readyResources(six.engine, P1);
  cashOut(six, "big");
  assert.equal(before6 - readyResources(six.engine, P1), 10, "X=6: pay 10");
  assert.equal(zoneOf(six.engine, six.id("big")), "play");
});

clause(CASINO, "1:ability:thieving-casino-cashout", "exact payment: X+4 resources suffice (cost 3 -> 7), one fewer is refused and costs nothing", () => {
  const short = casinoOnMyTurn({ d: 6 });
  refused(() => cashOut(short, "corpse"), "6 resources for a cost of 7");
  assert.equal(short.engine.state.cards[short.id("tc")].depleted, false, "the casino was not depleted");
  assert.equal(zoneOf(short.engine, short.id("corpse")), "discard");
  assert.equal(readyResources(short.engine, P1), 6);
  const ok = casinoOnMyTurn({ d: 7 });
  cashOut(ok, "corpse");
  assert.equal(zoneOf(ok.engine, ok.id("corpse")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(CASINO, "1:ability:thieving-casino-cashout", "a depleted casino cannot be used (COST: deplete this card)", () => {
  const g = casinoOnMyTurn();
  g.engine.state.cards[g.id("tc")].depleted = true;
  refused(() => cashOut(g, "corpse"), "already depleted");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "discard");
  assert.equal(readyResources(g.engine, P1), 12, "nothing was paid");
});

clause(CASINO, "1:ability:thieving-casino-cashout", "it can be used once: a second activation in the same turn is refused (the casino is depleted)", () => {
  const g = casinoOnMyTurn();
  cashOut(g, "corpse");
  refused(() => cashOut(g, "free"), "depleted by the first use");
  assert.equal(zoneOf(g.engine, g.id("free")), "discard");
});

clause(CASINO, "1:ability:thieving-casino-cashout", "targets: only characters in an OPPONENT's discard pile (not your own discard, an item, or a character in play)", () => {
  const g = casinoOnMyTurn();
  refused(() => cashOut(g, "mine"), "your own discard pile");
  refused(() => cashOut(g, "oitem"), "an item");
  refused(() => cashOut(g, "oplay"), "an opponent's character in play");
  assert.equal(g.engine.state.cards[g.id("tc")].depleted, false);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  cashOut(g, "corpse");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play", "control");
});

clause(CASINO, "1:ability:thieving-casino-cashout", "no target is no activation: without a pick nothing is paid or depleted", () => {
  const g = casinoOnMyTurn();
  refused(() => activate(g.engine, P1, g.id("tc"), "thieving-casino-cashout", { selected: { ch: [] } }), "no character picked");
  assert.equal(g.engine.state.cards[g.id("tc")].depleted, false);
  assert.equal(readyResources(g.engine, P1), 12);
});

clause(CASINO, "1:ability:thieving-casino-cashout", "the opponent cannot use your casino", () => {
  const g = casinoOnMyTurn();
  refused(() => activate(g.engine, P2, g.id("tc"), "thieving-casino-cashout", { selected: { ch: [g.id("mine")] } }), "not their card");
  assert.equal(g.engine.state.cards[g.id("tc")].depleted, false);
});

// =====================================================================================
// Torchlight Safehouse — location (rogue), cost 3, threshold [D][D][D], 5 structure
// When this card is destroyed, your faction loses 3 influence. -- At the start of your turn, you may pick up to 3
// characters you control. If you do, they gain COVERT this turn.
// =====================================================================================

const SAFEHOUSE = "ebd86598-fdf0-424d-b867-53b714ac6db9";

const smash = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
const bounceLocation = () =>
  tactic({
    name: "BounceLoc",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bl",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

function safeBoard(extra: CardPlacement[] = [], o: { active?: PlayerId } = {}) {
  return duo(
    [
      { key: "sh", def: printing(SAFEHOUSE), owner: P1, zone: "play" },
      { key: "other", def: location({ name: "OtherPlace", structure: 3 }), owner: P1, zone: "play" },
      { key: "smash", def: smash(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceLocation(), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "D" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      ...fillers("md", 6, P1, "deck"),
      ...fillers("od", 6, P2, "deck"),
      ...extra
    ],
    { active: o.active ?? P2 }
  );
}

const smashIt = (g: Game, key: string, player: PlayerId = P1) => play(g.engine, player, g.id("smash"), { selected: { t: [g.id(key)] } });

clause(SAFEHOUSE, "0:rule", "when destroyed, your faction loses exactly 3 influence (and the opponent's is untouched)", () => {
  const g = safeBoard([], { active: P1 });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  smashIt(g, "sh");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sh")), "discard");
  assert.equal(influence(g.engine, P1), mine - 3);
  assert.equal(influence(g.engine, P2), theirs);
});

clause(SAFEHOUSE, "0:rule", "it triggers once per destruction: no further loss afterwards", () => {
  const g = safeBoard([], { active: P1 });
  const mine = influence(g.engine, P1);
  smashIt(g, "sh");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(influence(g.engine, P1), mine - 3);
});

clause(SAFEHOUSE, "0:rule", "destroying ANOTHER location does not cost influence while the safehouse is in play", () => {
  const g = safeBoard([], { active: P1 });
  const mine = influence(g.engine, P1);
  smashIt(g, "other");
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sh")), "play");
  assert.equal(influence(g.engine, P1), mine, "only its own destruction counts");
});

clause(SAFEHOUSE, "0:rule", "leaving play without being destroyed (returned to hand) costs nothing", () => {
  const g = safeBoard([], { active: P1 });
  const mine = influence(g.engine, P1);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("sh")] } });
  assert.equal(zoneOf(g.engine, g.id("sh")), "hand", "control: it left play");
  assert.equal(influence(g.engine, P1), mine);
});

clause(SAFEHOUSE, "0:rule", "'your faction' is its controller's: a safehouse you control but the opponent owns costs YOU 3, not the owner", () => {
  const g = safeBoard([{ key: "stolen", def: printing(SAFEHOUSE), owner: P2, zone: "play", controller: P1 }], { active: P1 });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  smashIt(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.equal(influence(g.engine, P1), mine - 3, "the controller loses");
  assert.equal(influence(g.engine, P2), theirs, "the owner does not");
});

clause(SAFEHOUSE, "0:rule", "an opponent-controlled safehouse costs its controller 3 (they lose, you do not)", () => {
  const g = safeBoard([{ key: "theirs", def: printing(SAFEHOUSE), owner: P2, zone: "play" }], { active: P1 });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  smashIt(g, "theirs");
  assert.equal(influence(g.engine, P2), theirs - 3);
  assert.equal(influence(g.engine, P1), mine);
});

clause(SAFEHOUSE, "0:rule", "lethal damage destroys it too (5 structure): the influence loss follows", () => {
  const g = safeBoard([{ key: "hit", def: character({ name: "Hit", strength: 5, life: 9, speed: 1 }), owner: P2, zone: "play" }], { active: P2 });
  const mine = influence(g.engine, P1);
  g.engine.state.cards[g.id("sh")].damage = 5;
  endTurn(g.engine, P2);
  assert.equal(zoneOf(g.engine, g.id("sh")), "discard", "5 damage on 5 structure destroys it");
  assert.equal(influence(g.engine, P1), mine - 3);
});

const pickIds = (g: Game, keys: string[]) => keys.map((k) => g.id(k));
const hasCovert = (g: Game, key: string) => kws(g.engine, g.id(key)).includes("covert");

clause(SAFEHOUSE, "1:rule", "at the start of your turn you may pick up to 3 of your characters; each gains COVERT and the unpicked do not", () => {
  const g = safeBoard();
  startP1Turn(g.engine);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["a", "b", "c"]) } });
  assert.equal(pending(g.engine), undefined);
  for (const key of ["a", "b", "c"]) assert.equal(hasCovert(g, key), true, `${key} gained COVERT`);
  assert.equal(hasCovert(g, "d"), false, "the fourth character was not picked");
  assert.equal(hasCovert(g, "foe"), false, "the opponent's character is unaffected");
});

clause(SAFEHOUSE, "1:rule", "'up to 3' includes 1 and 2 picks", () => {
  const one = safeBoard();
  startP1Turn(one.engine);
  answerPending(one.engine, "selectTargets", { selected: { picked: pickIds(one, ["d"]) } });
  assert.equal(hasCovert(one, "d"), true);
  assert.equal(hasCovert(one, "a"), false);
  const two = safeBoard();
  startP1Turn(two.engine);
  answerPending(two.engine, "selectTargets", { selected: { picked: pickIds(two, ["a", "b"]) } });
  assert.equal(hasCovert(two, "a"), true);
  assert.equal(hasCovert(two, "b"), true);
  assert.equal(hasCovert(two, "c"), false);
});

clause(SAFEHOUSE, "1:rule", "'you may': picking nobody is allowed and nobody gains COVERT", () => {
  const g = safeBoard();
  startP1Turn(g.engine);
  answerPending(g.engine, "selectTargets", { selected: { picked: [] } });
  assert.equal(pending(g.engine), undefined);
  for (const key of ["a", "b", "c", "d"]) assert.equal(hasCovert(g, key), false);
});

clause(SAFEHOUSE, "1:rule", "a fourth pick is refused (up to 3), as are opponents' characters, items and locations", () => {
  const g = safeBoard();
  startP1Turn(g.engine);
  refused(() => answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["a", "b", "c", "d"]) } }), "four picks");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["foe"]) } }), "an opponent's character");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["gadget"]) } }), "an item");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["other"]) } }), "a location");
  answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["a"]) } });
  assert.equal(hasCovert(g, "a"), true, "control: a legal pick");
});

clause(SAFEHOUSE, "1:rule", "it also works for a character you control but do not own", () => {
  const g = safeBoard([{ key: "lent", def: character({ name: "Lent" }), owner: P2, zone: "play", controller: P1 }]);
  startP1Turn(g.engine);
  answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["lent"]) } });
  assert.equal(hasCovert(g, "lent"), true);
});

clause(SAFEHOUSE, "1:rule", "COVERT lasts this turn only: gone when P1's turn ends, and not back on later turns", () => {
  const g = safeBoard();
  startP1Turn(g.engine);
  answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["a"]) } });
  assert.equal(hasCovert(g, "a"), true, "this turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(hasCovert(g, "a"), false, "gone at the end of the turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.kind, "selectTargets", "it asks again each turn");
  answerPending(g.engine, "selectTargets", { selected: { picked: [] } });
  assert.equal(hasCovert(g, "a"), false, "not kept");
});

clause(SAFEHOUSE, "1:rule", "COVERT has its real effect: a non-covert blocker cannot block a picked attacker", () => {
  const g = safeBoard([{ key: "guard", def: character({ name: "Guard", speed: 1 }), owner: P2, zone: "play" }]);
  startP1Turn(g.engine);
  answerPending(g.engine, "selectTargets", { selected: { picked: pickIds(g, ["a"]) } });
  declareAttackBy(g.engine, P1, [g.id("a")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("guard")]), "COVERT can only be blocked by COVERT characters");
});

clause(SAFEHOUSE, "1:rule", "it triggers only at the start of YOUR turn: the opponent's turn start opens no pick", () => {
  const g = safeBoard([], { active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
  for (const key of ["a", "b", "c", "d"]) assert.equal(hasCovert(g, key), false);
});

clause(SAFEHOUSE, "1:rule", "a destroyed safehouse stops granting: no pick at the start of the next turn of yours", () => {
  const g = safeBoard([], { active: P1 });
  smashIt(g, "sh");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined);
});

// =====================================================================================
// Torchlight Sarcophyle — character (rogue, sarcophyle), cost 6, threshold [D], 4 strength / 3 speed / 4 life
// While a player controls a character with COVERT, this character gains COVERT.
// =====================================================================================

const SARC = "b6bc3557-e0d3-4bfc-9bc1-138d0d27fb31";
const spy = (name = "Spy") => character({ name, behavior: { keywords: ["covert"] } as never });

function sarcBoard(extra: CardPlacement[] = [], o: { sarc?: "play" | "hand"; active?: PlayerId } = {}) {
  return duo([{ key: "sarc", def: printing(SARC), owner: P1, zone: o.sarc ?? "play" }, ...extra], { active: o.active });
}
const sarcCovert = (g: Game, key = "sarc") => kws(g.engine, g.id(key)).includes("covert");

clause(SARC, "0:rule", "with no COVERT character in play it does not have COVERT", () => {
  const g = sarcBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" }]);
  assert.equal(sarcCovert(g), false);
});

clause(SARC, "0:rule", "an opponent's COVERT character gives it COVERT ('a player')", () => {
  const g = sarcBoard([{ key: "spy", def: spy(), owner: P2, zone: "play" }]);
  assert.equal(sarcCovert(g), true);
});

clause(SARC, "0:rule", "your own COVERT character gives it COVERT too", () => {
  const g = sarcBoard([{ key: "spy", def: spy(), owner: P1, zone: "play" }]);
  assert.equal(sarcCovert(g), true);
});

clause(SARC, "0:rule", "the controller counts, not the owner: a COVERT character the opponent owns but you control also works", () => {
  const g = sarcBoard([{ key: "spy", def: spy(), owner: P2, zone: "play", controller: P1 }]);
  assert.equal(sarcCovert(g), true);
});

clause(SARC, "0:rule", "the COVERT character must be in play: in hand, deck or discard does not count", () => {
  const g = sarcBoard([
    { key: "h", def: spy("InHand"), owner: P2, zone: "hand" },
    { key: "d", def: spy("InDiscard"), owner: P2, zone: "discard" },
    { key: "k", def: spy("InDeck"), owner: P1, zone: "deck" }
  ]);
  assert.equal(sarcCovert(g), false);
});

clause(SARC, "0:rule", "it must be a CHARACTER with COVERT: an item with the keyword does not count", () => {
  const g = sarcBoard([{ key: "gear", def: item({ name: "CovertGear", behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" }]);
  assert.equal(sarcCovert(g), false);
});

clause(SARC, "0:rule", "it tracks the board: when the only COVERT character is destroyed it loses COVERT", () => {
  const g = sarcBoard([
    { key: "spy", def: spy(), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ]);
  assert.equal(sarcCovert(g), true, "while the spy is in play");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("spy")] } });
  assert.equal(zoneOf(g.engine, g.id("spy")), "discard");
  assert.equal(sarcCovert(g), false, "the spy is gone");
});

clause(SARC, "0:rule", "a COVERT character entering play later switches it on", () => {
  const g = sarcBoard([{ key: "spy", def: spy(), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]);
  assert.equal(sarcCovert(g), false);
  play(g.engine, P1, g.id("spy"));
  assert.equal(zoneOf(g.engine, g.id("spy")), "play");
  assert.equal(sarcCovert(g), true);
});

clause(SARC, "0:rule", "a second Sarcophyle is not a COVERT source on its own: two Sarcophyles with no other COVERT stay without it", () => {
  const g = sarcBoard([{ key: "sarc2", def: printing(SARC), owner: P2, zone: "play" }]);
  assert.equal(sarcCovert(g), false);
  assert.equal(sarcCovert(g, "sarc2"), false);
});

clause(SARC, "0:rule", "with a real COVERT character both Sarcophyles gain it, whoever controls them", () => {
  const g = sarcBoard([
    { key: "sarc2", def: printing(SARC), owner: P2, zone: "play" },
    { key: "spy", def: spy(), owner: P2, zone: "play" }
  ]);
  assert.equal(sarcCovert(g), true);
  assert.equal(sarcCovert(g, "sarc2"), true);
});

clause(SARC, "0:rule", "it does not hand COVERT to other characters", () => {
  const g = sarcBoard([
    { key: "spy", def: spy(), owner: P2, zone: "play" },
    { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }
  ]);
  assert.equal(sarcCovert(g), true);
  assert.equal(kws(g.engine, g.id("plain")).includes("covert"), false);
});

clause(SARC, "0:rule", "the gained COVERT is real: a non-covert blocker cannot block an attacking Sarcophyle, a COVERT one can", () => {
  const g = sarcBoard(
    [
      { key: "spy", def: spy(), owner: P2, zone: "play" },
      { key: "guard", def: character({ name: "Guard", speed: 1 }), owner: P2, zone: "play" }
    ],
    { active: P1 }
  );
  declareAttackBy(g.engine, P1, [g.id("sarc")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("guard")]), "a non-covert blocker against a covert party");
  declareBlockers(g.engine, P2, [g.id("spy")]);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("spy")], "control: the COVERT character may block");
});

clause(SARC, "0:rule", "printed body: 4 strength / 3 speed / 4 life, deployable for 6 with a [D], refused at 5 and without [D]", () => {
  const g = sarcBoard([...bank("deception", 6, P1)], { sarc: "hand" });
  play(g.engine, P1, g.id("sarc"));
  assert.equal(zoneOf(g.engine, g.id("sarc")), "play");
  assert.equal(readyResources(g.engine, P1), 0, "cost 6");
  assert.deepEqual([g.engine.getStat(g.id("sarc"), "strength"), g.engine.getStat(g.id("sarc"), "speed"), g.engine.getStat(g.id("sarc"), "life")], [4, 3, 4]);
  const short = sarcBoard([...bank("deception", 5, P1)], { sarc: "hand" });
  refused(() => play(short.engine, P1, short.id("sarc")), "5 resources");
  const noD = sarcBoard([...bank("greed", 6, P1)], { sarc: "hand" });
  refused(() => play(noD.engine, P1, noD.id("sarc")), "no [D]");
});

// =====================================================================================
// TZONE! Street Dancer — character (rogue; dancer, outcast, performer), cost 4, threshold [D], 2 / 4 / 2
// TACTICAL
// =====================================================================================

const TZONE = "4cb801b4-7c6f-4459-80f9-47af0e3836a5";

function tzoneBoard(extra: CardPlacement[] = [], o: { tz?: "play" | "hand" } = {}) {
  return duo(
    [
      { key: "tz", def: printing(TZONE), owner: P1, zone: o.tz ?? "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      ...extra
    ],
    { active: P2 }
  );
}

clause(TZONE, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const g = tzoneBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }], { tz: "play" });
  assert.ok(kws(g.engine, g.id("tz")).includes("tactical"), "kws(g.engine, g.id(\"tz\")).includes(\"tactical\")");
  assert.equal(kws(g.engine, g.id("plain")).includes("tactical"), false, "control: a plain character is not tactical");
});

clause(TZONE, "0:kw:TACTICAL", "it can be deployed from hand in the opponent's attack window for its printed cost of 4", () => {
  const g = tzoneBoard([...bank("deception", 6, P1)]);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  const before = readyResources(g.engine, P1);
  play(g.engine, P1, g.id("tz"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("tz")), "play", "deployed on the opponent's turn");
  assert.equal(before - readyResources(g.engine, P1), 4);
  assert.deepEqual([g.engine.getStat(g.id("tz"), "strength"), g.engine.getStat(g.id("tz"), "speed"), g.engine.getStat(g.id("tz"), "life")], [2, 4, 2]);
});

clause(TZONE, "0:kw:TACTICAL", "an ordinary character cannot be deployed in that window, nor TZONE outside a window on the opponent's turn", () => {
  const g = tzoneBoard([
    ...bank("deception", 6, P1),
    { key: "plain", def: character({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }
  ]);
  refused(() => play(g.engine, P1, g.id("tz")), "the opponent's turn with no response window open");
  assert.equal(zoneOf(g.engine, g.id("tz")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => play(g.engine, P1, g.id("plain")), "a non-tactical character in the window");
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  play(g.engine, P1, g.id("tz"));
  assert.equal(zoneOf(g.engine, g.id("tz")), "play", "control: the TACTICAL character can");
});

clause(TZONE, "0:kw:TACTICAL", "TACTICAL changes the timing only: cost 4 and the [D] threshold still apply in the window", () => {
  const short = tzoneBoard([...bank("deception", 3, P1)]);
  declareAttackOpenWindow(short.engine, P2, [short.id("atk")]);
  refused(() => play(short.engine, P1, short.id("tz")), "3 resources");
  const noD = tzoneBoard([...bank("greed", 6, P1)]);
  declareAttackOpenWindow(noD.engine, P2, [noD.id("atk")]);
  refused(() => play(noD.engine, P1, noD.id("tz")), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("tz")), "hand");
  const ok = tzoneBoard([...bank("deception", 1, P1), ...bank("greed", 3, P1)]);
  declareAttackOpenWindow(ok.engine, P2, [ok.id("atk")]);
  play(ok.engine, P1, ok.id("tz"));
  assert.equal(zoneOf(ok.engine, ok.id("tz")), "play", "control: exactly 4 resources with a single [D]");
});

clause(TZONE, "0:kw:TACTICAL", "on your own turn it deploys normally", () => {
  const g = duo([{ key: "tz", def: printing(TZONE), owner: P1, zone: "hand" }, ...bank("deception", 4, P1)], { active: P1 });
  play(g.engine, P1, g.id("tz"));
  assert.equal(zoneOf(g.engine, g.id("tz")), "play");
});

// =====================================================================================
// Underdog — character (rogue, outcast), cost 1, threshold [D][D][D], 0 strength / 4 speed / 1 life
// This card gains X strength, where X is the number of characters in play that your opponents own.
// =====================================================================================

const UNDERDOG = "d000169f-1416-41e4-a603-3fc3bed83e46";

function udBoard(extra: CardPlacement[] = [], o: { ud?: "play" | "hand" } = {}) {
  return duo([{ key: "ud", def: printing(UNDERDOG), owner: P1, zone: o.ud ?? "play" }, ...extra]);
}
const udStr = (g: Game, key = "ud") => g.engine.getStat(g.id(key), "strength");
const foe = (key: string, extra: Partial<CardPlacement> = {}): CardPlacement => ({ key, def: character({ name: key }), owner: P2, zone: "play", ...extra });

clause(UNDERDOG, "0:rule", "with no opposing characters its strength is its printed 0; speed 4 and life 1 are unchanged", () => {
  const g = udBoard();
  assert.equal(udStr(g), 0);
  assert.equal(g.engine.getStat(g.id("ud"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("ud"), "life"), 1);
});

clause(UNDERDOG, "0:rule", "it gains 1 strength per character the opponent owns in play (1, 2, 4)", () => {
  assert.equal(udStr(udBoard([foe("f1")])), 1);
  assert.equal(udStr(udBoard([foe("f1"), foe("f2")])), 2);
  assert.equal(udStr(udBoard([foe("f1"), foe("f2"), foe("f3"), foe("f4")])), 4);
});

clause(UNDERDOG, "0:rule", "your own characters (and Underdog itself) do not count", () => {
  const g = udBoard([
    foe("f1"),
    { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
    { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" }
  ]);
  assert.equal(udStr(g), 1);
});

clause(UNDERDOG, "0:rule", "only characters count: the opponent's items and locations do not", () => {
  const g = udBoard([
    foe("f1"),
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
  ]);
  assert.equal(udStr(g), 1);
});

clause(UNDERDOG, "0:rule", "only characters IN PLAY count: hand, deck and discard characters do not", () => {
  const g = udBoard([
    foe("f1"),
    foe("inHand", { zone: "hand" }),
    foe("inDeck", { zone: "deck" }),
    foe("inDiscard", { zone: "discard" })
  ]);
  assert.equal(udStr(g), 1);
});

clause(UNDERDOG, "0:rule", "'own' is ownership: an opponent-owned character that I control counts, my character they control does not", () => {
  const g = udBoard([
    foe("stolen", { controller: P1 }),
    { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }
  ]);
  assert.equal(udStr(g), 1, "only the opponent-OWNED character counts, even though I control it");
});

clause(UNDERDOG, "0:rule", "the strength follows the board: it drops when an opposing character is destroyed and rises when one is put into play", () => {
  const g = udBoard([foe("f1"), foe("f2"), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P2, zone: "hand" }]);
  assert.equal(udStr(g), 2);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("f1")] } });
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard");
  assert.equal(udStr(g), 1);
});

clause(UNDERDOG, "0:rule", "a face-down opposing card is a resource, not a character, and does not count", () => {
  const g = udBoard([foe("f1"), foe("res", { faceDown: true })]);
  assert.equal(udStr(g), 1);
});

clause(UNDERDOG, "0:rule", "'your opponents' is relative to the controller: an Underdog the opponent controls counts characters owned by ITS opponent (me)", () => {
  const g = duo([
    { key: "ud", def: printing(UNDERDOG), owner: P1, zone: "play", controller: P2 },
    { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
    { key: "f1", def: character({ name: "F1" }), owner: P2, zone: "play" },
    { key: "f2", def: character({ name: "F2" }), owner: P2, zone: "play" }
  ]);
  // Controlled by P2, its opponent is P1: the P1-owned characters in play are Underdog itself and M1.
  assert.equal(udStr(g), 2);
});

clause(UNDERDOG, "0:rule", "printed body: deployable for 1 with [D][D][D], refused at 0 resources and with only two [D]", () => {
  const g = udBoard([...bank("deception", 3, P1)], { ud: "hand" });
  play(g.engine, P1, g.id("ud"));
  assert.equal(zoneOf(g.engine, g.id("ud")), "play");
  assert.equal(readyResources(g.engine, P1), 2, "cost 1");
  const two = udBoard([...bank("deception", 2, P1), ...bank("greed", 4, P1)], { ud: "hand" });
  refused(() => play(two.engine, P1, two.id("ud")), "only two [D]");
  const none = udBoard([], { ud: "hand" });
  refused(() => play(none.engine, P1, none.id("ud")), "no resources");
});

// =====================================================================================
// Unexpected Transformation — tactic (rogue), cost 1, threshold [D][D][D][D]
// EXTRA COST: Pick a character you control. X is its cost. Put it on the bottom of its owner's deck. Choose a number
// for Y. Pay Y-X. -- Search your deck for a character with cost Y or less and reveal it. You may deploy it for free.
// If you don't, put it on top of your deck.
// =====================================================================================

const UT = "1debbb17-6f36-47b4-85d7-cf4d91d320d7";

function utBoard(o: { d?: number; g?: number; extra?: CardPlacement[]; random?: () => number } = {}) {
  return duo(
    [
      { key: "ut", def: printing(UT), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "play" },
      { key: "found", def: character({ name: "Found", cost: 3 }), owner: P1, zone: "deck" },
      { key: "four", def: character({ name: "Four", cost: 4 }), owner: P1, zone: "deck" },
      { key: "big", def: character({ name: "Big", cost: 5 }), owner: P1, zone: "deck" },
      { key: "itm", def: item({ name: "DeckItem", cost: 1 }), owner: P1, zone: "deck" },
      ...fillers("d", 4, P1, "deck"),
      { key: "inHand", def: character({ name: "InHand", cost: 1 }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc", cost: 1 }), owner: P1, zone: "discard" },
      { key: "foe", def: character({ name: "Foe", cost: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear", cost: 1 }), owner: P1, zone: "play" },
      ...fillers("od", 3, P2, "deck"),
      ...bank("deception", o.d ?? 8, P1),
      ...bank("greed", o.g ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { random: o.random }
  );
}

const utCast = (g: Game, y: number, c: string, found: string[] | undefined, answer: "deploy" | "top" | "declineDeploy" = "top") => {
  play(g.engine, P1, g.id("ut"), { variables: { y }, selected: { c: [g.id(c)], ...(found ? { found: found.map((k) => g.id(k)) } : {}) } });
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: answer === "top" ? 1 : 0 };
    if (pc.kind === "deployForFree") return answer === "deploy" && found ? { kind: "deployForFree", cardId: g.id(found[0]) } : { kind: "deployForFree" };
    return declineAll(pc);
  });
};

clause(UT, "0:extraCost", "the character you control goes to the bottom of its owner's deck, and Y-X (+ the printed 1) is paid: cost 1, Y=3 -> 3 total", () => {
  const g = utBoard();
  const before = readyResources(g.engine, P1);
  utCast(g, 3, "c", ["found"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("c")), "deck", "the character was put into its owner's deck");
  assert.equal(before - readyResources(g.engine, P1), 3, "cost 1 + (Y - X) = 1 + 2");
  assert.equal(zoneOf(g.engine, g.id("ut")), "discard");
});

clause(UT, "0:extraCost", "when Y equals X only the printed cost of 1 is paid", () => {
  const g = utBoard();
  const before = readyResources(g.engine, P1);
  utCast(g, 1, "c", undefined);
  assert.equal(before - readyResources(g.engine, P1), 1, "Y-X = 0");
  assert.equal(zoneOf(g.engine, g.id("c")), "deck");
});

clause(UT, "0:extraCost", "a larger Y costs more: X=1 and Y=6 pays 1 + 5 = 6", () => {
  const g = utBoard({ d: 8 });
  const before = readyResources(g.engine, P1);
  utCast(g, 6, "c", ["big"], "deploy");
  assert.equal(before - readyResources(g.engine, P1), 6);
  assert.equal(zoneOf(g.engine, g.id("big")), "play", "and the cost-5 character is found with Y=6");
});

clause(UT, "0:extraCost", "X is the picked character's own cost: a cost-3 character with Y=4 pays only 1 + 1", () => {
  const g = utBoard({ extra: [{ key: "mid", def: character({ name: "Mid", cost: 3 }), owner: P1, zone: "play" }] });
  const before = readyResources(g.engine, P1);
  utCast(g, 4, "mid", ["four"], "deploy");
  assert.equal(before - readyResources(g.engine, P1), 2, "1 + (4 - 3)");
  assert.equal(zoneOf(g.engine, g.id("mid")), "deck");
  assert.equal(zoneOf(g.engine, g.id("four")), "play");
});

clause(UT, "0:extraCost", "it goes to the bottom of its OWNER's deck (not yours) when you control a character the opponent owns", () => {
  const g = utBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, zone: "play", controller: P1 }] });
  const p2Deck = deckOf(g.engine, P2);
  utCast(g, 3, "stolen", undefined);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "deck");
  assert.deepEqual(deckOf(g.engine, P2), [...p2Deck, g.id("stolen")], "bottom of the owner's deck");
  assert.equal(deckOf(g.engine, P1).includes(g.id("stolen")), false, "not in your deck");
});

clause(UT, "0:extraCost", "only a character YOU control: an opponent's character, an item you control and a character in hand are refused", () => {
  const g = utBoard();
  refused(() => utCast(g, 3, "foe", ["found"]), "an opponent's character");
  refused(() => utCast(g, 3, "gear", ["found"]), "an item");
  refused(() => utCast(g, 3, "inHand", ["found"]), "a character in hand");
  refused(() => utCast(g, 3, "inDisc", ["found"]), "a character in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("ut")), "hand");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  utCast(g, 3, "c", ["found"], "deploy");
  assert.equal(zoneOf(g.engine, g.id("found")), "play", "control");
});

clause(UT, "0:extraCost", "unaffordable: cost 1 + (Y-X) = 3 needs 3 resources; 2 refuse and nothing happens (the character stays)", () => {
  const g = utBoard({ d: 4 });
  const short = utBoard({ d: 2, g: 0 });
  refused(() => utCast(short, 3, "c", ["found"]), "2 resources for a total of 3");
  assert.equal(zoneOf(short.engine, short.id("c")), "play", "the extra cost did not move the character");
  assert.equal(zoneOf(short.engine, short.id("ut")), "hand");
  assert.equal(readyResources(short.engine, P1), 2);
  utCast(g, 3, "c", ["found"], "deploy");
  assert.equal(zoneOf(g.engine, g.id("found")), "play", "control");
});

clause(UT, "0:extraCost", "Y must be a whole number of at least 0: -1 and 1.5 are refused", () => {
  const g = utBoard();
  refused(() => utCast(g, -1, "c", undefined), "Y=-1");
  refused(() => utCast(g, 1.5, "c", undefined), "Y=1.5");
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(zoneOf(g.engine, g.id("ut")), "hand");
});

clause(UT, "0:extraCost", "Y below X: the cast is NOT refused, Y-X floors at 0 (CR 410.4) so only the printed 1 is paid, and the search limit is the chosen Y", () => {
  const mid = { key: "mid", def: character({ name: "Mid", cost: 4 }), owner: P1, zone: "play" as const };
  const one = { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "deck" as const };
  // Seeded: the search shuffles the deck (CR 313), so the old unseeded run's "bottom of the deck" check passed or failed by chance
  // (E9b flake fix, holy-heist-07-p1-4); the bottom position is now checked on the stack, see holy-heist-07-p1-5.
  const g = utBoard({ extra: [mid, one], random: () => 0.5 });
  const before = readyResources(g.engine, P1);
  utCast(g, 1, "mid", ["one"], "deploy");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ut")) === "hand", false, "the cast went through");
  assert.equal(before - readyResources(g.engine, P1), 1, "exactly the printed 1 is paid: Y-X = -3 pays 0 and gives nothing back");
  assert.equal(zoneOf(g.engine, g.id("mid")), "deck", "X's character went into its owner's deck");
  assert.equal(zoneOf(g.engine, g.id("one")), "play", "a cost-1 character (cost <= Y) was found and deployed");
  const limit = utBoard({ extra: [{ ...mid }] });
  refused(() => utCast(limit, 1, "mid", ["found"]), "cost 3 is above Y = 1", /./);
});

clause(UT, "0:extraCost", "the extra cost is paid when the tactic is played: X's character is on the bottom of its owner's deck while the cast waits for responses", () => {
  const mid = { key: "mid", def: character({ name: "Mid", cost: 4 }), owner: P1, zone: "play" as const };
  const one = { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "deck" as const };
  const raw = utBoard({ extra: [mid, one], random: () => 0.5 });
  raw.engine.perform({ type: "playCard", playerId: P1, cardId: raw.id("ut"), variables: { y: 1 }, selected: { c: [raw.id("mid")], found: [raw.id("one")] } } as never);
  assert.ok(raw.engine.state.responseWindow, "the cast waits for responses");
  const rawDeck = raw.engine.state.players[P1].deck;
  assert.equal(rawDeck[rawDeck.length - 1], raw.id("mid"), "X's character was put on the bottom of its owner's deck as part of the cost");
  assert.equal(zoneOf(raw.engine, raw.id("mid")), "deck");
});

clause(UT, "0:extraCost", "the [D][D][D][D] threshold is required: eight Greed resources are refused", () => {
  const g = utBoard({ d: 0, g: 8 });
  refused(() => utCast(g, 3, "c", ["found"]), "no [D]");
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  const three = utBoard({ d: 3, g: 5 });
  refused(() => utCast(three, 3, "c", ["found"]), "three [D]");
  const four = utBoard({ d: 4, g: 4 });
  utCast(four, 3, "c", ["found"], "deploy");
  assert.equal(zoneOf(four.engine, four.id("found")), "play", "control: four [D]");
});

clause(UT, "1:rule", "Deploy it for free: the found character (cost 3) enters play under your control, no resources are paid for it", () => {
  const g = utBoard();
  const before = readyResources(g.engine, P1);
  utCast(g, 3, "c", ["found"], "deploy");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("found")), "play");
  assert.equal(controllerOf(g.engine, g.id("found")), P1);
  assert.equal(before - readyResources(g.engine, P1), 3, "only the tactic's own cost and Y-X were paid, nothing for the deploy");
  assert.equal(deckOf(g.engine, P1).includes(g.id("found")), false);
});

clause(UT, "1:rule", "if you don't deploy it, it goes on TOP of your deck (and does not enter play)", () => {
  const g = utBoard();
  utCast(g, 3, "c", ["found"], "top");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("found")), "deck");
  assert.equal(deckOf(g.engine, P1)[0], g.id("found"), "on top of the deck");
  assert.equal(zoneOf(g.engine, g.id("c")), "deck", "the bottomed character is also in the deck");
});

clause(UT, "1:rule", "'If you don't': choosing to deploy and then declining the deployment still puts the found card on top of your deck", () => {
  const g = utBoard({ random: () => 0 });
  utCast(g, 3, "c", ["found"], "declineDeploy");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("found")), "deck", "not deployed");
  assert.equal(deckOf(g.engine, P1)[0], g.id("found"), "on top of the deck");
});

clause(UT, "1:rule", "the revealed card is the found one and the choice is offered to you", () => {
  const g = utBoard();
  play(g.engine, P1, g.id("ut"), { variables: { y: 3 }, selected: { c: [g.id("c")], found: [g.id("found")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "you choose");
  const revealed = g.engine.getLog().some((entry) => /reveal/i.test(String(entry.event?.type ?? "")) && JSON.stringify(entry.event).includes(g.id("found")));
  assert.equal(revealed, true, "the found character was revealed");
  drain(g.engine, declineAll);
});

clause(UT, "1:rule", "'cost Y or less': a cost equal to Y is allowed; Y+1, an item and a card outside the deck are refused", () => {
  const g = utBoard();
  refused(() => utCast(g, 3, "c", ["four"]), "cost 4 with Y=3");
  refused(() => utCast(g, 3, "c", ["big"]), "cost 5 with Y=3");
  refused(() => utCast(g, 3, "c", ["itm"]), "an item in the deck");
  refused(() => utCast(g, 3, "c", ["inHand"]), "a character in hand");
  refused(() => utCast(g, 3, "c", ["inDisc"]), "a character in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "all refused: nothing happened");
  utCast(g, 3, "c", ["found"], "deploy");
  assert.equal(zoneOf(g.engine, g.id("found")), "play", "control: cost exactly Y");
});

clause(UT, "1:rule", "you search YOUR deck: a character in the opponent's deck is refused", () => {
  const g = utBoard({ extra: [{ key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "deck" }] });
  refused(() => utCast(g, 3, "c", ["theirs"]), "the opponent's deck");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "deck");
});

clause(UT, "1:rule", "a search may find nothing: no pick is legal, the character is still put in the deck, and nothing is deployed", () => {
  const g = utBoard();
  utCast(g, 3, "c", undefined, "deploy");
  assert.equal(pending(g.engine), undefined, "no deploy-or-top prompt without a found card");
  assert.equal(zoneOf(g.engine, g.id("c")), "deck");
  assert.equal(zoneOf(g.engine, g.id("found")), "deck");
  assert.equal(zoneOf(g.engine, g.id("ut")), "discard");
});

clause(UT, "1:rule", "your deck is shuffled after the search (CR 312.1): the order is not the old order with the bottomed card appended", () => {
  const g = utBoard({ random: () => 0 });
  const before = deckOf(g.engine, P1);
  utCast(g, 3, "c", undefined);
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), [...before, g.id("c")].sort(), "same cards plus the bottomed one");
  assert.notDeepEqual(after, [...before, g.id("c")], "the deck was shuffled");
});

// =====================================================================================
// Warehouse Sentinel — character (rogue; guard, tough guy), cost 8, threshold [D], 6 / 4 / 5
// RECUR: [D][D][D] -- COST: Use this only if this card is in your discard pile. Pay 1. Remove this card from the game.
// Pick a character. -- EFFECT: If the character is depleted, destroy it.
// =====================================================================================

const SENTINEL = "82130389-515b-4a5d-92dd-188d3f97c9ff";

function wsBoard(o: { d?: number; g?: number; ws?: "discard" | "hand" | "play" | "deck"; extra?: CardPlacement[] } = {}) {
  return duo([
    { key: "ws", def: printing(SENTINEL), owner: P1, zone: o.ws ?? "discard" },
    { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play", depleted: true },
    { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
    { key: "myFresh", def: character({ name: "MyFresh" }), owner: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play", depleted: true },
    { key: "gone", def: character({ name: "Gone" }), owner: P2, zone: "discard" },
    ...bank("deception", o.d ?? 3, P1),
    ...bank("greed", o.g ?? 0, P1),
    ...(o.extra ?? [])
  ]);
}
const recur = (g: Game, target: string, who: PlayerId = P1) => activate(g.engine, who, g.id("ws"), "warehouse-sentinel-recur", { selected: { c: [g.id(target)] } });

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "from your discard pile: pay exactly 1, remove the Sentinel from the game, and destroy the picked DEPLETED character", () => {
  const g = wsBoard();
  const before = readyResources(g.engine, P1);
  recur(g, "victim");
  assert.equal(pending(g.engine), undefined);
  assert.equal(before - readyResources(g.engine, P1), 1, "Pay 1");
  assert.equal(zoneOf(g.engine, g.id("ws")), "removed", "removed from the game");
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "destroyed");
  assert.equal(zoneOf(g.engine, g.id("fresh")), "play");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "a character that is NOT depleted survives (but the Sentinel is still removed and the 1 is still paid)", () => {
  const g = wsBoard();
  const before = readyResources(g.engine, P1);
  recur(g, "fresh");
  assert.equal(zoneOf(g.engine, g.id("fresh")), "play", "not depleted: not destroyed");
  assert.equal(g.engine.state.cards[g.id("fresh")].depleted, false);
  assert.equal(zoneOf(g.engine, g.id("ws")), "removed", "COST: removed from the game anyway");
  assert.equal(before - readyResources(g.engine, P1), 1);
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "'Pick a character': your own characters too, depleted ones die and ready ones do not", () => {
  const dead = wsBoard();
  recur(dead, "mine");
  assert.equal(zoneOf(dead.engine, dead.id("mine")), "discard", "your own depleted character is destroyed");
  const alive = wsBoard();
  recur(alive, "myFresh");
  assert.equal(zoneOf(alive.engine, alive.id("myFresh")), "play");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "the pick must be a character in play: a depleted item and a discarded character are refused", () => {
  const g = wsBoard();
  refused(() => recur(g, "gear"), "an item");
  refused(() => recur(g, "gone"), "a character in a discard pile");
  assert.equal(zoneOf(g.engine, g.id("ws")), "discard", "refusals leave the Sentinel in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("gear")), "play");
  recur(g, "victim");
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "control");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "usable only from the discard pile: not from hand, deck or play", () => {
  for (const zone of ["hand", "deck", "play"] as const) {
    const g = wsBoard({ ws: zone });
    refused(() => recur(g, "victim"), `Sentinel in ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("ws")), zone);
    assert.equal(zoneOf(g.engine, g.id("victim")), "play");
    assert.equal(readyResources(g.engine, P1), 3, "nothing was paid");
  }
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "it must be YOUR discard pile: the opponent's Sentinel in their discard pile cannot be recurred by you", () => {
  const g = wsBoard({ extra: [{ key: "ws2", def: printing(SENTINEL), owner: P2, zone: "discard" }] });
  refused(() => activate(g.engine, P1, g.id("ws2"), "warehouse-sentinel-recur", { selected: { c: [g.id("victim")] } }), "not in your discard pile");
  assert.equal(zoneOf(g.engine, g.id("ws2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("victim")), "play");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "Pay 1: with no resources it is refused", () => {
  const g = wsBoard({ d: 0 });
  refused(() => recur(g, "victim"), "nothing to pay with");
  assert.equal(zoneOf(g.engine, g.id("ws")), "discard");
  assert.equal(zoneOf(g.engine, g.id("victim")), "play");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "the [D][D][D] threshold is required: two [D] plus plenty of Greed is refused, three [D] works and pays only 1", () => {
  const g = wsBoard({ d: 2, g: 5 });
  refused(() => recur(g, "victim"), "two [D]");
  assert.equal(zoneOf(g.engine, g.id("ws")), "discard");
  assert.equal(zoneOf(g.engine, g.id("victim")), "play");
  const none = wsBoard({ d: 0, g: 6 });
  refused(() => recur(none, "victim"), "no [D]");
  const ok = wsBoard({ d: 3 });
  recur(ok, "victim");
  assert.equal(zoneOf(ok.engine, ok.id("victim")), "discard");
  assert.equal(readyResources(ok.engine, P1), 2, "threshold is not spent: 3 - 1");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "once removed it is gone: a second use is impossible", () => {
  const g = wsBoard();
  recur(g, "victim");
  refused(() => recur(g, "fresh"), "the Sentinel was removed from the game");
  assert.equal(zoneOf(g.engine, g.id("fresh")), "play");
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "no pick, no activation: the Sentinel stays in the discard pile and nothing is paid", () => {
  const g = wsBoard();
  refused(() => activate(g.engine, P1, g.id("ws"), "warehouse-sentinel-recur", { selected: { c: [] } }), "no character picked");
  assert.equal(zoneOf(g.engine, g.id("ws")), "discard");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(SENTINEL, "0:ability:warehouse-sentinel-recur", "printed body: deployable for 8 with a [D], refused at 7; 6 strength / 4 speed / 5 life", () => {
  const g = duo([{ key: "ws", def: printing(SENTINEL), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]);
  play(g.engine, P1, g.id("ws"));
  assert.equal(zoneOf(g.engine, g.id("ws")), "play");
  assert.equal(readyResources(g.engine, P1), 0);
  assert.deepEqual([g.engine.getStat(g.id("ws"), "strength"), g.engine.getStat(g.id("ws"), "speed"), g.engine.getStat(g.id("ws"), "life")], [6, 4, 5]);
  const short = duo([{ key: "ws", def: printing(SENTINEL), owner: P1, zone: "hand" }, ...bank("deception", 7, P1)]);
  refused(() => play(short.engine, P1, short.id("ws")), "7 resources");
});

void bounceTactic;
