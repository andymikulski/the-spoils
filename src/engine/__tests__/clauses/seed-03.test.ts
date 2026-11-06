// Clause tests — batch seed-03. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-03`. Expectations come from each card's
// PRINTED text, RULES.md and the Comprehensive Rules; engine data is only used
// to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  factionCard,
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
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { developResource, endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const START = 30; // developFaction() starting influence

/** A P1 / P2 board whose factions can both develop. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** `n` face-up Greed resources for `owner`, already attached to (spent on) `owner`'s faction. They still provide their [G] icons. */
function spentGreed(owner: PlayerId, n: number): CardPlacement[] {
  return bank("greed", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

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
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

/** Raw `playCard` with a modal `mode`, WITHOUT draining the response window. */
function playModeRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, mode: number | undefined, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({
    type: "playCard",
    playerId: player,
    cardId,
    selected,
    variables: {},
    ...(mode !== undefined ? { mode } : {})
  } as never);
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Accepts every `mayPay`, declines everything else. */
const payYes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

/** True when the open response window can be driven to its end (false = the engine is stuck: "did not converge"). */
function settles(engine: SpoilsEngine): boolean {
  try {
    resolvePendingResponses(engine);
    return !engine.state.responseWindow;
  } catch {
    return false;
  }
}

/** Passes priority until `defender` holds it in the open response window. */
function passUntil(engine: SpoilsEngine, holder: PlayerId): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== holder) {
    if (++guard > 20) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** A free tactic (id "dmg", pick "t"): deals `amount` damage to one picked character. */
function damageTactic(amount: number, name = `Smite${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "mv", pick "t"): moves one picked card in play to its owner's discard pile WITHOUT destroying it. */
function discardFromPlayTactic(name = "Cast Off"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
}

/** A free tactic (id "mv", pick "t"): returns one picked card in play to its owner's hand. */
function bounceCardTactic(name = "Send Home"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes one picked card in play from the game. */
function removerTactic(name = "Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "sm", pick "t"): destroys one picked RESOURCE (face-up or face-down) in play. */
function smashResourceTactic(): CardDefinition {
  return tactic({
    name: "Smash Resource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "pip", pick "t"): puts one picked card from `zone` into play under the caster's control. */
function putIntoPlayTactic(zone: "hand" | "discard" | "deck" = "hand"): CardDefinition {
  return tactic({
    name: `Smuggle from ${zone}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone, owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "buff", pick "t"): the picked character gets `amount` of `stat` for the turn (negative = debuff). */
function buffTactic(stat: "strength" | "life" | "speed", amount: number, name = `Buff ${stat} ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "buff",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [
            { type: "createModifier", target: { type: "selected", id: "t" }, stat, operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }
          ]
        }
      ]
    }
  });
}

/** A free tactic (id "flip", pick "t"): flips one picked character in play face-down under its owner's control. */
function flipDownTactic(): CardDefinition {
  return tactic({
    name: "Turn Over",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "flip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

// =============================================================================
// Architectural Restitution
// COST: Play this only while your opponent is attacking. Pick a location in your
//   discard pile.
// EFFECT: Put the location into play under your control. Change the target of
//   your opponent's attack to the location.
// FLIP UP: 2 [G][G]
// Tactic, cost 4, threshold [G][G].
// =============================================================================

const AR = "b4c72134-5c83-4a88-af75-e16482ccd0b1";

interface ArOpts {
  greed?: number;
  rage?: number;
  /** [G] resources already spent (attached to the faction). */
  spent?: number;
  /** "attack": the opponent has attacked and I hold priority (default). "myTurn": my own turn, no battle. "oppTurn": the opponent's turn, no battle, no window. */
  phase?: "attack" | "myTurn" | "oppTurn";
  arZone?: "hand" | "play";
  arFaceDown?: boolean;
  extra?: CardPlacement[];
  locStructure?: number;
  attackerStrength?: number;
}

function arBoard(o: ArOpts = {}) {
  const phase = o.phase ?? "attack";
  const active = phase === "myTurn" ? P1 : P2;
  const game = devBoard(
    [
      { key: "ar", def: printing(AR), owner: P1, zone: o.arZone ?? "hand", faceDown: (o.arZone ?? "hand") === "play" ? (o.arFaceDown ?? true) : undefined },
      { key: "loc", def: location({ name: "Fallen Hall", structure: o.locStructure ?? 5, cost: 6 }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Raider", strength: o.attackerStrength ?? 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Defender", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: active }
  );
  if (phase === "attack") {
    declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
    assert.equal(game.engine.state.priorityPlayerId, P1, "the defender holds priority");
  }
  return game;
}

const playAr = (game: ReturnType<typeof arBoard>, loc = "loc") => playRaw(game.engine, P1, game.id("ar"), { selected: { l: [game.id(loc)] } });

clause(AR, "0:ability", "the card itself: refused one resource short of its cost 4 (3 [G]), accepted with exactly 4", () => {
  const short = arBoard({ greed: 3 });
  refused(() => playAr(short), "3 resources for a cost-4 tactic");
  assert.equal(zoneOf(short.engine, short.id("ar")), "hand");
  assert.equal(ready(short.engine), 3, "nothing was paid");
  const exact = arBoard({ greed: 4 });
  playAr(exact);
  assert.notEqual(zoneOf(exact.engine, exact.id("ar")), "hand");
});

clause(AR, "0:ability", "the card itself: needs [G][G] - one [G] among plenty of other resources is refused, two [G] among other resources is accepted", () => {
  const one = arBoard({ greed: 1, rage: 5 });
  refused(() => playAr(one), "only one [G]");
  assert.equal(ready(one.engine), 6);
  const two = arBoard({ greed: 2, rage: 2 });
  playAr(two);
  assert.notEqual(zoneOf(two.engine, two.id("ar")), "hand");
});

clause(AR, "0:ability", "the card itself: the opponent's [G] do not meet the threshold", () => {
  const game = arBoard({ greed: 0, rage: 6, extra: bank("greed", 3, P2) });
  refused(() => playAr(game), "my opponent's Greed");
  assert.equal(zoneOf(game.engine, game.id("ar")), "hand");
});

clause(AR, "0:ability", "pays exactly its cost 4: ready resources drop by 4 (a fifth is left), and the resolved tactic goes to my discard pile", () => {
  const game = arBoard({ greed: 5 });
  assert.equal(ready(game.engine), 5);
  playAr(game);
  assert.equal(ready(game.engine), 1, "4 of 5 paid while the tactic waits for responses");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("ar")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("ar")), "discardOf(game.engine, P1).includes(game.id(\"ar\"))");
  assert.equal(ready(game.engine), 1);
});

clause(AR, "0:ability", "'Play this only while your opponent is attacking': refused on my own turn when nobody is attacking", () => {
  const idle = arBoard({ phase: "myTurn" });
  refused(() => playAr(idle), "no attack on my own turn");
  assert.equal(zoneOf(idle.engine, idle.id("ar")), "hand");
  assert.equal(ready(idle.engine), 4, "nothing was paid");
  const control = arBoard({ phase: "attack" });
  playAr(control);
  assert.notEqual(zoneOf(control.engine, control.id("ar")), "hand", "control: the same board with an attack is accepted");
});

clause(AR, "0:ability", "'Play this only while your opponent is attacking': refused in the opponent's turn when they are not attacking (end-of-turn response window), where a plain tactic can be played", () => {
  const game = arBoard({
    phase: "oppTurn",
    extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]
  });
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.priorityPlayerId, P1, "I may respond to the announced end of turn");
  refused(() => playAr(game), "no attack is happening: its own play restriction", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("ar")), "hand");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("atk")] } });
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard", "control: another tactic can be played in this window");
});

clause(AR, "0:ability", "'Play this only while your opponent is attacking': refused while I am the one attacking", () => {
  const game = devBoard(
    [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Fallen Hall", structure: 5 }), owner: P1, zone: "discard" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 6, P1)
    ],
    { turn: 1, activePlayerId: P1 }
  );
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("mine")], target: { type: "faction", playerId: P2 } });
  assert.equal(game.engine.state.priorityPlayerId, P1, "the attacker holds priority first");
  refused(() => playAr(game), "my own attack: its own play restriction", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("ar")), "hand");
  assert.equal(ready(game.engine), 6, "nothing was paid");
  playRaw(game.engine, P1, game.id("kill"), { selected: { t: [game.id("foe")] } });
  assert.notEqual(zoneOf(game.engine, game.id("kill")), "hand", "control: a plain tactic can be played in the attacker's window");
});

clause(AR, "0:ability", "'Play this only while your opponent is attacking': refused once the attack is over", () => {
  const game = arBoard({ phase: "attack" });
  game.engine.perform({ type: "passPriority", playerId: P1 });
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined, "the battle is over");
  // open a real window (the opponent announces the end of turn) so only the card's own restriction can refuse it
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.priorityPlayerId, P1, "I may respond to the announced end of turn");
  refused(() => playAr(game), "the attack has finished", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("ar")), "hand");
});

clause(AR, "0:ability", "playable in the response window before blockers (the attack was just declared)", () => {
  const game = arBoard({ phase: "attack" });
  assert.equal(battleOf(game.engine)?.phase, "afterAttackersResponse");
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
});

clause(AR, "0:ability", "playable in the battle-resolution response window after blockers were declared, and the redirect still happens", () => {
  const game = arBoard({ phase: "attack" });
  game.engine.perform({ type: "passPriority", playerId: P1 });
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  passUntil(game.engine, P1);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("loc") });
});

// --- pick: "a location in your discard pile" ---------------------------------

for (const [label, make] of [
  ["a location in the OPPONENT's discard pile", (): CardPlacement => ({ key: "bad", def: location({ name: "Their Ruin", structure: 3 }), owner: P2, zone: "discard" })],
  ["a location already in play", (): CardPlacement => ({ key: "bad", def: location({ name: "Standing Hall", structure: 3 }), owner: P1, zone: "play" })],
  ["a location in my hand", (): CardPlacement => ({ key: "bad", def: location({ name: "Hand Hall", structure: 3 }), owner: P1, zone: "hand" })],
  ["a location in my deck", (): CardPlacement => ({ key: "bad", def: location({ name: "Deck Hall", structure: 3 }), owner: P1, zone: "deck" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "Dead Guy" }), owner: P1, zone: "discard" })],
  ["an item in my discard pile", (): CardPlacement => ({ key: "bad", def: item({ name: "Broken Thing" }), owner: P1, zone: "discard" })],
  ["a tactic in my discard pile", (): CardPlacement => ({ key: "bad", def: tactic({ name: "Spent Trick" }), owner: P1, zone: "discard" })],
  ["a resource in my discard pile", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Burnt Resource" }), owner: P1, zone: "discard" })]
] as const) {
  clause(AR, "0:ability", `cannot pick ${label}`, () => {
    const bad = arBoard({ extra: [make()] });
    refused(() => playAr(bad, "bad"), label);
    assert.equal(zoneOf(bad.engine, bad.id("ar")), "hand", "the tactic was not played");
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = arBoard({ extra: [make()] });
    playAr(good);
    resolvePendingResponses(good.engine);
    assert.equal(zoneOf(good.engine, good.id("loc")), "play", "control: the location in my discard pile is accepted");
  });
}

clause(AR, "0:ability", "needs exactly one pick: none and two are refused", () => {
  const extra = (): CardPlacement[] => [{ key: "loc2", def: location({ name: "Second Hall", structure: 3 }), owner: P1, zone: "discard" }];
  const none = arBoard({ extra: extra() });
  refused(() => playRaw(none.engine, P1, none.id("ar"), { selected: { l: [] } }), "no pick");
  assert.equal(zoneOf(none.engine, none.id("ar")), "hand");
  const two = arBoard({ extra: extra() });
  refused(() => playRaw(two.engine, P1, two.id("ar"), { selected: { l: [two.id("loc"), two.id("loc2")] } }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("ar")), "hand");
  const one = arBoard({ extra: extra() });
  playAr(one, "loc2");
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("loc2")), "play", "control: either location can be the pick");
  assert.equal(zoneOf(one.engine, one.id("loc")), "discard", "the other location stays in the discard pile");
});

clause(AR, "0:ability", "with no location in my discard pile it cannot be played", () => {
  const game = devBoard(
    [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  refused(() => playRaw(game.engine, P1, game.id("ar"), { selected: {} }), "no location to pick");
  assert.equal(zoneOf(game.engine, game.id("ar")), "hand");
});

clause(AR, "0:ability", "the pick is a cost: while the tactic waits for responses the location is still in my discard pile and the attack still targets my faction", () => {
  const game = arBoard();
  playAr(game);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard", "not in play yet");
  assert.deepEqual(battleOf(game.engine)?.target, { type: "faction", playerId: P1 });
  assert.equal(ready(game.engine), 0, "but the cost 4 is already paid");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
});

// --- effect ------------------------------------------------------------------

clause(AR, "0:ability", "the location is put into play under my control, and it leaves my discard pile", () => {
  const game = arBoard();
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(game.engine.state.cards[game.id("loc")].controllerId, P1);
  assert.ok(game.engine.state.players[P1].play.includes(game.id("loc")), "game.engine.state.players[P1].play.includes(game.id(\"loc\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("loc")), "!discardOf(game.engine, P1).includes(game.id(\"loc\"))");
});

clause(AR, "0:ability", "the location comes into play fresh: no damage, not depleted, face-up", () => {
  const game = arBoard({ extra: [] });
  game.engine.state.cards[game.id("loc")].damage = 3; // stale damage must not survive the trip
  playAr(game);
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("loc")];
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.equal(card.faceDown, false);
});

clause(AR, "0:ability", "the location is put into play, not deployed: its own cost 6 is not paid (only the tactic's 4)", () => {
  const game = arBoard({ greed: 6 });
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(ready(game.engine), 2, "6 - 4 (the tactic); nothing for the location's cost 6");
});

clause(AR, "0:ability", "'Change the target of your opponent's attack to the location': the battle's target becomes that location", () => {
  const game = arBoard();
  assert.deepEqual(battleOf(game.engine)?.target, { type: "faction", playerId: P1 });
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("loc") });
  assert.equal(battleOf(game.engine)?.defenderPlayerId, P1, "I am still the defending player");
  assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("atk")], "the attack itself goes on");
});

clause(AR, "0:ability", "an unblocked attack now damages the location and my faction loses nothing (control: without it the faction takes the damage)", () => {
  const without = arBoard();
  without.engine.perform({ type: "passPriority", playerId: P1 });
  resolvePendingResponses(without.engine);
  declareBlockers(without.engine, P1, []);
  autoResolveBattle(without.engine);
  assert.equal(influenceOf(without.engine, P1), START - 2, "control: the unprotected faction takes 2");

  const game = arBoard();
  playAr(game);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(influenceOf(game.engine, P1), START, "the faction is untouched");
  assert.equal(game.engine.state.cards[game.id("loc")].damage, 2, "the location took the attacker's 2 damage");
  assert.equal(zoneOf(game.engine, game.id("loc")), "play", "structure 5 survives 2 damage");
});

clause(AR, "0:ability", "an attack strong enough to destroy the location destroys it (to my discard pile) and my faction still loses nothing", () => {
  const game = arBoard({ locStructure: 3, attackerStrength: 4 });
  playAr(game);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard", "4 damage destroys a structure-3 location");
  assert.equal(influenceOf(game.engine, P1), START, "damage past the location does not spill over to the faction");
});

clause(AR, "0:ability", "after the redirect I can still block: the blocker takes the damage and the location takes none", () => {
  const game = arBoard();
  playAr(game);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 2, "the blocker took the 2 damage");
  assert.equal(game.engine.state.cards[game.id("loc")].damage, 0);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(AR, "0:ability", "it redirects an attack that was aimed at one of my locations to the returned location instead", () => {
  const game = devBoard(
    [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Fallen Hall", structure: 5 }), owner: P1, zone: "discard" },
      { key: "standing", def: location({ name: "Standing Hall", structure: 6 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")], { type: "card", cardId: game.id("standing") });
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("standing") });
  playAr(game);
  resolvePendingResponses(game.engine);
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("loc") });
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("standing")].damage, 0, "the original target took nothing");
  assert.equal(game.engine.state.cards[game.id("loc")].damage, 2);
});

clause(AR, "0:ability", "it changes only THIS attack: a later attack by another character in the same turn still hits my faction", () => {
  const game = arBoard({
    extra: [{ key: "atk2", def: character({ name: "Second Raider", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  playAr(game);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P1), START);
  declareAttackBy(game.engine, P2, [game.id("atk2")]);
  assert.deepEqual(battleOf(game.engine)?.target, { type: "faction", playerId: P1 }, "the new attack targets my faction as declared");
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 3);
});

clause(AR, "0:ability", "the returned location is a real 'enters play': its own enters-play trigger fires for me", () => {
  const trap = location({
    name: "Hall of Welcome",
    structure: 5,
    behavior: {
      abilities: [
        {
          id: "welcome",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
        }
      ]
    }
  });
  const game = devBoard(
    [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "loc", def: trap, owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playAr(game);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(influenceOf(game.engine, P1), START + 3, "the location's enters-play trigger gave me 3 influence");
});

// --- FLIP UP: 2 [G][G] ------------------------------------------------------

const arFlipUp = (game: ReturnType<typeof arBoard>, loc = "loc", player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("ar"), { l: [game.id(loc)] });

clause(AR, "1:flipUp", "flipping up a face-down copy during the opponent's attack pays exactly 2 and does its text: the location returns under my control and the attack is redirected", () => {
  const game = arBoard({ arZone: "play", greed: 2, rage: 1 });
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
  assert.equal(ready(game.engine), 4, "3 banks and the face-down card");
  arFlipUp(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.cards[game.id("loc")].zone, "play");
  assert.equal(game.engine.state.cards[game.id("loc")].controllerId, P1);
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("loc") });
  assert.equal(zoneOf(game.engine, game.id("ar")), "discard", "a resolved tactic goes to my discard pile");
  assert.equal(ready(game.engine), 1, "4 resources: 2 paid and the face-down card is no longer a resource (4 - 2 - 1)");
});

clause(AR, "1:flipUp", "FLIP UP costs its own 2, not the printed cost 4: [G][G] plus the face-down card itself is enough", () => {
  const game = arBoard({ arZone: "play", greed: 2, rage: 0 });
  assert.equal(ready(game.engine), 3);
  arFlipUp(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(ready(game.engine), 0, "all three resources went: 2 paid and the face-down card");
});

clause(AR, "1:flipUp", "FLIP UP is refused one resource short: [G][G] already spent plus the face-down card itself leaves only 1", () => {
  const game = arBoard({ arZone: "play", greed: 0, spent: 2 });
  assert.equal(ready(game.engine), 1, "only the face-down card is ready");
  refused(() => arFlipUp(game), "1 resource for a FLIP UP cost of 2");
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true, "still face-down");
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  const ok = arBoard({ arZone: "play", greed: 1, spent: 2 });
  arFlipUp(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "play", "control: one more ready resource is enough (spent [G] still meet the threshold)");
});

clause(AR, "1:flipUp", "FLIP UP needs [G][G]: one [G] and plenty of other resources is refused", () => {
  const game = arBoard({ arZone: "play", greed: 1, rage: 5 });
  refused(() => arFlipUp(game), "only one [G]");
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
  assert.equal(ready(game.engine), 7, "nothing was paid");
});

clause(AR, "1:flipUp", "the face-down card's own Volition is not a [G]", () => {
  const game = arBoard({ arZone: "play", greed: 0, rage: 5 });
  refused(() => arFlipUp(game), "no [G] at all");
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
});

clause(AR, "1:flipUp", "flipping up keeps the play restriction: refused on my own turn when no opponent is attacking", () => {
  const game = arBoard({ arZone: "play", phase: "myTurn", greed: 3 });
  refused(() => arFlipUp(game), "no attack to answer: the play restriction is kept on FLIP UP", /cannot be flipped up right now/);
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  const ok = arBoard({ arZone: "play", phase: "attack", greed: 3 });
  arFlipUp(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "play", "control: the same board with an attack is accepted");
});

clause(AR, "1:flipUp", "flipping up still needs the location pick: a character, a location in play, or no pick is refused", () => {
  const extra = (): CardPlacement[] => [
    { key: "deadGuy", def: character({ name: "Dead Guy" }), owner: P1, zone: "discard" },
    { key: "standing", def: location({ name: "Standing Hall", structure: 3 }), owner: P1, zone: "play" },
    { key: "theirs", def: location({ name: "Their Ruin", structure: 3 }), owner: P2, zone: "discard" }
  ];
  for (const bad of ["deadGuy", "standing", "theirs"]) {
    const game = arBoard({ arZone: "play", greed: 2, extra: extra() });
    refused(() => arFlipUp(game, bad), `picking ${bad}`);
    assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
  }
  const none = arBoard({ arZone: "play", greed: 2, extra: extra() });
  refused(() => flipUpRaw(none.engine, P1, none.id("ar"), { l: [] }), "no pick");
  const good = arBoard({ arZone: "play", greed: 2, extra: extra() });
  arFlipUp(good);
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("loc")), "play", "control: a location in my discard pile works");
});

clause(AR, "1:flipUp", "only the card's controller can flip it up", () => {
  const game = arBoard({ arZone: "play", greed: 2, extra: bank("greed", 3, P2) });
  refused(() => arFlipUp(game, "loc", P2), "the opponent cannot flip up my card");
  assert.equal(game.engine.state.cards[game.id("ar")].faceDown, true);
});

clause(AR, "1:flipUp", "a face-down copy is just a resource: it provides Volition and does nothing else until flipped", () => {
  const game = arBoard({ arZone: "play", greed: 0, rage: 0 });
  assert.equal(ready(game.engine), 1, "the face-down card is a ready resource");
  assert.equal(game.engine.state.cards[game.id("ar")].zone, "play");
  assert.deepEqual(battleOf(game.engine)?.target, { type: "faction", playerId: P1 });
});

// =============================================================================
// Auspicious Tax
// ATTACH TO CHARACTER
// The attached character's controller must pay 3 to attack with it.
// Item (gear), cost 0, threshold [G][G].
// =============================================================================

const TAX = "95b246cb-d25a-44c2-84ae-fc1e5ec73389";

interface TaxOpts {
  /** Ready generic resources for P1 (Rage). */
  rage?: number;
  greed?: number;
  /** Where the Tax starts: in hand (to deploy it) or attached in play to `host`. */
  tax?: "hand" | "attached" | "none";
  extra?: CardPlacement[];
  active?: PlayerId;
}

function taxBoard(o: TaxOpts = {}) {
  const tax = o.tax ?? "attached";
  return devBoard(
    [
      { key: "host", def: character({ name: "Taxed Host", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Free Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...(tax === "hand" ? [{ key: "tax", def: printing(TAX), owner: P1, zone: "hand" } as CardPlacement] : []),
      ...(tax === "attached" ? [{ key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "host" } as CardPlacement] : []),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const attackWith = (game: ReturnType<typeof taxBoard>, keys: string[], player: PlayerId = P1, target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId }) =>
  game.engine.perform({
    type: "declareAttack",
    playerId: player,
    attackerIds: keys.map((key) => game.id(key)),
    target: target ?? { type: "faction", playerId: other(player) }
  });

const attachTaxTo = (game: ReturnType<typeof taxBoard>, hostKey: string) => playRaw(game.engine, P1, game.id("tax"), { selected: { attachTo: [game.id(hostKey)] } });

clause(TAX, "0:attach", "the card itself: cost 0 and threshold [G][G] - refused with one [G], accepted with two [G], and nothing is paid", () => {
  const one = taxBoard({ tax: "hand", greed: 1, rage: 3 });
  refused(() => attachTaxTo(one, "host"), "only one [G]");
  assert.equal(zoneOf(one.engine, one.id("tax")), "hand");
  const two = taxBoard({ tax: "hand", greed: 2 });
  assert.equal(ready(two.engine), 2);
  attachTaxTo(two, "host");
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("tax")), "play");
  assert.equal(ready(two.engine), 2, "cost 0: no resource is spent");
});

clause(TAX, "0:attach", "enters play attached to the character picked as its first extra cost", () => {
  const game = taxBoard({ tax: "hand", greed: 2 });
  attachTaxTo(game, "host");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("tax")].attachedTo, game.id("host"));
  assert.equal(game.engine.state.cards[game.id("tax")].zone, "play");
  assert.equal(game.engine.state.cards[game.id("ally")].attachedTo, undefined, "the other character carries nothing");
});

clause(TAX, "0:attach", "may be attached to my opponent's character as well as mine", () => {
  const game = taxBoard({ tax: "hand", greed: 2 });
  attachTaxTo(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("tax")].attachedTo, game.id("foe"));
  assert.equal(game.engine.state.cards[game.id("tax")].controllerId, P1, "I still control the Tax");
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P1, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P1, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P1, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })]
] as const) {
  clause(TAX, "0:attach", `cannot attach to ${label}`, () => {
    const bad = taxBoard({ tax: "hand", greed: 2, extra: [make()] });
    refused(() => attachTaxTo(bad, "bad"), label);
    assert.equal(zoneOf(bad.engine, bad.id("tax")), "hand");
    const good = taxBoard({ tax: "hand", greed: 2, extra: [make()] });
    attachTaxTo(good, "host");
    resolvePendingResponses(good.engine);
    assert.equal(good.engine.state.cards[good.id("tax")].attachedTo, good.id("host"), "control: a character is accepted");
  });
}

clause(TAX, "0:attach", "cannot attach to a faction", () => {
  const bad = taxBoard({ tax: "hand", greed: 2 });
  refused(() => playRaw(bad.engine, P1, bad.id("tax"), { selected: { attachTo: [bad.engine.state.players[P2].factionId!] } }), "a faction");
  assert.equal(zoneOf(bad.engine, bad.id("tax")), "hand");
});

clause(TAX, "0:attach", "needs a target: with no character in play it cannot be played, and with none or two picks it is refused", () => {
  const empty = devBoard([{ key: "tax", def: printing(TAX), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)], { turn: 1 });
  refused(() => playRaw(empty.engine, P1, empty.id("tax"), { selected: { attachTo: [] } }), "no character to attach to");
  assert.equal(zoneOf(empty.engine, empty.id("tax")), "hand");
  const none = taxBoard({ tax: "hand", greed: 2 });
  refused(() => playRaw(none.engine, P1, none.id("tax"), { selected: { attachTo: [] } }), "no pick");
  const two = taxBoard({ tax: "hand", greed: 2 });
  refused(() => playRaw(two.engine, P1, two.id("tax"), { selected: { attachTo: [two.id("host"), two.id("ally")] } }), "two picks");
});

clause(TAX, "0:attach", "an item is a main-phase card: refused on the opponent's turn (control: accepted on mine)", () => {
  const theirTurn = taxBoard({ tax: "hand", greed: 2, active: P2 });
  refused(() => attachTaxTo(theirTurn, "host"), "not my turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("tax")), "hand");
  const mine = taxBoard({ tax: "hand", greed: 2 });
  attachTaxTo(mine, "host");
  assert.notEqual(zoneOf(mine.engine, mine.id("tax")), "hand");
});

clause(TAX, "0:attach", "when its host is destroyed the Tax leaves play with it, into its owner's discard pile", () => {
  const game = taxBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "discard");
  assert.equal(zoneOf(game.engine, game.id("tax")), "discard");
});

clause(TAX, "0:attach", "when its host is returned to its owner's hand the Tax leaves play the same way: it goes to its owner's hand (CR 301.4a)", () => {
  const game = taxBoard({ extra: [{ key: "bounce", def: bounceCardTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "hand");
  assert.equal(zoneOf(game.engine, game.id("tax")), "hand", "the attached card leaves play the same way as its host");
});

clause(TAX, "0:attach", "when its host is removed from the game the Tax is removed from the game with it (CR 301.4)", () => {
  const game = taxBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("rm"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "removed");
  assert.equal(zoneOf(game.engine, game.id("tax")), "removed", "the attached card leaves play the same way as its host");
});

clause(TAX, "0:attach", "if the host stops being a character (flipped face-down: only a resource) the Tax is flipped face-down with it", () => {
  const game = taxBoard({ extra: [{ key: "flip", def: flipDownTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("flip"), { selected: { t: [game.id("host")] } });
  assert.equal(game.engine.state.cards[game.id("host")].faceDown, true);
  assert.equal(zoneOf(game.engine, game.id("tax")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(game.engine.state.cards[game.id("tax")].faceDown, true, "...and is flipped face-down along with its host");
});

// --- the rule: "The attached character's controller must pay 3 to attack with it." ---

clause(TAX, "1:rule", "attacking with the taxed character costs exactly 3: ready resources drop by 3 and the attack happens", () => {
  const game = taxBoard({ rage: 5 });
  attackWith(game, ["host"]);
  assert.equal(ready(game.engine), 2, "3 of 5 paid");
  assert.ok(battleOf(game.engine), "the attack was declared");
  assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("host")]);
  assert.equal(game.engine.state.cards[game.id("host")].depleted, true, "declaring depletes the attacker as usual");
});

clause(TAX, "1:rule", "exactly 3 ready resources are enough", () => {
  const game = taxBoard({ rage: 3 });
  attackWith(game, ["host"]);
  assert.equal(ready(game.engine), 0);
  assert.ok(battleOf(game.engine), "battleOf(game.engine)");
});

clause(TAX, "1:rule", "refused one resource short (2): no battle, nothing paid, the host is not depleted", () => {
  const game = taxBoard({ rage: 2 });
  refused(() => attackWith(game, ["host"]), "2 resources for a tax of 3");
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(ready(game.engine), 2, "nothing was paid");
  assert.equal(game.engine.state.cards[game.id("host")].depleted, false);
});

clause(TAX, "1:rule", "with no resources at all the taxed character cannot attack, but without the Tax it can (control)", () => {
  const taxed = taxBoard({ rage: 0 });
  refused(() => attackWith(taxed, ["host"]), "no resources");
  const free = taxBoard({ tax: "none", rage: 0 });
  attackWith(free, ["host"]);
  assert.ok(battleOf(free.engine), "control: no Tax, no payment");
});

clause(TAX, "1:rule", "paid resources are spent (attached to the faction), not discarded: they are still in play", () => {
  const game = taxBoard({ rage: 4 });
  const resources = game.engine.state.players[P1].play.filter((cardId) => game.engine.isResource(cardId));
  assert.equal(resources.length, 4);
  attackWith(game, ["host"]);
  const attached = resources.filter((cardId) => game.engine.state.cards[cardId].attachedTo === game.engine.state.players[P1].factionId);
  assert.equal(attached.length, 3, "three resources were attached to my faction");
  assert.ok(resources.every((cardId) => game.engine.state.cards[cardId].zone === "play"), "resources.every((cardId) => game.engine.state.cards[cardId].zone === \"play\")");
});

clause(TAX, "1:rule", "a character without the Tax attacks for free", () => {
  const game = taxBoard({ rage: 5 });
  attackWith(game, ["ally"]);
  assert.ok(battleOf(game.engine), "battleOf(game.engine)");
  assert.equal(ready(game.engine), 5, "nothing paid");
});

clause(TAX, "1:rule", "a party containing the taxed character pays the tax once (3), not once per member", () => {
  const game = taxBoard({ rage: 5 });
  attackWith(game, ["host", "ally"]);
  assert.equal(ready(game.engine), 2, "3 paid for the party");
  assert.deepEqual([...(battleOf(game.engine)?.attackingParty ?? [])].sort(), [game.id("host"), game.id("ally")].sort());
});

clause(TAX, "1:rule", "a party with the taxed character is refused when the controller cannot pay 3, even though the ally alone could attack", () => {
  const game = taxBoard({ rage: 2 });
  refused(() => attackWith(game, ["host", "ally"]), "2 resources for a tax of 3");
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(ready(game.engine), 2);
  attackWith(game, ["ally"]);
  assert.ok(battleOf(game.engine), "control: the free ally attacks alone");
});

clause(TAX, "1:rule", "the tax is charged when attacking a location too", () => {
  const game = taxBoard({ rage: 3, extra: [{ key: "place", def: location({ name: "Their Place", structure: 4 }), owner: P2, zone: "play" }] });
  attackWith(game, ["host"], P1, { type: "card", cardId: game.id("place") });
  assert.equal(ready(game.engine), 0, "3 paid");
  assert.deepEqual(battleOf(game.engine)?.target, { type: "card", cardId: game.id("place") });
});

clause(TAX, "1:rule", "two Taxes on one character cost 6 in total", () => {
  const second = (): CardPlacement[] => [{ key: "tax2", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "host" }];
  const five = taxBoard({ rage: 5, extra: second() });
  refused(() => attackWith(five, ["host"]), "5 resources for two taxes of 3");
  assert.equal(battleOf(five.engine), undefined);
  assert.equal(ready(five.engine), 5);
  const six = taxBoard({ rage: 6, extra: second() });
  attackWith(six, ["host"]);
  assert.equal(ready(six.engine), 0, "6 paid");
});

clause(TAX, "1:rule", "two taxed characters in one party cost 3 each: 6 in total", () => {
  const tax2 = (): CardPlacement[] => [{ key: "tax2", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "ally" }];
  const five = taxBoard({ rage: 5, extra: tax2() });
  refused(() => attackWith(five, ["host", "ally"]), "5 resources for two taxes of 3");
  assert.equal(battleOf(five.engine), undefined);
  const six = taxBoard({ rage: 6, extra: tax2() });
  attackWith(six, ["host", "ally"]);
  assert.equal(ready(six.engine), 0);
});

clause(TAX, "1:rule", "it is charged each time the character attacks: a second attack in the turn (after restoring it) costs 3 more", () => {
  const game = taxBoard({ rage: 6 });
  attackWith(game, ["host"]);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(ready(game.engine), 3);
  game.engine.state.cards[game.id("host")].depleted = false;
  attackWith(game, ["host"]);
  assert.equal(ready(game.engine), 0, "3 more paid for the second attack");
  assert.ok(battleOf(game.engine), "battleOf(game.engine)");
});

clause(TAX, "1:rule", "the controller of the ATTACHED character pays, not the Tax's controller: my Tax on an opponent's character taxes the opponent", () => {
  const game = taxBoard({
    tax: "none",
    active: P2,
    extra: [
      { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "foeHost" },
      { key: "foeHost", def: character({ name: "Foe Host", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P2),
      ...bank("rage", 5, P1)
    ]
  });
  refused(() => attackWith(game, ["foeHost"], P2), "the opponent has only 2 resources");
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(ready(game.engine, P1), 5, "my resources are not touched");
  const rich = taxBoard({
    tax: "none",
    active: P2,
    extra: [
      { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "foeHost" },
      { key: "foeHost", def: character({ name: "Foe Host", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P2),
      ...bank("rage", 5, P1)
    ]
  });
  attackWith(rich, ["foeHost"], P2);
  assert.equal(ready(rich.engine, P2), 0, "the opponent paid 3");
  assert.equal(ready(rich.engine, P1), 5, "I paid nothing");
});

clause(TAX, "1:rule", "the Tax's owner pays nothing to attack with their own other characters while it taxes the opponent's character", () => {
  const game = taxBoard({
    tax: "none",
    extra: [
      { key: "foeHost", def: character({ name: "Foe Host", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "foeHost" },
      ...bank("rage", 5, P1)
    ]
  });
  attackWith(game, ["host"]);
  assert.equal(ready(game.engine), 5, "my attack is free");
});

clause(TAX, "1:rule", "'the attached character's controller': a character I own but the opponent controls makes the opponent pay", () => {
  const game = taxBoard({
    tax: "none",
    active: P2,
    extra: [
      { key: "stolen", def: character({ name: "Stolen Host", strength: 2, life: 5, speed: 2 }), owner: P1, controller: P2, zone: "play" },
      { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "stolen" },
      ...bank("rage", 2, P2),
      ...bank("rage", 5, P1)
    ]
  });
  refused(() => attackWith(game, ["stolen"], P2), "its controller (the opponent) has only 2");
  assert.equal(ready(game.engine, P1), 5);
});

clause(TAX, "1:rule", "blocking with the taxed character is free: the tax is only for attacking", () => {
  const game = taxBoard({
    tax: "none",
    active: P2,
    extra: [
      { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("host")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("host")]);
  assert.equal(ready(game.engine, P1), 0, "no resources existed and none were needed");
});

clause(TAX, "1:rule", "once the Tax is gone the host attacks for free again", () => {
  const wreck = tactic({
    name: "Wreck Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "wreck",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const game = taxBoard({ rage: 3, extra: [{ key: "wreck", def: wreck, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("wreck"), { selected: { t: [game.id("tax")] } });
  assert.equal(zoneOf(game.engine, game.id("tax")), "discard");
  attackWith(game, ["host"]);
  assert.equal(ready(game.engine), 3, "no tax once the Tax is gone");
});

/** A free tactic that makes the picked characters of mine attack my opponent right now (the Counter Attack shape). */
function sneakAttackTactic(): CardDefinition {
  return tactic({
    name: "Sneak Attack",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "body",
          type: "activated",
          targets: [{ id: "atk", selector: { controller: "self", type: "character" }, count: 9, optional: true }],
          effects: [{ type: "initiateAttack", attackerSelection: "atk", target: "opponent" }]
        }
      ]
    }
  });
}

function sneakBoard(rage: number) {
  const game = taxBoard({
    rage,
    active: P2,
    extra: [{ key: "sneak", def: sneakAttackTactic(), owner: P1, zone: "hand" }]
  });
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  return game;
}

clause(TAX, "1:rule", "control: an untaxed character can attack through an attack-making effect for free", () => {
  const game = sneakBoard(0);
  playRaw(game.engine, P1, game.id("sneak"), { selected: { atk: [game.id("ally")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("ally")].depleted, true, "the ally attacked");
});

clause(TAX, "1:rule", "an attack made by an effect (Counter Attack style) with the taxed character also costs 3: payable it is paid, unpayable it is refused", () => {
  const rich = sneakBoard(3);
  playRaw(rich.engine, P1, rich.id("sneak"), { selected: { atk: [rich.id("host")] } });
  resolvePendingResponses(rich.engine);
  assert.equal(rich.engine.state.cards[rich.id("host")].depleted, true, "the host attacked");
  assert.equal(ready(rich.engine), 0, "and paid the 3");

  const poor = sneakBoard(2);
  let refusedPlay = false;
  try {
    playRaw(poor.engine, P1, poor.id("sneak"), { selected: { atk: [poor.id("host")] } });
    resolvePendingResponses(poor.engine);
  } catch {
    refusedPlay = true;
  }
  assert.ok(refusedPlay || poor.engine.state.cards[poor.id("host")].depleted === false, "with 2 resources the taxed host cannot attack");
  assert.equal(ready(poor.engine), 2, "nothing was paid");
});

// =============================================================================
// Avuncular Merlion
// This card enters play with 2 tokens on it.
// If a character you control is put into your discard pile from play, you may
// pay 1 and remove a token from this card. If you do, put that character into
// play under your control. Deplete it.
// Character (merlion), cost 9, threshold [G][G], 7 / 3 / 7.
// =============================================================================

const MERLION = "eb25b337-3ba7-4427-810c-0efd7df8c43e";

function merlionDeployBoard(o: { greed?: number; rage?: number; extra?: CardPlacement[]; merlionZone?: "hand" | "play"; tokens?: number } = {}) {
  return devBoard(
    [
      { key: "mer", def: printing(MERLION), owner: P1, zone: o.merlionZone ?? "hand", counters: o.tokens !== undefined ? { token: o.tokens } : undefined },
      ...bank("greed", o.greed ?? 9, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 1 }
  );
}

clause(MERLION, "0:rule", "the card itself: cost 9 with [G][G] - refused at 8 resources and without two [G], accepted at exactly 9; printed 7 / 3 / 7", () => {
  const short = merlionDeployBoard({ greed: 8 });
  refused(() => playRaw(short.engine, P1, short.id("mer")), "8 resources for cost 9");
  assert.equal(zoneOf(short.engine, short.id("mer")), "hand");
  const oneGreed = merlionDeployBoard({ greed: 1, rage: 8 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("mer")), "only one [G]");
  const ok = merlionDeployBoard({ greed: 2, rage: 8 });
  play(ok.engine, P1, ok.id("mer"));
  assert.equal(zoneOf(ok.engine, ok.id("mer")), "play");
  assert.equal(ready(ok.engine), 1, "9 of 10 paid");
  assert.equal(ok.engine.getStat(ok.id("mer"), "strength"), 7);
  assert.equal(ok.engine.getStat(ok.id("mer"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("mer"), "life"), 7);
});

clause(MERLION, "0:rule", "deployed from hand it enters play with exactly 2 tokens (none while it waits for responses)", () => {
  const game = merlionDeployBoard();
  playRaw(game.engine, P1, game.id("mer"));
  assert.equal(tokensOn(game.engine, game.id("mer")), 0, "not in play yet");
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("mer")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "0:rule", "put into play by an effect (not deployed) it also enters with exactly 2 tokens", () => {
  const game = merlionDeployBoard({ extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("mer")] } });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("mer")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "0:rule", "each copy gets its own 2 tokens: a second Merlion deployed later has 2 and the first keeps its count", () => {
  const game = devBoard(
    [
      { key: "first", def: printing(MERLION), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "second", def: printing(MERLION), owner: P1, zone: "hand" },
      ...bank("greed", 9, P1)
    ],
    { turn: 1 }
  );
  play(game.engine, P1, game.id("second"));
  drain(game.engine, declineAll);
  assert.equal(tokensOn(game.engine, game.id("second")), 2);
  assert.equal(tokensOn(game.engine, game.id("first")), 1, "the Merlion already in play gains nothing");
});

clause(MERLION, "0:rule", "only this card enters with tokens: another character entering play adds none to a Merlion in play", () => {
  const game = devBoard(
    [
      { key: "mer", def: printing(MERLION), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1)
    ],
    { turn: 1 }
  );
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 1);
});

const merlionBounceBoard = () =>
  devBoard(
    [
      { key: "mer", def: printing(MERLION), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "bounce", def: bounceCardTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 9, P1)
    ],
    { turn: 1 }
  );

clause(MERLION, "0:rule", "a Merlion that left play and comes back enters with exactly 2 tokens, not 2 plus leftovers", () => {
  const game = merlionBounceBoard();
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("mer")] } });
  assert.equal(zoneOf(game.engine, game.id("mer")), "hand");
  play(game.engine, P1, game.id("mer"));
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("mer")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "0:rule", "its tokens disappear when it leaves play (CR 409.2): none are left on it in my hand", () => {
  const game = merlionBounceBoard();
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("mer")] } });
  assert.equal(zoneOf(game.engine, game.id("mer")), "hand");
  assert.equal(tokensOn(game.engine, game.id("mer")), 0);
});

clause(MERLION, "0:rule", "played face-down as a resource it is only a Volition resource: no tokens", () => {
  const game = devBoard([{ key: "mer", def: printing(MERLION), owner: P1, zone: "hand" }], { turn: 1 });
  developResource(game.engine, P1, game.id("mer"), true);
  assert.equal(game.engine.state.cards[game.id("mer")].faceDown, true);
  assert.equal(tokensOn(game.engine, game.id("mer")), 0);
});

// --- the reclaim trigger ----------------------------------------------------

interface ReclaimOpts {
  tokens?: number;
  rage?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

const victimDef = (name = "Victim", extra: Partial<CardDefinition> = {}) => character({ name, strength: 2, life: 3, speed: 2, cost: 2, ...extra });

function reclaimBoard(o: ReclaimOpts = {}) {
  return devBoard(
    [
      { key: "mer", def: printing(MERLION), owner: P1, zone: "play", counters: { token: o.tokens ?? 2 } },
      { key: "victim", def: victimDef(), owner: P1, zone: "play" },
      { key: "victim2", def: victimDef("Second Victim"), owner: P1, zone: "play" },
      { key: "foeChar", def: victimDef("Foe Char"), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "foeKill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 3, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const killVictim = (game: ReturnType<typeof reclaimBoard>, key = "victim") => play(game.engine, P1, game.id("kill"), { selected: { t: [game.id(key)] } });

clause(MERLION, "1:rule", "when my character is destroyed I am offered a 'may pay' (I am the one asked)", () => {
  const game = reclaimBoard();
  killVictim(game);
  const pc = expectPending(game.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard", "it is in the discard pile while I decide");
});

clause(MERLION, "1:rule", "accepting pays exactly 1 resource and removes exactly 1 token, and the character returns to play under my control", () => {
  const game = reclaimBoard({ tokens: 2, rage: 3 });
  killVictim(game);
  drain(game.engine, payYes);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(game.engine.state.cards[game.id("victim")].controllerId, P1);
  assert.ok(game.engine.state.players[P1].play.includes(game.id("victim")), "game.engine.state.players[P1].play.includes(game.id(\"victim\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("victim")), "!discardOf(game.engine, P1).includes(game.id(\"victim\"))");
  assert.equal(tokensOn(game.engine, game.id("mer")), 1, "one token removed");
  assert.equal(ready(game.engine), 2, "one resource paid");
});

clause(MERLION, "1:rule", "the returned character is depleted ('Deplete it')", () => {
  const game = reclaimBoard();
  killVictim(game);
  drain(game.engine, payYes);
  assert.equal(game.engine.state.cards[game.id("victim")].depleted, true);
});

clause(MERLION, "1:rule", "the returned character is a fresh object: its damage is gone", () => {
  const game = reclaimBoard();
  game.engine.state.cards[game.id("victim")].damage = 2;
  killVictim(game);
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(game.engine.state.cards[game.id("victim")].damage, 0);
});

clause(MERLION, "1:rule", "declining costs nothing: no resource, no token, and the character stays in the discard pile", () => {
  const game = reclaimBoard({ tokens: 2, rage: 3 });
  killVictim(game);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
  assert.equal(ready(game.engine), 3);
});

clause(MERLION, "1:rule", "without a token on it the cost cannot be paid: nothing is paid and the character stays in the discard pile", () => {
  const game = reclaimBoard({ tokens: 0, rage: 3 });
  killVictim(game);
  drain(game.engine, payYes);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard");
  assert.equal(ready(game.engine), 3, "no resource was paid for a cost that could not be completed");
  assert.equal(tokensOn(game.engine, game.id("mer")), 0);
});

clause(MERLION, "1:rule", "without a resource to pay 1 the cost cannot be paid: the token stays and the character stays in the discard pile", () => {
  const game = reclaimBoard({ tokens: 2, rage: 0 });
  killVictim(game);
  drain(game.engine, payYes);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2, "no token is removed when the 1 cannot be paid");
});

clause(MERLION, "1:rule", "the 2 tokens allow two reclaims and no third", () => {
  const game = reclaimBoard({ tokens: 2, rage: 3, extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }, { key: "kill3", def: killTactic(), owner: P1, zone: "hand" }, { key: "victim3", def: victimDef("Third Victim"), owner: P1, zone: "play" }] });
  killVictim(game, "victim");
  drain(game.engine, payYes);
  play(game.engine, P1, game.id("kill2"), { selected: { t: [game.id("victim2")] } });
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(zoneOf(game.engine, game.id("victim2")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 0);
  assert.equal(ready(game.engine), 1, "two resources paid");
  play(game.engine, P1, game.id("kill3"), { selected: { t: [game.id("victim3")] } });
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("victim3")), "discard", "no token left: no third reclaim");
  assert.equal(ready(game.engine), 1);
});

clause(MERLION, "1:rule", "it triggers on the opponent's turn too (their tactic destroys my character; I am asked)", () => {
  const game = reclaimBoard({ active: P2 });
  play(game.engine, P2, game.id("foeKill"), { selected: { t: [game.id("victim")] } });
  const pc = expectPending(game.engine, "mayPay");
  assert.equal(pc.playerId, P1, "I decide, not the opponent");
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(game.engine.state.cards[game.id("victim")].controllerId, P1);
});

clause(MERLION, "1:rule", "it triggers when my character dies in battle", () => {
  const game = reclaimBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("victim")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard", "3 life vs 5 damage");
  const pc = expectPending(game.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  drain(game.engine, payYes);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(game.engine.state.cards[game.id("victim")].depleted, true);
  assert.equal(tokensOn(game.engine, game.id("mer")), 1);
});

clause(MERLION, "1:rule", "'put into your discard pile from play' is not only destruction: a character moved to my discard pile by an effect triggers it too", () => {
  const game = reclaimBoard({ extra: [{ key: "cast", def: discardFromPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("cast"), { selected: { t: [game.id("victim")] } });
  expectPending(game.engine, "mayPay");
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(tokensOn(game.engine, game.id("mer")), 1);
});

clause(MERLION, "1:rule", "an opponent's character put into THEIR discard pile does not trigger it", () => {
  const game = reclaimBoard();
  killVictim(game, "foeChar");
  assert.equal(zoneOf(game.engine, game.id("foeChar")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "nothing is offered");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
  assert.equal(ready(game.engine), 3);
});

clause(MERLION, "1:rule", "a character I control but the opponent owns goes to THEIR discard pile, not mine: no trigger", () => {
  const game = reclaimBoard({ extra: [{ key: "loaned", def: victimDef("Loaned"), owner: P2, controller: P1, zone: "play" }] });
  killVictim(game, "loaned");
  assert.equal(zoneOf(game.engine, game.id("loaned")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("loaned")), "it is in its owner's discard pile");
  assert.equal(game.engine.state.pendingChoice, undefined, "it did not go into MY discard pile");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "a character I own but the opponent controls is not 'a character you control' when it dies: no trigger", () => {
  const game = reclaimBoard({ extra: [{ key: "stolen", def: victimDef("Stolen"), owner: P1, controller: P2, zone: "play" }] });
  killVictim(game, "stolen");
  assert.equal(zoneOf(game.engine, game.id("stolen")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("stolen")), "discardOf(game.engine, P1).includes(game.id(\"stolen\"))");
  assert.equal(game.engine.state.pendingChoice, undefined, "I did not control it");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "a character discarded from my HAND is not 'from play': no trigger", () => {
  const discardHand = tactic({
    name: "Dump Hand Card",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
  const game = reclaimBoard({
    extra: [
      { key: "dump", def: discardHand, owner: P1, zone: "hand" },
      { key: "inHand", def: victimDef("Hand Guy"), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("dump"), { selected: { t: [game.id("inHand")] } });
  assert.equal(zoneOf(game.engine, game.id("inHand")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "a character milled from my DECK into my discard pile is not 'from play': no trigger", () => {
  const mill = tactic({
    name: "Mill One",
    cost: 0,
    behavior: { abilities: [{ id: "mill", type: "activated", effects: [{ type: "mill", player: "controller", count: 1 }] }] }
  });
  const game = reclaimBoard({
    extra: [
      { key: "mill", def: mill, owner: P1, zone: "hand" },
      { key: "top", def: victimDef("Top Card"), owner: P1, zone: "deck" }
    ]
  });
  play(game.engine, P1, game.id("mill"));
  assert.equal(zoneOf(game.engine, game.id("top")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "an item or a location of mine destroyed is not a character: no trigger", () => {
  const smash = tactic({
    name: "Smash Anything",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "smash",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", owner: "self" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const game = reclaimBoard({
    extra: [
      { key: "smash", def: smash, owner: P1, zone: "hand" },
      { key: "smash2", def: smash, owner: P1, zone: "hand" },
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "hall", def: location({ name: "Hall", structure: 3 }), owner: P1, zone: "play" }
    ]
  });
  play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("gizmo")] } });
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
  play(game.engine, P1, game.id("smash2"), { selected: { t: [game.id("hall")] } });
  assert.equal(zoneOf(game.engine, game.id("hall")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "a face-down card (only a resource) destroyed is not a character: no trigger", () => {
  const game = reclaimBoard({
    extra: [
      { key: "smashRes", def: smashResourceTactic(), owner: P1, zone: "hand" },
      { key: "hidden", def: victimDef("Hidden Guy"), owner: P1, zone: "play", faceDown: true }
    ]
  });
  play(game.engine, P1, game.id("smashRes"), { selected: { t: [game.id("hidden")] } });
  assert.equal(zoneOf(game.engine, game.id("hidden")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "a face-down card is only a resource");
  assert.equal(tokensOn(game.engine, game.id("mer")), 2);
});

clause(MERLION, "1:rule", "the Merlion itself, when destroyed, cannot reclaim itself: its tokens vanish with it (CR 409.2)", () => {
  const game = reclaimBoard();
  killVictim(game, "mer");
  assert.equal(zoneOf(game.engine, game.id("mer")), "discard");
  drain(game.engine, payYes);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mer")), "discard", "it stays in the discard pile");
  assert.equal(ready(game.engine), 3, "nothing was paid");
});

clause(MERLION, "1:rule", "the returned character is put into play, so ITS enters-play trigger fires", () => {
  const welcome = victimDef("Welcome Wagon", {
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
        }
      ]
    }
  });
  const game = reclaimBoard({ extra: [{ key: "wagon", def: welcome, owner: P1, zone: "play" }] });
  killVictim(game, "wagon");
  drain(game.engine, payYes);
  assert.equal(zoneOf(game.engine, game.id("wagon")), "play");
  assert.equal(influenceOf(game.engine, P1), START + 2, "its enters-play trigger gave me 2 influence");
});

clause(MERLION, "1:rule", "two characters dying at once: each can be reclaimed while tokens last (2 tokens: both back, 2 paid)", () => {
  const sweep = tactic({
    name: "Sweep Victims",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [{ type: "forEach", selector: { type: "character", owner: "self", name: "Victim" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
  const mk = (tokens: number) =>
    reclaimBoard({
      tokens,
      rage: 3,
      extra: [
        { key: "sweep", def: sweep, owner: P1, zone: "hand" },
        { key: "victimB", def: victimDef("Victim"), owner: P1, zone: "play" }
      ]
    });
  const two = mk(2);
  play(two.engine, P1, two.id("sweep"));
  drain(two.engine, payYes);
  assert.equal(zoneOf(two.engine, two.id("victim")), "play");
  assert.equal(zoneOf(two.engine, two.id("victimB")), "play");
  assert.equal(tokensOn(two.engine, two.id("mer")), 0);
  assert.equal(ready(two.engine), 1);
  const one = mk(1);
  play(one.engine, P1, one.id("sweep"));
  drain(one.engine, payYes);
  const back = ["victim", "victimB"].filter((key) => zoneOf(one.engine, one.id(key)) === "play");
  assert.equal(back.length, 1, "one token: only one of the two returns");
  assert.equal(tokensOn(one.engine, one.id("mer")), 0);
  assert.equal(ready(one.engine), 2);
});

// =============================================================================
// Balthassar Gristwalter
// UNIQUE BALTHASSAR
// SCHMOOZE -- COST: Deplete this card. -- EFFECT: Draw a card.
// Character (politician, mau), cost 4, threshold [G][G][G], 1 / 3 / 5.
// =============================================================================

const BALTH = "22b26c82-ef59-4885-8d11-e58a81c660da";

function balthBoard(o: { deck?: number; balthZone?: "play" | "hand" | "discard"; extra?: CardPlacement[]; turn?: number; active?: PlayerId; depleted?: boolean; faceDown?: boolean; greed?: number; rage?: number } = {}) {
  return devBoard(
    [
      { key: "b", def: printing(BALTH), owner: P1, zone: o.balthZone ?? "play", depleted: o.depleted, faceDown: o.faceDown },
      ...fillers("d", o.deck ?? 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 2, activePlayerId: o.active ?? P1 }
  );
}

const copyInHand = (key = "b2"): CardPlacement => ({ key, def: printing(BALTH), owner: P1, zone: "hand" });

clause(BALTH, "0:unique", "the card itself: cost 4 with [G][G][G] - refused at 3 resources and with only two [G]; accepted at 4; printed 1 / 3 / 5", () => {
  const short = balthBoard({ balthZone: "hand", greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("b")), "3 resources for cost 4");
  const twoGreed = balthBoard({ balthZone: "hand", greed: 2, rage: 5 });
  refused(() => playRaw(twoGreed.engine, P1, twoGreed.id("b")), "only two [G]");
  const ok = balthBoard({ balthZone: "hand", greed: 3, rage: 2 });
  play(ok.engine, P1, ok.id("b"));
  assert.equal(zoneOf(ok.engine, ok.id("b")), "play");
  assert.equal(ready(ok.engine), 1, "4 of 5 paid");
  assert.equal(ok.engine.getStat(ok.id("b"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("b"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("b"), "life"), 5);
});

clause(BALTH, "0:unique", "a second Balthassar entering play raises a keep-one choice for me, and keeping the OLD one destroys the new one", () => {
  const game = balthBoard({ greed: 4, extra: [copyInHand()] });
  play(game.engine, P1, game.id("b2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "I control both, so I choose");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("b"), game.id("b2")].sort());
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("b") });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  assert.equal(zoneOf(game.engine, game.id("b2")), "discard", "the extra copy is destroyed");
});

clause(BALTH, "0:unique", "keeping the NEW Balthassar destroys the old one, and the game goes on (no soft-lock)", () => {
  const game = balthBoard({ greed: 4, extra: [copyInHand()] });
  play(game.engine, P1, game.id("b2"));
  expectPending(game.engine, "uniqueSurvivor");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("b2") });
  assert.equal(game.engine.state.pendingChoice, undefined, "the choice is settled");
  assert.equal(zoneOf(game.engine, game.id("b2")), "play");
  assert.equal(zoneOf(game.engine, game.id("b")), "discard", "the old copy is destroyed");
  activate(game.engine, P1, game.id("b2"), "schmooze");
  assert.equal(handOf(game.engine, P1).length, 1, "the survivor works: the game is not stuck");
});

clause(BALTH, "0:unique", "the destroyed duplicate goes to its owner's discard pile (not removed, not hand)", () => {
  const game = balthBoard({ greed: 4, extra: [copyInHand()] });
  play(game.engine, P1, game.id("b2"));
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("b") });
  assert.ok(discardOf(game.engine, P1).includes(game.id("b2")), "discardOf(game.engine, P1).includes(game.id(\"b2\"))");
  assert.ok(!handOf(game.engine, P1).includes(game.id("b2")), "!handOf(game.engine, P1).includes(game.id(\"b2\"))");
});

clause(BALTH, "0:unique", "the choice is refused unless it keeps one of the candidates", () => {
  const game = balthBoard({ greed: 4, extra: [copyInHand(), { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" }] });
  play(game.engine, P1, game.id("b2"));
  expectPending(game.engine, "uniqueSurvivor");
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("bystander") } } as never),
    "keeping a card that is not a Balthassar"
  );
  assert.ok(pending(game.engine), "the choice is still open");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("b") });
  assert.equal(zoneOf(game.engine, game.id("bystander")), "play", "the bystander is untouched");
});

clause(BALTH, "0:unique", "the restriction is per player: my opponent controlling their own Balthassar causes no conflict", () => {
  const game = balthBoard({ extra: [{ key: "theirs", def: printing(BALTH), owner: P2, zone: "play" }] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
});

clause(BALTH, "0:unique", "the opponent deploying their own Balthassar while I have mine in play is fine", () => {
  const game = balthBoard({
    active: P2,
    extra: [{ key: "theirs", def: printing(BALTH), owner: P2, zone: "hand" }, ...bank("greed", 4, P2)]
  });
  play(game.engine, P2, game.id("theirs"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
});

clause(BALTH, "0:unique", "taking control of the opponent's Balthassar while I control mine makes me keep only one", () => {
  const steal = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = balthBoard({ extra: [{ key: "theirs", def: printing(BALTH), owner: P2, zone: "play" }, { key: "grab", def: steal, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("grab"), { selected: { t: [game.id("theirs")] } });
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("theirs") } } as never);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
  assert.equal(game.engine.state.cards[game.id("theirs")].controllerId, P1, "I keep the stolen one");
  assert.equal(zoneOf(game.engine, game.id("b")), "discard");
});

clause(BALTH, "0:unique", "a UNIQUE conflict raised while a tactic is resolving (take control of the opponent's copy) does not freeze the game once I have chosen", () => {
  const steal = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = balthBoard({ extra: [{ key: "theirs", def: printing(BALTH), owner: P2, zone: "play" }, { key: "grab", def: steal, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("grab"), { selected: { t: [game.id("theirs")] } });
  expectPending(game.engine, "uniqueSurvivor");
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("theirs") } } as never);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(settles(game.engine), true, "the tactic finishes resolving");
  assert.equal(game.engine.state.responseWindow, undefined, "no response window is left hanging");
  assert.equal(zoneOf(game.engine, game.id("grab")), "discard", "the resolved tactic goes to my discard pile instead of staying 'being deployed'");
});

clause(BALTH, "0:unique", "a different card with the same designation counts as a duplicate (UNIQUE BALTHASSAR is the designation, not the name)", () => {
  const impostor = character({ name: "Impostor Balthassar", unique: "balthassar", strength: 1, life: 2, speed: 1 });
  const game = balthBoard({ extra: [{ key: "imp", def: impostor, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("imp"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("b"), game.id("imp")].sort());
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("b") });
  assert.equal(zoneOf(game.engine, game.id("imp")), "discard");
});

clause(BALTH, "0:unique", "a card with a different Unique designation does not conflict with it", () => {
  const someone = character({ name: "Someone Else", unique: "someone-else", strength: 1, life: 2, speed: 1 });
  const game = balthBoard({ extra: [{ key: "oth", def: someone, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("oth"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  assert.equal(zoneOf(game.engine, game.id("oth")), "play");
});

clause(BALTH, "0:unique", "copies in my hand, discard pile or deck do not conflict; only cards in play do", () => {
  const game = balthBoard({
    extra: [
      { key: "inHand", def: printing(BALTH), owner: P1, zone: "hand" },
      { key: "inDiscard", def: printing(BALTH), owner: P1, zone: "discard" },
      { key: "inDeck", def: printing(BALTH), owner: P1, zone: "deck" }
    ]
  });
  assert.equal(game.engine.state.pendingChoice, undefined);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
});

clause(BALTH, "0:unique", "a face-down copy (only a resource, no characteristics) does not conflict with a face-up one", () => {
  const game = balthBoard({ extra: [{ key: "hidden", def: printing(BALTH), owner: P1, zone: "play", faceDown: true }] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("hidden")), "play");
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  const dev = balthBoard({ extra: [copyInHand()] });
  developResource(dev.engine, P1, dev.id("b2"), true);
  assert.equal(dev.engine.state.pendingChoice, undefined, "playing the second copy face-down as a resource is fine");
  assert.equal(zoneOf(dev.engine, dev.id("b")), "play");
});

clause(BALTH, "0:unique", "a second copy PUT into play by an effect (not deployed) also conflicts", () => {
  const game = balthBoard({ extra: [copyInHand(), { key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("b2")] } });
  expectPending(game.engine, "uniqueSurvivor");
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("b2") } } as never);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("b2")), "play");
  assert.equal(zoneOf(game.engine, game.id("b")), "discard");
});

clause(BALTH, "0:unique", "a UNIQUE conflict raised while a tactic is resolving (put the second copy into play) does not freeze the game once I have chosen", () => {
  const game = balthBoard({ extra: [copyInHand(), { key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("b2")] } });
  expectPending(game.engine, "uniqueSurvivor");
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("b2") } } as never);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(settles(game.engine), true, "the tactic finishes resolving");
  assert.equal(game.engine.state.responseWindow, undefined, "no response window is left hanging");
  assert.equal(zoneOf(game.engine, game.id("pip")), "discard", "the resolved tactic goes to my discard pile instead of staying 'being deployed'");
});

// --- SCHMOOZE ----------------------------------------------------------------

clause(BALTH, "1:ability:schmooze", "draws exactly one card (the top of the deck) and depletes it; the deck shrinks by one", () => {
  const game = balthBoard();
  const top = deckOf(game.engine, P1)[0];
  const deckBefore = deckOf(game.engine, P1).length;
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.deepEqual(handOf(game.engine, P1), [top]);
  assert.equal(deckOf(game.engine, P1).length, deckBefore - 1);
  assert.equal(game.engine.state.cards[game.id("b")].depleted, true);
});

clause(BALTH, "1:ability:schmooze", "the deplete cost is paid when it is used, the draw happens when it resolves", () => {
  const game = balthBoard();
  actRaw(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(game.engine.state.cards[game.id("b")].depleted, true, "cost already paid");
  assert.equal(handOf(game.engine, P1).length, 0, "nothing drawn while responses are possible");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BALTH, "1:ability:schmooze", "costs no resources", () => {
  const game = balthBoard({ rage: 3 });
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(ready(game.engine), 3);
});

clause(BALTH, "1:ability:schmooze", "refused while already depleted (nothing drawn); works once it is restored", () => {
  const game = balthBoard({ depleted: true });
  refused(() => actRaw(game.engine, P1, game.id("b"), "schmooze"), "already depleted");
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(deckOf(game.engine, P1).length, 3);
  game.engine.state.cards[game.id("b")].depleted = false;
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(handOf(game.engine, P1).length, 1, "control: a ready Balthassar can");
});

clause(BALTH, "1:ability:schmooze", "can be used again after being restored, drawing one more card each time", () => {
  const game = balthBoard();
  activate(game.engine, P1, game.id("b"), "schmooze");
  refused(() => actRaw(game.engine, P1, game.id("b"), "schmooze"), "depleted by the first use");
  game.engine.state.cards[game.id("b")].depleted = false;
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(handOf(game.engine, P1).length, 2);
});

clause(BALTH, "1:ability:schmooze", "usable the turn it enters play (CR 204.3a)", () => {
  const game = balthBoard({ balthZone: "hand", greed: 3, rage: 1 });
  play(game.engine, P1, game.id("b"));
  assert.equal(zoneOf(game.engine, game.id("b")), "play");
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BALTH, "1:ability:schmooze", "only its controller can use it: the opponent is refused", () => {
  const game = balthBoard({ extra: bank("rage", 3, P2) });
  refused(() => actRaw(game.engine, P2, game.id("b"), "schmooze"), "my opponent using my ability");
  assert.equal(game.engine.state.cards[game.id("b")].depleted, false);
  assert.equal(handOf(game.engine, P2).length, 0);
});

for (const zone of ["hand", "discard"] as const) {
  clause(BALTH, "1:ability:schmooze", `cannot be used from my ${zone} (it is an in-play ability)`, () => {
    const game = balthBoard({ balthZone: zone });
    refused(() => actRaw(game.engine, P1, game.id("b"), "schmooze"), `from ${zone}`);
    assert.equal(handOf(game.engine, P1).length, zone === "hand" ? 1 : 0, "only the Balthassar itself is in my hand");
    assert.equal(deckOf(game.engine, P1).length, 3);
  });
}

clause(BALTH, "1:ability:schmooze", "a face-down Balthassar is only a resource and has no ability", () => {
  const game = balthBoard({ faceDown: true });
  refused(() => actRaw(game.engine, P1, game.id("b"), "schmooze"), "face-down");
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(BALTH, "1:ability:schmooze", "with an empty deck it still depletes, draws nothing and the controller does not lose", () => {
  const game = balthBoard({ deck: 0 });
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(game.engine.state.cards[game.id("b")].depleted, true);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
});

clause(BALTH, "1:ability:schmooze", "draws for its controller only: the opponent's hand and deck are untouched", () => {
  const game = balthBoard();
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(BALTH, "1:ability:schmooze", "can be used in response on the opponent's turn (any time an ability could be used)", () => {
  const game = balthBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  activate(game.engine, P1, game.id("b"), "schmooze");
  assert.equal(handOf(game.engine, P1).length, 1);
  assert.equal(game.engine.state.cards[game.id("b")].depleted, true);
});

clause(BALTH, "1:ability:schmooze", "using it depletes the Balthassar, so it can no longer block", () => {
  const game = balthBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  activate(game.engine, P1, game.id("b"), "schmooze");
  resolvePendingResponses(game.engine);
  refused(() => declareBlockers(game.engine, P1, [game.id("b")]), "a depleted character cannot block");
});

// =============================================================================
// Because God Said So!
// COST: Pick a blocking character.
// EFFECT: This turn, the character gains 5 strength and 5 life.
// Tactic, cost 2, threshold [G][G].
// =============================================================================

const BGSS = "ee300a90-eb6b-4e31-a7a5-b93a60d8a8a7";

interface GodOpts {
  /** "defending": the opponent attacks me and I block. "attacking": I attack and the opponent blocks. */
  side?: "defending" | "attacking";
  /** "blocked": blockers declared and I hold priority in the battle window. "attacked": attack declared, no blockers yet, I hold priority. "none": no battle. */
  stage?: "blocked" | "attacked" | "none";
  greed?: number;
  rage?: number;
  extra?: CardPlacement[];
  blockers?: string[];
  attackerLife?: number;
  attackerStrength?: number;
}

function godBoard(o: GodOpts = {}) {
  const side = o.side ?? "defending";
  const stage = o.stage ?? "blocked";
  const defender = side === "defending" ? P1 : P2;
  const attacker = other(defender);
  const game = devBoard(
    [
      { key: "bg", def: printing(BGSS), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Raider", strength: o.attackerStrength ?? 6, life: o.attackerLife ?? 9, speed: 3 }), owner: attacker, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: defender, zone: "play" },
      { key: "blk2", def: character({ name: "Second Blocker", strength: 1, life: 3, speed: 1 }), owner: defender, zone: "play" },
      { key: "idleMine", def: character({ name: "Idle Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "idleTheirs", def: character({ name: "Idle Theirs", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: attacker }
  );
  if (stage === "attacked") {
    declareAttackOpenWindow(game.engine, attacker, [game.id("atk")]);
    if (side === "attacking") assert.equal(game.engine.state.priorityPlayerId, P1);
  } else if (stage === "blocked") {
    declareAttackBy(game.engine, attacker, [game.id("atk")]);
    declareBlockers(game.engine, defender, (o.blockers ?? ["blk"]).map((key) => game.id(key)));
    passUntil(game.engine, P1);
    assert.equal(game.engine.state.priorityPlayerId, P1);
  }
  return game;
}

const playGod = (game: ReturnType<typeof godBoard>, pick: string[]) => playRaw(game.engine, P1, game.id("bg"), { selected: { c: pick.map((key) => game.id(key)) } });
const finishGod = (game: ReturnType<typeof godBoard>, pick: string[]) => {
  playGod(game, pick);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
};

clause(BGSS, "0:ability", "the card itself: refused one resource short of cost 2 and without [G][G]; pays exactly 2", () => {
  const short = godBoard({ greed: 1, rage: 0 });
  refused(() => playGod(short, ["blk"]), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("bg")), "hand");
  const oneGreed = godBoard({ greed: 1, rage: 5 });
  refused(() => playGod(oneGreed, ["blk"]), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("bg")), "hand");
  const ok = godBoard({ greed: 2, rage: 2 });
  assert.equal(ready(ok.engine), 4);
  finishGod(ok, ["blk"]);
  assert.equal(ready(ok.engine), 2, "exactly 2 paid");
  assert.equal(zoneOf(ok.engine, ok.id("bg")), "discard", "a resolved tactic goes to my discard pile");
});

clause(BGSS, "0:ability", "picks a blocking character of mine (I am defending)", () => {
  const game = godBoard({ side: "defending", blockers: ["blk"] });
  finishGod(game, ["blk"]);
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 6);
});

clause(BGSS, "0:ability", "'a blocking character' is not limited to mine: when I attack I can pick the opponent's blocker", () => {
  const game = godBoard({ side: "attacking", blockers: ["blk"], attackerStrength: 2 });
  finishGod(game, ["blk"]);
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 6, "the opponent's blocker gained 5 strength");
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 8);
});

clause(BGSS, "0:ability", "cannot pick an attacking character (even one of the right type)", () => {
  const bad = godBoard({ side: "defending" });
  refused(() => playGod(bad, ["atk"]), "an attacker is not a blocker");
  assert.equal(zoneOf(bad.engine, bad.id("bg")), "hand");
  assert.equal(ready(bad.engine), 4, "nothing was paid");
  const mine = godBoard({ side: "attacking" });
  refused(() => playGod(mine, ["atk"]), "my own attacker is not a blocker either");
  const good = godBoard({ side: "defending" });
  finishGod(good, ["blk"]);
  assert.equal(good.engine.getStat(good.id("blk"), "life"), 8, "control: the blocker works");
});

clause(BGSS, "0:ability", "cannot pick a character that is in play but not blocking (mine or theirs), nor a blocker-to-be that was not declared", () => {
  for (const key of ["idleMine", "idleTheirs", "blk2"]) {
    const bad = godBoard({ side: "defending", blockers: ["blk"] });
    refused(() => playGod(bad, [key]), `${key} is not in the blocking party`);
    assert.equal(zoneOf(bad.engine, bad.id("bg")), "hand");
  }
  const good = godBoard({ side: "defending", blockers: ["blk"] });
  finishGod(good, ["blk"]);
  assert.equal(good.engine.getStat(good.id("blk"), "strength"), 6, "control");
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P1, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P1, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P1, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })]
] as const) {
  clause(BGSS, "0:ability", `cannot pick ${label}`, () => {
    const bad = godBoard({ extra: [make()] });
    refused(() => playGod(bad, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("bg")), "hand");
    const good = godBoard({ extra: [make()] });
    finishGod(good, ["blk"]);
    assert.equal(good.engine.getStat(good.id("blk"), "strength"), 6, "control");
  });
}

clause(BGSS, "0:ability", "cannot pick a faction", () => {
  const bad = godBoard();
  refused(() => playGod(bad, []), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("bg"), { selected: { c: [bad.engine.state.players[P1].factionId!] } }), "my faction");
  refused(() => playRaw(bad.engine, P1, bad.id("bg"), { selected: { c: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  assert.equal(zoneOf(bad.engine, bad.id("bg")), "hand");
});

clause(BGSS, "0:ability", "needs exactly one pick: two blockers are refused", () => {
  const game = godBoard({ blockers: ["blk", "blk2"] });
  refused(() => playGod(game, ["blk", "blk2"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("bg")), "hand");
  finishGod(game, ["blk2"]);
  assert.equal(game.engine.getStat(game.id("blk2"), "strength"), 6, "either blocker can be the one pick");
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 1, "the other blocker is unchanged");
});

clause(BGSS, "0:ability", "refused when no battle is going on", () => {
  const game = godBoard({ stage: "none", side: "attacking" });
  game.engine.state.priorityPlayerId = P1;
  refused(() => playGod(game, ["blk"]), "nobody is blocking");
  assert.equal(zoneOf(game.engine, game.id("bg")), "hand");
});

clause(BGSS, "0:ability", "refused after the attack is declared but before blockers are: nobody is blocking yet", () => {
  const game = godBoard({ stage: "attacked", side: "defending" });
  refused(() => playGod(game, ["blk"]), "blockers not declared yet");
  assert.equal(zoneOf(game.engine, game.id("bg")), "hand");
  assert.equal(ready(game.engine), 4);
});

clause(BGSS, "0:ability", "refused after the battle is over: the character is no longer blocking", () => {
  const game = godBoard({ side: "defending", attackerStrength: 1 });
  resolvePendingResponses(game.engine);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  refused(() => playGod(game, ["blk"]), "no battle any more");
  assert.equal(zoneOf(game.engine, game.id("bg")), "hand");
});

clause(BGSS, "0:ability", "the character gains exactly 5 strength and 5 life (printed 1 / 3 -> 6 / 8), speed unchanged; damage already taken stays", () => {
  const game = godBoard();
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 3);
  game.engine.state.cards[game.id("blk")].damage = 2;
  finishGod(game, ["blk"]);
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 6);
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 8);
  assert.equal(game.engine.getStat(game.id("blk"), "speed"), 1);
  assert.equal(game.engine.state.cards[game.id("blk")].damage, 2);
  assert.equal(zoneOf(game.engine, game.id("blk")), "play");
});

clause(BGSS, "0:ability", "only the picked character is affected: the attacker, the other blocker and bystanders keep their stats", () => {
  const game = godBoard({ blockers: ["blk", "blk2"] });
  finishGod(game, ["blk"]);
  for (const key of ["atk", "blk2", "idleMine", "idleTheirs"]) {
    const printed = game.engine.getDefinition(game.id(key));
    assert.equal(game.engine.getStat(game.id(key), "strength"), printed.strength, `${key} strength`);
    assert.equal(game.engine.getStat(game.id(key), "life"), printed.life, `${key} life`);
  }
});

clause(BGSS, "0:ability", "the +5 life is real in battle: a 3-life blocker survives an attacker of strength 6 (control: it dies without the card)", () => {
  const without = godBoard({ attackerStrength: 6 });
  resolvePendingResponses(without.engine);
  autoResolveBattle(without.engine);
  assert.equal(zoneOf(without.engine, without.id("blk")), "discard", "control: 3 life vs 6 damage");

  const game = godBoard({ attackerStrength: 6 });
  finishGod(game, ["blk"]);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("blk")), "play", "8 life survives 6 damage");
  assert.equal(game.engine.state.cards[game.id("blk")].damage, 6);
});

clause(BGSS, "0:ability", "the +5 strength is real in battle: a 1-strength blocker now destroys a 6-life attacker", () => {
  const without = godBoard({ attackerStrength: 1, attackerLife: 6 });
  resolvePendingResponses(without.engine);
  autoResolveBattle(without.engine);
  assert.equal(zoneOf(without.engine, without.id("atk")), "play", "control: 1 damage does not kill a 6-life attacker");

  const game = godBoard({ attackerStrength: 1, attackerLife: 6 });
  finishGod(game, ["blk"]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard", "6 damage destroys it");
  assert.equal(zoneOf(game.engine, game.id("blk")), "play");
});

clause(BGSS, "0:ability", "'this turn': the bonus is still there after the battle, and gone when the next turn starts", () => {
  const game = godBoard({ attackerStrength: 1 });
  finishGod(game, ["blk"]);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 6, "still this turn");
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 8);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1, "the next turn began");
  assert.equal(game.engine.getStat(game.id("blk"), "strength"), 1, "the effect ended");
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 3);
});

clause(BGSS, "0:ability", "playable by the attacker after blockers: it can also buff the opponent's blocker, and that blocker's bonus ends with the turn", () => {
  const game = godBoard({ side: "attacking", attackerStrength: 2 });
  finishGod(game, ["blk"]);
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 8);
  autoResolveBattle(game.engine);
  endTurn(game.engine, P1);
  assert.equal(game.engine.getStat(game.id("blk"), "life"), 3);
});

// =============================================================================
// Black Scourge of the Brine
// ENCROACH: [G][G][G][G][G] -- COST: Pay 1. -- EFFECT: This turn, this card gains COVERT.
// Character (pirate, mercenary, mau), cost 7, threshold [G], 4 / 3 / 7.
// =============================================================================

const SCOURGE = "7486055f-27a9-4a78-9d9f-3420e031dcdc";

function scourgeBoard(o: { greed?: number; rage?: number; spent?: number; zone?: "play" | "hand" | "discard"; faceDown?: boolean; extra?: CardPlacement[]; active?: PlayerId; turn?: number } = {}) {
  return devBoard(
    [
      { key: "bs", def: printing(SCOURGE), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown },
      { key: "ally", def: character({ name: "Plain Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "plainFoe", def: character({ name: "Plain Foe", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "covertFoe", def: character({ name: "Covert Foe", strength: 1, life: 6, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 5, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 2, activePlayerId: o.active ?? P1 }
  );
}

const hasCovert = (game: ReturnType<typeof scourgeBoard>, key = "bs") => (game.engine.getKeywords(game.id(key)) as string[]).includes("covert");
const encroach = (game: ReturnType<typeof scourgeBoard>, player: PlayerId = P1) => actRaw(game.engine, player, game.id("bs"), "encroach");

clause(SCOURGE, "0:ability:encroach", "the card itself: cost 7 with [G] - refused at 6 resources and with no [G]; accepted at exactly 7; printed 4 / 3 / 7", () => {
  const short = scourgeBoard({ zone: "hand", greed: 1, rage: 5 });
  refused(() => playRaw(short.engine, P1, short.id("bs")), "6 resources for cost 7");
  const noGreed = scourgeBoard({ zone: "hand", greed: 0, rage: 8 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("bs")), "no [G]");
  const ok = scourgeBoard({ zone: "hand", greed: 1, rage: 6 });
  play(ok.engine, P1, ok.id("bs"));
  assert.equal(zoneOf(ok.engine, ok.id("bs")), "play");
  assert.equal(ready(ok.engine), 0, "7 paid");
  assert.equal(ok.engine.getStat(ok.id("bs"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("bs"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("bs"), "life"), 7);
});

clause(SCOURGE, "0:ability:encroach", "it is not COVERT by itself", () => {
  const game = scourgeBoard();
  assert.equal(hasCovert(game), false);
  assert.equal((game.engine.getKeywords(game.id("bs")) as string[]).length, 0);
});

clause(SCOURGE, "0:ability:encroach", "with [G][G][G][G][G] it gains COVERT and pays exactly 1 resource", () => {
  const game = scourgeBoard({ greed: 5 });
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
  assert.equal(ready(game.engine), 4, "1 of 5 paid");
});

clause(SCOURGE, "0:ability:encroach", "refused with only four [G], however many other resources there are", () => {
  const game = scourgeBoard({ greed: 4, rage: 6 });
  refused(() => encroach(game), "four [G]");
  assert.equal(hasCovert(game), false);
  assert.equal(ready(game.engine), 10, "nothing was paid");
});

clause(SCOURGE, "0:ability:encroach", "more than five [G] is fine", () => {
  const game = scourgeBoard({ greed: 7 });
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
  assert.equal(ready(game.engine), 6);
});

clause(SCOURGE, "0:ability:encroach", "the opponent's [G] do not meet the threshold", () => {
  const game = scourgeBoard({ greed: 2, rage: 4, extra: bank("greed", 5, P2) });
  refused(() => encroach(game), "their Greed");
  assert.equal(hasCovert(game), false);
});

clause(SCOURGE, "0:ability:encroach", "face-down resources are Volition, not [G]", () => {
  const game = scourgeBoard({ greed: 3, extra: volition(4, P1) });
  refused(() => encroach(game), "Volition is not Greed");
  assert.equal(hasCovert(game), false);
});

clause(SCOURGE, "0:ability:encroach", "[G] that are already spent still count toward the threshold: 4 spent + 1 ready [G] works", () => {
  const game = scourgeBoard({ greed: 1, spent: 4 });
  assert.equal(ready(game.engine), 1);
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
  assert.equal(ready(game.engine), 0, "the last ready resource paid the 1");
});

clause(SCOURGE, "0:ability:encroach", "refused when no resource is left to pay 1 (five [G] all spent), and nothing happens", () => {
  const game = scourgeBoard({ greed: 0, spent: 5 });
  assert.equal(ready(game.engine), 0);
  refused(() => encroach(game), "nothing to pay 1 with");
  assert.equal(hasCovert(game), false);
});

clause(SCOURGE, "0:ability:encroach", "the COVERT is gained when the ability resolves, after responses", () => {
  const game = scourgeBoard();
  encroach(game);
  assert.equal(ready(game.engine), 4, "the cost is paid at once");
  assert.equal(hasCovert(game), false, "not yet: the opponent may still respond");
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
});

clause(SCOURGE, "0:ability:encroach", "'this turn': the COVERT is gone when the next turn starts (and stays gone on my following turn)", () => {
  const game = scourgeBoard();
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(hasCovert(game), false, "gone at the start of the opponent's turn");
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(hasCovert(game), false);
});

clause(SCOURGE, "0:ability:encroach", "only this card gains COVERT: my other character does not", () => {
  const game = scourgeBoard();
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game, "ally"), false);
  assert.equal(hasCovert(game, "plainFoe"), false);
});

clause(SCOURGE, "0:ability:encroach", "using it twice pays 1 each time and leaves a single COVERT (a card cannot have two, CR 507.3e)", () => {
  const game = scourgeBoard({ greed: 6 });
  encroach(game);
  resolvePendingResponses(game.engine);
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 4, "2 of 6 paid");
  assert.equal((game.engine.getKeywords(game.id("bs")) as string[]).filter((keyword) => keyword === "covert").length, 1);
});

clause(SCOURGE, "0:ability:encroach", "it is real COVERT: attacking with it, a non-covert blocker cannot block it but a covert one can", () => {
  const plain = scourgeBoard();
  encroach(plain);
  resolvePendingResponses(plain.engine);
  declareAttackBy(plain.engine, P1, [plain.id("bs")]);
  refused(() => declareBlockers(plain.engine, P2, [plain.id("plainFoe")]), "a non-covert blocker against a covert party");
  declareBlockers(plain.engine, P2, [plain.id("covertFoe")]);
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("covertFoe")], "a covert blocker may block");
});

clause(SCOURGE, "0:ability:encroach", "without ENCROACH (control) an ordinary blocker may block the Scourge", () => {
  const game = scourgeBoard();
  declareAttackBy(game.engine, P1, [game.id("bs")]);
  declareBlockers(game.engine, P2, [game.id("plainFoe")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plainFoe")]);
});

clause(SCOURGE, "0:ability:encroach", "a party is covert only if every member is: with a plain ally the plain blocker may block again", () => {
  const game = scourgeBoard();
  encroach(game);
  resolvePendingResponses(game.engine);
  declareAttackBy(game.engine, P1, [game.id("bs"), game.id("ally")]);
  declareBlockers(game.engine, P2, [game.id("plainFoe")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plainFoe")]);
});

clause(SCOURGE, "0:ability:encroach", "used in the attack's response window (after declaring, before blockers) it makes the party covert in time", () => {
  const game = scourgeBoard();
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("bs")], target: { type: "faction", playerId: P2 } });
  assert.equal(game.engine.state.priorityPlayerId, P1, "the attacker acts first");
  actRaw(game.engine, P1, game.id("bs"), "encroach");
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
  refused(() => declareBlockers(game.engine, P2, [game.id("plainFoe")]), "the party is covert now");
  declareBlockers(game.engine, P2, [game.id("covertFoe")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("covertFoe")]);
});

clause(SCOURGE, "0:ability:encroach", "usable the turn it enters play", () => {
  const game = scourgeBoard({ zone: "hand", greed: 5, rage: 3 });
  play(game.engine, P1, game.id("bs"));
  assert.equal(zoneOf(game.engine, game.id("bs")), "play");
  encroach(game);
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game), true);
});

clause(SCOURGE, "0:ability:encroach", "only its controller can use it", () => {
  const game = scourgeBoard({ extra: bank("greed", 5, P2) });
  refused(() => encroach(game, P2), "the opponent using my ability");
  assert.equal(hasCovert(game), false);
  assert.equal(ready(game.engine, P2), 5);
});

for (const zone of ["hand", "discard"] as const) {
  clause(SCOURGE, "0:ability:encroach", `cannot be used from my ${zone}`, () => {
    const game = scourgeBoard({ zone });
    refused(() => encroach(game), `from ${zone}`);
    assert.equal(ready(game.engine), 5);
  });
}

clause(SCOURGE, "0:ability:encroach", "a face-down Scourge is just a resource and cannot use it", () => {
  const game = scourgeBoard({ faceDown: true });
  refused(() => encroach(game), "face-down");
  assert.equal(game.engine.state.cards[game.id("bs")].faceDown, true);
});

clause(SCOURGE, "0:ability:encroach", "no deplete cost: a depleted Scourge can still use it, and using it does not deplete it", () => {
  const game = devBoard(
    [{ key: "bs", def: printing(SCOURGE), owner: P1, zone: "play", depleted: true }, ...bank("greed", 5, P1)],
    { turn: 2 }
  );
  actRaw(game.engine, P1, game.id("bs"), "encroach");
  resolvePendingResponses(game.engine);
  assert.equal((game.engine.getKeywords(game.id("bs")) as string[]).includes("covert"), true);
  const fresh = scourgeBoard();
  encroach(fresh);
  resolvePendingResponses(fresh.engine);
  assert.equal(fresh.engine.state.cards[fresh.id("bs")].depleted, false);
});

// =============================================================================
// Caboodling Gladhander
// COST: You may pick a character.
// When this card enters play, if you picked a character as part of its cost,
// destroy that character. Your opponent's faction gains X influence, where X is
// the strength of that character.
// Character (mau), cost 7, threshold [G][G], 3 / 3 / 4.
// =============================================================================

const GLAD = "d75f8c4e-5fd7-4169-8daa-051c703fb089";

function gladBoard(o: { greed?: number; rage?: number; extra?: CardPlacement[]; owner?: PlayerId } = {}) {
  const owner = o.owner ?? P1;
  const foeOwner = other(owner);
  return devBoard(
    [
      { key: "glad", def: printing(GLAD), owner, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 3, speed: 2 }), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: foeOwner, zone: "play" },
      { key: "weak", def: character({ name: "Weakling", strength: 0, life: 2, speed: 2 }), owner: foeOwner, zone: "play" },
      ...bank("greed", o.greed ?? 2, owner),
      ...bank("rage", o.rage ?? 5, owner),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: owner }
  );
}

const playGlad = (game: ReturnType<typeof gladBoard>, pick: string[] | undefined, player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("glad"), { selected: pick === undefined ? {} : { c: pick.map((key) => game.id(key)) } });

const finishGlad = (game: ReturnType<typeof gladBoard>, pick: string[] | undefined, player: PlayerId = P1) => {
  playGlad(game, pick, player);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(GLAD, "0:ability", "the card itself: cost 7 with [G][G] - refused at 6 resources and with one [G]; pays exactly 7; printed 3 / 3 / 4", () => {
  const short = gladBoard({ greed: 2, rage: 4 });
  refused(() => playGlad(short, undefined), "6 resources for cost 7");
  assert.equal(zoneOf(short.engine, short.id("glad")), "hand");
  const oneGreed = gladBoard({ greed: 1, rage: 6 });
  refused(() => playGlad(oneGreed, undefined), "only one [G]");
  const ok = gladBoard({ greed: 2, rage: 6 });
  finishGlad(ok, undefined);
  assert.equal(zoneOf(ok.engine, ok.id("glad")), "play");
  assert.equal(ready(ok.engine), 1, "7 of 8 paid");
  assert.equal(ok.engine.getStat(ok.id("glad"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("glad"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("glad"), "life"), 4);
});

clause(GLAD, "0:ability", "the pick is optional ('you may'): with no pick it is deployed and nothing is destroyed", () => {
  const game = gladBoard();
  finishGlad(game, undefined);
  assert.equal(zoneOf(game.engine, game.id("glad")), "play");
  for (const key of ["mine", "foe", "weak"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} survives`);
});

clause(GLAD, "0:ability", "an empty pick list is the same as no pick", () => {
  const game = gladBoard();
  finishGlad(game, []);
  assert.equal(zoneOf(game.engine, game.id("glad")), "play");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
});

clause(GLAD, "0:ability", "can pick any character: mine or the opponent's", () => {
  const mine = gladBoard();
  finishGlad(mine, ["mine"]);
  assert.equal(zoneOf(mine.engine, mine.id("mine")), "discard");
  const foe = gladBoard();
  finishGlad(foe, ["foe"]);
  assert.equal(zoneOf(foe.engine, foe.id("foe")), "discard");
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P2, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P2, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P2, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })],
  ["a character in the opponent's discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "Their Discard" }), owner: P2, zone: "discard" })]
] as const) {
  clause(GLAD, "0:ability", `cannot pick ${label}`, () => {
    const bad = gladBoard({ extra: [make()] });
    refused(() => playGlad(bad, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("glad")), "hand");
    assert.equal(ready(bad.engine), 7, "nothing was paid");
    const good = gladBoard({ extra: [make()] });
    finishGlad(good, ["foe"]);
    assert.equal(zoneOf(good.engine, good.id("foe")), "discard", "control: a character works");
  });
}

