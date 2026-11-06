// Clause tests — batch 2nd-edition-01. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-01`. Expectations come from each
// card's PRINTED text (2nd Edition printing) and RULES.md / the CR; engine data
// is only used to drive the engine.

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
import { clause, clauseMismatch, declineAll, drain, printing, refused, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, pending, tokensOn, zoneOf } from "./_board.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  fight,
  fightThrough,
  finishBattle,
  playRaw
} from "./_battle.js";
import { endTurn, factionOf, setupGame, spentResources, developOffers, developDrawLeft, developPlay, settleStartFirst } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

/** `buildGame` with a fixed random source, so shuffles, coin flips and random picks are deterministic (tests that assert a shuffle pass their own). */
const buildGame = (options: Parameters<typeof baseBuildGame>[0] = {}) => baseBuildGame({ ...options, random: options.random ?? (() => 0.5) });

type Pid = typeof P1 | typeof P2;
type Def = CardDefinition;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters?.token ?? 0;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const statLine = stats;

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (so deck order is top = 0). */
function fillers(prefix: string, n: number, owner: Pid, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));
}

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). Accepts `pick(engine, selected)` or `pick(engine, player, selected)`. */
function pick(engine: SpoilsEngine, a: Pid | CardInstanceId[], b?: CardInstanceId[]): void {
  const selected = Array.isArray(a) ? a : b!;
  const player = Array.isArray(a) ? pending(engine)!.playerId : a;
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** Same as `pick` but WITHOUT draining the response window (for asserting what is true right after the answer, and for refusal checks). */
function pickRaw(engine: SpoilsEngine, a: Pid | CardInstanceId[], b?: CardInstanceId[] | Pid): void {
  const selected = Array.isArray(a) ? a : (b as CardInstanceId[]);
  const player = Array.isArray(a) ? ((b as Pid | undefined) ?? pending(engine)!.playerId) : a;
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
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
 * P2's turn: P2 declares an attack with `attackerId` and passes its own priority, so P1 (the defender)
 * may now respond. Returns once it is P1's turn to act in the window.
 */
function openDefenderWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  declareAttackOpenWindow(engine, P2, [attackerId], { type: "faction", playerId: P1 });
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


/**
 * The printed cost, threshold and stats of a permanent card (character / item / location), checked
 * against hard-coded values read off the card: it deploys for exactly `cost` resources with the
 * threshold icons present (and spends exactly `cost`), is refused one resource short, is refused
 * one threshold icon short (even with plenty of other resources), and has its printed stats in play.
 * `trade` is the staple the threshold icon comes from (arcanist = obsession).
 */
function deployChecks(
  printingId: string,
  spec: { type: "character" | "item" | "location"; cost: number; icons: number; strength?: number; speed?: number; life?: number; structure?: number; staple?: "obsession" | "greed" | "rage" | "elitism" | "deception" }
): void {
  const staple = spec.staple ?? "obsession";
  const filler = staple === "greed" ? "rage" : "greed";
  const mk = (matching: number, others: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "c", def: printing(printingId), owner: P1, zone: "hand" }, ...bank(staple, matching, P1), ...bank(filler, others, P1)]
    });

  const exact = mk(Math.max(spec.cost, spec.icons), 0);
  assert.equal(exact.engine.getDefinition(exact.id("c")).type, spec.type, "printed card type");
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("c"));
  assert.equal(zoneOf(exact.engine, exact.id("c")), "play", "deployed with exactly its cost and threshold");
  assert.equal(before - ready(exact.engine), spec.cost, `pays exactly its printed cost of ${spec.cost}`);
  if (spec.strength !== undefined) assert.equal(exact.engine.getStat(exact.id("c"), "strength"), spec.strength, "printed strength");
  if (spec.speed !== undefined) assert.equal(exact.engine.getStat(exact.id("c"), "speed"), spec.speed, "printed speed");
  if (spec.life !== undefined) assert.equal(exact.engine.getStat(exact.id("c"), "life"), spec.life, "printed life");
  if (spec.structure !== undefined) assert.equal(exact.engine.getStat(exact.id("c"), "structure"), spec.structure, "printed structure");

  if (spec.icons > 0 && spec.cost > spec.icons) {
    // exactly the threshold's icons, the rest of the cost paid with other resources: still deployable
    const mixed = mk(spec.icons, spec.cost - spec.icons);
    play(mixed.engine, P1, mixed.id("c"));
    assert.equal(zoneOf(mixed.engine, mixed.id("c")), "play", "deployable with exactly the threshold's icons and other resources for the rest");
  }
  if (spec.cost > spec.icons) {
    const shortCost = mk(spec.cost - 1, 0);
    refused(() => playRaw(shortCost.engine, P1, shortCost.id("c")), "one resource short of the printed cost");
    assert.equal(zoneOf(shortCost.engine, shortCost.id("c")), "hand", "nothing was played");
    assert.equal(ready(shortCost.engine), spec.cost - 1, "and nothing was spent");
  }
  if (spec.icons > 0) {
    const shortIcons = mk(spec.icons - 1, spec.cost + spec.icons);
    refused(() => playRaw(shortIcons.engine, P1, shortIcons.id("c")), "one threshold icon short, however many other resources there are");
    assert.equal(zoneOf(shortIcons.engine, shortIcons.id("c")), "hand");
  }
}

const ids = (b: { id: (key: string) => CardInstanceId }, keys: string[]): CardInstanceId[] => keys.map((key) => b.id(key));
const ids2 = ids;
const keyIds = ids;

/** Raw `activateAbility` WITHOUT draining the response window (for refusal checks). */
function playRawAbility(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, abilityId: string, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

/** A face-down card has no rules text (CR 411.1), so none of its printed keywords is active while it is face-down. */
function faceDownHasNoCovert(printingId: string): void {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fd", def: printing(printingId), owner: P1, zone: "play", faceDown: true },
      { key: "up", def: printing(printingId), owner: P1, zone: "play" }
    ]
  });
  assert.ok(game.engine.getKeywords(game.id("up")).includes("covert"), "control: the face-up copy has COVERT");
  assert.equal(game.engine.getKeywords(game.id("fd")).includes("covert"), false, "the face-down copy has no rules text, so no COVERT");
}
// --- 12 Man Brunch of Doom -----------------------------------------------------
// COST: Choose a number for X. Deplete X characters you control. Pick a character.
// EFFECT: If the the picked character has X+X strength or less, destroy it.
// Tactic, cost 2, threshold [O][O].

const BRUNCH = "92899b08-eaad-4aab-9a66-373be531e793";

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
  refused(() => playRaw(short.engine, P1, short.id("b"), { variables: { x: 1 }, selected: { depleted: [short.id("m1")], picked: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("b")), "hand", "nothing was played");
  assert.equal(isDepleted(short.engine, short.id("m1")), false, "no character was depleted");
  assert.equal(ready(short.engine), 1, "no resource was spent");

  const exact = brunchBoard(0, { obsession: 2 });
  play(exact.engine, P1, exact.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [exact.id("foe")] } });
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "exactly 2 resources is enough");
});

clause(BRUNCH, "0:ability", "is refused without [O][O] even with enough other resources", () => {
  const noThreshold = brunchBoard(0, { obsession: 1, greed: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [noThreshold.id("foe")] } }));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("b")), "hand");
  const none = brunchBoard(0, { obsession: 0, greed: 5 });
  refused(() => playRaw(none.engine, P1, none.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [none.id("foe")] } }));
  const withThreshold = brunchBoard(0, { obsession: 2, greed: 5 });
  play(withThreshold.engine, P1, withThreshold.id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [withThreshold.id("foe")] } });
  assert.equal(zoneOf(withThreshold.engine, withThreshold.id("foe")), "discard");
});

clause(BRUNCH, "0:ability", "needs exactly X characters of yours that can be depleted: wrong count, already depleted, or the opponent's are refused", () => {
  const { engine, id } = brunchBoard(0);
  const attempt = (depleted: string[], x = depleted.length) => () =>
    playRaw(engine, P1, id("b"), { variables: { x }, selected: { depleted, picked: [id("foe")] } });

  refused(attempt([id("m1"), id("m1")]), "cannot deplete the same character twice for X=2");
  refused(attempt([id("bystander")]), "cannot deplete an opponent's character");
  refused(attempt([id("m1")], 2), "X=2 needs two characters depleted");
  refused(attempt([id("m1"), id("m2")], 1), "X=1 needs exactly one character depleted");
  refused(attempt([], 1), "X=1 with nothing depleted");
  refused(attempt([], -1), "X cannot be negative");
  assert.equal(zoneOf(engine, id("b")), "hand", "nothing was played");

  engine.state.cards[id("m1")].depleted = true;
  refused(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
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
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(id("hidden")), "a face-down card is only a resource");
  refused(attempt(factionOf(engine, P1)), "your faction");
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
  refused(() => playRaw(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1")], picked: [id("foe")] } }));
  refused(() => playRaw(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1"), id("foe")], picked: [id("foe")] } }), "the opponent's character cannot fill the gap");
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
  refused(attempt(id("thing")), "item");
  refused(attempt(id("place")), "location");
  refused(attempt(engine.state.players[P2].factionId!), "a faction cannot be picked (CR 202.9)");
  refused(attempt(engine.state.players[P1].factionId!), "your own faction cannot be picked either");
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(id("hidden")), "a face-down card is only a resource");
  refused(attempt(id("inHand")), "a card in hand is not in play");
  refused(attempt(id("inDiscard")), "a card in a discard pile is not in play");
  refused(
    () => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [] } }),
    "a pick is required"
  );
  assert.equal(zoneOf(engine, id("b")), "hand", "nothing was played");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

clause(BRUNCH, "0:ability", "exactly one character is picked: two picks are refused", () => {
  const { engine, id } = brunchBoard(0);
  refused(() => playRaw(engine, P1, id("b"), { variables: { x: 0 }, selected: { depleted: [], picked: [id("foe"), id("bystander")] } }));
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
  refused(() => playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("attacker")] } }), "nothing to respond to yet");
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("attacker")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("attacker")), "discard", "strength 2 <= X+X = 2: the attacker is destroyed");
});

// 12 Man Brunch of Doom (2nd Edition wording: "Choose a number for X ... If the the picked character has X+X strength or less, destroy it.")

clause(BRUNCH, "0:ability", "'Choose a number for X' must be a whole number (CR 410.2): X = 1.5 is refused and nothing is spent", () => {
  const { engine, id } = brunchBoard(3);
  refused(
    () => playRaw(engine, P1, id("b"), { variables: { x: 1.5 }, selected: { depleted: [id("m1")], picked: [id("foe")] } }),
    "a fractional X is not a whole number"
  );
  assert.equal(zoneOf(engine, id("b")), "hand", "nothing was played");
  assert.equal(isDepleted(engine, id("m1")), false);
  play(engine, P1, id("b"), { variables: { x: 2 }, selected: { depleted: [id("m1"), id("m2")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "control: with a whole X = 2 the play is legal and strength 3 <= X+X = 4 destroys it");
});

clause(BRUNCH, "0:ability", "if the picked character leaves play in response, the effect does nothing (it never fizzles the rest of the play) and the tactic still goes to the discard pile", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 0, life: 9 }), owner: P2, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" },
      ...bank("obsession", 5, P1)
    ]
  });
  const before = ready(engine);
  playRaw(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(before - ready(engine), 2, "the cost was paid when it was played");
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "the picked character was returned in response");
  assert.equal(zoneOf(engine, id("bystander")), "play", "no other character is destroyed in its place");
  assert.equal(zoneOf(engine, id("m1")), "play");
  assert.equal(isDepleted(engine, id("m1")), true, "the depleted cost stays paid");
  assert.equal(zoneOf(engine, id("b")), "discard", "12 Man Brunch of Doom still goes to its owner's discard pile");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BRUNCH, "0:ability", "the cost's X characters are depleted, not destroyed or exhausted otherwise: they stay in play and keep their damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b", def: printing(BRUNCH), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1", life: 4 }), owner: P1, zone: "play", damage: 2 },
      { key: "m2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9 }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("m1")], picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("m1")), "play");
  assert.equal(engine.state.cards[id("m1")].damage, 2, "its damage is untouched");
  assert.equal(isDepleted(engine, id("m1")), true);
  assert.equal(isDepleted(engine, id("m2")), false, "the other character is not depleted");
});
// --- Ambiguity Inhibitor -----------------------------------------------------
// At the start of your turn, put a card from your hand on the bottom of your
// deck if you can. If you do, draw a card. Item, cost 2, threshold [O][O].

const INHIBITOR = "af7440ee-508c-484c-8191-3f94aa9c77d3";

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
  refused(attempt("oh0"), "the opponent's hand");
  refused(attempt("inPlay"), "a card in play");
  refused(attempt("inDiscard"), "a card in the discard pile");
  refused(attempt("d0"), "a card already in the deck");
  attempt("h0")();
  assert.equal(zoneOf(b.engine, b.id("h0")), "deck");
  assert.equal(zoneOf(b.engine, b.id("oh0")), "hand", "the opponent's hand is untouched");
});

clause(INHIBITOR, "0:rule", "exactly one card is put on the bottom: two cards at once are refused", () => {
  const b = inhibitorBoard({ hand: 3, deck: 3 });
  endTurn(b.engine, P2);
  refused(() => pickRaw(b.engine, P1, [b.id("h0"), b.id("h1")]));
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
});

clause(INHIBITOR, "0:rule", "mandatory ('put a card ... if you can'): with a card in hand, picking nothing is refused", () => {
  const b = inhibitorBoard({ hand: 2, deck: 3 });
  endTurn(b.engine, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "the Inhibitor asks for a card");
  refused(() => pickRaw(b.engine, P1, []), "declining is not allowed while you have a card in hand");
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
clause(INHIBITOR, "0:rule", "printed card: an item, cost 2, threshold oo", () => {
  deployChecks(INHIBITOR, { type: "item", cost: 2, icons: 2 });
});

clause(INHIBITOR, "0:rule", "the drawn card is the old TOP of the deck, drawn after the bottomed card is placed (a 1-card deck: the bottomed card goes under the top card and the top card is drawn)", () => {
  const b = inhibitorBoard({ hand: 2, deck: 1 });
  const only = deckOf(b.engine, P1)[0];
  inhibitorTurn(b, "h0");
  assert.equal(zoneOf(b.engine, only), "hand", "the single deck card was on top and is drawn");
  assert.deepEqual(deckOf(b.engine, P1), [b.id("h0")], "the bottomed card is now the whole deck");
});

clause(INHIBITOR, "0:rule", "only the controller's hand and deck are touched: the opponent's hand and deck are unchanged", () => {
  const b = inhibitorBoard({ hand: 2, deck: 3 });
  const oppHand = [...handOf(b.engine, P2)];
  const oppDeck = [...deckOf(b.engine, P2)];
  inhibitorTurn(b, "h0");
  assert.deepEqual(handOf(b.engine, P2), oppHand);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
});
// --- Arcana Department -----------------------------------------------------
// If an attacking or blocking party is formed, it must have an even number of
// members. Location, cost 3, threshold [O][O][O], structure 5.

const DEPARTMENT = "7c699dec-8ead-45b9-b3b3-cda16352113a";

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
      refused(() => attackWith(engine, party), `${size} attackers is refused`);
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
      refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers }), `${size} blockers is refused`);
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
    refused(() => attackWith(engine, [id("a1")]), `P1's odd attack is refused (Department controlled by ${controller})`);
    attackWith(engine, [id("a1"), id("a2")]);
    resolvePendingResponses(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] }), `P2's odd block is refused (Department controlled by ${controller})`);
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
  refused(() => attackWith(engine, [id("a1")]), "refused while the Department stands");
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
  refused(() => attackWith(engine, [id("a1")]));
});

clause(DEPARTMENT, "0:rule", "a party of the same side is judged when it forms: the attacker's even party of 2 may later lose a member without breaking the battle", () => {
  const { engine, id } = departmentBoard();
  attackWith(engine, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
  assert.equal(battleOf(engine)?.blockingParty.length, 2);
});
clause(DEPARTMENT, "0:rule", "printed card: a location, cost 3, threshold ooo, structure 5", () => {
  deployChecks(DEPARTMENT, { type: "location", cost: 3, icons: 3, structure: 5 });
});

clause(DEPARTMENT, "0:rule", "the opponent's attacking party and your blocking party are judged too: P2 attacking with 3 is refused, with 2 allowed; P1 blocking with 1 is refused, with 2 allowed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "dept", def: printing(DEPARTMENT), owner: P1, zone: "play" },
      ...[1, 2, 3, 4].map((i) => ({ key: `a${i}`, def: character({ name: `a${i}`, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const })),
      ...[1, 2, 3, 4].map((i) => ({ key: `b${i}`, def: character({ name: `b${i}`, strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const }))
    ]
  });
  const attack = (keys: string[]) =>
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: keys.map(id), target: { type: "faction", playerId: P1 } });
  refused(() => attack(["b1"]), "one attacker");
  refused(() => attack(["b1", "b2", "b3"]), "three attackers");
  assert.equal(battleOf(engine), undefined);
  attack(["b1", "b2"]);
  resolvePendingResponses(engine);
  refused(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a1")] }), "one blocker");
  refused(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a1"), id("a2"), id("a3")] }), "three blockers");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a1"), id("a2")] });
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("a1"), id("a2")].sort());
});

clause(DEPARTMENT, "0:rule", "two Departments in play do not change the rule: even parties stay legal and odd ones stay refused", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "d1", def: printing(DEPARTMENT), owner: P1, zone: "play" },
      { key: "d2", def: printing(DEPARTMENT), owner: P2, zone: "play" },
      ...[1, 2, 3].map((i) => ({ key: `a${i}`, def: character({ name: `a${i}`, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const }))
    ]
  });
  refused(() => attackWith(engine, [id("a1")]), "odd with two Departments");
  attackWith(engine, [id("a1"), id("a2")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(DEPARTMENT, "0:rule", "an attack on a location is a party too: an odd party attacking a location is refused, an even one is legal", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "dept", def: printing(DEPARTMENT), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Target", structure: 9 }), owner: P2, zone: "play" },
      ...[1, 2].map((i) => ({ key: `a${i}`, def: character({ name: `a${i}`, strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const }))
    ]
  });
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "card", cardId: id("loc") } }), "one attacker on a location");
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1"), id("a2")], target: { type: "card", cardId: id("loc") } });
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});
// --- Arcana Experiment -----------------------------------------------------
// COST: Play this only if you have at least 5 cards in your deck. Deplete up to 5
// characters you control. X is the number of characters you deplete this way.
// EFFECT: Search your deck for 5 cards and reveal them. Your opponent chooses X of
// those cards. Put the chosen cards into your hand and the rest into your discard pile.
// Tactic, cost 7, threshold [O][O][O][O].

