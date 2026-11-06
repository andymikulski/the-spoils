// Clause tests — batch 1st-edition-part-2-06. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-06`. Expectations come from each
// card's PRINTED text (1st Edition Part 2 printing) and RULES.md / the Comprehensive
// Rules; engine data (ability ids, declaration ids, choice kinds) is only used to
// DRIVE the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, holdCostChoices, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn, spentResources, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].damage ?? 0;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const attachedToOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].attachedTo;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
/** "must block Gore Engine": a block obligation scoped to Gore Engine as the attacker (not the generic mustBlock restriction). */
const mustBlockGore = (b: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, key: string) =>
  b.engine.state.mustBlockGrants.some((g) => g.blockerId === b.id(key) && g.attackerId === b.id("gore"));
const hasRestriction = (engine: SpoilsEngine, cardId: CardInstanceId, restriction: string) =>
  (engine.getRestrictions(cardId) as string[]).includes(restriction);
const strengthOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "strength");
const lifeOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "life");
const speedOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "speed");
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => [strengthOf(engine, cardId), lifeOf(engine, cardId), speedOf(engine, cardId)];

type Board = ReturnType<typeof buildGame>;

/** A game with a develop-capable faction for both players (starting influence 30) plus `cards`. Everything random (shuffles, coin flips) is seeded. */
function board(cards: CardPlacement[], opts: { turn?: number; active?: Pid; influenceP1?: number; influenceP2?: number; random?: () => number } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influenceP1 },
    playerB: { faction: developFaction(), influence: opts.influenceP2 },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards,
    random: opts.random ?? seeded(1)
  });
}

/** A small seeded generator (LCG): every shuffle in a test that asserts a shuffled order must use one (docs/TESTING.md, Determinism). */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (deck order: index 0 is the top). */
function fill(prefix: string, n: number, owner: Pid, zone: CardPlacement["zone"], over: Partial<CardDefinition> = {}): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}`, ...over }), owner, zone }));
}

/** The attack on the opponent's faction (default) or a card, WITHOUT draining the response window. */
function attackRaw(
  engine: SpoilsEngine,
  player: Pid,
  attackerIds: CardInstanceId[],
  target: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId } = { type: "faction", playerId: other(player) }
): void {
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target });
}

/** P2's turn: P2 declares an attack and passes its own priority, so the defender (P1) may respond now. */
function openDefenderWindow(engine: SpoilsEngine, attackerIds: CardInstanceId[], target?: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId }): void {
  attackRaw(engine, P2, attackerIds, target);
  engine.perform({ type: "passPriority", playerId: P2 });
}

/** Answers the open `chooserSelectsTarget` choice with `selected` and drains the response window. */
function pick(engine: SpoilsEngine, selected: CardInstanceId[]): void {
  answerPending(engine, "chooserSelectsTarget", { selected });
}

/** Same as `pick` but without draining responses, and for any player (so a wrong chooser is refused). */
function pickAs(engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `distributeAmong` choice. */
function distribute(engine: SpoilsEngine, shares: Record<string, number>, player: Pid = P1): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "distributeAmong", shares } } as never);
  resolvePendingResponses(engine);
}

const FACTION_OF = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].factionId!;

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number, name = `Pump${amount}`): CardDefinition {
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

/** A free tactic that deals `amount` damage to one picked character (id `zap`, declaration `t`). */
function zapTactic(amount: number, name = `Zap${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that deals `amount` damage to one picked location (id `zap`, declaration `t`). */
function locationZap(amount: number): CardDefinition {
  return tactic({
    name: `LocationZap${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that destroys one picked item (id `k`, declaration `t`). */
function itemKillTactic(): CardDefinition {
  return tactic({
    name: "ItemKill",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
function bounceTactic(): CardDefinition {
  return tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
}

/** A free tactic that removes one picked character from the game (id `r`, declaration `t`). */
function removeTactic(): CardDefinition {
  return tactic({
    name: "Remove",
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic that puts one picked card from its owner's hand into play (id `re`, declaration `t`). */
function putInPlayTactic(): CardDefinition {
  return tactic({
    name: "PutInPlay",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { owner: "self", zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic that takes control of one picked character (id `s`, declaration `t`). */
function stealTactic(): CardDefinition {
  return tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A gear item that changes the attached character's `stat` by `amount` (attach to character). */
function statItem(stat: "strength" | "life" | "speed", amount: number, name = `${stat}${amount}`): CardDefinition {
  return item({
    name: `Stat-${name}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "mod", type: "continuous", modifiers: [{ target: "attachedTo", stat, operation: "add", value: amount }] }] }
  });
}

/** An item that reduces all damage inflicted to a faction by 1 ("damage prevention"), to tell damage from influence loss. */
function factionShield(): CardDefinition {
  return item({
    name: "FactionShield",
    behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction" }, delta: -1 }] }] }
  });
}

