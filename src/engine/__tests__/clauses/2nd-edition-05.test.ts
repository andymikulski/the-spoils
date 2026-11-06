// Clause tests — batch 2nd-edition-05. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-05`. Expectations come from each
// card's PRINTED text (2nd Edition printing) and RULES.md / the Comprehensive
// Rules; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as baseBuildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { developDraw, developResource, endTurn, factionOf, spentResources } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

/** `buildGame` with a fixed random source, so shuffles, coin flips and random picks are deterministic (tests that assert a shuffle pass their own). */
const buildGame = (options: Parameters<typeof baseBuildGame>[0] = {}) => baseBuildGame({ ...options, random: options.random ?? (() => 0.5) });

type Pid = typeof P1 | typeof P2;
type Def = CardDefinition;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const hand = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const playOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].play;
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const ownerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].ownerId;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const stat = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const attachedResources = (engine: SpoilsEngine, player: Pid) =>
  playOf(engine, player).filter((id) => engine.isResource(id) && engine.state.cards[id].attachedTo === factionOf(engine, player));

/** Raw `activateAbility` WITHOUT draining the response window. */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pick(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

/** Same as `pick` but WITHOUT draining the response window (for refusal checks). */
function pickRaw(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `chooserSelectsOption` choice with the option whose label matches `pattern`. */
function chooseOption(engine: SpoilsEngine, pattern: RegExp, player?: Pid): void {
  const pc = pending(engine) as unknown as { kind: string; playerId: string; options: Array<{ label?: string }> } | undefined;
  assert.equal(pc?.kind, "chooserSelectsOption", "an option choice is open");
  const index = pc!.options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern} (have ${pc!.options.map((option) => option.label).join(" | ")})`);
  engine.perform({ type: "resolvePendingChoice", playerId: player ?? (pc!.playerId as Pid), choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
}

/** The option labels of the open `chooserSelectsOption` choice. */
const optionLabels = (engine: SpoilsEngine): string[] =>
  ((pending(engine) as unknown as { options?: Array<{ label?: string }> } | undefined)?.options ?? []).map((option) => option.label ?? "");

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A free tactic with no targets and no effect (just "a card was played"). */
const blankTactic = (name = "Blank"): Def => tactic({ name, cost: 0, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } });

/** A free tactic that destroys one picked card of the given type in play (id `k`, declaration `t`). */
function destroyTactic(type: "character" | "item" | "location" = "character", name = `Destroy ${type}`): Def {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
}

/** A free tactic that sends one picked card of `type` in play somewhere (id `s`, declaration `t`). */
function sendTactic(to: "discard" | "hand" | "deck" | "void" | "destroy" | "remove", type: "character" | "item" | "resource" | "location" = "character"): Def {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({
    name: `Send-${to}-${type}`,
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [effect] }] }
  });
}

/** A free tactic that puts one picked card of `type` from my discard pile into play under my control (id `r`, declaration `t`). */
const reviveTactic = (type: "item" | "character" | "location" = "item"): Def =>
  tactic({
    name: `Revive-${type}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });

/** An item with a "pay N" ability (id `a`) that gains its controller 1 influence. */
const payItem = (cost: number, name = "PayItem"): Def =>
  item({ name, behavior: { abilities: [{ id: "a", type: "activated", costs: [{ type: "payResources", amount: cost }], effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] } });

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
const bounceTactic = (): Def =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

/** A free tactic that deals `amount` damage to one picked character (id `dmg`, declaration `t`). */
const damageTactic = (amount: number, name = `Smite${amount}`): Def =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "dmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });

/** A free tactic that reduces its controller's next numeric cost this turn by `amount` (id `red`). */
const reduceTactic = (amount: number): Def =>
  tactic({ name: `Reduce${amount}`, cost: 0, behavior: { abilities: [{ id: "red", type: "activated", effects: [{ type: "reduceNextCost", player: "controller", amount }] }] } });

/** A free tactic that grants COVERT to one picked character until end of turn (id `grant`, declaration `t`). */
const grantCovertTactic = (): Def =>
  tactic({
    name: "Grant covert",
    cost: 0,
    behavior: {
      abilities: [
        { id: "grant", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }] }
      ]
    }
  });

/** A character with a "when this enters play, you draw a card" trigger (a witness for 'did it enter play'). */
const drawOnEnter = (name = "Greeter", over: Partial<Def> = {}): Def =>
  character({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] },
    ...over
  });

/** A covert character with the given name. */
const covertChar = (name: string, over: Partial<Def> = {}): Def => character({ name, behavior: { keywords: ["covert"] }, ...over });

/**
 * Deploy-cost checks shared by every card: a card with printed cost `cost` and
 * threshold `iconCount` x `icon` is deployed for exactly `cost` resources when the
 * threshold is met; the threshold is a gate (icons are never spent).
 */
interface DeploySpec {
  printingId: string;
  cost: number;
  icon: StapleIcon;
  iconCount: number;
  /** Extra placements (hosts, etc.) and the `selected` to pass when playing. */
  extra?: CardPlacement[];
  selected?: (id: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]>;
  variables?: Record<string, number>;
  /** Where the card ends up on resolution (default "play"). */
  ends?: "play" | "discard";
  /** Answer for any pending choice the deploy raises (default `declineAll`). */
  answer?: (pc: PendingChoiceLike) => unknown;
}

function deployBoard(spec: DeploySpec, main: number, others: number) {
  const otherIcon: StapleIcon = spec.icon === "greed" ? "rage" : "greed";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(spec.printingId), owner: P1, zone: "hand" },
      ...(spec.extra ?? []),
      ...bank(spec.icon, main, P1),
      ...bank(otherIcon, others, P1)
    ]
  });
}

function deployExact(spec: DeploySpec) {
  const need = Math.max(spec.cost, spec.iconCount);
  const { engine, id } = deployBoard(spec, need, 0);
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, true, "playable with exactly enough resources and icons");
  const before = ready(engine);
  play(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {}, variables: spec.variables });
  drain(engine, spec.answer ?? declineAll);
  assert.equal(zoneOf(engine, id("card")), spec.ends ?? "play");
  assert.equal(before - ready(engine), spec.cost, `the printed cost of ${spec.cost} is paid`);
}

function deployShort(spec: DeploySpec) {
  const need = Math.max(spec.cost, spec.iconCount);
  const { engine, id } = deployBoard(spec, need - 1, 0);
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, false, "one resource short: not playable");
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {}, variables: spec.variables }), "one resource short of the cost / threshold");
  assert.equal(zoneOf(engine, id("card")), "hand", "a refused play leaves the card in hand");
  assert.equal(ready(engine), before, "nothing was paid");
}

function deployWrongIcons(spec: DeploySpec) {
  const { engine, id } = deployBoard(spec, 0, spec.cost + spec.iconCount + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "no matching icons: the threshold is not met");
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {}, variables: spec.variables }), "plenty of resources of the wrong icon");
  assert.equal(zoneOf(engine, id("card")), "hand");
}

function deployIconShort(spec: DeploySpec) {
  const { engine, id } = deployBoard(spec, spec.iconCount - 1, spec.cost + spec.iconCount + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "one icon short of the threshold");
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {}, variables: spec.variables }), "one icon short of the threshold, with plenty of other resources");
  assert.equal(zoneOf(engine, id("card")), "hand");
}

function deployThresholdIsAGate(spec: DeploySpec) {
  // the icons are never spent: with exactly the icons needed AND extra resources, the icons stay available afterwards
  const { engine, id } = deployBoard(spec, spec.iconCount + spec.cost, 0);
  play(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {}, variables: spec.variables });
  drain(engine, spec.answer ?? declineAll);
  assert.equal(ready(engine), spec.iconCount, "only the numeric cost is spent; the threshold icons are a gate");
}

/** The full printed-cost / threshold battery for a card. */
function deployBattery(spec: DeploySpec) {
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  deployThresholdIsAGate(spec);
}

// =============================================================================
// Omnidirectional Patrolmajig
// If you are attacked, you may restore this card.
// Character (majig, gearsmith), cost 6, threshold [E], 3 strength / 6 life / 2 speed.
// =============================================================================

const OP = "c65e07bb-7f22-4ad7-8af6-ff953ef1bc2d";

function opBoard(opts: { depleted?: boolean; opZone?: "play" | "hand"; active?: Pid; extra?: CardPlacement[]; oppOp?: boolean; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "op", def: printing(OP), owner: P1, zone: opts.opZone ?? "play", depleted: opts.depleted ?? true, faceDown: opts.faceDown },
      { key: "tired", def: character({ name: "Tired", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 6 }), owner: P1, zone: "play" },
      { key: "atk1", def: character({ name: "Atk1", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "oloc", def: location({ name: "OLoc", structure: 6 }), owner: P2, zone: "play" },
      ...(opts.oppOp ? [{ key: "oop", def: printing(OP), owner: P2, zone: "play" as const, depleted: true }] : []),
      ...(opts.extra ?? [])
    ]
  });
}

type OpBoard = ReturnType<typeof opBoard>;

const attackFaction = (b: OpBoard, attacker: Pid, keys: string[]) =>
  b.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: keys.map(b.id), target: { type: "faction", playerId: other(attacker) } });
const attackCard = (b: OpBoard, attacker: Pid, keys: string[], targetKey: string) =>
  b.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: keys.map(b.id), target: { type: "card", cardId: b.id(targetKey) } });

clause(OP, "0:rule", "when I am attacked while it is depleted I am offered the choice to restore it, before blockers are declared", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open right after the attack is declared");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Patrolmajig's controller (the defender) decides");
  assert.ok(optionLabels(b.engine).some((label) => /restore/i.test(label)), "one option restores the card");
  assert.equal(isDepleted(b.engine, b.id("op")), true, "still depleted until I choose");
  assert.notEqual(battleOf(b.engine)?.phase, "blocking", "blockers are not being declared yet");
});

clause(OP, "0:rule", "accepting restores it, and the restored Patrolmajig can then block", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, /restore/i);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b.engine, b.id("op")), false, "restored");
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("op")]);
});

clause(OP, "0:rule", "declining ('may') leaves it depleted, so it cannot block", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, /decline/i);
  assert.equal(isDepleted(b.engine, b.id("op")), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] }), "a depleted character cannot block");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("mine")], "control: another character blocks");
});

clause(OP, "0:rule", "only the defender's Patrolmajig decides: the attacker cannot answer the choice", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 0 } } as never),
    "the attacker cannot decide for me",
    /not your decision/
  );
  assert.equal(isDepleted(b.engine, b.id("op")), true);
  assert.ok(pending(b.engine), "the choice is still open");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(OP, "0:rule", "also triggers when the attack targets a location I control (I am attacked)", () => {
  const b = opBoard();
  attackCard(b, P2, ["atk1"], "loc");
  const pc = pending(b.engine);
  assert.ok(pc, "a location I control is the target of the attack");
  assert.equal(pc.playerId, P1);
  chooseOption(b.engine, /restore/i);
  assert.equal(isDepleted(b.engine, b.id("op")), false);
});

clause(OP, "0:rule", "if I am attacked while it is already restored, the literal text still lets me 'restore' it (nothing to change), and the battle goes on with it able to block", () => {
  const b = opBoard({ depleted: false });
  attackFaction(b, P2, ["atk1"]);
  // the printed text has no "and this card is depleted" clause: the trigger is "if you are attacked"
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b.engine, b.id("op")), false);
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("op")]);
});

clause(OP, "0:rule", "a ready Patrolmajig is still offered the optional restore when I am attacked (the printed trigger has no depleted condition)", () => {
  const b = opBoard({ depleted: false });
  attackFaction(b, P2, ["atk1"]);
  const pc = pending(b.engine);
  assert.ok(pc, "'If you are attacked, you may restore this card.' fires on being attacked, whatever the card's state");
  assert.equal(pc.playerId, P1);
  assert.ok(optionLabels(b.engine).some((label) => /restore/i.test(label)), "optionLabels(b.engine).some((label) => /restore/i.test(label))");
});

clause(OP, "0:rule", "a party of several attackers still gives exactly one offer", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1", "atk2"]);
  chooseOption(b.engine, /restore/i);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second offer");
  assert.equal(isDepleted(b.engine, b.id("op")), false);
});

clause(OP, "0:rule", "restores only itself: another depleted character of mine stays depleted", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, /restore/i);
  assert.equal(isDepleted(b.engine, b.id("tired")), true);
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("tired")] }), "control: the other depleted character still cannot block");
});

clause(OP, "0:rule", "when I attack, I am not 'attacked': my depleted Patrolmajig is not offered a restore", () => {
  const b = opBoard({ active: P1 });
  attackFaction(b, P1, ["mine"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b.engine, b.id("op")), true);
});

clause(OP, "0:rule", "when I attack the opponent's location, I am still not the one being attacked", () => {
  const b = opBoard({ active: P1 });
  attackCard(b, P1, ["mine"], "oloc");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b.engine, b.id("op")), true);
});

clause(OP, "0:rule", "the opponent's own Patrolmajig works for them when I attack: its controller is offered the restore, not me", () => {
  const b = opBoard({ active: P1, oppOp: true });
  attackFaction(b, P1, ["mine"]);
  const pc = pending(b.engine);
  assert.ok(pc, "the defender (the opponent) is offered a restore");
  assert.equal(pc.playerId, P2);
  chooseOption(b.engine, /restore/i);
  assert.equal(isDepleted(b.engine, b.id("oop")), false);
  assert.equal(isDepleted(b.engine, b.id("op")), true, "mine, depleted, is not touched by an attack I made");
});

clause(OP, "0:rule", "'you' is the controller: a Patrolmajig I own but the opponent controls is offered to the opponent when they are attacked, not to me", () => {
  const b = opBoard({ active: P1, extra: [{ key: "stolen", def: printing(OP), owner: P1, controller: P2, zone: "play", depleted: true }] });
  attackFaction(b, P1, ["mine"]);
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent is attacked and controls a Patrolmajig");
  assert.equal(pc.playerId, P2, "its controller decides");
  chooseOption(b.engine, /restore/i);
  assert.equal(isDepleted(b.engine, b.id("stolen")), false);
});

clause(OP, "0:rule", "not in play, it does nothing: a Patrolmajig in my hand raises no choice", () => {
  const b = opBoard({ opZone: "hand" });
  attackFaction(b, P2, ["atk1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(OP, "0:rule", "a face-down Patrolmajig is only a resource: it is not offered a restore", () => {
  const b = opBoard({ faceDown: true });
  attackFaction(b, P2, ["atk1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  resolvePendingResponses(b.engine);
  assert.equal(battleOf(b.engine)?.phase, "blocking");
});

clause(OP, "0:rule", "every attack on me offers it again: after blocking (and being depleted by the battle) a second attack offers another restore", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, /restore/i);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("op")), true, "surviving battle characters are depleted (CR 609.1h)");
  attackFaction(b, P2, ["atk2"]);
  const pc = pending(b.engine);
  assert.ok(pc, "attacked again: another offer");
  chooseOption(b.engine, /restore/i);
  assert.equal(isDepleted(b.engine, b.id("op")), false);
});

clause(OP, "0:rule", "two Patrolmajigs are each offered their own restore", () => {
  const b = opBoard({ extra: [{ key: "op2", def: printing(OP), owner: P1, zone: "play", depleted: true }] });
  attackFaction(b, P2, ["atk1"]);
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
    return declineAll(pc);
  });
  assert.equal(isDepleted(b.engine, b.id("op")), false);
  assert.equal(isDepleted(b.engine, b.id("op2")), false);
});

clause(OP, "0:rule", "two Patrolmajigs: declining one and restoring the other restores only the one accepted", () => {
  const b = opBoard({ extra: [{ key: "op2", def: printing(OP), owner: P1, zone: "play", depleted: true }] });
  attackFaction(b, P2, ["atk1"]);
  let first = true;
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") {
      const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
      const want = first ? /decline/i : /restore/i;
      first = false;
      return { kind: "chooserSelectsOption", index: options.findIndex((o) => want.test(o.label ?? "")) };
    }
    return declineAll(pc);
  });
  const restored = ["op", "op2"].filter((key) => !isDepleted(b.engine, b.id(key)));
  assert.equal(restored.length, 1, "exactly one of the two was restored");
});

clause(OP, "0:rule", "costs 6 with [E] and has printed stats 3/6/2 and the majig subtype", () => {
  const spec: DeploySpec = { printingId: OP, cost: 6, icon: "elitism", iconCount: 1 };
  deployBattery(spec);
  const b = opBoard();
  assert.deepEqual(stat(b.engine, b.id("op")), [3, 6, 2]);
  assert.deepEqual(b.engine.getSubtypes(b.id("op")), ["majig"]);
  assert.equal(b.engine.getDefinition(b.id("op")).trade, "gearsmith");
});

// =============================================================================
// Patent Enforcement
// COST: Play this only in response to an item being played. Pay X, where X is
// its numeric cost. EFFECT: The item enters play under your control.
// Tactic (gearsmith), cost 0, threshold [E][E][E].
// =============================================================================

const PATENT = "d6694e74-095c-4976-88f2-1414cc9b9f62";

