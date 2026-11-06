// Clause tests — batch seed-10. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-10`. Expectations come from each
// card's PRINTED text and RULES.md; engine data (ability ids, declaration ids,
// choice kinds) is only used to DRIVE the engine.

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
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, setupGame, developOffers, endTurnRaw, settleStartFirst } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

/** Violence (Seed): a resource that provides [R][R] and costs its controller 1 influence when it enters play. */
const VIOLENCE = "c842bfd6-add5-4365-9401-22fab0bda5bc";

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const isFaceDown = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].faceDown === true;

/** Raw `activateAbility` WITHOUT draining the response window. */
function actRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

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

/** Both players have a Develop Rule; `extra` is merged into the game options. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

type Game = ReturnType<typeof devBoard>;

/** `n` of my (or `owner`'s) rage resources already attached to (spent on) the faction. */
const spent = (icon: "rage" | "greed", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** A free tactic (id "k", pick "t"): destroys one picked character. This is the harness `killTactic`. */
const killer = (): CardDefinition => killTactic();

/**
 * A free tactic (id "dis", no picks) in the OPPONENT's hand: the player who does NOT
 * control it ("an opponent") chooses `n` cards from their hand and discards them.
 */
function forceDiscardTactic(n: number, name = `Force Discard ${n}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dis",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "opponent",
              declaration: { id: "d", selector: { owner: "opponent", zone: "hand" }, count: n },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
            }
          ]
        }
      ]
    }
  });
}

/** A free tactic (id "sf", no picks): the controller discards `n` cards of their own choice from their own hand. */
function selfDiscardTactic(n: number, name = `Self Discard ${n}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sf",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "d", selector: { owner: "self", zone: "hand" }, count: n },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
            }
          ]
        }
      ]
    }
  });
}

/** A free tactic (id "pip", pick "t"): puts one picked card from the controller's discard pile into play under the controller. */
function putIntoPlayTactic(type: "character" | "location" | "item" | "resource"): CardDefinition {
  return tactic({
    name: `Put ${type} Into Play`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "k2", picks "t" x2): destroys two picked characters. */
function killTwoTactic(): CardDefinition {
  return tactic({
    name: "Double Kill",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k2",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 2 }],
          effects: [{ type: "forEach", selected: "t", effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
}

/** A free tactic (id "dmg", pick "t"): inflicts `n` damage (not battle damage) to one picked character. */
function damageTactic(n: number, name = `Zap ${n}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }]
        }
      ]
    }
  });
}

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to`. */
function moverTactic(to: "hand" | "discard", name = `Mover to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }]
        }
      ]
    }
  });
}

/** A free tactic (id "no") with no effect, used to open response windows on the opponent's turn. */
const NOOP = tactic({ id: "seed10-noop", name: "Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });

/** `playRaw` then resolve the response window (no response). */
function playAndResolve(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}): void {
  playRaw(engine, player, cardId, opts);
  resolvePendingResponses(engine);
}

/** Answers every open pending choice with the default decline, then asserts nothing is left open. */
function settle(engine: SpoilsEngine): void {
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined, "no choice is left open");
}

// =============================================================================
// Mass Confusion
// COST: Choose a number for X. Pay X. Pick X characters.
// EFFECT: Inflict Y damage divided however you want to the characters, where Y is
// the number of characters your opponent controls minus the number of characters
// you control.
// Tactic, cost 0, [R][R].
// =============================================================================

const MASS = "48c4d2f0-8d0f-4203-a6ae-b81d9ebce2eb";

function massBoard(
  opts: { mine?: number; theirs?: number; rage?: number; greed?: number; life?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}
) {
  const life = opts.life ?? 9;
  return devBoard(
    [
      { key: "mc", def: printing(MASS), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.mine ?? 1 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine ${i}`, life }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: opts.theirs ?? 3 }, (_, i) => ({ key: `o${i}`, def: character({ name: `Theirs ${i}`, life }), owner: P2, zone: "play" as const })),
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

/** Raw play of Mass Confusion: picks `picks` (placement keys) with X = `x`. */
function mcRaw(game: Game, picks: string[], x: number, player: PlayerId = P1): void {
  playRaw(game.engine, player, game.id("mc"), { selected: { cs: picks.map((key) => game.id(key)) }, variables: { x } });
}

/** Plays Mass Confusion and lets the response window pass; whatever is pending (the division) is left open. */
function mcPlay(game: Game, picks: string[], x: number): void {
  mcRaw(game, picks, x);
  resolvePendingResponses(game.engine);
}

/** Answers the division prompt with `shares` (placement keys to damage). */
function divide(game: Game, shares: Record<string, number>): void {
  const mapped: Record<string, number> = {};
  for (const [key, amount] of Object.entries(shares)) mapped[game.id(key)] = amount;
  answerPending(game.engine, "distributeAmong", { shares: mapped });
}

clause(MASS, "0:ability", "Y is the opponent's characters minus mine: 3 - 1 = 2 damage, and X = 1 puts all of it on the one picked character", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 2 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("o0")), 2, "the picked character takes all Y = 2");
  assert.equal(damageOf(g.engine, g.id("o1")), 0, "an unpicked character takes nothing");
  assert.equal(damageOf(g.engine, g.id("o2")), 0);
  assert.equal(damageOf(g.engine, g.id("m0")), 0, "my character takes nothing");
});

clause(MASS, "0:ability", "X = 2 asks ME (the caster) how to divide Y, and the prompt names exactly the picked characters and the amount Y", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  mcPlay(g, ["o0", "o1"], 2);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal(pc.playerId, P1, "the player who played the card divides");
  assert.equal(pc.amount, 2, "Y = 3 - 1");
  assert.deepEqual([...(pc.targets as string[])].sort(), [g.id("o0"), g.id("o1")].sort(), "divided among the picked characters only");
});

for (const [label, shares, expected] of [
  ["1 and 1", { o0: 1, o1: 1 }, { o0: 1, o1: 1 }],
  ["2 and 0 (all on the first)", { o0: 2 }, { o0: 2, o1: 0 }],
  ["0 and 2 (all on the second)", { o1: 2 }, { o0: 0, o1: 2 }]
] as const) {
  clause(MASS, "0:ability", `'divided however you want': Y = 2 may be split ${label}`, () => {
    const g = massBoard({ mine: 1, theirs: 3 });
    mcPlay(g, ["o0", "o1"], 2);
    divide(g, shares);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(damageOf(g.engine, g.id("o0")), expected.o0);
    assert.equal(damageOf(g.engine, g.id("o1")), expected.o1);
    assert.equal(damageOf(g.engine, g.id("o2")), 0, "the unpicked character is untouched");
    assert.equal(damageOf(g.engine, g.id("m0")), 0);
  });
}

clause(MASS, "0:ability", "X = 3 with Y = 4 (5 opponents, 1 mine): any split over three picked characters works, e.g. 2/1/1", () => {
  const g = massBoard({ mine: 1, theirs: 5 });
  mcPlay(g, ["o0", "o1", "o2"], 3);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal(pc.amount, 4);
  divide(g, { o0: 2, o1: 1, o2: 1 });
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => damageOf(g.engine, g.id(`o${i}`))), [2, 1, 1, 0, 0]);
});

clause(MASS, "0:ability", "'the characters' may be mine as well as the opponent's: a mixed pick of my character and theirs divides Y between them", () => {
  const g = massBoard({ mine: 2, theirs: 5 });
  mcPlay(g, ["m0", "o0"], 2);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal(pc.amount, 3, "Y = 5 - 2");
  divide(g, { m0: 1, o0: 2 });
  assert.equal(damageOf(g.engine, g.id("m0")), 1);
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
  assert.equal(damageOf(g.engine, g.id("m1")), 0);
});

clause(MASS, "0:ability", "only my own characters can be picked too (X = 1, Y = 2 all on my own character)", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  mcPlay(g, ["m0"], 1);
  if (pending(g.engine)) divide(g, { m0: 2 });
  assert.equal(damageOf(g.engine, g.id("m0")), 2);
  assert.equal(damageOf(g.engine, g.id("o0")), 0);
});

clause(MASS, "0:ability", "the division cannot exceed Y: dividing 3 damage when Y = 2 is refused (exactly Y is accepted)", () => {
  const over = massBoard({ mine: 1, theirs: 3 });
  mcPlay(over, ["o0", "o1"], 2);
  refused(() => divide(over, { o0: 2, o1: 1 }), "an over-divided Y");
  assert.equal(damageOf(over.engine, over.id("o0")) + damageOf(over.engine, over.id("o1")), 0, "nothing was inflicted");
  const exact = massBoard({ mine: 1, theirs: 3 });
  mcPlay(exact, ["o0", "o1"], 2);
  divide(exact, { o0: 1, o1: 1 });
  assert.equal(damageOf(exact.engine, exact.id("o0")) + damageOf(exact.engine, exact.id("o1")), 2, "control: exactly Y is accepted");
});

clause(MASS, "0:ability", "the whole of Y must be inflicted: dividing only 1 of Y = 2 (or none of it) is refused", () => {
  const under = massBoard({ mine: 1, theirs: 3 });
  mcPlay(under, ["o0", "o1"], 2);
  refused(() => divide(under, { o0: 1 }), "an under-divided Y");
  const none = massBoard({ mine: 1, theirs: 3 });
  mcPlay(none, ["o0", "o1"], 2);
  refused(() => divide(none, {}), "dividing none of Y");
});

clause(MASS, "0:ability", "the damage can only be divided among the PICKED characters: a share on an unpicked character is refused", () => {
  const bad = massBoard({ mine: 1, theirs: 3 });
  mcPlay(bad, ["o0", "o1"], 2);
  refused(() => divide(bad, { o0: 1, o2: 1 }), "a share on an unpicked character");
  const good = massBoard({ mine: 1, theirs: 3 });
  mcPlay(good, ["o0", "o1"], 2);
  divide(good, { o0: 1, o1: 1 });
  assert.equal(damageOf(good.engine, good.id("o2")), 0, "control: the legal division leaves it alone");
});

clause(MASS, "0:ability", "a negative share is not a division of Y: {+3, -1} is refused", () => {
  const bad = massBoard({ mine: 1, theirs: 3 });
  mcPlay(bad, ["o0", "o1"], 2);
  refused(() => divide(bad, { o0: 3, o1: -1 }), "a negative share");
  assert.equal(damageOf(bad.engine, bad.id("o0")), 0);
  assert.equal(damageOf(bad.engine, bad.id("o1")), 0);
});

clause(MASS, "0:ability", "damage is inflicted: a character whose damage reaches its life is destroyed", () => {
  const g = massBoard({ mine: 1, theirs: 3, life: 2 });
  mcPlay(g, ["o0", "o1"], 2);
  divide(g, { o0: 1, o1: 1 });
  assert.equal(zoneOf(g.engine, g.id("o0")), "play", "1 damage on a 2-life character is not lethal");
  const lethal = massBoard({ mine: 1, theirs: 3, life: 2 });
  mcPlay(lethal, ["o0", "o1"], 2);
  divide(lethal, { o0: 2 });
  assert.equal(zoneOf(lethal.engine, lethal.id("o0")), "discard", "2 damage on a 2-life character destroys it");
  assert.equal(zoneOf(lethal.engine, lethal.id("o1")), "play");
});

clause(MASS, "0:ability", "the damage adds to damage a picked character already took this turn", () => {
  const g = massBoard({ mine: 1, theirs: 3, life: 4, extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("o0")] } });
  assert.equal(damageOf(g.engine, g.id("o0")), 1);
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 2 });
  assert.equal(damageOf(g.engine, g.id("o0")), 3);
});

clause(MASS, "0:ability", "Mass Confusion goes to its owner's discard pile once it has resolved", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 2 });
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("mc")), "discardOf(g.engine, P1).includes(g.id(\"mc\"))");
});

// --- Y

clause(MASS, "0:ability", "Y = 0 when both sides control the same number of characters: no damage is inflicted", () => {
  const g = massBoard({ mine: 3, theirs: 3 });
  mcPlay(g, ["o0", "o1"], 2);
  drain(g.engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: {} } : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["o0", "o1", "o2", "m0", "m1", "m2"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} takes nothing`);
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard", "the card still resolved");
});

clause(MASS, "0:ability", "Y never goes below 0 (CR 410.4): the opponent controls fewer characters than I do, so nothing is damaged", () => {
  const g = massBoard({ mine: 4, theirs: 1 });
  mcPlay(g, ["o0", "m0"], 2);
  drain(g.engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: {} } : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["o0", "m0", "m1", "m2", "m3"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} takes nothing (Y = 1 - 4 stays 0)`);
});

clause(MASS, "0:ability", "Y counts characters only: items, locations, resources and face-down cards the opponent controls do not count", () => {
  const g = massBoard({
    mine: 1,
    theirs: 2,
    extra: [
      { key: "oi", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "ol", def: location({ name: "Their Location" }), owner: P2, zone: "play" },
      ...bank("greed", 2, P2),
      ...volition(2, P2)
    ]
  });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 1 });
  assert.equal(damageOf(g.engine, g.id("o0")), 1, "Y = 2 characters - 1 character = 1, not counting the other 6 cards");
});

clause(MASS, "0:ability", "Y does not count MY non-characters either (my items, locations and face-down cards are not characters)", () => {
  const g = massBoard({
    mine: 1,
    theirs: 3,
    extra: [
      { key: "mi", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "ml", def: location({ name: "My Location" }), owner: P1, zone: "play" },
      ...volition(3, P1)
    ]
  });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 2 });
  assert.equal(damageOf(g.engine, g.id("o0")), 2, "Y = 3 - 1 = 2");
});

clause(MASS, "0:ability", "'controls', not 'owns': a character I own but my opponent controls counts as THEIR character", () => {
  const g = massBoard({
    mine: 1,
    theirs: 1,
    extra: [{ key: "stolen", def: character({ name: "Stolen", life: 9 }), owner: P1, controller: P2, zone: "play" }]
  });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 1 });
  assert.equal(damageOf(g.engine, g.id("o0")), 1, "opponent controls 2 (o0 and the stolen one), I control 1: Y = 1");
});

clause(MASS, "0:ability", "'controls', not 'owns': a character the opponent owns but I control counts as MINE", () => {
  const g = massBoard({
    mine: 1,
    theirs: 3,
    extra: [{ key: "captured", def: character({ name: "Captured", life: 9 }), owner: P2, controller: P1, zone: "play" }]
  });
  mcPlay(g, ["o0"], 1);
  if (pending(g.engine)) divide(g, { o0: 1 });
  assert.equal(damageOf(g.engine, g.id("o0")), 1, "opponent controls 3, I control 2 (m0 and the captured one): Y = 1");
});

clause(MASS, "0:ability", "Y counts the characters I pick too (they are characters I control): picking my own characters does not change Y", () => {
  const a = massBoard({ mine: 3, theirs: 5 });
  mcPlay(a, ["o0"], 1);
  if (pending(a.engine)) divide(a, { o0: 2 });
  const b = massBoard({ mine: 3, theirs: 5 });
  mcPlay(b, ["m0"], 1);
  if (pending(b.engine)) divide(b, { m0: 2 });
  assert.equal(damageOf(a.engine, a.id("o0")), 2, "Y = 5 - 3 whether I pick theirs...");
  assert.equal(damageOf(b.engine, b.id("m0")), 2, "...or mine");
});

clause(MASS, "0:ability", "Y is worked out when the effect resolves: a character the opponent loses in response lowers Y", () => {
  const g = massBoard({ mine: 1, theirs: 3, extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  mcRaw(g, ["o0"], 1);
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("o2")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o2")), "discard", "the response destroyed an unpicked opposing character");
  if (pending(g.engine)) divide(g, { o0: 1 });
  assert.equal(damageOf(g.engine, g.id("o0")), 1, "Y = 2 - 1 = 1 when it resolves");
});

clause(MASS, "0:ability", "if a picked character leaves play in response, the damage is divided among the picked characters still in play", () => {
  const g = massBoard({ mine: 1, theirs: 3, extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  mcRaw(g, ["o0", "o1"], 2);
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("o0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  const pc = pending(g.engine);
  if (pc) {
    const shares: Record<string, number> = {};
    shares[g.id("o1")] = pc.amount as number;
    answerPending(g.engine, "distributeAmong", { shares });
  }
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("o1")), 1, "Y = 2 - 1 = 1 (o0 is gone), all on the survivor");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
});

// --- X, cost

clause(MASS, "0:ability", "'Pay X': X = 1 pays exactly 1 resource", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  const before = ready(g.engine);
  mcRaw(g, ["o0"], 1);
  assert.equal(before - ready(g.engine), 1, "paid exactly X = 1 (the card's own cost is 0)");
});

clause(MASS, "0:ability", "'Pay X': X = 2 pays exactly 2 and X = 3 pays exactly 3", () => {
  const two = massBoard({ mine: 1, theirs: 3 });
  const b2 = ready(two.engine);
  mcRaw(two, ["o0", "o1"], 2);
  assert.equal(b2 - ready(two.engine), 2);
  const three = massBoard({ mine: 1, theirs: 3 });
  const b3 = ready(three.engine);
  mcRaw(three, ["o0", "o1", "o2"], 3);
  assert.equal(b3 - ready(three.engine), 3);
});

clause(MASS, "0:ability", "X = 0 is a whole number (CR 410.2a): it pays nothing, picks no one, and damages no one", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  const before = ready(g.engine);
  mcRaw(g, [], 0);
  assert.equal(before - ready(g.engine), 0, "Pay 0");
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: {} } : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["o0", "o1", "o2", "m0"]) assert.equal(damageOf(g.engine, g.id(key)), 0);
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard", "it resolved");
});

clause(MASS, "0:ability", "X can be as high as my resources allow: X = 6 with 6 resources and 6 characters to pick", () => {
  const g = massBoard({ mine: 1, theirs: 8, rage: 6 });
  const before = ready(g.engine);
  mcPlay(g, ["o0", "o1", "o2", "o3", "o4", "o5"], 6);
  assert.equal(before - ready(g.engine), 6);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal(pc.amount, 7, "Y = 8 - 1");
  assert.equal((pc.targets as string[]).length, 6);
});

clause(MASS, "0:ability", "X resources must really be available: X = 3 with only 2 resources is refused and nothing is paid or picked", () => {
  const bad = massBoard({ mine: 1, theirs: 3, rage: 2 });
  refused(() => mcRaw(bad, ["o0", "o1", "o2"], 3), "paying 3 with 2 resources");
  assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing was paid");
  const good = massBoard({ mine: 1, theirs: 3, rage: 3 });
  mcPlay(good, ["o0", "o1", "o2"], 3);
  assert.equal(ready(good.engine), 0, "control: X = 3 with exactly 3 resources works");
});

clause(MASS, "0:ability", "resources already spent cannot pay X: 2 ready + 2 spent resources cannot pay X = 3", () => {
  const bad = massBoard({ mine: 1, theirs: 3, rage: 2, extra: spent("rage", 2) });
  assert.equal(ready(bad.engine), 2);
  refused(() => mcRaw(bad, ["o0", "o1", "o2"], 3), "paying 3 with 2 ready resources");
  assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
});

clause(MASS, "0:ability", "'Pick X characters': picking fewer than X is refused (X = 2, one pick), picking more is refused (X = 1, two picks)", () => {
  const few = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(few, ["o0"], 2), "one pick for X = 2");
  assert.equal(zoneOf(few.engine, few.id("mc")), "hand");
  assert.equal(ready(few.engine), 6, "nothing paid");
  const many = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(many, ["o0", "o1"], 1), "two picks for X = 1");
  assert.equal(zoneOf(many.engine, many.id("mc")), "hand");
  const none = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(none, [], 1), "no pick for X = 1");
  const ok = massBoard({ mine: 1, theirs: 3 });
  mcPlay(ok, ["o0", "o1"], 2);
  assert.equal(expectPending(ok.engine, "distributeAmong").amount, 2, "control: X picks for X = 2 works");
});

clause(MASS, "0:ability", "X = 0 with a pick is refused (0 characters must be picked)", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(g, ["o0"], 0), "a pick for X = 0");
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
});

clause(MASS, "0:ability", "'Pick X characters' are X different characters: the same character twice is refused", () => {
  const bad = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(bad, ["o0", "o0"], 2), "the same character twice");
  assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
  const good = massBoard({ mine: 1, theirs: 3 });
  mcPlay(good, ["o0", "o1"], 2);
  assert.equal(expectPending(good.engine, "distributeAmong").amount, 2, "control: two different characters work");
});