/** A free tactic that inflicts `amount` damage to the opponent's faction (to prove the shield works). */
function factionZap(amount: number): CardDefinition {
  return tactic({
    name: `FactionZap${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "fz", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount }] }] }
  });
}

const ICON_LETTER: Record<StapleIcon, string> = { rage: "r", greed: "g", deception: "d", elitism: "e", obsession: "o" };
const OTHER_ICON: Record<StapleIcon, StapleIcon> = { rage: "greed", greed: "rage", deception: "rage", elitism: "rage", obsession: "rage" };

/**
 * The cost / threshold / printed-stats checks every deployable card gets: it is deployed for exactly
 * `cost` resources, refused one resource short and refused one icon short of its threshold.
 * `selected` maps a declaration to placement keys (extra picks the card needs); `extra` supplies those cards.
 */
function deployChecks(
  printingId: string,
  spec: {
    cost: number;
    icon: StapleIcon;
    count: number;
    stats?: [number, number, number];
    selected?: Record<string, string[]>;
    variables?: Record<string, number>;
    extra?: CardPlacement[];
    done?: "play" | "discard";
    owner?: Pid;
    turn?: number;
    active?: Pid;
  }
): void {
  const owner = spec.owner ?? P1;
  const key = "card";
  const build = (readyN: number, spentN: number, iconCount: number, otherCount: number) =>
    board(
      [
        { key, def: printing(printingId), owner, zone: "hand" },
        ...(spec.extra ?? []),
        ...bank(spec.icon, iconCount, owner),
        ...bank(OTHER_ICON[spec.icon], otherCount, owner),
        ...(spentN > 0 ? spentResources(owner, spentN) : [])
      ],
      { turn: spec.turn, active: spec.active }
    );
  const opts = (id: (k: string) => string) => ({
    selected: Object.fromEntries(Object.entries(spec.selected ?? {}).map(([decl, keys]) => [decl, keys.map(id)])),
    variables: spec.variables ?? {}
  });
  const finished = spec.done ?? "play";
  if (spec.cost > 0 && spec.count > spec.cost - 1) assert.equal(spec.icon, "rage", "spentResources are rage icons: a threshold of another icon would not stay met");

  // exactly enough
  {
    const b = build(spec.cost, 0, Math.max(spec.cost, spec.count), 0);
    const before = ready(b.engine, owner);
    play(b.engine, owner, b.id(key), opts(b.id));
    assert.equal(zoneOf(b.engine, b.id(key)), finished, "deployed with exactly the printed cost");
    assert.equal(before - ready(b.engine, owner), spec.cost, `the printed cost of ${spec.cost} is paid`);
    if (spec.stats && finished === "play") assert.deepEqual(statsOf(b.engine, b.id(key)), spec.stats, "printed strength / life / speed");
  }
  // one resource short of the numeric cost (the threshold icons are still all controlled, but spent)
  if (spec.cost > 0) {
    const spent = Math.max(0, spec.count - (spec.cost - 1));
    const b = build(spec.cost - 1, spent, spec.cost - 1, 0);
    refused(() => playRaw(b.engine, owner, b.id(key), opts(b.id)), "one resource short of the cost");
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", "nothing was played");
  }
  // enough resources, one icon short of the threshold
  if (spec.count > 0) {
    const b = build(spec.cost, 0, spec.count - 1, spec.cost + 3);
    refused(() => playRaw(b.engine, owner, b.id(key), opts(b.id)), "one icon short of the threshold");
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", "nothing was played");
  }
}

// --- Wild Boars ---------------------------------------------------------------
// While this card is the only member of an attacking party, only characters with
// at least X speed can block it, where X is this card's speed.
// Character (rogue, beast), cost 4, threshold [D][D], 2/2/4.

const BOARS = "03dfc9f9-28cf-451f-a141-ace62ab3f1be";

function boarsBoard(opts: { partner?: boolean; boarsController?: Pid; boarsItems?: CardDefinition[] } = {}) {
  const boarsOwner = opts.boarsController ?? P1;
  const foe = other(boarsOwner);
  return board(
    [
      { key: "boars", def: printing(BOARS), owner: boarsOwner, zone: "play" },
      ...(opts.partner ? [{ key: "partner", def: character({ name: "Partner", speed: 1 }), owner: boarsOwner, zone: "play" as const }] : []),
      ...(opts.boarsItems ?? []).map((def, i) => ({ key: `gear${i}`, def, owner: boarsOwner, zone: "play" as const, attachedToKey: "boars" })),
      { key: "s1", def: character({ name: "Speed1", speed: 1, life: 9 }), owner: foe, zone: "play" },
      { key: "s2", def: character({ name: "Speed2", speed: 2, life: 9 }), owner: foe, zone: "play" },
      { key: "s3", def: character({ name: "Speed3", speed: 3, life: 9 }), owner: foe, zone: "play" },
      { key: "s4", def: character({ name: "Speed4", speed: 4, life: 9 }), owner: foe, zone: "play" },
      { key: "s5", def: character({ name: "Speed5", speed: 5, life: 9 }), owner: foe, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 9 }), owner: foe, zone: "play" }
    ],
    { turn: 2, active: boarsOwner }
  );
}

clause(BOARS, "0:rule", "is deployed for exactly 4 with [D][D] and has its printed 2 / 2 / 4", () => {
  deployChecks(BOARS, { cost: 4, icon: "deception", count: 2, stats: [2, 2, 4] });
});

for (const [speed, legal] of [
  [3, false],
  [4, true],
  [5, true]
] as const) {
  clause(BOARS, "0:rule", `attacking alone, a speed-${speed} blocker ${legal ? "may" : "may not"} block it (X = 4: at least 4 speed)`, () => {
    const b = boarsBoard();
    declareAttackBy(b.engine, P1, [b.id("boars")]);
    if (legal) {
      declareBlockers(b.engine, P2, [b.id(`s${speed}`)]);
      assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id(`s${speed}`)]);
    } else {
      refused(() => declareBlockers(b.engine, P2, [b.id(`s${speed}`)]), `a speed-${speed} character is too slow to block a lone Wild Boars`);
      assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], [], "no block was declared");
    }
  });
}

clause(BOARS, "0:rule", "attacking alone, EVERY member of the blocking party must have at least 4 speed", () => {
  const ok = boarsBoard();
  declareAttackBy(ok.engine, P1, [ok.id("boars")]);
  declareBlockers(ok.engine, P2, [ok.id("s4"), ok.id("s5")]);
  assert.deepEqual([...(battleOf(ok.engine)?.blockingParty ?? [])].sort(), [ok.id("s4"), ok.id("s5")].sort(), "two fast-enough blockers");

  const mixed = boarsBoard();
  declareAttackBy(mixed.engine, P1, [mixed.id("boars")]);
  refused(() => declareBlockers(mixed.engine, P2, [mixed.id("s4"), mixed.id("s3")]), "a too-slow character cannot join a fast one in the blocking party");
  assert.deepEqual(battleOf(mixed.engine)?.blockingParty ?? [], []);
});

clause(BOARS, "0:rule", "declaring no blockers is always allowed", () => {
  const b = boarsBoard();
  declareAttackBy(b.engine, P1, [b.id("boars")]);
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(BOARS, "0:rule", "in a party with another member the restriction is off: a speed-1 character may block", () => {
  const b = boarsBoard({ partner: true });
  declareAttackBy(b.engine, P1, [b.id("boars"), b.id("partner")]);
  declareBlockers(b.engine, P2, [b.id("s1")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("s1")], "not the only member of the party");
});

clause(BOARS, "0:rule", "the restriction also holds when the lone Wild Boars attacks a location", () => {
  const slow = boarsBoard();
  declareAttackBy(slow.engine, P1, [slow.id("boars")], { type: "card", cardId: slow.id("loc") });
  refused(() => declareBlockers(slow.engine, P2, [slow.id("s3")]), "too slow, even when attacking a location");

  const fast = boarsBoard();
  declareAttackBy(fast.engine, P1, [fast.id("boars")], { type: "card", cardId: fast.id("loc") });
  declareBlockers(fast.engine, P2, [fast.id("s4")]);
  assert.deepEqual(battleOf(fast.engine)?.blockingParty, [fast.id("s4")]);
});

clause(BOARS, "0:rule", "X is its CURRENT speed: with +1 speed a speed-4 blocker is too slow, with -2 speed a speed-2 blocker is enough", () => {
  const faster = boarsBoard({ boarsItems: [statItem("speed", 1)] });
  assert.equal(speedOf(faster.engine, faster.id("boars")), 5, "the test item works");
  declareAttackBy(faster.engine, P1, [faster.id("boars")]);
  refused(() => declareBlockers(faster.engine, P2, [faster.id("s4")]), "X is now 5");
  declareBlockers(faster.engine, P2, [faster.id("s5")]);
  assert.deepEqual(battleOf(faster.engine)?.blockingParty, [faster.id("s5")]);

  const slower = boarsBoard({ boarsItems: [statItem("speed", -2)] });
  assert.equal(speedOf(slower.engine, slower.id("boars")), 2);
  declareAttackBy(slower.engine, P1, [slower.id("boars")]);
  refused(() => declareBlockers(slower.engine, P2, [slower.id("s1")]), "X is now 2: a speed-1 blocker is too slow");
  declareBlockers(slower.engine, P2, [slower.id("s2")]);
  assert.deepEqual(battleOf(slower.engine)?.blockingParty, [slower.id("s2")], "speed 2 is enough");
});

clause(BOARS, "0:rule", "a blocker's speed is its CURRENT speed: a speed-3 character with a +1 speed item may block, a speed-5 one with a -2 item may not", () => {
  const fastened = board(
    [
      { key: "boars", def: printing(BOARS), owner: P1, zone: "play" },
      { key: "s3", def: character({ name: "Speed3", speed: 3, life: 9 }), owner: P2, zone: "play" },
      { key: "boost", def: statItem("speed", 1), owner: P2, zone: "play", attachedToKey: "s3" }
    ],
    { turn: 2, active: P1 }
  );
  assert.equal(speedOf(fastened.engine, fastened.id("s3")), 4);
  declareAttackBy(fastened.engine, P1, [fastened.id("boars")]);
  declareBlockers(fastened.engine, P2, [fastened.id("s3")]);
  assert.deepEqual(battleOf(fastened.engine)?.blockingParty, [fastened.id("s3")], "speed 3 + 1 = 4 is enough");

  const slowed = board(
    [
      { key: "boars", def: printing(BOARS), owner: P1, zone: "play" },
      { key: "s5", def: character({ name: "Speed5", speed: 5, life: 9 }), owner: P2, zone: "play" },
      { key: "drag", def: statItem("speed", -2), owner: P2, zone: "play", attachedToKey: "s5" }
    ],
    { turn: 2, active: P1 }
  );
  assert.equal(speedOf(slowed.engine, slowed.id("s5")), 3);
  declareAttackBy(slowed.engine, P1, [slowed.id("boars")]);
  refused(() => declareBlockers(slowed.engine, P2, [slowed.id("s5")]), "speed 5 - 2 = 3 is too slow");
});

clause(BOARS, "0:rule", "'the only member' is judged when blockers are declared: if its partner is destroyed in response, the Boars IS alone and the speed rule applies", () => {
  const mk = () =>
    board(
      [
        { key: "boars", def: printing(BOARS), owner: P1, zone: "play" },
        { key: "partner", def: character({ name: "Partner", life: 1, speed: 1 }), owner: P1, zone: "play" },
        { key: "s3", def: character({ name: "Speed3", speed: 3, life: 9 }), owner: P2, zone: "play" },
        { key: "s4", def: character({ name: "Speed4", speed: 4, life: 9 }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
      ],
      { turn: 2, active: P1 }
    );
  const b = mk();
  attackRaw(b.engine, P1, [b.id("boars"), b.id("partner")]);
  b.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("partner")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("partner")), "discard");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("boars")], "the partner left the party");
  refused(() => declareBlockers(b.engine, P2, [b.id("s3")]), "the Boars is now the only member: a speed-3 blocker is too slow");
  declareBlockers(b.engine, P2, [b.id("s4")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("s4")]);
});

clause(BOARS, "0:rule", "an opponent's lone Wild Boars is blocked only by fast-enough characters of the defender", () => {
  const b = boarsBoard({ boarsController: P2 });
  declareAttackBy(b.engine, P2, [b.id("boars")]);
  refused(() => declareBlockers(b.engine, P1, [b.id("s3")]), "P1's speed-3 character cannot block P2's lone Boars");
  declareBlockers(b.engine, P1, [b.id("s4")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("s4")]);
});

clause(BOARS, "0:rule", "it only restricts blocks of its own party: another lone attacker can be blocked by a slow character, and a Wild Boars that blocks is not restricted", () => {
  // The Boars sits in play but is not attacking: a plain lone attacker is blockable by anyone.
  const plain = board(
    [
      { key: "boars", def: printing(BOARS), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", speed: 3 }), owner: P1, zone: "play" },
      { key: "slow", def: character({ name: "Slow", speed: 1, life: 9 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(plain.engine, P1, [plain.id("atk")]);
  declareBlockers(plain.engine, P2, [plain.id("slow")]);
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("slow")], "a slow blocker is fine against an ordinary attacker");

  // The Boars blocks a slow attacker: no speed requirement applies to the Boars' own block.
  const blocking = board(
    [
      { key: "boars", def: printing(BOARS), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", speed: 1 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(blocking.engine, P1, [blocking.id("atk")]);
  declareBlockers(blocking.engine, P2, [blocking.id("boars")]);
  assert.deepEqual(battleOf(blocking.engine)?.blockingParty, [blocking.id("boars")]);
});

// --- Anxious Oaf --------------------------------------------------------------
// When an attacking or blocking party is formed that includes this card, it must
// have at least 2 members. Character (warlord, berserker), cost 2, [R], 3/1/3.

const OAF = "5ceba10d-9cdd-4abd-9de9-13cc1cbbbe5a";

function oafBoard(opts: { oafController?: Pid; active?: Pid } = {}) {
  const oafOwner = opts.oafController ?? P1;
  const foe = other(oafOwner);
  return board(
    [
      { key: "oaf", def: printing(OAF), owner: oafOwner, zone: "play" },
      { key: "oaf2", def: printing(OAF), owner: oafOwner, zone: "play" },
      { key: "a1", def: character({ name: "A1", life: 9 }), owner: oafOwner, zone: "play" },
      { key: "a2", def: character({ name: "A2", life: 9 }), owner: oafOwner, zone: "play" },
      { key: "b1", def: character({ name: "B1", life: 9 }), owner: foe, zone: "play" },
      { key: "b2", def: character({ name: "B2", life: 9 }), owner: foe, zone: "play" }
    ],
    { turn: 2, active: opts.active ?? oafOwner }
  );
}

clause(OAF, "0:rule", "is deployed for exactly 2 with [R] and has its printed 3 / 1 / 3", () => {
  deployChecks(OAF, { cost: 2, icon: "rage", count: 1, stats: [3, 1, 3] });
});

clause(OAF, "0:rule", "an attacking party including it needs at least 2 members: 1 is refused, 2 and 3 are allowed", () => {
  const solo = oafBoard();
  refused(() => attackRaw(solo.engine, P1, [solo.id("oaf")]), "the Oaf cannot attack alone");
  assert.equal(battleOf(solo.engine), undefined, "no battle began");
  assert.equal(isDepleted(solo.engine, solo.id("oaf")), false, "the Oaf was not depleted by the refused attack");

  const pair = oafBoard();
  attackRaw(pair.engine, P1, [pair.id("oaf"), pair.id("a1")]);
  assert.deepEqual([...(battleOf(pair.engine)?.attackingParty ?? [])].sort(), [pair.id("oaf"), pair.id("a1")].sort(), "2 members is enough");

  const trio = oafBoard();
  attackRaw(trio.engine, P1, [trio.id("oaf"), trio.id("a1"), trio.id("a2")]);
  assert.equal(battleOf(trio.engine)?.attackingParty.length, 3, "3 members is fine too");
});

clause(OAF, "0:rule", "two Oafs form a legal party of 2", () => {
  const b = oafBoard();
  attackRaw(b.engine, P1, [b.id("oaf"), b.id("oaf2")]);
  assert.equal(battleOf(b.engine)?.attackingParty.length, 2);
});

clause(OAF, "0:rule", "a party that does not include the Oaf is unaffected: another character may attack alone while the Oaf is in play", () => {
  const b = oafBoard();
  attackRaw(b.engine, P1, [b.id("a1")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")]);
});

clause(OAF, "0:rule", "a blocking party including it needs at least 2 members: the Oaf alone is refused, with another character it is allowed", () => {
  const solo = oafBoard({ oafController: P2, active: P1 });
  declareAttackBy(solo.engine, P1, [solo.id("b1")]);
  refused(() => declareBlockers(solo.engine, P2, [solo.id("oaf")]), "the Oaf cannot block alone");
  assert.deepEqual(battleOf(solo.engine)?.blockingParty ?? [], []);

  const pair = oafBoard({ oafController: P2, active: P1 });
  declareAttackBy(pair.engine, P1, [pair.id("b1")]);
  declareBlockers(pair.engine, P2, [pair.id("oaf"), pair.id("a1")]);
  assert.deepEqual([...(battleOf(pair.engine)?.blockingParty ?? [])].sort(), [pair.id("oaf"), pair.id("a1")].sort());
});

clause(OAF, "0:rule", "another character may block alone while the Oaf is in play, and declaring no blockers is allowed", () => {
  const alone = oafBoard({ oafController: P2, active: P1 });
  declareAttackBy(alone.engine, P1, [alone.id("b1")]);
  declareBlockers(alone.engine, P2, [alone.id("a1")]);
  assert.deepEqual(battleOf(alone.engine)?.blockingParty, [alone.id("a1")]);

  const none = oafBoard({ oafController: P2, active: P1 });
  declareAttackBy(none.engine, P1, [none.id("b1")]);
  declareBlockers(none.engine, P2, []);
  assert.deepEqual(battleOf(none.engine)?.blockingParty ?? [], [], "no blocking party is formed, so there is nothing to be too small");
});

clause(OAF, "0:rule", "the minimum applies when the party is FORMED: if the other member is destroyed afterwards the Oaf stays in the battle", () => {
  const b = board(
    [
      { key: "oaf", def: printing(OAF), owner: P1, zone: "play" },
      { key: "partner", def: character({ name: "Partner", life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(b.engine, P1, [b.id("oaf"), b.id("partner")]);
  b.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("partner")] } });
  resolvePendingResponses(b.engine);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("oaf")], "the party shrank to the Oaf");
  assert.equal(zoneOf(b.engine, b.id("oaf")), "play");
  declareBlockers(b.engine, P2, []);
});

clause(OAF, "0:rule", "an opponent's Oaf does not restrict my parties: I may attack alone and block alone", () => {
  const b = board(
    [
      { key: "oaf", def: printing(OAF), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(b.engine, P1, [b.id("a1")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")], "P1's lone attack is legal");
});

// --- Assimilation Center ------------------------------------------------------
// "RECRUIT" -- COST: Pay 1. Deplete this card. -- EFFECT: Search your deck for a
// character, reveal it, and put it on the top of your deck.
// Location (warlord), cost 2, [R][R], structure 4.

const CENTER = "b0760e4d-f149-4fc6-a698-8e405e825036";

function centerBoard(opts: { rage?: number; deckCharacters?: number; noCharacters?: boolean; centerController?: Pid; centerDepleted?: boolean } = {}) {
  const deck: CardPlacement[] = opts.noCharacters
    ? [
        { key: "item", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
        { key: "tac", def: tactic({ name: "DeckTactic", cost: 1 }), owner: P1, zone: "deck" },
        { key: "loc", def: location({ name: "DeckLocation" }), owner: P1, zone: "deck" },
        { key: "res", def: resourceCard({ name: "DeckResource" }), owner: P1, zone: "deck" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `it${i}`, def: item({ name: `DeckItem${i}` }), owner: P1, zone: "deck" as const }))
      ]
    : [
        { key: "item", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
        { key: "tac", def: tactic({ name: "DeckTactic", cost: 1 }), owner: P1, zone: "deck" },
        ...fill("c", opts.deckCharacters ?? 4, P1, "deck"),
        { key: "loc", def: location({ name: "DeckLocation" }), owner: P1, zone: "deck" },
        { key: "res", def: resourceCard({ name: "DeckResource" }), owner: P1, zone: "deck" },
        ...fill("d", 3, P1, "deck")
      ];
  return board([
    { key: "center", def: printing(CENTER), owner: opts.centerController ?? P1, zone: "play", depleted: opts.centerDepleted },
    ...deck,
    ...fill("foeDeck", 3, P2, "deck"),
    { key: "inHand", def: character({ name: "InHandChar" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscardChar" }), owner: P1, zone: "discard" },
    ...bank("rage", opts.rage ?? 3, P1)
  ], { random: seeded(2024) });
}

const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

clause(CENTER, "0:ability:recruit", "is deployed for exactly 2 with [R][R]", () => {
  deployChecks(CENTER, { cost: 2, icon: "rage", count: 2 });
});

clause(CENTER, "0:ability:recruit", "has structure 4: 3 damage leaves it in play, 4 damage destroys it", () => {
  const shoot = (amount: number) => {
    const b = board([
      { key: "center", def: printing(CENTER), owner: P1, zone: "play" },
      { key: "shot", def: locationZap(amount), owner: P2, zone: "hand" }
    ], { turn: 2, active: P2 });
    play(b.engine, P2, b.id("shot"), { selected: { t: [b.id("center")] } });
    return zoneOf(b.engine, b.id("center"));
  };
  assert.equal(shoot(3), "play", "3 damage markers on a structure of 4");
  assert.equal(shoot(4), "discard", "4 damage markers destroy it");
});

clause(CENTER, "0:ability:recruit", "pays 1 resource and depletes the Center; the searched character ends on top of the deck", () => {
  const b = centerBoard();
  const before = ready(b.engine);
  const deckSize = deckOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("center"), "recruit");
  assert.equal(before - ready(b.engine), 1, "COST: Pay 1");
  assert.equal(isDepleted(b.engine, b.id("center")), true, "COST: Deplete this card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "you search your deck");
  assert.equal(pending(b.engine)?.playerId, P1, "the Center's controller searches");
  pick(b.engine, [b.id("c2")]);
  assert.equal(deckOf(b.engine, P1)[0], b.id("c2"), "put on the top of your deck");
  assert.equal(zoneOf(b.engine, b.id("c2")), "deck");
  assert.equal(deckOf(b.engine, P1).length, deckSize, "no card left the deck");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CENTER, "0:ability:recruit", "the cost is paid when the ability is activated, before the search resolves", () => {
  const b = centerBoard();
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("center"), "recruit");
  assert.equal(isDepleted(b.engine, b.id("center")), true);
  assert.equal(before - ready(b.engine), 1);
});

clause(CENTER, "0:ability:recruit", "only characters can be found: an item, a tactic, a location and a resource card in the deck are refused", () => {
  for (const key of ["item", "tac", "loc", "res"]) {
    const b = centerBoard();
    activate(b.engine, P1, b.id("center"), "recruit");
    refused(() => pickAs(b.engine, P1, [b.id(key)]), `${key} is not a character`);
  }
  const ok = centerBoard();
  activate(ok.engine, P1, ok.id("center"), "recruit");
  pick(ok.engine, [ok.id("c0")]);
  assert.equal(deckOf(ok.engine, P1)[0], ok.id("c0"), "control: a character is accepted");
});

clause(CENTER, "0:ability:recruit", "only characters in YOUR DECK: the opponent's deck, your hand and your discard pile are not searched", () => {
  for (const key of ["foeDeck0", "inHand", "inDiscard"]) {
    const b = centerBoard();
    activate(b.engine, P1, b.id("center"), "recruit");
    refused(() => pickAs(b.engine, P1, [b.id(key)]), `${key} is not a character in your deck`);
  }
});

clause(CENTER, "0:ability:recruit", "finds exactly one character: two are refused, and a card deep in the deck can be found", () => {
  const two = centerBoard();
  activate(two.engine, P1, two.id("center"), "recruit");
  refused(() => pickAs(two.engine, P1, [two.id("c0"), two.id("c1")]), "a search finds one character");

  const deep = centerBoard({ deckCharacters: 4 });
  activate(deep.engine, P1, deep.id("center"), "recruit");
  pick(deep.engine, [deep.id("d2")]);
  assert.equal(deckOf(deep.engine, P1)[0], deep.id("d2"), "even the last character of the deck");
});

clause(CENTER, "0:ability:recruit", "the opponent cannot answer the search for you", () => {
  const b = centerBoard();
  activate(b.engine, P1, b.id("center"), "recruit");
  refused(() => pickAs(b.engine, P2, [b.id("c0")]), "the Center's controller chooses");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(CENTER, "0:ability:recruit", "the character is revealed", () => {
  const b = centerBoard();
  activate(b.engine, P1, b.id("center"), "recruit");
  pick(b.engine, [b.id("c1")]);
  const reveals = revealEvents(b.engine).filter((entry) => (entry.event as { cardIds?: string[] }).cardIds?.includes(b.id("c1")));
  assert.ok(reveals.length >= 1, "a cardsRevealed event names the found character");
});

clause(CENTER, "0:ability:recruit", "the deck is shuffled by the search (CR 312.1) before the character is put on top; the other cards keep all being in the deck", () => {
  const b = centerBoard();
  const before = [...deckOf(b.engine, P1)];
  activate(b.engine, P1, b.id("center"), "recruit");
  pick(b.engine, [b.id("c3")]);
  const after = deckOf(b.engine, P1);
  assert.equal(after[0], b.id("c3"));
  assert.deepEqual([...after].sort(), [...before].sort(), "the same cards are in the deck");
  assert.notDeepEqual(after.slice(1), before.filter((card) => card !== b.id("c3")), "the rest of the deck was shuffled");
});

clause(CENTER, "0:ability:recruit", "a search for a character may fail (CR 312.2): you may choose none; the cost is still paid and the deck is still shuffled", () => {
  const b = centerBoard();
  const before = [...deckOf(b.engine, P1)];
  const readyBefore = ready(b.engine);
  activate(b.engine, P1, b.id("center"), "recruit");
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyBefore - ready(b.engine), 1, "the cost stays paid");
  assert.equal(isDepleted(b.engine, b.id("center")), true);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort(), "nothing left the deck");
  assert.notDeepEqual(deckOf(b.engine, P1), before, "a searched deck is shuffled afterwards (CR 312.1), found or not");
});

clause(CENTER, "0:ability:recruit", "with no character in the deck the ability can still be used (it fails to find one) and the deck is shuffled", () => {
  const b = centerBoard({ noCharacters: true });
  const before = [...deckOf(b.engine, P1)];
  const readyBefore = ready(b.engine);
  activate(b.engine, P1, b.id("center"), "recruit");
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyBefore - ready(b.engine), 1, "the cost is paid");
  assert.equal(isDepleted(b.engine, b.id("center")), true);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "the searched deck is shuffled (CR 312.1)");
});

clause(CENTER, "0:ability:recruit", "is refused with no resource to pay 1 with, and nothing is depleted", () => {
  const none = centerBoard({ rage: 0 });
  refused(() => activate(none.engine, P1, none.id("center"), "recruit"), "no resource to pay with");
  assert.equal(isDepleted(none.engine, none.id("center")), false);
  const exact = centerBoard({ rage: 1 });
  activate(exact.engine, P1, exact.id("center"), "recruit");
  assert.equal(isDepleted(exact.engine, exact.id("center")), true, "one resource is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(CENTER, "0:ability:recruit", "is refused while the Center is depleted, and is usable again once it is restored (next turn)", () => {
  const b = centerBoard({ centerDepleted: true });
  refused(() => activate(b.engine, P1, b.id("center"), "recruit"), "the deplete cost cannot be paid again");
  assert.equal(ready(b.engine), 3, "no resource was spent by the refused attempt");

  const c = centerBoard();
  activate(c.engine, P1, c.id("center"), "recruit");
  pick(c.engine, []);
  refused(() => activate(c.engine, P1, c.id("center"), "recruit"), "a second use in the same turn");
  endTurn(c.engine, P1);
  endTurn(c.engine, P2);
  assert.equal(isDepleted(c.engine, c.id("center")), false, "restored at the start of its controller's turn");
  activate(c.engine, P1, c.id("center"), "recruit");
  assert.equal(pending(c.engine)?.kind, "chooserSelectsTarget", "usable again");
});

clause(CENTER, "0:ability:recruit", "it is an ability: it can be used on the opponent's turn as a response", () => {
  const b = board(
    [
      { key: "center", def: printing(CENTER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...fill("c", 3, P1, "deck"),
      ...bank("rage", 2, P1)
    ],
    { turn: 2, active: P2, random: seeded(77) }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("center"), abilityId: "recruit", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("c2")]);
  assert.equal(deckOf(b.engine, P1)[0], b.id("c2"));
  assert.equal(isDepleted(b.engine, b.id("center")), true);
});

clause(CENTER, "0:ability:recruit", "only its controller can use it", () => {
  const b = centerBoard({ centerController: P2 });
  refused(() => activate(b.engine, P1, b.id("center"), "recruit"), "P1 does not control the Center");
});

// --- Barbaric Rifleman --------------------------------------------------------
// When this card enters play, inflict 1 damage to your opponent's faction.
// Character (warlord, soldier), cost 2, [R][R], 2/1/3.

const RIFLEMAN = "ad4fc0ee-cc07-4927-93ab-c1daeb97798c";

function riflemanBoard(extra: CardPlacement[] = [], opts: { rage?: number; owner?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  return board(
    [{ key: "rifle", def: printing(RIFLEMAN), owner, zone: "hand" }, ...bank("rage", opts.rage ?? 4, owner), ...extra],
    { turn: 2, active: owner }
  );
}

clause(RIFLEMAN, "0:rule", "is deployed for exactly 2 with [R][R] and has its printed 2 / 1 / 3", () => {
  deployChecks(RIFLEMAN, { cost: 2, icon: "rage", count: 2, stats: [2, 1, 3] });
});

clause(RIFLEMAN, "0:rule", "entering play, it inflicts exactly 1 damage to the opponent's faction and not to its controller's", () => {
  const b = riflemanBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("rifle"));
  assert.equal(zoneOf(b.engine, b.id("rifle")), "play");
  assert.equal(influence(b.engine, P2), theirs - 1, "the opponent's faction takes 1");
  assert.equal(influence(b.engine, P1), mine, "my faction takes nothing");
});

clause(RIFLEMAN, "0:rule", "an opponent's Rifleman damages ITS opponent's faction (the other player)", () => {
  const b = riflemanBoard([], { owner: P2 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P2, b.id("rifle"));
  assert.equal(influence(b.engine, P1), mine - 1);
  assert.equal(influence(b.engine, P2), theirs);
});

clause(RIFLEMAN, "0:rule", "the trigger waits for the card to enter play: nothing happens while it is still being deployed", () => {
  const b = riflemanBoard();
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("rifle"));
  assert.equal(zoneOf(b.engine, b.id("rifle")), "deploying");
  assert.equal(influence(b.engine, P2), theirs, "no damage while the opponent may still respond");
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 1);
});

clause(RIFLEMAN, "0:rule", "it also triggers when it is put into play by an effect", () => {
  const b = board(
    [
      { key: "rifle", def: printing(RIFLEMAN), owner: P1, zone: "hand" },
      { key: "put", def: putInPlayTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 2, active: P1 }
  );
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("rifle")] } });
  assert.equal(zoneOf(b.engine, b.id("rifle")), "play");
  assert.equal(influence(b.engine, P2), theirs - 1);
});

clause(RIFLEMAN, "0:rule", "it triggers only for itself: another character entering play does not damage anyone, and a Rifleman already in play is not re-triggered", () => {
  const b = board(
    [
      { key: "rifle", def: printing(RIFLEMAN), owner: P1, zone: "play" },
      { key: "newcomer", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { turn: 2, active: P1 }
  );
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("newcomer"));
  assert.equal(zoneOf(b.engine, b.id("newcomer")), "play");
  assert.equal(influence(b.engine, P2), theirs, "no damage from another card entering play");
  const second = board(
    [
      { key: "rifle", def: printing(RIFLEMAN), owner: P1, zone: "hand" },
      { key: "rifle2", def: printing(RIFLEMAN), owner: P1, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, active: P1 }
  );
  const before = influence(second.engine, P2);
  play(second.engine, P1, second.id("rifle"));
  assert.equal(influence(second.engine, P2), before - 1, "two Riflemen: only the entering one triggers (1 damage, not 2)");
});

clause(RIFLEMAN, "0:rule", "played face-down as a resource it is not the card (no rules text), so nothing happens", () => {
  const b = board([{ key: "rifle", def: printing(RIFLEMAN), owner: P1, zone: "hand" }], { turn: 2, active: P1 });
  const theirs = influence(b.engine, P2);
  developPlay(b.engine, P1, b.id("rifle"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("rifle")].faceDown, true);
  assert.equal(influence(b.engine, P2), theirs, "a face-down card has no rules text");
});

clause(RIFLEMAN, "0:rule", "it is DAMAGE (not influence loss): a damage-reducing effect on factions reduces it to 0", () => {
  const control = board([{ key: "zap", def: factionZap(1), owner: P1, zone: "hand" }, { key: "shield", def: factionShield(), owner: P2, zone: "play" }], { turn: 2, active: P1 });
  const controlBefore = influence(control.engine, P2);
  play(control.engine, P1, control.id("zap"));
  assert.equal(influence(control.engine, P2), controlBefore, "control: the test shield reduces 1 damage to 0");

  const b = riflemanBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("rifle"));
  assert.equal(zoneOf(b.engine, b.id("rifle")), "play");
  assert.equal(influence(b.engine, P2), theirs, "1 damage minus 1 = 0: the faction loses nothing");
});

// --- Battle Surge -------------------------------------------------------------
// This turn, all your characters gain 1 strength. Tactic (warlord), cost 1, [R].

const SURGE = "1a6c1f62-30b3-46cb-a83f-4c6fc0cdc9f0";

function surgeBoard(extra: CardPlacement[] = [], opts: { rage?: number; turn?: number } = {}) {
  return board(
    [
      { key: "surge", def: printing(SURGE), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2", strength: 0, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "m3", def: character({ name: "Mine3", strength: 5, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "MyGear" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...extra
    ],
    { turn: opts.turn }
  );
}

clause(SURGE, "0:rule", "is played for exactly 1 with [R] and ends in its owner's discard pile", () => {
  deployChecks(SURGE, { cost: 1, icon: "rage", count: 1, done: "discard" });
});

clause(SURGE, "0:rule", "every character I control gains exactly 1 strength (strength 2, 0 and 5 become 3, 1 and 6)", () => {
  const b = surgeBoard();
  play(b.engine, P1, b.id("surge"));
  assert.equal(zoneOf(b.engine, b.id("surge")), "discard");
  assert.equal(strengthOf(b.engine, b.id("m1")), 3);
  assert.equal(strengthOf(b.engine, b.id("m2")), 1);
  assert.equal(strengthOf(b.engine, b.id("m3")), 6);
});

clause(SURGE, "0:rule", "it changes strength only: life and speed are untouched", () => {
  const b = surgeBoard();
  play(b.engine, P1, b.id("surge"));
  assert.deepEqual([lifeOf(b.engine, b.id("m1")), speedOf(b.engine, b.id("m1"))], [4, 3]);
  assert.deepEqual([lifeOf(b.engine, b.id("m3")), speedOf(b.engine, b.id("m3"))], [4, 1]);
});

clause(SURGE, "0:rule", "the opponent's characters are not affected", () => {
  const b = surgeBoard();
  play(b.engine, P1, b.id("surge"));
  assert.equal(strengthOf(b.engine, b.id("foe")), 3);
});

clause(SURGE, "0:rule", "'your' means controlled: a character I took from my opponent gains strength, one my opponent took from me does not", () => {
  const b = surgeBoard([
    { key: "stolenByMe", def: character({ name: "StolenByMe", strength: 1 }), owner: P2, zone: "play", controller: P1 },
    { key: "stolenFromMe", def: character({ name: "StolenFromMe", strength: 1 }), owner: P1, zone: "play", controller: P2 }
  ]);
  play(b.engine, P1, b.id("surge"));
  assert.equal(strengthOf(b.engine, b.id("stolenByMe")), 2);
  assert.equal(strengthOf(b.engine, b.id("stolenFromMe")), 1);
});

clause(SURGE, "0:rule", "it lasts this turn only: the bonus is gone once the turn has ended", () => {
  const b = surgeBoard();
  play(b.engine, P1, b.id("surge"));
  assert.equal(strengthOf(b.engine, b.id("m1")), 3);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(strengthOf(b.engine, b.id("m1")), 2, "back to the printed strength");
  assert.equal(strengthOf(b.engine, b.id("m3")), 5);
});

clause(SURGE, "0:rule", "two Battle Surges stack: +2 strength", () => {
  const b = surgeBoard([{ key: "surge2", def: printing(SURGE), owner: P1, zone: "hand" }], { rage: 4 });
  play(b.engine, P1, b.id("surge"));
  play(b.engine, P1, b.id("surge2"));
  assert.equal(strengthOf(b.engine, b.id("m1")), 4);
});

clause(SURGE, "0:rule", "characters that enter play afterwards this turn do not get the bonus (it affects 'all your characters' at resolution)", () => {
  const b = surgeBoard([{ key: "late", def: character({ name: "Late", strength: 2, cost: 0 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("surge"));
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(strengthOf(b.engine, b.id("late")), 2);
  assert.equal(strengthOf(b.engine, b.id("m1")), 3, "the characters in play at resolution kept the bonus");
});

clause(SURGE, "0:rule", "the extra strength is real in battle: a 1-strength attacker kills a 2-life blocker only after the Surge", () => {
  const mk = () =>
    board(
      [
        { key: "surge", def: printing(SURGE), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 2, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 2, P1)
      ],
      { turn: 2, active: P1 }
    );
  const without = mk();
  fight(without.engine, P1, [without.id("atk")], { type: "faction", playerId: P2 }, [without.id("blk")]);
  assert.equal(zoneOf(without.engine, without.id("blk")), "play", "control: 1 damage does not kill a 2-life blocker");

  const withSurge = mk();
  play(withSurge.engine, P1, withSurge.id("surge"));
  fight(withSurge.engine, P1, [withSurge.id("atk")], { type: "faction", playerId: P2 }, [withSurge.id("blk")]);
  assert.equal(zoneOf(withSurge.engine, withSurge.id("blk")), "discard", "2 damage kills it");
});

clause(SURGE, "0:rule", "it can be played in response to an opponent's attack (a tactic), and the defender's blockers get the strength", () => {
  const b = board(
    [
      { key: "surge", def: printing(SURGE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      ...bank("rage", 2, P1)
    ],
    { turn: 2, active: P2 }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  playRaw(b.engine, P1, b.id("surge"));
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("blk")), 2);
  assert.equal(strengthOf(b.engine, b.id("atk")), 1, "the attacker is not mine");
});

// --- Blow Up ------------------------------------------------------------------
// COST: Pick an item. EFFECT: Destroy the item. Your opponent's faction loses 3
// influence. Tactic (warlord), cost 4, [R].

const BLOW_UP = "efa9c2c1-5448-4733-a6c4-471f7d625c02";

function blowUpBoard(extra: CardPlacement[] = [], opts: { rage?: number; influenceP2?: number } = {}) {
  return board(
    [
      { key: "bu", def: printing(BLOW_UP), owner: P1, zone: "hand" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "otherItem", def: item({ name: "OtherItem" }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...extra
    ],
    { influenceP2: opts.influenceP2 }
  );
}

clause(BLOW_UP, "0:ability", "is played for exactly 4 with [R] (it needs an item to pick)", () => {
  deployChecks(BLOW_UP, { cost: 4, icon: "rage", count: 1, done: "discard", selected: { it: ["item"] }, extra: [{ key: "item", def: item({ name: "Target" }), owner: P2, zone: "play" }] });
});

clause(BLOW_UP, "0:ability", "destroys the picked item and the opponent's faction loses exactly 3 influence (mine loses none)", () => {
  const b = blowUpBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  const spent = ready(b.engine);
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard", "the item is destroyed");
  assert.equal(influence(b.engine, P2), theirs - 3);
  assert.equal(influence(b.engine, P1), mine);
  assert.equal(spent - ready(b.engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(b.engine, b.id("bu")), "discard");
});

clause(BLOW_UP, "0:ability", "only the picked item is destroyed: another item of the same player and my own item stay in play", () => {
  const b = blowUpBoard();
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(zoneOf(b.engine, b.id("otherItem")), "play");
  assert.equal(zoneOf(b.engine, b.id("myItem")), "play");
});

clause(BLOW_UP, "0:ability", "the item may be one of my own: it is destroyed and the OPPONENT's faction still loses 3", () => {
  const b = blowUpBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("myItem")] } });
  assert.equal(zoneOf(b.engine, b.id("myItem")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 3);
  assert.equal(influence(b.engine, P1), mine);
});

clause(BLOW_UP, "0:ability", "an item attached to a character can be picked; its host stays in play", () => {
  const b = blowUpBoard([{ key: "gear", def: statItem("strength", 2), owner: P2, zone: "play", attachedToKey: "foe" }]);
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("gear")] } });
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(BLOW_UP, "0:ability", "the pick must be an item: a character, a location, a face-up resource, a face-down card, a faction, a card in hand or two items are refused", () => {
  const extra: CardPlacement[] = [
    { key: "hidden", def: item({ name: "HiddenItem" }), owner: P2, zone: "play", faceDown: true },
    { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
    { key: "discardItem", def: item({ name: "DiscardItem" }), owner: P2, zone: "discard" }
  ];
  const attempts: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["a character", (b) => [b.id("foe")]],
    ["my character", (b) => [b.id("mine")]],
    ["a location", (b) => [b.id("place")]],
    ["a face-up resource", (b) => [b.engine.state.players[P1].play.find((card) => b.engine.isResource(card))!]],
    ["a face-down item (a resource)", (b) => [b.id("hidden")]],
    ["the opponent's faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["an item in my hand", (b) => [b.id("handItem")]],
    ["an item in a discard pile", (b) => [b.id("discardItem")]],
    ["two items", (b) => [b.id("theirItem"), b.id("otherItem")]]
  ];
  for (const [label, picked] of attempts) {
    const b = blowUpBoard(extra);
    const theirs = influence(b.engine, P2);
    refused(() => playRaw(b.engine, P1, b.id("bu"), { selected: { it: picked(b) } }), `${label} cannot be picked`);
    assert.equal(influence(b.engine, P2), theirs, `${label}: nothing happened`);
    assert.equal(zoneOf(b.engine, b.id("bu")), "hand", `${label}: the tactic was not played`);
  }
  const ok = blowUpBoard(extra);
  play(ok.engine, P1, ok.id("bu"), { selected: { it: [ok.id("theirItem")] } });
  assert.equal(zoneOf(ok.engine, ok.id("theirItem")), "discard", "control: an item is accepted");
});

clause(BLOW_UP, "0:ability", "cannot be played without an item in play to pick", () => {
  const b = board([{ key: "bu", def: printing(BLOW_UP), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]);
  refused(() => playRaw(b.engine, P1, b.id("bu"), { selected: { it: [] } }), "no item to pick");
  assert.equal(zoneOf(b.engine, b.id("bu")), "hand");
});

clause(BLOW_UP, "0:ability", "the item goes to its OWNER's discard pile, even if I control it", () => {
  const b = blowUpBoard([{ key: "stolen", def: item({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("stolen")] } });
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("stolen")), "its owner's discard pile");
  assert.equal(discardOf(b.engine, P1).includes(b.id("stolen")), false);
});

clause(BLOW_UP, "0:ability", "the item is picked when it is played (cost) while the destruction and the influence loss wait for resolution", () => {
  const b = blowUpBoard();
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(zoneOf(b.engine, b.id("bu")), "deploying");
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "play", "not destroyed yet: the opponent may respond");
  assert.equal(influence(b.engine, P2), theirs, "no influence lost yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 3);
});

clause(BLOW_UP, "0:ability", "if the item is destroyed in response, the opponent's faction still loses 3 influence (effects do not fizzle)", () => {
  const b = blowUpBoard([{ key: "kill", def: itemKillTactic(), owner: P2, zone: "hand" }]);
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("theirItem")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bu")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 3, "402.5a: the rest of the effect still happens");
});

clause(BLOW_UP, "0:ability", "the influence loss is not damage: a damage-reducing effect on factions does not change it (CR 408.3b)", () => {
  const b = blowUpBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(influence(b.engine, P2), theirs - 3, "still exactly 3");
});

clause(BLOW_UP, "0:ability", "an opponent at 3 influence loses the game", () => {
  const b = blowUpBoard([], { influenceP2: 3 });
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(influence(b.engine, P2), 0);
  assert.equal(b.engine.state.winner, P1);
});

clause(BLOW_UP, "0:ability", "an opponent at 4 influence survives with 1", () => {
  const b = blowUpBoard([], { influenceP2: 4 });
  play(b.engine, P1, b.id("bu"), { selected: { it: [b.id("theirItem")] } });
  assert.equal(influence(b.engine, P2), 1);
  assert.equal(b.engine.state.winner, undefined);
});

// --- Brash Basher -------------------------------------------------------------
// (no rules text) Character (warlord, fighter), cost 5, [R], 6/2/3.

const BASHER = "8cab9dc3-6a31-4a2b-97b2-97f777445ef2";

clause(BASHER, "vanilla", "is deployed for exactly 5 with [R], refused one resource short or without [R], and has its printed 6 / 2 / 3", () => {
  deployChecks(BASHER, { cost: 5, icon: "rage", count: 1, stats: [6, 2, 3] });
});

clause(BASHER, "vanilla", "has no rules text: no keywords, no restrictions, no abilities, and it is a fighter", () => {
  const b = board([{ key: "bb", def: printing(BASHER), owner: P1, zone: "play" }]);
  assert.deepEqual(b.engine.getKeywords(b.id("bb")), []);
  assert.deepEqual(b.engine.getRestrictions(b.id("bb")), []);
  assert.deepEqual(b.engine.getAvailableActivatedAbilities(P1).filter((entry) => entry.cardId === b.id("bb")), []);
  assert.deepEqual(b.engine.getSubtypes(b.id("bb")), ["fighter"]);
  assert.deepEqual(b.engine.getCardTypes(b.id("bb")), ["character"]);
});

clause(BASHER, "vanilla", "dies to 2 damage (life 2) and survives 1", () => {
  const hit = (amount: number) => {
    const b = board([
      { key: "bb", def: printing(BASHER), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic(amount), owner: P2, zone: "hand" }
    ], { turn: 2, active: P2 });
    play(b.engine, P2, b.id("zap"), { selected: { t: [b.id("bb")] } });
    return zoneOf(b.engine, b.id("bb"));
  };
  assert.equal(hit(1), "play");
  assert.equal(hit(2), "discard");
});

// --- Callow Liegeman ----------------------------------------------------------
// If this card attacks in a party with more than 1 member, it gains 1 strength
// and 1 life this turn. Character (warlord, soldier), cost 3, [R][R], 2/2/3.

const LIEGEMAN = "4cd88c6e-b5be-4383-952a-a3a7944aff55";

function liegemanBoard(extra: CardPlacement[] = []) {
  return board(
    [
      { key: "lieg", def: printing(LIEGEMAN), owner: P1, zone: "play" },
      { key: "lieg2", def: printing(LIEGEMAN), owner: P1, zone: "play" },
      { key: "pal1", def: character({ name: "Pal1", strength: 1, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "pal2", def: character({ name: "Pal2", strength: 1, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

clause(LIEGEMAN, "0:rule", "is deployed for exactly 3 with [R][R] and has its printed 2 / 2 / 3", () => {
  deployChecks(LIEGEMAN, { cost: 3, icon: "rage", count: 2, stats: [2, 2, 3] });
});

clause(LIEGEMAN, "0:rule", "attacking in a party of 2, it gains exactly 1 strength and 1 life (speed unchanged)", () => {
  const b = liegemanBoard();
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [2, 2, 3]);
  declareAttackBy(b.engine, P1, [b.id("lieg"), b.id("pal1")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [3, 3, 3]);
});

clause(LIEGEMAN, "0:rule", "attacking in a party of 3, it gains 1 strength and 1 life once (not once per extra member)", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("lieg"), b.id("pal1"), b.id("pal2")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [3, 3, 3]);
});

clause(LIEGEMAN, "0:rule", "attacking alone it gains nothing", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("lieg")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [2, 2, 3]);
});

clause(LIEGEMAN, "0:rule", "only the Liegeman gains: the other party members keep their stats", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("lieg"), b.id("pal1")]);
  assert.deepEqual(statsOf(b.engine, b.id("pal1")), [1, 4, 3]);
});

clause(LIEGEMAN, "0:rule", "a party attacked with a Liegeman that is not part of it does not benefit: no bonus when it stays home", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("pal1"), b.id("pal2")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [2, 2, 3], "the Liegeman did not attack");
});

clause(LIEGEMAN, "0:rule", "attacking a LOCATION in a party of 2 counts too; alone it does not", () => {
  const withLoc = (members: string[]) => {
    const b = liegemanBoard([{ key: "loc", def: location({ name: "TheirPlace", structure: 9 }), owner: P2, zone: "play" }]);
    declareAttackBy(b.engine, P1, members.map(b.id), { type: "card", cardId: b.id("loc") });
    return statsOf(b.engine, b.id("lieg"));
  };
  assert.deepEqual(withLoc(["lieg", "pal1"]), [3, 3, 3]);
  assert.deepEqual(withLoc(["lieg"]), [2, 2, 3]);
});

clause(LIEGEMAN, "0:rule", "two Liegemen in one party each gain 1 strength and 1 life", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("lieg"), b.id("lieg2")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [3, 3, 3]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg2")), [3, 3, 3]);
});

clause(LIEGEMAN, "0:rule", "blocking in a party of 2 gives nothing (the rule is about attacking)", () => {
  const b = board(
    [
      { key: "lieg", def: printing(LIEGEMAN), owner: P2, zone: "play" },
      { key: "pal", def: character({ name: "Pal", life: 4 }), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 4 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("lieg"), b.id("pal")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [2, 2, 3]);
});

clause(LIEGEMAN, "0:rule", "the bonus lasts this turn only", () => {
  const b = liegemanBoard();
  declareAttackBy(b.engine, P1, [b.id("lieg"), b.id("pal1")]);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [3, 3, 3]);
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [3, 3, 3], "still this turn after the battle");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.deepEqual(statsOf(b.engine, b.id("lieg")), [2, 2, 3]);
});

clause(LIEGEMAN, "0:rule", "the extra life is real: 2 damage destroys a lone-attacking Liegeman's 2 life but not the 3 life of one attacking in a party", () => {
  const alone = board(
    [
      { key: "lieg", def: printing(LIEGEMAN), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic(2), owner: P2, zone: "hand" }
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(alone.engine, P1, [alone.id("lieg")]);
  alone.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(alone.engine, P2, alone.id("zap"), { selected: { t: [alone.id("lieg")] } });
  resolvePendingResponses(alone.engine);
  assert.equal(zoneOf(alone.engine, alone.id("lieg")), "discard", "2 life, 2 damage");

  const grouped = board(
    [
      { key: "lieg", def: printing(LIEGEMAN), owner: P1, zone: "play" },
      { key: "pal", def: character({ name: "Pal", life: 4 }), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic(2), owner: P2, zone: "hand" }
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(grouped.engine, P1, [grouped.id("lieg"), grouped.id("pal")]);
  grouped.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(grouped.engine, P2, grouped.id("zap"), { selected: { t: [grouped.id("lieg")] } });
  resolvePendingResponses(grouped.engine);
  assert.equal(zoneOf(grouped.engine, grouped.id("lieg")), "play", "3 life, 2 damage");
  assert.equal(damageOn(grouped.engine, grouped.id("lieg")), 2);
});

clause(LIEGEMAN, "0:rule", "the extra strength is real: a party strength of 3 + 1 destroys a 4-life blocker (without the bonus 2 + 1 = 3 would not)", () => {
  const b = liegemanBoard();
  fight(b.engine, P1, [b.id("lieg"), b.id("pal1")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard", "3 + 1 = 4 damage");

  const lone = liegemanBoard();
  fight(lone.engine, P1, [lone.id("lieg")], { type: "faction", playerId: P2 }, [lone.id("blk")]);
  assert.equal(zoneOf(lone.engine, lone.id("blk")), "play", "alone it deals only 2");
  assert.equal(damageOn(lone.engine, lone.id("blk")), 2);
});

// --- Deadly Striker -----------------------------------------------------------
// If this card is destroyed, your opponent's faction loses 4 influence.
// Character (warlord, dragon), cost 4, [R][R], 4/2/3.

const STRIKER = "46d213bf-f9f2-4e68-93c5-07e004b72e50";

function strikerBoard(extra: CardPlacement[] = [], opts: { strikerController?: Pid; strikerOwner?: Pid; faceDown?: boolean; influenceP1?: number; influenceP2?: number } = {}) {
  const owner = opts.strikerOwner ?? P1;
  return board(
    [
      { key: "striker", def: printing(STRIKER), owner, zone: "play", controller: opts.strikerController, faceDown: opts.faceDown },
      { key: "bystander", def: character({ name: "Bystander", life: 2 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" },
      ...extra
    ],
    { influenceP1: opts.influenceP1, influenceP2: opts.influenceP2 }
  );
}

clause(STRIKER, "0:rule", "is deployed for exactly 4 with [R][R] and has its printed 4 / 2 / 3", () => {
  deployChecks(STRIKER, { cost: 4, icon: "rage", count: 2, stats: [4, 2, 3] });
});

clause(STRIKER, "0:rule", "destroyed by a tactic, the opponent's faction loses exactly 4 influence and mine loses none", () => {
  const b = strikerBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 4);
  assert.equal(influence(b.engine, P1), mine);
});

clause(STRIKER, "0:rule", "destroyed by lethal damage (2 life), it triggers too", () => {
  const b = strikerBoard([{ key: "zap", def: zapTactic(2), owner: P1, zone: "hand" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(STRIKER, "0:rule", "1 damage does not destroy it, so nothing is lost", () => {
  const b = strikerBoard([{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "play");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(STRIKER, "0:rule", "destroyed in battle by a blocker's damage, it triggers", () => {
  const b = board(
    [
      { key: "striker", def: printing(STRIKER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  const theirs = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("striker")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard", "2 damage from the blocker");
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(STRIKER, "0:rule", "leaving play any way but destruction (returned to hand, removed from the game) costs nothing", () => {
  for (const [label, tacticDef] of [
    ["returned to hand", bounceTactic()],
    ["removed from the game", removeTactic()]
  ] as const) {
    const b = strikerBoard([{ key: "other", def: tacticDef, owner: P1, zone: "hand" }]);
    const theirs = influence(b.engine, P2);

    play(b.engine, P1, b.id("other"), { selected: { t: [b.id("striker")] } });
    assert.notEqual(zoneOf(b.engine, b.id("striker")), "play", `${label}: it left play`);
    assert.equal(influence(b.engine, P2), theirs, `${label}: not destroyed, so no influence is lost`);
  }
});

clause(STRIKER, "0:rule", "another character being destroyed does nothing while the Striker is in play", () => {
  const b = strikerBoard();
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("bystander")] } });
  assert.equal(zoneOf(b.engine, b.id("bystander")), "discard");
  assert.equal(zoneOf(b.engine, b.id("striker")), "play");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(STRIKER, "0:rule", "the loss follows the controller: a Striker I took from my opponent, destroyed, costs ITS OWNER (my opponent) 4 influence", () => {
  const b = strikerBoard([], { strikerOwner: P2, strikerController: P1 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 4, "the opponent of its controller");
  assert.equal(influence(b.engine, P1), mine);
});

clause(STRIKER, "0:rule", "an opponent's Striker destroyed makes the opponent of ITS controller (me) lose 4", () => {
  const b = strikerBoard([], { strikerOwner: P2 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("striker")] } });
  assert.equal(influence(b.engine, P1), mine - 4, "my faction loses 4: I destroyed my opponent's Striker");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(STRIKER, "0:rule", "it is a loss of influence, not damage: a damage-reducing effect on factions does not change it (CR 408.3b)", () => {
  const b = strikerBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("striker")] } });
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(STRIKER, "0:rule", "an opponent at 4 influence loses the game when it is destroyed; at 5 they survive with 1", () => {
  const lethal = strikerBoard([], { influenceP2: 4 });
  play(lethal.engine, P1, lethal.id("kill"), { selected: { t: [lethal.id("striker")] } });
  assert.equal(influence(lethal.engine, P2), 0);
  assert.equal(lethal.engine.state.winner, P1);
  const survives = strikerBoard([], { influenceP2: 5 });
  play(survives.engine, P1, survives.id("kill"), { selected: { t: [survives.id("striker")] } });
  assert.equal(influence(survives.engine, P2), 1);
  assert.equal(survives.engine.state.winner, undefined);
});

clause(STRIKER, "0:rule", "destroyed as the COST of another card (Ruthless Platoon's CANNIBALIZE) it still counts as destroyed", () => {
  const b = board(
    [
      { key: "rp", def: printing(PLATOON), owner: P1, zone: "play" },
      { key: "striker", def: printing(STRIKER), owner: P1, zone: "play" }
    ]
  );
  const theirs = influence(b.engine, P2);
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(STRIKER, "0:rule", "two Strikers destroyed: each makes the opponent lose 4 (8 in total)", () => {
  const b = strikerBoard([{ key: "striker2", def: printing(STRIKER), owner: P1, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("striker")] } });
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("striker2")] } });
  assert.equal(influence(b.engine, P2), theirs - 8);
});

clause(STRIKER, "0:rule", "a face-down Striker is just a resource with no rules text: destroying it costs nothing", () => {
  const b = strikerBoard(
    [{ key: "resKill", def: tactic({ name: "ResKill", cost: 0, behavior: { abilities: [{ id: "rk", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }],
    { strikerOwner: P2, faceDown: true }
  );
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("resKill"), { selected: { t: [b.id("striker")] } });
  assert.equal(zoneOf(b.engine, b.id("striker")), "discard", "the face-down card was destroyed");
  assert.equal(influence(b.engine, P2), theirs, "a face-down card has no rules text");
});

// --- Dethmürderblüdgeon, the Craghammer ---------------------------------------
// UNIQUE DETHMÜRDERBLÜDGEON. ATTACH TO CHARACTER. The attached character gains 2
// strength and 2 life. If the attached character is blocked, your opponent's
// faction loses 2 influence. If the attached character inflicts damage to a
// faction, you may pick a character. If you do, inflict 2 damage to that
// character. If this card would go to your discard pile from play, put it into
// your hand instead. Item (warlord, gear), cost 5, [R][R].

const CRAG = "43a51ff8-16f5-4752-aa41-94d0977d219d";

function cragBoard(extra: CardPlacement[] = [], opts: { cragZone?: "play" | "hand"; rage?: number; turn?: number; active?: Pid; influenceP2?: number } = {}) {
  return board(
    [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...((opts.cragZone ?? "play") === "play"
        ? [{ key: "craig", def: printing(CRAG), owner: P1, zone: "play" as const, attachedToKey: "host" }]
        : [{ key: "craig", def: printing(CRAG), owner: P1, zone: "hand" as const }]),
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 7, P1),
      ...extra
    ],
    { turn: opts.turn, active: opts.active, influenceP2: opts.influenceP2 }
  );
}

/** Answers the open pick for a "you may pick a character" trigger (whatever pending kind carries it). */
function answerPick(engine: SpoilsEngine, player: Pid, ids: CardInstanceId[], declaration = "c"): void {
  const pc = pending(engine);
  assert.ok(pc, "a pick is waiting");
  const choice = pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { [declaration]: ids } } : { kind: pc.kind, selected: ids };
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);
  resolvePendingResponses(engine);
}

clause(CRAG, "0:unique", "controlling a second copy makes you keep one: you choose (the controller), choosing the new one removes the old one from play", () => {
  const keepNew = cragBoard([{ key: "craig2", def: printing(CRAG), owner: P1, zone: "hand" }]);
  play(keepNew.engine, P1, keepNew.id("craig2"), { selected: { attachTo: [keepNew.id("host2")] } });
  const pc = pending(keepNew.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [keepNew.id("craig"), keepNew.id("craig2")].sort());
  keepNew.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepNew.id("craig2") } } as never);
  assert.equal(keepNew.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(keepNew.engine, keepNew.id("craig2")), "play");
  assert.notEqual(zoneOf(keepNew.engine, keepNew.id("craig")), "play", "the other copy is destroyed");
});

clause(CRAG, "0:unique", "choosing to keep the OLD copy keeps it in play and removes the new one from play", () => {
  const keepOld = cragBoard([{ key: "craig2", def: printing(CRAG), owner: P1, zone: "hand" }]);
  play(keepOld.engine, P1, keepOld.id("craig2"), { selected: { attachTo: [keepOld.id("host2")] } });
  keepOld.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepOld.id("craig") } } as never);
  assert.equal(zoneOf(keepOld.engine, keepOld.id("craig")), "play", "the copy I chose to keep stays in play");
  assert.notEqual(zoneOf(keepOld.engine, keepOld.id("craig2")), "play", "the copy I did not choose does not stay in play");
});

clause(CRAG, "0:unique", "the destroyed duplicate is replaced by its own text: it goes to its owner's hand, not the discard pile", () => {
  const b = cragBoard([{ key: "craig2", def: printing(CRAG), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("craig2"), { selected: { attachTo: [b.id("host2")] } });
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("craig2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("craig")), "hand", "'would go to your discard pile from play' -> your hand");
  assert.equal(discardOf(b.engine, P1).includes(b.id("craig")), false);
});

clause(CRAG, "0:unique", "the restriction is per player: my opponent may control their own Craghammer too, with no choice and no destruction", () => {
  const b = cragBoard([{ key: "craig2", def: printing(CRAG), owner: P2, zone: "hand" }, ...bank("rage", 7, P2)], { turn: 2, active: P2 });
  play(b.engine, P2, b.id("craig2"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
  assert.equal(zoneOf(b.engine, b.id("craig2")), "play");
});

clause(CRAG, "0:unique", "a different UNIQUE card is not a duplicate", () => {
  const b = cragBoard([{ key: "other", def: item({ name: "OtherUnique", unique: "someone else", attachTo: "character" } as Partial<CardDefinition>), owner: P1, zone: "play", attachedToKey: "host2" }]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(CRAG, "1:attach", "is deployed for exactly 5 with [R][R], attached to the picked character", () => {
  deployChecks(CRAG, { cost: 5, icon: "rage", count: 2, selected: { attachTo: ["hostKey"] }, extra: [{ key: "hostKey", def: character({ name: "HostKey" }), owner: P1, zone: "play" }] });
  const b = cragBoard([], { cragZone: "hand" });
  play(b.engine, P1, b.id("craig"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
  assert.equal(attachedToOf(b.engine, b.id("craig")), b.id("host"));
});

clause(CRAG, "1:attach", "attaches to a character of either player: an opponent's character is a legal host (I still control the item)", () => {
  const b = cragBoard([], { cragZone: "hand" });
  play(b.engine, P1, b.id("craig"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(attachedToOf(b.engine, b.id("craig")), b.id("foe"));
  assert.equal(controllerOf(b.engine, b.id("craig")), P1);
  assert.equal(strengthOf(b.engine, b.id("foe")), 3, "the opponent's character gets the +2 strength");
});

clause(CRAG, "1:attach", "refuses a host that is not a character, or none, or two", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "hidden", def: character({ name: "HiddenChar" }), owner: P1, zone: "play", faceDown: true },
    { key: "inHand", def: character({ name: "InHandChar" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscardChar" }), owner: P1, zone: "discard" }
  ];
  const hosts: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("thing")]],
    ["a location", (b) => [b.id("place")]],
    ["a face-up resource", (b) => [b.engine.state.players[P1].play.find((card) => b.engine.isResource(card) && !b.engine.state.cards[card].faceDown)!]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["my faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["a character in my hand", (b) => [b.id("inHand")]],
    ["a character in my discard pile", (b) => [b.id("inDiscard")]],
    ["no host", () => []],
    ["two hosts", (b) => [b.id("host"), b.id("host2")]]
  ];
  for (const [label, host] of hosts) {
    const b = cragBoard(extra, { cragZone: "hand" });
    refused(() => playRaw(b.engine, P1, b.id("craig"), { selected: { attachTo: host(b) } }), `${label} is not a legal host`);
    assert.equal(zoneOf(b.engine, b.id("craig")), "hand", `${label}: not played`);
  }
});

clause(CRAG, "2:rule", "the attached character gains exactly 2 strength and 2 life (speed unchanged); other characters do not", () => {
  const b = cragBoard();
  assert.deepEqual(statsOf(b.engine, b.id("host")), [4, 5, 3]);
  assert.deepEqual(statsOf(b.engine, b.id("host2")), [1, 4, 2]);
  assert.deepEqual(statsOf(b.engine, b.id("foe")), [1, 9, 3]);
});

clause(CRAG, "2:rule", "the bonus is gone when the Craghammer leaves play, and it is the extra life that keeps the host alive (3 life + 2 survives 4 damage)", () => {
  const b = cragBoard([{ key: "zap", def: zapTactic(4), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "play", "5 life vs 4 damage");
  assert.equal(damageOn(b.engine, b.id("host")), 4);

  const without = cragBoard([{ key: "kill", def: itemKillTactic(), owner: P1, zone: "hand" }]);
  play(without.engine, P1, without.id("kill"), { selected: { t: [without.id("craig")] } });
  assert.deepEqual(statsOf(without.engine, without.id("host")), [2, 3, 3], "back to the printed stats");
});

clause(CRAG, "2:rule", "the bonus applies to whichever character carries it: deployed onto another host it follows", () => {
  const b = cragBoard([], { cragZone: "hand" });
  play(b.engine, P1, b.id("craig"), { selected: { attachTo: [b.id("host2")] } });
  assert.deepEqual(statsOf(b.engine, b.id("host2")), [3, 6, 2]);
  assert.deepEqual(statsOf(b.engine, b.id("host")), [2, 3, 3]);
});

clause(CRAG, "3:rule", "when the attached character attacks and is blocked, the opponent's faction loses exactly 2 influence", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  declareAttackBy(b.engine, P1, [b.id("host")]);
  assert.equal(influence(b.engine, P2), theirs, "not yet blocked");
  declareBlockers(b.engine, P2, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2);
  assert.equal(influence(b.engine, P1), mine);
});

clause(CRAG, "3:rule", "unblocked, nothing is lost by the trigger (the battle damage to the faction is separate)", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  declareAttackBy(b.engine, P1, [b.id("host")]);
  declareBlockers(b.engine, P2, []);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), 30, "no loss before damage is dealt");
});

clause(CRAG, "3:rule", "a party with the attached character is blocked: 2 influence once, however many blockers", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  const theirs = influence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("host"), b.id("host2")]);
  declareBlockers(b.engine, P2, [b.id("foe"), b.id("foe2")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2, "once, not per blocker or per attacker");
});

clause(CRAG, "3:rule", "a blocked attacker without the Craghammer does not trigger it (the Craghammer's host stays home)", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  const theirs = influence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("host2")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs, "the attached character is not the one blocked");
});

clause(CRAG, "3:rule", "the attached character BLOCKING is not 'blocked': nothing is lost", () => {
  const b = board(
    [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "craig", def: printing(CRAG), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "atk", def: character({ name: "Atk", life: 9 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  const theirs = influence(b.engine, P2);
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("host")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs);
  assert.equal(influence(b.engine, P1), 30);
});

clause(CRAG, "3:rule", "'your opponent' is the Craghammer controller's opponent: on an enemy character that gets blocked by me, THEIR faction loses 2", () => {
  const b = board(
    [
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "craig", def: printing(CRAG), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "blk", def: character({ name: "Blk", life: 9 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  declareBlockers(b.engine, P1, [b.id("blk")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2, "the opponent of the Craghammer's controller");
  assert.equal(influence(b.engine, P1), mine);
});

clause(CRAG, "3:rule", "it is influence loss, not damage: a damage-reducing effect on factions does not change it (CR 408.3b)", () => {
  const b = cragBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }], { turn: 2, active: P1 });
  const theirs = influence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("host")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2);
});

clause(CRAG, "3:rule", "an opponent at 2 influence loses the game when the attached character is blocked", () => {
  const b = cragBoard([], { turn: 2, active: P1, influenceP2: 2 });
  declareAttackBy(b.engine, P1, [b.id("host")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), 0);
  assert.equal(b.engine.state.winner, P1);
});

/** The host attacks unblocked and its battle damage reaches the faction; stops at the Craghammer's pick. */
function cragFactionHit(extra: CardPlacement[] = [], opts: { partner?: boolean } = {}) {
  const b = cragBoard(extra, { turn: 2, active: P1 });
  declareAttackBy(b.engine, P1, opts.partner ? [b.id("host"), b.id("host2")] : [b.id("host")]);
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  return b;
}

clause(CRAG, "4:rule", "when the attached character damages a faction I may pick a character, and the picked character takes exactly 2 damage", () => {
  const b = cragFactionHit();
  const theirs = influence(b.engine, P2);
  assert.equal(theirs, 30 - 4, "the host's 4 battle damage reached the faction");
  assert.ok(pending(b.engine), "a pick is offered");
  assert.equal(pending(b.engine)?.playerId, P1, "the Craghammer's controller picks");
  answerPick(b.engine, P1, [b.id("foe")]);
  assert.equal(damageOn(b.engine, b.id("foe")), 2);
  assert.equal(damageOn(b.engine, b.id("foe2")), 0, "only the picked character");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CRAG, "4:rule", "'you may': I can decline the pick, and then nobody takes damage", () => {
  const b = cragFactionHit();
  assert.ok(pending(b.engine), "a pick is offered");
  answerPick(b.engine, P1, []);
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  assert.equal(damageOn(b.engine, b.id("foe2")), 0);
  assert.equal(damageOn(b.engine, b.id("host")), 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CRAG, "4:rule", "any character can be picked: my own, or the attached character itself", () => {
  const mine = cragFactionHit();
  answerPick(mine.engine, P1, [mine.id("host2")]);
  assert.equal(damageOn(mine.engine, mine.id("host2")), 2, "my own character");
  const self = cragFactionHit();
  answerPick(self.engine, P1, [self.id("host")]);
  assert.equal(damageOn(self.engine, self.id("host")), 2, "the attached character itself (life 5 survives)");
  assert.equal(zoneOf(self.engine, self.id("host")), "play");
});

clause(CRAG, "4:rule", "only characters can be picked: an item, a location and a faction are refused", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
  ];
  for (const label of ["thing", "place", "faction"]) {
    const b = cragFactionHit(extra);
    const target = label === "faction" ? FACTION_OF(b.engine, P2) : b.id(label);
    refused(() => answerPick(b.engine, P1, [target]), `${label} is not a character`);
  }
  const ok = cragFactionHit(extra);
  answerPick(ok.engine, P1, [ok.id("foe")]);
  assert.equal(damageOn(ok.engine, ok.id("foe")), 2, "control: a character is accepted");
});

clause(CRAG, "4:rule", "the 2 damage can destroy the picked character", () => {
  const b = cragFactionHit([{ key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" }]);
  answerPick(b.engine, P1, [b.id("weak")]);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
});

clause(CRAG, "4:rule", "it needs damage to a FACTION: when the attached character is blocked and damages a character, no pick is offered", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  declareAttackBy(b.engine, P1, [b.id("host")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick");
  assert.equal(damageOn(b.engine, b.id("foe")), 4, "only the battle damage");
  assert.equal(damageOn(b.engine, b.id("foe2")), 0);
});

clause(CRAG, "4:rule", "another attacker without the Craghammer damaging the faction does not trigger it", () => {
  const b = cragBoard([], { turn: 2, active: P1 });
  declareAttackBy(b.engine, P1, [b.id("host2")]);
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), 29, "host2's 1 damage reached the faction");
  assert.equal(b.engine.state.pendingChoice, undefined, "the Craghammer's host did not attack");
});

clause(CRAG, "4:rule", "in a party the attached character still triggers it once, for its own damage to the faction", () => {
  const b = cragFactionHit([], { partner: true });
  answerPick(b.engine, P1, [b.id("foe")]);
  assert.equal(damageOn(b.engine, b.id("foe")), 2, "exactly one 2-damage trigger");
  assert.equal(b.engine.state.pendingChoice, undefined, "no second pick");
});

clause(CRAG, "5:rule", "destroyed (the item itself), it goes to its owner's hand instead of the discard pile", () => {
  const b = cragBoard([{ key: "kill", def: itemKillTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("craig")] } });
  assert.equal(zoneOf(b.engine, b.id("craig")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("craig")), "my hand");
  assert.equal(discardOf(b.engine, P1).includes(b.id("craig")), false);
  assert.equal(attachedToOf(b.engine, b.id("craig")), undefined, "no longer attached");
});

clause(CRAG, "5:rule", "when its host is destroyed the host goes to the discard pile as normal and the Craghammer goes to its owner's hand", () => {
  const b = cragBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("craig")), "hand");
});

clause(CRAG, "5:rule", "when its host dies in battle it goes to its owner's hand", () => {
  const b = cragBoard([{ key: "big", def: character({ name: "Big", strength: 9, life: 9, speed: 3 }), owner: P2, zone: "play" }], { turn: 2, active: P1 });
  fight(b.engine, P1, [b.id("host")], { type: "faction", playerId: P2 }, [b.id("big")]);
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("craig")), "hand");
});

clause(CRAG, "5:rule", "when its host is returned to its owner's hand the Craghammer is in a hand too, never the discard pile", () => {
  const b = cragBoard([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("craig")), "hand");
  assert.equal(discardOf(b.engine, P1).includes(b.id("craig")), false);
});

clause(CRAG, "5:rule", "when its host is removed from the game the Craghammer leaves play the same way (CR 301.4a): removed, not put into my hand", () => {
  const b = cragBoard([{ key: "remove", def: removeTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("remove"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "removed");
  assert.equal(zoneOf(b.engine, b.id("craig")), "removed", "attached cards leave play in the same way as their host");
});

clause(CRAG, "5:rule", "it replaces only ITS OWN trip to the discard pile: an unrelated character destroyed while it is in play still goes to the discard pile, and the Craghammer stays in play", () => {
  const b = cragBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the opponent's character is destroyed normally");
  assert.equal(zoneOf(b.engine, b.id("craig")), "play", "the Craghammer is unaffected by someone else's destruction");
  assert.equal(attachedToOf(b.engine, b.id("craig")), b.id("host"));
});

clause(CRAG, "5:rule", "my own other character destroyed while it is in play goes to the discard pile too, and the Craghammer stays", () => {
  const b = cragBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("host2")] } });
  assert.equal(zoneOf(b.engine, b.id("host2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
});

clause(CRAG, "5:rule", "another item destroyed while it is in play goes to the discard pile, and the Craghammer stays", () => {
  const b = cragBoard([
    { key: "kill", def: itemKillTactic(), owner: P1, zone: "hand" },
    { key: "otherItem", def: item({ name: "OtherItem" }), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("otherItem")] } });
  assert.equal(zoneOf(b.engine, b.id("otherItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
});

clause(CRAG, "5:rule", "a character killed in battle while it is in play (on another character) goes to the discard pile as normal", () => {
  const b = cragBoard([{ key: "big", def: character({ name: "Big", strength: 9, life: 9, speed: 3 }), owner: P2, zone: "play" }], { turn: 2, active: P1 });
  fight(b.engine, P1, [b.id("host2")], { type: "faction", playerId: P2 }, [b.id("big")]);
  assert.equal(zoneOf(b.engine, b.id("host2")), "discard", "the unrelated attacker dies in battle");
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
});

clause(CRAG, "5:rule", "it only replaces going to the discard pile FROM PLAY: discarded from my hand it goes to the discard pile", () => {
  const b = board([
    { key: "mc", def: printing(MURDEROUS), owner: P1, zone: "play" },
    { key: "craig", def: printing(CRAG), owner: P1, zone: "hand" },
    ...bank("rage", 2, P1)
  ]);
  activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("craig")] } });
  assert.equal(zoneOf(b.engine, b.id("craig")), "discard", "discarding from hand is not 'from play'");
});

clause(CRAG, "5:rule", "back in my hand it can be deployed again for its full cost, onto a new host", () => {
  const b = cragBoard([{ key: "kill", def: itemKillTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("craig")] } });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("craig"), { selected: { attachTo: [b.id("host2")] } });
  assert.equal(zoneOf(b.engine, b.id("craig")), "play");
  assert.equal(attachedToOf(b.engine, b.id("craig")), b.id("host2"));
  assert.equal(before - ready(b.engine), 5);
});

// --- Distraction --------------------------------------------------------------
// COST: Pick a character. EFFECT: Deplete the character. Tactic (warlord), cost 0, [R].

const DISTRACTION = "61c0d007-ee61-41da-9b15-8fdd7c15720e";

function distractionBoard(extra: CardPlacement[] = [], opts: { rage?: number; turn?: number; active?: Pid } = {}) {
  return board(
    [
      { key: "dis", def: printing(DISTRACTION), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 2, P1),
      ...extra
    ],
    { turn: opts.turn, active: opts.active }
  );
}

clause(DISTRACTION, "0:ability", "is played for free (cost 0) but needs [R]: refused without a rage icon, even with lots of other resources", () => {
  deployChecks(DISTRACTION, { cost: 0, icon: "rage", count: 1, done: "discard", selected: { c: ["target"] }, extra: [{ key: "target", def: character({ name: "Target" }), owner: P2, zone: "play" }] });
});

clause(DISTRACTION, "0:ability", "depletes the picked opponent's character and only that one", () => {
  const b = distractionBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("dis"), { selected: { c: [b.id("foe")] } });
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
  assert.equal(isDepleted(b.engine, b.id("foe2")), false);
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  assert.equal(before, ready(b.engine), "cost 0: no resource was spent");
  assert.equal(zoneOf(b.engine, b.id("dis")), "discard");
});

clause(DISTRACTION, "0:ability", "the picked character may be one of my own", () => {
  const b = distractionBoard();
  play(b.engine, P1, b.id("dis"), { selected: { c: [b.id("mine")] } });
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
});

clause(DISTRACTION, "0:ability", "a character that is already depleted can be picked; it simply stays depleted", () => {
  const b = distractionBoard();
  b.engine.state.cards[b.id("foe")].depleted = true;
  play(b.engine, P1, b.id("dis"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("dis")), "discard", "the tactic was played and resolved");
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
});

clause(DISTRACTION, "0:ability", "only a character can be picked: an item, a location, a faction, a face-down card, a card in hand and two characters are refused", () => {
  const extra: CardPlacement[] = [
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" }
  ];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["a card in hand", (b) => [b.id("handChar")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["no character", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = distractionBoard(extra);
    refused(() => playRaw(b.engine, P1, b.id("dis"), { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("dis")), "hand", `${label}: not played`);
  }
});

clause(DISTRACTION, "0:ability", "the depletion happens when the tactic resolves, not when it is played (the opponent may respond first)", () => {
  const b = distractionBoard();
  playRaw(b.engine, P1, b.id("dis"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("dis")), "deploying");
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
});

clause(DISTRACTION, "0:ability", "a depleted character cannot block: a Distracted defender cannot be declared as a blocker, an untouched one can", () => {
  const b = distractionBoard([], { turn: 2, active: P1 });
  play(b.engine, P1, b.id("dis"), { selected: { c: [b.id("foe")] } });
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("foe")]), "the depleted character cannot block");
  declareBlockers(b.engine, P2, [b.id("foe2")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe2")]);
});

clause(DISTRACTION, "0:ability", "the character is restored at the start of its controller's next turn", () => {
  const b = distractionBoard();
  play(b.engine, P1, b.id("dis"), { selected: { c: [b.id("foe")] } });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("foe")), false, "restored by its controller's restore rule");
});

clause(DISTRACTION, "0:ability", "it can be played in response, on the opponent's turn: here it depletes a character of mine that was about to... be picked as a blocker", () => {
  const b = distractionBoard([{ key: "atk", def: character({ name: "Atk", life: 9, speed: 3 }), owner: P2, zone: "play" }], { turn: 2, active: P2 });
  openDefenderWindow(b.engine, [b.id("atk")]);
  playRaw(b.engine, P1, b.id("dis"), { selected: { c: [b.id("atk")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dis")), "discard");
  assert.equal(isDepleted(b.engine, b.id("atk")), true);
});

// --- Elbow Dropper ------------------------------------------------------------
// OFF THE TOP ROPE -- COST: Deplete this card. Pick a character. EFFECT: This
// turn, the character cannot block. Character (warlord, fighter), cost 4,
// [R][R], 3/2/3.

const DROPPER = "1c35f70e-ae5e-44b0-ac2b-8c0f52b00f4a";

function dropperBoard(extra: CardPlacement[] = [], opts: { dropperDepleted?: boolean; dropperController?: Pid } = {}) {
  return board(
    [
      { key: "dropper", def: printing(DROPPER), owner: opts.dropperController ?? P1, zone: "play", depleted: opts.dropperDepleted },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

clause(DROPPER, "0:ability:offtop", "is deployed for exactly 4 with [R][R] and has its printed 3 / 2 / 3", () => {
  deployChecks(DROPPER, { cost: 4, icon: "rage", count: 2, stats: [3, 2, 3] });
});

clause(DROPPER, "0:ability:offtop", "depletes the Dropper (no resources needed) and the picked character cannot block this turn", () => {
  const b = dropperBoard();
  assert.equal(ready(b.engine), 0, "no resources in play at all");
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe")] } });
  assert.equal(isDepleted(b.engine, b.id("dropper")), true, "COST: Deplete this card");
  assert.equal(hasRestriction(b.engine, b.id("foe"), "cannotBlock"), true);
  assert.equal(hasRestriction(b.engine, b.id("foe2"), "cannotBlock"), false, "only the picked character");
  assert.equal(hasRestriction(b.engine, b.id("atk"), "cannotBlock"), false);
});

clause(DROPPER, "0:ability:offtop", "in an attack, the picked character really cannot be declared as a blocker; another one can", () => {
  const b = dropperBoard();
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe")] } });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("foe")]), "the picked character cannot block");
  refused(() => declareBlockers(b.engine, P2, [b.id("foe"), b.id("foe2")]), "...not even with a friend");
  declareBlockers(b.engine, P2, [b.id("foe2")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe2")]);
});

clause(DROPPER, "0:ability:offtop", "without the ability the same character can block (control)", () => {
  const b = dropperBoard();
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe")]);
});

clause(DROPPER, "0:ability:offtop", "the cost is paid on activation, the restriction arrives on resolution", () => {
  const b = dropperBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("dropper"), abilityId: "offtop", selected: { c: [b.id("foe")] }, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("dropper")), true, "already depleted while the opponent may respond");
  assert.equal(hasRestriction(b.engine, b.id("foe"), "cannotBlock"), false, "not yet");
  resolvePendingResponses(b.engine);
  assert.equal(hasRestriction(b.engine, b.id("foe"), "cannotBlock"), true);
});

clause(DROPPER, "0:ability:offtop", "the restriction lasts this turn only", () => {
  const b = dropperBoard();
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe")] } });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(hasRestriction(b.engine, b.id("foe"), "cannotBlock"), false);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe")], "the next turn it can block again");
});

clause(DROPPER, "0:ability:offtop", "the Dropper depletes as a cost, so a depleted Dropper cannot use it, and it can be used once per turn", () => {
  const depleted = dropperBoard([], { dropperDepleted: true });
  refused(() => activate(depleted.engine, P1, depleted.id("dropper"), "offtop", { selected: { c: [depleted.id("foe")] } }), "already depleted");
  assert.equal(hasRestriction(depleted.engine, depleted.id("foe"), "cannotBlock"), false);

  const b = dropperBoard();
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe")] } });
  refused(() => activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe2")] } }), "a second use needs a ready Dropper");
  assert.equal(hasRestriction(b.engine, b.id("foe2"), "cannotBlock"), false);
});

clause(DROPPER, "0:ability:offtop", "the Dropper may be used the turn it enters play (abilities are not subject to summoning sickness) and may pick itself", () => {
  const b = board(
    [
      { key: "dropper", def: printing(DROPPER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, active: P1 }
  );
  play(b.engine, P1, b.id("dropper"));
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("dropper")] } });
  assert.equal(isDepleted(b.engine, b.id("dropper")), true);
  assert.equal(hasRestriction(b.engine, b.id("dropper"), "cannotBlock"), true, "the Dropper picked itself, a character that is depleted by its own cost");
});

clause(DROPPER, "0:ability:offtop", "the picked character may be one of my own", () => {
  const b = dropperBoard();
  activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("atk")] } });
  assert.equal(hasRestriction(b.engine, b.id("atk"), "cannotBlock"), true);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("atk")], "cannot BLOCK does not stop it attacking");
});

clause(DROPPER, "0:ability:offtop", "only a character can be picked: an item, a location, a faction, a face-down card, a hand card, none or two are refused", () => {
  const extra: CardPlacement[] = [
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" }
  ];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["a card in hand", (b) => [b.id("handChar")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["no character", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = dropperBoard(extra);
    refused(() => activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(isDepleted(b.engine, b.id("dropper")), false, `${label}: the Dropper was not depleted`);
  }
});

clause(DROPPER, "0:ability:offtop", "only its controller can use it", () => {
  const b = dropperBoard([], { dropperController: P2 });
  refused(() => activate(b.engine, P1, b.id("dropper"), "offtop", { selected: { c: [b.id("foe")] } }), "P1 does not control the Dropper");
});

// --- Explosive Fury -----------------------------------------------------------
// COST: Pick a character you control. X is that character's strength. Destroy
// that character. Pick another character. EFFECT: Inflict X damage to the other
// character. Tactic (warlord), cost 2, [R].

const FURY = "408d18d4-f420-4222-8fcb-4d08f499f6fc";

function furyBoard(extra: CardPlacement[] = [], opts: { rage?: number } = {}) {
  return board(
    [
      { key: "fury", def: printing(FURY), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sac", strength: 3, life: 2, speed: 3 }), owner: P1, zone: "play" },
      { key: "zero", def: character({ name: "Zero", strength: 0, life: 2, speed: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...extra
    ]
  );
}

clause(FURY, "0:ability", "is played for exactly 2 with [R]", () => {
  deployChecks(FURY, {
    cost: 2,
    icon: "rage",
    count: 1,
    done: "discard",
    selected: { sac: ["mine"], victim: ["theirs"] },
    extra: [
      { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2, zone: "play" }
    ]
  });
});

clause(FURY, "0:ability", "destroys the character I pick, and the other character takes damage equal to its strength (3)", () => {
  const b = furyBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the character I control is destroyed");
  assert.equal(damageOn(b.engine, b.id("foe")), 3, "X = the sacrificed character's strength");
  assert.equal(damageOn(b.engine, b.id("foe2")), 0, "only the picked character");
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2");
  assert.equal(zoneOf(b.engine, b.id("fury")), "discard");
});

clause(FURY, "0:ability", "X varies with the strength: 0 deals nothing, 1 deals 1", () => {
  const zero = furyBoard();
  play(zero.engine, P1, zero.id("fury"), { selected: { sac: [zero.id("zero")], victim: [zero.id("foe")] } });
  assert.equal(zoneOf(zero.engine, zero.id("zero")), "discard");
  assert.equal(damageOn(zero.engine, zero.id("foe")), 0, "X = 0");
  const one = furyBoard();
  play(one.engine, P1, one.id("fury"), { selected: { sac: [one.id("mine2")], victim: [one.id("foe")] } });
  assert.equal(damageOn(one.engine, one.id("foe")), 1, "X = 1");
});

clause(FURY, "0:ability", "X is the CURRENT strength: an attached +2 strength item counts", () => {
  const b = furyBoard([{ key: "booster", def: statItem("strength", 2), owner: P1, zone: "play", attachedToKey: "sac" }]);
  assert.equal(strengthOf(b.engine, b.id("sac")), 5);
  play(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.equal(damageOn(b.engine, b.id("foe")), 5, "3 + 2");
});

clause(FURY, "0:ability", "the damage can destroy the other character (4 damage on a 4-life character)", () => {
  const b = furyBoard([{ key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("frail")] } });
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "3 damage on 3 life");
  const survive = furyBoard([{ key: "sturdy", def: character({ name: "Sturdy", life: 4 }), owner: P2, zone: "play" }]);
  play(survive.engine, P1, survive.id("fury"), { selected: { sac: [survive.id("sac")], victim: [survive.id("sturdy")] } });
  assert.equal(zoneOf(survive.engine, survive.id("sturdy")), "play");
  assert.equal(damageOn(survive.engine, survive.id("sturdy")), 3);
});

clause(FURY, "0:ability", "the other character can be one of mine", () => {
  const b = furyBoard();
  play(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("mine2")] } });
  assert.equal(damageOn(b.engine, b.id("mine2")), 3);
});

clause(FURY, "0:ability", "the sacrificed character is a COST: it is destroyed as soon as the tactic is played, before the opponent can respond", () => {
  const b = furyBoard();
  playRaw(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("fury")), "deploying");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "already destroyed");
  assert.equal(damageOn(b.engine, b.id("foe")), 0, "the damage waits for resolution");
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
});

clause(FURY, "0:ability", "if the other character leaves play in response, the tactic still resolves with nothing to damage (402.5a)", () => {
  const removed = furyBoard([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  playRaw(removed.engine, P1, removed.id("fury"), { selected: { sac: [removed.id("sac")], victim: [removed.id("foe")] } });
  playRaw(removed.engine, P2, removed.id("bounce"), { selected: { t: [removed.id("foe")] } });
  resolvePendingResponses(removed.engine);
  assert.equal(zoneOf(removed.engine, removed.id("foe")), "hand", "the other character left play in response");
  assert.equal(zoneOf(removed.engine, removed.id("fury")), "discard", "the tactic still resolves without a target (402.5a)");
  assert.equal(zoneOf(removed.engine, removed.id("sac")), "discard");
  assert.equal(damageOn(removed.engine, removed.id("foe2")), 0, "no other character takes the damage");
});

clause(FURY, "0:ability", "X is fixed when the cost is paid: the sacrificed character is already destroyed, so the opponent cannot pump it in response to raise X", () => {
  const b = furyBoard([{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }]);
  playRaw(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("foe")] } });
  refused(() => playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("sac")] } }), "the sacrificed character is no longer in play to be picked");
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 3, "X stays at the strength paid");
});

clause(FURY, "0:ability", "the first pick must be a character I control: an opponent's character, an item, a location, a faction and a face-down card are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an opponent's character", (b) => [b.id("foe")]],
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["my faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["my face-down card", (b) => [b.id("hidden")]],
    ["two of my characters", (b) => [b.id("sac"), b.id("zero")]],
    ["none", () => []]
  ];
  for (const [label, sacIds] of picks) {
    const b = furyBoard(extra);
    refused(() => playRaw(b.engine, P1, b.id("fury"), { selected: { sac: sacIds(b), victim: [b.id("foe2")] } }), `${label} cannot be the character I control`);
    assert.equal(zoneOf(b.engine, b.id("fury")), "hand", `${label}: not played`);
    assert.equal(zoneOf(b.engine, b.id("sac")), "play", `${label}: nothing was destroyed`);
  }
});

clause(FURY, "0:ability", "the second pick must be a character: an item, a location, a faction, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["none", () => []]
  ];
  for (const [label, victimIds] of picks) {
    const b = furyBoard(extra);
    refused(() => playRaw(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: victimIds(b) } }), `${label} cannot be the other character`);
    assert.equal(zoneOf(b.engine, b.id("sac")), "play", `${label}: nothing was destroyed`);
  }
});

clause(FURY, "0:ability", "the 'other' character must be ANOTHER character: the character I destroy cannot also be the one I pick", () => {
  const b = furyBoard();
  refused(() => playRaw(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [b.id("sac")] } }), "the same character cannot be both picks");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play", "nothing was destroyed");
  assert.equal(zoneOf(b.engine, b.id("fury")), "hand", "the tactic was not played");
});

clause(FURY, "0:ability", "with no other character in play there is nothing to pick, so it cannot be played", () => {
  const b = board([
    { key: "fury", def: printing(FURY), owner: P1, zone: "hand" },
    { key: "sac", def: character({ name: "Sac", strength: 3 }), owner: P1, zone: "play" },
    ...bank("rage", 3, P1)
  ]);
  refused(() => playRaw(b.engine, P1, b.id("fury"), { selected: { sac: [b.id("sac")], victim: [] } }), "no other character");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
});

// --- Fleshripping Scenepuller -------------------------------------------------
// If this card is blocked, it gains 4 strength for each member in the opposing
// party. Character (warlord, fighter), cost 4, [R][R][R][R], 4/4/3.

const SCENEPULLER = "c8037ec2-03ca-464f-83d1-a00f45db5873";

function scenepullerBoard(extra: CardPlacement[] = []) {
  return board(
    [
      { key: "fs", def: printing(SCENEPULLER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 0, life: 20, speed: 3 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 0, life: 20, speed: 3 }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "B3", strength: 0, life: 20, speed: 3 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

clause(SCENEPULLER, "0:rule", "is deployed for exactly 4 with [R][R][R][R] and has its printed 4 / 4 / 3", () => {
  deployChecks(SCENEPULLER, { cost: 4, icon: "rage", count: 4, stats: [4, 4, 3] });
});

for (const n of [1, 2, 3]) {
  clause(SCENEPULLER, "0:rule", `blocked by ${n} character${n > 1 ? "s" : ""}: gains ${4 * n} strength (4 for each member of the opposing party)`, () => {
    const b = scenepullerBoard();
    declareAttackBy(b.engine, P1, [b.id("fs")]);
    assert.equal(strengthOf(b.engine, b.id("fs")), 4, "unblocked so far");
    declareBlockers(b.engine, P2, ["b1", "b2", "b3"].slice(0, n).map(b.id));
    resolvePendingResponses(b.engine);
    assert.equal(strengthOf(b.engine, b.id("fs")), 4 + 4 * n);
    assert.deepEqual([lifeOf(b.engine, b.id("fs")), speedOf(b.engine, b.id("fs"))], [4, 3], "only strength changes");
  });
}

clause(SCENEPULLER, "0:rule", "unblocked, it gains nothing", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("fs")]);
  declareBlockers(b.engine, P2, []);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 4);
});

clause(SCENEPULLER, "0:rule", "blocking (instead of being blocked) gives nothing", () => {
  const b = board(
    [
      { key: "fs", def: printing(SCENEPULLER), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 20 }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", life: 20 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(b.engine, P1, [b.id("atk"), b.id("atk2")]);
  declareBlockers(b.engine, P2, [b.id("fs")]);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 4, "the Scenepuller is the blocker, not the blocked");
});

clause(SCENEPULLER, "0:rule", "in a party, only the Scenepuller gains strength, counting the whole opposing party", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("fs"), b.id("ally")]);
  declareBlockers(b.engine, P2, [b.id("b1"), b.id("b2")]);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 12, "4 + 4 x 2 blockers");
  assert.equal(strengthOf(b.engine, b.id("ally")), 1, "the ally gains nothing");
});

clause(SCENEPULLER, "0:rule", "it keeps attacking only if it was in the party: a Scenepuller left at home gains nothing when its friend is blocked", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 4);
});

clause(SCENEPULLER, "0:rule", "the extra strength is real in the battle: 8 damage destroys a 8-life blocker; without being blocked-bonus 4 would not", () => {
  const b = scenepullerBoard([{ key: "tank", def: character({ name: "Tank", strength: 0, life: 8, speed: 1 }), owner: P2, zone: "play" }]);
  fight(b.engine, P1, [b.id("fs")], { type: "faction", playerId: P2 }, [b.id("tank")]);
  assert.equal(zoneOf(b.engine, b.id("tank")), "discard", "4 + 4 = 8 damage");
});

clause(SCENEPULLER, "0:rule", "the gain is counted when it is blocked: a blocker destroyed afterwards does not take the bonus away", () => {
  const b = scenepullerBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  declareAttackBy(b.engine, P1, [b.id("fs")]);
  declareBlockers(b.engine, P2, [b.id("b1"), b.id("b2")]);
  assert.equal(strengthOf(b.engine, b.id("fs")), 12);
  playRaw(b.engine, P1, b.id("kill"), { selected: { t: [b.id("b1")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("b1")), "discard");
  assert.equal(strengthOf(b.engine, b.id("fs")), 12, "gained once, when blocked");
});

clause(SCENEPULLER, "0:rule", "the printed text has no 'this turn': the strength stays after the turn ends", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("fs")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  autoResolveBattle(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 8);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(strengthOf(b.engine, b.id("fs")), 8, "still 8 on its controller's next turn");
});

clause(SCENEPULLER, "0:rule", "blocked twice (two battles), it gains each time", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("fs")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  autoResolveBattle(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 8);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("fs")]);
  declareBlockers(b.engine, P2, [b.id("b2"), b.id("b3")]);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("fs")), 16, "8 + 4 x 2");
});

// --- Gore Engine --------------------------------------------------------------
// If a character is destroyed during a turn when this card damaged it, put X
// tokens on this card, where X is the strength of that character. This card gains
// 1 strength for each token on it. IMPALE -- COST: Pay 2 or remove 2 tokens from
// this card. Pick a character. EFFECT: This turn, the character must block this
// card if it can. Character (warlord, warmachine), cost 10, [R][R], 5/10/3.

const GORE = "45ce54bf-af20-4972-83e5-62985455e308";

function goreBoard(extra: CardPlacement[] = [], opts: { tokens?: number; rage?: number; turn?: number; active?: Pid } = {}) {
  return board(
    [
      { key: "gore", def: printing(GORE), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...extra
    ],
    { turn: opts.turn ?? 2, active: opts.active ?? P1 }
  );
}

clause(GORE, "0:rule", "is deployed for exactly 10 with [R][R] and has its printed 5 / 10 / 3", () => {
  deployChecks(GORE, { cost: 10, icon: "rage", count: 2, stats: [5, 10, 3] });
});

clause(GORE, "0:rule", "destroying a character in battle: it gets as many tokens as that character's strength (2 -> 2 tokens, 3 -> 3 tokens)", () => {
  for (const [key, expected] of [["foe", 2], ["foe2", 3]] as const) {
    const b = goreBoard();
    fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", "5 damage destroys it");
    assert.equal(tokensOn(b.engine, b.id("gore")), expected, `${key}: X = its strength`);
  }
});

clause(GORE, "0:rule", "X is the strength the destroyed character HAD (modifiers included): a strength-2 character with a +2 item gives 4 tokens", () => {
  const b = goreBoard([{ key: "booster", def: statItem("strength", 2), owner: P2, zone: "play", attachedToKey: "foe" }]);
  assert.equal(strengthOf(b.engine, b.id("foe")), 4);
  fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 4);
});

clause(GORE, "0:rule", "a character destroyed with strength 0 gives no tokens", () => {
  const b = goreBoard([{ key: "weakling", def: character({ name: "Weakling", strength: 0, life: 3, speed: 1 }), owner: P2, zone: "play" }]);
  fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id("weakling")]);
  assert.equal(zoneOf(b.engine, b.id("weakling")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
});

clause(GORE, "0:rule", "the character need not be killed by Gore: damaged by it in battle, then destroyed by a tactic the same turn, it still counts", () => {
  const b = goreBoard([
    { key: "big", def: character({ name: "Big", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ]);
  fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id("big")]);
  assert.equal(zoneOf(b.engine, b.id("big")), "play", "5 damage does not destroy 9 life");
  assert.equal(damageOn(b.engine, b.id("big")), 5);
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("big")] } });
  assert.equal(zoneOf(b.engine, b.id("big")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 4, "destroyed during a turn when Gore damaged it");
});

clause(GORE, "0:rule", "a character Gore never damaged does not count, even if destroyed the same turn", () => {
  const b = goreBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe2")] } });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
});

clause(GORE, "0:rule", "damaged in an earlier turn does not count: destroyed in a later turn it gives no tokens", () => {
  const b = goreBoard([
    { key: "big", def: character({ name: "Big", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ]);
  fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id("big")]);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(damageOn(b.engine, b.id("big")), 0, "damage is cleared at the start of the turn");
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("big")] } });
  assert.equal(zoneOf(b.engine, b.id("big")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
});

clause(GORE, "0:rule", "tokens accumulate over several kills", () => {
  const b = goreBoard([], { tokens: 1 });
  fight(b.engine, P1, [b.id("gore")], { type: "faction", playerId: P2 }, [b.id("foe2")]);
  assert.equal(tokensOn(b.engine, b.id("gore")), 4, "1 + 3");
});

clause(GORE, "0:rule", "two Gore Engines that both damaged the same character both get X tokens", () => {
  const b = goreBoard([
    { key: "gore2", def: printing(GORE), owner: P1, zone: "play" },
    { key: "wall", def: character({ name: "Wall", strength: 2, life: 8, speed: 3 }), owner: P2, zone: "play" }
  ]);
  fight(b.engine, P1, [b.id("gore"), b.id("gore2")], { type: "faction", playerId: P2 }, [b.id("wall")]);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("wall")), "discard");
  assert.equal(tokensOn(b.engine, b.id("gore")), 2);
  assert.equal(tokensOn(b.engine, b.id("gore2")), 2);
});

clause(GORE, "1:rule", "gains 1 strength for each token on it: 0 / 1 / 3 tokens give 5 / 6 / 8 strength (life and speed unchanged)", () => {
  for (const [tokens, strength] of [[0, 5], [1, 6], [3, 8]] as const) {
    const b = goreBoard([], { tokens });
    assert.equal(strengthOf(b.engine, b.id("gore")), strength, `${tokens} tokens`);
    assert.deepEqual([lifeOf(b.engine, b.id("gore")), speedOf(b.engine, b.id("gore"))], [10, 3]);
  }
});

clause(GORE, "1:rule", "tokens on other cards do not count: only its own tokens", () => {
  const b = goreBoard([{ key: "gore2", def: printing(GORE), owner: P1, zone: "play", counters: { token: 4 } }], { tokens: 1 });
  assert.equal(strengthOf(b.engine, b.id("gore")), 6);
  assert.equal(strengthOf(b.engine, b.id("gore2")), 9);
  assert.equal(strengthOf(b.engine, b.id("ally")), 1, "tokens do not buff other characters");
});

clause(GORE, "1:rule", "the strength follows the tokens: removing tokens lowers it again", () => {
  const b = goreBoard([], { tokens: 3, rage: 0 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  assert.equal(tokensOn(b.engine, b.id("gore")), 1, "IMPALE took 2 tokens");
  assert.equal(strengthOf(b.engine, b.id("gore")), 6);
});

clause(GORE, "1:rule", "tokens disappear when it leaves play, so it comes back without them (CR 409.2)", () => {
  const b = goreBoard([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }], { tokens: 3 });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("gore")] } });
  assert.equal(zoneOf(b.engine, b.id("gore")), "hand");
  assert.equal(tokensOn(b.engine, b.id("gore")), 0, "the tokens are gone");
});

clause(GORE, "2:ability:impale", "paying 2 resources: the cost is paid on activation and the picked character gets the must-block restriction", () => {
  const b = goreBoard([], { rage: 3 });
  const before = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("gore"), abilityId: "impale", selected: { c: [b.id("foe")] }, variables: {} });
  assert.equal(before - ready(b.engine), 2, "Pay 2");
  assert.equal(isDepleted(b.engine, b.id("gore")), false, "IMPALE does not deplete Gore Engine");
  resolvePendingResponses(b.engine);
  assert.equal(mustBlockGore(b, "foe"), true);
  assert.equal(mustBlockGore(b, "foe2"), false, "only the picked character");
});

clause(GORE, "2:ability:impale", "removing 2 tokens when I have no resources: costs exactly 2 tokens and no resources", () => {
  const b = goreBoard([], { tokens: 3, rage: 0 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  assert.equal(tokensOn(b.engine, b.id("gore")), 1);
  assert.equal(mustBlockGore(b, "foe"), true);
});

clause(GORE, "2:ability:impale", "exactly 2 tokens is enough and leaves none (strength back to 5)", () => {
  const b = goreBoard([], { tokens: 2, rage: 0 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
  assert.equal(strengthOf(b.engine, b.id("gore")), 5);
});

clause(GORE, "2:ability:impale", "with 1 resource (not enough) and 2 tokens it removes the tokens and spends no resource", () => {
  const b = goreBoard([], { tokens: 2, rage: 1 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  assert.equal(tokensOn(b.engine, b.id("gore")), 0);
  assert.equal(ready(b.engine), 1, "the resource was not spent");
  assert.equal(mustBlockGore(b, "foe"), true);
});

clause(GORE, "2:ability:impale", "refused with neither 2 resources nor 2 tokens (1 resource and 1 token do not combine)", () => {
  const b = goreBoard([], { tokens: 1, rage: 1 });
  refused(() => activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } }), "neither option can be paid in full");
  assert.equal(tokensOn(b.engine, b.id("gore")), 1, "nothing was removed");
  assert.equal(ready(b.engine), 1, "nothing was paid");
  assert.equal(mustBlockGore(b, "foe"), false);
});

clause(GORE, "2:ability:impale", "'Pay 2 OR remove 2 tokens': with both possible the player is offered the choice (the engine decides for them)", () => holdCostChoices(() => {
  for (const [index, tokensLeft, readyLeft] of [[0, 2, 0], [1, 0, 2]] as const) {
    const b = goreBoard([], { tokens: 2, rage: 2 });
    b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("gore"), abilityId: "impale", selected: { c: [b.id("foe")] }, variables: {} });
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; optionCount: number } | undefined;
    assert.ok(pc, "the player should be asked which way to pay: 2 resources or 2 tokens");
    assert.deepEqual([pc.kind, pc.playerId, pc.optionCount], ["chooserSelectsOption", P1, 2]);
    assert.equal(tokensOn(b.engine, b.id("gore")), 2, "nothing is paid before the player answers");
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } });
    resolvePendingResponses(b.engine);
    assert.equal(tokensOn(b.engine, b.id("gore")), tokensLeft, `branch ${index}: tokens left`);
    assert.equal(ready(b.engine), readyLeft, `branch ${index}: resources left`);
    assert.equal(mustBlockGore(b, "foe"), true, `branch ${index}: the ability resolved`);
  }
}));

clause(GORE, "2:ability:impale", "the picked character must block Gore Engine: declaring no blockers (or only other blockers) is refused, blocking it is allowed", () => {
  const none = goreBoard([], { tokens: 2 });
  activate(none.engine, P1, none.id("gore"), "impale", { selected: { c: [none.id("foe")] } });
  declareAttackBy(none.engine, P1, [none.id("gore")]);
  refused(() => declareBlockers(none.engine, P2, []), "the picked character has to block");

  const onlyOther = goreBoard([], { tokens: 2 });
  activate(onlyOther.engine, P1, onlyOther.id("gore"), "impale", { selected: { c: [onlyOther.id("foe")] } });
  declareAttackBy(onlyOther.engine, P1, [onlyOther.id("gore")]);
  refused(() => declareBlockers(onlyOther.engine, P2, [onlyOther.id("foe2")]), "the OTHER character blocking does not satisfy it");

  const ok = goreBoard([], { tokens: 2 });
  activate(ok.engine, P1, ok.id("gore"), "impale", { selected: { c: [ok.id("foe")] } });
  declareAttackBy(ok.engine, P1, [ok.id("gore")]);
  declareBlockers(ok.engine, P2, [ok.id("foe")]);
  assert.deepEqual(battleOf(ok.engine)?.blockingParty, [ok.id("foe")]);

  const together = goreBoard([], { tokens: 2 });
  activate(together.engine, P1, together.id("gore"), "impale", { selected: { c: [together.id("foe")] } });
  declareAttackBy(together.engine, P1, [together.id("gore")]);
  declareBlockers(together.engine, P2, [together.id("foe"), together.id("foe2")]);
  assert.equal(battleOf(together.engine)?.blockingParty.length, 2, "it may block together with another character");
});

clause(GORE, "2:ability:impale", "'if it can': a picked character that cannot block (depleted) is not forced; no blockers is fine", () => {
  const b = goreBoard([], { tokens: 2 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  b.engine.state.cards[b.id("foe")].depleted = true;
  declareAttackBy(b.engine, P1, [b.id("gore")]);
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(GORE, "2:ability:impale", "it forces a block of THIS card only: an attack by another character leaves the picked character free", () => {
  const b = goreBoard([], { tokens: 2 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], [], "not forced to block the ally");
});

clause(GORE, "2:ability:impale", "a party containing Gore Engine counts: the picked character must block that party", () => {
  const b = goreBoard([], { tokens: 2 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  declareAttackBy(b.engine, P1, [b.id("gore"), b.id("ally")]);
  refused(() => declareBlockers(b.engine, P2, []), "it has to block the party Gore is in");
  declareBlockers(b.engine, P2, [b.id("foe")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe")]);
});

clause(GORE, "2:ability:impale", "the restriction lasts this turn only", () => {
  const b = goreBoard([], { tokens: 2 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  endTurn(b.engine, P1);
  assert.equal(mustBlockGore(b, "foe"), false);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("gore")]);
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], [], "next turn nobody is forced");
});

clause(GORE, "2:ability:impale", "the picked character can be one of mine, and it can be used again for another pick", () => {
  const b = goreBoard([], { rage: 4 });
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("ally")] } });
  assert.equal(mustBlockGore(b, "ally"), true);
  activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: [b.id("foe")] } });
  assert.equal(mustBlockGore(b, "foe"), true);
  assert.equal(ready(b.engine), 0, "2 + 2 resources");
});

clause(GORE, "2:ability:impale", "only a character can be picked: an item, a location, a faction, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
  ];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = goreBoard(extra, { rage: 2 });
    refused(() => activate(b.engine, P1, b.id("gore"), "impale", { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(ready(b.engine), 2, `${label}: nothing was paid`);
  }
});

// --- Infuriator ---------------------------------------------------------------
// When this card enters play, all your characters gain 1 strength this turn.
// Character (warlord, soldier), cost 3, [R][R], 2/2/2.

const INFURIATOR = "914fa597-fa3b-4b90-8368-2754eafbb3f7";

function infuriatorBoard(extra: CardPlacement[] = [], opts: { turn?: number } = {}) {
  return board(
    [
      { key: "inf", def: printing(INFURIATOR), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2", strength: 0, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "MyGear" }), owner: P1, zone: "play" },
      ...bank("rage", 4, P1),
      ...extra
    ],
    { turn: opts.turn }
  );
}

clause(INFURIATOR, "0:rule", "is deployed for exactly 3 with [R][R] and has its printed 2 / 2 / 2 (once its own enters-play bonus is over)", () => {
  deployChecks(INFURIATOR, { cost: 3, icon: "rage", count: 2 });
  const b = board([{ key: "inf", def: printing(INFURIATOR), owner: P1, zone: "play" }]);
  assert.deepEqual(statsOf(b.engine, b.id("inf")), [2, 2, 2], "printed strength / life / speed");
});

clause(INFURIATOR, "0:rule", "entering play, every character I control (including the Infuriator itself) gains exactly 1 strength; life and speed are unchanged", () => {
  const b = infuriatorBoard();
  play(b.engine, P1, b.id("inf"));
  assert.equal(zoneOf(b.engine, b.id("inf")), "play");
  assert.deepEqual(statsOf(b.engine, b.id("inf")), [3, 2, 2], "the Infuriator is one of 'all your characters'");
  assert.deepEqual(statsOf(b.engine, b.id("m1")), [3, 4, 3]);
  assert.deepEqual(statsOf(b.engine, b.id("m2")), [1, 4, 1]);
});

clause(INFURIATOR, "0:rule", "the opponent's characters do not gain strength", () => {
  const b = infuriatorBoard();
  play(b.engine, P1, b.id("inf"));
  assert.equal(strengthOf(b.engine, b.id("foe")), 3);
});

clause(INFURIATOR, "0:rule", "'your' means controlled: a character I took from my opponent gains strength, one that was taken from me does not", () => {
  const b = infuriatorBoard([
    { key: "stolenByMe", def: character({ name: "StolenByMe", strength: 1 }), owner: P2, zone: "play", controller: P1 },
    { key: "stolenFromMe", def: character({ name: "StolenFromMe", strength: 1 }), owner: P1, zone: "play", controller: P2 }
  ]);
  play(b.engine, P1, b.id("inf"));
  assert.equal(strengthOf(b.engine, b.id("stolenByMe")), 2);
  assert.equal(strengthOf(b.engine, b.id("stolenFromMe")), 1);
});

clause(INFURIATOR, "0:rule", "it lasts this turn only", () => {
  const b = infuriatorBoard();
  play(b.engine, P1, b.id("inf"));
  assert.equal(strengthOf(b.engine, b.id("m1")), 3);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(strengthOf(b.engine, b.id("m1")), 2);
  assert.equal(strengthOf(b.engine, b.id("inf")), 2, "the Infuriator is back to its printed strength too");
});

clause(INFURIATOR, "0:rule", "characters that enter play later this turn do not get the bonus", () => {
  const b = infuriatorBoard([{ key: "late", def: character({ name: "Late", strength: 2, cost: 0 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("inf"));
  play(b.engine, P1, b.id("late"));
  assert.equal(strengthOf(b.engine, b.id("late")), 2);
});

clause(INFURIATOR, "0:rule", "it triggers only for itself: another character entering play after it gives no second bonus; a second Infuriator adds +1 more", () => {
  const b = infuriatorBoard([
    { key: "inf2", def: printing(INFURIATOR), owner: P1, zone: "hand" },
    { key: "late", def: character({ name: "Late", strength: 2, cost: 0 }), owner: P1, zone: "hand" },
    ...bank("rage", 3, P1)
  ]);
  play(b.engine, P1, b.id("inf"));
  play(b.engine, P1, b.id("late"));
  assert.equal(strengthOf(b.engine, b.id("m1")), 3, "the newcomer did not re-trigger the first Infuriator");
  play(b.engine, P1, b.id("inf2"));
  assert.equal(strengthOf(b.engine, b.id("m1")), 4, "the second Infuriator entering gives another +1");
  assert.equal(strengthOf(b.engine, b.id("inf")), 4, "the first Infuriator is one of the characters (2 + 1 + 1)");
  assert.equal(strengthOf(b.engine, b.id("inf2")), 3);
  assert.equal(strengthOf(b.engine, b.id("late")), 3, "the late character gets only the second Infuriator's bonus (2 + 1)");
});

clause(INFURIATOR, "0:rule", "it also triggers when it is put into play by an effect", () => {
  const b = board(
    [
      { key: "inf", def: printing(INFURIATOR), owner: P1, zone: "hand" },
      { key: "put", def: putInPlayTactic(), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1", strength: 2 }), owner: P1, zone: "play" }
    ]
  );
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("inf")] } });
  assert.equal(zoneOf(b.engine, b.id("inf")), "play");
  assert.equal(strengthOf(b.engine, b.id("m1")), 3);
});

clause(INFURIATOR, "0:rule", "the trigger waits for it to enter play: nothing happens while it is being deployed", () => {
  const b = infuriatorBoard();
  playRaw(b.engine, P1, b.id("inf"));
  assert.equal(zoneOf(b.engine, b.id("inf")), "deploying");
  assert.equal(strengthOf(b.engine, b.id("m1")), 2);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("m1")), 3);
});

clause(INFURIATOR, "0:rule", "played face-down as a resource it has no rules text: nothing happens", () => {
  const b = board([
    { key: "inf", def: printing(INFURIATOR), owner: P1, zone: "hand" },
    { key: "m1", def: character({ name: "Mine1", strength: 2 }), owner: P1, zone: "play" }
  ], { turn: 2, active: P1 });
  developPlay(b.engine, P1, b.id("inf"), true);
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("m1")), 2);
});

clause(INFURIATOR, "0:rule", "the bonus is real in battle: a 2-strength attacker deals 3 to a 3-life blocker only after the Infuriator", () => {
  const mk = () =>
    board(
      [
        { key: "inf", def: printing(INFURIATOR), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 3, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 3, P1)
      ],
      { turn: 2, active: P1 }
    );
  const without = mk();
  fight(without.engine, P1, [without.id("atk")], { type: "faction", playerId: P2 }, [without.id("blk")]);
  assert.equal(zoneOf(without.engine, without.id("blk")), "play", "control: 2 damage does not kill a 3-life blocker");
  const withIt = mk();
  play(withIt.engine, P1, withIt.id("inf"));
  fight(withIt.engine, P1, [withIt.id("atk")], { type: "faction", playerId: P2 }, [withIt.id("blk")]);
  assert.equal(zoneOf(withIt.engine, withIt.id("blk")), "discard", "3 damage");
});

// --- Lieutenant General -------------------------------------------------------
// If an attacking party is formed including this character, all other "soldier"
// characters in that party gain 1 life this turn. Character (warlord, soldier),
// cost 4, [R][R][R], 3/4/3.

const GENERAL = "8b093762-8619-4a8a-b990-80b11f352c1f";

function generalBoard(extra: CardPlacement[] = []) {
  return board(
    [
      { key: "lg", def: printing(GENERAL), owner: P1, zone: "play" },
      { key: "sol1", def: character({ name: "Sol1", life: 2, speed: 3, subtype: ["soldier"] }), owner: P1, zone: "play" },
      { key: "sol2", def: character({ name: "Sol2", life: 3, speed: 3, subtype: ["berserker", "soldier"] }), owner: P1, zone: "play" },
      { key: "bers", def: character({ name: "Bers", life: 3, speed: 3, subtype: ["berserker"] }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9, speed: 3, subtype: ["soldier"] }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 9 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

clause(GENERAL, "0:rule", "is deployed for exactly 4 with [R][R][R] and has its printed 3 / 4 / 3", () => {
  deployChecks(GENERAL, { cost: 4, icon: "rage", count: 3, stats: [3, 4, 3] });
});

clause(GENERAL, "0:rule", "the other soldiers in the attacking party gain exactly 1 life; the General, non-soldiers and soldiers staying home do not", () => {
  const b = generalBoard();
  declareAttackBy(b.engine, P1, [b.id("lg"), b.id("sol1"), b.id("bers"), b.id("plain")]);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 3, "a soldier in the party");
  assert.equal(lifeOf(b.engine, b.id("lg")), 4, "the General itself is not 'other'");
  assert.equal(lifeOf(b.engine, b.id("bers")), 3, "a berserker is not a soldier");
  assert.equal(lifeOf(b.engine, b.id("plain")), 3, "no subtype");
  assert.equal(lifeOf(b.engine, b.id("sol2")), 3, "a soldier that stayed home");
  assert.deepEqual([strengthOf(b.engine, b.id("sol1")), speedOf(b.engine, b.id("sol1"))], [1, 3], "only life changes");
});

clause(GENERAL, "0:rule", "every other soldier in the party gains 1 life, including one that has several subtypes", () => {
  const b = generalBoard();
  declareAttackBy(b.engine, P1, [b.id("lg"), b.id("sol1"), b.id("sol2")]);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 3);
  assert.equal(lifeOf(b.engine, b.id("sol2")), 4, "berserker + soldier counts as a soldier");
});

clause(GENERAL, "0:rule", "alone, or with only non-soldiers, there is nobody to buff", () => {
  const alone = generalBoard();
  declareAttackBy(alone.engine, P1, [alone.id("lg")]);
  assert.equal(lifeOf(alone.engine, alone.id("lg")), 4);
  const mixed = generalBoard();
  declareAttackBy(mixed.engine, P1, [mixed.id("lg"), mixed.id("bers")]);
  assert.equal(lifeOf(mixed.engine, mixed.id("bers")), 3);
  assert.equal(lifeOf(mixed.engine, mixed.id("lg")), 4);
});

clause(GENERAL, "0:rule", "it needs the General IN the party: soldiers attacking without him gain nothing", () => {
  const b = generalBoard();
  declareAttackBy(b.engine, P1, [b.id("sol1"), b.id("sol2")]);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 2);
  assert.equal(lifeOf(b.engine, b.id("sol2")), 3);
});

clause(GENERAL, "0:rule", "it also works when the party attacks a location", () => {
  const b = generalBoard();
  declareAttackBy(b.engine, P1, [b.id("lg"), b.id("sol1")], { type: "card", cardId: b.id("loc") });
  assert.equal(lifeOf(b.engine, b.id("sol1")), 3);
});

clause(GENERAL, "0:rule", "forming a BLOCKING party with soldiers gives nothing (it is about attacking parties)", () => {
  const b = board(
    [
      { key: "lg", def: printing(GENERAL), owner: P2, zone: "play" },
      { key: "sol", def: character({ name: "Sol", life: 2, subtype: ["soldier"] }), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("lg"), b.id("sol")]);
  assert.equal(lifeOf(b.engine, b.id("sol")), 2);
});

clause(GENERAL, "0:rule", "the extra life lasts this turn only", () => {
  const b = generalBoard();
  declareAttackBy(b.engine, P1, [b.id("lg"), b.id("sol1")]);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 3);
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 2);
});

clause(GENERAL, "0:rule", "the extra life is real: 2 damage destroys a 2-life soldier that stayed home but not one attacking with the General", () => {
  const mk = (withGeneral: boolean) =>
    board(
      [
        { key: "lg", def: printing(GENERAL), owner: P1, zone: "play" },
        { key: "sol", def: character({ name: "Sol", life: 2, subtype: ["soldier"] }), owner: P1, zone: "play" },
        { key: "zap", def: zapTactic(2), owner: P2, zone: "hand" }
      ],
      { turn: 2, active: P1 }
    );
  const home = mk(false);
  attackRaw(home.engine, P1, [home.id("lg")]);
  home.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(home.engine, P2, home.id("zap"), { selected: { t: [home.id("sol")] } });
  resolvePendingResponses(home.engine);
  assert.equal(zoneOf(home.engine, home.id("sol")), "discard", "2 life, 2 damage");

  const together = mk(true);
  attackRaw(together.engine, P1, [together.id("lg"), together.id("sol")]);
  together.engine.perform({ type: "passPriority", playerId: P1 });
  playRaw(together.engine, P2, together.id("zap"), { selected: { t: [together.id("sol")] } });
  resolvePendingResponses(together.engine);
  assert.equal(zoneOf(together.engine, together.id("sol")), "play", "3 life, 2 damage");
});

clause(GENERAL, "0:rule", "two Generals in one party each give the other +1 life", () => {
  const b = generalBoard([{ key: "lg2", def: printing(GENERAL), owner: P1, zone: "play" }]);
  attackRaw(b.engine, P1, [b.id("lg"), b.id("lg2"), b.id("sol1")]);
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  assert.equal(lifeOf(b.engine, b.id("lg")), 5, "buffed by the other General (a soldier)");
  assert.equal(lifeOf(b.engine, b.id("lg2")), 5);
  assert.equal(lifeOf(b.engine, b.id("sol1")), 4, "buffed by both Generals");
});

// --- Morale Officer -----------------------------------------------------------
// CONVINCE -- COST: Deplete this card. EFFECT: This turn, all your soldier
// characters gain 1 strength. Character (warlord, soldier), cost 2, [R], 1/1/3.

const OFFICER = "bac1cee2-b00b-40f5-80d4-3aee69dc1726";

function officerBoard(extra: CardPlacement[] = [], opts: { depleted?: boolean; controller?: Pid } = {}) {
  return board(
    [
      { key: "mo", def: printing(OFFICER), owner: opts.controller ?? P1, zone: "play", depleted: opts.depleted },
      { key: "sol1", def: character({ name: "Sol1", strength: 2, life: 4, speed: 3, subtype: ["soldier"] }), owner: P1, zone: "play" },
      { key: "sol2", def: character({ name: "Sol2", strength: 0, life: 4, speed: 3, subtype: ["berserker", "soldier"] }), owner: P1, zone: "play" },
      { key: "bers", def: character({ name: "Bers", strength: 2, life: 4, speed: 3, subtype: ["berserker"] }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "foeSol", def: character({ name: "FoeSol", strength: 2, life: 4, speed: 3, subtype: ["soldier"] }), owner: P2, zone: "play" },
      ...extra
    ]
  );
}

clause(OFFICER, "0:ability:convince", "is deployed for exactly 2 with [R] and has its printed 1 / 1 / 3", () => {
  deployChecks(OFFICER, { cost: 2, icon: "rage", count: 1, stats: [1, 1, 3] });
});

clause(OFFICER, "0:ability:convince", "depletes the Officer (no resources needed) and gives every soldier I control +1 strength, the Officer included", () => {
  const b = officerBoard();
  assert.equal(ready(b.engine), 0);
  activate(b.engine, P1, b.id("mo"), "convince");
  assert.equal(isDepleted(b.engine, b.id("mo")), true, "COST: Deplete this card");
  assert.equal(strengthOf(b.engine, b.id("mo")), 2, "the Officer is a soldier");
  assert.equal(strengthOf(b.engine, b.id("sol1")), 3);
  assert.equal(strengthOf(b.engine, b.id("sol2")), 1, "berserker + soldier counts");
  assert.deepEqual([lifeOf(b.engine, b.id("sol1")), speedOf(b.engine, b.id("sol1"))], [4, 3], "only strength changes");
});

clause(OFFICER, "0:ability:convince", "non-soldiers and the opponent's soldiers are not affected", () => {
  const b = officerBoard();
  activate(b.engine, P1, b.id("mo"), "convince");
  assert.equal(strengthOf(b.engine, b.id("bers")), 2, "a berserker");
  assert.equal(strengthOf(b.engine, b.id("plain")), 2, "no subtype");
  assert.equal(strengthOf(b.engine, b.id("foeSol")), 2, "my opponent's soldier");
});

clause(OFFICER, "0:ability:convince", "'your' means controlled: a soldier I took gains strength, one that was taken from me does not", () => {
  const b = officerBoard([
    { key: "stolenByMe", def: character({ name: "StolenByMe", strength: 1, subtype: ["soldier"] }), owner: P2, zone: "play", controller: P1 },
    { key: "stolenFromMe", def: character({ name: "StolenFromMe", strength: 1, subtype: ["soldier"] }), owner: P1, zone: "play", controller: P2 }
  ]);
  activate(b.engine, P1, b.id("mo"), "convince");
  assert.equal(strengthOf(b.engine, b.id("stolenByMe")), 2);
  assert.equal(strengthOf(b.engine, b.id("stolenFromMe")), 1);
});

clause(OFFICER, "0:ability:convince", "it lasts this turn only", () => {
  const b = officerBoard();
  activate(b.engine, P1, b.id("mo"), "convince");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(strengthOf(b.engine, b.id("sol1")), 2);
  assert.equal(strengthOf(b.engine, b.id("mo")), 1);
});

clause(OFFICER, "0:ability:convince", "soldiers that enter play later this turn do not get the bonus", () => {
  const b = officerBoard([{ key: "late", def: character({ name: "Late", strength: 2, cost: 0, subtype: ["soldier"] }), owner: P1, zone: "hand" }]);
  activate(b.engine, P1, b.id("mo"), "convince");
  play(b.engine, P1, b.id("late"));
  assert.equal(strengthOf(b.engine, b.id("late")), 2);
});

clause(OFFICER, "0:ability:convince", "refused while the Officer is depleted; used once per turn; usable again after it is restored", () => {
  const depleted = officerBoard([], { depleted: true });
  refused(() => activate(depleted.engine, P1, depleted.id("mo"), "convince"), "the deplete cost cannot be paid");
  assert.equal(strengthOf(depleted.engine, depleted.id("sol1")), 2);

  const b = officerBoard();
  activate(b.engine, P1, b.id("mo"), "convince");
  refused(() => activate(b.engine, P1, b.id("mo"), "convince"), "a second use needs a ready Officer");
  assert.equal(strengthOf(b.engine, b.id("sol1")), 3, "no double bonus");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  activate(b.engine, P1, b.id("mo"), "convince");
  assert.equal(strengthOf(b.engine, b.id("sol1")), 3, "usable again on my next turn");
});

clause(OFFICER, "0:ability:convince", "the cost is paid on activation, the bonus arrives on resolution", () => {
  const b = officerBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("mo"), abilityId: "convince", selected: {}, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("mo")), true);
  assert.equal(strengthOf(b.engine, b.id("sol1")), 2, "not yet");
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("sol1")), 3);
});

clause(OFFICER, "0:ability:convince", "usable the turn the Officer enters play (abilities ignore summoning sickness)", () => {
  const b = board(
    [
      { key: "mo", def: printing(OFFICER), owner: P1, zone: "hand" },
      { key: "sol", def: character({ name: "Sol", strength: 2, subtype: ["soldier"] }), owner: P1, zone: "play" },
      ...bank("rage", 2, P1)
    ]
  );
  play(b.engine, P1, b.id("mo"));
  activate(b.engine, P1, b.id("mo"), "convince");
  assert.equal(strengthOf(b.engine, b.id("sol")), 3);
});

clause(OFFICER, "0:ability:convince", "only its controller can use it", () => {
  const b = officerBoard([], { controller: P2 });
  refused(() => activate(b.engine, P1, b.id("mo"), "convince"), "P1 does not control the Officer");
});

clause(OFFICER, "0:ability:convince", "usable as a response on the opponent's turn: my soldier blockers get the strength", () => {
  const b = board(
    [
      { key: "mo", def: printing(OFFICER), owner: P1, zone: "play" },
      { key: "sol", def: character({ name: "Sol", strength: 2, life: 9, subtype: ["soldier"] }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("mo"), abilityId: "convince", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("sol")), 3);
  assert.equal(strengthOf(b.engine, b.id("atk")), 1);
});

// --- Murderous Commander ------------------------------------------------------
// CUNNING PLAN -- COST: Pay 2. Discard a card. Deplete this card. EFFECT: Inflict
// 2 damage to your opponent's faction. Character (warlord, soldier), cost 5,
// [R][R], 3/3/3.

const MURDEROUS = "84515285-34dc-4b75-95d4-51a6c072b970";

function commanderBoard(extra: CardPlacement[] = [], opts: { rage?: number; depleted?: boolean; controller?: Pid; hand?: number; influenceP2?: number } = {}) {
  return board(
    [
      { key: "mc", def: printing(MURDEROUS), owner: opts.controller ?? P1, zone: "play", depleted: opts.depleted },
      ...fill("h", opts.hand ?? 2, P1, "hand"),
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      ...fill("foeHand", 2, P2, "hand"),
      ...bank("rage", opts.rage ?? 3, P1),
      ...extra
    ],
    { influenceP2: opts.influenceP2 }
  );
}

clause(MURDEROUS, "0:ability:plan", "is deployed for exactly 5 with [R][R] and has its printed 3 / 3 / 3", () => {
  deployChecks(MURDEROUS, { cost: 5, icon: "rage", count: 2, stats: [3, 3, 3] });
});

clause(MURDEROUS, "0:ability:plan", "pays 2, discards the chosen card, depletes the Commander, and the opponent's faction takes exactly 2 damage", () => {
  const b = commanderBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("h1")] } });
  assert.equal(before - ready(b.engine), 2, "COST: Pay 2");
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard", "the chosen card is discarded");
  assert.ok(discardOf(b.engine, P1).includes(b.id("h1")), "into my discard pile");
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand", "the card I did not choose stays");
  assert.equal(isDepleted(b.engine, b.id("mc")), true, "COST: Deplete this card");
  assert.equal(influence(b.engine, P2), theirs - 2);
  assert.equal(influence(b.engine, P1), mine);
});

clause(MURDEROUS, "0:ability:plan", "I choose which card to discard: either hand card works", () => {
  for (const key of ["h0", "h1"]) {
    const b = commanderBoard();
    activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id(key)] } });
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} discarded`);
    assert.equal(zoneOf(b.engine, b.id(key === "h0" ? "h1" : "h0")), "hand");
  }
});