const etbDraw = (name: string, cost: number): Def =>
  item({
    name,
    cost,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function patentBoard(opts: { itemCost?: number; elitism?: number; greed?: number; active?: Pid; extra?: CardPlacement[]; oppGreed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "pe", def: printing(PATENT), owner: P1, zone: "hand" },
      { key: "oi", def: item({ name: "OppItem", cost: opts.itemCost ?? 3 }), owner: P2, zone: "hand" },
      { key: "oc", def: character({ name: "OppChar", cost: 2 }), owner: P2, zone: "hand" },
      { key: "ol", def: location({ name: "OppLoc", cost: 2 }), owner: P2, zone: "hand" },
      { key: "ot", def: tactic({ name: "OppTactic", cost: 2, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      { key: "mine", def: item({ name: "MineItem", cost: 2 }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", opts.oppGreed ?? 10, P2),
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 starts playing `key`; returns once P1 may respond. */
const opponentPlays = (b: ReturnType<typeof patentBoard>, key: string) => playRaw(b.engine, P2, b.id(key));

for (const cost of [0, 1, 3, 5]) {
  clause(PATENT, "0:ability", `in response to a cost-${cost} item: pays exactly ${cost} (the item's numeric cost) and the item enters play under my control`, () => {
    const b = patentBoard({ itemCost: cost });
    opponentPlays(b, "oi");
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).playable, true, "playable in response to an item");
    const before = ready(b.engine);
    playRaw(b.engine, P1, b.id("pe"));
    assert.equal(before - ready(b.engine), cost, "X = the item's numeric cost, paid when the tactic is played");
    resolvePendingResponses(b.engine);
    assert.equal(zoneOf(b.engine, b.id("oi")), "play", "the item entered play");
    assert.equal(controllerOf(b.engine, b.id("oi")), P1, "under my control");
    assert.equal(ownerOf(b.engine, b.id("oi")), P2, "ownership never changes");
    assert.equal(zoneOf(b.engine, b.id("pe")), "discard", "the tactic goes to its owner's discard pile");
    assert.equal(playOf(b.engine, P1).includes(b.id("oi")), true);
    assert.equal(playOf(b.engine, P2).includes(b.id("oi")), false, "the opponent does not get it");
  });
}

clause(PATENT, "0:ability", "the cost is paid when the tactic is played (before responses), the item changes hands only when it resolves", () => {
  const b = patentBoard({ itemCost: 3 });
  opponentPlays(b, "oi");
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("pe"));
  assert.equal(before - ready(b.engine), 3, "X is paid up front");
  assert.notEqual(zoneOf(b.engine, b.id("oi")), "play", "the item has not entered play yet");
  assert.equal(attachedResources(b.engine, P1).length, 3, "paid by attaching 3 resources to my faction");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
});

clause(PATENT, "0:ability", "the opponent keeps having paid for the item, and I do not pay for it twice: their resources stay attached, mine are down by exactly X", () => {
  const b = patentBoard({ itemCost: 3 });
  const oppReadyBefore = ready(b.engine, P2);
  opponentPlays(b, "oi");
  const oppReadyAfterPlay = ready(b.engine, P2);
  assert.equal(oppReadyBefore - oppReadyAfterPlay, 3, "the opponent paid 3 to play the item");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  assert.equal(ready(b.engine, P2), oppReadyAfterPlay, "taking the item does not refund or recharge the opponent");
  assert.equal(ready(b.engine, P1), 5, "8 - X (3)");
});

clause(PATENT, "0:ability", "the opponent's item does not enter play for the opponent: its enters-play trigger works for me, and the opponent gets nothing", () => {
  const b = patentBoard({ itemCost: 2, extra: [{ key: "oetb", def: etbDraw("OppEtb", 2), owner: P2, zone: "hand" }] });
  const myHand = hand(b.engine, P1).length;
  const oppHand = hand(b.engine, P2).length;
  opponentPlays(b, "oetb");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("oetb")), "play");
  assert.equal(controllerOf(b.engine, b.id("oetb")), P1);
  assert.equal(hand(b.engine, P1).length, myHand - 1 + 1, "I played the tactic and drew from the item's trigger");
  assert.equal(hand(b.engine, P2).length, oppHand - 1, "the opponent only lost the item from hand: no draw for them");
});

clause(PATENT, "0:ability", "the stolen item is mine to use: I can activate its ability, the opponent cannot", () => {
  const ping = item({ name: "Pinger", cost: 1, behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const b = patentBoard({ extra: [{ key: "ping", def: ping, owner: P2, zone: "hand" }] });
  opponentPlays(b, "ping");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ping")), "play");
  const handBefore = hand(b.engine, P1).length;
  refused(() => activateRaw(b.engine, P2, b.id("ping"), "ping"), "the opponent no longer controls it");
  endTurn(b.engine, P2);
  activate(b.engine, P1, b.id("ping"), "ping");
  assert.equal(hand(b.engine, P1).length, handBefore + 1, "I used the item's ability");
});

clause(PATENT, "0:ability", "the item stays the opponent's card: destroyed, it goes to its OWNER's discard pile", () => {
  const b = patentBoard({ extra: [{ key: "kill", def: destroyTactic("item"), owner: P1, zone: "hand" }] });
  opponentPlays(b, "oi");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  endTurn(b.engine, P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("oi")] } });
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
  assert.equal(discardOf(b.engine, P2).includes(b.id("oi")), true, "the owner's discard pile");
  assert.equal(discardOf(b.engine, P1).includes(b.id("oi")), false);
});

clause(PATENT, "0:ability", "only in response to an ITEM: refused when the opponent is playing a character, a location or a tactic", () => {
  for (const key of ["oc", "ol", "ot"]) {
    const b = patentBoard();
    opponentPlays(b, key);
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).playable, false, `not playable against ${key}`);
    const before = ready(b.engine);
    refused(() => playRaw(b.engine, P1, b.id("pe")), `responding to ${key}`);
    assert.equal(zoneOf(b.engine, b.id("pe")), "hand");
    assert.equal(ready(b.engine), before, "nothing was paid");
  }
  const control = patentBoard();
  opponentPlays(control, "oi");
  playRaw(control.engine, P1, control.id("pe"));
  assert.equal(zoneOf(control.engine, control.id("pe")) === "deploying" || zoneOf(control.engine, control.id("pe")) === "discard", true, "control: against an item it works");
});

clause(PATENT, "0:ability", "only in response to something being played: with nothing on the stack (my own turn, or the opponent's idle turn) it is refused", () => {
  const mine = patentBoard({ active: P1 });
  assert.equal(mine.engine.getCardPlayability(P1, mine.id("pe")).playable, false);
  refused(() => playRaw(mine.engine, P1, mine.id("pe")), "my own turn, nothing to respond to");
  assert.equal(zoneOf(mine.engine, mine.id("pe")), "hand");
  const idle = patentBoard({ active: P2 });
  refused(() => playRaw(idle.engine, P1, idle.id("pe")), "opponent's turn but nothing played");
  assert.equal(zoneOf(idle.engine, idle.id("pe")), "hand");
  assert.equal(ready(idle.engine), 8, "nothing was paid");
});

clause(PATENT, "0:ability", "an item whose play has resolved can no longer be stolen: after the response window closes the tactic is refused", () => {
  const b = patentBoard();
  opponentPlays(b, "oi");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
  // open a real window (P2 deploys another card) so only the Patent's own condition can refuse it
  opponentPlays(b, "oc");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 holds priority in an open window");
  refused(() => playRaw(b.engine, P1, b.id("pe")), "the item is already in play, only a character is being played", /cannot be deployed right now/);
  assert.equal(controllerOf(b.engine, b.id("oi")), P2);
});

clause(PATENT, "0:ability", "I cannot use it against my own item (you cannot respond to your own actions)", () => {
  const b = patentBoard({ active: P1, extra: [{ key: "pe2", def: printing(PATENT), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("mine"));
  // "not your priority" is exactly the right reason here (CR 607.1: you cannot respond to your own action)
  refused(() => playRaw(b.engine, P1, b.id("pe")), "my own item: I hold no priority to respond to my own action", /priority/);
  assert.equal(zoneOf(b.engine, b.id("pe")), "hand");
  assert.equal(["deploying", "play"].includes(zoneOf(b.engine, b.id("mine"))), true);
});

clause(PATENT, "0:ability", "the opponent can use it too, against an item I play (on my turn)", () => {
  const b = patentBoard({ active: P1, extra: [{ key: "pe2", def: printing(PATENT), owner: P2, zone: "hand" }, ...bank("elitism", 8, P2)] });
  playRaw(b.engine, P1, b.id("mine"));
  playRaw(b.engine, P2, b.id("pe2"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(controllerOf(b.engine, b.id("mine")), P2, "stolen by the opponent");
  assert.equal(ownerOf(b.engine, b.id("mine")), P1);
  assert.equal(playOf(b.engine, P1).includes(b.id("mine")), false);
});

clause(PATENT, "0:ability", "X must be affordable: a cost-4 item with only 3 resources is refused (nothing paid), 4 is enough", () => {
  const short = patentBoard({ itemCost: 4, elitism: 3 });
  opponentPlays(short, "oi");
  refused(() => playRaw(short.engine, P1, short.id("pe")), "3 resources for X = 4");
  assert.equal(ready(short.engine), 3);
  assert.equal(zoneOf(short.engine, short.id("pe")), "hand");
  const enough = patentBoard({ itemCost: 4, elitism: 4 });
  opponentPlays(enough, "oi");
  playRaw(enough.engine, P1, enough.id("pe"));
  resolvePendingResponses(enough.engine);
  assert.equal(controllerOf(enough.engine, enough.id("oi")), P1);
  assert.equal(ready(enough.engine), 0);
});

clause(PATENT, "0:ability", "needs [E][E][E]: with only two [E] (and plenty of other resources) or none it is refused", () => {
  for (const [elitism, greed] of [[2, 8], [0, 10]]) {
    const b = patentBoard({ itemCost: 2, elitism, greed });
    opponentPlays(b, "oi");
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).thresholdMet, false);
    refused(() => playRaw(b.engine, P1, b.id("pe")), `${elitism} elitism`);
    assert.equal(zoneOf(b.engine, b.id("pe")), "hand");
  }
  const ok = patentBoard({ itemCost: 0, elitism: 3 });
  opponentPlays(ok, "oi");
  playRaw(ok.engine, P1, ok.id("pe"));
  resolvePendingResponses(ok.engine);
  assert.equal(controllerOf(ok.engine, ok.id("oi")), P1, "exactly [E][E][E] is enough; the icons are a gate and X = 0 costs nothing");
  assert.equal(ready(ok.engine), 3, "the icons were not spent");
});

clause(PATENT, "0:ability", "the printed cost is 0: apart from X nothing else is paid", () => {
  const b = patentBoard({ itemCost: 2, elitism: 5 });
  opponentPlays(b, "oi");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  assert.equal(ready(b.engine), 3, "5 resources - X (2) = 3");
});

clause(PATENT, "0:ability", "X is the item's numeric cost while it is being played (CR 406.3): an item the opponent got a reduction on costs the reduced amount", () => {
  const b = patentBoard({ itemCost: 5, extra: [{ key: "red", def: reduceTactic(3), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("red"));
  const oppBefore = ready(b.engine, P2);
  opponentPlays(b, "oi");
  assert.equal(oppBefore - ready(b.engine, P2), 2, "the opponent paid 5 - 3 = 2 for the item");
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("pe"));
  assert.equal(before - ready(b.engine), 2, "X = the item's numeric cost while being played = 2 (CR 406.3), not its printed 5");
});

// =============================================================================
// Runic Circuitry
// This card enters play with 2 tokens on it.
// CONSTRUCT -- COST: Pay 3. Deplete this card. EFFECT: Remove a token from this card.
// POWER-UP -- COST: Use this only if there are no tokens on this card. Deplete this
// card. EFFECT: Reduce the next numeric cost you pay this turn by 3
// Item (gearsmith), cost 1, threshold [E][E].
// =============================================================================

const CIRCUITRY = "b0a0e3bc-bc5e-40c8-80d3-cf331941355b";

function circuitryBoard(opts: { zone?: "hand" | "play" | "discard"; tokens?: number; elitism?: number; greed?: number; depleted?: boolean; active?: Pid; faceDown?: boolean; circuits?: number } = {}) {
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ci", def: printing(CIRCUITRY), owner: P1, zone, counters: zone === "play" && opts.tokens ? { token: opts.tokens } : undefined, depleted: opts.depleted, faceDown: opts.faceDown },
      { key: "other", def: printing(CIRCUITRY), owner: P1, zone: "play", counters: { token: 1 } },
      ...(opts.circuits === 2 ? [{ key: "ci2", def: printing(CIRCUITRY), owner: P1, zone: "play" as const, counters: {} }] : []),
      { key: "c5", def: character({ name: "Cost5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c5b", def: character({ name: "Cost5b", cost: 5 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "Item5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Cost2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "c4", def: character({ name: "Cost4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "Cost6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "t3", def: tactic({ name: "Tac3", cost: 3, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "payItem", def: payItem(3), owner: P1, zone: "play" },
      { key: "revive", def: reviveTactic("item"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "item"), owner: P1, zone: "hand" },
      { key: "smash", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "oppItem", def: item({ name: "OppItem", cost: 4 }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("elitism", 12, P2),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(CIRCUITRY, "0:rule", "deployed from my hand it enters play with exactly 2 tokens, and pays its printed cost of 1", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  assert.equal(tokensOn(engine, id("ci")), 0, "none in hand");
  const before = ready(engine);
  play(engine, P1, id("ci"), {});
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2, "2 tokens");
  assert.equal(before - ready(engine), 1, "cost 1");
  assert.equal(tokensOn(engine, id("other")), 1, "another Circuitry's tokens are untouched");
});

clause(CIRCUITRY, "0:rule", "put into play by an effect (not deployed) it also enters with exactly 2 tokens", () => {
  const { engine, id } = circuitryBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2);
});

clause(CIRCUITRY, "0:rule", "it enters play untapped (not depleted)", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  play(engine, P1, id("ci"), {});
  assert.equal(isDepleted(engine, id("ci")), false);
});

clause(CIRCUITRY, "0:rule", "each Circuitry gets its own 2 tokens: a second copy entering does not change the first", () => {
  const { engine, id } = circuitryBoard({ zone: "hand", circuits: 2 });
  play(engine, P1, id("ci"), {});
  assert.equal(tokensOn(engine, id("ci")), 2);
  assert.equal(tokensOn(engine, id("ci2")), 0, "the copy already in play keeps its own count");
  assert.equal(tokensOn(engine, id("other")), 1);
});

clause(CIRCUITRY, "0:rule", "the tokens are not given again later: a Circuitry already in play does not gain tokens at the start of a turn", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 1 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("ci")), 1);
});

clause(CIRCUITRY, "0:rule", "played face-down as a resource it is only a resource: no tokens are put on it", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  developResource(engine, P1, id("ci"), true);
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(engine.state.cards[id("ci")].faceDown, true);
  assert.equal(tokensOn(engine, id("ci")), 0, "a face-down card has no rules text (CR 411.1)");
});

clause(CIRCUITRY, "0:rule", "its tokens disappear when it leaves play (CR 409.2): back in hand it carries none", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 2 });
  play(engine, P1, id("bounce"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "hand");
  assert.equal(tokensOn(engine, id("ci")), 0);
});

clause(CIRCUITRY, "0:rule", "a Circuitry that left play and is deployed again enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "hand");
  play(engine, P1, id("ci"), {});
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2, "exactly 2: the old token disappeared when it left play");
});

clause(CIRCUITRY, "0:rule", "a destroyed Circuitry revived from the discard pile (put into play by an effect) enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 2 });
  play(engine, P1, id("smash"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "discard");
  play(engine, P1, id("revive"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2, "exactly 2, not 4");
});

clause(CIRCUITRY, "0:rule", "costs 1 with [E][E] (one short or one [E] short is refused) and is a plain item", () => {
  const spec: DeploySpec = { printingId: CIRCUITRY, cost: 1, icon: "elitism", iconCount: 2 };
  deployBattery(spec);
  const { engine, id } = circuitryBoard();
  assert.deepEqual(engine.getCardTypes(id("ci")), ["item"]);
  assert.equal(engine.getDefinition(id("ci")).trade, "gearsmith");
});

clause(CIRCUITRY, "1:ability:construct", "CONSTRUCT pays exactly 3, depletes the Circuitry and removes exactly one token", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(isDepleted(engine, id("ci")), true, "COST: Deplete this card");
  assert.equal(tokensOn(engine, id("ci")), 1, "2 - 1");
  assert.equal(tokensOn(engine, id("other")), 1, "another Circuitry's token is untouched");
});

clause(CIRCUITRY, "1:ability:construct", "the 3 and the deplete are paid when it is used; the token is removed only when it resolves", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  const before = ready(engine);
  activateRaw(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3);
  assert.equal(attachedResources(engine, P1).length, 3, "paid by attaching 3 resources to my faction");
  assert.equal(isDepleted(engine, id("ci")), true);
  assert.equal(tokensOn(engine, id("ci")), 2, "not yet");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("ci")), 1);
});

clause(CIRCUITRY, "1:ability:construct", "one use per turn (it depletes): refused while depleted; next turn it removes the last token", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  activate(engine, P1, id("ci"), "construct");
  const spent = ready(engine);
  refused(() => activateRaw(engine, P1, id("ci"), "construct"), "depleted: not twice in a turn");
  assert.equal(ready(engine), spent, "the refused use paid nothing");
  assert.equal(tokensOn(engine, id("ci")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(isDepleted(engine, id("ci")), false);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 0);
});

clause(CIRCUITRY, "1:ability:construct", "with no tokens left CONSTRUCT can still be used (cost paid) and the token count stays at 0", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3);
  assert.equal(tokensOn(engine, id("ci")), 0, "no negative tokens");
  assert.equal(isDepleted(engine, id("ci")), true);
});

clause(CIRCUITRY, "1:ability:construct", "is refused with only 2 resources (one short): nothing is depleted, paid or removed; exactly 3 works", () => {
  const short = circuitryBoard({ tokens: 2, elitism: 2 });
  refused(() => activateRaw(short.engine, P1, short.id("ci"), "construct"), "2 resources for pay 3");
  assert.equal(isDepleted(short.engine, short.id("ci")), false, "a failed payment does not deplete");
  assert.equal(tokensOn(short.engine, short.id("ci")), 2);
  assert.equal(ready(short.engine), 2);
  const exact = circuitryBoard({ tokens: 2, elitism: 3 });
  activate(exact.engine, P1, exact.id("ci"), "construct");
  assert.equal(tokensOn(exact.engine, exact.id("ci")), 1);
  assert.equal(ready(exact.engine), 0);
});

