// Clause tests — batch seed-2-01. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-01`. Expectations come from each
// card's PRINTED text (markup); engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
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
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  finishBattle,
  playRaw
} from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, developOffers, openDevelopPlay, endTurnRaw, settleStartFirst } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ obsession: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;

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

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A player responds to the open window by playing a tactic from hand; the chain is then drained. */
function respondWith(
  engine: SpoilsEngine,
  responder: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables } as never);
  resolvePendingResponses(engine);
}

/** A free tactic (id "pump", pick "t"): the picked character gets `amount` strength this turn. */
function pumpTactic(amount: number, name = `Pump ${amount}`): CardDefinition {
  return tactic({
    name,
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

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to` (top of the deck when `to` is "deck"). */
function moverTactic(to: Zone, name = `Mover to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to, position: "top" }]
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

/** An item that attaches to a character and adds `amount` strength to it. */
function strengthGear(amount: number, name = `Gear ${amount}`): CardDefinition {
  return item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });
}

// =================================================================================
// Desolate
// COST: Pick a number for X, where X is less than or equal to the number of [O] you
// control. -- EFFECT: Destroy all characters with X strength.
// Tactic, cost 3, [O].
// =================================================================================

const DESOLATE = "0dc13c6b-c12b-455f-af0c-5d2be13c3cba";

function desolateBoard(opts: { icons?: Icons; oppIcons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "des", def: printing(DESOLATE), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "Mine S0", strength: 0, life: 9 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine S1", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine S2", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "m3", def: character({ name: "Mine S3", strength: 3, life: 9 }), owner: P1, zone: "play" },
      { key: "f0", def: character({ name: "Foe S0", strength: 0, life: 9 }), owner: P2, zone: "play" },
      { key: "f1", def: character({ name: "Foe S1", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe S2", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "f3", def: character({ name: "Foe S3", strength: 3, life: 9 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

const desolate = (g: ReturnType<typeof desolateBoard>, x: number) => play(g.engine, P1, g.id("des"), { variables: { x } });

const desolateAttempt = (g: ReturnType<typeof desolateBoard>, x: number) => () => playRaw(g.engine, P1, g.id("des"), { variables: { x } });

clause(DESOLATE, "0:ability", "X = 2 destroys every character with 2 strength, mine and my opponent's, and no others", () => {
  const g = desolateBoard();
  desolate(g, 2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "my own 2-strength character is destroyed");
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard", "my opponent's 2-strength character is destroyed");
  for (const key of ["m0", "m1", "m3", "f0", "f1", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} (a different strength) survives`);
});

clause(DESOLATE, "0:ability", "X = 1 destroys exactly the 1-strength characters", () => {
  const g = desolateBoard();
  desolate(g, 1);
  for (const key of ["m1", "f1"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
  for (const key of ["m0", "m2", "m3", "f0", "f2", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

clause(DESOLATE, "0:ability", "X = 3 destroys exactly the 3-strength characters", () => {
  const g = desolateBoard();
  desolate(g, 3);
  for (const key of ["m3", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
  for (const key of ["m0", "m1", "m2", "f0", "f1", "f2"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

clause(DESOLATE, "0:ability", "X = 0 is a legal number: it destroys exactly the 0-strength characters", () => {
  const g = desolateBoard();
  desolate(g, 0);
  for (const key of ["m0", "f0"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
  for (const key of ["m1", "m2", "m3", "f1", "f2", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

clause(DESOLATE, "0:ability", "X = 0 is legal even with [O] to spare, and the cost (3) is paid", () => {
  const g = desolateBoard();
  const before = ready(g.engine);
  desolate(g, 0);
  assert.equal(before - ready(g.engine), 3);
});

clause(DESOLATE, "0:ability", "pays exactly its cost of 3 and ends in its owner's discard pile", () => {
  const g = desolateBoard({ icons: { obsession: 5, greed: 2 } });
  const before = ready(g.engine);
  desolate(g, 2);
  assert.equal(before - ready(g.engine), 3, "the printed cost of 3");
  assert.equal(zoneOf(g.engine, g.id("des")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.ok(discardOf(g.engine, P1).includes(g.id("des")), "discardOf(g.engine, P1).includes(g.id(\"des\"))");
});

clause(DESOLATE, "0:ability", "with no character of strength X the tactic still resolves: nothing is destroyed, the cost is still paid", () => {
  const g = desolateBoard();
  const before = ready(g.engine);
  desolate(g, 5);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["m0", "m1", "m2", "m3", "f0", "f1", "f2", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
  assert.equal(before - ready(g.engine), 3, "the cost was paid");
  assert.equal(zoneOf(g.engine, g.id("des")), "discard");
});

clause(DESOLATE, "0:ability", "destroys ALL matching characters, not just one of them (four on each side)", () => {
  const g = desolateBoard({
    extra: [
      ...Array.from({ length: 3 }, (_, i) => ({ key: `ma${i}`, def: character({ name: `Mine Extra ${i}`, strength: 4, life: 9 }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `fa${i}`, def: character({ name: `Foe Extra ${i}`, strength: 4, life: 9 }), owner: P2, zone: "play" as const })),
      { key: "m4", def: character({ name: "Mine S4", strength: 4, life: 9 }), owner: P1, zone: "play" }
    ]
  });
  desolate(g, 4);
  for (const key of ["m4", "ma0", "ma1", "ma2", "fa0", "fa1", "fa2", "fa3"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
  for (const key of ["m0", "m1", "m2", "m3", "f0", "f1", "f2", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

clause(DESOLATE, "0:ability", "destroyed characters go to their OWNER's discard pile (a stolen character goes to its owner, not its controller)", () => {
  const g = desolateBoard({
    extra: [
      { key: "stolenIn", def: character({ name: "Stolen In", strength: 2, life: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenOut", def: character({ name: "Stolen Out", strength: 2, life: 9 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  desolate(g, 2);
  assert.ok(discardOf(g.engine, P2).includes(g.id("stolenIn")), "owned by my opponent: their discard pile");
  assert.equal(discardOf(g.engine, P1).includes(g.id("stolenIn")), false);
  assert.ok(discardOf(g.engine, P1).includes(g.id("stolenOut")), "owned by me: my discard pile");
  assert.ok(discardOf(g.engine, P1).includes(g.id("m2")), "discardOf(g.engine, P1).includes(g.id(\"m2\"))");
  assert.ok(discardOf(g.engine, P2).includes(g.id("f2")), "discardOf(g.engine, P2).includes(g.id(\"f2\"))");
});

clause(DESOLATE, "0:ability", "a destroyed character comes from play only: a character's damage does not matter, a damaged 2-strength character is destroyed like any other", () => {
  const g = desolateBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 2, life: 9 }), owner: P2, zone: "play", damage: 3, depleted: true }] });
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("hurt")), "discard");
});

clause(DESOLATE, "0:ability", "only characters in play are affected: character cards in hands, decks and discard piles with X strength stay where they are", () => {
  const g = desolateBoard({
    extra: [
      { key: "hand1", def: character({ name: "Hand One", strength: 2 }), owner: P1, zone: "hand" },
      { key: "hand2", def: character({ name: "Hand Two", strength: 2 }), owner: P2, zone: "hand" },
      { key: "deck1", def: character({ name: "Deck One", strength: 2 }), owner: P1, zone: "deck" },
      { key: "deck2", def: character({ name: "Deck Two", strength: 2 }), owner: P2, zone: "deck" },
      { key: "disc1", def: character({ name: "Disc One", strength: 2 }), owner: P1, zone: "discard" },
      { key: "disc2", def: character({ name: "Disc Two", strength: 2 }), owner: P2, zone: "discard" }
    ]
  });
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: the effect happened");
  assert.equal(zoneOf(g.engine, g.id("hand1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hand2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("deck1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("deck2")), "deck");
  assert.equal(zoneOf(g.engine, g.id("disc1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("disc2")), "discard");
  assert.deepEqual(discardOf(g.engine, P1).filter((c) => c === g.id("disc1")), [g.id("disc1")], "not moved or duplicated");
});

clause(DESOLATE, "0:ability", "only CHARACTERS are destroyed: an item, a location and a resource that carry a 'strength' of X stay in play, and so do the factions", () => {
  const g = desolateBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing", strength: 2 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", strength: 2, structure: 2 }), owner: P2, zone: "play" },
      { key: "token", def: resourceCard({ name: "Strong Resource", strength: 2 }), owner: P2, zone: "play" }
    ]
  });
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: characters were destroyed");
  assert.equal(zoneOf(g.engine, g.id("thing")), "play", "the item stays");
  assert.equal(zoneOf(g.engine, g.id("place")), "play", "the location stays");
  assert.equal(zoneOf(g.engine, g.id("token")), "play", "the resource stays");
  assert.equal(zoneOf(g.engine, g.engine.state.players[P1].factionId!), "play", "my faction stays");
  assert.equal(zoneOf(g.engine, g.engine.state.players[P2].factionId!), "play", "their faction stays");
});

clause(DESOLATE, "0:ability", "a face-down card is only a resource (CR 411.1) with no strength: a face-down character with printed strength X is not destroyed", () => {
  const g = desolateBoard({ extra: [{ key: "fd", def: character({ name: "Hidden", strength: 2, life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: face-up 2-strength characters were destroyed");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play", "a face-down card is a resource, not a character");
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, true);
});

clause(DESOLATE, "0:ability", "'with X strength' means current strength: a 1-strength character with +1 strength from gear is destroyed by X = 2", () => {
  const g = desolateBoard({
    extra: [
      { key: "geared", def: character({ name: "Geared", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "gear", def: strengthGear(1), owner: P2, zone: "play", attachedToKey: "geared" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("geared"), "strength"), 2, "control: the gear makes it a 2-strength character");
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("geared")), "discard", "its current strength is 2");
});

clause(DESOLATE, "0:ability", "'with X strength' means current strength: a 2-printed-strength character reduced to 1 by gear survives X = 2", () => {
  const g = desolateBoard({
    extra: [
      { key: "weak", def: character({ name: "Weakened", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "gear", def: strengthGear(-1, "Heavy Chain"), owner: P2, zone: "play", attachedToKey: "weak" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("weak"), "strength"), 1, "control: the gear makes it a 1-strength character");
  desolate(g, 2);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: the effect happened");
  assert.equal(zoneOf(g.engine, g.id("weak")), "play", "its current strength is 1, not 2");
});

clause(DESOLATE, "0:ability", "strength is judged when Desolate resolves: a response that makes a 1-strength character a 2-strength one gets it destroyed", () => {
  const g = desolateBoard({ extra: [{ key: "pump", def: pumpTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("des"), { variables: { x: 2 } });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("f1")), "play");
  respondWith(g.engine, P2, g.id("pump"), { t: [g.id("f1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard", "pumped to 2 strength before Desolate resolved");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "my own 2-strength character is still destroyed");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play");
});

clause(DESOLATE, "0:ability", "strength is judged when Desolate resolves: a response that drops a 2-strength character to 1 saves it", () => {
  const g = desolateBoard({ extra: [{ key: "shrink", def: pumpTactic(-1, "Shrink"), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("des"), { variables: { x: 2 } });
  respondWith(g.engine, P2, g.id("shrink"), { t: [g.id("f2")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("f2")), "play", "shrunk to 1 strength before Desolate resolved");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: Desolate did resolve");
});

// X's upper bound

clause(DESOLATE, "0:ability", "X may equal the number of [O] I control (6 Obsession: X = 6 is accepted)", () => {
  const g = desolateBoard({ icons: { obsession: 6 }, extra: [{ key: "s6", def: character({ name: "Mine S6", strength: 6, life: 9 }), owner: P1, zone: "play" }] });
  desolate(g, 6);
  assert.equal(zoneOf(g.engine, g.id("s6")), "discard");
});

clause(DESOLATE, "0:ability", "X may not exceed the number of [O] I control: X = 7 with 6 Obsession is refused and nothing is paid", () => {
  const bad = desolateBoard({ icons: { obsession: 6 }, extra: [{ key: "s7", def: character({ name: "Mine S7", strength: 7, life: 9 }), owner: P1, zone: "play" }] });
  const before = ready(bad.engine);
  refused(desolateAttempt(bad, 7), "X = 7 with 6 [O]");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand", "Desolate was not played");
  assert.equal(ready(bad.engine), before, "nothing was paid");
  assert.equal(zoneOf(bad.engine, bad.id("s7")), "play");
  const good = desolateBoard({ icons: { obsession: 6 }, extra: [{ key: "s6", def: character({ name: "Mine S6", strength: 6, life: 9 }), owner: P1, zone: "play" }] });
  desolate(good, 6);
  assert.equal(zoneOf(good.engine, good.id("s6")), "discard", "control: X = 6 is accepted");
});

clause(DESOLATE, "0:ability", "the limit is the number of [O] only: 2 Obsession and 4 Greed allow X = 2 but not X = 3", () => {
  const bad = desolateBoard({ icons: { obsession: 2, greed: 4 } });
  refused(desolateAttempt(bad, 3), "3 > 2 [O], even with 6 resources");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  const good = desolateBoard({ icons: { obsession: 2, greed: 4 } });
  desolate(good, 2);
  assert.equal(zoneOf(good.engine, good.id("m2")), "discard", "control: X = 2 is accepted");
});

clause(DESOLATE, "0:ability", "with exactly one [O] the limit is 1: X = 1 works, X = 2 is refused", () => {
  const bad = desolateBoard({ icons: { obsession: 1, rage: 5 } });
  refused(desolateAttempt(bad, 2), "2 > 1 [O]");
  const good = desolateBoard({ icons: { obsession: 1, rage: 5 } });
  desolate(good, 1);
  assert.equal(zoneOf(good.engine, good.id("m1")), "discard");
  assert.equal(zoneOf(good.engine, good.id("f1")), "discard");
});

clause(DESOLATE, "0:ability", "my opponent's [O] do not count towards X", () => {
  const bad = desolateBoard({ icons: { obsession: 1, greed: 5 }, oppIcons: { obsession: 6 } });
  refused(desolateAttempt(bad, 2), "only my own [O] count");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  const good = desolateBoard({ icons: { obsession: 1, greed: 5 }, oppIcons: { obsession: 6 } });
  desolate(good, 1);
  assert.equal(zoneOf(good.engine, good.id("m1")), "discard", "control: X = 1 is accepted");
});

clause(DESOLATE, "0:ability", "face-down resources provide Volition, not [O]: they do not raise X", () => {
  const bad = devBoard([
    { key: "des", def: printing(DESOLATE), owner: P1, zone: "hand" },
    { key: "m2", def: character({ name: "Mine S2", strength: 2, life: 9 }), owner: P1, zone: "play" },
    ...res({ obsession: 1 }),
    ...volition(5)
  ]);
  refused(() => playRaw(bad.engine, P1, bad.id("des"), { variables: { x: 2 } }), "face-down resources are not [O]");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  const good = devBoard([
    { key: "des", def: printing(DESOLATE), owner: P1, zone: "hand" },
    { key: "m1", def: character({ name: "Mine S1", strength: 1, life: 9 }), owner: P1, zone: "play" },
    ...res({ obsession: 1 }),
    ...volition(5)
  ]);
  play(good.engine, P1, good.id("des"), { variables: { x: 1 } });
  assert.equal(zoneOf(good.engine, good.id("m1")), "discard", "control: X = 1 is accepted");
});

clause(DESOLATE, "0:ability", "[O] already spent (attached to my faction) still count as controlled: with exactly 3 Obsession, paying 3 does not lower X's limit of 3", () => {
  const g = desolateBoard({ icons: { obsession: 3 } });
  desolate(g, 3);
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard", "X = 3 with exactly 3 [O] is accepted");
  assert.equal(zoneOf(g.engine, g.id("f3")), "discard");
  assert.equal(ready(g.engine), 0, "all three resources paid for the cost");
});

clause(DESOLATE, "0:ability", "[O] spent earlier this turn (attached to my faction) are still [O] I control: X's limit counts them", () => {
  const g = devBoard([
    { key: "des", def: printing(DESOLATE), owner: P1, zone: "hand" },
    { key: "m3", def: character({ name: "Mine S3", strength: 3, life: 9 }), owner: P1, zone: "play" },
    ...res({ obsession: 3 }),
    ...res({ obsession: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
  assert.equal(ready(g.engine), 3);
  play(g.engine, P1, g.id("des"), { variables: { x: 3 } });
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard");
});

clause(DESOLATE, "0:ability", "a negative X is not a legal number (CR 410.2) and is refused", () => {
  const bad = desolateBoard();
  refused(desolateAttempt(bad, -1), "X = -1");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("m0")), "play");
  const good = desolateBoard();
  desolate(good, 0);
  assert.equal(zoneOf(good.engine, good.id("m0")), "discard", "control: X = 0 is accepted");
});

clause(DESOLATE, "0:ability", "a fractional X is not a whole number (CR 410.2) and is refused", () => {
  const bad = desolateBoard();
  refused(desolateAttempt(bad, 1.5), "X = 1.5");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  assert.equal(ready(bad.engine), 6, "nothing was paid");
});

// restrictions of the card itself

clause(DESOLATE, "0:ability", "needs [O] to play: with only Greed (no [O]) it is refused even though there are 6 resources", () => {
  const bad = desolateBoard({ icons: { greed: 6 } });
  refused(desolateAttempt(bad, 0), "no [O]");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand");
  assert.equal(ready(bad.engine), 6);
  const good = desolateBoard({ icons: { obsession: 1, greed: 5 } });
  desolate(good, 0);
  assert.equal(zoneOf(good.engine, good.id("des")), "discard", "control: one [O] and enough resources works");
});

clause(DESOLATE, "0:ability", "is refused one resource short of its cost of 3 and works with exactly 3", () => {
  const short = desolateBoard({ icons: { obsession: 2 } });
  refused(desolateAttempt(short, 2), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("des")), "hand");
  assert.equal(zoneOf(short.engine, short.id("m2")), "play");
  const exact = desolateBoard({ icons: { obsession: 3 } });
  desolate(exact, 2);
  assert.equal(zoneOf(exact.engine, exact.id("m2")), "discard");
  assert.equal(ready(exact.engine), 0);
});

clause(DESOLATE, "0:ability", "being a tactic, it can be played in response on the opponent's turn: during their attack it destroys the attacker", () => {
  const g = desolateBoard({ turn: 2, active: P2, extra: [] });
  refused(() => playRaw(g.engine, P1, g.id("des"), { variables: { x: 2 } }), "no response window yet on the opponent's turn");
  declareAttackOpenWindow(g.engine, P2, [g.id("f2")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "the defender holds priority");
  respondWith(g.engine, P1, g.id("des"), {}, { x: 2 });
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard", "the attacker was destroyed");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard");
  assert.deepEqual(battleOf(g.engine)?.attackingParty ?? [], [], "the destroyed attacker left the attacking party (CR 302.15)");
});

clause(DESOLATE, "0:ability", "'Pick a number for X' is a cost: playing without choosing a number is refused instead of silently using X = 0", () => {
  const bad = desolateBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("des"), { variables: {} }), "no number picked for X");
  assert.equal(zoneOf(bad.engine, bad.id("des")), "hand", "Desolate was not played");
  assert.equal(ready(bad.engine), 6, "nothing was paid");
  assert.equal(zoneOf(bad.engine, bad.id("m0")), "play");
});

// =================================================================================
// Foment
// COST: Pick a resource you control. (You can pick face-down resources.) -- EFFECT: Put
// the resource into your hand. Draw a card.
// FLIP UP: 1 [O][O] and play a resource.
// Tactic, cost 0, [O][O].
// =================================================================================

const FOMENT = "cccbf037-ad87-4626-952d-22351b64d91c";

/** A named staple resource placement. */
const rsrc = (key: string, icon: StapleIcon = "obsession", owner: PlayerId = P1, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: resourceCard({ name: `Res ${key}`, resource: { provides: [icon], staple: true } }),
  owner,
  zone: "play",
  ...extra
});

function fomentBoard(
  opts: {
    foment?: "hand" | "faceDown" | "faceUp" | "discard";
    mine?: CardPlacement[];
    extra?: CardPlacement[];
    deck?: number;
    turn?: number;
    active?: PlayerId;
    hand?: boolean;
    oppRes?: boolean;
    foSpent?: boolean;
  } = {}
) {
  const where = opts.foment ?? "hand";
  return devBoard(
    [
      {
        key: "fo",
        def: printing(FOMENT),
        owner: P1,
        zone: where === "hand" ? "hand" : where === "discard" ? "discard" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.foSpent ? "__factionA" : undefined
      },
      ...(opts.mine ?? [rsrc("o1"), rsrc("o2"), rsrc("g1", "greed")]),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(opts.oppRes === false ? [] : [rsrc("p2res", "rage", P2), rsrc("p2fd", "rage", P2, { faceDown: true, def: character({ name: "Their Hidden" }) })]),
      ...(opts.hand === false
        ? []
        : [
            { key: "hres", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "dres", def: resourceCard({ name: "Discard Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "discard" },
      ...fillers("dk", opts.deck ?? 3, P1, "deck"),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type FomentGame = ReturnType<typeof fomentBoard>;
const foment = (g: FomentGame, pick: CardInstanceId) => play(g.engine, P1, g.id("fo"), { selected: { res: [pick] } });
const fomentAttempt = (g: FomentGame, pick?: CardInstanceId) => () =>
  playRaw(g.engine, P1, g.id("fo"), { selected: pick ? { res: [pick] } : {} });

clause(FOMENT, "0:ability", "puts the picked face-up resource into my hand and draws the top card of my deck; Foment ends in my discard pile", () => {
  const g = fomentBoard();
  const top = deckOf(g.engine, P1)[0];
  const handBefore = handOf(g.engine, P1);
  foment(g, g.id("o1"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand", "EFFECT: the resource is put into my hand");
  assert.equal(zoneOf(g.engine, top), "hand", "EFFECT: the top card of my deck is drawn");
  assert.deepEqual(
    handOf(g.engine, P1).sort(),
    [...handBefore.filter((c) => c !== g.id("fo")), g.id("o1"), top].sort(),
    "my hand is exactly: what I had (minus Foment), the resource, and the drawn card"
  );
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.equal(deckOf(g.engine, P1).length, 2, "exactly one card was drawn");
});

clause(FOMENT, "0:ability", "its cost number is 0: no resource is spent playing it", () => {
  const g = fomentBoard();
  const before = ready(g.engine);
  assert.equal(before, 3, "control: o1, o2 and g1");
  foment(g, g.id("o1"));
  assert.equal(ready(g.engine), before - 1, "the only change is the resource I put into my hand");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was attached to my faction (nothing paid)");
});

clause(FOMENT, "0:ability", "the resource really leaves play: it is no longer one of my resources and provides no icon", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), rsrc("g1", "greed")] });
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, 1);
  foment(g, g.id("g1"));
  assert.equal(zoneOf(g.engine, g.id("g1")), "hand");
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, 0, "the Greed it provided is gone");
  assert.equal(g.engine.getThresholds(P1).obsession ?? 0, 2, "the other resources are untouched");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
  assert.equal(zoneOf(g.engine, g.id("o2")), "play");
});

clause(FOMENT, "0:ability", "any of my resources can be picked: a Greed resource, not only the Obsession ones", () => {
  const g = fomentBoard();
  foment(g, g.id("g1"));
  assert.equal(zoneOf(g.engine, g.id("g1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
  assert.equal(zoneOf(g.engine, g.id("o2")), "play");
});

clause(FOMENT, "0:ability", "a resource that provides the threshold icons can be picked: with exactly [O][O] I can put one of them into my hand", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2")] });
  foment(g, g.id("o2"));
  assert.equal(zoneOf(g.engine, g.id("o2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard", "Foment resolved even though its threshold supplier left play");
});

clause(FOMENT, "0:ability", "(You can pick face-down resources): a face-down card I control can be picked and goes into my hand face-up", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), { key: "fd", def: character({ name: "My Hidden", strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }] });
  foment(g, g.id("fd"));
  assert.equal(zoneOf(g.engine, g.id("fd")), "hand");
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, false, "it is a normal card in my hand again");
  assert.ok(handOf(g.engine, P1).includes(g.id("fd")), "handOf(g.engine, P1).includes(g.id(\"fd\"))");
  assert.equal(g.engine.getDefinition(g.id("fd")).name, "My Hidden");
});

clause(FOMENT, "0:ability", "a resource that has already been spent this turn (attached to my faction) can be picked", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), rsrc("spent", "greed", P1, { attachedToKey: "__factionA" })] });
  foment(g, g.id("spent"));
  assert.equal(zoneOf(g.engine, g.id("spent")), "hand");
  assert.equal(g.engine.state.cards[g.id("spent")].attachedTo, undefined, "it is no longer attached to anything");
});

clause(FOMENT, "0:ability", "'Put the resource into YOUR hand': a resource I control but my opponent owns goes into MY hand", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), rsrc("stolen", "rage", P2, { controller: P1 })] });
  foment(g, g.id("stolen"));
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("stolen")), "it is in my hand");
  assert.equal(handOf(g.engine, P2).includes(g.id("stolen")), false, "not in its owner's hand");
});

clause(FOMENT, "0:ability", "the resource put into my hand can be played again with my Develop Rule (Foment does not use it up)", () => {
  const g = fomentBoard();
  foment(g, g.id("g1"));
  assert.ok(developOffers(g.engine, P1).length > 0, "Foment did not use the Develop Rule");
  developResource(g.engine, P1, g.id("g1"), false);
  assert.equal(zoneOf(g.engine, g.id("g1")), "play");
});

clause(FOMENT, "0:ability", "draws exactly one card: the top of the deck, not the returned resource and not the second card", () => {
  const g = fomentBoard({ deck: 3 });
  const [top, second, third] = deckOf(g.engine, P1);
  foment(g, g.id("o1"));
  assert.equal(zoneOf(g.engine, top), "hand", "the top card is drawn");
  assert.deepEqual(deckOf(g.engine, P1), [second, third], "the rest of the deck is untouched and in order");
});

clause(FOMENT, "0:ability", "with an empty deck the resource still goes to my hand and the failed draw costs me nothing (CR 306.2)", () => {
  const g = fomentBoard({ deck: 0 });
  const inf = influenceOf(g.engine, P1);
  foment(g, g.id("o1"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
  assert.equal(influenceOf(g.engine, P1), inf);
  assert.equal(g.engine.state.result, undefined);
});

clause(FOMENT, "0:ability", "only the picked resource moves: my other resources, my characters and the opponent's cards stay where they are", () => {
  const g = fomentBoard();
  foment(g, g.id("o1"));
  for (const key of ["o2", "g1", "ally", "thing", "foe", "p2res", "p2fd"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays in play`);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dres")), "discard");
  assert.equal(handOf(g.engine, P2).length, 0, "my opponent's hand is untouched");
});

// picks

clause(FOMENT, "0:ability", "cannot pick my opponent's resources, face-up or face-down; a legal pick works", () => {
  const g = fomentBoard();
  refused(fomentAttempt(g, g.id("p2res")), "an opponent's face-up resource");
  refused(fomentAttempt(g, g.id("p2fd")), "an opponent's face-down resource");
  assert.equal(zoneOf(g.engine, g.id("fo")), "hand");
  fomentAttempt(g, g.id("o1"))();
  assert.ok(g.engine.state.responseWindow, "control: my own resource is accepted");
});

clause(FOMENT, "0:ability", "cannot pick a resource that is not in play: a resource card in my hand or in my discard pile is refused", () => {
  const g = fomentBoard();
  refused(fomentAttempt(g, g.id("hres")), "a resource card in my hand");
  refused(fomentAttempt(g, g.id("dres")), "a resource card in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(zoneOf(g.engine, g.id("fo")), "hand");
});

clause(FOMENT, "0:ability", "cannot pick a face-up character, item or faction (they are not resources)", () => {
  const g = fomentBoard();
  refused(fomentAttempt(g, g.id("ally")), "my character");
  refused(fomentAttempt(g, g.id("thing")), "my item");
  refused(fomentAttempt(g, g.engine.state.players[P1].factionId!), "my faction");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(zoneOf(g.engine, g.id("fo")), "hand");
});

clause(FOMENT, "0:ability", "'a resource you control': a resource I own but my opponent controls cannot be picked", () => {
  const g = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), rsrc("lent", "greed", P1, { controller: P2 })] });
  refused(fomentAttempt(g, g.id("lent")), "a resource under my opponent's control");
  assert.equal(zoneOf(g.engine, g.id("lent")), "play");
  fomentAttempt(g, g.id("o1"))();
  assert.ok(g.engine.state.responseWindow, "control: my own resource is accepted");
});

clause(FOMENT, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const g = fomentBoard();
  refused(fomentAttempt(g), "no pick");
  refused(() => playRaw(g.engine, P1, g.id("fo"), { selected: { res: [g.id("o1"), g.id("o2")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("fo")), "hand");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
  assert.equal(zoneOf(g.engine, g.id("o2")), "play");
});

clause(FOMENT, "0:ability", "the pick is a cost: it is made when the tactic is played, before the opponent can respond, and nothing has moved yet", () => {
  const g = fomentBoard();
  fomentAttempt(g, g.id("o1"))();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play", "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
});

clause(FOMENT, "0:ability", "if the picked resource leaves play in response (to my discard pile), the effect loses track of it (CR 402.4); the card is still drawn", () => {
  const g = fomentBoard({ extra: [{ key: "mover", def: moverTactic("discard"), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  fomentAttempt(g, g.id("o1"))();
  respondWith(g.engine, P2, g.id("mover"), { t: [g.id("o1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o1")), "discard", "moved to the discard pile in response: it is not put into my hand from there");
  assert.equal(zoneOf(g.engine, top), "hand", "Draw a card is a separate instruction and still happens");
});

// threshold / timing

clause(FOMENT, "0:ability", "needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = fomentBoard({ mine: [rsrc("o1"), rsrc("g1", "greed"), rsrc("g2", "greed"), rsrc("g3", "greed")] });
  refused(fomentAttempt(one, one.id("g1")), "only one [O]");
  assert.equal(zoneOf(one.engine, one.id("fo")), "hand");
  const none = fomentBoard({ mine: [rsrc("g1", "greed"), rsrc("g2", "greed"), rsrc("g3", "greed")] });
  refused(fomentAttempt(none, none.id("g1")), "no [O]");
  const two = fomentBoard({ mine: [rsrc("o1"), rsrc("o2"), rsrc("g1", "greed")] });
  foment(two, two.id("g1"));
  assert.equal(zoneOf(two.engine, two.id("g1")), "hand", "control: two [O] is enough");
});

clause(FOMENT, "0:ability", "face-down resources (Volition) and my opponent's [O] do not meet the [O][O] threshold", () => {
  const vol = fomentBoard({
    mine: [
      rsrc("o1"),
      { key: "fd1", def: character({ name: "Hidden 1" }), owner: P1, zone: "play", faceDown: true },
      { key: "fd2", def: character({ name: "Hidden 2" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  refused(fomentAttempt(vol, vol.id("fd1")), "one [O] plus Volition");
  const theirs = fomentBoard({ mine: [rsrc("o1"), rsrc("g1", "greed")], extra: [rsrc("p2o1", "obsession", P2), rsrc("p2o2", "obsession", P2)] });
  refused(fomentAttempt(theirs, theirs.id("g1")), "their [O] do not count");
  assert.equal(zoneOf(theirs.engine, theirs.id("fo")), "hand");
});

clause(FOMENT, "0:ability", "resources already spent this turn still meet the threshold (icons are never spent) and cost 0 needs no ready resource", () => {
  const g = fomentBoard({ mine: [rsrc("o1", "obsession", P1, { attachedToKey: "__factionA" }), rsrc("o2", "obsession", P1, { attachedToKey: "__factionA" })] });
  assert.equal(ready(g.engine), 0);
  foment(g, g.id("o1"));
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
});

clause(FOMENT, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = fomentBoard({ turn: 2, active: P2 });
  refused(fomentAttempt(g, g.id("o1")), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("fo"), { res: [g.id("o1")] });
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
});

clause(FOMENT, "0:ability", "cannot be played from the discard pile (it is played from my hand)", () => {
  const g = fomentBoard({ foment: "discard" });
  refused(fomentAttempt(g, g.id("o1")), "from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
});

// --- FLIP UP: 1 [O][O] and play a resource ------------------------------------

const flipFoment = (g: FomentGame, pick?: CardInstanceId, player: PlayerId = P1) =>
  flipUpRaw(g.engine, player, g.id("fo"), pick ? { res: [pick] } : {});

/** Flips Foment up with `pick`, then plays `handCard` as the resource the FLIP UP asks for. */
function flipFomentFully(g: FomentGame, pick: CardInstanceId, handCard: CardInstanceId = g.id("hres")): void {
  flipFoment(g, pick);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [handCard] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(FOMENT, "1:flipUp", "a face-down Foment is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = fomentBoard({ foment: "faceDown", mine: [rsrc("o1"), rsrc("o2")] });
  assert.equal(g.engine.isResource(g.id("fo")), true);
  assert.equal(ready(g.engine), 3, "two Obsession plus the face-down Foment");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(FOMENT, "1:flipUp", "flipping it up resolves it as the tactic: the picked resource goes to my hand, a card is drawn, and Foment ends in my discard pile", () => {
  const g = fomentBoard({ foment: "faceDown" });
  const top = deckOf(g.engine, P1)[0];
  flipFomentFully(g, g.id("g1"));
  assert.equal(zoneOf(g.engine, g.id("g1")), "hand", "the picked resource was put into my hand");
  assert.equal(zoneOf(g.engine, top), "hand", "a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard", "a flipped-up tactic goes to its owner's discard pile when it has resolved");
  assert.equal(g.engine.state.cards[g.id("fo")].faceDown, false);
  assert.equal(deckOf(g.engine, P1).length, 2, "exactly one card was drawn");
});

clause(FOMENT, "1:flipUp", "FLIP UP pays 1 and no more: with four ready resources at most one of them ends up spent, and the rest stay ready", () => {
  const g = fomentBoard({ foment: "faceDown", mine: [rsrc("o1"), rsrc("o2"), rsrc("g1", "greed"), rsrc("g2", "greed")] });
  assert.equal(ready(g.engine), 5, "four resources and the face-down Foment");
  flipFomentFully(g, g.id("g1"));
  const spent = attachedCount(g.engine, P1);
  assert.ok(spent <= 1, `at most one resource is spent (the Foment may pay for itself), got ${spent}`);
  // Foment left the pool, the pick went to my hand and the played resource joined: 5 - 1 - 1 + 1, minus whatever was spent
  assert.equal(ready(g.engine), 4 - spent);
});

clause(FOMENT, "1:flipUp", "a face-down Foment that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = fomentBoard({
    foment: "faceDown",
    foSpent: true,
    mine: [rsrc("o1", "obsession", P1, { attachedToKey: "__factionA" }), rsrc("o2", "obsession", P1, { attachedToKey: "__factionA" }), rsrc("g1", "greed")]
  });
  flipFomentFully(g, g.id("o1"));
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard", "flipped up and resolved");
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
});

clause(FOMENT, "1:flipUp", "the face-down Foment can pay for its own FLIP UP cost (CR 507.4b): with every other resource spent it still flips up", () => {
  const g = fomentBoard({
    foment: "faceDown",
    mine: [rsrc("o1", "obsession", P1, { attachedToKey: "__factionA" }), rsrc("o2", "obsession", P1, { attachedToKey: "__factionA" })]
  });
  assert.equal(ready(g.engine), 1, "only the face-down Foment itself is ready");
  flipFomentFully(g, g.id("o1"));
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand");
});

clause(FOMENT, "1:flipUp", "FLIP UP needs [O][O]: one [O] among many other resources is refused (the card stays face-down), two are accepted", () => {
  const one = fomentBoard({ foment: "faceDown", mine: [rsrc("o1"), rsrc("g1", "greed"), rsrc("g2", "greed"), rsrc("g3", "greed")] });
  refused(() => flipFoment(one, one.id("g1")), "one [O]");
  assert.equal(one.engine.state.cards[one.id("fo")].faceDown, true, "still face-down");
  assert.equal(ready(one.engine), 5, "nothing was paid");
  const none = fomentBoard({ foment: "faceDown", mine: [rsrc("g1", "greed"), rsrc("g2", "greed"), rsrc("g3", "greed")] });
  refused(() => flipFoment(none, none.id("g1")), "no [O]");
  const two = fomentBoard({ foment: "faceDown", mine: [rsrc("o1"), rsrc("o2"), rsrc("g1", "greed")] });
  flipFomentFully(two, two.id("g1"));
  assert.equal(zoneOf(two.engine, two.id("g1")), "hand", "control: two [O] is enough");
});

clause(FOMENT, "1:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const onlyVolition = fomentBoard({ foment: "faceDown", mine: [rsrc("g1", "greed"), rsrc("g2", "greed"), rsrc("g3", "greed")] });
  refused(() => flipFoment(onlyVolition, onlyVolition.id("g1")), "no [O] anywhere");
  const theirs = fomentBoard({ foment: "faceDown", mine: [rsrc("o1"), rsrc("g1", "greed"), rsrc("g2", "greed")], extra: [rsrc("p2o1", "obsession", P2), rsrc("p2o2", "obsession", P2)] });
  refused(() => flipFoment(theirs, theirs.id("g1")), "only one [O] of mine");
  assert.equal(theirs.engine.state.cards[theirs.id("fo")].faceDown, true);
});

clause(FOMENT, "1:flipUp", "'play a resource': a resource card from my hand enters play face-up and provides its icon", () => {
  const g = fomentBoard({ foment: "faceDown" });
  flipFomentFully(g, g.id("g1"), g.id("hres"));
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(g.engine.state.cards[g.id("hres")].faceDown, false, "an actual resource card is played face-up");
  assert.ok(playOf(g.engine, P1).includes(g.id("hres")), "playOf(g.engine, P1).includes(g.id(\"hres\"))");
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, 1, "it provides its Greed icon (the other Greed went to my hand)");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand", "the other hand card stays");
});

clause(FOMENT, "1:flipUp", "'play a resource': a card that is not a resource enters play face-down and provides Volition", () => {
  const g = fomentBoard({ foment: "faceDown" });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  flipFomentFully(g, g.id("g1"), g.id("hchar"));
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play");
  assert.equal(g.engine.state.cards[g.id("hchar")].faceDown, true, "a non-resource can only be played face-down");
  assert.equal(g.engine.isResource(g.id("hchar")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore - 1 + 1, "Foment's own Volition left, the new face-down card's arrived");
});

clause(FOMENT, "1:flipUp", "'play a resource' is not a 'may': the player cannot decline to play one when they have a card in hand", () => {
  const g = fomentBoard({ foment: "faceDown" });
  flipFoment(g, g.id("g1"));
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to play a resource");
  assert.ok(pending(g.engine), "the demand to play a resource is still standing");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(FOMENT, "1:flipUp", "the resource to play is a Flip Up cost, so FLIP UP with no card in my hand to play is refused", () => {
  const g = fomentBoard({ foment: "faceDown", hand: false });
  assert.equal(handOf(g.engine, P1).length, 0, "control: my hand is empty");
  refused(() => flipFoment(g, g.id("g1")), "no card to play as the resource");
  assert.equal(g.engine.state.cards[g.id("fo")].faceDown, true, "still face-down");
  assert.equal(zoneOf(g.engine, g.id("g1")), "play", "nothing happened");
});

clause(FOMENT, "1:flipUp", "the resource played for the Flip Up cost can be the one Foment's pick puts into my hand (Flip Up extra costs come directly before the regular extra costs, CR 507.4c)", () => {
  const g = fomentBoard({ foment: "faceDown" });
  flipUpRaw(g.engine, P1, g.id("fo"), { res: [g.id("hres")] });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand", "played as a resource, then picked and put back into my hand");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
});

clause(FOMENT, "1:flipUp", "playing the resource this way does not use up my Develop Rule", () => {
  const g = fomentBoard({ foment: "faceDown" });
  flipFomentFully(g, g.id("g1"));
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("g1"), false);
  assert.equal(zoneOf(g.engine, g.id("g1")), "play", "I can still develop a resource afterwards");
});

clause(FOMENT, "1:flipUp", "the regular extra cost still applies when flipping up: only one resource I control can be picked", () => {
  // E3a: the pick is judged AFTER the FLIP UP line's "play a resource" (CR 507.4c), so which card is legal is only
  // known once that resource has been chosen: the wrong cards are refused when the FLIP UP is completed.
  const g = fomentBoard({ foment: "faceDown" });
  for (const wrong of ["p2res", "ally"]) {
    const fresh = fomentBoard({ foment: "faceDown" });
    refused(() => flipFomentFully(fresh, fresh.id(wrong)), wrong === "ally" ? "my character" : "an opponent's resource");
    assert.equal(fresh.engine.state.cards[fresh.id("fo")].faceDown, true, "still face-down after the refusal");
    assert.equal(ready(fresh.engine), 4, "nothing was paid by the refused attempt");
  }
  // a resource card that stays in my hand (the FLIP UP plays the other one) is not a resource I control
  const spare = fomentBoard({ foment: "faceDown", extra: [{ key: "hres2", def: resourceCard({ name: "Spare Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" }] });
  refused(() => flipFomentFully(spare, spare.id("hres2"), spare.id("hres")), "a resource card left in my hand");
  refused(() => flipFoment(g), "no pick at all");
  refused(() => flipUpRaw(g.engine, P1, g.id("fo"), { res: [g.id("o1"), g.id("o2")] }), "two picks");
  assert.equal(g.engine.state.cards[g.id("fo")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 4, "nothing was paid by the refused attempts");
  flipFomentFully(g, g.id("o1"));
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand", "control: a legal pick works");
});

clause(FOMENT, "1:flipUp", "a face-down card I control can be the picked resource when flipping up too", () => {
  const g = fomentBoard({
    foment: "faceDown",
    mine: [rsrc("o1"), rsrc("o2"), { key: "fd", def: character({ name: "My Hidden" }), owner: P1, zone: "play", faceDown: true }]
  });
  flipFomentFully(g, g.id("fd"));
  assert.equal(zoneOf(g.engine, g.id("fd")), "hand");
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, false);
});

clause(FOMENT, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = fomentBoard({ foment: "faceDown" });
  refused(() => flipUpRaw(theirs.engine, P2, theirs.id("fo"), { res: [theirs.id("p2res")] }), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("fo")].faceDown, true);
  const inHand = fomentBoard({ foment: "hand" });
  refused(() => flipFoment(inHand, inHand.id("o1")), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("fo")), "hand");
  const faceUp = fomentBoard({ foment: "faceUp" });
  refused(() => flipFoment(faceUp, faceUp.id("o1")), "a face-up card in play cannot be flipped up");
  assert.equal(faceUp.engine.state.cards[faceUp.id("fo")].faceDown, false);
});

clause(FOMENT, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = fomentBoard({ foment: "faceDown", turn: 2, active: P2 });
  refused(() => flipFoment(g, g.id("o1")), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("fo")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  flipFoment(g, g.id("o1"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("o1")), "hand", "flipped up in response to the attack");
  assert.equal(zoneOf(g.engine, g.id("fo")), "discard");
});

clause(FOMENT, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = fomentBoard({ foment: "faceDown", extra: [{ key: "mover", def: moverTactic("discard"), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipFoment(g, g.id("g1")));
  // the Flip Up extra cost (play a resource) is paid first: the pick is asked before the flip, and answering it flips the card
  if (pending(g.engine)) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("hres")] } } as never);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("g1")), "play", "the effect has not happened yet");
});

clause(FOMENT, "1:flipUp", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = fomentBoard({ foment: "faceDown" });
  flipFoment(g, g.id("g1"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

// =================================================================================
// Hextilda, the Exiled Crone
// UNIQUE HEXTILDA
// TOIL AND TROUBLE -- COST: Pay 4. Deplete this card. Pick a card you control with at
// least 1 token on it. -- EFFECT: Double the number of tokens on the card.
// Character (sorceress), cost 1, [O][O][O], 1 strength / 1 speed / 1 life.
// =================================================================================

const HEXTILDA = "ce72ca69-590d-41fd-90d8-a749fab83011";

/** A free tactic (id "tg", pick "t"): puts `n` tokens on the picked card in play. */
function tokenGiver(n: number, name = `Give ${n} tokens`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: n }]
        }
      ]
    }
  });
}

/** A free tactic (id "st", pick "t"): the caster takes control of the picked character. */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "st",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

function hextildaBoard(
  opts: {
    icons?: Icons;
    depleted?: boolean;
    hx?: "play" | "hand" | "discard";
    eligible?: boolean;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "hx", def: printing(HEXTILDA), owner: P1, zone: opts.hx ?? "play", depleted: opts.depleted, attackEligible: opts.eligible },
      { key: "tk3", def: character({ name: "Tokened Three", life: 9 }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "tk1", def: character({ name: "Tokened One", life: 9 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "tk5", def: character({ name: "Tokened Five", life: 9 }), owner: P1, zone: "play", counters: { token: 5 } },
      { key: "tkItem", def: item({ name: "Tokened Item" }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "tkPlace", def: location({ name: "Tokened Place" }), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "plain", def: character({ name: "No Tokens" }), owner: P1, zone: "play" },
      { key: "foeTk", def: character({ name: "Their Tokened", life: 9 }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "captured", def: character({ name: "Captured", life: 9 }), owner: P2, controller: P1, zone: "play", counters: { token: 2 } },
      { key: "lent", def: character({ name: "Lent Out", life: 9 }), owner: P1, controller: P2, zone: "play", counters: { token: 2 } },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type HextildaGame = ReturnType<typeof hextildaBoard>;
const toil = (g: HextildaGame, pick: CardInstanceId) => activate(g.engine, P1, g.id("hx"), "toil-and-trouble", { selected: { target: [pick] } });
const toilAttempt = (g: HextildaGame, pick?: CardInstanceId, player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("hx"), "toil-and-trouble", pick ? { target: [pick] } : {});

// --- UNIQUE HEXTILDA ---------------------------------------------------------------

function hextildaPair() {
  return devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "hx2", def: printing(HEXTILDA), owner: P1, zone: "hand" },
    { key: "other", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ obsession: 3 })
  ]);
}

for (const keep of ["hx", "hx2"] as const) {
  clause(HEXTILDA, "0:unique", `a second copy: its controller is asked which to keep (keeping ${keep === "hx" ? "the old" : "the new"} one) and the other is destroyed`, () => {
    const { engine, id } = hextildaPair();
    play(engine, P1, id("hx2"));
    const pc = expectPending(engine, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "its controller chooses");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [id("hx"), id("hx2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const lost = keep === "hx" ? "hx2" : "hx";
    assert.equal(zoneOf(engine, id(keep)), "play", "the kept copy stays");
    assert.equal(zoneOf(engine, id(lost)), "discard", "the other copy is destroyed");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("other")), "play", "no other card is affected");
  });
}

clause(HEXTILDA, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = hextildaPair();
  play(engine, P1, id("hx2"));
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("other") } } as never),
    "keeping a bystander"
  );
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("hx") } } as never);
  assert.equal(zoneOf(engine, id("hx")), "play", "control: a real copy is accepted");
});

clause(HEXTILDA, "0:unique", "UNIQUE is per player: my opponent may control their own Hextilda with no choice and no destruction", () => {
  const { engine, id } = devBoard(
    [
      { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
      { key: "hx2", def: printing(HEXTILDA), owner: P2, zone: "hand" },
      ...res({ obsession: 3 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(engine, P2, id("hx2"));
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice");
  assert.equal(zoneOf(engine, id("hx")), "play");
  assert.equal(zoneOf(engine, id("hx2")), "play");
});

clause(HEXTILDA, "0:unique", "a second copy in my hand or my discard pile is no conflict (only cards I control in play count)", () => {
  const { engine, id } = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "inHand", def: printing(HEXTILDA), owner: P1, zone: "hand" },
    { key: "inDisc", def: printing(HEXTILDA), owner: P1, zone: "discard" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hx")), "play");
  assert.equal(zoneOf(engine, id("inHand")), "hand");
  assert.equal(zoneOf(engine, id("inDisc")), "discard");
});

clause(HEXTILDA, "0:unique", "after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "discard" },
    { key: "hx2", def: printing(HEXTILDA), owner: P1, zone: "hand" },
    ...res({ obsession: 3 })
  ]);
  play(engine, P1, id("hx2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hx2")), "play");
});

clause(HEXTILDA, "0:unique", "a different Unique card is not a conflict: only the same designation HEXTILDA counts", () => {
  const { engine, id } = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "uniq", def: character({ name: "Someone Else", unique: "someone else" }), owner: P1, zone: "play" },
    { key: "uniq2", def: character({ name: "Someone Else 2", unique: "someone else" }), owner: P2, zone: "play" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hx")), "play");
  assert.equal(zoneOf(engine, id("uniq")), "play");
});

clause(HEXTILDA, "0:unique", "taking control of my opponent's Hextilda while I control one makes me choose which to keep (FAQ: the controller chooses), and the game goes on", () => {
  const { engine, id } = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "foeHx", def: printing(HEXTILDA), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("steal"), { selected: { t: [id("foeHx")] } });
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("hx") } } as never);
  assert.equal(zoneOf(engine, id("hx")), "play");
  assert.equal(zoneOf(engine, id("foeHx")), "discard", "the extra copy is destroyed (to its owner's discard pile)");
  assert.equal(engine.state.pendingChoice, undefined);
  resolvePendingResponses(engine); // throws "did not converge" when the game is soft-locked
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the stealing tactic finished resolving");
});

clause(HEXTILDA, "0:unique", "a face-down Hextilda is only a resource (CR 411.1): it does not conflict with a face-up one", () => {
  const { engine, id } = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "hxFd", def: printing(HEXTILDA), owner: P1, zone: "play", faceDown: true }
  ]);
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hx")), "play");
  assert.equal(zoneOf(engine, id("hxFd")), "play");
});

// --- TOIL AND TROUBLE ----------------------------------------------------------------

clause(HEXTILDA, "1:ability:toil-and-trouble", "doubles the tokens on the picked card (3 becomes 6), pays exactly 4 and depletes Hextilda", () => {
  const g = hextildaBoard();
  const before = ready(g.engine);
  toil(g, g.id("tk3"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6, "EFFECT: double the number of tokens");
  assert.equal(before - ready(g.engine), 4, "COST: Pay 4");
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, true, "COST: Deplete this card");
  assert.equal(zoneOf(g.engine, g.id("hx")), "play", "Hextilda herself stays in play");
});

for (const [key, from] of [
  ["tk1", 1],
  ["tkItem", 2],
  ["tkPlace", 4],
  ["tk5", 5]
] as const) {
  clause(HEXTILDA, "1:ability:toil-and-trouble", `doubles ${from} token${from === 1 ? "" : "s"} to ${from * 2}`, () => {
    const g = hextildaBoard();
    toil(g, g.id(key));
    assert.equal(tokensOn(g.engine, g.id(key)), from * 2);
  });
}

clause(HEXTILDA, "1:ability:toil-and-trouble", "only the picked card is changed: every other card keeps its tokens", () => {
  const g = hextildaBoard();
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk1")), 1);
  assert.equal(tokensOn(g.engine, g.id("tk5")), 5);
  assert.equal(tokensOn(g.engine, g.id("tkItem")), 2);
  assert.equal(tokensOn(g.engine, g.id("tkPlace")), 4);
  assert.equal(tokensOn(g.engine, g.id("foeTk")), 2);
  assert.equal(tokensOn(g.engine, g.id("captured")), 2);
  assert.equal(tokensOn(g.engine, g.id("plain")), 0);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "Hextilda can pick herself when she has tokens", () => {
  const g = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play", counters: { token: 2 } },
    ...res({ greed: 4 })
  ]);
  activate(g.engine, P1, g.id("hx"), "toil-and-trouble", { selected: { target: [g.id("hx")] } });
  assert.equal(tokensOn(g.engine, g.id("hx")), 4);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, true);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "'a card you control': an item and a location with tokens can be picked as well as a character", () => {
  const g = hextildaBoard();
  toil(g, g.id("tkItem"));
  assert.equal(tokensOn(g.engine, g.id("tkItem")), 4);
  const h = hextildaBoard();
  toil(h, h.id("tkPlace"));
  assert.equal(tokensOn(h.engine, h.id("tkPlace")), 8);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "a card I control but my opponent owns can be picked (control, not ownership)", () => {
  const g = hextildaBoard();
  toil(g, g.id("captured"));
  assert.equal(tokensOn(g.engine, g.id("captured")), 4);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "a face-down card I control that has tokens can be picked (it is a card in play)", () => {
  const g = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true, counters: { token: 2 } },
    ...res({ greed: 4 })
  ]);
  activate(g.engine, P1, g.id("hx"), "toil-and-trouble", { selected: { target: [g.id("fd")] } });
  assert.equal(tokensOn(g.engine, g.id("fd")), 4);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "cannot pick a card with no tokens; nothing is paid or depleted, and a card with a token works", () => {
  const g = hextildaBoard();
  const before = ready(g.engine);
  refused(toilAttempt(g, g.id("plain")), "a card with 0 tokens");
  refused(toilAttempt(g, g.id("hx")), "Hextilda herself with 0 tokens");
  assert.equal(ready(g.engine), before, "nothing was paid");
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false, "not depleted");
  toil(g, g.id("tk1"));
  assert.equal(tokensOn(g.engine, g.id("tk1")), 2, "control: a card with a token works");
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "cannot pick my opponent's cards, even with tokens, nor a card I own but they control", () => {
  const g = hextildaBoard();
  refused(toilAttempt(g, g.id("foeTk")), "their card with tokens");
  refused(toilAttempt(g, g.id("lent")), "my card under their control");
  assert.equal(tokensOn(g.engine, g.id("foeTk")), 2);
  assert.equal(tokensOn(g.engine, g.id("lent")), 2);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false);
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6, "control: my own card works");
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "cannot pick a faction (CR 202.9), even one with tokens on it", () => {
  const g = hextildaBoard();
  const faction = g.engine.state.players[P1].factionId!;
  g.engine.state.cards[faction].counters = { token: 2 };
  refused(toilAttempt(g, faction), "my faction card");
  assert.equal(tokensOn(g.engine, faction), 2);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "cannot pick a card outside play (a card in hand or in the discard pile)", () => {
  const g = hextildaBoard();
  refused(toilAttempt(g, g.id("inHand")), "a card in my hand");
  refused(toilAttempt(g, g.id("inDisc")), "a card in my discard pile");
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "needs exactly one pick: none or two are refused", () => {
  const g = hextildaBoard();
  refused(toilAttempt(g), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("hx"), "toil-and-trouble", { target: [g.id("tk3"), g.id("tk1")] }), "two picks");
  assert.equal(tokensOn(g.engine, g.id("tk3")), 3);
  assert.equal(tokensOn(g.engine, g.id("tk1")), 1);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "is refused one resource short of its Pay 4 (3 ready), nothing is depleted, and works with exactly 4", () => {
  const short = hextildaBoard({ icons: { greed: 3 } });
  refused(toilAttempt(short, short.id("tk3")), "3 resources for a cost of 4");
  assert.equal(tokensOn(short.engine, short.id("tk3")), 3);
  assert.equal(short.engine.state.cards[short.id("hx")].depleted, false);
  assert.equal(ready(short.engine), 3, "nothing was paid");
  const exact = hextildaBoard({ icons: { greed: 4 } });
  toil(exact, exact.id("tk3"));
  assert.equal(tokensOn(exact.engine, exact.id("tk3")), 6);
  assert.equal(ready(exact.engine), 0);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "resources already spent do not count towards Pay 4 (4 resources of which 2 are attached: refused)", () => {
  const bad = devBoard([
    { key: "hx", def: printing(HEXTILDA), owner: P1, zone: "play" },
    { key: "tk3", def: character({ name: "Tokened Three" }), owner: P1, zone: "play", counters: { token: 3 } },
    ...res({ greed: 2 }),
    ...res({ greed: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
  refused(() => actRaw(bad.engine, P1, bad.id("hx"), "toil-and-trouble", { target: [bad.id("tk3")] }), "only 2 ready");
  assert.equal(tokensOn(bad.engine, bad.id("tk3")), 3);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "pays 4 and no more: with 6 resources, 2 stay ready", () => {
  const g = hextildaBoard({ icons: { greed: 6 } });
  toil(g, g.id("tk3"));
  assert.equal(ready(g.engine), 2);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "the ability has no threshold of its own: any four resources pay for it (no [O] needed once she is in play)", () => {
  const g = hextildaBoard({ icons: { rage: 4 } });
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "'Deplete this card': a depleted Hextilda cannot use it, and the cost is not paid", () => {
  const bad = hextildaBoard({ depleted: true });
  refused(toilAttempt(bad, bad.id("tk3")), "Hextilda is depleted");
  assert.equal(tokensOn(bad.engine, bad.id("tk3")), 3);
  assert.equal(ready(bad.engine), 6, "nothing was paid");
  const good = hextildaBoard();
  toil(good, good.id("tk3"));
  assert.equal(tokensOn(good.engine, good.id("tk3")), 6, "control: an undepleted Hextilda works");
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "once per untap: using it depletes her, so a second use the same turn is refused", () => {
  const g = hextildaBoard({ icons: { greed: 8 } });
  toil(g, g.id("tk3"));
  refused(toilAttempt(g, g.id("tk3")), "she is depleted now");
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6, "not doubled a second time");
  assert.equal(ready(g.engine), 4, "the second attempt paid nothing");
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "she untaps at the start of my next turn and can double again (3 -> 6 -> 12)", () => {
  const g = hextildaBoard({ icons: { greed: 4 } });
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false, "restored at the start of my turn");
  assert.equal(ready(g.engine), 4, "my resources were detached again");
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk3")), 12);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "a character may use its abilities the turn it enters play (CR 204.3a): Hextilda that cannot attack yet can still use it", () => {
  const g = hextildaBoard({ eligible: false });
  toil(g, g.id("tk3"));
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "can only be used from play: refused while Hextilda is in my hand or in my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = hextildaBoard({ hx: zone });
    refused(toilAttempt(bad, bad.id("tk3")), `from ${zone}`);
    assert.equal(tokensOn(bad.engine, bad.id("tk3")), 3);
    assert.equal(ready(bad.engine), 6);
  }
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "only her controller can use it: my opponent cannot activate my Hextilda", () => {
  const g = hextildaBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(toilAttempt(g, g.id("foeTk"), P2), "the opponent using my Hextilda", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(tokensOn(g.engine, g.id("foeTk")), 2);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, false);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "can be used in response on the opponent's turn (it is an ability, CR 502.3)", () => {
  const g = hextildaBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(toilAttempt(g, g.id("tk3")), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "the defender holds priority");
  actRaw(g.engine, P1, g.id("hx"), "toil-and-trouble", { target: [g.id("tk3")] });
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, true);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "the costs are paid when the ability is used, before the opponent can respond; the tokens are doubled only afterwards", () => {
  const g = hextildaBoard();
  const before = ready(g.engine);
  toilAttempt(g, g.id("tk3"))();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 4, "Pay 4 was already paid");
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, true, "Hextilda is already depleted");
  assert.equal(tokensOn(g.engine, g.id("tk3")), 3, "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "'Double the number of tokens on the card' reads the number when it resolves: 3 tokens plus 2 added in response become 5, doubled to 10", () => {
  const g = hextildaBoard({ extra: [{ key: "give", def: tokenGiver(2), owner: P2, zone: "hand" }] });
  toilAttempt(g, g.id("tk3"))();
  respondWith(g.engine, P2, g.id("give"), { t: [g.id("tk3")] });
  assert.equal(tokensOn(g.engine, g.id("tk3")), 10);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "if the picked card leaves play in response its tokens disappear (CR 409.2) and nothing is doubled; the costs stay paid", () => {
  const g = hextildaBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  toilAttempt(g, g.id("tk3"))();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("tk3")] });
  assert.equal(zoneOf(g.engine, g.id("tk3")), "discard", "control: destroyed in response");
  assert.equal(tokensOn(g.engine, g.id("tk3")), 0, "tokens disappear when a card leaves play, and the effect has nothing left to double");
  assert.equal(before - ready(g.engine), 4, "the cost stays paid");
  assert.equal(g.engine.state.cards[g.id("hx")].depleted, true);
});

clause(HEXTILDA, "1:ability:toil-and-trouble", "the ability resolves as written even if Hextilda is destroyed in response (CR 502.4): the tokens are still doubled", () => {
  const g = hextildaBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  toilAttempt(g, g.id("tk3"))();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("hx")] });
  assert.equal(zoneOf(g.engine, g.id("hx")), "discard", "control: Hextilda was destroyed in response");
  assert.equal(tokensOn(g.engine, g.id("tk3")), 6);
});

// =================================================================================
// Hideous Hexapede of Horror
// HIDEOUSLY HORRENDOUS HEX OF HELLISHLY HORRIFYING HATRED -- COST: Pay 6. Destroy this
// card. Pick 6 characters. -- EFFECT: Inflict 6 damage to each of the characters. Inflict
// 6 damage to all factions. Both players remove 6 cards in their hand from the game. Both
// players remove 6 cards in their discard pile from the game. Both players remove the top
// 6 cards of their deck from the game.
// Character (insect, monstrosity), cost 6, [O]x6, 6 strength / 6 speed / 6 life.
// =================================================================================

const HEXAPEDE = "de6f188a-119d-4da0-9965-70b258c40ec5";
const HEX = "hellish-hex";

function hexapedeBoard(
  opts: {
    icons?: Icons;
    hx?: "play" | "hand" | "discard";
    eligible?: boolean;
    life?: number;
    hand1?: number;
    hand2?: number;
    disc1?: number;
    disc2?: number;
    deck1?: number;
    deck2?: number;
    inf1?: number;
    inf2?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const life = opts.life ?? 9;
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.inf1 ?? 30 },
    playerB: { faction: developFaction(), influence: opts.inf2 ?? 30 },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "hx", def: printing(HEXAPEDE), owner: P1, zone: opts.hx ?? "play", attackEligible: opts.eligible },
      ...[1, 2, 3, 4].map((i) => ({ key: `c${i}`, def: character({ name: `Mine ${i}`, life }), owner: P1, zone: "play" as const })),
      ...[1, 2, 3, 4].map((i) => ({ key: `f${i}`, def: character({ name: `Foe ${i}`, life }), owner: P2, zone: "play" as const })),
      ...res(opts.icons ?? { obsession: 6 }),
      ...fillers("h1_", opts.hand1 ?? 8, P1, "hand"),
      ...fillers("h2_", opts.hand2 ?? 8, P2, "hand"),
      ...fillers("d1_", opts.disc1 ?? 7, P1, "discard"),
      ...fillers("d2_", opts.disc2 ?? 7, P2, "discard"),
      ...fillers("k1_", opts.deck1 ?? 10, P1, "deck"),
      ...fillers("k2_", opts.deck2 ?? 10, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

type HexGame = ReturnType<typeof hexapedeBoard>;
const HEX_VICTIMS = ["c1", "c2", "c3", "f1", "f2", "f3"];

/** Uses the Hex with the named victims; the response window is drained, so the effect has resolved up to the first pending choice. */
function hexAct(g: HexGame, victims: string[] = HEX_VICTIMS): void {
  actRaw(g.engine, P1, g.id("hx"), HEX, { victims: victims.map((key) => g.id(key)) });
  resolvePendingResponses(g.engine);
}

/** Answers the remove-from-the-game picks: each player removes the first `n` (default 6) cards of THEIR OWN hand / discard pile. */
function removeFirst(g: HexGame, n = 6) {
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const zone = ((pc.declaration as { selector?: { zone?: string } } | undefined)?.selector?.zone ?? "") as string;
    const owned = zone === "hand" ? handOf(g.engine, pc.playerId) : zone === "discard" ? discardOf(g.engine, pc.playerId) : [];
    return { kind: "chooserSelectsTarget", selected: owned.slice(0, n) };
  };
}

/** A full resolution: use the Hex, and answer every pick by removing the first six cards. */
function hexFully(g: HexGame, victims: string[] = HEX_VICTIMS): void {
  hexAct(g, victims);
  drain(g.engine, removeFirst(g));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.responseWindow, undefined);
}

const hexAttempt = (g: HexGame, victims: string[] = HEX_VICTIMS, player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("hx"), HEX, { victims: victims.map((key) => g.id(key)) });

clause(HEXAPEDE, "0:ability:hellish-hex", "the full ability: six picked characters take 6 damage, both factions lose 6 influence, and each player loses 6 hand cards, 6 discard cards and 6 deck cards to 'removed'", () => {
  const g = hexapedeBoard();
  hexFully(g);
  for (const key of HEX_VICTIMS) assert.equal(g.engine.state.cards[g.id(key)].damage, 6, `${key} took 6 damage`);
  for (const key of ["c4", "f4"]) assert.equal(g.engine.state.cards[g.id(key)].damage, 0, `${key} was not picked`);
  assert.equal(influenceOf(g.engine, P1), 24, "my faction took 6");
  assert.equal(influenceOf(g.engine, P2), 24, "their faction took 6");
  assert.equal(handOf(g.engine, P1).length, 2, "8 - 6");
  assert.equal(handOf(g.engine, P2).length, 2);
  assert.equal(deckOf(g.engine, P1).length, 4, "10 - 6");
  assert.equal(deckOf(g.engine, P2).length, 4);
  assert.equal(removedOf(g.engine, P1).length, 18, "6 hand + 6 discard + 6 deck");
  assert.equal(removedOf(g.engine, P2).length, 18);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Pay 6 -- exactly six resources are paid", () => {
  const g = hexapedeBoard({ icons: { obsession: 6, greed: 3 } });
  const before = ready(g.engine);
  hexAct(g);
  assert.equal(before - ready(g.engine), 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Pay 6 -- five ready resources are refused (nothing is paid, nothing destroyed), exactly six work", () => {
  const short = hexapedeBoard({ icons: { obsession: 5 } });
  refused(hexAttempt(short), "5 resources for Pay 6");
  assert.equal(zoneOf(short.engine, short.id("hx")), "play", "the Hexapede was not destroyed by the refused action");
  assert.equal(ready(short.engine), 5);
  assert.equal(short.engine.state.cards[short.id("c1")].damage, 0);
  const exact = hexapedeBoard({ icons: { obsession: 6 } });
  hexFully(exact);
  assert.equal(exact.engine.state.cards[exact.id("c1")].damage, 6, "control: six resources work");
  assert.equal(ready(exact.engine), 0);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Pay 6 -- resources already spent do not count (8 resources of which 3 are attached leaves 5 ready: refused)", () => {
  const bad = hexapedeBoard({ icons: { obsession: 5 }, extra: res({ obsession: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(bad.engine), 5);
  refused(hexAttempt(bad), "only 5 ready");
  assert.equal(zoneOf(bad.engine, bad.id("hx")), "play");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the ability has no threshold: six resources of any icons pay for it", () => {
  const g = hexapedeBoard({ icons: { rage: 3, greed: 3 } });
  hexFully(g);
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Destroy this card -- the Hexapede goes to its owner's discard pile when the ability is used, before the opponent can respond", () => {
  const g = hexapedeBoard();
  hexAttempt(g)();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("hx")), "discard", "destroyed as a cost");
  assert.ok(discardOf(g.engine, P1).includes(g.id("hx")), "discardOf(g.engine, P1).includes(g.id(\"hx\"))");
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 0, "the effect has not happened yet");
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Pay 6 is paid when the ability is used, before the opponent can respond", () => {
  const g = hexapedeBoard();
  const before = ready(g.engine);
  hexAttempt(g)();
  assert.equal(before - ready(g.engine), 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the Hexapede cannot pick itself: it is destroyed (leaves play) before the 6 characters are picked", () => {
  const g = hexapedeBoard();
  refused(hexAttempt(g, ["hx", "c1", "c2", "c3", "f1", "f2"]), "picking the Hexapede itself");
  assert.equal(zoneOf(g.engine, g.id("hx")), "play", "nothing was paid or destroyed by the refused action");
  assert.equal(ready(g.engine), 6);
  hexAct(g);
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 6, "control: six other characters work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "'Pick 6 characters' is exactly six: five picks, or none, are refused", () => {
  const five = hexapedeBoard();
  refused(hexAttempt(five, ["c1", "c2", "c3", "f1", "f2"]), "five picks");
  assert.equal(zoneOf(five.engine, five.id("hx")), "play", "the Hexapede was not destroyed by the refused action");
  assert.equal(ready(five.engine), 6, "nothing was paid");
  const none = hexapedeBoard();
  refused(hexAttempt(none, []), "no picks");
  assert.equal(zoneOf(none.engine, none.id("hx")), "play");
  const six = hexapedeBoard();
  hexAct(six);
  assert.equal(zoneOf(six.engine, six.id("hx")), "discard", "control: six picks work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "'Pick 6 characters' is exactly six: seven picks are refused", () => {
  const seven = hexapedeBoard();
  refused(hexAttempt(seven, ["c1", "c2", "c3", "c4", "f1", "f2", "f3"]), "seven picks");
  assert.equal(zoneOf(seven.engine, seven.id("hx")), "play");
  assert.equal(ready(seven.engine), 6);
  const six = hexapedeBoard();
  hexAct(six);
  assert.equal(zoneOf(six.engine, six.id("hx")), "discard", "control: six picks work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the same character cannot be picked twice to make up the six", () => {
  const g = hexapedeBoard();
  refused(hexAttempt(g, ["c1", "c1", "c2", "c3", "f1", "f2"]), "a duplicate pick");
  assert.equal(zoneOf(g.engine, g.id("hx")), "play");
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 0);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "with fewer than six other characters in play the cost cannot be satisfied, so the ability cannot be used", () => {
  const g = devBoard([
    { key: "hx", def: printing(HEXAPEDE), owner: P1, zone: "play" },
    ...[1, 2].map((i) => ({ key: `c${i}`, def: character({ name: `Mine ${i}`, life: 9 }), owner: P1, zone: "play" as const })),
    ...[1, 2, 3].map((i) => ({ key: `f${i}`, def: character({ name: `Foe ${i}`, life: 9 }), owner: P2, zone: "play" as const })),
    ...res({ obsession: 6 })
  ]);
  refused(() => actRaw(g.engine, P1, g.id("hx"), HEX, { victims: ["c1", "c2", "f1", "f2", "f3"].map((key) => g.id(key)) }), "only five other characters");
  assert.equal(zoneOf(g.engine, g.id("hx")), "play");
  assert.equal(ready(g.engine), 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "any six characters may be picked: all mine, all my opponent's, or a mix", () => {
  const mine = hexapedeBoard({ extra: [1, 2].map((i) => ({ key: `cx${i}`, def: character({ name: `Mine Extra ${i}`, life: 9 }), owner: P1, zone: "play" as const })) });
  hexFully(mine, ["c1", "c2", "c3", "c4", "cx1", "cx2"]);
  for (const key of ["c1", "c2", "c3", "c4", "cx1", "cx2"]) assert.equal(mine.engine.state.cards[mine.id(key)].damage, 6, `${key} took 6`);
  for (const key of ["f1", "f2", "f3", "f4"]) assert.equal(mine.engine.state.cards[mine.id(key)].damage, 0, `${key} untouched`);
  const theirs = hexapedeBoard({ extra: [1, 2].map((i) => ({ key: `fx${i}`, def: character({ name: `Foe Extra ${i}`, life: 9 }), owner: P2, zone: "play" as const })) });
  hexFully(theirs, ["f1", "f2", "f3", "f4", "fx1", "fx2"]);
  for (const key of ["f1", "f2", "f3", "f4", "fx1", "fx2"]) assert.equal(theirs.engine.state.cards[theirs.id(key)].damage, 6, `${key} took 6`);
  for (const key of ["c1", "c2", "c3", "c4"]) assert.equal(theirs.engine.state.cards[theirs.id(key)].damage, 0, `${key} untouched`);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "only CHARACTERS can be picked: an item, a location, a resource, a faction and a face-down card are refused", () => {
  const g = hexapedeBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "rs", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const [key, why] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["rs", "a resource"],
    ["fd", "a face-down card (CR 411.1)"]
  ] as const) {
    refused(hexAttempt(g, [key, "c1", "c2", "c3", "f1", "f2"]), `picking ${why}`);
  }
  refused(() => actRaw(g.engine, P1, g.id("hx"), HEX, { victims: [g.engine.state.players[P2].factionId!, g.id("c1"), g.id("c2"), g.id("c3"), g.id("f1"), g.id("f2")] }), "picking a faction");
  assert.equal(zoneOf(g.engine, g.id("hx")), "play", "every refused attempt left the Hexapede in play");
  assert.equal(ready(g.engine), 7, "nothing was paid (6 Obsession and the extra resource)");
  hexAct(g);
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 6, "control: six real characters work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "only characters in play can be picked: characters in a hand, a discard pile or a deck are refused", () => {
  const g = hexapedeBoard({
    extra: [
      { key: "ihand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "idisc", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      { key: "ideck", def: character({ name: "In Deck" }), owner: P2, zone: "deck" }
    ]
  });
  for (const key of ["ihand", "idisc", "ideck"]) refused(hexAttempt(g, [key, "c1", "c2", "c3", "f1", "f2"]), `picking ${key}`);
  assert.equal(zoneOf(g.engine, g.id("hx")), "play");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "'Inflict 6 damage to each of the characters': a picked character with 7 life survives with 6 damage; one with 6 life is destroyed", () => {
  const g = hexapedeBoard({
    life: 9,
    extra: [
      { key: "l7", def: character({ name: "Seven Life", life: 7 }), owner: P2, zone: "play" },
      { key: "l6", def: character({ name: "Six Life", life: 6 }), owner: P2, zone: "play" },
      { key: "l5", def: character({ name: "Five Life", life: 5 }), owner: P1, zone: "play" }
    ]
  });
  hexAct(g, ["l7", "l6", "l5", "c1", "f1", "f2"]);
  assert.equal(zoneOf(g.engine, g.id("l7")), "play");
  assert.equal(g.engine.state.cards[g.id("l7")].damage, 6);
  assert.equal(zoneOf(g.engine, g.id("l6")), "discard", "6 damage on 6 life destroys it");
  assert.equal(zoneOf(g.engine, g.id("l5")), "discard");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "an unpicked character is untouched even though it could have been picked: no damage, still in play", () => {
  const g = hexapedeBoard({ life: 6 });
  hexAct(g);
  for (const key of ["c4", "f4"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} was not picked`);
    assert.equal(g.engine.state.cards[g.id(key)].damage, 0);
  }
  for (const key of HEX_VICTIMS) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} (6 life, picked) is destroyed`);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "'Inflict 6 damage to all factions': BOTH factions lose 6 influence (not only my opponent's)", () => {
  const g = hexapedeBoard({ inf1: 20, inf2: 25 });
  hexFully(g);
  assert.equal(influenceOf(g.engine, P1), 14, "my own faction takes 6 too");
  assert.equal(influenceOf(g.engine, P2), 19);
  assert.equal(g.engine.state.result, undefined);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a faction taken to 0 influence loses: with 6 influence I lose and my opponent (25) wins", () => {
  const g = hexapedeBoard({ inf1: 6, inf2: 25 });
  hexFully(g);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.equal(influenceOf(g.engine, P2), 19);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(HEXAPEDE, "0:ability:hellish-hex", "both factions taken to 0 at once is a draw (CR 102.2)", () => {
  const g = hexapedeBoard({ inf1: 6, inf2: 6 });
  hexFully(g);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.equal(influenceOf(g.engine, P2), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "draw", winners: [] });
});

clause(HEXAPEDE, "0:ability:hellish-hex", "influence stops at 0 (CR 410.4): 6 damage to a 4-influence faction leaves 0, not -2", () => {
  const g = hexapedeBoard({ inf1: 30, inf2: 4 });
  hexFully(g);
  assert.equal(influenceOf(g.engine, P2), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P1] });
});

// hands

clause(HEXAPEDE, "0:ability:hellish-hex", "each player picks 6 of THEIR OWN hand cards and they are removed from the game: the unpicked two stay in hand", () => {
  const g = hexapedeBoard();
  hexAct(g);
  const first = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(first.playerId, P1, "I pick my own cards first");
  const mine = handOf(g.engine, P1);
  const theirs = handOf(g.engine, P2);
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const zone = (pc.declaration as { selector: { zone: string } }).selector.zone;
    if (zone === "hand") return { kind: "chooserSelectsTarget", selected: handOf(g.engine, pc.playerId).slice(2, 8) };
    return { kind: "chooserSelectsTarget", selected: discardOf(g.engine, pc.playerId).slice(0, 6) };
  });
  assert.deepEqual(handOf(g.engine, P1), mine.slice(0, 2), "the two cards I did not pick stay in my hand");
  assert.deepEqual(handOf(g.engine, P2), theirs.slice(0, 2), "the two cards my opponent did not pick stay in theirs");
  for (const card of mine.slice(2, 8)) assert.equal(zoneOf(g.engine, card), "removed", "my picked hand card is removed from the game");
  for (const card of theirs.slice(2, 8)) assert.equal(zoneOf(g.engine, card), "removed", "their picked hand card is removed from the game");
  assert.ok(removedOf(g.engine, P1).includes(mine[2]), "removedOf(g.engine, P1).includes(mine[2])");
  assert.ok(removedOf(g.engine, P2).includes(theirs[2]), "removedOf(g.engine, P2).includes(theirs[2])");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "MY OPPONENT chooses which 6 of their hand cards are removed, not me", () => {
  const g = hexapedeBoard();
  hexAct(g);
  const askedFor: Array<{ player: string; zone: string }> = [];
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const zone = (pc.declaration as { selector: { zone: string } }).selector.zone;
    askedFor.push({ player: pc.playerId, zone });
    return removeFirst(g)(pc);
  });
  assert.ok(askedFor.some((a) => a.player === P2 && a.zone === "hand"), "my opponent was asked to pick from their hand");
  assert.ok(askedFor.some((a) => a.player === P1 && a.zone === "hand"), "I was asked to pick from mine");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player cannot remove cards from the OTHER player's hand: picking the opponent's hand cards is refused", () => {
  const g = hexapedeBoard();
  hexAct(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  const theirs = handOf(g.engine, P2).slice(0, 6);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: theirs }), "picking my opponent's hand cards");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c4"), ...handOf(g.engine, P1).slice(0, 5)] }), "picking a card in play");
  assert.ok(pending(g.engine), "the demand is still standing");
  answerPending(g.engine, "chooserSelectsTarget", { selected: handOf(g.engine, P1).slice(0, 6) });
  assert.equal(handOf(g.engine, P1).length, 2, "control: six of my own cards work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "removing 6 hand cards is mandatory: a player with 8 cards cannot decline or pick fewer than 6", () => {
  const none = hexapedeBoard();
  hexAct(none);
  expectPending(none.engine, "chooserSelectsTarget");
  refused(() => answerPending(none.engine, "chooserSelectsTarget", { selected: [] }), "removing none");
  assert.equal(handOf(none.engine, P1).length, 8, "nothing was removed by the refused answer");
  assert.ok(pending(none.engine), "the demand is still standing");
  const five = hexapedeBoard();
  hexAct(five);
  refused(() => answerPending(five.engine, "chooserSelectsTarget", { selected: handOf(five.engine, P1).slice(0, 5) }), "removing only five");
  assert.equal(handOf(five.engine, P1).length, 8);
  answerPending(five.engine, "chooserSelectsTarget", { selected: handOf(five.engine, P1).slice(0, 6) });
  assert.equal(handOf(five.engine, P1).length, 2, "control: six cards work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player cannot remove more than 6: seven picks are refused", () => {
  const g = hexapedeBoard();
  hexAct(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: handOf(g.engine, P1).slice(0, 7) }), "removing seven");
  assert.equal(handOf(g.engine, P1).length, 8);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player with exactly 6 hand cards loses all of them", () => {
  const g = hexapedeBoard({ hand1: 6, hand2: 6 });
  const mine = handOf(g.engine, P1);
  const theirs = handOf(g.engine, P2);
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(handOf(g.engine, P2).length, 0);
  for (const card of [...mine, ...theirs]) assert.equal(zoneOf(g.engine, card), "removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player with fewer than 6 hand cards removes all they have (CR 402.5): 3 cards -> 0", () => {
  const g = hexapedeBoard({ hand1: 3, hand2: 4 });
  const mine = handOf(g.engine, P1);
  const theirs = handOf(g.engine, P2);
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(handOf(g.engine, P1).length, 0, "all three of my cards were removed");
  assert.equal(handOf(g.engine, P2).length, 0, "all four of theirs");
  for (const card of [...mine, ...theirs]) assert.equal(zoneOf(g.engine, card), "removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player with an empty hand is not affected and nothing else breaks", () => {
  const g = hexapedeBoard({ hand1: 0, hand2: 0 });
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(influenceOf(g.engine, P1), 24, "the rest of the effect still happened");
  assert.equal(removedOf(g.engine, P1).length, 12, "6 discard + 6 deck");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "only the hand cards are removed from the game: my opponent's hand being larger or smaller does not change mine", () => {
  const g = hexapedeBoard({ hand1: 8, hand2: 2 });
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(handOf(g.engine, P1).length, 2, "I lost 6");
  assert.equal(handOf(g.engine, P2).length, 0, "they lost their 2");
});

// discard piles

clause(HEXAPEDE, "0:ability:hellish-hex", "each player picks 6 cards of their own discard pile and they are removed: of 7 cards one stays", () => {
  const g = hexapedeBoard({ disc1: 8, disc2: 7 });
  hexAct(g);
  const mineBefore = discardOf(g.engine, P1);
  const theirsBefore = discardOf(g.engine, P2);
  drain(g.engine, removeFirst(g));
  assert.equal(discardOf(g.engine, P1).length, 3, "my 8 + the Hexapede - 6");
  assert.equal(discardOf(g.engine, P2).length, 1, "their 7 - 6");
  assert.ok(mineBefore.length === 9 && theirsBefore.length === 7, "mineBefore.length === 9 && theirsBefore.length === 7");
  for (const card of mineBefore.slice(0, 6)) assert.equal(zoneOf(g.engine, card), "removed");
  for (const card of theirsBefore.slice(0, 6)) assert.equal(zoneOf(g.engine, card), "removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the removed discard cards must come from the player's own discard pile: the opponent's discard cards are refused", () => {
  const g = hexapedeBoard();
  hexAct(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: handOf(g.engine, P1).slice(0, 6) });
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "now my discard pile pick");
  assert.equal((pc.declaration as { selector: { zone: string } }).selector.zone, "discard");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: discardOf(g.engine, P2).slice(0, 6) }), "removing my opponent's discard cards");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: handOf(g.engine, P1).slice(0, 2) }), "removing hand cards instead");
  assert.ok(pending(g.engine), "the demand is still standing");
  answerPending(g.engine, "chooserSelectsTarget", { selected: discardOf(g.engine, P1).slice(0, 6) });
  assert.equal(discardOf(g.engine, P1).length, 2, "control: six of my own discard cards work");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "removing 6 discard-pile cards is mandatory: a player with 7+ cards there cannot decline or pick fewer than 6", () => {
  const none = hexapedeBoard();
  hexAct(none);
  answerPending(none.engine, "chooserSelectsTarget", { selected: handOf(none.engine, P1).slice(0, 6) });
  expectPending(none.engine, "chooserSelectsTarget");
  refused(() => answerPending(none.engine, "chooserSelectsTarget", { selected: [] }), "removing no discard cards");
  assert.ok(pending(none.engine), "the demand is still standing");
  const five = hexapedeBoard();
  hexAct(five);
  answerPending(five.engine, "chooserSelectsTarget", { selected: handOf(five.engine, P1).slice(0, 6) });
  refused(() => answerPending(five.engine, "chooserSelectsTarget", { selected: discardOf(five.engine, P1).slice(0, 5) }), "removing only five");
  assert.equal(discardOf(five.engine, P1).length, 8, "nothing was removed by the refused answers");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a player cannot remove more than 6 discard-pile cards: seven picks are refused", () => {
  const g = hexapedeBoard();
  hexAct(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: handOf(g.engine, P1).slice(0, 6) });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: discardOf(g.engine, P1).slice(0, 7) }), "removing seven");
  assert.equal(discardOf(g.engine, P1).length, 8);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the Hexapede itself is in its owner's discard pile by then and is one of the cards that can be removed from the game", () => {
  const g = hexapedeBoard({ disc1: 0, disc2: 0 });
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(zoneOf(g.engine, g.id("hx")), "removed", "with only the Hexapede in my discard pile, removing 'up to 6' removes it");
  assert.ok(removedOf(g.engine, P1).includes(g.id("hx")), "removedOf(g.engine, P1).includes(g.id(\"hx\"))");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the Hexapede may be left in the discard pile when I have more than 6 other cards there: I choose which 6", () => {
  const g = hexapedeBoard({ disc1: 7 });
  hexAct(g);
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const zone = (pc.declaration as { selector: { zone: string } }).selector.zone;
    if (zone === "discard" && pc.playerId === P1) return { kind: "chooserSelectsTarget", selected: discardOf(g.engine, P1).filter((c) => c !== g.id("hx")).slice(0, 6) };
    return removeFirst(g)(pc);
  });
  assert.equal(zoneOf(g.engine, g.id("hx")), "discard", "I chose to keep the Hexapede in the discard pile");
  assert.equal(discardOf(g.engine, P1).length, 2, "8 - 6");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "ordering: characters destroyed by the 6 damage are already in the discard pile when 'remove 6 cards in their discard pile' happens, so they are removed from the game", () => {
  const g = hexapedeBoard({
    life: 6,
    disc1: 0,
    disc2: 0
  });
  hexAct(g);
  drain(g.engine, removeFirst(g));
  for (const key of ["f1", "f2", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "removed", `${key}: destroyed by the damage, then removed from the discard pile`);
  for (const key of ["c1", "c2", "c3"]) assert.equal(zoneOf(g.engine, g.id(key)), "removed", `${key}: likewise`);
  assert.equal(zoneOf(g.engine, g.id("hx")), "removed", "and so is the Hexapede");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a discard pile with fewer than 6 cards is removed entirely (CR 402.5)", () => {
  const g = hexapedeBoard({ disc1: 2, disc2: 3 });
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(discardOf(g.engine, P1).length, 0, "my 2 cards and the Hexapede are all removed");
  assert.equal(discardOf(g.engine, P2).length, 0);
});

// decks

clause(HEXAPEDE, "0:ability:hellish-hex", "both players remove the TOP 6 cards of their deck from the game, the rest of each deck stays in order", () => {
  const g = hexapedeBoard();
  const mine = deckOf(g.engine, P1);
  const theirs = deckOf(g.engine, P2);
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.deepEqual(deckOf(g.engine, P1), mine.slice(6), "my deck: the top 6 are gone, cards 7-10 remain in order");
  assert.deepEqual(deckOf(g.engine, P2), theirs.slice(6), "their deck likewise");
  for (const card of mine.slice(0, 6)) assert.equal(zoneOf(g.engine, card), "removed");
  for (const card of theirs.slice(0, 6)) assert.equal(zoneOf(g.engine, card), "removed");
  assert.ok(removedOf(g.engine, P1).includes(mine[0]), "removedOf(g.engine, P1).includes(mine[0])");
  assert.ok(removedOf(g.engine, P2).includes(theirs[5]), "removedOf(g.engine, P2).includes(theirs[5])");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the deck cards are removed from the game, not discarded: they are not in the discard pile", () => {
  const g = hexapedeBoard({ disc1: 0, disc2: 0, deck1: 6, deck2: 6 });
  const mine = deckOf(g.engine, P1);
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(deckOf(g.engine, P1).length, 0);
  for (const card of mine) {
    assert.equal(zoneOf(g.engine, card), "removed");
    assert.equal(discardOf(g.engine, P1).includes(card), false);
  }
});

clause(HEXAPEDE, "0:ability:hellish-hex", "a deck with fewer than 6 cards loses all of them and a player with no deck is fine (no loss for failing to remove)", () => {
  const g = hexapedeBoard({ deck1: 3, deck2: 0 });
  const mine = deckOf(g.engine, P1);
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(deckOf(g.engine, P1).length, 0);
  for (const card of mine) assert.equal(zoneOf(g.engine, card), "removed");
  assert.equal(g.engine.state.result, undefined);
  assert.equal(influenceOf(g.engine, P2), 24, "the rest of the effect still happened");
});

// timing / who can use it

clause(HEXAPEDE, "0:ability:hellish-hex", "a character may use its abilities the turn it enters play (CR 204.3a): a Hexapede that cannot attack yet can still use it", () => {
  const g = hexapedeBoard({ eligible: false });
  hexFully(g);
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "can only be used from play: refused while the Hexapede is in my hand or in my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = hexapedeBoard({ hx: zone });
    refused(hexAttempt(bad), `from ${zone}`);
    assert.equal(bad.engine.state.cards[bad.id("c1")].damage, 0);
    assert.equal(ready(bad.engine), 6, "nothing was paid");
  }
});

clause(HEXAPEDE, "0:ability:hellish-hex", "only its controller can use it: my opponent cannot activate my Hexapede", () => {
  const g = hexapedeBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ obsession: 6 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(hexAttempt(g, HEX_VICTIMS, P2), "the opponent using my Hexapede", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(zoneOf(g.engine, g.id("hx")), "play");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "can be used in response on the opponent's turn (it is an ability, CR 502.3)", () => {
  const g = hexapedeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }] });
  refused(hexAttempt(g), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "the defender holds priority");
  hexAct(g);
  drain(g.engine, removeFirst(g));
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 6);
  assert.equal(influenceOf(g.engine, P1), 24);
  assert.equal(influenceOf(g.engine, P2), 24);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "(CR 402.2) used on the opponent's turn, the ACTIVE player makes the 'both players' picks first", () => {
  const g = hexapedeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  hexAct(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the active player (my opponent) acts first when both players must act");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the six picks are fixed when the ability is used: a picked character destroyed in response takes nothing and the other five still take 6", () => {
  const g = hexapedeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  hexAttempt(g)();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("f1")] });
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard", "control: destroyed in response");
  drain(g.engine, removeFirst(g));
  for (const key of ["c1", "c2", "c3", "f2", "f3"]) assert.equal(g.engine.state.cards[g.id(key)].damage, 6, `${key} still took 6`);
  assert.equal(influenceOf(g.engine, P1), 24, "the rest of the effect still happened");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "the ability resolves as written even though the Hexapede is already gone (CR 502.4): it is not terminated by having been destroyed as a cost", () => {
  const g = hexapedeBoard();
  hexFully(g);
  assert.ok(zoneOf(g.engine, g.id("hx")) === "discard" || zoneOf(g.engine, g.id("hx")) === "removed", "zoneOf(g.engine, g.id(\"hx\")) === \"discard\" || zoneOf(g.engine, g.id(\"hx\")) === \"removed\"");
  assert.equal(influenceOf(g.engine, P2), 24);
});

// =================================================================================
// Imperial Thaumaturge
// TICKLE -- COST: Pay 1. Deplete this card. -- EFFECT: Your opponent discards a card.
// Character (wizard), cost 6, [O][O], 4 strength / 3 speed / 5 life.
// =================================================================================

const THAUMATURGE = "e2126c92-6654-406e-9bcc-c2682df3696f";

function thaumaturgeBoard(
  opts: { icons?: Icons; depleted?: boolean; th?: "play" | "hand" | "discard"; eligible?: boolean; oppHand?: number; myHand?: number; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}
) {
  return devBoard(
    [
      { key: "th", def: printing(THAUMATURGE), owner: P1, zone: opts.th ?? "play", depleted: opts.depleted, attackEligible: opts.eligible },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      ...fillers("mh", opts.myHand ?? 2, P1, "hand"),
      ...fillers("od", 2, P2, "deck"),
      ...fillers("md", 2, P1, "deck"),
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ThGame = ReturnType<typeof thaumaturgeBoard>;
const tickle = (g: ThGame) => activate(g.engine, P1, g.id("th"), "tickle");
const tickleAttempt = (g: ThGame, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("th"), "tickle");

/** Asserts my opponent is asked to discard (their choice), answers with `cardId`, and returns once the choice is gone. */
function opponentDiscards(engine: SpoilsEngine, cardId: CardInstanceId): void {
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses which card they discard");
  answerPending(engine, "chooserSelectsTarget", { selected: [cardId] });
  assert.equal(engine.state.pendingChoice, undefined);
}

clause(THAUMATURGE, "0:ability:tickle", "my opponent discards a card of THEIR choice: exactly that card goes from their hand to their discard pile", () => {
  const g = thaumaturgeBoard();
  tickle(g);
  opponentDiscards(g.engine, g.id("oh1"));
  assert.deepEqual(handOf(g.engine, P2), [g.id("oh0"), g.id("oh2")], "exactly the chosen card left their hand");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("oh1")], "...and is in their discard pile");
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard");
});

clause(THAUMATURGE, "0:ability:tickle", "the opponent may choose any card in their hand (the first, the middle or the last)", () => {
  for (const key of ["oh0", "oh2"]) {
    const g = thaumaturgeBoard();
    tickle(g);
    opponentDiscards(g.engine, g.id(key));
    assert.equal(zoneOf(g.engine, g.id(key)), "discard");
    assert.equal(handOf(g.engine, P2).length, 2);
  }
});

clause(THAUMATURGE, "0:ability:tickle", "exactly ONE card is discarded: a hand of 3 becomes 2", () => {
  const g = thaumaturgeBoard();
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 2);
  assert.equal(discardOf(g.engine, P2).length, 1);
});

clause(THAUMATURGE, "0:ability:tickle", "the discard is mandatory: the opponent cannot decline by picking nothing", () => {
  const g = thaumaturgeBoard();
  tickle(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining the discard");
  assert.ok(pending(g.engine), "the demand is still standing");
  assert.equal(handOf(g.engine, P2).length, 3);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(THAUMATURGE, "0:ability:tickle", "the opponent cannot discard two cards, nor a card that is not in their hand", () => {
  const g = thaumaturgeBoard();
  tickle(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] }), "two cards");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] }), "a card in play");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "a card from MY hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("od0")] }), "a card in their deck");
  assert.equal(handOf(g.engine, P2).length, 3);
  assert.equal(zoneOf(g.engine, g.id("mh0")), "hand");
  opponentDiscards(g.engine, g.id("oh2"));
  assert.equal(handOf(g.engine, P2).length, 2, "control: a legal discard works");
});

clause(THAUMATURGE, "0:ability:tickle", "my own hand, deck and board are not affected", () => {
  const g = thaumaturgeBoard();
  const mine = handOf(g.engine, P1);
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.deepEqual(handOf(g.engine, P1), mine, "my hand is untouched");
  assert.equal(discardOf(g.engine, P1).length, 0);
  assert.equal(deckOf(g.engine, P1).length, 2);
  assert.equal(deckOf(g.engine, P2).length, 2);
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(THAUMATURGE, "0:ability:tickle", "an opponent with exactly one card in hand discards it", () => {
  const g = thaumaturgeBoard({ oppHand: 1 });
  tickle(g);
  if (pending(g.engine)) opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 0);
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
});

clause(THAUMATURGE, "0:ability:tickle", "an opponent with no cards in hand discards nothing, and the cost is still paid", () => {
  const g = thaumaturgeBoard({ oppHand: 0 });
  const before = ready(g.engine);
  tickle(g);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing to discard, nothing to ask");
  assert.equal(discardOf(g.engine, P2).length, 0);
  assert.equal(before - ready(g.engine), 1, "Pay 1 was paid");
  assert.equal(g.engine.state.cards[g.id("th")].depleted, true);
});

clause(THAUMATURGE, "0:ability:tickle", "COST: Pay 1 -- exactly one resource is paid (with 3 ready, 2 stay)", () => {
  const g = thaumaturgeBoard();
  const before = ready(g.engine);
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(before - ready(g.engine), 1);
});

clause(THAUMATURGE, "0:ability:tickle", "COST: Pay 1 -- with no ready resource it is refused and nothing is depleted; with exactly one it works", () => {
  const bad = thaumaturgeBoard({ icons: {} });
  refused(tickleAttempt(bad), "no resource to pay");
  assert.equal(bad.engine.state.cards[bad.id("th")].depleted, false);
  assert.equal(handOf(bad.engine, P2).length, 3);
  const spent = devBoard([
    { key: "th", def: printing(THAUMATURGE), owner: P1, zone: "play" },
    { key: "oh0", def: character({ name: "Opp Card" }), owner: P2, zone: "hand" },
    ...res({ greed: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
  refused(() => actRaw(spent.engine, P1, spent.id("th"), "tickle"), "only spent resources");
  const good = thaumaturgeBoard({ icons: { greed: 1 } });
  tickle(good);
  opponentDiscards(good.engine, good.id("oh0"));
  assert.equal(good.engine.state.cards[good.id("th")].depleted, true, "control: one resource is enough");
});

clause(THAUMATURGE, "0:ability:tickle", "the ability has no threshold of its own: any resource icon pays for it", () => {
  const g = thaumaturgeBoard({ icons: { rage: 1 } });
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
});

clause(THAUMATURGE, "0:ability:tickle", "COST: Deplete this card -- the Thaumaturge ends depleted, and a depleted one cannot use it (nothing is paid)", () => {
  const good = thaumaturgeBoard();
  tickle(good);
  opponentDiscards(good.engine, good.id("oh0"));
  assert.equal(good.engine.state.cards[good.id("th")].depleted, true);
  const bad = thaumaturgeBoard({ depleted: true });
  refused(tickleAttempt(bad), "already depleted");
  assert.equal(handOf(bad.engine, P2).length, 3);
  assert.equal(ready(bad.engine), 3, "nothing was paid");
});

clause(THAUMATURGE, "0:ability:tickle", "once per untap: a second use the same turn is refused, and it is usable again on my next turn", () => {
  const g = thaumaturgeBoard({ icons: { greed: 3 } });
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  refused(tickleAttempt(g), "depleted now");
  assert.equal(handOf(g.engine, P2).length, 2);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("th")].depleted, false, "restored at the start of my turn");
  tickle(g);
  opponentDiscards(g.engine, g.id("oh1"));
  assert.equal(handOf(g.engine, P2).length, 1, "discarded again");
});

clause(THAUMATURGE, "0:ability:tickle", "a character may use its abilities the turn it enters play (CR 204.3a)", () => {
  const g = thaumaturgeBoard({ eligible: false });
  tickle(g);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
});

clause(THAUMATURGE, "0:ability:tickle", "can only be used from play: refused while the Thaumaturge is in my hand or in my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = thaumaturgeBoard({ th: zone });
    refused(tickleAttempt(bad), `from ${zone}`);
    assert.equal(handOf(bad.engine, P2).length, 3);
    assert.equal(ready(bad.engine), 3);
  }
});

clause(THAUMATURGE, "0:ability:tickle", "only its controller can use it: my opponent cannot activate my Thaumaturge", () => {
  const g = thaumaturgeBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ greed: 2 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(tickleAttempt(g, P2), "the opponent using my Thaumaturge", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(g.engine.state.cards[g.id("th")].depleted, false);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(THAUMATURGE, "0:ability:tickle", "can be used in response on the opponent's turn (CR 502.3): the opponent still discards", () => {
  const g = thaumaturgeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(tickleAttempt(g), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("th"), "tickle");
  resolvePendingResponses(g.engine);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(THAUMATURGE, "0:ability:tickle", "the costs are paid when the ability is used, before the opponent can respond; the discard happens only when it resolves", () => {
  const g = thaumaturgeBoard();
  const before = ready(g.engine);
  tickleAttempt(g)();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 1);
  assert.equal(g.engine.state.cards[g.id("th")].depleted, true);
  assert.equal(handOf(g.engine, P2).length, 3, "nothing discarded yet");
  assert.equal(g.engine.state.pendingChoice, undefined);
  resolvePendingResponses(g.engine);
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(THAUMATURGE, "0:ability:tickle", "the discard is judged when it resolves: an opponent who plays their only card in response has nothing left to discard", () => {
  const reply = tactic({ name: "Reply", cost: 0, behavior: { abilities: [{ id: "rp", type: "activated", effects: [] }] } });
  const g = thaumaturgeBoard({ oppHand: 0, extra: [{ key: "reply", def: reply, owner: P2, zone: "hand" }] });
  tickleAttempt(g)();
  respondWith(g.engine, P2, g.id("reply"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no card left to discard, so nobody is asked");
  assert.equal(handOf(g.engine, P2).length, 0);
  assert.deepEqual(discardOf(g.engine, P2), [g.id("reply")], "only the played tactic is in their discard pile");
});

clause(THAUMATURGE, "0:ability:tickle", "the ability resolves as written even if the Thaumaturge is destroyed in response (CR 502.4)", () => {
  const g = thaumaturgeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  tickleAttempt(g)();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("th")] });
  assert.equal(zoneOf(g.engine, g.id("th")), "discard", "control: destroyed in response");
  opponentDiscards(g.engine, g.id("oh0"));
  assert.equal(handOf(g.engine, P2).length, 2, "4 cards - the Kill they played - the one they discarded");
});

// =================================================================================
// Inadequate Wand
// PRESENT THE STAFF -- COST: Pay 2. Deplete this card. Pick a character you control. --
// EFFECT: Put the character into its owner's hand if you can. If you do, X is its numeric
// cost. You may search your deck for a tactic with numeric cost X or less and reveal it.
// If you do, put it into your hand.
// Item, cost 2, [O][O].
// =================================================================================

const WAND = "4bbe221f-8085-43fe-b1a7-70c332d10958";
const STAFF = "present-the-staff";

/** A deterministic random source (mulberry32) so every shuffle / random pick in a test is reproducible. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wandBoard(
  opts: {
    icons?: Icons;
    depleted?: boolean;
    wand?: "play" | "hand" | "discard";
    random?: () => number;
    extra?: CardPlacement[];
    deckTactics?: number[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const costs = opts.deckTactics ?? [0, 1, 2, 3, 4, 5];
  return devBoard(
    [
      { key: "wand", def: printing(WAND), owner: P1, zone: opts.wand ?? "play", depleted: opts.depleted },
      { key: "c0", def: character({ name: "Cost Zero", cost: 0 }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Cost Three", cost: 3 }), owner: P1, zone: "play" },
      { key: "c5", def: character({ name: "Cost Five", cost: 5, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 2 }), owner: P2, zone: "play" },
      { key: "captured", def: character({ name: "Captured", cost: 4 }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent Out", cost: 4 }), owner: P1, controller: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing", cost: 1 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 1 }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", cost: 1 }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "In Discard", cost: 1 }), owner: P1, zone: "discard" },
      // my deck: tactics of every cost, plus things that are not tactics
      ...costs.map((cost) => ({ key: `t${cost}`, def: tactic({ name: `Tactic ${cost}`, cost }), owner: P1, zone: "deck" as const })),
      { key: "dchar", def: character({ name: "Deck Character", cost: 0 }), owner: P1, zone: "deck" },
      { key: "ditem", def: item({ name: "Deck Item", cost: 0 }), owner: P1, zone: "deck" },
      { key: "oppTac", def: tactic({ name: "Their Tactic", cost: 0 }), owner: P2, zone: "deck" },
      { key: "handTac", def: tactic({ name: "Hand Tactic", cost: 0 }), owner: P1, zone: "hand" },
      { key: "discTac", def: tactic({ name: "Discard Tactic", cost: 0 }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: opts.random ?? mulberry(2024) }
  );
}

type WandGame = ReturnType<typeof wandBoard>;
const staff = (g: WandGame, pick: CardInstanceId) => activate(g.engine, P1, g.id("wand"), STAFF, { selected: { char: [pick] } });
const staffAttempt = (g: WandGame, pick?: CardInstanceId, player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("wand"), STAFF, pick ? { char: [pick] } : {});
/** Uses the staff on `pick`, and answers the search prompt with `found` (undefined = find nothing). */
function staffFinding(g: WandGame, pick: CardInstanceId, found?: CardInstanceId): void {
  staff(g, pick);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search my own deck");
  answerPending(g.engine, "chooserSelectsTarget", { selected: found ? [found] : [] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

const revealsIn = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

clause(WAND, "0:ability:present-the-staff", "puts the picked character into its owner's hand, then I search for a tactic of cost X or less (X = 3) and put it into my hand", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand", "the character is back in hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("c3")), "handOf(g.engine, P1).includes(g.id(\"c3\"))");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand", "the found tactic is in my hand (not played)");
  assert.equal(g.engine.state.cards[g.id("c3")].damage, 0);
});

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 and Deplete this card -- exactly two resources are paid and the Wand is depleted", () => {
  const g = wandBoard();
  const before = ready(g.engine);
  staff(g, g.id("c3"));
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("wand")), "play", "the Wand stays in play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
});

clause(WAND, "0:ability:present-the-staff", "X is the character's numeric cost: with cost 3, tactics of cost 0, 1, 2 and 3 can be found", () => {
  for (const cost of [0, 1, 2, 3]) {
    const g = wandBoard();
    staffFinding(g, g.id("c3"), g.id(`t${cost}`));
    assert.equal(zoneOf(g.engine, g.id(`t${cost}`)), "hand", `a cost-${cost} tactic is found with X = 3`);
  }
});

clause(WAND, "0:ability:present-the-staff", "a tactic with a numeric cost above X cannot be found: with X = 3 the cost-4 and cost-5 tactics are refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t4")] }), "a cost-4 tactic");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t5")] }), "a cost-5 tactic");
  assert.equal(zoneOf(g.engine, g.id("t4")), "deck");
  assert.ok(pending(g.engine), "the search is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand", "control: a cost-3 tactic is found");
});

clause(WAND, "0:ability:present-the-staff", "X changes with the character: a cost-5 character lets me find the cost-5 tactic", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c5"), g.id("t5"));
  assert.equal(zoneOf(g.engine, g.id("t5")), "hand");
  assert.equal(zoneOf(g.engine, g.id("c5")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "X = 0 (a cost-0 character): only a cost-0 tactic can be found, the cost-1 tactic is refused", () => {
  const g = wandBoard();
  staff(g, g.id("c0"));
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t1")] }), "a cost-1 tactic with X = 0");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0")] });
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand", "control: the cost-0 tactic is found");
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "only TACTICS can be found: a character or an item in my deck is refused even at cost 0", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dchar")] }), "a character card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ditem")] }), "an item card");
  assert.equal(zoneOf(g.engine, g.id("dchar")), "deck");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(WAND, "0:ability:present-the-staff", "the search is of MY deck only: a tactic in my hand, my discard pile or my opponent's deck is refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("handTac")] }), "a tactic in my hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("discTac")] }), "a tactic in my discard pile");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oppTac")] }), "a tactic in my opponent's deck");
  assert.equal(zoneOf(g.engine, g.id("oppTac")), "deck");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(WAND, "0:ability:present-the-staff", "'a tactic': at most one card is found; two tactics are refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t1"), g.id("t2")] }), "two tactics");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t2")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "'You may search': I can decline to find anything; the character still goes to my hand and no tactic is added", () => {
  const g = wandBoard();
  const handBefore = handOf(g.engine, P1).length;
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "only the character was added to my hand");
  for (const key of ["t0", "t1", "t2", "t3", "t4", "t5"]) assert.equal(zoneOf(g.engine, g.id(key)), "deck", `${key} stays in the deck`);
});

clause(WAND, "0:ability:present-the-staff", "a deck with no tactic of cost X or less: the character still goes to my hand and nothing is found", () => {
  const g = wandBoard({ deckTactics: [4, 5] });
  staff(g, g.id("c3"));
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t4")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t5")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "the found tactic is revealed (the reveal is recorded for my opponent to see)", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t2"));
  const reveals = revealsIn(g.engine);
  assert.ok(reveals.some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(g.id("t2"))), "a reveal of the found tactic was recorded");
});

clause(WAND, "0:ability:present-the-staff", "the deck is shuffled after the search (CR 312.1): the resulting order depends on the random source", () => {
  const rotating = wandBoard({ random: () => 0 });
  const identity = wandBoard({ random: () => 0.9999999 });
  staffFinding(rotating, rotating.id("c3"), rotating.id("t3"));
  staffFinding(identity, identity.id("c3"), identity.id("t3"));
  const names = (g: WandGame) => deckOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.deepEqual([...names(rotating)].sort(), [...names(identity)].sort(), "same cards left in the deck");
  assert.notDeepEqual(names(rotating), names(identity), "...but in an order that depends on the random source: the deck was shuffled");
});

clause(WAND, "0:ability:present-the-staff", "the deck is also shuffled when the search finds nothing (CR 312.1: a searched deck is shuffled)", () => {
  const rotating = wandBoard({ random: () => 0 });
  const identity = wandBoard({ random: () => 0.9999999 });
  staffFinding(rotating, rotating.id("c3"));
  staffFinding(identity, identity.id("c3"));
  const names = (g: WandGame) => deckOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.notDeepEqual(names(rotating), names(identity), "the deck order depends on the random source: it was shuffled");
});

clause(WAND, "0:ability:present-the-staff", "'its owner's hand': a character I control but my opponent owns goes to ITS OWNER's hand, and X is its cost (4)", () => {
  const g = wandBoard();
  staff(g, g.id("captured"));
  expectPending(g.engine, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t4")] });
  assert.equal(zoneOf(g.engine, g.id("captured")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("captured")), "in its owner's (my opponent's) hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("captured")), false);
  assert.equal(zoneOf(g.engine, g.id("t4")), "hand", "a cost-4 tactic is findable with X = 4");
  assert.ok(handOf(g.engine, P1).includes(g.id("t4")), "the found tactic goes into MY hand");
});

clause(WAND, "0:ability:present-the-staff", "the returned character leaves play undamaged and undepleted", () => {
  const g = wandBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", cost: 1, life: 9 }), owner: P1, zone: "play", damage: 4, depleted: true }] });
  staffFinding(g, g.id("hurt"));
  assert.equal(zoneOf(g.engine, g.id("hurt")), "hand");
  assert.equal(g.engine.state.cards[g.id("hurt")].damage, 0);
  assert.equal(g.engine.state.cards[g.id("hurt")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "an item attached to the picked character follows it to its owner's hand (CR 301.4a), it is not sent to the discard pile", () => {
  const gear = item({ name: "Gear", attachTo: "character", behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] } });
  const g = wandBoard({ extra: [{ key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "c3" }] });
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("gear")), "hand", "attached cards leave play the same way the host does: into its owner's hand");
});

clause(WAND, "0:ability:present-the-staff", "only the picked character moves: every other card in play stays", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t1"));
  for (const key of ["c0", "c5", "foe", "captured", "lent", "thing", "place", "wand"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

// picks

clause(WAND, "0:ability:present-the-staff", "cannot pick my opponent's character, nor one I own but my opponent controls; nothing is paid", () => {
  const g = wandBoard();
  refused(staffAttempt(g, g.id("foe")), "an opponent's character");
  refused(staffAttempt(g, g.id("lent")), "my character under their control");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  assert.equal(ready(g.engine), 4, "nothing was paid");
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand", "control: my own character works");
});

clause(WAND, "0:ability:present-the-staff", "only characters: an item, a location, a faction and a face-down card are refused", () => {
  const g = wandBoard({ extra: [{ key: "fd", def: character({ name: "Hidden", cost: 2 }), owner: P1, zone: "play", faceDown: true }] });
  refused(staffAttempt(g, g.id("thing")), "an item");
  refused(staffAttempt(g, g.id("place")), "a location");
  refused(staffAttempt(g, g.id("wand")), "the Wand itself");
  refused(staffAttempt(g, g.engine.state.players[P1].factionId!), "my faction");
  refused(staffAttempt(g, g.id("fd")), "a face-down card");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  assert.equal(ready(g.engine), 5, "nothing was paid (4 resources and the face-down card)");
});

clause(WAND, "0:ability:present-the-staff", "only characters in play: a character in my hand or my discard pile is refused", () => {
  const g = wandBoard();
  refused(staffAttempt(g, g.id("inHand")), "a character in my hand");
  refused(staffAttempt(g, g.id("inDisc")), "a character in my discard pile");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "needs exactly one pick: none or two are refused", () => {
  const g = wandBoard();
  refused(staffAttempt(g), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("wand"), STAFF, { char: [g.id("c3"), g.id("c5")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("c3")), "play");
  assert.equal(zoneOf(g.engine, g.id("c5")), "play");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
});

// costs

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 -- one ready resource is refused (nothing depleted), exactly two work", () => {
  const short = wandBoard({ icons: { greed: 1 } });
  refused(staffAttempt(short, short.id("c3")), "1 resource for Pay 2");
  assert.equal(short.engine.state.cards[short.id("wand")].depleted, false);
  assert.equal(zoneOf(short.engine, short.id("c3")), "play");
  assert.equal(ready(short.engine), 1);
  const exact = wandBoard({ icons: { greed: 2 } });
  staffFinding(exact, exact.id("c3"));
  assert.equal(zoneOf(exact.engine, exact.id("c3")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 -- resources already spent do not count (3 resources, 2 attached: refused)", () => {
  const bad = wandBoard({ icons: { greed: 1 }, extra: res({ greed: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(staffAttempt(bad, bad.id("c3")), "only 1 ready");
  assert.equal(bad.engine.state.cards[bad.id("wand")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "the ability has no threshold of its own: two resources of any icon pay for it", () => {
  const g = wandBoard({ icons: { rage: 2 } });
  staffFinding(g, g.id("c3"), g.id("t3"));
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "COST: Deplete this card -- a depleted Wand cannot use it (nothing is paid), and one use depletes it", () => {
  const bad = wandBoard({ depleted: true });
  refused(staffAttempt(bad, bad.id("c3")), "the Wand is depleted");
  assert.equal(ready(bad.engine), 4);
  assert.equal(zoneOf(bad.engine, bad.id("c3")), "play");
  const good = wandBoard();
  staffFinding(good, good.id("c3"));
  refused(staffAttempt(good, good.id("c5")), "depleted after one use");
});

clause(WAND, "0:ability:present-the-staff", "the Wand untaps at the start of my next turn and can be used again", () => {
  const g = wandBoard({ icons: { greed: 2 } });
  staffFinding(g, g.id("c3"));
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  staffFinding(g, g.id("c5"));
  assert.equal(zoneOf(g.engine, g.id("c5")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "can only be used from play: refused while the Wand is in my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = wandBoard({ wand: zone });
    refused(staffAttempt(bad, bad.id("c3")), `from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("c3")), "play");
    assert.equal(ready(bad.engine), 4);
  }
});

clause(WAND, "0:ability:present-the-staff", "only its controller can use it: my opponent cannot activate my Wand", () => {
  const g = wandBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ greed: 2 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(staffAttempt(g, g.id("foe"), P2), "the opponent using my Wand", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(WAND, "0:ability:present-the-staff", "can be used in response on the opponent's turn (it is an ability, CR 502.3)", () => {
  const g = wandBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(staffAttempt(g, g.id("c3")), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("wand"), STAFF, { char: [g.id("c3")] });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "the costs (pay, deplete, pick) are paid when the ability is used, before the opponent can respond; the character moves only when it resolves", () => {
  const g = wandBoard();
  staffAttempt(g, g.id("c3"))();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("c3")), "play", "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "'Put the character into its owner's hand IF YOU CAN. If you do, ...': a picked character destroyed in response stays in the discard pile and X is not set, so no search is offered", () => {
  const g = wandBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  staffAttempt(g, g.id("c3"))();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("c3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "discard", "destroyed in response: it cannot be put into a hand from the discard pile (CR 402.4)");
  assert.equal(g.engine.state.pendingChoice, undefined, "the character was not put into a hand, so 'if you do' fails and there is no search");
  assert.equal(zoneOf(g.engine, g.id("t3")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "the ability resolves as written even if the Wand is destroyed or leaves play in response (CR 502.4)", () => {
  const g = wandBoard({ extra: [{ key: "mover", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
  staffAttempt(g, g.id("c3"))();
  respondWith(g.engine, P2, g.id("mover"), { t: [g.id("wand")] });
  assert.equal(zoneOf(g.engine, g.id("wand")), "hand", "control: the Wand left play in response");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

// =================================================================================
// Manifest
// COST: Reveal a face-down tactic you control. -- EFFECT: You may play the tactic. Draw a
// card.
// While this card is in your discard pile, if a card that provides at least [O] enters
// play under your control, you may pay 2. If you do, put this card into play under your
// control as a face-down resource.
// FLIP UP: 1 [O]
// Tactic, cost 1, [O].
// =================================================================================

const MANIFEST = "c60f04b2-f629-4183-8daf-9219af91bb4a";
const MINION = "dfaf62e3-40f4-4020-940f-bf82b2a48850";

/** A tactic that deals 3 damage to the opponent's faction (so "it was played" shows as -3 influence); `pick` adds a character pick (id "t"). */
function hiddenTactic(opts: { cost?: number; threshold?: string; name?: string; pick?: boolean } = {}): CardDefinition {
  return tactic({
    name: opts.name ?? "Hidden Tactic",
    cost: opts.cost ?? 0,
    threshold: opts.threshold ?? 0,
    behavior: {
      abilities: [
        {
          id: "hid",
          type: "activated",
          ...(opts.pick ? { targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }] } : {}),
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 }]
        }
      ]
    }
  });
}

function manifestBoard(
  opts: {
    man?: "hand" | "discard" | "faceDown" | "faceUp" | "deck";
    icons?: Icons;
    hidden?: CardDefinition;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    deck?: number;
    random?: () => number;
    hidSpent?: boolean;
  } = {}
) {
  const where = opts.man ?? "hand";
  return devBoard(
    [
      {
        key: "man",
        def: printing(MANIFEST),
        owner: P1,
        zone: where === "faceDown" || where === "faceUp" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined
      },
      { key: "hid", def: opts.hidden ?? hiddenTactic(), owner: P1, zone: "play", faceDown: true, attachedToKey: opts.hidSpent ? "__factionA" : undefined },
      { key: "hid2", def: hiddenTactic({ name: "Second Hidden Tactic" }), owner: P1, zone: "play", faceDown: true },
      { key: "fdChar", def: character({ name: "Hidden Character" }), owner: P1, zone: "play", faceDown: true },
      { key: "foeHid", def: hiddenTactic({ name: "Their Hidden Tactic" }), owner: P2, zone: "play", faceDown: true },
      { key: "capHid", def: hiddenTactic({ name: "Captured Hidden Tactic" }), owner: P2, controller: P1, zone: "play", faceDown: true },
      { key: "lentHid", def: hiddenTactic({ name: "Lent Hidden Tactic" }), owner: P1, controller: P2, zone: "play", faceDown: true },
      { key: "handTac", def: hiddenTactic({ name: "Tactic In Hand" }), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...fillers("dk", opts.deck ?? 3, P1, "deck"),
      ...res(opts.icons ?? { obsession: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: opts.random ?? mulberry(99) }
  );
}

type ManifestGame = ReturnType<typeof manifestBoard>;

/** Plays Manifest revealing `pick` (stops at the first pending choice). */
const manifest = (g: ManifestGame, pick: CardInstanceId) => play(g.engine, P1, g.id("man"), { selected: { rev: [pick] } });
const manifestAttempt = (g: ManifestGame, pick?: CardInstanceId) => () => playRaw(g.engine, P1, g.id("man"), { selected: pick ? { rev: [pick] } : {} });
/** Answers the "may play the tactic" prompt: play it (optionally with its own picks) or decline. */
function manifestPlays(g: ManifestGame, cardId: CardInstanceId | undefined, selected: Record<string, CardInstanceId[]> = {}): void {
  const pc = expectPending(g.engine, "deployForFree");
  assert.equal(pc.playerId, P1);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", ...(cardId ? { cardId, selected } : {}) } } as never);
  resolvePendingResponses(g.engine);
}

clause(MANIFEST, "0:ability", "reveals a face-down tactic I control; I may play it, and then I draw a card: the tactic's effect happens and Manifest ends in my discard pile", () => {
  const g = manifestBoard();
  const top = deckOf(g.engine, P1)[0];
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P2), 27, "the revealed tactic was played: 3 damage to their faction");
  assert.equal(zoneOf(g.engine, g.id("hid")), "discard", "the played tactic resolved into its owner's discard pile");
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, false);
  assert.equal(zoneOf(g.engine, top), "hand", "EFFECT: Draw a card");
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "0:ability", "COST: the Manifest costs 1 itself (its cost number)", () => {
  const g = manifestBoard({ icons: { obsession: 5 } });
  const before = ready(g.engine);
  manifestAttempt(g, g.id("hid"))();
  assert.equal(before - ready(g.engine), 1, "the printed cost of 1 is paid when it is played");
});

clause(MANIFEST, "0:ability", "'You may play the tactic': declining leaves it face-down in play (still a resource), and the card is still drawn", () => {
  const g = manifestBoard();
  const top = deckOf(g.engine, P1)[0];
  manifest(g, g.id("hid"));
  manifestPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("hid")), "play");
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true, "still face-down");
  assert.equal(influenceOf(g.engine, P2), 30, "its effect did not happen");
  assert.equal(zoneOf(g.engine, top), "hand", "Draw a card is not part of the 'may'");
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "0:ability", "'Draw a card' draws exactly one card: the top of the deck, whether or not the tactic is played", () => {
  const g = manifestBoard({ deck: 3 });
  const [top, second, third] = deckOf(g.engine, P1);
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.deepEqual(deckOf(g.engine, P1), [second, third]);
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(MANIFEST, "0:ability", "with an empty deck the failed draw costs nothing (CR 306.2) and the rest still happens", () => {
  const g = manifestBoard({ deck: 0 });
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27);
  assert.equal(g.engine.state.result, undefined);
});

clause(MANIFEST, "0:ability", "once played, the revealed tactic is no longer a face-down resource: it stops providing Volition", () => {
  const g = manifestBoard();
  const before = g.engine.getThresholds(P1).volition ?? 0;
  assert.equal(g.engine.isResource(g.id("hid")), true, "control: it is a resource while face-down");
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, before - 1);
  assert.equal(g.engine.isResource(g.id("hid")), false);
});

clause(MANIFEST, "0:ability", "only the revealed tactic is played: another face-down tactic stays face-down", () => {
  const g = manifestBoard();
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(zoneOf(g.engine, g.id("hid2")), "play");
  assert.equal(g.engine.state.cards[g.id("hid2")].faceDown, true);
  assert.equal(influenceOf(g.engine, P2), 27, "exactly one tactic was played");
});

clause(MANIFEST, "0:ability", "'You may play the tactic' (not 'for free'): the revealed tactic's numeric cost is paid (a cost-2 tactic costs 2 more resources)", () => {
  const g = manifestBoard({ icons: { obsession: 5 }, hidden: hiddenTactic({ cost: 2 }), hidSpent: true });
  const before = ready(g.engine);
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27, "control: the tactic was played");
  assert.equal(before - ready(g.engine), 3, "Manifest's own cost of 1 plus the revealed tactic's cost of 2");
});

clause(MANIFEST, "0:ability", "'You may play the tactic': a tactic whose cost I cannot pay cannot be played", () => {
  const g = manifestBoard({ icons: { obsession: 2 }, hidden: hiddenTactic({ cost: 5 }), hidSpent: true });
  manifest(g, g.id("hid"));
  const pc = pending(g.engine);
  if (pc && pc.kind === "deployForFree") {
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("hid"), selected: {} } } as never),
      "playing a cost-5 tactic with only 4 spare resources (1 staple and 3 face-down cards)"
    );
    assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true, "the refused play left the tactic face-down where it was");
    assert.equal(influenceOf(g.engine, P2), 30, "and nothing was played for free");
  } else {
    assert.fail("expected to be asked whether to play the tactic");
  }
});

clause(MANIFEST, "0:ability", "'You may play the tactic': an unaffordable tactic can be declined: it stays face-down, its effect does not happen, and the card is still drawn", () => {
  const g = manifestBoard({ icons: { obsession: 2 }, hidden: hiddenTactic({ cost: 5 }), hidSpent: true });
  const top = deckOf(g.engine, P1)[0];
  manifest(g, g.id("hid"));
  manifestPlays(g, undefined);
  assert.equal(influenceOf(g.engine, P2), 30, "the unaffordable tactic was not played");
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true);
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(MANIFEST, "0:ability", "'You may play the tactic': the revealed tactic's own threshold must be met (a [G] tactic cannot be played with only [O])", () => {
  const g = manifestBoard({ icons: { obsession: 3 }, hidden: hiddenTactic({ threshold: "g" }) });
  manifest(g, g.id("hid"));
  const pc = pending(g.engine);
  assert.ok(pc && pc.kind === "deployForFree", "expected to be asked whether to play the tactic");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("hid"), selected: {} } } as never),
    "playing a [G] tactic with no Greed"
  );
});

clause(MANIFEST, "0:ability", "'You may play the tactic': a [G] tactic that cannot be played can be declined: it stays face-down and its effect does not happen", () => {
  const g = manifestBoard({ icons: { obsession: 3 }, hidden: hiddenTactic({ threshold: "g" }) });
  manifest(g, g.id("hid"));
  manifestPlays(g, undefined);
  assert.equal(influenceOf(g.engine, P2), 30);
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true);
});

clause(MANIFEST, "0:ability", "'You may play the tactic': a [G] tactic CAN be played when I control Greed too (the threshold is checked, not ignored)", () => {
  const g = manifestBoard({ icons: { obsession: 3, greed: 1 }, hidden: hiddenTactic({ threshold: "g" }) });
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(MANIFEST, "0:ability", "'You may play the tactic': a tactic with its own pick is played with that pick", () => {
  const g = manifestBoard({ hidden: hiddenTactic({ pick: true }) });
  manifest(g, g.id("hid"));
  manifestPlays(g, g.id("hid"), { t: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("hid")), "discard");
  assert.equal(influenceOf(g.engine, P2), 27);
});

// picks

clause(MANIFEST, "0:ability", "any of my face-down tactics can be revealed, not only the first (a second hidden tactic works)", () => {
  const g = manifestBoard();
  manifest(g, g.id("hid2"));
  manifestPlays(g, g.id("hid2"));
  assert.equal(zoneOf(g.engine, g.id("hid2")), "discard");
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true, "the other one stays hidden");
});

clause(MANIFEST, "0:ability", "a face-down tactic I control but my opponent owns can be revealed", () => {
  const g = manifestBoard();
  manifest(g, g.id("capHid"));
  manifestPlays(g, g.id("capHid"));
  assert.equal(zoneOf(g.engine, g.id("capHid")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("capHid")), "a tactic goes to its owner's discard pile");
});

clause(MANIFEST, "0:ability", "cannot reveal my opponent's face-down tactic, nor one I own but they control", () => {
  const g = manifestBoard();
  refused(manifestAttempt(g, g.id("foeHid")), "an opponent's face-down tactic");
  refused(manifestAttempt(g, g.id("lentHid")), "my face-down tactic under their control");
  assert.equal(zoneOf(g.engine, g.id("man")), "hand");
  assert.equal(ready(g.engine), 7, "nothing was paid (3 Obsession and 4 of my face-down cards)");
  manifestAttempt(g, g.id("hid"))();
  assert.ok(g.engine.state.responseWindow, "control: my own face-down tactic is accepted");
});

clause(MANIFEST, "0:ability", "cannot reveal a face-down card that is not a tactic (a face-down character), a face-up card, or a tactic in my hand", () => {
  const g = manifestBoard();
  refused(manifestAttempt(g, g.id("fdChar")), "a face-down character");
  refused(manifestAttempt(g, g.id("ally")), "a face-up character");
  refused(manifestAttempt(g, g.id("handTac")), "a tactic in my hand");
  refused(manifestAttempt(g, g.engine.state.players[P1].factionId!), "my faction");
  assert.equal(zoneOf(g.engine, g.id("man")), "hand");
  assert.equal(g.engine.state.cards[g.id("fdChar")].faceDown, true);
});

clause(MANIFEST, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const g = manifestBoard();
  refused(manifestAttempt(g), "no pick");
  refused(() => playRaw(g.engine, P1, g.id("man"), { selected: { rev: [g.id("hid"), g.id("hid2")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("man")), "hand");
});

clause(MANIFEST, "0:ability", "with no face-down tactic to reveal, Manifest cannot be played", () => {
  const g = devBoard([
    { key: "man", def: printing(MANIFEST), owner: P1, zone: "hand" },
    { key: "fdChar", def: character({ name: "Hidden Character" }), owner: P1, zone: "play", faceDown: true },
    { key: "foeHid", def: hiddenTactic({ name: "Their Hidden Tactic" }), owner: P2, zone: "play", faceDown: true },
    ...res({ obsession: 3 })
  ]);
  refused(() => playRaw(g.engine, P1, g.id("man"), { selected: {} }), "nothing to reveal");
  assert.equal(zoneOf(g.engine, g.id("man")), "hand");
});

clause(MANIFEST, "0:ability", "COST: the reveal is part of the cost: the revealed card is shown when Manifest is played, before the opponent can respond", () => {
  const g = manifestBoard();
  manifestAttempt(g, g.id("hid"))();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  const shown = revealsIn(g.engine).some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(g.id("hid")));
  assert.equal(shown, true, "the face-down tactic has already been revealed while the opponent may respond");
});

clause(MANIFEST, "0:ability", "the effect happens when Manifest resolves, not when it is played: the revealed tactic is still face-down while the opponent may respond", () => {
  const g = manifestBoard();
  manifestAttempt(g, g.id("hid"))();
  assert.equal(g.engine.state.cards[g.id("hid")].faceDown, true);
  assert.equal(influenceOf(g.engine, P2), 30);
  resolvePendingResponses(g.engine);
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(MANIFEST, "0:ability", "if the revealed tactic leaves play in response, there is no tactic to play but the card is still drawn", () => {
  const g = manifestBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  manifestAttempt(g, g.id("hid"))();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("hid")] });
  if (pending(g.engine)) manifestPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("hid")), "removed", "control: removed from the game in response");
  assert.equal(influenceOf(g.engine, P2), 30, "the removed tactic was not played");
  assert.equal(zoneOf(g.engine, top), "hand", "Draw a card still happens");
});

// threshold / timing

clause(MANIFEST, "0:ability", "needs [O]: with no Obsession (only Greed) it is refused, with one it works", () => {
  const none = manifestBoard({ icons: { greed: 4 } });
  refused(manifestAttempt(none, none.id("hid")), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("man")), "hand");
  const one = manifestBoard({ icons: { obsession: 1, greed: 2 } });
  manifest(one, one.id("hid"));
  assert.ok(one.engine.state.cards[one.id("man")].zone === "discard" || pending(one.engine), "control: one [O] is enough");
});

clause(MANIFEST, "0:ability", "my face-down cards (Volition) and my opponent's [O] do not meet the [O] threshold", () => {
  const g = manifestBoard({ icons: { greed: 2 }, extra: res({ obsession: 3 }, P2) });
  refused(manifestAttempt(g, g.id("hid")), "no [O] of mine");
  assert.equal(zoneOf(g.engine, g.id("man")), "hand");
});

clause(MANIFEST, "0:ability", "is refused with nothing to pay its cost of 1 (all resources spent)", () => {
  const g = manifestBoard({ icons: {}, extra: res({ obsession: 1 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  // the three face-down cards of mine still count as ready resources, so spend them as well
  const spendAll = devBoard([
    { key: "man", def: printing(MANIFEST), owner: P1, zone: "hand" },
    { key: "hid", def: hiddenTactic(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
  assert.equal(ready(spendAll.engine), 0);
  refused(() => playRaw(spendAll.engine, P1, spendAll.id("man"), { selected: { rev: [spendAll.id("hid")] } }), "no resource to pay with");
  assert.equal(zoneOf(spendAll.engine, spendAll.id("man")), "hand");
  assert.ok(g, "(board built)");
});

clause(MANIFEST, "0:ability", "being a tactic, it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = manifestBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(manifestAttempt(g, g.id("hid")), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("man"), { rev: [g.id("hid")] });
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

// --- the discard-pile rule ------------------------------------------------------------

/** A board with Manifest in my discard pile and an [O] resource card, a Minion of Thabbash ([O] character), a Greed card and a plain character in my hand. */
function recurBoard(opts: { icons?: Icons; man?: "discard" | "hand" | "deck"; manOwner?: PlayerId; extra?: CardPlacement[]; random?: () => number } = {}) {
  return devBoard(
    [
      { key: "man", def: printing(MANIFEST), owner: opts.manOwner ?? P1, zone: opts.man ?? "discard" },
      { key: "obs", def: resourceCard({ name: "Obsession Card", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "grd", def: resourceCard({ name: "Greed Card", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "minion", def: printing(MINION), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain Character", cost: 1 }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { obsession: 3 }),
      ...(opts.extra ?? [])
    ],
    { random: opts.random ?? mulberry(5) }
  );
}

type RecurGame = ReturnType<typeof recurBoard>;
const payManifest = (pay: boolean) => (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc));

clause(MANIFEST, "1:rule", "when an [O]-providing resource enters play under my control I may pay 2: Manifest then enters play face-down under my control as a resource", () => {
  const g = recurBoard();
  const before = ready(g.engine);
  developResource(g.engine, P1, g.id("obs"), false);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "play", "Manifest is in play");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true, "face-down");
  assert.equal(g.engine.state.cards[g.id("man")].controllerId, P1, "under my control");
  assert.equal(g.engine.isResource(g.id("man")), true, "as a resource (Volition)");
  assert.ok(playOf(g.engine, P1).includes(g.id("man")), "playOf(g.engine, P1).includes(g.id(\"man\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("man")), false, "no longer in the discard pile");
  // +1 for the Obsession card, -2 paid, +1 for the face-down Manifest
  assert.equal(ready(g.engine), before + 1 - 2 + 1);
});

clause(MANIFEST, "1:rule", "'you may pay 2' is optional: declining leaves Manifest in the discard pile and pays nothing", () => {
  const g = recurBoard();
  const before = ready(g.engine);
  developResource(g.engine, P1, g.id("obs"), false);
  expectPending(g.engine, "mayPay");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
  assert.equal(ready(g.engine), before + 1, "only the new Obsession card changed my resources");
});

clause(MANIFEST, "1:rule", "'pay 2' pays exactly two resources", () => {
  const g = recurBoard({ icons: { obsession: 5 } });
  developResource(g.engine, P1, g.id("obs"), false);
  const beforePay = ready(g.engine);
  answerPending(g.engine, "mayPay", { pay: true });
  // two resources spent, one new face-down Manifest resource
  assert.equal(beforePay - ready(g.engine), 2 - 1);
  assert.equal(attachedCount(g.engine, P1), 2, "exactly two resources were attached to my faction");
});

clause(MANIFEST, "1:rule", "an [O]-providing CHARACTER entering play (Minion of Thabbash: PROVIDES [O]) triggers it as well", () => {
  const g = recurBoard({ icons: { obsession: 6 } });
  play(g.engine, P1, g.id("minion"));
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true);
});

clause(MANIFEST, "1:rule", "a resource that provides something other than [O] (Greed) does not trigger it", () => {
  const g = recurBoard();
  developResource(g.engine, P1, g.id("grd"), false);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer");
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "1:rule", "a plain character entering play (providing no icons) does not trigger it", () => {
  const g = recurBoard();
  play(g.engine, P1, g.id("plain"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "1:rule", "a card played face-down provides Volition, not [O]: it does not trigger it", () => {
  const g = recurBoard();
  developResource(g.engine, P1, g.id("obs"), true);
  assert.equal(g.engine.state.pendingChoice, undefined, "an Obsession card played face-down provides only Volition");
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
  const h = recurBoard();
  developResource(h.engine, P1, h.id("plain"), true);
  assert.equal(h.engine.state.pendingChoice, undefined);
});

clause(MANIFEST, "1:rule", "an [O] card entering play under my OPPONENT's control does not trigger it", () => {
  const g = devBoard(
    [
      { key: "man", def: printing(MANIFEST), owner: P1, zone: "discard" },
      { key: "obs2", def: resourceCard({ name: "Their Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P2, zone: "hand" },
      ...res({ obsession: 3 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  developResource(g.engine, P2, g.id("obs2"), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "1:rule", "it only works while Manifest is in my discard pile: not from my hand, not from my deck", () => {
  for (const zone of ["hand", "deck"] as const) {
    const g = recurBoard({ man: zone });
    developResource(g.engine, P1, g.id("obs"), false);
    assert.equal(g.engine.state.pendingChoice, undefined, `no offer with Manifest in my ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("man")), zone);
  }
});

clause(MANIFEST, "1:rule", "it only works for MY discard pile: a Manifest in my opponent's discard pile does not trigger on my [O] cards", () => {
  const g = recurBoard({ manOwner: P2 });
  developResource(g.engine, P1, g.id("obs"), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "1:rule", "it works only once per Manifest: after it has come back it is no longer in the discard pile, so the next [O] card does not trigger it", () => {
  const g = recurBoard({ icons: { obsession: 8 }, extra: [{ key: "obs2", def: resourceCard({ name: "Second Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("obs"), false);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
  // second Obsession card via the Minion (a character that provides [O])
  play(g.engine, P1, g.id("minion"));
  assert.equal(g.engine.state.pendingChoice, undefined, "Manifest is no longer in the discard pile");
});

clause(MANIFEST, "1:rule", "an [O] resource card played produces ONE offer, not two (it enters play once)", () => {
  const g = recurBoard();
  developResource(g.engine, P1, g.id("obs"), false);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(g.engine.state.pendingChoice, undefined, "no second offer for the same card");
});

clause(MANIFEST, "1:rule", "two Manifests in my discard pile each trigger: I can bring both back (paying 2 each)", () => {
  const g = recurBoard({ icons: { obsession: 5 }, extra: [{ key: "man2", def: printing(MANIFEST), owner: P1, zone: "discard" }] });
  developResource(g.engine, P1, g.id("obs"), false);
  drain(g.engine, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    return declineAll(pc);
  });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
  assert.equal(zoneOf(g.engine, g.id("man2")), "play");
  assert.equal(attachedCount(g.engine, P1), 4, "2 + 2 resources paid");
});

clause(MANIFEST, "1:rule", "'you may pay 2' needs two resources: with only the new [O] card and one other resource it can still be paid, with fewer it cannot", () => {
  const enough = recurBoard({ icons: { obsession: 1 } });
  developResource(enough.engine, P1, enough.id("obs"), false);
  const pc = pending(enough.engine);
  assert.ok(pc && pc.kind === "mayPay", "the offer is made: the new Obsession card and one more resource make 2");
  answerPending(enough.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(enough.engine, enough.id("man")), "play");
});

clause(MANIFEST, "1:rule", "with fewer than 2 resources available the payment cannot be made: paying is refused or not offered, and Manifest stays in the discard pile", () => {
  const g = devBoard([
    { key: "man", def: printing(MANIFEST), owner: P1, zone: "discard" },
    { key: "obs", def: resourceCard({ name: "Only Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" }
  ]);
  developResource(g.engine, P1, g.id("obs"), false);
  const pc = pending(g.engine);
  if (pc && pc.kind === "mayPay") {
    refused(() => answerPending(g.engine, "mayPay", { pay: true }), "paying 2 with only 1 resource");
    answerPending(g.engine, "mayPay", { pay: false });
  }
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "1:rule", "once back in play face-down, Manifest provides Volition and can later be flipped up", () => {
  const g = recurBoard({ icons: { obsession: 4 } });
  developResource(g.engine, P1, g.id("obs"), false);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true);
});

clause(MANIFEST, "1:rule", "a card PUT into play by an effect (not deployed) that provides [O] also triggers it", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = recurBoard({ icons: { obsession: 3 }, extra: [{ key: "pip", def: putter, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("minion")] } });
  const pc = pending(g.engine);
  assert.ok(pc && pc.kind === "mayPay", "a card put into play (not deployed) that provides [O] also triggers it");
});

clause(MANIFEST, "1:rule", "a card that provides MORE than [O] (two [O]) also counts as providing 'at least [O]': one offer", () => {
  const double = resourceCard({ name: "Double Obsession", resource: { provides: ["obsession", "obsession"], staple: false } });
  const g = recurBoard({ extra: [{ key: "dbl", def: double, owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("dbl"), false);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
});

clause(MANIFEST, "1:rule", "a card that provides [O] and another icon (Greed too) counts as providing at least [O]", () => {
  const mixed = resourceCard({ name: "Obsession And Greed", resource: { provides: ["obsession", "greed"], staple: false } });
  const g = recurBoard({ extra: [{ key: "mix", def: mixed, owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("mix"), false);
  expectPending(g.engine, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
});

clause(MANIFEST, "1:rule", "after Manifest resolves normally it sits in my discard pile, and from then on an [O] card entering play offers to bring it back", () => {
  const g = manifestBoard({ icons: { obsession: 6 }, extra: [{ key: "obs", def: resourceCard({ name: "Obsession Card", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" }] });
  manifest(g, g.id("hid"));
  manifestPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
  developResource(g.engine, P1, g.id("obs"), false);
  expectPending(g.engine, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("man")), "play");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true);
});

// --- FLIP UP: 1 [O] ---------------------------------------------------------------------

const flipManifest = (g: ManifestGame, pick?: CardInstanceId, player: PlayerId = P1) =>
  flipUpRaw(g.engine, player, g.id("man"), pick ? { rev: [pick] } : {});

clause(MANIFEST, "2:flipUp", "a face-down Manifest is a resource: it provides Volition and is in my resource pool", () => {
  const g = manifestBoard({ man: "faceDown", icons: { obsession: 2 } });
  assert.equal(g.engine.isResource(g.id("man")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 5, "Manifest and the other four face-down cards I control");
});

clause(MANIFEST, "2:flipUp", "flipping it up resolves it as the tactic: the revealed face-down tactic may be played, a card is drawn, and Manifest ends in my discard pile", () => {
  const g = manifestBoard({ man: "faceDown" });
  const top = deckOf(g.engine, P1)[0];
  flipManifest(g, g.id("hid"));
  resolvePendingResponses(g.engine);
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27, "the revealed tactic was played");
  assert.equal(zoneOf(g.engine, top), "hand", "a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, false);
});

clause(MANIFEST, "2:flipUp", "FLIP UP costs 1 (its Flip Up cost): with other resources available at most one of them ends up spent", () => {
  const g = manifestBoard({ man: "faceDown", icons: { obsession: 3 } });
  flipManifest(g, g.id("hid"));
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) manifestPlays(g, undefined);
  assert.ok(attachedCount(g.engine, P1) <= 1, "at most one resource is spent (Manifest may pay for itself, CR 507.4b)");
});

clause(MANIFEST, "2:flipUp", "FLIP UP needs [O]: with only Greed it is refused (the card stays face-down), with one [O] it works", () => {
  const none = manifestBoard({ man: "faceDown", icons: { greed: 3 } });
  refused(() => flipManifest(none, none.id("hid")), "no [O]");
  assert.equal(none.engine.state.cards[none.id("man")].faceDown, true);
  assert.equal(ready(none.engine), 8, "nothing was paid");
  const one = manifestBoard({ man: "faceDown", icons: { obsession: 1 } });
  flipManifest(one, one.id("hid"));
  resolvePendingResponses(one.engine);
  if (pending(one.engine)) manifestPlays(one, undefined);
  assert.equal(zoneOf(one.engine, one.id("man")), "discard", "control: one [O] is enough");
});

clause(MANIFEST, "2:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const g = manifestBoard({ man: "faceDown", icons: { greed: 1 }, extra: res({ obsession: 3 }, P2) });
  refused(() => flipManifest(g, g.id("hid")), "no [O] of mine");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true);
});

clause(MANIFEST, "2:flipUp", "the regular extra cost still applies when flipping up: only a face-down tactic I control can be revealed", () => {
  const g = manifestBoard({ man: "faceDown" });
  refused(() => flipManifest(g, g.id("foeHid")), "an opponent's face-down tactic");
  refused(() => flipManifest(g, g.id("fdChar")), "a face-down character");
  refused(() => flipManifest(g, g.id("handTac")), "a tactic in my hand");
  refused(() => flipManifest(g), "no pick");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 8, "nothing was paid by the refused attempts");
  flipManifest(g, g.id("hid"));
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) manifestPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("man")), "discard", "control: a legal pick works");
});

clause(MANIFEST, "2:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand or my discard pile, not face-up)", () => {
  const theirs = manifestBoard({ man: "faceDown", extra: res({ obsession: 2 }, P2) });
  refused(() => flipManifest(theirs, theirs.id("foeHid"), P2), "the opponent cannot flip my card");
  const inHand = manifestBoard({ man: "hand" });
  refused(() => flipManifest(inHand, inHand.id("hid")), "in my hand it is not a face-down resource");
  const inDisc = manifestBoard({ man: "discard" });
  refused(() => flipManifest(inDisc, inDisc.id("hid")), "in my discard pile");
  const faceUp = manifestBoard({ man: "faceUp" });
  refused(() => flipManifest(faceUp, faceUp.id("hid")), "a face-up card in play");
  assert.equal(theirs.engine.state.cards[theirs.id("man")].faceDown, true);
});

clause(MANIFEST, "2:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = manifestBoard({ man: "faceDown", turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => flipManifest(g, g.id("hid")), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("man")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipManifest(g, g.id("hid"));
  resolvePendingResponses(g.engine);
  manifestPlays(g, g.id("hid"));
  assert.equal(influenceOf(g.engine, P2), 27, "flipped up in response to the attack");
});

clause(MANIFEST, "2:flipUp", "a face-down Manifest that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = manifestBoard({ man: "faceDown", icons: { obsession: 2 }, extra: [] });
  g.engine.state.cards[g.id("man")].attachedTo = g.engine.state.players[P1].factionId!;
  flipManifest(g, g.id("hid"));
  resolvePendingResponses(g.engine);
  manifestPlays(g, g.id("hid"));
  assert.equal(zoneOf(g.engine, g.id("man")), "discard");
});

clause(MANIFEST, "2:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = manifestBoard({ man: "faceDown" });
  flipManifest(g, g.id("hid"));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(influenceOf(g.engine, P2), 30, "the effect has not happened yet");
});

// =================================================================================
// Meat of the Mountain
// If a player draws any number of cards, that player may add or remove a token from this
// card. If they do, generate the effect which corresponds to the new number of tokens on
// this card:
// 0 TOKENS - That player's opponent discards a card.
// 1 TOKEN - That player may look at the top 2 cards of their deck. If they do, they put 1
//   into their hand and 1 on the bottom of their deck.
// 2 TOKENS - That player may pick a character or location. If they do, put it into its
//   owner's hand.
// AT LEAST 3 TOKENS - That player may play a resource.
// Item, cost 2, [O][O].
// =================================================================================

const MEAT = "60eab41e-55d8-428c-991a-de347296fa4f";

/** A character (id "d") whose abilities draw: dr1 draws 1, dr2 draws 2 at once, drTwice draws 1 and then 1 again as two separate instructions. */
function drawerDef(name: string): CardDefinition {
  return character({
    name,
    life: 9,
    behavior: {
      abilities: [
        { id: "dr1", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { id: "dr2", type: "activated", effects: [{ type: "draw", player: "controller", amount: 2 }] },
        {
          id: "drTwice",
          type: "activated",
          effects: [
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  });
}

function meatBoard(
  opts: {
    tokens?: number;
    meat?: "play" | "hand" | "discard" | "faceDown";
    active?: PlayerId;
    deck1?: number;
    deck2?: number;
    hand1?: number;
    hand2?: number;
    oppRes?: boolean;
    controller?: PlayerId;
    extra?: CardPlacement[];
    random?: () => number;
  } = {}
) {
  const where = opts.meat ?? "play";
  return devBoard(
    [
      {
        key: "meat",
        def: printing(MEAT),
        owner: P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        counters: opts.tokens ? { token: opts.tokens } : undefined
      },
      { key: "d1", def: drawerDef("My Drawer"), owner: P1, zone: "play" },
      { key: "d2", def: drawerDef("Their Drawer"), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "captured", def: character({ name: "Captured", life: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "place", def: location({ name: "My Place" }), owner: P1, zone: "play" },
      { key: "foePlace", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "My Thing" }), owner: P1, zone: "play" },
      { key: "foeThing", def: item({ name: "Their Thing" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P1, zone: "play", faceDown: true },
      { key: "rs1", def: resourceCard({ name: "Resource In Play", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "play" },
      ...fillers("mh", opts.hand1 ?? 3, P1, "hand"),
      ...fillers("oh", opts.hand2 ?? 3, P2, "hand"),
      { key: "mres", def: resourceCard({ name: "My Greed Card", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      ...(opts.oppRes === false ? [] : [{ key: "ores", def: resourceCard({ name: "Their Rage Card", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" as const }]),
      ...fillers("mk", opts.deck1 ?? 6, P1, "deck"),
      ...fillers("ok", opts.deck2 ?? 6, P2, "deck"),
      ...(opts.extra ?? [])
    ],
    { turn: opts.active === P2 ? 2 : undefined, activePlayerId: opts.active, random: opts.random ?? mulberry(11) }
  );
}

type MeatGame = ReturnType<typeof meatBoard>;
const tokensOfMeat = (g: MeatGame): number => tokensOn(g.engine, g.id("meat"));

/** `player` (P1: "d1", P2: "d2") draws with the given drawer ability; stops at the first pending choice. */
function meatDraw(g: MeatGame, player: PlayerId = P1, ability = "dr1"): void {
  activate(g.engine, player, g.id(player === P1 ? "d1" : "d2"), ability);
}

/** Index of the option whose label matches `what` in the open chooserSelectsOption. */
function optionFor(pc: PendingChoiceLike, what: "nothing" | "add" | "remove"): number {
  const labels = ((pc.options as Array<{ label?: string }>) ?? []).map((option) => option.label ?? "");
  const pattern = what === "add" ? /add/i : what === "remove" ? /remove/i : /nothing|decline|neither|no\b/i;
  const index = labels.findIndex((label) => pattern.test(label));
  assert.ok(index >= 0, `an option to ${what} was offered (offered: ${labels.join(" / ")})`);
  return index;
}

/** The open choice must be `who`'s add / remove / nothing menu; answers it with `what`. */
function meatChoose(g: MeatGame, who: PlayerId, what: "nothing" | "add" | "remove"): void {
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, who, "the player who drew decides");
  answerPending(g.engine, "chooserSelectsOption", { index: optionFor(pc, what) });
}

/** Answers any follow-up prompts by declining / taking the neutral answer (empty picks). */
const declineEverything = (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : declineAll(pc));

// --- 0:rule: the trigger and the token ----------------------------------------------------

clause(MEAT, "0:rule", "when I draw, I am offered to add a token, remove a token, or do neither", () => {
  const g = meatBoard({ tokens: 1 });
  meatDraw(g);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  optionFor(pc, "nothing");
  optionFor(pc, "add");
  optionFor(pc, "remove");
});

clause(MEAT, "0:rule", "'may': doing neither changes nothing -- no token, no generated effect", () => {
  const g = meatBoard({ tokens: 1 });
  const hand = handOf(g.engine, P1);
  const oppHand = handOf(g.engine, P2);
  meatDraw(g);
  const afterDraw = handOf(g.engine, P1);
  assert.equal(afterDraw.length, hand.length + 1, "control: the card was drawn");
  meatChoose(g, P1, "nothing");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOfMeat(g), 1);
  assert.deepEqual(handOf(g.engine, P1), afterDraw);
  assert.deepEqual(handOf(g.engine, P2), oppHand, "my opponent was not made to discard");
});

clause(MEAT, "0:rule", "adding a token puts exactly one token on the item", () => {
  const g = meatBoard({ tokens: 1 });
  meatDraw(g);
  meatChoose(g, P1, "add");
  assert.equal(tokensOfMeat(g), 2);
  drain(g.engine, declineEverything);
});

clause(MEAT, "0:rule", "removing a token takes exactly one token off the item", () => {
  const g = meatBoard({ tokens: 2 });
  meatDraw(g);
  meatChoose(g, P1, "remove");
  assert.equal(tokensOfMeat(g), 1);
  drain(g.engine, (pc) => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : declineEverything(pc)));
});

clause(MEAT, "0:rule", "tokens accumulate one draw at a time: 1 -> 2 -> 3 -> 4", () => {
  const g = meatBoard({ tokens: 1, deck1: 10 });
  for (const expected of [2, 3, 4]) {
    meatDraw(g, P1, "dr1");
    meatChoose(g, P1, "add");
    drain(g.engine, declineEverything);
    assert.equal(tokensOfMeat(g), expected);
  }
});

clause(MEAT, "0:rule", "it is the DRAWING player who decides: when my opponent draws they are asked, I am not", () => {
  const g = meatBoard({ tokens: 1, active: P2 });
  meatDraw(g, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "my opponent decides about the token");
  optionFor(pc, "add");
  optionFor(pc, "remove");
  optionFor(pc, "nothing");
});

clause(MEAT, "0:rule", "my opponent may add a token on their draw (the item is mine, but 'that player' adds it)", () => {
  const g = meatBoard({ tokens: 1, active: P2 });
  meatDraw(g, P2);
  meatChoose(g, P2, "add");
  assert.equal(tokensOfMeat(g), 2);
  drain(g.engine, declineEverything);
});

clause(MEAT, "0:rule", "my opponent may decline on their draw: no token, no effect", () => {
  const g = meatBoard({ tokens: 1, active: P2 });
  meatDraw(g, P2);
  meatChoose(g, P2, "nothing");
  assert.equal(tokensOfMeat(g), 1);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MEAT, "0:rule", "only a DRAW triggers it: putting a card into a hand some other way does not", () => {
  const g = meatBoard({ tokens: 1, extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("ally")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "hand", "control: a card was put into my hand");
  assert.equal(g.engine.state.pendingChoice, undefined, "no draw, no trigger");
  assert.equal(tokensOfMeat(g), 1);
});

clause(MEAT, "0:rule", "drawing several cards at once is ONE draw (CR 306.3): a draw of 2 offers the choice once", () => {
  const g = meatBoard({ tokens: 1 });
  meatDraw(g, P1, "dr2");
  meatChoose(g, P1, "nothing");
  assert.equal(g.engine.state.pendingChoice, undefined, "no second prompt for the second card");
  assert.equal(tokensOfMeat(g), 1);
  assert.equal(handOf(g.engine, P1).length, 3 + 1 + 2, "both cards were drawn");
});

clause(MEAT, "0:rule", "separate 'draw a card' instructions are separate draws (FAQ): drawing 1 twice offers the choice twice", () => {
  const g = meatBoard({ tokens: 1 });
  meatDraw(g, P1, "drTwice");
  meatChoose(g, P1, "nothing");
  meatChoose(g, P1, "nothing");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MEAT, "0:rule", "the Develop Rule's draw is a draw: it offers the choice", () => {
  const g = meatBoard({ tokens: 1 });
  developDraw(g.engine, P1);
  resolvePendingResponses(g.engine);
  meatChoose(g, P1, "nothing");
  assert.equal(tokensOfMeat(g), 1);
});

clause(MEAT, "0:rule", "if no card is actually drawn (empty deck) nothing was drawn, so there is no choice", () => {
  const g = meatBoard({ tokens: 1, deck1: 0 });
  meatDraw(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOfMeat(g), 1);
});

clause(MEAT, "0:rule", "it only works while the item is in play, face-up: nothing is offered with it in my hand, my discard pile or face-down", () => {
  for (const meat of ["hand", "discard", "faceDown"] as const) {
    const g = meatBoard({ meat, tokens: meat === "faceDown" ? 1 : undefined });
    meatDraw(g);
    assert.equal(g.engine.state.pendingChoice, undefined, `no offer with the item ${meat}`);
  }
});

clause(MEAT, "0:rule", "two copies of the item each get their own offer on one draw", () => {
  const g = meatBoard({ tokens: 1, extra: [{ key: "meat2", def: printing(MEAT), owner: P1, zone: "play", counters: { token: 1 } }] });
  meatDraw(g);
  let prompts = 0;
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") {
      prompts++;
      return { kind: "chooserSelectsOption", index: optionFor(pc, "nothing") };
    }
    return declineAll(pc);
  });
  assert.equal(prompts, 2, "one offer per item");
  assert.equal(tokensOn(g.engine, g.id("meat")), 1);
  assert.equal(tokensOn(g.engine, g.id("meat2")), 1);
});

clause(MEAT, "0:rule", "a token cannot be removed from an item with no tokens: removing is refused (or not offered), and no '0 tokens' effect is generated", () => {
  const g = meatBoard({ tokens: 0 });
  const oppHand = handOf(g.engine, P2);
  meatDraw(g);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  const labels = ((pc.options as Array<{ label?: string }>) ?? []).map((option) => option.label ?? "");
  const removeIndex = labels.findIndex((label) => /remove/i.test(label));
  if (removeIndex >= 0) {
    refused(() => answerPending(g.engine, "chooserSelectsOption", { index: removeIndex }), "removing a token from an item with none");
  }
  assert.equal(tokensOfMeat(g), 0);
  assert.deepEqual(handOf(g.engine, P2), oppHand, "no '0 tokens' effect was generated for a removal that did not happen");
});

// --- 1:rule  0 TOKENS - That player's opponent discards a card. ---------------------------

/** `player` draws, changes the token count with `what`, and the follow-up prompt is left open. */
function meatChange(g: MeatGame, player: PlayerId, what: "add" | "remove"): void {
  meatDraw(g, player);
  meatChoose(g, player, what);
}

/** Answers a follow-up reorder prompt by keeping the order, everything else by declining. */
/** Says yes to "may look at the top 2" (a mayPay with no cost), keeps the order of the looked-at cards, declines everything else. */
const keepOrder = (pc: PendingChoiceLike): unknown =>
  pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(pc.cardIds as string[])] } : pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineEverything(pc);
/** Answers the "may look at the top 2" prompt (1 TOKEN) with yes, for the player who changed the tokens. */
const meatLook = (g: MeatGame, who: PlayerId): void => {
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, who, "the player whose effect it is decides whether to look");
  answerPending(g.engine, "mayPay", { pay: true });
};

clause(MEAT, "1:rule", "removing the last token (new total 0): my opponent discards a card of THEIR choice", () => {
  const g = meatBoard({ tokens: 1 });
  const theirs = handOf(g.engine, P2);
  meatChange(g, P1, "remove");
  assert.equal(tokensOfMeat(g), 0);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses what to discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P2), theirs.filter((c) => c !== g.id("oh1")), "exactly the chosen card left their hand");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("oh1")]);
});

clause(MEAT, "1:rule", "the discard is mandatory and only from their own hand: declining, two cards, or a card of mine are refused", () => {
  const g = meatBoard({ tokens: 1 });
  meatChange(g, P1, "remove");
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining the discard");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] }), "two cards");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "a card of mine");
  assert.ok(pending(g.engine), "the demand is still standing");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(handOf(g.engine, P2).length, 3, "exactly one card was discarded (4 -> 3)");
});

clause(MEAT, "1:rule", "my own hand is untouched by my removal", () => {
  const g = meatBoard({ tokens: 1 });
  meatChange(g, P1, "remove");
  const mine = handOf(g.engine, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.deepEqual(handOf(g.engine, P1), mine);
  assert.equal(discardOf(g.engine, P1).length, 0);
});

clause(MEAT, "1:rule", "an opponent with no cards in hand discards nothing", () => {
  const g = meatBoard({ tokens: 1, hand2: 0, oppRes: false });
  assert.equal(handOf(g.engine, P2).length, 0, "control: their hand is empty");
  meatChange(g, P1, "remove");
  assert.equal(tokensOfMeat(g), 0);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing to discard, nothing to ask");
});

clause(MEAT, "1:rule", "when MY OPPONENT draws and removes the last token, I am 'that player's opponent': I discard a card of my choice", () => {
  const g = meatBoard({ tokens: 1, active: P2 });
  const mine = handOf(g.engine, P1);
  meatChange(g, P2, "remove");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose what I discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh2")] });
  assert.deepEqual(handOf(g.engine, P1), mine.filter((c) => c !== g.id("mh2")));
  assert.equal(handOf(g.engine, P2).length, 5, "their own hand is untouched (4 + the card they drew)");
});

clause(MEAT, "1:rule", "adding a token never generates the 0-token effect, and doing nothing at 0 tokens does not either", () => {
  const g = meatBoard({ tokens: 0 });
  const oppHand = handOf(g.engine, P2);
  meatChange(g, P1, "add");
  drain(g.engine, keepOrder);
  assert.deepEqual(handOf(g.engine, P2), oppHand, "no discard for an addition");
  const h = meatBoard({ tokens: 0 });
  const oppHand2 = handOf(h.engine, P2);
  meatDraw(h);
  meatChoose(h, P1, "nothing");
  assert.deepEqual(handOf(h.engine, P2), oppHand2, "no discard for doing nothing at 0 tokens");
});

// --- 2:rule  1 TOKEN - look at the top 2, 1 into hand, 1 on the bottom ------------------

clause(MEAT, "2:rule", "reaching 1 token by adding to 0: I look at the top 2 cards of my deck, put the one I choose into my hand and the other on the bottom", () => {
  const g = meatBoard({ tokens: 0 });
  meatDraw(g);
  const afterDraw = deckOf(g.engine, P1);
  const [a, b] = [afterDraw[0], afterDraw[1]];
  const rest = afterDraw.slice(2);
  meatChoose(g, P1, "add");
  assert.equal(tokensOfMeat(g), 1);
  meatLook(g, P1);
  const pc = expectPending(g.engine, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [a, b].sort(), "I look at exactly the top 2 cards after the draw");
  // I choose the SECOND of the two cards for my hand
  answerPending(g.engine, "reorderDeck", { order: [b, a] });
  assert.equal(zoneOf(g.engine, b), "hand", "the card I chose is in my hand");
  const deck = deckOf(g.engine, P1);
  assert.equal(deck[deck.length - 1], a, "the other card is on the bottom of my deck");
  assert.deepEqual(deck.slice(0, deck.length - 1), rest, "the rest of my deck keeps its order");
});

clause(MEAT, "2:rule", "after the look, no card exists in two places: the deck, hand and bottom hold each card exactly once", () => {
  const g = meatBoard({ tokens: 0 });
  meatDraw(g);
  meatChoose(g, P1, "add");
  meatLook(g, P1);
  const pc = expectPending(g.engine, "reorderDeck");
  answerPending(g.engine, "reorderDeck", { order: [...(pc.cardIds as string[])] });
  const cards = [...handOf(g.engine, P1), ...deckOf(g.engine, P1)];
  assert.equal(new Set(cards).size, cards.length, "no card is both in the hand and in the deck, or twice in the deck");
  assert.equal(cards.length, 4 + 1 + 6 - 1, "the cards of my hand (4 + the drawn one) and my deck (5) are all still there, once each");
});

clause(MEAT, "2:rule", "'That player MAY look': the player is asked whether to look before any card is moved, and declining moves nothing", () => {
  const g = meatBoard({ tokens: 0 });
  meatDraw(g);
  const handAfterDraw = handOf(g.engine, P1);
  const deckAfterDraw = deckOf(g.engine, P1);
  meatChoose(g, P1, "add");
  const pc = pending(g.engine);
  assert.ok(pc, "a follow-up is open");
  assert.notEqual(pc.kind, "reorderDeck", "the player is asked whether to look first (it is a 'may'), not pushed straight into ordering the cards");
  answerPending(g.engine, pc.kind, pc.kind === "mayPay" ? { pay: false } : pc.kind === "chooserSelectsOption" ? { index: 0 } : { selected: [] });
  assert.deepEqual(handOf(g.engine, P1), handAfterDraw, "declining puts nothing into my hand");
  assert.deepEqual(deckOf(g.engine, P1), deckAfterDraw, "...and leaves my deck exactly as it was");
});

clause(MEAT, "2:rule", "removing from 2 tokens also reaches 1 token and lets me look at the top 2 cards of my deck", () => {
  const g = meatBoard({ tokens: 2 });
  meatDraw(g);
  const afterDraw = deckOf(g.engine, P1);
  meatChoose(g, P1, "remove");
  assert.equal(tokensOfMeat(g), 1);
  const pc = pending(g.engine);
  assert.ok(pc && (pc.kind === "reorderDeck" || pc.kind === "mayPay" || pc.kind === "chooserSelectsOption"), "the look at the top 2 is offered");
  if (pc && pc.kind === "reorderDeck") assert.deepEqual([...(pc.cardIds as string[])].sort(), [afterDraw[0], afterDraw[1]].sort());
});

clause(MEAT, "2:rule", "one change, one look: adding the first token offers the look exactly once", () => {
  const g = meatBoard({ tokens: 0 });
  meatDraw(g);
  meatChoose(g, P1, "add");
  let looks = 0;
  drain(g.engine, (pc) => {
    if (pc.kind === "reorderDeck") looks++;
    return keepOrder(pc);
  });
  assert.equal(looks, 1);
});

clause(MEAT, "2:rule", "it looks at MY deck when I draw and at THEIR deck when they draw", () => {
  const g = meatBoard({ tokens: 0, active: P2 });
  meatDraw(g, P2);
  const theirs = deckOf(g.engine, P2);
  const mine = deckOf(g.engine, P1);
  meatChoose(g, P2, "add");
  meatLook(g, P2);
  const pc = expectPending(g.engine, "reorderDeck");
  assert.equal(pc.playerId, P2, "they look");
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [theirs[0], theirs[1]].sort(), "at the top of their own deck");
  assert.deepEqual(deckOf(g.engine, P1), mine, "my deck is untouched");
});

clause(MEAT, "2:rule", "with a single card left in the deck after the draw, that card goes into my hand", () => {
  const g = meatBoard({ tokens: 0, deck1: 2 });
  meatDraw(g);
  const last = deckOf(g.engine, P1)[0];
  meatChoose(g, P1, "add");
  drain(g.engine, keepOrder);
  assert.equal(zoneOf(g.engine, last), "hand", "the lone card is put into my hand");
});

clause(MEAT, "2:rule", "with an empty deck after the draw there is nothing to look at: nothing breaks", () => {
  const g = meatBoard({ tokens: 0, deck1: 1 });
  meatDraw(g);
  assert.equal(deckOf(g.engine, P1).length, 0);
  meatChoose(g, P1, "add");
  drain(g.engine, keepOrder);
  assert.equal(tokensOfMeat(g), 1);
  assert.equal(deckOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.result, undefined);
});

// --- 3:rule  2 TOKENS - may pick a character or location; put it into its owner's hand --------

/** Reaches 2 tokens (from 1 by adding) and returns once the pick is open. */
function meatAtTwo(g: MeatGame, player: PlayerId = P1): void {
  meatChange(g, player, "add");
  assert.equal(tokensOfMeat(g), 2);
}

for (const [key, why, ownerHand] of [
  ["ally", "my own character", P1],
  ["foe", "my opponent's character", P2],
  ["place", "my location", P1],
  ["foePlace", "my opponent's location", P2]
] as const) {
  clause(MEAT, "3:rule", `reaching 2 tokens: I may pick ${why} and it goes to its owner's hand`, () => {
    const g = meatBoard({ tokens: 1 });
    meatAtTwo(g);
    const pc = expectPending(g.engine, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });
    assert.equal(zoneOf(g.engine, g.id(key)), "hand");
    assert.ok(handOf(g.engine, ownerHand).includes(g.id(key)), "in its owner's hand");
    assert.equal(g.engine.state.pendingChoice, undefined);
  });
}

clause(MEAT, "3:rule", "a character I control but my opponent owns goes to its OWNER's hand", () => {
  const g = meatBoard({ tokens: 1 });
  meatAtTwo(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("captured")] });
  assert.ok(handOf(g.engine, P2).includes(g.id("captured")), "handOf(g.engine, P2).includes(g.id(\"captured\"))");
  assert.equal(handOf(g.engine, P1).includes(g.id("captured")), false);
});

clause(MEAT, "3:rule", "removing from 3 tokens also reaches 2 tokens and offers the pick", () => {
  const g = meatBoard({ tokens: 3 });
  meatChange(g, P1, "remove");
  assert.equal(tokensOfMeat(g), 2);
  expectPending(g.engine, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
});

clause(MEAT, "3:rule", "'may pick': declining the pick leaves everything in play (the token change stays)", () => {
  const g = meatBoard({ tokens: 1 });
  meatAtTwo(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["ally", "foe", "place", "foePlace", "captured"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
  assert.equal(tokensOfMeat(g), 2);
});

clause(MEAT, "3:rule", "only ONE card is picked: two are refused", () => {
  const g = meatBoard({ tokens: 1 });
  meatAtTwo(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally"), g.id("foe")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.equal(zoneOf(g.engine, g.id("ally")), "hand", "control: one pick works");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(MEAT, "3:rule", "only a character or a location: an item, a face-down card, a resource, a faction and a card in hand are refused", () => {
  const g = meatBoard({ tokens: 1 });
  meatAtTwo(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("thing")] }), "my item");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foeThing")] }), "their item");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd")] }), "a face-down card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("rs1")] }), "a resource");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.engine.state.players[P2].factionId!] }), "a faction");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "a card in my hand");
  assert.ok(pending(g.engine), "the pick is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("place")] });
  assert.equal(zoneOf(g.engine, g.id("place")), "hand", "control: a location works");
});

clause(MEAT, "3:rule", "when MY OPPONENT reaches 2 tokens THEY pick (they may pick my character) and it goes to its owner's hand", () => {
  const g = meatBoard({ tokens: 1, active: P2 });
  meatAtTwo(g, P2);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the drawing player picks");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.ok(handOf(g.engine, P1).includes(g.id("ally")), "my character returns to MY hand");
});

clause(MEAT, "3:rule", "the returned card comes back undamaged and ready", () => {
  const g = meatBoard({ tokens: 1, extra: [{ key: "hurt", def: character({ name: "Hurt", life: 9 }), owner: P2, zone: "play", damage: 4, depleted: true }] });
  meatAtTwo(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hurt")] });
  assert.equal(g.engine.state.cards[g.id("hurt")].damage, 0);
  assert.equal(g.engine.state.cards[g.id("hurt")].depleted, false);
});

// --- 4:rule  AT LEAST 3 TOKENS - may play a resource ----------------------------------------

for (const [from, what, to] of [
  [2, "add", 3],
  [3, "add", 4],
  [4, "remove", 3]
] as const) {
  clause(MEAT, "4:rule", `reaching ${to} tokens (${what}ing at ${from}): I may play a resource -- a resource card from my hand enters play face-up`, () => {
    const g = meatBoard({ tokens: from });
    meatChange(g, P1, what);
    assert.equal(tokensOfMeat(g), to);
    const pc = expectPending(g.engine, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres")] });
    assert.equal(zoneOf(g.engine, g.id("mres")), "play");
    assert.equal(g.engine.state.cards[g.id("mres")].faceDown, false, "an actual resource card goes in face-up");
    assert.equal(g.engine.state.pendingChoice, undefined);
  });
}

clause(MEAT, "4:rule", "'play a resource': a card that is not a resource is played face-down as a resource (Volition)", () => {
  const g = meatBoard({ tokens: 2 });
  meatChange(g, P1, "add");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] });
  assert.equal(zoneOf(g.engine, g.id("mh0")), "play");
  assert.equal(g.engine.state.cards[g.id("mh0")].faceDown, true);
  assert.equal(g.engine.isResource(g.id("mh0")), true);
});

clause(MEAT, "4:rule", "'may play': declining plays nothing", () => {
  const g = meatBoard({ tokens: 2 });
  const hand = handOf(g.engine, P1);
  meatChange(g, P1, "add");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(tokensOfMeat(g), 3);
  assert.equal(zoneOf(g.engine, g.id("mres")), "hand");
  assert.equal(handOf(g.engine, P1).length, hand.length + 1, "only the drawn card was added to my hand");
});

clause(MEAT, "4:rule", "the resource comes from MY hand: my opponent's hand card, a card in play and a card in the deck are refused; one resource only", () => {
  const g = meatBoard({ tokens: 2 });
  meatChange(g, P1, "add");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ores")] }), "their hand card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] }), "a card in play");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mk1")] }), "a card in my deck");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres"), g.id("mh0")] }), "two resources");
  assert.ok(pending(g.engine), "pending(g.engine)");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres")] });
  assert.equal(zoneOf(g.engine, g.id("mres")), "play", "control: one card from my hand works");
});

clause(MEAT, "4:rule", "playing the resource this way does not use up my Develop Rule", () => {
  const g = meatBoard({ tokens: 2 });
  meatChange(g, P1, "add");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres")] });
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("mh0"), true);
  assert.equal(zoneOf(g.engine, g.id("mh0")), "play", "I can still use the Develop Rule afterwards");
});

clause(MEAT, "4:rule", "when MY OPPONENT reaches 3 tokens THEY may play a resource from THEIR hand", () => {
  const g = meatBoard({ tokens: 2, active: P2 });
  meatChange(g, P2, "add");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ores")] });
  assert.equal(zoneOf(g.engine, g.id("ores")), "play");
  assert.equal(g.engine.state.cards[g.id("ores")].controllerId, P2);
});

clause(MEAT, "4:rule", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = meatBoard({ tokens: 2 });
  meatChange(g, P1, "add");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("mres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("mres")].zone === "play" && g.engine.state.cards[g.id("mres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

// =================================================================================
// Minion of Thabbash
// COVERT
// PROVIDES: [O]
// Character (wizard), cost 3, [O], 2 strength / 3 speed / 1 life.
// =================================================================================

clause(MINION, "0:kw:COVERT", "has the COVERT keyword (an ordinary character does not)", () => covertHasKeyword(MINION));
clause(MINION, "0:kw:COVERT", "attacking alone it cannot be blocked by a non-covert character, alone or together with a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(MINION));
clause(MINION, "0:kw:COVERT", "in a party with a non-covert member the party is not covert, so anyone may block", () => covertPartyNeedsEveryMemberCovert(MINION));
clause(MINION, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MINION));

clause(MINION, "0:kw:COVERT", "a face-down Minion is only a resource (CR 411.1): it has no COVERT", () => {
  const { engine, id } = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getKeywords(id("m")).includes("covert"), false);
});

clause(MINION, "0:kw:COVERT", "a Minion in my hand has no COVERT in play (the keyword is a property of the card in play)", () => {
  const { engine, id } = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "hand" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.getKeywords(id("ally")).includes("covert"), false, "a Minion in hand gives nothing to the board");
});

const minionBoard = (cards: CardPlacement[] = [], extra: Parameters<typeof buildGame>[0] = {}) =>
  devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "play" }, ...cards], extra);

clause(MINION, "1:provides", "in play it provides exactly one [O] and no other icon", () => {
  const { engine } = minionBoard();
  const icons = engine.getThresholds(P1);
  assert.equal(icons.obsession ?? 0, 1);
  for (const icon of ["rage", "greed", "deception", "elitism", "volition"] as const) assert.equal(icons[icon] ?? 0, 0, `no ${icon}`);
});

clause(MINION, "1:provides", "two Minions provide two [O]", () => {
  const { engine } = minionBoard([{ key: "m2", def: printing(MINION), owner: P1, zone: "play" }]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 2);
});

clause(MINION, "1:provides", "it adds to resources: one Obsession resource and a Minion make two [O]", () => {
  const { engine } = minionBoard(res({ obsession: 1 }));
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 2);
});

clause(MINION, "1:provides", "it does not provide to my opponent, and my opponent's Minion does not provide to me", () => {
  const { engine } = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "m2", def: printing(MINION), owner: P2, zone: "play" },
    { key: "m3", def: printing(MINION), owner: P2, zone: "play" }
  ]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 1);
  assert.equal(engine.getThresholds(P2).obsession ?? 0, 2);
});

clause(MINION, "1:provides", "it provides to its CONTROLLER: a Minion I own but my opponent controls provides [O] to them, not me", () => {
  const { engine } = devBoard([{ key: "m", def: printing(MINION), owner: P1, controller: P2, zone: "play" }]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 0);
  assert.equal(engine.getThresholds(P2).obsession ?? 0, 1);
});

clause(MINION, "1:provides", "it provides only while in play: a Minion in my hand, discard pile or deck provides nothing", () => {
  for (const zone of ["hand", "discard", "deck"] as const) {
    const { engine } = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone }]);
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 0, `in my ${zone}`);
  }
});

clause(MINION, "1:provides", "face-down it is a resource that provides Volition, not [O] (CR 411.1)", () => {
  const { engine } = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 0);
  assert.equal(engine.getThresholds(P1).volition ?? 0, 1);
});

clause(MINION, "1:provides", "being depleted does not stop it providing (icons are never spent)", () => {
  const { engine } = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "play", depleted: true }]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 1);
});

clause(MINION, "1:provides", "it stops providing the moment it leaves play (destroyed)", () => {
  const { engine, id } = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ]);
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 1);
  engine.state.activePlayerId = P2;
  play(engine, P2, id("kill"), { selected: { t: [id("m")] } });
  assert.equal(zoneOf(engine, id("m")), "discard", "control: destroyed");
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 0);
});

/** A free tactic with threshold `threshold` that draws... nothing: playable only when the threshold is met. */
const gatedTactic = (threshold: string) => tactic({ name: `Gated ${threshold}`, cost: 0, threshold, behavior: { abilities: [{ id: "g", type: "activated", effects: [] }] } });

clause(MINION, "1:provides", "its [O] meets a card's [O] threshold: with only a Minion in play a [O] tactic can be played, and without it it cannot", () => {
  const withMinion = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "g", def: gatedTactic("o"), owner: P1, zone: "hand" }
  ]);
  play(withMinion.engine, P1, withMinion.id("g"));
  assert.equal(zoneOf(withMinion.engine, withMinion.id("g")), "discard", "played");
  const without = devBoard([{ key: "g", def: gatedTactic("o"), owner: P1, zone: "hand" }]);
  refused(() => playRaw(without.engine, P1, without.id("g")), "no [O] without the Minion");
  assert.equal(zoneOf(without.engine, without.id("g")), "hand");
});

clause(MINION, "1:provides", "its [O] counts alongside a resource for a two-icon threshold: Minion + one Obsession meet [O][O], Minion alone does not", () => {
  const ok = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    ...res({ obsession: 1 }),
    { key: "g", def: gatedTactic("oo"), owner: P1, zone: "hand" }
  ]);
  play(ok.engine, P1, ok.id("g"));
  assert.equal(zoneOf(ok.engine, ok.id("g")), "discard");
  const bad = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "g", def: gatedTactic("oo"), owner: P1, zone: "hand" }
  ]);
  refused(() => playRaw(bad.engine, P1, bad.id("g")), "one [O] for [O][O]");
});

clause(MINION, "1:provides", "it provides only [O]: it does not meet a Greed threshold", () => {
  const bad = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "g", def: gatedTactic("g"), owner: P1, zone: "hand" }
  ]);
  refused(() => playRaw(bad.engine, P1, bad.id("g")), "[G] threshold with only a Minion");
});

clause(MINION, "1:provides", "it provides icons but is not a resource to PAY with: a card of cost 1 cannot be paid with a Minion alone", () => {
  const costly = tactic({ name: "Costly", cost: 1, threshold: "o", behavior: { abilities: [{ id: "c", type: "activated", effects: [] }] } });
  const bad = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    { key: "c", def: costly, owner: P1, zone: "hand" }
  ]);
  assert.equal(ready(bad.engine), 0, "a Minion is not a resource to pay with");
  refused(() => playRaw(bad.engine, P1, bad.id("c")), "nothing to pay the 1 with");
  const good = devBoard([
    { key: "m", def: printing(MINION), owner: P1, zone: "play" },
    ...res({ greed: 1 }),
    { key: "c", def: costly, owner: P1, zone: "hand" }
  ]);
  play(good.engine, P1, good.id("c"));
  assert.equal(zoneOf(good.engine, good.id("c")), "discard", "control: with a real resource to pay the 1 and the Minion's [O] for the threshold it works");
});

clause(MINION, "1:provides", "deployed from hand it costs 3 and needs [O]; once in play it provides its own [O]", () => {
  const g = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "hand" }, ...res({ obsession: 3 })]);
  const before = ready(g.engine);
  play(g.engine, P1, g.id("m"));
  assert.equal(before - ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).obsession ?? 0, 4, "the three Obsession resources and the Minion");
  const short = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "hand" }, ...res({ obsession: 2 })]);
  refused(() => playRaw(short.engine, P1, short.id("m")), "2 resources for a cost of 3");
  const noThreshold = devBoard([{ key: "m", def: printing(MINION), owner: P1, zone: "hand" }, ...res({ greed: 3 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("m")), "no [O]");
});

clause(MINION, "1:provides", "printed stats: 2 strength, 3 speed, 1 life", () => {
  const { engine, id } = minionBoard();
  assert.equal(engine.getStat(id("m"), "strength"), 2);
  assert.equal(engine.getStat(id("m"), "speed"), 3);
  assert.equal(engine.getStat(id("m"), "life"), 1);
});

// =================================================================================
// Muddle
// COST: Play this only in response to a tactic being played. Pay X, where X is its
// numeric cost. -- EFFECT: Duplicate the tactic. Terminate the tactic.
// Tactic, cost 0, [O][O][O].
// =================================================================================

const MUDDLE = "102d3f1f-e47a-4edf-bc68-a5df45643cb4";

/** A tactic that deals 3 damage to the faction of its controller's opponent. */
function drainTactic(opts: { cost?: number; threshold?: string; extraPay?: number; name?: string } = {}): CardDefinition {
  return tactic({
    name: opts.name ?? "Drain",
    cost: opts.cost ?? 3,
    threshold: opts.threshold ?? 0,
    behavior: {
      abilities: [
        {
          id: "dr",
          type: "activated",
          ...(opts.extraPay ? { costs: [{ type: "payResources", amount: opts.extraPay }] } : {}),
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 }]
        }
      ]
    }
  });
}

/** A tactic (pick "t") that deals 2 damage to a picked character. */
const zapTactic = (cost = 1, name = "Zap"): CardDefinition =>
  tactic({
    name,
    cost,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        }
      ]
    }
  });

/** A tactic that draws a card for its controller. */
const drawTactic = (cost = 2, name = "Study"): CardDefinition =>
  tactic({ name, cost, behavior: { abilities: [{ id: "st", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

function muddleBoard(opts: { icons?: Icons; oppIcons?: Icons; extra?: CardPlacement[]; mud?: "hand" | "discard"; active?: PlayerId; turn?: number } = {}) {
  return devBoard(
    [
      { key: "mud", def: printing(MUDDLE), owner: P1, zone: opts.mud ?? "hand" },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      ...fillers("md", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...res(opts.icons ?? { obsession: 8 }),
      ...res(opts.oppIcons ?? { rage: 8, obsession: 3 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type MuddleGame = ReturnType<typeof muddleBoard>;

/** P2 plays the tactic `oppKey`; P1 holds priority afterwards. */
function oppPlays(g: MuddleGame, oppKey: string, selected: Record<string, CardInstanceId[]> = {}): void {
  playRaw(g.engine, P2, g.id(oppKey), { selected });
  assert.equal(g.engine.state.priorityPlayerId, P1, "control: I may respond");
}

/** P2 plays `oppKey`, I respond with Muddle; returns what Muddle itself cost me (measured right after it was played). */
function muddleOn(g: MuddleGame, oppKey: string, oppSelected: Record<string, CardInstanceId[]> = {}, muddleSelected: Record<string, CardInstanceId[]> = {}): { paid: number } {
  oppPlays(g, oppKey, oppSelected);
  const before = ready(g.engine, P1);
  playRaw(g.engine, P1, g.id("mud"), { selected: muddleSelected });
  const paid = before - ready(g.engine, P1);
  resolvePendingResponses(g.engine);
  return { paid };
}

const muddleAttempt = (g: MuddleGame) => () => playRaw(g.engine, P1, g.id("mud"));

clause(MUDDLE, "0:ability", "the tactic is duplicated under MY control and terminated: its effect hits my opponent's faction instead of mine, and the original goes to its owner's discard pile", () => {
  const g = muddleBoard({ extra: [{ key: "drain", def: drainTactic(), owner: P2, zone: "hand" }] });
  const { paid } = muddleOn(g, "drain");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P1), 30, "the original (which would have hit me) was terminated");
  assert.equal(influenceOf(g.engine, P2), 27, "the duplicate is mine: 'their opponent's faction' is theirs, 3 damage");
  assert.equal(zoneOf(g.engine, g.id("drain")), "discard", "a terminated card goes to its owner's discard pile (CR 314.1)");
  assert.ok(discardOf(g.engine, P2).includes(g.id("drain")), "discardOf(g.engine, P2).includes(g.id(\"drain\"))");
  assert.equal(zoneOf(g.engine, g.id("mud")), "discard", "Muddle ends in my discard pile");
  assert.equal(paid, 3, "X = the tactic's numeric cost (3)");
});

for (const cost of [0, 1, 5]) {
  clause(MUDDLE, "0:ability", `Pay X: X is the numeric cost of the tactic -- a cost-${cost} tactic costs me exactly ${cost}`, () => {
    const g = muddleBoard({ extra: [{ key: "drain", def: drainTactic({ cost }), owner: P2, zone: "hand" }] });
    const { paid } = muddleOn(g, "drain");
    assert.equal(paid, cost);
    assert.equal(influenceOf(g.engine, P2), 27, "control: the duplicate resolved");
  });
}

clause(MUDDLE, "0:ability", "Pay X: with fewer than X resources ready it is refused and nothing changes (X = 5, four resources ready); with enough it works", () => {
  const bad = muddleBoard({ icons: { obsession: 4 }, extra: [{ key: "drain", def: drainTactic({ cost: 5 }), owner: P2, zone: "hand" }] });
  oppPlays(bad, "drain");
  refused(muddleAttempt(bad), "4 resources for X = 5");
  assert.equal(zoneOf(bad.engine, bad.id("mud")), "hand");
  assert.equal(ready(bad.engine), 4, "nothing was paid");
  const good = muddleBoard({ icons: { obsession: 5 }, extra: [{ key: "drain", def: drainTactic({ cost: 5 }), owner: P2, zone: "hand" }] });
  const { paid } = muddleOn(good, "drain");
  assert.equal(paid, 5);
});

clause(MUDDLE, "0:ability", "Pay X: resources already spent do not count (X = 3: five resources of which three are attached leaves two)", () => {
  const bad = muddleBoard({
    icons: { obsession: 3 },
    extra: [{ key: "drain", def: drainTactic({ cost: 3 }), owner: P2, zone: "hand" }, ...res({ obsession: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))]
  });
  assert.equal(ready(bad.engine), 3);
  const ok = muddleOn(bad, "drain");
  assert.equal(ok.paid, 3, "control: exactly the 3 ready resources pay for X = 3");
  const short = muddleBoard({
    icons: { obsession: 2 },
    extra: [{ key: "drain", def: drainTactic({ cost: 3 }), owner: P2, zone: "hand" }, ...res({ obsession: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))]
  });
  oppPlays(short, "drain");
  refused(muddleAttempt(short), "only 2 ready");
  assert.equal(zoneOf(short.engine, short.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "its own threshold [O][O][O]: two [O] among many other resources are refused, three work", () => {
  const two = muddleBoard({ icons: { obsession: 2, greed: 6 }, extra: [{ key: "drain", def: drainTactic({ cost: 1 }), owner: P2, zone: "hand" }] });
  oppPlays(two, "drain");
  refused(muddleAttempt(two), "only two [O]");
  assert.equal(zoneOf(two.engine, two.id("mud")), "hand");
  const none = muddleBoard({ icons: { greed: 8 }, extra: [{ key: "drain", def: drainTactic({ cost: 1 }), owner: P2, zone: "hand" }] });
  oppPlays(none, "drain");
  refused(muddleAttempt(none), "no [O]");
  const three = muddleBoard({ icons: { obsession: 3, greed: 2 }, extra: [{ key: "drain", def: drainTactic({ cost: 1 }), owner: P2, zone: "hand" }] });
  const { paid } = muddleOn(three, "drain");
  assert.equal(paid, 1, "control: three [O] are enough");
});

clause(MUDDLE, "0:ability", "the threshold still applies when X = 0", () => {
  const g = muddleBoard({ icons: { obsession: 2 }, extra: [{ key: "drain", def: drainTactic({ cost: 0 }), owner: P2, zone: "hand" }] });
  oppPlays(g, "drain");
  refused(muddleAttempt(g), "two [O] for a three-[O] threshold, even at X = 0");
});

clause(MUDDLE, "0:ability", "my opponent's [O] and my face-down cards do not meet the threshold", () => {
  const g = muddleBoard({
    icons: { obsession: 1, greed: 6 },
    oppIcons: { obsession: 8, rage: 3 },
    extra: [
      { key: "drain", def: drainTactic({ cost: 1 }), owner: P2, zone: "hand" },
      { key: "fd1", def: character({ name: "Hidden 1" }), owner: P1, zone: "play", faceDown: true },
      { key: "fd2", def: character({ name: "Hidden 2" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  oppPlays(g, "drain");
  refused(muddleAttempt(g), "one [O] of mine");
});

// 'in response to a tactic being played'

clause(MUDDLE, "0:ability", "'Play this only in response to a tactic being played': refused with nothing to respond to (no window)", () => {
  const g = muddleBoard();
  refused(muddleAttempt(g), "no tactic being played", /Only the active player may deploy/);
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(MUDDLE, "0:ability", "refused in response to an ABILITY (not a tactic), and the control: the same board with a tactic works", () => {
  const useful = character({ name: "Their Drawer", behavior: { abilities: [{ id: "ab", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const g = muddleBoard({ extra: [{ key: "drawer", def: useful, owner: P2, zone: "play" }] });
  actRaw(g.engine, P2, g.id("drawer"), "ab");
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(muddleAttempt(g), "responding to an ability");
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

clause(MUDDLE, "0:ability", "refused in response to a CHARACTER being deployed", () => {
  const g = muddleBoard({ extra: [{ key: "guy", def: character({ name: "Their Guy", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("guy"));
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(muddleAttempt(g), "responding to a character");
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "refused in response to an ITEM being deployed", () => {
  const g = muddleBoard({ extra: [{ key: "thing", def: item({ name: "Their Thing", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("thing"));
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(muddleAttempt(g), "responding to an item");
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "refused in response to the end of the turn being announced", () => {
  const g = muddleBoard();
  g.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(muddleAttempt(g), "responding to end of turn");
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "refused in response to an attack", () => {
  const g = muddleBoard({ extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(muddleAttempt(g), "responding to an attack");
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "I cannot respond to my own tactic: on my turn Muddle cannot answer my own play", () => {
  const g = muddleBoard({ turn: 1, active: P1, extra: [{ key: "mine", def: drainTactic({ cost: 1, name: "My Drain" }), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("mine"));
  refused(muddleAttempt(g), "responding to my own tactic", /priority/);
  assert.equal(zoneOf(g.engine, g.id("mud")), "hand");
});

clause(MUDDLE, "0:ability", "in a chain it answers the tactic on top: I play a tactic, my opponent responds with theirs, and Muddle copies and terminates THEIR tactic", () => {
  const g = muddleBoard({
    turn: 1,
    active: P1,
    extra: [
      { key: "mine", def: drainTactic({ cost: 1, name: "My Drain" }), owner: P1, zone: "hand" },
      { key: "theirs", def: drainTactic({ cost: 2, name: "Their Drain" }), owner: P2, zone: "hand" }
    ]
  });
  playRaw(g.engine, P1, g.id("mine"));
  playRaw(g.engine, P2, g.id("theirs"));
  assert.equal(g.engine.state.priorityPlayerId, P1, "I may respond to their response");
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("mud"));
  assert.equal(before - ready(g.engine), 2, "X = the numeric cost of THEIR tactic (2), not mine (1)");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard", "their tactic was terminated");
  assert.equal(influenceOf(g.engine, P1), 30, "their tactic did not hit me");
  assert.equal(influenceOf(g.engine, P2), 24, "Muddle's duplicate of their tactic and my own Drain both hit them: 3 + 3");
});

// Duplicate / Terminate

clause(MUDDLE, "0:ability", "Terminate: the original tactic's effect never happens (no damage to me), even though my opponent paid for it", () => {
  const g = muddleBoard({ extra: [{ key: "drain", def: drainTactic({ cost: 3 }), owner: P2, zone: "hand" }] });
  const oppBefore = ready(g.engine, P2);
  muddleOn(g, "drain");
  assert.equal(influenceOf(g.engine, P1), 30);
  assert.equal(oppBefore - ready(g.engine, P2), 3, "their payment stays paid");
});

clause(MUDDLE, "0:ability", "Duplicate: the copy's effects are carried out by ME: a 'draw a card' tactic makes me draw, not my opponent", () => {
  const g = muddleBoard({ extra: [{ key: "study", def: drawTactic(2), owner: P2, zone: "hand" }] });
  const myTop = deckOf(g.engine, P1)[0];
  const theirDeck = deckOf(g.engine, P2);
  muddleOn(g, "study");
  assert.equal(zoneOf(g.engine, myTop), "hand", "I drew the card");
  assert.deepEqual(deckOf(g.engine, P2), theirDeck, "my opponent drew nothing: their tactic was terminated");
});

clause(MUDDLE, "0:ability", "Duplicate: the copy has cost number 0 and needs no threshold -- a tactic needing [R][R] is copied though I control no Rage", () => {
  const g = muddleBoard({ icons: { obsession: 8 }, extra: [{ key: "drain", def: drainTactic({ cost: 2, threshold: "rr" }), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  const { paid } = muddleOn(g, "drain");
  assert.equal(influenceOf(g.engine, P2), 27, "the duplicate resolved");
  assert.equal(paid, 2, "Muddle's X");
  assert.equal(before - ready(g.engine), 2, "the copy cost nothing more (cost number 0)");
});

clause(MUDDLE, "0:ability", "Duplicate: the copy's extra costs (here, its pick) are satisfied by ME: I pick the copy's target, not the original's", () => {
  const g = muddleBoard({ extra: [{ key: "zap", def: zapTactic(1), owner: P2, zone: "hand" }] });
  // the opponent aims their Zap at MY Ally
  muddleOn(g, "zap", { t: [g.id("ally")] }, { t: [g.id("foe")] });
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(g.engine.state.cards[g.id("ally")].damage, 0, "the copy is mine: it does not hit my own character just because the original aimed there");
  assert.equal(g.engine.state.cards[g.id("foe")].damage, 2, "I picked their Foe for the copy");
});

clause(MUDDLE, "0:ability", "Pay X: X is the tactic's numeric cost while it is being played (CR 406.3): printed cost 1 plus an extra 'pay 2' makes X = 3", () => {
  const g = muddleBoard({ extra: [{ key: "xp", def: drainTactic({ cost: 1, extraPay: 2 }), owner: P2, zone: "hand" }] });
  const oppBefore = ready(g.engine, P2);
  oppPlays(g, "xp");
  assert.equal(oppBefore - ready(g.engine, P2), 3, "control: my opponent paid 1 + 2");
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("mud"));
  assert.equal(before - ready(g.engine), 3, "X = 3, what the tactic cost to play");
});

clause(MUDDLE, "0:ability", "Duplicate: the copy still has the original's extra costs (CR 307.1): a copy of a tactic with an extra 'pay 2' costs me 2 more", () => {
  const g = muddleBoard({ icons: { obsession: 10 }, extra: [{ key: "xp", def: drainTactic({ cost: 1, extraPay: 2 }), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  oppPlays(g, "xp");
  playRaw(g.engine, P1, g.id("mud"));
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27, "control: the copy resolved");
  assert.equal(before - ready(g.engine), 3 + 2, "Muddle's X (1 + 2) plus the copy's extra 'pay 2'");
});

clause(MUDDLE, "0:ability", "the played Muddle goes to my discard pile and nothing else of mine moves", () => {
  const g = muddleBoard({ extra: [{ key: "drain", def: drainTactic(), owner: P2, zone: "hand" }] });
  muddleOn(g, "drain");
  assert.equal(zoneOf(g.engine, g.id("mud")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(MUDDLE, "0:ability", "being a tactic it can only be played from my hand: refused from my discard pile", () => {
  const g = muddleBoard({ mud: "discard", extra: [{ key: "drain", def: drainTactic({ cost: 1 }), owner: P2, zone: "hand" }] });
  oppPlays(g, "drain");
  refused(muddleAttempt(g), "from my discard pile");
  assert.equal(zoneOf(g.engine, g.id("mud")), "discard");
});

// =================================================================================
// Nattering Stoopswaggler
// COVERT
// If you played this card using FLIP UP, it enters play with a token on it.
// While there is a token on this card, it loses COVERT and gains 1 strength and 1 life.
// If there are no tokens on this card and it's destroyed, flip it face-down under its
// owner's control instead.
// FLIP UP: 3 [O][O]
// Character (monstrosity), cost 5, [O][O], 3 strength / 3 speed / 3 life.
// =================================================================================

const NATTER = "9f1639c2-f84f-4b74-b222-aae1fe8bfb4f";

function natterBoard(
  opts: {
    natter?: "play" | "hand" | "faceDown" | "discard";
    tokens?: number;
    icons?: Icons;
    oppIcons?: Icons;
    controller?: PlayerId;
    owner?: PlayerId;
    spent?: boolean;
    turn?: number;
    active?: PlayerId;
    eligible?: boolean;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.natter ?? "play";
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      {
        key: "n",
        def: printing(NATTER),
        owner,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        counters: opts.tokens ? { token: opts.tokens } : undefined,
        attachedToKey: opts.spent ? "__factionA" : undefined,
        attackEligible: opts.eligible
      },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9, strength: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type NatterGame = ReturnType<typeof natterBoard>;
const natterFlags = (g: NatterGame) => ({ zone: zoneOf(g.engine, g.id("n")), faceDown: g.engine.state.cards[g.id("n")].faceDown });

/** A free tactic (id "kill") of P2's that destroys the picked character, for a board where P2 is active. */
const killOn = (g: NatterGame, key = "n", killKey = "kill") => play(g.engine, P2, g.id(killKey), { selected: { t: [g.id(key)] } });
/** A free tactic with a picked character taking `amount` damage. */
const damageTactic = (amount: number, name = `Hit ${amount}`): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

const killerBoard = (opts: Parameters<typeof natterBoard>[0] = {}) =>
  natterBoard({ turn: 2, active: P2, ...opts, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }, ...(opts.extra ?? [])] });

// --- COVERT -----------------------------------------------------------------------------

clause(NATTER, "0:kw:COVERT", "with no token on it, it has the COVERT keyword (an ordinary character does not)", () => covertHasKeyword(NATTER));
clause(NATTER, "0:kw:COVERT", "with no token on it, attacking alone it cannot be blocked by a non-covert character; a covert character can block it", () => covertCannotBeBlockedByNonCovert(NATTER));
clause(NATTER, "0:kw:COVERT", "with no token on it, in a party with a non-covert member the party is not covert", () => covertPartyNeedsEveryMemberCovert(NATTER));
clause(NATTER, "0:kw:COVERT", "with no token on it, as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(NATTER));

clause(NATTER, "0:kw:COVERT", "a face-down Stoopswaggler is only a resource (CR 411.1): it has no COVERT", () => {
  const { engine, id } = natterBoard({ natter: "faceDown" });
  assert.equal(engine.getKeywords(id("n")).includes("covert"), false);
});

// --- FLIP UP: 3 [O][O] -------------------------------------------------------------------

/** The Stoopswaggler is flipped up on its controller's turn (pay 3, [O][O]). */
const flipNatter = (g: NatterGame, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("n"));

clause(NATTER, "4:flipUp", "a face-down Stoopswaggler is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = natterBoard({ natter: "faceDown", icons: { obsession: 2 } });
  assert.equal(g.engine.isResource(g.id("n")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(NATTER, "4:flipUp", "flipping it up puts the character face-up into play under my control", () => {
  const g = natterBoard({ natter: "faceDown" });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("n")].controllerId, P1);
  assert.equal(g.engine.isResource(g.id("n")), false, "it is a character now");
});

clause(NATTER, "4:flipUp", "FLIP UP costs 3 (not the card's cost number of 5): with exactly three ready resources, itself included, it works", () => {
  const g = natterBoard({
    natter: "faceDown",
    icons: { obsession: 2 },
    extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  });
  assert.equal(ready(g.engine), 3, "two ready Obsession and the face-down Stoopswaggler itself");
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, false, "flipped with 3 ready resources, not the 5 of its cost number");
});

clause(NATTER, "4:flipUp", "FLIP UP costs 3: two ready resources are refused and nothing changes", () => {
  const g = natterBoard({
    natter: "faceDown",
    icons: { obsession: 1 },
    extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  });
  assert.equal(ready(g.engine), 2);
  refused(() => flipNatter(g), "2 ready resources for a Flip Up cost of 3");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine), 2, "nothing was paid");
});

clause(NATTER, "4:flipUp", "FLIP UP pays no more than 3: with many resources, at most three end up spent", () => {
  const g = natterBoard({ natter: "faceDown", icons: { obsession: 8 } });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 3, "at most three resources were attached to my faction");
  assert.ok(attachedCount(g.engine, P1) >= 2, "at least the two non-Stoopswaggler payments were attached (it can pay for one itself)");
});

clause(NATTER, "4:flipUp", "FLIP UP needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = natterBoard({ natter: "faceDown", icons: { obsession: 1, greed: 6 } });
  refused(() => flipNatter(one), "one [O]");
  assert.equal(one.engine.state.cards[one.id("n")].faceDown, true);
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = natterBoard({ natter: "faceDown", icons: { greed: 6 } });
  refused(() => flipNatter(none), "no [O]");
  const two = natterBoard({ natter: "faceDown", icons: { obsession: 2, greed: 2 } });
  flipNatter(two);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("n")].faceDown, false, "control: two [O] is enough");
});

clause(NATTER, "4:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const g = natterBoard({ natter: "faceDown", icons: { greed: 4 }, oppIcons: { obsession: 4 } });
  refused(() => flipNatter(g), "no [O] of mine");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
});

clause(NATTER, "4:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = natterBoard({ natter: "faceDown", oppIcons: { obsession: 6 } });
  refused(() => flipNatter(theirs, P2), "the opponent cannot flip my card");
  const inHand = natterBoard({ natter: "hand" });
  refused(() => flipNatter(inHand), "in my hand it is not a face-down resource");
  const faceUp = natterBoard({ natter: "play" });
  refused(() => flipNatter(faceUp), "a face-up card in play");
  assert.equal(theirs.engine.state.cards[theirs.id("n")].faceDown, true);
});

clause(NATTER, "4:flipUp", "FLIP UP does not change when a character can be deployed (CR 507.4d): it cannot be flipped on my opponent's turn outside a response window", () => {
  const g = natterBoard({ natter: "faceDown", turn: 2, active: P2 });
  refused(() => flipNatter(g), "not my turn");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
});

clause(NATTER, "4:flipUp", "FLIP UP does not change when a character can be deployed (CR 507.4d): it cannot be flipped up in response during my opponent's turn", () => {
  const g = natterBoard({ natter: "faceDown", turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => flipNatter(g), "a character can only be deployed on my own turn");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
});

clause(NATTER, "4:flipUp", "a flipped-up character cannot attack that turn (it is a new card that did not start the turn in play)", () => {
  const g = natterBoard({ natter: "faceDown", turn: 1 });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("n")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
});

clause(NATTER, "4:flipUp", "a face-down Stoopswaggler that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = natterBoard({ natter: "faceDown", spent: true });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, false);
});

clause(NATTER, "4:flipUp", "a flipped-up character is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = natterBoard({ natter: "faceDown" });
  holdFlipUp(() => flipNatter(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(g.engine.state.cards[g.id("n")].zone, "deploying", "it has not entered play yet: it is being deployed");
});

// --- 1:rule: enters play with a token when played using FLIP UP ---------------------------

clause(NATTER, "1:rule", "played using FLIP UP it enters play with exactly one token on it", () => {
  const g = natterBoard({ natter: "faceDown" });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("n")), 1);
});

clause(NATTER, "1:rule", "played using FLIP UP it has the token's benefits at once: 4 strength, 4 life, no COVERT", () => {
  const g = natterBoard({ natter: "faceDown" });
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("n"), "life"), 4);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), false);
});

clause(NATTER, "1:rule", "deployed from my hand the normal way it enters play with NO token (3/3 and COVERT)", () => {
  const g = natterBoard({ natter: "hand" });
  play(g.engine, P1, g.id("n"));
  assert.equal(zoneOf(g.engine, g.id("n")), "play", "control: it was deployed");
  assert.equal(tokensOn(g.engine, g.id("n")), 0);
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 3);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), true);
});

clause(NATTER, "1:rule", "a normal deploy costs the card's cost number of 5 and needs [O][O]", () => {
  const g = natterBoard({ natter: "hand", icons: { obsession: 5 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("n"));
  assert.equal(before - ready(g.engine), 5);
  const short = natterBoard({ natter: "hand", icons: { obsession: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("n")), "4 resources for a cost of 5");
  const noThreshold = natterBoard({ natter: "hand", icons: { greed: 6 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("n")), "no [O]");
});

clause(NATTER, "1:rule", "put into play by an effect (not FLIP UP) it enters with no token", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = natterBoard({ natter: "hand", extra: [{ key: "pip", def: putter, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(tokensOn(g.engine, g.id("n")), 0);
});

// --- 2:rule: while there is a token it loses COVERT and gains 1 strength and 1 life -------------

clause(NATTER, "2:rule", "with a token: 4 strength, 4 life, and the speed stays 3", () => {
  const g = natterBoard({ tokens: 1 });
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("n"), "life"), 4);
  assert.equal(g.engine.getStat(g.id("n"), "speed"), 3);
});

clause(NATTER, "2:rule", "with a token it loses COVERT", () => {
  const g = natterBoard({ tokens: 1 });
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), false);
});

clause(NATTER, "2:rule", "without a token: 3 strength, 3 life, 3 speed and COVERT", () => {
  const g = natterBoard();
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("n"), "life"), 3);
  assert.equal(g.engine.getStat(g.id("n"), "speed"), 3);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), true);
});

clause(NATTER, "2:rule", "the bonus is +1/+1 for 'a token', not per token: three tokens still make it 4/4", () => {
  const g = natterBoard({ tokens: 3 });
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("n"), "life"), 4);
});

clause(NATTER, "2:rule", "it is live: removing the token takes the bonus away and gives COVERT back; adding one brings it back", () => {
  const g = natterBoard({ tokens: 1 });
  g.engine.state.cards[g.id("n")].counters = {};
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("n"), "life"), 3);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), true);
  g.engine.state.cards[g.id("n")].counters = { token: 1 };
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 4);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), false);
});

clause(NATTER, "2:rule", "only a token on THIS card counts: a token on another of my cards changes nothing", () => {
  const g = natterBoard({ extra: [{ key: "tk", def: character({ name: "Tokened" }), owner: P1, zone: "play", counters: { token: 2 } }] });
  assert.equal(g.engine.getStat(g.id("n"), "strength"), 3);
  assert.equal(g.engine.getKeywords(g.id("n")).includes("covert"), true);
});

clause(NATTER, "2:rule", "the bonus applies to the Stoopswaggler only: my other characters get nothing", () => {
  const g = natterBoard({ tokens: 1, extra: [{ key: "other", def: character({ name: "Other", strength: 1, life: 2 }), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("other"), "life"), 2);
});

clause(NATTER, "2:rule", "with a token and no COVERT, a plain character can block it when it attacks", () => {
  const g = devBoard(
    [
      { key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(g.engine, P1, [g.id("n")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("plainBlocker")] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("plainBlocker")], "a party that is not covert can be blocked by anyone");
});

clause(NATTER, "2:rule", "without a token a plain character cannot block it (control for the previous test)", () => {
  const g = devBoard(
    [
      { key: "n", def: printing(NATTER), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(g.engine, P1, [g.id("n")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("plainBlocker")] }), "a covert party cannot be blocked by a non-covert character");
});

clause(NATTER, "2:rule", "with a token, as a blocker it may block a non-covert attacker (it is no longer covert)", () => {
  const g = devBoard(
    [
      { key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "atk", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("n")] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("n")]);
});

clause(NATTER, "2:rule", "the extra life matters: with a token, 3 damage does not destroy it, 4 damage does (4 life)", () => {
  const g = killerBoard({ tokens: 1, extra: [{ key: "hit3", def: damageTactic(3, "Hit Three"), owner: P2, zone: "hand" }, { key: "hit1", def: damageTactic(1, "Hit One"), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("hit3"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "play", "3 damage on 4 life");
  assert.equal(g.engine.state.cards[g.id("n")].damage, 3);
  play(g.engine, P2, g.id("hit1"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "discard", "4 damage on 4 life: destroyed (it has a token, so no flipping)");
});

clause(NATTER, "2:rule", "the extra strength matters: with a token it deals 4 damage to a faction in battle, without one 3", () => {
  for (const [tokens, expected] of [
    [1, 4],
    [0, 3]
  ] as const) {
    const g = devBoard([{ key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : undefined }], { turn: 2, activePlayerId: P1 });
    declareAttackBy(g.engine, P1, [g.id("n")]);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    finishBattle(g.engine);
    assert.equal(influenceOf(g.engine, P2), 30 - expected, `${tokens} token(s): ${expected} damage`);
  }
});

// --- 3:rule: no tokens and destroyed -> flip face-down under its owner's control instead --------

clause(NATTER, "3:rule", "destroyed with no token on it: it is flipped face-down instead and stays in play as a resource, not in the discard pile", () => {
  const g = killerBoard();
  killOn(g);
  assert.equal(g.engine.state.pendingChoice, undefined, "the replacement is mandatory: nobody is asked");
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("n")), false);
  assert.equal(g.engine.isResource(g.id("n")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(NATTER, "3:rule", "the face-down card is under its owner's control and carries no damage, tokens or depletion", () => {
  const g = killerBoard();
  killOn(g);
  const card = g.engine.state.cards[g.id("n")];
  assert.equal(card.controllerId, P1);
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.equal(tokensOn(g.engine, g.id("n")), 0);
});

clause(NATTER, "3:rule", "destroyed WITH a token it is destroyed normally into its owner's discard pile", () => {
  const g = killerBoard({ tokens: 1 });
  killOn(g);
  assert.equal(zoneOf(g.engine, g.id("n")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("n")), "discardOf(g.engine, P1).includes(g.id(\"n\"))");
});

clause(NATTER, "3:rule", "'under its owner's control': a Stoopswaggler I own but my opponent controls is flipped face-down under MY control", () => {
  const g = killerBoard({ controller: P2 });
  killOn(g);
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("n")].controllerId, P1, "back under its owner's control");
  assert.ok(playOf(g.engine, P1).includes(g.id("n")), "playOf(g.engine, P1).includes(g.id(\"n\"))");
  assert.equal(playOf(g.engine, P2).includes(g.id("n")), false);
});

clause(NATTER, "3:rule", "it works for my opponent's own copy too: it is flipped face-down under THEIR control", () => {
  const g = devBoard(
    [
      { key: "n", def: printing(NATTER), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 1, activePlayerId: P1 }
  );
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("n")].controllerId, P2);
});

clause(NATTER, "3:rule", "lethal damage from an effect counts as destruction: with no token it flips face-down instead", () => {
  const g = natterBoard({ turn: 2, active: P2, extra: [{ key: "hit", def: damageTactic(3), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("hit"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("n")].damage, 0, "the damage is reduced to 0 (CR 506.6)");
});

clause(NATTER, "3:rule", "lethal battle damage counts as destruction too: a blocking Stoopswaggler with no token (blocking a covert attacker) is flipped face-down", () => {
  const g = devBoard(
    [
      { key: "n", def: printing(NATTER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Covert Attacker", strength: 5, life: 9, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("n")] });
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("n")), "play", "it was 'destroyed' by 5 damage on 3 life: flipped face-down instead");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("n")].damage, 0);
});

clause(NATTER, "3:rule", "a token added in response to the kill changes the outcome: it is destroyed normally", () => {
  const g = killerBoard({ extra: [{ key: "give", def: tokenGiver(1), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("n")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("give"), { t: [g.id("n")] });
  assert.equal(zoneOf(g.engine, g.id("n")), "discard", "with a token on it when it is destroyed, the replacement does not apply");
});

clause(NATTER, "3:rule", "the replacement is only for being DESTROYED: put into its owner's hand it simply goes to hand", () => {
  const g = natterBoard({ turn: 2, active: P2, extra: [{ key: "bounce", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("bounce"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "hand");
});

clause(NATTER, "3:rule", "...and removed from the game it is removed", () => {
  const g = natterBoard({ turn: 2, active: P2, extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("rm"), { selected: { t: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "removed");
});

clause(NATTER, "3:rule", "a replacement does not apply to a destroy paid as a COST (CR 506.2): destroyed as an extra cost it goes to the discard pile", () => {
  const altar = item({
    name: "Altar",
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "v", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
          costs: [{ type: "sacrificeSelected", declarationId: "v", disposition: "destroy" }],
          effects: []
        }
      ]
    }
  });
  const g = natterBoard({ extra: [{ key: "altar", def: altar, owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("altar"), "sac", { selected: { v: [g.id("n")] } });
  assert.equal(zoneOf(g.engine, g.id("n")), "discard", "destroyed as a cost, so the replacement does not happen");
});

clause(NATTER, "3:rule", "the flipped-down card is a real face-down resource: it can be flipped up again with FLIP UP, and then it enters with a token", () => {
  const g = killerBoard({ icons: { obsession: 8 } });
  killOn(g);
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, true);
  g.engine.state.activePlayerId = P1;
  g.engine.state.turn = 3;
  flipNatter(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, false);
  assert.equal(tokensOn(g.engine, g.id("n")), 1);
});

clause(NATTER, "3:rule", "other characters destroyed are unaffected: an ordinary character still goes to the discard pile", () => {
  const g = killerBoard();
  killOn(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(g.engine.state.cards[g.id("n")].faceDown, false);
});

// =================================================================================
// Obscene Astrologer
// GAZE UPON THE "STARS" -- COST: Deplete this card. -- EFFECT: You may play a tactic with
// numeric cost X or less for free, where X is either 5 or the number of [O] you control,
// whichever is lower.
// Character (wizard), cost 2, [O], 1 strength / 3 speed / 2 life.
// =================================================================================

const ASTRO = "4c9c9c1f-d3e1-4ebe-9ff1-8d2295cb79b0";
const GAZE = "gaze";

/** A tactic of the given cost (and threshold) that deals 1 damage to its controller's opponent's faction. */
const costTactic = (cost: number, threshold: string | number = 0, name = `Tactic ${cost}`): CardDefinition =>
  tactic({
    name,
    cost,
    threshold,
    behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] }
  });

function astroBoard(
  opts: {
    icons?: Icons;
    oppIcons?: Icons;
    depleted?: boolean;
    astro?: "play" | "hand" | "discard";
    eligible?: boolean;
    costs?: number[];
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "a", def: printing(ASTRO), owner: P1, zone: opts.astro ?? "play", depleted: opts.depleted, attackEligible: opts.eligible },
      ...(opts.costs ?? [0, 1, 2, 3, 4, 5, 6]).map((cost) => ({ key: `t${cost}`, def: costTactic(cost), owner: P1, zone: "hand" as const })),
      { key: "hchar", def: character({ name: "Hand Character", cost: 1 }), owner: P1, zone: "hand" },
      { key: "hitem", def: item({ name: "Hand Item", cost: 1 }), owner: P1, zone: "hand" },
      { key: "dTac", def: costTactic(0, 0, "Discard Tactic"), owner: P1, zone: "discard" },
      { key: "kTac", def: costTactic(0, 0, "Deck Tactic"), owner: P1, zone: "deck" },
      { key: "oTac", def: costTactic(0, 0, "Their Tactic"), owner: P2, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 5 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type AstroGame = ReturnType<typeof astroBoard>;
const gaze = (g: AstroGame) => activate(g.engine, P1, g.id("a"), GAZE);
const gazeAttempt = (g: AstroGame, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("a"), GAZE);
/** Answers the open "play a tactic for free" choice with the tactic `key` (and its picks), or declines when `key` is undefined. */
function gazeAnswer(g: AstroGame, key?: string, selected: Record<string, CardInstanceId[]> = {}): void {
  g.engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: key ? { kind: "deployForFree", cardId: g.id(key), selected } : { kind: "deployForFree" }
  } as never);
  resolvePendingResponses(g.engine);
}
/** Uses GAZE and plays tactic `key` for free. */
function gazePlays(g: AstroGame, key: string, selected: Record<string, CardInstanceId[]> = {}): void {
  gaze(g);
  expectPending(g.engine, "deployForFree");
  gazeAnswer(g, key, selected);
}
/** Whether `key` can be played via GAZE on a fresh board built by `make` (true = played, false = refused). */
function gazeCanPlay(make: () => AstroGame, key: string): boolean {
  const g = make();
  gaze(g);
  try {
    gazeAnswer(g, key);
  } catch (error) {
    // a refusal for a game-rules reason (not a test bug): same wrong-reason filter as `refused`
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(!(error instanceof TypeError), `the test threw a TypeError (${message})`);
    assert.ok(!/priority|not found|unknown|undefined|already ended|did not converge/i.test(message), `refused for the wrong reason (${message})`);
    return false;
  }
  return zoneOf(g.engine, g.id(key)) === "discard";
}

clause(ASTRO, "0:ability:gaze", "plays a tactic from my hand for free: its effect happens, it ends in my discard pile, and no resource is paid for it", () => {
  const g = astroBoard({ icons: { obsession: 5 } });
  const before = ready(g.engine);
  gazePlays(g, "t3");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P2), 29, "the tactic's effect happened (1 damage to their faction)");
  assert.equal(zoneOf(g.engine, g.id("t3")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("t3")), "discardOf(g.engine, P1).includes(g.id(\"t3\"))");
  assert.equal(ready(g.engine), before, "for free: nothing paid");
});

clause(ASTRO, "0:ability:gaze", "COST: Deplete this card -- the Astrologer ends depleted (and still in play)", () => {
  const g = astroBoard();
  gazePlays(g, "t1");
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
});

clause(ASTRO, "0:ability:gaze", "the cost is only the deplete: using it pays no resources even to start with", () => {
  const g = astroBoard({ icons: { obsession: 3 } });
  const before = ready(g.engine);
  gaze(g);
  assert.equal(ready(g.engine), before);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true, "depleted as a cost, before anything is chosen");
  gazeAnswer(g, undefined);
});

clause(ASTRO, "0:ability:gaze", "'You may play': declining plays nothing, but the Astrologer stays depleted", () => {
  const g = astroBoard();
  gaze(g);
  expectPending(g.engine, "deployForFree");
  gazeAnswer(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["t0", "t1", "t2", "t3", "t4", "t5", "t6"]) assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} stays in hand`);
  assert.equal(influenceOf(g.engine, P2), 30);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true);
});

// X = the lower of 5 and the number of [O] I control

for (const [obsession, canKey, cannotKey, why] of [
  [3, "t3", "t4", "3 [O]: a cost-3 tactic yes, a cost-4 tactic no"],
  [1, "t1", "t2", "1 [O]: cost 1 yes, cost 2 no"],
  [5, "t5", "t6", "5 [O]: cost 5 yes, cost 6 no"],
  [8, "t5", "t6", "8 [O]: the cap of 5 applies: cost 5 yes, cost 6 no"]
] as const) {
  clause(ASTRO, "0:ability:gaze", `X is the lower of 5 and the number of [O] I control -- ${why}`, () => {
    const make = () => astroBoard({ icons: { obsession } });
    assert.equal(gazeCanPlay(make, canKey), true, `${canKey} can be played`);
    assert.equal(gazeCanPlay(make, cannotKey), false, `${cannotKey} cannot`);
    const g = make();
    gaze(g);
    refused(() => gazeAnswer(g, cannotKey), `${cannotKey} costs more than X`);
    assert.equal(zoneOf(g.engine, g.id(cannotKey)), "hand");
  });
}

clause(ASTRO, "0:ability:gaze", "with 6 [O] X is still 5 (the lower of the two): a cost-6 tactic is refused", () => {
  const g = astroBoard({ icons: { obsession: 6 } });
  gaze(g);
  refused(() => gazeAnswer(g, "t6"), "cost 6 with X = 5");
});

clause(ASTRO, "0:ability:gaze", "with no [O] at all X = 0: only a cost-0 tactic can be played", () => {
  const make = () => astroBoard({ icons: { greed: 4 } });
  assert.equal(gazeCanPlay(make, "t0"), true, "a cost-0 tactic is playable");
  assert.equal(gazeCanPlay(make, "t1"), false, "a cost-1 tactic is not");
});

clause(ASTRO, "0:ability:gaze", "[O] are counted from everything I control: a Minion of Thabbash (PROVIDES [O]) counts, so Minion + 2 Obsession makes X = 3", () => {
  const make = () => astroBoard({ icons: { obsession: 2 }, extra: [{ key: "minion", def: printing(MINION), owner: P1, zone: "play" }] });
  assert.equal(gazeCanPlay(make, "t3"), true);
  assert.equal(gazeCanPlay(make, "t4"), false);
});

clause(ASTRO, "0:ability:gaze", "face-down resources are Volition, not [O]: they do not raise X", () => {
  const make = () =>
    astroBoard({
      icons: { obsession: 1 },
      extra: [
        { key: "fd1", def: character({ name: "Hidden 1" }), owner: P1, zone: "play", faceDown: true },
        { key: "fd2", def: character({ name: "Hidden 2" }), owner: P1, zone: "play", faceDown: true }
      ]
    });
  assert.equal(gazeCanPlay(make, "t1"), true);
  assert.equal(gazeCanPlay(make, "t2"), false);
});

clause(ASTRO, "0:ability:gaze", "my opponent's [O] do not raise X", () => {
  const make = () => astroBoard({ icons: { obsession: 1 }, oppIcons: { obsession: 5 } });
  assert.equal(gazeCanPlay(make, "t1"), true);
  assert.equal(gazeCanPlay(make, "t2"), false);
});

clause(ASTRO, "0:ability:gaze", "spent [O] (attached to my faction) are still [O] I control: they count towards X", () => {
  const make = () => astroBoard({ icons: { obsession: 1 }, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(gazeCanPlay(make, "t3"), true);
  assert.equal(gazeCanPlay(make, "t4"), false);
});

clause(ASTRO, "0:ability:gaze", "X is worked out when the effect resolves: if a response removes one of my [O] resources, a cost-3 tactic is no longer playable but a cost-2 one is", () => {
  const make = () =>
    astroBoard({
      icons: { obsession: 3 },
      extra: [{ key: "mover", def: moverTactic("hand"), owner: P2, zone: "hand" }]
    });
  const bad = make();
  const target = playOf(bad.engine, P1).find((c) => bad.engine.getDefinition(c).type === "resource")!;
  actRaw(bad.engine, P1, bad.id("a"), GAZE);
  assert.equal(bad.engine.state.priorityPlayerId, P2);
  respondWith(bad.engine, P2, bad.id("mover"), { t: [target] });
  expectPending(bad.engine, "deployForFree");
  refused(() => gazeAnswer(bad, "t3"), "X dropped to 2");
  const good = make();
  const target2 = playOf(good.engine, P1).find((c) => good.engine.getDefinition(c).type === "resource")!;
  actRaw(good.engine, P1, good.id("a"), GAZE);
  respondWith(good.engine, P2, good.id("mover"), { t: [target2] });
  gazeAnswer(good, "t2");
  assert.equal(zoneOf(good.engine, good.id("t2")), "discard", "control: a cost-2 tactic is playable with X = 2");
});

// what can be played

clause(ASTRO, "0:ability:gaze", "only a TACTIC: a character or an item in my hand is refused even at a low cost", () => {
  const g = astroBoard();
  gaze(g);
  refused(() => gazeAnswer(g, "hchar"), "a character");
  const h = astroBoard();
  gaze(h);
  refused(() => gazeAnswer(h, "hitem"), "an item");
  const ok = astroBoard();
  gaze(ok);
  gazeAnswer(ok, "t1");
  assert.equal(zoneOf(ok.engine, ok.id("t1")), "discard", "control: a tactic works");
});

clause(ASTRO, "0:ability:gaze", "only from MY HAND: a tactic in my discard pile, my deck or my opponent's hand is refused", () => {
  for (const key of ["dTac", "kTac", "oTac"]) {
    const g = astroBoard();
    gaze(g);
    refused(() => gazeAnswer(g, key), `${key} is not in my hand`);
    assert.notEqual(zoneOf(g.engine, g.id(key)), "play");
  }
});

clause(ASTRO, "0:ability:gaze", "'a tactic': exactly one is played -- after it resolves there is no second prompt and the other tactics stay in hand", () => {
  const g = astroBoard();
  gazePlays(g, "t2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["t0", "t1", "t3", "t4"]) assert.equal(zoneOf(g.engine, g.id(key)), "hand");
});

clause(ASTRO, "0:ability:gaze", "with no tactic in hand nothing can be played (the Astrologer is still depleted)", () => {
  const g = astroBoard({ costs: [] });
  gaze(g);
  const pc = pending(g.engine);
  if (pc) gazeAnswer(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true);
});

// 'for free': cost number 0 but threshold and extra costs still apply (CR 308.1)

clause(ASTRO, "0:ability:gaze", "'for free' does not waive the tactic's threshold: a [G] tactic cannot be played without Greed", () => {
  const make = (greed: number) => astroBoard({ icons: { obsession: 3, greed }, costs: [], extra: [{ key: "tg", def: costTactic(1, "g", "Greedy"), owner: P1, zone: "hand" }] });
  const bad = make(0);
  gaze(bad);
  refused(() => gazeAnswer(bad, "tg"), "no [G]");
  assert.equal(zoneOf(bad.engine, bad.id("tg")), "hand");
  const good = make(1);
  gaze(good);
  gazeAnswer(good, "tg");
  assert.equal(zoneOf(good.engine, good.id("tg")), "discard", "control: with a Greed resource it is played");
});

clause(ASTRO, "0:ability:gaze", "'for free' does not waive the tactic's own picks: a tactic that needs a target is played with it, and the pick must be legal", () => {
  const zap = zapTactic(2, "Zap Pick");
  const make = () => astroBoard({ costs: [], extra: [{ key: "zap", def: zap, owner: P1, zone: "hand" }] });
  const g = make();
  gazePlays(g, "zap", { t: [g.id("foe")] });
  assert.equal(g.engine.state.cards[g.id("foe")].damage, 2);
  assert.equal(zoneOf(g.engine, g.id("zap")), "discard");
  const bad = make();
  gaze(bad);
  refused(() => gazeAnswer(bad, "zap", {}), "no pick for a tactic that needs one");
  assert.equal(zoneOf(bad.engine, bad.id("zap")), "hand");
});

clause(ASTRO, "0:ability:gaze", "'for free' only sets the cost NUMBER to 0 (CR 308.1): a tactic with an extra 'pay 2' still costs 2", () => {
  const g = astroBoard({ costs: [], icons: { obsession: 5 }, extra: [{ key: "xp", def: drainTactic({ cost: 1, extraPay: 2, name: "Extra Pay" }), owner: P1, zone: "hand" }] });
  const before = ready(g.engine);
  gazePlays(g, "xp");
  assert.equal(influenceOf(g.engine, P2), 27, "control: the tactic was played");
  assert.equal(before - ready(g.engine), 2, "the extra 'pay 2' is still paid");
});

clause(ASTRO, "0:ability:gaze", "the tactic is PLAYED, so my opponent may respond to it before it resolves (CR 604.1g)", () => {
  const g = astroBoard();
  gaze(g);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("t2"), selected: {} } } as never);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the tactic is played");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(influenceOf(g.engine, P2), 30, "the tactic has not resolved yet");
});

// timing / who

clause(ASTRO, "0:ability:gaze", "a depleted Astrologer cannot use it (nothing changes); an undepleted one can", () => {
  const bad = astroBoard({ depleted: true });
  refused(gazeAttempt(bad), "already depleted");
  assert.equal(bad.engine.state.pendingChoice, undefined);
  const good = astroBoard();
  gazePlays(good, "t1");
  assert.equal(zoneOf(good.engine, good.id("t1")), "discard");
});

clause(ASTRO, "0:ability:gaze", "once per untap: a second use the same turn is refused, and it untaps on my next turn", () => {
  const g = astroBoard();
  gazePlays(g, "t1");
  refused(gazeAttempt(g), "depleted now");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, false);
  gazePlays(g, "t2");
  assert.equal(zoneOf(g.engine, g.id("t2")), "discard");
});

clause(ASTRO, "0:ability:gaze", "a character may use its abilities the turn it enters play (CR 204.3a)", () => {
  const g = astroBoard({ eligible: false });
  gazePlays(g, "t1");
  assert.equal(zoneOf(g.engine, g.id("t1")), "discard");
});

clause(ASTRO, "0:ability:gaze", "can only be used from play: refused while the Astrologer is in my hand or my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = astroBoard({ astro: zone });
    refused(gazeAttempt(bad), `from ${zone}`);
  }
});

clause(ASTRO, "0:ability:gaze", "only its controller can use it: my opponent cannot activate my Astrologer", () => {
  const g = astroBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(gazeAttempt(g, P2), "the opponent using my Astrologer", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, false);
});

clause(ASTRO, "0:ability:gaze", "can be used in response on the opponent's turn (CR 502.3): the tactic is played then", () => {
  const g = astroBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(gazeAttempt(g), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("a"), GAZE);
  resolvePendingResponses(g.engine);
  gazeAnswer(g, "t2");
  assert.equal(zoneOf(g.engine, g.id("t2")), "discard");
  assert.equal(influenceOf(g.engine, P2), 29);
});

clause(ASTRO, "0:ability:gaze", "the cost is paid when the ability is used, before the opponent can respond; the free play happens when it resolves", () => {
  const g = astroBoard();
  gazeAttempt(g)();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true);
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt yet: the effect has not resolved");
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "deployForFree");
  gazeAnswer(g, undefined);
});

clause(ASTRO, "0:ability:gaze", "the ability resolves as written even if the Astrologer is destroyed in response (CR 502.4)", () => {
  const g = astroBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  gazeAttempt(g)();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("a")] });
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "control: destroyed in response");
  expectPending(g.engine, "deployForFree");
  gazeAnswer(g, "t2");
  assert.equal(zoneOf(g.engine, g.id("t2")), "discard");
});

// =================================================================================
// Otter Floss
// Draw a card. Put a card from your hand on the bottom of your deck. Put this card into
// play under its owner's control as a face-down resource instead of into their discard
// pile.
// Tactic, cost 3, [O].
// =================================================================================

const FLOSS = "ba216f9c-c69d-44ab-8d4f-137d675b4207";

/** A free tactic (pick "dep" in the deploying zone) that terminates the card being played. */
const counterTactic = (): CardDefinition =>
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

function flossBoard(
  opts: { icons?: Icons; deck?: number; hand?: number; floss?: "hand" | "discard"; extra?: CardPlacement[]; turn?: number; active?: PlayerId; owner?: PlayerId } = {}
) {
  return devBoard(
    [
      { key: "fl", def: printing(FLOSS), owner: opts.owner ?? P1, zone: opts.floss ?? "hand" },
      ...fillers("h", opts.hand ?? 2, P1, "hand"),
      ...fillers("k", opts.deck ?? 4, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: mulberry(77) }
  );
}

type FlossGame = ReturnType<typeof flossBoard>;
const floss = (g: FlossGame) => play(g.engine, P1, g.id("fl"));
const flossAttempt = (g: FlossGame) => () => playRaw(g.engine, P1, g.id("fl"));
/** Answers the "put a card from your hand on the bottom" pick. */
const bottomIt = (g: FlossGame, key: string) => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });

clause(FLOSS, "0:rule", "draws the top card, then puts the card I choose from my hand on the bottom of my deck, and Floss ends in play as a face-down resource", () => {
  const g = flossBoard();
  const [top, second, third, fourth] = deckOf(g.engine, P1);
  floss(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  assert.equal(zoneOf(g.engine, top), "hand", "the card was drawn before I choose");
  bottomIt(g, "h1");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("h1")), "deck");
  assert.deepEqual(deckOf(g.engine, P1), [second, third, fourth, g.id("h1")], "the chosen card is the new bottom card; the rest keep their order");
  assert.deepEqual(handOf(g.engine, P1).sort(), [g.id("h0"), top].sort(), "my hand: what I kept and the drawn card");
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
  assert.equal(g.engine.state.cards[g.id("fl")].faceDown, true);
});

clause(FLOSS, "0:rule", "COST: pays exactly its cost of 3", () => {
  const g = flossBoard({ icons: { obsession: 6 } });
  const before = ready(g.engine);
  flossAttempt(g)();
  assert.equal(before - ready(g.engine), 3);
});

clause(FLOSS, "0:rule", "needs [O] and 3 resources: one [O] with 3 resources works, no [O] is refused, 2 resources are refused", () => {
  const ok = flossBoard({ icons: { obsession: 1, greed: 2 } });
  floss(ok);
  expectPending(ok.engine, "chooserSelectsTarget");
  const noO = flossBoard({ icons: { greed: 5 } });
  refused(flossAttempt(noO), "no [O]");
  assert.equal(zoneOf(noO.engine, noO.id("fl")), "hand");
  const short = flossBoard({ icons: { obsession: 2 } });
  refused(flossAttempt(short), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("fl")), "hand");
});

clause(FLOSS, "0:rule", "the card put on the bottom may be the card I just drew", () => {
  const g = flossBoard();
  const drawn = deckOf(g.engine, P1)[0];
  floss(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [drawn] });
  assert.equal(deckOf(g.engine, P1)[deckOf(g.engine, P1).length - 1], drawn, "the drawn card went straight to the bottom");
  assert.equal(handOf(g.engine, P1).length, 2, "my hand is back to its original size");
});

clause(FLOSS, "0:rule", "any card of my hand may be chosen (first or last)", () => {
  for (const key of ["h0", "h1"]) {
    const g = flossBoard();
    floss(g);
    bottomIt(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "deck");
    assert.equal(deckOf(g.engine, P1)[deckOf(g.engine, P1).length - 1], g.id(key));
  }
});

clause(FLOSS, "0:rule", "the card goes to the BOTTOM, not the top: the next draw is not that card", () => {
  const g = flossBoard();
  floss(g);
  bottomIt(g, "h0");
  assert.notEqual(deckOf(g.engine, P1)[0], g.id("h0"));
  assert.equal(deckOf(g.engine, P1).length, 4, "3 left after the draw, plus the one put back");
});

clause(FLOSS, "0:rule", "the card put back is MY hand card: my opponent's hand cards, cards in play and Floss itself are refused; exactly one", () => {
  const g = flossBoard();
  floss(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => bottomIt(g, "oh0"), "a card from my opponent's hand");
  refused(() => bottomIt(g, "ally"), "a card in play");
  refused(() => bottomIt(g, "fl"), "Floss itself (it is being played, not in my hand)");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("h1")] }), "two cards");
  assert.ok(pending(g.engine), "the demand is still standing");
  bottomIt(g, "h1");
  assert.equal(zoneOf(g.engine, g.id("h1")), "deck", "control: one card from my hand works");
});

clause(FLOSS, "0:rule", "putting a card on the bottom is mandatory: declining is refused", () => {
  const g = flossBoard();
  floss(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to put a card back");
  assert.ok(pending(g.engine), "pending(g.engine)");
  assert.equal(handOf(g.engine, P1).length, 3);
});

clause(FLOSS, "0:rule", "with an otherwise empty hand, the drawn card goes straight back to the bottom", () => {
  const g = flossBoard({ hand: 0 });
  const drawn = deckOf(g.engine, P1)[0];
  flossAttempt(g)();
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [drawn] });
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(deckOf(g.engine, P1).length, 4);
  assert.equal(deckOf(g.engine, P1)[3], drawn);
});

clause(FLOSS, "0:rule", "with an empty deck nothing is drawn (no loss) and I still put a card from my hand on the bottom", () => {
  const g = flossBoard({ deck: 0 });
  const inf = influenceOf(g.engine, P1);
  floss(g);
  expectPending(g.engine, "chooserSelectsTarget");
  bottomIt(g, "h0");
  assert.deepEqual(deckOf(g.engine, P1), [g.id("h0")]);
  assert.equal(influenceOf(g.engine, P1), inf);
  assert.equal(g.engine.state.result, undefined);
});

clause(FLOSS, "0:rule", "with an empty deck and an empty hand nothing is asked, and Floss still ends in play face-down", () => {
  const g = flossBoard({ deck: 0, hand: 0 });
  floss(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
  assert.equal(g.engine.state.cards[g.id("fl")].faceDown, true);
});

clause(FLOSS, "0:rule", "'Put this card into play ... as a face-down resource instead of into their discard pile': it is a face-down resource in play, not in the discard pile", () => {
  const g = flossBoard();
  floss(g);
  bottomIt(g, "h0");
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
  assert.equal(g.engine.state.cards[g.id("fl")].faceDown, true);
  assert.equal(g.engine.isResource(g.id("fl")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("fl")), false, "never in the discard pile");
  assert.ok(playOf(g.engine, P1).includes(g.id("fl")), "playOf(g.engine, P1).includes(g.id(\"fl\"))");
});

clause(FLOSS, "0:rule", "the face-down Floss provides Volition and is a new ready resource I can pay with", () => {
  const g = flossBoard({ icons: { obsession: 3 } });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  floss(g);
  bottomIt(g, "h0");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(ready(g.engine), 1, "3 Obsession paid for the cost; the new face-down Floss is a ready resource");
  assert.equal(g.engine.state.cards[g.id("fl")].attachedTo, undefined, "it is not attached to anything");
});

clause(FLOSS, "0:rule", "it enters play under ITS OWNER's control", () => {
  const g = flossBoard();
  floss(g);
  bottomIt(g, "h0");
  assert.equal(g.engine.state.cards[g.id("fl")].controllerId, P1);
  assert.equal(g.engine.state.cards[g.id("fl")].ownerId, P1);
});

clause(FLOSS, "0:rule", "the draw and the put-back happen when it resolves, not when it is played: while my opponent may respond nothing has moved", () => {
  const g = flossBoard();
  const top = deckOf(g.engine, P1)[0];
  flossAttempt(g)();
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, top), "deck", "not drawn yet");
  assert.equal(zoneOf(g.engine, g.id("fl")), "deploying");
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(FLOSS, "0:rule", "a terminated Floss does nothing (no draw, no put-back) and is put into its owner's discard pile, not into play", () => {
  const g = flossBoard({ turn: 1, active: P1, extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }, ...res({ rage: 1 }, P2)] });
  const top = deckOf(g.engine, P1)[0];
  flossAttempt(g)();
  respondWith(g.engine, P2, g.id("counter"), { dep: [g.id("fl")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "deck", "no card was drawn");
  assert.equal(zoneOf(g.engine, g.id("fl")), "discard", "terminated: put into its owner's discard pile (CR 314.1)");
});

clause(FLOSS, "0:rule", "being a tactic it can be played in response on the opponent's turn, and it still ends as a face-down resource", () => {
  const g = flossBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(flossAttempt(g), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("fl"));
  expectPending(g.engine, "chooserSelectsTarget");
  bottomIt(g, "h0");
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
  assert.equal(g.engine.state.cards[g.id("fl")].faceDown, true);
});

clause(FLOSS, "0:rule", "it can only be played from my hand: refused from my discard pile", () => {
  const g = flossBoard({ floss: "discard" });
  refused(flossAttempt(g), "from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("fl")), "discard");
});

clause(FLOSS, "0:rule", "my opponent's hand and deck are untouched", () => {
  const g = flossBoard();
  const oppHand = handOf(g.engine, P2);
  floss(g);
  bottomIt(g, "h0");
  assert.deepEqual(handOf(g.engine, P2), oppHand);
});

// =================================================================================
// Perturb
// Look at your opponent's hand and pick a non-resource card in it. Your opponent discards
// that card. You may pick a card of the same type as the discarded card. If you do, put it
// into its owner's hand.
// Tactic, cost 5, [O][O].
// =================================================================================

const PERTURB = "35c6055b-db4e-428b-ab6a-7caaf564f62f";

function perturbBoard(opts: { icons?: Icons; oppHand?: boolean; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "per", def: printing(PERTURB), owner: P1, zone: "hand" },
      ...(opts.oppHand === false
        ? []
        : [
            { key: "oc", def: character({ name: "Their Character Card", cost: 2 }), owner: P2, zone: "hand" as const },
            { key: "oi", def: item({ name: "Their Item Card", cost: 2 }), owner: P2, zone: "hand" as const },
            { key: "ol", def: location({ name: "Their Location Card", cost: 2 }), owner: P2, zone: "hand" as const },
            { key: "ot", def: tactic({ name: "Their Tactic Card", cost: 2 }), owner: P2, zone: "hand" as const },
            { key: "or", def: resourceCard({ name: "Their Resource Card" }), owner: P2, zone: "hand" as const }
          ]),
      { key: "mc", def: character({ name: "My Character Card" }), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "myPlace", def: location({ name: "My Place" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
      { key: "captured", def: character({ name: "Captured", life: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "foeRes", def: resourceCard({ name: "Their Resource" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { obsession: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PerturbGame = ReturnType<typeof perturbBoard>;
/**
 * Plays Perturb (nothing is picked as a cost), lets the responses resolve and, with `discKey`, answers the
 * "look at their hand and pick a non-resource card" prompt that opens when it resolves. An illegal pick throws and
 * leaves the prompt open (a later call then only answers it). Stops at the second ('same type') pick.
 */
const perturbPlay = (g: PerturbGame, discKey?: string, picks?: string[]) => {
  if ((pending(g.engine) as { kind?: string } | undefined)?.kind !== "chooserSelectsTarget") {
    playRaw(g.engine, P1, g.id("per"), { selected: {} });
    if (!discKey && !picks) return;
    resolvePendingResponses(g.engine);
  }
  answerPending(g.engine, "chooserSelectsTarget", { selected: (picks ?? [discKey!]).map((key) => g.id(key)) });
};
const perturb = (g: PerturbGame, discKey: string) => perturbPlay(g, discKey);
const perturbAttempt = (g: PerturbGame, discKey?: string) => () => perturbPlay(g, discKey);
const perturbPromptOpen = (g: PerturbGame) => (pending(g.engine) as { kind?: string } | undefined)?.kind === "chooserSelectsTarget";
const samePick = (g: PerturbGame, key: string | undefined) => answerPending(g.engine, "chooserSelectsTarget", { selected: key ? [g.id(key)] : [] });

clause(PERTURB, "0:rule", "my opponent discards the non-resource card I picked from their hand; I may then pick a card of the same type (a character) and it goes to its owner's hand", () => {
  const g = perturbBoard();
  const oppHand = handOf(g.engine, P2);
  perturb(g, "oc");
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard", "the picked card is discarded");
  assert.ok(discardOf(g.engine, P2).includes(g.id("oc")), "into THEIR discard pile");
  assert.deepEqual(handOf(g.engine, P2), oppHand.filter((c) => c !== g.id("oc")), "nothing else left their hand");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I make the second pick");
  samePick(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("foe")), "into its owner's hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("per")), "discard", "Perturb ends in my discard pile");
});

clause(PERTURB, "0:rule", "COST: pays exactly 5 and needs [O][O]", () => {
  const g = perturbBoard({ icons: { obsession: 7 } });
  const before = ready(g.engine);
  perturbAttempt(g, "oc")();
  assert.equal(before - ready(g.engine), 5);
  const short = perturbBoard({ icons: { obsession: 4 } });
  refused(perturbAttempt(short, "oc"), "4 resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("per")), "hand");
  const one = perturbBoard({ icons: { obsession: 1, greed: 6 } });
  refused(perturbAttempt(one, "oc"), "one [O]");
  const none = perturbBoard({ icons: { greed: 7 } });
  refused(perturbAttempt(none, "oc"), "no [O]");
});

for (const [key, type] of [
  ["oc", "character"],
  ["oi", "item"],
  ["ol", "location"],
  ["ot", "tactic"]
] as const) {
  clause(PERTURB, "0:rule", `any non-resource card in their hand can be picked: a ${type} card is discarded`, () => {
    const g = perturbBoard();
    perturb(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "discard");
    assert.ok(discardOf(g.engine, P2).includes(g.id(key)), "discardOf(g.engine, P2).includes(g.id(key))");
    if (pending(g.engine)) samePick(g, undefined);
  });
}

clause(PERTURB, "0:rule", "a RESOURCE card in their hand cannot be picked (non-resource only); nothing is paid", () => {
  const g = perturbBoard();
  refused(perturbAttempt(g, "or"), "a resource card");
  assert.ok(perturbPromptOpen(g), "the prompt is still open after the refused pick");
  assert.equal(zoneOf(g.engine, g.id("or")), "hand");
  perturbAttempt(g, "oc")();
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard", "control: a non-resource card is accepted");
});

clause(PERTURB, "0:rule", "the picked card must be in THEIR hand: my own hand cards and cards in play are refused", () => {
  const g = perturbBoard();
  refused(perturbAttempt(g, "mc"), "my own hand card");
  refused(perturbAttempt(g, "foe"), "a card in play");
  refused(perturbAttempt(g, "fd"), "a face-down card in play");
  assert.ok(perturbPromptOpen(g), "the prompt is still open after the refused picks");
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
});

clause(PERTURB, "0:rule", "exactly one card is picked from their hand: two picks or none are refused", () => {
  const g = perturbBoard();
  refused(() => perturbPlay(g, undefined, ["oc", "oi"]), "two picks");
  assert.ok(perturbPromptOpen(g), "the prompt is still open after the refused pick");
  assert.equal(zoneOf(g.engine, g.id("oc")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oi")), "hand");
});

clause(PERTURB, "0:rule", "the whole paragraph is the tactic's EFFECT (no COST: line): Perturb can be played when their hand has no non-resource card, and then simply does nothing", () => {
  const g = perturbBoard({ oppHand: false, extra: [{ key: "or", def: resourceCard({ name: "Their Resource Card" }), owner: P2, zone: "hand" }] });
  perturbAttempt(g)();
  assert.ok(g.engine.state.responseWindow, "Perturb was played: it is waiting for responses");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing to discard, nothing to pick");
  assert.equal(zoneOf(g.engine, g.id("per")), "discard");
  assert.equal(zoneOf(g.engine, g.id("or")), "hand", "the resource card is not discarded");
});

clause(PERTURB, "0:rule", "the pick from their hand is made when Perturb resolves, after my opponent has had the chance to respond (it is not a cost)", () => {
  const g = perturbBoard();
  playRaw(g.engine, P1, g.id("per"), { selected: {} });
  assert.ok(g.engine.state.responseWindow, "Perturb is waiting for responses with nothing picked yet");
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "now I look at their hand and pick");
});

clause(PERTURB, "0:rule", "only the card I picked leaves their hand, and my own hand is untouched", () => {
  const g = perturbBoard();
  const before = handOf(g.engine, P2).length;
  perturb(g, "ot");
  assert.equal(handOf(g.engine, P2).length, before - 1);
  assert.deepEqual(handOf(g.engine, P1), [g.id("mc")], "my hand is untouched (Perturb left it)");
});

// the second pick: same type as the discarded card

clause(PERTURB, "0:rule", "discarded a CHARACTER: I may pick a character of mine, a character of theirs, or one I control but they own", () => {
  for (const [key, ownerHand] of [
    ["ally", P1],
    ["foe", P2],
    ["captured", P2]
  ] as const) {
    const g = perturbBoard();
    perturb(g, "oc");
    samePick(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", key);
    assert.ok(handOf(g.engine, ownerHand).includes(g.id(key)), `${key} goes to its owner's hand`);
  }
});

clause(PERTURB, "0:rule", "discarded a CHARACTER: an item, a location, a resource, a faction and a face-down card are not 'the same type' and are refused", () => {
  const g = perturbBoard();
  perturb(g, "oc");
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => samePick(g, "myItem"), "an item");
  refused(() => samePick(g, "myPlace"), "a location");
  refused(() => samePick(g, "foeRes"), "a resource");
  refused(() => samePick(g, "fd"), "a face-down card (only a resource, CR 411.1)");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.engine.state.players[P2].factionId!] }), "a faction");
  assert.ok(pending(g.engine), "pending(g.engine)");
  samePick(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "hand", "control: a character works");
});

clause(PERTURB, "0:rule", "discarded an ITEM: I may pick an item (mine or theirs), not a character or a location", () => {
  for (const key of ["myItem", "foeItem"]) {
    const g = perturbBoard();
    perturb(g, "oi");
    samePick(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", key);
  }
  const g = perturbBoard();
  perturb(g, "oi");
  refused(() => samePick(g, "ally"), "a character");
  refused(() => samePick(g, "foePlace"), "a location");
});

clause(PERTURB, "0:rule", "discarded a LOCATION: I may pick a location (mine or theirs), not a character or an item", () => {
  for (const key of ["myPlace", "foePlace"]) {
    const g = perturbBoard();
    perturb(g, "ol");
    samePick(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", key);
  }
  const g = perturbBoard();
  perturb(g, "ol");
  refused(() => samePick(g, "foe"), "a character");
  refused(() => samePick(g, "foeItem"), "an item");
});

clause(PERTURB, "0:rule", "discarded a TACTIC: no tactic is in play, so a character cannot be picked", () => {
  const g = perturbBoard();
  perturb(g, "ot");
  if (pending(g.engine)) {
    refused(() => samePick(g, "ally"), "a character is not a tactic");
    samePick(g, undefined);
  }
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
});

clause(PERTURB, "0:rule", "'You may pick': declining leaves everything in play", () => {
  const g = perturbBoard();
  perturb(g, "oc");
  samePick(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["ally", "foe", "captured", "myItem", "foeItem"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard", "the discard still happened");
});

clause(PERTURB, "0:rule", "'a card': only one is picked; two are refused", () => {
  const g = perturbBoard();
  perturb(g, "oc");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally"), g.id("foe")] }), "two cards");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(PERTURB, "0:rule", "the discarded card is in the discard pile by then, so it is not in play and cannot be the second pick", () => {
  const g = perturbBoard();
  perturb(g, "oc");
  refused(() => samePick(g, "oc"), "the card just discarded");
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard");
});

clause(PERTURB, "0:rule", "the returned card comes back undamaged and ready", () => {
  const g = perturbBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 9 }), owner: P2, zone: "play", damage: 3, depleted: true }] });
  perturb(g, "oc");
  samePick(g, "hurt");
  assert.equal(g.engine.state.cards[g.id("hurt")].damage, 0);
  assert.equal(g.engine.state.cards[g.id("hurt")].depleted, false);
});

clause(PERTURB, "0:rule", "if the picked card leaves their hand in response, the discard loses track of it (CR 402.4) and there is no discarded card to match a type against", () => {
  const away = tactic({
    name: "Hide Away",
    cost: 0,
    behavior: {
      abilities: [{ id: "hide", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck", position: "top" }] }]
    }
  });
  // Perturb's pick is part of its effect (made when it resolves), so the only way for the card to be
  // gone is that it left the hand before the pick: the opponent's hand holds just this one non-resource card.
  const g = perturbBoard({
    oppHand: false,
    extra: [
      { key: "away", def: away, owner: P2, zone: "hand" },
      { key: "oc", def: character({ name: "Their Character Card", cost: 2 }), owner: P2, zone: "hand" },
      { key: "or", def: resourceCard({ name: "Their Resource Card" }), owner: P2, zone: "hand" }
    ]
  });
  perturbAttempt(g)(); // Perturb is on the stack, its pick not made yet
  respondWith(g.engine, P2, g.id("away"), { t: [g.id("oc")] });
  assert.equal(zoneOf(g.engine, g.id("oc")), "deck", "control: they put it on top of their deck in response");
  assert.equal(g.engine.state.pendingChoice, undefined, "no discarded card, so no 'same type' pick");
});

clause(PERTURB, "0:rule", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = perturbBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(perturbAttempt(g, "oc"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("per"), {});
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oc")] });
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard");
});

// =================================================================================
// Redonkulous
// COST: Pick a character. -- EFFECT: If you played this card using FLIP UP, your opponent
// discards 2 cards. If your opponent has 3 or fewer cards in their hand, remove the
// character from the game.
// FLIP UP: 5 [O][O]
// Tactic, cost 3, [O][O].
// =================================================================================

const REDONK = "464b99b7-c1b7-43ae-9248-68f7614fd2cb";

function redBoard(
  opts: {
    red?: "hand" | "faceDown" | "faceUp" | "discard";
    oppHand?: number;
    icons?: Icons;
    oppIcons?: Icons;
    spent?: boolean;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const where = opts.red ?? "hand";
  return devBoard(
    [
      {
        key: "red",
        def: printing(REDONK),
        owner: P1,
        zone: where === "hand" ? "hand" : where === "discard" ? "discard" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.spent ? "__factionA" : undefined
      },
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", life: 9 }), owner: P2, zone: "play" },
      { key: "captured", def: character({ name: "Captured", life: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "mc", def: character({ name: "My Hand Character" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "Discard Character" }), owner: P2, zone: "discard" },
      ...fillers("oh", opts.oppHand ?? 5, P2, "hand"),
      ...res(opts.icons ?? { obsession: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type RedGame = ReturnType<typeof redBoard>;
const redPlay = (g: RedGame, pick = "foe") => play(g.engine, P1, g.id("red"), { selected: { char: [g.id(pick)] } });
const redAttempt = (g: RedGame, pick?: string) => () => playRaw(g.engine, P1, g.id("red"), { selected: pick ? { char: [g.id(pick)] } : {} });
const flipRed = (g: RedGame, pick?: string, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("red"), pick ? { char: [g.id(pick)] } : {});
/** Flips Redonkulous up on `pick` and has my opponent discard the first two cards of their hand when asked. */
function flipRedFully(g: RedGame, pick = "foe"): void {
  flipRed(g, pick);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      const hand = handOf(g.engine, pc.playerId);
      return { kind: "chooserSelectsTarget", selected: hand.slice(0, 2) };
    }
    return declineAll(pc);
  });
}

// --- played from the hand: no discard; the character is removed only if they hold 3 or fewer -----

for (const [oppHand, removed] of [
  [0, true],
  [2, true],
  [3, true],
  [4, false],
  [6, false]
] as const) {
  clause(REDONK, "0:ability", `played from my hand with ${oppHand} cards in their hand: the picked character ${removed ? "is removed from the game" : "stays in play"}`, () => {
    const g = redBoard({ oppHand });
    redPlay(g);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("foe")), removed ? "removed" : "play");
    assert.equal(handOf(g.engine, P2).length, oppHand, "nobody discarded anything: it was not played using FLIP UP");
    assert.equal(zoneOf(g.engine, g.id("red")), "discard", "the tactic ends in my discard pile");
  });
}

clause(REDONK, "0:ability", "removed from the game means the owner's out-of-game area, not the discard pile", () => {
  const g = redBoard({ oppHand: 2 });
  redPlay(g);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
  assert.ok(removedOf(g.engine, P2).includes(g.id("foe")), "removedOf(g.engine, P2).includes(g.id(\"foe\"))");
  assert.equal(discardOf(g.engine, P2).includes(g.id("foe")), false);
});

clause(REDONK, "0:ability", "COST: the character may be mine, theirs, or one I control but they own (removed to ITS OWNER's out-of-game area)", () => {
  for (const [key, owner] of [
    ["ally", P1],
    ["foe2", P2],
    ["captured", P2]
  ] as const) {
    const g = redBoard({ oppHand: 1 });
    redPlay(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "removed", key);
    assert.ok(removedOf(g.engine, owner).includes(g.id(key)), `${key} is in its owner's removed pile`);
  }
});

clause(REDONK, "0:ability", "only the picked character is removed: other characters stay", () => {
  const g = redBoard({ oppHand: 1 });
  redPlay(g, "foe");
  for (const key of ["ally", "foe2", "captured"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

clause(REDONK, "0:ability", "COST: Pick a character -- an item, a location, a faction, a face-down card, a character card in hand or discard pile are refused; nothing is paid", () => {
  const g = redBoard({ oppHand: 1 });
  for (const [key, why] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["fd", "a face-down card (only a resource, CR 411.1)"],
    ["mc", "a character card in my hand"],
    ["dc", "a character card in a discard pile"]
  ] as const) {
    refused(redAttempt(g, key), `picking ${why}`);
  }
  refused(() => playRaw(g.engine, P1, g.id("red"), { selected: { char: [g.engine.state.players[P2].factionId!] } }), "picking a faction");
  refused(redAttempt(g), "no pick");
  refused(() => playRaw(g.engine, P1, g.id("red"), { selected: { char: [g.id("foe"), g.id("ally")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("red")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
  redAttempt(g, "foe")();
  assert.ok(g.engine.state.responseWindow, "control: a character is accepted");
});

clause(REDONK, "0:ability", "COST: the pick is made when the tactic is played: the character is chosen before my opponent can respond, and is still in play then", () => {
  const g = redBoard({ oppHand: 1 });
  redAttempt(g, "foe")();
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
});

clause(REDONK, "0:ability", "it pays exactly its cost of 3 and needs [O][O]", () => {
  const g = redBoard({ icons: { obsession: 5 } });
  const before = ready(g.engine);
  redAttempt(g, "foe")();
  assert.equal(before - ready(g.engine), 3);
  const short = redBoard({ icons: { obsession: 2 } });
  refused(redAttempt(short, "foe"), "2 resources for a cost of 3");
  const one = redBoard({ icons: { obsession: 1, greed: 5 } });
  refused(redAttempt(one, "foe"), "one [O]");
  const none = redBoard({ icons: { greed: 6 } });
  refused(redAttempt(none, "foe"), "no [O]");
});

clause(REDONK, "0:ability", "the hand size is checked when it resolves: a response that takes their hand from 4 to 3 cards gets the character removed", () => {
  const filler = tactic({ name: "Idle Reply", cost: 0, behavior: { abilities: [{ id: "idle", type: "activated", effects: [] }] } });
  const g = redBoard({ oppHand: 3, extra: [{ key: "reply", def: filler, owner: P2, zone: "hand" }] });
  assert.equal(handOf(g.engine, P2).length, 4);
  redAttempt(g, "foe")();
  respondWith(g.engine, P2, g.id("reply"));
  assert.equal(handOf(g.engine, P2).length, 3);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed", "they have 3 cards when it resolves");
});

clause(REDONK, "0:ability", "the hand size is checked when it resolves: a response that gives them a 4th card (a draw) saves the character", () => {
  const drawer = tactic({ name: "Quick Study", cost: 0, behavior: { abilities: [{ id: "qs", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const g = redBoard({ oppHand: 2, extra: [{ key: "study", def: drawer, owner: P2, zone: "hand" }, ...fillers("ok", 3, P2, "deck")] });
  assert.equal(handOf(g.engine, P2).length, 3);
  redAttempt(g, "foe")();
  respondWith(g.engine, P2, g.id("study"));
  assert.equal(handOf(g.engine, P2).length, 3, "they played the Study (-1) and drew a card (+1)");
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed", "still 3 cards: removed");
});

clause(REDONK, "0:ability", "if the picked character leaves play in response, nothing is removed (CR 402.4): it stays in the discard pile and the costs stay paid", () => {
  const g = redBoard({ oppHand: 1, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  redAttempt(g, "foe")();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "destroyed in response: the effect loses track of it and it stays in the discard pile");
  assert.equal(removedOf(g.engine, P2).includes(g.id("foe")), false, "a card in the discard pile is not removed from the game");
  assert.equal(before - ready(g.engine), 3);
});

clause(REDONK, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = redBoard({ oppHand: 1, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(redAttempt(g, "foe"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("red"), { char: [g.id("atk")] });
  assert.equal(zoneOf(g.engine, g.id("atk")), "removed", "the attacker is removed from the game");
});

clause(REDONK, "0:ability", "it can only be played from my hand: refused from my discard pile", () => {
  const g = redBoard({ red: "discard" });
  refused(redAttempt(g, "foe"), "from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("red")), "discard");
});

// --- FLIP UP: 5 [O][O] ------------------------------------------------------------------

clause(REDONK, "1:flipUp", "a face-down Redonkulous is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = redBoard({ red: "faceDown", icons: { obsession: 2 } });
  assert.equal(g.engine.isResource(g.id("red")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1, "just Redonkulous itself");
});

clause(REDONK, "1:flipUp", "played using FLIP UP my opponent discards 2 cards of THEIR choice, then (3 or fewer left) the character is removed", () => {
  const g = redBoard({ red: "faceDown", oppHand: 5 });
  const theirs = handOf(g.engine, P2);
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses what to discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh3"), g.id("oh4")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P2), theirs.slice(0, 3), "exactly the two chosen cards left their hand");
  assert.deepEqual(discardOf(g.engine, P2).filter((c) => c === g.id("oh3") || c === g.id("oh4")).sort(), [g.id("oh3"), g.id("oh4")].sort());
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed", "3 cards left: the character is removed");
  assert.equal(zoneOf(g.engine, g.id("red")), "discard");
});

clause(REDONK, "1:flipUp", "the discard comes BEFORE the hand-size check: with 6 cards they discard 2 and keep 4, so the character stays", () => {
  const g = redBoard({ red: "faceDown", oppHand: 6 });
  flipRedFully(g);
  assert.equal(handOf(g.engine, P2).length, 4);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(REDONK, "1:flipUp", "...and with 5 cards the discard leaves them 3, so the character IS removed (it would not be from the hand)", () => {
  const g = redBoard({ red: "faceDown", oppHand: 5 });
  flipRedFully(g);
  assert.equal(handOf(g.engine, P2).length, 3);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
});

clause(REDONK, "1:flipUp", "the discard is mandatory and exactly 2: declining, one card, three cards or a card outside their hand are refused", () => {
  const g = redBoard({ red: "faceDown", oppHand: 5 });
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "discarding none");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] }), "discarding only one");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1"), g.id("oh2")] }), "discarding three");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("mc")] }), "a card of mine");
  assert.ok(pending(g.engine), "the demand is still standing");
  assert.equal(handOf(g.engine, P2).length, 5);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] });
  assert.equal(handOf(g.engine, P2).length, 3, "control: two cards work");
});

clause(REDONK, "1:flipUp", "an opponent with fewer than 2 cards discards all of them (CR 402.5) and the character is removed", () => {
  for (const oppHand of [1, 0]) {
    const g = redBoard({ red: "faceDown", oppHand });
    flipRedFully(g);
    assert.equal(handOf(g.engine, P2).length, 0, `${oppHand} card(s): none left`);
    assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
  }
});

clause(REDONK, "1:flipUp", "FLIP UP costs 5 (not the card's cost of 3): with exactly five ready resources, itself included, it works", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0, icons: { obsession: 4 }, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(g.engine), 5, "four ready Obsession and the face-down Redonkulous");
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
});

clause(REDONK, "1:flipUp", "FLIP UP costs 5: four ready resources are refused and nothing changes", () => {
  const g = redBoard({ red: "faceDown", icons: { obsession: 3 }, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(g.engine), 4, "three ready Obsession and the face-down Redonkulous");
  refused(() => flipRed(g, "foe"), "fewer than 5 ready resources");
  assert.equal(g.engine.state.cards[g.id("red")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(REDONK, "1:flipUp", "FLIP UP needs [O][O]: one [O] among many other resources is refused, two are accepted", () => {
  const one = redBoard({ red: "faceDown", icons: { obsession: 1, greed: 7 } });
  refused(() => flipRed(one, "foe"), "one [O]");
  assert.equal(one.engine.state.cards[one.id("red")].faceDown, true);
  const none = redBoard({ red: "faceDown", icons: { greed: 8 } });
  refused(() => flipRed(none, "foe"), "no [O]");
  const two = redBoard({ red: "faceDown", icons: { obsession: 2, greed: 4 }, oppHand: 0 });
  flipRed(two, "foe");
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("foe")), "removed", "control: two [O] is enough");
});

clause(REDONK, "1:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const g = redBoard({ red: "faceDown", icons: { greed: 8 }, oppIcons: { obsession: 5 } });
  refused(() => flipRed(g, "foe"), "no [O] of mine");
});

clause(REDONK, "1:flipUp", "the regular COST still applies when flipping up: a character must be picked", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0 });
  refused(() => flipRed(g), "no pick");
  refused(() => flipRed(g, "thing"), "an item");
  refused(() => flipRed(g, "place"), "a location");
  refused(() => flipRed(g, "fd"), "a face-down card");
  refused(() => flipRed(g, "mc"), "a character card in hand");
  assert.equal(g.engine.state.cards[g.id("red")].faceDown, true, "still face-down after every refusal");
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed", "control: a character works");
});

clause(REDONK, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = redBoard({ red: "faceDown", oppIcons: { obsession: 8 } });
  refused(() => flipRed(theirs, "foe", P2), "the opponent cannot flip my card");
  const inHand = redBoard({ red: "hand" });
  refused(() => flipRed(inHand, "foe"), "in my hand it is not a face-down resource");
  const faceUp = redBoard({ red: "faceUp" });
  refused(() => flipRed(faceUp, "foe"), "a face-up card in play");
  assert.equal(theirs.engine.state.cards[theirs.id("red")].faceDown, true);
});

clause(REDONK, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works (and the attacker can be removed), outside a window it does not", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => flipRed(g, "atk"), "nothing to respond to yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipRed(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "removed");
});

clause(REDONK, "1:flipUp", "after a FLIP UP the tactic is in my discard pile (not left in play face-up)", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0 });
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("red")), "discard");
  assert.equal(g.engine.state.cards[g.id("red")].faceDown, false);
});

clause(REDONK, "1:flipUp", "a face-down Redonkulous that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0, spent: true });
  flipRed(g, "foe");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
});

clause(REDONK, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = redBoard({ red: "faceDown", oppHand: 0 });
  holdFlipUp(() => flipRed(g, "foe"));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "the effect has not happened yet");
});

// =================================================================================
// Ritual of the Double Monkey
// Your opponent discards a card. If you control [O][O][O], your opponent discards another
// card. If you control [O][O][O][O][O][O][O][O], your opponent discards another card.
// FLIP UP: 2 [O]
// Tactic, cost 1, [O].
// =================================================================================

const MONKEY = "e93a6fc4-da98-4698-b44f-3d1269903dfb";

function monkeyBoard(
  opts: {
    monkey?: "hand" | "faceDown" | "faceUp" | "discard";
    icons?: Icons;
    oppHand?: number;
    oppIcons?: Icons;
    spent?: boolean;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const where = opts.monkey ?? "hand";
  return devBoard(
    [
      {
        key: "mk",
        def: printing(MONKEY),
        owner: P1,
        zone: where === "hand" ? "hand" : where === "discard" ? "discard" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.spent ? "__factionA" : undefined
      },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("oh", opts.oppHand ?? 6, P2, "hand"),
      ...res(opts.icons ?? { obsession: 3 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type MonkeyGame = ReturnType<typeof monkeyBoard>;
const monkey = (g: MonkeyGame) => play(g.engine, P1, g.id("mk"));
const monkeyAttempt = (g: MonkeyGame) => () => playRaw(g.engine, P1, g.id("mk"));
const flipMonkey = (g: MonkeyGame, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("mk"));

/** Answers every discard prompt for my opponent with their first remaining card; returns how many prompts there were (and asserts each was theirs). */
function discardsAnswered(g: MonkeyGame, pick: (hand: CardInstanceId[]) => CardInstanceId = (hand) => hand[0]): number {
  let prompts = 0;
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    prompts++;
    assert.equal(pc.playerId, P2, "my opponent chooses what to discard");
    return { kind: "chooserSelectsTarget", selected: [pick(handOf(g.engine, P2))] };
  });
  return prompts;
}

/** Plays the Ritual (from hand) and answers everything; returns [number of discard prompts, cards left in their hand]. */
function ritualOutcome(icons: Icons, oppHand = 6, extra: CardPlacement[] = []): [number, number] {
  const g = monkeyBoard({ icons, oppHand, extra });
  monkeyAttempt(g)();
  resolvePendingResponses(g.engine);
  const prompts = discardsAnswered(g);
  return [prompts, handOf(g.engine, P2).length];
}

clause(MONKEY, "0:rule", "my opponent discards a card of THEIR choice into their discard pile", () => {
  const g = monkeyBoard({ icons: { obsession: 2 } });
  const theirs = handOf(g.engine, P2);
  monkey(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh3")] });
  assert.equal(g.engine.state.pendingChoice, undefined, "only one discard with fewer than three [O]");
  assert.deepEqual(handOf(g.engine, P2), theirs.filter((c) => c !== g.id("oh3")));
  assert.deepEqual(discardOf(g.engine, P2), [g.id("oh3")]);
  assert.equal(zoneOf(g.engine, g.id("mk")), "discard", "the Ritual ends in my discard pile");
});

clause(MONKEY, "0:rule", "the first discard is mandatory and from their own hand only: declining, two cards, or a card of mine are refused", () => {
  const g = monkeyBoard({ icons: { obsession: 2 } });
  monkey(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining the discard");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] }), "two cards at once");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "a card of mine");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] }), "a card in play");
  assert.ok(pending(g.engine), "pending(g.engine)");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(handOf(g.engine, P2).length, 5, "control: one legal discard");
});

clause(MONKEY, "0:rule", "my own hand and board are untouched", () => {
  const g = monkeyBoard({ icons: { obsession: 3 } });
  const mine = handOf(g.engine, P1);
  monkey(g);
  discardsAnswered(g);
  assert.deepEqual(handOf(g.engine, P1), mine.filter((c) => c !== g.id("mk")));
  assert.equal(discardOf(g.engine, P1).length, 1, "only the Ritual itself");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
});

for (const [obsession, expected] of [
  [1, 1],
  [2, 1],
  [3, 2],
  [5, 2],
  [7, 2],
  [8, 3],
  [10, 3]
] as const) {
  clause(MONKEY, "0:rule", `controlling ${obsession} [O] makes my opponent discard ${expected} card${expected === 1 ? "" : "s"} (a hand of 6 leaves ${6 - expected})`, () => {
    const [prompts, left] = ritualOutcome({ obsession });
    assert.equal(prompts, expected, "one discard prompt per card");
    assert.equal(left, 6 - expected);
  });
}

clause(MONKEY, "0:rule", "the [O] total includes resources spent on the Ritual's own cost: exactly 3 Obsession, one paid, still count as controlled (2 discards)", () => {
  const [prompts, left] = ritualOutcome({ obsession: 3 });
  assert.equal(prompts, 2);
  assert.equal(left, 4);
});

clause(MONKEY, "0:rule", "paying the cost does not lower the count at 8: exactly 8 Obsession is 3 discards", () => {
  const [prompts, left] = ritualOutcome({ obsession: 8 });
  assert.equal(prompts, 3);
  assert.equal(left, 3);
});

clause(MONKEY, "0:rule", "only [O] count: 5 Greed with 2 Obsession is still one discard", () => {
  const [prompts] = ritualOutcome({ obsession: 2, greed: 6 });
  assert.equal(prompts, 1);
});

clause(MONKEY, "0:rule", "a Minion of Thabbash (PROVIDES [O]) counts as an [O] I control: Minion + 2 Obsession = 3 [O] = 2 discards", () => {
  const [prompts] = ritualOutcome({ obsession: 2 }, 6, [{ key: "minion", def: printing(MINION), owner: P1, zone: "play" }]);
  assert.equal(prompts, 2);
});

clause(MONKEY, "0:rule", "face-down cards provide Volition, not [O]: three of them with 2 Obsession do not reach three [O]", () => {
  const faceDown = [1, 2, 3].map((i) => ({ key: `fd${i}`, def: character({ name: `Hidden ${i}` }), owner: P1, zone: "play" as const, faceDown: true }));
  const [prompts] = ritualOutcome({ obsession: 2 }, 6, faceDown);
  assert.equal(prompts, 1);
});

clause(MONKEY, "0:rule", "my opponent's [O] do not count: they control 8 Obsession, I control 2, and they discard one card", () => {
  const g = monkeyBoard({ icons: { obsession: 2 }, oppIcons: { obsession: 8 } });
  monkeyAttempt(g)();
  resolvePendingResponses(g.engine);
  assert.equal(discardsAnswered(g), 1);
});

clause(MONKEY, "0:rule", "the cards discarded are different cards, each chosen by my opponent in turn", () => {
  const g = monkeyBoard({ icons: { obsession: 8 } });
  monkeyAttempt(g)();
  resolvePendingResponses(g.engine);
  const picks: CardInstanceId[] = [];
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const card = handOf(g.engine, P2)[handOf(g.engine, P2).length - 1];
    picks.push(card);
    return { kind: "chooserSelectsTarget", selected: [card] };
  });
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks).size, 3);
  for (const card of picks) assert.equal(zoneOf(g.engine, card), "discard");
});

clause(MONKEY, "0:rule", "an opponent with fewer cards than the Ritual demands discards all they have: 2 cards and 8 [O] leaves an empty hand", () => {
  const g = monkeyBoard({ icons: { obsession: 8 }, oppHand: 2 });
  monkeyAttempt(g)();
  resolvePendingResponses(g.engine);
  discardsAnswered(g);
  assert.equal(handOf(g.engine, P2).length, 0);
  assert.equal(discardOf(g.engine, P2).length, 2);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MONKEY, "0:rule", "an opponent with an empty hand discards nothing and nothing breaks", () => {
  const g = monkeyBoard({ icons: { obsession: 8 }, oppHand: 0 });
  monkey(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(discardOf(g.engine, P2).length, 0);
  assert.equal(zoneOf(g.engine, g.id("mk")), "discard");
});

clause(MONKEY, "0:rule", "the [O] count is taken when the Ritual resolves: a response that removes one of my [O] resources drops 8 [O] (3 discards) to 7 (2), and 3 [O] (2 discards) to 2 (1)", () => {
  for (const [obsession, expected] of [
    [8, 2],
    [3, 1]
  ] as const) {
    const g = monkeyBoard({ icons: { obsession }, extra: [{ key: "mover", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
    const target = playOf(g.engine, P1).find((c) => g.engine.getDefinition(c).type === "resource")!;
    monkeyAttempt(g)();
    respondWith(g.engine, P2, g.id("mover"), { t: [target] });
    assert.equal(zoneOf(g.engine, target), "hand", "control: the resource left play in response");
    assert.equal(discardsAnswered(g), expected, `${obsession} - 1 [O] when it resolves`);
  }
});

clause(MONKEY, "0:rule", "it pays exactly 1 and needs [O]: one resource is enough, no [O] is refused", () => {
  const g = monkeyBoard({ icons: { obsession: 4 } });
  const before = ready(g.engine);
  monkeyAttempt(g)();
  assert.equal(before - ready(g.engine), 1);
  const none = monkeyBoard({ icons: { greed: 4 } });
  refused(monkeyAttempt(none), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("mk")), "hand");
  const spent = monkeyBoard({ icons: {}, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(monkeyAttempt(spent), "no ready resource to pay with");
});

clause(MONKEY, "0:rule", "the discards happen when it resolves, after my opponent has had the chance to respond", () => {
  const g = monkeyBoard({ icons: { obsession: 3 } });
  monkeyAttempt(g)();
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(handOf(g.engine, P2).length, 6, "nothing discarded yet");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MONKEY, "0:rule", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = monkeyBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(monkeyAttempt(g), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("mk"));
  assert.equal(discardsAnswered(g), 2);
});

clause(MONKEY, "0:rule", "it can only be played from my hand: refused from my discard pile", () => {
  const g = monkeyBoard({ monkey: "discard" });
  refused(monkeyAttempt(g), "from the discard pile");
});

// --- FLIP UP: 2 [O] ---------------------------------------------------------------------

clause(MONKEY, "1:flipUp", "a face-down Ritual is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 2 } });
  assert.equal(g.engine.isResource(g.id("mk")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(MONKEY, "1:flipUp", "flipping it up resolves it as the tactic: my opponent discards, and the Ritual ends in my discard pile", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 2 } });
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  assert.equal(discardsAnswered(g), 1, "2 [O]: one discard");
  assert.equal(handOf(g.engine, P2).length, 5);
  assert.equal(zoneOf(g.engine, g.id("mk")), "discard");
  assert.equal(g.engine.state.cards[g.id("mk")].faceDown, false);
});

clause(MONKEY, "1:flipUp", "a flipped-up Ritual counts [O] the same way: 8 Obsession is 3 discards", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 8 } });
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  assert.equal(discardsAnswered(g), 3);
});

clause(MONKEY, "1:flipUp", "FLIP UP costs 2 (not the card's cost of 1): with exactly two ready resources, itself included, it works", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 1 }, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(g.engine), 2, "one ready Obsession and the face-down Ritual");
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  discardsAnswered(g);
  assert.equal(zoneOf(g.engine, g.id("mk")), "discard", "flipped with 2 ready resources");
});

clause(MONKEY, "1:flipUp", "FLIP UP costs 2: one ready resource (only the Ritual itself) is refused and nothing changes", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: {}, extra: res({ obsession: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(g.engine), 1);
  refused(() => flipMonkey(g), "1 ready resource for a Flip Up cost of 2");
  assert.equal(g.engine.state.cards[g.id("mk")].faceDown, true);
  assert.equal(handOf(g.engine, P2).length, 6);
});

clause(MONKEY, "1:flipUp", "FLIP UP pays no more than 2: with many resources at most two end up spent", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 6 } });
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 2, "at most two resources were attached to my faction");
});

clause(MONKEY, "1:flipUp", "FLIP UP needs [O]: with no Obsession (only Greed) it is refused, with one [O] it works", () => {
  const none = monkeyBoard({ monkey: "faceDown", icons: { greed: 4 } });
  refused(() => flipMonkey(none), "no [O]");
  assert.equal(none.engine.state.cards[none.id("mk")].faceDown, true);
  assert.equal(ready(none.engine), 5, "nothing was paid");
  const one = monkeyBoard({ monkey: "faceDown", icons: { obsession: 1, greed: 2 } });
  flipMonkey(one);
  resolvePendingResponses(one.engine);
  discardsAnswered(one);
  assert.equal(zoneOf(one.engine, one.id("mk")), "discard", "control: one [O] is enough");
});

clause(MONKEY, "1:flipUp", "the card's own Volition does not provide the [O], and the opponent's [O] do not count", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { greed: 3 }, oppIcons: { obsession: 5 } });
  refused(() => flipMonkey(g), "no [O] of mine");
  assert.equal(g.engine.state.cards[g.id("mk")].faceDown, true);
});

clause(MONKEY, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = monkeyBoard({ monkey: "faceDown", oppIcons: { obsession: 5 } });
  refused(() => flipMonkey(theirs, P2), "the opponent cannot flip my card");
  const inHand = monkeyBoard({ monkey: "hand" });
  refused(() => flipMonkey(inHand), "in my hand it is not a face-down resource");
  const faceUp = monkeyBoard({ monkey: "faceUp" });
  refused(() => flipMonkey(faceUp), "a face-up card in play");
  assert.equal(theirs.engine.state.cards[theirs.id("mk")].faceDown, true);
});

clause(MONKEY, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = monkeyBoard({ monkey: "faceDown", turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => flipMonkey(g), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("mk")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  assert.equal(discardsAnswered(g), 2, "3 [O]: two discards");
});

clause(MONKEY, "1:flipUp", "a face-down Ritual that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 3 }, spent: true });
  flipMonkey(g);
  resolvePendingResponses(g.engine);
  discardsAnswered(g);
  assert.equal(zoneOf(g.engine, g.id("mk")), "discard");
});

clause(MONKEY, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = monkeyBoard({ monkey: "faceDown", icons: { obsession: 3 } });
  flipMonkey(g);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(handOf(g.engine, P2).length, 6, "the effect has not happened yet");
});

// =================================================================================
// Titillated Mooncalf
// If a card that provides at least [O] enters play under your control, you may pick a
// character. If you do, it gains COVERT this turn.
// Character (monstrosity), cost 1, [O], 1 strength / 3 speed / 1 life.
// =================================================================================

const MOONCALF = "db404dae-6ec9-474f-b603-35ebe3520d10";

const obsCard = (name = "Obsession Card"): CardDefinition => resourceCard({ name, resource: { provides: ["obsession"], staple: true } });

function mooncalfBoard(
  opts: {
    calf?: "play" | "hand" | "discard" | "faceDown";
    calf2?: boolean;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const where = opts.calf ?? "play";
  return devBoard(
    [
      { key: "calf", def: printing(MOONCALF), owner: P1, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      ...(opts.calf2 ? [{ key: "calf2", def: printing(MOONCALF), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P1, zone: "play", faceDown: true },
      { key: "obs", def: obsCard(), owner: P1, zone: "hand" },
      { key: "grd", def: resourceCard({ name: "Greed Card", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "minion", def: printing(MINION), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain Character", cost: 1 }), owner: P1, zone: "hand" },
      { key: "obs2", def: obsCard("Their Obsession Card"), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { obsession: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type CalfGame = ReturnType<typeof mooncalfBoard>;
const isCovert = (g: CalfGame, key: string): boolean => g.engine.getKeywords(g.id(key)).includes("covert");
/** Plays my [O] resource card and returns once the trigger's pick (if any) is open. */
const playObs = (g: CalfGame, key = "obs", faceDown = false) => developResource(g.engine, P1, g.id(key), faceDown);
const calfPick = (g: CalfGame, key: string | undefined) => answerPending(g.engine, "chooserSelectsTarget", { selected: key ? [g.id(key)] : [] });

clause(MOONCALF, "0:rule", "when an [O]-providing resource enters play under my control I may pick a character: it gains COVERT", () => {
  const g = mooncalfBoard();
  assert.equal(isCovert(g, "ally"), false, "control: no COVERT yet");
  playObs(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  calfPick(g, "ally");
  assert.equal(isCovert(g, "ally"), true);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MOONCALF, "0:rule", "only the picked character gains COVERT: my other characters, the Mooncalf and their characters do not", () => {
  const g = mooncalfBoard();
  playObs(g);
  calfPick(g, "ally");
  assert.equal(isCovert(g, "calf"), false);
  assert.equal(isCovert(g, "foe"), false);
});

clause(MOONCALF, "0:rule", "'you may pick': declining gives nobody COVERT", () => {
  const g = mooncalfBoard();
  playObs(g);
  calfPick(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["ally", "calf", "foe"]) assert.equal(isCovert(g, key), false, `${key} has no COVERT`);
});

clause(MOONCALF, "0:rule", "any character can be picked: the Mooncalf itself, one of theirs", () => {
  for (const key of ["calf", "foe"]) {
    const g = mooncalfBoard();
    playObs(g);
    calfPick(g, key);
    assert.equal(isCovert(g, key), true, key);
  }
});

clause(MOONCALF, "0:rule", "only a CHARACTER can be picked: an item, a location, a face-down card, a faction, a card in hand and a resource are refused", () => {
  const g = mooncalfBoard();
  playObs(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => calfPick(g, "thing"), "an item");
  refused(() => calfPick(g, "place"), "a location");
  refused(() => calfPick(g, "fd"), "a face-down card (only a resource, CR 411.1)");
  refused(() => calfPick(g, "minion"), "a character card in my hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.engine.state.players[P1].factionId!] }), "my faction");
  assert.ok(pending(g.engine), "pending(g.engine)");
  calfPick(g, "ally");
  assert.equal(isCovert(g, "ally"), true, "control: a character works");
});

clause(MOONCALF, "0:rule", "'a character': only one is picked; two are refused", () => {
  const g = mooncalfBoard();
  playObs(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally"), g.id("foe")] }), "two characters");
  assert.equal(isCovert(g, "ally"), false);
  assert.equal(isCovert(g, "foe"), false);
});

clause(MOONCALF, "0:rule", "the keyword is real COVERT (CR 507.3d): a covert attacker cannot be blocked by a non-covert character", () => {
  const g = mooncalfBoard({ turn: 1, extra: [{ key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" }] });
  playObs(g);
  calfPick(g, "ally");
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("plainBlocker")] }), "a non-covert blocker against a covert attacker");
});

clause(MOONCALF, "0:rule", "without the grant the same attacker CAN be blocked (control for the previous test)", () => {
  const g = mooncalfBoard({ turn: 1, extra: [{ key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("plainBlocker")] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("plainBlocker")]);
});

clause(MOONCALF, "0:rule", "'this turn': the COVERT is gone once the turn is over", () => {
  const g = mooncalfBoard();
  playObs(g);
  calfPick(g, "ally");
  assert.equal(isCovert(g, "ally"), true);
  endTurn(g.engine, P1);
  assert.equal(isCovert(g, "ally"), false, "it lasted this turn only");
  endTurn(g.engine, P2);
  assert.equal(isCovert(g, "ally"), false, "and does not come back on my next turn");
});

clause(MOONCALF, "0:rule", "a character that already has COVERT is fine to pick (no second instance, CR 507.3e) and still has it afterwards", () => {
  const g = mooncalfBoard({ extra: [{ key: "sneak", def: character({ name: "Sneak", life: 9, behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }] });
  playObs(g);
  calfPick(g, "sneak");
  assert.equal(isCovert(g, "sneak"), true);
  assert.equal(g.engine.getKeywords(g.id("sneak")).filter((k) => k === "covert").length, 1, "only one instance of covert");
});

// what triggers it

clause(MOONCALF, "0:rule", "an [O]-providing CHARACTER entering play under my control (Minion of Thabbash) triggers it too", () => {
  const g = mooncalfBoard({ icons: { obsession: 6 } });
  play(g.engine, P1, g.id("minion"));
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  calfPick(g, "minion");
  assert.equal(isCovert(g, "minion"), true, "the Minion that just entered can be the picked character");
});

clause(MOONCALF, "0:rule", "a card that provides MORE than [O] (two [O]) still triggers it", () => {
  const double = resourceCard({ name: "Double Obsession", resource: { provides: ["obsession", "obsession"], staple: false } });
  const g = mooncalfBoard({ extra: [{ key: "dbl", def: double, owner: P1, zone: "hand" }] });
  playObs(g, "dbl");
  expectPending(g.engine, "chooserSelectsTarget");
  calfPick(g, "ally");
  assert.equal(isCovert(g, "ally"), true);
});

clause(MOONCALF, "0:rule", "a card that provides [O] and another icon triggers it", () => {
  const mixed = resourceCard({ name: "Obsession And Greed", resource: { provides: ["obsession", "greed"], staple: false } });
  const g = mooncalfBoard({ extra: [{ key: "mix", def: mixed, owner: P1, zone: "hand" }] });
  playObs(g, "mix");
  expectPending(g.engine, "chooserSelectsTarget");
  calfPick(g, undefined);
});

clause(MOONCALF, "0:rule", "a resource that provides only Greed does not trigger it", () => {
  const g = mooncalfBoard();
  playObs(g, "grd");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MOONCALF, "0:rule", "a plain character (providing no icon) entering play does not trigger it", () => {
  const g = mooncalfBoard();
  play(g.engine, P1, g.id("plain"));
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MOONCALF, "0:rule", "an [O] card played FACE-DOWN provides Volition, not [O], so it does not trigger it", () => {
  const g = mooncalfBoard();
  playObs(g, "obs", true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  const h = mooncalfBoard();
  playObs(h, "plain", true);
  assert.equal(h.engine.state.pendingChoice, undefined);
});

clause(MOONCALF, "0:rule", "an [O] card entering play under my OPPONENT's control does not trigger it", () => {
  const g = mooncalfBoard({ turn: 2, active: P2 });
  developResource(g.engine, P2, g.id("obs2"), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MOONCALF, "0:rule", "it only works while the Mooncalf is in play: not from my hand, my discard pile, or face-down", () => {
  for (const calf of ["hand", "discard", "faceDown"] as const) {
    const g = mooncalfBoard({ calf });
    playObs(g);
    assert.equal(g.engine.state.pendingChoice, undefined, `no trigger with the Mooncalf ${calf}`);
  }
});

clause(MOONCALF, "0:rule", "a Mooncalf controlled by my opponent triggers for THEM, not for me", () => {
  const g = devBoard(
    [
      { key: "calf", def: printing(MOONCALF), owner: P1, controller: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "obs", def: obsCard(), owner: P1, zone: "hand" }
    ]
  );
  developResource(g.engine, P1, g.id("obs"), false);
  assert.equal(g.engine.state.pendingChoice, undefined, "my [O] card does not trigger a Mooncalf under my opponent's control");
});

clause(MOONCALF, "0:rule", "two Mooncalves each trigger: I get two picks and may give COVERT to two characters", () => {
  const g = mooncalfBoard({ calf2: true });
  playObs(g);
  let picks = 0;
  const targets = ["ally", "foe"];
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      return { kind: "chooserSelectsTarget", selected: [g.id(targets[picks++])] };
    }
    return declineAll(pc);
  });
  assert.equal(picks, 2);
  assert.equal(isCovert(g, "ally"), true);
  assert.equal(isCovert(g, "foe"), true);
});

clause(MOONCALF, "0:rule", "each [O] card entering play triggers it separately: two [O] cards played, two picks", () => {
  const g = mooncalfBoard({ icons: { obsession: 8 }, extra: [{ key: "obs3", def: obsCard("Third"), owner: P1, zone: "hand" }] });
  playObs(g);
  calfPick(g, "ally");
  assert.equal(g.engine.state.pendingChoice, undefined, "the Develop Rule's one resource play is used up");
  play(g.engine, P1, g.id("minion"));
  expectPending(g.engine, "chooserSelectsTarget");
  calfPick(g, "foe");
  assert.equal(isCovert(g, "ally"), true);
  assert.equal(isCovert(g, "foe"), true);
});

clause(MOONCALF, "0:rule", "the trigger fires when the card enters play, not when my opponent responds: playing a resource gives the pick at once", () => {
  const g = mooncalfBoard();
  playObs(g);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  expectPending(g.engine, "chooserSelectsTarget");
});

clause(MOONCALF, "0:rule", "an [O] card put into play by an effect (not deployed) also triggers it", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = mooncalfBoard({ icons: { obsession: 3 }, extra: [{ key: "pip", def: putter, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("minion")] } });
  expectPending(g.engine, "chooserSelectsTarget");
});

// =================================================================================
// Tumescent Guilt Bladder
// At the end of your turn, put a token on this card. Your faction loses X influence, where
// X is the number of tokens on this card. You may play a resource.
// At the start of each turn, if there are at least 3 tokens on this card, your opponent
// takes control of it. Remove all tokens from this card.
// Item, cost 3, [O][O][O][O].
// =================================================================================

const BLADDER = "0b790bde-153c-42d9-8038-feb93e327764";

function bladderBoard(
  opts: {
    tokens?: number;
    bladder?: "play" | "hand" | "discard" | "faceDown";
    controller?: PlayerId;
    inf1?: number;
    inf2?: number;
    second?: boolean;
    extra?: CardPlacement[];
    hand?: boolean;
    active?: PlayerId;
  } = {}
) {
  const where = opts.bladder ?? "play";
  return buildGame({
    turn: opts.active === P2 ? 2 : undefined,
    activePlayerId: opts.active,
    playerA: { faction: developFaction(), influence: opts.inf1 ?? 30 },
    playerB: { faction: developFaction(), influence: opts.inf2 ?? 30 },
    random: mulberry(31),
    cards: [
      {
        key: "tgb",
        def: printing(BLADDER),
        owner: P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        counters: opts.tokens ? { token: opts.tokens } : undefined
      },
      ...(opts.second ? [{ key: "tgb2", def: printing(BLADDER), owner: P1, zone: "play" as const }] : []),
      ...(opts.hand === false
        ? []
        : [
            { key: "hres", def: resourceCard({ name: "Hand Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" as const },
            { key: "ores", def: resourceCard({ name: "Their Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" as const }
          ]),
      ...fillers("mk", 4, P1, "deck"),
      ...fillers("ok", 4, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

type BladderGame = ReturnType<typeof bladderBoard>;
const tgbTokens = (g: BladderGame): number => tokensOn(g.engine, g.id("tgb"));
const tgbControl = (g: BladderGame): PlayerId => g.engine.state.cards[g.id("tgb")].controllerId as PlayerId;

/** `player` ends their turn; every prompt that comes up is declined (no resource played), the response windows are drained. */
function endTurnDeclining(g: BladderGame, player: PlayerId): void {
  g.engine.perform({ type: "endTurn", playerId: player });
  resolvePendingResponses(g.engine);
  drain(g.engine, declineEverything);
}

clause(BLADDER, "0:rule", "at the end of my turn a token goes on the item and my faction loses 1 influence (X = 1 token)", () => {
  const g = bladderBoard();
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 1);
  assert.equal(influenceOf(g.engine, P1), 29);
  assert.equal(influenceOf(g.engine, P2), 30, "only MY faction loses influence");
});

clause(BLADDER, "0:rule", "X is the number of tokens ON THE ITEM after the new one: with 1 token on it, 2 are on it and I lose 2", () => {
  const g = bladderBoard({ tokens: 1 });
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 2);
  assert.equal(influenceOf(g.engine, P1), 28);
});

clause(BLADDER, "0:rule", "with 2 tokens on it, 3 are on it and I lose 3", () => {
  const g = bladderBoard({ tokens: 2 });
  endTurnDeclining(g, P1);
  assert.equal(influenceOf(g.engine, P1), 27);
});

clause(BLADDER, "0:rule", "X keeps growing with the tokens it holds: 4 tokens on it (a 5th added) is a loss of 5", () => {
  const g = bladderBoard({ tokens: 4 });
  endTurnDeclining(g, P1);
  assert.equal(influenceOf(g.engine, P1), 25);
});

clause(BLADDER, "0:rule", "it is influence LOSS, not damage: nothing else changes (my characters and cards are untouched)", () => {
  const g = bladderBoard({ extra: [{ key: "ally", def: character({ name: "Ally", life: 2 }), owner: P1, zone: "play" }] });
  endTurnDeclining(g, P1);
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(g.engine.state.cards[g.id("ally")].damage, 0);
});

clause(BLADDER, "0:rule", "it does NOT happen at the end of my opponent's turn", () => {
  const g = bladderBoard();
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 1);
  const infAfterMine = influenceOf(g.engine, P1);
  endTurnDeclining(g, P2);
  assert.equal(tgbTokens(g), 1, "no token at the end of their turn");
  assert.equal(influenceOf(g.engine, P1), infAfterMine);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(BLADDER, "0:rule", "it happens on each of my turns: three turns in a row put three tokens on it and cost 1 + 2 + 3 = 6 influence", () => {
  const g = bladderBoard();
  endTurnDeclining(g, P1);
  assert.equal(influenceOf(g.engine, P1), 29);
  endTurnDeclining(g, P2);
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 2);
  assert.equal(influenceOf(g.engine, P1), 27);
});

clause(BLADDER, "0:rule", "'At the end of your turn' happens when the turn actually ends, after my opponent has had the chance to respond (CR 610.1a), not when I announce it", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(tgbTokens(g), 0, "the turn has not ended yet: no token");
  assert.equal(influenceOf(g.engine, P1), 30, "...and no influence lost yet");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond to my announcement");
});

clause(BLADDER, "0:rule", "'You may play a resource': a resource card from my hand is played face-up at the end of my turn", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(g.engine.state.cards[g.id("hres")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(g.engine.state.cards[g.id("hres")].controllerId, P1);
});

clause(BLADDER, "0:rule", "'You may play a resource': a card that is not a resource is played face-down", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hchar")] });
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play");
  assert.equal(g.engine.state.cards[g.id("hchar")].faceDown, true);
});

clause(BLADDER, "0:rule", "'You may play a resource': declining plays nothing, but the token and the influence loss still happen", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(tgbTokens(g), 1);
  assert.equal(influenceOf(g.engine, P1), 29);
});

clause(BLADDER, "0:rule", "the resource comes from MY hand: my opponent's hand card is refused; only one", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ores")] }), "their hand card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres"), g.id("hchar")] }), "two resources");
  assert.ok(pending(g.engine), "pending(g.engine)");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "control: one card from my hand works");
});

clause(BLADDER, "0:rule", "with an empty hand there is nothing to play and nothing is asked", () => {
  const g = bladderBoard({ hand: false });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine); // the opponent's turn start
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tgbTokens(g), 1);
});

clause(BLADDER, "0:rule", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(BLADDER, "0:rule", "playing the resource does not use up the Develop Rule", () => {
  const g = bladderBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
});

clause(BLADDER, "0:rule", "the influence loss can take me to 0 and I lose the game: with 1 influence left, 1 token loses me the game", () => {
  const g = bladderBoard({ inf1: 1 });
  endTurnDeclining(g, P1);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(BLADDER, "0:rule", "influence stops at 0 (CR 410.4): losing 3 with only 1 influence left leaves 0, not -2", () => {
  const g = bladderBoard({ inf1: 1, tokens: 2 });
  endTurnDeclining(g, P1);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(BLADDER, "0:rule", "it works only while the item is in play, face-up: nothing happens with it in my hand, my discard pile or face-down", () => {
  for (const bladder of ["hand", "discard", "faceDown"] as const) {
    const g = bladderBoard({ bladder });
    endTurnDeclining(g, P1);
    assert.equal(influenceOf(g.engine, P1), 30, `no loss with the item ${bladder}`);
  }
});

clause(BLADDER, "0:rule", "'your turn' is its CONTROLLER's turn: an item I own but my opponent controls ticks at the end of THEIR turn, and costs THEIR faction", () => {
  const g = bladderBoard({ controller: P2 });
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 0, "not at the end of my turn: I do not control it");
  assert.equal(influenceOf(g.engine, P1), 30);
  endTurnDeclining(g, P2);
  assert.equal(tgbTokens(g), 1, "at the end of its controller's turn");
  assert.equal(influenceOf(g.engine, P2), 29, "their faction loses influence");
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(BLADDER, "0:rule", "two Bladders each tick: two tokens (one each) and I lose 1 + 1", () => {
  const g = bladderBoard({ second: true });
  endTurnDeclining(g, P1);
  assert.equal(tokensOn(g.engine, g.id("tgb")), 1);
  assert.equal(tokensOn(g.engine, g.id("tgb2")), 1);
  assert.equal(influenceOf(g.engine, P1), 28);
});

// --- 1:rule: at the start of each turn with 3+ tokens my opponent takes control --------------------------------------

clause(BLADDER, "1:rule", "at the start of a turn with 3 tokens on it, my opponent takes control of the item and all tokens are removed", () => {
  const g = bladderBoard({ tokens: 3 });
  endTurnDeclining(g, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tgbControl(g), P2, "my opponent now controls it");
  assert.equal(tgbTokens(g), 0, "all tokens were removed");
  assert.equal(zoneOf(g.engine, g.id("tgb")), "play");
  assert.equal(g.engine.state.cards[g.id("tgb")].ownerId, P1, "ownership never changes");
});

clause(BLADDER, "1:rule", "the 3-token check happens at the START of the turn: after my own end of turn put the third token on it, the swap happens at the start of THEIR turn", () => {
  const g = bladderBoard({ tokens: 2 });
  endTurnDeclining(g, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tgbControl(g), P2);
  assert.equal(tgbTokens(g), 0);
  assert.equal(influenceOf(g.engine, P1), 27, "I paid the 3 influence for the third token before it left me");
});

clause(BLADDER, "1:rule", "with only 2 tokens at the start of a turn nothing happens: I keep control and the tokens stay", () => {
  const g = bladderBoard({ tokens: 1 });
  endTurnDeclining(g, P1);
  assert.equal(tgbTokens(g), 2);
  assert.equal(tgbControl(g), P1);
  endTurnDeclining(g, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tgbControl(g), P1, "still mine at the start of my next turn (2 tokens)");
  assert.equal(tgbTokens(g), 2);
});

clause(BLADDER, "1:rule", "'at least 3': with 4 tokens at the start of a turn it passes to my opponent and ALL tokens are removed", () => {
  const g = bladderBoard({ tokens: 4, active: P2 });
  endTurnDeclining(g, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tgbTokens(g), 0);
  assert.equal(tgbControl(g), P2, "taken at the start of MY turn by my opponent (the opponent of its controller)");
});

clause(BLADDER, "1:rule", "'each turn': it also checks at the start of my own turn: 3 tokens at the start of my turn pass the item to my opponent", () => {
  const g = bladderBoard({ tokens: 3, active: P2 });
  endTurnDeclining(g, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "my turn begins");
  assert.equal(tgbControl(g), P2);
  assert.equal(tgbTokens(g), 0);
});

clause(BLADDER, "1:rule", "'your opponent' is the opponent of the CURRENT controller: when my opponent controls it with 3 tokens it returns to me", () => {
  const g = bladderBoard({ tokens: 3, controller: P2 });
  endTurnDeclining(g, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tgbControl(g), P1, "my opponent controls it, so THEIR opponent (me) takes control");
  assert.equal(tgbTokens(g), 0);
});

clause(BLADDER, "1:rule", "when it changes hands the item stays in play (it is not destroyed or moved) and keeps its owner", () => {
  const g = bladderBoard({ tokens: 3 });
  endTurnDeclining(g, P1);
  assert.equal(zoneOf(g.engine, g.id("tgb")), "play");
  assert.ok(playOf(g.engine, P2).includes(g.id("tgb")), "it is among my opponent's cards in play");
  assert.equal(playOf(g.engine, P1).includes(g.id("tgb")), false);
});

clause(BLADDER, "1:rule", "the new controller starts again at 0 tokens: at the end of THEIR turn it gets one token and THEIR faction loses 1", () => {
  const g = bladderBoard({ tokens: 3 });
  endTurnDeclining(g, P1);
  assert.equal(tgbControl(g), P2);
  endTurnDeclining(g, P2);
  assert.equal(tgbTokens(g), 1);
  assert.equal(influenceOf(g.engine, P2), 29, "their faction lost 1");
  assert.equal(influenceOf(g.engine, P1), 26, "mine only lost the 4 from before (a 4th token went on it at the end of my turn)");
});

clause(BLADDER, "1:rule", "a full cycle: the item changes hands every three end-of-turns and each owner pays 1 + 2 + 3", () => {
  const g = bladderBoard();
  for (let i = 0; i < 3; i++) {
    endTurnDeclining(g, P1);
    if (i < 2) endTurnDeclining(g, P2);
  }
  assert.equal(influenceOf(g.engine, P1), 24, "1 + 2 + 3 = 6 influence paid by me");
  assert.equal(tgbControl(g), P2, "at the start of their turn it passed to them");
  assert.equal(tgbTokens(g), 0);
});

clause(BLADDER, "1:rule", "it only works while the item is in play, face-up: with 3 tokens on a face-down item (or one in my hand) nothing changes hands", () => {
  const g = bladderBoard({ bladder: "faceDown", tokens: 3 });
  endTurnDeclining(g, P1);
  assert.equal(g.engine.state.cards[g.id("tgb")].controllerId, P1);
});

// =================================================================================
// Verrucose Brains
// At the end of each turn, put the character with the lowest numeric cost into its
// owner's hand. If there is a tie, you decide which character is affected.
// Item, cost 5, [O][O].
// =================================================================================

const BRAINS = "d047e039-379a-442a-9221-6b37edff2363";

function brainsBoard(
  opts: {
    brains?: "play" | "hand" | "discard" | "faceDown";
    controller?: PlayerId;
    chars?: Array<{ key: string; cost: number; owner: PlayerId; controller?: PlayerId }>;
    extra?: CardPlacement[];
    active?: PlayerId;
    second?: boolean;
  } = {}
) {
  const where = opts.brains ?? "play";
  const chars = opts.chars ?? [
    { key: "c1", cost: 1, owner: P1 },
    { key: "c3", cost: 3, owner: P1 },
    { key: "f2", cost: 2, owner: P2 },
    { key: "f5", cost: 5, owner: P2 }
  ];
  return devBoard(
    [
      { key: "br", def: printing(BRAINS), owner: P1, controller: opts.controller, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      ...(opts.second ? [{ key: "br2", def: printing(BRAINS), owner: P1, zone: "play" as const }] : []),
      ...chars.map((c) => ({ key: c.key, def: character({ name: `Char ${c.key}`, cost: c.cost, life: 9 }), owner: c.owner, controller: c.controller, zone: "play" as const })),
      ...(opts.extra ?? [])
    ],
    { turn: opts.active === P2 ? 2 : undefined, activePlayerId: opts.active }
  );
}

type BrainsGame = ReturnType<typeof brainsBoard>;
/** `player` ends their turn; ties are broken by `tie` (a key), everything else declined. */
function endTurnTie(g: BrainsGame, player: PlayerId, tie?: string): { prompted: PendingChoiceLike | undefined } {
  g.engine.perform({ type: "endTurn", playerId: player });
  resolvePendingResponses(g.engine);
  let prompted: PendingChoiceLike | undefined;
  drain(g.engine, (pc) => {
    if (pc.kind === "selectTargets") {
      prompted = pc;
      const decl = ((pc.declarations as Array<{ id: string }>) ?? [])[0]?.id ?? "lowest";
      return { kind: "selectTargets", selected: { [decl]: tie ? [g.id(tie)] : [] } };
    }
    return declineAll(pc);
  });
  return { prompted };
}

clause(BRAINS, "0:rule", "at the end of my turn the character with the lowest numeric cost (here cost 1, mine) is put into its owner's hand", () => {
  const g = brainsBoard();
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("c1")), "handOf(g.engine, P1).includes(g.id(\"c1\"))");
  for (const key of ["c3", "f2", "f5"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
  assert.equal(g.engine.state.pendingChoice, undefined, "no tie, no question");
});

clause(BRAINS, "0:rule", "'each turn': it also happens at the end of my OPPONENT's turn", () => {
  const g = brainsBoard({ active: P2 });
  endTurnTie(g, P2);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  for (const key of ["c3", "f2", "f5"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

clause(BRAINS, "0:rule", "the lowest cost is judged across BOTH players' characters: when their character is cheapest, theirs goes to THEIR hand", () => {
  const g = brainsBoard({
    chars: [
      { key: "c2", cost: 2, owner: P1 },
      { key: "f1", cost: 1, owner: P2 },
      { key: "f4", cost: 4, owner: P2 }
    ]
  });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("f1")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("f1")), "into its owner's hand");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(BRAINS, "0:rule", "exactly ONE character is returned each turn end", () => {
  const g = brainsBoard();
  endTurnTie(g, P1);
  assert.equal(playOf(g.engine, P1).filter((c) => g.engine.getDefinition(c).type === "character").length, 1, "c3 remains");
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(BRAINS, "0:rule", "a cost of 0 is the lowest: a cost-0 character goes before a cost-1 character", () => {
  const g = brainsBoard({
    chars: [
      { key: "c0", cost: 0, owner: P1 },
      { key: "c1", cost: 1, owner: P1 },
      { key: "f1", cost: 1, owner: P2 }
    ]
  });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
  assert.equal(zoneOf(g.engine, g.id("f1")), "play");
});

clause(BRAINS, "0:rule", "the cost compared is the numeric cost (cost number), not strength or life: the cheapest character goes even when it is the strongest", () => {
  const g = devBoard([
    { key: "br", def: printing(BRAINS), owner: P1, zone: "play" },
    { key: "cheapBig", def: character({ name: "Cheap Big", cost: 1, strength: 9, life: 9 }), owner: P1, zone: "play" },
    { key: "priceyWeak", def: character({ name: "Pricey Weak", cost: 4, strength: 1, life: 1 }), owner: P2, zone: "play" }
  ]);
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("cheapBig")), "hand");
  assert.equal(zoneOf(g.engine, g.id("priceyWeak")), "play");
});

clause(BRAINS, "0:rule", "a character I control but my opponent owns goes to its OWNER's hand", () => {
  const g = brainsBoard({
    chars: [
      { key: "cap", cost: 1, owner: P2, controller: P1 },
      { key: "c3", cost: 3, owner: P1 }
    ]
  });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("cap")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("cap")), "its owner's hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("cap")), false);
});

clause(BRAINS, "0:rule", "only CHARACTERS count: a cheaper item or location is not affected and does not shield the cheapest character", () => {
  const g = brainsBoard({
    extra: [
      { key: "cheapItem", def: item({ name: "Cheap Item", cost: 0 }), owner: P1, zone: "play" },
      { key: "cheapPlace", def: location({ name: "Cheap Place", cost: 0 }), owner: P2, zone: "play" }
    ]
  });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("cheapItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("cheapPlace")), "play");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the cheapest character is returned");
});

clause(BRAINS, "0:rule", "a face-down card is only a resource (CR 411.1): a face-down cost-0 character is neither returned nor counted as the lowest", () => {
  const g = brainsBoard({ extra: [{ key: "fd", def: character({ name: "Hidden Cheap", cost: 0, life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the cheapest real character is returned instead");
});

clause(BRAINS, "0:rule", "a character with damage and a depleted one are returned like any other, undamaged and ready", () => {
  const g = brainsBoard({ chars: [{ key: "c1", cost: 1, owner: P1 }, { key: "f5", cost: 5, owner: P2 }] });
  g.engine.state.cards[g.id("c1")].damage = 4;
  g.engine.state.cards[g.id("c1")].depleted = true;
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.equal(g.engine.state.cards[g.id("c1")].damage, 0);
  assert.equal(g.engine.state.cards[g.id("c1")].depleted, false);
});

clause(BRAINS, "0:rule", "with no characters in play nothing happens and nothing breaks", () => {
  const g = brainsBoard({ chars: [] });
  endTurnTie(g, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("br")), "play");
});

clause(BRAINS, "0:rule", "with one character in play it is returned (it is the lowest)", () => {
  const g = brainsBoard({ chars: [{ key: "only", cost: 6, owner: P2 }] });
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("only")), "hand");
});

clause(BRAINS, "0:rule", "it happens every turn end: the next-cheapest character goes at the end of the following turn", () => {
  const g = brainsBoard();
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  endTurnTie(g, P2);
  assert.equal(zoneOf(g.engine, g.id("f2")), "hand", "cost 2 is now the lowest");
  endTurnTie(g, P1);
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
});

// ties

clause(BRAINS, "0:rule", "a tie: I decide which of the tied characters is returned (here two cost-1 characters, mine and theirs)", () => {
  const make = () =>
    brainsBoard({
      chars: [
        { key: "c1", cost: 1, owner: P1 },
        { key: "f1", cost: 1, owner: P2 },
        { key: "c4", cost: 4, owner: P1 }
      ]
    });
  const mine = make();
  const r1 = endTurnTie(mine, P1, "c1");
  assert.ok(r1.prompted, "I was asked");
  assert.equal(r1.prompted?.playerId, P1);
  assert.equal(zoneOf(mine.engine, mine.id("c1")), "hand");
  assert.equal(zoneOf(mine.engine, mine.id("f1")), "play");
  const theirs = make();
  endTurnTie(theirs, P1, "f1");
  assert.equal(zoneOf(theirs.engine, theirs.id("f1")), "hand", "I may choose THEIR character");
  assert.equal(zoneOf(theirs.engine, theirs.id("c1")), "play");
});

clause(BRAINS, "0:rule", "a tie: only the tied lowest characters can be chosen -- a higher-cost character is refused", () => {
  const g = brainsBoard({
    chars: [
      { key: "c1", cost: 1, owner: P1 },
      { key: "f1", cost: 1, owner: P2 },
      { key: "c4", cost: 4, owner: P1 }
    ]
  });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "selectTargets");
  const decl = ((pc.declarations as Array<{ id: string }>) ?? [])[0]?.id ?? "lowest";
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { [decl]: [g.id("c4")] } } } as never),
    "a cost-4 character is not tied for lowest"
  );
  assert.ok(pending(g.engine), "the choice is still open");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { [decl]: [g.id("f1")] } } } as never);
  assert.equal(zoneOf(g.engine, g.id("f1")), "hand", "control: a tied character works");
});

clause(BRAINS, "0:rule", "a tie: exactly one character is returned, not both", () => {
  const g = brainsBoard({
    chars: [
      { key: "c1", cost: 1, owner: P1 },
      { key: "f1", cost: 1, owner: P2 }
    ]
  });
  endTurnTie(g, P1, "c1");
  assert.equal(zoneOf(g.engine, g.id("f1")), "play");
});

clause(BRAINS, "0:rule", "a three-way tie is also mine to settle: any of the three can be chosen", () => {
  for (const key of ["a", "b", "c"]) {
    const g = brainsBoard({
      chars: [
        { key: "a", cost: 2, owner: P1 },
        { key: "b", cost: 2, owner: P2 },
        { key: "c", cost: 2, owner: P1 },
        { key: "d", cost: 3, owner: P2 }
      ]
    });
    endTurnTie(g, P1, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", key);
  }
});

clause(BRAINS, "0:rule", "'you decide': the tie is settled by the item's CONTROLLER even at the end of my opponent's turn (I am asked, not the active player)", () => {
  const g = brainsBoard({
    active: P2,
    chars: [
      { key: "c1", cost: 1, owner: P1 },
      { key: "f1", cost: 1, owner: P2 }
    ]
  });
  const { prompted } = endTurnTie(g, P2, "c1");
  assert.ok(prompted, "a tie question was asked");
  assert.equal(prompted?.playerId, P1, "the Brains' controller (me) decides, not the active player");
});

clause(BRAINS, "0:rule", "a Brains I own but my opponent controls: THEY settle ties, and it ticks at every turn end under their control", () => {
  const g = brainsBoard({
    controller: P2,
    chars: [
      { key: "c1", cost: 1, owner: P1 },
      { key: "f1", cost: 1, owner: P2 }
    ]
  });
  const { prompted } = endTurnTie(g, P1, "f1");
  assert.ok(prompted, "prompted");
  assert.equal(prompted?.playerId, P2, "its controller decides");
});

clause(BRAINS, "0:rule", "the ordinary case with no tie asks nobody", () => {
  const g = brainsBoard();
  const { prompted } = endTurnTie(g, P1);
  assert.equal(prompted, undefined);
});

// when it works

clause(BRAINS, "0:rule", "it only works while the item is in play, face-up: nothing is returned with it in my hand, my discard pile or face-down", () => {
  for (const brains of ["hand", "discard", "faceDown"] as const) {
    const g = brainsBoard({ brains });
    endTurnTie(g, P1);
    assert.equal(zoneOf(g.engine, g.id("c1")), "play", `no return with the item ${brains}`);
  }
});

clause(BRAINS, "0:rule", "two Brains each return a character: the two cheapest go, one per item", () => {
  const g = brainsBoard({ second: true });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("f2")), "hand", "the next-cheapest goes for the second item");
  assert.equal(zoneOf(g.engine, g.id("c3")), "play");
});

clause(BRAINS, "0:rule", "'At the end of each turn' happens when the turn actually ends, after my opponent has had the chance to respond (CR 610.1a), not when it is announced", () => {
  const g = brainsBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "the turn has not ended yet: nothing is returned");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond to the announcement");
});

// =================================================================================
// Witty Worm
// While this card is in your hand you may reveal this card as you are playing a resource.
// If you do, you may play this card for 1.
// When this card enters play, you may put a resource you control into its owner's hand. If
// you do, you may play a resource.
// Character (monstrosity), cost 4, [O][O], 2 strength / 3 speed / 2 life.
// =================================================================================

const WORM = "5161057f-2ee8-4f52-be3d-1c983ac1e2e0";

function wormBoard(
  opts: {
    worm?: "hand" | "discard" | "play" | "faceDown";
    icons?: Icons;
    oppIcons?: Icons;
    spent?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    hand?: boolean;
  } = {}
) {
  const where = opts.worm ?? "hand";
  return devBoard(
    [
      { key: "w", def: printing(WORM), owner: P1, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      ...(opts.hand === false
        ? []
        : [
            { key: "hres", def: resourceCard({ name: "Hand Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "ores", def: resourceCard({ name: "Their Rage Card", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { obsession: 5 }),
      ...(opts.spent ? res({ greed: opts.spent }).map((p) => ({ ...p, attachedToKey: "__factionA" })) : []),
      ...res(opts.oppIcons ?? { rage: 2 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type WormGame = ReturnType<typeof wormBoard>;
const myResources = (g: WormGame): CardInstanceId[] => playOf(g.engine, P1).filter((c) => g.engine.getDefinition(c).type === "resource" && !g.engine.state.cards[c].faceDown);
/**
 * Plays my resource card `key` through the Develop Rule and reports whether the Worm's reveal was offered as it is played
 * (a `resourceReveal` prompt, left open when it was); otherwise the resource has simply entered play.
 */
const wormOffered = (g: WormGame, key = "hres", faceDown = false): boolean =>
  holdResourceFace(() => {
    openDevelopPlay(g.engine, P1);
    if (g.engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)], faceDown } } as never);
    }
    if (g.engine.state.pendingChoice?.kind === "playResource") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown } } as never);
    }
    return g.engine.state.pendingChoice?.kind === "resourceReveal";
  });
/** Plays a resource through the Develop Rule and reveals the Worm for it; throws when the reveal is not offered. */
const revealWorm = (g: WormGame, key = "hres") => {
  if (!wormOffered(g, key)) throw new Error("the Worm's reveal was not offered");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal", cardId: g.id("w") } } as never);
};
/** Deploys the Worm from my hand the normal way and returns once its enters-play pick is open. */
const deployWorm = (g: WormGame) => play(g.engine, P1, g.id("w"));
const wormPick = (g: WormGame, cardId: CardInstanceId | undefined) => answerPending(g.engine, "chooserSelectsTarget", { selected: cardId ? [cardId] : [] });

// --- 0:rule: reveal as you play a resource -> play it for 1 ----------------------------------------------

clause(WORM, "0:rule", "revealing the Worm while playing a resource lets me play it for 1: it enters play and only 1 resource is paid", () => {
  const g = wormBoard({ icons: { obsession: 3 } });
  const before = ready(g.engine);
  revealWorm(g);
  assert.equal(before + 1 - ready(g.engine), 1, "the Worm costs 1, not 4 (the resource I played is a ready +1)");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(g.engine.state.cards[g.id("w")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("w")].controllerId, P1);
});

clause(WORM, "0:rule", "'play this card for 1' still needs its threshold [O][O]: one [O] among many other resources is refused, two work", () => {
  const one = wormBoard({ icons: { obsession: 1, greed: 5 } });
  assert.equal(wormOffered(one), false, "one [O]: the reveal is not offered");
  assert.equal(zoneOf(one.engine, one.id("w")), "hand");
  assert.equal(ready(one.engine), 7, "nothing was paid for the Worm (the 6 plus the resource I played)");
  const none = wormBoard({ icons: { greed: 6 } });
  assert.equal(wormOffered(none), false, "no [O]: the reveal is not offered");
  const two = wormBoard({ icons: { obsession: 2 } });
  revealWorm(two);
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("w")), "play", "control: two [O] and one spare resource");
});

clause(WORM, "0:rule", "'play this card for 1' needs a resource to pay the 1: with every resource spent it is refused", () => {
  const g = wormBoard({ icons: {}, extra: res({ obsession: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(g.engine), 0);
  assert.equal(wormOffered(g), false, "nothing to pay the 1 with: the reveal is not offered");
  assert.equal(zoneOf(g.engine, g.id("w")), "hand");
});

clause(WORM, "0:rule", "the reveal does not make the normal deploy cheaper: playing it from hand the usual way still costs 4", () => {
  const g = wormBoard({ icons: { obsession: 5 } });
  const before = ready(g.engine);
  deployWorm(g);
  assert.equal(before - ready(g.engine), 4);
  const short = wormBoard({ icons: { obsession: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("w")), "3 resources for a cost of 4");
});

clause(WORM, "0:rule", "'as you are playing a resource': the resource is played as well -- I reveal the Worm, play it for 1 AND the resource I chose enters play", () => {
  const g = wormBoard({ icons: { obsession: 3 } });
  revealWorm(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "the Worm was played for 1");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "...and the resource I was playing entered play too");
});

clause(WORM, "0:rule", "playing the Worm this way uses my Develop Rule for the turn (it happened as I played a resource): a second develop is refused", () => {
  const g = wormBoard({ icons: { obsession: 3 } });
  revealWorm(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineEverything);
  assert.equal(g.engine.state.pendingChoice, undefined, "the Develop Rule is spent: nothing more is offered");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand");
});

clause(WORM, "0:rule", "the Worm is revealed: the reveal is recorded for my opponent", () => {
  const g = wormBoard({ icons: { obsession: 3 } });
  revealWorm(g);
  const shown = revealsIn(g.engine).some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(g.id("w")));
  assert.equal(shown, true);
});

// The Worm gets no special treatment: its reveal-deploy is an effect-made deploy like any other, which resolves at once.
clause(WORM, "0:rule", "playing the Worm for 1 resolves like any effect-made deploy: it is in play, with no response window", () => {
  const g = wormBoard({ icons: { obsession: 3 } });
  revealWorm(g);
  assert.equal(g.engine.state.responseWindow, undefined, "no response window opens for an effect-made deploy");
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "the Worm is in play");
});

clause(WORM, "0:rule", "it only works while the Worm is in my HAND: not from my discard pile, not in play, not face-down", () => {
  for (const worm of ["discard", "play", "faceDown"] as const) {
    const g = wormBoard({ worm });
    assert.equal(wormOffered(g), false, `Worm ${worm}: the reveal is not offered`);
  }
});

clause(WORM, "0:rule", "only on my turn, with the Develop Rule: my opponent cannot use it", () => {
  const g = wormBoard();
  endTurnRaw(g.engine, P1); // the opponent's turn starts: only they have a Develop Rule to use
  assert.equal((g.engine.state.pendingChoice as unknown as { playerId: string }).playerId, P2);
  settleTurnStart(g.engine, "draw");
  assert.equal(g.engine.state.pendingChoice, undefined, "no reveal is offered to me on their turn");
  assert.equal(zoneOf(g.engine, g.id("w")), "hand");
});

clause(WORM, "0:rule", "'as you are playing a resource' covers every resource play, not only the Develop Rule: playing a resource with an effect (here Tumescent Guilt Bladder) also offers the reveal", () => {
  const bladder = printing(BLADDER);
  const g = wormBoard({
    icons: { obsession: 3 },
    extra: [{ key: "tgb", def: bladder, owner: P1, zone: "play" }]
  });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  // the Worm may be revealed after the resource is chosen and before it enters play (CR 605.1c): the offer is made now
  const offer = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] } | undefined;
  assert.ok(offer, "no chance to reveal the Worm was offered while the resource was being played");
  assert.equal(offer.kind, "resourceReveal");
  assert.equal(offer.playerId, P1);
  assert.deepEqual(offer.candidates, [g.id("w")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand", "the resource has not entered play yet");
  const readyBefore = readyResources(g.engine, P1);
  answerPending(g.engine, "resourceReveal", { cardId: g.id("w") });
  // the Worm's own enters-play prompt comes first; decline it
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "the Worm was deployed");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "...and the resource I was playing enters play as well");
  assert.equal(readyResources(g.engine, P1), readyBefore, "the Worm cost 1 and the new resource is a ready 1");
});

clause(WORM, "0:rule", "the reveal offered while an effect plays a resource is optional: declining plays just the resource and keeps the Worm in hand", () => {
  const g = wormBoard({
    icons: { obsession: 3 },
    extra: [{ key: "tgb", def: printing(BLADDER), owner: P1, zone: "play" }]
  });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.equal(pending(g.engine)?.kind, "resourceReveal");
  const readyBefore = readyResources(g.engine, P1);
  answerPending(g.engine, "resourceReveal", {});
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "hand", "the Worm stays in hand");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(readyResources(g.engine, P1), readyBefore + 1, "nothing was paid");
});

clause(WORM, "0:rule", "the reveal is only offered when its deploy looks possible: with no resource left to pay the 1, or with the Worm's [O][O] unmet, the resource just enters play", () => {
  const broke = wormBoard({
    icons: { obsession: 3 },
    extra: [{ key: "tgb", def: printing(BLADDER), owner: P1, zone: "play" }]
  });
  for (const cid of broke.engine.state.players[P1].play) {
    if (broke.engine.getDefinition(cid).type === "resource") broke.engine.state.cards[cid].attachedTo = broke.engine.state.players[P1].factionId!;
  }
  broke.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(broke.engine);
  answerPending(broke.engine, "chooserSelectsTarget", { selected: [broke.id("hres")] });
  assert.equal(pending(broke.engine), undefined, "all my resources are spent: nothing to pay the 1 with");
  assert.equal(zoneOf(broke.engine, broke.id("hres")), "play");
  const weak = wormBoard({
    icons: { rage: 3 },
    extra: [{ key: "tgb", def: printing(BLADDER), owner: P1, zone: "play" }]
  });
  weak.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(weak.engine);
  answerPending(weak.engine, "chooserSelectsTarget", { selected: [weak.id("hres")] });
  assert.equal(pending(weak.engine), undefined, "no [O][O] to deploy the Worm with");
  assert.equal(zoneOf(weak.engine, weak.id("w")), "hand");
});

// --- 1:rule: when it enters play, may return a resource, then may play a resource ---------------------

clause(WORM, "1:rule", "when it enters play I may put a resource I control into its owner's hand; then I may play a resource (here the one I just returned)", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  const [r0] = myResources(g);
  wormPick(g, r0);
  assert.equal(zoneOf(g.engine, r0), "hand", "the resource is back in its owner's hand");
  expectPending(g.engine, "chooserSelectsTarget");
  wormPick(g, r0);
  assert.equal(zoneOf(g.engine, r0), "play", "...and I played it again");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WORM, "1:rule", "'you may put': declining the first pick does nothing and offers no resource play", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  const before = myResources(g).length;
  deployWorm(g);
  wormPick(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined, "'If you do' failed: no second prompt");
  assert.equal(myResources(g).length, before, "my resources are all still in play");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(WORM, "1:rule", "'If you do, you may play a resource': I may decline the play; the returned resource then stays in my hand", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const [r0] = myResources(g);
  wormPick(g, r0);
  wormPick(g, undefined);
  assert.equal(zoneOf(g.engine, r0), "hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WORM, "1:rule", "the resource played afterwards can be a different card from my hand: a Greed card enters play face-up", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const [r0] = myResources(g);
  wormPick(g, r0);
  wormPick(g, g.id("hres"));
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(g.engine.state.cards[g.id("hres")].faceDown, false);
  assert.equal(zoneOf(g.engine, r0), "hand", "the returned resource stays in hand");
});

clause(WORM, "1:rule", "'play a resource': a card that is not a resource is played face-down", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const [r0] = myResources(g);
  wormPick(g, r0);
  wormPick(g, g.id("hchar"));
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play");
  assert.equal(g.engine.state.cards[g.id("hchar")].faceDown, true);
});

clause(WORM, "1:rule", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const [r0] = myResources(g);
  wormPick(g, r0);
  wormPick(g, g.id("hres"));
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(WORM, "1:rule", "returning and replaying a SPENT resource un-spends it: the replayed card is a fresh, ready resource (+1 ready resource)", () => {
  const g = wormBoard({ icons: { obsession: 4 }, spent: 1 });
  deployWorm(g);
  const spentOne = playOf(g.engine, P1).find((c) => g.engine.state.cards[c].attachedTo !== undefined && g.engine.isResource(c));
  assert.ok(spentOne, "control: some resource is attached to my faction");
  const readyBefore = ready(g.engine);
  wormPick(g, spentOne);
  assert.equal(g.engine.state.cards[spentOne!].attachedTo, undefined);
  wormPick(g, spentOne);
  assert.equal(ready(g.engine), readyBefore + 1, "the replayed resource is ready");
});

clause(WORM, "1:rule", "a face-down card I control is a resource and can be put into my hand (it comes back face-up as its real card)", () => {
  const g = wormBoard({ icons: { obsession: 6 }, extra: [{ key: "fd", def: character({ name: "My Hidden" }), owner: P1, zone: "play", faceDown: true }] });
  deployWorm(g);
  wormPick(g, g.id("fd"));
  assert.equal(zoneOf(g.engine, g.id("fd")), "hand");
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, false);
  wormPick(g, undefined);
});

clause(WORM, "1:rule", "'a resource you control' goes to ITS OWNER's hand: a resource I control but my opponent owns goes to their hand, and I may still play a resource from mine", () => {
  const g = wormBoard({
    icons: { obsession: 6 },
    extra: [{ key: "stolen", def: resourceCard({ name: "Stolen Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, controller: P1, zone: "play" }]
  });
  deployWorm(g);
  wormPick(g, g.id("stolen"));
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("stolen")), "in its owner's (my opponent's) hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("stolen")), false);
  expectPending(g.engine, "chooserSelectsTarget");
  wormPick(g, g.id("hres"));
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "'If you do' is satisfied: I may play a resource from my hand");
});

clause(WORM, "1:rule", "only a resource I control: my opponent's resources, my characters and cards in my hand are refused", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const theirs = playOf(g.engine, P2).find((c) => g.engine.isResource(c))!;
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => wormPick(g, theirs), "an opponent's resource");
  refused(() => wormPick(g, g.id("ally")), "my character");
  refused(() => wormPick(g, g.id("hres")), "a resource card in my hand");
  refused(() => wormPick(g, g.id("w")), "the Worm itself");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [myResources(g)[0], myResources(g)[1]] }), "two resources");
  assert.ok(pending(g.engine), "pending(g.engine)");
  wormPick(g, myResources(g)[0]);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
});

clause(WORM, "1:rule", "the second step is my hand only: my opponent's hand card is refused", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  wormPick(g, myResources(g)[0]);
  refused(() => wormPick(g, g.id("ores")), "their hand card");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(WORM, "1:rule", "playing the resource this way does not use up my Develop Rule", () => {
  const g = wormBoard({ icons: { obsession: 6 } });
  deployWorm(g);
  const [r0] = myResources(g);
  wormPick(g, r0);
  wormPick(g, r0);
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("hres"), false);
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "I can still develop afterwards");
});

clause(WORM, "1:rule", "with no resource I control there is nothing to return: no prompt, no second step", () => {
  // (no resources in play: the Worm is put into play by an effect instead of being paid for)
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const h = devBoard([
    { key: "w", def: printing(WORM), owner: P1, zone: "hand" },
    { key: "pip", def: putter, owner: P1, zone: "hand" },
    { key: "hres", def: resourceCard({ name: "Hand Greed" }), owner: P1, zone: "hand" }
  ]);
  play(h.engine, P1, h.id("pip"), { selected: { t: [h.id("w")] } });
  assert.equal(zoneOf(h.engine, h.id("w")), "play");
  assert.equal(h.engine.state.pendingChoice, undefined, "nothing to return, so no prompt");
  assert.equal(zoneOf(h.engine, h.id("hres")), "hand");
});

clause(WORM, "1:rule", "it triggers however the Worm enters play: put into play by an effect (not deployed) also asks", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = wormBoard({ icons: { obsession: 4 }, extra: [{ key: "pip", def: putter, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("w")] } });
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  wormPick(g, undefined);
});

clause(WORM, "1:rule", "it triggers when the Worm enters play via the reveal route too", () => {
  const g = wormBoard({ icons: { obsession: 4 } });
  revealWorm(g);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  wormPick(g, undefined);
});

clause(WORM, "1:rule", "it is the WORM's own entering that triggers it: another character entering play does not", () => {
  const g = wormBoard({ worm: "play", icons: { obsession: 6 } });
  play(g.engine, P1, g.id("hchar"));
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WORM, "1:rule", "a Worm that is not in play does nothing: with it in my hand, my discard pile or face-down, no prompt appears when another card enters", () => {
  for (const worm of ["hand", "discard", "faceDown"] as const) {
    const g = wormBoard({ worm, icons: { obsession: 4 } });
    play(g.engine, P1, g.id("hchar"));
    assert.equal(g.engine.state.pendingChoice, undefined, `Worm ${worm}`);
  }
});

// =================================================================================
// Woadenworm Gloamspike, Thabbashite Prince
// UNIQUE GLOAMSPIKE
// All your face-down tactics gain FLIP UP with numeric cost and threshold equal to their
// regular numeric cost and threshold.
// Character (prince, advisor), cost 4, [O][O][O], 2 strength / 3 speed / 4 life.
// =================================================================================

const GLOAM = "a7a11a96-2201-43c6-9710-be53bc9e6ab3";

function gloamBoard(
  opts: {
    gloam?: "play" | "hand" | "discard" | "faceDown";
    gloamController?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    tactic?: CardDefinition;
    spent?: boolean;
    bare?: boolean;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const where = opts.gloam ?? "play";
  return devBoard(
    [
      { key: "gl", def: printing(GLOAM), owner: P1, controller: opts.gloamController, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "ft", def: opts.tactic ?? hiddenTactic({ cost: 2, threshold: "g", name: "Hidden Burn" }), owner: P1, zone: "play", faceDown: true, attachedToKey: opts.spent ? "__factionA" : undefined },
      ...(opts.bare
        ? []
        : [
            { key: "fdChar", def: character({ name: "Hidden Character", cost: 1 }), owner: P1, zone: "play" as const, faceDown: true },
            { key: "fdItem", def: item({ name: "Hidden Item", cost: 1 }), owner: P1, zone: "play" as const, faceDown: true },
            { key: "fdPlace", def: location({ name: "Hidden Place", cost: 1 }), owner: P1, zone: "play" as const, faceDown: true }
          ]),
      { key: "foeFt", def: hiddenTactic({ cost: 2, threshold: "r", name: "Their Hidden Burn" }), owner: P2, zone: "play", faceDown: true },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...res(opts.oppIcons ?? { rage: 4 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type GloamGame = ReturnType<typeof gloamBoard>;
const flipTactic = (g: GloamGame, key = "ft", player: PlayerId = P1, selected: Record<string, CardInstanceId[]> = {}) => flipUpRaw(g.engine, player, g.id(key), selected);

// --- UNIQUE GLOAMSPIKE ---------------------------------------------------------------------------------------

function gloamPair() {
  return devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "gl2", def: printing(GLOAM), owner: P1, zone: "hand" },
    { key: "other", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ obsession: 8 })
  ]);
}

for (const keep of ["gl", "gl2"] as const) {
  clause(GLOAM, "0:unique", `a second copy: its controller is asked which to keep (keeping ${keep === "gl" ? "the old" : "the new"} one) and the other is destroyed`, () => {
    const { engine, id } = gloamPair();
    play(engine, P1, id("gl2"));
    const pc = expectPending(engine, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "its controller chooses");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [id("gl"), id("gl2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const lost = keep === "gl" ? "gl2" : "gl";
    assert.equal(zoneOf(engine, id(keep)), "play");
    assert.equal(zoneOf(engine, id(lost)), "discard");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("other")), "play");
  });
}

clause(GLOAM, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = gloamPair();
  play(engine, P1, id("gl2"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("other") } } as never), "keeping a bystander");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
});

clause(GLOAM, "0:unique", "UNIQUE is per player: my opponent may control their own Gloamspike with no choice and no destruction", () => {
  const { engine, id } = devBoard(
    [
      { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
      { key: "gl2", def: printing(GLOAM), owner: P2, zone: "hand" },
      ...res({ obsession: 8 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(engine, P2, id("gl2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(zoneOf(engine, id("gl2")), "play");
});

clause(GLOAM, "0:unique", "a second copy in my hand or my discard pile is no conflict", () => {
  const { engine, id } = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "inHand", def: printing(GLOAM), owner: P1, zone: "hand" },
    { key: "inDisc", def: printing(GLOAM), owner: P1, zone: "discard" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gl")), "play");
});

clause(GLOAM, "0:unique", "after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "discard" },
    { key: "gl2", def: printing(GLOAM), owner: P1, zone: "hand" },
    ...res({ obsession: 8 })
  ]);
  play(engine, P1, id("gl2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gl2")), "play");
});

clause(GLOAM, "0:unique", "a different Unique card is not a conflict", () => {
  const { engine, id } = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "uniq", def: character({ name: "Someone Else", unique: "someone else" }), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("uniq")), "play");
});

clause(GLOAM, "0:unique", "taking control of my opponent's Gloamspike while I control one makes me choose which to keep (FAQ: the controller chooses), and the game goes on", () => {
  const { engine, id } = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "foeGl", def: printing(GLOAM), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("steal"), { selected: { t: [id("foeGl")] } });
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("gl") } } as never);
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(zoneOf(engine, id("foeGl")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  resolvePendingResponses(engine); // throws "did not converge" when the game is soft-locked
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the stealing tactic finished resolving");
});

clause(GLOAM, "0:unique", "a face-down Gloamspike is only a resource (CR 411.1): it does not conflict with a face-up one", () => {
  const { engine, id } = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "glFd", def: printing(GLOAM), owner: P1, zone: "play", faceDown: true }
  ]);
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(zoneOf(engine, id("glFd")), "play");
});

// --- the rule: my face-down tactics gain FLIP UP ----------------------------------------------------------------

clause(GLOAM, "1:rule", "a face-down tactic of mine (no printed FLIP UP) can be flipped up: it resolves (3 damage to their faction) and ends in my discard pile", () => {
  const g = gloamBoard();
  flipTactic(g);
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27, "the tactic's effect happened");
  assert.equal(zoneOf(g.engine, g.id("ft")), "discard");
  assert.equal(g.engine.state.cards[g.id("ft")].faceDown, false);
});

clause(GLOAM, "1:rule", "without a Gloamspike the same face-down tactic cannot be flipped up (it has no FLIP UP of its own)", () => {
  const g = gloamBoard({ gloam: "hand" });
  refused(() => flipTactic(g), "no FLIP UP");
  assert.equal(g.engine.state.cards[g.id("ft")].faceDown, true);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(GLOAM, "1:rule", "FLIP UP cost = its regular numeric cost: a cost-3 tactic needs three ready resources (itself included), two are refused", () => {
  const ok = gloamBoard({ bare: true, tactic: hiddenTactic({ cost: 3, threshold: "g" }), icons: { greed: 2 }, extra: res({ greed: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(ok.engine), 3, "two ready Greed and the face-down tactic itself");
  flipTactic(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("ft")].faceDown, false, "flipped for its numeric cost of 3");
  const bad = gloamBoard({ bare: true, tactic: hiddenTactic({ cost: 3, threshold: "g" }), icons: { greed: 1 }, extra: res({ greed: 3 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(bad.engine), 2);
  refused(() => flipTactic(bad), "2 ready resources for a numeric cost of 3");
  assert.equal(bad.engine.state.cards[bad.id("ft")].faceDown, true);
});

clause(GLOAM, "1:rule", "FLIP UP cost = its regular numeric cost: a cost-0 tactic is flipped up for nothing", () => {
  const g = gloamBoard({ tactic: hiddenTactic({ cost: 0, threshold: "" }), icons: {}, extra: res({ greed: 1 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  flipTactic(g);
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(GLOAM, "1:rule", "FLIP UP pays no more than its numeric cost: a cost-2 tactic with many resources spends at most two", () => {
  const g = gloamBoard({ icons: { greed: 6 } });
  flipTactic(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 2, "attachedCount(g.engine, P1) <= 2");
});

clause(GLOAM, "1:rule", "FLIP UP threshold = its regular threshold: a [G] tactic needs Greed, Obsession alone is refused", () => {
  const bad = gloamBoard({ icons: { obsession: 5 } });
  refused(() => flipTactic(bad), "no [G]");
  assert.equal(bad.engine.state.cards[bad.id("ft")].faceDown, true);
  assert.equal(ready(bad.engine), 9, "nothing was paid");
  const good = gloamBoard({ icons: { obsession: 3, greed: 1 } });
  flipTactic(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("ft")].faceDown, false, "control: one [G] meets the threshold");
});

clause(GLOAM, "1:rule", "FLIP UP threshold = its regular threshold, whole: a [G][G] tactic needs two Greed (one is refused)", () => {
  const make = (greed: number) => gloamBoard({ tactic: hiddenTactic({ cost: 1, threshold: "gg" }), icons: { greed, obsession: 3 } });
  const bad = make(1);
  refused(() => flipTactic(bad), "one [G] for [G][G]");
  const good = make(2);
  flipTactic(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("ft")].faceDown, false);
});

clause(GLOAM, "1:rule", "my opponent's icons do not meet the threshold", () => {
  const g = gloamBoard({ icons: { obsession: 5 }, oppIcons: { greed: 5 } });
  refused(() => flipTactic(g), "their Greed is not mine");
});

clause(GLOAM, "1:rule", "the granted FLIP UP is real FLIP UP: the tactic is played as itself and its own picks are asked", () => {
  const g = gloamBoard({ tactic: hiddenTactic({ cost: 1, threshold: "g", pick: true }) });
  refused(() => flipTactic(g), "its own required pick is missing");
  flipTactic(g, "ft", P1, { t: [g.id("foe")] });
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27);
  assert.equal(zoneOf(g.engine, g.id("ft")), "discard");
});

// who is affected

clause(GLOAM, "1:rule", "only TACTICS gain it: a face-down character, item and location of mine cannot be flipped up", () => {
  const g = gloamBoard();
  for (const key of ["fdChar", "fdItem", "fdPlace"]) {
    refused(() => flipTactic(g, key), `${key} is not a tactic`);
    assert.equal(g.engine.state.cards[g.id(key)].faceDown, true, `${key} stays face-down`);
  }
});

clause(GLOAM, "1:rule", "'All YOUR face-down tactics': my opponent's face-down tactic does not gain FLIP UP from my Gloamspike", () => {
  const g = gloamBoard({ turn: 2, active: P2, oppIcons: { rage: 6 } });
  refused(() => flipTactic(g, "foeFt", P2), "their tactic gets nothing from my Gloamspike");
  assert.equal(g.engine.state.cards[g.id("foeFt")].faceDown, true);
});

clause(GLOAM, "1:rule", "...and a Gloamspike under my opponent's control grants it to THEIR tactics, not mine", () => {
  const g = gloamBoard({ gloamController: P2, turn: 2, active: P2, oppIcons: { rage: 6 } });
  refused(() => flipTactic(g, "ft"), "my tactic gets nothing from their Gloamspike");
  flipTactic(g, "foeFt", P2);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("foeFt")].faceDown, false, "their face-down tactic can be flipped up");
  assert.equal(influenceOf(g.engine, P1), 27, "its effect hit me");
});

clause(GLOAM, "1:rule", "'your' means control: a face-down tactic I control but my opponent owns gains it and goes to its owner's discard pile", () => {
  const g = gloamBoard({ extra: [{ key: "cap", def: hiddenTactic({ cost: 1, threshold: "g", name: "Captured Tactic" }), owner: P2, controller: P1, zone: "play", faceDown: true }] });
  flipTactic(g, "cap");
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27);
  assert.ok(discardOf(g.engine, P2).includes(g.id("cap")), "a tactic goes to its owner's discard pile");
});

clause(GLOAM, "1:rule", "'face-down': a tactic in my hand gets nothing (and cannot be 'flipped')", () => {
  const g = gloamBoard({ extra: [{ key: "handTac", def: hiddenTactic({ cost: 1, name: "Hand Tactic" }), owner: P1, zone: "hand" }] });
  refused(() => flipTactic(g, "handTac"), "a tactic in hand");
  assert.equal(zoneOf(g.engine, g.id("handTac")), "hand");
});

clause(GLOAM, "1:rule", "it only works while the Gloamspike is in play, face-up: not from my hand, my discard pile or face-down", () => {
  for (const gloam of ["hand", "discard", "faceDown"] as const) {
    const g = gloamBoard({ gloam });
    refused(() => flipTactic(g), `Gloamspike ${gloam}`);
    assert.equal(g.engine.state.cards[g.id("ft")].faceDown, true);
  }
});

clause(GLOAM, "1:rule", "the grant ends when the Gloamspike leaves play: after it is destroyed the tactic can no longer be flipped up", () => {
  const g = gloamBoard({ turn: 2, active: P2, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("gl")] } });
  assert.equal(zoneOf(g.engine, g.id("gl")), "discard", "control: destroyed");
  g.engine.state.activePlayerId = P1;
  g.engine.state.turn = 3;
  refused(() => flipTactic(g), "no Gloamspike any more");
  assert.equal(g.engine.state.cards[g.id("ft")].faceDown, true);
});

clause(GLOAM, "1:rule", "a tactic that has its OWN printed FLIP UP also gains the granted one (it gains FLIP UP): Redonkulous (FLIP UP 5 [O][O]) can be flipped up for its regular cost 3 [O][O]", () => {
  const g = devBoard([
    { key: "gl", def: printing(GLOAM), owner: P1, zone: "play" },
    { key: "red", def: printing(REDONK), owner: P1, zone: "play", faceDown: true },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...res({ obsession: 2 })
  ]);
  assert.equal(ready(g.engine), 3, "two Obsession and the face-down Redonkulous itself");
  flipUpRaw(g.engine, P1, g.id("red"), { char: [g.id("foe")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("red")].faceDown, false, "flipped up for 3 using the granted FLIP UP");
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
});

clause(GLOAM, "1:rule", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = gloamBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => flipTactic(g), "nothing to respond to yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipTactic(g);
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(GLOAM, "1:rule", "a face-down tactic that was already spent this turn (attached to my faction) is still a face-down tactic in play and can use the granted FLIP UP (CR 507.4a)", () => {
  const g = gloamBoard({ spent: true });
  flipTactic(g);
  resolvePendingResponses(g.engine);
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(GLOAM, "1:rule", "a tactic flipped up with the granted FLIP UP is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = gloamBoard();
  holdFlipUp(() => flipTactic(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(influenceOf(g.engine, P2), 30, "the effect has not happened yet");
});

// --- Meat of the Mountain controlled by my OPPONENT (the rule is about 'a player', not about the controller) ------------

clause(MEAT, "0:rule", "the item under my opponent's control still offers the choice to ME when I draw (it is 'a player', not its controller)", () => {
  const g = meatBoard({ tokens: 1, controller: P2 });
  meatDraw(g, P1);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the player who drew decides");
  optionFor(pc, "add");
  optionFor(pc, "remove");
  optionFor(pc, "nothing");
});

clause(MEAT, "1:rule", "with the item under my opponent's control, when I draw and remove its last token, 'that player's opponent' (the item's controller) discards", () => {
  const g = meatBoard({ tokens: 1, controller: P2 });
  const mine = handOf(g.engine, P1);
  const theirs = handOf(g.engine, P2);
  meatChange(g, P1, "remove");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent (the drawer's opponent) discards");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.deepEqual(handOf(g.engine, P2), theirs.filter((c) => c !== g.id("oh0")));
  assert.equal(handOf(g.engine, P1).length, mine.length + 1, "I kept my cards (and drew one)");
});

clause(MEAT, "3:rule", "with the item under my opponent's control, when I reach 2 tokens I pick (my own pick, not its controller's)", () => {
  const g = meatBoard({ tokens: 1, controller: P2 });
  meatAtTwo(g, P1);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
});

clause(MEAT, "4:rule", "with the item under my opponent's control, when I reach 3 tokens I may play a resource from MY hand", () => {
  const g = meatBoard({ tokens: 2, controller: P2 });
  meatChange(g, P1, "add");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mres")] });
  assert.equal(zoneOf(g.engine, g.id("mres")), "play");
  assert.equal(g.engine.state.cards[g.id("mres")].controllerId, P1);
});