const EXPERIMENT = "4300e226-bceb-4fcc-b9d0-097971b17dc4";

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
 * for 5 cards" is the EFFECT, so the caster chooses `selected.found` when the tactic resolves (E3a).
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
  refused(attempt(["d1"]), "X=2: one card is too few");
  refused(attempt([]), "X=2: no cards");
  refused(attempt(["d1", "d3", "d4"]), "X=2: three cards is too many");
  refused(attempt(["d1", "d0"]), "X=2: d0 was not one of the searched cards");
  refused(attempt(["d1", "d1"]), "X=2: the same card twice");
  attempt(["d1", "d3"])();
});

clause(EXPERIMENT, "0:ability", "only the opponent picks: the caster cannot answer the pick for them", () => {
  const { engine, id } = experimentBoard();
  playAe(engine, P1, id("ae"), { selected: { depleted: ["m0"].map(id), found: FOUND.map(id) } });
  refused(() => pickRaw(engine, P1, [id("d1")]), "the caster is not the chooser");
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
  refused(() => playRaw(four.engine, P1, four.id("ae"), { selected: { depleted: [], found: ["d0", "d1", "d2", "d3"].map(four.id) } }), "4 cards: refused even if the opponent has 12", /cannot be deployed right now/);
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
  refused(() => playRaw(short.engine, P1, short.id("ae"), { selected: { depleted: [], found: FOUND.map(short.id) } }));
  assert.equal(short.engine.getCardPlayability(P1, short.id("ae")).playable, false);

  const noThreshold = experimentBoard({ obsession: 3, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ae"), { selected: { depleted: [], found: FOUND.map(noThreshold.id) } }), "only three [O]");
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
  refused(attempt(["m0", "m1", "m2", "m3", "m4", "m5"].map(id)), "six characters is more than 'up to 5'");
  refused(attempt([id("foe")]), "an opponent's character cannot be depleted");
  refused(attempt(["m0", "m0"].map(id)), "the same character twice");
  engine.state.cards[id("m1")].depleted = true;
  refused(attempt([id("m1")]), "an already-depleted character cannot be depleted again");
  refused(attempt([id("h1")]), "a card in hand is not a character you control in play");
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
  refused(attempt([id("thing")]), "an item");
  refused(attempt([id("faceDown")]), "a face-down card");
  refused(attempt([factionOf(engine, P1)]), "your faction");
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
  // "Search your deck for 5 cards" is the EFFECT: the caster chooses them when the tactic resolves (E3a), and a bad answer leaves the search open.
  const { engine, id } = experimentBoard();
  play(engine, P1, id("ae"), { selected: { depleted: [id("m0")] } });
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is open");
  assert.equal(pending(engine)?.playerId, P1);
  const attempt = (found: string[]) => () => pickRaw(engine, P1, found.map(id));
  refused(attempt(["d0", "d1", "d2", "d3", "e0"]), "a card from the opponent's deck");
  refused(attempt(["d0", "d1", "d2", "d3", "h1"]), "a card from your hand");
  refused(attempt(["d0", "d1", "d2", "d3"]), "only four cards");
  refused(attempt(["d0", "d1", "d2", "d3", "d4", "d5"]), "six cards");
  refused(attempt(["d0", "d1", "d2", "d3", "d3"]), "the same card twice");
  refused(attempt(["d0", "d1", "d2", "d3", "m0"]), "a card in play");
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
clause(EXPERIMENT, "0:ability", "'characters you control' means control, not ownership: a stolen character can be depleted for X, your own character the opponent controls cannot", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", 8, P1)
    ]
  });
  const found = ["d0", "d1", "d2", "d3", "d4"].map(id);
  refused(() => playRaw(engine, P1, id("ae"), { selected: { depleted: [id("lent")], found } }), "a character you own but the opponent controls");
  assert.equal(zoneOf(engine, id("ae")), "hand");
  playAe(engine, P1, id("ae"), { selected: { depleted: [id("stolen")], found } });
  assert.equal(isDepleted(engine, id("stolen")), true, "a character you control but do not own can be depleted");
  pick(engine, P2, [id("d0")]);
  assert.equal(zoneOf(engine, id("d0")), "hand");
});

clause(EXPERIMENT, "0:ability", "is a tactic: it can be played in response on the opponent's turn, and the same X / search rules apply", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "M0" }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", 8, P1)
    ]
  });
  const found = ["d0", "d1", "d2", "d3", "d4"].map(id);
  refused(() => playRaw(engine, P1, id("ae"), { selected: { depleted: [id("m0")], found } }), "no window is open yet (nothing to respond to)");
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("ae"), { selected: { depleted: [id("m0"), id("m1")] } });
  resolvePendingResponses(engine);
  pick(engine, P1, found);
  pick(engine, P2, [id("d4"), id("d2")]);
  assert.equal(zoneOf(engine, id("d4")), "hand");
  assert.equal(zoneOf(engine, id("d2")), "hand");
  for (const key of ["d0", "d1", "d3"]) assert.equal(zoneOf(engine, id(key)), "discard", key);
  assert.equal(isDepleted(engine, id("m0")), true);
  assert.equal(isDepleted(engine, id("m1")), true);
});

clause(EXPERIMENT, "0:ability", "it is X, not 5, that the opponent picks: with X=5 every searched card goes to your hand and nothing is discarded", () => {
  const { engine, id } = experimentBoard();
  const found = FOUND.map(id);
  playAe(engine, P1, id("ae"), { selected: { depleted: ["m0", "m1", "m2", "m3", "m4"].map(id), found } });
  const pc = pending(engine);
  if (pc) {
    assert.equal(pc.playerId, P2);
    pick(engine, P2, found);
  }
  for (const cardId of found) assert.equal(zoneOf(engine, cardId), "hand");
  assert.deepEqual(discardOf(engine, P1), [id("ae")], "only the tactic itself is in the discard pile");
});
// --- Arcanist's Almanac ----------------------------------------------------
// FORESIGHT -- COST: Deplete this card. -- EFFECT: Look at up to the top 5 cards
// of either deck. Put them back in any order. Item, cost 4, threshold [O][O].

const ALMANAC = "28addfe9-b290-465c-a241-ce788297665a";

function almanacBoard(deckOwner: Pid, opts: { deck1?: number; deck2?: number; zone?: "play" | "hand"; depleted?: boolean; controller?: Pid; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "aa", def: printing(ALMANAC), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted, controller: opts.controller },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      ...fillers("a", opts.deck1 ?? (deckOwner === P1 ? 7 : 7), P1, "deck"),
      ...fillers("b", opts.deck2 ?? 7, P2, "deck")
    ]
  });
}

const foresight = (b: ReturnType<typeof almanacBoard>, whose: Pid, player: Pid = P1) =>
  activate(b.engine, player, b.id("aa"), "almanac-foresight", { selected: { deckOwner: [b.engine.state.players[whose].factionId!] } });

type ReorderPc = { kind: string; playerId: string; cardIds: string[]; to?: string };
const reorderPc = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as ReorderPc;

clause(ALMANAC, "0:ability:almanac-foresight", "printed card: an item, cost 4, threshold oo", () => {
  deployChecks(ALMANAC, { type: "item", cost: 4, icons: 2 });
});

clause(ALMANAC, "0:ability:almanac-foresight", "on your own deck: depletes the Almanac, shows YOU exactly the top 5 cards, and they go back on top in the order you choose", () => {
  const b = almanacBoard(P1);
  const deckBefore = [...deckOf(b.engine, P1)];
  const theirsBefore = [...deckOf(b.engine, P2)];
  foresight(b, P1);
  assert.equal(isDepleted(b.engine, b.id("aa")), true, "COST: Deplete this card");
  const pc = reorderPc(b.engine);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Almanac's controller looks and orders");
  assert.deepEqual(pc.cardIds, deckBefore.slice(0, 5), "exactly the top 5 cards");
  const order = [pc.cardIds[4], pc.cardIds[2], pc.cardIds[0], pc.cardIds[3], pc.cardIds[1]];
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), [...order, ...deckBefore.slice(5)], "back on top in the chosen order; the rest untouched");
  assert.deepEqual(deckOf(b.engine, P2), theirsBefore, "the opponent's deck was not involved");
});

clause(ALMANAC, "0:ability:almanac-foresight", "on the opponent's deck: the Almanac's controller looks at the top 5 and puts them back in the order the controller chooses", () => {
  const b = almanacBoard(P2);
  const deckBefore = [...deckOf(b.engine, P2)];
  const mineBefore = [...deckOf(b.engine, P1)];
  foresight(b, P2);
  assert.equal(isDepleted(b.engine, b.id("aa")), true, "COST: Deplete this card");
  const pc = reorderPc(b.engine);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Almanac's controller does the looking and the ordering, not the deck's owner");
  assert.deepEqual(pc.cardIds, deckBefore.slice(0, 5), "exactly the top 5 cards of the opponent's deck");
  const order = [...pc.cardIds].reverse();
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(deckOf(b.engine, P2), [...order, ...deckBefore.slice(5)], "put back on top in the chosen order; the rest untouched");
  assert.deepEqual(deckOf(b.engine, P1), mineBefore, "my own deck is untouched");
});

clause(ALMANAC, "0:ability:almanac-foresight", "the opponent's deck is only rearranged, never changed: the same 5 cards are on top afterwards (checked as a set)", () => {
  const b = almanacBoard(P2);
  const deckBefore = [...deckOf(b.engine, P2)];
  foresight(b, P2);
  const pc = reorderPc(b.engine);
  // answer for whoever the engine asked, so the set of cards can be checked even where the asker is not the controller
  const order = [...pc.cardIds].reverse();
  b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual([...deckOf(b.engine, P2).slice(0, 5)].sort(), deckBefore.slice(0, 5).sort(), "the same five cards");
  assert.deepEqual(deckOf(b.engine, P2).slice(5), deckBefore.slice(5), "the other cards stay where they were");
});

clause(ALMANAC, "0:ability:almanac-foresight", "a rearrangement keeping the order is fine (any order includes the existing one)", () => {
  const b = almanacBoard(P1);
  const deckBefore = [...deckOf(b.engine, P1)];
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...pc.cardIds] } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(ALMANAC, "0:ability:almanac-foresight", "'either deck': the deck choice is a player's deck, so a character, an item or a card in hand is refused (positive control: a faction works)", () => {
  const b = almanacBoard(P1);
  const attempt = (cardId: string) => () => activate(b.engine, P1, b.id("aa"), "almanac-foresight", { selected: { deckOwner: [cardId] } });
  refused(attempt(b.id("mine")), "a character");
  refused(attempt(b.id("foeItem")), "an item");
  refused(attempt(b.id("a3")), "a card in a deck");
  assert.equal(isDepleted(b.engine, b.id("aa")), false, "nothing was paid by the refused attempts");
  attempt(factionOf(b.engine, P2))();
  assert.equal(reorderPc(b.engine).kind, "reorderDeck", "an opponent's faction names their deck");
});

clause(ALMANAC, "0:ability:almanac-foresight", "'up to the top 5': a deck with 3 cards shows all 3, and they can be put back in any order", () => {
  const b = almanacBoard(P1, { deck1: 3 });
  const before = [...deckOf(b.engine, P1)];
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  assert.equal(pc.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, before, "all 3 cards, nothing more");
  const order = [...before].reverse();
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  assert.deepEqual(deckOf(b.engine, P1), order);
});

clause(ALMANAC, "0:ability:almanac-foresight", "an empty deck shows nothing, and the Almanac is still depleted by its cost", () => {
  const b = almanacBoard(P1, { deck1: 0 });
  foresight(b, P1);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(isDepleted(b.engine, b.id("aa")), true);
});

clause(ALMANAC, "0:ability:almanac-foresight", "'look at UP TO the top 5': you may look at fewer than 5 cards (here the top 3) and put just those back in any order", () => {
  const b = almanacBoard(P1);
  const before = [...deckOf(b.engine, P1)];
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  assert.equal(pc.kind, "reorderDeck");
  // Looking at only the top 3: the other cards of the deck are never shown and keep their places.
  const topThree = before.slice(0, 3);
  const order = [topThree[2], topThree[0], topThree[1]];
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(deckOf(b.engine, P1), [...order, ...before.slice(3)], "only the top 3 were reordered");
});

clause(ALMANAC, "0:ability:almanac-foresight", "'up to' includes looking at 0 cards: you may decline to look at any card", () => {
  const b = almanacBoard(P1);
  const before = [...deckOf(b.engine, P1)];
  foresight(b, P1);
  assert.equal(reorderPc(b.engine).kind, "reorderDeck");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [] } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(deckOf(b.engine, P1), before, "no card was looked at, so the deck is untouched");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ALMANAC, "0:ability:almanac-foresight", "the new order must be a rearrangement of exactly the cards looked at (a missing card, a card from deeper in the deck or a repeated card is refused)", () => {
  const b = almanacBoard(P1);
  const before = [...deckOf(b.engine, P1)];
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  const attempt = (order: string[]) => () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  refused(attempt(pc.cardIds.slice(1)), "the top card left out while deeper ones are kept (\"up to the top 5\" only shortens the look from the bottom)");
  refused(attempt([...pc.cardIds.slice(0, 4), before[6]]), "a card from further down the deck");
  refused(attempt([...pc.cardIds.slice(0, 4), pc.cardIds[0]]), "a card twice");
  attempt([...pc.cardIds].reverse())();
  assert.deepEqual(deckOf(b.engine, P1).slice(0, 5), [...pc.cardIds].reverse(), "a proper rearrangement is accepted");
});

clause(ALMANAC, "0:ability:almanac-foresight", "the cost is depleting the Almanac: an already-depleted Almanac cannot be used, and nothing is looked at", () => {
  const b = almanacBoard(P1, { depleted: true });
  refused(() => foresight(b, P1), "already depleted");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const ok = almanacBoard(P1);
  foresight(ok, P1);
  assert.equal(reorderPc(ok.engine).kind, "reorderDeck", "control: a ready Almanac works");
});

clause(ALMANAC, "0:ability:almanac-foresight", "it can be used only once per ready: after FORESIGHT it is depleted and a second use is refused", () => {
  const b = almanacBoard(P1);
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...pc.cardIds] } } as never);
  resolvePendingResponses(b.engine);
  refused(() => foresight(b, P1), "the Almanac is depleted");
});

clause(ALMANAC, "0:ability:almanac-foresight", "it becomes ready again on its controller's next turn and can be used again", () => {
  const b = almanacBoard(P1, { turn: 1, active: P1 });
  foresight(b, P1);
  const pc = reorderPc(b.engine);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [...pc.cardIds] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("aa")), true);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("aa")), false, "restored at the start of my turn");
  foresight(b, P1);
  assert.equal(reorderPc(b.engine).kind, "reorderDeck");
});

clause(ALMANAC, "0:ability:almanac-foresight", "only its controller can use it: the opponent cannot activate it", () => {
  const b = almanacBoard(P1, { turn: 2, active: P2 });
  refused(() => foresight(b, P1, P2), "the opponent does not control the Almanac");
  assert.equal(isDepleted(b.engine, b.id("aa")), false);
});

clause(ALMANAC, "0:ability:almanac-foresight", "an Almanac you control but do not own works for its controller", () => {
  const b = almanacBoard(P1, { controller: P2, turn: 2, active: P2 });
  const theirDeck = [...deckOf(b.engine, P1)];
  activate(b.engine, P2, b.id("aa"), "almanac-foresight", { selected: { deckOwner: [factionOf(b.engine, P1)] } });
  assert.equal(isDepleted(b.engine, b.id("aa")), true);
  assert.equal(reorderPc(b.engine).cardIds.join(), theirDeck.slice(0, 5).join(), "P2 (the controller) looks at P1's top 5");
});

clause(ALMANAC, "0:ability:almanac-foresight", "it works only in play: an Almanac in hand has no FORESIGHT", () => {
  const b = almanacBoard(P1, { zone: "hand" });
  refused(() => foresight(b, P1), "not in play", /zone 'play'/);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ALMANAC, "0:ability:almanac-foresight", "an ability, not a tactic: it can be used in response during the opponent's turn (their attack window)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "aa", def: printing(ALMANAC), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("a", 7, P1, "deck"),
      ...fillers("b", 7, P2, "deck")
    ]
  });
  const deckBefore = [...deckOf(b.engine, P2)];
  openDefenderWindow(b.engine, b.id("attacker"));
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("aa"), abilityId: "almanac-foresight", selected: { deckOwner: [factionOf(b.engine, P2)] }, variables: {} } as never);
  assert.equal(isDepleted(b.engine, b.id("aa")), true, "the cost is paid on activation");
  resolvePendingResponses(b.engine);
  assert.deepEqual(reorderPc(b.engine).cardIds, deckBefore.slice(0, 5), "when it resolves I look at the top 5 of their deck");
});
// =============================================================================
// Arcanology Recruitment Officer
// =============================================================================
// At the start of your turn, pick a character your opponent controls. It gains
// COVERT until the start of your next turn.
// Character, cost 4, threshold [O][O], 3 strength / 3 speed / 3 life.

const ARO = "b15e9fc9-b7ab-4f63-8e64-9351338ee763";

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

clause(ARO, "0:rule", "the pick is mandatory (no 'may'): choosing nothing is refused while the opponent controls a character", () => {
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

clause(ARO, "0:rule", "printed card: a muddler character, cost 4, threshold oo, 3 strength / 3 speed / 3 life", () => {
  deployChecks(ARO, { type: "character", cost: 4, icons: 2, strength: 3, speed: 3, life: 3 });
  assert.deepEqual(printing(ARO).subtype, ["muddler"]);
});

clause(ARO, "0:rule", "the picked character gains only COVERT: its strength, speed and life are unchanged", () => {
  const b = aroBoard();
  const before = stats(b.engine, b.id("f1"));
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("f1")]);
  assert.ok(hasKeyword(b.engine, b.id("f1"), "covert"), "hasKeyword(b.engine, b.id(\"f1\"), \"covert\")");
  assert.deepEqual(stats(b.engine, b.id("f1")), before);
  assert.deepEqual(b.engine.getKeywords(b.id("f1")), ["covert"], "COVERT is the only keyword it has");
});