clause(CIRCUITRY, "1:ability:construct", "has no threshold of its own: 3 resources of any kind (no [E]) pay for it", () => {
  const { engine, id } = circuitryBoard({ tokens: 2, elitism: 0, greed: 3 });
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 1);
  assert.equal(ready(engine), 0);
});

clause(CIRCUITRY, "1:ability:construct", "already-depleted Circuitry cannot be used even with the resources (the deplete cost cannot be paid)", () => {
  const { engine, id } = circuitryBoard({ tokens: 2, depleted: true });
  const before = ready(engine);
  refused(() => activateRaw(engine, P1, id("ci"), "construct"), "depleted");
  assert.equal(ready(engine), before);
  assert.equal(tokensOn(engine, id("ci")), 2);
});

clause(CIRCUITRY, "1:ability:construct", "only its controller can use it: the opponent cannot, and it cannot be used from the hand", () => {
  const { engine, id } = circuitryBoard({ tokens: 2, active: P2 });
  refused(() => activateRaw(engine, P2, id("ci"), "construct"), "the opponent does not control it");
  assert.equal(tokensOn(engine, id("ci")), 2);
  assert.equal(isDepleted(engine, id("ci")), false);
  const inHand = circuitryBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("ci"), "construct"), "from hand");
});

clause(CIRCUITRY, "1:ability:construct", "a face-down Circuitry is only a resource: CONSTRUCT is not available", () => {
  const { engine, id } = circuitryBoard({ tokens: 2, faceDown: true });
  refused(() => activateRaw(engine, P1, id("ci"), "construct"), "face-down cards have no abilities", /Activated ability not found|face-down|not found/i);
  assert.equal(tokensOn(engine, id("ci")), 2);
});

clause(CIRCUITRY, "2:ability:powerup", "POWER-UP is refused while there are tokens on the card (2, then 1), and a refused use depletes nothing and reduces nothing", () => {
  for (const tokens of [2, 1]) {
    const { engine, id } = circuitryBoard({ tokens });
    refused(() => activateRaw(engine, P1, id("ci"), "powerup"), `${tokens} token(s)`);
    assert.equal(isDepleted(engine, id("ci")), false);
    const before = ready(engine);
    play(engine, P1, id("c5"), {});
    assert.equal(before - ready(engine), 5, "nothing was reduced");
  }
});

clause(CIRCUITRY, "2:ability:powerup", "with no tokens POWER-UP depletes the card and costs no resources", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "powerup");
  assert.equal(before - ready(engine), 0, "no resources paid");
  assert.equal(isDepleted(engine, id("ci")), true, "COST: Deplete this card");
  const free = circuitryBoard({ tokens: 0, elitism: 0 });
  activate(free.engine, P1, free.id("ci"), "powerup");
  assert.equal(isDepleted(free.engine, free.id("ci")), true, "usable with no resources at all");
});

clause(CIRCUITRY, "2:ability:powerup", "after the tokens are constructed away, POWER-UP becomes available (next turn, once restored)", () => {
  const { engine, id } = circuitryBoard({ tokens: 1 });
  refused(() => activateRaw(engine, P1, id("ci"), "powerup"), "a token is still on it");
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 0);
  refused(() => activateRaw(engine, P1, id("ci"), "powerup"), "the card is depleted by CONSTRUCT");
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("ci"), "powerup");
  assert.equal(isDepleted(engine, id("ci")), true);
  const before = ready(engine);
  play(engine, P1, id("c5"), {});
  assert.equal(before - ready(engine), 2);
});

clause(CIRCUITRY, "2:ability:powerup", "the next numeric cost I pay this turn is reduced by exactly 3: a 5-cost character pays 2, a 5-cost item pays 2, a 6-cost pays 3", () => {
  for (const [key, cost] of [["c5", 5], ["i5", 5], ["c6", 6]] as const) {
    const { engine, id } = circuitryBoard({ tokens: 0 });
    activate(engine, P1, id("ci"), "powerup");
    const before = ready(engine);
    play(engine, P1, id(key), {});
    assert.equal(zoneOf(engine, id(key)), "play", key);
    assert.equal(before - ready(engine), cost - 3, `${key}: ${cost} - 3`);
  }
});

clause(CIRCUITRY, "2:ability:powerup", "a reduction never goes below 0: cost-2 and cost-3 cards are free, a cost-4 card pays 1", () => {
  for (const [key, paid] of [["c2", 0], ["c3", 0], ["c4", 1]] as const) {
    const { engine, id } = circuitryBoard({ tokens: 0 });
    activate(engine, P1, id("ci"), "powerup");
    const before = ready(engine);
    play(engine, P1, id(key), {});
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(before - ready(engine), paid, `${key} pays ${paid}`);
    assert.ok(ready(engine) <= before, "no resource appeared");
  }
});

clause(CIRCUITRY, "2:ability:powerup", "it applies to a tactic's numeric cost too (any numeric cost I pay)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  const before = ready(engine);
  play(engine, P1, id("t3"), {});
  assert.equal(zoneOf(engine, id("t3")), "discard");
  assert.equal(before - ready(engine), 0, "a cost-3 tactic costs 3 - 3 = 0");
});

clause(CIRCUITRY, "2:ability:powerup", "only the NEXT cost: the second 5-cost character pays in full", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  play(engine, P1, id("c5"), {});
  const before = ready(engine);
  play(engine, P1, id("c5b"), {});
  assert.equal(before - ready(engine), 5);
});

clause(CIRCUITRY, "2:ability:powerup", "the reduction ends with the turn: unused, it is gone on my next turn", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const before = ready(engine);
  play(engine, P1, id("c5"), {});
  assert.equal(before - ready(engine), 5, "no reduction left over");
});

clause(CIRCUITRY, "2:ability:powerup", "it reduces only MY next cost: the opponent's next numeric cost is unchanged", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const before = ready(engine, P2);
  play(engine, P2, id("oppItem"), {});
  assert.equal(before - ready(engine, P2), 4);
});

clause(CIRCUITRY, "2:ability:powerup", "the reduction also applies to a numeric ability cost I pay (pay 3 becomes pay 0; CR 406.5)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 0, "a 'pay 3' ability costs nothing after POWER-UP");
  const next = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(next - ready(engine), 3, "and the next use pays in full");
});

clause(CIRCUITRY, "2:ability:powerup", "two POWER-UPs this turn both reduce the same 'next numeric cost' (a 6-cost character costs 0)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0, circuits: 2 });
  activate(engine, P1, id("ci"), "powerup");
  activate(engine, P1, id("ci2"), "powerup");
  const before = ready(engine);
  play(engine, P1, id("c6"), {});
  assert.equal(zoneOf(engine, id("c6")), "play");
  assert.equal(before - ready(engine), 0, "each effect reduces 'the next numeric cost you pay this turn' by 3: 6 - 3 - 3 = 0");
});

clause(CIRCUITRY, "2:ability:powerup", "cannot be used while depleted; only its controller can use it; not from the hand", () => {
  const depleted = circuitryBoard({ tokens: 0, depleted: true });
  refused(() => activateRaw(depleted.engine, P1, depleted.id("ci"), "powerup"), "depleted");
  const opp = circuitryBoard({ tokens: 0, active: P2 });
  refused(() => activateRaw(opp.engine, P2, opp.id("ci"), "powerup"), "the opponent does not control it");
  assert.equal(isDepleted(opp.engine, opp.id("ci")), false);
  const inHand = circuitryBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("ci"), "powerup"), "from hand");
});

clause(CIRCUITRY, "2:ability:powerup", "a face-down Circuitry is only a resource: POWER-UP is not available", () => {
  const { engine, id } = circuitryBoard({ tokens: 0, faceDown: true });
  refused(() => activateRaw(engine, P1, id("ci"), "powerup"), "face-down cards have no abilities", /Activated ability not found|face-down|not found/i);
});

// =============================================================================
// Scavengemajig
// When this card enters or leaves play, you may pick an item in your discard
// pile. If you do, put it into your hand.
// Character (majig, gearsmith), cost 4, threshold [E][E][E], 2 strength / 1 life / 3 speed.
// =============================================================================

const SCAVENGER = "5e6c66c2-9422-48dc-b914-71876a17f9ab";

function scavengerBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; faceDown?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const foeOwner: Pid = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner, zone: opts.zone ?? "hand", faceDown: opts.faceDown },
      { key: "sm2", def: printing(SCAVENGER), owner, zone: "hand" },
      { key: "dItem1", def: item({ name: "DiscItem1" }), owner, zone: "discard" },
      { key: "dItem2", def: item({ name: "DiscItem2", subtype: ["gear"] }), owner, zone: "discard" },
      { key: "dChar", def: character({ name: "DiscChar" }), owner, zone: "discard" },
      { key: "dTac", def: tactic({ name: "DiscTac" }), owner, zone: "discard" },
      { key: "dLoc", def: location({ name: "DiscLoc" }), owner, zone: "discard" },
      { key: "oItem", def: item({ name: "OppDiscItem" }), owner: foeOwner, zone: "discard" },
      { key: "hItem", def: item({ name: "HandItem" }), owner, zone: "hand" },
      { key: "kItem", def: item({ name: "DeckItem" }), owner, zone: "deck" },
      { key: "pItem", def: item({ name: "PlayItem" }), owner, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: foeOwner, zone: "play" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner, zone: "hand" },
      { key: "sendDiscard", def: sendTactic("discard"), owner, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner, zone: "hand" },
      { key: "killRes", def: sendTactic("destroy", "resource"), owner, zone: "hand" },
      ...fillers("fill", 3, owner, "deck"),
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

clause(SCAVENGER, "0:rule", "entering play: I am offered a pick of an item in my discard pile; picking one puts it into my hand", () => {
  const { engine, id } = scavengerBoard();
  const handBefore = [...hand(engine, P1)];
  play(engine, P1, id("sm"), {});
  const pc = pending(engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Scavengemajig's controller picks");
  pick(engine, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.deepEqual(hand(engine, P1), [...handBefore.filter((c) => c !== id("sm")), id("dItem1")], "exactly that item joined my hand");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SCAVENGER, "0:rule", "entering play: any item, whatever its subtype, can be picked (a gear item here)", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  pick(engine, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem2")), "hand");
  assert.equal(zoneOf(engine, id("dItem1")), "discard", "the other item stays");
});

clause(SCAVENGER, "0:rule", "entering play: it is a 'may': I can pick nothing and the discard pile is untouched, and it still enters play", () => {
  const { engine, id } = scavengerBoard();
  const discardBefore = [...discardOf(engine, P1)];
  const handBefore = hand(engine, P1).length;
  play(engine, P1, id("sm"), {});
  pick(engine, []);
  assert.deepEqual(discardOf(engine, P1), discardBefore);
  assert.equal(hand(engine, P1).length, handBefore - 1, "only the Scavengemajig left my hand");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SCAVENGER, "0:rule", "only an ITEM can be picked: a character, a tactic and a location in the discard pile are refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  for (const key of ["dChar", "dTac", "dLoc"]) refused(() => pickRaw(engine, [id(key)]), `${key} is not an item`);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting");
  pick(engine, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem2")), "hand", "control: an item is accepted");
});

clause(SCAVENGER, "0:rule", "only MY discard pile: the opponent's discard pile, my hand, my deck and items in play are refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  for (const key of ["oItem", "hItem", "kItem", "pItem"]) refused(() => pickRaw(engine, [id(key)]), `${key} is not in my discard pile`);
  pick(engine, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("oItem")), "discard", "their discard pile is untouched");
  assert.equal(zoneOf(engine, id("pItem")), "play");
});

clause(SCAVENGER, "0:rule", "only one item: picking two is refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  refused(() => pickRaw(engine, [id("dItem1"), id("dItem2")]), "two items");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pick(engine, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem1")), "discard", "the other item stays");
  assert.equal(zoneOf(engine, id("dItem2")), "hand");
});

clause(SCAVENGER, "0:rule", "with no item in my discard pile nothing happens on entering (no other card moves)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "hand" },
      { key: "dChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "oItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("sm"), {});
  assert.equal(engine.state.pendingChoice, undefined, "there is nothing to pick");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(zoneOf(engine, id("dChar")), "discard");
  assert.equal(zoneOf(engine, id("oItem")), "discard");
});

clause(SCAVENGER, "0:rule", "leaving play (destroyed): I am offered the same pick and the item goes to my hand", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  const handBefore = [...hand(engine, P1)];
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard");
  const pc = pending(engine);
  assert.ok(pc, "a pick is offered when it leaves play");
  assert.equal(pc.playerId, P1);
  refused(() => pickRaw(engine, [id("dChar")]), "not an item");
  pick(engine, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.deepEqual(hand(engine, P1), [...handBefore.filter((c) => c !== id("sendDestroy")), id("dItem1")]);
});

clause(SCAVENGER, "0:rule", "leaving play: it is a 'may' too, and I can pick nothing", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("sm")] } });
  pick(engine, []);
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
  assert.equal(zoneOf(engine, id("dItem2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

for (const [key, label] of [
  ["sendDestroy", "destroyed"],
  ["sendHand", "returned to hand"],
  ["sendDeck", "put into the deck"],
  ["sendDiscard", "put into the discard pile"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(SCAVENGER, "0:rule", `leaving play by being ${label} triggers the pick`, () => {
    const { engine, id } = scavengerBoard({ zone: "play" });
    play(engine, P1, id(key), { selected: { t: [id("sm")] } });
    assert.notEqual(zoneOf(engine, id("sm")), "play");
    assert.ok(pending(engine), `a pick is offered when it is ${label}`);
    pick(engine, [id("dItem1")]);
    assert.equal(zoneOf(engine, id("dItem1")), "hand");
  });
}

clause(SCAVENGER, "0:rule", "dying in battle also triggers the leaves-play pick", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "dItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" }
    ]
  });
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("sm")] });
  autoResolveBattle(engine);
  assert.equal(pending(engine)?.playerId, P1, "I am offered the pick when it dies");
  finishBattle(engine, undefined, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("dItem")] } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("sm")), "discard", "3 damage kills the 1-life Scavengemajig");
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(SCAVENGER, "0:rule", "it does not trigger for other cards: another character entering or leaving play gives no prompt", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  play(engine, P1, id("plain"), {});
  assert.equal(engine.state.pendingChoice, undefined, "another character entering play");
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("plain")] } });
  assert.equal(engine.state.pendingChoice, undefined, "another character leaving play");
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
});

