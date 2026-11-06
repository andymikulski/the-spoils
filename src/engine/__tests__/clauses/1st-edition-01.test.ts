// Clause tests — batch 1st-edition-01. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-01`. Expectations come from each
// card's PRINTED text (1st Edition printing) and RULES.md / the CR; engine data
// is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
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
import { clause, clauseMismatch, declineAll, drain, printing } from "./_clause.js";
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
import { endTurn, factionOf, setupGame, developDrawLeft } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters?.token ?? 0;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (so deck order is top = 0). */
function fillers(prefix: string, n: number, owner: Pid, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));
}

/** The pending choice, loosely typed. */
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string; [k: string]: unknown } | undefined;

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pick(engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** Same as `pick` but WITHOUT draining the response window (for asserting what is true right after the answer). */
function pickRaw(engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
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

/** A strength-debuffing gear item (attach to character, -`amount` strength). */
function weakener(amount: number): CardDefinition {
  return item({
    name: `Weakener${amount}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "weaken", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -amount }] }] }
  });
}

/** A strength-boosting gear item (attach to character, +`amount` strength). */
function booster(amount: number): CardDefinition {
  return item({
    name: `Booster${amount}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });
}

/**
 * P2's turn: P2 declares an attack with `attackerKey` and passes its own priority, so P1 (the defender)
 * may now respond. Returns once it is P1's turn to act in the window.
 */
function openDefenderWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [attackerId], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
}

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- 12 Man Brunch of Doom -----------------------------------------------------
// COST: Pick a number for X. Deplete X characters you control. Pick a character.
// EFFECT: If the picked character has X+X strength or less, destroy it.
// Tactic, cost 2, threshold [O][O].

const BRUNCH = "38205b8d-5512-43c9-b564-2a6877420fae";

function brunchBoard(targetStrength: number, extra: { obsession?: number; greed?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: extra.turn,
    activePlayerId: extra.active,
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "m3", def: character({ name: "Mine3" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: targetStrength, life: 9 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      ...bank("obsession", extra.obsession ?? 5, P1),
      ...bank("greed", extra.greed ?? 0, P1)
    ]
  });
}

for (const [x, strength] of [
  [0, 0],
  [1, 2],
  [2, 4],
  [3, 6]
] as const) {
  clause(BRUNCH, "0:ability", `X=${x}: pays 2, depletes exactly ${x} chosen characters, destroys a character with strength ${strength} (= X+X)`, () => {
    const { engine, id } = brunchBoard(strength);
    const depleted = ["m1", "m2", "m3"].slice(0, x).map(id);
    const before = ready(engine);
    play(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid (X is not paid, only depleted)");
    assert.equal(zoneOf(engine, id("foe")), "discard", "strength X+X: destroyed");
    assert.equal(discardOf(engine, P2).includes(id("foe")), true, "into its owner's discard pile");
    for (const key of ["m1", "m2", "m3"]) {
      assert.equal(isDepleted(engine, id(key)), depleted.includes(id(key)), `${key} depleted only if it was one of the X chosen`);
    }
    assert.equal(zoneOf(engine, id("b")), "discard", "the tactic ends in its owner's discard pile");
    assert.equal(zoneOf(engine, id("bystander")), "play", "an unpicked character is untouched");
  });
}

for (const [x, strength] of [
  [0, 1],
  [1, 3],
  [2, 5],
  [3, 7]
] as const) {
  clause(BRUNCH, "0:ability", `X=${x}: a character with strength ${strength} (> X+X) survives, but the costs are still paid`, () => {
    const { engine, id } = brunchBoard(strength);
    const depleted = ["m1", "m2", "m3"].slice(0, x).map(id);
    const before = ready(engine);
    play(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

    assert.equal(zoneOf(engine, id("foe")), "play", "strength above X+X: not destroyed");
    assert.equal(engine.state.cards[id("foe")].damage ?? 0, 0, "and not damaged either");
    assert.equal(before - ready(engine), 2);
    for (const cardId of depleted) assert.equal(isDepleted(engine, cardId), true);
    assert.equal(zoneOf(engine, id("b")), "discard");
  });
}

clause(BRUNCH, "0:ability", "'X+X strength or less': a character with strength below X+X is destroyed too (strength 1, X=2)", () => {
  const { engine, id } = brunchBoard(1);
  play(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1"), id("m2")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(BRUNCH, "0:ability", "the picked character may be one of your own, even one just depleted for X", () => {
  const { engine, id } = brunchBoard(9);
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("m1")] } });
  assert.equal(zoneOf(engine, id("m1")), "discard");
  assert.equal(zoneOf(engine, id("m2")), "play", "the other characters are untouched");
});

clause(BRUNCH, "0:ability", "the picked character may be one of yours that was NOT depleted (strength 2, X=1)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 2 }), owner: P1, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("weak")] } });
  assert.equal(zoneOf(engine, id("weak")), "discard");
  assert.equal(zoneOf(engine, id("m1")), "play");
  assert.equal(isDepleted(engine, id("m1")), true);
});

clause(BRUNCH, "0:ability", "the strength check uses the character's current strength: a -3 strength item brings 5 down to 2", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 9 }), owner: P2, zone: "play" },
      { key: "weakener", def: weakener(3), owner: P2, zone: "play", attachedToKey: "foe" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the test's weakening item works");
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "current strength 2 <= X+X = 2");
});

clause(BRUNCH, "0:ability", "the strength check uses the character's current strength: a +3 strength item makes 1 into 4, which survives X=1", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "booster", def: booster(3), owner: P2, zone: "play", attachedToKey: "foe" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.equal(engine.getStat(id("foe"), "strength"), 4);
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play", "printed strength 1 would die to X=1, but its current strength 4 > 2");
});

clause(BRUNCH, "0:ability", "the strength check happens when the tactic resolves: a response that pumps the picked character saves it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" },
      ...bank("obsession", 5, P1)
    ]
  });
  playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  playRaw(engine, P2, id("pump"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
  assert.equal(zoneOf(engine, id("foe")), "play", "strength 5 > X+X = 2 at resolution: it survives");
  assert.equal(zoneOf(engine, id("b")), "discard");
});

clause(BRUNCH, "0:ability", "the picked character is destroyed into its OWNER's discard pile, even if you control it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", strength: 1 }), owner: P2, zone: "play", controller: P1 },
      ...bank("obsession", 5, P1)
    ]
  });
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("stolen")), true, "its owner's discard pile");
  assert.equal(discardOf(engine, P1).includes(id("stolen")), false);
});

clause(BRUNCH, "0:ability", "the picked character may be an opponent's character that is already depleted", () => {
  const { engine, id } = brunchBoard(2);
  engine.state.cards[id("foe")].depleted = true;
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(BRUNCH, "0:ability", "the costs are paid when it is played, before the opponent can respond; the destruction waits for resolution", () => {
  const { engine, id } = brunchBoard(2);
  const before = ready(engine);
  playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("b")), "deploying", "being deployed while the opponent may respond");
  assert.equal(before - ready(engine), 2, "the numeric cost is already paid");
  assert.equal(isDepleted(engine, id("m1")), true, "the X depleted characters are already depleted");
  assert.equal(zoneOf(engine, id("foe")), "play", "the effect has not happened yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent has priority to respond");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(BRUNCH, "0:ability", "is refused one resource short of its cost of 2, and nothing is spent or depleted", () => {
  const short = brunchBoard(0, { obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("b"), { variables: { x: 1 }, selected: { depleted: [short.id("m1")], picked: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("b")), "hand", "nothing was played");
  assert.equal(isDepleted(short.engine, short.id("m1")), false, "no character was depleted");
  assert.equal(ready(short.engine), 1, "no resource was spent");

  const exact = brunchBoard(0, { obsession: 2 });
  play(exact.engine, P1, exact.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [exact.id("foe")] } });
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "exactly 2 resources is enough");
});

clause(BRUNCH, "0:ability", "is refused without [O][O] even with enough other resources", () => {
  const noThreshold = brunchBoard(0, { obsession: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [noThreshold.id("foe")] } }));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("b")), "hand");
  const none = brunchBoard(0, { obsession: 0, greed: 5 });
  assert.throws(() => playRaw(none.engine, P1, none.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [none.id("foe")] } }));
  const withThreshold = brunchBoard(0, { obsession: 2, greed: 5 });
  play(withThreshold.engine, P1, withThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [withThreshold.id("foe")] } });
  assert.equal(zoneOf(withThreshold.engine, withThreshold.id("foe")), "discard");
});

clause(BRUNCH, "0:ability", "needs exactly X characters of yours that can be depleted: wrong count, already depleted, or the opponent's are refused", () => {
  const { engine, id } = brunchBoard(0);
  const attempt = (depleted: string[], x = depleted.length) => () =>
    playRaw(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

  assert.throws(attempt([id("m1"), id("m1")]), "cannot deplete the same character twice for X=2");
  assert.throws(attempt([id("bystander")]), "cannot deplete an opponent's character");
  assert.throws(attempt([id("m1")], 2), "X=2 needs two characters depleted");
  assert.throws(attempt([id("m1"), id("m2")], 1), "X=1 needs exactly one character depleted");
  assert.throws(attempt([], 1), "X=1 with nothing depleted");
  assert.throws(attempt([], -1), "X cannot be negative");
  assert.equal(zoneOf(engine, id("b")), "hand", "nothing was played");

  engine.state.cards[id("m1")].depleted = true;
  assert.throws(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m2")], picked: [id("foe")] } });
  assert.equal(isDepleted(engine, id("m2")), true, "a ready character is fine");
});

clause(BRUNCH, "0:ability", "only characters can be depleted for X: an item, a face-down card, a location or a faction is refused", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [cardId], picked: [id("foe")] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("hidden")), "a face-down card is only a resource");
  assert.throws(attempt(factionOf(engine, P1)), "your faction");
  attempt(id("m1"))();
  assert.ok(engine.state.responseWindow, "a ready character is accepted");
});

clause(BRUNCH, "0:ability", "X cannot exceed the number of characters you control", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1")], picked: [id("foe")] } }));
  assert.throws(() => playRaw(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1"), id("foe")], picked: [id("foe")] } }), "the opponent's character cannot fill the gap");
});

clause(BRUNCH, "0:ability", "the picked card must be a character (not an item, a location, a faction, a resource or a face-down card)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...bank("obsession", 5, P1)
    ]
  });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (picked: string) => () => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction cannot be picked (CR 202.9)");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your own faction cannot be picked either");
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("hidden")), "a face-down card is only a resource");
  assert.throws(attempt(id("inHand")), "a card in hand is not in play");
  assert.throws(attempt(id("inDiscard")), "a card in a discard pile is not in play");
  assert.throws(
    () => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [] } }),
    "a pick is required"
  );
  assert.equal(zoneOf(engine, id("b")), "hand", "nothing was played");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

clause(BRUNCH, "0:ability", "exactly one character is picked: two picks are refused", () => {
  const { engine, id } = brunchBoard(0);
  assert.throws(() => playRaw(engine, P1, id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [id("foe"), id("bystander")] } }));
  assert.equal(zoneOf(engine, id("b")), "hand");
});

clause(BRUNCH, "0:ability", "can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("attacker")] } }), "nothing to respond to yet");
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("attacker")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("attacker")), "discard", "strength 2 <= X+X = 2: the attacker is destroyed");
});

// --- Air Travel ------------------------------------------------------------
// COST: Pick a character. EFFECT: This turn, the character gains COVERT. Draw a card.
// Tactic, cost 2, threshold [O].

const AIR_TRAVEL = "c45a94f4-651e-43c0-9472-f5d8f48725f3";

function airTravelBoard(opts: { obsession?: number; greed?: number; turn?: number } = {}) {
  return buildGame({
    turn: opts.turn ?? 1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "a2", def: character({ name: "A2" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" },
      { key: "b2", def: character({ name: "B2" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(AIR_TRAVEL, "0:ability", "pays 2, gives the picked character COVERT and no other character, then its controller draws a card", () => {
  const { engine, id } = airTravelBoard();
  const before = ready(engine);
  const topOfDeck = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });

  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "the picked character gains COVERT");
  assert.equal(hasKeyword(engine, id("other"), "covert"), false, "another of your characters does not");
  assert.equal(hasKeyword(engine, id("foe"), "covert"), false, "an opponent's character does not");
  assert.equal(zoneOf(engine, id("at")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "draws exactly one card (Air Travel left the hand, one card arrived)");
  assert.equal(zoneOf(engine, topOfDeck), "hand", "the drawn card is the top card of the deck");
  assert.equal(deckOf(engine, P1).length, 1);
});

clause(AIR_TRAVEL, "0:ability", "can pick an opponent's character: it gains COVERT, and the tactic's controller (not the picked character's) draws", () => {
  const { engine, id } = airTravelBoard();
  const p1Hand = handOf(engine, P1).length;
  const p2Hand = handOf(engine, P2).length;
  play(engine, P1, id("at"), { selected: { target: [id("foe")] } });

  assert.ok(hasKeyword(engine, id("foe"), "covert"), "hasKeyword(engine, id(\"foe\"), \"covert\")");
  assert.equal(handOf(engine, P1).length, p1Hand - 1 + 1, "the controller drew");
  assert.equal(handOf(engine, P2).length, p2Hand, "the opponent did not");
  assert.equal(deckOf(engine, P2).length, 2, "the opponent's deck is untouched");
});

clause(AIR_TRAVEL, "0:ability", "the character is covert for real: a party of only it cannot be blocked by a non-covert character", () => {
  const withoutIt = airTravelBoard({ turn: 2 });
  declareAttackBy(withoutIt.engine, P1, [withoutIt.id("mine")]);
  withoutIt.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [withoutIt.id("foe")] });
  assert.deepEqual(battleOf(withoutIt.engine)?.blockingParty, [withoutIt.id("foe")], "control: with no COVERT a plain character can block");

  const { engine, id } = airTravelBoard({ turn: 2 });
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  declareAttackBy(engine, P1, [id("mine")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] }), "a non-covert character cannot block a covert party");
});

clause(AIR_TRAVEL, "0:ability", "COVERT lasts this turn only: it is gone once the turn ends", () => {
  const { engine, id } = airTravelBoard();
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "granted this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(hasKeyword(engine, id("mine"), "covert"), false, "gone when the turn ends");
  endTurn(engine, P2);
  assert.equal(hasKeyword(engine, id("mine"), "covert"), false, "and still gone on its controller's next turn");
});

clause(AIR_TRAVEL, "0:ability", "played during the opponent's turn the COVERT lasts until the end of that turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "can be played in response on the opponent's turn");
  assert.equal(zoneOf(engine, id("a1")), "hand", "and still draws");
});

clause(AIR_TRAVEL, "0:ability", "is refused one resource short of its cost of 2, and without [O]", () => {
  const short = airTravelBoard({ obsession: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("at"), { selected: { target: [short.id("mine")] } }));
  assert.equal(zoneOf(short.engine, short.id("at")), "hand");

  const noThreshold = airTravelBoard({ obsession: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("at"), { selected: { target: [noThreshold.id("mine")] } }));

  const exact = airTravelBoard({ obsession: 2 });
  play(exact.engine, P1, exact.id("at"), { selected: { target: [exact.id("mine")] } });
  assert.ok(hasKeyword(exact.engine, exact.id("mine"), "covert"), "[O] and exactly 2 resources is enough");

  const mixed = airTravelBoard({ obsession: 1, greed: 1 });
  play(mixed.engine, P1, mixed.id("at"), { selected: { target: [mixed.id("mine")] } });
  assert.ok(hasKeyword(mixed.engine, mixed.id("mine"), "covert"), "one [O] and one other resource pay for it");
});

clause(AIR_TRAVEL, "0:ability", "the picked card must be a character (not an item, a location, a faction, a resource or a face-down card)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("thing")] } }), "item");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("place")] } }), "location");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [factionOf(engine, P1)] } }), "faction");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [factionOf(engine, P2)] } }), "opposing faction");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [resourceId] } }), "face-up resource");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("hidden")] } }), "a face-down card is only a resource");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [id("inHand")] } }), "a character in hand is not in play");
  assert.throws(() => playRaw(engine, P1, id("at"), { selected: { target: [] } }), "a pick is required");
  assert.equal(zoneOf(engine, id("at")), "hand", "nothing was played");
  playRaw(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

clause(AIR_TRAVEL, "0:ability", "a character that is already depleted can be picked and gains COVERT", () => {
  const { engine, id } = airTravelBoard();
  engine.state.cards[id("mine")].depleted = true;
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "hasKeyword(engine, id(\"mine\"), \"covert\")");
});

clause(AIR_TRAVEL, "0:ability", "with an empty deck the character still gains COVERT and the tactic resolves", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "hasKeyword(engine, id(\"mine\"), \"covert\")");
  assert.equal(zoneOf(engine, id("at")), "discard");
  assert.equal(handOf(engine, P1).length, 0, "nothing to draw");
});

clause(AIR_TRAVEL, "0:ability", "the card is drawn as part of the effect, after the cost is paid and when the tactic resolves (not while the opponent can still respond)", () => {
  const { engine, id } = airTravelBoard();
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("at"), { selected: { target: [id("mine")] } });
  assert.equal(handOf(engine, P1).length, handBefore - 1, "Air Travel left the hand and nothing has been drawn yet");
  assert.equal(hasKeyword(engine, id("mine"), "covert"), false, "no COVERT yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore, "drawn once it resolves");
  assert.ok(hasKeyword(engine, id("mine"), "covert"), "hasKeyword(engine, id(\"mine\"), \"covert\")");
});

// --- Ambiguity Inhibitor -----------------------------------------------------
// At the start of your turn, you must put a card from your hand on the bottom of
// your deck if you can. If you do, draw a card. Item, cost 2, threshold [O][O].

const INHIBITOR = "79c18527-acfe-4e19-b390-0ea2cafcad19";

function inhibitorBoard(opts: { hand?: number; deck?: number; controller?: Pid; zone?: "play" | "hand"; startActive?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.startActive ?? P2,
    cards: [
      { key: "ai", def: printing(INHIBITOR), owner: P1, zone: opts.zone ?? "play", controller: opts.controller },
      ...fillers("h", opts.hand ?? 2, P1, "hand"),
      ...fillers("d", opts.deck ?? 3, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...fillers("od", 3, P2, "deck")
    ]
  });
}

/** Ends P2's turn so that P1's turn starts; answers P1's bottom-a-card choice with `bottomKey` (if any). */
function inhibitorTurn(b: ReturnType<typeof inhibitorBoard>, bottomKey: string | undefined): void {
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "P1's turn has started");
  if (bottomKey !== undefined) {
    const pc = pending(b.engine);
    assert.ok(pc, "the Inhibitor asks for a card");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "its controller chooses");
    pick(b.engine, P1, [b.id(bottomKey)]);
  }
}

clause(INHIBITOR, "0:rule", "at the start of your turn a card of your hand goes on the BOTTOM of your deck, then you draw a card (the top one)", () => {
  const b = inhibitorBoard({ hand: 2, deck: 3 });
  const deckBefore = [...deckOf(b.engine, P1)];
  const handBefore = [...handOf(b.engine, P1)];
  inhibitorTurn(b, "h1");
  assert.equal(zoneOf(b.engine, b.id("h1")), "deck", "the chosen card left the hand for the deck");
  assert.deepEqual(deckOf(b.engine, P1), [...deckBefore.slice(1), b.id("h1")], "it is on the bottom; the old top card was drawn");
  assert.equal(zoneOf(b.engine, deckBefore[0]), "hand", "the card drawn is the old top card, not the card just bottomed");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [handBefore[0], deckBefore[0]].sort(), "hand: one card out, one in");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(INHIBITOR, "0:rule", "you choose which card of your hand goes to the bottom (either card can be chosen)", () => {
  for (const key of ["h0", "h1"]) {
    const b = inhibitorBoard({ hand: 2, deck: 3 });
    inhibitorTurn(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "deck", `${key} was chosen`);
    const keep = key === "h0" ? "h1" : "h0";
    assert.equal(zoneOf(b.engine, b.id(keep)), "hand", `${keep} stays in hand`);
  }
});

clause(INHIBITOR, "0:rule", "only a card of YOUR hand can be chosen: the opponent's hand, cards in play and cards in the discard pile are refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ai", def: printing(INHIBITOR), owner: P1, zone: "play" },
      { key: "h0", def: character({ name: "H0" }), owner: P1, zone: "hand" },
      { key: "oh0", def: character({ name: "OH0" }), owner: P2, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  endTurn(b.engine, P2);
  const attempt = (key: string) => () => pickRaw(b.engine, P1, [b.id(key)]);
  assert.throws(attempt("oh0"), "the opponent's hand");
  assert.throws(attempt("inPlay"), "a card in play");
  assert.throws(attempt("inDiscard"), "a card in the discard pile");
  assert.throws(attempt("d0"), "a card already in the deck");
  attempt("h0")();
  assert.equal(zoneOf(b.engine, b.id("h0")), "deck");
  assert.equal(zoneOf(b.engine, b.id("oh0")), "hand", "the opponent's hand is untouched");
});

clause(INHIBITOR, "0:rule", "exactly one card is put on the bottom: two cards at once are refused", () => {
  const b = inhibitorBoard({ hand: 3, deck: 3 });
  endTurn(b.engine, P2);
  assert.throws(() => pickRaw(b.engine, P1, [b.id("h0"), b.id("h1")]));
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
});

clause(INHIBITOR, "0:rule", "'you MUST put a card ... if you can': with a card in hand, picking nothing is refused", () => {
  const b = inhibitorBoard({ hand: 2, deck: 3 });
  endTurn(b.engine, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "the Inhibitor asks for a card");
  assert.throws(() => pickRaw(b.engine, P1, []), "declining is not allowed while you have a card in hand");
});

clause(INHIBITOR, "0:rule", "with an empty hand there is nothing to put on the bottom, so you do not draw either ('if you do')", () => {
  const b = inhibitorBoard({ hand: 0, deck: 3 });
  const deckBefore = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore, "the deck is unchanged");
  assert.equal(handOf(b.engine, P1).length, 0, "and no card was drawn");
});

clause(INHIBITOR, "0:rule", "a one-card hand: that card goes under the deck and the draw takes the top card", () => {
  const b = inhibitorBoard({ hand: 1, deck: 3 });
  const deckBefore = [...deckOf(b.engine, P1)];
  inhibitorTurn(b, "h0");
  assert.deepEqual(handOf(b.engine, P1), [deckBefore[0]]);
  assert.deepEqual(deckOf(b.engine, P1), [...deckBefore.slice(1), b.id("h0")]);
});

clause(INHIBITOR, "0:rule", "with an empty deck the card goes to the bottom (the deck's only card) and the draw takes it right back", () => {
  const b = inhibitorBoard({ hand: 2, deck: 0 });
  inhibitorTurn(b, "h0");
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand", "put on the bottom of an empty deck, then drawn again");
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(handOf(b.engine, P1).length, 2);
});

clause(INHIBITOR, "0:rule", "it triggers only at the start of YOUR turn, not at the start of the opponent's", () => {
  const b = inhibitorBoard({ hand: 2, deck: 3, startActive: P1 });
  const handBefore = [...handOf(b.engine, P1)];
  const deckBefore = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "it is the opponent's turn");
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice is offered");
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(INHIBITOR, "0:rule", "it triggers at the start of every one of your turns", () => {
  const b = inhibitorBoard({ hand: 2, deck: 4, startActive: P1 });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "first turn");
  pick(b.engine, P1, [b.id("h0")]);
  assert.equal(zoneOf(b.engine, b.id("h0")), "deck");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "second turn too");
  const h = handOf(b.engine, P1);
  pick(b.engine, P1, [h[0]]);
  assert.equal(zoneOf(b.engine, h[0]), "deck");
});

clause(INHIBITOR, "0:rule", "'your turn' is the controller's turn: an Inhibitor controlled by the opponent works on the opponent's turn and bottoms THEIR hand", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ai", def: printing(INHIBITOR), owner: P1, zone: "play", controller: P2 },
      ...fillers("h", 2, P1, "hand"),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...fillers("od", 3, P2, "deck")
    ]
  });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "P2 controls the Inhibitor, so P2's turn start triggers it");
  assert.equal(pc.playerId, P2);
  const p1Hand = [...handOf(b.engine, P1)];
  pick(b.engine, P2, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "deck");
  assert.deepEqual(handOf(b.engine, P1), p1Hand, "its owner's hand is untouched");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "at the start of its owner's own turn it does nothing");
});

clause(INHIBITOR, "0:rule", "only while in play: an Inhibitor in your hand does nothing at the start of your turn", () => {
  const b = inhibitorBoard({ zone: "hand", hand: 2, deck: 3 });
  const deckBefore = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(INHIBITOR, "0:rule", "stops once it leaves play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ai", def: printing(INHIBITOR), owner: P1, zone: "play" },
      { key: "killer", def: tactic({ name: "ItemKiller", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" },
      ...fillers("h", 2, P1, "hand"),
      ...fillers("d", 3, P1, "deck")
    ]
  });
  play(b.engine, P2, b.id("killer"), { selected: { t: [b.id("ai")] } });
  assert.equal(zoneOf(b.engine, b.id("ai")), "discard");
  const deckBefore = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(INHIBITOR, "0:rule", "two Inhibitors each trigger: two cards go to the bottom and two cards are drawn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ai1", def: printing(INHIBITOR), owner: P1, zone: "play" },
      { key: "ai2", def: printing(INHIBITOR), owner: P1, zone: "play" },
      ...fillers("h", 3, P1, "hand"),
      ...fillers("d", 5, P1, "deck")
    ]
  });
  const deckBefore = [...deckOf(b.engine, P1)];
  endTurn(b.engine, P2);
  let bottomed = 0;
  let guard = 0;
  while (b.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(b.engine)!;
    if (pc.kind === "orderTriggers") {
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    } else {
      assert.equal(pc.kind, "chooserSelectsTarget");
      const hand = handOf(b.engine, P1).filter((c) => ["h0", "h1", "h2"].some((k) => b.id(k) === c));
      pick(b.engine, P1, [hand[0]]);
      bottomed++;
    }
  }
  assert.equal(bottomed, 2, "each Inhibitor makes you bottom a card");
  assert.equal(handOf(b.engine, P1).length, 3, "two out, two in");
  assert.equal(deckOf(b.engine, P1).length, 5);
  assert.equal(zoneOf(b.engine, deckBefore[0]), "hand", "two draws, the two cards that were on top");
  assert.equal(zoneOf(b.engine, deckBefore[1]), "hand");
});

// --- Arcana Department -----------------------------------------------------
// When an attacking or blocking party is formed, it must have an even number of
// members. Location, cost 3, threshold [O][O][O], structure 5.

const DEPARTMENT = "82140619-051c-418a-88dc-f4fad30e0d9f";

function departmentBoard(opts: { departmentIn?: boolean; controller?: Pid; zone?: "play" | "hand"; faceDown?: boolean; chars?: number } = {}) {
  const n = opts.chars ?? 6;
  const names = Array.from({ length: n }, (_, i) => i + 1);
  const dept =
    opts.departmentIn === false ? [] : [{ key: "dept", def: printing(DEPARTMENT), owner: opts.controller ?? P1, zone: (opts.zone ?? "play") as "play" | "hand", faceDown: opts.faceDown }];
  return buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      ...dept,
      ...names.map((i) => ({ key: `a${i}`, def: character({ name: `a${i}`, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const })),
      ...names.map((i) => ({ key: `b${i}`, def: character({ name: `b${i}`, strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const }))
    ]
  });
}

const attackWith = (engine: SpoilsEngine, ids: string[]) =>
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids, target: { type: "faction", playerId: P2 } });

clause(DEPARTMENT, "0:rule", "an attacking party must have an even number of members (1, 3 and 5 refused; 2, 4 and 6 allowed)", () => {
  for (const [size, legal] of [
    [1, false],
    [2, true],
    [3, false],
    [4, true],
    [5, false],
    [6, true]
  ] as const) {
    const { engine, id } = departmentBoard();
    const party = ["a1", "a2", "a3", "a4", "a5", "a6"].slice(0, size).map(id);
    if (legal) {
      attackWith(engine, party);
      assert.deepEqual([...(battleOf(engine)?.attackingParty ?? [])].sort(), [...party].sort(), `${size} attackers is legal`);
    } else {
      assert.throws(() => attackWith(engine, party), `${size} attackers is refused`);
      assert.equal(battleOf(engine), undefined, "no battle started");
      for (const cardId of party) assert.equal(isDepleted(engine, cardId), false, "and nobody was depleted by the refused attack");
    }
  }
});

clause(DEPARTMENT, "0:rule", "without the Department an odd attacking party is fine", () => {
  for (const size of [1, 3]) {
    const { engine, id } = departmentBoard({ departmentIn: false });
    const party = ["a1", "a2", "a3"].slice(0, size).map(id);
    attackWith(engine, party);
    assert.deepEqual([...(battleOf(engine)?.attackingParty ?? [])].sort(), [...party].sort());
  }
});

clause(DEPARTMENT, "0:rule", "a blocking party must have an even number of members (1, 3 and 5 refused; 2, 4 and 6 allowed)", () => {
  for (const [size, legal] of [
    [1, false],
    [2, true],
    [3, false],
    [4, true],
    [5, false],
    [6, true]
  ] as const) {
    const { engine, id } = departmentBoard();
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    const blockers = ["b1", "b2", "b3", "b4", "b5", "b6"].slice(0, size).map(id);
    if (legal) {
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
      assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [...blockers].sort(), `${size} blockers is legal`);
    } else {
      assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers }), `${size} blockers is refused`);
    }
  }
});