clause(ARO, "0:rule", "with a single character to pick, that character gains COVERT (after answering any prompt)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "aro", def: printing(ARO), owner: P1, zone: "play" },
      { key: "only", def: character({ name: "Only", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  endTurn(b.engine, P2);
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("only")] } : declineAll(pc)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(hasKeyword(b.engine, b.id("only"), "covert"), "hasKeyword(b.engine, b.id(\"only\"), \"covert\")");
});

clause(ARO, "0:rule", "a character that is already COVERT can be picked and stays COVERT until the start of your next turn only because of its own keyword", () => {
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
  assert.ok(hasKeyword(b.engine, b.id("sneak"), "covert"), "hasKeyword(b.engine, b.id(\"sneak\"), \"covert\")");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  pick(b.engine, [b.id("sneak")]);
  assert.ok(hasKeyword(b.engine, b.id("sneak"), "covert"), "its own COVERT is never removed");
});
// --- Ashes of Zenobia ------------------------------------------------------
// UNIQUE ASHES OF ZENOBIA. At the start of your turn, draw a card.
// NULLIFY -- COST: Pay 5. -- EFFECT: Both players put a character they control
// into its owner's hand. Item, cost 7, threshold [O][O][O][O].

const ASHES = "b175a535-2a58-4df1-806d-6828e76d2868";

function ashesBoard(opts: { obsession?: number; ashesController?: Pid; second?: "hand" | "play" | "oppPlay" | "none"; active?: Pid; turn?: number; extra?: CardPlacement[] } = {}) {
  const second = opts.second ?? "none";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play", controller: opts.ashesController ?? P1 },
      ...(second === "none"
        ? []
        : [
            {
              key: "az2",
              def: printing(ASHES),
              owner: second === "oppPlay" ? P2 : P1,
              zone: second === "hand" ? ("hand" as const) : ("play" as const)
            }
          ]),
      { key: "mine1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "theirs1", def: character({ name: "Theirs1" }), owner: P2, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      ...["a1", "a2", "a3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type AshesBoard = ReturnType<typeof ashesBoard>;

// --- UNIQUE ASHES OF ZENOBIA ---

clause(ASHES, "0:unique", "playing a second copy forces you to choose one to keep; the other is destroyed (keep the new one)", () => {
  const { engine, id } = ashesBoard({ second: "hand", obsession: 14 });
  play(engine, P1, id("az2"), {});
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses which copy to keep");
  assert.deepEqual([...pc.candidates].sort(), [id("az"), id("az2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az2") } } as never);
  assert.equal(zoneOf(engine, id("az2")), "play");
  assert.equal(zoneOf(engine, id("az")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ASHES, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = ashesBoard({ second: "hand", obsession: 14 });
  play(engine, P1, id("az2"), {});
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az") } } as never);
  assert.equal(zoneOf(engine, id("az")), "play");
  assert.equal(zoneOf(engine, id("az2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ASHES, "0:unique", "the choice cannot be skipped or answered with a card that is not a copy", () => {
  const { engine, id } = ashesBoard({ second: "hand", obsession: 14 });
  play(engine, P1, id("az2"), {});
  const answer = (keep: string) => () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);
  refused(answer(id("mine1")), "a character is not a candidate");
  assert.equal(engine.state.pendingChoice?.kind, "uniqueSurvivor", "still waiting");
  answer(id("az2"))();
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ASHES, "0:unique", "only the controller's own copies count: the opponent can deploy their own copy while you have one, with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      { key: "az2", def: printing(ASHES), owner: P2, zone: "hand" },
      ...bank("obsession", 7, P2)
    ]
  });
  play(engine, P2, id("az2"), {});
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice for either player");
  assert.equal(zoneOf(engine, id("az")), "play");
  assert.equal(zoneOf(engine, id("az2")), "play");
});

clause(ASHES, "0:unique", "a copy in hand or in the discard pile does not count: only cards you control in play", () => {
  const { engine, id } = ashesBoard({
    second: "hand",
    extra: [{ key: "az3", def: printing(ASHES), owner: P1, zone: "discard" }]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("az")), "play", "the copy in play is not touched by a copy in hand or in the discard pile");
});

clause(ASHES, "0:unique", "taking control of the opponent's copy while you control one makes you choose which to keep", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = ashesBoard({
    second: "oppPlay",
    extra: [{ key: "steal", def: steal, owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("az2")] } });
  resolvePendingResponses(engine);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor", "you now control two copies");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...pc!.candidates].sort(), [id("az"), id("az2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az") } } as never);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("az")), "play");
  assert.equal(zoneOf(engine, id("az2")), "discard");
  assert.equal(engine.state.players[P2].discard.includes(id("az2")), true, "the destroyed copy goes to its OWNER's discard pile");
});

clause(ASHES, "0:unique", "after the UNIQUE choice forced by a tactic that took control of the opponent's copy, the tactic finishes resolving and the game carries on", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = ashesBoard({
    second: "oppPlay",
    extra: [
      { key: "steal", def: steal, owner: P1, zone: "hand" },
      { key: "widget", def: character({ name: "Widget" }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("az2")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice?.kind, "uniqueSurvivor");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("az") } } as never);
  for (let i = 0; i < 5 && engine.state.responseWindow; i++) {
    const w = engine.state.responseWindow;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  assert.equal(engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the Steal tactic is finished and in its owner's discard pile");
  play(engine, P1, id("widget"));
  assert.equal(zoneOf(engine, id("widget")), "play", "and you can keep playing");
});

clause(ASHES, "0:unique", "a face-down card is a resource, not Ashes of Zenobia: a face-down copy does not conflict with a face-up one", () => {
  const { engine, id } = ashesBoard({ extra: [{ key: "hidden", def: printing(ASHES), owner: P1, zone: "play", faceDown: true }] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("az")), "play");
  assert.equal(zoneOf(engine, id("hidden")), "play");
});

// --- At the start of your turn, draw a card ---

clause(ASHES, "1:rule", "printed card: an item, cost 7, threshold oooo", () => {
  deployChecks(ASHES, { type: "item", cost: 7, icons: 4 });
});

clause(ASHES, "1:rule", "at the start of your turn, you draw a card (and not at the start of the opponent's turn)", () => {
  const { engine } = ashesBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  const p1Top = engine.state.players[P1].deck[0];
  const p2Hand = engine.state.players[P2].hand.length;
  endTurn(engine, P1); // P2's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "no draw at the start of the OPPONENT's turn");
  assert.equal(engine.state.players[P2].hand.length, p2Hand, "the opponent has no Ashes: no draw for them either");
  endTurn(engine, P2); // P1's turn starts
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 1, "draws exactly one card at the start of your turn");
  assert.equal(zoneOf(engine, p1Top), "hand", "the drawn card is the top of your deck");
  assert.equal(engine.state.players[P2].hand.length, p2Hand);
  assert.equal(engine.state.pendingChoice, undefined, "the draw is automatic");
});

clause(ASHES, "1:rule", "'your turn' is the controller's turn: an Ashes controlled by the opponent draws for the opponent, not for its owner", () => {
  const { engine } = ashesBoard({ ashesController: P2 });
  const p1Hand = engine.state.players[P1].hand.length;
  const p2Hand = engine.state.players[P2].hand.length;
  endTurn(engine, P1); // P2's turn starts: P2 controls the Ashes
  assert.equal(engine.state.players[P2].hand.length, p2Hand + 1, "its controller draws at the start of their turn");
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "its owner does not");
  endTurn(engine, P2); // P1's turn starts
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "still no draw for the owner at the start of their own turn");
  assert.equal(engine.state.players[P2].hand.length, p2Hand + 1);
});

clause(ASHES, "1:rule", "the draw happens on every one of your turns", () => {
  const { engine } = ashesBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].hand.length, p1Hand + 2, "a second draw on the next turn");
});

clause(ASHES, "1:rule", "only while in play: an Ashes in hand draws nothing, and an Ashes that leaves play stops drawing", () => {
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "az", def: printing(ASHES), owner: P1, zone: "hand" }, ...fillers("a", 3, P1, "deck")]
  });
  const handBefore = handOf(inHand.engine, P1).length;
  endTurn(inHand.engine, P1);
  endTurn(inHand.engine, P2);
  assert.equal(handOf(inHand.engine, P1).length, handBefore, "an Ashes in hand does nothing");

  const gone = ashesBoard({ extra: [{ key: "kill", def: smiteTactic(), owner: P2, zone: "hand" }], turn: 2, active: P2 });
  play(gone.engine, P2, gone.id("kill"), { selected: { t: [gone.id("az")] } });
  assert.equal(zoneOf(gone.engine, gone.id("az")), "discard");
  const before = handOf(gone.engine, P1).length;
  endTurn(gone.engine, P2);
  assert.equal(handOf(gone.engine, P1).length, before, "no draw once the Ashes is gone");
});

// --- NULLIFY ---

/** Answers every chooserSelectsTarget by the player asked: `picks[player]`. */
function nullifyAnswers(engine: SpoilsEngine, picks: { [player: string]: string[] }) {
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: picks[pc.playerId] ?? [] };
    return declineAll(pc);
  });
}

const nullify = (b: AshesBoard, picks: { [player: string]: string[] }) => {
  activate(b.engine, P1, b.id("az"), "nullify");
  nullifyAnswers(b.engine, picks);
};

clause(ASHES, "2:ability:nullify", "pays exactly 5 and does not deplete the Ashes; each player puts a character they control into its owner's hand, the others stay", () => {
  const { engine, id } = ashesBoard();
  const before = ready(engine);
  activate(engine, P1, id("az"), "nullify");
  assert.equal(before - ready(engine), 5, "NULLIFY costs exactly 5");
  assert.equal(isDepleted(engine, id("az")), false, "the Ashes is not depleted by its cost");
  const asked: string[] = [];
  drain(engine, (pc) => {
    asked.push(pc.playerId);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id(pc.playerId === P1 ? "mine2" : "theirs1")] };
    return declineAll(pc);
  });
  assert.deepEqual([...asked].sort(), [P1, P2], "each player makes their own choice");
  assert.equal(zoneOf(engine, id("mine2")), "hand");
  assert.equal(zoneOf(engine, id("theirs1")), "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("mine2")), true);
  assert.equal(engine.state.players[P2].hand.includes(id("theirs1")), true);
  for (const key of ["mine1", "theirs2", "az", "thing", "myPlace"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays in play`);
});

clause(ASHES, "2:ability:nullify", "each player picks which of their characters returns (either of two can be picked)", () => {
  for (const [mine, theirs] of [
    ["mine1", "theirs2"],
    ["mine2", "theirs1"]
  ] as const) {
    const b = ashesBoard();
    nullify(b, { [P1]: [b.id(mine)], [P2]: [b.id(theirs)] });
    assert.equal(zoneOf(b.engine, b.id(mine)), "hand", mine);
    assert.equal(zoneOf(b.engine, b.id(theirs)), "hand", theirs);
    const keepMine = mine === "mine1" ? "mine2" : "mine1";
    const keepTheirs = theirs === "theirs1" ? "theirs2" : "theirs1";
    assert.equal(zoneOf(b.engine, b.id(keepMine)), "play");
    assert.equal(zoneOf(b.engine, b.id(keepTheirs)), "play");
  }
});

clause(ASHES, "2:ability:nullify", "is refused one resource short of 5, and nothing is spent or returned", () => {
  const short = ashesBoard({ obsession: 4 });
  refused(() => activate(short.engine, P1, short.id("az"), "nullify"), "4 resources");
  assert.equal(zoneOf(short.engine, short.id("mine1")), "play");
  assert.equal(ready(short.engine), 4, "nothing was spent");
  const exact = ashesBoard({ obsession: 5 });
  activate(exact.engine, P1, exact.id("az"), "nullify");
  nullifyAnswers(exact.engine, { [P1]: [exact.id("mine1")], [P2]: [exact.id("theirs1")] });
  assert.equal(zoneOf(exact.engine, exact.id("mine1")), "hand", "exactly 5 is enough");
});

clause(ASHES, "2:ability:nullify", "the cost is paid when NULLIFY is used; the characters only return when it resolves, so the opponent can respond first", () => {
  const { engine, id } = ashesBoard();
  const before = ready(engine);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("az"), abilityId: "nullify", selected: {}, variables: {} } as never);
  assert.equal(before - ready(engine), 5, "cost already paid");
  for (const key of ["mine1", "mine2", "theirs1", "theirs2"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} has not moved yet`);
  assert.equal(engine.state.pendingChoice, undefined, "nothing is chosen before the opponent had a chance to respond");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent has priority");
});

clause(ASHES, "2:ability:nullify", "a player can pick only a character they control: the opponent's character, their own item or a location are refused (positive control: a legal pick works)", () => {
  const attempt = (player: Pid, key: string) => {
    const { engine, id } = ashesBoard();
    activate(engine, P1, id("az"), "nullify");
    const pc = pending(engine)!;
    if (pc.playerId !== player) {
      // answer the other player's pick first, so `player` is the one being asked
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id(pc.playerId === P1 ? "mine1" : "theirs1")] } } as never);
    }
    assert.equal(pending(engine)?.playerId, player, "the player under test is being asked");
    return () => engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
  };
  refused(attempt(P1, "theirs1"), "P1 cannot pick the opponent's character");
  refused(attempt(P2, "mine1"), "P2 cannot pick P1's character");
  refused(attempt(P1, "az"), "an item is not a character");
  refused(attempt(P2, "thing"), "an item is not a character");
  refused(attempt(P1, "myPlace"), "a location is not a character");
  refused(attempt(P1, "a1"), "a card in a deck is not a character in play");
  attempt(P1, "mine1")();
  attempt(P2, "theirs2")();
});

clause(ASHES, "2:ability:nullify", "a face-down card is a resource, not a character: it cannot be put into hand by NULLIFY", () => {
  const b = ashesBoard({ extra: [{ key: "hiddenMine", def: character({ name: "HiddenMine" }), owner: P1, zone: "play", faceDown: true }] });
  activate(b.engine, P1, b.id("az"), "nullify");
  const pc = pending(b.engine)!;
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [b.id("hiddenMine")] } } as never),
    "a face-down card is only a resource"
  );
});

clause(ASHES, "2:ability:nullify", "the instruction is not optional (no 'may'): picking nothing while you control a character is refused, for either player", () => {
  const b = ashesBoard();
  activate(b.engine, P1, b.id("az"), "nullify");
  const first = pending(b.engine)!;
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "declining the first player's pick"
  );
  b.engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "chooserSelectsTarget", selected: [b.id(first.playerId === P1 ? "mine1" : "theirs1")] } } as never);
  const second = pending(b.engine);
  assert.ok(second, "the other player must pick too");
  assert.notEqual(second.playerId, first.playerId);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: second.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "declining the second player's pick"
  );
});

clause(ASHES, "2:ability:nullify", "exactly one character per player: two picks are refused", () => {
  const b = ashesBoard();
  activate(b.engine, P1, b.id("az"), "nullify");
  const pc = pending(b.engine)!;
  const own = pc.playerId === P1 ? ["mine1", "mine2"] : ["theirs1", "theirs2"];
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: own.map(b.id) } } as never),
    "two characters"
  );
});

clause(ASHES, "2:ability:nullify", "a character goes to its OWNER's hand, so a character you control but do not own returns to its owner", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      ...bank("obsession", 5, P1)
    ]
  });
  activate(engine, P1, id("az"), "nullify");
  nullifyAnswers(engine, { [P1]: [id("stolen")], [P2]: [id("lent")] });
  assert.equal(zoneOf(engine, id("stolen")), "hand");
  assert.equal(engine.state.players[P2].hand.includes(id("stolen")), true, "P1 controlled it, P2 owns it: it goes to P2's hand");
  assert.equal(engine.state.players[P1].hand.includes(id("stolen")), false);
  assert.equal(zoneOf(engine, id("lent")), "hand");
  assert.equal(engine.state.players[P1].hand.includes(id("lent")), true, "P2 controlled it, P1 owns it: it goes to P1's hand");
});

clause(ASHES, "2:ability:nullify", "a player with no character does nothing; the other player still puts one into hand", () => {
  for (const lacking of [P1, P2] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
        ...(lacking === P1 ? [] : [{ key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" as const }]),
        ...(lacking === P2 ? [] : [{ key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" as const }]),
        ...bank("obsession", 5, P1)
      ]
    });
    activate(engine, P1, id("az"), "nullify");
    nullifyAnswers(engine, { [P1]: lacking === P1 ? [] : [id("mine")], [P2]: lacking === P2 ? [] : [id("theirs")] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id(lacking === P1 ? "theirs" : "mine")), "hand", `player lacking a character: ${lacking}`);
    assert.equal(zoneOf(engine, id("az")), "play");
  }
});

clause(ASHES, "2:ability:nullify", "with no characters on either side NULLIFY still costs 5 and asks nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "az", def: printing(ASHES), owner: P1, zone: "play" }, ...bank("obsession", 5, P1)]
  });
  activate(engine, P1, id("az"), "nullify");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 0, "the cost was paid");
  assert.equal(zoneOf(engine, id("az")), "play");
});

clause(ASHES, "2:ability:nullify", "it can be used again (it is not depleted): with 10 resources NULLIFY works twice in a turn", () => {
  const b = ashesBoard({ obsession: 10 });
  nullify(b, { [P1]: [b.id("mine1")], [P2]: [b.id("theirs1")] });
  assert.equal(ready(b.engine), 5);
  nullify(b, { [P1]: [b.id("mine2")], [P2]: [b.id("theirs2")] });
  assert.equal(ready(b.engine), 0);
  for (const key of ["mine1", "mine2", "theirs1", "theirs2"]) assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
});

clause(ASHES, "2:ability:nullify", "only the controller can use it, and only from play", () => {
  const theirs = ashesBoard({ turn: 2, active: P2 });
  refused(() => activate(theirs.engine, P2, theirs.id("az"), "nullify"), "the opponent does not control the Ashes");
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "az", def: printing(ASHES), owner: P1, zone: "hand" }, ...bank("obsession", 5, P1)]
  });
  refused(() => activate(inHand.engine, P1, inHand.id("az"), "nullify"), "from hand", /zone 'play'/);
});

