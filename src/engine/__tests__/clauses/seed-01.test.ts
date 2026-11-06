// Clause tests — batch seed-01. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-01`. Expectations come from each card's
// PRINTED text and RULES.md / the Comprehensive Rules; engine data (ability ids,
// target declaration ids, choice kinds) is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as buildGameBase,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdFlipUp } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  fight,
  playRaw
} from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { BuildGameOptions, CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

// --- shared helpers (this file only) ---------------------------------------------

/** A small deterministic LCG, so every shuffle / random pick in every test is reproducible. */
function seededRandom(seed = 20261016): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** `buildGame` with a seeded random source unless the test passes its own `random`. */
const buildGame = (options: BuildGameOptions = {}) => buildGameBase({ ...options, random: options.random ?? seededRandom() });

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ obsession: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].discard;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);
const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);

/** `n` vanilla characters in `owner`'s zone, keyed `<prefix>0..n-1` (a deck's first key is its top card). */
function cards(prefix: string, n: number, owner: PlayerId, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone }));
}

/** `n` vanilla tactics, keyed `<prefix>0..n-1`. */
function tactics(prefix: string, n: number, owner: PlayerId, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: tactic({ name: `${prefix.toUpperCase()}${i}` }), owner, zone }));
}

/** Answers the open pending choice with `choice` (asserting its kind and who answers it). */
function answerBy(engine: SpoilsEngine, kind: string, playerId: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}`);
  assert.equal(pc.kind, kind);
  assert.equal(pc.playerId, playerId, `${kind} is answered by ${playerId}`);
  answerPending(engine, kind, choice);
}

/** Drains pending choices, picking `picks` for every `chooserSelectsTarget` and declining everything else. */
function drainPicking(engine: SpoilsEngine, picks: CardInstanceId[]): void {
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: picks } : declineAll(pc)));
}

/** Resolves any open response windows, then asserts the game is not waiting for any decision (nothing was offered). */
function settled(engine: SpoilsEngine): void {
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "no choice should have been offered");
}

/** Answers the "order your triggers" prompts of a turn start (and nothing else: any other prompt fails the test). */
function orderTriggersOnly(engine: SpoilsEngine): void {
  drain(engine, (pc) => {
    assert.equal(pc.kind, "orderTriggers", `only a trigger-ordering prompt was expected, got ${pc.kind}`);
    return declineAll(pc);
  });
}

/** The opponent's one-shot response: a free tactic of theirs bounces `targetKey`'s card while `engine` waits for responses. */
function respondWith(engine: SpoilsEngine, responder: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables: {} } as never);
  resolvePendingResponses(engine);
}

// =================================================================================
// Anathematize
// COST: Pick a character. -- EFFECT: This turn, the character loses 5 strength.
// Draw a card.   Tactic, cost 4, [O].
// =================================================================================

const ANATHEMATIZE = "63157c9a-b261-47c9-8894-7b9c94b9b383";

function anathematizeBoard(opts: { icons?: Icons; deck?: number; turn?: number; strength?: number } = {}) {
  return buildGame({
    turn: opts.turn ?? 1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: opts.strength ?? 7, life: 9 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 7, life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: opts.strength ?? 7, life: 9 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 7, life: 9 }), owner: P2, zone: "play" },
      ...cards("d", opts.deck ?? 3, P1, "deck"),
      ...cards("e", 3, P2, "deck"),
      ...res(opts.icons ?? { obsession: 6 })
    ]
  });
}

clause(ANATHEMATIZE, "0:ability", "pays exactly 4, then the picked opposing character loses 5 strength and nobody else does", () => {
  const { engine, id } = anathematizeBoard();
  const before = ready(engine);
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(engine.getStat(id("foe"), "strength"), 7 - 5);
  assert.equal(engine.getStat(id("bystander"), "strength"), 7, "an unpicked opposing character is unaffected");
  assert.equal(engine.getStat(id("mine"), "strength"), 7, "my own characters are unaffected");
  assert.equal(engine.getStat(id("ally"), "strength"), 7);
  assert.equal(zoneOf(engine, id("an")), "discard", "the tactic ends in its owner's discard pile");
});

clause(ANATHEMATIZE, "0:ability", "can pick one of your own characters", () => {
  const { engine, id } = anathematizeBoard();
  play(engine, P1, id("an"), { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 7 - 5);
  assert.equal(engine.getStat(id("ally"), "strength"), 7, "the other one of mine is unaffected");
  assert.equal(engine.getStat(id("foe"), "strength"), 7);
});

clause(ANATHEMATIZE, "0:ability", "draws exactly one card for its controller: the top card of their deck, and nothing for the opponent", () => {
  const { engine, id } = anathematizeBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand, one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the drawn card is the top card");
  assert.equal(deckOf(engine, P1).length, 2);
  assert.equal(handOf(engine, P2).length, oppHand, "the opponent draws nothing");
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
});

clause(ANATHEMATIZE, "0:ability", "the draw happens even when the picked character is picked from the opponent's side and your own deck has one card", () => {
  const { engine, id } = anathematizeBoard({ deck: 1 });
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("d0")), "hand");
});

clause(ANATHEMATIZE, "0:ability", "with an empty deck you simply fail to draw (CR 306.2): the strength loss still happens", () => {
  const { engine, id } = anathematizeBoard({ deck: 0 });
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
  assert.equal(engine.state.winner, undefined, "running out of cards does not lose the game");
});

for (const [base, expected] of [
  [5, 0],
  [6, 1],
  [12, 7]
] as const) {
  clause(ANATHEMATIZE, "0:ability", `loses exactly 5 strength: ${base} strength becomes ${expected}`, () => {
    const { engine, id } = anathematizeBoard({ strength: base });
    play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
    assert.equal(engine.getStat(id("foe"), "strength"), expected);
  });
}

clause(ANATHEMATIZE, "0:ability", "a character with less than 5 strength is left at 0 strength, not a negative number (CR 410.4)", () => {
  for (const base of [3, 1, 0]) {
    const { engine, id } = anathematizeBoard({ strength: base });
    play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
    assert.equal(engine.getStat(id("foe"), "strength"), 0, `a ${base}-strength character that loses 5 strength has 0`);
  }
});

clause(ANATHEMATIZE, "0:ability", "the loss lasts this turn only: it is gone once the turn has passed", () => {
  const { engine, id } = anathematizeBoard();
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "reduced this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(engine.getStat(id("foe"), "strength"), 7, "the strength is back at the next start of turn");
});

clause(ANATHEMATIZE, "0:ability", "the loss lasts for the rest of this turn, not just while the tactic resolves (still reduced after a later develop)", () => {
  const { engine, id } = anathematizeBoard();
  play(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  developDraw(engine, P1);
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "still reduced later in the same turn");
});

clause(ANATHEMATIZE, "0:ability", "the loss is real in a battle: the picked attacker deals 5 less damage to the faction", () => {
  const { engine, id } = anathematizeBoard({ turn: 2, strength: 7 });
  // P1 is the active player on this board, so make the picked character one of mine and attack with it.
  play(engine, P1, id("an"), { selected: { c: [id("mine")] } });
  const influence = engine.state.players[P2].influence;
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - engine.state.players[P2].influence, 2, "7 strength minus 5 = 2 battle damage");
});

clause(ANATHEMATIZE, "0:ability", "the pick is a cost: only a character in play can be picked (not an item, a location, a faction or a card in hand/discard)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" },
      ...cards("d", 2, P1, "deck"),
      ...res({ obsession: 6 })
    ]
  });
  const attempt = (target: CardInstanceId) => () => playRaw(engine, P1, id("an"), { selected: { c: [target] } });
  refused(attempt(id("thing")), "an item is not a character");
  refused(attempt(id("place")), "a location is not a character");
  refused(attempt(engine.state.players[P2].factionId!), "a faction cannot be picked (CR 202.9)");
  refused(attempt(id("inHand")), "a character in a hand is not in play");
  refused(attempt(id("inDiscard")), "a character in a discard pile is not in play");
  refused(attempt(id("inDeck")), "a character in a deck is not in play");
  assert.equal(zoneOf(engine, id("an")), "hand", "nothing was played by the refused attempts");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: picking a character in play is accepted");
});

clause(ANATHEMATIZE, "0:ability", "needs a pick: it cannot be played without a character, nor with two", () => {
  const { engine, id } = anathematizeBoard();
  refused(() => playRaw(engine, P1, id("an"), { selected: {} }), "no pick");
  refused(() => playRaw(engine, P1, id("an"), { selected: { c: [id("foe"), id("bystander")] } }), "two picks");
  assert.equal(zoneOf(engine, id("an")), "hand");
  playRaw(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  assert.ok(engine.state.responseWindow, "control: exactly one pick is accepted");
});

clause(ANATHEMATIZE, "0:ability", "is refused with no character in play to pick", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" }, ...cards("d", 2, P1, "deck"), ...res({ obsession: 6 })]
  });
  refused(() => playRaw(engine, P1, id("an"), { selected: {} }), "no characters in play");
  assert.equal(zoneOf(engine, id("an")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
});

clause(ANATHEMATIZE, "0:ability", "cannot pick a face-down card (it is only a resource, CR 411.1)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "fd", def: character({ name: "Hidden", strength: 7 }), owner: P2, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...cards("d", 2, P1, "deck"),
      ...res({ obsession: 6 })
    ]
  });
  refused(() => playRaw(engine, P1, id("an"), { selected: { c: [id("fd")] } }), "a face-down card is not a character");
  playRaw(engine, P1, id("an"), { selected: { c: [id("mine")] } });
  assert.ok(engine.state.responseWindow, "control: a face-up character is accepted");
});

clause(ANATHEMATIZE, "0:ability", "is refused one resource short of its cost of 4, allowed with exactly 4", () => {
  const short = anathematizeBoard({ icons: { obsession: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("an"), { selected: { c: [short.id("foe")] } }), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("an")), "hand");
  const exact = anathematizeBoard({ icons: { obsession: 4 } });
  play(exact.engine, P1, exact.id("an"), { selected: { c: [exact.id("foe")] } });
  assert.equal(exact.engine.getStat(exact.id("foe"), "strength"), 2);
  assert.equal(ready(exact.engine), 0, "all four resources were spent");
});

clause(ANATHEMATIZE, "0:ability", "needs [O]: four resources of another icon are not enough, one [O] among them is", () => {
  const noThreshold = anathematizeBoard({ icons: { greed: 6 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("an"), { selected: { c: [noThreshold.id("foe")] } }), "no [O]");
  const opponentsOnly = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res({ greed: 6 }),
      ...res({ obsession: 6 }, P2)
    ]
  });
  refused(() => playRaw(opponentsOnly.engine, P1, opponentsOnly.id("an"), { selected: { c: [opponentsOnly.id("foe")] } }), "the opponent's [O] do not count");
  const withThreshold = anathematizeBoard({ icons: { obsession: 1, greed: 5 } });
  play(withThreshold.engine, P1, withThreshold.id("an"), { selected: { c: [withThreshold.id("foe")] } });
  assert.equal(withThreshold.engine.getStat(withThreshold.id("foe"), "strength"), 2, "one [O] among four-plus resources is enough");
});

clause(ANATHEMATIZE, "0:ability", "is a tactic: it can be played in response to the opponent's attack (their turn)", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 6, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...cards("d", 2, P1, "deck"),
      ...res({ obsession: 6 })
    ]
  });
  refused(() => playRaw(engine, P1, id("an"), { selected: { c: [id("atk")] } }), "not P1's turn and nothing to respond to");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("an"), { selected: { c: [id("atk")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("atk"), "strength"), 1, "the attacker lost 5 strength in response to its own attack");
});

clause(ANATHEMATIZE, "0:ability", "if the picked character leaves play in response, you still draw a card (CR 402.5a: effects do not fizzle)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANATHEMATIZE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 7, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...cards("d", 3, P1, "deck"),
      ...res({ obsession: 6 })
    ]
  });
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("an"), { selected: { c: [id("foe")] } });
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard", "the response destroyed the picked character");
  assert.equal(zoneOf(engine, id("an")), "discard");
  assert.equal(zoneOf(engine, top), "hand", "the draw still happened");
});

// =================================================================================
// Arcane Research
// Search your deck for up to 4 tactics. Put them into your discard pile.
// Tactic, cost 2, [O].
// =================================================================================

const RESEARCH = "977c039b-8303-449e-9305-bf95001af440";

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function researchBoard(opts: { tactics?: number; others?: number; icons?: Icons; random?: () => number } = {}) {
  return buildGame({
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ar", def: printing(RESEARCH), owner: P1, zone: "hand" },
      ...tactics("t", opts.tactics ?? 6, P1, "deck"),
      ...cards("c", opts.others ?? 4, P1, "deck"),
      { key: "thing", def: item({ name: "ItemInDeck" }), owner: P1, zone: "deck" },
      ...tactics("ot", 3, P2, "deck"),
      ...tactics("hand", 2, P1, "hand"),
      ...tactics("disc", 2, P1, "discard"),
      ...tactics("oh", 2, P2, "hand"),
      ...res(opts.icons ?? { obsession: 4 })
    ]
  });
}

const ALL_T = ["t0", "t1", "t2", "t3", "t4", "t5"];

for (const picks of [
  ["t0", "t1", "t2", "t3"],
  ["t2", "t3", "t4", "t5"],
  ["t5", "t0", "t4", "t1"]
]) {
  clause(RESEARCH, "0:rule", `searching 6 tactics, taking 4 (${picks.join(", ")}) puts exactly those 4 into the discard pile and leaves the other 2 in the deck`, () => {
    const { engine, id } = researchBoard();
    const deckBefore = [...deckOf(engine, P1)];
    const discardBefore = discardOf(engine, P1).length;
    const pickIds = picks.map(id);
    const before = ready(engine);
    play(engine, P1, id("ar"));
    drainPicking(engine, pickIds);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
    for (const key of ALL_T) assert.equal(zoneOf(engine, id(key)), picks.includes(key) ? "discard" : "deck", `${key}`);
    assert.equal(discardOf(engine, P1).length, discardBefore + 4 + 1, "four tactics and Arcane Research itself");
    assert.equal(zoneOf(engine, id("ar")), "discard", "Arcane Research ends in the discard pile");
    assert.deepEqual([...deckOf(engine, P1)].sort(), deckBefore.filter((c) => !pickIds.includes(c)).sort(), "every other card is still in the deck");
    assert.equal(handOf(engine, P1).length, 2, "nothing went to the hand (the two filler tactics only)");
  });
}

for (const n of [0, 1, 2, 3]) {
  clause(RESEARCH, "0:rule", `"up to 4": taking only ${n} tactic${n === 1 ? "" : "s"} is allowed and exactly those are discarded`, () => {
    const { engine, id } = researchBoard();
    const pickIds = ALL_T.slice(0, n).map(id);
    play(engine, P1, id("ar"));
    drainPicking(engine, pickIds);
    assert.equal(engine.state.pendingChoice, undefined);
    for (const key of ALL_T) assert.equal(zoneOf(engine, id(key)), ALL_T.indexOf(key) < n ? "discard" : "deck", `${key}`);
    assert.equal(zoneOf(engine, id("ar")), "discard");
  });
}

clause(RESEARCH, "0:rule", "taking more than 4 tactics is refused; the same search with exactly 4 is accepted", () => {
  const { engine, id } = researchBoard();
  play(engine, P1, id("ar"));
  const pc = pending(engine);
  assert.ok(pc, "the search is waiting for the controller's pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the controller searches");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ALL_T.slice(0, 5).map(id) } } as never),
    "five tactics is more than 'up to 4'"
  );
  assert.ok(pending(engine), "the refused answer left the choice open");
  answerPending(engine, "chooserSelectsTarget", { selected: ALL_T.slice(0, 4).map(id) });
  assert.equal(zoneOf(engine, id("t3")), "discard", "control: four is fine");
  assert.equal(zoneOf(engine, id("t4")), "deck");
});

clause(RESEARCH, "0:rule", "only TACTICS can be taken: a character or an item in the deck is refused", () => {
  const { engine, id } = researchBoard();
  play(engine, P1, id("ar"));
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["c0"]), "a character");
  refused(answerWith(["thing"]), "an item");
  refused(answerWith(["t0", "c1"]), "a tactic together with a character");
  assert.ok(pending(engine), "the choice stays open after refusals");
  answerWith(["t0", "t1"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("t0")), "discard", "control: tactics are accepted");
  assert.equal(zoneOf(engine, id("c0")), "deck");
});

clause(RESEARCH, "0:rule", "only cards in YOUR deck can be taken: the opponent's deck, your hand and your discard pile are refused", () => {
  const { engine, id } = researchBoard();
  play(engine, P1, id("ar"));
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["ot0"]), "a tactic in the opponent's deck");
  refused(answerWith(["hand0"]), "a tactic in my hand");
  refused(answerWith(["disc0"]), "a tactic in my discard pile");
  refused(answerWith(["oh0"]), "a tactic in the opponent's hand");
  refused(answerWith(["t0", "t0"]), "the same tactic twice");
  answerWith(["t0"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("t0")), "discard", "control: a tactic in my deck is accepted");
});

clause(RESEARCH, "0:rule", "nothing else moves: the opponent's cards, my hand and the cards left in the deck stay where they are", () => {
  const { engine, id } = researchBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  const myDiscardBefore = [...discardOf(engine, P1)];
  play(engine, P1, id("ar"));
  drainPicking(engine, ALL_T.slice(0, 4).map(id));
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
  assert.deepEqual(
    [...discardOf(engine, P1)].sort(),
    [...myDiscardBefore, ...ALL_T.slice(0, 4).map(id), id("ar")].sort(),
    "my discard pile gains exactly the four tactics and the card itself"
  );
  assert.deepEqual([...handOf(engine, P1)].sort(), ["hand0", "hand1"].map(id).sort(), "my hand only lost Arcane Research");
});

clause(RESEARCH, "0:rule", "with fewer than 4 tactics in the deck you may take them all (2 tactics: both go to the discard pile)", () => {
  const { engine, id } = researchBoard({ tactics: 2 });
  play(engine, P1, id("ar"));
  drainPicking(engine, ["t0", "t1"].map(id));
  assert.equal(zoneOf(engine, id("t0")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "discard");
  assert.equal(deckOf(engine, P1).length, 4 + 1, "the characters and the item remain");
});

clause(RESEARCH, "0:rule", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const { engine, id } = researchBoard({ random: () => 0 });
  const taken = ALL_T.slice(0, 4).map(id);
  const unshuffled = deckOf(engine, P1).filter((c) => !taken.includes(c));
  play(engine, P1, id("ar"));
  drainPicking(engine, taken);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(RESEARCH, "0:rule", "the deck is shuffled even when you take no tactic at all (you searched, and may fail, CR 312.2)", () => {
  const { engine, id } = researchBoard({ random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  play(engine, P1, id("ar"));
  drainPicking(engine, []);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "searched decks are shuffled whether or not a card was found");
});

clause(RESEARCH, "0:rule", "the deck is shuffled afterwards (CR 312.1) even when there is no tactic in it to find", () => {
  const { engine, id } = researchBoard({ tactics: 0, random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  play(engine, P1, id("ar"));
  drainPicking(engine, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "the deck was searched, so it is shuffled even though there was nothing to find");
});

clause(RESEARCH, "0:rule", "with no tactic in the deck it still resolves cleanly: Arcane Research is discarded, the cost is paid, nothing else changes", () => {
  const { engine, id } = researchBoard({ tactics: 0 });
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  play(engine, P1, id("ar"));
  drainPicking(engine, []);
  assert.equal(engine.state.pendingChoice, undefined, "no stuck prompt");
  assert.equal(zoneOf(engine, id("ar")), "discard");
  assert.equal(before - ready(engine), 2);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
});

clause(RESEARCH, "0:rule", "puts cards into the discard pile, not the hand: no card is drawn or returned", () => {
  const { engine, id } = researchBoard();
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("ar"));
  drainPicking(engine, ALL_T.slice(0, 4).map(id));
  assert.equal(handOf(engine, P1).length, handBefore - 1, "only Arcane Research left the hand");
});

clause(RESEARCH, "0:rule", "is refused one resource short of its cost of 2, allowed with exactly 2", () => {
  const short = researchBoard({ icons: { obsession: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("ar")), "one resource");
  assert.equal(zoneOf(short.engine, short.id("ar")), "hand");
  const exact = researchBoard({ icons: { obsession: 2 } });
  play(exact.engine, P1, exact.id("ar"));
  drainPicking(exact.engine, ALL_T.slice(0, 4).map(exact.id));
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("t0")), "discard");
});

clause(RESEARCH, "0:rule", "needs [O]: plenty of other resources are not enough", () => {
  const none = researchBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("ar")), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("ar")), "hand");
  const one = researchBoard({ icons: { greed: 5, obsession: 1 } });
  play(one.engine, P1, one.id("ar"));
  drainPicking(one.engine, ["t0"].map(one.id));
  assert.equal(zoneOf(one.engine, one.id("t0")), "discard", "one [O] is enough");
});

clause(RESEARCH, "0:rule", "can be played in response to an opponent's action (it is a tactic)", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ar", def: printing(RESEARCH), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...tactics("t", 3, P1, "deck"),
      ...res({ obsession: 3 })
    ]
  });
  refused(() => playRaw(engine, P1, id("ar")), "no window to respond in yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("ar"));
  resolvePendingResponses(engine);
  drainPicking(engine, ["t0", "t1"].map(id));
  assert.equal(zoneOf(engine, id("t0")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "discard");
});

// =================================================================================
// Brainbath
// Draw 2 cards. Put a card from your hand on the bottom of your deck.
// RECUR: [O][O] -- COST: Use this only if this card is in your discard pile. Pay 4.
// Remove this card from the game. -- EFFECT: Your opponent discards a card. Draw a card.
// Tactic, cost 1, [O][O].
// =================================================================================

const BRAINBATH = "a037259c-6b3d-4e9a-ae5d-ca91c19c6817";

function brainbathBoard(
  opts: { icons?: Icons; deck?: number; hand?: number; bb?: "hand" | "discard" | "deck" | "play" | "removed"; oppHand?: number; turn?: number; active?: PlayerId } = {}
) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BRAINBATH), owner: P1, zone: opts.bb ?? "hand" },
      ...cards("d", opts.deck ?? 5, P1, "deck"),
      ...cards("h", opts.hand ?? 2, P1, "hand"),
      ...cards("oh", opts.oppHand ?? 3, P2, "hand"),
      ...cards("od", 3, P2, "deck"),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "disc", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { obsession: 8 })
    ]
  });
}

clause(BRAINBATH, "0:rule", "pays exactly 1; draws 2 cards (the top two of the deck), then puts a card from the hand on the bottom of the deck", () => {
  const { engine, id } = brainbathBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const before = ready(engine);
  play(engine, P1, id("bb"));
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  assert.deepEqual(
    handOf(engine, P1).filter((c) => deckBefore.slice(0, 2).includes(c)).sort(),
    deckBefore.slice(0, 2).sort(),
    "the top two cards were drawn"
  );
  const pc = pending(engine);
  assert.ok(pc, "the controller is asked which hand card goes on the bottom");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the controller chooses");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h0")), "deck");
  assert.equal(deckOf(engine, P1)[deckOf(engine, P1).length - 1], id("h0"), "it is the bottom card of the deck");
  assert.deepEqual(deckOf(engine, P1).slice(0, 3), deckBefore.slice(2), "the rest of the deck keeps its order, drawn cards gone");
  assert.equal(handOf(engine, P1).length, 2 + 2 - 1, "hand: two old cards, two drawn, one put back (Brainbath itself left)");
  assert.equal(zoneOf(engine, id("bb")), "discard", "Brainbath ends in its owner's discard pile");
});

clause(BRAINBATH, "0:rule", "the card put on the bottom can be one of the two just drawn", () => {
  const { engine, id } = brainbathBoard();
  const drawnTop = deckOf(engine, P1)[0];
  const drawnSecond = deckOf(engine, P1)[1];
  play(engine, P1, id("bb"));
  answerPending(engine, "chooserSelectsTarget", { selected: [drawnTop] });
  assert.equal(deckOf(engine, P1)[deckOf(engine, P1).length - 1], drawnTop, "the just-drawn card is on the bottom");
  assert.equal(zoneOf(engine, drawnSecond), "hand", "the other drawn card stays in hand");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(BRAINBATH, "0:rule", "the card put on the bottom can be a card that was already in the hand", () => {
  const { engine, id } = brainbathBoard();
  const drawn = deckOf(engine, P1).slice(0, 2);
  play(engine, P1, id("bb"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(deckOf(engine, P1)[deckOf(engine, P1).length - 1], id("h1"));
  for (const card of drawn) assert.equal(zoneOf(engine, card), "hand");
  assert.equal(zoneOf(engine, id("h0")), "hand");
});

clause(BRAINBATH, "0:rule", "exactly one card goes to the bottom: a pick of none or of two is refused", () => {
  const { engine, id } = brainbathBoard();
  play(engine, P1, id("bb"));
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith([]), "putting nothing back is not allowed");
  refused(answerWith(["h0", "h1"]), "putting two back is not allowed");
  assert.ok(pending(engine), "the choice is still open");
  answerWith(["h0"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("h0")), "deck", "control: one card is fine");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(BRAINBATH, "0:rule", "the card must come from YOUR HAND: the opponent's hand, a card in play and a card in the discard pile are refused", () => {
  const { engine, id } = brainbathBoard();
  play(engine, P1, id("bb"));
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["oh0"]), "a card in the opponent's hand");
  refused(answerWith(["inPlay"]), "a card in play");
  refused(answerWith(["disc"]), "a card in my discard pile");
  refused(answerWith(["od0"]), "a card in the opponent's deck");
  answerWith(["h0"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("h0")), "deck", "control: a hand card is accepted");
  assert.equal(zoneOf(engine, id("oh0")), "hand", "the opponent's hand was not touched");
});

clause(BRAINBATH, "0:rule", "the opponent's deck and hand are untouched; only I draw", () => {
  const { engine, id } = brainbathBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("bb"));
  drainPicking(engine, [id("h0")]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(BRAINBATH, "0:rule", "with only 1 card in the deck it draws that card (CR 306.2), then you still put a card on the bottom", () => {
  const { engine, id } = brainbathBoard({ deck: 1 });
  play(engine, P1, id("bb"));
  assert.equal(zoneOf(engine, id("d0")), "hand", "the only deck card was drawn");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] });
  assert.deepEqual(deckOf(engine, P1), [id("h0")], "the deck now holds just the card put back");
});

clause(BRAINBATH, "0:rule", "with an empty deck it draws nothing, and you still put a card from your hand on the (empty) deck", () => {
  const { engine, id } = brainbathBoard({ deck: 0 });
  play(engine, P1, id("bb"));
  assert.equal(engine.state.winner, undefined, "no loss for an empty deck");
  drainPicking(engine, [id("h0")]);
  assert.deepEqual(deckOf(engine, P1), [id("h0")]);
});

clause(BRAINBATH, "0:rule", "with an empty deck and an empty hand nothing happens and the game is not stuck", () => {
  const { engine, id } = brainbathBoard({ deck: 0, hand: 0 });
  play(engine, P1, id("bb"));
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("bb")), "discard");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(BRAINBATH, "0:rule", "the draw is of exactly 2 (not 1, not 3) when the deck is large", () => {
  const { engine, id } = brainbathBoard({ deck: 9 });
  play(engine, P1, id("bb"));
  assert.equal(deckOf(engine, P1).length, 9 - 2);
  drainPicking(engine, [id("h0")]);
  assert.equal(deckOf(engine, P1).length, 9 - 2 + 1);
});

clause(BRAINBATH, "0:rule", "is refused one resource short of its cost of 1, allowed with exactly 1 resource that is [O][O]-backed", () => {
  const none = brainbathBoard({ icons: {} });
  refused(() => playRaw(none.engine, P1, none.id("bb")), "no resources");
  assert.equal(zoneOf(none.engine, none.id("bb")), "hand");
  const exact = brainbathBoard({ icons: { obsession: 2 } });
  play(exact.engine, P1, exact.id("bb"));
  drainPicking(exact.engine, [exact.id("h0")]);
  assert.equal(ready(exact.engine), 1, "one of two resources was spent");
  assert.equal(zoneOf(exact.engine, exact.id("bb")), "discard");
});

clause(BRAINBATH, "0:rule", "needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = brainbathBoard({ icons: { obsession: 1, greed: 6 } });
  refused(() => playRaw(one.engine, P1, one.id("bb")), "only one [O]");
  const noneAtAll = brainbathBoard({ icons: { greed: 6 } });
  refused(() => playRaw(noneAtAll.engine, P1, noneAtAll.id("bb")), "no [O]");
  const two = brainbathBoard({ icons: { obsession: 2, greed: 4 } });
  play(two.engine, P1, two.id("bb"));
  drainPicking(two.engine, [two.id("h0")]);
  assert.equal(zoneOf(two.engine, two.id("bb")), "discard", "two [O] is enough");
  const opponentsOnly = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "bb", def: printing(BRAINBATH), owner: P1, zone: "hand" }, ...res({ greed: 4 }), ...res({ obsession: 4 }, P2)]
  });
  refused(() => playRaw(opponentsOnly.engine, P1, opponentsOnly.id("bb")), "the opponent's [O] do not count");
});

// --- RECUR ---------------------------------------------------------------------

function recur(engine: SpoilsEngine, id: (key: string) => CardInstanceId, player: PlayerId = P1) {
  engine.perform({ type: "activateAbility", playerId: player, cardId: id("bb"), abilityId: "recur", selected: {}, variables: {} } as never);
}

clause(BRAINBATH, "1:ability:recur", "from the discard pile it pays exactly 4, removes Brainbath from the game, makes the opponent discard a card and draws a card for you", () => {
  const { engine, id } = brainbathBoard({ bb: "discard" });
  const before = ready(engine);
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = handOf(engine, P1).length;
  const oppHandBefore = handOf(engine, P2).length;
  recur(engine, id);
  assert.equal(before - ready(engine), 4, "Pay 4");
  assert.equal(zoneOf(engine, id("bb")), "removed", "Remove this card from the game");
  resolvePendingResponses(engine);
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("oh1")), "discard", "the opponent's chosen card is discarded");
  assert.equal(handOf(engine, P2).length, oppHandBefore - 1, "exactly one card");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "I drew exactly one card");
  assert.equal(zoneOf(engine, deckBefore[0]), "hand", "the top card of my deck");
});

clause(BRAINBATH, "1:ability:recur", "the OPPONENT chooses which card they discard (not me)", () => {
  const { engine, id } = brainbathBoard({ bb: "discard" });
  recur(engine, id);
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "a discard choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent picks their own discard");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("oh0")] } } as never),
    "I cannot answer the opponent's choice"
  );
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh2")] });
  assert.equal(zoneOf(engine, id("oh2")), "discard");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("oh1")), "hand");
});

clause(BRAINBATH, "1:ability:recur", "the card discarded must come from the opponent's hand: my hand cards and cards in play cannot be chosen", () => {
  const { engine, id } = brainbathBoard({ bb: "discard" });
  recur(engine, id);
  resolvePendingResponses(engine);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["h0"]), "a card in MY hand");
  refused(answerWith(["inPlay"]), "a card in play");
  refused(answerWith([]), "they must discard a card");
  refused(answerWith(["oh0", "oh1"]), "only one card");
  answerWith(["oh0"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oh0")), "discard", "control: one card from their hand");
  assert.equal(zoneOf(engine, id("h0")), "hand");
});

clause(BRAINBATH, "1:ability:recur", "if the opponent has no cards in hand they discard nothing, and I still draw a card", () => {
  const { engine, id } = brainbathBoard({ bb: "discard", oppHand: 0 });
  const deckBefore = [...deckOf(engine, P1)];
  recur(engine, id);
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined, "no stuck prompt");
  assert.equal(zoneOf(engine, deckBefore[0]), "hand", "the draw still happens");
  assert.equal(zoneOf(engine, id("bb")), "removed");
});

clause(BRAINBATH, "1:ability:recur", "with an empty deck the opponent still discards (no draw, no loss)", () => {
  const { engine, id } = brainbathBoard({ bb: "discard", deck: 0 });
  recur(engine, id);
  resolvePendingResponses(engine);
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh0")] });
  assert.equal(zoneOf(engine, id("oh0")), "discard");
  assert.equal(engine.state.winner, undefined);
});

clause(BRAINBATH, "1:ability:recur", "can only be used when Brainbath is in your discard pile: from the hand, the deck, in play or already removed it is refused", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const { engine, id } = brainbathBoard({ bb: zone });
    refused(() => recur(engine, id), `Brainbath in ${zone}`);
    assert.equal(ready(engine), 8, "nothing was paid");
  }
  const ok = brainbathBoard({ bb: "discard" });
  recur(ok.engine, ok.id);
  assert.equal(zoneOf(ok.engine, ok.id("bb")), "removed", "control: from the discard pile it works");
});

clause(BRAINBATH, "1:ability:recur", "it is YOUR discard pile that counts: the opponent's Brainbath in their discard pile cannot be recurred by me", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BRAINBATH), owner: P2, zone: "discard" },
      ...cards("oh", 2, P2, "hand"),
      ...cards("d", 3, P1, "deck"),
      ...res({ obsession: 8 })
    ]
  });
  refused(() => recur(engine, id, P1), "not my discard pile");
  assert.equal(zoneOf(engine, id("bb")), "discard");
  assert.equal(ready(engine), 8);
});

clause(BRAINBATH, "1:ability:recur", "is refused one resource short of Pay 4, allowed with exactly 4", () => {
  const short = brainbathBoard({ bb: "discard", icons: { obsession: 3 } });
  refused(() => recur(short.engine, short.id), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("bb")), "discard", "nothing happened");
  const exact = brainbathBoard({ bb: "discard", icons: { obsession: 4 } });
  recur(exact.engine, exact.id);
  assert.equal(ready(exact.engine), 0, "all four spent");
  assert.equal(zoneOf(exact.engine, exact.id("bb")), "removed");
});

clause(BRAINBATH, "1:ability:recur", "needs [O][O]: one [O] with many other resources is refused, two [O] are accepted", () => {
  const one = brainbathBoard({ bb: "discard", icons: { obsession: 1, greed: 8 } });
  refused(() => recur(one.engine, one.id), "only one [O]");
  assert.equal(zoneOf(one.engine, one.id("bb")), "discard");
  const none = brainbathBoard({ bb: "discard", icons: { greed: 8 } });
  refused(() => recur(none.engine, none.id), "no [O]");
  const two = brainbathBoard({ bb: "discard", icons: { obsession: 2, greed: 2 } });
  recur(two.engine, two.id);
  assert.equal(zoneOf(two.engine, two.id("bb")), "removed", "two [O] and four resources in total is enough");
});

clause(BRAINBATH, "1:ability:recur", "it is an ability, not a tactic play: it works on the opponent's turn in response to their action", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BRAINBATH), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...cards("oh", 2, P2, "hand"),
      ...cards("d", 3, P1, "deck"),
      ...res({ obsession: 6 })
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  recur(engine, id);
  resolvePendingResponses(engine);
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh0")] });
  assert.equal(zoneOf(engine, id("bb")), "removed");
  assert.equal(zoneOf(engine, id("oh0")), "discard");
  assert.equal(zoneOf(engine, id("d0")), "hand", "and I drew");
});

clause(BRAINBATH, "1:ability:recur", "it can be used only once: the removed card is gone for the rest of the game", () => {
  const { engine, id } = brainbathBoard({ bb: "discard", icons: { obsession: 8 } });
  recur(engine, id);
  resolvePendingResponses(engine);
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh0")] });
  refused(() => recur(engine, id), "the card was removed from the game");
  assert.equal(ready(engine), 4, "only the first use was paid");
});

clause(BRAINBATH, "1:ability:recur", "it does not draw 2 or put a card back: it draws exactly one and leaves my hand otherwise alone", () => {
  const { engine, id } = brainbathBoard({ bb: "discard", deck: 6 });
  recur(engine, id);
  resolvePendingResponses(engine);
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh0")] });
  assert.equal(deckOf(engine, P1).length, 5, "one card drawn, none put back");
  assert.equal(handOf(engine, P1).length, 3, "two cards plus the one drawn");
});

// =================================================================================
// Confounding Conjurer
// COST: You may pick a character. -- When this card enters play, if you picked a
// character as part of its cost, put that character into its owner's hand.
// Character (wizard), cost 4, [O][O], 1 strength / 2 speed / 3 life.
// =================================================================================

const CONJURER = "9559b131-09f2-4dfd-884e-8fd07106045e";

/** A free tactic that terminates the card being deployed (a counterspell for the test). */
const counterTactic = () =>
  tactic({
    name: "Counter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "counter",
          type: "activated",
          targets: [{ id: "dep", selector: { zone: "deploying" }, count: 1 }],
          effects: [{ type: "terminate", target: { type: "selected", id: "dep" } }]
        }
      ]
    }
  });

function conjurerBoard(opts: { icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CONJURER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(CONJURER, "0:ability", "deploys for exactly 4 and enters play with its printed 1 strength / 2 speed / 3 life", () => {
  const { engine, id } = conjurerBoard();
  const before = ready(engine);
  play(engine, P1, id("cc"), { selected: { c: [] } });
  settled(engine);
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(engine.getStat(id("cc"), "strength"), 1);
  assert.equal(engine.getStat(id("cc"), "speed"), 2);
  assert.equal(engine.getStat(id("cc"), "life"), 3);
});

clause(CONJURER, "0:ability", "the pick is optional ('may'): it deploys with no pick at all, and then nothing is returned to a hand", () => {
  const { engine, id } = conjurerBoard();
  const oppHand = handOf(engine, P2).length;
  play(engine, P1, id("cc"));
  settled(engine);
  assert.equal(zoneOf(engine, id("cc")), "play");
  for (const key of ["foe", "foe2", "mine", "mine2"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays in play`);
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.equal(handOf(engine, P1).length, 0, "my hand is empty: nothing came back");
});