clause(GLAD, "0:ability", "cannot pick a faction, and at most one character may be picked", () => {
  const game = gladBoard();
  refused(() => playRaw(game.engine, P1, game.id("glad"), { selected: { c: [game.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(game.engine, P1, game.id("glad"), { selected: { c: [game.engine.state.players[P1].factionId!] } }), "my faction");
  refused(() => playGlad(game, ["mine", "foe"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("glad")), "hand");
  assert.equal(ready(game.engine), 7, "nothing was paid");
  finishGlad(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "control: one character is fine");
});

clause(GLAD, "1:rule", "picked character is destroyed on enter play and the OPPONENT's faction gains X = its strength (picking my own 3-strength character: opponent +3)", () => {
  const game = gladBoard();
  finishGlad(game, ["mine"]);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P2), START + 3);
  assert.equal(influenceOf(game.engine, P1), START, "my faction is unchanged");
});

clause(GLAD, "1:rule", "picking the opponent's 4-strength character: it is destroyed and the opponent's faction gains 4", () => {
  const game = gladBoard();
  finishGlad(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("foe")), "into its owner's discard pile");
  assert.equal(influenceOf(game.engine, P2), START + 4);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(GLAD, "1:rule", "X is the character's strength as it stands: a +2 strength bonus makes X larger", () => {
  const game = gladBoard({ extra: [{ key: "buff", def: buffTactic("strength", 2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("buff"), { selected: { t: [game.id("foe")] } });
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 6);
  finishGlad(game, ["foe"]);
  assert.equal(influenceOf(game.engine, P2), START + 6);
});

clause(GLAD, "1:rule", "X is strength, not life or damage: a damaged 4-strength character still gives 4", () => {
  const game = gladBoard();
  game.engine.state.cards[game.id("foe")].damage = 3;
  finishGlad(game, ["foe"]);
  assert.equal(influenceOf(game.engine, P2), START + 4);
});

clause(GLAD, "1:rule", "a 0-strength character gives X = 0: it is destroyed and nobody gains", () => {
  const game = gladBoard();
  finishGlad(game, ["weak"]);
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard");
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(GLAD, "1:rule", "with no pick ('if you picked a character') nothing is destroyed and no faction gains anything", () => {
  const game = gladBoard();
  finishGlad(game, undefined);
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GLAD, "1:rule", "it is an enters-play trigger: while the card waits for responses the picked character is still in play and no influence has changed", () => {
  const game = gladBoard();
  playGlad(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(zoneOf(game.engine, game.id("glad")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("glad")), "play");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P2), START + 4);
});

clause(GLAD, "1:rule", "'your opponent's faction' is relative to the Gladhander's controller: when the opponent plays it, MY faction gains X", () => {
  const game = gladBoard({ owner: P2 });
  finishGlad(game, ["foe"], P2);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "their pick: my 4-strength character");
  assert.equal(influenceOf(game.engine, P1), START + 4, "I (their opponent) gain X");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GLAD, "1:rule", "it only triggers for itself: another character entering play while it is in play destroys nothing and gives nothing", () => {
  const game = devBoard(
    [
      { key: "glad", def: printing(GLAD), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GLAD, "1:rule", "put into play by an effect, no cost was paid and no character was picked: nothing is destroyed", () => {
  const game = gladBoard({ extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("glad")] } });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("glad")), "play");
  for (const key of ["mine", "foe", "weak"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} survives`);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GLAD, "1:rule", "the Gladhander itself stays in play after the destroy", () => {
  const game = gladBoard();
  finishGlad(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("glad")), "play");
  assert.equal(game.engine.state.cards[game.id("glad")].controllerId, P1);
});

// =============================================================================
// Chancellor of Reinstatement
// REINSTATE -- COST: Pay 4. Destroy this card. Pick a character in your discard pile.
// EFFECT: Put the character into play under your control if it has numeric cost
//   X or less, where X is the number of [G] you control.
// Character (mau), cost 3, threshold [G], 2 / 3 / 1.
// =============================================================================

const CHANC = "e512bf6c-96d0-4575-b8b7-9ebf61ed6d98";

interface ChancOpts {
  greed?: number;
  rage?: number;
  /** Costs of the characters sitting in my discard pile (keys `d<cost>`). */
  discardCosts?: number[];
  zone?: "play" | "hand" | "discard";
  extra?: CardPlacement[];
  active?: PlayerId;
}

function chancBoard(o: ChancOpts = {}) {
  return devBoard(
    [
      { key: "ch", def: printing(CHANC), owner: P1, zone: o.zone ?? "play" },
      ...(o.discardCosts ?? [2]).map((cost) => ({
        key: `d${cost}`,
        def: character({ name: `Fallen ${cost}`, cost, strength: 2, life: 3, speed: 2 }),
        owner: P1,
        zone: "discard" as const
      })),
      { key: "foeFoe", def: character({ name: "Their Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const reinstate = (game: ReturnType<typeof chancBoard>, pick: string[], player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("ch"), "reinstate", { c: pick.map((key) => game.id(key)) });

const finishReinstate = (game: ReturnType<typeof chancBoard>, pick: string[]) => {
  reinstate(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(CHANC, "0:ability:reinstate", "the card itself: cost 3 with [G] - refused at 2 resources and with no [G]; accepted at 3; printed 2 / 3 / 1", () => {
  const mk = (greed: number, rage: number) =>
    devBoard([{ key: "ch", def: printing(CHANC), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)], { turn: 1 });
  const short = mk(1, 1);
  refused(() => playRaw(short.engine, P1, short.id("ch")), "2 resources for cost 3");
  const noGreed = mk(0, 5);
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("ch")), "no [G]");
  const ok = mk(1, 2);
  play(ok.engine, P1, ok.id("ch"));
  assert.equal(zoneOf(ok.engine, ok.id("ch")), "play");
  assert.equal(ready(ok.engine), 0, "3 paid");
  assert.equal(ok.engine.getStat(ok.id("ch"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("ch"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ch"), "life"), 1);
});

clause(CHANC, "0:ability:reinstate", "pays exactly 4: ready resources drop by 4 and the Chancellor is destroyed (into my discard pile)", () => {
  const game = chancBoard({ greed: 4, rage: 2 });
  assert.equal(ready(game.engine), 6);
  reinstate(game, ["d2"]);
  assert.equal(ready(game.engine), 2, "4 of 6 paid at once");
  assert.equal(zoneOf(game.engine, game.id("ch")), "discard", "destroyed as a cost");
  assert.ok(discardOf(game.engine, P1).includes(game.id("ch")), "discardOf(game.engine, P1).includes(game.id(\"ch\"))");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("d2")), "play");
});

clause(CHANC, "0:ability:reinstate", "refused one resource short (3 ready): nothing is paid and the Chancellor is not destroyed", () => {
  const game = chancBoard({ greed: 3, rage: 0 });
  refused(() => reinstate(game, ["d2"]), "3 resources for pay 4");
  assert.equal(zoneOf(game.engine, game.id("ch")), "play");
  assert.equal(ready(game.engine), 3);
  assert.equal(zoneOf(game.engine, game.id("d2")), "discard");
});

for (const [label, make] of [
  ["a character in the OPPONENT's discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "Their Dead", cost: 1 }), owner: P2, zone: "discard" })],
  ["a character in play", (): CardPlacement => ({ key: "bad", def: character({ name: "Standing", cost: 1 }), owner: P1, zone: "play" })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand", cost: 1 }), owner: P1, zone: "hand" })],
  ["a character in my deck", (): CardPlacement => ({ key: "bad", def: character({ name: "In Deck", cost: 1 }), owner: P1, zone: "deck" })],
  ["an item in my discard pile", (): CardPlacement => ({ key: "bad", def: item({ name: "Broken Thing", cost: 1 }), owner: P1, zone: "discard" })],
  ["a tactic in my discard pile", (): CardPlacement => ({ key: "bad", def: tactic({ name: "Spent Trick", cost: 1 }), owner: P1, zone: "discard" })],
  ["a location in my discard pile", (): CardPlacement => ({ key: "bad", def: location({ name: "Ruin", cost: 1, structure: 2 }), owner: P1, zone: "discard" })]
] as const) {
  clause(CHANC, "0:ability:reinstate", `cannot pick ${label}`, () => {
    const bad = chancBoard({ extra: [make()] });
    refused(() => reinstate(bad, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("ch")), "play", "the Chancellor was not destroyed");
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = chancBoard({ extra: [make()] });
    finishReinstate(good, ["d2"]);
    assert.equal(zoneOf(good.engine, good.id("d2")), "play", "control: a character in my discard pile works");
  });
}

clause(CHANC, "0:ability:reinstate", "needs exactly one pick: none and two are refused", () => {
  const none = chancBoard({ discardCosts: [1, 2] });
  refused(() => reinstate(none, []), "no pick");
  assert.equal(zoneOf(none.engine, none.id("ch")), "play");
  const two = chancBoard({ discardCosts: [1, 2] });
  refused(() => reinstate(two, ["d1", "d2"]), "two picks");
  assert.equal(zoneOf(two.engine, two.id("ch")), "play");
  const one = chancBoard({ discardCosts: [1, 2] });
  finishReinstate(one, ["d2"]);
  assert.equal(zoneOf(one.engine, one.id("d2")), "play");
  assert.equal(zoneOf(one.engine, one.id("d1")), "discard", "the other character stays in the discard pile");
});

clause(CHANC, "0:ability:reinstate", "a character with cost X or less returns under my control: it is in play, mine, not depleted, undamaged", () => {
  const game = chancBoard({ greed: 4, discardCosts: [3] });
  game.engine.state.cards[game.id("d3")].damage = 2;
  finishReinstate(game, ["d3"]);
  const card = game.engine.state.cards[game.id("d3")];
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1);
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.ok(game.engine.state.players[P1].play.includes(game.id("d3")), "game.engine.state.players[P1].play.includes(game.id(\"d3\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("d3")), "!discardOf(game.engine, P1).includes(game.id(\"d3\"))");
});

clause(CHANC, "0:ability:reinstate", "X counts [G] AFTER paying: the 4 resources spent on the cost are still controlled, so with exactly 4 [G] a cost-4 character returns", () => {
  const game = chancBoard({ greed: 4, discardCosts: [4] });
  finishReinstate(game, ["d4"]);
  assert.equal(ready(game.engine), 0);
  assert.equal(zoneOf(game.engine, game.id("d4")), "play", "X is 4: 4 <= 4");
});

clause(CHANC, "0:ability:reinstate", "a character whose cost is more than X (cost 5 with four [G]) does NOT return, but the costs are still paid", () => {
  const game = chancBoard({ greed: 4, discardCosts: [5] });
  finishReinstate(game, ["d5"]);
  assert.equal(zoneOf(game.engine, game.id("d5")), "discard", "5 > 4");
  assert.equal(zoneOf(game.engine, game.id("ch")), "discard", "the Chancellor was destroyed anyway");
  assert.equal(ready(game.engine), 0, "the 4 was paid anyway");
});

clause(CHANC, "0:ability:reinstate", "the boundary: with five [G] a cost-5 character returns and a cost-6 character does not", () => {
  const five = chancBoard({ greed: 5, discardCosts: [5, 6] });
  finishReinstate(five, ["d5"]);
  assert.equal(zoneOf(five.engine, five.id("d5")), "play");
  const six = chancBoard({ greed: 5, discardCosts: [5, 6] });
  finishReinstate(six, ["d6"]);
  assert.equal(zoneOf(six.engine, six.id("d6")), "discard");
});

clause(CHANC, "0:ability:reinstate", "a cost-0 character always returns, even with no [G] at all", () => {
  const game = chancBoard({ greed: 0, rage: 4, discardCosts: [0] });
  finishReinstate(game, ["d0"]);
  assert.equal(zoneOf(game.engine, game.id("d0")), "play");
});

clause(CHANC, "0:ability:reinstate", "with no [G] a cost-1 character does not return (X = 0)", () => {
  const game = chancBoard({ greed: 0, rage: 4, discardCosts: [1] });
  finishReinstate(game, ["d1"]);
  assert.equal(zoneOf(game.engine, game.id("d1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("ch")), "discard");
});

clause(CHANC, "0:ability:reinstate", "only [G] count toward X: four Rage and one Greed give X = 1, not 5", () => {
  const game = chancBoard({ greed: 1, rage: 4, discardCosts: [1, 2] });
  finishReinstate(game, ["d2"]);
  assert.equal(zoneOf(game.engine, game.id("d2")), "discard", "cost 2 > X = 1");
  const ok = chancBoard({ greed: 1, rage: 4, discardCosts: [1, 2] });
  finishReinstate(ok, ["d1"]);
  assert.equal(zoneOf(ok.engine, ok.id("d1")), "play", "cost 1 <= X = 1");
});

clause(CHANC, "0:ability:reinstate", "the opponent's [G] do not count toward X", () => {
  const game = chancBoard({ greed: 1, rage: 3, discardCosts: [3], extra: bank("greed", 6, P2) });
  finishReinstate(game, ["d3"]);
  assert.equal(zoneOf(game.engine, game.id("d3")), "discard", "X = 1, not 7");
});

clause(CHANC, "0:ability:reinstate", "face-down resources are Volition, not [G]: they do not raise X", () => {
  const game = chancBoard({ greed: 1, rage: 0, discardCosts: [3], extra: volition(4, P1) });
  finishReinstate(game, ["d3"]);
  assert.equal(zoneOf(game.engine, game.id("d3")), "discard", "X = 1");
});

clause(CHANC, "0:ability:reinstate", "X counts [G] icons, not resource cards: a card providing [G][G] counts as two", () => {
  const exploitation = printing("577159cb-d920-4526-bc82-28f74effc6ea");
  const mk = (cost: number) =>
    chancBoard({ greed: 2, rage: 2, discardCosts: [cost], extra: [{ key: "exp", def: exploitation, owner: P1, zone: "play" }] });
  const four = mk(4);
  finishReinstate(four, ["d4"]);
  assert.equal(zoneOf(four.engine, four.id("d4")), "play", "2 Greed + [G][G] = X of 4");
  const five = mk(5);
  finishReinstate(five, ["d5"]);
  assert.equal(zoneOf(five.engine, five.id("d5")), "discard", "5 > 4");
});

clause(CHANC, "0:ability:reinstate", "the returned character is put into play, so its enters-play trigger fires", () => {
  const welcome = character({
    name: "Welcome Wagon",
    cost: 2,
    strength: 1,
    life: 2,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
        }
      ]
    }
  });
  const game = chancBoard({ extra: [{ key: "wagon", def: welcome, owner: P1, zone: "discard" }] });
  finishReinstate(game, ["wagon"]);
  assert.equal(zoneOf(game.engine, game.id("wagon")), "play");
  assert.equal(influenceOf(game.engine, P1), START + 2);
});

clause(CHANC, "0:ability:reinstate", "usable the turn the Chancellor enters play (CR 204.3a)", () => {
  const game = devBoard(
    [
      { key: "ch", def: printing(CHANC), owner: P1, zone: "hand" },
      { key: "d2", def: character({ name: "Fallen 2", cost: 2 }), owner: P1, zone: "discard" },
      ...bank("greed", 7, P1)
    ],
    { turn: 1 }
  );
  play(game.engine, P1, game.id("ch"));
  assert.equal(zoneOf(game.engine, game.id("ch")), "play");
  finishReinstate(game, ["d2"]);
  assert.equal(zoneOf(game.engine, game.id("d2")), "play");
});

clause(CHANC, "0:ability:reinstate", "can be used in response on the opponent's turn", () => {
  const game = chancBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  finishReinstate(game, ["d2"]);
  assert.equal(zoneOf(game.engine, game.id("d2")), "play");
});

clause(CHANC, "0:ability:reinstate", "only its controller can use it, and not from the hand or the discard pile", () => {
  const opp = chancBoard({ extra: bank("greed", 4, P2) });
  refused(() => reinstate(opp, ["d2"], P2), "the opponent using my ability");
  assert.equal(zoneOf(opp.engine, opp.id("ch")), "play");
  for (const zone of ["hand", "discard"] as const) {
    const game = chancBoard({ zone });
    refused(() => reinstate(game, ["d2"]), `from ${zone}`);
    assert.equal(ready(game.engine), 4);
  }
});

clause(CHANC, "0:ability:reinstate", "the cost order is as printed (Pay, Destroy this card, THEN Pick): the Chancellor is already in my discard pile when I pick, so it can be the pick itself", () => {
  const game = chancBoard({ greed: 4, discardCosts: [] });
  reinstate(game, ["ch"]);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("ch")), "play", "destroyed as a cost, then picked from the discard pile: 3 <= X = 4");
  assert.equal(ready(game.engine), 0);
});

clause(CHANC, "0:ability:reinstate", "X is the number of [G] I control when the ability RESOLVES: if the opponent destroys a [G] in response, a cost-4 character no longer fits", () => {
  const make = (smash: boolean) =>
    chancBoard({
      greed: 4,
      discardCosts: [4],
      active: P1,
      extra: smash ? [{ key: "smash", def: smashResourceTactic(), owner: P2, zone: "hand" }] : []
    });
  const control = make(false);
  finishReinstate(control, ["d4"]);
  assert.equal(zoneOf(control.engine, control.id("d4")), "play", "control: X = 4");

  const game = make(true);
  reinstate(game, ["d4"]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  const myResource = game.engine.state.players[P1].play.find((cardId) => game.engine.isResource(cardId))!;
  play(game.engine, P2, game.id("smash"), { selected: { t: [myResource] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, myResource), "discard", "one [G] was destroyed in response");
  assert.equal(zoneOf(game.engine, game.id("d4")), "discard", "X is now 3: a cost-4 character is not reinstated");
});

// =============================================================================
// Circumspect Hijacker
// [G][G][G]: When this card enters play, draw a card.
// RETREAT -- COST: Pay 2. Destroy this card. -- EFFECT: Draw a card.
// Character (pirate, mau), cost 3, threshold [G], 2 / 3 / 2.
// =============================================================================

const HIJACK = "84f4481a-b22c-4c95-88a1-13cfbeb7d910";

function hijackBoard(o: { greed?: number; rage?: number; zone?: "hand" | "play" | "discard"; deck?: number; extra?: CardPlacement[]; faceDown?: boolean; active?: PlayerId; depleted?: boolean; turn?: number } = {}) {
  return devBoard(
    [
      { key: "hj", def: printing(HIJACK), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown, depleted: o.depleted },
      ...fillers("d", o.deck ?? 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 1, activePlayerId: o.active ?? P1 }
  );
}

clause(HIJACK, "0:rule@ggg", "the card itself: cost 3 with [G] - refused at 2 resources and with no [G]; printed 2 / 3 / 2", () => {
  const short = hijackBoard({ greed: 1, rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("hj")), "2 resources for cost 3");
  const noGreed = hijackBoard({ greed: 0, rage: 5 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("hj")), "no [G]");
  const ok = hijackBoard({ greed: 1, rage: 2 });
  play(ok.engine, P1, ok.id("hj"));
  assert.equal(zoneOf(ok.engine, ok.id("hj")), "play");
  assert.equal(ready(ok.engine), 0, "3 paid");
  assert.equal(ok.engine.getStat(ok.id("hj"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("hj"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("hj"), "life"), 2);
});

clause(HIJACK, "0:rule@ggg", "with [G][G][G] it draws exactly one card (the top of the deck) when it enters play", () => {
  const game = hijackBoard({ greed: 3, rage: 1 });
  const top = deckOf(game.engine, P1)[0];
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.deepEqual(handOf(game.engine, P1), [top]);
  assert.equal(deckOf(game.engine, P1).length, 2);
});

clause(HIJACK, "0:rule@ggg", "the three [G] it was paid for with still count: with exactly three [G] (all spent on the cost 3) it still draws", () => {
  const game = hijackBoard({ greed: 3, rage: 0 });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(ready(game.engine), 0, "all three resources were attached to my faction");
  assert.equal(handOf(game.engine, P1).length, 1, "[G][G][G] is met by the controlled (spent) Greed");
});

clause(HIJACK, "0:rule@ggg", "with only [G][G] (plus other resources) it does not draw", () => {
  const game = hijackBoard({ greed: 2, rage: 4 });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("hj")), "play");
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(deckOf(game.engine, P1).length, 3);
});

clause(HIJACK, "0:rule@ggg", "more than three [G] still draws only one card", () => {
  const game = hijackBoard({ greed: 6 });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(HIJACK, "0:rule@ggg", "the opponent's [G] do not meet the threshold", () => {
  const game = hijackBoard({ greed: 1, rage: 2, extra: bank("greed", 4, P2) });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "0:rule@ggg", "face-down resources are Volition, not [G]", () => {
  const game = hijackBoard({ greed: 1, rage: 2, extra: volition(3, P1) });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "0:rule@ggg", "the draw happens when it enters play, not while it waits for responses", () => {
  const game = hijackBoard({ greed: 3, rage: 1 });
  playRaw(game.engine, P1, game.id("hj"));
  assert.equal(handOf(game.engine, P1).length, 0);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(HIJACK, "0:rule@ggg", "it triggers only for itself: another character entering play while it is in play draws nothing", () => {
  const game = hijackBoard({
    zone: "play",
    greed: 3,
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "0:rule@ggg", "put into play by an effect it draws too when [G][G][G] is met, and not when it is not", () => {
  const withGgg = hijackBoard({ greed: 3, extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(withGgg.engine, P1, withGgg.id("pip"), { selected: { t: [withGgg.id("hj")] } });
  drain(withGgg.engine, declineAll);
  assert.equal(zoneOf(withGgg.engine, withGgg.id("hj")), "play");
  assert.equal(handOf(withGgg.engine, P1).length, 1, "it drew");
  const without = hijackBoard({ greed: 2, extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("pip"), { selected: { t: [without.id("hj")] } });
  drain(without.engine, declineAll);
  assert.equal(zoneOf(without.engine, without.id("hj")), "play");
  assert.equal(handOf(without.engine, P1).length, 0, "no [G][G][G]: no draw");
});

clause(HIJACK, "0:rule@ggg", "played face-down as a resource it is only Volition and draws nothing", () => {
  const game = hijackBoard({ greed: 3 });
  developResource(game.engine, P1, game.id("hj"), true);
  assert.equal(game.engine.state.cards[game.id("hj")].faceDown, true);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "0:rule@ggg", "the threshold is checked when it enters play: [G][G][G] gained afterwards does not draw retroactively", () => {
  const game = hijackBoard({ greed: 2, rage: 2, extra: [{ key: "g3", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("hj"));
  drain(game.engine, declineAll);
  developResource(game.engine, P1, game.id("g3"), false);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "0:rule@ggg", "it draws for its controller: the opponent playing their own Hijacker with [G][G][G] draws for them, not me", () => {
  const game = devBoard(
    [
      { key: "hj", def: printing(HIJACK), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", 3, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(game.engine, P2, game.id("hj"));
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P2).length, 1);
  assert.equal(handOf(game.engine, P1).length, 0);
});

// --- RETREAT -----------------------------------------------------------------

clause(HIJACK, "1:ability:retreat", "pays exactly 2, destroys the Hijacker (into my discard pile) and draws one card", () => {
  const game = hijackBoard({ zone: "play", greed: 2, rage: 1 });
  const top = deckOf(game.engine, P1)[0];
  actRaw(game.engine, P1, game.id("hj"), "retreat");
  assert.equal(ready(game.engine), 1, "2 of 3 paid");
  assert.equal(zoneOf(game.engine, game.id("hj")), "discard", "destroyed as a cost");
  assert.equal(handOf(game.engine, P1).length, 0, "the draw waits for responses");
  resolvePendingResponses(game.engine);
  assert.deepEqual(handOf(game.engine, P1), [top]);
  assert.ok(discardOf(game.engine, P1).includes(game.id("hj")), "discardOf(game.engine, P1).includes(game.id(\"hj\"))");
});

clause(HIJACK, "1:ability:retreat", "refused with only 1 ready resource: nothing is paid, nothing destroyed, nothing drawn", () => {
  const game = hijackBoard({ zone: "play", greed: 1 });
  refused(() => actRaw(game.engine, P1, game.id("hj"), "retreat"), "1 resource for pay 2");
  assert.equal(zoneOf(game.engine, game.id("hj")), "play");
  assert.equal(ready(game.engine), 1);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(HIJACK, "1:ability:retreat", "needs no threshold: two Rage are enough", () => {
  const game = hijackBoard({ zone: "play", greed: 0, rage: 2 });
  activate(game.engine, P1, game.id("hj"), "retreat");
  assert.equal(zoneOf(game.engine, game.id("hj")), "discard");
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(HIJACK, "1:ability:retreat", "usable the turn it enters play, and even while depleted (no deplete cost)", () => {
  const entered = hijackBoard({ greed: 5 });
  play(entered.engine, P1, entered.id("hj"));
  drain(entered.engine, declineAll);
  const before = handOf(entered.engine, P1).length;
  activate(entered.engine, P1, entered.id("hj"), "retreat");
  assert.equal(zoneOf(entered.engine, entered.id("hj")), "discard");
  assert.equal(handOf(entered.engine, P1).length, before + 1);
  const depleted = hijackBoard({ zone: "play", greed: 2, depleted: true });
  activate(depleted.engine, P1, depleted.id("hj"), "retreat");
  assert.equal(zoneOf(depleted.engine, depleted.id("hj")), "discard");
  assert.equal(handOf(depleted.engine, P1).length, 1);
});

clause(HIJACK, "1:ability:retreat", "only its controller can use it", () => {
  const game = hijackBoard({ zone: "play", greed: 2, extra: bank("rage", 3, P2) });
  refused(() => actRaw(game.engine, P2, game.id("hj"), "retreat"), "the opponent using my ability");
  assert.equal(zoneOf(game.engine, game.id("hj")), "play");
  assert.equal(handOf(game.engine, P2).length, 0);
});

for (const zone of ["hand", "discard"] as const) {
  clause(HIJACK, "1:ability:retreat", `cannot be used from my ${zone}`, () => {
    const game = hijackBoard({ zone, greed: 2 });
    refused(() => actRaw(game.engine, P1, game.id("hj"), "retreat"), `from ${zone}`);
    assert.equal(ready(game.engine), 2);
  });
}

clause(HIJACK, "1:ability:retreat", "a face-down Hijacker is only a resource and cannot use it", () => {
  const game = hijackBoard({ zone: "play", faceDown: true, greed: 2 });
  refused(() => actRaw(game.engine, P1, game.id("hj"), "retreat"), "face-down");
  assert.equal(game.engine.state.cards[game.id("hj")].faceDown, true);
});

clause(HIJACK, "1:ability:retreat", "with an empty deck it still destroys the Hijacker, draws nothing and does not lose", () => {
  const game = hijackBoard({ zone: "play", greed: 2, deck: 0 });
  activate(game.engine, P1, game.id("hj"), "retreat");
  assert.equal(zoneOf(game.engine, game.id("hj")), "discard");
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
});

clause(HIJACK, "1:ability:retreat", "draws for its controller only and exactly one card", () => {
  const game = hijackBoard({ zone: "play", greed: 2 });
  activate(game.engine, P1, game.id("hj"), "retreat");
  assert.equal(handOf(game.engine, P1).length, 1);
  assert.equal(deckOf(game.engine, P1).length, 2);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(HIJACK, "1:ability:retreat", "can be used in response on the opponent's turn (and the Hijacker is then gone from the battle)", () => {
  const game = hijackBoard({
    zone: "play",
    greed: 2,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  activate(game.engine, P1, game.id("hj"), "retreat");
  assert.equal(zoneOf(game.engine, game.id("hj")), "discard");
  assert.equal(handOf(game.engine, P1).length, 1);
});

// =============================================================================
// Crushing Usury
// COST: Pick a character.
// EFFECT: Destroy the character. Your faction loses 3 influence.
// FLIP UP: 2 [G]
// Tactic, cost 4, threshold [G].
// =============================================================================

const USURY = "6337da3e-f649-40dc-880f-7023980f2d32";

interface UsuryOpts {
  greed?: number;
  rage?: number;
  spent?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  extra?: CardPlacement[];
  influence?: number;
  active?: PlayerId;
}

function usuryBoard(o: UsuryOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.influence },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "us", def: printing(USURY), owner: P1, zone: o.zone ?? "hand", faceDown: (o.zone ?? "hand") === "play" ? (o.faceDown ?? true) : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Other Foe", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 1, P1),
      ...bank("rage", o.rage ?? 3, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ]
  });
}

const playUsury = (game: ReturnType<typeof usuryBoard>, pick: string[], player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("us"), { selected: { c: pick.map((key) => game.id(key)) } });
const finishUsury = (game: ReturnType<typeof usuryBoard>, pick: string[]) => {
  playUsury(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(USURY, "0:ability", "the card itself: refused at 3 resources (cost 4) and with no [G]; pays exactly 4; the resolved tactic goes to my discard pile", () => {
  const short = usuryBoard({ greed: 1, rage: 2 });
  refused(() => playUsury(short, ["foe"]), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("us")), "hand");
  const noGreed = usuryBoard({ greed: 0, rage: 6 });
  refused(() => playUsury(noGreed, ["foe"]), "no [G]");
  const ok = usuryBoard({ greed: 1, rage: 4 });
  finishUsury(ok, ["foe"]);
  assert.equal(ready(ok.engine), 1, "4 of 5 paid");
  assert.equal(zoneOf(ok.engine, ok.id("us")), "discard");
});

clause(USURY, "0:ability", "destroys the picked character (the opponent's) into its owner's discard pile and my faction loses exactly 3", () => {
  const game = usuryBoard();
  finishUsury(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("foe")), "discardOf(game.engine, P2).includes(game.id(\"foe\"))");
  assert.equal(influenceOf(game.engine, P1), START - 3);
  assert.equal(influenceOf(game.engine, P2), START, "the opponent's faction is untouched");
  assert.equal(zoneOf(game.engine, game.id("foe2")), "play", "the other characters are untouched");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
});

clause(USURY, "0:ability", "may pick my own character: it is destroyed and I still lose 3", () => {
  const game = usuryBoard();
  finishUsury(game, ["mine"]);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3);
  assert.equal(influenceOf(game.engine, P2), START);
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P2, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P2, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P2, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })],
  ["a character in the opponent's discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "Their Discard" }), owner: P2, zone: "discard" })]
] as const) {
  clause(USURY, "0:ability", `cannot pick ${label}`, () => {
    const bad = usuryBoard({ extra: [make()] });
    refused(() => playUsury(bad, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("us")), "hand");
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = usuryBoard({ extra: [make()] });
    finishUsury(good, ["foe"]);
    assert.equal(zoneOf(good.engine, good.id("foe")), "discard", "control");
  });
}

clause(USURY, "0:ability", "cannot pick a faction, and needs exactly one pick", () => {
  const game = usuryBoard();
  refused(() => playRaw(game.engine, P1, game.id("us"), { selected: { c: [game.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(game.engine, P1, game.id("us"), { selected: { c: [game.engine.state.players[P1].factionId!] } }), "my faction");
  refused(() => playUsury(game, []), "no pick");
  refused(() => playUsury(game, ["foe", "foe2"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("us")), "hand");
  assert.equal(ready(game.engine), 4);
  finishUsury(game, ["foe2"]);
  assert.equal(zoneOf(game.engine, game.id("foe2")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play", "exactly one character was destroyed");
});

clause(USURY, "0:ability", "the destroy and the influence loss happen when the tactic resolves, not while it waits for responses", () => {
  const game = usuryBoard();
  playUsury(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3);
});

clause(USURY, "0:ability", "a faction cannot lose more influence than it has: from 2 it goes to 0 (not below) and loses the game", () => {
  const game = usuryBoard({ influence: 2 });
  finishUsury(game, ["foe"]);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(USURY, "0:ability", "from exactly 3 influence the loss brings it to 0 and I lose the game", () => {
  const game = usuryBoard({ influence: 3 });
  finishUsury(game, ["foe"]);
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(USURY, "0:ability", "from 4 influence I am left on 1 and the game goes on", () => {
  const game = usuryBoard({ influence: 4 });
  finishUsury(game, ["foe"]);
  assert.equal(influenceOf(game.engine, P1), 1);
  assert.equal(game.engine.state.result, undefined);
});

clause(USURY, "0:ability", "'your faction' is the caster's: when the opponent casts their own Usury, THEIR faction loses 3", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "us", def: printing(USURY), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 1, P2),
      ...bank("rage", 3, P2)
    ]
  });
  playRaw(game.engine, P2, game.id("us"), { selected: { c: [game.id("mine")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P2), START - 3, "the caster pays");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(USURY, "0:ability", "the influence loss still happens if the picked character is already gone when the tactic resolves (effects never fizzle, CR 402.5a)", () => {
  const game = usuryBoard({ active: P1, extra: [{ key: "foeKill", def: killTactic(), owner: P2, zone: "hand" }] });
  playUsury(game, ["foe"]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  play(game.engine, P2, game.id("foeKill"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(zoneOf(game.engine, game.id("us")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3, "my faction still loses 3");
});

clause(USURY, "0:ability", "can be played in response on the opponent's turn: destroying their attacker", () => {
  const game = usuryBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  playUsury(game, ["atk"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3);
});

// --- FLIP UP: 2 [G] ------------------------------------------------------------

const usuryFlip = (game: ReturnType<typeof usuryBoard>, pick: string[] = ["foe"], player: PlayerId = P1) =>
  flipUpRaw(game.engine, player, game.id("us"), { c: pick.map((key) => game.id(key)) });

clause(USURY, "1:flipUp", "flipping up a face-down copy pays exactly 2 (not the printed 4), then destroys the picked character and costs me 3 influence", () => {
  const game = usuryBoard({ zone: "play", greed: 1, rage: 2 });
  assert.equal(ready(game.engine), 4, "3 banks and the face-down card");
  usuryFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3);
  assert.equal(zoneOf(game.engine, game.id("us")), "discard", "a resolved tactic goes to my discard pile");
  assert.equal(ready(game.engine), 1, "4 resources: 2 paid and the face-down card stopped being a resource");
});

clause(USURY, "1:flipUp", "the face-down card pays for its own FLIP UP: one [G] plus the card itself is exactly enough", () => {
  const game = usuryBoard({ zone: "play", greed: 1, rage: 0 });
  assert.equal(ready(game.engine), 2);
  usuryFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(ready(game.engine), 0);
});

clause(USURY, "1:flipUp", "refused one resource short: [G] already spent plus the face-down card leaves only 1 ready", () => {
  const game = usuryBoard({ zone: "play", greed: 0, rage: 0, spent: 1 });
  assert.equal(ready(game.engine), 1);
  refused(() => usuryFlip(game), "1 resource for a FLIP UP cost of 2");
  assert.equal(game.engine.state.cards[game.id("us")].faceDown, true);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
  const ok = usuryBoard({ zone: "play", greed: 0, rage: 1, spent: 1 });
  usuryFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("foe")), "discard", "control: one more resource is enough (spent [G] still meet the threshold)");
});

clause(USURY, "1:flipUp", "needs [G]: plenty of other resources and no [G] is refused", () => {
  const game = usuryBoard({ zone: "play", greed: 0, rage: 6 });
  refused(() => usuryFlip(game), "no [G]");
  assert.equal(game.engine.state.cards[game.id("us")].faceDown, true);
  assert.equal(ready(game.engine), 7, "nothing was paid");
});

clause(USURY, "1:flipUp", "the opponent's [G] do not meet the threshold", () => {
  const game = usuryBoard({ zone: "play", greed: 0, rage: 3, extra: bank("greed", 3, P2) });
  refused(() => usuryFlip(game), "their Greed");
  assert.equal(game.engine.state.cards[game.id("us")].faceDown, true);
});

clause(USURY, "1:flipUp", "still needs a character pick: none, two, an item or a faction is refused", () => {
  const make = () => usuryBoard({ zone: "play", greed: 1, rage: 1, extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" }] });
  const none = make();
  refused(() => usuryFlip(none, []), "no pick");
  const two = make();
  refused(() => usuryFlip(two, ["foe", "foe2"]), "two picks");
  const thing = make();
  refused(() => usuryFlip(thing, ["thing"]), "an item");
  const faction = make();
  refused(() => flipUpRaw(faction.engine, P1, faction.id("us"), { c: [faction.engine.state.players[P2].factionId!] }), "a faction");
  assert.equal(faction.engine.state.cards[faction.id("us")].faceDown, true);
  const good = make();
  usuryFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("foe")), "discard", "control");
});

clause(USURY, "1:flipUp", "usable at tactic times: in response to the opponent's attack", () => {
  const game = usuryBoard({
    zone: "play",
    greed: 1,
    rage: 1,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  usuryFlip(game, ["atk"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 3);
});

clause(USURY, "1:flipUp", "only the controller can flip it up", () => {
  const game = usuryBoard({ zone: "play", greed: 1, rage: 1, extra: [...bank("greed", 1, P2), ...bank("rage", 2, P2)] });
  refused(() => usuryFlip(game, ["foe"], P2), "the opponent flipping my card");
  assert.equal(game.engine.state.cards[game.id("us")].faceDown, true);
});

// =============================================================================
// D3ck W4rd3n
// When this card enters play, your faction loses 2 influence.
// Character (pirate, mercenary, mau), cost 5, threshold [G][G], 4 / 3 / 4.
// =============================================================================

const WARDEN = "7e0f3b4c-668a-4d4e-a82e-e6996cd6b0c2";

function wardenBoard(o: { greed?: number; rage?: number; influence?: number; extra?: CardPlacement[]; owner?: PlayerId; zone?: "hand" | "play" } = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: owner === P1 ? o.influence : undefined },
    playerB: { faction: developFaction(), influence: owner === P2 ? o.influence : undefined },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "dw", def: printing(WARDEN), owner, zone: o.zone ?? "hand" },
      ...bank("greed", o.greed ?? 2, owner),
      ...bank("rage", o.rage ?? 3, owner),
      ...(o.extra ?? [])
    ]
  });
}

clause(WARDEN, "0:rule", "the card itself: cost 5 with [G][G] - refused at 4 resources and with one [G]; pays exactly 5; printed 4 / 3 / 4", () => {
  const short = wardenBoard({ greed: 2, rage: 2 });
  refused(() => playRaw(short.engine, P1, short.id("dw")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("dw")), "hand");
  const oneGreed = wardenBoard({ greed: 1, rage: 5 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("dw")), "only one [G]");
  const ok = wardenBoard({ greed: 2, rage: 4 });
  play(ok.engine, P1, ok.id("dw"));
  assert.equal(zoneOf(ok.engine, ok.id("dw")), "play");
  assert.equal(ready(ok.engine), 1, "5 of 6 paid");
  assert.equal(ok.engine.getStat(ok.id("dw"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("dw"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("dw"), "life"), 4);
});

clause(WARDEN, "0:rule", "when it enters play my faction loses exactly 2 influence; the opponent's is untouched", () => {
  const game = wardenBoard();
  play(game.engine, P1, game.id("dw"));
  assert.equal(zoneOf(game.engine, game.id("dw")), "play");
  assert.equal(influenceOf(game.engine, P1), START - 2);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(WARDEN, "0:rule", "the loss happens when it enters play, not while it waits for responses", () => {
  const game = wardenBoard();
  playRaw(game.engine, P1, game.id("dw"));
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(WARDEN, "0:rule", "put into play by an effect (not deployed) it still costs 2 influence", () => {
  const game = wardenBoard({ extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("dw")] } });
  assert.equal(zoneOf(game.engine, game.id("dw")), "play");
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(WARDEN, "0:rule", "played face-down as a resource it is only Volition: no influence loss", () => {
  const game = wardenBoard();
  developResource(game.engine, P1, game.id("dw"), true);
  assert.equal(game.engine.state.cards[game.id("dw")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(WARDEN, "0:rule", "it triggers only for itself: another character entering play while it is in play costs nothing", () => {
  const game = wardenBoard({
    zone: "play",
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(WARDEN, "0:rule", "two Wardens each cost 2: deploying both loses 4 in total", () => {
  const game = wardenBoard({ greed: 2, rage: 8, extra: [{ key: "dw2", def: printing(WARDEN), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dw"));
  play(game.engine, P1, game.id("dw2"));
  assert.equal(influenceOf(game.engine, P1), START - 4);
});

clause(WARDEN, "0:rule", "leaving play gives nothing back and costs nothing more", () => {
  const game = wardenBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dw"));
  assert.equal(influenceOf(game.engine, P1), START - 2);
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("dw")] } });
  assert.equal(zoneOf(game.engine, game.id("dw")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(WARDEN, "0:rule", "'your faction' is its controller's: when the opponent deploys their own Warden, THEIR faction loses 2", () => {
  const game = wardenBoard({ owner: P2 });
  play(game.engine, P2, game.id("dw"));
  assert.equal(influenceOf(game.engine, P2), START - 2);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(WARDEN, "0:rule", "with exactly 2 influence left, the loss brings it to 0 and I lose the game", () => {
  const game = wardenBoard({ influence: 2 });
  play(game.engine, P1, game.id("dw"));
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(WARDEN, "0:rule", "with 3 influence left it goes to 1 and the game goes on", () => {
  const game = wardenBoard({ influence: 3 });
  play(game.engine, P1, game.id("dw"));
  assert.equal(influenceOf(game.engine, P1), 1);
  assert.equal(game.engine.state.result, undefined);
});

clause(WARDEN, "0:rule", "with only 1 influence left the loss stops at 0 (not -1) and I lose the game", () => {
  const game = wardenBoard({ influence: 1 });
  play(game.engine, P1, game.id("dw"));
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

// =============================================================================
// Department of Rejections
// Your opponent must pay 2 to search their deck.
// Your opponent must pay 2 to use a character's ability. (This includes
//   abilities used when the character is not in play.)
// FLIP UP: 1 [G]
// Location, cost 1, threshold [G], structure 4.
// =============================================================================

const DEPT = "0b6dc892-f833-4ab1-b1c5-c185ff0ca0f1";

interface DeptOpts {
  /** Where the Department is, and whose it is (default: in play, P1's). */
  zone?: "play" | "hand" | "discard";
  faceDown?: boolean;
  owner?: PlayerId;
  /** Second copy of the Department in play (owner P1). */
  second?: boolean;
  /** Ready Rage for the opponent (P2) and for me (P1). */
  taxed?: number;
  ownerRes?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function deptBoard(o: DeptOpts = {}) {
  const owner = o.owner ?? P1;
  const user = other(owner); // the player the Department taxes
  return devBoard(
    [
      { key: "dept", def: printing(DEPT), owner, zone: o.zone ?? "play", faceDown: o.faceDown },
      ...(o.second ? [{ key: "dept2", def: printing(DEPT), owner, zone: "play" } as CardPlacement] : []),
      ...fillers("pd", 3, user, "deck"),
      ...fillers("od", 3, owner, "deck"),
      ...bank("rage", o.taxed ?? 0, user),
      ...bank("rage", o.ownerRes ?? 0, owner),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? user }
  );
}

/** A free tactic that searches its controller's deck for the character named "Wanted" and puts it in hand. */
function searchTactic(name = "Deck Dive"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dive",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "__s", selector: { zone: "deck", owner: "self", name: "Wanted" }, count: 1, optional: false },
              effects: [{ type: "moveCard", target: { type: "selected", id: "__s" }, to: "hand" }]
            }
          ]
        }
      ]
    }
  });
}

const wantedCard = (owner: PlayerId, key = "wanted"): CardPlacement => ({ key, def: character({ name: "Wanted", strength: 1, life: 1 }), owner, zone: "deck" });

/** Plays the search tactic as `player` and returns what happened to the search (tax paid, prompt open, etc.). */
function runSearch(game: ReturnType<typeof deptBoard>, player: PlayerId, tacticKey = "dive") {
  play(game.engine, player, game.id(tacticKey));
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget", "a search prompt");
    assert.equal(pc.playerId, player);
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("wanted")] });
  }
  assert.equal(game.engine.state.pendingChoice, undefined);
  return { prompted: pc !== undefined };
}

clause(DEPT, "0:rule", "the card itself: cost 1 with [G] - refused with no resources and with no [G]; printed structure 4: 3 damage leaves it, 4 destroys it", () => {
  const mk = (greed: number, rage: number) =>
    devBoard([{ key: "dept", def: printing(DEPT), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)], { turn: 1 });
  const none = mk(0, 0);
  refused(() => playRaw(none.engine, P1, none.id("dept")), "no resources");
  const noGreed = mk(0, 3);
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("dept")), "no [G]");
  const ok = mk(1, 0);
  play(ok.engine, P1, ok.id("dept"));
  assert.equal(zoneOf(ok.engine, ok.id("dept")), "play");
  assert.equal(ready(ok.engine), 0, "1 paid");
  for (const [damage, survives] of [[3, true], [4, false]] as const) {
    const game = devBoard(
      [
        { key: "dept", def: printing(DEPT), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Raider", strength: damage, life: 9, speed: 3 }), owner: P2, zone: "play" }
      ],
      { turn: 2, activePlayerId: P2 }
    );
    declareAttackBy(game.engine, P2, [game.id("atk")], { type: "card", cardId: game.id("dept") });
    declareBlockers(game.engine, P1, []);
    autoResolveBattle(game.engine);
    assert.equal(zoneOf(game.engine, game.id("dept")), survives ? "play" : "discard", `${damage} damage vs structure 4`);
  }
});

// --- Rule 0: pay 2 to search -------------------------------------------------

clause(DEPT, "0:rule", "my opponent searching their deck pays exactly 2 (ready resources 5 -> 3) and still finds the card", () => {
  const game = deptBoard({ taxed: 5, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, true);
  assert.equal(ready(game.engine, P2), 3, "2 paid");
  assert.ok(handOf(game.engine, P2).includes(game.id("wanted")), "the card was found");
  assert.equal(zoneOf(game.engine, game.id("dive")), "discard");
});

clause(DEPT, "0:rule", "exactly 2 ready resources are enough", () => {
  const game = deptBoard({ taxed: 2, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  runSearch(game, P2);
  assert.equal(ready(game.engine, P2), 0);
  assert.ok(handOf(game.engine, P2).includes(game.id("wanted")), "handOf(game.engine, P2).includes(game.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "with only 1 ready resource my opponent cannot search: nothing is paid, no card is found", () => {
  const game = deptBoard({ taxed: 1, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, false, "no search prompt");
  assert.equal(ready(game.engine, P2), 1, "nothing was paid");
  assert.ok(!handOf(game.engine, P2).includes(game.id("wanted")), "!handOf(game.engine, P2).includes(game.id(\"wanted\"))");
  assert.equal(zoneOf(game.engine, game.id("wanted")), "deck");
});

clause(DEPT, "0:rule", "with no resources my opponent cannot search", () => {
  const game = deptBoard({ taxed: 0, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, false);
  assert.equal(zoneOf(game.engine, game.id("wanted")), "deck");
});

clause(DEPT, "0:rule", "control: without the Department the same search is free", () => {
  const game = deptBoard({ zone: "discard", taxed: 5, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, true);
  assert.equal(ready(game.engine, P2), 5, "nothing paid");
  assert.ok(handOf(game.engine, P2).includes(game.id("wanted")), "handOf(game.engine, P2).includes(game.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "it taxes the OPPONENT only: the Department's controller searches their own deck for free", () => {
  const game = deptBoard({ active: P1, ownerRes: 5, extra: [{ key: "dive", def: searchTactic(), owner: P1, zone: "hand" }, wantedCard(P1)] });
  const outcome = runSearch(game, P1);
  assert.equal(outcome.prompted, true);
  assert.equal(ready(game.engine, P1), 5, "I paid nothing");
  assert.ok(handOf(game.engine, P1).includes(game.id("wanted")), "handOf(game.engine, P1).includes(game.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "the tax follows the Department's controller: if the opponent controls it, I am the one who pays 2", () => {
  const game = deptBoard({ owner: P2, taxed: 1, active: P1, extra: [{ key: "dive", def: searchTactic(), owner: P1, zone: "hand" }, wantedCard(P1)] });
  const poor = runSearch(game, P1);
  assert.equal(poor.prompted, false, "I have only 1 resource");
  const rich = deptBoard({ owner: P2, taxed: 3, active: P1, extra: [{ key: "dive", def: searchTactic(), owner: P1, zone: "hand" }, wantedCard(P1)] });
  runSearch(rich, P1);
  assert.equal(ready(rich.engine, P1), 1, "I paid 2");
  assert.ok(handOf(rich.engine, P1).includes(rich.id("wanted")), "handOf(rich.engine, P1).includes(rich.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "a face-down Department is only a resource: no search tax", () => {
  const game = deptBoard({ faceDown: true, taxed: 1, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, true);
  assert.ok(handOf(game.engine, P2).includes(game.id("wanted")), "handOf(game.engine, P2).includes(game.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "in my hand it taxes nothing", () => {
  const game = deptBoard({ zone: "hand", taxed: 1, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const outcome = runSearch(game, P2);
  assert.equal(outcome.prompted, true);
});

clause(DEPT, "0:rule", "two Departments each demand 2: searching costs 4", () => {
  const three = deptBoard({ second: true, taxed: 3, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  const poor = runSearch(three, P2);
  assert.equal(poor.prompted, false, "3 resources are not enough for 4");
  assert.equal(ready(three.engine, P2), 3);
  const five = deptBoard({ second: true, taxed: 5, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2)] });
  runSearch(five, P2);
  assert.equal(ready(five.engine, P2), 1, "4 paid");
  assert.ok(handOf(five.engine, P2).includes(five.id("wanted")), "handOf(five.engine, P2).includes(five.id(\"wanted\"))");
});

clause(DEPT, "0:rule", "once the Department is destroyed the search is free again", () => {
  const wreck = tactic({
    name: "Wreck Location",
    cost: 0,
    behavior: { abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const game = deptBoard({ taxed: 5, extra: [{ key: "dive", def: searchTactic(), owner: P2, zone: "hand" }, wantedCard(P2), { key: "wreck", def: wreck, owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("wreck"), { selected: { t: [game.id("dept")] } });
  assert.equal(zoneOf(game.engine, game.id("dept")), "discard");
  runSearch(game, P2);
  assert.equal(ready(game.engine, P2), 5, "free");
});

clause(DEPT, "0:rule", "it taxes searches made by a character's ability as well (that ability costs its own 1, plus 2 for the ability, plus 2 for the search)", () => {
  const seeker = character({
    name: "Seeker",
    strength: 1,
    life: 2,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "seek",
          type: "activated",
          costs: [{ type: "payResources", amount: 1 }],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "__s", selector: { zone: "deck", owner: "self", name: "Wanted" }, count: 1, optional: false },
              effects: [{ type: "moveCard", target: { type: "selected", id: "__s" }, to: "hand" }]
            }
          ]
        }
      ]
    }
  });
  const make = (n: number) => deptBoard({ taxed: n, extra: [{ key: "seeker", def: seeker, owner: P2, zone: "play" }, wantedCard(P2)] });
  const four = make(4);
  actRaw(four.engine, P2, four.id("seeker"), "seek");
  resolvePendingResponses(four.engine);
  assert.equal(pending(four.engine), undefined, "4 resources pay the ability (1 + 2) but not the search (2)");
  assert.equal(zoneOf(four.engine, four.id("wanted")), "deck");
  const five = make(5);
  actRaw(five.engine, P2, five.id("seeker"), "seek");
  resolvePendingResponses(five.engine);
  answerPending(five.engine, "chooserSelectsTarget", { selected: [five.id("wanted")] });
  assert.equal(ready(five.engine, P2), 0, "1 + 2 + 2 paid");
  assert.ok(handOf(five.engine, P2).includes(five.id("wanted")), "handOf(five.engine, P2).includes(five.id(\"wanted\"))");
});

// --- Rule 1: pay 2 to use a character's ability ------------------------------

const abilityChar = (name: string, cost: "none" | "pay1" | "deplete" = "none", over: Partial<CardDefinition> = {}): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "use",
          type: "activated",
          costs: cost === "pay1" ? [{ type: "payResources", amount: 1 }] : cost === "deplete" ? [{ type: "deplete", target: "source" }] : [],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    },
    ...over
  });

const useAbility = (game: ReturnType<typeof deptBoard>, key: string, player: PlayerId = P2) => actRaw(game.engine, player, game.id(key), "use");

clause(DEPT, "1:rule", "my opponent using a character's ability pays exactly 2 (ready 5 -> 3) and the ability resolves", () => {
  const game = deptBoard({ taxed: 5, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
  useAbility(game, "ab");
  assert.equal(ready(game.engine, P2), 3, "2 paid");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1, "the ability drew a card");
});

clause(DEPT, "1:rule", "exactly 2 ready resources are enough for a free ability", () => {
  const game = deptBoard({ taxed: 2, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }] });
  useAbility(game, "ab");
  assert.equal(ready(game.engine, P2), 0);
});

clause(DEPT, "1:rule", "with only 1 ready resource my opponent cannot use even a free character ability", () => {
  const game = deptBoard({ taxed: 1, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }] });
  refused(() => useAbility(game, "ab"), "1 resource for a tax of 2");
  assert.equal(ready(game.engine, P2), 1);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(game.engine.state.responseWindow, undefined);
});

clause(DEPT, "1:rule", "with no resources at all my opponent cannot use it either", () => {
  const game = deptBoard({ taxed: 0, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }] });
  refused(() => useAbility(game, "ab"), "no resources");
});

clause(DEPT, "1:rule", "control: without the Department the same ability is free", () => {
  const game = deptBoard({ zone: "discard", taxed: 0, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
  useAbility(game, "ab");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1);
});

clause(DEPT, "1:rule", "the 2 is added to the ability's own cost: an ability that costs 1 costs 3", () => {
  const make = (n: number) => deptBoard({ taxed: n, extra: [{ key: "ab", def: abilityChar("Payer", "pay1"), owner: P2, zone: "play" }] });
  const two = make(2);
  refused(() => useAbility(two, "ab"), "2 resources for 1 + 2");
  assert.equal(ready(two.engine, P2), 2);
  const three = make(3);
  useAbility(three, "ab");
  assert.equal(ready(three.engine, P2), 0, "1 + 2 paid");
});

clause(DEPT, "1:rule", "the 2 is added to a non-numeric cost too: a deplete-only ability still costs 2 resources and depletes", () => {
  const game = deptBoard({ taxed: 2, extra: [{ key: "ab", def: abilityChar("Depleter", "deplete"), owner: P2, zone: "play" }] });
  useAbility(game, "ab");
  assert.equal(ready(game.engine, P2), 0);
  assert.equal(game.engine.state.cards[game.id("ab")].depleted, true);
  const poor = deptBoard({ taxed: 1, extra: [{ key: "ab", def: abilityChar("Depleter", "deplete"), owner: P2, zone: "play" }] });
  refused(() => useAbility(poor, "ab"), "1 resource");
  assert.equal(poor.engine.state.cards[poor.id("ab")].depleted, false);
});

clause(DEPT, "1:rule", "'This includes abilities used when the character is not in play': a RECUR-style ability from the discard pile costs 2 more", () => {
  const recurChar = character({
    name: "Recurrer",
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "use",
          type: "activated",
          activationZone: "discard",
          costs: [{ type: "payResources", amount: 1 }, { type: "removeFromGame", target: "source" }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const make = (n: number) => deptBoard({ taxed: n, extra: [{ key: "rc", def: recurChar, owner: P2, zone: "discard" }, ...fillers("pdd", 2, P2, "deck")] });
  const two = make(2);
  refused(() => useAbility(two, "rc"), "2 resources for 1 + 2");
  assert.equal(zoneOf(two.engine, two.id("rc")), "discard");
  const three = make(3);
  useAbility(three, "rc");
  assert.equal(ready(three.engine, P2), 0, "1 + 2 paid");
  assert.equal(zoneOf(three.engine, three.id("rc")), "removed");
  resolvePendingResponses(three.engine);
  assert.equal(handOf(three.engine, P2).length, 1);
});

clause(DEPT, "1:rule", "'not in play' includes a character's ability used from the HAND: an ability that costs 1 costs 3", () => {
  const handChar = character({
    name: "Hand Talker",
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "use",
          type: "activated",
          activationZone: "hand",
          costs: [{ type: "payResources", amount: 1 }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const make = (n: number, zone: "play" | "discard" = "play") =>
    deptBoard({ zone, taxed: n, extra: [{ key: "ht", def: handChar, owner: P2, zone: "hand" }, ...fillers("pdd", 2, P2, "deck")] });
  const control = make(1, "discard");
  useAbility(control, "ht");
  assert.equal(ready(control.engine, P2), 0, "control: without the Department it costs just its own 1");
  const two = make(2);
  refused(() => useAbility(two, "ht"), "2 resources for 1 + 2");
  assert.equal(ready(two.engine, P2), 2);
  const three = make(3);
  useAbility(three, "ht");
  assert.equal(ready(three.engine, P2), 0, "1 + 2 paid");
});

clause(DEPT, "1:rule", "it taxes only the OPPONENT: the Department's controller uses their own character's ability for free", () => {
  const game = deptBoard({ active: P1, ownerRes: 0, extra: [{ key: "ab", def: abilityChar("Mine"), owner: P1, zone: "play" }, ...fillers("mm", 2, P1, "deck")] });
  useAbility(game, "ab", P1);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(DEPT, "1:rule", "the tax follows the Department's controller: if the opponent controls it, my character's ability that costs 1 costs me 3", () => {
  const make = (n: number) => deptBoard({ owner: P2, active: P1, taxed: n, extra: [{ key: "ab", def: abilityChar("Mine", "pay1"), owner: P1, zone: "play" }] });
  const poor = make(2);
  refused(() => useAbility(poor, "ab", P1), "2 resources for 1 + 2");
  assert.equal(ready(poor.engine, P1), 2);
  const rich = make(3);
  useAbility(rich, "ab", P1);
  assert.equal(ready(rich.engine, P1), 0);
});

clause(DEPT, "1:rule", "the tax follows the Department's controller: if the opponent controls it, even my free character ability costs me 2", () => {
  const make = (n: number) => deptBoard({ owner: P2, active: P1, taxed: n, extra: [{ key: "ab", def: abilityChar("Mine"), owner: P1, zone: "play" }] });
  const poor = make(1);
  refused(() => useAbility(poor, "ab", P1), "1 resource for a tax of 2");
  const rich = make(2);
  useAbility(rich, "ab", P1);
  assert.equal(ready(rich.engine, P1), 0);
});

clause(DEPT, "1:rule", "an item's ability is not a character's ability: no tax", () => {
  const gizmo = item({ name: "Gizmo", behavior: { abilities: [{ id: "use", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const game = deptBoard({ taxed: 0, extra: [{ key: "giz", def: gizmo, owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
  useAbility(game, "giz");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1);
});

clause(DEPT, "1:rule", "a location's ability is not a character's ability: no tax", () => {
  const hall = location({ name: "Hall", structure: 3, behavior: { abilities: [{ id: "use", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const game = deptBoard({ taxed: 0, extra: [{ key: "hall", def: hall, owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
  useAbility(game, "hall");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1);
});

clause(DEPT, "1:rule", "playing a tactic is not using a character's ability: no tax", () => {
  const game = deptBoard({ taxed: 0, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }] });
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
});

clause(DEPT, "1:rule", "a faction's ability is not a character's ability: no tax", () => {
  const faction = factionCard({
    name: "Abilityland",
    faction: {
      startingInfluence: 30,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } },
      abilities: [{ id: "use", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "dept", def: printing(DEPT), owner: P1, zone: "play" }, ...fillers("pdd", 2, P2, "deck")]
  });
  actRaw(game.engine, P2, game.engine.state.players[P2].factionId!, "use");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1, "the faction ability was used with no resources");
});

clause(DEPT, "1:rule", "a triggered ability is not 'used': a character's enters-play draw costs nothing", () => {
  const etb = character({
    name: "Greeter",
    cost: 0,
    strength: 1,
    life: 2,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const game = deptBoard({ taxed: 0, extra: [{ key: "greeter", def: etb, owner: P2, zone: "hand" }, ...fillers("pdd", 2, P2, "deck")] });
  play(game.engine, P2, game.id("greeter"));
  assert.equal(zoneOf(game.engine, game.id("greeter")), "play");
  assert.equal(handOf(game.engine, P2).length, 1, "the trigger drew a card");
});

clause(DEPT, "1:rule", "a face-down Department taxes nothing", () => {
  const game = deptBoard({ faceDown: true, taxed: 0, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
  useAbility(game, "ab");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, 1);
});

clause(DEPT, "1:rule", "a Department in my hand or discard pile taxes nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const game = deptBoard({ zone, taxed: 0, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }, ...fillers("pdd", 2, P2, "deck")] });
    useAbility(game, "ab");
    resolvePendingResponses(game.engine);
    assert.equal(handOf(game.engine, P2).length, 1, zone);
  }
});

clause(DEPT, "1:rule", "two Departments each demand 2: an ability that costs 1 costs 5", () => {
  const make = (n: number) => deptBoard({ second: true, taxed: n, extra: [{ key: "ab", def: abilityChar("Payer", "pay1"), owner: P2, zone: "play" }] });
  const four = make(4);
  refused(() => useAbility(four, "ab"), "4 resources for 1 + 2 + 2");
  assert.equal(ready(four.engine, P2), 4);
  const five = make(5);
  useAbility(five, "ab");
  assert.equal(ready(five.engine, P2), 0);
});

clause(DEPT, "1:rule", "two Departments each demand 2: a free character ability costs 4", () => {
  const three = deptBoard({ second: true, taxed: 3, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }] });
  refused(() => useAbility(three, "ab"), "3 resources for a tax of 4");
  const four = deptBoard({ second: true, taxed: 4, extra: [{ key: "ab", def: abilityChar("Talker"), owner: P2, zone: "play" }] });
  useAbility(four, "ab");
  assert.equal(ready(four.engine, P2), 0);
});

/** The opponent (P2) holds priority in my attack's response window, with `n` ready Rage and a character with an ability. */
function respondingBoard(abilityCost: "none" | "pay1", n: number) {
  const game = deptBoard({
    active: P1,
    taxed: n,
    extra: [
      { key: "ab", def: abilityChar("Talker", abilityCost), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...fillers("pdd", 2, P2, "deck")
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("mine")], target: { type: "faction", playerId: P2 } });
  game.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(game.engine.state.priorityPlayerId, P2);
  return game;
}

clause(DEPT, "1:rule", "it applies when the opponent uses the ability in response on my turn (cost 1 + 2)", () => {
  const poor = respondingBoard("pay1", 2);
  refused(() => useAbility(poor, "ab"), "2 resources for 1 + 2");
  assert.equal(ready(poor.engine, P2), 2);
  const rich = respondingBoard("pay1", 3);
  useAbility(rich, "ab");
  assert.equal(ready(rich.engine, P2), 0);
});

clause(DEPT, "1:rule", "it applies when the opponent uses a free ability in response on my turn", () => {
  const poor = respondingBoard("none", 1);
  refused(() => useAbility(poor, "ab"), "1 resource for a tax of 2");
  const rich = respondingBoard("none", 2);
  useAbility(rich, "ab");
  assert.equal(ready(rich.engine, P2), 0);
});

/** My (P1) Department; my opponent (P2) controls a Borrower, so they may use abilities on MY characters. */
function borrowBoard(abilityCost: "none" | "pay1", n: number, deptZone: "play" | "discard" = "play") {
  const borrower = item({ name: "Borrower", behavior: { abilities: [{ id: "borrow", type: "continuous", modifiers: [], canUseOpponentAbilities: true }] } });
  return deptBoard({
    zone: deptZone,
    taxed: n,
    extra: [
      { key: "ab", def: abilityChar("My Talker", abilityCost), owner: P1, zone: "play" },
      { key: "borrower", def: borrower, owner: P2, zone: "play" },
      ...fillers("mm", 2, P1, "deck")
    ]
  });
}

clause(DEPT, "1:rule", "the tax is on whoever USES a character's ability: my opponent using one of MY characters' abilities (cost 1) pays 1 + 2", () => {
  const control = borrowBoard("pay1", 1, "discard");
  useAbility(control, "ab", P2);
  assert.equal(ready(control.engine, P2), 0, "control: with no Department the borrowed ability costs just its own 1");
  const poor = borrowBoard("pay1", 2);
  refused(() => useAbility(poor, "ab", P2), "2 resources for 1 + 2");
  assert.equal(ready(poor.engine, P2), 2);
  const rich = borrowBoard("pay1", 3);
  useAbility(rich, "ab", P2);
  assert.equal(ready(rich.engine, P2), 0, "the borrower paid 1 + 2");
});

// --- FLIP UP: 1 [G] ------------------------------------------------------------

function deptFlipBoard(o: { greed?: number; rage?: number; spentFaceDown?: boolean; active?: PlayerId; extra?: CardPlacement[]; spentGreed?: number } = {}) {
  return devBoard(
    [
      { key: "dept", def: printing(DEPT), owner: P1, zone: "play", faceDown: true, attachedToKey: o.spentFaceDown ? "__factionA" : undefined },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spentGreed(P1, o.spentGreed ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

clause(DEPT, "2:flipUp", "flipping up a face-down Department pays exactly 1 and puts the location into play face-up with its structure fresh", () => {
  const game = deptFlipBoard({ greed: 1, rage: 2 });
  assert.equal(ready(game.engine), 4, "3 banks and the face-down card");
  flipUpRaw(game.engine, P1, game.id("dept"));
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("dept")];
  assert.equal(card.faceDown, false);
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1);
  assert.equal(card.damage, 0);
  assert.equal(ready(game.engine), 2, "4 resources: 1 paid and the face-down card stopped being one (4 - 1 - 1)");
});

clause(DEPT, "2:flipUp", "the face-down card pays for its own FLIP UP: with a single [G] the card itself is the 1", () => {
  const game = deptFlipBoard({ greed: 0, spentGreed: 1 });
  assert.equal(ready(game.engine), 1);
  flipUpRaw(game.engine, P1, game.id("dept"));
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("dept")].faceDown, false);
  assert.equal(ready(game.engine), 0);
});

// (No "one resource short" test: the face-down card is itself an unspent resource that can pay its own FLIP UP cost
// of 1 (CR 507.4b), so a face-down Department that is free to flip is never short of that 1.)

clause(DEPT, "2:flipUp", "needs [G]: other resources alone are refused", () => {
  const game = deptFlipBoard({ greed: 0, rage: 4 });
  refused(() => flipUpRaw(game.engine, P1, game.id("dept")), "no [G]");
  assert.equal(game.engine.state.cards[game.id("dept")].faceDown, true);
  assert.equal(ready(game.engine), 5);
});

clause(DEPT, "2:flipUp", "FLIP UP does not change when a location can be deployed (CR 507.4d): refused on the opponent's turn, accepted on mine", () => {
  const hand = devBoard(
    [
      { key: "dept", def: printing(DEPT), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(hand.engine, P2, [hand.id("atk")]);
  refused(() => playRaw(hand.engine, P1, hand.id("dept")), "control: a location from hand cannot be deployed on the opponent's turn");
  const theirTurn = deptFlipBoard({
    greed: 1,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(theirTurn.engine, P2, [theirTurn.id("atk")]);
  assert.equal(theirTurn.engine.state.priorityPlayerId, P1);
  refused(() => flipUpRaw(theirTurn.engine, P1, theirTurn.id("dept")), "a location only on my own turn");
  assert.equal(theirTurn.engine.state.cards[theirTurn.id("dept")].faceDown, true);
  const mine = deptFlipBoard({ greed: 1 });
  flipUpRaw(mine.engine, P1, mine.id("dept"));
  resolvePendingResponses(mine.engine);
  assert.equal(mine.engine.state.cards[mine.id("dept")].faceDown, false);
});

clause(DEPT, "2:flipUp", "once flipped up the Department's rules are live: the opponent now pays 2 to search and 2 more for a character's ability", () => {
  const theirs = (): CardPlacement[] => [
    { key: "dive", def: searchTactic(), owner: P2, zone: "hand" },
    { key: "ab", def: abilityChar("Payer", "pay1"), owner: P2, zone: "play" },
    ...fillers("pdd", 2, P2, "deck"),
    wantedCard(P2),
    ...bank("rage", 2, P2)
  ];
  // Face-down: the Department taxes nothing, so with 2 resources my opponent uses the 1-cost ability and then searches freely.
  const down = deptFlipBoard({ greed: 1, extra: theirs() });
  endTurn(down.engine, P1);
  assert.equal(down.engine.state.activePlayerId, P2);
  actRaw(down.engine, P2, down.id("ab"), "use");
  resolvePendingResponses(down.engine);
  assert.equal(ready(down.engine, P2), 1, "control: the ability cost just its own 1 while the Department is face-down");
  play(down.engine, P2, down.id("dive"));
  assert.equal(pending(down.engine)?.kind, "chooserSelectsTarget", "control: the search prompt appears for free while face-down");

  // Flipped up on my turn: now both taxes bite.
  const up = deptFlipBoard({ greed: 1, extra: theirs() });
  flipUpRaw(up.engine, P1, up.id("dept"));
  resolvePendingResponses(up.engine);
  endTurn(up.engine, P1);
  assert.equal(up.engine.state.activePlayerId, P2);
  refused(() => actRaw(up.engine, P2, up.id("ab"), "use"), "2 resources for 1 + 2");
  assert.equal(ready(up.engine, P2), 2);
  play(up.engine, P2, up.id("dive"));
  answerPending(up.engine, "chooserSelectsTarget", { selected: [up.id("wanted")] });
  assert.equal(ready(up.engine, P2), 0, "the search cost 2");
  assert.ok(handOf(up.engine, P2).includes(up.id("wanted")), "handOf(up.engine, P2).includes(up.id(\"wanted\"))");
});

// =============================================================================
// Desserted Island
// Draw 3 cards.
// RECUR: [G][G] -- COST: Use this only if this card is in your discard pile.
//   Pay 1. Remove this card from the game. -- EFFECT: Draw a card.
// Tactic, cost 5, threshold [G][G].
// =============================================================================

const ISLAND = "fdaacd43-878d-4f31-8235-d17fe4625bda";

interface IslandOpts {
  zone?: "hand" | "discard" | "deck" | "removed";
  greed?: number;
  rage?: number;
  spent?: number;
  deck?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function islandBoard(o: IslandOpts = {}) {
  return devBoard(
    [
      { key: "isl", def: printing(ISLAND), owner: P1, zone: o.zone ?? "hand" },
      ...fillers("d", o.deck ?? 5, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 3, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

clause(ISLAND, "0:rule", "the card itself: cost 5 with [G][G] - refused at 4 resources and with one [G]; pays exactly 5", () => {
  const short = islandBoard({ greed: 2, rage: 2 });
  refused(() => playRaw(short.engine, P1, short.id("isl")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("isl")), "hand");
  const oneGreed = islandBoard({ greed: 1, rage: 6 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("isl")), "only one [G]");
  const ok = islandBoard({ greed: 2, rage: 4 });
  play(ok.engine, P1, ok.id("isl"));
  assert.equal(ready(ok.engine), 1, "5 of 6 paid");
  assert.equal(zoneOf(ok.engine, ok.id("isl")), "discard", "a resolved tactic goes to my discard pile");
});

clause(ISLAND, "0:rule", "draws exactly 3 cards: the top three of my deck, in order, and no others", () => {
  const game = islandBoard();
  const [a, b, c, d, e] = deckOf(game.engine, P1);
  play(game.engine, P1, game.id("isl"));
  assert.deepEqual(handOf(game.engine, P1), [a, b, c]);
  assert.deepEqual(deckOf(game.engine, P1), [d, e]);
});

clause(ISLAND, "0:rule", "the draw happens when the tactic resolves, not while it waits for responses", () => {
  const game = islandBoard();
  playRaw(game.engine, P1, game.id("isl"));
  assert.equal(handOf(game.engine, P1).length, 0);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, 3);
});

clause(ISLAND, "0:rule", "with only 2 cards in the deck it draws those 2 and I do not lose", () => {
  const game = islandBoard({ deck: 2 });
  play(game.engine, P1, game.id("isl"));
  assert.equal(handOf(game.engine, P1).length, 2);
  assert.equal(deckOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
});

clause(ISLAND, "0:rule", "with an empty deck it draws nothing and I do not lose", () => {
  const game = islandBoard({ deck: 0 });
  play(game.engine, P1, game.id("isl"));
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
});

clause(ISLAND, "0:rule", "I draw, not my opponent: their hand and deck are untouched", () => {
  const game = islandBoard();
  play(game.engine, P1, game.id("isl"));
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(ISLAND, "0:rule", "a tactic: it can be played in response on the opponent's turn", () => {
  const game = islandBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  play(game.engine, P1, game.id("isl"));
  assert.equal(handOf(game.engine, P1).length, 3);
});

// --- RECUR ---------------------------------------------------------------------

const recurIsland = (game: ReturnType<typeof islandBoard>, player: PlayerId = P1) => actRaw(game.engine, player, game.id("isl"), "recur");

clause(ISLAND, "1:ability:recur", "from my discard pile: pays exactly 1, removes the Island from the game and draws one card", () => {
  const game = islandBoard({ zone: "discard", greed: 2, rage: 1 });
  const top = deckOf(game.engine, P1)[0];
  recurIsland(game);
  assert.equal(ready(game.engine), 2, "1 of 3 paid");
  assert.equal(zoneOf(game.engine, game.id("isl")), "removed", "removed from the game as a cost");
  assert.ok(removedOf(game.engine, P1).includes(game.id("isl")), "removedOf(game.engine, P1).includes(game.id(\"isl\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("isl")), "!discardOf(game.engine, P1).includes(game.id(\"isl\"))");
  assert.equal(handOf(game.engine, P1).length, 0, "the draw waits for responses");
  resolvePendingResponses(game.engine);
  assert.deepEqual(handOf(game.engine, P1), [top]);
  assert.equal(deckOf(game.engine, P1).length, 4);
});

clause(ISLAND, "1:ability:recur", "refused with only one [G] (RECUR: [G][G])", () => {
  const game = islandBoard({ zone: "discard", greed: 1, rage: 4 });
  refused(() => recurIsland(game), "one [G]");
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
  assert.equal(ready(game.engine), 5, "nothing paid");
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(ISLAND, "1:ability:recur", "the opponent's [G] do not meet RECUR's threshold", () => {
  const game = islandBoard({ zone: "discard", greed: 0, rage: 4, extra: bank("greed", 3, P2) });
  refused(() => recurIsland(game), "their Greed");
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
});

clause(ISLAND, "1:ability:recur", "[G] that are already spent still meet the threshold: two spent [G] and one ready resource is enough", () => {
  const game = islandBoard({ zone: "discard", greed: 0, rage: 1, spent: 2 });
  assert.equal(ready(game.engine), 1);
  recurIsland(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("isl")), "removed");
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(ISLAND, "1:ability:recur", "refused when no resource is ready to pay 1 (both [G] spent): nothing is removed or drawn", () => {
  const game = islandBoard({ zone: "discard", greed: 0, rage: 0, spent: 2 });
  assert.equal(ready(game.engine), 0);
  refused(() => recurIsland(game), "nothing to pay 1 with");
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
  assert.equal(handOf(game.engine, P1).length, 0);
});

for (const zone of ["hand", "deck", "removed"] as const) {
  clause(ISLAND, "1:ability:recur", `'use this only if this card is in your discard pile': refused while it is in my ${zone}`, () => {
    const game = islandBoard({ zone });
    refused(() => recurIsland(game), `from ${zone}`);
    assert.equal(zoneOf(game.engine, game.id("isl")), zone);
    assert.equal(ready(game.engine), 5, "nothing paid");
    const control = islandBoard({ zone: "discard" });
    recurIsland(control);
    assert.equal(zoneOf(control.engine, control.id("isl")), "removed", "control: from the discard pile it works");
  });
}

clause(ISLAND, "1:ability:recur", "only my own discard pile: the opponent cannot use RECUR on an Island in MY discard pile", () => {
  const game = islandBoard({ zone: "discard", extra: bank("greed", 2, P2).concat(bank("rage", 2, P2)) });
  refused(() => recurIsland(game, P2), "the opponent using my Island");
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
});

clause(ISLAND, "1:ability:recur", "the opponent can use RECUR on THEIR Island in their discard pile", () => {
  const game = devBoard(
    [
      { key: "isl", def: printing(ISLAND), owner: P2, zone: "discard" },
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", 2, P2),
      ...bank("rage", 1, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  actRaw(game.engine, P2, game.id("isl"), "recur");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("isl")), "removed");
  assert.equal(handOf(game.engine, P2).length, 1);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(ISLAND, "1:ability:recur", "it is available right after the tactic resolved into my discard pile, and then it is gone for good", () => {
  const game = islandBoard({ greed: 2, rage: 6 });
  play(game.engine, P1, game.id("isl"));
  assert.equal(zoneOf(game.engine, game.id("isl")), "discard");
  const handBefore = handOf(game.engine, P1).length;
  activate(game.engine, P1, game.id("isl"), "recur");
  assert.equal(zoneOf(game.engine, game.id("isl")), "removed");
  assert.equal(handOf(game.engine, P1).length, handBefore + 1);
  refused(() => recurIsland(game), "it is out of the game now");
});

clause(ISLAND, "1:ability:recur", "removes only the Island: other cards in my discard pile stay", () => {
  const game = islandBoard({ zone: "discard", extra: [{ key: "other", def: character({ name: "Other Dead" }), owner: P1, zone: "discard" }] });
  recurIsland(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("other")), "discard");
});

clause(ISLAND, "1:ability:recur", "draws exactly one card for me, none for the opponent", () => {
  const game = islandBoard({ zone: "discard" });
  recurIsland(game);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, 1);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(ISLAND, "1:ability:recur", "with an empty deck it still removes the Island, draws nothing and does not lose", () => {
  const game = islandBoard({ zone: "discard", deck: 0 });
  recurIsland(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("isl")), "removed");
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
});

clause(ISLAND, "1:ability:recur", "it is an ability, usable at any time I could use one: on my own turn with no response window open and in response on the opponent's turn", () => {
  const mine = islandBoard({ zone: "discard" });
  assert.equal(mine.engine.state.responseWindow, undefined);
  activate(mine.engine, P1, mine.id("isl"), "recur");
  assert.equal(handOf(mine.engine, P1).length, 1);
  const theirs = islandBoard({
    zone: "discard",
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(theirs.engine, P2, [theirs.id("atk")]);
  activate(theirs.engine, P1, theirs.id("isl"), "recur");
  assert.equal(handOf(theirs.engine, P1).length, 1);
  assert.equal(zoneOf(theirs.engine, theirs.id("isl")), "removed");
});

// =============================================================================
// Essence of Greed
// Choose one of the following as this card's rules text:
// OPTION 1 -- Draw a card.
// OPTION 2 -- COST: Pick a character. EFFECT: This turn, the character gains 2 life.
// OPTION 3 -- Your faction gains 4 influence.
// Tactic, cost 1, threshold [G][G].
// =============================================================================

const ESSENCE = "f446634a-a9bb-45d9-b34f-7673bebff90a";

interface EssenceOpts {
  greed?: number;
  rage?: number;
  deck?: number;
  characters?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function essenceBoard(o: EssenceOpts = {}) {
  return devBoard(
    [
      { key: "es", def: printing(ESSENCE), owner: P1, zone: "hand" },
      ...(o.characters === false
        ? []
        : [
            { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" } as CardPlacement,
            { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" } as CardPlacement
          ]),
      ...fillers("d", o.deck ?? 4, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const playEssence = (game: ReturnType<typeof essenceBoard>, mode: number | undefined, pick: string[] = []) =>
  playModeRaw(game.engine, P1, game.id("es"), mode, pick.length ? { c: pick.map((key) => game.id(key)) } : {});
const finishEssence = (game: ReturnType<typeof essenceBoard>, mode: number | undefined, pick: string[] = []) => {
  playEssence(game, mode, pick);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
};

clause(ESSENCE, "0:rule", "the card itself: cost 1 with [G][G] for every option - refused with no resources and with one [G]; pays exactly 1", () => {
  for (const mode of [0, 1, 2]) {
    const none = essenceBoard({ greed: 0, rage: 0 });
    refused(() => playEssence(none, mode, ["mine"]), `no resources, option ${mode + 1}`);
    assert.equal(zoneOf(none.engine, none.id("es")), "hand");
    const oneGreed = essenceBoard({ greed: 1, rage: 3 });
    refused(() => playEssence(oneGreed, mode, ["mine"]), `one [G], option ${mode + 1}`);
    assert.equal(zoneOf(oneGreed.engine, oneGreed.id("es")), "hand");
    const ok = essenceBoard({ greed: 2, rage: 2 });
    finishEssence(ok, mode, ["mine"]);
    assert.equal(ready(ok.engine), 3, `option ${mode + 1}: 1 of 4 paid`);
    assert.equal(zoneOf(ok.engine, ok.id("es")), "discard", "a resolved tactic goes to my discard pile");
  }
});

clause(ESSENCE, "0:rule", "'Choose one': playing it without choosing an option is refused instead of silently using option 1", () => {
  const game = essenceBoard();
  refused(() => playEssence(game, undefined, ["mine"]), "no option chosen");
  assert.equal(zoneOf(game.engine, game.id("es")), "hand");
  assert.equal(handOf(game.engine, P1).length, 1, "nothing was drawn; only the Essence itself is in hand");
});

clause(ESSENCE, "0:rule", "there are exactly three options: option 4 and negative or fractional options are refused", () => {
  for (const mode of [3, -1, 1.5]) {
    const game = essenceBoard();
    refused(() => playEssence(game, mode, ["mine"]), `option index ${mode}`);
    assert.equal(zoneOf(game.engine, game.id("es")), "hand");
    assert.equal(ready(game.engine), 4, "nothing was paid");
  }
});

clause(ESSENCE, "0:rule", "only the chosen option's text is in force: option 1 draws and nothing else happens", () => {
  const game = essenceBoard();
  finishEssence(game, 0, ["mine"]);
  assert.equal(handOf(game.engine, P1).length, 1);
  assert.equal(influenceOf(game.engine, P1), START, "no influence from option 3");
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3, "no life from option 2, even though a character was offered");
});

clause(ESSENCE, "0:rule", "only the chosen option's text is in force: option 2 gives life and nothing else happens", () => {
  const game = essenceBoard();
  finishEssence(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 5);
  assert.equal(handOf(game.engine, P1).length, 0, "no draw from option 1");
  assert.equal(influenceOf(game.engine, P1), START, "no influence from option 3");
});

clause(ESSENCE, "0:rule", "only the chosen option's text is in force: option 3 gains influence and nothing else happens", () => {
  const game = essenceBoard();
  finishEssence(game, 2, ["mine"]);
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3);
});

clause(ESSENCE, "0:rule", "an option's extra cost applies only to that option: options 1 and 3 need no character in play, option 2 cannot be played without one", () => {
  const one = essenceBoard({ characters: false });
  finishEssence(one, 0);
  assert.equal(handOf(one.engine, P1).length, 1);
  const three = essenceBoard({ characters: false });
  finishEssence(three, 2);
  assert.equal(influenceOf(three.engine, P1), START + 4);
  const two = essenceBoard({ characters: false });
  refused(() => playEssence(two, 1), "option 2 has no character to pick");
  assert.equal(zoneOf(two.engine, two.id("es")), "hand");
});

clause(ESSENCE, "0:rule", "it is a tactic: every option can be played in response on the opponent's turn", () => {
  for (const mode of [0, 1, 2]) {
    const game = essenceBoard({
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
    });
    declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
    assert.equal(game.engine.state.priorityPlayerId, P1);
    finishEssence(game, mode, ["mine"]);
    assert.equal(zoneOf(game.engine, game.id("es")), "discard", `option ${mode + 1}`);
  }
});

// --- OPTION 1: Draw a card -----------------------------------------------------

clause(ESSENCE, "1:option:OPTION 1", "draws exactly one card: the top of my deck; the deck shrinks by one", () => {
  const game = essenceBoard();
  const top = deckOf(game.engine, P1)[0];
  finishEssence(game, 0);
  assert.deepEqual(handOf(game.engine, P1), [top]);
  assert.equal(deckOf(game.engine, P1).length, 3);
});

clause(ESSENCE, "1:option:OPTION 1", "the draw happens when it resolves, not while it waits for responses", () => {
  const game = essenceBoard();
  playEssence(game, 0);
  assert.equal(handOf(game.engine, P1).length, 0);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(ESSENCE, "1:option:OPTION 1", "for me only: the opponent's hand and deck are untouched", () => {
  const game = essenceBoard();
  finishEssence(game, 0);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(ESSENCE, "1:option:OPTION 1", "with an empty deck it draws nothing and I do not lose", () => {
  const game = essenceBoard({ deck: 0 });
  finishEssence(game, 0);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(game.engine.state.result, undefined);
  assert.equal(zoneOf(game.engine, game.id("es")), "discard");
});

// --- OPTION 2: pick a character, +2 life this turn ----------------------------------

clause(ESSENCE, "2:option:OPTION 2", "my character gains exactly 2 life (3 -> 5); strength and speed are unchanged", () => {
  const game = essenceBoard();
  finishEssence(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("mine"), "speed"), 2);
});

clause(ESSENCE, "2:option:OPTION 2", "'a character' can be the opponent's too", () => {
  const game = essenceBoard();
  finishEssence(game, 1, ["foe"]);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3);
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P1, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P1, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P1, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })]
] as const) {
  clause(ESSENCE, "2:option:OPTION 2", `cannot pick ${label}`, () => {
    const bad = essenceBoard({ extra: [make()] });
    const before = ready(bad.engine);
    refused(() => playEssence(bad, 1, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("es")), "hand");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = essenceBoard({ extra: [make()] });
    finishEssence(good, 1, ["mine"]);
    assert.equal(good.engine.getStat(good.id("mine"), "life"), 5, "control");
  });
}

clause(ESSENCE, "2:option:OPTION 2", "cannot pick a faction, and needs exactly one pick", () => {
  const game = essenceBoard();
  refused(() => playModeRaw(game.engine, P1, game.id("es"), 1, { c: [game.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => playModeRaw(game.engine, P1, game.id("es"), 1, { c: [game.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => playEssence(game, 1, []), "no pick");
  refused(() => playEssence(game, 1, ["mine", "foe"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("es")), "hand");
  assert.equal(ready(game.engine), 4);
  finishEssence(game, 1, ["foe"]);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 5, "control: one character");
});

clause(ESSENCE, "2:option:OPTION 2", "'this turn': the +2 life is real in play (a 4-damage hit kills a 3-life character, not a 5-life one) and ends with the turn", () => {
  const without = essenceBoard({ extra: [{ key: "smite", def: damageTactic(4), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("smite"), { selected: { t: [without.id("mine")] } });
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control: 4 damage kills 3 life");
  const game = essenceBoard({ extra: [{ key: "smite", def: damageTactic(4), owner: P1, zone: "hand" }] });
  finishEssence(game, 1, ["mine"]);
  play(game.engine, P1, game.id("smite"), { selected: { t: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "5 life survives 4 damage");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 4);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 5, "still this turn");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3, "the bonus ended");
});

clause(ESSENCE, "2:option:OPTION 2", "affects only the picked character: the other characters keep their life", () => {
  const game = essenceBoard({ extra: [{ key: "bystander", def: character({ name: "Bystander", life: 4 }), owner: P1, zone: "play" }] });
  finishEssence(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 3);
  assert.equal(game.engine.getStat(game.id("bystander"), "life"), 4);
});

// --- OPTION 3: Your faction gains 4 influence ------------------------------------

clause(ESSENCE, "3:option:OPTION 3", "my faction gains exactly 4 influence; the opponent's is untouched", () => {
  const game = essenceBoard();
  finishEssence(game, 2);
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(ESSENCE, "3:option:OPTION 3", "the gain happens when it resolves, not while it waits for responses", () => {
  const game = essenceBoard();
  playEssence(game, 2);
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(ESSENCE, "3:option:OPTION 3", "'your faction' is the caster's: when the opponent plays their own Essence, THEIR faction gains 4", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "es", def: printing(ESSENCE), owner: P2, zone: "hand" }, ...bank("greed", 2, P2)]
  });
  playModeRaw(game.engine, P2, game.id("es"), 2);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START + 4);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(ESSENCE, "3:option:OPTION 3", "stacks on whatever I have: from 5 influence I go to 9 (no cap)", () => {
  const game = buildGame({
    playerA: { faction: developFaction(), influence: 5 },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "es", def: printing(ESSENCE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  playModeRaw(game.engine, P1, game.id("es"), 2);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), 9);
});

// =============================================================================
// Exploitation
// This card provides - [G][G]
// When this card enters play, your faction loses 1 influence.
// Resource, cost 0.
// =============================================================================

const EXPLOIT = "577159cb-d920-4526-bc82-28f74effc6ea";

function exploitBoard(o: { zone?: "hand" | "play"; faceDown?: boolean; extra?: CardPlacement[]; influence?: number; owner?: PlayerId; second?: boolean } = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: owner === P1 ? o.influence : undefined },
    playerB: { faction: developFaction(), influence: owner === P2 ? o.influence : undefined },
    turn: 1,
    activePlayerId: owner,
    cards: [
      { key: "ex", def: printing(EXPLOIT), owner, zone: o.zone ?? "hand", faceDown: (o.zone ?? "hand") === "play" ? o.faceDown : undefined },
      ...(o.second ? [{ key: "ex2", def: printing(EXPLOIT), owner, zone: "hand" } as CardPlacement] : []),
      ...(o.extra ?? [])
    ]
  });
}

/** A character with the given cost and icon threshold, in P1's hand. */
const gated = (key: string, cost: number, threshold: string): CardPlacement => ({
  key,
  def: character({ name: `Gated ${key}`, cost, threshold, strength: 1, life: 1, speed: 1 }),
  owner: P1,
  zone: "hand"
});

const thresholdsOf = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getThresholds(player) as Record<string, number | undefined>;

clause(EXPLOIT, "0:rule", "in play face-up it provides exactly two [G] and nothing else (no Volition, no other icons)", () => {
  const game = exploitBoard({ zone: "play" });
  const icons = thresholdsOf(game.engine);
  assert.equal(icons.greed, 2);
  for (const other of ["rage", "deception", "elitism", "obsession", "volition"]) assert.ok(!icons[other], `no ${other}`);
});

clause(EXPLOIT, "0:rule", "it is one resource card: it adds 1 to my ready resources, not 2", () => {
  const game = exploitBoard({ zone: "play" });
  assert.equal(ready(game.engine), 1);
  const two = exploitBoard({ zone: "play", extra: [{ key: "ex2", def: printing(EXPLOIT), owner: P1, zone: "play" }] });
  assert.equal(ready(two.engine), 2);
  assert.equal(thresholdsOf(two.engine).greed, 4, "two cards, four [G]");
});

clause(EXPLOIT, "0:rule", "a [G][G] card can be deployed with a single Exploitation as its only [G] source", () => {
  const ok = exploitBoard({ zone: "play", extra: [gated("c", 1, "gg"), ...bank("rage", 1, P1)] });
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  const control = exploitBoard({ zone: "hand", extra: [gated("c", 1, "gg"), ...bank("rage", 2, P1)] });
  refused(() => playRaw(control.engine, P1, control.id("c")), "control: no Exploitation in play, no [G]");
});

clause(EXPLOIT, "0:rule", "it provides only two [G]: a [G][G][G] card is not met by Exploitation alone, and is met with one more [G]", () => {
  const alone = exploitBoard({ zone: "play", extra: [gated("c", 1, "ggg"), ...bank("rage", 1, P1)] });
  refused(() => playRaw(alone.engine, P1, alone.id("c")), "only [G][G]");
  const plusGreed = exploitBoard({ zone: "play", extra: [gated("c", 1, "ggg"), ...bank("greed", 1, P1)] });
  play(plusGreed.engine, P1, plusGreed.id("c"));
  assert.equal(zoneOf(plusGreed.engine, plusGreed.id("c")), "play");
});

clause(EXPLOIT, "0:rule", "it provides no other icon: [R] and [V] thresholds are not met by a face-up Exploitation", () => {
  for (const threshold of ["r", "v", "d", "e", "o"]) {
    const game = exploitBoard({ zone: "play", extra: [gated("c", 1, threshold), ...bank("greed", 1, P1)] });
    refused(() => playRaw(game.engine, P1, game.id("c")), `threshold ${threshold}`);
  }
});

clause(EXPLOIT, "0:rule", "paying with it spends the card but its [G][G] still count (icons are never spent)", () => {
  const game = exploitBoard({ zone: "play", extra: [{ key: "pay1", def: character({ name: "One", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" }, gated("c", 0, "gg")] });
  play(game.engine, P1, game.id("pay1"));
  assert.equal(ready(game.engine), 0, "the Exploitation paid the 1");
  assert.equal(thresholdsOf(game.engine).greed, 2);
  play(game.engine, P1, game.id("c"));
  assert.equal(zoneOf(game.engine, game.id("c")), "play", "[G][G] is still met");
});

clause(EXPLOIT, "0:rule", "it can pay for a cost-1 card by itself, and is one resource short for a cost-2 card", () => {
  const two = exploitBoard({ zone: "play", extra: [{ key: "c", def: character({ name: "Two", cost: 2, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" }] });
  refused(() => playRaw(two.engine, P1, two.id("c")), "one resource for cost 2");
  const withRage = exploitBoard({ zone: "play", extra: [{ key: "c", def: character({ name: "Two", cost: 2, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" }, ...bank("rage", 1, P1)] });
  play(withRage.engine, P1, withRage.id("c"));
  assert.equal(zoneOf(withRage.engine, withRage.id("c")), "play");
});

clause(EXPLOIT, "0:rule", "played face-down it is only a Volition resource: no [G] at all", () => {
  const game = exploitBoard({ zone: "play", faceDown: true });
  const icons = thresholdsOf(game.engine);
  assert.equal(icons.volition, 1);
  assert.ok(!icons.greed, "no Greed while face-down");
  const gate = exploitBoard({ zone: "play", faceDown: true, extra: [gated("c", 0, "g")] });
  refused(() => playRaw(gate.engine, P1, gate.id("c")), "a face-down Exploitation is not [G]");
  const vol = exploitBoard({ zone: "play", faceDown: true, extra: [gated("c", 0, "v")] });
  play(vol.engine, P1, vol.id("c"));
  assert.equal(zoneOf(vol.engine, vol.id("c")), "play", "but it is Volition");
});

clause(EXPLOIT, "0:rule", "the opponent's Exploitation gives me no [G]", () => {
  // P1 is the active player, so only the missing [G] threshold can refuse the deploy
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [{ key: "ex", def: printing(EXPLOIT), owner: P2, zone: "play" }, gated("c", 0, "g")]
  });
  assert.ok(!thresholdsOf(game.engine, P1).greed, "!thresholdsOf(game.engine, P1).greed");
  refused(() => playRaw(game.engine, P1, game.id("c")), "their [G]", /Threshold requirements are not met/);
  assert.equal(thresholdsOf(game.engine, P2).greed, 2);
});

clause(EXPLOIT, "0:rule", "a resource is played only by an effect (CR 203.1): it cannot be deployed like a card from hand", () => {
  const game = exploitBoard({ zone: "hand" });
  refused(() => playRaw(game.engine, P1, game.id("ex")), "deploying a resource card");
  assert.equal(zoneOf(game.engine, game.id("ex")), "hand");
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(zoneOf(game.engine, game.id("ex")), "play", "control: the Develop Rule plays it");
  assert.equal(game.engine.state.cards[game.id("ex")].faceDown, false);
});

clause(EXPLOIT, "0:rule", "through the Develop Rule face-up it provides its two [G] immediately", () => {
  const game = exploitBoard({ zone: "hand" });
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(thresholdsOf(game.engine).greed, 2);
  assert.equal(ready(game.engine), 1);
});

// --- When this card enters play, your faction loses 1 influence -----------------

clause(EXPLOIT, "1:rule", "played face-up through the Develop Rule my faction loses exactly 1 influence (not 2); the opponent's is untouched", () => {
  const game = exploitBoard({ zone: "hand" });
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(influenceOf(game.engine, P1), START - 1);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(EXPLOIT, "1:rule", "put into play by an effect it also costs exactly 1 influence", () => {
  const game = exploitBoard({ zone: "hand", extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("ex")] } });
  assert.equal(zoneOf(game.engine, game.id("ex")), "play");
  assert.equal(game.engine.state.cards[game.id("ex")].faceDown, false);
  assert.equal(influenceOf(game.engine, P1), START - 1);
});

clause(EXPLOIT, "1:rule", "played face-down it is just a Volition resource and costs no influence", () => {
  const game = exploitBoard({ zone: "hand" });
  developResource(game.engine, P1, game.id("ex"), true);
  assert.equal(game.engine.state.cards[game.id("ex")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(EXPLOIT, "1:rule", "two Exploitations cost 2 influence in total", () => {
  const game = exploitBoard({ zone: "hand", second: true, extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("ex"), false);
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("ex2")] } });
  assert.equal(zoneOf(game.engine, game.id("ex2")), "play");
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(EXPLOIT, "1:rule", "it triggers only for itself: another resource entering play while it is in play costs nothing", () => {
  const game = exploitBoard({
    zone: "play",
    extra: [{ key: "plain", def: resourceCard({ name: "Plain Rage" }), owner: P1, zone: "hand" }]
  });
  developResource(game.engine, P1, game.id("plain"), false);
  assert.equal(zoneOf(game.engine, game.id("plain")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(EXPLOIT, "1:rule", "'your faction' is its controller's: when the opponent plays their own Exploitation, THEIR faction loses 1", () => {
  const game = exploitBoard({ zone: "hand", owner: P2 });
  developResource(game.engine, P2, game.id("ex"), false);
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(EXPLOIT, "1:rule", "leaving play neither refunds the influence nor costs more", () => {
  const smash = smashResourceTactic();
  const game = exploitBoard({ zone: "hand", extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(influenceOf(game.engine, P1), START - 1);
  play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("ex")] } });
  assert.equal(zoneOf(game.engine, game.id("ex")), "discard");
  assert.equal(influenceOf(game.engine, P1), START - 1);
});

clause(EXPLOIT, "1:rule", "with exactly 1 influence left the loss brings it to 0 and I lose the game", () => {
  const game = exploitBoard({ zone: "hand", influence: 1 });
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(EXPLOIT, "1:rule", "with 2 influence left it goes to 1 and the game goes on", () => {
  const game = exploitBoard({ zone: "hand", influence: 2 });
  developResource(game.engine, P1, game.id("ex"), false);
  assert.equal(influenceOf(game.engine, P1), 1);
  assert.equal(game.engine.state.result, undefined);
});

clause(EXPLOIT, "1:rule", "played by a faction ability that plays a resource (not the Develop Rule) it still costs exactly 1 influence, not 2", () => {
  const faction = factionCard({
    name: "Resourceland",
    faction: {
      startingInfluence: 30,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } },
      abilities: [
        {
          id: "res",
          type: "activated",
          costs: [],
          targets: [{ id: "r", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }],
          effects: [{ type: "playResource", target: { type: "selected", id: "r" }, faceDown: "auto" }]
        }
      ]
    }
  });
  const game = buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [{ key: "ex", def: printing(EXPLOIT), owner: P1, zone: "hand" }]
  });
  activate(game.engine, P1, game.engine.state.players[P1].factionId!, "res", { selected: { r: [game.id("ex")] } });
  assert.equal(zoneOf(game.engine, game.id("ex")), "play");
  assert.equal(game.engine.state.cards[game.id("ex")].faceDown, false);
  assert.equal(influenceOf(game.engine, P1), START - 1);
});

clause(EXPLOIT, "1:rule", "taking control of my Exploitation does not make it 'enter play' again: no further influence loss", () => {
  const grab = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = exploitBoard({ zone: "play", extra: [{ key: "grab", def: grab, owner: P2, zone: "hand" }] });
  game.engine.state.activePlayerId = P2;
  game.engine.state.priorityPlayerId = P2;
  play(game.engine, P2, game.id("grab"), { selected: { t: [game.id("ex")] } });
  assert.equal(game.engine.state.cards[game.id("ex")].controllerId, P2);
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(influenceOf(game.engine, P2), START);
});

// =============================================================================
// Extravagant Contusion
// COST: Choose a number for X. Pay X. Pick a character with numeric cost X or less.
// EFFECT: Destroy the character.
// Tactic, cost 0, threshold [G][G].
// =============================================================================

const CONTUSION = "7a5a5e6a-a551-4998-a33b-323287f64059";

function contusionBoard(o: { greed?: number; rage?: number; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "ec", def: printing(CONTUSION), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "Cost Zero", cost: 0, strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "Cost Two", cost: 2, strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "c4", def: character({ name: "Cost Four", cost: 4, strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine3", def: character({ name: "Mine Three", cost: 3, strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 4, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const playContusion = (game: ReturnType<typeof contusionBoard>, x: number, pick: string[]) =>
  playRaw(game.engine, P1, game.id("ec"), { selected: { c: pick.map((key) => game.id(key)) }, variables: { x } });
const finishContusion = (game: ReturnType<typeof contusionBoard>, x: number, pick: string[]) => {
  playContusion(game, x, pick);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
};

clause(CONTUSION, "0:ability", "the card itself: printed cost 0 but threshold [G][G] - refused with one [G], playable with exactly [G][G] and X = 0", () => {
  const oneGreed = contusionBoard({ greed: 1, rage: 4 });
  refused(() => playContusion(oneGreed, 0, ["c0"]), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("ec")), "hand");
  const ok = contusionBoard({ greed: 2, rage: 0 });
  finishContusion(ok, 0, ["c0"]);
  assert.equal(zoneOf(ok.engine, ok.id("c0")), "discard");
  assert.equal(zoneOf(ok.engine, ok.id("ec")), "discard", "a resolved tactic goes to my discard pile");
  assert.equal(ready(ok.engine), 2, "X = 0 pays nothing");
});

for (const x of [0, 1, 2, 4]) {
  clause(CONTUSION, "0:ability", `X = ${x}: pays exactly ${x} (ready resources drop by ${x})`, () => {
    const game = contusionBoard({ greed: 2, rage: 4 });
    const before = ready(game.engine);
    playContusion(game, x, ["c0"]);
    assert.equal(before - ready(game.engine), x);
    resolvePendingResponses(game.engine);
    assert.equal(zoneOf(game.engine, game.id("c0")), "discard");
  });
}

clause(CONTUSION, "0:ability", "X cannot exceed what I can pay: X = 3 with only 2 ready resources is refused, X = 2 is accepted", () => {
  const poor = contusionBoard({ greed: 2, rage: 0 });
  refused(() => playContusion(poor, 3, ["c0"]), "pay 3 with 2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("ec")), "hand");
  assert.equal(ready(poor.engine), 2);
  const ok = contusionBoard({ greed: 2, rage: 0 });
  finishContusion(ok, 2, ["c2"]);
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "discard");
  assert.equal(ready(ok.engine), 0);
});

clause(CONTUSION, "0:ability", "the pick is limited by X: with X = 0 only the cost-0 character may be picked", () => {
  for (const key of ["c2", "c4", "mine3"]) {
    const bad = contusionBoard();
    refused(() => playContusion(bad, 0, [key]), `${key} costs more than 0`);
    assert.equal(zoneOf(bad.engine, bad.id("ec")), "hand");
    assert.equal(ready(bad.engine), 6, "nothing was paid");
  }
  const ok = contusionBoard();
  finishContusion(ok, 0, ["c0"]);
  assert.equal(zoneOf(ok.engine, ok.id("c0")), "discard");
});

clause(CONTUSION, "0:ability", "'numeric cost X or less': cost = X is allowed, cost = X + 1 is refused (X = 2: cost 2 yes, cost 3 and 4 no)", () => {
  const equal = contusionBoard();
  finishContusion(equal, 2, ["c2"]);
  assert.equal(zoneOf(equal.engine, equal.id("c2")), "discard");
  for (const key of ["mine3", "c4"]) {
    const over = contusionBoard();
    refused(() => playContusion(over, 2, [key]), `${key} costs more than 2`);
    assert.equal(zoneOf(over.engine, over.id("ec")), "hand");
  }
});

clause(CONTUSION, "0:ability", "'or less': with X = 2 the cost-0 character may be picked too", () => {
  const game = contusionBoard();
  finishContusion(game, 2, ["c0"]);
  assert.equal(zoneOf(game.engine, game.id("c0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("c2")), "play", "only the picked character dies");
});

clause(CONTUSION, "0:ability", "a larger X reaches the cost-4 character, and my own cost-3 character can be picked too", () => {
  const four = contusionBoard({ greed: 2, rage: 4 });
  finishContusion(four, 4, ["c4"]);
  assert.equal(zoneOf(four.engine, four.id("c4")), "discard");
  assert.equal(ready(four.engine), 2);
  const mine = contusionBoard();
  finishContusion(mine, 3, ["mine3"]);
  assert.equal(zoneOf(mine.engine, mine.id("mine3")), "discard");
  assert.ok(discardOf(mine.engine, P1).includes(mine.id("mine3")), "discardOf(mine.engine, P1).includes(mine.id(\"mine3\"))");
});

clause(CONTUSION, "0:ability", "the destroyed character goes to its owner's discard pile", () => {
  const game = contusionBoard();
  finishContusion(game, 2, ["c2"]);
  assert.ok(discardOf(game.engine, P2).includes(game.id("c2")), "discardOf(game.engine, P2).includes(game.id(\"c2\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("c2")), "!discardOf(game.engine, P1).includes(game.id(\"c2\"))");
});

clause(CONTUSION, "0:ability", "X must be a whole number (CR 410.2) and not negative: fractional and negative X are refused", () => {
  for (const x of [1.5, -1]) {
    const game = contusionBoard();
    refused(() => playContusion(game, x, ["c0"]), `X = ${x}`);
    assert.equal(zoneOf(game.engine, game.id("ec")), "hand");
    assert.equal(ready(game.engine), 6, "nothing was paid");
  }
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Cheap Item", cost: 0 }), owner: P2, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Cheap Place", cost: 0, structure: 3 }), owner: P2, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource", cost: 0 }), owner: P2, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden", cost: 0 }), owner: P2, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand", cost: 0 }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard", cost: 0 }), owner: P1, zone: "discard" })],
  ["a character in the opponent's discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "Their Discard", cost: 0 }), owner: P2, zone: "discard" })]
] as const) {
  clause(CONTUSION, "0:ability", `cannot pick ${label}`, () => {
    const bad = contusionBoard({ extra: [make()] });
    const before = ready(bad.engine);
    refused(() => playContusion(bad, 4, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("ec")), "hand");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = contusionBoard({ extra: [make()] });
    finishContusion(good, 4, ["c4"]);
    assert.equal(zoneOf(good.engine, good.id("c4")), "discard", "control");
  });
}

clause(CONTUSION, "0:ability", "cannot pick a faction, and needs exactly one pick", () => {
  const game = contusionBoard();
  refused(() => playRaw(game.engine, P1, game.id("ec"), { selected: { c: [game.engine.state.players[P2].factionId!] }, variables: { x: 4 } }), "their faction");
  refused(() => playRaw(game.engine, P1, game.id("ec"), { selected: { c: [game.engine.state.players[P1].factionId!] }, variables: { x: 4 } }), "my faction");
  refused(() => playContusion(game, 4, []), "no pick");
  refused(() => playContusion(game, 4, ["c0", "c2"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("ec")), "hand");
  assert.equal(ready(game.engine), 6);
  finishContusion(game, 4, ["c2"]);
  assert.equal(zoneOf(game.engine, game.id("c0")), "play");
  assert.equal(zoneOf(game.engine, game.id("c2")), "discard");
});

clause(CONTUSION, "0:ability", "X is paid when it is played; the destroy happens when it resolves", () => {
  const game = contusionBoard();
  playContusion(game, 2, ["c2"]);
  assert.equal(ready(game.engine), 4, "X = 2 already paid");
  assert.equal(zoneOf(game.engine, game.id("c2")), "play", "the character is still there while responses are possible");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("c2")), "discard");
});

clause(CONTUSION, "0:ability", "can be played in response on the opponent's turn: destroys their attacker", () => {
  const game = contusionBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", cost: 3, strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  refused(() => playContusion(game, 2, ["atk"]), "the attacker costs 3, more than X = 2");
  finishContusion(game, 3, ["atk"]);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
});

// =============================================================================
// Fiscal Intercessor
// PLEAD -- COST: Deplete this card. Pick a character.
// EFFECT: If damage is inflicted to the character this turn, reduce the amount by 1.
// Character (mau), cost 3, threshold [G], 1 / 3 / 1.
// =============================================================================

const INTERCESSOR = "bdb490e9-ab52-4417-86da-97928dbd394f";

interface IntercessorOpts {
  zone?: "play" | "hand";
  depleted?: boolean;
  faceDown?: boolean;
  extra?: CardPlacement[];
  active?: PlayerId;
  second?: boolean;
}

function intercessorBoard(o: IntercessorOpts = {}) {
  return devBoard(
    [
      { key: "ic", def: printing(INTERCESSOR), owner: P1, zone: o.zone ?? "play", depleted: o.depleted, faceDown: o.faceDown },
      ...(o.second ? [{ key: "ic2", def: printing(INTERCESSOR), owner: P1, zone: "play" } as CardPlacement] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "smite3", def: damageTactic(3, "Their Smite"), owner: P2, zone: "hand" },
      { key: "mySmite1", def: damageTactic(1, "My Smite A"), owner: P1, zone: "hand" },
      { key: "mySmite3", def: damageTactic(3, "My Smite B"), owner: P1, zone: "hand" },
      { key: "mySmite3b", def: damageTactic(3, "My Smite C"), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const plead = (game: ReturnType<typeof intercessorBoard>, pick: string[], cardKey = "ic") =>
  actRaw(game.engine, P1, game.id(cardKey), "plead", { c: pick.map((key) => game.id(key)) });
const doPlead = (game: ReturnType<typeof intercessorBoard>, pick: string[], cardKey = "ic") => {
  plead(game, pick, cardKey);
  resolvePendingResponses(game.engine);
};
/** Damage dealt by a damage tactic (any owner), played by whoever owns it. */
const smite = (game: ReturnType<typeof intercessorBoard>, tacticKey: string, targetKey: string, player: PlayerId) =>
  play(game.engine, player, game.id(tacticKey), { selected: { t: [game.id(targetKey)] } });
const damageOn = (game: ReturnType<typeof intercessorBoard>, key: string) => game.engine.state.cards[game.id(key)].damage;

clause(INTERCESSOR, "0:ability:plead", "the card itself: cost 3 with [G] - refused at 2 resources and with no [G]; printed 1 / 3 / 1", () => {
  const mk = (greed: number, rage: number) =>
    devBoard([{ key: "ic", def: printing(INTERCESSOR), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)], { turn: 1 });
  const short = mk(1, 1);
  refused(() => playRaw(short.engine, P1, short.id("ic")), "2 resources for cost 3");
  const noGreed = mk(0, 5);
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("ic")), "no [G]");
  const ok = mk(1, 2);
  play(ok.engine, P1, ok.id("ic"));
  assert.equal(zoneOf(ok.engine, ok.id("ic")), "play");
  assert.equal(ready(ok.engine), 0);
  assert.equal(ok.engine.getStat(ok.id("ic"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("ic"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ic"), "life"), 1);
});

clause(INTERCESSOR, "0:ability:plead", "the cost depletes the Intercessor, free of resources, and the reduction is set up on the pick", () => {
  const game = intercessorBoard();
  plead(game, ["mine"]);
  assert.equal(game.engine.state.cards[game.id("ic")].depleted, true, "deplete paid when used");
  assert.equal(ready(game.engine), 0, "no resources involved");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("ic")].depleted, true);
});

clause(INTERCESSOR, "0:ability:plead", "refused while already depleted", () => {
  const game = intercessorBoard({ depleted: true });
  refused(() => plead(game, ["mine"]), "already depleted");
  smite(game, "mySmite3", "mine", P1);
  assert.equal(damageOn(game, "mine"), 3, "no reduction was set up");
});

clause(INTERCESSOR, "0:ability:plead", "usable the turn it enters play (CR 204.3a)", () => {
  const game = devBoard(
    [
      { key: "ic", def: printing(INTERCESSOR), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ],
    { turn: 1 }
  );
  play(game.engine, P1, game.id("ic"));
  doPlead(game as unknown as ReturnType<typeof intercessorBoard>, ["mine"]);
  assert.equal(game.engine.state.cards[game.id("ic")].depleted, true);
});

clause(INTERCESSOR, "0:ability:plead", "can pick any character: mine, the opponent's, or the Intercessor itself", () => {
  for (const key of ["mine", "foe", "ic"]) {
    const game = intercessorBoard();
    doPlead(game, [key]);
    assert.equal(game.engine.state.cards[game.id("ic")].depleted, true, key);
  }
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P1, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P1, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P1, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["a character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })]
] as const) {
  clause(INTERCESSOR, "0:ability:plead", `cannot pick ${label}`, () => {
    const bad = intercessorBoard({ extra: [make()] });
    refused(() => plead(bad, ["bad"]), label);
    assert.equal(bad.engine.state.cards[bad.id("ic")].depleted, false, "nothing was paid");
    const good = intercessorBoard({ extra: [make()] });
    doPlead(good, ["mine"]);
    assert.equal(good.engine.state.cards[good.id("ic")].depleted, true, "control");
  });
}

clause(INTERCESSOR, "0:ability:plead", "cannot pick a faction, and needs exactly one pick", () => {
  const game = intercessorBoard();
  refused(() => actRaw(game.engine, P1, game.id("ic"), "plead", { c: [game.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(game.engine, P1, game.id("ic"), "plead", { c: [game.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => plead(game, []), "no pick");
  refused(() => plead(game, ["mine", "foe"]), "two picks");
  assert.equal(game.engine.state.cards[game.id("ic")].depleted, false);
  doPlead(game, ["mine"]);
  assert.equal(game.engine.state.cards[game.id("ic")].depleted, true);
});

clause(INTERCESSOR, "0:ability:plead", "damage inflicted to the picked character this turn is reduced by exactly 1 (3 -> 2)", () => {
  const game = intercessorBoard();
  doPlead(game, ["mine"]);
  smite(game, "mySmite3", "mine", P1);
  assert.equal(damageOn(game, "mine"), 2);
});

clause(INTERCESSOR, "0:ability:plead", "control: without PLEAD the same damage is inflicted in full", () => {
  const game = intercessorBoard();
  smite(game, "mySmite3", "mine", P1);
  assert.equal(damageOn(game, "mine"), 3);
});

clause(INTERCESSOR, "0:ability:plead", "a 1-damage hit is reduced to 0: no damage at all (never negative)", () => {
  const game = intercessorBoard();
  doPlead(game, ["mine"]);
  smite(game, "mySmite1", "mine", P1);
  assert.equal(damageOn(game, "mine"), 0);
});

clause(INTERCESSOR, "0:ability:plead", "the reduction works on an opponent's character too, and on damage I deal to it", () => {
  const game = intercessorBoard();
  doPlead(game, ["foe"]);
  smite(game, "mySmite3", "foe", P1);
  assert.equal(damageOn(game, "foe"), 2);
});

clause(INTERCESSOR, "0:ability:plead", "only the picked character is protected: another character takes the full 3", () => {
  const game = intercessorBoard();
  doPlead(game, ["mine"]);
  smite(game, "mySmite3", "foe", P1);
  assert.equal(damageOn(game, "foe"), 3);
  assert.equal(damageOn(game, "ic"), 0);
});

clause(INTERCESSOR, "0:ability:plead", "'if damage is inflicted ... this turn': it applies to every instance this turn, not just the first (two 3-damage hits -> 2 + 2)", () => {
  const game = intercessorBoard();
  doPlead(game, ["mine"]);
  smite(game, "mySmite3", "mine", P1);
  smite(game, "mySmite3b", "mine", P1);
  assert.equal(damageOn(game, "mine"), 4, "each hit was reduced by 1");
});

clause(INTERCESSOR, "0:ability:plead", "it lets a 1-life character survive a 1-damage hit (the Intercessor protecting itself)", () => {
  const game = intercessorBoard();
  doPlead(game, ["ic"]);
  smite(game, "mySmite1", "ic", P1);
  assert.equal(zoneOf(game.engine, game.id("ic")), "play");
  assert.equal(damageOn(game, "ic"), 0);
  const without = intercessorBoard();
  smite(without, "mySmite1", "ic", P1);
  assert.equal(zoneOf(without.engine, without.id("ic")), "discard", "control: 1 damage kills a 1-life character");
});

clause(INTERCESSOR, "0:ability:plead", "two Intercessors pleading for the same character reduce each hit by 2 (3 -> 1)", () => {
  const game = intercessorBoard({ second: true });
  doPlead(game, ["mine"], "ic");
  doPlead(game, ["mine"], "ic2");
  smite(game, "mySmite3", "mine", P1);
  assert.equal(damageOn(game, "mine"), 1);
});

clause(INTERCESSOR, "0:ability:plead", "it is a response: used against a damage tactic the opponent has just played, the damage that follows is reduced", () => {
  const game = intercessorBoard({ active: P2 });
  playRaw(game.engine, P2, game.id("smite3"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  doPlead(game, ["mine"]);
  assert.equal(damageOn(game, "mine"), 2, "3 damage, reduced by 1 by the response");
});

clause(INTERCESSOR, "0:ability:plead", "battle damage is damage: a blocker hit by a strength-3 attacker takes 2", () => {
  const game = intercessorBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  doPlead(game, ["mine"]);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game, "mine"), 2, "3 battle damage - 1");
});

clause(INTERCESSOR, "0:ability:plead", "damage inflicted to the picked blocker by several attackers is summed first, then reduced once (2 + 2 -> 3)", () => {
  const game = intercessorBoard({
    active: P2,
    extra: [
      { key: "atk", def: character({ name: "Raider A", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Raider B", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk"), game.id("atk2")]);
  doPlead(game, ["mine"]);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game, "mine"), 3, "4 battle damage as a single amount, reduced by 1 (CR 609.1f)");
});

clause(INTERCESSOR, "0:ability:plead", "'this turn': it does not reduce damage in a later turn", () => {
  const game = intercessorBoard();
  doPlead(game, ["mine"]);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  smite(game, "smite3", "mine", P2);
  assert.equal(damageOn(game, "mine"), 3, "the next turn's damage is inflicted in full");
});

clause(INTERCESSOR, "0:ability:plead", "damage already inflicted before the PLEAD is not undone", () => {
  const game = intercessorBoard();
  smite(game, "mySmite3", "mine", P1);
  assert.equal(damageOn(game, "mine"), 3);
  doPlead(game, ["mine"]);
  assert.equal(damageOn(game, "mine"), 3);
});

clause(INTERCESSOR, "0:ability:plead", "only its controller can use it, and not from the hand; a face-down copy has no ability", () => {
  const opp = intercessorBoard({ extra: bank("rage", 3, P2) });
  refused(() => actRaw(opp.engine, P2, opp.id("ic"), "plead", { c: [opp.id("foe")] }), "the opponent using my Intercessor");
  const hand = intercessorBoard({ zone: "hand" });
  refused(() => plead(hand, ["mine"]), "from hand");
  const down = intercessorBoard({ faceDown: true });
  refused(() => plead(down, ["mine"]), "face-down");
});

// =============================================================================
// Flabbergasting Philosopher
// You may play this card whenever you could play a tactic.   (TACTICAL)
// When this card enters play, your faction gains 4 influence.
// FLIP UP: 4 [G][G]
// Character (mau), cost 6, threshold [G][G], 3 / 3 / 3.
// =============================================================================

const PHILO = "0c200267-b2b0-427b-980a-be56821251f5";
const VACATION = "f5b4db56-d972-48de-b1b5-7f16b7d427aa";

interface PhiloOpts {
  greed?: number;
  rage?: number;
  spent?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  active?: PlayerId;
  influence?: number;
  extra?: CardPlacement[];
  attack?: boolean;
}

function philoBoard(o: PhiloOpts = {}) {
  const active = o.active ?? P2;
  const game = buildGame({
    playerA: { faction: developFaction(), influence: o.influence },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "ph", def: printing(PHILO), owner: P1, zone: o.zone ?? "hand", faceDown: (o.zone ?? "hand") === "play" ? (o.faceDown ?? true) : undefined },
      { key: "plain", def: character({ name: "Plain Guy", cost: 0, strength: 1, life: 2, speed: 2 }), owner: P1, zone: "hand" },
      { key: "freeTactic", def: tactic({ name: "Free Trick", cost: 0 }), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 4, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ]
  });
  if (o.attack) declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  return game;
}

const playPhilo = (game: ReturnType<typeof philoBoard>) => playRaw(game.engine, P1, game.id("ph"));
const finishPhilo = (game: ReturnType<typeof philoBoard>) => {
  playPhilo(game);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(PHILO, "0:rule", "the card itself: cost 6 with [G][G] - refused at 5 resources and with one [G]; pays exactly 6; printed 3 / 3 / 3", () => {
  const short = philoBoard({ active: P1, greed: 2, rage: 3 });
  refused(() => playPhilo(short), "5 resources for cost 6");
  assert.equal(zoneOf(short.engine, short.id("ph")), "hand");
  const oneGreed = philoBoard({ active: P1, greed: 1, rage: 6 });
  refused(() => playPhilo(oneGreed), "only one [G]");
  const ok = philoBoard({ active: P1, greed: 2, rage: 5 });
  finishPhilo(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ph")), "play");
  assert.equal(ready(ok.engine), 1, "6 of 7 paid");
  assert.equal(ok.engine.getStat(ok.id("ph"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("ph"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ph"), "life"), 3);
});

clause(PHILO, "0:rule", "it has the TACTICAL keyword (a plain character does not)", () => {
  const game = philoBoard({ zone: "play", faceDown: false });
  assert.ok((game.engine.getKeywords(game.id("ph")) as string[]).includes("tactical"), "(game.engine.getKeywords(game.id(\"ph\")) as string[]).includes(\"tactical\")");
  assert.equal((game.engine.getKeywords(game.id("mine")) as string[]).includes("tactical"), false);
});

clause(PHILO, "0:rule", "TACTICAL: it can be deployed in response to the opponent's attack, where an ordinary character cannot", () => {
  const game = philoBoard({ attack: true });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  refused(() => playRaw(game.engine, P1, game.id("plain")), "control: an ordinary character cannot be deployed in a response window");
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play", "the Philosopher goes into play (not into the discard pile like a tactic)");
  assert.equal(game.engine.state.cards[game.id("ph")].controllerId, P1);
});

clause(PHILO, "0:rule", "TACTICAL: it can be deployed in response to the opponent announcing the end of their turn", () => {
  const game = philoBoard();
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  refused(() => playRaw(game.engine, P1, game.id("plain")), "control: an ordinary character cannot", /Only tactics or TACTICAL cards may be deployed as responses/);
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

clause(PHILO, "0:rule", "TACTICAL: in response to one of the opponent's tactics", () => {
  const trick = tactic({ name: "Their Trick", cost: 0 });
  const game = philoBoard({ extra: [{ key: "trick", def: trick, owner: P2, zone: "hand" }] });
  playRaw(game.engine, P2, game.id("trick"));
  assert.equal(game.engine.state.priorityPlayerId, P1);
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

clause(PHILO, "0:rule", "on my own turn it is deployed as a normal card", () => {
  const game = philoBoard({ active: P1 });
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

clause(PHILO, "0:rule", "TACTICAL: in my own attack's response window", () => {
  const game = philoBoard({ active: P1 });
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("mine")], target: { type: "faction", playerId: P2 } });
  assert.equal(game.engine.state.priorityPlayerId, P1, "I hold priority as the attacker");
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

clause(PHILO, "0:rule", "TACTICAL: in the battle-resolution response window after blockers, and it enters play", () => {
  const game = philoBoard({ attack: true });
  game.engine.perform({ type: "passPriority", playerId: P1 });
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  passUntil(game.engine, P1);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

clause(PHILO, "0:rule", "not when no tactic could be played either: on the opponent's turn with no response window it is refused (and so is a tactic)", () => {
  const game = philoBoard();
  assert.equal(game.engine.state.responseWindow, undefined);
  refused(() => playPhilo(game), "no window for me", /Only the active player may deploy/);
  refused(() => playRaw(game.engine, P1, game.id("freeTactic")), "control: a tactic cannot be played either", /Only the active player may deploy/);
  assert.equal(zoneOf(game.engine, game.id("ph")), "hand");
  assert.equal(ready(game.engine), 6, "nothing was paid");
});

clause(PHILO, "0:rule", "once in play it is an ordinary character: it can block the very attack it was deployed against", () => {
  const game = philoBoard({ attack: true });
  finishPhilo(game);
  assert.equal(battleOf(game.engine)?.phase, "blocking", "the response window is over: blockers are next");
  declareBlockers(game.engine, P1, [game.id("ph")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("ph")]);
});

clause(PHILO, "0:rule", "FAQ: after Tactician Vacation ('no tactics can be played') the 'whenever you could play a tactic' window is closed too, so it cannot be deployed out of turn", () => {
  const vacationBoard = (withVacation: boolean) =>
    philoBoard({
      extra: [
        { key: "p2char", def: character({ name: "P2 Char", cost: 0 }), owner: P2, zone: "hand" },
        ...(withVacation ? [{ key: "vac", def: printing(VACATION), owner: P2, zone: "hand" } as CardPlacement] : []),
        ...bank("rage", 4, P2)
      ]
    });
  const control = vacationBoard(false);
  playRaw(control.engine, P2, control.id("p2char"));
  assert.equal(control.engine.state.priorityPlayerId, P1);
  finishPhilo(control);
  assert.equal(zoneOf(control.engine, control.id("ph")), "play", "control: without the Vacation I can respond with it");

  const game = vacationBoard(true);
  playRaw(game.engine, P2, game.id("vac"));
  resolvePendingResponses(game.engine);
  playRaw(game.engine, P2, game.id("p2char"));
  assert.equal(game.engine.state.priorityPlayerId, P1, "I may respond to their next action...");
  refused(() => playPhilo(game), "...but the window for playing tactics is closed for the whole turn");
  assert.equal(zoneOf(game.engine, game.id("ph")), "hand");
});

clause(PHILO, "0:rule", "after Tactician Vacation it can still be played when it normally could be: on my own turn", () => {
  const game = philoBoard({
    active: P1,
    extra: [{ key: "vac", def: printing(VACATION), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  playRaw(game.engine, P1, game.id("vac"));
  resolvePendingResponses(game.engine);
  finishPhilo(game);
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
});

// --- When this card enters play, your faction gains 4 influence ------------------

clause(PHILO, "1:rule", "deployed it gains my faction exactly 4 influence; the opponent's is untouched", () => {
  const game = philoBoard({ attack: true });
  finishPhilo(game);
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(PHILO, "1:rule", "the gain happens when it enters play, not while it waits for responses", () => {
  const game = philoBoard({ active: P1 });
  playPhilo(game);
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(PHILO, "1:rule", "put into play by an effect it gains 4 too", () => {
  const game = philoBoard({ active: P1, extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("ph")] } });
  assert.equal(zoneOf(game.engine, game.id("ph")), "play");
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(PHILO, "1:rule", "played face-down as a resource it is only Volition: no influence", () => {
  const game = philoBoard({ active: P1 });
  developResource(game.engine, P1, game.id("ph"), true);
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(PHILO, "1:rule", "it triggers only for itself: another character entering play while it is in play gives nothing", () => {
  const game = philoBoard({ active: P1, zone: "play", faceDown: false });
  play(game.engine, P1, game.id("plain"));
  assert.equal(zoneOf(game.engine, game.id("plain")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(PHILO, "1:rule", "'your faction' is its controller's, not its owner's or the active player's: deployed in response on the opponent's turn, MY faction gains", () => {
  const game = philoBoard({ attack: true });
  finishPhilo(game);
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(PHILO, "1:rule", "no cap: from 5 influence I go to 9", () => {
  const game = philoBoard({ active: P1, influence: 5 });
  finishPhilo(game);
  assert.equal(influenceOf(game.engine, P1), 9);
});

// --- FLIP UP: 4 [G][G] ----------------------------------------------------------

const philoFlip = (game: ReturnType<typeof philoBoard>, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("ph"));

clause(PHILO, "2:flipUp", "flipping up a face-down copy on my turn pays exactly 4 (not the printed 6), enters play as a character and gains 4 influence", () => {
  const game = philoBoard({ active: P1, zone: "play", greed: 2, rage: 3 });
  assert.equal(ready(game.engine), 6, "5 banks and the face-down card");
  philoFlip(game);
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("ph")];
  assert.equal(card.faceDown, false);
  assert.equal(card.zone, "play");
  assert.equal(game.engine.getStat(game.id("ph"), "strength"), 3);
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(ready(game.engine), 1, "6 resources: 4 paid and the face-down card stopped being one (6 - 4 - 1)");
});

clause(PHILO, "2:flipUp", "the face-down card pays for its own FLIP UP: [G][G], two more resources and the card itself is exactly enough", () => {
  const game = philoBoard({ active: P1, zone: "play", greed: 2, rage: 1 });
  assert.equal(ready(game.engine), 4);
  philoFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, false);
  assert.equal(ready(game.engine), 0);
});

clause(PHILO, "2:flipUp", "refused one resource short: [G][G] spent plus two Rage and the face-down card leaves only 3 ready", () => {
  const game = philoBoard({ active: P1, zone: "play", greed: 0, rage: 2, spent: 2 });
  assert.equal(ready(game.engine), 3);
  refused(() => philoFlip(game), "3 resources for FLIP UP 4");
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START);
  const ok = philoBoard({ active: P1, zone: "play", greed: 0, rage: 3, spent: 2 });
  philoFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("ph")].faceDown, false, "control: one more resource is enough");
});

clause(PHILO, "2:flipUp", "FLIP UP needs [G][G]: one [G] and plenty of other resources is refused", () => {
  const game = philoBoard({ active: P1, zone: "play", greed: 1, rage: 6 });
  refused(() => philoFlip(game), "only one [G]");
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, true);
  assert.equal(ready(game.engine), 8, "nothing was paid");
});

clause(PHILO, "2:flipUp", "TACTICAL carries over to FLIP UP (CR 507.4d): in response to the opponent's attack I can flip it up", () => {
  const game = philoBoard({ zone: "play", greed: 2, rage: 3, attack: true });
  philoFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, false);
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(PHILO, "2:flipUp", "but only at times a tactic could be played: on the opponent's turn with no window it is refused", () => {
  const game = philoBoard({ zone: "play", greed: 2, rage: 3 });
  refused(() => philoFlip(game), "no response window");
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, true);
});

clause(PHILO, "2:flipUp", "only its controller can flip it up", () => {
  const game = philoBoard({ active: P2, zone: "play", greed: 2, rage: 3, extra: [...bank("greed", 2, P2), ...bank("rage", 4, P2)] });
  refused(() => philoFlip(game, P2), "the opponent flipping my card");
  assert.equal(game.engine.state.cards[game.id("ph")].faceDown, true);
});

// =============================================================================
// Foolhardy Desperado
// COVERT
// If this card inflicts battle damage, your faction loses 2 influence.
// Character (pirate, mau), cost 3, threshold [G][G], 3 / 2 / 4.
// =============================================================================

const DESPERADO = "46809554-551a-484e-9c20-b505fabc6df1";

function despBoard(o: { zone?: "play" | "hand"; extra?: CardPlacement[]; active?: PlayerId; greed?: number; rage?: number } = {}) {
  return devBoard(
    [
      { key: "dp", def: printing(DESPERADO), owner: P1, zone: o.zone ?? "play" },
      { key: "ally", def: character({ name: "Plain Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "plainFoe", def: character({ name: "Plain Foe", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "covertFoe", def: character({ name: "Covert Foe", strength: 1, life: 9, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const foeLife = (game: ReturnType<typeof despBoard>) => influenceOf(game.engine, P2);

clause(DESPERADO, "0:kw:COVERT", "the card itself: cost 3 with [G][G] - refused at 2 resources and with one [G]; pays exactly 3; printed 3 / 2 / 4", () => {
  const short = despBoard({ zone: "hand", greed: 2, rage: 0 });
  refused(() => playRaw(short.engine, P1, short.id("dp")), "2 resources for cost 3");
  const oneGreed = despBoard({ zone: "hand", greed: 1, rage: 4 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("dp")), "only one [G]");
  const ok = despBoard({ zone: "hand", greed: 2, rage: 2 });
  play(ok.engine, P1, ok.id("dp"));
  assert.equal(zoneOf(ok.engine, ok.id("dp")), "play");
  assert.equal(ready(ok.engine), 1, "3 of 4 paid");
  assert.equal(ok.engine.getStat(ok.id("dp"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("dp"), "speed"), 2);
  assert.equal(ok.engine.getStat(ok.id("dp"), "life"), 4);
});

clause(DESPERADO, "0:kw:COVERT", "has the COVERT keyword (an ordinary character does not)", () => covertHasKeyword(DESPERADO));
clause(DESPERADO, "0:kw:COVERT", "attacking alone, it cannot be blocked by non-covert characters; a covert character can block it", () => covertCannotBeBlockedByNonCovert(DESPERADO));
clause(DESPERADO, "0:kw:COVERT", "a party is covert only if EVERY member is: with a non-covert ally anyone may block", () => covertPartyNeedsEveryMemberCovert(DESPERADO));
clause(DESPERADO, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(DESPERADO));

// --- If this card inflicts battle damage, your faction loses 2 influence ------------

clause(DESPERADO, "1:rule", "attacking my opponent's faction unblocked: the opponent loses 3 to the damage and MY faction loses 2", () => {
  const game = despBoard();
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START - 3, "the battle damage");
  assert.equal(influenceOf(game.engine, P1), START - 2, "the Desperado's price");
});

clause(DESPERADO, "1:rule", "it is not paid before the damage is inflicted: declaring the attack costs nothing yet", () => {
  const game = despBoard();
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, []);
  assert.equal(influenceOf(game.engine, P1), START, "no battle damage has been inflicted yet");
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(DESPERADO, "1:rule", "damage to a location counts: attacking an opposing location costs me 2", () => {
  const game = despBoard({ extra: [{ key: "place", def: location({ name: "Their Place", structure: 9 }), owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("dp")], { type: "card", cardId: game.id("place") });
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("place")].damage, 3);
  assert.equal(influenceOf(game.engine, P1), START - 2);
  assert.equal(foeLife(game), START, "the opponent's faction was not hit");
});

clause(DESPERADO, "1:rule", "damage to a blocker counts: blocked by a covert character it inflicts battle damage and costs me 2", () => {
  const game = despBoard();
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, [game.id("covertFoe")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("covertFoe")].damage, 3);
  assert.equal(influenceOf(game.engine, P1), START - 2);
  assert.equal(foeLife(game), START, "nothing reached their faction");
});

clause(DESPERADO, "1:rule", "as a blocker it inflicts battle damage too: blocking a covert attacker costs me 2", () => {
  const game = devBoard(
    [
      { key: "dp", def: printing(DESPERADO), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Covert Raider", strength: 1, life: 9, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("dp")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("atk")].damage, 3);
  assert.equal(influenceOf(game.engine, P1), START - 2);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(DESPERADO, "1:rule", "it is paid once per battle for one target, not per point of damage", () => {
  const game = despBoard();
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 2, "3 damage still costs just 2");
});

clause(DESPERADO, "1:rule", "'this card' only: a party-mate's battle damage costs nothing extra (only the Desperado's does)", () => {
  const game = despBoard({ extra: [{ key: "ally2", def: character({ name: "Ally Two", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("ally"), game.id("ally2")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START - 4);
  assert.equal(influenceOf(game.engine, P1), START, "the Desperado was not in the battle");
});

clause(DESPERADO, "1:rule", "in a mixed party only the Desperado's own damage costs me: Desperado + ally unblocked: opponent -5, me -2", () => {
  const game = despBoard();
  declareAttackBy(game.engine, P1, [game.id("dp"), game.id("ally")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START - 5);
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(DESPERADO, "1:rule", "two Desperados each inflict battle damage and each costs me 2 (4 in total)", () => {
  const game = despBoard({ extra: [{ key: "dp2", def: printing(DESPERADO), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("dp"), game.id("dp2")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START - 6);
  assert.equal(influenceOf(game.engine, P1), START - 4);
});

clause(DESPERADO, "1:rule", "being DAMAGED is not inflicting: a Desperado hit by a tactic, or sitting at home during someone else's battle, costs nothing", () => {
  const game = despBoard({ extra: [{ key: "smite", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("smite"), { selected: { t: [game.id("dp")] } });
  assert.equal(game.engine.state.cards[game.id("dp")].damage, 2);
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START - 2, "the ally's battle damage");
  assert.equal(influenceOf(game.engine, P1), START, "the Desperado inflicted nothing");
});

clause(DESPERADO, "1:rule", "an attack that inflicts 0 damage costs nothing: a Desperado debuffed to 0 strength inflicts no battle damage", () => {
  const game = despBoard({ extra: [{ key: "debuff", def: buffTactic("strength", -3), owner: P1, zone: "hand" }] });
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("dp")], target: { type: "faction", playerId: P2 } });
  assert.equal(game.engine.state.priorityPlayerId, P1, "the attacker acts first in the declaration window");
  play(game.engine, P1, game.id("debuff"), { selected: { t: [game.id("dp")] } });
  assert.equal(game.engine.getStat(game.id("dp"), "strength"), 0);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(foeLife(game), START, "no damage");
  assert.equal(influenceOf(game.engine, P1), START, "no battle damage inflicted, so no price");
});

clause(DESPERADO, "1:rule", "destroyed before it deals damage it never inflicts any: a faster covert blocker kills it first and I lose nothing", () => {
  const killer = character({ name: "Fast Covert", strength: 4, life: 9, speed: 3, behavior: { keywords: ["covert"] } });
  const game = despBoard({ extra: [{ key: "killer", def: killer, owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, [game.id("killer")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("dp")), "discard", "speed 3 hits before speed 2: 4 damage kills the 4-life Desperado");
  assert.equal(game.engine.state.cards[game.id("killer")].damage, 0, "it never dealt its damage");
  assert.equal(influenceOf(game.engine, P1), START, "nothing was inflicted, so no price");
});

clause(DESPERADO, "1:rule", "simultaneous damage still counts: a covert blocker of the same speed kills it, but the Desperado inflicted damage first-hand and I lose 2", () => {
  const equal = character({ name: "Equal Covert", strength: 4, life: 9, speed: 2, behavior: { keywords: ["covert"] } });
  const game = despBoard({ extra: [{ key: "equal", def: equal, owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("dp")]);
  declareBlockers(game.engine, P2, [game.id("equal")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("dp")), "discard");
  assert.equal(game.engine.state.cards[game.id("equal")].damage, 3, "the Desperado dealt its damage");
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(DESPERADO, "1:rule", "'your faction' is its controller's: the opponent's Desperado costs THEIR faction 2", () => {
  const game = devBoard(
    [
      { key: "dp", def: printing(DESPERADO), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 2, behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("dp")]);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 3);
  assert.equal(influenceOf(game.engine, P2), START - 2);
});

clause(DESPERADO, "1:rule", "damage dealt by a tactic is not battle damage: it is never inflicted BY the Desperado, so a damage tactic changes nothing", () => {
  const game = despBoard({ extra: [{ key: "smite", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("smite"), { selected: { t: [game.id("plainFoe")] } });
  assert.equal(influenceOf(game.engine, P1), START);
});

// =============================================================================
// Fountain Diver
// RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 1.
//   Remove this card from the game. Pick a character.
// EFFECT: This turn, the character gains 3 life.
// Character (mau), cost 2, threshold [G], 1 / 3 / 2.
// =============================================================================

const DIVER = "a5439765-aa03-4443-8a26-5275e8e07370";

interface DiverOpts {
  zone?: "hand" | "discard" | "deck" | "removed" | "play";
  greed?: number;
  rage?: number;
  spent?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function diverBoard(o: DiverOpts = {}) {
  return devBoard(
    [
      { key: "dv", def: printing(DIVER), owner: P1, zone: o.zone ?? "discard" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "smite4", def: damageTactic(4, "Smite Four"), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 1, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...spentGreed(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

const diverRecur = (game: ReturnType<typeof diverBoard>, pick: string[], player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("dv"), "recur", { rc: pick.map((key) => game.id(key)) });
const finishDiver = (game: ReturnType<typeof diverBoard>, pick: string[]) => {
  diverRecur(game, pick);
  resolvePendingResponses(game.engine);
};

clause(DIVER, "0:ability:recur", "the card itself: cost 2 with [G] - refused at 1 resource and with no [G]; pays exactly 2; printed 1 / 3 / 2", () => {
  const short = diverBoard({ zone: "hand", greed: 1, rage: 0 });
  refused(() => playRaw(short.engine, P1, short.id("dv")), "1 resource for cost 2");
  const noGreed = diverBoard({ zone: "hand", greed: 0, rage: 4 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("dv")), "no [G]");
  const ok = diverBoard({ zone: "hand", greed: 1, rage: 2 });
  play(ok.engine, P1, ok.id("dv"));
  assert.equal(zoneOf(ok.engine, ok.id("dv")), "play");
  assert.equal(ready(ok.engine), 1, "2 of 3 paid");
  assert.equal(ok.engine.getStat(ok.id("dv"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("dv"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("dv"), "life"), 2);
});

clause(DIVER, "0:ability:recur", "from my discard pile: pays exactly 1, removes the Diver from the game and gives the picked character 3 life", () => {
  const game = diverBoard({ greed: 1, rage: 2 });
  diverRecur(game, ["mine"]);
  assert.equal(ready(game.engine), 2, "1 of 3 paid");
  assert.equal(zoneOf(game.engine, game.id("dv")), "removed", "removed from the game as a cost");
  assert.ok(removedOf(game.engine, P1).includes(game.id("dv")), "removedOf(game.engine, P1).includes(game.id(\"dv\"))");
  assert.ok(!discardOf(game.engine, P1).includes(game.id("dv")), "!discardOf(game.engine, P1).includes(game.id(\"dv\"))");
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3, "the effect waits for responses");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 6);
});

clause(DIVER, "0:ability:recur", "refused with no [G] (RECUR: [G]) however many other resources there are", () => {
  const game = diverBoard({ greed: 0, rage: 5 });
  refused(() => diverRecur(game, ["mine"]), "no [G]");
  assert.equal(zoneOf(game.engine, game.id("dv")), "discard");
  assert.equal(ready(game.engine), 5);
});

clause(DIVER, "0:ability:recur", "the opponent's [G] do not meet the threshold", () => {
  const game = diverBoard({ greed: 0, rage: 3, extra: bank("greed", 3, P2) });
  refused(() => diverRecur(game, ["mine"]), "their Greed");
  assert.equal(zoneOf(game.engine, game.id("dv")), "discard");
});

clause(DIVER, "0:ability:recur", "a spent [G] still meets the threshold: one spent [G] plus one ready Rage is enough", () => {
  const game = diverBoard({ greed: 0, rage: 1, spent: 1 });
  finishDiver(game, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 6);
  assert.equal(ready(game.engine), 0);
});

clause(DIVER, "0:ability:recur", "refused when no resource is ready to pay 1 (the only [G] is spent): nothing is removed", () => {
  const game = diverBoard({ greed: 0, rage: 0, spent: 1 });
  assert.equal(ready(game.engine), 0);
  refused(() => diverRecur(game, ["mine"]), "nothing to pay 1 with");
  assert.equal(zoneOf(game.engine, game.id("dv")), "discard");
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3);
});

for (const zone of ["hand", "deck", "removed", "play"] as const) {
  clause(DIVER, "0:ability:recur", `'use this only if this card is in your discard pile': refused while it is in ${zone === "play" ? "play" : `my ${zone}`}`, () => {
    const game = diverBoard({ zone });
    refused(() => diverRecur(game, ["mine"]), `from ${zone}`);
    assert.equal(zoneOf(game.engine, game.id("dv")), zone);
    assert.equal(ready(game.engine), 3, "nothing paid");
    const control = diverBoard({ zone: "discard" });
    finishDiver(control, ["mine"]);
    assert.equal(control.engine.getStat(control.id("mine"), "life"), 6, "control: from the discard pile it works");
  });
}

clause(DIVER, "0:ability:recur", "only my own discard pile: the opponent cannot use RECUR on a Diver in MY discard pile", () => {
  const game = diverBoard({ extra: [...bank("greed", 1, P2), ...bank("rage", 2, P2)] });
  refused(() => diverRecur(game, ["foe"], P2), "the opponent using my Diver");
  assert.equal(zoneOf(game.engine, game.id("dv")), "discard");
});

clause(DIVER, "0:ability:recur", "the opponent can use RECUR on THEIR Diver in their discard pile", () => {
  const game = devBoard(
    [
      { key: "dv", def: printing(DIVER), owner: P2, zone: "discard" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 1, P2),
      ...bank("rage", 1, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  actRaw(game.engine, P2, game.id("dv"), "recur", { rc: [game.id("foe")] });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("dv")), "removed");
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 6);
});

clause(DIVER, "0:ability:recur", "can pick my own or the opponent's character", () => {
  const mine = diverBoard();
  finishDiver(mine, ["mine"]);
  assert.equal(mine.engine.getStat(mine.id("mine"), "life"), 6);
  assert.equal(mine.engine.getStat(mine.id("foe"), "life"), 3);
  const foe = diverBoard();
  finishDiver(foe, ["foe"]);
  assert.equal(foe.engine.getStat(foe.id("foe"), "life"), 6);
  assert.equal(foe.engine.getStat(foe.id("mine"), "life"), 3);
});

for (const [label, make] of [
  ["an item", (): CardPlacement => ({ key: "bad", def: item({ name: "Plain Item" }), owner: P1, zone: "play" })],
  ["a location", (): CardPlacement => ({ key: "bad", def: location({ name: "Plain Place", structure: 3 }), owner: P1, zone: "play" })],
  ["a resource", (): CardPlacement => ({ key: "bad", def: resourceCard({ name: "Loose Resource" }), owner: P1, zone: "play" })],
  ["a face-down card", (): CardPlacement => ({ key: "bad", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true })],
  ["a character in my hand", (): CardPlacement => ({ key: "bad", def: character({ name: "In Hand" }), owner: P1, zone: "hand" })],
  ["another character in my discard pile", (): CardPlacement => ({ key: "bad", def: character({ name: "In Discard" }), owner: P1, zone: "discard" })]
] as const) {
  clause(DIVER, "0:ability:recur", `cannot pick ${label}`, () => {
    const bad = diverBoard({ extra: [make()] });
    const before = ready(bad.engine);
    refused(() => diverRecur(bad, ["bad"]), label);
    assert.equal(zoneOf(bad.engine, bad.id("dv")), "discard", "the Diver was not removed");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = diverBoard({ extra: [make()] });
    finishDiver(good, ["mine"]);
    assert.equal(good.engine.getStat(good.id("mine"), "life"), 6, "control");
  });
}

clause(DIVER, "0:ability:recur", "cannot pick the Diver itself (it has been removed from the game by then), a faction, and needs exactly one pick", () => {
  const game = diverBoard();
  refused(() => diverRecur(game, ["dv"]), "itself");
  refused(() => actRaw(game.engine, P1, game.id("dv"), "recur", { rc: [game.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(game.engine, P1, game.id("dv"), "recur", { rc: [game.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => diverRecur(game, []), "no pick");
  refused(() => diverRecur(game, ["mine", "foe"]), "two picks");
  assert.equal(zoneOf(game.engine, game.id("dv")), "discard");
  assert.equal(ready(game.engine), 3);
  finishDiver(game, ["foe"]);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 6);
});

clause(DIVER, "0:ability:recur", "the character gains exactly 3 life; strength and speed are unchanged", () => {
  const game = diverBoard();
  finishDiver(game, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 6);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("mine"), "speed"), 2);
});

clause(DIVER, "0:ability:recur", "the extra life is real: a 4-damage hit kills a 3-life character, but not one that gained 3 life", () => {
  const without = diverBoard();
  play(without.engine, P1, without.id("smite4"), { selected: { t: [without.id("mine")] } });
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control");
  const game = diverBoard();
  finishDiver(game, ["mine"]);
  play(game.engine, P1, game.id("smite4"), { selected: { t: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 4);
});

clause(DIVER, "0:ability:recur", "'this turn': the extra life is gone when the next turn starts", () => {
  const game = diverBoard();
  finishDiver(game, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 6);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 3);
});

clause(DIVER, "0:ability:recur", "only the picked character gains life", () => {
  const game = diverBoard({ extra: [{ key: "bystander", def: character({ name: "Bystander", life: 4 }), owner: P1, zone: "play" }] });
  finishDiver(game, ["mine"]);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 3);
  assert.equal(game.engine.getStat(game.id("bystander"), "life"), 4);
});

clause(DIVER, "0:ability:recur", "as an ability it is a response: when the opponent's 4-damage tactic is played on my 3-life character I can answer and save it", () => {
  const game = diverBoard({ active: P2, extra: [{ key: "theirSmite", def: damageTactic(4, "Their Smite"), owner: P2, zone: "hand" }] });
  playRaw(game.engine, P2, game.id("theirSmite"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  diverRecur(game, ["mine"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "6 life survives 4 damage");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 4);
});

clause(DIVER, "0:ability:recur", "after the Diver is removed it cannot be used again", () => {
  const game = diverBoard();
  finishDiver(game, ["mine"]);
  refused(() => diverRecur(game, ["foe"]), "it is out of the game");
});

// =============================================================================
// Frisky Fortunehunter
// When this card enters play, your faction loses 2 influence.
// When this card leaves play, your faction gains 4 influence.
// Character (pirate, mau), cost 1, threshold [G], 1 / 3 / 1.
// =============================================================================

const FRISKY = "3cc5ddb3-ea85-4582-9a11-e24ae0119237";

function friskyBoard(o: { zone?: "hand" | "play"; faceDown?: boolean; influence?: number; extra?: CardPlacement[]; owner?: PlayerId; controller?: PlayerId; active?: PlayerId; greed?: number; rage?: number } = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: owner === P1 ? o.influence : undefined },
    playerB: { faction: developFaction(), influence: owner === P2 ? o.influence : undefined },
    turn: 2,
    activePlayerId: o.active ?? owner,
    cards: [
      { key: "fh", def: printing(FRISKY), owner, controller: o.controller, zone: o.zone ?? "hand", faceDown: o.faceDown },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 1, owner),
      ...bank("rage", o.rage ?? 0, owner),
      ...(o.extra ?? [])
    ]
  });
}

/** Frisky in play, plus every way of making it leave. */
const leaveTools = (): CardPlacement[] => [
  { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
  { key: "bounce", def: bounceCardTactic(), owner: P1, zone: "hand" },
  { key: "remove", def: removerTactic(), owner: P1, zone: "hand" },
  { key: "cast", def: discardFromPlayTactic(), owner: P1, zone: "hand" },
  { key: "flip", def: flipDownTactic(), owner: P1, zone: "hand" }
];

clause(FRISKY, "0:rule", "the card itself: cost 1 with [G] - refused with no resources and with no [G]; pays exactly 1; printed 1 / 3 / 1", () => {
  const none = friskyBoard({ greed: 0, rage: 0 });
  refused(() => playRaw(none.engine, P1, none.id("fh")), "no resources");
  const noGreed = friskyBoard({ greed: 0, rage: 3 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("fh")), "no [G]");
  const ok = friskyBoard({ greed: 1, rage: 2 });
  play(ok.engine, P1, ok.id("fh"));
  assert.equal(zoneOf(ok.engine, ok.id("fh")), "play");
  assert.equal(ready(ok.engine), 2, "1 of 3 paid");
  assert.equal(ok.engine.getStat(ok.id("fh"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("fh"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("fh"), "life"), 1);
});

clause(FRISKY, "0:rule", "when it enters play my faction loses exactly 2 influence; the opponent's is untouched", () => {
  const game = friskyBoard();
  play(game.engine, P1, game.id("fh"));
  assert.equal(influenceOf(game.engine, P1), START - 2);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(FRISKY, "0:rule", "the loss happens when it enters play, not while it waits for responses", () => {
  const game = friskyBoard();
  playRaw(game.engine, P1, game.id("fh"));
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(FRISKY, "0:rule", "put into play by an effect (not deployed) it also costs 2", () => {
  const game = friskyBoard({ extra: [{ key: "pip", def: putIntoPlayTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "play");
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(FRISKY, "0:rule", "played face-down as a resource it is only Volition: no influence loss", () => {
  const game = friskyBoard();
  developResource(game.engine, P1, game.id("fh"), true);
  assert.equal(game.engine.state.cards[game.id("fh")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "0:rule", "it triggers only for itself: another character entering play while it is in play costs nothing", () => {
  const game = friskyBoard({
    zone: "play",
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "0:rule", "two Fortunehunters each cost 2 when they enter: 4 in total", () => {
  const game = friskyBoard({ greed: 2, extra: [{ key: "fh2", def: printing(FRISKY), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("fh"));
  play(game.engine, P1, game.id("fh2"));
  assert.equal(influenceOf(game.engine, P1), START - 4);
});

clause(FRISKY, "0:rule", "'your faction' is its controller's: the opponent's Fortunehunter costs THEIR faction 2", () => {
  const game = friskyBoard({ owner: P2 });
  play(game.engine, P2, game.id("fh"));
  assert.equal(influenceOf(game.engine, P2), START - 2);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "0:rule", "with exactly 2 influence left the loss brings it to 0 and I lose the game", () => {
  const game = friskyBoard({ influence: 2 });
  play(game.engine, P1, game.id("fh"));
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(FRISKY, "0:rule", "with only 1 influence left the loss stops at 0 (not -1) and I lose the game", () => {
  const game = friskyBoard({ influence: 1 });
  play(game.engine, P1, game.id("fh"));
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P2] });
});

// --- When this card leaves play, your faction gains 4 influence ---------------------

clause(FRISKY, "1:rule", "destroyed: my faction gains exactly 4 influence, the opponent's nothing", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P1), START + 4);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(FRISKY, "1:rule", "returned to my hand: it left play, so +4", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "hand");
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "removed from the game: it left play, so +4", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("remove"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "removed");
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "put into the discard pile without being destroyed: it left play, so +4", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("cast"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "killed in battle: +4", () => {
  const game = friskyBoard({
    zone: "play",
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("fh")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "flipped face-down mid-game it leaves play as a face-up card: +4 (RULES 2, CR 411.3)", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("flip"), { selected: { t: [game.id("fh")] } });
  assert.equal(game.engine.state.cards[game.id("fh")].faceDown, true);
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "a face-down copy destroyed is only an anonymous resource: no gain", () => {
  const game = friskyBoard({ zone: "play", faceDown: true, extra: [{ key: "smash", def: smashResourceTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "1:rule", "it triggers only for itself: another character leaving play gives nothing", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "1:rule", "leaving the HAND is not leaving play: discarding it from hand gives nothing", () => {
  const dump = tactic({
    name: "Dump Hand",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
  const game = friskyBoard({ zone: "hand", extra: [{ key: "dump", def: dump, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dump"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "1:rule", "'your faction' is the controller's at the time it leaves: a Fortunehunter I own but the opponent controls pays THEM 4", () => {
  const game = friskyBoard({ zone: "play", owner: P1, controller: P2, active: P1, extra: leaveTools() });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "discard");
  assert.equal(influenceOf(game.engine, P2), START + 4, "its controller's faction");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(FRISKY, "1:rule", "the full trip: entering costs 2 and leaving pays 4, net +2", () => {
  const game = friskyBoard({ extra: leaveTools() });
  play(game.engine, P1, game.id("fh"));
  assert.equal(influenceOf(game.engine, P1), START - 2);
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fh")] } });
  assert.equal(influenceOf(game.engine, P1), START + 2);
});

clause(FRISKY, "1:rule", "the gain happens when it has left play, not while the destroying tactic waits for responses", () => {
  const game = friskyBoard({ zone: "play", extra: leaveTools() });
  playRaw(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fh")] } });
  assert.equal(zoneOf(game.engine, game.id("fh")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START + 4);
});

clause(FRISKY, "1:rule", "a change of controller is neither leaving nor entering play: the opponent taking control of it gives nobody influence", () => {
  const grab = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = friskyBoard({ zone: "play", active: P2, extra: [{ key: "grab", def: grab, owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("grab"), { selected: { t: [game.id("fh")] } });
  assert.equal(game.engine.state.cards[game.id("fh")].controllerId, P2);
  assert.equal(zoneOf(game.engine, game.id("fh")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(influenceOf(game.engine, P2), START);
});