clause(ASHES, "2:ability:nullify", "an ability, not a tactic: it can be used in response during the opponent's turn (their attack window), and the attacker that was returned leaves the battle", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 5, P1)
    ]
  });
  openDefenderWindow(engine, id("attacker"));
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("az"), abilityId: "nullify", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  nullifyAnswers(engine, { [P1]: [id("mine")], [P2]: [id("attacker")] });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("attacker")), "hand");
});

clause(ASHES, "2:ability:nullify", "a character returned to hand loses its tokens (CR 409.2): it is not carrying them when it is in hand again", () => {
  const b = ashesBoard({
    extra: [{ key: "marked", def: character({ name: "Marked", life: 5 }), owner: P1, zone: "play", counters: { token: 3 } }]
  });
  nullify(b, { [P1]: [b.id("marked")], [P2]: [b.id("theirs1")] });
  assert.equal(zoneOf(b.engine, b.id("marked")), "hand");
  assert.equal(tokens(b.engine, b.id("marked")), 0, "tokens disappear when the card leaves play");
});

clause(ASHES, "2:ability:nullify", "a character returned to hand loses its damage (CR 408.9)", () => {
  const b = ashesBoard({
    extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P1, zone: "play", damage: 2 }]
  });
  nullify(b, { [P1]: [b.id("hurt")], [P2]: [b.id("theirs1")] });
  assert.equal(zoneOf(b.engine, b.id("hurt")), "hand");
  assert.equal(b.engine.state.cards[b.id("hurt")].damage, 0, "damage is reduced to 0 when the card changes areas");
});

clause(ASHES, "2:ability:nullify", "a card attached to a character that is put into hand follows it to its owner's hand (CR 301.4a)", () => {
  const b = ashesBoard({
    extra: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "gear", def: booster(1), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  nullify(b, { [P1]: [b.id("host")], [P2]: [b.id("theirs1")] });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand", "the attached card leaves play the same way: into its owner's hand");
});
// =============================================================================
// Deceptive Muddler
// =============================================================================
// COVERT. If this card inflicts damage to a faction, your opponent puts a card
// from their hand on the top of their deck if they can.
// Character (muddler), cost 4, threshold [O], 2 strength / 3 speed / 1 life.

const MUDDLER = "47d266d5-3281-4b0a-85c5-b5f37e7a862f";

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

clause(MUDDLER, "1:rule", "the opponent has to put a card (no 'may'): choosing none is refused while they have a card in hand", () => {
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
clause(MUDDLER, "1:rule", "printed card: a muddler character, cost 4, threshold o, 2 strength / 3 speed / 1 life", () => {
  deployChecks(MUDDLER, { type: "character", cost: 4, icons: 1, strength: 2, speed: 3, life: 1 });
  assert.deepEqual(printing(MUDDLER).subtype, ["muddler"]);
});

clause(MUDDLER, "0:kw:COVERT", "printed keyword: COVERT is its only keyword", () => {
  const b = muddlerBoard();
  assert.deepEqual(b.engine.getKeywords(b.id("mud")), ["covert"]);
});

clause(MUDDLER, "0:kw:COVERT", "a face-down Deceptive Muddler has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(MUDDLER));
// --- Degenerate Molestation --------------------------------------------------
// Your opponent cannot respond to this card.
// Your opponent discards a card. You may play a non-resource card with numeric
// cost X or less for free, where X is the numeric cost of the discarded card.
// (You still need to meet its threshold and satisfy its extra costs.) Repeat this
// card's effect until your opponent has no cards in their hand.
// Tactic, cost 10, threshold [O][O][O][O].


const MOLESTATION = "12cfc4e1-e8f7-431e-a37a-593210181b0c";



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
  refused(() => playRaw(engine, P2, id("counter")), "P2 has no window to play a tactic in");
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
  refused(() => playRaw(one.engine, P1, one.id("dm")));
  assert.equal(zoneOf(one.engine, one.id("dm")), "hand");
  const noThreshold = molestationBoard([], [character({ name: "Victim", cost: 1 })], { obsession: 3, greed: 9 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm")));
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
  refused(() => pickRaw(engine, P2, [id("h:Mine")]), "P1's own card");
  refused(() => pickRaw(engine, P2, []), "'must discard' - not choosing is refused");
  refused(() => pickRaw(engine, P2, [id("x1")]), "a card in P1's deck");
  assert.equal(zoneOf(engine, id("h:Mine")), "hand");
  assert.equal(zoneOf(engine, id("o:Victim")), "hand");
});

clause(MOLESTATION, "1:rule", "the caster cannot make the discard choice for the opponent", () => {
  const { engine, id } = molestationBoard([], [character({ name: "Victim", cost: 1 })]);
  playRaw(engine, P1, id("dm"));
  refused(() => pickRaw(engine, P1, [id("o:Victim")]), "P1 is not the one who must discard");
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
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:TooDear") } } as never), "cost 4 is more than X=3");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Huge") } } as never), "cost 9 is more than X=3");
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
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Staple") } } as never));
});

clause(MOLESTATION, "1:rule", "you still need the proper resource icons: choosing a card whose threshold you do not meet is refused, one you meet is played", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "NeedsRage", cost: 1, threshold: "rr" as never }), character({ name: "NeedsObsession", cost: 1, threshold: "o" as never })],
    [character({ name: "Victim", cost: 3 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Victim");
  assert.ok(offered(engine).includes("NeedsObsession"), "a card whose threshold you meet can be chosen");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:NeedsRage") } } as never), "no [R] icons: refused");
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
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h:Sniper") } } as never), "no target picked");
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
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("o:TheirOther") } } as never), "the opponent's hand");
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

