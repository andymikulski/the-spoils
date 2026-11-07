// Clause tests — batch seed-2-03. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-03`. Expectations come from each
// card's PRINTED text (markup), RULES.md and the Comprehensive Rules; engine
// data (ability ids, declaration ids, choice kinds) is only used to DRIVE the
// engine.

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
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, settleState, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, settleStartFirst, barrenFaction } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, greed: 3 })`. */
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
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const isFaceDown = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].faceDown === true;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const elitism = (engine: SpoilsEngine, player: PlayerId = P1): number => engine.getThresholds(player).elitism ?? 0;

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

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

type Game = ReturnType<typeof devBoard>;

/** `n` of `icon` resources already attached to (spent on) `owner`'s faction. */
const spent = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** A free tactic (id "no") with no effect, used to open a response window on a turn. */
const NOOP = tactic({ id: "seed-2-03-noop", name: "Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });

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
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }]
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
        { id: "rm", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
}

/** A free tactic (id "take", pick "t"): the caster takes control of the picked character (permanently). */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        { id: "take", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }
      ]
    }
  });
}

/** Plays a card (raw) and lets the response window pass. */
function playAndResolve(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number>; mode?: number } = {}
): void {
  playRaw(engine, player, cardId, opts);
  resolvePendingResponses(engine);
}

/** Answers every open pending choice with the default decline, then asserts nothing is left open. */
function settle(engine: SpoilsEngine): void {
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined, "no choice is left open");
}

/** The ids of every card in `player`'s play zone with the given printed name. */
const named = (engine: SpoilsEngine, player: PlayerId, name: string): CardInstanceId[] =>
  playOf(engine, player).filter((c) => engine.getDefinition(c).name === name);

/** Every Micromajig token in play under `player`'s control. */
const micromajigs = (engine: SpoilsEngine, player: PlayerId = P1): CardInstanceId[] => named(engine, player, "Micromajig");

// =============================================================================
// The Poshernacle
// UNIQUE POSHERNACLE
// At the start of your turn, you may use an ability.
// At the start of your turn, you may draw a card.
// At the start of your turn, your faction gains 1 influence.
// Location, banker, cost 4, [G][G][G], structure 5.
// =============================================================================

const POSH = "ad08166f-f1cd-4ce8-b6d7-239f48d83d00";

function poshBoard(
  o: { zone?: Zone; faceDown?: boolean; controller?: PlayerId; deck?: number; extra?: CardPlacement[]; active?: PlayerId; faction?: CardDefinition } = {}
) {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: o.faction ?? barrenFaction() },
    playerB: { faction: barrenFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "pn", def: printing(POSH), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown, controller: o.controller },
      ...fillers("mine", o.deck ?? 3, P1, "deck"),
      ...fillers("theirs", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}

/** `player`'s turn begins: the opponent (the active player) ends their turn and the response window passes. */
function beginTurn(g: Game, player: PlayerId): void {
  assert.equal(g.engine.state.activePlayerId, other(player), "setup: the opponent is the active player");
  g.engine.perform({ type: "endTurn", playerId: other(player) });
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine); // the faction's Restore Rule and Develop Rule go first: the cards' own triggers are what these tests drive
}

interface StartScript {
  /** The order the controller resolves the three triggers in (ability ids). */
  order?: string[];
  /** Answer to "you may draw a card" (default: yes). */
  draw?: boolean;
  /** What to do with "you may use an ability": decline (default), or use `ability` of the card at placement key `card`. */
  use?: "decline" | { card: string; ability: string; selected?: Record<string, string[]> };
  /** Stop (leaving the prompt open) when this kind of prompt comes up. */
  stopAt?: string;
  /** Stop right after answering a prompt of this kind, without draining the response window it opens. */
  stopAfter?: string;
}

/** Drives the start-of-turn prompts for `player`; returns the kinds of prompt seen, in order. */
function driveStart(g: Game, script: StartScript = {}): string[] {
  const log: string[] = [];
  const order = [...(script.order ?? ["posh-use", "posh-draw", "posh-influence"])];
  const use = script.use ?? "decline";
  let guard = 0;
  while (g.engine.state.pendingChoice && guard++ < 20) {
    const pc = pending(g.engine)!;
    if (script.stopAt === pc.kind) return log;
    log.push(pc.kind);
    let choice: Record<string, unknown>;
    switch (pc.kind) {
      case "orderTriggers": {
        const triggers = pc.triggers as { sourceId: string; abilityId: string }[];
        const want = order.shift();
        choice = { kind: "orderTriggers", next: triggers.find((t) => t.abilityId === want) ?? triggers[0] };
        break;
      }
      case "mayPay":
        choice = { kind: "mayPay", pay: script.draw ?? true };
        break;
      case "useAnyAbility":
        choice = use === "decline" ? { kind: "useAnyAbility" } : { kind: "useAnyAbility", cardId: g.id(use.card) };
        break;
      case "useTargetAbility": {
        const selected: Record<string, CardInstanceId[]> = {};
        if (use !== "decline") for (const [decl, keys] of Object.entries(use.selected ?? {})) selected[decl] = keys.map((k) => g.id(k));
        choice = use === "decline" ? { kind: "useTargetAbility" } : { kind: "useTargetAbility", abilityId: use.ability, selected };
        break;
      }
      default:
        choice = declineAll(pc) as Record<string, unknown>;
    }
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    if (script.stopAfter === pc.kind) return log;
    resolvePendingResponses(g.engine);
  }
  return log;
}

/** Every order the controller can put the three Poshernacle triggers in (ability ids). */
const ORDER_LIST: string[][] = [
  ["posh-use", "posh-draw", "posh-influence"],
  ["posh-use", "posh-influence", "posh-draw"],
  ["posh-draw", "posh-use", "posh-influence"],
  ["posh-influence", "posh-use", "posh-draw"],
  ["posh-draw", "posh-influence", "posh-use"],
  ["posh-influence", "posh-draw", "posh-use"]
];
const orderLabel = (order: string[]): string => order.map((id) => id.replace("posh-", "")).join(" > ");
/** True when the "use an ability" rule resolves before `rule` in `order`. */
const useBefore = (order: string[], rule: string): boolean => order.indexOf("posh-use") < order.indexOf(rule);

/** A character with a free, untargeted "draw 1" ability (`draw1`), placed under key `drawer`. */
const drawer = (owner: PlayerId = P1, extra: Partial<CardPlacement> = {}): CardPlacement => ({ key: "drawer", def: drawerChar(), owner, zone: "play", ...extra });

/** A character with a "Pay N: draw 1" ability (`pay`). */
const payer = (n: number, key = "payer", owner: PlayerId = P1): CardPlacement => ({
  key,
  def: character({
    name: `Payer ${key}`,
    behavior: { abilities: [{ id: "pay", type: "activated", costs: [{ type: "payResources", amount: n }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  }),
  owner,
  zone: "play"
});

/** A character with a threshold-gated "draw 1" ability (`gated`). */
const gated = (threshold: string, key = "gated"): CardPlacement => ({
  key,
  def: character({
    name: `Gated ${key}`,
    behavior: { abilities: [{ id: "gated", type: "activated", threshold, costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never
  }),
  owner: P1,
  zone: "play"
});

/** A character with a "pick a character: it takes 1 damage" ability (`ping`, pick `t`). */
const pinger = (key = "pinger", owner: PlayerId = P1): CardPlacement => ({
  key,
  def: character({
    name: `Pinger ${key}`,
    behavior: {
      abilities: [
        {
          id: "ping",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  }),
  owner,
  zone: "play"
});

// --- the card itself

clause(POSH, "0:unique", "deploying a second Poshernacle makes me choose which to keep: keeping the new one destroys the old one", () => {
  const g = poshBoard({ active: P1, extra: [{ key: "pn2", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 4 })] });
  playRaw(g.engine, P1, g.id("pn2"));
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("pn"), g.id("pn2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pn2") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pn2")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn")), "discard", "the other copy is destroyed to its owner's discard pile");
});

clause(POSH, "0:unique", "keeping the old Poshernacle destroys the new one", () => {
  const g = poshBoard({ active: P1, extra: [{ key: "pn2", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 4 })] });
  playRaw(g.engine, P1, g.id("pn2"));
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pn") } } as never);
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn2")), "discard");
});

clause(POSH, "0:unique", "after I choose which Poshernacle to keep, the game goes on: the response window closes", () => {
  const g = poshBoard({ active: P1, extra: [{ key: "pn2", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 4 })] });
  playRaw(g.engine, P1, g.id("pn2"));
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pn") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the deploy finished resolving");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "and the turn can end");
});

clause(POSH, "0:unique", "UNIQUE is per player: both players may control their own Poshernacle, with no choice and no destruction", () => {
  const g = poshBoard({ extra: [{ key: "pn2", def: printing(POSH), owner: P2, zone: "play" }, { key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playAndResolve(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn2")), "play");
});

clause(POSH, "0:unique", "a second copy in hand, and a different UNIQUE designation, are no conflict", () => {
  const g = poshBoard({
    extra: [
      { key: "pn2", def: printing(POSH), owner: P1, zone: "hand" },
      { key: "other", def: location({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "noop", def: NOOP, owner: P2, zone: "hand" }
    ]
  });
  playAndResolve(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn2")), "hand");
});

clause(POSH, "0:unique", "a face-down copy has no rules text (CR 411.1), so it is no conflict with a face-up Poshernacle", () => {
  const g = poshBoard({ extra: [{ key: "pn2", def: printing(POSH), owner: P1, zone: "play", faceDown: true }, { key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playAndResolve(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no UNIQUE choice is raised");
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn2")), "play");
  assert.equal(isFaceDown(g.engine, g.id("pn2")), true);
});

const stealPoshBoard = () =>
  poshBoard({
    active: P1,
    extra: [
      { key: "pn2", def: printing(POSH), owner: P2, zone: "play" },
      { key: "steal", def: tactic({ name: "Steal Location", cost: 0, behavior: { abilities: [{ id: "tl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P1, zone: "hand" }
    ]
  });

clause(POSH, "0:unique", "taking control of the opponent's Poshernacle while I control mine makes me choose which to keep; the loser is destroyed", () => {
  const g = stealPoshBoard();
  playRaw(g.engine, P1, g.id("steal"), { selected: { t: [g.id("pn2")] } });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("pn"), g.id("pn2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pn") } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.equal(zoneOf(g.engine, g.id("pn2")), "discard", "the stolen copy is destroyed to its owner's discard pile");
});

clause(POSH, "0:unique", "after I choose which Poshernacle to keep when I took the opponent's copy, the game goes on: the response window closes", () => {
  const g = stealPoshBoard();
  playRaw(g.engine, P1, g.id("steal"), { selected: { t: [g.id("pn2")] } });
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("pn") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "the steal finished resolving");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "and the turn can end");
});

// --- deploying it (printed cost, threshold and structure)

clause(POSH, "0:unique", "it deploys for exactly its printed cost of 4 with [G][G][G], and enters play as a location", () => {
  const g = devBoard([{ key: "pn", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 6 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("pn"));
  assert.equal(zoneOf(g.engine, g.id("pn")), "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("pn")), ["location"]);
  assert.equal(before - ready(g.engine), 4, "paid exactly 4");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(POSH, "0:unique", "it is refused one resource short (3 Greed) and without [G][G][G] (2 Greed + 2 Rage), and nothing is paid", () => {
  const short = devBoard([{ key: "pn", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 3 })]);
  refused(() => playRaw(short.engine, P1, short.id("pn")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("pn")), "hand");
  assert.equal(ready(short.engine), 3, "nothing paid");
  const noThreshold = devBoard([{ key: "pn", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 2, rage: 4 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pn")), "only [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pn")), "hand");
  const ok = devBoard([{ key: "pn", def: printing(POSH), owner: P1, zone: "hand" }, ...res({ greed: 3, rage: 1 })]);
  playAndResolve(ok.engine, P1, ok.id("pn"));
  assert.equal(zoneOf(ok.engine, ok.id("pn")), "play", "control: [G][G][G] and 4 resources works");
});

clause(POSH, "0:unique", "it has structure 5: 4 damage does not destroy it, 5 does", () => {
  const hit = (n: number) => {
    const g = poshBoard({
      extra: [{ key: "zap", def: tactic({ name: "Hit Location", cost: 0, behavior: { abilities: [{ id: "hl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }] } }), owner: P2, zone: "hand" }]
    });
    playAndResolve(g.engine, P2, g.id("zap"), { selected: { t: [g.id("pn")] } });
    return g;
  };
  const four = hit(4);
  assert.equal(zoneOf(four.engine, four.id("pn")), "play");
  assert.equal(four.engine.getStat(four.id("pn"), "structure"), 5);
  const five = hit(5);
  assert.equal(zoneOf(five.engine, five.id("pn")), "discard");
});

// --- the three start-of-turn rules fire together

clause(POSH, "1:rule", "at the start of my turn the three Poshernacle rules are raised together and I order them", () => {
  const g = poshBoard({ extra: [drawer()] });
  beginTurn(g, P1);
  const pc = expectPending(g.engine, "orderTriggers");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(
    (pc.triggers as { sourceId: string; abilityId: string }[]).map((t) => t.sourceId),
    [g.id("pn"), g.id("pn"), g.id("pn")]
  );
  assert.equal((pc.triggers as unknown[]).length, 3);
});

// --- 1:rule — At the start of your turn, you may use an ability.

clause(POSH, "1:rule", "I am offered the choice at the start of MY turn, and the candidates are my face-up cards that have an activated ability", () => {
  const g = poshBoard({
    extra: [
      drawer(),
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "fd", def: drawerChar({ name: "Face Down Drawer" }), owner: P1, zone: "play", faceDown: true },
      { key: "theirs", def: drawerChar({ name: "Their Drawer" }), owner: P2, zone: "play" },
      { key: "inHand", def: drawerChar({ name: "Hand Drawer" }), owner: P1, zone: "hand" }
    ]
  });
  beginTurn(g, P1);
  const log = driveStart(g, { stopAt: "useAnyAbility" });
  assert.deepEqual(log.slice(0, 1), ["orderTriggers"]);
  const pc = expectPending(g.engine, "useAnyAbility");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.candidateCardIds, [g.id("drawer")], "only my face-up card with an activated ability");
});

clause(POSH, "1:rule", "an item or location with an activated ability is a candidate too ('an ability' of any card I control)", () => {
  const g = poshBoard({
    extra: [
      { key: "gadget", def: item({ name: "Gadget", behavior: { abilities: [{ id: "g", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", behavior: { abilities: [{ id: "p", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" }
    ]
  });
  beginTurn(g, P1);
  driveStart(g, { stopAt: "useAnyAbility" });
  const pc = expectPending(g.engine, "useAnyAbility");
  assert.deepEqual([...(pc.candidateCardIds as string[])].sort(), [g.id("gadget"), g.id("place")].sort());
});

clause(POSH, "1:rule", "using the drawer's ability resolves its effect: I draw 1 card", () => {
  const g = poshBoard({ extra: [drawer()] });
  const topBefore = deckOf(g.engine, P1)[0];
  beginTurn(g, P1);
  const log = driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "drawer", ability: "draw1" } });
  assert.ok(log.includes("useAnyAbility") && log.includes("useTargetAbility"), "the card and then the ability are chosen");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), [topBefore], "the ability drew exactly 1 card (the draw trigger was declined)");
});

clause(POSH, "1:rule", "it is a 'may': declining the offer uses no ability", () => {
  const g = poshBoard({ extra: [drawer()] });
  beginTurn(g, P1);
  driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: "decline" });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0, "no ability was used");
});

clause(POSH, "1:rule", "the chosen ability's cost is paid: a 'Pay 2' ability attaches exactly 2 resources", () => {
  const g = poshBoard({ extra: [payer(2), ...res({ greed: 4 })] });
  beginTurn(g, P1);
  const before = ready(g.engine);
  driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "payer", ability: "pay" } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(g.engine), 2, "exactly 2 resources were paid");
  assert.equal(handOf(g.engine, P1).length, 1, "and the effect happened");
});

clause(POSH, "1:rule", "an ability whose cost I cannot pay cannot be used: 'Pay 2' with 1 resource is refused and nothing happens", () => {
  const g = poshBoard({ extra: [payer(2), ...res({ greed: 1 })] });
  beginTurn(g, P1);
  const before = ready(g.engine);
  refused(
    () => driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "payer", ability: "pay" } }),
    "paying 2 with 1 resource"
  );
  assert.equal(handOf(g.engine, P1).length, 0, "no draw");
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(POSH, "1:rule", "an ability's printed threshold applies: a [R][R][R] ability cannot be used without three Rage (CR 502.2)", () => {
  const g = poshBoard({ extra: [gated("rrr"), ...res({ greed: 4 })] });
  beginTurn(g, P1);
  refused(
    () => driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "gated", ability: "gated" } }),
    "the threshold is not met"
  );
  assert.equal(handOf(g.engine, P1).length, 0, "the ability did nothing");
  const ok = poshBoard({ extra: [gated("rrr"), ...res({ rage: 3 })] });
  beginTurn(ok, P1);
  driveStart(ok, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "gated", ability: "gated" } });
  assert.equal(handOf(ok.engine, P1).length, 1, "control: with [R][R][R] it works");
});

clause(POSH, "1:rule", "a used ability picks its targets: a pinger's ping lands on exactly the character I pick", () => {
  const g = poshBoard({ extra: [pinger(), { key: "a", def: character({ name: "A", life: 5 }), owner: P2, zone: "play" }, { key: "b", def: character({ name: "B", life: 5 }), owner: P2, zone: "play" }] });
  beginTurn(g, P1);
  driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "pinger", ability: "ping", selected: { t: ["a"] } } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("a")), 1);
  assert.equal(damageOf(g.engine, g.id("b")), 0);
  assert.equal(damageOf(g.engine, g.id("pinger")), 0);
});

clause(POSH, "1:rule", "choosing a card but then declining to pick one of its abilities uses nothing, and the other two rules still happen", () => {
  const g = poshBoard({ extra: [drawer()] });
  beginTurn(g, P1);
  const log = driveStart(g, { order: ["posh-use", "posh-draw", "posh-influence"], draw: true, use: { card: "drawer", ability: "" } });
  assert.ok(log.includes("useTargetAbility"), "log.includes(\"useTargetAbility\")");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 1, "only the rule's draw: the drawer's ability was not used");
  assert.equal(influenceOf(g.engine, P1), 31);
});

clause(POSH, "1:rule", "a deplete cost of the used ability is paid: the source ends up depleted", () => {
  const g = poshBoard({
    extra: [
      {
        key: "tapper",
        def: character({ name: "Tapper", behavior: { abilities: [{ id: "tap", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
        owner: P1,
        zone: "play"
      }
    ]
  });
  beginTurn(g, P1);
  assert.equal(isDepleted(g.engine, g.id("tapper")), false, "setup: ready");
  driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "tapper", ability: "tap" } });
  assert.equal(isDepleted(g.engine, g.id("tapper")), true, "the deplete cost was paid");
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(POSH, "1:rule", "the faction's own abilities are abilities of a card I control: the faction is among the candidates", () => {
  const f = developFaction();
  f.faction = { ...f.faction!, abilities: [{ id: "fdraw", name: "Faction Draw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] };
  const g = poshBoard({ faction: f });
  beginTurn(g, P1);
  driveStart(g, { stopAt: "useAnyAbility" });
  const pc = expectPending(g.engine, "useAnyAbility");
  assert.ok((pc.candidateCardIds as string[]).includes(factionOf(g.engine, P1)), "the faction card is offered");
});

clause(POSH, "1:rule", "with no ability to use there is no offer at all, and the other two rules still happen", () => {
  const g = poshBoard({ extra: [{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }] });
  beginTurn(g, P1);
  const log = driveStart(g, { order: ["posh-use", "posh-draw", "posh-influence"], draw: true });
  assert.ok(!log.includes("useAnyAbility"), "no offer");
  assert.equal(handOf(g.engine, P1).length, 1, "I drew");
  assert.equal(influenceOf(g.engine, P1), 31, "and gained influence");
});

clause(POSH, "1:rule", "it is at the start of MY turn only: at the start of the opponent's turn I am not offered anything", () => {
  const g = poshBoard({ active: P1, extra: [drawer()] });
  beginTurn(g, P2);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "no ability offer, no draw offer on their turn");
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(POSH, "1:rule", "the ability used is on a card I control: an opponent's character with an ability is never a candidate, even one I own but they control", () => {
  const g = poshBoard({
    extra: [
      { key: "owned", def: drawerChar({ name: "Owned By Me" }), owner: P1, controller: P2, zone: "play" },
      { key: "mine", def: drawerChar({ name: "Mine" }), owner: P2, controller: P1, zone: "play" }
    ]
  });
  beginTurn(g, P1);
  driveStart(g, { stopAt: "useAnyAbility" });
  const pc = expectPending(g.engine, "useAnyAbility");
  assert.deepEqual(pc.candidateCardIds, [g.id("mine")], "controlled, not owned");
});

clause(POSH, "1:rule", "using an ability follows the ability rules (CR 606.1f): the opponent may respond before its effect happens", () => {
  const g = poshBoard({ extra: [drawer(), { key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  beginTurn(g, P1);
  driveStart(g, { order: ["posh-draw", "posh-influence", "posh-use"], draw: false, use: { card: "drawer", ability: "draw1" }, stopAfter: "useTargetAbility" });
  const window = g.engine.state.responseWindow;
  assert.ok(window, "a response window is open for the ability I used");
  assert.equal(window.priorityPlayerId, P2, "my opponent may respond");
});

clause(POSH, "1:rule", "a Poshernacle in my hand, in my discard pile, or face-down does nothing at the start of my turn", () => {
  for (const [label, zone, faceDown] of [
    ["hand", "hand", undefined],
    ["discard pile", "discard", undefined],
    ["face-down", "play", true]
  ] as const) {
    const g = poshBoard({ zone, faceDown, extra: [drawer()] });
    beginTurn(g, P1);
    assert.equal(g.engine.state.pendingChoice, undefined, `${label}: no offer`);
    assert.equal(influenceOf(g.engine, P1), 30, `${label}: no influence`);
    assert.deepEqual(handOf(g.engine, P1).filter((id) => id !== g.id("pn")), [], `${label}: no draw`);
  }
});

clause(POSH, "1:rule", "'your turn' is its controller's turn: if the opponent controls my Poshernacle, THEY are offered the ability at the start of their turn, and I am not at mine", () => {
  const g = poshBoard({
    active: P1,
    controller: P2,
    extra: [{ key: "theirDrawer", def: drawerChar({ name: "Their Drawer" }), owner: P2, zone: "play" }, drawer()]
  });
  beginTurn(g, P2);
  const pc = expectPending(g.engine, "orderTriggers");
  assert.equal(pc.playerId, P2, "the controller orders");
  driveStart(g, { stopAt: "useAnyAbility" });
  const offer = expectPending(g.engine, "useAnyAbility");
  assert.equal(offer.playerId, P2);
  assert.deepEqual(offer.candidateCardIds, [g.id("theirDrawer")]);
});

// --- 2:rule — At the start of your turn, you may draw a card.

clause(POSH, "2:rule", "at the start of my turn I may draw a card: accepting draws exactly 1 card, the top card of my deck", () => {
  const g = poshBoard();
  const deckBefore = deckOf(g.engine, P1);
  beginTurn(g, P1);
  const log = driveStart(g, { draw: true });
  assert.ok(log.includes("mayPay"), "I am asked");
  assert.deepEqual(handOf(g.engine, P1), [deckBefore[0]], "exactly the top card");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore.slice(1));
});

clause(POSH, "2:rule", "the 'may draw' question is put to ME, the controller, and the card is drawn into MY hand", () => {
  const g = poshBoard();
  beginTurn(g, P1);
  driveStart(g, { stopAt: "mayPay" });
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cost, [], "it costs nothing");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(handOf(g.engine, P1).length, 1);
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(POSH, "2:rule", "it is a 'may': declining draws nothing", () => {
  const g = poshBoard();
  const deckBefore = deckOf(g.engine, P1);
  beginTurn(g, P1);
  driveStart(g, { draw: false });
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.deepEqual(deckOf(g.engine, P1), deckBefore);
});

clause(POSH, "2:rule", "the draw costs nothing: accepting does not attach any resource", () => {
  const g = poshBoard({ extra: res({ greed: 3 }) });
  beginTurn(g, P1);
  const before = ready(g.engine);
  driveStart(g, { draw: true });
  assert.equal(ready(g.engine), before);
});

clause(POSH, "2:rule", "with an empty deck the draw simply fails: no loss, no crash", () => {
  const g = poshBoard({ deck: 0 });
  beginTurn(g, P1);
  driveStart(g, { draw: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.result, undefined, "running out of cards does not lose the game (CR 102.1a)");
});

clause(POSH, "2:rule", "it is at the start of MY turn: nothing is drawn at the start of the opponent's turn", () => {
  const g = poshBoard({ active: P1 });
  beginTurn(g, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(POSH, "2:rule", "the opponent's cards are untouched: only MY deck is drawn from", () => {
  const g = poshBoard();
  const theirs = deckOf(g.engine, P2);
  beginTurn(g, P1);
  driveStart(g, { draw: true });
  assert.deepEqual(deckOf(g.engine, P2), theirs);
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(POSH, "2:rule", "a Poshernacle in my hand, discard pile, or face-down draws nothing", () => {
  for (const [label, zone, faceDown] of [
    ["hand", "hand", undefined],
    ["discard pile", "discard", undefined],
    ["face-down", "play", true]
  ] as const) {
    const g = poshBoard({ zone, faceDown });
    beginTurn(g, P1);
    assert.equal(g.engine.state.pendingChoice, undefined, `${label}: no prompt`);
    assert.deepEqual(handOf(g.engine, P1).filter((id) => id !== g.id("pn")), [], label);
  }
});

clause(POSH, "2:rule", "'your turn' is its controller's: if the opponent controls it, THEY may draw at the start of their turn and I draw nothing at mine", () => {
  const g = poshBoard({ active: P1, controller: P2 });
  const theirs = deckOf(g.engine, P2);
  beginTurn(g, P2);
  driveStart(g, { draw: true });
  assert.deepEqual(handOf(g.engine, P2), [theirs[0]], "the controller draws from THEIR deck");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(POSH, "2:rule", "the draw does not depend on how I order the three rules or on what I do with the ability offer: using an ability first still lets me draw", () => {
  const g = poshBoard({ extra: [drawer()] });
  const topBefore = deckOf(g.engine, P1)[0];
  beginTurn(g, P1);
  driveStart(g, { order: ["posh-use", "posh-draw", "posh-influence"], draw: true, use: { card: "drawer", ability: "draw1" } });
  assert.equal(handOf(g.engine, P1).length, 2, "one card from the ability and one from the rule");
  assert.ok(handOf(g.engine, P1).includes(topBefore), "handOf(g.engine, P1).includes(topBefore)");
});

for (const order of ORDER_LIST.filter((o) => useBefore(o, "posh-draw"))) {
  clause(POSH, "2:rule", `declining the ability offer, which I ordered before the draw (${orderLabel(order)}), must not cost me the draw`, () => {
    const g = poshBoard({ extra: [drawer()] });
    beginTurn(g, P1);
    driveStart(g, { order, draw: true, use: "decline" });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(handOf(g.engine, P1).length, 1, "the three rules are independent: I still drew");
  });
}

for (const order of ORDER_LIST.filter((o) => !useBefore(o, "posh-draw"))) {
  clause(POSH, "2:rule", `declining the ability offer, which I ordered after the draw (${orderLabel(order)}), still leaves me with the drawn card`, () => {
    const g = poshBoard({ extra: [drawer()] });
    beginTurn(g, P1);
    driveStart(g, { order, draw: true, use: "decline" });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(handOf(g.engine, P1).length, 1, "I drew");
  });
}

// --- 3:rule — At the start of your turn, your faction gains 1 influence.

clause(POSH, "3:rule", "at the start of my turn my faction gains exactly 1 influence (30 to 31), with no question asked", () => {
  const g = poshBoard();
  assert.equal(influenceOf(g.engine, P1), 30);
  beginTurn(g, P1);
  driveStart(g, { draw: false });
  assert.equal(influenceOf(g.engine, P1), 31);
});

clause(POSH, "3:rule", "it is mandatory: it happens whatever I answer to the draw offer", () => {
  for (const draw of [true, false]) {
    const g = poshBoard();
    beginTurn(g, P1);
    driveStart(g, { draw });
    assert.equal(influenceOf(g.engine, P1), 31, `draw answered ${draw}`);
  }
});

clause(POSH, "3:rule", "only MY faction gains it: the opponent's influence is unchanged", () => {
  const g = poshBoard();
  beginTurn(g, P1);
  driveStart(g);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(POSH, "3:rule", "it is at the start of MY turn only: nothing at the start of the opponent's turn", () => {
  const g = poshBoard({ active: P1 });
  beginTurn(g, P2);
  assert.equal(influenceOf(g.engine, P1), 30);
  assert.equal(influenceOf(g.engine, P2), 30);
});

clause(POSH, "3:rule", "it repeats every turn of mine: two of my turns give +2", () => {
  const g = poshBoard();
  beginTurn(g, P1);
  driveStart(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  driveStart(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(influenceOf(g.engine, P1), 32);
});

clause(POSH, "3:rule", "a Poshernacle in my hand, discard pile, or face-down gains nothing", () => {
  for (const [label, zone, faceDown] of [
    ["hand", "hand", undefined],
    ["discard pile", "discard", undefined],
    ["face-down", "play", true]
  ] as const) {
    const g = poshBoard({ zone, faceDown });
    beginTurn(g, P1);
    assert.equal(influenceOf(g.engine, P1), 30, label);
  }
});

clause(POSH, "3:rule", "a destroyed Poshernacle stops giving influence", () => {
  const g = poshBoard({ extra: [{ key: "kill", def: moverTactic("discard"), owner: P2, zone: "hand" }] });
  playAndResolve(g.engine, P2, g.id("kill"), { selected: { t: [g.id("pn")] } });
  assert.equal(zoneOf(g.engine, g.id("pn")), "discard");
  beginTurn(g, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P1), 30);
});

clause(POSH, "3:rule", "'your faction' is the controller's: if the opponent controls it, THEIR faction gains 1 and mine gains none", () => {
  const g = poshBoard({ active: P1, controller: P2 });
  beginTurn(g, P2);
  driveStart(g, { draw: false });
  assert.equal(influenceOf(g.engine, P2), 31, "the controller's faction");
  assert.equal(influenceOf(g.engine, P1), 30, "the owner's faction");
});

for (const order of ORDER_LIST.filter((o) => useBefore(o, "posh-influence"))) {
  clause(POSH, "3:rule", `declining the ability offer, which I ordered before the influence (${orderLabel(order)}), must not cost me the influence`, () => {
    const g = poshBoard({ extra: [drawer()] });
    beginTurn(g, P1);
    driveStart(g, { order, draw: true, use: "decline" });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(influenceOf(g.engine, P1), 31, "the three rules are independent: I still gained 1 influence");
  });
}

for (const order of ORDER_LIST.filter((o) => !useBefore(o, "posh-influence"))) {
  clause(POSH, "3:rule", `declining the ability offer, which I ordered after the influence (${orderLabel(order)}), still leaves me with the influence`, () => {
    const g = poshBoard({ extra: [drawer()] });
    beginTurn(g, P1);
    driveStart(g, { order, draw: true, use: "decline" });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(influenceOf(g.engine, P1), 31, "I gained 1 influence");
  });
}

// =============================================================================
// Tiny Shiny
// COST: Pick a character.
// EFFECT: Reduce the next damage inflicted to the character this turn by 2. Put
// this card into play under its owner's control as a face-down resource instead
// of into their discard pile.
// Tactic, banker, cost 3, [G].
// =============================================================================

const SHINY = "580a6694-9b65-4aa5-9668-a18ddfd3f06a";

/** A free tactic (id "ctr") that terminates the item it responds to. */
const COUNTER = tactic({ id: "seed-2-03-counter", name: "Counter", cost: 0, behavior: { abilities: [{ id: "ctr", type: "activated", effects: [{ type: "terminate", scope: "respondedItem" }] }] } });

function shinyBoard(o: { greed?: number; rage?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "ts", def: printing(SHINY), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Protected", life: 9 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Bystander", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9, strength: 4, speed: 3 }), owner: P2, zone: "play" },
      ...res({ greed: o.greed ?? 4, rage: o.rage ?? 0 }),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** Plays Tiny Shiny on `pick` (placement key) and lets it resolve. */
function shiny(g: Game, pick = "c"): void {
  playAndResolve(g.engine, P1, g.id("ts"), { selected: { t: [g.id(pick)] } });
}

/** Plays the free damage tactic `key` (pick "t") on `pick`. */
function zap(g: Game, key: string, pick: string, player: PlayerId = P1): void {
  playAndResolve(g.engine, player, g.id(key), { selected: { t: [g.id(pick)] } });
}

const zaps = (...amounts: number[]): CardPlacement[] => amounts.map((n, i) => ({ key: `zap${i}`, def: damageTactic(n, `Zap ${n} #${i}`), owner: P1, zone: "hand" as const }));

