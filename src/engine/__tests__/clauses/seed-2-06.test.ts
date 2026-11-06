// Clause tests — batch seed-2-06. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-06`. Expectations come from each
// card's PRINTED text (markup); engine data is only used to drive the engine.

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
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, developOffers } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ rage: 3, greed: 2 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

/** `n` rage resources already spent (attached to the faction): they still provide [R] but cannot pay. */
const spentRage = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("rage", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const cardOf = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id];
const damageOf = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].damage;
const START = 30; // developFaction() starts at 30 influence
const PADAMOSE = "1be3f538-efa8-4269-ace1-af5a0ddcdefd";
const SURPLUS = "95cc746f-1d3e-4cde-bc30-c0a884c4fbd0";

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

/** A free tactic (id "hit", pick "t"): the picked character takes `amount` damage. */
function damageTactic(amount: number, name = `Hit ${amount}`): CardDefinition {
  return tactic({
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
}

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to`. */
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
      abilities: [{ id: "rm", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic (id "st", pick "t"): the caster takes control of the picked card in play. */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "st", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }]
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

/** A resource card (not a staple) that provides the given icons. */
function iconResource(provides: string[], name = `Icons ${provides.join("+")}`): CardDefinition {
  return resourceCard({ name, resource: { provides: provides as never, staple: false } });
}


/** A free tactic (id "pip", pick "t" among `owner`'s cards in `zone`): puts the picked card into play under `controller`'s control. */
function putIntoPlayTactic(zone: Zone, owner: "self" | "opponent", controller: "controller" | "opponent", name = `Put into play (${zone})`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone, owner }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller }]
        }
      ]
    }
  });
}

/** A free tactic (id "rmtok", pick "t"): removes `n` tokens from the picked card in play. */
function removeTokensTactic(n: number, name = `Remove ${n} tokens`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rmtok",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: n }]
        }
      ]
    }
  });
}

// =================================================================================
// Acidic Phlegm
// Inflict 1 damage to all characters.
// FLIP UP: 3 [R][R] and play a resource.
// Tactic, cost 2, [R][R].
// =================================================================================

const ACIDIC = "bb958389-aea2-49dd-b8b1-b5f8c20f826b";

function acidicBoard(
  opts: {
    ph?: "hand" | "faceDown" | "faceUp" | "discard";
    icons?: Icons;
    oppIcons?: Icons;
    spent?: boolean;
    phSpent?: boolean;
    turn?: number;
    active?: PlayerId;
    hand?: boolean;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.ph ?? "hand";
  return devBoard(
    [
      {
        key: "ph",
        def: printing(ACIDIC),
        owner: P1,
        zone: where === "faceDown" || where === "faceUp" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.phSpent ? "__factionA" : undefined
      },
      { key: "m3", def: character({ name: "Mine L3", life: 3 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine L1", life: 1 }), owner: P1, zone: "play" },
      { key: "f3", def: character({ name: "Foe L3", life: 3 }), owner: P2, zone: "play" },
      { key: "f1", def: character({ name: "Foe L1", life: 1 }), owner: P2, zone: "play" },
      ...(opts.hand === false
        ? []
        : [
            { key: "hres", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "p2hand", def: resourceCard({ name: "Their Hand Resource" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { rage: 5 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type AcidicGame = ReturnType<typeof acidicBoard>;

const acidic = (g: AcidicGame) => play(g.engine, P1, g.id("ph"));
const acidicAttempt = (g: AcidicGame) => () => playRaw(g.engine, P1, g.id("ph"));

clause(ACIDIC, "0:rule", "inflicts exactly 1 damage to every character in play, mine and my opponent's", () => {
  const g = acidicBoard();
  acidic(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["m3", "f3"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
    assert.equal(damageOf(g.engine, g.id(key)), 1, `${key} took exactly 1 damage`);
  }
});

clause(ACIDIC, "0:rule", "a 1-life character is destroyed by it and goes to its owner's discard pile; 3-life characters survive", () => {
  const g = acidicBoard();
  acidic(g);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "my 1-life character is destroyed");
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard", "their 1-life character is destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("m1")), "discardOf(g.engine, P1).includes(g.id(\"m1\"))");
  assert.ok(discardOf(g.engine, P2).includes(g.id("f1")), "discardOf(g.engine, P2).includes(g.id(\"f1\"))");
  assert.equal(zoneOf(g.engine, g.id("m3")), "play");
  assert.equal(zoneOf(g.engine, g.id("f3")), "play");
});

clause(ACIDIC, "0:rule", "it damages ALL characters, not just one side: many characters on both sides all take 1", () => {
  const g = acidicBoard({
    extra: [
      ...Array.from({ length: 4 }, (_, i) => ({ key: `ma${i}`, def: character({ name: `Mine Extra ${i}`, life: 5 }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `fa${i}`, def: character({ name: `Foe Extra ${i}`, life: 5 }), owner: P2, zone: "play" as const }))
    ]
  });
  acidic(g);
  for (const key of ["ma0", "ma1", "ma2", "ma3", "fa0", "fa1", "fa2", "fa3"]) assert.equal(damageOf(g.engine, g.id(key)), 1, `${key} took 1 damage`);
});

clause(ACIDIC, "0:rule", "the damage adds to damage a character already has (a character with 1 damage ends with 2)", () => {
  const g = acidicBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 1 }] });
  acidic(g);
  assert.equal(damageOf(g.engine, g.id("hurt")), 2);
});

clause(ACIDIC, "0:rule", "a character at 2 damage with 3 life is destroyed by the extra point (damage reaches its life)", () => {
  const g = acidicBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P2, zone: "play", damage: 2 }] });
  acidic(g);
  assert.equal(zoneOf(g.engine, g.id("hurt")), "discard");
});

clause(ACIDIC, "0:rule", "only characters are hurt: an item, a location, a face-up resource, a face-down card and both factions are untouched", () => {
  const g = acidicBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P1, zone: "play" },
      { key: "place2", def: location({ name: "Their Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "fdChar", def: character({ name: "Hidden Character", life: 3 }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  acidic(g);
  assert.equal(damageOf(g.engine, g.id("m3")), 1, "control: characters were damaged");
  for (const key of ["thing", "place", "place2", "fdChar"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays in play`);
    assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} took no damage`);
  }
  assert.equal(influenceOf(g.engine, P1), START, "my faction is not a character");
  assert.equal(influenceOf(g.engine, P2), START, "their faction is not a character");
  assert.equal(damageOf(g.engine, g.engine.state.players[P1].factionId!), 0);
  assert.equal(damageOf(g.engine, g.engine.state.players[P2].factionId!), 0);
});

clause(ACIDIC, "0:rule", "only characters IN PLAY are hurt: characters in hands, decks and discard piles take no damage", () => {
  const g = acidicBoard({
    extra: [
      { key: "h1", def: character({ name: "Hand One", life: 3 }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "Hand Two", life: 3 }), owner: P2, zone: "hand" },
      { key: "d1", def: character({ name: "Deck One", life: 3 }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "Deck Two", life: 3 }), owner: P2, zone: "deck" },
      { key: "x1", def: character({ name: "Disc One", life: 3 }), owner: P1, zone: "discard" },
      { key: "x2", def: character({ name: "Disc Two", life: 3 }), owner: P2, zone: "discard" }
    ]
  });
  acidic(g);
  assert.equal(damageOf(g.engine, g.id("m3")), 1, "control: the effect happened");
  for (const key of ["h1", "h2", "d1", "d2", "x1", "x2"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} is not in play and takes no damage`);
});

clause(ACIDIC, "0:rule", "a character I control but do not own, and one I own but do not control, are both damaged (all characters)", () => {
  const g = acidicBoard({
    extra: [
      { key: "stolenIn", def: character({ name: "Stolen In", life: 4 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenOut", def: character({ name: "Stolen Out", life: 4 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  acidic(g);
  assert.equal(damageOf(g.engine, g.id("stolenIn")), 1);
  assert.equal(damageOf(g.engine, g.id("stolenOut")), 1);
});

clause(ACIDIC, "0:rule", "a depleted character is damaged like any other", () => {
  const g = acidicBoard({ extra: [{ key: "tired", def: character({ name: "Tired", life: 4 }), owner: P2, zone: "play", depleted: true }] });
  acidic(g);
  assert.equal(damageOf(g.engine, g.id("tired")), 1);
});

clause(ACIDIC, "0:rule", "with no character in play it still resolves (nothing happens) and ends in my discard pile", () => {
  const g = devBoard([{ key: "ph", def: printing(ACIDIC), owner: P1, zone: "hand" }, ...res({ rage: 4 })]);
  const before = ready(g.engine);
  acidic(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(before - ready(g.engine), 2, "the cost was paid");
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ACIDIC, "0:rule", "two Acidic Phlegms deal 2 damage in total (each inflicts 1)", () => {
  const g = acidicBoard({
    icons: { rage: 6 },
    extra: [
      { key: "ph2", def: printing(ACIDIC), owner: P1, zone: "hand" },
      { key: "big", def: character({ name: "Big", life: 6 }), owner: P2, zone: "play" }
    ]
  });
  acidic(g);
  play(g.engine, P1, g.id("ph2"));
  assert.equal(damageOf(g.engine, g.id("big")), 2);
  assert.equal(damageOf(g.engine, g.id("m3")), 2);
});

clause(ACIDIC, "0:rule", "the tactic ends in its owner's discard pile after resolving", () => {
  const g = acidicBoard();
  acidic(g);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ph")), "discardOf(g.engine, P1).includes(g.id(\"ph\"))");
});

clause(ACIDIC, "0:rule", "costs exactly 2: two resources are paid when it is played, before the opponent can respond", () => {
  const g = acidicBoard({ icons: { rage: 5 } });
  const before = ready(g.engine);
  acidicAttempt(g)();
  assert.equal(before - ready(g.engine), 2, "the printed cost of 2 is paid at once");
  assert.equal(damageOf(g.engine, g.id("m3")), 0, "the effect has not happened yet (the opponent may respond)");
  assert.equal(g.engine.state.priorityPlayerId, P2);
});

clause(ACIDIC, "0:rule", "cost 2: with one ready resource it is refused (nothing is paid), with two it is played", () => {
  const one = acidicBoard({ icons: {}, extra: [...spentRage(2), ...res({ greed: 1 })] });
  assert.equal(ready(one.engine), 1);
  refused(acidicAttempt(one), "one ready resource for a cost of 2");
  assert.equal(zoneOf(one.engine, one.id("ph")), "hand", "still in hand");
  assert.equal(ready(one.engine), 1, "nothing was paid");
  const two = acidicBoard({ icons: {}, extra: [...spentRage(2), ...res({ greed: 2 })] });
  acidic(two);
  assert.equal(zoneOf(two.engine, two.id("ph")), "discard", "control: two ready resources are enough");
});

clause(ACIDIC, "0:rule", "threshold [R][R]: one [R] among many other resources is refused, two are accepted", () => {
  const one = acidicBoard({ icons: { rage: 1, greed: 5 } });
  refused(acidicAttempt(one), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("ph")), "hand");
  assert.equal(ready(one.engine), 6, "nothing was paid");
  const none = acidicBoard({ icons: { greed: 6 } });
  refused(acidicAttempt(none), "no [R]");
  const two = acidicBoard({ icons: { rage: 2, greed: 4 } });
  acidic(two);
  assert.equal(zoneOf(two.engine, two.id("ph")), "discard", "control: two [R] meet the threshold");
});

clause(ACIDIC, "0:rule", "the threshold is not spent: the [R][R] that pay for it can be the very resources that pay the cost of 2", () => {
  const g = acidicBoard({ icons: { rage: 2 } });
  assert.equal(ready(g.engine), 2);
  acidic(g);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard", "two Rage meet [R][R] and pay 2 at the same time");
});

clause(ACIDIC, "0:rule", "face-down cards provide Volition, not [R]: they do not meet the [R][R] threshold", () => {
  const g = acidicBoard({ icons: { rage: 1 }, extra: volition(4) });
  refused(acidicAttempt(g), "one [R] and four Volition");
});

clause(ACIDIC, "0:rule", "an opponent's [R] do not count toward my threshold", () => {
  const g = acidicBoard({ icons: { rage: 1, greed: 4 }, oppIcons: { rage: 4 } });
  refused(acidicAttempt(g), "only one [R] of my own");
});

clause(ACIDIC, "0:rule", "as a tactic it can be played in response on my opponent's turn", () => {
  const g = acidicBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", life: 5 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("ph"));
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(damageOf(g.engine, g.id("atk")), 1, "the attacker took 1 damage");
  assert.equal(damageOf(g.engine, g.id("m3")), 1);
});

clause(ACIDIC, "0:rule", "the damage kills a blocker before it can fight: a 1-life blocker hurt in response is gone", () => {
  const g = acidicBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("ph"));
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "my 1-life character died to the damage");
  assert.equal(zoneOf(g.engine, g.id("m3")), "play", "control: the 3-life character survived");
  refused(() => declareBlockers(g.engine, P1, [g.id("m1")]), "a destroyed character cannot block");
  declareBlockers(g.engine, P1, [g.id("m3")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("m3")], "control: the survivor can block");
});

// --- FLIP UP: 3 [R][R] and play a resource ---------------------------------------------

/** Flips Acidic Phlegm up (stops at the first pending choice). */
const flipAcidic = (g: AcidicGame, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("ph"));

/** Flips it up and plays `handCard` as the resource. */
function flipAcidicFully(g: AcidicGame, handCard: CardInstanceId = g.id("hres")): void {
  flipAcidic(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [handCard] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(ACIDIC, "1:flipUp", "a face-down Acidic Phlegm is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { rage: 2 } });
  assert.equal(g.engine.isResource(g.id("ph")), true);
  assert.equal(ready(g.engine), 3, "two Rage plus the face-down Acidic Phlegm");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(ACIDIC, "1:flipUp", "flipping it up resolves it as the tactic: every character takes 1 damage and it ends in my discard pile", () => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidicFully(g);
  assert.equal(damageOf(g.engine, g.id("m3")), 1);
  assert.equal(damageOf(g.engine, g.id("f3")), 1);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard", "a flipped-up tactic goes to its owner's discard pile once resolved");
  assert.equal(g.engine.state.cards[g.id("ph")].faceDown, false);
});

clause(ACIDIC, "1:flipUp", "FLIP UP costs 3 (not the card's cost number of 2): with exactly three ready resources, itself included, it works", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { rage: 2 } });
  assert.equal(ready(g.engine), 3);
  flipAcidicFully(g);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(damageOf(g.engine, g.id("m3")), 1);
});

clause(ACIDIC, "1:flipUp", "FLIP UP costs 3: two ready resources (itself included) are refused and nothing changes", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { rage: 1 }, extra: spentRage(3) });
  assert.equal(ready(g.engine), 2);
  refused(() => flipAcidic(g), "two ready resources for a Flip Up cost of 3");
  assert.equal(g.engine.state.cards[g.id("ph")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine), 2, "nothing was paid");
  assert.equal(damageOf(g.engine, g.id("m3")), 0);
});

clause(ACIDIC, "1:flipUp", "FLIP UP pays 3 and no more: with many resources at most three end up spent", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { rage: 8 } });
  flipAcidicFully(g);
  const spent = attachedCount(g.engine, P1);
  assert.ok(spent <= 3, `at most three resources were spent, got ${spent}`);
  assert.ok(spent >= 2, "at least the two payments that were not the Phlegm itself");
});

clause(ACIDIC, "1:flipUp", "FLIP UP needs [R][R]: one [R] among many other resources is refused (still face-down, nothing paid), two are accepted", () => {
  const one = acidicBoard({ ph: "faceDown", icons: { rage: 1, greed: 6 } });
  refused(() => flipAcidic(one), "one [R]");
  assert.equal(one.engine.state.cards[one.id("ph")].faceDown, true);
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = acidicBoard({ ph: "faceDown", icons: { greed: 6 } });
  refused(() => flipAcidic(none), "no [R]");
  const two = acidicBoard({ ph: "faceDown", icons: { rage: 2, greed: 2 } });
  flipAcidicFully(two);
  assert.equal(two.engine.state.cards[two.id("ph")].faceDown, false, "control: two [R] is enough");
});

clause(ACIDIC, "1:flipUp", "the card's own Volition does not provide an [R], and the opponent's [R] do not count", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { greed: 5 }, oppIcons: { rage: 4 } });
  refused(() => flipAcidic(g), "no [R] of mine");
  assert.equal(g.engine.state.cards[g.id("ph")].faceDown, true);
});

clause(ACIDIC, "1:flipUp", "'play a resource': a resource card from my hand enters play face-up and provides its icon", () => {
  const g = acidicBoard({ ph: "faceDown" });
  const rageBefore = g.engine.getThresholds(P1).rage ?? 0;
  flipAcidicFully(g, g.id("hres"));
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(g.engine.state.cards[g.id("hres")].faceDown, false, "an actual resource card is played face-up");
  assert.ok(playOf(g.engine, P1).includes(g.id("hres")), "playOf(g.engine, P1).includes(g.id(\"hres\"))");
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, rageBefore + 1, "it provides its [R] icon");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand", "the other hand card stays in hand");
});

clause(ACIDIC, "1:flipUp", "'play a resource': a card that is not a resource enters play face-down and provides Volition", () => {
  const g = acidicBoard({ ph: "faceDown" });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  flipAcidicFully(g, g.id("hchar"));
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play");
  assert.equal(g.engine.state.cards[g.id("hchar")].faceDown, true, "a non-resource can only be played face-down");
  assert.equal(g.engine.isResource(g.id("hchar")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore - 1 + 1, "the Phlegm's own Volition left, the new face-down card's arrived");
});

clause(ACIDIC, "1:flipUp", "'play a resource' plays exactly one card: the rest of my hand stays in my hand", () => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidicFully(g, g.id("hres"));
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand");
  assert.deepEqual(handOf(g.engine, P1).sort(), [g.id("hchar")].sort(), "only the other card remains in my hand");
});

clause(ACIDIC, "1:flipUp", "'play a resource' only offers cards from MY hand: a card in my opponent's hand, in play or in my discard pile is refused", () => {
  const g = acidicBoard({ ph: "faceDown", extra: [{ key: "mydisc", def: resourceCard({ name: "Discarded Resource" }), owner: P1, zone: "discard" }] });
  flipAcidic(g);
  expectPending(g.engine, "chooserSelectsTarget");
  for (const key of ["p2hand", "m3", "f3", "mydisc"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), `${key} cannot be played as my resource`);
    assert.ok(pending(g.engine), `the demand to play a resource is still standing after refusing ${key}`);
  }
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "control: a hand card works");
});

clause(ACIDIC, "1:flipUp", "'play a resource' plays ONE resource: two cards at once are refused", () => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidic(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres"), g.id("hchar")] }), "two resources");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand");
});

clause(ACIDIC, "1:flipUp", "'and play a resource' is not a 'may': the player cannot decline to play one when they have cards in hand", () => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidic(g);
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to play a resource");
  assert.ok(pending(g.engine), "the demand to play a resource is still standing");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(ACIDIC, "1:flipUp", "'and play a resource' is part of the Flip Up cost, so FLIP UP with no card in my hand to play is refused", () => {
  const g = acidicBoard({ ph: "faceDown", hand: false });
  assert.equal(handOf(g.engine, P1).length, 0, "control: my hand is empty");
  refused(() => flipAcidic(g), "no card to play as the resource");
  assert.equal(g.engine.state.cards[g.id("ph")].faceDown, true, "still face-down");
  assert.equal(damageOf(g.engine, g.id("m3")), 0, "nothing happened");
});

clause(ACIDIC, "1:flipUp", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidic(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(ACIDIC, "1:flipUp", "playing the resource this way does not use up my Develop Rule", () => {
  const g = acidicBoard({ ph: "faceDown" });
  flipAcidicFully(g, g.id("hres"));
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("hchar"), true);
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play", "I can still develop a resource afterwards");
});

clause(ACIDIC, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = acidicBoard({ ph: "faceDown", oppIcons: { rage: 6 } });
  refused(() => flipAcidic(theirs, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("ph")].faceDown, true);
  const inHand = acidicBoard({ ph: "hand" });
  refused(() => flipAcidic(inHand), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("ph")), "hand");
  const inDiscard = acidicBoard({ ph: "discard" });
  refused(() => flipAcidic(inDiscard), "in the discard pile it is not a face-down resource");
});

clause(ACIDIC, "1:flipUp", "a flipped-up tactic that is not face-down any more cannot be flipped again (face-up in play)", () => {
  const g = acidicBoard({ ph: "faceUp" });
  refused(() => flipAcidic(g), "a face-up card in play cannot be flipped up");
});

clause(ACIDIC, "1:flipUp", "spent [R] still meet the threshold: the [R][R] can be spent resources while three other ready resources pay the 3", () => {
  const g = acidicBoard({ ph: "faceDown", icons: { greed: 3 }, extra: spentRage(2) });
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 2, "the spent Rage still provide [R][R]");
  flipAcidicFully(g);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard");
  assert.equal(damageOf(g.engine, g.id("m3")), 1);
});

clause(ACIDIC, "1:flipUp", "FLIP UP of a tactic works in response on my opponent's turn but not outside a response window", () => {
  const g = acidicBoard({
    ph: "faceDown",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", life: 5 }), owner: P2, zone: "play" }]
  });
  refused(() => flipAcidic(g), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("ph")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipAcidic(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard", "flipped up in response to the attack");
  assert.equal(damageOf(g.engine, g.id("atk")), 1);
});

clause(ACIDIC, "1:flipUp", "a face-down Acidic Phlegm that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = acidicBoard({ ph: "faceDown", phSpent: true });
  flipAcidicFully(g);
  assert.equal(zoneOf(g.engine, g.id("ph")), "discard", "flipped up and resolved");
  assert.equal(damageOf(g.engine, g.id("m3")), 1);
});

clause(ACIDIC, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = acidicBoard({ ph: "faceDown", extra: [{ key: "mover", def: moverTactic("discard"), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipAcidic(g));
  // the Flip Up extra cost (play a resource) is paid first: the pick is asked before the flip, and answering it flips the card
  if (pending(g.engine)) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("hres")] } } as never);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(damageOf(g.engine, g.id("m3")), 0, "the effect has not happened yet");
});


// =================================================================================
// Aroused Stiffbone
// COST: Pay X, where X is 7 minus the number of [R] you control.
// Character (dragon), cost 0, [R], 4 strength / 3 speed / 4 life.
// =================================================================================

const STIFFBONE = "3423878b-36d4-43e7-a0b1-9818a91d5c2c";
const CADET = "569e946d-73c2-4bd6-a33a-43798c5740bd";

function stiffBoard(
  opts: {
    rage?: number;
    spent?: number;
    greed?: number;
    deception?: number;
    oppRage?: number;
    faceDown?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "sb", def: printing(STIFFBONE), owner: P1, zone: "hand" },
      ...res({ rage: opts.rage ?? 0, greed: opts.greed ?? 0, deception: opts.deception ?? 0 }),
      ...spentRage(opts.spent ?? 0),
      ...res({ rage: opts.oppRage ?? 0 }, P2),
      ...volition(opts.faceDown ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type StiffGame = ReturnType<typeof stiffBoard>;
const stiff = (g: StiffGame) => play(g.engine, P1, g.id("sb"));
const stiffAttempt = (g: StiffGame) => () => playRaw(g.engine, P1, g.id("sb"));

/** Plays the Stiffbone and returns how many resources it cost. */
function stiffCost(g: StiffGame): number {
  const before = ready(g.engine);
  stiff(g);
  assert.equal(zoneOf(g.engine, g.id("sb")), "play", "the Stiffbone was deployed");
  return before - ready(g.engine);
}

const costWithRage = (n: number) => () => {
  const g = stiffBoard({ rage: n, greed: 10 });
  assert.equal(stiffCost(g), Math.max(0, 7 - n), `with ${n} [R] the cost is 7 - ${n}`);
};

clause(STIFFBONE, "0:ability", "with 1 [R] (the minimum for its threshold) X = 6: six resources are paid", costWithRage(1));
clause(STIFFBONE, "0:ability", "with 2 [R] X = 5: five resources are paid", costWithRage(2));
clause(STIFFBONE, "0:ability", "with 3 [R] X = 4: four resources are paid", costWithRage(3));
clause(STIFFBONE, "0:ability", "with 4 [R] X = 3: three resources are paid", costWithRage(4));
clause(STIFFBONE, "0:ability", "with 5 [R] X = 2: two resources are paid", costWithRage(5));
clause(STIFFBONE, "0:ability", "with 6 [R] X = 1: one resource is paid", costWithRage(6));
clause(STIFFBONE, "0:ability", "with 7 [R] X = 0: it costs nothing", costWithRage(7));

clause(STIFFBONE, "0:ability", "with more than 7 [R] the cost stays 0: it never goes negative and nothing is refunded (CR 406.6, 410.4)", () => {
  for (const n of [8, 9, 12]) {
    const g = stiffBoard({ rage: n });
    assert.equal(stiffCost(g), 0, `with ${n} [R] it is free`);
    assert.equal(attachedCount(g.engine, P1), 0, "no resource was spent");
  }
});

clause(STIFFBONE, "0:ability", "the cost is paid when it is played, before the opponent can respond (6 resources with 1 [R])", () => {
  const g = stiffBoard({ rage: 1, greed: 9 });
  const before = ready(g.engine);
  stiffAttempt(g)();
  assert.equal(before - ready(g.engine), 6, "six resources were paid at once");
  assert.equal(g.engine.state.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("sb")), "deploying", "it has not resolved yet");
});

clause(STIFFBONE, "0:ability", "exactly X ready resources are enough: with 1 [R] and 5 other resources (6 ready) it is deployed", () => {
  const g = stiffBoard({ rage: 1, greed: 5 });
  assert.equal(ready(g.engine), 6);
  stiff(g);
  assert.equal(zoneOf(g.engine, g.id("sb")), "play");
  assert.equal(ready(g.engine), 0, "all six were paid");
});

clause(STIFFBONE, "0:ability", "one resource short is refused and nothing is paid: with 1 [R] and 4 other resources (5 ready) X = 6 cannot be paid", () => {
  const g = stiffBoard({ rage: 1, greed: 4 });
  assert.equal(ready(g.engine), 5);
  refused(stiffAttempt(g), "five ready resources for X = 6");
  assert.equal(zoneOf(g.engine, g.id("sb")), "hand", "still in hand");
  assert.equal(ready(g.engine), 5, "nothing was paid");
});

clause(STIFFBONE, "0:ability", "one resource short at X = 3: with 4 [R] and no other resource (4 ready) it is deployed, with 2 [R] and 2 spent ones the cost 3 cannot be paid", () => {
  const ok = stiffBoard({ rage: 4 });
  assert.equal(stiffCost(ok), 3);
  const short = stiffBoard({ rage: 2, spent: 2 });
  assert.equal(ready(short.engine), 2);
  refused(stiffAttempt(short), "X = 3 with two ready resources");
  assert.equal(zoneOf(short.engine, short.id("sb")), "hand");
});

clause(STIFFBONE, "0:ability", "[R] that are already spent (attached to my faction) are still [R] I control: they lower X but cannot pay it", () => {
  const g = stiffBoard({ spent: 3, greed: 4 });
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 3, "control: three spent Rage still provide [R]");
  assert.equal(ready(g.engine), 4);
  assert.equal(stiffCost(g), 4, "X = 7 - 3 = 4, paid with the four ready Greed");
  const short = stiffBoard({ spent: 3, greed: 3 });
  refused(stiffAttempt(short), "X = 4 with only three ready resources");
  assert.equal(zoneOf(short.engine, short.id("sb")), "hand");
});

clause(STIFFBONE, "0:ability", "only [R] lower X: Greed, Deception and Volition icons do not (1 [R] plus 4 other icons still means X = 6)", () => {
  const g = stiffBoard({ rage: 1, greed: 3, deception: 3, faceDown: 4 });
  assert.equal(stiffCost(g), 6);
});

clause(STIFFBONE, "0:ability", "my opponent's [R] do not lower X", () => {
  const g = stiffBoard({ rage: 1, greed: 9, oppRage: 6 });
  assert.equal(stiffCost(g), 6);
});

clause(STIFFBONE, "0:ability", "face-down Rage resource cards provide Volition, not [R]: they do not lower X and do not meet the threshold", () => {
  const faceDownRage = (key: string): CardPlacement => ({
    key,
    def: resourceCard({ name: `Hidden ${key}`, resource: { provides: ["rage"], staple: true } }),
    owner: P1,
    zone: "play",
    faceDown: true
  });
  const g = stiffBoard({ rage: 1, greed: 5, extra: [faceDownRage("fd1"), faceDownRage("fd2"), faceDownRage("fd3")] });
  assert.equal(stiffCost(g), 6, "three face-down Rage cards do not count as [R]");
  const none = stiffBoard({ extra: [faceDownRage("fd1"), faceDownRage("fd2"), ...volition(6)] });
  refused(stiffAttempt(none), "no face-up [R]: the threshold is not met");
});

clause(STIFFBONE, "0:ability", "a character that provides [R] counts as an [R] I control: Embittered Cadet in play lowers X by one", () => {
  const g = stiffBoard({ rage: 1, greed: 9, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 2, "control: the Cadet provides an [R]");
  assert.equal(stiffCost(g), 5, "1 Rage + 1 Cadet = 2 [R], so X = 5");
});

clause(STIFFBONE, "0:ability", "the Cadet's [R] also meets the threshold: with only a Cadet providing [R] the Stiffbone can be deployed (X = 6)", () => {
  const g = stiffBoard({ greed: 6, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "play" }] });
  assert.equal(stiffCost(g), 6);
});

clause(STIFFBONE, "0:ability", "'the number of [R]' counts icons: one resource card providing two [R] lowers X by two", () => {
  const g = stiffBoard({ greed: 9, extra: [{ key: "twin", def: iconResource(["rage", "rage"]), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 2, "control: the engine sees two [R]");
  assert.equal(stiffCost(g), 5, "7 - 2");
});

clause(STIFFBONE, "0:ability", "threshold [R]: with no [R] at all it is refused however many other resources I have; with one it is deployed", () => {
  const none = stiffBoard({ greed: 10, deception: 5 });
  refused(stiffAttempt(none), "no [R]");
  assert.equal(zoneOf(none.engine, none.id("sb")), "hand");
  assert.equal(ready(none.engine), 15, "nothing was paid");
  const one = stiffBoard({ rage: 1, greed: 6 });
  stiff(one);
  assert.equal(zoneOf(one.engine, one.id("sb")), "play", "control: one [R] meets the threshold");
});

clause(STIFFBONE, "0:ability", "it is deployed with its printed stats: 4 strength, 3 speed, 4 life, a dragon", () => {
  const g = stiffBoard({ rage: 7 });
  stiff(g);
  assert.equal(g.engine.getStat(g.id("sb"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("sb"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("sb"), "life"), 4);
  assert.deepEqual(printing(STIFFBONE).subtype, ["dragon"]);
  assert.equal(g.engine.state.cards[g.id("sb")].controllerId, P1);
});

clause(STIFFBONE, "0:ability", "X is read when it is played: [R] I gain afterwards do not refund anything", () => {
  const g = stiffBoard({ rage: 1, greed: 9, extra: [{ key: "hres", def: resourceCard({ name: "Late Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }] });
  const before = ready(g.engine);
  stiff(g);
  assert.equal(before - ready(g.engine), 6, "paid 7 - 1 = 6 at play time");
  developResource(g.engine, P1, g.id("hres"), false);
  assert.equal(attachedCount(g.engine, P1), 6, "the six payments stay spent");
});

clause(STIFFBONE, "0:ability", "being a character it is deployed on my own turn only: refused on my opponent's turn even in a response window", () => {
  const g = stiffBoard({
    rage: 7,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }]
  });
  refused(stiffAttempt(g), "not my turn, no window");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(stiffAttempt(g), "a character cannot be deployed in response");
  assert.equal(zoneOf(g.engine, g.id("sb")), "hand");
});

clause(STIFFBONE, "0:ability", "'Pay X' is a numeric cost (CR 406.3, 406.5): a reduction of the next character's cost applies to it", () => {
  const reducer = tactic({
    name: "Cheaper Characters",
    cost: 0,
    behavior: { abilities: [{ id: "red", type: "activated", effects: [{ type: "reduceNextCost", player: "controller", amount: 2, cardType: "character" }] }] }
  });
  const g = stiffBoard({ rage: 1, greed: 9, extra: [{ key: "red", def: reducer, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("red"));
  assert.equal(stiffCost(g), 4, "X = 6, reduced by 2");
});


// =================================================================================
// Ascendant Madcap
// If a card that provides at least [R] enters play under your control, put a token on this card.
// This card gains 1 strength for each token on it.
// Character (soldier), cost 5, [R], 3 strength / 3 speed / 4 life.
// =================================================================================

const MADCAP = "5159bbf9-b008-42e8-a3ba-a7480ede862c";

function madcapBoard(
  opts: {
    mc?: "play" | "hand" | "faceDown" | "discard";
    mcController?: PlayerId;
    tokens?: number;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.mc ?? "play";
  return devBoard(
    [
      {
        key: "mc",
        def: printing(MADCAP),
        owner: P1,
        controller: opts.mcController,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        counters: opts.tokens ? { token: opts.tokens } : undefined
      },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "hrage", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "hgreed", def: resourceCard({ name: "Hand Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "hplain", def: character({ name: "Hand Plain Character" }), owner: P1, zone: "hand" },
      { key: "p2rage", def: resourceCard({ name: "Their Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type MadcapGame = ReturnType<typeof madcapBoard>;
const strengthOf = (g: MadcapGame, key = "mc") => g.engine.getStat(g.id(key), "strength");

clause(MADCAP, "0:rule", "a face-up Rage resource played into my resource row puts exactly one token on it", () => {
  const g = madcapBoard();
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("hrage")), "play", "control: the resource entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "a Greed resource entering play gives no token (it does not provide [R])", () => {
  const g = madcapBoard();
  developResource(g.engine, P1, g.id("hgreed"), false);
  assert.equal(zoneOf(g.engine, g.id("hgreed")), "play", "control: the resource entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a Rage card played FACE-DOWN gives no token: a face-down card provides only Volition (CR 411.1)", () => {
  const g = madcapBoard();
  developResource(g.engine, P1, g.id("hrage"), true);
  assert.equal(g.engine.state.cards[g.id("hrage")].faceDown, true, "control: it entered face-down");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "an ordinary character card played as a face-down resource gives no token", () => {
  const g = madcapBoard();
  developResource(g.engine, P1, g.id("hplain"), true);
  assert.equal(zoneOf(g.engine, g.id("hplain")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a character that provides [R] counts as 'a card that provides at least [R]': deploying an Embittered Cadet puts a token on it", () => {
  const g = madcapBoard({ icons: { rage: 3 }, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("cadet"));
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play", "control: the Cadet entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "a card put into play by an effect (not deployed) that provides [R] also counts", () => {
  const g = madcapBoard({ extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "discard" }, { key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("cadet")] } });
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play", "control: the Cadet was put into play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "a plain character (no icons) entering play gives no token", () => {
  const g = madcapBoard({ extra: [{ key: "plain", def: character({ name: "Plain Discard" }), owner: P1, zone: "discard" }, { key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("plain")] } });
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a card that provides [R] and other icons ('at least [R]') gives a token", () => {
  const g = madcapBoard({ extra: [{ key: "multi", def: iconResource(["rage", "greed"]), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("multi"), false);
  assert.equal(zoneOf(g.engine, g.id("multi")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "a card that provides two [R] still gives just one token (it is one card entering play)", () => {
  const g = madcapBoard({ extra: [{ key: "twin", def: iconResource(["rage", "rage"]), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("twin"), false);
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "a card that provides other icons only (Deception) gives no token", () => {
  const g = madcapBoard({ extra: [{ key: "decep", def: iconResource(["deception"]), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("decep"), false);
  assert.equal(zoneOf(g.engine, g.id("decep")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "each [R] card that enters play adds a token: a Rage resource and then a Cadet make two tokens", () => {
  const g = madcapBoard({ icons: { rage: 3 }, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("hrage"), false);
  play(g.engine, P1, g.id("cadet"));
  assert.equal(tokensOn(g.engine, g.id("mc")), 2);
  assert.equal(strengthOf(g), 5, "3 printed strength + 2 tokens");
});

clause(MADCAP, "0:rule", "only a card entering play under MY control counts: my opponent's Rage resource entering play gives no token", () => {
  const g = madcapBoard({ turn: 2, active: P2 });
  developResource(g.engine, P2, g.id("p2rage"), false);
  assert.equal(zoneOf(g.engine, g.id("p2rage")), "play", "control: their resource entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "only a card entering play under MY control counts: my opponent's Embittered Cadet entering play gives no token", () => {
  const g = madcapBoard({
    turn: 2,
    active: P2,
    extra: [...res({ rage: 3 }, P2), { key: "theirCadet", def: printing(CADET), owner: P2, zone: "hand" }]
  });
  play(g.engine, P2, g.id("theirCadet"));
  assert.equal(zoneOf(g.engine, g.id("theirCadet")), "play", "control: their Cadet entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a card I own that enters play under my OPPONENT's control gives no token", () => {
  const g = madcapBoard({
    extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "opponent"), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("cadet")] } });
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play", "control: the Cadet entered play");
  assert.equal(g.engine.state.cards[g.id("cadet")].controllerId, P2, "under my opponent's control");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a card my opponent owns that enters play under MY control gives a token", () => {
  const g = madcapBoard({
    extra: [{ key: "theirCadet", def: printing(CADET), owner: P2, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "opponent", "controller"), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("theirCadet")] } });
  assert.equal(zoneOf(g.engine, g.id("theirCadet")), "play", "control: the Cadet entered play");
  assert.equal(g.engine.state.cards[g.id("theirCadet")].controllerId, P1, "under my control");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "taking control of an [R] card that is already in play is not 'entering play': no token", () => {
  const g = madcapBoard({
    extra: [{ key: "theirCadet", def: printing(CADET), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("theirCadet")] } });
  assert.equal(g.engine.state.cards[g.id("theirCadet")].controllerId, P1, "control: I took control of it");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "'your' is the Madcap's controller: a Madcap I own but my opponent controls counts THEIR [R] cards and not mine", () => {
  const g = madcapBoard({ turn: 2, active: P2, mcController: P2 });
  developResource(g.engine, P2, g.id("p2rage"), false);
  assert.equal(tokensOn(g.engine, g.id("mc")), 1, "their Rage entered play under the Madcap's controller");
  const mine = madcapBoard({ mcController: P2 });
  developResource(mine.engine, P1, mine.id("hrage"), false);
  assert.equal(tokensOn(mine.engine, mine.id("mc")), 0, "my Rage did not enter play under the Madcap's controller");
});

clause(MADCAP, "0:rule", "it also works on my opponent's turn: my Cadet put into play in response gives a token", () => {
  const g = madcapBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "cadet", def: printing(CADET), owner: P1, zone: "discard" },
      { key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("pip"), { t: [g.id("cadet")] });
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
});

clause(MADCAP, "0:rule", "the Madcap itself entering play gives it no token (it provides no [R]): deployed from hand it starts with none", () => {
  const g = madcapBoard({ mc: "hand", icons: { rage: 5 } });
  play(g.engine, P1, g.id("mc"));
  assert.equal(zoneOf(g.engine, g.id("mc")), "play", "control: it was deployed");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
  assert.equal(strengthOf(g), 3);
});

clause(MADCAP, "0:rule", "while the Madcap is in my hand, an [R] card entering play puts no token on it", () => {
  const g = madcapBoard({ mc: "hand" });
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
});

clause(MADCAP, "0:rule", "while the Madcap is in my discard pile, an [R] card entering play puts no token on it", () => {
  const g = madcapBoard({ mc: "discard" });
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "a face-down Madcap is only a resource (CR 411.1): an [R] card entering play puts no token on it", () => {
  const g = madcapBoard({ mc: "faceDown" });
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(zoneOf(g.engine, g.id("hrage")), "play", "control: the Rage entered play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "tokens are not retroactive: an [R] card already in play before the Madcap arrives gives it nothing", () => {
  const g = madcapBoard({ mc: "hand", icons: { rage: 5 }, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("mc"));
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
});

clause(MADCAP, "0:rule", "the token goes on THIS card only: another Madcap and an ally get none, and two Madcaps each get a token", () => {
  const g = madcapBoard({ extra: [{ key: "mc2", def: printing(MADCAP), owner: P1, zone: "play" }, { key: "foeMc", def: printing(MADCAP), owner: P2, zone: "play" }] });
  developResource(g.engine, P1, g.id("hrage"), false);
  drain(g.engine, declineAll); // two copies of the same trigger: the controller orders them
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("mc")), 1);
  assert.equal(tokensOn(g.engine, g.id("mc2")), 1, "each Madcap I control puts a token on itself");
  assert.equal(tokensOn(g.engine, g.id("ally")), 0, "an ally gets no token");
  assert.equal(tokensOn(g.engine, g.id("foeMc")), 0, "my opponent's Madcap is not triggered by my resource");
});

clause(MADCAP, "0:rule", "tokens disappear when it leaves play (CR 409.2): a bounced and redeployed Madcap has no tokens", () => {
  const g = madcapBoard({
    tokens: 2,
    icons: { rage: 5 },
    extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }]
  });
  assert.equal(strengthOf(g), 5, "control: two tokens, 3 + 2 strength");
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("mc")] } });
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0, "the tokens disappeared when it left play");
  play(g.engine, P1, g.id("mc"));
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(tokensOn(g.engine, g.id("mc")), 0);
  assert.equal(strengthOf(g), 3);
});

// --- 1:rule: gains 1 strength for each token ---------------------------------------------

clause(MADCAP, "1:rule", "with no token it has its printed 3 strength", () => {
  const g = madcapBoard();
  assert.equal(strengthOf(g), 3);
});

clause(MADCAP, "1:rule", "with 1 token it has 4 strength", () => {
  const g = madcapBoard({ tokens: 1 });
  assert.equal(strengthOf(g), 4);
});

clause(MADCAP, "1:rule", "with 2 tokens it has 5 strength", () => {
  const g = madcapBoard({ tokens: 2 });
  assert.equal(strengthOf(g), 5);
});

clause(MADCAP, "1:rule", "with 6 tokens it has 9 strength", () => {
  const g = madcapBoard({ tokens: 6 });
  assert.equal(strengthOf(g), 9);
});

clause(MADCAP, "1:rule", "only strength changes: speed stays 3 and life stays 4 however many tokens it has", () => {
  const g = madcapBoard({ tokens: 4 });
  assert.equal(g.engine.getStat(g.id("mc"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("mc"), "life"), 4);
});

clause(MADCAP, "1:rule", "a token gained from a real [R] card raises its strength at once", () => {
  const g = madcapBoard();
  assert.equal(strengthOf(g), 3);
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(strengthOf(g), 4);
});

clause(MADCAP, "1:rule", "removing a token takes its strength away again", () => {
  const g = madcapBoard({ tokens: 3, extra: [{ key: "rmtok", def: removeTokensTactic(1), owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(g), 6);
  play(g.engine, P1, g.id("rmtok"), { selected: { t: [g.id("mc")] } });
  assert.equal(tokensOn(g.engine, g.id("mc")), 2);
  assert.equal(strengthOf(g), 5);
});

clause(MADCAP, "1:rule", "only THIS card gains the strength: an ally and another Madcap with fewer tokens are unaffected", () => {
  const g = madcapBoard({ tokens: 3, extra: [{ key: "mc2", def: printing(MADCAP), owner: P1, zone: "play", counters: { token: 1 } }] });
  assert.equal(strengthOf(g), 6);
  assert.equal(strengthOf(g, "mc2"), 4, "the second Madcap counts only its own token");
  assert.equal(strengthOf(g, "ally"), 1, "an ally is not strengthened");
  assert.equal(strengthOf(g, "foe"), 1);
});

clause(MADCAP, "1:rule", "the extra strength is real battle damage: with 2 tokens it deals 5 to the faction it attacks", () => {
  const g = madcapBoard({ tokens: 2, turn: 2 });
  const before = influenceOf(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("mc")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P2), 5);
});

clause(MADCAP, "1:rule", "a token gained in the attack's response window counts: the damage uses the strength when it is dealt", () => {
  const board = () =>
    madcapBoard({
      turn: 2,
      extra: [
        { key: "cadet", def: printing(CADET), owner: P1, zone: "discard" },
        { key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }
      ]
    });
  const plain = board();
  const before = influenceOf(plain.engine, P2);
  declareAttackBy(plain.engine, P1, [plain.id("mc")]);
  declareBlockers(plain.engine, P2, []);
  finishBattle(plain.engine);
  assert.equal(before - influenceOf(plain.engine, P2), 3, "control: no token, 3 damage");
  const g = board();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("mc")], target: { type: "faction", playerId: P2 } });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("cadet")] } });
  assert.equal(tokensOn(g.engine, g.id("mc")), 1, "the Cadet entering play gave a token");
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P2), 4, "the damage is 3 + 1 token");
});


// --- printed cost, threshold and stats ---------------------------------------------------------------------------

clause(MADCAP, "1:rule", "it deploys for 5 with [R]: five resources are paid, four are refused, and without [R] it is refused", () => {
  const ok = madcapBoard({ mc: "hand", icons: { rage: 1, greed: 4 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("mc"));
  assert.equal(zoneOf(ok.engine, ok.id("mc")), "play");
  assert.equal(before - ready(ok.engine), 5);
  const short = madcapBoard({ mc: "hand", icons: { rage: 1, greed: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("mc")), "four resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("mc")), "hand");
  assert.equal(ready(short.engine), 4, "nothing was paid");
  const noRage = madcapBoard({ mc: "hand", icons: { greed: 6 } });
  refused(() => playRaw(noRage.engine, P1, noRage.id("mc")), "no [R]");
  const down = madcapBoard({ mc: "hand", icons: { rage: 0 }, extra: volition(6) });
  refused(() => playRaw(down.engine, P1, down.id("mc")), "Volition is not [R]");
});

clause(MADCAP, "1:rule", "the threshold is a single [R]: one Rage among the five resources is enough", () => {
  const g = madcapBoard({ mc: "hand", icons: { rage: 1, greed: 4 } });
  play(g.engine, P1, g.id("mc"));
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
});

clause(MADCAP, "1:rule", "it enters play with its printed stats: 3 strength, 3 speed, 4 life, a soldier", () => {
  const g = madcapBoard({ mc: "hand", icons: { rage: 5 } });
  play(g.engine, P1, g.id("mc"));
  assert.equal(g.engine.getStat(g.id("mc"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("mc"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("mc"), "life"), 4);
  assert.deepEqual(printing(MADCAP).subtype, ["soldier"]);
});

// =================================================================================
// Athalamund Mangod, The Iron Fist
// UNIQUE ATHALAMUND
// PUNCH -- COST: Pay 1. Deplete this card. Pick a character. X is its strength. Y is
// twice this card's strength. -- EFFECT: Inflict X damage to this card. Inflict Y damage
// to the character.
// Character (athalamund, sword of great justice), cost 3, [R][R][R], 3 strength / 3 speed / 3 life.
// =================================================================================

const ATHA = "7d27517d-2354-46ca-80a0-3ec605d43b7d";
const ATHA_SAGA = "73abc272-2225-4422-9ff4-d3f55ddac8ef";

function athaBoard(
  opts: {
    at?: "play" | "hand" | "faceDown";
    atDepleted?: boolean;
    atEligible?: boolean;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.at ?? "play";
  return devBoard(
    [
      {
        key: "at",
        def: printing(ATHA),
        owner: P1,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        depleted: opts.atDepleted,
        attackEligible: opts.atEligible
      },
      { key: "v0", def: character({ name: "Victim S0", strength: 0, life: 20 }), owner: P2, zone: "play" },
      { key: "v2", def: character({ name: "Victim S2", strength: 2, life: 20 }), owner: P2, zone: "play" },
      { key: "v3", def: character({ name: "Victim S3", strength: 3, life: 20 }), owner: P2, zone: "play" },
      { key: "v5", def: character({ name: "Victim S5", strength: 5, life: 20 }), owner: P2, zone: "play" },
      { key: "vLow", def: character({ name: "Victim Low Life", strength: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally S4", strength: 4, life: 20 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { rage: 4 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type AthaGame = ReturnType<typeof athaBoard>;

/** PUNCH on `victim` (drains the response window). */
const punch = (g: AthaGame, victim: string) => activate(g.engine, P1, g.id("at"), "punch", { selected: { victim: [g.id(victim)] } });
const punchRaw = (g: AthaGame, victim: string, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("at"), "punch", { victim: [g.id(victim)] });

// --- 0:unique ------------------------------------------------------------------------------

function athaUniqueBoard(opts: { second?: "hand" | "play"; first?: "play" | "faceDown" } = {}) {
  return devBoard([
    { key: "at", def: printing(ATHA), owner: P1, zone: "play", faceDown: opts.first === "faceDown" ? true : undefined },
    { key: "at2", def: printing(ATHA), owner: P1, zone: opts.second ?? "hand" },
    { key: "atSaga", def: printing(ATHA_SAGA), owner: P1, zone: "hand" },
    ...res({ rage: 8 })
  ]);
}

clause(ATHA, "0:unique", "a second Athalamund: I choose which to keep (the controller chooses), and choosing the new one destroys the old one", () => {
  const g = athaUniqueBoard();
  play(g.engine, P1, g.id("at2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("at"), g.id("at2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("at2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("at2")), "play");
  assert.equal(zoneOf(g.engine, g.id("at")), "discard", "the other copy is destroyed");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ATHA, "0:unique", "choosing the old Athalamund keeps it and destroys the new one", () => {
  const g = athaUniqueBoard();
  play(g.engine, P1, g.id("at2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("at") } } as never);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  assert.equal(zoneOf(g.engine, g.id("at2")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ATHA, "0:unique", "after the choice the game goes on: I can still act (end my turn) and nothing is left pending", () => {
  const g = athaUniqueBoard();
  play(g.engine, P1, g.id("at2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("at2") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "the turn passed to my opponent");
});

clause(ATHA, "0:unique", "the choice must name one of the copies: a bystander is refused and the choice stays open", () => {
  const g = devBoard([
    { key: "at", def: printing(ATHA), owner: P1, zone: "play" },
    { key: "at2", def: printing(ATHA), owner: P1, zone: "hand" },
    { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ rage: 8 })
  ]);
  play(g.engine, P1, g.id("at2"));
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("bystander") } } as never),
    "keeping a card that is not an Athalamund"
  );
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play");
  assert.ok(pending(g.engine), "still waiting for a real answer");
});

clause(ATHA, "0:unique", "UNIQUE is per player: my opponent may control their own Athalamund with no choice and no destruction", () => {
  const g = devBoard(
    [
      { key: "at", def: printing(ATHA), owner: P1, zone: "play" },
      { key: "at2", def: printing(ATHA), owner: P2, zone: "hand" },
      ...res({ rage: 8 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(g.engine, P2, g.id("at2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  assert.equal(zoneOf(g.engine, g.id("at2")), "play");
});

clause(ATHA, "0:unique", "taking control of my opponent's Athalamund while I have my own is a duplicate: I must keep one", () => {
  const g = devBoard([
    { key: "at", def: printing(ATHA), owner: P1, zone: "play" },
    { key: "theirs", def: printing(ATHA), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("theirs")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("at"), g.id("theirs")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("at") } } as never);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard", "the stolen copy is destroyed");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirs")), "it goes to its owner's discard pile");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ATHA, "0:unique", "the Seed Saga printing carries the same UNIQUE ATHALAMUND designation: playing it next to the Seed 2 printing is a duplicate", () => {
  const g = athaUniqueBoard();
  play(g.engine, P1, g.id("atSaga"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("at"), g.id("atSaga")].sort());
});

clause(ATHA, "0:unique", "a copy in my hand, my discard pile or my deck is not 'in play': no conflict", () => {
  const g = devBoard([
    { key: "at", def: printing(ATHA), owner: P1, zone: "play" },
    { key: "h", def: printing(ATHA), owner: P1, zone: "hand" },
    { key: "d", def: printing(ATHA), owner: P1, zone: "discard" },
    { key: "k", def: printing(ATHA), owner: P1, zone: "deck" }
  ]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
});

clause(ATHA, "0:unique", "a different UNIQUE designation is not a duplicate (Padamose next to Athalamund)", () => {
  const g = devBoard([
    { key: "at", def: printing(ATHA), owner: P1, zone: "play" },
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "hand" },
    ...res({ rage: 8 })
  ]);
  play(g.engine, P1, g.id("pad"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
});

clause(ATHA, "0:unique", "a face-down Athalamund is only a resource (CR 411.1): it does not conflict with a face-up one", () => {
  const g = athaUniqueBoard({ first: "faceDown", second: "play" });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  assert.equal(zoneOf(g.engine, g.id("at2")), "play");
});

// --- 1:ability:punch ---------------------------------------------------------------------------

clause(ATHA, "1:ability:punch", "victim with 2 strength: X = 2 damage to Athalamund, Y = 6 (twice its 3 strength) damage to the victim", () => {
  const g = athaBoard();
  punch(g, "v2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("at")), 2, "X = the victim's strength");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "Y = twice Athalamund's strength");
});

clause(ATHA, "1:ability:punch", "victim with 0 strength: X = 0 so Athalamund takes nothing, and the victim still takes Y = 6", () => {
  const g = athaBoard();
  punch(g, "v0");
  assert.equal(damageOf(g.engine, g.id("at")), 0);
  assert.equal(damageOf(g.engine, g.id("v0")), 6);
});

clause(ATHA, "1:ability:punch", "victim with 3 strength: X = 3 destroys Athalamund (3 life) and the victim still takes Y = 6", () => {
  const g = athaBoard();
  punch(g, "v3");
  assert.equal(zoneOf(g.engine, g.id("at")), "discard", "3 damage on a 3-life Athalamund destroys it");
  assert.equal(damageOf(g.engine, g.id("v3")), 6, "the second instruction still happens");
  assert.equal(zoneOf(g.engine, g.id("v3")), "play");
});

clause(ATHA, "1:ability:punch", "victim with 5 strength: X = 5, Athalamund is destroyed; the victim takes Y = 6", () => {
  const g = athaBoard();
  punch(g, "v5");
  assert.equal(zoneOf(g.engine, g.id("at")), "discard");
  assert.equal(damageOf(g.engine, g.id("v5")), 6);
});

clause(ATHA, "1:ability:punch", "Y is twice THIS card's strength, not the victim's: a 1-strength victim still takes 6", () => {
  const g = athaBoard();
  punch(g, "vLow");
  assert.equal(damageOf(g.engine, g.id("at")), 1, "X = 1");
  assert.equal(zoneOf(g.engine, g.id("vLow")), "discard", "6 damage destroys the 6-life victim");
});

clause(ATHA, "1:ability:punch", "a victim whose life is at most Y is destroyed and goes to its owner's discard pile", () => {
  const g = athaBoard();
  punch(g, "vLow");
  assert.ok(discardOf(g.engine, P2).includes(g.id("vLow")), "discardOf(g.engine, P2).includes(g.id(\"vLow\"))");
});

clause(ATHA, "1:ability:punch", "Y uses Athalamund's CURRENT strength: with a +1 strength gear attached Y = 8", () => {
  const g = athaBoard({ extra: [{ key: "gear", def: strengthGear(1), owner: P1, zone: "play", attachedToKey: "at" }] });
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 4, "control: the gear works");
  punch(g, "v2");
  assert.equal(damageOf(g.engine, g.id("v2")), 8, "twice 4");
  assert.equal(damageOf(g.engine, g.id("at")), 2);
});

clause(ATHA, "1:ability:punch", "Y uses Athalamund's CURRENT strength: with a -1 strength gear attached Y = 4", () => {
  const g = athaBoard({ extra: [{ key: "gear", def: strengthGear(-1, "Heavy Chain"), owner: P1, zone: "play", attachedToKey: "at" }] });
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 2);
  punch(g, "v2");
  assert.equal(damageOf(g.engine, g.id("v2")), 4, "twice 2");
});

clause(ATHA, "1:ability:punch", "X uses the victim's CURRENT strength: a 1-strength victim with a +1 strength gear gives X = 2", () => {
  const g = athaBoard({
    extra: [
      { key: "geared", def: character({ name: "Geared", strength: 1, life: 20 }), owner: P2, zone: "play" },
      { key: "gear", def: strengthGear(1), owner: P2, zone: "play", attachedToKey: "geared" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("geared"), "strength"), 2, "control");
  punch(g, "geared");
  assert.equal(damageOf(g.engine, g.id("at")), 2);
});

clause(ATHA, "1:ability:punch", "the cost is paid when PUNCH is used: one resource is spent and Athalamund is depleted before the opponent can respond", () => {
  const g = athaBoard();
  const before = ready(g.engine);
  punchRaw(g, "v2")();
  assert.equal(before - ready(g.engine), 1, "Pay 1");
  assert.equal(g.engine.state.cards[g.id("at")].depleted, true, "Deplete this card");
  assert.equal(damageOf(g.engine, g.id("v2")), 0, "the effect has not happened yet");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
});

clause(ATHA, "1:ability:punch", "pays 1 and no more, and the resolved ability leaves Athalamund depleted", () => {
  const g = athaBoard({ icons: { rage: 4 } });
  punch(g, "v0");
  assert.equal(ready(g.engine), 3);
  assert.equal(attachedCount(g.engine, P1), 1);
  assert.equal(g.engine.state.cards[g.id("at")].depleted, true);
});

clause(ATHA, "1:ability:punch", "with no ready resource PUNCH is refused and nothing happens; with one it works", () => {
  const none = athaBoard({ icons: {} });
  refused(punchRaw(none, "v2"), "Pay 1 with no resources");
  assert.equal(none.engine.state.cards[none.id("at")].depleted, false, "not depleted");
  assert.equal(damageOf(none.engine, none.id("v2")), 0);
  const spent = athaBoard({ icons: {}, extra: spentRage(3) });
  assert.equal(ready(spent.engine), 0);
  refused(punchRaw(spent, "v2"), "only spent resources");
  const one = athaBoard({ icons: { rage: 1 } });
  punch(one, "v2");
  assert.equal(damageOf(one.engine, one.id("v2")), 6, "control: one ready resource is enough");
});

clause(ATHA, "1:ability:punch", "a depleted Athalamund cannot PUNCH (and a restored one can)", () => {
  const tired = athaBoard({ atDepleted: true });
  refused(punchRaw(tired, "v2"), "Athalamund is already depleted");
  assert.equal(ready(tired.engine), 4, "nothing was paid");
  assert.equal(damageOf(tired.engine, tired.id("v2")), 0);
  const fresh = athaBoard();
  punch(fresh, "v2");
  assert.equal(damageOf(fresh.engine, fresh.id("v2")), 6, "control: a ready Athalamund works");
});

clause(ATHA, "1:ability:punch", "it can only PUNCH once per restore: after PUNCH it is depleted and a second PUNCH is refused", () => {
  const g = athaBoard();
  punch(g, "v0");
  refused(punchRaw(g, "v2"), "already depleted by the first PUNCH");
  assert.equal(damageOf(g.engine, g.id("v2")), 0);
  assert.equal(damageOf(g.engine, g.id("v0")), 6);
});

clause(ATHA, "1:ability:punch", "Pick a character: my own characters can be picked too (X = my ally's 4 strength)", () => {
  const g = athaBoard();
  punch(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("at")), "discard", "X = the ally's 4 strength destroys the 3-life Athalamund");
  assert.equal(damageOf(g.engine, g.id("ally")), 6);
  const g2 = athaBoard({ extra: [{ key: "weakAlly", def: character({ name: "Weak Ally", strength: 2, life: 20 }), owner: P1, zone: "play" }] });
  punch(g2, "weakAlly");
  assert.equal(damageOf(g2.engine, g2.id("at")), 2, "X = my weak ally's 2 strength");
  assert.equal(damageOf(g2.engine, g2.id("weakAlly")), 6);
});

clause(ATHA, "1:ability:punch", "Pick a character: Athalamund is a character, so it can pick itself (X = 3 and Y = 6 both land on it)", () => {
  const g = athaBoard();
  punchRaw(g, "at")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("at")), "discard", "3 + 6 damage destroys it");
});

clause(ATHA, "1:ability:punch", "only a CHARACTER can be picked: an item, a location, a face-up resource, a face-down card, a faction and cards outside play are refused", () => {
  const g = athaBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing", strength: 2 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "fdc", def: character({ name: "Hidden Character", strength: 2, life: 20 }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "Hand Character", strength: 2 }), owner: P2, zone: "hand" },
      { key: "discChar", def: character({ name: "Discard Character", strength: 2 }), owner: P2, zone: "discard" },
      { key: "deckChar", def: character({ name: "Deck Character", strength: 2 }), owner: P2, zone: "deck" }
    ]
  });
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && cid !== g.id("fdc"))!;
  const pickAttempts: Array<[string, CardInstanceId]> = [
    ["item", g.id("thing")],
    ["location", g.id("place")],
    ["face-down card", g.id("fdc")],
    ["card in hand", g.id("handChar")],
    ["card in the discard pile", g.id("discChar")],
    ["card in the deck", g.id("deckChar")],
    ["face-up resource", resource],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ];
  for (const [what, cid] of pickAttempts) {
    refused(() => actRaw(g.engine, P1, g.id("at"), "punch", { victim: [cid] }), `${what} is not a character in play`);
  }
  assert.equal(g.engine.state.cards[g.id("at")].depleted, false, "every refusal left Athalamund untouched");
  assert.equal(ready(g.engine), 4, "nothing was paid");
  punch(g, "v2");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "control: a real character works");
});

clause(ATHA, "1:ability:punch", "exactly one character is picked: none or two are refused", () => {
  const g = athaBoard();
  refused(() => actRaw(g.engine, P1, g.id("at"), "punch", {}), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("at"), "punch", { victim: [g.id("v2"), g.id("v3")] }), "two picks");
  assert.equal(g.engine.state.cards[g.id("at")].depleted, false);
  assert.equal(ready(g.engine), 4);
  punch(g, "v2");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "control");
});

clause(ATHA, "1:ability:punch", "abilities can be used the turn the character enters play (CR 204.3a): a just-deployed Athalamund can PUNCH", () => {
  const g = athaBoard({ at: "hand", icons: { rage: 5 } });
  play(g.engine, P1, g.id("at"));
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
  punch(g, "v2");
  assert.equal(damageOf(g.engine, g.id("v2")), 6);
});

clause(ATHA, "1:ability:punch", "a face-down Athalamund is only a resource: it has no PUNCH", () => {
  const g = athaBoard({ at: "faceDown" });
  refused(punchRaw(g, "v2"), "PUNCH on a face-down card");
  assert.equal(damageOf(g.engine, g.id("v2")), 0);
});

clause(ATHA, "1:ability:punch", "only its controller can use PUNCH: my opponent cannot", () => {
  const g = athaBoard({ turn: 2, active: P2, oppIcons: { rage: 3 } });
  refused(punchRaw(g, "ally", P2), "my opponent using my ability");
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
});

clause(ATHA, "1:ability:punch", "it can be used in response on my opponent's turn (an ability can be used whenever I could respond)", () => {
  const g = athaBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 20 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("at"), "punch", { victim: [g.id("atk")] });
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk")), 6, "Y");
  assert.equal(damageOf(g.engine, g.id("at")), 2, "X");
});

clause(ATHA, "1:ability:punch", "X is locked in by the cost: a response that raises the victim's strength does not change the damage Athalamund takes", () => {
  const g = athaBoard({ extra: [{ key: "pump", def: pumpTactic(1), owner: P2, zone: "hand" }] });
  punchRaw(g, "vLow")();
  respondWith(g.engine, P2, g.id("pump"), { t: [g.id("vLow")] });
  assert.equal(zoneOf(g.engine, g.id("at")), "play", "X was 1 when the cost was paid, so Athalamund survives");
  assert.equal(damageOf(g.engine, g.id("at")), 1, "X was 1 when the cost was paid");
  assert.equal(zoneOf(g.engine, g.id("vLow")), "discard", "control: the victim took Y = 6 and died");
});

clause(ATHA, "1:ability:punch", "Y is locked in by the cost: a response that raises Athalamund's strength does not change the damage dealt to the victim", () => {
  const g = athaBoard({ extra: [{ key: "pump", def: pumpTactic(2), owner: P2, zone: "hand" }] });
  punchRaw(g, "v2")();
  respondWith(g.engine, P2, g.id("pump"), { t: [g.id("at")] });
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 5, "control: the response pumped Athalamund");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "Y was twice 3 when the cost was paid");
});

clause(ATHA, "1:ability:punch", "X and Y are locked in by the cost: lowering both strengths in response changes neither amount", () => {
  const shrinkBoth = tactic({
    name: "Shrink Both",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "shrink",
          type: "activated",
          targets: [
            { id: "ta", selector: { zone: "play", type: "character" }, count: 1 },
            { id: "tb", selector: { zone: "play", type: "character" }, count: 1 }
          ],
          effects: [
            { type: "createModifier", target: { type: "selected", id: "ta" }, stat: "strength", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } },
            { type: "createModifier", target: { type: "selected", id: "tb" }, stat: "strength", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }
          ]
        }
      ]
    }
  });
  const g = athaBoard({ extra: [{ key: "shrink", def: shrinkBoth, owner: P2, zone: "hand" }] });
  punchRaw(g, "v2")();
  respondWith(g.engine, P2, g.id("shrink"), { ta: [g.id("v2")], tb: [g.id("at")] });
  assert.equal(g.engine.getStat(g.id("v2"), "strength"), 1, "control: the response shrank the victim");
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 2, "control: and Athalamund");
  assert.equal(damageOf(g.engine, g.id("at")), 2, "X was 2 when the cost was paid");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "Y was twice 3 when the cost was paid");
});

clause(ATHA, "1:ability:punch", "if the victim leaves play in response, Athalamund still takes X (an instruction that can be carried out is carried out, CR 402.5)", () => {
  const g = athaBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  punchRaw(g, "v2")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("v2")] });
  assert.equal(zoneOf(g.engine, g.id("v2")), "removed", "control: the victim left play");
  assert.equal(damageOf(g.engine, g.id("at")), 2, "X damage to this card still happens");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ATHA, "1:ability:punch", "if the victim leaves play in response, Athalamund takes X as it was when the cost was paid (a geared 3-strength victim: X = 3)", () => {
  const g = athaBoard({
    extra: [
      { key: "geared", def: character({ name: "Geared", strength: 1, life: 20 }), owner: P2, zone: "play" },
      { key: "gear", def: strengthGear(2), owner: P2, zone: "play", attachedToKey: "geared" },
      // Athalamund has 3 life, so 3 damage would destroy it (and a destroyed card keeps no damage): give it room to show X = 3.
      { key: "lifeGear", def: item({ name: "Life Gear", attachTo: "character", behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 5 }] }] } }), owner: P1, zone: "play", attachedToKey: "at" },
      { key: "rm", def: removerTactic(), owner: P2, zone: "hand" }
    ]
  });
  punchRaw(g, "geared")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("geared")] });
  assert.equal(zoneOf(g.engine, g.id("geared")), "removed", "control: the victim left play");
  assert.equal(damageOf(g.engine, g.id("at")), 3, "X was 1 + 2 when the cost was paid");
});

clause(ATHA, "1:ability:punch", "if Athalamund leaves play in response, the victim still takes Y (the ability resolves as paid even if its source has left, CR 502.4)", () => {
  const g = athaBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  punchRaw(g, "v2")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("at")] });
  assert.equal(zoneOf(g.engine, g.id("at")), "removed", "control: Athalamund left play");
  assert.equal(damageOf(g.engine, g.id("v2")), 6, "Y damage still happens");
});

clause(ATHA, "1:ability:punch", "if Athalamund leaves play in response, Y is still twice the strength it had when the cost was paid (a geared 4-strength Athalamund: Y = 8)", () => {
  const g = athaBoard({
    extra: [{ key: "gear", def: strengthGear(1), owner: P1, zone: "play", attachedToKey: "at" }, { key: "rm", def: removerTactic(), owner: P2, zone: "hand" }]
  });
  punchRaw(g, "v2")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("at")] });
  assert.equal(zoneOf(g.engine, g.id("at")), "removed", "control: Athalamund left play");
  assert.equal(damageOf(g.engine, g.id("v2")), 8, "Y was twice 4 when the cost was paid");
});

clause(ATHA, "1:ability:punch", "the damage is dealt to the picked character only: other characters are untouched", () => {
  const g = athaBoard();
  punch(g, "v2");
  for (const key of ["v0", "v3", "v5", "vLow", "ally"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} is untouched`);
});

clause(ATHA, "1:ability:punch", "the Seed Saga printing carries the same rules text: PUNCH works the same way", () => {
  const g = devBoard([
    { key: "at", def: printing(ATHA_SAGA), owner: P1, zone: "play" },
    { key: "v2", def: character({ name: "Victim S2", strength: 2, life: 20 }), owner: P2, zone: "play" },
    ...res({ rage: 2 })
  ]);
  activate(g.engine, P1, g.id("at"), "punch", { selected: { victim: [g.id("v2")] } });
  assert.equal(damageOf(g.engine, g.id("at")), 2);
  assert.equal(damageOf(g.engine, g.id("v2")), 6);
});


// --- printed cost, threshold and stats ---------------------------------------------------------------------------

clause(ATHA, "1:ability:punch", "it deploys for 3 with [R][R][R]: three resources are paid; two Rage, or three resources with only two [R], are refused", () => {
  const ok = athaBoard({ at: "hand", icons: { rage: 3 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("at"));
  assert.equal(zoneOf(ok.engine, ok.id("at")), "play");
  assert.equal(before - ready(ok.engine), 3);
  const twoR = athaBoard({ at: "hand", icons: { rage: 2, greed: 4 } });
  refused(() => playRaw(twoR.engine, P1, twoR.id("at")), "two [R] for [R][R][R]");
  assert.equal(zoneOf(twoR.engine, twoR.id("at")), "hand");
  const short = athaBoard({ at: "hand", icons: { rage: 2 }, extra: spentRage(1) });
  assert.equal(short.engine.getThresholds(P1).rage ?? 0, 3);
  refused(() => playRaw(short.engine, P1, short.id("at")), "[R][R][R] met but only two ready resources for a cost of 3");
  const down = athaBoard({ at: "hand", icons: { rage: 2 }, extra: volition(4) });
  refused(() => playRaw(down.engine, P1, down.id("at")), "Volition is not [R]");
});

clause(ATHA, "1:ability:punch", "it enters play with its printed stats: 3 strength, 3 speed, 3 life; a faster character strikes first", () => {
  const g = athaBoard({ at: "hand", icons: { rage: 3 } });
  play(g.engine, P1, g.id("at"));
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("at"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("at"), "life"), 3);
  assert.deepEqual(printing(ATHA).subtype, ["athalamund", "sword of great justice"]);
});

clause(ATHA, "1:ability:punch", "speed 3 matters in battle: blocking a 2-speed 3-strength attacker, Athalamund strikes first and kills it before it can strike back", () => {
  const g = athaBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Slower Attacker", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("at")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "Athalamund (speed 3, 3 strength) kills the speed-2 attacker first");
  assert.equal(zoneOf(g.engine, g.id("at")), "play", "...so the attacker never strikes back");
});

// =================================================================================
// Barrier of Benevolence
// COST: Choose a number for X. Pay X+X. Pick 2 or fewer characters.
// EFFECT: This turn, the characters gain X strength and X life.
// Tactic, cost 0, [R][R].
// =================================================================================

const BARRIER = "bc75cfe1-2ee1-4eb5-82f5-5ea281cf451e";

function barrierBoard(
  opts: {
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "br", def: printing(BARRIER), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Mine One", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Mine Two", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Mine Three", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "Foe One", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe Two", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { rage: 12 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type BarrierGame = ReturnType<typeof barrierBoard>;

const barrier = (g: BarrierGame, x: number, picked: string[]) =>
  play(g.engine, P1, g.id("br"), { variables: { x }, selected: { picked: picked.map((k) => g.id(k)) } });
const barrierAttempt = (g: BarrierGame, x: number, picked: string[]) => () =>
  playRaw(g.engine, P1, g.id("br"), { variables: { x }, selected: { picked: picked.map((k) => g.id(k)) } });
const statsOf = (g: BarrierGame, key: string) => ({
  strength: g.engine.getStat(g.id(key), "strength"),
  life: g.engine.getStat(g.id(key), "life"),
  speed: g.engine.getStat(g.id(key), "speed")
});
/** The printed stats of the board's characters. */
const BARRIER_BASE: Record<string, { strength: number; life: number; speed: number }> = {
  c1: { strength: 1, life: 2, speed: 2 },
  c2: { strength: 2, life: 3, speed: 3 },
  c3: { strength: 1, life: 1, speed: 1 },
  f1: { strength: 2, life: 2, speed: 2 },
  f2: { strength: 1, life: 4, speed: 1 }
};

clause(BARRIER, "0:ability", "X = 1: both picked characters gain 1 strength and 1 life (speed is unchanged)", () => {
  const g = barrierBoard();
  barrier(g, 1, ["c1", "c2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(statsOf(g, "c1"), { strength: 2, life: 3, speed: 2 });
  assert.deepEqual(statsOf(g, "c2"), { strength: 3, life: 4, speed: 3 });
});

clause(BARRIER, "0:ability", "X = 2: both picked characters gain 2 strength and 2 life", () => {
  const g = barrierBoard();
  barrier(g, 2, ["c1", "c2"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 3, life: 4, speed: 2 });
  assert.deepEqual(statsOf(g, "c2"), { strength: 4, life: 5, speed: 3 });
});

clause(BARRIER, "0:ability", "X = 5: both picked characters gain 5 strength and 5 life", () => {
  const g = barrierBoard();
  barrier(g, 5, ["c1", "c3"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 6, life: 7, speed: 2 });
  assert.deepEqual(statsOf(g, "c3"), { strength: 6, life: 6, speed: 1 });
});

clause(BARRIER, "0:ability", "X = 0 is a legal number: it costs nothing and changes nothing, and the tactic still resolves into my discard pile", () => {
  const g = barrierBoard();
  const before = ready(g.engine);
  barrier(g, 0, ["c1", "c2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("br")), "discard");
  assert.equal(before - ready(g.engine), 0, "X + X = 0 resources paid");
  assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1);
  assert.deepEqual(statsOf(g, "c2"), BARRIER_BASE.c2);
});

clause(BARRIER, "0:ability", "only the picked characters gain the bonus: an unpicked ally and the opponent's characters do not", () => {
  const g = barrierBoard();
  barrier(g, 2, ["c1", "c2"]);
  for (const key of ["c3", "f1", "f2"]) assert.deepEqual(statsOf(g, key), BARRIER_BASE[key], `${key} is unchanged`);
});

clause(BARRIER, "0:ability", "Pick 2 or fewer: picking just one character works and only that one gains the bonus", () => {
  const g = barrierBoard();
  barrier(g, 3, ["c2"]);
  assert.deepEqual(statsOf(g, "c2"), { strength: 5, life: 6, speed: 3 });
  assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1);
});

clause(BARRIER, "0:ability", "Pick 2 or fewer: picking no character is allowed (fewer than 2), the cost X+X is still paid and nothing changes", () => {
  const g = barrierBoard();
  const before = ready(g.engine);
  barrier(g, 2, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("br")), "discard", "it resolved");
  assert.equal(before - ready(g.engine), 4, "X + X = 4 were paid");
  for (const key of Object.keys(BARRIER_BASE)) assert.deepEqual(statsOf(g, key), BARRIER_BASE[key], `${key} is unchanged`);
});

clause(BARRIER, "0:ability", "Pick 2 or fewer: three characters are refused (nothing is paid), two are accepted", () => {
  const g = barrierBoard();
  const before = ready(g.engine);
  refused(barrierAttempt(g, 1, ["c1", "c2", "c3"]), "three picks");
  assert.equal(zoneOf(g.engine, g.id("br")), "hand", "still in hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
  barrier(g, 1, ["c1", "c2"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 2, life: 3, speed: 2 }, "control: two picks work");
});

clause(BARRIER, "0:ability", "the two picks are two different characters: picking the same character twice is refused", () => {
  const g = barrierBoard();
  refused(barrierAttempt(g, 2, ["c1", "c1"]), "the same character twice");
  assert.equal(zoneOf(g.engine, g.id("br")), "hand");
  assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1);
});

clause(BARRIER, "0:ability", "'characters' means any characters: my opponent's characters can be picked, alone or together with mine", () => {
  const theirs = barrierBoard();
  barrier(theirs, 2, ["f1", "f2"]);
  assert.deepEqual(statsOf(theirs, "f1"), { strength: 4, life: 4, speed: 2 });
  assert.deepEqual(statsOf(theirs, "f2"), { strength: 3, life: 6, speed: 1 });
  assert.deepEqual(statsOf(theirs, "c1"), BARRIER_BASE.c1, "mine are untouched");
  const mixed = barrierBoard();
  barrier(mixed, 1, ["c3", "f1"]);
  assert.deepEqual(statsOf(mixed, "c3"), { strength: 2, life: 2, speed: 1 });
  assert.deepEqual(statsOf(mixed, "f1"), { strength: 3, life: 3, speed: 2 });
});

clause(BARRIER, "0:ability", "only characters in play can be picked: an item, a location, a face-down card, a faction, a resource and cards in other zones are refused", () => {
  const g = barrierBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "fdc", def: character({ name: "Hidden Character", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "Discard Character" }), owner: P1, zone: "discard" }
    ]
  });
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && cid !== g.id("fdc"))!;
  const before = ready(g.engine);
  const attempts: Array<[string, CardInstanceId]> = [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["a card in hand", g.id("handChar")],
    ["a card in the discard pile", g.id("discChar")],
    ["a face-up resource", resource],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ];
  for (const [what, cid] of attempts) {
    refused(() => playRaw(g.engine, P1, g.id("br"), { variables: { x: 1 }, selected: { picked: [cid] } }), `${what} is not a character in play`);
  }
  assert.equal(zoneOf(g.engine, g.id("br")), "hand", "every refusal left the tactic in hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
  barrier(g, 1, ["c1"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 2, life: 3, speed: 2 }, "control: a real character works");
});

clause(BARRIER, "0:ability", "the bonus lasts this turn only: when my turn ends the picked characters are back to their printed stats", () => {
  const g = barrierBoard();
  barrier(g, 3, ["c1", "f1"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 4, life: 5, speed: 2 }, "control: the bonus is on");
  assert.deepEqual(statsOf(g, "f1"), { strength: 5, life: 5, speed: 2 }, "control: on theirs too");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1, "my character is back to normal");
  assert.deepEqual(statsOf(g, "f1"), BARRIER_BASE.f1, "their character is back to normal");
});

clause(BARRIER, "0:ability", "the bonus stacks with other modifiers on the same character", () => {
  const g = barrierBoard({ extra: [{ key: "pump", def: pumpTactic(1), owner: P1, zone: "hand" }] });
  barrier(g, 2, ["c2"]);
  play(g.engine, P1, g.id("pump"), { selected: { t: [g.id("c2")] } });
  assert.deepEqual(statsOf(g, "c2"), { strength: 5, life: 5, speed: 3 });
});

clause(BARRIER, "0:ability", "the extra life really protects: a 2-life character with +2 life survives 3 damage", () => {
  const g = barrierBoard({ extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  barrier(g, 2, ["c1"]);
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("c1")] } });
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "2 life + 2 = 4 life against 3 damage");
  assert.equal(damageOf(g.engine, g.id("c1")), 3);
});

clause(BARRIER, "0:ability", "without the Barrier the same 3 damage kills the 2-life character (control for the previous test)", () => {
  const g = barrierBoard({ extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("c1")] } });
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
});

clause(BARRIER, "0:ability", "two Barriers on one character stack: +1 and then +2 makes +3/+3", () => {
  const g = barrierBoard({ extra: [{ key: "br2", def: printing(BARRIER), owner: P1, zone: "hand" }] });
  barrier(g, 1, ["c1"]);
  play(g.engine, P1, g.id("br2"), { variables: { x: 2 }, selected: { picked: [g.id("c1")] } });
  assert.deepEqual(statsOf(g, "c1"), { strength: 4, life: 5, speed: 2 });
});

clause(BARRIER, "0:ability", "the cost is X+X: X = 1 pays 2, X = 2 pays 4, X = 3 pays 6, taken when the tactic is played (before the opponent can respond)", () => {
  for (const x of [1, 2, 3]) {
    const g = barrierBoard();
    const before = ready(g.engine);
    barrierAttempt(g, x, ["c1"])();
    assert.equal(before - ready(g.engine), 2 * x, `X = ${x} pays ${2 * x}`);
    assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
    assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1, "the effect has not happened yet");
  }
});

clause(BARRIER, "0:ability", "X+X must be affordable: X = 3 needs 6 ready resources, 5 are refused (nothing paid), 6 are enough", () => {
  const short = barrierBoard({ icons: { rage: 2, greed: 3 } });
  assert.equal(ready(short.engine), 5);
  refused(barrierAttempt(short, 3, ["c1"]), "five resources for X + X = 6");
  assert.equal(zoneOf(short.engine, short.id("br")), "hand");
  assert.equal(ready(short.engine), 5, "nothing was paid");
  const enough = barrierBoard({ icons: { rage: 2, greed: 4 } });
  barrier(enough, 3, ["c1"]);
  assert.deepEqual(statsOf(enough, "c1"), { strength: 4, life: 5, speed: 2 });
  assert.equal(ready(enough.engine), 0);
});

clause(BARRIER, "0:ability", "the paid resources are spent, not destroyed: they stay in play attached to my faction", () => {
  const g = barrierBoard();
  barrier(g, 2, ["c1"]);
  assert.equal(attachedCount(g.engine, P1), 4);
});

clause(BARRIER, "0:ability", "threshold [R][R]: one [R] among many other resources is refused, two are accepted (even for X = 0)", () => {
  const one = barrierBoard({ icons: { rage: 1, greed: 6 } });
  refused(barrierAttempt(one, 1, ["c1"]), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("br")), "hand");
  const zero = barrierBoard({ icons: { rage: 1, greed: 6 } });
  refused(barrierAttempt(zero, 0, ["c1"]), "one [R] even for X = 0");
  const none = barrierBoard({ icons: { greed: 8 } });
  refused(barrierAttempt(none, 1, ["c1"]), "no [R]");
  const two = barrierBoard({ icons: { rage: 2, greed: 4 } });
  barrier(two, 1, ["c1"]);
  assert.deepEqual(statsOf(two, "c1"), { strength: 2, life: 3, speed: 2 }, "control: two [R]");
  const zeroOk = barrierBoard({ icons: { rage: 2 } });
  barrier(zeroOk, 0, ["c1"]);
  assert.equal(zoneOf(zeroOk.engine, zeroOk.id("br")), "discard", "control: X = 0 with two [R]");
});

clause(BARRIER, "0:ability", "the threshold is not spent: the two Rage that meet [R][R] can be the two resources that pay for X = 1", () => {
  const g = barrierBoard({ icons: { rage: 2 } });
  barrier(g, 1, ["c1"]);
  assert.deepEqual(statsOf(g, "c1"), { strength: 2, life: 3, speed: 2 });
});

clause(BARRIER, "0:ability", "face-down cards provide Volition, not [R], and an opponent's [R] do not count toward my threshold", () => {
  const down = barrierBoard({ icons: { rage: 1 }, extra: volition(6) });
  refused(barrierAttempt(down, 1, ["c1"]), "one [R] and six Volition");
  const theirs = barrierBoard({ icons: { rage: 1, greed: 5 }, oppIcons: { rage: 4 } });
  refused(barrierAttempt(theirs, 1, ["c1"]), "only one [R] of my own");
});

clause(BARRIER, "0:ability", "X is the same for strength and life: X = 4 gives exactly +4/+4", () => {
  const g = barrierBoard();
  barrier(g, 4, ["c2", "f2"]);
  assert.deepEqual(statsOf(g, "c2"), { strength: 6, life: 7, speed: 3 });
  assert.deepEqual(statsOf(g, "f2"), { strength: 5, life: 8, speed: 1 });
});

clause(BARRIER, "0:ability", "'Choose a number for X' must be a whole number (CR 410.2): X = 1.5 is refused and nothing is paid", () => {
  const g = barrierBoard();
  const before = ready(g.engine);
  refused(barrierAttempt(g, 1.5, ["c1"]), "a fractional X");
  assert.equal(zoneOf(g.engine, g.id("br")), "hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(BARRIER, "0:ability", "'Choose a number for X' cannot be negative: X = -1 is refused and nothing is paid", () => {
  const g = barrierBoard();
  const before = ready(g.engine);
  refused(barrierAttempt(g, -1, ["c1"]), "a negative X");
  assert.equal(zoneOf(g.engine, g.id("br")), "hand");
  assert.equal(ready(g.engine), before);
  assert.deepEqual(statsOf(g, "c1"), BARRIER_BASE.c1);
});

clause(BARRIER, "0:ability", "'Choose a number for X' is a cost: playing without choosing a number is refused instead of silently using X = 0", () => {
  const g = barrierBoard();
  refused(() => playRaw(g.engine, P1, g.id("br"), { selected: { picked: [g.id("c1")] } }), "no number chosen for X");
  assert.equal(zoneOf(g.engine, g.id("br")), "hand");
});

clause(BARRIER, "0:ability", "a picked character that leaves play in response does not stop the other from getting the bonus", () => {
  const g = barrierBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  barrierAttempt(g, 2, ["c1", "c2"])();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("c1")] });
  assert.equal(zoneOf(g.engine, g.id("c1")), "removed", "control: one picked character left play");
  assert.deepEqual(statsOf(g, "c2"), { strength: 4, life: 5, speed: 3 });
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BARRIER, "0:ability", "characters that enter play after it resolves do not get the bonus (it affects the characters picked)", () => {
  const g = barrierBoard({
    extra: [
      { key: "late", def: character({ name: "Latecomer", strength: 1, life: 2 }), owner: P1, zone: "hand" },
      { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }
    ]
  });
  barrier(g, 2, ["c1", "c2"]);
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("late")] } });
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  assert.deepEqual(statsOf(g, "late"), { strength: 1, life: 2, speed: 1 });
});

clause(BARRIER, "0:ability", "as a tactic it is played in response on my opponent's turn: it saves a blocker in the coming battle", () => {
  const board = () =>
    barrierBoard({
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }]
    });
  // control: without the Barrier the 2-life blocker dies to the faster attacker before it can strike back
  const plain = board();
  declareAttackBy(plain.engine, P2, [plain.id("atk")]);
  declareBlockers(plain.engine, P1, [plain.id("c1")]);
  finishBattle(plain.engine);
  assert.equal(zoneOf(plain.engine, plain.id("c1")), "discard", "control: the blocker dies");
  assert.equal(zoneOf(plain.engine, plain.id("atk")), "play", "control: the attacker survives");
  // with X = 2 on the blocker: it becomes 3/4, survives 3 damage and then kills the attacker
  const g = board();
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("br"), { picked: [g.id("c1")] }, { x: 2 });
  declareBlockers(g.engine, P1, [g.id("c1")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "the blocker survived: 3 damage against 4 life");
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "the 3-strength blocker killed the 3-life attacker");
});

clause(BARRIER, "0:ability", "the tactic ends in its owner's discard pile after resolving", () => {
  const g = barrierBoard();
  barrier(g, 1, ["c1"]);
  assert.equal(zoneOf(g.engine, g.id("br")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("br")), "discardOf(g.engine, P1).includes(g.id(\"br\"))");
});


// =================================================================================
// Conscientious Objector
// You may play this card whenever you could play a tactic.
// COST: Pick a location you control.
// While the picked location is in play, this card cannot attack or block.
// FLIP UP: 2 [R][R]
// Character (pacifist), cost 2, [R][R], 6 strength / 3 speed / 6 life.
// =================================================================================

const OBJECTOR = "ef598868-fa9c-42d7-bedb-111651c097e4";
const TACTICIAN_VACATION = "f5b4db56-d972-48de-b1b5-7f16b7d427aa";

/** A free tactic (id "dl", pick "t"): destroys the picked location in play. */
function destroyLocationTactic(name = "Raze"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "dl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

function objBoard(
  opts: {
    co?: "hand" | "faceDown" | "play" | "discard";
    icons?: Icons;
    oppIcons?: Icons;
    coSpent?: boolean;
    turn?: number;
    active?: PlayerId;
    noLocation?: boolean;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.co ?? "hand";
  return devBoard(
    [
      {
        key: "co",
        def: printing(OBJECTOR),
        owner: P1,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.coSpent ? "__factionA" : undefined
      },
      ...(opts.noLocation
        ? []
        : [
            { key: "loc1", def: location({ name: "My First Place", structure: 9 }), owner: P1, zone: "play" as const },
            { key: "loc2", def: location({ name: "My Second Place", structure: 9 }), owner: P1, zone: "play" as const }
          ]),
      { key: "oloc", def: location({ name: "Their Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "My Thing" }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Attacker", strength: 1, life: 9 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { rage: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ObjGame = ReturnType<typeof objBoard>;

/** Plays the Objector from hand, picking `loc` (default my first location). */
const objector = (g: ObjGame, loc = "loc1") => play(g.engine, P1, g.id("co"), { selected: { anchor: [g.id(loc)] } });
const objectorAttempt = (g: ObjGame, picks: string[]) => () => playRaw(g.engine, P1, g.id("co"), { selected: { anchor: picks.map((k) => g.id(k)) } });
const attackRaw = (g: ObjGame, player: PlayerId, attackers: string[]) => () =>
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: attackers.map((k) => g.id(k)), target: { type: "faction", playerId: other(player) } });

/** The Objector is played on my turn 1 and I end the turn: it is my opponent's turn 2. */
function objectorOnTheirTurn(opts: Parameters<typeof objBoard>[0] = {}, loc = "loc1"): ObjGame {
  const g = objBoard(opts);
  objector(g, loc);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  return g;
}

/** The Objector is played on my turn 1, both turns pass and it is my turn 3 (it has been in play since the start of the turn). */
function objectorOnMyNextTurn(opts: Parameters<typeof objBoard>[0] = {}, loc = "loc1"): ObjGame {
  const g = objectorOnTheirTurn(opts, loc);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  return g;
}

// --- 0:rule: TACTICAL --------------------------------------------------------------------------

clause(OBJECTOR, "0:rule", "on my own turn it is played like any character: it enters play under my control", () => {
  const g = objBoard();
  objector(g);
  assert.equal(zoneOf(g.engine, g.id("co")), "play");
  assert.equal(g.engine.state.cards[g.id("co")].controllerId, P1);
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false);
});

clause(OBJECTOR, "0:rule", "I may play it whenever I could play a tactic: in response to my opponent's attack it enters play (not my discard pile)", () => {
  const g = objBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("co"), { anchor: [g.id("loc1")] });
  assert.equal(zoneOf(g.engine, g.id("co")), "play", "it is a character: it resolves into play");
  assert.equal(g.engine.state.cards[g.id("co")].controllerId, P1);
});

clause(OBJECTOR, "0:rule", "outside a response window on my opponent's turn it cannot be played (no tactic could be either)", () => {
  const g = objBoard({ turn: 2, active: P2 });
  refused(objectorAttempt(g, ["loc1"]), "my opponent's turn, no window");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(OBJECTOR, "0:rule", "an ordinary character with the same cost and threshold cannot be played in that same response window (the Tactical keyword is what allows it)", () => {
  const plain = character({ name: "Plain Pacifist", cost: 2, threshold: "rr", strength: 6, life: 6, speed: 3 });
  const g = objBoard({ turn: 2, active: P2, extra: [{ key: "plain", def: plain, owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => playRaw(g.engine, P1, g.id("plain")), "a plain character cannot be deployed in response");
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  respondWith(g.engine, P1, g.id("co"), { anchor: [g.id("loc1")] });
  assert.equal(zoneOf(g.engine, g.id("co")), "play", "control: the Objector can");
});

clause(OBJECTOR, "0:rule", "it can be played in my own turn's battle windows too: in response to my own attack (a tactic could be played there)", () => {
  const g = objBoard({ extra: [{ key: "mine", def: character({ name: "Attacker", strength: 1, life: 5 }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("mine")], target: { type: "faction", playerId: P2 } });
  play(g.engine, P1, g.id("co"), { selected: { anchor: [g.id("loc1")] } });
  assert.equal(zoneOf(g.engine, g.id("co")), "play");
});

clause(OBJECTOR, "0:rule", "Tactician Vacation closes every window a tactic could be played in, so the Objector cannot be played in response any more (FAQ)", () => {
  const g = objBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "vac", def: printing(TACTICIAN_VACATION), owner: P2, zone: "hand" },
      { key: "ptac", def: tactic({ name: "Plain Tactic", cost: 0 }), owner: P1, zone: "hand" },
      ...res({ rage: 6 }, P2)
    ]
  });
  play(g.engine, P2, g.id("vac"));
  assert.equal(zoneOf(g.engine, g.id("vac")), "discard", "control: Tactician Vacation resolved");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "control: I hold priority in the attack window");
  refused(() => playRaw(g.engine, P1, g.id("ptac")), "control: an ordinary tactic is refused after Tactician Vacation", /cannot play tactic cards/);
  refused(objectorAttempt(g, ["loc1"]), "the tactic window is closed for the rest of the turn");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
});

clause(OBJECTOR, "0:rule", "Tactician Vacation does not stop the Objector from being played when it normally could be (on my own turn)", () => {
  const g = objBoard({ extra: [{ key: "vac", def: printing(TACTICIAN_VACATION), owner: P1, zone: "hand" }, ...res({ rage: 4 })] });
  play(g.engine, P1, g.id("vac"));
  assert.equal(zoneOf(g.engine, g.id("vac")), "discard", "control: Tactician Vacation resolved");
  objector(g);
  assert.equal(zoneOf(g.engine, g.id("co")), "play");
});

// --- 1:ability: COST: Pick a location you control -----------------------------------------------

clause(OBJECTOR, "1:ability", "it enters play with its printed stats: 6 strength, 3 speed, 6 life, a pacifist", () => {
  const g = objBoard();
  objector(g);
  assert.equal(g.engine.getStat(g.id("co"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("co"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("co"), "life"), 6);
  assert.deepEqual(printing(OBJECTOR).subtype, ["pacifist"]);
});

clause(OBJECTOR, "1:ability", "the cost of 2 is paid when it is played, before the opponent can respond", () => {
  const g = objBoard();
  const before = ready(g.engine);
  objectorAttempt(g, ["loc1"])();
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("co")), "deploying");
});

clause(OBJECTOR, "1:ability", "a location I control can be picked: either of my two locations", () => {
  for (const loc of ["loc1", "loc2"]) {
    const g = objBoard();
    objector(g, loc);
    assert.equal(zoneOf(g.engine, g.id("co")), "play", `picked ${loc}`);
  }
});

clause(OBJECTOR, "1:ability", "with no location I control it cannot be played, and nothing is paid", () => {
  const g = objBoard({ noLocation: true });
  refused(() => playRaw(g.engine, P1, g.id("co")), "no pick at all");
  refused(objectorAttempt(g, ["oloc"]), "only my opponent's location exists");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(OBJECTOR, "1:ability", "a location my OPPONENT controls cannot be picked (a location I control can)", () => {
  const g = objBoard();
  refused(objectorAttempt(g, ["oloc"]), "their location");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
  objector(g);
  assert.equal(zoneOf(g.engine, g.id("co")), "play", "control");
});

clause(OBJECTOR, "1:ability", "only a LOCATION can be picked: an item, a character, a resource, a face-down card and a faction are refused", () => {
  const g = objBoard({ extra: [{ key: "fd", def: location({ name: "Hidden Place", structure: 3 }), owner: P1, zone: "play", faceDown: true }] });
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && cid !== g.id("fd"))!;
  const readyBefore = ready(g.engine);
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a character", g.id("ally")],
    ["a face-up resource", resource],
    ["a face-down location", g.id("fd")],
    ["my faction", g.engine.state.players[P1].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => playRaw(g.engine, P1, g.id("co"), { selected: { anchor: [cid] } }), `${what} is not a location`);
  }
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  assert.equal(ready(g.engine), readyBefore, "nothing was paid");
});

clause(OBJECTOR, "1:ability", "the location must be in play: a location in my hand or discard pile cannot be picked", () => {
  const g = objBoard({
    noLocation: true,
    extra: [
      { key: "handLoc", def: location({ name: "Hand Place", structure: 3 }), owner: P1, zone: "hand" },
      { key: "discLoc", def: location({ name: "Discard Place", structure: 3 }), owner: P1, zone: "discard" }
    ]
  });
  refused(objectorAttempt(g, ["handLoc"]), "a location in hand");
  refused(objectorAttempt(g, ["discLoc"]), "a location in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
});

clause(OBJECTOR, "1:ability", "exactly one location is picked: two locations are refused", () => {
  const g = objBoard();
  refused(objectorAttempt(g, ["loc1", "loc2"]), "two picks");
  refused(objectorAttempt(g, []), "no pick");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  assert.equal(ready(g.engine), 6);
});

clause(OBJECTOR, "1:ability", "'a location you control': a location I took control of counts, a location I own but my opponent controls does not", () => {
  const g = objBoard({
    noLocation: true,
    extra: [
      { key: "stolen", def: location({ name: "Stolen Place", structure: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: location({ name: "Lent Place", structure: 9 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  refused(objectorAttempt(g, ["lent"]), "a location I own but do not control");
  assert.equal(zoneOf(g.engine, g.id("co")), "hand");
  objector(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("co")), "play", "a location I control but do not own works");
});

clause(OBJECTOR, "1:ability", "cost 2 and threshold [R][R]: one resource short is refused, one [R] is refused, two [R] are enough (the same two can pay)", () => {
  const short = objBoard({ icons: { rage: 1 } });
  refused(objectorAttempt(short, ["loc1"]), "one resource");
  const oneR = objBoard({ icons: { rage: 1, greed: 5 } });
  refused(objectorAttempt(oneR, ["loc1"]), "one [R]");
  assert.equal(zoneOf(oneR.engine, oneR.id("co")), "hand");
  const spent = objBoard({ icons: { greed: 1 }, extra: spentRage(2) });
  assert.equal(ready(spent.engine), 1);
  refused(objectorAttempt(spent, ["loc1"]), "[R][R] met by spent Rage but only one ready resource");
  const enough = objBoard({ icons: { rage: 2 } });
  objector(enough);
  assert.equal(zoneOf(enough.engine, enough.id("co")), "play", "control: [R][R] meets the threshold and pays 2");
});

clause(OBJECTOR, "1:ability", "face-down cards provide Volition, not [R], and an opponent's [R] do not count", () => {
  const down = objBoard({ icons: { rage: 1 }, extra: volition(5) });
  refused(objectorAttempt(down, ["loc1"]), "one [R] and Volition");
  const theirs = objBoard({ icons: { rage: 1, greed: 4 }, oppIcons: { rage: 4 } });
  refused(objectorAttempt(theirs, ["loc1"]), "only one [R] of my own");
});

// --- 2:rule: while the picked location is in play, this card cannot attack or block --------------

clause(OBJECTOR, "2:rule", "while the picked location is in play it has the cannot-attack and cannot-block restrictions", () => {
  const g = objBoard();
  objector(g);
  const restrictions = g.engine.getRestrictions(g.id("co"));
  assert.ok(restrictions.includes("cannotAttack"), "restrictions.includes(\"cannotAttack\")");
  assert.ok(restrictions.includes("cannotBlock"), "restrictions.includes(\"cannotBlock\")");
});

clause(OBJECTOR, "2:rule", "it cannot block while the picked location is in play: a block with the Objector is refused, a block with an ally is accepted", () => {
  const g = objectorOnTheirTurn();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  refused(() => declareBlockers(g.engine, P1, [g.id("co")]), "the Objector cannot block");
  assert.equal(battleOf(g.engine)?.blockingParty.length ?? 0, 0);
  declareBlockers(g.engine, P1, [g.id("ally")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("ally")], "control: an ally can block");
});

clause(OBJECTOR, "2:rule", "it cannot block together with an ally either: a blocking party that includes the Objector is refused", () => {
  const g = objectorOnTheirTurn();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  refused(() => declareBlockers(g.engine, P1, [g.id("ally"), g.id("co")]), "a party including the Objector");
  assert.equal(battleOf(g.engine)?.blockingParty.length ?? 0, 0);
});

clause(OBJECTOR, "2:rule", "it cannot attack while the picked location is in play: an attack with the Objector is refused, an attack with an ally is accepted", () => {
  const refusedGame = objectorOnMyNextTurn();
  refused(attackRaw(refusedGame, P1, ["co"]), "the Objector cannot attack");
  assert.equal(refusedGame.engine.state.battle, undefined, "no battle started");
  assert.equal(refusedGame.engine.state.cards[refusedGame.id("co")].depleted, false, "it was not depleted");
  const control = objectorOnMyNextTurn();
  attackRaw(control, P1, ["ally"])();
  assert.ok(battleOf(control.engine), "control: an ally can attack");
});

clause(OBJECTOR, "2:rule", "it cannot attack together with an ally either: an attacking party that includes the Objector is refused", () => {
  const g = objectorOnMyNextTurn();
  refused(attackRaw(g, P1, ["ally", "co"]), "a party including the Objector");
  assert.equal(g.engine.state.battle, undefined);
});

clause(OBJECTOR, "2:rule", "once the picked location leaves play (destroyed), it can block again", () => {
  const g = objectorOnTheirTurn({ extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("raze"), { t: [g.id("loc1")] });
  assert.equal(zoneOf(g.engine, g.id("loc1")), "discard", "control: the picked location was destroyed");
  assert.equal(zoneOf(g.engine, g.id("loc2")), "play", "my other location is still in play");
  declareBlockers(g.engine, P1, [g.id("co")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("co")], "the Objector blocks");
});

clause(OBJECTOR, "2:rule", "once the picked location leaves play (destroyed), it can attack again", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] });
  refused(attackRaw(g, P1, ["co"]), "control: it cannot attack while the location is in play");
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("loc1")] } });
  assert.equal(zoneOf(g.engine, g.id("loc1")), "discard");
  attackRaw(g, P1, ["co"])();
  assert.ok(battleOf(g.engine), "the Objector attacked");
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("co")]);
});

clause(OBJECTOR, "2:rule", "the restriction ends when the picked location leaves play any other way: returned to its owner's hand", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("loc1")] } });
  assert.equal(zoneOf(g.engine, g.id("loc1")), "hand");
  attackRaw(g, P1, ["co"])();
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("co")]);
});

clause(OBJECTOR, "2:rule", "only the PICKED location matters: destroying my other location does not free the Objector", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("loc2")] } });
  assert.equal(zoneOf(g.engine, g.id("loc2")), "discard", "control: the other location was destroyed");
  assert.equal(zoneOf(g.engine, g.id("loc1")), "play");
  refused(attackRaw(g, P1, ["co"]), "the picked location is still in play");
  assert.equal(g.engine.state.battle, undefined);
});

clause(OBJECTOR, "2:rule", "only the PICKED location matters: with my first location picked, destroying it frees the Objector even though my second location stays", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("loc1")] } });
  assert.equal(zoneOf(g.engine, g.id("loc2")), "play");
  attackRaw(g, P1, ["co"])();
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("co")]);
});

clause(OBJECTOR, "2:rule", "picking my second location: it is that one that matters (destroying the first changes nothing)", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] }, "loc2");
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("loc1")] } });
  refused(attackRaw(g, P1, ["co"]), "the picked location (loc2) is still in play");
  assert.equal(g.engine.state.battle, undefined);
});

clause(OBJECTOR, "2:rule", "'while the picked location is in play': it stays restricted if the location only changes controller (my opponent takes it)", () => {
  const g = objectorOnMyNextTurn({ extra: [{ key: "pre", def: stealTactic("Their Steal"), owner: P2, zone: "hand" }, ...res({ rage: 2 }, P2)] });
  // my opponent steals my picked location in response to my attack with an ally (a window on my turn)
  declareAttackOpenWindow(g.engine, P1, [g.id("ally")]);
  respondWith(g.engine, P2, g.id("pre"), { t: [g.id("loc1")] });
  assert.equal(g.engine.state.cards[g.id("loc1")].controllerId, P2, "control: they took the picked location");
  assert.equal(zoneOf(g.engine, g.id("loc1")), "play");
  assert.ok(g.engine.getRestrictions(g.id("co")).includes("cannotAttack"), "the picked location is still in play");
});

clause(OBJECTOR, "2:rule", "the restriction is on the Objector alone: an ally can attack and block as usual", () => {
  const g = objectorOnTheirTurn();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("ally")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(damageOf(g.engine, g.id("atk")), 2, "the ally dealt its 2 damage as a blocker");
});

clause(OBJECTOR, "2:rule", "put into play by an effect it was never given a picked location: nothing restricts it (literal reading: no picked location is in play)", () => {
  const g = objBoard({
    co: "discard",
    turn: 2,
    active: P2,
    extra: [{ key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("pip"), { t: [g.id("co")] });
  assert.equal(zoneOf(g.engine, g.id("co")), "play", "control: it was put into play");
  declareBlockers(g.engine, P1, [g.id("co")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("co")]);
});

clause(OBJECTOR, "2:rule", "a face-down Objector is only a resource (CR 411.1): it has no restrictions of its own", () => {
  const g = objBoard({ co: "faceDown" });
  assert.equal(g.engine.getRestrictions(g.id("co")).includes("cannotAttack"), false);
});

// --- 3:flipUp: 2 [R][R] --------------------------------------------------------------------------

const flipObjector = (g: ObjGame, loc = "loc1", player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("co"), { anchor: [g.id(loc)] });

clause(OBJECTOR, "3:flipUp", "a face-down Objector is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = objBoard({ co: "faceDown", icons: { rage: 2 } });
  assert.equal(g.engine.isResource(g.id("co")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(OBJECTOR, "3:flipUp", "flipping it up puts the character face-up into play under my control with its 6/3/6 stats", () => {
  const g = objBoard({ co: "faceDown" });
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("co")), "play");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("co")].controllerId, P1);
  assert.equal(g.engine.isResource(g.id("co")), false, "it is a character now");
  assert.equal(g.engine.getStat(g.id("co"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("co"), "life"), 6);
});

clause(OBJECTOR, "3:flipUp", "FLIP UP costs 2: with exactly two ready resources (the Objector itself and one more) it works", () => {
  const g = objBoard({ co: "faceDown", icons: { rage: 1 }, extra: spentRage(1) });
  assert.equal(ready(g.engine), 2);
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false);
});

clause(OBJECTOR, "3:flipUp", "FLIP UP costs 2: one ready resource is refused and nothing changes", () => {
  const g = objBoard({ co: "faceDown", icons: {}, extra: spentRage(2) });
  assert.equal(ready(g.engine), 1, "only the face-down Objector itself is ready");
  refused(() => flipObjector(g), "one ready resource for a Flip Up cost of 2");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, true);
  assert.equal(ready(g.engine), 1);
});

clause(OBJECTOR, "3:flipUp", "FLIP UP pays 2 and no more: with many resources at most two end up spent", () => {
  const g = objBoard({ co: "faceDown", icons: { rage: 8 } });
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 2, "at most two resources spent");
  assert.ok(attachedCount(g.engine, P1) >= 1, "at least one payment that was not the Objector itself");
});

clause(OBJECTOR, "3:flipUp", "FLIP UP needs [R][R]: one [R] among many other resources is refused, two are accepted", () => {
  const one = objBoard({ co: "faceDown", icons: { rage: 1, greed: 6 } });
  refused(() => flipObjector(one), "one [R]");
  assert.equal(one.engine.state.cards[one.id("co")].faceDown, true);
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = objBoard({ co: "faceDown", icons: { greed: 6 } });
  refused(() => flipObjector(none), "no [R]");
  const two = objBoard({ co: "faceDown", icons: { rage: 2, greed: 2 } });
  flipObjector(two);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("co")].faceDown, false, "control: two [R] is enough");
});

clause(OBJECTOR, "3:flipUp", "the Objector's own Volition does not provide an [R], and the opponent's [R] do not count", () => {
  const g = objBoard({ co: "faceDown", icons: { greed: 5 }, oppIcons: { rage: 4 } });
  refused(() => flipObjector(g), "no [R] of mine");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, true);
});

clause(OBJECTOR, "3:flipUp", "the regular COST still applies when flipping up: a location I control must be picked", () => {
  const none = objBoard({ co: "faceDown", noLocation: true });
  refused(() => flipUpRaw(none.engine, P1, none.id("co")), "no location to pick");
  refused(() => flipObjector(none, "oloc"), "only their location");
  assert.equal(none.engine.state.cards[none.id("co")].faceDown, true);
  assert.equal(ready(none.engine), 7, "nothing was paid");
  const g = objBoard({ co: "faceDown" });
  refused(() => flipUpRaw(g.engine, P1, g.id("co")), "no pick although a location exists");
  refused(() => flipObjector(g, "oloc"), "their location");
  refused(() => flipUpRaw(g.engine, P1, g.id("co"), { anchor: [g.id("thing")] }), "an item");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, true);
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false, "control: a location I control works");
});

clause(OBJECTOR, "3:flipUp", "a flipped-up Objector is restricted by the location picked when it was flipped up: it cannot block while that location is in play", () => {
  const g = objBoard({ co: "faceDown" });
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.ok(g.engine.getRestrictions(g.id("co")).includes("cannotBlock"), "g.engine.getRestrictions(g.id(\"co\")).includes(\"cannotBlock\")");
  endTurn(g.engine, P1);
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  refused(() => declareBlockers(g.engine, P1, [g.id("co")]), "the flipped-up Objector cannot block");
  declareBlockers(g.engine, P1, [g.id("ally")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("ally")], "control");
});

clause(OBJECTOR, "3:flipUp", "a flipped-up Objector cannot attack that turn (it is a new card that did not start the turn in play)", () => {
  const g = objBoard({ co: "faceDown", extra: [{ key: "raze", def: destroyLocationTactic(), owner: P1, zone: "hand" }] });
  flipObjector(g);
  resolvePendingResponses(g.engine);
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("loc1")] } });
  refused(attackRaw(g, P1, ["co"]), "it entered play this turn");
});

clause(OBJECTOR, "3:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = objBoard({ co: "faceDown", oppIcons: { rage: 6 } });
  refused(() => flipObjector(theirs, "loc1", P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("co")].faceDown, true);
  const inHand = objBoard({ co: "hand" });
  refused(() => flipObjector(inHand), "in my hand it is not a face-down resource");
  const faceUp = objBoard({ co: "play" });
  refused(() => flipObjector(faceUp), "a face-up card in play");
});

clause(OBJECTOR, "3:flipUp", "FLIP UP does not change when it may be deployed (CR 507.4d) and it IS Tactical: allowed in response on my opponent's turn", () => {
  const g = objBoard({ co: "faceDown", turn: 2, active: P2 });
  refused(() => flipObjector(g), "my opponent's turn, no window open");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("co")), "play");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false, "flipped up in response to the attack");
});

clause(OBJECTOR, "3:flipUp", "Tactician Vacation closes the tactic window for the rest of the turn, so a face-down Objector cannot be flipped up in response either (CR 507.4d, FAQ)", () => {
  const g = objBoard({
    co: "faceDown",
    turn: 2,
    active: P2,
    extra: [{ key: "vac", def: printing(TACTICIAN_VACATION), owner: P2, zone: "hand" }, ...res({ rage: 6 }, P2)]
  });
  play(g.engine, P2, g.id("vac"));
  assert.equal(zoneOf(g.engine, g.id("vac")), "discard", "control: Tactician Vacation resolved");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "control: I hold priority in the attack window");
  refused(() => flipObjector(g), "the tactic window is closed for the rest of the turn");
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, true);
});

clause(OBJECTOR, "3:flipUp", "a face-down Objector that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = objBoard({ co: "faceDown", coSpent: true });
  flipObjector(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("co")].faceDown, false);
});

clause(OBJECTOR, "3:flipUp", "a flipped-up character is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = objBoard({ co: "faceDown" });
  holdFlipUp(() => flipObjector(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(g.engine.state.cards[g.id("co")].zone, "deploying", "it has not entered play yet: it is being deployed");
});


// =================================================================================
// Dark Awakening
// COST: Pick a non-resource card in your discard pile.
// EFFECT: You may play the card. Draw a card.
// FLIP UP: 2 [R]
// Tactic, cost 2, [R].
// =================================================================================

const DARK = "4134b966-4ee1-4116-adad-7616dc580ddd";

/** A tactic that deals 3 damage to the opponent's faction, so "it was played" shows as -3 influence. */
function bigTactic(name = "Big Blow", cost = 0): CardDefinition {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "blow", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 }] }] }
  });
}

function darkBoard(
  opts: {
    da?: "hand" | "faceDown" | "faceUp" | "discard";
    daSpent?: boolean;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    deck?: number;
    extra?: CardPlacement[];
    noDiscard?: boolean;
    noDeckCard?: boolean;
  } = {}
) {
  const where = opts.da ?? "hand";
  return devBoard(
    [
      {
        key: "da",
        def: printing(DARK),
        owner: P1,
        zone: where === "faceDown" || where === "faceUp" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.daSpent ? "__factionA" : undefined
      },
      ...(opts.noDiscard
        ? []
        : [
            { key: "dChar", def: character({ name: "Fallen Hero", cost: 2, strength: 2, life: 3 }), owner: P1, zone: "discard" as const },
            { key: "dZero", def: character({ name: "Fallen Free Hero", cost: 0, strength: 1, life: 2 }), owner: P1, zone: "discard" as const },
            { key: "dItem", def: item({ name: "Fallen Trinket", cost: 1 }), owner: P1, zone: "discard" as const },
            { key: "dLoc", def: location({ name: "Fallen Place", cost: 1, structure: 3 }), owner: P1, zone: "discard" as const },
            { key: "dTac", def: bigTactic(), owner: P1, zone: "discard" as const },
            { key: "dRes", def: resourceCard({ name: "Fallen Resource" }), owner: P1, zone: "discard" as const }
          ]),
      { key: "oChar", def: character({ name: "Their Fallen Hero" }), owner: P2, zone: "discard" },
      { key: "hChar", def: character({ name: "Hand Hero" }), owner: P1, zone: "hand" },
      ...(opts.noDeckCard ? [] : [{ key: "kChar", def: character({ name: "Deck Hero" }), owner: P1, zone: "deck" as const }]),
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Attacker", life: 9 }), owner: P2, zone: "play" },
      ...fillers("dk", opts.deck ?? 3, P1, "deck"),
      ...res(opts.icons ?? { rage: 8 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: mulberry(7) }
  );
}

type DarkGame = ReturnType<typeof darkBoard>;

/** Plays Dark Awakening picking `pick` (stops at the first pending choice, the "may play" prompt). */
const dark = (g: DarkGame, pick: string) => play(g.engine, P1, g.id("da"), { selected: { pick: [g.id(pick)] } });
const darkAttempt = (g: DarkGame, pick?: string) => () => playRaw(g.engine, P1, g.id("da"), { selected: pick ? { pick: [g.id(pick)] } : {} });

/** Answers the "may play the card" prompt: play `cardKey` (with picks) or decline. */
function darkPlays(g: DarkGame, cardKey: string | undefined, selected: Record<string, CardInstanceId[]> = {}): void {
  const pc = expectPending(g.engine, "deployForFree");
  assert.equal(pc.playerId, P1);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", ...(cardKey ? { cardId: g.id(cardKey), selected } : {}) } } as never);
  resolvePendingResponses(g.engine);
}

/** Plays Dark Awakening on `pick` and accepts playing it. */
function darkAndPlay(g: DarkGame, pick: string): void {
  dark(g, pick);
  darkPlays(g, pick);
}

clause(DARK, "0:ability", "picks a character in my discard pile, plays it (it enters play under my control), draws a card, and Dark Awakening ends in my discard pile", () => {
  const g = darkBoard();
  const top = deckOf(g.engine, P1)[0];
  darkAndPlay(g, "dChar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play", "the picked character entered play");
  assert.equal(g.engine.state.cards[g.id("dChar")].controllerId, P1);
  assert.equal(zoneOf(g.engine, top), "hand", "EFFECT: Draw a card");
  assert.equal(zoneOf(g.engine, g.id("da")), "discard");
});

clause(DARK, "0:ability", "'Draw a card' draws exactly one card: the top of my deck", () => {
  const g = darkBoard({ deck: 3 });
  const deckBefore = deckOf(g.engine, P1);
  darkAndPlay(g, "dChar");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore.slice(1));
  assert.equal(zoneOf(g.engine, deckBefore[0]), "hand");
});

clause(DARK, "0:ability", "'You may play the card': declining leaves it in my discard pile, and the card is still drawn", () => {
  const g = darkBoard();
  const top = deckOf(g.engine, P1)[0];
  dark(g, "dChar");
  darkPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard");
  assert.equal(zoneOf(g.engine, top), "hand", "Draw a card is not part of the 'may'");
  assert.equal(zoneOf(g.engine, g.id("da")), "discard");
});

clause(DARK, "0:ability", "with an empty deck the failed draw costs nothing (CR 306.2) and the rest still happens", () => {
  const g = darkBoard({ deck: 0, noDeckCard: true });
  assert.equal(deckOf(g.engine, P1).length, 0, "control: my deck is empty");
  darkAndPlay(g, "dChar");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play");
  assert.equal(g.engine.state.result, undefined);
});

clause(DARK, "0:ability", "an item in my discard pile can be picked and played: it enters play", () => {
  const g = darkBoard();
  darkAndPlay(g, "dItem");
  assert.equal(zoneOf(g.engine, g.id("dItem")), "play");
});

clause(DARK, "0:ability", "a location in my discard pile can be picked and played: it enters play", () => {
  const g = darkBoard();
  darkAndPlay(g, "dLoc");
  assert.equal(zoneOf(g.engine, g.id("dLoc")), "play");
});

clause(DARK, "0:ability", "a tactic in my discard pile can be picked and played: its effect happens and it ends in my discard pile again", () => {
  const g = darkBoard();
  darkAndPlay(g, "dTac");
  assert.equal(influenceOf(g.engine, P2), START - 3, "the played tactic's effect happened");
  assert.equal(zoneOf(g.engine, g.id("dTac")), "discard", "a resolved tactic goes to its owner's discard pile");
});

clause(DARK, "0:ability", "only the picked card is played: the other cards in my discard pile stay where they are", () => {
  const g = darkBoard();
  darkAndPlay(g, "dChar");
  for (const key of ["dZero", "dItem", "dLoc", "dTac", "dRes"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} stays`);
});

clause(DARK, "0:ability", "a resource card cannot be picked: the pick must be a NON-resource card", () => {
  const g = darkBoard();
  const before = ready(g.engine);
  refused(darkAttempt(g, "dRes"), "a resource card in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("da")), "hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
  dark(g, "dChar");
  assert.ok(pending(g.engine), "control: a character can be picked");
});

clause(DARK, "0:ability", "the pick must be in MY discard pile: my opponent's discard pile, my hand, my deck and cards in play are refused", () => {
  const g = darkBoard();
  const before = ready(g.engine);
  for (const [what, key] of [
    ["a card in my opponent's discard pile", "oChar"],
    ["a card in my hand", "hChar"],
    ["a card in my deck", "kChar"],
    ["a character in play", "ally"],
    ["their character in play", "atk"]
  ] as const) {
    refused(darkAttempt(g, key), what);
  }
  refused(() => playRaw(g.engine, P1, g.id("da"), { selected: { pick: [g.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(g.engine, g.id("da")), "hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(DARK, "0:ability", "with no non-resource card in my discard pile it cannot be played (a pick is a cost) and nothing is paid", () => {
  const g = darkBoard({ noDiscard: true, extra: [{ key: "onlyRes", def: resourceCard({ name: "Only Resource" }), owner: P1, zone: "discard" }] });
  const before = ready(g.engine);
  refused(darkAttempt(g), "no pick");
  refused(darkAttempt(g, "onlyRes"), "only a resource card in the discard pile");
  refused(darkAttempt(g, "oChar"), "only their card has fallen");
  assert.equal(zoneOf(g.engine, g.id("da")), "hand");
  assert.equal(ready(g.engine), before);
});

clause(DARK, "0:ability", "exactly one card is picked: two or none are refused", () => {
  const g = darkBoard();
  refused(() => playRaw(g.engine, P1, g.id("da"), { selected: { pick: [g.id("dChar"), g.id("dItem")] } }), "two picks");
  refused(darkAttempt(g), "no pick");
  assert.equal(zoneOf(g.engine, g.id("da")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(DARK, "0:ability", "its own cost of 2 is paid when it is played, before the opponent can respond; the picked card is not played yet", () => {
  const g = darkBoard();
  const before = ready(g.engine);
  darkAttempt(g, "dChar")();
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard", "the pick has not been played yet");
});

clause(DARK, "0:ability", "cost 2: one resource is refused, two are accepted", () => {
  const short = darkBoard({ icons: {}, extra: spentRage(1).concat(res({ greed: 1 })) });
  assert.equal(ready(short.engine), 1);
  refused(darkAttempt(short, "dChar"), "one ready resource for a cost of 2");
  assert.equal(zoneOf(short.engine, short.id("da")), "hand");
  const enough = darkBoard({ icons: {}, extra: spentRage(1).concat(res({ greed: 2 })) });
  dark(enough, "dChar");
  assert.ok(pending(enough.engine), "control: two ready resources are enough");
});

clause(DARK, "0:ability", "threshold [R]: with no [R] it is refused however many other resources I have; face-down cards and my opponent's [R] do not help", () => {
  const none = darkBoard({ icons: { greed: 8 } });
  refused(darkAttempt(none, "dChar"), "no [R]");
  const down = darkBoard({ icons: { greed: 3 }, extra: volition(4) });
  refused(darkAttempt(down, "dChar"), "Volition is not [R]");
  const theirs = darkBoard({ icons: { greed: 8 }, oppIcons: { rage: 4 } });
  refused(darkAttempt(theirs, "dChar"), "their [R]");
  const one = darkBoard({ icons: { rage: 1, greed: 3 } });
  dark(one, "dChar");
  assert.ok(pending(one.engine), "control: one [R] meets the threshold");
});

clause(DARK, "0:ability", "as a tactic it can be played in response on my opponent's turn: a fallen character is put into play even on their turn", () => {
  const g = darkBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("da"), { selected: { pick: [g.id("dChar")] } });
  resolvePendingResponses(g.engine);
  darkPlays(g, "dChar");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play");
  assert.equal(zoneOf(g.engine, g.id("da")), "discard");
});

clause(DARK, "0:ability", "if the picked card leaves my discard pile in response, the effect loses track of it (CR 402.4): nothing is played, the card is still drawn", () => {
  const yank = tactic({
    name: "Yank From Discard",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "yank",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "opponent", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const g = darkBoard({ turn: 2, active: P2, extra: [{ key: "yank", def: yank, owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  playRaw(g.engine, P1, g.id("da"), { selected: { pick: [g.id("dChar")] } });
  // my opponent yanks the picked card from my discard pile into its owner's hand
  respondWith(g.engine, P2, g.id("yank"), { t: [g.id("dChar")] });
  if (pending(g.engine)?.kind === "deployForFree") darkPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "hand", "control: it moved to my hand");
  assert.equal(zoneOf(g.engine, top), "hand", "the card is still drawn");
});

clause(DARK, "0:ability", "'You may play the card' (not 'for free'): the picked card's numeric cost is paid (a cost-2 character costs 2 more resources)", () => {
  const g = darkBoard({ icons: { rage: 4 } });
  const before = ready(g.engine);
  darkAndPlay(g, "dChar");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play", "control: the character was played");
  assert.equal(before - ready(g.engine), 4, "Dark Awakening's own cost of 2 plus the Fallen Hero's cost of 2");
});

clause(DARK, "0:ability", "'You may play the card': a card whose cost I cannot pay cannot be played", () => {
  const g = darkBoard({ icons: { rage: 4 }, extra: [{ key: "dPricey", def: character({ name: "Fallen Giant", cost: 5 }), owner: P1, zone: "discard" }] });
  dark(g, "dPricey");
  const pc = pending(g.engine);
  assert.ok(pc && pc.kind === "deployForFree", "expected to be asked whether to play the card");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("dPricey"), selected: {} } } as never),
    "playing a cost-5 card with 2 spare resources"
  );
});

clause(DARK, "0:ability", "'You may play the card': an unaffordable card can be declined: it stays in the discard pile and the card is still drawn", () => {
  const g = darkBoard({ icons: { rage: 4 }, extra: [{ key: "dPricey", def: character({ name: "Fallen Giant", cost: 5 }), owner: P1, zone: "discard" }] });
  const top = deckOf(g.engine, P1)[0];
  dark(g, "dPricey");
  darkPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("dPricey")), "discard");
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(DARK, "0:ability", "'You may play the card': the picked card's own threshold must be met (a [G] character cannot be played with only [R])", () => {
  const g = darkBoard({ extra: [{ key: "dGreedy", def: character({ name: "Fallen Banker", cost: 0, threshold: "g" }), owner: P1, zone: "discard" }] });
  dark(g, "dGreedy");
  const pc = pending(g.engine);
  assert.ok(pc && pc.kind === "deployForFree", "expected to be asked whether to play the card");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("dGreedy"), selected: {} } } as never),
    "playing a [G] card with no Greed"
  );
  assert.equal(zoneOf(g.engine, g.id("dGreedy")), "discard");
});

clause(DARK, "0:ability", "'You may play the card': a [G] card CAN be played when I control Greed too (the threshold is checked, not ignored)", () => {
  const g = darkBoard({
    icons: { rage: 4, greed: 1 },
    extra: [{ key: "dGreedy", def: character({ name: "Fallen Banker", cost: 0, threshold: "g" }), owner: P1, zone: "discard" }]
  });
  darkAndPlay(g, "dGreedy");
  assert.equal(zoneOf(g.engine, g.id("dGreedy")), "play");
});

clause(DARK, "0:ability", "'You may play the card': a played character cannot attack that turn (it just entered play)", () => {
  const g = darkBoard();
  darkAndPlay(g, "dZero");
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("dZero")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
});

// --- 1:flipUp: 2 [R] ----------------------------------------------------------------------------

/** Flips Dark Awakening up picking `pick`. */
const flipDark = (g: DarkGame, pick: string | null = "dChar", player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("da"), pick ? { pick: [g.id(pick)] } : {});

clause(DARK, "1:flipUp", "a face-down Dark Awakening is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = darkBoard({ da: "faceDown", icons: { rage: 1 } });
  assert.equal(g.engine.isResource(g.id("da")), true);
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(DARK, "1:flipUp", "flipping it up resolves it as the tactic: the picked card may be played, a card is drawn, and Dark Awakening ends in my discard pile", () => {
  const g = darkBoard({ da: "faceDown" });
  const top = deckOf(g.engine, P1)[0];
  flipDark(g);
  darkPlays(g, "dChar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play", "the fallen character was played");
  assert.equal(zoneOf(g.engine, top), "hand", "a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("da")), "discard");
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, false);
});

clause(DARK, "1:flipUp", "flipped up, 'you may play the card' can still be declined (the card stays in the discard pile) and the card is still drawn", () => {
  const g = darkBoard({ da: "faceDown" });
  const top = deckOf(g.engine, P1)[0];
  flipDark(g);
  darkPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard");
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(DARK, "1:flipUp", "FLIP UP costs 2 (the card's cost number is also 2): with exactly two ready resources, itself included, it works", () => {
  const g = darkBoard({ da: "faceDown", icons: { rage: 1 } });
  assert.equal(ready(g.engine), 2);
  flipDark(g);
  darkPlays(g, undefined);
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, false);
});

clause(DARK, "1:flipUp", "FLIP UP costs 2: one ready resource is refused and nothing changes", () => {
  const g = darkBoard({ da: "faceDown", icons: {}, extra: spentRage(2) });
  assert.equal(ready(g.engine), 1);
  refused(() => flipDark(g), "one ready resource for a Flip Up cost of 2");
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, true);
  assert.equal(ready(g.engine), 1, "nothing was paid");
});

clause(DARK, "1:flipUp", "FLIP UP pays 2 and no more: with many resources at most two end up spent", () => {
  const g = darkBoard({ da: "faceDown", icons: { rage: 8 } });
  flipDark(g);
  darkPlays(g, undefined);
  assert.ok(attachedCount(g.engine, P1) <= 2, "at most two resources spent");
});

clause(DARK, "1:flipUp", "FLIP UP needs [R]: no [R] among many other resources is refused, one is accepted; Volition and the opponent's [R] do not count", () => {
  const none = darkBoard({ da: "faceDown", icons: { greed: 6 } });
  refused(() => flipDark(none), "no [R]");
  assert.equal(none.engine.state.cards[none.id("da")].faceDown, true);
  assert.equal(ready(none.engine), 7, "nothing was paid");
  const theirs = darkBoard({ da: "faceDown", icons: { greed: 6 }, oppIcons: { rage: 4 } });
  refused(() => flipDark(theirs), "only their [R]");
  const one = darkBoard({ da: "faceDown", icons: { rage: 1, greed: 2 } });
  flipDark(one);
  darkPlays(one, undefined);
  assert.equal(one.engine.state.cards[one.id("da")].faceDown, false, "control: one [R] is enough");
});

clause(DARK, "1:flipUp", "the regular COST still applies when flipping up: a non-resource card in my discard pile must be picked", () => {
  const g = darkBoard({ da: "faceDown" });
  refused(() => flipDark(g, null), "no pick");
  refused(() => flipDark(g, "dRes"), "a resource card");
  refused(() => flipDark(g, "oChar"), "their discard pile");
  refused(() => flipDark(g, "hChar"), "my hand");
  refused(() => flipDark(g, "ally"), "a character in play");
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 9, "nothing was paid");
  flipDark(g, "dItem");
  darkPlays(g, "dItem");
  assert.equal(zoneOf(g.engine, g.id("dItem")), "play", "control: a legal pick works");
});

clause(DARK, "1:flipUp", "with no non-resource card in my discard pile it cannot be flipped up", () => {
  const g = darkBoard({ da: "faceDown", noDiscard: true });
  refused(() => flipDark(g, null), "nothing to pick");
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, true);
});

clause(DARK, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, discard pile, or face-up)", () => {
  const theirs = darkBoard({ da: "faceDown", oppIcons: { rage: 4 } });
  refused(() => flipDark(theirs, "dChar", P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("da")].faceDown, true);
  const inHand = darkBoard({ da: "hand" });
  refused(() => flipDark(inHand), "in my hand it is not a face-down resource");
  const faceUp = darkBoard({ da: "faceUp" });
  refused(() => flipDark(faceUp), "a face-up card in play");
});

clause(DARK, "1:flipUp", "FLIP UP of a tactic works in response on my opponent's turn but not outside a response window", () => {
  const g = darkBoard({ da: "faceDown", turn: 2, active: P2 });
  refused(() => flipDark(g), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("da")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipDark(g);
  darkPlays(g, "dChar");
  assert.equal(zoneOf(g.engine, g.id("da")), "discard", "flipped up in response to the attack");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play");
});

clause(DARK, "1:flipUp", "a face-down Dark Awakening that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = darkBoard({ da: "faceDown", daSpent: true });
  flipDark(g);
  darkPlays(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("da")), "discard");
});

clause(DARK, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = darkBoard({ da: "faceDown", extra: [{ key: "mover", def: moverTactic("discard"), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipDark(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(pending(g.engine), undefined, "the effect (the 'may play' prompt) has not happened yet");
});


// =================================================================================
// Dying Hero
// At the end of your turn, if this card is depleted, inflict 1 damage to it.
// [R][R][R][R][R][R][R][R][R]: This card gains 4 life.
// Character (soldier), cost 1, [R], 5 strength / 3 speed / 1 life.
// =================================================================================

const HERO = "5feab281-375b-4cc3-ac68-98682fef7738";

/** The amounts of every `damageDealt` event aimed at `cardId` so far, in order. */
function damageAmounts(engine: SpoilsEngine, cardId: CardInstanceId): number[] {
  return engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; targetId?: string; amount?: number } | undefined)
    .filter((event) => event?.type === "damageDealt" && event.targetId === cardId)
    .map((event) => event!.amount as number);
}

/** A free tactic (id "rs", pick "t"): restores the picked card in play. */
function restoreTactic(name = "Refresh"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "rs", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** An item that attaches to a character and adds `amount` life to it. */
function lifeGear(amount: number, name = `Life Gear ${amount}`): CardDefinition {
  return item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "lg", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: amount }] }] }
  });
}

function heroBoard(
  opts: {
    hero?: "play" | "hand" | "discard" | "faceDown";
    depleted?: boolean;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.hero ?? "play";
  return devBoard(
    [
      {
        key: "hero",
        def: printing(HERO),
        owner: P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        depleted: opts.depleted
      },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type HeroGame = ReturnType<typeof heroBoard>;
const heroLife = (g: HeroGame) => g.engine.getStat(g.id("hero"), "life");

// --- 0:rule: end-of-turn damage ----------------------------------------------------------------

clause(HERO, "0:rule", "at the end of my turn a depleted Dying Hero takes 1 damage: with 1 life it is destroyed and goes to its owner's discard pile", () => {
  const g = heroBoard({ depleted: true });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("hero")), "discardOf(g.engine, P1).includes(g.id(\"hero\"))");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), [1], "exactly 1 damage was inflicted to it");
});

clause(HERO, "0:rule", "the damage is exactly 1: with 2 extra life it takes 1 damage and survives the turn change", () => {
  const g = heroBoard({ depleted: true, extra: [{ key: "gear", def: lifeGear(2), owner: P1, zone: "play", attachedToKey: "hero" }] });
  assert.equal(heroLife(g), 3, "control: the gear gives +2 life");
  endTurn(g.engine, P1);
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), [1], "one instance of 1 damage");
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
});

clause(HERO, "0:rule", "a Dying Hero that is NOT depleted at the end of my turn takes no damage", () => {
  const g = heroBoard({ depleted: false });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
});

clause(HERO, "0:rule", "only the Hero itself is hurt: a depleted ally is not damaged", () => {
  const g = heroBoard({ depleted: true });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "discard", "control: the Hero took its damage");
  assert.deepEqual(damageAmounts(g.engine, g.id("ally")), []);
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
});

clause(HERO, "0:rule", "'your turn': at the end of MY OPPONENT's turn a depleted Hero of mine takes no damage", () => {
  const g = heroBoard({ depleted: true, turn: 2, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
});

clause(HERO, "0:rule", "'your' is the Hero's controller: a Hero I own but my opponent controls takes the damage at the end of THEIR turn", () => {
  const theirTurn = heroBoard({ depleted: true, controller: P2, turn: 2, active: P2 });
  endTurn(theirTurn.engine, P2);
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("hero")), "discard", "destroyed at the end of its controller's turn");
  const myTurn = heroBoard({ depleted: true, controller: P2 });
  endTurn(myTurn.engine, P1);
  assert.equal(zoneOf(myTurn.engine, myTurn.id("hero")), "play", "not at the end of its owner's turn");
  assert.deepEqual(damageAmounts(myTurn.engine, myTurn.id("hero")), []);
});

clause(HERO, "0:rule", "a Hero that attacked this turn is depleted by attacking and takes the damage at the end of the turn", () => {
  const g = heroBoard({ turn: 2 });
  const before = influenceOf(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("hero")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P2), 5, "control: it dealt its 5 damage");
  assert.equal(g.engine.state.cards[g.id("hero")].depleted, true, "control: it is depleted");
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "discard");
});

clause(HERO, "0:rule", "if the Hero is restored before the turn ends it is no longer depleted: no damage", () => {
  const g = heroBoard({ depleted: true, extra: [{ key: "rs", def: restoreTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rs"), { selected: { t: [g.id("hero")] } });
  assert.equal(g.engine.state.cards[g.id("hero")].depleted, false, "control: it was restored");
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
});

clause(HERO, "0:rule", "a Hero in my hand or my discard pile does nothing at the end of my turn", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = heroBoard({ hero: where, depleted: true });
    endTurn(g.engine, P1);
    assert.equal(zoneOf(g.engine, g.id("hero")), where);
    assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
  }
});

clause(HERO, "0:rule", "a face-down Dying Hero is only a resource (CR 411.1): its text is dormant", () => {
  const g = heroBoard({ hero: "faceDown", depleted: true });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
});

clause(HERO, "0:rule", "a Hero with 9 [R] (life 5) that is depleted at the end of my turn takes 1 damage and survives", () => {
  const g = heroBoard({ depleted: true, icons: { rage: 9 } });
  endTurn(g.engine, P1);
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), [1]);
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
});

clause(HERO, "0:rule", "'At the end of your turn' happens after my opponent has finished responding (CR 610.1a): the Hero is still undamaged while they can respond", () => {
  const g = heroBoard({ depleted: true });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.ok(g.engine.state.responseWindow, "control: my opponent has a chance to respond to the end of my turn");
  assert.equal(zoneOf(g.engine, g.id("hero")), "play", "the turn has not ended yet");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), [], "no damage before the turn actually ends");
});

clause(HERO, "0:rule", "'if this card is depleted' is judged when the turn actually ends: a Hero restored in response to the end of my turn takes no damage", () => {
  const g = heroBoard({ depleted: true, extra: [{ key: "rs", def: restoreTactic(), owner: P2, zone: "hand" }] });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(zoneOf(g.engine, g.id("hero")), "play", "the Hero is still in play while my opponent can respond to the end of my turn");
  respondWith(g.engine, P2, g.id("rs"), { t: [g.id("hero")] });
  assert.equal(zoneOf(g.engine, g.id("hero")), "play", "the restored Hero is not depleted when the turn ends");
  assert.deepEqual(damageAmounts(g.engine, g.id("hero")), []);
});

// --- 1:rule@rrrrrrrrr: [R]x9: This card gains 4 life ---------------------------------------------

clause(HERO, "1:rule@rrrrrrrrr", "with 9 [R] it gains 4 life: 5 life in all", () => {
  const g = heroBoard({ icons: { rage: 9 } });
  assert.equal(heroLife(g), 5);
});

clause(HERO, "1:rule@rrrrrrrrr", "with 8 [R] (one short) it has only its printed 1 life", () => {
  const g = heroBoard({ icons: { rage: 8 } });
  assert.equal(heroLife(g), 1);
});

clause(HERO, "1:rule@rrrrrrrrr", "with no [R] it has its printed 1 life", () => {
  const g = heroBoard();
  assert.equal(heroLife(g), 1);
});

clause(HERO, "1:rule@rrrrrrrrr", "more than 9 [R] do not repeat the bonus: 10, 12 and 18 [R] still give just +4 life", () => {
  for (const n of [10, 12, 18]) {
    const g = heroBoard({ icons: { rage: n } });
    assert.equal(heroLife(g), 5, `${n} [R]`);
  }
});

clause(HERO, "1:rule@rrrrrrrrr", "it gains life only: strength stays 5 and speed stays 3", () => {
  const g = heroBoard({ icons: { rage: 9 } });
  assert.equal(g.engine.getStat(g.id("hero"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("hero"), "speed"), 3);
});

clause(HERO, "1:rule@rrrrrrrrr", "only [R] count: nine resources of other icons, or Volition, do not turn it on", () => {
  const other9 = heroBoard({ icons: { rage: 4, greed: 5, deception: 5 } });
  assert.equal(heroLife(other9), 1, "four [R] and ten other icons");
  const down = heroBoard({ icons: { rage: 4 }, extra: volition(8) });
  assert.equal(heroLife(down), 1, "four [R] and eight Volition");
});

clause(HERO, "1:rule@rrrrrrrrr", "spent [R] still count toward the threshold (icons are never spent)", () => {
  const g = heroBoard({ extra: spentRage(9) });
  assert.equal(heroLife(g), 5);
});

clause(HERO, "1:rule@rrrrrrrrr", "an Embittered Cadet's [R] counts: eight Rage plus a Cadet in play turn it on", () => {
  const g = heroBoard({ icons: { rage: 8 }, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "play" }] });
  assert.equal(heroLife(g), 5);
});

clause(HERO, "1:rule@rrrrrrrrr", "my opponent's [R] do not count toward my threshold", () => {
  const g = heroBoard({ icons: { rage: 4 }, oppIcons: { rage: 9 } });
  assert.equal(heroLife(g), 1);
});

clause(HERO, "1:rule@rrrrrrrrr", "it turns off again the moment I stop meeting the threshold: bounce one of nine Rage and the life is back to 1", () => {
  const g = heroBoard({ icons: { rage: 9 }, extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(heroLife(g), 5, "control: on with nine");
  const rage = playOf(g.engine, P1).filter((cid) => g.engine.getDefinition(cid).resource?.provides?.includes("rage"))[0];
  play(g.engine, P1, g.id("bounce"), { selected: { t: [rage] } });
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 8);
  assert.equal(heroLife(g), 1, "off with eight");
});

clause(HERO, "1:rule@rrrrrrrrr", "the extra life really protects: with 9 [R] it survives 4 damage; without them 1 damage destroys it", () => {
  const on = heroBoard({ icons: { rage: 9 }, extra: [{ key: "hit", def: damageTactic(4), owner: P1, zone: "hand" }] });
  play(on.engine, P1, on.id("hit"), { selected: { t: [on.id("hero")] } });
  assert.equal(zoneOf(on.engine, on.id("hero")), "play");
  assert.equal(damageOf(on.engine, on.id("hero")), 4);
  const off = heroBoard({ extra: [{ key: "hit", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(off.engine, P1, off.id("hit"), { selected: { t: [off.id("hero")] } });
  assert.equal(zoneOf(off.engine, off.id("hero")), "discard");
});

clause(HERO, "1:rule@rrrrrrrrr", "when the threshold stops holding, damage already taken can destroy it (4 damage on a Hero that falls back to 1 life)", () => {
  const g = heroBoard({ icons: { rage: 9 }, extra: [{ key: "hit", def: damageTactic(4), owner: P1, zone: "hand" }, { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("hero")] } });
  assert.equal(zoneOf(g.engine, g.id("hero")), "play", "control: it survived with 5 life");
  const rage = playOf(g.engine, P1).filter((cid) => g.engine.getDefinition(cid).resource?.provides?.includes("rage"))[0];
  play(g.engine, P1, g.id("bounce"), { selected: { t: [rage] } });
  assert.equal(zoneOf(g.engine, g.id("hero")), "discard", "4 damage against 1 life");
});

clause(HERO, "1:rule@rrrrrrrrr", "'your' [R]: a Hero I own but my opponent controls uses THEIR [R], not mine", () => {
  const theirs = heroBoard({ controller: P2, oppIcons: { rage: 9 } });
  assert.equal(heroLife(theirs), 5);
  const mine = heroBoard({ controller: P2, icons: { rage: 9 } });
  assert.equal(heroLife(mine), 1);
});

clause(HERO, "1:rule@rrrrrrrrr", "a Hero outside play has its printed life: nothing from the threshold paragraph applies in hand", () => {
  const g = heroBoard({ hero: "hand", icons: { rage: 9 } });
  assert.equal(heroLife(g), 1);
});

clause(HERO, "1:rule@rrrrrrrrr", "it deploys for 1 with [R] and has 5/3/1 stats", () => {
  const g = heroBoard({ hero: "hand", icons: { rage: 1 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("hero"));
  assert.equal(zoneOf(g.engine, g.id("hero")), "play");
  assert.equal(before - ready(g.engine), 1);
  assert.equal(g.engine.getStat(g.id("hero"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("hero"), "speed"), 3);
  assert.equal(heroLife(g), 1);
  const none = heroBoard({ hero: "hand", icons: { greed: 3 } });
  refused(() => playRaw(none.engine, P1, none.id("hero")), "no [R]");
});


// =================================================================================
// Embittered Cadet
// PROVIDES: [R]
// Character (soldier), cost 3, [R], 3 strength / 3 speed / 2 life.
// =================================================================================

function cadetBoard(
  opts: {
    cadet?: "play" | "hand" | "discard" | "deck" | "faceDown";
    controller?: PlayerId;
    depleted?: boolean;
    cadets?: number;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.cadet ?? "play";
  const more = Array.from({ length: Math.max(0, (opts.cadets ?? 1) - 1) }, (_, i) => ({
    key: `cadet${i + 2}`,
    def: printing(CADET),
    owner: P1,
    zone: "play" as const
  }));
  return devBoard(
    [
      {
        key: "cadet",
        def: printing(CADET),
        owner: P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        depleted: opts.depleted
      },
      ...more,
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type CadetGame = ReturnType<typeof cadetBoard>;
const iconsOf = (g: CadetGame, player: PlayerId = P1) => g.engine.getThresholds(player);

/** A free character that needs [R] (threshold r), to show what the Cadet's icon can pay for. */
const needsRage = (name = "Needs Rage", threshold = "r"): CardDefinition => character({ name, cost: 0, threshold, strength: 1, life: 1 });

clause(CADET, "0:provides", "in play it provides exactly one [R] and no other icon", () => {
  const g = cadetBoard();
  const icons = iconsOf(g);
  assert.equal(icons.rage ?? 0, 1);
  for (const icon of ["greed", "deception", "elitism", "obsession", "volition"] as const) assert.equal(icons[icon] ?? 0, 0, `no ${icon}`);
});

clause(CADET, "0:provides", "two Cadets in play provide two [R]", () => {
  const g = cadetBoard({ cadets: 2 });
  assert.equal(iconsOf(g).rage ?? 0, 2);
  const three = cadetBoard({ cadets: 3 });
  assert.equal(iconsOf(three).rage ?? 0, 3);
});

clause(CADET, "0:provides", "its [R] is added to my Rage resources: two Rage and a Cadet make three [R]", () => {
  const g = cadetBoard({ icons: { rage: 2 } });
  assert.equal(iconsOf(g).rage ?? 0, 3);
});

clause(CADET, "0:provides", "its [R] meets a threshold: a [R] card can be deployed with only the Cadet providing it, and is refused without it", () => {
  const withCadet = cadetBoard({ extra: [{ key: "need", def: needsRage(), owner: P1, zone: "hand" }] });
  play(withCadet.engine, P1, withCadet.id("need"));
  assert.equal(zoneOf(withCadet.engine, withCadet.id("need")), "play");
  const without = cadetBoard({ cadet: "hand", extra: [{ key: "need", def: needsRage(), owner: P1, zone: "hand" }] });
  refused(() => playRaw(without.engine, P1, without.id("need")), "no [R] without the Cadet");
  assert.equal(zoneOf(without.engine, without.id("need")), "hand");
});

clause(CADET, "0:provides", "one Cadet provides one [R] only: a [R][R] card is refused with one Cadet and deployed with two", () => {
  const one = cadetBoard({ extra: [{ key: "need", def: needsRage("Needs Two Rage", "rr"), owner: P1, zone: "hand" }] });
  refused(() => playRaw(one.engine, P1, one.id("need")), "one [R] for [R][R]");
  const two = cadetBoard({ cadets: 2, extra: [{ key: "need", def: needsRage("Needs Two Rage", "rr"), owner: P1, zone: "hand" }] });
  play(two.engine, P1, two.id("need"));
  assert.equal(zoneOf(two.engine, two.id("need")), "play");
  const mixed = cadetBoard({ icons: { rage: 1 }, extra: [{ key: "need", def: needsRage("Needs Two Rage", "rr"), owner: P1, zone: "hand" }] });
  play(mixed.engine, P1, mixed.id("need"));
  assert.equal(zoneOf(mixed.engine, mixed.id("need")), "play", "a Rage resource plus the Cadet make [R][R]");
});

clause(CADET, "0:provides", "it provides [R] to its controller only: my opponent does not get the icon", () => {
  const g = cadetBoard();
  assert.equal(iconsOf(g, P2).rage ?? 0, 0);
});

clause(CADET, "0:provides", "the icon comes from being IN PLAY: a Cadet in my hand, my discard pile or my deck provides nothing", () => {
  for (const where of ["hand", "discard", "deck"] as const) {
    const g = cadetBoard({ cadet: where });
    assert.equal(iconsOf(g).rage ?? 0, 0, `Cadet in ${where}`);
  }
});

clause(CADET, "0:provides", "a face-down Cadet is only a resource (CR 411.1): it provides Volition, not [R]", () => {
  const g = cadetBoard({ cadet: "faceDown" });
  assert.equal(iconsOf(g).rage ?? 0, 0);
  assert.equal(iconsOf(g).volition ?? 0, 1);
});

clause(CADET, "0:provides", "a depleted Cadet still provides [R]", () => {
  const g = cadetBoard({ depleted: true });
  assert.equal(iconsOf(g).rage ?? 0, 1);
});

clause(CADET, "0:provides", "it stops providing [R] when it leaves play (destroyed)", () => {
  const g = cadetBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(iconsOf(g).rage ?? 0, 1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("cadet")] } });
  assert.equal(zoneOf(g.engine, g.id("cadet")), "discard");
  assert.equal(iconsOf(g).rage ?? 0, 0);
});

clause(CADET, "0:provides", "it stops providing [R] when it is returned to its owner's hand", () => {
  const g = cadetBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("cadet")] } });
  assert.equal(zoneOf(g.engine, g.id("cadet")), "hand");
  assert.equal(iconsOf(g).rage ?? 0, 0);
});

clause(CADET, "0:provides", "the icon follows control: a Cadet I take from my opponent provides [R] to me and no longer to them", () => {
  const g = cadetBoard({
    cadet: "play",
    extra: [{ key: "theirs", def: printing(CADET), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }]
  });
  assert.equal(iconsOf(g, P2).rage ?? 0, 1, "control: it provides [R] to its original controller");
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("theirs")] } });
  assert.equal(iconsOf(g, P1).rage ?? 0, 2);
  assert.equal(iconsOf(g, P2).rage ?? 0, 0);
});

clause(CADET, "0:provides", "a Cadet is a character, not a resource card: it cannot be spent to pay a cost, so it adds no ready resource", () => {
  const g = cadetBoard({ cadets: 2, icons: { greed: 1 } });
  assert.equal(ready(g.engine), 1, "only the Greed is a resource I can spend");
  assert.equal(g.engine.isResource(g.id("cadet")), false);
  const pay = tactic({ name: "Costs One", cost: 1 });
  const broke = cadetBoard({ cadets: 2, extra: [{ key: "pay", def: pay, owner: P1, zone: "hand" }] });
  refused(() => playRaw(broke.engine, P1, broke.id("pay")), "two Cadets cannot pay for a cost-1 tactic");
  assert.equal(zoneOf(broke.engine, broke.id("pay")), "hand");
});

clause(CADET, "0:provides", "while it is being deployed (before it resolves) it does not provide [R] yet; once it has entered play it does", () => {
  const g = cadetBoard({ cadet: "hand", icons: { rage: 3 } });
  playRaw(g.engine, P1, g.id("cadet"));
  assert.equal(zoneOf(g.engine, g.id("cadet")), "deploying");
  assert.equal(iconsOf(g).rage ?? 0, 3, "the Rage resources only");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play");
  assert.equal(iconsOf(g).rage ?? 0, 4, "the Cadet now provides its [R]");
});

clause(CADET, "0:provides", "deployed from hand it costs 3 and needs [R]: exactly three ready resources with one [R] are enough", () => {
  const g = cadetBoard({ cadet: "hand", icons: { rage: 1, greed: 2 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("cadet"));
  assert.equal(zoneOf(g.engine, g.id("cadet")), "play");
  assert.equal(before - ready(g.engine), 3);
});

clause(CADET, "0:provides", "deployed from hand: two ready resources are refused, and three resources without [R] are refused", () => {
  const short = cadetBoard({ cadet: "hand", icons: { rage: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("cadet")), "two resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("cadet")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was paid");
  const noRage = cadetBoard({ cadet: "hand", icons: { greed: 5 } });
  refused(() => playRaw(noRage.engine, P1, noRage.id("cadet")), "no [R]");
  const down = cadetBoard({ cadet: "hand", icons: { greed: 1 }, extra: volition(4) });
  refused(() => playRaw(down.engine, P1, down.id("cadet")), "Volition is not [R]");
});

clause(CADET, "0:provides", "it enters play with its printed stats: 3 strength, 3 speed, 2 life, a soldier", () => {
  const g = cadetBoard({ cadet: "hand", icons: { rage: 3 } });
  play(g.engine, P1, g.id("cadet"));
  assert.equal(g.engine.getStat(g.id("cadet"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("cadet"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("cadet"), "life"), 2);
  assert.deepEqual(printing(CADET).subtype, ["soldier"]);
});


// =================================================================================
// Epic Smackdown
// COST: Choose a number for X. Destroy X characters you control.
// EFFECT: If your opponent controls at least X characters, they destroy X characters they
// control. Otherwise, destroy all your opponent's characters. Draw a card.
// Tactic, cost 3, [R][R].
// =================================================================================

const SMACK = "0642737a-cb86-402f-bca9-293ea6c252cc";

function smackBoard(
  opts: {
    mine?: number;
    theirs?: number;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    deck?: number;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "es", def: printing(SMACK), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.mine ?? 3 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine ${i}`, life: 9 }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: opts.theirs ?? 3 }, (_, i) => ({ key: `t${i}`, def: character({ name: `Theirs ${i}`, life: 9 }), owner: P2, zone: "play" as const })),
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "myPlace", def: location({ name: "My Place", structure: 9 }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "theirPlace", def: location({ name: "Their Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "myHand", def: character({ name: "My Hand Character" }), owner: P1, zone: "hand" },
      { key: "myDisc", def: character({ name: "My Discarded Character" }), owner: P1, zone: "discard" },
      ...fillers("dk", opts.deck ?? 3, P1, "deck"),
      ...res(opts.icons ?? { rage: 8 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: mulberry(11) }
  );
}

type SmackGame = ReturnType<typeof smackBoard>;

const smackSel = (g: SmackGame, sac: string[]) => ({ sacX: sac.map((k) => g.id(k)) });
/** Plays Epic Smackdown with X and the characters I sacrifice (stops at the first pending choice). */
const smack = (g: SmackGame, x: number, sac: string[]) => play(g.engine, P1, g.id("es"), { variables: { x }, selected: smackSel(g, sac) });
const smackAttempt = (g: SmackGame, x: number, sac: string[]) => () => playRaw(g.engine, P1, g.id("es"), { variables: { x }, selected: smackSel(g, sac) });

/** My opponent answers the "destroy X characters they control" prompt with `keys`. */
function theyDestroy(g: SmackGame, keys: string[]): void {
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent makes this choice");
  answerPending(g.engine, "chooserSelectsTarget", { selected: keys.map((k) => g.id(k)) });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

/** Answers the opponent's prompt when there is one (for tests that do not care how they choose). */
function theyDestroyIfAsked(g: SmackGame, keys: string[]): void {
  if (pending(g.engine)) theyDestroy(g, keys);
}

const alive = (g: SmackGame, keys: string[]) => keys.filter((k) => zoneOf(g.engine, g.id(k)) === "play");

clause(SMACK, "0:ability", "X = 1: I destroy one of my characters, my opponent destroys one of theirs (their choice), I draw a card and Smackdown ends in my discard pile", () => {
  const g = smackBoard();
  const top = deckOf(g.engine, P1)[0];
  smack(g, 1, ["m0"]);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "my sacrificed character is destroyed");
  theyDestroy(g, ["t1"]);
  assert.equal(zoneOf(g.engine, g.id("t1")), "discard", "their chosen character is destroyed");
  assert.deepEqual(alive(g, ["t0", "t1", "t2"]), ["t0", "t2"], "the other two stay");
  assert.deepEqual(alive(g, ["m0", "m1", "m2"]), ["m1", "m2"]);
  assert.equal(zoneOf(g.engine, top), "hand", "Draw a card");
  assert.equal(zoneOf(g.engine, g.id("es")), "discard");
});

clause(SMACK, "0:ability", "my opponent chooses WHICH of their characters: a different choice destroys a different character", () => {
  for (const pick of ["t0", "t1", "t2"]) {
    const g = smackBoard();
    smack(g, 1, ["m0"]);
    theyDestroy(g, [pick]);
    assert.equal(zoneOf(g.engine, g.id(pick)), "discard", `${pick} was their choice`);
    assert.equal(alive(g, ["t0", "t1", "t2"]).length, 2);
  }
});

clause(SMACK, "0:ability", "X = 2: I destroy two of my characters, my opponent destroys two of their three and one of theirs survives", () => {
  const g = smackBoard();
  smack(g, 2, ["m0", "m2"]);
  assert.deepEqual(alive(g, ["m0", "m1", "m2"]), ["m1"], "the two sacrificed characters are gone");
  theyDestroy(g, ["t0", "t2"]);
  assert.deepEqual(alive(g, ["t0", "t1", "t2"]), ["t1"]);
});

clause(SMACK, "0:ability", "X = 3 against exactly 3 characters: they control at least X, so they destroy 3 characters (all of them)", () => {
  const g = smackBoard();
  smack(g, 3, ["m0", "m1", "m2"]);
  theyDestroyIfAsked(g, ["t0", "t1", "t2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(alive(g, ["m0", "m1", "m2", "t0", "t1", "t2"]), []);
});

clause(SMACK, "0:ability", "my opponent has fewer than X characters: 'otherwise' destroy all of them, with no choice for them, and I still draw", () => {
  const g = smackBoard({ theirs: 1 });
  const top = deckOf(g.engine, P1)[0];
  smack(g, 2, ["m0", "m1"]);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing to choose: all of them are destroyed");
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard");
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(SMACK, "0:ability", "my opponent has fewer than X characters (2 of 3): all of their characters are destroyed", () => {
  const g = smackBoard({ theirs: 2 });
  smack(g, 3, ["m0", "m1", "m2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(alive(g, ["t0", "t1"]), []);
});

clause(SMACK, "0:ability", "my opponent has no characters at all and X is 1: nothing to destroy, but the card is still drawn", () => {
  const g = smackBoard({ theirs: 0 });
  const top = deckOf(g.engine, P1)[0];
  smack(g, 1, ["m0"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, top), "hand");
  assert.equal(zoneOf(g.engine, g.id("es")), "discard");
});

clause(SMACK, "0:ability", "X = 0: I destroy none, they control at least 0 so they destroy none, and I draw a card (the game does not stall)", () => {
  const g = smackBoard();
  const top = deckOf(g.engine, P1)[0];
  smack(g, 0, []);
  theyDestroyIfAsked(g, []); // destroying 0 characters: if the engine asks my opponent anyway, they pick nothing
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt is left open");
  assert.equal(alive(g, ["m0", "m1", "m2", "t0", "t1", "t2"]).length, 6, "nobody was destroyed");
  assert.equal(zoneOf(g.engine, top), "hand");
  assert.equal(zoneOf(g.engine, g.id("es")), "discard");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "the game goes on");
});

clause(SMACK, "0:ability", "X = 0 against an empty board: still resolves, draws, and ends in my discard pile", () => {
  const g = smackBoard({ theirs: 0, mine: 0 });
  const top = deckOf(g.engine, P1)[0];
  smack(g, 0, []);
  theyDestroyIfAsked(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "hand");
});

clause(SMACK, "0:ability", "'Draw a card' draws exactly one card in either branch", () => {
  const g = smackBoard({ deck: 4 });
  const before = deckOf(g.engine, P1).length;
  smack(g, 1, ["m0"]);
  theyDestroy(g, ["t0"]);
  assert.equal(before - deckOf(g.engine, P1).length, 1);
  const o = smackBoard({ theirs: 0, deck: 4 });
  smack(o, 1, ["m0"]);
  assert.equal(4 - deckOf(o.engine, P1).length, 1);
});

clause(SMACK, "0:ability", "with an empty deck the failed draw costs nothing (CR 306.2) and the rest still happens", () => {
  const g = smackBoard({ deck: 0 });
  assert.equal(deckOf(g.engine, P1).length, 0);
  smack(g, 1, ["m0"]);
  theyDestroy(g, ["t0"]);
  assert.equal(g.engine.state.result, undefined);
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard");
});

clause(SMACK, "0:ability", "the cost is paid when it is played: my sacrificed characters are already destroyed while my opponent can still respond", () => {
  const g = smackBoard();
  smackAttempt(g, 2, ["m0", "m1"])();
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(alive(g, ["t0", "t1", "t2"]).length, 3, "their characters are still there");
  assert.equal(zoneOf(g.engine, g.id("es")), "deploying");
});

clause(SMACK, "0:ability", "characters destroyed as the COST are really destroyed: a 'when a card is destroyed' watcher sees them", () => {
  const watcher = character({
    name: "Grave Watcher",
    life: 9,
    behavior: { abilities: [{ id: "watch", type: "triggered", event: "cardDestroyed", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] }
  });
  const g = smackBoard({ extra: [{ key: "watcher", def: watcher, owner: P1, zone: "play" }] });
  smackAttempt(g, 1, ["m0"])();
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "control: my character was destroyed as the cost");
  assert.equal(influenceOf(g.engine, P2), START - 1, "the watcher saw one character being destroyed");
});

clause(SMACK, "0:ability", "its own cost of 3 is paid too (3 resources)", () => {
  const g = smackBoard();
  const before = ready(g.engine);
  smackAttempt(g, 1, ["m0"])();
  assert.equal(before - ready(g.engine), 3);
});

clause(SMACK, "0:ability", "exactly X characters must be destroyed: too few picks (1 for X = 2) or too many (2 for X = 1) are refused and nothing is destroyed", () => {
  const g = smackBoard();
  refused(smackAttempt(g, 2, ["m0"]), "one pick for X = 2");
  refused(smackAttempt(g, 1, ["m0", "m1"]), "two picks for X = 1");
  refused(smackAttempt(g, 1, []), "no pick for X = 1");
  assert.equal(alive(g, ["m0", "m1", "m2"]).length, 3, "nothing was destroyed");
  assert.equal(zoneOf(g.engine, g.id("es")), "hand");
  assert.equal(ready(g.engine), 8, "nothing was paid");
  smack(g, 2, ["m0", "m1"]);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "control: two picks for X = 2 work");
});

clause(SMACK, "0:ability", "I cannot destroy more characters than I control: X = 3 with only two characters is refused", () => {
  const g = smackBoard({ mine: 2 });
  refused(smackAttempt(g, 3, ["m0", "m1"]), "X = 3 with two characters");
  refused(smackAttempt(g, 3, ["m0", "m1", "t0"]), "padding with their character");
  assert.equal(alive(g, ["m0", "m1"]).length, 2);
  assert.equal(ready(g.engine), 8);
});

clause(SMACK, "0:ability", "the characters destroyed must be characters I control: theirs, my items, locations, face-down cards and cards outside play are refused", () => {
  const g = smackBoard({ extra: [{ key: "fd", def: character({ name: "My Hidden Character", life: 9 }), owner: P1, zone: "play", faceDown: true }] });
  const before = ready(g.engine);
  for (const [what, key] of [
    ["their character", "t0"],
    ["my item", "myItem"],
    ["my location", "myPlace"],
    ["my face-down card", "fd"],
    ["a character in my hand", "myHand"],
    ["a character in my discard pile", "myDisc"]
  ] as const) {
    refused(smackAttempt(g, 1, [key]), what);
  }
  refused(() => playRaw(g.engine, P1, g.id("es"), { variables: { x: 1 }, selected: { sacX: [g.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(g.engine, g.id("es")), "hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  smack(g, 1, ["m0"]);
  assert.equal(zoneOf(g.engine, g.id("m0")), "discard", "control: my own character works");
});

clause(SMACK, "0:ability", "the same character cannot be picked twice for X = 2", () => {
  const g = smackBoard();
  refused(smackAttempt(g, 2, ["m0", "m0"]), "the same character twice");
  assert.equal(zoneOf(g.engine, g.id("m0")), "play");
  assert.equal(ready(g.engine), 8);
});

clause(SMACK, "0:ability", "'characters you control': a character I took from my opponent can be destroyed, and goes to ITS OWNER's discard pile", () => {
  const g = smackBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", life: 9 }), owner: P2, controller: P1, zone: "play" }] });
  smack(g, 1, ["stolen"]);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("stolen")), "its owner's discard pile");
  assert.equal(discardOf(g.engine, P1).includes(g.id("stolen")), false);
});

clause(SMACK, "0:ability", "'characters you control': a character I own but my opponent controls cannot be destroyed as my cost", () => {
  const g = smackBoard({ extra: [{ key: "lent", def: character({ name: "Lent", life: 9 }), owner: P1, controller: P2, zone: "play" }] });
  refused(smackAttempt(g, 1, ["lent"]), "a character my opponent controls");
  assert.equal(zoneOf(g.engine, g.id("lent")), "play");
});

clause(SMACK, "0:ability", "my opponent's 'characters they control' counts the ones they control, not own: a character they took from me counts for them", () => {
  const g = smackBoard({ theirs: 1, extra: [{ key: "lentTo", def: character({ name: "Lent To Them", life: 9 }), owner: P1, controller: P2, zone: "play" }] });
  smack(g, 2, ["m0", "m1"]);
  theyDestroyIfAsked(g, ["t0", "lentTo"]);
  assert.equal(zoneOf(g.engine, g.id("lentTo")), "discard", "destroyed (into its owner's discard pile)");
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("lentTo")), "discardOf(g.engine, P1).includes(g.id(\"lentTo\"))");
});

clause(SMACK, "0:ability", "CR 506.2: destroying a Surplus Soldier as a COST is not replaced: it goes to the discard pile instead of flipping face-down", () => {
  const g = smackBoard({ extra: [{ key: "ss", def: printing(SURPLUS), owner: P1, zone: "play" }] });
  smack(g, 1, ["ss"]);
  theyDestroy(g, ["t0"]);
  assert.equal(zoneOf(g.engine, g.id("ss")), "discard", "destroyed as a cost: no replacement");
  assert.equal(g.engine.state.cards[g.id("ss")].faceDown, false);
});

clause(SMACK, "0:ability", "...but their Surplus Soldier destroyed by the EFFECT is replaced: it flips face-down and stays in play", () => {
  const g = smackBoard({ theirs: 2, extra: [{ key: "tss", def: printing(SURPLUS), owner: P2, zone: "play" }] });
  smack(g, 1, ["m0"]);
  theyDestroy(g, ["tss"]);
  assert.equal(zoneOf(g.engine, g.id("tss")), "play", "still in play");
  assert.equal(g.engine.state.cards[g.id("tss")].faceDown, true, "flipped face-down instead of destroyed");
});

clause(SMACK, "0:ability", "my opponent makes the choice, not me: I cannot answer the prompt", () => {
  const g = smackBoard();
  smack(g, 1, ["m0"]);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("t0")] } } as never),
    "the prompt belongs to my opponent",
    /./
  );
  assert.ok(pending(g.engine), "the prompt is still open");
  theyDestroy(g, ["t0"]);
});

clause(SMACK, "0:ability", "my opponent must destroy exactly X: one pick for X = 2, three picks for X = 2 and declining are refused", () => {
  const g = smackBoard();
  smack(g, 2, ["m0", "m1"]);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0")] }), "one pick for X = 2");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0"), g.id("t1"), g.id("t2")] }), "three picks for X = 2");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to destroy");
  assert.ok(pending(g.engine), "the prompt is still open");
  assert.equal(alive(g, ["t0", "t1", "t2"]).length, 3, "nothing was destroyed");
  theyDestroy(g, ["t0", "t1"]);
  assert.deepEqual(alive(g, ["t0", "t1", "t2"]), ["t2"]);
});

clause(SMACK, "0:ability", "my opponent can only destroy THEIR characters: my characters, their items, their locations and their face-down cards are refused", () => {
  const g = smackBoard({ extra: [{ key: "theirHidden", def: character({ name: "Their Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  smack(g, 1, ["m0"]);
  for (const key of ["m1", "myItem", "theirItem", "theirPlace", "theirHidden"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), `${key} is not a character they control`);
  }
  assert.ok(pending(g.engine), "the prompt is still open");
  theyDestroy(g, ["t1"]);
  assert.equal(zoneOf(g.engine, g.id("m1")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
});

clause(SMACK, "0:ability", "'otherwise' destroys only my opponent's CHARACTERS: their items, locations and face-down cards stay, and so do mine", () => {
  const g = smackBoard({ theirs: 1, extra: [{ key: "theirHidden", def: character({ name: "Their Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  smack(g, 2, ["m0", "m1"]);
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard", "control: their only character was destroyed");
  for (const key of ["theirItem", "theirPlace", "theirHidden", "myItem", "myPlace", "m2"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

clause(SMACK, "0:ability", "the faction cards are not characters: nobody's faction is destroyed or hurt", () => {
  const g = smackBoard({ theirs: 1 });
  smack(g, 2, ["m0", "m1"]);
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(influenceOf(g.engine, P2), START);
  assert.equal(zoneOf(g.engine, g.engine.state.players[P2].factionId!), "play");
});

clause(SMACK, "0:ability", "'at least X' is judged when it RESOLVES: characters my opponent gets in response count (1 at the start, 3 at the end, X = 2 means they choose 2 of 3)", () => {
  const reinforce = tactic({
    name: "Reinforce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rf",
          type: "activated",
          targets: [
            { id: "a", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 },
            { id: "b", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }
          ],
          effects: [
            { type: "putIntoPlay", target: { type: "selected", id: "a" }, controller: "controller" },
            { type: "putIntoPlay", target: { type: "selected", id: "b" }, controller: "controller" }
          ]
        }
      ]
    }
  });
  const g = smackBoard({
    theirs: 1,
    extra: [
      { key: "rf", def: reinforce, owner: P2, zone: "hand" },
      { key: "ra", def: character({ name: "Reinforcement A", life: 9 }), owner: P2, zone: "hand" },
      { key: "rb", def: character({ name: "Reinforcement B", life: 9 }), owner: P2, zone: "hand" }
    ]
  });
  smackAttempt(g, 2, ["m0", "m1"])();
  respondWith(g.engine, P2, g.id("rf"), { a: [g.id("ra")], b: [g.id("rb")] });
  assert.equal(zoneOf(g.engine, g.id("ra")), "play", "control: the reinforcements arrived");
  theyDestroy(g, ["t0", "ra"]);
  assert.deepEqual(alive(g, ["t0", "ra", "rb"]), ["rb"], "they chose two of their three characters; one survives");
});

clause(SMACK, "0:ability", "threshold [R][R]: one [R] among many other resources is refused, two are accepted", () => {
  const one = smackBoard({ icons: { rage: 1, greed: 6 } });
  refused(smackAttempt(one, 1, ["m0"]), "one [R]");
  assert.equal(zoneOf(one.engine, one.id("m0")), "play", "nothing was destroyed");
  assert.equal(zoneOf(one.engine, one.id("es")), "hand");
  const none = smackBoard({ icons: { greed: 8 } });
  refused(smackAttempt(none, 1, ["m0"]), "no [R]");
  const two = smackBoard({ icons: { rage: 2, greed: 1 } });
  smack(two, 1, ["m0"]);
  assert.equal(zoneOf(two.engine, two.id("m0")), "discard", "control: two [R] and three resources");
});

clause(SMACK, "0:ability", "cost 3: two ready resources are refused (nothing is destroyed or paid), three are enough", () => {
  const short = smackBoard({ icons: { rage: 2 } });
  refused(smackAttempt(short, 1, ["m0"]), "two resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("m0")), "play", "no character was sacrificed");
  assert.equal(ready(short.engine), 2);
  const enough = smackBoard({ icons: { rage: 3 } });
  smack(enough, 1, ["m0"]);
  assert.equal(zoneOf(enough.engine, enough.id("m0")), "discard");
});

clause(SMACK, "0:ability", "face-down cards provide Volition, not [R], and an opponent's [R] do not count toward my threshold", () => {
  const down = smackBoard({ icons: { rage: 1 }, extra: volition(6) });
  refused(smackAttempt(down, 1, ["m0"]), "one [R] and six Volition");
  const theirs = smackBoard({ icons: { rage: 1, greed: 5 }, oppIcons: { rage: 4 } });
  refused(smackAttempt(theirs, 1, ["m0"]), "only one [R] of my own");
});

clause(SMACK, "0:ability", "'Choose a number for X' must be a whole number (CR 410.2): X = 1.5 is refused and nothing is paid or destroyed", () => {
  const g = smackBoard();
  refused(smackAttempt(g, 1.5, ["m0"]), "a fractional X");
  assert.equal(zoneOf(g.engine, g.id("m0")), "play", "nothing was destroyed");
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

clause(SMACK, "0:ability", "'Choose a number for X' cannot be negative: X = -1 is refused and nothing is paid", () => {
  const g = smackBoard();
  refused(smackAttempt(g, -1, []), "a negative X");
  assert.equal(zoneOf(g.engine, g.id("es")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(SMACK, "0:ability", "'Choose a number for X' is a cost: playing without choosing a number is refused instead of silently using X = 0", () => {
  const g = smackBoard();
  refused(() => playRaw(g.engine, P1, g.id("es"), { selected: smackSel(g, []) }), "no number chosen for X");
  assert.equal(zoneOf(g.engine, g.id("es")), "hand");
});

clause(SMACK, "0:ability", "as a tactic it can be played in response on my opponent's turn", () => {
  const g = smackBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", life: 9 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("es"), { variables: { x: 1 }, selected: smackSel(g, ["m0"]) });
  resolvePendingResponses(g.engine);
  theyDestroy(g, ["atk"]);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.equal(zoneOf(g.engine, g.id("es")), "discard");
});


// =================================================================================
// Implosive Explosion
// COST: Reveal a face-down resource card you control. X is its numeric cost. Destroy it.
// Pick a character or location.
// EFFECT: Inflict X damage to the character or location. Put this card into play under
// its owner's control as a face-down resource instead of into their discard pile.
// Tactic, cost 3, [R].
// =================================================================================

const IMPLO = "5384f0ca-4c8b-42a9-870b-de4ffb5229be";

function imploBoard(
  opts: {
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
    /** Only these face-down cards of mine are on the board (default: all of them). */
    keepFd?: string[];
  } = {}
) {
  const allMineFaceDown: CardPlacement[] = [
    // face-down cards I control, with different printed costs
    { key: "fd0", def: resourceCard({ name: "Hidden Free Resource", cost: 0 }), owner: P1, zone: "play", faceDown: true },
    { key: "fd2", def: character({ name: "Hidden Two", cost: 2 }), owner: P1, zone: "play", faceDown: true },
    { key: "fd5", def: character({ name: "Hidden Five", cost: 5 }), owner: P1, zone: "play", faceDown: true },
    { key: "fdItem", def: item({ name: "Hidden Four Item", cost: 4 }), owner: P1, zone: "play", faceDown: true },
    { key: "fdTac", def: tactic({ name: "Hidden One Tactic", cost: 1 }), owner: P1, zone: "play", faceDown: true },
    { key: "fdSpent", def: character({ name: "Hidden Spent Three", cost: 3 }), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }
  ];
  const mineFaceDown = allMineFaceDown.filter((placement) => !opts.keepFd || opts.keepFd.includes(placement.key));
  return devBoard(
    [
      { key: "ie", def: printing(IMPLO), owner: P1, zone: "hand" },
      ...mineFaceDown,
      { key: "theirFd", def: character({ name: "Their Hidden", cost: 4 }), owner: P2, zone: "play", faceDown: true },
      // victims
      { key: "myc", def: character({ name: "My Character", life: 20 }), owner: P1, zone: "play" },
      { key: "vc", def: character({ name: "Their Character", life: 20 }), owner: P2, zone: "play" },
      { key: "vlow", def: character({ name: "Their Fragile Character", life: 3 }), owner: P2, zone: "play" },
      { key: "myl", def: location({ name: "My Place", structure: 20 }), owner: P1, zone: "play" },
      { key: "vl", def: location({ name: "Their Place", structure: 20 }), owner: P2, zone: "play" },
      { key: "vllow", def: location({ name: "Their Fragile Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "hand", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "disc", def: character({ name: "Discarded Character" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { rage: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ImploGame = ReturnType<typeof imploBoard>;

const implode = (g: ImploGame, fd: string, victim: string) => play(g.engine, P1, g.id("ie"), { selected: { fdres: [g.id(fd)], victim: [g.id(victim)] } });
const implodeAttempt = (g: ImploGame, fd: string | undefined, victim: string | undefined) => () =>
  playRaw(g.engine, P1, g.id("ie"), { selected: { ...(fd ? { fdres: [g.id(fd)] } : {}), ...(victim ? { victim: [g.id(victim)] } : {}) } });

clause(IMPLO, "0:ability", "X is the revealed card's numeric cost: a cost-2 card inflicts 2 damage to the picked character", () => {
  const g = imploBoard();
  implode(g, "fd2", "vc");
  assert.equal(damageOf(g.engine, g.id("vc")), 2);
});

clause(IMPLO, "0:ability", "X is the revealed card's numeric cost: a cost-5 card inflicts 5 damage", () => {
  const g = imploBoard();
  implode(g, "fd5", "vc");
  assert.equal(damageOf(g.engine, g.id("vc")), 5);
});

clause(IMPLO, "0:ability", "X is its numeric cost whatever the card's type: a cost-4 item inflicts 4, a cost-1 tactic inflicts 1", () => {
  const item4 = imploBoard();
  implode(item4, "fdItem", "vc");
  assert.equal(damageOf(item4.engine, item4.id("vc")), 4);
  const tac1 = imploBoard();
  implode(tac1, "fdTac", "vc");
  assert.equal(damageOf(tac1.engine, tac1.id("vc")), 1);
});

clause(IMPLO, "0:ability", "X = 0 for a card with cost 0: no damage is inflicted, but the cost is still paid and the tactic still ends as a face-down resource", () => {
  const g = imploBoard();
  implode(g, "fd0", "vc");
  assert.equal(damageOf(g.engine, g.id("vc")), 0);
  assert.equal(zoneOf(g.engine, g.id("fd0")), "discard", "the revealed card was destroyed");
  assert.equal(zoneOf(g.engine, g.id("ie")), "play");
  assert.equal(g.engine.state.cards[g.id("ie")].faceDown, true);
});

clause(IMPLO, "0:ability", "the revealed face-down card is destroyed and goes to its owner's discard pile", () => {
  const g = imploBoard();
  implode(g, "fd2", "vc");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("fd2")), "discardOf(g.engine, P1).includes(g.id(\"fd2\"))");
  assert.equal(g.engine.state.cards[g.id("fd2")].faceDown, false, "it is face-up in the discard pile");
});

clause(IMPLO, "0:ability", "the card is destroyed as a COST, when Implosive Explosion is played: it is already in my discard pile while my opponent can respond", () => {
  const g = imploBoard();
  implodeAttempt(g, "fd2", "vc")();
  assert.equal(zoneOf(g.engine, g.id("fd2")), "discard", "destroyed at once");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(damageOf(g.engine, g.id("vc")), 0, "the damage has not been inflicted yet");
  assert.equal(zoneOf(g.engine, g.id("ie")), "deploying");
});

clause(IMPLO, "0:ability", "the face-down card is revealed (at the latest when the tactic resolves): a cardsRevealed event names it", () => {
  const g = imploBoard();
  implode(g, "fd2", "vc");
  const revealed = g.engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; cardIds?: string[] } | undefined)
    .filter((event) => event?.type === "cardsRevealed" && event.cardIds?.includes(g.id("fd2")));
  assert.equal(revealed.length, 1);
});

clause(IMPLO, "0:ability", "'Reveal a face-down resource card' is a cost: the card is revealed when Implosive Explosion is played, before my opponent can respond", () => {
  const g = imploBoard();
  implodeAttempt(g, "fd2", "vc")();
  const revealed = g.engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; cardIds?: string[] } | undefined)
    .filter((event) => event?.type === "cardsRevealed" && event.cardIds?.includes(g.id("fd2")));
  assert.equal(revealed.length, 1, "the face-down card was revealed while the opponent can still respond");
});

clause(IMPLO, "0:ability", "the destroyed face-down card cannot also pay for Implosive Explosion (numeric costs are paid last, CR 406.3a): with the destroyed card making up the third resource it is refused", () => {
  const g = imploBoard({ icons: { rage: 1, greed: 1 }, keepFd: ["fd2"] });
  assert.equal(ready(g.engine), 3, "two real resources and the face-down cost-2 card");
  refused(implodeAttempt(g, "fd2", "vc"), "the destroyed card cannot pay: only two resources are left for a cost of 3");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play", "nothing was destroyed");
  assert.equal(zoneOf(g.engine, g.id("ie")), "hand");
});

clause(IMPLO, "0:ability", "with a third resource besides the destroyed card it is played: the card is destroyed and X damage is inflicted", () => {
  const g = imploBoard({ icons: { rage: 1, greed: 2 }, keepFd: ["fd2"] });
  assert.equal(ready(g.engine), 4);
  implode(g, "fd2", "vc");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "discard");
  assert.equal(damageOf(g.engine, g.id("vc")), 2);
  assert.equal(zoneOf(g.engine, g.id("ie")), "play");
});

clause(IMPLO, "0:ability", "exactly 3 resources are paid for its cost number (the revealed card was already spent, so it pays nothing)", () => {
  const g = imploBoard({ icons: { rage: 6 }, keepFd: ["fdSpent"] });
  assert.equal(ready(g.engine), 6);
  implode(g, "fdSpent", "vc");
  assert.equal(attachedCount(g.engine, P1), 3, "three Rage were attached to my faction");
  assert.equal(ready(g.engine), 4, "three Rage left plus the new face-down resource");
});

clause(IMPLO, "0:ability", "the threshold is [R]: with no [R] it is refused however many other resources I have", () => {
  const none = imploBoard({ icons: { greed: 8 } });
  refused(implodeAttempt(none, "fd2", "vc"), "no [R]");
  assert.equal(zoneOf(none.engine, none.id("fd2")), "play");
  assert.equal(zoneOf(none.engine, none.id("ie")), "hand");
  const theirs = imploBoard({ icons: { greed: 8 }, oppIcons: { rage: 4 } });
  refused(implodeAttempt(theirs, "fd2", "vc"), "their [R]");
  const one = imploBoard({ icons: { rage: 1, greed: 4 } });
  implode(one, "fd2", "vc");
  assert.equal(damageOf(one.engine, one.id("vc")), 2, "control: one [R] is enough");
});

clause(IMPLO, "0:ability", "cost 3: with only two resources in all (one of them the card to be destroyed) it is refused and nothing is destroyed", () => {
  const g = imploBoard({ icons: { rage: 1 }, keepFd: ["fd2"] });
  assert.equal(ready(g.engine), 2);
  refused(implodeAttempt(g, "fd2", "vc"), "two resources for a cost of 3");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play");
  assert.equal(zoneOf(g.engine, g.id("ie")), "hand");
});

clause(IMPLO, "0:ability", "it must reveal a FACE-DOWN card I control: a face-up resource, my opponent's face-down card, a card in my hand and a character in play are refused", () => {
  const g = imploBoard();
  const faceUp = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && !g.engine.state.cards[cid].faceDown)!;
  const before = ready(g.engine);
  for (const [what, cid] of [
    ["a face-up resource", faceUp],
    ["my opponent's face-down card", g.id("theirFd")],
    ["a card in my hand", g.id("hand")],
    ["a card in my discard pile", g.id("disc")],
    ["my character in play", g.id("myc")]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => playRaw(g.engine, P1, g.id("ie"), { selected: { fdres: [cid], victim: [g.id("vc")] } }), what);
  }
  assert.equal(zoneOf(g.engine, g.id("ie")), "hand");
  assert.equal(ready(g.engine), before, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("theirFd")), "play");
  implode(g, "fd2", "vc");
  assert.equal(damageOf(g.engine, g.id("vc")), 2, "control");
});

clause(IMPLO, "0:ability", "exactly one face-down card is revealed: none or two are refused", () => {
  const g = imploBoard();
  refused(implodeAttempt(g, undefined, "vc"), "no face-down card");
  refused(() => playRaw(g.engine, P1, g.id("ie"), { selected: { fdres: [g.id("fd2"), g.id("fd5")], victim: [g.id("vc")] } }), "two face-down cards");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play");
  assert.equal(zoneOf(g.engine, g.id("fd5")), "play");
});

clause(IMPLO, "0:ability", "a face-down card that is already spent (attached to my faction) is still a face-down resource I control: it can be revealed and destroyed", () => {
  const g = imploBoard({ icons: { rage: 4 }, keepFd: ["fdSpent"] });
  assert.ok(g.engine.state.cards[g.id("fdSpent")].attachedTo, "control: it is spent");
  implode(g, "fdSpent", "vc");
  assert.equal(zoneOf(g.engine, g.id("fdSpent")), "discard");
  assert.equal(damageOf(g.engine, g.id("vc")), 3);
});

clause(IMPLO, "0:ability", "a character I control can be picked to take the damage", () => {
  const g = imploBoard();
  implode(g, "fd2", "myc");
  assert.equal(damageOf(g.engine, g.id("myc")), 2);
});

clause(IMPLO, "0:ability", "a location can be picked: it takes X damage (mine or theirs)", () => {
  const theirs = imploBoard();
  implode(theirs, "fd5", "vl");
  assert.equal(damageOf(theirs.engine, theirs.id("vl")), 5);
  const mine = imploBoard();
  implode(mine, "fd2", "myl");
  assert.equal(damageOf(mine.engine, mine.id("myl")), 2);
});

clause(IMPLO, "0:ability", "a character whose life is at most X is destroyed and goes to its owner's discard pile", () => {
  const g = imploBoard();
  implode(g, "fd5", "vlow");
  assert.equal(zoneOf(g.engine, g.id("vlow")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("vlow")), "discardOf(g.engine, P2).includes(g.id(\"vlow\"))");
});

clause(IMPLO, "0:ability", "a location whose structure is at most X is destroyed", () => {
  const g = imploBoard();
  implode(g, "fd5", "vllow");
  assert.equal(zoneOf(g.engine, g.id("vllow")), "discard");
});

clause(IMPLO, "0:ability", "X below the life: 2 damage on a 3-life character leaves it alive with 2 damage", () => {
  const g = imploBoard();
  implode(g, "fd2", "vlow");
  assert.equal(zoneOf(g.engine, g.id("vlow")), "play");
  assert.equal(damageOf(g.engine, g.id("vlow")), 2);
});

clause(IMPLO, "0:ability", "only a character or a location can be picked: an item, a face-up resource, a face-down card, a faction and cards outside play are refused", () => {
  const g = imploBoard();
  const faceUp = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && !g.engine.state.cards[cid].faceDown)!;
  const before = ready(g.engine);
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a face-up resource", faceUp],
    ["their face-down card", g.id("theirFd")],
    ["a card in my hand", g.id("hand")],
    ["a card in my discard pile", g.id("disc")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => playRaw(g.engine, P1, g.id("ie"), { selected: { fdres: [g.id("fd2")], victim: [cid] } }), what);
  }
  refused(implodeAttempt(g, "fd2", undefined), "no victim");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play", "nothing was destroyed");
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(IMPLO, "0:ability", "exactly one victim: two are refused", () => {
  const g = imploBoard();
  refused(() => playRaw(g.engine, P1, g.id("ie"), { selected: { fdres: [g.id("fd2")], victim: [g.id("vc"), g.id("vl")] } }), "two victims");
  assert.equal(zoneOf(g.engine, g.id("fd2")), "play");
});

clause(IMPLO, "0:ability", "it ends as a FACE-DOWN RESOURCE in play under its owner's control, not in the discard pile", () => {
  const g = imploBoard();
  implode(g, "fd2", "vc");
  assert.equal(zoneOf(g.engine, g.id("ie")), "play");
  assert.equal(g.engine.state.cards[g.id("ie")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("ie")].controllerId, P1);
  assert.equal(discardOf(g.engine, P1).includes(g.id("ie")), false, "not in the discard pile");
  assert.ok(playOf(g.engine, P1).includes(g.id("ie")), "playOf(g.engine, P1).includes(g.id(\"ie\"))");
});

clause(IMPLO, "0:ability", "as a face-down resource it provides Volition and is a resource I can spend", () => {
  const g = imploBoard();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  implode(g, "fd2", "vc");
  assert.equal(g.engine.isResource(g.id("ie")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore - 1 + 1, "the destroyed card's Volition left, the new face-down card's arrived");
});

clause(IMPLO, "0:ability", "the new face-down resource enters play ready: it is not attached to my faction", () => {
  const g = imploBoard();
  implode(g, "fd2", "vc");
  assert.equal(g.engine.state.cards[g.id("ie")].attachedTo, undefined);
  assert.equal(g.engine.state.cards[g.id("ie")].depleted, false);
});

clause(IMPLO, "0:ability", "if the picked victim leaves play in response, it still ends as a face-down resource (the rest resolves, CR 402.5)", () => {
  const g = imploBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  implodeAttempt(g, "fd2", "vc")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("vc")] });
  assert.equal(zoneOf(g.engine, g.id("vc")), "removed", "control: the victim left play");
  assert.equal(zoneOf(g.engine, g.id("ie")), "play");
  assert.equal(g.engine.state.cards[g.id("ie")].faceDown, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(IMPLO, "0:ability", "as a tactic it can be played in response on my opponent's turn, and still ends under MY control as a face-down resource", () => {
  const g = imploBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", life: 9 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("ie"), { fdres: [g.id("fd5")], victim: [g.id("atk")] });
  assert.equal(damageOf(g.engine, g.id("atk")), 5);
  assert.equal(zoneOf(g.engine, g.id("ie")), "play");
  assert.equal(g.engine.state.cards[g.id("ie")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("ie")].controllerId, P1);
});

clause(IMPLO, "0:ability", "two Implosive Explosions in a row each end as a face-down resource (the second reveals what is left)", () => {
  const g = imploBoard({ icons: { rage: 8 }, extra: [{ key: "ie2", def: printing(IMPLO), owner: P1, zone: "hand" }] });
  implode(g, "fd2", "vc");
  play(g.engine, P1, g.id("ie2"), { selected: { fdres: [g.id("fd5")], victim: [g.id("vc")] } });
  assert.equal(damageOf(g.engine, g.id("vc")), 7, "2 + 5");
  for (const key of ["ie", "ie2"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
    assert.equal(g.engine.state.cards[g.id(key)].faceDown, true);
  }
});


// =================================================================================
// Midget Mine
// AMBUSH -- COST: Pick an attacking character. -- EFFECT: Inflict 2 damage to the
// character. Flip this card face-down under its owner's control.
// FLIP UP: 5 [R]
// Item, cost 2, [R].
// =================================================================================

const MINE = "8dd7d98c-b6c5-4040-ac3b-316d707f5777";

function mineBoard(
  opts: {
    mine?: "play" | "hand" | "faceDown";
    owner?: PlayerId;
    controller?: PlayerId;
    mineSpent?: boolean;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.mine ?? "play";
  return devBoard(
    [
      {
        key: "mm",
        def: printing(MINE),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.mineSpent ? "__factionA" : undefined
      },
      { key: "atk", def: character({ name: "Their Attacker", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Their Second Attacker", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Their Fragile Attacker", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "home", def: character({ name: "Their Stay-at-home", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "My Blocker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine1", def: character({ name: "My Attacker", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { rage: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type MineGame = ReturnType<typeof mineBoard>;

/** AMBUSH on `target` (raw, no draining). */
const ambushRaw = (g: MineGame, target: string, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("mm"), "ambush", { atk: [g.id(target)] });

/** My opponent attacks my faction with `attackers`, passing priority so that I can respond. */
function theyAttack(g: MineGame, attackers: string[] = ["atk"]): void {
  declareAttackOpenWindow(g.engine, P2, attackers.map((k) => g.id(k)));
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in the attack's response window");
}

clause(MINE, "0:ability:ambush", "in response to an attack: the attacking character takes 2 damage and the Mine is flipped face-down", () => {
  const g = mineBoard();
  theyAttack(g);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk")), 2);
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
});

clause(MINE, "0:ability:ambush", "the Mine is flipped face-down 'under its owner's control': it ends in play, face-down, controlled by me", () => {
  const g = mineBoard();
  theyAttack(g);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("mm")].controllerId, P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("mm")), "playOf(g.engine, P1).includes(g.id(\"mm\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("mm")), false, "it was flipped, not destroyed");
});

clause(MINE, "0:ability:ambush", "'under its owner's control': a Mine I took from its owner and then used goes back face-down under its OWNER's control", () => {
  const g = mineBoard({ owner: P2, controller: P1 });
  theyAttack(g);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("mm")].controllerId, P2, "its owner controls the face-down card");
  assert.ok(playOf(g.engine, P2).includes(g.id("mm")), "playOf(g.engine, P2).includes(g.id(\"mm\"))");
});

clause(MINE, "0:ability:ambush", "once face-down it is a resource: it provides Volition and has no AMBUSH any more", () => {
  const g = mineBoard();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  theyAttack(g, ["atk", "atk2"]);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.isResource(g.id("mm")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  refused(ambushRaw(g, "atk2"), "a face-down card has no abilities", /cannot be activated|Activated ability not found/);
  assert.equal(damageOf(g.engine, g.id("atk2")), 0);
});

clause(MINE, "0:ability:ambush", "only the picked attacker takes the damage: the other attacker in the party and a character that stays home do not", () => {
  const g = mineBoard();
  theyAttack(g, ["atk", "atk2"]);
  ambushRaw(g, "atk2")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk2")), 2);
  assert.equal(damageOf(g.engine, g.id("atk")), 0);
  assert.equal(damageOf(g.engine, g.id("home")), 0);
});

clause(MINE, "0:ability:ambush", "the damage is exactly 2: a 1-life attacker is destroyed, a 5-life attacker keeps 3 life", () => {
  const g = mineBoard();
  theyAttack(g, ["weak"]);
  ambushRaw(g, "weak")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard", "2 damage destroys a 2-life attacker");
  const big = mineBoard();
  theyAttack(big);
  ambushRaw(big, "atk")();
  resolvePendingResponses(big.engine);
  assert.equal(damageOf(big.engine, big.id("atk")), 2);
  assert.equal(zoneOf(big.engine, big.id("atk")), "play");
});

clause(MINE, "0:ability:ambush", "an attacker destroyed by it is removed from the battle (CR 302.15): with no attackers left the battle ends", () => {
  const g = mineBoard();
  theyAttack(g, ["weak"]);
  ambushRaw(g, "weak")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard");
  // E10e: an emptied attacking party ends the battle outright (nothing happened in it, so no finished battle waits for advanceFlow).
  assert.equal(battleOf(g.engine), undefined, "the attacking party is empty, the battle is over");
  assert.equal(influenceOf(g.engine, P1), START, "no damage got through");
});

clause(MINE, "0:ability:ambush", "it costs no resources: nothing is paid", () => {
  const g = mineBoard();
  const before = ready(g.engine);
  theyAttack(g);
  ambushRaw(g, "atk")();
  assert.equal(before - ready(g.engine), 0);
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond to AMBUSH");
});

clause(MINE, "0:ability:ambush", "the cost is paid when AMBUSH is used: nothing has happened to the attacker yet while my opponent can respond", () => {
  const g = mineBoard();
  theyAttack(g);
  ambushRaw(g, "atk")();
  assert.equal(damageOf(g.engine, g.id("atk")), 0);
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false, "the Mine has not flipped yet");
});

clause(MINE, "0:ability:ambush", "Pick an attacking character: with no battle at all there is nothing to pick and AMBUSH is refused", () => {
  const g = mineBoard();
  refused(ambushRaw(g, "atk"), "no attack is happening", /Ability cannot be used at the current timing/);
  refused(ambushRaw(g, "home"), "nobody is attacking");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
  assert.equal(damageOf(g.engine, g.id("atk")), 0);
});

clause(MINE, "0:ability:ambush", "only an ATTACKING character can be picked: a character that stays home, my own blocker and my own non-attacking characters are refused", () => {
  const g = mineBoard();
  theyAttack(g);
  for (const [what, key] of [
    ["a character that stays home", "home"],
    ["my own character", "blk"],
    ["their second character that is not attacking", "atk2"]
  ] as const) {
    refused(ambushRaw(g, key), what);
  }
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false, "nothing happened");
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk")), 2, "control: the attacker works");
});

clause(MINE, "0:ability:ambush", "only a character can be picked: an item, a location, the attacked faction, a face-down card and a card in hand are refused", () => {
  const g = mineBoard({
    extra: [
      { key: "thing", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Their Place", structure: 5 }), owner: P2, zone: "play" },
      { key: "fdc", def: character({ name: "Their Hidden", strength: 2 }), owner: P2, zone: "play", faceDown: true },
      { key: "handc", def: character({ name: "Their Hand Character" }), owner: P2, zone: "hand" }
    ]
  });
  theyAttack(g);
  for (const key of ["thing", "place", "fdc", "handc"]) refused(ambushRaw(g, key), `${key} is not an attacking character`);
  refused(() => actRaw(g.engine, P1, g.id("mm"), "ambush", { atk: [g.engine.state.players[P1].factionId!] }), "my faction, the target of the attack");
  refused(() => actRaw(g.engine, P1, g.id("mm"), "ambush", { atk: [g.engine.state.players[P2].factionId!] }), "their faction");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
});

clause(MINE, "0:ability:ambush", "exactly one attacker is picked: two or none are refused", () => {
  const g = mineBoard();
  theyAttack(g, ["atk", "atk2"]);
  refused(() => actRaw(g.engine, P1, g.id("mm"), "ambush", { atk: [g.id("atk"), g.id("atk2")] }), "two picks");
  refused(() => actRaw(g.engine, P1, g.id("mm"), "ambush", {}), "no pick");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
});

clause(MINE, "0:ability:ambush", "a blocking character is not an attacking character: after blockers are declared only the attackers can be picked", () => {
  const g = mineBoard();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  // the first battle-resolution window: the attacker acts first, then I do
  if (g.engine.state.responseWindow?.priorityPlayerId === P2) g.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "control: I can act in the battle window");
  refused(ambushRaw(g, "blk"), "my own blocker is not attacking");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk")), 2, "control: the attacker can be picked during the battle");
});

clause(MINE, "0:ability:ambush", "an 'attacking character' is any attacker, mine too: AMBUSH on my own attacker in my own attack's window", () => {
  const g = mineBoard({ turn: 1, active: P1 });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("mine1")], target: { type: "faction", playerId: P2 } });
  ambushRaw(g, "mine1")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine1")), 2);
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
});

clause(MINE, "0:ability:ambush", "if the picked attacker leaves play in response, the Mine is still flipped face-down (the rest resolves, CR 402.5)", () => {
  const g = mineBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  theyAttack(g);
  ambushRaw(g, "atk")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("atk")] });
  assert.equal(zoneOf(g.engine, g.id("atk")), "removed", "control: the attacker left play");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(MINE, "0:ability:ambush", "if the Mine leaves play in response, the attacker still takes the 2 damage (an ability resolves even if its source has left, CR 502.4)", () => {
  const g = mineBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  theyAttack(g);
  ambushRaw(g, "atk")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("mm")] });
  assert.equal(zoneOf(g.engine, g.id("mm")), "removed", "control: the Mine left play");
  assert.equal(damageOf(g.engine, g.id("atk")), 2);
});

clause(MINE, "0:ability:ambush", "a face-up Mine in play on the turn it enters can use AMBUSH (abilities work the turn a card enters play)", () => {
  const g = mineBoard({ mine: "hand", turn: 1, active: P1, extra: [] });
  play(g.engine, P1, g.id("mm"));
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("mine1")], target: { type: "faction", playerId: P2 } });
  ambushRaw(g, "mine1")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine1")), 2);
});

clause(MINE, "0:ability:ambush", "only the Mine's controller can use AMBUSH: my opponent cannot use my Mine", () => {
  const g = mineBoard();
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(ambushRaw(g, "atk", P2), "the opponent using my Mine");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
});

clause(MINE, "0:ability:ambush", "the Mine is an item deployed for 2 with [R] on my own turn: three resources and no [R] are refused", () => {
  const ok = mineBoard({ mine: "hand", turn: 1, active: P1, icons: { rage: 2 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("mm"));
  assert.equal(zoneOf(ok.engine, ok.id("mm")), "play");
  assert.equal(before - ready(ok.engine), 2);
  const none = mineBoard({ mine: "hand", turn: 1, active: P1, icons: { greed: 5 } });
  refused(() => playRaw(none.engine, P1, none.id("mm")), "no [R]");
  const short = mineBoard({ mine: "hand", turn: 1, active: P1, icons: { rage: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "one resource for a cost of 2");
});

clause(MINE, "0:ability:ambush", "the threshold is a single [R]: one Rage and one other resource are enough to deploy the Mine", () => {
  const g = mineBoard({ mine: "hand", turn: 1, active: P1, icons: { rage: 1, greed: 1 } });
  play(g.engine, P1, g.id("mm"));
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  assert.equal(ready(g.engine), 0);
});

// --- 1:flipUp: 5 [R] ------------------------------------------------------------------------------

const flipMine = (g: MineGame, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("mm"));
const flipBoard = (opts: Parameters<typeof mineBoard>[0] = {}) => mineBoard({ mine: "faceDown", turn: 1, active: P1, ...opts });

clause(MINE, "1:flipUp", "a face-down Midget Mine is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = flipBoard({ icons: { rage: 2 } });
  assert.equal(g.engine.isResource(g.id("mm")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(MINE, "1:flipUp", "flipping it up puts the item face-up into play under my control", () => {
  const g = flipBoard();
  flipMine(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("mm")].controllerId, P1);
  assert.equal(g.engine.isResource(g.id("mm")), false, "it is an item now");
});

clause(MINE, "1:flipUp", "FLIP UP costs 5 (not the card's cost number of 2): with exactly five ready resources, itself included, it works", () => {
  const g = flipBoard({ icons: { rage: 4 } });
  assert.equal(ready(g.engine), 5);
  flipMine(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
});

clause(MINE, "1:flipUp", "FLIP UP costs 5: four ready resources are refused and nothing changes", () => {
  const g = flipBoard({ icons: { rage: 3 } });
  assert.equal(ready(g.engine), 4);
  refused(() => flipMine(g), "four ready resources for a Flip Up cost of 5");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
  assert.equal(ready(g.engine), 4, "nothing was paid");
});

clause(MINE, "1:flipUp", "FLIP UP pays 5 and no more: with many resources at most five end up spent", () => {
  const g = flipBoard({ icons: { rage: 9 } });
  flipMine(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 5, "at most five spent");
  assert.ok(attachedCount(g.engine, P1) >= 4, "at least the four payments besides the Mine itself");
});

clause(MINE, "1:flipUp", "FLIP UP needs [R]: no [R] among many other resources is refused, one is accepted; Volition and the opponent's [R] do not count", () => {
  const none = flipBoard({ icons: { greed: 7 } });
  refused(() => flipMine(none), "no [R]");
  assert.equal(none.engine.state.cards[none.id("mm")].faceDown, true);
  assert.equal(ready(none.engine), 8, "nothing was paid");
  const theirs = flipBoard({ icons: { greed: 7 }, oppIcons: { rage: 4 } });
  refused(() => flipMine(theirs), "only their [R]");
  const one = flipBoard({ icons: { rage: 1, greed: 4 } });
  flipMine(one);
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("mm")].faceDown, false, "control: one [R] is enough");
});

clause(MINE, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = flipBoard({ oppIcons: { rage: 6 } });
  refused(() => flipMine(theirs, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("mm")].faceDown, true);
  const inHand = mineBoard({ mine: "hand", turn: 1, active: P1 });
  refused(() => flipMine(inHand), "in my hand it is not a face-down resource");
  const faceUp = mineBoard({ mine: "play", turn: 1, active: P1 });
  refused(() => flipMine(faceUp), "a face-up card in play");
});

clause(MINE, "1:flipUp", "an item is flipped up like it is deployed (CR 507.4d): refused on my opponent's turn when no response window is open", () => {
  const g = flipBoard({ turn: 2, active: P2 });
  refused(() => flipMine(g), "my opponent's turn, no window");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
});

clause(MINE, "1:flipUp", "an item can only be deployed on my own turn, so FLIP UP is refused INSIDE my opponent's response window too (CR 507.4d)", () => {
  const g = flipBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "control: I hold priority in their attack window");
  refused(() => flipMine(g), "an item cannot be deployed in response, so it cannot be flipped up in response");
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
});

clause(MINE, "1:flipUp", "a flipped-up Mine has AMBUSH again: used in response to the next attack it deals 2 damage and flips face-down once more", () => {
  const g = flipBoard();
  flipMine(g);
  resolvePendingResponses(g.engine);
  endTurn(g.engine, P1);
  theyAttack(g);
  ambushRaw(g, "atk")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("atk")), 2);
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, true);
});

clause(MINE, "1:flipUp", "a face-down Midget Mine that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = flipBoard({ mineSpent: true });
  flipMine(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("mm")].faceDown, false);
});

clause(MINE, "1:flipUp", "a flipped-up item is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = flipBoard();
  holdFlipUp(() => flipMine(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(g.engine.state.cards[g.id("mm")].zone, "deploying", "it has not entered play yet: it is being deployed");
});


// =================================================================================
// Necromantic Healer
// If battle damage is inflicted to a character in a party with this card, reduce the
// amount by 1. (This includes this character.)
// Character (sorceress), cost 2, [R], 1 strength / 1 speed / 3 life.
// =================================================================================

const HEALER = "c6b38fc4-a716-40b2-874d-10df6d8429b2";

type Split = NonNullable<Parameters<typeof finishBattle>[1]>;

/** Every damage source puts all of its strength on `targets[sourceKey]` (a card) when that is legal, else on its first legal target. */
function assignTo(g: { id: (key: string) => CardInstanceId }, targets: Record<string, string>): Split {
  return (source) => {
    if (source.strength <= 0 || source.legalTargets.length === 0) return [];
    const wanted = Object.entries(targets).find(([key]) => g.id(key) === source.cardId)?.[1];
    const preferred = wanted === undefined ? undefined : source.legalTargets.find((t) => t.type === "card" && t.cardId === g.id(wanted));
    return [{ sourceId: source.cardId, target: preferred ?? source.legalTargets[0], amount: source.strength }];
  };
}

function healerBoard(
  opts: {
    healer?: "play" | "hand" | "discard" | "faceDown";
    healers?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.healer ?? "play";
  const more = Array.from({ length: Math.max(0, (opts.healers ?? 1) - 1) }, (_, i) => ({ key: `healer${i + 2}`, def: printing(HEALER), owner: P1, zone: "play" as const }));
  return devBoard(
    [
      { key: "healer", def: printing(HEALER), owner: P1, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      ...more,
      { key: "ally", def: character({ name: "Ally", strength: 4, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "stay", def: character({ name: "Stays At Home", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "Their Attacker 3", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "Their Attacker 1", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "aSlow", def: character({ name: "Their Slow Attacker", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "aFast", def: character({ name: "Their Fast Attacker", strength: 5, life: 9, speed: 4 }), owner: P2, zone: "play" },
      { key: "theirPlace", def: location({ name: "Their Place", structure: 20 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type HealerGame = ReturnType<typeof healerBoard>;

/** My opponent attacks my faction with `attackers`; I block with `blockers`; the battle is fought with `split` (default: first legal target). */
function theyAttackIChoose(g: HealerGame, attackers: string[], blockers: string[], split?: Split): void {
  declareAttackBy(g.engine, P2, attackers.map((k) => g.id(k)));
  declareBlockers(g.engine, P1, blockers.map((k) => g.id(k)));
  finishBattle(g.engine, split);
}

clause(HEALER, "0:rule", "a blocking party with the Healer: battle damage to an ally in the party is reduced by 1 (3 becomes 2)", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3"], ["healer", "ally"], assignTo(g, { a3: "ally" }));
  assert.equal(damageOf(g.engine, g.id("ally")), 2);
});

clause(HEALER, "0:rule", "...and it includes the Healer itself: 3 battle damage assigned to the Healer is reduced to 2, so a 3-life Healer survives", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3"], ["healer", "ally"], assignTo(g, { a3: "healer" }));
  assert.equal(zoneOf(g.engine, g.id("healer")), "play", "2 damage against 3 life");
  assert.equal(damageOf(g.engine, g.id("healer")), 2);
});

clause(HEALER, "0:rule", "the Healer blocking alone is 'in a party with this card' too: damage to it is reduced by 1", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3"], ["healer"]);
  assert.equal(zoneOf(g.engine, g.id("healer")), "play");
  assert.equal(damageOf(g.engine, g.id("healer")), 2);
});

clause(HEALER, "0:rule", "without the Healer the same 3 damage kills a 3-life blocker (control)", () => {
  const g = healerBoard({ extra: [{ key: "plain", def: character({ name: "Plain Three-Life", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }] });
  theyAttackIChoose(g, ["a3"], ["plain"]);
  assert.equal(zoneOf(g.engine, g.id("plain")), "discard");
});

clause(HEALER, "0:rule", "the amount is reduced by exactly 1: 1 battle damage becomes 0 (nothing is inflicted), 5 becomes 4", () => {
  const one = healerBoard();
  theyAttackIChoose(one, ["a1"], ["healer", "ally"], assignTo(one, { a1: "ally" }));
  assert.equal(damageOf(one.engine, one.id("ally")), 0, "1 - 1 = 0");
  const five = healerBoard();
  theyAttackIChoose(five, ["aFast"], ["healer", "ally"], assignTo(five, { aFast: "ally" }));
  assert.equal(damageOf(five.engine, five.id("ally")), 4, "5 - 1 = 4");
});

clause(HEALER, "0:rule", "a Healer-less party gets no reduction: an ally blocking alone while the Healer stays home takes the full 3", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3"], ["ally"]);
  assert.equal(damageOf(g.engine, g.id("ally")), 3);
});

clause(HEALER, "0:rule", "the Healer's reduction covers its own party only: a Healer in the blocking party does not reduce the damage its blockers deal to the ATTACKERS", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3"], ["healer", "ally"], assignTo(g, { ally: "a3", healer: "a3" }));
  assert.equal(damageOf(g.engine, g.id("a3")), 5, "ally 4 + healer 1 damage to the attacker, unreduced");
});

clause(HEALER, "0:rule", "it works for an ATTACKING party too: with the Healer attacking next to an ally, a blocker's 3 damage to the ally is reduced to 2", () => {
  const g = healerBoard({ turn: 1, active: P1 });
  declareAttackBy(g.engine, P1, [g.id("healer"), g.id("ally")]);
  declareBlockers(g.engine, P2, [g.id("a3")]);
  finishBattle(g.engine, assignTo(g, { a3: "ally" }));
  assert.equal(damageOf(g.engine, g.id("ally")), 2);
});

clause(HEALER, "0:rule", "a party with TWO Healers reduces the damage by 2 (3 becomes 1)", () => {
  const g = healerBoard({ healers: 2 });
  theyAttackIChoose(g, ["a3"], ["healer", "healer2", "ally"], assignTo(g, { a3: "ally" }));
  assert.equal(damageOf(g.engine, g.id("ally")), 1);
});

clause(HEALER, "0:rule", "damage from several characters in the same speed step is one amount (CR 609.1f), reduced once: 3 + 3 = 6 becomes 5", () => {
  const g = healerBoard({ extra: [{ key: "a3b", def: character({ name: "Their Attacker 3b", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }] });
  theyAttackIChoose(g, ["a3", "a3b"], ["healer", "ally"], assignTo(g, { a3: "ally", a3b: "ally" }));
  assert.equal(damageOf(g.engine, g.id("ally")), 5);
});

clause(HEALER, "0:rule", "damage in different speed steps is inflicted separately, so each is reduced: 3 at speed 3 and 3 at speed 1 become 2 and 2", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["a3", "aSlow"], ["healer", "ally"], assignTo(g, { a3: "ally", aSlow: "ally" }));
  assert.equal(damageOf(g.engine, g.id("ally")), 4);
});

clause(HEALER, "0:rule", "only BATTLE damage is reduced: 3 damage from a tactic to an ally in the Healer's party is inflicted in full", () => {
  const g = healerBoard({ extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("a3")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("hit"), { t: [g.id("ally")] });
  assert.equal(damageOf(g.engine, g.id("ally")), 3);
});

clause(HEALER, "0:rule", "damage from a tactic is not BATTLE damage even while the Healer's party is in a battle: 3 damage to the ally is inflicted in full", () => {
  const g = healerBoard({ extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  declareAttackBy(g.engine, P2, [g.id("a3")]);
  declareBlockers(g.engine, P1, [g.id("healer"), g.id("ally")]);
  if (g.engine.state.responseWindow?.priorityPlayerId === P2) g.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "control: I can respond inside the battle");
  respondWith(g.engine, P1, g.id("hit"), { t: [g.id("ally")] });
  assert.equal(damageOf(g.engine, g.id("ally")), 3);
});

clause(HEALER, "0:rule", "only a character in a party gets the reduction: tactic damage outside a battle is inflicted in full", () => {
  const g = healerBoard({ turn: 1, active: P1, extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("healer")] } });
  assert.equal(zoneOf(g.engine, g.id("healer")), "discard", "3 damage destroys the 3-life Healer: nothing was reduced");
  const ally = healerBoard({ turn: 1, active: P1, extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(ally.engine, P1, ally.id("hit"), { selected: { t: [ally.id("ally")] } });
  assert.equal(damageOf(ally.engine, ally.id("ally")), 3);
});

clause(HEALER, "0:rule", "damage to a FACTION is not damage to a character: a Healer attacking with an ally deals the full 5 to the faction", () => {
  const g = healerBoard({ turn: 1, active: P1 });
  const before = influenceOf(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("healer"), g.id("ally")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P2), 5, "1 + 4");
});

clause(HEALER, "0:rule", "damage inflicted by my party to a location is not reduced either", () => {
  const g = healerBoard({ turn: 1, active: P1 });
  declareAttackBy(g.engine, P1, [g.id("healer"), g.id("ally")], { type: "card", cardId: g.id("theirPlace") });
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(damageOf(g.engine, g.id("theirPlace")), 5);
});

clause(HEALER, "0:rule", "an attack on my faction that nobody blocks is not reduced: the Healer protects characters, not the faction", () => {
  const g = healerBoard();
  const before = influenceOf(g.engine, P1);
  declareAttackBy(g.engine, P2, [g.id("a3")]);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P1), 3);
});

clause(HEALER, "0:rule", "once the Healer is destroyed in an earlier speed step its party gets no more reduction: a speed-1 hit on the ally is inflicted in full", () => {
  const g = healerBoard();
  theyAttackIChoose(g, ["aFast", "aSlow"], ["healer", "ally"], assignTo(g, { aFast: "healer", aSlow: "ally" }));
  assert.equal(zoneOf(g.engine, g.id("healer")), "discard", "control: 5 - 1 = 4 damage destroyed the 3-life Healer");
  assert.equal(damageOf(g.engine, g.id("ally")), 3, "the speed-1 attacker's 3 damage came after the Healer was gone");
});

clause(HEALER, "0:rule", "a Healer in my hand or my discard pile reduces nothing", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = healerBoard({ healer: where });
    theyAttackIChoose(g, ["a3"], ["ally"]);
    assert.equal(damageOf(g.engine, g.id("ally")), 3, `Healer in ${where}`);
  }
});

clause(HEALER, "0:rule", "a face-down Healer is only a resource (CR 411.1): it reduces nothing", () => {
  const g = healerBoard({ healer: "faceDown" });
  theyAttackIChoose(g, ["a3"], ["ally"]);
  assert.equal(damageOf(g.engine, g.id("ally")), 3);
});

clause(HEALER, "0:rule", "the Healer works for whoever controls it: a character in a party with THEIR Healer takes 1 less battle damage from my blocker", () => {
  const g = healerBoard({ healer: "discard", extra: [{ key: "theirHealer", def: printing(HEALER), owner: P2, zone: "play" }] });
  // their Healer attacks with their attacker; my ally blocks and deals 4 damage to their attacker in the party
  declareAttackBy(g.engine, P2, [g.id("theirHealer"), g.id("a3")]);
  declareBlockers(g.engine, P1, [g.id("ally")]);
  finishBattle(g.engine, assignTo(g, { ally: "a3" }));
  assert.equal(damageOf(g.engine, g.id("a3")), 3, "4 - 1: the damage to a character in a party with THEIR Healer is reduced");
});

clause(HEALER, "0:rule", "it deploys for 2 with [R] and has 1/1/3 stats", () => {
  const g = devBoard([{ key: "healer", def: printing(HEALER), owner: P1, zone: "hand" }, ...res({ rage: 2 })]);
  const before = ready(g.engine);
  play(g.engine, P1, g.id("healer"));
  assert.equal(zoneOf(g.engine, g.id("healer")), "play");
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.getStat(g.id("healer"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("healer"), "speed"), 1);
  assert.equal(g.engine.getStat(g.id("healer"), "life"), 3);
  const none = devBoard([{ key: "healer", def: printing(HEALER), owner: P1, zone: "hand" }, ...res({ greed: 4 })]);
  refused(() => playRaw(none.engine, P1, none.id("healer")), "no [R]");
  const oneR = devBoard([{ key: "healer", def: printing(HEALER), owner: P1, zone: "hand" }, ...res({ rage: 1, greed: 1 })]);
  play(oneR.engine, P1, oneR.id("healer"));
  assert.equal(zoneOf(oneR.engine, oneR.id("healer")), "play", "the threshold is a single [R]");
  const short = devBoard([{ key: "healer", def: printing(HEALER), owner: P1, zone: "hand" }, ...res({ rage: 1 })]);
  refused(() => playRaw(short.engine, P1, short.id("healer")), "one resource for a cost of 2");
});


// =================================================================================
// Padamose, Emperor of Marduun
// UNIQUE PADAMOSE
// All your "sword of great justice" characters gain 1 strength and 1 life.
// All your opponent's "mau" characters and Arcanist characters lose 1 strength and 1 life.
// Character (padamose, emperor, mau), cost 5, [R][R][R][R][R][R], 1 strength / 1 speed / 10 life.
// =================================================================================

const PADAMOSE_SAGA = "12d2de99-a2f3-4038-b897-8405931d892e";
const ATHALAMUND = "7d27517d-2354-46ca-80a0-3ec605d43b7d";

function padBoard(
  opts: {
    pad?: "play" | "hand" | "faceDown";
    padController?: PlayerId;
    oppPad?: boolean;
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.pad ?? "play";
  return devBoard(
    [
      { key: "pad", def: printing(PADAMOSE), owner: P1, controller: opts.padController, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      ...(opts.oppPad ? [{ key: "oppPad", def: printing(PADAMOSE), owner: P2, zone: "play" as const }] : []),
      // my characters
      { key: "mySword", def: character({ name: "My Swordsman", strength: 2, life: 3, subtype: ["sword of great justice"] }), owner: P1, zone: "play" },
      { key: "mySwordMulti", def: character({ name: "My Multi-Subtype Swordsman", strength: 2, life: 3, subtype: ["soldier", "sword of great justice"] }), owner: P1, zone: "play" },
      { key: "myMau", def: character({ name: "My Mau", strength: 3, life: 3, subtype: ["mau"] }), owner: P1, zone: "play" },
      { key: "myArc", def: character({ name: "My Arcanist", strength: 3, life: 3, trade: "arcanist" }), owner: P1, zone: "play" },
      { key: "myPlain", def: character({ name: "My Plain", strength: 3, life: 3 }), owner: P1, zone: "play" },
      // their characters
      { key: "theirSword", def: character({ name: "Their Swordsman", strength: 2, life: 3, subtype: ["sword of great justice"] }), owner: P2, zone: "play" },
      { key: "theirMau", def: character({ name: "Their Mau", strength: 3, life: 3, subtype: ["mau"] }), owner: P2, zone: "play" },
      { key: "theirArc", def: character({ name: "Their Arcanist", strength: 3, life: 3, trade: "arcanist" }), owner: P2, zone: "play" },
      { key: "theirBoth", def: character({ name: "Their Mau Arcanist", strength: 3, life: 3, subtype: ["mau"], trade: "arcanist" }), owner: P2, zone: "play" },
      { key: "theirPlain", def: character({ name: "Their Plain", strength: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "theirWarlordMau", def: character({ name: "Their Warlord Soldier", strength: 3, life: 3, trade: "warlord", subtype: ["soldier"] }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PadGame = ReturnType<typeof padBoard>;
const stat = (g: PadGame, key: string) => ({ strength: g.engine.getStat(g.id(key), "strength"), life: g.engine.getStat(g.id(key), "life") });

// --- 0:unique ------------------------------------------------------------------------------------

function padUniqueBoard(opts: { second?: "hand" | "play" } = {}) {
  return devBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "pad2", def: printing(PADAMOSE), owner: P1, zone: opts.second ?? "hand" },
    { key: "padSaga", def: printing(PADAMOSE_SAGA), owner: P1, zone: "hand" },
    ...res({ rage: 8 })
  ]);
}

clause(PADAMOSE, "0:unique", "a second Padamose: I choose which to keep (the controller chooses), and choosing the new one destroys the old one", () => {
  const g = padUniqueBoard();
  play(g.engine, P1, g.id("pad2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("pad"), g.id("pad2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pad2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("pad2")), "play");
  assert.equal(zoneOf(g.engine, g.id("pad")), "discard", "the other copy is destroyed");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(PADAMOSE, "0:unique", "choosing the old Padamose keeps it and destroys the new one", () => {
  const g = padUniqueBoard();
  play(g.engine, P1, g.id("pad2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pad") } } as never);
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
  assert.equal(zoneOf(g.engine, g.id("pad2")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(PADAMOSE, "0:unique", "after the choice the game goes on: I can end my turn and nothing is left pending", () => {
  const g = padUniqueBoard();
  play(g.engine, P1, g.id("pad2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pad2") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
});

clause(PADAMOSE, "0:unique", "the choice must name one of the copies: a bystander is refused and the choice stays open", () => {
  const g = devBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "pad2", def: printing(PADAMOSE), owner: P1, zone: "hand" },
    { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ rage: 8 })
  ]);
  play(g.engine, P1, g.id("pad2"));
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("bystander") } } as never), "keeping a card that is not a Padamose");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(PADAMOSE, "0:unique", "UNIQUE is per player: my opponent may control their own Padamose with no choice and no destruction", () => {
  const g = devBoard(
    [
      { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
      { key: "pad2", def: printing(PADAMOSE), owner: P2, zone: "hand" },
      ...res({ rage: 8 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(g.engine, P2, g.id("pad2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
  assert.equal(zoneOf(g.engine, g.id("pad2")), "play");
});

clause(PADAMOSE, "0:unique", "taking control of my opponent's Padamose while I have my own is a duplicate: I must keep one", () => {
  const g = devBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "theirs", def: printing(PADAMOSE), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("theirs")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pad") } } as never);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirs")), "discardOf(g.engine, P2).includes(g.id(\"theirs\"))");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(PADAMOSE, "0:unique", "the Seed Saga printing carries the same UNIQUE PADAMOSE designation", () => {
  const g = padUniqueBoard();
  play(g.engine, P1, g.id("padSaga"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("pad"), g.id("padSaga")].sort());
});

clause(PADAMOSE, "0:unique", "a different UNIQUE designation is not a duplicate (Athalamund next to Padamose)", () => {
  const g = devBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "at", def: printing(ATHALAMUND), owner: P1, zone: "hand" },
    ...res({ rage: 8 })
  ]);
  play(g.engine, P1, g.id("at"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
});

clause(PADAMOSE, "0:unique", "a copy in my hand, discard pile or deck is not 'in play': no conflict; a face-down copy is only a resource", () => {
  const g = devBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "h", def: printing(PADAMOSE), owner: P1, zone: "hand" },
    { key: "d", def: printing(PADAMOSE), owner: P1, zone: "discard" },
    { key: "k", def: printing(PADAMOSE), owner: P1, zone: "deck" },
    { key: "fd", def: printing(PADAMOSE), owner: P1, zone: "play", faceDown: true }
  ]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
});

// --- 1:rule: my sword of great justice characters gain 1 strength and 1 life ------------------------

clause(PADAMOSE, "1:rule", "my 'sword of great justice' characters gain 1 strength and 1 life", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "mySword"), { strength: 3, life: 4 });
});

clause(PADAMOSE, "1:rule", "a character with several subtypes is matched by any of them", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "mySwordMulti"), { strength: 3, life: 4 });
});

clause(PADAMOSE, "1:rule", "speed is unchanged", () => {
  const g = padBoard();
  assert.equal(g.engine.getStat(g.id("mySword"), "speed"), 1);
});

clause(PADAMOSE, "1:rule", "only sword of great justice characters: my mau, my Arcanist and a plain character of mine are unchanged", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "myMau"), { strength: 3, life: 3 });
  assert.deepEqual(stat(g, "myArc"), { strength: 3, life: 3 });
  assert.deepEqual(stat(g, "myPlain"), { strength: 3, life: 3 });
});

clause(PADAMOSE, "1:rule", "only MY characters: my opponent's sword of great justice character is not strengthened", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "theirSword"), { strength: 2, life: 3 });
});

clause(PADAMOSE, "1:rule", "the real Athalamund (a sword of great justice) gains 1 strength and 1 life: 4 strength, 4 life", () => {
  const g = padBoard({ extra: [{ key: "at", def: printing(ATHALAMUND), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("at"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("at"), "life"), 4);
});

clause(PADAMOSE, "1:rule", "only CHARACTERS: an item and a location with the sword of great justice subtype are not changed", () => {
  const g = padBoard({
    extra: [
      { key: "swordItem", def: item({ name: "Sword Item", strength: 2, subtype: ["sword of great justice"] }), owner: P1, zone: "play" },
      { key: "swordPlace", def: location({ name: "Sword Place", structure: 4, subtype: ["sword of great justice"] }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("swordItem"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("swordPlace"), "structure"), 4);
});

clause(PADAMOSE, "1:rule", "a face-down card is only a resource (CR 411.1) with no subtype: a face-down sword of great justice character is not a character and gains nothing", () => {
  const g = padBoard({ extra: [{ key: "fdSword", def: character({ name: "Hidden Swordsman", strength: 2, life: 3, subtype: ["sword of great justice"] }), owner: P1, zone: "play", faceDown: true }] });
  assert.equal(g.engine.getStat(g.id("fdSword"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("fdSword"), "life"), 3);
});

clause(PADAMOSE, "1:rule", "a character that enters play later gets the bonus at once", () => {
  const g = padBoard({ extra: [{ key: "late", def: character({ name: "Late Swordsman", strength: 1, life: 1, subtype: ["sword of great justice"] }), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("late")] } });
  assert.deepEqual(stat(g, "late"), { strength: 2, life: 2 });
});

clause(PADAMOSE, "1:rule", "the bonus ends when Padamose leaves play (destroyed): back to printed stats", () => {
  const g = padBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stat(g, "mySword"), { strength: 3, life: 4 }, "control");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("pad")] } });
  assert.equal(zoneOf(g.engine, g.id("pad")), "discard");
  assert.deepEqual(stat(g, "mySword"), { strength: 2, life: 3 });
});

clause(PADAMOSE, "1:rule", "a Padamose in my hand or face-down gives no bonus", () => {
  for (const where of ["hand", "faceDown"] as const) {
    const g = padBoard({ pad: where });
    assert.deepEqual(stat(g, "mySword"), { strength: 2, life: 3 }, `Padamose ${where}`);
  }
});

clause(PADAMOSE, "1:rule", "'your' is the controller's: a Padamose I own but my opponent controls strengthens THEIR swords, not mine", () => {
  const g = padBoard({ padController: P2 });
  assert.deepEqual(stat(g, "theirSword"), { strength: 3, life: 4 });
  assert.deepEqual(stat(g, "mySword"), { strength: 2, life: 3 });
});

clause(PADAMOSE, "1:rule", "the extra life really helps: a 3-life swordsman survives 3 damage with Padamose in play and dies without him", () => {
  const withPad = padBoard({ extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(withPad.engine, P1, withPad.id("hit"), { selected: { t: [withPad.id("mySword")] } });
  assert.equal(zoneOf(withPad.engine, withPad.id("mySword")), "play");
  const without = padBoard({ pad: "hand", extra: [{ key: "hit", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("hit"), { selected: { t: [without.id("mySword")] } });
  assert.equal(zoneOf(without.engine, without.id("mySword")), "discard");
});

// --- 2:rule: my opponent's mau and Arcanist characters lose 1 strength and 1 life ------------------

clause(PADAMOSE, "2:rule", "my opponent's 'mau' characters lose 1 strength and 1 life", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "theirMau"), { strength: 2, life: 2 });
});

clause(PADAMOSE, "2:rule", "my opponent's Arcanist characters lose 1 strength and 1 life", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "theirArc"), { strength: 2, life: 2 });
});

clause(PADAMOSE, "2:rule", "speed is unchanged", () => {
  const g = padBoard();
  assert.equal(g.engine.getStat(g.id("theirMau"), "speed"), 1);
});

clause(PADAMOSE, "2:rule", "a character that is both a mau and an Arcanist loses 1 strength and 1 life ONCE (one instruction, one group of characters)", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "theirBoth"), { strength: 2, life: 2 });
});

clause(PADAMOSE, "2:rule", "other characters of my opponent are unchanged: a plain character, a sword of great justice and a warlord soldier", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "theirPlain"), { strength: 3, life: 3 });
  assert.deepEqual(stat(g, "theirSword"), { strength: 2, life: 3 });
  assert.deepEqual(stat(g, "theirWarlordMau"), { strength: 3, life: 3 });
});

clause(PADAMOSE, "2:rule", "only my OPPONENT's: my own mau and my own Arcanist are unchanged", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "myMau"), { strength: 3, life: 3 });
  assert.deepEqual(stat(g, "myArc"), { strength: 3, life: 3 });
});

clause(PADAMOSE, "2:rule", "Padamose is himself a 'mau' but is MINE: he does not weaken himself (1 strength, 10 life)", () => {
  const g = padBoard();
  assert.deepEqual(stat(g, "pad"), { strength: 1, life: 10 });
});

clause(PADAMOSE, "2:rule", "my opponent's own Padamose (a mau) is weakened by mine: 0 strength and 9 life", () => {
  const g = padBoard({ oppPad: true });
  assert.deepEqual(stat(g, "oppPad"), { strength: 0, life: 9 });
  assert.deepEqual(stat(g, "pad"), { strength: 0, life: 9 }, "and mine is weakened by theirs");
});

clause(PADAMOSE, "2:rule", "with both Padamoses in play each strengthens its own controller's swords", () => {
  const g = padBoard({ oppPad: true });
  assert.deepEqual(stat(g, "mySword"), { strength: 3, life: 4 });
  assert.deepEqual(stat(g, "theirSword"), { strength: 3, life: 4 });
});

clause(PADAMOSE, "2:rule", "the stats stop at 0 (CR 410.4): a 0-strength mau of my opponent stays at 0 strength", () => {
  const g = padBoard({ extra: [{ key: "weakMau", def: character({ name: "Weak Mau", strength: 0, life: 5, subtype: ["mau"] }), owner: P2, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("weakMau"), "strength"), 0);
  assert.equal(g.engine.getStat(g.id("weakMau"), "life"), 4);
});

clause(PADAMOSE, "2:rule", "a 1-life mau of my opponent has 0 life, which destroys it at once (FAQ: damage 0 is at least life 0)", () => {
  const g = padBoard({ pad: "hand", icons: { rage: 6 }, extra: [{ key: "frail", def: character({ name: "Frail Mau", strength: 2, life: 1, subtype: ["mau"] }), owner: P2, zone: "play" }] });
  play(g.engine, P1, g.id("pad"));
  assert.equal(zoneOf(g.engine, g.id("pad")), "play", "control: Padamose entered play");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
});

clause(PADAMOSE, "2:rule", "a face-down 'mau' of my opponent is only a resource and loses nothing", () => {
  const g = padBoard({ extra: [{ key: "fdMau", def: character({ name: "Hidden Mau", strength: 3, life: 3, subtype: ["mau"] }), owner: P2, zone: "play", faceDown: true }] });
  assert.equal(g.engine.getStat(g.id("fdMau"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("fdMau"), "life"), 3);
});

clause(PADAMOSE, "2:rule", "only CHARACTERS: my opponent's mau item and Arcanist item are unchanged", () => {
  const g = padBoard({
    extra: [
      { key: "mauItem", def: item({ name: "Mau Trinket", strength: 3, subtype: ["mau"] }), owner: P2, zone: "play" },
      { key: "arcItem", def: item({ name: "Arcane Trinket", strength: 3, trade: "arcanist" }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("mauItem"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("arcItem"), "strength"), 3);
});

clause(PADAMOSE, "2:rule", "the penalty ends when Padamose leaves play: my opponent's mau gets its stats back", () => {
  const g = padBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stat(g, "theirMau"), { strength: 2, life: 2 }, "control");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("pad")] } });
  assert.deepEqual(stat(g, "theirMau"), { strength: 3, life: 3 });
  assert.deepEqual(stat(g, "theirArc"), { strength: 3, life: 3 });
});

clause(PADAMOSE, "2:rule", "a Padamose in my hand or face-down weakens nobody", () => {
  for (const where of ["hand", "faceDown"] as const) {
    const g = padBoard({ pad: where });
    assert.deepEqual(stat(g, "theirMau"), { strength: 3, life: 3 }, `Padamose ${where}`);
  }
});

clause(PADAMOSE, "2:rule", "'your opponent's' follows the controller: a Padamose I own but my opponent controls weakens MY mau and Arcanist", () => {
  const g = padBoard({ padController: P2 });
  assert.deepEqual(stat(g, "myMau"), { strength: 2, life: 2 });
  assert.deepEqual(stat(g, "myArc"), { strength: 2, life: 2 });
  assert.deepEqual(stat(g, "theirMau"), { strength: 3, life: 3 });
});

clause(PADAMOSE, "2:rule", "the weaker mau really hits less: a 3-strength mau of my opponent attacking my faction deals 2", () => {
  const g = padBoard({ turn: 2, active: P2 });
  const before = influenceOf(g.engine, P1);
  declareAttackBy(g.engine, P2, [g.id("theirMau")]);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P1), 2);
});

clause(PADAMOSE, "2:rule", "it deploys for 5 with [R]x6 and has 1/1/10 stats; five [R] are refused", () => {
  const g = padBoard({ pad: "hand", icons: { rage: 6 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("pad"));
  assert.equal(zoneOf(g.engine, g.id("pad")), "play");
  assert.equal(before - ready(g.engine), 5);
  assert.deepEqual(stat(g, "pad"), { strength: 1, life: 10 });
  assert.equal(g.engine.getStat(g.id("pad"), "speed"), 1);
  const exact = padBoard({ pad: "hand", icons: { rage: 6, greed: 0 } });
  play(exact.engine, P1, exact.id("pad"));
  assert.equal(zoneOf(exact.engine, exact.id("pad")), "play", "exactly six [R] meet the threshold");
  const five = padBoard({ pad: "hand", icons: { rage: 5, greed: 4 } });
  refused(() => playRaw(five.engine, P1, five.id("pad")), "five [R] for [R]x6");
  const short = padBoard({ pad: "hand", icons: { rage: 4 }, extra: spentRage(2) });
  assert.equal(short.engine.getThresholds(P1).rage ?? 0, 6);
  refused(() => playRaw(short.engine, P1, short.id("pad")), "[R]x6 met but only four ready resources for a cost of 5");
});


// =================================================================================
// Plunging Shriever
// When this card enters play, you may pick an item. If you do, destroy that item and your
// faction loses 2 influence.
// FLY AWAY -- COST: Remove an item in your opponent's discard pile from the game. --
// EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 3 [R][R]
// Character (dragon), cost 4, [R][R], 3 strength / 4 speed / 1 life.
// =================================================================================

const SHRIEVER = "afecc5f2-5714-46ee-9279-b6827de2ee46";

function shrieverBoard(
  opts: {
    ps?: "hand" | "play" | "faceDown" | "discard";
    owner?: PlayerId;
    controller?: PlayerId;
    psSpent?: boolean;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    noItems?: boolean;
    influence?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.ps ?? "hand";
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      {
        key: "ps",
        def: printing(SHRIEVER),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: opts.psSpent ? "__factionA" : undefined
      },
      ...(opts.noItems
        ? []
        : [
            { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" as const },
            { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" as const },
            { key: "fdItem", def: item({ name: "Hidden Item" }), owner: P2, zone: "play" as const, faceDown: true }
          ]),
      { key: "ally", def: character({ name: "Ally", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "A Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "dItem", def: item({ name: "Their Fallen Item" }), owner: P2, zone: "discard" },
      { key: "dItem2", def: item({ name: "Their Second Fallen Item" }), owner: P2, zone: "discard" },
      { key: "dChar", def: character({ name: "Their Fallen Character" }), owner: P2, zone: "discard" },
      { key: "myDItem", def: item({ name: "My Fallen Item" }), owner: P1, zone: "discard" },
      { key: "handItem", def: item({ name: "Their Hand Item" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { rage: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type ShrieverGame = ReturnType<typeof shrieverBoard>;

/** Answers the "may pick an item" prompt with `key`, or declines when `key` is undefined. */
function pickItem(g: ShrieverGame, key: string | undefined): void {
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1, "I make the pick");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { itm: key ? [g.id(key)] : [] } } } as never);
  resolvePendingResponses(g.engine);
}

/** Deploys the Shriever and answers the enters-play pick. */
function shriever(g: ShrieverGame, key: string | undefined): void {
  play(g.engine, P1, g.id("ps"));
  pickItem(g, key);
}

clause(SHRIEVER, "0:rule", "when it enters play I may pick an item: the item is destroyed (to its owner's discard pile) and my faction loses 2 influence", () => {
  const g = shrieverBoard();
  shriever(g, "theirItem");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirItem")), "discardOf(g.engine, P2).includes(g.id(\"theirItem\"))");
  assert.equal(influenceOf(g.engine, P1), START - 2);
  assert.equal(influenceOf(g.engine, P2), START, "their faction is not hurt");
});

clause(SHRIEVER, "0:rule", "my own item can be picked too: it is destroyed and I still lose 2 influence", () => {
  const g = shrieverBoard();
  shriever(g, "myItem");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "discard");
  assert.equal(influenceOf(g.engine, P1), START - 2);
});

clause(SHRIEVER, "0:rule", "only the picked item is destroyed: the other items stay", () => {
  const g = shrieverBoard();
  shriever(g, "theirItem");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("fdItem")), "play");
});

clause(SHRIEVER, "0:rule", "'you may pick': declining destroys nothing and my faction loses nothing", () => {
  const g = shrieverBoard();
  shriever(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(zoneOf(g.engine, g.id("ps")), "play", "the Shriever itself is in play");
});

clause(SHRIEVER, "0:rule", "only an ITEM can be picked: a character, a location, a face-down card, a faction and cards outside play are refused", () => {
  const g = shrieverBoard();
  play(g.engine, P1, g.id("ps"));
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid))!;
  for (const [what, cid] of [
    ["a character", g.id("foe")],
    ["my other character", g.id("ally")],
    ["the Shriever itself", g.id("ps")],
    ["a location", g.id("place")],
    ["a face-down item", g.id("fdItem")],
    ["a face-up resource", resource],
    ["an item in a discard pile", g.id("dItem")],
    ["an item in a hand", g.id("handItem")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { itm: [cid] } } } as never),
      what
    );
    assert.ok(pending(g.engine), `the prompt is still open after refusing ${what}`);
  }
  assert.equal(influenceOf(g.engine, P1), START, "nothing happened");
  pickItem(g, "theirItem");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard", "control: an item works");
});

clause(SHRIEVER, "0:rule", "'pick an item': one item, not two", () => {
  const g = shrieverBoard();
  play(g.engine, P1, g.id("ps"));
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { itm: [g.id("myItem"), g.id("theirItem")] } } } as never),
    "two items"
  );
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
});

clause(SHRIEVER, "0:rule", "with no item in play nothing is picked and I lose no influence ('if you do')", () => {
  const g = shrieverBoard({ noItems: true });
  play(g.engine, P1, g.id("ps"));
  assert.equal(zoneOf(g.engine, g.id("ps")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(SHRIEVER, "0:rule", "it triggers when THIS card enters play, not when another card does: a second character entering later picks nothing", () => {
  const g = shrieverBoard({ ps: "play", extra: [{ key: "other", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("other")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(SHRIEVER, "0:rule", "it also triggers when the Shriever is put into play by an effect (it 'enters play')", () => {
  const g = shrieverBoard({ ps: "discard", extra: [{ key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("ps")] } });
  assert.equal(zoneOf(g.engine, g.id("ps")), "play", "control");
  pickItem(g, "theirItem");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard");
  assert.equal(influenceOf(g.engine, P1), START - 2);
});

clause(SHRIEVER, "0:rule", "my faction loses exactly 2 influence: from 5 to 3", () => {
  const g = shrieverBoard({ influence: 5 });
  shriever(g, "theirItem");
  assert.equal(influenceOf(g.engine, P1), 3);
  assert.equal(g.engine.state.result, undefined);
});

clause(SHRIEVER, "0:rule", "it is influence LOSS, not damage: nothing is inflicted to the faction card", () => {
  const g = shrieverBoard();
  shriever(g, "theirItem");
  assert.equal(damageOf(g.engine, g.engine.state.players[P1].factionId!), 0);
  assert.deepEqual(damageAmounts(g.engine, g.engine.state.players[P1].factionId!), [], "no damage event for the faction");
});

clause(SHRIEVER, "0:rule", "my faction cannot lose more influence than it has: from 1 influence the loss of 2 leaves 0 (CR 410.4) and I lose the game", () => {
  const g = shrieverBoard({ influence: 1 });
  shriever(g, "theirItem");
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(SHRIEVER, "0:rule", "with exactly 2 influence the loss leaves me at 0 and my opponent wins", () => {
  const g = shrieverBoard({ influence: 2 });
  shriever(g, "theirItem");
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(SHRIEVER, "0:rule", "it deploys for 4 with [R][R] and has 3/4/1 stats (a dragon)", () => {
  const g = shrieverBoard({ noItems: true });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("ps"));
  assert.equal(before - ready(g.engine), 4);
  assert.equal(g.engine.getStat(g.id("ps"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("ps"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("ps"), "life"), 1);
  assert.deepEqual(printing(SHRIEVER).subtype, ["dragon"]);
  const one = shrieverBoard({ noItems: true, icons: { rage: 1, greed: 5 } });
  refused(() => playRaw(one.engine, P1, one.id("ps")), "one [R]");
});

// --- 1:ability:fly-away ---------------------------------------------------------------------------------

const flyAway = (g: ShrieverGame, item: string, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("ps"), "fly-away", { gone: [g.id(item)] });

clause(SHRIEVER, "1:ability:fly-away", "removes an item in my opponent's discard pile from the game and flips the Shriever face-down", () => {
  const g = shrieverBoard({ ps: "play" });
  actRaw(g.engine, P1, g.id("ps"), "fly-away", { gone: [g.id("dItem")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dItem")), "removed");
  assert.ok(removedOf(g.engine, P2).includes(g.id("dItem")), "removed from the game, out of their discard pile");
  assert.equal(discardOf(g.engine, P2).includes(g.id("dItem")), false);
  assert.equal(zoneOf(g.engine, g.id("ps")), "play");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
});

clause(SHRIEVER, "1:ability:fly-away", "the item is removed as a COST, when FLY AWAY is used: it is already out of the game while my opponent can respond", () => {
  const g = shrieverBoard({ ps: "play" });
  flyAway(g, "dItem")();
  assert.equal(zoneOf(g.engine, g.id("dItem")), "removed");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false, "the Shriever has not flipped yet");
  assert.equal(g.engine.state.priorityPlayerId, P2);
});

clause(SHRIEVER, "1:ability:fly-away", "only the picked item is removed: their other items in the discard pile stay", () => {
  const g = shrieverBoard({ ps: "play" });
  flyAway(g, "dItem2")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dItem")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dItem2")), "removed");
});

clause(SHRIEVER, "1:ability:fly-away", "it costs no resources", () => {
  const g = shrieverBoard({ ps: "play" });
  const before = ready(g.engine);
  flyAway(g, "dItem")();
  assert.equal(before - ready(g.engine), 0);
});

clause(SHRIEVER, "1:ability:fly-away", "the item must be in my OPPONENT's discard pile: an item in my own discard pile is refused", () => {
  const g = shrieverBoard({ ps: "play" });
  refused(flyAway(g, "myDItem"), "my own discard pile");
  assert.equal(zoneOf(g.engine, g.id("myDItem")), "discard");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
});

clause(SHRIEVER, "1:ability:fly-away", "it must be an ITEM: a character in their discard pile, an item in play and an item in their hand are refused", () => {
  const g = shrieverBoard({ ps: "play" });
  refused(flyAway(g, "dChar"), "a character in their discard pile");
  refused(flyAway(g, "theirItem"), "an item in play");
  refused(flyAway(g, "handItem"), "an item in their hand");
  refused(flyAway(g, "myItem"), "my item in play");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard");
  flyAway(g, "dItem")();
  assert.equal(zoneOf(g.engine, g.id("dItem")), "removed", "control: an item in their discard pile works");
});

clause(SHRIEVER, "1:ability:fly-away", "with no item in my opponent's discard pile it cannot be used; exactly one item is picked", () => {
  const g = shrieverBoard({ ps: "play", extra: [] });
  refused(() => actRaw(g.engine, P1, g.id("ps"), "fly-away", {}), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("ps"), "fly-away", { gone: [g.id("dItem"), g.id("dItem2")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("dItem")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dItem2")), "discard");
  const none = devBoard([{ key: "ps", def: printing(SHRIEVER), owner: P1, zone: "play" }]);
  refused(() => actRaw(none.engine, P1, none.id("ps"), "fly-away", {}), "their discard pile is empty");
});

clause(SHRIEVER, "1:ability:fly-away", "a face-down Shriever (a resource) has no FLY AWAY", () => {
  const g = shrieverBoard({ ps: "faceDown" });
  refused(flyAway(g, "dItem"), "a face-down card has no abilities", /cannot be activated|Activated ability not found/);
  assert.equal(zoneOf(g.engine, g.id("dItem")), "discard");
});

clause(SHRIEVER, "1:ability:fly-away", "only the Shriever's controller can use FLY AWAY", () => {
  const g = shrieverBoard({ ps: "play", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(flyAway(g, "myDItem", P2), "my opponent cannot use my Shriever");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
});

clause(SHRIEVER, "1:ability:fly-away", "it can be used in response on my opponent's turn", () => {
  const g = shrieverBoard({ ps: "play", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flyAway(g, "dItem")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("dItem")), "removed");
});

clause(SHRIEVER, "1:ability:fly-away", "the Shriever flips face-down 'under its owner's control': a Shriever I took from its owner returns face-down to its OWNER", () => {
  const g = shrieverBoard({ ps: "play", owner: P2, controller: P1 });
  flyAway(g, "dItem")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("ps")].controllerId, P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("ps")), "playOf(g.engine, P2).includes(g.id(\"ps\"))");
});

clause(SHRIEVER, "1:ability:fly-away", "if the Shriever leaves play in response, the item stays removed (the cost was paid)", () => {
  const g = shrieverBoard({ ps: "play", extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  flyAway(g, "dItem")();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("ps")] });
  assert.equal(zoneOf(g.engine, g.id("ps")), "discard", "control: it was destroyed");
  assert.equal(zoneOf(g.engine, g.id("dItem")), "removed");
});

clause(SHRIEVER, "1:ability:fly-away", "once face-down it is a resource that provides Volition, and flipping it does not trigger its enters-play pick", () => {
  const g = shrieverBoard({ ps: "play" });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  flyAway(g, "dItem")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "a face-down card has no triggered abilities");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
  assert.equal(influenceOf(g.engine, P1), START);
});

// --- 2:flipUp: 3 [R][R] -------------------------------------------------------------------------------

const flipShriever = (g: ShrieverGame, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("ps"));
const flipBoardPs = (opts: Parameters<typeof shrieverBoard>[0] = {}) => shrieverBoard({ ps: "faceDown", ...opts });

clause(SHRIEVER, "2:flipUp", "a face-down Shriever is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = flipBoardPs({ icons: { rage: 2 } });
  assert.equal(g.engine.isResource(g.id("ps")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(SHRIEVER, "2:flipUp", "flipping it up puts the character face-up into play under my control, and its enters-play pick follows", () => {
  const g = flipBoardPs();
  flipShriever(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ps")), "play");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("ps")].controllerId, P1);
  expectPending(g.engine, "selectTargets");
  pickItem(g, "theirItem");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard", "'when this card enters play' also happens when it is flipped up");
  assert.equal(influenceOf(g.engine, P1), START - 2);
});

clause(SHRIEVER, "2:flipUp", "FLIP UP costs 3 (not the card's cost number of 4): with exactly three ready resources, itself included, it works", () => {
  const g = flipBoardPs({ icons: { rage: 2 }, noItems: true });
  assert.equal(ready(g.engine), 3);
  flipShriever(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
});

clause(SHRIEVER, "2:flipUp", "FLIP UP costs 3: two ready resources are refused and nothing changes", () => {
  const g = flipBoardPs({ icons: { rage: 1 }, extra: spentRage(3) });
  assert.equal(ready(g.engine), 2);
  refused(() => flipShriever(g), "two ready resources for a Flip Up cost of 3");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
  assert.equal(ready(g.engine), 2);
});

clause(SHRIEVER, "2:flipUp", "FLIP UP pays 3 and no more: with many resources at most three end up spent", () => {
  const g = flipBoardPs({ icons: { rage: 9 }, noItems: true });
  flipShriever(g);
  resolvePendingResponses(g.engine);
  assert.ok(attachedCount(g.engine, P1) <= 3, "attachedCount(g.engine, P1) <= 3");
  assert.ok(attachedCount(g.engine, P1) >= 2, "attachedCount(g.engine, P1) >= 2");
});

clause(SHRIEVER, "2:flipUp", "FLIP UP needs [R][R]: one [R] among many other resources is refused, two are accepted; Volition and the opponent's [R] do not count", () => {
  const one = flipBoardPs({ icons: { rage: 1, greed: 6 } });
  refused(() => flipShriever(one), "one [R]");
  assert.equal(one.engine.state.cards[one.id("ps")].faceDown, true);
  const theirs = flipBoardPs({ icons: { rage: 1, greed: 5 }, oppIcons: { rage: 4 } });
  refused(() => flipShriever(theirs), "only one [R] of my own");
  const two = flipBoardPs({ icons: { rage: 2, greed: 2 }, noItems: true });
  flipShriever(two);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("ps")].faceDown, false, "control: two [R]");
});

clause(SHRIEVER, "2:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = flipBoardPs({ oppIcons: { rage: 6 } });
  refused(() => flipShriever(theirs, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("ps")].faceDown, true);
  const inHand = shrieverBoard({ ps: "hand" });
  refused(() => flipShriever(inHand), "in my hand it is not a face-down resource");
  const faceUp = shrieverBoard({ ps: "play" });
  refused(() => flipShriever(faceUp), "a face-up card in play");
});

clause(SHRIEVER, "2:flipUp", "a character is flipped up like it is deployed (CR 507.4d): refused on my opponent's turn when no response window is open", () => {
  const g = flipBoardPs({ turn: 2, active: P2 });
  refused(() => flipShriever(g), "my opponent's turn, no window");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
});

clause(SHRIEVER, "2:flipUp", "a character can only be deployed on my own turn, so FLIP UP is refused INSIDE my opponent's response window too (CR 507.4d)", () => {
  const g = flipBoardPs({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "control: I hold priority in their attack window");
  refused(() => flipShriever(g), "a character cannot be deployed in response, so it cannot be flipped up in response");
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, true);
});

clause(SHRIEVER, "2:flipUp", "a flipped-up Shriever cannot attack that turn (it is a new card that did not start the turn in play)", () => {
  const g = flipBoardPs({ noItems: true });
  flipShriever(g);
  resolvePendingResponses(g.engine);
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("ps")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
});

clause(SHRIEVER, "2:flipUp", "a face-down Plunging Shriever that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = flipBoardPs({ psSpent: true, noItems: true });
  flipShriever(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ps")].faceDown, false);
});

clause(SHRIEVER, "2:flipUp", "a flipped-up character is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = flipBoardPs({ noItems: true });
  holdFlipUp(() => flipShriever(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(g.engine.state.cards[g.id("ps")].zone, "deploying", "it has not entered play yet: it is being deployed");
});


// =================================================================================
// Spiky Pumpkin
// This card enters play with 3 tokens on it.
// At the start of your turn, remove a token from this card. If there are no tokens on it,
// destroy it.
// At the end of your turn, you may pick a character. If you do, inflict X damage to that
// character, where X is the number of tokens on this card.
// Item, cost 4, [R][R][R].
// =================================================================================

const PUMPKIN = "2d8037fa-f57b-4695-bf7a-aac71fc74e2e";

function pumpkinBoard(
  opts: {
    pk?: "hand" | "play" | "faceDown" | "discard";
    tokens?: number;
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.pk ?? "play";
  return devBoard(
    [
      {
        key: "pk",
        def: printing(PUMPKIN),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        counters: opts.tokens !== undefined ? { token: opts.tokens } : undefined
      },
      { key: "mine", def: character({ name: "My Character", life: 20 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Their Character", life: 20 }), owner: P2, zone: "play" },
      { key: "frail", def: character({ name: "Their Frail Character", life: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Some Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Some Place", structure: 20 }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: mulberry(5) }
  );
}

type PumpkinGame = ReturnType<typeof pumpkinBoard>;

/** `player` ends their turn; if the Pumpkin asks for a pick, `pick` answers it (undefined = decline). Returns whether a pick was asked. */
function endTurnPicking(g: PumpkinGame, player: PlayerId, pick: string | undefined): boolean {
  let asked = false;
  g.engine.perform({ type: "endTurn", playerId: player });
  let guard = 0;
  while (guard++ < 10) {
    resolvePendingResponses(g.engine);
    const pc = pending(g.engine);
    if (!pc) break;
    if (pc.kind === "selectTargets" || pc.kind === "chooserSelectsTarget") {
      asked = true;
      const choice =
        pc.kind === "selectTargets"
          ? { kind: "selectTargets", selected: { vic: pick ? [g.id(pick)] : [] } }
          : { kind: "chooserSelectsTarget", selected: pick ? [g.id(pick)] : [] };
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    } else {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    }
  }
  return asked;
}

const tokens = (g: PumpkinGame, key = "pk") => tokensOn(g.engine, g.id(key));

// --- 0:rule: enters play with 3 tokens ----------------------------------------------------------------

clause(PUMPKIN, "0:rule", "deployed from my hand it enters play with exactly 3 tokens", () => {
  const g = pumpkinBoard({ pk: "hand", icons: { rage: 4 } });
  play(g.engine, P1, g.id("pk"));
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
  assert.equal(tokens(g), 3);
});

clause(PUMPKIN, "0:rule", "put into play by an effect it also enters with 3 tokens", () => {
  const g = pumpkinBoard({ pk: "discard", extra: [{ key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("pk")] } });
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
  assert.equal(tokens(g), 3);
});

clause(PUMPKIN, "0:rule", "only this card gets the tokens: nothing else I control or they control has any, and two Pumpkins each get 3", () => {
  const g = pumpkinBoard({ pk: "hand", icons: { rage: 8 }, extra: [{ key: "pk2", def: printing(PUMPKIN), owner: P1, zone: "play", counters: { token: 1 } }] });
  play(g.engine, P1, g.id("pk"));
  drain(g.engine, declineAll);
  assert.equal(tokens(g), 3);
  assert.equal(tokens(g, "pk2"), 1, "the Pumpkin already in play is untouched");
  for (const key of ["mine", "theirs", "frail", "thing", "place"]) assert.equal(tokens(g, key), 0, `${key} has no tokens`);
});

clause(PUMPKIN, "0:rule", "a Pumpkin already in play does not get tokens when another card enters play", () => {
  const g = pumpkinBoard({ tokens: 1, extra: [{ key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("newcomer")] } });
  assert.equal(tokens(g), 1);
});

clause(PUMPKIN, "0:rule", "it deploys for 4 with [R][R][R] and has no other stats (an item)", () => {
  const g = pumpkinBoard({ pk: "hand", icons: { rage: 4 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("pk"));
  assert.equal(before - ready(g.engine), 4);
  const exactThree = pumpkinBoard({ pk: "hand", icons: { rage: 3, greed: 1 } });
  play(exactThree.engine, P1, exactThree.id("pk"));
  assert.equal(zoneOf(exactThree.engine, exactThree.id("pk")), "play", "exactly three [R] meet the threshold");
  const two = pumpkinBoard({ pk: "hand", icons: { rage: 2, greed: 4 } });
  refused(() => playRaw(two.engine, P1, two.id("pk")), "two [R]");
  const short = pumpkinBoard({ pk: "hand", icons: { rage: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("pk")), "three resources for a cost of 4");
});

clause(PUMPKIN, "0:rule", "tokens disappear when it leaves play (CR 409.2): a Pumpkin with 2 tokens that is bounced and deployed again enters with exactly 3", () => {
  const g = pumpkinBoard({ tokens: 2, icons: { rage: 4 }, extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("pk")] } });
  assert.equal(zoneOf(g.engine, g.id("pk")), "hand");
  assert.equal(tokens(g), 0, "the tokens disappeared when it left play");
  play(g.engine, P1, g.id("pk"));
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
  assert.equal(tokens(g), 3);
});

// --- 1:rule: at the start of your turn remove a token; if none, destroy ----------------------------------

/** My turn 1 is over and it is my opponent's turn 2; then their turn ends: it is my turn 3 and the start-of-turn triggers have run. */
function toMyNextTurn(g: PumpkinGame): void {
  endTurnPicking(g, P1, undefined);
  assert.equal(g.engine.state.activePlayerId, P2);
  endTurnPicking(g, P2, undefined);
  assert.equal(g.engine.state.activePlayerId, P1);
}

clause(PUMPKIN, "1:rule", "at the start of my turn it loses one token: 3 become 2", () => {
  const g = pumpkinBoard({ tokens: 3 });
  toMyNextTurn(g);
  assert.equal(tokens(g), 2);
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
});

clause(PUMPKIN, "1:rule", "it loses exactly one token each turn: 2 become 1 and it stays in play", () => {
  const g = pumpkinBoard({ tokens: 2 });
  toMyNextTurn(g);
  assert.equal(tokens(g), 1);
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
});

clause(PUMPKIN, "1:rule", "removing the last token destroys it: 1 token becomes 0 and the Pumpkin goes to its owner's discard pile", () => {
  const g = pumpkinBoard({ tokens: 1 });
  toMyNextTurn(g);
  assert.equal(zoneOf(g.engine, g.id("pk")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("pk")), "discardOf(g.engine, P1).includes(g.id(\"pk\"))");
});

clause(PUMPKIN, "1:rule", "with no tokens at the start of my turn it is destroyed (there are no tokens on it)", () => {
  const g = pumpkinBoard({ tokens: 0 });
  toMyNextTurn(g);
  assert.equal(zoneOf(g.engine, g.id("pk")), "discard");
});

clause(PUMPKIN, "1:rule", "it does not lose a token at the start of my OPPONENT's turn", () => {
  const g = pumpkinBoard({ tokens: 3 });
  endTurnPicking(g, P1, undefined);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokens(g), 3);
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
});

clause(PUMPKIN, "1:rule", "'your turn' is the controller's: a Pumpkin I own but my opponent controls loses a token at the start of THEIR turn and not of mine", () => {
  const g = pumpkinBoard({ tokens: 3, controller: P2 });
  endTurnPicking(g, P1, undefined);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokens(g), 2, "their turn started");
  endTurnPicking(g, P2, undefined);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokens(g), 2, "my turn started: no change");
});

clause(PUMPKIN, "1:rule", "a Pumpkin in my hand or my discard pile does nothing at the start of my turn", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = pumpkinBoard({ pk: where, tokens: 1 });
    toMyNextTurn(g);
    assert.equal(zoneOf(g.engine, g.id("pk")), where);
  }
});

clause(PUMPKIN, "1:rule", "a face-down Pumpkin is only a resource (CR 411.1): its text is dormant", () => {
  const g = pumpkinBoard({ pk: "faceDown", tokens: 1 });
  toMyNextTurn(g);
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
  assert.equal(g.engine.state.cards[g.id("pk")].faceDown, true);
});

clause(PUMPKIN, "1:rule", "whole life: 3 tokens at deploy, 2 at my next turn, 1 at the one after, destroyed at the third start of turn", () => {
  const g = pumpkinBoard({ tokens: 3 });
  toMyNextTurn(g);
  assert.equal(tokens(g), 2);
  toMyNextTurn(g);
  assert.equal(tokens(g), 1);
  assert.equal(zoneOf(g.engine, g.id("pk")), "play");
  toMyNextTurn(g);
  assert.equal(zoneOf(g.engine, g.id("pk")), "discard");
});

// --- 2:rule: at the end of your turn, X damage to a picked character ---------------------------------------

clause(PUMPKIN, "2:rule", "at the end of my turn I may pick a character: it takes X damage where X is the number of tokens (3)", () => {
  const g = pumpkinBoard({ tokens: 3 });
  const asked = endTurnPicking(g, P1, "theirs");
  assert.ok(asked, "I was asked to pick a character");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), [3]);
});

clause(PUMPKIN, "2:rule", "X is the number of tokens on the Pumpkin: 1 token inflicts 1, 2 tokens inflict 2, 5 tokens inflict 5", () => {
  for (const n of [1, 2, 5]) {
    const g = pumpkinBoard({ tokens: n });
    endTurnPicking(g, P1, "theirs");
    assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), [n], `${n} tokens`);
  }
});

clause(PUMPKIN, "2:rule", "with no tokens on it the damage is 0: nothing is inflicted", () => {
  const g = pumpkinBoard({ tokens: 0 });
  endTurnPicking(g, P1, "theirs");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
});

clause(PUMPKIN, "2:rule", "'you may': declining the pick inflicts no damage", () => {
  const g = pumpkinBoard({ tokens: 3 });
  const asked = endTurnPicking(g, P1, undefined);
  assert.ok(asked, "control: I was asked");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
  assert.deepEqual(damageAmounts(g.engine, g.id("mine")), []);
  assert.deepEqual(damageAmounts(g.engine, g.id("frail")), []);
});

clause(PUMPKIN, "2:rule", "any character can be picked: mine as well as theirs", () => {
  const g = pumpkinBoard({ tokens: 2 });
  endTurnPicking(g, P1, "mine");
  assert.deepEqual(damageAmounts(g.engine, g.id("mine")), [2]);
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
});

clause(PUMPKIN, "2:rule", "only the picked character takes the damage", () => {
  const g = pumpkinBoard({ tokens: 2 });
  endTurnPicking(g, P1, "theirs");
  assert.deepEqual(damageAmounts(g.engine, g.id("mine")), []);
  assert.deepEqual(damageAmounts(g.engine, g.id("frail")), []);
});

clause(PUMPKIN, "2:rule", "enough damage destroys the picked character: 3 damage destroys a 2-life character", () => {
  const g = pumpkinBoard({ tokens: 3 });
  endTurnPicking(g, P1, "frail");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("frail")), "discardOf(g.engine, P2).includes(g.id(\"frail\"))");
});

clause(PUMPKIN, "2:rule", "only a CHARACTER can be picked: an item, a location, a face-down card, a faction and a card in hand are refused", () => {
  const g = pumpkinBoard({ tokens: 3, extra: [{ key: "fdc", def: character({ name: "Hidden Character", life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["the Pumpkin itself", g.id("pk")],
    ["a card in hand", g.id("handChar")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { vic: [cid] } } } as never), what);
  }
  assert.ok(pending(g.engine), "the prompt is still open");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { vic: [g.id("theirs")] } } } as never);
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), [3], "control: a character works");
});

clause(PUMPKIN, "2:rule", "exactly one character: two are refused", () => {
  const g = pumpkinBoard({ tokens: 3 });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "selectTargets");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { vic: [g.id("theirs"), g.id("mine")] } } } as never), "two characters");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
});

clause(PUMPKIN, "2:rule", "'your turn': at the end of my OPPONENT's turn my Pumpkin does not ask for a pick and inflicts nothing", () => {
  const g = pumpkinBoard({ tokens: 3, turn: 2, active: P2 });
  const asked = endTurnPicking(g, P2, "theirs");
  assert.equal(asked, false);
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
  assert.deepEqual(damageAmounts(g.engine, g.id("mine")), []);
});

clause(PUMPKIN, "2:rule", "'your' is the controller's: a Pumpkin I own but my opponent controls asks THEM at the end of their turn", () => {
  const g = pumpkinBoard({ tokens: 3, controller: P2, turn: 2, active: P2 });
  g.engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P2, "its controller picks");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "selectTargets", selected: { vic: [g.id("mine")] } } } as never);
  assert.deepEqual(damageAmounts(g.engine, g.id("mine")), [3]);
});

clause(PUMPKIN, "2:rule", "the count is taken after the start-of-turn token removal: on the next turn the lob is 2", () => {
  const g = pumpkinBoard({ tokens: 3 });
  toMyNextTurn(g);
  assert.equal(tokens(g), 2);
  endTurnPicking(g, P1, "theirs");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), [2]);
});

clause(PUMPKIN, "2:rule", "a Pumpkin in my hand, my discard pile or face-down inflicts nothing at the end of my turn", () => {
  for (const where of ["hand", "discard", "faceDown"] as const) {
    const g = pumpkinBoard({ pk: where, tokens: 3 });
    const asked = endTurnPicking(g, P1, "theirs");
    assert.equal(asked, false, `Pumpkin ${where}`);
    assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
  }
});

clause(PUMPKIN, "2:rule", "two Pumpkins each inflict their own tokens' worth of damage at the end of my turn (3 and 1)", () => {
  const g = pumpkinBoard({ tokens: 3, extra: [{ key: "pk2", def: printing(PUMPKIN), owner: P1, zone: "play", counters: { token: 1 } }] });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  let asked = 0;
  let guard = 0;
  while (guard++ < 10) {
    resolvePendingResponses(g.engine);
    const pc = pending(g.engine);
    if (!pc) break;
    if (pc.kind === "selectTargets") {
      asked++;
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "selectTargets", selected: { vic: [g.id("theirs")] } } } as never);
    } else {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    }
  }
  assert.equal(asked, 2);
  assert.deepEqual([...damageAmounts(g.engine, g.id("theirs"))].sort(), [1, 3]);
});

clause(PUMPKIN, "2:rule", "'At the end of your turn' happens after my opponent has finished responding (CR 610.1a): while they can respond nothing has been picked or damaged yet", () => {
  const g = pumpkinBoard({ tokens: 3 });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.ok(g.engine.state.responseWindow, "control: my opponent has a chance to respond to the end of my turn");
  assert.equal(pending(g.engine), undefined, "I am not asked to pick before the turn actually ends");
  assert.deepEqual(damageAmounts(g.engine, g.id("theirs")), []);
});


// =================================================================================
// Spry Archer
// If this card attacks, inflict 1 damage to your opponent's faction.
// [R][R][R][R]: If this card attacks, you may pick a character. If you do, inflict 1 damage to it.
// Character (soldier), cost 2, [R][R], 2 strength / 4 speed / 1 life.
// =================================================================================

const ARCHER = "98321c0c-3aef-4820-8636-9353e3c8a3b0";

function archerBoard(
  opts: {
    sa?: "play" | "hand" | "faceDown";
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.sa ?? "play";
  return devBoard(
    [
      { key: "sa", def: printing(ARCHER), owner: opts.owner ?? P1, controller: opts.controller, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "frail", def: character({ name: "Frail Foe", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeAtk", def: character({ name: "Foe Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "An Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Their Place", structure: 20 }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ArcherGame = ReturnType<typeof archerBoard>;

/**
 * `player` attacks with `attackers` (target: the opponent's faction unless given) and answers whatever the Archer's triggers ask:
 * the "may pick a character" prompt with `pick` (undefined = decline), trigger ordering by taking the first. Returns whether a pick was asked.
 */
function archerAttacks(
  g: ArcherGame,
  player: PlayerId,
  attackers: string[],
  pick?: string,
  target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId }
): boolean {
  let asked = false;
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: attackers.map((k) => g.id(k)), target: target ?? { type: "faction", playerId: other(player) } });
  let guard = 0;
  while (pending(g.engine) && guard++ < 10) {
    const pc = pending(g.engine)!;
    if (pc.kind === "selectTargets") {
      asked = true;
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "selectTargets", selected: { c: pick ? [g.id(pick)] : [] } } } as never);
    } else {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    }
  }
  return asked;
}

/** Finishes an attack the Archer started: nobody blocks, damage is dealt. */
function finishUnblocked(g: ArcherGame, defender: PlayerId): void {
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] });
  finishBattle(g.engine);
}

// --- 0:rule: inflict 1 damage to the opponent's faction when it attacks -------------------------------

clause(ARCHER, "0:rule", "when it attacks, my opponent's faction takes 1 damage (loses 1 influence) at once, before blockers", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"]);
  assert.equal(influenceOf(g.engine, P2), START - 1);
  assert.equal(influenceOf(g.engine, P1), START, "my faction is not hurt");
});

clause(ARCHER, "0:rule", "the faction takes it as damage: a damage event of 1 with the Archer as its source", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"]);
  assert.deepEqual(damageAmounts(g.engine, g.engine.state.players[P2].factionId!), [1]);
});

clause(ARCHER, "0:rule", "the 1 damage is in addition to the battle damage: unblocked, the Archer's 2 strength follows (3 influence in all)", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"]);
  finishUnblocked(g, P2);
  assert.equal(influenceOf(g.engine, P2), START - 3);
});

clause(ARCHER, "0:rule", "it does not matter whether it is blocked: the 1 damage to the faction happens when it attacks", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"]);
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] });
  finishBattle(g.engine);
  assert.equal(influenceOf(g.engine, P2), START - 1, "only the attack trigger reached the faction");
});

clause(ARCHER, "0:rule", "attacking a LOCATION still inflicts 1 damage to my opponent's faction", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"], undefined, { type: "card", cardId: g.id("place") });
  assert.equal(influenceOf(g.engine, P2), START - 1);
  assert.equal(damageOf(g.engine, g.id("place")), 0, "the location has not been hit yet");
});

clause(ARCHER, "0:rule", "attacking in a party with others: it is the Archer that attacks, so the faction takes 1 (not 1 per attacker)", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa", "ally"]);
  assert.equal(influenceOf(g.engine, P2), START - 1);
});

clause(ARCHER, "0:rule", "another character attacking without the Archer inflicts nothing", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["ally"]);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARCHER, "0:rule", "blocking is not attacking: the Archer blocking my opponent's attack inflicts no damage", () => {
  const g = archerBoard({ turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foeAtk")]);
  declareBlockers(g.engine, P1, [g.id("sa")]);
  finishBattle(g.engine);
  assert.equal(influenceOf(g.engine, P2), START);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(ARCHER, "0:rule", "it triggers every time it attacks: attacks on two different turns inflict 1 each", () => {
  const g = archerBoard();
  archerAttacks(g, P1, ["sa"]);
  finishUnblocked(g, P2);
  assert.equal(influenceOf(g.engine, P2), START - 3, "1 from the attack and 2 battle damage");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  archerAttacks(g, P1, ["sa"]);
  assert.equal(influenceOf(g.engine, P2), START - 4, "another 1 when it attacks again");
});

clause(ARCHER, "0:rule", "'your opponent's faction' follows the Archer's controller: an Archer I own but my opponent controls hurts MY faction when they attack with it", () => {
  const g = archerBoard({ controller: P2, turn: 2, active: P2 });
  archerAttacks(g, P2, ["sa"]);
  assert.equal(influenceOf(g.engine, P1), START - 1);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARCHER, "0:rule", "an Archer in my hand or face-down does nothing: face-down cards cannot attack", () => {
  const down = archerBoard({ sa: "faceDown" });
  refused(() => down.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [down.id("sa")], target: { type: "faction", playerId: P2 } }), "a face-down card is not a character");
  assert.equal(influenceOf(down.engine, P2), START);
});

clause(ARCHER, "0:rule", "a freshly deployed Archer cannot attack that turn, so it inflicts nothing that turn", () => {
  const g = archerBoard({ sa: "hand", icons: { rage: 2 } });
  play(g.engine, P1, g.id("sa"));
  assert.equal(zoneOf(g.engine, g.id("sa")), "play");
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("sa")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARCHER, "0:rule", "it deploys for 2 with [R][R] and has 2/4/1 stats (a soldier)", () => {
  const g = archerBoard({ sa: "hand", icons: { rage: 2 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("sa"));
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.getStat(g.id("sa"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("sa"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("sa"), "life"), 1);
  const one = archerBoard({ sa: "hand", icons: { rage: 1, greed: 4 } });
  refused(() => playRaw(one.engine, P1, one.id("sa")), "one [R]");
  const short = archerBoard({ sa: "hand", icons: { rage: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("sa")), "one resource for a cost of 2");
});

// --- 1:rule@rrrr: with [R][R][R][R], when it attacks I may pick a character and inflict 1 damage to it ---------

clause(ARCHER, "1:rule@rrrr", "with [R]x4 I am asked to pick a character when it attacks, and the picked character takes 1 damage", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  const asked = archerAttacks(g, P1, ["sa"], "foe");
  assert.ok(asked, "I was asked to pick");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(ARCHER, "1:rule@rrrr", "both paragraphs apply together: the faction takes 1 AND the picked character takes 1", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  archerAttacks(g, P1, ["sa"], "foe");
  assert.equal(influenceOf(g.engine, P2), START - 1);
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(ARCHER, "1:rule@rrrr", "with only [R]x3 the paragraph is off: no pick is offered and nobody takes the extra damage", () => {
  const g = archerBoard({ icons: { rage: 3, greed: 4 } });
  const asked = archerAttacks(g, P1, ["sa"], "foe");
  assert.equal(asked, false);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(influenceOf(g.engine, P2), START - 1, "control: the unconditional paragraph still works");
});

clause(ARCHER, "1:rule@rrrr", "more than four [R] do not repeat it: with [R]x8 there is one pick and 1 damage", () => {
  const g = archerBoard({ icons: { rage: 8 } });
  const asked = archerAttacks(g, P1, ["sa"], "foe");
  assert.ok(asked, "asked");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(ARCHER, "1:rule@rrrr", "spent [R] still count (icons are never spent), and so does an Embittered Cadet's [R]", () => {
  const spent = archerBoard({ extra: spentRage(4) });
  assert.ok(archerAttacks(spent, P1, ["sa"], "foe"), "archerAttacks(spent, P1, [\"sa\"], \"foe\")");
  assert.equal(damageOf(spent.engine, spent.id("foe")), 1);
  const cadet = archerBoard({ icons: { rage: 3 }, extra: [{ key: "cadet", def: printing(CADET), owner: P1, zone: "play" }] });
  assert.ok(archerAttacks(cadet, P1, ["sa"], "foe"), "archerAttacks(cadet, P1, [\"sa\"], \"foe\")");
  assert.equal(damageOf(cadet.engine, cadet.id("foe")), 1);
});

clause(ARCHER, "1:rule@rrrr", "Volition and my opponent's [R] do not count toward [R]x4", () => {
  const down = archerBoard({ icons: { rage: 2 }, extra: volition(5) });
  assert.equal(archerAttacks(down, P1, ["sa"], "foe"), false);
  const theirs = archerBoard({ icons: { rage: 2 }, oppIcons: { rage: 5 } });
  assert.equal(archerAttacks(theirs, P1, ["sa"], "foe"), false);
});

clause(ARCHER, "1:rule@rrrr", "'you may': declining the pick inflicts nothing, and the faction still takes its 1", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  const asked = archerAttacks(g, P1, ["sa"], undefined);
  assert.ok(asked, "control: I was asked");
  for (const key of ["foe", "frail", "ally", "foeAtk"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} is untouched`);
  assert.equal(influenceOf(g.engine, P2), START - 1);
});

clause(ARCHER, "1:rule@rrrr", "any character can be picked: mine too", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  archerAttacks(g, P1, ["sa"], "ally");
  assert.equal(damageOf(g.engine, g.id("ally")), 1);
});

clause(ARCHER, "1:rule@rrrr", "the damage is exactly 1 to the picked character only: a 1-life character is destroyed, the others are untouched", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  archerAttacks(g, P1, ["sa"], "frail");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(damageOf(g.engine, g.id("ally")), 0);
});

clause(ARCHER, "1:rule@rrrr", "it may pick the Archer itself: a character is a character (it has 1 life and is destroyed)", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  archerAttacks(g, P1, ["sa"], "sa");
  assert.equal(zoneOf(g.engine, g.id("sa")), "discard");
});

clause(ARCHER, "1:rule@rrrr", "only a CHARACTER can be picked: an item, a location, a face-down card, a faction and a card in hand are refused", () => {
  const g = archerBoard({ icons: { rage: 4 }, extra: [{ key: "fdc", def: character({ name: "Hidden Character", life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("sa")], target: { type: "faction", playerId: P2 } });
  let guard = 0;
  while (pending(g.engine)?.kind === "orderTriggers" && guard++ < 3) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: declineAll(pending(g.engine)!) } as never);
  expectPending(g.engine, "selectTargets");
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["a card in hand", g.id("handChar")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [cid] } } } as never), what);
  }
  assert.ok(pending(g.engine), "the prompt is still open");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [g.id("foe")] } } } as never);
  assert.equal(damageOf(g.engine, g.id("foe")), 1, "control: a character works");
});

clause(ARCHER, "1:rule@rrrr", "exactly one character: two are refused", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("sa")], target: { type: "faction", playerId: P2 } });
  let guard = 0;
  while (pending(g.engine)?.kind === "orderTriggers" && guard++ < 3) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: declineAll(pending(g.engine)!) } as never);
  expectPending(g.engine, "selectTargets");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [g.id("foe"), g.id("frail")] } } } as never), "two characters");
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(ARCHER, "1:rule@rrrr", "only when THIS card attacks: another character attacking with [R]x4 in play asks for no pick", () => {
  const g = archerBoard({ icons: { rage: 4 } });
  assert.equal(archerAttacks(g, P1, ["ally"], "foe"), false);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(ARCHER, "1:rule@rrrr", "blocking is not attacking: the Archer blocking with [R]x4 asks for no pick", () => {
  const g = archerBoard({ icons: { rage: 4 }, turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foeAtk")]);
  declareBlockers(g.engine, P1, [g.id("sa")]);
  assert.equal(pending(g.engine)?.kind === "selectTargets", false);
});

clause(ARCHER, "1:rule@rrrr", "the threshold is judged when it attacks: [R]x4 gained before the attack counts, [R]x3 does not", () => {
  const g = archerBoard({ icons: { rage: 3 }, extra: [{ key: "hrage", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }] });
  developResource(g.engine, P1, g.id("hrage"), false);
  assert.equal(g.engine.getThresholds(P1).rage ?? 0, 4);
  assert.ok(archerAttacks(g, P1, ["sa"], "foe"), "archerAttacks(g, P1, [\"sa\"], \"foe\")");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(ARCHER, "1:rule@rrrr", "'your' [R]: an Archer I own but my opponent controls uses THEIR [R] (with [R]x4 of theirs it asks THEM to pick)", () => {
  const g = archerBoard({ controller: P2, turn: 2, active: P2, oppIcons: { rage: 4 } });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("sa")], target: { type: "faction", playerId: P1 } });
  let guard = 0;
  while (pending(g.engine)?.kind === "orderTriggers" && guard++ < 3) g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: declineAll(pending(g.engine)!) } as never);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P2);
});


// =================================================================================
// Surplus Soldier
// If this card is destroyed, flip it face-down under its owner's control instead.
// Character (soldier), cost 1, [R][R], 1 strength / 3 speed / 1 life.
// =================================================================================

/** A free tactic (id "da", pick "t"): destroys the picked card in play, whatever it is (even a face-down card). */
function destroyAnyTactic(name = "Destroy Anything"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "da", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
}

/** A free tactic (id "dall"): destroys every character in play. */
function destroyAllTactic(name = "Destroy All Characters"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "dall", type: "activated", effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }]
    }
  });
}

function surplusBoard(
  opts: {
    ss?: "play" | "hand" | "discard" | "faceDown";
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.ss ?? "play";
  return devBoard(
    [
      { key: "ss", def: printing(SURPLUS), owner: opts.owner ?? P1, controller: opts.controller, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type SurplusGame = ReturnType<typeof surplusBoard>;

/** The state after the Soldier was "destroyed": still in play, face-down, whose control, and where it is not. */
const surplusFlags = (g: SurplusGame) => ({
  zone: zoneOf(g.engine, g.id("ss")),
  faceDown: g.engine.state.cards[g.id("ss")].faceDown,
  controller: g.engine.state.cards[g.id("ss")].controllerId
});

clause(SURPLUS, "0:rule", "destroyed by my opponent's effect, it is flipped face-down under its owner's control instead: it stays in play as a face-down card", () => {
  const g = surplusBoard({ turn: 2, active: P2, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
  assert.equal(discardOf(g.engine, P1).includes(g.id("ss")), false, "it is not in the discard pile");
});

clause(SURPLUS, "0:rule", "destroyed on my own turn by my own tactic: the same replacement (it is flipped face-down, not destroyed)", () => {
  const g = surplusBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
});

clause(SURPLUS, "0:rule", "as a face-down card it is a resource: it provides Volition, is a spendable resource and is no longer a character", () => {
  const g = surplusBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  const readyBefore = ready(g.engine);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.equal(g.engine.isResource(g.id("ss")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(ready(g.engine), readyBefore + 1);
  assert.equal(g.engine.state.cards[g.id("ss")].attachedTo, undefined, "it enters as a new, unspent resource");
});

clause(SURPLUS, "0:rule", "the replacement leaves no damage or depletion behind (a new card, CR 411.4): lethal damage flips it face-down with 0 damage", () => {
  const g = surplusBoard({ extra: [{ key: "hit", def: damageTactic(5), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
  assert.equal(damageOf(g.engine, g.id("ss")), 0);
  assert.equal(g.engine.state.cards[g.id("ss")].depleted, false);
});

clause(SURPLUS, "0:rule", "exactly the lethal damage (1 damage against its 1 life) also flips it instead of destroying it", () => {
  const g = surplusBoard({ extra: [{ key: "hit", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("ss")] } });
  assert.equal(surplusFlags(g).faceDown, true);
  assert.equal(surplusFlags(g).zone, "play");
});

clause(SURPLUS, "0:rule", "destroyed as a blocker by battle damage: it is flipped face-down and removed from the battle", () => {
  const g = surplusBoard({ turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [g.id("ss")]);
  finishBattle(g.engine);
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
  assert.equal(discardOf(g.engine, P1).includes(g.id("ss")), false);
});

clause(SURPLUS, "0:rule", "destroyed as an attacker by battle damage: it is flipped face-down too", () => {
  const g = surplusBoard();
  declareAttackBy(g.engine, P1, [g.id("ss")]);
  declareBlockers(g.engine, P2, [g.id("foe")]);
  finishBattle(g.engine);
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
});

clause(SURPLUS, "0:rule", "'under its owner's control': a Soldier I own but my opponent controls is flipped face-down under MY control", () => {
  const g = surplusBoard({ controller: P2, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
  assert.ok(playOf(g.engine, P1).includes(g.id("ss")), "it is in my play area");
  assert.equal(playOf(g.engine, P2).includes(g.id("ss")), false, "not in my opponent's");
});

clause(SURPLUS, "0:rule", "'under its owner's control': a Soldier my opponent owns that I control is flipped face-down under THEIR control", () => {
  const g = surplusBoard({ owner: P2, controller: P1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P2 });
  assert.ok(playOf(g.engine, P2).includes(g.id("ss")), "playOf(g.engine, P2).includes(g.id(\"ss\"))");
});

clause(SURPLUS, "0:rule", "destroyed as a COST it is not replaced (CR 506.2): sacrificing it to Epic Smackdown puts it in the discard pile", () => {
  const g = surplusBoard({
    icons: { rage: 4 },
    extra: [
      { key: "es", def: printing(SMACK), owner: P1, zone: "hand" },
      { key: "t0", def: character({ name: "Theirs 0", life: 9 }), owner: P2, zone: "play" }
    ]
  });
  play(g.engine, P1, g.id("es"), { variables: { x: 1 }, selected: { sacX: [g.id("ss")] } });
  assert.equal(zoneOf(g.engine, g.id("ss")), "discard", "destroyed as a cost: no replacement");
  assert.equal(g.engine.state.cards[g.id("ss")].faceDown, false);
});

clause(SURPLUS, "0:rule", "other characters are destroyed as usual: an ally and an opponent's character go to their owners' discard piles", () => {
  const g = surplusBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }, { key: "kill2", def: destroyAnyTactic("Destroy Anything Again"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ally")] } });
  play(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "my ally is destroyed");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "their character is destroyed");
  assert.equal(g.engine.state.cards[g.id("ally")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("ss")), "play", "the Soldier is untouched");
  assert.equal(g.engine.state.cards[g.id("ss")].faceDown, false);
});

clause(SURPLUS, "0:rule", "the replacement belongs to the Soldier alone: with a Soldier in play, a second character that is destroyed still goes to the discard pile", () => {
  const g = surplusBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
});

clause(SURPLUS, "0:rule", "only 'destroyed' is replaced: returned to hand it goes to the hand, removed from the game it is removed", () => {
  const bounce = surplusBoard({ extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(bounce.engine, P1, bounce.id("mv"), { selected: { t: [bounce.id("ss")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("ss")), "hand");
  const gone = surplusBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("rm"), { selected: { t: [gone.id("ss")] } });
  assert.equal(zoneOf(gone.engine, gone.id("ss")), "removed");
});

clause(SURPLUS, "0:rule", "destroying every character: each Soldier is flipped face-down while every other character is destroyed", () => {
  const g = surplusBoard({
    extra: [
      { key: "ss2", def: printing(SURPLUS), owner: P1, zone: "play" },
      { key: "theirSs", def: printing(SURPLUS), owner: P2, zone: "play" },
      { key: "dall", def: destroyAllTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("dall"));
  drain(g.engine, declineAll);
  for (const key of ["ss", "ss2", "theirSs"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays in play`);
    assert.equal(g.engine.state.cards[g.id(key)].faceDown, true, `${key} is face-down`);
  }
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
});

clause(SURPLUS, "0:rule", "a face-down Soldier is only a resource: destroying it (as a card in play) puts it in the discard pile", () => {
  const g = surplusBoard({ ss: "faceDown", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("ss")] } });
  assert.equal(zoneOf(g.engine, g.id("ss")), "discard");
});

clause(SURPLUS, "0:rule", "a flipped-down Soldier has no FLIP UP: it cannot be flipped back", () => {
  const g = surplusBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  refused(() => flipUpRaw(g.engine, P1, g.id("ss")), "no FLIP UP cost");
  assert.equal(g.engine.state.cards[g.id("ss")].faceDown, true);
});

clause(SURPLUS, "0:rule", "a Soldier in my hand or my discard pile has nothing to replace", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = surplusBoard({ ss: where });
    assert.equal(zoneOf(g.engine, g.id("ss")), where);
  }
});

clause(SURPLUS, "0:rule", "it can be destroyed again after it is deployed again from my hand (the replacement is a fresh card each time)", () => {
  const g = surplusBoard({ ss: "hand", icons: { rage: 3 }, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ss"));
  assert.equal(zoneOf(g.engine, g.id("ss")), "play");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ss")] } });
  assert.deepEqual(surplusFlags(g), { zone: "play", faceDown: true, controller: P1 });
});

clause(SURPLUS, "0:rule", "it deploys for 1 with [R][R] and has 1/3/1 stats (a soldier)", () => {
  const g = surplusBoard({ ss: "hand", icons: { rage: 2 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("ss"));
  assert.equal(before - ready(g.engine), 1);
  assert.equal(g.engine.getStat(g.id("ss"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ss"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ss"), "life"), 1);
  const one = surplusBoard({ ss: "hand", icons: { rage: 1, greed: 3 } });
  refused(() => playRaw(one.engine, P1, one.id("ss")), "one [R]");
  const none = surplusBoard({ ss: "hand" });
  refused(() => playRaw(none.engine, P1, none.id("ss")), "no resources");
});


// =================================================================================
// The Emperor Barduse
// UNIQUE EMPEROR BARDUSE
// When this card enters play, you may pick any number of characters. If you do, inflict X
// damage divided however you want to the characters, where X is twice the number of
// "dragon" cards you control.
// All your other "dragon" characters gain 1 strength and 1 life.
// Character (emperor barduse, dragon), cost 8, [R]x6, 7 strength / 2 speed / 7 life.
// =================================================================================

const BARDUSE = "48201447-079d-4a67-814c-dfbf44e91ad4";

function barduseBoard(
  opts: {
    eb?: "hand" | "play" | "faceDown" | "discard";
    controller?: PlayerId;
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.eb ?? "hand";
  return devBoard(
    [
      { key: "eb", def: printing(BARDUSE), owner: P1, controller: opts.controller, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "t1", def: character({ name: "Theirs One", life: 9 }), owner: P2, zone: "play" },
      { key: "t2", def: character({ name: "Theirs Two", life: 9 }), owner: P2, zone: "play" },
      { key: "frail", def: character({ name: "Their Frail", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "An Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "A Place", structure: 20 }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { rage: 8 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type BarduseGame = ReturnType<typeof barduseBoard>;

const dragon = (name: string, owner: PlayerId = P1, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, strength: 2, life: 3, speed: 2, subtype: ["dragon"], ...over });

/** Deploys Barduse and answers the "pick any number of characters" prompt with `picks`; stops at the division prompt (if any). */
function barduseEnters(g: BarduseGame, picks: string[]): void {
  play(g.engine, P1, g.id("eb"));
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1, "I make the pick");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { picked: picks.map((k) => g.id(k)) } } } as never);
  resolvePendingResponses(g.engine);
}

/** Answers the division prompt with `shares` (card key -> damage). */
function divide(g: BarduseGame, shares: Record<string, number>): void {
  expectPending(g.engine, "distributeAmong");
  const byId: Record<string, number> = {};
  for (const [key, n] of Object.entries(shares)) byId[g.id(key)] = n;
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: byId } } as never);
  resolvePendingResponses(g.engine);
}

const tryDivide = (g: BarduseGame, shares: Record<string, number>) => () => {
  const byId: Record<string, number> = {};
  for (const [key, n] of Object.entries(shares)) byId[g.id(key)] = n;
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: byId } } as never);
};

// --- 0:unique ------------------------------------------------------------------------------------

function barduseUniqueBoard() {
  return devBoard([
    { key: "eb", def: printing(BARDUSE), owner: P1, zone: "play" },
    { key: "eb2", def: printing(BARDUSE), owner: P1, zone: "hand" },
    ...res({ rage: 10 })
  ]);
}

/**
 * Plays the second Barduse; the UNIQUE choice comes FIRST (the user's ruling, Q53, 2026-10-21: UNIQUE is enforced
 * immediately, before the new copy's enters-play pick). Any other prompt is declined on the way, none is expected.
 */
function secondBarduse(g: ReturnType<typeof barduseUniqueBoard>): void {
  play(g.engine, P1, g.id("eb2"));
  let guard = 0;
  while (pending(g.engine) && pending(g.engine)!.kind !== "uniqueSurvivor" && guard++ < 5) {
    const pc = pending(g.engine)!;
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    resolvePendingResponses(g.engine);
  }
}

clause(BARDUSE, "0:unique", "a second Emperor Barduse: I choose which to keep (the controller chooses), and choosing the new one destroys the old one", () => {
  const g = barduseUniqueBoard();
  secondBarduse(g);
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("eb"), g.id("eb2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("eb2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("eb2")), "play");
  assert.equal(zoneOf(g.engine, g.id("eb")), "discard", "the other copy is destroyed");
  // E11: corrected per Q53 (UNIQUE is enforced immediately, BEFORE the new copy's enters-play trigger): the kept new
  // copy's enters-play pick is still pending here and is offered after the choice; it used to be asked before it.
  const etb = expectPending(g.engine, "selectTargets");
  assert.equal(etb.abilityId, "barduse-etb", "the kept new copy's enters-play trigger continues");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: declineAll(etb) } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BARDUSE, "0:unique", "choosing the old Barduse keeps it and destroys the new one", () => {
  const g = barduseUniqueBoard();
  secondBarduse(g);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("eb") } } as never);
  assert.equal(zoneOf(g.engine, g.id("eb")), "play");
  assert.equal(zoneOf(g.engine, g.id("eb2")), "discard");
  // E11 (Q53): the destroyed new copy never entered play, so its enters-play pick is never offered.
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BARDUSE, "0:unique", "after the choice the game goes on: I can end my turn and nothing is left pending", () => {
  const g = barduseUniqueBoard();
  secondBarduse(g);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("eb2") } } as never);
  resolvePendingResponses(g.engine);
  // E11: corrected per Q53: the kept new copy's enters-play pick comes after the UNIQUE choice (it used to come before it).
  const etb = expectPending(g.engine, "selectTargets");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: declineAll(etb) } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
});

clause(BARDUSE, "0:unique", "the choice must name one of the copies: a bystander is refused and the choice stays open", () => {
  const g = devBoard([
    { key: "eb", def: printing(BARDUSE), owner: P1, zone: "play" },
    { key: "eb2", def: printing(BARDUSE), owner: P1, zone: "hand" },
    { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ rage: 10 })
  ]);
  play(g.engine, P1, g.id("eb2"));
  let guard = 0;
  while (pending(g.engine) && pending(g.engine)!.kind !== "uniqueSurvivor" && guard++ < 5) {
    const pc = pending(g.engine)!;
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    resolvePendingResponses(g.engine);
  }
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("bystander") } } as never), "keeping a card that is not a Barduse");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(BARDUSE, "0:unique", "UNIQUE is per player: my opponent may control their own Barduse with no choice and no destruction", () => {
  const g = devBoard(
    [
      { key: "eb", def: printing(BARDUSE), owner: P1, zone: "play" },
      { key: "eb2", def: printing(BARDUSE), owner: P2, zone: "hand" },
      ...res({ rage: 10 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(g.engine, P2, g.id("eb2"));
  let guard = 0;
  while (pending(g.engine) && guard++ < 5) {
    const pc = pending(g.engine)!;
    assert.notEqual(pc.kind, "uniqueSurvivor", "no UNIQUE conflict across players");
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(zoneOf(g.engine, g.id("eb")), "play");
  assert.equal(zoneOf(g.engine, g.id("eb2")), "play");
});

clause(BARDUSE, "0:unique", "taking control of my opponent's Barduse while I have my own is a duplicate: I must keep one", () => {
  const g = devBoard([
    { key: "eb", def: printing(BARDUSE), owner: P1, zone: "play" },
    { key: "theirs", def: printing(BARDUSE), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("theirs")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("eb") } } as never);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirs")), "discardOf(g.engine, P2).includes(g.id(\"theirs\"))");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BARDUSE, "0:unique", "a different UNIQUE designation (Athalamund) next to Barduse is not a duplicate; a copy in hand, discard, deck or face-down is not 'in play'", () => {
  const g = devBoard([
    { key: "eb", def: printing(BARDUSE), owner: P1, zone: "play" },
    { key: "at", def: printing(ATHALAMUND), owner: P1, zone: "play" },
    { key: "h", def: printing(BARDUSE), owner: P1, zone: "hand" },
    { key: "d", def: printing(BARDUSE), owner: P1, zone: "discard" },
    { key: "k", def: printing(BARDUSE), owner: P1, zone: "deck" },
    { key: "fd", def: printing(BARDUSE), owner: P1, zone: "play", faceDown: true }
  ]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("eb")), "play");
  assert.equal(zoneOf(g.engine, g.id("at")), "play");
});

// --- 1:rule: enters play -> divide X damage -----------------------------------------------------------------

clause(BARDUSE, "1:rule", "with only Barduse himself a dragon, X = 2: one picked character takes all 2", () => {
  const g = barduseBoard();
  barduseEnters(g, ["t1"]);
  divide(g, { t1: 2 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("t1")), 2);
});

clause(BARDUSE, "1:rule", "X is twice the number of 'dragon' cards I control: with two other dragons (Stiffbone and Shriever) X = 6", () => {
  const g = barduseBoard({ extra: [{ key: "stiff", def: printing(STIFFBONE), owner: P1, zone: "play" }, { key: "ps", def: printing(SHRIEVER), owner: P1, zone: "play" }] });
  barduseEnters(g, ["t1"]);
  divide(g, { t1: 6 });
  assert.equal(damageOf(g.engine, g.id("t1")), 6);
});

clause(BARDUSE, "1:rule", "dragon CARDS, not just characters: a dragon item and a dragon location also count (X = 2 x 3 = 6)", () => {
  const g = barduseBoard({
    extra: [
      { key: "dItem", def: item({ name: "Dragon Hoard", subtype: ["dragon"] }), owner: P1, zone: "play" },
      { key: "dPlace", def: location({ name: "Dragon Lair", structure: 5, subtype: ["dragon"] }), owner: P1, zone: "play" }
    ]
  });
  barduseEnters(g, ["t1"]);
  divide(g, { t1: 6 });
  assert.equal(damageOf(g.engine, g.id("t1")), 6);
});

clause(BARDUSE, "1:rule", "only dragons I CONTROL count: my opponent's dragons and a non-dragon of mine do not (X stays 2)", () => {
  const g = barduseBoard({ extra: [{ key: "theirDragon", def: dragon("Their Dragon"), owner: P2, zone: "play" }, { key: "myPlain", def: character({ name: "Plain" }), owner: P1, zone: "play" }] });
  barduseEnters(g, ["t1"]);
  expectPending(g.engine, "distributeAmong");
  refused(tryDivide(g, { t1: 3 }), "3 damage when X = 2");
  divide(g, { t1: 2 });
  assert.equal(damageOf(g.engine, g.id("t1")), 2);
});

clause(BARDUSE, "1:rule", "a face-down dragon is only a resource with no subtype (CR 411.1): it does not count", () => {
  const g = barduseBoard({ extra: [{ key: "fdDragon", def: dragon("Hidden Dragon"), owner: P1, zone: "play", faceDown: true }] });
  barduseEnters(g, ["t1"]);
  refused(tryDivide(g, { t1: 4 }), "4 damage when X = 2");
  divide(g, { t1: 2 });
  assert.equal(damageOf(g.engine, g.id("t1")), 2);
});

clause(BARDUSE, "1:rule", "'divided however you want': X = 4 can be split 3 and 1 between two picked characters", () => {
  const g = barduseBoard({ extra: [{ key: "d1", def: dragon("Dragon One"), owner: P1, zone: "play" }] });
  barduseEnters(g, ["t1", "t2"]);
  divide(g, { t1: 3, t2: 1 });
  assert.equal(damageOf(g.engine, g.id("t1")), 3);
  assert.equal(damageOf(g.engine, g.id("t2")), 1);
});

clause(BARDUSE, "1:rule", "'divided however you want': an even 2 and 2 split, and everything on one character, are both fine", () => {
  const even = barduseBoard({ extra: [{ key: "d1", def: dragon("Dragon One"), owner: P1, zone: "play" }] });
  barduseEnters(even, ["t1", "t2"]);
  divide(even, { t1: 2, t2: 2 });
  assert.equal(damageOf(even.engine, even.id("t1")), 2);
  assert.equal(damageOf(even.engine, even.id("t2")), 2);
  const all = barduseBoard({ extra: [{ key: "d1", def: dragon("Dragon One"), owner: P1, zone: "play" }] });
  barduseEnters(all, ["t1", "t2"]);
  divide(all, { t1: 4 });
  assert.equal(damageOf(all.engine, all.id("t1")), 4);
  assert.equal(damageOf(all.engine, all.id("t2")), 0);
});

clause(BARDUSE, "1:rule", "any characters can be picked: mine and theirs together", () => {
  const g = barduseBoard();
  barduseEnters(g, ["ally", "t1"]);
  divide(g, { ally: 1, t1: 1 });
  assert.equal(damageOf(g.engine, g.id("ally")), 1);
  assert.equal(damageOf(g.engine, g.id("t1")), 1);
});

clause(BARDUSE, "1:rule", "Barduse himself is a character: he can be picked and take part of the damage", () => {
  const g = barduseBoard();
  barduseEnters(g, ["eb", "t1"]);
  divide(g, { eb: 1, t1: 1 });
  assert.equal(damageOf(g.engine, g.id("eb")), 1);
  assert.equal(damageOf(g.engine, g.id("t1")), 1);
});

clause(BARDUSE, "1:rule", "'any number of characters': three picked characters share the damage (X = 6 as 2, 2, 2)", () => {
  const g = barduseBoard({ extra: [{ key: "d1", def: dragon("Dragon One"), owner: P1, zone: "play" }, { key: "d2", def: dragon("Dragon Two"), owner: P1, zone: "play" }] });
  barduseEnters(g, ["t1", "t2", "ally"]);
  divide(g, { t1: 2, t2: 2, ally: 2 });
  for (const key of ["t1", "t2", "ally"]) assert.equal(damageOf(g.engine, g.id(key)), 2, key);
});

clause(BARDUSE, "1:rule", "'you may': picking no character inflicts no damage and leaves no prompt open", () => {
  const g = barduseBoard();
  play(g.engine, P1, g.id("eb"));
  expectPending(g.engine, "selectTargets");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { picked: [] } } } as never);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)?.kind === "distributeAmong") divide(g, {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["ally", "t1", "t2", "frail", "eb"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} is untouched`);
  assert.equal(zoneOf(g.engine, g.id("eb")), "play");
});

clause(BARDUSE, "1:rule", "the damage kills: 2 damage on a 1-life character destroys it, 1 on it also does", () => {
  const g = barduseBoard();
  barduseEnters(g, ["frail", "t1"]);
  divide(g, { frail: 1, t1: 1 });
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("frail")), "discardOf(g.engine, P2).includes(g.id(\"frail\"))");
  assert.equal(damageOf(g.engine, g.id("t1")), 1);
});

clause(BARDUSE, "1:rule", "'inflict X damage divided however you want': all X damage must be assigned, so assigning only 1 of 2 is refused", () => {
  const g = barduseBoard();
  barduseEnters(g, ["t1", "t2"]);
  expectPending(g.engine, "distributeAmong");
  refused(tryDivide(g, { t1: 1 }), "1 of 2 damage assigned");
  refused(tryDivide(g, {}), "none of the damage assigned");
  assert.ok(pending(g.engine), "the division prompt is still open");
});

clause(BARDUSE, "1:rule", "more than X cannot be assigned: 3 of 2 is refused and the prompt stays open", () => {
  const g = barduseBoard();
  barduseEnters(g, ["t1", "t2"]);
  refused(tryDivide(g, { t1: 2, t2: 1 }), "3 damage when X = 2");
  assert.ok(pending(g.engine), "pending(g.engine)");
  divide(g, { t1: 1, t2: 1 });
  assert.equal(damageOf(g.engine, g.id("t1")), 1);
});

clause(BARDUSE, "1:rule", "a share must be positive: a negative share is refused", () => {
  const g = barduseBoard();
  barduseEnters(g, ["t1", "t2"]);
  refused(tryDivide(g, { t1: 3, t2: -1 }), "a negative share");
  assert.ok(pending(g.engine), "pending(g.engine)");
  assert.equal(damageOf(g.engine, g.id("t1")), 0);
});

clause(BARDUSE, "1:rule", "damage can only go to the picked characters: a share to a character that was not picked is refused", () => {
  const g = barduseBoard();
  barduseEnters(g, ["t1"]);
  refused(tryDivide(g, { t2: 2 }), "an unpicked character");
  assert.ok(pending(g.engine), "pending(g.engine)");
  assert.equal(damageOf(g.engine, g.id("t2")), 0);
});

clause(BARDUSE, "1:rule", "only CHARACTERS can be picked: an item, a location, a face-down card, a faction and a card in hand are refused", () => {
  const g = barduseBoard({ extra: [{ key: "fdc", def: character({ name: "Hidden Character", life: 9 }), owner: P2, zone: "play", faceDown: true }] });
  play(g.engine, P1, g.id("eb"));
  expectPending(g.engine, "selectTargets");
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["a card in hand", g.id("handChar")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { picked: [cid] } } } as never), what);
  }
  assert.ok(pending(g.engine), "pending(g.engine)");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { picked: [g.id("t1")] } } } as never);
  resolvePendingResponses(g.engine);
  divide(g, { t1: 2 });
  assert.equal(damageOf(g.engine, g.id("t1")), 2, "control: a character works");
});

clause(BARDUSE, "1:rule", "it triggers when THIS card enters play, not when another dragon does: Stiffbone entering later asks nothing", () => {
  const g = barduseBoard({ eb: "play", extra: [{ key: "stiff", def: printing(STIFFBONE), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("stiff")] } });
  assert.equal(zoneOf(g.engine, g.id("stiff")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BARDUSE, "1:rule", "it also triggers when Barduse is put into play by an effect", () => {
  const g = barduseBoard({ eb: "discard", extra: [{ key: "pip", def: putIntoPlayTactic("discard", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("eb")] } });
  assert.equal(zoneOf(g.engine, g.id("eb")), "play", "control");
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
});

clause(BARDUSE, "1:rule", "the amount to divide is 2 x the dragons I control: with Barduse and one other dragon the prompt offers 4", () => {
  const g = barduseBoard({ extra: [{ key: "d1", def: dragon("Dragon One"), owner: P1, zone: "play" }] });
  barduseEnters(g, ["t1"]);
  const pc = expectPending(g.engine, "distributeAmong");
  assert.equal((pc as unknown as { amount: number }).amount, 4, "Barduse and one other dragon: 2 x 2");
});

// --- 2:rule: all your other dragon characters gain 1 strength and 1 life --------------------------------------

function auraBoard(opts: { eb?: "play" | "hand" | "faceDown"; controller?: PlayerId; extra?: CardPlacement[] } = {}) {
  return barduseBoard({
    eb: opts.eb ?? "play",
    controller: opts.controller,
    extra: [
      { key: "stiff", def: printing(STIFFBONE), owner: P1, zone: "play" },
      { key: "ps", def: printing(SHRIEVER), owner: P1, zone: "play" },
      { key: "myDragon", def: dragon("My Dragon"), owner: P1, zone: "play" },
      { key: "theirDragon", def: dragon("Their Dragon"), owner: P2, zone: "play" },
      { key: "myPlain", def: character({ name: "My Plain", strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "dItem", def: item({ name: "Dragon Hoard", strength: 2, subtype: ["dragon"] }), owner: P1, zone: "play" },
      { key: "dPlace", def: location({ name: "Dragon Lair", structure: 5, subtype: ["dragon"] }), owner: P1, zone: "play" },
      { key: "fdDragon", def: dragon("Hidden Dragon"), owner: P1, zone: "play", faceDown: true },
      ...(opts.extra ?? [])
    ]
  });
}

const barduseStats = (g: BarduseGame, key: string) => ({ strength: g.engine.getStat(g.id(key), "strength"), life: g.engine.getStat(g.id(key), "life") });

clause(BARDUSE, "2:rule", "my other 'dragon' characters gain 1 strength and 1 life: Aroused Stiffbone 4/4 becomes 5/5", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "stiff"), { strength: 5, life: 5 });
});

clause(BARDUSE, "2:rule", "Plunging Shriever 3/1 becomes 4/2, and a plain dragon 2/3 becomes 3/4", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "ps"), { strength: 4, life: 2 });
  assert.deepEqual(barduseStats(g, "myDragon"), { strength: 3, life: 4 });
});

clause(BARDUSE, "2:rule", "speed is unchanged", () => {
  const g = auraBoard();
  assert.equal(g.engine.getStat(g.id("stiff"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ps"), "speed"), 4);
});

clause(BARDUSE, "2:rule", "'other': Barduse himself does not gain it (7 strength, 7 life)", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "eb"), { strength: 7, life: 7 });
});

clause(BARDUSE, "2:rule", "only MY dragons: my opponent's dragon is unchanged", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "theirDragon"), { strength: 2, life: 3 });
});

clause(BARDUSE, "2:rule", "only dragon characters: my plain character, my dragon item and my dragon location are unchanged", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "myPlain"), { strength: 2, life: 3 });
  assert.equal(g.engine.getStat(g.id("dItem"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("dPlace"), "structure"), 5);
});

clause(BARDUSE, "2:rule", "a face-down dragon is only a resource (CR 411.1): it gains nothing", () => {
  const g = auraBoard();
  assert.deepEqual(barduseStats(g, "fdDragon"), { strength: 2, life: 3 });
});

clause(BARDUSE, "2:rule", "the bonus ends when Barduse leaves play (destroyed): back to printed stats", () => {
  const g = auraBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(barduseStats(g, "stiff"), { strength: 5, life: 5 }, "control");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("eb")] } });
  assert.equal(zoneOf(g.engine, g.id("eb")), "discard");
  assert.deepEqual(barduseStats(g, "stiff"), { strength: 4, life: 4 });
  assert.deepEqual(barduseStats(g, "ps"), { strength: 3, life: 1 });
});

clause(BARDUSE, "2:rule", "a Barduse in my hand or face-down gives no bonus", () => {
  for (const where of ["hand", "faceDown"] as const) {
    const g = auraBoard({ eb: where });
    assert.deepEqual(barduseStats(g, "stiff"), { strength: 4, life: 4 }, `Barduse ${where}`);
  }
});

clause(BARDUSE, "2:rule", "'your' is the controller's: a Barduse I own but my opponent controls strengthens THEIR dragons, not mine", () => {
  const g = auraBoard({ controller: P2 });
  assert.deepEqual(barduseStats(g, "theirDragon"), { strength: 3, life: 4 });
  assert.deepEqual(barduseStats(g, "myDragon"), { strength: 2, life: 3 });
});

clause(BARDUSE, "2:rule", "a dragon that enters play later gets the bonus at once", () => {
  const g = auraBoard({ extra: [{ key: "late", def: dragon("Late Dragon", P1, { strength: 1, life: 1 }), owner: P1, zone: "hand" }, { key: "pip", def: putIntoPlayTactic("hand", "self", "controller"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("late")] } });
  assert.deepEqual(barduseStats(g, "late"), { strength: 2, life: 2 });
});

clause(BARDUSE, "2:rule", "the extra life really protects: Plunging Shriever (1 life, 2 with Barduse) survives 1 damage and dies to it without Barduse", () => {
  const withEb = auraBoard({ extra: [{ key: "hit", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(withEb.engine, P1, withEb.id("hit"), { selected: { t: [withEb.id("ps")] } });
  assert.equal(zoneOf(withEb.engine, withEb.id("ps")), "play");
  const without = auraBoard({ eb: "hand", extra: [{ key: "hit", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("hit"), { selected: { t: [without.id("ps")] } });
  assert.equal(zoneOf(without.engine, without.id("ps")), "discard");
});

clause(BARDUSE, "2:rule", "it deploys for 8 with [R]x6 and has 7/2/7 stats; five [R] are refused", () => {
  const g = barduseBoard({ icons: { rage: 8 } });
  const before = ready(g.engine);
  barduseEnters(g, []);
  if (pending(g.engine)?.kind === "distributeAmong") divide(g, {});
  assert.equal(zoneOf(g.engine, g.id("eb")), "play");
  assert.equal(before - ready(g.engine), 8);
  assert.deepEqual(barduseStats(g, "eb"), { strength: 7, life: 7 });
  assert.equal(g.engine.getStat(g.id("eb"), "speed"), 2);
  const exact = barduseBoard({ icons: { rage: 6, greed: 2 } });
  barduseEnters(exact, []);
  if (pending(exact.engine)?.kind === "distributeAmong") divide(exact, {});
  assert.equal(zoneOf(exact.engine, exact.id("eb")), "play", "exactly six [R] meet the threshold");
  const five = barduseBoard({ icons: { rage: 5, greed: 5 } });
  refused(() => playRaw(five.engine, P1, five.id("eb")), "five [R] for [R]x6");
  const short = barduseBoard({ icons: { rage: 7 }, extra: spentRage(0) });
  refused(() => playRaw(short.engine, P1, short.id("eb")), "seven resources for a cost of 8");
});


// =================================================================================
// Vorpal Sword
// ATTACH TO CHARACTER
// The attached character gains 2 strength and 1 life.
// If this card is destroyed, flip it face-down under its owner's control instead.
// SNICKER SNACK -- COST: Use this only while this card is a face-down resource. Reveal this
// card. Pay 3. Discard a card. Pick a character. -- EFFECT: Inflict 2 damage to the
// character. Inflict 1 damage to your faction.
// Item (gear), cost 4, [R][R].
// =================================================================================

const VORPAL = "8012f792-69c0-4a16-88dd-9209463f4f58";

function vorpalBoard(
  opts: {
    vs?: "hand" | "play" | "faceDown" | "discard";
    host?: string; // when vs is "play": the key of the host it is attached to
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    hand?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.vs ?? "hand";
  return devBoard(
    [
      {
        key: "vs",
        def: printing(VORPAL),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "play" ? (opts.host ?? "h1") : undefined
      },
      { key: "h1", def: character({ name: "Host One", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "h2", def: character({ name: "Host Two", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "Foe One", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe Two", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "An Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "A Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "fdc", def: character({ name: "Hidden Character", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "Discarded Character" }), owner: P1, zone: "discard" },
      ...fillers("hc", opts.hand ?? 2, P1, "hand"),
      ...res(opts.icons ?? { rage: 6 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type VorpalGame = ReturnType<typeof vorpalBoard>;
const vstat = (g: VorpalGame, key: string) => ({ strength: g.engine.getStat(g.id(key), "strength"), life: g.engine.getStat(g.id(key), "life"), speed: g.engine.getStat(g.id(key), "speed") });

const sword = (g: VorpalGame, host: string) => play(g.engine, P1, g.id("vs"), { selected: { attachTo: [g.id(host)] } });
const swordAttempt = (g: VorpalGame, host?: string) => () => playRaw(g.engine, P1, g.id("vs"), { selected: host ? { attachTo: [g.id(host)] } : {} });

// --- 0:attach: ATTACH TO CHARACTER ------------------------------------------------------------------------

clause(VORPAL, "0:attach", "played with a character as its host: it enters play attached to that character", () => {
  const g = vorpalBoard();
  sword(g, "h1");
  assert.equal(zoneOf(g.engine, g.id("vs")), "play");
  assert.equal(g.engine.state.cards[g.id("vs")].attachedTo, g.id("h1"));
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, false);
});

clause(VORPAL, "0:attach", "any character can be the host: my own characters and my opponent's", () => {
  for (const host of ["h1", "h2", "f1", "f2"]) {
    const g = vorpalBoard();
    sword(g, host);
    assert.equal(g.engine.state.cards[g.id("vs")].attachedTo, g.id(host), `host ${host}`);
  }
});

clause(VORPAL, "0:attach", "picking the host is the first extra cost: with no pick the Sword cannot be played and nothing is paid", () => {
  const g = vorpalBoard();
  refused(swordAttempt(g), "no host picked");
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
  assert.equal(ready(g.engine), 6);
});

clause(VORPAL, "0:attach", "the host must be a CHARACTER: an item, a location, a face-down card, a faction, a resource and cards outside play are refused", () => {
  const g = vorpalBoard();
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid))!;
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["a face-up resource", resource],
    ["a card in hand", g.id("handChar")],
    ["a card in the discard pile", g.id("discChar")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => playRaw(g.engine, P1, g.id("vs"), { selected: { attachTo: [cid] } }), what);
  }
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
  sword(g, "h1");
  assert.equal(zoneOf(g.engine, g.id("vs")), "play", "control: a character works");
});

clause(VORPAL, "0:attach", "exactly one host: two are refused", () => {
  const g = vorpalBoard();
  refused(() => playRaw(g.engine, P1, g.id("vs"), { selected: { attachTo: [g.id("h1"), g.id("h2")] } }), "two hosts");
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
});

clause(VORPAL, "0:attach", "with no character in play at all there is no host to pick and the Sword cannot be played", () => {
  const g = devBoard([{ key: "vs", def: printing(VORPAL), owner: P1, zone: "hand" }, ...res({ rage: 6 })]);
  refused(() => playRaw(g.engine, P1, g.id("vs")), "nothing to attach to");
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
});

clause(VORPAL, "0:attach", "it costs 4 with [R][R]: exactly four resources are paid; three resources, or one [R], are refused", () => {
  const g = vorpalBoard({ icons: { rage: 4 } });
  const before = ready(g.engine);
  sword(g, "h1");
  assert.equal(before - ready(g.engine), 4);
  const exactR = vorpalBoard({ icons: { rage: 2, greed: 2 } });
  sword(exactR, "h1");
  assert.equal(zoneOf(exactR.engine, exactR.id("vs")), "play", "exactly two [R] meet the threshold");
  const short = vorpalBoard({ icons: { rage: 3 } });
  refused(swordAttempt(short, "h1"), "three resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("vs")), "hand");
  assert.equal(ready(short.engine), 3, "nothing was paid");
  const oneR = vorpalBoard({ icons: { rage: 1, greed: 5 } });
  refused(swordAttempt(oneR, "h1"), "one [R]");
  const down = vorpalBoard({ icons: { rage: 1 }, extra: volition(5) });
  refused(swordAttempt(down, "h1"), "Volition is not [R]");
  const theirs = vorpalBoard({ icons: { rage: 1, greed: 5 }, oppIcons: { rage: 4 } });
  refused(swordAttempt(theirs, "h1"), "their [R]");
});

clause(VORPAL, "0:attach", "an item is deployed on my own turn only: refused on my opponent's turn even in a response window", () => {
  const g = vorpalBoard({ turn: 2, active: P2 });
  refused(swordAttempt(g, "h1"), "not my turn, no window");
  declareAttackOpenWindow(g.engine, P2, [g.id("f1")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(swordAttempt(g, "h1"), "an item cannot be deployed in response");
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
});

clause(VORPAL, "0:attach", "if the host leaves play in response, the Sword cannot attach and goes to its owner's discard pile (CR 507.2c)", () => {
  const g = vorpalBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  swordAttempt(g, "f1")();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("f1")] });
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard", "control: the host was destroyed");
  assert.equal(zoneOf(g.engine, g.id("vs")), "discard");
});

clause(VORPAL, "0:attach", "when its host is destroyed the Sword leaves play the same way (destroyed): its own replacement applies and it ends face-down in play (CR 301.4, 301.4b)", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("h1")] } });
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard", "control: the host was destroyed");
  assert.equal(zoneOf(g.engine, g.id("vs")), "play", "the Sword's destruction is replaced");
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, true);
});

clause(VORPAL, "0:attach", "when its host is returned to its owner's hand the Sword goes to its owner's hand too (CR 301.4a)", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("mv"), { selected: { t: [g.id("h1")] } });
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand", "control: the host was bounced");
  assert.equal(zoneOf(g.engine, g.id("vs")), "hand");
});

clause(VORPAL, "0:attach", "when its host is removed from the game the Sword is removed from the game too (CR 301.4a)", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("h1")] } });
  assert.equal(zoneOf(g.engine, g.id("h1")), "removed", "control");
  assert.equal(zoneOf(g.engine, g.id("vs")), "removed");
});

// --- 1:rule: the attached character gains 2 strength and 1 life -------------------------------------------------

clause(VORPAL, "1:rule", "the attached character gains 2 strength and 1 life (2/2 becomes 4/3), speed unchanged", () => {
  const g = vorpalBoard({ vs: "play", host: "h1" });
  assert.deepEqual(vstat(g, "h1"), { strength: 4, life: 3, speed: 2 });
});

clause(VORPAL, "1:rule", "only the host: my other character and my opponent's characters are unchanged", () => {
  const g = vorpalBoard({ vs: "play", host: "h1" });
  assert.deepEqual(vstat(g, "h2"), { strength: 1, life: 4, speed: 1 });
  assert.deepEqual(vstat(g, "f1"), { strength: 3, life: 3, speed: 3 });
});

clause(VORPAL, "1:rule", "a Sword on my opponent's character strengthens THEIR character", () => {
  const g = vorpalBoard({ vs: "play", host: "f1" });
  assert.deepEqual(vstat(g, "f1"), { strength: 5, life: 4, speed: 3 });
  assert.deepEqual(vstat(g, "h1"), { strength: 2, life: 2, speed: 2 });
});

clause(VORPAL, "1:rule", "two Swords on one character stack: +4 strength, +2 life", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "vs2", def: printing(VORPAL), owner: P1, zone: "play", attachedToKey: "h1" }] });
  assert.deepEqual(vstat(g, "h1"), { strength: 6, life: 4, speed: 2 });
});

clause(VORPAL, "1:rule", "once the Sword is played the host has the bonus at once", () => {
  const g = vorpalBoard();
  assert.deepEqual(vstat(g, "h1"), { strength: 2, life: 2, speed: 2 });
  sword(g, "h1");
  assert.deepEqual(vstat(g, "h1"), { strength: 4, life: 3, speed: 2 });
});

clause(VORPAL, "1:rule", "the extra strength is real battle damage: the host deals 4 to the faction it attacks", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", turn: 1, active: P1 });
  const before = influenceOf(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("h1")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(before - influenceOf(g.engine, P2), 4);
});

clause(VORPAL, "1:rule", "the extra life really protects: a 2-life host survives 2 damage with the Sword and dies without it", () => {
  const withSword = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "hit", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(withSword.engine, P1, withSword.id("hit"), { selected: { t: [withSword.id("h1")] } });
  assert.equal(zoneOf(withSword.engine, withSword.id("h1")), "play");
  const without = vorpalBoard({ vs: "hand", extra: [{ key: "hit", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("hit"), { selected: { t: [without.id("h1")] } });
  assert.equal(zoneOf(without.engine, without.id("h1")), "discard");
});

clause(VORPAL, "1:rule", "the bonus ends when the Sword is flipped face-down (destroyed): the host is back to 2/2", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.deepEqual(vstat(g, "h1"), { strength: 2, life: 2, speed: 2 });
});

clause(VORPAL, "1:rule", "a face-down Sword gives no bonus", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  assert.deepEqual(vstat(g, "h1"), { strength: 2, life: 2, speed: 2 });
});

// --- 2:rule: if destroyed, flip it face-down under its owner's control instead ---------------------------------

clause(VORPAL, "2:rule", "destroyed (on its own, attached to a living host), it is flipped face-down instead and stays in play", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.equal(zoneOf(g.engine, g.id("vs")), "play");
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("vs")].controllerId, P1);
  assert.equal(discardOf(g.engine, P1).includes(g.id("vs")), false);
});

clause(VORPAL, "2:rule", "the flipped Sword is a face-down resource: it provides Volition, is no longer attached, and the host is untouched", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.equal(g.engine.isResource(g.id("vs")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(g.engine.state.cards[g.id("vs")].attachedTo, undefined);
  assert.equal(zoneOf(g.engine, g.id("h1")), "play", "the host stays in play");
});

clause(VORPAL, "2:rule", "destroyed by an opponent's effect it is flipped face-down under its OWNER's control", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", turn: 2, active: P2, extra: [{ key: "da", def: destroyAnyTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("vs")].controllerId, P1);
});

clause(VORPAL, "2:rule", "'under its owner's control': a Sword my opponent owns that I control ends face-down under THEIR control", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", owner: P2, controller: P1, extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("vs")].controllerId, P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("vs")), "playOf(g.engine, P2).includes(g.id(\"vs\"))");
});

clause(VORPAL, "2:rule", "only the Sword itself is replaced: another destroyed item goes to the discard pile", () => {
  const g = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("thing")] } });
  assert.equal(zoneOf(g.engine, g.id("thing")), "discard");
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, false, "the Sword is untouched");
});

clause(VORPAL, "2:rule", "a face-down Sword is only a resource: destroying it puts it in the discard pile", () => {
  const g = vorpalBoard({ vs: "faceDown", extra: [{ key: "da", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("da"), { selected: { t: [g.id("vs")] } });
  assert.equal(zoneOf(g.engine, g.id("vs")), "discard");
});

clause(VORPAL, "2:rule", "only 'destroyed' is replaced: returned to hand directly it goes to the hand, removed from the game it is removed", () => {
  const bounce = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(bounce.engine, P1, bounce.id("mv"), { selected: { t: [bounce.id("vs")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("vs")), "hand");
  const gone = vorpalBoard({ vs: "play", host: "h1", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("rm"), { selected: { t: [gone.id("vs")] } });
  assert.equal(zoneOf(gone.engine, gone.id("vs")), "removed");
});

// --- 3:ability:snicker-snack ---------------------------------------------------------------------------------------

const snickSel = (g: VorpalGame, victim: string, discard: string[] = ["hc0"]) => ({ victim: [g.id(victim)], snickDisc: discard.map((k) => g.id(k)) });
const snack = (g: VorpalGame, victim: string, discard: string[] = ["hc0"]) => activate(g.engine, P1, g.id("vs"), "snicker-snack", { selected: snickSel(g, victim, discard) });
const snackRaw = (g: VorpalGame, victim: string, discard: string[] = ["hc0"], player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("vs"), "snicker-snack", snickSel(g, victim, discard));

clause(VORPAL, "3:ability:snicker-snack", "used while it is a face-down resource: the picked character takes 2 damage and my faction takes 1", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "f2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("f2")), 2);
  assert.equal(influenceOf(g.engine, P1), START - 1, "'your faction' takes 1");
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(VORPAL, "3:ability:snicker-snack", "my faction takes the 1 as damage: a damage event of 1 aimed at my faction card", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "f2");
  assert.deepEqual(damageAmounts(g.engine, g.engine.state.players[P1].factionId!), [1]);
});

clause(VORPAL, "3:ability:snicker-snack", "a victim of mine can be picked too: 'a character'", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "h2");
  assert.equal(damageOf(g.engine, g.id("h2")), 2);
});

clause(VORPAL, "3:ability:snicker-snack", "2 damage destroys a 2-life character; a 3-life character keeps 1 life", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "h1");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
  const f = vorpalBoard({ vs: "faceDown" });
  snack(f, "f1");
  assert.equal(zoneOf(f.engine, f.id("f1")), "play");
  assert.equal(damageOf(f.engine, f.id("f1")), 2);
});

clause(VORPAL, "3:ability:snicker-snack", "the Sword stays a face-down resource after SNICKER SNACK (it is not flipped up, discarded or used up)", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "f2");
  assert.equal(zoneOf(g.engine, g.id("vs")), "play");
  assert.equal(g.engine.state.cards[g.id("vs")].faceDown, true);
  assert.equal(g.engine.isResource(g.id("vs")), true);
});

clause(VORPAL, "3:ability:snicker-snack", "'Use this only while this card is a face-down resource': a face-up Sword in play cannot use it", () => {
  const g = vorpalBoard({ vs: "play", host: "h1" });
  refused(snackRaw(g, "f2"), "a face-up Sword", /./);
  assert.equal(damageOf(g.engine, g.id("f2")), 0);
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(handOf(g.engine, P1).includes(g.id("hc0")), true, "no card was discarded");
});

clause(VORPAL, "3:ability:snicker-snack", "'Use this only while this card is a face-down resource': from my hand or my discard pile it cannot be used", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = vorpalBoard({ vs: where });
    refused(snackRaw(g, "f2"), `the Sword in my ${where}`, /./);
    assert.equal(damageOf(g.engine, g.id("f2")), 0);
  }
});

clause(VORPAL, "3:ability:snicker-snack", "'Reveal this card': using it reveals the face-down Sword", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snackRaw(g, "f2")();
  const reveals = g.engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; cardIds?: string[] } | undefined)
    .filter((event) => event?.type === "cardsRevealed" && event.cardIds?.includes(g.id("vs")));
  assert.equal(reveals.length, 1, "the Sword was revealed");
});

clause(VORPAL, "3:ability:snicker-snack", "'Pay 3': three resources are spent when it is used, before the opponent can respond", () => {
  const g = vorpalBoard({ vs: "faceDown", icons: { rage: 5 } });
  const spentBefore = attachedCount(g.engine, P1);
  snackRaw(g, "f2")();
  assert.equal(attachedCount(g.engine, P1) - spentBefore, 3);
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(damageOf(g.engine, g.id("f2")), 0, "the effect has not happened yet");
});

clause(VORPAL, "3:ability:snicker-snack", "'Pay 3': with too few resources it is refused and nothing is discarded or paid", () => {
  const g = vorpalBoard({ vs: "faceDown", icons: {}, extra: spentRage(3) });
  assert.equal(ready(g.engine), 1, "only the face-down Sword itself is ready");
  refused(snackRaw(g, "f2"), "one ready resource for Pay 3");
  assert.equal(handOf(g.engine, P1).includes(g.id("hc0")), true);
  assert.equal(damageOf(g.engine, g.id("f2")), 0);
});

clause(VORPAL, "3:ability:snicker-snack", "'Discard a card': the chosen card from my hand goes to my discard pile, and only that card", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "f2", ["hc1"]);
  assert.equal(zoneOf(g.engine, g.id("hc1")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("hc1")), "discardOf(g.engine, P1).includes(g.id(\"hc1\"))");
  assert.equal(zoneOf(g.engine, g.id("hc0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("handChar")), "hand");
});

clause(VORPAL, "3:ability:snicker-snack", "the discard is a cost: it happens when SNICKER SNACK is used, before the opponent can respond", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snackRaw(g, "f2", ["hc0"])();
  assert.equal(zoneOf(g.engine, g.id("hc0")), "discard");
});

clause(VORPAL, "3:ability:snicker-snack", "'Discard a card': with no card in my hand it is refused and nothing else is paid", () => {
  const noHand = devBoard([
    { key: "vs", def: printing(VORPAL), owner: P1, zone: "play", faceDown: true },
    { key: "f2", def: character({ name: "Foe Two", life: 9 }), owner: P2, zone: "play" },
    ...res({ rage: 6 })
  ]);
  refused(() => actRaw(noHand.engine, P1, noHand.id("vs"), "snicker-snack", { victim: [noHand.id("f2")] }), "nothing to discard");
  assert.equal(attachedCount(noHand.engine, P1), 0, "nothing was paid");
  assert.equal(damageOf(noHand.engine, noHand.id("f2")), 0);
});

clause(VORPAL, "3:ability:snicker-snack", "'Discard a card' must name a card in MY hand: a card in play, in my discard pile, in the other player's hand or no card is refused; two cards are refused", () => {
  const g = vorpalBoard({ vs: "faceDown", extra: [{ key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }] });
  for (const [what, key] of [
    ["a card in play", "h2"],
    ["a card in my discard pile", "discChar"],
    ["a card in their hand", "theirHand"]
  ] as const) {
    refused(snackRaw(g, "f2", [key]), what);
  }
  refused(snackRaw(g, "f2", []), "no discard chosen");
  refused(snackRaw(g, "f2", ["hc0", "hc1"]), "two cards");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  assert.equal(damageOf(g.engine, g.id("f2")), 0);
  snack(g, "f2", ["hc0"]);
  assert.equal(damageOf(g.engine, g.id("f2")), 2, "control: a card in hand works");
});

clause(VORPAL, "3:ability:snicker-snack", "Pick a character: an item, a location, a face-down card, a faction and cards outside play are refused", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  const resource = playOf(g.engine, P1).find((cid) => g.engine.isResource(cid) && cid !== g.id("vs"))!;
  for (const [what, cid] of [
    ["an item", g.id("thing")],
    ["a location", g.id("place")],
    ["a face-down card", g.id("fdc")],
    ["the Sword itself", g.id("vs")],
    ["a face-up resource", resource],
    ["a character in my hand", g.id("handChar")],
    ["a character in my discard pile", g.id("discChar")],
    ["my faction", g.engine.state.players[P1].factionId!],
    ["their faction", g.engine.state.players[P2].factionId!]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => actRaw(g.engine, P1, g.id("vs"), "snicker-snack", { victim: [cid], snickDisc: [g.id("hc0")] }), what);
  }
  refused(() => actRaw(g.engine, P1, g.id("vs"), "snicker-snack", { snickDisc: [g.id("hc0")] }), "no victim");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(VORPAL, "3:ability:snicker-snack", "it can be used in response on my opponent's turn (an ability can be used whenever I could respond)", () => {
  const g = vorpalBoard({ vs: "faceDown", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("f1")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  snackRaw(g, "f1")();
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("f1")), 2);
  assert.equal(influenceOf(g.engine, P1), START - 1);
});

clause(VORPAL, "3:ability:snicker-snack", "only the Sword's controller can use it", () => {
  const g = vorpalBoard({ vs: "faceDown", turn: 2, active: P2, oppIcons: { rage: 5 }, extra: [{ key: "theirHandCard", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("f1")]);
  refused(() => actRaw(g.engine, P2, g.id("vs"), "snicker-snack", { victim: [g.id("h1")], snickDisc: [g.id("theirHandCard")] }), "my opponent using my Sword");
  assert.equal(damageOf(g.engine, g.id("h1")), 0);
});

clause(VORPAL, "3:ability:snicker-snack", "'your faction' is the controller's: a Sword I own but my opponent controls hurts THEIR faction", () => {
  const g = vorpalBoard({
    vs: "faceDown",
    controller: P2,
    turn: 2,
    active: P2,
    oppIcons: { rage: 5 },
    extra: [{ key: "theirHandCard", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }]
  });
  activate(g.engine, P2, g.id("vs"), "snicker-snack", { selected: { victim: [g.id("h2")], snickDisc: [g.id("theirHandCard")] } });
  assert.equal(damageOf(g.engine, g.id("h2")), 2);
  assert.equal(influenceOf(g.engine, P2), START - 1);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(VORPAL, "3:ability:snicker-snack", "it can be used again: a second SNICKER SNACK deals another 2 and costs another 3 and another card", () => {
  const g = vorpalBoard({ vs: "faceDown", icons: { rage: 8 } });
  snack(g, "f2", ["hc0"]);
  snack(g, "f2", ["hc1"]);
  assert.equal(damageOf(g.engine, g.id("f2")), 4);
  assert.equal(influenceOf(g.engine, P1), START - 2);
});

clause(VORPAL, "3:ability:snicker-snack", "if the picked character leaves play in response, my faction still takes 1 (the rest resolves)", () => {
  const g = vorpalBoard({ vs: "faceDown", extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  snackRaw(g, "f2")();
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("f2")] });
  assert.equal(zoneOf(g.engine, g.id("f2")), "removed", "control");
  assert.equal(influenceOf(g.engine, P1), START - 1);
});

clause(VORPAL, "3:ability:snicker-snack", "only the picked character takes the 2 damage: the other characters are untouched", () => {
  const g = vorpalBoard({ vs: "faceDown" });
  snack(g, "f2");
  for (const key of ["h1", "h2", "f1"]) assert.equal(damageOf(g.engine, g.id(key)), 0, `${key} is untouched`);
});