clause(CONJURER, "0:ability", "picking an opposing character: it is put into ITS OWNER's hand when the Conjurer enters play, and no other character moves", () => {
  const { engine, id } = conjurerBoard();
  play(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "in the opponent's (its owner's) hand");
  assert.equal(zoneOf(engine, id("foe2")), "play", "the other opposing character stays");
  assert.equal(zoneOf(engine, id("mine")), "play", "my characters stay");
  assert.equal(zoneOf(engine, id("mine2")), "play");
});

clause(CONJURER, "0:ability", "picking one of your own characters: it is put into your hand", () => {
  const { engine, id } = conjurerBoard();
  play(engine, P1, id("cc"), { selected: { c: [id("mine")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.ok(handOf(engine, P1).includes(id("mine")), "handOf(engine, P1).includes(id(\"mine\"))");
  assert.equal(zoneOf(engine, id("mine2")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(CONJURER, "0:ability", "the character goes to its OWNER's hand, not the controller's: a character I took from my opponent returns to their hand", () => {
  const { engine, id } = conjurerBoard({
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]
  });
  play(engine, P1, id("cc"), { selected: { c: [id("stolen")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("stolen")), "hand");
  assert.ok(handOf(engine, P2).includes(id("stolen")), "its owner's hand");
  assert.equal(handOf(engine, P1).includes(id("stolen")), false, "not mine");
});

clause(CONJURER, "0:ability", "the returned character comes back as a fresh card: its damage is gone", () => {
  const { engine, id } = conjurerBoard({
    extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 3, depleted: true }]
  });
  play(engine, P1, id("cc"), { selected: { c: [id("hurt")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("hurt")), "hand");
  assert.equal(engine.state.cards[id("hurt")].damage, 0, "damage is cleared when a card changes game areas (CR 408.9)");
  assert.equal(engine.state.cards[id("hurt")].depleted, false);
});

clause(CONJURER, "0:ability", "the character is not returned until the Conjurer enters play: while it waits for responses the pick is still in play", () => {
  const { engine, id } = conjurerBoard();
  playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("cc")), "deploying");
  assert.equal(zoneOf(engine, id("foe")), "play", "the pick is only made as a cost; nothing moves yet");
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "returned once the Conjurer entered play");
});

clause(CONJURER, "0:ability", "only a character can be picked: an item, a location, a faction and cards outside play are refused", () => {
  const { engine, id } = conjurerBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  const attempt = (target: CardInstanceId) => () => playRaw(engine, P1, id("cc"), { selected: { c: [target] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(engine.state.players[P2].factionId!), "a faction (CR 202.9)");
  refused(attempt(engine.state.players[P1].factionId!), "my own faction");
  refused(attempt(id("inHand")), "a character in a hand");
  refused(attempt(id("inDiscard")), "a character in a discard pile");
  refused(attempt(id("inDeck")), "a character in a deck");
  refused(attempt(id("fd")), "a face-down card is a resource, not a character (CR 411.1)");
  assert.equal(zoneOf(engine, id("cc")), "hand", "nothing was played");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "control: a character in play is accepted");
});

clause(CONJURER, "0:ability", "at most one character can be picked: two picks are refused", () => {
  const { engine, id } = conjurerBoard();
  refused(() => playRaw(engine, P1, id("cc"), { selected: { c: [id("foe"), id("foe2")] } }), "two picks");
  refused(() => playRaw(engine, P1, id("cc"), { selected: { c: [id("foe"), id("mine")] } }), "two picks, one of each side");
  assert.equal(zoneOf(engine, id("cc")), "hand");
  playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  assert.ok(engine.state.responseWindow, "control: one pick is accepted");
});

clause(CONJURER, "1:rule", "triggers only when THIS card enters play: another character entering play returns nothing", () => {
  const { engine, id } = conjurerBoard({
    extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "the first Conjurer bounced its pick");
  // A second character entering play afterwards does not bounce anything else.
  play(engine, P1, id("ally"));
  settled(engine);
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(zoneOf(engine, id("foe2")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(CONJURER, "1:rule", "the return is conditional on having PICKED a character as part of the cost: put into play by another effect (no cost, no pick) it returns nothing", () => {
  const putter = tactic({
    name: "Putter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = conjurerBoard({ extra: [{ key: "putter", def: putter, owner: P1, zone: "hand" }] });
  play(engine, P1, id("putter"), { selected: { t: [id("cc")] } });
  settled(engine);
  assert.equal(zoneOf(engine, id("cc")), "play", "the Conjurer was put into play");
  for (const key of ["foe", "foe2", "mine", "mine2"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} was not returned`);
});

clause(CONJURER, "1:rule", "if the Conjurer is terminated while it is being deployed it never enters play, so the picked character is NOT returned", () => {
  const { engine, id } = conjurerBoard({
    extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  respondWith(engine, P2, id("counter"), { dep: [id("cc")] });
  settled(engine);
  assert.equal(zoneOf(engine, id("cc")), "discard", "terminated: the Conjurer goes to its owner's discard pile (CR 314.1)");
  assert.equal(zoneOf(engine, id("foe")), "play", "it never entered play, so its pick was not returned");
});

clause(CONJURER, "1:rule", "if the picked character is destroyed in response, it stays in the discard pile and is not pulled back into a hand (CR 402.4)", () => {
  const { engine, id } = conjurerBoard({
    extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  settled(engine);
  assert.equal(zoneOf(engine, id("cc")), "play", "the Conjurer entered play");
  assert.equal(zoneOf(engine, id("foe")), "discard", "the character left play before the trigger, so it is not put into a hand from the discard pile");
});

clause(CONJURER, "1:rule", "if the picked character left play and returned to the same hand in response (bounced), the trigger does nothing more", () => {
  const bounce = tactic({
    name: "BounceResp",
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
  const { engine, id } = conjurerBoard({ extra: [{ key: "bounce", def: bounce, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } });
  respondWith(engine, P2, id("bounce"), { t: [id("foe")] });
  settled(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(handOf(engine, P2).filter((c) => c === id("foe")).length, 1, "it is in the hand exactly once");
  assert.equal(zoneOf(engine, id("cc")), "play");
});

clause(CONJURER, "0:ability", "is refused one resource short of its cost of 4, allowed with exactly 4", () => {
  const short = conjurerBoard({ icons: { obsession: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("cc"), { selected: { c: [short.id("foe")] } }), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("cc")), "hand");
  const exact = conjurerBoard({ icons: { obsession: 4 } });
  play(exact.engine, P1, exact.id("cc"), { selected: { c: [exact.id("foe")] } });
  settled(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("cc")), "play");
  assert.equal(ready(exact.engine), 0);
});

clause(CONJURER, "0:ability", "needs [O][O]: one [O] among many resources is refused, two are accepted", () => {
  const one = conjurerBoard({ icons: { obsession: 1, greed: 6 } });
  refused(() => playRaw(one.engine, P1, one.id("cc")), "one [O]");
  const none = conjurerBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("cc")), "no [O]");
  const two = conjurerBoard({ icons: { obsession: 2, greed: 2 } });
  play(two.engine, P1, two.id("cc"));
  settled(two.engine);
  assert.equal(zoneOf(two.engine, two.id("cc")), "play");
});

clause(CONJURER, "0:ability", "is a character: it can only be deployed on its controller's own turn", () => {
  const { engine, id } = conjurerBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("cc"), { selected: { c: [id("foe")] } }), "the opponent's turn");
  assert.equal(zoneOf(engine, id("cc")), "hand");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

// =================================================================================
// Cryptic Athenaeum
// UNIQUE CRYPTIC ATHENAEUM
// [O][O][O]: At the start of your turn, you may draw a card. If you do, your opponent may draw a card.
// [O]x5: At the start of your turn, your opponent discards a card.
// [O]x7: At the start of your turn, you may pick a character. If you do, put it into its owner's hand.
// Location, cost 3, [O], structure 5.
// =================================================================================

const ATHENAEUM = "12b6d2a3-5b34-4914-bcc4-20ddb1ad39ba";

interface TurnPolicy {
  /** Whether P1 accepts a draw offer (default true). */
  draw?: boolean;
  /** Whether P2 accepts a draw offer (default true). */
  oppDraw?: boolean;
  /** Card (instance id) the opponent discards when asked. */
  discard?: CardInstanceId;
  /** Characters the controller picks when asked (default none). */
  pick?: CardInstanceId[];
}

/** Everything a player was asked during a turn start, as "<player>:<kind>". */
type Prompts = string[];

/** Answers every prompt of a start-of-turn per `policy`, recording what was asked. */
function answerTurnStart(engine: SpoilsEngine, policy: TurnPolicy = {}): Prompts {
  const seen: Prompts = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    if (pc.kind === "chooserSelectsOption") {
      const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
      const accept = pc.playerId === P1 ? policy.draw !== false : policy.oppDraw !== false;
      return { kind: "chooserSelectsOption", index: accept ? labels.findIndex((l) => l !== "Decline") : labels.indexOf("Decline") };
    }
    if (pc.kind === "chooserSelectsTarget") {
      if (pc.playerId === P2) return { kind: "chooserSelectsTarget", selected: policy.discard ? [policy.discard] : [] };
      return { kind: "chooserSelectsTarget", selected: policy.pick ?? [] };
    }
    return declineAll(pc);
  });
  return seen;
}

function athenaeumBoard(
  opts: {
    obsession?: number;
    other?: Icons;
    faceDown?: number;
    oppObsession?: number;
    ath?: "play" | "hand" | "discard";
    controller?: PlayerId;
    oppHand?: number;
    myHand?: number;
    deck?: number;
    oppDeck?: number;
    startAs?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const startAs = opts.startAs ?? P1;
  const controller = opts.controller ?? P1;
  return buildGame({
    turn: 2,
    activePlayerId: other(startAs),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ath", def: printing(ATHENAEUM), owner: controller, zone: opts.ath ?? "play" },
      ...res({ obsession: opts.obsession ?? 3, ...(opts.other ?? {}) }, controller),
      ...volition(opts.faceDown ?? 0, controller),
      ...res({ obsession: opts.oppObsession ?? 0 }, other(controller)),
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      ...cards("d", opts.deck ?? 4, P1, "deck"),
      ...cards("e", opts.oppDeck ?? 4, P2, "deck"),
      ...cards("h", opts.myHand ?? 2, P1, "hand"),
      ...cards("oh", opts.oppHand ?? 3, P2, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

/**
 * Starts P1's turn and answers prompts (ordering triggers first, declining draw offers, the opponent
 * discarding `discard`) until a prompt satisfying `stopAt` is open, which it returns.
 */
function turnStartUntil(
  engine: SpoilsEngine,
  stopAt: (pc: PendingChoiceLike) => boolean,
  discard?: CardInstanceId
): PendingChoiceLike {
  endTurn(engine, P2);
  for (let guard = 0; guard < 12; guard++) {
    const pc = pending(engine);
    assert.ok(pc, "expected the awaited prompt to be open");
    if (stopAt(pc)) return pc;
    if (pc.kind === "orderTriggers") answerPending(engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else if (pc.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 0 });
    else answerPending(engine, "chooserSelectsTarget", { selected: discard ? [discard] : [] });
  }
  throw new Error("turnStartUntil: the awaited prompt never opened");
}

/** Starts the turn of `player` (the other player ends theirs) and answers per `policy`. */
function startTurnOf(engine: SpoilsEngine, player: PlayerId, policy: TurnPolicy = {}): Prompts {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has changed hands");
  return answerTurnStart(engine, policy);
}

// --- UNIQUE ---------------------------------------------------------------------

function twoAthenaeums(opts: { second?: "hand" | "oppPlay" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: (
      [
        { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
        { key: "ath2", def: printing(ATHENAEUM), owner: P1, zone: "hand" },
        { key: "oppAth", def: printing(ATHENAEUM), owner: P2, zone: "play" },
        ...res({ obsession: 3 })
      ] as CardPlacement[]
    ).filter((c) => (opts.second === "oppPlay" ? c.key !== "ath2" : c.key !== "oppAth"))
  });
}

clause(ATHENAEUM, "0:unique", "deploying a second copy while you control one forces you to choose which to keep (keep the new one: the old is destroyed)", () => {
  const { engine, id } = twoAthenaeums();
  play(engine, P1, id("ath2"));
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("ath"), id("ath2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("ath2") });
  assert.equal(zoneOf(engine, id("ath2")), "play");
  assert.equal(zoneOf(engine, id("ath")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ATHENAEUM, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = twoAthenaeums();
  play(engine, P1, id("ath2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("ath") });
  assert.equal(zoneOf(engine, id("ath")), "play");
  assert.equal(zoneOf(engine, id("ath2")), "discard");
});

clause(ATHENAEUM, "0:unique", "UNIQUE only concerns your own cards: your opponent may have their own copy in play with no choice and no destruction", () => {
  const { engine, id } = twoAthenaeums({ second: "oppPlay" });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ath")), "play");
  assert.equal(zoneOf(engine, id("oppAth")), "play");
});

clause(ATHENAEUM, "0:unique", "the opponent deploying their own copy while I control one is fine", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
      { key: "oppAth", def: printing(ATHENAEUM), owner: P2, zone: "hand" },
      ...res({ obsession: 3 }, P2)
    ]
  });
  play(engine, P2, id("oppAth"));
  assert.equal(engine.state.pendingChoice, undefined, "no unique prompt for the opponent");
  assert.equal(zoneOf(engine, id("oppAth")), "play");
  assert.equal(zoneOf(engine, id("ath")), "play");
});

clause(ATHENAEUM, "0:unique", "taking control of the opponent's copy while you control one forces a choice (FAQ)", () => {
  const takeControlTactic = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", owner: "opponent", type: "location" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
      { key: "oppAth", def: printing(ATHENAEUM), owner: P2, zone: "play" },
      { key: "steal", def: takeControlTactic, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("oppAth")] } });
  const pc = pending(engine);
  assert.ok(pc, "now I control two copies");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
});

clause(ATHENAEUM, "0:unique", "the designation is what counts, not the name: another location with the same UNIQUE designation conflicts, one with a different designation does not", () => {
  const sameDesignation = location({ name: "Totally Different Name", unique: "cryptic athenaeum" });
  const otherDesignation = location({ name: "Another Place", unique: "something else" });
  const conflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
      { key: "same", def: sameDesignation, owner: P1, zone: "hand" }
    ]
  });
  play(conflict.engine, P1, conflict.id("same"));
  assert.equal(pending(conflict.engine)?.kind, "uniqueSurvivor", "same designation: a choice");
  const noConflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
      { key: "diff", def: otherDesignation, owner: P1, zone: "hand" }
    ]
  });
  play(noConflict.engine, P1, noConflict.id("diff"));
  assert.equal(noConflict.engine.state.pendingChoice, undefined, "different designation: no choice");
  assert.equal(zoneOf(noConflict.engine, noConflict.id("ath")), "play");
  assert.equal(zoneOf(noConflict.engine, noConflict.id("diff")), "play");
});

clause(ATHENAEUM, "0:unique", "a single copy deploys for exactly 3 and needs [O]", () => {
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "hand" }, ...res({ obsession: 4 })]
  });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ath"));
  assert.equal(before - ready(ok.engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(ok.engine, ok.id("ath")), "play");
  assert.equal(ok.engine.state.pendingChoice, undefined, "a lone copy needs no choice");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "hand" }, ...res({ obsession: 2 })]
  });
  refused(() => playRaw(short.engine, P1, short.id("ath")), "2 resources");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "hand" }, ...res({ greed: 6 })]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ath")), "no [O]");
});

// --- [O][O][O]: draw offer ----------------------------------------------------------

clause(ATHENAEUM, "1:rule@ooo", "with 3 [O], at the start of my turn I may draw: accepting draws exactly one card (the top of my deck) and then the opponent is offered a draw", () => {
  const { engine, id } = athenaeumBoard({ obsession: 3 });
  const myTop = deckOf(engine, P1)[0];
  const oppTop = deckOf(engine, P2)[0];
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const seen = startTurnOf(engine, P1, { draw: true, oppDraw: true });
  assert.deepEqual(seen, ["p1:chooserSelectsOption", "p2:chooserSelectsOption"], "I was asked, then the opponent was asked");
  assert.equal(handOf(engine, P1).length, myHand + 1, "I drew exactly one card");
  assert.equal(zoneOf(engine, myTop), "hand");
  assert.equal(handOf(engine, P2).length, oppHand + 1, "the opponent drew exactly one card");
  assert.equal(zoneOf(engine, oppTop), "hand");
  assert.equal(zoneOf(engine, id("ath")), "play");
});

clause(ATHENAEUM, "1:rule@ooo", "the opponent may decline their draw (they draw nothing), while I still keep mine", () => {
  const { engine } = athenaeumBoard({ obsession: 3 });
  const myTop = deckOf(engine, P1)[0];
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const oppDeck = [...deckOf(engine, P2)];
  const seen = startTurnOf(engine, P1, { draw: true, oppDraw: false });
  assert.deepEqual(seen, ["p1:chooserSelectsOption", "p2:chooserSelectsOption"]);
  assert.equal(handOf(engine, P1).length, myHand + 1);
  assert.equal(zoneOf(engine, myTop), "hand");
  assert.equal(handOf(engine, P2).length, oppHand, "the opponent declined");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(ATHENAEUM, "1:rule@ooo", "'you MAY draw': if I decline I draw nothing, and 'if you do' means the opponent is not even offered a draw", () => {
  const { engine } = athenaeumBoard({ obsession: 3 });
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  const seen = startTurnOf(engine, P1, { draw: false });
  assert.deepEqual(seen, ["p1:chooserSelectsOption"], "only I was asked");
  assert.equal(handOf(engine, P1).length, myHand);
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(ATHENAEUM, "1:rule@ooo", "the opponent's draw is their own decision: it is the opponent who answers the second offer", () => {
  const { engine } = athenaeumBoard({ obsession: 3 });
  endTurn(engine, P2);
  answerBy(engine, "chooserSelectsOption", P1, { index: 1 });
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the second offer goes to the opponent");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never),
    "I cannot answer for the opponent"
  );
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(engine.state.pendingChoice, undefined);
});

for (const [obsession, active] of [
  [3, true],
  [4, true],
  [2, false],
  [1, false],
  [0, false]
] as const) {
  clause(ATHENAEUM, "1:rule@ooo", `threshold: with ${obsession} [O] the draw offer is ${active ? "made" : "NOT made"} at the start of my turn`, () => {
    const { engine } = athenaeumBoard({ obsession });
    const myHand = handOf(engine, P1).length;
    const seen = startTurnOf(engine, P1);
    assert.equal(seen.includes("p1:chooserSelectsOption"), active);
    assert.equal(handOf(engine, P1).length, active ? myHand + 1 : myHand);
  });
}

clause(ATHENAEUM, "1:rule@ooo", "threshold: [O] is the icon that counts: 8 resources of other icons do not turn it on", () => {
  const { engine } = athenaeumBoard({ obsession: 2, other: { greed: 4, rage: 4 } });
  const seen = startTurnOf(engine, P1);
  assert.deepEqual(seen, []);
});

clause(ATHENAEUM, "1:rule@ooo", "threshold: 2 [O] plus a third from other icons is not 3 [O]; 3 [O] among other resources is enough", () => {
  const enough = athenaeumBoard({ obsession: 3, other: { greed: 4 } });
  assert.deepEqual(startTurnOf(enough.engine, P1).slice(0, 1), ["p1:chooserSelectsOption"]);
});

clause(ATHENAEUM, "1:rule@ooo", "threshold: face-down resources provide Volition, not [O], so they do not count", () => {
  const { engine } = athenaeumBoard({ obsession: 2, faceDown: 3 });
  assert.deepEqual(startTurnOf(engine, P1), []);
});

clause(ATHENAEUM, "1:rule@ooo", "threshold: the opponent's [O] do not count for me", () => {
  const { engine } = athenaeumBoard({ obsession: 0, oppObsession: 7 });
  assert.deepEqual(startTurnOf(engine, P1), []);
});

clause(ATHENAEUM, "1:rule@ooo", "'at the start of YOUR turn': at the start of the opponent's turn nothing happens, even with the threshold", () => {
  const { engine } = athenaeumBoard({ obsession: 7, startAs: P2, controller: P1 });
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const seen = startTurnOf(engine, P2);
  assert.deepEqual(seen, [], "no prompts on the opponent's turn start");
  assert.equal(handOf(engine, P1).length, myHand);
  assert.equal(handOf(engine, P2).length, oppHand);
});

clause(ATHENAEUM, "1:rule@ooo", "'your' means the controller: an Athenaeum I do not control does nothing at the start of my turn, but works for its controller", () => {
  // P2 controls the location and has the [O]; it is P1's turn first (nothing), then P2's turn (offer to P2).
  const { engine } = athenaeumBoard({ obsession: 3, controller: P2, startAs: P1 });
  const mine = handOf(engine, P1).length;
  assert.deepEqual(startTurnOf(engine, P1), [], "not my location");
  assert.equal(handOf(engine, P1).length, mine);
  const theirs = handOf(engine, P2).length;
  const seen = startTurnOf(engine, P2, { draw: true, oppDraw: true });
  assert.equal(seen[0], "p2:chooserSelectsOption", "the controller P2 is offered the draw");
  assert.equal(seen[1], "p1:chooserSelectsOption", "and then P1 (their opponent) is offered one");
  assert.equal(handOf(engine, P2).length, theirs + 1);
});

clause(ATHENAEUM, "1:rule@ooo", "only works while the Athenaeum is in play: in the hand or in the discard pile it does nothing", () => {
  for (const ath of ["hand", "discard"] as const) {
    const { engine } = athenaeumBoard({ obsession: 7, ath });
    assert.deepEqual(startTurnOf(engine, P1), [], `Athenaeum in ${ath}`);
  }
});

// --- [O]x5: opponent discards -----------------------------------------------------------

clause(ATHENAEUM, "2:rule@ooooo", "with 5 [O], at the start of my turn my opponent discards exactly one card from their hand, of their own choice", () => {
  const { engine, id } = athenaeumBoard({ obsession: 5 });
  const oppHand = handOf(engine, P2).length;
  const myHand = handOf(engine, P1).length;
  endTurn(engine, P2);
  // Resolve the draw offer first if it comes up, declining it.
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("oh1")] };
    return declineAll(pc);
  });
  assert.ok(seen.includes("p2:chooserSelectsTarget"), "the OPPONENT picks what to discard");
  assert.equal(zoneOf(engine, id("oh1")), "discard");
  assert.equal(handOf(engine, P2).length, oppHand - 1, "exactly one card");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("oh2")), "hand");
  assert.equal(handOf(engine, P1).length, myHand, "my hand is untouched");
});

clause(ATHENAEUM, "2:rule@ooooo", "it is mandatory: the opponent cannot discard nothing, nor two cards, nor a card that is not in their hand", () => {
  const { engine, id } = athenaeumBoard({ obsession: 5 });
  const pc = turnStartUntil(engine, (p) => p.kind === "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent is the one discarding");
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith([]), "discarding nothing");
  refused(answerWith(["oh0", "oh1"]), "discarding two");
  refused(answerWith(["h0"]), "a card in MY hand");
  refused(answerWith(["foe"]), "a card in play");
  answerWith(["oh2"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oh2")), "discard", "control: one card of their own hand");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("h0")), "hand");
});

for (const [obsession, active] of [
  [5, true],
  [6, true],
  [4, false],
  [3, false]
] as const) {
  clause(ATHENAEUM, "2:rule@ooooo", `threshold: with ${obsession} [O] my opponent ${active ? "discards a card" : "does NOT discard"} at the start of my turn`, () => {
    const { engine, id } = athenaeumBoard({ obsession });
    const oppHand = handOf(engine, P2).length;
    endTurn(engine, P2);
    const seen: string[] = [];
    drain(engine, (pc) => {
      seen.push(`${pc.playerId}:${pc.kind}`);
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("oh0")] };
      return declineAll(pc);
    });
    assert.equal(handOf(engine, P2).length, active ? oppHand - 1 : oppHand);
    assert.equal(seen.includes("p2:chooserSelectsTarget"), active);
  });
}

clause(ATHENAEUM, "2:rule@ooooo", "an opponent with no cards in hand discards nothing and nothing gets stuck", () => {
  const { engine } = athenaeumBoard({ obsession: 5, oppHand: 0 });
  startTurnOf(engine, P1, { draw: false });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(ATHENAEUM, "2:rule@ooooo", "'at the start of YOUR turn': at the start of the opponent's turn I do not discard, even with 5 [O]", () => {
  const { engine } = athenaeumBoard({ obsession: 5, startAs: P2, myHand: 3 });
  const myHand = handOf(engine, P1).length;
  const seen = startTurnOf(engine, P2);
  assert.deepEqual(seen, []);
  assert.equal(handOf(engine, P1).length, myHand);
});

clause(ATHENAEUM, "2:rule@ooooo", "with 5 [O] the 3-[O] paragraph is on as well: both the draw offer and the discard happen", () => {
  const { engine, id } = athenaeumBoard({ obsession: 5 });
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const seen = startTurnOf(engine, P1, { draw: true, oppDraw: false, discard: id("oh0") });
  assert.ok(seen.includes("p1:chooserSelectsOption"), "the draw offer");
  assert.ok(seen.includes("p2:chooserSelectsTarget"), "the discard");
  assert.equal(handOf(engine, P1).length, myHand + 1);
  assert.equal(handOf(engine, P2).length, oppHand - 1);
});

// --- [O]x7: bounce a character ---------------------------------------------------------

clause(ATHENAEUM, "3:rule@ooooooo", "with 7 [O], at the start of my turn I may pick an opposing character and it is put into its owner's hand", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7 });
  const seen = startTurnOf(engine, P1, { draw: false, discard: id("oh0"), pick: [id("foe")] });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "I was asked to pick");
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "in its owner's hand");
  assert.equal(zoneOf(engine, id("foe2")), "play", "only the picked character");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(ATHENAEUM, "3:rule@ooooooo", "I can pick one of my own characters: it is put into my hand", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7 });
  startTurnOf(engine, P1, { draw: false, discard: id("oh0"), pick: [id("mine")] });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.ok(handOf(engine, P1).includes(id("mine")), "handOf(engine, P1).includes(id(\"mine\"))");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(ATHENAEUM, "3:rule@ooooooo", "a character I control but do not own goes to its OWNER's hand", () => {
  const { engine, id } = athenaeumBoard({
    obsession: 7,
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]
  });
  startTurnOf(engine, P1, { draw: false, discard: id("oh0"), pick: [id("stolen")] });
  assert.ok(handOf(engine, P2).includes(id("stolen")), "handOf(engine, P2).includes(id(\"stolen\"))");
  assert.equal(handOf(engine, P1).includes(id("stolen")), false);
});

clause(ATHENAEUM, "3:rule@ooooooo", "'you MAY pick': declining the pick returns nothing", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7 });
  const seen = startTurnOf(engine, P1, { draw: false, discard: id("oh0"), pick: [] });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "seen.includes(\"p1:chooserSelectsTarget\")");
  for (const key of ["mine", "mine2", "foe", "foe2"]) assert.equal(zoneOf(engine, id(key)), "play", key);
});

clause(ATHENAEUM, "3:rule@ooooooo", "I may pick at most one character", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7 });
  const pc = turnStartUntil(engine, (p) => p.kind === "chooserSelectsTarget" && p.playerId === P1, id("oh0"));
  assert.equal(pc.playerId, P1, "I am the one picking");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("foe"), id("foe2")] } } as never),
    "two picks"
  );
  answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("foe2")), "play");
});

clause(ATHENAEUM, "3:rule@ooooooo", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = athenaeumBoard({
    obsession: 7,
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  turnStartUntil(engine, (p) => p.kind === "chooserSelectsTarget" && p.playerId === P1, id("oh0"));
  const answerWith = (keys: CardInstanceId[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys } } as never);
  refused(answerWith([id("thing")]), "an item");
  refused(answerWith([id("place")]), "a location");
  refused(answerWith([engine.state.players[P2].factionId!]), "a faction");
  refused(answerWith([id("fd")]), "a face-down card");
  refused(answerWith([id("inDiscard")]), "a card in a discard pile");
  refused(answerWith([id("oh1")]), "a card in a hand");
  answerWith([id("foe")])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "control: a character in play is accepted");
});

for (const [obsession, active] of [
  [7, true],
  [8, true],
  [6, false],
  [5, false]
] as const) {
  clause(ATHENAEUM, "3:rule@ooooooo", `threshold: with ${obsession} [O] the pick is ${active ? "offered" : "NOT offered"} at the start of my turn`, () => {
    const { engine, id } = athenaeumBoard({ obsession });
    const seen = startTurnOf(engine, P1, { draw: false, discard: id("oh0"), pick: [id("foe")] });
    assert.equal(seen.includes("p1:chooserSelectsTarget"), active);
    assert.equal(zoneOf(engine, id("foe")), active ? "hand" : "play");
  });
}

clause(ATHENAEUM, "3:rule@ooooooo", "'at the start of YOUR turn': nothing is returned at the start of the opponent's turn", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7, startAs: P2 });
  assert.deepEqual(startTurnOf(engine, P2, { pick: [id("foe")] }), []);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(ATHENAEUM, "3:rule@ooooooo", "with 7 [O] all three paragraphs are on at once: draw offer (me and opponent), the opponent's discard and my bounce all happen in one turn start", () => {
  const { engine, id } = athenaeumBoard({ obsession: 7 });
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const myTop = deckOf(engine, P1)[0];
  const oppTop = deckOf(engine, P2)[0];
  const seen = startTurnOf(engine, P1, { draw: true, oppDraw: true, discard: id("oh0"), pick: [id("foe2")] });
  assert.ok(seen.includes("p1:orderTriggers"), "three triggers at once: I order them");
  assert.equal(zoneOf(engine, myTop), "hand", "I drew");
  assert.equal(zoneOf(engine, oppTop), "hand", "the opponent drew");
  assert.equal(zoneOf(engine, id("oh0")), "discard", "the opponent discarded their chosen card");
  assert.equal(zoneOf(engine, id("foe2")), "hand", "the picked character was returned");
  assert.equal(handOf(engine, P1).length, myHand + 1);
  assert.equal(handOf(engine, P2).length, oppHand + 1 - 1 + 1, "opponent: +1 drawn, -1 discarded, +1 returned character");
});

clause(ATHENAEUM, "1:rule@ooo", "a face-down Athenaeum is only a resource with no rules text (CR 411.1): it does nothing at the start of my turn", () => {
  const { engine } = athenaeumBoard({
    obsession: 7,
    ath: "hand",
    extra: [{ key: "fdAth", def: printing(ATHENAEUM), owner: P1, zone: "play", faceDown: true }]
  });
  assert.deepEqual(startTurnOf(engine, P1), []);
});

// =================================================================================
// Day of the Tentacle
// Look at your opponent's hand and choose a non-resource card in it. Put it into play
// under your opponent's control as a face-down resource.
// Tactic, cost 0, [O].
// =================================================================================

const TENTACLE = "038bef7e-0d08-4751-ab48-0d1de31e3195";

function tentacleBoard(opts: { icons?: Icons; oppResources?: number; oppHand?: "all" | "resourcesOnly" | "empty"; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  const oppHand: CardPlacement[] =
    opts.oppHand === "empty"
      ? []
      : opts.oppHand === "resourcesOnly"
        ? [
            { key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
            { key: "or2", def: resourceCard({ name: "GreedCard", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "hand" }
          ]
        : [
            { key: "oc", def: character({ name: "OppChar", life: 4 }), owner: P2, zone: "hand" },
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ol", def: location({ name: "OppLoc" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
            { key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
          ];
  const myHandKeys: CardPlacement[] = [{ key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" }];
  return buildGame({
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dt", def: printing(TENTACLE), owner: active, zone: "hand" },
      ...oppHand.map((c) => ({ ...c, owner: other(active) })),
      ...myHandKeys.map((c) => ({ ...c, owner: active })),
      ...res(opts.icons ?? { obsession: 1 }, active),
      ...res({ greed: opts.oppResources ?? 2 }, other(active)),
      ...(opts.extra ?? [])
    ]
  });
}

const typeOfKey = { oc: "character", oi: "item", ol: "location", ot: "tactic" } as const;

for (const key of ["oc", "oi", "ol", "ot"] as const) {
  clause(TENTACLE, "0:rule", `choosing the opponent's ${typeOfKey[key]} card in hand puts it into play under the opponent's control, face-down`, () => {
    const { engine, id } = tentacleBoard();
    const oppHandBefore = handOf(engine, P2).length;
    play(engine, P1, id("dt"));
    const pc = pending(engine);
    assert.ok(pc, "I am asked to choose");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "I choose, not the opponent");
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(engine.state.pendingChoice, undefined);
    const card = engine.state.cards[id(key)];
    assert.equal(card.zone, "play", "put into play");
    assert.equal(card.faceDown, true, "face-down");
    assert.equal(card.controllerId, P2, "under my opponent's control");
    assert.equal(card.ownerId, P2, "still owned by the opponent");
    assert.ok(engine.state.players[P2].play.includes(id(key)), "in the opponent's play area");
    assert.equal(engine.state.players[P1].play.includes(id(key)), false, "not in mine");
    assert.equal(handOf(engine, P2).length, oppHandBefore - 1, "it left the opponent's hand");
    assert.equal(engine.isResource(id(key)), true, "a face-down card is a resource");
    assert.deepEqual(engine.getCardTypes(id(key)), ["resource"], "and nothing else (CR 411.1)");
  });
}

clause(TENTACLE, "0:rule", "the face-down resource is a real resource for the opponent: it adds exactly one resource to their pool and provides Volition", () => {
  const { engine, id } = tentacleBoard({ oppResources: 2 });
  const before = ready(engine, P2);
  const volitionBefore = engine.getThresholds(P2).volition ?? 0;
  play(engine, P1, id("dt"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(ready(engine, P2) - before, 1, "one more resource for the opponent");
  assert.equal(ready(engine, P1), 1, "my own resources are unchanged (cost 0)");
  assert.equal((engine.getThresholds(P2).volition ?? 0) - volitionBefore, 1, "it provides exactly one Volition icon (CR 405.5)");
  assert.equal(engine.getThresholds(P1).volition ?? 0, 0, "and none for me");
});

clause(TENTACLE, "0:rule", "it only moves the one chosen card: the rest of the opponent's hand and my own hand stay put", () => {
  const { engine, id } = tentacleBoard();
  play(engine, P1, id("dt"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oi")] });
  for (const key of ["oc", "ol", "ot", "or1"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in the opponent's hand`);
  assert.equal(zoneOf(engine, id("mh")), "hand", "my hand card is untouched");
  assert.equal(zoneOf(engine, id("dt")), "discard", "the tactic ends in my discard pile");
});

clause(TENTACLE, "0:rule", "a RESOURCE card in the opponent's hand cannot be chosen (non-resource only)", () => {
  const { engine, id } = tentacleBoard();
  play(engine, P1, id("dt"));
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("or1")] } } as never),
    "a resource card"
  );
  assert.ok(pending(engine), "the choice stays open");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(zoneOf(engine, id("or1")), "hand");
  assert.equal(zoneOf(engine, id("oc")), "play", "control: a non-resource is accepted");
});

clause(TENTACLE, "0:rule", "the card must be in the OPPONENT's hand: my own hand card, a card in play and a card in a discard pile are refused", () => {
  const { engine, id } = tentacleBoard({
    extra: [
      { key: "oppPlay", def: character({ name: "OppInPlay" }), owner: P2, zone: "play" },
      { key: "oppDiscard", def: character({ name: "OppInDiscard" }), owner: P2, zone: "discard" },
      { key: "oppDeck", def: character({ name: "OppInDeck" }), owner: P2, zone: "deck" }
    ]
  });
  play(engine, P1, id("dt"));
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["mh"]), "a card in MY hand");
  refused(answerWith(["oppPlay"]), "a card already in play");
  refused(answerWith(["oppDiscard"]), "a card in their discard pile");
  refused(answerWith(["oppDeck"]), "a card in their deck");
  refused(answerWith([]), "I must choose a card");
  refused(answerWith(["oc", "oi"]), "only one card");
  answerWith(["ot"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ot")), "play", "control: a card in their hand is accepted");
  assert.equal(engine.state.cards[id("mh")].zone, "hand");
});

clause(TENTACLE, "0:rule", "when the opponent's hand holds only resource cards nothing can be chosen: nothing moves and the game is not stuck", () => {
  const { engine, id } = tentacleBoard({ oppHand: "resourcesOnly" });
  play(engine, P1, id("dt"));
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("or1")), "hand");
  assert.equal(zoneOf(engine, id("or2")), "hand");
  assert.equal(zoneOf(engine, id("dt")), "discard");
  assert.equal(engine.state.players[P2].play.filter((c) => engine.state.cards[c].faceDown).length, 0);
});

clause(TENTACLE, "0:rule", "with the opponent's hand empty it simply does nothing", () => {
  const { engine, id } = tentacleBoard({ oppHand: "empty" });
  play(engine, P1, id("dt"));
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("dt")), "discard");
  assert.equal(zoneOf(engine, id("mh")), "hand");
});

clause(TENTACLE, "0:rule", "the card put face-down has no characteristics: its enters-play trigger does not fire", () => {
  const etbChar = character({
    name: "TriggerHappy",
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 7 }]
        }
      ]
    }
  });
  const { engine, id } = tentacleBoard({ extra: [{ key: "happy", def: etbChar, owner: P2, zone: "hand" }] });
  const influence = engine.state.players[P2].influence;
  play(engine, P1, id("dt"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("happy")] });
  settled(engine);
  assert.equal(zoneOf(engine, id("happy")), "play");
  assert.equal(engine.state.cards[id("happy")].faceDown, true);
  assert.equal(engine.state.players[P2].influence, influence, "a face-down card has no rules text, so nothing triggers");
});