clause(SCAVENGER, "0:rule", "each Scavengemajig triggers on its own: two entering give two picks", () => {
  const { engine, id } = scavengerBoard({ elitism: 8 });
  play(engine, P1, id("sm"), {});
  pick(engine, [id("dItem1")]);
  play(engine, P1, id("sm2"), {});
  pick(engine, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.equal(zoneOf(engine, id("dItem2")), "hand");
});

clause(SCAVENGER, "0:rule", "a face-down Scavengemajig is only a resource: it gives no prompt when it leaves play", () => {
  const { engine, id } = scavengerBoard({ zone: "play", faceDown: true });
  play(engine, P1, id("killRes"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard", "the face-down card was destroyed");
  assert.equal(engine.state.pendingChoice, undefined, "a face-down card has no triggered ability (RULES.md 2)");
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
});

clause(SCAVENGER, "0:rule", "played face-down as a resource it is only a resource: no prompt when it enters", () => {
  const { engine, id } = scavengerBoard();
  developResource(engine, P1, id("sm"), true);
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
});

clause(SCAVENGER, "0:rule", "an opponent-controlled Scavengemajig lets THEM pick an item from THEIR discard pile", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P2, zone: "hand" },
      { key: "mine", def: item({ name: "MyDisc" }), owner: P1, zone: "discard" },
      { key: "theirs", def: item({ name: "TheirDisc" }), owner: P2, zone: "discard" },
      ...bank("elitism", 4, P2)
    ]
  });
  play(engine, P2, id("sm"), {});
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  refused(() => pickRaw(engine, [id("mine")], P2), "not their discard pile");
  pick(engine, [id("theirs")], P2);
  assert.equal(zoneOf(engine, id("theirs")), "hand");
  assert.equal(hand(engine, P2).includes(id("theirs")), true);
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(SCAVENGER, "0:rule", "it also triggers when put into play by an effect rather than deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "discard" },
      { key: "revive", def: reviveTactic("character"), owner: P1, zone: "hand" },
      { key: "dItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" }
    ]
  });
  play(engine, P1, id("revive"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.ok(pending(engine), "'enters play' includes being put into play");
  pick(engine, [id("dItem")]);
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(SCAVENGER, "0:rule", "costs 4 with [E][E][E] (refused one resource or one [E] short) and has its printed 2/1/3 stats", () => {
  const spec: DeploySpec = {
    printingId: SCAVENGER,
    cost: 4,
    icon: "elitism",
    iconCount: 3,
    answer: (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : declineAll(pc))
  };
  deployBattery(spec);
  const { engine, id } = scavengerBoard({ zone: "play" });
  assert.deepEqual(stat(engine, id("sm")), [2, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("sm")), ["majig"]);
  assert.equal(engine.getDefinition(id("sm")).trade, "gearsmith");
});

// --- ATTACH TO CHARACTER (shared by Subversion Matrix and Tri-Pole Magnet) -----

const attachedToOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].attachedTo;

/** A board with `printingId` in hand (cost `cost`, threshold `icons` x elitism) and a variety of legal / illegal ATTACH TO hosts. */
function attachBoard(printingId: string, opts: { elitism?: number; greed?: number; noCharacters?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(printingId), owner: P1, zone: "hand" },
      ...(opts.noCharacters
        ? []
        : ([
            { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
            { key: "host2", def: character({ name: "Host2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
            { key: "foeHost", def: character({ name: "FoeHost", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" }
          ] as CardPlacement[])),
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "myThing", def: item({ name: "MyThing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "character"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

type AttachBoard = ReturnType<typeof attachBoard>;

/** Deploys the card in hand attached to `hostKey`. */
const deployAttached = (b: AttachBoard, hostKey: string) => play(b.engine, P1, b.id("card"), { selected: { attachTo: [b.id(hostKey)] } });

/** ATTACH TO CHARACTER: the first extra cost is picking a character; the card enters play attached to it. */
function attachEntersAttached(printingId: string, cost: number) {
  const b = attachBoard(printingId);
  const before = ready(b.engine);
  deployAttached(b, "host");
  assert.equal(zoneOf(b.engine, b.id("card")), "play");
  assert.equal(attachedToOf(b.engine, b.id("card")), b.id("host"), "attached to the picked character");
  assert.equal(before - ready(b.engine), cost, "the printed cost is paid");
  assert.deepEqual(b.engine.getCardTypes(b.id("card")), ["item"]);
  assert.equal(controllerOf(b.engine, b.id("card")), P1);
  assert.equal(attachedToOf(b.engine, b.id("host2")), undefined, "nothing else gets attached");
}

function attachToOpponentCharacter(printingId: string) {
  const b = attachBoard(printingId);
  deployAttached(b, "foeHost");
  assert.equal(attachedToOf(b.engine, b.id("card")), b.id("foeHost"));
  assert.equal(controllerOf(b.engine, b.id("card")), P1, "I still control the attached card");
  assert.equal(ownerOf(b.engine, b.id("card")), P1);
  assert.equal(playOf(b.engine, P1).includes(b.id("card")), true);
}

function attachRefusesNonCharacters(printingId: string) {
  const b = attachBoard(printingId);
  const attempt = (picked: string) => () => playRaw(b.engine, P1, b.id("card"), { selected: { attachTo: [picked] } });
  refused(attempt(b.id("thing")), "an opponent's item");
  refused(attempt(b.id("myThing")), "my item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.engine.state.players[P2].factionId!), "their faction");
  refused(attempt(b.engine.state.players[P1].factionId!), "my faction");
  refused(attempt(b.id("fd")), "a face-down card (only a resource)");
  refused(attempt(b.id("handChar")), "a character in hand");
  refused(attempt(b.id("discChar")), "a character in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("card")), "hand");
  assert.equal(ready(b.engine), 6, "nothing was spent");
  attempt(b.id("host"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
}

function attachNeedsExactlyOneHost(printingId: string) {
  const b = attachBoard(printingId);
  refused(() => playRaw(b.engine, P1, b.id("card"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(b.engine, P1, b.id("card"), { selected: {} }), "no pick at all");
  refused(() => playRaw(b.engine, P1, b.id("card"), { selected: { attachTo: [b.id("host"), b.id("host2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("card")), "hand");
  assert.equal(ready(b.engine), 6);
}

function attachNeedsACharacterInPlay(printingId: string) {
  const none = attachBoard(printingId, { noCharacters: true });
  assert.equal(none.engine.getCardPlayability(P1, none.id("card")).thresholdMet, true);
  refused(() => playRaw(none.engine, P1, none.id("card"), { selected: {} }), "no character in play to attach to");
  refused(() => playRaw(none.engine, P1, none.id("card"), { selected: { attachTo: [none.id("handChar")] } }), "the only character is in hand");
  assert.equal(zoneOf(none.engine, none.id("card")), "hand");
}

function attachHostDestroyed(printingId: string) {
  const b = attachBoard(printingId);
  deployAttached(b, "host");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("card")), "discard", "destroyed with its host (CR 301.4)");
}

function attachHostBounced(printingId: string) {
  const b = attachBoard(printingId);
  deployAttached(b, "host");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("card")), "hand", "leaves play the same way as its host: into its owner's hand (CR 301.4a)");
}

// =============================================================================
// Subversion Matrix
// ATTACH TO CHARACTER. Treat the attached character as though it has no rules
// text. (This includes abilities.)
// MOVE -- COST: Pay 2. Pick a character. EFFECT: Attach this card to the character.
// Item (gear), cost 2, threshold [E].
// =============================================================================

const MATRIX = "ce3bc778-5456-4e01-9f9c-eceaa6aa6fe1";

clause(MATRIX, "0:attach", "deploys for 2 with [E], picking a character as the first extra cost: it enters play attached to that character", () => attachEntersAttached(MATRIX, 2));
clause(MATRIX, "0:attach", "it can attach to an opponent's character too, and I keep controlling the Matrix", () => attachToOpponentCharacter(MATRIX));
clause(MATRIX, "0:attach", "only a character can be the host: an item, a location, a faction, a face-down card, and a character in hand or the discard pile are refused", () => attachRefusesNonCharacters(MATRIX));
clause(MATRIX, "0:attach", "exactly one host: none or two is refused", () => attachNeedsExactlyOneHost(MATRIX));
clause(MATRIX, "0:attach", "with no character in play to attach to it cannot be played", () => attachNeedsACharacterInPlay(MATRIX));
clause(MATRIX, "0:attach", "when the host is destroyed the Matrix is destroyed with it (CR 301.4)", () => attachHostDestroyed(MATRIX));
clause(MATRIX, "0:attach", "when the host is returned to its owner's hand the Matrix leaves play the same way: into its owner's hand (CR 301.4a)", () => attachHostBounced(MATRIX));
clause(MATRIX, "0:attach", "costs 2 and needs [E]: refused one resource short and one [E] short; the icon is a gate, not spent", () => {
  deployBattery({ printingId: MATRIX, cost: 2, icon: "elitism", iconCount: 1, extra: [{ key: "h", def: character({ name: "H" }), owner: P1, zone: "play" }], selected: (id) => ({ attachTo: [id("h")] }) });
  const b = attachBoard(MATRIX);
  assert.deepEqual(b.engine.getSubtypes(b.id("card")), ["gear"]);
  assert.equal(b.engine.getDefinition(b.id("card")).trade, "gearsmith");
});

/** A character with a keyword, an activated ability (`act`: +3 influence), a self-stat continuous rule, an anthem for my characters, and a triggered rule. */
function rulefulCharacter(name: string, over: Partial<Def> = {}): Def {
  return character({
    name,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "act", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] },
        { id: "bulk", type: "continuous", modifiers: [{ target: "source", stat: "life", operation: "add", value: 2 }] },
        { id: "lord", type: "continuous", modifiers: [{ selector: { type: "character", controller: "self" }, stat: "speed", operation: "add", value: 1 }] },
        { id: "watch", type: "triggered", event: "cardEnteredPlay", condition: { type: "not", condition: { type: "sourceIsEventCard" } }, effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }
      ]
    },
    ...over
  });
}

function matrixBoard(opts: { zone?: "hand" | "play"; attachedTo?: string; elitism?: number; greed?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "mx", def: printing(MATRIX), owner: P1, zone: opts.zone ?? "play", attachedToKey: opts.zone === "hand" ? undefined : (opts.attachedTo ?? "mate") },
      { key: "ruleA", def: rulefulCharacter("RulefulA"), owner: P1, zone: "play" },
      { key: "ruleB", def: rulefulCharacter("RulefulB"), owner: P1, zone: "play" },
      { key: "foeRule", def: rulefulCharacter("FoeRuleful"), owner: P2, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" },
      { key: "killItem", def: destroyTactic("item"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "character"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MATRIX, "1:rule", "control: a character with no Matrix on it uses its rules text: keyword, ability, extra life, anthem, trigger", () => {
  const { engine, id } = matrixBoard();
  assert.ok(hasKeyword(engine, id("ruleA"), "covert"), "hasKeyword(engine, id(\"ruleA\"), \"covert\")");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "its own continuous rule: +2 life");
  assert.equal(engine.getStat(id("mate"), "speed"), 3, "two Ruleful anthems: +1 speed each");
  const before = influence(engine, P1);
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(influence(engine, P1) - before, 3, "its activated ability works");
  const beforeTrig = influence(engine, P1);
  play(engine, P1, id("plain"), {});
  drain(engine, declineAll);
  assert.equal(influence(engine, P1) - beforeTrig, 4, "both of my Ruleful characters' triggers fire for the newcomer (+2 each)");
});

clause(MATRIX, "1:rule", "an unattached Matrix (just deployed without a host) is not a thing: deploying it attaches it, and nothing is suppressed before the host is chosen", () => {
  const { engine, id } = matrixBoard({ zone: "hand" });
  assert.equal(engine.getStat(id("ruleA"), "life"), 5);
  play(engine, P1, id("mx"), { selected: { attachTo: [id("ruleA")] } });
  assert.equal(attachedToOf(engine, id("mx")), id("ruleA"));
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "silenced as soon as it is attached");
  assert.equal(engine.getStat(id("ruleB"), "life"), 5, "the other one is not");
});

clause(MATRIX, "1:rule", "the attached character loses its keywords (a keyword is printed rules text)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.ok(hasKeyword(engine, id("ruleB"), "covert"), "control: another character keeps its keyword");
  assert.equal(hasKeyword(engine, id("ruleA"), "covert"), false, "no COVERT");
});

clause(MATRIX, "1:rule", "the attached character cannot use its activated abilities (the rules text includes abilities)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  const before = influence(engine, P1);
  refused(() => activateRaw(engine, P1, id("ruleA"), "act"), "the ability is gone", /Activated ability not found/);
  assert.equal(influence(engine, P1), before);
  activate(engine, P1, id("ruleB"), "act");
  assert.equal(influence(engine, P1) - before, 3, "control: another character's ability works");
});

clause(MATRIX, "1:rule", "the attached character loses its continuous rules (the +2 life)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "printed life only");
  assert.equal(engine.getStat(id("ruleB"), "life"), 5, "another character keeps its +2 life");
});

clause(MATRIX, "1:rule", "the attached character's anthem for other characters is off too", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.equal(engine.getStat(id("mate"), "speed"), 2, "only RulefulB's anthem still gives +1 speed");
  const plain = matrixBoard();
  assert.equal(plain.engine.getStat(plain.id("mate"), "speed"), 3, "control: with no Matrix both anthems apply");
});

clause(MATRIX, "1:rule", "the attached character loses its triggered rules", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  const before = influence(engine, P1);
  play(engine, P1, id("plain"), {});
  drain(engine, declineAll);
  assert.equal(influence(engine, P1) - before, 2, "only RulefulB's trigger fires for me (+2), RulefulA's does not");
});

clause(MATRIX, "1:rule", "only rules text goes: the printed stats (strength, life), name and type stay", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.deepEqual(stat(engine, id("ruleA")), [2, 3, 3], "printed 2/3, and speed 2 + the other Ruleful's anthem");
  assert.deepEqual(engine.getCardTypes(id("ruleA")), ["character"]);
  assert.equal(engine.getDefinition(id("ruleA")).name, "RulefulA");
});

clause(MATRIX, "1:rule", "it only affects its own host: other characters, and the opponent's, keep their text", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.ok(hasKeyword(engine, id("foeRule"), "covert"), "hasKeyword(engine, id(\"foeRule\"), \"covert\")");
  assert.equal(engine.getStat(id("foeRule"), "life"), 5);
  assert.equal(engine.getStat(id("ruleB"), "life"), 5);
});

clause(MATRIX, "1:rule", "it works on an opponent's character too (its ability is gone, its text is off) and not on mine", () => {
  const { engine, id } = matrixBoard({ attachedTo: "foeRule" });
  assert.equal(engine.getStat(id("foeRule"), "life"), 3, "its continuous rule is off");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "mine keep theirs");
  const turn2 = matrixBoard({ attachedTo: "foeRule", active: P2 });
  refused(() => activateRaw(turn2.engine, P2, turn2.id("foeRule"), "act"), "and its ability is gone", /Activated ability not found/);
});

clause(MATRIX, "1:rule", "when the Matrix leaves play the host has its rules text again", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "silenced while the Matrix is on it");
  play(engine, P1, id("killItem"), { selected: { t: [id("mx")] } });
  assert.equal(zoneOf(engine, id("mx")), "discard");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "its +2 life rule is back");
  const before = influence(engine, P1);
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(influence(engine, P1) - before, 3, "and its ability works again");
  assert.ok(hasKeyword(engine, id("ruleA"), "covert"), "and its keyword");
});

clause(MATRIX, "1:rule", "when the host is destroyed the Matrix goes with it", () => attachHostDestroyed(MATRIX));

clause(MATRIX, "2:ability:move", "MOVE pays exactly 2 and attaches the Matrix to the picked character", () => {
  const { engine, id } = matrixBoard();
  const before = ready(engine);
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.equal(attachedToOf(engine, id("mx")), id("ruleA"));
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "and it silences the host straight away");
  assert.equal(isDepleted(engine, id("mx")), false, "MOVE does not deplete");
  assert.equal(zoneOf(engine, id("mx")), "play");
});

clause(MATRIX, "2:ability:move", "the 2 are paid as the cost, before responses; it attaches when it resolves", () => {
  const { engine, id } = matrixBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(before - ready(engine), 2);
  assert.equal(attachedResources(engine, P1).length, 2, "paid by attaching 2 resources to my faction");
  assert.equal(attachedToOf(engine, id("mx")), id("mate"), "not moved yet (it sits on the Mate)");
  resolvePendingResponses(engine);
  assert.equal(attachedToOf(engine, id("mx")), id("ruleA"));
});

clause(MATRIX, "2:ability:move", "moving it detaches it from the old character (CR 301.2): the old host regains its text, the new one loses it", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  assert.equal(attachedToOf(engine, id("mx")), id("ruleB"));
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "the old host has its rules text again");
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(engine.getStat(id("ruleB"), "life"), 3, "the new host lost its text");
  refused(() => activateRaw(engine, P1, id("ruleB"), "act"), "...including its ability", /Activated ability not found/);
});

clause(MATRIX, "2:ability:move", "it can move onto an opponent's character, and back; I keep controlling it", () => {
  const { engine, id } = matrixBoard();
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("foeRule")] } });
  assert.equal(attachedToOf(engine, id("mx")), id("foeRule"));
  assert.equal(controllerOf(engine, id("mx")), P1, "I still control the Matrix");
  assert.equal(engine.getStat(id("foeRule"), "life"), 3);
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  assert.equal(attachedToOf(engine, id("mx")), id("ruleB"));
  assert.equal(engine.getStat(id("foeRule"), "life"), 5, "their character has its text again");
});

clause(MATRIX, "2:ability:move", "it can be used again and again: each use costs 2", () => {
  const { engine, id } = matrixBoard({ elitism: 6 });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("foeRule")] } });
  assert.equal(ready(engine), 0);
  assert.equal(attachedToOf(engine, id("mx")), id("foeRule"));
  refused(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } }), "a fourth use cannot be paid");
});

clause(MATRIX, "2:ability:move", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = matrixBoard();
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [picked] } });
  refused(attempt(id("thing")), "item");
  refused(attempt(id("place")), "location");
  refused(attempt(engine.state.players[P2].factionId!), "their faction");
  refused(attempt(engine.state.players[P1].factionId!), "my faction");
  refused(attempt(id("fd")), "face-down");
  refused(attempt(id("handChar")), "a character in hand");
  refused(attempt(id("mx")), "the Matrix itself");
  assert.equal(ready(engine), 8, "nothing was spent");
  attempt(id("ruleA"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(MATRIX, "2:ability:move", "exactly one character: none or two is refused", () => {
  const { engine, id } = matrixBoard();
  refused(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [] } }), "no pick");
  refused(() => activateRaw(engine, P1, id("mx"), "move", { selected: {} }), "no declaration");
  refused(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA"), id("ruleB")] } }), "two characters");
  assert.equal(attachedToOf(engine, id("mx")), id("mate"));
  assert.equal(ready(engine), 8);
});

clause(MATRIX, "2:ability:move", "is refused with only 1 resource (one short); exactly 2 works", () => {
  const short = matrixBoard({ elitism: 1 });
  refused(() => activateRaw(short.engine, P1, short.id("mx"), "move", { selected: { c: [short.id("ruleA")] } }), "1 resource for pay 2");
  assert.equal(attachedToOf(short.engine, short.id("mx")), short.id("mate"));
  assert.equal(ready(short.engine), 1, "nothing was spent");
  const exact = matrixBoard({ elitism: 2 });
  activate(exact.engine, P1, exact.id("mx"), "move", { selected: { c: [exact.id("ruleA")] } });
  assert.equal(attachedToOf(exact.engine, exact.id("mx")), exact.id("ruleA"));
  assert.equal(ready(exact.engine), 0);
});

clause(MATRIX, "2:ability:move", "has no threshold of its own: 2 resources of any kind pay for it", () => {
  const { engine, id } = matrixBoard({ elitism: 0, greed: 2 });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(attachedToOf(engine, id("mx")), id("ruleA"));
});

clause(MATRIX, "2:ability:move", "only its controller can use it, and only from play", () => {
  const { engine, id } = matrixBoard({ active: P2 });
  refused(() => activateRaw(engine, P2, id("mx"), "move", { selected: { c: [id("foeRule")] } }), "the opponent does not control it");
  assert.equal(attachedToOf(engine, id("mx")), id("mate"));
  const inHand = matrixBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("mx"), "move", { selected: { c: [inHand.id("ruleA")] } }), "from hand");
});