clause(MOLESTATION, "1:rule", "repeats until the opponent's hand is empty: three cards means three discards (each chosen by the opponent) and up to three free plays", () => {
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

clause(MOLESTATION, "1:rule", "a single-card hand needs exactly one iteration; a large hand is emptied completely", () => {
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

clause(MOLESTATION, "1:rule", "the repeat looks at the opponent's hand as it is NOW: a card the opponent draws from a free-played card is discarded as well", () => {
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
clause(MOLESTATION, "1:rule", "X is the numeric cost of the discarded card whatever its type: a discarded tactic of cost 2 offers cost-2 cards and nothing dearer", () => {
  const { engine, id } = molestationBoard(
    [character({ name: "Two", cost: 2 }), character({ name: "Three", cost: 3 })],
    [tactic({ name: "Discarded", cost: 2 })]
  );
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:Discarded");
  assert.deepEqual(offered(engine), ["Two"]);
});

clause(MOLESTATION, "1:rule", "the free-played card can be played even when the caster has no resources left over (its numeric cost is 0)", () => {
  const { engine, id } = molestationBoard([character({ name: "Dear", cost: 3 })], [character({ name: "Victim", cost: 3 })], { obsession: 10 });
  playRaw(engine, P1, id("dm"));
  assert.equal(ready(engine), 0, "all 10 resources went into the tactic");
  opponentDiscards(engine, id, "o:Victim");
  freePlay(engine, id("h:Dear"));
  assert.equal(zoneOf(engine, id("h:Dear")), "play");
  assert.equal(ready(engine), 0);
});

clause(MOLESTATION, "1:rule", "the opponent's own cards are the only ones discarded: the caster's hand and both decks are untouched", () => {
  const { engine, id } = molestationBoard([character({ name: "Mine", cost: 9 })], [character({ name: "V1", cost: 1 }), character({ name: "V2", cost: 1 })], { oppDeck: 2 });
  const myDeck = [...deckOf(engine, P1)];
  const theirDeck = [...deckOf(engine, P2)];
  playRaw(engine, P1, id("dm"));
  opponentDiscards(engine, id, "o:V1");
  opponentDiscards(engine, id, "o:V2");
  assert.equal(engine.state.pendingChoice, undefined, "nothing affordable was offered, so nothing else is asked");
  assert.equal(zoneOf(engine, id("h:Mine")), "hand");
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.deepEqual(deckOf(engine, P2), theirDeck);
  assert.equal(discardOf(engine, P2).length, 2);
});
// =============================================================================
// Eccentric Inquisition
// =============================================================================
// Reveal the top 7 cards of your opponent's deck. Remove all tactics revealed
// this way from the game. Put the remaining cards on the bottom of your
// opponent's deck in any order. For the rest of the game, you may play tactics
// removed from the game by this card as though they were in your hand without
// meeting their threshold.
// Tactic, cost 2, threshold [O][O][O][O].

const INQUISITION = "9dadce7a-caff-45f9-9c42-a4b0a38e6298";

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

clause(INQUISITION, "0:rule", "'Remove all tactics revealed this way' is part of the EFFECT: the tactic can be played without naming the tactics beforehand (they are found when it resolves)", () => {
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

clause(INQUISITION, "0:rule", "you may play a removed tactic from there: it needs [R][R][R], which you do not control, and still resolves", () => {
  const b = inquisitionDone({ obsession: 6 });
  assert.equal(b.engine.getThresholds(P1).rage ?? 0, 0, "the caster has no Rage");
  const handBefore = handOf(b.engine, P1).length;
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("o1"));
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "its effect happened: the caster drew a card");
  assert.ok(handOf(b.engine, P1).includes(top), "handOf(b.engine, P1).includes(top)");
});

clause(INQUISITION, "0:rule", "the removed tactic's numeric cost is still paid (2 for the cost-2 tactic)", () => {
  const b = inquisitionDone({ obsession: 6 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("o1"));
  assert.equal(before - ready(b.engine), 2);
});

clause(INQUISITION, "0:rule", "the numeric cost is not waived: a cost-3 removed tactic is refused with only 2 ready resources and accepted with 3", () => {
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

clause(INQUISITION, "0:rule", "a played removed tactic ends in its OWNER's discard pile (the opponent's) and cannot be played again", () => {
  const b = inquisitionDone({ obsession: 8 });
  play(b.engine, P1, b.id("o1"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("o1")), "the opponent owns it");
  assert.equal(discardOf(b.engine, P1).includes(b.id("o1")), false);
  refused(() => playRaw(b.engine, P1, b.id("o1")), "once it is in the discard pile the permission is used up");
});

clause(INQUISITION, "0:rule", "every removed tactic can be played, not just one", () => {
  const b = inquisitionDone({ obsession: 9 });
  play(b.engine, P1, b.id("o1"));
  play(b.engine, P1, b.id("o4"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("o4")), "discard");
});

clause(INQUISITION, "0:rule", "only tactics removed by this card: a tactic in the Void by some other means cannot be played", () => {
  const b = inquisitionDone({
    obsession: 8,
    extra: [{ key: "stray", def: drawTactic("Stray", 0), owner: P2, zone: "void" }]
  });
  refused(() => playRaw(b.engine, P1, b.id("stray")), "not removed by the Inquisition");
  play(b.engine, P1, b.id("o1"));
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard", "control: a removed tactic is accepted");
});

clause(INQUISITION, "0:rule", "a tactic that stayed in the deck cannot be played from there (only removed ones)", () => {
  const b = inquisitionDone({ obsession: 8 });
  assert.equal(zoneOf(b.engine, b.id("o7")), "deck");
  refused(() => playRaw(b.engine, P1, b.id("o7")));
});

clause(INQUISITION, "0:rule", "the permission is the CASTER's: the opponent cannot play the tactics that were taken from their own deck", () => {
  const b = inquisitionDone({ obsession: 8, extra: [...bank("rage", 6, P2)] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  refused(() => playRaw(b.engine, P2, b.id("o1")), "P2 owns it but it is not in P2's hand");
  assert.ok(outOfGame(b.engine, b.id("o1")), "outOfGame(b.engine, b.id(\"o1\"))");
});

clause(INQUISITION, "0:rule", "'for the rest of the game': the permission is still there several turns later", () => {
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

clause(INQUISITION, "0:rule", "'as though they were in your hand': a removed tactic can be played in response on the opponent's turn", () => {
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

clause(INQUISITION, "0:rule", "it works for the other player as well: P2's Inquisition lets P2 play the tactics it removed from P1's deck", () => {
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
/** An Inquisition board whose opponent deck is exactly `defs` (top to bottom, keys o0, o1, ...). */
function inquisitionCustomDeck(defs: CardDefinition[], opts: { obsession?: number; myHand?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ei", def: printing(INQUISITION), owner: P1, zone: "hand" },
      ...defs.map((def, index) => ({ key: `o${index}`, def, owner: P2, zone: "deck" as const })),
      ...fillers("mine", 5, P1, "deck"),
      ...fillers("myHand", opts.myHand ?? 0, P1, "hand"),
      ...bank("obsession", opts.obsession ?? 8, P1)
    ]
  });
}

clause(INQUISITION, "0:rule", "the waiver is only for 'meeting their threshold': a removed tactic's numeric cost and its extra costs (here a discard) still apply", () => {
  const discardTactic = tactic({
    name: "NeedsDiscard",
    cost: 1,
    threshold: "rrr" as never,
    behavior: { abilities: [{ id: "d", type: "activated", costs: [{ type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const defs = [character({ name: "C0" }), discardTactic, ...Array.from({ length: 6 }, (_, i) => character({ name: `C${i + 2}` }))];
  const withHand = inquisitionCustomDeck(defs, { myHand: 1 });
  play(withHand.engine, P1, withHand.id("ei"), { selected: { voided: [withHand.id("o1")] } });
  drain(withHand.engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : declineAll(pc)));
  assert.ok(outOfGame(withHand.engine, withHand.id("o1")), "outOfGame(withHand.engine, withHand.id(\"o1\"))");

  const handBefore = handOf(withHand.engine, P1).length;
  const before = ready(withHand.engine);
  play(withHand.engine, P1, withHand.id("o1"), { selected: { d: [withHand.id("myHand0")] } });
  assert.equal(zoneOf(withHand.engine, withHand.id("myHand0")), "discard", "the extra cost (discard a card) was paid");
  assert.equal(before - ready(withHand.engine), 1, "and the numeric cost of 1");
  assert.equal(handOf(withHand.engine, P1).length, handBefore, "discarded one, drew one");

  const noHand = inquisitionCustomDeck(defs, { myHand: 0 });
  play(noHand.engine, P1, noHand.id("ei"), { selected: { voided: [noHand.id("o1")] } });
  drain(noHand.engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : declineAll(pc)));
  refused(() => playRaw(noHand.engine, P1, noHand.id("o1")), "no card to discard: the extra cost cannot be paid");
  assert.ok(outOfGame(noHand.engine, noHand.id("o1")), "it is still waiting");
});

clause(INQUISITION, "0:rule", "control: the threshold waiver is for the removed tactics only: a tactic in your own hand still needs its threshold", () => {
  const needsRage = tactic({ name: "NeedsRage", cost: 0, threshold: "rrr" as never, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const b = inquisitionBoard({ obsession: 6, extra: [{ key: "handTactic", def: needsRage, owner: P1, zone: "hand" }] });
  refused(() => playRaw(b.engine, P1, b.id("handTactic")), "no Rage: a hand tactic is refused");
  assert.equal(zoneOf(b.engine, b.id("handTactic")), "hand");
});

clause(INQUISITION, "0:rule", "it reveals the top 7 even if some are the caster's concern: the opponent's hand and graveyard tactics are not removed, only deck cards", () => {
  const b = inquisitionBoard({
    extra: [
      { key: "handTac", def: drawTactic("HandTac", 1), owner: P2, zone: "hand" },
      { key: "discTac", def: drawTactic("DiscTac", 1), owner: P2, zone: "discard" }
    ]
  });
  castInquisition(b, ["o1", "o4"]);
  assert.equal(zoneOf(b.engine, b.id("handTac")), "hand");
  assert.equal(zoneOf(b.engine, b.id("discTac")), "discard");
});
// --- Ecto-Distillation ---------------------------------------------------------
// COST: Name a card.
// EFFECT: Search your deck for any number of copies of the card and reveal them.
// Put 1 into your hand and the rest into your discard pile. Your opponent may
// search your deck for any number of copies of the card. If they do, put them
// into your discard pile.
// Tactic, cost 4, threshold [O][O][O].

const DISTILLATION = "ab9cdd87-c394-4108-a787-805193911891";

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
  answerPending(engine, "nameValue", { value: "Target" });
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
    refused(() => pickRaw(engine, P1, [id(key)]), `${key} is not a copy of the named card in your deck`);
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
          refused(() => pickRaw(engine, P2, [id(key)]), `${key} cannot be taken by the opponent's search`);
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
  refused(() => playRaw(short.engine, P1, short.id("ed")));
  assert.equal(zoneOf(short.engine, short.id("ed")), "hand");
  const noThreshold = distillationBoard({ obsession: 2, greed: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ed")));
  const exact = distillationBoard({ obsession: 4 });
  play(exact.engine, P1, exact.id("ed"));
  assert.equal(pending(exact.engine)?.kind, "nameValue", "exactly 4 resources with [O][O][O] is enough");
  const mixed = distillationBoard({ obsession: 3, greed: 1 });
  play(mixed.engine, P1, mixed.id("ed"));
  assert.equal(pending(mixed.engine)?.kind, "nameValue", "[O][O][O] plus one other resource is enough");
});
/** Like `distill`, but records which player was asked each declaration (`found`, `one`, `opp`). */
function distillAsked(engine: SpoilsEngine, id: (k: string) => string, answers: DistillAnswers) {
  const asked: Array<{ declaration: string; playerId: string }> = [];
  drain(engine, (pc) => {
    if (pc.kind === "nameValue") return { kind: "nameValue", value: answers.named ?? "Target" };
    if (pc.kind === "chooserSelectsTarget") {
      const declaration = (pc.declaration as { id: string }).id;
      asked.push({ declaration, playerId: pc.playerId });
      if (declaration === "found") return { kind: "chooserSelectsTarget", selected: (answers.find ?? []).map(id) };
      if (declaration === "one") return { kind: "chooserSelectsTarget", selected: answers.hand ? [id(answers.hand)] : [] };
      if (declaration === "opp") return { kind: "chooserSelectsTarget", selected: (answers.oppBins ?? []).map(id) };
    }
    return declineAll(pc);
  });
  return asked;
}

clause(DISTILLATION, "0:ability", "'Put 1 into your hand': the caster, who searched, picks which found copy goes into their hand", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  const asked = distillAsked(engine, id, { find: ["t1", "t2", "t3"], hand: "t2" });
  const one = asked.filter((q) => q.declaration === "one");
  assert.equal(one.length, 1, "one copy is chosen for the hand");
  assert.equal(one[0].playerId, P1, "the caster chooses which copy goes into their hand");
  assert.equal(zoneOf(engine, id("t2")), "hand");
});

clause(DISTILLATION, "0:ability", "the caster does the first search: 'found' is asked of the caster, and the opponent is only asked for the later 'may search' step", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  const asked = distillAsked(engine, id, { find: ["t1"], hand: "t1", oppBins: [] });
  const found = asked.filter((q) => q.declaration === "found");
  assert.equal(found.length, 1);
  assert.equal(found[0].playerId, P1, "I search my own deck");
  const opp = asked.filter((q) => q.declaration === "opp");
  assert.equal(opp.length, 1, "the opponent is asked once whether to search");
  assert.equal(opp[0].playerId, P2);
  assert.ok(asked.findIndex((q) => q.declaration === "found") < asked.findIndex((q) => q.declaration === "opp"), "the opponent's search comes after mine");
});

clause(DISTILLATION, "0:ability", "the copy for the hand must be one of the copies found (not one left in the deck)", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
  resolvePendingResponses(engine);
  pick(engine, P1, ["t1", "t2"].map(id));
  if (pending(engine)?.kind === "chooserSelectsTarget") {
    refused(() => pickRaw(engine, pending(engine)!.playerId as Pid, [id("t3")]), "t3 was not found");
    pickRaw(engine, pending(engine)!.playerId as Pid, [id("t1")]);
  }
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("t3")), "deck", "a copy that was not found stays in the deck");
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(zoneOf(engine, id("t2")), "discard");
});

clause(DISTILLATION, "0:ability", "if the opponent does not search, nothing more is put into the discard pile: only the tactic and the rest of the found copies are there", () => {
  const { engine, id } = distillationBoard({ copies: 4 });
  const discardBefore = discardOf(engine, P1).length;
  play(engine, P1, id("ed"));
  distillAsked(engine, id, { find: ["t1", "t2"], hand: "t1", oppBins: [] });
  assert.equal(discardOf(engine, P1).length, discardBefore + 1 /* t2 */ + 1 /* the tactic */);
  assert.equal(zoneOf(engine, id("t3")), "deck");
  assert.equal(zoneOf(engine, id("t4")), "deck");
});

clause(DISTILLATION, "0:ability", "the opponent's search does not touch the copy that went to your hand or the ones already found", () => {
  const { engine, id } = distillationBoard({ copies: 3 });
  play(engine, P1, id("ed"));
  distillAsked(engine, id, { find: ["t1", "t2"], hand: "t1", oppBins: ["t3"] });
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(zoneOf(engine, id("t2")), "discard");
  assert.equal(zoneOf(engine, id("t3")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("t3")), false, "it goes to the deck owner's discard pile, not the searcher's");
});

clause(DISTILLATION, "0:ability", "the deck is shuffled after my search AND again after the opponent's search: with a constant random source the deck is exactly the double-shuffled order", () => {
  const { engine, id } = distillationBoard({ copies: 4, random: () => 0 });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("ed"));
  distillAsked(engine, id, { find: ["t1"], hand: "t1", oppBins: ["t3"] });
  const afterMine = before.filter((c) => c !== id("t1"));
  const firstShuffle = shuffledWithConstant(afterMine, 0);
  const afterOpponent = firstShuffle.filter((c) => c !== id("t3"));
  const secondShuffle = shuffledWithConstant(afterOpponent, 0);
  assert.deepEqual(deckOf(engine, P1), secondShuffle, "shuffled once after my search, once after the opponent's search");
});
// --- Forget ----------------------------------------------------------------
// COST: Pick a non-resource card.
// EFFECT: Put the card into its owner's hand. Look at your opponent's hand and
// choose a card in it. Your opponent discards that card.
// Tactic, cost 5, threshold [O][O].

const FORGET = "a4f1535c-b3fa-46fa-93cd-d0b9f3abb10c";

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
  refused(attempt("myHand"), "a card from your own hand");
  refused(attempt("myChar"), "the character you just returned to your own hand");
  refused(attempt("foeChar"), "a card in play");
  refused(attempt("inDiscard"), "a card in a discard pile");
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
  refused(attempt([]), "none");
  refused(attempt(["oh1", "oh2"]), "two cards");
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
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(id("faceDown")), "a face-down card is only a resource");
  refused(attempt(factionOf(engine, P1)), "your faction");
  refused(attempt(factionOf(engine, P2)), "the opponent's faction");
  refused(attempt(id("myHand")), "a card in your hand is not in play");
  refused(attempt(id("oh1")), "a card in the opponent's hand");
  refused(attempt(id("inDiscard")), "a card in a discard pile");
  refused(() => playRaw(engine, P1, id("fg"), { selected: { bounced: [] } }), "a pick is required");
  refused(() => playRaw(engine, P1, id("fg"), { selected: { bounced: [id("myChar"), id("foeChar")] } }), "one card only");
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
  refused(() => playRaw(short.engine, P1, short.id("fg"), { selected: { bounced: [short.id("myChar")] } }));
  const noThreshold = forgetBoard({ obsession: 1, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("fg"), { selected: { bounced: [noThreshold.id("myChar")] } }));
  const exact = forgetBoard({ obsession: 5 });
  forgetAndDiscard(exact.engine, exact.id, "myChar", "oh1");
  assert.equal(zoneOf(exact.engine, exact.id("myChar")), "hand");
  const mixed = forgetBoard({ obsession: 2, greed: 3 });
  forgetAndDiscard(mixed.engine, mixed.id, "myChar", "oh1");
  assert.equal(zoneOf(mixed.engine, mixed.id("myChar")), "hand", "[O][O] plus 3 other resources is enough");
});

clause(FORGET, "0:ability", "a bounced character loses its tokens (CR 409.2): it is not carrying them when it is in hand again", () => {
  const { engine, id } = forgetBoard();
  engine.state.cards[id("myChar")].counters = { token: 2 };
  forgetAndDiscard(engine, id, "myChar", "oh1");
  assert.equal(zoneOf(engine, id("myChar")), "hand");
  assert.equal(tokens(engine, id("myChar")), 0, "tokens disappear when the card leaves play");
});

clause(FORGET, "0:ability", "a card attached to the bounced character follows it into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
      { key: "gear", def: booster(1), owner: P2, zone: "play", attachedToKey: "host" },
      { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
      ...bank("obsession", 7, P1)
    ]
  });
  forgetAndDiscard(engine, id, "host", "oh1");
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("gear")), "hand", "the attached card leaves play the same way: into its owner's hand");
});

clause(FORGET, "0:ability", "a bounced character loses its damage (CR 408.9)", () => {
  const { engine, id } = forgetBoard();
  engine.state.cards[id("foeChar")].damage = 1;
  forgetAndDiscard(engine, id, "foeChar", "oh1");
  assert.equal(engine.state.cards[id("foeChar")].damage, 0);
});

clause(FORGET, "0:ability", "the whole hand is looked at, so the discard may be any of the opponent's cards including the one that was just bounced; the other cards of their hand stay", () => {
  const { engine, id } = forgetBoard({ oppHand: ["oh1", "oh2"] });
  forgetAndDiscard(engine, id, "foeItem", "oh1");
  assert.equal(zoneOf(engine, id("foeItem")), "hand", "the bounced item stays in their hand when another card is chosen");
  assert.equal(zoneOf(engine, id("oh2")), "hand");
  assert.equal(zoneOf(engine, id("oh1")), "discard");
});

clause(FORGET, "0:ability", "is a tactic: it can be played in response during the opponent's turn (their attack window) and works the same", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
      ...bank("obsession", 7, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("fg"), { selected: { bounced: [id("attacker")] } }), "no window is open yet");
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("fg"), { selected: { bounced: [id("attacker")] } });
  resolvePendingResponses(engine);
  pick(engine, P1, [id("oh1")]);
  assert.equal(zoneOf(engine, id("attacker")), "hand", "the attacker was returned to its owner's hand");
  assert.equal(zoneOf(engine, id("oh1")), "discard");
});
// --- duplicate helpers (Ectypal Stave, Voidal Replication) ---------------------

/** A tactic that makes its controller draw `n` cards. */
function dupDrawTactic(name: string, cost: number, n = 1, extra: Partial<CardDefinition> = {}): CardDefinition {
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
// COUNTERFEIT -- COST: Use this only if a tactic has been played this turn. Pay
// 2+X, where X is the numeric cost of the last tactic played this turn. Deplete
// this card.
// EFFECT: Duplicate the tactic.
// Item, cost 2, threshold [O][O][O][O].

const STAVE = "03ba6516-c83c-49d4-a3c1-5a295f351c63";

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
  refused(() => counterfeit(b));
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
  refused(() => counterfeit(b), "only a TACTIC enables it");
});

for (const x of [0, 1, 2, 3, 5]) {
  clause(STAVE, "0:ability:counterfeit", `pays 2+X where X is the numeric cost of the last tactic (X=${x}: pays ${2 + x}), depletes itself and duplicates the tactic`, () => {
    const b = staveBoard([{ key: "t", def: dupDrawTactic(`DrawT${x}`, x), owner: P1, zone: "hand" }]);
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
    { key: "a", def: dupDrawTactic("First", 1, 1), owner: P1, zone: "hand" },
    { key: "b", def: dupDrawTactic("Second", 3, 2), owner: P1, zone: "hand" }
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
    { key: "b", def: dupDrawTactic("Big", 3, 2), owner: P1, zone: "hand" },
    { key: "a", def: dupDrawTactic("Small", 1, 1), owner: P1, zone: "hand" }
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
  const short = staveBoard([{ key: "t", def: dupDrawTactic("DrawT3", 3), owner: P1, zone: "hand" }], { obsession: 7 });
  play(short.engine, P1, short.id("t"));
  assert.equal(ready(short.engine), 4);
  refused(() => counterfeit(short), "4 resources for a cost of 2+3 = 5");
  assert.equal(isDepleted(short.engine, short.id("es")), false);
  assert.equal(ready(short.engine), 4, "nothing was spent");

  const exact = staveBoard([{ key: "t", def: dupDrawTactic("DrawT3", 3), owner: P1, zone: "hand" }], { obsession: 8 });
  play(exact.engine, P1, exact.id("t"));
  assert.equal(ready(exact.engine), 5);
  counterfeit(exact);
  assert.equal(ready(exact.engine), 0, "exactly 5 is enough");
  assert.equal(isDepleted(exact.engine, exact.id("es")), true);
});

clause(STAVE, "0:ability:counterfeit", "cannot be used while depleted; usable again after it restores, if a tactic has been played that turn", () => {
  const b = staveBoard([
    { key: "t1", def: dupDrawTactic("T1", 0), owner: P1, zone: "hand" },
    { key: "t2", def: dupDrawTactic("T2", 0), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("t1"));
  counterfeit(b);
  assert.equal(isDepleted(b.engine, b.id("es")), true);
  const resources = ready(b.engine);
  refused(() => counterfeit(b), "depleted: cost cannot be paid again");
  assert.equal(ready(b.engine), resources, "nothing was paid");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("es")), false, "restored at the start of its controller's next turn");
  refused(() => counterfeit(b), "no tactic has been played yet this turn");
  play(b.engine, P1, b.id("t2"));
  counterfeit(b);
  assert.equal(isDepleted(b.engine, b.id("es")), true, "usable again once a tactic was played this turn");
});

clause(STAVE, "0:ability:counterfeit", "only a tactic played THIS turn counts: a tactic from an earlier turn does not enable it", () => {
  const b = staveBoard([{ key: "t", def: dupDrawTactic("T", 0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.turn, 3);
  refused(() => counterfeit(b), "the tactic was played two turns ago");
});

clause(STAVE, "0:ability:counterfeit", "a tactic played by the OPPONENT this turn counts too: it is duplicated for you (its numeric cost sets X, and you control the duplicate)", () => {
  const b = staveBoard(
    [
      { key: "t", def: dupDrawTactic("TheirTactic", 2), owner: P2, zone: "hand" },
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
  const rageTactic = dupDrawTactic("RageT", 0, 1, { threshold: "rr" as never });
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
  const b = staveBoard([{ key: "t", def: dupDrawTactic("T4", 4), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("t"));
  const before = ready(b.engine);
  counterfeit(b);
  assert.equal(before - ready(b.engine), 6, "2 + 4, and nothing more for the copy itself");
});

clause(STAVE, "0:ability:counterfeit", "a tactic still on the stack counts as played: used in response to the opponent's tactic it pays 2+X and duplicates that tactic", () => {
  const b = staveBoard(
    [
      { key: "t", def: dupDrawTactic("TheirTactic", 2), owner: P2, zone: "hand" },
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
  const b = staveBoard([{ key: "t", def: dupDrawTactic("T", 0), owner: P1, zone: "hand" }, ...bank("obsession", 4, P2)]);
  play(b.engine, P1, b.id("t"));
  refused(() => counterfeit(b, P2), "the opponent cannot use my Stave");
  assert.equal(isDepleted(b.engine, b.id("es")), false);
});

clause(STAVE, "0:ability:counterfeit", "an ability on a Stave in your hand cannot be used", () => {
  const b = staveBoard([{ key: "t", def: dupDrawTactic("T", 0), owner: P1, zone: "hand" }], { staveZone: "hand" });
  play(b.engine, P1, b.id("t"));
  refused(() => counterfeit(b));
});

clause(STAVE, "0:ability:counterfeit", "printed card: an item, cost 2, threshold oooo", () => {
  deployChecks(STAVE, { type: "item", cost: 2, icons: 4 });
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

clause(STAVE, "0:ability:counterfeit", "the duplicate keeps the tactic's extra costs: duplicating a tactic that says 'Pick a character' asks for a new pick", () => {
  const b = staveBoard([
    { key: "at", def: pumpTactic(1), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("at"), { selected: { t: [b.id("mine")] } });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("es"), abilityId: "counterfeit", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.ok(pc, "the duplicate's extra cost 'Pick a character' has to be paid again: I am asked for a pick");
  assert.equal(pc.playerId, P1);
});
clause(STAVE, "0:ability:counterfeit", "a duplicated tactic with labelled options lets you choose a new option for the copy (CR 307.2)", () => {
  const modal = tactic({
    name: "Modal",
    cost: 0,
    behavior: {
      modes: [
        { label: "Draw", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { label: "Tax", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }
      ]
    }
  });
  const b = staveBoard([{ key: "modal", def: modal, owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("modal"), { mode: 0 });
  const start = influence(b.engine, P2);
  activate(b.engine, P1, b.id("es"), "counterfeit");
  const pc = pending(b.engine);
  assert.ok(pc, "you are asked which option the duplicate uses");
  assert.equal(pc.playerId, P1);
  const options = (pc.options as Array<{ label?: string }> | undefined) ?? [];
  const tax = options.findIndex((o) => /tax/i.test(o.label ?? ""));
  assert.ok(tax >= 0, "both options are offered");
  answerPending(b.engine, "chooserSelectsOption", { index: tax });
  assert.equal(influence(b.engine, P2), start - 1, "the copy used the OTHER option (Tax), not the one the original used (Draw)");
});

clause(STAVE, "0:ability:counterfeit", "the original tactic keeps its own result: duplicating 'draw 2' draws 2 more cards on top of the 2 already drawn", () => {
  const b = staveBoard([{ key: "t", def: dupDrawTactic("DrawTwo", 1, 2), owner: P1, zone: "hand" }]);
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("t"));
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 2, "the original drew 2");
  counterfeit(b);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 4, "and the duplicate drew 2 more");
});

clause(STAVE, "0:ability:counterfeit", "a second Stave sees the same last tactic: it also pays 2+X with X the cost of the tactic that was played (a duplicate is not a tactic played)", () => {
  const b = staveBoard([
    { key: "t", def: dupDrawTactic("Cost2", 2), owner: P1, zone: "hand" },
    { key: "es2", def: printing(STAVE), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("t"));
  const before = ready(b.engine);
  counterfeit(b);
  assert.equal(before - ready(b.engine), 2 + 2);
  const mid = ready(b.engine);
  activate(b.engine, P1, b.id("es2"), "counterfeit");
  assert.equal(mid - ready(b.engine), 2 + 2, "the second Stave also sees the cost-2 tactic as the last one played");
});
// --- Gargantuan Garbler ----------------------------------------------------------
// COVERT. If this card attacks, you may pick a character. If you do, put it into
// its owner's hand. Character (lurker), cost 9, threshold [O][O][O][O], 6 strength /
// 3 speed / 6 life.

const GARBLER = "9bc66f83-5eb1-462e-94c0-38af81813f81";

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
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker"), b.id("covertBlocker")] }), "...nor join a covert blocker in the blocking party");
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
  refused(() => playRaw(short.engine, P1, short.id("gg")), "8 resources for a cost of 9");
  const noIcons = board(3, 9);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("gg")), "only three [O]");
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
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] }), "the bounced character is not in play");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), startInfluence - 6, "the Garbler's 6 strength hits the faction unblocked");
});

clause(GARBLER, "1:rule", "the pick must be a character in play: items, locations, factions, face-down cards, resources and cards in hand or discard are refused", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource") ?? b.engine.state.players[P2].play.find((c) => b.engine.getDefinition(c).type === "resource");
  const attempt = (cardId: string) => () => pickRaw(b.engine, P1, [cardId]);
  refused(attempt(b.id("foeItem")), "an item");
  refused(attempt(b.id("foeLoc")), "a location");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource");
  refused(attempt(b.id("oppHand")), "a card in their hand");
  refused(attempt(b.id("myHand")), "a card in my hand");
  refused(attempt(b.id("inDiscard")), "a card in a discard pile");
  if (resourceId) refused(attempt(resourceId), "a resource");
  refused(() => pickRaw(b.engine, P1, [b.id("foe1"), b.id("foe2")]), "only one character");
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
clause(GARBLER, "0:kw:COVERT", "printed card: a lurker character, cost 9, threshold oooo, 6 strength / 3 speed / 6 life, COVERT its only keyword", () => {
  deployChecks(GARBLER, { type: "character", cost: 9, icons: 4, strength: 6, speed: 3, life: 6 });
  assert.deepEqual(printing(GARBLER).subtype, ["lurker"]);
  const b = garblerBoard();
  assert.deepEqual(b.engine.getKeywords(b.id("gg")), ["covert"]);
});

clause(GARBLER, "1:rule", "a picked character put into its owner's hand loses its tokens (CR 409.2)", () => {
  const b = garblerBoard({ extra: [{ key: "marked", def: character({ name: "Marked", life: 5 }), owner: P2, zone: "play", counters: { token: 2 } }] });
  garblerAttacks(b);
  pick(b.engine, P1, [b.id("marked")]);
  assert.equal(zoneOf(b.engine, b.id("marked")), "hand");
  assert.equal(tokens(b.engine, b.id("marked")), 0, "tokens disappear when the card leaves play");
});

clause(GARBLER, "1:rule", "a card attached to the picked character follows it into its owner's hand (CR 301.4a)", () => {
  const b = garblerBoard({
    extra: [
      { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
      { key: "gear", def: booster(1), owner: P2, zone: "play", attachedToKey: "host" }
    ]
  });
  garblerAttacks(b);
  pick(b.engine, P1, [b.id("host")]);
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand", "the attached card leaves play the same way: into its owner's hand");
});

clause(GARBLER, "1:rule", "a picked character loses its damage when it is put into hand (CR 408.9)", () => {
  const b = garblerBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 2 }] });
  garblerAttacks(b);
  pick(b.engine, P1, [b.id("hurt")]);
  assert.equal(b.engine.state.cards[b.id("hurt")].damage, 0);
});

clause(GARBLER, "1:rule", "attacking a location also counts as attacking: the trigger fires and the pick is offered", () => {
  const b = garblerBoard();
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("gg")], target: { type: "card", cardId: b.id("foeLoc") } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pick(b.engine, P1, [b.id("foe1")]);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "hand");
});

clause(GARBLER, "1:rule", "the pick is made as the attack is declared, before the opponent can respond or block: the attack is still declared and the battle exists afterwards", () => {
  const b = garblerBoard();
  garblerAttacks(b);
  assert.ok(battleOf(b.engine), "the battle has started");
  pick(b.engine, P1, [b.id("foe2")]);
  assert.ok(battleOf(b.engine), "and is still on after the pick");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("gg")]);
});

clause(GARBLER, "0:kw:COVERT", "a face-down Gargantuan Garbler has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(GARBLER));
// =============================================================================
// Gnat
// =============================================================================
// If this card leaves play, your opponent discards a card.
// Character (lurker), cost 1, threshold [O], 1 strength / 3 speed / 1 life.

const GNAT = "c11290da-e135-4b78-a132-303469bfe855";

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

clause(GNAT, "0:rule", "the opponent has to discard (no 'may'): choosing no card is refused while they have a card in hand", () => {
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


clause(GNAT, "0:rule", "printed card: a lurker character, cost 1, threshold o, 1 strength / 3 speed / 1 life", () => {
  deployChecks(GNAT, { type: "character", cost: 1, icons: 1, strength: 1, speed: 3, life: 1 });
  assert.deepEqual(printing(GNAT).subtype, ["lurker"]);
});

clause(GNAT, "0:rule", "the discard happens only once per Gnat leaving: after the Gnat is back in play and leaves again it triggers again", () => {
  const b = gnatBoard({ oppHand: 4, extra: bank("obsession", 2, P1) });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("gnat")] } });
  pick(b.engine, [b.id("oh0")]);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(b.engine.state.pendingChoice, undefined);
  play(b.engine, P1, b.id("gnat"), {});
  assert.equal(zoneOf(b.engine, b.id("gnat")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "re-entering play asks nothing");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("gnat")] } });
  assert.equal(pending(b.engine)?.playerId, P2, "it triggers again when it leaves again");
  pick(b.engine, [b.id("oh1")]);
  assert.equal(handOf(b.engine, P2).length, 2);
});
// --- Insidious Ecto-Manipulator --------------------------------------------
// COVERT. At the start of your turn, you may pick a non-resource card you
// control. If you do, put a token on it. Character (ecto-manipulator), cost 4,
// threshold [O][O], 2 strength / 3 speed / 2 life.