clause(SHINY, "0:ability", "it deploys for exactly its printed cost of 3 with [G]: 3 resources are paid", () => {
  const g = shinyBoard({ greed: 5 });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  assert.equal(before - ready(g.engine), 3, "paid exactly 3 when played (before it resolves)");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SHINY, "0:ability", "it is refused one resource short (2 Greed) and without [G] (3 Rage), and nothing is paid or picked", () => {
  const short = shinyBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("ts"), { selected: { t: [short.id("c")] } }), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("ts")), "hand");
  assert.equal(ready(short.engine), 2, "nothing paid");
  const noThreshold = shinyBoard({ greed: 0, rage: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ts"), { selected: { t: [noThreshold.id("c")] } }), "no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ts")), "hand");
  assert.equal(ready(noThreshold.engine), 3);
  const ok = shinyBoard({ greed: 1, rage: 2 });
  shiny(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ts")), "play", "control: one [G] and 3 resources works");
});

clause(SHINY, "0:ability", "COST: Pick a character: any character in play can be picked, mine or the opponent's", () => {
  for (const pick of ["c", "foe"]) {
    const g = shinyBoard();
    shiny(g, pick);
    assert.equal(g.engine.state.pendingChoice, undefined, pick);
    assert.equal(zoneOf(g.engine, g.id("ts")), "play", `${pick}: it resolved`);
  }
});

clause(SHINY, "0:ability", "exactly one character must be picked: no pick and two picks are refused", () => {
  const none = shinyBoard();
  refused(() => playRaw(none.engine, P1, none.id("ts"), { selected: {} }), "no pick");
  assert.equal(zoneOf(none.engine, none.id("ts")), "hand");
  assert.equal(ready(none.engine), 4, "nothing paid");
  const two = shinyBoard();
  refused(() => playRaw(two.engine, P1, two.id("ts"), { selected: { t: [two.id("c"), two.id("d")] } }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("ts")), "hand");
  const same = shinyBoard();
  refused(() => playRaw(same.engine, P1, same.id("ts"), { selected: { t: [same.id("c"), same.id("c")] } }), "the same character twice");
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdChar", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"],
  ["theirHand", "a character card in the opponent's hand"]
] as const) {
  clause(SHINY, "0:ability", `cannot pick ${label}; a legal character pick works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdChar", def: character({ name: "Face Down", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }
    ];
    const bad = shinyBoard({ extra });
    refused(() => playRaw(bad.engine, P1, bad.id("ts"), { selected: { t: [bad.id(key)] } }), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("ts")), "hand");
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = shinyBoard({ extra });
    shiny(good, "c");
    assert.equal(zoneOf(good.engine, good.id("ts")), "play", "control: a character in play can be picked");
  });
}

clause(SHINY, "0:ability", "a faction cannot be picked (CR 202.9): neither mine nor the opponent's", () => {
  const mine = shinyBoard();
  refused(() => playRaw(mine.engine, P1, mine.id("ts"), { selected: { t: [factionOf(mine.engine, P1)] } }), "picking my faction");
  assert.equal(zoneOf(mine.engine, mine.id("ts")), "hand");
  const theirs = shinyBoard();
  refused(() => playRaw(theirs.engine, P1, theirs.id("ts"), { selected: { t: [factionOf(theirs.engine, P2)] } }), "picking their faction");
  assert.equal(zoneOf(theirs.engine, theirs.id("ts")), "hand");
});

clause(SHINY, "0:ability", "the next damage of 3 to the picked character is reduced by 2: it takes 1", () => {
  const g = shinyBoard({ extra: zaps(3) });
  shiny(g);
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 1);
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
});

clause(SHINY, "0:ability", "a bigger hit is reduced by exactly 2: 5 damage becomes 3", () => {
  const g = shinyBoard({ extra: zaps(5) });
  shiny(g);
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 3);
});

clause(SHINY, "0:ability", "damage of exactly 2 is reduced to nothing, and 1 damage is reduced to 0 (never below 0)", () => {
  for (const n of [2, 1]) {
    const g = shinyBoard({ extra: zaps(n) });
    shiny(g);
    zap(g, "zap0", "c");
    assert.equal(damageOf(g.engine, g.id("c")), 0, `${n} damage`);
  }
});

clause(SHINY, "0:ability", "without Tiny Shiny the same damage is not reduced (control)", () => {
  const g = shinyBoard({ extra: zaps(3) });
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 3);
});

clause(SHINY, "0:ability", "only the NEXT damage is reduced: a second hit of 3 deals its full 3", () => {
  const g = shinyBoard({ extra: zaps(3, 3) });
  shiny(g);
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 1);
  zap(g, "zap1", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 4, "1 + the full 3");
});

clause(SHINY, "0:ability", "a hit reduced to 0 still counts as the next damage: the reduction is used up", () => {
  const g = shinyBoard({ extra: zaps(1, 3) });
  shiny(g);
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 0);
  zap(g, "zap1", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 3, "the second hit is not reduced any more");
});

clause(SHINY, "0:ability", "only the PICKED character is protected: damage to another character is not reduced", () => {
  const g = shinyBoard({ extra: zaps(3) });
  shiny(g, "c");
  zap(g, "zap0", "d");
  assert.equal(damageOf(g.engine, g.id("d")), 3);
  assert.equal(damageOf(g.engine, g.id("c")), 0);
});

clause(SHINY, "0:ability", "damage to another character does not use up the reduction: the picked character's next hit is still reduced", () => {
  const g = shinyBoard({ extra: zaps(3, 3) });
  shiny(g, "c");
  zap(g, "zap0", "d");
  zap(g, "zap1", "c");
  assert.equal(damageOf(g.engine, g.id("d")), 3);
  assert.equal(damageOf(g.engine, g.id("c")), 1, "still reduced");
});

clause(SHINY, "0:ability", "it protects the opponent's character just as well when I pick it", () => {
  const g = shinyBoard({ extra: zaps(3) });
  shiny(g, "foe");
  zap(g, "zap0", "foe");
  assert.equal(damageOf(g.engine, g.id("foe")), 1);
});

clause(SHINY, "0:ability", "the reduced damage can still destroy the character: 5 - 2 = 3 destroys a 3-life character", () => {
  const g = shinyBoard({ extra: [{ key: "frail", def: character({ name: "Frail", life: 3 }), owner: P1, zone: "play" }, ...zaps(5)] });
  shiny(g, "frail");
  zap(g, "zap0", "frail");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard", "3 damage on 3 life");
});

clause(SHINY, "0:ability", "it only reduces DAMAGE: a destroy effect still destroys the protected character", () => {
  const g = shinyBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  shiny(g, "c");
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("c")), "discard");
});

clause(SHINY, "0:ability", "two Tiny Shinys on one character each reduce the next damage: 5 damage - 2 - 2 = 1", () => {
  const g = shinyBoard({ greed: 8, extra: [{ key: "ts2", def: printing(SHINY), owner: P1, zone: "hand" }, ...zaps(5)] });
  shiny(g);
  playAndResolve(g.engine, P1, g.id("ts2"), { selected: { t: [g.id("c")] } });
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 1);
});

clause(SHINY, "0:ability", "battle damage is damage: a 4-strength attacker blocked by the protected character deals 4 - 2 = 2", () => {
  const g = shinyBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(battleOf(g.engine), "the battle goes on");
  declareBlockers(g.engine, P1, [g.id("c")]);
  autoResolveBattle(g.engine);
  assert.equal(damageOf(g.engine, g.id("c")), 2, "4 battle damage reduced by 2");
});

clause(SHINY, "0:ability", "it lasts only this turn: damage on the opponent's next turn is not reduced", () => {
  const g = shinyBoard({ extra: [{ key: "zapT", def: damageTactic(3), owner: P2, zone: "hand" }] });
  shiny(g, "c");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  zap(g, "zapT", "c", P2);
  assert.equal(damageOf(g.engine, g.id("c")), 3, "the reduction ended with the turn it was played");
});

clause(SHINY, "0:ability", "played in response on the opponent's turn it protects through that turn: their 3 damage is reduced to 1", () => {
  const g = shinyBoard({ active: P2, extra: [{ key: "zapT", def: damageTactic(3), owner: P2, zone: "hand" }, { key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "play");
  zap(g, "zapT", "c", P2);
  assert.equal(damageOf(g.engine, g.id("c")), 1);
});

// --- Put this card into play ... as a face-down resource instead of into their discard pile

clause(SHINY, "0:ability", "afterwards Tiny Shiny is in play under its owner's control as a face-down resource, not in the discard pile", () => {
  const g = shinyBoard();
  shiny(g);
  assert.equal(zoneOf(g.engine, g.id("ts")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ts")), true);
  assert.equal(controllerOf(g.engine, g.id("ts")), P1);
  assert.equal(g.engine.state.cards[g.id("ts")].ownerId, P1);
  assert.equal(g.engine.isResource(g.id("ts")), true, "it is a resource");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("ts")), "not in the discard pile");
  assert.ok(playOf(g.engine, P1).includes(g.id("ts")), "playOf(g.engine, P1).includes(g.id(\"ts\"))");
});

clause(SHINY, "0:ability", "the new resource is ready to use and provides Volition: 4 resources - 3 paid + the face-down Tiny Shiny = 2 ready", () => {
  const g = shinyBoard();
  const volitionBefore = g.engine.getThresholds(P1).volition ?? 0;
  shiny(g);
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.state.cards[g.id("ts")].attachedTo, undefined, "it is not attached (spent)");
  assert.equal((g.engine.getThresholds(P1).volition ?? 0) - volitionBefore, 1, "one Volition icon");
});

clause(SHINY, "0:ability", "the face-down Tiny Shiny can pay for something later (as a resource)", () => {
  const g = shinyBoard({ greed: 3, extra: [{ key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "hand" }] });
  shiny(g);
  assert.equal(ready(g.engine), 1);
  playAndResolve(g.engine, P1, g.id("one"));
  assert.equal(zoneOf(g.engine, g.id("one")), "play", "paid its 1 with the face-down Tiny Shiny");
  assert.equal(ready(g.engine), 0);
});

clause(SHINY, "0:ability", "while it is still being deployed it is not yet a resource: it waits in the 'deploying' area until it resolves", () => {
  const g = shinyBoard();
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("ts")), "deploying");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "play");
});

clause(SHINY, "0:ability", "a face-down Tiny Shiny has no printed FLIP UP: it cannot be flipped up", () => {
  const g = shinyBoard({ extra: [{ key: "fd", def: printing(SHINY), owner: P1, zone: "play", faceDown: true }] });
  refused(() => flipUpRaw(g.engine, P1, g.id("fd"), { t: [g.id("c")] }), "Tiny Shiny has no FLIP UP");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true);
});

clause(SHINY, "0:ability", "played in response on the opponent's turn it still becomes MY face-down resource (owner's control)", () => {
  const g = shinyBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ts")), true);
  assert.equal(controllerOf(g.engine, g.id("ts")), P1);
});

clause(SHINY, "0:ability", "if Tiny Shiny is terminated before it resolves it goes to its owner's discard pile (CR 314.1) and protects nothing", () => {
  const g = shinyBoard({ active: P1, extra: [{ key: "ctr", def: COUNTER, owner: P2, zone: "hand" }, ...zaps(3)] });
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  playRaw(g.engine, P2, g.id("ctr"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard", "a terminated card is put into its owner's discard pile");
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 3, "no reduction");
});

// =============================================================================
// 31337!
// This turn, you control an additional [E][E][E][E]. Put this card into play
// under its owner's control as a face-down resource instead of into their
// discard pile.
// Tactic, gearsmith, cost 3, [E].
// =============================================================================

const LEET = "b7d1ede1-afad-43f3-bc68-66d3d5c523b1";

/** A free character that needs `n` Elitism icons (cost 0), placed in my hand under `key`. */
const needsE = (n: number, key = `needs${n}`): CardPlacement => ({
  key,
  def: character({ name: `Needs ${n} E`, cost: 0, threshold: "e".repeat(n) }),
  owner: P1,
  zone: "hand"
});

function leetBoard(o: { elitism?: number; greed?: number; rage?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "l", def: printing(LEET), owner: P1, zone: "hand" },
      ...res({ elitism: o.elitism ?? 1, greed: o.greed ?? 2, rage: o.rage ?? 0 }),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

const leet = (g: Game): void => playAndResolve(g.engine, P1, g.id("l"));

clause(LEET, "0:rule", "it deploys for exactly its printed cost of 3 with [E]: 3 resources are paid when it is played", () => {
  const g = leetBoard({ greed: 4 });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("l"));
  assert.equal(before - ready(g.engine), 3);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(LEET, "0:rule", "it is refused one resource short (2 resources) and without [E] (3 Greed), and nothing is paid", () => {
  const short = leetBoard({ elitism: 1, greed: 1 });
  refused(() => playRaw(short.engine, P1, short.id("l")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("l")), "hand");
  assert.equal(ready(short.engine), 2);
  const noThreshold = leetBoard({ elitism: 0, greed: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("l")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("l")), "hand");
  assert.equal(ready(noThreshold.engine), 3);
  const ok = leetBoard({ elitism: 1, greed: 2 });
  leet(ok);
  assert.equal(zoneOf(ok.engine, ok.id("l")), "play", "control: one [E] and 3 resources works");
});

clause(LEET, "0:rule", "this turn I control an additional [E][E][E][E]: my Elitism icons go from 1 to 5", () => {
  const g = leetBoard();
  assert.equal(elitism(g.engine), 1);
  leet(g);
  assert.equal(elitism(g.engine), 5);
});

clause(LEET, "0:rule", "exactly four additional [E]: it adds no other icon (no Greed, no Rage)", () => {
  const g = leetBoard({ greed: 2, rage: 0 });
  const before = g.engine.getThresholds(P1);
  leet(g);
  const after = g.engine.getThresholds(P1);
  assert.equal(after.greed ?? 0, before.greed ?? 0);
  assert.equal(after.rage ?? 0, before.rage ?? 0);
  assert.equal(after.deception ?? 0, before.deception ?? 0);
  assert.equal(after.obsession ?? 0, before.obsession ?? 0);
  assert.equal((after.elitism ?? 0) - (before.elitism ?? 0), 4);
});

clause(LEET, "0:rule", "the additional icons really count for thresholds: a card needing [E]x5 can be deployed afterwards, and one needing [E]x6 cannot", () => {
  const before = leetBoard({ extra: [needsE(5)] });
  refused(() => playRaw(before.engine, P1, before.id("needs5")), "only one [E] before 31337!");
  const ok = leetBoard({ extra: [needsE(5)] });
  leet(ok);
  playAndResolve(ok.engine, P1, ok.id("needs5"));
  assert.equal(zoneOf(ok.engine, ok.id("needs5")), "play", "five [E] after 31337!");
  const six = leetBoard({ extra: [needsE(6)] });
  leet(six);
  refused(() => playRaw(six.engine, P1, six.id("needs6")), "six [E] is one more than 1 + 4");
  assert.equal(zoneOf(six.engine, six.id("needs6")), "hand");
});

clause(LEET, "0:rule", "the additional icons are not resources: nothing extra can be paid with them", () => {
  const g = leetBoard();
  leet(g);
  assert.equal(ready(g.engine), 1, "3 paid of 3, plus the face-down 31337! itself");
});

clause(LEET, "0:rule", "the additional icons meet an activated ability's threshold too", () => {
  const g = leetBoard({
    extra: [
      {
        key: "gadget",
        def: item({ name: "Gadget", behavior: { abilities: [{ id: "g", type: "activated", threshold: "eeeee", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
        owner: P1,
        zone: "play"
      },
      ...fillers("deck", 2, P1, "deck")
    ]
  });
  refused(() => actRaw(g.engine, P1, g.id("gadget"), "g"), "[E]x5 is not met yet");
  leet(g);
  activate(g.engine, P1, g.id("gadget"), "g");
  assert.equal(handOf(g.engine, P1).length, 1, "after 31337! the [E]x5 ability works");
});

clause(LEET, "0:rule", "the additional icons count wherever 'for each [E] you control' is used: a 3p1c D00dm4k3r gives +4/+4 more", () => {
  const g = leetBoard({
    extra: [
      { key: "host", def: character({ name: "Host", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "dm", def: printing("5e8c791e-940b-4edf-95e3-3f043072179a"), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 2, "1 + one [E]");
  leet(g);
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 6, "1 + five [E]");
  assert.equal(g.engine.getStat(g.id("host"), "life"), 6);
});

clause(LEET, "0:rule", "it is 'this turn' only: the extra [E][E][E][E] are gone once the turn is over", () => {
  const g = leetBoard({ extra: [needsE(5)] });
  leet(g);
  assert.equal(elitism(g.engine), 5);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(elitism(g.engine), 1, "back to the one real [E] on the opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(elitism(g.engine), 1, "and still on my next turn");
  refused(() => playRaw(g.engine, P1, g.id("needs5")), "the extra icons ended with the turn");
});

clause(LEET, "0:rule", "the extra icons last for the whole turn, not just the next card: two [E]x5 cards can be deployed", () => {
  const g = leetBoard({ extra: [needsE(5, "a"), needsE(5, "b")] });
  leet(g);
  playAndResolve(g.engine, P1, g.id("a"));
  playAndResolve(g.engine, P1, g.id("b"));
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(zoneOf(g.engine, g.id("b")), "play");
});

clause(LEET, "0:rule", "'you control' means me only: the opponent's icons do not change", () => {
  const g = leetBoard({ extra: res({ elitism: 2 }, P2) });
  leet(g);
  assert.equal(elitism(g.engine, P2), 2);
});

clause(LEET, "0:rule", "two 31337!s in one turn give 8 additional [E]", () => {
  const g = leetBoard({ elitism: 1, greed: 6, extra: [{ key: "l2", def: printing(LEET), owner: P1, zone: "hand" }] });
  leet(g);
  playAndResolve(g.engine, P1, g.id("l2"));
  assert.equal(elitism(g.engine), 9);
});

clause(LEET, "0:rule", "played in response on the opponent's turn it works for THEIR turn: the icons are mine until that turn ends", () => {
  const g = leetBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  playRaw(g.engine, P1, g.id("l"));
  resolvePendingResponses(g.engine);
  assert.equal(elitism(g.engine), 5);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(elitism(g.engine), 1, "ended when the opponent's turn ended");
});

clause(LEET, "0:rule", "afterwards 31337! is in play under its owner's control as a face-down resource, not in the discard pile", () => {
  const g = leetBoard();
  leet(g);
  assert.equal(zoneOf(g.engine, g.id("l")), "play");
  assert.equal(isFaceDown(g.engine, g.id("l")), true);
  assert.equal(controllerOf(g.engine, g.id("l")), P1);
  assert.equal(g.engine.isResource(g.id("l")), true);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("l")), "!discardOf(g.engine, P1).includes(g.id(\"l\"))");
  assert.equal(g.engine.state.cards[g.id("l")].attachedTo, undefined, "ready to use");
});

clause(LEET, "0:rule", "the face-down 31337! provides one Volition (and no [E]): Volition rises by 1, Elitism by exactly the 4 additional", () => {
  const g = leetBoard();
  const v = g.engine.getThresholds(P1).volition ?? 0;
  leet(g);
  assert.equal((g.engine.getThresholds(P1).volition ?? 0) - v, 1);
  assert.equal(elitism(g.engine), 5);
});

clause(LEET, "0:rule", "while it is still being deployed it is not yet a resource and the effect has not happened yet", () => {
  const g = leetBoard();
  playRaw(g.engine, P1, g.id("l"));
  assert.equal(zoneOf(g.engine, g.id("l")), "deploying");
  assert.equal(elitism(g.engine), 1, "not before it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("l")), "play");
  assert.equal(elitism(g.engine), 5);
});

clause(LEET, "0:rule", "a face-down 31337! has no printed FLIP UP: it cannot be flipped up", () => {
  const g = leetBoard({ extra: [{ key: "fd", def: printing(LEET), owner: P1, zone: "play", faceDown: true }] });
  refused(() => flipUpRaw(g.engine, P1, g.id("fd")), "31337! has no FLIP UP");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true);
});

clause(LEET, "0:rule", "if 31337! is terminated before it resolves it goes to its owner's discard pile (CR 314.1) and adds no icons", () => {
  const g = leetBoard({ extra: [{ key: "ctr", def: COUNTER, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("l"));
  playRaw(g.engine, P2, g.id("ctr"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("l")), "discard");
  assert.equal(elitism(g.engine), 1);
});

// =============================================================================
// 3cc3n7r1c 73chn1c14n
// This card can attack only once each turn.
// ASSIST -- COST: Deplete this card. Pick another character you control.
//   EFFECT: Restore the character. This turn, it cannot attack.
// RESTORE: [E][E][E] -- COST: Pay 3. EFFECT: Restore this card.
// Character (31f), gearsmith, cost 2, [E]; 1 strength / 3 speed / 3 life.
// =============================================================================

const TECH = "12d7d798-f74e-44af-9a45-4cf653fe6c64";

/** A free tactic (id "rs", pick "t"): restores one picked character. */
const restoreTactic = (name = "Refresh"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        { id: "rs", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

function techBoard(
  o: { elitism?: number; greed?: number; active?: PlayerId; depleted?: boolean; eligible?: boolean; extra?: CardPlacement[]; spentElitism?: number } = {}
) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "tech", def: printing(TECH), owner: P1, zone: "play", depleted: o.depleted, attackEligible: o.eligible },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 3, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** `attackers` (placement keys) attack the opponent's faction, no blockers, and the battle is resolved. */
function strike(g: Game, ...attackers: string[]): void {
  fightThrough(g.engine, P1, attackers.map((k) => g.id(k)), { type: "faction", playerId: P2 }, []);
}

const attackAgain = (g: Game, key: string): void => declareAttackBy(g.engine, P1, [g.id(key)]);

// --- stats and deploying

clause(TECH, "0:rule", "it deploys for exactly its printed cost of 2 with [E], and has 1 strength / 3 speed / 3 life as a 31f character", () => {
  const g = devBoard([{ key: "t", def: printing(TECH), owner: P1, zone: "hand" }, ...res({ elitism: 3 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("t"));
  assert.equal(zoneOf(g.engine, g.id("t")), "play");
  assert.equal(before - ready(g.engine), 2, "paid exactly 2");
  assert.deepEqual(g.engine.getCardTypes(g.id("t")), ["character"]);
  assert.equal(g.engine.getStat(g.id("t"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("t"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("t"), "life"), 3);
  assert.deepEqual(g.engine.getSubtypes(g.id("t")), ["31f"]);
});

clause(TECH, "0:rule", "it is refused one resource short (1 Elitism) and without [E] (2 Greed), and nothing is paid", () => {
  const short = devBoard([{ key: "t", def: printing(TECH), owner: P1, zone: "hand" }, ...res({ elitism: 1 })]);
  refused(() => playRaw(short.engine, P1, short.id("t")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("t")), "hand");
  assert.equal(ready(short.engine), 1);
  const noThreshold = devBoard([{ key: "t", def: printing(TECH), owner: P1, zone: "hand" }, ...res({ greed: 2 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("t")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("t")), "hand");
  assert.equal(ready(noThreshold.engine), 2);
});

// --- 0:rule — This card can attack only once each turn.

clause(TECH, "0:rule", "it can attack once: the first attack of the turn is allowed and deals its 1 damage", () => {
  const g = techBoard();
  strike(g, "tech");
  assert.equal(influenceOf(g.engine, P2), 29);
  assert.equal(isDepleted(g.engine, g.id("tech")), true, "attacking depletes it");
});

clause(TECH, "0:rule", "after attacking and being restored (by its own RESTORE) it cannot attack a second time this turn", () => {
  const g = techBoard();
  strike(g, "tech");
  activate(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(isDepleted(g.engine, g.id("tech")), false, "setup: it is ready again");
  refused(() => attackAgain(g, "tech"), "a second attack in the same turn");
  assert.equal(influenceOf(g.engine, P2), 29, "no second hit");
  assert.equal(battleOf(g.engine), undefined);
});

clause(TECH, "0:rule", "after attacking and being restored by an outside effect it still cannot attack a second time this turn", () => {
  const g = techBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  strike(g, "tech");
  playAndResolve(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("tech")] } });
  assert.equal(isDepleted(g.engine, g.id("tech")), false, "setup: restored");
  refused(() => attackAgain(g, "tech"), "a second attack in the same turn");
  assert.equal(influenceOf(g.engine, P2), 29);
});

clause(TECH, "0:rule", "control: another character CAN attack twice in a turn when it is restored, so the limit is specific to this card", () => {
  const g = techBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  strike(g, "ally");
  playAndResolve(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("ally")] } });
  attackAgain(g, "ally");
  assert.ok(battleOf(g.engine), "the second attack was declared");
});

clause(TECH, "0:rule", "it can attack again on my next turn", () => {
  const g = techBoard();
  strike(g, "tech");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(g.engine, g.id("tech")), false, "restored by the restore rule");
  strike(g, "tech");
  assert.equal(influenceOf(g.engine, P2), 28, "hit again on the next turn");
});

clause(TECH, "0:rule", "attacking in a party with other characters still uses up its one attack for the turn", () => {
  const g = techBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  strike(g, "tech", "ally");
  playAndResolve(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("tech")] } });
  refused(() => attackAgain(g, "tech"), "a second attack after a party attack");
  assert.equal(influenceOf(g.engine, P2), 27, "1 + 2 damage from the first attack only");
});

clause(TECH, "0:rule", "not attacking uses nothing up: a ready tech that did not attack can attack (one attack is the limit, not zero)", () => {
  const g = techBoard();
  strike(g, "ally");
  strike(g, "tech");
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(TECH, "0:rule", "being restored without having attacked does not stop its first attack", () => {
  const g = techBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("tech")] } });
  strike(g, "tech");
  assert.equal(influenceOf(g.engine, P2), 29);
});

// --- 1:ability:assist

clause(TECH, "1:ability:assist", "ASSIST restores the picked depleted ally", () => {
  const g = techBoard({ extra: [] });
  g.engine.state.cards[g.id("ally")].depleted = true;
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g.engine, g.id("ally")), false);
});

clause(TECH, "1:ability:assist", "COST: Deplete this card: the tech is depleted as the ability is used (before it resolves)", () => {
  const g = techBoard();
  actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [g.id("ally")] });
  assert.equal(isDepleted(g.engine, g.id("tech")), true);
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("tech")), true, "and stays depleted");
});

clause(TECH, "1:ability:assist", "ASSIST has no resource cost: no resource is paid", () => {
  const g = techBoard();
  const before = ready(g.engine);
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(ready(g.engine), before);
});

clause(TECH, "1:ability:assist", "it cannot be used while the tech is already depleted (the deplete cost cannot be paid)", () => {
  const bad = techBoard({ depleted: true });
  bad.engine.state.cards[bad.id("ally")].depleted = true;
  refused(() => actRaw(bad.engine, P1, bad.id("tech"), "assist", { ally: [bad.id("ally")] }), "the tech is depleted");
  assert.equal(isDepleted(bad.engine, bad.id("ally")), true, "nothing was restored");
  const good = techBoard();
  actRaw(good.engine, P1, good.id("tech"), "assist", { ally: [good.id("ally")] });
  assert.equal(isDepleted(good.engine, good.id("tech")), true, "control: a ready tech can");
});

clause(TECH, "1:ability:assist", "a ready ally can be picked too: it stays ready and still cannot attack this turn", () => {
  const g = techBoard();
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(isDepleted(g.engine, g.id("ally")), false);
  refused(() => attackAgain(g, "ally"), "ASSIST: this turn it cannot attack");
  assert.equal(battleOf(g.engine), undefined);
});

clause(TECH, "1:ability:assist", "the picked character cannot attack this turn, even though it was restored (it attacked first, then ASSIST)", () => {
  const g = techBoard();
  strike(g, "ally");
  assert.equal(isDepleted(g.engine, g.id("ally")), true);
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(isDepleted(g.engine, g.id("ally")), false, "restored");
  refused(() => attackAgain(g, "ally"), "cannot attack this turn");
});

clause(TECH, "1:ability:assist", "the 'cannot attack' ends with the turn: the ally attacks normally on my next turn", () => {
  const g = techBoard();
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  strike(g, "ally");
  assert.equal(influenceOf(g.engine, P2), 28);
});

clause(TECH, "1:ability:assist", "only the picked character is affected: another ally can still attack", () => {
  const g = techBoard({ extra: [{ key: "ally2", def: character({ name: "Ally 2", strength: 3 }), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  strike(g, "ally2");
  assert.equal(influenceOf(g.engine, P2), 27);
});

clause(TECH, "1:ability:assist", "after using ASSIST the tech is depleted by its own cost, so it cannot attack that turn", () => {
  const g = techBoard();
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  refused(() => attackAgain(g, "tech"), "the tech is depleted by its own cost");
});

clause(TECH, "1:ability:assist", "'another character': the tech cannot pick itself, and nothing is paid", () => {
  const bad = techBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("tech"), "assist", { ally: [bad.id("tech")] }), "picking itself");
  assert.equal(isDepleted(bad.engine, bad.id("tech")), false, "nothing was paid");
});

clause(TECH, "1:ability:assist", "'another character' means a different card, not a different name: a second 3cc3n7r1c can be picked", () => {
  const g = techBoard({ extra: [{ key: "tech2", def: printing(TECH), owner: P1, zone: "play", depleted: true }] });
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("tech2")] } });
  assert.equal(isDepleted(g.engine, g.id("tech2")), false, "the other copy was restored");
});

clause(TECH, "1:ability:assist", "it is 'a character you control': an opponent's character cannot be picked", () => {
  const g = techBoard();
  refused(() => actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [g.id("foe")] }), "the opponent's character");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(isDepleted(g.engine, g.id("tech")), true, "control: my own character works");
});

clause(TECH, "1:ability:assist", "'control', not 'own': a character I own but the opponent controls cannot be picked, one I control but do not own can", () => {
  const g = techBoard({
    extra: [
      { key: "lent", def: character({ name: "Lent Out" }), owner: P1, controller: P2, zone: "play" },
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play", depleted: true }
    ]
  });
  refused(() => actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [g.id("lent")] }), "owned but not controlled");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("borrowed")] } });
  assert.equal(isDepleted(g.engine, g.id("borrowed")), false, "controlled but not owned: restored");
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdChar", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(TECH, "1:ability:assist", `cannot pick ${label}; a character in play can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play", depleted: true },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fdChar", def: character({ name: "Face Down", life: 9 }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = techBoard({ extra });
    refused(() => actRaw(bad.engine, P1, bad.id("tech"), "assist", { ally: [bad.id(key)] }), `picking ${label}`);
    assert.equal(isDepleted(bad.engine, bad.id("tech")), false, "no cost was paid");
    const good = techBoard({ extra });
    activate(good.engine, P1, good.id("tech"), "assist", { selected: { ally: [good.id("ally")] } });
    assert.equal(isDepleted(good.engine, good.id("tech")), true, "control");
  });
}

clause(TECH, "1:ability:assist", "my faction cannot be picked (CR 202.9)", () => {
  const g = techBoard();
  refused(() => actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [factionOf(g.engine, P1)] }), "picking my faction");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
});

clause(TECH, "1:ability:assist", "exactly one character is picked: none and two are refused", () => {
  const none = techBoard();
  refused(() => actRaw(none.engine, P1, none.id("tech"), "assist", {}), "no pick");
  assert.equal(isDepleted(none.engine, none.id("tech")), false);
  const two = techBoard({ extra: [{ key: "ally2", def: character({ name: "Ally 2" }), owner: P1, zone: "play" }] });
  refused(() => actRaw(two.engine, P1, two.id("tech"), "assist", { ally: [two.id("ally"), two.id("ally2")] }), "two picks");
  assert.equal(isDepleted(two.engine, two.id("tech")), false);
});

clause(TECH, "1:ability:assist", "a tech that was deployed this turn can use ASSIST (abilities work the turn a character enters play, CR 204.3a)", () => {
  const g = techBoard({ eligible: false });
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  assert.equal(isDepleted(g.engine, g.id("tech")), true);
});

clause(TECH, "1:ability:assist", "ASSIST can be used in response on the opponent's turn: it restores a depleted ally, which can then block", () => {
  const g = techBoard({ active: P2, extra: [] });
  g.engine.state.cards[g.id("ally")].depleted = true;
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [g.id("ally")] });
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("ally")), false);
  declareBlockers(g.engine, P1, [g.id("ally")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("ally")], "the restored ally blocks");
});

clause(TECH, "1:ability:assist", "control: a depleted ally cannot block, so the ASSIST restore above really made the difference", () => {
  const g = techBoard({ active: P2 });
  g.engine.state.cards[g.id("ally")].depleted = true;
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  resolvePendingResponses(g.engine);
  refused(() => declareBlockers(g.engine, P1, [g.id("ally")]), "a depleted character cannot block");
});

// --- 2:ability:restore-self

clause(TECH, "2:ability:restore-self", "RESTORE pays exactly 3 and restores the depleted tech", () => {
  const g = techBoard({ elitism: 4 });
  strike(g, "tech");
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(before - ready(g.engine), 3, "exactly 3 paid");
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
});