clause(TENTACLE, "0:rule", "the face-down card is not a character: it cannot be picked as one", () => {
  const { engine, id } = tentacleBoard({
    extra: [
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "face", def: character({ name: "FaceUp" }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("dt"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  refused(() => playRaw(engine, P1, id("kill"), { selected: { t: [id("oc")] } }), "a face-down card is not a character");
  assert.equal(zoneOf(engine, id("oc")), "play");
  playRaw(engine, P1, id("kill"), { selected: { t: [id("face")] } });
  assert.ok(engine.state.responseWindow, "control: a face-up character is a legal target of the same tactic");
});

clause(TENTACLE, "0:rule", "on the opponent's own turn they can play it too: then I am 'the opponent' and my hand loses a card to a face-down resource under my control", () => {
  const { engine, id } = tentacleBoard({ active: P2, icons: { obsession: 1 } });
  // P2 is the caster here; P1 is their opponent and holds the five opposing cards.
  assert.equal(handOf(engine, P1).length, 5, "P1's hand holds the five opposing cards");
  play(engine, P2, id("dt"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the caster chooses");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(engine.state.cards[id("oc")].controllerId, P1, "under the caster's opponent's control");
  assert.equal(engine.state.cards[id("oc")].faceDown, true);
});

clause(TENTACLE, "0:rule", "costs nothing to deploy (cost 0): no resource is spent, but [O] is still required", () => {
  const { engine, id } = tentacleBoard({ icons: { obsession: 1 } });
  const before = ready(engine);
  play(engine, P1, id("dt"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(before - ready(engine), 0, "no resource was paid");
  const none = tentacleBoard({ icons: { greed: 5 } });
  refused(() => playRaw(none.engine, P1, none.id("dt")), "no [O] among five other resources");
  assert.equal(zoneOf(none.engine, none.id("dt")), "hand");
  const noResources = tentacleBoard({ icons: {} });
  refused(() => playRaw(noResources.engine, P1, noResources.id("dt")), "no resources at all");
});

clause(TENTACLE, "0:rule", "the opponent's [O] do not satisfy my threshold", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dt", def: printing(TENTACLE), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "hand" },
      ...res({ greed: 3 }),
      ...res({ obsession: 3 }, P2)
    ]
  });
  refused(() => playRaw(engine, P1, id("dt")), "only the opponent has [O]");
});

clause(TENTACLE, "0:rule", "can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dt", def: printing(TENTACLE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "hand" },
      ...res({ obsession: 1 })
    ]
  });
  refused(() => playRaw(engine, P1, id("dt")), "nothing to respond to yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("dt"));
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(engine.state.cards[id("oc")].faceDown, true);
  assert.equal(engine.state.cards[id("oc")].controllerId, P2);
});

// =================================================================================
// Defiler of Innocence
// CORRUPT -- COST: Pay 2. Pick a character. -- EFFECT: This turn, the character gains COVERT.
// DEFILE -- COST: Deplete this card. -- EFFECT: Look at your opponent's hand and choose a
// character in it. Your opponent discards that character.
// Character (wizard), cost 2, [O][O][O][O], 2 strength / 3 speed / 1 life.
// =================================================================================

const DEFILER = "0f0e1fc8-b7e1-462f-a912-60d2ca99d458";

function defilerBoard(
  opts: {
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    depleted?: boolean;
    faceDown?: boolean;
    oppHand?: "mixed" | "noCharacters" | "empty";
    zone?: "play" | "hand";
    extra?: CardPlacement[];
  } = {}
) {
  const oppHand: CardPlacement[] =
    opts.oppHand === "empty"
      ? []
      : opts.oppHand === "noCharacters"
        ? [
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" }
          ]
        : [
            { key: "oc1", def: character({ name: "OppChar1" }), owner: P2, zone: "hand" },
            { key: "oc2", def: character({ name: "OppChar2" }), owner: P2, zone: "hand" },
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
            { key: "ol", def: location({ name: "OppLoc" }), owner: P2, zone: "hand" },
            { key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
          ];
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "di",
        def: printing(DEFILER),
        owner: P1,
        zone: opts.zone ?? "play",
        depleted: opts.depleted,
        faceDown: opts.faceDown
      },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...oppHand,
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const corrupt = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId, player: PlayerId = P1) =>
  activate(engine, player, id("di"), "corrupt", { selected: { c: [target] } });

clause(DEFILER, "0:ability:corrupt", "pays exactly 2 and gives the picked opposing character COVERT; nobody else gains it", () => {
  const { engine, id } = defilerBoard();
  const before = ready(engine);
  corrupt(engine, id, id("foe"));
  assert.equal(before - ready(engine), 2, "Pay 2");
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "the picked character gains COVERT");
  for (const key of ["foe2", "mine", "ally", "di"]) assert.equal(engine.getKeywords(id(key)).includes("covert"), false, `${key} does not`);
});

clause(DEFILER, "0:ability:corrupt", "can pick one of my own characters", () => {
  const { engine, id } = defilerBoard();
  corrupt(engine, id, id("mine"));
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("ally")).includes("covert"), false);
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false);
});

clause(DEFILER, "0:ability:corrupt", "can pick the Defiler itself (it is a character)", () => {
  const { engine, id } = defilerBoard();
  corrupt(engine, id, id("di"));
  assert.ok(engine.getKeywords(id("di")).includes("covert"), "engine.getKeywords(id(\"di\")).includes(\"covert\")");
});

clause(DEFILER, "0:ability:corrupt", "does NOT deplete the Defiler (the cost is only Pay 2): it can be used again, and once depleted it still works", () => {
  const { engine, id } = defilerBoard();
  corrupt(engine, id, id("mine"));
  assert.equal(engine.state.cards[id("di")].depleted, false, "CORRUPT does not deplete");
  corrupt(engine, id, id("ally"));
  assert.ok(engine.getKeywords(id("ally")).includes("covert"), "usable a second time");
  assert.equal(ready(engine), 6 - 4, "each use pays 2");
  const depleted = defilerBoard({ depleted: true });
  corrupt(depleted.engine, depleted.id, depleted.id("foe"));
  assert.ok(depleted.engine.getKeywords(depleted.id("foe")).includes("covert"), "a depleted Defiler can still use CORRUPT");
});

clause(DEFILER, "0:ability:corrupt", "the COVERT is real: a party of only the picked character cannot be blocked by a non-covert character, but a covert one may block", () => {
  const { engine, id } = defilerBoard({
    turn: 2,
    extra: [
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  corrupt(engine, id, id("mine"));
  declareAttackBy(engine, P1, [id("mine")]);
  refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "a non-covert blocker");
  refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] }), "another non-covert blocker");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("covertBlocker")], "a covert blocker can block it");
});

clause(DEFILER, "0:ability:corrupt", "without CORRUPT the same attacker can be blocked by a non-covert character (control)", () => {
  const { engine, id } = defilerBoard({ turn: 2 });
  declareAttackBy(engine, P1, [id("mine")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")]);
});

clause(DEFILER, "0:ability:corrupt", "the COVERT lasts this turn only", () => {
  const { engine, id } = defilerBoard();
  corrupt(engine, id, id("mine"));
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "granted this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false, "gone when the turn ends");
});

clause(DEFILER, "0:ability:corrupt", "is refused one resource short of Pay 2, allowed with exactly 2", () => {
  const short = defilerBoard({ icons: { obsession: 1 } });
  refused(() => corrupt(short.engine, short.id, short.id("mine")), "one resource");
  assert.equal(short.engine.getKeywords(short.id("mine")).includes("covert"), false);
  const exact = defilerBoard({ icons: { obsession: 2 } });
  corrupt(exact.engine, exact.id, exact.id("mine"));
  assert.ok(exact.engine.getKeywords(exact.id("mine")).includes("covert"), "exact.engine.getKeywords(exact.id(\"mine\")).includes(\"covert\")");
  assert.equal(ready(exact.engine), 0);
});

clause(DEFILER, "0:ability:corrupt", "has no threshold of its own: it works with 2 resources that are not [O] at all", () => {
  const { engine, id } = defilerBoard({ icons: { greed: 2 } });
  corrupt(engine, id, id("mine"));
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
});

clause(DEFILER, "0:ability:corrupt", "only a character in play can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = defilerBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  for (const [what, target] of [
    ["an item", id("thing")],
    ["a location", id("place")],
    ["a faction", engine.state.players[P2].factionId!],
    ["my own faction", engine.state.players[P1].factionId!],
    ["a face-down card", id("fd")],
    ["a card in my hand", id("mh")],
    ["a card in the opponent's hand", id("oc1")]
  ] as const) {
    refused(() => corrupt(engine, id, target), what);
  }
  assert.equal(ready(engine), 6, "nothing was paid by the refused attempts");
  corrupt(engine, id, id("foe"));
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "control: a character in play is accepted");
});

clause(DEFILER, "0:ability:corrupt", "needs exactly one pick: none or two are refused", () => {
  const { engine, id } = defilerBoard();
  refused(() => activate(engine, P1, id("di"), "corrupt", { selected: {} }), "no pick");
  refused(() => activate(engine, P1, id("di"), "corrupt", { selected: { c: [id("foe"), id("mine")] } }), "two picks");
  assert.equal(ready(engine), 6);
});

clause(DEFILER, "0:ability:corrupt", "only its controller can use it", () => {
  const { engine, id } = defilerBoard({ turn: 2, active: P2, extra: res({ obsession: 4 }, P2) });
  refused(() => corrupt(engine, id, id("foe"), P2), "the opponent cannot use my Defiler's ability");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false);
});

clause(DEFILER, "0:ability:corrupt", "a face-down Defiler is only a resource: it has no abilities", () => {
  const { engine, id } = defilerBoard({ faceDown: true });
  refused(() => corrupt(engine, id, id("foe")), "face-down cards have no rules text (CR 411.1)");
});

clause(DEFILER, "0:ability:corrupt", "as an ability it can be used in response on the opponent's turn", () => {
  const { engine, id } = defilerBoard({ turn: 2, active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  corrupt(engine, id, id("foe"));
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "engine.getKeywords(id(\"foe\")).includes(\"covert\")");
});

// --- DEFILE ----------------------------------------------------------------------

const defile = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, player: PlayerId = P1) =>
  activate(engine, player, id("di"), "defile");

clause(DEFILER, "1:ability:defile", "depletes the Defiler, then I choose a character in the opponent's hand and they discard exactly that one", () => {
  const { engine, id } = defilerBoard();
  const before = ready(engine);
  const oppHand = handOf(engine, P2).length;
  defile(engine, id);
  assert.equal(engine.state.cards[id("di")].depleted, true, "Deplete this card");
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose (the opponent only discards)");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc2")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("oc2")), "discard", "the chosen character is discarded");
  assert.ok(discardOf(engine, P2).includes(id("oc2")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("oc1")), "hand", "the other character stays");
  assert.equal(handOf(engine, P2).length, oppHand - 1, "exactly one card");
  assert.equal(before - ready(engine), 0, "DEFILE costs no resources");
});

clause(DEFILER, "1:ability:defile", "I can choose either character in the hand (not just the first one)", () => {
  for (const key of ["oc1", "oc2"]) {
    const { engine, id } = defilerBoard();
    defile(engine, id);
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(zoneOf(engine, id(key)), "discard", key);
    assert.equal(zoneOf(engine, id(key === "oc1" ? "oc2" : "oc1")), "hand");
  }
});

clause(DEFILER, "1:ability:defile", "only a CHARACTER can be chosen: an item, a tactic, a location and a resource card in their hand are refused", () => {
  const { engine, id } = defilerBoard();
  defile(engine, id);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["oi"]), "an item");
  refused(answerWith(["ot"]), "a tactic");
  refused(answerWith(["ol"]), "a location");
  refused(answerWith(["or1"]), "a resource card");
  refused(answerWith([]), "I must choose a character when there is one");
  refused(answerWith(["oc1", "oc2"]), "only one character");
  assert.ok(pending(engine), "the choice is still open");
  answerWith(["oc1"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oc1")), "discard", "control: a character is accepted");
  for (const key of ["oi", "ot", "ol", "or1"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} is still in their hand`);
});

clause(DEFILER, "1:ability:defile", "the card must be in the OPPONENT's hand: my own hand character, an opposing character in play and a discard are refused", () => {
  const { engine, id } = defilerBoard({ extra: [{ key: "dis", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }] });
  defile(engine, id);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["mh"]), "a character in MY hand");
  refused(answerWith(["foe"]), "a character in play");
  refused(answerWith(["dis"]), "a character already in their discard pile");
  answerWith(["oc2"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mh")), "hand", "my hand is untouched");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(DEFILER, "1:ability:defile", "when the opponent's hand holds no character nothing is discarded, the Defiler is still depleted and the game is not stuck", () => {
  const { engine, id } = defilerBoard({ oppHand: "noCharacters" });
  defile(engine, id);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("di")].depleted, true);
  assert.equal(zoneOf(engine, id("oi")), "hand");
  assert.equal(zoneOf(engine, id("ot")), "hand");
});

clause(DEFILER, "1:ability:defile", "with the opponent's hand empty it just depletes", () => {
  const { engine, id } = defilerBoard({ oppHand: "empty" });
  defile(engine, id);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("di")].depleted, true);
});

clause(DEFILER, "1:ability:defile", "cannot be used while the Defiler is depleted, and works again once it is restored at my next turn", () => {
  const { engine, id } = defilerBoard();
  defile(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  refused(() => defile(engine, id), "already depleted: the cost cannot be paid again");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oc2")), "hand", "nothing else was discarded");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("di")].depleted, false, "restored");
  defile(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc2")] });
  assert.equal(zoneOf(engine, id("oc2")), "discard", "usable again");
});

clause(DEFILER, "1:ability:defile", "a depleted Defiler from the start cannot use DEFILE (but the same card ready can)", () => {
  const depleted = defilerBoard({ depleted: true });
  refused(() => defile(depleted.engine, depleted.id), "depleted");
  assert.equal(depleted.engine.state.pendingChoice, undefined);
  const ready1 = defilerBoard();
  defile(ready1.engine, ready1.id);
  assert.ok(pending(ready1.engine), "control: a ready Defiler can");
});

clause(DEFILER, "1:ability:defile", "needs no resources at all", () => {
  const { engine, id } = defilerBoard({ icons: {} });
  defile(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
});

clause(DEFILER, "1:ability:defile", "can be used the turn the Defiler enters play (abilities have no summoning sickness, CR 204.3a)", () => {
  const { engine, id } = defilerBoard({ zone: "hand" });
  play(engine, P1, id("di"));
  assert.equal(zoneOf(engine, id("di")), "play");
  defile(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
});

clause(DEFILER, "1:ability:defile", "only its controller can use it", () => {
  const { engine, id } = defilerBoard({ turn: 2, active: P2 });
  refused(() => defile(engine, id, P2), "the opponent cannot use my Defiler");
  assert.equal(engine.state.cards[id("di")].depleted, false);
});

clause(DEFILER, "1:ability:defile", "a face-down Defiler is only a resource: it has no abilities", () => {
  const { engine, id } = defilerBoard({ faceDown: true });
  refused(() => defile(engine, id), "face-down cards have no rules text (CR 411.1)");
});

clause(DEFILER, "1:ability:defile", "as an ability it can be used in response on the opponent's turn", () => {
  const { engine, id } = defilerBoard({ turn: 2, active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  defile(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
});

clause(DEFILER, "0:ability:corrupt", "deploys as printed: 2 strength, 3 speed, 1 life, for exactly 2 with [O][O][O][O]", () => {
  const { engine, id } = defilerBoard({ zone: "hand", icons: { obsession: 4 } });
  const before = ready(engine);
  play(engine, P1, id("di"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2");
  assert.equal(engine.getStat(id("di"), "strength"), 2);
  assert.equal(engine.getStat(id("di"), "speed"), 3);
  assert.equal(engine.getStat(id("di"), "life"), 1);
  const threeO = defilerBoard({ zone: "hand", icons: { obsession: 3, greed: 4 } });
  refused(() => playRaw(threeO.engine, P1, threeO.id("di")), "only three [O]", /Threshold requirements are not met/);
  // [O][O][O][O] met by already-spent Obsession, but only one ready resource for the cost of 2
  const short = defilerBoard({ zone: "hand", icons: { greed: 1 }, extra: bank("obsession", 4, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(() => playRaw(short.engine, P1, short.id("di")), "one ready resource for a cost of 2 (threshold met by spent icons)", /Costs cannot be paid/);
});

// =================================================================================
// Domain of Depravity
// At the start of your turn, you may pick a character. If you do, put a token on it.
// All characters lose 1 strength, 1 life, and 1 speed for each token on them.
// Location, cost 4, [O][O][O], structure 3.
// =================================================================================

const DOMAIN = "4424b7eb-6283-4fdc-9852-a820d5405f48";

function domainBoard(
  opts: {
    obsession?: number;
    dom?: "play" | "hand" | "discard";
    faceDown?: boolean;
    controller?: PlayerId;
    startAs?: PlayerId;
    tokens?: Partial<Record<"mine" | "mine2" | "foe" | "foe2" | "thing" | "place", number>>;
    extra?: CardPlacement[];
    noChars?: boolean;
  } = {}
) {
  const startAs = opts.startAs ?? P1;
  const controller = opts.controller ?? P1;
  const t = opts.tokens ?? {};
  const chars: CardPlacement[] = opts.noChars
    ? []
    : [
        { key: "mine", def: character({ name: "Mine", strength: 4, life: 5, speed: 3 }), owner: P1, zone: "play", counters: t.mine ? { token: t.mine } : undefined },
        { key: "mine2", def: character({ name: "Mine2", strength: 4, life: 5, speed: 3 }), owner: P1, zone: "play", counters: t.mine2 ? { token: t.mine2 } : undefined },
        { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play", counters: t.foe ? { token: t.foe } : undefined },
        { key: "foe2", def: character({ name: "Foe2", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play", counters: t.foe2 ? { token: t.foe2 } : undefined }
      ];
  return buildGame({
    turn: 2,
    activePlayerId: other(startAs),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dom", def: printing(DOMAIN), owner: controller, zone: opts.dom ?? "play", faceDown: opts.faceDown },
      ...chars,
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play", counters: t.thing ? { token: t.thing } : undefined },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play", counters: t.place ? { token: t.place } : undefined },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...res({ obsession: opts.obsession ?? 3 }, controller),
      ...(opts.extra ?? [])
    ]
  });
}

const stat = (engine: SpoilsEngine, cardId: CardInstanceId) => ({
  strength: engine.getStat(cardId, "strength"),
  life: engine.getStat(cardId, "life"),
  speed: engine.getStat(cardId, "speed")
});

const tokens = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters?.token ?? 0;

clause(DOMAIN, "0:rule", "at the start of my turn I may pick an opposing character and it gets exactly one token", () => {
  const { engine, id } = domainBoard();
  const seen = startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.deepEqual(seen, ["p1:chooserSelectsTarget"], "I was asked to pick, and nobody else");
  assert.equal(tokens(engine, id("foe")), 1, "one token on the picked character");
  for (const key of ["foe2", "mine", "mine2"]) assert.equal(tokens(engine, id(key)), 0, `${key} gets none`);
});

clause(DOMAIN, "0:rule", "I may pick one of my own characters", () => {
  const { engine, id } = domainBoard();
  startTurnOf(engine, P1, { pick: [id("mine")] });
  assert.equal(tokens(engine, id("mine")), 1);
  assert.equal(tokens(engine, id("foe")), 0);
});

clause(DOMAIN, "0:rule", "'you MAY pick': declining puts no token on anything", () => {
  const { engine, id } = domainBoard();
  const seen = startTurnOf(engine, P1, { pick: [] });
  assert.deepEqual(seen, ["p1:chooserSelectsTarget"], "I was asked");
  for (const key of ["mine", "mine2", "foe", "foe2"]) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(DOMAIN, "0:rule", "the pick is optional but limited to one: two characters are refused", () => {
  const { engine, id } = domainBoard();
  const pc = turnStartUntil(engine, (p) => p.kind === "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("foe"), id("foe2")] } } as never),
    "two picks"
  );
  answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] });
  assert.equal(tokens(engine, id("foe")), 1);
  assert.equal(tokens(engine, id("foe2")), 0);
});

clause(DOMAIN, "0:rule", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = domainBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  turnStartUntil(engine, (p) => p.kind === "chooserSelectsTarget");
  const answerWith = (keys: CardInstanceId[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys } } as never);
  refused(answerWith([id("thing")]), "an item");
  refused(answerWith([id("place")]), "a location");
  refused(answerWith([engine.state.players[P2].factionId!]), "a faction");
  refused(answerWith([engine.state.players[P1].factionId!]), "my faction");
  refused(answerWith([id("fd")]), "a face-down card");
  refused(answerWith([id("inHand")]), "a character in a hand");
  refused(answerWith([id("inDiscard")]), "a character in a discard pile");
  answerWith([id("foe2")])();
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("foe2")), 1, "control: a character in play is accepted");
});

clause(DOMAIN, "0:rule", "tokens accumulate: a second turn start can put a second token on the same character, or a first on another", () => {
  const { engine, id } = domainBoard();
  startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.equal(tokens(engine, id("foe")), 1);
  endTurn(engine, P1);
  startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.equal(tokens(engine, id("foe")), 2, "a second token on the same character");
  endTurn(engine, P1);
  startTurnOf(engine, P1, { pick: [id("mine")] });
  assert.equal(tokens(engine, id("foe")), 2);
  assert.equal(tokens(engine, id("mine")), 1, "and a first one on another");
});

clause(DOMAIN, "0:rule", "'at the start of YOUR turn': at the start of the opponent's turn there is no prompt and no token", () => {
  const { engine, id } = domainBoard({ startAs: P2 });
  const seen = startTurnOf(engine, P2, { pick: [id("mine")] });
  assert.deepEqual(seen, []);
  for (const key of ["mine", "mine2", "foe", "foe2"]) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(DOMAIN, "0:rule", "'your' means the controller: a Domain the opponent controls prompts them (and not me) at their turn start", () => {
  const { engine, id } = domainBoard({ controller: P2 });
  assert.deepEqual(startTurnOf(engine, P1, { pick: [id("foe")] }), [], "not my Domain: no prompt at my turn start");
  assert.equal(tokens(engine, id("foe")), 0);
  const seen: string[] = [];
  endTurn(engine, P1);
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    return pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("mine")] } : declineAll(pc);
  });
  assert.deepEqual(seen, ["p2:chooserSelectsTarget"], "the controller P2 picks at the start of their own turn");
  assert.equal(tokens(engine, id("mine")), 1);
});

clause(DOMAIN, "0:rule", "does nothing when the Domain is not in play (in hand or in the discard pile)", () => {
  for (const dom of ["hand", "discard"] as const) {
    const { engine, id } = domainBoard({ dom });
    assert.deepEqual(startTurnOf(engine, P1, { pick: [id("foe")] }), [], dom);
    assert.equal(tokens(engine, id("foe")), 0, dom);
  }
});

clause(DOMAIN, "0:rule", "a face-down Domain is only a resource with no rules text: no prompt, no token", () => {
  const { engine, id } = domainBoard({ faceDown: true });
  assert.deepEqual(startTurnOf(engine, P1, { pick: [id("foe")] }), []);
  assert.equal(tokens(engine, id("foe")), 0);
});

clause(DOMAIN, "0:rule", "with no character in play there is nothing to pick: nothing happens and the turn is not stuck", () => {
  const { engine } = domainBoard({ noChars: true });
  startTurnOf(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.activePlayerId, P1);
});

clause(DOMAIN, "0:rule", "needs no threshold at the start of the turn: it works with none of the Domain's own [O] (the threshold is a deploy requirement)", () => {
  const { engine, id } = domainBoard({ obsession: 0 });
  startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.equal(tokens(engine, id("foe")), 1);
});

clause(DOMAIN, "0:rule", "two Domains each put a token on the start of my turn (they are not UNIQUE): two prompts, two tokens", () => {
  const { engine, id } = domainBoard({ extra: [{ key: "dom2", def: printing(DOMAIN), owner: P1, zone: "play" }] });
  const seen = startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.equal(seen.filter((s) => s === "p1:chooserSelectsTarget").length, 2, "one pick per Domain");
  assert.equal(tokens(engine, id("foe")), 2);
});

// --- the static drag -------------------------------------------------------------

for (const n of [1, 2, 3]) {
  clause(DOMAIN, "1:rule", `a character with ${n} token${n > 1 ? "s" : ""} loses ${n} strength, ${n} life and ${n} speed`, () => {
    const { engine, id } = domainBoard({ tokens: { foe: n } });
    assert.deepEqual(stat(engine, id("foe")), { strength: 4 - n, life: 5 - n, speed: 3 - n });
  });
}

clause(DOMAIN, "1:rule", "'ALL characters': mine and the opponent's with tokens are both dragged down by their own token counts", () => {
  const { engine, id } = domainBoard({ tokens: { mine: 1, foe: 2 } });
  assert.deepEqual(stat(engine, id("mine")), { strength: 3, life: 4, speed: 2 }, "my own character is affected too");
  assert.deepEqual(stat(engine, id("foe")), { strength: 2, life: 3, speed: 1 });
});

clause(DOMAIN, "1:rule", "a character without tokens is untouched", () => {
  const { engine, id } = domainBoard({ tokens: { foe: 2 } });
  assert.deepEqual(stat(engine, id("mine")), { strength: 4, life: 5, speed: 3 });
  assert.deepEqual(stat(engine, id("mine2")), { strength: 4, life: 5, speed: 3 });
  assert.deepEqual(stat(engine, id("foe2")), { strength: 4, life: 5, speed: 3 });
});

clause(DOMAIN, "1:rule", "'for each token on THEM': the drag follows each character's own token count, tokens on other characters do not matter", () => {
  const { engine, id } = domainBoard({ tokens: { mine: 1, mine2: 3, foe: 0, foe2: 2 } });
  assert.deepEqual(stat(engine, id("mine")), { strength: 3, life: 4, speed: 2 });
  assert.deepEqual(stat(engine, id("mine2")), { strength: 1, life: 2, speed: 0 });
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 });
  assert.deepEqual(stat(engine, id("foe2")), { strength: 2, life: 3, speed: 1 });
});

clause(DOMAIN, "1:rule", "the drag applies the moment a token appears (mid-turn), not only at turn start", () => {
  const { engine, id } = domainBoard();
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 });
  engine.state.cards[id("foe")].counters = { token: 1 };
  assert.deepEqual(stat(engine, id("foe")), { strength: 3, life: 4, speed: 2 });
});

clause(DOMAIN, "1:rule", "the picked character's drag begins as soon as the start-of-turn token lands", () => {
  const { engine, id } = domainBoard();
  startTurnOf(engine, P1, { pick: [id("foe")] });
  assert.deepEqual(stat(engine, id("foe")), { strength: 3, life: 4, speed: 2 });
  assert.deepEqual(stat(engine, id("foe2")), { strength: 4, life: 5, speed: 3 });
});

clause(DOMAIN, "1:rule", "the drag ends when the Domain is destroyed, even though the tokens stay on the characters", () => {
  const smash = tactic({
    name: "SmashPlace",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "smash", def: smash, owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stat(engine, id("foe")), { strength: 2, life: 3, speed: 1 }, "dragged while the Domain is in play");
  play(engine, P1, id("smash"), { selected: { t: [id("dom")] } });
  assert.equal(zoneOf(engine, id("dom")), "discard");
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 }, "the drag is gone");
  assert.equal(tokens(engine, id("foe")), 2, "the tokens themselves stay on the character");
});

clause(DOMAIN, "1:rule", "the drag ends when the Domain is put back into its owner's hand, even though the tokens stay on the characters", () => {
  const bounceTac = tactic({
    name: "Away",
    cost: 0,
    behavior: { abilities: [{ id: "a", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "away", def: bounceTac, owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stat(engine, id("foe")), { strength: 2, life: 3, speed: 1 });
  play(engine, P1, id("away"), { selected: { t: [id("dom")] } });
  assert.equal(zoneOf(engine, id("dom")), "hand");
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 }, "the drag is gone");
  assert.equal(tokens(engine, id("foe")), 2, "the tokens themselves stay on the character");
});

clause(DOMAIN, "1:rule", "does nothing while the Domain is in the hand or the discard pile", () => {
  for (const dom of ["hand", "discard"] as const) {
    const { engine, id } = domainBoard({ dom, tokens: { foe: 2 } });
    assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 }, dom);
  }
});

clause(DOMAIN, "1:rule", "a face-down Domain has no rules text: no drag", () => {
  const { engine, id } = domainBoard({ faceDown: true, tokens: { foe: 2 } });
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 });
});

clause(DOMAIN, "1:rule", "it is not tied to the Domain's controller: the drag applies whoever controls the Domain", () => {
  const { engine, id } = domainBoard({ controller: P2, tokens: { foe: 1, mine: 1 } });
  assert.deepEqual(stat(engine, id("foe")), { strength: 3, life: 4, speed: 2 });
  assert.deepEqual(stat(engine, id("mine")), { strength: 3, life: 4, speed: 2 });
});

clause(DOMAIN, "1:rule", "two Domains each apply their own drag: one token costs 2 strength, 2 life and 2 speed", () => {
  const { engine, id } = domainBoard({ tokens: { foe: 1 }, extra: [{ key: "dom2", def: printing(DOMAIN), owner: P1, zone: "play" }] });
  assert.deepEqual(stat(engine, id("foe")), { strength: 2, life: 3, speed: 1 });
});

clause(DOMAIN, "1:rule", "tokens on a non-character (an item or a location) do not change anything about any character", () => {
  const { engine, id } = domainBoard({ tokens: { thing: 2, place: 2 } });
  for (const key of ["mine", "foe"]) assert.deepEqual(stat(engine, id(key)), { strength: 4, life: 5, speed: 3 }, key);
});

clause(DOMAIN, "1:rule", "the life drag is real: a damaged character whose life drops to its damage is destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play", damage: 2 },
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" },
      ...res({ obsession: 4 })
    ]
  });
  assert.equal(zoneOf(engine, id("foe")), "play", "alive with 2 damage and 3 life");
  engine.state.cards[id("foe")].counters = { token: 1 };
  play(engine, P1, id("dom"));
  settled(engine);
  assert.equal(zoneOf(engine, id("dom")), "play");
  assert.equal(zoneOf(engine, id("foe")), "discard", "2 damage on (3 life - 1 token) = 2 life: destroyed");
});

clause(DOMAIN, "1:rule", "the life drag is real: a character that keeps more life than damage survives", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play", damage: 2, counters: { token: 1 } },
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" },
      ...res({ obsession: 4 })
    ]
  });
  play(engine, P1, id("dom"));
  settled(engine);
  assert.equal(engine.getStat(id("foe"), "life"), 3);
  assert.equal(zoneOf(engine, id("foe")), "play", "2 damage on 3 life");
});

clause(DOMAIN, "1:rule", "a character whose life is dragged to 0 is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 1, speed: 1 }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" },
      ...res({ obsession: 4 })
    ]
  });
  play(engine, P1, id("dom"));
  settled(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard", "1 life - 1 token = 0 life; 0 damage is >= 0 life, so it is destroyed");
});

clause(DOMAIN, "1:rule", "strength, life and speed cannot be dragged below 0 (CR 410.4): a 1/1/1 character with 3 tokens is a 0/0/0", () => {
  const { engine, id } = domainBoard({
    tokens: { foe: 3 },
    extra: [{ key: "tiny", def: character({ name: "Tiny", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play", counters: { token: 3 } }]
  });
  assert.deepEqual(stat(engine, id("tiny")), { strength: 0, life: 0, speed: 0 });
});

clause(DOMAIN, "1:rule", "the strength drag is real in a battle: an attacker with 2 tokens deals 2 less damage", () => {
  const { engine, id } = buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dom", def: printing(DOMAIN), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 9, speed: 1 }), owner: P1, zone: "play", counters: { token: 2 } }
    ]
  });
  const influence = engine.state.players[P2].influence;
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - engine.state.players[P2].influence, 3, "5 strength - 2 tokens = 3 damage");
});

clause(DOMAIN, "1:rule", "tokens do not follow a character out of play (CR 409.2): after it is bounced and played again it has no tokens and no drag", () => {
  const bounceTac = tactic({
    name: "BounceIt",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dom", def: printing(DOMAIN), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 3 }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "bounce", def: bounceTac, owner: P1, zone: "hand" },
      ...res({ obsession: 6 })
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "hand");
  play(engine, P1, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(tokens(engine, id("foe")), 0, "the tokens disappeared when it left play");
  assert.deepEqual(stat(engine, id("foe")), { strength: 4, life: 5, speed: 3 });
});

clause(DOMAIN, "0:rule", "deploys for exactly 4 and needs [O][O][O]", () => {
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" }, ...res({ obsession: 3, greed: 2 })]
  });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("dom"));
  assert.equal(before - ready(ok.engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(ok.engine, ok.id("dom")), "play");
  const two = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" }, ...res({ obsession: 2, greed: 5 })]
  });
  refused(() => playRaw(two.engine, P1, two.id("dom")), "only two [O]");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "dom", def: printing(DOMAIN), owner: P1, zone: "hand" }, ...res({ obsession: 3 })]
  });
  refused(() => playRaw(short.engine, P1, short.id("dom")), "one resource short of 4");
});

// =================================================================================
// Encumber
// COST: Pick a character or location. -- EFFECT: Put the character or location into its owner's hand.
// RECUR: [O] -- COST: Use this only if this card is in your discard pile. Pay 2. Remove this card from
// the game. -- EFFECT: Look at your opponent's hand and choose a non-resource card in it. Your opponent
// discards that card.
// Tactic, cost 4, [O].
// =================================================================================

const ENCUMBER = "f32de0a3-6f08-47c4-a798-679c5be50631";

function encumberBoard(
  opts: { icons?: Icons; enc?: "hand" | "discard" | "deck" | "play" | "removed"; turn?: number; active?: PlayerId; oppHand?: "mixed" | "resourcesOnly" | "empty"; extra?: CardPlacement[] } = {}
) {
  const oppHand: CardPlacement[] =
    opts.oppHand === "empty"
      ? []
      : opts.oppHand === "resourcesOnly"
        ? [{ key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
        : [
            { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "hand" },
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ol", def: location({ name: "OppLoc" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
            { key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
          ];
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "enc", def: printing(ENCUMBER), owner: P1, zone: opts.enc ?? "hand" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace", structure: 5 }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...oppHand,
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const encumber = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId) =>
  play(engine, P1, id("enc"), { selected: { t: [target] } });

clause(ENCUMBER, "0:ability", "pays exactly 4; an opposing character is put into its owner's hand and nothing else moves", () => {
  const { engine, id } = encumberBoard();
  const before = ready(engine);
  encumber(engine, id, id("foe"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "in its owner's (the opponent's) hand");
  for (const key of ["foe2", "foePlace", "foeThing", "mine", "myPlace"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(engine, id("enc")), "discard", "the tactic ends in its owner's discard pile");
});

clause(ENCUMBER, "0:ability", "an opposing LOCATION can be picked and is put into its owner's hand", () => {
  const { engine, id } = encumberBoard();
  encumber(engine, id, id("foePlace"));
  assert.equal(zoneOf(engine, id("foePlace")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foePlace")), "handOf(engine, P2).includes(id(\"foePlace\"))");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(ENCUMBER, "0:ability", "my own character and my own location can be picked: they go to my hand", () => {
  const a = encumberBoard();
  encumber(a.engine, a.id, a.id("mine"));
  assert.ok(handOf(a.engine, P1).includes(a.id("mine")), "handOf(a.engine, P1).includes(a.id(\"mine\"))");
  const b = encumberBoard();
  encumber(b.engine, b.id, b.id("myPlace"));
  assert.ok(handOf(b.engine, P1).includes(b.id("myPlace")), "handOf(b.engine, P1).includes(b.id(\"myPlace\"))");
});

clause(ENCUMBER, "0:ability", "a character I control but do not own goes to its OWNER's hand", () => {
  const { engine, id } = encumberBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  encumber(engine, id, id("stolen"));
  assert.ok(handOf(engine, P2).includes(id("stolen")), "its owner's hand");
  assert.equal(handOf(engine, P1).includes(id("stolen")), false);
});

clause(ENCUMBER, "0:ability", "a damaged character comes back undamaged, a damaged location has its damage removed (CR 408.9, 207.5b)", () => {
  const a = encumberBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 3, depleted: true }] });
  encumber(a.engine, a.id, a.id("hurt"));
  assert.equal(a.engine.state.cards[a.id("hurt")].damage, 0);
  assert.equal(a.engine.state.cards[a.id("hurt")].depleted, false);
  const b = encumberBoard({ extra: [{ key: "hurtPlace", def: location({ name: "HurtPlace", structure: 5 }), owner: P2, zone: "play", damage: 3 }] });
  encumber(b.engine, b.id, b.id("hurtPlace"));
  assert.equal(b.engine.state.cards[b.id("hurtPlace")].damage, 0);
});

clause(ENCUMBER, "0:ability", "only a character or a location can be picked: an item, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = encumberBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  const attempt = (target: CardInstanceId) => () => playRaw(engine, P1, id("enc"), { selected: { t: [target] } });
  refused(attempt(id("foeThing")), "an item");
  refused(attempt(engine.state.players[P2].factionId!), "a faction");
  refused(attempt(engine.state.players[P1].factionId!), "my own faction");
  refused(attempt(id("fd")), "a face-down card");
  refused(attempt(id("mh")), "a character in my hand");
  refused(attempt(id("oc")), "a character in the opponent's hand");
  refused(attempt(id("ol")), "a location in the opponent's hand");
  assert.equal(zoneOf(engine, id("enc")), "hand", "nothing was played");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(ENCUMBER, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const { engine, id } = encumberBoard();
  refused(() => playRaw(engine, P1, id("enc"), { selected: {} }), "no pick");
  refused(() => playRaw(engine, P1, id("enc"), { selected: { t: [id("foe"), id("foePlace")] } }), "two picks");
  assert.equal(zoneOf(engine, id("enc")), "hand");
});

clause(ENCUMBER, "0:ability", "only the picked card moves, whether it is a character or a location: the cards of the other type stay", () => {
  const { engine, id } = encumberBoard();
  encumber(engine, id, id("foePlace"));
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("foe2")), "play");
  assert.equal(zoneOf(engine, id("foeThing")), "play");
});

clause(ENCUMBER, "0:ability", "an item attached to the bounced character follows it to its owner's hand (CR 301.4a), it is not destroyed", () => {
  const gear = item({
    name: "Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });
  const { engine, id } = encumberBoard({ extra: [{ key: "gear", def: gear, owner: P2, zone: "play", attachedToKey: "foe" }] });
  encumber(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("gear")), "hand", "attached cards leave play the same way the host does: into its owner's hand");
});

clause(ENCUMBER, "0:ability", "if the picked character is destroyed in response, it stays in the discard pile and is not pulled into a hand (CR 402.4)", () => {
  const { engine, id } = encumberBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("enc"), { selected: { t: [id("foe")] } });
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard", "it was destroyed in response and is not a card in play any more");
});

clause(ENCUMBER, "0:ability", "is refused one resource short of its cost of 4, allowed with exactly 4", () => {
  const short = encumberBoard({ icons: { obsession: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("enc"), { selected: { t: [short.id("foe")] } }), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("enc")), "hand");
  const exact = encumberBoard({ icons: { obsession: 4 } });
  encumber(exact.engine, exact.id, exact.id("foe"));
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(ENCUMBER, "0:ability", "needs [O]: other resources alone are not enough", () => {
  const none = encumberBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("enc"), { selected: { t: [none.id("foe")] } }), "no [O]");
  const one = encumberBoard({ icons: { greed: 5, obsession: 1 } });
  encumber(one.engine, one.id, one.id("foe"));
  assert.equal(zoneOf(one.engine, one.id("foe")), "hand", "one [O] is enough");
});

clause(ENCUMBER, "0:ability", "can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = encumberBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("enc"), { selected: { t: [id("foe")] } }), "no window yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("enc"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "the attacker was sent home in response to its own attack");
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "the attacker left play, so it left the attacking party (CR 302.15)");
  assert.equal(engine.state.players[P1].influence, 30, "and its attack dealt no damage to my faction");
});

// --- RECUR ---------------------------------------------------------------------

const encRecur = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, player: PlayerId = P1) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id("enc"), abilityId: "recur", selected: {}, variables: {} } as never);

clause(ENCUMBER, "1:ability:recur", "from the discard pile it pays exactly 2, removes Encumber from the game, and I choose a non-resource card in the opponent's hand which they discard", () => {
  const { engine, id } = encumberBoard({ enc: "discard" });
  const before = ready(engine);
  const oppHand = handOf(engine, P2).length;
  encRecur(engine, id);
  assert.equal(before - ready(engine), 2, "Pay 2");
  assert.equal(zoneOf(engine, id("enc")), "removed", "Remove this card from the game");
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose (the opponent only discards)");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("ot")] });
  assert.equal(zoneOf(engine, id("ot")), "discard", "the chosen card is discarded");
  assert.ok(discardOf(engine, P2).includes(id("ot")), "into its owner's discard pile");
  assert.equal(handOf(engine, P2).length, oppHand - 1, "exactly one card");
  for (const key of ["oc", "oi", "ol", "or1"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays`);
});

