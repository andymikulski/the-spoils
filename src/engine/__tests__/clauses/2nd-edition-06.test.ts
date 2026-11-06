// Clause tests — batch 2nd-edition-06. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-06`. Expectations come from each
// card's PRINTED text (2nd Edition printing) and RULES.md / the Comprehensive
// Rules / FAQ; engine data (ability ids, declaration ids, choice kinds) is only
// used to DRIVE the engine.

import assert from "node:assert/strict";
import {
  buildGame as harnessBuildGame,
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
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

/** A small deterministic PRNG (mulberry32): every board gets its own fixed stream, so no outcome depends on an unseeded random. */
function seededRandom(seed = 20261017): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `buildGame` with a seeded random source unless a test passes its own (coin flips, shuffles and random picks are all fixed). */
const buildGame: typeof harnessBuildGame = (options = {}) => harnessBuildGame({ ...options, random: options.random ?? seededRandom() });

type Pid = typeof P1 | typeof P2;
type Def = CardDefinition;
type Board = ReturnType<typeof harnessBuildGame>;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].damage;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const keywordsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId) as string[];
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => keywordsOf(engine, cardId).includes(keyword);
/** [strength, life, speed] */
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const subtypesOf = (engine: SpoilsEngine, cardId: CardInstanceId): string[] => {
  const def = engine.getDefinition(cardId) as unknown as { subtype?: string[] };
  return [...(def.subtype ?? [])];
};

/** A seeded RNG that always wins a coin flip (`random() < 0.5`) / always loses it. */
const WIN = () => 0.1;
const LOSE = () => 0.9;

/** The coin flips the log has recorded so far. */
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => {
      const ev = entry.event as unknown as { playerId: string; won: boolean };
      return { playerId: ev.playerId, won: ev.won };
    });