clause(MATRIX, "2:ability:move", "MOVE can be used on the opponent's turn in response to their attack", () => {
  const b = matrixBoard({ active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("foeRule")]);
  activateRaw(b.engine, P1, b.id("mx"), "move", { selected: { c: [b.id("foeRule")] } });
  resolvePendingResponses(b.engine);
  assert.equal(attachedToOf(b.engine, b.id("mx")), b.id("foeRule"), "moved onto the attacker in response");
  assert.equal(b.engine.getStat(b.id("foeRule"), "life"), 3);
});

// =============================================================================
// The Whatever Device
// THANK GOD WE INVENTED THE... -- COST: Choose a number for X. Pay X. Destroy this
// card. EFFECT: Search your deck for an item with numeric cost X or less and reveal
// it. You may play that card for free. If you don't, put it into your hand.
// Item (gearsmith), cost 2, threshold [E][E][E][E].
// =============================================================================

const TWD = "6b7d880a-9bd7-4fd5-a940-883c6e24f59d";

function twdBoard(opts: { resources?: number; elitism?: number; extra?: CardPlacement[]; random?: () => number; noZeroItem?: boolean; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: opts.random ?? (() => 0),
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "twd", def: printing(TWD), owner: P1, zone: "play" },
      ...(opts.noZeroItem ? [] : [{ key: "i0", def: item({ name: "I0", cost: 0 }), owner: P1, zone: "deck" as const }]),
      { key: "i1", def: item({ name: "I1", cost: 1 }), owner: P1, zone: "deck" },
      { key: "i2", def: item({ name: "I2", cost: 2 }), owner: P1, zone: "deck" },
      { key: "i3", def: item({ name: "I3", cost: 3 }), owner: P1, zone: "deck" },
      { key: "i5", def: item({ name: "I5", cost: 5 }), owner: P1, zone: "deck" },
      { key: "ch0", def: character({ name: "Ch0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "tac0", def: tactic({ name: "Tac0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "loc0", def: location({ name: "Loc0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "oi1", def: item({ name: "OI1", cost: 1 }), owner: P2, zone: "deck" },
      { key: "hi1", def: item({ name: "HI1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "di1", def: item({ name: "DI1", cost: 1 }), owner: P1, zone: "discard" },
      ...bank("greed", opts.resources ?? 8, P1),
      ...bank("elitism", opts.elitism ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}
type TwdBoard = ReturnType<typeof twdBoard>;

const twdRaw = (b: TwdBoard, x: number) => activateRaw(b.engine, P1, b.id("twd"), "thankgod", { variables: { x } });
/** Uses the Device with X and settles the response window; the search prompt is then open. */
const twd = (b: TwdBoard, x: number) => {
  twdRaw(b, x);
  resolvePendingResponses(b.engine);
};
const freePlayAnswer = (b: TwdBoard, key?: string) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: key ? b.id(key) : undefined } } as never);
  resolvePendingResponses(b.engine);
};
const freePlayAnswerRaw = (b: TwdBoard, key?: string) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: key ? b.id(key) : undefined } } as never);

/** Search with X, take `key` and choose to put it into the hand. */
function twdFetch(b: TwdBoard, x: number, key: string) {
  twd(b, x);
  pick(b.engine, [b.id(key)]);
  chooseOption(b.engine, /hand/i);
}

clause(TWD, "0:ability:thankgod", "the cost is paid on activation: X resources are spent and the Device is destroyed (it is in its owner's discard pile before the search happens)", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  twdRaw(b, 3);
  assert.equal(before - ready(b.engine), 3, "COST: pay X");
  assert.equal(attachedResources(b.engine, P1).length, 3, "paid by attaching 3 resources to my faction");
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard", "COST: destroy this card");
  assert.equal(discardOf(b.engine, P1).includes(b.id("twd")), true);
  assert.equal(zoneOf(b.engine, b.id("i3")), "deck", "nothing has been searched yet");
  assert.equal(b.engine.state.pendingChoice, undefined, "the search happens when the ability resolves");
});

for (const x of [0, 1, 3, 5]) {
  clause(TWD, "0:ability:thankgod", `X = ${x}: pays exactly ${x} and destroys the Device`, () => {
    const b = twdBoard();
    const before = ready(b.engine);
    twd(b, x);
    assert.equal(before - ready(b.engine), x);
    assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search prompt is open");
    assert.equal(pending(b.engine)?.playerId, P1, "I search");
  });
}

clause(TWD, "0:ability:thankgod", "needs no threshold of its own: resources of any kind pay for X", () => {
  const b = twdBoard({ resources: 2, elitism: 0 });
  twd(b, 2);
  assert.equal(ready(b.engine), 0);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(TWD, "0:ability:thankgod", "X must be affordable: X = 9 with 8 resources is refused, nothing is paid and the Device stays", () => {
  const b = twdBoard({ resources: 8 });
  const before = ready(b.engine);
  refused(() => twdRaw(b, 9), "X = 9 costs 9");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before, "nothing was paid");
  twd(b, 8);
  assert.equal(ready(b.engine), 0, "control: X = 8 can be paid exactly");
});

clause(TWD, "0:ability:thankgod", "X is a number of at least 0: a negative X is refused", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  refused(() => twdRaw(b, -1), "a negative X");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before);
});

clause(TWD, "0:ability:thankgod", "X must be a whole number (CR 410.2): a fractional X such as 1.5 is refused", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  refused(() => twdRaw(b, 1.5), "a fractional X");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before, "nothing was paid");
});