for (const key of ["oc", "oi", "ol", "ot"] as const) {
  clause(ENCUMBER, "1:ability:recur", `any non-resource card type can be chosen: the opponent's ${typeOfKey[key]} card`, () => {
    const { engine, id } = encumberBoard({ enc: "discard" });
    encRecur(engine, id);
    resolvePendingResponses(engine);
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(zoneOf(engine, id(key)), "discard");
    assert.equal(handOf(engine, P2).length, 4);
  });
}

clause(ENCUMBER, "1:ability:recur", "a RESOURCE card cannot be chosen, nor can my own hand cards or cards in play; exactly one card", () => {
  const { engine, id } = encumberBoard({ enc: "discard" });
  encRecur(engine, id);
  resolvePendingResponses(engine);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["or1"]), "a resource card");
  refused(answerWith(["mh"]), "a card in MY hand");
  refused(answerWith(["foe"]), "a card in play");
  refused(answerWith([]), "I must choose one");
  refused(answerWith(["oc", "oi"]), "only one");
  answerWith(["oc"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oc")), "discard", "control");
});

clause(ENCUMBER, "1:ability:recur", "if the opponent's hand holds only resource cards, nothing is discarded and the game is not stuck", () => {
  const { engine, id } = encumberBoard({ enc: "discard", oppHand: "resourcesOnly" });
  encRecur(engine, id);
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("or1")), "hand");
  assert.equal(zoneOf(engine, id("enc")), "removed");
});

clause(ENCUMBER, "1:ability:recur", "with the opponent's hand empty it just resolves", () => {
  const { engine, id } = encumberBoard({ enc: "discard", oppHand: "empty" });
  encRecur(engine, id);
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("enc")), "removed");
});

clause(ENCUMBER, "1:ability:recur", "can only be used when Encumber is in my discard pile: from the hand, the deck, in play or already removed it is refused", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const { engine, id } = encumberBoard({ enc: zone });
    refused(() => encRecur(engine, id), `Encumber in ${zone}`);
    assert.equal(ready(engine), 6, "nothing was paid");
  }
  const ok = encumberBoard({ enc: "discard" });
  encRecur(ok.engine, ok.id);
  assert.equal(zoneOf(ok.engine, ok.id("enc")), "removed", "control");
});

clause(ENCUMBER, "1:ability:recur", "it is YOUR discard pile that counts: the opponent's Encumber in their discard pile cannot be recurred by me", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "enc", def: printing(ENCUMBER), owner: P2, zone: "discard" },
      { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "hand" },
      ...res({ obsession: 6 })
    ]
  });
  refused(() => encRecur(engine, id, P1), "not my discard pile");
  assert.equal(zoneOf(engine, id("enc")), "discard");
});

clause(ENCUMBER, "1:ability:recur", "is refused one resource short of Pay 2, allowed with exactly 2", () => {
  const short = encumberBoard({ enc: "discard", icons: { obsession: 1 } });
  refused(() => encRecur(short.engine, short.id), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("enc")), "discard");
  const exact = encumberBoard({ enc: "discard", icons: { obsession: 2 } });
  encRecur(exact.engine, exact.id);
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("enc")), "removed");
});

clause(ENCUMBER, "1:ability:recur", "needs [O]: two other resources alone are not enough, one [O] among them is", () => {
  const none = encumberBoard({ enc: "discard", icons: { greed: 4 } });
  refused(() => encRecur(none.engine, none.id), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("enc")), "discard");
  const one = encumberBoard({ enc: "discard", icons: { greed: 1, obsession: 1 } });
  encRecur(one.engine, one.id);
  assert.equal(zoneOf(one.engine, one.id("enc")), "removed");
});

clause(ENCUMBER, "1:ability:recur", "it is an ability: it works on the opponent's turn in response to their action", () => {
  const { engine, id } = encumberBoard({ enc: "discard", turn: 2, active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  encRecur(engine, id);
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(zoneOf(engine, id("oc")), "discard");
  assert.equal(zoneOf(engine, id("enc")), "removed");
});

clause(ENCUMBER, "1:ability:recur", "can only be used once: the removed card is gone for good", () => {
  const { engine, id } = encumberBoard({ enc: "discard" });
  encRecur(engine, id);
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  refused(() => encRecur(engine, id), "the card was removed from the game");
  assert.equal(ready(engine), 4);
});

clause(ENCUMBER, "1:ability:recur", "after playing Encumber normally, its RECUR becomes available from the discard pile", () => {
  const { engine, id } = encumberBoard({ icons: { obsession: 8 } });
  refused(() => encRecur(engine, id), "still in hand");
  encumber(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("enc")), "discard");
  encRecur(engine, id);
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(zoneOf(engine, id("enc")), "removed");
  assert.equal(zoneOf(engine, id("oc")), "discard");
});

// =================================================================================
// Ensorcelled Familiar
// When this card enters play, you may search your deck for a tactic and reveal it. If you
// do, put it into your hand.
// RECUR: [O][O][O] -- COST: Use this only if this card is in your discard pile. Pay 2. Remove
// this card from the game. Pick a tactic in your discard pile. -- EFFECT: Put the tactic into
// your hand.
// Character (familiar), cost 5, [O][O][O], 1 strength / 3 speed / 1 life.
// =================================================================================

const FAMILIAR = "9d9e48cb-83f4-4b81-8a86-1a0c2b18e282";

function familiarBoard(
  opts: {
    fam?: "hand" | "discard" | "deck" | "play" | "removed";
    icons?: Icons;
    deckTactics?: number;
    deckChars?: number;
    discardTactics?: number;
    turn?: number;
    active?: PlayerId;
    random?: () => number;
    extra?: CardPlacement[];
  } = {}
) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fam", def: printing(FAMILIAR), owner: P1, zone: opts.fam ?? "hand" },
      // interleave so the tactics are not all at the top of the deck
      ...Array.from({ length: Math.max(opts.deckTactics ?? 3, opts.deckChars ?? 4) }, (_, i) => i).flatMap((i) => [
        ...(i < (opts.deckChars ?? 4) ? [{ key: `c${i}`, def: character({ name: `C${i}` }), owner: P1, zone: "deck" as const }] : []),
        ...(i < (opts.deckTactics ?? 3) ? [{ key: `t${i}`, def: tactic({ name: `T${i}` }), owner: P1, zone: "deck" as const }] : [])
      ]),
      { key: "thing", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
      ...tactics("ot", 2, P2, "deck"),
      ...tactics("dt", opts.discardTactics ?? 2, P1, "discard"),
      { key: "dc", def: character({ name: "DiscardChar" }), owner: P1, zone: "discard" },
      ...tactics("odt", 2, P2, "discard"),
      { key: "mh", def: tactic({ name: "HandTactic" }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const enterFamiliar = (engine: SpoilsEngine, id: (k: string) => CardInstanceId) => play(engine, P1, id("fam"));

clause(FAMILIAR, "0:rule", "deploys for exactly 5 and enters play with its printed 1 strength / 3 speed / 1 life", () => {
  const { engine, id } = familiarBoard();
  const before = ready(engine);
  enterFamiliar(engine, id);
  assert.equal(before - ready(engine), 5, "the printed cost of 5");
  assert.equal(zoneOf(engine, id("fam")), "play");
  assert.equal(engine.getStat(id("fam"), "strength"), 1);
  assert.equal(engine.getStat(id("fam"), "speed"), 3);
  assert.equal(engine.getStat(id("fam"), "life"), 1);
});

clause(FAMILIAR, "0:rule", "when it enters play I may search my deck for a tactic: the chosen tactic goes to my hand", () => {
  const { engine, id } = familiarBoard();
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  enterFamiliar(engine, id);
  const pc = pending(engine);
  assert.ok(pc, "the search prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the Familiar left the hand, the tactic joined it");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1, "exactly one card left the deck");
  assert.equal(zoneOf(engine, id("t0")), "deck", "the other tactics stay in the deck");
  assert.equal(zoneOf(engine, id("t2")), "deck");
});

for (const key of ["t0", "t1", "t2"]) {
  clause(FAMILIAR, "0:rule", `any tactic in the deck can be found (${key})`, () => {
    const { engine, id } = familiarBoard();
    enterFamiliar(engine, id);
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(zoneOf(engine, id(key)), "hand");
  });
}

clause(FAMILIAR, "0:rule", "the found tactic is revealed to everyone before it goes to my hand", () => {
  const { engine, id } = familiarBoard();
  enterFamiliar(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t2")] });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("t2")], "the tactic I found");
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(FAMILIAR, "0:rule", "'you MAY search': I can find nothing; then no card moves to my hand", () => {
  const { engine, id } = familiarBoard();
  const handBefore = [...handOf(engine, P1)];
  enterFamiliar(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("fam")), "play", "the Familiar is still in play");
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("fam")), "my hand only lost the Familiar");
  for (const key of ["t0", "t1", "t2"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
});

clause(FAMILIAR, "0:rule", "only a TACTIC can be found: a character or an item in the deck is refused", () => {
  const { engine, id } = familiarBoard();
  enterFamiliar(engine, id);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["c0"]), "a character");
  refused(answerWith(["thing"]), "an item");
  assert.ok(pending(engine), "the prompt stays open");
  answerWith(["t0"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("t0")), "hand", "control: a tactic is accepted");
});

clause(FAMILIAR, "0:rule", "only from MY deck: the opponent's deck, my discard pile and my hand are refused", () => {
  const { engine, id } = familiarBoard();
  enterFamiliar(engine, id);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["ot0"]), "a tactic in the opponent's deck");
  refused(answerWith(["dt0"]), "a tactic in my discard pile");
  refused(answerWith(["mh"]), "a tactic in my hand");
  refused(answerWith(["odt0"]), "a tactic in the opponent's discard pile");
  answerWith(["t1"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("t1")), "hand");
});

clause(FAMILIAR, "0:rule", "only ONE tactic: two are refused", () => {
  const { engine, id } = familiarBoard();
  enterFamiliar(engine, id);
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("t0"), id("t1")] } } as never),
    "two tactics"
  );
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t0")] });
  assert.equal(zoneOf(engine, id("t1")), "deck");
});

clause(FAMILIAR, "0:rule", "the deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const { engine, id } = familiarBoard({ random: () => 0 });
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("t1"));
  enterFamiliar(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t1")] });
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(FAMILIAR, "0:rule", "the deck is shuffled also when I search and find nothing (CR 312.2)", () => {
  const { engine, id } = familiarBoard({ random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  enterFamiliar(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "searched decks are shuffled whether or not a card was found");
});

clause(FAMILIAR, "0:rule", "the deck is shuffled afterwards (CR 312.1) even when there is no tactic in it to find", () => {
  const { engine, id } = familiarBoard({ deckTactics: 0, random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  enterFamiliar(engine, id);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("fam")), "play");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "the deck was searched, so it is shuffled even though there was no tactic");
});

clause(FAMILIAR, "0:rule", "with no tactic in the deck it resolves cleanly: no stuck prompt and nothing is added to the hand", () => {
  const { engine, id } = familiarBoard({ deckTactics: 0 });
  const handBefore = handOf(engine, P1).length;
  enterFamiliar(engine, id);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
});

clause(FAMILIAR, "0:rule", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = familiarBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  enterFamiliar(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t0")] });
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(FAMILIAR, "0:rule", "it triggers when THIS card enters play, not while it is merely being deployed: nothing is found before responses finish", () => {
  const { engine, id } = familiarBoard();
  playRaw(engine, P1, id("fam"));
  assert.equal(pending(engine), undefined, "no search yet: the Familiar is still being deployed");
  assert.equal(zoneOf(engine, id("fam")), "deploying");
  resolvePendingResponses(engine);
  assert.ok(pending(engine), "the search opens once it has entered play");
  assert.equal(zoneOf(engine, id("fam")), "play");
});

clause(FAMILIAR, "0:rule", "it also triggers when the Familiar is put into play by another effect (it entered play)", () => {
  const putter = tactic({
    name: "Putter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = familiarBoard({ extra: [{ key: "putter", def: putter, owner: P1, zone: "hand" }] });
  play(engine, P1, id("putter"), { selected: { t: [id("fam")] } });
  const pc = pending(engine);
  assert.ok(pc, "a search prompt opens");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("t2")] });
  assert.equal(zoneOf(engine, id("t2")), "hand");
});

clause(FAMILIAR, "0:rule", "it does not trigger when ANOTHER card enters play", () => {
  const { engine, id } = familiarBoard({ fam: "play", extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("ally"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("ally")), "play");
  for (const key of ["t0", "t1", "t2"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
});

clause(FAMILIAR, "0:rule", "if the Familiar is terminated while it is being deployed it never enters play, so there is no search", () => {
  const { engine, id } = familiarBoard({ extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("fam"));
  respondWith(engine, P2, id("counter"), { dep: [id("fam")] });
  assert.equal(zoneOf(engine, id("fam")), "discard", "terminated: to its owner's discard pile");
  assert.equal(pending(engine), undefined, "no search");
  for (const key of ["t0", "t1", "t2"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
});

clause(FAMILIAR, "0:rule", "is refused one resource short of 5, allowed with exactly 5", () => {
  const short = familiarBoard({ icons: { obsession: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("fam")), "4 resources");
  assert.equal(zoneOf(short.engine, short.id("fam")), "hand");
  const exact = familiarBoard({ icons: { obsession: 5 } });
  enterFamiliar(exact.engine, exact.id);
  assert.equal(zoneOf(exact.engine, exact.id("fam")), "play");
  assert.equal(ready(exact.engine), 0);
});

clause(FAMILIAR, "0:rule", "needs [O][O][O]: two [O] among many other resources is refused, three are accepted", () => {
  const two = familiarBoard({ icons: { obsession: 2, greed: 6 } });
  refused(() => playRaw(two.engine, P1, two.id("fam")), "two [O]");
  const none = familiarBoard({ icons: { greed: 8 } });
  refused(() => playRaw(none.engine, P1, none.id("fam")), "no [O]");
  const three = familiarBoard({ icons: { obsession: 3, greed: 3 } });
  enterFamiliar(three.engine, three.id);
  assert.equal(zoneOf(three.engine, three.id("fam")), "play");
});

clause(FAMILIAR, "0:rule", "is a character: it can only be deployed on its controller's own turn", () => {
  const { engine, id } = familiarBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("fam")), "the opponent's turn");
  assert.equal(zoneOf(engine, id("fam")), "hand");
});

// --- RECUR ---------------------------------------------------------------------

const famRecur = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, tacticKey: string | null, player: PlayerId = P1) =>
  engine.perform({
    type: "activateAbility",
    playerId: player,
    cardId: id("fam"),
    abilityId: "recur",
    selected: tacticKey ? { rt: [id(tacticKey)] } : {},
    variables: {}
  } as never);

clause(FAMILIAR, "1:ability:recur", "from the discard pile it pays exactly 2, removes the Familiar from the game and puts the picked tactic from my discard pile into my hand", () => {
  const { engine, id } = familiarBoard({ fam: "discard" });
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  famRecur(engine, id, "dt1");
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine), 2, "Pay 2");
  assert.equal(zoneOf(engine, id("fam")), "removed", "Remove this card from the game");
  assert.equal(zoneOf(engine, id("dt1")), "hand", "the tactic is in my hand");
  assert.equal(zoneOf(engine, id("dt0")), "discard", "the other tactic in the discard pile stays");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.equal(engine.state.pendingChoice, undefined);
});

for (const key of ["dt0", "dt1"]) {
  clause(FAMILIAR, "1:ability:recur", `either tactic in my discard pile can be picked (${key})`, () => {
    const { engine, id } = familiarBoard({ fam: "discard" });
    famRecur(engine, id, key);
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id(key)), "hand");
  });
}

clause(FAMILIAR, "1:ability:recur", "only a TACTIC in MY discard pile can be picked: a character in my discard pile, the opponent's discard pile, my hand and my deck are refused", () => {
  const { engine, id } = familiarBoard({ fam: "discard" });
  refused(() => famRecur(engine, id, "dc"), "a character in my discard pile");
  refused(() => famRecur(engine, id, "odt0"), "a tactic in the opponent's discard pile");
  refused(() => famRecur(engine, id, "mh"), "a tactic in my hand");
  refused(() => famRecur(engine, id, "t0"), "a tactic in my deck");
  assert.equal(zoneOf(engine, id("fam")), "discard", "nothing happened");
  assert.equal(ready(engine), 6, "nothing was paid");
  famRecur(engine, id, "dt0");
  assert.equal(zoneOf(engine, id("fam")), "removed", "control: a tactic in my discard pile works");
});

clause(FAMILIAR, "1:ability:recur", "the pick is part of the COST: with no tactic in my discard pile it cannot be used at all", () => {
  const { engine, id } = familiarBoard({ fam: "discard", discardTactics: 0 });
  refused(() => famRecur(engine, id, null), "no tactic to pick");
  assert.equal(zoneOf(engine, id("fam")), "discard");
  assert.equal(ready(engine), 6, "nothing was paid");
});

clause(FAMILIAR, "1:ability:recur", "a pick is required, and only one: none or two are refused", () => {
  const { engine, id } = familiarBoard({ fam: "discard" });
  refused(() => famRecur(engine, id, null), "no pick");
  refused(
    () =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fam"), abilityId: "recur", selected: { rt: [id("dt0"), id("dt1")] }, variables: {} } as never),
    "two picks"
  );
  assert.equal(zoneOf(engine, id("fam")), "discard");
});

clause(FAMILIAR, "1:ability:recur", "can only be used when the Familiar is in my discard pile: from the hand, the deck, in play or already removed it is refused", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const { engine, id } = familiarBoard({ fam: zone });
    refused(() => famRecur(engine, id, "dt0"), `Familiar in ${zone}`);
    assert.equal(ready(engine), 6, "nothing was paid");
    assert.equal(zoneOf(engine, id("dt0")), "discard");
  }
});

clause(FAMILIAR, "1:ability:recur", "it is MY discard pile that counts: the opponent's Familiar in their discard pile cannot be recurred by me", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fam", def: printing(FAMILIAR), owner: P2, zone: "discard" },
      { key: "dt0", def: tactic({ name: "MyTactic" }), owner: P1, zone: "discard" },
      ...res({ obsession: 6 })
    ]
  });
  refused(() => famRecur(engine, id, "dt0", P1), "not my Familiar");
  assert.equal(zoneOf(engine, id("fam")), "discard");
});

clause(FAMILIAR, "1:ability:recur", "is refused one resource short of Pay 2, allowed with exactly 2 (and [O][O][O])", () => {
  const short = familiarBoard({ fam: "discard", icons: { obsession: 3 } });
  // 3 resources would be enough to pay 2; a single resource is not
  const one = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fam", def: printing(FAMILIAR), owner: P1, zone: "discard" }, { key: "dt0", def: tactic({ name: "T" }), owner: P1, zone: "discard" }, ...res({ obsession: 1 })]
  });
  refused(() => famRecur(one.engine, one.id, "dt0"), "1 resource");
  assert.equal(zoneOf(one.engine, one.id("fam")), "discard");
  famRecur(short.engine, short.id, "dt0");
  assert.equal(zoneOf(short.engine, short.id("fam")), "removed", "3 [O] pay 2 and meet the threshold");
  assert.equal(ready(short.engine), 1);
});

clause(FAMILIAR, "1:ability:recur", "needs [O][O][O]: two [O] with plenty of other resources is refused", () => {
  const two = familiarBoard({ fam: "discard", icons: { obsession: 2, greed: 6 } });
  refused(() => famRecur(two.engine, two.id, "dt0"), "two [O]");
  assert.equal(zoneOf(two.engine, two.id("fam")), "discard");
  const none = familiarBoard({ fam: "discard", icons: { greed: 8 } });
  refused(() => famRecur(none.engine, none.id, "dt0"), "no [O]");
  const three = familiarBoard({ fam: "discard", icons: { obsession: 3 } });
  famRecur(three.engine, three.id, "dt0");
  assert.equal(zoneOf(three.engine, three.id("fam")), "removed", "three [O] is exactly enough");
});

clause(FAMILIAR, "1:ability:recur", "it is an ability: it works on the opponent's turn in response to their action", () => {
  const { engine, id } = familiarBoard({
    fam: "discard",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  famRecur(engine, id, "dt0");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("dt0")), "hand");
  assert.equal(zoneOf(engine, id("fam")), "removed");
});

clause(FAMILIAR, "1:ability:recur", "can only be used once: the removed Familiar is gone for good", () => {
  const { engine, id } = familiarBoard({ fam: "discard" });
  famRecur(engine, id, "dt0");
  resolvePendingResponses(engine);
  refused(() => famRecur(engine, id, "dt1"), "removed from the game");
  assert.equal(ready(engine), 4);
  assert.equal(zoneOf(engine, id("dt1")), "discard");
});

clause(FAMILIAR, "1:ability:recur", "the tactic goes to the hand, nothing is searched: the deck is untouched", () => {
  const { engine, id } = familiarBoard({ fam: "discard" });
  const deck = [...deckOf(engine, P1)];
  famRecur(engine, id, "dt0");
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.equal(engine.state.pendingChoice, undefined);
});

// =================================================================================
// Essence of Obsession
// Choose one of the following as this card's rules text:
//   OPTION 1 -- Your opponent discards a card.
//   OPTION 2 -- COST: Pick a character. EFFECT: This turn, the character gains COVERT.
//   OPTION 3 -- COST: Pick a character. EFFECT: This turn, the character loses 2 strength.
// Tactic, cost 1, [O][O].
// =================================================================================

const ESSENCE = "e4260352-6b62-41dc-a031-6dbc0faccb73";

function essenceBoard(opts: { icons?: Icons; oppHand?: number; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "eo", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 4, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 4 }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...cards("oh", opts.oppHand ?? 3, P2, "hand"),
      ...cards("d", 3, P1, "deck"),
      ...res(opts.icons ?? { obsession: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

const essence = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, mode: number, target?: CardInstanceId) =>
  play(engine, P1, id("eo"), { mode, selected: target ? { c: [target] } : {} });

const essenceRaw = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, mode: number | undefined, target?: CardInstanceId) =>
  engine.perform({
    type: "playCard",
    playerId: P1,
    cardId: id("eo"),
    selected: target ? { c: [target] } : {},
    variables: {},
    ...(mode !== undefined ? { mode } : {})
  } as never);

clause(ESSENCE, "0:rule", "exactly one of the three options is chosen as the card's rules text: option 1 does not also grant COVERT or take strength", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 0, id("foe"));
  answerBy(engine, "chooserSelectsTarget", P2, { selected: [id("oh0")] });
  assert.equal(zoneOf(engine, id("oh0")), "discard", "option 1 happened");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false, "no COVERT (option 2)");
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "no strength loss (option 3)");
});

clause(ESSENCE, "0:rule", "choosing option 2 does not also make the opponent discard or take strength", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 1, id("foe"));
  settled(engine);
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "option 2 happened");
  assert.equal(handOf(engine, P2).length, 3, "no discard (option 1)");
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "no strength loss (option 3)");
});

clause(ESSENCE, "0:rule", "choosing option 3 does not also make the opponent discard or grant COVERT", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 2, id("foe"));
  settled(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "option 3 happened");
  assert.equal(handOf(engine, P2).length, 3, "no discard (option 1)");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false, "no COVERT (option 2)");
});