clause(MASS, "0:ability", "there must be X characters in play to pick: X = 5 with only 4 characters in play is refused", () => {
  const bad = massBoard({ mine: 1, theirs: 3, rage: 6 });
  refused(() => mcRaw(bad, ["o0", "o1", "o2", "m0", "m0"], 5), "five picks from four characters");
  assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
  assert.equal(ready(bad.engine), 6);
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(MASS, "0:ability", `cannot pick ${label}; a legal character pick works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = massBoard({ mine: 1, theirs: 3, extra });
    refused(() => mcRaw(bad, [key], 1), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
    assert.equal(ready(bad.engine), 6, "nothing was paid");
    const good = massBoard({ mine: 1, theirs: 3, extra });
    mcPlay(good, ["o0"], 1);
    if (pending(good.engine)) divide(good, { o0: 2 });
    assert.equal(damageOf(good.engine, good.id("o0")), 2, "control: a character in play can be picked");
  });
}

clause(MASS, "0:ability", "cannot pick a faction (CR 202.9): neither mine nor the opponent's", () => {
  const mine = massBoard({ mine: 1, theirs: 3 });
  refused(() => playRaw(mine.engine, P1, mine.id("mc"), { selected: { cs: [factionOf(mine.engine, P1)] }, variables: { x: 1 } }), "picking my faction");
  assert.equal(zoneOf(mine.engine, mine.id("mc")), "hand");
  const theirs = massBoard({ mine: 1, theirs: 3 });
  refused(() => playRaw(theirs.engine, P1, theirs.id("mc"), { selected: { cs: [factionOf(theirs.engine, P2)] }, variables: { x: 1 } }), "picking their faction");
  assert.equal(influenceOf(theirs.engine, P2), 30);
});

clause(MASS, "0:ability", "the faction is never damaged: only characters are", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  mcPlay(g, ["o0", "o1"], 2);
  divide(g, { o0: 1, o1: 1 });
  assert.equal(influenceOf(g.engine, P1), 30);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(MASS, "0:ability", "X must be a whole number (CR 410.2): X = 1.5 is refused", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(g, ["o0", "o1"], 1.5), "a fractional X");
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(MASS, "0:ability", "X cannot be negative: X = -1 is refused", () => {
  const g = massBoard({ mine: 1, theirs: 3 });
  refused(() => mcRaw(g, [], -1), "a negative X");
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
  assert.equal(ready(g.engine), 6);
});

// --- threshold, timing

clause(MASS, "0:ability", "it needs [R][R] (threshold): one Rage with plenty of other resources is refused", () => {
  const bad = massBoard({ mine: 1, theirs: 3, rage: 1, greed: 5 });
  refused(() => mcRaw(bad, ["o0"], 1), "one [R]");
  assert.equal(zoneOf(bad.engine, bad.id("mc")), "hand");
  const none = massBoard({ mine: 1, theirs: 3, rage: 0, greed: 6 });
  refused(() => mcRaw(none, ["o0"], 1), "no [R]");
  const good = massBoard({ mine: 1, theirs: 3, rage: 2, greed: 4 });
  mcPlay(good, ["o0"], 1);
  if (pending(good.engine)) divide(good, { o0: 2 });
  assert.equal(zoneOf(good.engine, good.id("mc")), "discard", "control: [R][R] works");
});

clause(MASS, "0:ability", "face-down resources (Volition) and the opponent's Rage do not meet [R][R]", () => {
  const faceDown = massBoard({ mine: 1, theirs: 3, rage: 0, extra: volition(5, P1) });
  refused(() => mcRaw(faceDown, ["o0"], 1), "only Volition");
  const theirs = massBoard({ mine: 1, theirs: 3, rage: 1, greed: 5, extra: bank("rage", 4, P2) });
  refused(() => mcRaw(theirs, ["o0"], 1), "their [R] is not mine");
});

clause(MASS, "0:ability", "spent (attached) Rage still meets [R][R] (icons are never spent, CR 405.6) while other resources pay X", () => {
  const g = massBoard({ mine: 1, theirs: 3, rage: 0, greed: 2, extra: spent("rage", 2) });
  assert.equal(ready(g.engine), 2);
  mcPlay(g, ["o0", "o1"], 2);
  assert.equal(ready(g.engine), 0, "X = 2 was paid by the two ready Greed");
  assert.equal(expectPending(g.engine, "distributeAmong").amount, 2);
});

clause(MASS, "0:ability", "it is a tactic: it can be played in response during the opponent's attack", () => {
  const g = massBoard({
    mine: 1,
    theirs: 3,
    game: { turn: 2, activePlayerId: P2 },
    extra: [{ key: "myguard", def: character({ name: "Guard" }), owner: P1, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority");
  mcRaw(g, ["o1"], 1);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) divide(g, { o1: 1 });
  assert.equal(damageOf(g.engine, g.id("o1")), 1, "Y = 3 - 2 = 1 on their character");
});

// =============================================================================
// Mighty Ballista
// This card enters play depleted.
// FIRE! -- COST: Choose a number for X. Pay X. Deplete this card. Pick a character
// or location. -- EFFECT: Inflict X damage to the character or location. Inflict X
// damage to this card.
// Location, cost 2, [R][R][R][R], structure 10.
// =============================================================================

const BALLISTA = "d1ac8d42-b086-471a-8d66-e4ef475f9558";

function ballistaBoard(
  opts: {
    zone?: "play" | "hand";
    depleted?: boolean;
    damage?: number;
    rage?: number;
    greed?: number;
    life?: number;
    extra?: CardPlacement[];
    game?: Parameters<typeof buildGame>[0];
    controller?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "mb", def: printing(BALLISTA), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted, damage: opts.damage, controller: opts.controller },
      { key: "foe", def: character({ name: "Foe", life: opts.life ?? 9 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: opts.life ?? 9 }), owner: P1, zone: "play" },
      { key: "theirPlace", def: location({ name: "Their Place", structure: 8 }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "My Place", structure: 8 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

/** Raw FIRE! with X = `x` picking `target` (a placement key). */
function fireRaw(game: Game, target: string | undefined, x: number, player: PlayerId = P1): void {
  actRaw(game.engine, player, game.id("mb"), "fire", target === undefined ? {} : { t: [game.id(target)] }, { x });
}

function fire(game: Game, target: string, x: number): void {
  fireRaw(game, target, x);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
}

clause(BALLISTA, "0:rule", "deployed from hand it costs 2 and enters play DEPLETED", () => {
  const g = ballistaBoard({ zone: "hand", rage: 4 });
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("mb"));
  assert.equal(zoneOf(g.engine, g.id("mb")), "play");
  assert.equal(isDepleted(g.engine, g.id("mb")), true, "it entered play depleted");
  assert.equal(before - ready(g.engine), 2, "cost 2");
  settle(g.engine);
});

clause(BALLISTA, "0:rule", "it needs [R][R][R][R] to be deployed: three Rage and plenty of other resources is refused", () => {
  const bad = ballistaBoard({ zone: "hand", rage: 3, greed: 4 });
  refused(() => playRaw(bad.engine, P1, bad.id("mb")), "three [R]");
  assert.equal(zoneOf(bad.engine, bad.id("mb")), "hand");
  const none = ballistaBoard({ zone: "hand", rage: 0, greed: 6 });
  refused(() => playRaw(none.engine, P1, none.id("mb")), "no [R]");
  const good = ballistaBoard({ zone: "hand", rage: 4, greed: 0 });
  playAndResolve(good.engine, P1, good.id("mb"));
  assert.equal(zoneOf(good.engine, good.id("mb")), "play", "control: four [R] works");
});

clause(BALLISTA, "0:rule", "the threshold may be met by spent Rage, but the cost of 2 needs ready resources: one ready resource is refused, two work", () => {
  const bad = ballistaBoard({ zone: "hand", rage: 0, greed: 1, extra: spent("rage", 4) });
  assert.equal(ready(bad.engine), 1);
  refused(() => playRaw(bad.engine, P1, bad.id("mb")), "only one ready resource");
  assert.equal(zoneOf(bad.engine, bad.id("mb")), "hand");
  const good = ballistaBoard({ zone: "hand", rage: 0, greed: 2, extra: spent("rage", 4) });
  playAndResolve(good.engine, P1, good.id("mb"));
  assert.equal(zoneOf(good.engine, good.id("mb")), "play", "control: two ready resources and the (spent) icons are enough");
  assert.equal(ready(good.engine), 0);
});

clause(BALLISTA, "0:rule", "face-down resources do not meet the [R] threshold", () => {
  const bad = ballistaBoard({ zone: "hand", rage: 0, extra: volition(6, P1) });
  refused(() => playRaw(bad.engine, P1, bad.id("mb")), "only Volition");
  assert.equal(zoneOf(bad.engine, bad.id("mb")), "hand");
});

clause(BALLISTA, "0:rule", "it enters play depleted whatever way it enters: put into play from the discard pile by an effect", () => {
  const g = ballistaBoard({
    zone: "hand",
    extra: [
      { key: "back", def: printing(BALLISTA), owner: P1, zone: "discard" },
      { key: "pip", def: putIntoPlayTactic("location"), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("back")] } });
  assert.equal(zoneOf(g.engine, g.id("back")), "play");
  assert.equal(isDepleted(g.engine, g.id("back")), true, "depleted on entering play by an effect, not only by being deployed");
});

clause(BALLISTA, "0:rule", "the opponent's Ballista enters play depleted for them too", () => {
  const g = ballistaBoard({
    game: { turn: 2, activePlayerId: P2 },
    extra: [{ key: "theirs", def: printing(BALLISTA), owner: P2, zone: "hand" }, ...bank("rage", 4, P2)]
  });
  playAndResolve(g.engine, P2, g.id("theirs"));
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(isDepleted(g.engine, g.id("theirs")), true);
});

clause(BALLISTA, "0:rule", "only the Ballista enters depleted: another location deployed alongside it is not depleted", () => {
  const g = ballistaBoard({ zone: "hand", extra: [{ key: "loc", def: location({ name: "Plain Location", cost: 0 }), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("mb"));
  playAndResolve(g.engine, P1, g.id("loc"));
  assert.equal(isDepleted(g.engine, g.id("mb")), true);
  assert.equal(isDepleted(g.engine, g.id("loc")), false, "an ordinary location is not depleted by the Ballista's rule");
});

clause(BALLISTA, "0:rule", "being depleted on arrival means FIRE! (which depletes it as a cost) cannot be used that turn", () => {
  const g = ballistaBoard({ zone: "hand", rage: 8 });
  playAndResolve(g.engine, P1, g.id("mb"));
  assert.equal(isDepleted(g.engine, g.id("mb")), true);
  const before = ready(g.engine);
  refused(() => fireRaw(g, "foe", 1), "FIRE! while depleted");
  assert.equal(ready(g.engine), before, "nothing was paid");
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(BALLISTA, "0:rule", "it is restored at the start of my next turn (my faction's restore rule), and FIRE! works then", () => {
  const g = ballistaBoard({ zone: "hand", rage: 8 });
  playAndResolve(g.engine, P1, g.id("mb"));
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(g.engine, g.id("mb")), false, "restored at the start of my turn");
  fire(g, "foe", 1);
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

// FIRE!

clause(BALLISTA, "1:ability:fire", "X = 2: pays exactly 2, depletes the Ballista, inflicts 2 to the picked character and 2 to the Ballista", () => {
  const g = ballistaBoard();
  const before = ready(g.engine);
  fire(g, "foe", 2);
  assert.equal(before - ready(g.engine), 2, "Pay X");
  assert.equal(isDepleted(g.engine, g.id("mb")), true, "Deplete this card");
  assert.equal(damageOf(g.engine, g.id("foe")), 2, "X damage to the character");
  assert.equal(damageOf(g.engine, g.id("mb")), 2, "X damage to this card");
  assert.equal(zoneOf(g.engine, g.id("mb")), "play");
});

clause(BALLISTA, "1:ability:fire", "X = 1 and X = 4 scale the cost and both damages (1/1/1 and 4/4/4)", () => {
  const one = ballistaBoard();
  const b1 = ready(one.engine);
  fire(one, "foe", 1);
  assert.equal(b1 - ready(one.engine), 1);
  assert.equal(damageOf(one.engine, one.id("foe")), 1);
  assert.equal(damageOf(one.engine, one.id("mb")), 1);
  const four = ballistaBoard();
  const b4 = ready(four.engine);
  fire(four, "foe", 4);
  assert.equal(b4 - ready(four.engine), 4);
  assert.equal(damageOf(four.engine, four.id("foe")), 4);
  assert.equal(damageOf(four.engine, four.id("mb")), 4);
});

clause(BALLISTA, "1:ability:fire", "X = 0 is a whole number: pays nothing, still depletes the Ballista, and inflicts no damage at all", () => {
  const g = ballistaBoard();
  const before = ready(g.engine);
  fire(g, "foe", 0);
  assert.equal(ready(g.engine), before, "Pay 0");
  assert.equal(isDepleted(g.engine, g.id("mb")), true, "the deplete cost is still paid");
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(damageOf(g.engine, g.id("mb")), 0);
});

clause(BALLISTA, "1:ability:fire", "the damage is X, not the number of resources: with 6 ready resources and X = 3 only 3 are paid and 3 damage is inflicted", () => {
  const g = ballistaBoard({ rage: 6 });
  fire(g, "foe", 3);
  assert.equal(ready(g.engine), 3);
  assert.equal(damageOf(g.engine, g.id("foe")), 3);
});

clause(BALLISTA, "1:ability:fire", "it can pick a location: the opponent's location takes X damage, and the Ballista takes X", () => {
  const g = ballistaBoard();
  fire(g, "theirPlace", 3);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3);
  assert.equal(damageOf(g.engine, g.id("mb")), 3);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(BALLISTA, "1:ability:fire", "it can pick my own location or my own character too (it says 'a character or location')", () => {
  const loc = ballistaBoard();
  fire(loc, "myPlace", 2);
  assert.equal(damageOf(loc.engine, loc.id("myPlace")), 2);
  const chr = ballistaBoard();
  fire(chr, "ally", 2);
  assert.equal(damageOf(chr.engine, chr.id("ally")), 2);
  assert.equal(damageOf(chr.engine, chr.id("mb")), 2);
});

clause(BALLISTA, "1:ability:fire", "a destroyed target: X damage reaching a character's life destroys it, and a location's structure destroys it", () => {
  const chr = ballistaBoard({ life: 3 });
  fire(chr, "foe", 3);
  assert.equal(zoneOf(chr.engine, chr.id("foe")), "discard", "3 damage destroys a 3-life character");
  const spare = ballistaBoard({ life: 3 });
  fire(spare, "foe", 2);
  assert.equal(zoneOf(spare.engine, spare.id("foe")), "play", "2 damage does not");
  const loc = ballistaBoard({ extra: [{ key: "small", def: location({ name: "Small", structure: 2 }), owner: P2, zone: "play" }] });
  fire(loc, "small", 2);
  assert.equal(zoneOf(loc.engine, loc.id("small")), "discard", "2 damage destroys a structure-2 location");
});

clause(BALLISTA, "1:ability:fire", "the Ballista may pick itself (it is a location): it takes X + X damage", () => {
  const g = ballistaBoard();
  fire(g, "mb", 2);
  assert.equal(damageOf(g.engine, g.id("mb")), 4, "X for being the picked location and X for 'this card'");
  assert.equal(isDepleted(g.engine, g.id("mb")), true);
  assert.equal(ready(g.engine), 4);
});

clause(BALLISTA, "1:ability:fire", "the damage it deals to itself can destroy it: at 9 damage already, FIRE! with X = 1 destroys the Ballista (structure 10) and still hits the target", () => {
  const g = ballistaBoard({ damage: 9 });
  fire(g, "foe", 1);
  assert.equal(damageOf(g.engine, g.id("foe")), 1, "the target took its damage");
  assert.equal(zoneOf(g.engine, g.id("mb")), "discard", "10 damage destroys a structure-10 location");
});

clause(BALLISTA, "1:ability:fire", "its own damage is not enough to destroy it below structure 10: X = 9 from a fresh Ballista leaves it in play", () => {
  const g = ballistaBoard({ rage: 9, life: 20 });
  fire(g, "foe", 9);
  assert.equal(damageOf(g.engine, g.id("mb")), 9);
  assert.equal(zoneOf(g.engine, g.id("mb")), "play");
  assert.equal(damageOf(g.engine, g.id("foe")), 9);
});

clause(BALLISTA, "1:ability:fire", "location damage persists from turn to turn: a second FIRE! next turn adds to the Ballista's damage", () => {
  const g = ballistaBoard({ rage: 6 });
  fire(g, "foe", 2);
  assert.equal(damageOf(g.engine, g.id("mb")), 2);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(damageOf(g.engine, g.id("mb")), 2, "markers on a location persist");
  assert.equal(isDepleted(g.engine, g.id("mb")), false);
  fire(g, "foe", 1);
  assert.equal(damageOf(g.engine, g.id("mb")), 3);
});

for (const [key, label] of [
  ["thing", "an item"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a location card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(BALLISTA, "1:ability:fire", `cannot pick ${label}; a legal pick works on the same board and nothing is paid for the refusal`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: location({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = ballistaBoard({ extra });
    const before = ready(bad.engine);
    refused(() => fireRaw(bad, key, 1), `picking ${label}`);
    assert.equal(isDepleted(bad.engine, bad.id("mb")), false, "the Ballista was not depleted by the refused action");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    assert.equal(damageOf(bad.engine, bad.id("mb")), 0);
    const good = ballistaBoard({ extra });
    fire(good, "foe", 1);
    assert.equal(damageOf(good.engine, good.id("foe")), 1, "control: a character in play can be picked");
  });
}

clause(BALLISTA, "1:ability:fire", "cannot pick a faction (CR 202.9): neither the opponent's nor mine", () => {
  const theirs = ballistaBoard();
  refused(() => actRaw(theirs.engine, P1, theirs.id("mb"), "fire", { t: [factionOf(theirs.engine, P2)] }, { x: 2 }), "their faction");
  assert.equal(influenceOf(theirs.engine, P2), 30);
  assert.equal(isDepleted(theirs.engine, theirs.id("mb")), false);
  const mine = ballistaBoard();
  refused(() => actRaw(mine.engine, P1, mine.id("mb"), "fire", { t: [factionOf(mine.engine, P1)] }, { x: 2 }), "my faction");
  assert.equal(influenceOf(mine.engine, P1), 30);
});

clause(BALLISTA, "1:ability:fire", "exactly one pick: none and two are refused", () => {
  const none = ballistaBoard();
  refused(() => fireRaw(none, undefined, 1), "no pick");
  assert.equal(isDepleted(none.engine, none.id("mb")), false);
  const two = ballistaBoard();
  refused(() => actRaw(two.engine, P1, two.id("mb"), "fire", { t: [two.id("foe"), two.id("ally")] }, { x: 1 }), "two picks");
  assert.equal(isDepleted(two.engine, two.id("mb")), false);
  assert.equal(damageOf(two.engine, two.id("foe")), 0);
});

clause(BALLISTA, "1:ability:fire", "it needs X resources: X = 4 with 3 resources is refused with nothing paid or depleted", () => {
  const bad = ballistaBoard({ rage: 3 });
  refused(() => fireRaw(bad, "foe", 4), "paying 4 with 3 resources");
  assert.equal(isDepleted(bad.engine, bad.id("mb")), false);
  assert.equal(ready(bad.engine), 3);
  assert.equal(damageOf(bad.engine, bad.id("foe")), 0);
  const good = ballistaBoard({ rage: 4 });
  fire(good, "foe", 4);
  assert.equal(ready(good.engine), 0, "control: exactly X resources works");
});

clause(BALLISTA, "1:ability:fire", "spent (attached) resources cannot pay X", () => {
  const bad = ballistaBoard({ rage: 1, extra: spent("rage", 3) });
  assert.equal(ready(bad.engine), 1);
  refused(() => fireRaw(bad, "foe", 2), "only one ready resource");
  assert.equal(isDepleted(bad.engine, bad.id("mb")), false);
});

clause(BALLISTA, "1:ability:fire", "FIRE! has no threshold: it works with only Greed", () => {
  const g = ballistaBoard({ rage: 0, greed: 3 });
  fire(g, "foe", 2);
  assert.equal(damageOf(g.engine, g.id("foe")), 2);
  assert.equal(ready(g.engine), 1);
});

clause(BALLISTA, "1:ability:fire", "a depleted Ballista cannot be fired (the deplete cost cannot be paid): nothing is paid", () => {
  const bad = ballistaBoard({ depleted: true });
  const before = ready(bad.engine);
  refused(() => fireRaw(bad, "foe", 1), "FIRE! while depleted");
  assert.equal(ready(bad.engine), before);
  assert.equal(damageOf(bad.engine, bad.id("foe")), 0);
  assert.equal(damageOf(bad.engine, bad.id("mb")), 0);
  const good = ballistaBoard({ depleted: false });
  fire(good, "foe", 1);
  assert.equal(damageOf(good.engine, good.id("foe")), 1, "control: restored, it fires");
});

clause(BALLISTA, "1:ability:fire", "once depleted by FIRE! it cannot fire again the same turn", () => {
  const g = ballistaBoard({ rage: 8 });
  fire(g, "foe", 1);
  refused(() => fireRaw(g, "foe", 1), "a second FIRE! the same turn");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
  assert.equal(damageOf(g.engine, g.id("mb")), 1);
  assert.equal(ready(g.engine), 7);
});

clause(BALLISTA, "1:ability:fire", "X must be a whole number (CR 410.2): X = 1.5 is refused", () => {
  const g = ballistaBoard();
  refused(() => fireRaw(g, "foe", 1.5), "a fractional X");
  assert.equal(isDepleted(g.engine, g.id("mb")), false);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(ready(g.engine), 6);
});

clause(BALLISTA, "1:ability:fire", "X cannot be negative: X = -2 is refused (no damage, no gain of resources)", () => {
  const g = ballistaBoard();
  refused(() => fireRaw(g, "foe", -2), "a negative X");
  assert.equal(isDepleted(g.engine, g.id("mb")), false);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(damageOf(g.engine, g.id("mb")), 0);
});

clause(BALLISTA, "1:ability:fire", "only its controller can use FIRE!: the opponent cannot", () => {
  const g = ballistaBoard({ extra: bank("rage", 6, P2) });
  declareAttackOpenWindow(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(g.engine, P2, g.id("mb"), "fire", { t: [g.id("ally")] }, { x: 1 }), "the opponent using my Ballista", /control|own|cannot|illegal|only|activate/i);
  assert.equal(isDepleted(g.engine, g.id("mb")), false);
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
});

clause(BALLISTA, "1:ability:fire", "an ability, so it can be used in response during the opponent's turn", () => {
  const g = ballistaBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority");
  actRaw(g.engine, P1, g.id("mb"), "fire", { t: [g.id("foe")] }, { x: 2 });
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("foe")), 2);
  assert.equal(damageOf(g.engine, g.id("mb")), 2);
  assert.equal(isDepleted(g.engine, g.id("mb")), true);
});

clause(BALLISTA, "1:ability:fire", "it can only be used from play: a Ballista in my hand cannot fire", () => {
  const g = ballistaBoard({ zone: "hand" });
  refused(() => fireRaw(g, "foe", 1), "FIRE! from the hand");
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(BALLISTA, "1:ability:fire", "if the picked character is destroyed in response, the Ballista still takes its own X damage (CR 402.5)", () => {
  const g = ballistaBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  fireRaw(g, "foe", 2);
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("foe")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(damageOf(g.engine, g.id("mb")), 2, "'Inflict X damage to this card' still happens");
  assert.equal(isDepleted(g.engine, g.id("mb")), true, "the costs stay paid");
  assert.equal(ready(g.engine), 4, "X = 2 stays paid");
});

// =============================================================================
// Vanilla characters (no rules text): Nimble Conscript, Unstoppable Asskicker.
// Each plays for its printed cost and threshold, with its printed stats.
// =============================================================================

interface VanillaSpec {
  cost: number;
  rageIcons: number;
  strength: number;
  speed: number;
  life: number;
}

/** A board with the vanilla card in hand and `rage` Rage + `greed` Greed ready; `extra` and `game` are merged in. */
function vanBoard(id: string, rage: number, greed: number, extra: CardPlacement[] = [], game: Parameters<typeof buildGame>[0] = {}) {
  return devBoard([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1), ...extra], game);
}

function vanillaPrinted(id: string, spec: VanillaSpec): void {
  const def = printing(id);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.ok(def.subtype?.includes("soldier"), "a soldier");
  const g = vanBoard(id, spec.rageIcons, spec.cost - spec.rageIcons);
  playAndResolve(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(g.engine.getStat(g.id("c"), "strength"), spec.strength, "printed strength");
  assert.equal(g.engine.getStat(g.id("c"), "speed"), spec.speed, "printed speed");
  assert.equal(g.engine.getStat(g.id("c"), "life"), spec.life, "printed life");
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["character"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
}

function vanillaPays(id: string, spec: VanillaSpec): void {
  const g = vanBoard(id, spec.rageIcons, spec.cost - spec.rageIcons + 3);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(before - ready(g.engine), spec.cost, "pays exactly the printed cost, not more (3 spare resources stay ready)");
  assert.equal(ready(g.engine), 3);
}

function vanillaOneShort(id: string, spec: VanillaSpec): void {
  const short = vanBoard(id, spec.rageIcons, spec.cost - spec.rageIcons - 1);
  assert.equal(ready(short.engine), spec.cost - 1);
  refused(() => playRaw(short.engine, P1, short.id("c")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  assert.equal(ready(short.engine), spec.cost - 1, "nothing was paid");
  const exact = vanBoard(id, spec.rageIcons, spec.cost - spec.rageIcons);
  playAndResolve(exact.engine, P1, exact.id("c"));
  assert.equal(zoneOf(exact.engine, exact.id("c")), "play", "control: exactly the printed cost is enough");
  assert.equal(ready(exact.engine), 0);
}

function vanillaThreshold(id: string, spec: VanillaSpec): void {
  const fewer = spec.rageIcons - 1;
  const bad = vanBoard(id, fewer, spec.cost + 2 - fewer);
  assert.ok(ready(bad.engine) >= spec.cost, "setup: plenty of resources");
  refused(() => playRaw(bad.engine, P1, bad.id("c")), "one [R] short of the threshold");
  assert.equal(zoneOf(bad.engine, bad.id("c")), "hand");
  const none = vanBoard(id, 0, spec.cost + 2);
  refused(() => playRaw(none.engine, P1, none.id("c")), "no [R] at all");
  assert.equal(zoneOf(none.engine, none.id("c")), "hand");
  const good = vanBoard(id, spec.rageIcons, spec.cost + 2 - spec.rageIcons);
  playAndResolve(good.engine, P1, good.id("c"));
  assert.equal(zoneOf(good.engine, good.id("c")), "play", "control: [R][R] with the same number of resources works");
}

function vanillaNotVolition(id: string, spec: VanillaSpec): void {
  const g = vanBoard(id, 0, 0, volition(spec.cost + 2, P1));
  refused(() => playRaw(g.engine, P1, g.id("c")), "only face-down (Volition) resources");
  assert.equal(zoneOf(g.engine, g.id("c")), "hand");
  const theirs = vanBoard(id, 0, spec.cost + 2, bank("rage", 5, P2));
  refused(() => playRaw(theirs.engine, P1, theirs.id("c")), "the opponent's Rage is not my threshold");
  assert.equal(zoneOf(theirs.engine, theirs.id("c")), "hand");
}

function vanillaSpentIcons(id: string, spec: VanillaSpec): void {
  const g = vanBoard(id, 0, spec.cost, spent("rage", spec.rageIcons, P1));
  assert.equal(ready(g.engine), spec.cost, "the Rage is spent; only Greed is ready");
  playAndResolve(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "spent icons still meet the threshold (CR 405.6)");
  assert.equal(ready(g.engine), 0, "the printed cost was paid by the ready Greed");
}

function vanillaOwnTurnOnly(id: string, spec: VanillaSpec): void {
  const theirTurn = vanBoard(id, spec.rageIcons, spec.cost, [{ key: "atk", def: character({ name: "Their Attacker" }), owner: P2, zone: "play" }], { turn: 2, activePlayerId: P2 });
  refused(() => playRaw(theirTurn.engine, P1, theirTurn.id("c")), "on the opponent's turn with nothing to respond to");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("c")), "hand");
  declareAttackOpenWindow(theirTurn.engine, P2, [theirTurn.id("atk")]);
  assert.equal(theirTurn.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  refused(() => playRaw(theirTurn.engine, P1, theirTurn.id("c")), "a character is not a tactic: not even in response");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("c")), "hand");
  const mine = vanBoard(id, spec.rageIcons, spec.cost);
  playAndResolve(mine.engine, P1, mine.id("c"));
  assert.equal(zoneOf(mine.engine, mine.id("c")), "play", "control: my own turn works");
}

function vanillaNoText(id: string): void {
  const g = devBoard([{ key: "c", def: printing(id), owner: P1, zone: "play" }, ...bank("rage", 4, P1)]);
  assert.deepEqual(g.engine.getKeywords(g.id("c")), [], "no keywords");
  assert.deepEqual(g.engine.getRestrictions(g.id("c")), [], "no restrictions");
  assert.equal(
    g.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === g.id("c")).length,
    0,
    "no abilities"
  );
}

function vanillaFreshCannotAttack(id: string, spec: VanillaSpec): void {
  const g = vanBoard(id, spec.rageIcons, spec.cost - spec.rageIcons);
  playAndResolve(g.engine, P1, g.id("c"));
  refused(
    () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("c")], target: { type: "faction", playerId: P2 } }),
    "a character that just arrived cannot attack (CR 204.3)",
    /did not start the turn in play/
  );
  assert.equal(isDepleted(g.engine, g.id("c")), false);
}

function vanillaStrengthInBattle(id: string, spec: VanillaSpec): void {
  const unblocked = devBoard([{ key: "c", def: printing(id), owner: P1, zone: "play" }]);
  fight(unblocked, [unblocked.id("c")], undefined, []);
  assert.equal(influenceOf(unblocked.engine, P2), 30 - spec.strength, "unblocked it inflicts exactly its printed strength to the faction");

  const kills = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 0, life: spec.strength, speed: 0 }), owner: P2, zone: "play" }
  ]);
  fight(kills, [kills.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(kills.engine, kills.id("foe")), "discard", "strength damage equal to a blocker's life destroys it");
  const spares = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 0, life: spec.strength + 1, speed: 0 }), owner: P2, zone: "play" }
  ]);
  fight(spares, [spares.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(spares.engine, spares.id("foe")), "play", "one less than lethal leaves the blocker alive");
  assert.equal(damageOf(spares.engine, spares.id("foe")), spec.strength);
}

function vanillaLifeInBattle(id: string, spec: VanillaSpec): void {
  const dies = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: spec.life, life: 99, speed: 1 }), owner: P2, zone: "play" }
  ]);
  fight(dies, [dies.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(dies.engine, dies.id("c")), "discard", "damage equal to its life destroys it");
  const lives = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: spec.life - 1, life: 99, speed: 1 }), owner: P2, zone: "play" }
  ]);
  fight(lives, [lives.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(lives.engine, lives.id("c")), "play", "one less than lethal leaves it alive");
  assert.equal(damageOf(lives.engine, lives.id("c")), spec.life - 1);
}

function vanillaSpeedInBattle(id: string, spec: VanillaSpec): void {
  // A blocker with speed one higher strikes first and kills it before it deals damage; one lower strikes after.
  const slowerFoe = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 99, life: spec.strength, speed: spec.speed - 1 }), owner: P2, zone: "play" }
  ]);
  fight(slowerFoe, [slowerFoe.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(slowerFoe.engine, slowerFoe.id("foe")), "discard", "a slower blocker is destroyed before it strikes");
  assert.equal(damageOf(slowerFoe.engine, slowerFoe.id("c")), 0, "so it never deals its damage");
  const fasterFoe = devBoard([
    { key: "c", def: printing(id), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 99, life: 99, speed: spec.speed + 1 }), owner: P2, zone: "play" }
  ]);
  fight(fasterFoe, [fasterFoe.id("c")], undefined, ["foe"]);
  assert.equal(zoneOf(fasterFoe.engine, fasterFoe.id("c")), "discard", "a faster blocker destroys it first");
  assert.equal(damageOf(fasterFoe.engine, fasterFoe.id("foe")), 0, "so the vanilla character deals nothing");
}

/** The attacker attacks the opponent's faction (or `target`), the defender blocks with `blockerKeys`, and the battle resolves. */
function fight(game: Game, attackers: CardInstanceId[], target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId } | undefined, blockerKeys: string[]): void {
  declareAttackBy(game.engine, P1, attackers, target);
  declareBlockers(game.engine, P2, blockerKeys.map((key) => game.id(key)));
  autoResolveBattle(game.engine);
}

// --- Nimble Conscript ---------------------------------------------------------
// Character, cost 3, [R][R], 3 strength / 3 speed / 2 life. soldier. No rules text.

const NIMBLE = "1e3c2d25-0380-4d47-bd33-54b877476c3b";
const NIMBLE_SPEC: VanillaSpec = { cost: 3, rageIcons: 2, strength: 3, speed: 3, life: 2 };

clause(NIMBLE, "vanilla", "has its printed stats in play: 3 strength, 3 speed, 2 life; a warlord soldier character", () => vanillaPrinted(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "deploys for exactly its printed cost of 3: spare resources stay ready", () => vanillaPays(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "is refused one resource short (2 ready resources including [R][R]); exactly 3 works", () => vanillaOneShort(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "needs [R][R]: one Rage or none with plenty of other resources is refused", () => vanillaThreshold(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "face-down resources (Volition) and the opponent's Rage do not meet [R][R]", () => vanillaNotVolition(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "spent (attached) Rage still meets the threshold, while ready Greed pays the cost", () => vanillaSpentIcons(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "is deployed only on my own turn (a character is not a tactic): refused on the opponent's turn, even in response", () => vanillaOwnTurnOnly(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "has no keywords, restrictions or abilities", () => vanillaNoText(NIMBLE));
clause(NIMBLE, "vanilla", "a freshly deployed Nimble Conscript cannot attack that turn", () => vanillaFreshCannotAttack(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "its strength 3 is the battle damage it inflicts (to a faction, and enough/not enough to destroy a blocker)", () => vanillaStrengthInBattle(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "its life 2: 2 damage destroys it, 1 does not", () => vanillaLifeInBattle(NIMBLE, NIMBLE_SPEC));
clause(NIMBLE, "vanilla", "its speed 3 decides who strikes first against slower and faster blockers", () => vanillaSpeedInBattle(NIMBLE, NIMBLE_SPEC));

// --- Unstoppable Asskicker ----------------------------------------------------
// Character, cost 8, [R][R], 8 strength / 3 speed / 5 life. soldier. No rules text.

const KICKER = "8e20ec27-25c0-48f1-8b88-0e08d7bd9736";
const KICKER_SPEC: VanillaSpec = { cost: 8, rageIcons: 2, strength: 8, speed: 3, life: 5 };

clause(KICKER, "vanilla", "has its printed stats in play: 8 strength, 3 speed, 5 life; a warlord soldier character", () => vanillaPrinted(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "deploys for exactly its printed cost of 8: spare resources stay ready", () => vanillaPays(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "is refused one resource short (7 ready resources including [R][R]); exactly 8 works", () => vanillaOneShort(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "needs [R][R]: one Rage or none with plenty of other resources is refused", () => vanillaThreshold(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "face-down resources (Volition) and the opponent's Rage do not meet [R][R]", () => vanillaNotVolition(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "spent (attached) Rage still meets the threshold, while ready Greed pays the cost", () => vanillaSpentIcons(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "is deployed only on my own turn (a character is not a tactic): refused on the opponent's turn, even in response", () => vanillaOwnTurnOnly(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "has no keywords, restrictions or abilities", () => vanillaNoText(KICKER));
clause(KICKER, "vanilla", "a freshly deployed Unstoppable Asskicker cannot attack that turn", () => vanillaFreshCannotAttack(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "its strength 8 is the battle damage it inflicts (to a faction, and enough/not enough to destroy a blocker)", () => vanillaStrengthInBattle(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "its life 5: 5 damage destroys it, 4 does not", () => vanillaLifeInBattle(KICKER, KICKER_SPEC));
clause(KICKER, "vanilla", "its speed 3 decides who strikes first against slower and faster blockers", () => vanillaSpeedInBattle(KICKER, KICKER_SPEC));

// =============================================================================
// Noble Sacrifice
// COST: Pick a character you own. Pick a character your opponent owns.
// EFFECT: Destroy the characters. Draw a card.
// FLIP UP: 0 [R][R]
// Tactic, cost 2, [R][R].
// =============================================================================

const NOBLE = "f013f5ae-5301-4cd1-9504-b2e50f1e4a48";

function nobleBoard(
  opts: {
    rage?: number;
    greed?: number;
    zone?: "hand" | "play";
    faceDown?: boolean;
    deck?: number;
    extra?: CardPlacement[];
    game?: Parameters<typeof buildGame>[0];
  } = {}
) {
  const zone = opts.zone ?? "hand";
  return devBoard(
    [
      { key: "ns", def: printing(NOBLE), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      { key: "m0", def: character({ name: "Mine 0", life: 3 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine 1", life: 3 }), owner: P1, zone: "play" },
      { key: "o0", def: character({ name: "Theirs 0", life: 3 }), owner: P2, zone: "play" },
      { key: "o1", def: character({ name: "Theirs 1", life: 3 }), owner: P2, zone: "play" },
      // owned by me, controlled by the opponent
      { key: "myStolen", def: character({ name: "My Stolen", life: 3 }), owner: P1, controller: P2, zone: "play" },
      // owned by the opponent, controlled by me
      { key: "theirCaptured", def: character({ name: "Their Captured", life: 3 }), owner: P2, controller: P1, zone: "play" },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

/** Raw Noble Sacrifice play picking `mine` and `theirs` (placement keys; undefined = no pick for that slot). */
function nsRaw(game: Game, mine: string | undefined, theirs: string | undefined, player: PlayerId = P1): void {
  playRaw(game.engine, player, game.id("ns"), {
    selected: { mine: mine === undefined ? [] : [game.id(mine)], theirs: theirs === undefined ? [] : [game.id(theirs)] }
  });
}

function nsPlay(game: Game, mine: string, theirs: string): void {
  nsRaw(game, mine, theirs);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
}

function nsFlip(game: Game, mine: string | undefined, theirs: string | undefined, player: PlayerId = P1): void {
  flipUpRaw(game.engine, player, game.id("ns"), {
    mine: mine === undefined ? [] : [game.id(mine)],
    theirs: theirs === undefined ? [] : [game.id(theirs)]
  });
}

clause(NOBLE, "0:ability", "destroys both picked characters (mine and theirs), each into its owner's discard pile, and the other characters stay", () => {
  const g = nobleBoard();
  nsPlay(g, "m0", "o0");
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "the character I own is destroyed");
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard", "the character the opponent owns is destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("m0")), "discardOf(g.engine, P1).includes(g.id(\"m0\"))");
  assert.ok(discardOf(g.engine, P2).includes(g.id("o0")), "discardOf(g.engine, P2).includes(g.id(\"o0\"))");
  for (const key of ["m1", "o1", "myStolen", "theirCaptured"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} is untouched`);
});

clause(NOBLE, "0:ability", "draws exactly one card (the top of my deck), and the opponent draws nothing", () => {
  const g = nobleBoard();
  const top = deckOf(g.engine, P1)[0];
  const deckBefore = deckOf(g.engine, P1).length;
  const theirHand = handOf(g.engine, P2).length;
  const theirDeck = deckOf(g.engine, P2).length;
  nsPlay(g, "m0", "o0");
  assert.ok(handOf(g.engine, P1).includes(top), "the top card of my deck is in my hand");
  assert.equal(deckOf(g.engine, P1).length, deckBefore - 1, "exactly one card was drawn");
  assert.equal(handOf(g.engine, P1).length, 1, "the only card in my hand is the one I drew (Noble Sacrifice was played)");
  assert.equal(handOf(g.engine, P2).length, theirHand);
  assert.equal(deckOf(g.engine, P2).length, theirDeck);
});