clause(TWD, "0:ability:thankgod", "the search finds an item with numeric cost X or less: with X = 2 the cost-0, cost-1 and cost-2 items can be taken", () => {
  for (const key of ["i0", "i1", "i2"]) {
    const b = twdBoard();
    twdFetch(b, 2, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} (cost <= 2) is found`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(TWD, "0:ability:thankgod", "an item costing more than X cannot be taken: with X = 2 the cost-3 and cost-5 items are refused", () => {
  const b = twdBoard();
  twd(b, 2);
  refused(() => pickRaw(b.engine, [b.id("i3")]), "cost 3 > X");
  refused(() => pickRaw(b.engine, [b.id("i5")]), "cost 5 > X");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  assert.equal(zoneOf(b.engine, b.id("i3")), "deck");
  pick(b.engine, [b.id("i2")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "control: a cost-2 item is accepted");
});

clause(TWD, "0:ability:thankgod", "X = 0 finds only cost-0 items", () => {
  const b = twdBoard();
  twd(b, 0);
  refused(() => pickRaw(b.engine, [b.id("i1")]), "cost 1 > 0");
  pick(b.engine, [b.id("i0")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(TWD, "0:ability:thankgod", "only items: a character, a tactic or a location with a low cost cannot be taken", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, [b.id("ch0")]), "a character");
  refused(() => pickRaw(b.engine, [b.id("tac0")]), "a tactic");
  refused(() => pickRaw(b.engine, [b.id("loc0")]), "a location");
  pick(b.engine, [b.id("i5")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "control: an item works");
});

clause(TWD, "0:ability:thankgod", "only my own deck: the opponent's deck, my hand and my discard pile cannot be searched", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, [b.id("oi1")]), "the opponent's deck");
  refused(() => pickRaw(b.engine, [b.id("hi1")]), "my hand");
  refused(() => pickRaw(b.engine, [b.id("di1")]), "my discard pile");
  assert.equal(zoneOf(b.engine, b.id("oi1")), "deck");
});

clause(TWD, "0:ability:thankgod", "only one item is taken", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, [b.id("i1"), b.id("i2")]), "two items");
  pick(b.engine, [b.id("i1")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(TWD, "0:ability:thankgod", "the found item is revealed to everyone", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, [b.id("i3")]);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1);
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("i3")]);
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(TWD, "0:ability:thankgod", "'If you don't (play it), put it into your hand': choosing not to play puts the item in my hand, not in play", () => {
  const b = twdBoard();
  twdFetch(b, 3, "i3");
  assert.equal(zoneOf(b.engine, b.id("i3")), "hand");
  assert.equal(hand(b.engine, P1).includes(b.id("i3")), true);
  assert.equal(ready(b.engine), 5, "only X was paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TWD, "0:ability:thankgod", "'You may play that card for free': the item enters play under my control without paying its numeric cost", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, [b.id("i3")]);
  chooseOption(b.engine, /deploy|play/i);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  freePlayAnswer(b, "i3");
  assert.equal(zoneOf(b.engine, b.id("i3")), "play");
  assert.equal(controllerOf(b.engine, b.id("i3")), P1);
  assert.equal(ready(b.engine), 5, "8 - X (3); the item's own cost of 3 was free");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(hand(b.engine, P1).includes(b.id("i3")), false);
});

clause(TWD, "0:ability:thankgod", "choosing to play it but then not playing it ('If you don't') puts the item into my hand", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, [b.id("i3")]);
  chooseOption(b.engine, /deploy|play/i);
  freePlayAnswer(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i3")), "hand", "not played, so it goes to my hand");
});

clause(TWD, "0:ability:thankgod", "an item I cannot play (missing resource icons) is put into my hand instead", () => {
  const needsRage = item({ name: "NeedsRage", cost: 1, threshold: "rr" as never });
  const b = twdBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "deck" }] });
  twd(b, 3);
  pick(b.engine, [b.id("nr")]);
  chooseOption(b.engine, /deploy|play/i);
  if (pending(b.engine)?.kind === "deployForFree") {
    refused(() => freePlayAnswerRaw(b, "nr"), "no [R] icons: it cannot be played");
    freePlayAnswer(b);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("nr")), "hand", "it could not be played, so it goes to my hand");
});

clause(TWD, "0:ability:thankgod", "'play for free' does not waive the threshold (CR 308.1a): an item whose icons I have is played, one whose icons I lack is refused", () => {
  const needsElitism = item({ name: "NeedsElitism", cost: 1, threshold: "ee" as never });
  const ok = twdBoard({ elitism: 2, extra: [{ key: "ne", def: needsElitism, owner: P1, zone: "deck" }] });
  twd(ok, 3);
  pick(ok.engine, [ok.id("ne")]);
  chooseOption(ok.engine, /deploy|play/i);
  freePlayAnswer(ok, "ne");
  assert.equal(zoneOf(ok.engine, ok.id("ne")), "play", "with [E][E] it is played");
  const no = twdBoard({ extra: [{ key: "ne", def: needsElitism, owner: P1, zone: "deck" }] });
  twd(no, 3);
  pick(no.engine, [no.id("ne")]);
  chooseOption(no.engine, /deploy|play/i);
  refused(() => freePlayAnswerRaw(no, "ne"), "no [E] icons");
  assert.notEqual(zoneOf(no.engine, no.id("ne")), "play");
});

clause(TWD, "0:ability:thankgod", "'play for free' still costs the item's extra 'pay 2' (CR 308.1a)", () => {
  const costly = item({ name: "Costly", cost: 2, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const b = twdBoard({ extra: [{ key: "costly", def: costly, owner: P1, zone: "deck" }] });
  twd(b, 2);
  const afterX = ready(b.engine);
  pick(b.engine, [b.id("costly")]);
  chooseOption(b.engine, /deploy|play/i);
  freePlayAnswer(b, "costly");
  assert.equal(zoneOf(b.engine, b.id("costly")), "play");
  assert.equal(afterX - ready(b.engine), 2, "the numeric cost is free, the additional cost of 2 is paid");
});

clause(TWD, "0:ability:thankgod", "failing the search (taking nothing) ends the ability: no found card, so no 'play it for free / put it into your hand' question is asked", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing was found, so there is nothing to play or to put into the hand");
});

clause(TWD, "0:ability:thankgod", "the search may fail (CR 312.2): taking nothing leaves every item in the deck; the Device is still destroyed and X still paid", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, []);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
  assert.equal(ready(b.engine), 5);
  for (const key of ["i0", "i1", "i2", "i3", "i5"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck", key);
  assert.equal(hand(b.engine, P1).length, 1, "only the card that was already in hand");
});

clause(TWD, "0:ability:thankgod", "the searched deck is shuffled afterwards (CR 312.1), whether or not a card was taken", () => {
  const b = twdBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  twd(b, 3);
  pick(b.engine, [b.id("i3")]);
  chooseOption(b.engine, /hand/i);
  const remaining = before.filter((c) => c !== b.id("i3"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...remaining].sort(), "the same cards remain");
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(remaining, 0), "and they were shuffled");
});

clause(TWD, "0:ability:thankgod", "the deck is shuffled even when the search finds nothing (no item with cost X or less in the deck)", () => {
  const b = twdBoard({ random: () => 0, noZeroItem: true });
  const before = [...deckOf(b.engine, P1)];
  twd(b, 0);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "the deck was searched, so it is shuffled");
});

clause(TWD, "0:ability:thankgod", "with no item at all in the deck nothing breaks: the Device is destroyed and X paid", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "twd", def: printing(TWD), owner: P1, zone: "play" },
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "deck" },
      ...bank("greed", 4, P1)
    ]
  });
  activate(b.engine, P1, b.id("twd"), "thankgod", { variables: { x: 2 } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
  assert.equal(ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("ch")), "deck");
});

clause(TWD, "0:ability:thankgod", "only the Device's controller can use it", () => {
  const b = twdBoard({ active: P2 });
  refused(() => activateRaw(b.engine, P2, b.id("twd"), "thankgod", { variables: { x: 1 } }), "the opponent");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
});

clause(TWD, "0:ability:thankgod", "a played item works the turn it is found: it is in play under my control and its own abilities are mine", () => {
  const drawer = item({ name: "Drawer", cost: 1, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const b = twdBoard({ extra: [{ key: "drawer", def: drawer, owner: P1, zone: "deck" }, ...fillers("c", 3, P1, "deck")] });
  twd(b, 2);
  pick(b.engine, [b.id("drawer")]);
  chooseOption(b.engine, /deploy|play/i);
  freePlayAnswer(b, "drawer");
  const handBefore = hand(b.engine, P1).length;
  activate(b.engine, P1, b.id("drawer"), "d");
  assert.equal(hand(b.engine, P1).length, handBefore + 1);
});

clause(TWD, "0:ability:thankgod", "costs 2 with [E][E][E][E] and is a plain item", () => {
  deployBattery({ printingId: TWD, cost: 2, icon: "elitism", iconCount: 4 });
  const b = twdBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("twd")), ["item"]);
});

// =============================================================================
// Tri-Pole Magnet
// ATTACH TO CHARACTER.
// GRAPPLE -- COST: Pick a gear card in your discard pile. Destroy this card.
// EFFECT: Put the gear card into play under your control attached to the character.
// Item (gear, gearsmith), cost 2, threshold [E].
// =============================================================================

const MAGNET = "41ae5d6c-ddcd-4311-9536-fcb0ca96667d";

/** An item with the gear subtype that gives its host +1 strength while attached (ATTACH TO CHARACTER). */
const spikyGear = (name: string): Def =>
  item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "spike", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });

function magnetBoard(opts: { elitism?: number; greed?: number; hostKey?: string; active?: Pid; zone?: "hand" | "play" } = {}) {
  const hostKey = opts.hostKey ?? "host";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "tp", def: printing(MAGNET), owner: P1, zone: opts.zone ?? "play", attachedToKey: opts.zone === "hand" ? undefined : hostKey },
      { key: "tp2", def: printing(MAGNET), owner: P1, zone: "play", attachedToKey: "host2" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeHost", def: character({ name: "FoeHost", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gearPlain", def: item({ name: "PlainGear", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "gearSpiky", def: spikyGear("SpikyGear"), owner: P1, zone: "discard" },
      { key: "gearMulti", def: item({ name: "MultiGear", subtype: ["gear", "node"] }), owner: P1, zone: "discard" },
      { key: "notGear", def: item({ name: "NotGear", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "noSubtype", def: item({ name: "NoSubtype" }), owner: P1, zone: "discard" },
      { key: "gearChar", def: character({ name: "GearChar", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "oGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "discard" },
      { key: "hGear", def: item({ name: "HandGear", subtype: ["gear"] }), owner: P1, zone: "hand" },
      { key: "kGear", def: item({ name: "DeckGear", subtype: ["gear"] }), owner: P1, zone: "deck" },
      { key: "pGear", def: item({ name: "PlayGear", subtype: ["gear"] }), owner: P1, zone: "play" },
      { key: "killHost", def: destroyTactic("character"), owner: P2, zone: "hand" },
      { key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "character"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MAGNET, "0:attach", "deploys for 2 with [E], picking a character as the first extra cost: it enters play attached to that character", () => attachEntersAttached(MAGNET, 2));
clause(MAGNET, "0:attach", "it can attach to an opponent's character too, and I keep controlling the Magnet", () => attachToOpponentCharacter(MAGNET));
clause(MAGNET, "0:attach", "only a character can be the host: an item, a location, a faction, a face-down card, and a character in hand or the discard pile are refused", () => attachRefusesNonCharacters(MAGNET));
clause(MAGNET, "0:attach", "exactly one host: none or two is refused", () => attachNeedsExactlyOneHost(MAGNET));
clause(MAGNET, "0:attach", "with no character in play to attach to it cannot be played", () => attachNeedsACharacterInPlay(MAGNET));
clause(MAGNET, "0:attach", "when the host is destroyed the Magnet is destroyed with it (CR 301.4)", () => attachHostDestroyed(MAGNET));
clause(MAGNET, "0:attach", "when the host is returned to its owner's hand the Magnet leaves play the same way: into its owner's hand (CR 301.4a)", () => attachHostBounced(MAGNET));
clause(MAGNET, "0:attach", "costs 2 and needs [E]: refused one resource short and one [E] short; the icon is a gate, not spent", () => {
  deployBattery({ printingId: MAGNET, cost: 2, icon: "elitism", iconCount: 1, extra: [{ key: "h", def: character({ name: "H" }), owner: P1, zone: "play" }], selected: (id) => ({ attachTo: [id("h")] }) });
  const b = attachBoard(MAGNET);
  assert.deepEqual(b.engine.getSubtypes(b.id("card")), ["gear"]);
  assert.equal(b.engine.getDefinition(b.id("card")).trade, "gearsmith");
});

/** Uses GRAPPLE (declarations `g` and `host`). */
function grapple(engine: SpoilsEngine, id: (k: string) => string, gearKey: string, hostKey = "host", magnetKey = "tp") {
  activate(engine, P1, id(magnetKey), "grapple", { selected: { g: [id(gearKey)], host: [id(hostKey)] } });
}

clause(MAGNET, "1:ability:grapple", "destroys the Magnet as a cost and puts the picked gear card from my discard pile into play under my control, attached to the host", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("tp")), "discard", "COST: Destroy this card");
  assert.equal(zoneOf(engine, id("gearPlain")), "play", "the gear card is in play");
  assert.equal(attachedToOf(engine, id("gearPlain")), id("host"), "attached to the character the Magnet was attached to");
  assert.equal(controllerOf(engine, id("gearPlain")), P1);
  assert.equal(discardOf(engine, P1).includes(id("gearPlain")), false);
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(MAGNET, "1:ability:grapple", "the cost is paid when the ability is used, before responses: the Magnet is already destroyed while the gear waits in the discard pile", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  assert.equal(zoneOf(engine, id("tp")), "discard", "destroyed as a cost");
  assert.equal(zoneOf(engine, id("gearPlain")), "discard", "the gear is not in play yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gearPlain")), "play");
});

clause(MAGNET, "1:ability:grapple", "it costs no resources", () => {
  const { engine, id } = magnetBoard({ elitism: 0 });
  assert.equal(ready(engine), 0);
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("gearPlain")), "play", "usable with no resources at all");
  assert.equal(ready(engine), 0);
});

clause(MAGNET, "1:ability:grapple", "a gear card with ATTACH TO CHARACTER is put into play attached to the host and its own rules apply: a gear giving its host +1 strength does", () => {
  const { engine, id } = magnetBoard();
  assert.equal(engine.getStat(id("host"), "strength"), 2);
  grapple(engine, id, "gearSpiky");
  assert.equal(zoneOf(engine, id("gearSpiky")), "play", "in play, not back in the discard pile");
  assert.equal(attachedToOf(engine, id("gearSpiky")), id("host"));
  assert.equal(engine.getStat(id("host"), "strength"), 3);
  assert.equal(engine.getStat(id("host2"), "strength"), 2, "another character is untouched");
});

clause(MAGNET, "1:ability:grapple", "a card with several subtypes including gear can be picked", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearMulti");
  assert.equal(attachedToOf(engine, id("gearMulti")), id("host"));
  assert.equal(zoneOf(engine, id("gearMulti")), "play");
});

clause(MAGNET, "1:ability:grapple", "the host may be an opponent's character: the gear goes onto it, still under my control", () => {
  const { engine, id } = magnetBoard({ hostKey: "foeHost" });
  grapple(engine, id, "gearPlain", "foeHost");
  assert.equal(zoneOf(engine, id("gearPlain")), "play");
  assert.equal(attachedToOf(engine, id("gearPlain")), id("foeHost"));
  assert.equal(controllerOf(engine, id("gearPlain")), P1);
  assert.equal(ownerOf(engine, id("gearPlain")), P1);
});

clause(MAGNET, "1:ability:grapple", "an opponent's character hosting an ATTACH TO gear card: the gear is in play on it, under my control, and its +1 strength applies", () => {
  const { engine, id } = magnetBoard({ hostKey: "foeHost" });
  grapple(engine, id, "gearSpiky", "foeHost");
  assert.equal(zoneOf(engine, id("gearSpiky")), "play");
  assert.equal(attachedToOf(engine, id("gearSpiky")), id("foeHost"));
  assert.equal(controllerOf(engine, id("gearSpiky")), P1);
  assert.equal(engine.getStat(id("foeHost"), "strength"), 3);
});

clause(MAGNET, "1:ability:grapple", "only a card with the gear subtype can be picked: a non-gear item and a card without a subtype are refused", () => {
  const { engine, id } = magnetBoard();
  const attempt = (key: string) => () => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id(key)], host: [id("host")] } });
  refused(attempt("notGear"), "an item with a different subtype");
  refused(attempt("noSubtype"), "an item with no subtype");
  assert.equal(zoneOf(engine, id("tp")), "play", "refused attempts did not destroy the Magnet");
  attempt("gearPlain")();
  assert.equal(zoneOf(engine, id("tp")), "discard", "control: a gear card is accepted");
});

clause(MAGNET, "1:ability:grapple", "'a gear card' is any card with the subtype, not only items", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearChar");
  assert.equal(zoneOf(engine, id("gearChar")), "play", "a gear character card is accepted and put into play");
});

clause(MAGNET, "1:ability:grapple", "only a card in MY discard pile: the opponent's discard pile, my hand, my deck and gear in play are refused", () => {
  const { engine, id } = magnetBoard();
  const attempt = (key: string) => () => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id(key)], host: [id("host")] } });
  refused(attempt("oGear"), "opponent's discard pile");
  refused(attempt("hGear"), "my hand");
  refused(attempt("kGear"), "my deck");
  refused(attempt("pGear"), "in play");
  assert.equal(zoneOf(engine, id("tp")), "play");
  attempt("gearPlain")();
  assert.equal(zoneOf(engine, id("tp")), "discard");
});

clause(MAGNET, "1:ability:grapple", "exactly one gear card: none or two is refused", () => {
  const { engine, id } = magnetBoard();
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [], host: [id("host")] } }), "no gear card");
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { host: [id("host")] } }), "no declaration");
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain"), id("gearSpiky")], host: [id("host")] } }), "two gear cards");
  assert.equal(zoneOf(engine, id("tp")), "play");
});

clause(MAGNET, "1:ability:grapple", "with no gear card in my discard pile it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "tp", def: printing(MAGNET), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "notGear", def: item({ name: "NotGear" }), owner: P1, zone: "discard" },
      { key: "oGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "discard" }
    ]
  });
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: {} }), "nothing to pick");
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("oGear")], host: [id("host")] } }), "the opponent's gear");
  assert.equal(zoneOf(engine, id("tp")), "play");
});

clause(MAGNET, "1:ability:grapple", "the gear goes onto the character the Magnet was attached to, not another: the host pick is that character", () => {
  const { engine, id } = magnetBoard();
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host2")] } }), "another character is not 'the character'");
  assert.equal(zoneOf(engine, id("tp")), "play");
  refused(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("foeHost")] } }), "an unrelated opponent's character");
  grapple(engine, id, "gearPlain", "host");
  assert.equal(attachedToOf(engine, id("gearPlain")), id("host"));
});

clause(MAGNET, "1:ability:grapple", "if the attached character has left play when it resolves, the gear card does not come into play (the Magnet is still destroyed)", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearSpiky")], host: [id("host")] } });
  // the opponent responds by destroying the host
  engine.perform({ type: "playCard", playerId: P2, cardId: id("killHost"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  assert.notEqual(zoneOf(engine, id("gearSpiky")), "play", "there is no character to attach it to");
  assert.equal(discardOf(engine, P1).includes(id("gearSpiky")), true, "an ATTACH TO card with no host goes to its owner's discard pile (CR 507.2c)");
});

clause(MAGNET, "1:ability:grapple", "if the host is still in play the gear is put into play even if the opponent responds with something else", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("killHost"), selected: { t: [id("foeHost")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeHost")), "discard", "they destroyed their own character instead");
  assert.equal(attachedToOf(engine, id("gearPlain")), id("host"));
});

clause(MAGNET, "1:ability:grapple", "a destroyed Magnet is itself a gear card in my discard pile: a second Magnet can GRAPPLE it back onto its own host", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  activate(engine, P1, id("tp2"), "grapple", { selected: { g: [id("tp")], host: [id("host2")] } });
  assert.equal(zoneOf(engine, id("tp")), "play", "the first Magnet is back in play");
  assert.equal(attachedToOf(engine, id("tp")), id("host2"), "attached to the second Magnet's host");
  assert.equal(zoneOf(engine, id("tp2")), "discard");
});

clause(MAGNET, "1:ability:grapple", "only its controller can use it, and only from play", () => {
  const { engine, id } = magnetBoard({ active: P2 });
  refused(() => activateRaw(engine, P2, id("tp"), "grapple", { selected: { g: [id("oGear")], host: [id("host")] } }), "the opponent does not control it");
  assert.equal(zoneOf(engine, id("tp")), "play");
  const inHand = magnetBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("tp"), "grapple", { selected: { g: [inHand.id("gearPlain")], host: [inHand.id("host")] } }), "from hand");
});

clause(MAGNET, "1:ability:grapple", "it can be used on the opponent's turn in response to their attack", () => {
  const b = magnetBoard({ active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("foeHost")]);
  activateRaw(b.engine, P1, b.id("tp"), "grapple", { selected: { g: [b.id("gearPlain")], host: [b.id("host")] } });
  resolvePendingResponses(b.engine);
  assert.equal(attachedToOf(b.engine, b.id("gearPlain")), b.id("host"));
});

// =============================================================================
// Unrelenting Ridicule
// COST: Pick a character with COVERT. EFFECT: Destroy the character.
// Tactic (gearsmith), cost 2, threshold [E].
// =============================================================================

const RIDICULE = "7a3c2a2f-7eaa-49b3-92c6-148cbd09018f";

function ridiculeBoard(opts: { elitism?: number; greed?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ur", def: printing(RIDICULE), owner: P1, zone: "hand" },
      { key: "foeCov", def: covertChar("FoeCov", { strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeCov2", def: covertChar("FoeCov2", { strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "myCov", def: covertChar("MyCov", { strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foePlain", def: character({ name: "FoePlain", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fdCov", def: covertChar("FdCov"), owner: P2, zone: "play", faceDown: true },
      { key: "handCov", def: covertChar("HandCov"), owner: P2, zone: "hand" },
      { key: "discCov", def: covertChar("DiscCov"), owner: P2, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}
type RidiculeBoard = ReturnType<typeof ridiculeBoard>;
const ridicule = (b: RidiculeBoard, target: string) => play(b.engine, P1, b.id("ur"), { selected: { c: [b.id(target)] } });
const ridiculeRaw = (b: RidiculeBoard, target: string) => playRaw(b.engine, P1, b.id("ur"), { selected: { c: [b.id(target)] } });

clause(RIDICULE, "0:ability", "destroys the picked COVERT character (the opponent's): it goes to its owner's discard pile, the tactic to mine", () => {
  const b = ridiculeBoard();
  ridicule(b, "foeCov");
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
  assert.equal(discardOf(b.engine, P2).includes(b.id("foeCov")), true);
  assert.equal(zoneOf(b.engine, b.id("ur")), "discard");
  assert.equal(discardOf(b.engine, P1).includes(b.id("ur")), true);
});

clause(RIDICULE, "0:ability", "my own COVERT character can be picked and destroyed too", () => {
  const b = ridiculeBoard();
  ridicule(b, "myCov");
  assert.equal(zoneOf(b.engine, b.id("myCov")), "discard");
  assert.equal(discardOf(b.engine, P1).includes(b.id("myCov")), true);
});

clause(RIDICULE, "0:ability", "only the picked character is destroyed: other covert and plain characters survive", () => {
  const b = ridiculeBoard();
  ridicule(b, "foeCov");
  for (const key of ["foeCov2", "myCov", "plain", "foePlain"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(zoneOf(b.engine, b.id("place")), "play");
});

clause(RIDICULE, "0:ability", "pays exactly 2 as the cost, when it is played; the destruction is the effect", () => {
  const b = ridiculeBoard();
  const before = ready(b.engine);
  ridiculeRaw(b, "foeCov");
  assert.equal(before - ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "play", "the destruction is the effect: not yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
});

clause(RIDICULE, "0:ability", "only COVERT characters can be picked: a plain character (mine or theirs), an item, a location, a face-down card, a faction, a card in hand or discard, or nothing is refused, and nothing is paid", () => {
  const b = ridiculeBoard();
  const before = ready(b.engine);
  refused(() => ridiculeRaw(b, "plain"), "my plain character");
  refused(() => ridiculeRaw(b, "foePlain"), "the opponent's plain character");
  refused(() => ridiculeRaw(b, "thing"), "an item");
  refused(() => ridiculeRaw(b, "place"), "a location");
  refused(() => ridiculeRaw(b, "fdCov"), "a face-down card has no keywords");
  refused(() => ridiculeRaw(b, "handCov"), "a covert character in hand");
  refused(() => ridiculeRaw(b, "discCov"), "a covert character in the discard pile");
  refused(() => playRaw(b.engine, P1, b.id("ur"), { selected: { c: [b.engine.state.players[P2].factionId!] } }), "the opponent's faction");
  refused(() => playRaw(b.engine, P1, b.id("ur"), { selected: {} }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("ur"), { selected: { c: [b.id("foeCov"), b.id("foeCov2")] } }), "two characters");
  assert.equal(zoneOf(b.engine, b.id("ur")), "hand");
  assert.equal(ready(b.engine), before, "nothing was paid");
  ridiculeRaw(b, "foeCov");
  assert.ok(b.engine.state.responseWindow, "control: a covert character is accepted");
});

clause(RIDICULE, "0:ability", "a character that gained COVERT this turn is a COVERT character; one that has not is refused", () => {
  const b = ridiculeBoard({ extra: [{ key: "grant", def: grantCovertTactic(), owner: P1, zone: "hand" }] });
  refused(() => ridiculeRaw(b, "foePlain"), "not covert yet");
  play(b.engine, P1, b.id("grant"), { selected: { t: [b.id("foePlain")] } });
  assert.ok(hasKeyword(b.engine, b.id("foePlain"), "covert"), "hasKeyword(b.engine, b.id(\"foePlain\"), \"covert\")");
  ridicule(b, "foePlain");
  assert.equal(zoneOf(b.engine, b.id("foePlain")), "discard");
});

clause(RIDICULE, "0:ability", "can be played in response to an attack by a covert party, destroying the attacker and stopping its battle damage", () => {
  const b = ridiculeBoard({ active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("foeCov")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  ridiculeRaw(b, "foeCov");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
  assert.equal(influence(b.engine, P1), 30, "no damage got through");
});

clause(RIDICULE, "0:ability", "costs 2 and needs [E]: refused one resource short and without [E]; the icon is a gate", () => {
  deployBattery({
    printingId: RIDICULE,
    cost: 2,
    icon: "elitism",
    iconCount: 1,
    ends: "discard",
    extra: [{ key: "t", def: covertChar("T"), owner: P2, zone: "play" }],
    selected: (id) => ({ c: [id("t")] })
  });
});

// =============================================================================
// Ambuscade
// COST: Play this only while you are being attacked. Destroy a character you
// control. X is twice its strength. EFFECT: Inflict X damage divided however you
// want to the attacking party.
// Tactic (rogue), cost 3, threshold [D].
// =============================================================================

const AMBUSH = "0e737db4-b96c-4847-a83b-d95f636ffb4b";

function ambushBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sac0", def: character({ name: "Sac0", strength: 0, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sac1", def: character({ name: "Sac1", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "keep", def: character({ name: "Keep", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "sacDep", def: character({ name: "SacDepleted", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 9 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "atkA", def: character({ name: "AtkA", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "atkB", def: character({ name: "AtkB", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "atkC", def: character({ name: "AtkC", strength: 1, life: 8, speed: 2 }), owner: P2, zone: "play" },
      { key: "idleFoe", def: character({ name: "IdleFoe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeOpener", def: tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type AmbushBoard = ReturnType<typeof ambushBoard>;

/** The opponent attacks my faction (or `myLoc`) with the given attackers and passes: I now hold priority in the attack's response window. */
function beAttacked(board: AmbushBoard, attackerKeys: string[], target: "faction" | "myLoc" = "faction") {
  const { engine, id } = board;
  declareAttackOpenWindow(engine, P2, attackerKeys.map(id), target === "faction" ? { type: "faction", playerId: P1 } : { type: "card", cardId: id("myLoc") });
}

/** Plays Ambuscade with `sacKey` as the destroyed character and `atkKeys` as the attacking party. Does NOT drain the response window. */
function castAmbush(board: AmbushBoard, sacKey: string, atkKeys: string[]) {
  const { engine, id } = board;
  engine.perform({ type: "playCard", playerId: P1, cardId: id("amb"), selected: { c: [id(sacKey)], atk: atkKeys.map(id) }, variables: {} } as never);
}

function divide(engine: SpoilsEngine, shares: Record<string, number>) {
  const pc = pending(engine);
  assert.ok(pc, "a division prompt is open");
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.playerId, P1, "I divide the damage");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  resolvePendingResponses(engine);
}

clause(AMBUSH, "0:ability", "when I am attacked: pays 3, destroys the character I chose, and inflicts X = twice its strength to the lone attacker", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  const before = ready(engine);
  castAmbush(board, "sac3", ["atkA"]);
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "I am asked how to divide the damage");
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.amount, 6, "X = 2 x 3 strength = 6");
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(engine, id("sac3")), "discard", "the character was destroyed");
  assert.equal(zoneOf(engine, id("atkA")), "discard", "6 damage destroys the 5-life attacker");
  assert.equal(zoneOf(engine, id("amb")), "discard", "the tactic ends in my discard pile");
  assert.equal(zoneOf(engine, id("keep")), "play", "my other characters are untouched");
});

clause(AMBUSH, "0:ability", "destroying the character is a COST: it is paid when the tactic is played, before responses", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  castAmbush(board, "sac3", ["atkA"]);
  assert.ok(engine.state.responseWindow, "the tactic is waiting for the opponent's response");
  assert.equal(zoneOf(engine, id("sac3")), "discard", "the character was already destroyed when the tactic was played");
});

for (const [sac, x] of [["sac1", 2], ["sac3", 6], ["sac0", 0]] as const) {
  clause(AMBUSH, "0:ability", `X is twice the destroyed character's strength: strength ${x / 2} gives X=${x}`, () => {
    const board = ambushBoard();
    const { engine, id } = board;
    beAttacked(board, ["atkC"]);
    castAmbush(board, sac, ["atkC"]);
    resolvePendingResponses(engine);
    if (x === 0) {
      assert.equal(pending(engine), undefined, "X = 0: nothing to divide");
    } else {
      assert.equal(pending(engine)?.amount, x);
      divide(engine, { [id("atkC")]: x });
    }
    assert.equal(zoneOf(engine, id(sac)), "discard", "the character was destroyed all the same");
    assert.equal(engine.state.cards[id("atkC")].damage, x, `the attacker took ${x}`);
  });
}