clause(ESSENCE, "0:rule", "an option must be chosen: a mode outside 0-2 is refused", () => {
  const { engine, id } = essenceBoard();
  refused(() => essenceRaw(engine, id, 3, id("foe")), "mode 3 does not exist");
  refused(() => essenceRaw(engine, id, -1, id("foe")), "mode -1 does not exist");
  assert.equal(zoneOf(engine, id("eo")), "hand");
  assert.equal(ready(engine), 4, "nothing was paid");
  essenceRaw(engine, id, 1, id("foe"));
  assert.ok(engine.state.responseWindow, "control: a real option is accepted");
});

clause(ESSENCE, "0:rule", "playing without choosing an option is refused ('choose one of the following'): the engine silently plays option 1 instead", () => {
  const { engine, id } = essenceBoard();
  refused(() => essenceRaw(engine, id, undefined, id("foe")), "no option chosen");
  assert.equal(zoneOf(engine, id("eo")), "hand");
  assert.equal(ready(engine), 4);
});

clause(ESSENCE, "0:rule", "the card ends in its owner's discard pile whichever option was used", () => {
  for (const mode of [0, 1, 2]) {
    const { engine, id } = essenceBoard();
    essence(engine, id, mode, mode === 0 ? undefined : id("foe"));
    drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh0")] } : declineAll(pc)));
    assert.equal(zoneOf(engine, id("eo")), "discard", `option ${mode + 1}`);
  }
});

clause(ESSENCE, "0:rule", "pays exactly 1 whichever option is chosen", () => {
  for (const mode of [0, 1, 2]) {
    const { engine, id } = essenceBoard();
    const before = ready(engine);
    essence(engine, id, mode, mode === 0 ? undefined : id("foe"));
    drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh0")] } : declineAll(pc)));
    assert.equal(before - ready(engine), 1, `option ${mode + 1} pays the printed cost of 1`);
  }
});

clause(ESSENCE, "0:rule", "is refused with no resources at all, whichever option is chosen", () => {
  for (const mode of [0, 1, 2]) {
    const none = essenceBoard({ icons: {} });
    refused(() => essenceRaw(none.engine, none.id, mode, mode === 0 ? undefined : none.id("foe")), `no resources, option ${mode + 1}`);
    assert.equal(zoneOf(none.engine, none.id("eo")), "hand");
  }
});

clause(ESSENCE, "0:rule", "needs [O][O] whichever option is chosen: one [O] among many other resources is refused, two are accepted", () => {
  for (const mode of [0, 1, 2]) {
    const one = essenceBoard({ icons: { obsession: 1, greed: 5 } });
    refused(() => essenceRaw(one.engine, one.id, mode, mode === 0 ? undefined : one.id("foe")), `one [O], option ${mode + 1}`);
    const noneO = essenceBoard({ icons: { greed: 6 } });
    refused(() => essenceRaw(noneO.engine, noneO.id, mode, mode === 0 ? undefined : noneO.id("foe")), `no [O], option ${mode + 1}`);
    const two = essenceBoard({ icons: { obsession: 2, greed: 1 } });
    essenceRaw(two.engine, two.id, mode, mode === 0 ? undefined : two.id("foe"));
    assert.ok(two.engine.state.responseWindow, `two [O], option ${mode + 1}: accepted`);
  }
});

clause(ESSENCE, "0:rule", "can be played in response on the opponent's turn (it is a tactic), with any option", () => {
  const { engine, id } = essenceBoard({ turn: 2, active: P2 });
  refused(() => essenceRaw(engine, id, 1, id("foe")), "no window yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  essenceRaw(engine, id, 2, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the attacker lost 2 strength in response to its own attack");
});

// --- OPTION 1: your opponent discards a card ---------------------------------------

clause(ESSENCE, "1:option:OPTION 1", "my opponent discards exactly one card of THEIR choice from their hand", () => {
  const { engine, id } = essenceBoard();
  const myHand = handOf(engine, P1).length;
  essence(engine, id, 0);
  const pc = pending(engine);
  assert.ok(pc, "a discard choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what to discard");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh2")] });
  assert.equal(zoneOf(engine, id("oh2")), "discard");
  assert.equal(handOf(engine, P2).length, 2, "exactly one card");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("oh1")), "hand");
  assert.equal(handOf(engine, P1).length, myHand - 1, "my hand only lost Essence of Obsession");
});

clause(ESSENCE, "1:option:OPTION 1", "it needs no pick from me: option 1 plays without any target", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 0);
  assert.ok(pending(engine), "played fine without a pick");
});

clause(ESSENCE, "1:option:OPTION 1", "the discard is mandatory and exactly one: nothing, two, my hand and cards in play are refused", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 0);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith([]), "discarding nothing");
  refused(answerWith(["oh0", "oh1"]), "discarding two");
  refused(answerWith(["mh"]), "a card in MY hand");
  refused(answerWith(["foe"]), "a card in play");
  answerWith(["oh1"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oh1")), "discard", "control");
});

clause(ESSENCE, "1:option:OPTION 1", "an opponent with an empty hand discards nothing and nothing gets stuck", () => {
  const { engine, id } = essenceBoard({ oppHand: 0 });
  essence(engine, id, 0);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("eo")), "discard");
});

clause(ESSENCE, "1:option:OPTION 1", "an opponent with a single card in hand discards it", () => {
  const { engine, id } = essenceBoard({ oppHand: 1 });
  essence(engine, id, 0);
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh0")] } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("oh0")), "discard");
  assert.equal(handOf(engine, P2).length, 0);
});

// --- OPTION 2: COVERT ---------------------------------------------------------------

clause(ESSENCE, "2:option:OPTION 2", "the picked opposing character gains COVERT this turn; no other character does", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 1, id("foe"));
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "engine.getKeywords(id(\"foe\")).includes(\"covert\")");
  for (const key of ["foe2", "mine", "mine2"]) assert.equal(engine.getKeywords(id(key)).includes("covert"), false, `${key} does not`);
  assert.equal(handOf(engine, P2).length, 3, "and nobody discards");
});

clause(ESSENCE, "2:option:OPTION 2", "I can pick one of my own characters", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 1, id("mine"));
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("mine2")).includes("covert"), false);
});

clause(ESSENCE, "2:option:OPTION 2", "the COVERT is real: a party of only the picked attacker cannot be blocked by a non-covert character", () => {
  const { engine, id } = essenceBoard({
    turn: 2,
    extra: [{ key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]
  });
  essence(engine, id, 1, id("mine"));
  declareAttackBy(engine, P1, [id("mine")]);
  refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] }), "a non-covert blocker");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("covertBlocker")], "a covert blocker may block it");
});

clause(ESSENCE, "2:option:OPTION 2", "the COVERT lasts this turn only", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 1, id("mine"));
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false, "gone when the turn ends");
});

clause(ESSENCE, "2:option:OPTION 2", "the pick is a cost and is required: no pick is refused", () => {
  const { engine, id } = essenceBoard();
  refused(() => essenceRaw(engine, id, 1, undefined), "option 2 needs a character");
  refused(
    () => engine.perform({ type: "playCard", playerId: P1, cardId: id("eo"), mode: 1, selected: { c: [id("foe"), id("foe2")] }, variables: {} } as never),
    "two picks"
  );
  assert.equal(zoneOf(engine, id("eo")), "hand");
  assert.equal(ready(engine), 4);
});

clause(ESSENCE, "2:option:OPTION 2", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = essenceBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  for (const [what, target] of [
    ["an item", id("foeThing")],
    ["a location", id("foePlace")],
    ["a faction", engine.state.players[P2].factionId!],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("mh")],
    ["a character in their hand", id("oh0")]
  ] as const) {
    refused(() => essenceRaw(engine, id, 1, target), what);
  }
  essenceRaw(engine, id, 1, id("foe"));
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

// --- OPTION 3: loses 2 strength ------------------------------------------------------

clause(ESSENCE, "3:option:OPTION 3", "the picked opposing character loses exactly 2 strength this turn; nobody else does", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 2, id("foe"));
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
  for (const key of ["foe2", "mine", "mine2"]) assert.equal(engine.getStat(id(key), "strength"), 4, `${key} is unaffected`);
  assert.equal(engine.getStat(id("foe"), "life"), 5, "only strength changes");
  assert.equal(engine.getStat(id("foe"), "speed"), 2, "only strength changes");
});

clause(ESSENCE, "3:option:OPTION 3", "I can pick one of my own characters", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 2, id("mine"));
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("foe"), "strength"), 4);
});

clause(ESSENCE, "3:option:OPTION 3", "the loss lasts this turn only", () => {
  const { engine, id } = essenceBoard();
  essence(engine, id, 2, id("foe"));
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "back to normal after the turn");
});

clause(ESSENCE, "3:option:OPTION 3", "a character with exactly 2 strength is reduced to 0", () => {
  const { engine, id } = essenceBoard({ extra: [{ key: "two", def: character({ name: "Two", strength: 2 }), owner: P2, zone: "play" }] });
  essence(engine, id, 2, id("two"));
  assert.equal(engine.getStat(id("two"), "strength"), 0);
});

clause(ESSENCE, "3:option:OPTION 3", "a character with 1 strength is left at 0 strength, not -1 (CR 410.4)", () => {
  const { engine, id } = essenceBoard({ extra: [{ key: "one", def: character({ name: "One", strength: 1 }), owner: P2, zone: "play" }] });
  essence(engine, id, 2, id("one"));
  assert.equal(engine.getStat(id("one"), "strength"), 0);
});

clause(ESSENCE, "3:option:OPTION 3", "the strength loss is real in a battle: a 4-strength attacker deals 2 damage to the faction", () => {
  const { engine, id } = essenceBoard({ turn: 2 });
  essence(engine, id, 2, id("mine"));
  const influence = engine.state.players[P2].influence;
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - engine.state.players[P2].influence, 2, "4 strength - 2 = 2 battle damage");
});

clause(ESSENCE, "3:option:OPTION 3", "the pick is a cost and is required: no pick, two picks, or a non-character are refused", () => {
  const { engine, id } = essenceBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  refused(() => essenceRaw(engine, id, 2, undefined), "no pick");
  refused(
    () => engine.perform({ type: "playCard", playerId: P1, cardId: id("eo"), mode: 2, selected: { c: [id("foe"), id("foe2")] }, variables: {} } as never),
    "two picks"
  );
  refused(() => essenceRaw(engine, id, 2, id("foeThing")), "an item");
  refused(() => essenceRaw(engine, id, 2, id("foePlace")), "a location");
  refused(() => essenceRaw(engine, id, 2, engine.state.players[P2].factionId!), "a faction");
  refused(() => essenceRaw(engine, id, 2, id("fd")), "a face-down card");
  refused(() => essenceRaw(engine, id, 2, id("mh")), "a card in my hand");
  essenceRaw(engine, id, 2, id("foe"));
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

// =================================================================================
// Evanesce
// COST: Pick a character. -- EFFECT: Put the character into its owner's hand.
// FLIP UP: 1 [O][O]
// Tactic, cost 3, [O][O].
// =================================================================================

const EVANESCE = "a4e374e2-a245-46c5-aae3-72c8a156144b";

function evanesceBoard(
  opts: { icons?: Icons; evan?: "hand" | "faceDown" | "faceUp" | "discard"; oppIcons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const evan = opts.evan ?? "hand";
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "ev",
        def: printing(EVANESCE),
        owner: P1,
        zone: evan === "hand" ? "hand" : evan === "discard" ? "discard" : "play",
        faceDown: evan === "faceDown" ? true : undefined
      },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { obsession: 5 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const evanesce = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId) =>
  play(engine, P1, id("ev"), { selected: { c: [target] } });

const flipEvanesce = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target?: CardInstanceId, player: PlayerId = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId: id("ev"), selected: target ? { c: [target] } : {}, variables: {} });

clause(EVANESCE, "0:ability", "pays exactly 3; the picked opposing character is put into its owner's hand and nothing else moves", () => {
  const { engine, id } = evanesceBoard();
  const before = ready(engine);
  evanesce(engine, id, id("foe"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3");
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "in its owner's hand");
  for (const key of ["foe2", "foePlace", "foeThing", "mine"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(engine, id("ev")), "discard", "the tactic ends in its owner's discard pile");
});

clause(EVANESCE, "0:ability", "my own character can be picked: it goes to my hand", () => {
  const { engine, id } = evanesceBoard();
  evanesce(engine, id, id("mine"));
  assert.ok(handOf(engine, P1).includes(id("mine")), "handOf(engine, P1).includes(id(\"mine\"))");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(EVANESCE, "0:ability", "a character I control but do not own goes to its OWNER's hand", () => {
  const { engine, id } = evanesceBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  evanesce(engine, id, id("stolen"));
  assert.ok(handOf(engine, P2).includes(id("stolen")), "handOf(engine, P2).includes(id(\"stolen\"))");
  assert.equal(handOf(engine, P1).includes(id("stolen")), false);
});

clause(EVANESCE, "0:ability", "the returned character comes back undamaged and ready", () => {
  const { engine, id } = evanesceBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 3, depleted: true }] });
  evanesce(engine, id, id("hurt"));
  assert.equal(engine.state.cards[id("hurt")].damage, 0);
  assert.equal(engine.state.cards[id("hurt")].depleted, false);
});

clause(EVANESCE, "0:ability", "ONLY a character can be picked (unlike Encumber, not a location): a location, an item, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = evanesceBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  const attempt = (target: CardInstanceId) => () => playRaw(engine, P1, id("ev"), { selected: { c: [target] } });
  refused(attempt(id("foePlace")), "a location");
  refused(attempt(id("foeThing")), "an item");
  refused(attempt(engine.state.players[P2].factionId!), "a faction");
  refused(attempt(engine.state.players[P1].factionId!), "my own faction");
  refused(attempt(id("fd")), "a face-down card");
  refused(attempt(id("mh")), "a character in my hand");
  refused(attempt(id("oc")), "a character in the opponent's hand");
  assert.equal(zoneOf(engine, id("ev")), "hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(EVANESCE, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const { engine, id } = evanesceBoard();
  refused(() => playRaw(engine, P1, id("ev"), { selected: {} }), "no pick");
  refused(() => playRaw(engine, P1, id("ev"), { selected: { c: [id("foe"), id("foe2")] } }), "two picks");
  assert.equal(zoneOf(engine, id("ev")), "hand");
});

clause(EVANESCE, "0:ability", "an item attached to the bounced character follows it to its owner's hand (CR 301.4a), it is not destroyed", () => {
  const gear = item({
    name: "Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });
  const { engine, id } = evanesceBoard({ extra: [{ key: "gear", def: gear, owner: P2, zone: "play", attachedToKey: "foe" }] });
  evanesce(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("gear")), "hand", "attached cards leave play the same way the host does: into its owner's hand");
});

clause(EVANESCE, "0:ability", "if the picked character is destroyed in response, it stays in the discard pile and is not pulled into a hand (CR 402.4)", () => {
  const { engine, id } = evanesceBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("ev"), { selected: { c: [id("foe")] } });
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard", "destroyed in response: it is not in play any more, so it cannot be put into a hand");
});

clause(EVANESCE, "0:ability", "is refused one resource short of its cost of 3, allowed with exactly 3", () => {
  const short = evanesceBoard({ icons: { obsession: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("ev"), { selected: { c: [short.id("foe")] } }), "2 resources");
  assert.equal(zoneOf(short.engine, short.id("ev")), "hand");
  const exact = evanesceBoard({ icons: { obsession: 3 } });
  evanesce(exact.engine, exact.id, exact.id("foe"));
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(EVANESCE, "0:ability", "needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = evanesceBoard({ icons: { obsession: 1, greed: 5 } });
  refused(() => playRaw(one.engine, P1, one.id("ev"), { selected: { c: [one.id("foe")] } }), "one [O]");
  const none = evanesceBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("ev"), { selected: { c: [none.id("foe")] } }), "no [O]");
  const two = evanesceBoard({ icons: { obsession: 2, greed: 1 } });
  evanesce(two.engine, two.id, two.id("foe"));
  assert.equal(zoneOf(two.engine, two.id("foe")), "hand", "two [O] is enough");
});

clause(EVANESCE, "0:ability", "can be played in response on the opponent's turn (it is a tactic): the attacker is sent home and the attack ends", () => {
  const { engine, id } = evanesceBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("ev"), { selected: { c: [id("foe")] } }), "no window yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("ev"), { selected: { c: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "the attacker left play, so it left the attacking party (CR 302.15)");
});

// --- FLIP UP -------------------------------------------------------------------

clause(EVANESCE, "1:flipUp", "a face-down Evanesce is a resource: it provides Volition and is in the resource pool until it is flipped", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 2 } });
  assert.equal(engine.isResource(id("ev")), true);
  assert.equal(ready(engine), 3, "two Obsession plus the face-down Evanesce");
  assert.equal(engine.getThresholds(P1).volition ?? 0, 1);
});

clause(EVANESCE, "1:flipUp", "flipping it up resolves it as the tactic: the picked character goes to its owner's hand and Evanesce ends in the discard pile", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 4 } });
  flipEvanesce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "handOf(engine, P2).includes(id(\"foe\"))");
  assert.equal(zoneOf(engine, id("ev")), "discard", "a flipped-up tactic goes to its owner's discard pile when it has resolved");
  assert.equal(engine.state.cards[id("ev")].faceDown, false);
  for (const key of ["foe2", "mine"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
});

clause(EVANESCE, "1:flipUp", "it pays only the FLIP UP cost of 1 (not the card's cost of 3)", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 4 } });
  const before = ready(engine);
  assert.equal(before, 5, "four Obsession plus the face-down Evanesce");
  flipEvanesce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  const after = ready(engine);
  // The card stops being a resource (-1) and one resource is paid (-1); the paid one may be the card itself (CR 507.4b), so 3 or 4 remain.
  assert.ok(after === 3 || after === 4, `expected 3 or 4 resources left (1 paid), got ${after}`);
});

clause(EVANESCE, "1:flipUp", "with exactly [O][O] and the card itself it can be flipped (cost 1 paid by a resource or the card itself)", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 2 } });
  flipEvanesce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("ev")), "discard");
});

clause(EVANESCE, "1:flipUp", "FLIP UP needs [O][O]: one [O] among many other resources is refused (and the card stays face-down), two are accepted", () => {
  const one = evanesceBoard({ evan: "faceDown", icons: { obsession: 1, greed: 6 } });
  refused(() => flipEvanesce(one.engine, one.id, one.id("foe")), "one [O]");
  assert.equal(one.engine.state.cards[one.id("ev")].faceDown, true, "still face-down");
  assert.equal(zoneOf(one.engine, one.id("foe")), "play");
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = evanesceBoard({ evan: "faceDown", icons: { greed: 6 } });
  refused(() => flipEvanesce(none.engine, none.id, none.id("foe")), "no [O]");
  const two = evanesceBoard({ evan: "faceDown", icons: { obsession: 2, greed: 1 } });
  flipEvanesce(two.engine, two.id, two.id("foe"));
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("foe")), "hand");
});

clause(EVANESCE, "1:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const onlyVolition = evanesceBoard({ evan: "faceDown", icons: { greed: 3 } });
  refused(() => flipEvanesce(onlyVolition.engine, onlyVolition.id, onlyVolition.id("foe")), "no [O] anywhere");
  const theirs = evanesceBoard({ evan: "faceDown", icons: { greed: 3 }, oppIcons: { obsession: 4 } });
  refused(() => flipEvanesce(theirs.engine, theirs.id, theirs.id("foe")), "only the opponent has [O]");
  assert.equal(theirs.engine.state.cards[theirs.id("ev")].faceDown, true);
});

clause(EVANESCE, "1:flipUp", "the pick restrictions still apply: only a character in play (no location, item, faction, face-down card) and exactly one", () => {
  const { engine, id } = evanesceBoard({
    evan: "faceDown",
    icons: { obsession: 4 },
    extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }]
  });
  refused(() => flipEvanesce(engine, id, id("foePlace")), "a location");
  refused(() => flipEvanesce(engine, id, id("foeThing")), "an item");
  refused(() => flipEvanesce(engine, id, engine.state.players[P2].factionId!), "a faction");
  refused(() => flipEvanesce(engine, id, id("fd")), "a face-down card");
  refused(() => flipEvanesce(engine, id, id("mh")), "a character in my hand");
  refused(() => flipEvanesce(engine, id, undefined), "no pick");
  assert.equal(engine.state.cards[id("ev")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(engine), 5, "nothing was paid by the refused attempts");
  flipEvanesce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "control: a character is accepted");
});

clause(EVANESCE, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from the hand, not face-up)", () => {
  const theirs = evanesceBoard({ evan: "faceDown", icons: { obsession: 4 }, oppIcons: { obsession: 4 } });
  refused(() => flipEvanesce(theirs.engine, theirs.id, theirs.id("foe"), P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("ev")].faceDown, true);
  const inHand = evanesceBoard({ evan: "hand", icons: { obsession: 4 } });
  refused(() => flipEvanesce(inHand.engine, inHand.id, inHand.id("foe")), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("ev")), "hand");
});

clause(EVANESCE, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 4 }, turn: 2, active: P2 });
  refused(() => flipEvanesce(engine, id, id("foe")), "nothing to respond to yet");
  assert.equal(engine.state.cards[id("ev")].faceDown, true);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  flipEvanesce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "flipped up in response to the attack");
});

clause(EVANESCE, "1:flipUp", "when it is flipped up, a destroyed-in-response pick stays in the discard pile (the same effect as casting it)", () => {
  const { engine, id } = evanesceBoard({ evan: "faceDown", icons: { obsession: 4 }, extra: [{ key: "dead", def: character({ name: "Dead" }), owner: P2, zone: "discard" }] });
  refused(() => flipEvanesce(engine, id, id("dead")), "a character already in a discard pile cannot be picked");
  assert.equal(zoneOf(engine, id("dead")), "discard");
});

clause(EVANESCE, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const { engine, id } = evanesceBoard({
    evan: "faceDown",
    icons: { obsession: 4 },
    extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }]
  });
  holdFlipUp(() => flipEvanesce(engine, id, id("foe")));
  assert.ok(engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("foe")), "play", "the effect has not happened yet");
  respondWith(engine, P2, id("counter"), { dep: [id("ev")] });
  assert.equal(zoneOf(engine, id("foe")), "play", "terminated in response: the character was not returned");
  assert.equal(zoneOf(engine, id("ev")), "discard", "a terminated card goes to its owner's discard pile (CR 314.1)");
});

// =================================================================================
// Fiendish Fez
// ATTACH TO CHARACTER
// The attached character loses 2 strength and cannot attack.
// MOVE -- COST: Use this only not during a battle. Pay 3. Pick a character. -- EFFECT: Attach this
// card to the character.
// Item (gear), cost 3, [O].
// =================================================================================

const FEZ = "0b55606d-d7fe-4e34-810d-7d86cce077e7";

function fezBoard(
  opts: { icons?: Icons; fez?: "hand" | "play"; host?: string; turn?: number; active?: PlayerId; extra?: CardPlacement[]; second?: boolean } = {}
) {
  const fez = opts.fez ?? "hand";
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fez", def: printing(FEZ), owner: P1, zone: fez, attachedToKey: fez === "play" ? opts.host ?? "mine" : undefined },
      ...(opts.second ? [{ key: "fez2", def: printing(FEZ), owner: P1, zone: "play" as const, attachedToKey: opts.host ?? "mine" }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 5, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 5, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 5, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const deployFez = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, host: CardInstanceId) =>
  play(engine, P1, id("fez"), { selected: { attachTo: [host] } });

const moveFez = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId | undefined, player: PlayerId = P1, fezKey = "fez") =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id(fezKey), abilityId: "move", selected: target ? { c: [target] } : {}, variables: {} } as never);

const attackWith = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, key: string) =>
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id(key)], target: { type: "faction", playerId: P2 } });

clause(FEZ, "0:attach", "deploys for exactly 3 and enters play attached to the picked character (one of mine)", () => {
  const { engine, id } = fezBoard();
  const before = ready(engine);
  deployFez(engine, id, id("mine"));
  assert.equal(zoneOf(engine, id("fez")), "play");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine"), "attached to the picked character");
  assert.equal(before - ready(engine), 3, "the printed cost of 3");
  assert.equal(engine.state.cards[id("mine2")].attachedTo, undefined, "no other character gets it");
  assert.equal(engine.state.cards[id("fez")].controllerId, P1);
});

clause(FEZ, "0:attach", "it can attach to an opponent's character (ATTACH TO CHARACTER names no controller): I still control the Fez", () => {
  const { engine, id } = fezBoard();
  deployFez(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("fez")), "play");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
  assert.equal(engine.state.cards[id("fez")].controllerId, P1);
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "and it hexes the opposing character");
});

clause(FEZ, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card and cards outside play", () => {
  const { engine, id } = fezBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  const attempt = (host: CardInstanceId) => () => playRaw(engine, P1, id("fez"), { selected: { attachTo: [host] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(engine.state.players[P2].factionId!), "a faction");
  refused(attempt(engine.state.players[P1].factionId!), "my own faction");
  refused(attempt(id("fd")), "a face-down card (only a resource)");
  refused(attempt(id("mh")), "a character in my hand");
  refused(attempt(id("oc")), "a character in the opponent's hand");
  assert.equal(zoneOf(engine, id("fez")), "hand", "nothing was played");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(FEZ, "0:attach", "a host must be picked, exactly one", () => {
  const { engine, id } = fezBoard();
  refused(() => playRaw(engine, P1, id("fez"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(engine, P1, id("fez"), { selected: {} }), "no host declared");
  refused(() => playRaw(engine, P1, id("fez"), { selected: { attachTo: [id("mine"), id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(engine, id("fez")), "hand");
});

clause(FEZ, "0:attach", "with no character in play at all it cannot be deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fez", def: printing(FEZ), owner: P1, zone: "hand" }, ...res({ obsession: 6 })]
  });
  refused(() => playRaw(engine, P1, id("fez"), { selected: { attachTo: [] } }), "no host available");
  assert.equal(zoneOf(engine, id("fez")), "hand");
  assert.equal(ready(engine), 6);
});

clause(FEZ, "0:attach", "if the picked host is destroyed in response, the Fez never enters play: it goes to its owner's discard pile (CR 507.2c)", () => {
  const { engine, id } = fezBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("fez"), { selected: { attachTo: [id("foe")] } });
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("fez")), "discard", "no host left: the Fez is put into its owner's discard pile");
  assert.equal(engine.state.cards[id("fez")].attachedTo, undefined);
});

clause(FEZ, "0:attach", "when the host is destroyed later, the Fez leaves play with it (to its owner's discard pile)", () => {
  const { engine, id } = fezBoard({ fez: "play", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("fez")), "discard", "attached cards leave play the same way their host does (CR 301.4)");
});

clause(FEZ, "0:attach", "when the host is put into its owner's hand, the Fez follows it to its owner's hand (CR 301.4a), not to the discard pile", () => {
  const bounce = tactic({
    name: "BounceIt",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = fezBoard({ fez: "play", extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("fez")), "hand", "the attached card leaves play the same way: put into its owner's hand");
});

clause(FEZ, "0:attach", "if the host stops being a character (flipped face-down into a resource) the Fez is flipped face-down with it", () => {
  const flip = tactic({
    name: "Flipper",
    cost: 0,
    behavior: { abilities: [{ id: "f", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = fezBoard({ fez: "play", extra: [{ key: "flip", def: flip, owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].faceDown, true, "the host is a face-down resource now");
  assert.equal(zoneOf(engine, id("fez")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("fez")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(FEZ, "0:attach", "deployed for cost 3 needs [O]: other resources are not enough", () => {
  const none = fezBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("fez"), { selected: { attachTo: [none.id("mine")] } }), "no [O]");
  const short = fezBoard({ icons: { obsession: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("fez"), { selected: { attachTo: [short.id("mine")] } }), "2 resources");
  const exact = fezBoard({ icons: { obsession: 3 } });
  deployFez(exact.engine, exact.id, exact.id("mine"));
  assert.equal(zoneOf(exact.engine, exact.id("fez")), "play");
  assert.equal(ready(exact.engine), 0);
  const one = fezBoard({ icons: { obsession: 1, greed: 2 } });
  deployFez(one.engine, one.id, one.id("mine"));
  assert.equal(zoneOf(one.engine, one.id("fez")), "play", "one [O] among three resources is enough");
});

clause(FEZ, "0:attach", "an item is deployed on its controller's own turn only", () => {
  const { engine, id } = fezBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("fez"), { selected: { attachTo: [id("foe")] } }), "the opponent's turn");
  assert.equal(zoneOf(engine, id("fez")), "hand");
});

// --- the hex -------------------------------------------------------------------------

clause(FEZ, "1:rule", "the attached character loses exactly 2 strength (life and speed are untouched)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe" });
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "5 - 2");
  assert.equal(engine.getStat(id("foe"), "life"), 5);
  assert.equal(engine.getStat(id("foe"), "speed"), 2);
});

clause(FEZ, "1:rule", "only the attached character is affected, whoever controls the Fez", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine" });
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  for (const key of ["mine2", "foe", "foe2"]) assert.equal(engine.getStat(id(key), "strength"), 5, `${key} is unaffected`);
});

clause(FEZ, "1:rule", "a host with less than 2 strength is left at 0 strength, not a negative number (CR 410.4)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "weak", extra: [{ key: "weak", def: character({ name: "Weak", strength: 1 }), owner: P2, zone: "play" }] });
  assert.equal(engine.getStat(id("weak"), "strength"), 0, "1 strength minus 2 is 0");
});

clause(FEZ, "1:rule", "a host with exactly 2 strength is left at 0", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "two", extra: [{ key: "two", def: character({ name: "Two", strength: 2 }), owner: P2, zone: "play" }] });
  assert.equal(engine.getStat(id("two"), "strength"), 0);
});

clause(FEZ, "1:rule", "two Fez on the same character stack: -4 strength", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", second: true });
  assert.equal(engine.getStat(id("mine"), "strength"), 1);
});

clause(FEZ, "1:rule", "the attached character cannot attack (an unattached one can)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2 });
  refused(() => attackWith(engine, id, "mine"), "the hexed character");
  assert.equal(engine.state.battle, undefined, "no battle started");
  attackWith(engine, id, "mine2");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("mine2")], "control: another character attacks fine");
});

clause(FEZ, "1:rule", "the hexed character cannot join a party with others either", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2 });
  refused(
    () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine"), id("mine2")], target: { type: "faction", playerId: P2 } }),
    "the hexed character in a party"
  );
  assert.equal(engine.state.battle, undefined);
});

clause(FEZ, "1:rule", "the attached character can still BLOCK (the Fez only stops attacking)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe", turn: 2 });
  declareAttackBy(engine, P1, [id("mine")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")], "the hexed character blocked");
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
});

clause(FEZ, "1:rule", "an opponent's hexed character cannot attack on their turn", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe", turn: 2, active: P2 });
  refused(
    () => engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } }),
    "the hexed opposing character"
  );
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe2")], target: { type: "faction", playerId: P1 } });
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("foe2")], "control: their other character attacks");
});

clause(FEZ, "1:rule", "the strength loss is real in a battle: a hexed 5-strength blocker deals only 3 damage", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe", turn: 2, extra: [{ key: "tank", def: character({ name: "Tank", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }] });
  fight(engine, P1, [id("tank")], { type: "faction", playerId: P2 }, [id("foe")]);
  assert.equal(engine.state.cards[id("tank")].damage, 3, "blocker with 5 - 2 = 3 strength");
});

clause(FEZ, "1:rule", "the hex ends when the Fez leaves play: strength is back and the character can attack again", () => {
  const destroyItem = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2, extra: [{ key: "smash", def: destroyItem, owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "control: hexed while the Fez is in play");
  refused(() => attackWith(engine, id, "mine"), "control: cannot attack while hexed");
  play(engine, P1, id("smash"), { selected: { t: [id("fez")] } });
  assert.equal(zoneOf(engine, id("fez")), "discard");
  assert.equal(engine.getStat(id("mine"), "strength"), 5, "no more hex");
  attackWith(engine, id, "mine");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("mine")], "it can attack again");
});

clause(FEZ, "1:rule", "the hex applies as soon as the Fez enters play, not before: while it is being deployed the host is unchanged", () => {
  const { engine, id } = fezBoard();
  playRaw(engine, P1, id("fez"), { selected: { attachTo: [id("mine")] } });
  assert.equal(zoneOf(engine, id("fez")), "deploying");
  assert.equal(engine.getStat(id("mine"), "strength"), 5, "not hexed yet");
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "hexed once it entered play");
});

// --- MOVE -----------------------------------------------------------------------------

clause(FEZ, "2:ability:move", "pays exactly 3 and re-attaches the Fez to the picked character: the new host is hexed, the old one is free", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine" });
  const before = ready(engine);
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine), 3, "Pay 3");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "the new host loses 2 strength");
  assert.equal(engine.getStat(id("mine"), "strength"), 5, "the old host is released");
  assert.equal(zoneOf(engine, id("fez")), "play");
  assert.equal(engine.state.cards[id("fez")].controllerId, P1, "I still control it");
});

clause(FEZ, "2:ability:move", "the new host can be one of my own characters", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe" });
  moveFez(engine, id, id("mine2"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine2"));
  assert.equal(engine.getStat(id("mine2"), "strength"), 3);
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(FEZ, "2:ability:move", "the old host can attack again after the Fez moves away, and the new host cannot", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2 });
  refused(() => attackWith(engine, id, "mine"), "hexed before the move");
  moveFez(engine, id, id("mine2"));
  resolvePendingResponses(engine);
  refused(() => attackWith(engine, id, "mine2"), "the new host is hexed");
  attackWith(engine, id, "mine");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("mine")], "the old host is free");
});

clause(FEZ, "2:ability:move", "does not deplete the Fez or cost anything else: it can be moved again while I have resources (6 = twice)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine" });
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].depleted, false);
  moveFez(engine, id, id("foe2"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe2"), "moved a second time");
  assert.equal(ready(engine), 0, "three resources each time");
  refused(() => moveFez(engine, id, id("mine")), "a third move is unaffordable");
});

clause(FEZ, "2:ability:move", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  for (const [what, target] of [
    ["an item", id("thing")],
    ["a location", id("place")],
    ["a faction", engine.state.players[P2].factionId!],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("mh")],
    ["a character in the opponent's hand", id("oc")]
  ] as const) {
    refused(() => moveFez(engine, id, target), what);
  }
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine"), "unchanged");
  assert.equal(ready(engine), 6, "nothing was paid");
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"), "control: a character works");
});

clause(FEZ, "2:ability:move", "a pick is required, exactly one", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine" });
  refused(() => moveFez(engine, id, undefined), "no pick");
  refused(
    () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fez"), abilityId: "move", selected: { c: [id("foe"), id("foe2")] }, variables: {} } as never),
    "two picks"
  );
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine"));
});

clause(FEZ, "2:ability:move", "is refused one resource short of Pay 3, allowed with exactly 3", () => {
  const short = fezBoard({ fez: "play", host: "mine", icons: { obsession: 2 } });
  refused(() => moveFez(short.engine, short.id, short.id("foe")), "2 resources");
  assert.equal(short.engine.state.cards[short.id("fez")].attachedTo, short.id("mine"));
  const exact = fezBoard({ fez: "play", host: "mine", icons: { obsession: 3 } });
  moveFez(exact.engine, exact.id, exact.id("foe"));
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.state.cards[exact.id("fez")].attachedTo, exact.id("foe"));
  assert.equal(ready(exact.engine), 0);
});