clause(MURDEROUS, "0:ability:plan", "the costs are paid on activation, the damage comes on resolution", () => {
  const b = commanderBoard();
  const theirs = influence(b.engine, P2);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("mc"), abilityId: "plan", selected: { d: [b.id("h0")] }, variables: {} });
  assert.equal(zoneOf(b.engine, b.id("h0")), "discard");
  assert.equal(isDepleted(b.engine, b.id("mc")), true);
  assert.equal(ready(b.engine), 1);
  assert.equal(influence(b.engine, P2), theirs, "the damage has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2);
});

clause(MURDEROUS, "0:ability:plan", "refused one resource short of the 2 to pay, with nothing discarded or depleted", () => {
  const b = commanderBoard([], { rage: 1 });
  refused(() => activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("h0")] } }), "1 resource is not 2");
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
  assert.equal(isDepleted(b.engine, b.id("mc")), false);
  const exact = commanderBoard([], { rage: 2 });
  activate(exact.engine, P1, exact.id("mc"), "plan", { selected: { d: [exact.id("h0")] } });
  assert.equal(ready(exact.engine), 0, "exactly 2 is enough");
});

clause(MURDEROUS, "0:ability:plan", "cannot be used with an empty hand (nothing to discard)", () => {
  const b = commanderBoard([], { hand: 0 });
  refused(() => activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [] } }), "no card to discard");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  assert.equal(isDepleted(b.engine, b.id("mc")), false);
});