clause(DEPARTMENT, "0:rule", "declaring no blockers is still allowed (there is no blocking party to be odd)", () => {
  const { engine, id } = departmentBoard();
  attackWith(engine, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(DEPARTMENT, "0:rule", "without the Department an odd blocking party is fine", () => {
  for (const size of [1, 3]) {
    const { engine, id } = departmentBoard({ departmentIn: false });
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    const blockers = ["b1", "b2", "b3"].slice(0, size).map(id);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
    assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [...blockers].sort());
  }
});

clause(DEPARTMENT, "0:rule", "applies to both players' parties, whoever controls the Department", () => {
  for (const controller of [P1, P2] as const) {
    const { engine, id } = departmentBoard({ controller });
    assert.throws(() => attackWith(engine, [id("a1")]), `P1's odd attack is refused (Department controlled by ${controller})`);
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] }), `P2's odd block is refused (Department controlled by ${controller})`);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("b1"), id("b2")].sort());
  }
});

clause(DEPARTMENT, "0:rule", "the parity of one side does not depend on the other: 2 attackers may face 4 blockers, and 4 attackers 2 blockers", () => {
  for (const [attackers, blockers] of [
    [2, 4],
    [4, 2]
  ] as const) {
    const { engine, id } = departmentBoard();
    attackWith(engine, ["a1", "a2", "a3", "a4"].slice(0, attackers).map(id));
    resolvePendingResponses(engine);
    const party = ["b1", "b2", "b3", "b4"].slice(0, blockers).map(id);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: party });
    assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [...party].sort());
  }
});

clause(DEPARTMENT, "0:rule", "stops applying once the Department leaves play", () => {
  const smash = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "raze", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "raze", def: smash, owner: P1, zone: "hand" },
      { key: "dept", def: printing(DEPARTMENT), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "a1", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.throws(() => attackWith(engine, [id("a1")]), "refused while the Department stands");
  play(engine, P1, id("raze"), { selected: { t: [id("dept")] } });
  assert.equal(zoneOf(engine, id("dept")), "discard");
  attackWith(engine, [id("a1")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a1")], "an odd party is legal again");
});

clause(DEPARTMENT, "0:rule", "a Department in your hand has no effect", () => {
  const { engine, id } = departmentBoard({ zone: "hand" });
  attackWith(engine, [id("a1")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a1")], "an odd attacking party is legal");
});

clause(DEPARTMENT, "0:rule", "a face-down Department is only a resource and has no effect", () => {
  const { engine, id } = departmentBoard({ faceDown: true });
  attackWith(engine, [id("a1")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a1")]);
});

clause(DEPARTMENT, "0:rule", "damage to the Department does not turn it off while it stands (structure 5)", () => {
  const { engine, id } = departmentBoard();
  engine.state.cards[id("dept")].damage = 4;
  assert.equal(zoneOf(engine, id("dept")), "play");
  assert.throws(() => attackWith(engine, [id("a1")]));
});

clause(DEPARTMENT, "0:rule", "a party of the same side is judged when it forms: the attacker's even party of 2 may later lose a member without breaking the battle", () => {
  const { engine, id } = departmentBoard();
  attackWith(engine, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
  assert.equal(battleOf(engine)?.blockingParty.length, 2);
});

// --- Arcana Experiment -----------------------------------------------------
// COST: Play this only if you have at least 5 cards in your deck. Deplete up to 5
// characters you control. X is the number of characters you deplete.
// EFFECT: Search your deck for 5 cards and reveal them. Your opponent picks X of
// those cards. Put the picked cards into your hand and the rest into your discard pile.
// Tactic, cost 7, threshold [O][O][O][O].

const EXPERIMENT = "1d8d7483-283a-45d5-b04f-5edaf7c9fe78";

function experimentBoard(opts: { deck?: number; chars?: number; obsession?: number; greed?: number; oppDeck?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.chars ?? 6 }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1, zone: "play" as const })),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: opts.deck ?? 8 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.oppDeck ?? 8 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const FOUND = ["d1", "d3", "d4", "d6", "d7"]; // five cards of the searched deck, deliberately not the top five

/**
 * Plays Arcana Experiment. Only "Deplete up to 5 characters" is in the COST (`selected.depleted`); "Search your deck
 * for 5 cards" is the EFFECT, so the caster chooses `selected.found` when the tactic resolves (E3b).
 */
function playAe(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, opts: { selected: { depleted?: CardInstanceId[]; found?: CardInstanceId[] } }): void {
  const { found, ...atPlay } = opts.selected;
  play(engine, player, cardId, { selected: atPlay });
  if (found && pending(engine)?.kind === "chooserSelectsTarget" && pending(engine)?.playerId === player) pick(engine, player, found);
}

for (let x = 0; x <= 5; x++) {
  clause(EXPERIMENT, "0:ability", `X=${x}: pays 7, depletes ${x} characters, reveals 5 searched cards, the opponent picks ${x} of them for your hand and the other ${5 - x} go to your discard pile`, () => {
    const { engine, id } = experimentBoard();
    const depleted = ["m0", "m1", "m2", "m3", "m4"].slice(0, x).map(id);
    const found = FOUND.map(id);
    const before = ready(engine);
    const handBefore = [...handOf(engine, P1)];
    const deckBefore = [...deckOf(engine, P1)];
    const oppDeckBefore = [...deckOf(engine, P2)];
    const oppHandBefore = [...handOf(engine, P2)];

    playAe(engine, P1, id("ae"), { selected: { depleted, found } });

    assert.equal(before - ready(engine), 7, "the printed cost of 7 is paid");
    for (const key of ["m0", "m1", "m2", "m3", "m4", "m5"]) {
      assert.equal(isDepleted(engine, id(key)), depleted.includes(id(key)), `${key}: depleted only if chosen for X`);
    }
    const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
    assert.equal(reveals.length, 1, "the 5 searched cards are revealed once");
    const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
    assert.deepEqual([...ev.cardIds].sort(), [...found].sort(), "exactly the searched cards are revealed");
    assert.equal(ev.viewerId, "all", "revealed to everyone");

    const pc = pending(engine);
    const picked = found.slice(0, x);
    if (x === 0 && !pc) {
      // nothing to pick for X=0: the engine may skip the prompt
    } else {
      assert.ok(pc, "the opponent is asked to pick");
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P2, "your OPPONENT picks");
      pick(engine, P2, picked);
    }
    assert.equal(engine.state.pendingChoice, undefined);

    for (const cardId of picked) assert.equal(zoneOf(engine, cardId), "hand", "a picked card goes to your hand");
    for (const cardId of found.slice(x)) assert.equal(zoneOf(engine, cardId), "discard", "an unpicked searched card goes to your discard pile");
    assert.deepEqual([...handOf(engine, P1)].sort(), [...handBefore.filter((c) => c !== id("ae")), ...picked].sort(), "the hand gains exactly the picked cards");
    assert.equal(discardOf(engine, P1).filter((c) => c !== id("ae")).length, 5 - x, "exactly the unpicked cards are discarded (plus the tactic itself)");
    const unsearched = deckBefore.filter((c) => !found.includes(c));
    assert.deepEqual([...deckOf(engine, P1)].sort(), [...unsearched].sort(), "the rest of the deck stays in the deck");
    assert.deepEqual(deckOf(engine, P2), oppDeckBefore, "the opponent's deck is untouched");
    assert.deepEqual(handOf(engine, P2), oppHandBefore, "the opponent's hand is untouched");
    assert.equal(zoneOf(engine, id("ae")), "discard", "the tactic ends in your discard pile");
  });
}

clause(EXPERIMENT, "0:ability", "the opponent chooses WHICH of the searched cards you get: a different pick gives a different hand", () => {
  const { engine, id } = experimentBoard();
  const found = FOUND.map(id);
  playAe(engine, P1, id("ae"), { selected: { depleted: [id("m0"), id("m1")], found } });
  pick(engine, P2, [id("d6"), id("d7")]);
  assert.equal(zoneOf(engine, id("d6")), "hand");
  assert.equal(zoneOf(engine, id("d7")), "hand");
  for (const key of ["d1", "d3", "d4"]) assert.equal(zoneOf(engine, id(key)), "discard", key);
});

clause(EXPERIMENT, "0:ability", "the opponent must pick exactly X of the searched cards: too few, too many or a card that was not searched is refused", () => {
  const attempt = (selected: string[]) => {
    const { engine, id } = experimentBoard();
    playAe(engine, P1, id("ae"), { selected: { depleted: ["m0", "m1"].map(id), found: FOUND.map(id) } });
    const names = selected.map((key) => id(key));
    return () => pickRaw(engine, P2, names);
  };
  assert.throws(attempt(["d1"]), "X=2: one card is too few");
  assert.throws(attempt([]), "X=2: no cards");
  assert.throws(attempt(["d1", "d3", "d4"]), "X=2: three cards is too many");
  assert.throws(attempt(["d1", "d0"]), "X=2: d0 was not one of the searched cards");
  assert.throws(attempt(["d1", "d1"]), "X=2: the same card twice");
  attempt(["d1", "d3"])();
});

clause(EXPERIMENT, "0:ability", "only the opponent picks: the caster cannot answer the pick for them", () => {
  const { engine, id } = experimentBoard();
  playAe(engine, P1, id("ae"), { selected: { depleted: ["m0"].map(id), found: FOUND.map(id) } });
  assert.throws(() => pickRaw(engine, P1, [id("d1")]), "the caster is not the chooser");
  pick(engine, P2, [id("d1")]);
  assert.equal(zoneOf(engine, id("d1")), "hand");
});

clause(EXPERIMENT, "0:ability", "the deck is shuffled afterwards (CR 312.1: a searched deck is shuffled)", () => {
  const { engine, id } = experimentBoard({ deck: 10, random: () => 0 });
  const found = ["d2", "d3", "d4", "d5", "d6"].map(id);
  const remaining = deckOf(engine, P1).filter((c) => !found.includes(c));
  playAe(engine, P1, id("ae"), { selected: { depleted: [id("m0")], found } });
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [found[0]] } : declineAll(pc)));
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...remaining].sort(), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(remaining, 0), "and they were shuffled");
});

clause(EXPERIMENT, "0:ability", "is refused with 4 cards in your deck (your opponent's deck and your hand do not count) and allowed with exactly 5", () => {
  const four = experimentBoard({ deck: 4, oppDeck: 12 });
  assert.throws(() => playRaw(four.engine, P1, four.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3"].map(four.id) } }), "4 cards: refused even if the opponent has 12");
  assert.equal(zoneOf(four.engine, four.id("ae")), "hand");
  assert.equal(four.engine.getCardPlayability(P1, four.id("ae")).playable, false, "not playable with 4 cards in the deck, though the cost and threshold are met");
  assert.equal(ready(four.engine), 8, "nothing was paid");

  const zero = experimentBoard({ deck: 0, oppDeck: 12 });
  assert.equal(zero.engine.getCardPlayability(P1, zero.id("ae")).playable, false, "an empty deck");

  const five = experimentBoard({ deck: 5 });
  assert.equal(five.engine.getCardPlayability(P1, five.id("ae")).playable, true, "playable with exactly 5 cards in the deck");
  playAe(five.engine, P1, five.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3", "d4"].map(five.id) } });
  drain(five.engine, declineAll);
  assert.equal(zoneOf(five.engine, five.id("d0")), "discard", "exactly 5 cards in the deck is enough (X=0: all five are discarded)");
  assert.equal(deckOf(five.engine, P1).length, 0, "the whole deck was searched");

  const six = experimentBoard({ deck: 6 });
  assert.equal(six.engine.getCardPlayability(P1, six.id("ae")).playable, true);
});

clause(EXPERIMENT, "0:ability", "is refused one resource short of its cost of 7, and without [O][O][O][O]", () => {
  const short = experimentBoard({ obsession: 6 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ae"), { selected: { depleted: [], found: FOUND.map(short.id) } }));
  assert.equal(short.engine.getCardPlayability(P1, short.id("ae")).playable, false);

  const noThreshold = experimentBoard({ obsession: 3, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ae"), { selected: { depleted: [], found: FOUND.map(noThreshold.id) } }), "only three [O]");
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("ae")).playable, false);

  const exact = experimentBoard({ obsession: 7 });
  playAe(exact.engine, P1, exact.id("ae"), { selected: { depleted: [], found: FOUND.map(exact.id) } });
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("ae")), "discard");
  const fourO = experimentBoard({ obsession: 4, greed: 3 });
  playAe(fourO.engine, P1, fourO.id("ae"), { selected: { depleted: [], found: FOUND.map(fourO.id) } });
  drain(fourO.engine, declineAll);
  assert.equal(zoneOf(fourO.engine, fourO.id("ae")), "discard", "four [O] plus three other resources is enough");
});

clause(EXPERIMENT, "0:ability", "you may deplete at most 5 characters, only your own, only ones not already depleted", () => {
  const { engine, id } = experimentBoard({ chars: 7 });
  const attempt = (depleted: string[]) => () => playRaw(engine, P1, id("ae"), { selected: { depleted, found: FOUND.map(id) } });
  assert.throws(attempt(["m0", "m1", "m2", "m3", "m4", "m5"].map(id)), "six characters is more than 'up to 5'");
  assert.throws(attempt([id("foe")]), "an opponent's character cannot be depleted");
  assert.throws(attempt(["m0", "m0"].map(id)), "the same character twice");
  engine.state.cards[id("m1")].depleted = true;
  assert.throws(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
  assert.throws(attempt([id("h1")]), "a card in hand is not a character you control in play");
  assert.equal(zoneOf(engine, id("ae")), "hand", "nothing was played");
  attempt(["m0", "m2", "m3", "m4", "m5"].map(id))();
  assert.ok(engine.state.responseWindow, "five ready characters of your own is accepted");
});

clause(EXPERIMENT, "0:ability", "only characters can be depleted for X: an item, a face-down card or a faction is refused", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "m0", def: character({ name: "M0" }), owner: P1, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", 8, P1)
    ]
  });
  const found = ["d0", "d1", "d2", "d3", "d4"].map(id);
  const attempt = (depleted: string[]) => () => playRaw(engine, P1, id("ae"), { selected: { depleted, found } });
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([factionOf(engine, P1)]), "your faction");
  attempt([id("m0")])();
  assert.equal(isDepleted(engine, id("m0")), true);
});

clause(EXPERIMENT, "0:ability", "the depleting is part of the cost: it is done as soon as the tactic is played, before the opponent responds", () => {
  const { engine, id } = experimentBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("ae"), { selected: { depleted: ["m0", "m1", "m2"].map(id), found: FOUND.map(id) } });
  assert.equal(zoneOf(engine, id("ae")), "deploying");
  assert.equal(before - ready(engine), 7, "cost paid");
  for (const key of ["m0", "m1", "m2"]) assert.equal(isDepleted(engine, id(key)), true, key);
  for (const cardId of FOUND.map(id)) assert.equal(zoneOf(engine, cardId), "deck", "the search itself waits for resolution");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(EXPERIMENT, "0:ability", "the 5 searched cards must come from your own deck, and be 5 distinct cards", () => {
  // "Search your deck for 5 cards" is the EFFECT: the caster chooses them when the tactic resolves (E3b), and a bad answer leaves the search open.
  const { engine, id } = experimentBoard();
  play(engine, P1, id("ae"), { selected: { depleted: [id("m0")] } });
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is open");
  assert.equal(pending(engine)?.playerId, P1);
  const attempt = (found: string[]) => () => pickRaw(engine, P1, found.map(id));
  assert.throws(attempt(["d0", "d1", "d2", "d3", "e0"]), "a card from the opponent's deck");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "h1"]), "a card from your hand");
  assert.throws(attempt(["d0", "d1", "d2", "d3"]), "only four cards");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "d4", "d5"]), "six cards");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "d3"]), "the same card twice");
  assert.throws(attempt(["d0", "d1", "d2", "d3", "m0"]), "a card in play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "every bad answer left the search open");
  attempt(["d0", "d1", "d2", "d3", "d4"])();
  assert.equal(pending(engine)?.playerId, P2, "a good answer moves on to the opponent's choice");
});

clause(EXPERIMENT, "0:ability", "the search is part of the EFFECT: the tactic can be played with the cards not yet chosen, and the five cards are searched for when it resolves", () => {
  const { engine, id } = experimentBoard();
  playRaw(engine, P1, id("ae"), { selected: { depleted: [id("m0")] } });
  assert.ok(engine.state.responseWindow, "played and paid for, with no card chosen yet");
  for (const key of FOUND) assert.equal(zoneOf(engine, id(key)), "deck");
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "when it resolves I search my deck");
  assert.equal(pc.playerId, P1, "I am the one who searches");
  pick(engine, P1, FOUND.map(id));
  pick(engine, P2, [id("d1")]);
  assert.equal(zoneOf(engine, id("d1")), "hand");
  assert.equal(zoneOf(engine, id("d3")), "discard");
});

clause(EXPERIMENT, "0:ability", "the searched cards need not be the top five: any five cards of the deck can be found", () => {
  const { engine, id } = experimentBoard({ deck: 10 });
  const found = ["d5", "d6", "d7", "d8", "d9"].map(id);
  playAe(engine, P1, id("ae"), { selected: { depleted: [id("m0")], found } });
  pick(engine, P2, [id("d9")]);
  assert.equal(zoneOf(engine, id("d9")), "hand");
  for (const key of ["d5", "d6", "d7", "d8"]) assert.equal(zoneOf(engine, id(key)), "discard", key);
  for (const key of ["d0", "d1", "d2", "d3", "d4"]) assert.equal(zoneOf(engine, id(key)), "deck", `${key} was never searched`);
});

// --- Degenerate Molestation --------------------------------------------------
// Your opponent cannot respond to this card.
// Your opponent must discard a card. You may play a non-resource card with numeric
// cost X or less for free, where X is the numeric cost of the discarded card. (You
// still need the proper resource icons and must pay any additional costs.)
// Repeat this until your opponent has no cards in their hand.
// Tactic, cost 10, threshold [O][O][O][O].

const MOLESTATION = "d0f8ae01-7941-4b39-9292-1ad30f8eec9d";

type Def = CardDefinition;

function molestationBoard(p1Hand: Def[], p2Hand: Def[], opts: { obsession?: number; greed?: number; extra?: CardPlacement[]; oppDeck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
      ...p1Hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...p2Hand.map((def) => ({ key: `o:${def.name}`, def, owner: P2, zone: "hand" as const })),
      ...["x1", "x2", "x3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...fillers("e", opts.oppDeck ?? 0, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** What the free-play prompt currently offers P1, as card names. */
function offered(engine: SpoilsEngine): string[] {
  const pc = pending(engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "deployForFree", "P1 is asked whether to play a card for free");
  return pc.candidates.map((c) => engine.getDefinition(c).name).sort();
}

/** P2 discards the card with key `discardKey` (a P2 hand key). */
function opponentDiscards(engine: SpoilsEngine, id: (key: string) => string, discardKey: string) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the opponent must discard a card");
  assert.equal(pc.playerId, P2, "the opponent chooses what they discard");
  pick(engine, P2, [id(discardKey)]);
}

function freePlay(engine: SpoilsEngine, cardId?: string, selected?: Record<string, string[]>) {
  assert.equal(pending(engine)?.playerId, P1, "the caster decides on the free play");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId, selected } } as never);
  resolvePendingResponses(engine);
}

clause(MOLESTATION, "0:rule", "the opponent gets no response window: the tactic resolves entirely on its own", () => {
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  assert.equal(engine.state.responseWindow, undefined, "no window opens for the opponent");
  assert.equal(pending(engine) !== undefined, true, "the effect has already started (the opponent must discard)");
  opponentDiscards(engine, id, "o:Victim");
  assert.equal(zoneOf(engine, id("dm")), "discard");
});

clause(MOLESTATION, "0:rule", "the opponent cannot play a tactic in response, nor use an ability in response", () => {
  const counter = tactic({ name: "Counter", cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })], {
    extra: [{ key: "counter", def: counter, owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("dm"));
  assert.throws(() => playRaw(engine, P2, id("counter")), "P2 has no window to play a tactic in");
  assert.equal(zoneOf(engine, id("counter")), "hand");
});

clause(MOLESTATION, "0:rule", "control: an ordinary tactic does open a response window for the opponent", () => {
  const plain = tactic({ name: "Plain", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "plain", def: plain, owner: P1, zone: "hand" }]
  });
  playRaw(engine, P1, id("plain"));
  assert.ok(engine.state.responseWindow, "an ordinary tactic can be responded to");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(MOLESTATION, "0:rule", "pays 10 and is refused one resource short, or without [O][O][O][O]", () => {
  const one = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 9 });
  assert.throws(() => playRaw(one.engine, P1, one.id("dm")));
  assert.equal(zoneOf(one.engine, one.id("dm")), "hand");
  const noThreshold = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 3, greed: 9 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm")));
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 10 });
  const before = ready(engine);
  playRaw(engine, P1, id("dm"));
  assert.equal(before - ready(engine), 10, "the printed cost of 10 is paid");
  const mixed = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 4, greed: 6 });
  playRaw(mixed.engine, P1, mixed.id("dm"));
  assert.equal(zoneOf(mixed.engine, mixed.id("dm")) === "discard" || pending(mixed.engine) !== undefined, true, "[O]x4 plus 6 other resources is enough");
});

clause(MOLESTATION, "1:rule", "the opponent chooses which card of their hand to discard; it goes to their discard pile and nothing else of theirs is discarded", () => {
  const { engine, id } = molestationBoard([], [character({ name: "A", cost: 1 }), character({ name: "B", cost: 2 }), character({ name: "C", cost: 3 })]);
  playRaw(engine, P1, id("dm"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent picks");
  pickRaw(engine, P2, [id("o:B")]);
  assert.equal(zoneOf(engine, id("o:B")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("o:B")), true);
  assert.equal(zoneOf(engine, id("o:A")), "hand", "the other cards are still in hand (until the repeat)");
});

clause(MOLESTATION, "1:rule", "the discard must come from the opponent's hand, not yours, and is not optional", () => {
  const { engine, id } = molestationBoard([character({ name: "Mine", cost: 1 })], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  assert.throws(() => pickRaw(engine, P2, [id("h:Mine")]), "P1's own card");
  assert.throws(() => pickRaw(engine, P2, []), "'must discard' - not choosing is refused");
  assert.throws(() => pickRaw(engine, P2, [id("x1")]), "a card in P1's deck");
  assert.equal(zoneOf(engine, id("h:Mine")), "hand");
  assert.equal(zoneOf(engine, id("o:Victim")), "hand");
});

clause(MOLESTATION, "1:rule", "the caster cannot make the discard choice for the opponent", () => {
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  assert.throws(() => pickRaw(engine, P1, [id("o:Victim")]), "P1 is not the one who must discard");
});

clause(MOLESTATION, "1:rule", "the opponent may discard ANY card of their hand, including a resource card or a tactic", () => {
  const staple = resourceCard({ name: "Staple", cost: 0 });
  const tac = tactic({ name: "SomeTactic", cost: 2 });
  const { engine, id } = molestationBoard([], [staple, tac, character({ name: "Guy", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  pickRaw(engine, P2, [id("o:Staple")]);
  assert.equal(zoneOf(engine, id("o:Staple")), "discard", "a resource card can be discarded");
  pickRaw(engine, P2, [id("o:SomeTactic")]);
  assert.equal(zoneOf(engine, id("o:SomeTactic")), "discard", "a tactic can be discarded");
});

clause(MOLESTATION, "1:rule", "you may play a non-resource card with cost X or less (X = the discarded card's cost) for free; cost exactly X is allowed, X+1 is not", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "Cheap", cost: 1 }), character({ name: "Exact", cost: 3 }), character({ name: "TooDear", cost: 4 }), character({ name: "Huge", cost: 9 })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["Cheap", "Exact"], "only cards of cost 3 or less are offered");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:TooDear") } } as never), "cost 4 is more than X=3");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Huge") } } as never), "cost 9 is more than X=3");
  const resourcesLeft = ready(engine);
  freePlay(engine, id("h:Exact"));
  assert.equal(zoneOf(engine, id("h:Exact")), "play", "the card is played");
  assert.equal(ready(engine), resourcesLeft, "...for free: no resources spent");
  assert.equal(zoneOf(engine, id("h:Cheap")), "hand", "only one card is played per iteration");
});

clause(MOLESTATION, "1:rule", "X is the cost of the discarded card: a cost-0 discard offers only cost-0 cards, a cost-6 discard offers up to 6", () => {
  for (const [victimCost, expected] of [
    [0, ["Free"]],
    [1, ["Free", "One"]],
    [6, ["Cost6", "Free", "Mid", "One"]]
  ] as const) {
    const { engine, id } = molestationBoard(
      [character({ name: "Free", cost: 0 }), character({ name: "One", cost: 1 }), character({ name: "Mid", cost: 2 }), character({ name: "Cost6", cost: 6 }), character({ name: "Cost7", cost: 7 })],
      [character({ name: "Victim", cost: victimCost })]
    );
    playRaw(engine, P1, id("dm"));
    opponentDiscards(engine, id, "o:Victim");
    const names = offered(engine);
    assert.deepEqual(names, names.filter((n) => (expected as readonly string[]).includes(n)).sort(), `X=${victimCost}: nothing dearer is offered`);
    assert.deepEqual(names, [...expected].filter((n) => n !== "Mid" || victimCost >= 2).sort().filter((n) => n !== "Cost6" || victimCost >= 6), `X=${victimCost}`);
  }
});

clause(MOLESTATION, "1:rule", "a resource card discarded has numeric cost 0, so X=0", () => {
  const staple = resourceCard({ name: "Staple" });
  const { engine, id } = molestationBoard([character({ name: "Free", cost: 0 }), character({ name: "One", cost: 1 })], [staple]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Staple");
  assert.deepEqual(offered(engine), ["Free"]);
});

clause(MOLESTATION, "1:rule", "'may': declining plays nothing and leaves the cards in hand", () => {
  const { engine, id } = molestationBoard([character({ name: "Cheap", cost: 1 })], [character({ name: "Victim", cost: 3 })]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  const resources = ready(engine);
  freePlay(engine, undefined);
  assert.equal(zoneOf(engine, id("h:Cheap")), "hand");
  assert.equal(ready(engine), resources);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MOLESTATION, "1:rule", "only non-resource cards: a resource-type card in hand is never offered, whatever its cost", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "Cheap", cost: 1 }), resourceCard({ name: "Staple", cost: 0 })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["Cheap"]);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Staple") } } as never));
});

clause(MOLESTATION, "1:rule", "you still need the proper resource icons: choosing a card whose threshold you do not meet is refused, one you meet is played", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never }), character({ name: "NeedsObsession", cost: 1, threshold: "o" as never })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.ok(offered(engine).includes("NeedsObsession"), "a card whose threshold you meet can be chosen");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:NeedsRage") } } as never), "no [R] icons: refused");
  assert.equal(zoneOf(engine, id("h:NeedsRage")), "hand");
  freePlay(engine, id("h:NeedsObsession"));
  assert.equal(zoneOf(engine, id("h:NeedsObsession")), "play");
  assert.equal(zoneOf(engine, id("h:NeedsRage")), "hand");
});

clause(MOLESTATION, "1:rule", "you still need the icons: with the right icons a threshold-[R][R] card is played for free", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never })],
    [character({ name: "Victim", cost: 3 })],
    { extra: bank("rage", 2, P1) }
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  freePlay(engine, id("h:NeedsRage"));
  assert.equal(zoneOf(engine, id("h:NeedsRage")), "play");
});