const INSIDIOUS = "d8ed4b93-f59d-423d-8791-471d3e5ea550";

clause(INSIDIOUS, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(INSIDIOUS));
clause(INSIDIOUS, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(INSIDIOUS));

function insidiousBoard(opts: { controller?: typeof P1 | typeof P2; ieZone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ie", def: printing(INSIDIOUS), owner: P1, zone: opts.ieZone ?? "play", controller: opts.controller },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "handCard", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      { key: "discarded", def: character({ name: "Discarded" }), owner: P1, zone: "discard" },
      ...["a1", "a2", "a3"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", 2, P1)
    ]
  });
}


const ALL_INSIDIOUS_KEYS = ["ie", "ally", "myItem", "myLoc", "foe", "foeItem", "stolen", "lent", "faceDown", "handCard", "discarded"];

/** Both players pass turns until P1's next turn starts; the Insidious trigger prompt is then open. */
function toMyTurnStart(engine: SpoilsEngine) {
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt at the start of the OPPONENT's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
}

for (const [key, what] of [
  ["ie", "itself"],
  ["ally", "another character"],
  ["myItem", "an item"],
  ["myLoc", "a location"],
  ["stolen", "a character it controls but does not own"]
] as const) {
  clause(INSIDIOUS, "1:rule", `at the start of your turn you may pick ${what} you control and it gets one token (and nothing else does)`, () => {
    const { engine, id } = insidiousBoard();
    toMyTurnStart(engine);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
    resolvePendingResponses(engine);
    for (const other of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(other)), other === key ? 1 : 0, `${other} tokens`);
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(INSIDIOUS, "1:rule", "'may': picking nothing puts no token anywhere", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  resolvePendingResponses(engine);
  for (const key of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(INSIDIOUS, "1:rule", "a card that already has tokens gets one more", () => {
  const { engine, id } = insidiousBoard();
  engine.state.cards[id("myItem")].counters = { token: 2 };
  toMyTurnStart(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("myItem")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("myItem")), 3);
});

clause(INSIDIOUS, "1:rule", "only one card is picked: picking two is refused", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("ally"), id("myItem")] } } as never));
});

clause(INSIDIOUS, "1:rule", "can only pick non-resource cards YOU control: resources, face-down cards, factions, the opponent's cards, and cards outside play are refused", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  assert.ok(resourceId, "resourceId");
  const attempt = (cardId: string) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(resourceId), "a resource");
  refused(attempt(id("faceDown")), "a face-down card is a resource");
  refused(attempt(engine.state.players[P1].factionId!), "your faction");
  refused(attempt(id("foe")), "the opponent's character");
  refused(attempt(id("foeItem")), "the opponent's item");
  refused(attempt(id("lent")), "a card the opponent controls (even though you own it)");
  refused(attempt(id("handCard")), "a card in your hand");
  refused(attempt(id("discarded")), "a card in your discard pile");
  attempt(id("ally"))();
  assert.equal(tokens(engine, id("ally")), 1);
});

clause(INSIDIOUS, "1:rule", "does not trigger at the start of the opponent's turn", () => {
  const { engine, id } = insidiousBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt for P1 on P2's turn");
  for (const key of ALL_INSIDIOUS_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
});

clause(INSIDIOUS, "1:rule", "'your turn' is its controller's turn: an Insidious controlled by the opponent triggers for them, not for its owner", () => {
  const { engine, id } = insidiousBoard({ controller: P2 });
  endTurn(engine, P1); // P2's turn begins: P2 controls it
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the controller chooses");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("lent")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("lent")), 1, "P2 may pick a card P2 controls");
  endTurn(engine, P2); // P1's turn begins
  assert.equal(engine.state.pendingChoice, undefined, "its owner gets nothing at the start of their own turn");
});

clause(INSIDIOUS, "1:rule", "does not trigger while it is not in play (in hand)", () => {
  const { engine } = insidiousBoard({ ieZone: "hand" });
  toMyTurnStart(engine);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(INSIDIOUS, "0:kw:COVERT", "printed card: an ecto-manipulator character, cost 4, threshold oo, 2 strength / 3 speed / 2 life, COVERT its only keyword", () => {
  deployChecks(INSIDIOUS, { type: "character", cost: 4, icons: 2, strength: 2, speed: 3, life: 2 });
  assert.deepEqual(printing(INSIDIOUS).subtype, ["ecto-manipulator"]);
  const { engine, id } = insidiousBoard();
  assert.deepEqual(engine.getKeywords(id("ie")), ["covert"]);
});

clause(INSIDIOUS, "1:rule", "the trigger is part of the card in play: two Insidious Ecto-Manipulators each ask for a pick and each puts a token", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ie1", def: printing(INSIDIOUS), owner: P1, zone: "play" },
      { key: "ie2", def: printing(INSIDIOUS), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" }
    ]
  });
  endTurn(engine, P2);
  let picks = 0;
  const targets = ["ally", "myItem"];
  drain(engine, (pc: PendingChoiceLike) => {
    if (pc.kind === "orderTriggers") return declineAll(pc);
    assert.equal(pc.kind, "chooserSelectsTarget");
    return { kind: "chooserSelectsTarget", selected: [id(targets[picks++])] };
  });
  assert.equal(picks, 2, "two picks were asked");
  assert.equal(tokens(engine, id("ally")), 1);
  assert.equal(tokens(engine, id("myItem")), 1);
});

clause(INSIDIOUS, "1:rule", "the same card may be picked on consecutive turns and keeps collecting tokens (1, then 2)", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  pick(engine, P1, [id("ally")]);
  assert.equal(tokens(engine, id("ally")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  pick(engine, P1, [id("ally")]);
  assert.equal(tokens(engine, id("ally")), 2);
});

clause(INSIDIOUS, "1:rule", "a token put on a card disappears when the card leaves play (CR 409.2): a character bounced and deployed again has no token", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ie", def: printing(INSIDIOUS), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", cost: 0 }), owner: P1, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ]
  });
  endTurn(engine, P2);
  pick(engine, P1, [id("ally")]);
  assert.equal(tokens(engine, id("ally")), 1);
  play(engine, P1, id("bounce"), { selected: { t: [id("ally")] } });
  assert.equal(zoneOf(engine, id("ally")), "hand");
  play(engine, P1, id("ally"));
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(tokens(engine, id("ally")), 0, "the token disappeared when the card left play");
});

clause(INSIDIOUS, "1:rule", "'may': the prompt is raised at the start of every one of your turns, even if you declined the last time", () => {
  const { engine, id } = insidiousBoard();
  toMyTurnStart(engine);
  pick(engine, P1, []);
  assert.equal(tokens(engine, id("ie")), 0);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "asked again next turn");
});