clause(FEZ, "2:ability:move", "has no threshold of its own: it works with 3 resources that are not [O] at all", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", icons: { greed: 3 } });
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
});

clause(FEZ, "2:ability:move", "'use this only NOT during a battle': it is refused while a battle is under way, and allowed outside one", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2, active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.ok(engine.state.battle, "a battle is under way");
  refused(() => moveFez(engine, id, id("foe2")), "during a battle");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine"), "unchanged");
  assert.equal(ready(engine), 6, "nothing was paid");
  const calm = fezBoard({ fez: "play", host: "mine", turn: 2 });
  assert.equal(calm.engine.state.battle, undefined);
  moveFez(calm.engine, calm.id, calm.id("foe"));
  resolvePendingResponses(calm.engine);
  assert.equal(calm.engine.state.cards[calm.id("fez")].attachedTo, calm.id("foe"), "control: outside a battle it works");
});

clause(FEZ, "2:ability:move", "it is refused during MY OWN battle as well (after my attack is declared)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2 });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine2")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.battle, "engine.state.battle");
  refused(() => moveFez(engine, id, id("foe")), "during my own battle");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("mine"));
});

clause(FEZ, "2:ability:move", "it can be used again once the battle is over", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2 });
  fight(engine, P1, [id("mine2")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
});

clause(FEZ, "2:ability:move", "only the Fez's controller can use MOVE (not the host's controller)", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "foe", turn: 2, active: P2, extra: res({ obsession: 6 }, P2) });
  refused(() => moveFez(engine, id, id("foe2"), P2), "the opponent controls the host, not the Fez");
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
});

clause(FEZ, "2:ability:move", "it can be used on the opponent's turn in response (outside a battle), e.g. when they play a card", () => {
  const { engine, id } = fezBoard({ fez: "play", host: "mine", turn: 2, active: P2, extra: [{ key: "oppTac", def: tactic({ name: "OppTactic", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("oppTac"));
  assert.equal(engine.state.battle, undefined);
  moveFez(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("fez")].attachedTo, id("foe"));
});

// =================================================================================
// Flagitious Denunciator
// COVERT
// DENOUNCE -- COST: Pay 2. Pick a character. Destroy this card. -- EFFECT: Put the character into
// its owner's hand. Look at your opponent's hand and choose a character in it. Your opponent
// discards that character.
// Character (wizard), cost 6, [O], 3 strength / 3 speed / 2 life.
// =================================================================================

const DENOUNCER = "cae163fe-b4bb-4dde-9227-05359c5961ac";

clause(DENOUNCER, "0:kw:COVERT", "has the COVERT keyword (an ordinary character does not)", () => covertHasKeyword(DENOUNCER));
clause(DENOUNCER, "0:kw:COVERT", "attacking alone it cannot be blocked by a non-covert character (alone or with a covert one); a covert character can block it", () =>
  covertCannotBeBlockedByNonCovert(DENOUNCER)
);
clause(DENOUNCER, "0:kw:COVERT", "a party that includes a non-covert member is not a covert party: anyone may block it", () => covertPartyNeedsEveryMemberCovert(DENOUNCER));
clause(DENOUNCER, "0:kw:COVERT", "as a would-be blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(DENOUNCER));

function denounceBoard(
  opts: {
    icons?: Icons;
    den?: "play" | "hand" | "discard";
    depleted?: boolean;
    faceDown?: boolean;
    oppHand?: "mixed" | "noCharacters" | "empty";
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const oppHand: CardPlacement[] =
    opts.oppHand === "empty"
      ? []
      : opts.oppHand === "noCharacters"
        ? [
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" }
          ]
        : [
            { key: "oc1", def: character({ name: "OppChar1" }), owner: P2, zone: "hand" },
            { key: "oc2", def: character({ name: "OppChar2" }), owner: P2, zone: "hand" },
            { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "hand" },
            { key: "ot", def: tactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
            { key: "ol", def: location({ name: "OppLoc" }), owner: P2, zone: "hand" },
            { key: "or1", def: resourceCard({ name: "RageCard", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
          ];
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "den", def: printing(DENOUNCER), owner: P1, zone: opts.den ?? "play", depleted: opts.depleted, faceDown: opts.faceDown },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...oppHand,
      ...res(opts.icons ?? { obsession: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const denounce = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId | undefined, player: PlayerId = P1) =>
  engine.perform({
    type: "activateAbility",
    playerId: player,
    cardId: id("den"),
    abilityId: "denounce",
    selected: target ? { c: [target] } : {},
    variables: {}
  } as never);

clause(DENOUNCER, "1:ability:denounce", "pays 2 and destroys itself as a cost; the picked opposing character goes to its owner's hand", () => {
  const { engine, id } = denounceBoard();
  const before = ready(engine);
  denounce(engine, id, id("foe"));
  assert.equal(before - ready(engine), 2, "Pay 2");
  assert.equal(zoneOf(engine, id("den")), "discard", "Destroy this card (as a cost, so already while responses are possible)");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "in its owner's hand");
  assert.equal(zoneOf(engine, id("foe2")), "play", "only the picked character");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(DENOUNCER, "1:ability:denounce", "the Denunciator is destroyed (into its owner's discard pile), not returned to a hand or removed", () => {
  const { engine, id } = denounceBoard();
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  drainPicking(engine, [id("oc1")]);
  assert.ok(discardOf(engine, P1).includes(id("den")), "discardOf(engine, P1).includes(id(\"den\"))");
  assert.equal(handOf(engine, P1).includes(id("den")), false);
});

clause(DENOUNCER, "1:ability:denounce", "after the bounce I look at the opponent's hand and CHOOSE a character in it; they discard exactly that character", () => {
  const { engine, id } = denounceBoard();
  const oppHandBefore = handOf(engine, P2).length;
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose (the opponent only discards)");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc2")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("oc2")), "discard", "the chosen character is discarded");
  assert.ok(discardOf(engine, P2).includes(id("oc2")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("oc1")), "hand", "the other character stays");
  assert.equal(zoneOf(engine, id("foe")), "hand", "the bounced character stays in the hand");
  assert.equal(handOf(engine, P2).length, oppHandBefore + 1 - 1, "bounced +1, discarded -1");
});

clause(DENOUNCER, "1:ability:denounce", "the effects happen in order: the character I just returned to the opponent's hand can itself be the one I choose to discard", () => {
  const { engine, id } = denounceBoard({ oppHand: "noCharacters" });
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "the bounced character is now a character in their hand, so I am asked");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard", "bounced, then discarded");
  assert.ok(discardOf(engine, P2).includes(id("foe")), "discardOf(engine, P2).includes(id(\"foe\"))");
  assert.equal(zoneOf(engine, id("oi")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "only a CHARACTER can be chosen from their hand: an item, a tactic, a location and a resource card are refused", () => {
  const { engine, id } = denounceBoard();
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  const answerWith = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  refused(answerWith(["oi"]), "an item");
  refused(answerWith(["ot"]), "a tactic");
  refused(answerWith(["ol"]), "a location");
  refused(answerWith(["or1"]), "a resource card");
  refused(answerWith(["mh"]), "a character in MY hand");
  refused(answerWith(["foe2"]), "a character in play");
  refused(answerWith([]), "I must choose one");
  refused(answerWith(["oc1", "oc2"]), "only one");
  answerWith(["oc1"])();
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oc1")), "discard", "control");
  assert.equal(zoneOf(engine, id("mh")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "I can pick one of my own characters: it goes to my hand, and the opponent still discards a character", () => {
  const { engine, id } = denounceBoard();
  denounce(engine, id, id("mine"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.ok(handOf(engine, P1).includes(id("mine")), "handOf(engine, P1).includes(id(\"mine\"))");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
});

clause(DENOUNCER, "1:ability:denounce", "a character I control but do not own goes to its OWNER's hand, where I may then choose it", () => {
  const { engine, id } = denounceBoard({
    oppHand: "noCharacters",
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]
  });
  denounce(engine, id, id("stolen"));
  resolvePendingResponses(engine);
  assert.ok(handOf(engine, P2).includes(id("stolen")), "its owner's hand");
  assert.equal(handOf(engine, P1).includes(id("stolen")), false);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("stolen")] });
  assert.equal(zoneOf(engine, id("stolen")), "discard");
});

clause(DENOUNCER, "1:ability:denounce", "it can pick the Denunciator itself: it is destroyed as a cost and the rest still happens", () => {
  const { engine, id } = denounceBoard();
  denounce(engine, id, id("den"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("den")), "discard", "destroyed as a cost; it is not then pulled into a hand (CR 402.4)");
  const pc = pending(engine);
  assert.ok(pc, "I still look at their hand and choose a character");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
  assert.equal(handOf(engine, P1).includes(id("den")), false);
});

clause(DENOUNCER, "1:ability:denounce", "when their hand holds no character even after the bounce (I picked my own), nothing is discarded and the game is not stuck", () => {
  const { engine, id } = denounceBoard({ oppHand: "noCharacters" });
  denounce(engine, id, id("mine"));
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("oi")), "hand");
  assert.equal(zoneOf(engine, id("ot")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "with an empty opponent hand and my own character picked, nothing is discarded", () => {
  const { engine, id } = denounceBoard({ oppHand: "empty" });
  denounce(engine, id, id("mine"));
  resolvePendingResponses(engine);
  settled(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(DENOUNCER, "1:ability:denounce", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = denounceBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  for (const [what, target] of [
    ["an item", id("thing")],
    ["a location", id("place")],
    ["a faction", engine.state.players[P2].factionId!],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("mh")],
    ["a character in their hand", id("oc1")]
  ] as const) {
    refused(() => denounce(engine, id, target), what);
  }
  assert.equal(zoneOf(engine, id("den")), "play", "the Denunciator was not destroyed by the refused attempts");
  assert.equal(ready(engine), 6, "nothing was paid");
  denounce(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("den")), "discard", "control: a character works");
});

clause(DENOUNCER, "1:ability:denounce", "a pick is required, exactly one", () => {
  const { engine, id } = denounceBoard();
  refused(() => denounce(engine, id, undefined), "no pick");
  refused(
    () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("den"), abilityId: "denounce", selected: { c: [id("foe"), id("foe2")] }, variables: {} } as never),
    "two picks"
  );
  assert.equal(zoneOf(engine, id("den")), "play");
  assert.equal(ready(engine), 6);
});

clause(DENOUNCER, "1:ability:denounce", "is refused one resource short of Pay 2, allowed with exactly 2; no threshold is required", () => {
  const short = denounceBoard({ icons: { obsession: 1 } });
  refused(() => denounce(short.engine, short.id, short.id("foe")), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("den")), "play", "not destroyed");
  const exact = denounceBoard({ icons: { greed: 2 } });
  denounce(exact.engine, exact.id, exact.id("foe"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand", "two non-[O] resources are enough");
  assert.equal(ready(exact.engine), 0);
});

clause(DENOUNCER, "1:ability:denounce", "does not need to be ready: a depleted Denunciator can still DENOUNCE (the cost is destroying it, not depleting it)", () => {
  const { engine, id } = denounceBoard({ depleted: true });
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("den")), "discard");
});

clause(DENOUNCER, "1:ability:denounce", "can only be used from play: in the hand or the discard pile it is refused", () => {
  for (const den of ["hand", "discard"] as const) {
    const { engine, id } = denounceBoard({ den });
    refused(() => denounce(engine, id, id("foe")), `Denunciator in ${den}`);
    assert.equal(zoneOf(engine, id("foe")), "play");
    assert.equal(ready(engine), 6);
  }
});

clause(DENOUNCER, "1:ability:denounce", "a face-down Denunciator is only a resource: it has no abilities", () => {
  const { engine, id } = denounceBoard({ faceDown: true });
  refused(() => denounce(engine, id, id("foe")), "face-down cards have no rules text (CR 411.1)");
});

clause(DENOUNCER, "1:ability:denounce", "only its controller can use it", () => {
  const { engine, id } = denounceBoard({ turn: 2, active: P2, extra: res({ obsession: 4 }, P2) });
  refused(() => denounce(engine, id, id("foe"), P2), "the opponent cannot use my Denunciator");
  assert.equal(zoneOf(engine, id("den")), "play");
});

clause(DENOUNCER, "1:ability:denounce", "as an ability it can be used in response on the opponent's turn, e.g. to send their attacker home", () => {
  const { engine, id } = denounceBoard({ turn: 2, active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc1")] });
  assert.equal(zoneOf(engine, id("oc1")), "discard");
  assert.equal(zoneOf(engine, id("den")), "discard");
});

clause(DENOUNCER, "1:ability:denounce", "can be used the turn it enters play (abilities have no summoning sickness, CR 204.3a)", () => {
  const { engine, id } = denounceBoard({ den: "hand", icons: { obsession: 8 } });
  play(engine, P1, id("den"));
  assert.equal(zoneOf(engine, id("den")), "play");
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "an item attached to the returned character follows it to its owner's hand (CR 301.4a), it is not destroyed", () => {
  const gear = item({
    name: "Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });
  const { engine, id } = denounceBoard({ extra: [{ key: "gear", def: gear, owner: P2, zone: "play", attachedToKey: "foe" }] });
  denounce(engine, id, id("foe"));
  resolvePendingResponses(engine);
  drainPicking(engine, [id("oc1")]);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("gear")), "hand", "attached cards leave play the same way the host does: into its owner's hand");
});

clause(DENOUNCER, "1:ability:denounce", "if the picked character is destroyed in response, it stays in the discard pile and is not pulled into a hand (CR 402.4)", () => {
  const { engine, id } = denounceBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  denounce(engine, id, id("foe"));
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  drainPicking(engine, [id("oc1")]);
  assert.equal(zoneOf(engine, id("foe")), "discard", "destroyed in response: it is not in play, so it cannot be put into a hand");
});

clause(DENOUNCER, "1:ability:denounce", "deploys for exactly 6 and needs [O]; enters play with its printed 3 strength / 3 speed / 2 life", () => {
  const { engine, id } = denounceBoard({ den: "hand", icons: { obsession: 6 } });
  const before = ready(engine);
  play(engine, P1, id("den"));
  assert.equal(before - ready(engine), 6, "the printed cost of 6");
  assert.equal(engine.getStat(id("den"), "strength"), 3);
  assert.equal(engine.getStat(id("den"), "speed"), 3);
  assert.equal(engine.getStat(id("den"), "life"), 2);
  const short = denounceBoard({ den: "hand", icons: { obsession: 5 } });
  refused(() => playRaw(short.engine, P1, short.id("den")), "5 resources");
  const noO = denounceBoard({ den: "hand", icons: { greed: 8 } });
  refused(() => playRaw(noO.engine, P1, noO.id("den")), "no [O]");
});

// =================================================================================
// Forbidden Knowledge
// You may look at your opponent's hand, the top card of their deck, and their face-down
// resources. Draw a card.
// FLIP UP: 0 [O][O]
// Tactic, cost 2, [O][O].
// (The "look" is information only: the engine has perfect information, RULES.md 12, so what is
// observable is that nothing of theirs moves or turns face-up, and the draw.)
// =================================================================================

const KNOWLEDGE = "40a1b99a-a5b6-4356-b84c-3cc41a5e6db2";

function knowledgeBoard(
  opts: { icons?: Icons; fk?: "hand" | "faceDown"; deck?: number; oppIcons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const fk = opts.fk ?? "hand";
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fk", def: printing(KNOWLEDGE), owner: P1, zone: fk === "hand" ? "hand" : "play", faceDown: fk === "faceDown" ? true : undefined },
      ...cards("d", opts.deck ?? 4, P1, "deck"),
      ...cards("h", 2, P1, "hand"),
      ...cards("oh", 3, P2, "hand"),
      ...cards("od", 3, P2, "deck"),
      { key: "oppFd", def: character({ name: "OppHiddenCard" }), owner: P2, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { obsession: 4 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(KNOWLEDGE, "0:rule", "pays exactly 2 and draws exactly one card for me: the top card of my deck", () => {
  const { engine, id } = knowledgeBoard();
  const top = deckOf(engine, P1)[0];
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("fk"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand, one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the drawn card is the top of the deck");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(zoneOf(engine, id("fk")), "discard", "the tactic ends in its owner's discard pile");
});

clause(KNOWLEDGE, "0:rule", "it needs no pick and no choice: it resolves with nothing pending", () => {
  const { engine, id } = knowledgeBoard();
  play(engine, P1, id("fk"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined);
});

clause(KNOWLEDGE, "0:rule", "only I draw: the opponent's hand, deck and discard pile are untouched", () => {
  const { engine, id } = knowledgeBoard();
  const oppHand = [...handOf(engine, P2)];
  const oppDeck = [...deckOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  play(engine, P1, id("fk"));
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(KNOWLEDGE, "0:rule", "looking at the opponent's face-down resource does not turn it face-up or move it", () => {
  const { engine, id } = knowledgeBoard();
  play(engine, P1, id("fk"));
  assert.equal(engine.state.cards[id("oppFd")].faceDown, true, "still face-down");
  assert.equal(zoneOf(engine, id("oppFd")), "play");
  assert.equal(engine.state.cards[id("oppFd")].controllerId, P2);
});

clause(KNOWLEDGE, "0:rule", "draws exactly one card whatever the size of either hand or deck: with a 1-card deck it takes that card", () => {
  const { engine, id } = knowledgeBoard({ deck: 1 });
  play(engine, P1, id("fk"));
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(KNOWLEDGE, "0:rule", "with an empty deck I simply fail to draw (CR 306.2) and do not lose", () => {
  const { engine, id } = knowledgeBoard({ deck: 0 });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("fk"));
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(engine.state.winner, undefined);
  assert.equal(zoneOf(engine, id("fk")), "discard");
});

clause(KNOWLEDGE, "0:rule", "is refused one resource short of its cost of 2, allowed with exactly 2", () => {
  const short = knowledgeBoard({ icons: { obsession: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("fk")), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("fk")), "hand");
  const exact = knowledgeBoard({ icons: { obsession: 2 } });
  play(exact.engine, P1, exact.id("fk"));
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("d0")), "hand");
});

clause(KNOWLEDGE, "0:rule", "needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = knowledgeBoard({ icons: { obsession: 1, greed: 5 } });
  refused(() => playRaw(one.engine, P1, one.id("fk")), "one [O]");
  const none = knowledgeBoard({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("fk")), "no [O]");
  const theirs = knowledgeBoard({ icons: { greed: 4 }, oppIcons: { obsession: 4 } });
  refused(() => playRaw(theirs.engine, P1, theirs.id("fk")), "the opponent's [O] do not count");
  const two = knowledgeBoard({ icons: { obsession: 2, greed: 2 } });
  play(two.engine, P1, two.id("fk"));
  assert.equal(zoneOf(two.engine, two.id("d0")), "hand", "two [O] is enough");
});

clause(KNOWLEDGE, "0:rule", "can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = knowledgeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("fk")), "no window yet");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("fk"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(zoneOf(engine, id("fk")), "discard");
});

// --- FLIP UP ----------------------------------------------------------------------

const flipKnowledge = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, player: PlayerId = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId: id("fk"), selected: {}, variables: {} });

clause(KNOWLEDGE, "1:flipUp", "flipping it up draws a card and the tactic ends in my discard pile", () => {
  const { engine, id } = knowledgeBoard({ fk: "faceDown", icons: { obsession: 2 } });
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  flipKnowledge(engine, id);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top), "hand", "the top card was drawn");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card");
  assert.equal(zoneOf(engine, id("fk")), "discard");
  assert.equal(engine.state.cards[id("fk")].faceDown, false);
});

clause(KNOWLEDGE, "1:flipUp", "FLIP UP costs 0: no resource is spent (the card only stops being a resource itself)", () => {
  const { engine, id } = knowledgeBoard({ fk: "faceDown", icons: { obsession: 3 } });
  assert.equal(ready(engine), 4, "three Obsession plus the face-down card");
  flipKnowledge(engine, id);
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 3, "all three Obsession are still ready; only the card itself left the pool");
});

clause(KNOWLEDGE, "1:flipUp", "FLIP UP needs [O][O]: one [O] among many other resources is refused (the card stays face-down), two are accepted", () => {
  const one = knowledgeBoard({ fk: "faceDown", icons: { obsession: 1, greed: 6 } });
  refused(() => flipKnowledge(one.engine, one.id), "one [O]");
  assert.equal(one.engine.state.cards[one.id("fk")].faceDown, true);
  assert.equal(zoneOf(one.engine, one.id("d0")), "deck", "nothing was drawn");
  const none = knowledgeBoard({ fk: "faceDown", icons: { greed: 6 } });
  refused(() => flipKnowledge(none.engine, none.id), "no [O]");
  const two = knowledgeBoard({ fk: "faceDown", icons: { obsession: 2 } });
  flipKnowledge(two.engine, two.id);
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("d0")), "hand");
});

clause(KNOWLEDGE, "1:flipUp", "the card's own Volition is not [O], and the opponent's [O] do not count", () => {
  const onlyFaceDown = knowledgeBoard({ fk: "faceDown", icons: {} });
  refused(() => flipKnowledge(onlyFaceDown.engine, onlyFaceDown.id), "only the face-down card itself");
  const theirs = knowledgeBoard({ fk: "faceDown", icons: { greed: 3 }, oppIcons: { obsession: 4 } });
  refused(() => flipKnowledge(theirs.engine, theirs.id), "the opponent has [O], I do not");
  assert.equal(theirs.engine.state.cards[theirs.id("fk")].faceDown, true);
});

clause(KNOWLEDGE, "1:flipUp", "it can only be flipped by its controller, and not from the hand", () => {
  const theirs = knowledgeBoard({ fk: "faceDown", icons: { obsession: 2 }, oppIcons: { obsession: 2 } });
  refused(() => flipKnowledge(theirs.engine, theirs.id, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("fk")].faceDown, true);
  const inHand = knowledgeBoard({ fk: "hand", icons: { obsession: 2 } });
  refused(() => flipKnowledge(inHand.engine, inHand.id), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("fk")), "hand");
});

clause(KNOWLEDGE, "1:flipUp", "FLIP UP does not change when a tactic can be played: not outside a window on the opponent's turn, yes in response", () => {
  const { engine, id } = knowledgeBoard({
    fk: "faceDown",
    icons: { obsession: 2 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  refused(() => flipKnowledge(engine, id), "nothing to respond to yet");
  assert.equal(engine.state.cards[id("fk")].faceDown, true);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  flipKnowledge(engine, id);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("d0")), "hand", "drew in response to the attack");
});

clause(KNOWLEDGE, "1:flipUp", "a face-down Forbidden Knowledge is a resource until flipped: it is in my pool and provides Volition", () => {
  const { engine, id } = knowledgeBoard({ fk: "faceDown", icons: { obsession: 2 } });
  assert.equal(engine.isResource(id("fk")), true);
  assert.equal(ready(engine), 3);
  assert.equal(engine.getThresholds(P1).volition ?? 0, 1);
});

clause(KNOWLEDGE, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const { engine, id } = knowledgeBoard({
    fk: "faceDown",
    icons: { obsession: 2 },
    extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }]
  });
  const top = deckOf(engine, P1)[0];
  holdFlipUp(() => flipKnowledge(engine, id));
  assert.ok(engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, top), "deck", "the effect has not happened yet");
  respondWith(engine, P2, id("counter"), { dep: [id("fk")] });
  assert.equal(zoneOf(engine, top), "deck", "terminated in response: I did not draw");
  assert.equal(zoneOf(engine, id("fk")), "discard", "a terminated card goes to its owner's discard pile (CR 314.1)");
});

// =================================================================================
// Foul Diviner
// COST: Remove a tactic in your discard pile from the game.
// Character (wizard), cost 4, [O], 3 strength / 3 speed / 4 life.
// =================================================================================

const DIVINER = "37df361e-ae24-4f59-9094-c638ffcec0e3";

function diviner(
  opts: { icons?: Icons; discardTactics?: number; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fdv", def: printing(DIVINER), owner: P1, zone: "hand" },
      ...tactics("dt", opts.discardTactics ?? 2, P1, "discard"),
      { key: "dc", def: character({ name: "DiscardChar" }), owner: P1, zone: "discard" },
      { key: "di", def: item({ name: "DiscardItem" }), owner: P1, zone: "discard" },
      ...tactics("odt", 2, P2, "discard"),
      { key: "ht", def: tactic({ name: "HandTactic" }), owner: P1, zone: "hand" },
      { key: "dkt", def: tactic({ name: "DeckTactic" }), owner: P1, zone: "deck" },
      { key: "pt", def: tactic({ name: "OppHandTactic" }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 5 }),
      ...(opts.extra ?? [])
    ]
  });
}

const deployDiviner = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, exile: CardInstanceId[]) =>
  play(engine, P1, id("fdv"), { selected: { exile } });

clause(DIVINER, "0:ability", "deploys for exactly 4, removing the chosen tactic in my discard pile from the game; the Diviner enters play with its printed 3 strength / 3 speed / 4 life", () => {
  const { engine, id } = diviner();
  const before = ready(engine);
  deployDiviner(engine, id, [id("dt0")]);
  assert.equal(before - ready(engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(engine, id("fdv")), "play");
  assert.equal(zoneOf(engine, id("dt0")), "removed", "the tactic is out of the game");
  assert.equal(zoneOf(engine, id("dt1")), "discard", "the other tactic in my discard pile stays");
  assert.equal(engine.getStat(id("fdv"), "strength"), 3);
  assert.equal(engine.getStat(id("fdv"), "speed"), 3);
  assert.equal(engine.getStat(id("fdv"), "life"), 4);
});

for (const key of ["dt0", "dt1"]) {
  clause(DIVINER, "0:ability", `either tactic in my discard pile can be removed (${key}), and only that one`, () => {
    const { engine, id } = diviner();
    deployDiviner(engine, id, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "removed");
    assert.equal(zoneOf(engine, id(key === "dt0" ? "dt1" : "dt0")), "discard");
  });
}

clause(DIVINER, "0:ability", "removed means out of the game, not the void or a hand: it is in no player's zones any more", () => {
  const { engine, id } = diviner();
  deployDiviner(engine, id, [id("dt0")]);
  assert.equal(discardOf(engine, P1).includes(id("dt0")), false);
  assert.equal(handOf(engine, P1).includes(id("dt0")), false);
  assert.equal(deckOf(engine, P1).includes(id("dt0")), false);
  assert.equal(zoneOf(engine, id("dt0")), "removed");
});

clause(DIVINER, "0:ability", "the removal is a COST: the tactic is already out of the game while the Diviner waits for responses", () => {
  const { engine, id } = diviner();
  playRaw(engine, P1, id("fdv"), { selected: { exile: [id("dt0")] } });
  assert.equal(zoneOf(engine, id("fdv")), "deploying");
  assert.equal(zoneOf(engine, id("dt0")), "removed", "already removed from the game");
});

clause(DIVINER, "0:ability", "if the Diviner is terminated the cost stays paid: the tactic is still removed and the Diviner goes to the discard pile", () => {
  const { engine, id } = diviner({ extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("fdv"), { selected: { exile: [id("dt0")] } });
  respondWith(engine, P2, id("counter"), { dep: [id("fdv")] });
  assert.equal(zoneOf(engine, id("fdv")), "discard");
  assert.equal(zoneOf(engine, id("dt0")), "removed", "the removal was a cost, it is not undone");
});

clause(DIVINER, "0:ability", "a tactic is REQUIRED: with no tactic in my discard pile (only a character and an item there) it cannot be deployed", () => {
  const { engine, id } = diviner({ discardTactics: 0 });
  refused(() => playRaw(engine, P1, id("fdv"), { selected: { exile: [] } }), "no tactic chosen");
  refused(() => playRaw(engine, P1, id("fdv"), { selected: {} }), "nothing declared");
  refused(() => playRaw(engine, P1, id("fdv"), { selected: { exile: [id("dc")] } }), "a character in my discard pile");
  refused(() => playRaw(engine, P1, id("fdv"), { selected: { exile: [id("di")] } }), "an item in my discard pile");
  assert.equal(zoneOf(engine, id("fdv")), "hand");
  assert.equal(ready(engine), 5, "nothing was paid");
  assert.equal(zoneOf(engine, id("dc")), "discard");
});

clause(DIVINER, "0:ability", "only a TACTIC can be removed, and only from MY discard pile: other types, the opponent's discard pile, my hand, deck and cards in play are refused", () => {
  const { engine, id } = diviner();
  const attempt = (card: CardInstanceId) => () => playRaw(engine, P1, id("fdv"), { selected: { exile: [card] } });
  refused(attempt(id("dc")), "a character in my discard pile");
  refused(attempt(id("di")), "an item in my discard pile");
  refused(attempt(id("odt0")), "a tactic in the opponent's discard pile");
  refused(attempt(id("ht")), "a tactic in my hand");
  refused(attempt(id("dkt")), "a tactic in my deck");
  refused(attempt(id("pt")), "a tactic in the opponent's hand");
  assert.equal(zoneOf(engine, id("fdv")), "hand", "nothing was played");
  assert.equal(zoneOf(engine, id("odt0")), "discard", "the opponent's tactic was not touched");
  attempt(id("dt1"))();
  assert.ok(engine.state.responseWindow, "control: a tactic in my discard pile is accepted");
});

clause(DIVINER, "0:ability", "exactly one tactic: two are refused", () => {
  const { engine, id } = diviner();
  refused(() => playRaw(engine, P1, id("fdv"), { selected: { exile: [id("dt0"), id("dt1")] } }), "two tactics");
  assert.equal(zoneOf(engine, id("dt0")), "discard");
  assert.equal(zoneOf(engine, id("dt1")), "discard");
});

clause(DIVINER, "0:ability", "a tactic that I just played this turn is in my discard pile and can be the cost", () => {
  const { engine, id } = diviner({
    discardTactics: 0,
    icons: { obsession: 6 },
    extra: [{ key: "fresh", def: tactic({ name: "Fresh", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("fresh"));
  assert.equal(zoneOf(engine, id("fresh")), "discard");
  deployDiviner(engine, id, [id("fresh")]);
  assert.equal(zoneOf(engine, id("fresh")), "removed");
  assert.equal(zoneOf(engine, id("fdv")), "play");
});

clause(DIVINER, "0:ability", "the cost applies only when it is DEPLOYED: put into play by another effect it needs and removes nothing", () => {
  const putter = tactic({
    name: "Putter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = diviner({ discardTactics: 0, extra: [{ key: "putter", def: putter, owner: P1, zone: "hand" }] });
  play(engine, P1, id("putter"), { selected: { t: [id("fdv")] } });
  assert.equal(zoneOf(engine, id("fdv")), "play", "put into play with no tactic in the discard pile at all");
  assert.equal(zoneOf(engine, id("odt0")), "discard");
});

clause(DIVINER, "0:ability", "is refused one resource short of its cost of 4, allowed with exactly 4", () => {
  const short = diviner({ icons: { obsession: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("fdv"), { selected: { exile: [short.id("dt0")] } }), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("dt0")), "discard", "the tactic was not removed by the refused attempt");
  const exact = diviner({ icons: { obsession: 4 } });
  deployDiviner(exact.engine, exact.id, [exact.id("dt0")]);
  assert.equal(zoneOf(exact.engine, exact.id("fdv")), "play");
  assert.equal(ready(exact.engine), 0);
});

clause(DIVINER, "0:ability", "needs [O]: other resources alone are not enough, one [O] among them is", () => {
  const none = diviner({ icons: { greed: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("fdv"), { selected: { exile: [none.id("dt0")] } }), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("dt0")), "discard");
  const one = diviner({ icons: { greed: 4, obsession: 1 } });
  deployDiviner(one.engine, one.id, [one.id("dt0")]);
  assert.equal(zoneOf(one.engine, one.id("fdv")), "play");
});

clause(DIVINER, "0:ability", "is a character: it can only be deployed on its controller's own turn", () => {
  const { engine, id } = diviner({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("fdv"), { selected: { exile: [id("dt0")] } }), "the opponent's turn");
  assert.equal(zoneOf(engine, id("dt0")), "discard");
});

// =================================================================================
// High-Priest of Thabbash
// UNIQUE GLOAMSPIKE
// NEGATE -- COST: Pay 2. Deplete this card. Discard a card. Pick a card being played of the same
// type as the discarded card. -- EFFECT: Terminate the card being played.
// Character (gloamspike, priest), cost 4, [O][O][O], 3 strength / 3 speed / 3 life.
// =================================================================================

const PRIEST = "c6f8eb7b-7bdb-46fd-b971-ec3846491423";

// --- UNIQUE -----------------------------------------------------------------------

clause(PRIEST, "0:unique", "deploying a second High-Priest while I control one forces me to choose which to keep (keep the new one: the old is destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "hp2", def: printing(PRIEST), owner: P1, zone: "hand" },
      ...res({ obsession: 4 })
    ]
  });
  play(engine, P1, id("hp2"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("hp"), id("hp2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("hp2") });
  assert.equal(zoneOf(engine, id("hp2")), "play");
  assert.equal(zoneOf(engine, id("hp")), "discard");
});

clause(PRIEST, "0:unique", "keeping the old High-Priest destroys the new one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "hp2", def: printing(PRIEST), owner: P1, zone: "hand" },
      ...res({ obsession: 4 })
    ]
  });
  play(engine, P1, id("hp2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("hp") });
  assert.equal(zoneOf(engine, id("hp")), "play");
  assert.equal(zoneOf(engine, id("hp2")), "discard");
});

clause(PRIEST, "0:unique", "UNIQUE only concerns my own cards: the opponent may have their own High-Priest with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "oppHp", def: printing(PRIEST), owner: P2, zone: "play" }
    ]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hp")), "play");
  assert.equal(zoneOf(engine, id("oppHp")), "play");
});

clause(PRIEST, "0:unique", "the designation GLOAMSPIKE is what counts, not the name: another character with the same designation conflicts, one with a different designation does not", () => {
  const sameDesignation = character({ name: "Some Other Gloamspike", unique: "gloamspike" });
  const otherDesignation = character({ name: "Another Unique", unique: "somethingelse" });
  const conflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "same", def: sameDesignation, owner: P1, zone: "hand" }
    ]
  });
  play(conflict.engine, P1, conflict.id("same"));
  assert.equal(pending(conflict.engine)?.kind, "uniqueSurvivor");
  const noConflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "diff", def: otherDesignation, owner: P1, zone: "hand" }
    ]
  });
  play(noConflict.engine, P1, noConflict.id("diff"));
  assert.equal(noConflict.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(noConflict.engine, noConflict.id("hp")), "play");
  assert.equal(zoneOf(noConflict.engine, noConflict.id("diff")), "play");
});

clause(PRIEST, "0:unique", "deploys for exactly 4 and needs [O][O][O]; enters play with its printed 3 strength / 3 speed / 3 life", () => {
  const mk = (icons: Icons) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "hp", def: printing(PRIEST), owner: P1, zone: "hand" }, ...res(icons)]
    });
  const ok = mk({ obsession: 3, greed: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("hp"));
  assert.equal(before - ready(ok.engine), 4, "the printed cost of 4");
  assert.equal(ok.engine.getStat(ok.id("hp"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("hp"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("hp"), "life"), 3);
  const two = mk({ obsession: 2, greed: 5 });
  refused(() => playRaw(two.engine, P1, two.id("hp")), "two [O]");
  const short = mk({ obsession: 3 });
  refused(() => playRaw(short.engine, P1, short.id("hp")), "3 resources");
});

// --- NEGATE ------------------------------------------------------------------------

type CardTypeName = "tactic" | "character" | "item" | "location";

/** A free, harmless card of `type` for P2 to play (and for P1 to discard). */
const sample = (type: CardTypeName, name: string): CardDefinition =>
  type === "tactic" ? tactic({ name, cost: 0 }) : type === "character" ? character({ name, cost: 0 }) : type === "item" ? item({ name, cost: 0 }) : location({ name, cost: 0 });

function priestBoard(
  opts: { icons?: Icons; handTypes?: CardTypeName[]; hp?: "play" | "hand" | "discard"; depleted?: boolean; faceDown?: boolean; oppPlays?: CardTypeName; extra?: CardPlacement[]; oppTurn?: boolean } = {}
) {
  const handTypes = opts.handTypes ?? ["tactic", "character", "item", "location"];
  const oppPlays = opts.oppPlays ?? "tactic";
  const oppTurn = opts.oppTurn !== false;
  return buildGame({
    turn: oppTurn ? 2 : 1,
    activePlayerId: oppTurn ? P2 : P1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PRIEST), owner: P1, zone: opts.hp ?? "play", depleted: opts.depleted, faceDown: opts.faceDown },
      ...handTypes.map((type) => ({ key: `h_${type}`, def: sample(type, `Hand ${type}`), owner: P1, zone: "hand" as const })),
      { key: "oppCard", def: sample(oppPlays, "OppPlayed"), owner: P2, zone: "hand" },
      { key: "oppCard2", def: sample(oppPlays, "OppPlayed2"), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

const negate = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, disc: CardInstanceId | undefined, dep: CardInstanceId | undefined, player: PlayerId = P1) =>
  engine.perform({
    type: "activateAbility",
    playerId: player,
    cardId: id("hp"),
    abilityId: "negate",
    selected: { ...(disc ? { disc: [disc] } : {}), ...(dep ? { dep: [dep] } : {}) },
    variables: {}
  } as never);

const types: CardTypeName[] = ["tactic", "character", "item", "location"];

for (const type of types) {
  clause(PRIEST, "1:ability:negate", `discarding a ${type} to terminate a ${type} the opponent is playing: costs paid (pay 2, deplete, discard) and the ${type} is terminated into its owner's discard pile`, () => {
    const { engine, id } = priestBoard({ oppPlays: type });
    const before = ready(engine);
    playRaw(engine, P2, id("oppCard"));
    assert.equal(zoneOf(engine, id("oppCard")), "deploying", "the opponent's card is being played");
    negate(engine, id, id(`h_${type}`), id("oppCard"));
    assert.equal(before - ready(engine), 2, "Pay 2");
    assert.equal(engine.state.cards[id("hp")].depleted, true, "Deplete this card");
    assert.equal(zoneOf(engine, id(`h_${type}`)), "discard", "Discard a card");
    assert.ok(discardOf(engine, P1).includes(id(`h_${type}`)), "into my discard pile");
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("oppCard")), "discard", "terminated: the card goes to its owner's discard pile (CR 314.1)");
    assert.ok(discardOf(engine, P2).includes(id("oppCard")), "discardOf(engine, P2).includes(id(\"oppCard\"))");
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

for (const discarded of types) {
  for (const played of types) {
    if (discarded === played) continue;
    clause(PRIEST, "1:ability:negate", `discarding a ${discarded} cannot terminate a ${played} being played (different type): refused, nothing paid`, () => {
      const { engine, id } = priestBoard({ oppPlays: played });
      const before = ready(engine);
      playRaw(engine, P2, id("oppCard"));
      refused(() => negate(engine, id, id(`h_${discarded}`), id("oppCard")), "types differ");
      assert.equal(zoneOf(engine, id("oppCard")), "deploying", "the card is still being played");
      assert.equal(zoneOf(engine, id(`h_${discarded}`)), "hand", "nothing was discarded");
      assert.equal(engine.state.cards[id("hp")].depleted, false, "not depleted");
      assert.equal(ready(engine), before, "nothing was paid");
    });
  }
}

clause(PRIEST, "1:ability:negate", "the opponent's card is TERMINATED, so its effect does not happen (a kill tactic aimed at my character does nothing)", () => {
  const { engine, id } = priestBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("mine")] } });
  negate(engine, id, id("h_tactic"), id("kill"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("kill")), "discard");
  assert.equal(zoneOf(engine, id("mine")), "play", "my character was not destroyed");
});