clause(MURDEROUS, "0:ability:plan", "exactly one card from MY HAND: none, two, a card in play, in the discard pile or the opponent's hand are refused", () => {
  const attempts: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["no card", () => []],
    ["two cards", (b) => [b.id("h0"), b.id("h1")]],
    ["a card in play", (b) => [b.id("inPlay")]],
    ["a card in my discard pile", (b) => [b.id("inDiscard")]],
    ["a card in the opponent's hand", (b) => [b.id("foeHand0")]]
  ];
  for (const [label, d] of attempts) {
    const b = commanderBoard();
    refused(() => activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: d(b) } }), `${label} is not a legal discard`);
    assert.equal(ready(b.engine), 3, `${label}: nothing was paid`);
    assert.equal(isDepleted(b.engine, b.id("mc")), false, `${label}: not depleted`);
  }
});

clause(MURDEROUS, "0:ability:plan", "refused while depleted and used once per turn", () => {
  const depleted = commanderBoard([], { depleted: true });
  refused(() => activate(depleted.engine, P1, depleted.id("mc"), "plan", { selected: { d: [depleted.id("h0")] } }), "already depleted");
  assert.equal(zoneOf(depleted.engine, depleted.id("h0")), "hand");

  const b = commanderBoard([], { rage: 4, hand: 3 });
  activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("h0")] } });
  refused(() => activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("h1")] } }), "a second use needs a ready Commander");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
});