clause(INSIDIOUS, "0:kw:COVERT", "a face-down Insidious Ecto-Manipulator has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(INSIDIOUS));
// --- Lugubrian Octopod -----------------------------------------------------
// COVERT. If this card inflicts damage to a faction, your opponent discards 2
// cards. Character (lurker), cost 4, threshold [O][O][O][O], 1 strength / 1 speed
// / 1 life.

const OCTOPOD = "f54b6b5c-7d76-441f-a521-7d2e65b31d0b";

clause(OCTOPOD, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(OCTOPOD));
clause(OCTOPOD, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(OCTOPOD));

clause(OCTOPOD, "0:kw:COVERT", "a face-down Lugubrian Octopod has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(OCTOPOD));
function octopodBoard(opts: { attacker?: Pid; defenderHand?: number; weakened?: boolean; extra?: CardPlacement[] } = {}) {
  const attacker = opts.attacker ?? P1;
  const defender = other(attacker);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "oct", def: printing(OCTOPOD), owner: attacker, zone: "play" },
      ...(opts.weakened ? [{ key: "weakener", def: weakener(1), owner: attacker, zone: "play" as const, attachedToKey: "oct" }] : []),
      { key: "covertAlly", def: character({ name: "CovertAlly", strength: 2, life: 3, speed: 2, behavior: { keywords: ["covert"] } }), owner: attacker, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", strength: 1, life: 4, speed: 1, behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" },
      { key: "theirLoc", def: location({ name: "TheirLoc", structure: 5 }), owner: defender, zone: "play" },
      { key: "defInPlay", def: character({ name: "DefInPlay" }), owner: defender, zone: "play" },
      { key: "defDiscarded", def: character({ name: "DefDiscarded" }), owner: defender, zone: "discard" },
      ...Array.from({ length: opts.defenderHand ?? 3 }, (_, i) => ({ key: `dh${i + 1}`, def: character({ name: `DH${i + 1}` }), owner: defender, zone: "hand" as const })),
      ...fillers("atkHand", 2, attacker, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

type OctBoard = ReturnType<typeof octopodBoard>;

/** The Octopod hits the opponent's faction unblocked; the discard prompt (if any) is left open. */
const octopodHits = (b: OctBoard, attackers: string[] = ["oct"], attacker: Pid = P1) =>
  fight(b.engine, attacker, attackers.map(b.id), { type: "faction", playerId: other(attacker) }, []);

/** Answers the discard prompt(s) with `keys` and returns who was asked. */
function discardChoices(engine: SpoilsEngine, id: (k: string) => string, keys: string[]) {
  const asked: Array<{ kind: string; playerId: string }> = [];
  drain(engine, (pc) => {
    asked.push({ kind: pc.kind, playerId: pc.playerId });
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: keys.map(id) };
    return declineAll(pc);
  });
  return asked;
}

clause(OCTOPOD, "1:rule", "printed card: a lurker character, cost 4, threshold oooo, 1 strength / 1 speed / 1 life", () => {
  deployChecks(OCTOPOD, { type: "character", cost: 4, icons: 4, strength: 1, speed: 1, life: 1 });
  assert.deepEqual(printing(OCTOPOD).subtype, ["lurker"]);
  const b = octopodBoard();
  assert.deepEqual(b.engine.getKeywords(b.id("oct")), ["covert"], "COVERT is its only keyword");
});

clause(OCTOPOD, "1:rule", "when it damages a faction (unblocked), the opponent discards 2 cards of their choice, in addition to losing influence", () => {
  const b = octopodBoard();
  const influenceBefore = influence(b.engine, P2);
  octopodHits(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses their discards");
  discardChoices(b.engine, b.id, ["dh1", "dh3"]);
  assert.equal(influence(b.engine, P2), influenceBefore - 1, "the Octopod's 1 damage was inflicted on the faction");
  assert.equal(zoneOf(b.engine, b.id("dh1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dh3")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("dh1")) && discardOf(b.engine, P2).includes(b.id("dh3")), "into their own discard pile");
  assert.equal(zoneOf(b.engine, b.id("dh2")), "hand", "exactly two cards are discarded");
  assert.equal(handOf(b.engine, P1).length, 2, "your hand is untouched");
});

clause(OCTOPOD, "1:rule", "any two of the opponent's hand cards can be the ones discarded", () => {
  for (const keys of [
    ["dh1", "dh2"],
    ["dh2", "dh3"],
    ["dh1", "dh3"]
  ]) {
    const b = octopodBoard();
    octopodHits(b);
    discardChoices(b.engine, b.id, keys);
    for (const key of ["dh1", "dh2", "dh3"]) assert.equal(zoneOf(b.engine, b.id(key)), keys.includes(key) ? "discard" : "hand", `${keys.join("+")}: ${key}`);
  }
});

const octopodPrompt = () => {
  const b = octopodBoard();
  octopodHits(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  return b;
};

clause(OCTOPOD, "1:rule", "the discard is not optional (no 'may'): choosing no card is refused while the opponent holds 3 cards", () => {
  const b = octopodPrompt();
  refused(() => pickRaw(b.engine, []), "choosing no card");
  assert.equal(handOf(b.engine, P2).length, 3, "nothing was discarded by the refused answer");
});

clause(OCTOPOD, "1:rule", "the opponent must discard exactly 2: only 1 of 3 cards is refused", () => {
  const b = octopodPrompt();
  refused(() => pickRaw(b.engine, [b.id("dh1")]), "only one of the two cards");
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(OCTOPOD, "1:rule", "the opponent must discard exactly 2: three cards at once are refused, and two are accepted", () => {
  const b = octopodPrompt();
  refused(() => pickRaw(b.engine, ids(b, ["dh1", "dh2", "dh3"])), "three cards");
  assert.equal(handOf(b.engine, P2).length, 3);
  pickRaw(b.engine, ids(b, ["dh1", "dh2"]));
  assert.equal(handOf(b.engine, P2).length, 1, "control: two cards are accepted");
});

clause(OCTOPOD, "1:rule", "the two cards come from the OPPONENT's hand: the attacker's own hand, cards in play and the discard pile are refused", () => {
  const mk = () => octopodPrompt();
  const a = mk();
  refused(() => pickRaw(a.engine, ids(a, ["dh1", "atkHand0"])), "one card from the attacker's hand");
  const c = mk();
  refused(() => pickRaw(c.engine, ids(c, ["atkHand0", "atkHand1"])), "two cards from the attacker's hand");
  const d = mk();
  refused(() => pickRaw(d.engine, ids(d, ["dh1", "defInPlay"])), "a card in play");
  const e = mk();
  refused(() => pickRaw(e.engine, ids(e, ["dh1", "defDiscarded"])), "a card in the discard pile");
  const f = mk();
  pickRaw(f.engine, ids(f, ["dh2", "dh3"]));
  assert.equal(handOf(f.engine, P2).length, 1, "control: two cards of the opponent's hand work");
});

clause(OCTOPOD, "1:rule", "an opponent with only 1 card discards it; with no cards nothing happens and nobody is asked", () => {
  const one = octopodBoard({ defenderHand: 1 });
  octopodHits(one);
  discardChoices(one.engine, one.id, ["dh1"]);
  assert.equal(zoneOf(one.engine, one.id("dh1")), "discard");
  assert.equal(one.engine.state.pendingChoice, undefined);

  const none = octopodBoard({ defenderHand: 0 });
  octopodHits(none);
  assert.equal(none.engine.state.pendingChoice, undefined, "no prompt with an empty hand");
  assert.equal(zoneOf(none.engine, none.id("defDiscarded")), "discard");
});

clause(OCTOPOD, "1:rule", "an opponent with exactly 2 cards discards both", () => {
  const b = octopodBoard({ defenderHand: 2 });
  octopodHits(b);
  discardChoices(b.engine, b.id, ["dh1", "dh2"]);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(OCTOPOD, "1:rule", "does not trigger when its damage goes to a character (a covert blocker)", () => {
  const b = octopodBoard();
  fight(b.engine, P1, [b.id("oct")], { type: "faction", playerId: P2 }, [b.id("covertBlocker")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt is offered");
  assert.equal(battleOf(b.engine), undefined, "and the battle ran to its end");
  assert.equal(b.engine.state.cards[b.id("covertBlocker")].damage, 1, "the Octopod hit the blocker");
  assert.equal(handOf(b.engine, P2).length, 3, "no discards");
});

clause(OCTOPOD, "1:rule", "does not trigger when its damage goes to a location", () => {
  const b = octopodBoard();
  fight(b.engine, P1, [b.id("oct")], { type: "card", cardId: b.id("theirLoc") }, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt is offered");
  assert.equal(battleOf(b.engine), undefined, "and the battle ran to its end");
  assert.equal(b.engine.state.cards[b.id("theirLoc")].damage, 1, "the Octopod hit the location");
  assert.equal(handOf(b.engine, P2).length, 3, "no discards");
});

clause(OCTOPOD, "1:rule", "does not trigger when ANOTHER character damages the faction", () => {
  const b = octopodBoard();
  const before = influence(b.engine, P2);
  octopodHits(b, ["covertAlly"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt is offered");
  assert.equal(battleOf(b.engine), undefined, "and the battle ran to its end");
  assert.equal(influence(b.engine, P2), before - 2, "the ally dealt 2 damage to the faction");
  assert.equal(handOf(b.engine, P2).length, 3, "but the Octopod did not inflict it, so no discards");
});

clause(OCTOPOD, "1:rule", "attacking with another character, the Octopod's own damage still triggers it exactly once", () => {
  const b = octopodBoard({ defenderHand: 5 });
  octopodHits(b, ["oct", "covertAlly"]);
  const asked = discardChoices(b.engine, b.id, ["dh1", "dh2"]);
  assert.equal(asked.filter((a) => a.kind === "chooserSelectsTarget").length, 1, "one trigger, one discard prompt");
  assert.equal(handOf(b.engine, P2).length, 3, "5 cards minus exactly 2");
});

clause(OCTOPOD, "1:rule", "'your opponent' is the Octopod controller's opponent: when the opponent attacks with it, the other player discards", () => {
  const b = octopodBoard({ attacker: P2 });
  octopodHits(b, ["oct"], P2);
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P1, "the defending player discards");
  discardChoices(b.engine, b.id, ["dh1", "dh2"]);
  assert.equal(handOf(b.engine, P1).length, 1, "3 cards minus 2");
  assert.equal(handOf(b.engine, P2).length, 2, "the Octopod's controller keeps their cards");
});

clause(OCTOPOD, "1:rule", "inflicting 0 damage inflicts nothing: a weakened (0 strength) Octopod does not trigger", () => {
  const b = octopodBoard({ weakened: true });
  assert.equal(b.engine.getStat(b.id("oct"), "strength"), 0, "the test's weakening item works");
  const before = influence(b.engine, P2);
  octopodHits(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt is offered");
  assert.equal(battleOf(b.engine), undefined, "and the battle ran to its end");
  assert.equal(influence(b.engine, P2), before, "no damage");
  assert.equal(handOf(b.engine, P2).length, 3, "so no discards");
});

clause(OCTOPOD, "1:rule", "it triggers every time it damages a faction: a second hit on a later turn makes the opponent discard 2 more", () => {
  const b = octopodBoard({ defenderHand: 5 });
  octopodHits(b);
  discardChoices(b.engine, b.id, ["dh1", "dh2"]);
  finishBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  octopodHits(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "asked again on the second hit");
  discardChoices(b.engine, b.id, ["dh3", "dh4"]);
  assert.equal(handOf(b.engine, P2).length, 1);
});
// --- Nearby Serpent ----------------------------------------------------------------
// COVERT. When this card enters play, look at up to the top 5 cards of either deck.
// Put them back in any order. Character (lurker), cost 3, threshold [O][O][O],
// 2 strength / 1 speed / 1 life.

const SERPENT = "f96cbc48-3e51-48d9-9ac6-3537d1c78e6d";

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

clause(SERPENT, "0:kw:COVERT", "printed card: a lurker character, cost 3, threshold ooo, 2 strength / 1 speed / 1 life, COVERT its only keyword", () => {
  deployChecks(SERPENT, { type: "character", cost: 3, icons: 3, strength: 2, speed: 1, life: 1 });
  assert.deepEqual(printing(SERPENT).subtype, ["lurker"]);
  const b = serpentBoard({ serpentZone: "play" });
  assert.deepEqual(b.engine.getKeywords(b.id("ns")), ["covert"]);
});

clause(SERPENT, "0:kw:COVERT", "a face-down Nearby Serpent has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(SERPENT));

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
  refused(() => pickRaw(engine, P1, [id("oppChar")]), "a character is not a deck");
  refused(() => pickRaw(engine, P1, [id("a0")]), "a card in the deck is not a deck");
  refused(() => pickRaw(engine, P1, [engine.state.players[P1].factionId!, engine.state.players[P2].factionId!]), "only one deck");
  refused(() => pickRaw(engine, P1, []), "a deck must be chosen");
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
  refused(attempt(pc.cardIds.slice(1)), "the top card left out while deeper ones are kept (\"up to the top 5\" only shortens the look from the bottom)");
  refused(attempt([...pc.cardIds.slice(0, 4), id("b6")]), "a card from further down the deck");
  refused(attempt([...pc.cardIds.slice(0, 4), pc.cardIds[0]]), "a card twice");
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
  refused(() => playRaw(short.engine, P1, short.id("ns")));
  const noThreshold = serpentBoard({ obsession: 2, greed: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ns")));
  const exact = serpentBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("ns"));
  assert.equal(zoneOf(exact.engine, exact.id("ns")), "play");
});

clause(SERPENT, "1:rule", "'look at UP TO the top 5': you may look at fewer than 5 cards (here the top 3) and put just those back in any order", () => {
  const { engine, id } = serpentBoard();
  const before = deckOf(engine, P1).slice();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P1);
  const pc = pending(engine) as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  const topThree = before.slice(0, 3);
  const order = [topThree[2], topThree[0], topThree[1]];
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P1), [...order, ...before.slice(3)], "only the top 3 were reordered");
});

clause(SERPENT, "1:rule", "'up to' includes looking at 0 cards: you may decline to look at any card of either deck", () => {
  const { engine, id } = serpentBoard();
  const before = deckOf(engine, P2).slice();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P2);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [] } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P2), before);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SERPENT, "1:rule", "the Serpent's controller orders the cards even when the OPPONENT's deck is chosen", () => {
  const { engine, id } = serpentBoard();
  play(engine, P1, id("ns"));
  serpentLooks(engine, P2);
  const pc = pending(engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Serpent's controller orders the opponent's cards");
});

clause(SERPENT, "1:rule", "'enters play' includes being put into play by an effect, not only being deployed", () => {
  const putter = tactic({
    name: "Putter",
    cost: 0,
    behavior: { abilities: [{ id: "pp", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ns", def: printing(SERPENT), owner: P1, zone: "hand" },
      { key: "putter", def: putter, owner: P1, zone: "hand" },
      ...fillers("a", 6, P1, "deck"),
      ...fillers("b", 6, P2, "deck")
    ]
  });
  play(engine, P1, id("putter"), { selected: { t: [id("ns")] } });
  assert.equal(zoneOf(engine, id("ns")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the Serpent's enters-play trigger fired");
});

clause(SERPENT, "1:rule", "the two decks are independent: two Serpents can look at one deck each, and neither reorders the other deck", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ns1", def: printing(SERPENT), owner: P1, zone: "hand" },
      { key: "ns2", def: printing(SERPENT), owner: P1, zone: "hand" },
      ...fillers("a", 7, P1, "deck"),
      ...fillers("b", 7, P2, "deck"),
      ...bank("obsession", 6, P1)
    ]
  });
  const mine = deckOf(engine, P1).slice();
  const theirs = deckOf(engine, P2).slice();
  play(engine, P1, id("ns1"));
  serpentLooks(engine, P1);
  const first = pending(engine) as unknown as { cardIds: string[] };
  answerPending(engine, "reorderDeck", { order: [...first.cardIds].reverse() });
  play(engine, P1, id("ns2"));
  serpentLooks(engine, P2);
  const second = pending(engine) as unknown as { cardIds: string[] };
  answerPending(engine, "reorderDeck", { order: [...second.cardIds].reverse() });
  assert.deepEqual(deckOf(engine, P1), [...mine.slice(0, 5)].reverse().concat(mine.slice(5)));
  assert.deepEqual(deckOf(engine, P2), [...theirs.slice(0, 5)].reverse().concat(theirs.slice(5)));
});
// =============================================================================
// Maladjustment
// =============================================================================
// COST: Pick a resource you control. (You can pick face-down resources.)
// EFFECT: Put the resource into its owner's hand. You may play a resource.
// Tactic, cost 1, threshold [O].

const MALADJUSTMENT = "ebdd4312-fe66-4887-9071-7d9a2939742f";

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

clause(MALADJUSTMENT, "0:ability", "pays 1 and puts the picked face-up resource into its owner's hand, then offers to play a resource", () => {
  const b = maladBoard({ faceDown: false });
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("mal"), { selected: { res: [b.id("r1")] } });
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1 is paid while the tactic waits for responses");
  assert.equal(zoneOf(b.engine, b.id("r1")), "play", "the resource moves only when the tactic resolves");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "EFFECT: put the resource into its owner's hand");
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

clause(MALADJUSTMENT, "0:ability", "a resource you control but do not own goes into its OWNER's hand ('its owner's hand'), not yours", () => {
  const b = maladBoard({ extra: [obsessionCard("stolenRes", P2, { controller: P1 })] });
  assert.equal(b.engine.state.cards[b.id("stolenRes")].controllerId, P1);
  maladPlay(b, "stolenRes");
  assert.equal(zoneOf(b.engine, b.id("stolenRes")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolenRes")), "in its owner's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolenRes")), false, "not in the Maladjustment player's hand");
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

clause(MALADJUSTMENT, "0:ability", "is a tactic: it can be played in response during the opponent's turn (their attack window)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mal", def: printing(MALADJUSTMENT), owner: P1, zone: "hand" },
      obsessionCard("r1", P1),
      obsessionCard("r2", P1),
      { key: "hc", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  refused(() => playRaw(b.engine, P1, b.id("mal"), { selected: { res: [b.id("r1")] } }), "no window is open yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("mal"), { selected: { res: [b.id("r1")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
  pick(b.engine, [b.id("hc")]);
  assert.equal(zoneOf(b.engine, b.id("hc")), "play");
  assert.equal(b.engine.state.cards[b.id("hc")].faceDown, true);
});

clause(MALADJUSTMENT, "0:ability", "'play a resource' is open: you may play a different resource card than the one you picked (a ready-to-play resource card from hand, face-up)", () => {
  const b = maladBoard({ faceDown: false });
  maladPlay(b, "r1");
  pick(b.engine, [b.id("handRes")]);
  assert.equal(zoneOf(b.engine, b.id("handRes")), "play");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "the picked resource stays in hand");
});

clause(MALADJUSTMENT, "0:ability", "a spent (attached) resource can be picked and returns to hand", () => {
  const b = maladBoard({ faceDown: false, resources: 3, spentFirst: true });
  maladPlay(b, "r1");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
  assert.equal(b.engine.state.cards[b.id("r1")].attachedTo, undefined);
  pick(b.engine, []);
});
// =============================================================================
// Odious Diva
// =============================================================================
// Your opponent's hand is revealed at all times.
// DISAPPROVE -- COST: Pay 2. Name a card.
// EFFECT: Look at your opponent's hand. Your opponent puts a card with the chosen
// name on the bottom of their deck if they can. If they do, your opponent draws a card.
// Character (diva), cost 2, threshold [O][O], 1 strength / 3 speed / 2 life.

const DIVA = "f2335a40-bdc9-4cf0-9487-b42d424e06fc";

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

clause(DIVA, "1:ability:disapprove", "the opponent has to put a matching card on the bottom (no 'may'): choosing none is refused while they hold one", () => {
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

clause(DIVA, "0:rule", "printed card: a diva character, cost 2, threshold oo, 1 strength / 3 speed / 2 life", () => {
  deployChecks(DIVA, { type: "character", cost: 2, icons: 2, strength: 1, speed: 3, life: 2 });
  assert.deepEqual(printing(DIVA).subtype, ["diva"]);
});

clause(DIVA, "1:ability:disapprove", "a Diva in your hand has no DISAPPROVE", () => {
  const b = divaBoard({ zone: "hand" });
  refused(() => playRawAbility(b.engine, P1, b.id("diva"), "disapprove"), "not in play", /zone 'play'/);
  assert.equal(ready(b.engine), 4, "nothing was paid");
});

clause(DIVA, "1:ability:disapprove", "the draw is the opponent's: it is the top card of THEIR deck, and your own deck and hand are untouched", () => {
  const b = divaBoard();
  const mine = [...handOf(b.engine, P1)];
  disapprove(b, "Nemesis");
  pick(b.engine, [b.id("nem1")]);
  assert.deepEqual(handOf(b.engine, P1), mine);
});

clause(DIVA, "1:ability:disapprove", "an ability, not a tactic: it can be used in response during the opponent's turn (their attack window)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "diva", def: printing(DIVA), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "nem1", def: character({ name: "Nemesis" }), owner: P2, zone: "hand" },
      ...fillers("e", 3, P2, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  playRawAbility(b.engine, P1, b.id("diva"), "disapprove");
  resolvePendingResponses(b.engine);
  answerPending(b.engine, "nameValue", { value: "Nemesis" });
  pick(b.engine, [b.id("nem1")]);
  assert.equal(deckOf(b.engine, P2)[deckOf(b.engine, P2).length - 1], b.id("nem1"));
});
// =============================================================================
// Quotidian Virtuoso
// =============================================================================
// DISRUPT -- COST: Pay 2. Discard a card. Deplete this card.
// EFFECT: Look at your opponent's hand and choose a card in it. Your opponent discards that card.
// Character (ritualist), cost 5, threshold [O][O], 3 strength / 3 speed / 3 life.

const VIRTUOSO = "01a6dcbe-e7ad-41a9-87f7-8e22f1cc11ef";

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


clause(VIRTUOSO, "0:ability:disrupt", "printed card: a ritualist character, cost 5, threshold oo, 3 strength / 3 speed / 3 life", () => {
  deployChecks(VIRTUOSO, { type: "character", cost: 5, icons: 2, strength: 3, speed: 3, life: 3, staple: "obsession" });
  assert.deepEqual(printing(VIRTUOSO).subtype, ["ritualist"]);
});
// =============================================================================
// Recollection Bazaar
// =============================================================================
// RECALL -- COST: Pick a resource you control. (You can pick face-down resources.)
// EFFECT: Put the resource into it's owner's hand.
// Location, cost 0, threshold [O][O], structure 5.

const BAZAAR = "c9b3b2df-42c8-4547-bb85-cf1733538a04";

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

clause(BAZAAR, "0:ability:recall", "puts the picked face-up resource into its owner's hand, and the Bazaar is neither depleted nor does it cost anything", () => {
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

clause(BAZAAR, "0:ability:recall", "a resource you control but do not own goes into its OWNER's hand ('it's owner's hand'), not yours", () => {
  const b = bazaarBoard({ extra: [obsessionCard("stolenRes", P2, { controller: P1 })] });
  recall(b, "stolenRes");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolenRes")), "in its owner's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolenRes")), false, "not in the Bazaar controller's hand");
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

clause(BAZAAR, "0:ability:recall", "printed card: a location, cost 0, threshold oo, structure 5 (it deploys for free with two Obsession icons and is refused without them)", () => {
  deployChecks(BAZAAR, { type: "location", cost: 0, icons: 2, structure: 5 });
});

clause(BAZAAR, "0:ability:recall", "a Bazaar in your hand has no RECALL", () => {
  const b = bazaarBoard({ extra: [{ key: "baz2", def: printing(BAZAAR), owner: P1, zone: "hand" }] });
  refused(() => playRawAbility(b.engine, P1, b.id("baz2"), "recall", { res: [b.id("r1")] }), "not in play", /zone 'play'/);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
});
// =============================================================================
// Ritual of the Knob & Pull
// =============================================================================
// COST: Pick a character. X is its strength.
// EFFECT: If your opponent controls at least X face-down resources, destroy the character.
// Tactic, cost 3, threshold [O][O].

const KNOB = "87b8eec4-0dec-4ab0-a8da-c7cf70740890";

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

clause(KNOB, "0:ability", "'X is its strength' is fixed when the cost is paid: a strength boost played in response does not raise X", () => {
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
// Your opponent discards a card. You may search your deck for a card of the same
// type as the discarded card and reveal it. If you do, put it into your hand.
// Tactic, cost 4, threshold [O].

const URN = "0d9750c3-d284-4097-88bd-8c20bb922900";

type CardKind = "character" | "tactic" | "item" | "location" | "resource";
const kindCard = (kind: CardKind, name: string): CardDefinition =>
  kind === "character" ? character({ name }) : kind === "tactic" ? tactic({ name }) : kind === "item" ? item({ name }) : kind === "location" ? location({ name }) : resourceCard({ name });

function urnBoard(opts: { obsession?: number; theirHand?: Array<{ key: string; kind: CardKind }>; random?: () => number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
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
    turn: opts.turn,
    activePlayerId: opts.active,
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

clause(URN, "0:rule", "your opponent has to discard (no 'may'): choosing no card is refused while they have a card in hand", () => {
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


clause(URN, "0:rule", "declining the search is not a search: the deck is not shuffled (CR 312.1 only shuffles a deck that was searched)", () => {
  const b = urnBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  urnPlay(b);
  pick(b.engine, [b.id("oChar")]);
  pick(b.engine, []);
  assert.deepEqual(deckOf(b.engine, P1), before, "same cards in the same order");
});

clause(URN, "0:rule", "a search that finds nothing (no card of the discarded type in the deck) still shuffles the searched deck (CR 312.1, 312.2)", () => {
  const b = urnBoard({ random: () => 0 });
  // no location in the deck any more
  b.engine.state.players[P1].deck = b.engine.state.players[P1].deck.filter((c) => c !== b.id("dLoc"));
  b.engine.state.cards[b.id("dLoc")].zone = "discard";
  b.engine.state.players[P1].discard.push(b.id("dLoc"));
  const before = [...deckOf(b.engine, P1)];
  urnPlay(b);
  pick(b.engine, [b.id("oLoc")]);
  drain(b.engine, declineAll);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort(), "the same cards");
  assert.notDeepEqual(deckOf(b.engine, P1), before, "but the deck was searched (and failed), so it was shuffled");
});

clause(URN, "0:rule", "a found card of the same type that has a different name than anything discarded is fine: type, not name, decides", () => {
  const b = urnBoard();
  urnPlay(b);
  pick(b.engine, [b.id("oItem")]);
  pick(b.engine, [b.id("dItem")]);
  assert.notEqual(b.engine.getDefinition(b.id("dItem")).name, b.engine.getDefinition(b.id("oItem")).name);
  assert.equal(zoneOf(b.engine, b.id("dItem")), "hand");
});

clause(URN, "0:rule", "is a tactic: it can be played in response during the opponent's turn (their attack window)", () => {
  const b = urnBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  refused(() => playRaw(b.engine, P1, b.id("urn")), "no window is open yet");
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("urn"));
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P2, "the opponent discards");
  pick(b.engine, [b.id("oChar")]);
  assert.equal(zoneOf(b.engine, b.id("oChar")), "discard");
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
//   EFFECT: Look at your opponent's hand and choose a card in it. Your opponent discards that card.
// Character (ritualist), cost 8, threshold [O][O], 4 strength / 3 speed / 5 life.

const ELDRIDGE = "5529932d-de79-4d8d-bc55-c5240e86bd09";
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

clause(ELDRIDGE, "0:unique", "printed card: a ritualist character, cost 8, threshold oo, 4 strength / 3 speed / 5 life, entering play with no tokens", () => {
  deployChecks(ELDRIDGE, { type: "character", cost: 8, icons: 2, strength: 4, speed: 3, life: 5 });
  assert.deepEqual(printing(ELDRIDGE).subtype, ["ritualist"]);
  const b = uniqueBoard("gosche");
  assert.equal(tokensOn(b.engine, b.id("first")), 0, "no 'enters play with tokens' on this printing");
});

clause(ELDRIDGE, "0:unique", "after the UNIQUE choice forced by a tactic that took control of the opponent's Eldridge, the tactic finishes resolving and the game carries on", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "theirs", def: printing(ELDRIDGE), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" },
      { key: "widget", def: character({ name: "Widget" }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "you now control two Eldridges");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("mine") } } as never);
  for (let i = 0; i < 5 && b.engine.state.responseWindow; i++) {
    const w = b.engine.state.responseWindow;
    if (w.phase === "acceptingResponses") b.engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else b.engine.perform({ type: "advanceFlow" });
  }
  assert.equal(b.engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(b.engine, b.id("steal")), "discard", "the Steal tactic is finished");
  play(b.engine, P1, b.id("widget"));
  assert.equal(zoneOf(b.engine, b.id("widget")), "play", "and you can keep playing");
});

clause(ELDRIDGE, "0:unique", "taking control of the opponent's Eldridge makes you choose: the unkept copy (owned by the opponent) goes to the opponent's discard pile", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: printing(ELDRIDGE), owner: P1, zone: "play" },
      { key: "theirs", def: printing(ELDRIDGE), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("mine"), b.id("theirs")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("mine") } } as never);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("theirs")), "its owner's discard pile");
});

clause(ELDRIDGE, "1:rule", "tokens put on Eldridge disappear when he leaves play (CR 409.2): a bounced and redeployed Eldridge has no tokens", () => {
  const b = eldridgeBoard({
    startActive: P1,
    extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }, ...bank("obsession", 8, P1)]
  });
  b.engine.state.cards[b.id("eld")].counters = { token: 4 };
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("eld")] } });
  assert.equal(zoneOf(b.engine, b.id("eld")), "hand");
  play(b.engine, P1, b.id("eld"));
  assert.equal(zoneOf(b.engine, b.id("eld")), "play");
  assert.equal(tokensOn(b.engine, b.id("eld")), 0, "the 4 tokens disappeared when he left play");
});

clause(ELDRIDGE, "2:ability:eject", "a card attached to the ejected character follows it into its owner's hand (CR 301.4a)", () => {
  const b = eldridgeBoard({
    tokens: 3,
    startActive: P1,
    extra: [
      { key: "gear", def: booster(1), owner: P2, zone: "play", attachedToKey: "foe" }
    ]
  });
  eject(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand", "the attached card leaves play the same way: into its owner's hand");
});

clause(ELDRIDGE, "2:ability:eject", "EJECT is an ability, not a tactic: it can be used in response on the opponent's turn (their attack window)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  playRawAbility(b.engine, P1, b.id("eld"), "eject", { c: [b.id("attacker")] });
  resolvePendingResponses(b.engine);
  assert.equal(tokensOn(b.engine, b.id("eld")), 0);
  assert.equal(zoneOf(b.engine, b.id("attacker")), "hand");
});

clause(ELDRIDGE, "3:ability:disrupt", "DISRUPT is an ability, not a tactic: it can be used in response on the opponent's turn (their attack window)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "eld", def: printing(ELDRIDGE), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  playRawAbility(b.engine, P1, b.id("eld"), "disrupt");
  resolvePendingResponses(b.engine);
  assert.equal(tokensOn(b.engine, b.id("eld")), 0);
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
});

clause(ELDRIDGE, "3:ability:disrupt", "the 3 tokens are paid when DISRUPT is used (before the opponent can respond); the discard waits for resolution", () => {
  const b = eldridgeBoard({ tokens: 5, startActive: P1 });
  playRawAbility(b.engine, P1, b.id("eld"), "disrupt");
  assert.equal(tokensOn(b.engine, b.id("eld")), 2, "cost already paid");
  assert.equal(handOf(b.engine, P2).length, 4, "nothing discarded yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(ELDRIDGE, "2:ability:eject", "the 3 tokens are paid when EJECT is used (before the opponent can respond); the card only moves when it resolves", () => {
  const b = eldridgeBoard({ tokens: 5, startActive: P1 });
  playRawAbility(b.engine, P1, b.id("eld"), "eject", { c: [b.id("foe")] });
  assert.equal(tokensOn(b.engine, b.id("eld")), 2, "cost already paid");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "not moved yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
});
// =============================================================================
// Emphatic Ecto-Manipulator
// =============================================================================
// COST: You may pick a character you control.
// When this card enters play, if you picked a character as part of its cost, put
// 2 tokens on that character.
// Character (ecto-manipulator), cost 5, threshold [O][O], 3 strength / 3 speed / 3 life.

const EMPHATIC = "7de1da21-b357-4870-b860-7abb5a49d565";

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

clause(EMPHATIC, "1:rule", "'if you picked a character as part of its cost': put into play by an effect no cost was paid and no character was picked, so it puts no tokens anywhere", () => {
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


clause(EMPHATIC, "0:ability", "printed card: an ecto-manipulator character, cost 5, threshold oo, 3 strength / 3 speed / 3 life", () => {
  deployChecks(EMPHATIC, { type: "character", cost: 5, icons: 2, strength: 3, speed: 3, life: 3 });
  assert.deepEqual(printing(EMPHATIC).subtype, ["ecto-manipulator"]);
});

clause(EMPHATIC, "1:rule", "a character you control but do not own can be the picked character, and gets the tokens", () => {
  const b = emphaticBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  emphaticPlay(b, "stolen");
  assert.equal(tokensOn(b.engine, b.id("stolen")), 2);
});

clause(EMPHATIC, "1:rule", "tokens put on the picked character disappear when it leaves play (CR 409.2): a bounced and redeployed character has no tokens", () => {
  const b = emphaticBoard({
    extra: [
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "picked", def: character({ name: "Picked", cost: 0 }), owner: P1, zone: "play" }
    ]
  });
  emphaticPlay(b, "picked");
  assert.equal(tokensOn(b.engine, b.id("picked")), 2);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("picked")] } });
  assert.equal(zoneOf(b.engine, b.id("picked")), "hand");
  play(b.engine, P1, b.id("picked"));
  assert.equal(zoneOf(b.engine, b.id("picked")), "play");
  assert.equal(tokensOn(b.engine, b.id("picked")), 0, "the tokens disappeared when it left play");
});

clause(EMPHATIC, "1:rule", "the trigger is on the Ecto-Manipulator that entered: a second one deployed later picks and tokens separately", () => {
  const b = emphaticBoard({
    obsession: 10,
    extra: [{ key: "em2", def: printing(EMPHATIC), owner: P1, zone: "hand" }]
  });
  emphaticPlay(b, "mine");
  play(b.engine, P1, b.id("em2"), { selected: { pick: [b.id("mine2")] } });
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
  assert.equal(tokensOn(b.engine, b.id("mine2")), 2);
});
// --- Quotidian Misfire -----------------------------------------------------
// This turn, if a card is put into a player's hand, put it into their discard
// pile instead. Tactic, cost 2, threshold [O][O].

const MISFIRE = "f45ed56f-654c-44ae-8012-f02d078f3293";

/** A free tactic after which the opponent draws a card. */
const giftTactic = () =>
  tactic({ name: "Gift", cost: 0, behavior: { abilities: [{ id: "gift", type: "activated", effects: [{ type: "draw", player: "opponent", amount: 1 }] }] } });
/** A character that draws its controller a card for free (ability `study`). */
const studyDef = () =>
  character({
    name: "Scholar",
    behavior: { abilities: [{ id: "study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
/** A character that searches its controller's deck for a tactic and puts it into their hand (ability `qi`). */
const tutorDef = () =>
  character({
    name: "Tutor",
    behavior: {
      abilities: [
        {
          id: "qi",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "f", selector: { owner: "self", zone: "deck", type: "tactic" }, count: 1, optional: true },
              effects: [{ type: "moveCard", target: { type: "selected", id: "f" }, to: "hand" }]
            }
          ]
        }
      ]
    }
  });
/** A free tactic returning one tactic of the caster's discard pile to their hand (declaration `target`). */
const recoverTactic = () =>
  tactic({
    name: "Recover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "recover",
          type: "activated",
          targets: [{ id: "target", selector: { owner: "self", zone: "discard", type: "tactic" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "target" }, to: "hand" }]
        }
      ]
    }
  });

function misfireBoard(opts: { obsession?: number; greed?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "gift", def: giftTactic(), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "scholar", def: studyDef(), owner: P1, zone: "play" },
      { key: "mr", def: tutorDef(), owner: P1, zone: "play" },
      { key: "recover", def: recoverTactic(), owner: P1, zone: "hand" },
      { key: "tacInDeck", def: tactic({ name: "TacInDeck" }), owner: P1, zone: "deck" },
      { key: "tacInDiscard", def: tactic({ name: "TacInDiscard" }), owner: P1, zone: "discard" },
      ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "deck" as const })),
      ...["b1", "b2", "b3", "b4"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const })),
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MISFIRE, "0:rule", "pays 2 and itself ends in the discard pile, not the hand", () => {
  const { engine, id } = misfireBoard();
  const before = ready(engine);
  play(engine, P1, id("qm"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("qm")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("qm")), "discardOf(engine, P1).includes(id(\"qm\"))");
});