clause(AMBUSH, "0:ability", "X uses the character's CURRENT strength, not its printed one: a +1 strength gear attached to a 3-strength character makes X = 8", () => {
  const board = ambushBoard({ extra: [{ key: "gear", def: spikyGear("BoostGear"), owner: P1, zone: "play", attachedToKey: "sac3" }] });
  const { engine, id } = board;
  assert.equal(engine.getStat(id("sac3"), "strength"), 4);
  beAttacked(board, ["atkC"]);
  castAmbush(board, "sac3", ["atkC"]);
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.amount, 8);
  divide(engine, { [id("atkC")]: 8 });
  assert.equal(zoneOf(engine, id("atkC")), "discard");
});

clause(AMBUSH, "0:ability", "the damage is divided however I want among the attacking party: all on one, or split", () => {
  for (const [shares, label] of [
    [{ atkA: 6, atkB: 0 }, "all 6 on atkA"],
    [{ atkA: 0, atkB: 6 }, "all 6 on atkB"],
    [{ atkA: 4, atkB: 2 }, "4 and 2"],
    [{ atkA: 3, atkB: 3 }, "3 and 3"],
    [{ atkA: 5, atkB: 1 }, "5 and 1"]
  ] as const) {
    const board = ambushBoard();
    const { engine, id } = board;
    beAttacked(board, ["atkA", "atkB"]);
    castAmbush(board, "sac3", ["atkA", "atkB"]);
    resolvePendingResponses(engine);
    divide(engine, { [id("atkA")]: shares.atkA, [id("atkB")]: shares.atkB });
    if (zoneOf(engine, id("atkA")) === "play") assert.equal(engine.state.cards[id("atkA")].damage, shares.atkA, `${label}: damage on atkA`);
    if (zoneOf(engine, id("atkB")) === "play") assert.equal(engine.state.cards[id("atkB")].damage, shares.atkB, `${label}: damage on atkB`);
    assert.equal(zoneOf(engine, id("atkA")), shares.atkA >= 5 ? "discard" : "play", `${label}: atkA (5 life)`);
    assert.equal(zoneOf(engine, id("atkB")), shares.atkB >= 2 ? "discard" : "play", `${label}: atkB (2 life)`);
    assert.equal(zoneOf(engine, id("idleFoe")), "play", "a character not in the attacking party is untouched");
  }
});

clause(AMBUSH, "0:ability", "the division cannot exceed X, nor go to anyone outside the attacking party: over-dividing, an idle opponent character and my own character are refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac3", ["atkA", "atkB"]);
  resolvePendingResponses(engine);
  const attempt = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  refused(attempt({ [id("atkA")]: 4, [id("atkB")]: 4 }), "8 of 6");
  refused(attempt({ [id("atkA")]: 5, [id("idleFoe")]: 1 }), "a character outside the attacking party");
  refused(attempt({ [id("atkA")]: 5, [id("sac1")]: 1 }), "one of my own characters");
  assert.equal(pending(engine)?.kind, "distributeAmong", "still waiting for a legal division");
  divide(engine, { [id("atkA")]: 4, [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard", "control: an exact division is accepted");
});

clause(AMBUSH, "0:ability", "the whole X must be assigned: dividing less than X (5 of 6, or nothing at all) is refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac3", ["atkA", "atkB"]);
  resolvePendingResponses(engine);
  const attempt = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  refused(attempt({ [id("atkA")]: 3, [id("atkB")]: 2 }), "5 of 6");
  refused(attempt({}), "no damage at all");
  assert.equal(pending(engine)?.kind, "distributeAmong", "still waiting for a division that adds up to X");
});

clause(AMBUSH, "0:ability", "the damage goes to the attacking party only: my own characters and the idle opponent character take none", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  castAmbush(board, "sac3", ["atkA"]);
  resolvePendingResponses(engine);
  divide(engine, { [id("atkA")]: 6 });
  for (const key of ["keep", "sac1", "sac0", "idleFoe", "atkB", "atkC"]) assert.equal(engine.state.cards[id(key)].damage, 0, `${key} took nothing`);
});

clause(AMBUSH, "0:ability", "attackers whose damage reaches their life are destroyed and leave the battle; the others stay in it", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac1", ["atkA", "atkB"]);
  resolvePendingResponses(engine);
  divide(engine, { [id("atkA")]: 0, [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atkA")], "only atkA is still attacking");
});

clause(AMBUSH, "0:ability", "killing the whole attacking party ends the battle without damage to my faction", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkB"]);
  castAmbush(board, "sac1", ["atkB"]);
  resolvePendingResponses(engine);
  divide(engine, { [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard");
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined, "no battle left");
  assert.equal(influence(engine, P1), 30, "my faction took no damage");
});

clause(AMBUSH, "0:ability", "playable only while I am being attacked: refused on the opponent's turn with no attack, and on my own turn with no battle", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  refused(() => castAmbush(board, "sac3", ["atkA"]), "the opponent's turn but no attack has been declared");
  assert.equal(zoneOf(engine, id("sac3")), "play", "nothing was destroyed by the refused play");
  assert.equal(ready(engine), 5, "nothing was spent");
  assert.equal(zoneOf(engine, id("amb")), "hand");
  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  refused(() => playRaw(mine.engine, P1, mine.id("amb"), { selected: { c: [mine.id("sac3")], atk: [mine.id("foe")] } }), "my own turn, no battle");
  assert.equal(mine.engine.getCardPlayability(P1, mine.id("amb")).playable, false);
});

clause(AMBUSH, "0:ability", "refused when I am the one attacking (I am not being attacked)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  refused(() => playRaw(engine, P1, id("amb"), { selected: { c: [id("sac3")], atk: [id("atk")] } }), "I am attacking, not being attacked");
  assert.equal(zoneOf(engine, id("sac3")), "play");
});

clause(AMBUSH, "0:ability", "'being attacked' includes an attack on a location I control", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"], "myLoc");
  castAmbush(board, "sac3", ["atkA"]);
  resolvePendingResponses(engine);
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(zoneOf(engine, id("atkA")), "discard");
});

clause(AMBUSH, "0:ability", "can also be played later in the battle, in a response window after blockers were declared", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("keep")] });
  assert.ok(engine.state.responseWindow, "the first battle-resolution response window is open");
  const window = engine.state.responseWindow;
  if (window && window.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  castAmbush(board, "sac3", ["atkA"]);
  resolvePendingResponses(engine);
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(zoneOf(engine, id("atkA")), "discard");
});

clause(AMBUSH, "0:ability", "the destroyed character must be one I control: an opponent's character, an item, a location, and a card in hand are refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  const attempt = (picked: string) => () => castAmbush(board, picked, ["atkA"]);
  refused(attempt("atkB"), "their character");
  refused(attempt("idleFoe"), "their idle character");
  refused(attempt("myItem"), "my item");
  refused(attempt("myLoc"), "my location");
  refused(attempt("amb"), "the tactic itself in hand");
  assert.equal(zoneOf(engine, id("sac3")), "play");
  assert.equal(ready(engine), 5, "nothing was spent");
  attempt("sac3")();
  assert.ok(engine.state.responseWindow, "control: my character is accepted");
});

clause(AMBUSH, "0:ability", "a depleted character of mine can be the one destroyed", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkC"]);
  castAmbush(board, "sacDep", ["atkC"]);
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.amount, 4, "2 strength: X = 4");
  divide(engine, { [id("atkC")]: 4 });
  assert.equal(zoneOf(engine, id("sacDep")), "discard");
});

clause(AMBUSH, "0:ability", "needs a character of mine to destroy: with none, it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => playRaw(engine, P1, id("amb"), { selected: { c: [], atk: [id("atk")] } }), "no character to destroy");
  assert.equal(zoneOf(engine, id("amb")), "hand");
});

clause(AMBUSH, "0:ability", "is refused one resource short of its cost of 3, and without [D] even with plenty of other resources", () => {
  const short = ambushBoard({ deception: 2 });
  beAttacked(short, ["atkA"]);
  refused(() => castAmbush(short, "sac3", ["atkA"]), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("sac3")), "play");
  const noD = ambushBoard({ deception: 0, greed: 6 });
  beAttacked(noD, ["atkA"]);
  refused(() => castAmbush(noD, "sac3", ["atkA"]), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("sac3")), "play");
  const exact = ambushBoard({ deception: 3 });
  beAttacked(exact, ["atkA"]);
  castAmbush(exact, "sac3", ["atkA"]);
  resolvePendingResponses(exact.engine);
  divide(exact.engine, { [exact.id("atkA")]: 6 });
  assert.equal(zoneOf(exact.engine, exact.id("atkA")), "discard", "one [D] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(AMBUSH, "0:ability", "the damage goes to the actual attackers: a non-attacker cannot be named as the attacking party", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  refused(() => castAmbush(board, "sac3", ["atkA", "idleFoe"]), "idleFoe is not attacking");
  refused(() => castAmbush(board, "sac3", ["idleFoe", "atkC"]), "neither is attacking");
  assert.equal(zoneOf(engine, id("sac3")), "play");
});

// =============================================================================
// Auction House
// At the start of each player's turn, that player reveals cards from the top of
// their deck until a character is revealed or no cards are left. If a character
// is revealed, players take turns bidding on the character (starting with the
// active player). Players cannot bid a number greater than the number of detached
// resources they control. Whichever player makes the winning bid pays that many
// resources and puts the character into play under their control. Shuffle all
// other revealed cards into their owner's deck.
// Location (rogue), cost 3, threshold [D][D][D], structure 4.
// =============================================================================

const AUCTION = "ae9ae5db-e784-4193-ad45-400f7ba900bc";

const prizeChar = (name: string): Def => character({ name, strength: 2, life: 3, speed: 2 });

/** The standard deck of the player whose turn starts: four non-characters, the prize character, then two more cards (top first). */
function auctionDeck(owner: Pid, prefix = ""): CardPlacement[] {
  return [
    { key: `${prefix}it1`, def: item({ name: `${prefix}It1` }), owner, zone: "deck" },
    { key: `${prefix}tac1`, def: tactic({ name: `${prefix}Tac1` }), owner, zone: "deck" },
    { key: `${prefix}loc1`, def: location({ name: `${prefix}Loc1` }), owner, zone: "deck" },
    { key: `${prefix}res1`, def: resourceCard({ name: `${prefix}Res1` }), owner, zone: "deck" },
    { key: `${prefix}ch1`, def: prizeChar(`${prefix}Prize`), owner, zone: "deck" },
    { key: `${prefix}x1`, def: item({ name: `${prefix}X1` }), owner, zone: "deck" },
    { key: `${prefix}ch2`, def: prizeChar(`${prefix}Second`), owner, zone: "deck" }
  ];
}

interface AuctionOpts {
  /** Whose turn is about to start. */
  startOf: Pid;
  houseOwner?: Pid;
  houseZone?: "play" | "hand" | "discard";
  houseFaceDown?: boolean;
  /** Deck of the player whose turn starts (default: the standard deck); [] for an empty deck. */
  deck?: CardPlacement[];
  /** Ready (detached) resources for each player at the moment their bidding happens. */
  ready1?: number;
  ready2?: number;
  /** Already-spent resources (attached to the faction) for each player. */
  spent1?: number;
  spent2?: number;
  random?: () => number;
  extra?: CardPlacement[];
}

function auctionBoard(opts: AuctionOpts) {
  const startOf = opts.startOf;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: other(startOf),
    random: opts.random ?? (() => 0),
    cards: [
      { key: "house", def: printing(AUCTION), owner: opts.houseOwner ?? P1, zone: opts.houseZone ?? "play", faceDown: opts.houseFaceDown },
      ...(opts.deck ?? auctionDeck(startOf)),
      // the other player's deck must stay untouched by this turn start
      ...auctionDeck(other(startOf), "o"),
      ...bank("greed", opts.ready1 ?? 0, P1),
      ...bank("greed", opts.ready2 ?? 0, P2),
      ...spentResources(P1, opts.spent1 ?? 0),
      ...spentResources(P2, opts.spent2 ?? 0),
      ...(opts.extra ?? [])
    ]
  });
}
type AuctionBoard = ReturnType<typeof auctionBoard>;

/** The turn of `startOf` begins (the other player ends theirs). */
function beginTurn(b: AuctionBoard, startOf: Pid) {
  endTurn(b.engine, other(startOf));
  assert.equal(b.engine.state.activePlayerId, startOf);
}

const bid = (b: AuctionBoard, player: Pid, amount: number) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "auctionBid", bid: amount } } as never);
  resolvePendingResponses(b.engine);
};
const bidRaw = (b: AuctionBoard, player: Pid, amount: number) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "auctionBid", bid: amount } } as never);
const bidPrompt = (b: AuctionBoard) => {
  const pc = pending(b.engine);
  return pc?.kind === "auctionBid" ? pc : undefined;
};
/** Ids of the cards in play named `name`. */
const inPlayNamed = (b: AuctionBoard, name: string) =>
  Object.values(b.engine.state.cards)
    .filter((c) => c.zone === "play" && b.engine.getDefinition(c.id).name === name)
    .map((c) => c.id);
const revealedBy = (b: AuctionBoard) =>
  b.engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .map((entry) => entry.event as unknown as { cardIds: string[]; ownerId?: string });

clause(AUCTION, "0:rule", "at the start of the player's turn it reveals cards from the top of THEIR deck down to and including the first character, and bidding opens", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  const oppDeck = [...deckOf(b.engine, P1)];
  beginTurn(b, P2);
  const reveals = revealedBy(b).filter((ev) => ev.cardIds.includes(b.id("ch1")));
  assert.equal(reveals.length, 1, "one reveal that reaches the prize");
  assert.deepEqual(reveals[0].cardIds, ["it1", "tac1", "loc1", "res1", "ch1"].map(b.id), "top to bottom, up to and including the first character");
  assert.ok(bidPrompt(b), "bidding is open");
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  assert.deepEqual(deckOf(b.engine, P1), oppDeck, "the other player's deck was not touched");
});

clause(AUCTION, "0:rule", "the reveal skips every non-character: items, tactics, locations and resource cards are passed over", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"), "the first character, not the item on top");
});

clause(AUCTION, "0:rule", "it triggers at the start of EACH player's turn: at the start of mine it reveals from MY deck", () => {
  const b = auctionBoard({ startOf: P1, ready1: 3 });
  const oppDeck = [...deckOf(b.engine, P2)];
  beginTurn(b, P1);
  const pc = bidPrompt(b);
  assert.ok(pc, "bidding is open at the start of my turn too");
  assert.equal(pc.characterId, b.id("ch1"), "my deck's character");
  assert.equal(pc.playerId, P1, "I am the active player and bid first");
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck was not touched");
});

clause(AUCTION, "0:rule", "it works whoever controls it: the opponent's Auction House reveals from my deck at the start of my turn, and from theirs at the start of theirs", () => {
  const b = auctionBoard({ startOf: P1, houseOwner: P2, ready1: 3 });
  beginTurn(b, P1);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  const c = auctionBoard({ startOf: P2, houseOwner: P2, ready2: 3 });
  beginTurn(c, P2);
  assert.equal(bidPrompt(c)?.characterId, c.id("ch1"), "and at the start of its controller's own turn");
});

clause(AUCTION, "0:rule", "the first bid belongs to the active player, then the other player, alternating", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.playerId, P2, "the active player bids first");
  bid(b, P2, 1);
  assert.equal(bidPrompt(b)?.playerId, P1, "then the other player");
  bid(b, P1, 2);
  assert.equal(bidPrompt(b)?.playerId, P2, "then back to the first");
});

clause(AUCTION, "0:rule", "only the player whose turn it is to bid can answer", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P1, 1), "it is the active player's bid", /not your decision/);
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "each bid must be higher than the last: equal or lower bids are refused", () => {
  const b = auctionBoard({ startOf: P2, ready1: 6, ready2: 6 });
  beginTurn(b, P2);
  bid(b, P2, 2);
  refused(() => bidRaw(b, P1, 2), "equal to the last bid");
  refused(() => bidRaw(b, P1, 1), "lower than the last bid");
  assert.equal(bidPrompt(b)?.playerId, P1, "still waiting for my bid");
  bid(b, P1, 3);
  refused(() => bidRaw(b, P2, 3), "equal to the last bid");
  bid(b, P2, 4);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "a player cannot bid more than the detached resources they control: 4 with 3 is refused, 3 is fine", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 4), "only 3 detached resources");
  assert.equal(bidPrompt(b)?.playerId, P2, "the bid is still open");
  bid(b, P2, 3);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "only DETACHED resources count: resources already spent (attached to the faction) do not raise the cap", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2, ready1: 2, spent1: 3 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  refused(() => bidRaw(b, P1, 3), "5 resources, but 3 are attached");
  refused(() => bidRaw(b, P1, 5), "all five");
  bid(b, P1, 2);
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "the active player's spent resources are detached by the turn-start restore, so they all count", () => {
  const b = auctionBoard({ startOf: P2, spent2: 4 });
  beginTurn(b, P2);
  assert.equal(ready(b.engine, P2), 4, "restored: all four are detached");
  bid(b, P2, 4);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "a player with no detached resources cannot bid at all: only passing is possible", () => {
  const b = auctionBoard({ startOf: P2, ready2: 0, ready1: 2 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 1), "no detached resources");
  bid(b, P2, 0);
  assert.equal(bidPrompt(b)?.playerId, P1, "I may still bid");
});