clause(PRIEST, "1:ability:negate", "a character that is terminated while being deployed never enters play: its enters-play trigger does not fire", () => {
  const etbChar = character({
    name: "TriggerHappy",
    cost: 0,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 9 }] }] }
  });
  const { engine, id } = priestBoard({ extra: [{ key: "happy", def: etbChar, owner: P2, zone: "hand" }] });
  const influence = engine.state.players[P2].influence;
  playRaw(engine, P2, id("happy"));
  negate(engine, id, id("h_character"), id("happy"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("happy")), "discard");
  assert.equal(engine.state.players[P2].influence, influence, "it never entered play");
});

clause(PRIEST, "1:ability:negate", "the costs of the terminated card stay paid (CR 314.1: it is only stopped before it resolves)", () => {
  const { engine, id } = priestBoard({ extra: [{ key: "pricey", def: tactic({ name: "Pricey", cost: 2 }), owner: P2, zone: "hand" }, ...res({ greed: 3 }, P2)] });
  const oppReady = ready(engine, P2);
  playRaw(engine, P2, id("pricey"));
  assert.equal(oppReady - ready(engine, P2), 2, "the opponent paid for it");
  negate(engine, id, id("h_tactic"), id("pricey"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pricey")), "discard");
  assert.equal(oppReady - ready(engine, P2), 2, "and the payment is not refunded");
});

clause(PRIEST, "1:ability:negate", "'a card being played': a card that is not being played (in play, in a hand, in a discard pile) cannot be picked", () => {
  const { engine, id } = priestBoard();
  playRaw(engine, P2, id("oppCard"));
  refused(() => negate(engine, id, id("h_tactic"), id("foe")), "a character in play");
  refused(() => negate(engine, id, id("h_tactic"), id("oppCard2")), "a tactic in the opponent's hand");
  refused(() => negate(engine, id, id("h_tactic"), id("h_item")), "a card in my hand");
  refused(() => negate(engine, id, id("h_tactic"), undefined), "no pick");
  assert.equal(zoneOf(engine, id("oppCard")), "deploying");
  assert.equal(engine.state.cards[id("hp")].depleted, false);
  negate(engine, id, id("h_tactic"), id("oppCard"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oppCard")), "discard", "control: the card being played can be picked");
});

clause(PRIEST, "1:ability:negate", "with nothing being played there is nothing to pick: on my own turn with an empty stack it cannot be used", () => {
  const { engine, id } = priestBoard({ oppTurn: false });
  refused(() => negate(engine, id, id("h_tactic"), id("foe")), "nothing is being played");
  assert.equal(engine.state.cards[id("hp")].depleted, false);
  assert.equal(zoneOf(engine, id("h_tactic")), "hand");
});

clause(PRIEST, "1:ability:negate", "a card must be discarded from MY hand, exactly one: none, the opponent's hand card and a card in play are refused", () => {
  const { engine, id } = priestBoard();
  playRaw(engine, P2, id("oppCard"));
  refused(() => negate(engine, id, undefined, id("oppCard")), "no discard chosen");
  refused(() => negate(engine, id, id("oppCard2"), id("oppCard")), "a card in the opponent's hand");
  refused(() => negate(engine, id, id("mine"), id("oppCard")), "a character in play");
  refused(
    () =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("hp"), abilityId: "negate", selected: { disc: [id("h_tactic"), id("h_item")], dep: [id("oppCard")] }, variables: {} } as never),
    "two discards"
  );
  assert.equal(zoneOf(engine, id("h_tactic")), "hand");
  assert.equal(zoneOf(engine, id("oppCard")), "deploying");
  negate(engine, id, id("h_tactic"), id("oppCard"));
  assert.equal(zoneOf(engine, id("h_tactic")), "discard", "control: one card from my hand");
});

clause(PRIEST, "1:ability:negate", "with an empty hand it cannot be used (there is nothing to discard)", () => {
  const { engine, id } = priestBoard({ handTypes: [] });
  playRaw(engine, P2, id("oppCard"));
  refused(() => negate(engine, id, undefined, id("oppCard")), "no card to discard");
  assert.equal(zoneOf(engine, id("oppCard")), "deploying");
  assert.equal(engine.state.cards[id("hp")].depleted, false);
});

clause(PRIEST, "1:ability:negate", "is refused one resource short of Pay 2, allowed with exactly 2; no threshold is required", () => {
  const short = priestBoard({ icons: { obsession: 1 } });
  playRaw(short.engine, P2, short.id("oppCard"));
  refused(() => negate(short.engine, short.id, short.id("h_tactic"), short.id("oppCard")), "1 resource");
  assert.equal(short.engine.state.cards[short.id("hp")].depleted, false);
  assert.equal(zoneOf(short.engine, short.id("h_tactic")), "hand", "nothing discarded by the refused attempt");
  const exact = priestBoard({ icons: { greed: 2 } });
  playRaw(exact.engine, P2, exact.id("oppCard"));
  negate(exact.engine, exact.id, exact.id("h_tactic"), exact.id("oppCard"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("oppCard")), "discard", "two non-[O] resources are enough");
  assert.equal(ready(exact.engine), 0);
});

clause(PRIEST, "1:ability:negate", "needs the High-Priest to be ready: a depleted one cannot NEGATE, and it is depleted by using it", () => {
  const depleted = priestBoard({ depleted: true });
  playRaw(depleted.engine, P2, depleted.id("oppCard"));
  refused(() => negate(depleted.engine, depleted.id, depleted.id("h_tactic"), depleted.id("oppCard")), "already depleted");
  assert.equal(zoneOf(depleted.engine, depleted.id("h_tactic")), "hand");
  const { engine, id } = priestBoard();
  playRaw(engine, P2, id("oppCard"));
  negate(engine, id, id("h_tactic"), id("oppCard"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("hp")].depleted, true);
  playRaw(engine, P2, id("oppCard2"));
  refused(() => negate(engine, id, id("h_character"), id("oppCard2")), "depleted by the first use");
  assert.equal(zoneOf(engine, id("oppCard2")), "deploying", "the second card is not terminated");
});

clause(PRIEST, "1:ability:negate", "only its controller can use it, and it works from play only", () => {
  const { engine, id } = priestBoard({ oppTurn: false, extra: [...res({ obsession: 4 }, P2), { key: "p2t", def: tactic({ name: "P2Tactic", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("h_tactic"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority, so a refusal is not about priority");
  refused(() => negate(engine, id, id("p2t"), id("h_tactic"), P2), "the opponent cannot use my High-Priest");
  assert.equal(zoneOf(engine, id("h_tactic")), "deploying", "my tactic is not terminated");
  assert.equal(zoneOf(engine, id("p2t")), "hand", "nothing was discarded");
  for (const hp of ["hand", "discard"] as const) {
    const b = priestBoard({ hp });
    playRaw(b.engine, P2, b.id("oppCard"));
    refused(() => negate(b.engine, b.id, b.id("h_tactic"), b.id("oppCard")), `High-Priest in ${hp}`);
  }
});

clause(PRIEST, "1:ability:negate", "a face-down High-Priest is only a resource: it has no abilities", () => {
  const { engine, id } = priestBoard({ faceDown: true });
  playRaw(engine, P2, id("oppCard"));
  refused(() => negate(engine, id, id("h_tactic"), id("oppCard")), "face-down cards have no rules text (CR 411.1)");
});

clause(PRIEST, "1:ability:negate", "the opponent's second card is unaffected by the first NEGATE: terminating one card terminates only that one", () => {
  const { engine, id } = priestBoard({ oppPlays: "tactic" });
  playRaw(engine, P2, id("oppCard"));
  negate(engine, id, id("h_tactic"), id("oppCard"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oppCard")), "discard");
  assert.equal(zoneOf(engine, id("oppCard2")), "hand", "the other card is not touched");
});

// =================================================================================
// Horrendous Behemoth
// While this card is in a battle, characters in the opposing party lose 1 strength and 1 speed.
// Character (monstrosity), cost 6, [O], 4 strength / 2 speed / 4 life.
// =================================================================================

const BEHEMOTH = "22822a80-f23d-4852-a1be-cea7fd5f0b37";

/**
 * P1 is the active player (so P1 attacks and P2 blocks). The Behemoth belongs to P1 (`beh: "attacker"`)
 * or to P2 (`beh: "defender"`). Every character has 3 strength / 3 speed / 9 life except the Behemoth.
 */
function behemothBoard(opts: { beh?: "attacker" | "defender"; extra?: CardPlacement[]; icons?: Icons; zone?: "play" | "hand" } = {}) {
  const behOwner = opts.beh === "defender" ? P2 : P1;
  const plain = (key: string, owner: PlayerId): CardPlacement => ({
    key,
    def: character({ name: key.toUpperCase(), strength: 3, life: 9, speed: 3 }),
    owner,
    zone: "play"
  });
  return buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "beh", def: printing(BEHEMOTH), owner: behOwner, zone: opts.zone ?? "play" },
      plain("a1", P1),
      plain("a2", P1),
      plain("idle", P1),
      plain("b1", P2),
      plain("b2", P2),
      plain("idle2", P2),
      ...res(opts.icons ?? {}, behOwner),
      ...(opts.extra ?? [])
    ]
  });
}

const sp = (engine: SpoilsEngine, cardId: CardInstanceId) => ({ strength: engine.getStat(cardId, "strength"), speed: engine.getStat(cardId, "speed") });
const PLAIN = { strength: 3, speed: 3 };

clause(BEHEMOTH, "0:rule", "attacking: a character that blocks it loses 1 strength and 1 speed while the battle lasts", () => {
  const { engine, id } = behemothBoard();
  declareAttackBy(engine, P1, [id("beh")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(sp(engine, id("b1")), { strength: 2, speed: 2 }, "3/3 minus 1/1");
});

clause(BEHEMOTH, "0:rule", "only characters in the OPPOSING party are affected: the Behemoth itself, a party mate, my idle character, and their characters that do not block keep their stats", () => {
  const { engine, id } = behemothBoard();
  declareAttackBy(engine, P1, [id("beh"), id("a1")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(sp(engine, id("b1")), { strength: 2, speed: 2 });
  assert.deepEqual(sp(engine, id("beh")), { strength: 4, speed: 2 }, "the Behemoth itself");
  assert.deepEqual(sp(engine, id("a1")), PLAIN, "a character in the same party");
  assert.deepEqual(sp(engine, id("a2")), PLAIN, "my character that is not in the battle");
  assert.deepEqual(sp(engine, id("idle")), PLAIN);
  assert.deepEqual(sp(engine, id("b2")), PLAIN, "their character that did not block");
  assert.deepEqual(sp(engine, id("idle2")), PLAIN);
});

clause(BEHEMOTH, "0:rule", "EVERY character in the opposing blocking party is affected (two blockers: both lose 1 strength and 1 speed)", () => {
  const { engine, id } = behemothBoard();
  declareAttackBy(engine, P1, [id("beh")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
  assert.deepEqual(sp(engine, id("b1")), { strength: 2, speed: 2 });
  assert.deepEqual(sp(engine, id("b2")), { strength: 2, speed: 2 });
  assert.deepEqual(sp(engine, id("idle2")), PLAIN);
});

clause(BEHEMOTH, "0:rule", "blocking: the characters in the attacking party lose 1 strength and 1 speed, the blocking party and the rest do not", () => {
  const { engine, id } = behemothBoard({ beh: "defender" });
  declareAttackBy(engine, P1, [id("a1"), id("a2")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("beh"), id("b1")] });
  assert.deepEqual(sp(engine, id("a1")), { strength: 2, speed: 2 });
  assert.deepEqual(sp(engine, id("a2")), { strength: 2, speed: 2 });
  assert.deepEqual(sp(engine, id("beh")), { strength: 4, speed: 2 }, "the Behemoth itself");
  assert.deepEqual(sp(engine, id("b1")), PLAIN, "its blocking party mate");
  assert.deepEqual(sp(engine, id("idle")), PLAIN, "my character that is not attacking");
  assert.deepEqual(sp(engine, id("b2")), PLAIN);
});

clause(BEHEMOTH, "0:rule", "a Behemoth that stays out of the battle (not blocking) does nothing even though it is in play", () => {
  const { engine, id } = behemothBoard({ beh: "defender" });
  declareAttackBy(engine, P1, [id("a1")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(sp(engine, id("a1")), PLAIN, "the attacker is not in the Behemoth's battle");
  assert.deepEqual(sp(engine, id("beh")), { strength: 4, speed: 2 });
});

clause(BEHEMOTH, "0:rule", "a Behemoth that is not in any battle changes nothing", () => {
  const { engine, id } = behemothBoard();
  for (const key of ["a1", "a2", "idle", "b1", "b2", "idle2"]) assert.deepEqual(sp(engine, id(key)), PLAIN, key);
  assert.deepEqual(sp(engine, id("beh")), { strength: 4, speed: 2 });
});

clause(BEHEMOTH, "0:rule", "before blockers are declared the opposing party does not exist yet: nothing changes; the effect starts when the block is declared", () => {
  const { engine, id } = behemothBoard();
  declareAttackBy(engine, P1, [id("beh")]);
  for (const key of ["b1", "b2", "idle2"]) assert.deepEqual(sp(engine, id(key)), PLAIN, `${key} before blocks`);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b2")] });
  assert.deepEqual(sp(engine, id("b2")), { strength: 2, speed: 2 }, "after the block");
  assert.deepEqual(sp(engine, id("b1")), PLAIN);
});

clause(BEHEMOTH, "0:rule", "the loss ends with the battle: after it resolves the survivors have their normal strength and speed", () => {
  const { engine, id } = behemothBoard();
  fight(engine, P1, [id("beh")], { type: "faction", playerId: P2 }, [id("b1"), id("b2")]);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  assert.deepEqual(sp(engine, id("b1")), PLAIN);
  assert.deepEqual(sp(engine, id("b2")), PLAIN);
});

clause(BEHEMOTH, "0:rule", "the strength loss is real in damage: a 3-strength blocker deals only 2 damage to the Behemoth", () => {
  const { engine, id } = behemothBoard();
  fight(engine, P1, [id("beh")], { type: "faction", playerId: P2 }, [id("b1")]);
  assert.equal(engine.state.cards[id("beh")].damage, 2, "3 - 1 = 2 damage dealt by the blocker");
  assert.equal(engine.state.cards[id("b1")].damage, 4, "the Behemoth deals its full 4");
});

clause(BEHEMOTH, "0:rule", "the strength loss is real when the Behemoth blocks: a 3-strength attacker deals only 2 damage to it", () => {
  const { engine, id } = behemothBoard({ beh: "defender" });
  fight(engine, P1, [id("a1")], { type: "faction", playerId: P2 }, [id("beh")]);
  assert.equal(engine.state.cards[id("beh")].damage, 2, "3 - 1 = 2 damage dealt by the attacker");
});

clause(BEHEMOTH, "0:rule", "the speed loss is real in the battle order: a speed-3 blocker that would kill the Behemoth first drops to speed 2, so they strike together and the Behemoth still hits back", () => {
  const { engine, id } = behemothBoard({
    extra: [{ key: "fast", def: character({ name: "Fast", strength: 5, speed: 3, life: 9 }), owner: P2, zone: "play" }]
  });
  fight(engine, P1, [id("beh")], { type: "faction", playerId: P2 }, [id("fast")]);
  assert.equal(zoneOf(engine, id("beh")), "discard", "the blocker's 5 - 1 = 4 strength kills the 4-life Behemoth");
  assert.equal(engine.state.cards[id("fast")].damage, 4, "but at speed 3 - 1 = 2 it strikes together with the Behemoth (speed 2), which still deals its 4 damage");
});

clause(BEHEMOTH, "0:rule", "control: a character that is not blocking the Behemoth keeps its speed 3 and out-speeds a speed-2 attacker", () => {
  const { engine, id } = behemothBoard({
    extra: [
      { key: "fast", def: character({ name: "Fast", strength: 5, speed: 3, life: 9 }), owner: P2, zone: "play" },
      { key: "plainAtk", def: character({ name: "PlainAtk", strength: 4, speed: 2, life: 4 }), owner: P1, zone: "play" }
    ]
  });
  fight(engine, P1, [id("plainAtk")], { type: "faction", playerId: P2 }, [id("fast")]);
  assert.equal(zoneOf(engine, id("plainAtk")), "discard", "the faster blocker kills it first");
  assert.equal(engine.state.cards[id("fast")].damage, 0, "and takes no damage, since the attacker never struck");
});

clause(BEHEMOTH, "0:rule", "two Behemoths in the same party stack: the blocker loses 2 strength and 2 speed", () => {
  const { engine, id } = behemothBoard({ extra: [{ key: "beh2", def: printing(BEHEMOTH), owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("beh"), id("beh2")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(sp(engine, id("b1")), { strength: 1, speed: 1 });
});

clause(BEHEMOTH, "0:rule", "each side's Behemoth affects the other side: attacking Behemoth vs blocking Behemoth, both lose 1 strength and 1 speed", () => {
  const { engine, id } = behemothBoard({ extra: [{ key: "beh2", def: printing(BEHEMOTH), owner: P2, zone: "play" }] });
  declareAttackBy(engine, P1, [id("beh")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("beh2")] });
  assert.deepEqual(sp(engine, id("beh")), { strength: 3, speed: 1 }, "my Behemoth is in their Behemoth's opposing party");
  assert.deepEqual(sp(engine, id("beh2")), { strength: 3, speed: 1 }, "and theirs in mine");
});

clause(BEHEMOTH, "0:rule", "strength and speed cannot be pushed below 0 (CR 410.4): a 0/0 blocker stays 0/0", () => {
  const { engine, id } = behemothBoard({ extra: [{ key: "zero", def: character({ name: "Zero", strength: 0, speed: 0, life: 9 }), owner: P2, zone: "play" }] });
  declareAttackBy(engine, P1, [id("beh")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("zero")] });
  assert.deepEqual(sp(engine, id("zero")), { strength: 0, speed: 0 });
});

clause(BEHEMOTH, "0:rule", "when the Behemoth leaves the battle (destroyed) the loss ends with it", () => {
  const { engine, id } = behemothBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  declareAttackBy(engine, P1, [id("beh")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
  assert.deepEqual(sp(engine, id("b1")), { strength: 2, speed: 2 });
  engine.perform({ type: "passPriority", playerId: P1 });
  respondWith(engine, P2, id("kill"), { t: [id("beh")] });
  assert.equal(zoneOf(engine, id("beh")), "discard", "the Behemoth was destroyed");
  assert.deepEqual(sp(engine, id("b1")), PLAIN, "its effect ended with it");
});

clause(BEHEMOTH, "0:rule", "deploys for exactly 6 and needs [O]; enters play with its printed 4 strength / 2 speed / 4 life", () => {
  const ok = behemothBoard({ zone: "hand", icons: { obsession: 6 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("beh"));
  assert.equal(before - ready(ok.engine), 6, "the printed cost of 6");
  assert.equal(ok.engine.getStat(ok.id("beh"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("beh"), "speed"), 2);
  assert.equal(ok.engine.getStat(ok.id("beh"), "life"), 4);
  const short = behemothBoard({ zone: "hand", icons: { obsession: 5 } });
  refused(() => playRaw(short.engine, P1, short.id("beh")), "5 resources");
  const noO = behemothBoard({ zone: "hand", icons: { greed: 8 } });
  refused(() => playRaw(noO.engine, P1, noO.id("beh")), "no [O]");
});

// =================================================================================
// Horrifying Brain-Monkey
// SLOBBER -- COST: Pay 4. Destroy this card. Pick a character. -- EFFECT: Destroy the character if it
// has X strength or less, where X is the number of [O] you control.
// Character (monstrosity, brain), cost 3, [O], 2 strength / 3 speed / 1 life.
// =================================================================================

const MONKEY = "dfdadbf6-492e-4d40-aa99-b4ca43399e61";

function monkeyBoard(
  opts: {
    icons?: Icons;
    faceDown?: number;
    oppIcons?: Icons;
    monkey?: "play" | "hand" | "discard";
    depleted?: boolean;
    monkeyFaceDown?: boolean;
    targetStrength?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bm", def: printing(MONKEY), owner: P1, zone: opts.monkey ?? "play", depleted: opts.depleted, faceDown: opts.monkeyFaceDown },
      { key: "foe", def: character({ name: "Foe", strength: opts.targetStrength ?? 2, life: 9 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 0, life: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: opts.targetStrength ?? 2, life: 9 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { obsession: 4 }),
      ...volition(opts.faceDown ?? 0, P1),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const slobber = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId | undefined, player: PlayerId = P1) =>
  engine.perform({
    type: "activateAbility",
    playerId: player,
    cardId: id("bm"),
    abilityId: "slobber",
    selected: target ? { c: [target] } : {},
    variables: {}
  } as never);

clause(MONKEY, "0:ability:slobber", "pays exactly 4 and destroys the Brain-Monkey itself as a cost, and a character with X strength or less is destroyed (X=4, strength 4)", () => {
  const { engine, id } = monkeyBoard({ icons: { obsession: 4 }, targetStrength: 4 });
  const before = ready(engine);
  slobber(engine, id, id("foe"));
  assert.equal(before - ready(engine), 4, "Pay 4");
  assert.equal(zoneOf(engine, id("bm")), "discard", "Destroy this card (a cost, so already done while responses are possible)");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard", "strength 4 <= X = 4");
  assert.ok(discardOf(engine, P2).includes(id("foe")), "into its owner's discard pile");
  assert.equal(engine.state.pendingChoice, undefined);
});

// X is the number of [O] I control: every [O] counts, including the ones just spent to pay.
for (const [obsession, greed, strength, destroyed] of [
  [4, 0, 4, true],
  [4, 0, 5, false],
  [4, 0, 3, true],
  [4, 0, 0, true],
  [5, 0, 5, true],
  [5, 0, 6, false],
  [8, 0, 8, true],
  [8, 0, 9, false],
  [3, 1, 3, true],
  [3, 1, 4, false],
  [2, 2, 2, true],
  [2, 2, 3, false],
  [1, 3, 1, true],
  [1, 3, 2, false],
  [0, 4, 0, true],
  [0, 4, 1, false]
] as const) {
  clause(MONKEY, "0:ability:slobber", `X = the number of [O] I control: with ${obsession} [O] (and ${greed} other resources) a character with strength ${strength} is ${destroyed ? "destroyed" : "NOT destroyed"}`, () => {
    const { engine, id } = monkeyBoard({ icons: { obsession, ...(greed ? { greed } : {}) }, targetStrength: strength });
    slobber(engine, id, id("foe"));
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("foe")), destroyed ? "discard" : "play", `X = ${obsession}, strength ${strength}`);
    assert.equal(zoneOf(engine, id("bm")), "discard", "the Brain-Monkey is destroyed either way (a cost)");
    assert.equal(ready(engine), obsession + greed - 4, "exactly 4 paid");
  });
}

clause(MONKEY, "0:ability:slobber", "face-down resources provide Volition, not [O]: they pay but do not raise X", () => {
  const { engine, id } = monkeyBoard({ icons: { obsession: 2 }, faceDown: 3, targetStrength: 3 });
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 2);
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "play", "strength 3 > X = 2 (the 3 face-down resources are not [O])");
  const ok = monkeyBoard({ icons: { obsession: 2 }, faceDown: 3, targetStrength: 2 });
  slobber(ok.engine, ok.id, ok.id("foe"));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("foe")), "discard", "strength 2 <= X = 2");
});

clause(MONKEY, "0:ability:slobber", "X counts only MY [O]: the opponent's [O] do not count", () => {
  const { engine, id } = monkeyBoard({ icons: { greed: 4 }, oppIcons: { obsession: 6 }, targetStrength: 1 });
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "play", "X = 0 for me, so strength 1 survives");
  const zero = monkeyBoard({ icons: { greed: 4 }, oppIcons: { obsession: 6 }, targetStrength: 0 });
  slobber(zero.engine, zero.id, zero.id("foe"));
  resolvePendingResponses(zero.engine);
  assert.equal(zero.engine.state.cards[zero.id("foe")].zone, "discard", "strength 0 <= X = 0");
});

clause(MONKEY, "0:ability:slobber", "the comparison uses the character's CURRENT strength, including bonuses", () => {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const { engine, id } = monkeyBoard({
    icons: { obsession: 4 },
    targetStrength: 3,
    extra: [{ key: "buff", def: buff, owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  assert.equal(engine.getStat(id("foe"), "strength"), 5, "printed 3 plus 2");
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "play", "current strength 5 > X = 4");
});

clause(MONKEY, "0:ability:slobber", "I can pick one of my own characters", () => {
  const { engine, id } = monkeyBoard({ icons: { obsession: 4 }, targetStrength: 2 });
  slobber(engine, id, id("mine"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("foe")), "play", "only the picked character");
});

clause(MONKEY, "0:ability:slobber", "only the picked character is affected, even when others also have X strength or less", () => {
  const { engine, id } = monkeyBoard({ icons: { obsession: 4 }, targetStrength: 2 });
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("foe2")), "play", "a 0-strength character that was not picked");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(MONKEY, "0:ability:slobber", "it can pick the Brain-Monkey itself: it is destroyed as a cost and nothing else happens", () => {
  const { engine, id } = monkeyBoard({ icons: { obsession: 4 } });
  slobber(engine, id, id("bm"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("bm")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  for (const key of ["foe", "foe2", "mine"]) assert.equal(zoneOf(engine, id(key)), "play", key);
});

clause(MONKEY, "0:ability:slobber", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = monkeyBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown", strength: 0 }), owner: P2, zone: "play", faceDown: true }] });
  for (const [what, target] of [
    ["an item", id("thing")],
    ["a location", id("place")],
    ["a faction", engine.state.players[P2].factionId!],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("mh")]
  ] as const) {
    refused(() => slobber(engine, id, target), what);
  }
  assert.equal(zoneOf(engine, id("bm")), "play", "the Brain-Monkey was not destroyed by the refused attempts");
  assert.equal(ready(engine), 4, "nothing was paid (the opponent's face-down card is not one of my resources)");
  slobber(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("bm")), "discard", "control: a character works");
});

clause(MONKEY, "0:ability:slobber", "a pick is required, exactly one", () => {
  const { engine, id } = monkeyBoard();
  refused(() => slobber(engine, id, undefined), "no pick");
  refused(
    () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bm"), abilityId: "slobber", selected: { c: [id("foe"), id("foe2")] }, variables: {} } as never),
    "two picks"
  );
  assert.equal(zoneOf(engine, id("bm")), "play");
  assert.equal(ready(engine), 4);
});

clause(MONKEY, "0:ability:slobber", "is refused one resource short of Pay 4, allowed with exactly 4; no threshold is required", () => {
  const short = monkeyBoard({ icons: { obsession: 3 } });
  refused(() => slobber(short.engine, short.id, short.id("foe")), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("bm")), "play", "not destroyed");
  const exact = monkeyBoard({ icons: { greed: 4 }, targetStrength: 0 });
  slobber(exact.engine, exact.id, exact.id("foe"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "four non-[O] resources are enough");
  assert.equal(ready(exact.engine), 0);
});

clause(MONKEY, "0:ability:slobber", "does not need to be ready: a depleted Brain-Monkey can still SLOBBER", () => {
  const { engine, id } = monkeyBoard({ depleted: true, targetStrength: 1 });
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(MONKEY, "0:ability:slobber", "can only be used from play; a face-down Brain-Monkey has no abilities; only its controller can use it", () => {
  for (const monkey of ["hand", "discard"] as const) {
    const b = monkeyBoard({ monkey });
    refused(() => slobber(b.engine, b.id, b.id("foe")), `Brain-Monkey in ${monkey}`);
    assert.equal(b.engine.state.cards[b.id("foe")].zone, "play");
  }
  const fd = monkeyBoard({ monkeyFaceDown: true });
  refused(() => slobber(fd.engine, fd.id, fd.id("foe")), "face-down cards have no rules text (CR 411.1)");
  const theirs = monkeyBoard({ turn: 2, active: P2, extra: res({ obsession: 4 }, P2) });
  refused(() => slobber(theirs.engine, theirs.id, theirs.id("foe"), P2), "the opponent cannot use my Brain-Monkey");
  assert.equal(zoneOf(theirs.engine, theirs.id("bm")), "play");
});

clause(MONKEY, "0:ability:slobber", "as an ability it can be used in response on the opponent's turn", () => {
  const { engine, id } = monkeyBoard({ turn: 2, active: P2, targetStrength: 1 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(MONKEY, "0:ability:slobber", "can be used the turn it enters play (abilities have no summoning sickness, CR 204.3a)", () => {
  const { engine, id } = monkeyBoard({ monkey: "hand", icons: { obsession: 8 }, targetStrength: 2 });
  play(engine, P1, id("bm"));
  assert.equal(zoneOf(engine, id("bm")), "play");
  slobber(engine, id, id("foe"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(MONKEY, "0:ability:slobber", "deploys for exactly 3 and needs [O]; enters play with its printed 2 strength / 3 speed / 1 life", () => {
  const ok = monkeyBoard({ monkey: "hand", icons: { obsession: 3 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("bm"));
  assert.equal(before - ready(ok.engine), 3, "the printed cost of 3");
  assert.equal(ok.engine.getStat(ok.id("bm"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("bm"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("bm"), "life"), 1);
  const short = monkeyBoard({ monkey: "hand", icons: { obsession: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("bm")), "2 resources");
  const noO = monkeyBoard({ monkey: "hand", icons: { greed: 5 } });
  refused(() => playRaw(noO.engine, P1, noO.id("bm")), "no [O]");
});

// =================================================================================
// Inhibit
// COST: Pick a non-resource card. -- EFFECT: Until the start of your next turn, treat the card as
// though it has no rules text. Draw a card.
// Tactic, cost 1, [O].
// =================================================================================

const INHIBIT = "5032dc44-43e5-4ec7-b044-11d897cb2a49";

/** A character with every kind of rules text: a keyword, an activated, a triggered and a continuous ability. */
const rulesy = (name: string) =>
  character({
    name,
    strength: 2,
    life: 5,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] },
        {
          id: "gain",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
        },
        { id: "pump", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }
      ]
    }
  });

const RULESY_DEF = rulesy("Rulesy");

/** A location whose only text is an aura: its controller's characters gain 1 strength. */
const auraLocation = () =>
  location({
    name: "Aura Place",
    behavior: {
      abilities: [{ id: "aura", type: "continuous", modifiers: [{ selector: { type: "character", controller: "self" }, stat: "strength", operation: "add", value: 1 }] }]
    }
  });

/** An item with an activated "draw" ability. */
const gadgetItem = () =>
  item({
    name: "Gadget",
    behavior: { abilities: [{ id: "tick", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function inhibitBoard(opts: { icons?: Icons; turn?: number; active?: PlayerId; auras?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "inh", def: printing(INHIBIT), owner: P1, zone: "hand" },
      { key: "theirs", def: RULESY_DEF, owner: P2, zone: "play" },
      { key: "theirs2", def: RULESY_DEF, owner: P2, zone: "play" },
      { key: "mine", def: RULESY_DEF, owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 5 }), owner: P2, zone: "play" },
      ...(opts.auras
        ? [
            { key: "aura", def: auraLocation(), owner: P2, zone: "play" as const },
            { key: "myAura", def: auraLocation(), owner: P1, zone: "play" as const }
          ]
        : []),
      { key: "gadget", def: gadgetItem(), owner: P2, zone: "play" },
      { key: "fdRes", def: rulesy("Hidden"), owner: P2, zone: "play", faceDown: true },
      { key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "disc", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...cards("d", 4, P1, "deck"),
      ...cards("e", 4, P2, "deck"),
      ...res(opts.icons ?? { obsession: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

const inhibit = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: CardInstanceId) =>
  play(engine, P1, id("inh"), { selected: { c: [target] } });

clause(INHIBIT, "0:ability", "pays exactly 1 and draws exactly one card for me (the top of my deck); the tactic ends in my discard pile", () => {
  const { engine, id } = inhibitBoard();
  const top = deckOf(engine, P1)[0];
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  inhibit(engine, id, id("theirs"));
  assert.equal(before - ready(engine), 1, "the printed cost of 1");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(zoneOf(engine, id("inh")), "discard");
  assert.equal(handOf(engine, P2).length, 1, "the opponent draws nothing");
});

clause(INHIBIT, "0:ability", "a picked card's continuous text is switched off: a character's self-pump no longer applies", () => {
  const { engine, id } = inhibitBoard();
  assert.equal(engine.getStat(id("theirs"), "strength"), 4, "control: 2 printed + 2 from its own text");
  inhibit(engine, id, id("theirs"));
  assert.equal(engine.getStat(id("theirs"), "strength"), 2, "no rules text, so no +2");
  assert.equal(engine.getStat(id("theirs2"), "strength"), 4, "another copy keeps its text");
});

clause(INHIBIT, "0:ability", "a picked card's printed stats are not rules text: strength, speed and life stay", () => {
  const { engine, id } = inhibitBoard();
  inhibit(engine, id, id("theirs"));
  assert.equal(engine.getStat(id("theirs"), "life"), 5);
  assert.equal(engine.getStat(id("theirs"), "speed"), 2);
  assert.equal(engine.getStat(id("theirs"), "strength"), 2);
});

clause(INHIBIT, "0:ability", "a picked card's keywords are rules text too: it loses COVERT", () => {
  const { engine, id } = inhibitBoard();
  assert.ok(engine.getKeywords(id("theirs")).includes("covert"), "control: it has COVERT");
  inhibit(engine, id, id("theirs"));
  assert.equal(engine.getKeywords(id("theirs")).includes("covert"), false);
  assert.ok(engine.getKeywords(id("theirs2")).includes("covert"), "another copy keeps it");
});

clause(INHIBIT, "0:ability", "a picked card's activated ability can no longer be used", () => {
  const { engine, id } = inhibitBoard();
  inhibit(engine, id, id("theirs"));
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "it is the opponent's turn: the effect lasts until MY next turn");
  assert.throws(() => activate(engine, P2, id("theirs"), "study"), /Activated ability not found/, "the ability no longer exists on the card");
  assert.equal(handOf(engine, P2).length, 1, "nothing was drawn");
  activate(engine, P2, id("theirs2"), "study");
  assert.equal(handOf(engine, P2).length, 2, "control: the other copy still works");
});

clause(INHIBIT, "0:ability", "an item's activated ability can no longer be used", () => {
  const { engine, id } = inhibitBoard();
  inhibit(engine, id, id("gadget"));
  endTurn(engine, P1);
  orderTriggersOnly(engine);
  assert.throws(() => activate(engine, P2, id("gadget"), "tick"), /Activated ability not found/, "the ability no longer exists on the card");
  assert.equal(handOf(engine, P2).length, 1);
});

clause(INHIBIT, "0:ability", "control: the same item's ability works when nothing was inhibited", () => {
  const { engine, id } = inhibitBoard();
  endTurn(engine, P1);
  orderTriggersOnly(engine);
  activate(engine, P2, id("gadget"), "tick");
  assert.equal(handOf(engine, P2).length, 2, "the ability drew one card (the hand was 1)");
});

clause(INHIBIT, "0:ability", "a picked card's triggered ability does not fire: the opponent's turn start gives their inhibited character's controller nothing", () => {
  const { engine, id } = inhibitBoard();
  const influence = engine.state.players[P2].influence;
  inhibit(engine, id, id("theirs"));
  endTurn(engine, P1);
  settled(engine);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.players[P2].influence, influence + 3, "only the uninhibited copy (theirs2) gained 3, not 6");
});

clause(INHIBIT, "0:ability", "control: without Inhibit both copies' triggers fire (+6)", () => {
  const { engine } = inhibitBoard();
  const influence = engine.state.players[P2].influence;
  endTurn(engine, P1);
  orderTriggersOnly(engine);
  assert.equal(engine.state.players[P2].influence, influence + 6);
});

clause(INHIBIT, "0:ability", "a picked location's aura is switched off: its controller's characters stop gaining strength", () => {
  const { engine, id } = inhibitBoard({ auras: true });
  assert.equal(engine.getStat(id("plain"), "strength"), 3, "control: 2 printed + 1 from the Aura Place");
  inhibit(engine, id, id("aura"));
  assert.equal(engine.getStat(id("plain"), "strength"), 2, "no rules text, no aura");
  assert.equal(engine.getStat(id("mine"), "strength"), 5, "my own aura location is untouched (2 + 2 + 1)");
});

clause(INHIBIT, "0:ability", "I can pick one of my own cards: my character loses its text", () => {
  const { engine, id } = inhibitBoard({ auras: true });
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  inhibit(engine, id, id("mine"));
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "its +2 is gone, my aura's +1 stays");
});

clause(INHIBIT, "0:ability", "any non-resource card in play can be picked: a character, an item and a location (mine or theirs)", () => {
  for (const key of ["theirs", "mine", "gadget", "aura", "myAura", "plain"]) {
    const { engine, id } = inhibitBoard({ auras: true });
    playRaw(engine, P1, id("inh"), { selected: { c: [id(key)] } });
    assert.ok(engine.state.responseWindow, `${key} was accepted`);
  }
});

clause(INHIBIT, "0:ability", "a RESOURCE cannot be picked: a face-down card (only a resource) is refused", () => {
  const { engine, id } = inhibitBoard();
  refused(() => playRaw(engine, P1, id("inh"), { selected: { c: [id("fdRes")] } }), "a face-down card");
  assert.equal(zoneOf(engine, id("inh")), "hand");
  assert.equal(ready(engine), 3 + 0, "nothing was paid");
  playRaw(engine, P1, id("inh"), { selected: { c: [id("theirs")] } });
  assert.ok(engine.state.responseWindow, "control: a face-up character is accepted");
});

clause(INHIBIT, "0:ability", "a face-up staple resource card in play cannot be picked either", () => {
  const { engine, id } = inhibitBoard({ extra: [{ key: "stapleRes", def: resourceCard({ name: "StapleRage" }), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("inh"), { selected: { c: [id("stapleRes")] } }), "a resource card");
  assert.equal(zoneOf(engine, id("inh")), "hand");
});

clause(INHIBIT, "0:ability", "a faction cannot be picked (CR 202.9), nor can cards in a hand, a discard pile or a deck", () => {
  const { engine, id } = inhibitBoard();
  const attempt = (target: CardInstanceId) => () => playRaw(engine, P1, id("inh"), { selected: { c: [target] } });
  refused(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  refused(attempt(engine.state.players[P1].factionId!), "my faction");
  refused(attempt(id("oh")), "a card in the opponent's hand");
  refused(attempt(id("disc")), "a card in a discard pile");
  refused(attempt(id("e0")), "a card in a deck");
  assert.equal(zoneOf(engine, id("inh")), "hand");
});

clause(INHIBIT, "0:ability", "a pick is required, exactly one", () => {
  const { engine, id } = inhibitBoard();
  refused(() => playRaw(engine, P1, id("inh"), { selected: {} }), "no pick");
  refused(() => playRaw(engine, P1, id("inh"), { selected: { c: [id("theirs"), id("gadget")] } }), "two picks");
  assert.equal(zoneOf(engine, id("inh")), "hand");
});

clause(INHIBIT, "0:ability", "'until the start of your next turn': the text stays off for the rest of this turn AND the opponent's whole turn, and is back at the start of my next turn", () => {
  const { engine, id } = inhibitBoard();
  inhibit(engine, id, id("theirs"));
  assert.equal(engine.getStat(id("theirs"), "strength"), 2, "off during my turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  settled(engine);
  assert.equal(engine.getStat(id("theirs"), "strength"), 2, "still off during the opponent's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my next turn has started");
  assert.equal(engine.getStat(id("theirs"), "strength"), 4, "its text is back");
});

clause(INHIBIT, "0:ability", "the effect ends AT the start of my next turn, before 'at the start of your turn' triggers: my own inhibited card's start-of-turn trigger fires then", () => {
  const { engine, id } = inhibitBoard();
  const influence = engine.state.players[P1].influence;
  inhibit(engine, id, id("mine"));
  endTurn(engine, P1);
  orderTriggersOnly(engine);
  endTurn(engine, P2);
  orderTriggersOnly(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.players[P1].influence, influence + 3, "my inhibited character's trigger works at the start of my next turn (CR 602.1b then 602.2)");
});

clause(INHIBIT, "0:ability", "cast in response on the opponent's turn it lasts only until the start of my next turn, i.e. the rest of their turn", () => {
  const { engine, id } = inhibitBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: rulesy("Attacker"), owner: P2, zone: "play" }] });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  inhibit(engine, id, id("atk"));
  assert.equal(engine.getStat(id("atk"), "strength"), 2);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(engine);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getStat(id("atk"), "strength"), 4, "back at the start of my turn");
});

clause(INHIBIT, "0:ability", "only the picked card is affected: every other card keeps its text", () => {
  const { engine, id } = inhibitBoard({ auras: true });
  inhibit(engine, id, id("gadget"));
  assert.equal(engine.getStat(id("theirs"), "strength"), 5, "2 + 2 own text + 1 aura");
  assert.equal(engine.getStat(id("theirs2"), "strength"), 5);
  assert.equal(engine.getStat(id("plain"), "strength"), 3, "the Aura Place still works");
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
});

clause(INHIBIT, "0:ability", "I still draw if the picked card leaves play in response (effects do not fizzle, CR 402.5a)", () => {
  const { engine, id } = inhibitBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("inh"), { selected: { c: [id("theirs")] } });
  respondWith(engine, P2, id("kill"), { t: [id("theirs")] });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.equal(zoneOf(engine, top), "hand", "I still drew the card");
});

clause(INHIBIT, "0:ability", "with an empty deck I fail to draw (CR 306.2) but the card still loses its text", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "inh", def: printing(INHIBIT), owner: P1, zone: "hand" },
      { key: "theirs", def: RULESY_DEF, owner: P2, zone: "play" },
      ...res({ obsession: 2 })
    ]
  });
  inhibit(engine, id, id("theirs"));
  assert.equal(engine.getStat(id("theirs"), "strength"), 2);
  assert.equal(engine.state.winner, undefined);
});

clause(INHIBIT, "0:ability", "is refused with no resources at all, allowed with exactly 1 [O]", () => {
  const none = inhibitBoard({ icons: {} });
  refused(() => playRaw(none.engine, P1, none.id("inh"), { selected: { c: [none.id("theirs")] } }), "no resources");
  assert.equal(zoneOf(none.engine, none.id("inh")), "hand");
  const exact = inhibitBoard({ icons: { obsession: 1 } });
  inhibit(exact.engine, exact.id, exact.id("theirs"));
  assert.equal(ready(exact.engine), 0);
  assert.equal(exact.engine.getStat(exact.id("theirs"), "strength"), 2);
});

clause(INHIBIT, "0:ability", "needs [O]: other resources alone are not enough", () => {
  const { engine, id } = inhibitBoard({ icons: { greed: 5 } });
  refused(() => playRaw(engine, P1, id("inh"), { selected: { c: [id("theirs")] } }), "no [O]");
  assert.equal(zoneOf(engine, id("inh")), "hand");
  const theirs = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "inh", def: printing(INHIBIT), owner: P1, zone: "hand" },
      { key: "theirs", def: RULESY_DEF, owner: P2, zone: "play" },
      ...res({ greed: 3 }),
      ...res({ obsession: 3 }, P2)
    ]
  });
  refused(() => playRaw(theirs.engine, P1, theirs.id("inh"), { selected: { c: [theirs.id("theirs")] } }), "the opponent's [O] do not count");
});

clause(INHIBIT, "0:ability", "can be played in response on the opponent's turn (it is a tactic), not outside a window", () => {
  const { engine, id } = inhibitBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("inh"), { selected: { c: [id("theirs")] } }), "no window yet");
  assert.equal(zoneOf(engine, id("inh")), "hand");
});

// =================================================================================
// Intellectual Reliquary
// IMBIBE -- COST: Pay 1. Deplete this card. -- EFFECT: Look at the top 3 cards of your deck. You may
// choose a tactic among them and reveal it. If you do, put it into your hand. Put the remaining
// cards on the bottom of your deck in any order.
// Item, cost 1, [O][O].
// =================================================================================

const RELIQUARY = "32c1ba5b-4c61-4b63-9bb8-305910aa6202";

/** Deck kinds from the top: "c" = character, "t" = tactic, "i" = item. Keys are `k0..`. */
function reliquaryBoard(
  opts: { deck?: string; icons?: Icons; rq?: "play" | "hand"; depleted?: boolean; faceDown?: boolean; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const kinds = [...(opts.deck ?? "ctcccc")];
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rq", def: printing(RELIQUARY), owner: P1, zone: opts.rq ?? "play", depleted: opts.depleted, faceDown: opts.faceDown },
      ...kinds.map((kind, i) => ({
        key: `k${i}`,
        def: kind === "t" ? tactic({ name: `T${i}` }) : kind === "i" ? item({ name: `I${i}` }) : character({ name: `C${i}` }),
        owner: P1,
        zone: "deck" as const
      })),
      ...tactics("ot", 3, P2, "deck"),
      ...tactics("oh", 2, P2, "hand"),
      { key: "ht", def: tactic({ name: "HandTactic" }), owner: P1, zone: "hand" },
      { key: "dt", def: tactic({ name: "DiscardTactic" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { obsession: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

/**
 * Activates IMBIBE (nothing is picked as a cost). With `pick` (possibly empty), the responses are
 * resolved and, if the "you may choose a tactic" prompt is open, it is answered with `pick`
 * (an invalid pick throws and leaves the prompt open). Without `pick` only the activation happens.
 */
const imbibe = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, pick?: CardInstanceId[], player: PlayerId = P1) => {
  if ((pending(engine) as { kind?: string } | undefined)?.kind !== "chooserSelectsTarget") {
    engine.perform({
      type: "activateAbility",
      playerId: player,
      cardId: id("rq"),
      abilityId: "imbibe",
      selected: {},
      variables: {}
    } as never);
    if (!pick) return;
    resolvePendingResponses(engine);
  }
  if ((pending(engine) as { kind?: string } | undefined)?.kind === "chooserSelectsTarget") {
    answerPending(engine, "chooserSelectsTarget", { selected: pick ?? [] });
  }
};

/** Answers the reorder prompt (asserting who answers and which cards) with `order`, top of the placed group first. */
function reorderBottom(engine: SpoilsEngine, expectedCards: CardInstanceId[], order: CardInstanceId[]): void {
  const pc = pending(engine) as unknown as { kind: string; playerId: string; cardIds: string[]; to?: string } | undefined;
  assert.ok(pc, "a reorder prompt is open");
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "I order my own cards");
  assert.equal(pc.to, "bottom", "they go on the bottom");
  assert.deepEqual([...pc.cardIds].sort(), [...expectedCards].sort(), "exactly the remaining cards are to be ordered");
  answerPending(engine, "reorderDeck", { order });
}

clause(RELIQUARY, "0:ability:imbibe", "pays exactly 1 and depletes the Reliquary; a tactic chosen among the top 3 goes to my hand and the other two go on the bottom in the order I choose", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  imbibe(engine, id, [id("k1")]);
  assert.equal(before - ready(engine), 1, "Pay 1");
  assert.equal(engine.state.cards[id("rq")].depleted, true, "Deplete this card");
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k2"), id("k0")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("k1")), "hand", "the tactic is in my hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.deepEqual(deckOf(engine, P1), [id("k3"), id("k4"), id("k5"), id("k2"), id("k0")], "the rest moved up; the two others are now the bottom cards in my order");
});

clause(RELIQUARY, "0:ability:imbibe", "the order is mine to choose: the other order puts the two remaining cards on the bottom the other way round", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  assert.deepEqual(deckOf(engine, P1), [id("k3"), id("k4"), id("k5"), id("k0"), id("k2")]);
});

for (const [deck, tacticKey] of [
  ["tcccc", "k0"],
  ["cctcc", "k2"]
] as const) {
  clause(RELIQUARY, "0:ability:imbibe", `a tactic in the ${tacticKey === "k0" ? "first" : "third"} of the top 3 can be chosen too`, () => {
    const { engine, id } = reliquaryBoard({ deck });
    imbibe(engine, id, [id(tacticKey)]);
    resolvePendingResponses(engine);
    const remaining = ["k0", "k1", "k2"].filter((k) => k !== tacticKey).map(id);
    reorderBottom(engine, remaining, remaining);
    assert.equal(zoneOf(engine, id(tacticKey)), "hand");
    assert.deepEqual(deckOf(engine, P1), [id("k3"), id("k4"), ...remaining]);
  });
}

clause(RELIQUARY, "0:ability:imbibe", "with two tactics among the top 3 I may choose only ONE (either); the other goes to the bottom with the rest", () => {
  const { engine, id } = reliquaryBoard({ deck: "ttcccc" });
  refused(() => imbibe(engine, id, [id("k0"), id("k1")]), "two tactics");
  assert.equal((pending(engine) as { kind?: string } | undefined)?.kind, "chooserSelectsTarget", "the prompt is still open after the refused pick");
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  assert.equal(zoneOf(engine, id("k1")), "hand");
  assert.equal(zoneOf(engine, id("k0")), "deck", "the tactic I did not choose goes to the bottom");
  assert.deepEqual(deckOf(engine, P1).slice(-2), [id("k0"), id("k2")]);
});

clause(RELIQUARY, "0:ability:imbibe", "'you MAY choose': I can decline the tactic although one is there: no card goes to my hand and all 3 go to the bottom in my order", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  const handBefore = [...handOf(engine, P1)];
  imbibe(engine, id, []);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k1"), id("k2")], [id("k2"), id("k0"), id("k1")]);
  assert.deepEqual(handOf(engine, P1), handBefore, "my hand is unchanged");
  assert.equal(zoneOf(engine, id("k1")), "deck", "the tactic stays in the deck, on the bottom");
  assert.deepEqual(deckOf(engine, P1), [id("k3"), id("k4"), id("k5"), id("k2"), id("k0"), id("k1")]);
});

clause(RELIQUARY, "0:ability:imbibe", "with no tactic among the top 3 all three go to the bottom in my order and my hand is unchanged", () => {
  const { engine, id } = reliquaryBoard({ deck: "cccctc" });
  const handBefore = [...handOf(engine, P1)];
  imbibe(engine, id);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k1"), id("k2")], [id("k1"), id("k2"), id("k0")]);
  assert.deepEqual(handOf(engine, P1), handBefore);
  assert.deepEqual(deckOf(engine, P1), [id("k3"), id("k4"), id("k5"), id("k1"), id("k2"), id("k0")]);
});

clause(RELIQUARY, "0:ability:imbibe", "only the TOP 3 are looked at: a tactic in the 4th place cannot be chosen", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcttc" });
  refused(() => imbibe(engine, id, [id("k3")]), "the 4th card");
  refused(() => imbibe(engine, id, [id("k4")]), "the 5th card");
  assert.equal((pending(engine) as { kind?: string } | undefined)?.kind, "chooserSelectsTarget", "the prompt is still open after the refused picks");
  imbibe(engine, id, []);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k1"), id("k2")], [id("k0"), id("k1"), id("k2")]);
  assert.equal(zoneOf(engine, id("k3")), "deck", "the 4th card is not touched");
});

clause(RELIQUARY, "0:ability:imbibe", "only a TACTIC can be chosen: a character or an item among the top 3 is refused", () => {
  const { engine, id } = reliquaryBoard({ deck: "cit" });
  refused(() => imbibe(engine, id, [id("k0")]), "a character");
  refused(() => imbibe(engine, id, [id("k1")]), "an item");
  imbibe(engine, id, [id("k2")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("k2")), "hand", "control: the tactic is accepted");
});

clause(RELIQUARY, "0:ability:imbibe", "only from MY deck: the opponent's deck, my hand and my discard pile are refused", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctc" });
  refused(() => imbibe(engine, id, [id("ot0")]), "a tactic in the opponent's deck");
  refused(() => imbibe(engine, id, [id("ht")]), "a tactic in my hand");
  refused(() => imbibe(engine, id, [id("dt")]), "a tactic in my discard pile");
  refused(() => imbibe(engine, id, [id("oh0")]), "a tactic in the opponent's hand");
  assert.equal((pending(engine) as { kind?: string } | undefined)?.kind, "chooserSelectsTarget", "the prompt is still open after the refused picks");
  imbibe(engine, id, [id("k1")]);
  assert.equal(engine.state.cards[id("rq")].depleted, true, "control");
});

clause(RELIQUARY, "0:ability:imbibe", "the chosen tactic is revealed to everyone (and only it)", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("k1")], "only the chosen tactic");
  assert.equal(ev.viewerId, "all");
});

clause(RELIQUARY, "0:ability:imbibe", "the order must use exactly the remaining cards: a card that is not among them, a duplicate or a missing card is refused", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  const answerWith = (order: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  refused(answerWith([id("k0"), id("k3")]), "k3 is not one of the remaining cards");
  refused(answerWith([id("k0")]), "a card is missing");
  refused(answerWith([id("k0"), id("k0")]), "a duplicate");
  refused(answerWith([id("k0"), id("k1")]), "the tactic I took is not among them");
  assert.ok(pending(engine), "the prompt is still open");
  answerWith([id("k2"), id("k0")])();
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "control: a valid order is accepted");
});

clause(RELIQUARY, "0:ability:imbibe", "the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(RELIQUARY, "0:ability:imbibe", "with only 2 cards in the deck I look at those 2: a tactic among them can be chosen and the other goes to the (same) deck bottom", () => {
  const { engine, id } = reliquaryBoard({ deck: "ct" });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  drain(engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("k1")), "hand");
  assert.deepEqual(deckOf(engine, P1), [id("k0")]);
});

clause(RELIQUARY, "0:ability:imbibe", "with a 1-card deck that is a tactic I can take it; with an empty deck nothing happens and the game is not stuck", () => {
  const one = reliquaryBoard({ deck: "t" });
  imbibe(one.engine, one.id, [one.id("k0")]);
  resolvePendingResponses(one.engine);
  drain(one.engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : declineAll(pc)));
  assert.equal(zoneOf(one.engine, one.id("k0")), "hand");
  assert.equal(deckOf(one.engine, P1).length, 0);
  const none = reliquaryBoard({ deck: "" });
  imbibe(none.engine, none.id);
  resolvePendingResponses(none.engine);
  drain(none.engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [] } : declineAll(pc)));
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(none.engine.state.cards[none.id("rq")].depleted, true, "the cost was still paid");
  assert.equal(none.engine.state.winner, undefined);
});

clause(RELIQUARY, "0:ability:imbibe", "the tactic is chosen when the effect resolves, after looking at the top 3 (the player is asked then), not named in advance when the ability is activated", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctcccc" });
  imbibe(engine, id);
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "an open choice");
  assert.equal(pc.kind, "chooserSelectsTarget", "first I am asked which tactic among the top 3 (if any) to take");
  assert.equal(pc.playerId, P1);
});

clause(RELIQUARY, "0:ability:imbibe", "is refused one resource short of Pay 1, allowed with exactly 1; no threshold is required for the ability", () => {
  const none = reliquaryBoard({ icons: {} });
  refused(() => imbibe(none.engine, none.id), "no resources");
  assert.equal(none.engine.state.cards[none.id("rq")].depleted, false, "not depleted by the refused attempt");
  const exact = reliquaryBoard({ icons: { greed: 1 } });
  imbibe(exact.engine, exact.id, [exact.id("k1")]);
  assert.equal(ready(exact.engine), 0);
  assert.equal(exact.engine.state.cards[exact.id("rq")].depleted, true, "a single non-[O] resource is enough");
});

clause(RELIQUARY, "0:ability:imbibe", "cannot be used while depleted, but works again once restored at the start of my next turn", () => {
  const { engine, id } = reliquaryBoard({ deck: "ctccccc" });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  refused(() => imbibe(engine, id), "already depleted");
  assert.equal(pending(engine), undefined, "nothing opened");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("rq")].depleted, false, "restored");
  imbibe(engine, id);
  assert.equal(engine.state.cards[id("rq")].depleted, true, "usable again");
});

clause(RELIQUARY, "0:ability:imbibe", "a depleted Reliquary from the start cannot be used (control: the same card ready can)", () => {
  const depleted = reliquaryBoard({ depleted: true });
  refused(() => imbibe(depleted.engine, depleted.id), "depleted");
  const ok = reliquaryBoard();
  imbibe(ok.engine, ok.id);
  assert.ok(ok.engine.state.cards[ok.id("rq")].depleted, "ok.engine.state.cards[ok.id(\"rq\")].depleted");
});

clause(RELIQUARY, "0:ability:imbibe", "can be used the turn it enters play, only by its controller, only from play, and not while face-down", () => {
  const fresh = reliquaryBoard({ rq: "hand", icons: { obsession: 3 } });
  play(fresh.engine, P1, fresh.id("rq"));
  imbibe(fresh.engine, fresh.id, [fresh.id("k1")]);
  assert.equal(fresh.engine.state.cards[fresh.id("rq")].depleted, true, "usable the turn it entered");
  const inHand = reliquaryBoard({ rq: "hand" });
  refused(() => imbibe(inHand.engine, inHand.id), "in the hand");
  const fd = reliquaryBoard({ faceDown: true });
  refused(() => imbibe(fd.engine, fd.id), "face-down cards have no rules text (CR 411.1)");
  const theirs = reliquaryBoard({ turn: 2, active: P2, extra: res({ obsession: 3 }, P2) });
  refused(() => imbibe(theirs.engine, theirs.id, undefined, P2), "the opponent cannot use my Reliquary");
});

clause(RELIQUARY, "0:ability:imbibe", "as an ability it can be used in response on the opponent's turn", () => {
  const { engine, id } = reliquaryBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  imbibe(engine, id, [id("k1")]);
  resolvePendingResponses(engine);
  reorderBottom(engine, [id("k0"), id("k2")], [id("k0"), id("k2")]);
  assert.equal(zoneOf(engine, id("k1")), "hand");
});

clause(RELIQUARY, "0:ability:imbibe", "deploys for exactly 1 and needs [O][O]", () => {
  const ok = reliquaryBoard({ rq: "hand", icons: { obsession: 2 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("rq"));
  assert.equal(before - ready(ok.engine), 1, "the printed cost of 1");
  assert.equal(zoneOf(ok.engine, ok.id("rq")), "play");
  const one = reliquaryBoard({ rq: "hand", icons: { obsession: 1, greed: 4 } });
  refused(() => playRaw(one.engine, P1, one.id("rq")), "one [O]");
  const none = reliquaryBoard({ rq: "hand", icons: { greed: 5 } });
  refused(() => playRaw(none.engine, P1, none.id("rq")), "no [O]");
});

// =================================================================================
// Characters, items and locations are deployed on their controller's own turn only (CR 204.1, 206, 207)
// =================================================================================

/** The card (an ordinary character / item / location with no extra cost) deploys on my turn, never on the opponent's, not even in response. */
function checkOwnTurnDeployOnly(printingId: string): void {
  const board = (active: PlayerId) =>
    buildGame({
      turn: active === P1 ? 1 : 2,
      activePlayerId: active,
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "subject", def: printing(printingId), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        ...res({ obsession: 8 })
      ]
    });
  const own = board(P1);
  playRaw(own.engine, P1, own.id("subject"));
  resolvePendingResponses(own.engine);
  assert.equal(zoneOf(own.engine, own.id("subject")), "play", "my own turn: deployed");
  const theirs = board(P2);
  refused(() => playRaw(theirs.engine, P1, theirs.id("subject")), "the opponent's turn");
  assert.equal(zoneOf(theirs.engine, theirs.id("subject")), "hand");
  theirs.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [theirs.id("foe")], target: { type: "faction", playerId: P1 } });
  theirs.engine.perform({ type: "passPriority", playerId: P2 });
  refused(() => playRaw(theirs.engine, P1, theirs.id("subject")), "not even in response to their attack");
  assert.equal(zoneOf(theirs.engine, theirs.id("subject")), "hand");
}

clause(DEFILER, "0:ability:corrupt", "can be deployed on my own turn but not on the opponent's turn (it is not a tactic and has no TACTICAL)", () => checkOwnTurnDeployOnly(DEFILER));
clause(DENOUNCER, "1:ability:denounce", "can be deployed on my own turn but not on the opponent's turn (it is not a tactic and has no TACTICAL)", () => checkOwnTurnDeployOnly(DENOUNCER));
clause(PRIEST, "0:unique", "can be deployed on my own turn but not on the opponent's turn (it is not a tactic and has no TACTICAL)", () => checkOwnTurnDeployOnly(PRIEST));
clause(BEHEMOTH, "0:rule", "can be deployed on my own turn but not on the opponent's turn (it is not a tactic and has no TACTICAL)", () => checkOwnTurnDeployOnly(BEHEMOTH));
clause(MONKEY, "0:ability:slobber", "can be deployed on my own turn but not on the opponent's turn (it is not a tactic and has no TACTICAL)", () => checkOwnTurnDeployOnly(MONKEY));
clause(ATHENAEUM, "0:unique", "can be deployed on my own turn but not on the opponent's turn (a location is not a tactic)", () => checkOwnTurnDeployOnly(ATHENAEUM));
clause(DOMAIN, "0:rule", "can be deployed on my own turn but not on the opponent's turn (a location is not a tactic)", () => checkOwnTurnDeployOnly(DOMAIN));
clause(RELIQUARY, "0:ability:imbibe", "can be deployed on my own turn but not on the opponent's turn (an item is not a tactic)", () => checkOwnTurnDeployOnly(RELIQUARY));

// =================================================================================
// Printed structure of the two locations (Cryptic Athenaeum 5, Domain of Depravity 3)
// =================================================================================

/** P1 attacks P2's location (printing `locId`) with one character of `strength`; returns where the location ended up. */
function attackLocation(locId: string, strength: number): { zone: string; damage: number } {
  const { engine, id } = buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "loc", def: printing(locId), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength, life: 9, speed: 1 }), owner: P1, zone: "play" }
    ]
  });
  fight(engine, P1, [id("atk")], { type: "card", cardId: id("loc") }, []);
  return { zone: engine.state.cards[id("loc")].zone, damage: engine.state.cards[id("loc")].damage };
}