clause(MOLESTATION, "1:rule", "you must pay any additional costs: a free-played tactic with an extra 'pay 2' cost still costs 2", () => {
  const costly = tactic({
    name: "Costly",
    cost: 1,
    behavior: { abilities: [{ id: "c", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = molestationBoard([costly], [character({ name: "Victim", cost: 3 })]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  const resources = ready(engine);
  freePlay(engine, id("h:Costly"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("h:Costly")), "discard", "the tactic was played");
  assert.equal(resources - ready(engine), 2, "its additional cost of 2 was paid; only the numeric cost is free");
});

clause(MOLESTATION, "1:rule", "you must pay any additional costs: a free-played card that needs a picked target is refused without the pick, accepted with it", () => {
  const sniper = tactic({
    name: "Sniper",
    cost: 1,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = molestationBoard([sniper], [character({ name: "Victim", cost: 3 })], {
    extra: [{ key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" }]
  });
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Sniper") } } as never), "no target picked");
  assert.equal(zoneOf(engine, id("h:Sniper")), "hand", "still in hand after the refused attempt");
  freePlay(engine, id("h:Sniper"), { t: [id("bystander")] });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("bystander")), "discard", "the free-played tactic did its job");
  assert.equal(zoneOf(engine, id("h:Sniper")), "discard");
});

clause(MOLESTATION, "1:rule", "only cards from YOUR HAND can be played this way (not your deck, your discard pile, or the opponent's hand)", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "InHand", cost: 1 })],
    [character({ name: "Victim", cost: 3 }), character({ name: "TheirOther", cost: 1 })],
    {
      extra: [
        { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
        { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" }
      ]
    }
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.deepEqual(offered(engine), ["InHand"]);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("o:TheirOther") } } as never), "the opponent's hand");
});

for (const [label, def, check] of [
  ["character", character({ name: "Guy", cost: 2 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(zoneOf(e, id("h:Guy")), "play")],
  ["item", item({ name: "Widget", cost: 2 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(zoneOf(e, id("h:Widget")), "play")],
  ["location", location({ name: "Hall", cost: 2, structure: 3 }), (e: SpoilsEngine, id: (k: string) => string) => assert.equal(zoneOf(e, id("h:Hall")), "play")],
  [
    "tactic",
    tactic({ name: "Cantrip", cost: 2, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
    (e: SpoilsEngine, id: (k: string) => string) => {
      assert.equal(zoneOf(e, id("h:Cantrip")), "discard", "a tactic resolves and goes to the discard pile");
      assert.equal(zoneOf(e, id("x1")), "hand", "...and its effect happened (it drew a card)");
    }
  ]
] as const) {
  clause(MOLESTATION, "1:rule", `the free play can be a ${label}`, () => {
    const { engine, id } = molestationBoard([def as Def], [character({ name: "Victim", cost: 3 })]);
    playRaw(engine, P1, id("dm"));
    opponentDiscards(engine, id, "o:Victim");
    assert.deepEqual(offered(engine), [def.name]);
    freePlay(engine, id(`h:${def.name}`));
    drain(engine, declineAll);
    check(engine, id);
  });
}

clause(MOLESTATION, "1:rule", "with nothing affordable to play, the opponent's discard still happens and nothing is played", () => {
  const { engine, id } = molestationBoard([character({ name: "Huge", cost: 9 })], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("o:Victim")), "discard");
  assert.equal(zoneOf(engine, id("h:Huge")), "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MOLESTATION, "1:rule", "an opponent with no cards in hand: nothing is discarded, nothing is played, and the tactic still resolves", () => {
  const { engine, id } = molestationBoard([character({ name: "Cheap", cost: 1 })], []);
  playRaw(engine, P1, id("dm"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h:Cheap")), "hand");
  assert.equal(zoneOf(engine, id("dm")), "discard");
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(MOLESTATION, "2:rule", "repeats until the opponent's hand is empty: three cards means three discards (each chosen by the opponent) and up to three free plays", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "P1", cost: 1 }), character({ name: "P2", cost: 2 }), character({ name: "P3", cost: 3 })],
    [character({ name: "V1", cost: 1 }), character({ name: "V2", cost: 2 }), character({ name: "V3", cost: 3 })]
  );
  const resources = ready(engine);
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:V1");
  assert.deepEqual(offered(engine), ["P1"], "iteration 1: X=1");
  freePlay(engine, id("h:P1"));

  assert.equal(handOf(engine, P2).length, 2, "two cards left, so it repeats");
  opponentDiscards(engine, id, "o:V3");
  assert.deepEqual(offered(engine), ["P2", "P3"], "iteration 2: X=3 (the card played in iteration 1 is gone from hand)");
  freePlay(engine, id("h:P3"));

  assert.equal(handOf(engine, P2).length, 1);
  opponentDiscards(engine, id, "o:V2");
  assert.deepEqual(offered(engine), ["P2"], "iteration 3: X=2");
  freePlay(engine, undefined);

  assert.equal(engine.state.pendingChoice, undefined, "the opponent's hand is empty, so it stops");
  assert.equal(handOf(engine, P2).length, 0);
  for (const key of ["o:V1", "o:V2", "o:V3"]) assert.equal(zoneOf(engine, id(key)), "discard");
  assert.equal(zoneOf(engine, id("h:P1")), "play");
  assert.equal(zoneOf(engine, id("h:P3")), "play");
  assert.equal(zoneOf(engine, id("h:P2")), "hand", "declined in iteration 3");
  assert.equal(resources - ready(engine), 10, "the free plays cost nothing: only the tactic's own 10");
  assert.equal(zoneOf(engine, id("dm")), "discard");
});

clause(MOLESTATION, "2:rule", "a single-card hand needs exactly one iteration; a large hand is emptied completely", () => {
  const one = molestationBoard([], [character({ name: "Only", cost: 1 })]);
  playRaw(one.engine, P1, one.id("dm"));
  opponentDiscards(one.engine, one.id, "o:Only");
  drain(one.engine, declineAll);
  assert.equal(handOf(one.engine, P2).length, 0);

  const names = ["N1", "N2", "N3", "N4", "N5", "N6"];
  const many = molestationBoard([], names.map((name) => character({ name, cost: 1 })));
  playRaw(many.engine, P1, many.id("dm"));
  for (const name of names) opponentDiscards(many.engine, many.id, `o:${name}`);
  assert.equal(many.engine.state.pendingChoice, undefined);
  assert.equal(handOf(many.engine, P2).length, 0, "six cards, six iterations");
  assert.equal(discardOf(many.engine, P2).length, 6);
});

clause(MOLESTATION, "2:rule", "the repeat looks at the opponent's hand as it is NOW: a card the opponent draws from a free-played card is discarded as well", () => {
  const gifter = character({
    name: "Gifter",
    cost: 0,
    behavior: {
      abilities: [{ id: "gift", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "opponent", amount: 1 }] }]
    }
  });
  const { engine, id } = molestationBoard([gifter], [character({ name: "V1", cost: 1 })], { oppDeck: 3 });
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:V1");
  freePlay(engine, id("h:Gifter"));
  assert.equal(zoneOf(engine, id("h:Gifter")), "play");
  assert.equal(handOf(engine, P2).length, 1, "the Gifter made the opponent draw a card, so their hand is not empty");
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "so the effect repeats: the opponent must discard again");
  assert.equal(pc.playerId, P2);
  pickRaw(engine, P2, handOf(engine, P2));
  drain(engine, declineAll);
  assert.equal(handOf(engine, P2).length, 0, "until the opponent has no cards in their hand");
  assert.equal(discardOf(engine, P2).length, 2);
});

// --- Ecto-Distillation ---------------------------------------------------------
// COST: Name a card. EFFECT: Search your deck for any number of copies of the card and
// reveal them. Put 1 into your hand and the rest into your discard pile. Your opponent
// may search your deck for any number of copies of the card and put them into your
// discard pile. Tactic, cost 4, threshold [O][O][O].

const DISTILLATION = "b9551400-f15c-4a8f-a2e1-a35a202e773d";

function distillationBoard(opts: { copies?: number; obsession?: number; greed?: number; random?: () => number } = {}) {
  const copies = opts.copies ?? 3;
  return buildGame({
    playerA: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" },
      ...Array.from({ length: copies }, (_, i) => ({ key: `t${i + 1}`, def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "deck" as const })),
      { key: "lookalike", def: character({ name: "Target Practice" }), owner: P1, zone: "deck" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "deck" },
      { key: "other2", def: character({ name: "Other2" }), owner: P1, zone: "deck" },
      { key: "inHand", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "discard" },
      { key: "inPlay", def: character({ id: "target-def", name: "Target" }), owner: P1, zone: "play" },
      { key: "oppCopy1", def: character({ id: "target-def", name: "Target" }), owner: P2, zone: "deck" },
      { key: "oppCopy2", def: character({ id: "target-def", name: "Target" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

type DistillAnswers = { find?: string[]; hand?: string; oppBins?: string[]; named?: string };

/** Plays Ecto-Distillation and answers: the name, the caster's search (`find`), which copy goes to hand (`hand`), the opponent's search (`oppBins`). Returns who was asked what. */
function distill(engine: SpoilsEngine, id: (k: string) => string, answers: DistillAnswers) {
  const asked: Array<{ kind: string; playerId: string }> = [];
  drain(engine, (pc) => {
    asked.push({ kind: pc.kind, playerId: pc.playerId });
    if (pc.kind === "nameValue") return { kind: "nameValue", value: answers.named ?? "Target" };
    if (pc.kind === "chooserSelectsTarget") {
      const declaration = pc.declaration as { id: string };
      if (declaration.id === "found") return { kind: "chooserSelectsTarget", selected: (answers.find ?? []).map(id) };
      if (declaration.id === "one") return { kind: "chooserSelectsTarget", selected: answers.hand ? [id(answers.hand)] : [] };
      if (declaration.id === "opp") return { kind: "chooserSelectsTarget", selected: (answers.oppBins ?? []).map(id) };
    }
    return declineAll(pc);
  });
  return asked;
}

clause(DISTILLATION, "0:ability", "you name a card (not your opponent), and the tactic costs 4", () => {
  const { engine, id } = distillationBoard();
  const before = ready(engine);
  play(engine, P1, id("ed"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc.playerId, P1, "the caster names the card");
  assert.equal(pc.valueKind, "cardName", "a CARD is named");
  assert.equal(before - ready(engine), 0, "nothing is paid until the name (part of the cost) is given");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
});

clause(DISTILLATION, "0:ability", "'Name a card' is a COST: the card is named when the tactic is played, before the opponent can respond", () => {
  const { engine, id } = distillationBoard();
  playRaw(engine, P1, id("ed"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "nameValue", "the caster is asked to name a card as part of paying costs");
  assert.equal(pc?.playerId, P1);
  assert.equal(engine.state.responseWindow, undefined, "the opponent's response window has not opened yet (costs are paid before the opponent may respond)");
});

clause(DISTILLATION, "0:ability", "searching: every copy found goes away from the deck - one to your hand, the rest to your discard pile", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const handBefore = handOf(engine, P1).length;
  const discardBefore = discardOf(engine, P1).length;
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1", "t2", "t3"], hand: "t2" });
  assert.equal(zoneOf(engine, id("t2")), "hand", "the chosen copy goes to your hand");
  assert.equal(zoneOf(engine, id("t1")), "discard");
  assert.equal(zoneOf(engine, id("t3")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "hand: the tactic left, one copy arrived");
  assert.equal(discardOf(engine, P1).length, discardBefore + 2 + 1, "discard: two copies and the tactic");
  assert.equal(zoneOf(engine, id("ed")), "discard");
});

clause(DISTILLATION, "0:ability", "'any number of copies': you may find only some of them, and the copies you did not find stay in the deck", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1", "t3"], hand: "t3" });
  assert.equal(zoneOf(engine, id("t3")), "hand");
  assert.equal(zoneOf(engine, id("t1")), "discard");
  assert.equal(zoneOf(engine, id("t2")), "deck", "a copy you did not search for stays in the deck (the opponent declined to take it)");
});

clause(DISTILLATION, "0:ability", "'any number of copies': you may find none at all, and then nothing goes to your hand", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const handBefore = [...handOf(engine, P1)];
  play(engine, P1, id("ed"));
  distill(engine, id, { find: [] });
  for (const key of ["t1", "t2", "t3"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.filter((c) => c !== id("ed")).sort());
});

clause(DISTILLATION, "0:ability", "only copies of the NAMED card in YOUR DECK are found: other names, look-alikes, your hand, discard pile, play and the opponent's deck cannot be", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "nameValue");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
  resolvePendingResponses(engine);
  const search = pending(engine);
  assert.equal(search?.kind, "chooserSelectsTarget");
  assert.equal(search.playerId, P1, "you search your own deck");
  for (const key of ["other", "lookalike", "inHand", "inDiscard", "inPlay", "oppCopy1", "ed"]) {
    assert.throws(() => pickRaw(engine, P1, [id(key)]), `${key} is not a copy of the named card in your deck`);
  }
  pick(engine, P1, [id("t1")]);
});

clause(DISTILLATION, "0:ability", "only copies in YOUR DECK are affected by the whole effect: look-alikes, your hand, your discard pile, play and the opponent's deck stay put", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1", "t2", "t3"], hand: "t1", oppBins: [] });
  assert.equal(zoneOf(engine, id("other")), "deck", "a differently named card stays in the deck");
  assert.equal(zoneOf(engine, id("lookalike")), "deck", "'Target Practice' is not a copy of 'Target'");
  assert.equal(zoneOf(engine, id("inHand")), "hand", "a copy already in your hand stays there");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard", "a copy already in your discard pile stays there");
  assert.equal(zoneOf(engine, id("inPlay")), "play", "a copy in play stays there");
  assert.equal(zoneOf(engine, id("oppCopy1")), "deck", "the opponent's deck is not searched");
  assert.equal(zoneOf(engine, id("oppCopy2")), "deck");
});

clause(DISTILLATION, "0:ability", "copies printed under another definition with the same name are copies of the card", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" },
      { key: "a", def: character({ id: "target-a", name: "Target" }), owner: P1, zone: "deck" },
      { key: "b", def: character({ id: "target-b", name: "Target" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["a", "b"], hand: "b" });
  assert.equal(zoneOf(engine, id("b")), "hand");
  assert.equal(zoneOf(engine, id("a")), "discard", "a reprint of the same name is a copy too");
});

clause(DISTILLATION, "0:ability", "a single copy goes to your hand and nothing else is discarded", () => {
  const { engine, id } = distillationBoard({ copies: 1 });
  const discardBefore = discardOf(engine, P1).length;
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1"], hand: "t1" });
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(discardOf(engine, P1).length, discardBefore + 1, "only the tactic itself joins the discard pile");
});

clause(DISTILLATION, "0:ability", "naming a card with no copy in your deck finds nothing and changes nothing", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const handBefore = [...handOf(engine, P1)];
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("ed"));
  distill(engine, id, { named: "Nonexistent Card" });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.filter((c) => c !== id("ed")).sort());
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...deckBefore].sort());
  assert.equal(zoneOf(engine, id("ed")), "discard");
});

clause(DISTILLATION, "0:ability", "the named card decides what is taken: naming 'Other' takes 'Other' and leaves the Targets", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  const lookup = { named: "Other" };
  play(engine, P1, id("ed"));
  distill(engine, id, { ...lookup, find: ["other"], hand: "other" });
  assert.equal(zoneOf(engine, id("other")), "hand");
  for (const key of ["t1", "t2", "t3"]) assert.equal(zoneOf(engine, id(key)), "deck");
});

clause(DISTILLATION, "0:ability", "the found copies are revealed (to everyone) before they move", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1", "t2"], hand: "t1" });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length >= 1, true, "the copies are revealed");
  const revealed = reveals.flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
  assert.deepEqual([...revealed].sort(), [id("t1"), id("t2")].sort(), "exactly the copies that were found");
  assert.equal((reveals[0].event as unknown as { viewerId: string }).viewerId, "all");
});

clause(DISTILLATION, "0:ability", "the opponent may search your deck for any number of the remaining copies, and they go into YOUR discard pile", () => {
  const { engine, id } = distillationBoard({ copies: 4 });
  play(engine, P1, id("ed"));
  const asked = distill(engine, id, { find: ["t1"], hand: "t1", oppBins: ["t2", "t4"] });
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(zoneOf(engine, id("t2")), "discard", "binned by the opponent");
  assert.equal(zoneOf(engine, id("t4")), "discard", "binned by the opponent");
  assert.equal(discardOf(engine, P1).includes(id("t2")), true, "into the deck owner's discard pile");
  assert.equal(discardOf(engine, P1).includes(id("t4")), true);
  assert.equal(zoneOf(engine, id("t3")), "deck", "a copy the opponent did not take stays in the deck");
  assert.equal(
    asked.some((q) => q.playerId === P2 && q.kind === "chooserSelectsTarget"),
    true,
    "the OPPONENT is the one who searches"
  );
});

clause(DISTILLATION, "0:ability", "'may': the opponent can take none of the remaining copies", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1"], hand: "t1", oppBins: [] });
  assert.equal(zoneOf(engine, id("t2")), "deck");
  assert.equal(zoneOf(engine, id("t3")), "deck");
});

clause(DISTILLATION, "0:ability", "the opponent may take all the remaining copies", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1"], hand: "t1", oppBins: ["t2", "t3"] });
  assert.equal(zoneOf(engine, id("t2")), "discard");
  assert.equal(zoneOf(engine, id("t3")), "discard");
  assert.equal(deckOf(engine, P1).some((c) => engine.getDefinition(c).name === "Target"), false, "no copy is left in the deck");
});

clause(DISTILLATION, "0:ability", "the opponent may only take copies of the NAMED card from YOUR deck (not other cards, your hand, or their own deck)", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  let attempted = false;
  drain(engine, (pc) => {
    if (pc.kind === "nameValue") return { kind: "nameValue", value: "Target" };
    if (pc.kind === "chooserSelectsTarget") {
      const declaration = pc.declaration as { id: string };
      if (declaration.id === "found") return { kind: "chooserSelectsTarget", selected: [id("t1")] };
      if (declaration.id === "one") return { kind: "chooserSelectsTarget", selected: [id("t1")] };
      if (declaration.id === "opp") {
        attempted = true;
        for (const key of ["other", "lookalike", "inHand", "inDiscard", "oppCopy1"]) {
          assert.throws(() => pickRaw(engine, P2, [id(key)]), `${key} cannot be taken by the opponent's search`);
        }
        return { kind: "chooserSelectsTarget", selected: [id("t2")] };
      }
    }
    return declineAll(pc);
  });
  assert.equal(attempted, true, "the opponent got to search");
  assert.equal(zoneOf(engine, id("t2")), "discard");
  assert.equal(zoneOf(engine, id("oppCopy1")), "deck");
});

clause(DISTILLATION, "0:ability", "your deck is shuffled afterwards (CR 312.1: a searched deck is shuffled)", () => {
  const { engine, id } = distillationBoard({ copies: 3, random: () => 0 });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("ed"));
  distill(engine, id, { find: ["t1"], hand: "t1" });
  const unshuffled = before.filter((c) => c !== id("t1"));
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "but their order changed: the deck was shuffled");
});

clause(DISTILLATION, "0:ability", "naming a card that has no copies in the deck still shuffles the deck (the deck was searched)", () => {
  const unshuffled = distillationBoard({ copies: 3, random: () => 0 });
  const deckBefore = [...deckOf(unshuffled.engine, P1)];
  play(unshuffled.engine, P1, unshuffled.id("ed"));
  distill(unshuffled.engine, unshuffled.id, { named: "Nonexistent Card" });
  assert.deepEqual([...deckOf(unshuffled.engine, P1)].sort(), [...deckBefore].sort(), "same cards");
  assert.notDeepEqual(deckOf(unshuffled.engine, P1), deckBefore, "but shuffled");
});