clause(MISFIRE, "0:rule", "is refused one resource short of 2, and without [O][O] even with enough other resources; accepted with exactly [O][O]", () => {
  const short = misfireBoard({ obsession: 1 });
  refused(() => playRaw(short.engine, P1, short.id("qm")), "1 resource for a cost of 2");
  assert.equal(zoneOf(short.engine, short.id("qm")), "hand");
  const noThreshold = misfireBoard({ obsession: 1, greed: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("qm")), "one [O] is not [O][O]");
  const noIcons = misfireBoard({ obsession: 0, greed: 5 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("qm")), "no [O]");
  const exact = misfireBoard({ obsession: 2 });
  play(exact.engine, P1, exact.id("qm"));
  assert.equal(zoneOf(exact.engine, exact.id("qm")), "discard");
  const mixed = misfireBoard({ obsession: 2, greed: 3 });
  play(mixed.engine, P1, mixed.id("qm"));
  assert.equal(zoneOf(mixed.engine, mixed.id("qm")), "discard", "[O][O] plus other resources is enough");
});

clause(MISFIRE, "0:rule", "control: without Misfire a bounced character goes to its owner's hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("bounce"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foe")), "handOf(engine, P2).includes(id(\"foe\"))");
});

for (const [target, owner] of [
  ["mine", P1],
  ["foe", P2],
  ["stolen", P2]
] as const) {
  clause(MISFIRE, "0:rule", `this turn, a character (${target}) that is put into a hand is put into its owner's discard pile instead`, () => {
    const { engine, id } = misfireBoard();
    play(engine, P1, id("qm"));
    const handsBefore = [handOf(engine, P1).length, handOf(engine, P2).length];
    play(engine, P1, id("bounce"), { selected: { t: [id(target)] } });
    assert.equal(zoneOf(engine, id(target)), "discard");
    assert.equal(discardOf(engine, owner).includes(id(target)), true, `in ${owner}'s discard pile`);
    assert.equal(handOf(engine, P1).length, handsBefore[0] - 1, "only the Bounce tactic left your hand; nothing arrived");
    assert.equal(handOf(engine, P2).length, handsBefore[1], "the opponent's hand did not grow");
  });
}

clause(MISFIRE, "0:rule", "a card you draw (from the Develop Rule) goes from the deck to your discard pile instead of your hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  developDraw(engine, P1);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top), "discard", "the drawn card is discarded");
  assert.equal(handOf(engine, P1).length, handBefore, "nothing reached the hand");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1, "it did leave the deck");
});

clause(MISFIRE, "0:rule", "a card drawn by a card effect also goes to the discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("scholar"), "study");
  assert.equal(zoneOf(engine, top), "discard");
  assert.equal(handOf(engine, P1).length, handBefore);
});

clause(MISFIRE, "0:rule", "it affects every player: the opponent's draw goes to THEIR discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  const oppTop = deckOf(engine, P2)[0];
  const handBefore = handOf(engine, P2).length;
  play(engine, P1, id("gift"));
  assert.equal(zoneOf(engine, oppTop), "discard");
  assert.equal(discardOf(engine, P2).includes(oppTop), true, "the opponent's own discard pile");
  assert.equal(discardOf(engine, P1).includes(oppTop), false);
  assert.equal(handOf(engine, P2).length, handBefore);
});

clause(MISFIRE, "0:rule", "control: without Misfire the same effects draw into the hand", () => {
  const { engine, id } = misfireBoard();
  const top = deckOf(engine, P1)[0];
  activate(engine, P1, id("scholar"), "study");
  assert.equal(zoneOf(engine, top), "hand");
  const oppTop = deckOf(engine, P2)[0];
  play(engine, P1, id("gift"));
  assert.equal(zoneOf(engine, oppTop), "hand");
});

clause(MISFIRE, "0:rule", "a card found by searching your deck goes to the discard pile instead of your hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  activate(engine, P1, id("mr"), "qi");
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tacInDeck")] } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("tacInDeck")), "discard", "the tutored tactic is discarded");
  assert.equal(handOf(engine, P1).includes(id("tacInDeck")), false);
});

clause(MISFIRE, "0:rule", "it applies from every zone: a tactic returned from the discard pile stays in the discard pile", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  play(engine, P1, id("recover"), { selected: { target: [id("tacInDiscard")] } });
  assert.equal(zoneOf(engine, id("tacInDiscard")), "discard");
  assert.equal(handOf(engine, P1).includes(id("tacInDiscard")), false);
});

clause(MISFIRE, "0:rule", "control: without Misfire the recovered tactic does reach the hand", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("recover"), { selected: { target: [id("tacInDiscard")] } });
  assert.equal(zoneOf(engine, id("tacInDiscard")), "hand");
});

clause(MISFIRE, "0:rule", "cards already in a hand stay there, and a card played from hand into play is unaffected", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  assert.equal(zoneOf(engine, id("keep")), "hand");
  assert.equal(zoneOf(engine, id("oppHand")), "hand");
  play(engine, P1, id("keep"));
  assert.equal(zoneOf(engine, id("keep")), "play", "deploying is not 'put into a hand'");
});

clause(MISFIRE, "0:rule", "only cards put into a HAND are redirected: a card put into a deck or the discard pile is not", () => {
  const toDeck = tactic({
    name: "ToDeck",
    cost: 0,
    behavior: { abilities: [{ id: "td", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "toDeck", def: toDeck, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("a", 3, P1, "deck"),
      ...bank("obsession", 4, P1)
    ]
  });
  play(engine, P1, id("qm"));
  play(engine, P1, id("toDeck"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "deck", "put into a deck, not a hand: Misfire doesn't touch it");
});

clause(MISFIRE, "0:rule", "lasts this turn only: on the next turns draws go to the hand again", () => {
  const { engine, id } = misfireBoard();
  play(engine, P1, id("qm"));
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const p2Top = deckOf(engine, P2)[0];
  developDraw(engine, P2);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, p2Top), "hand", "the opponent's draw on their turn is a normal draw");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const p1Top = deckOf(engine, P1)[0];
  activate(engine, P1, id("scholar"), "study");
  assert.equal(zoneOf(engine, p1Top), "hand", "and so is yours on your next turn");
});

clause(MISFIRE, "0:rule", "played on the opponent's turn (in response to their attack) it is live for the rest of that turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 2, P1)
    ]
  });
  openDefenderWindow(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("qm"));
  b.engine.perform({ type: "passPriority", playerId: P2 });
  b.engine.perform({ type: "advanceFlow" } as never);
  assert.equal(zoneOf(b.engine, b.id("qm")), "discard", "Misfire resolved");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I still hold priority in the same window");
  playRaw(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "this turn a card put into a hand goes to the discard pile instead");
});

clause(MISFIRE, "0:rule", "played in the opponent's end-of-turn window it is gone when your own turn starts: your next draw goes to the hand", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "scholar", def: studyDef(), owner: P1, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...bank("obsession", 2, P1)
    ]
  });
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the end of their turn");
  playRaw(b.engine, P1, b.id("qm"));
  resolvePendingResponses(b.engine);
  settleStartFirst(b.engine); // my turn start's Restore and Develop Rules
  assert.equal(b.engine.state.activePlayerId, P1, "my turn has started");
  const top = deckOf(b.engine, P1)[0];
  activate(b.engine, P1, b.id("scholar"), "study");
  assert.equal(zoneOf(b.engine, top), "hand", "'this turn' ended with the opponent's turn: my draw is a normal draw");
});

clause(MISFIRE, "0:rule", "it is over after this turn: the next turns (the opponent's, then yours) a bounced character reaches the hand again", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
      { key: "bounce1", def: bounceTactic(), owner: P2, zone: "hand" },
      { key: "bounce2", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("a", 3, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("obsession", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("qm"));
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  play(b.engine, P2, b.id("bounce1"), { selected: { t: [b.id("theirs")] } });
  assert.equal(zoneOf(b.engine, b.id("theirs")), "hand", "on the opponent's turn the redirect is over");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("bounce2"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "and on my next turn too");
});