clause(TECH, "2:ability:restore-self", "RESTORE restores only this card: a depleted ally stays depleted", () => {
  const g = techBoard();
  strike(g, "tech", "ally");
  assert.equal(isDepleted(g.engine, g.id("ally")), true);
  activate(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  assert.equal(isDepleted(g.engine, g.id("ally")), true);
});

clause(TECH, "2:ability:restore-self", "RESTORE needs [E][E][E]: three resources of other icons are not enough", () => {
  const g = techBoard({ elitism: 2, greed: 2, depleted: true });
  assert.equal(ready(g.engine), 4);
  refused(() => actRaw(g.engine, P1, g.id("tech"), "restore-self"), "only two [E]");
  assert.equal(isDepleted(g.engine, g.id("tech")), true);
  assert.equal(ready(g.engine), 4, "nothing was paid");
  const ok = techBoard({ elitism: 3, greed: 1, depleted: true });
  activate(ok.engine, P1, ok.id("tech"), "restore-self");
  assert.equal(isDepleted(ok.engine, ok.id("tech")), false, "control: three [E] works");
});

clause(TECH, "2:ability:restore-self", "RESTORE is refused one resource short of its pay-3 even with [E][E][E] met", () => {
  const g = techBoard({ elitism: 2, spentElitism: 1, depleted: true });
  assert.equal(ready(g.engine), 2);
  assert.equal(elitism(g.engine), 3, "setup: the threshold is met");
  refused(() => actRaw(g.engine, P1, g.id("tech"), "restore-self"), "only 2 ready resources for Pay 3");
  assert.equal(isDepleted(g.engine, g.id("tech")), true);
  assert.equal(ready(g.engine), 2);
});

clause(TECH, "2:ability:restore-self", "spent [E] still meets the threshold (CR 405.6) while other ready resources pay the 3", () => {
  const g = techBoard({ elitism: 0, greed: 3, spentElitism: 3, depleted: true });
  activate(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  assert.equal(ready(g.engine), 0);
});

clause(TECH, "2:ability:restore-self", "Volition and the opponent's [E] do not meet [E][E][E]", () => {
  const vol = techBoard({ elitism: 0, depleted: true, extra: volition(5, P1) });
  refused(() => actRaw(vol.engine, P1, vol.id("tech"), "restore-self"), "Volition is not [E]");
  const theirs = techBoard({ elitism: 0, greed: 5, depleted: true, extra: res({ elitism: 5 }, P2) });
  refused(() => actRaw(theirs.engine, P1, theirs.id("tech"), "restore-self"), "the opponent's [E]");
});

clause(TECH, "2:ability:restore-self", "RESTORE on a ready tech pays 3 and changes nothing else (an already restored card cannot be restored again, CR 303.2)", () => {
  const g = techBoard({ elitism: 3 });
  activate(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(TECH, "2:ability:restore-self", "RESTORE can be used in response on the opponent's turn: a depleted tech becomes ready and can block", () => {
  const g = techBoard({ active: P2, depleted: true });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  actRaw(g.engine, P1, g.id("tech"), "restore-self");
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  declareBlockers(g.engine, P1, [g.id("tech")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("tech")]);
});

clause(TECH, "2:ability:restore-self", "a face-down tech has no abilities (CR 411.1): RESTORE cannot be used", () => {
  const g = techBoard({ extra: [{ key: "fd", def: printing(TECH), owner: P1, zone: "play", faceDown: true }] });
  refused(() => actRaw(g.engine, P1, g.id("fd"), "restore-self"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// =============================================================================
// 3p1c D00dm4k3r
// ATTACH TO CHARACTER
// The attached character gains 1 strength and 1 life for each [E] you control.
// Item (gear), gearsmith, cost 4, [E].
// =============================================================================

const DOOM = "5e8c791e-940b-4edf-95e3-3f043072179a";
const FAB = "a6113b89-5ab1-4e79-8294-9e645cdcd547";

function doomBoard(o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; inHand?: boolean; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "dm", def: printing(DOOM), owner: P1, zone: o.inHand === false ? "play" : "hand" },
      { key: "host", def: character({ name: "Host", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Second Host", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 4, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** Deploys D00dm4k3r (key "dm") attached to the character at placement key `host`, and lets it resolve. */
function doom(g: Game, host = "host"): void {
  playAndResolve(g.engine, P1, g.id("dm"), { selected: { attachTo: [g.id(host)] } });
}

function attachedBoard(
  o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; extra?: CardPlacement[]; hostLife?: number; hostStrength?: number; hostOwner?: PlayerId } = {}
) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "host", def: character({ name: "Host", strength: o.hostStrength ?? 1, life: o.hostLife ?? 2, speed: 2 }), owner: o.hostOwner ?? P1, zone: "play" },
      { key: "dm", def: printing(DOOM), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "other", def: character({ name: "Other", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 3, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

// --- 0:attach — ATTACH TO CHARACTER

clause(DOOM, "0:attach", "it enters play attached to the character I picked as its host, and is an item in play", () => {
  const g = doomBoard();
  doom(g, "host");
  assert.equal(zoneOf(g.engine, g.id("dm")), "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("dm")), ["item"]);
  assert.equal(g.engine.state.cards[g.id("dm")].attachedTo, g.id("host"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(controllerOf(g.engine, g.id("dm")), P1);
});

clause(DOOM, "0:attach", "it deploys for exactly its printed cost of 4 with [E]: 4 resources are paid when it is played", () => {
  const g = doomBoard({ elitism: 5 });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("dm"), { selected: { attachTo: [g.id("host")] } });
  assert.equal(before - ready(g.engine), 4);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("dm")].attachedTo, g.id("host"));
});

clause(DOOM, "0:attach", "it is refused one resource short (3 resources) and without [E] (4 Greed), and nothing is paid", () => {
  const short = doomBoard({ elitism: 1, greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("dm"), { selected: { attachTo: [short.id("host")] } }), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("dm")), "hand");
  assert.equal(ready(short.engine), 3);
  const noThreshold = doomBoard({ elitism: 0, greed: 4 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm"), { selected: { attachTo: [noThreshold.id("host")] } }), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("dm")), "hand");
  assert.equal(ready(noThreshold.engine), 4);
  const ok = doomBoard({ elitism: 1, greed: 3 });
  doom(ok);
  assert.equal(zoneOf(ok.engine, ok.id("dm")), "play", "control: [E] and 4 resources works");
});

clause(DOOM, "0:attach", "any character may be the host, mine or the opponent's: attached to the opponent's character it is still under my control", () => {
  const g = doomBoard();
  doom(g, "foe");
  assert.equal(g.engine.state.cards[g.id("dm")].attachedTo, g.id("foe"));
  assert.equal(controllerOf(g.engine, g.id("dm")), P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("dm")), "playOf(g.engine, P1).includes(g.id(\"dm\"))");
});

clause(DOOM, "0:attach", "exactly one host is picked: none and two are refused, and nothing is paid", () => {
  const none = doomBoard();
  refused(() => playRaw(none.engine, P1, none.id("dm"), { selected: {} }), "no host");
  assert.equal(zoneOf(none.engine, none.id("dm")), "hand");
  assert.equal(ready(none.engine), 4);
  const two = doomBoard();
  refused(() => playRaw(two.engine, P1, two.id("dm"), { selected: { attachTo: [two.id("host"), two.id("host2")] } }), "two hosts");
  assert.equal(zoneOf(two.engine, two.id("dm")), "hand");
  assert.equal(ready(two.engine), 4);
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdChar", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(DOOM, "0:attach", `cannot attach to ${label}; a character in play works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdChar", def: character({ name: "Face Down", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = doomBoard({ extra });
    refused(() => playRaw(bad.engine, P1, bad.id("dm"), { selected: { attachTo: [bad.id(key)] } }), `attaching to ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("dm")), "hand");
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = doomBoard({ extra });
    doom(good, "host");
    assert.equal(good.engine.state.cards[good.id("dm")].attachedTo, good.id("host"), "control");
  });
}

clause(DOOM, "0:attach", "a faction is not a character: it cannot be the host", () => {
  const g = doomBoard();
  refused(() => playRaw(g.engine, P1, g.id("dm"), { selected: { attachTo: [factionOf(g.engine, P1)] } }), "attaching to my faction");
  assert.equal(zoneOf(g.engine, g.id("dm")), "hand");
});

clause(DOOM, "0:attach", "with no character in play there is nothing to attach to: it cannot be deployed, and nothing is paid", () => {
  const g = devBoard([{ key: "dm", def: printing(DOOM), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]);
  refused(() => playRaw(g.engine, P1, g.id("dm"), { selected: {} }), "no character to attach to");
  assert.equal(zoneOf(g.engine, g.id("dm")), "hand");
  assert.equal(ready(g.engine), 4);
});

clause(DOOM, "0:attach", "when the host is destroyed the attached D00dm4k3r is destroyed with it (to its owner's discard pile)", () => {
  const g = attachedBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("dm")), "discardOf(g.engine, P1).includes(g.id(\"dm\"))");
});

clause(DOOM, "0:attach", "when the host is returned to its owner's hand the attached D00dm4k3r leaves play the same way: it goes to its owner's hand (CR 301.4a)", () => {
  const g = attachedBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dm")), "hand", "it follows its host into its owner's hand");
});

clause(DOOM, "0:attach", "when the host is removed from the game the attached D00dm4k3r is removed from the game too (CR 301.4a)", () => {
  const g = attachedBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("rm"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "removed");
  assert.equal(zoneOf(g.engine, g.id("dm")), "removed", "it leaves play the same way");
});

clause(DOOM, "0:attach", "destroying D00dm4k3r alone leaves the host in play", () => {
  const g = attachedBoard({ extra: [{ key: "mv", def: moverTactic("discard"), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("mv"), { selected: { t: [g.id("dm")] } });
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  assert.equal(zoneOf(g.engine, g.id("host")), "play");
});

clause(DOOM, "0:attach", "an opponent's character hosting my D00dm4k3r: when it is destroyed D00dm4k3r goes to MY discard pile (its owner)", () => {
  const g = attachedBoard({ hostOwner: P2, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("dm")), "discardOf(g.engine, P1).includes(g.id(\"dm\"))");
});

clause(DOOM, "0:attach", "if the host stops being a character, the attached D00dm4k3r is flipped face-down with it immediately: an item animated by RUNE OF ANIMATION lapses at the end of the turn", () => {
  const g = devBoard([
    { key: "fab", def: printing(FAB), owner: P1, zone: "play" },
    { key: "gadget", def: item({ name: "Gadget", cost: 3 }), owner: P1, zone: "play" },
    { key: "dm", def: printing(DOOM), owner: P1, zone: "hand" },
    ...res({ elitism: 4 })
  ]);
  activate(g.engine, P1, g.id("fab"), "rune-of-animation", { selected: { it: [g.id("gadget")] } });
  assert.ok(g.engine.hasCardType(g.id("gadget"), "character"), "setup: the gadget is a character this turn");
  doom(g, "gadget");
  assert.equal(g.engine.state.cards[g.id("dm")].attachedTo, g.id("gadget"), "setup: attached to the animated item");
  endTurn(g.engine, P1);
  assert.equal(g.engine.hasCardType(g.id("gadget"), "character"), false, "the animation is over");
  assert.equal(zoneOf(g.engine, g.id("gadget")), "play");
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard", "destroyed: its host is no longer a character");
});

// --- 1:rule — The attached character gains 1 strength and 1 life for each [E] you control.

clause(DOOM, "1:rule", "the host gains 1 strength and 1 life for each [E] I control: 3 [E] give +3 / +3", () => {
  const g = attachedBoard({ elitism: 3 });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("host"), "life"), 5);
});

clause(DOOM, "1:rule", "with no [E] at all the host gains nothing", () => {
  const g = attachedBoard({ elitism: 0, greed: 3 });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("host"), "life"), 2);
});

clause(DOOM, "1:rule", "one [E] gives exactly +1 / +1, and 5 [E] give +5 / +5", () => {
  for (const n of [1, 5]) {
    const g = attachedBoard({ elitism: n });
    assert.equal(g.engine.getStat(g.id("host"), "strength"), 1 + n, `${n} [E]`);
    assert.equal(g.engine.getStat(g.id("host"), "life"), 2 + n, `${n} [E]`);
  }
});

clause(DOOM, "1:rule", "speed is not changed", () => {
  const g = attachedBoard({ elitism: 3 });
  assert.equal(g.engine.getStat(g.id("host"), "speed"), 2);
});

clause(DOOM, "1:rule", "only [E] counts: Greed, Rage, Deception and Obsession resources give nothing", () => {
  const g = attachedBoard({ elitism: 2, greed: 3, extra: res({ rage: 2, deception: 2, obsession: 2 }) });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("host"), "life"), 4);
});

clause(DOOM, "1:rule", "face-down resources provide Volition, not [E]: they add nothing", () => {
  const g = attachedBoard({ elitism: 2, extra: volition(4, P1) });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3);
});

clause(DOOM, "1:rule", "spent [E] (attached to my faction) still counts: icons are never spent (CR 405.6)", () => {
  const g = attachedBoard({ elitism: 1, spentElitism: 2 });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("host"), "life"), 5);
});

clause(DOOM, "1:rule", "only the [E] I control count: the opponent's Elitism adds nothing", () => {
  const g = attachedBoard({ elitism: 1, extra: res({ elitism: 4 }, P2) });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 2);
});

clause(DOOM, "1:rule", "it counts live: another [E] entering play raises the bonus at once", () => {
  const g = attachedBoard({ elitism: 1, extra: [{ key: "newE", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 2);
  developResource(g.engine, P1, g.id("newE"), false);
  resolvePendingResponses(g.engine);
  assert.equal(elitism(g.engine), 2);
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3, "+1 more");
  assert.equal(g.engine.getStat(g.id("host"), "life"), 4);
});

clause(DOOM, "1:rule", "it counts live: an [E] leaving play lowers the bonus at once", () => {
  const g = attachedBoard({ elitism: 3, extra: [{ key: "mv", def: moverTactic("discard"), owner: P1, zone: "hand" }] });
  const elitismCards = playOf(g.engine, P1).filter((id) => g.engine.isResource(id) && g.engine.getDefinition(id).name === "Elitism");
  assert.equal(elitismCards.length, 3);
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 4);
  playAndResolve(g.engine, P1, g.id("mv"), { selected: { t: [elitismCards[0]] } });
  assert.equal(elitism(g.engine), 2);
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3, "-1");
  assert.equal(g.engine.getStat(g.id("host"), "life"), 4);
});

clause(DOOM, "1:rule", "the bonus applies to the attached character ONLY: another character, and the opponent's, are unchanged", () => {
  const g = attachedBoard({ elitism: 3 });
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("other"), "life"), 2);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("foe"), "life"), 3);
});

clause(DOOM, "1:rule", "'you' is D00dm4k3r's controller: attached to an opponent's character it counts MY [E], not theirs", () => {
  const g = devBoard([
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" },
    { key: "dm", def: printing(DOOM), owner: P1, zone: "play", attachedToKey: "foe" },
    ...res({ elitism: 2 }, P1),
    ...res({ elitism: 5 }, P2)
  ]);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 4, "2 + my two [E]");
  assert.equal(g.engine.getStat(g.id("foe"), "life"), 5);
});

clause(DOOM, "1:rule", "two D00dm4k3rs on one character stack: each adds its own +1 / +1 per [E]", () => {
  const g = attachedBoard({ elitism: 2, extra: [{ key: "dm2", def: printing(DOOM), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 5, "1 + 2 + 2");
  assert.equal(g.engine.getStat(g.id("host"), "life"), 6);
});

clause(DOOM, "1:rule", "the bonus ends when D00dm4k3r leaves play: the stats return to the printed ones", () => {
  const g = attachedBoard({ elitism: 3, extra: [{ key: "mv", def: moverTactic("discard"), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 4);
  playAndResolve(g.engine, P1, g.id("mv"), { selected: { t: [g.id("dm")] } });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("host"), "life"), 2);
});

clause(DOOM, "1:rule", "the extra life is real: with the bonus gone, damage that was survivable now destroys the host", () => {
  const g = attachedBoard({ elitism: 3, extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("discard"), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("zap"), { selected: { t: [g.id("host")] } });
  assert.equal(damageOf(g.engine, g.id("host")), 4);
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "life 5 survives 4 damage");
  playAndResolve(g.engine, P1, g.id("mv"), { selected: { t: [g.id("dm")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard", "with D00dm4k3r gone the life is 2 and 4 damage destroys it");
});

clause(DOOM, "1:rule", "the extra strength is real in battle: a host with 1 strength and 3 [E] hits a faction for 4", () => {
  const g = attachedBoard({ elitism: 3 });
  strike(g, "host");
  assert.equal(influenceOf(g.engine, P2), 26);
});

clause(DOOM, "1:rule", "a face-down D00dm4k3r is only a resource: it is not attached and gives no bonus", () => {
  const g = devBoard([
    { key: "host", def: character({ name: "Host", strength: 1, life: 2 }), owner: P1, zone: "play" },
    { key: "dm", def: printing(DOOM), owner: P1, zone: "play", faceDown: true },
    ...res({ elitism: 3 })
  ]);
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 1);
});

clause(DOOM, "1:rule", "the bonus follows the number of [E] when 31337!-style extra icons exist: Braggadocian Aide's PROVIDES [E] counts as an [E] I control", () => {
  const g = attachedBoard({ elitism: 1, extra: [{ key: "aide", def: printing("0c2563df-d5fa-4444-a48e-9506e158f5b8"), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("host"), "strength"), 3, "1 + the Elitism resource + the Aide's [E]");
});

// =============================================================================
// 4rm0r3d 31f
// This card loses 1 life for each token on it.
// FALL APART -- COST: Pay 1. Put a token on this card.
//   EFFECT: Put a Micromajig token into play under your control.
// Character (31f), gearsmith, cost 5, [E][E]; 3 strength / 3 speed / 5 life.
// =============================================================================

const ARMORED = "a51b7b2b-e098-4000-9eca-b3664af565cb";

function armBoard(o: { tokens?: number; elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; eligible?: boolean; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "arm", def: printing(ARMORED), owner: P1, zone: "play", counters: o.tokens ? { token: o.tokens } : undefined, attackEligible: o.eligible },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 3, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** FALL APART, resolved. */
const fallApart = (g: Game): void => activate(g.engine, P1, g.id("arm"), "fall-apart");

// --- stats and deploying

clause(ARMORED, "0:rule", "it deploys for exactly its printed cost of 5 with [E][E], and has 3 strength / 3 speed / 5 life as a 31f character", () => {
  const g = devBoard([{ key: "a", def: printing(ARMORED), owner: P1, zone: "hand" }, ...res({ elitism: 6 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("a"));
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(before - ready(g.engine), 5, "paid exactly 5");
  assert.deepEqual(g.engine.getCardTypes(g.id("a")), ["character"]);
  assert.equal(g.engine.getStat(g.id("a"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("a"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("a"), "life"), 5);
  assert.deepEqual(g.engine.getSubtypes(g.id("a")), ["31f"]);
  assert.equal(tokensOn(g.engine, g.id("a")), 0, "it enters with no tokens");
});

clause(ARMORED, "0:rule", "it is refused one resource short (4 Elitism) and without [E][E] (5 Greed + 1 Elitism), and nothing is paid", () => {
  const short = devBoard([{ key: "a", def: printing(ARMORED), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]);
  refused(() => playRaw(short.engine, P1, short.id("a")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("a")), "hand");
  assert.equal(ready(short.engine), 4);
  const noThreshold = devBoard([{ key: "a", def: printing(ARMORED), owner: P1, zone: "hand" }, ...res({ elitism: 1, greed: 5 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("a")), "only one [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("a")), "hand");
  assert.equal(ready(noThreshold.engine), 6);
});

// --- 0:rule — This card loses 1 life for each token on it.

clause(ARMORED, "0:rule", "with no token it has its printed 5 life", () => {
  const g = armBoard();
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 5);
});

clause(ARMORED, "0:rule", "it loses 1 life for each token on it: 1, 2, 3 and 4 tokens leave 4, 3, 2 and 1 life", () => {
  for (const n of [1, 2, 3, 4]) {
    const g = armBoard({ tokens: n });
    assert.equal(g.engine.getStat(g.id("arm"), "life"), 5 - n, `${n} tokens`);
  }
});

clause(ARMORED, "0:rule", "tokens change only its life: strength and speed stay 3 / 3", () => {
  const g = armBoard({ tokens: 3 });
  assert.equal(g.engine.getStat(g.id("arm"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("arm"), "speed"), 3);
});

clause(ARMORED, "0:rule", "only tokens ON THIS CARD count: tokens on another character do not lower its life", () => {
  const g = armBoard({ extra: [{ key: "ally2", def: character({ name: "Tokened Ally", life: 5 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("ally2"), "life"), 5, "and the other character is not affected either");
});

clause(ARMORED, "0:rule", "the Micromajig tokens it makes are cards, not tokens on it: they do not cost it life", () => {
  const g = armBoard({ tokens: 0 });
  fallApart(g);
  assert.equal(micromajigs(g.engine).length, 1);
  assert.equal(tokensOn(g.engine, g.id("arm")), 1);
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 4, "only the one token on it counts");
});

clause(ARMORED, "0:rule", "the lost life is real: with 2 tokens (life 3) 3 damage destroys it, while with none it survives 3 damage", () => {
  const frail = armBoard({ tokens: 2, extra: [{ key: "zap", def: damageTactic(3), owner: P1, zone: "hand" }] });
  playAndResolve(frail.engine, P1, frail.id("zap"), { selected: { t: [frail.id("arm")] } });
  assert.equal(zoneOf(frail.engine, frail.id("arm")), "discard");
  const fresh = armBoard({ tokens: 0, extra: [{ key: "zap", def: damageTactic(3), owner: P1, zone: "hand" }] });
  playAndResolve(fresh.engine, P1, fresh.id("zap"), { selected: { t: [fresh.id("arm")] } });
  assert.equal(zoneOf(fresh.engine, fresh.id("arm")), "play");
  assert.equal(damageOf(fresh.engine, fresh.id("arm")), 3);
});

clause(ARMORED, "0:rule", "with 3 tokens (life 2) just 2 damage destroys it", () => {
  const g = armBoard({ tokens: 3, extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("zap"), { selected: { t: [g.id("arm")] } });
  assert.equal(zoneOf(g.engine, g.id("arm")), "discard", "2 damage on 2 life");
  const one = armBoard({ tokens: 3, extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(one.engine, P1, one.id("zap"), { selected: { t: [one.id("arm")] } });
  assert.equal(zoneOf(one.engine, one.id("arm")), "play", "control: 1 damage on 2 life");
});

clause(ARMORED, "0:rule", "with 5 tokens its life is 0 and a character at 0 life is destroyed (FAQ: damage 0 is equal to life 0)", () => {
  const g = armBoard({ tokens: 4, elitism: 3 });
  assert.equal(zoneOf(g.engine, g.id("arm")), "play");
  fallApart(g);
  // (its tokens vanish with it, CR 409.2, so they can't be counted after it dies)
  assert.equal(zoneOf(g.engine, g.id("arm")), "discard", "0 life: destroyed");
});

clause(ARMORED, "0:rule", "with 6 tokens its life stays at 0 (CR 410.4, not -1) and it is destroyed", () => {
  const g = armBoard({ tokens: 6 });
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 0, "life never goes below 0");
  settleState(g.engine);
  assert.equal(zoneOf(g.engine, g.id("arm")), "discard");
});

clause(ARMORED, "0:rule", "tokens on it disappear when it leaves play (CR 409.2): back in play from the hand it has its full 5 life", () => {
  const g = armBoard({ tokens: 2, elitism: 6, extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("arm")] } });
  assert.equal(zoneOf(g.engine, g.id("arm")), "hand");
  playAndResolve(g.engine, P1, g.id("arm"));
  assert.equal(zoneOf(g.engine, g.id("arm")), "play");
  assert.equal(tokensOn(g.engine, g.id("arm")), 0, "its tokens are gone");
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 5);
});

// --- 1:ability:fall-apart

clause(ARMORED, "1:ability:fall-apart", "FALL APART pays exactly 1 resource", () => {
  const g = armBoard({ elitism: 3 });
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("arm"), "fall-apart");
  assert.equal(before - ready(g.engine), 1);
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 1, "and nothing more at resolution");
});

clause(ARMORED, "1:ability:fall-apart", "FALL APART has no threshold of its own: any resource pays the 1 (Greed works)", () => {
  const g = armBoard({ elitism: 0, greed: 1 });
  fallApart(g);
  assert.equal(micromajigs(g.engine).length, 1);
  assert.equal(ready(g.engine), 0);
});

clause(ARMORED, "1:ability:fall-apart", "it is refused with no resource to pay (spent resources cannot pay), and nothing happens", () => {
  const g = armBoard({ elitism: 0, spentElitism: 3 });
  assert.equal(ready(g.engine), 0);
  refused(() => actRaw(g.engine, P1, g.id("arm"), "fall-apart"), "no resource to pay");
  assert.equal(tokensOn(g.engine, g.id("arm")), 0, "no token");
  assert.equal(micromajigs(g.engine).length, 0, "no Micromajig");
});

clause(ARMORED, "1:ability:fall-apart", "COST: Put a token on this card: the token is already there when the ability is used, before the opponent can respond", () => {
  const g = armBoard();
  actRaw(g.engine, P1, g.id("arm"), "fall-apart");
  assert.equal(tokensOn(g.engine, g.id("arm")), 1, "a cost is paid when the ability is used");
  assert.equal(micromajigs(g.engine).length, 0, "the effect has not happened yet");
});

clause(ARMORED, "1:ability:fall-apart", "EFFECT: it puts exactly one Micromajig token into play under my control, and one token on this card", () => {
  const g = armBoard();
  fallApart(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("arm")), 1);
  const tokens = micromajigs(g.engine);
  assert.equal(tokens.length, 1);
  assert.equal(controllerOf(g.engine, tokens[0]), P1);
  assert.equal(g.engine.state.cards[tokens[0]].ownerId, P1);
  assert.equal(micromajigs(g.engine, P2).length, 0);
});

clause(ARMORED, "1:ability:fall-apart", "the Micromajig is a character with 1 strength, 1 life, 3 speed and the majig subtype (CR 409.3c.1)", () => {
  const g = armBoard();
  fallApart(g);
  const [token] = micromajigs(g.engine);
  assert.deepEqual(g.engine.getCardTypes(token), ["character"]);
  assert.equal(g.engine.getStat(token, "strength"), 1);
  assert.equal(g.engine.getStat(token, "life"), 1);
  assert.equal(g.engine.getStat(token, "speed"), 3);
  assert.deepEqual(g.engine.getSubtypes(token), ["majig"]);
  assert.equal(g.engine.getDefinition(token).name, "Micromajig");
});

clause(ARMORED, "1:ability:fall-apart", "the Micromajig token is a Gearsmith character (CR 409.3c.1), not a universal one", () => {
  const g = armBoard();
  fallApart(g);
  const [token] = micromajigs(g.engine);
  assert.ok(token, "a token exists");
  assert.equal(g.engine.getDefinition(token).trade, "gearsmith");
});

clause(ARMORED, "1:ability:fall-apart", "the Micromajig is a new arrival: it cannot attack the turn it is created", () => {
  const g = armBoard();
  fallApart(g);
  const [token] = micromajigs(g.engine);
  refused(() => declareAttackBy(g.engine, P1, [token]), "a token that just entered play cannot attack", /did not start the turn in play/);
  assert.equal(battleOf(g.engine), undefined);
});

clause(ARMORED, "1:ability:fall-apart", "each use adds one token to the card and makes one more Micromajig: three uses leave 3 tokens, 3 Micromajigs and 2 life", () => {
  const g = armBoard({ elitism: 5 });
  fallApart(g);
  fallApart(g);
  fallApart(g);
  assert.equal(tokensOn(g.engine, g.id("arm")), 3);
  assert.equal(micromajigs(g.engine).length, 3);
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 2);
  assert.equal(ready(g.engine), 2, "3 resources paid");
});

clause(ARMORED, "1:ability:fall-apart", "the lost life takes effect at once: after the first use its life is 4", () => {
  const g = armBoard();
  fallApart(g);
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 4);
});

clause(ARMORED, "1:ability:fall-apart", "it is not limited to once a turn and does not deplete the card", () => {
  const g = armBoard({ elitism: 3 });
  fallApart(g);
  assert.equal(isDepleted(g.engine, g.id("arm")), false);
  fallApart(g);
  assert.equal(micromajigs(g.engine).length, 2);
});

clause(ARMORED, "1:ability:fall-apart", "using FALL APART with 4 tokens already on it (1 life) puts the 5th token on, destroys the card, and the ability still makes its Micromajig", () => {
  const g = armBoard({ tokens: 4, elitism: 3 });
  fallApart(g);
  assert.equal(zoneOf(g.engine, g.id("arm")), "discard", "5 tokens leave it with 0 life");
  assert.equal(micromajigs(g.engine).length, 1, "the ability still resolved (CR 502.4)");
});

clause(ARMORED, "1:ability:fall-apart", "FALL APART can be used in response on the opponent's turn", () => {
  const g = armBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  actRaw(g.engine, P1, g.id("arm"), "fall-apart");
  resolvePendingResponses(g.engine);
  assert.equal(micromajigs(g.engine).length, 1);
  assert.equal(tokensOn(g.engine, g.id("arm")), 1);
});

clause(ARMORED, "1:ability:fall-apart", "if the opponent terminates FALL APART, the cost stays paid (the resource is spent and the token stays on the card) but no Micromajig appears", () => {
  const g = armBoard({ extra: [{ key: "ctr", def: COUNTER, owner: P2, zone: "hand" }] });
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("arm"), "fall-apart");
  playRaw(g.engine, P2, g.id("ctr"));
  resolvePendingResponses(g.engine);
  assert.equal(micromajigs(g.engine).length, 0, "terminated: no Micromajig");
  assert.equal(before - ready(g.engine), 1, "the resource stays paid");
  assert.equal(tokensOn(g.engine, g.id("arm")), 1, "the token stays on the card");
});

clause(ARMORED, "1:ability:fall-apart", "a face-down 4rm0r3d 31f has no abilities (CR 411.1)", () => {
  const g = armBoard({ extra: [{ key: "fd", def: printing(ARMORED), owner: P1, zone: "play", faceDown: true }] });
  refused(() => actRaw(g.engine, P1, g.id("fd"), "fall-apart"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
  assert.equal(micromajigs(g.engine).length, 0);
});

clause(ARMORED, "1:ability:fall-apart", "the Micromajig tokens are real characters that can fight: a Micromajig can block the opponent's attacker", () => {
  const g = armBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  actRaw(g.engine, P1, g.id("arm"), "fall-apart");
  resolvePendingResponses(g.engine);
  const [token] = micromajigs(g.engine);
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [token]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [token]);
});

// =============================================================================
// Accidental Invention
// COST: Reveal a face-down item you control.
// EFFECT: You may play the item. Draw a card.
// While this card is in your discard pile, if a card that provides at least [E]
// enters play under your control, you may pay 2. If you do, put this card into
// play under your control as a face-down resource.
// FLIP UP: 1 [E]
// Tactic, gearsmith, cost 1, [E].
// =============================================================================

const INVENTION = "e3ca7aad-a38b-4181-a743-e70c6e2f119b";
const AIDE = "0c2563df-d5fa-4444-a48e-9506e158f5b8";

/** An item with cost 2 and threshold [G]. */
const gizmo = (name = "Gizmo"): CardDefinition => item({ name, cost: 2, threshold: "g" });

/** An item with a trigger: +1 influence for its controller when it enters play. */
const gizmoTrigger = (): CardDefinition =>
  item({
    name: "Trigger Gizmo",
    cost: 2,
    threshold: "g",
    behavior: { abilities: [{ id: "gt", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
  });

function inventionBoard(
  o: { elitism?: number; greed?: number; active?: PlayerId; deck?: number; gizmoDef?: CardDefinition; extra?: CardPlacement[]; hand?: boolean } = {}
) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "ai", def: printing(INVENTION), owner: P1, zone: o.hand === false ? "discard" : "hand" },
      { key: "fd", def: o.gizmoDef ?? gizmo(), owner: P1, zone: "play", faceDown: true },
      ...fillers("deck", o.deck ?? 3, P1, "deck"),
      ...res({ elitism: o.elitism ?? 1, greed: o.greed ?? 3 }),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** Plays Accidental Invention revealing the face-down item at `pick`; `accept` answers "you may play the item". */
function invent(g: Game, accept: boolean, pick = "fd", player: PlayerId = P1): void {
  playRaw(g.engine, player, g.id("ai"), { selected: { revealed: [g.id(pick)] } });
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? (accept ? { kind: "deployForFree", cardId: g.id(pick) } : { kind: "deployForFree" }) : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(INVENTION, "0:ability", "it deploys for exactly its printed cost of 1 with [E]: 1 resource is paid when it is played", () => {
  const g = inventionBoard({ elitism: 2 });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("ai"), { selected: { revealed: [g.id("fd")] } });
  assert.equal(before - ready(g.engine), 1);
  resolvePendingResponses(g.engine);
});

clause(INVENTION, "0:ability", "it needs [E] (3 Greed is refused) and a resource to pay (a spent [E] with nothing else ready is refused)", () => {
  const noThreshold = inventionBoard({ elitism: 0, greed: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ai"), { selected: { revealed: [noThreshold.id("fd")] } }), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ai")), "hand");
  const none = devBoard([{ key: "ai", def: printing(INVENTION), owner: P1, zone: "hand" }, { key: "fd", def: gizmo(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }, ...spent("elitism", 1)]);
  assert.equal(ready(none.engine), 0);
  refused(() => playRaw(none.engine, P1, none.id("ai"), { selected: { revealed: [none.id("fd")] } }), "nothing ready to pay 1");
  assert.equal(zoneOf(none.engine, none.id("ai")), "hand");
});

clause(INVENTION, "0:ability", "COST: Pick a face-down item you control: the revealed item is the one I pick, and exactly one must be picked", () => {
  const g = inventionBoard({ extra: [{ key: "fd2", def: gizmo("Gizmo Two"), owner: P1, zone: "play", faceDown: true }] });
  const none = inventionBoard();
  refused(() => playRaw(none.engine, P1, none.id("ai"), { selected: {} }), "no item revealed");
  assert.equal(zoneOf(none.engine, none.id("ai")), "hand");
  assert.equal(ready(none.engine), 5, "nothing was paid");
  const two = inventionBoard({ extra: [{ key: "fd2", def: gizmo("Gizmo Two"), owner: P1, zone: "play", faceDown: true }] });
  refused(() => playRaw(two.engine, P1, two.id("ai"), { selected: { revealed: [two.id("fd"), two.id("fd2")] } }), "two items revealed");
  assert.equal(zoneOf(two.engine, two.id("ai")), "hand");
  invent(g, true, "fd2");
  assert.equal(isFaceDown(g.engine, g.id("fd2")), false, "the one I revealed is the one I played");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true, "the other stays face-down");
});

for (const [key, label] of [
  ["fdChar", "a face-down character"],
  ["fdTactic", "a face-down tactic"],
  ["fdLoc", "a face-down location"],
  ["faceUp", "a face-up item"],
  ["theirs", "the opponent's face-down item"],
  ["inHand", "an item card in my hand"],
  ["inDiscard", "an item card in my discard pile"]
] as const) {
  clause(INVENTION, "0:ability", `cannot reveal ${label}; my own face-down item works on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "fdChar", def: character({ name: "Hidden Character" }), owner: P1, zone: "play", faceDown: true },
      { key: "fdTactic", def: tactic({ name: "Hidden Tactic", cost: 0 }), owner: P1, zone: "play", faceDown: true },
      { key: "fdLoc", def: location({ name: "Hidden Location" }), owner: P1, zone: "play", faceDown: true },
      { key: "faceUp", def: item({ name: "Visible Item" }), owner: P1, zone: "play" },
      { key: "theirs", def: gizmo("Their Gizmo"), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: gizmo("Hand Gizmo"), owner: P1, zone: "hand" },
      { key: "inDiscard", def: gizmo("Discard Gizmo"), owner: P1, zone: "discard" }
    ];
    const bad = inventionBoard({ extra });
    refused(() => playRaw(bad.engine, P1, bad.id("ai"), { selected: { revealed: [bad.id(key)] } }), `revealing ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("ai")), "hand");
    const good = inventionBoard({ extra });
    invent(good, true);
    assert.equal(zoneOf(good.engine, good.id("ai")), "discard", "control: my face-down item works");
  });
}

clause(INVENTION, "0:ability", "'Reveal a face-down item' is a cost: the reveal has happened by the time the tactic is played, before the opponent can respond", () => {
  const g = inventionBoard();
  playRaw(g.engine, P1, g.id("ai"), { selected: { revealed: [g.id("fd")] } });
  const revealed = g.engine.getLog().some((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(revealed, true, "the cost reveal is announced as the tactic is played");
});

clause(INVENTION, "0:ability", "the reveal happens: the item is revealed when the tactic resolves", () => {
  const g = inventionBoard();
  invent(g, false);
  assert.equal(g.engine.getLog().some((entry) => entry.event?.type === "cardsRevealed"), true);
});

clause(INVENTION, "0:ability", "EFFECT: 'You may play the item' - accepting puts the item into play face-up", () => {
  const g = inventionBoard();
  invent(g, true);
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fd")), false, "face-up");
  assert.deepEqual(g.engine.getCardTypes(g.id("fd")), ["item"]);
  assert.equal(g.engine.isResource(g.id("fd")), false, "no longer a resource");
});

clause(INVENTION, "0:ability", "it is a 'may': declining leaves the item face-down in play, and still draws", () => {
  const g = inventionBoard();
  invent(g, false);
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true);
  assert.equal(handOf(g.engine, P1).length, 1, "Draw a card is not part of the 'may'");
});

clause(INVENTION, "0:ability", "EFFECT: 'Draw a card' draws exactly one card (the top card of my deck), whether or not I played the item", () => {
  for (const accept of [true, false]) {
    const g = inventionBoard();
    const top = deckOf(g.engine, P1)[0];
    invent(g, accept);
    assert.deepEqual(handOf(g.engine, P1), [top], `accept ${accept}`);
    assert.equal(deckOf(g.engine, P1).length, 2);
  }
});

clause(INVENTION, "0:ability", "'play the item' follows the rules for playing a card (CR 604.2): the item's own cost of 2 is paid", () => {
  const g = devBoard([
    { key: "ai", def: printing(INVENTION), owner: P1, zone: "hand" },
    { key: "fd", def: gizmo(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...res({ elitism: 1, greed: 2 })
  ]);
  assert.equal(ready(g.engine), 3);
  invent(g, true);
  assert.equal(isFaceDown(g.engine, g.id("fd")), false, "the item was played");
  assert.equal(ready(g.engine), 0, "Accidental Invention's 1 and the item's own 2 were paid");
});

clause(INVENTION, "0:ability", "playing the item does not make me pay for anything else: with only Accidental Invention's own 1 available the tactic can be played and the item declined", () => {
  const g = devBoard([
    { key: "ai", def: printing(INVENTION), owner: P1, zone: "hand" },
    { key: "fd", def: gizmo(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...res({ elitism: 1 })
  ]);
  invent(g, false);
  assert.equal(ready(g.engine), 0, "only the tactic's own cost 1");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true);
});

clause(INVENTION, "0:ability", "the item's threshold still applies (CR 604.1b): a [G] item cannot be played with no Greed", () => {
  const g = inventionBoard({ elitism: 2, greed: 0 });
  playRaw(g.engine, P1, g.id("ai"), { selected: { revealed: [g.id("fd")] } });
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) refused(() => answerPending(g.engine, "deployForFree", { cardId: g.id("fd") }), "the [G] threshold is not met");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true, "still face-down: it could not be played");
  const ok = inventionBoard({ elitism: 2, greed: 1 });
  invent(ok, true);
  assert.equal(isFaceDown(ok.engine, ok.id("fd")), false, "control: with a [G] it can be played");
});

clause(INVENTION, "0:ability", "the item enters play as a new card (CR 411.3): its enters-play trigger fires when I play it", () => {
  const g = inventionBoard({ gizmoDef: gizmoTrigger() });
  const before = influenceOf(g.engine, P1);
  invent(g, true);
  assert.equal(influenceOf(g.engine, P1) - before, 1);
  const declined = inventionBoard({ gizmoDef: gizmoTrigger() });
  invent(declined, false);
  assert.equal(influenceOf(declined.engine, P1), before, "control: declining plays nothing");
});

clause(INVENTION, "0:ability", "Accidental Invention itself goes to its owner's discard pile once it has resolved", () => {
  const g = inventionBoard();
  invent(g, true);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ai")), "discardOf(g.engine, P1).includes(g.id(\"ai\"))");
});

clause(INVENTION, "0:ability", "played in response on the opponent's turn, I may still play the item (an effect deploys it whoever's turn it is, CR 206.1)", () => {
  const g = inventionBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  invent(g, true);
  assert.equal(isFaceDown(g.engine, g.id("fd")), false);
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
});

// --- 1:rule — While this card is in your discard pile, if a card that provides at least [E] enters play under your control, you may pay 2. If you do, put this card into play under your control as a face-down resource.

/** A free tactic (id "pip", pick "t"): puts one card of mine from my hand into play (face-up). */
const putTactic = (name = "Put Into Play", faceDown = false): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", ...(faceDown ? { faceDown: true } : {}) }]
        }
      ]
    }
  });

const elitismCard = (name = "Elitism"): CardDefinition => resourceCard({ name, resource: { provides: ["elitism"], staple: true } });

const recurBoard = (o: { elitism?: number; greed?: number; extra?: CardPlacement[]; zone?: Zone; active?: PlayerId } = {}) => {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "ai", def: printing(INVENTION), owner: P1, zone: o.zone ?? "discard" },
      { key: "elit", def: elitismCard(), owner: P1, zone: "hand" },
      { key: "gr", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "junk", def: character({ name: "Junk Card", cost: 0 }), owner: P1, zone: "hand" },
      { key: "put", def: putTactic(), owner: P1, zone: "hand" },
      { key: "putFd", def: putTactic("Put Face-Down", true), owner: P1, zone: "hand" },
      ...res({ greed: o.greed ?? 2, elitism: o.elitism ?? 0 }),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
};

/** Answers a `mayPay` with `pay`, anything else with the default decline. */
const payAnswer = (pay: boolean) => (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc));

/** Puts the card at placement key `card` into play with my "Put Into Play" tactic (`tactic` key); a prompt may stay open. */
function enter(g: Game, card: string, tacticKey = "put"): void {
  playRaw(g.engine, P1, g.id(tacticKey), { selected: { t: [g.id(card)] } });
  resolvePendingResponses(g.engine);
}

/** Plays the resource card `key` with my Develop Rule; a prompt may stay open. */
function developCard(g: Game, key: string, faceDown: boolean): void {
  developResource(g.engine, P1, g.id(key), faceDown);
  resolvePendingResponses(g.engine);
}

clause(INVENTION, "1:rule", "an Elitism resource entering play under my control offers me the payment: accepting pays exactly 2 and puts it into play face-down under my control", () => {
  const g = recurBoard({ greed: 3 });
  enter(g, "elit");
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal((pc.cost as { amount?: number }[])[0].amount, 2);
  const before = ready(g.engine);
  drain(g.engine, payAnswer(true));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
  assert.equal(controllerOf(g.engine, g.id("ai")), P1);
  assert.equal(g.engine.isResource(g.id("ai")), true);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("ai")), "no longer in the discard pile");
  assert.equal(before - 2 + 1 - ready(g.engine), 0, "2 paid, and the face-down Accidental Invention itself is a new ready resource");
});

clause(INVENTION, "1:rule", "it is a 'may': declining the payment leaves it in the discard pile and pays nothing", () => {
  const g = recurBoard();
  enter(g, "elit");
  const before = ready(g.engine);
  expectPending(g.engine, "mayPay");
  drain(g.engine, payAnswer(false));
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
  assert.equal(ready(g.engine), before);
});

clause(INVENTION, "1:rule", "'you may pay 2': with fewer than 2 ready resources it cannot be paid and the card stays in the discard pile", () => {
  const g = recurBoard({ greed: 0, elitism: 0 });
  enter(g, "elit");
  assert.equal(ready(g.engine), 1, "setup: only the new Elitism is ready");
  const pc = pending(g.engine);
  if (pc) refused(() => answerPending(g.engine, "mayPay", { pay: true }), "paying 2 with 1 resource");
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "the payment is paid from ready resources: spent resources cannot pay it", () => {
  const g = recurBoard({ greed: 0, extra: spent("greed", 3) });
  enter(g, "elit");
  assert.equal(ready(g.engine), 1);
  const pc = pending(g.engine);
  if (pc) refused(() => answerPending(g.engine, "mayPay", { pay: true }), "only one ready resource");
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "a Greed resource entering play does not provide [E]: no offer", () => {
  const g = recurBoard();
  enter(g, "gr");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "an Elitism card put into play FACE-DOWN provides Volition, not [E]: no offer", () => {
  const g = recurBoard();
  enter(g, "elit", "putFd");
  assert.equal(isFaceDown(g.engine, g.id("elit")), true, "setup: it entered face-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "a non-resource card put into play face-down provides Volition: no offer", () => {
  const g = recurBoard();
  enter(g, "junk", "putFd");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "a character that provides [E] (Braggadocian Aide) entering play under my control offers the payment too", () => {
  const g = recurBoard({ elitism: 1, greed: 6, extra: [{ key: "aide", def: printing(AIDE), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("aide"));
  expectPending(g.engine, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
});

clause(INVENTION, "1:rule", "'at least [E]': a card providing [E][E] counts too", () => {
  const g = recurBoard({ extra: [{ key: "double", def: resourceCard({ name: "Double Elitism", resource: { provides: ["elitism", "elitism"], staple: false } }), owner: P1, zone: "hand" }] });
  enter(g, "double");
  expectPending(g.engine, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
});

clause(INVENTION, "1:rule", "a non-providing character entering play gives no offer", () => {
  const g = recurBoard();
  enter(g, "junk");
  assert.equal(zoneOf(g.engine, g.id("junk")), "play", "setup: it entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "a non-providing character DEPLOYED from hand gives no offer", () => {
  const g = recurBoard({ extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("plain"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "an Elitism resource played with my Develop Rule 'enters play' (CR 605.3): it offers me the payment", () => {
  const g = recurBoard({ greed: 3 });
  developCard(g, "elit", false);
  expectPending(g.engine, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
});

clause(INVENTION, "1:rule", "only cards entering play under MY control: the opponent's Elitism entering play gives me no offer", () => {
  const g = recurBoard({
    extra: [
      { key: "theirElit", def: elitismCard("Their Elitism"), owner: P2, zone: "hand" },
      { key: "theirPut", def: tactic({ name: "Their Put", cost: 0, behavior: { abilities: [{ id: "tp", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P2, zone: "hand" }
    ]
  });
  // the opponent puts their Elitism into play in response to my no-op on my turn
  playRaw(g.engine, P1, g.id("put"), { selected: { t: [g.id("junk")] } });
  playRaw(g.engine, P2, g.id("theirPut"), { selected: { t: [g.id("theirElit")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("theirElit")), "play", "setup: it entered play under their control");
  assert.equal(controllerOf(g.engine, g.id("theirElit")), P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "it is control, not ownership, that matters: an Elitism card the opponent owns but I put into play under MY control gives the offer", () => {
  const g = recurBoard({
    extra: [
      { key: "borrowedElit", def: elitismCard("Borrowed Elitism"), owner: P2, zone: "hand" },
      { key: "borrow", def: tactic({ name: "Borrow", cost: 0, behavior: { abilities: [{ id: "bw", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "opponent", type: "resource" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(g.engine, P1, g.id("borrow"), { selected: { t: [g.id("borrowedElit")] } });
  resolvePendingResponses(g.engine);
  assert.equal(controllerOf(g.engine, g.id("borrowedElit")), P1, "setup: it entered under my control");
  expectPending(g.engine, "mayPay");
});

for (const [label, zone] of [
  ["my hand", "hand"],
  ["my deck", "deck"],
  ["the removed-from-game area", "removed"]
] as const) {
  clause(INVENTION, "1:rule", `it only works from the discard pile: with Accidental Invention in ${label} an entering Elitism gives no offer`, () => {
    const g = recurBoard({ zone });
    enter(g, "elit");
    assert.equal(zoneOf(g.engine, g.id("elit")), "play", "setup: the Elitism entered play");
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("ai")), zone);
  });
}

clause(INVENTION, "1:rule", "a face-up copy cannot be in play; a FACE-DOWN copy in play is just a resource and gives no offer", () => {
  const g = recurBoard({ zone: "play" });
  g.engine.state.cards[g.id("ai")].faceDown = true;
  enter(g, "elit");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(INVENTION, "1:rule", "it is MY discard pile: the opponent's copy in THEIR discard pile gives neither of us an offer when my Elitism enters", () => {
  const g = recurBoard({ zone: "hand", extra: [{ key: "theirAi", def: printing(INVENTION), owner: P2, zone: "discard" }] });
  enter(g, "elit");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirAi")), "discard");
});

clause(INVENTION, "1:rule", "two Accidental Inventions in my discard pile each get their own offer; paying for one puts only that one into play", () => {
  const g = recurBoard({ greed: 4, extra: [{ key: "ai2", def: printing(INVENTION), owner: P1, zone: "discard" }] });
  enter(g, "elit");
  let guard = 0;
  let asked = 0;
  while (g.engine.state.pendingChoice && guard++ < 8) {
    const pc = pending(g.engine)!;
    if (pc.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else if (pc.kind === "mayPay") {
      answerPending(g.engine, "mayPay", { pay: asked === 0 });
      asked++;
    } else answerPending(g.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  }
  const inPlay = [g.id("ai"), g.id("ai2")].filter((id) => zoneOf(g.engine, id) === "play");
  assert.equal(inPlay.length, 1, "exactly one of the two came back");
  assert.equal(asked, 2, "I was asked twice");
});

clause(INVENTION, "1:rule", "once it is back in play it no longer triggers: a second Elitism gives no further offer", () => {
  const g = recurBoard({ greed: 4, extra: [{ key: "elit2", def: elitismCard(), owner: P1, zone: "hand" }, { key: "put2", def: putTactic("Put Again"), owner: P1, zone: "hand" }] });
  enter(g, "elit");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
  enter(g, "elit2", "put2");
  assert.equal(zoneOf(g.engine, g.id("elit2")), "play", "setup: another Elitism entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(INVENTION, "1:rule", "declining keeps the offer alive: a later Elitism entering play offers it again", () => {
  const g = recurBoard({ extra: [{ key: "elit2", def: elitismCard(), owner: P1, zone: "hand" }, { key: "put2", def: putTactic("Put Again"), owner: P1, zone: "hand" }] });
  enter(g, "elit");
  drain(g.engine, payAnswer(false));
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
  enter(g, "elit2", "put2");
  expectPending(g.engine, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("ai")), "play");
});

clause(INVENTION, "1:rule", "the returned card is a face-down resource that is ready to use and has no type of its own", () => {
  const g = recurBoard({ greed: 3 });
  enter(g, "elit");
  drain(g.engine, payAnswer(true));
  assert.deepEqual(g.engine.getCardTypes(g.id("ai")), ["resource"]);
  assert.equal(g.engine.state.cards[g.id("ai")].attachedTo, undefined, "not spent");
  assert.ok(playOf(g.engine, P1).includes(g.id("ai")), "playOf(g.engine, P1).includes(g.id(\"ai\"))");
});

// --- 2:flipUp — FLIP UP: 1 [E]

function flipBoard(o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; fdItem?: boolean; extra?: CardPlacement[]; aiSpent?: boolean; fdSpent?: boolean } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "ai", def: printing(INVENTION), owner: P1, zone: "play", faceDown: true, attachedToKey: o.aiSpent ? "__factionA" : undefined },
      ...(o.fdItem === false ? [] : [{ key: "fd", def: gizmo(), owner: P1, zone: "play" as const, faceDown: true, attachedToKey: o.fdSpent ? "__factionA" : undefined }]),
      ...fillers("deck", 3, P1, "deck"),
      ...res({ elitism: o.elitism ?? 1, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

const flipAI = (g: Game, pick = "fd", player: PlayerId = P1): void => flipUpRaw(g.engine, player, g.id("ai"), { revealed: [g.id(pick)] });

clause(INVENTION, "2:flipUp", "a face-down Accidental Invention flips up and works as a tactic: it reveals the face-down item, lets me play it, draws a card, and ends in the discard pile", () => {
  const g = flipBoard({ greed: 3 });
  flipAI(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: g.id("fd") } : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isFaceDown(g.engine, g.id("fd")), false, "the item was played");
  assert.equal(handOf(g.engine, P1).length, 1, "a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard", "the tactic finished in the discard pile");
});

clause(INVENTION, "2:flipUp", "FLIP UP pays exactly 1: with plenty of resources one is attached to the faction (the flipped card itself stops being a resource)", () => {
  const g = flipBoard({ elitism: 2, greed: 3 });
  const before = ready(g.engine);
  flipAI(g);
  assert.equal(before - ready(g.engine), 1 + 1, "1 paid, and the flipped card itself is no longer a resource");
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(INVENTION, "2:flipUp", "the card may pay for its own FLIP UP (CR 507.4b): a spent [E] with only the face-down cards ready is enough", () => {
  const g = flipBoard({ elitism: 0, spentElitism: 1 });
  assert.equal(ready(g.engine), 2, "setup: the two face-down cards are the only ready resources");
  flipAI(g);
  assert.equal(isFaceDown(g.engine, g.id("ai")), false);
});

clause(INVENTION, "2:flipUp", "FLIP UP needs [E]: without any Elitism it is refused and nothing is paid", () => {
  const g = flipBoard({ elitism: 0, greed: 4 });
  refused(() => flipAI(g), "no [E]");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
  assert.equal(ready(g.engine), 6, "nothing was paid (4 Greed + 2 face-down)");
});

clause(INVENTION, "2:flipUp", "FLIP UP is refused with no resource to pay (everything is spent): the [E] is there but 1 cannot be paid", () => {
  const g = flipBoard({ elitism: 0, spentElitism: 2, aiSpent: true, fdSpent: true });
  assert.equal(ready(g.engine), 0);
  assert.equal(elitism(g.engine), 2, "setup: the threshold is met");
  refused(() => flipAI(g), "nothing ready to pay 1");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
});

clause(INVENTION, "2:flipUp", "a flipped-up Accidental Invention still needs its extra cost: with no face-down item to reveal it cannot be flipped up", () => {
  const g = flipBoard({ fdItem: false, greed: 2 });
  const before = ready(g.engine);
  refused(() => flipUpRaw(g.engine, P1, g.id("ai"), {}), "no face-down item to reveal");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(INVENTION, "2:flipUp", "FLIP UP cannot reveal a face-up item or the opponent's face-down item", () => {
  const g = flipBoard({ extra: [{ key: "faceUp", def: item({ name: "Visible" }), owner: P1, zone: "play" }, { key: "theirs", def: gizmo("Theirs"), owner: P2, zone: "play", faceDown: true }] });
  refused(() => flipAI(g, "faceUp"), "a face-up item");
  refused(() => flipAI(g, "theirs"), "the opponent's face-down item");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
});

clause(INVENTION, "2:flipUp", "FLIP UP works in response on the opponent's turn (it is a tactic), but not with no window open", () => {
  const g = flipBoard({ active: P2, greed: 3, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  refused(() => flipAI(g), "no response window is open on the opponent's turn");
  assert.equal(isFaceDown(g.engine, g.id("ai")), true);
  playRaw(g.engine, P2, g.id("noop"));
  flipAI(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree" } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(INVENTION, "2:flipUp", "only a face-down Accidental Invention I control in play can be flipped up (not in hand, not the opponent's)", () => {
  const inHand = flipBoard({ extra: [{ key: "ai2", def: printing(INVENTION), owner: P1, zone: "hand" }] });
  refused(() => flipUpRaw(inHand.engine, P1, inHand.id("ai2"), { revealed: [inHand.id("fd")] }), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("ai2")), "hand");
  const theirs = flipBoard();
  refused(() => flipAI(theirs, "fd", P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ai")), true);
});

clause(INVENTION, "2:flipUp", "once flipped up and resolved it is in my discard pile, so its recursion rule is live again", () => {
  const g = flipBoard({ elitism: 1, greed: 6, extra: [{ key: "elit", def: elitismCard(), owner: P1, zone: "hand" }, { key: "put", def: putTactic(), owner: P1, zone: "hand" }] });
  flipAI(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree" } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
  enter(g, "elit");
  expectPending(g.engine, "mayPay");
});

// =============================================================================
// Braggadocian Aide
// PROVIDES: [E]
// At the start of your opponent's turn, you may pick a resource attached to
// your faction. If you do, detach it from your faction.
// Character (craftsman), gearsmith, cost 4, [E]; 2 strength / 3 speed / 3 life.
// =============================================================================

/** One staple resource under an explicit placement key. */
const keyed = (key: string, icon: StapleIcon, owner: PlayerId = P1, over: Partial<CardPlacement> = {}): CardPlacement => ({ ...bank(icon, 1, owner)[0], key, ...over });

/** A resource already attached to (spent on) `owner`'s faction. */
const keyedSpent = (key: string, icon: StapleIcon, owner: PlayerId = P1): CardPlacement =>
  keyed(key, icon, owner, { attachedToKey: owner === P1 ? "__factionA" : "__factionB" });

// The Aide triggers at the start of EACH opponent's turn: at a bigger table an extra seat's turn start is one too and
// would offer the controller its pick before the turn the clause is about. The extra seats sit out of the turn rotation
// here; multiplayer-tables-saga.test.ts plays it at a real bigger table.
function aideBoard(
  o: { aide?: Partial<CardPlacement>; extra?: CardPlacement[]; active?: PlayerId } = {}
) {
  const active = o.active ?? P1;
  const game = devBoard(
    [
      { key: "aide", def: printing(AIDE), owner: P1, zone: "play", ...o.aide },
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
  game.engine.state.turnOrder = game.engine.state.turnOrder.filter((id) => id === P1 || id === P2);
  return game;
}

const isAttached = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].attachedTo !== undefined;

/** Answers the Aide's pick with `keys` (placement keys) and drains. */
function aidePick(g: Game, keys: string[]): void {
  answerPending(g.engine, "selectTargets", { selected: { res: keys.map((k) => g.id(k)) } });
}

// --- stats and deploying

clause(AIDE, "0:provides", "it deploys for exactly its printed cost of 4 with [E], and is a craftsman character with 2 strength / 3 speed / 3 life", () => {
  const g = devBoard([{ key: "a", def: printing(AIDE), owner: P1, zone: "hand" }, ...res({ elitism: 5 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("a"));
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(before - ready(g.engine), 4);
  assert.deepEqual(g.engine.getCardTypes(g.id("a")), ["character"]);
  assert.equal(g.engine.getStat(g.id("a"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("a"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("a"), "life"), 3);
  assert.deepEqual(g.engine.getSubtypes(g.id("a")), ["craftsman"]);
});

clause(AIDE, "0:provides", "it is refused one resource short (3 Elitism) and without [E] (4 Greed), and nothing is paid", () => {
  const short = devBoard([{ key: "a", def: printing(AIDE), owner: P1, zone: "hand" }, ...res({ elitism: 3 })]);
  refused(() => playRaw(short.engine, P1, short.id("a")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("a")), "hand");
  assert.equal(ready(short.engine), 3);
  const noThreshold = devBoard([{ key: "a", def: printing(AIDE), owner: P1, zone: "hand" }, ...res({ greed: 4 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("a")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("a")), "hand");
});

// --- 0:provides — PROVIDES: [E]

clause(AIDE, "0:provides", "in play it provides exactly one [E]: my Elitism goes from 0 to 1 and nothing else changes", () => {
  const g = aideBoard();
  assert.equal(elitism(g.engine), 1);
  const icons = g.engine.getThresholds(P1);
  assert.equal(icons.greed ?? 0, 0);
  assert.equal(icons.rage ?? 0, 0);
  assert.equal(icons.deception ?? 0, 0);
  assert.equal(icons.obsession ?? 0, 0);
  assert.equal(icons.volition ?? 0, 0);
});

clause(AIDE, "0:provides", "the icon appears the moment it enters play", () => {
  const g = devBoard([{ key: "a", def: printing(AIDE), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]);
  assert.equal(elitism(g.engine), 4);
  playAndResolve(g.engine, P1, g.id("a"));
  assert.equal(elitism(g.engine), 4 + 1 - 4 + 4, "the 4 paid resources stay (icons are never spent) and the Aide adds one");
});

clause(AIDE, "0:provides", "it adds to the resources' own icons: 2 Elitism resources and the Aide make 3 [E]", () => {
  const g = aideBoard({ extra: res({ elitism: 2 }) });
  assert.equal(elitism(g.engine), 3);
});

clause(AIDE, "0:provides", "two Aides provide two [E]", () => {
  const g = aideBoard({ extra: [{ key: "aide2", def: printing(AIDE), owner: P1, zone: "play" }] });
  assert.equal(elitism(g.engine), 2);
});

clause(AIDE, "0:provides", "the provided [E] meets thresholds: a card needing [E] can be deployed with the Aide as my only [E], but not one needing [E][E]", () => {
  const g = aideBoard({ extra: [{ key: "e1", def: character({ name: "Needs 1", cost: 0, threshold: "e" }), owner: P1, zone: "hand" }, { key: "e2", def: character({ name: "Needs 2", cost: 0, threshold: "ee" }), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("e1"));
  assert.equal(zoneOf(g.engine, g.id("e1")), "play");
  refused(() => playRaw(g.engine, P1, g.id("e2")), "only one [E]");
  assert.equal(zoneOf(g.engine, g.id("e2")), "hand");
});

clause(AIDE, "0:provides", "a threshold of [E][E] is met by the Aide plus one Elitism resource", () => {
  const g = aideBoard({ extra: [...res({ elitism: 1 }), { key: "e2", def: character({ name: "Needs 2", cost: 0, threshold: "ee" }), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("e2"));
  assert.equal(zoneOf(g.engine, g.id("e2")), "play");
});

clause(AIDE, "0:provides", "providing an icon does not make it a resource to pay with: with only the Aide in play nothing can be paid", () => {
  const g = aideBoard({ extra: [{ key: "one", def: character({ name: "Costs 1", cost: 1 }), owner: P1, zone: "hand" }] });
  assert.equal(ready(g.engine), 0, "the Aide is not a payable resource");
  refused(() => playRaw(g.engine, P1, g.id("one")), "nothing to pay with");
  assert.equal(zoneOf(g.engine, g.id("one")), "hand");
});

clause(AIDE, "0:provides", "a depleted Aide still provides [E] (icons are never spent)", () => {
  const g = aideBoard({ aide: { depleted: true } });
  assert.equal(elitism(g.engine), 1);
});

clause(AIDE, "0:provides", "an Aide in my hand, discard pile or deck provides nothing", () => {
  for (const zone of ["hand", "discard", "deck"] as const) {
    const g = aideBoard({ aide: { zone } });
    assert.equal(elitism(g.engine), 0, zone);
  }
});

clause(AIDE, "0:provides", "a FACE-DOWN Aide provides only Volition, not [E] (CR 411.1)", () => {
  const g = aideBoard({ aide: { faceDown: true } });
  assert.equal(elitism(g.engine), 0);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(AIDE, "0:provides", "the icon is gone once the Aide leaves play", () => {
  const g = aideBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(elitism(g.engine), 1);
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("aide")] } });
  assert.equal(zoneOf(g.engine, g.id("aide")), "discard");
  assert.equal(elitism(g.engine), 0);
});

clause(AIDE, "0:provides", "it provides to its CONTROLLER: an Aide the opponent controls gives them [E] and me none", () => {
  const g = aideBoard({ aide: { controller: P2 } });
  assert.equal(elitism(g.engine, P2), 1);
  assert.equal(elitism(g.engine, P1), 0);
});

// --- 1:rule — At the start of your opponent's turn, you may pick a resource attached to your faction. If you do, detach it from your faction.

const startOpp = (g: Game): void => endTurn(g.engine, P1);

clause(AIDE, "1:rule", "at the start of my opponent's turn I may pick a resource attached to my faction: picking it detaches it", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("sp2", "greed")] });
  assert.equal(isAttached(g.engine, g.id("sp")), true);
  startOpp(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
  aidePick(g, ["sp"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isAttached(g.engine, g.id("sp")), false, "detached");
  assert.equal(isAttached(g.engine, g.id("sp2")), true, "the other spent resource stays attached");
});

clause(AIDE, "1:rule", "a detached resource is ready to pay again: the count of ready resources goes up by one", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("sp2", "greed")] });
  assert.equal(ready(g.engine), 0);
  startOpp(g);
  aidePick(g, ["sp"]);
  assert.equal(ready(g.engine), 1);
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(AIDE, "1:rule", "'a resource': only ONE resource is picked and detached, even with several attached; picking two is refused", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("sp2", "greed"), keyedSpent("sp3", "rage")] });
  startOpp(g);
  refused(() => aidePick(g, ["sp", "sp2"]), "two resources");
  const h = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("sp2", "greed"), keyedSpent("sp3", "rage")] });
  startOpp(h);
  aidePick(h, ["sp3"]);
  assert.equal(attachedCount(h.engine, P1), 2, "exactly one was detached");
  assert.equal(isAttached(h.engine, h.id("sp3")), false);
});

clause(AIDE, "1:rule", "it is a 'may': picking nothing detaches nothing", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed")] });
  startOpp(g);
  aidePick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isAttached(g.engine, g.id("sp")), true);
});

clause(AIDE, "1:rule", "a resource of any icon can be picked, and a face-down resource attached to my faction is a resource too", () => {
  const g = aideBoard({ extra: [keyedSpent("fdRes", "greed"), keyedSpent("sp2", "rage")] });
  g.engine.state.cards[g.id("fdRes")].faceDown = true;
  startOpp(g);
  aidePick(g, ["fdRes"]);
  assert.equal(isAttached(g.engine, g.id("fdRes")), false);
  assert.equal(isFaceDown(g.engine, g.id("fdRes")), true, "it stays face-down; only detached");
});

clause(AIDE, "1:rule", "the pick must be a resource ATTACHED to my faction: a ready (unattached) resource is refused", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), keyed("rd", "rage")] });
  startOpp(g);
  refused(() => aidePick(g, ["rd"]), "a resource that is not attached to my faction");
  assert.equal(isAttached(g.engine, g.id("sp")), true);
});

clause(AIDE, "1:rule", "with no resource attached to my faction there is nothing to pick: no prompt is raised", () => {
  const g = aideBoard({ extra: [keyed("rd", "rage"), keyed("rd2", "greed")] });
  startOpp(g);
  assert.equal(g.engine.state.pendingChoice, undefined, "all my resources are ready, none is attached");
});

clause(AIDE, "1:rule", "an attached resource of the opponent's cannot be picked", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("theirs", "greed", P2)] });
  startOpp(g);
  refused(() => aidePick(g, ["theirs"]), "the opponent's resource");
  const ok = aideBoard({ extra: [keyedSpent("sp", "greed"), keyedSpent("theirs", "greed", P2)] });
  startOpp(ok);
  aidePick(ok, ["sp"]);
  assert.equal(isAttached(ok.engine, ok.id("sp")), false, "control: my own attached resource works");
});

clause(AIDE, "1:rule", "a card that is not a resource cannot be picked: not a character, an item, or the Aide itself", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "play" }, { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }] });
  startOpp(g);
  refused(() => aidePick(g, ["chr"]), "a character");
  const h = aideBoard({ extra: [keyedSpent("sp", "greed"), { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }] });
  startOpp(h);
  refused(() => aidePick(h, ["itm"]), "an item");
  const k = aideBoard({ extra: [keyedSpent("sp", "greed")] });
  startOpp(k);
  refused(() => aidePick(k, ["aide"]), "the Aide itself");
  assert.equal(isAttached(k.engine, k.id("sp")), true);
});

clause(AIDE, "1:rule", "my faction cannot be picked (CR 202.9)", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed")] });
  startOpp(g);
  refused(() => answerPending(g.engine, "selectTargets", { selected: { res: [factionOf(g.engine, P1)] } }), "my faction");
});

clause(AIDE, "1:rule", "it happens at the start of my OPPONENT's turn only: at the start of MY turn I am not offered the pick", () => {
  const g = aideBoard({ active: P2, extra: [keyedSpent("sp", "greed"), keyedSpent("sp2", "greed")] });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(AIDE, "1:rule", "the resource detached at the start of their turn can be used during their turn: I pay 1 for an ability in response", () => {
  const g = aideBoard({
    extra: [keyedSpent("sp", "greed"), payer(1), { key: "noop", def: NOOP, owner: P2, zone: "hand" }, ...fillers("deck", 2, P1, "deck")]
  });
  startOpp(g);
  aidePick(g, ["sp"]);
  playRaw(g.engine, P2, g.id("noop"));
  actRaw(g.engine, P1, g.id("payer"), "pay");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, 1, "the 'Pay 1' ability worked with the freshly detached resource");
  assert.equal(ready(g.engine), 0);
});

clause(AIDE, "1:rule", "it is the Aide's CONTROLLER's opponent that matters: an Aide the opponent controls offers THEM the pick at the start of MY turn", () => {
  const g = aideBoard({ active: P2, aide: { controller: P2 }, extra: [keyedSpent("theirSp", "greed", P2)] });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P2);
  answerPending(g.engine, "selectTargets", { selected: { res: [g.id("theirSp")] } });
  assert.equal(isAttached(g.engine, g.id("theirSp")), false);
});

clause(AIDE, "1:rule", "an Aide the opponent controls does not offer ME anything at the start of THEIR turn", () => {
  const g = aideBoard({ aide: { controller: P2 }, extra: [keyedSpent("sp", "greed")] });
  startOpp(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(AIDE, "1:rule", "two Aides each get a pick: both resources can be detached", () => {
  const g = aideBoard({ extra: [{ key: "aide2", def: printing(AIDE), owner: P1, zone: "play" }, keyedSpent("sp", "greed"), keyedSpent("sp2", "greed"), keyedSpent("sp3", "greed")] });
  startOpp(g);
  let picks = 0;
  let guard = 0;
  const targets = ["sp", "sp2"];
  while (g.engine.state.pendingChoice && guard++ < 8) {
    const pc = pending(g.engine)!;
    if (pc.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else if (pc.kind === "selectTargets") aidePick(g, [targets[picks++]]);
    else break;
  }
  assert.equal(picks, 2);
  assert.equal(attachedCount(g.engine, P1), 1, "two of the three were detached");
});

clause(AIDE, "1:rule", "a face-down Aide, or one in my hand or discard pile, does nothing at the start of their turn", () => {
  for (const [label, over] of [
    ["face-down", { faceDown: true }],
    ["hand", { zone: "hand" as const }],
    ["discard pile", { zone: "discard" as const }]
  ] as const) {
    const g = aideBoard({ aide: over, extra: [keyedSpent("sp", "greed")] });
    startOpp(g);
    assert.equal(g.engine.state.pendingChoice, undefined, label);
    assert.equal(isAttached(g.engine, g.id("sp")), true, label);
  }
});

clause(AIDE, "1:rule", "a destroyed Aide stops detaching", () => {
  const g = aideBoard({ extra: [keyedSpent("sp", "greed"), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("aide")] } });
  startOpp(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isAttached(g.engine, g.id("sp")), true);
});

// =============================================================================
// Cantankerous Claywork
// This card can attack even if it has not been in play under your control since
// the start of the turn.
// If this card attacks, all your other characters gain 1 strength and 1 life
// this turn.
// Character (golem), gearsmith, cost 7, [E][E][E]; 6 strength / 3 speed / 5 life.
// =============================================================================

const CLAY = "717fc4d5-6709-4176-9418-a405a345ab87";

function clayBoard(o: { eligible?: boolean; extra?: CardPlacement[]; active?: PlayerId; clay?: Partial<CardPlacement> } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "clay", def: printing(CLAY), owner: P1, zone: "play", attackEligible: o.eligible, ...o.clay },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "rest", def: character({ name: "Resting Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** Claywork attacks the opponent's faction (response window drained, blockers not yet declared). */
const clayAttack = (g: Game, ...others: string[]): void => declareAttackBy(g.engine, P1, [g.id("clay"), ...others.map((k) => g.id(k))]);

const statsOf = (g: Game, key: string): [number, number] => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "life")];

// --- stats and deploying

clause(CLAY, "0:rule", "it deploys for exactly its printed cost of 7 with [E][E][E], and is a golem character with 6 strength / 3 speed / 5 life", () => {
  const g = devBoard([{ key: "c", def: printing(CLAY), owner: P1, zone: "hand" }, ...res({ elitism: 8 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(before - ready(g.engine), 7);
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["character"]);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 5);
  assert.deepEqual(g.engine.getSubtypes(g.id("c")), ["golem"]);
});

clause(CLAY, "0:rule", "it is refused one resource short (6 Elitism) and without [E][E][E] (2 Elitism + 5 Greed), and nothing is paid", () => {
  const short = devBoard([{ key: "c", def: printing(CLAY), owner: P1, zone: "hand" }, ...res({ elitism: 6 })]);
  refused(() => playRaw(short.engine, P1, short.id("c")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  assert.equal(ready(short.engine), 6);
  const noThreshold = devBoard([{ key: "c", def: printing(CLAY), owner: P1, zone: "hand" }, ...res({ elitism: 2, greed: 5 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("c")), "only two [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("c")), "hand");
});

// --- 0:rule — This card can attack even if it has not been in play under your control since the start of the turn.

clause(CLAY, "0:rule", "it can attack the turn it entered play: attack declared, battle starts", () => {
  const g = clayBoard({ eligible: false });
  clayAttack(g);
  assert.ok(battleOf(g.engine), "the attack was declared");
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("clay")]);
});

clause(CLAY, "0:rule", "control: an ordinary character that entered play this turn cannot attack", () => {
  const g = clayBoard({ extra: [{ key: "fresh", def: character({ name: "Fresh" }), owner: P1, zone: "play", attackEligible: false }] });
  refused(() => declareAttackBy(g.engine, P1, [g.id("fresh")]), "entered play this turn");
  assert.equal(battleOf(g.engine), undefined);
});

clause(CLAY, "0:rule", "deployed from my hand this turn it can attack at once, and hits the faction for its 6 strength", () => {
  const g = devBoard([{ key: "clay", def: printing(CLAY), owner: P1, zone: "hand" }, ...res({ elitism: 7 })]);
  playAndResolve(g.engine, P1, g.id("clay"));
  fightThrough(g.engine, P1, [g.id("clay")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(g.engine, P2), 24);
});

clause(CLAY, "0:rule", "it only waives the 'in play since the start of the turn' condition: a depleted Claywork still cannot attack", () => {
  const g = clayBoard({ eligible: false, clay: { depleted: true } });
  refused(() => clayAttack(g), "depleted");
  assert.equal(battleOf(g.engine), undefined);
});

clause(CLAY, "0:rule", "it applies to a Claywork I took control of this turn", () => {
  const stolen = devBoard([
    { key: "theirClay", def: printing(CLAY), owner: P2, zone: "play", attackEligible: false },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  playAndResolve(stolen.engine, P1, stolen.id("steal"), { selected: { t: [stolen.id("theirClay")] } });
  assert.equal(controllerOf(stolen.engine, stolen.id("theirClay")), P1);
  declareAttackBy(stolen.engine, P1, [stolen.id("theirClay")]);
  assert.ok(battleOf(stolen.engine), "the stolen Claywork attacks at once");
});

clause(CLAY, "0:rule", "a face-down Claywork is just a resource: it cannot attack", () => {
  const g = clayBoard({ clay: { faceDown: true } });
  refused(() => clayAttack(g), "a face-down card is not a character");
});

clause(CLAY, "0:rule", "it has the AGGRO keyword, and an ordinary character does not", () => {
  const g = clayBoard();
  assert.ok(g.engine.getKeywords(g.id("clay")).includes("aggro"), "g.engine.getKeywords(g.id(\"clay\")).includes(\"aggro\")");
  assert.equal(g.engine.getKeywords(g.id("ally")).includes("aggro"), false);
});

// --- 1:rule — If this card attacks, all your other characters gain 1 strength and 1 life this turn.

clause(CLAY, "1:rule", "when it attacks, each of my other characters gains 1 strength and 1 life", () => {
  const g = clayBoard();
  assert.deepEqual(statsOf(g, "ally"), [2, 2]);
  clayAttack(g);
  assert.deepEqual(statsOf(g, "ally"), [3, 3]);
});

clause(CLAY, "1:rule", "'all' my other characters: a depleted character and one that is not in the party get it too", () => {
  const g = clayBoard();
  clayAttack(g);
  assert.deepEqual(statsOf(g, "rest"), [2, 4], "the depleted one");
  assert.deepEqual(statsOf(g, "ally"), [3, 3], "the one that stays home");
});

clause(CLAY, "1:rule", "'other': Claywork itself gains nothing", () => {
  const g = clayBoard();
  clayAttack(g);
  assert.deepEqual(statsOf(g, "clay"), [6, 5]);
});

clause(CLAY, "1:rule", "speed is not changed", () => {
  const g = clayBoard();
  clayAttack(g);
  assert.equal(g.engine.getStat(g.id("ally"), "speed"), 2);
});

clause(CLAY, "1:rule", "the opponent's characters gain nothing", () => {
  const g = clayBoard();
  clayAttack(g);
  assert.deepEqual(statsOf(g, "foe"), [1, 9]);
});

clause(CLAY, "1:rule", "only characters: my items, locations and resources are unaffected (no stats appear), and a face-down card stays a resource", () => {
  const g = clayBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P1, zone: "play" },
      { key: "fdc", def: character({ name: "Face Down Char", strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  clayAttack(g);
  assert.equal(g.engine.getStat(g.id("loc"), "structure"), 3, "a location's structure is unchanged");
  assert.deepEqual(g.engine.getCardTypes(g.id("fdc")), ["resource"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(CLAY, "1:rule", "'control', not 'own': a character I control but do not own gains it; one I own but the opponent controls does not", () => {
  const g = clayBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed", strength: 1, life: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent", strength: 1, life: 1 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  clayAttack(g);
  assert.deepEqual(statsOf(g, "borrowed"), [2, 2]);
  assert.deepEqual(statsOf(g, "lent"), [1, 1]);
});

clause(CLAY, "1:rule", "it only happens if THIS card attacks: another character attacking alone gives nothing", () => {
  const g = clayBoard();
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  assert.deepEqual(statsOf(g, "ally"), [2, 2]);
  assert.deepEqual(statsOf(g, "rest"), [1, 3]);
});

clause(CLAY, "1:rule", "blocking is not attacking: Claywork blocking on the opponent's turn gives nothing", () => {
  const g = clayBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [g.id("clay")]);
  assert.deepEqual(statsOf(g, "ally"), [2, 2]);
});

clause(CLAY, "1:rule", "it is 'this turn': the bonus is gone when the next turn starts", () => {
  const g = clayBoard();
  clayAttack(g);
  assert.deepEqual(statsOf(g, "ally"), [3, 3]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(statsOf(g, "ally"), [2, 2], "gone at the start of the opponent's turn");
});

clause(CLAY, "1:rule", "it is a one-time grant: a character that enters play after the attack does not get it", () => {
  const g = clayBoard({ extra: [{ key: "late", def: character({ name: "Latecomer", cost: 0, strength: 1, life: 1 }), owner: P1, zone: "hand" }] });
  clayAttack(g);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  playAndResolve(g.engine, P1, g.id("late"));
  assert.deepEqual(statsOf(g, "late"), [1, 1]);
  assert.deepEqual(statsOf(g, "ally"), [3, 3]);
});

clause(CLAY, "1:rule", "the strength bonus is real in battle: Claywork and a 2-strength ally hit the faction for 6 + 3 = 9", () => {
  const g = clayBoard();
  fightThrough(g.engine, P1, [g.id("clay"), g.id("ally")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(g.engine, P2), 21);
});

clause(CLAY, "1:rule", "the life bonus is real in battle: a 2-life ally attacking with Claywork survives 2 damage from a blocker", () => {
  const g = clayBoard({ extra: [{ key: "guard", def: character({ name: "Guard", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("clay"), g.id("ally")]);
  declareBlockers(g.engine, P2, [g.id("guard")]);
  finishBattle(g.engine, (source) => (source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(zoneOf(g.engine, g.id("ally")), "play", "2 life + 1 survives a blocker's 2 damage");
});

clause(CLAY, "1:rule", "the bonus applies even when the attack is blocked: Claywork's allies still get it", () => {
  const g = clayBoard();
  clayAttack(g);
  declareBlockers(g.engine, P2, [g.id("foe")]);
  assert.deepEqual(statsOf(g, "ally"), [3, 3]);
});

clause(CLAY, "1:rule", "a restored Claywork that attacks a second time gives another +1 / +1", () => {
  const g = clayBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  clayAttack(g);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.deepEqual(statsOf(g, "ally"), [3, 3]);
  playAndResolve(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("clay")] } });
  clayAttack(g);
  assert.deepEqual(statsOf(g, "ally"), [4, 4]);
});

clause(CLAY, "1:rule", "another Cantankerous Claywork is 'another character' too: it gains 1 strength and 1 life when the first attacks", () => {
  const g = clayBoard({ extra: [{ key: "clay2", def: printing(CLAY), owner: P1, zone: "play" }] });
  clayAttack(g);
  assert.deepEqual(statsOf(g, "clay2"), [7, 6]);
  assert.deepEqual(statsOf(g, "clay"), [6, 5], "and the attacker itself gains nothing");
});

clause(CLAY, "1:rule", "a face-down Claywork has no rules text: it cannot attack, so it gives nothing", () => {
  const g = clayBoard({ clay: { faceDown: true } });
  refused(() => clayAttack(g), "a face-down card cannot attack");
  assert.deepEqual(statsOf(g, "ally"), [2, 2]);
});

// =============================================================================
// Clay Node
// When this card enters play, you may search your deck for a "node" card and
// reveal it. If you do, put it into your hand.
// If this card leaves play, destroy all other "node" cards.
// DISSOLVE -- COST: Pay 2. EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 1 [E][E][E]
// Character (node), gearsmith, cost 2, [E][E][E]; 2 strength / 3 speed / 1 life.
// =============================================================================

const NODE = "3a8414ae-466f-48ea-b429-7b562830015b";

/** A character with the "node" subtype. */
const nodeChar = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, subtype: ["node"], ...over });

function nodeBoard(
  o: {
    node?: Partial<CardPlacement>;
    elitism?: number;
    greed?: number;
    spentElitism?: number;
    active?: PlayerId;
    deck?: boolean;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0.1,
    cards: [
      { key: "cn", def: printing(NODE), owner: P1, zone: "hand", ...o.node },
      ...(o.deck === false
        ? []
        : [
            { key: "n1", def: nodeChar("Node One"), owner: P1, zone: "deck" as const },
            { key: "d1", def: character({ name: "Deck One" }), owner: P1, zone: "deck" as const },
            { key: "n2", def: item({ name: "Node Two", subtype: ["node"] }), owner: P1, zone: "deck" as const },
            { key: "d2", def: character({ name: "Deck Two" }), owner: P1, zone: "deck" as const },
            { key: "d3", def: character({ name: "Deck Three" }), owner: P1, zone: "deck" as const }
          ]),
      ...res({ elitism: o.elitism ?? 3, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ]
  });
}

/** The Clay Node (hand) is deployed and its enters-play trigger is left pending. */
function deployNode(g: Game): void {
  playRaw(g.engine, P1, g.id("cn"));
  resolvePendingResponses(g.engine);
}

const searchPick = (g: Game, keys: string[]): void => answerPending(g.engine, "selectTargets", { selected: { found: keys.map((k) => g.id(k)) } });

/** True if some logged event revealed card `cardId`. */
const wasRevealed = (g: Game, cardId: CardInstanceId): boolean =>
  g.engine.getLog().some((entry) => entry.event?.type === "cardsRevealed" && (entry.event as unknown as { cardIds: string[] }).cardIds.includes(cardId));

// --- stats and deploying

clause(NODE, "0:rule", "it deploys for exactly its printed cost of 2 with [E][E][E], and is a node character with 2 strength / 3 speed / 1 life", () => {
  const g = nodeBoard({ elitism: 4 });
  const before = ready(g.engine);
  deployNode(g);
  searchPick(g, []);
  assert.equal(zoneOf(g.engine, g.id("cn")), "play");
  assert.equal(before - ready(g.engine), 2, "paid exactly 2");
  assert.deepEqual(g.engine.getCardTypes(g.id("cn")), ["character"]);
  assert.equal(g.engine.getStat(g.id("cn"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("cn"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("cn"), "life"), 1);
  assert.deepEqual(g.engine.getSubtypes(g.id("cn")), ["node"]);
});

clause(NODE, "0:rule", "it is refused one resource short (1 resource) and without [E][E][E] (2 Elitism + 3 Greed), and nothing is paid", () => {
  // [E][E][E] met by already-spent Elitism, so only the cost (1 ready of 2) can refuse
  const short = nodeBoard({ elitism: 0, greed: 1, spentElitism: 3 });
  refused(() => playRaw(short.engine, P1, short.id("cn")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("cn")), "hand");
  assert.equal(ready(short.engine), 1);
  const noThreshold = nodeBoard({ elitism: 2, greed: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("cn")), "only two [E]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("cn")), "hand");
  assert.equal(ready(noThreshold.engine), 5);
});

// --- 0:rule — When this card enters play, you may search your deck for a "node" card and reveal it. If you do, put it into your hand.

clause(NODE, "0:rule", "when it enters play I may search my deck: I am asked, and picking a node card puts exactly that card into my hand", () => {
  const g = nodeBoard();
  deployNode(g);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
  searchPick(g, ["n1"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), [g.id("n1")]);
  assert.equal(zoneOf(g.engine, g.id("n1")), "hand");
  assert.equal(deckOf(g.engine, P1).length, 4, "only the found card left the deck");
});

clause(NODE, "0:rule", "the search can find any 'node' card, not only characters: a node item in my deck can be found", () => {
  const g = nodeBoard();
  deployNode(g);
  searchPick(g, ["n2"]);
  assert.deepEqual(handOf(g.engine, P1), [g.id("n2")]);
});

clause(NODE, "0:rule", "the found card is revealed", () => {
  const g = nodeBoard();
  deployNode(g);
  searchPick(g, ["n1"]);
  assert.equal(wasRevealed(g, g.id("n1")), true);
});

clause(NODE, "0:rule", "the deck is shuffled afterwards (CR 312.1)", () => {
  const g = nodeBoard();
  const rest = deckOf(g.engine, P1).filter((id) => id !== g.id("n1"));
  deployNode(g);
  searchPick(g, ["n1"]);
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), [...rest].sort(), "the same four cards");
  assert.notDeepEqual(after, rest, "in a different order (seeded shuffle)");
});

clause(NODE, "0:rule", "it is a 'may': I can choose not to find a card even though nodes are in the deck, and nothing goes to my hand", () => {
  const g = nodeBoard();
  deployNode(g);
  searchPick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), []);
  assert.equal(deckOf(g.engine, P1).length, 5);
  assert.equal(zoneOf(g.engine, g.id("cn")), "play", "the Clay Node itself is still deployed");
});

clause(NODE, "0:rule", "a 'may search' I decline is no search at all: my deck is not shuffled", () => {
  const g = nodeBoard();
  const order = deckOf(g.engine, P1);
  deployNode(g);
  // declining the "may search" (Q2): the empty pick plus the decline marker for the search's declaration
  answerPending(g.engine, "selectTargets", { selected: { found: [], "__declined:found": [] } });
  assert.deepEqual(deckOf(g.engine, P1), order, "no search happened, so nothing is shuffled");
});

clause(NODE, "0:rule", "a search that finds nothing because the deck has no node still shuffles the deck (CR 312.1)", () => {
  const g = nodeBoard({ deck: false, extra: [...fillers("deck", 5, P1, "deck")] });
  const order = deckOf(g.engine, P1);
  deployNode(g);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), []);
  assert.notDeepEqual(deckOf(g.engine, P1), order, "the deck was searched, so it is shuffled");
});

clause(NODE, "0:rule", "exactly one card is found: picking two nodes is refused", () => {
  const g = nodeBoard({ extra: [{ key: "n3", def: nodeChar("Node Three"), owner: P1, zone: "deck" }] });
  deployNode(g);
  refused(() => searchPick(g, ["n1", "n3"]), "two cards for 'a node card'");
  assert.deepEqual(handOf(g.engine, P1), []);
});

for (const [key, label] of [
  ["plain", "a card in my deck that is not a node"],
  ["theirNode", "a node card in the OPPONENT's deck"],
  ["handNode", "a node card in my hand"],
  ["discardNode", "a node card in my discard pile"],
  ["playNode", "a node card already in play"]
] as const) {
  clause(NODE, "0:rule", `the search cannot find ${label}; a node in my deck can be found on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "plain", def: character({ name: "Plain Deck Card" }), owner: P1, zone: "deck" },
      { key: "theirNode", def: nodeChar("Their Node"), owner: P2, zone: "deck" },
      { key: "handNode", def: nodeChar("Hand Node"), owner: P1, zone: "hand" },
      { key: "discardNode", def: nodeChar("Discard Node"), owner: P1, zone: "discard" },
      { key: "playNode", def: nodeChar("Play Node"), owner: P1, zone: "play" }
    ];
    const bad = nodeBoard({ extra });
    deployNode(bad);
    refused(() => searchPick(bad, [key]), `finding ${label}`);
    const good = nodeBoard({ extra });
    deployNode(good);
    searchPick(good, ["n1"]);
    assert.equal(zoneOf(good.engine, good.id("n1")), "hand", "control");
  });
}

clause(NODE, "0:rule", "another Clay Node in my deck is a 'node' card and can be found", () => {
  const g = nodeBoard({ extra: [{ key: "cn2", def: printing(NODE), owner: P1, zone: "deck" }] });
  deployNode(g);
  searchPick(g, ["cn2"]);
  assert.equal(zoneOf(g.engine, g.id("cn2")), "hand");
});

clause(NODE, "0:rule", "it also triggers when the Clay Node is put into play by an effect (not deployed)", () => {
  const g = nodeBoard({ extra: [{ key: "put", def: putTactic(), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("put"), { selected: { t: [g.id("cn")] } });
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "selectTargets");
  searchPick(g, ["n1"]);
  assert.equal(zoneOf(g.engine, g.id("n1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("cn")), "play");
});

clause(NODE, "0:rule", "it is THIS card entering play: another node entering play while a Clay Node is in play gives no search", () => {
  const g = nodeBoard({
    node: { zone: "play" },
    extra: [{ key: "put", def: putTactic(), owner: P1, zone: "hand" }, { key: "other", def: nodeChar("Other Node"), owner: P1, zone: "hand" }]
  });
  playRaw(g.engine, P1, g.id("put"), { selected: { t: [g.id("other")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("other")), "play", "setup: another node entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(NODE, "0:rule", "no search when it LEAVES play", () => {
  const g = nodeBoard({ node: { zone: "play" }, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("cn")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), []);
});

// --- 1:rule — If this card leaves play, destroy all other "node" cards.

const collapseBoard = (o: { cn?: Partial<CardPlacement>; extra?: CardPlacement[]; active?: PlayerId } = {}) =>
  nodeBoard({
    node: { zone: "play", ...o.cn },
    deck: false,
    active: o.active,
    extra: [
      { key: "n1", def: nodeChar("Node One"), owner: P1, zone: "play" },
      { key: "nItem", def: item({ name: "Node Item", subtype: ["node"] }), owner: P2, zone: "play" },
      { key: "nLoc", def: location({ name: "Node Location", subtype: ["node"] }), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("Their Node"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "plainItem", def: item({ name: "Plain Item" }), owner: P2, zone: "play" },
      { key: "fdNode", def: nodeChar("Hidden Node"), owner: P1, zone: "play", faceDown: true },
      { key: "handNode", def: nodeChar("Hand Node"), owner: P1, zone: "hand" },
      { key: "deckNode", def: nodeChar("Deck Node"), owner: P1, zone: "deck" },
      { key: "discardNode", def: nodeChar("Discard Node"), owner: P1, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" },
      { key: "remove", def: removerTactic(), owner: P1, zone: "hand" },
      { key: "undeck", def: moverTactic("deck"), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });

/** Every other node card in play and face-up is destroyed; nothing else is touched. */
function expectCollapse(g: Game): void {
  for (const key of ["n1", "nItem", "nLoc", "theirNode"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} is destroyed`);
  assert.equal(zoneOf(g.engine, g.id("plain")), "play", "a non-node character survives");
  assert.equal(zoneOf(g.engine, g.id("plainItem")), "play", "a non-node item survives");
  assert.equal(zoneOf(g.engine, g.id("fdNode")), "play", "a face-down 'node' is only a resource (CR 411.1)");
  assert.equal(isFaceDown(g.engine, g.id("fdNode")), true);
  assert.equal(zoneOf(g.engine, g.id("handNode")), "hand", "a node in my hand is not in play");
  assert.equal(zoneOf(g.engine, g.id("deckNode")), "deck");
  assert.equal(zoneOf(g.engine, g.id("discardNode")), "discard");
}

clause(NODE, "1:rule", "when it is destroyed, every other face-up node card in play is destroyed: mine, the opponent's, characters, items and locations", () => {
  const g = collapseBoard();
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "discard");
  expectCollapse(g);
  assert.ok(discardOf(g.engine, P1).includes(g.id("n1")), "destroyed means to its owner's discard pile");
  assert.ok(discardOf(g.engine, P2).includes(g.id("theirNode")), "discardOf(g.engine, P2).includes(g.id(\"theirNode\"))");
});

clause(NODE, "1:rule", "when it is returned to its owner's hand it still 'leaves play': the other nodes are destroyed", () => {
  const g = collapseBoard();
  playAndResolve(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "hand");
  expectCollapse(g);
});

clause(NODE, "1:rule", "when it is removed from the game the other nodes are destroyed", () => {
  const g = collapseBoard();
  playAndResolve(g.engine, P1, g.id("remove"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "removed");
  expectCollapse(g);
});

clause(NODE, "1:rule", "when it is put back into its owner's deck the other nodes are destroyed", () => {
  const g = collapseBoard();
  playAndResolve(g.engine, P1, g.id("undeck"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "deck");
  expectCollapse(g);
});

clause(NODE, "1:rule", "when it dies in battle (1 life) the other nodes are destroyed", () => {
  const g = collapseBoard({ active: P2, extra: [{ key: "hitter", def: character({ name: "Hitter", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("hitter")]);
  declareBlockers(g.engine, P1, [g.id("cn")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("cn")), "discard");
  expectCollapse(g);
});

clause(NODE, "1:rule", "when it dies to non-battle damage the other nodes are destroyed", () => {
  const g = collapseBoard({ extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("zap"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "discard");
  expectCollapse(g);
});

clause(NODE, "1:rule", "control: while the Clay Node stays in play the other nodes are untouched", () => {
  const g = collapseBoard();
  for (const key of ["n1", "nItem", "nLoc", "theirNode"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", key);
});

clause(NODE, "1:rule", "it only destroys OTHER nodes when IT leaves: another node dying does not destroy the Clay Node or the rest", () => {
  const g = collapseBoard();
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("n1")] } });
  assert.equal(zoneOf(g.engine, g.id("n1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("cn")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirNode")), "play");
  assert.equal(zoneOf(g.engine, g.id("nItem")), "play");
});

clause(NODE, "1:rule", "a Clay Node is a node too: when one of two Clay Nodes leaves, the other is destroyed", () => {
  const g = collapseBoard({ extra: [{ key: "cn2", def: printing(NODE), owner: P2, zone: "play" }] });
  playAndResolve(g.engine, P1, g.id("kill"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "discard");
  assert.equal(zoneOf(g.engine, g.id("cn2")), "discard");
  expectCollapse(g);
});

clause(NODE, "1:rule", "a face-down Clay Node leaving play does nothing (it is only a resource, CR 411.1)", () => {
  const g = collapseBoard({ cn: { faceDown: true } });
  playAndResolve(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("cn")] } });
  assert.equal(zoneOf(g.engine, g.id("cn")), "hand");
  for (const key of ["n1", "nItem", "nLoc", "theirNode"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

// --- 2:ability:dissolve

const dissolveBoard = (o: { elitism?: number; greed?: number; extra?: CardPlacement[]; node?: Partial<CardPlacement>; active?: PlayerId } = {}) =>
  nodeBoard({
    node: { zone: "play", ...o.node },
    elitism: o.elitism ?? 2,
    greed: o.greed ?? 0,
    deck: false,
    active: o.active,
    extra: o.extra
  });

clause(NODE, "2:ability:dissolve", "DISSOLVE pays exactly 2 and flips the Clay Node face-down in play as a resource", () => {
  const g = dissolveBoard({ elitism: 3 });
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("cn"), "dissolve");
  assert.equal(before - ready(g.engine), 2, "paid exactly 2 as the ability is used");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("cn")), "play");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("cn")), ["resource"]);
  assert.equal(g.engine.isResource(g.id("cn")), true);
});

clause(NODE, "2:ability:dissolve", "DISSOLVE has no threshold: any two resources pay (Greed)", () => {
  const g = dissolveBoard({ elitism: 0, greed: 2 });
  activate(g.engine, P1, g.id("cn"), "dissolve");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
});

clause(NODE, "2:ability:dissolve", "DISSOLVE is refused with only 1 ready resource, and nothing is paid or flipped", () => {
  const g = dissolveBoard({ elitism: 1 });
  refused(() => actRaw(g.engine, P1, g.id("cn"), "dissolve"), "one resource short");
  assert.equal(isFaceDown(g.engine, g.id("cn")), false);
  assert.equal(ready(g.engine), 1);
});

clause(NODE, "2:ability:dissolve", "spent resources cannot pay DISSOLVE", () => {
  const g = dissolveBoard({ elitism: 0, extra: spent("greed", 3) });
  assert.equal(ready(g.engine), 0);
  refused(() => actRaw(g.engine, P1, g.id("cn"), "dissolve"), "no ready resource");
  assert.equal(isFaceDown(g.engine, g.id("cn")), false);
});

clause(NODE, "2:ability:dissolve", "the flipped Clay Node is a ready face-down resource providing Volition and no node, no type, no stats (a new card, CR 411.4)", () => {
  const g = dissolveBoard({ elitism: 3, node: { damage: 0 } });
  const volitionBefore = g.engine.getThresholds(P1).volition ?? 0;
  activate(g.engine, P1, g.id("cn"), "dissolve");
  assert.equal(g.engine.state.cards[g.id("cn")].attachedTo, undefined, "not spent");
  assert.equal(isDepleted(g.engine, g.id("cn")), false);
  assert.equal((g.engine.getThresholds(P1).volition ?? 0) - volitionBefore, 1);
});

clause(NODE, "2:ability:dissolve", "'under its owner's control': a Clay Node I own but the opponent controls ends up face-down under MY control", () => {
  const g = dissolveBoard({ elitism: 0, greed: 0, node: { controller: P2 }, extra: res({ elitism: 3 }, P2), active: P2 });
  assert.equal(controllerOf(g.engine, g.id("cn")), P2, "setup: they control my Clay Node");
  activate(g.engine, P2, g.id("cn"), "dissolve");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(controllerOf(g.engine, g.id("cn")), P1, "back under its owner's control");
  assert.ok(playOf(g.engine, P1).includes(g.id("cn")), "playOf(g.engine, P1).includes(g.id(\"cn\"))");
  assert.ok(!playOf(g.engine, P2).includes(g.id("cn")), "!playOf(g.engine, P2).includes(g.id(\"cn\"))");
});

clause(NODE, "2:ability:dissolve", "flipping it face-down means it left play: the other face-up nodes are destroyed (CR 411.4, 'if this card leaves play')", () => {
  const g = nodeBoard({
    node: { zone: "play" },
    elitism: 3,
    deck: false,
    extra: [
      { key: "n1", def: nodeChar("Node One"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("Their Node"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "fdNode", def: nodeChar("Hidden Node"), owner: P1, zone: "play", faceDown: true }
    ]
  });
  activate(g.engine, P1, g.id("cn"), "dissolve");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(zoneOf(g.engine, g.id("n1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirNode")), "discard");
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  assert.equal(zoneOf(g.engine, g.id("fdNode")), "play");
});

clause(NODE, "2:ability:dissolve", "DISSOLVE can be used in response on the opponent's turn: a Clay Node that is blocking is removed from the battle (CR 208.4)", () => {
  const g = nodeBoard({
    node: { zone: "play" },
    elitism: 2,
    deck: false,
    active: P2,
    extra: [{ key: "hitter", def: character({ name: "Hitter", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(g.engine, P2, [g.id("hitter")]);
  declareBlockers(g.engine, P1, [g.id("cn")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("cn")], "setup: it blocks");
  g.engine.perform({ type: "passPriority", playerId: P2 });
  actRaw(g.engine, P1, g.id("cn"), "dissolve");
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.deepEqual(battleOf(g.engine)?.blockingParty ?? [], [], "it is no longer blocking");
});

clause(NODE, "2:ability:dissolve", "a face-down Clay Node has no abilities: DISSOLVE cannot be used", () => {
  const g = dissolveBoard({ node: { faceDown: true } });
  refused(() => actRaw(g.engine, P1, g.id("cn"), "dissolve"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// --- 3:flipUp — FLIP UP: 1 [E][E][E]

function flipNodeBoard(o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; extra?: CardPlacement[]; deck?: boolean } = {}) {
  return nodeBoard({
    node: { zone: "play", faceDown: true },
    elitism: o.elitism ?? 3,
    greed: o.greed ?? 0,
    spentElitism: o.spentElitism,
    active: o.active,
    deck: o.deck,
    extra: o.extra
  });
}

const flipNode = (g: Game, player: PlayerId = P1): void => flipUpRaw(g.engine, player, g.id("cn"));

clause(NODE, "3:flipUp", "a face-down Clay Node flips up into a face-up character with 2 strength / 3 speed / 1 life and the node subtype", () => {
  const g = flipNodeBoard();
  assert.deepEqual(g.engine.getCardTypes(g.id("cn")), ["resource"]);
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("cn")), "play");
  assert.equal(isFaceDown(g.engine, g.id("cn")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("cn")), ["character"]);
  assert.equal(g.engine.getStat(g.id("cn"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("cn"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("cn"), "life"), 1);
  assert.deepEqual(g.engine.getSubtypes(g.id("cn")), ["node"]);
});

clause(NODE, "3:flipUp", "flipping up pays exactly 1 (not its cost of 2)", () => {
  const g = flipNodeBoard({ elitism: 3, greed: 2 });
  const before = ready(g.engine);
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(before - ready(g.engine), 1 + 1, "1 paid, and the flipped card itself is no longer a resource");
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(NODE, "3:flipUp", "the Clay Node may pay for its own FLIP UP (CR 507.4b): three spent [E] and only the face-down card ready is enough", () => {
  const g = flipNodeBoard({ elitism: 0, spentElitism: 3 });
  assert.equal(ready(g.engine), 1, "setup: only the face-down Clay Node is ready");
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(isFaceDown(g.engine, g.id("cn")), false);
});

clause(NODE, "3:flipUp", "FLIP UP needs [E][E][E]: two [E] and plenty of Greed is refused, and nothing is paid", () => {
  const g = flipNodeBoard({ elitism: 2, greed: 3 });
  refused(() => flipNode(g), "only two [E]");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(ready(g.engine), 6);
});

clause(NODE, "3:flipUp", "FLIP UP is refused with no resource to pay even with [E][E][E] met by spent resources", () => {
  const g = flipNodeBoard({ elitism: 0, spentElitism: 3 });
  g.engine.state.cards[g.id("cn")].attachedTo = factionOf(g.engine, P1);
  assert.equal(ready(g.engine), 0);
  assert.equal(elitism(g.engine), 3);
  refused(() => flipNode(g), "nothing ready to pay 1");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
});

clause(NODE, "3:flipUp", "Volition and the opponent's [E] do not meet [E][E][E]", () => {
  const vol = flipNodeBoard({ elitism: 0, greed: 0, extra: volition(4, P1) });
  refused(() => flipNode(vol), "Volition is not [E]");
  const theirs = flipNodeBoard({ elitism: 1, greed: 4, extra: res({ elitism: 5 }, P2) });
  refused(() => flipNode(theirs), "the opponent's [E] does not count");
  assert.equal(isFaceDown(theirs.engine, theirs.id("cn")), true);
});

clause(NODE, "3:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn", () => {
  const g = flipNodeBoard({ active: P2 });
  refused(() => flipNode(g), "on the opponent's turn");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(ready(g.engine), 4);
  const mine = flipNodeBoard();
  flipNode(mine);
  resolvePendingResponses(mine.engine);
  if (pending(mine.engine)) searchPick(mine, []);
  assert.equal(isFaceDown(mine.engine, mine.id("cn")), false, "control: on my own turn it flips up");
});

clause(NODE, "3:flipUp", "FLIP UP does not change WHEN a character can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => {
  const g = flipNodeBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  refused(() => flipNode(g), "a character is not a tactic: FLIP UP does not let it be deployed in response (CR 507.4d)");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(ready(g.engine), 4, "nothing was paid");
});

clause(NODE, "3:flipUp", "the flipped-up Clay Node is a new arrival: it cannot attack the turn it flipped", () => {
  const g = flipNodeBoard();
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  refused(() => declareAttackBy(g.engine, P1, [g.id("cn")]), "a card that just flipped up is a new arrival and cannot attack (CR 411.3, 204.3)", /did not start the turn in play/);
});

clause(NODE, "3:flipUp", "a flipped-up Clay Node 'enters play' (CR 411.3): its search happens, and the found node goes to my hand", () => {
  const g = flipNodeBoard();
  flipNode(g);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
  searchPick(g, ["n1"]);
  assert.equal(zoneOf(g.engine, g.id("n1")), "hand");
});

clause(NODE, "3:flipUp", "a face-down card that flips UP did not 'leave play' as a Clay Node: the other face-up nodes survive", () => {
  const g = flipNodeBoard({
    extra: [
      { key: "other", def: nodeChar("Other Node"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("Their Node"), owner: P2, zone: "play" }
    ]
  });
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirNode")), "play");
});

clause(NODE, "3:flipUp", "only a face-down Clay Node I control in play can be flipped up (not face-up, not in hand, not the opponent's)", () => {
  const faceUp = nodeBoard({ node: { zone: "play" } });
  refused(() => flipNode(faceUp), "already face-up");
  const inHand = nodeBoard({ node: { zone: "hand" } });
  refused(() => flipNode(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("cn")), "hand");
  const theirs = flipNodeBoard();
  refused(() => flipNode(theirs, P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("cn")), true);
});

clause(NODE, "3:flipUp", "FLIP UP is an alternative: deployed from the hand the Clay Node costs its printed 2 with [E][E][E]", () => {
  const g = nodeBoard({ elitism: 3 });
  const before = ready(g.engine);
  deployNode(g);
  searchPick(g, []);
  assert.equal(before - ready(g.engine), 2);
  const short = nodeBoard({ elitism: 0, greed: 1, spentElitism: 3 });
  refused(() => playRaw(short.engine, P1, short.id("cn")), "one short of the printed cost (threshold met by spent icons)", /Costs cannot be paid/);
});

// =============================================================================
// Cock Block
// COST: Play this only in response to an ability.
// EFFECT: Terminate the ability. Put this card into play under its owner's
// control as a face-down resource instead of into its owner's discard pile.
// FLIP UP: 4 [E] and discard a card.
// Tactic, gearsmith, cost 3, [E].
// =============================================================================

const BLOCK = "979512b2-3b58-489f-96c9-e7b0ae051cbb";

/** A P2 character with a "Pay 1 + deplete this card: draw 1" ability (`cost`). */
const costlyDrawer = (): CardPlacement => ({
  key: "costly",
  def: character({
    name: "Costly Drawer",
    behavior: { abilities: [{ id: "cost", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  }),
  owner: P2,
  zone: "play"
});

function blockBoard(
  o: {
    elitism?: number;
    greed?: number;
    hand?: number;
    cb?: Partial<CardPlacement>;
    active?: PlayerId;
    extra?: CardPlacement[];
    faction2?: CardDefinition;
    theirElitism?: number;
  } = {}
) {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: o.faction2 ?? developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "cb", def: printing(BLOCK), owner: P1, zone: "hand", ...o.cb },
      { key: "drawer", def: drawerChar(), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "My Character", life: 5 }), owner: P1, zone: "play" },
      ...fillers("p2deck", 3, P2, "deck"),
      ...fillers("hand", o.hand ?? 2, P1, "hand"),
      ...res({ elitism: o.elitism ?? 1, greed: o.greed ?? 5 }),
      ...res({ elitism: o.theirElitism ?? 3 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

/** The opponent (P2) uses ability `ability` of the card at `key`, leaving my response window open. */
const theyUse = (g: Game, key: string, ability: string, selected: Record<string, string[]> = {}): void => {
  const mapped: Record<string, CardInstanceId[]> = {};
  for (const [decl, keys] of Object.entries(selected)) mapped[decl] = keys.map((k) => g.id(k));
  actRaw(g.engine, P2, g.id(key), ability, mapped);
};

/** I play Cock Block (raw) in the open window. */
const blockIt = (g: Game): void => playRaw(g.engine, P1, g.id("cb"));

clause(BLOCK, "0:ability", "in response to an opponent's ability it is played for exactly its printed cost of 3, paid as it is played", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  const before = ready(g.engine);
  blockIt(g);
  assert.equal(before - ready(g.engine), 3);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(BLOCK, "0:ability", "it is refused one resource short (2 resources) and without [E] (3 Greed), and nothing is paid", () => {
  const short = blockBoard({ elitism: 1, greed: 1 });
  theyUse(short, "drawer", "draw1");
  refused(() => blockIt(short), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("cb")), "hand");
  assert.equal(ready(short.engine), 2);
  const noThreshold = blockBoard({ elitism: 0, greed: 3 });
  theyUse(noThreshold, "drawer", "draw1");
  refused(() => blockIt(noThreshold), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("cb")), "hand");
  assert.equal(ready(noThreshold.engine), 3);
});

clause(BLOCK, "0:ability", "EFFECT: Terminate the ability: the opponent's ability does not happen (their draw is cancelled)", () => {
  const g = blockBoard();
  const theirHand = handOf(g.engine, P2).length;
  theyUse(g, "drawer", "draw1");
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, theirHand, "no card was drawn");
  assert.equal(g.engine.state.responseWindow, undefined);
});

clause(BLOCK, "0:ability", "control: without Cock Block the same ability resolves", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 1);
});

clause(BLOCK, "0:ability", "the terminated ability's costs stay paid: the opponent's resource is spent and their source stays depleted", () => {
  const g = blockBoard({ extra: [costlyDrawer()] });
  const theirReady = ready(g.engine, P2);
  theyUse(g, "costly", "cost");
  assert.equal(ready(g.engine, P2), theirReady - 1);
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0, "no draw");
  assert.equal(ready(g.engine, P2), theirReady - 1, "the paid resource stays paid");
  assert.equal(isDepleted(g.engine, g.id("costly")), true, "and the source stays depleted");
});

clause(BLOCK, "0:ability", "an ability that targets my character is terminated: my character takes no damage", () => {
  const g = blockBoard({ extra: [pinger("pinger", P2)] });
  theyUse(g, "pinger", "ping", { t: ["mine"] });
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 0);
  const control = blockBoard({ extra: [pinger("pinger", P2)] });
  theyUse(control, "pinger", "ping", { t: ["mine"] });
  resolvePendingResponses(control.engine);
  assert.equal(damageOf(control.engine, control.id("mine")), 1, "control: unanswered it hits");
});

clause(BLOCK, "0:ability", "a faction's ability is an ability too: the opponent's faction ability can be terminated", () => {
  const f = developFaction();
  f.faction = { ...f.faction!, abilities: [{ id: "fdraw", name: "Faction Draw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] };
  const g = blockBoard({ faction2: f });
  actRaw(g.engine, P2, factionOf(g.engine, P2), "fdraw");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(BLOCK, "0:ability", "it terminates only the ability it answered: the opponent can use that ability again afterwards", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0);
  actRaw(g.engine, P2, g.id("drawer"), "draw1");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 1, "a later use works");
});

clause(BLOCK, "0:ability", "COST: Play this only in response to an ability: it cannot be played in response to a TACTIC", () => {
  const g = blockBoard({ extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "setup: I may respond to their tactic");
  refused(() => blockIt(g), "their tactic is not an ability", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(BLOCK, "0:ability", "it cannot be played in response to a creature DEPLOY or any other card being deployed", () => {
  const g = blockBoard({ extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("newbie"));
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => blockIt(g), "a deployed character is not an ability", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
});

clause(BLOCK, "0:ability", "it cannot be played with nothing to respond to (my own turn, no ability in play)", () => {
  const g = blockBoard({ active: P1 });
  refused(() => blockIt(g), "nothing to respond to");
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
  assert.equal(ready(g.engine), 6);
});

clause(BLOCK, "0:ability", "it cannot be played on the opponent's turn with no ability to respond to", () => {
  const g = blockBoard({ active: P2 });
  refused(() => blockIt(g), "nothing to respond to");
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
});

clause(BLOCK, "0:ability", "I cannot respond to MY OWN ability (CR 607.1): after I use an ability I cannot Cock Block it", () => {
  const g = blockBoard({ active: P1, extra: [drawer()] });
  actRaw(g.engine, P1, g.id("drawer"), "draw1");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2);
  refused(() => blockIt(g), "you cannot respond to your own action", /priority/);
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
});

clause(BLOCK, "0:ability", "in a chain it answers the ability on top: terminating their second ability leaves their first one to resolve", () => {
  const g = blockBoard({
    extra: [
      { key: "drawer2", def: drawerChar({ name: "Second Drawer" }), owner: P2, zone: "play" },
      { key: "mynoop", def: NOOP, owner: P1, zone: "hand" }
    ]
  });
  theyUse(g, "drawer", "draw1");
  playRaw(g.engine, P1, g.id("mynoop"));
  theyUse(g, "drawer2", "draw1");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 1, "their first ability resolved, their second was terminated");
});

clause(BLOCK, "0:ability", "terminating an item's cost-paying ability keeps the cost: Contrabulous Fabtraption stays destroyed and its effect does not happen", () => {
  const g = blockBoard({
    extra: [
      { key: "fab", def: printing(FAB), owner: P2, zone: "play" },
      { key: "theirs", def: character({ name: "Their Character", strength: 1, life: 1 }), owner: P2, zone: "play" }
    ]
  });
  theyUse(g, "fab", "rune-of-enhancement", { ch: ["theirs"] });
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard", "the cost destroyed it as the ability was used");
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard", "and it stays destroyed");
  assert.equal(g.engine.getStat(g.id("theirs"), "strength"), 1, "no +2 strength");
});

clause(BLOCK, "0:ability", "afterwards Cock Block is in play under its owner's control as a face-down resource, not in the discard pile", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("cb")), "play");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(controllerOf(g.engine, g.id("cb")), P1);
  assert.equal(g.engine.isResource(g.id("cb")), true);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("cb")), "!discardOf(g.engine, P1).includes(g.id(\"cb\"))");
});

clause(BLOCK, "0:ability", "the face-down Cock Block is a ready resource providing one Volition", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  const v = g.engine.getThresholds(P1).volition ?? 0;
  blockIt(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("cb")].attachedTo, undefined, "not spent");
  assert.equal((g.engine.getThresholds(P1).volition ?? 0) - v, 1);
  assert.equal(ready(g.engine), 6 - 3 + 1);
});

clause(BLOCK, "0:ability", "while it waits for responses Cock Block is being deployed, not yet a resource", () => {
  const g = blockBoard();
  theyUse(g, "drawer", "draw1");
  blockIt(g);
  assert.equal(zoneOf(g.engine, g.id("cb")), "deploying");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("cb")), "play");
});

// --- 1:flipUp — FLIP UP: 4 [E] and discard a card.

function flipBlockBoard(o: { elitism?: number; greed?: number; hand?: number; spentElitism?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return blockBoard({
    cb: { zone: "play", faceDown: true },
    elitism: o.elitism ?? 1,
    greed: o.greed ?? 5,
    hand: o.hand ?? 2,
    active: o.active,
    extra: [...spent("elitism", o.spentElitism ?? 0), ...(o.extra ?? [])]
  });
}

const flipBlock = (g: Game, player: PlayerId = P1): void => flipUpRaw(g.engine, player, g.id("cb"));

/** Answers the flip-up's "discard a card" prompt by discarding the card at placement key `key`, WITHOUT draining the window. */
const discardForFlip = (g: Game, key: string): void => {
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)] } } as never);
};

clause(BLOCK, "1:flipUp", "in response to an ability a face-down Cock Block flips up: it terminates that ability and ends as a face-down resource again", () => {
  const g = flipBlockBoard();
  const theirHand = handOf(g.engine, P2).length;
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  discardForFlip(g, "hand0");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P2).length, theirHand, "their ability was terminated");
  assert.equal(zoneOf(g.engine, g.id("cb")), "play");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true, "Cock Block puts itself back into play face-down");
});

clause(BLOCK, "1:flipUp", "FLIP UP pays 4 resources", () => {
  const g = flipBlockBoard();
  theyUse(g, "drawer", "draw1");
  const attachedBefore = attachedCount(g.engine, P1);
  flipBlock(g);
  discardForFlip(g, "hand0");
  assert.equal(attachedCount(g.engine, P1) - attachedBefore, 4, "4 resources were attached as the card was flipped up");
});

clause(BLOCK, "1:flipUp", "FLIP UP costs 4, not its printed 3 plus anything: 4 ready resources (counting the card itself) are exactly enough", () => {
  const g = flipBlockBoard({ elitism: 1, greed: 2 });
  assert.equal(ready(g.engine), 4, "setup: 3 resources and the face-down Cock Block");
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  discardForFlip(g, "hand0");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0, "it worked and terminated the ability");
});

clause(BLOCK, "1:flipUp", "FLIP UP needs [E]: with only Greed it is refused, and nothing is paid or discarded", () => {
  const g = flipBlockBoard({ elitism: 0, greed: 6 });
  theyUse(g, "drawer", "draw1");
  refused(() => flipBlock(g), "no [E]");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(ready(g.engine), 7);
});

clause(BLOCK, "1:flipUp", "FLIP UP is refused one resource short of its 4 even with [E] met (a spent [E], 3 ready resources and the card itself would be 4 - but only 3 ready)", () => {
  const g = flipBlockBoard({ elitism: 0, greed: 2, spentElitism: 1 });
  assert.equal(ready(g.engine), 3, "setup: 2 Greed and the face-down Cock Block itself");
  assert.equal(elitism(g.engine), 1, "setup: the threshold is met by the spent [E]");
  theyUse(g, "drawer", "draw1");
  refused(() => flipBlock(g), "3 ready resources for FLIP UP 4");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(BLOCK, "1:flipUp", "the card may pay for its own FLIP UP (CR 507.4b): 3 other ready resources and itself make exactly the 4", () => {
  const g = flipBlockBoard({ elitism: 0, greed: 3, spentElitism: 1 });
  assert.equal(ready(g.engine), 4);
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  discardForFlip(g, "hand0");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0, "the ability was terminated");
});

clause(BLOCK, "1:flipUp", "'and discard a card': I choose which card of my hand is discarded, and it is that one only", () => {
  const g = flipBlockBoard({ hand: 3 });
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  discardForFlip(g, "hand1");
  assert.deepEqual(discardOf(g.engine, P1), [g.id("hand1")]);
  assert.deepEqual(handOf(g.engine, P1).sort(), [g.id("hand0"), g.id("hand2")].sort());
});

clause(BLOCK, "1:flipUp", "the discard must be a card from my hand: a card in play, or in the opponent's hand, is refused", () => {
  const g = flipBlockBoard({ extra: [{ key: "theirHandCard", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }] });
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [g.id("mine")] } } as never),
    "a character in play"
  );
  const h = flipBlockBoard({ extra: [{ key: "theirHandCard", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }] });
  theyUse(h, "drawer", "draw1");
  flipBlock(h);
  const pc2 = expectPending(h.engine, "chooserSelectsTarget");
  refused(
    () => h.engine.perform({ type: "resolvePendingChoice", playerId: pc2.playerId, choice: { kind: "chooserSelectsTarget", selected: [h.id("theirHandCard")] } } as never),
    "a card in the opponent's hand"
  );
});

clause(BLOCK, "1:flipUp", "exactly one card is discarded: discarding two is refused", () => {
  const g = flipBlockBoard();
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [g.id("hand0"), g.id("hand1")] } } as never),
    "two cards"
  );
});

clause(BLOCK, "1:flipUp", "'and discard a card' is part of the cost: with an empty hand FLIP UP cannot be paid and is refused", () => {
  const g = flipBlockBoard({ hand: 0 });
  theyUse(g, "drawer", "draw1");
  refused(() => flipBlock(g), "no card to discard");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(ready(g.engine), 7, "nothing was paid");
});

clause(BLOCK, "1:flipUp", "the discard is made before the opponent can respond: once I have chosen, the card is already in my discard pile and their ability has not resolved yet", () => {
  const g = flipBlockBoard();
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  discardForFlip(g, "hand0");
  assert.ok(discardOf(g.engine, P1).includes(g.id("hand0")), "discardOf(g.engine, P1).includes(g.id(\"hand0\"))");
  assert.equal(handOf(g.engine, P2).length, 0, "their ability is still waiting");
});

clause(BLOCK, "1:flipUp", "a flipped-up Cock Block still must be played in response to an ability: with nothing to respond to FLIP UP is refused", () => {
  const g = flipBlockBoard({ active: P1 });
  refused(() => flipBlock(g), "nothing to respond to");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(ready(g.engine), 7, "nothing was paid");
});

clause(BLOCK, "1:flipUp", "a flipped-up Cock Block cannot be played in response to a tactic either", () => {
  const g = flipBlockBoard({ extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  refused(() => flipBlock(g), "a tactic is not an ability", /cannot be flipped up right now/);
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(BLOCK, "1:flipUp", "on the opponent's turn with no response window open FLIP UP is refused (there is nothing to respond to)", () => {
  const g = flipBlockBoard();
  refused(() => flipBlock(g), "no response window is open");
  assert.equal(isFaceDown(g.engine, g.id("cb")), true);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(BLOCK, "1:flipUp", "only a face-down Cock Block I control in play can be flipped up (not in hand, not the opponent's)", () => {
  const inHand = blockBoard();
  theyUse(inHand, "drawer", "draw1");
  refused(() => flipBlock(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("cb")), "hand");
  const theirs = flipBlockBoard();
  theyUse(theirs, "drawer", "draw1");
  refused(() => flipBlock(theirs, P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("cb")), true);
});

// =============================================================================
// Contrabulous Fabtraption
// RUNE OF ENHANCEMENT -- COST: Destroy this card. Pick a character. EFFECT: This
//   turn, the character gains 2 strength and 2 life.
// RUNE OF SUMMONING -- COST: Destroy this card. EFFECT: Put 2 Micromajig tokens
//   into play under your control.
// RUNE OF ANIMATION -- COST: Destroy this card. Pick an item. EFFECT: This turn,
//   the item is a golem character with strength and life equal to its numeric
//   cost and 3 speed.
// RUNE OF ACCELERATION -- COST: Destroy this card. EFFECT: Search your deck for a
//   card named Elitism and put it into play. If you do, at the end of the turn
//   destroy a card named Elitism you control.
// RUNE OF OVERCLOCKING -- COST: Destroy this card. Pick a Gearsmith card you
//   control. EFFECT: Put a token on the card.
// RUNE OF DESTRUCTION -- COST: Destroy this card. Pick an item. EFFECT: Remove the
//   item from the game.
// Item, gearsmith, cost 2, [E][E][E].
// =============================================================================

function fabBoard(
  o: { fab?: Partial<CardPlacement>; active?: PlayerId; extra?: CardPlacement[]; elitism?: number; random?: () => number; deck?: CardPlacement[] } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: o.random ?? (() => 0.1),
    cards: [
      { key: "fab", def: printing(FAB), owner: P1, zone: "play", ...o.fab },
      { key: "ch", def: character({ name: "Target Character", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 0 }),
      ...(o.deck ?? []),
      ...(o.extra ?? [])
    ]
  });
}

/** Uses rune `ability` of the Fabtraption (key "fab") with its picks (`decl` -> placement keys), raw. */
const rune = (g: Game, ability: string, picks: Record<string, string[]> = {}, player: PlayerId = P1): void => {
  const mapped: Record<string, CardInstanceId[]> = {};
  for (const [decl, keys] of Object.entries(picks)) mapped[decl] = keys.map((k) => g.id(k));
  actRaw(g.engine, player, g.id("fab"), ability, mapped);
};

/** Uses a rune and lets it resolve. */
const runeDone = (g: Game, ability: string, picks: Record<string, string[]> = {}, player: PlayerId = P1): void => {
  rune(g, ability, picks, player);
  resolvePendingResponses(g.engine);
};

// --- deploying (printed cost, threshold, type)

clause(FAB, "0:ability:rune-of-enhancement", "it deploys for exactly its printed cost of 2 with [E][E][E], and enters play as an item", () => {
  const g = devBoard([{ key: "f", def: printing(FAB), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]);
  const before = ready(g.engine);
  playAndResolve(g.engine, P1, g.id("f"));
  assert.equal(zoneOf(g.engine, g.id("f")), "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("f")), ["item"]);
  assert.equal(before - ready(g.engine), 2);
});

clause(FAB, "0:ability:rune-of-enhancement", "it is refused one resource short (1 resource) and without [E][E][E] (2 Elitism + 2 Greed), and nothing is paid", () => {
  // [E][E][E] met by already-spent Elitism, so only the cost (1 ready of 2) can refuse
  const short = devBoard([{ key: "f", def: printing(FAB), owner: P1, zone: "hand" }, ...bank("elitism", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...res({ greed: 1 })]);
  refused(() => playRaw(short.engine, P1, short.id("f")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("f")), "hand");
  const noThreshold = devBoard([{ key: "f", def: printing(FAB), owner: P1, zone: "hand" }, ...res({ elitism: 2, greed: 2 })]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("f")), "only two [E]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("f")), "hand");
  assert.equal(ready(noThreshold.engine), 4);
});

// --- RUNE OF ENHANCEMENT

clause(FAB, "0:ability:rune-of-enhancement", "COST: Destroy this card: the Fabtraption is in the discard pile as soon as the rune is used, before it resolves", () => {
  const g = fabBoard();
  rune(g, "rune-of-enhancement", { ch: ["ch"] });
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
  assert.equal(g.engine.getStat(g.id("ch"), "strength"), 2, "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("ch"), "strength"), 4);
});

clause(FAB, "0:ability:rune-of-enhancement", "the character gains exactly 2 strength and 2 life: 2/3 becomes 4/5, speed is unchanged", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-enhancement", { ch: ["ch"] });
  assert.equal(g.engine.getStat(g.id("ch"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("ch"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("ch"), "speed"), 2);
});

clause(FAB, "0:ability:rune-of-enhancement", "it can pick the opponent's character too", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-enhancement", { ch: ["foe"] });
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("foe"), "life"), 6);
});

clause(FAB, "0:ability:rune-of-enhancement", "only the picked character gains it: another character is unchanged", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-enhancement", { ch: ["ch"] });
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("foe"), "life"), 4);
});

clause(FAB, "0:ability:rune-of-enhancement", "'this turn': the bonus ends with the turn", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-enhancement", { ch: ["ch"] });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.getStat(g.id("ch"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ch"), "life"), 3);
});

clause(FAB, "0:ability:rune-of-enhancement", "the extra life is real: a 3-life character survives 4 damage with the bonus, and not without it", () => {
  const g = fabBoard({ extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  runeDone(g, "rune-of-enhancement", { ch: ["ch"] });
  playAndResolve(g.engine, P1, g.id("zap"), { selected: { t: [g.id("ch")] } });
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  const bare = fabBoard({ extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  playAndResolve(bare.engine, P1, bare.id("zap"), { selected: { t: [bare.id("ch")] } });
  assert.equal(zoneOf(bare.engine, bare.id("ch")), "discard");
});

clause(FAB, "0:ability:rune-of-enhancement", "two Fabtraptions on one character stack: +4 strength and +4 life", () => {
  const g = fabBoard({ extra: [{ key: "fab2", def: printing(FAB), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-enhancement", { ch: ["ch"] });
  activate(g.engine, P1, g.id("fab2"), "rune-of-enhancement", { selected: { ch: [g.id("ch")] } });
  assert.equal(g.engine.getStat(g.id("ch"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("ch"), "life"), 7);
});

clause(FAB, "0:ability:rune-of-enhancement", "exactly one character is picked: none and two are refused, and the Fabtraption is not destroyed", () => {
  const none = fabBoard();
  refused(() => rune(none, "rune-of-enhancement", {}), "no pick");
  assert.equal(zoneOf(none.engine, none.id("fab")), "play");
  const two = fabBoard();
  refused(() => rune(two, "rune-of-enhancement", { ch: ["ch", "foe"] }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("fab")), "play");
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdChar", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(FAB, "0:ability:rune-of-enhancement", `cannot pick ${label}; a character in play can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdChar", def: character({ name: "Face Down", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = fabBoard({ extra });
    refused(() => rune(bad, "rune-of-enhancement", { ch: [key] }), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("fab")), "play", "the cost was not paid");
    const good = fabBoard({ extra });
    runeDone(good, "rune-of-enhancement", { ch: ["ch"] });
    assert.equal(good.engine.getStat(good.id("ch"), "strength"), 4, "control");
  });
}

clause(FAB, "0:ability:rune-of-enhancement", "a faction cannot be picked (CR 202.9)", () => {
  const g = fabBoard();
  refused(() => actRaw(g.engine, P1, g.id("fab"), "rune-of-enhancement", { ch: [factionOf(g.engine, P1)] }), "picking my faction");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play");
});

clause(FAB, "0:ability:rune-of-enhancement", "used in response in the opponent's attack it pumps my blocker: a 1/1 blocker survives and kills a 2-strength attacker's equal", () => {
  const g = fabBoard({
    active: P2,
    extra: [{ key: "small", def: character({ name: "Small", strength: 1, life: 1, speed: 2 }), owner: P1, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  rune(g, "rune-of-enhancement", { ch: ["small"] });
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("small")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("small")), "play", "life 1 + 2 survives the attacker's 2");
  assert.equal(damageOf(g.engine, g.id("small")), 2);
  assert.equal(damageOf(g.engine, g.id("foe")), 3, "and it dealt 1 + 2 strength");
});

clause(FAB, "0:ability:rune-of-enhancement", "it only works while the Fabtraption is face-up in play: a face-down one has no rune", () => {
  const g = fabBoard({ fab: { faceDown: true } });
  refused(() => rune(g, "rune-of-enhancement", { ch: ["ch"] }), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
  const hand = fabBoard({ fab: { zone: "hand" } });
  refused(() => rune(hand, "rune-of-enhancement", { ch: ["ch"] }), "in hand");
  assert.equal(zoneOf(hand.engine, hand.id("fab")), "hand");
});

clause(FAB, "0:ability:rune-of-enhancement", "only its controller may use it: the opponent cannot use a Fabtraption I control", () => {
  const g = fabBoard({ active: P2 });
  refused(() => rune(g, "rune-of-enhancement", { ch: ["ch"] }, P2), "the opponent does not control it");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play");
});

// --- RUNE OF SUMMONING

clause(FAB, "1:ability:rune-of-summoning", "COST: Destroy this card: it is in the discard pile as soon as the rune is used", () => {
  const g = fabBoard();
  rune(g, "rune-of-summoning");
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
  assert.equal(micromajigs(g.engine).length, 0, "the tokens appear when it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(micromajigs(g.engine).length, 2);
});

clause(FAB, "1:ability:rune-of-summoning", "it puts exactly 2 Micromajig tokens into play under my control (not 1, not 3), none for the opponent", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-summoning");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const tokens = micromajigs(g.engine);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.equal(controllerOf(g.engine, token), P1);
    assert.equal(g.engine.state.cards[token].ownerId, P1);
  }
  assert.equal(micromajigs(g.engine, P2).length, 0);
});

clause(FAB, "1:ability:rune-of-summoning", "each Micromajig is a character with 1 strength, 1 life, 3 speed and the majig subtype (CR 409.3c.1)", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-summoning");
  for (const token of micromajigs(g.engine)) {
    assert.deepEqual(g.engine.getCardTypes(token), ["character"]);
    assert.equal(g.engine.getStat(token, "strength"), 1);
    assert.equal(g.engine.getStat(token, "life"), 1);
    assert.equal(g.engine.getStat(token, "speed"), 3);
    assert.deepEqual(g.engine.getSubtypes(token), ["majig"]);
  }
});

clause(FAB, "1:ability:rune-of-summoning", "the Micromajig tokens are Gearsmith characters (CR 409.3c.1), not universal ones", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-summoning");
  const tokens = micromajigs(g.engine);
  assert.equal(tokens.length, 2);
  for (const token of tokens) assert.equal(g.engine.getDefinition(token).trade, "gearsmith");
});

clause(FAB, "1:ability:rune-of-summoning", "the tokens are new arrivals: they cannot attack the turn they are made", () => {
  const g = fabBoard();
  runeDone(g, "rune-of-summoning");
  const [token] = micromajigs(g.engine);
  refused(() => declareAttackBy(g.engine, P1, [token]), "a token that just entered play cannot attack", /did not start the turn in play/);
});

clause(FAB, "1:ability:rune-of-summoning", "it is used in response on the opponent's turn: the tokens can block", () => {
  const g = fabBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  rune(g, "rune-of-summoning");
  resolvePendingResponses(g.engine);
  const tokens = micromajigs(g.engine);
  assert.equal(tokens.length, 2);
  declareBlockers(g.engine, P1, tokens);
  assert.equal(battleOf(g.engine)?.blockingParty?.length, 2);
});

clause(FAB, "1:ability:rune-of-summoning", "a face-down Fabtraption has no runes", () => {
  const g = fabBoard({ fab: { faceDown: true } });
  refused(() => rune(g, "rune-of-summoning"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
  assert.equal(micromajigs(g.engine).length, 0);
});

// --- RUNE OF ANIMATION

const gadget = (cost: number, key = "gadget", over: Partial<CardDefinition> = {}): CardPlacement => ({ key, def: item({ name: `Gadget ${cost}`, cost, subtype: ["gear"], ...over }), owner: P1, zone: "play" });

clause(FAB, "2:ability:rune-of-animation", "COST: Destroy this card. Pick an item: the Fabtraption is destroyed as the rune is used, before it resolves", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  rune(g, "rune-of-animation", { it: ["gadget"] });
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
  assert.equal(g.engine.hasCardType(g.id("gadget"), "character"), false, "not animated until it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.hasCardType(g.id("gadget"), "character"), true);
});

clause(FAB, "2:ability:rune-of-animation", "the item becomes a golem character: it is both an item and a character, and a golem as well as its own subtype", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  assert.ok(g.engine.hasCardType(g.id("gadget"), "character"), "g.engine.hasCardType(g.id(\"gadget\"), \"character\")");
  assert.ok(g.engine.hasCardType(g.id("gadget"), "item"), "it keeps its item type (CR 208.1a)");
  const subtypes = g.engine.getSubtypes(g.id("gadget"));
  assert.ok(subtypes.includes("golem"), `golem is among ${subtypes.join(",")}`);
  assert.ok(subtypes.includes("gear"), "and it keeps its own subtype");
});

clause(FAB, "2:ability:rune-of-animation", "its strength and life equal its numeric cost and its speed is 3: a cost-3 item is a 3/3/3, a cost-5 item a 5/5/3", () => {
  for (const cost of [3, 5]) {
    const g = fabBoard({ extra: [gadget(cost)] });
    runeDone(g, "rune-of-animation", { it: ["gadget"] });
    assert.equal(g.engine.getStat(g.id("gadget"), "strength"), cost, `cost ${cost} strength`);
    assert.equal(g.engine.getStat(g.id("gadget"), "life"), cost, `cost ${cost} life`);
    assert.equal(g.engine.getStat(g.id("gadget"), "speed"), 3);
  }
});

clause(FAB, "2:ability:rune-of-animation", "a cost-0 item becomes a 0/0/3 character: with 0 life it is destroyed at once (FAQ)", () => {
  const g = fabBoard({ extra: [gadget(0)] });
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  assert.equal(zoneOf(g.engine, g.id("gadget")), "discard");
});

clause(FAB, "2:ability:rune-of-animation", "an item with 1 cost becomes a 1/1/3 character that survives until damaged", () => {
  const g = fabBoard({ extra: [gadget(1)] });
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  assert.equal(g.engine.getStat(g.id("gadget"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("gadget"), "life"), 1);
  assert.equal(zoneOf(g.engine, g.id("gadget")), "play");
});

clause(FAB, "2:ability:rune-of-animation", "the animated item is a real character: lethal damage destroys it (3 damage on a cost-3 item)", () => {
  const g = fabBoard({ extra: [gadget(3), { key: "zap", def: damageTactic(3), owner: P1, zone: "hand" }] });
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  playAndResolve(g.engine, P1, g.id("zap"), { selected: { t: [g.id("gadget")] } });
  assert.equal(zoneOf(g.engine, g.id("gadget")), "discard");
  const survivor = fabBoard({ extra: [gadget(3), { key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  runeDone(survivor, "rune-of-animation", { it: ["gadget"] });
  playAndResolve(survivor.engine, P1, survivor.id("zap"), { selected: { t: [survivor.id("gadget")] } });
  assert.equal(zoneOf(survivor.engine, survivor.id("gadget")), "play", "2 damage on 3 life");
});

clause(FAB, "2:ability:rune-of-animation", "'this turn': when the turn is over the item is just an item again", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  endTurn(g.engine, P1);
  assert.equal(g.engine.hasCardType(g.id("gadget"), "character"), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("gadget")), ["item"]);
  assert.equal(g.engine.getSubtypes(g.id("gadget")).includes("golem"), false);
  assert.equal(zoneOf(g.engine, g.id("gadget")), "play");
});

clause(FAB, "2:ability:rune-of-animation", "it can pick the opponent's item too, and the animated item then fights for its controller", () => {
  const g = fabBoard({ extra: [{ key: "theirs", def: item({ name: "Their Gadget", cost: 2 }), owner: P2, zone: "play" }] });
  runeDone(g, "rune-of-animation", { it: ["theirs"] });
  assert.ok(g.engine.hasCardType(g.id("theirs"), "character"), "g.engine.hasCardType(g.id(\"theirs\"), \"character\")");
  assert.equal(controllerOf(g.engine, g.id("theirs")), P2, "control does not change");
  assert.equal(g.engine.getStat(g.id("theirs"), "strength"), 2);
});

for (const [key, label] of [
  ["chr", "a character"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdItem", "a face-down item (only a resource, CR 411.1)"],
  ["inHand", "an item card in my hand (CR 402.3)"],
  ["inDiscard", "an item card in my discard pile (CR 402.3)"]
] as const) {
  clause(FAB, "2:ability:rune-of-animation", `cannot pick ${label}; an item in play can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      gadget(3),
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdItem", def: item({ name: "Hidden Item", cost: 2 }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: item({ name: "Discard Item" }), owner: P1, zone: "discard" }
    ];
    const bad = fabBoard({ extra });
    refused(() => rune(bad, "rune-of-animation", { it: [key] }), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("fab")), "play", "the cost was not paid");
    const good = fabBoard({ extra });
    runeDone(good, "rune-of-animation", { it: ["gadget"] });
    assert.ok(good.engine.hasCardType(good.id("gadget"), "character"), "control");
  });
}

clause(FAB, "2:ability:rune-of-animation", "exactly one item is picked: none and two are refused", () => {
  const none = fabBoard({ extra: [gadget(3)] });
  refused(() => rune(none, "rune-of-animation", {}), "no pick");
  assert.equal(zoneOf(none.engine, none.id("fab")), "play");
  const two = fabBoard({ extra: [gadget(3), gadget(2, "gadget2")] });
  refused(() => rune(two, "rune-of-animation", { it: ["gadget", "gadget2"] }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("fab")), "play");
});

clause(FAB, "2:ability:rune-of-animation", "the costs are paid in printed order: 'Destroy this card' comes first, so the Fabtraption cannot pick ITSELF as the item", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  refused(() => rune(g, "rune-of-animation", { it: ["fab"] }), "the Fabtraption is already destroyed when the item is picked");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play", "nothing was paid");
  runeDone(g, "rune-of-animation", { it: ["gadget"] });
  assert.ok(g.engine.hasCardType(g.id("gadget"), "character"), "control");
});

clause(FAB, "2:ability:rune-of-animation", "a Fabtraption can animate ANOTHER Fabtraption", () => {
  const g = fabBoard({ extra: [{ key: "fab2", def: printing(FAB), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-animation", { it: ["fab2"] });
  assert.ok(g.engine.hasCardType(g.id("fab2"), "character"), "g.engine.hasCardType(g.id(\"fab2\"), \"character\")");
  assert.equal(g.engine.getStat(g.id("fab2"), "strength"), 2, "its numeric cost");
  assert.equal(g.engine.getStat(g.id("fab2"), "life"), 2);
});

clause(FAB, "2:ability:rune-of-animation", "an animated item is a character, so it can block: animated in response to an attack, it blocks the attacker", () => {
  const g = fabBoard({ active: P2, extra: [gadget(3)] });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  rune(g, "rune-of-animation", { it: ["gadget"] });
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("gadget")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("gadget")]);
  finishBattle(g.engine);
  assert.equal(damageOf(g.engine, g.id("foe")), 3, "the animated gadget hit for its cost, 3");
  assert.equal(damageOf(g.engine, g.id("gadget")), 2);
});

clause(FAB, "2:ability:rune-of-animation", "an item that was in play since before this turn started, and is a character this turn, may attack (CR 204.3 read literally)", () => {
  const g = devBoard([
    { key: "fab", def: printing(FAB), owner: P1, zone: "hand" },
    // cost 2, not 0: the animated item gets life = its numeric cost, and a 0-life character is destroyed at once (Q6)
    { key: "gadget", def: item({ name: "Early Gadget", cost: 2 }), owner: P1, zone: "hand" },
    ...res({ elitism: 4 })
  ]);
  playAndResolve(g.engine, P1, g.id("fab"));
  playAndResolve(g.engine, P1, g.id("gadget"));
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "setup: my next turn; both cards have been in play since before it started");
  activate(g.engine, P1, g.id("fab"), "rune-of-animation", { selected: { it: [g.id("gadget")] } });
  assert.ok(g.engine.hasCardType(g.id("gadget"), "character"), "setup: it is a character this turn");
  declareAttackBy(g.engine, P1, [g.id("gadget")]);
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("gadget")]);
});

clause(FAB, "2:ability:rune-of-animation", "a face-down Fabtraption has no runes", () => {
  const g = fabBoard({ fab: { faceDown: true }, extra: [gadget(3)] });
  refused(() => rune(g, "rune-of-animation", { it: ["gadget"] }), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// --- RUNE OF ACCELERATION

const elitismCardN = (): CardDefinition => elitismCard("Elitism");
const deckWith = (...names: string[]): CardPlacement[] =>
  names.map((name, i) => ({
    key: `dk${i}`,
    def: name === "Elitism" ? elitismCardN() : name === "Greed" ? resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }) : character({ name }),
    owner: P1,
    zone: "deck" as const
  }));

/** Picks the Elitism at placement key `key` for the Acceleration search (the rune must be pending). */
const accelPick = (g: Game, key: string): void => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });

clause(FAB, "3:ability:rune-of-acceleration", "COST: Destroy this card: it is in the discard pile as soon as the rune is used", () => {
  const g = fabBoard({ deck: deckWith("Elitism", "Deck Card") });
  rune(g, "rune-of-acceleration");
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
});

clause(FAB, "3:ability:rune-of-acceleration", "I search my deck for a card named Elitism and put it into play: it enters play face-up under my control and provides [E]", () => {
  const g = fabBoard({ deck: deckWith("Deck Card", "Elitism", "Other Card") });
  runeDone(g, "rune-of-acceleration");
  assert.equal(expectPending(g.engine, "chooserSelectsTarget").playerId, P1, "I search my own deck");
  accelPick(g, "dk1");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("dk1")), "play");
  assert.equal(isFaceDown(g.engine, g.id("dk1")), false, "face-up");
  assert.equal(controllerOf(g.engine, g.id("dk1")), P1);
  assert.equal(elitism(g.engine), 1);
  assert.equal(ready(g.engine), 1, "and it is a ready resource");
});

clause(FAB, "3:ability:rune-of-acceleration", "only a card NAMED Elitism can be found: Greed and other cards are refused", () => {
  const g = fabBoard({ deck: deckWith("Greed", "Elitism", "Other Card") });
  runeDone(g, "rune-of-acceleration");
  refused(() => accelPick(g, "dk0"), "Greed is not named Elitism");
  const h = fabBoard({ deck: deckWith("Greed", "Elitism", "Other Card") });
  runeDone(h, "rune-of-acceleration");
  refused(() => accelPick(h, "dk2"), "another card");
});

clause(FAB, "3:ability:rune-of-acceleration", "an Elitism in my hand, discard pile or the opponent's deck cannot be found", () => {
  const extra: CardPlacement[] = [
    { key: "handE", def: elitismCardN(), owner: P1, zone: "hand" },
    { key: "discardE", def: elitismCardN(), owner: P1, zone: "discard" },
    { key: "theirE", def: elitismCardN(), owner: P2, zone: "deck" }
  ];
  for (const key of ["handE", "discardE", "theirE"]) {
    const g = fabBoard({ deck: deckWith("Elitism"), extra });
    runeDone(g, "rune-of-acceleration");
    refused(() => accelPick(g, key), key);
  }
});

clause(FAB, "3:ability:rune-of-acceleration", "exactly one Elitism is found even if the deck has several", () => {
  const g = fabBoard({ deck: deckWith("Elitism", "Elitism", "Elitism") });
  runeDone(g, "rune-of-acceleration");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dk0"), g.id("dk1")] }), "two cards");
  const ok = fabBoard({ deck: deckWith("Elitism", "Elitism", "Elitism") });
  runeDone(ok, "rune-of-acceleration");
  accelPick(ok, "dk1");
  assert.equal(named(ok.engine, P1, "Elitism").length, 1);
});

clause(FAB, "3:ability:rune-of-acceleration", "the deck is shuffled afterwards (CR 312.1)", () => {
  const g = fabBoard({ deck: deckWith("Deck A", "Elitism", "Deck B", "Deck C", "Deck D") });
  const rest = deckOf(g.engine, P1).filter((id) => id !== g.id("dk1"));
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk1");
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), [...rest].sort());
  assert.notDeepEqual(after, rest, "a different order (seeded shuffle)");
});

clause(FAB, "3:ability:rune-of-acceleration", "a search for a named card may fail (CR 312.2): I can find nothing even though an Elitism is in the deck", () => {
  const g = fabBoard({ deck: deckWith("Elitism", "Deck Card") });
  runeDone(g, "rune-of-acceleration");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(named(g.engine, P1, "Elitism").length, 0);
});

clause(FAB, "3:ability:rune-of-acceleration", "with no Elitism in the deck nothing is put into play and the rune does not crash", () => {
  const g = fabBoard({ deck: deckWith("Deck A", "Deck B") });
  runeDone(g, "rune-of-acceleration");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(named(g.engine, P1, "Elitism").length, 0);
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
});

clause(FAB, "3:ability:rune-of-acceleration", "a search that finds nothing still shuffles the deck (CR 312.1)", () => {
  const g = fabBoard({ deck: deckWith("Deck A", "Deck B", "Deck C", "Deck D") });
  const order = deckOf(g.engine, P1);
  runeDone(g, "rune-of-acceleration");
  assert.notDeepEqual(deckOf(g.engine, P1), order, "the deck was searched, so it is shuffled");
});

const endOfTurnAnnounce = (g: Game): void => g.engine.perform({ type: "endTurn", playerId: P1 });
/** "destroy a card named Elitism you control" is the controller's pick (Q16): answers it with `key` once it is asked. */
const destroyElitism = (g: Game, key: string): void => {
  const pc = pending(g.engine);
  assert.ok(pc, "I am asked which Elitism to destroy");
  answerPending(g.engine, pc.kind, { selected: [g.id(key)] });
  resolvePendingResponses(g.engine);
};

clause(FAB, "3:ability:rune-of-acceleration", "'at the end of the turn' the Elitism I got is destroyed (to its owner's discard pile)", () => {
  const g = fabBoard({ deck: deckWith("Elitism", "Deck Card") });
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk0");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "play");
  endOfTurnAnnounce(g);
  resolvePendingResponses(g.engine);
  destroyElitism(g, "dk0");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "discard");
  assert.equal(g.engine.state.activePlayerId, P2, "the turn ended");
});

clause(FAB, "3:ability:rune-of-acceleration", "end-of-turn effects happen after the opponent has responded (CR 610.1a): the Elitism is still in play while they can respond to my end of turn", () => {
  const g = fabBoard({ deck: deckWith("Elitism", "Deck Card") });
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk0");
  endOfTurnAnnounce(g);
  assert.ok(g.engine.state.responseWindow, "setup: the opponent may respond to my end of turn");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "play", "not destroyed yet");
  resolvePendingResponses(g.engine);
  destroyElitism(g, "dk0");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "discard");
});

clause(FAB, "3:ability:rune-of-acceleration", "it stays until the end of the turn: the Elitism can be used to pay for something this turn", () => {
  const g = fabBoard({ deck: deckWith("Elitism"), extra: [{ key: "one", def: character({ name: "Costs 1", cost: 1 }), owner: P1, zone: "hand" }] });
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk0");
  playAndResolve(g.engine, P1, g.id("one"));
  assert.equal(zoneOf(g.engine, g.id("one")), "play", "paid with the borrowed Elitism");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "play");
});

clause(FAB, "3:ability:rune-of-acceleration", "'If you do': if nothing was put into play, an Elitism I already control is NOT destroyed at the end of the turn", () => {
  const g = fabBoard({ deck: deckWith("Deck A"), extra: [{ key: "oldE", def: elitismCardN(), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-acceleration");
  endOfTurnAnnounce(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("oldE")), "play");
});

clause(FAB, "3:ability:rune-of-acceleration", "the opponent's Elitism is not destroyed: 'a card named Elitism you control' (whatever a random pick would land on)", () => {
  for (const random of [() => 0.01, () => 0.5, () => 0.99]) {
    const g = fabBoard({ random, deck: deckWith("Elitism"), extra: [{ key: "theirE", def: elitismCardN(), owner: P2, zone: "play" }, { key: "theirE2", def: elitismCardN(), owner: P2, zone: "play" }] });
    runeDone(g, "rune-of-acceleration");
    accelPick(g, "dk0");
    endOfTurnAnnounce(g);
    resolvePendingResponses(g.engine);
    destroyElitism(g, "dk0");
    assert.equal(zoneOf(g.engine, g.id("dk0")), "discard");
    assert.equal(zoneOf(g.engine, g.id("theirE")), "play");
    assert.equal(zoneOf(g.engine, g.id("theirE2")), "play");
  }
});

clause(FAB, "3:ability:rune-of-acceleration", "with two Elitisms in play exactly ONE card named Elitism is destroyed at the end of the turn", () => {
  const g = fabBoard({ deck: deckWith("Elitism"), extra: [{ key: "oldE", def: elitismCardN(), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk0");
  endOfTurnAnnounce(g);
  let guard = 0;
  while ((g.engine.state.pendingChoice || g.engine.state.responseWindow) && guard++ < 6) {
    const pc = pending(g.engine);
    if (pc) answerPending(g.engine, pc.kind, { selected: [g.id("oldE")] }); // "destroy a card named Elitism you control" is my pick
    else resolvePendingResponses(g.engine);
  }
  const alive = ["oldE", "dk0"].filter((k) => zoneOf(g.engine, g.id(k)) === "play");
  assert.equal(alive.length, 1, "one of the two was destroyed, the other survives");
});

clause(FAB, "3:ability:rune-of-acceleration", "'destroy a card named Elitism you control': with two Elitisms I decide which one is destroyed", () => {
  const g = fabBoard({ deck: deckWith("Elitism"), extra: [{ key: "oldE", def: elitismCardN(), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-acceleration");
  accelPick(g, "dk0");
  endOfTurnAnnounce(g);
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  assert.ok(pc, "I am asked which Elitism to destroy");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, pc.kind, pc.kind === "selectTargets" ? { selected: { [(pc.declarations as { id: string }[])[0].id]: [g.id("oldE")] } } : { selected: [g.id("oldE")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("oldE")), "discard", "the one I chose");
  assert.equal(zoneOf(g.engine, g.id("dk0")), "play", "the other stays");
});

clause(FAB, "3:ability:rune-of-acceleration", "a face-down Fabtraption has no runes", () => {
  const g = fabBoard({ fab: { faceDown: true }, deck: deckWith("Elitism") });
  refused(() => rune(g, "rune-of-acceleration"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// --- RUNE OF OVERCLOCKING

const gearCard = (key: string, over: Partial<CardPlacement> = {}, def: CardDefinition = character({ name: `Gear ${key}`, trade: "gearsmith" })): CardPlacement => ({ key, def, owner: P1, zone: "play", ...over });

clause(FAB, "4:ability:rune-of-overclocking", "COST: Destroy this card. Pick a Gearsmith card you control: the Fabtraption is destroyed as the rune is used", () => {
  const g = fabBoard({ extra: [gearCard("gs")] });
  rune(g, "rune-of-overclocking", { gs: ["gs"] });
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
  assert.equal(tokensOn(g.engine, g.id("gs")), 0, "the token comes when it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("gs")), 1);
});

clause(FAB, "4:ability:rune-of-overclocking", "it puts exactly one token on the picked card, and none on any other card", () => {
  const g = fabBoard({ extra: [gearCard("gs"), gearCard("gs2")] });
  runeDone(g, "rune-of-overclocking", { gs: ["gs"] });
  assert.equal(tokensOn(g.engine, g.id("gs")), 1);
  assert.equal(tokensOn(g.engine, g.id("gs2")), 0);
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
});

clause(FAB, "4:ability:rune-of-overclocking", "the tokens accumulate: two Fabtraptions put two tokens on the same card", () => {
  const g = fabBoard({ extra: [gearCard("gs"), { key: "fab2", def: printing(FAB), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-overclocking", { gs: ["gs"] });
  activate(g.engine, P1, g.id("fab2"), "rune-of-overclocking", { selected: { gs: [g.id("gs")] } });
  assert.equal(tokensOn(g.engine, g.id("gs")), 2);
});

clause(FAB, "4:ability:rune-of-overclocking", "any type of Gearsmith card I control can be picked: a character, an item and a location", () => {
  for (const key of ["gsChar", "gsItem", "gsLoc"]) {
    const h = fabBoard({ extra: [gearCard("gsChar"), gearCard("gsItem", {}, item({ name: "Gear Item", trade: "gearsmith" })), gearCard("gsLoc", {}, location({ name: "Gear Location", trade: "gearsmith" }))] });
    runeDone(h, "rune-of-overclocking", { gs: [key] });
    assert.equal(tokensOn(h.engine, h.id(key)), 1, key);
  }
});

for (const [key, label] of [
  ["bankerChar", "a Banker card"],
  ["universalItem", "a Universal card"],
  ["theirGear", "a Gearsmith card the OPPONENT controls"],
  ["handGear", "a Gearsmith card in my hand (CR 402.3)"],
  ["discardGear", "a Gearsmith card in my discard pile (CR 402.3)"]
] as const) {
  clause(FAB, "4:ability:rune-of-overclocking", `cannot pick ${label}; a Gearsmith card I control can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      gearCard("gs"),
      gearCard("bankerChar", {}, character({ name: "Banker Char", trade: "banker" })),
      gearCard("universalItem", {}, item({ name: "Universal Item", trade: "universal" })),
      gearCard("theirGear", { owner: P2 }, character({ name: "Their Gear", trade: "gearsmith" })),
      gearCard("fdGear", { faceDown: true }, character({ name: "Hidden Gear", trade: "gearsmith" })),
      gearCard("handGear", { zone: "hand" }),
      gearCard("discardGear", { zone: "discard" })
    ];
    const bad = fabBoard({ extra });
    refused(() => rune(bad, "rune-of-overclocking", { gs: [key] }), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("fab")), "play", "the cost was not paid");
    const good = fabBoard({ extra });
    runeDone(good, "rune-of-overclocking", { gs: ["gs"] });
    assert.equal(tokensOn(good.engine, good.id("gs")), 1, "control");
  });
}

clause(FAB, "4:ability:rune-of-overclocking", "cannot pick a face-down Gearsmith card (only a resource with no trade, CR 411.1); a Gearsmith card I control can be picked on the same board", () => {
  const extra: CardPlacement[] = [gearCard("gs"), gearCard("fdGear", { faceDown: true }, character({ name: "Hidden Gear", trade: "gearsmith" }))];
  const bad = fabBoard({ extra });
  refused(() => rune(bad, "rune-of-overclocking", { gs: ["fdGear"] }), "picking a face-down Gearsmith card");
  assert.equal(zoneOf(bad.engine, bad.id("fab")), "play", "the cost was not paid");
  const good = fabBoard({ extra });
  runeDone(good, "rune-of-overclocking", { gs: ["gs"] });
  assert.equal(tokensOn(good.engine, good.id("gs")), 1, "control");
});

clause(FAB, "4:ability:rune-of-overclocking", "'you control', not 'own': a Gearsmith card I control but the opponent owns can be picked; one I own but they control cannot", () => {
  const g = fabBoard({
    extra: [
      gearCard("borrowed", { owner: P2, controller: P1 }, character({ name: "Borrowed Gear", trade: "gearsmith" })),
      gearCard("lent", { owner: P1, controller: P2 }, character({ name: "Lent Gear", trade: "gearsmith" }))
    ]
  });
  refused(() => rune(g, "rune-of-overclocking", { gs: ["lent"] }), "owned but not controlled");
  runeDone(g, "rune-of-overclocking", { gs: ["borrowed"] });
  assert.equal(tokensOn(g.engine, g.id("borrowed")), 1);
});

clause(FAB, "4:ability:rune-of-overclocking", "exactly one card is picked: none and two are refused", () => {
  const none = fabBoard({ extra: [gearCard("gs")] });
  refused(() => rune(none, "rune-of-overclocking", {}), "no pick");
  assert.equal(zoneOf(none.engine, none.id("fab")), "play");
  const two = fabBoard({ extra: [gearCard("gs"), gearCard("gs2")] });
  refused(() => rune(two, "rune-of-overclocking", { gs: ["gs", "gs2"] }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("fab")), "play");
});

clause(FAB, "4:ability:rune-of-overclocking", "the costs are paid in printed order: the Fabtraption (a Gearsmith card itself) cannot pick ITSELF", () => {
  const g = fabBoard({ extra: [gearCard("gs")] });
  refused(() => rune(g, "rune-of-overclocking", { gs: ["fab"] }), "the Fabtraption is already destroyed when the card is picked");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play", "nothing was paid");
});

clause(FAB, "4:ability:rune-of-overclocking", "a Micromajig token is a Gearsmith card (CR 409.3c.1): it can be picked and gets the token", () => {
  const g = fabBoard({ extra: [{ key: "fab2", def: printing(FAB), owner: P1, zone: "play" }] });
  runeDone(g, "rune-of-summoning");
  const [micro] = micromajigs(g.engine);
  assert.ok(micro, "setup: a Micromajig exists");
  activate(g.engine, P1, g.id("fab2"), "rune-of-overclocking", { selected: { gs: [micro] } });
  assert.equal(tokensOn(g.engine, micro), 1);
});

clause(FAB, "4:ability:rune-of-overclocking", "the token has a real effect on cards that count tokens: 4rm0r3d 31f loses 1 life", () => {
  const g = fabBoard({ extra: [{ key: "arm", def: printing(ARMORED), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 5);
  runeDone(g, "rune-of-overclocking", { gs: ["arm"] });
  assert.equal(tokensOn(g.engine, g.id("arm")), 1);
  assert.equal(g.engine.getStat(g.id("arm"), "life"), 4);
});

clause(FAB, "4:ability:rune-of-overclocking", "my faction cannot be picked (CR 202.9)", () => {
  const g = fabBoard({ extra: [gearCard("gs")] });
  refused(() => actRaw(g.engine, P1, g.id("fab"), "rune-of-overclocking", { gs: [factionOf(g.engine, P1)] }), "my faction");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play");
});

clause(FAB, "4:ability:rune-of-overclocking", "a face-down Fabtraption has no runes", () => {
  const g = fabBoard({ fab: { faceDown: true }, extra: [gearCard("gs")] });
  refused(() => rune(g, "rune-of-overclocking", { gs: ["gs"] }), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// --- RUNE OF DESTRUCTION

clause(FAB, "5:ability:rune-of-destruction", "COST: Destroy this card. Pick an item: the Fabtraption is destroyed as the rune is used, before it resolves", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  rune(g, "rune-of-destruction", { it: ["gadget"] });
  assert.equal(zoneOf(g.engine, g.id("fab")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gadget")), "play", "the item is removed when the rune resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("gadget")), "removed");
});

clause(FAB, "5:ability:rune-of-destruction", "the item is REMOVED FROM THE GAME, not destroyed: it is in its owner's removed zone and not in the discard pile", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  runeDone(g, "rune-of-destruction", { it: ["gadget"] });
  assert.ok(removedOf(g.engine, P1).includes(g.id("gadget")), "removedOf(g.engine, P1).includes(g.id(\"gadget\"))");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("gadget")), "!discardOf(g.engine, P1).includes(g.id(\"gadget\"))");
  assert.ok(!playOf(g.engine, P1).includes(g.id("gadget")), "!playOf(g.engine, P1).includes(g.id(\"gadget\"))");
});

clause(FAB, "5:ability:rune-of-destruction", "it can pick the opponent's item: it is removed from the game from THEIR side", () => {
  const g = fabBoard({ extra: [{ key: "theirs", def: item({ name: "Their Item", cost: 2 }), owner: P2, zone: "play" }] });
  runeDone(g, "rune-of-destruction", { it: ["theirs"] });
  assert.ok(removedOf(g.engine, P2).includes(g.id("theirs")), "removedOf(g.engine, P2).includes(g.id(\"theirs\"))");
  assert.ok(!discardOf(g.engine, P2).includes(g.id("theirs")), "!discardOf(g.engine, P2).includes(g.id(\"theirs\"))");
});

clause(FAB, "5:ability:rune-of-destruction", "only the picked item is removed: other items stay", () => {
  const g = fabBoard({ extra: [gadget(3), gadget(2, "gadget2")] });
  runeDone(g, "rune-of-destruction", { it: ["gadget"] });
  assert.equal(zoneOf(g.engine, g.id("gadget2")), "play");
});

for (const [key, label] of [
  ["chr", "a character"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdItem", "a face-down item (only a resource, CR 411.1)"],
  ["inHand", "an item card in my hand (CR 402.3)"],
  ["inDiscard", "an item card in my discard pile (CR 402.3)"]
] as const) {
  clause(FAB, "5:ability:rune-of-destruction", `cannot pick ${label}; an item in play can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      gadget(3),
      { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdItem", def: item({ name: "Hidden Item", cost: 2 }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: item({ name: "Discard Item" }), owner: P1, zone: "discard" }
    ];
    const bad = fabBoard({ extra });
    refused(() => rune(bad, "rune-of-destruction", { it: [key] }), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("fab")), "play", "the cost was not paid");
    const good = fabBoard({ extra });
    runeDone(good, "rune-of-destruction", { it: ["gadget"] });
    assert.equal(zoneOf(good.engine, good.id("gadget")), "removed", "control");
  });
}

clause(FAB, "5:ability:rune-of-destruction", "exactly one item is picked: none and two are refused", () => {
  const none = fabBoard({ extra: [gadget(3)] });
  refused(() => rune(none, "rune-of-destruction", {}), "no pick");
  assert.equal(zoneOf(none.engine, none.id("fab")), "play");
  const two = fabBoard({ extra: [gadget(3), gadget(2, "gadget2")] });
  refused(() => rune(two, "rune-of-destruction", { it: ["gadget", "gadget2"] }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("fab")), "play");
});

clause(FAB, "5:ability:rune-of-destruction", "the costs are paid in printed order: the Fabtraption (an item itself) cannot pick ITSELF", () => {
  const g = fabBoard({ extra: [gadget(3)] });
  refused(() => rune(g, "rune-of-destruction", { it: ["fab"] }), "the Fabtraption is already destroyed when the item is picked");
  assert.equal(zoneOf(g.engine, g.id("fab")), "play", "nothing was paid");
});

clause(FAB, "5:ability:rune-of-destruction", "a Fabtraption can remove ANOTHER Fabtraption from the game", () => {
  const g = fabBoard({ extra: [{ key: "fab2", def: printing(FAB), owner: P2, zone: "play" }] });
  runeDone(g, "rune-of-destruction", { it: ["fab2"] });
  assert.equal(zoneOf(g.engine, g.id("fab2")), "removed");
});

clause(FAB, "5:ability:rune-of-destruction", "a face-down Fabtraption has no runes", () => {
  const g = fabBoard({ fab: { faceDown: true }, extra: [gadget(3)] });
  refused(() => rune(g, "rune-of-destruction", { it: ["gadget"] }), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
});

// =============================================================================
// Enormous and Uncooperative Golem
// COST: Choose a number for X. Pay X.
// This card enters play with X tokens on it.
// At the start of your turn, remove a token from this card.
// While there is a token on this card, it gains 5 strength and 5 life.
// Character (golem), gearsmith, cost 1, [E][E]; 1 strength / 3 speed / 1 life.
// =============================================================================

const GOLEM = "c92296bd-41c4-4efa-9be9-5605d1c40806";

function golemBoard(o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; extra?: CardPlacement[]; golem?: Partial<CardPlacement> } = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "g", def: printing(GOLEM), owner: P1, zone: "hand", ...o.golem },
      ...res({ elitism: o.elitism ?? 8, greed: o.greed ?? 0 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** Deploys the Golem (key "g") choosing X = `x`, and lets it resolve. */
const deployGolem = (g: Game, x: number): void => playAndResolve(g.engine, P1, g.id("g"), { variables: { x } });

/** The Golem in play with `tokens` tokens already on it. */
const golemIn = (tokens: number, o: { active?: PlayerId; extra?: CardPlacement[]; golem?: Partial<CardPlacement> } = {}) =>
  golemBoard({ active: o.active, extra: o.extra, golem: { zone: "play", counters: tokens > 0 ? { token: tokens } : undefined, ...o.golem } });

// --- 0:ability — COST: Choose a number for X. Pay X.

clause(GOLEM, "0:ability", "it is a golem character with 1 strength / 3 speed / 1 life and no tokens until it enters play with X", () => {
  const g = golemBoard();
  deployGolem(g, 0);
  assert.deepEqual(g.engine.getCardTypes(g.id("g")), ["character"]);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("g"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 1);
  assert.deepEqual(g.engine.getSubtypes(g.id("g")), ["golem"]);
});

clause(GOLEM, "0:ability", "X = 0 is a whole number: only the card's own cost of 1 is paid", () => {
  const g = golemBoard();
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("g"), { variables: { x: 0 } });
  assert.equal(before - ready(g.engine), 1);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
});

clause(GOLEM, "0:ability", "'Pay X' is added to the card's cost: X = 1, 2 and 4 pay 2, 3 and 5 resources", () => {
  for (const x of [1, 2, 4]) {
    const g = golemBoard();
    const before = ready(g.engine);
    playRaw(g.engine, P1, g.id("g"), { variables: { x } });
    assert.equal(before - ready(g.engine), 1 + x, `X = ${x}`);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("g")), "play");
  }
});

clause(GOLEM, "0:ability", "X is paid when the card is played, before it resolves", () => {
  const g = golemBoard();
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("g"), { variables: { x: 3 } });
  assert.equal(zoneOf(g.engine, g.id("g")), "deploying");
  assert.equal(before - ready(g.engine), 4);
  assert.equal(tokensOn(g.engine, g.id("g")), 0, "the tokens come with the card entering play");
});

clause(GOLEM, "0:ability", "X resources must really be available: X = 3 with only 3 ready resources (needing 4) is refused and nothing is paid", () => {
  const bad = golemBoard({ elitism: 3 });
  refused(() => playRaw(bad.engine, P1, bad.id("g"), { variables: { x: 3 } }), "paying 4 with 3 resources");
  assert.equal(zoneOf(bad.engine, bad.id("g")), "hand");
  assert.equal(ready(bad.engine), 3);
  const good = golemBoard({ elitism: 3 });
  deployGolem(good, 2);
  assert.equal(zoneOf(good.engine, good.id("g")), "play", "control: X = 2 with 3 resources works");
  assert.equal(ready(good.engine), 0);
});

clause(GOLEM, "0:ability", "resources already spent cannot pay X", () => {
  const bad = golemBoard({ elitism: 2, spentElitism: 3 });
  assert.equal(ready(bad.engine), 2);
  refused(() => playRaw(bad.engine, P1, bad.id("g"), { variables: { x: 2 } }), "paying 3 with 2 ready resources");
  assert.equal(zoneOf(bad.engine, bad.id("g")), "hand");
});

clause(GOLEM, "0:ability", "it needs [E][E]: one Elitism and plenty of Greed is refused, spent [E] still meets the threshold", () => {
  const bad = golemBoard({ elitism: 1, greed: 6 });
  refused(() => playRaw(bad.engine, P1, bad.id("g"), { variables: { x: 1 } }), "only one [E]");
  assert.equal(zoneOf(bad.engine, bad.id("g")), "hand");
  assert.equal(ready(bad.engine), 7);
  const spentOk = golemBoard({ elitism: 0, greed: 3, spentElitism: 2 });
  deployGolem(spentOk, 2);
  assert.equal(zoneOf(spentOk.engine, spentOk.id("g")), "play", "two spent [E] meet the threshold while Greed pays");
});

clause(GOLEM, "0:ability", "X must be a whole number (CR 410.2): X = 1.5 and X = -1 are refused", () => {
  const frac = golemBoard();
  refused(() => playRaw(frac.engine, P1, frac.id("g"), { variables: { x: 1.5 } }), "a fractional X");
  assert.equal(zoneOf(frac.engine, frac.id("g")), "hand");
  assert.equal(ready(frac.engine), 8, "nothing paid");
  const neg = golemBoard();
  refused(() => playRaw(neg.engine, P1, neg.id("g"), { variables: { x: -1 } }), "a negative X");
  assert.equal(zoneOf(neg.engine, neg.id("g")), "hand");
  assert.equal(ready(neg.engine), 8);
});

clause(GOLEM, "0:ability", "it is refused with fewer than the card's own cost of 1 ready even for X = 0", () => {
  const g = golemBoard({ elitism: 0, spentElitism: 2 });
  refused(() => playRaw(g.engine, P1, g.id("g"), { variables: { x: 0 } }), "nothing ready to pay 1");
  assert.equal(zoneOf(g.engine, g.id("g")), "hand");
});

// --- 1:rule — This card enters play with X tokens on it.

clause(GOLEM, "1:rule", "it enters play with exactly X tokens: X = 0, 1, 3 and 5 give 0, 1, 3 and 5 tokens", () => {
  for (const x of [0, 1, 3, 5]) {
    const g = golemBoard();
    deployGolem(g, x);
    assert.equal(tokensOn(g.engine, g.id("g")), x, `X = ${x}`);
  }
});

clause(GOLEM, "1:rule", "the tokens are on THIS card and nowhere else", () => {
  const g = golemBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  deployGolem(g, 2);
  assert.equal(tokensOn(g.engine, g.id("other")), 0);
});

clause(GOLEM, "1:rule", "the tokens are there as it enters play: with X = 2 it already has its +5/+5", () => {
  const g = golemBoard();
  deployGolem(g, 2);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 6);
});

clause(GOLEM, "1:rule", "a Golem put into play by an effect (X never chosen) enters with 0 tokens", () => {
  const g = golemBoard({ extra: [{ key: "put", def: putTactic(), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("put"), { selected: { t: [g.id("g")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
});

clause(GOLEM, "1:rule", "deployed for free it still has its extra cost (CR 308.1a): X = 2 is chosen and paid, and the Golem gets 2 tokens", () => {
  const g = golemBoard({
    elitism: 4,
    extra: [{ key: "free", def: tactic({ name: "Free Deploy", cost: 0, behavior: { abilities: [{ id: "fd", type: "activated", effects: [{ type: "deployForFree", player: "controller", maxCost: 99, selector: { owner: "self", zone: "hand", type: "character" } }] }] } }), owner: P1, zone: "hand" }]
  });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("free"));
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  assert.ok(pc, "I am asked which card to deploy for free");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("g"), variables: { x: 2 } } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
  assert.equal(before - ready(g.engine), 2, "'Pay X' is still paid: the card's cost number is 0 but its extra cost is not waived");
});

clause(GOLEM, "1:rule", "tokens disappear when it leaves play (CR 409.2): back in play with X = 0 it has no tokens", () => {
  const g = golemBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  deployGolem(g, 2);
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
  playAndResolve(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("g")] } });
  assert.equal(zoneOf(g.engine, g.id("g")), "hand");
  deployGolem(g, 0);
  assert.equal(tokensOn(g.engine, g.id("g")), 0, "the old tokens are gone");
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
});

// --- 2:rule — At the start of your turn, remove a token from this card.

clause(GOLEM, "2:rule", "at the start of my turn exactly one token is removed: 3 tokens become 2", () => {
  const g = golemIn(3, { active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("g")), 2);
});

clause(GOLEM, "2:rule", "one token becomes none, and with no token there is nothing to remove (it stays at 0)", () => {
  const one = golemIn(1, { active: P2 });
  endTurn(one.engine, P2);
  assert.equal(tokensOn(one.engine, one.id("g")), 0);
  const none = golemIn(0, { active: P2 });
  endTurn(none.engine, P2);
  assert.equal(tokensOn(none.engine, none.id("g")), 0);
  assert.equal(none.engine.state.pendingChoice, undefined);
});

clause(GOLEM, "2:rule", "it is at the start of MY turn only: nothing is removed at the start of the opponent's turn", () => {
  const g = golemIn(3, { active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(g.engine, g.id("g")), 3);
});

clause(GOLEM, "2:rule", "it counts down one per turn of mine: 3 tokens last three of my turns", () => {
  const g = golemIn(3, { active: P2 });
  const seen: number[] = [];
  for (let i = 0; i < 3; i++) {
    endTurn(g.engine, P2);
    seen.push(tokensOn(g.engine, g.id("g")));
    endTurn(g.engine, P1);
  }
  assert.deepEqual(seen, [2, 1, 0]);
});

clause(GOLEM, "2:rule", "'your turn' is its controller's turn: a Golem the opponent controls loses its token at THEIR turn start, not mine", () => {
  const g = golemIn(2, { active: P1, golem: { controller: P2 } });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(g.engine, g.id("g")), 1, "removed at the controller's turn start");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(g.engine, g.id("g")), 1, "and not at mine");
});

clause(GOLEM, "2:rule", "two Golems each lose one token", () => {
  const g = golemIn(2, { active: P2, extra: [{ key: "g2", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 4 } }] });
  endTurn(g.engine, P2);
  let guard = 0;
  while (g.engine.state.pendingChoice && guard++ < 4) {
    const pc = pending(g.engine)!;
    if (pc.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else break;
  }
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.equal(tokensOn(g.engine, g.id("g2")), 3);
});

clause(GOLEM, "2:rule", "a face-down Golem is only a resource: its text is dormant and nothing is removed", () => {
  const faceDown = golemIn(2, { active: P2, golem: { faceDown: true } });
  endTurn(faceDown.engine, P2);
  assert.equal(tokensOn(faceDown.engine, faceDown.id("g")), 2, "a face-down card is only a resource; its text is dormant");
});

// --- 3:rule — While there is a token on this card, it gains 5 strength and 5 life.

clause(GOLEM, "3:rule", "with one token it gains 5 strength and 5 life: 1/1 becomes 6/6", () => {
  const g = golemIn(1);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 6);
});

clause(GOLEM, "3:rule", "speed is unchanged by the bonus", () => {
  const g = golemIn(1);
  assert.equal(g.engine.getStat(g.id("g"), "speed"), 3);
});

clause(GOLEM, "3:rule", "'while there is a token' is a yes/no condition: five tokens give +5/+5, not +25/+25", () => {
  const g = golemIn(5);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 6);
});

clause(GOLEM, "3:rule", "without a token it has its printed 1 strength and 1 life", () => {
  const g = golemIn(0);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 1);
});

clause(GOLEM, "3:rule", "it turns off the moment the last token is gone: removing the token at the start of my turn drops it back to 1/1", () => {
  const g = golemIn(1, { active: P2 });
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 6);
  endTurn(g.engine, P2);
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 1);
});

clause(GOLEM, "3:rule", "only tokens ON THIS CARD count: tokens on another card give the Golem nothing", () => {
  const g = golemIn(0, { extra: [{ key: "other", def: character({ name: "Other", life: 2 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 1, "and the other card gets no bonus either");
  assert.equal(g.engine.getStat(g.id("other"), "life"), 2);
});

clause(GOLEM, "3:rule", "a token put on it by Contrabulous Fabtraption's RUNE OF OVERCLOCKING turns the bonus on (the Golem is a Gearsmith card)", () => {
  const g = golemIn(0, { extra: [{ key: "fab", def: printing(FAB), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("fab"), "rune-of-overclocking", { selected: { gs: [g.id("g")] } });
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.equal(g.engine.getStat(g.id("g"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("g"), "life"), 6);
});

clause(GOLEM, "3:rule", "the extra life is real: with a token it survives 5 damage, and without one it does not", () => {
  const withToken = golemIn(1, { extra: [{ key: "zap", def: damageTactic(5), owner: P1, zone: "hand" }] });
  playAndResolve(withToken.engine, P1, withToken.id("zap"), { selected: { t: [withToken.id("g")] } });
  assert.equal(zoneOf(withToken.engine, withToken.id("g")), "play");
  assert.equal(damageOf(withToken.engine, withToken.id("g")), 5);
  const bare = golemIn(0, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(bare.engine, P1, bare.id("zap"), { selected: { t: [bare.id("g")] } });
  assert.equal(zoneOf(bare.engine, bare.id("g")), "discard", "1 damage on 1 life");
});

clause(GOLEM, "3:rule", "the extra strength is real in battle: deployed with X = 2 it attacks on my next turn with 1 token left and hits for 6", () => {
  const g = golemBoard({ extra: [] });
  deployGolem(g, 2);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  fightThrough(g.engine, P1, [g.id("g")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(g.engine, P2), 24);
});

clause(GOLEM, "3:rule", "a Golem deployed with X = 1 loses its bonus at my next turn start, so it attacks as a plain 1/3/1", () => {
  const g = golemBoard();
  deployGolem(g, 1);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  fightThrough(g.engine, P1, [g.id("g")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(g.engine, P2), 29);
});

// =============================================================================
// G14n7 5p0rk D3f3n53
// You may play this card whenever you could play a tactic.
// IMPALE -- COST: Destroy this card. Pick an attacking character.
//   EFFECT: Destroy the character.
// FLIP UP: 1 [E][E]
// Item, gearsmith, cost 3, [E][E].
// =============================================================================

const SPORK = "94b05fef-2998-4935-b8d7-7952acb58953";
const VACATION = "f5b4db56-d972-48de-b1b5-7f16b7d427aa";

function sporkBoard(
  o: {
    elitism?: number;
    greed?: number;
    spentElitism?: number;
    active?: PlayerId;
    spork?: Partial<CardPlacement>;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P2;
  return devBoard(
    [
      { key: "spork", def: printing(SPORK), owner: P1, zone: "hand", ...o.spork },
      { key: "mine", def: character({ name: "My Character", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Attacker", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Their Second Attacker", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Their Idle Character", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res({ elitism: o.elitism ?? 2, greed: o.greed ?? 2 }),
      ...spent("elitism", o.spentElitism ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, activePlayerId: active }
  );
}

/** The opponent attacks with `keys` and passes: I hold priority in the declaration window. */
const theyAttack = (g: Game, ...keys: string[]): void => declareAttackOpenWindow(g.engine, P2, keys.map((k) => g.id(k)));

/** Deploys the Spork (raw) and lets it resolve. */
const deploySpork = (g: Game): void => playAndResolve(g.engine, P1, g.id("spork"));

/** A Spork already in play. */
const sporkInPlay = (o: Parameters<typeof sporkBoard>[0] = {}) => sporkBoard({ ...o, spork: { zone: "play", ...o.spork } });

/** IMPALE on the character at placement key `prey` (raw). */
const impale = (g: Game, prey: string, player: PlayerId = P1): void => actRaw(g.engine, player, g.id("spork"), "impale", { prey: [g.id(prey)] });

// --- 0:rule — You may play this card whenever you could play a tactic.

clause(SPORK, "0:rule", "it deploys for exactly its printed cost of 3 with [E][E] on my own turn, and is an item in play", () => {
  const g = sporkBoard({ active: P1, elitism: 2, greed: 3 });
  const before = ready(g.engine);
  deploySpork(g);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("spork")), ["item"]);
  assert.equal(before - ready(g.engine), 3);
});

clause(SPORK, "0:rule", "it is refused one resource short (2 resources) and without [E][E] (1 Elitism + 3 Greed), and nothing is paid", () => {
  const short = sporkBoard({ active: P1, elitism: 2, greed: 0 });
  refused(() => playRaw(short.engine, P1, short.id("spork")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("spork")), "hand");
  assert.equal(ready(short.engine), 2);
  const noThreshold = sporkBoard({ active: P1, elitism: 1, greed: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("spork")), "only one [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("spork")), "hand");
  assert.equal(ready(noThreshold.engine), 4);
});

clause(SPORK, "0:rule", "on the opponent's turn I can play it in response to their attack, as if it were a tactic", () => {
  const g = sporkBoard({ elitism: 2, greed: 3 });
  theyAttack(g, "atk");
  assert.equal(g.engine.state.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play", "the item resolved into play");
  assert.deepEqual(g.engine.getCardTypes(g.id("spork")), ["item"]);
});

clause(SPORK, "0:rule", "on the opponent's turn I can play it in response to a tactic they play", () => {
  const g = sporkBoard({ elitism: 2, greed: 3, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("noop"));
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "on the opponent's turn I can play it in response to an ability they use", () => {
  const g = sporkBoard({ elitism: 2, greed: 3, extra: [{ key: "dr", def: drawerChar({ name: "Their Drawer" }), owner: P2, zone: "play" }] });
  actRaw(g.engine, P2, g.id("dr"), "draw1");
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "on the opponent's turn I can play it in response to their ending the turn", () => {
  const g = sporkBoard({ elitism: 2, greed: 3 });
  g.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "on the opponent's turn with no window open it cannot be played (a tactic could not be either)", () => {
  const g = sporkBoard({ elitism: 2, greed: 3 });
  refused(() => playRaw(g.engine, P1, g.id("spork")), "no window, opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("spork")), "hand");
  assert.equal(ready(g.engine), 5, "nothing was paid");
});

clause(SPORK, "0:rule", "control: an ordinary item without that sentence cannot be played in the same attack window", () => {
  const g = sporkBoard({ elitism: 2, greed: 3, extra: [{ key: "plain", def: item({ name: "Plain Item", cost: 0 }), owner: P1, zone: "hand" }] });
  theyAttack(g, "atk");
  refused(() => playRaw(g.engine, P1, g.id("plain")), "a plain item is not a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "on my own turn I can play it during a battle I started, in the window before blockers", () => {
  const g = sporkBoard({ active: P1, elitism: 2, greed: 3, extra: [{ key: "myAtk", def: character({ name: "My Attacker", strength: 1, life: 5 }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("myAtk")], target: { type: "faction", playerId: P2 } });
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in my own declaration window");
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "it can be played during the battle-resolution window after blockers are declared", () => {
  const g = sporkBoard({ elitism: 2, greed: 3 });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("mine")]);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("spork"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "0:rule", "it cannot be played at instant speed once tactics cannot be deployed this turn (Tactician Vacation, FAQ), though it still can on my turn", () => {
  const g = sporkBoard({ elitism: 2, greed: 3, extra: [{ key: "vac", def: printing(VACATION), owner: P2, zone: "hand" }, ...res({ rage: 4 }, P2)] });
  playAndResolve(g.engine, P2, g.id("vac"));
  assert.equal(zoneOf(g.engine, g.id("vac")), "discard", "setup: Tactician Vacation resolved");
  theyAttack(g, "atk");
  refused(() => playRaw(g.engine, P1, g.id("spork")), "tactics cannot be deployed this turn, so neither can 'whenever you could play a tactic'");
  assert.equal(zoneOf(g.engine, g.id("spork")), "hand");
});

clause(SPORK, "0:rule", "Tactician Vacation does not stop it on my own turn: it 'can still be played when it normally could be played' (FAQ)", () => {
  const g = sporkBoard({ active: P1, elitism: 2, greed: 3, extra: [{ key: "vac", def: printing(VACATION), owner: P1, zone: "hand" }, ...res({ rage: 4 })] });
  playAndResolve(g.engine, P1, g.id("vac"));
  assert.equal(zoneOf(g.engine, g.id("vac")), "discard");
  deploySpork(g);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

// --- 1:ability:impale

clause(SPORK, "1:ability:impale", "COST: Destroy this card: the Spork is in the discard pile as soon as IMPALE is used, before it resolves", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk");
  impale(g, "atk");
  assert.equal(zoneOf(g.engine, g.id("spork")), "discard");
  assert.equal(zoneOf(g.engine, g.id("atk")), "play", "the attacker is destroyed when the ability resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
});

clause(SPORK, "1:ability:impale", "EFFECT: Destroy the character: the attacker goes to its owner's discard pile", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.ok(discardOf(g.engine, P2).includes(g.id("atk")), "discardOf(g.engine, P2).includes(g.id(\"atk\"))");
  assert.equal(zoneOf(g.engine, g.id("atk2")), "play");
});

clause(SPORK, "1:ability:impale", "IMPALE needs no resources and no threshold of its own: a Spork in play can be used with nothing in the bank", () => {
  const g = sporkInPlay({ elitism: 0, greed: 0 });
  assert.equal(ready(g.engine), 0);
  theyAttack(g, "atk");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
});

clause(SPORK, "1:ability:impale", "when the only attacker is destroyed the battle has no attackers left and ends", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.deepEqual(battleOf(g.engine)?.attackingParty ?? [], []);
  assert.equal(influenceOf(g.engine, P1), 30, "no damage reached my faction");
});

clause(SPORK, "1:ability:impale", "in a party of two, destroying one attacker leaves the other attacking", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk", "atk2");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("atk2")]);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(influenceOf(g.engine, P1), 29, "only the second attacker's 1 damage");
});

clause(SPORK, "1:ability:impale", "a blocking character is not an ATTACKING character: my own blocker is refused, while the attacker can still be impaled after blocks", () => {
  const g = sporkInPlay();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("mine")]);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => impale(g, "mine"), "my own blocker is not an attacker");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play", "nothing was paid");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "control: the attacker works, even after blocks");
});

clause(SPORK, "1:ability:impale", "a character that is not part of the attack cannot be picked", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk");
  refused(() => impale(g, "idle"), "an idle character is not attacking");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play", "nothing was paid");
  impale(g, "atk");
  assert.equal(zoneOf(g.engine, g.id("spork")), "discard", "control");
});

clause(SPORK, "1:ability:impale", "with no battle at all there is no attacking character: IMPALE cannot be used", () => {
  const g = sporkInPlay({ active: P1 });
  refused(() => impale(g, "atk"), "no battle");
  refused(() => impale(g, "mine"), "no battle");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "1:ability:impale", "'an attacking character' is not limited to the opponent's: on my turn I may impale my own attacker", () => {
  const g = sporkInPlay({ active: P1, extra: [{ key: "myAtk", def: character({ name: "My Attacker", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("myAtk")], target: { type: "faction", playerId: P2 } });
  impale(g, "myAtk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("myAtk")), "discard");
});

clause(SPORK, "1:ability:impale", "an attacker can be impaled only once it has been declared: exactly one pick is required", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk", "atk2");
  refused(() => actRaw(g.engine, P1, g.id("spork"), "impale", {}), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("spork"), "impale", { prey: [g.id("atk"), g.id("atk2")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play", "nothing was paid");
});

for (const [key, label] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fdChar", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "an attacker-like character card in their hand"],
  ["inDiscard", "a character card in their discard pile"]
] as const) {
  clause(SPORK, "1:ability:impale", `cannot pick ${label}; the attacking character can be picked on the same board`, () => {
    const extra: CardPlacement[] = [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdChar", def: character({ name: "Face Down", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" }
    ];
    const bad = sporkInPlay({ extra });
    theyAttack(bad, "atk");
    refused(() => impale(bad, key), `picking ${label}`);
    assert.equal(zoneOf(bad.engine, bad.id("spork")), "play", "nothing was paid");
    const good = sporkInPlay({ extra });
    theyAttack(good, "atk");
    impale(good, "atk");
    resolvePendingResponses(good.engine);
    assert.equal(zoneOf(good.engine, good.id("atk")), "discard", "control");
  });
}

clause(SPORK, "1:ability:impale", "a faction cannot be picked (CR 202.9)", () => {
  const g = sporkInPlay();
  theyAttack(g, "atk");
  refused(() => actRaw(g.engine, P1, g.id("spork"), "impale", { prey: [factionOf(g.engine, P2)] }), "their faction");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "1:ability:impale", "a Spork that is face-down has no abilities (CR 411.1)", () => {
  const g = sporkBoard({ spork: { zone: "play", faceDown: true } });
  theyAttack(g, "atk");
  refused(() => impale(g, "atk"), "a face-down card has no abilities", /face-down card's abilities cannot be activated/);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
});

clause(SPORK, "1:ability:impale", "only its controller may use IMPALE: the opponent cannot use a Spork I control", () => {
  const g = sporkInPlay({ active: P1, extra: [{ key: "myAtk", def: character({ name: "My Attacker", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("myAtk")], target: { type: "faction", playerId: P2 } });
  g.engine.perform({ type: "passPriority", playerId: P1 });
  refused(() => impale(g, "myAtk", P2), "the opponent does not control the Spork");
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
});

clause(SPORK, "1:ability:impale", "deployed in response to an attack and then used in the same window: the Spork can be played and impale right after", () => {
  const g = sporkBoard({ elitism: 2, greed: 3 });
  theyAttack(g, "atk");
  playRaw(g.engine, P1, g.id("spork"));
  g.engine.perform({ type: "passPriority", playerId: P2 });
  g.engine.perform({ type: "advanceFlow" });
  assert.equal(zoneOf(g.engine, g.id("spork")), "play", "setup: the Spork resolved into play");
  assert.equal(g.engine.state.priorityPlayerId, P1, "setup: I may still respond");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.equal(zoneOf(g.engine, g.id("spork")), "discard");
});

// --- 2:flipUp — FLIP UP: 1 [E][E]

function flipSporkBoard(o: { elitism?: number; greed?: number; spentElitism?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return sporkBoard({ ...o, spork: { zone: "play", faceDown: true } });
}

const flipSpork = (g: Game, player: PlayerId = P1): void => flipUpRaw(g.engine, player, g.id("spork"));

clause(SPORK, "2:flipUp", "a face-down Spork flips up into a face-up item on my turn", () => {
  const g = flipSporkBoard({ active: P1 });
  assert.deepEqual(g.engine.getCardTypes(g.id("spork")), ["resource"]);
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
  assert.equal(isFaceDown(g.engine, g.id("spork")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("spork")), ["item"]);
});

clause(SPORK, "2:flipUp", "flipping up pays exactly 1 (not its cost of 3)", () => {
  const g = flipSporkBoard({ active: P1, elitism: 2, greed: 3 });
  const before = ready(g.engine);
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 1 + 1, "1 paid, and the flipped card itself is no longer a resource");
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(SPORK, "2:flipUp", "the Spork may pay for its own FLIP UP (CR 507.4b): two spent [E] and only the face-down card ready is enough", () => {
  const g = flipSporkBoard({ active: P1, elitism: 0, greed: 0, spentElitism: 2 });
  assert.equal(ready(g.engine), 1);
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("spork")), false);
});

clause(SPORK, "2:flipUp", "FLIP UP needs [E][E]: one Elitism and plenty of Greed is refused, and nothing is paid", () => {
  const g = flipSporkBoard({ active: P1, elitism: 1, greed: 4 });
  refused(() => flipSpork(g), "only one [E]");
  assert.equal(isFaceDown(g.engine, g.id("spork")), true);
  assert.equal(ready(g.engine), 6);
});

clause(SPORK, "2:flipUp", "FLIP UP is refused with no resource to pay even with [E][E] met by spent resources", () => {
  const g = flipSporkBoard({ active: P1, elitism: 0, greed: 0, spentElitism: 2 });
  g.engine.state.cards[g.id("spork")].attachedTo = factionOf(g.engine, P1);
  assert.equal(ready(g.engine), 0);
  assert.equal(elitism(g.engine), 2);
  refused(() => flipSpork(g), "nothing ready to pay 1");
  assert.equal(isFaceDown(g.engine, g.id("spork")), true);
});

clause(SPORK, "2:flipUp", "Volition and the opponent's [E] do not meet [E][E]", () => {
  const vol = flipSporkBoard({ active: P1, elitism: 0, greed: 0, extra: volition(4, P1) });
  refused(() => flipSpork(vol), "Volition is not [E]");
  const theirs = flipSporkBoard({ active: P1, elitism: 1, greed: 3, extra: res({ elitism: 5 }, P2) });
  refused(() => flipSpork(theirs), "the opponent's [E]");
});

clause(SPORK, "2:flipUp", "TACTICAL works while face-down (CR 507.6b): on the opponent's turn I can flip it up in response to their attack", () => {
  const g = flipSporkBoard();
  theyAttack(g, "atk");
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("spork")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("spork")), ["item"]);
});

clause(SPORK, "2:flipUp", "flipped up in response, IMPALE is available at once: it destroys the attacker in the same window", () => {
  const g = flipSporkBoard();
  theyAttack(g, "atk");
  flipSpork(g);
  assert.equal(isFaceDown(g.engine, g.id("spork")), false, "setup: flipped up");
  impale(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.equal(zoneOf(g.engine, g.id("spork")), "discard");
});

clause(SPORK, "2:flipUp", "on the opponent's turn with no response window open, FLIP UP is refused", () => {
  const g = flipSporkBoard();
  refused(() => flipSpork(g), "no window, opponent's turn");
  assert.equal(isFaceDown(g.engine, g.id("spork")), true);
  assert.equal(ready(g.engine), 5, "nothing was paid");
});

clause(SPORK, "2:flipUp", "only a face-down Spork I control in play can be flipped up (not face-up, not in hand, not the opponent's)", () => {
  const faceUp = sporkInPlay({ active: P1 });
  refused(() => flipSpork(faceUp), "already face-up");
  const inHand = sporkBoard({ active: P1 });
  refused(() => flipSpork(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("spork")), "hand");
  const theirs = flipSporkBoard({ active: P1 });
  refused(() => flipSpork(theirs, P2), "only its controller");
  assert.equal(isFaceDown(theirs.engine, theirs.id("spork")), true);
});

clause(SPORK, "2:flipUp", "once flipped up and resolved the item stays in play (it is not a tactic)", () => {
  const g = flipSporkBoard({ active: P1 });
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("spork")), "play");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("spork")), "!discardOf(g.engine, P1).includes(g.id(\"spork\"))");
});

// =============================================================================
// Extra probes (cross-cutting, one or two per card)
// =============================================================================

/** A free tactic (id "rn"): the next numeric cost its controller pays this turn is reduced by `n`. */
const reduceTactic = (n: number, name = `Reduce ${n}`): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "rn", type: "activated", effects: [{ type: "reduceNextCost", player: "controller", amount: n }] }] } });

clause(SHINY, "0:ability", "the cost's pick is locked in when played: if the picked character is destroyed in response, Tiny Shiny still resolves into a face-down resource (effects never fizzle, CR 402.5a)", () => {
  const g = shinyBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("c")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c")), "discard", "setup: the picked character was destroyed in response");
  assert.equal(zoneOf(g.engine, g.id("ts")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ts")), true);
});

clause(DOOM, "0:attach", "if the host is gone when D00dm4k3r would enter play, it is put into its owner's discard pile instead (CR 507.2c)", () => {
  const g = doomBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("dm"), { selected: { attachTo: [g.id("host")] } });
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("host")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("host")), "discard", "setup: the host was destroyed in response");
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("dm")), "discardOf(g.engine, P1).includes(g.id(\"dm\"))");
});

clause(INVENTION, "0:ability", "'Draw a card' with an empty deck just fails to draw: no loss, no crash, and the tactic still resolves", () => {
  const g = inventionBoard({ deck: 0 });
  invent(g, true);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.result, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(TECH, "2:ability:restore-self", "'Pay 3' is a numeric cost (CR 406.5): a 'reduce the next numeric cost you pay by 1' effect makes RESTORE cost 2", () => {
  const g = techBoard({ elitism: 4, depleted: true, extra: [{ key: "rn", def: reduceTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("rn"));
  const before = ready(g.engine);
  activate(g.engine, P1, g.id("tech"), "restore-self");
  assert.equal(isDepleted(g.engine, g.id("tech")), false);
  assert.equal(before - ready(g.engine), 2, "3 - 1");
});

clause(ARMORED, "1:ability:fall-apart", "'Pay 1' is a numeric cost (CR 406.5): a 'reduce the next numeric cost you pay by 1' effect makes FALL APART free", () => {
  const g = armBoard({ elitism: 3, extra: [{ key: "rn", def: reduceTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("rn"));
  const before = ready(g.engine);
  fallApart(g);
  assert.equal(micromajigs(g.engine).length, 1);
  assert.equal(before - ready(g.engine), 0, "1 - 1");
});

clause(NODE, "2:ability:dissolve", "'Pay 2' is a numeric cost (CR 406.5): a 'reduce the next numeric cost you pay by 1' effect makes DISSOLVE cost 1", () => {
  const g = dissolveBoard({ elitism: 3, extra: [{ key: "rn", def: reduceTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("rn"));
  const before = ready(g.engine);
  activate(g.engine, P1, g.id("cn"), "dissolve");
  assert.equal(isFaceDown(g.engine, g.id("cn")), true);
  assert.equal(before - ready(g.engine), 0, "2 - 1 = 1 paid, and the flipped card is a new ready resource (+1)");
});

clause(GOLEM, "0:ability", "'Pay X' is part of the card's numeric cost (CR 406.3): a 'reduce the next numeric cost by 1' effect makes X = 2 cost 1 + 2 - 1 = 2", () => {
  const g = golemBoard({ extra: [{ key: "rn", def: reduceTactic(1), owner: P1, zone: "hand" }] });
  playAndResolve(g.engine, P1, g.id("rn"));
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("g"), { variables: { x: 2 } });
  assert.equal(before - ready(g.engine), 2);
});

// --- SYS-36: a spent (attached) face-down card is still a face-down resource in play, so it can be flipped up (CR 507.4a)

clause(NODE, "3:flipUp", "a face-down Clay Node that is spent (attached to my faction) can still be flipped up, paid for by other resources (CR 507.4a)", () => {
  const g = flipNodeBoard({ elitism: 0, spentElitism: 0, greed: 0, extra: [...spent("elitism", 3), ...res({ greed: 2 })] });
  g.engine.state.cards[g.id("cn")].attachedTo = factionOf(g.engine, P1);
  flipNode(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) searchPick(g, []);
  assert.equal(isFaceDown(g.engine, g.id("cn")), false);
});

clause(INVENTION, "2:flipUp", "a face-down Accidental Invention that is spent (attached to my faction) can still be flipped up, paid for by another resource (CR 507.4a)", () => {
  const g = flipBoard({ elitism: 1, greed: 1, aiSpent: true });
  flipAI(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree" } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

clause(BLOCK, "1:flipUp", "a face-down Cock Block that is spent (attached to my faction) can still be flipped up, paid for by other resources (CR 507.4a)", () => {
  const g = blockBoard({ cb: { zone: "play", faceDown: true, attachedToKey: "__factionA" }, elitism: 1, greed: 4, hand: 2 });
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  discardForFlip(g, "hand0");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, 0, "the ability was terminated");
});

clause(SPORK, "2:flipUp", "a face-down Spork that is spent (attached to my faction) can still be flipped up, paid for by other resources (CR 507.4a)", () => {
  const g = sporkBoard({ active: P1, elitism: 2, greed: 1, spork: { zone: "play", faceDown: true, attachedToKey: "__factionA" } });
  flipSpork(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("spork")), false);
});

clause(BLOCK, "1:flipUp", "'and discard a card' is mandatory: answering the prompt with no card is refused", () => {
  const g = flipBlockBoard();
  theyUse(g, "drawer", "draw1");
  flipBlock(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "discarding no card");
});

// =============================================================================
// Extra probes, round two
// =============================================================================

clause(BLOCK, "0:ability", "in a chain the ability it answers must be the one on top: with a tactic on top of their earlier ability it cannot be played", () => {
  const g = blockBoard({
    extra: [
      { key: "mynoop", def: NOOP, owner: P1, zone: "hand" },
      { key: "theirTactic", def: tactic({ id: "seed-2-03-their-noop", name: "Their Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }
    ]
  });
  theyUse(g, "drawer", "draw1");
  playRaw(g.engine, P1, g.id("mynoop"));
  playRaw(g.engine, P2, g.id("theirTactic"));
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => blockIt(g), "the thing on top is their tactic, not an ability", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
});

clause(TECH, "1:ability:assist", "restoring an ally that attacked leaves the Tech itself depleted and unable to restore anything else the same way: a second ASSIST is refused", () => {
  const g = techBoard({ extra: [{ key: "ally2", def: character({ name: "Ally 2" }), owner: P1, zone: "play", depleted: true }] });
  activate(g.engine, P1, g.id("tech"), "assist", { selected: { ally: [g.id("ally")] } });
  refused(() => actRaw(g.engine, P1, g.id("tech"), "assist", { ally: [g.id("ally2")] }), "the tech is depleted by its first ASSIST");
  assert.equal(isDepleted(g.engine, g.id("ally2")), true);
});

clause(TECH, "0:rule", "'attack only once each turn' says nothing about blocking: it can block", () => {
  const g = techBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [g.id("tech")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("tech")]);
});

clause(SHINY, "0:ability", "a picked character can be protected even when it has just taken damage this turn: only the NEXT damage after Tiny Shiny resolves is reduced", () => {
  const g = shinyBoard({ extra: zaps(3, 3) });
  zap(g, "zap0", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 3);
  shiny(g);
  zap(g, "zap1", "c");
  assert.equal(damageOf(g.engine, g.id("c")), 4, "3 earlier + (3 - 2) now");
});

clause(LEET, "0:rule", "it adds to icons already boosted this turn by another effect: Elitism from resources, an Aide and 31337! all count", () => {
  const g = leetBoard({ elitism: 1, greed: 2, extra: [{ key: "aide", def: printing(AIDE), owner: P1, zone: "play" }] });
  assert.equal(elitism(g.engine), 2);
  leet(g);
  assert.equal(elitism(g.engine), 6);
});

clause(AIDE, "1:rule", "the picked resource can be any of my attached resources, including one that was attached by paying for the Aide's own deployment", () => {
  const g = devBoard([{ key: "aide", def: printing(AIDE), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]);
  // the extra seats' turn starts would also offer the pick (each opponent's turn): they sit out of the rotation here
  g.engine.state.turnOrder = g.engine.state.turnOrder.filter((id) => id === P1 || id === P2);
  playAndResolve(g.engine, P1, g.id("aide"));
  assert.equal(attachedCount(g.engine, P1), 4, "setup: the 4 resources I paid are attached");
  endTurn(g.engine, P1);
  const pc = expectPending(g.engine, "selectTargets");
  assert.equal(pc.playerId, P1);
  const attached = playOf(g.engine, P1).filter((id) => g.engine.isResource(id) && isAttached(g.engine, id));
  answerPending(g.engine, "selectTargets", { selected: { res: [attached[0]] } });
  assert.equal(attachedCount(g.engine, P1), 3);
});

// =============================================================================
// Extra probes, round three
// =============================================================================

clause(GOLEM, "0:ability", "'Choose a number for X' is a cost: playing without choosing any number is refused instead of silently using X = 0", () => {
  const g = golemBoard();
  refused(() => playRaw(g.engine, P1, g.id("g"), {}), "no number was chosen for X");
  assert.equal(zoneOf(g.engine, g.id("g")), "hand");
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

// =============================================================================
// Extra probes, round four (from the official mutation sweep)
// =============================================================================

clause(INVENTION, "1:rule", "an Elitism leaving play (returned to hand, or destroyed) does not 'enter play': no offer", () => {
  const extra = (): CardPlacement[] => [
    { key: "inPlayE", def: elitismCard(), owner: P1, zone: "play" },
    { key: "toHand", def: moverTactic("hand"), owner: P1, zone: "hand" },
    { key: "toDiscard", def: moverTactic("discard"), owner: P1, zone: "hand" }
  ];
  const bounced = recurBoard({ extra: extra() });
  playAndResolve(bounced.engine, P1, bounced.id("toHand"), { selected: { t: [bounced.id("inPlayE")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("inPlayE")), "hand", "setup: it left play");
  assert.equal(bounced.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(bounced.engine, bounced.id("ai")), "discard");
  const destroyed = recurBoard({ extra: extra() });
  playAndResolve(destroyed.engine, P1, destroyed.id("toDiscard"), { selected: { t: [destroyed.id("inPlayE")] } });
  assert.equal(zoneOf(destroyed.engine, destroyed.id("inPlayE")), "discard", "setup: it left play");
  assert.equal(destroyed.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(destroyed.engine, destroyed.id("ai")), "discard");
});

clause(INVENTION, "1:rule", "an Elitism moving between zones other than into play (deck to hand, hand to discard pile) gives no offer", () => {
  const deckToHand = tactic({
    name: "Deck To Hand",
    cost: 0,
    behavior: { abilities: [{ id: "dth", type: "activated", targets: [{ id: "t", selector: { zone: "deck", owner: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const g = recurBoard({
    extra: [
      { key: "deckE", def: elitismCard(), owner: P1, zone: "deck" },
      { key: "dth", def: deckToHand, owner: P1, zone: "hand" },
      { key: "handToDiscard", def: tactic({ name: "Discard Elitism", cost: 0, behavior: { abilities: [{ id: "hd", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", name: "Elitism" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] } }), owner: P1, zone: "hand" }
    ]
  });
  playAndResolve(g.engine, P1, g.id("dth"), { selected: { t: [g.id("deckE")] } });
  assert.equal(zoneOf(g.engine, g.id("deckE")), "hand", "setup: it moved from the deck to my hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
  playAndResolve(g.engine, P1, g.id("handToDiscard"), { selected: { t: [g.id("deckE")] } });
  assert.equal(zoneOf(g.engine, g.id("deckE")), "discard", "setup: and then to my discard pile");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ai")), "discard");
});

// =============================================================================
// Extra probes, round five (from the official mutation sweep)
// =============================================================================

clause(POSH, "0:unique", "the designation is POSHERNACLE: another card carrying UNIQUE POSHERNACLE conflicts with it, and a card with a different designation does not", () => {
  const same = poshBoard({
    active: P1,
    extra: [{ key: "twin", def: location({ name: "Poshernacle Twin", unique: "poshernacle", cost: 0 } as Partial<CardDefinition>), owner: P1, zone: "hand" }]
  });
  playRaw(same.engine, P1, same.id("twin"));
  resolvePendingResponses(same.engine);
  const pc = expectPending(same.engine, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [same.id("pn"), same.id("twin")].sort());
  const different = poshBoard({
    active: P1,
    extra: [{ key: "other", def: location({ name: "Other Place", unique: "something else", cost: 0 } as Partial<CardDefinition>), owner: P1, zone: "hand" }]
  });
  playRaw(different.engine, P1, different.id("other"));
  resolvePendingResponses(different.engine);
  assert.equal(different.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(different.engine, different.id("other")), "play");
  assert.equal(zoneOf(different.engine, different.id("pn")), "play");
});