clause(DISTILLATION, "0:ability", "is refused one resource short of 4, and without [O][O][O]", () => {
  const short = distillationBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ed")));
  assert.equal(zoneOf(short.engine, short.id("ed")), "hand");
  const noThreshold = distillationBoard({ obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ed")));
  const exact = distillationBoard({ obsession: 4 });
  play(exact.engine, P1, exact.id("ed"));
  assert.equal(pending(exact.engine)?.kind, "nameValue", "exactly 4 resources with [O][O][O] is enough");
  const mixed = distillationBoard({ obsession: 3, greed: 1 });
  play(mixed.engine, P1, mixed.id("ed"));
  assert.equal(pending(mixed.engine)?.kind, "nameValue", "[O][O][O] plus one other resource is enough");
});

// --- Forget ----------------------------------------------------------------
// COST: Pick a non-resource card. EFFECT: Put the card into its owner's hand. Look at
// your opponent's hand and pick a card. Your opponent must discard that card.
// Tactic, cost 5, threshold [O][O].

const FORGET = "c8ecd7ab-d7d8-4749-b821-980f09c58edc";

function forgetBoard(opts: { obsession?: number; greed?: number; oppHand?: string[] } = {}) {
  const oppHand = opts.oppHand ?? ["oh1", "oh2", "oh3"];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...oppHand.map((key) => ({ key, def: character({ name: key.toUpperCase() }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 7, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Forget on `target`, answers the follow-up pick with `discardKey`. */
function forgetAndDiscard(engine: SpoilsEngine, id: (k: string) => string, target: string, discardKey?: string) {
  play(engine, P1, id("fg"), { selected: { bounced: [id(target)] } });
  if (discardKey) {
    const pc = pending(engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you look at the hand and pick");
    pick(engine, P1, [id(discardKey)]);
  }
}

for (const [target, owner] of [
  ["myChar", P1],
  ["myItem", P1],
  ["myLoc", P1],
  ["foeChar", P2],
  ["foeItem", P2],
  ["foeLoc", P2]
] as const) {
  clause(FORGET, "0:ability", `pays 5, puts the picked ${target} into its owner's hand, then you pick a card of the opponent's hand and they discard it`, () => {
    const { engine, id } = forgetBoard();
    const before = ready(engine);
    forgetAndDiscard(engine, id, target, "oh2");

    assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
    assert.equal(zoneOf(engine, id(target)), "hand");
    assert.equal(handOf(engine, owner).includes(id(target)), true, "in its owner's hand");
    assert.equal(zoneOf(engine, id("oh2")), "discard", "the picked card is discarded");
    assert.equal(discardOf(engine, P2).includes(id("oh2")), true);
    for (const key of ["oh1", "oh3"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key}: only the picked card is discarded`);
    assert.equal(zoneOf(engine, id("myHand")), "hand", "your own hand is not touched");
    assert.equal(zoneOf(engine, id("fg")), "discard");
  });
}

clause(FORGET, "0:ability", "a card you control but do not own goes to its OWNER's hand (and one the opponent controls goes to yours)", () => {
  const stolen = forgetBoard();
  forgetAndDiscard(stolen.engine, stolen.id, "stolen", "oh1");
  assert.equal(handOf(stolen.engine, P2).includes(stolen.id("stolen")), true, "owned by P2: goes to P2's hand");
  assert.equal(handOf(stolen.engine, P1).includes(stolen.id("stolen")), false);

  const lent = forgetBoard();
  forgetAndDiscard(lent.engine, lent.id, "lent", "oh1");
  assert.equal(handOf(lent.engine, P1).includes(lent.id("lent")), true, "owned by P1: goes to P1's hand");
});

clause(FORGET, "0:ability", "the card just put into the opponent's hand can itself be the card you pick (the hand is looked at AFTER the bounce)", () => {
  const { engine, id } = forgetBoard({ oppHand: [] });
  forgetAndDiscard(engine, id, "foeChar", "foeChar");
  assert.equal(zoneOf(engine, id("foeChar")), "discard", "bounced to their hand, then discarded from it");
  assert.equal(discardOf(engine, P2).includes(id("foeChar")), true);
});

clause(FORGET, "0:ability", "you pick from the OPPONENT's hand only: your own hand (including a card you just bounced) is refused", () => {
  const { engine, id } = forgetBoard();
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  const attempt = (key: string) => () => pickRaw(engine, P1, [id(key)]);
  assert.throws(attempt("myHand"), "a card from your own hand");
  assert.throws(attempt("myChar"), "the character you just returned to your own hand");
  assert.throws(attempt("foeChar"), "a card in play");
  assert.throws(attempt("inDiscard"), "a card in a discard pile");
  attempt("oh1")();
  assert.equal(zoneOf(engine, id("oh1")), "discard");
});

clause(FORGET, "0:ability", "the card you pick can be ANY card of their hand (a resource or a tactic too), not only non-resource cards", () => {
  const board = (extra: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
        { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
        ...extra,
        ...bank("obsession", 7, P1)
      ]
    });
  const staple = board([{ key: "staple", def: resourceCard({ name: "Staple" }), owner: P2, zone: "hand" }]);
  forgetAndDiscard(staple.engine, staple.id, "myChar", "staple");
  assert.equal(zoneOf(staple.engine, staple.id("staple")), "discard", "a resource card in their hand may be picked");
  const tac = board([{ key: "tac", def: tactic({ name: "Tac" }), owner: P2, zone: "hand" }]);
  forgetAndDiscard(tac.engine, tac.id, "myChar", "tac");
  assert.equal(zoneOf(tac.engine, tac.id("tac")), "discard", "a tactic in their hand may be picked");
});

clause(FORGET, "0:ability", "picking a card from the opponent's hand is not optional while they hold cards: picking none or two is refused", () => {
  const { engine, id } = forgetBoard();
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  const attempt = (keys: string[]) => () => pickRaw(engine, P1, keys.map(id));
  assert.throws(attempt([]), "none");
  assert.throws(attempt(["oh1", "oh2"]), "two cards");
  attempt(["oh3"])();
  assert.equal(zoneOf(engine, id("oh3")), "discard");
  assert.equal(zoneOf(engine, id("oh1")), "hand");
  assert.equal(zoneOf(engine, id("oh2")), "hand");
});

clause(FORGET, "0:ability", "with no cards in the opponent's hand (and none bounced to it), nothing is discarded and the tactic still resolves", () => {
  const { engine, id } = forgetBoard({ oppHand: [] });
  play(engine, P1, id("fg"), { selected: { bounced: [id("myChar")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("myChar")), "hand");
  assert.equal(discardOf(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("fg")), "discard");
});

clause(FORGET, "0:ability", "only a non-resource card can be picked: staple resources, face-down cards, factions, cards in hand and cards in a discard pile are refused", () => {
  const { engine, id } = forgetBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("fg"), { selected: { bounced: [cardId] } });
  assert.ok(resourceId, "the board has a resource in play");
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(factionOf(engine, P1)), "your faction");
  assert.throws(attempt(factionOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(id("myHand")), "a card in your hand is not in play");
  assert.throws(attempt(id("oh1")), "a card in the opponent's hand");
  assert.throws(attempt(id("inDiscard")), "a card in a discard pile");
  assert.throws(() => playRaw(engine, P1, id("fg"), { selected: { bounced: [] } }), "a pick is required");
  assert.throws(() => playRaw(engine, P1, id("fg"), { selected: { bounced: [id("myChar"), id("foeChar")] } }), "one card only");
  assert.equal(zoneOf(engine, id("fg")), "hand", "nothing was played");
  attempt(id("foeItem"))();
  assert.ok(engine.state.responseWindow, "a non-resource permanent is accepted");
});

clause(FORGET, "0:ability", "the card is put into its owner's hand when the tactic resolves, not while the opponent can still respond", () => {
  const { engine, id } = forgetBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("fg"), { selected: { bounced: [id("foeChar")] } });
  assert.equal(before - ready(engine), 5, "the cost is paid when played");
  assert.equal(zoneOf(engine, id("foeChar")), "play", "the bounce has not happened yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(FORGET, "0:ability", "is refused one resource short of 5, and without [O][O]", () => {
  const short = forgetBoard({ obsession: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("fg"), { selected: { bounced: [short.id("myChar")] } }));
  const noThreshold = forgetBoard({ obsession: 1, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("fg"), { selected: { bounced: [noThreshold.id("myChar")] } }));
  const exact = forgetBoard({ obsession: 5 });
  forgetAndDiscard(exact.engine, exact.id, "myChar", "oh1");
  assert.equal(zoneOf(exact.engine, exact.id("myChar")), "hand");
  const mixed = forgetBoard({ obsession: 2, greed: 3 });
  forgetAndDiscard(mixed.engine, mixed.id, "myChar", "oh1");
  assert.equal(zoneOf(mixed.engine, mixed.id("myChar")), "hand", "[O][O] plus 3 other resources is enough");
});

// --- duplicate helpers (Ectypal Stave, Voidal Replication) ---------------------

/** A tactic that makes its controller draw `n` cards. */
function drawTactic(name: string, cost: number, n = 1, extra: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] },
    ...extra
  });
}

/** A tactic with the extra cost "discard a card" whose effect is the opponent's faction losing 1 influence. */
function titheTactic(): CardDefinition {
  return tactic({
    name: "Tithe",
    cost: 1,
    behavior: {
      abilities: [
        {
          id: "tithe",
          type: "activated",
          costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
          effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
        }
      ]
    }
  });
}

// --- Ectypal Stave -------------------------------------------------------------
// COUNTERFEIT -- COST: Use this only if a tactic has been played this turn. Pay 2+X, where
// X is the numeric cost of the last tactic played this turn. Deplete this card.
// EFFECT: Duplicate the tactic. (A duplicate retains all rules text including extra costs,
// which must be paid or the duplicate is invalid and has no effect.)
// Item, cost 2, threshold [O][O][O][O].

const STAVE = "7fd4d0fa-4d47-4a7f-89b5-86b55e154cba";

function staveBoard(extra: CardPlacement[], opts: { obsession?: number; turn?: number; active?: Pid; staveZone?: "play" | "hand"; staveController?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "es", def: printing(STAVE), owner: P1, zone: opts.staveZone ?? "play", controller: opts.staveController },
      ...fillers("d", 10, P1, "deck"),
      ...fillers("e", 10, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 12, P1),
      ...extra
    ]
  });
}

const counterfeit = (b: { engine: SpoilsEngine; id: (k: string) => string }, player: Pid = P1) => activate(b.engine, player, b.id("es"), "counterfeit");

clause(STAVE, "0:ability:counterfeit", "cannot be used if no tactic has been played this turn, however many resources you have", () => {
  const b = staveBoard([]);
  assert.throws(() => counterfeit(b));
  assert.equal(isDepleted(b.engine, b.id("es")), false, "nothing was depleted");
  assert.equal(ready(b.engine), 12, "nothing was paid");
});

clause(STAVE, "0:ability:counterfeit", "a character, an item or a location deployed this turn does not count as a tactic played", () => {
  const b = staveBoard([
    { key: "c", def: character({ name: "Guy", cost: 1 }), owner: P1, zone: "hand" },
    { key: "i", def: item({ name: "Widget", cost: 1 }), owner: P1, zone: "hand" },
    { key: "l", def: location({ name: "Hall", cost: 1 }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("c"));
  play(b.engine, P1, b.id("i"));
  play(b.engine, P1, b.id("l"));
  assert.throws(() => counterfeit(b), "only a TACTIC enables it");
});

for (const x of [0, 1, 2, 3, 5]) {
  clause(STAVE, "0:ability:counterfeit", `pays 2+X where X is the numeric cost of the last tactic (X=${x}: pays ${2 + x}), depletes itself and duplicates the tactic`, () => {
    const b = staveBoard([{ key: "t", def: drawTactic(`DrawT${x}`, x), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("t"));
    const resourcesAfterTactic = ready(b.engine);
    assert.equal(12 - resourcesAfterTactic, x, "the tactic itself cost its numeric cost");
    const handAfterTactic = handOf(b.engine, P1).length;
    counterfeit(b);
    assert.equal(resourcesAfterTactic - ready(b.engine), 2 + x, `COUNTERFEIT costs 2+${x}`);
    assert.equal(isDepleted(b.engine, b.id("es")), true, "COST: Deplete this card");
    assert.equal(handOf(b.engine, P1).length, handAfterTactic + 1, "the duplicate drew a card again");
    assert.equal(zoneOf(b.engine, b.id("t")), "discard", "the original tactic is in the discard pile; the duplicate is invisible");
  });
}

clause(STAVE, "0:ability:counterfeit", "X is the cost of the LAST tactic played, and that tactic is the one duplicated (cost-1 'draw 1' then cost-3 'draw 2')", () => {
  const b = staveBoard([
    { key: "a", def: drawTactic("First", 1, 1), owner: P1, zone: "hand" },
    { key: "b", def: drawTactic("Second", 3, 2), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("a"));
  play(b.engine, P1, b.id("b"));
  const resources = ready(b.engine);
  const hand = handOf(b.engine, P1).length;
  counterfeit(b);
  assert.equal(resources - ready(b.engine), 2 + 3, "X is 3, the cost of the last tactic, not 1");
  assert.equal(handOf(b.engine, P1).length, hand + 2, "the last tactic (draw 2) was duplicated, not the first (draw 1)");
});

clause(STAVE, "0:ability:counterfeit", "the order matters: after the cost-3 tactic and then the cost-1 tactic, X is 1 and 'draw 1' is duplicated", () => {
  const b = staveBoard([
    { key: "b", def: drawTactic("Big", 3, 2), owner: P1, zone: "hand" },
    { key: "a", def: drawTactic("Small", 1, 1), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("b"));
  play(b.engine, P1, b.id("a"));
  const resources = ready(b.engine);
  const hand = handOf(b.engine, P1).length;
  counterfeit(b);
  assert.equal(resources - ready(b.engine), 2 + 1);
  assert.equal(handOf(b.engine, P1).length, hand + 1);
});

clause(STAVE, "0:ability:counterfeit", "is refused one resource short of 2+X, and works with exactly 2+X", () => {
  const short = staveBoard([{ key: "t", def: drawTactic("DrawT3", 3), owner: P1, zone: "hand" }], { obsession: 7 });
  play(short.engine, P1, short.id("t"));
  assert.equal(ready(short.engine), 4);
  assert.throws(() => counterfeit(short), "4 resources for a cost of 2+3 = 5");
  assert.equal(isDepleted(short.engine, short.id("es")), false);
  assert.equal(ready(short.engine), 4, "nothing was spent");

  const exact = staveBoard([{ key: "t", def: drawTactic("DrawT3", 3), owner: P1, zone: "hand" }], { obsession: 8 });
  play(exact.engine, P1, exact.id("t"));
  assert.equal(ready(exact.engine), 5);
  counterfeit(exact);
  assert.equal(ready(exact.engine), 0, "exactly 5 is enough");
  assert.equal(isDepleted(exact.engine, exact.id("es")), true);
});

clause(STAVE, "0:ability:counterfeit", "cannot be used while depleted; usable again after it restores, if a tactic has been played that turn", () => {
  const b = staveBoard([
    { key: "t1", def: drawTactic("T1", 0), owner: P1, zone: "hand" },
    { key: "t2", def: drawTactic("T2", 0), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("t1"));
  counterfeit(b);
  assert.equal(isDepleted(b.engine, b.id("es")), true);
  const resources = ready(b.engine);
  assert.throws(() => counterfeit(b), "depleted: cost cannot be paid again");
  assert.equal(ready(b.engine), resources, "nothing was paid");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("es")), false, "restored at the start of its controller's next turn");
  assert.throws(() => counterfeit(b), "no tactic has been played yet this turn");
  play(b.engine, P1, b.id("t2"));
  counterfeit(b);
  assert.equal(isDepleted(b.engine, b.id("es")), true, "usable again once a tactic was played this turn");
});

clause(STAVE, "0:ability:counterfeit", "only a tactic played THIS turn counts: a tactic from an earlier turn does not enable it", () => {
  const b = staveBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.turn, 3);
  assert.throws(() => counterfeit(b), "the tactic was played two turns ago");
});

clause(STAVE, "0:ability:counterfeit", "a tactic played by the OPPONENT this turn counts too: it is duplicated for you (its numeric cost sets X, and you control the duplicate)", () => {
  const b = staveBoard(
    [
      { key: "t", def: drawTactic("TheirTactic", 2), owner: P2, zone: "hand" },
      ...bank("obsession", 2, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("t"));
  assert.equal(zoneOf(b.engine, b.id("t")), "discard", "the opponent's tactic resolved");
  const myHand = handOf(b.engine, P1).length;
  const theirHand = handOf(b.engine, P2).length;
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the end of their turn");
  const resources = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("es"), abilityId: "counterfeit", selected: {}, variables: {} });
  assert.equal(resources - ready(b.engine), 2 + 2, "X is the numeric cost of THEIR last tactic");
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, myHand + 1, "the duplicate is mine: I drew");
  assert.equal(handOf(b.engine, P2).length, theirHand, "they did not draw again");
});

clause(STAVE, "0:ability:counterfeit", "the duplicate does not need the threshold of the duplicated tactic", () => {
  const rageTactic = drawTactic("RageT", 0, 1, { threshold: "rr" as never });
  const b = staveBoard(
    [
      { key: "t", def: rageTactic, owner: P2, zone: "hand" },
      ...bank("rage", 2, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("t"));
  b.engine.perform({ type: "endTurn", playerId: P2 });
  const myHand = handOf(b.engine, P1).length;
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("es"), abilityId: "counterfeit", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, myHand + 1, "I have no [R] but the duplicate still happened (CR 307.1)");
});

clause(STAVE, "0:ability:counterfeit", "the duplicate's numeric cost is 0: only 2+X is paid in total for it (CR 307.1)", () => {
  const b = staveBoard([{ key: "t", def: drawTactic("T4", 4), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  const before = ready(b.engine);
  counterfeit(b);
  assert.equal(before - ready(b.engine), 6, "2 + 4, and nothing more for the copy itself");
});

clause(STAVE, "0:ability:counterfeit", "a tactic still on the stack counts as played: used in response to the opponent's tactic it pays 2+X and duplicates that tactic", () => {
  const b = staveBoard(
    [
      { key: "t", def: drawTactic("TheirTactic", 2), owner: P2, zone: "hand" },
      ...bank("obsession", 2, P2)
    ],
    { turn: 2, active: P2 }
  );
  playRaw(b.engine, P2, b.id("t"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "their tactic has been played and I may respond");
  const resources = ready(b.engine);
  const myHand = handOf(b.engine, P1).length;
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("es"), abilityId: "counterfeit", selected: {}, variables: {} });
  assert.equal(resources - ready(b.engine), 2 + 2, "X is 2, the numeric cost of the tactic I am responding to");
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, myHand + 1, "the duplicate of their tactic resolved under my control: I drew");
});

clause(STAVE, "0:ability:counterfeit", "only its controller can use it", () => {
  const b = staveBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }, ...bank("obsession", 4, P2)]);
  play(b.engine, P1, b.id("t"));
  assert.throws(() => counterfeit(b, P2), "the opponent cannot use my Stave");
  assert.equal(isDepleted(b.engine, b.id("es")), false);
});

clause(STAVE, "0:ability:counterfeit", "an ability on a Stave in your hand cannot be used", () => {
  const b = staveBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }], { staveZone: "hand" });
  play(b.engine, P1, b.id("t"));
  assert.throws(() => counterfeit(b));
});

clause(STAVE, "0:ability:counterfeit", "the Stave itself is an item deployed for 2 with [O][O][O][O]", () => {
  const cards = (obsession: number, greed: number): CardPlacement[] => [
    { key: "es2", def: printing(STAVE), owner: P1, zone: "hand" },
    ...bank("obsession", obsession, P1),
    ...bank("greed", greed, P1)
  ];
  const ok = buildGame({ playerA: { faction: developFaction() }, cards: cards(4, 0) });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("es2"));
  assert.equal(zoneOf(ok.engine, ok.id("es2")), "play");
  assert.equal(before - ready(ok.engine), 2, "the printed cost of 2");
  const three = buildGame({ playerA: { faction: developFaction() }, cards: cards(3, 5) });
  assert.throws(() => playRaw(three.engine, P1, three.id("es2")), "only three [O]");
  const short = buildGame({ playerA: { faction: developFaction() }, cards: cards(1, 0) });
  assert.throws(() => playRaw(short.engine, P1, short.id("es2")), "one resource is short of 2");
});

clause(STAVE, "0:ability:counterfeit", "the duplicate keeps the tactic's extra costs: a 'discard a card' extra cost must be paid again, or the duplicate is invalid (no card to discard: no effect)", () => {
  const b = staveBoard([
    { key: "t", def: titheTactic(), owner: P1, zone: "hand" },
    { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "hand" }
  ]);
  const start = influence(b.engine, P2);
  play(b.engine, P1, b.id("t"), { selected: { dc: [b.id("junk")] } });
  assert.equal(influence(b.engine, P2), start - 1, "the tactic itself worked");
  assert.equal(handOf(b.engine, P1).length, 0, "and left me with no card to discard");
  counterfeit(b);
  assert.equal(influence(b.engine, P2), start - 1, "the duplicate could not pay 'discard a card', so it is invalid and has no effect");
});

clause(STAVE, "0:ability:counterfeit", "the duplicate keeps the tactic's extra costs: with a card in hand, the duplicate makes you discard it", () => {
  const b = staveBoard([
    { key: "t", def: titheTactic(), owner: P1, zone: "hand" },
    { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "hand" },
    { key: "junk2", def: character({ name: "Junk2" }), owner: P1, zone: "hand" }
  ]);
  const start = influence(b.engine, P2);
  play(b.engine, P1, b.id("t"), { selected: { dc: [b.id("junk")] } });
  activate(b.engine, P1, b.id("es"), "counterfeit");
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("junk2")] } : declineAll(pc)));
  assert.equal(influence(b.engine, P2), start - 2, "the duplicate's effect happened");
  assert.equal(zoneOf(b.engine, b.id("junk2")), "discard", "and its 'discard a card' extra cost was paid");
});

clause(STAVE, "0:ability:counterfeit", "the duplicate keeps the tactic's extra costs: duplicating Air Travel ('Pick a character') asks for a new pick", () => {
  const b = staveBoard([
    { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("at"), { selected: { target: [b.id("mine")] } });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("es"), abilityId: "counterfeit", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.ok(pc, "the duplicate's extra cost 'Pick a character' has to be paid again: I am asked for a pick");
  assert.equal(pc.playerId, P1);
});

// --- Voidal Replication ---------------------------------------------------------
// Your opponent cannot respond to this card.
// COST: Play this only if a tactic has been played this turn.
// Duplicate the last tactic played this turn. (A duplicate retains all rules text including
// extra costs, which must be paid or the duplicate is invalid and has no effect.)
// Tactic, cost 3, threshold [O][O][O].

const REPLICATION = "7416a581-63a8-495f-a845-f79eeddf2eea";
const CASH_OUT = "f0856cbf-3b0b-43a9-8b30-fbca971a245c";

function replicationBoard(extra: CardPlacement[], opts: { obsession?: number; greed?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "vr", def: printing(REPLICATION), owner: P1, zone: "hand" },
      ...fillers("d", 10, P1, "deck"),
      ...fillers("e", 10, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...extra
    ]
  });
}

clause(REPLICATION, "0:rule", "the opponent gets no response window: Voidal Replication resolves entirely on its own", () => {
  const b = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  const hand = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("vr"));
  assert.equal(b.engine.state.responseWindow, undefined, "no window opens for the opponent");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "it has already resolved: Replication left the hand and the duplicate drew a card");
  assert.equal(zoneOf(b.engine, b.id("vr")), "discard");
});

clause(REPLICATION, "0:rule", "the opponent cannot play a tactic in response to it", () => {
  const b = replicationBoard([
    { key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" },
    { key: "counter", def: drawTactic("Counter", 0), owner: P2, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("t"));
  playRaw(b.engine, P1, b.id("vr"));
  assert.throws(() => playRaw(b.engine, P2, b.id("counter")), "P2 has no response window");
  assert.equal(zoneOf(b.engine, b.id("counter")), "hand");
});

clause(REPLICATION, "1:ability", "cannot be played if no tactic has been played this turn", () => {
  const b = replicationBoard([]);
  assert.throws(() => playRaw(b.engine, P1, b.id("vr")));
  assert.equal(zoneOf(b.engine, b.id("vr")), "hand", "nothing was played");
  assert.equal(ready(b.engine), 12, "nothing was paid");
  assert.equal(b.engine.getCardPlayability(P1, b.id("vr")).playable, false);
});

clause(REPLICATION, "1:ability", "a character, an item or a location deployed this turn is not a tactic", () => {
  const b = replicationBoard([
    { key: "c", def: character({ name: "Guy", cost: 1 }), owner: P1, zone: "hand" },
    { key: "i", def: item({ name: "Widget", cost: 1 }), owner: P1, zone: "hand" },
    { key: "l", def: location({ name: "Hall", cost: 1 }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("c"));
  play(b.engine, P1, b.id("i"));
  play(b.engine, P1, b.id("l"));
  assert.throws(() => playRaw(b.engine, P1, b.id("vr")));
});

clause(REPLICATION, "1:ability", "a tactic played earlier THIS turn enables it, and the tactic may be anyone's (here: the opponent's)", () => {
  const own = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }]);
  assert.equal(own.engine.getCardPlayability(P1, own.id("vr")).playable, false, "before any tactic");
  play(own.engine, P1, own.id("t"));
  assert.equal(own.engine.getCardPlayability(P1, own.id("vr")).playable, true, "after my own tactic");

  const theirs = replicationBoard([{ key: "t", def: drawTactic("TheirT", 0), owner: P2, zone: "hand" }], { turn: 2, active: P2 });
  play(theirs.engine, P2, theirs.id("t"));
  theirs.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(theirs.engine.state.responseWindow?.priorityPlayerId, P1);
  const hand = handOf(theirs.engine, P1).length;
  playRaw(theirs.engine, P1, theirs.id("vr"));
  assert.equal(handOf(theirs.engine, P1).length, hand - 1 + 1, "their tactic was duplicated for me");
});

clause(REPLICATION, "1:ability", "only a tactic played THIS turn counts", () => {
  const b = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.throws(() => playRaw(b.engine, P1, b.id("vr")), "the tactic was played in an earlier turn");
});

clause(REPLICATION, "1:ability", "costs its printed 3 and needs [O][O][O]: refused one resource short or without the icons", () => {
  const shortOf = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }], { obsession: 2 });
  play(shortOf.engine, P1, shortOf.id("t"));
  assert.throws(() => playRaw(shortOf.engine, P1, shortOf.id("vr")), "2 resources for a cost of 3");

  const noIcons = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }], { obsession: 2, greed: 6 });
  play(noIcons.engine, P1, noIcons.id("t"));
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("vr")), "only two [O]");

  const exact = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }], { obsession: 3 });
  play(exact.engine, P1, exact.id("t"));
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("vr"));
  assert.equal(before - ready(exact.engine), 3, "the printed cost of 3 is paid");
});

clause(REPLICATION, "2:rule", "duplicates the last tactic played this turn (cost-1 'draw 1' then cost-3 'draw 2': the second is copied)", () => {
  const b = replicationBoard([
    { key: "a", def: drawTactic("First", 1, 1), owner: P1, zone: "hand" },
    { key: "b", def: drawTactic("Second", 3, 2), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("a"));
  play(b.engine, P1, b.id("b"));
  const hand = handOf(b.engine, P1).length;
  const before = ready(b.engine);
  play(b.engine, P1, b.id("vr"));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2, "Replication left the hand; the copy of the last tactic (draw 2) drew 2");
  assert.equal(before - ready(b.engine), 3, "only Replication's own cost is paid: the copy is free");
});

clause(REPLICATION, "2:rule", "the order matters: cost-3 'draw 2' first, then cost-1 'draw 1': the copy draws 1", () => {
  const b = replicationBoard([
    { key: "b", def: drawTactic("Big", 3, 2), owner: P1, zone: "hand" },
    { key: "a", def: drawTactic("Small", 1, 1), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("b"));
  play(b.engine, P1, b.id("a"));
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("vr"));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1);
});

clause(REPLICATION, "2:rule", "the duplicate needs neither the tactic's numeric cost nor its threshold (CR 307.1)", () => {
  const rageTactic = drawTactic("RageT", 4, 1, { threshold: "rr" as never });
  const b = replicationBoard(
    [
      { key: "t", def: rageTactic, owner: P2, zone: "hand" },
      ...bank("rage", 4, P2)
    ],
    { turn: 2, active: P2, obsession: 3 }
  );
  play(b.engine, P2, b.id("t"));
  b.engine.perform({ type: "endTurn", playerId: P2 });
  const hand = handOf(b.engine, P1).length;
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("vr"));
  assert.equal(before - ready(b.engine), 3, "only Replication's cost of 3, not the copied tactic's 4");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "and I have no [R] but the copy happened");
});

clause(REPLICATION, "2:rule", "a tactic still on the stack counts as the last tactic played: Replication played in response duplicates it", () => {
  const b = replicationBoard(
    [
      { key: "t", def: drawTactic("TheirTactic", 2), owner: P2, zone: "hand" },
      ...bank("obsession", 2, P2)
    ],
    { turn: 2, active: P2 }
  );
  playRaw(b.engine, P2, b.id("t"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  const hand = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("vr"));
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "the copy of their tactic resolved under my control: I drew");
});

clause(REPLICATION, "2:rule", "the duplicate keeps the tactic's extra costs: with no card to discard the duplicate is invalid and has no effect", () => {
  const b = replicationBoard([
    { key: "t", def: titheTactic(), owner: P1, zone: "hand" },
    { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "hand" }
  ]);
  const start = influence(b.engine, P2);
  play(b.engine, P1, b.id("t"), { selected: { dc: [b.id("junk")] } });
  assert.equal(influence(b.engine, P2), start - 1);
  play(b.engine, P1, b.id("vr"));
  assert.equal(influence(b.engine, P2), start - 1, "the duplicate could not pay 'discard a card': no effect");
});

clause(REPLICATION, "2:rule", "the duplicate keeps the tactic's extra costs: with a card in hand, the duplicate makes you discard it", () => {
  const b = replicationBoard([
    { key: "t", def: titheTactic(), owner: P1, zone: "hand" },
    { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "hand" },
    { key: "junk2", def: character({ name: "Junk2" }), owner: P1, zone: "hand" }
  ]);
  const start = influence(b.engine, P2);
  play(b.engine, P1, b.id("t"), { selected: { dc: [b.id("junk")] } });
  play(b.engine, P1, b.id("vr"));
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("junk2")] } : declineAll(pc)));
  assert.equal(influence(b.engine, P2), start - 2);
  assert.equal(zoneOf(b.engine, b.id("junk2")), "discard", "the duplicate's 'discard a card' extra cost was paid");
});

clause(REPLICATION, "2:rule", "the duplicate keeps the tactic's extra costs: duplicating Cash Out (pay twice X) charges twice X again for the copy", () => {
  const b = replicationBoard([{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }], { obsession: 6, greed: 8 });
  play(b.engine, P1, b.id("co"), { variables: { x: 1 } });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("vr"));
  assert.ok(before - ready(b.engine) > 3, "Replication costs 3 and the copy must also pay the extra cost 'pay twice X' (it cannot be free)");
});

clause(REPLICATION, "2:rule", "the duplicate keeps the tactic's extra costs: duplicating Air Travel ('Pick a character') asks for a new pick", () => {
  const b = replicationBoard([
    { key: "at", def: printing(AIR_TRAVEL), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("at"), { selected: { target: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("vr"));
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.ok(pc, "the duplicate's extra cost 'Pick a character' has to be paid again: I am asked for a pick");
  assert.equal(pc.playerId, P1);
});

clause(REPLICATION, "2:rule", "Replication and the original tactic end up in their owners' discard piles; the duplicate leaves no card behind", () => {
  const b = replicationBoard([{ key: "t", def: drawTactic("T", 0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  play(b.engine, P1, b.id("vr"));
  assert.equal(zoneOf(b.engine, b.id("t")), "discard");
  assert.equal(zoneOf(b.engine, b.id("vr")), "discard");
  assert.equal(discardOf(b.engine, P1).length, 2, "exactly the two real cards");
});

// --- Spontaneous Displacement --------------------------------------------------
// COST: Pick a non-resource card. X is half that card's numeric cost, rounded up.
// EFFECT: Put the card into its owner's hand. You may play a non-resource card with
// numeric cost X or less for free. (You still need the proper resource icons and must
// pay any additional costs.) Tactic, cost 4, threshold [O][O][O].

const DISPLACEMENT = "302db228-b2b9-48df-8fd0-288219ffcf16";

function engineDeploy(engine: SpoilsEngine, cardId: string, selected?: Record<string, string[]>) {
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId, selected } } as never);
}

function displacementBoard(opts: { obsession?: number; greed?: number; hand?: CardDefinition[]; foeCosts?: number[] } = {}) {
  const hand = opts.hand ?? Array.from({ length: 10 }, (_, i) => character({ name: `H${i}`, cost: i }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sd", def: printing(DISPLACEMENT), owner: P1, zone: "hand" },
      ...hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...(opts.foeCosts ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((cost) => ({ key: `foe${cost}`, def: character({ name: `Foe${cost}`, cost }), owner: P2, zone: "play" as const })),
      { key: "myChar", def: character({ name: "MyChar", cost: 1 }), owner: P1, zone: "play" },
      { key: "myChar0", def: character({ name: "MyChar0", cost: 0 }), owner: P1, zone: "play" },
      { key: "myChar2", def: character({ name: "MyChar2", cost: 2 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem", cost: 3 }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", cost: 5 }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem", cost: 6 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", cost: 4 }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", cost: 1 }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown", cost: 1 }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHand", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const sdPlay = (b: ReturnType<typeof displacementBoard>, target: string) => play(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id(target)] } });

for (let cost = 0; cost <= 9; cost++) {
  const x = Math.ceil(cost / 2);
  clause(DISPLACEMENT, "0:ability", `picked card of numeric cost ${cost}: X is half rounded up = ${x}, so cards of cost ${x} or less are offered (and none dearer)`, () => {
    const b = displacementBoard();
    const resources = ready(b.engine);
    sdPlay(b, `foe${cost}`);
    assert.equal(resources - ready(b.engine), 4, "the printed cost of 4 is paid");
    assert.equal(zoneOf(b.engine, b.id(`foe${cost}`)), "hand", "the picked card went to its owner's hand");
    assert.equal(handOf(b.engine, P2).includes(b.id(`foe${cost}`)), true);
    assert.deepEqual(
      offered(b.engine),
      Array.from({ length: x + 1 }, (_, i) => `H${i}`).sort(),
      `X=${x}`
    );
  });
}

clause(DISPLACEMENT, "0:ability", "the free play: exactly cost X is allowed, X+1 is refused; the card is played and no resources are spent", () => {
  const b = displacementBoard();
  sdPlay(b, "foe6"); // X = 3
  assert.throws(() => engineDeploy(b.engine, b.id("h:H4")), "cost 4 is more than X=3");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:H3"));
  assert.equal(zoneOf(b.engine, b.id("h:H3")), "play");
  assert.equal(ready(b.engine), resources, "for free: nothing paid");
  assert.equal(zoneOf(b.engine, b.id("h:H2")), "hand", "only one card is played");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(DISPLACEMENT, "0:ability", "'may': declining plays nothing", () => {
  const b = displacementBoard();
  sdPlay(b, "foe6");
  const resources = ready(b.engine);
  freePlay(b.engine, undefined);
  for (let i = 0; i < 10; i++) assert.equal(zoneOf(b.engine, b.id(`h:H${i}`)), "hand", `H${i}`);
  assert.equal(ready(b.engine), resources);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard");
});

clause(DISPLACEMENT, "0:ability", "a card you control is put into YOUR hand and is itself a candidate when its cost is 1 or less (cost 1: X=1; cost 0: X=0)", () => {
  const one = displacementBoard();
  sdPlay(one, "myChar");
  assert.equal(handOf(one.engine, P1).includes(one.id("myChar")), true, "in my hand");
  assert.ok(offered(one.engine).includes("MyChar"), "the card I just bounced (cost 1, X=1) can be replayed for free");
  freePlay(one.engine, one.id("myChar"));
  assert.equal(zoneOf(one.engine, one.id("myChar")), "play", "replayed");

  const zero = displacementBoard();
  sdPlay(zero, "myChar0");
  assert.ok(offered(zero.engine).includes("MyChar0"), "cost 0, X=0: the bounced card itself is a candidate");
  assert.deepEqual(offered(zero.engine), ["H0", "MyChar0"]);
});

clause(DISPLACEMENT, "0:ability", "a bounced card of cost 2 (X=1) is NOT a candidate: its cost is more than X", () => {
  const b = displacementBoard();
  sdPlay(b, "myChar2");
  assert.deepEqual(offered(b.engine), ["H0", "H1"]);
  assert.equal(handOf(b.engine, P1).includes(b.id("myChar2")), true);
});

clause(DISPLACEMENT, "0:ability", "the picked card can be a character, an item or a location, yours or the opponent's", () => {
  for (const [key, owner] of [
    ["myChar", P1],
    ["myItem", P1],
    ["myLoc", P1],
    ["foe2", P2],
    ["foeItem", P2],
    ["foeLoc", P2]
  ] as const) {
    const b = displacementBoard();
    sdPlay(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
    assert.equal(handOf(b.engine, owner).includes(b.id(key)), true, `${key} is in its owner's hand`);
    drain(b.engine, declineAll);
  }
});

clause(DISPLACEMENT, "0:ability", "an opponent's card is put into the OPPONENT's hand and is not offered to you; a card you control but do not own goes to its owner, one you own but they control comes to you", () => {
  const stolen = displacementBoard();
  sdPlay(stolen, "stolen");
  assert.equal(handOf(stolen.engine, P2).includes(stolen.id("stolen")), true, "owned by P2: back to P2's hand");
  assert.equal(offered(stolen.engine).includes("Stolen"), false, "not in my hand, so not a candidate");
  drain(stolen.engine, declineAll);

  const lent = displacementBoard();
  sdPlay(lent, "lent");
  assert.equal(handOf(lent.engine, P1).includes(lent.id("lent")), true, "owned by P1: into P1's hand");
  assert.ok(offered(lent.engine).includes("Lent"), "and it is a candidate (cost 1, X=1)");
});

clause(DISPLACEMENT, "0:ability", "only non-resource cards can be played for free: a resource card in hand is not offered", () => {
  const b = displacementBoard({ hand: [character({ name: "Cheap", cost: 0 }), resourceCard({ name: "Staple", cost: 0 })] });
  sdPlay(b, "foe0");
  assert.deepEqual(offered(b.engine), ["Cheap"]);
  assert.throws(() => engineDeploy(b.engine, b.id("h:Staple")), "a resource");
});

clause(DISPLACEMENT, "0:ability", "you still need the proper resource icons for the free play", () => {
  const b = displacementBoard({
    hand: [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never }), character({ name: "NeedsObsession", cost: 1, threshold: "o" as never })]
  });
  sdPlay(b, "foe2");
  assert.throws(() => engineDeploy(b.engine, b.id("h:NeedsRage")), "no [R]: refused");
  assert.equal(zoneOf(b.engine, b.id("h:NeedsRage")), "hand");
  freePlay(b.engine, b.id("h:NeedsObsession"));
  assert.equal(zoneOf(b.engine, b.id("h:NeedsObsession")), "play");
});

clause(DISPLACEMENT, "0:ability", "you must pay any additional costs of the free-played card: a card needing a pick is refused without it", () => {
  const sniper = tactic({
    name: "Sniper",
    cost: 1,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = displacementBoard({ hand: [sniper] });
  sdPlay(b, "foe2");
  assert.throws(() => engineDeploy(b.engine, b.id("h:Sniper")), "no target picked");
  freePlay(b.engine, b.id("h:Sniper"), { t: [b.id("foe0")] });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("foe0")), "discard", "it did its job");
});

clause(DISPLACEMENT, "0:ability", "you must pay any additional costs of the free-played card: an extra 'pay 2' cost is still paid", () => {
  const costly = tactic({
    name: "Costly",
    cost: 1,
    behavior: { abilities: [{ id: "c", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = displacementBoard({ hand: [costly] });
  sdPlay(b, "foe2");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:Costly"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("h:Costly")), "discard");
  assert.equal(resources - ready(b.engine), 2, "only the numeric cost is free; the extra 'pay 2' is paid");
});

clause(DISPLACEMENT, "0:ability", "only cards in YOUR hand are candidates (not your discard pile, your deck, or the opponent's hand)", () => {
  const b = displacementBoard({ hand: [character({ name: "InHand", cost: 0 })], foeCosts: [4] });
  sdPlay(b, "foe4");
  assert.deepEqual(offered(b.engine), ["InHand"], "InDiscard, OppHand and the bounced Foe4 (in their hand) are not offered");
  assert.throws(() => engineDeploy(b.engine, b.id("oppHand")), "the opponent's hand");
  assert.throws(() => engineDeploy(b.engine, b.id("inDiscard")), "my discard pile");
});

clause(DISPLACEMENT, "0:ability", "the free play can be a character, an item, a location or a tactic", () => {
  const defs = [
    character({ name: "Guy", cost: 1 }),
    item({ name: "Widget", cost: 1 }),
    location({ name: "Hall", cost: 1, structure: 3 }),
    drawTactic("Cantrip", 1)
  ];
  for (const def of defs) {
    const b = displacementBoard({ hand: [def] });
    sdPlay(b, "foe2");
    assert.deepEqual(offered(b.engine), [def.name]);
    freePlay(b.engine, b.id(`h:${def.name}`));
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id(`h:${def.name}`)), def.type === "tactic" ? "discard" : "play", def.name);
  }
});

clause(DISPLACEMENT, "0:ability", "the pick must be a non-resource card in play: resources, face-down cards, factions, cards in hand or discard are refused", () => {
  const b = displacementBoard();
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [cardId] } });
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(b.id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(factionOf(b.engine, P1)), "your faction");
  assert.throws(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  assert.throws(attempt(b.id("h:H3")), "a card in hand");
  assert.throws(attempt(b.id("inDiscard")), "a card in a discard pile");
  assert.throws(() => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [] } }), "a pick is required");
  assert.throws(() => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id("foe1"), b.id("foe2")] } }), "only one card");
  assert.equal(zoneOf(b.engine, b.id("sd")), "hand", "nothing was played");
  attempt(b.id("foe3"))();
  assert.ok(b.engine.state.responseWindow, "a non-resource card in play is accepted");
});

clause(DISPLACEMENT, "0:ability", "the card is put into its owner's hand when the tactic resolves; the cost is paid when it is played", () => {
  const b = displacementBoard();
  const resources = ready(b.engine);
  playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id("foe4")] } });
  assert.equal(resources - ready(b.engine), 4);
  assert.equal(zoneOf(b.engine, b.id("foe4")), "play", "not yet bounced");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
});