clause(MURDEROUS, "0:ability:plan", "it is damage to the faction: a damage-reducing effect on factions reduces it", () => {
  const b = commanderBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("h0")] } });
  assert.equal(influence(b.engine, P2), theirs - 1, "2 damage minus 1");
});

clause(MURDEROUS, "0:ability:plan", "an opponent at 2 influence loses the game; at 3 they survive with 1", () => {
  const lethal = commanderBoard([], { influenceP2: 2 });
  activate(lethal.engine, P1, lethal.id("mc"), "plan", { selected: { d: [lethal.id("h0")] } });
  assert.equal(influence(lethal.engine, P2), 0);
  assert.equal(lethal.engine.state.winner, P1);
  const survives = commanderBoard([], { influenceP2: 3 });
  activate(survives.engine, P1, survives.id("mc"), "plan", { selected: { d: [survives.id("h0")] } });
  assert.equal(influence(survives.engine, P2), 1);
  assert.equal(survives.engine.state.winner, undefined);
});

clause(MURDEROUS, "0:ability:plan", "usable the turn the Commander enters play, and only by its controller", () => {
  const b = board(
    [
      { key: "mc", def: printing(MURDEROUS), owner: P1, zone: "hand" },
      { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
      ...bank("rage", 7, P1)
    ]
  );
  play(b.engine, P1, b.id("mc"));
  const theirs = influence(b.engine, P2);
  activate(b.engine, P1, b.id("mc"), "plan", { selected: { d: [b.id("spare")] } });
  assert.equal(influence(b.engine, P2), theirs - 2);

  const stolen = commanderBoard([], { controller: P2 });
  refused(() => activate(stolen.engine, P1, stolen.id("mc"), "plan", { selected: { d: [stolen.id("h0")] } }), "P1 does not control the Commander");
});

// --- Needless Beating ---------------------------------------------------------
// COST: Pick a character. EFFECT: Inflict 2 damage to the character. If your
// opponent's faction has 15 influence or less, inflict 1 additional damage to the
// character. If your opponent's faction has 10 influence or less, inflict 1 damage
// to each character your opponent controls. If your opponent's faction has 5
// influence or less, draw a card. Tactic (warlord), cost 6, [R][R].

const BEATING = "3ea9bbe2-4b32-4f04-9e2c-7a1201b655b9";

function beatingBoard(influenceP2: number, extra: CardPlacement[] = [], opts: { influenceP1?: number } = {}) {
  return board(
    [
      { key: "nb", def: printing(BEATING), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 20, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 20, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...fill("d", 3, P1, "deck"),
      ...fill("e", 3, P2, "deck"),
      ...bank("rage", 8, P1),
      ...extra
    ],
    { influenceP2, influenceP1: opts.influenceP1 }
  );
}

const damages = (b: Board, keys: string[]) => keys.map((key) => damageOn(b.engine, b.id(key)));

clause(BEATING, "0:ability", "is played for exactly 6 with [R][R]", () => {
  deployChecks(BEATING, {
    cost: 6,
    icon: "rage",
    count: 2,
    done: "discard",
    selected: { c: ["target"] },
    extra: [{ key: "target", def: character({ name: "Target", life: 20 }), owner: P2, zone: "play" }]
  });
});

clause(BEATING, "0:ability", "opponent's faction above 15 influence (16, 30): the picked character takes exactly 2 damage, nothing else happens", () => {
  for (const inf of [30, 16]) {
    const b = beatingBoard(inf);
    const handBefore = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
    assert.deepEqual(damages(b, ["foe", "foe2", "mine", "mine2"]), [2, 0, 0, 0], `influence ${inf}`);
    assert.equal(handOf(b.engine, P1).length, handBefore - 1, `influence ${inf}: no card drawn`);
    assert.equal(zoneOf(b.engine, b.id("nb")), "discard");
  }
});

clause(BEATING, "0:ability", "opponent's faction at 15 or 12-11 influence: 1 additional damage to the picked character (3 in total), still nothing else", () => {
  for (const inf of [15, 12, 11]) {
    const b = beatingBoard(inf);
    const handBefore = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
    assert.deepEqual(damages(b, ["foe", "foe2", "mine", "mine2"]), [3, 0, 0, 0], `influence ${inf}`);
    assert.equal(handOf(b.engine, P1).length, handBefore - 1, `influence ${inf}: no card drawn`);
  }
});

clause(BEATING, "0:ability", "opponent's faction at 10 or 6 influence: also 1 damage to EACH opponent character (the picked one takes 4, the other 1), mine are untouched", () => {
  for (const inf of [10, 6]) {
    const b = beatingBoard(inf);
    const handBefore = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
    assert.deepEqual(damages(b, ["foe", "foe2", "mine", "mine2"]), [4, 1, 0, 0], `influence ${inf}`);
    assert.equal(handOf(b.engine, P1).length, handBefore - 1, `influence ${inf}: no card drawn`);
  }
});

clause(BEATING, "0:ability", "opponent's faction at 5 or 1 influence: also draws a card (the top card of my deck), on top of all the damage", () => {
  for (const inf of [5, 1]) {
    const b = beatingBoard(inf);
    const top = deckOf(b.engine, P1)[0];
    const handBefore = handOf(b.engine, P1).length;
    const oppHand = handOf(b.engine, P2).length;
    play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
    assert.deepEqual(damages(b, ["foe", "foe2", "mine", "mine2"]), [4, 1, 0, 0], `influence ${inf}`);
    assert.equal(zoneOf(b.engine, top), "hand", `influence ${inf}: the top card of my deck is drawn`);
    assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, `influence ${inf}: exactly one card`);
    assert.equal(handOf(b.engine, P2).length, oppHand, "my opponent draws nothing");
  }
});

clause(BEATING, "0:ability", "'each character your opponent controls' means characters: items, locations and face-down cards take no damage", () => {
  const b = beatingBoard(10, [{ key: "hidden", def: character({ name: "Hidden", life: 1 }), owner: P2, zone: "play", faceDown: true }]);
  play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
  assert.deepEqual(damages(b, ["foe", "foe2"]), [4, 1]);
  assert.equal(damageOn(b.engine, b.id("gear")), 0);
  assert.equal(damageOn(b.engine, b.id("place")), 0);
  assert.equal(zoneOf(b.engine, b.id("hidden")), "play", "a face-down card is a resource, not a character");
  assert.equal(damageOn(b.engine, b.id("hidden")), 0);
});

clause(BEATING, "0:ability", "the thresholds read the OPPONENT's faction, not mine: my own low influence changes nothing", () => {
  const b = beatingBoard(30, [], { influenceP1: 3 });
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
  assert.deepEqual(damages(b, ["foe", "foe2", "mine", "mine2"]), [2, 0, 0, 0]);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1);
});

clause(BEATING, "0:ability", "picking one of MY characters: it takes the 2 (+1) damage, the each-opponent damage still hits only opponent characters", () => {
  const high = beatingBoard(30);
  play(high.engine, P1, high.id("nb"), { selected: { c: [high.id("mine")] } });
  assert.deepEqual(damages(high, ["foe", "foe2", "mine", "mine2"]), [0, 0, 2, 0]);
  const mid = beatingBoard(14);
  play(mid.engine, P1, mid.id("nb"), { selected: { c: [mid.id("mine")] } });
  assert.deepEqual(damages(mid, ["foe", "foe2", "mine", "mine2"]), [0, 0, 3, 0]);
  const low = beatingBoard(8);
  play(low.engine, P1, low.id("nb"), { selected: { c: [low.id("mine")] } });
  assert.deepEqual(damages(low, ["foe", "foe2", "mine", "mine2"]), [1, 1, 3, 0], "each opponent character takes 1; my picked one takes 3 and not the each-damage");
});

clause(BEATING, "0:ability", "the damage can destroy: a 2-life character dies at influence 30; a 3-life one survives it (2 damage) but dies at influence 15 (3 damage)", () => {
  const a = beatingBoard(30, [{ key: "two", def: character({ name: "Two", life: 2 }), owner: P2, zone: "play" }]);
  play(a.engine, P1, a.id("nb"), { selected: { c: [a.id("two")] } });
  assert.equal(zoneOf(a.engine, a.id("two")), "discard");
  const b = beatingBoard(30, [{ key: "three", def: character({ name: "Three", life: 3 }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("three")] } });
  assert.equal(zoneOf(b.engine, b.id("three")), "play");
  assert.equal(damageOn(b.engine, b.id("three")), 2);
  const c = beatingBoard(15, [{ key: "three", def: character({ name: "Three", life: 3 }), owner: P2, zone: "play" }]);
  play(c.engine, P1, c.id("nb"), { selected: { c: [c.id("three")] } });
  assert.equal(zoneOf(c.engine, c.id("three")), "discard");
});

clause(BEATING, "0:ability", "at influence 5 the card is still drawn when the picked character was destroyed", () => {
  const b = beatingBoard(5, [{ key: "two", def: character({ name: "Two", life: 2 }), owner: P2, zone: "play" }]);
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("nb"), { selected: { c: [b.id("two")] } });
  assert.equal(zoneOf(b.engine, b.id("two")), "discard");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(damageOn(b.engine, b.id("foe")), 1);
});

clause(BEATING, "0:ability", "the influence is read when the tactic resolves: an opponent who drops to 15 in response gives the additional damage", () => {
  const b = beatingBoard(16, [
    { key: "drop", def: tactic({ name: "Drop", cost: 0, behavior: { abilities: [{ id: "drop", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] } }), owner: P2, zone: "hand" }
  ]);
  playRaw(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
  assert.equal(influence(b.engine, P2), 16);
  playRaw(b.engine, P2, b.id("drop"));
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), 15);
  assert.equal(damageOn(b.engine, b.id("foe")), 3, "15 or less at resolution: 2 + 1");
});

clause(BEATING, "0:ability", "the character is picked when it is played, the damage waits for resolution", () => {
  const b = beatingBoard(30);
  playRaw(b.engine, P1, b.id("nb"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("nb")), "deploying");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 2);
});

clause(BEATING, "0:ability", "only a character can be picked: an item, a location, a faction, a face-down card, a hand card, none or two are refused", () => {
  const extra: CardPlacement[] = [
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" }
  ];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["a card in hand", (b) => [b.id("handChar")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = beatingBoard(30, extra);
    refused(() => playRaw(b.engine, P1, b.id("nb"), { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("nb")), "hand", `${label}: not played`);
  }
});

// --- Penetrate ----------------------------------------------------------------
// COST: Pick an attacking character you control. EFFECT: If the character would
// assign battle damage to the blocking party during this battle, assign that
// damage to the faction or location being attacked instead.
// Tactic (warlord), cost 1, [R][R].

const PENETRATE = "cbe794c6-519d-4454-a695-004fb18232b1";

function penetrateBoard(extra: CardPlacement[] = [], opts: { rage?: number } = {}) {
  return board(
    [
      { key: "pen", def: printing(PENETRATE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "home", def: character({ name: "Home", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 9 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

/** Drains the battle's response windows up to the first damage assignment and returns the battle view. */
function damageView(engine: SpoilsEngine) {
  resolvePendingResponses(engine);
  const view = engine.getBattleView();
  assert.ok(view, "a battle is in progress");
  return view;
}

const cardTargets = (view: NonNullable<ReturnType<SpoilsEngine["getBattleView"]>>, sourceId: CardInstanceId) =>
  (view.damageSources.find((source) => source.cardId === sourceId)?.legalTargets ?? []) as Array<{ type: string; cardId?: string; playerId?: string }>;

clause(PENETRATE, "0:ability", "is played for exactly 1 with [R][R] (during my attack, picking an attacking character of mine)", () => {
  const ok = penetrateBoard();
  attackRaw(ok.engine, P1, [ok.id("atk")]);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("pen"), { selected: { atk: [ok.id("atk")] } });
  assert.equal(zoneOf(ok.engine, ok.id("pen")), "discard");
  assert.equal(before - ready(ok.engine), 1, "the printed cost of 1");

  const short = penetrateBoard([], { rage: 0 });
  attackRaw(short.engine, P1, [short.id("atk")]);
  refused(() => playRaw(short.engine, P1, short.id("pen"), { selected: { atk: [short.id("atk")] } }), "no resource to pay 1");

  const noThreshold = penetrateBoard([...bank("greed", 4, P1)], { rage: 1 });
  attackRaw(noThreshold.engine, P1, [noThreshold.id("atk")]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pen"), { selected: { atk: [noThreshold.id("atk")] } }), "one [R] is not [R][R]");
});

clause(PENETRATE, "0:ability", "a blocked attacker's damage goes to the faction instead of the blocker: the blocker takes none, the faction loses the attacker's strength", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 0, "the blocker took nothing from the Penetrating attacker");
  assert.equal(influence(b.engine, P2), theirs - 3, "the attacker's 3 strength went to the faction");
});

clause(PENETRATE, "0:ability", "the redirection is mandatory: the attacker's only legal damage target is the attacked faction, and assigning it to the blocker is refused", () => {
  const b = penetrateBoard();
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  const view = damageView(b.engine);
  const targets = cardTargets(view, b.id("atk"));
  assert.equal(targets.some((target) => target.type === "card" && target.cardId === b.id("blk")), false, "the blocker is not a legal target for the Penetrating attacker");
  assert.ok(targets.some((target) => target.type === "faction" && target.playerId === P2), "the attacked faction is");
  refused(
    () =>
      b.engine.perform({
        type: "assignBattleDamage",
        playerId: P1,
        assignments: [{ sourceId: b.id("atk"), target: { type: "card", cardId: b.id("blk") }, amount: 3 }]
      } as never),
    "damage must go to the faction"
  );
});

clause(PENETRATE, "0:ability", "without Penetrate the same blocked attacker deals its damage to the blocker (control)", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(damageOn(b.engine, b.id("blk")), 3);
  assert.equal(influence(b.engine, P2), theirs);
});

clause(PENETRATE, "0:ability", "with several blockers, none of them receives the Penetrating attacker's damage", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk"), b.id("blk2")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 0);
  assert.equal(damageOn(b.engine, b.id("blk2")), 0);
  assert.equal(influence(b.engine, P2), theirs - 3);
});

clause(PENETRATE, "0:ability", "against an attacked LOCATION the damage goes to the location instead of the blocker", () => {
  const b = penetrateBoard();
  attackRaw(b.engine, P1, [b.id("atk")], { type: "card", cardId: b.id("loc") });
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 0);
  assert.equal(damageOn(b.engine, b.id("loc")), 3, "the location took the attacker's 3");
});

clause(PENETRATE, "0:ability", "only the picked character redirects: another attacker in the party still damages the blocker", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  attackRaw(b.engine, P1, [b.id("atk"), b.id("ally")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  const view = damageView(b.engine);
  assert.equal(cardTargets(view, b.id("atk")).some((target) => target.type === "card"), false, "the picked attacker cannot hit the blocker");
  assert.equal(cardTargets(view, b.id("ally")).some((target) => target.type === "card" && target.cardId === b.id("blk")), true, "the other attacker still can");
  autoResolveBattle(b.engine, (source) => {
    const target = source.legalTargets[0];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
  assert.equal(influence(b.engine, P2), theirs - 3, "the picked attacker's 3 went to the faction");
  assert.equal(damageOn(b.engine, b.id("blk")), 2, "the ally's 2 went to the blocker");
});

clause(PENETRATE, "0:ability", "it changes only the attacker's assignment: the blocker still damages the attacker", () => {
  const b = penetrateBoard();
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("atk")), 1, "the blocker dealt its 1 strength to the attacker");
});

clause(PENETRATE, "0:ability", "it can be played after blockers are declared, before damage is assigned", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  playRaw(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  resolvePendingResponses(b.engine);
  autoResolveBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 0);
  assert.equal(influence(b.engine, P2), theirs - 3);
});

clause(PENETRATE, "0:ability", "an unblocked attacker simply damages the faction as usual", () => {
  const b = penetrateBoard();
  const theirs = influence(b.engine, P2);
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 3);
});

clause(PENETRATE, "0:ability", "it lasts 'during this battle' only: the same attacker, restored and attacking again the same turn, damages the blocker normally", () => {
  const restore = tactic({
    name: "Restore",
    cost: 0,
    behavior: { abilities: [{ id: "rs", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });
  const b = penetrateBoard([{ key: "restore", def: restore, owner: P1, zone: "hand" }]);
  attackRaw(b.engine, P1, [b.id("atk")]);
  play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } });
  declareBlockers(b.engine, P2, [b.id("blk")]);
  autoResolveBattle(b.engine, (source) => {
    const target = source.legalTargets.find((candidate) => (candidate as { type: string }).type === "faction") ?? source.legalTargets[0];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
  assert.equal(damageOn(b.engine, b.id("blk")), 0, "battle 1: the damage was assigned to the faction");
  play(b.engine, P1, b.id("restore"), { selected: { t: [b.id("atk")] } });
  assert.equal(isDepleted(b.engine, b.id("atk")), false, "restored");
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("blk2")]);
  const view = damageView(b.engine);
  const targets = cardTargets(view, b.id("atk"));
  assert.deepEqual(targets, [{ type: "card", cardId: b.id("blk2") }], "battle 2: Penetrate is over, the second blocker is the only target");
});

clause(PENETRATE, "0:ability", "the pick must be an ATTACKING character I control: a character staying home, an opponent's blocker, the opponent's faction, an item and none are refused", () => {
  const extra: CardPlacement[] = [{ key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["a character of mine that stays home", (b) => [b.id("home")]],
    ["an attacking character's party-mate that did not attack", (b) => [b.id("ally")]],
    ["an opponent's character", (b) => [b.id("blk")]],
    ["an item", (b) => [b.id("gear")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["none", () => []],
    ["two (one attacking, one not)", (b) => [b.id("atk"), b.id("home")]]
  ];
  for (const [label, pickIds] of picks) {
    const b = penetrateBoard(extra);
    attackRaw(b.engine, P1, [b.id("atk")]);
    refused(() => playRaw(b.engine, P1, b.id("pen"), { selected: { atk: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("pen")), "hand", `${label}: not played`);
  }
});

clause(PENETRATE, "0:ability", "with no attack in progress there is no attacking character to pick, so it cannot be played", () => {
  const b = penetrateBoard();
  refused(() => playRaw(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } }), "no attacking character");
  assert.equal(zoneOf(b.engine, b.id("pen")), "hand");
});

clause(PENETRATE, "0:ability", "when I defend, my blockers are not 'attacking': the opponent's attacker and my blocker cannot be picked", () => {
  const b = board(
    [
      { key: "pen", def: printing(PENETRATE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2, active: P2 }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  refused(() => playRaw(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("atk")] } }), "the opponent's attacker is not mine");
  refused(() => playRaw(b.engine, P1, b.id("pen"), { selected: { atk: [b.id("mine")] } }), "my character is not attacking");
});

// --- Pinch --------------------------------------------------------------------
// COST: Pick a character. EFFECT: Inflict 1 damage to the character.
// Tactic (warlord), cost 0, [R][R].

const PINCH = "d96fbfac-9ca9-484b-9e05-59a435d4a2bb";

function pinchBoard(extra: CardPlacement[] = [], opts: { rage?: number } = {}) {
  return board([
    { key: "pinch", def: printing(PINCH), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 2 }), owner: P2, zone: "play" },
    { key: "foe1", def: character({ name: "Foe1", life: 1 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    ...bank("rage", opts.rage ?? 2, P1),
    ...extra
  ]);
}

clause(PINCH, "0:ability", "is played for free (cost 0) but needs [R][R]: refused with one rage icon, whatever else I have", () => {
  deployChecks(PINCH, { cost: 0, icon: "rage", count: 2, done: "discard", selected: { c: ["target"] }, extra: [{ key: "target", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" }] });
});

clause(PINCH, "0:ability", "inflicts exactly 1 damage to the picked character and spends no resource", () => {
  const b = pinchBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("foe")] } });
  assert.equal(damageOn(b.engine, b.id("foe")), 1);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "2 life, 1 damage");
  assert.equal(before, ready(b.engine));
  assert.equal(damageOn(b.engine, b.id("foe1")), 0, "only the picked character");
  assert.equal(damageOn(b.engine, b.id("mine")), 0);
});

clause(PINCH, "0:ability", "1 damage destroys a 1-life character", () => {
  const b = pinchBoard();
  play(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("foe1")] } });
  assert.equal(zoneOf(b.engine, b.id("foe1")), "discard");
});

clause(PINCH, "0:ability", "the picked character may be one of mine", () => {
  const b = pinchBoard();
  play(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("mine")] } });
  assert.equal(damageOn(b.engine, b.id("mine")), 1);
});

clause(PINCH, "0:ability", "two Pinches on the same character add up (2 damage destroys a 2-life one)", () => {
  const b = pinchBoard([{ key: "pinch2", def: printing(PINCH), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("foe")] } });
  play(b.engine, P1, b.id("pinch2"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
});

clause(PINCH, "0:ability", "the damage wears off at the start of the next turn", () => {
  const b = pinchBoard();
  play(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("foe")] } });
  assert.equal(damageOn(b.engine, b.id("foe")), 1);
  endTurn(b.engine, P1);
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
});

clause(PINCH, "0:ability", "the character is picked when the tactic is played; the damage waits for resolution", () => {
  const b = pinchBoard();
  playRaw(b.engine, P1, b.id("pinch"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("pinch")), "deploying");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 1);
});

clause(PINCH, "0:ability", "only a character can be picked: an item, a location, a faction, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe1")]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = pinchBoard(extra);
    refused(() => playRaw(b.engine, P1, b.id("pinch"), { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("pinch")), "hand", `${label}: not played`);
  }
});

// --- Really Big Barduse -------------------------------------------------------
// COST: You may pick 2 or fewer characters. When this card enters play, if you
// picked characters as part of its cost then inflict up to 5 damage divided
// however you want to the characters. (If you didn't pay this card's cost then
// you cannot inflict damage.) Character (warlord, dragon), cost 6, [R] x6, 5/4/2.

const BARDUSE = "7f0cfd7d-c9a5-48ff-bafa-a5781a91b5bf";