clause(NOBLE, "0:ability", "it is a tactic: it goes to my discard pile after resolving", () => {
  const g = nobleBoard();
  nsPlay(g, "m0", "o0");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ns")), "discardOf(g.engine, P1).includes(g.id(\"ns\"))");
});

clause(NOBLE, "0:ability", "the card's own cost of 2 is paid and nothing more: 4 resources leave 2 ready", () => {
  const g = nobleBoard({ rage: 4 });
  const before = ready(g.engine);
  nsPlay(g, "m0", "o0");
  assert.equal(before - ready(g.engine), 2);
});

clause(NOBLE, "0:ability", "the cost is paid when played, before responses: 2 resources are spent while the opponent can still respond", () => {
  const g = nobleBoard({ rage: 4 });
  const before = ready(g.engine);
  nsRaw(g, "m0", "o0");
  assert.equal(before - ready(g.engine), 2, "paid at once");
  assert.equal(zoneOf(g.engine, g.id("m0")), "play", "the picks are only destroyed when the tactic resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
});

clause(NOBLE, "0:ability", "needs [R][R]: one Rage with plenty of other resources is refused, as are no Rage; [R][R] works", () => {
  const one = nobleBoard({ rage: 1, greed: 5 });
  refused(() => nsRaw(one, "m0", "o0"), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("ns")), "hand");
  assert.equal(zoneOf(one.engine, one.id("m0")), "play");
  const none = nobleBoard({ rage: 0, greed: 6 });
  refused(() => nsRaw(none, "m0", "o0"), "no [R]");
  const good = nobleBoard({ rage: 2, greed: 0 });
  nsPlay(good, "m0", "o0");
  assert.equal(zoneOf(good.engine, good.id("m0")), "discard", "control: [R][R] and 2 resources work");
});

clause(NOBLE, "0:ability", "is refused one resource short of its cost 2 even with the threshold met by spent Rage", () => {
  const bad = nobleBoard({ rage: 0, greed: 1, extra: spent("rage", 2) });
  assert.equal(ready(bad.engine), 1);
  refused(() => nsRaw(bad, "m0", "o0"), "one ready resource for a cost of 2");
  assert.equal(zoneOf(bad.engine, bad.id("ns")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("m0")), "play");
});

clause(NOBLE, "0:ability", "face-down resources (Volition) and the opponent's Rage do not meet [R][R]", () => {
  const faceDown = nobleBoard({ rage: 0, extra: volition(5, P1) });
  refused(() => nsRaw(faceDown, "m0", "o0"), "only Volition");
  const theirs = nobleBoard({ rage: 0, greed: 4, extra: bank("rage", 4, P2) });
  refused(() => nsRaw(theirs, "m0", "o0"), "their [R]");
});

clause(NOBLE, "0:ability", "'a character you own': a character I own but my opponent controls can be picked, and goes to MY discard pile", () => {
  const g = nobleBoard();
  nsPlay(g, "myStolen", "o0");
  assert.equal(zoneOf(g.engine, g.id("myStolen")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("myStolen")), "its owner's discard pile");
  assert.equal(discardOf(g.engine, P2).includes(g.id("myStolen")), false);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
});

clause(NOBLE, "0:ability", "'a character you own' is not 'a character you control': a character the opponent owns but I control cannot fill my slot", () => {
  const bad = nobleBoard();
  refused(() => nsRaw(bad, "theirCaptured", "o0"), "a character I control but do not own, as the one I own");
  assert.equal(zoneOf(bad.engine, bad.id("ns")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("theirCaptured")), "play");
  const good = nobleBoard();
  nsPlay(good, "m0", "o0");
  assert.equal(zoneOf(good.engine, good.id("m0")), "discard", "control: a character I own works");
});

clause(NOBLE, "0:ability", "'a character your opponent owns': a character they own but I control can be picked, and goes to THEIR discard pile", () => {
  const g = nobleBoard();
  nsPlay(g, "m0", "theirCaptured");
  assert.equal(zoneOf(g.engine, g.id("theirCaptured")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirCaptured")), "its owner's discard pile");
  assert.equal(discardOf(g.engine, P1).includes(g.id("theirCaptured")), false);
});

clause(NOBLE, "0:ability", "'a character your opponent owns' is not 'one they control': a character I own that they control cannot fill their slot", () => {
  const bad = nobleBoard();
  refused(() => nsRaw(bad, "m0", "myStolen"), "a character they control but do not own, as the one they own");
  assert.equal(zoneOf(bad.engine, bad.id("ns")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("myStolen")), "play");
});

clause(NOBLE, "0:ability", "both picks are needed: only mine, only theirs, or neither is refused", () => {
  const onlyMine = nobleBoard();
  refused(() => nsRaw(onlyMine, "m0", undefined), "only the character I own");
  assert.equal(zoneOf(onlyMine.engine, onlyMine.id("ns")), "hand");
  assert.equal(zoneOf(onlyMine.engine, onlyMine.id("m0")), "play");
  const onlyTheirs = nobleBoard();
  refused(() => nsRaw(onlyTheirs, undefined, "o0"), "only the character they own");
  assert.equal(zoneOf(onlyTheirs.engine, onlyTheirs.id("o0")), "play");
  const neither = nobleBoard();
  refused(() => nsRaw(neither, undefined, undefined), "no pick");
  assert.equal(ready(neither.engine), 4, "nothing was paid");
});

clause(NOBLE, "0:ability", "exactly one of each: two of mine, or two of theirs, is refused", () => {
  const twoMine = nobleBoard();
  refused(
    () => playRaw(twoMine.engine, P1, twoMine.id("ns"), { selected: { mine: [twoMine.id("m0"), twoMine.id("m1")], theirs: [twoMine.id("o0")] } }),
    "two characters I own"
  );
  assert.equal(zoneOf(twoMine.engine, twoMine.id("m0")), "play");
  assert.equal(zoneOf(twoMine.engine, twoMine.id("m1")), "play");
  const twoTheirs = nobleBoard();
  refused(
    () => playRaw(twoTheirs.engine, P1, twoTheirs.id("ns"), { selected: { mine: [twoTheirs.id("m0")], theirs: [twoTheirs.id("o0"), twoTheirs.id("o1")] } }),
    "two characters they own"
  );
  assert.equal(zoneOf(twoTheirs.engine, twoTheirs.id("o0")), "play");
  assert.equal(zoneOf(twoTheirs.engine, twoTheirs.id("o1")), "play");
});

clause(NOBLE, "0:ability", "a character I own cannot be offered as the opponent's, nor theirs as mine (the two picks are swapped)", () => {
  const swapped = nobleBoard();
  refused(() => nsRaw(swapped, "o0", "m0"), "swapped picks");
  assert.equal(zoneOf(swapped.engine, swapped.id("o0")), "play");
  assert.equal(zoneOf(swapped.engine, swapped.id("m0")), "play");
});

for (const slot of ["mine", "theirs"] as const) {
  const side = slot === "mine" ? P1 : P2;
  for (const [key, label] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["res", "a resource"],
    ["fd", "a face-down card (only a resource, CR 411.1)"],
    ["inHand", "a character card in a hand (CR 402.3)"],
    ["inDiscard", "a character card in a discard pile (CR 402.3)"]
  ] as const) {
    clause(NOBLE, "0:ability", `cannot pick ${label} as the character ${slot === "mine" ? "I own" : "my opponent owns"}; legal picks work on the same board`, () => {
      const extra: CardPlacement[] = [
        { key: "thing", def: item({ name: "Thing" }), owner: side, zone: "play" },
        { key: "place", def: location({ name: "Place" }), owner: side, zone: "play" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: side, zone: "play" },
        { key: "fd", def: character({ name: "Face Down" }), owner: side, zone: "play", faceDown: true },
        { key: "inHand", def: character({ name: "In Hand" }), owner: side, zone: "hand" },
        { key: "inDiscard", def: character({ name: "In Discard" }), owner: side, zone: "discard" }
      ];
      const bad = nobleBoard({ extra });
      const before = ready(bad.engine);
      refused(() => (slot === "mine" ? nsRaw(bad, key, "o0") : nsRaw(bad, "m0", key)), `picking ${label}`);
      assert.equal(zoneOf(bad.engine, bad.id("ns")), "hand");
      assert.equal(ready(bad.engine), before, "nothing was paid");
      const good = nobleBoard({ extra });
      nsPlay(good, "m0", "o0");
      assert.equal(zoneOf(good.engine, good.id("o0")), "discard", "control: character picks work");
    });
  }
}

clause(NOBLE, "0:ability", "cannot pick a faction as either character (CR 202.9)", () => {
  const mine = nobleBoard();
  refused(() => playRaw(mine.engine, P1, mine.id("ns"), { selected: { mine: [factionOf(mine.engine, P1)], theirs: [mine.id("o0")] } }), "my faction as the character I own");
  const theirs = nobleBoard();
  refused(() => playRaw(theirs.engine, P1, theirs.id("ns"), { selected: { mine: [theirs.id("m0")], theirs: [factionOf(theirs.engine, P2)] } }), "their faction");
  assert.equal(influenceOf(theirs.engine, P2), 30);
  assert.equal(zoneOf(theirs.engine, theirs.id("ns")), "hand");
});

clause(NOBLE, "0:ability", "if the character I picked is destroyed in response, the other is still destroyed and I still draw (CR 402.5)", () => {
  const g = nobleBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  nsRaw(g, "m0", "o0");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("m0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard", "the surviving pick is still destroyed");
  assert.ok(handOf(g.engine, P1).includes(top), "and the card is still drawn");
});

clause(NOBLE, "0:ability", "if the opponent's character is destroyed in response, mine is still destroyed and I still draw", () => {
  const g = nobleBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  nsRaw(g, "m0", "o0");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("o0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "the surviving pick is still destroyed");
  assert.ok(handOf(g.engine, P1).includes(top), "handOf(g.engine, P1).includes(top)");
});

clause(NOBLE, "0:ability", "if both picks left play in response I still draw a card (the draw does not depend on the destruction)", () => {
  const g = nobleBoard({ extra: [{ key: "kill2", def: killTwoTactic(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  nsRaw(g, "m0", "o0");
  playRaw(g.engine, P2, g.id("kill2"), { selected: { t: [g.id("m0"), g.id("o0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard", "Noble Sacrifice still resolved");
  assert.ok(handOf(g.engine, P1).includes(top), "and the card is still drawn");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play", "nothing else was destroyed");
});

clause(NOBLE, "0:ability", "with an empty deck nothing is drawn and the game goes on (CR 102.1a)", () => {
  const g = nobleBoard({ deck: 0 });
  assert.equal(deckOf(g.engine, P1).length, 0);
  nsPlay(g, "m0", "o0");
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(handOf(g.engine, P1).length, 0, "nothing to draw");
  assert.equal(g.engine.state.result, undefined, "no one lost");
});

clause(NOBLE, "0:ability", "an opponent can cast their own: the caster's own characters are 'mine' and the draw is the caster's", () => {
  const g = devBoard(
    [
      { key: "ns", def: printing(NOBLE), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Caster's Own", life: 3 }), owner: P2, zone: "play" },
      { key: "theirs", def: character({ name: "Victim", life: 3 }), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", 4, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  const topP2 = deckOf(g.engine, P2)[0];
  const handP1 = handOf(g.engine, P1).length;
  playAndResolve(g.engine, P2, g.id("ns"), { selected: { mine: [g.id("mine")], theirs: [g.id("theirs")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.ok(handOf(g.engine, P2).includes(topP2), "the caster draws");
  assert.equal(handOf(g.engine, P1).length, handP1, "the other player does not");
});

clause(NOBLE, "0:ability", "a tactic: it can be played in response during the opponent's attack", () => {
  const g = nobleBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  const top = deckOf(g.engine, P1)[0];
  nsRaw(g, "m0", "o1");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o1")), "discard");
  assert.ok(handOf(g.engine, P1).includes(top), "handOf(g.engine, P1).includes(top)");
});

// FLIP UP: 0 [R][R]

clause(NOBLE, "1:flipUp", "a face-down Noble Sacrifice flips up for 0: no resources are paid (not its printed cost 2), then it destroys both picks, draws a card and goes to my discard pile", () => {
  const g = nobleBoard({ zone: "play", rage: 2 });
  const top = deckOf(g.engine, P1)[0];
  assert.equal(ready(g.engine), 3, "2 Rage and the face-down Noble Sacrifice itself");
  nsFlip(g, "m0", "o0");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.ok(handOf(g.engine, P1).includes(top), "drew the top card");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.equal(ready(g.engine), 2, "no cost was paid: both Rage are still ready (only the face-down card stopped being a resource)");
});

clause(NOBLE, "1:flipUp", "FLIP UP needs [R][R]: one Rage (with plenty of other resources) or none is refused, [R][R] works", () => {
  const one = nobleBoard({ zone: "play", rage: 1, greed: 5 });
  refused(() => nsFlip(one, "m0", "o0"), "one [R]");
  assert.equal(isFaceDown(one.engine, one.id("ns")), true, "still face-down");
  assert.equal(zoneOf(one.engine, one.id("m0")), "play");
  assert.equal(ready(one.engine), 7, "nothing was paid");
  const none = nobleBoard({ zone: "play", rage: 0, greed: 6 });
  refused(() => nsFlip(none, "m0", "o0"), "no [R]");
  const good = nobleBoard({ zone: "play", rage: 2 });
  nsFlip(good, "m0", "o0");
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("o0")), "discard", "control: [R][R] works");
});

clause(NOBLE, "1:flipUp", "its own face-down Volition is not [R], and the opponent's Rage does not count", () => {
  const faceDownOnly = nobleBoard({ zone: "play", rage: 0 });
  refused(() => nsFlip(faceDownOnly, "m0", "o0"), "Volition only");
  assert.equal(isFaceDown(faceDownOnly.engine, faceDownOnly.id("ns")), true);
  const theirs = nobleBoard({ zone: "play", rage: 1, extra: bank("rage", 4, P2) });
  refused(() => nsFlip(theirs, "m0", "o0"), "their [R] does not meet mine");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ns")), true);
});

clause(NOBLE, "1:flipUp", "spent (attached) Rage still meets the FLIP UP threshold (icons are never spent)", () => {
  const g = nobleBoard({ zone: "play", rage: 0, extra: spent("rage", 2) });
  nsFlip(g, "m0", "o0");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
});

clause(NOBLE, "1:flipUp", "flipping up still needs both picks: missing either one, or a swapped pair, is refused", () => {
  const onlyMine = nobleBoard({ zone: "play" });
  refused(() => nsFlip(onlyMine, "m0", undefined), "only the character I own");
  assert.equal(isFaceDown(onlyMine.engine, onlyMine.id("ns")), true);
  const onlyTheirs = nobleBoard({ zone: "play" });
  refused(() => nsFlip(onlyTheirs, undefined, "o0"), "only the character they own");
  const swapped = nobleBoard({ zone: "play" });
  refused(() => nsFlip(swapped, "o0", "m0"), "swapped");
  assert.equal(isFaceDown(swapped.engine, swapped.id("ns")), true);
  const stolen = nobleBoard({ zone: "play" });
  refused(() => nsFlip(stolen, "theirCaptured", "o0"), "a character I merely control, as the one I own");
});

clause(NOBLE, "1:flipUp", "FLIP UP does not change WHEN a tactic can be played: in response to the opponent's attack I can flip it up", () => {
  const g = nobleBoard({ zone: "play", rage: 2, game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  nsFlip(g, "m0", "o1");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard");
});

clause(NOBLE, "1:flipUp", "it works only on a face-down copy I control in play: not face-up, not in my hand, and not the opponent's", () => {
  const faceUp = nobleBoard({ zone: "play", faceDown: false, rage: 2 });
  refused(() => nsFlip(faceUp, "m0", "o0"), "already face-up");
  const inHand = nobleBoard({ zone: "hand", rage: 2 });
  refused(() => nsFlip(inHand, "m0", "o0"), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("ns")), "hand");
  const theirs = nobleBoard({ zone: "play", rage: 2 });
  refused(() => nsFlip(theirs, "m0", "o0", P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ns")), true);
});

clause(NOBLE, "1:flipUp", "FLIP UP is an alternative way to play it: from the hand Noble Sacrifice costs its printed 2; with 1 ready resource that is refused, but the flip-up costs 0", () => {
  const hand = nobleBoard({ zone: "hand", rage: 1, extra: spent("rage", 1) });
  assert.equal(ready(hand.engine), 1);
  refused(() => nsRaw(hand, "m0", "o0"), "cost 2 with one ready resource");
  const flip = nobleBoard({ zone: "play", rage: 0, extra: spent("rage", 2) });
  nsFlip(flip, "m0", "o0");
  resolvePendingResponses(flip.engine);
  assert.equal(zoneOf(flip.engine, flip.id("o0")), "discard", "the flip-up needed no ready resource at all");
});

// =============================================================================
// Perforate
// COST: Choose a number for X. Pay X. Pick a character.
// EFFECT: Inflict X damage to the character.
// Tactic, cost 2, [R][R].
// =============================================================================

const PERFORATE = "3b0d80d3-3d79-4f84-81db-a805584534fb";

function perfBoard(opts: { rage?: number; greed?: number; life?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}) {
  const life = opts.life ?? 9;
  return devBoard(
    [
      { key: "pf", def: printing(PERFORATE), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "Mine 0", life }), owner: P1, zone: "play" },
      { key: "o0", def: character({ name: "Theirs 0", life }), owner: P2, zone: "play" },
      { key: "o1", def: character({ name: "Theirs 1", life }), owner: P2, zone: "play" },
      { key: "myStolen", def: character({ name: "My Stolen", life }), owner: P1, controller: P2, zone: "play" },
      { key: "theirCaptured", def: character({ name: "Their Captured", life }), owner: P2, controller: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

function pfRaw(game: Game, target: string | undefined, x: number, player: PlayerId = P1): void {
  playRaw(game.engine, player, game.id("pf"), { selected: { c: target === undefined ? [] : [game.id(target)] }, variables: { x } });
}

function pfPlay(game: Game, target: string, x: number): void {
  pfRaw(game, target, x);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
}

clause(PERFORATE, "0:ability", "inflicts X damage to the picked character: X = 3 inflicts exactly 3", () => {
  const g = perfBoard();
  pfPlay(g, "o0", 3);
  assert.equal(damageOf(g.engine, g.id("o0")), 3);
  assert.equal(damageOf(g.engine, g.id("o1")), 0, "another character is untouched");
  assert.equal(damageOf(g.engine, g.id("m0")), 0, "my character is untouched");
});

clause(PERFORATE, "0:ability", "the damage is X, whatever X is: X = 1 inflicts 1 and X = 5 inflicts 5", () => {
  const one = perfBoard();
  pfPlay(one, "o0", 1);
  assert.equal(damageOf(one.engine, one.id("o0")), 1);
  const five = perfBoard();
  pfPlay(five, "o0", 5);
  assert.equal(damageOf(five.engine, five.id("o0")), 5);
});

clause(PERFORATE, "0:ability", "X = 0 is legal (CR 410.2a): it costs only the card's own 2 and inflicts no damage", () => {
  const g = perfBoard();
  const before = ready(g.engine);
  pfPlay(g, "o0", 0);
  assert.equal(before - ready(g.engine), 2, "just the printed cost of 2");
  assert.equal(damageOf(g.engine, g.id("o0")), 0);
  assert.equal(zoneOf(g.engine, g.id("pf")), "discard", "the tactic still resolved");
});

clause(PERFORATE, "0:ability", "X = 0 inflicts nothing at all, so nothing that triggers off damage happens (CR 408.1a)", () => {
  const watcher = (): CardDefinition =>
    character({
      name: "Damage Watcher",
      life: 9,
      behavior: { abilities: [{ id: "watch", type: "triggered", event: "damageDealt", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
  const zero = perfBoard({ extra: [{ key: "w", def: watcher(), owner: P1, zone: "play" }, ...fillers("d", 3, P1, "deck")] });
  pfPlay(zero, "o0", 0);
  assert.equal(handOf(zero.engine, P1).length, 0, "0 damage fired no damage trigger");
  const one = perfBoard({ extra: [{ key: "w", def: watcher(), owner: P1, zone: "play" }, ...fillers("d", 3, P1, "deck")] });
  pfPlay(one, "o0", 1);
  assert.equal(handOf(one.engine, P1).length, 1, "control: 1 damage fires the trigger");
});

clause(PERFORATE, "0:ability", "pays the card's cost 2 PLUS X (CR 406.3): X = 3 spends 5 resources", () => {
  const g = perfBoard({ rage: 8 });
  const before = ready(g.engine);
  pfRaw(g, "o0", 3);
  assert.equal(before - ready(g.engine), 5, "2 for the tactic + X = 3");
});

clause(PERFORATE, "0:ability", "X = 1 spends 3 and X = 2 spends 4", () => {
  const one = perfBoard({ rage: 8 });
  const b1 = ready(one.engine);
  pfRaw(one, "o0", 1);
  assert.equal(b1 - ready(one.engine), 3);
  const two = perfBoard({ rage: 8 });
  const b2 = ready(two.engine);
  pfRaw(two, "o0", 2);
  assert.equal(b2 - ready(two.engine), 4);
});

clause(PERFORATE, "0:ability", "the cost is paid when played, before responses, while the damage waits for resolution", () => {
  const g = perfBoard({ rage: 8 });
  const before = ready(g.engine);
  pfRaw(g, "o0", 2);
  assert.equal(before - ready(g.engine), 4, "paid at once");
  assert.equal(damageOf(g.engine, g.id("o0")), 0, "no damage yet");
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
});

clause(PERFORATE, "0:ability", "is refused one resource short of 2 + X: X = 3 with 4 resources, but X = 2 with 4 resources works", () => {
  const bad = perfBoard({ rage: 4 });
  refused(() => pfRaw(bad, "o0", 3), "paying 5 with 4 resources");
  assert.equal(zoneOf(bad.engine, bad.id("pf")), "hand");
  assert.equal(ready(bad.engine), 4, "nothing was paid");
  const good = perfBoard({ rage: 4 });
  pfPlay(good, "o0", 2);
  assert.equal(damageOf(good.engine, good.id("o0")), 2);
  assert.equal(ready(good.engine), 0);
});

clause(PERFORATE, "0:ability", "even X = 0 needs the card's own 2 resources: one resource is refused", () => {
  const bad = perfBoard({ rage: 1 });
  refused(() => pfRaw(bad, "o0", 0), "cost 2 with 1 resource");
  assert.equal(zoneOf(bad.engine, bad.id("pf")), "hand");
});

clause(PERFORATE, "0:ability", "spent (attached) resources cannot pay: 3 ready resources cannot pay X = 2 (total 4)", () => {
  const bad = perfBoard({ rage: 3, extra: spent("rage", 2) });
  assert.equal(ready(bad.engine), 3);
  refused(() => pfRaw(bad, "o0", 2), "4 needed, 3 ready");
  assert.equal(zoneOf(bad.engine, bad.id("pf")), "hand");
});

clause(PERFORATE, "0:ability", "needs [R][R]: one Rage with plenty of other resources, or none, is refused; [R][R] works", () => {
  const one = perfBoard({ rage: 1, greed: 8 });
  refused(() => pfRaw(one, "o0", 1), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("pf")), "hand");
  const none = perfBoard({ rage: 0, greed: 8 });
  refused(() => pfRaw(none, "o0", 1), "no [R]");
  const good = perfBoard({ rage: 2, greed: 6 });
  pfPlay(good, "o0", 1);
  assert.equal(damageOf(good.engine, good.id("o0")), 1, "control: [R][R] works");
});

clause(PERFORATE, "0:ability", "face-down resources (Volition) and the opponent's Rage do not meet [R][R]", () => {
  const faceDown = perfBoard({ rage: 0, extra: volition(8, P1) });
  refused(() => pfRaw(faceDown, "o0", 1), "only Volition");
  const theirs = perfBoard({ rage: 0, greed: 8, extra: bank("rage", 4, P2) });
  refused(() => pfRaw(theirs, "o0", 1), "their [R]");
});

clause(PERFORATE, "0:ability", "spent Rage still meets [R][R] while other resources pay", () => {
  const g = perfBoard({ rage: 0, greed: 4, extra: spent("rage", 2) });
  pfPlay(g, "o0", 2);
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
  assert.equal(ready(g.engine), 0);
});

clause(PERFORATE, "0:ability", "'a character': any character in play can be picked: mine, the opponent's, one I own but they control, one they own but I control", () => {
  for (const key of ["m0", "o0", "myStolen", "theirCaptured"]) {
    const g = perfBoard();
    pfPlay(g, key, 2);
    assert.equal(damageOf(g.engine, g.id(key)), 2, `${key} took 2`);
    for (const other of ["m0", "o0", "o1", "myStolen", "theirCaptured"].filter((k) => k !== key)) {
      assert.equal(damageOf(g.engine, g.id(other)), 0, `${other} is untouched`);
    }
  }
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(PERFORATE, "0:ability", `cannot pick ${label}; a character pick works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = perfBoard({ extra });
    const before = ready(bad.engine);
    refused(() => pfRaw(bad, key, 1), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("pf")), "hand");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = perfBoard({ extra });
    pfPlay(good, "o0", 1);
    assert.equal(damageOf(good.engine, good.id("o0")), 1, "control: a character in play can be picked");
  });
}

clause(PERFORATE, "0:ability", "cannot pick a faction (CR 202.9): the faction loses no influence", () => {
  const theirs = perfBoard();
  refused(() => playRaw(theirs.engine, P1, theirs.id("pf"), { selected: { c: [factionOf(theirs.engine, P2)] }, variables: { x: 2 } }), "their faction");
  assert.equal(influenceOf(theirs.engine, P2), 30);
  assert.equal(zoneOf(theirs.engine, theirs.id("pf")), "hand");
  const mine = perfBoard();
  refused(() => playRaw(mine.engine, P1, mine.id("pf"), { selected: { c: [factionOf(mine.engine, P1)] }, variables: { x: 2 } }), "my faction");
  assert.equal(influenceOf(mine.engine, P1), 30);
});

clause(PERFORATE, "0:ability", "exactly one character: none or two are refused", () => {
  const none = perfBoard();
  refused(() => pfRaw(none, undefined, 1), "no pick");
  assert.equal(zoneOf(none.engine, none.id("pf")), "hand");
  const two = perfBoard();
  refused(() => playRaw(two.engine, P1, two.id("pf"), { selected: { c: [two.id("o0"), two.id("o1")] }, variables: { x: 1 } }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("pf")), "hand");
  assert.equal(damageOf(two.engine, two.id("o0")), 0);
});

clause(PERFORATE, "0:ability", "damage reaching the character's life destroys it; one less does not", () => {
  const lethal = perfBoard({ life: 3 });
  pfPlay(lethal, "o0", 3);
  assert.equal(zoneOf(lethal.engine, lethal.id("o0")), "discard");
  const spare = perfBoard({ life: 3 });
  pfPlay(spare, "o0", 2);
  assert.equal(zoneOf(spare.engine, spare.id("o0")), "play");
  assert.equal(damageOf(spare.engine, spare.id("o0")), 2);
});

clause(PERFORATE, "0:ability", "the damage adds to damage the character already took this turn", () => {
  const g = perfBoard({ life: 5, extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("o0")] } });
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
  pfPlay(g, "o0", 2);
  assert.equal(damageOf(g.engine, g.id("o0")), 4);
  assert.equal(zoneOf(g.engine, g.id("o0")), "play");
});

clause(PERFORATE, "0:ability", "Perforate goes to its owner's discard pile once resolved", () => {
  const g = perfBoard();
  pfPlay(g, "o0", 1);
  assert.equal(zoneOf(g.engine, g.id("pf")), "discard");
});

clause(PERFORATE, "0:ability", "if the picked character is destroyed in response, the damage is lost, nothing else is hurt and the cost stays paid (CR 402.5a)", () => {
  const g = perfBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  pfRaw(g, "o0", 3);
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("o0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(damageOf(g.engine, g.id("o1")), 0);
  assert.equal(damageOf(g.engine, g.id("m0")), 0);
  assert.equal(before - ready(g.engine), 5, "the cost stays paid");
  assert.equal(zoneOf(g.engine, g.id("pf")), "discard");
});

clause(PERFORATE, "0:ability", "X must be a whole number (CR 410.2): X = 1.5 is refused with nothing paid", () => {
  const g = perfBoard();
  refused(() => pfRaw(g, "o0", 1.5), "a fractional X");
  assert.equal(zoneOf(g.engine, g.id("pf")), "hand");
  assert.equal(ready(g.engine), 8, "nothing was paid");
  assert.equal(damageOf(g.engine, g.id("o0")), 0);
});

clause(PERFORATE, "0:ability", "X cannot be negative: X = -1 is refused (it must not heal or refund)", () => {
  const g = perfBoard({ extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("o0")] } });
  const before = ready(g.engine);
  refused(() => pfRaw(g, "o0", -1), "a negative X");
  assert.equal(zoneOf(g.engine, g.id("pf")), "hand");
  assert.equal(ready(g.engine), before);
  assert.equal(damageOf(g.engine, g.id("o0")), 2, "no damage was healed");
});

clause(PERFORATE, "0:ability", "a tactic: it can be played in response during the opponent's attack", () => {
  const g = perfBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  pfRaw(g, "o0", 3);
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("o0")), 3);
});

clause(PERFORATE, "0:ability", "the opponent can cast it too: the damage is theirs to choose and they pay (symmetry)", () => {
  const g = devBoard(
    [
      { key: "pf", def: printing(PERFORATE), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      ...bank("rage", 5, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  playRaw(g.engine, P2, g.id("pf"), { selected: { c: [g.id("mine")] }, variables: { x: 3 } });
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 3);
  assert.equal(ready(g.engine, P2), 0, "they paid 5");
  assert.equal(ready(g.engine, P1), 0);
});

// =============================================================================
// Phalludrix, the Impotenator
// UNIQUE PHALLUDRIX
// If an effect controlled by your opponent causes you to discard any number of
// cards, you may put them back into your hand.
// EQUIP -- COST: Pick a character. If it is an "adriel" card then X is 0,
// otherwise X is 3. Pay X. -- EFFECT: Attach this card to the character.
// The attached character gains 2 strength.
// At the start of your opponent's turn, you may restore the attached character.
// Item, cost 1, [R].
// =============================================================================

const PHAL = "b0ad296c-f76a-4df7-be3a-639662c664b5";

function phalBoard(
  opts: {
    zone?: "play" | "hand";
    attached?: boolean;
    faceDown?: boolean;
    rage?: number;
    greed?: number;
    hand?: number;
    deck?: number;
    hostDepleted?: boolean;
    extra?: CardPlacement[];
    game?: Parameters<typeof buildGame>[0];
  } = {}
) {
  const zone = opts.zone ?? "play";
  const attached = (opts.attached ?? true) && zone === "play" && !opts.faceDown;
  return devBoard(
    [
      { key: "ph", def: printing(PHAL), owner: P1, zone, attachedToKey: attached ? "host" : undefined, faceDown: zone === "play" ? opts.faceDown : undefined },
      { key: "host", def: character({ name: "Host", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play", depleted: opts.hostDepleted },
      { key: "other", def: character({ name: "Other", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("h", opts.hand ?? 0, P1, "hand"),
      ...fillers("d", opts.deck ?? 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

/** A free tactic (id "s", pick "t"): takes control of one picked item in play. */
function stealItemTactic(): CardDefinition {
  return tactic({
    name: "Steal Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "di", pick "t"): destroys one picked item. */
function destroyItemTactic(): CardDefinition {
  return tactic({
    name: "Destroy Item",
    cost: 0,
    behavior: {
      abilities: [
        { id: "di", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
}

// --- UNIQUE PHALLUDRIX

clause(PHAL, "0:unique", "controlling a second Phalludrix (taken from the opponent) makes ME choose which to keep: keeping the new one destroys the old one", () => {
  const g = phalBoard({
    extra: [
      { key: "ph2", def: printing(PHAL), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "steal", def: stealItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ph2")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("ph"), g.id("ph2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ph2") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph2")), "play");
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard", "the other copy is destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ph")), "discardOf(g.engine, P1).includes(g.id(\"ph\"))");
});

clause(PHAL, "0:unique", "keeping the old copy destroys the stolen one, and it goes to its OWNER's discard pile", () => {
  const g = phalBoard({
    extra: [
      { key: "ph2", def: printing(PHAL), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "steal", def: stealItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ph2")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ph") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  assert.equal(zoneOf(g.engine, g.id("ph2")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("ph2")), "ownership never changes: it goes to the opponent's discard pile");
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3, "the kept copy still boosts its host");
});

clause(PHAL, "0:unique", "after I choose which copy to keep (a copy taken from the opponent), the game goes on: the response window closes", () => {
  const g = phalBoard({
    extra: [
      { key: "ph2", def: printing(PHAL), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "steal", def: stealItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ph2")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ph2") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the stolen item's tactic finished resolving");
  assert.equal(zoneOf(g.engine, g.id("steal")), "discard", "the Steal tactic reached its owner's discard pile");
});

clause(PHAL, "0:unique", "UNIQUE is per player: both players may control their own Phalludrix, with no choice and no destruction", () => {
  const g = phalBoard({
    extra: [
      { key: "ph2", def: printing(PHAL), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "noop", def: NOOP, owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  assert.equal(zoneOf(g.engine, g.id("ph2")), "play");
});

clause(PHAL, "0:unique", "a card with a different UNIQUE designation is not a duplicate of Phalludrix", () => {
  const g = phalBoard({
    extra: [
      { key: "other", def: item({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "noop", def: NOOP, owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
});

clause(PHAL, "0:unique", "a second copy in my hand is no conflict until it is in play", () => {
  const g = phalBoard({
    extra: [
      { key: "ph2", def: printing(PHAL), owner: P1, zone: "hand" },
      { key: "noop", def: NOOP, owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  assert.equal(zoneOf(g.engine, g.id("ph2")), "hand");
});

clause(PHAL, "0:unique", "deploying a second copy from my hand makes me choose which one to keep", () => {
  const g = phalBoard({
    rage: 6,
    extra: [{ key: "ph2", def: printing(PHAL), owner: P1, zone: "hand" }]
  });
  playRaw(g.engine, P1, g.id("ph2"), { selected: { eq: [g.id("other")], attachTo: [g.id("other")] } });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("ph"), g.id("ph2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ph2") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ph2")), "play");
});

clause(PHAL, "0:unique", "after I choose which copy to keep (a second copy deployed from my hand), the game goes on: the response window closes", () => {
  const g = phalBoard({
    rage: 6,
    extra: [{ key: "ph2", def: printing(PHAL), owner: P1, zone: "hand" }]
  });
  playRaw(g.engine, P1, g.id("ph2"), { selected: { eq: [g.id("other")], attachTo: [g.id("other")] } });
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ph") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the deploy finished resolving");
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  assert.equal(zoneOf(g.engine, g.id("ph2")), "discard");
});

// --- If an effect controlled by your opponent causes you to discard any number of cards, you may put them back into your hand.

/** The opponent (P2, on their own turn) makes me discard `picks` (placement keys) from my hand; `answerBack` answers every "put them back" offer. */
function discardedByOpponent(g: Game, picks: string[], answerBack?: boolean): void {
  playRaw(g.engine, P2, g.id("fd"), {});
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: picks.map((key) => g.id(key)) });
  let guard = 0;
  while (g.engine.state.pendingChoice && guard++ < 10) {
    const pc = g.engine.state.pendingChoice as unknown as PendingChoiceLike;
    if (pc.kind === "replacementChoice" && answerBack !== undefined) {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "replacementChoice", apply: answerBack } } as never);
      resolvePendingResponses(g.engine);
    } else {
      break;
    }
  }
}

const discardBoard = (n: number, opts: Parameters<typeof phalBoard>[0] = {}) =>
  phalBoard({
    hand: 4,
    game: { turn: 2, activePlayerId: P2 },
    ...opts,
    extra: [{ key: "fd", def: forceDiscardTactic(n), owner: P2, zone: "hand" }, ...(opts.extra ?? [])]
  });

clause(PHAL, "1:rule", "when the opponent's effect makes me discard 2 cards, I may put them back into my hand (accepting returns both to my hand)", () => {
  const g = discardBoard(2);
  discardedByOpponent(g, ["h0", "h1"], true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("h0")), "hand", "put back into my hand");
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand", "put back into my hand");
  assert.equal(handOf(g.engine, P1).length, 4);
  assert.equal(discardOf(g.engine, P1).includes(g.id("h0")), false);
});

clause(PHAL, "1:rule", "...and it is a 'may': I am asked, and declining leaves the discarded cards in my discard pile", () => {
  const g = discardBoard(2);
  playRaw(g.engine, P2, g.id("fd"), {});
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("h1")] });
  const pc = pending(g.engine);
  assert.ok(pc, "after the discard I am offered to put them back");
  assert.equal(pc.playerId, P1, "the offer is mine");
  while (pending(g.engine)) answerPending(g.engine, pending(g.engine)!.kind, { apply: false });
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h2")), "hand", "the cards I kept are untouched");
});

clause(PHAL, "1:rule", "'any number of cards': a single discarded card may be put back too", () => {
  const g = discardBoard(1);
  discardedByOpponent(g, ["h0"], true);
  assert.equal(zoneOf(g.engine, g.id("h0")), "hand");
  assert.equal(handOf(g.engine, P1).length, 4);
});

clause(PHAL, "1:rule", "'any number of cards': three discarded cards may be put back together", () => {
  const g = discardBoard(3);
  discardedByOpponent(g, ["h0", "h1", "h2"], true);
  for (const key of ["h0", "h1", "h2"]) assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} is back in my hand`);
  assert.equal(handOf(g.engine, P1).length, 4);
});

clause(PHAL, "1:rule", "without Phalludrix in play the discarded cards simply stay discarded (control)", () => {
  const g = discardBoard(2, { zone: "hand" });
  discardedByOpponent(g, ["h0", "h1"], true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
});

clause(PHAL, "1:rule", "it applies only to effects controlled by the opponent: my own discard effect gets no offer and the cards stay discarded", () => {
  const g = phalBoard({ hand: 4, extra: [{ key: "sf", def: selfDiscardTactic(2), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("sf"), {});
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("h1")] });
  assert.equal(g.engine.state.pendingChoice, undefined, "no 'put them back' offer for my own effect");
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
});

clause(PHAL, "1:rule", "'causes you to discard': the opponent discarding their own cards gets no offer from my Phalludrix", () => {
  const g = phalBoard({
    hand: 1,
    extra: [
      { key: "theirs0", def: character({ name: "Their Card 0" }), owner: P2, zone: "hand" },
      { key: "theirs1", def: character({ name: "Their Card 1" }), owner: P2, zone: "hand" },
      { key: "fd", def: forceDiscardTactic(2), owner: P1, zone: "hand" }
    ]
  });
  playRaw(g.engine, P1, g.id("fd"), {});
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirs0"), g.id("theirs1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirs0")), "discard", "their discards stay discarded");
  assert.equal(zoneOf(g.engine, g.id("theirs1")), "discard");
});

clause(PHAL, "1:rule", "a character of mine destroyed by an opposing effect is not 'discarded': no offer to put it into my hand, it stays in my discard pile", () => {
  const g = phalBoard({
    game: { turn: 2, activePlayerId: P2 },
    extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("other")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "Phalludrix says nothing about destroyed cards: nothing is offered");
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
});

clause(PHAL, "1:rule", "cards the opponent's effect mills from my deck are not 'discarded from my hand': no offer, they stay in my discard pile", () => {
  const millTactic = tactic({
    name: "Mill Them",
    cost: 0,
    behavior: { abilities: [{ id: "ml", type: "activated", effects: [{ type: "moveCard", target: { type: "deckPosition", player: "opponent", from: "top" }, to: "discard" }] }] }
  });
  const g = phalBoard({ deck: 3, game: { turn: 2, activePlayerId: P2 }, extra: [{ key: "ml", def: millTactic, owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  playRaw(g.engine, P2, g.id("ml"), {});
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "discard", "milled to the discard pile");
});

clause(PHAL, "1:rule", "a Phalludrix that is face-down (only a resource) does nothing", () => {
  const g = discardBoard(2, { faceDown: true });
  discardedByOpponent(g, ["h0", "h1"], true);
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
});

// --- EQUIP: Pick a character. If it is an "adriel" card then X is 0, otherwise X is 3. Pay X. Attach this card to the character.
// Read literally this is an ABILITY of a Phalludrix that is in play (the card prints no ATTACH TO keyword): Phalludrix is
// deployed for its own cost of 1 [R] with no character picked, and EQUIP is what attaches it afterwards (like Everlasting
// Blade of Light's EQUIP). The engine instead makes deploying pick a host and pay the EQUIP cost at the same time.

const adrielChar = (name = "Adriel Host"): CardDefinition => character({ name, strength: 1, life: 5, speed: 2, subtype: ["adriel"] });

function equipRaw(game: Game, hostKey: string, player: PlayerId = P1): void {
  actRaw(game.engine, player, game.id("ph"), "equip", { eq: [game.id(hostKey)] });
}

clause(PHAL, "2:ability", "Phalludrix is deployed for its own cost of 1 with NO character picked: it enters play (unattached), and the engine does not demand a host", () => {
  const g = phalBoard({ zone: "hand", rage: 3 });
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("ph"), {});
  assert.equal(zoneOf(g.engine, g.id("ph")), "play", "it enters play");
  assert.equal(before - ready(g.engine), 1, "it cost only its printed 1");
  assert.equal(g.engine.state.cards[g.id("ph")].attachedTo, undefined, "attaching is EQUIP's job, not deploying's");
});

clause(PHAL, "2:ability", "a Phalludrix in play that is not attached stays in play (nothing says an unattached Phalludrix goes away), through a whole turn", () => {
  const g = phalBoard({ attached: false, extra: [{ key: "noop", def: NOOP, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("noop"));
  assert.equal(zoneOf(g.engine, g.id("ph")), "play");
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("ph")), "play", "still in play on the opponent's turn");
});

clause(PHAL, "2:ability", "EQUIP on a character that is not an adriel: X is 3, so it pays exactly 3 and attaches this card to the picked character, which gains 2 strength", () => {
  const g = phalBoard({ attached: false, rage: 4 });
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("ph"), "equip", { eq: [g.id("host")] });
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 3, "X = 3");
  assert.equal(g.engine.state.cards[g.id("ph")].attachedTo, g.id("host"), "attached to the picked character");
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1);
});

clause(PHAL, "2:ability", "EQUIP on an 'adriel' character: X is 0, so it pays nothing", () => {
  const g = phalBoard({ attached: false, rage: 4, extra: [{ key: "adriel", def: adrielChar(), owner: P1, zone: "play" }] });
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("ph"), "equip", { eq: [g.id("adriel")] });
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 0, "X = 0");
  assert.equal(g.engine.state.cards[g.id("ph")].attachedTo, g.id("adriel"));
  assert.equal(g.engine.getStat(g.id("adriel"), "strength"), 3);
});

clause(PHAL, "2:ability", "an 'adriel' character can be equipped with no resources at all, while a non-adriel one needs the 3 (2 resources are refused)", () => {
  const free = phalBoard({ attached: false, rage: 0, extra: [{ key: "adriel", def: adrielChar(), owner: P1, zone: "play" }] });
  actRaw(free.engine, P1, free.id("ph"), "equip", { eq: [free.id("adriel")] });
  resolvePendingResponses(free.engine);
  assert.equal(free.engine.state.cards[free.id("ph")].attachedTo, free.id("adriel"), "no resources needed for an adriel");
  const poor = phalBoard({ attached: false, rage: 2 });
  refused(() => equipRaw(poor, "host"), "paying 3 with 2 resources");
  assert.equal(poor.engine.state.cards[poor.id("ph")].attachedTo, undefined);
  const exact = phalBoard({ attached: false, rage: 3 });
  equipRaw(exact, "host");
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.state.cards[exact.id("ph")].attachedTo, exact.id("host"), "control: exactly 3 works");
});

clause(PHAL, "2:ability", "EQUIP can move an attached Phalludrix to another character (CR 301.2): the old host loses the 2 strength, the new one gains it, and 3 is paid again", () => {
  const g = phalBoard({ attached: true, rage: 4 });
  const before = ready(g.engine);
  equipRaw(g, "other");
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 3);
  assert.equal(g.engine.state.cards[g.id("ph")].attachedTo, g.id("other"));
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 1, "the old host is back to its own strength");
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 3);
});

clause(PHAL, "2:ability", "EQUIP picks exactly one character: an item, a face-down card or a faction is refused", () => {
  const extra = (): CardPlacement[] => [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true }
  ];
  const good = phalBoard({ attached: false, rage: 4, extra: extra() });
  equipRaw(good, "host");
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("ph")].attachedTo, good.id("host"), "control: a character works");
  for (const key of ["thing", "fd"]) {
    const bad = phalBoard({ attached: false, rage: 4, extra: extra() });
    refused(() => equipRaw(bad, key), `picking ${key}`);
    assert.equal(bad.engine.state.cards[bad.id("ph")].attachedTo, undefined);
  }
  const faction = phalBoard({ attached: false, rage: 4 });
  refused(() => actRaw(faction.engine, P1, faction.id("ph"), "equip", { eq: [factionOf(faction.engine, P1)] }), "a faction");
});

clause(PHAL, "2:ability", "EQUIP is an ability: it can be used in response during the opponent's turn", () => {
  const g = phalBoard({ attached: false, rage: 4, game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  equipRaw(g, "host");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ph")].attachedTo, g.id("host"));
});

// --- The attached character gains 2 strength.

clause(PHAL, "3:rule", "the attached character gains 2 strength: 1 -> 3", () => {
  const g = phalBoard();
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3);
});

clause(PHAL, "3:rule", "only strength: the attached character's life and speed are unchanged", () => {
  const g = phalBoard();
  assert.equal(g.engine.getStat(g.id("host"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("host"), "speed"), 2);
});

clause(PHAL, "3:rule", "only the attached character: my other character and the opponent's keep their strength", () => {
  const g = phalBoard();
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 1);
});

clause(PHAL, "3:rule", "the bonus is real in battle: the attached character inflicts 3 (not 1) battle damage to the faction", () => {
  const g = phalBoard();
  fight(g, [g.id("host")], undefined, []);
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(PHAL, "3:rule", "the bonus ends when Phalludrix leaves play: destroying the item returns the character to its own strength", () => {
  const g = phalBoard({ extra: [{ key: "di", def: destroyItemTactic(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3);
  play(g.engine, P1, g.id("di"), { selected: { t: [g.id("ph")] } });
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 1);
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "the character itself stays");
});

clause(PHAL, "3:rule", "it stacks with other strength changes (+3 from an effect makes 1 + 2 + 3 = 6)", () => {
  const boost = tactic({
    name: "Boost",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bo",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const g = phalBoard({ extra: [{ key: "bo", def: boost, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bo"), { selected: { t: [g.id("host")] } });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 6);
});

clause(PHAL, "3:rule", "'the attached character' is whoever it is attached to: attached to an opponent's character, THAT character gains 2 strength", () => {
  const h = devBoard([
    { key: "ph", def: printing(PHAL), owner: P1, zone: "play", attachedToKey: "foe" },
    { key: "mine", def: character({ name: "Mine", strength: 1, life: 5 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 5 }), owner: P2, zone: "play" }
  ]);
  assert.equal(h.engine.getStat(h.id("foe"), "strength"), 3, "the attached character gains it, whoever controls it");
  assert.equal(h.engine.getStat(h.id("mine"), "strength"), 1);
});

// --- At the start of your opponent's turn, you may restore the attached character.

/** Both players' factions restore nothing by themselves, so only Phalludrix can restore a depleted card. */
const inertRestoreFaction = (name: string): CardDefinition =>
  factionCard({
    name,
    faction: defaultFactionDefinition({
      startingInfluence: 30,
      turn: {
        restore: { detachResources: false, restoreNonResources: false },
        develop: { choices: [{ type: "draw", count: 1 }] }
      }
    })
  });

function restoreBoard(opts: { hostDepleted?: boolean; attached?: boolean; faceDown?: boolean; zone?: "play" | "hand"; ph2?: boolean; hostOwner?: PlayerId } = {}) {
  const hostOwner = opts.hostOwner ?? P1;
  return buildGame({
    playerA: { faction: inertRestoreFaction("Inert A") },
    playerB: { faction: inertRestoreFaction("Inert B") },
    cards: [
      { key: "ph", def: printing(PHAL), owner: P1, zone: opts.zone ?? "play", attachedToKey: (opts.attached ?? true) && (opts.zone ?? "play") === "play" && !opts.faceDown ? "host" : undefined, faceDown: opts.faceDown },
      { key: "host", def: character({ name: "Host", strength: 1, life: 5 }), owner: hostOwner, zone: "play", depleted: opts.hostDepleted ?? true },
      { key: "other", def: character({ name: "Other Depleted", strength: 1, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "foeDep", def: character({ name: "Foe Depleted", strength: 1, life: 5 }), owner: P2, zone: "play", depleted: true },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck")
    ]
  });
}

/** Ends P1's turn so the opponent's turn starts; returns after the response window. */
function startOpponentsTurn(g: ReturnType<typeof restoreBoard>): void {
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine); // the opponent's Develop Rule is skipped; Phalludrix's offer is the prompt left
}

clause(PHAL, "4:rule", "at the start of the opponent's turn I am offered to restore the attached character; accepting restores it", () => {
  const g = restoreBoard();
  assert.equal(isDepleted(g.engine, g.id("host")), true);
  startOpponentsTurn(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the offer is mine: 'you may'");
  const labels = (pc.options as { label?: string }[]).map((o) => o.label);
  assert.equal(labels.length, 2, "restore or not");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g.engine, g.id("host")), false, "restored");
});

clause(PHAL, "4:rule", "...it is a 'may': declining leaves the attached character depleted", () => {
  const g = restoreBoard();
  startOpponentsTurn(g);
  expectPending(g.engine, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g.engine, g.id("host")), true);
});

clause(PHAL, "4:rule", "only the attached character is restored: my other depleted character, and the opponent's, stay depleted", () => {
  const g = restoreBoard();
  startOpponentsTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(isDepleted(g.engine, g.id("host")), false);
  assert.equal(isDepleted(g.engine, g.id("other")), true, "another depleted character of mine is not restored");
  assert.equal(isDepleted(g.engine, g.id("foeDep")), true, "nor is the opponent's");
});

clause(PHAL, "4:rule", "it triggers only at the start of the OPPONENT's turn: nothing is offered at the start of my own turn", () => {
  const g = restoreBoard();
  startOpponentsTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  g.engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer at the start of my turn");
  assert.equal(isDepleted(g.engine, g.id("host")), true, "so the declined character is still depleted (my faction's restore rule does nothing here)");
});

clause(PHAL, "4:rule", "an attached character that is not depleted: accepting changes nothing and nothing breaks", () => {
  const g = restoreBoard({ hostDepleted: false });
  startOpponentsTurn(g);
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g.engine, g.id("host")), false);
});

clause(PHAL, "4:rule", "'the attached character' may be the opponent's character: I (the controller of Phalludrix) decide whether to restore it", () => {
  const g = restoreBoard({ hostOwner: P2 });
  startOpponentsTurn(g);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "I decide, not the owner of the character");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(isDepleted(g.engine, g.id("host")), false);
});

clause(PHAL, "4:rule", "a Phalludrix that is face-down, or in my hand, restores nothing and offers nothing", () => {
  const faceDown = restoreBoard({ faceDown: true });
  startOpponentsTurn(faceDown);
  assert.equal(faceDown.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(faceDown.engine, faceDown.id("host")), true);
  const inHand = restoreBoard({ zone: "hand" });
  startOpponentsTurn(inHand);
  assert.equal(inHand.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(inHand.engine, inHand.id("host")), true);
});

clause(PHAL, "4:rule", "the opponent's Phalludrix works for them at the start of MY turn (their opponent's turn), not at theirs", () => {
  const g = buildGame({
    playerA: { faction: inertRestoreFaction("Inert A") },
    playerB: { faction: inertRestoreFaction("Inert B") },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "ph", def: printing(PHAL), owner: P2, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Their Host", strength: 1, life: 5 }), owner: P2, zone: "play", depleted: true },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck")
    ]
  });
  g.engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine); // my own Develop Rule is skipped first
  assert.equal(g.engine.state.activePlayerId, P1);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "their controller decides");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(isDepleted(g.engine, g.id("host")), false);
});

// =============================================================================
// FLIP UP characters (Proficient Battler, Spitting Sarume, Tiny Sarume): shared
// bodies. Each is a face-down card in play, flipped up by paying exactly its FLIP
// UP cost (CR 507.4b, 406.7) and meeting its FLIP UP threshold [R].
// =============================================================================

interface FlipSpec {
  /** printed cost number (what deploying it from the hand costs) */
  cost: number;
  /** FLIP UP cost */
  flip: number;
  strength: number;
  speed: number;
  life: number;
}

function flipBoard(
  id: string,
  o: { rage?: number; greed?: number; spentRage?: number; oppRage?: number; zone?: "play" | "hand"; faceDown?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const zone = o.zone ?? "play";
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "c", def: printing(id), owner: P1, zone, faceDown: zone === "play" ? o.faceDown ?? true : undefined },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spent("rage", o.spentRage ?? 0, P1),
      ...bank("rage", o.oppRage ?? 0, P2),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

const flip = (game: Game, player: PlayerId = P1, selected: Record<string, CardInstanceId[]> = {}): void => flipUpRaw(game.engine, player, game.id("c"), selected);

function flipFaceUpStats(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip });
  assert.equal(isFaceDown(g.engine, g.id("c")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["resource"], "face-down it is only a resource");
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(isFaceDown(g.engine, g.id("c")), false, "face-up");
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["character"]);
  assert.equal(g.engine.isResource(g.id("c")), false, "no longer a resource");
  assert.equal(g.engine.getStat(g.id("c"), "strength"), spec.strength);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), spec.speed);
  assert.equal(g.engine.getStat(g.id("c"), "life"), spec.life);
}

function flipPaysExactly(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip + 2 });
  assert.equal(ready(g.engine), spec.flip + 4, "setup: the bank and the face-down card itself");
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("c")), false);
  assert.equal(ready(g.engine), 3, `paid exactly FLIP UP ${spec.flip} (not the printed cost ${spec.cost}, not both); the flipped card is no longer a resource`);
}

function flipCanPayForItself(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip - 2 });
  assert.equal(ready(g.engine), spec.flip, "setup: exactly the FLIP UP cost, counting the face-down card");
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("c")), false, "the card paid for its own FLIP UP (CR 507.4b)");
  assert.equal(ready(g.engine), 0);
}

function flipOneShort(id: string, spec: FlipSpec): void {
  const short = flipBoard(id, { spentRage: 1, greed: spec.flip - 2 });
  assert.equal(ready(short.engine), spec.flip - 1, "setup: one resource short (the Rage is spent, it only meets the threshold)");
  refused(() => flip(short), "one resource short");
  assert.equal(isFaceDown(short.engine, short.id("c")), true, "still face-down");
  assert.equal(ready(short.engine), spec.flip - 1, "nothing was paid");
  const exact = flipBoard(id, { spentRage: 1, greed: spec.flip - 1 });
  flip(exact);
  resolvePendingResponses(exact.engine);
  assert.equal(isFaceDown(exact.engine, exact.id("c")), false, "control: one more resource is enough");
}

function flipNeedsRage(id: string, spec: FlipSpec): void {
  const none = flipBoard(id, { rage: 0, greed: spec.flip + 4 });
  refused(() => flip(none), "no [R]");
  assert.equal(isFaceDown(none.engine, none.id("c")), true);
  assert.equal(ready(none.engine), spec.flip + 5, "nothing was paid");
  const good = flipBoard(id, { rage: 1, greed: spec.flip + 4 });
  flip(good);
  resolvePendingResponses(good.engine);
  assert.equal(isFaceDown(good.engine, good.id("c")), false, "control: one [R] among plenty is enough");
}

function flipNotVolition(id: string, spec: FlipSpec): void {
  const own = flipBoard(id, { rage: 0, greed: 0, extra: volition(spec.flip + 4, P1) });
  refused(() => flip(own), "Volition is not [R]");
  assert.equal(isFaceDown(own.engine, own.id("c")), true);
  const theirs = flipBoard(id, { rage: 0, greed: spec.flip + 4, oppRage: 5 });
  refused(() => flip(theirs), "the opponent's [R] is not mine");
  assert.equal(isFaceDown(theirs.engine, theirs.id("c")), true);
}

function flipSpentRage(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { spentRage: 1, greed: spec.flip });
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("c")), false, "a spent [R] still meets the threshold (CR 405.6)");
  assert.equal(ready(g.engine), 0, "the FLIP UP cost was paid by the ready Greed");
}

function flipNotOnTheirTurn(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip + 3, active: P2 });
  refused(() => flip(g), "on the opponent's turn");
  assert.equal(isFaceDown(g.engine, g.id("c")), true);
  assert.equal(ready(g.engine), spec.flip + 5, "nothing was paid");
  const mine = flipBoard(id, { rage: 1, greed: spec.flip + 3 });
  flip(mine);
  resolvePendingResponses(mine.engine);
  assert.equal(isFaceDown(mine.engine, mine.id("c")), false, "control: on my own turn it flips up");
}