clause(DISPLACEMENT, "0:ability", "is refused one resource short of its cost of 4, and without [O][O][O]", () => {
  const short = displacementBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sd"), { selected: { bounced: [short.id("foe2")] } }));
  const noIcons = displacementBoard({ obsession: 2, greed: 6 });
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("sd"), { selected: { bounced: [noIcons.id("foe2")] } }));
  const exact = displacementBoard({ obsession: 4 });
  sdPlay(exact, "foe2");
  assert.equal(zoneOf(exact.engine, exact.id("foe2")), "hand");
  const mixed = displacementBoard({ obsession: 3, greed: 1 });
  sdPlay(mixed, "foe2");
  assert.equal(zoneOf(mixed.engine, mixed.id("foe2")), "hand", "[O][O][O] plus one other resource is enough");
});

// --- Stolen Inspiration ---------------------------------------------------------
// Look at your opponent's hand and pick a non-resource card. Your opponent must discard
// that card.
// You may play a non-resource card with numeric cost X or less for free, where X is half
// the numeric cost of the discarded card, rounded up. (You still need the proper resource
// icons and must pay any additional costs.)
// Tactic, cost 3, threshold [O][O].

const INSPIRATION = "977b96ef-93fb-4902-bde1-24469e94d9ab";

function inspirationBoard(opts: { obsession?: number; greed?: number; p1Hand?: CardDefinition[]; p2Hand?: CardDefinition[] } = {}) {
  const p1Hand = opts.p1Hand ?? Array.from({ length: 10 }, (_, i) => character({ name: `H${i}`, cost: i }));
  const p2Hand = opts.p2Hand ?? [...Array.from({ length: 10 }, (_, i) => character({ name: `O${i}`, cost: i })), resourceCard({ name: "OStaple" })];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "si", def: printing(INSPIRATION), owner: P1, zone: "hand" },
      ...p1Hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...p2Hand.map((def) => ({ key: `o:${def.name}`, def, owner: P2, zone: "hand" as const })),
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 0 }), owner: P1, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 0 }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

// E3b: "Look at your opponent's hand and pick a non-resource card" is rules text (an EFFECT), not a cost: nothing is picked when
// the tactic is played. The caster picks `discardKey` when it resolves.
const siPlay = (b: ReturnType<typeof inspirationBoard>, discardKey: string) => {
  play(b.engine, P1, b.id("si"), { selected: {} });
  pick(b.engine, P1, [b.id(discardKey)]);
};

for (let cost = 0; cost <= 9; cost++) {
  const x = Math.ceil(cost / 2);
  clause(INSPIRATION, "0:rule", `the picked card (cost ${cost}) is discarded by the opponent and nothing else of theirs is`, () => {
    const b = inspirationBoard();
    const before = ready(b.engine);
    const theirHand = [...handOf(b.engine, P2)];
    siPlay(b, `o:O${cost}`);
    assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
    assert.equal(zoneOf(b.engine, b.id(`o:O${cost}`)), "discard");
    assert.equal(discardOf(b.engine, P2).includes(b.id(`o:O${cost}`)), true, "into THEIR discard pile");
    assert.deepEqual([...handOf(b.engine, P2)].sort(), theirHand.filter((c) => c !== b.id(`o:O${cost}`)).sort(), "the rest of their hand is untouched");
    assert.equal(discardOf(b.engine, P2).length, 1);
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id("si")), "discard");
  });

  clause(INSPIRATION, "1:rule", `discarded card of numeric cost ${cost}: X is half rounded up = ${x}, so cards of cost ${x} or less are offered (and none dearer)`, () => {
    const b = inspirationBoard();
    siPlay(b, `o:O${cost}`);
    assert.deepEqual(
      offered(b.engine),
      Array.from({ length: x + 1 }, (_, i) => `H${i}`).sort(),
      `X=${x}`
    );
  });
}

clause(INSPIRATION, "0:rule", "you pick which card: any non-resource card of their hand can be the one", () => {
  for (const cost of [0, 5, 9]) {
    const b = inspirationBoard();
    siPlay(b, `o:O${cost}`);
    assert.equal(zoneOf(b.engine, b.id(`o:O${cost}`)), "discard", `O${cost}`);
    for (const rest of [0, 5, 9].filter((c) => c !== cost)) assert.equal(zoneOf(b.engine, b.id(`o:O${rest}`)), "hand", `O${rest} stays`);
  }
});

clause(INSPIRATION, "0:rule", "a resource card in their hand cannot be picked, nor can a card of yours, a card in play or one in a discard pile", () => {
  // The pick is made when the tactic resolves (E3b): a bad answer is refused and leaves the pick open.
  const b = inspirationBoard();
  play(b.engine, P1, b.id("si"), { selected: {} });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  const attempt = (key: string) => () => pickRaw(b.engine, P1, [b.id(key)]);
  assert.throws(attempt("o:OStaple"), "a resource card");
  assert.throws(attempt("h:H3"), "a card in my own hand");
  assert.throws(attempt("inPlay"), "a card in play");
  assert.throws(attempt("inDiscard"), "a card in a discard pile");
  assert.throws(() => pickRaw(b.engine, P1, [b.id("o:O1"), b.id("o:O2")]), "only one card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "every bad answer left the pick open");
  attempt("o:O1")();
  assert.equal(zoneOf(b.engine, b.id("o:O1")), "discard", "control: a non-resource card of their hand is accepted");
});

clause(INSPIRATION, "0:rule", "the pick is made when the tactic RESOLVES (it is rules text, not a cost): it can be played with no pick and you are asked afterwards", () => {
  const b = inspirationBoard();
  playRaw(b.engine, P1, b.id("si"));
  assert.ok(b.engine.state.responseWindow, "the tactic is being deployed with no pick made yet");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "when it resolves I look at their hand and pick");
  assert.equal(pc.playerId, P1, "I am the one who picks");
  pick(b.engine, P1, [b.id("o:O4")]);
  assert.equal(zoneOf(b.engine, b.id("o:O4")), "discard");
});

clause(INSPIRATION, "0:rule", "with no non-resource card in their hand the tactic can still be played; nothing is discarded and nothing can be played for free", () => {
  const b = inspirationBoard({ p2Hand: [resourceCard({ name: "OStaple" })] });
  const resources = ready(b.engine);
  playRaw(b.engine, P1, b.id("si"));
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(resources - ready(b.engine), 3, "it was played and paid for");
  assert.equal(zoneOf(b.engine, b.id("o:OStaple")), "hand", "the resource card stays in their hand");
  assert.equal(zoneOf(b.engine, b.id("si")), "discard");
});

clause(INSPIRATION, "1:rule", "the free play: exactly cost X is allowed, X+1 is refused; the card is played and no resources are spent", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6"); // X = 3
  assert.throws(() => engineDeploy(b.engine, b.id("h:H4")), "cost 4 is more than X=3");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:H3"));
  assert.equal(zoneOf(b.engine, b.id("h:H3")), "play");
  assert.equal(ready(b.engine), resources, "for free: nothing paid");
  assert.equal(zoneOf(b.engine, b.id("h:H2")), "hand", "only one card is played");
});

clause(INSPIRATION, "1:rule", "'may': declining plays nothing", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6");
  freePlay(b.engine, undefined);
  for (let i = 0; i < 10; i++) assert.equal(zoneOf(b.engine, b.id(`h:H${i}`)), "hand", `H${i}`);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("o:O6")), "discard", "the discard happened regardless");
});

clause(INSPIRATION, "1:rule", "only non-resource cards of YOUR hand can be played; resource cards are never offered", () => {
  const b = inspirationBoard({ p1Hand: [character({ name: "Cheap", cost: 0 }), resourceCard({ name: "Staple", cost: 0 })] });
  siPlay(b, "o:O2");
  assert.deepEqual(offered(b.engine), ["Cheap"]);
  assert.throws(() => engineDeploy(b.engine, b.id("h:Staple")));
  assert.throws(() => engineDeploy(b.engine, b.id("o:O0")), "the opponent's hand");
  assert.throws(() => engineDeploy(b.engine, b.id("inDiscard")), "my discard pile");
});

clause(INSPIRATION, "1:rule", "you still need the proper resource icons for the free play", () => {
  const b = inspirationBoard({
    p1Hand: [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never }), character({ name: "NeedsObsession", cost: 1, threshold: "o" as never })]
  });
  siPlay(b, "o:O2");
  assert.throws(() => engineDeploy(b.engine, b.id("h:NeedsRage")), "no [R]: refused");
  assert.equal(zoneOf(b.engine, b.id("h:NeedsRage")), "hand");
  freePlay(b.engine, b.id("h:NeedsObsession"));
  assert.equal(zoneOf(b.engine, b.id("h:NeedsObsession")), "play");
});

clause(INSPIRATION, "1:rule", "you must pay any additional costs of the free-played card: a card needing a pick is refused without it", () => {
  const sniper = tactic({
    name: "Sniper",
    cost: 1,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = inspirationBoard({ p1Hand: [sniper] });
  siPlay(b, "o:O2");
  assert.throws(() => engineDeploy(b.engine, b.id("h:Sniper")), "no target picked");
  freePlay(b.engine, b.id("h:Sniper"), { t: [b.id("inPlay")] });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("inPlay")), "discard");
});

clause(INSPIRATION, "1:rule", "you must pay any additional costs of the free-played card: an extra 'pay 2' cost is still paid", () => {
  const costly = tactic({
    name: "Costly",
    cost: 1,
    behavior: { abilities: [{ id: "c", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = inspirationBoard({ p1Hand: [costly] });
  siPlay(b, "o:O2");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:Costly"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("h:Costly")), "discard");
  assert.equal(resources - ready(b.engine), 2, "only the numeric cost is free; the extra 'pay 2' is paid");
});

clause(INSPIRATION, "1:rule", "the free play can be a character, an item, a location or a tactic", () => {
  const defs = [character({ name: "Guy", cost: 1 }), item({ name: "Widget", cost: 1 }), location({ name: "Hall", cost: 1, structure: 3 }), drawTactic("Cantrip", 1)];
  for (const def of defs) {
    const b = inspirationBoard({ p1Hand: [def] });
    siPlay(b, "o:O2");
    assert.deepEqual(offered(b.engine), [def.name]);
    freePlay(b.engine, b.id(`h:${def.name}`));
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id(`h:${def.name}`)), def.type === "tactic" ? "discard" : "play", def.name);
  }
});

clause(INSPIRATION, "1:rule", "the free play happens after the discard, and I (the caster) decide on it", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6");
  assert.equal(zoneOf(b.engine, b.id("o:O6")), "discard");
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  assert.equal(pending(b.engine)?.playerId, P1, "I decide on the free play");
});

clause(INSPIRATION, "0:rule", "is refused one resource short of its cost of 3, and without [O][O]", () => {
  const short = inspirationBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("si"), { selected: {} }));
  assert.equal(zoneOf(short.engine, short.id("si")), "hand");
  const noIcons = inspirationBoard({ obsession: 1, greed: 6 });
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("si"), { selected: {} }));
  const exact = inspirationBoard({ obsession: 3 });
  siPlay(exact, "o:O2");
  assert.equal(zoneOf(exact.engine, exact.id("o:O2")), "discard");
  const mixed = inspirationBoard({ obsession: 2, greed: 1 });
  siPlay(mixed, "o:O2");
  assert.equal(zoneOf(mixed.engine, mixed.id("o:O2")), "discard", "[O][O] plus one other resource is enough");
});

// --- Gargantuan Garbler ----------------------------------------------------------
// COVERT. If this card attacks, you may pick a character. If you do, put that character
// into its owner's hand. Character (lurker), cost 9, threshold [O][O][O][O], 6 strength /
// 3 speed / 6 life.

const GARBLER = "7c11bd8a-1c56-4a21-9f6a-f7d9c5acd05f";

clause(GARBLER, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(GARBLER));

// The shared COVERT helpers declare an attack and cannot answer the Garbler's own attack trigger, so the two
// battle checks are spelled out here with that (declined) choice answered.
function covertGarblerBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "subject", def: printing(GARBLER), owner: P1, zone: "play" },
      { key: "plainAlly", def: character({ name: "PlainAlly" }), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
}

function declareGarblerAttack(b: ReturnType<typeof covertGarblerBoard>, attackers: string[]) {
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers.map(b.id), target: { type: "faction", playerId: P2 } });
  pick(b.engine, P1, []);
}

clause(GARBLER, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => {
  const b = covertGarblerBoard();
  declareGarblerAttack(b, ["subject"]);
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker"), b.id("covertBlocker")] }), "...nor join a covert blocker in the blocking party");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covertBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")], "a covert character may block it");
});

clause(GARBLER, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => {
  const b = covertGarblerBoard();
  declareGarblerAttack(b, ["subject", "plainAlly"]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")], "with a non-covert member the party is not covert, so anyone may block");
});
clause(GARBLER, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(GARBLER));

clause(GARBLER, "0:kw:COVERT", "is a 6-strength, 6-life, 3-speed lurker character that deploys for 9 with [O][O][O][O]", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "gg", def: printing(GARBLER), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(9, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("gg"));
  assert.equal(zoneOf(ok.engine, ok.id("gg")), "play");
  assert.equal(before - ready(ok.engine), 9, "the printed cost of 9");
  assert.deepEqual(stats(ok.engine, ok.id("gg")), [6, 6, 3], "6 strength, 6 life, 3 speed");
  assert.deepEqual(ok.engine.getDefinition(ok.id("gg")).subtype, ["lurker"]);
  assert.equal(ok.engine.getDefinition(ok.id("gg")).type, "character");

  const short = board(8, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("gg")), "8 resources for a cost of 9");
  const noIcons = board(3, 9);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("gg")), "only three [O]");
  const mixed = board(4, 5);
  play(mixed.engine, P1, mixed.id("gg"));
  assert.equal(zoneOf(mixed.engine, mixed.id("gg")), "play", "[O]x4 plus 5 other resources is enough");
});

function garblerBoard(opts: { turn?: number; extra?: CardPlacement[]; garblerController?: Pid; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active,
    cards: [
      { key: "gg", def: printing(GARBLER), owner: P1, zone: "play", controller: opts.garblerController },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

/** P1 attacks with `attackerKeys`; returns the board with the Garbler's "may pick a character" choice open. */
function garblerAttacks(b: ReturnType<typeof garblerBoard>, attackerKeys: string[] = ["gg"], player: Pid = P1) {
  b.engine.perform({ type: "declareAttack", playerId: player, attackerIds: attackerKeys.map(b.id), target: { type: "faction", playerId: other(player) } });
}

clause(GARBLER, "1:rule", "when it attacks you are asked, as its controller, whether to pick a character", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Garbler's controller picks");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("gg")]);
});

for (const [label, key, owner] of [
  ["an opponent's character", "foe1", P2],
  ["one of your own characters", "ally", P1]
] as const) {
  clause(GARBLER, "1:rule", `you may pick ${label}: it is put into its owner's hand and nothing else moves`, () => {
    const b = garblerBoard();
    garblerAttacks(b);
    pick(b.engine, P1, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand");
    assert.equal(handOf(b.engine, owner).includes(b.id(key)), true, "in its owner's hand");
    for (const rest of ["gg", "ally", "foe1", "foe2"].filter((k) => k !== key)) assert.equal(zoneOf(b.engine, b.id(rest)), "play", `${rest} stays in play`);
    assert.equal(zoneOf(b.engine, b.id("oppHand")), "hand");
    assert.equal(zoneOf(b.engine, b.id("myHand")), "hand");
  });
}

clause(GARBLER, "1:rule", "'may ... If you do': declining puts no character into any hand", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  pick(b.engine, P1, []);
  for (const key of ["gg", "ally", "foe1", "foe2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("gg")], "the attack goes on");
});

clause(GARBLER, "1:rule", "you may pick a character in your own attacking party: it is put into your hand and leaves the battle", () => {
  const b = garblerBoard();
  garblerAttacks(b, ["gg", "ally"]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "asked once for the party, not once per member");
  pick(b.engine, P1, [b.id("ally")]);
  assert.equal(zoneOf(b.engine, b.id("ally")), "hand");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("gg")], "only the Garbler is left in the party");
});

clause(GARBLER, "1:rule", "the Garbler can pick itself: it goes to your hand and the attack is over", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  pick(b.engine, P1, [b.id("gg")]);
  assert.equal(zoneOf(b.engine, b.id("gg")), "hand");
  assert.deepEqual(battleOf(b.engine)?.attackingParty ?? [], [], "nobody attacks any more");
});

clause(GARBLER, "1:rule", "it happens when the attack is declared, before blockers: a bounced would-be blocker cannot block, so the attack is unblocked", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gg", def: printing(GARBLER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  const startInfluence = influence(b.engine, P2);
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("gg")], target: { type: "faction", playerId: P2 } });
  pick(b.engine, P1, [b.id("foe")]);
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] }), "the bounced character is not in play");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), startInfluence - 6, "the Garbler's 6 strength hits the faction unblocked");
});

clause(GARBLER, "1:rule", "the pick must be a character in play: items, locations, factions, face-down cards, resources and cards in hand or discard are refused", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource") ?? b.engine.state.players[P2].play.find((c) => b.engine.getDefinition(c).type === "resource");
  const attempt = (cardId: string) => () => pickRaw(b.engine, P1, [cardId]);
  assert.throws(attempt(b.id("foeItem")), "an item");
  assert.throws(attempt(b.id("foeLoc")), "a location");
  assert.throws(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  assert.throws(attempt(factionOf(b.engine, P1)), "my faction");
  assert.throws(attempt(b.id("hidden")), "a face-down card is only a resource");
  assert.throws(attempt(b.id("oppHand")), "a card in their hand");
  assert.throws(attempt(b.id("myHand")), "a card in my hand");
  assert.throws(attempt(b.id("inDiscard")), "a card in a discard pile");
  if (resourceId) assert.throws(attempt(resourceId), "a resource");
  assert.throws(() => pickRaw(b.engine, P1, [b.id("foe1"), b.id("foe2")]), "only one character");
  attempt(b.id("foe2"))();
  assert.equal(zoneOf(b.engine, b.id("foe2")), "hand");
});

clause(GARBLER, "1:rule", "a character you control but do not own goes to its OWNER's hand", () => {
  const b = garblerBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  garblerAttacks(b);
  pick(b.engine, P1, [b.id("stolen")]);
  assert.equal(handOf(b.engine, P2).includes(b.id("stolen")), true, "owned by P2");
  const c = garblerBoard({
    extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }]
  });
  garblerAttacks(c);
  pick(c.engine, P1, [c.id("lent")]);
  assert.equal(handOf(c.engine, P1).includes(c.id("lent")), true, "owned by P1");
});

clause(GARBLER, "1:rule", "only when THIS card attacks: another character attacking while the Garbler stays home does not trigger it", () => {
  const b = garblerBoard();
  garblerAttacks(b, ["ally"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice is offered");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("ally")]);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "play");
});

clause(GARBLER, "1:rule", "blocking is not attacking: as a blocker (covert party) it does not trigger", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "gg", def: printing(GARBLER), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("covertAttacker")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("gg")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(GARBLER, "1:rule", "an opponent who controls the Garbler is the one who picks when it attacks", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "gg", def: printing(GARBLER), owner: P1, zone: "play", controller: P2 },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" }
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("gg")], target: { type: "faction", playerId: P1 } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "its controller");
  pick(b.engine, P2, [b.id("mine")]);
  assert.equal(handOf(b.engine, P1).includes(b.id("mine")), true);
});

clause(GARBLER, "1:rule", "it triggers every time it attacks (a second attack on a later turn asks again)", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  pick(b.engine, P1, []);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  garblerAttacks(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "asked again on the next attack");
});

// --- Land Shark --------------------------------------------------------------------
// COVERT. This card gains 1 strength and 1 life for each face-down resource your opponent
// controls. Character (lurker), cost 4, threshold [O][O][O], 0 strength / 3 speed / 0 life.

const SHARK = "7c9b4275-fb54-4426-bbf5-9290accc9892";

clause(SHARK, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(SHARK));

// The shared COVERT helpers use boards with no face-down resource, where a Land Shark would have 0 life. These checks
// spell the same battles out with two face-down resources of the opponent's, so the Shark is a living 2/2.
function sharkCovertBoard(sharkOwner: Pid) {
  const foe = other(sharkOwner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: sharkOwner,
    cards: [
      { key: "subject", def: printing(SHARK), owner: sharkOwner, zone: "play" },
      { key: "plainAlly", def: character({ name: "PlainAlly" }), owner: sharkOwner, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: foe, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: foe, zone: "play" },
      ...volition(2, foe)
    ]
  });
}

clause(SHARK, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => {
  const b = sharkCovertBoard(P1);
  declareAttackBy(b.engine, P1, [b.id("subject")]);
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker"), b.id("covertBlocker")] }), "...nor join a covert blocker in the blocking party");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covertBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")], "a covert character may block it");
});

clause(SHARK, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => {
  const b = sharkCovertBoard(P1);
  declareAttackBy(b.engine, P1, [b.id("subject"), b.id("plainAlly")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")], "with a non-covert member the party is not covert, so anyone may block");
});

clause(SHARK, "0:kw:COVERT", "as a covert character it can block only covert parties", () => {
  const plain = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(SHARK), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P1, zone: "play" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" },
      ...volition(2, P2)
    ]
  });
  declareAttackBy(plain.engine, P2, [plain.id("plainAttacker")]);
  assert.throws(() => plain.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [plain.id("subject")] }), "a covert character may block only a covert party");
  plain.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [plain.id("plainBlocker")] });
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("plainBlocker")], "control: a plain character can block the plain attacker");

  const covert = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(SHARK), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...volition(2, P2)
    ]
  });
  declareAttackBy(covert.engine, P2, [covert.id("covertAttacker")]);
  covert.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [covert.id("subject")] });
  assert.deepEqual(battleOf(covert.engine)?.blockingParty, [covert.id("subject")], "it can block a covert party");
});

clause(SHARK, "0:kw:COVERT", "deploys for 4 with [O][O][O] as a lurker character with speed 3", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ls", def: printing(SHARK), owner: P1, zone: "hand" },
        ...volition(2, P2),
        ...bank("obsession", obsession, P1),
        ...bank("greed", greed, P1)
      ]
    });
  const ok = board(4, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ls"));
  assert.equal(zoneOf(ok.engine, ok.id("ls")), "play");
  assert.equal(before - ready(ok.engine), 4, "the printed cost of 4");
  assert.deepEqual(ok.engine.getDefinition(ok.id("ls")).subtype, ["lurker"]);
  assert.equal(ok.engine.getStat(ok.id("ls"), "speed"), 3);
  assert.throws(() => playRaw(board(3, 0).engine, P1, board(3, 0).id("ls")), "short of 4");
  const noIcons = board(2, 6);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("ls")), "only two [O]");
  const mixed = board(3, 1);
  play(mixed.engine, P1, mixed.id("ls"));
  assert.equal(zoneOf(mixed.engine, mixed.id("ls")), "play", "[O][O][O] plus one other resource");
});

function sharkBoard(oppFaceDown: number, extra: CardPlacement[] = [], opts: { controller?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ls", def: printing(SHARK), owner: P1, zone: "play", controller: opts.controller },
      ...volition(oppFaceDown, P2),
      ...extra
    ]
  });
}

for (const n of [1, 2, 3, 5, 8]) {
  clause(SHARK, "1:rule", `with ${n} face-down resource(s) controlled by the opponent it has ${n} strength and ${n} life (speed stays 3)`, () => {
    const b = sharkBoard(n);
    assert.deepEqual(stats(b.engine, b.id("ls")), [n, n, 3]);
  });
}

clause(SHARK, "1:rule", "only the OPPONENT's face-down resources count: your own face-down resources add nothing", () => {
  const b = sharkBoard(2, volition(4, P1));
  assert.deepEqual(stats(b.engine, b.id("ls")), [2, 2, 3]);
});

clause(SHARK, "1:rule", "only FACE-DOWN resources count: the opponent's face-up resources add nothing", () => {
  const b = sharkBoard(2, bank("rage", 5, P2));
  assert.deepEqual(stats(b.engine, b.id("ls")), [2, 2, 3]);
});

clause(SHARK, "1:rule", "any face-down card of theirs is a face-down resource, even a non-resource card played face-down", () => {
  const b = sharkBoard(0, [
    { key: "fdChar", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "fdItem", def: item({ name: "HiddenItem" }), owner: P2, zone: "play", faceDown: true },
    { key: "fdRes", def: resourceCard({ name: "Staple" }), owner: P2, zone: "play", faceDown: true }
  ]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [3, 3, 3]);
});

clause(SHARK, "1:rule", "face-up non-resource cards of theirs do not count", () => {
  const b = sharkBoard(1, [
    { key: "c", def: character({ name: "Guy" }), owner: P2, zone: "play" },
    { key: "i", def: item({ name: "Widget" }), owner: P2, zone: "play" }
  ]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [1, 1, 3]);
});

clause(SHARK, "1:rule", "the bonus follows the board: turning one of their resources face-up lowers it, a new face-down resource raises it", () => {
  const b = sharkBoard(3, [{ key: "extra", def: character({ name: "Extra" }), owner: P2, zone: "play", faceDown: true }]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [4, 4, 3]);
  b.engine.state.cards[b.id("extra")].faceDown = false;
  assert.deepEqual(stats(b.engine, b.id("ls")), [3, 3, 3], "one fewer face-down resource");
  b.engine.state.cards[b.id("extra")].faceDown = true;
  assert.deepEqual(stats(b.engine, b.id("ls")), [4, 4, 3], "face-down again");
});

clause(SHARK, "1:rule", "only this card gains the bonus: other characters of either player are unchanged", () => {
  const b = sharkBoard(3, [
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" }
  ]);
  assert.deepEqual(stats(b.engine, b.id("ally")), [2, 2, 2]);
  assert.deepEqual(stats(b.engine, b.id("foe")), [2, 2, 2]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [3, 3, 3]);
});

clause(SHARK, "1:rule", "'your opponent' is the Shark's controller's opponent: a Shark controlled by the other player counts the face-down resources of its OWNER", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ls", def: printing(SHARK), owner: P1, zone: "play", controller: P2 },
      ...volition(4, P1),
      ...volition(1, P2)
    ]
  });
  assert.deepEqual(stats(b.engine, b.id("ls")), [4, 4, 3], "P2 controls it, so it counts P1's 4 face-down resources and not P2's 1");
});