clause(ATHENAEUM, "0:unique", "has structure 5: 4 damage leaves it in play", () => {
  const result = attackLocation(ATHENAEUM, 4);
  assert.equal(result.zone, "play");
  assert.equal(result.damage, 4);
});
clause(ATHENAEUM, "0:unique", "has structure 5: 5 damage destroys it", () => {
  assert.equal(attackLocation(ATHENAEUM, 5).zone, "discard");
});
clause(DOMAIN, "0:rule", "has structure 3: 2 damage leaves it in play", () => {
  const result = attackLocation(DOMAIN, 2);
  assert.equal(result.zone, "play");
  assert.equal(result.damage, 2);
});
clause(DOMAIN, "0:rule", "has structure 3: 3 damage destroys it", () => {
  assert.equal(attackLocation(DOMAIN, 3).zone, "discard");
});

// =================================================================================
// Threshold paragraphs turn off when the icons are lost (Cryptic Athenaeum)
// =================================================================================

/** A free tactic that destroys one of my own staple resources (id `z`, declaration `t`). */
const razeTactic = () =>
  tactic({
    name: "Raze",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource", controller: "self" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function threshOffBoard(obsession: number, razes: number) {
  const bankCards = bank("obsession", obsession, P1);
  return {
    banks: bankCards,
    game: buildGame({
      turn: 1,
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ath", def: printing(ATHENAEUM), owner: P1, zone: "play" },
        ...Array.from({ length: razes }, (_, i) => ({ key: `raze${i}`, def: razeTactic(), owner: P1, zone: "hand" as const })),
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        ...cards("d", 4, P1, "deck"),
        ...cards("e", 4, P2, "deck"),
        ...cards("oh", 3, P2, "hand"),
        ...bankCards
      ]
    })
  };
}

clause(ATHENAEUM, "1:rule@ooo", "the paragraph turns off the moment I lose an [O]: destroying one of my 3 Obsession resources means no draw offer at my next turn start", () => {
  const { game } = threshOffBoard(3, 1);
  const { engine, id } = game;
  const resourceId = engine.state.players[P1].play.find((c) => engine.isResource(c))!;
  play(engine, P1, id("raze0"), { selected: { t: [resourceId] } });
  assert.equal(zoneOf(engine, resourceId), "discard", "an [O] resource is gone");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined, "only 2 [O] left: no draw offer");
});

clause(ATHENAEUM, "1:rule@ooo", "control: with the same flow but no resource destroyed, the draw offer is made at my next turn start", () => {
  const { game } = threshOffBoard(3, 1);
  const { engine } = game;
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine)?.kind, "chooserSelectsOption");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(ATHENAEUM, "2:rule@ooooo", "the 5-[O] paragraph turns off when I drop to 4 [O] (the 3-[O] paragraph stays on)", () => {
  const { game } = threshOffBoard(5, 1);
  const { engine, id } = game;
  const resourceId = engine.state.players[P1].play.find((c) => engine.isResource(c))!;
  play(engine, P1, id("raze0"), { selected: { t: [resourceId] } });
  endTurn(engine, P1);
  endTurn(engine, P2);
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    return pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc);
  });
  assert.deepEqual(seen, ["p1:chooserSelectsOption"], "only the draw offer: no discard prompt for the opponent");
  assert.equal(handOf(engine, P2).length, 3, "the opponent discarded nothing");
});

// @@APPEND@@