clause(AUCTION, "0:rule", "a bid must be a whole number: 1.5 and negative numbers are refused (CR 410.2)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 1.5), "a fractional bid");
  refused(() => bidRaw(b, P2, -1), "a negative bid");
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "the highest bidder wins: the character enters play under their control, they pay exactly the winning bid, the loser pays nothing", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 2);
  bid(b, P2, 0);
  assert.equal(b.engine.state.pendingChoice, undefined, "the auction is over");
  const prize = b.id("ch1");
  assert.equal(zoneOf(b.engine, prize), "play");
  assert.equal(controllerOf(b.engine, prize), P1, "under the winner's control, although it came from the other player's deck");
  assert.equal(ownerOf(b.engine, prize), P2, "ownership never changes");
  assert.equal(ready(b.engine, P1), 3, "I paid my winning bid of 2");
  assert.equal(ready(b.engine, P2), 5, "the loser pays nothing");
});

clause(AUCTION, "0:rule", "the winner pays by attaching that many resources to their faction (they are not destroyed)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4 });
  beginTurn(b, P2);
  const before = attachedResources(b.engine, P2).length;
  bid(b, P2, 3);
  bid(b, P1, 0);
  assert.equal(attachedResources(b.engine, P2).length - before, 3);
  assert.equal(ready(b.engine, P2), 1);
  assert.equal(playOf(b.engine, P2).filter((c) => b.engine.isResource(c)).length, 4, "all four resources are still in play");
});

clause(AUCTION, "0:rule", "the active player can win too: bidding 2 while the other passes puts the character into play under the active player's control", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 2);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(controllerOf(b.engine, b.id("ch1")), P2);
  assert.equal(ready(b.engine, P2), 2);
  assert.equal(ready(b.engine, P1), 4);
});

clause(AUCTION, "0:rule", "the other player can win with a first bid after the active player passes", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  assert.equal(bidPrompt(b)?.playerId, P1, "I still get to bid");
  bid(b, P1, 1);
  // (whether the active player is asked again is covered by the CR 413.1b test; answer with a pass if so)
  while (bidPrompt(b)) bid(b, bidPrompt(b)!.playerId as Pid, 0);
  assert.equal(controllerOf(b.engine, b.id("ch1")), P1);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(ready(b.engine, P1), 3);
});

clause(AUCTION, "0:rule", "a player who has passed may not bid again (CR 413.1b): after the active player passes and I bid, the auction is over", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 1);
  assert.equal(b.engine.state.pendingChoice, undefined, "the active player passed and may not bid again: I win with 1");
  assert.equal(controllerOf(b.engine, b.id("ch1")), P1);
});

clause(AUCTION, "0:rule", "if nobody bids, nobody puts the character into play and nothing is paid", () => {
  const b = auctionBoard({ startOf: P2, ready1: 3, ready2: 3 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.notEqual(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(inPlayNamed(b, "Prize").length, 0);
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(ready(b.engine, P2), 3);
});

clause(AUCTION, "0:rule", "after a winning bid all the other revealed cards are shuffled into their owner's deck (not lost, and not in a hand, the discard pile or play)", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5, random: () => 0 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  const others = ["it1", "tac1", "loc1", "res1"].map(b.id);
  for (const c of others) assert.equal(zoneOf(b.engine, c), "deck", "marked as being in the deck");
  assert.deepEqual(
    sorted(deckOf(b.engine, P2)),
    sorted(["it1", "tac1", "loc1", "res1", "x1", "ch2"].map(b.id)),
    "the deck holds the 4 shuffled cards and the 2 never revealed, without the prize"
  );
  assert.equal(hand(b.engine, P2).length, 0);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(AUCTION, "0:rule", "after a winning bid the returned cards really are shuffled: the deck is not left in its original order", () => {
  const b = auctionBoard({ startOf: P2, ready2: 5, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  const afterSettle = deckOf(b.engine, P2);
  const expectedMembers = original.filter((c) => c !== b.id("ch1"));
  assert.deepEqual(sorted(afterSettle), sorted(expectedMembers), "the six non-prize cards are in the deck");
  assert.notDeepEqual(afterSettle, [b.id("x1"), b.id("ch2"), b.id("it1"), b.id("tac1"), b.id("loc1"), b.id("res1")], "not the unrevealed cards followed by the revealed ones in order");
  assert.notDeepEqual(afterSettle, expectedMembers, "not in the original order");
});

clause(AUCTION, "0:rule", "when nobody bids, all revealed cards are shuffled back: the deck holds every card again, in a new order", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.deepEqual(sorted(deckOf(b.engine, P2)), sorted(original));
  assert.notDeepEqual(deckOf(b.engine, P2), original, "shuffled");
  assert.equal(hand(b.engine, P2).length, 0);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(AUCTION, "0:rule", "with no character in the deck every card is revealed, shuffled back, and there is no bidding", () => {
  const noChars = auctionDeck(P2).filter((p) => p.def.type !== "character");
  const b = auctionBoard({ startOf: P2, deck: noChars, ready2: 3, ready1: 3, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no bidding");
  assert.deepEqual(sorted(deckOf(b.engine, P2)), sorted(original), "all cards are back in the deck");
  const reveals = revealedBy(b).filter((ev) => ev.cardIds.length === original.length);
  assert.equal(reveals.length, 1, "every card was revealed");
  assert.notDeepEqual(deckOf(b.engine, P2), original, "and shuffled");
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(ready(b.engine, P2), 3);
});

clause(AUCTION, "0:rule", "an empty deck: nothing is revealed and the turn goes on", () => {
  const b = auctionBoard({ startOf: P2, deck: [], ready2: 3 });
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(AUCTION, "0:rule", "a character on top: only that card is revealed, there is nothing to shuffle back, and the winner gets it", () => {
  const deck: CardPlacement[] = [
    { key: "ch1", def: prizeChar("Prize"), owner: P2, zone: "deck" },
    { key: "x1", def: item({ name: "X1" }), owner: P2, zone: "deck" }
  ];
  const b = auctionBoard({ startOf: P2, deck, ready2: 2 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.deepEqual(deckOf(b.engine, P2), [b.id("x1")]);
});

clause(AUCTION, "0:rule", "only the first character is the prize: a second character further down stays in the deck, unrevealed", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch2")), "deck");
  assert.equal(revealedBy(b).some((ev) => ev.cardIds.includes(b.id("ch2"))), false, "never revealed");
});

clause(AUCTION, "0:rule", "the character is put into play (not deployed): its enters-play trigger works for the winner", () => {
  const etb = character({
    name: "Prize",
    strength: 2,
    life: 3,
    speed: 2,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const deck: CardPlacement[] = [
    { key: "ch1", def: etb, owner: P2, zone: "deck" },
    ...Array.from({ length: 3 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
    ...Array.from({ length: 2 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "deck" as const }))
  ];
  const b = auctionBoard({ startOf: P2, deck, ready1: 3, ready2: 3 });
  const p1Hand = hand(b.engine, P1).length;
  const p2Hand = hand(b.engine, P2).length;
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 2);
  bid(b, P2, 0);
  drain(b.engine, declineAll);
  assert.equal(hand(b.engine, P1).length, p1Hand + 1, "the winner (controller) draws from the trigger");
  assert.equal(hand(b.engine, P2).length, p2Hand, "the deck's owner does not");
});

clause(AUCTION, "0:rule", "a character put into play at the start of the turn cannot attack that turn (CR 204.3b)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(controllerOf(b.engine, b.id("ch1")), P2);
  refused(() => b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("ch1")], target: { type: "faction", playerId: P1 } }), "not in play since the start of the turn");
});

clause(AUCTION, "0:rule", "the turn carries on normally once the auction is over: no pending choice or response window is left", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
  const handBefore = hand(b.engine, P2).length;
  developDraw(b.engine, P2);
  assert.equal(hand(b.engine, P2).length, handBefore + 1, "the active player can use their develop rule as usual");
});

clause(AUCTION, "0:rule", "it does nothing when it is not in play: an Auction House in the hand or in the discard pile reveals nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const b = auctionBoard({ startOf: P2, houseZone: zone, ready2: 3 });
    const deck = [...deckOf(b.engine, P2)];
    beginTurn(b, P2);
    assert.equal(b.engine.state.pendingChoice, undefined, `${zone}: no bidding`);
    assert.deepEqual(deckOf(b.engine, P2), deck, `${zone}: the deck is untouched`);
    assert.equal(revealedBy(b).length, 0);
  }
});

clause(AUCTION, "0:rule", "a face-down Auction House is only a resource and does nothing", () => {
  const b = auctionBoard({ startOf: P2, houseFaceDown: true, ready2: 3 });
  const deck = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), deck);
});

clause(AUCTION, "0:rule", "once it is destroyed it stops: the next turn start reveals nothing", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3, extra: [{ key: "kill", def: destroyTactic("location"), owner: P1, zone: "hand" }] });
  // it is P2's turn that is about to start, so P1 (the active player now) can play the tactic first
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("house")] } });
  assert.equal(zoneOf(b.engine, b.id("house")), "discard");
  const deck = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), deck);
});

clause(AUCTION, "0:rule", "two Auction Houses each run an auction at the start of the turn, one after the other", () => {
  const chars = (owner: Pid): CardPlacement[] => Array.from({ length: 4 }, (_, i) => ({ key: `c${i}`, def: prizeChar(`C${i}`), owner, zone: "deck" as const }));
  const b = auctionBoard({ startOf: P2, deck: chars(P2), ready2: 3, ready1: 3, extra: [{ key: "house2", def: printing(AUCTION), owner: P1, zone: "play" }] });
  beginTurn(b, P2);
  // two copies of the same trigger ask the active player for an order first
  while (pending(b.engine)?.kind === "orderTriggers") {
    const pc = pending(b.engine) as unknown as { triggers: unknown[]; playerId: string };
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers[0] } } as never);
    resolvePendingResponses(b.engine);
  }
  assert.ok(bidPrompt(b), "the first auction");
  bid(b, P2, 0);
  bid(b, P1, 0);
  const second = bidPrompt(b);
  assert.ok(second, "the second Auction House starts its own auction");
  assert.equal(second.playerId, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(AUCTION, "0:rule", "costs 3 with [D][D][D] and has structure 4", () => {
  deployBattery({ printingId: AUCTION, cost: 3, icon: "deception", iconCount: 3 });
  const b = auctionBoard({ startOf: P2 });
  assert.equal(b.engine.getStat(b.id("house"), "structure"), 4);
  assert.deepEqual(b.engine.getCardTypes(b.id("house")), ["location"]);
});

// =============================================================================
// Card Counter
// When this card enters play, flip a coin. If you win X, is 3. Otherwise, X is 2.
// Put the top X cards of your opponent's deck into their discard pile.
// Character (thief, rogue), cost 3, threshold [D], 2 strength / 1 life / 3 speed.
// =============================================================================

const COUNTER = "93fe1f56-4619-4b79-a41e-7c8067fca386";

/** A seeded RNG that always wins a coin flip (`random() < 0.5`) / always loses it. */
const WIN = () => 0.1;
const LOSE = () => 0.9;

const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => {
      const ev = entry.event as unknown as { playerId: string; won: boolean };
      return { playerId: ev.playerId, won: ev.won };
    });

function counterBoard(opts: { deception?: number; greed?: number; random?: () => number; oppDeck?: number; myDeck?: number; zone?: "hand" | "play" | "discard"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: opts.random,
    cards: [
      { key: "me", def: printing(COUNTER), owner: P1, zone: opts.zone ?? "hand" },
      ...fillers("o", opts.oppDeck ?? 8, P2, "deck"),
      ...fillers("m", opts.myDeck ?? 4, P1, "deck"),
      { key: "revive", def: reviveTactic("character"), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(COUNTER, "0:rule", "winning the flip: X is 3, the top 3 cards of the opponent's deck go to their discard pile, in order, and the rest stay", () => {
  const { engine, id } = counterBoard({ random: WIN });
  const oppDeck = [...deckOf(engine, P2)];
  const myDeck = [...deckOf(engine, P1)];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }]);
  assert.deepEqual(sorted(discardOf(engine, P2)), sorted(oppDeck.slice(0, 3)), "exactly the top 3 are milled");
  for (const cardId of oppDeck.slice(0, 3)) assert.equal(zoneOf(engine, cardId), "discard");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(3), "the rest of the opponent's deck is untouched and in order");
  assert.deepEqual(deckOf(engine, P1), myDeck, "my own deck is untouched");
  assert.deepEqual(discardOf(engine, P1), [], "nothing went to my discard pile");
});

clause(COUNTER, "0:rule", "losing the flip: X is 2, exactly the top 2 cards are milled and the third is not", () => {
  const { engine, id } = counterBoard({ random: LOSE });
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.deepEqual(sorted(discardOf(engine, P2)), sorted(oppDeck.slice(0, 2)), "exactly the top 2 are milled");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2));
  assert.equal(zoneOf(engine, oppDeck[2]), "deck", "the third card stays");
  assert.equal(deckOf(engine, P1).length, 4, "my deck is untouched");
});

clause(COUNTER, "0:rule", "the coin is flipped by the Counter's controller, exactly once", () => {
  const { engine, id } = counterBoard({ random: WIN });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(coinFlips(engine).length, 1);
  assert.equal(coinFlips(engine)[0].playerId, P1);
});

clause(COUNTER, "0:rule", "the milled cards go to the opponent's discard pile (their owner's), never to the Counter's controller", () => {
  const { engine, id } = counterBoard({ random: WIN });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(discardOf(engine, P1).length, 0);
  assert.equal(discardOf(engine, P2).length, 3);
  for (const cardId of discardOf(engine, P2)) assert.equal(ownerOf(engine, cardId), P2);
});

clause(COUNTER, "0:rule", "an opponent's deck smaller than X: as many as it has are milled (3-flip against 2 cards, 2-flip against 1 card)", () => {
  const win = counterBoard({ random: WIN, oppDeck: 2 });
  play(win.engine, P1, win.id("me"));
  drain(win.engine, declineAll);
  assert.equal(deckOf(win.engine, P2).length, 0);
  assert.equal(discardOf(win.engine, P2).length, 2);
  assert.equal(zoneOf(win.engine, win.id("me")), "play");
  const lose = counterBoard({ random: LOSE, oppDeck: 1 });
  play(lose.engine, P1, lose.id("me"));
  drain(lose.engine, declineAll);
  assert.equal(deckOf(lose.engine, P2).length, 0);
  assert.equal(discardOf(lose.engine, P2).length, 1);
});

clause(COUNTER, "0:rule", "an empty opponent deck is harmless (nothing to mill)", () => {
  const { engine, id } = counterBoard({ random: WIN, oppDeck: 0 });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(COUNTER, "0:rule", "exactly X cards: a 3-card deck is emptied by a won flip, and a lost flip leaves 1", () => {
  const win = counterBoard({ random: WIN, oppDeck: 3 });
  play(win.engine, P1, win.id("me"));
  drain(win.engine, declineAll);
  assert.equal(deckOf(win.engine, P2).length, 0);
  assert.equal(discardOf(win.engine, P2).length, 3);
  const lose = counterBoard({ random: LOSE, oppDeck: 3 });
  play(lose.engine, P1, lose.id("me"));
  drain(lose.engine, declineAll);
  assert.equal(deckOf(lose.engine, P2).length, 1);
  assert.equal(discardOf(lose.engine, P2).length, 2);
});

clause(COUNTER, "0:rule", "the mill happens when this card enters play, not on being played from hand", () => {
  const { engine, id } = counterBoard({ random: WIN });
  playRaw(engine, P1, id("me"));
  assert.equal(discardOf(engine, P2).length, 0, "nothing milled while the opponent can still respond");
  assert.equal(coinFlips(engine).length, 0);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(COUNTER, "0:rule", "it also happens when the Counter is put into play by an effect rather than deployed", () => {
  // the Counter starts in the discard pile, then the revive tactic puts it into play
  const { engine, id } = counterBoard({ random: WIN, zone: "discard" });
  assert.equal(zoneOf(engine, id("me")), "discard");
  play(engine, P1, id("revive"), { selected: { t: [id("me")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(coinFlips(engine).length, 1);
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(COUNTER, "0:rule", "another card entering play does not mill: no flip and no discard", () => {
  const { engine, id } = counterBoard({
    random: WIN,
    zone: "play",
    extra: [{ key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("other"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(COUNTER, "0:rule", "played face-down as a resource it is only a resource: no flip and no mill", () => {
  const { engine, id } = counterBoard({ random: WIN });
  developResource(engine, P1, id("me"), true);
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(COUNTER, "0:rule", "pays exactly its printed cost of 3, needs [D], is refused one resource short, and has printed stats 2/1/3", () => {
  deployBattery({ printingId: COUNTER, cost: 3, icon: "deception", iconCount: 1 });
  const { engine, id } = counterBoard({ zone: "play" });
  assert.deepEqual(stat(engine, id("me")), [2, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("me")), ["thief"]);
  assert.equal(engine.getDefinition(id("me")).trade, "rogue");
});

// <<END>>