clause(SHARK, "1:rule", "'your opponent controls': a face-down resource owned by me but controlled by the opponent counts, one owned by them but controlled by me does not", () => {
  const b = sharkBoard(0, [
    { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", faceDown: true, controller: P2 },
    { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", faceDown: true, controller: P1 }
  ]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [1, 1, 3], "only the face-down card the opponent controls counts");
});

clause(SHARK, "1:rule", "two Land Sharks each count the face-down resources", () => {
  const b = sharkBoard(3, [{ key: "ls2", def: printing(SHARK), owner: P1, zone: "play" }]);
  assert.deepEqual(stats(b.engine, b.id("ls")), [3, 3, 3]);
  assert.deepEqual(stats(b.engine, b.id("ls2")), [3, 3, 3]);
});

clause(SHARK, "1:rule", "the bonus is real life: with 3 face-down resources it survives 2 damage and dies to 3", () => {
  const shooter = (amount: number) =>
    tactic({
      name: `Shoot${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  const two = sharkBoard(3, [{ key: "shot", def: shooter(2), owner: P1, zone: "hand" }]);
  play(two.engine, P1, two.id("shot"), { selected: { t: [two.id("ls")] } });
  assert.equal(zoneOf(two.engine, two.id("ls")), "play", "2 damage < 3 life");
  const three = sharkBoard(3, [{ key: "shot", def: shooter(3), owner: P1, zone: "hand" }]);
  play(three.engine, P1, three.id("shot"), { selected: { t: [three.id("ls")] } });
  assert.equal(zoneOf(three.engine, three.id("ls")), "discard", "3 damage >= 3 life");
});

clause(SHARK, "1:rule", "with no face-down resource of theirs it has 0 life and is destroyed (a character with 0 life is destroyed, FAQ)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ls", def: printing(SHARK), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1)]
  });
  play(b.engine, P1, b.id("ls"));
  assert.equal(zoneOf(b.engine, b.id("ls")), "discard", "0 damage is equal to 0 life: it is destroyed as it enters play");
});

clause(SHARK, "1:rule", "it stays in play when they do have a face-down resource when it enters", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ls", def: printing(SHARK), owner: P1, zone: "hand" }, ...volition(1, P2), ...bank("obsession", 4, P1)]
  });
  play(b.engine, P1, b.id("ls"));
  assert.equal(zoneOf(b.engine, b.id("ls")), "play");
  assert.deepEqual(stats(b.engine, b.id("ls")), [1, 1, 3]);
});

clause(SHARK, "1:rule", "the bonus stops applying once it has left play: back in hand it has its printed 0/0", () => {
  const b = sharkBoard(3, [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("ls")] } });
  assert.equal(zoneOf(b.engine, b.id("ls")), "hand");
  assert.deepEqual(stats(b.engine, b.id("ls")), [0, 0, 3], "printed stats outside play");
});

clause(SHARK, "1:rule", "it fights with the bonus: with 4 face-down resources it deals 4 battle damage", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "ls", def: printing(SHARK), owner: P1, zone: "play" }, ...volition(4, P2)]
  });
  const start = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("ls")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), start - 4);
});

// --- Master Ritualist -------------------------------------------------------------
// QUOTIDIAN INSTRUCTION -- COST: Deplete this card. EFFECT: Search your deck for a tactic,
// reveal it, and put it into your hand. Character (ritualist), cost 9, threshold [O][O],
// 1 strength / 3 speed / 1 life.

const RITUALIST = "b25c8c8b-1116-4b8b-95cb-828061d9577b";

function ritualistBoard(opts: { attackEligible?: boolean; random?: () => number; zone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: opts.zone ?? "play", attackEligible: opts.attackEligible },
      { key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" },
      { key: "tac2", def: tactic({ name: "Tac2" }), owner: P1, zone: "deck" },
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "deck" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "deck" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: P2, zone: "deck" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner: P1, zone: "hand" },
      { key: "discTac", def: tactic({ name: "DiscTac" }), owner: P1, zone: "discard" }
    ]
  });
}

clause(RITUALIST, "0:ability:qi", "depletes itself, then you search your deck for a tactic and put it into your hand", () => {
  const b = ritualistBoard();
  const handBefore = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("mr"), "qi");
  assert.equal(isDepleted(b.engine, b.id("mr")), true, "COST: deplete this card");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you do the searching");
  pick(b.engine, P1, [b.id("tac2")]);
  assert.equal(zoneOf(b.engine, b.id("tac2")), "hand");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "exactly one card into hand");
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck", "the other tactic stays in the deck");
  assert.equal(zoneOf(b.engine, b.id("chr")), "deck");
  assert.equal(zoneOf(b.engine, b.id("itm")), "deck");
});

clause(RITUALIST, "0:ability:qi", "the cost is paid when it is used, before the tactic is found", () => {
  const b = ritualistBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("mr"), abilityId: "qi", selected: {}, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("mr")), true, "depleted at once");
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck", "nothing found yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
});

clause(RITUALIST, "0:ability:qi", "only a tactic in your own deck can be found: characters, items, the opponent's tactics and tactics outside the deck are refused", () => {
  const b = ritualistBoard();
  activate(b.engine, P1, b.id("mr"), "qi");
  for (const [key, why] of [
    ["chr", "a character"],
    ["itm", "an item"],
    ["oppTac", "a tactic in the OPPONENT's deck"],
    ["handTac", "a tactic in your hand"],
    ["discTac", "a tactic in your discard pile"]
  ] as const) {
    assert.throws(() => pickRaw(b.engine, P1, [b.id(key)]), why);
  }
  assert.throws(() => pickRaw(b.engine, P1, [b.id("tac1"), b.id("tac2")]), "only one tactic");
  pick(b.engine, P1, [b.id("tac1")]);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "hand");
});

clause(RITUALIST, "0:ability:qi", "a search with criteria may fail: finding nothing is allowed and puts nothing in hand (CR 312.2)", () => {
  const b = ritualistBoard();
  const handBefore = [...handOf(b.engine, P1)];
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, []);
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(isDepleted(b.engine, b.id("mr")), true, "the cost was paid anyway");
});

clause(RITUALIST, "0:ability:qi", "with no tactic in the deck, the ability still costs a deplete and finds nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" },
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "deck" }
    ]
  });
  activate(engine, P1, id("mr"), "qi");
  drain(engine, declineAll);
  assert.equal(isDepleted(engine, id("mr")), true);
  assert.equal(zoneOf(engine, id("chr")), "deck");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RITUALIST, "0:ability:qi", "the found tactic is revealed to everyone before it goes to your hand", () => {
  const b = ritualistBoard();
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac2")]);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("tac2")], "the tactic that was found");
  assert.equal(ev.viewerId, "all");
});

clause(RITUALIST, "0:ability:qi", "the deck is shuffled afterwards (CR 312.1) when a tactic was found", () => {
  const b = ritualistBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac1")]);
  const unshuffled = before.filter((c) => c !== b.id("tac1"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), unshuffled, "the order changed: shuffled");
});

clause(RITUALIST, "0:ability:qi", "the deck is shuffled afterwards (CR 312.1) when you search and choose to find nothing", () => {
  const b = ritualistBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, []);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "the deck was searched, so it is shuffled whether or not a card was found");
});

clause(RITUALIST, "0:ability:qi", "the deck is shuffled afterwards (CR 312.1) even when there is no tactic in the deck to find", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0,
    cards: [{ key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" }, ...fillers("c", 5, P1, "deck")]
  });
  const before = [...deckOf(engine, P1)];
  activate(engine, P1, id("mr"), "qi");
  drain(engine, declineAll);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(engine, P1), before, "the deck was searched, so it is shuffled whether or not a tactic was there");
});

clause(RITUALIST, "0:ability:qi", "cannot be used while depleted, but is usable again once restored at the start of your next turn", () => {
  const b = ritualistBoard();
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac1")]);
  assert.throws(() => activate(b.engine, P1, b.id("mr"), "qi"), "depleted: cost cannot be paid again");
  assert.equal(zoneOf(b.engine, b.id("tac2")), "deck", "nothing else was fetched");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mr")), false, "restored");
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac2")]);
  assert.equal(zoneOf(b.engine, b.id("tac2")), "hand");
});

clause(RITUALIST, "0:ability:qi", "can be used the turn it enters play, and only by its controller", () => {
  const b = ritualistBoard({ attackEligible: false });
  assert.throws(() => activate(b.engine, P2, b.id("mr"), "qi"), "the opponent cannot use it");
  assert.equal(isDepleted(b.engine, b.id("mr")), false);
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac1")]);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "hand", "abilities are usable the turn a character arrives (CR 204.3a)");
});

clause(RITUALIST, "0:ability:qi", "can be used in response (an ability can be used whenever you could respond)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mr", def: printing(RITUALIST), owner: P1, zone: "play" },
      { key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  activate(b.engine, P1, b.id("mr"), "qi");
  pick(b.engine, P1, [b.id("tac1")]);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "hand");
  assert.equal(isDepleted(b.engine, b.id("mr")), true);
});

clause(RITUALIST, "0:ability:qi", "a Ritualist in hand cannot use the ability", () => {
  const b = ritualistBoard({ zone: "hand" });
  assert.throws(() => activate(b.engine, P1, b.id("mr"), "qi"));
});

clause(RITUALIST, "0:ability:qi", "is a 1-strength, 1-life, 3-speed ritualist that deploys for 9 with [O][O]", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mr", def: printing(RITUALIST), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(9, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("mr"));
  assert.equal(zoneOf(ok.engine, ok.id("mr")), "play");
  assert.equal(before - ready(ok.engine), 9);
  assert.deepEqual(stats(ok.engine, ok.id("mr")), [1, 1, 3]);
  assert.deepEqual(ok.engine.getDefinition(ok.id("mr")).subtype, ["ritualist"]);
  const short = board(8, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("mr")), "8 resources for a cost of 9");
  const oneIcon = board(1, 9);
  assert.throws(() => playRaw(oneIcon.engine, P1, oneIcon.id("mr")), "one [O] is not [O][O]");
  const mixed = board(2, 7);
  play(mixed.engine, P1, mixed.id("mr"));
  assert.equal(zoneOf(mixed.engine, mixed.id("mr")), "play");
});

// --- Nearby Serpent ----------------------------------------------------------------
// COVERT. When this card enters play, look at the top 5 cards of either deck and put them
// back in any order. Character (lurker), cost 3, threshold [O][O][O], 2 strength / 1 speed
// / 1 life.

const SERPENT = "26186aa1-0ff0-4f34-9a82-8ec01ffb3eef";

clause(SERPENT, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(SERPENT));
clause(SERPENT, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(SERPENT));
clause(SERPENT, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(SERPENT));
clause(SERPENT, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(SERPENT));

function serpentBoard(opts: { deck1?: number; deck2?: number; obsession?: number; greed?: number; serpentZone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ns", def: printing(SERPENT), owner: P1, zone: opts.serpentZone ?? "hand" },
      { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oppChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
      ...Array.from({ length: opts.deck1 ?? 8 }, (_, i) => ({ key: `a${i}`, def: character({ name: `A${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.deck2 ?? 8 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

function serpentLooks(engine: SpoilsEngine, whose: Pid) {
  const choice = pending(engine);
  assert.equal(choice?.kind, "chooserSelectsTarget", "you pick which deck");
  assert.equal(choice.playerId, P1);
  pick(engine, P1, [engine.state.players[whose].factionId!]);
}

clause(SERPENT, "0:kw:COVERT", "is a 2-strength, 1-life, 1-speed lurker that deploys for 3 with [O][O][O]", () => {
  const b = serpentBoard();
  const paid = ready(b.engine);
  play(b.engine, P1, b.id("ns"));
  assert.equal(paid - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.deepEqual(stats(b.engine, b.id("ns")), [2, 1, 1]);
  assert.deepEqual(b.engine.getDefinition(b.id("ns")).subtype, ["lurker"]);
});

for (const whose of [P1, P2] as const) {
  clause(SERPENT, "1:rule", `on entering play, you look at the top 5 cards of ${whose === P1 ? "your own" : "the opponent's"} deck and put them back in the order you choose`, () => {
    const { engine, id } = serpentBoard();
    const before = deckOf(engine, whose).slice();
    const otherBefore = deckOf(engine, other(whose)).slice();
    play(engine, P1, id("ns"));
    serpentLooks(engine, whose);

    const pc = pending(engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
    assert.equal(pc.kind, "reorderDeck");
    assert.equal(pc.playerId, P1, "the Serpent's controller does the looking and the ordering");
    assert.deepEqual(pc.cardIds, before.slice(0, 5), "exactly the top 5 cards of the chosen deck");

    const order = [pc.cardIds[3], pc.cardIds[0], pc.cardIds[4], pc.cardIds[1], pc.cardIds[2]];
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
    resolvePendingResponses(engine);
    assert.deepEqual(deckOf(engine, whose), [...order, ...before.slice(5)], "back on top in the chosen order, the rest untouched");
    assert.deepEqual(deckOf(engine, other(whose)), otherBefore, "the other deck is untouched");
    assert.equal(zoneOf(engine, id("ns")), "play");
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(SERPENT, "1:rule", "you may put them back in the same order (any order includes the current one)", () => {
  const { engine, id } = serpentBoard();
  const before = deckOf(engine, P1).slice();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P1);
  const pc = pending(engine) as unknown as { cardIds: string[] };
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...pc.cardIds] } } as never);
  assert.deepEqual(deckOf(engine, P1), before);
});

clause(SERPENT, "1:rule", "'either deck' means one of the two decks: the pick must be a faction (a card or a character cannot be picked instead)", () => {
  const { engine, id } = serpentBoard();
  play(engine, P1, id("ns"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.throws(() => pickRaw(engine, P1, [id("oppChar")]), "a character is not a deck");
  assert.throws(() => pickRaw(engine, P1, [id("a0")]), "a card in the deck is not a deck");
  assert.throws(() => pickRaw(engine, P1, [engine.state.players[P1].factionId!, engine.state.players[P2].factionId!]), "only one deck");
  assert.throws(() => pickRaw(engine, P1, []), "a deck must be chosen");
  serpentLooks(engine, P2);
  assert.equal(pending(engine)?.kind, "reorderDeck");
});

clause(SERPENT, "1:rule", "a deck with fewer than 5 cards shows all of them, and an empty deck shows nothing", () => {
  const three = serpentBoard({ deck2: 3 });
  const before = deckOf(three.engine, P2).slice();
  play(three.engine, P1, three.id("ns"));
  serpentLooks(three.engine, P2);
  const pc = pending(three.engine) as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, before, "all 3 cards");
  const order = [...before].reverse();
  three.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.deepEqual(deckOf(three.engine, P2), order);

  const empty = serpentBoard({ deck2: 0 });
  play(empty.engine, P1, empty.id("ns"));
  serpentLooks(empty.engine, P2);
  drain(empty.engine, declineAll);
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(empty.engine, empty.id("ns")), "play");
});

clause(SERPENT, "1:rule", "the new order must be a rearrangement of exactly the cards looked at", () => {
  const { engine, id } = serpentBoard();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P2);
  const pc = pending(engine) as unknown as { cardIds: string[] };
  const attempt = (order: string[]) => () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.throws(attempt(pc.cardIds.slice(0, 4)), "a card missing");
  assert.throws(attempt([...pc.cardIds.slice(0, 4), id("b6")]), "a card from further down the deck");
  assert.throws(attempt([...pc.cardIds.slice(0, 4), pc.cardIds[0]]), "a card twice");
  attempt([...pc.cardIds])();
});

clause(SERPENT, "1:rule", "triggers when THIS card enters play, not when another card does", () => {
  const { engine, id } = serpentBoard({ serpentZone: "play" });
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play", "another character entered play");
  assert.equal(engine.state.pendingChoice, undefined, "the Serpent already in play does not trigger");
});

clause(SERPENT, "1:rule", "does not trigger at the start of a turn, only on entering play", () => {
  const { engine } = serpentBoard({ serpentZone: "play" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SERPENT, "1:rule", "triggers again when it re-enters play (and leaving play does not trigger it)", () => {
  const bounce = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ns", def: printing(SERPENT), owner: P1, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...fillers("a", 6, P1, "deck"),
      ...bank("obsession", 5, P1)
    ]
  });
  play(bounce.engine, P1, bounce.id("bounce"), { selected: { t: [bounce.id("ns")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("ns")), "hand");
  assert.equal(bounce.engine.state.pendingChoice, undefined, "leaving play does not trigger it");
  play(bounce.engine, P1, bounce.id("ns"));
  assert.equal(pending(bounce.engine)?.kind, "chooserSelectsTarget", "entering play again does");
});

clause(SERPENT, "1:rule", "is refused one resource short of 3, and without [O][O][O]", () => {
  const short = serpentBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ns")));
  const noThreshold = serpentBoard({ obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ns")));
  const exact = serpentBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("ns"));
  assert.equal(zoneOf(exact.engine, exact.id("ns")), "play");
});

// --- Ominous Oozling --------------------------------------------------------------
// COVERT. Character (lurker), cost 7, threshold [O][O], 5 strength / 3 speed / 4 life.

const OOZLING = "975a3794-1969-4b92-b3ff-bb91a0817d39";

clause(OOZLING, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(OOZLING));
clause(OOZLING, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(OOZLING));
clause(OOZLING, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(OOZLING));
clause(OOZLING, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(OOZLING));

clause(OOZLING, "0:kw:COVERT", "is a 5-strength, 4-life, 3-speed lurker that deploys for 7 with [O][O], and has no other rules text", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "oz", def: printing(OOZLING), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(7, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("oz"));
  assert.equal(zoneOf(ok.engine, ok.id("oz")), "play");
  assert.equal(before - ready(ok.engine), 7);
  assert.deepEqual(stats(ok.engine, ok.id("oz")), [5, 4, 3]);
  assert.deepEqual(ok.engine.getDefinition(ok.id("oz")).subtype, ["lurker"]);
  assert.deepEqual(ok.engine.getKeywords(ok.id("oz")), ["covert"], "COVERT is its only keyword");
  assert.equal(ok.engine.state.pendingChoice, undefined, "nothing triggered on entering play");
  const short = board(6, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("oz")), "6 resources for a cost of 7");
  const oneIcon = board(1, 9);
  assert.throws(() => playRaw(oneIcon.engine, P1, oneIcon.id("oz")), "one [O] is not [O][O]");
  const mixed = board(2, 5);
  play(mixed.engine, P1, mixed.id("oz"));
  assert.equal(zoneOf(mixed.engine, mixed.id("oz")), "play");
});

clause(OOZLING, "0:kw:COVERT", "deals its 5 strength as battle damage to a faction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "oz", def: printing(OOZLING), owner: P1, zone: "play" }]
  });
  const start = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("oz")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), start - 5);
});

clause(OOZLING, "0:kw:COVERT", "survives 3 damage and is destroyed by 4 (life 4)", () => {
  for (const [amount, zone] of [
    [3, "play"],
    [4, "discard"]
  ] as const) {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "oz", def: printing(OOZLING), owner: P1, zone: "play" },
        { key: "shot", def: killShot(amount), owner: P1, zone: "hand" }
      ]
    });
    play(b.engine, P1, b.id("shot"), { selected: { t: [b.id("oz")] } });
    assert.equal(zoneOf(b.engine, b.id("oz")), zone, `${amount} damage`);
  }
});