/** Raw `activateAbility` WITHOUT draining the response window. */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** Answers the open `chooserSelectsTarget` choice with `selected` (draining the response window afterwards). */
function pick(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

/** Same as `pick` but WITHOUT draining the response window (for refusal checks and "right after the answer" assertions). */
function pickRaw(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `chooserSelectsOption` choice with the option whose label matches `pattern`. */
function chooseOption(engine: SpoilsEngine, pattern: RegExp): void {
  const pc = pending(engine) as unknown as { kind: string; options: Array<{ label?: string }> } | undefined;
  assert.equal(pc?.kind, "chooserSelectsOption", "an option choice is open");
  const index = pc!.options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern} (have ${pc!.options.map((option) => option.label).join(" | ")})`);
  answerPending(engine, "chooserSelectsOption", { index });
}

/** P2 (the active player) attacks P1's faction with `attackerId` and passes: P1 now holds priority in the battle's declaration window. */
function openDefenderWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  declareAttackOpenWindow(engine, P2, [attackerId], { type: "faction", playerId: P1 });
}

/** A free tactic that adds `amount` to a stat of one picked character until end of turn (id `pump`, declaration `t`). */
const statTactic = (stat: "strength" | "life" | "speed", amount: number, name = `Pump${stat}${amount}`): Def =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat, operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

/** A free tactic dealing `amount` damage to one picked character (id `dmg`, declaration `t`). */
const damageTactic = (amount: number, name = `Smite${amount}`): Def =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "dmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    }
  });

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
const bounceTactic = (): Def =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });

/** A free tactic that takes permanent control of one picked opponent's character (id `steal`, declaration `t`). */
const stealTactic = (): Def =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

/** A free tactic that draws a card (id `d`), a witness for "a tactic was played / could be played". */
const freeDrawTactic = (name = "FreeDraw"): Def =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** Passes priority until `player` (or nobody) holds the response window. */
function passUntil(engine: SpoilsEngine, player: Pid) {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** A free tactic that does nothing, played to open a response window for the other player (id `noop`). */
const noopTactic = (name = "Noop"): Def => tactic({ name, cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

/** A plain character of the given stats (harmless unless asked otherwise). */
const plain = (name: string, strength: number, life: number, speed: number, extra: Partial<Def> = {}): Def => character({ name, strength, life, speed, ...extra });

interface HandOpts {
  /** Deception resources (default 14). */
  deception?: number;
  greed?: number;
  rage?: number;
  elitism?: number;
  obsession?: number;
  extra?: CardPlacement[];
  turn?: number;
  active?: Pid;
  random?: () => number;
  key?: string;
}

/** The printing under test in P1's hand (key `me` unless `opts.key`), the usual Develop factions, and resources of the requested icons. */
function handBoard(printingId: string, opts: HandOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: opts.key ?? "me", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("elitism", opts.elitism ?? 0, P1),
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays `id` and answers every pending choice with `answer` (default: decline), asserting nothing is left pending. */
function playAndSettle(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, opts: Parameters<typeof play>[3] = {}, answer: (pc: PendingChoiceLike) => unknown = declineAll): void {
  play(engine, player, cardId, opts);
  drain(engine, answer);
  assert.equal(pending(engine), undefined, "nothing is left pending");
}

/**
 * The deploy-cost checks every printed card has: it needs its numeric cost (one
 * short is refused), its threshold (enough resources of the wrong icon is
 * refused) and it pays exactly the printed cost. `make` builds a board with the
 * printing in P1's hand (key `me`) and the given resources of the card's own
 * trade icon (`own`) and of a wrong icon (`wrong`). The numeric-cost-only
 * refusal is skipped when the threshold already requires at least `cost` icons.
 */
function deployChecks(
  make: (res: { own: number; wrong: number }) => Board,
  cost: number,
  thresholdIcons: number,
  selected: (id: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]> = () => ({}),
  key = "me"
): Board {
  if (cost > 0 && cost - 1 >= thresholdIcons) {
    const short = make({ own: cost - 1, wrong: 0 });
    refused(() => playRaw(short.engine, P1, short.id(key), { selected: selected(short.id) }), `one resource short of ${cost}`);
    assert.equal(zoneOf(short.engine, short.id(key)), "hand", "nothing was played");
  }
  const noIcons = make({ own: thresholdIcons - 1, wrong: cost + 4 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id(key), { selected: selected(noIcons.id) }), `${thresholdIcons - 1} matching icons is below the threshold even with ${cost + 4} resources of another icon`);
  assert.equal(zoneOf(noIcons.engine, noIcons.id(key)), "hand");

  const total = Math.max(cost, thresholdIcons);
  const exact = make({ own: total, wrong: 0 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id(key), { selected: selected(exact.id) });
  assert.equal(before - ready(exact.engine), cost, `exactly ${cost} is paid`);
  assert.equal(ready(exact.engine), total - cost);
  return exact;
}

// =============================================================================
// Martial Arts Master
// While this card is in a battle and there is at least one character in the
// opposing party, it gains X strength, where X is this card's speed minus the
// highest speed among characters in the opposing party.
// Character (rogue, martial artist), cost 4, threshold [D][D], 1 str / 6 spd / 3 life.
// =============================================================================

const MASTER = "9044062e-86cf-43b8-b56f-8d33bc0dd31c";

const rogueMake = (id: string, opts: HandOpts = {}) => (res: { own: number; wrong: number }) => handBoard(id, { ...opts, deception: res.own, greed: res.wrong });
const warlordMake = (id: string, opts: HandOpts = {}) => (res: { own: number; wrong: number }) => handBoard(id, { ...opts, rage: res.own, greed: res.wrong });

/** A character of the given speed (harmless: 0 strength, lots of life). */
const mamFoe = (key: string, owner: Pid, speed: number, extra: Partial<Def> = {}): CardPlacement => ({
  key,
  def: character({ name: `Speed${speed} ${key}`, strength: 0, life: 9, speed, ...extra }),
  owner,
  zone: "play"
});

/** P1 attacks (faction, or `target`) with the Master (key `ma`) and optional allies; P2 blocks with `blockWith` (default: all `blockers`). Returns with blockers declared. */
function masterAttacks(blockers: CardPlacement[], opts: { allies?: CardPlacement[]; extra?: CardPlacement[]; blockWith?: string[]; masterDef?: Def } = {}) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: opts.masterDef ?? printing(MASTER), owner: P1, zone: "play" }, ...(opts.allies ?? []), ...blockers, ...(opts.extra ?? [])]
  });
  declareAttackBy(game.engine, P1, ["ma", ...(opts.allies ?? []).map((a) => a.key)].map(game.id));
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: (opts.blockWith ?? blockers.map((b) => b.key)).map(game.id) });
  return game;
}

/** P2 attacks with the given characters; P1 blocks with the Master. Returns with blockers declared. */
function masterBlocks(attackers: CardPlacement[], opts: { extra?: CardPlacement[] } = {}) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, ...attackers, ...(opts.extra ?? [])]
  });
  declareAttackBy(game.engine, P2, attackers.map((a) => game.id(a.key)));
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("ma")] });
  return game;
}

clause(MASTER, "0:rule", "outside a battle it has just its printed 1 strength (3 life, 6 speed)", () => {
  const { engine, id } = buildGame({ cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, mamFoe("foe", P2, 2)] });
  assert.deepEqual(stats(engine, id("ma")), [1, 3, 6]);
});

clause(MASTER, "0:rule", "attacking and blocked by a speed-2 character: X = 6 - 2 = 4, so strength 5 (speed itself unchanged)", () => {
  const { engine, id } = masterAttacks([mamFoe("b1", P2, 2)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 5);
  assert.equal(engine.getStat(id("ma"), "speed"), 6);
  assert.equal(engine.getStat(id("ma"), "life"), 3);
});

clause(MASTER, "0:rule", "X follows the opposing speed: opposing speeds 0, 1, 3, 4, 5 give strength 7, 6, 4, 3, 2", () => {
  for (const [speed, expected] of [[0, 7], [1, 6], [3, 4], [4, 3], [5, 2]] as const) {
    const { engine, id } = masterAttacks([mamFoe("b1", P2, speed)]);
    assert.equal(engine.getStat(id("ma"), "strength"), expected, `opposing speed ${speed}`);
  }
});

clause(MASTER, "0:rule", "equally fast opposition (speed 6): X = 0, strength stays 1", () => {
  const { engine, id } = masterAttacks([mamFoe("b1", P2, 6)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "the HIGHEST speed in the opposing party counts: blockers of speed 2 and 4 give X = 2 (strength 3), whichever way round they are listed", () => {
  const a = masterAttacks([mamFoe("b1", P2, 2), mamFoe("b2", P2, 4)]);
  assert.equal(a.engine.getStat(a.id("ma"), "strength"), 3);
  const b = masterAttacks([mamFoe("b1", P2, 4), mamFoe("b2", P2, 2)]);
  assert.equal(b.engine.getStat(b.id("ma"), "strength"), 3);
  const c = masterAttacks([mamFoe("b1", P2, 1), mamFoe("b2", P2, 2), mamFoe("b3", P2, 5)]);
  assert.equal(c.engine.getStat(c.id("ma"), "strength"), 2, "three blockers: the speed-5 one counts");
});

clause(MASTER, "0:rule", "a faster opposing party makes X negative: the Master loses strength, never below 0 (CR 410.4)", () => {
  const { engine, id } = masterAttacks([mamFoe("b1", P2, 8)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 0, "1 + (6 - 8) = -1 stays at 0");
});

clause(MASTER, "0:rule", "a faster opposing party: the Master deals no damage at all (0 strength) to the blocker", () => {
  const blocker = mamFoe("b1", P2, 8, { life: 4, strength: 0 });
  const game = masterAttacks([blocker]);
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("b1")), 0);
});

clause(MASTER, "0:rule", "only the OPPOSING party counts: a fast ally in the Master's own party is ignored", () => {
  const { engine, id } = masterAttacks([mamFoe("b1", P2, 2)], { allies: [mamFoe("ally", P1, 9)] });
  assert.equal(engine.getStat(id("ma"), "strength"), 5, "6 - 2, not 6 - 9");
});

clause(MASTER, "0:rule", "characters not in the battle are ignored: a speed-9 bystander on either side does not change X", () => {
  const { engine, id } = masterAttacks([mamFoe("b1", P2, 2)], { extra: [mamFoe("bystander", P2, 9), mamFoe("mine", P1, 9)] });
  assert.equal(engine.getStat(id("ma"), "strength"), 5);
});

clause(MASTER, "0:rule", "also while BLOCKING: blocking a speed-3 attacker gives X = 3 (strength 4)", () => {
  const { engine, id } = masterBlocks([mamFoe("atk", P2, 3)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 4);
});

clause(MASTER, "0:rule", "blocking a party of speeds 1 and 5: the highest (5) counts, X = 1 (strength 2)", () => {
  const { engine, id } = masterBlocks([mamFoe("a1", P2, 1), mamFoe("a2", P2, 5)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 2);
});

clause(MASTER, "0:rule", "attacking UNBLOCKED there is no character in the opposing party: no bonus, the Master stays at 1 strength and deals exactly 1 damage (1 influence)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, mamFoe("slow", P2, 0)]
  });
  const before = influence(game.engine, P2);
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1, "before blockers are declared there is no opposing party");
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1, "an unblocked attacker faces no characters");
  autoResolveBattle(game.engine);
  assert.equal(before - influence(game.engine, P2), 1, "1 damage to the faction, not 7");
});

clause(MASTER, "0:rule", "attacking a LOCATION unblocked: no opposing party, so no bonus and exactly 1 damage to the location", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "loc", def: location({ name: "Fort", structure: 9 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")], { type: "card", cardId: game.id("loc") });
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("loc")), 1);
});

clause(MASTER, "0:rule", "if the only opposing character leaves the battle (destroyed in response) the bonus is gone: strength back to 1", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ma", def: printing(MASTER), owner: P1, zone: "play" },
      mamFoe("b1", P2, 2),
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 5, "control: the bonus applies while the blocker is there");
  playRaw(game.engine, P1, game.id("kill"), { selected: { t: [game.id("b1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard");
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1, "no character left in the opposing party");
});

clause(MASTER, "0:rule", "it uses the Master's CURRENT speed: a +1 speed boost raises X by one", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "boost", def: statTactic("speed", 1), owner: P1, zone: "hand" }, mamFoe("b1", P2, 2)]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 5);
  playRaw(game.engine, P1, game.id("boost"), { selected: { t: [game.id("ma")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getStat(game.id("ma"), "speed"), 7);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 6, "X = 7 - 2 = 5");
});

clause(MASTER, "0:rule", "it tracks the opposition's speed live: slowing the blocker by 1 raises the Master's strength by 1", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "slow", def: statTactic("speed", -1), owner: P1, zone: "hand" }, mamFoe("b1", P2, 3)]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 4, "6 - 3 = 3, plus 1");
  playRaw(game.engine, P1, game.id("slow"), { selected: { t: [game.id("b1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getStat(game.id("b1"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 5);
});

clause(MASTER, "0:rule", "the bonus is real battle damage: 5 strength (vs speed 2) kills a 5-life blocker before it can strike back", () => {
  const blocker = mamFoe("b1", P2, 2, { life: 5, strength: 9 });
  const game = masterAttacks([blocker]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard", "5 damage kills the 5-life blocker");
  assert.equal(zoneOf(game.engine, game.id("ma")), "play", "the faster Master struck first: it took no damage");
  assert.equal(damageOn(game.engine, game.id("ma")), 0);
});

clause(MASTER, "0:rule", "the bonus is exactly X: against a speed-2 blocker with 6 life, 5 damage does not kill it", () => {
  const game = masterAttacks([mamFoe("b1", P2, 2, { life: 6 })]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b1")), "play");
  assert.equal(damageOn(game.engine, game.id("b1")), 5);
});

clause(MASTER, "0:rule", "once the battle is over the bonus ends: back to strength 1", () => {
  const game = masterAttacks([mamFoe("b1", P2, 2)]);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "a Master in play but NOT in the battle gets nothing (another character of mine attacks and is blocked)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, mamFoe("ally", P1, 3), mamFoe("b1", P2, 2)]
  });
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "two Masters facing each other are equally fast: X = 0, both stay at strength 1", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "ma2", def: printing(MASTER), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("ma2")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("ma2"), "strength"), 1);
});

clause(MASTER, "0:rule", "deploys for exactly 4 with [D][D] (one short or one icon short is refused) and has the printed 1/3/6 stats", () => {
  const exact = deployChecks(rogueMake(MASTER), 4, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [1, 3, 6]);
  assert.deepEqual(subtypesOf(exact.engine, exact.id("me")), ["martial artist"]);
});

// =============================================================================
// Master Thief
// If this card is destroyed, you may pick a non-tactic card in your opponent's
// discard pile. If you do, put it into play under your control.
// Character (rogue, thief), cost 8, threshold [D][D][D], 4 str / 4 spd / 3 life.
// =============================================================================

const MASTER_THIEF = "94abdced-81ec-4f6e-bf99-cd6d9d5b87fe";

const loot = {
  char: { key: "lootChar", def: character({ name: "LootChar", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "discard" } as CardPlacement,
  item: { key: "lootItem", def: item({ name: "LootItem" }), owner: P2, zone: "discard" } as CardPlacement,
  place: { key: "lootPlace", def: location({ name: "LootPlace", structure: 3 }), owner: P2, zone: "discard" } as CardPlacement,
  staple: { key: "lootStaple", def: resourceCard({ name: "LootStaple" }), owner: P2, zone: "discard" } as CardPlacement,
  spell: { key: "lootSpell", def: tactic({ name: "LootSpell", cost: 1, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } }), owner: P2, zone: "discard" } as CardPlacement
};

function heistBoard(opts: { extra?: CardPlacement[]; theirs?: boolean; withLoot?: boolean } = {}) {
  const lootCards = opts.withLoot === false ? [] : Object.values(loot);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.theirs ? 2 : 1,
    activePlayerId: opts.theirs ? P2 : P1,
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: opts.theirs ? P2 : P1, zone: "hand" },
      ...lootCards,
      { key: "myDisc", def: character({ name: "MyDiscard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "TheirHand" }), owner: P2, zone: "hand" },
      { key: "theirDeck", def: character({ name: "TheirDeck" }), owner: P2, zone: "deck" },
      { key: "theirPlay", def: character({ name: "TheirPlay" }), owner: P2, zone: "play" },
      ...fillers("m", 3, P1, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Destroys the Master Thief with the Kill tactic; stops at the controller's pick. */
function killThief(game: ReturnType<typeof heistBoard>, theirs = false) {
  play(game.engine, theirs ? P2 : P1, game.id("kill"), { selected: { t: [game.id("mt")] } });
}

const heistPick = (engine: SpoilsEngine, selected: CardInstanceId[]) => answerPending(engine, "chooserSelectsTarget", { selected });

clause(MASTER_THIEF, "0:rule", "destroyed: I may pick a character in the opponent's discard pile and it enters play under MY control (I am the chooser)", () => {
  const game = heistBoard();
  killThief(game);
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: the Thief is destroyed");
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootChar")), P1);
  assert.equal(game.engine.state.cards[game.id("lootChar")].ownerId, P2, "ownership never changes");
  assert.ok(game.engine.state.players[P1].play.includes(game.id("lootChar")), "it is in my play area");
  assert.equal(pending(game.engine), undefined);
});

clause(MASTER_THIEF, "0:rule", "...a non-tactic ITEM works too, under my control", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "...a non-tactic LOCATION works too, under my control", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootPlace")]);
  assert.equal(zoneOf(game.engine, game.id("lootPlace")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootPlace")), P1);
});

clause(MASTER_THIEF, "0:rule", "...and a RESOURCE card (also a non-tactic): it enters play under my control as a real resource I can pay with", () => {
  const game = heistBoard();
  const before = ready(game.engine);
  killThief(game);
  heistPick(game.engine, [game.id("lootStaple")]);
  assert.equal(zoneOf(game.engine, game.id("lootStaple")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootStaple")), P1);
  assert.equal(game.engine.isResource(game.id("lootStaple")), true);
  assert.equal(ready(game.engine) - before, 1, "it provides a resource I can pay with");
});

clause(MASTER_THIEF, "0:rule", "a TACTIC in their discard pile cannot be picked (control: a non-tactic in the same pile can)", () => {
  const game = heistBoard();
  killThief(game);
  refused(() => heistPick(game.engine, [game.id("lootSpell")]), "tactics are excluded by 'non-tactic'");
  assert.equal(zoneOf(game.engine, game.id("lootSpell")), "discard");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "play");
});

clause(MASTER_THIEF, "0:rule", "only THEIR discard pile: my own discard pile, their hand, their deck, their cards in play and my cards in play cannot be picked", () => {
  const game = heistBoard();
  killThief(game);
  for (const key of ["myDisc", "theirHand", "theirDeck", "theirPlay", "mt"]) {
    refused(() => heistPick(game.engine, [game.id(key)]), `${key} is not in their discard pile`);
  }
  refused(() => heistPick(game.engine, [factionOf(game.engine, P2)]), "their faction is not in their discard pile");
  assert.equal(zoneOf(game.engine, game.id("myDisc")), "discard");
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "play", "control: a card of their discard pile is accepted");
});

clause(MASTER_THIEF, "0:rule", "'you may': declining takes nothing and leaves their discard pile untouched", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, []);
  assert.equal(pending(game.engine), undefined);
  for (const key of ["lootChar", "lootItem", "lootPlace", "lootStaple", "lootSpell"]) assert.equal(zoneOf(game.engine, game.id(key)), "discard", key);
  assert.equal(game.engine.state.players[P1].play.filter((c) => c === game.id("lootChar")).length, 0);
});

clause(MASTER_THIEF, "0:rule", "'a ... card': exactly one card is taken; two picks are refused and then one is accepted", () => {
  const game = heistBoard();
  killThief(game);
  refused(() => heistPick(game.engine, [game.id("lootChar"), game.id("lootItem")]), "one card only");
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard", "the other stays");
});

clause(MASTER_THIEF, "0:rule", "the Master Thief itself ends in my discard pile (it is the destroyed card), not in play, and I keep the rest of my board", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootChar")]);
  assert.ok(discardOf(game.engine, P1).includes(game.id("mt")), "discardOf(game.engine, P1).includes(game.id(\"mt\"))");
  assert.equal(zoneOf(game.engine, game.id("theirPlay")), "play", "their board is untouched");
});

clause(MASTER_THIEF, "0:rule", "nothing eligible in their discard pile: no prompt and nothing happens", () => {
  const game = heistBoard({ withLoot: false });
  killThief(game);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard");
  assert.equal(discardOf(game.engine, P2).length, 0);
});

clause(MASTER_THIEF, "0:rule", "only tactics in their discard pile: nothing can be picked and no prompt appears", () => {
  const game = heistBoard({ withLoot: false, extra: [loot.spell] });
  killThief(game);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootSpell")), "discard");
});

clause(MASTER_THIEF, "0:rule", "the opponent destroying it triggers it just the same: I (its controller) still choose, and the card comes to me", () => {
  const game = heistBoard({ theirs: true });
  killThief(game, true);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller chooses");
  refused(() => pickRaw(game.engine, [game.id("lootItem")], P2), "the opponent cannot make my choice");
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(controllerOf(game.engine, game.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "'you' / 'your opponent' follow CONTROL: a Thief I own but my opponent controls lets THEM take from MY discard pile", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, controller: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      { key: "myDisc", def: character({ name: "MyDiscard" }), owner: P1, zone: "discard" },
      { key: "theirDisc", def: character({ name: "TheirDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: destroyed, into its owner's discard pile");
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "its controller (P2) chooses");
  refused(() => heistPick(game.engine, [game.id("theirDisc")]), "the controller's own discard pile is not 'your opponent's'");
  heistPick(game.engine, [game.id("myDisc")]);
  assert.equal(zoneOf(game.engine, game.id("myDisc")), "play");
  assert.equal(controllerOf(game.engine, game.id("myDisc")), P2, "it enters play under the Thief controller's control");
});

clause(MASTER_THIEF, "0:rule", "destroyed in BATTLE too: blocking a big attacker kills it, and the trigger still fires for its controller", () => {
  const fightGame = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Brute", strength: 9, life: 9, speed: 9 }), owner: P2, zone: "play" },
      loot.item
    ]
  });
  declareAttackBy(fightGame.engine, P2, [fightGame.id("atk")]);
  fightGame.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [fightGame.id("mt")] });
  autoResolveBattle(fightGame.engine);
  assert.equal(zoneOf(fightGame.engine, fightGame.id("mt")), "discard", "control: the Thief died in battle");
  const pc = pending(fightGame.engine)!;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  heistPick(fightGame.engine, [fightGame.id("lootItem")]);
  assert.equal(controllerOf(fightGame.engine, fightGame.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "destroyed by lethal damage from a damage effect (not a destroy effect) also triggers it", () => {
  const game = heistBoard({ extra: [{ key: "smite", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("smite"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: 3 damage kills the 3-life Thief");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(controllerOf(game.engine, game.id("lootChar")), P1);
});

clause(MASTER_THIEF, "0:rule", "leaving play any way other than being destroyed does not trigger it: returned to my hand", () => {
  const game = heistBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "hand", "control: bounced");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
});

clause(MASTER_THIEF, "0:rule", "...removed from the game does not trigger it either", () => {
  const exile = tactic({
    name: "Exile",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
  const game = heistBoard({ extra: [{ key: "exile", def: exile, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("exile"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "removed", "control: removed from the game");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
});

clause(MASTER_THIEF, "0:rule", "a Thief that is only a face-down resource is not 'this card destroyed': destroying it triggers nothing", () => {
  const wipe = tactic({
    name: "WipeResource",
    cost: 0,
    behavior: { abilities: [{ id: "w", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play", faceDown: true },
      { key: "wipe", def: wipe, owner: P1, zone: "hand" },
      loot.item
    ]
  });
  play(game.engine, P1, game.id("wipe"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: destroyed");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard");
});

clause(MASTER_THIEF, "0:rule", "the picked card genuinely enters play: its own 'when this enters play' ability fires for me", () => {
  const etb = character({
    name: "LootEtb",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const game = heistBoard({ withLoot: false, extra: [{ key: "lootEtb", def: etb, owner: P2, zone: "discard" }] });
  killThief(game);
  const handBefore = handOf(game.engine, P1).length;
  heistPick(game.engine, [game.id("lootEtb")]);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("lootEtb")), "play");
  assert.equal(handOf(game.engine, P1).length, handBefore + 1, "its 'when this enters play, draw' resolved for me");
  assert.equal(handOf(game.engine, P2).length, 1, "the opponent drew nothing (their only hand card is the one we placed)");
});

clause(MASTER_THIEF, "0:rule", "deploys for exactly 8 with [D][D][D] (one short or one icon short is refused) and has the printed 4/3/4 stats", () => {
  const exact = deployChecks(rogueMake(MASTER_THIEF), 8, 3);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [4, 3, 4]);
  assert.deepEqual(subtypesOf(exact.engine, exact.id("me")), ["thief"]);
});

// =============================================================================
// Orgy Den Smoke Out
// Your opponent discards a card at random. Put the top 2 cards of their deck
// into their discard pile.
// Tactic (rogue), cost 2, threshold [D][D].
// =============================================================================

const SMOKE_OUT = "e6a43a11-e448-42fa-a45a-856116077af9";

function smokeBoard(opts: HandOpts & { oppHand?: number; oppDeck?: number } = {}) {
  return handBoard(SMOKE_OUT, {
    deception: 14,
    ...opts,
    extra: [
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      ...fillers("o", opts.oppDeck ?? 6, P2, "deck"),
      ...fillers("m", 3, P1, "deck"),
      { key: "myOther", def: character({ name: "MyOther" }), owner: P1, zone: "hand" },
      { key: "oppPlay", def: character({ name: "OppInPlay" }), owner: P2, zone: "play" },
      { key: "oppOldDisc", def: character({ name: "OppOldDiscard" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

const oppHandIds = (engine: SpoilsEngine) => [...handOf(engine, P2)];

clause(SMOKE_OUT, "0:rule", "the opponent discards exactly one card from their hand, into THEIR discard pile", () => {
  const { engine, id } = smokeBoard();
  const hand = oppHandIds(engine);
  play(engine, P1, id("me"), { selected: { pool: hand } });
  assert.equal(handOf(engine, P2).length, 2, "one card left their hand");
  const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
  assert.equal(gone.length, 1);
  assert.equal(zoneOf(engine, gone[0]), "discard");
  assert.ok(discardOf(engine, P2).includes(gone[0]), "discardOf(engine, P2).includes(gone[0])");
  assert.equal(discardOf(engine, P1).filter((c) => c !== id("me")).length, 0, "nothing of mine was discarded");
});

clause(SMOKE_OUT, "0:rule", "it is RANDOM: with different random results each of their three cards is the one discarded", () => {
  const discarded = new Set<number>();
  for (const value of [0.0, 0.34, 0.5, 0.67, 0.99]) {
    const { engine, id } = smokeBoard({ random: () => value });
    const hand = oppHandIds(engine);
    play(engine, P1, id("me"), { selected: { pool: hand } });
    const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
    assert.equal(gone.length, 1, `random ${value}`);
    discarded.add(hand.indexOf(gone[0]));
  }
  assert.deepEqual([...discarded].sort(), [0, 1, 2], "every card of their hand can be the one discarded");
});

clause(SMOKE_OUT, "0:rule", "the same random value always discards the same card (the pick is driven by the game's random source, not by a choice)", () => {
  const picks: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const { engine, id } = smokeBoard({ random: () => 0.5 });
    const hand = oppHandIds(engine);
    play(engine, P1, id("me"), { selected: { pool: hand } });
    picks.push(hand.findIndex((c) => !handOf(engine, P2).includes(c)));
  }
  assert.ok(picks[0] >= 0, "picks[0] >= 0");
  assert.deepEqual(picks, [picks[0], picks[0], picks[0]]);
});

clause(SMOKE_OUT, "0:rule", "the caster does not choose the pool: played with no cards named, a random card of their whole hand is still discarded", () => {
  const { engine, id } = smokeBoard({ random: () => 0.5 });
  play(engine, P1, id("me"), { selected: {} });
  assert.equal(handOf(engine, P2).length, 2, "one card was discarded even though I named none");
});

clause(SMOKE_OUT, "0:rule", "the caster cannot narrow the random pool: naming only one of their cards still discards a random card of the WHOLE hand", () => {
  const seen = new Set<number>();
  for (const value of [0.0, 0.5, 0.99]) {
    const { engine, id } = smokeBoard({ random: () => value });
    const hand = oppHandIds(engine);
    play(engine, P1, id("me"), { selected: { pool: [hand[0]] } });
    const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
    assert.equal(gone.length, 1);
    seen.add(hand.indexOf(gone[0]));
  }
  assert.ok(seen.size > 1, "the card discarded varies with the random result, whatever I named");
});

clause(SMOKE_OUT, "0:rule", "the opponent does not choose: they get no prompt for the discard (nor does the caster)", () => {
  const { engine, id } = smokeBoard();
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.equal(pending(engine), undefined);
});

clause(SMOKE_OUT, "0:rule", "then the top 2 cards of their deck go to their discard pile: exactly those two, the rest of the deck stays in order", () => {
  const { engine, id } = smokeBoard();
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2), "the rest of the deck, in order");
  for (const cardId of oppDeck.slice(0, 2)) assert.equal(zoneOf(engine, cardId), "discard");
  assert.equal(discardOf(engine, P2).length, 4, "1 old + 1 discarded from hand + 2 from the deck");
});

clause(SMOKE_OUT, "0:rule", "the discarded card is from their HAND, never from the milled cards: their hand is exactly one card smaller and the deck exactly two", () => {
  const { engine, id } = smokeBoard();
  const hand = oppHandIds(engine);
  play(engine, P1, id("me"), { selected: { pool: hand } });
  assert.equal(handOf(engine, P2).length, hand.length - 1);
  assert.equal(deckOf(engine, P2).length, 4);
});

clause(SMOKE_OUT, "0:rule", "the milled cards come from the top of the deck even when the hand discard varies (different random results, same two milled)", () => {
  for (const value of [0.0, 0.99]) {
    const { engine, id } = smokeBoard({ random: () => value });
    const oppDeck = [...deckOf(engine, P2)];
    play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
    assert.deepEqual(oppDeck.slice(0, 2).map((c) => zoneOf(engine, c)), ["discard", "discard"], `random ${value}`);
    assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2));
  }
});

clause(SMOKE_OUT, "0:rule", "an empty opposing hand: nothing to discard, but the 2 cards are still put into their discard pile", () => {
  const { engine, id } = smokeBoard({ oppHand: 0 });
  play(engine, P1, id("me"), { selected: {} });
  assert.equal(discardOf(engine, P2).length, 3, "1 old + 2 milled");
  assert.equal(deckOf(engine, P2).length, 4);
  assert.equal(pending(engine), undefined);
});

clause(SMOKE_OUT, "0:rule", "a one-card hand is discarded for sure", () => {
  const { engine, id } = smokeBoard({ oppHand: 1 });
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(discardOf(engine, P2).length, 4);
});

clause(SMOKE_OUT, "0:rule", "a deck of 1 card: only that card is put into the discard pile; an empty deck is harmless", () => {
  const one = smokeBoard({ oppDeck: 1 });
  play(one.engine, P1, one.id("me"), { selected: { pool: oppHandIds(one.engine) } });
  assert.equal(deckOf(one.engine, P2).length, 0);
  assert.equal(discardOf(one.engine, P2).length, 3, "1 old + 1 from hand + the 1-card deck");
  const none = smokeBoard({ oppDeck: 0 });
  play(none.engine, P1, none.id("me"), { selected: { pool: oppHandIds(none.engine) } });
  assert.equal(discardOf(none.engine, P2).length, 2, "1 old + 1 from hand");
  assert.equal(pending(none.engine), undefined);
});

clause(SMOKE_OUT, "0:rule", "my own hand, deck and discard pile are untouched (only the opponent loses cards), and their cards in play stay", () => {
  const { engine, id } = smokeBoard();
  const myDeck = [...deckOf(engine, P1)];
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.equal(zoneOf(engine, id("myOther")), "hand");
  assert.deepEqual(discardOf(engine, P1), [id("me")], "only the tactic itself");
  assert.equal(zoneOf(engine, id("oppPlay")), "play");
  assert.equal(zoneOf(engine, id("oppOldDisc")), "discard");
});

clause(SMOKE_OUT, "0:rule", "my own cards and their cards in play are never the ones discarded: naming them changes nothing, a card of the OPPONENT's hand goes", () => {
  const { engine, id } = smokeBoard();
  play(engine, P1, id("me"), { selected: { pool: [id("myOther"), id("oppPlay")] } });
  assert.equal(zoneOf(engine, id("myOther")), "hand", "my hand card stays");
  assert.equal(zoneOf(engine, id("oppPlay")), "play", "their card in play stays");
  assert.equal(handOf(engine, P2).length, 2, "one of the opponent's three hand cards was discarded");
});

clause(SMOKE_OUT, "0:rule", "a tactic played in response: it works at instant speed on the opponent's turn too (their hand discards, their deck mills)", () => {
  const game = smokeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  openDefenderWindow(game.engine, game.id("atk"));
  const hand = oppHandIds(game.engine);
  const oppDeck = [...deckOf(game.engine, P2)];
  playRaw(game.engine, P1, game.id("me"), { selected: { pool: hand } });
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, hand.length - 1);
  assert.deepEqual(deckOf(game.engine, P2), oppDeck.slice(2));
});

clause(SMOKE_OUT, "0:rule", "deploys for exactly 2 with [D][D] (one short or one icon short is refused); the tactic ends in my discard pile", () => {
  const exact = deployChecks(
    (res) => smokeBoard({ deception: res.own, greed: res.wrong }),
    2,
    2,
    (id) => ({ pool: [id("oh0"), id("oh1"), id("oh2")] })
  );
  assert.equal(zoneOf(exact.engine, exact.id("me")), "discard");
});

// =============================================================================
// Scrag
// COST: Pick a character. X is its life.
// EFFECT: If your opponent has at least X cards in their discard pile, destroy
// the character.
// Tactic (rogue), cost 2, threshold [D][D].
// =============================================================================

const SCRAG = "a41131b1-d9ab-404b-bd55-1fa9d9c77dcf";

function scragBoard(opts: { oppDiscard?: number; myDiscard?: number; deception?: number; greed?: number; foeLife?: number; foeDamage?: number; mixed?: boolean; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  const mixedDef = (i: number) => (i % 3 === 0 ? tactic({ name: `Dis${i}` }) : i % 3 === 1 ? item({ name: `Dis${i}` }) : character({ name: `Dis${i}` }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sg", def: printing(SCRAG), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: opts.foeLife ?? 3 }), owner: P2, zone: "play", damage: opts.foeDamage ?? 0 },
      { key: "bystander", def: character({ name: "Bystander", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", life: 3 }), owner: P2, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc", life: 3 }), owner: P2, zone: "discard" },
      ...fillers("od", opts.oppDiscard ?? 0, P2, "discard", opts.mixed ? mixedDef : undefined),
      ...fillers("md", opts.myDiscard ?? 0, P1, "discard"),
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

// "inDisc" is also in the opponent's discard pile, so it counts as one card there: oppDiscard N means N + 1 cards in all.
const SCRAG_BASE = 1;

for (const [discard, destroyed] of [
  [0, false],
  [1, false],
  [2, true],
  [3, true],
  [8, true]
] as const) {
  clause(SCRAG, "0:ability", `a life-3 character with ${discard + SCRAG_BASE} cards in the opponent's discard pile is ${destroyed ? "destroyed (at least X = 3)" : "not destroyed (fewer than X = 3)"}; the cost of 2 is paid either way`, () => {
    const { engine, id } = scragBoard({ oppDiscard: discard });
    assert.equal(discardOf(engine, P2).length, discard + SCRAG_BASE, "setup: the opponent's discard pile size");
    const before = ready(engine);
    play(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid either way");
    assert.equal(zoneOf(engine, id("foe")), destroyed ? "discard" : "play");
    assert.equal(zoneOf(engine, id("sg")), "discard", "the tactic ends in its owner's discard pile");
    assert.ok(discardOf(engine, P1).includes(id("sg")), "...which is mine");
    assert.equal(zoneOf(engine, id("bystander")), "play", "an unpicked character is untouched");
    assert.equal(zoneOf(engine, id("mine")), "play");
    assert.equal(pending(engine), undefined);
  });
}