function flipNotInResponse(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip + 3, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  refused(() => flip(g), "a character is not a tactic: FLIP UP does not let it be deployed in response (CR 507.4d)");
  assert.equal(isFaceDown(g.engine, g.id("c")), true);
  assert.equal(ready(g.engine), spec.flip + 5, "nothing was paid");
}

function flipNewArrival(id: string, spec: FlipSpec): void {
  const g = flipBoard(id, { rage: 1, greed: spec.flip });
  flip(g);
  resolvePendingResponses(g.engine);
  refused(
    () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("c")], target: { type: "faction", playerId: P2 } }),
    "a card that just flipped up is a new arrival and cannot attack (CR 411.3, 204.3)",
    /did not start the turn in play/
  );
}

function flipNotFromElsewhere(id: string, spec: FlipSpec): void {
  const faceUp = flipBoard(id, { rage: 1, greed: spec.flip + 3, faceDown: false });
  refused(() => flip(faceUp), "already face-up");
  const inHand = flipBoard(id, { rage: 1, greed: spec.flip + 3, zone: "hand" });
  refused(() => flip(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("c")), "hand");
  const theirs = flipBoard(id, { rage: 1, greed: spec.flip + 3 });
  refused(() => flip(theirs, P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("c")), true);
}

function flipIsAlternative(id: string, spec: FlipSpec): void {
  const hand = flipBoard(id, { zone: "hand", rage: 1, greed: Math.max(0, spec.cost - 1) });
  const short = flipBoard(id, { zone: "hand", rage: 1, greed: Math.max(0, spec.cost - 2) });
  const before = ready(hand.engine);
  playAndResolve(hand.engine, P1, hand.id("c"));
  assert.equal(zoneOf(hand.engine, hand.id("c")), "play");
  assert.equal(before - ready(hand.engine), spec.cost, `from the hand it costs its printed ${spec.cost}`);
  if (spec.cost > 0) {
    refused(() => playRaw(short.engine, P1, short.id("c")), "one short of the printed cost");
    assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  }
}

// --- Proficient Battler -------------------------------------------------------
// FLIP UP: 2 [R]
// Character, cost 4, [R], 4 strength / 3 speed / 2 life. soldier.

const BATTLER = "c00a8848-aced-44df-a203-e4dfb0e3b0ad";
const BATTLER_SPEC: FlipSpec = { cost: 4, flip: 2, strength: 4, speed: 3, life: 2 };