function killShot(amount: number): CardDefinition {
  return tactic({
    name: `Shot${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });
}

// --- Sneaky Mansion ----------------------------------------------------------------
// COVERT. Character (lurker), cost 12, threshold [O][O][O], 12 strength / 3 speed / 12 life.

const MANSION = "ea0715d6-a6e9-4f8e-9ec5-63f67aafc8f2";

clause(MANSION, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(MANSION));
clause(MANSION, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(MANSION));
clause(MANSION, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(MANSION));
clause(MANSION, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(MANSION));

clause(MANSION, "0:kw:COVERT", "is a 12-strength, 12-life, 3-speed lurker that deploys for 12 with [O][O][O], and has no other rules text", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sm", def: printing(MANSION), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(12, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("sm"));
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "play");
  assert.equal(before - ready(ok.engine), 12);
  assert.deepEqual(stats(ok.engine, ok.id("sm")), [12, 12, 3]);
  assert.deepEqual(ok.engine.getDefinition(ok.id("sm")).subtype, ["lurker"]);
  assert.deepEqual(ok.engine.getKeywords(ok.id("sm")), ["covert"], "COVERT is its only keyword");
  const short = board(11, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("sm")), "11 resources for a cost of 12");
  const noIcons = board(2, 10);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("sm")), "two [O] are not [O][O][O]");
  const mixed = board(3, 9);
  play(mixed.engine, P1, mixed.id("sm"));
  assert.equal(zoneOf(mixed.engine, mixed.id("sm")), "play");
});

clause(MANSION, "0:kw:COVERT", "deals its 12 strength as battle damage to a faction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "sm", def: printing(MANSION), owner: P1, zone: "play" }]
  });
  const start = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("sm")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), start - 12);
});

// --- Ritual of the Shattering Teeth -------------------------------------------------
// COST: Pick a number for X. Pay twice X. EFFECT: Look at your opponent's hand and pick X
// or fewer cards. Your opponent must discard those cards. Tactic, cost 0, threshold
// [O][O][O].

const TEETH = "18b1ad96-1445-4be4-b14f-8c17958e8a1d";

function teethBoard(opts: { oppHand?: number; obsession?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rst", def: printing(TEETH), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 5 }, (_, i) => ({ key: `oh${i + 1}`, def: character({ name: `OH${i + 1}` }), owner: P2, zone: "hand" as const })),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Teeth for X; if the engine asks for picks, answers with `picks` (opponent-hand keys). */
function teethPlay(engine: SpoilsEngine, id: (k: string) => string, x: number, picks: string[]) {
  play(engine, P1, id("rst"), { variables: { x } });
  const pc = pending(engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you look at the hand and pick");
    pick(engine, P1, picks.map(id));
  }
}

for (const x of [0, 1, 2, 3, 4]) {
  clause(TEETH, "0:ability", `X=${x}: pays twice X (${2 * x}) and the opponent discards exactly the ${x} card(s) you pick`, () => {
    const { engine, id } = teethBoard();
    const before = ready(engine);
    const picks = ["oh1", "oh3", "oh5", "oh2"].slice(0, x);
    teethPlay(engine, id, x, picks);
    assert.equal(before - ready(engine), 2 * x, "pays twice X (the printed cost is 0)");
    for (const key of ["oh1", "oh2", "oh3", "oh4", "oh5"]) {
      assert.equal(zoneOf(engine, id(key)), picks.includes(key) ? "discard" : "hand", `${key}`);
    }
    assert.equal(discardOf(engine, P2).length, x);
    assert.equal(zoneOf(engine, id("myHand")), "hand", "your hand is untouched");
    assert.equal(zoneOf(engine, id("inPlay")), "play", "their cards in play are untouched");
    assert.equal(zoneOf(engine, id("rst")), "discard");
  });
}

clause(TEETH, "0:ability", "'X or fewer': you may pick fewer than X cards, or none, and only those are discarded", () => {
  for (const picks of [["oh2"], [], ["oh4", "oh5"]]) {
    const { engine, id } = teethBoard();
    const before = ready(engine);
    teethPlay(engine, id, 3, picks);
    assert.equal(before - ready(engine), 6, "X=3 is paid in full whatever you pick");
    assert.equal(discardOf(engine, P2).length, picks.length, `picked ${picks.length}`);
    for (const key of picks) assert.equal(zoneOf(engine, id(key)), "discard");
  }
});

clause(TEETH, "0:ability", "you cannot pick more than X cards, nor cards that are not in the opponent's hand", () => {
  const { engine, id } = teethBoard();
  play(engine, P1, id("rst"), { variables: { x: 2 } });
  const attempt = (keys: string[]) => () => pickRaw(engine, P1, keys.map(id));
  assert.throws(attempt(["oh1", "oh2", "oh3"]), "three cards for X=2");
  assert.throws(attempt(["myHand"]), "a card from your own hand");
  assert.throws(attempt(["inPlay"]), "a card in play");
  assert.throws(attempt(["oh1", "oh1"]), "the same card twice");
  assert.throws(() => pickRaw(engine, P2, [id("oh1")]), "the opponent cannot make the pick");
  attempt(["oh1", "oh2"])();
  assert.equal(discardOf(engine, P2).length, 2);
});

clause(TEETH, "0:ability", "with fewer cards in their hand than X, they discard what you pick from what they have", () => {
  const { engine, id } = teethBoard({ oppHand: 1 });
  teethPlay(engine, id, 3, ["oh1"]);
  assert.equal(zoneOf(engine, id("oh1")), "discard");
});

clause(TEETH, "0:ability", "an opponent with no hand: the cost is still paid and nothing is discarded", () => {
  const { engine, id } = teethBoard({ oppHand: 0 });
  const before = ready(engine);
  play(engine, P1, id("rst"), { variables: { x: 2 } });
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 4);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(TEETH, "0:ability", "cannot pay twice X without the resources: X=2 needs 4 (3 refused, 4 allowed), X=0 needs none", () => {
  const three = teethBoard({ obsession: 3 });
  assert.throws(() => playRaw(three.engine, P1, three.id("rst"), { variables: { x: 2 } }), "3 resources cannot pay for X=2");
  assert.equal(zoneOf(three.engine, three.id("rst")), "hand");
  assert.equal(ready(three.engine), 3, "nothing was spent");
  playRaw(three.engine, P1, three.id("rst"), { variables: { x: 1 } });
  assert.ok(three.engine.state.responseWindow, "...but X=1 (2 resources) can");

  const four = teethBoard({ obsession: 4 });
  teethPlay(four.engine, four.id, 2, ["oh1", "oh2"]);
  assert.equal(discardOf(four.engine, P2).length, 2, "exactly 4 resources pays for X=2");
  assert.equal(ready(four.engine), 0);

  const zero = teethBoard({ obsession: 3 });
  teethPlay(zero.engine, zero.id, 0, []);
  assert.equal(zoneOf(zero.engine, zero.id("rst")), "discard", "X=0 is free (but still needs [O][O][O])");
});

clause(TEETH, "0:ability", "needs [O][O][O] even when the cost is 0: two [O] (or other resources) are not enough", () => {
  const two = teethBoard({ obsession: 2, greed: 6 });
  assert.throws(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 0 } }));
  assert.throws(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 1 } }));
  assert.equal(two.engine.getCardPlayability(P1, two.id("rst")).playable, false);
  const three = teethBoard({ obsession: 3, greed: 0 });
  playRaw(three.engine, P1, three.id("rst"), { variables: { x: 0 } });
  assert.ok(three.engine.state.responseWindow || pending(three.engine) || zoneOf(three.engine, three.id("rst")) === "discard", "three.engine.state.responseWindow || pending(three.engine) || zoneOf(three.engine, three.id(\"rst\")) === \"discard\"");
  const mixed = teethBoard({ obsession: 3, greed: 4 });
  teethPlay(mixed.engine, mixed.id, 2, ["oh1", "oh2"]);
  assert.equal(discardOf(mixed.engine, P2).length, 2, "[O][O][O] and other resources pay for X=2");
});

clause(TEETH, "0:ability", "X cannot be negative", () => {
  const { engine, id } = teethBoard();
  assert.throws(() => playRaw(engine, P1, id("rst"), { variables: { x: -1 } }));
  assert.equal(zoneOf(engine, id("rst")), "hand");
});

clause(TEETH, "0:ability", "the cost is paid when it is played, the discard happens when it resolves", () => {
  const { engine, id } = teethBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("rst"), { variables: { x: 2 } });
  assert.equal(before - ready(engine), 4);
  assert.equal(discardOf(engine, P2).length, 0, "nothing discarded yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
});

clause(TEETH, "0:ability", "can be played in response (it is a tactic), e.g. to the opponent's attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rst", def: printing(TEETH), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  assert.throws(() => playRaw(b.engine, P1, b.id("rst"), { variables: { x: 1 } }), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("rst"), { variables: { x: 1 } });
  resolvePendingResponses(b.engine);
  pick(b.engine, P1, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
});

clause(MOLESTATION, "1:rule", "a free-played Ritual of the Shattering Teeth still pays twice X (its 'Pay twice X' is an additional cost)", () => {
  const { engine, id } = molestationBoard([printing(TEETH)], [character({ name: "Victim", cost: 0 }), character({ name: "Spare", cost: 0 })], { obsession: 14 });
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  const before = ready(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id(`h:${printing(TEETH).name}`), variables: { x: 2 } } } as never);
  assert.equal(before - ready(engine), 4, "X=2: twice X is still paid");
});

// --- Voidal Nullification Chamber --------------------------------------------------
// At the start of your turn, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. EFFECT: Put a token on this card.
// DISSOLVE -- COST: Use this only if an even number of characters are in play. Remove 4
// tokens from this card. Pick a character. EFFECT: Destroy the character.
// Location, cost 4, threshold [O][O][O], structure 2.

const CHAMBER = "d61389d5-5e20-4252-b7c7-fcf6f22ebb98";

function chamberBoard(opts: { tokens?: number; obsession?: number; chars?: number; oppChars?: number; extra?: CardPlacement[]; controller?: Pid; zone?: "play" | "hand"; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "nc", def: printing(CHAMBER), owner: P1, zone: opts.zone ?? "play", controller: opts.controller, counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...Array.from({ length: opts.chars ?? 1 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: opts.oppChars ?? 1 }, (_, i) => ({ key: `f${i}`, def: character({ name: `Foe${i}` }), owner: P2, zone: "play" as const })),
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Starts P1's turn (P2 ends theirs) on a board built with `active: P2`; answers the Chamber's option with `index` (0 decline, 1 put a token). */
function chamberUpkeep(b: ReturnType<typeof chamberBoard>, index: number | undefined) {
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  if (index === undefined) return;
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "you are asked whether to put a token");
  assert.equal(pc.playerId, P1);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(b.engine);
  developDrawLeft(b.engine); // the turn's Develop Rule is offered after the Chamber's option: skip it
}

clause(CHAMBER, "0:rule", "at the start of your turn you may put a token on it: accepting adds exactly one token", () => {
  const b = chamberBoard({ turn: 2, active: P2, tokens: 1 });
  chamberUpkeep(b, 1);
  assert.equal(tokens(b.engine, b.id("nc")), 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHAMBER, "0:rule", "'may': declining leaves the tokens alone", () => {
  const b = chamberBoard({ turn: 2, active: P2, tokens: 1 });
  chamberUpkeep(b, 0);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "0:rule", "it starts with no token and gets its first token from the start-of-turn rule", () => {
  const b = chamberBoard({ turn: 2, active: P2 });
  assert.equal(tokens(b.engine, b.id("nc")), 0);
  chamberUpkeep(b, 1);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "0:rule", "it triggers at the start of every one of your turns, one token each time", () => {
  const b = chamberBoard({ turn: 2, active: P2 });
  chamberUpkeep(b, 1);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "asked again the next turn");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  resolvePendingResponses(b.engine);
  developDrawLeft(b.engine);
  assert.equal(tokens(b.engine, b.id("nc")), 2);
});

clause(CHAMBER, "0:rule", "only at the start of YOUR turn: nothing happens at the start of the opponent's turn", () => {
  const b = chamberBoard({ tokens: 1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice for anyone");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "0:rule", "'your turn' is the controller's turn: a Chamber controlled by the opponent asks THEM at the start of their turn", () => {
  const b = chamberBoard({ turn: 2, active: P1, controller: P2 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "its controller");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
  developDrawLeft(b.engine);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "not asked at the start of its owner's own turn");
});

clause(CHAMBER, "0:rule", "a Chamber in your hand does not trigger", () => {
  const b = chamberBoard({ turn: 2, active: P2, zone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHAMBER, "0:rule", "the Chamber itself is a location with structure 2 that deploys for 4 with [O][O][O]", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "nc", def: printing(CHAMBER), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(4, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("nc"));
  assert.equal(zoneOf(ok.engine, ok.id("nc")), "play");
  assert.equal(before - ready(ok.engine), 4);
  assert.equal(ok.engine.getStat(ok.id("nc"), "structure"), 2);
  assert.throws(() => playRaw(board(3, 0).engine, P1, board(3, 0).id("nc")), "short of 4");
  const noIcons = board(2, 6);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("nc")), "two [O] are not [O][O][O]");
  const mixed = board(3, 1);
  play(mixed.engine, P1, mixed.id("nc"));
  assert.equal(zoneOf(mixed.engine, mixed.id("nc")), "play");
});

clause(CHAMBER, "0:rule", "it is destroyed by 2 damage (structure 2) and its tokens go with it", () => {
  const shooter = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const b = chamberBoard({ tokens: 3, extra: [{ key: "raze", def: shooter, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("raze"), { selected: { t: [b.id("nc")] } });
  assert.equal(zoneOf(b.engine, b.id("nc")), "discard");
});

clause(CHAMBER, "0:rule", "tokens disappear when the Chamber leaves play (CR 409.2): a Chamber that went to hand and was replayed has no tokens", () => {
  const bounceLoc = tactic({
    name: "BounceLoc",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const b = chamberBoard({ tokens: 3, extra: [{ key: "bounce", def: bounceLoc, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("nc")] } });
  assert.equal(zoneOf(b.engine, b.id("nc")), "hand");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "its tokens disappeared when it left play");
  play(b.engine, P1, b.id("nc"));
  assert.equal(zoneOf(b.engine, b.id("nc")), "play");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "the new Chamber starts with no tokens");
});

// ENERGIZE

clause(CHAMBER, "1:ability:energize", "pays exactly 2 and puts exactly one token on the Chamber", () => {
  const b = chamberBoard();
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(before - ready(b.engine), 2, "ENERGIZE costs 2");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "can be used any number of times: it does not deplete (three uses: 6 resources, 3 tokens)", () => {
  const b = chamberBoard({ obsession: 6 });
  for (let i = 1; i <= 3; i++) {
    activate(b.engine, P1, b.id("nc"), "energize");
    assert.equal(tokens(b.engine, b.id("nc")), i);
  }
  assert.equal(ready(b.engine), 0);
  assert.equal(isDepleted(b.engine, b.id("nc")), false, "a location is not depleted by it");
});

clause(CHAMBER, "1:ability:energize", "is refused one resource short of 2", () => {
  const b = chamberBoard({ obsession: 1 });
  assert.throws(() => activate(b.engine, P1, b.id("nc"), "energize"));
  assert.equal(tokens(b.engine, b.id("nc")), 0);
  assert.equal(ready(b.engine), 1, "nothing was spent");
  const exact = chamberBoard({ obsession: 2 });
  activate(exact.engine, P1, exact.id("nc"), "energize");
  assert.equal(tokens(exact.engine, exact.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "any resources pay for it (it has no threshold of its own)", () => {
  const b = chamberBoard({ obsession: 0, extra: bank("greed", 2, P1) });
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "the cost is paid when it is used and the token arrives when it resolves", () => {
  const b = chamberBoard();
  const before = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("nc"), abilityId: "energize", selected: {}, variables: {} });
  assert.equal(before - ready(b.engine), 2);
  assert.equal(tokens(b.engine, b.id("nc")), 0, "not yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(b.engine);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "only its controller can use it, and it can be used in response", () => {
  const b = chamberBoard({ extra: bank("obsession", 4, P2), turn: 2, active: P2 });
  assert.throws(() => activate(b.engine, P2, b.id("nc"), "energize"), "the opponent cannot use my Chamber");
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("f0")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 1, "usable in response to the opponent's attack");
});

clause(CHAMBER, "1:ability:energize", "a Chamber in hand cannot be energized", () => {
  const b = chamberBoard({ zone: "hand" });
  assert.throws(() => activate(b.engine, P1, b.id("nc"), "energize"));
});

// DISSOLVE

const dissolve = (b: ReturnType<typeof chamberBoard>, target: string) => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id(target)] } });

clause(CHAMBER, "2:ability:dissolve", "with an even number of characters in play and 4 tokens: removes the 4 tokens and destroys the picked character", () => {
  const b = chamberBoard({ tokens: 4, chars: 1, oppChars: 1 });
  dissolve(b, "f0");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "4 tokens removed");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "the character is destroyed");
  assert.equal(discardOf(b.engine, P2).includes(b.id("f0")), true, "into its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play", "no other character is affected");
  assert.equal(zoneOf(b.engine, b.id("nc")), "play", "the Chamber stays");
});

clause(CHAMBER, "2:ability:dissolve", "removes exactly 4 tokens: with 6 tokens, 2 are left", () => {
  const b = chamberBoard({ tokens: 6 });
  dissolve(b, "m0");
  assert.equal(tokens(b.engine, b.id("nc")), 2);
  assert.equal(zoneOf(b.engine, b.id("m0")), "discard", "one of your own characters can be picked too");
});

clause(CHAMBER, "2:ability:dissolve", "is refused with fewer than 4 tokens (3 tokens): nothing is removed or destroyed", () => {
  const b = chamberBoard({ tokens: 3 });
  assert.throws(() => dissolve(b, "f0"));
  assert.equal(tokens(b.engine, b.id("nc")), 3);
  assert.equal(zoneOf(b.engine, b.id("f0")), "play");
  const none = chamberBoard({ tokens: 0 });
  assert.throws(() => dissolve(none, "f0"));
});

for (const [mine, theirs, legal] of [
  [1, 1, true],
  [2, 2, true],
  [3, 1, true],
  [2, 1, false],
  [1, 2, false],
  [3, 2, false],
  [1, 0, false],
  [0, 1, false]
] as const) {
  clause(CHAMBER, "2:ability:dissolve", `${mine} of your and ${theirs} of their characters in play (${mine + theirs} in total): ${legal ? "usable (even)" : "refused (odd)"}`, () => {
    const b = chamberBoard({ tokens: 4, chars: mine, oppChars: theirs });
    const target = theirs > 0 ? "f0" : "m0";
    if (legal) {
      dissolve(b, target);
      assert.equal(zoneOf(b.engine, b.id(target)), "discard");
      assert.equal(tokens(b.engine, b.id("nc")), 0);
    } else {
      assert.throws(() => dissolve(b, target));
      assert.equal(tokens(b.engine, b.id("nc")), 4, "no tokens removed");
      assert.equal(zoneOf(b.engine, b.id(target)), "play");
    }
  });
}

clause(CHAMBER, "2:ability:dissolve", "only CHARACTERS count towards 'an even number of characters': items, locations and face-down cards do not", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 2,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P1, zone: "play" },
      { key: "l1", def: location({ name: "Hall" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  assert.throws(() => dissolve(b, "f0"), "3 characters (the item, the location, the face-down card and the Chamber do not count): odd");
  const even = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 1,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "fd2", def: character({ name: "Hidden2" }), owner: P2, zone: "play", faceDown: true },
      { key: "fd3", def: character({ name: "Hidden3" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  dissolve(even, "f0");
  assert.equal(zoneOf(even.engine, even.id("f0")), "discard", "2 characters: even, whatever else is on the table");
});

clause(CHAMBER, "2:ability:dissolve", "characters in hands, decks and discard piles do not count", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 2,
    extra: [
      { key: "h", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "d", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      { key: "x", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  assert.throws(() => dissolve(b, "f0"), "only the 3 in play count (odd) even though 6 exist");
  const even = chamberBoard({ tokens: 4, chars: 1, oppChars: 1, extra: [{ key: "h", def: character({ name: "InHand" }), owner: P1, zone: "hand" }] });
  dissolve(even, "f0");
  assert.equal(zoneOf(even.engine, even.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "the pick must be a character in play: items, locations, factions, face-down cards, and cards in hand or discard are refused", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 1,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P2, zone: "play" },
      { key: "l1", def: location({ name: "Hall" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "h", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "x", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  const attempt = (cardId: string) => () => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [cardId] } });
  assert.throws(attempt(b.id("i1")), "an item");
  assert.throws(attempt(b.id("l1")), "a location");
  assert.throws(attempt(b.id("nc")), "the Chamber itself is a location");
  assert.throws(attempt(factionOf(b.engine, P2)), "a faction");
  assert.throws(attempt(b.id("fd")), "a face-down card");
  assert.throws(attempt(b.id("h")), "a card in hand");
  assert.throws(attempt(b.id("x")), "a card in a discard pile");
  assert.throws(() => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [] } }), "a pick is required");
  assert.throws(() => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id("m0"), b.id("f0")] } }), "only one character");
  assert.equal(tokens(b.engine, b.id("nc")), 4, "nothing was paid by the refused attempts");
  attempt(b.id("f0"))();
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "a character you control but do not own is destroyed into its OWNER's discard pile", () => {
  const b = chamberBoard({ tokens: 4, chars: 0, oppChars: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }, { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" }] });
  activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id("stolen")] } });
  assert.equal(discardOf(b.engine, P2).includes(b.id("stolen")), true);
});

clause(CHAMBER, "2:ability:dissolve", "the tokens are removed as a cost, when it is used: they are gone before the opponent can respond, the character dies at resolution", () => {
  const b = chamberBoard({ tokens: 4 });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("nc"), abilityId: "dissolve", selected: { c: [b.id("f0")] }, variables: {} });
  assert.equal(tokens(b.engine, b.id("nc")), 0, "tokens removed at once");
  assert.equal(zoneOf(b.engine, b.id("f0")), "play", "not destroyed yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "'use this only if' is a cost-time restriction: if the number of characters turns odd in response, the effect still destroys the character", () => {
  const b = chamberBoard({ tokens: 4, chars: 1, oppChars: 1, turn: 2, active: P1, extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("nc"), abilityId: "dissolve", selected: { c: [b.id("f0")] }, variables: {} });
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("m0")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m0")), "hand", "the response made the number of characters odd");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "DISSOLVE still destroys its picked character");
});

clause(CHAMBER, "2:ability:dissolve", "needs no resources (its cost is only tokens), only its controller can use it, and a Chamber in hand cannot", () => {
  const b = chamberBoard({ tokens: 4, obsession: 0, extra: bank("obsession", 3, P2) });
  assert.throws(() => activate(b.engine, P2, b.id("nc"), "dissolve", { selected: { c: [b.id("f0")] } }), "the opponent cannot");
  dissolve(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "with 0 resources");
  const inHand = chamberBoard({ tokens: 4, zone: "hand" });
  assert.throws(() => dissolve(inHand, "f0"));
});

clause(CHAMBER, "2:ability:dissolve", "energize and dissolve work together: four ENERGIZEs (8 resources) then DISSOLVE", () => {
  const b = chamberBoard({ obsession: 8 });
  for (let i = 0; i < 4; i++) activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 4);
  dissolve(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
  assert.equal(tokens(b.engine, b.id("nc")), 0);
});

// --- Voidal Perversion ---------------------------------------------------------------
// COST: Pick 2 or fewer non-resource cards. EFFECT: Put up to 2 tokens divided however you
// want on the cards. Draw a card. Tactic, cost 3, threshold [O].

const PERVERSION = "0b976c66-bf76-40f5-b6c0-b2faea2b9f39";

function perversionBoard(opts: { obsession?: number; greed?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vp", def: printing(PERVERSION), owner: P1, zone: "hand" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Perversion on `picked` and divides tokens as `shares` (key -> count); undefined `shares` declines the distribution. */
function perversionPlay(b: ReturnType<typeof perversionBoard>, picked: string[], shares: Record<string, number>) {
  play(b.engine, P1, b.id("vp"), { selected: { picked: picked.map(b.id) } });
  const pc = pending(b.engine);
  if (picked.length > 0) {
    assert.equal(pc?.kind, "distributeAmong", "you divide the tokens");
    assert.equal(pc.playerId, P1);
    const mapped: Record<string, number> = {};
    for (const [key, n] of Object.entries(shares)) mapped[b.id(key)] = n;
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: mapped } } as never);
    resolvePendingResponses(b.engine);
  }
}

for (const [label, picked, shares] of [
  ["one card, 2 tokens", ["myChar"], { myChar: 2 }],
  ["two cards, 1 token each", ["myChar", "foeChar"], { myChar: 1, foeChar: 1 }],
  ["two cards, both tokens on the first", ["myChar", "foeLoc"], { myChar: 2, foeLoc: 0 }],
  ["two cards, both tokens on the second", ["myItem", "foeItem"], { myItem: 0, foeItem: 2 }]
] as const) {
  clause(PERVERSION, "0:ability", `${label}: pays 3, puts exactly those tokens on exactly those cards and draws a card`, () => {
    const b = perversionBoard();
    const before = ready(b.engine);
    const top = deckOf(b.engine, P1)[0];
    const handBefore = handOf(b.engine, P1).length;
    perversionPlay(b, [...picked], { ...shares });
    assert.equal(before - ready(b.engine), 3, "the printed cost of 3");
    for (const key of ["myChar", "myItem", "foeChar", "foeLoc", "foeItem"]) {
      assert.equal(tokens(b.engine, b.id(key)), (shares as Record<string, number>)[key] ?? 0, `${key} tokens`);
    }
    assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "Perversion left the hand and one card was drawn");
    assert.equal(zoneOf(b.engine, top), "hand", "the top card of my deck");
    assert.equal(zoneOf(b.engine, b.id("vp")), "discard");
  });
}

clause(PERVERSION, "0:ability", "'up to 2 tokens': you may put just 1 token, or none, and you still draw", () => {
  for (const [picked, shares, total] of [
    [["myChar"], { myChar: 1 }, 1],
    [["myChar", "foeChar"], { myChar: 1 }, 1],
    [["myChar", "foeChar"], {}, 0],
    [["myChar"], {}, 0]
  ] as const) {
    const b = perversionBoard();
    const top = deckOf(b.engine, P1)[0];
    perversionPlay(b, [...picked], { ...shares });
    const sum = ["myChar", "myItem", "foeChar", "foeLoc", "foeItem"].reduce((n, key) => n + tokens(b.engine, b.id(key)), 0);
    assert.equal(sum, total, `${total} token(s) placed`);
    assert.equal(zoneOf(b.engine, top), "hand", "the draw happens regardless");
  }
});

clause(PERVERSION, "0:ability", "picking no card at all is allowed ('2 or fewer'): no tokens, but you still draw a card", () => {
  const b = perversionBoard();
  const before = ready(b.engine);
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("vp"), { selected: { picked: [] } });
  drain(b.engine, declineAll);
  assert.equal(before - ready(b.engine), 3);
  assert.equal(zoneOf(b.engine, top), "hand", "a card is drawn");
  for (const key of ["myChar", "myItem", "foeChar", "foeLoc", "foeItem"]) assert.equal(tokens(b.engine, b.id(key)), 0);
});

clause(PERVERSION, "0:ability", "no more than 2 tokens in total: 3 is refused, and tokens only go on the picked cards", () => {
  const b = perversionBoard();
  play(b.engine, P1, b.id("vp"), { selected: { picked: [b.id("myChar"), b.id("foeChar")] } });
  const attempt = (shares: Record<string, number>) => () => {
    const mapped: Record<string, number> = {};
    for (const [key, n] of Object.entries(shares)) mapped[b.id(key)] = n;
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: mapped } } as never);
  };
  assert.throws(attempt({ myChar: 2, foeChar: 1 }), "3 tokens");
  assert.throws(attempt({ myChar: 3 }), "3 tokens on one card");
  assert.throws(attempt({ myItem: 1 }), "a card that was not picked");
  assert.throws(attempt({ myChar: 1.5 }), "a fractional share");
  attempt({ myChar: 1, foeChar: 1 })();
  assert.equal(tokens(b.engine, b.id("myChar")), 1);
  assert.equal(tokens(b.engine, b.id("foeChar")), 1);
});

clause(PERVERSION, "0:ability", "you (the caster) divide the tokens, not your opponent", () => {
  const b = perversionBoard();
  play(b.engine, P1, b.id("vp"), { selected: { picked: [b.id("myChar"), b.id("foeChar")] } });
  assert.throws(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "distributeAmong", shares: { [b.id("myChar")]: 2 } } } as never));
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(PERVERSION, "0:ability", "the picks can be any non-resource cards in play: characters, items and locations of either player", () => {
  const b = perversionBoard();
  perversionPlay(b, ["myItem", "foeLoc"], { myItem: 1, foeLoc: 1 });
  assert.equal(tokens(b.engine, b.id("myItem")), 1);
  assert.equal(tokens(b.engine, b.id("foeLoc")), 1);
});

clause(PERVERSION, "0:ability", "the picks must be non-resource cards in play: resources, face-down cards, factions, cards in hand or discard and a third card are refused", () => {
  const b = perversionBoard();
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource")!;
  const attempt = (...cardIds: string[]) => () => playRaw(b.engine, P1, b.id("vp"), { selected: { picked: cardIds } });
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(b.id("hidden")), "a face-down card is only a resource");
  assert.throws(attempt(factionOf(b.engine, P1)), "my faction");
  assert.throws(attempt(factionOf(b.engine, P2)), "their faction");
  assert.throws(attempt(b.id("inHand")), "a card in hand");
  assert.throws(attempt(b.id("inDiscard")), "a card in a discard pile");
  assert.throws(attempt(b.id("myChar"), b.id("foeChar"), b.id("foeLoc")), "three cards is more than 2");
  assert.throws(attempt(b.id("myChar"), b.id("myChar")), "the same card twice");
  assert.equal(zoneOf(b.engine, b.id("vp")), "hand", "nothing was played");
  attempt(b.id("myChar"), b.id("foeLoc"))();
  assert.ok(b.engine.state.responseWindow, "two non-resource cards in play are accepted");
});

clause(PERVERSION, "0:ability", "draws exactly one card, from the top of its controller's deck only", () => {
  const b = perversionBoard({ deck: 4 });
  const deckBefore = [...deckOf(b.engine, P1)];
  const oppDeck = [...deckOf(b.engine, P2)];
  perversionPlay(b, ["myChar"], { myChar: 2 });
  assert.deepEqual(deckOf(b.engine, P1), deckBefore.slice(1));
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
});

clause(PERVERSION, "0:ability", "with an empty deck the tokens are still placed and nothing is drawn", () => {
  const b = perversionBoard({ deck: 0 });
  const handBefore = handOf(b.engine, P1).length;
  perversionPlay(b, ["myChar"], { myChar: 2 });
  assert.equal(tokens(b.engine, b.id("myChar")), 2);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "no card to draw");
});

clause(PERVERSION, "0:ability", "the cost is paid when it is played; tokens and draw come when it resolves", () => {
  const b = perversionBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("vp"), { selected: { picked: [b.id("myChar")] } });
  assert.equal(before - ready(b.engine), 3);
  assert.equal(tokens(b.engine, b.id("myChar")), 0, "no tokens yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(PERVERSION, "0:ability", "is refused one resource short of 3, and without [O]", () => {
  const short = perversionBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("vp"), { selected: { picked: [short.id("myChar")] } }));
  const noIcon = perversionBoard({ obsession: 0, greed: 6 });
  assert.throws(() => playRaw(noIcon.engine, P1, noIcon.id("vp"), { selected: { picked: [noIcon.id("myChar")] } }));
  const exact = perversionBoard({ obsession: 3 });
  perversionPlay(exact, ["myChar"], { myChar: 1 });
  assert.equal(tokens(exact.engine, exact.id("myChar")), 1);
  const mixed = perversionBoard({ obsession: 1, greed: 2 });
  perversionPlay(mixed, ["myChar"], { myChar: 1 });
  assert.equal(tokens(mixed.engine, mixed.id("myChar")), 1, "one [O] plus two other resources");
});

// --- Zenobia's Spyglass ---------------------------------------------------------------
// FORESIGHT -- COST: Pick a number for X. Pay X. EFFECT: Look at the top X+X cards of your
// deck and put them back in any order. Item, cost 0, threshold [O].

const SPYGLASS = "d1f42443-f291-4303-bf7a-490ec6c82b50";

function spyglassBoard(opts: { deck?: number; obsession?: number; greed?: number; zone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "zs", def: printing(SPYGLASS), owner: P1, zone: opts.zone ?? "play" },
      ...fillers("d", opts.deck ?? 12, P1, "deck"),
      ...fillers("e", 12, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const foresight = (b: ReturnType<typeof spyglassBoard>, x: number) => activate(b.engine, P1, b.id("zs"), "foresight", { variables: { x } });

for (const x of [1, 2, 3]) {
  clause(SPYGLASS, "0:ability:foresight", `X=${x}: pays ${x} and you look at exactly the top ${2 * x} cards and put them back in the order you choose`, () => {
    const b = spyglassBoard();
    const deckBefore = [...deckOf(b.engine, P1)];
    const oppBefore = [...deckOf(b.engine, P2)];
    const resources = ready(b.engine);
    foresight(b, x);
    assert.equal(resources - ready(b.engine), x, `pays X (${x}), not X+X`);
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
    assert.equal(pc.kind, "reorderDeck");
    assert.equal(pc.playerId, P1, "you do the looking and the ordering");
    assert.deepEqual(pc.cardIds, deckBefore.slice(0, 2 * x), `exactly the top ${2 * x} cards`);
    const order = [...pc.cardIds].reverse();
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
    resolvePendingResponses(b.engine);
    assert.deepEqual(deckOf(b.engine, P1), [...order, ...deckBefore.slice(2 * x)], "back on top in the chosen order, the rest untouched");
    assert.deepEqual(deckOf(b.engine, P2), oppBefore, "the opponent's deck is untouched");
    assert.equal(isDepleted(b.engine, b.id("zs")), false, "FORESIGHT does not deplete the item");
  });
}

clause(SPYGLASS, "0:ability:foresight", "X=0: pays nothing and looks at no cards (X+X = 0)", () => {
  const b = spyglassBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  const resources = ready(b.engine);
  foresight(b, 0);
  drain(b.engine, declineAll);
  assert.equal(resources - ready(b.engine), 0);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore, "nothing changed");
});

clause(SPYGLASS, "0:ability:foresight", "any order includes any permutation of the looked-at cards (a rotation, not just a reversal)", () => {
  const b = spyglassBoard();
  const deckBefore = [...deckOf(b.engine, P1)];
  foresight(b, 2);
  const pc = pending(b.engine) as unknown as { cardIds: string[] };
  const order = [pc.cardIds[1], pc.cardIds[2], pc.cardIds[3], pc.cardIds[0]];
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.deepEqual(deckOf(b.engine, P1), [...order, ...deckBefore.slice(4)]);
});

clause(SPYGLASS, "0:ability:foresight", "the new order must be a rearrangement of exactly the cards looked at", () => {
  const b = spyglassBoard();
  foresight(b, 1);
  const pc = pending(b.engine) as unknown as { cardIds: string[] };
  const attempt = (order: string[]) => () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.throws(attempt([pc.cardIds[0]]), "a card missing");
  assert.throws(attempt([pc.cardIds[0], b.id("d5")]), "a card from further down");
  assert.throws(attempt([pc.cardIds[0], pc.cardIds[0]]), "a card twice");
  attempt([pc.cardIds[1], pc.cardIds[0]])();
});

clause(SPYGLASS, "0:ability:foresight", "a deck with fewer than X+X cards shows all of them", () => {
  const b = spyglassBoard({ deck: 3 });
  const deckBefore = [...deckOf(b.engine, P1)];
  foresight(b, 3);
  const pc = pending(b.engine) as unknown as { cardIds: string[] };
  assert.deepEqual(pc.cardIds, deckBefore, "all 3 cards of a 3-card deck");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...deckBefore].reverse() } } as never);
  assert.deepEqual(deckOf(b.engine, P1), [...deckBefore].reverse());
});

clause(SPYGLASS, "0:ability:foresight", "an empty deck: the cost is paid and nothing is looked at", () => {
  const b = spyglassBoard({ deck: 0 });
  const resources = ready(b.engine);
  foresight(b, 2);
  drain(b.engine, declineAll);
  assert.equal(resources - ready(b.engine), 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SPYGLASS, "0:ability:foresight", "is refused when X resources are not available (X=3 with 2 ready), and X cannot be negative", () => {
  const b = spyglassBoard({ obsession: 2 });
  assert.throws(() => foresight(b, 3), "3 resources for X=3");
  assert.equal(ready(b.engine), 2, "nothing was spent");
  assert.throws(() => foresight(b, -1), "X cannot be negative");
  foresight(b, 2);
  assert.equal(ready(b.engine), 0, "exactly X resources is enough");
});

clause(SPYGLASS, "0:ability:foresight", "can be used again and again (it is not depleted): two uses of X=1 cost 2 in total", () => {
  const b = spyglassBoard();
  foresight(b, 1);
  const pc = pending(b.engine) as unknown as { cardIds: string[] };
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...pc.cardIds] } } as never);
  resolvePendingResponses(b.engine);
  const resources = ready(b.engine);
  foresight(b, 1);
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
  assert.equal(resources - ready(b.engine), 1);
});

clause(SPYGLASS, "0:ability:foresight", "any resources pay for X (the ability has no threshold of its own)", () => {
  const b = spyglassBoard({ obsession: 0, greed: 3 });
  foresight(b, 2);
  assert.equal(ready(b.engine), 1);
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
});

clause(SPYGLASS, "0:ability:foresight", "the cost is paid when it is used; the looking happens when it resolves", () => {
  const b = spyglassBoard();
  const resources = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("zs"), abilityId: "foresight", selected: {}, variables: { x: 2 } });
  assert.equal(resources - ready(b.engine), 2);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to look at yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
});

clause(SPYGLASS, "0:ability:foresight", "only its controller can use it, and not from the hand", () => {
  const b = spyglassBoard();
  assert.throws(() => activate(b.engine, P2, b.id("zs"), "foresight", { variables: { x: 1 } }), "the opponent");
  const inHand = spyglassBoard({ zone: "hand" });
  assert.throws(() => foresight(inHand, 1));
});

clause(SPYGLASS, "0:ability:foresight", "can be used in response to the opponent's attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "zs", def: printing(SPYGLASS), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("d", 6, P1, "deck"),
      ...bank("obsession", 2, P1)
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  activate(b.engine, P1, b.id("zs"), "foresight", { variables: { x: 1 } });
  assert.equal(pending(b.engine)?.kind, "reorderDeck");
});

clause(SPYGLASS, "0:ability:foresight", "the Spyglass itself is an item that costs 0 but needs [O] to deploy", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "zs", def: printing(SPYGLASS), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(1, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("zs"));
  assert.equal(zoneOf(ok.engine, ok.id("zs")), "play");
  assert.equal(before - ready(ok.engine), 0, "cost 0");
  const noIcon = board(0, 5);
  assert.throws(() => playRaw(noIcon.engine, P1, noIcon.id("zs")), "no [O]: refused even though it is free");
  assert.equal(noIcon.engine.getCardPlayability(P1, noIcon.id("zs")).playable, false);
  const none = board(0, 0);
  assert.throws(() => playRaw(none.engine, P1, none.id("zs")), "no resources at all");
});

// --- Armored Keep ----------------------------------------------------------------------
// UNIQUE ARMORED KEEP. You may play this card whenever you could play a tactic. You do not
// lose the game while your faction has 0 influence. Location, cost 6, threshold [G][G][G],
// structure 5.

const KEEP = "fb95db39-dc7b-404d-9c2d-4aeaa4f079ee";

function keepBoard(extra: CardPlacement[] = [], opts: { greed?: number; turn?: number; active?: Pid; keepZone?: "play" | "hand"; keepController?: Pid; keepFaceDown?: boolean; p1Influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.p1Influence },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: opts.keepZone ?? "play", controller: opts.keepController, faceDown: opts.keepFaceDown },
      ...bank("greed", opts.greed ?? 6, P1),
      ...extra
    ]
  });
}

clause(KEEP, "0:unique", "controlling a second ARMORED KEEP makes you keep one: choosing the new one destroys the old one", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("ak2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ak"), b.id("ak2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ak2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ak2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(KEEP, "0:unique", "choosing the old one keeps it and destroys the new one", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("ak2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ak") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak2")), "discard");
});

clause(KEEP, "0:unique", "the restriction is per player: the opponent may control their own Keep, with no choice and no destruction", () => {
  const b = keepBoard(
    [
      { key: "ak2", def: printing(KEEP), owner: P2, zone: "hand" },
      ...bank("greed", 6, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("ak2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak2")), "play");
});

clause(KEEP, "0:unique", "taking control of the opponent's Keep while you have your own is a duplicate: you must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = keepBoard([
    { key: "theirs", def: printing(KEEP), owner: P2, zone: "play" },
    { key: "steal", def: steal, owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "two Keeps under one player's control");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(KEEP, "0:unique", "a card with a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = keepBoard([{ key: "other", def: location({ name: "OtherLoc", unique: "other loc" } as Partial<CardDefinition>), owner: P1, zone: "play" }]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(KEEP, "1:rule", "on your own turn it is played like any location: deployed for 6 with [G][G][G]", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ak", def: printing(KEEP), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("ak"));
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(before - ready(b.engine), 6);
  assert.equal(b.engine.getStat(b.id("ak"), "structure"), 5);
});

clause(KEEP, "1:rule", "you may play it whenever you could play a tactic: in response to the opponent's attack, and it enters play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 6, P1)
    ]
  });
  assert.throws(() => playRaw(b.engine, P1, b.id("ak")), "control: on the opponent's turn with nothing to respond to it cannot be played");
  openDefenderWindow(b.engine, b.id("attacker"));
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play", "it entered play in response, like a tactic would have been played");
  assert.equal(before - ready(b.engine), 6, "paid its full cost");
});

clause(KEEP, "1:rule", "you may play it in response to the opponent's tactic on their turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "t", def: drawTactic("TheirTactic", 0), owner: P2, zone: "hand" },
      ...fillers("e", 3, P2, "deck"),
      ...bank("greed", 6, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("t"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("t")), "discard", "their tactic resolved after");
});

clause(KEEP, "1:rule", "you may play it in response to the opponent ending their turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "ak", def: printing(KEEP), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
  });
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
});

clause(KEEP, "1:rule", "an ordinary location can NOT be played in response (control for the TACTICAL timing)", () => {
  const plain = location({ name: "PlainLoc", cost: 1, structure: 2 });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pl", def: plain, owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 6, P1)
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  assert.throws(() => playRaw(b.engine, P1, b.id("pl")));
});

clause(KEEP, "1:rule", "it is not a tactic: once it resolves it enters play (it is not discarded) and keeps its structure of 5", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 6, P1)
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(b.engine.getStat(b.id("ak"), "structure"), 5);
  assert.equal(b.engine.getDefinition(b.id("ak")).type, "location");
});

clause(KEEP, "1:rule", "played in response, it needs the full cost: refused one resource short of 6 and without [G][G][G]", () => {
  const window = (greed: number, obsession: number) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
        { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
        ...bank("greed", greed, P1),
        ...bank("obsession", obsession, P1)
      ]
    });
    openDefenderWindow(b.engine, b.id("attacker"));
    return b;
  };
  const short = window(5, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("ak")), "5 resources for a cost of 6");
  const noIcons = window(2, 8);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("ak")), "two [G] are not [G][G][G]");
  const mixed = window(3, 3);
  playRaw(mixed.engine, P1, mixed.id("ak"));
  resolvePendingResponses(mixed.engine);
  assert.equal(zoneOf(mixed.engine, mixed.id("ak")), "play", "[G][G][G] plus three other resources");
});

// the loss at 0 influence: P1 (Keep owner) attacked by a strength-5 attacker.
function keepBattleBoard(keep: boolean, opts: { influence?: number; keepController?: Pid; keepZone?: "play" | "hand"; keepFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence ?? 5 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      ...(keep ? [{ key: "ak", def: printing(KEEP), owner: P1, zone: opts.keepZone ?? ("play" as const), controller: opts.keepController, faceDown: opts.keepFaceDown }] : []),
      { key: "attacker", def: character({ name: "Attacker", strength: 5, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
}

clause(KEEP, "2:rule", "control: without a Keep a faction that reaches 0 influence loses the game", () => {
  const b = keepBattleBoard(false);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0);
  assert.equal(b.engine.state.winner, P2, "P1 lost");
});

clause(KEEP, "2:rule", "with the Keep in play you do not lose at 0 influence: the game carries on", () => {
  const b = keepBattleBoard(true);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0, "the faction is at 0 influence");
  assert.equal(b.engine.state.winner, undefined, "and the game is not over");
  assert.notEqual(b.engine.getFlowView().mode, "gameOver");
});

clause(KEEP, "2:rule", "with the Keep in play and MORE damage than influence you still do not lose", () => {
  const b = keepBattleBoard(true, { influence: 2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(b.engine.state.winner, undefined);
});

clause(KEEP, "2:rule", "overkill damage leaves the faction at exactly 0 influence (CR 410.4: a number reduced below 0 stays at 0), which is the state the Keep protects", () => {
  const b = keepBattleBoard(true, { influence: 2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0, "5 damage to a faction with 2 influence leaves it at 0");
});

clause(KEEP, "2:rule", "the game goes on and play continues: the turn can end and the next turn starts normally", () => {
  const b = keepBattleBoard(true);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.winner, undefined);
});

clause(KEEP, "2:rule", "when the Keep leaves play while you are at 0 influence you lose at once", () => {
  const raze = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 0 },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "raze", def: raze, owner: P2, zone: "hand" }
    ],
    turn: 2,
    activePlayerId: P2
  });
  play(b.engine, P2, b.id("raze"), { selected: { t: [b.id("ak")] } });
  assert.equal(zoneOf(b.engine, b.id("ak")), "discard");
  assert.equal(b.engine.state.winner, P2, "the Keep is gone, so P1 at 0 influence loses");
});

clause(KEEP, "2:rule", "it protects only YOUR faction: the opponent at 0 influence loses even though you control a Keep", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 5 },
    turn: 2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 5, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("attacker")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 0);
  assert.equal(b.engine.state.winner, P1, "P2 lost");
});

clause(KEEP, "2:rule", "a Keep the OPPONENT controls protects the opponent, not you", () => {
  const b = keepBattleBoard(true, { keepController: P2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0);
  assert.equal(b.engine.state.winner, P2, "the Keep under P2's control does not save P1");
});

clause(KEEP, "2:rule", "a Keep in your hand does not protect you", () => {
  const b = keepBattleBoard(true, { keepZone: "hand" });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(b.engine.state.winner, P2);
});

clause(KEEP, "2:rule", "a face-down Keep is only a resource and does not protect you", () => {
  const b = keepBattleBoard(true, { keepFaceDown: true });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(b.engine.state.winner, P2);
});

clause(KEEP, "2:rule", "both players with a Keep: both can sit at 0 influence and the game does not end", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 0 },
    playerB: { faction: developFaction(), influence: 0 },
    cards: [
      { key: "ak1", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "ak2", def: printing(KEEP), owner: P2, zone: "play" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
    ]
  });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.winner, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(KEEP, "2:rule", "damage to the Keep itself: it survives 4 damage and is destroyed by 5 (structure 5)", () => {
  const hit = (amount: number) =>
    tactic({
      name: `Hit${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  for (const [amount, zone] of [
    [4, "play"],
    [5, "discard"]
  ] as const) {
    const b = keepBoard([{ key: "hit", def: hit(amount), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("hit"), { selected: { t: [b.id("ak")] } });
    assert.equal(zoneOf(b.engine, b.id("ak")), zone, `${amount} damage`);
  }
});

// --- Brummagem Jewelry -----------------------------------------------------------------
// ATTACH TO CHARACTER. When this card enters play, deplete the attached character. The
// attached character cannot be restored by its faction's RESTORE RULE. Item (gear), cost 3,
// threshold [G][G].

const JEWELRY = "9803c940-b257-4e8c-b55a-650079c857e7";

function jewelryBoard(opts: { greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", 4, P1)
    ]
  });
}

const attachPlay = (b: ReturnType<typeof jewelryBoard>, hostKey: string) => play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id(hostKey)] } });