clause(SCRAG, "0:ability", "X depends on the picked character's life: a life-1 character falls to 1 card, a life-5 one needs 5", () => {
  const one = scragBoard({ foeLife: 1, oppDiscard: 0 });
  play(one.engine, P1, one.id("sg"), { selected: { c: [one.id("foe")] } });
  assert.equal(zoneOf(one.engine, one.id("foe")), "discard", "X = 1 and the opponent has 1 card");
  const fiveMiss = scragBoard({ foeLife: 5, oppDiscard: 3 });
  play(fiveMiss.engine, P1, fiveMiss.id("sg"), { selected: { c: [fiveMiss.id("foe")] } });
  assert.equal(zoneOf(fiveMiss.engine, fiveMiss.id("foe")), "play", "X = 5 and the opponent has 4");
  const fiveHit = scragBoard({ foeLife: 5, oppDiscard: 4 });
  play(fiveHit.engine, P1, fiveHit.id("sg"), { selected: { c: [fiveHit.id("foe")] } });
  assert.equal(zoneOf(fiveHit.engine, fiveHit.id("foe")), "discard", "X = 5 and the opponent has 5");
});

clause(SCRAG, "0:ability", "counts every kind of card in the opponent's discard pile, not only characters", () => {
  const hit = scragBoard({ oppDiscard: 2, mixed: true });
  play(hit.engine, P1, hit.id("sg"), { selected: { c: [hit.id("foe")] } });
  assert.equal(zoneOf(hit.engine, hit.id("foe")), "discard", "a tactic, an item and a character make 3 cards");
  const miss = scragBoard({ oppDiscard: 1, mixed: true });
  play(miss.engine, P1, miss.id("sg"), { selected: { c: [miss.id("foe")] } });
  assert.equal(zoneOf(miss.engine, miss.id("foe")), "play");
});