clause(BATTLER, "0:flipUp", "a face-down Proficient Battler flips up into a face-up character with its printed 4 strength / 3 speed / 2 life", () => flipFaceUpStats(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "flipping up pays exactly 2 (not its cost of 4)", () => flipPaysExactly(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "the Battler may pay for its own FLIP UP (CR 507.4b): one [R] plus itself is exactly enough", () => flipCanPayForItself(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "is refused one resource short: a spent [R] and the face-down Battler itself is only 1 ready resource", () => flipOneShort(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "needs [R]: plenty of Greed and no Rage is refused", () => flipNeedsRage(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "its own face-down Volition, other Volition and the opponent's Rage are not my [R]", () => flipNotVolition(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "a spent [R] still meets the threshold, while other resources pay the 2", () => flipSpentRage(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn (CR 507.4d)", () => flipNotOnTheirTurn(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "FLIP UP does not change WHEN a character can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => flipNotInResponse(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "the flipped-up Battler is a new arrival: it cannot attack the turn it flipped", () => flipNewArrival(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "only a face-down Battler I control in play can be flipped up (not face-up, not in hand, not the opponent's)", () => flipNotFromElsewhere(BATTLER, BATTLER_SPEC));
clause(BATTLER, "0:flipUp", "FLIP UP is an alternative: deployed from the hand the Battler costs its printed 4 with [R]", () => flipIsAlternative(BATTLER, BATTLER_SPEC));

clause(BATTLER, "0:flipUp", "a flipped-up Battler is an ordinary character with 4 strength: it hits a faction for 4 on a later turn", () => {
  const g = flipBoard(BATTLER, { rage: 1, greed: 2 });
  flip(g);
  resolvePendingResponses(g.engine);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  declareAttackBy(g.engine, P1, [g.id("c")]);
  declareBlockers(g.engine, P2, []);
  autoResolveBattle(g.engine);
  assert.equal(influenceOf(g.engine, P2), 26);
});

// --- Righteous Exemplar ---------------------------------------------------------
// [R][R][R][R][R]: This card gains 1 strength and 1 life.
// Character, cost 1, [R], 1 strength / 3 speed / 1 life. soldier.

const EXEMPLAR = "ef7a641c-efb6-41e7-8648-45124a07681c";

function exemplarBoard(opts: { rage?: number; greed?: number; spentRage?: number; oppRage?: number; faceDownRes?: number; extra?: CardPlacement[]; zone?: "play" | "hand" } = {}) {
  return devBoard([
    { key: "ex", def: printing(EXEMPLAR), owner: P1, zone: opts.zone ?? "play" },
    { key: "other", def: character({ name: "Other", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 1, speed: 3 }), owner: P2, zone: "play" },
    ...bank("rage", opts.rage ?? 0, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...spent("rage", opts.spentRage ?? 0, P1),
    ...bank("rage", opts.oppRage ?? 0, P2),
    ...volition(opts.faceDownRes ?? 0, P1),
    ...(opts.extra ?? [])
  ]);
}

clause(EXEMPLAR, "0:rule@rrrrr", "with [R][R][R][R][R] it gains 1 strength and 1 life: 1/1 -> 2/2, and its speed stays 3", () => {
  const g = exemplarBoard({ rage: 5 });
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ex"), "life"), 2);
  assert.equal(g.engine.getStat(g.id("ex"), "speed"), 3);
});

clause(EXEMPLAR, "0:rule@rrrrr", "with only four [R] (or fewer, or none) it has its printed 1 strength and 1 life", () => {
  for (const rage of [0, 1, 4]) {
    const g = exemplarBoard({ rage, greed: 6 });
    assert.equal(g.engine.getStat(g.id("ex"), "strength"), 1, `${rage} Rage`);
    assert.equal(g.engine.getStat(g.id("ex"), "life"), 1, `${rage} Rage`);
  }
});

clause(EXEMPLAR, "0:rule@rrrrr", "it is not cumulative: with ten [R] the bonus is still exactly +1 strength and +1 life", () => {
  for (const rage of [6, 10]) {
    const g = exemplarBoard({ rage });
    assert.equal(g.engine.getStat(g.id("ex"), "strength"), 2, `${rage} Rage`);
    assert.equal(g.engine.getStat(g.id("ex"), "life"), 2, `${rage} Rage`);
  }
});

clause(EXEMPLAR, "0:rule@rrrrr", "other icons do not count: five Greed, and face-down Volition, are not [R][R][R][R][R]", () => {
  const greed = exemplarBoard({ greed: 8 });
  assert.equal(greed.engine.getStat(greed.id("ex"), "strength"), 1);
  const volitionOnly = exemplarBoard({ faceDownRes: 8 });
  assert.equal(volitionOnly.engine.getStat(volitionOnly.id("ex"), "life"), 1);
  const mixed = exemplarBoard({ rage: 4, greed: 3, faceDownRes: 3 });
  assert.equal(mixed.engine.getStat(mixed.id("ex"), "strength"), 1, "four [R] among many resources is still not five");
});

clause(EXEMPLAR, "0:rule@rrrrr", "my opponent's Rage does not count", () => {
  const g = exemplarBoard({ rage: 4, oppRage: 5 });
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ex"), "life"), 1);
});

clause(EXEMPLAR, "0:rule@rrrrr", "spent (attached) Rage still counts: icons are never spent (CR 405.6)", () => {
  const g = exemplarBoard({ rage: 2, spentRage: 3 });
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ex"), "life"), 2);
});

clause(EXEMPLAR, "0:rule@rrrrr", "icons count, not cards: Violence ([R][R]) and three Rage make five icons from four cards", () => {
  const on = exemplarBoard({ rage: 3, extra: [{ key: "vio", def: printing(VIOLENCE), owner: P1, zone: "play" }] });
  assert.equal(on.engine.getStat(on.id("ex"), "strength"), 2);
  const off = exemplarBoard({ rage: 2, extra: [{ key: "vio", def: printing(VIOLENCE), owner: P1, zone: "play" }] });
  assert.equal(off.engine.getStat(off.id("ex"), "strength"), 1, "Violence plus two Rage is four icons");
});

clause(EXEMPLAR, "0:rule@rrrrr", "it affects only the Exemplar: my other character and the opponent's get nothing", () => {
  const g = exemplarBoard({ rage: 5 });
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("other"), "life"), 1);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 1);
});

clause(EXEMPLAR, "0:rule@rrrrr", "the opponent's Exemplar is powered by THEIR Rage, not mine", () => {
  const g = devBoard([
    { key: "ex", def: printing(EXEMPLAR), owner: P2, zone: "play" },
    ...bank("rage", 5, P1),
    ...bank("rage", 2, P2)
  ]);
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 1, "their two [R] are not five");
  const on = devBoard([{ key: "ex", def: printing(EXEMPLAR), owner: P2, zone: "play" }, ...bank("rage", 5, P2)]);
  assert.equal(on.engine.getStat(on.id("ex"), "strength"), 2);
});

clause(EXEMPLAR, "0:rule@rrrrr", "it turns off again the moment I stop meeting [R]x5: a Rage returned to hand drops the bonus, and replaying it restores it", () => {
  const g = exemplarBoard({ rage: 5, extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 2);
  const rageIds = Object.values(g.engine.state.cards).filter((c) => c.zone === "play" && c.ownerId === P1 && g.engine.getDefinition(c.id).type === "resource").map((c) => c.id);
  assert.equal(rageIds.length, 5);
  play(g.engine, P1, g.id("mv"), { selected: { t: [rageIds[0]] } });
  assert.equal(zoneOf(g.engine, rageIds[0]), "hand");
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 1, "four icons: off");
  assert.equal(g.engine.getStat(g.id("ex"), "life"), 1);
  developResource(g.engine, P1, rageIds[0], false);
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 2, "five icons again: on");
  assert.equal(g.engine.getStat(g.id("ex"), "life"), 2);
});

clause(EXEMPLAR, "0:rule@rrrrr", "the life bonus is real: 1 damage destroys the Exemplar without five [R], but not with them", () => {
  const off = exemplarBoard({ rage: 4, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  const on = exemplarBoard({ rage: 5, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  for (const [g, destroyed] of [[off, true], [on, false]] as const) {
    declareAttackOpenWindow(g.engine, P1, [g.id("other")]);
    playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("ex")] } });
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("ex")), destroyed ? "discard" : "play");
  }
});

clause(EXEMPLAR, "0:rule@rrrrr", "the strength bonus is real in battle: with five [R] the Exemplar hits a faction for 2, otherwise for 1", () => {
  const off = exemplarBoard({ rage: 4 });
  fight(off, [off.id("ex")], undefined, []);
  assert.equal(influenceOf(off.engine, P2), 29);
  const on = exemplarBoard({ rage: 5 });
  fight(on, [on.id("ex")], undefined, []);
  assert.equal(influenceOf(on.engine, P2), 28);
});

clause(EXEMPLAR, "0:rule@rrrrr", "the paragraph is only active while it is in play: in my hand it has its printed stats and a stat read does not apply the bonus", () => {
  const g = exemplarBoard({ rage: 5, zone: "hand" });
  assert.equal(g.engine.getStat(g.id("ex"), "strength"), 1, "not in play, no bonus");
});

clause(EXEMPLAR, "0:rule@rrrrr", "it deploys for its printed cost of 1 with [R]: one Rage works, none is refused, and no resources is refused", () => {
  const good = devBoard([{ key: "ex", def: printing(EXEMPLAR), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 2, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("ex"));
  assert.equal(zoneOf(good.engine, good.id("ex")), "play");
  assert.equal(before - ready(good.engine), 1);
  const noRage = devBoard([{ key: "ex", def: printing(EXEMPLAR), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]);
  refused(() => playRaw(noRage.engine, P1, noRage.id("ex")), "no [R]");
  const nothing = devBoard([{ key: "ex", def: printing(EXEMPLAR), owner: P1, zone: "hand" }]);
  refused(() => playRaw(nothing.engine, P1, nothing.id("ex")), "no resources");
});

// --- Robustical Badass ----------------------------------------------------------
// [R][R][R]: At the start of your turn, you may inflict 1 damage to your opponent's faction.
// Character, cost 4, [R], 3 strength / 3 speed / 3 life. soldier.

const BADASS = "1855fff6-56b5-45df-8792-3436ebb5c3ba";

function badassBoard(
  opts: { rage?: number; greed?: number; oppRage?: number; zone?: "play" | "hand"; faceDown?: boolean; extra?: CardPlacement[]; p2Influence?: number; second?: boolean; spentRage?: number } = {}
) {
  return devBoard(
    [
      { key: "ba", def: printing(BADASS), owner: P1, zone: opts.zone ?? "play", faceDown: opts.faceDown },
      ...(opts.second ? [{ key: "ba2", def: printing(BADASS), owner: P1, zone: "play" as const }] : []),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...spent("rage", opts.spentRage ?? 0, P1),
      ...bank("rage", opts.oppRage ?? 0, P2),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2, ...(opts.p2Influence !== undefined ? { playerB: { influence: opts.p2Influence, faction: developFaction() } } : {}) }
  );
}

/** Ends the opponent's turn: my turn starts and its "at the start of your turn" triggers fire. */
const startMyTurn = (g: Game): void => endTurn(g.engine, P2);

clause(BADASS, "0:rule@rrr", "with [R][R][R], at the start of my turn I am offered to inflict 1 damage to the opponent's faction; accepting costs them 1 influence", () => {
  const g = badassBoard({ rage: 3 });
  startMyTurn(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the offer is mine: 'you may'");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P2), 29, "1 damage to the opponent's faction is 1 influence lost");
  assert.equal(influenceOf(g.engine, P1), 30, "mine is untouched");
});

clause(BADASS, "0:rule@rrr", "...it is a 'may': declining inflicts nothing", () => {
  const g = badassBoard({ rage: 3 });
  startMyTurn(g);
  expectPending(g.engine, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P2), 30);
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(BADASS, "0:rule@rrr", "with only [R][R] (or fewer, or none) nothing is offered and nothing happens", () => {
  for (const rage of [0, 1, 2]) {
    const g = badassBoard({ rage, greed: 5 });
    startMyTurn(g);
    assert.equal(g.engine.state.pendingChoice, undefined, `${rage} Rage: nothing offered`);
    assert.equal(influenceOf(g.engine, P2), 30);
  }
});

clause(BADASS, "0:rule@rrr", "it is not cumulative: with nine [R] it is still a single 1 damage", () => {
  const g = badassBoard({ rage: 9 });
  startMyTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined, "offered once");
  assert.equal(influenceOf(g.engine, P2), 29);
});

clause(BADASS, "0:rule@rrr", "other icons do not count: Greed and face-down Volition are not [R][R][R]; the opponent's Rage is not mine", () => {
  const greed = badassBoard({ greed: 6 });
  startMyTurn(greed);
  assert.equal(greed.engine.state.pendingChoice, undefined);
  const vol = badassBoard({ extra: volition(6, P1) });
  startMyTurn(vol);
  assert.equal(vol.engine.state.pendingChoice, undefined);
  const theirs = badassBoard({ rage: 2, oppRage: 5 });
  startMyTurn(theirs);
  assert.equal(theirs.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(theirs.engine, P2), 30);
});

clause(BADASS, "0:rule@rrr", "spent (attached) Rage still counts toward [R][R][R]", () => {
  const g = badassBoard({ spentRage: 3 });
  startMyTurn(g);
  expectPending(g.engine, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(g.engine, P2), 29);
});

clause(BADASS, "0:rule@rrr", "icons count, not cards: Violence ([R][R]) plus one Rage meets [R][R][R]", () => {
  const g = badassBoard({ rage: 1, extra: [{ key: "vio", def: printing(VIOLENCE), owner: P1, zone: "play" }] });
  startMyTurn(g);
  expectPending(g.engine, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(g.engine, P2), 29);
});

clause(BADASS, "0:rule@rrr", "it triggers at the start of MY turn only: nothing is offered at the start of the opponent's turn", () => {
  const g = badassBoard({ rage: 3 });
  startMyTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(influenceOf(g.engine, P2), 30);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer at the start of their turn");
  assert.equal(influenceOf(g.engine, P1), 30, "nothing hit me");
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(BADASS, "0:rule@rrr", "it happens every turn: two of my turn starts, accepting both, cost the opponent 2 influence", () => {
  const g = badassBoard({ rage: 3 });
  startMyTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(g.engine, P2), 28);
});

clause(BADASS, "0:rule@rrr", "two Badasses are two triggers: after ordering them I may inflict 1 damage with each, for 2 in all", () => {
  const g = badassBoard({ rage: 3, second: true });
  startMyTurn(g);
  let guard = 0;
  while (pending(g.engine) && guard++ < 8) {
    const pc = pending(g.engine)!;
    if (pc.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  }
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P2), 28, "each Badass inflicts its own 1 damage");
});

clause(BADASS, "0:rule@rrr", "the damage can win the game: the opponent at 1 influence is reduced to 0 and loses", () => {
  const g = badassBoard({ rage: 3, p2Influence: 1 });
  startMyTurn(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(g.engine, P2), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(BADASS, "0:rule@rrr", "a Badass that is face-down (only a resource) or in my hand does nothing", () => {
  const faceDown = badassBoard({ rage: 3, faceDown: true });
  startMyTurn(faceDown);
  assert.equal(faceDown.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(faceDown.engine, P2), 30);
  const inHand = badassBoard({ rage: 3, zone: "hand" });
  startMyTurn(inHand);
  assert.equal(inHand.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(inHand.engine, P2), 30);
});

clause(BADASS, "0:rule@rrr", "the opponent's Badass hits MY faction at the start of THEIR turn, with THEIR [R][R][R]", () => {
  const g = devBoard(
    [
      { key: "ba", def: printing(BADASS), owner: P2, zone: "play" },
      ...bank("rage", 3, P2),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck")
    ],
    { turn: 1, activePlayerId: P1 }
  );
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(g.engine, P1), 29);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(BADASS, "0:rule@rrr", "it deploys for its printed cost of 4 with [R]: three Rage and one other is refused one short... four resources including [R] work", () => {
  const good = devBoard([{ key: "ba", def: printing(BADASS), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 3, P1)]);
  playAndResolve(good.engine, P1, good.id("ba"));
  assert.equal(zoneOf(good.engine, good.id("ba")), "play");
  assert.equal(ready(good.engine), 0, "paid 4");
  const short = devBoard([{ key: "ba", def: printing(BADASS), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 2, P1)]);
  refused(() => playRaw(short.engine, P1, short.id("ba")), "three resources for a cost of 4");
  const noRage = devBoard([{ key: "ba", def: printing(BADASS), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]);
  refused(() => playRaw(noRage.engine, P1, noRage.id("ba")), "no [R]");
});

// --- Seraphim Magic -------------------------------------------------------------
// COST: Pick a character. EFFECT: This turn, the character gains 3 strength. Draw a card.
// Tactic, cost 3, [R][R].

const SERAPHIM = "57a10d25-4f3b-4e6c-9a69-182583b30404";

function seraphimBoard(opts: { rage?: number; greed?: number; deck?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0]; second?: boolean } = {}) {
  return devBoard(
    [
      { key: "sm", def: printing(SERAPHIM), owner: P1, zone: "hand" },
      ...(opts.second ? [{ key: "sm2", def: printing(SERAPHIM), owner: P1, zone: "hand" as const }] : []),
      { key: "m0", def: character({ name: "Mine 0", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine 1", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "o0", def: character({ name: "Theirs 0", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "myStolen", def: character({ name: "My Stolen", strength: 1, life: 5 }), owner: P1, controller: P2, zone: "play" },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

const smRaw = (g: Game, target: string | undefined, card = "sm", player: PlayerId = P1): void =>
  playRaw(g.engine, player, g.id(card), { selected: { c: target === undefined ? [] : [g.id(target)] } });

function smPlay(g: Game, target: string, card = "sm"): void {
  smRaw(g, target, card);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(SERAPHIM, "0:ability", "the picked character gains 3 strength this turn: 1 -> 4, and nothing else about it changes", () => {
  const g = seraphimBoard();
  smPlay(g, "m0");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("m0"), "life"), 5, "life is unchanged");
  assert.equal(g.engine.getStat(g.id("m0"), "speed"), 2, "speed is unchanged");
});

clause(SERAPHIM, "0:ability", "only the picked character gains it: my other character and the opponent's do not", () => {
  const g = seraphimBoard();
  smPlay(g, "m0");
  assert.equal(g.engine.getStat(g.id("m1"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("o0"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("myStolen"), "strength"), 1);
});

clause(SERAPHIM, "0:ability", "'a character' is any character: the opponent's character, or one I own but they control, can be picked and gains the 3 strength", () => {
  const theirs = seraphimBoard();
  smPlay(theirs, "o0");
  assert.equal(theirs.engine.getStat(theirs.id("o0"), "strength"), 4);
  assert.equal(theirs.engine.getStat(theirs.id("m0"), "strength"), 1);
  const stolen = seraphimBoard();
  smPlay(stolen, "myStolen");
  assert.equal(stolen.engine.getStat(stolen.id("myStolen"), "strength"), 4);
});

clause(SERAPHIM, "0:ability", "draws exactly one card (the top of my deck); the opponent draws nothing", () => {
  const g = seraphimBoard();
  const top = deckOf(g.engine, P1)[0];
  const deckBefore = deckOf(g.engine, P1).length;
  const theirDeck = deckOf(g.engine, P2).length;
  smPlay(g, "m0");
  assert.ok(handOf(g.engine, P1).includes(top), "the top card is in my hand");
  assert.equal(deckOf(g.engine, P1).length, deckBefore - 1);
  assert.equal(handOf(g.engine, P1).length, 1, "Seraphim Magic left my hand and one card arrived");
  assert.equal(deckOf(g.engine, P2).length, theirDeck);
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(SERAPHIM, "0:ability", "'This turn': the bonus ends when the turn ends (it is gone on the opponent's turn)", () => {
  const g = seraphimBoard();
  smPlay(g, "m0");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 1, "back to its own strength");
});

clause(SERAPHIM, "0:ability", "the bonus lasts the whole turn: an attack later this turn is made with 4 strength", () => {
  const g = seraphimBoard();
  smPlay(g, "m0");
  declareAttackBy(g.engine, P1, [g.id("m0")]);
  declareBlockers(g.engine, P2, []);
  autoResolveBattle(g.engine);
  assert.equal(influenceOf(g.engine, P2), 26, "4 battle damage to the faction");
});

clause(SERAPHIM, "0:ability", "the bonus is there when the damage matters: a pumped blocker deals 4 to the attacker it blocks", () => {
  const g = seraphimBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  smRaw(g, "m0");
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("m0")]);
  autoResolveBattle(g.engine);
  assert.equal(damageOf(g.engine, g.id("o0")), 4, "the attacker (5 life) took the blocker's 4 strength");
});

clause(SERAPHIM, "0:ability", "two Seraphim Magics on one character add up: 1 + 3 + 3 = 7", () => {
  const g = seraphimBoard({ second: true, rage: 8 });
  smPlay(g, "m0", "sm");
  smPlay(g, "m0", "sm2");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 7);
  assert.equal(handOf(g.engine, P1).length, 2, "and two cards were drawn");
});

clause(SERAPHIM, "0:ability", "pays exactly its cost of 3 and nothing more", () => {
  const g = seraphimBoard({ rage: 6 });
  const before = ready(g.engine);
  smPlay(g, "m0");
  assert.equal(before - ready(g.engine), 3);
});

clause(SERAPHIM, "0:ability", "the cost is paid when played, before the opponent can respond; the bonus waits for resolution", () => {
  const g = seraphimBoard({ rage: 6 });
  const before = ready(g.engine);
  smRaw(g, "m0");
  assert.equal(before - ready(g.engine), 3, "paid at once");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 1, "no bonus yet");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
});

clause(SERAPHIM, "0:ability", "is refused one resource short of its cost 3 (2 resources with [R][R]); exactly 3 works", () => {
  const bad = seraphimBoard({ rage: 2 });
  refused(() => smRaw(bad, "m0"), "two resources for a cost of 3");
  assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing was paid");
  const good = seraphimBoard({ rage: 3 });
  smPlay(good, "m0");
  assert.equal(good.engine.getStat(good.id("m0"), "strength"), 4);
  assert.equal(ready(good.engine), 0);
});

clause(SERAPHIM, "0:ability", "needs [R][R]: one Rage with plenty of other resources, or none, is refused; face-down Volition and the opponent's Rage do not count", () => {
  const one = seraphimBoard({ rage: 1, greed: 6 });
  refused(() => smRaw(one, "m0"), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("sm")), "hand");
  const none = seraphimBoard({ rage: 0, greed: 6 });
  refused(() => smRaw(none, "m0"), "no [R]");
  const vol = seraphimBoard({ rage: 0, extra: volition(6, P1) });
  refused(() => smRaw(vol, "m0"), "Volition");
  const theirs = seraphimBoard({ rage: 0, greed: 6, extra: bank("rage", 4, P2) });
  refused(() => smRaw(theirs, "m0"), "their Rage");
  const good = seraphimBoard({ rage: 2, greed: 1 });
  smPlay(good, "m0");
  assert.equal(good.engine.getStat(good.id("m0"), "strength"), 4, "control: [R][R] and 3 resources works");
});

clause(SERAPHIM, "0:ability", "spent Rage meets [R][R] while ready resources pay the 3", () => {
  const g = seraphimBoard({ rage: 0, greed: 3, extra: spent("rage", 2) });
  smPlay(g, "m0");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
  assert.equal(ready(g.engine), 0);
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(SERAPHIM, "0:ability", `cannot pick ${label}; a character pick works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = seraphimBoard({ extra });
    const before = ready(bad.engine);
    refused(() => smRaw(bad, key), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = seraphimBoard({ extra });
    smPlay(good, "m0");
    assert.equal(good.engine.getStat(good.id("m0"), "strength"), 4, "control: a character in play can be picked");
  });
}

clause(SERAPHIM, "0:ability", "cannot pick a faction (CR 202.9), and needs exactly one pick: none and two are refused", () => {
  const faction = seraphimBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("sm"), { selected: { c: [factionOf(faction.engine, P1)] } }), "my faction");
  refused(() => smRaw(faction, undefined), "no pick");
  refused(() => playRaw(faction.engine, P1, faction.id("sm"), { selected: { c: [faction.id("m0"), faction.id("m1")] } }), "two picks");
  assert.equal(zoneOf(faction.engine, faction.id("sm")), "hand");
});

clause(SERAPHIM, "0:ability", "if the picked character leaves play in response, I still draw a card (CR 402.5) and Seraphim Magic still resolves", () => {
  const g = seraphimBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  smRaw(g, "m0");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("m0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.ok(handOf(g.engine, P1).includes(top), "the card is still drawn");
  assert.equal(zoneOf(g.engine, g.id("sm")), "discard");
  assert.equal(g.engine.getStat(g.id("m1"), "strength"), 1, "no one else got the bonus");
});

clause(SERAPHIM, "0:ability", "with an empty deck nothing is drawn, the bonus still applies and the game goes on (CR 102.1a)", () => {
  const g = seraphimBoard({ deck: 0 });
  smPlay(g, "m0");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.result, undefined);
});

clause(SERAPHIM, "0:ability", "a tactic: it goes to my discard pile once resolved, and can be played in response on the opponent's turn", () => {
  const g = seraphimBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("o0")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  smRaw(g, "m0");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sm")), "discard");
  assert.equal(g.engine.getStat(g.id("m0"), "strength"), 4);
});

// --- Spitting Sarume ------------------------------------------------------------
// When this card enters play, inflict 1 damage to all characters your opponent controls.
// FLIP UP: 3 [R]
// Character, cost 5, [R], 3 strength / 3 speed / 2 life. dragon.

const SPITTING = "47d63dba-085e-4cbc-ab0c-ecdbe65fded0";
const SPITTING_SPEC: FlipSpec = { cost: 5, flip: 3, strength: 3, speed: 3, life: 2 };

function spittingBoard(
  opts: {
    zone?: "hand" | "play";
    faceDown?: boolean;
    rage?: number;
    greed?: number;
    foes?: boolean;
    extra?: CardPlacement[];
    game?: Parameters<typeof buildGame>[0];
  } = {}
) {
  const zone = opts.zone ?? "hand";
  return devBoard(
    [
      { key: "sar", def: printing(SPITTING), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      ...(opts.foes === false
        ? []
        : [
            { key: "o0", def: character({ name: "Theirs 0", life: 3 }), owner: P2, zone: "play" as const },
            { key: "o1", def: character({ name: "Theirs 1", life: 3 }), owner: P2, zone: "play" as const },
            { key: "o2", def: character({ name: "Theirs Frail", life: 1 }), owner: P2, zone: "play" as const }
          ]),
      { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
      // owned by me, controlled by the opponent: THEIR character
      { key: "myStolen", def: character({ name: "My Stolen", life: 3 }), owner: P1, controller: P2, zone: "play" },
      // owned by the opponent, controlled by me: MY character
      { key: "theirCaptured", def: character({ name: "Their Captured", life: 3 }), owner: P2, controller: P1, zone: "play" },
      { key: "oItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "oPlace", def: location({ name: "Their Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "oFd", def: character({ name: "Their Face Down", life: 1 }), owner: P2, zone: "play", faceDown: true },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

const sarDeploy = (g: Game): void => playAndResolve(g.engine, P1, g.id("sar"));

clause(SPITTING, "0:rule", "when it enters play (deployed), each character my opponent controls takes exactly 1 damage", () => {
  const g = spittingBoard();
  sarDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("sar")), "play");
  assert.equal(damageOf(g.engine, g.id("o0")), 1);
  assert.equal(damageOf(g.engine, g.id("o1")), 1);
  assert.equal(zoneOf(g.engine, g.id("o2")), "discard", "1 damage destroys a 1-life character");
  assert.equal(g.engine.state.pendingChoice, undefined, "no choice is involved");
});

clause(SPITTING, "0:rule", "'controls', not 'owns': a character I own but the opponent controls takes the damage", () => {
  const g = spittingBoard();
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("myStolen")), 1);
});

clause(SPITTING, "0:rule", "my own characters take nothing: not my ally, not the Sarume itself, and not a character the opponent owns but I control", () => {
  const g = spittingBoard();
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
  assert.equal(damageOf(g.engine, g.id("sar")), 0, "the Sarume does not hurt itself");
  assert.equal(damageOf(g.engine, g.id("theirCaptured")), 0, "owned by them but controlled by me");
});

clause(SPITTING, "0:rule", "only characters: their item, location, face-down card and faction are untouched", () => {
  const g = spittingBoard();
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("oItem")), 0);
  assert.equal(damageOf(g.engine, g.id("oPlace")), 0, "a location takes no damage from it");
  assert.equal(zoneOf(g.engine, g.id("oFd")), "play", "a face-down card is only a resource (CR 411.1), not a character");
  assert.equal(damageOf(g.engine, g.id("oFd")), 0);
  assert.equal(influenceOf(g.engine, P2), 30, "the faction is not a character");
});

clause(SPITTING, "0:rule", "with no opposing characters nothing happens and nothing is asked", () => {
  const g = spittingBoard({ foes: false });
  sarDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("sar")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
});

clause(SPITTING, "0:rule", "the damage adds to damage already taken: a 3-life character that took 2 earlier is destroyed by the 1", () => {
  const g = spittingBoard({ extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("o0")] } });
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
  sarDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play", "its neighbour only took 1");
});

clause(SPITTING, "0:rule", "it fires once: 1 damage, not 1 per opposing card, and it does not fire again at my next turn", () => {
  const g = spittingBoard({ extra: [{ key: "o3", def: character({ name: "Theirs 3", life: 9 }), owner: P2, zone: "play" }] });
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("o3")), 1);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(damageOf(g.engine, g.id("o3")), 0, "damage heals at the start of a turn and nothing hit it again");
});

clause(SPITTING, "0:rule", "it is the Sarume's OWN entering play only: deploying another character afterwards does not repeat the damage", () => {
  const g = spittingBoard({
    extra: [{ key: "o3", def: character({ name: "Theirs 3", life: 9 }), owner: P2, zone: "play" }, { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }]
  });
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("o3")), 1);
  playAndResolve(g.engine, P1, g.id("plain"));
  assert.equal(damageOf(g.engine, g.id("o3")), 1, "still 1");
});

clause(SPITTING, "0:rule", "a second Sarume entering play triggers only itself: the first one already in play does not add damage", () => {
  const g = spittingBoard({ extra: [{ key: "o3", def: character({ name: "Theirs 3", life: 9 }), owner: P2, zone: "play" }, { key: "sar2", def: printing(SPITTING), owner: P1, zone: "play" }] });
  sarDeploy(g);
  assert.equal(damageOf(g.engine, g.id("o3")), 1, "one Sarume entered play, one damage");
});

clause(SPITTING, "0:rule", "it triggers however it enters play: put into play from my discard pile by an effect", () => {
  const g = spittingBoard({
    zone: "hand",
    extra: [
      { key: "back", def: printing(SPITTING), owner: P1, zone: "discard" },
      { key: "pip", def: putIntoPlayTactic("character"), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("back")] } });
  assert.equal(zoneOf(g.engine, g.id("back")), "play");
  assert.equal(damageOf(g.engine, g.id("o0")), 1);
  assert.equal(damageOf(g.engine, g.id("o1")), 1);
});

clause(SPITTING, "0:rule", "it triggers when flipped up (it enters play as a new card, CR 411.3)", () => {
  const g = spittingBoard({ zone: "play", rage: 1, greed: 3 });
  flipUpRaw(g.engine, P1, g.id("sar"));
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("sar")), false);
  assert.equal(damageOf(g.engine, g.id("o0")), 1);
  assert.equal(damageOf(g.engine, g.id("o1")), 1);
  assert.equal(zoneOf(g.engine, g.id("o2")), "discard");
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
});

clause(SPITTING, "0:rule", "played face-down as a resource it is only a resource (CR 411.1): entering play that way damages nothing", () => {
  const g = spittingBoard({ zone: "hand" });
  developResource(g.engine, P1, g.id("sar"), true);
  assert.equal(zoneOf(g.engine, g.id("sar")), "play");
  assert.equal(isFaceDown(g.engine, g.id("sar")), true);
  assert.equal(damageOf(g.engine, g.id("o0")), 0);
  assert.equal(damageOf(g.engine, g.id("o1")), 0);
  assert.equal(zoneOf(g.engine, g.id("o2")), "play");
});

clause(SPITTING, "0:rule", "the opponent's Sarume hurts the characters THEIR opponent (me) controls, and not their own", () => {
  const g = devBoard(
    [
      { key: "sar", def: printing(SPITTING), owner: P2, zone: "hand" },
      { key: "mine0", def: character({ name: "Mine 0", life: 3 }), owner: P1, zone: "play" },
      { key: "mine1", def: character({ name: "Mine 1", life: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  playAndResolve(g.engine, P2, g.id("sar"));
  assert.equal(damageOf(g.engine, g.id("mine0")), 1);
  assert.equal(zoneOf(g.engine, g.id("mine1")), "discard");
  assert.equal(damageOf(g.engine, g.id("theirs")), 0);
});

clause(SPITTING, "0:rule", "it deploys for its printed cost of 5 with [R]: four resources are refused, no [R] is refused", () => {
  const short = spittingBoard({ rage: 1, greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("sar")), "four resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("sar")), "hand");
  assert.equal(damageOf(short.engine, short.id("o0")), 0, "nothing triggered");
  const noRage = spittingBoard({ rage: 0, greed: 8 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("sar")), "no [R]");
  const good = spittingBoard({ rage: 1, greed: 4 });
  const before = ready(good.engine);
  sarDeploy(good);
  assert.equal(before - ready(good.engine), 5);
});

clause(SPITTING, "0:rule", "it has its printed 3 strength / 3 speed / 2 life", () => {
  const g = spittingBoard();
  sarDeploy(g);
  assert.equal(g.engine.getStat(g.id("sar"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("sar"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("sar"), "life"), 2);
  assert.ok(printing(SPITTING).subtype?.includes("dragon"), "printing(SPITTING).subtype?.includes(\"dragon\")");
});

clause(SPITTING, "1:flipUp", "a face-down Spitting Sarume flips up into a face-up character with its printed 3/3/2 stats", () => flipFaceUpStats(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "flipping up pays exactly 3 (not its cost of 5)", () => flipPaysExactly(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "the Sarume may pay for its own FLIP UP (CR 507.4b): [R], one more resource and itself are exactly 3", () => flipCanPayForItself(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "is refused one resource short: a spent [R], one Greed and the face-down Sarume itself make only 2", () => flipOneShort(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "needs [R]: plenty of Greed and no Rage is refused", () => flipNeedsRage(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "its own face-down Volition, other Volition and the opponent's Rage are not my [R]", () => flipNotVolition(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "a spent [R] still meets the threshold, while other resources pay the 3", () => flipSpentRage(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn (CR 507.4d)", () => flipNotOnTheirTurn(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "FLIP UP does not change WHEN a character can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => flipNotInResponse(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "the flipped-up Sarume is a new arrival: it cannot attack the turn it flipped", () => flipNewArrival(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "only a face-down Sarume I control in play can be flipped up (not face-up, not in hand, not the opponent's)", () => flipNotFromElsewhere(SPITTING, SPITTING_SPEC));
clause(SPITTING, "1:flipUp", "FLIP UP is an alternative: deployed from the hand the Sarume costs its printed 5 with [R]", () => flipIsAlternative(SPITTING, SPITTING_SPEC));

// --- Tiny Sarume ----------------------------------------------------------------
// FLIP UP: 0 [R]
// Character, cost 0, [R], 1 strength / 3 speed / 1 life. dragon.

const TINY = "1b403626-3a9d-4d09-a919-0fe1a6f5077a";
const TINY_SPEC: FlipSpec = { cost: 0, flip: 0, strength: 1, speed: 3, life: 1 };

clause(TINY, "0:flipUp", "a face-down Tiny Sarume flips up into a face-up character with its printed 1/3/1 stats", () => flipFaceUpStats(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "flipping up pays nothing at all (FLIP UP 0): the ready resources are all still there", () => flipPaysExactly(TINY, TINY_SPEC));

clause(TINY, "0:flipUp", "with a single Rage and nothing else, it flips up for free: that Rage stays ready", () => {
  const g = flipBoard(TINY, { rage: 1 });
  assert.equal(ready(g.engine), 2, "the Rage and the face-down card");
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("c")), false);
  assert.equal(ready(g.engine), 1, "only the face-down card stopped being a resource; nothing was paid");
  assert.equal(attachedCount(g.engine, P1), 0, "no resource was attached to the faction");
});

clause(TINY, "0:flipUp", "needs [R]: plenty of Greed and no Rage is refused", () => flipNeedsRage(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "its own face-down Volition, other Volition and the opponent's Rage are not my [R]", () => flipNotVolition(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "a spent [R] still meets the threshold, so with no ready resource at all except itself it flips up", () => {
  const g = flipBoard(TINY, { spentRage: 1 });
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("c")), false);
});
clause(TINY, "0:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn (CR 507.4d)", () => flipNotOnTheirTurn(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "FLIP UP does not change WHEN a character can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => flipNotInResponse(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "the flipped-up Tiny Sarume is a new arrival: it cannot attack the turn it flipped", () => flipNewArrival(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "only a face-down Tiny Sarume I control in play can be flipped up (not face-up, not in hand, not the opponent's)", () => flipNotFromElsewhere(TINY, TINY_SPEC));
clause(TINY, "0:flipUp", "FLIP UP is an alternative: deployed from the hand it costs its printed 0 and still needs [R]", () => {
  flipIsAlternative(TINY, TINY_SPEC);
  const noRage = flipBoard(TINY, { zone: "hand", rage: 0, greed: 5 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("c")), "no [R]");
  assert.equal(zoneOf(noRage.engine, noRage.id("c")), "hand");
});
clause(TINY, "0:flipUp", "a flipped-up Tiny Sarume has 1 life: 1 damage destroys it, and 1 strength: it hits a faction for 1", () => {
  const g = flipBoard(TINY, { rage: 1, extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("c")), "discard");
  const hit = devBoard([{ key: "c", def: printing(TINY), owner: P1, zone: "play" }]);
  fight(hit, [hit.id("c")], undefined, []);
  assert.equal(influenceOf(hit.engine, P2), 29);
});

// --- Trebuchet Officer ----------------------------------------------------------
// FIRE! -- COST: Pay 1. Pick a location. -- EFFECT: Inflict 1 damage to the location.
// Character, cost 4, [R][R], 3 strength / 3 speed / 3 life. soldier.

const TREBUCHET = "9123e4dc-f84a-4d88-aae7-bb6cf97a4194";

function trebBoard(
  opts: { rage?: number; greed?: number; depleted?: boolean; fresh?: boolean; zone?: "play" | "hand" | "discard"; faceDown?: boolean; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}
) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "to", def: printing(TREBUCHET), owner: P1, zone, depleted: opts.depleted, attackEligible: opts.fresh ? false : undefined, faceDown: zone === "play" ? opts.faceDown : undefined },
      { key: "theirPlace", def: location({ name: "Their Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "My Place", structure: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

const trebRaw = (g: Game, target: string | undefined, player: PlayerId = P1): void =>
  actRaw(g.engine, player, g.id("to"), "fire", target === undefined ? {} : { l: [g.id(target)] });

function trebFire(g: Game, target: string): void {
  trebRaw(g, target);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
}

/** A free tactic (id "dl", pick "t"): destroys one picked location. */
function destroyLocationTactic(): CardDefinition {
  return tactic({
    name: "Destroy Location",
    cost: 0,
    behavior: {
      abilities: [{ id: "dl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

clause(TREBUCHET, "0:ability:fire", "pays exactly 1 and inflicts exactly 1 damage to the picked location (the opponent's)", () => {
  const g = trebBoard();
  const before = ready(g.engine);
  trebFire(g, "theirPlace");
  assert.equal(before - ready(g.engine), 1, "Pay 1");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
  assert.equal(damageOf(g.engine, g.id("myPlace")), 0);
});

clause(TREBUCHET, "0:ability:fire", "it may pick any location, mine included", () => {
  const g = trebBoard();
  trebFire(g, "myPlace");
  assert.equal(damageOf(g.engine, g.id("myPlace")), 1);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
});

clause(TREBUCHET, "0:ability:fire", "the damage is 1 whatever the Officer's strength: it is not 3", () => {
  const g = trebBoard();
  trebFire(g, "theirPlace");
  assert.equal(g.engine.getStat(g.id("to"), "strength"), 3);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
});

clause(TREBUCHET, "0:ability:fire", "damage markers accumulate: three FIRE!s on a structure-3 location destroy it, two do not", () => {
  const g = trebBoard({ rage: 6 });
  trebFire(g, "theirPlace");
  trebFire(g, "theirPlace");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 2);
  assert.equal(zoneOf(g.engine, g.id("theirPlace")), "play");
  trebFire(g, "theirPlace");
  assert.equal(zoneOf(g.engine, g.id("theirPlace")), "discard", "3 damage markers destroy a structure-3 location");
  assert.equal(ready(g.engine), 3, "each use cost exactly 1");
});

clause(TREBUCHET, "0:ability:fire", "location damage persists to the next turn", () => {
  const g = trebBoard();
  trebFire(g, "theirPlace");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1, "markers on a location stay");
  trebFire(g, "theirPlace");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 2);
});

for (const [key, label] of [
  ["ally", "my own character"],
  ["foe", "an opposing character"],
  ["thing", "an item"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a location card in my hand (CR 402.3)"],
  ["inDiscard", "a location card in my discard pile (CR 402.3)"],
  ["theirHand", "a location card in the opponent's hand"]
] as const) {
  clause(TREBUCHET, "0:ability:fire", `cannot pick ${label}; a location pick works on the same board and nothing is paid for the refusal`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: location({ name: "Face Down Place" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: location({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: location({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: location({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = trebBoard({ extra });
    const before = ready(bad.engine);
    refused(() => trebRaw(bad, key), `picking ${label}`);
    assert.equal(ready(bad.engine), before, "nothing was paid");
    assert.equal(damageOf(bad.engine, bad.id("foe")), 0);
    assert.equal(damageOf(bad.engine, bad.id("ally")), 0);
    const good = trebBoard({ extra });
    trebFire(good, "theirPlace");
    assert.equal(damageOf(good.engine, good.id("theirPlace")), 1, "control: a location in play can be picked");
  });
}

clause(TREBUCHET, "0:ability:fire", "cannot pick a faction (CR 202.9), and needs exactly one location: none and two are refused", () => {
  const g = trebBoard();
  refused(() => actRaw(g.engine, P1, g.id("to"), "fire", { l: [factionOf(g.engine, P2)] }), "their faction");
  assert.equal(influenceOf(g.engine, P2), 30);
  refused(() => trebRaw(g, undefined), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("to"), "fire", { l: [g.id("theirPlace"), g.id("myPlace")] }), "two picks");
  assert.equal(ready(g.engine), 4, "nothing was paid by any refusal");
});

clause(TREBUCHET, "0:ability:fire", "it needs 1 ready resource: none, or only spent ones, is refused; exactly 1 works", () => {
  const none = trebBoard({ rage: 0 });
  refused(() => trebRaw(none, "theirPlace"), "no resources");
  assert.equal(damageOf(none.engine, none.id("theirPlace")), 0);
  const spentOnly = trebBoard({ rage: 0, extra: spent("rage", 3) });
  refused(() => trebRaw(spentOnly, "theirPlace"), "only spent resources");
  const one = trebBoard({ rage: 1 });
  trebFire(one, "theirPlace");
  assert.equal(damageOf(one.engine, one.id("theirPlace")), 1);
  assert.equal(ready(one.engine), 0);
});

clause(TREBUCHET, "0:ability:fire", "FIRE! has no threshold of its own: Greed alone pays for it", () => {
  const g = trebBoard({ rage: 0, greed: 2 });
  trebFire(g, "theirPlace");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
});

clause(TREBUCHET, "0:ability:fire", "no deplete in the cost: a depleted Officer can use FIRE! and stays depleted, and a ready one is not depleted by it", () => {
  const g = trebBoard({ depleted: true });
  trebFire(g, "theirPlace");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
  assert.equal(isDepleted(g.engine, g.id("to")), true, "FIRE! neither restores nor depletes it");
  const rdy = trebBoard();
  trebFire(rdy, "theirPlace");
  assert.equal(isDepleted(rdy.engine, rdy.id("to")), false);
});

clause(TREBUCHET, "0:ability:fire", "abilities work the first turn a character is in play (CR 204.3a): an Officer that cannot attack yet can FIRE!", () => {
  const g = trebBoard({ fresh: true });
  trebFire(g, "theirPlace");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
});

clause(TREBUCHET, "0:ability:fire", "it can be used any number of times in a turn, paying 1 each time", () => {
  const g = trebBoard({ rage: 4, extra: [{ key: "big", def: location({ name: "Big", structure: 9 }), owner: P2, zone: "play" }] });
  for (let i = 0; i < 4; i++) trebFire(g, "big");
  assert.equal(damageOf(g.engine, g.id("big")), 4);
  assert.equal(ready(g.engine), 0);
});

clause(TREBUCHET, "0:ability:fire", "an Officer in my hand or my discard pile cannot FIRE!", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = trebBoard({ zone });
    refused(() => trebRaw(g, "theirPlace"), `FIRE! from ${zone}`);
    assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
  }
});

clause(TREBUCHET, "0:ability:fire", "a face-down Officer is only a resource and has no abilities", () => {
  const g = trebBoard({ faceDown: true });
  refused(() => trebRaw(g, "theirPlace"), "FIRE! from a face-down card");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
});

clause(TREBUCHET, "0:ability:fire", "only its controller can use it: the opponent cannot FIRE! my Officer", () => {
  const g = trebBoard({ extra: bank("rage", 3, P2) });
  declareAttackOpenWindow(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.priorityPlayerId, P2, "the opponent holds priority");
  refused(() => trebRaw(g, "myPlace", P2), "the opponent using my Officer", /control|own|cannot|illegal|only|activate/i);
  assert.equal(damageOf(g.engine, g.id("myPlace")), 0);
});

clause(TREBUCHET, "0:ability:fire", "an ability, so it can be used in response on the opponent's turn", () => {
  const g = trebBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  trebRaw(g, "theirPlace");
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 1);
});

clause(TREBUCHET, "0:ability:fire", "if the picked location is destroyed in response, the cost stays paid and nothing else is damaged (CR 402.5a)", () => {
  const g = trebBoard({ extra: [{ key: "kill", def: destroyLocationTactic(), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  trebRaw(g, "theirPlace");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("theirPlace")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("theirPlace")), "discard");
  assert.equal(before - ready(g.engine), 1);
  assert.equal(damageOf(g.engine, g.id("myPlace")), 0);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(TREBUCHET, "0:ability:fire", "the Officer deploys for its printed cost 4 with [R][R] and has its printed 3/3/3 stats", () => {
  const good = devBoard([{ key: "to", def: printing(TREBUCHET), owner: P1, zone: "hand" }, ...bank("rage", 2, P1), ...bank("greed", 2, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("to"));
  assert.equal(zoneOf(good.engine, good.id("to")), "play");
  assert.equal(before - ready(good.engine), 4);
  assert.equal(good.engine.getStat(good.id("to"), "strength"), 3);
  assert.equal(good.engine.getStat(good.id("to"), "speed"), 3);
  assert.equal(good.engine.getStat(good.id("to"), "life"), 3);
  const oneRage = devBoard([{ key: "to", def: printing(TREBUCHET), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 5, P1)]);
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("to")), "one [R]");
  const short = devBoard([{ key: "to", def: printing(TREBUCHET), owner: P1, zone: "hand" }, ...bank("rage", 2, P1), ...bank("greed", 1, P1)]);
  refused(() => playRaw(short.engine, P1, short.id("to")), "three resources for a cost of 4");
});

// --- Unflinching Bowman ---------------------------------------------------------
// SHOOT -- COST: Pay 1. Pick a character. -- EFFECT: Inflict 1 damage to the character.
// Inflict 1 damage to this card.
// Character, cost 5, [R], 2 strength / 3 speed / 2 life. soldier.

const BOWMAN = "1b64b6c4-8b37-4b00-a78f-cdb82d53f038";

function bowBoard(opts: { rage?: number; greed?: number; depleted?: boolean; fresh?: boolean; zone?: "play" | "hand" | "discard"; faceDown?: boolean; damage?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "bw", def: printing(BOWMAN), owner: P1, zone, depleted: opts.depleted, damage: opts.damage, attackEligible: opts.fresh ? false : undefined, faceDown: zone === "play" ? opts.faceDown : undefined },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak Foe", life: 1 }), owner: P2, zone: "play" },
      { key: "myStolen", def: character({ name: "My Stolen", life: 9 }), owner: P1, controller: P2, zone: "play" },
      { key: "theirCaptured", def: character({ name: "Their Captured", life: 9 }), owner: P2, controller: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

const bowRaw = (g: Game, target: string | undefined, player: PlayerId = P1): void =>
  actRaw(g.engine, player, g.id("bw"), "shoot", target === undefined ? {} : { c: [g.id(target)] });

function bowShoot(g: Game, target: string): void {
  bowRaw(g, target);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(BOWMAN, "0:ability:shoot", "pays exactly 1, inflicts 1 damage to the picked character AND 1 damage to the Bowman", () => {
  const g = bowBoard();
  const before = ready(g.engine);
  bowShoot(g, "foe");
  assert.equal(before - ready(g.engine), 1, "Pay 1");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
  assert.equal(damageOf(g.engine, g.id("bw")), 1, "Inflict 1 damage to this card");
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
  assert.equal(damageOf(g.engine, g.id("weak")), 0);
});

clause(BOWMAN, "0:ability:shoot", "'a character': mine, theirs, one I own but they control, one they own but I control can all be picked", () => {
  for (const key of ["ally", "foe", "myStolen", "theirCaptured"]) {
    const g = bowBoard();
    bowShoot(g, key);
    assert.equal(damageOf(g.engine, g.id(key)), 1, `${key} took 1`);
    assert.equal(damageOf(g.engine, g.id("bw")), 1, "and so did the Bowman");
  }
});

clause(BOWMAN, "0:ability:shoot", "the Bowman may pick itself (it is a character): it takes 1 as the picked character and 1 as 'this card', and is destroyed (2 life)", () => {
  const g = bowBoard();
  bowShoot(g, "bw");
  assert.equal(zoneOf(g.engine, g.id("bw")), "discard", "2 damage destroys a 2-life Bowman");
  assert.equal(ready(g.engine), 3);
});

clause(BOWMAN, "0:ability:shoot", "the damage to the picked character destroys it at its life: a 1-life character is destroyed", () => {
  const g = bowBoard();
  bowShoot(g, "weak");
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard");
  assert.equal(zoneOf(g.engine, g.id("bw")), "play");
  assert.equal(damageOf(g.engine, g.id("bw")), 1);
});

clause(BOWMAN, "0:ability:shoot", "the Bowman is destroyed when its damage reaches its life: the second SHOOT in a turn destroys it (and still hits)", () => {
  const g = bowBoard();
  bowShoot(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("bw")), "play");
  bowShoot(g, "foe");
  assert.equal(damageOf(g.engine, g.id("foe")), 2, "both shots landed");
  assert.equal(zoneOf(g.engine, g.id("bw")), "discard", "2 damage this turn destroys the Bowman");
});

clause(BOWMAN, "0:ability:shoot", "a Bowman that already took 1 damage this turn is destroyed by SHOOT's 1 damage to itself", () => {
  const g = bowBoard({ damage: 1 });
  bowShoot(g, "foe");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
  assert.equal(zoneOf(g.engine, g.id("bw")), "discard");
});

clause(BOWMAN, "0:ability:shoot", "the Bowman's damage heals at the start of the next turn, so it can shoot again", () => {
  const g = bowBoard();
  bowShoot(g, "foe");
  assert.equal(damageOf(g.engine, g.id("bw")), 1);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(damageOf(g.engine, g.id("bw")), 0);
  bowShoot(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("bw")), "play");
  assert.equal(damageOf(g.engine, g.id("bw")), 1);
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(BOWMAN, "0:ability:shoot", `cannot pick ${label}; a character pick works on the same board and nothing is paid for the refusal`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = bowBoard({ extra });
    const before = ready(bad.engine);
    refused(() => bowRaw(bad, key), `picking ${label}`);
    assert.equal(ready(bad.engine), before, "nothing was paid");
    assert.equal(damageOf(bad.engine, bad.id("bw")), 0, "the Bowman did not hurt itself");
    const good = bowBoard({ extra });
    bowShoot(good, "foe");
    assert.equal(damageOf(good.engine, good.id("foe")), 1, "control: a character in play can be picked");
  });
}

clause(BOWMAN, "0:ability:shoot", "cannot pick a faction (CR 202.9), and needs exactly one character: none and two are refused", () => {
  const g = bowBoard();
  refused(() => actRaw(g.engine, P1, g.id("bw"), "shoot", { c: [factionOf(g.engine, P2)] }), "their faction");
  assert.equal(influenceOf(g.engine, P2), 30);
  refused(() => bowRaw(g, undefined), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("bw"), "shoot", { c: [g.id("foe"), g.id("ally")] }), "two picks");
  assert.equal(ready(g.engine), 4);
  assert.equal(damageOf(g.engine, g.id("bw")), 0);
});

clause(BOWMAN, "0:ability:shoot", "it needs 1 ready resource: none, or only spent ones, is refused; exactly 1 works", () => {
  const none = bowBoard({ rage: 0 });
  refused(() => bowRaw(none, "foe"), "no resources");
  assert.equal(damageOf(none.engine, none.id("bw")), 0);
  const spentOnly = bowBoard({ rage: 0, extra: spent("rage", 3) });
  refused(() => bowRaw(spentOnly, "foe"), "only spent resources");
  const one = bowBoard({ rage: 1 });
  bowShoot(one, "foe");
  assert.equal(damageOf(one.engine, one.id("foe")), 1);
  assert.equal(ready(one.engine), 0);
});

clause(BOWMAN, "0:ability:shoot", "SHOOT has no threshold: Greed alone pays for it", () => {
  const g = bowBoard({ rage: 0, greed: 1 });
  bowShoot(g, "foe");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(BOWMAN, "0:ability:shoot", "no deplete in the cost: a depleted Bowman can SHOOT, and a ready one stays ready", () => {
  const dep = bowBoard({ depleted: true });
  bowShoot(dep, "foe");
  assert.equal(damageOf(dep.engine, dep.id("foe")), 1);
  assert.equal(isDepleted(dep.engine, dep.id("bw")), true);
  const rdy = bowBoard();
  bowShoot(rdy, "foe");
  assert.equal(isDepleted(rdy.engine, rdy.id("bw")), false);
});

clause(BOWMAN, "0:ability:shoot", "abilities work the first turn a character is in play (CR 204.3a): a Bowman that cannot attack yet can SHOOT", () => {
  const g = bowBoard({ fresh: true });
  bowShoot(g, "foe");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(BOWMAN, "0:ability:shoot", "if the picked character is destroyed in response, the Bowman still takes its own 1 damage (CR 402.5) and the cost stays paid", () => {
  const g = bowBoard({ extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  bowRaw(g, "foe");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("foe")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(damageOf(g.engine, g.id("bw")), 1, "'Inflict 1 damage to this card' still happens");
  assert.equal(before - ready(g.engine), 1);
});

clause(BOWMAN, "0:ability:shoot", "a Bowman in my hand, in my discard pile, or face-down cannot SHOOT", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = bowBoard({ zone });
    refused(() => bowRaw(g, "foe"), `SHOOT from ${zone}`);
    assert.equal(damageOf(g.engine, g.id("foe")), 0);
  }
  const faceDown = bowBoard({ faceDown: true });
  refused(() => bowRaw(faceDown, "foe"), "SHOOT from a face-down card");
});

clause(BOWMAN, "0:ability:shoot", "only its controller can use it, and it can be used in response on the opponent's turn", () => {
  const theirs = bowBoard({ extra: bank("rage", 3, P2) });
  declareAttackOpenWindow(theirs.engine, P1, [theirs.id("ally")]);
  assert.equal(theirs.engine.state.priorityPlayerId, P2);
  refused(() => bowRaw(theirs, "foe", P2), "the opponent using my Bowman", /control|own|cannot|illegal|only|activate/i);
  assert.equal(damageOf(theirs.engine, theirs.id("foe")), 0);
  const response = bowBoard({ game: { turn: 2, activePlayerId: P2 } });
  declareAttackOpenWindow(response.engine, P2, [response.id("foe")]);
  assert.equal(response.engine.state.priorityPlayerId, P1);
  bowRaw(response, "foe");
  resolvePendingResponses(response.engine);
  assert.equal(damageOf(response.engine, response.id("foe")), 1);
});

clause(BOWMAN, "0:ability:shoot", "the Bowman deploys for its printed cost 5 with [R] and has its printed 2/3/2 stats", () => {
  const good = devBoard([{ key: "bw", def: printing(BOWMAN), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 4, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("bw"));
  assert.equal(zoneOf(good.engine, good.id("bw")), "play");
  assert.equal(before - ready(good.engine), 5);
  assert.equal(good.engine.getStat(good.id("bw"), "strength"), 2);
  assert.equal(good.engine.getStat(good.id("bw"), "speed"), 3);
  assert.equal(good.engine.getStat(good.id("bw"), "life"), 2);
  const short = devBoard([{ key: "bw", def: printing(BOWMAN), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 3, P1)]);
  refused(() => playRaw(short.engine, P1, short.id("bw")), "four resources for a cost of 5");
  const noRage = devBoard([{ key: "bw", def: printing(BOWMAN), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]);
  refused(() => playRaw(noRage.engine, P1, noRage.id("bw")), "no [R]");
});

// --- Vigilant Raider ------------------------------------------------------------
// ASSAIL -- COST: Pay 2. -- EFFECT: This turn, this card gains 1 strength.
// Character, cost 5, [R][R], 4 strength / 3 speed / 4 life. soldier.

const RAIDER = "b018e5a3-1786-45ac-880a-7820b75c40aa";

function raiderBoard(opts: { rage?: number; greed?: number; depleted?: boolean; fresh?: boolean; zone?: "play" | "hand" | "discard"; faceDown?: boolean; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "rd", def: printing(RAIDER), owner: P1, zone, depleted: opts.depleted, attackEligible: opts.fresh ? false : undefined, faceDown: zone === "play" ? opts.faceDown : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

const assailRaw = (g: Game, player: PlayerId = P1): void => actRaw(g.engine, player, g.id("rd"), "assail");

function assail(g: Game): void {
  assailRaw(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(RAIDER, "0:ability:assail", "pays exactly 2 and this card gains 1 strength this turn: 4 -> 5", () => {
  const g = raiderBoard();
  const before = ready(g.engine);
  assail(g);
  assert.equal(before - ready(g.engine), 2, "Pay 2");
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 5);
});

clause(RAIDER, "0:ability:assail", "only strength and only the Raider: its life and speed, and every other character, are unchanged", () => {
  const g = raiderBoard();
  assail(g);
  assert.equal(g.engine.getStat(g.id("rd"), "life"), 4);
  assert.equal(g.engine.getStat(g.id("rd"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 1);
});

clause(RAIDER, "0:ability:assail", "it can be used repeatedly and stacks: three uses pay 6 and give +3 (4 -> 7)", () => {
  const g = raiderBoard({ rage: 6 });
  assail(g);
  assail(g);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 6);
  assail(g);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 7);
  assert.equal(ready(g.engine), 0);
});

clause(RAIDER, "0:ability:assail", "'This turn': the bonus is gone once the turn ends", () => {
  const g = raiderBoard();
  assail(g);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 5);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 4);
});

clause(RAIDER, "0:ability:assail", "the bonus lasts the whole turn: an attack later this turn is made with 5 strength", () => {
  const g = raiderBoard();
  assail(g);
  fight(g, [g.id("rd")], undefined, []);
  assert.equal(influenceOf(g.engine, P2), 25, "5 battle damage to the faction");
});

clause(RAIDER, "0:ability:assail", "the bonus counts in battle: 5 strength destroys a 5-life blocker that 4 would not", () => {
  const plain = raiderBoard({ extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }] });
  fight(plain, [plain.id("rd")], undefined, ["wall"]);
  assert.equal(zoneOf(plain.engine, plain.id("wall")), "play", "4 damage does not destroy a 5-life blocker");
  const boosted = raiderBoard({ extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }] });
  assail(boosted);
  fight(boosted, [boosted.id("rd")], undefined, ["wall"]);
  assert.equal(zoneOf(boosted.engine, boosted.id("wall")), "discard", "5 damage does");
});

clause(RAIDER, "0:ability:assail", "it needs 2 ready resources: one, none, or only spent ones is refused; exactly 2 works", () => {
  const one = raiderBoard({ rage: 1 });
  refused(() => assailRaw(one), "one resource");
  assert.equal(one.engine.getStat(one.id("rd"), "strength"), 4);
  assert.equal(ready(one.engine), 1, "nothing was paid");
  const spentOnly = raiderBoard({ rage: 1, extra: spent("rage", 4) });
  refused(() => assailRaw(spentOnly), "one ready resource, four spent");
  const two = raiderBoard({ rage: 2 });
  assail(two);
  assert.equal(two.engine.getStat(two.id("rd"), "strength"), 5);
  assert.equal(ready(two.engine), 0);
});

clause(RAIDER, "0:ability:assail", "ASSAIL has no threshold: Greed alone pays for it", () => {
  const g = raiderBoard({ rage: 0, greed: 2 });
  assail(g);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 5);
});

clause(RAIDER, "0:ability:assail", "no deplete in the cost: a depleted Raider can ASSAIL, and the first turn in play too (CR 204.3a)", () => {
  const dep = raiderBoard({ depleted: true });
  assail(dep);
  assert.equal(dep.engine.getStat(dep.id("rd"), "strength"), 5);
  assert.equal(isDepleted(dep.engine, dep.id("rd")), true);
  const fresh = raiderBoard({ fresh: true });
  assail(fresh);
  assert.equal(fresh.engine.getStat(fresh.id("rd"), "strength"), 5);
  assert.equal(isDepleted(fresh.engine, fresh.id("rd")), false, "and it does not deplete the Raider");
});

clause(RAIDER, "0:ability:assail", "a Raider in my hand, in my discard pile, or face-down cannot ASSAIL", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = raiderBoard({ zone });
    refused(() => assailRaw(g), `ASSAIL from ${zone}`);
    assert.equal(ready(g.engine), 6, "nothing was paid");
  }
  const faceDown = raiderBoard({ faceDown: true });
  refused(() => assailRaw(faceDown), "ASSAIL from a face-down card");
});

clause(RAIDER, "0:ability:assail", "only its controller can use it", () => {
  const g = raiderBoard({ extra: bank("rage", 3, P2) });
  declareAttackOpenWindow(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(() => assailRaw(g, P2), "the opponent using my Raider", /control|own|cannot|illegal|only|activate/i);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 4);
});

clause(RAIDER, "0:ability:assail", "it can be used in response on the opponent's turn, and the bonus then lasts that turn: a blocking Raider deals 5", () => {
  const g = raiderBoard({
    game: { turn: 2, activePlayerId: P2 },
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  assailRaw(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("rd"), "strength"), 5);
  declareBlockers(g.engine, P1, [g.id("rd")]);
  autoResolveBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "5 damage destroys the 5-life attacker");
});

clause(RAIDER, "0:ability:assail", "the Raider deploys for its printed cost 5 with [R][R] and has its printed 4/3/4 stats", () => {
  const good = devBoard([{ key: "rd", def: printing(RAIDER), owner: P1, zone: "hand" }, ...bank("rage", 2, P1), ...bank("greed", 3, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("rd"));
  assert.equal(zoneOf(good.engine, good.id("rd")), "play");
  assert.equal(before - ready(good.engine), 5);
  assert.equal(good.engine.getStat(good.id("rd"), "strength"), 4);
  assert.equal(good.engine.getStat(good.id("rd"), "speed"), 3);
  assert.equal(good.engine.getStat(good.id("rd"), "life"), 4);
  const oneRage = devBoard([{ key: "rd", def: printing(RAIDER), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 6, P1)]);
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("rd")), "one [R]");
  const short = devBoard([{ key: "rd", def: printing(RAIDER), owner: P1, zone: "hand" }, ...bank("rage", 2, P1), ...bank("greed", 2, P1)]);
  refused(() => playRaw(short.engine, P1, short.id("rd")), "four resources for a cost of 5");
});

// --- Violence -------------------------------------------------------------------
// This card provides -- [R][R]
// When this card enters play, your faction loses 1 influence.
// Resource, cost 0.

function violenceBoard(
  opts: { zone?: "hand" | "play" | "discard"; faceDown?: boolean; spentVio?: boolean; owner?: PlayerId; influence?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0] } = {}
) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      {
        key: "vio",
        def: printing(VIOLENCE),
        owner,
        zone: opts.zone ?? "play",
        faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown : undefined,
        attachedToKey: opts.spentVio ? (owner === P1 ? "__factionA" : "__factionB") : undefined
      },
      ...fillers("d", 2, P1, "deck"),
      ...fillers("e", 2, P2, "deck"),
      ...(opts.extra ?? [])
    ],
    { ...(opts.influence !== undefined ? { playerA: { faction: developFaction(), influence: opts.influence } } : {}), ...opts.game }
  );
}

const iconsOf = (engine: SpoilsEngine, player: PlayerId): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [icon, n] of Object.entries(engine.getThresholds(player))) if ((n ?? 0) > 0) out[icon] = n ?? 0;
  return out;
};

clause(VIOLENCE, "0:rule", "in play face-up it provides exactly two Rage icons and nothing else", () => {
  const g = violenceBoard();
  assert.deepEqual(iconsOf(g.engine, P1), { rage: 2 });
});

clause(VIOLENCE, "0:rule", "it is one resource card: paying counts it once, so it can pay 1 but not 2", () => {
  const g = violenceBoard();
  assert.equal(ready(g.engine), 1);
  assert.equal(g.engine.isResource(g.id("vio")), true);
});

clause(VIOLENCE, "0:rule", "its two [R] meet a [R][R] threshold: Violence and two Greed deploy Nimble Conscript (cost 3, [R][R])", () => {
  const g = violenceBoard({ extra: [{ key: "nc", def: printing("1e3c2d25-0380-4d47-bd33-54b877476c3b"), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  playAndResolve(g.engine, P1, g.id("nc"));
  assert.equal(zoneOf(g.engine, g.id("nc")), "play", "[R][R] came from one Violence");
  assert.equal(ready(g.engine), 0, "all three resources paid the cost of 3");
});

clause(VIOLENCE, "0:rule", "two Violence provide [R][R][R][R]: they meet Mighty Ballista's threshold (cost 2, [R][R][R][R]) on their own", () => {
  const g = violenceBoard({
    extra: [
      { key: "vio2", def: printing(VIOLENCE), owner: P1, zone: "play" },
      { key: "mb", def: printing("d1ac8d42-b086-471a-8d66-e4ef475f9558"), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(iconsOf(g.engine, P1), { rage: 4 });
  playAndResolve(g.engine, P1, g.id("mb"));
  assert.equal(zoneOf(g.engine, g.id("mb")), "play");
  assert.equal(ready(g.engine), 0, "two resource cards paid the cost of 2");
});

clause(VIOLENCE, "0:rule", "one Violence is only [R][R]: it does not meet a [R][R][R][R] threshold even with other resources", () => {
  const g = violenceBoard({ extra: [{ key: "mb", def: printing("d1ac8d42-b086-471a-8d66-e4ef475f9558"), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  refused(() => playRaw(g.engine, P1, g.id("mb")), "only two [R]");
  assert.equal(zoneOf(g.engine, g.id("mb")), "hand");
});

clause(VIOLENCE, "0:rule", "Violence and a Rage make three [R] icons from two cards", () => {
  const g = violenceBoard({ extra: bank("rage", 1, P1) });
  assert.deepEqual(iconsOf(g.engine, P1), { rage: 3 });
  assert.equal(ready(g.engine), 2);
});

clause(VIOLENCE, "0:rule", "face-down it provides only Volition, not its [R][R]", () => {
  const g = violenceBoard({ faceDown: true });
  assert.deepEqual(iconsOf(g.engine, P1), { volition: 1 });
});

clause(VIOLENCE, "0:rule", "a spent (attached) Violence still provides [R][R] (icons are never spent, CR 405.6)", () => {
  const g = violenceBoard({ spentVio: true });
  assert.equal(ready(g.engine), 0, "it is spent");
  assert.deepEqual(iconsOf(g.engine, P1), { rage: 2 });
});

clause(VIOLENCE, "0:rule", "the opponent's Violence gives its icons to them, not to me", () => {
  const g = violenceBoard({ owner: P2 });
  assert.deepEqual(iconsOf(g.engine, P2), { rage: 2 });
  assert.deepEqual(iconsOf(g.engine, P1), {});
});

clause(VIOLENCE, "0:rule", "in my hand it provides nothing", () => {
  const g = violenceBoard({ zone: "hand" });
  assert.deepEqual(iconsOf(g.engine, P1), {});
  assert.equal(ready(g.engine), 0);
});

clause(VIOLENCE, "0:rule", "a resource is played, never deployed: playCard on Violence from my hand is refused", () => {
  const g = violenceBoard({ zone: "hand" });
  refused(() => playRaw(g.engine, P1, g.id("vio")), "deploying a resource card");
  assert.equal(zoneOf(g.engine, g.id("vio")), "hand");
});

clause(VIOLENCE, "0:rule", "played face-up by the Develop Rule it provides [R][R]; played face-down it provides Volition", () => {
  const up = violenceBoard({ zone: "hand" });
  developResource(up.engine, P1, up.id("vio"), false);
  assert.deepEqual(iconsOf(up.engine, P1), { rage: 2 });
  const down = violenceBoard({ zone: "hand" });
  developResource(down.engine, P1, down.id("vio"), true);
  assert.deepEqual(iconsOf(down.engine, P1), { volition: 1 });
});

// "When this card enters play, your faction loses 1 influence."

clause(VIOLENCE, "1:rule", "played face-up from my hand, my faction loses exactly 1 influence (30 -> 29), once", () => {
  const g = violenceBoard({ zone: "hand" });
  developResource(g.engine, P1, g.id("vio"), false);
  assert.equal(zoneOf(g.engine, g.id("vio")), "play");
  assert.equal(influenceOf(g.engine, P1), 29, "exactly 1, not 2");
  assert.equal(influenceOf(g.engine, P2), 30, "the opponent's faction is untouched");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(VIOLENCE, "1:rule", "'enters play' is not only 'is played as a resource': put into play from my discard pile by an effect it costs 1 influence", () => {
  const g = violenceBoard({ zone: "discard", extra: [{ key: "pip", def: putIntoPlayTactic("resource"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("vio")] } });
  assert.equal(zoneOf(g.engine, g.id("vio")), "play");
  assert.equal(isFaceDown(g.engine, g.id("vio")), false);
  assert.equal(influenceOf(g.engine, P1), 29);
});

clause(VIOLENCE, "1:rule", "played face-down it is only a Volition resource (CR 411.1) with no text: no influence is lost", () => {
  const g = violenceBoard({ zone: "hand" });
  developResource(g.engine, P1, g.id("vio"), true);
  assert.equal(zoneOf(g.engine, g.id("vio")), "play");
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(VIOLENCE, "1:rule", "'your faction': the opponent's Violence costs the OPPONENT 1 influence and mine nothing", () => {
  const g = violenceBoard({ zone: "hand", owner: P2, game: { turn: 2, activePlayerId: P2 } });
  developResource(g.engine, P2, g.id("vio"), false);
  assert.equal(influenceOf(g.engine, P2), 29);
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(VIOLENCE, "1:rule", "two Violence entering play cost 2 influence in all", () => {
  const g = violenceBoard({ zone: "hand", extra: [{ key: "vio2", def: printing(VIOLENCE), owner: P1, zone: "discard" }, { key: "pip", def: putIntoPlayTactic("resource"), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("vio"), false);
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("vio2")] } });
  assert.equal(influenceOf(g.engine, P1), 28);
});

clause(VIOLENCE, "1:rule", "it is only on entering play: a Violence already in play, another resource entering play, and Violence leaving play do not cost or refund influence", () => {
  const g = violenceBoard({ extra: [{ key: "res", def: resourceCard({ name: "Plain Resource" }), owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(influenceOf(g.engine, P1), 30, "starting in play costs nothing");
  developResource(g.engine, P1, g.id("res"), false);
  assert.equal(influenceOf(g.engine, P1), 30, "another resource entering costs nothing");
  play(g.engine, P1, g.id("mv"), { selected: { t: [g.id("vio")] } });
  assert.equal(zoneOf(g.engine, g.id("vio")), "hand");
  assert.equal(influenceOf(g.engine, P1), 30, "leaving play refunds nothing");
});

clause(VIOLENCE, "1:rule", "returning it to hand and playing it again costs 1 influence again", () => {
  const g = violenceBoard({ extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("mv"), { selected: { t: [g.id("vio")] } });
  developResource(g.engine, P1, g.id("vio"), false);
  assert.equal(influenceOf(g.engine, P1), 29);
});

clause(VIOLENCE, "1:rule", "losing influence is not damage, and can lose the game: at 1 influence, playing Violence puts my faction at 0 and I lose", () => {
  const g = violenceBoard({ zone: "hand", influence: 1 });
  developResource(g.engine, P1, g.id("vio"), false);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

// --- Virtuous Razer ---------------------------------------------------------------
// If this card inflicts battle damage, you may pick a location. If you do, inflict
// the same amount of damage to that location.
// Character, cost 3, [R], 3 strength / 3 speed / 1 life. soldier, vandal.

const RAZER = "05e52796-8712-458c-8cbb-c35efb9681ab";

function razerBoard(opts: { foeStrength?: number; foeSpeed?: number; foeLife?: number; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0]; razerOwner?: PlayerId; placeStructure?: number } = {}) {
  const owner = opts.razerOwner ?? P1;
  const opp = owner === P1 ? P2 : P1;
  return devBoard(
    [
      { key: "rz", def: printing(RAZER), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: opts.foeStrength ?? 0, life: opts.foeLife ?? 9, speed: opts.foeSpeed ?? 1 }), owner: opp, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 2 }), owner, zone: "play" },
      { key: "theirPlace", def: location({ name: "Their Place", structure: opts.placeStructure ?? 9 }), owner: opp, zone: "play" },
      { key: "myPlace", def: location({ name: "My Place", structure: opts.placeStructure ?? 9 }), owner, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: opp, zone: "play" },
      ...(opts.extra ?? [])
    ],
    opts.game
  );
}

/** An answer function for a battle: Razer's "pick a location" prompt is answered with `loc` (a placement key, or none to decline). */
function razerAnswer(g: Game, loc: string | undefined, seen: PendingChoiceLike[] = []) {
  return (pc: PendingChoiceLike): unknown => {
    seen.push(pc);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: loc === undefined ? [] : [g.id(loc)] };
    return declineAll(pc);
  };
}

/** Razer attacks the opponent's faction; the battle is driven to the end answering the location prompt with `loc`. */
function razerHitsFaction(g: Game, loc: string | undefined, blockers: string[] = [], seen: PendingChoiceLike[] = []): void {
  fightThrough(g.engine, P1, [g.id("rz")], { type: "faction", playerId: P2 }, blockers.map((k) => g.id(k)), undefined, razerAnswer(g, loc, seen));
}

clause(RAZER, "0:rule", "when it inflicts battle damage to the faction, I may pick a location and it takes the same amount: Razer deals 3, so the location takes 3", () => {
  const g = razerBoard();
  const seen: PendingChoiceLike[] = [];
  razerHitsFaction(g, "theirPlace", [], seen);
  assert.equal(influenceOf(g.engine, P2), 27, "3 battle damage to the faction");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3, "the same amount of damage to the picked location");
  assert.equal(damageOf(g.engine, g.id("myPlace")), 0);
  assert.equal(seen.filter((pc) => pc.kind === "chooserSelectsTarget").length, 1, "asked once; the location damage is not battle damage and triggers nothing more");
  assert.equal(seen[0].playerId, P1, "I choose");
});

clause(RAZER, "0:rule", "'a location' is any location: my own can be picked too", () => {
  const g = razerBoard();
  razerHitsFaction(g, "myPlace");
  assert.equal(damageOf(g.engine, g.id("myPlace")), 3);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
});

clause(RAZER, "0:rule", "it also triggers on battle damage to a character: blocked by Foe, Razer deals 3 to Foe and the picked location takes 3", () => {
  const g = razerBoard();
  razerHitsFaction(g, "theirPlace", ["foe"]);
  assert.equal(damageOf(g.engine, g.id("foe")), 3);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3);
  assert.equal(influenceOf(g.engine, P2), 30, "the faction was blocked");
});

clause(RAZER, "0:rule", "it is a 'may': declining the pick inflicts no damage to any location", () => {
  const g = razerBoard();
  const seen: PendingChoiceLike[] = [];
  razerHitsFaction(g, undefined, [], seen);
  assert.ok(seen.some((pc) => pc.kind === "chooserSelectsTarget"), "I was offered the pick");
  assert.equal(influenceOf(g.engine, P2), 27, "the battle damage still happened");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
  assert.equal(damageOf(g.engine, g.id("myPlace")), 0);
});

clause(RAZER, "0:rule", "'the same amount': with +2 strength Razer deals 5 and the location takes 5", () => {
  const boost = tactic({
    name: "Boost 2",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bo",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const g = razerBoard({ extra: [{ key: "bo", def: boost, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bo"), { selected: { t: [g.id("rz")] } });
  razerHitsFaction(g, "theirPlace");
  assert.equal(influenceOf(g.engine, P2), 25);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 5);
});

clause(RAZER, "0:rule", "the location takes real damage: 3 destroys a structure-3 location", () => {
  const g = razerBoard({ placeStructure: 3 });
  razerHitsFaction(g, "theirPlace");
  assert.equal(zoneOf(g.engine, g.id("theirPlace")), "discard");
});

clause(RAZER, "0:rule", "if Razer inflicts no battle damage (0 strength), nothing is offered and no location is damaged (CR 408.1)", () => {
  const shrink = tactic({
    name: "Shrink",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sh",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const g = razerBoard({ extra: [{ key: "sh", def: shrink, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("sh"), { selected: { t: [g.id("rz")] } });
  assert.equal(g.engine.getStat(g.id("rz"), "strength"), 0);
  const seen: PendingChoiceLike[] = [];
  razerHitsFaction(g, "theirPlace", [], seen);
  assert.equal(seen.length, 0, "nothing was offered");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(RAZER, "0:rule", "it triggers when Razer BLOCKS and inflicts battle damage to the attacker too", () => {
  const g = razerBoard({ game: { turn: 2, activePlayerId: P2 }, foeStrength: 0 });
  const seen: PendingChoiceLike[] = [];
  fightThrough(g.engine, P2, [g.id("foe")], { type: "faction", playerId: P1 }, [g.id("rz")], undefined, razerAnswer(g, "theirPlace", seen));
  assert.equal(damageOf(g.engine, g.id("foe")), 3, "Razer's battle damage to the attacker");
  assert.equal(seen.filter((pc) => pc.kind === "chooserSelectsTarget").length, 1);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3, "and I (Razer's controller) picked this location");
});

clause(RAZER, "0:rule", "another character's battle damage does not trigger it: my ally attacking alone is not offered the pick", () => {
  const g = razerBoard();
  const seen: PendingChoiceLike[] = [];
  fightThrough(g.engine, P1, [g.id("ally")], { type: "faction", playerId: P2 }, [], undefined, razerAnswer(g, "theirPlace", seen));
  assert.equal(influenceOf(g.engine, P2), 29, "the ally did hit");
  assert.equal(seen.length, 0, "no prompt: the ally is not Razer");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
});

clause(RAZER, "0:rule", "the opponent's Razer lets THEIR controller pick: they choose a location of mine and it takes the damage", () => {
  const g = razerBoard({ razerOwner: P2, game: { turn: 2, activePlayerId: P2 } });
  const seen: PendingChoiceLike[] = [];
  // here "theirPlace" (the key) is owned by P1 (the non-Razer side) and "myPlace" by P2
  fightThrough(g.engine, P2, [g.id("rz")], { type: "faction", playerId: P1 }, [], undefined, razerAnswer(g, "theirPlace", seen));
  assert.equal(seen[0]?.playerId, P2, "Razer's controller chooses");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3);
  assert.equal(influenceOf(g.engine, P1), 27);
});

clause(RAZER, "0:rule", "the pick must be a location: a character, an item or a faction is refused (and a location pick works on the same board)", () => {
  const battleToPrompt = () => {
    const g = razerBoard();
    declareAttackBy(g.engine, P1, [g.id("rz")]);
    declareBlockers(g.engine, P2, []);
    autoResolveBattle(g.engine);
    expectPending(g.engine, "chooserSelectsTarget");
    return g;
  };
  for (const key of ["foe", "ally", "thing"]) {
    const g = battleToPrompt();
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), `picking ${key}`);
  }
  const faction = battleToPrompt();
  refused(() => answerPending(faction.engine, "chooserSelectsTarget", { selected: [factionOf(faction.engine, P2)] }), "picking a faction");
  const good = battleToPrompt();
  answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id("theirPlace")] });
  finishBattle(good.engine);
  assert.equal(damageOf(good.engine, good.id("theirPlace")), 3);
});

clause(RAZER, "0:rule", "it still triggers when Razer is destroyed by the same round of battle damage (a trigger works as written even if its source left play, CR 503.1)", () => {
  const g = razerBoard({ foeStrength: 1, foeSpeed: 3, foeLife: 9 });
  const seen: PendingChoiceLike[] = [];
  razerHitsFaction(g, "theirPlace", ["foe"], seen);
  assert.equal(zoneOf(g.engine, g.id("rz")), "discard", "setup: the 1-life Razer was destroyed by the blocker's simultaneous damage");
  assert.equal(damageOf(g.engine, g.id("foe")), 3, "setup: Razer's own damage was inflicted at the same time");
  assert.equal(seen.filter((pc) => pc.kind === "chooserSelectsTarget").length, 1, "Razer still inflicted battle damage");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3);
});

clause(RAZER, "0:rule", "battle damage to a LOCATION counts too: Razer attacking a location may pick a location and inflict the same amount to it", () => {
  const g = razerBoard({ extra: [{ key: "other", def: location({ name: "Other Place", structure: 9 }), owner: P2, zone: "play" }] });
  const seen: PendingChoiceLike[] = [];
  fightThrough(g.engine, P1, [g.id("rz")], { type: "card", cardId: g.id("theirPlace") }, [], undefined, razerAnswer(g, "other", seen));
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 3, "setup: Razer's battle damage reached the attacked location");
  assert.equal(seen.filter((pc) => pc.kind === "chooserSelectsTarget").length, 1, "I was offered to pick a location");
  assert.equal(damageOf(g.engine, g.id("other")), 3, "and the same amount of damage went to it");
});

clause(RAZER, "0:rule", "damage Razer inflicts outside a battle is not battle damage: it does not trigger the echo", () => {
  const gear = item({
    name: "Zap Gear",
    behavior: {
      abilities: [
        {
          id: "grant",
          type: "continuous",
          modifiers: [],
          grantedAbilities: [
            {
              selector: { type: "character", name: "Virtuous Razer" },
              abilities: [
                {
                  id: "zap",
                  name: "Zap",
                  type: "activated",
                  targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
                  effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
                }
              ]
            }
          ]
        }
      ]
    } as never
  });
  const g = razerBoard({ extra: [{ key: "gear", def: gear, owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("rz"), "zap", { selected: { t: [g.id("foe")] } });
  assert.equal(damageOf(g.engine, g.id("foe")), 2, "setup: Razer inflicted 2 damage with an ability");
  assert.equal(g.engine.state.pendingChoice, undefined, "no battle damage was inflicted, so no location may be picked");
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 0);
});

clause(RAZER, "0:rule", "it deploys for its printed cost 3 with [R] and has its printed 3/3/1 stats", () => {
  const good = devBoard([{ key: "rz", def: printing(RAZER), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 2, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("rz"));
  assert.equal(zoneOf(good.engine, good.id("rz")), "play");
  assert.equal(before - ready(good.engine), 3);
  assert.equal(good.engine.getStat(good.id("rz"), "strength"), 3);
  assert.equal(good.engine.getStat(good.id("rz"), "speed"), 3);
  assert.equal(good.engine.getStat(good.id("rz"), "life"), 1);
  assert.ok(printing(RAZER).subtype?.includes("soldier") && printing(RAZER).subtype?.includes("vandal"), "printing(RAZER).subtype?.includes(\"soldier\") && printing(RAZER).subtype?.includes(\"vandal\")");
  const short = devBoard([{ key: "rz", def: printing(RAZER), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 1, P1)]);
  refused(() => playRaw(short.engine, P1, short.id("rz")), "two resources for a cost of 3");
  const noRage = devBoard([{ key: "rz", def: printing(RAZER), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]);
  refused(() => playRaw(noRage.engine, P1, noRage.id("rz")), "no [R]");
});

// --- Watchtower -------------------------------------------------------------------
// UNIQUE WATCHTOWER
// If a character enters play under your opponent's control, inflict 1 damage to it.
// Location, cost 1, [R], structure 4.

const WATCHTOWER = "b92743d8-0593-4d1a-87c2-9dc5b4520945";

function towerBoard(
  opts: { towerZone?: "play" | "hand"; faceDown?: boolean; p2Tower?: boolean; extra?: CardPlacement[]; game?: Parameters<typeof buildGame>[0]; rage?: number; p2Rage?: number } = {}
) {
  return devBoard(
    [
      { key: "wt", def: printing(WATCHTOWER), owner: P1, zone: opts.towerZone ?? "play", faceDown: (opts.towerZone ?? "play") === "play" ? opts.faceDown : undefined },
      ...(opts.p2Tower ? [{ key: "wt2", def: printing(WATCHTOWER), owner: P2, zone: "play" as const }] : []),
      { key: "old", def: character({ name: "Old Resident", life: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine Resident", life: 3 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("rage", opts.p2Rage ?? 6, P2),
      ...(opts.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2, ...opts.game }
  );
}

const p2Hand = (key: string, def: CardDefinition): CardPlacement => ({ key, def, owner: P2, zone: "hand" });

clause(WATCHTOWER, "1:rule", "a character that enters play under my opponent's control takes exactly 1 damage", () => {
  const g = towerBoard({ extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(damageOf(g.engine, g.id("newbie")), 1);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WATCHTOWER, "1:rule", "a 1-life character is destroyed as it enters play", () => {
  const g = towerBoard({ extra: [p2Hand("frail", character({ name: "Frail", life: 1, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("frail"));
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
});

clause(WATCHTOWER, "1:rule", "each entering character takes its own 1 damage (two characters entering, two damages; not accumulated on one)", () => {
  const g = towerBoard({ extra: [p2Hand("a", character({ name: "A", life: 3, cost: 0 })), p2Hand("b", character({ name: "B", life: 3, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("a"));
  playAndResolve(g.engine, P2, g.id("b"));
  assert.equal(damageOf(g.engine, g.id("a")), 1);
  assert.equal(damageOf(g.engine, g.id("b")), 1);
});

clause(WATCHTOWER, "1:rule", "only characters entering play are hit: characters already in play (the opponent's old one, mine) take nothing", () => {
  const g = towerBoard({ extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("newbie"));
  assert.equal(damageOf(g.engine, g.id("old")), 0);
  assert.equal(damageOf(g.engine, g.id("mine")), 0);
});

clause(WATCHTOWER, "1:rule", "a character entering play under MY control takes nothing", () => {
  const g = towerBoard({ game: { turn: 1, activePlayerId: P1 }, extra: [{ key: "newbie", def: character({ name: "My Newcomer", life: 3, cost: 0 }), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(damageOf(g.engine, g.id("newbie")), 0);
});

clause(WATCHTOWER, "1:rule", "only characters: an item, a location or a face-down card entering play under the opponent's control takes nothing", () => {
  const g = towerBoard({
    extra: [
      p2Hand("gear", item({ name: "Their Item", cost: 0 })),
      p2Hand("place", location({ name: "Their New Place", cost: 0, structure: 3 })),
      p2Hand("down", character({ name: "Their Face-Down Character", life: 1, cost: 0 }))
    ]
  });
  playAndResolve(g.engine, P2, g.id("gear"));
  playAndResolve(g.engine, P2, g.id("place"));
  developResource(g.engine, P2, g.id("down"), true);
  assert.equal(damageOf(g.engine, g.id("gear")), 0);
  assert.equal(damageOf(g.engine, g.id("place")), 0);
  assert.equal(zoneOf(g.engine, g.id("down")), "play", "a face-down card is only a resource (CR 411.1), not a character");
  assert.equal(damageOf(g.engine, g.id("down")), 0);
});

clause(WATCHTOWER, "1:rule", "'enters play' is not only 'is deployed': a character put into play under the opponent's control by an effect is hit too", () => {
  const g = towerBoard({
    extra: [{ key: "back", def: character({ name: "Back From The Grave", life: 3 }), owner: P2, zone: "discard" }, { key: "pip", def: putIntoPlayTactic("character"), owner: P2, zone: "hand" }]
  });
  play(g.engine, P2, g.id("pip"), { selected: { t: [g.id("back")] } });
  assert.equal(zoneOf(g.engine, g.id("back")), "play");
  assert.equal(damageOf(g.engine, g.id("back")), 1);
});

clause(WATCHTOWER, "1:rule", "a face-down character flipped up on the opponent's side enters play as a new card (CR 411.3) and takes 1", () => {
  const flipDef = character({ name: "Flip Character", life: 3, cost: 0, flipUp: { cost: 0, threshold: 0 } } as Partial<CardDefinition>);
  const g = towerBoard({ extra: [{ key: "down", def: flipDef, owner: P2, zone: "play", faceDown: true }] });
  flipUpRaw(g.engine, P2, g.id("down"));
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("down")), false);
  assert.equal(damageOf(g.engine, g.id("down")), 1);
});

clause(WATCHTOWER, "1:rule", "'under your opponent's control', not 'owned by': a character of mine that my effect puts into play under the OPPONENT's control takes 1", () => {
  const give = tactic({
    name: "Give Away",
    cost: 0,
    behavior: {
      abilities: [{ id: "gv", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "opponent" }] }]
    }
  });
  const g = towerBoard({
    game: { turn: 1, activePlayerId: P1 },
    extra: [{ key: "gift", def: character({ name: "Gift", life: 3 }), owner: P1, zone: "discard" }, { key: "gv", def: give, owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("gv"), { selected: { t: [g.id("gift")] } });
  assert.equal(zoneOf(g.engine, g.id("gift")), "play");
  assert.equal(g.engine.state.cards[g.id("gift")].controllerId, P2, "setup: it entered play under the opponent's control");
  assert.equal(damageOf(g.engine, g.id("gift")), 1);
});

clause(WATCHTOWER, "1:rule", "gaining control of a character already in play is not 'entering play': no damage", () => {
  const g = towerBoard({
    game: { turn: 1, activePlayerId: P1 },
    extra: [{ key: "steal", def: tactic({ name: "Steal Char", cost: 0, behavior: { abilities: [{ id: "sc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "opponent" }] }] } }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.cards[g.id("mine")].controllerId, P2, "setup: the opponent now controls it");
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "it did not enter play");
});

clause(WATCHTOWER, "1:rule", "the damage is 1 per character, whatever the trigger count: it does not hit the opponent's faction or other cards", () => {
  const g = towerBoard({ extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("newbie"));
  assert.equal(influenceOf(g.engine, P2), 30);
  assert.equal(influenceOf(g.engine, P1), 30);
  assert.equal(damageOf(g.engine, g.id("wt")), 0);
});

clause(WATCHTOWER, "1:rule", "the damage heals at the start of the next turn like any damage", () => {
  const g = towerBoard({ extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(g.engine, P2, g.id("newbie"));
  endTurn(g.engine, P2);
  assert.equal(damageOf(g.engine, g.id("newbie")), 0);
});

clause(WATCHTOWER, "1:rule", "it only works while it is in play and face-up: in my hand, face-down, or after it is destroyed, nothing is hit", () => {
  const inHand = towerBoard({ towerZone: "hand", extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(inHand.engine, P2, inHand.id("newbie"));
  assert.equal(damageOf(inHand.engine, inHand.id("newbie")), 0);
  const faceDown = towerBoard({ faceDown: true, extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(faceDown.engine, P2, faceDown.id("newbie"));
  assert.equal(damageOf(faceDown.engine, faceDown.id("newbie")), 0);
  const destroyed = towerBoard({ extra: [p2Hand("newbie", character({ name: "Newcomer", life: 3, cost: 0 })), p2Hand("kill", destroyLocationTactic())] });
  playAndResolve(destroyed.engine, P2, destroyed.id("kill"), { selected: { t: [destroyed.id("wt")] } });
  assert.equal(zoneOf(destroyed.engine, destroyed.id("wt")), "discard");
  playAndResolve(destroyed.engine, P2, destroyed.id("newbie"));
  assert.equal(damageOf(destroyed.engine, destroyed.id("newbie")), 0);
});

clause(WATCHTOWER, "1:rule", "the opponent's own Watchtower hits the characters entering play under MY control, and mine hits theirs", () => {
  const g = towerBoard({
    p2Tower: true,
    game: { turn: 1, activePlayerId: P1 },
    extra: [{ key: "newbie", def: character({ name: "My Newcomer", life: 3, cost: 0 }), owner: P1, zone: "hand" }]
  });
  playAndResolve(g.engine, P1, g.id("newbie"));
  assert.equal(damageOf(g.engine, g.id("newbie")), 1, "their Watchtower hits my newcomer");
  const h = towerBoard({ p2Tower: true, extra: [p2Hand("theirNew", character({ name: "Their Newcomer", life: 3, cost: 0 }))] });
  playAndResolve(h.engine, P2, h.id("theirNew"));
  assert.equal(damageOf(h.engine, h.id("theirNew")), 1, "and mine hits theirs");
});

clause(WATCHTOWER, "1:rule", "it has its printed structure 4: 3 damage does not destroy it, 4 does", () => {
  const g = towerBoard({ extra: [{ key: "zapper", def: tactic({ name: "Hit Location", cost: 0, behavior: { abilities: [{ id: "hl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] } }), owner: P2, zone: "hand" }] });
  playAndResolve(g.engine, P2, g.id("zapper"), { selected: { t: [g.id("wt")] } });
  assert.equal(damageOf(g.engine, g.id("wt")), 3);
  assert.equal(zoneOf(g.engine, g.id("wt")), "play");
  assert.equal(g.engine.getStat(g.id("wt"), "structure"), 4);
});

clause(WATCHTOWER, "1:rule", "it deploys for its printed cost 1 with [R]: no [R] is refused, and nothing is paid on refusal", () => {
  const good = devBoard([{ key: "wt", def: printing(WATCHTOWER), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 1, P1)]);
  const before = ready(good.engine);
  playAndResolve(good.engine, P1, good.id("wt"));
  assert.equal(zoneOf(good.engine, good.id("wt")), "play");
  assert.equal(before - ready(good.engine), 1);
  const noRage = devBoard([{ key: "wt", def: printing(WATCHTOWER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]);
  refused(() => playRaw(noRage.engine, P1, noRage.id("wt")), "no [R]");
  assert.equal(ready(noRage.engine), 3);
  const nothing = devBoard([{ key: "wt", def: printing(WATCHTOWER), owner: P1, zone: "hand" }]);
  refused(() => playRaw(nothing.engine, P1, nothing.id("wt")), "no resources");
});

// UNIQUE WATCHTOWER

clause(WATCHTOWER, "0:unique", "deploying a second Watchtower makes me choose which to keep: keeping the new one destroys the old one", () => {
  const g = towerBoard({ game: { turn: 1, activePlayerId: P1 }, extra: [{ key: "wt3", def: printing(WATCHTOWER), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("wt3"));
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("wt"), g.id("wt3")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("wt3") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("wt3")), "play");
  assert.equal(zoneOf(g.engine, g.id("wt")), "discard", "the other copy is destroyed");
});

clause(WATCHTOWER, "0:unique", "keeping the old Watchtower destroys the new one", () => {
  const g = towerBoard({ game: { turn: 1, activePlayerId: P1 }, extra: [{ key: "wt3", def: printing(WATCHTOWER), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("wt3"));
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("wt") } } as never);
  assert.equal(zoneOf(g.engine, g.id("wt")), "play");
  assert.equal(zoneOf(g.engine, g.id("wt3")), "discard");
});

clause(WATCHTOWER, "0:unique", "after I choose which Watchtower to keep, the game goes on: the response window closes", () => {
  const g = towerBoard({ game: { turn: 1, activePlayerId: P1 }, extra: [{ key: "wt3", def: printing(WATCHTOWER), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("wt3"));
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("wt") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the deploy finished resolving");
});

clause(WATCHTOWER, "0:unique", "UNIQUE is per player: both players may control their own Watchtower, with no choice and no destruction", () => {
  const g = towerBoard({ p2Tower: true, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playAndResolve(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("wt")), "play");
  assert.equal(zoneOf(g.engine, g.id("wt2")), "play");
});

clause(WATCHTOWER, "0:unique", "a second copy in hand is no conflict, and a different UNIQUE designation is not a duplicate", () => {
  const g = towerBoard({
    extra: [
      { key: "wt3", def: printing(WATCHTOWER), owner: P1, zone: "hand" },
      { key: "other", def: location({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "noop", def: NOOP, owner: P2, zone: "hand" }
    ]
  });
  playAndResolve(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("wt")), "play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("wt3")), "hand");
});

// --- The Tournament Faction ---------------------------------------------------------
// STARTING RESOURCES: Any 2 staple resources.
// STARTING DRAW: 8 going first, 9 going second.
// RESTORE RULE: At the start of your turn, restore all your depleted cards and detach all
// resources from your faction.
// DEVELOP RULE: At the start of your turn, draw a card or play a resource.
// DRAW -- COST: Pay 3. -- EFFECT: Draw a card.
// RESOURCE -- COST: Pay 4. -- EFFECT: Play a resource.

const TOURNAMENT = "619a34ba-4618-4f3f-acec-b757dd12d83b";

// The real staple resources, a resource that is NOT a staple, and plain filler.
const STAPLE_OBSESSION = printing("dab6e897-b5be-4760-95c0-20c2795a9ae3");
const STAPLE_GREED = printing("1b675619-bee8-41ed-8562-d4d9c763ad05");
const STAPLE_ELITISM = printing("5a5250c1-a651-43e4-ac75-f2403860446d");
const STAPLE_DECEPTION = printing("e93094ca-311a-4302-bdc5-798905a0f809");
const STAPLE_RAGE = printing("fe913bf8-b4eb-411a-a8b8-dcaf0095c90e");
const ODD_RESOURCE = resourceCard({ id: "seed10-odd-resource", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "seed10-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second, a normal Develop Rule.
const PLAIN_OPP = factionCard({
  id: "seed10-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)];
const tournamentSeat = (deck?: CardDefinition[]) => ({ faction: printing(TOURNAMENT), deck: deck ?? [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)] });

const handSize = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].hand.length;
/** Cards in play that are not the faction card. */
const playCards = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();

// --- STARTING RESOURCES: "Any 2 staple resources."

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "starts with exactly 2 staple resources in play, face-up, and no other starting cards", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, FILLER, STAPLE_GREED, STAPLE_RAGE, STAPLE_DECEPTION, STAPLE_ELITISM, STAPLE_OBSESSION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const cardId of mine) {
    assert.ok(["Rage", "Greed", "Deception", "Elitism", "Obsession"].includes(engine.getDefinition(cardId).name), `${engine.getDefinition(cardId).name} is a staple`);
    assert.equal(isFaceDown(engine, cardId), false, "flipped face-up after setup");
  }
  const total = Object.values(engine.getThresholds(P1)).reduce((sum: number, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
  assert.equal(ready(engine, P1), 2, "both are resources I can pay with");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "a resource that is not a staple is never taken as a starting resource, even when it is the first resource in the deck", () => {
  const engine = setupGame(tournamentSeat([ODD_RESOURCE, ODD_RESOURCE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the two staples may be of the same kind ('any 2', not 'different')", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the starting resources come out of my deck (they are not extra cards)", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 8, "42 deck cards - 2 starting resources - 8 opening hand");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "with only one staple in the deck I start with that one (as many as can be found, CR 312.2 / 402.5), and the game still starts", () => {
  const engine = setupGame(tournamentSeat([ODD_RESOURCE, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed"]);
  assert.equal(handSize(engine, P1), 8);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources, not mine", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "'Any': with the choose-starting-resources step on, I pick which 2 staples, from the staples in MY deck only", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_DECEPTION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "I am offered the choice");
  assert.equal(choice.count, 2);
  const deckStaples = deckOf(engine, P1).filter((cardId) => ["Rage", "Greed", "Deception"].includes(engine.getDefinition(cardId).name));
  assert.deepEqual([...choice.candidateCardIds].sort(), [...deckStaples].sort(), "exactly the 7 staples in my deck: not the non-staple resource, not the characters");
  const picked = [choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Deception")!, choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Greed")!];
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: picked });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Greed"], "exactly the staples I picked are in play");
  for (const cardId of picked) assert.equal(isFaceDown(engine, cardId), false);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "with the choice on, I may pick two of the same kind", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { choose: true });
  const greeds = engine.getStartingResourceChoice(P1)!.candidateCardIds.filter((c) => engine.getDefinition(c).name === "Greed");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"]);
  assert.equal(engine.getThresholds(P1).greed, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staples from my deck: not 1, not 3, not a non-staple, not a character, not the same card twice", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [s1, s2, s3] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  const filler = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Filler")!;
  const choose = (cardIds: CardInstanceId[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  refused(choose([s1]), "one is too few");
  refused(choose([s1, s2, s3]), "three is too many");
  refused(choose([s1, odd]), "a non-staple resource");
  refused(choose([s1, filler]), "a character");
  refused(choose([s1, s1]), "the same card twice");
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0, "nothing was put into play");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "I cannot choose the opponent's cards", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] }, { choose: true });
  const [s1] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const theirs = deckOf(engine, P2).find((c) => engine.getDefinition(c).name === "Elitism")!;
  refused(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [s1, theirs] }), "the opponent's staple");
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opening hand is drawn after the starting resources are chosen, so every staple in my deck can be chosen", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(handSize(engine, P1), 0, "nothing is drawn while the choice is pending");
  const candidates = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  assert.equal(candidates.length, 7, "all seven staples I own are still in the deck to choose from");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: candidates.slice(0, 2) });
  while (engine.state.setup.phase === "chooseStartingResources") {
    const setup = engine.state.setup as unknown as { order: PlayerId[]; currentIndex: number };
    const seat = setup.order[setup.currentIndex];
    engine.perform({ type: "chooseStartingResources", playerId: seat, cardIds: engine.getStartingResourceChoice(seat)!.candidateCardIds.slice(0, 2) });
  }
  assert.equal(handSize(engine, P1), 8);
});

// --- STARTING DRAW: "8 going first, 9 going second."

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 8 cards going first", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 9 cards going second", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "also applies when the Tournament Faction is the second seat (P2): 8 first, 9 second", () => {
  const goingFirst = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P2 });
  assert.equal(handSize(goingFirst, P2), 8);
  const goingSecond = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P1 });
  assert.equal(handSize(goingSecond, P2), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 first / 8 second)", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "the cards are drawn from my deck, and the starting resources are not part of the hand", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  for (const cardId of handOf(engine, P1)) assert.notEqual(zoneOf(engine, cardId), "play");
  assert.equal(handSize(engine, P1) + deckOf(engine, P1).length + playCards(engine, P1).length, 42, "no card appeared or vanished");
});

// --- RESTORE RULE: "At the start of your turn, restore all your depleted cards and detach all resources from your faction."

function restoreFactionBoard(active: PlayerId) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineLoc", def: location({ name: "My Depleted Location" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spent("rage", 3, P1),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      // control differs from ownership: "your depleted cards" are the ones YOU control
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spent("rage", 2, P2),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck")
    ]
  });
}

clause(TOURNAMENT, "2:rule:RESTORE RULE", "at the start of my turn my depleted characters, items and locations are restored", () => {
  const g = restoreFactionBoard(P2);
  assert.equal(isDepleted(g.engine, g.id("mineChar")), true);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(g.engine, g.id("mineChar")), false, "my depleted character is restored");
  assert.equal(isDepleted(g.engine, g.id("mineItem")), false, "my depleted item is restored");
  assert.equal(isDepleted(g.engine, g.id("mineLoc")), false, "my depleted location is restored");
  assert.equal(isDepleted(g.engine, g.id("mineReady")), false);
  assert.equal(isDepleted(g.engine, g.id("stolenIn")), false, "a depleted card I control (the opponent owns it) is mine to restore");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "at the start of my turn every resource is detached from my faction (face-up and face-down), and all my resources are ready", () => {
  const g = restoreFactionBoard(P2);
  assert.equal(attachedCount(g.engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(g.engine, P2);
  assert.equal(attachedCount(g.engine, P1), 0);
  assert.equal(ready(g.engine, P1), 6, "all six of my resources are ready again");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  const g = restoreFactionBoard(P2);
  endTurn(g.engine, P2);
  assert.equal(isDepleted(g.engine, g.id("theirChar")), true, "'your depleted cards': the opponent's character stays depleted");
  assert.equal(isDepleted(g.engine, g.id("theirItem")), true);
  assert.equal(isDepleted(g.engine, g.id("stolenOut")), true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(g.engine, P2), 2, "'your faction': the opponent's resources stay attached");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const g = restoreFactionBoard(P1);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(g.engine, g.id("mineChar")), true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(isDepleted(g.engine, g.id("mineItem")), true);
  assert.equal(attachedCount(g.engine, P1), 4, "my resources stay attached");
  assert.equal(isDepleted(g.engine, g.id("stolenIn")), true);
});

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

function developBoard(active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may draw a card (the top of my deck)", () => {
  const g = developBoard();
  const handBefore = handSize(g.engine, P1);
  const deckBefore = deckOf(g.engine, P1);
  const theirHand = handSize(g.engine, P2);
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(g.engine, P1);
  assert.equal(handSize(g.engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(g.engine, g.id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore.slice(1));
  assert.equal(handSize(g.engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(g.engine, P1).length, 0, "no resource was played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may play a resource card face-up from my hand", () => {
  const g = developBoard();
  const handBefore = handSize(g.engine, P1);
  const deckBefore = deckOf(g.engine, P1);
  developResource(g.engine, P1, g.id("handRes"), false);
  assert.equal(zoneOf(g.engine, g.id("handRes")), "play");
  assert.equal(isFaceDown(g.engine, g.id("handRes")), false);
  assert.equal(g.engine.getThresholds(P1).greed, 1, "it provides its icon");
  assert.equal(handSize(g.engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(g.engine, P1), deckBefore, "no card was drawn");
  assert.equal(zoneOf(g.engine, g.id("handRes2")), "hand", "only one resource is played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may play any card face-down as a resource (Volition), including an actual resource card", () => {
  const g = developBoard();
  developResource(g.engine, P1, g.id("handChar"), true);
  assert.equal(zoneOf(g.engine, g.id("handChar")), "play");
  assert.equal(isFaceDown(g.engine, g.id("handChar")), true);
  assert.equal(g.engine.getThresholds(P1).volition, 1);
  const real = developBoard();
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(isFaceDown(real.engine, real.id("handRes")), true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down it no longer provides its Greed");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  const g = developBoard();
  developResource(g.engine, P1, g.id("handChar"), false); // asked to play it face-up
  assert.equal(g.engine.state.cards[g.id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "'draw a card OR play a resource': one or the other, not both", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(a.engine, a.id("handRes")), "hand");
  const b = developBoard();
  const deckBefore = deckOf(b.engine, P1);
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it can be used only once per turn", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  const hand = handSize(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(a.engine, P1), hand);
  const b = developBoard();
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(b.engine, b.id("handRes2")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it can be used only on my own turn", () => {
  const g = developBoard();
  const handBefore = g.engine.state.players[P1].hand.length;
  endTurnRaw(g.engine, P1); // the opponent's turn starts
  assert.equal(g.engine.state.activePlayerId, P2);
  const pending = g.engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(g.engine, "draw");
  assert.equal(g.engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(g.engine, g.id("handRes")), "hand");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it is available at the start of each of my turns, and skipping it costs nothing", () => {
  const g = developBoard();
  const hand = handSize(g.engine, P1);
  endTurn(g.engine, P1); // I skipped my Develop Rule entirely
  assert.equal(handSize(g.engine, P1), hand, "skipping it gives nothing");
  endTurnRaw(g.engine, P2);
  settleTurnStart(g.engine, "draw");
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(handSize(g.engine, P1), hand + 1, "available again the moment my next turn starts: the Develop Rule offered a draw at the start of my turn");
  endTurn(g.engine, P1);
  endTurnRaw(g.engine, P2);
  settleTurnStart(g.engine, "draw");
  assert.equal(handSize(g.engine, P1), hand + 2, "and renews every turn");
});

// --- DRAW: "Pay 3. Draw a card."

function abilityBoard(resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function activateFaction(engine: SpoilsEngine, player: PlayerId, abilityId: string, owner: PlayerId = player, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId: factionOf(engine, owner), abilityId, selected, variables: {} } as never);
  resolvePendingResponses(engine);
}

clause(TOURNAMENT, "4:ability:tournament-draw", "pays exactly 3 resources (attached) and draws one card, the top of my deck", () => {
  const g = abilityBoard(5);
  const handBefore = handSize(g.engine, P1);
  const deckBefore = deckOf(g.engine, P1);
  activateFaction(g.engine, P1, "tournament-draw");
  assert.equal(ready(g.engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(g.engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(g.engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(g.engine, g.id("mydeck0")), "hand");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore.slice(1));
  assert.equal(handSize(g.engine, P2), 1, "the opponent drew nothing");
  assert.equal(isDepleted(g.engine, factionOf(g.engine, P1)), false, "the faction isn't depleted by it");
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is refused when the 3 cannot be paid (2 resources; 3 with 2 already spent; none) and nothing is half-paid", () => {
  const two = abilityBoard(2);
  refused(() => activateFaction(two.engine, P1, "tournament-draw"), "two resources");
  assert.equal(handSize(two.engine, P1), 2);
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  const tight = abilityBoard(1, spent("rage", 2));
  assert.equal(ready(tight.engine, P1), 1);
  refused(() => activateFaction(tight.engine, P1, "tournament-draw"), "resources already spent cannot pay again");
  const none = abilityBoard(0);
  refused(() => activateFaction(none.engine, P1, "tournament-draw"), "no resources");
  const exact = abilityBoard(3);
  activateFaction(exact.engine, P1, "tournament-draw");
  assert.equal(ready(exact.engine, P1), 0, "control: exactly 3 works");
});

clause(TOURNAMENT, "4:ability:tournament-draw", "works with exactly 3 resources of any icons", () => {
  const g = abilityBoard(0, [...bank("greed", 1, P1), ...bank("deception", 1, P1), ...volition(1, P1)]);
  activateFaction(g.engine, P1, "tournament-draw");
  assert.equal(zoneOf(g.engine, g.id("mydeck0")), "hand");
  assert.equal(ready(g.engine, P1), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used again the same turn (no limit is printed)", () => {
  const g = abilityBoard(7);
  const handBefore = handSize(g.engine, P1);
  activateFaction(g.engine, P1, "tournament-draw");
  activateFaction(g.engine, P1, "tournament-draw");
  assert.equal(handSize(g.engine, P1), handBefore + 2);
  assert.equal(attachedCount(g.engine, P1), 6);
  assert.equal(ready(g.engine, P1), 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is separate from the Develop Rule (using one leaves the other available, in either order)", () => {
  const a = abilityBoard(3);
  const base = handSize(a.engine, P1);
  activateFaction(a.engine, P1, "tournament-draw");
  assert.ok(developOffers(a.engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(a.engine, P1);
  assert.equal(handSize(a.engine, P1), base + 2);
  const b = abilityBoard(3);
  developDraw(b.engine, P1);
  activateFaction(b.engine, P1, "tournament-draw");
  assert.equal(handSize(b.engine, P1), base + 2);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "only its controller can use it: the opponent cannot DRAW with my faction", () => {
  const g = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirHand = handSize(g.engine, P2);
  refused(() => activateFaction(g.engine, P2, "tournament-draw", P1), "using the opponent's faction ability");
  assert.equal(handSize(g.engine, P2), theirHand);
  assert.equal(attachedCount(g.engine, P2), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used in response on the opponent's turn (any time I could use an ability)", () => {
  const g = abilityBoard(3, [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }]);
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  playRaw(g.engine, P2, g.id("noop"));
  assert.ok(g.engine.state.responseWindow, "the opponent's card is waiting for responses");
  const handBefore = handSize(g.engine, P1);
  actRaw(g.engine, P1, factionOf(g.engine, P1), "tournament-draw");
  resolvePendingResponses(g.engine);
  assert.equal(handSize(g.engine, P1), handBefore + 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "with an empty deck the cost is still paid and nothing is drawn; running out of cards does not lose the game (CR 102.1a)", () => {
  const g = buildGame({ playerA: { faction: printing(TOURNAMENT) }, playerB: { faction: developFaction() }, cards: [...bank("rage", 3, P1)] });
  assert.equal(deckOf(g.engine, P1).length, 0);
  activateFaction(g.engine, P1, "tournament-draw");
  assert.equal(attachedCount(g.engine, P1), 3, "the 3 were paid");
  assert.equal(handSize(g.engine, P1), 0, "there was nothing to draw");
  assert.equal(g.engine.state.result, undefined, "no one lost");
});

// --- RESOURCE: "Pay 4. Play a resource."

/** Activates RESOURCE choosing `cardKey` from my hand as the card to play. */
const useResource = (board: ReturnType<typeof abilityBoard>, cardKey: string, player: PlayerId = P1): void =>
  activateFaction(board.engine, player, "tournament-resource", player, { resource: [board.id(cardKey)] });

clause(TOURNAMENT, "5:ability:tournament-resource", "pays exactly 4 resources and plays a resource card from my hand face-up, providing its icon", () => {
  const g = abilityBoard(6);
  const handBefore = handSize(g.engine, P1);
  const deckBefore = deckOf(g.engine, P1);
  useResource(g, "handRes");
  assert.equal(attachedCount(g.engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(g.engine, g.id("handRes")), "play");
  assert.equal(isFaceDown(g.engine, g.id("handRes")), false, "an actual resource card goes in face-up");
  assert.equal(g.engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(g.engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(g.engine, P1), deckBefore, "nothing was drawn");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "hand", "only the chosen card was played");
  assert.equal(ready(g.engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "any card can be played as a resource: a non-resource goes in face-down (Volition)", () => {
  const g = abilityBoard(4);
  useResource(g, "handChar");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "play");
  assert.equal(isFaceDown(g.engine, g.id("handChar")), true, "a non-resource goes in face-down");
  assert.equal(g.engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(g.engine, g.id("handRes")), "hand");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "'Play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2)", () => holdResourceFace(() => {
  const g = abilityBoard(4);
  useResource(g, "handRes");
  const asked = g.engine.state.pendingChoice !== undefined && zoneOf(g.engine, g.id("handRes")) === "hand";
  const faceDown = zoneOf(g.engine, g.id("handRes")) === "play" && isFaceDown(g.engine, g.id("handRes"));
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(TOURNAMENT, "5:ability:tournament-resource", "the card must come from my own hand (not the opponent's hand, not my deck, not my faction)", () => {
  const g = abilityBoard(4);
  for (const key of ["theirHand", "mydeck0"]) refused(() => useResource(g, key), key);
  refused(() => activateFaction(g.engine, P1, "tournament-resource", P1, { resource: [factionOf(g.engine, P1)] }), "my faction");
  refused(() => activateFaction(g.engine, P1, "tournament-resource", P1, {}), "no card chosen");
  assert.equal(zoneOf(g.engine, g.id("theirHand")), "hand");
  assert.equal(zoneOf(g.engine, g.id("mydeck0")), "deck");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid for a refused play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "exactly one resource: two cards chosen are refused", () => {
  const g = abilityBoard(4);
  refused(() => activateFaction(g.engine, P1, "tournament-resource", P1, { resource: [g.id("handRes"), g.id("handChar")] }), "two cards");
  assert.equal(zoneOf(g.engine, g.id("handRes")), "hand");
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is refused when the 4 cannot be paid (3 resources, none, or 3 with 3 already spent), and no resource is played; exactly 4 works", () => {
  const three = abilityBoard(3);
  refused(() => useResource(three, "handRes"), "three resources");
  assert.equal(pending(three.engine), undefined);
  assert.equal(zoneOf(three.engine, three.id("handRes")), "hand");
  assert.equal(attachedCount(three.engine, P1), 0);
  const none = abilityBoard(0);
  refused(() => useResource(none, "handRes"), "no resources");
  const tight = abilityBoard(3, spent("rage", 3));
  refused(() => useResource(tight, "handRes"), "spent resources cannot pay");
  const exact = abilityBoard(4);
  useResource(exact, "handRes");
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "exactly 4 is enough");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "can be used again the same turn (no limit is printed)", () => {
  const g = abilityBoard(8);
  useResource(g, "handRes");
  useResource(g, "handChar");
  assert.equal(zoneOf(g.engine, g.id("handRes")), "play");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "play");
  assert.equal(attachedCount(g.engine, P1), 8);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is separate from the Develop Rule (a resource played by the ability leaves the Develop Rule available)", () => {
  const g = abilityBoard(4);
  useResource(g, "handRes");
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("handChar"), true);
  assert.equal(zoneOf(g.engine, g.id("handChar")), "play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "only its controller can use it", () => {
  const g = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 8, P2), { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
  });
  refused(() => activateFaction(g.engine, P2, "tournament-resource", P1, { resource: [g.id("theirHand")] }), "using the opponent's faction ability");
  assert.equal(zoneOf(g.engine, g.id("theirHand")), "hand");
  assert.equal(attachedCount(g.engine, P2), 0);
});

// --- extra cross-checks found while reviewing the clauses above ---------------------

clause(MASS, "0:ability", "with no characters of my own, Y is simply the number of characters the opponent controls (3 - 0 = 3)", () => {
  const g = massBoard({ mine: 0, theirs: 3 });
  mcPlay(g, ["o0", "o1"], 2);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal(pc.amount, 3);
  divide(g, { o0: 2, o1: 1 });
  assert.equal(damageOf(g.engine, g.id("o0")), 2);
  assert.equal(damageOf(g.engine, g.id("o1")), 1);
});

clause(MASS, "0:ability", "the opponent can cast it too: for them 'your opponent' is me, so Y is MY characters minus THEIRS", () => {
  const g = devBoard(
    [
      { key: "mc", def: printing(MASS), owner: P2, zone: "hand" },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine ${i}`, life: 9 }), owner: P1, zone: "play" as const })),
      { key: "o0", def: character({ name: "Theirs 0", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  playRaw(g.engine, P2, g.id("mc"), { selected: { cs: [g.id("m0")] }, variables: { x: 1 } });
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  if (pc) answerPending(g.engine, "distributeAmong", { shares: { [g.id("m0")]: pc.amount as number } });
  assert.equal(damageOf(g.engine, g.id("m0")), 2, "Y = 3 (mine) - 1 (theirs)");
  assert.equal(ready(g.engine, P2), 3, "they paid X = 1");
});

clause(VIOLENCE, "1:rule", "played as a resource by The Tournament Faction's RESOURCE ability it also costs exactly 1 influence", () => {
  const g = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [{ key: "vio", def: printing(VIOLENCE), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  activateFaction(g.engine, P1, "tournament-resource", P1, { resource: [g.id("vio")] });
  assert.equal(zoneOf(g.engine, g.id("vio")), "play");
  assert.equal(influenceOf(g.engine, P1), 24, "the Tournament Faction starts at 25; Violence costs exactly 1");
});

clause(NOBLE, "0:ability", "only the two picked characters are affected: another character's stats are untouched and the destroyed ones go to discard piles, not hands", () => {
  const g = nobleBoard();
  const before = g.engine.getStat(g.id("m1"), "strength");
  nsPlay(g, "m0", "o0");
  assert.equal(g.engine.getStat(g.id("m1"), "strength"), before);
  assert.equal(handOf(g.engine, P2).length, 0, "the opponent's hand is untouched (their destroyed character went to the discard pile, not their hand)");
});
// <<NEXT>>