clause(JEWELRY, "0:attach", "attaches to a character you control: it enters play attached to that character and the printed cost of 3 is paid", () => {
  const b = jewelryBoard();
  const before = ready(b.engine);
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined, "no other character gets it");
});

clause(JEWELRY, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller)", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("jew")].controllerId, P1, "you still control the Jewelry");
});

clause(JEWELRY, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card, a resource", () => {
  const b = jewelryBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(b.id("thing")), "an item");
  assert.throws(attempt(b.id("place")), "a location");
  assert.throws(attempt(factionOf(b.engine, P1)), "your faction");
  assert.throws(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  assert.throws(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  assert.throws(attempt(b.id("res")), "a resource");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(JEWELRY, "0:attach", "is refused for a character that is not in play (in your hand or in a discard pile)", () => {
  const b = jewelryBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const b = jewelryBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [] } }), "no host picked");
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), {}), "no selection at all");
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "is refused one resource short of its cost of 3, and without [G][G] even with enough other resources", () => {
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  assert.throws(() => playRaw(short.engine, P1, short.id("jew"), { selected: { attachTo: [short.id("mine")] } }), "2 resources for a cost of 3");
  const noThreshold = jewelryBoard({ greed: 1 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("jew"), { selected: { attachTo: [noThreshold.id("mine")] } }), "one [G] is not [G][G]");
  const exact = jewelryBoard({ greed: 2 });
  attachPlay(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("jew")), "play", "[G][G] plus other resources is enough");
});

clause(JEWELRY, "0:attach", "when the host is destroyed the Jewelry leaves play with it (to its owner's discard pile)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard", "the attached card follows its host out of play (CR 507.2 / 301.4)");
});

clause(JEWELRY, "0:attach", "when the host returns to its owner's hand the Jewelry leaves play too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.notEqual(zoneOf(b.engine, b.id("jew")), "play", "the Jewelry does not stay in play without a host");
});

clause(JEWELRY, "1:rule", "when it enters play the attached character of yours is depleted, and no other character is", () => {
  const b = jewelryBoard();
  attachPlay(b, "mine");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character is depleted");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "another of your characters is not");
  assert.equal(isDepleted(b.engine, b.id("foe")), false, "an opponent's character is not");
});

clause(JEWELRY, "1:rule", "it depletes an opponent's character just as well when that is the attached character", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  assert.equal(isDepleted(b.engine, b.id("mine2")), false);
});

clause(JEWELRY, "1:rule", "the depletion happens when it ENTERS play, not while it is still waiting for responses", () => {
  const b = jewelryBoard();
  playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "deploying", "still being deployed, the opponent may respond");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "not depleted yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "depleted once it has entered play");
});

clause(JEWELRY, "1:rule", "an already depleted attached character simply stays depleted", () => {
  const b = jewelryBoard();
  b.engine.state.cards[b.id("mine")].depleted = true;
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "1:rule", "it only fires for the Jewelry entering play: a second Jewelry going on another character does not deplete the first one's host again", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew1", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "jew2", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: false },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "control: a Jewelry placed directly into play has not triggered");
  play(b.engine, P1, b.id("jew2"), { selected: { attachTo: [b.id("mine2")] } });
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "the new Jewelry depletes its own host");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "the first Jewelry's host is unaffected by the second Jewelry entering play");
});

clause(JEWELRY, "1:rule", "a depleted character cannot be declared as an attacker (so the deplete is real)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("mine")]), "the depleted host cannot attack");
  declareAttackBy(b.engine, P1, [b.id("mine2")]);
  assert.ok(battleOf(b.engine), "the other character still can");
});

/** A character with a free ability that restores itself (id `refresh`). */
function refresher(name = "Refresher"): CardDefinition {
  return character({
    name,
    behavior: { abilities: [{ id: "refresh", type: "activated", costs: [], effects: [{ type: "restore", target: "source" }] }] }
  });
}

/** P1's character `mine` carries the Jewelry and is depleted; `plain` is depleted with no Jewelry. P1 and P2 each also own a depleted character. */
function restoreBoard(jewelryController: Pid = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: jewelryController, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "foePlain", def: character({ name: "FoePlain" }), owner: P2, zone: "play", depleted: true },
      { key: "foeJew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" }
    ]
  });
}

clause(JEWELRY, "2:rule", "the attached character is not restored by its controller's faction at the start of that player's turn, while an ordinary depleted character is", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character stays depleted through its restore");
  assert.equal(isDepleted(b.engine, b.id("plain")), false, "control: the ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "an opponent's attached character is not restored at its controller's turn either", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "the attached opponent character stays depleted");
  assert.equal(isDepleted(b.engine, b.id("foePlain")), false, "control: the opponent's ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "it makes no difference who controls the Jewelry: an opponent's Jewelry on my character blocks my restore too", () => {
  const b = restoreBoard(P2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
});

clause(JEWELRY, "2:rule", "it stays depleted turn after turn while the Jewelry is attached", () => {
  const b = restoreBoard();
  for (let i = 0; i < 2; i++) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
  }
  assert.equal(b.engine.state.turn, 5);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "2:rule", "only the faction's RESTORE RULE is blocked: a restore from another source still restores the attached character", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: refresher("Mine"), owner: P1, zone: "play", depleted: true }
    ]
  });
  activate(b.engine, P1, b.id("mine"), "refresh");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "restored by its own effect while the Jewelry is attached");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
});

clause(JEWELRY, "2:rule", "once the Jewelry has left play the character is restored by the next restore rule again", () => {
  const itemKiller = tactic({
    name: "ItemKiller",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "killer", def: itemKiller, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("jew")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "still depleted right after");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "no Jewelry, no lock: the restore rule restores it");
});

clause(JEWELRY, "2:rule", "the lock does not carry over to the Jewelry's controller's other characters", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "the Jewelry on the opponent's character is a different lock");
});

// --- Cash Out ------------------------------------------------------------------------------
// COST: Pick a number for X. Pay twice X. (X can be 0.) EFFECT: Draw X+1 cards.
// Tactic, cost 0, threshold [G][G][G].

function cashOutBoard(opts: { greed?: number; other?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 10, P1, "deck"),
      ...fillers("e", 10, P2, "deck"),
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.other ?? 8, P1)
    ]
  });
}

for (const x of [0, 1, 2, 3, 4]) {
  clause(CASH_OUT, "0:ability", `X=${x}: pays twice X (${2 * x}) and draws X+1 (${x + 1}) cards from the top of the deck`, () => {
    const b = cashOutBoard();
    const before = ready(b.engine);
    const deckBefore = [...deckOf(b.engine, P1)];
    const oppDeck = [...deckOf(b.engine, P2)];
    const handBefore = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("co"), { variables: { x } });
    assert.equal(before - ready(b.engine), 2 * x, "pays twice X (the printed cost is 0)");
    assert.equal(handOf(b.engine, P1).length, handBefore - 1 + (x + 1), `Cash Out left the hand and ${x + 1} cards arrived`);
    for (const cardId of deckBefore.slice(0, x + 1)) assert.equal(zoneOf(b.engine, cardId), "hand", "the top cards were drawn");
    assert.deepEqual(deckOf(b.engine, P1), deckBefore.slice(x + 1), "and nothing else left the deck");
    assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
    assert.equal(zoneOf(b.engine, b.id("co")), "discard");
  });
}

clause(CASH_OUT, "0:ability", "the cards are drawn as one group (CR 306.3): a single draw event for X+1 cards", () => {
  const b = cashOutBoard();
  play(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  const draws = b.engine.getLog().filter((entry) => entry.event?.type === "cardsDrawn");
  assert.equal(draws.length, 1, "one draw event");
  assert.equal((draws[0].event as unknown as { count: number }).count, 3);
});

clause(CASH_OUT, "0:ability", "X can be 0: it is free to pay (but still needs [G][G][G]) and draws exactly 1 card", () => {
  const b = cashOutBoard({ greed: 3, other: 0 });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("co"), { variables: { x: 0 } });
  assert.equal(ready(b.engine), 3, "nothing was paid");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(CASH_OUT, "0:ability", "cannot pay twice X without the resources: X=2 needs 4 (3 refused, 4 allowed)", () => {
  const three = cashOutBoard({ greed: 3, other: 0 });
  assert.throws(() => playRaw(three.engine, P1, three.id("co"), { variables: { x: 2 } }), "3 resources for X=2");
  assert.equal(zoneOf(three.engine, three.id("co")), "hand");
  assert.equal(ready(three.engine), 3, "nothing spent");
  playRaw(three.engine, P1, three.id("co"), { variables: { x: 1 } });
  assert.ok(three.engine.state.responseWindow, "X=1 (2 resources) works");

  const four = cashOutBoard({ greed: 3, other: 1 });
  play(four.engine, P1, four.id("co"), { variables: { x: 2 } });
  assert.equal(ready(four.engine), 0, "exactly 4 resources pays for X=2");
  assert.equal(handOf(four.engine, P1).length, 3);
});

clause(CASH_OUT, "0:ability", "needs [G][G][G] even when the cost is 0: two [G] and plenty of other resources are not enough", () => {
  const two = cashOutBoard({ greed: 2, other: 8 });
  assert.throws(() => playRaw(two.engine, P1, two.id("co"), { variables: { x: 0 } }));
  assert.throws(() => playRaw(two.engine, P1, two.id("co"), { variables: { x: 2 } }));
  assert.equal(two.engine.getCardPlayability(P1, two.id("co")).playable, false);
  const three = cashOutBoard({ greed: 3, other: 0 });
  assert.equal(three.engine.getCardPlayability(P1, three.id("co")).playable, true);
});

clause(CASH_OUT, "0:ability", "X cannot be negative", () => {
  const b = cashOutBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: -1 } }));
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
});

clause(CASH_OUT, "0:ability", "a deck with fewer cards than X+1: you draw what exists and the tactic still resolves", () => {
  const b = cashOutBoard({ deck: 2 });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("co"), { variables: { x: 3 } });
  for (const cardId of deckBefore) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(zoneOf(b.engine, b.id("co")), "discard");
  assert.equal(b.engine.state.winner, undefined, "running out of cards does not lose the game (CR 306.2)");
});

clause(CASH_OUT, "0:ability", "the cost is paid when it is played; the draw happens when it resolves", () => {
  const b = cashOutBoard();
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.equal(before - ready(b.engine), 4);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "nothing drawn yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 3);
});

clause(CASH_OUT, "0:ability", "can be played in response (it is a tactic), e.g. to the opponent's attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", 3, P1)
    ]
  });
  assert.throws(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: 0 } }), "nothing to respond to");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("co"), { variables: { x: 0 } });
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, 1);
});

// --- Dandy Day-Trader --------------------------------------------------------------------------
// Vanilla. Character (mau), cost 4, threshold [G], 1 strength / 4 speed / 5 life.

const DAY_TRADER = "d6fa6578-2a79-4f0e-85c4-dba6f5d58d91";

function traderBoard(opts: { greed?: number; obsession?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "hand" },
      ...bank("greed", opts.greed ?? 1, P1),
      ...bank("obsession", opts.obsession ?? 3, P1)
    ]
  });
}

clause(DAY_TRADER, "vanilla", "deploys for exactly its printed cost of 4: four resources are spent, none more", () => {
  const b = traderBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("dt"));
  assert.equal(zoneOf(b.engine, b.id("dt")), "play");
  assert.equal(before - ready(b.engine), 4);
});

clause(DAY_TRADER, "vanilla", "is refused one resource short of its cost (3 of 4) and stays in hand", () => {
  const b = traderBoard({ greed: 1, obsession: 2 });
  assert.throws(() => playRaw(b.engine, P1, b.id("dt")));
  assert.equal(zoneOf(b.engine, b.id("dt")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was spent");
});

clause(DAY_TRADER, "vanilla", "is refused without the printed threshold [G] however many other resources you have", () => {
  const b = traderBoard({ greed: 0, obsession: 9 });
  assert.throws(() => playRaw(b.engine, P1, b.id("dt")));
  assert.equal(b.engine.getCardPlayability(P1, b.id("dt")).playable, false);
  const ok = traderBoard({ greed: 1, obsession: 3 });
  assert.equal(ok.engine.getCardPlayability(P1, ok.id("dt")).playable, true);
  const more = traderBoard({ greed: 4, obsession: 0 });
  play(more.engine, P1, more.id("dt"));
  assert.equal(zoneOf(more.engine, more.id("dt")), "play", "four [G] pay for it");
});

clause(DAY_TRADER, "vanilla", "has its printed stats in play: 1 strength, 5 life, 4 speed; it is a mau character", () => {
  const b = traderBoard();
  play(b.engine, P1, b.id("dt"));
  assert.deepEqual(stats(b.engine, b.id("dt")), [1, 5, 4]);
  assert.equal(b.engine.getDefinition(b.id("dt")).type, "character");
  assert.deepEqual(b.engine.getDefinition(b.id("dt")).subtype, ["mau"]);
  assert.equal(b.engine.getDefinition(b.id("dt")).trade, "banker");
});

clause(DAY_TRADER, "vanilla", "has no rules text: no keywords, no abilities and no triggers when it enters play", () => {
  const b = traderBoard();
  play(b.engine, P1, b.id("dt"));
  assert.deepEqual(b.engine.getKeywords(b.id("dt")), []);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing triggered");
  assert.equal(b.engine.getDefinition(b.id("dt")).behavior?.abilities?.length ?? 0, 0, "no abilities");
  assert.deepEqual(b.engine.getRestrictions(b.id("dt")), []);
});

clause(DAY_TRADER, "vanilla", "as a character it can only be deployed on its controller's own turn", () => {
  const b = traderBoard({ turn: 2, active: P2 });
  assert.throws(() => playRaw(b.engine, P1, b.id("dt")));
  assert.equal(zoneOf(b.engine, b.id("dt")), "hand");
});

clause(DAY_TRADER, "vanilla", "damage is destroyed at exactly its life of 5: 4 damage leaves it alive, 5 destroys it", () => {
  const hit = (amount: number) =>
    tactic({
      name: `Hit${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  for (const [amount, zone] of [
    [4, "play"],
    [5, "discard"]
  ] as const) {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "play" },
        { key: "hit", def: hit(amount), owner: P1, zone: "hand" }
      ]
    });
    play(b.engine, P1, b.id("hit"), { selected: { t: [b.id("dt")] } });
    assert.equal(zoneOf(b.engine, b.id("dt")), zone, `${amount} damage`);
  }
});

clause(DAY_TRADER, "vanilla", "deals its printed 1 strength as battle damage to the faction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "play" }]
  });
  const start = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("dt")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), start - 1);
});

clause(DAY_TRADER, "vanilla", "its speed of 4 matters: it strikes before a speed-3 blocker and kills it before that blocker deals damage", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 5, life: 1, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("dt")], { type: "faction", playerId: P2 }, [b.id("blocker")]);
  assert.equal(zoneOf(b.engine, b.id("blocker")), "discard", "the blocker (life 1) took 1 damage first and died");
  assert.equal(zoneOf(b.engine, b.id("dt")), "play", "and never got to hit back");
  assert.equal(b.engine.state.cards[b.id("dt")].damage, 0);
});

clause(DAY_TRADER, "vanilla", "just deployed it cannot attack this turn, but it can the next turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  play(b.engine, P1, b.id("dt"));
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("dt")]), "it did not start the turn in play");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("dt")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("dt")]);
});

clause(DAY_TRADER, "vanilla", "it can block", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "dt", def: printing(DAY_TRADER), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("attacker")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("dt")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("dt")]);
});

// --- Timing and deployment supplements -------------------------------------------------
// Characters, items and locations (without TACTICAL) can only be deployed on their controller's own turn
// (CR 204.1, 206.1, 207.1); tactics can be played in response (CR 205.1). One test per card.

const BIG_BANK = (owner: Pid): CardPlacement[] => [...bank("obsession", 12, owner), ...bank("greed", 12, owner)];

/** Deploying `printingId` is refused on the opponent's turn (even in a response window) but fine on its owner's own turn. */
function permanentOnlyOnOwnTurn(printingId: string, selectedFor?: (id: (k: string) => string) => Record<string, string[]>) {
  const board = (turn: number, active: Pid) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn,
      activePlayerId: active,
      cards: [
        { key: "card", def: printing(printingId), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
        ...fillers("d", 6, P1, "deck"),
        ...fillers("e", 6, P2, "deck"),
        ...BIG_BANK(P1),
        ...volition(2, P2)
      ]
    });
  const off = board(2, P2);
  const selected = selectedFor ? selectedFor(off.id) : {};
  assert.throws(() => playRaw(off.engine, P1, off.id("card"), { selected }), "not on the opponent's turn");
  openDefenderWindow(off.engine, off.id("attacker"));
  assert.throws(() => playRaw(off.engine, P1, off.id("card"), { selected }), "nor in response to the opponent's attack");
  assert.equal(zoneOf(off.engine, off.id("card")), "hand");

  const own = board(1, P1);
  play(own.engine, P1, own.id("card"), { selected: selectedFor ? selectedFor(own.id) : {} });
  drain(own.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [factionOf(own.engine, P1)] } : declineAll(pc)));
  assert.equal(zoneOf(own.engine, own.id("card")), "play", "control: on its owner's own turn it deploys");
}

clause(INHIBITOR, "0:rule", "an item: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(INHIBITOR));
clause(DEPARTMENT, "0:rule", "a location: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(DEPARTMENT));
clause(STAVE, "0:ability:counterfeit", "an item: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(STAVE));
clause(GARBLER, "0:kw:COVERT", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(GARBLER));
clause(SHARK, "0:kw:COVERT", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(SHARK));
clause(RITUALIST, "0:ability:qi", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(RITUALIST));
clause(SERPENT, "0:kw:COVERT", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(SERPENT));
clause(OOZLING, "0:kw:COVERT", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(OOZLING));
clause(MANSION, "0:kw:COVERT", "a character: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(MANSION));
clause(CHAMBER, "0:rule", "a location: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(CHAMBER));
clause(SPYGLASS, "0:ability:foresight", "an item: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(SPYGLASS));
clause(JEWELRY, "0:attach", "an item: it can only be deployed on your own turn, not in response", () => permanentOnlyOnOwnTurn(JEWELRY, (id) => ({ attachTo: [id("host")] })));

clause(INHIBITOR, "0:rule", "deploys for exactly its printed cost of 2 with [O][O]; refused one short or without the icons", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ai", def: printing(INHIBITOR), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(2, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ai"));
  assert.equal(zoneOf(ok.engine, ok.id("ai")), "play");
  assert.equal(before - ready(ok.engine), 2);
  assert.throws(() => playRaw(board(1, 0).engine, P1, board(1, 0).id("ai")), "one resource for a cost of 2");
  const noIcons = board(1, 6);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("ai")), "one [O] is not [O][O]");
  const mixed = board(2, 5);
  play(mixed.engine, P1, mixed.id("ai"));
  assert.equal(zoneOf(mixed.engine, mixed.id("ai")), "play");
});

clause(DEPARTMENT, "0:rule", "deploys for exactly its printed cost of 3 with [O][O][O] as a location with structure 5", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ad", def: printing(DEPARTMENT), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(3, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ad"));
  assert.equal(zoneOf(ok.engine, ok.id("ad")), "play");
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(ok.engine.getStat(ok.id("ad"), "structure"), 5);
  assert.equal(ok.engine.getDefinition(ok.id("ad")).type, "location");
  const short = board(2, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("ad")), "2 resources for a cost of 3");
  const noIcons = board(2, 6);
  assert.throws(() => playRaw(noIcons.engine, P1, noIcons.id("ad")), "two [O] are not [O][O][O]");
  const mixed = board(3, 4);
  play(mixed.engine, P1, mixed.id("ad"));
  assert.equal(zoneOf(mixed.engine, mixed.id("ad")), "play");
});

clause(DEPARTMENT, "0:rule", "the Department is destroyed by 5 damage (structure 5) and its rule ends with it; 4 damage leaves it standing", () => {
  const hit = (amount: number) =>
    tactic({
      name: `Hit${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  for (const [amount, zone] of [
    [4, "play"],
    [5, "discard"]
  ] as const) {
    const b = buildGame({
      playerA: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "ad", def: printing(DEPARTMENT), owner: P2, zone: "play" },
        { key: "hit", def: hit(amount), owner: P1, zone: "hand" },
        { key: "a1", def: character({ name: "a1", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
      ]
    });
    play(b.engine, P1, b.id("hit"), { selected: { t: [b.id("ad")] } });
    assert.equal(zoneOf(b.engine, b.id("ad")), zone, `${amount} damage`);
    if (zone === "play") assert.throws(() => attackWith(b.engine, [b.id("a1")]), "still in force");
    else {
      attackWith(b.engine, [b.id("a1")]);
      assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")], "gone: an odd party is legal");
    }
  }
});

// Tactics can be played in response to the opponent's attack (CR 205.1). One test per tactic not already covered above.

function responseBoard(extra: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oh", def: character({ name: "OH", cost: 2 }), owner: P2, zone: "hand" },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("e", 8, P2, "deck"),
      ...BIG_BANK(P1),
      ...extra
    ]
  });
}

clause(FORGET, "0:ability", "can be played in response to the opponent's attack (not when nothing is happening on their turn)", () => {
  const b = responseBoard([{ key: "fg", def: printing(FORGET), owner: P1, zone: "hand" }]);
  assert.throws(() => playRaw(b.engine, P1, b.id("fg"), { selected: { bounced: [b.id("attacker")] } }), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("fg"), { selected: { bounced: [b.id("attacker")] } });
  resolvePendingResponses(b.engine);
  pick(b.engine, P1, [b.id("oh")]);
  assert.equal(zoneOf(b.engine, b.id("oh")), "discard");
  assert.equal(zoneOf(b.engine, b.id("attacker")), "hand", "the attacker was put into its owner's hand");
  assert.deepEqual(battleOf(b.engine)?.attackingParty ?? [], [], "and the attack is over");
});

clause(DISPLACEMENT, "0:ability", "can be played in response to the opponent's attack", () => {
  const b = responseBoard([
    { key: "sd", def: printing(DISPLACEMENT), owner: P1, zone: "hand" },
    { key: "h0", def: character({ name: "H0", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  assert.throws(() => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id("attacker")] } }), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id("attacker")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("attacker")), "hand");
  freePlay(b.engine, b.id("h0"));
  assert.equal(zoneOf(b.engine, b.id("h0")), "play", "the free play works in response too");
});

clause(INSPIRATION, "0:rule", "can be played in response to the opponent's attack", () => {
  const b = responseBoard([{ key: "si", def: printing(INSPIRATION), owner: P1, zone: "hand" }]);
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("si"), { selected: {} });
  resolvePendingResponses(b.engine);
  pick(b.engine, P1, [b.id("oh")]); // the pick is the EFFECT: made when the tactic resolves (E3b)
  assert.equal(zoneOf(b.engine, b.id("oh")), "discard");
});

clause(PERVERSION, "0:ability", "can be played in response to the opponent's attack", () => {
  const b = responseBoard([
    { key: "vp", def: printing(PERVERSION), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
  ]);
  assert.throws(() => playRaw(b.engine, P1, b.id("vp"), { selected: { picked: [b.id("mine")] } }), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("vp"), { selected: { picked: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("mine")]: 2 } } } as never);
  assert.equal(tokens(b.engine, b.id("mine")), 2);
});

clause(EXPERIMENT, "0:ability", "can be played in response to the opponent's attack", () => {
  const b = responseBoard([{ key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" }]);
  assert.throws(() => playRaw(b.engine, P1, b.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3", "d4"].map(b.id) } }), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("ae"), { selected: { depleted: [] } });
  resolvePendingResponses(b.engine);
  pick(b.engine, P1, ["d0", "d1", "d2", "d3", "d4"].map(b.id)); // the search is the EFFECT: made when the tactic resolves (E3b)
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("d0")), "discard");
});

clause(DISTILLATION, "0:ability", "can be played in response to the opponent's attack", () => {
  const b = responseBoard([{ key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" }]);
  assert.throws(() => playRaw(b.engine, P1, b.id("ed")), "nothing to respond to yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("ed"));
  resolvePendingResponses(b.engine);
  drain(b.engine, (pc) => (pc.kind === "nameValue" ? { kind: "nameValue", value: "d0" } : declineAll(pc)));
  assert.equal(zoneOf(b.engine, b.id("ed")), "discard");
});

clause(REPLICATION, "1:ability", "cannot be played on the opponent's turn unless it is in response to something", () => {
  const b = responseBoard([{ key: "vr", def: printing(REPLICATION), owner: P1, zone: "hand" }]);
  assert.throws(() => playRaw(b.engine, P1, b.id("vr")), "no tactic has been played and there is nothing to respond to");
});

// @@END@@