clause(SCRAG, "0:ability", "only the OPPONENT's discard pile counts: a big discard pile of your own does not help", () => {
  const { engine, id } = scragBoard({ oppDiscard: 1, myDiscard: 9 });
  play(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play", "the opponent has only 2 < 3");
});

clause(SCRAG, "0:ability", "X is the character's life, not its remaining life: damage on it does not lower X", () => {
  const survive = scragBoard({ foeLife: 5, foeDamage: 3, oppDiscard: 3 });
  play(survive.engine, P1, survive.id("sg"), { selected: { c: [survive.id("foe")] } });
  assert.equal(zoneOf(survive.engine, survive.id("foe")), "play", "X = 5 and the opponent has 4: survives even with 3 damage on it");
  const die = scragBoard({ foeLife: 5, foeDamage: 3, oppDiscard: 4 });
  play(die.engine, P1, die.id("sg"), { selected: { c: [die.id("foe")] } });
  assert.equal(zoneOf(die.engine, die.id("foe")), "discard", "X = 5 and the opponent has 5");
});

clause(SCRAG, "0:ability", "X is the character's current life, including bonuses it has", () => {
  const lifeGear = item({
    name: "Life Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "life", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 2 }] }] }
  });
  const board = (oppDiscard: number) =>
    scragBoard({
      oppDiscard,
      extra: [{ key: "gear", def: lifeGear, owner: P2, zone: "play", attachedToKey: "foe" }]
    });
  const four = board(3);
  assert.equal(four.engine.getStat(four.id("foe"), "life"), 5, "the gear works");
  play(four.engine, P1, four.id("sg"), { selected: { c: [four.id("foe")] } });
  assert.equal(zoneOf(four.engine, four.id("foe")), "play", "X = 5 with 4 cards: survives (printed life 3 would have died)");
  const five = board(4);
  play(five.engine, P1, five.id("sg"), { selected: { c: [five.id("foe")] } });
  assert.equal(zoneOf(five.engine, five.id("foe")), "discard", "X = 5 with 5 cards");
});

clause(SCRAG, "0:ability", "any character can be picked, including one of your own", () => {
  const { engine, id } = scragBoard({ oppDiscard: 2 });
  play(engine, P1, id("sg"), { selected: { c: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", "life 3 with 3 cards in the opponent's discard pile");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(SCRAG, "0:ability", "the picked card must be a character in play: an item, a location, a face-down card, a faction, and characters in hand or in a discard pile are refused", () => {
  const { engine, id } = scragBoard({ oppDiscard: 5 });
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("sg"), { selected: { c: [cardId] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(id("faceDown")), "a face-down card");
  refused(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  refused(attempt(engine.state.players[P1].factionId!), "your faction");
  refused(attempt(id("inHand")), "a character in their hand");
  refused(attempt(id("inDisc")), "a character in their discard pile");
  refused(() => playRaw(engine, P1, id("sg"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(engine, P1, id("sg"), { selected: { c: [id("foe"), id("mine")] } }), "two characters");
  assert.equal(zoneOf(engine, id("sg")), "hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(SCRAG, "0:ability", "is refused one resource short of its cost of 2, and without [D][D]; exactly [D][D] works and leaves nothing", () => {
  const short = scragBoard({ oppDiscard: 3, deception: 0, extra: [...bank("deception", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("sg"), { selected: { c: [short.id("foe")] } }), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("sg")), "hand");

  const oneD = scragBoard({ oppDiscard: 3, deception: 1, greed: 5 });
  refused(() => playRaw(oneD.engine, P1, oneD.id("sg"), { selected: { c: [oneD.id("foe")] } }), "only one [D]", /Threshold requirements are not met/);

  const exact = scragBoard({ oppDiscard: 3, deception: 2 });
  play(exact.engine, P1, exact.id("sg"), { selected: { c: [exact.id("foe")] } });
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "[D][D] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(SCRAG, "0:ability", "the destroy condition is checked when the tactic resolves: a response that adds a card to their discard pile (their own tactic) makes it reach X", () => {
  const { engine, id } = scragBoard({ oppDiscard: 1, extra: [{ key: "cantrip", def: freeDrawTactic(), owner: P2, zone: "hand" }, ...fillers("deck", 3, P2, "deck")] });
  assert.equal(discardOf(engine, P2).length, 2, "setup: 2 cards, X = 3");
  playRaw(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent can respond");
  playRaw(engine, P2, id("cantrip"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cantrip")), "discard", "their tactic landed in their discard pile");
  assert.equal(zoneOf(engine, id("foe")), "discard", "3 >= X = 3 at resolution");
});

clause(SCRAG, "0:ability", "a picked character destroyed in response simply stays gone: Scrag still resolves without error and nothing else is destroyed", () => {
  const { engine, id } = scragBoard({ oppDiscard: 5, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("sg")), "discard");
  assert.equal(pending(engine), undefined);
});

clause(SCRAG, "0:ability", "X is fixed by the cost: a response that raises the picked character's life afterwards does not change X", () => {
  const grow = statTactic("life", 4, "Grow");
  const { engine, id } = scragBoard({ oppDiscard: 2, deception: 2, extra: [{ key: "grow", def: grow, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("grow"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "life"), 7, "setup: the response raised the life to 7");
  assert.equal(zoneOf(engine, id("foe")), "discard", "X was fixed at 3 when the cost was paid, and the opponent has 3 cards in their discard pile");
});

clause(SCRAG, "0:ability", "it is a tactic: played at instant speed against an attacker, the destroyed attacker leaves the battle", () => {
  const game = scragBoard({
    oppDiscard: 2,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 3, speed: 3 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(game.engine, game.id("atk"));
  playRaw(game.engine, P1, game.id("sg"), { selected: { c: [game.id("atk")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
  assert.equal(zoneOf(game.engine, game.id("sg")), "discard");
  assert.equal(influence(game.engine, P1), 30, "the faction took no damage: the attacker is gone");
});

clause(SCRAG, "0:ability", "deploys for exactly 2 with [D][D] and ends in my discard pile (a tactic never enters play)", () => {
  const exact = deployChecks(
    (res) => scragBoard({ deception: res.own, greed: res.wrong }),
    2,
    2,
    (id) => ({ c: [id("foe")] }),
    "sg"
  );
  assert.equal(zoneOf(exact.engine, exact.id("sg")), "discard");
});

// =============================================================================
// Sudden Osprey
// You may play this card whenever you could play a tactic.
// When this card enters play, you may pick a character. If you do, it gains 1
// strength and 1 life this turn.
// Character (rogue, beast), cost 2, threshold [D][D], 1 str / 3 spd / 2 life.
// =============================================================================

const OSPREY = "0ca8f5d5-6473-4bfc-bf16-f38d8e2b83a0";
const VACATION = "4181e922-7ffb-4c71-aef6-17adf4f006c7";

function ospreyBoard(opts: { deception?: number; greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "bird", def: printing(OSPREY), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "tac", def: noopTactic("MyNoop"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "theirTac", def: noopTactic("TheirNoop"), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the open optional pick with `selected` (empty = decline) and drains the window. */
function answerPick(engine: SpoilsEngine, player: Pid, selected: string[]) {
  const pc = pending(engine);
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

/** The opponent plays a tactic on their turn, which gives P1 (the responder) a response window. */
function opponentOpensWindow(board: ReturnType<typeof ospreyBoard>) {
  const { engine, id } = board;
  playRaw(engine, P2, id("theirTac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "setup: P1 may respond");
}

clause(OSPREY, "0:rule", "can be played on the opponent's turn in response to their tactic, for its cost of 2, and it enters play under your control", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  opponentOpensWindow(board);
  const before = ready(engine);
  playRaw(engine, P1, id("bird"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play", "the character is in play");
  assert.equal(controllerOf(engine, id("bird")), P1);
  assert.ok(engine.state.players[P1].play.includes(id("bird")), "engine.state.players[P1].play.includes(id(\"bird\"))");
});

clause(OSPREY, "0:rule", "a character without TACTICAL cannot be played in that same window (control), nor can anything be played on the opponent's turn with no window open", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  refused(() => playRaw(engine, P1, id("bird")), "no window is open on the opponent's turn: not even a tactic could be played", /Only the active player may deploy/);
  refused(() => playRaw(engine, P1, id("tac")), "control: a tactic cannot be played now either", /Only the active player may deploy/);
  opponentOpensWindow(board);
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary character cannot be deployed in a response window");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  playRaw(engine, P1, id("tac"));
  assert.ok(zoneOf(engine, id("tac")) === "deploying" || zoneOf(engine, id("tac")) === "discard", "control: a tactic can be");
});

clause(OSPREY, "0:rule", "can be played in response to the opponent's attack, and the new character can then block that attack", () => {
  const { engine, id } = ospreyBoard({ turn: 2, active: P2 });
  openDefenderWindow(engine, id("foe"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "setup: I hold priority in the declaration window");
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("bird")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("bird")], "the Osprey blocks");
});

clause(OSPREY, "0:rule", "can be played in the battle's response windows after blockers are declared", () => {
  const { engine, id } = ospreyBoard({ turn: 2, active: P2 });
  declareAttackBy(engine, P2, [id("foe")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine")] });
  passUntil(engine, P1);
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play");
});

clause(OSPREY, "0:rule", "can be played in the attacker's own declaration window on your turn (you could play a tactic there)", () => {
  const { engine, id } = ospreyBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "setup: the attacker holds priority");
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play");
});

clause(OSPREY, "0:rule", "can be played in response to the opponent announcing the end of their turn", () => {
  const { engine, id } = ospreyBoard({ turn: 2, active: P2 });
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "setup: I may respond to the end of turn");
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary character cannot be deployed here", /Only tactics or TACTICAL cards may be deployed as responses/);
  playRaw(engine, P1, id("bird"));
  assert.equal(zoneOf(engine, id("bird")), "deploying");
  resolvePendingResponses(engine);
  if (pending(engine)) drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("bird")), "play", "the Osprey entered play before the turn ended");
});

clause(OSPREY, "0:rule", "can still be played on your own turn like any character, paying its cost", () => {
  const { engine, id } = ospreyBoard();
  const before = ready(engine);
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play");
  assert.equal(before - ready(engine), 2);
});

clause(OSPREY, "0:rule", "keeps its cost and threshold when played as a response: refused one resource short and without [D][D]", () => {
  const short = ospreyBoard({ turn: 2, active: P2, deception: 1 });
  opponentOpensWindow(short);
  refused(() => playRaw(short.engine, P1, short.id("bird")), "one resource");
  assert.equal(zoneOf(short.engine, short.id("bird")), "hand");
  const oneD = ospreyBoard({ turn: 2, active: P2, deception: 1, greed: 5 });
  opponentOpensWindow(oneD);
  refused(() => playRaw(oneD.engine, P1, oneD.id("bird")), "only one [D]", /Threshold requirements are not met/);
  const exact = ospreyBoard({ turn: 2, active: P2, deception: 2 });
  opponentOpensWindow(exact);
  playRaw(exact.engine, P1, exact.id("bird"));
  assert.equal(zoneOf(exact.engine, exact.id("bird")), "deploying", "[D][D] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(OSPREY, "0:rule", "the opponent can respond to the Osprey like any played card (it waits in the response window before entering play)", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  opponentOpensWindow(board);
  playRaw(engine, P1, id("bird"));
  assert.equal(zoneOf(engine, id("bird")), "deploying", "not yet in play while it waits for responses");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to it");
});

clause(OSPREY, "0:rule", "'whenever you could play a tactic': once Tactician Vacation has closed the tactic window this turn, the Osprey cannot be played in a response window, but still can in your own main phase", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "vac", def: printing(VACATION), owner: P1, zone: "hand" },
      { key: "birdMine", def: printing(OSPREY), owner: P1, zone: "hand" },
      { key: "birdTheirs", def: printing(OSPREY), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1),
      ...bank("deception", 2, P1),
      ...bank("deception", 4, P2)
    ]
  });
  play(engine, P1, id("vac"));
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "setup: the opponent has a response window");
  refused(() => playRaw(engine, P2, id("birdTheirs")), "tactics are closed this turn, and so are 'whenever you could play a tactic' windows");
  assert.equal(zoneOf(engine, id("birdTheirs")), "hand");
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  play(engine, P1, id("birdMine"));
  if (pending(engine)) answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("birdMine")), "play", "it can still be played at the time it normally could (own main phase)");
});

clause(OSPREY, "0:rule", "has its printed stats 1 strength / 3 speed / 2 life and the beast subtype once in play", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.deepEqual(stats(engine, id("bird")), [1, 2, 3]);
  assert.deepEqual(subtypesOf(engine, id("bird")), ["beast"]);
});

clause(OSPREY, "1:rule", "when it enters play you may pick a character: that character gains exactly +1 strength and +1 life (not speed), and nobody else does", () => {
  for (const pickKey of ["mine", "foe"] as const) {
    const { engine, id } = ospreyBoard();
    play(engine, P1, id("bird"));
    const pc = pending(engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", "a pick is offered");
    assert.equal(pc.playerId, P1, "its controller picks");
    answerPick(engine, P1, [id(pickKey)]);
    const unpicked = pickKey === "mine" ? "foe" : "mine";
    assert.equal(engine.getStat(id(pickKey), "strength"), 3, `${pickKey} strength`);
    assert.equal(engine.getStat(id(pickKey), "life"), 4, `${pickKey} life`);
    assert.equal(engine.getStat(id(pickKey), "speed"), 2, `${pickKey} speed unchanged`);
    assert.equal(engine.getStat(id(unpicked), "strength"), 2, `${unpicked} strength unchanged`);
    assert.equal(engine.getStat(id(unpicked), "life"), 3, `${unpicked} life unchanged`);
    assert.equal(engine.getStat(id("bird"), "strength"), 1, "the Osprey itself is unchanged when it picked another");
    assert.equal(engine.getStat(id("bird"), "life"), 2);
  }
});

clause(OSPREY, "1:rule", "the Osprey itself is a character in play when the trigger resolves, so it can pick itself", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("bird")]);
  assert.equal(engine.getStat(id("bird"), "strength"), 2);
  assert.equal(engine.getStat(id("bird"), "life"), 3);
});

clause(OSPREY, "1:rule", "'you may': picking nothing changes no stats and does not stop the Osprey entering play", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.equal(zoneOf(engine, id("bird")), "play");
  for (const [key, strength, life] of [["mine", 2, 3], ["foe", 2, 3], ["bird", 1, 2]] as const) {
    assert.equal(engine.getStat(id(key), "strength"), strength, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), life, `${key} life`);
  }
  assert.equal(pending(engine), undefined);
});

clause(OSPREY, "1:rule", "only a character can be picked: an item, a location, a face-down card, a faction and a second character are refused", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  refused(() => pickRaw(engine, [id("thing")]), "an item");
  refused(() => pickRaw(engine, [id("place")]), "a location");
  refused(() => pickRaw(engine, [id("faceDown")]), "a face-down card");
  refused(() => pickRaw(engine, [engine.state.players[P2].factionId!]), "a faction");
  refused(() => pickRaw(engine, [id("mine"), id("foe")]), "'a character' means one");
  pickRaw(engine, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "a single character is accepted");
});

clause(OSPREY, "1:rule", "the bonus lasts this turn only: still there at the end of the turn, gone at the start of the next turn", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "back to printed strength");
  assert.equal(engine.getStat(id("mine"), "life"), 3, "back to printed life");
});

clause(OSPREY, "1:rule", "the extra life is real: a character that would die to 3 damage survives it with +1 life, and dies to 4", () => {
  const board = ospreyBoard({ extra: [{ key: "zap3", def: damageTactic(3, "Zap3"), owner: P1, zone: "hand" }, { key: "zap1", def: damageTactic(1, "Zap1"), owner: P1, zone: "hand" }] });
  const { engine, id } = board;
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("foe")]);
  play(engine, P1, id("zap3"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play", "life 3 + 1 = 4 survives 3 damage");
  assert.equal(damageOn(engine, id("foe")), 3);
  play(engine, P1, id("zap1"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "4 damage reaches the 4 life");
});

clause(OSPREY, "1:rule", "the extra strength is real battle damage: the picked attacker deals 3, not 2", () => {
  const { engine, id } = ospreyBoard({ extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("mine")]);
  declareAttackBy(engine, P1, [id("mine")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
  autoResolveBattle(engine);
  assert.equal(damageOn(engine, id("wall")), 3);
});

clause(OSPREY, "1:rule", "triggers only when the Osprey itself enters play: another card entering play does not offer a pick", () => {
  const { engine, id } = ospreyBoard({ extra: [{ key: "bird2", def: printing(OSPREY), owner: P1, zone: "play" }] });
  play(engine, P1, id("plain"));
  assert.equal(zoneOf(engine, id("plain")), "play");
  assert.equal(pending(engine), undefined, "the Osprey already in play did not trigger on another card entering");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(OSPREY, "1:rule", "triggers when it is put into play by an effect, not only when deployed", () => {
  const fetch = tactic({
    name: "Fetch",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fetch",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = ospreyBoard({ extra: [{ key: "fetch", def: fetch, owner: P1, zone: "hand" }] });
  play(engine, P1, id("fetch"), { selected: { t: [id("bird")] } });
  assert.equal(zoneOf(engine, id("bird")), "play");
  answerPick(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "its enters-play ability still fires");
});

clause(OSPREY, "1:rule", "played as a response on the opponent's turn the trigger still belongs to me: I pick, and the bonus lasts for that turn", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  opponentOpensWindow(board);
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPick(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
});

// =============================================================================
// Shared UNIQUE checks (CR 507.5, FAQ): used by every UNIQUE card of this batch
// (The Billionaire, Vander Malagut, Bladefist Doomwing, Rudo Mangod, Wyrmfang
// Deathskull). Each card calls these bodies from its own literal clause() calls.
// =============================================================================

interface UniqueSpec {
  /** The printing under test. */
  id: string;
  /** The staple icon its trade pays with. */
  icon: "deception" | "rage";
}

/** P1 has a copy in play (`u1`) and another in hand (`u2`); plenty of the right resources; the opponent has resources of their own for their own copy (`o1`, in hand). */
function uniqueBoard(spec: UniqueSpec, opts: { turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "u1", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "u2", def: printing(spec.id), owner: P1, zone: "hand" },
      { key: "o1", def: printing(spec.id), owner: P2, zone: "hand" },
      ...bank(spec.icon, 14, P1),
      ...bank(spec.icon, 14, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type UniqueResolve = (engine: SpoilsEngine, keep: CardInstanceId) => void;
const keepUnique: UniqueResolve = (engine, keep) => answerPending(engine, "uniqueSurvivor", { keep });

/** Deploying a second copy forces a choice (the controller's); keeping the NEW one destroys the old one. */
function uniqueKeepNew(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec);
  play(engine, P1, id("u2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...pc.candidates].sort(), [id("u1"), id("u2")].sort());
  keepUnique(engine, id("u2"));
  assert.equal(zoneOf(engine, id("u2")), "play");
  assert.equal(zoneOf(engine, id("u1")), "discard", "the other copy is destroyed");
  assert.ok(discardOf(engine, P1).includes(id("u1")), "discardOf(engine, P1).includes(id(\"u1\"))");
  assert.equal(pending(engine), undefined);
}

/** ...and keeping the OLD one destroys the new one. */
function uniqueKeepOld(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec);
  play(engine, P1, id("u2"));
  keepUnique(engine, id("u1"));
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("u2")), "discard", "keeping the old copy destroys the new one");
  assert.equal(pending(engine), undefined);
}

/** The restriction is per player: the opponent may control their own copy; no choice, no destruction. */
function uniqueOpponentOwnCopy(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec, { turn: 2, active: P2 });
  play(engine, P2, id("o1"));
  assert.equal(pending(engine), undefined, "no choice for either player");
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("o1")), "play");
}

/** A different UNIQUE designation (or none) is not a duplicate. */
function uniqueOtherDesignation(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec, {
    extra: [
      { key: "other", def: character({ name: "OtherUnique", unique: "somebody-else", cost: 0 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "PlainGuy", cost: 0 }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(zoneOf(engine, id("plain")), "play");
}

/** Taking control of the opponent's copy while holding your own: you choose which to keep; the other is destroyed into its OWNER's discard pile. */
function uniqueStealChoice(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec, { extra: [{ key: "theirs", def: printing(spec.id), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  resolvePendingResponses(engine);
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "two copies under one player's control");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("u1"), id("theirs")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("u1") } } as never);
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("theirs")), "the stolen copy goes to its owner's discard pile");
  assert.equal(zoneOf(engine, id("u1")), "play");
}

/** After the Unique choice forced by a tactic that took control of the opponent's copy, the tactic finishes resolving and the game carries on. */
function uniqueStealThenContinue(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec, {
    extra: [
      { key: "theirs", def: printing(spec.id), owner: P2, zone: "play" },
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" },
      { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  resolvePendingResponses(engine);
  answerPending(engine, "uniqueSurvivor", { keep: id("u1") });
  for (let i = 0; i < 5 && engine.state.responseWindow; i++) {
    const w = engine.state.responseWindow;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  assert.equal(engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the Steal tactic is finished and in its owner's discard pile");
  play(engine, P1, id("widget"));
  assert.equal(zoneOf(engine, id("widget")), "play", "and you can keep playing");
}

/** A copy played face-down as a resource is only a resource, so it is not a duplicate. */
function uniqueFaceDownIsNotDuplicate(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec);
  developResource(engine, P1, id("u2"), true);
  assert.equal(pending(engine), undefined, "no choice is forced");
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("u2")), "play");
  assert.equal(engine.state.cards[id("u2")].faceDown, true);
}

/** Flipping nothing else: the opponent's copy is untouched by my duplicate choice. */
function uniqueOpponentCopyUntouched(spec: UniqueSpec): void {
  const { engine, id } = uniqueBoard(spec, { extra: [{ key: "theirs", def: printing(spec.id), owner: P2, zone: "play" }] });
  play(engine, P1, id("u2"));
  keepUnique(engine, id("u2"));
  assert.equal(zoneOf(engine, id("theirs")), "play", "their own copy is not affected by my duplicate");
  assert.equal(controllerOf(engine, id("theirs")), P2);
}

// =============================================================================
// The Billionaire
// UNIQUE PLUCK
// You may use abilities on your opponent's cards, but you must pay any numeric
// cost with your own resources. Any additional costs must be satisfied as
// though your opponent is using the ability. The ability's effect happens as if
// your opponent used it.
// CHANGE COSTUME -- COST: Pay 3. Shuffle this card into its owner's deck.
// EFFECT: Search your deck for a pluck card with a different name than this
// card and reveal it. Put it into play under your control.
// Character (rogue; pluck, grifter), cost 5, threshold [D][D][D][D], 2 str / 4 spd / 3 life.
// =============================================================================

const BILLIONAIRE = "fb604d54-0aa5-40b5-9430-9d163e03fcc9";
const PLUCK_CARD = "f4ccc8f6-f59d-47f3-8972-48d83770de94";
const BILL_SPEC: UniqueSpec = { id: BILLIONAIRE, icon: "deception" };

clause(BILLIONAIRE, "0:unique", "playing a second Billionaire makes you (the controller) keep one: keeping the new one destroys the old one", () => uniqueKeepNew(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "keeping the old Billionaire destroys the new one", () => uniqueKeepOld(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "the restriction is per player: the opponent may control their own Billionaire (no choice, no destruction)", () => uniqueOpponentOwnCopy(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "a card with a different UNIQUE designation (or none) is not a duplicate", () => uniqueOtherDesignation(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "taking control of the opponent's Billionaire while you have your own forces a choice; the copy not kept goes to its owner's discard pile", () => uniqueStealChoice(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "after the Unique choice forced by a tactic that took control of the opponent's Billionaire, the tactic finishes resolving and the game carries on", () => uniqueStealThenContinue(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "a Billionaire played face-down as a resource is only a resource, so it is not a duplicate", () => uniqueFaceDownIsNotDuplicate(BILL_SPEC));
clause(BILLIONAIRE, "0:unique", "my duplicate choice never touches the opponent's own copy", () => uniqueOpponentCopyUntouched(BILL_SPEC));

clause(BILLIONAIRE, "0:unique", "UNIQUE PLUCK is the designation: any other card with UNIQUE PLUCK (the real Pluck, or a synthetic one) is a duplicate of The Billionaire", () => {
  const twin = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      { key: "twin", def: character({ name: "Twin", unique: "pluck", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(twin.engine, P1, twin.id("twin"));
  const pc = pending(twin.engine) as unknown as { kind: string; unique?: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [twin.id("bill"), twin.id("twin")].sort());
  keepUnique(twin.engine, twin.id("bill"));
  assert.equal(zoneOf(twin.engine, twin.id("bill")), "play");
  assert.equal(zoneOf(twin.engine, twin.id("twin")), "discard");

  const real = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      { key: "pl", def: printing(PLUCK_CARD), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(real.engine, P1, real.id("pl"));
  assert.equal(pending(real.engine)?.kind, "uniqueSurvivor", "the real Pluck shares UNIQUE PLUCK");
  keepUnique(real.engine, real.id("pl"));
  assert.equal(zoneOf(real.engine, real.id("bill")), "discard");
  assert.equal(zoneOf(real.engine, real.id("pl")), "play");
});

// --- 1:rule: borrowing the opponent's abilities --------------------------------

/** An opponent's character with borrowable abilities: a numeric cost, a deplete cost, one that names "an opponent's character", a mixed cost, and one naming "a character you control". */
const FOUNTAIN = character({
  name: "Fountain",
  behavior: {
    abilities: [
      { id: "gush", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
      { id: "sip", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
      { id: "both", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
      {
        id: "ping",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
      },
      {
        id: "sac",
        type: "activated",
        targets: [{ id: "d", selector: { controller: "self", type: "character" }, count: 1 }],
        costs: [{ type: "deplete", target: { type: "selected", id: "d" } }],
        effects: [{ type: "draw", player: "controller", amount: 1 }]
      },
      {
        id: "pitch",
        type: "activated",
        costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
        effects: [{ type: "draw", player: "controller", amount: 1 }]
      }
    ]
  }
});

const pluckChar = (name: string, over: Partial<Def> = {}): Def => character({ name, subtype: ["pluck"], strength: 1, life: 2, speed: 1, ...over });

function billBoard(opts: { billIn?: "play" | "hand" | "none"; p1Res?: number; p2Res?: number; extra?: CardPlacement[]; random?: () => number; billOwner?: Pid; turn?: number; active?: Pid; billController?: Pid } = {}) {
  const billIn = opts.billIn ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      ...(billIn === "none" ? [] : [{ key: "bill", def: printing(BILLIONAIRE), owner: opts.billOwner ?? P1, controller: opts.billController ?? P1, zone: billIn } as CardPlacement]),
      { key: "fountain", def: FOUNTAIN, owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("deception", opts.p1Res ?? 9, P1),
      ...bank("rage", opts.p2Res ?? 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BILLIONAIRE, "1:rule", "I can use an ability on my opponent's card: the effect happens as if the opponent used it (THEY draw, I do not)", () => {
  const { engine, id } = billBoard();
  const p1Hand = handOf(engine, P1).length;
  const p2Hand = handOf(engine, P2).length;
  const p2Top = deckOf(engine, P2)[0];
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(handOf(engine, P2).length, p2Hand + 1, "your opponent draws");
  assert.equal(zoneOf(engine, p2Top), "hand");
  assert.ok(handOf(engine, P2).includes(p2Top), "handOf(engine, P2).includes(p2Top)");
  assert.equal(handOf(engine, P1).length, p1Hand, "you do not");
});

clause(BILLIONAIRE, "1:rule", "the numeric cost is paid with MY OWN resources (exactly 2 of mine), and the opponent's resources are untouched", () => {
  const { engine, id } = billBoard({ p1Res: 9, p2Res: 3 });
  const p1Before = ready(engine, P1);
  const p2Before = ready(engine, P2);
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(p1Before - ready(engine, P1), 2, "my resources pay the cost of 2");
  assert.equal(p2Before - ready(engine, P2), 0, "theirs are untouched");
  const attachedToMine = engine.state.players[P1].play.filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo === factionOf(engine, P1)).length;
  assert.equal(attachedToMine, 2, "two of my resources were attached to my faction");
});

clause(BILLIONAIRE, "1:rule", "the opponent need not be able to pay: with no resources of their own I can still use it with mine", () => {
  const { engine, id } = billBoard({ p1Res: 2, p2Res: 0 });
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(handOf(engine, P2).length, 1, "the opponent drew although they have no resources");
  assert.equal(ready(engine, P1), 0);
});

clause(BILLIONAIRE, "1:rule", "if I cannot pay the numeric cost it is refused, however many resources the opponent has", () => {
  const { engine, id } = billBoard({ p1Res: 1, p2Res: 9 });
  refused(() => activateRaw(engine, P1, id("fountain"), "gush"), "only 1 of my resources for a cost of 2");
  assert.equal(ready(engine, P1), 1);
  assert.equal(ready(engine, P2), 9);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BILLIONAIRE, "1:rule", "a non-numeric additional cost (deplete this card) is satisfied by the OPPONENT's card, and then the opponent draws", () => {
  const { engine, id } = billBoard();
  const p1Hand = handOf(engine, P1).length;
  const mine = ready(engine, P1);
  activate(engine, P1, id("fountain"), "sip");
  assert.equal(isDepleted(engine, id("fountain")), true, "the opponent's card is depleted");
  assert.equal(handOf(engine, P2).length, 1, "the opponent draws");
  assert.equal(handOf(engine, P1).length, p1Hand);
  assert.equal(ready(engine, P1), mine, "no numeric cost, so none of my resources are spent");
  refused(() => activateRaw(engine, P1, id("fountain"), "sip"), "it is depleted now, so the additional cost cannot be satisfied again");
});

clause(BILLIONAIRE, "1:rule", "a mixed cost: the numeric part comes from my resources and the deplete part from their card", () => {
  const { engine, id } = billBoard({ p1Res: 4, p2Res: 4 });
  activate(engine, P1, id("fountain"), "both");
  assert.equal(ready(engine, P1), 3, "I paid 1");
  assert.equal(ready(engine, P2), 4, "they paid nothing");
  assert.equal(isDepleted(engine, id("fountain")), true);
  assert.equal(handOf(engine, P2).length, 1);
});

clause(BILLIONAIRE, "1:rule", "'your opponent' inside the borrowed ability means the opponent's opponent, me: it picks among MY characters", () => {
  const { engine, id } = billBoard({ extra: [{ key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" }] });
  refused(() => activateRaw(engine, P1, id("fountain"), "ping", { t: [id("theirs")] }), "the opponent's own characters are not 'an opponent's character' for the opponent");
  activate(engine, P1, id("fountain"), "ping", { selected: { t: [id("mine")] } });
  assert.equal(damageOn(engine, id("mine")), 1, "my own character took the damage");
  assert.equal(damageOn(engine, id("theirs")), 0);
});

clause(BILLIONAIRE, "1:rule", "'a character you control' in a borrowed cost means the OPPONENT's characters: it can be paid with theirs, not with mine", () => {
  const { engine, id } = billBoard({ extra: [{ key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" }] });
  refused(() => activateRaw(engine, P1, id("fountain"), "sac", { d: [id("mine")] }), "my character is not a character 'you' (the opponent) control");
  assert.equal(isDepleted(engine, id("mine")), false);
  activate(engine, P1, id("fountain"), "sac", { selected: { d: [id("theirs")] } });
  assert.equal(isDepleted(engine, id("theirs")), true, "their character was depleted");
  assert.equal(isDepleted(engine, id("mine")), false);
  assert.equal(handOf(engine, P2).length, 1, "the opponent drew");
});

clause(BILLIONAIRE, "1:rule", "an additional cost satisfied 'as though your opponent is using the ability' (rules answer Q41): a 'discard a card' cost is paid from the opponent's hand", () => {
  // CR 401.2a: paying as though one were the opponent uses only what one knows, so their hand has to be revealed.
  const revealer = character({
    name: "Hand Revealer",
    behavior: { abilities: [{ id: "show", type: "continuous", modifiers: [], grantsReveal: { zone: "hand", of: "opponent" } }] } as never
  });
  const { engine, id } = billBoard({
    extra: [
      { key: "theirHandCard", def: character({ name: "TheirHandCard" }), owner: P2, zone: "hand" },
      { key: "revealer", def: revealer, owner: P1, zone: "play" }
    ]
  });
  activateRaw(engine, P1, id("fountain"), "pitch", { dc: [id("theirHandCard")] });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("theirHandCard")), "discard", "the opponent's hand card was discarded as the cost");
  assert.equal(handOf(engine, P2).length, 1, "the effect happened as if the opponent used it: they drew");
  assert.equal(handOf(engine, P1).length, 0, "I drew nothing");
});

clause(BILLIONAIRE, "1:rule", "also reaches abilities printed on the opponent's items and locations: paid with my resources, effect on the opponent", () => {
  const device = item({
    name: "Gadget",
    behavior: { abilities: [{ id: "tick", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const place = location({
    name: "Shrine",
    behavior: { abilities: [{ id: "pray", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = billBoard({ extra: [{ key: "gadget", def: device, owner: P2, zone: "play" }, { key: "shrine", def: place, owner: P2, zone: "play" }] });
  activate(engine, P1, id("gadget"), "tick");
  assert.equal(handOf(engine, P2).length, 1, "the opponent drew from their item");
  activate(engine, P1, id("shrine"), "pray");
  assert.equal(handOf(engine, P2).length, 2, "...and from their location");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(ready(engine, P1), 7, "I paid 1 + 1 of my own");
  assert.equal(ready(engine, P2), 3);
});

clause(BILLIONAIRE, "1:rule", "also reaches abilities printed on the opponent's faction card (literal reading: it is a card of theirs): paid with my resources, the opponent draws", () => {
  const base = developFaction();
  const faction: Def = {
    ...base,
    id: "e6-faction-with-ability",
    name: "Drawing Faction",
    faction: { ...base.faction!, abilities: [{ id: "faction-draw", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  };
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction },
    cards: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" }, ...fillers("b", 3, P2, "deck"), ...bank("rage", 2, P2), ...bank("deception", 4, P1)]
  });
  activate(engine, P1, factionOf(engine, P2), "faction-draw");
  assert.equal(handOf(engine, P2).length, 1, "the opponent draws from their faction's ability");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(ready(engine, P1), 3, "paid with MY resources");
  assert.equal(ready(engine, P2), 2, "theirs are untouched");
  void id;
});

clause(BILLIONAIRE, "1:rule", "my own cards' abilities are unaffected: they still use MY resources and MY draw", () => {
  const mine = character({ name: "MyFountain", behavior: { abilities: [{ id: "gush", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = billBoard({ extra: [{ key: "myf", def: mine, owner: P1, zone: "play" }] });
  const theirs = ready(engine, P2);
  activate(engine, P1, id("myf"), "gush");
  assert.equal(ready(engine, P1), 7, "I paid 2 of my own");
  assert.equal(handOf(engine, P1).length, 1, "I drew");
  assert.equal(ready(engine, P2), theirs);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BILLIONAIRE, "1:rule", "without a Billionaire in play I cannot use the opponent's abilities", () => {
  const { engine, id } = billBoard({ billIn: "none" });
  refused(() => activateRaw(engine, P1, id("fountain"), "gush"));
  refused(() => activateRaw(engine, P1, id("fountain"), "sip"));
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BILLIONAIRE, "1:rule", "a Billionaire in my hand does not give me the power; it must be in play", () => {
  const { engine, id } = billBoard({ billIn: "hand" });
  refused(() => activateRaw(engine, P1, id("fountain"), "gush"));
});

clause(BILLIONAIRE, "1:rule", "once the Billionaire leaves play I can no longer use the opponent's abilities", () => {
  const { engine, id } = billBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(handOf(engine, P2).length, 1, "works while it is in play");
  play(engine, P1, id("kill"), { selected: { t: [id("bill")] } });
  assert.equal(zoneOf(engine, id("bill")), "discard");
  refused(() => activateRaw(engine, P1, id("fountain"), "gush"));
  assert.equal(handOf(engine, P2).length, 1);
});

clause(BILLIONAIRE, "1:rule", "it only works for the Billionaire's controller: the opponent cannot use MY abilities unless they have their own", () => {
  const mineWithAbility = character({ name: "MyFountain", behavior: { abilities: [{ id: "gush", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = billBoard({ extra: [{ key: "myf", def: mineWithAbility, owner: P1, zone: "play" }] });
  refused(() => activateRaw(engine, P2, id("myf"), "gush"), "P2 has no Billionaire");
  activate(engine, P1, id("myf"), "gush");
  assert.equal(handOf(engine, P1).length, 1, "control: I can use my own ability as normal");
});

clause(BILLIONAIRE, "1:rule", "it works in the other direction when the opponent controls the Billionaire: THEY may use MY abilities, paying with THEIR resources, the effect happening to me", () => {
  const mineWithAbility = character({ name: "MyFountain", behavior: { abilities: [{ id: "gush", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: P2, zone: "play" },
      { key: "myf", def: mineWithAbility, owner: P1, zone: "play" },
      ...fillers("a", 3, P1, "deck"),
      ...bank("rage", 3, P1),
      ...bank("rage", 3, P2)
    ]
  });
  activate(engine, P2, id("myf"), "gush");
  assert.equal(handOf(engine, P1).length, 1, "the effect happens to the Billionaire's opponent (P1 draws)");
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(ready(engine, P2), 1, "the Billionaire's controller paid with their own resources");
  assert.equal(ready(engine, P1), 3, "mine are untouched");
});

clause(BILLIONAIRE, "1:rule", "a borrowed ability can be used in a response window too (any time an ability could be used): in response to their attack I use their ability", () => {
  const { engine, id } = billBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  openDefenderWindow(engine, id("atk"));
  activateRaw(engine, P1, id("fountain"), "gush");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, 1, "the opponent drew from my borrowed use");
  assert.equal(ready(engine, P1), 7, "I paid 2");
});

clause(BILLIONAIRE, "1:rule", "the borrowed ability is offered to me while I can pay for it, and not offered when I cannot", () => {
  const rich = billBoard({ p1Res: 2 });
  const listed = rich.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === rich.id("fountain")).map((a) => a.ability.id);
  assert.ok(listed.includes("gush"), "gush (pay 2) is available with 2 resources");
  assert.ok(listed.includes("sip"), "listed.includes(\"sip\")");
  const poor = billBoard({ p1Res: 1, p2Res: 9 });
  const listedPoor = poor.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === poor.id("fountain")).map((a) => a.ability.id);
  assert.ok(!listedPoor.includes("gush"), "gush is not available with 1 resource of mine, however rich they are");
  assert.ok(listedPoor.includes("sip"), "control: sip has no numeric cost");
});

// --- 2:ability:costume ----------------------------------------------------------

function costumeBoard(opts: { res?: number; greed?: number; random?: () => number; billOwner?: Pid; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return billBoard({
    p1Res: opts.res ?? 3,
    random: opts.random,
    billOwner: opts.billOwner,
    turn: opts.turn,
    active: opts.active,
    extra: [
      { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" },
      { key: "alt2", def: pluckChar("AltTwo"), owner: P1, zone: "deck" },
      { key: "plain", def: character({ name: "PlainGuy" }), owner: P1, zone: "deck" },
      { key: "bill2", def: printing(BILLIONAIRE), owner: P1, zone: "deck" },
      { key: "twin", def: pluckChar("TwinPluck", { unique: "pluck" }), owner: P1, zone: "deck" },
      { key: "oppPluck", def: pluckChar("OppPluck"), owner: P2, zone: "deck" },
      { key: "handPluck", def: pluckChar("HandPluck"), owner: P1, zone: "hand" },
      { key: "discPluck", def: pluckChar("DiscPluck"), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const revealsOf = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

clause(BILLIONAIRE, "2:ability:costume", "pays 3 and shuffles the Billionaire into its owner's deck as the cost, before anyone can respond", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  const deckBefore = deckOf(engine, P1).length;
  activateRaw(engine, P1, id("bill"), "costume");
  assert.equal(before - ready(engine), 3, "COST: pay 3, paid on activation");
  assert.equal(zoneOf(engine, id("bill")), "deck", "COST: shuffle this card into its owner's deck, already done on activation");
  assert.equal(deckOf(engine, P1).length, deckBefore + 1);
  assert.ok(deckOf(engine, P1).includes(id("bill")), "deckOf(engine, P1).includes(id(\"bill\"))");
});

clause(BILLIONAIRE, "2:ability:costume", "the Billionaire is already gone when the opponent gets to respond, so a response cannot destroy it", () => {
  const { engine, id } = costumeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("bill"), "costume");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  refused(() => playRaw(engine, P2, id("kill"), { selected: { t: [id("bill")] } }), "the Billionaire left play as a cost, so it is not a legal target");
  assert.equal(zoneOf(engine, id("kill")), "hand");
});

clause(BILLIONAIRE, "2:ability:costume", "pays 3 (of any resources, no threshold), shuffles the Billionaire into the deck, and lets me search for a pluck card (only those are offered)", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  activate(engine, P1, id("bill"), "costume");
  assert.equal(before - ready(engine), 3, "COST: pay 3");
  assert.equal(zoneOf(engine, id("bill")), "deck", "COST: the Billionaire is shuffled into the deck");
  assert.ok(deckOf(engine, P1).includes(id("bill")), "...its owner's deck");
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked what to search for");
  assert.equal(pc?.playerId, P1, "I search");
  for (const key of ["plain", "bill2", "bill", "oppPluck", "handPluck", "discPluck"]) {
    refused(() => pickRaw(engine, [id(key)]), `${key} is not a legal pick`);
  }
  assert.ok(pending(engine), "refused picks leave the choice open");
  pick(engine, [id("alt")]);
  assert.equal(zoneOf(engine, id("alt")), "play", "the found card is put into play");
  assert.equal(controllerOf(engine, id("alt")), P1, "under my control");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("alt2")), "deck", "the other pluck cards stay in the deck");
  assert.equal(zoneOf(engine, id("bill")), "deck", "The Billionaire stays in the deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the found card is REVEALED (a cardsRevealed event names it); a declined search reveals nothing", () => {
  const found = costumeBoard();
  activate(found.engine, P1, found.id("bill"), "costume");
  pick(found.engine, [found.id("alt")]);
  const reveals = revealsOf(found.engine);
  assert.ok(reveals.length >= 1, "a reveal was logged");
  assert.ok(JSON.stringify(reveals).includes(found.id("alt")), "...naming the found card");
  const declined = costumeBoard();
  activate(declined.engine, P1, declined.id("bill"), "costume");
  pick(declined.engine, []);
  assert.equal(revealsOf(declined.engine).length, 0, "nothing was revealed");
});

clause(BILLIONAIRE, "2:ability:costume", "a card with the pluck subtype among several (pluck, grifter) is legal, and so is the real Pluck (a different name)", () => {
  const first = costumeBoard({ extra: [{ key: "pluckB", def: pluckChar("PluckB", { subtype: ["pluck", "grifter"] }), owner: P1, zone: "deck" }] });
  activate(first.engine, P1, first.id("bill"), "costume");
  pick(first.engine, [first.id("pluckB")]);
  assert.equal(zoneOf(first.engine, first.id("pluckB")), "play");

  const second = costumeBoard({ extra: [{ key: "realPluck", def: printing(PLUCK_CARD), owner: P1, zone: "deck" }] });
  activate(second.engine, P1, second.id("bill"), "costume");
  pick(second.engine, [second.id("realPluck")]);
  assert.equal(zoneOf(second.engine, second.id("realPluck")), "play");
  assert.equal(pending(second.engine), undefined, "no UNIQUE PLUCK conflict: The Billionaire is already out of play");
  assert.equal(zoneOf(second.engine, second.id("bill")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the pluck card must have a different name than the Billionaire: another Billionaire is refused", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  refused(() => pickRaw(engine, [id("bill2")]), "a second Billionaire has the same name");
  refused(() => pickRaw(engine, [id("bill")]), "the shuffled-in Billionaire itself");
  pick(engine, [id("alt")]);
  assert.equal(zoneOf(engine, id("alt")), "play");
});

clause(BILLIONAIRE, "2:ability:costume", "only one card is found: asking for two is refused", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  refused(() => pickRaw(engine, [id("alt"), id("alt2")]), "two cards");
  pick(engine, [id("alt2")]);
  assert.equal(zoneOf(engine, id("alt2")), "play");
  assert.equal(zoneOf(engine, id("alt")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "a search with criteria may find nothing (CR 312.2): the cost is still paid and the Billionaire is in the deck", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  activate(engine, P1, id("bill"), "costume");
  pick(engine, []);
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bill")), "deck");
  for (const key of ["alt", "alt2", "twin"]) assert.equal(zoneOf(engine, id(key)), "deck", `${key} stays in the deck`);
});

clause(BILLIONAIRE, "2:ability:costume", "with no eligible pluck in the deck it still costs 3 and shuffles the Billionaire away", () => {
  const { engine, id } = billBoard({ p1Res: 3 });
  const before = ready(engine);
  activate(engine, P1, id("bill"), "costume");
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bill")), "deck");
  assert.equal(pending(engine), undefined);
});

clause(BILLIONAIRE, "2:ability:costume", "a found card with the same UNIQUE PLUCK designation can enter play because the Billionaire has already left", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  pick(engine, [id("twin")]);
  assert.equal(zoneOf(engine, id("twin")), "play");
  assert.equal(pending(engine), undefined, "no 'keep one' choice: the Billionaire was shuffled away as the cost");
  assert.equal(zoneOf(engine, id("bill")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "'its owner's deck': a Billionaire I control but the opponent owns goes into THE OPPONENT's deck, while I search MY deck", () => {
  const { engine, id } = costumeBoard({ billOwner: P2 });
  const oppDeckSize = deckOf(engine, P2).length;
  activate(engine, P1, id("bill"), "costume");
  assert.equal(zoneOf(engine, id("bill")), "deck");
  assert.ok(deckOf(engine, P2).includes(id("bill")), "it went into its owner's (the opponent's) deck");
  assert.equal(deckOf(engine, P2).length, oppDeckSize + 1);
  assert.equal(deckOf(engine, P1).includes(id("bill")), false, "not into mine");
  pick(engine, [id("alt")]);
  assert.equal(controllerOf(engine, id("alt")), P1, "the search was of MY deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the deck really is shuffled with the Billionaire in it: its position varies with the random stream", () => {
  const positions = new Set<number>();
  for (let seed = 1; seed <= 24; seed++) {
    const { engine, id } = costumeBoard({ random: seededRandom(seed * 7919) });
    activate(engine, P1, id("bill"), "costume");
    pick(engine, []);
    positions.add(deckOf(engine, P1).indexOf(id("bill")));
  }
  assert.ok(positions.size > 3, `The Billionaire ended up at ${positions.size} different positions over 24 shuffles`);
});

clause(BILLIONAIRE, "2:ability:costume", "'shuffle this card into its owner's deck' shuffles the OWNER's deck: a Billionaire the opponent owns lands at varying positions in THEIR deck", () => {
  const positions = new Set<number>();
  for (let seed = 1; seed <= 24; seed++) {
    const { engine, id } = costumeBoard({ billOwner: P2, random: seededRandom(seed * 104729) });
    activate(engine, P1, id("bill"), "costume");
    pick(engine, []);
    positions.add(deckOf(engine, P2).indexOf(id("bill")));
  }
  assert.ok(positions.size > 3, `The Billionaire ended up at ${positions.size} different positions in its owner's deck over 24 shuffles`);
});

clause(BILLIONAIRE, "2:ability:costume", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const { engine, id } = costumeBoard({ random: seededRandom(seed * 104729) });
    activate(engine, P1, id("bill"), "costume");
    pick(engine, [id("alt")]);
    orders.add(deckOf(engine, P1).join(","));
  }
  assert.ok(orders.size > 3, `the remaining deck came out in ${orders.size} different orders`);
});

clause(BILLIONAIRE, "2:ability:costume", "is refused one resource short of its cost of 3 (the Billionaire stays in play); exactly 3 of any resources works", () => {
  const short = costumeBoard({ res: 2 });
  refused(() => activateRaw(short.engine, P1, short.id("bill"), "costume"), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("bill")), "play", "the Billionaire stays");
  assert.equal(ready(short.engine), 2);
  assert.equal(pending(short.engine), undefined);

  const greedOnly = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" }, { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" }, ...bank("greed", 3, P1)]
  });
  activate(greedOnly.engine, P1, greedOnly.id("bill"), "costume");
  pick(greedOnly.engine, [greedOnly.id("alt")]);
  assert.equal(zoneOf(greedOnly.engine, greedOnly.id("alt")), "play", "three resources of any kind are enough");
  assert.equal(ready(greedOnly.engine), 0);
});

clause(BILLIONAIRE, "2:ability:costume", "only the Billionaire's controller can use it, and not from my hand", () => {
  const { engine, id } = costumeBoard();
  refused(() => activateRaw(engine, P2, id("bill"), "costume"), "the opponent cannot use my Billionaire's ability");
  assert.equal(zoneOf(engine, id("bill")), "play");
  const inHand = billBoard({ billIn: "hand", p1Res: 3 });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("bill"), "costume"));
});

clause(BILLIONAIRE, "2:ability:costume", "can be used the turn the Billionaire enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play", attackEligible: false }, { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" }, ...bank("greed", 3, P1)]
  });
  activate(engine, P1, id("bill"), "costume");
  pick(engine, [id("alt")]);
  assert.equal(zoneOf(engine, id("alt")), "play");
});

clause(BILLIONAIRE, "2:ability:costume", "it can be used at instant speed too: in response to the opponent's attack", () => {
  const { engine, id } = costumeBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  openDefenderWindow(engine, id("atk"));
  activateRaw(engine, P1, id("bill"), "costume");
  resolvePendingResponses(engine);
  pick(engine, [id("alt")]);
  assert.equal(zoneOf(engine, id("alt")), "play");
  assert.equal(zoneOf(engine, id("bill")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the Billionaire can borrow and costume in the same turn; the borrowed ability's effect is separate from CHANGE COSTUME's search (control: both succeed in sequence)", () => {
  const { engine, id } = costumeBoard({ res: 5 });
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(handOf(engine, P2).length, 1);
  activate(engine, P1, id("bill"), "costume");
  pick(engine, [id("alt")]);
  assert.equal(zoneOf(engine, id("alt")), "play");
  assert.equal(ready(engine), 0, "2 + 3 = 5 paid");
});

clause(BILLIONAIRE, "0:unique", "deploys for exactly 5 with [D][D][D][D] (one short or three icons is refused) and has its printed 2/3/4 stats and pluck, grifter subtypes", () => {
  const exact = deployChecks(rogueMake(BILLIONAIRE), 5, 4);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [2, 3, 4]);
  assert.deepEqual(subtypesOf(exact.engine, exact.id("me")), ["pluck", "grifter"]);
});

// =============================================================================
// Thief Doyen
// COST: Discard a character or item. X is its numeric cost.
// This card enters play with X tokens on it.
// This card gains 1 strength and 1 life for each token on it.
// Character (rogue, thief), cost 4, threshold [D][D], 0 str / 3 spd / 0 life.
// =============================================================================

const DOYEN = "6e71cc88-adef-4453-bb04-8652706a4a19";

function doyenBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[]; random?: () => number } = {}) {
  return buildGame({
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "td", def: printing(DOYEN), owner: P1, zone: "hand" },
      { key: "dChar3", def: character({ name: "DChar3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "dChar6", def: character({ name: "DChar6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "dChar0", def: character({ name: "DChar0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "dItem2", def: item({ name: "DItem2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "dTactic", def: tactic({ name: "DTactic", cost: 3 }), owner: P1, zone: "hand" },
      { key: "dPlace", def: location({ name: "DPlace", cost: 4 }), owner: P1, zone: "hand" },
      { key: "dRes", def: resourceCard({ name: "DRes" }), owner: P1, zone: "hand" },
      { key: "oppHand", def: character({ name: "OppHand", cost: 5 }), owner: P2, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 5 }), owner: P1, zone: "play" },
      { key: "inDeck", def: character({ name: "InDeck", cost: 5 }), owner: P1, zone: "deck" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 5 }), owner: P1, zone: "discard" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const deployDoyen = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, discardKey: string) =>
  play(engine, P1, id("td"), { selected: { d: [id(discardKey)] } });

clause(DOYEN, "0:ability", "deploys for its printed cost of 4 and [D][D] (plus the discard), refused one resource short or without [D][D]", () => {
  const ok = doyenBoard({ deception: 2, greed: 2 });
  const before = ready(ok.engine);
  deployDoyen(ok.engine, ok.id, "dChar3");
  assert.equal(zoneOf(ok.engine, ok.id("td")), "play");
  assert.equal(before - ready(ok.engine), 4, "the printed numeric cost of 4 is paid");

  const short = doyenBoard({ deception: 2, greed: 1 });
  refused(() => deployDoyen(short.engine, short.id, "dChar3"), "3 resources are not enough");
  assert.equal(zoneOf(short.engine, short.id("td")), "hand");
  assert.equal(zoneOf(short.engine, short.id("dChar3")), "hand", "the discard cost was not paid for a refused play");

  const noThreshold = doyenBoard({ deception: 1, greed: 8 });
  refused(() => deployDoyen(noThreshold.engine, noThreshold.id, "dChar3"), "one [D] is not [D][D]");
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("td")).playable, false);
});

for (const [key, x, label] of [
  ["dChar3", 3, "a cost-3 character"],
  ["dChar6", 6, "a cost-6 character"],
  ["dItem2", 2, "a cost-2 item"]
] as const) {
  clause(DOYEN, "0:ability", `discarding ${label}: X is ${x}, so it is discarded and Doyen enters play with ${x} tokens, ${x} strength and ${x} life`, () => {
    const { engine, id } = doyenBoard();
    deployDoyen(engine, id, key);
    assert.equal(zoneOf(engine, id(key)), "discard", "the discarded card is in its owner's discard pile");
    assert.ok(discardOf(engine, P1).includes(id(key)), "discardOf(engine, P1).includes(id(key))");
    assert.equal(zoneOf(engine, id("td")), "play");
    assert.equal(tokensOn(engine, id("td")), x, `enters play with X = ${x} tokens`);
    assert.equal(engine.getStat(id("td"), "strength"), x, "0 printed + 1 per token");
    assert.equal(engine.getStat(id("td"), "life"), x, "0 printed + 1 per token");
    assert.equal(engine.getStat(id("td"), "speed"), 3, "speed is not affected by tokens");
  });
}

clause(DOYEN, "0:ability", "X is the discarded card's NUMERIC cost, its printed cost number: a cost-reduction aura in play does not change it", () => {
  const discountAura = item({
    name: "Discount Aura",
    cost: 0,
    behavior: { abilities: [{ id: "disc", type: "continuous", modifiers: [], costModifiers: [{ affects: "controller", delta: -2 }] }] }
  });
  const { engine, id } = doyenBoard({ extra: [{ key: "aura", def: discountAura, owner: P1, zone: "play" }] });
  deployDoyen(engine, id, "dChar6");
  assert.equal(zoneOf(engine, id("td")), "play");
  assert.equal(tokensOn(engine, id("td")), 6, "X = 6, the printed cost number, not 6 - 2");
});

clause(DOYEN, "0:ability", "discarding a cost-0 character: X is 0, so it is discarded and Doyen enters play with no tokens", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar0");
  assert.equal(zoneOf(engine, id("dChar0")), "discard");
  assert.equal(tokensOn(engine, id("td")), 0, "X = 0: no tokens");
});

clause(DOYEN, "0:ability", "only one card is discarded: the other character / item cards in hand stay", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar3");
  for (const key of ["dChar6", "dChar0", "dItem2", "dTactic", "dPlace", "dRes"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
});

clause(DOYEN, "0:ability", "the discard must be a character or item from my hand: a tactic, a location, a resource, the opponent's card or a card elsewhere is refused", () => {
  const { engine, id } = doyenBoard();
  for (const key of ["dTactic", "dPlace", "dRes", "oppHand", "inPlay", "inDeck", "inDiscard"]) {
    refused(() => deployDoyen(engine, id, key), `${key} cannot be the discard`);
  }
  assert.equal(zoneOf(engine, id("td")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
  for (const key of ["dTactic", "dPlace", "dRes"]) assert.equal(zoneOf(engine, id(key)), "hand");
  deployDoyen(engine, id, "dChar3");
  assert.equal(zoneOf(engine, id("td")), "play", "control: a character is accepted");
});

clause(DOYEN, "0:ability", "a face-down card in play is not a character or item to discard (it is not in hand)", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "fd", def: character({ name: "FaceDownGuy", cost: 5 }), owner: P1, zone: "play", faceDown: true }] });
  refused(() => deployDoyen(engine, id, "fd"), "a face-down resource is not in hand");
  assert.equal(zoneOf(engine, id("td")), "hand");
});

clause(DOYEN, "0:ability", "Doyen cannot discard ITSELF as its own cost (it is being played, not a card to discard from my hand)", () => {
  const { engine, id } = doyenBoard();
  refused(() => deployDoyen(engine, id, "td"), "the card being played is not a card in my hand to discard");
  assert.equal(zoneOf(engine, id("td")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
});

clause(DOYEN, "0:ability", "exactly one card must be discarded: none or two are refused", () => {
  const { engine, id } = doyenBoard();
  refused(() => play(engine, P1, id("td"), { selected: { d: [] } }), "a discard is required");
  refused(() => play(engine, P1, id("td"), { selected: { d: [id("dChar3"), id("dChar6")] } }), "only one");
  assert.equal(zoneOf(engine, id("td")), "hand");
  assert.equal(zoneOf(engine, id("dChar3")), "hand");
  deployDoyen(engine, id, "dChar3");
  assert.equal(zoneOf(engine, id("td")), "play", "control: one card works");
});

clause(DOYEN, "0:ability", "with no character or item in hand it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "td", def: printing(DOYEN), owner: P1, zone: "hand" }, { key: "dTactic", def: tactic({ name: "DTactic", cost: 3 }), owner: P1, zone: "hand" }, ...bank("deception", 6, P1)]
  });
  refused(() => play(engine, P1, id("td"), { selected: { d: [] } }));
  refused(() => play(engine, P1, id("td"), { selected: { d: [id("dTactic")] } }));
  assert.equal(zoneOf(engine, id("td")), "hand");
  const control = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "td", def: printing(DOYEN), owner: P1, zone: "hand" }, { key: "dChar", def: character({ name: "DChar", cost: 3 }), owner: P1, zone: "hand" }, ...bank("deception", 6, P1)]
  });
  play(control.engine, P1, control.id("td"), { selected: { d: [control.id("dChar")] } });
  assert.equal(zoneOf(control.engine, control.id("td")), "play", "control: with a character in hand it works");
});

clause(DOYEN, "0:ability", "the discard is a COST: the card is already discarded when Doyen is played, before the opponent can respond", () => {
  const { engine, id } = doyenBoard();
  playRaw(engine, P1, id("td"), { selected: { d: [id("dChar3")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("dChar3")), "discard", "already discarded");
  assert.equal(zoneOf(engine, id("td")), "deploying", "Doyen is not in play yet");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("td")), 3);
});

clause(DOYEN, "1:rule", "enters play with exactly X tokens, put on it as it enters (a freshly played Doyen is a 3/3 that survives 2 damage but not the third)", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "h2", def: damageTactic(2), owner: P1, zone: "hand" }, { key: "h1", def: damageTactic(1), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  assert.equal(tokensOn(engine, id("td")), 3);
  play(engine, P1, id("h2"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "play", "2 damage vs 3 life");
  play(engine, P1, id("h1"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "discard", "3 damage vs 3 life");
});

clause(DOYEN, "1:rule", "the tokens are only on Doyen itself: the discarded card and the other cards in play get none", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar6");
  assert.equal(tokensOn(engine, id("dChar6")), 0);
  assert.equal(tokensOn(engine, id("inPlay")), 0);
  assert.equal(tokensOn(engine, id("td")), 6);
});

clause(DOYEN, "1:rule", "a Doyen in my hand has no tokens, and a refused play leaves it without any", () => {
  const { engine, id } = doyenBoard({ deception: 0, greed: 0 });
  assert.equal(tokensOn(engine, id("td")), 0);
  refused(() => deployDoyen(engine, id, "dChar3"), "no resources");
  assert.equal(tokensOn(engine, id("td")), 0);
});

clause(DOYEN, "1:rule", "tokens disappear when the card leaves play (CR 409.2): a bounced Doyen has no tokens", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  assert.equal(tokensOn(engine, id("td")), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "hand");
  assert.equal(tokensOn(engine, id("td")), 0, "tokens disappear when the card leaves play");
});

clause(DOYEN, "1:rule", "a Doyen played again after leaving play enters with only its NEW X tokens (not the old ones plus the new)", () => {
  const { engine, id } = doyenBoard({ greed: 6, extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  play(engine, P1, id("bounce"), { selected: { t: [id("td")] } });
  deployDoyen(engine, id, "dItem2");
  assert.equal(tokensOn(engine, id("td")), 2, "the new X = 2 only, not 3 + 2");
  assert.equal(engine.getStat(id("td"), "strength"), 2);
  assert.equal(engine.getStat(id("td"), "life"), 2);
});

clause(DOYEN, "1:rule", "X = 0 enters play with 0 tokens, so 0 life: a character with 0 life is destroyed at once (FAQ)", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar0");
  assert.equal(tokensOn(engine, id("td")), 0);
  assert.equal(engine.getStat(id("td"), "life"), 0);
  assert.equal(zoneOf(engine, id("td")), "discard", "FAQ: a character with 0 life is destroyed because its 0 damage equals its 0 life");
});

for (const tokenCount of [0, 1, 2, 5]) {
  clause(DOYEN, "2:rule", `with ${tokenCount} tokens on it Doyen has ${tokenCount} strength and ${tokenCount} life (printed 0 / 0); speed stays 3`, () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "td", def: printing(DOYEN), owner: P1, zone: "play", counters: tokenCount ? { token: tokenCount } : {} },
        { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } }
      ]
    });
    assert.equal(engine.getStat(id("td"), "strength"), tokenCount);
    assert.equal(engine.getStat(id("td"), "life"), tokenCount);
    assert.equal(engine.getStat(id("td"), "speed"), 3);
    assert.equal(engine.getStat(id("other"), "strength"), 2, "another card's tokens give nothing to Doyen and Doyen's rule gives nothing to others");
    assert.equal(engine.getStat(id("other"), "life"), 4);
  });
}

clause(DOYEN, "2:rule", "it follows the live token count: adding a token raises strength and life by one each, removing it lowers them again", () => {
  const { engine, id } = buildGame({ cards: [{ key: "td", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: 2 } }] });
  assert.deepEqual(stats(engine, id("td")), [2, 2, 3]);
  engine.state.cards[id("td")].counters = { token: 4 };
  assert.deepEqual(stats(engine, id("td")), [4, 4, 3]);
  engine.state.cards[id("td")].counters = { token: 1 };
  assert.deepEqual(stats(engine, id("td")), [1, 1, 3]);
});

clause(DOYEN, "2:rule", "the bonus is real in battle: a 3-token Doyen deals 3 damage and absorbs 2 from a 2-strength blocker", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "td", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "wall", def: character({ name: "Wall", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("td")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("wall")] });
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("wall")), 3, "3 strength");
  assert.equal(damageOn(game.engine, game.id("td")), 2);
  assert.equal(zoneOf(game.engine, game.id("td")), "play", "3 life survives 2 damage");
});

clause(DOYEN, "2:rule", "deploys for exactly 4 with [D][D] and has the printed 0/0/3 stats and the thief subtype (discarding a cost-0 card keeps X at 0)", () => {
  const exact = deployChecks(
    (res) => handBoard(DOYEN, { deception: res.own, greed: res.wrong, extra: [{ key: "fodder", def: character({ name: "Fodder", cost: 2 }), owner: P1, zone: "hand" }] }),
    4,
    2,
    (id) => ({ d: [id("fodder")] })
  );
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(subtypesOf(exact.engine, exact.id("me")), ["thief"]);
  assert.equal(tokensOn(exact.engine, exact.id("me")), 2);
});