function barduseBoard(extra: CardPlacement[] = [], opts: { rage?: number } = {}) {
  return board([
    { key: "bd", def: printing(BARDUSE), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
    { key: "foe2", def: character({ name: "Foe2", life: 9 }), owner: P2, zone: "play" },
    { key: "foe3", def: character({ name: "Foe3", life: 9 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    ...bank("rage", opts.rage ?? 6, P1),
    ...extra
  ]);
}

const barduseDamage = (b: Board) => ["foe", "foe2", "foe3", "mine"].map((key) => damageOn(b.engine, b.id(key)));

clause(BARDUSE, "0:ability", "is deployed for exactly 6 with [R] x6 and has its printed 5 / 4 / 2", () => {
  deployChecks(BARDUSE, { cost: 6, icon: "rage", count: 6, stats: [5, 4, 2], selected: { picks: [] } });
});

clause(BARDUSE, "0:ability", "'you may pick': it can be deployed picking no character at all, and then nothing is damaged", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [] } });
  assert.equal(zoneOf(b.engine, b.id("bd")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no damage to divide");
  assert.deepEqual(barduseDamage(b), [0, 0, 0, 0]);
});

clause(BARDUSE, "0:ability", "'2 or fewer': it can pick 1 or 2 characters (mine or my opponent's), but 3 are refused", () => {
  const one = barduseBoard();
  play(one.engine, P1, one.id("bd"), { selected: { picks: [one.id("foe")] } });
  assert.equal(pending(one.engine)?.kind, "distributeAmong", "one picked character: damage to divide");

  const two = barduseBoard();
  play(two.engine, P1, two.id("bd"), { selected: { picks: [two.id("foe"), two.id("mine")] } });
  assert.equal(pending(two.engine)?.kind, "distributeAmong");

  const three = barduseBoard();
  refused(() => playRaw(three.engine, P1, three.id("bd"), { selected: { picks: [three.id("foe"), three.id("foe2"), three.id("foe3")] } }), "3 characters is more than 2");
  assert.equal(zoneOf(three.engine, three.id("bd")), "hand");
});

clause(BARDUSE, "0:ability", "only characters can be picked: an item, a location, a faction, a face-down card and a duplicate are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["a character and an item", (b) => [b.id("foe"), b.id("gear")]],
    ["the same character twice", (b) => [b.id("foe"), b.id("foe")]]
  ];
  for (const [label, pickIds] of picks) {
    const b = barduseBoard(extra);
    refused(() => playRaw(b.engine, P1, b.id("bd"), { selected: { picks: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("bd")), "hand", `${label}: not played`);
  }
});

clause(BARDUSE, "1:rule", "with two picked characters I divide 5 damage as I like: 3 and 2", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe"), b.id("foe2")] } });
  assert.equal(pending(b.engine)?.playerId, P1, "I divide it");
  distribute(b.engine, { [b.id("foe")]: 3, [b.id("foe2")]: 2 });
  assert.deepEqual(barduseDamage(b), [3, 2, 0, 0]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("bd")), "play");
});

clause(BARDUSE, "1:rule", "all 5 on one of the two, and 4 + 1", () => {
  const all = barduseBoard();
  play(all.engine, P1, all.id("bd"), { selected: { picks: [all.id("foe"), all.id("foe2")] } });
  distribute(all.engine, { [all.id("foe2")]: 5 });
  assert.deepEqual(barduseDamage(all), [0, 5, 0, 0]);
  const split = barduseBoard();
  play(split.engine, P1, split.id("bd"), { selected: { picks: [split.id("foe"), split.id("foe2")] } });
  distribute(split.engine, { [split.id("foe")]: 4, [split.id("foe2")]: 1 });
  assert.deepEqual(barduseDamage(split), [4, 1, 0, 0]);
});

clause(BARDUSE, "1:rule", "'up to 5': dividing less than 5 (4, 1, or none at all) is allowed", () => {
  for (const [shares, expected] of [
    [{ foe: 4 }, [4, 0, 0, 0]],
    [{ foe: 1 }, [1, 0, 0, 0]],
    [{ foe: 2, foe2: 1 }, [2, 1, 0, 0]],
    [{}, [0, 0, 0, 0]]
  ] as const) {
    const b = barduseBoard();
    play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe"), b.id("foe2")] } });
    distribute(b.engine, Object.fromEntries(Object.entries(shares).map(([key, n]) => [b.id(key), n])));
    assert.deepEqual(barduseDamage(b), [...expected]);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(BARDUSE, "1:rule", "more than 5 is refused, and so is damage to a character that was not picked", () => {
  const over = barduseBoard();
  play(over.engine, P1, over.id("bd"), { selected: { picks: [over.id("foe"), over.id("foe2")] } });
  refused(() => distribute(over.engine, { [over.id("foe")]: 3, [over.id("foe2")]: 3 }), "6 damage is too much");
  refused(() => distribute(over.engine, { [over.id("foe")]: 6 }), "6 on one character is too much");
  refused(() => distribute(over.engine, { [over.id("foe3")]: 2 }), "foe3 was not picked");
  refused(() => distribute(over.engine, { [over.id("foe")]: 1.5 }), "damage is whole");
  assert.equal(pending(over.engine)?.kind, "distributeAmong", "still waiting for a legal answer");
  distribute(over.engine, { [over.id("foe")]: 5 });
  assert.deepEqual(barduseDamage(over), [5, 0, 0, 0]);
});

clause(BARDUSE, "1:rule", "damage cannot be negative: a share of -1 (to 'divide' more onto the other character) is refused", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe"), b.id("foe2")] } });
  refused(() => distribute(b.engine, { [b.id("foe")]: -1, [b.id("foe2")]: 3 }), "no negative damage");
  assert.equal(pending(b.engine)?.kind, "distributeAmong", "still waiting for a legal answer");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
});

clause(BARDUSE, "1:rule", "I divide the damage, not my opponent", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe"), b.id("foe2")] } });
  refused(() => distribute(b.engine, { [b.id("foe")]: 5 }, P2), "the opponent cannot divide it");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(BARDUSE, "1:rule", "with a single picked character all the damage can go on it (up to 5)", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe")] } });
  distribute(b.engine, { [b.id("foe")]: 5 });
  assert.deepEqual(barduseDamage(b), [5, 0, 0, 0]);
});

clause(BARDUSE, "1:rule", "the damage can destroy characters, one or both", () => {
  const b = barduseBoard([
    { key: "weak1", def: character({ name: "Weak1", life: 2 }), owner: P2, zone: "play" },
    { key: "weak2", def: character({ name: "Weak2", life: 3 }), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("weak1"), b.id("weak2")] } });
  distribute(b.engine, { [b.id("weak1")]: 2, [b.id("weak2")]: 3 });
  assert.equal(zoneOf(b.engine, b.id("weak1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("weak2")), "discard");
});

clause(BARDUSE, "1:rule", "one of my own characters can be among the picks, and Barduse itself takes no damage", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("mine"), b.id("foe")] } });
  distribute(b.engine, { [b.id("mine")]: 2, [b.id("foe")]: 3 });
  assert.deepEqual(barduseDamage(b), [3, 0, 0, 2]);
  assert.equal(damageOn(b.engine, b.id("bd")), 0);
});

clause(BARDUSE, "1:rule", "a picked character that leaves play in response is not damaged; the other picked character can still take all 5", () => {
  const b = barduseBoard([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  playRaw(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe"), b.id("foe2")] } });
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("bd")), "play");
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  distribute(b.engine, { [b.id("foe2")]: 5 });
  assert.equal(damageOn(b.engine, b.id("foe2")), 5);
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
});

clause(BARDUSE, "1:rule", "the picks are made as a cost (before the opponent responds), the damage only when it enters play", () => {
  const b = barduseBoard();
  playRaw(b.engine, P1, b.id("bd"), { selected: { picks: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("bd")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "no damage to divide yet");
  assert.deepEqual(barduseDamage(b), [0, 0, 0, 0]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "distributeAmong", "dividing it happens when it enters play");
  distribute(b.engine, { [b.id("foe")]: 4 });
  assert.equal(damageOn(b.engine, b.id("foe")), 4);
});

clause(BARDUSE, "2:rule", "a Barduse put into play WITHOUT paying its cost cannot inflict damage", () => {
  const b = board([
    { key: "bd", def: printing(BARDUSE), owner: P1, zone: "hand" },
    { key: "put", def: putInPlayTactic(), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("bd")] } });
  assert.equal(zoneOf(b.engine, b.id("bd")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no damage to divide");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
});

clause(BARDUSE, "2:rule", "...but one that was properly paid for with no picks does not either (the damage needs characters picked in the cost)", () => {
  const b = barduseBoard();
  play(b.engine, P1, b.id("bd"), { selected: { picks: [] } });
  assert.deepEqual(barduseDamage(b), [0, 0, 0, 0]);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// --- Ruthless Platoon ---------------------------------------------------------
// CANNIBALIZE -- COST: Destroy a character you control. EFFECT: This turn, this
// card gains 2 strength. Character (warlord, soldier), cost 3, [R][R][R], 2/3/3.

const PLATOON = "5610a488-daad-4dd0-b7e0-b0860be16e8c";

function platoonBoard(extra: CardPlacement[] = [], opts: { controller?: Pid } = {}) {
  return board([
    { key: "rp", def: printing(PLATOON), owner: opts.controller ?? P1, zone: "play" },
    { key: "sac", def: character({ name: "Sac", strength: 1, life: 2 }), owner: P1, zone: "play" },
    { key: "sac2", def: character({ name: "Sac2", strength: 1, life: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    ...extra
  ]);
}

clause(PLATOON, "0:ability:cannibalize", "is deployed for exactly 3 with [R][R][R] and has its printed 2 / 3 / 3", () => {
  deployChecks(PLATOON, { cost: 3, icon: "rage", count: 3, stats: [2, 3, 3] });
});

clause(PLATOON, "0:ability:cannibalize", "destroys the character I pick (no resources needed) and the Platoon gains exactly 2 strength", () => {
  const b = platoonBoard();
  assert.equal(ready(b.engine), 0);
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac")] } });
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "COST: Destroy a character you control");
  assert.equal(strengthOf(b.engine, b.id("rp")), 4);
  assert.deepEqual([lifeOf(b.engine, b.id("rp")), speedOf(b.engine, b.id("rp"))], [3, 3], "only strength changes");
  assert.equal(zoneOf(b.engine, b.id("sac2")), "play", "only the picked character");
  assert.equal(isDepleted(b.engine, b.id("rp")), false, "it does not deplete");
});

clause(PLATOON, "0:ability:cannibalize", "the bonus goes to the Platoon only", () => {
  const b = platoonBoard();
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac")] } });
  assert.equal(strengthOf(b.engine, b.id("sac2")), 1);
  assert.equal(strengthOf(b.engine, b.id("foe")), 1);
});

clause(PLATOON, "0:ability:cannibalize", "it can be used again and again: two sacrifices give +4", () => {
  const b = platoonBoard();
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac")] } });
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac2")] } });
  assert.equal(strengthOf(b.engine, b.id("rp")), 6);
});

clause(PLATOON, "0:ability:cannibalize", "the bonus lasts this turn only", () => {
  const b = platoonBoard();
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac")] } });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(strengthOf(b.engine, b.id("rp")), 2);
});

clause(PLATOON, "0:ability:cannibalize", "the destruction is a cost: it happens on activation, before the opponent can respond, and the bonus follows on resolution", () => {
  const b = platoonBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("rp"), abilityId: "cannibalize", selected: { sac: [b.id("sac")] }, variables: {} });
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "already destroyed");
  assert.equal(strengthOf(b.engine, b.id("rp")), 2, "the bonus has not arrived");
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("rp")), 4);
});

clause(PLATOON, "0:ability:cannibalize", "the Platoon may destroy itself (it is a character I control)", () => {
  const b = platoonBoard();
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("rp")] } });
  assert.equal(zoneOf(b.engine, b.id("rp")), "discard");
});

clause(PLATOON, "0:ability:cannibalize", "a destruction paid as a cost is not replaced (CR 506.2): a character that would be saved from destruction is still destroyed", () => {
  const saver = character({
    name: "Saver",
    behavior: { abilities: [{ id: "save", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "moveCard", target: "source", to: "hand" }] }] }
  });
  const b = platoonBoard([{ key: "saver", def: saver, owner: P1, zone: "play" }]);
  activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("saver")] } });
  assert.equal(zoneOf(b.engine, b.id("saver")), "discard", "destroyed for the cost, not returned to hand");
});

clause(PLATOON, "0:ability:cannibalize", "only a character I control can be picked: an opponent's character, an item, a location, a faction, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an opponent's character", (b) => [b.id("foe")]],
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["my faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["my face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("sac"), b.id("sac2")]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = platoonBoard(extra);
    refused(() => activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: pickIds(b) } }), `${label} cannot be destroyed for the cost`);
    assert.equal(strengthOf(b.engine, b.id("rp")), 2, `${label}: no bonus`);
    assert.equal(zoneOf(b.engine, b.id("sac")), "play", `${label}: nothing was destroyed`);
  }
});

clause(PLATOON, "0:ability:cannibalize", "only its controller can use it", () => {
  const b = platoonBoard([], { controller: P2 });
  refused(() => activate(b.engine, P1, b.id("rp"), "cannibalize", { selected: { sac: [b.id("sac")] } }), "P1 does not control the Platoon");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
});

// --- Sadistic Colonel ---------------------------------------------------------
// If your opponent plays a tactic, inflict 2 damage to their faction.
// Character (warlord, soldier), cost 3, [R], 3/1/3.

const COLONEL = "9bb9052b-c497-4c4c-a22e-e0c2f0edf534";

const plainTactic = (name = "PlainTactic") => tactic({ name, cost: 0 });

function colonelBoard(extra: CardPlacement[] = [], opts: { active?: Pid; turn?: number; colonelController?: Pid; colonelOwner?: Pid } = {}) {
  return board(
    [
      { key: "sc", def: printing(COLONEL), owner: opts.colonelOwner ?? P1, zone: "play", controller: opts.colonelController },
      { key: "oppTac", def: plainTactic("OppTactic"), owner: P2, zone: "hand" },
      { key: "myTac", def: plainTactic("MyTactic"), owner: P1, zone: "hand" },
      ...extra
    ],
    { active: opts.active ?? P2, turn: opts.turn ?? 2 }
  );
}

clause(COLONEL, "0:rule", "is deployed for exactly 3 with [R] and has its printed 3 / 1 / 3", () => {
  deployChecks(COLONEL, { cost: 3, icon: "rage", count: 1, stats: [3, 1, 3] });
});

clause(COLONEL, "0:rule", "when my opponent plays a tactic their faction takes exactly 2 damage (mine takes none)", () => {
  const b = colonelBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P2, b.id("oppTac"));
  assert.equal(zoneOf(b.engine, b.id("oppTac")), "discard", "the tactic resolved");
  assert.equal(influence(b.engine, P2), theirs - 2);
  assert.equal(influence(b.engine, P1), mine);
});

clause(COLONEL, "0:rule", "the damage happens when the tactic is played, before it resolves and before I respond", () => {
  const b = colonelBoard();
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P2, b.id("oppTac"));
  assert.equal(zoneOf(b.engine, b.id("oppTac")), "deploying");
  assert.equal(influence(b.engine, P2), theirs - 2, "already inflicted");
});

clause(COLONEL, "0:rule", "it also works when my opponent plays the tactic in response on MY turn", () => {
  const b = colonelBoard([], { active: P1 });
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("myTac"));
  assert.equal(influence(b.engine, P2), theirs, "my own tactic does nothing");
  playRaw(b.engine, P2, b.id("oppTac"));
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 2);
});

clause(COLONEL, "0:rule", "a tactic that I play does not hurt anyone", () => {
  const b = colonelBoard([], { active: P1 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("myTac"));
  assert.equal(influence(b.engine, P1), mine);
  assert.equal(influence(b.engine, P2), theirs);
});

clause(COLONEL, "0:rule", "each tactic counts: two tactics cost 4 influence", () => {
  const b = colonelBoard([{ key: "oppTac2", def: plainTactic("OppTactic2"), owner: P2, zone: "hand" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P2, b.id("oppTac"));
  play(b.engine, P2, b.id("oppTac2"));
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(COLONEL, "0:rule", "two Sadistic Colonels deal 2 each: 4 for one tactic", () => {
  const b = colonelBoard([{ key: "sc2", def: printing(COLONEL), owner: P1, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  playRaw(b.engine, P2, b.id("oppTac"));
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), theirs - 4);
});

clause(COLONEL, "0:rule", "only TACTICS: a character, an item or a location played by my opponent does nothing", () => {
  const b = colonelBoard([
    { key: "oppChar", def: character({ name: "OppChar", cost: 0 }), owner: P2, zone: "hand" },
    { key: "oppItem", def: item({ name: "OppItem", cost: 0 }), owner: P2, zone: "hand" },
    { key: "oppLoc", def: location({ name: "OppLoc", cost: 0 }), owner: P2, zone: "hand" }
  ]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P2, b.id("oppChar"));
  play(b.engine, P2, b.id("oppItem"));
  play(b.engine, P2, b.id("oppLoc"));
  assert.equal(influence(b.engine, P2), theirs, "no damage for non-tactics");
});

clause(COLONEL, "0:rule", "a TACTICAL character played at tactic timing is still a character, not a tactic: no damage", () => {
  const b = colonelBoard([{ key: "tacChar", def: character({ name: "TacChar", cost: 0, behavior: { keywords: ["tactical"] } }), owner: P2, zone: "hand" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P2, b.id("tacChar"));
  assert.equal(zoneOf(b.engine, b.id("tacChar")), "play");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(COLONEL, "0:rule", "using an ability is not playing a tactic", () => {
  const b = colonelBoard([
    { key: "oppChar", def: character({ name: "OppChar", behavior: { abilities: [{ id: "tick", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 0 }] }] } }), owner: P2, zone: "play" }
  ]);
  const theirs = influence(b.engine, P2);
  activate(b.engine, P2, b.id("oppChar"), "tick");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(COLONEL, "0:rule", "it is damage: a damage-reducing effect on factions reduces it (2 - 1)", () => {
  const b = colonelBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(b.engine, P2);
  play(b.engine, P2, b.id("oppTac"));
  assert.equal(influence(b.engine, P2), theirs - 1);
});

clause(COLONEL, "0:rule", "an opponent at 2 influence loses the game by playing a tactic; at 3 they survive with 1", () => {
  const lethal = board([{ key: "sc", def: printing(COLONEL), owner: P1, zone: "play" }, { key: "oppTac", def: plainTactic(), owner: P2, zone: "hand" }], { active: P2, turn: 2, influenceP2: 2 });
  play(lethal.engine, P2, lethal.id("oppTac"));
  assert.equal(influence(lethal.engine, P2), 0);
  assert.equal(lethal.engine.state.winner, P1);
  const survive = board([{ key: "sc", def: printing(COLONEL), owner: P1, zone: "play" }, { key: "oppTac", def: plainTactic(), owner: P2, zone: "hand" }], { active: P2, turn: 2, influenceP2: 3 });
  play(survive.engine, P2, survive.id("oppTac"));
  assert.equal(influence(survive.engine, P2), 1);
});

clause(COLONEL, "0:rule", "it is the Colonel's CONTROLLER's opponent: a Colonel I took from my opponent hurts the player who now is my opponent... which means its owner", () => {
  const b = colonelBoard([], { colonelOwner: P2, colonelController: P1 });
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P2, b.id("oppTac"));
  assert.equal(influence(b.engine, P2), theirs - 2, "the opponent of the Colonel's controller (me) is P2");
  assert.equal(influence(b.engine, P1), mine);
});

clause(COLONEL, "0:rule", "an opponent's Colonel punishes ME for playing a tactic, and not my opponent", () => {
  const b = board(
    [
      { key: "sc", def: printing(COLONEL), owner: P2, zone: "play" },
      { key: "myTac", def: plainTactic("MyTactic"), owner: P1, zone: "hand" }
    ],
    { active: P1, turn: 2 }
  );
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  play(b.engine, P1, b.id("myTac"));
  assert.equal(influence(b.engine, P1), mine - 2);
  assert.equal(influence(b.engine, P2), theirs);
});

clause(COLONEL, "0:rule", "it does nothing once the Colonel has left play, or while it is face-down", () => {
  const gone = colonelBoard([{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]);
  const theirs = influence(gone.engine, P2);
  play(gone.engine, P2, gone.id("kill"), { selected: { t: [gone.id("sc")] } });
  assert.equal(zoneOf(gone.engine, gone.id("sc")), "discard");
  assert.equal(influence(gone.engine, P2), theirs - 2, "the kill tactic itself was played while the Colonel was still in play");
  play(gone.engine, P2, gone.id("oppTac"));
  assert.equal(influence(gone.engine, P2), theirs - 2, "no further damage: the Colonel is gone");

  const hidden = board([{ key: "sc", def: printing(COLONEL), owner: P1, zone: "play", faceDown: true }, { key: "oppTac", def: plainTactic(), owner: P2, zone: "hand" }], { active: P2, turn: 2 });
  const before = influence(hidden.engine, P2);
  play(hidden.engine, P2, hidden.id("oppTac"));
  assert.equal(influence(hidden.engine, P2), before, "a face-down Colonel is a resource with no rules text");
});

// --- Skin Suit ----------------------------------------------------------------
// COST: Pick a character you control. X is that character's strength. Pick a
// character your opponent controls. Y is that character's strength. EFFECT:
// Inflict X damage to your opponent's character. Inflict Y damage to your
// character. If only 1 of the characters is destroyed by this damage, remove it
// from the game instead. For the rest of the game, the surviving character has
// all rules text of the removed character in addition to its own rules text.
// Tactic (warlord), cost 2, [R][R][R][R].

const SKIN_SUIT = "421c7d4c-d711-4a05-9955-d3834655f5fa";

function skinBoard(mine: CardDefinition, theirs: CardDefinition, extra: CardPlacement[] = [], opts: { turn?: number; active?: Pid } = {}) {
  return board(
    [
      { key: "ss", def: printing(SKIN_SUIT), owner: P1, zone: "hand" },
      { key: "mine", def: mine, owner: P1, zone: "play" },
      { key: "theirs", def: theirs, owner: P2, zone: "play" },
      ...bank("rage", 4, P1),
      ...extra
    ],
    { turn: opts.turn, active: opts.active }
  );
}

const skinPlay = (b: Board) => play(b.engine, P1, b.id("ss"), { selected: { mine: [b.id("mine")], theirs: [b.id("theirs")] } });
const skinPlayRaw = (b: Board) => playRaw(b.engine, P1, b.id("ss"), { selected: { mine: [b.id("mine")], theirs: [b.id("theirs")] } });
const abilityIdsOn = (engine: SpoilsEngine, player: Pid, cardId: CardInstanceId) =>
  engine.getAvailableActivatedAbilities(player).filter((entry) => entry.cardId === cardId).map((entry) => entry.ability.id);

clause(SKIN_SUIT, "0:ability", "is played for exactly 2 with [R][R][R][R]", () => {
  deployChecks(SKIN_SUIT, {
    cost: 2,
    icon: "rage",
    count: 4,
    done: "discard",
    selected: { mine: ["mine"], theirs: ["theirs"] },
    extra: [
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 1, life: 9 }), owner: P2, zone: "play" }
    ]
  });
});

clause(SKIN_SUIT, "0:ability", "my character deals its strength X to the opponent's character and takes the opponent's strength Y; neither dying, nothing is removed", () => {
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 4, speed: 3 }), character({ name: "Theirs", strength: 2, life: 4, speed: 3 }));
  const before = ready(b.engine);
  skinPlay(b);
  assert.equal(damageOn(b.engine, b.id("theirs")), 3, "X = my character's strength");
  assert.equal(damageOn(b.engine, b.id("mine")), 2, "Y = their character's strength");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2");
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
  assert.deepEqual(abilityIdsOn(b.engine, P1, b.id("mine")), [], "no rules text was exchanged");
});

clause(SKIN_SUIT, "0:ability", "only the opponent's character destroyed: it is REMOVED FROM THE GAME instead; my character survives", () => {
  const b = skinBoard(character({ name: "Mine", strength: 4, life: 5, speed: 3 }), character({ name: "Theirs", strength: 1, life: 4, speed: 3 }));
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed", "removed from the game, not put into the discard pile");
  assert.equal(discardOf(b.engine, P2).includes(b.id("theirs")), false);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(damageOn(b.engine, b.id("mine")), 1);
});

clause(SKIN_SUIT, "0:ability", "only MY character destroyed: it is removed from the game instead; the opponent's character survives", () => {
  const b = skinBoard(character({ name: "Mine", strength: 1, life: 2, speed: 3 }), character({ name: "Theirs", strength: 3, life: 5, speed: 3 }));
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed");
  assert.equal(discardOf(b.engine, P1).includes(b.id("mine")), false);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(damageOn(b.engine, b.id("theirs")), 1);
});

clause(SKIN_SUIT, "0:ability", "both characters destroyed: 'only 1' is not true, so both are simply destroyed (discard piles), not removed", () => {
  const b = skinBoard(character({ name: "Mine", strength: 4, life: 2, speed: 3 }), character({ name: "Theirs", strength: 3, life: 3, speed: 3 }));
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
});

clause(SKIN_SUIT, "0:ability", "a character removed instead of destroyed does not trigger its 'if destroyed' ability (Deadly Striker)", () => {
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 5, speed: 3 }), printing(STRIKER));
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed", "Striker (life 2) takes 3 and is removed");
  assert.equal(influence(b.engine, P1), mine, "its 'destroyed' trigger did not fire");
  assert.equal(influence(b.engine, P2), theirs);
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's ACTIVATED ability, in addition to its own (Morale Officer's CONVINCE)", () => {
  const b = skinBoard(drawerChar({ name: "Mine", strength: 3, life: 5, speed: 3, subtype: ["soldier"] }), printing(OFFICER));
  assert.deepEqual(abilityIdsOn(b.engine, P1, b.id("mine")), ["draw1"], "before: only its own ability");
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.deepEqual([...abilityIdsOn(b.engine, P1, b.id("mine"))].sort(), ["convince", "draw1"], "its own and the removed character's");
  activate(b.engine, P1, b.id("mine"), "convince");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "CONVINCE's cost depletes the survivor");
  assert.equal(strengthOf(b.engine, b.id("mine")), 4, "the survivor is a soldier: +1 strength");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's TRIGGERED ability (Callow Liegeman: attacking in a party of 2 gives +1 strength and +1 life)", () => {
  const b = skinBoard(
    character({ name: "Mine", strength: 3, life: 5, speed: 3 }),
    printing(LIEGEMAN),
    [{ key: "pal", def: character({ name: "Pal", strength: 1, life: 4, speed: 3 }), owner: P1, zone: "play" }],
    { turn: 2, active: P1 }
  );
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed", "Liegeman (life 2) takes 3");
  assert.deepEqual(statsOf(b.engine, b.id("mine")), [3, 5, 3]);
  declareAttackBy(b.engine, P1, [b.id("mine"), b.id("pal")]);
  assert.deepEqual(statsOf(b.engine, b.id("mine")), [4, 6, 3], "the copied rally trigger fired");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's 'if destroyed' trigger (Deadly Striker: if it is destroyed, the opponent loses 4 influence)", () => {
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 5, speed: 3 }), printing(STRIKER), [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  const theirs = influence(b.engine, P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(influence(b.engine, P2), theirs - 4, "the survivor now has 'if this card is destroyed, your opponent's faction loses 4 influence'");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains ALL the removed character's rules text: a continuous party restriction (Anxious Oaf) applies to it", () => {
  const b = skinBoard(
    character({ name: "Mine", strength: 3, life: 6, speed: 3 }),
    printing(OAF),
    [{ key: "pal", def: character({ name: "Pal", strength: 1, life: 4, speed: 3 }), owner: P1, zone: "play" }],
    { turn: 2, active: P1 }
  );
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed", "Oaf (life 1) is removed");
  refused(() => attackRaw(b.engine, P1, [b.id("mine")]), "the survivor now 'must have at least 2 members' in its attacking party");
  assert.equal(battleOf(b.engine), undefined);
  attackRaw(b.engine, P1, [b.id("mine"), b.id("pal")]);
  assert.equal(battleOf(b.engine)?.attackingParty.length, 2);
});

clause(SKIN_SUIT, "0:ability", "the survivor gains a KEYWORD of the removed character (COVERT)", () => {
  const covertGuy = character({ name: "CovertGuy", strength: 1, life: 1, speed: 3, behavior: { keywords: ["covert"] } });
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 5, speed: 3 }), covertGuy);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), true, "COVERT is rules text of the removed character");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains a CONTINUOUS stat ability of the removed character (+2 speed)", () => {
  const fast = character({
    name: "Fast",
    strength: 1,
    life: 1,
    speed: 3,
    behavior: { abilities: [{ id: "swift", type: "continuous", modifiers: [{ target: "source", stat: "speed", operation: "add", value: 2 }] }] }
  });
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 5, speed: 3 }), fast);
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.equal(speedOf(b.engine, b.id("mine")), 5, "3 + the copied 'this card gains 2 speed'");
});

clause(SKIN_SUIT, "0:ability", "the same goes when MY character is the one removed: the opponent's survivor gets its rules text", () => {
  const b = skinBoard(printing(OFFICER), character({ name: "Theirs", strength: 3, life: 5, speed: 3, subtype: ["soldier"] }));
  skinPlay(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed", "my Morale Officer (life 1) takes 3");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  const grants = b.engine.state.abilityGrants.filter((grant) => grant.cardId === b.id("theirs"));
  assert.equal(grants.length, 1, "the opponent's character was granted my Officer's rules text");
  assert.deepEqual(grants[0].abilities.map((ability) => ability.id), ["convince"]);
});

clause(SKIN_SUIT, "0:ability", "'for the rest of the game': the survivor keeps the text on later turns, along with its own", () => {
  const b = skinBoard(drawerChar({ name: "Mine", strength: 3, life: 5, speed: 3, subtype: ["soldier"] }), printing(OFFICER));
  skinPlay(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.deepEqual([...abilityIdsOn(b.engine, P1, b.id("mine"))].sort(), ["convince", "draw1"]);
});

clause(SKIN_SUIT, "0:ability", "the borrowed text belongs to the survivor, not to the game: if it leaves play and re-enters it is a new card without it", () => {
  const b = skinBoard(
    drawerChar({ name: "Mine", strength: 3, life: 5, speed: 3, subtype: ["soldier"] }),
    printing(OFFICER),
    [
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "put", def: putInPlayTactic(), owner: P1, zone: "hand" }
    ]
  );
  skinPlay(b);
  assert.ok(abilityIdsOn(b.engine, P1, b.id("mine")).includes("convince"), "abilityIdsOn(b.engine, P1, b.id(\"mine\")).includes(\"convince\")");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.deepEqual(abilityIdsOn(b.engine, P1, b.id("mine")), ["draw1"], "a brand-new card: only its own rules text");
});

clause(SKIN_SUIT, "0:ability", "X and Y are fixed when the cost is paid: a response that pumps the opponent's character does not raise Y", () => {
  const b = skinBoard(
    character({ name: "Mine", strength: 3, life: 9, speed: 3 }),
    character({ name: "Theirs", strength: 2, life: 9, speed: 3 }),
    [{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }]
  );
  skinPlayRaw(b);
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  assert.equal(strengthOf(b.engine, b.id("theirs")), 5, "the pump resolved");
  assert.equal(damageOn(b.engine, b.id("mine")), 2, "Y = 2, the strength when the cost was paid");
  assert.equal(damageOn(b.engine, b.id("theirs")), 3);
});

clause(SKIN_SUIT, "0:ability", "X is fixed when the cost is paid: a response that pumps MY character does not raise X", () => {
  const b = skinBoard(
    character({ name: "Mine", strength: 3, life: 9, speed: 3 }),
    character({ name: "Theirs", strength: 2, life: 9, speed: 3 }),
    [{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }]
  );
  skinPlayRaw(b);
  playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("theirs")), 3, "X = 3, the strength when the cost was paid");
});

clause(SKIN_SUIT, "0:ability", "the characters are picked as a cost (nothing happens until it resolves)", () => {
  const b = skinBoard(character({ name: "Mine", strength: 3, life: 4, speed: 3 }), character({ name: "Theirs", strength: 2, life: 4, speed: 3 }));
  skinPlayRaw(b);
  assert.equal(zoneOf(b.engine, b.id("ss")), "deploying");
  assert.equal(damageOn(b.engine, b.id("theirs")), 0);
  assert.equal(damageOn(b.engine, b.id("mine")), 0);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("theirs")), 3);
});

clause(SKIN_SUIT, "0:ability", "if the opponent's character leaves play in response, mine still takes Y and nothing is removed", () => {
  const b = skinBoard(
    character({ name: "Mine", strength: 3, life: 4, speed: 3 }),
    character({ name: "Theirs", strength: 2, life: 4, speed: 3 }),
    [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]
  );
  skinPlayRaw(b);
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "hand");
  assert.equal(damageOn(b.engine, b.id("mine")), 2, "Y was fixed when the cost was paid");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.deepEqual(b.engine.state.abilityGrants.filter((grant) => grant.cardId === b.id("mine")), []);
});

clause(SKIN_SUIT, "0:ability", "the first pick must be a character I control and the second a character my opponent controls: swapped, same-side, or non-character picks are refused", () => {
  const extra: CardPlacement[] = [
    { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
    { key: "theirs2", def: character({ name: "Theirs2" }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
  ];
  const attempts: Array<[string, (b: Board) => { mine: CardInstanceId[]; theirs: CardInstanceId[] }]> = [
    ["two of my characters", (b) => ({ mine: [b.id("mine")], theirs: [b.id("mine2")] })],
    ["two of their characters", (b) => ({ mine: [b.id("theirs")], theirs: [b.id("theirs2")] })],
    ["swapped", (b) => ({ mine: [b.id("theirs")], theirs: [b.id("mine")] })],
    ["an item as theirs", (b) => ({ mine: [b.id("mine")], theirs: [b.id("gear")] })],
    ["a location as theirs", (b) => ({ mine: [b.id("mine")], theirs: [b.id("place")] })],
    ["their faction as theirs", (b) => ({ mine: [b.id("mine")], theirs: [FACTION_OF(b.engine, P2)] })],
    ["a face-down card as theirs", (b) => ({ mine: [b.id("mine")], theirs: [b.id("hidden")] })],
    ["my faction as mine", (b) => ({ mine: [FACTION_OF(b.engine, P1)], theirs: [b.id("theirs")] })],
    ["no character of mine", (b) => ({ mine: [], theirs: [b.id("theirs")] })],
    ["no character of theirs", (b) => ({ mine: [b.id("mine")], theirs: [] })],
    ["two of mine", (b) => ({ mine: [b.id("mine"), b.id("mine2")], theirs: [b.id("theirs")] })]
  ];
  for (const [label, picks] of attempts) {
    const b = skinBoard(character({ name: "Mine", strength: 1, life: 9 }), character({ name: "Theirs", strength: 1, life: 9 }), extra);
    refused(() => playRaw(b.engine, P1, b.id("ss"), { selected: picks(b) }), `${label} is not a legal pair`);
    assert.equal(zoneOf(b.engine, b.id("ss")), "hand", `${label}: not played`);
  }
  const ok = skinBoard(character({ name: "Mine", strength: 1, life: 9 }), character({ name: "Theirs", strength: 1, life: 9 }), extra);
  play(ok.engine, P1, ok.id("ss"), { selected: { mine: [ok.id("mine")], theirs: [ok.id("theirs")] } });
  assert.equal(damageOn(ok.engine, ok.id("theirs")), 1, "control: a legal pair is accepted");
});

// --- Splattergun --------------------------------------------------------------
// UNLOAD -- COST: Deplete this card. Pick a character or faction. EFFECT: Inflict
// 3 damage to the character or faction. Your opponent takes control of this card.
// Item (warlord), cost 3, [R][R].

const SPLATTERGUN = "69c99fee-c4fd-45ff-9d04-da0cc01ecd54";

function splatterBoard(extra: CardPlacement[] = [], opts: { depleted?: boolean; controller?: Pid; influenceP2?: number; influenceP1?: number } = {}) {
  return board(
    [
      { key: "sg", def: printing(SPLATTERGUN), owner: P1, zone: "play", controller: opts.controller, depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...extra
    ],
    { influenceP2: opts.influenceP2, influenceP1: opts.influenceP1 }
  );
}

clause(SPLATTERGUN, "0:ability:unload", "is deployed for exactly 3 with [R][R]", () => {
  deployChecks(SPLATTERGUN, { cost: 3, icon: "rage", count: 2 });
});

clause(SPLATTERGUN, "0:ability:unload", "shooting an opponent's character: 3 damage, the Splattergun is depleted and my opponent takes control of it", () => {
  const b = splatterBoard();
  activate(b.engine, P1, b.id("sg"), "unload", { selected: { tgt: [b.id("foe")] } });
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
  assert.equal(damageOn(b.engine, b.id("foe2")), 0, "only the picked character");
  assert.equal(isDepleted(b.engine, b.id("sg")), true, "COST: Deplete this card");
  assert.equal(controllerOf(b.engine, b.id("sg")), P2, "your opponent takes control of this card");
  assert.equal(zoneOf(b.engine, b.id("sg")), "play");
  assert.ok(b.engine.state.players[P2].play.includes(b.id("sg")), "it is in my opponent's play area");
  assert.equal(b.engine.state.players[P1].play.includes(b.id("sg")), false);
  assert.equal(b.engine.state.cards[b.id("sg")].ownerId, P1, "ownership never changes");
});

clause(SPLATTERGUN, "0:ability:unload", "shooting the opponent's FACTION: it takes 3 damage (loses 3 influence); mine is untouched", () => {
  const b = splatterBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  activate(b.engine, P1, b.id("sg"), "unload", { selected: { tgt: [FACTION_OF(b.engine, P2)] } });
  assert.equal(influence(b.engine, P2), theirs - 3);
  assert.equal(influence(b.engine, P1), mine);
  assert.equal(controllerOf(b.engine, b.id("sg")), P2);
});

clause(SPLATTERGUN, "0:ability:unload", "any faction can be picked, including mine, and any character, including mine", () => {
  const faction = splatterBoard();
  const mine = influence(faction.engine, P1);
  activate(faction.engine, P1, faction.id("sg"), "unload", { selected: { tgt: [FACTION_OF(faction.engine, P1)] } });
  assert.equal(influence(faction.engine, P1), mine - 3, "my own faction");
  assert.equal(controllerOf(faction.engine, faction.id("sg")), P2);

  const character = splatterBoard();
  activate(character.engine, P1, character.id("sg"), "unload", { selected: { tgt: [character.id("mine")] } });
  assert.equal(damageOn(character.engine, character.id("mine")), 3, "my own character");
  assert.equal(controllerOf(character.engine, character.id("sg")), P2);
});

clause(SPLATTERGUN, "0:ability:unload", "the 3 damage can destroy a character (3 life), not a 4-life one", () => {
  const dead = splatterBoard([{ key: "weak", def: character({ name: "Weak", life: 3 }), owner: P2, zone: "play" }]);
  activate(dead.engine, P1, dead.id("sg"), "unload", { selected: { tgt: [dead.id("weak")] } });
  assert.equal(zoneOf(dead.engine, dead.id("weak")), "discard");
  const alive = splatterBoard([{ key: "sturdy", def: character({ name: "Sturdy", life: 4 }), owner: P2, zone: "play" }]);
  activate(alive.engine, P1, alive.id("sg"), "unload", { selected: { tgt: [alive.id("sturdy")] } });
  assert.equal(zoneOf(alive.engine, alive.id("sturdy")), "play");
  assert.equal(damageOn(alive.engine, alive.id("sturdy")), 3);
});

clause(SPLATTERGUN, "0:ability:unload", "the faction damage is damage (a damage-reducing effect applies) and can end the game (opponent at 3 influence)", () => {
  const shielded = splatterBoard([{ key: "shield", def: factionShield(), owner: P2, zone: "play" }]);
  const theirs = influence(shielded.engine, P2);
  activate(shielded.engine, P1, shielded.id("sg"), "unload", { selected: { tgt: [FACTION_OF(shielded.engine, P2)] } });
  assert.equal(influence(shielded.engine, P2), theirs - 2, "3 damage minus 1");
  const lethal = splatterBoard([], { influenceP2: 3 });
  activate(lethal.engine, P1, lethal.id("sg"), "unload", { selected: { tgt: [FACTION_OF(lethal.engine, P2)] } });
  assert.equal(influence(lethal.engine, P2), 0);
  assert.equal(lethal.engine.state.winner, P1);
});

clause(SPLATTERGUN, "0:ability:unload", "the Splattergun is depleted when the ability is paid; damage and the change of control wait for resolution", () => {
  const b = splatterBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sg"), abilityId: "unload", selected: { tgt: [b.id("foe")] }, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("sg")), true);
  assert.equal(controllerOf(b.engine, b.id("sg")), P1, "still mine while the opponent may respond");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
  assert.equal(controllerOf(b.engine, b.id("sg")), P2);
});

clause(SPLATTERGUN, "0:ability:unload", "if the picked character leaves play in response, my opponent still takes control (the effect does as much as it can)", () => {
  const b = splatterBoard([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sg"), abilityId: "unload", selected: { tgt: [b.id("foe")] }, variables: {} });
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(controllerOf(b.engine, b.id("sg")), P2);
});

clause(SPLATTERGUN, "0:ability:unload", "my opponent can fire it back: restored at the start of their turn, their UNLOAD hands it back to me", () => {
  const b = splatterBoard();
  activate(b.engine, P1, b.id("sg"), "unload", { selected: { tgt: [b.id("foe")] } });
  assert.equal(controllerOf(b.engine, b.id("sg")), P2);
  assert.equal(isDepleted(b.engine, b.id("sg")), true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("sg")), false, "restored by its new controller's restore rule");
  activate(b.engine, P2, b.id("sg"), "unload", { selected: { tgt: [b.id("mine")] } });
  assert.equal(damageOn(b.engine, b.id("mine")), 3);
  assert.equal(controllerOf(b.engine, b.id("sg")), P1, "'your opponent' is now me");
});

clause(SPLATTERGUN, "0:ability:unload", "it needs a ready Splattergun that I control", () => {
  const depleted = splatterBoard([], { depleted: true });
  refused(() => activate(depleted.engine, P1, depleted.id("sg"), "unload", { selected: { tgt: [depleted.id("foe")] } }), "the deplete cost cannot be paid");
  assert.equal(damageOn(depleted.engine, depleted.id("foe")), 0);
  const theirs = splatterBoard([], { controller: P2 });
  refused(() => activate(theirs.engine, P1, theirs.id("sg"), "unload", { selected: { tgt: [theirs.id("foe")] } }), "P1 does not control the Splattergun");
});

clause(SPLATTERGUN, "0:ability:unload", "only a character or a faction can be picked: an item, a location, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["a character and a faction", (b) => [b.id("foe"), FACTION_OF(b.engine, P2)]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = splatterBoard(extra);
    refused(() => activate(b.engine, P1, b.id("sg"), "unload", { selected: { tgt: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(isDepleted(b.engine, b.id("sg")), false, `${label}: not depleted`);
    assert.equal(controllerOf(b.engine, b.id("sg")), P1, `${label}: still mine`);
  }
});

// --- Suicide Squad ------------------------------------------------------------
// ULTIMATE SACRIFICE -- COST: X is this card's strength. Destroy this card. Pick a
// character. EFFECT: Inflict X damage to the character. Character (warlord,
// soldier), cost 4, [R][R], 3/1/3.

const SQUAD = "dbbaecf5-23e2-4c78-b0de-ae8c856e8d0b";

function squadBoard(extra: CardPlacement[] = [], opts: { controller?: Pid } = {}) {
  return board([
    { key: "sq", def: printing(SQUAD), owner: P1, zone: "play", controller: opts.controller },
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
    { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 9 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", strength: 1, life: 9 }), owner: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    ...extra
  ]);
}

clause(SQUAD, "0:ability:sacrifice", "is deployed for exactly 4 with [R][R] and has its printed 3 / 1 / 3", () => {
  deployChecks(SQUAD, { cost: 4, icon: "rage", count: 2, stats: [3, 1, 3] });
});

clause(SQUAD, "0:ability:sacrifice", "destroys itself (no resources needed) and the picked character takes damage equal to its strength, 3", () => {
  const b = squadBoard();
  assert.equal(ready(b.engine), 0);
  activate(b.engine, P1, b.id("sq"), "sacrifice", { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("sq")), "discard", "COST: Destroy this card");
  assert.ok(discardOf(b.engine, P1).includes(b.id("sq")), "discardOf(b.engine, P1).includes(b.id(\"sq\"))");
  assert.equal(damageOn(b.engine, b.id("foe")), 3, "X = 3");
  assert.equal(damageOn(b.engine, b.id("foe2")), 0, "only the picked character");
});

clause(SQUAD, "0:ability:sacrifice", "X is its CURRENT strength: a +2 strength item makes it 5, a -3 item makes it 0", () => {
  const up = squadBoard([{ key: "booster", def: statItem("strength", 2), owner: P1, zone: "play", attachedToKey: "sq" }]);
  assert.equal(strengthOf(up.engine, up.id("sq")), 5);
  activate(up.engine, P1, up.id("sq"), "sacrifice", { selected: { c: [up.id("foe")] } });
  assert.equal(damageOn(up.engine, up.id("foe")), 5);
  const down = squadBoard([{ key: "weakener", def: statItem("strength", -3), owner: P1, zone: "play", attachedToKey: "sq" }]);
  assert.equal(strengthOf(down.engine, down.id("sq")), 0);
  activate(down.engine, P1, down.id("sq"), "sacrifice", { selected: { c: [down.id("foe")] } });
  assert.equal(zoneOf(down.engine, down.id("sq")), "discard", "still destroyed as the cost");
  assert.equal(damageOn(down.engine, down.id("foe")), 0, "X = 0");
});

clause(SQUAD, "0:ability:sacrifice", "the damage can destroy the picked character (3 life) and the picked character can be one of mine", () => {
  const dead = squadBoard([{ key: "weak", def: character({ name: "Weak", life: 3 }), owner: P2, zone: "play" }]);
  activate(dead.engine, P1, dead.id("sq"), "sacrifice", { selected: { c: [dead.id("weak")] } });
  assert.equal(zoneOf(dead.engine, dead.id("weak")), "discard");
  const own = squadBoard();
  activate(own.engine, P1, own.id("sq"), "sacrifice", { selected: { c: [own.id("mine")] } });
  assert.equal(damageOn(own.engine, own.id("mine")), 3);
});

clause(SQUAD, "0:ability:sacrifice", "the destruction is a cost paid on activation; the damage comes when the ability resolves", () => {
  const b = squadBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sq"), abilityId: "sacrifice", selected: { c: [b.id("foe")] }, variables: {} });
  assert.equal(zoneOf(b.engine, b.id("sq")), "discard", "already destroyed while the opponent may respond");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
});

clause(SQUAD, "0:ability:sacrifice", "X is fixed when the cost is paid: the destroyed Squad cannot be pumped in response to raise X", () => {
  const b = squadBoard([{ key: "pump", def: pumpTactic(4), owner: P2, zone: "hand" }]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sq"), abilityId: "sacrifice", selected: { c: [b.id("foe")] }, variables: {} });
  refused(() => playRaw(b.engine, P2, b.id("pump"), { selected: { t: [b.id("sq")] } }), "the sacrificed Squad is no longer in play");
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
});

clause(SQUAD, "0:ability:sacrifice", "if the picked character leaves play in response the Squad is still gone and nothing is damaged", () => {
  const b = squadBoard([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sq"), abilityId: "sacrifice", selected: { c: [b.id("foe")] }, variables: {} });
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sq")), "discard");
  assert.equal(damageOn(b.engine, b.id("foe2")), 0);
});

clause(SQUAD, "0:ability:sacrifice", "the Squad is destroyed first, so it cannot pick itself as the character to damage", () => {
  const b = squadBoard();
  refused(() => activate(b.engine, P1, b.id("sq"), "sacrifice", { selected: { c: [b.id("sq")] } }), "the destroyed Squad is no longer a character in play");
  assert.equal(zoneOf(b.engine, b.id("sq")), "play", "the refused activation did nothing");
});

clause(SQUAD, "0:ability:sacrifice", "only a character can be picked: an item, a location, a faction, a face-down card, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["a faction", (b) => [FACTION_OF(b.engine, P2)]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["two characters", (b) => [b.id("foe"), b.id("foe2")]],
    ["none", () => []]
  ];
  for (const [label, pickIds] of picks) {
    const b = squadBoard(extra);
    refused(() => activate(b.engine, P1, b.id("sq"), "sacrifice", { selected: { c: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(zoneOf(b.engine, b.id("sq")), "play", `${label}: the Squad was not sacrificed`);
  }
});

clause(SQUAD, "0:ability:sacrifice", "it can be used as a response on the opponent's turn: here it destroys an attacker", () => {
  const b = board(
    [
      { key: "sq", def: printing(SQUAD), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sq"), abilityId: "sacrifice", selected: { c: [b.id("atk")] }, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "3 damage on 3 life");
  assert.equal(zoneOf(b.engine, b.id("sq")), "discard");
});

clause(SQUAD, "0:ability:sacrifice", "usable the turn it enters play, and only by its controller", () => {
  const entering = board([
    { key: "sq", def: printing(SQUAD), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
    ...bank("rage", 4, P1)
  ]);
  play(entering.engine, P1, entering.id("sq"));
  activate(entering.engine, P1, entering.id("sq"), "sacrifice", { selected: { c: [entering.id("foe")] } });
  assert.equal(damageOn(entering.engine, entering.id("foe")), 3);
  const stolen = squadBoard([], { controller: P2 });
  refused(() => activate(stolen.engine, P1, stolen.id("sq"), "sacrifice", { selected: { c: [stolen.id("foe")] } }), "P1 does not control the Squad");
});

// --- Swordchucks --------------------------------------------------------------
// ATTACH TO CHARACTER. The attached character gains 4 strength. If any amount of
// damage is inflicted to the attached character, increase the amount by 2.
// HANDOFF -- COST: Pay 3. Deplete a character you control that is not in a battle.
// EFFECT: Attach this card to the character. Item (warlord, gear), cost 4, [R][R].

const SWORDCHUCKS = "9fec08e2-6f2f-40ba-876d-6f5aacd32806";

function chucksBoard(extra: CardPlacement[] = [], opts: { zone?: "play" | "hand"; rage?: number; host?: "host" | "foe"; turn?: number; active?: Pid } = {}) {
  const inPlay = (opts.zone ?? "play") === "play";
  return board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: opts.zone ?? "play", attachedToKey: inPlay ? opts.host ?? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 7, P1),
      ...extra
    ],
    { turn: opts.turn, active: opts.active }
  );
}

clause(SWORDCHUCKS, "0:attach", "is deployed for exactly 4 with [R][R], attached to the picked character", () => {
  deployChecks(SWORDCHUCKS, { cost: 4, icon: "rage", count: 2, selected: { attachTo: ["hostKey"] }, extra: [{ key: "hostKey", def: character({ name: "HostKey" }), owner: P1, zone: "play" }] });
  const b = chucksBoard([], { zone: "hand" });
  play(b.engine, P1, b.id("sw"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("host"));
});

clause(SWORDCHUCKS, "0:attach", "attaches to a character of either player; an opponent's character is a legal host and I keep control of the item", () => {
  const b = chucksBoard([], { zone: "hand" });
  play(b.engine, P1, b.id("sw"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("foe"));
  assert.equal(controllerOf(b.engine, b.id("sw")), P1);
  assert.equal(strengthOf(b.engine, b.id("foe")), 5);
});

clause(SWORDCHUCKS, "0:attach", "refuses a host that is not a character, none, or two", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "hidden", def: character({ name: "HiddenChar" }), owner: P1, zone: "play", faceDown: true },
    { key: "inHand", def: character({ name: "InHandChar" }), owner: P1, zone: "hand" }
  ];
  const hosts: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("thing")]],
    ["a location", (b) => [b.id("place")]],
    ["a face-down card", (b) => [b.id("hidden")]],
    ["my faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["a character in my hand", (b) => [b.id("inHand")]],
    ["no host", () => []],
    ["two hosts", (b) => [b.id("host"), b.id("host2")]]
  ];
  for (const [label, host] of hosts) {
    const b = chucksBoard(extra, { zone: "hand" });
    refused(() => playRaw(b.engine, P1, b.id("sw"), { selected: { attachTo: host(b) } }), `${label} is not a legal host`);
    assert.equal(zoneOf(b.engine, b.id("sw")), "hand", `${label}: not played`);
  }
});

clause(SWORDCHUCKS, "1:rule", "the attached character gains exactly 4 strength (life and speed unchanged); other characters do not", () => {
  const b = chucksBoard();
  assert.deepEqual(statsOf(b.engine, b.id("host")), [6, 5, 3]);
  assert.deepEqual(statsOf(b.engine, b.id("host2")), [1, 6, 2]);
  assert.deepEqual(statsOf(b.engine, b.id("foe")), [1, 6, 3]);
});

clause(SWORDCHUCKS, "1:rule", "the bonus ends when the Swordchucks leaves play", () => {
  const b = chucksBoard([{ key: "kill", def: itemKillTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("sw")] } });
  assert.equal(zoneOf(b.engine, b.id("sw")), "discard");
  assert.equal(strengthOf(b.engine, b.id("host")), 2);
});

clause(SWORDCHUCKS, "2:rule", "damage inflicted to the attached character is increased by exactly 2 (1 -> 3, 2 -> 4)", () => {
  for (const [amount, total] of [[1, 3], [2, 4]] as const) {
    const b = chucksBoard([{ key: "zap", def: zapTactic(amount), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("host")] } });
    assert.equal(damageOn(b.engine, b.id("host")), total, `${amount} damage`);
  }
});

clause(SWORDCHUCKS, "2:rule", "no damage, no increase: 0 damage stays 0", () => {
  const b = chucksBoard([{ key: "zap", def: zapTactic(0), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("host")] } });
  assert.equal(damageOn(b.engine, b.id("host")), 0, "an attempt to inflict 0 damage inflicts nothing (CR 408.1)");
});

clause(SWORDCHUCKS, "2:rule", "each instance of damage is increased: two 1-damage tactics make 3 + 3", () => {
  const b = chucksBoard([
    { key: "zap1", def: zapTactic(1, "Zap1a"), owner: P1, zone: "hand" },
    { key: "zap2", def: zapTactic(1, "Zap1b"), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("host")] } });
  assert.equal(damageOn(b.engine, b.id("host")), 3);
  assert.equal(zoneOf(b.engine, b.id("host")), "play");
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard", "3 + 3 = 6 damage on 5 life");
});

clause(SWORDCHUCKS, "2:rule", "the increase can be what destroys the host (3 life, 1 damage + 2)", () => {
  const b = board([
    { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
    { key: "host", def: character({ name: "Host", strength: 2, life: 3 }), owner: P1, zone: "play" },
    { key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
});

clause(SWORDCHUCKS, "2:rule", "other characters take damage normally", () => {
  const b = chucksBoard([{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("host2")] } });
  assert.equal(damageOn(b.engine, b.id("host2")), 1);
});

clause(SWORDCHUCKS, "2:rule", "it works on an opponent's host too: damage to the enemy character carrying it is increased", () => {
  const b = chucksBoard([{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }], { host: "foe" });
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("foe")] } });
  assert.equal(damageOn(b.engine, b.id("foe")), 3);
});

clause(SWORDCHUCKS, "2:rule", "battle damage from several attackers is summed first and increased once: 2 + 2 + 2 = 6", () => {
  const b = board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 0, life: 20, speed: 1 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  fight(b.engine, P2, [b.id("a1"), b.id("a2")], { type: "faction", playerId: P1 }, [b.id("host")]);
  assert.equal(damageOn(b.engine, b.id("host")), 6, "4 battle damage + 2, once");
  const plain = board(
    [
      { key: "host", def: character({ name: "Host", strength: 0, life: 20, speed: 1 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  fight(plain.engine, P2, [plain.id("a1"), plain.id("a2")], { type: "faction", playerId: P1 }, [plain.id("host")]);
  assert.equal(damageOn(plain.engine, plain.id("host")), 4, "control: without the Swordchucks");
});

clause(SWORDCHUCKS, "2:rule", "the attached character's own damage to others is not changed", () => {
  const b = board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 20, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  fight(b.engine, P1, [b.id("host")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(damageOn(b.engine, b.id("blk")), 6, "2 + 4 strength, nothing extra");
});

function chucksHandoffBoard(extra: CardPlacement[] = [], opts: { rage?: number; host?: "host" | "foe" } = {}) {
  return chucksBoard(
    [
      { key: "spare", def: character({ name: "Spare", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...extra
    ],
    { rage: opts.rage, host: opts.host }
  );
}

clause(SWORDCHUCKS, "3:ability:handoff", "pays 3, depletes the picked character and attaches the Swordchucks to it; the old host loses the bonus", () => {
  const b = chucksHandoffBoard();
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("sw"), "handoff", { selected: { w: [b.id("spare")] } });
  assert.equal(before - ready(b.engine), 3, "COST: Pay 3");
  assert.equal(isDepleted(b.engine, b.id("spare")), true, "COST: Deplete a character you control");
  assert.equal(isDepleted(b.engine, b.id("host")), false, "the old host is not the one depleted");
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("spare"));
  assert.equal(strengthOf(b.engine, b.id("spare")), 5);
  assert.equal(strengthOf(b.engine, b.id("host")), 2, "the old host is back to its printed strength");
  assert.equal(controllerOf(b.engine, b.id("sw")), P1);
  assert.equal(zoneOf(b.engine, b.id("sw")), "play");
});

clause(SWORDCHUCKS, "3:ability:handoff", "the damage increase moves with the Swordchucks", () => {
  const b = chucksHandoffBoard([
    { key: "zap1", def: zapTactic(1, "ZapA"), owner: P1, zone: "hand" },
    { key: "zap2", def: zapTactic(1, "ZapB"), owner: P1, zone: "hand" }
  ]);
  activate(b.engine, P1, b.id("sw"), "handoff", { selected: { w: [b.id("spare")] } });
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("host")] } });
  assert.equal(damageOn(b.engine, b.id("host")), 1, "the old host takes plain damage");
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("spare")] } });
  assert.equal(damageOn(b.engine, b.id("spare")), 3, "the new host takes 1 + 2");
});

clause(SWORDCHUCKS, "3:ability:handoff", "the payment and the deplete are costs (paid on activation); the attaching happens when it resolves", () => {
  const b = chucksHandoffBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sw"), abilityId: "handoff", selected: { w: [b.id("spare")] }, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("spare")), true);
  assert.equal(ready(b.engine), 4);
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("host"), "not moved yet");
  resolvePendingResponses(b.engine);
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("spare"));
});

clause(SWORDCHUCKS, "3:ability:handoff", "it can move the Swordchucks off an OPPONENT's character onto one of mine (I keep control of the item)", () => {
  const b = chucksHandoffBoard([], { host: "foe" });
  assert.equal(strengthOf(b.engine, b.id("foe")), 5);
  activate(b.engine, P1, b.id("sw"), "handoff", { selected: { w: [b.id("spare")] } });
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("spare"));
  assert.equal(strengthOf(b.engine, b.id("foe")), 1);
  assert.equal(controllerOf(b.engine, b.id("sw")), P1);
});

clause(SWORDCHUCKS, "3:ability:handoff", "refused one resource short of 3, with nothing depleted or moved", () => {
  const b = chucksHandoffBoard([], { rage: 2 });
  refused(() => activate(b.engine, P1, b.id("sw"), "handoff", { selected: { w: [b.id("spare")] } }), "2 resources is not 3");
  assert.equal(isDepleted(b.engine, b.id("spare")), false);
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("host"));
  const exact = chucksHandoffBoard([], { rage: 3 });
  activate(exact.engine, P1, exact.id("sw"), "handoff", { selected: { w: [exact.id("spare")] } });
  assert.equal(attachedToOf(exact.engine, exact.id("sw")), exact.id("spare"), "exactly 3 is enough");
});

clause(SWORDCHUCKS, "3:ability:handoff", "the picked character must be one I control that is not already depleted: an opponent's character or a depleted one is refused", () => {
  const foe = chucksHandoffBoard();
  refused(() => activate(foe.engine, P1, foe.id("sw"), "handoff", { selected: { w: [foe.id("foe")] } }), "an opponent's character");
  assert.equal(attachedToOf(foe.engine, foe.id("sw")), foe.id("host"));
  const depleted = chucksHandoffBoard();
  depleted.engine.state.cards[depleted.id("spare")].depleted = true;
  refused(() => activate(depleted.engine, P1, depleted.id("sw"), "handoff", { selected: { w: [depleted.id("spare")] } }), "an already depleted character cannot be depleted again");
  assert.equal(ready(depleted.engine), 7, "nothing was paid");
});

clause(SWORDCHUCKS, "3:ability:handoff", "the picked character must not be in a battle: an attacker or a blocker is refused, one that is not in the battle is fine", () => {
  const attackBoard = board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "spare", def: character({ name: "Spare", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 7, P1)
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(attackBoard.engine, P1, [attackBoard.id("spare")]);
  refused(() => activate(attackBoard.engine, P1, attackBoard.id("sw"), "handoff", { selected: { w: [attackBoard.id("spare")] } }), "an attacking character is in a battle");
  assert.equal(attachedToOf(attackBoard.engine, attackBoard.id("sw")), attackBoard.id("host"));
  activate(attackBoard.engine, P1, attackBoard.id("sw"), "handoff", { selected: { w: [attackBoard.id("host")] } });
  assert.equal(isDepleted(attackBoard.engine, attackBoard.id("host")), true, "a character that is not in the battle may be picked (here the current host)");

  const blocking = board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "spare", def: character({ name: "Spare", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 7, P1)
    ],
    { turn: 2, active: P2 }
  );
  declareAttackBy(blocking.engine, P2, [blocking.id("atk")]);
  declareBlockers(blocking.engine, P1, [blocking.id("spare")]);
  refused(() => activate(blocking.engine, P1, blocking.id("sw"), "handoff", { selected: { w: [blocking.id("spare")] } }), "a blocking character is in a battle");
});

clause(SWORDCHUCKS, "3:ability:handoff", "only a character: an item, a location, a faction, none or two are refused", () => {
  const extra: CardPlacement[] = [{ key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" }];
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("place")]],
    ["my faction", (b) => [FACTION_OF(b.engine, P1)]],
    ["none", () => []],
    ["two characters", (b) => [b.id("spare"), b.id("host2")]]
  ];
  for (const [label, pickIds] of picks) {
    const b = chucksHandoffBoard(extra);
    refused(() => activate(b.engine, P1, b.id("sw"), "handoff", { selected: { w: pickIds(b) } }), `${label} cannot be picked`);
    assert.equal(ready(b.engine), 7, `${label}: nothing was paid`);
  }
});

clause(SWORDCHUCKS, "3:ability:handoff", "HANDOFF can be used on the opponent's turn too (it is an ability): here as a response to their attack", () => {
  const b = board(
    [
      { key: "sw", def: printing(SWORDCHUCKS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "spare", def: character({ name: "Spare", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2, active: P2 }
  );
  openDefenderWindow(b.engine, [b.id("atk")]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sw"), abilityId: "handoff", selected: { w: [b.id("spare")] }, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(attachedToOf(b.engine, b.id("sw")), b.id("spare"));
});

// --- Thundering Nilpha --------------------------------------------------------
// While this card is the only member of an attacking party that is attacking a
// location, it gains 1 strength and cannot be blocked. Character (warlord,
// dragon), cost 5, [R], 4/3/3.

const NILPHA = "a297d28b-8f81-411b-8d1f-6d39f467952d";

function nilphaBoard(extra: CardPlacement[] = [], opts: { nilphaOwner?: Pid; structure?: number } = {}) {
  const nilOwner = opts.nilphaOwner ?? P1;
  const foe = other(nilOwner);
  return board(
    [
      { key: "nil", def: printing(NILPHA), owner: nilOwner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 0, life: 9, speed: 3 }), owner: nilOwner, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 3 }), owner: foe, zone: "play" },
      { key: "loc", def: location({ name: "TargetPlace", structure: opts.structure ?? 9 }), owner: foe, zone: "play" },
      ...extra
    ],
    { turn: 2, active: nilOwner }
  );
}

clause(NILPHA, "0:rule", "is deployed for exactly 5 with [R] and has its printed 4 / 3 / 3", () => {
  deployChecks(NILPHA, { cost: 5, icon: "rage", count: 1, stats: [4, 3, 3] });
});

clause(NILPHA, "0:rule", "the lone attacker of a location gains exactly 1 strength (life and speed unchanged) and cannot be blocked", () => {
  const b = nilphaBoard();
  assert.equal(hasKeyword(b.engine, b.id("nil"), "cannotBeBlocked"), false, "not yet attacking");
  declareAttackBy(b.engine, P1, [b.id("nil")], { type: "card", cardId: b.id("loc") });
  assert.deepEqual(statsOf(b.engine, b.id("nil")), [5, 3, 3]);
  assert.equal(hasKeyword(b.engine, b.id("nil"), "cannotBeBlocked"), true);
});

clause(NILPHA, "0:rule", "it really cannot be blocked: any blocking party is refused, declaring none is fine", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nil")], { type: "card", cardId: b.id("loc") });
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "no blocking party against an unblockable attacker");
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(NILPHA, "0:rule", "the extra strength is real: 5 damage destroys a structure-5 location, 4 damage (a partner attacking with it) does not", () => {
  const lone = nilphaBoard([], { structure: 5 });
  fight(lone.engine, P1, [lone.id("nil")], { type: "card", cardId: lone.id("loc") }, []);
  assert.equal(zoneOf(lone.engine, lone.id("loc")), "discard", "5 damage");
  const pair = nilphaBoard([], { structure: 5 });
  fight(pair.engine, P1, [pair.id("nil"), pair.id("ally")], { type: "card", cardId: pair.id("loc") }, []);
  assert.equal(zoneOf(pair.engine, pair.id("loc")), "play", "4 damage from the Nilpha, 0 from its partner");
  assert.equal(damageOn(pair.engine, pair.id("loc")), 4);
});

clause(NILPHA, "0:rule", "with another member in the party neither bonus applies: 4 strength, and it can be blocked", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nil"), b.id("ally")], { type: "card", cardId: b.id("loc") });
  assert.equal(strengthOf(b.engine, b.id("nil")), 4);
  assert.equal(hasKeyword(b.engine, b.id("nil"), "cannotBeBlocked"), false);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("blk")]);
});

clause(NILPHA, "0:rule", "attacking a FACTION alone gives nothing: 4 strength and it can be blocked", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nil")]);
  assert.equal(strengthOf(b.engine, b.id("nil")), 4);
  assert.equal(hasKeyword(b.engine, b.id("nil"), "cannotBeBlocked"), false);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("blk")]);
});

clause(NILPHA, "0:rule", "blocking, or staying home, gives nothing", () => {
  const home = nilphaBoard();
  assert.equal(strengthOf(home.engine, home.id("nil")), 4);
  assert.equal(hasKeyword(home.engine, home.id("nil"), "cannotBeBlocked"), false);

  const blocking = board(
    [
      { key: "nil", def: printing(NILPHA), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "MyPlace", structure: 9 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  declareAttackBy(blocking.engine, P1, [blocking.id("atk")], { type: "card", cardId: blocking.id("loc") });
  declareBlockers(blocking.engine, P2, [blocking.id("nil")]);
  assert.equal(strengthOf(blocking.engine, blocking.id("nil")), 4, "a blocker defending a location is not attacking");
});

clause(NILPHA, "0:rule", "the bonus only lasts while it is attacking: after the battle it is back to 4 strength and blockable", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nil")], { type: "card", cardId: b.id("loc") });
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
  assert.equal(strengthOf(b.engine, b.id("nil")), 4);
  assert.equal(hasKeyword(b.engine, b.id("nil"), "cannotBeBlocked"), false);
});

clause(NILPHA, "0:rule", "an opponent's Nilpha attacking MY location also gets the bonus", () => {
  const b = nilphaBoard([], { nilphaOwner: P2 });
  declareAttackBy(b.engine, P2, [b.id("nil")], { type: "card", cardId: b.id("loc") });
  assert.equal(strengthOf(b.engine, b.id("nil")), 5);
  refused(() => declareBlockers(b.engine, P1, [b.id("blk")]), "unblockable");
});

// --- Torrential Bleeder -------------------------------------------------------
// At the start of your turn, inflict 1 damage to all characters. Character
// (warlord, dragon), cost 5, [R][R], 4/4/3.

const BLEEDER = "5d437e57-b35a-4881-a2ed-c02eefe1a57d";

function bleederBoard(extra: CardPlacement[] = [], opts: { bleederController?: Pid; active?: Pid } = {}) {
  return board(
    [
      { key: "tb", def: printing(BLEEDER), owner: opts.bleederController ?? P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine1", life: 3 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2", life: 1 }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "Foe1", life: 3 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe2", life: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 1 }), owner: P2, zone: "play", faceDown: true },
      ...extra
    ],
    { turn: 2, active: opts.active ?? P2 }
  );
}

clause(BLEEDER, "0:rule", "is deployed for exactly 5 with [R][R] and has its printed 4 / 4 / 3", () => {
  deployChecks(BLEEDER, { cost: 5, icon: "rage", count: 2, stats: [4, 4, 3] });
});

clause(BLEEDER, "0:rule", "at the start of its controller's turn every character takes exactly 1 damage: mine, my opponent's, and the Bleeder itself", () => {
  const b = bleederBoard();
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my turn has started");
  assert.equal(damageOn(b.engine, b.id("tb")), 1, "the Bleeder itself");
  assert.equal(damageOn(b.engine, b.id("m1")), 1);
  assert.equal(damageOn(b.engine, b.id("f1")), 1);
});

clause(BLEEDER, "0:rule", "a character with 1 life is destroyed, one with more survives", () => {
  const b = bleederBoard();
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("m2")), "discard", "my 1-life character");
  assert.equal(zoneOf(b.engine, b.id("f2")), "discard", "my opponent's 1-life character");
  assert.equal(zoneOf(b.engine, b.id("m1")), "play");
  assert.equal(zoneOf(b.engine, b.id("f1")), "play");
});

clause(BLEEDER, "0:rule", "only characters: items, locations, factions and face-down cards are unharmed", () => {
  const b = bleederBoard();
  const [mine, theirs] = [influence(b.engine, P1), influence(b.engine, P2)];
  endTurn(b.engine, P2);
  assert.equal(damageOn(b.engine, b.id("place")), 0, "a location takes no damage");
  assert.equal(damageOn(b.engine, b.id("gear")), 0);
  assert.equal(influence(b.engine, P1), mine);
  assert.equal(influence(b.engine, P2), theirs);
  assert.equal(zoneOf(b.engine, b.id("hidden")), "play", "a face-down card is a resource, not a character");
  assert.equal(damageOn(b.engine, b.id("hidden")), 0);
});

clause(BLEEDER, "0:rule", "it does NOT fire at the start of my opponent's turn", () => {
  const b = bleederBoard([], { active: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  for (const key of ["tb", "m1", "f1", "m2", "f2"]) assert.equal(damageOn(b.engine, b.id(key)), 0, `${key} undamaged`);
  assert.equal(zoneOf(b.engine, b.id("m2")), "play");
});

clause(BLEEDER, "0:rule", "the 1 damage comes AFTER the start-of-turn damage clearing: a character holding 2 damage ends with 1, not 3", () => {
  const b = bleederBoard([{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P1, zone: "play", damage: 2 }]);
  assert.equal(damageOn(b.engine, b.id("hurt")), 2);
  endTurn(b.engine, P2);
  assert.equal(damageOn(b.engine, b.id("hurt")), 1);
  assert.equal(zoneOf(b.engine, b.id("hurt")), "play");
});

clause(BLEEDER, "0:rule", "the damage stays through the turn and is cleared when the next turn starts", () => {
  const b = bleederBoard();
  endTurn(b.engine, P2);
  assert.equal(damageOn(b.engine, b.id("m1")), 1);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(damageOn(b.engine, b.id("m1")), 0, "cleared at the start of my opponent's turn; the Bleeder does not fire then");
});

clause(BLEEDER, "0:rule", "two Bleeders: every character takes 2 damage at the start of their controller's turn", () => {
  const b = bleederBoard([{ key: "tb2", def: printing(BLEEDER), owner: P1, zone: "play" }]);
  endTurn(b.engine, P2);
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  assert.equal(damageOn(b.engine, b.id("m1")), 2);
  assert.equal(damageOn(b.engine, b.id("f1")), 2);
  assert.equal(damageOn(b.engine, b.id("tb")), 2);
  assert.equal(damageOn(b.engine, b.id("tb2")), 2);
});

clause(BLEEDER, "0:rule", "a Bleeder I took from my opponent hurts everyone at the start of MY turn, and not at theirs", () => {
  const stolen = bleederBoard([], { bleederController: P1 });
  stolen.engine.state.cards[stolen.id("tb")].ownerId = P2;
  endTurn(stolen.engine, P2);
  assert.equal(damageOn(stolen.engine, stolen.id("m1")), 1, "my turn: I control it");
  const theirs = bleederBoard([{ key: "tbFoe", def: printing(BLEEDER), owner: P2, zone: "play" }], { active: P1 });
  endTurn(theirs.engine, P1);
  assert.equal(theirs.engine.state.activePlayerId, P2);
  assert.equal(damageOn(theirs.engine, theirs.id("m1")), 1, "an opponent's Bleeder fires at the start of THEIR turn and hurts my characters too");
  assert.equal(damageOn(theirs.engine, theirs.id("f1")), 1);
});

clause(BLEEDER, "0:rule", "it stops when the Bleeder leaves play, and a face-down Bleeder does nothing", () => {
  const gone = bleederBoard([{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]);
  play(gone.engine, P2, gone.id("kill"), { selected: { t: [gone.id("tb")] } });
  assert.equal(zoneOf(gone.engine, gone.id("tb")), "discard");
  endTurn(gone.engine, P2);
  assert.equal(damageOn(gone.engine, gone.id("m1")), 0);

  const hidden = board([
    { key: "tb", def: printing(BLEEDER), owner: P1, zone: "play", faceDown: true },
    { key: "m1", def: character({ name: "Mine1", life: 3 }), owner: P1, zone: "play" }
  ], { turn: 2, active: P2 });
  endTurn(hidden.engine, P2);
  assert.equal(damageOn(hidden.engine, hidden.id("m1")), 0);
});

// --- Trip Wire ----------------------------------------------------------------
// COST: Play this only while you are being attacked. EFFECT: Inflict up to 3
// damage divided however you want to the attacking characters.
// Tactic (warlord), cost 4, [R].

const TRIP_WIRE = "ebf61cdf-35d0-4bf7-9a54-e4927bfa3247";

function wireBoard(extra: CardPlacement[] = [], opts: { rage?: number } = {}) {
  return board(
    [
      { key: "tw", def: printing(TRIP_WIRE), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "home", def: character({ name: "Home", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyPlace", structure: 9 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...extra
    ],
    { turn: 2, active: P2 }
  );
}

/** P2 attacks with `attackers` and P1 may respond now; Trip Wire is played without picking anything (the card picks nothing). */
const wireAttackers = new WeakMap<SpoilsEngine, CardInstanceId[]>();
function wireAttack(b: Board, attackers: string[], target?: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId }) {
  openDefenderWindow(b.engine, attackers.map(b.id), target);
  wireAttackers.set(b.engine, attackers.map(b.id));
}

/** Plays Trip Wire naming every attacking character (the engine's play-time declaration), without draining responses. */
function playWire(b: Board) {
  playRaw(b.engine, P1, b.id("tw"), { selected: { atk: wireAttackers.get(b.engine) ?? [] } });
}

const wireDamage = (b: Board, keys: string[]) => keys.map((key) => damageOn(b.engine, b.id(key)));

clause(TRIP_WIRE, "0:ability", "is played for exactly 4 with [R] while I am being attacked", () => {
  const ok = wireBoard();
  wireAttack(ok, ["a1"]);
  const before = ready(ok.engine);
  playWire(ok);
  assert.equal(before - ready(ok.engine), 4, "the printed cost of 4");

  const short = wireBoard([], { rage: 3 });
  wireAttack(short, ["a1"]);
  refused(() => playWire(short), "3 resources is not 4");

  const noThreshold = wireBoard([...bank("greed", 5, P1)], { rage: 0 });
  wireAttack(noThreshold, ["a1"]);
  refused(() => playWire(noThreshold), "no [R]");
});

clause(TRIP_WIRE, "0:ability", "the card picks nothing: it can be played without naming the attackers", () => {
  const b = wireBoard();
  wireAttack(b, ["a1", "a2"]);
  playRaw(b.engine, P1, b.id("tw"));
  assert.equal(zoneOf(b.engine, b.id("tw")), "deploying", "played with no picks");
});

clause(TRIP_WIRE, "0:ability", "against a single attacker I may put all 3 damage on it", () => {
  const b = wireBoard();
  wireAttack(b, ["a1"]);
  playWire(b);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  assert.equal(pending(b.engine)?.playerId, P1, "I divide the damage");
  distribute(b.engine, { [b.id("a1")]: 3 });
  assert.deepEqual(wireDamage(b, ["a1", "a2", "home"]), [3, 0, 0]);
  assert.equal(zoneOf(b.engine, b.id("tw")), "discard");
});

clause(TRIP_WIRE, "0:ability", "the damage is divided as I want among ALL the attacking characters: 3 on one, 2 + 1, 1 + 1 + 1", () => {
  for (const shares of [{ a1: 3 }, { a1: 2, a2: 1 }, { a1: 1, a2: 1, a3: 1 }, { a3: 3 }] as const) {
    const b = wireBoard();
    wireAttack(b, ["a1", "a2", "a3"]);
    playWire(b);
    resolvePendingResponses(b.engine);
    distribute(b.engine, Object.fromEntries(Object.entries(shares).map(([key, n]) => [b.id(key), n])));
    const expected = ["a1", "a2", "a3"].map((key) => (shares as Record<string, number>)[key] ?? 0);
    assert.deepEqual(wireDamage(b, ["a1", "a2", "a3"]), expected);
    assert.equal(damageOn(b.engine, b.id("home")), 0, "a character that is not attacking is untouched");
    assert.equal(damageOn(b.engine, b.id("mine")), 0, "my own characters are untouched");
  }
});

clause(TRIP_WIRE, "0:ability", "'up to 3': dividing less than 3 (2, 1, or none) is allowed", () => {
  for (const [shares, expected] of [[{ a1: 2 }, [2, 0]], [{ a1: 1, a2: 1 }, [1, 1]], [{ a2: 1 }, [0, 1]], [{}, [0, 0]]] as const) {
    const b = wireBoard();
    wireAttack(b, ["a1", "a2"]);
    playWire(b);
    resolvePendingResponses(b.engine);
    distribute(b.engine, Object.fromEntries(Object.entries(shares).map(([key, n]) => [b.id(key), n])));
    assert.deepEqual(wireDamage(b, ["a1", "a2"]), [...expected]);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(TRIP_WIRE, "0:ability", "more than 3 is refused, and so is damage to a character that is not attacking or a fractional share", () => {
  const b = wireBoard();
  wireAttack(b, ["a1", "a2"]);
  playWire(b);
  resolvePendingResponses(b.engine);
  refused(() => distribute(b.engine, { [b.id("a1")]: 2, [b.id("a2")]: 2 }), "4 damage is too much");
  refused(() => distribute(b.engine, { [b.id("a1")]: 4 }), "4 on one attacker is too much");
  refused(() => distribute(b.engine, { [b.id("home")]: 1 }), "'home' is not attacking");
  refused(() => distribute(b.engine, { [b.id("mine")]: 1 }), "my own character is not an attacker");
  refused(() => distribute(b.engine, { [b.id("a1")]: 0.5 }), "damage is whole");
  assert.equal(pending(b.engine)?.kind, "distributeAmong", "still waiting for a legal answer");
  distribute(b.engine, { [b.id("a1")]: 3 });
  assert.deepEqual(wireDamage(b, ["a1", "a2"]), [3, 0]);
});

clause(TRIP_WIRE, "0:ability", "damage cannot be negative: a share of -1 is refused", () => {
  const b = wireBoard();
  wireAttack(b, ["a1", "a2"]);
  playWire(b);
  resolvePendingResponses(b.engine);
  refused(() => distribute(b.engine, { [b.id("a1")]: -1, [b.id("a2")]: 3 }), "no negative damage");
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  assert.equal(damageOn(b.engine, b.id("a1")), 0);
});

clause(TRIP_WIRE, "0:ability", "the opponent cannot divide my damage", () => {
  const b = wireBoard();
  wireAttack(b, ["a1", "a2"]);
  playWire(b);
  resolvePendingResponses(b.engine);
  refused(() => distribute(b.engine, { [b.id("a1")]: 3 }, P2), "only I may divide it");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(TRIP_WIRE, "0:ability", "the damage can destroy an attacker, which then leaves the battle", () => {
  const b = wireBoard([{ key: "weak", def: character({ name: "Weak", strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" }]);
  wireAttack(b, ["weak", "a1"]);
  playWire(b);
  resolvePendingResponses(b.engine);
  distribute(b.engine, { [b.id("weak")]: 3 });
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("a1")], "the destroyed attacker is no longer in the party");
});

clause(TRIP_WIRE, "0:ability", "it works against an attack on my LOCATION too (I am being attacked: CR 302.2)", () => {
  const b = wireBoard();
  wireAttack(b, ["a1", "a2"], { type: "card", cardId: b.id("myLoc") });
  playWire(b);
  resolvePendingResponses(b.engine);
  distribute(b.engine, { [b.id("a2")]: 3 });
  assert.deepEqual(wireDamage(b, ["a1", "a2"]), [0, 3]);
});

clause(TRIP_WIRE, "0:ability", "it can also be played later in the battle, after blockers are declared", () => {
  const b = wireBoard();
  declareAttackBy(b.engine, P2, [b.id("a1"), b.id("a2")]);
  declareBlockers(b.engine, P1, [b.id("mine")]);
  wireAttackers.set(b.engine, [b.id("a1"), b.id("a2")]);
  b.engine.perform({ type: "passPriority", playerId: P2 });
  playWire(b);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  distribute(b.engine, { [b.id("a1")]: 2, [b.id("a2")]: 1 });
  assert.deepEqual(wireDamage(b, ["a1", "a2"]), [2, 1]);
});

clause(TRIP_WIRE, "0:ability", "the damage is dealt when the tactic resolves, not when it is played", () => {
  const b = wireBoard();
  wireAttack(b, ["a1"]);
  playWire(b);
  assert.equal(zoneOf(b.engine, b.id("tw")), "deploying");
  assert.equal(damageOn(b.engine, b.id("a1")), 0);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to divide yet");
});

clause(TRIP_WIRE, "0:ability", "refused while I am NOT being attacked: on my own turn, on the opponent's turn with no attack, and when I am the attacker", () => {
  const myTurn = board(
    [
      { key: "tw", def: printing(TRIP_WIRE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, active: P1 }
  );
  refused(() => playWire(myTurn), "no battle on my turn");
  assert.equal(zoneOf(myTurn.engine, myTurn.id("tw")), "hand");

  const theirTurn = board(
    [
      { key: "tw", def: printing(TRIP_WIRE), owner: P1, zone: "hand" },
      { key: "oppTac", def: plainTactic("OppTactic"), owner: P2, zone: "hand" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, active: P2 }
  );
  playRaw(theirTurn.engine, P2, theirTurn.id("oppTac"));
  refused(() => playWire(theirTurn), "responding to a tactic is not being attacked");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("tw")), "hand");

  const iAttack = board(
    [
      { key: "tw", def: printing(TRIP_WIRE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, active: P1 }
  );
  attackRaw(iAttack.engine, P1, [iAttack.id("atk")]);
  refused(() => playWire(iAttack), "I am the attacker, the opponent is being attacked");
  assert.equal(zoneOf(iAttack.engine, iAttack.id("tw")), "hand");
});

// --- Trophy Collector ---------------------------------------------------------
// COST: Play this only if your opponent's faction has 10 influence or less.
// Character (warlord, soldier), cost 1, [R], 3/2/3.

const COLLECTOR = "33e392bd-4d5d-475c-9cfe-a5dac86bfd2f";

function collectorBoard(influenceP2: number, opts: { influenceP1?: number; rage?: number } = {}) {
  return board([{ key: "tc", def: printing(COLLECTOR), owner: P1, zone: "hand" }, ...bank("rage", opts.rage ?? 2, P1)], { influenceP2, influenceP1: opts.influenceP1 });
}

clause(COLLECTOR, "0:ability", "is deployed for exactly 1 with [R] and has its printed 3 / 2 / 3 (opponent at 10 influence)", () => {
  const b = collectorBoard(10);
  const before = ready(b.engine);
  play(b.engine, P1, b.id("tc"));
  assert.equal(zoneOf(b.engine, b.id("tc")), "play");
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1");
  assert.deepEqual(statsOf(b.engine, b.id("tc")), [3, 2, 3]);

  const noResources = collectorBoard(10, { rage: 0 });
  refused(() => playRaw(noResources.engine, P1, noResources.id("tc")), "no resource to pay 1");
  const noThreshold = board([{ key: "tc", def: printing(COLLECTOR), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)], { influenceP2: 10 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("tc")), "no [R]");
});

clause(COLLECTOR, "0:ability", "playable while my opponent's faction has 10 or less influence (10, 9, 1)", () => {
  for (const inf of [10, 9, 1]) {
    const b = collectorBoard(inf);
    play(b.engine, P1, b.id("tc"));
    assert.equal(zoneOf(b.engine, b.id("tc")), "play", `opponent at ${inf}`);
  }
});

clause(COLLECTOR, "0:ability", "refused while my opponent's faction has more than 10 influence (11, 12, 30)", () => {
  for (const inf of [11, 12, 30]) {
    const b = collectorBoard(inf);
    refused(() => playRaw(b.engine, P1, b.id("tc")), `opponent at ${inf}`, /cannot be deployed right now/);
    assert.equal(zoneOf(b.engine, b.id("tc")), "hand", `opponent at ${inf}: not played`);
    assert.equal(ready(b.engine), 2, `opponent at ${inf}: nothing was paid`);
  }
});

clause(COLLECTOR, "0:ability", "it is my OPPONENT's influence that counts, not mine", () => {
  const myLow = collectorBoard(30, { influenceP1: 3 });
  refused(() => playRaw(myLow.engine, P1, myLow.id("tc")), "my own low influence does not help", /cannot be deployed right now/);
  const theirLow = collectorBoard(10, { influenceP1: 30 });
  play(theirLow.engine, P1, theirLow.id("tc"));
  assert.equal(zoneOf(theirLow.engine, theirLow.id("tc")), "play", "my high influence does not matter");
});

clause(COLLECTOR, "0:ability", "the opponent's Collector is played when MY faction has 10 or less: judged against the other player's faction", () => {
  const b = board([{ key: "tc", def: printing(COLLECTOR), owner: P2, zone: "hand" }, ...bank("rage", 2, P2)], { turn: 2, active: P2, influenceP1: 10 });
  play(b.engine, P2, b.id("tc"));
  assert.equal(zoneOf(b.engine, b.id("tc")), "play");
  const high = board([{ key: "tc", def: printing(COLLECTOR), owner: P2, zone: "hand" }, ...bank("rage", 2, P2)], { turn: 2, active: P2, influenceP1: 11 });
  refused(() => playRaw(high.engine, P2, high.id("tc")), "P1 has 11", /cannot be deployed right now/);
});

clause(COLLECTOR, "0:ability", "it restricts PLAYING it only: once in play it stays in play when the opponent's influence goes up or down", () => {
  const b = collectorBoard(10);
  play(b.engine, P1, b.id("tc"));
  b.engine.state.players[P2].influence = 25;
  assert.equal(zoneOf(b.engine, b.id("tc")), "play");
  assert.deepEqual(statsOf(b.engine, b.id("tc")), [3, 2, 3]);
});

clause(COLLECTOR, "0:ability", "putting it into play with an effect is not 'playing' it: the restriction does not apply", () => {
  const b = board([
    { key: "tc", def: printing(COLLECTOR), owner: P1, zone: "hand" },
    { key: "put", def: putInPlayTactic(), owner: P1, zone: "hand" }
  ], { influenceP2: 30 });
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("tc")] } });
  assert.equal(zoneOf(b.engine, b.id("tc")), "play");
});

// --- Wyrmfang Deathskull ------------------------------------------------------
// UNIQUE WYRMFANG. If you attack, your opponent must pick any number of
// characters they control. Those characters must block during this battle if
// they can, and only those characters can block. Character (warlord, dragon),
// cost 7, [R][R][R][R], 6/6/3.

const WYRMFANG = "b5fbadf6-df3d-42bd-b55a-daaa1321b076";

function wyrmBoard(extra: CardPlacement[] = [], opts: { wyrmZone?: "play" | "hand"; rage?: number } = {}) {
  return board(
    [
      { key: "wd", def: printing(WYRMFANG), owner: P1, zone: opts.wyrmZone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "C2", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "C3", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 20 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...extra
    ],
    { turn: 2, active: P1 }
  );
}

/** Wyrmfang's controller attacks with `attackers`; stops at the pick the opponent must make. */
function wyrmAttack(b: Board, attackers: string[] = ["wd"], target?: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId }) {
  attackRaw(b.engine, P1, attackers.map(b.id), target);
}

/** The opponent picks `keys` as the blockers (and the attack's response windows are drained afterwards). */
function wyrmPick(b: Board, keys: string[], player: Pid = P2) {
  assert.equal(pending(b.engine)?.kind, "chooseChosenBlockers", "the opponent has to pick the blocking characters");
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooseChosenBlockers", cardIds: keys.map(b.id) } } as never);
  resolvePendingResponses(b.engine);
}

clause(WYRMFANG, "0:unique", "controlling a second Wyrmfang makes you keep one: you choose, and the other is destroyed (the game goes on)", () => {
  const keepNew = wyrmBoard([{ key: "wd2", def: printing(WYRMFANG), owner: P1, zone: "hand" }], { rage: 7 });
  play(keepNew.engine, P1, keepNew.id("wd2"));
  const pc = pending(keepNew.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [keepNew.id("wd"), keepNew.id("wd2")].sort());
  keepNew.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepNew.id("wd2") } } as never);
  resolvePendingResponses(keepNew.engine);
  assert.equal(zoneOf(keepNew.engine, keepNew.id("wd2")), "play");
  assert.equal(zoneOf(keepNew.engine, keepNew.id("wd")), "discard", "the other copy is destroyed");
  assert.equal(keepNew.engine.state.pendingChoice, undefined, "the game is not stuck");
  attackRaw(keepNew.engine, P1, [keepNew.id("ally")]);
  assert.ok(battleOf(keepNew.engine) || pending(keepNew.engine), "the game continues: an attack can be declared afterwards");

  const keepOld = wyrmBoard([{ key: "wd2", def: printing(WYRMFANG), owner: P1, zone: "hand" }], { rage: 7 });
  play(keepOld.engine, P1, keepOld.id("wd2"));
  keepOld.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepOld.id("wd") } } as never);
  resolvePendingResponses(keepOld.engine);
  assert.equal(zoneOf(keepOld.engine, keepOld.id("wd")), "play");
  assert.equal(zoneOf(keepOld.engine, keepOld.id("wd2")), "discard");
  assert.equal(keepOld.engine.state.pendingChoice, undefined, "the game is not stuck");
});

clause(WYRMFANG, "0:unique", "the restriction is per player: my opponent may control their own Wyrmfang, with no choice and no destruction", () => {
  const b = wyrmBoard([{ key: "wd2", def: printing(WYRMFANG), owner: P2, zone: "hand" }, ...bank("rage", 7, P2)]);
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  play(b.engine, P2, b.id("wd2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("wd")), "play");
  assert.equal(zoneOf(b.engine, b.id("wd2")), "play");
});

clause(WYRMFANG, "0:unique", "a different UNIQUE card is not a duplicate", () => {
  const b = wyrmBoard([{ key: "other", def: character({ name: "OtherUnique", unique: "someone else" } as Partial<CardDefinition>), owner: P1, zone: "play" }]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("wd")), "play");
});

clause(WYRMFANG, "1:rule", "is deployed for exactly 7 with [R][R][R][R] and has its printed 6 / 6 / 3", () => {
  deployChecks(WYRMFANG, { cost: 7, icon: "rage", count: 4, stats: [6, 6, 3] });
});

clause(WYRMFANG, "1:rule", "when I attack, MY OPPONENT picks the characters (not me), from the characters they control", () => {
  const b = wyrmBoard();
  wyrmAttack(b);
  assert.ok(pending(b.engine), "a pick is waiting");
  assert.equal(pending(b.engine)?.playerId, P2, "my opponent picks");
  refused(() => wyrmPick(b, ["c1"], P1), "I cannot pick for them");
});

clause(WYRMFANG, "1:rule", "with two picked characters: both must block, and nobody else may", () => {
  const solo = wyrmBoard();
  wyrmAttack(solo);
  wyrmPick(solo, ["c1", "c2"]);
  refused(() => declareBlockers(solo.engine, P2, [solo.id("c1")]), "c2 must block as well");
  refused(() => declareBlockers(solo.engine, P2, [solo.id("c2")]), "c1 must block as well");
  refused(() => declareBlockers(solo.engine, P2, []), "no blockers at all");
  refused(() => declareBlockers(solo.engine, P2, [solo.id("c3")]), "c3 was not picked");
  refused(() => declareBlockers(solo.engine, P2, [solo.id("c1"), solo.id("c2"), solo.id("c3")]), "c3 was not picked");
  declareBlockers(solo.engine, P2, [solo.id("c1"), solo.id("c2")]);
  assert.deepEqual([...(battleOf(solo.engine)?.blockingParty ?? [])].sort(), [solo.id("c1"), solo.id("c2")].sort());
});

clause(WYRMFANG, "1:rule", "with one picked character: it must block alone, others cannot", () => {
  const b = wyrmBoard();
  wyrmAttack(b);
  wyrmPick(b, ["c2"]);
  refused(() => declareBlockers(b.engine, P2, []), "c2 must block");
  refused(() => declareBlockers(b.engine, P2, [b.id("c1")]), "only c2 can block");
  refused(() => declareBlockers(b.engine, P2, [b.id("c1"), b.id("c2")]), "c1 cannot join");
  declareBlockers(b.engine, P2, [b.id("c2")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("c2")]);
});

clause(WYRMFANG, "1:rule", "'any number': picking none means nobody can block (an empty blocking party is the only choice)", () => {
  const b = wyrmBoard();
  wyrmAttack(b);
  wyrmPick(b, []);
  refused(() => declareBlockers(b.engine, P2, [b.id("c1")]), "only the picked characters can block, and there are none");
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(WYRMFANG, "1:rule", "picking every character forces them all to block", () => {
  const b = wyrmBoard();
  wyrmAttack(b);
  wyrmPick(b, ["c1", "c2", "c3"]);
  refused(() => declareBlockers(b.engine, P2, [b.id("c1"), b.id("c2")]), "c3 must block too");
  declareBlockers(b.engine, P2, [b.id("c1"), b.id("c2"), b.id("c3")]);
  assert.equal(battleOf(b.engine)?.blockingParty.length, 3);
});

clause(WYRMFANG, "1:rule", "'if they can': a picked character that cannot block (depleted) is not forced to", () => {
  const b = wyrmBoard([{ key: "tired", def: character({ name: "Tired", life: 9, speed: 3 }), owner: P2, zone: "play", depleted: true }]);
  wyrmAttack(b);
  wyrmPick(b, ["c1", "tired"]);
  declareBlockers(b.engine, P2, [b.id("c1")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("c1")]);
});

clause(WYRMFANG, "1:rule", "only characters I... they control can be picked: my character, an item, a location or a faction are refused", () => {
  const picks: Array<[string, (b: Board) => CardInstanceId[]]> = [
    ["my character", (b) => [b.id("ally")]],
    ["an item", (b) => [b.id("gear")]],
    ["a location", (b) => [b.id("loc")]],
    ["their faction", (b) => [FACTION_OF(b.engine, P2)]]
  ];
  for (const [label, pickIds] of picks) {
    const b = wyrmBoard();
    wyrmAttack(b);
    refused(
      () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseChosenBlockers", cardIds: pickIds(b) } } as never),
      `${label} cannot be picked`
    );
  }
  const ok = wyrmBoard();
  wyrmAttack(ok);
  wyrmPick(ok, ["c3"]);
  declareBlockers(ok.engine, P2, [ok.id("c3")]);
  assert.deepEqual(battleOf(ok.engine)?.blockingParty, [ok.id("c3")], "control: their own character is accepted");
});

clause(WYRMFANG, "1:rule", "it also applies when the attack is on a location", () => {
  const b = wyrmBoard();
  wyrmAttack(b, ["wd"], { type: "card", cardId: b.id("loc") });
  assert.equal(pending(b.engine)?.playerId, P2);
  wyrmPick(b, ["c1"]);
  refused(() => declareBlockers(b.engine, P2, [b.id("c2")]), "only c1 can block");
  declareBlockers(b.engine, P2, [b.id("c1")]);
});

clause(WYRMFANG, "1:rule", "'If YOU attack' (any attack of mine, even without the Wyrmfang in the party): my opponent still picks the blockers", () => {
  const b = wyrmBoard();
  wyrmAttack(b, ["ally"]);
  assert.ok(pending(b.engine), "my opponent has to pick the blocking characters");
  assert.equal(pending(b.engine)?.playerId, P2);
  wyrmPick(b, ["c1"]);
  refused(() => declareBlockers(b.engine, P2, [b.id("c2")]), "only c1 can block");
  declareBlockers(b.engine, P2, [b.id("c1")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("c1")]);
});

clause(WYRMFANG, "1:rule", "an attack by my OPPONENT does nothing (it is 'if you attack'): I block freely and nobody is asked", () => {
  const b = board(
    [
      { key: "wd", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  attackRaw(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick");
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P1, [b.id("mine")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("mine")]);
});

clause(WYRMFANG, "1:rule", "with no Wyrmfang in play (it is in my hand) an attack is unrestricted", () => {
  const b = wyrmBoard([], { wyrmZone: "hand" });
  attackRaw(b.engine, P1, [b.id("ally")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P2, [b.id("c1"), b.id("c3")]);
  assert.equal(battleOf(b.engine)?.blockingParty.length, 2);
});
