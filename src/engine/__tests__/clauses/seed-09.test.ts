// Clause tests — batch seed-09. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-09`. Expectations come from each card's
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
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { developDraw, developResource, endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement, DamageSource } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;
const START = 30; // developFaction() starting influence

/** A P1 / P2 board whose factions can both develop. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** `n` face-up Rage resources for `owner`, already attached to (spent on) `owner`'s faction. They still provide their [R] icons. */
function spentRage(owner: PlayerId, n: number): CardPlacement[] {
  return bank("rage", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
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

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Answers `chooserSelectsOption` with `index`, `chooserSelectsTarget` with `selected`, orderTriggers by taking the first, anything else by declining. */
function answerWith(opts: { option?: number; selected?: CardInstanceId[] }) {
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: opts.option ?? 0 };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: opts.selected ?? [] };
    return declineAll(pc);
  };
}

// --- synthetic helper cards (free tactics that drive a scenario) --------------------

/** A free tactic (id "dmg", pick "t"): inflicts `amount` damage to one character. */
function zapTactic(amount: number, name = `Zap ${amount}`): CardDefinition {
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

/** A free tactic (id "dest", pick "t"): destroys one card of `type` in play. */
function destroyerTactic(type: "location" | "item" | "resource" | "character", name = `Destroy a ${type}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dest",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "buff", pick "t"): the picked character gets `amount` of `stat` this turn (negative = debuff). */
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

/** A free tactic (id "bounce", pick "t"): returns one card in play to its owner's hand. */
function bouncerTactic(name = "Bouncer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bounce",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/** A free tactic (id "fdown", pick "t"): flips one character in play face-down. */
function flipDownTactic(name = "Flip Down"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fdown",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "loss"): `who`'s faction LOSES `amount` influence (not damage). */
function lossTactic(amount: number, who: "controller" | "opponent", name = `Lose ${who} ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "loss", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] }
  });
}

/** A free tactic (id "gain"): `who`'s faction GAINS `amount` influence. */
function gainTactic(amount: number, who: "controller" | "opponent", name = `Gain ${who} ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "gain", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount }] }] }
  });
}

/** A free tactic (id "burn"): inflicts `amount` damage to `who`'s faction. */
function burnTactic(amount: number, who: "controller" | "opponent", name = `Burn ${who} ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }] }] }
  });
}

/** A free tactic (id "grab", pick "t"): its controller takes control of one character in play. */
function grabTactic(name = "Grab"): CardDefinition {
  return tactic({
    name,
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
}

/** A free tactic (id "pip", pick "t"): puts one card from the controller's hand into play. */
function putIntoPlayTactic(name = "Smuggle"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes one card in play from the game. */
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

/** A free tactic (id "discrm", pick "t"): removes one card in a discard pile from the game. */
function discardRemoverTactic(name = "Discard Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "discrm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "any" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "lzap", pick "t"): inflicts `amount` damage to one location. */
function locationZapTactic(amount: number, name = `Location Zap ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "lzap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "sweep"): destroys every character in play. */
function sweepTactic(name = "Sweep"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
}

/** A free tactic (id "dep", pick "t"): depletes one character. */
function depleteTactic(name = "Exhaust"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dep",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A location with a static "your characters gain `amount` strength" (id "anth"). */
function anthemLocation(amount = 2, name = "Rally Banner"): CardDefinition {
  return location({
    name,
    structure: 9,
    behavior: {
      abilities: [
        {
          id: "anth",
          type: "continuous",
          modifiers: [{ selector: { type: "character", controller: "self" }, stat: "strength", operation: "add", value: amount }]
        }
      ]
    }
  });
}

/** A plain tactic that does nothing (id "noop"), used as a response so the window runs without side effects. */
function noopTactic(name = "Noop"): CardDefinition {
  return tactic({ name, cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });
}

// --- battle helpers ---------------------------------------------------------------

type DamageTarget = { type: "card"; cardId: CardInstanceId } | { type: "faction"; playerId: PlayerId };
const toCard = (cardId: CardInstanceId): DamageTarget => ({ type: "card", cardId });
const toFaction = (playerId: PlayerId): DamageTarget => ({ type: "faction", playerId });
const targetKey = (target: DamageTarget): string => (target.type === "card" ? target.cardId : `faction:${target.playerId}`);

/** Drives the current battle (answering response windows by passing) until the next damage-assignment step, and returns its view. */
function toDamageStep(engine: SpoilsEngine): NonNullable<ReturnType<SpoilsEngine["getBattleView"]>> {
  let guard = 0;
  while (engine.state.battle && engine.state.battle.phase !== "attackerDamageAssignment" && engine.state.battle.phase !== "defenderDamageAssignment") {
    if (++guard > 200) throw new Error("toDamageStep: the battle never reached a damage step");
    if (engine.state.pendingChoice) throw new Error(`toDamageStep: a pending choice (${engine.state.pendingChoice.kind}) is open`);
    if (engine.state.responseWindow) resolvePendingResponses(engine);
    else engine.perform({ type: "advanceFlow" });
  }
  const view = engine.getBattleView();
  if (!view) throw new Error("toDamageStep: no battle");
  return view;
}

/** The ids / "faction:<player>" keys `sourceId` may assign its battle damage to in the current damage step, sorted. */
function legalKeys(engine: SpoilsEngine, sourceId: CardInstanceId): string[] {
  const source = engine.getBattleView()?.damageSources.find((s) => s.cardId === sourceId);
  if (!source) throw new Error(`legalKeys: ${sourceId} is not assigning damage in this step`);
  return source.legalTargets.map((t) => targetKey(t as DamageTarget)).sort();
}

/** Submits `assignments` for the current damage step on behalf of the acting player (throws if the engine refuses them). */
function assignNow(engine: SpoilsEngine, assignments: Array<{ sourceId: CardInstanceId; target: DamageTarget; amount: number }>): void {
  const view = engine.getBattleView();
  if (!view?.actingPlayerId) throw new Error("assignNow: nobody is assigning damage");
  engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId, assignments });
}

/** Lets the rest of the battle play out, sending any remaining damage to each source's first legal target. */
function settleBattle(engine: SpoilsEngine): void {
  autoResolveBattle(engine);
}

/**
 * Plays the rest of the battle out (each source sends its full strength to its
 * first legal target, or as `pick` says) and returns the legal targets (sorted
 * keys) each source was offered the first time it assigned damage.
 */
function playOut(
  engine: SpoilsEngine,
  pick?: (source: DamageSource) => Array<{ sourceId: CardInstanceId; target: DamageTarget; amount: number }>
): Map<CardInstanceId, string[]> {
  const seen = new Map<CardInstanceId, string[]>();
  autoResolveBattle(engine, (source) => {
    if (!seen.has(source.cardId)) seen.set(source.cardId, source.legalTargets.map((t) => targetKey(t as DamageTarget)).sort());
    if (pick) return pick(source);
    return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
  });
  return seen;
}

/** @@END-HELPERS@@ */

// =============================================================================
// Boilstorm
// COST: Pick 3 or fewer characters.
// EFFECT: Inflict X damage divided however you want to the characters, where X
// is the number of [R] you control.
// Tactic, cost 5, threshold [R].
// =============================================================================

const BOIL = "cc9b928b-7c3b-49a8-91ce-afa973012814";

function boilBoard(
  o: { rage?: number; greed?: number; vol?: number; foeRage?: number; spent?: number; extra?: CardPlacement[]; active?: PlayerId; zone?: "hand" | "play"; handCards?: boolean } = {}
) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "boil", def: printing(BOIL), owner: P1, zone: o.zone ?? "hand", faceDown: (o.zone ?? "hand") === "play" ? true : undefined },
      { key: "mineA", def: character({ name: "Mine A", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeA", def: character({ name: "Foe A", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeB", def: character({ name: "Foe B", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeC", def: character({ name: "Foe C", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeD", def: character({ name: "Foe D", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 6, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: active }
  );
}

type BoilGame = ReturnType<typeof boilBoard>;
const boilPlay = (game: BoilGame, picks: string[], player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("boil"), { selected: { cs: picks.map((key) => game.id(key)) } });
const sharesOf = (game: { id: (key: string) => CardInstanceId }, byKey: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(byKey).map(([key, n]) => [game.id(key), n]));
/** Plays Boilstorm picking `picks`, lets the responses pass, then divides the damage as `byKey`. */
function boilFinish(game: BoilGame, picks: string[], byKey: Record<string, number>): void {
  boilPlay(game, picks);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "distributeAmong", { shares: sharesOf(game, byKey) });
}

clause(BOIL, "0:ability", "the card itself: cost 5 with [R] - refused at 4 resources and with no [R]; pays exactly 5; the resolved tactic goes to my discard pile", () => {
  const short = boilBoard({ rage: 4 });
  refused(() => boilPlay(short, ["foeA"]), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("boil")), "hand");
  const noRage = boilBoard({ rage: 0, greed: 6 });
  refused(() => boilPlay(noRage, ["foeA"]), "six Greed and no [R]");
  assert.equal(zoneOf(noRage.engine, noRage.id("boil")), "hand");
  const ok = boilBoard({ rage: 1, greed: 5 });
  const before = ready(ok.engine);
  boilPlay(ok, ["foeA"]);
  assert.equal(before - ready(ok.engine), 5, "COST 5 is paid when the card is played");
  assert.equal(ok.engine.state.pendingChoice, undefined);
  resolvePendingResponses(ok.engine);
  answerPending(ok.engine, "distributeAmong", { shares: sharesOf(ok, { foeA: 1 }) });
  assert.equal(zoneOf(ok.engine, ok.id("boil")), "discard");
  assert.ok(discardOf(ok.engine, P1).includes(ok.id("boil")), "discardOf(ok.engine, P1).includes(ok.id(\"boil\"))");
});

clause(BOIL, "0:ability", "the cost (picking the characters) is committed when the card is played: nothing is damaged and nothing is asked while it waits for responses", () => {
  const game = boilBoard();
  boilPlay(game, ["foeA", "foeB", "foeC"]);
  assert.equal(game.engine.state.pendingChoice, undefined, "the division is not asked while the card waits for responses");
  assert.equal(damageOn(game.engine, game.id("foeA")), 0);
  assert.equal(damageOn(game.engine, game.id("foeB")), 0);
  assert.equal(damageOn(game.engine, game.id("foeC")), 0);
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "distributeAmong");
  assert.equal(pc.playerId, P1, "I decide how the damage is divided");
  assert.equal(pc.amount, 6);
  assert.deepEqual([...(pc.targets as string[])].sort(), [game.id("foeA"), game.id("foeB"), game.id("foeC")].sort());
});

for (const rage of [1, 2, 5, 6, 9]) {
  clause(BOIL, "0:ability", `X is the number of [R] I control: with ${rage} [R] exactly ${rage} damage is inflicted in total`, () => {
    const game = boilBoard({ rage, greed: Math.max(0, 5 - rage) });
    boilFinish(game, ["foeA", "foeB", "foeC"], { foeA: rage });
    assert.equal(game.engine.state.pendingChoice, undefined);
    assert.equal(damageOn(game.engine, game.id("foeA")), rage);
    assert.equal(damageOn(game.engine, game.id("foeB")), 0);
    assert.equal(damageOn(game.engine, game.id("foeC")), 0);
  });
}

clause(BOIL, "0:ability", "X counts [R] I control, not other icons, face-down Volition or the opponent's [R]", () => {
  const game = boilBoard({ rage: 5, greed: 3, vol: 2, foeRage: 4 });
  boilPlay(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "distributeAmong");
  assert.equal(pc.amount, 5, "5 of my [R]; Greed, Volition and the opponent's Rage are not counted");
});

clause(BOIL, "0:ability", "[R] that were spent (attached) still count towards X: icons are never used up", () => {
  const game = boilBoard({ rage: 5, spent: 3 });
  boilPlay(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  assert.equal(expectPending(game.engine, "distributeAmong").amount, 8, "5 ready + 3 spent Rage");
});

clause(BOIL, "0:ability", "X includes the [R] the card itself was paid with: exactly 5 [R] spent on the cost still make X = 5", () => {
  const game = boilBoard({ rage: 5 });
  boilPlay(game, ["foeA"]);
  assert.equal(ready(game.engine), 0, "every resource was spent on the cost");
  resolvePendingResponses(game.engine);
  assert.equal(expectPending(game.engine, "distributeAmong").amount, 5);
});

clause(BOIL, "0:ability", "X is read when the damage is inflicted: if a response destroys one of my [R], the damage is one smaller", () => {
  const game = boilBoard({ rage: 6, extra: [{ key: "rk", def: destroyerTactic("resource"), owner: P2, zone: "hand" }] });
  boilPlay(game, ["foeA"]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  const rageIds = game.engine.state.players[P1].play.filter((cardId) => game.engine.isResource(cardId));
  assert.equal(rageIds.length, 6);
  play(game.engine, P2, game.id("rk"), { selected: { t: [rageIds[0]] } });
  resolvePendingResponses(game.engine);
  assert.equal(expectPending(game.engine, "distributeAmong").amount, 5, "X = the [R] I control when it resolves");
});

clause(BOIL, "0:ability", "the damage may be divided however I want: 1 / 2 / 3 across three characters", () => {
  const game = boilBoard({ rage: 6 });
  boilFinish(game, ["foeA", "foeB", "foeC"], { foeA: 1, foeB: 2, foeC: 3 });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foeA")), 1);
  assert.equal(damageOn(game.engine, game.id("foeB")), 2);
  assert.equal(damageOn(game.engine, game.id("foeC")), 3);
  assert.equal(damageOn(game.engine, game.id("foeD")), 0, "an unpicked character is untouched");
  assert.equal(damageOn(game.engine, game.id("mineA")), 0);
});

clause(BOIL, "0:ability", "the damage may be divided however I want: all of it on one picked character, none on the others", () => {
  for (const target of ["foeA", "foeB", "foeC"]) {
    const game = boilBoard({ rage: 7 });
    boilFinish(game, ["foeA", "foeB", "foeC"], { [target]: 7 });
    for (const key of ["foeA", "foeB", "foeC"]) assert.equal(damageOn(game.engine, game.id(key)), key === target ? 7 : 0, `${key} when all 7 go to ${target}`);
  }
});

clause(BOIL, "0:ability", "the damage may be divided however I want: an uneven split across two picks (5 + 1 of 6, then 0 + 6)", () => {
  const a = boilBoard({ rage: 6 });
  boilFinish(a, ["foeA", "foeB"], { foeA: 5, foeB: 1 });
  assert.equal(damageOn(a.engine, a.id("foeA")), 5);
  assert.equal(damageOn(a.engine, a.id("foeB")), 1);
  const b = boilBoard({ rage: 6 });
  boilFinish(b, ["foeA", "foeB"], { foeA: 0, foeB: 6 });
  assert.equal(damageOn(b.engine, b.id("foeA")), 0);
  assert.equal(damageOn(b.engine, b.id("foeB")), 6);
});

clause(BOIL, "0:ability", "'3 or fewer': one pick takes all X", () => {
  const game = boilBoard({ rage: 6 });
  boilFinish(game, ["foeB"], { foeB: 6 });
  assert.equal(damageOn(game.engine, game.id("foeB")), 6);
  assert.equal(damageOn(game.engine, game.id("foeA")), 0);
});

clause(BOIL, "0:ability", "'3 or fewer': picking no characters at all is allowed: the card is played and nothing is damaged", () => {
  const game = boilBoard({ rage: 6 });
  boilPlay(game, []);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("boil")), "discard", "the tactic was played and resolved");
  for (const key of ["mineA", "foeA", "foeB", "foeC", "foeD"]) assert.equal(damageOn(game.engine, game.id(key)), 0);
});

clause(BOIL, "0:ability", "'3 or fewer': four characters are refused (a legal three are accepted)", () => {
  const bad = boilBoard();
  refused(() => boilPlay(bad, ["foeA", "foeB", "foeC", "foeD"]), "four picks");
  assert.equal(zoneOf(bad.engine, bad.id("boil")), "hand");
  const good = boilBoard();
  boilPlay(good, ["foeA", "foeB", "foeC"]);
  assert.notEqual(zoneOf(good.engine, good.id("boil")), "hand", "control: three picks are accepted");
});

clause(BOIL, "0:ability", "the same character cannot be picked twice", () => {
  const bad = boilBoard();
  refused(() => boilPlay(bad, ["foeA", "foeA"]), "the same character twice");
  assert.equal(zoneOf(bad.engine, bad.id("boil")), "hand");
  const bad3 = boilBoard();
  refused(() => boilPlay(bad3, ["foeA", "foeB", "foeA"]), "a duplicate among three");
  const good = boilBoard();
  boilPlay(good, ["foeA", "foeB"]);
  assert.notEqual(zoneOf(good.engine, good.id("boil")), "hand", "control: two different characters");
});

clause(BOIL, "0:ability", "'characters': my own characters and the opponent's can both be picked, in any mix", () => {
  const game = boilBoard({ rage: 6 });
  boilFinish(game, ["mineA", "foeA", "foeB"], { mineA: 2, foeA: 3, foeB: 1 });
  assert.equal(damageOn(game.engine, game.id("mineA")), 2, "my own character takes damage too");
  assert.equal(damageOn(game.engine, game.id("foeA")), 3);
  assert.equal(damageOn(game.engine, game.id("foeB")), 1);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(BOIL, "0:ability", `cannot pick ${why}`, () => {
    const bad = boilBoard();
    refused(() => boilPlay(bad, [key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("boil")), "hand");
    refused(() => boilPlay(boilBoard(), ["foeA", key]), `picking ${why} alongside a legal character`);
    const good = boilBoard();
    boilPlay(good, ["foeA"]);
    assert.notEqual(zoneOf(good.engine, good.id("boil")), "hand", "control: a character is accepted");
  });
}

clause(BOIL, "0:ability", "cannot pick a faction, a resource or a face-down card", () => {
  const make = () => boilBoard({ extra: [{ key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true }] });
  const faction = make();
  refused(() => playRaw(faction.engine, P1, faction.id("boil"), { selected: { cs: [faction.engine.state.players[P2].factionId!] } }), "an opposing faction");
  const mine = make();
  refused(() => playRaw(mine.engine, P1, mine.id("boil"), { selected: { cs: [mine.engine.state.players[P1].factionId!] } }), "my own faction");
  const resource = make();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("boil"), { selected: { cs: [resourceId] } }), "a face-up resource");
  const down = make();
  refused(() => boilPlay(down, ["fd"]), "a face-down card (only a resource, CR 411.1)");
  const good = make();
  boilPlay(good, ["foeA"]);
  assert.notEqual(zoneOf(good.engine, good.id("boil")), "hand", "control");
});

clause(BOIL, "0:ability", "the division must add up to X: 7 of 6 is refused (damage cannot be invented); exactly 6 is accepted", () => {
  const over = boilBoard({ rage: 6 });
  boilPlay(over, ["foeA", "foeB"]);
  resolvePendingResponses(over.engine);
  refused(() => answerPending(over.engine, "distributeAmong", { shares: sharesOf(over, { foeA: 4, foeB: 3 }) }), "7 of 6 divided");
  assert.equal(damageOn(over.engine, over.id("foeA")), 0);
  assert.equal(damageOn(over.engine, over.id("foeB")), 0);
  const exact = boilBoard({ rage: 6 });
  boilFinish(exact, ["foeA", "foeB"], { foeA: 3, foeB: 3 });
  assert.equal(damageOn(exact.engine, exact.id("foeA")) + damageOn(exact.engine, exact.id("foeB")), 6);
});

clause(BOIL, "0:ability", "'Inflict X damage divided ...': dividing only 5 of X = 6 is refused - all X damage must be inflicted", () => {
  const under = boilBoard({ rage: 6 });
  boilPlay(under, ["foeA", "foeB"]);
  resolvePendingResponses(under.engine);
  refused(() => answerPending(under.engine, "distributeAmong", { shares: sharesOf(under, { foeA: 3, foeB: 2 }) }), "5 of 6 divided");
  assert.equal(damageOn(under.engine, under.id("foeA")), 0, "nothing was inflicted by the refused answer");
  assert.equal(damageOn(under.engine, under.id("foeB")), 0);
  const exact = boilBoard({ rage: 6 });
  boilFinish(exact, ["foeA", "foeB"], { foeA: 3, foeB: 3 });
  assert.equal(damageOn(exact.engine, exact.id("foeA")) + damageOn(exact.engine, exact.id("foeB")), 6, "control: all 6");
});

clause(BOIL, "0:ability", "'Inflict X damage divided ...': answering with no damage at all (an empty division) is refused", () => {
  const none = boilBoard({ rage: 6 });
  boilPlay(none, ["foeA", "foeB"]);
  resolvePendingResponses(none.engine);
  refused(() => answerPending(none.engine, "distributeAmong", { shares: {} }), "dividing nothing");
  assert.equal(damageOn(none.engine, none.id("foeA")), 0);
  assert.equal(damageOn(none.engine, none.id("foeB")), 0);
});

clause(BOIL, "0:ability", "a share cannot be negative: 8 + (-2) = 6 is refused and nothing is damaged", () => {
  const negative = boilBoard({ rage: 6 });
  boilPlay(negative, ["foeA", "foeB"]);
  resolvePendingResponses(negative.engine);
  refused(() => answerPending(negative.engine, "distributeAmong", { shares: sharesOf(negative, { foeA: 8, foeB: -2 }) }), "a negative share");
  assert.equal(damageOn(negative.engine, negative.id("foeA")), 0);
  assert.equal(damageOn(negative.engine, negative.id("foeB")), 0);
});

clause(BOIL, "0:ability", "a share cannot be fractional: 3.5 + 2.5 is refused", () => {
  const fractional = boilBoard({ rage: 6 });
  boilPlay(fractional, ["foeA", "foeB"]);
  resolvePendingResponses(fractional.engine);
  refused(() => answerPending(fractional.engine, "distributeAmong", { shares: sharesOf(fractional, { foeA: 3.5, foeB: 2.5 }) }), "fractional shares");
  assert.equal(damageOn(fractional.engine, fractional.id("foeA")), 0);
  assert.equal(damageOn(fractional.engine, fractional.id("foeB")), 0);
});

clause(BOIL, "0:ability", "the damage can only be divided among the characters that were picked", () => {
  const bad = boilBoard({ rage: 6 });
  boilPlay(bad, ["foeA", "foeB"]);
  resolvePendingResponses(bad.engine);
  refused(() => answerPending(bad.engine, "distributeAmong", { shares: sharesOf(bad, { foeA: 3, foeC: 3 }) }), "a share for an unpicked character");
  assert.equal(damageOn(bad.engine, bad.id("foeC")), 0);
  const mine = boilBoard({ rage: 6 });
  boilPlay(mine, ["foeA", "foeB"]);
  resolvePendingResponses(mine.engine);
  refused(() => answerPending(mine.engine, "distributeAmong", { shares: sharesOf(mine, { foeA: 3, mineA: 3 }) }), "a share for my own unpicked character");
  const good = boilBoard({ rage: 6 });
  boilFinish(good, ["foeA", "foeB"], { foeA: 3, foeB: 3 });
  assert.equal(damageOn(good.engine, good.id("foeA")), 3, "control");
});

clause(BOIL, "0:ability", "damage that reaches a character's life destroys it; the others survive with their damage", () => {
  const game = devBoard(
    [
      { key: "boil", def: printing(BOIL), owner: P1, zone: "hand" },
      { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
      { key: "mid", def: character({ name: "Mid", life: 4 }), owner: P2, zone: "play" },
      { key: "tough", def: character({ name: "Tough", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P1)
    ],
    { turn: 2 }
  );
  boilFinish(game as unknown as BoilGame, ["weak", "mid", "tough"], { weak: 2, mid: 3, tough: 1 });
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard", "2 damage on 2 life");
  assert.equal(zoneOf(game.engine, game.id("mid")), "play", "3 damage on 4 life");
  assert.equal(damageOn(game.engine, game.id("mid")), 3);
  assert.equal(zoneOf(game.engine, game.id("tough")), "play");
  assert.equal(damageOn(game.engine, game.id("tough")), 1);
});

clause(BOIL, "0:ability", "damage adds to damage a picked character already has this turn", () => {
  const game = boilBoard({ rage: 6, extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 2 }] });
  boilFinish(game, ["hurt", "foeA"], { hurt: 3, foeA: 3 });
  assert.equal(zoneOf(game.engine, game.id("hurt")), "discard", "2 earlier + 3 now = 5 on 5 life");
  assert.equal(damageOn(game.engine, game.id("foeA")), 3);
});

clause(BOIL, "0:ability", "I (the caster) divide the damage even on the opponent's turn; the opponent is never asked", () => {
  const game = boilBoard({
    active: P2,
    rage: 6,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  boilPlay(game, ["foeA", "atk"]);
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "distributeAmong");
  assert.equal(pc.playerId, P1, "the caster divides");
  answerPending(game.engine, "distributeAmong", { shares: sharesOf(game, { foeA: 2, atk: 4 }) });
  assert.equal(damageOn(game.engine, game.id("atk")), 4);
  assert.equal(damageOn(game.engine, game.id("foeA")), 2);
});

clause(BOIL, "0:ability", "if a response destroys one of the picked characters, the damage is divided among the ones still in play", () => {
  const game = boilBoard({ rage: 6, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  boilPlay(game, ["foeA", "foeB"]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foeB")] } });
  assert.equal(zoneOf(game.engine, game.id("foeB")), "discard");
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "distributeAmong");
  assert.equal(pc.amount, 6);
  answerPending(game.engine, "distributeAmong", { shares: sharesOf(game, { foeA: 6 }) });
  assert.equal(damageOn(game.engine, game.id("foeA")), 6);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("boil")), "discard");
});

clause(BOIL, "0:ability", "a picked character that left play in response is no longer one of 'the characters': no damage can be wasted on it (CR 402.4)", () => {
  const make = () => {
    const game = boilBoard({ rage: 6, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
    boilPlay(game, ["foeA", "foeB"]);
    play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foeB")] } });
    resolvePendingResponses(game.engine);
    return game;
  };
  const bad = make();
  refused(() => answerPending(bad.engine, "distributeAmong", { shares: sharesOf(bad, { foeA: 3, foeB: 3 }) }), "3 of the damage given to the destroyed character");
  assert.equal(damageOn(bad.engine, bad.id("foeA")), 0);
  const good = make();
  answerPending(good.engine, "distributeAmong", { shares: sharesOf(good, { foeA: 6 }) });
  assert.equal(damageOn(good.engine, good.id("foeA")), 6, "control: all 6 go to the character still in play");
});

clause(BOIL, "0:ability", "if every picked character left play in response there is nobody to divide the damage among: no division is asked and the tactic finishes", () => {
  const game = boilBoard({ rage: 6, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  boilPlay(game, ["foeA"]);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foeA")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "no character is left to take damage, so nothing is asked");
  assert.equal(zoneOf(game.engine, game.id("boil")), "discard");
});

clause(BOIL, "0:ability", "it is a tactic: it can be played in response to the opponent's attack", () => {
  const game = boilBoard({
    active: P2,
    rage: 6,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  boilPlay(game, ["atk"]);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "distributeAmong", { shares: sharesOf(game, { atk: 6 }) });
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard", "6 damage on 4 life");
});

clause(BOIL, "0:ability", "it is a tactic: it is refused on the opponent's turn when there is nothing to respond to", () => {
  const game = boilBoard({ active: P2, rage: 6 });
  refused(() => boilPlay(game, ["foeA"]), "no window to respond in", /./);
  assert.equal(zoneOf(game.engine, game.id("boil")), "hand");
});

// =============================================================================
// Chain Reaction
// COST: Pick a location.
// EFFECT: Inflict 3 damage to the location. If it is destroyed by that damage,
// you may pick a character. If you do, inflict 2 damage to that character. If
// it is destroyed by that damage, inflict 1 damage to your opponent's faction
// and draw a card.
// FLIP UP: 1 [R]
// Tactic, cost 0, threshold [R].
// =============================================================================

const CHAIN = "2630e650-a402-4646-af6a-e8a47b033c5c";

interface ChainOpts {
  rage?: number;
  greed?: number;
  spent?: number;
  structure?: number;
  locDamage?: number;
  foeLife?: number;
  foeDamage?: number;
  mineLife?: number;
  zone?: "hand" | "play";
  fdSpent?: boolean;
  active?: PlayerId;
  deck?: number;
  oppInfluence?: number;
  extra?: CardPlacement[];
}

function chainBoard(o: ChainOpts = {}) {
  const zone = o.zone ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: o.oppInfluence },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      {
        key: "chain",
        def: printing(CHAIN),
        owner: P1,
        zone,
        faceDown: zone === "play" ? true : undefined,
        attachedToKey: zone === "play" && o.fdSpent ? "__factionA" : undefined
      },
      { key: "loc", def: location({ name: "Fort", structure: o.structure ?? 3 }), owner: P2, zone: "play", damage: o.locDamage },
      { key: "mineLoc", def: location({ name: "My Hall", structure: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: o.foeLife ?? 2, speed: 2 }), owner: P2, zone: "play", damage: o.foeDamage },
      { key: "foe2", def: character({ name: "Other Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: o.mineLife ?? 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...fillers("d", o.deck ?? 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", o.rage ?? 1, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ]
  });
}

type ChainGame = ReturnType<typeof chainBoard>;
const chainCast = (game: ChainGame, locKey = "loc", player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("chain"), { selected: { l: [game.id(locKey)] } });
const chainFlip = (game: ChainGame, locKey = "loc", player: PlayerId = P1) =>
  flipUpRaw(game.engine, player, game.id("chain"), { l: [game.id(locKey)] });

/** Casts Chain Reaction on `locKey`, lets the responses pass, and returns the "you may pick a character" prompt if one opened. */
function chainToPick(game: ChainGame, locKey = "loc"): PendingChoiceLike | undefined {
  chainCast(game, locKey);
  resolvePendingResponses(game.engine);
  return pending(game.engine);
}

/** The whole chain: cast, then pick `charKey` (or decline with null) when asked. */
function chainRun(game: ChainGame, charKey: string | null, locKey = "loc"): void {
  const pc = chainToPick(game, locKey);
  assert.ok(pc, "the location was destroyed, so I am asked to pick a character");
  assert.equal(pc.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: charKey === null ? [] : [game.id(charKey)] });
}

clause(CHAIN, "0:ability", "the card itself: cost 0 with [R] - playable with only a spent [R] and nothing ready, and it pays nothing; refused with no [R] at all", () => {
  const noRage = chainBoard({ rage: 0, greed: 6 });
  refused(() => chainCast(noRage), "six Greed and no [R]");
  assert.equal(zoneOf(noRage.engine, noRage.id("chain")), "hand");
  const free = chainBoard({ rage: 0, spent: 1 });
  assert.equal(ready(free.engine), 0);
  chainCast(free);
  assert.notEqual(zoneOf(free.engine, free.id("chain")), "hand", "a cost-0 card needs no ready resources, only the [R] threshold");
  const withReady = chainBoard({ rage: 3 });
  chainCast(withReady);
  assert.equal(ready(withReady.engine), 3, "nothing is paid");
});

clause(CHAIN, "0:ability", "the cost (picking the location) is committed when played; the 3 damage is not inflicted while it waits for responses", () => {
  const game = chainBoard({ structure: 3 });
  chainCast(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("loc")), 0);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
});

clause(CHAIN, "0:ability", "'a location': the opponent's location and my own location can both be picked", () => {
  const theirs = chainBoard({ structure: 5 });
  chainCast(theirs, "loc");
  resolvePendingResponses(theirs.engine);
  assert.equal(damageOn(theirs.engine, theirs.id("loc")), 3);
  const mine = chainBoard();
  chainCast(mine, "mineLoc");
  resolvePendingResponses(mine.engine);
  assert.equal(zoneOf(mine.engine, mine.id("mineLoc")), "discard", "3 damage on my own 3-structure location");
});

for (const [key, why] of [
  ["foe", "a character"],
  ["thing", "an item"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a card in a discard pile"]
] as const) {
  clause(CHAIN, "0:ability", `cannot pick ${why} as the location`, () => {
    const bad = chainBoard();
    refused(() => chainCast(bad, key), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("chain")), "hand");
    const good = chainBoard();
    chainCast(good);
    assert.notEqual(zoneOf(good.engine, good.id("chain")), "hand", "control: a location is accepted");
  });
}

clause(CHAIN, "0:ability", "cannot pick a faction or a resource as the location", () => {
  const faction = chainBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("chain"), { selected: { l: [faction.engine.state.players[P2].factionId!] } }), "an opposing faction");
  const resource = chainBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("chain"), { selected: { l: [resourceId] } }), "a resource");
});

clause(CHAIN, "0:ability", "the pick is exactly one location: none and two are refused", () => {
  const none = chainBoard();
  refused(() => playRaw(none.engine, P1, none.id("chain"), { selected: { l: [] } }), "no location");
  const two = chainBoard();
  refused(() => playRaw(two.engine, P1, two.id("chain"), { selected: { l: [two.id("loc"), two.id("mineLoc")] } }), "two locations");
  assert.equal(zoneOf(two.engine, two.id("chain")), "hand");
  const good = chainBoard();
  chainCast(good);
  assert.notEqual(zoneOf(good.engine, good.id("chain")), "hand", "control");
});

clause(CHAIN, "0:ability", "with no location in play at all it cannot be played", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "chain", def: printing(CHAIN), owner: P1, zone: "hand" }, ...bank("rage", 1, P1)]
  });
  refused(() => playRaw(game.engine, P1, game.id("chain"), { selected: { l: [] } }), "no location to pick");
  assert.equal(zoneOf(game.engine, game.id("chain")), "hand");
});

for (const structure of [4, 5, 9]) {
  clause(CHAIN, "0:ability", `3 damage to a location with structure ${structure}: it survives with exactly 3 damage and nothing further happens`, () => {
    const game = chainBoard({ structure });
    const infl = influenceOf(game.engine, P2);
    const handBefore = handOf(game.engine, P1).length;
    chainCast(game);
    resolvePendingResponses(game.engine);
    assert.equal(game.engine.state.pendingChoice, undefined, "not destroyed, so no character is offered");
    assert.equal(zoneOf(game.engine, game.id("loc")), "play");
    assert.equal(damageOn(game.engine, game.id("loc")), 3);
    assert.equal(influenceOf(game.engine, P2), infl, "no damage to the opponent's faction");
    assert.equal(influenceOf(game.engine, P1), START);
    assert.equal(handOf(game.engine, P1).length, handBefore - 1, "the tactic left my hand and I drew nothing");
    assert.equal(zoneOf(game.engine, game.id("chain")), "discard");
    assert.equal(damageOn(game.engine, game.id("foe")), 0);
  });
}

for (const structure of [1, 2, 3]) {
  clause(CHAIN, "0:ability", `3 damage to a location with structure ${structure}: it is destroyed (to its owner's discard pile) and I may pick a character`, () => {
    const game = chainBoard({ structure });
    const pc = chainToPick(game);
    assert.ok(pc, "I am offered the pick");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
    assert.ok(discardOf(game.engine, P2).includes(game.id("loc")), "a destroyed location goes to its owner's discard pile");
  });
}

clause(CHAIN, "0:ability", "damage the location already has counts: structure 5 with 2 damage is destroyed by the 3 (CR 408.8) and the pick is offered", () => {
  const game = chainBoard({ structure: 5, locDamage: 2 });
  const pc = chainToPick(game);
  assert.ok(pc, "pc");
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
});

clause(CHAIN, "0:ability", "damage the location already has counts: structure 6 with 2 damage survives at 5 damage and no pick is offered", () => {
  const game = chainBoard({ structure: 6, locDamage: 2 });
  chainCast(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("loc")), 5);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
});

clause(CHAIN, "0:ability", "a location that was already at its limit is not 'destroyed by that damage': structure 5 with 4 damage is destroyed by the 3 (the damage that put it over, CR 408.8)", () => {
  const game = chainBoard({ structure: 5, locDamage: 4 });
  const pc = chainToPick(game);
  assert.ok(pc, "4 + 3 = 7 >= 5: destroyed by this damage");
});

clause(CHAIN, "0:ability", "'you may pick a character': it is only the controller who is asked, and the prompt names an optional single pick", () => {
  const game = chainBoard();
  const pc = chainToPick(game);
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  assert.equal(damageOn(game.engine, game.id("foe")), 0, "nothing is damaged until I pick");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(CHAIN, "0:ability", "'you may pick': declining the pick ends the effect - no 2 damage, no faction damage, no draw", () => {
  const game = chainBoard();
  const handBefore = handOf(game.engine, P1).length;
  chainRun(game, null);
  assert.equal(game.engine.state.pendingChoice, undefined);
  for (const key of ["foe", "foe2", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, `${key} is untouched`);
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "I drew nothing (the tactic left my hand)");
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard");
});

clause(CHAIN, "0:ability", "if I pick a character it takes exactly 2 damage: a 5-life character survives with 2 damage and nothing further happens", () => {
  const game = chainBoard({ foeLife: 5 });
  const handBefore = handOf(game.engine, P1).length;
  chainRun(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  assert.equal(influenceOf(game.engine, P2), START, "it was not destroyed, so no damage to the faction");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "and no card is drawn");
  assert.equal(damageOn(game.engine, game.id("foe2")), 0, "only the picked character is damaged");
});

clause(CHAIN, "0:ability", "a 3-life character survives the 2 damage (boundary): no faction damage, no draw", () => {
  const game = chainBoard({ foeLife: 3 });
  const handBefore = handOf(game.engine, P1).length;
  chainRun(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1);
});

for (const life of [1, 2]) {
  clause(CHAIN, "0:ability", `a ${life}-life character picked after the location fell takes the 2 damage and is destroyed (to its owner's discard pile)`, () => {
    const game = chainBoard({ foeLife: life });
    chainRun(game, "foe");
    assert.equal(game.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
    assert.ok(discardOf(game.engine, P2).includes(game.id("foe")), "discardOf(game.engine, P2).includes(game.id(\"foe\"))");
    assert.equal(zoneOf(game.engine, game.id("foe2")), "play");
  });

  clause(CHAIN, "0:ability", `a ${life}-life character is destroyed by the 2 damage: 1 damage is inflicted to my opponent's faction (influence 30 -> 29), not to mine`, () => {
    const game = chainBoard({ foeLife: life });
    chainRun(game, "foe");
    assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
    assert.equal(influenceOf(game.engine, P2), START - 1, "1 damage to the opponent's faction = 1 influence");
    assert.equal(influenceOf(game.engine, P1), START, "not my faction");
  });

  clause(CHAIN, "0:ability", `a ${life}-life character is destroyed by the 2 damage: I draw exactly one card, the top card of my deck, and the opponent draws nothing`, () => {
    const game = chainBoard({ foeLife: life });
    const handBefore = handOf(game.engine, P1).length;
    const topCard = deckOf(game.engine, P1)[0];
    chainRun(game, "foe");
    assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
    assert.equal(handOf(game.engine, P1).length, handBefore, "-1 for the tactic, +1 for the draw");
    assert.ok(handOf(game.engine, P1).includes(topCard), "the card I drew is the top card of my deck");
    assert.equal(deckOf(game.engine, P1).length, 2);
    assert.equal(handOf(game.engine, P2).length, 1, "the opponent drew nothing");
    assert.equal(deckOf(game.engine, P2).length, 3);
  });
}

clause(CHAIN, "0:ability", "damage the character already has counts: a 3-life character with 1 damage is destroyed by the 2 (CR 408.8)", () => {
  const game = chainBoard({ foeLife: 3, foeDamage: 1 });
  chainRun(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
});

clause(CHAIN, "0:ability", "a 3-life character with 1 damage is destroyed by the 2: that counts as 'destroyed by that damage' - 1 faction damage and a card drawn", () => {
  const game = chainBoard({ foeLife: 3, foeDamage: 1 });
  const handBefore = handOf(game.engine, P1).length;
  chainRun(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(handOf(game.engine, P1).length, handBefore);
});

clause(CHAIN, "0:ability", "a 4-life character with 1 damage survives (3 < 4): no follow-up", () => {
  const game = chainBoard({ foeLife: 4, foeDamage: 1 });
  chainRun(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(CHAIN, "0:ability", "'a character': my own character can be picked and takes the 2 damage (destroyed at 2 life)", () => {
  const game = chainBoard({ mineLife: 2 });
  chainRun(game, "mine");
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P1), START, "my own faction is not damaged");
});

clause(CHAIN, "0:ability", "'a character': if my own character picked this way is destroyed, the OPPONENT's faction takes the 1 damage and I draw", () => {
  const game = chainBoard({ mineLife: 2 });
  const handBefore = handOf(game.engine, P1).length;
  chainRun(game, "mine");
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(influenceOf(game.engine, P2), START - 1, "'your opponent's faction'");
  assert.equal(influenceOf(game.engine, P1), START, "my own faction is not damaged");
  assert.equal(handOf(game.engine, P1).length, handBefore);
});

clause(CHAIN, "0:ability", "the character may be any character in play, including a different one from the location's owner", () => {
  const game = chainBoard({ foeLife: 5 });
  chainRun(game, "foe2");
  assert.equal(damageOn(game.engine, game.id("foe2")), 2);
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["mineLoc", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(CHAIN, "0:ability", `the follow-up pick must be a character: ${why} is refused`, () => {
    const bad = chainBoard();
    const pc = chainToPick(bad);
    assert.ok(pc, "pc");
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    assert.equal(damageOn(bad.engine, bad.id(key)), 0);
    const good = chainBoard();
    chainRun(good, "foe");
    assert.equal(zoneOf(good.engine, good.id("foe")), "discard", "control: a character is accepted");
  });
}

clause(CHAIN, "0:ability", "the follow-up pick cannot be a faction or a resource, and cannot be two characters", () => {
  const faction = chainBoard();
  chainToPick(faction);
  refused(() => answerPending(faction.engine, "chooserSelectsTarget", { selected: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const resource = chainBoard();
  chainToPick(resource);
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => answerPending(resource.engine, "chooserSelectsTarget", { selected: [resourceId] }), "a resource");
  const two = chainBoard();
  chainToPick(two);
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe"), two.id("foe2")] }), "two characters");
  assert.equal(damageOn(two.engine, two.id("foe")), 0);
  assert.equal(damageOn(two.engine, two.id("foe2")), 0);
});

clause(CHAIN, "0:ability", "the chain stops after one character: a destroyed character does not offer another pick", () => {
  const game = chainBoard({ foeLife: 1 });
  chainRun(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("foe2")), "play");
  assert.equal(damageOn(game.engine, game.id("foe2")), 0);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
});

clause(CHAIN, "0:ability", "the follow-up is exactly 1 faction damage and exactly 1 card, once", () => {
  const game = chainBoard({ foeLife: 1 });
  chainRun(game, "foe");
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(handOf(game.engine, P1).length, 1, "the tactic left my empty hand and I drew one card");
  assert.equal(deckOf(game.engine, P1).length, 2);
});

clause(CHAIN, "0:ability", "with no characters in play at all, a destroyed location ends the effect (no prompt, no stall)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "chain", def: printing(CHAIN), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Fort", structure: 3 }), owner: P2, zone: "play" },
      ...fillers("d", 2, P1, "deck"),
      ...bank("rage", 1, P1)
    ]
  });
  chainCast(game);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(CHAIN, "0:ability", "the opponent's faction at 1 influence: the chain's 1 faction damage brings it to 0 and I win", () => {
  const game = chainBoard({ foeLife: 2, oppInfluence: 1 });
  chainRun(game, "foe");
  assert.equal(influenceOf(game.engine, P2), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(CHAIN, "0:ability", "with an empty deck nothing stalls and failing to draw does not lose the game (CR 102.1a)", () => {
  const game = chainBoard({ foeLife: 2, deck: 0 });
  chainRun(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(game.engine.state.result, undefined);
});

clause(CHAIN, "0:ability", "with an empty deck the card cannot be drawn but the 1 faction damage is still inflicted", () => {
  const game = chainBoard({ foeLife: 2, deck: 0 });
  chainRun(game, "foe");
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(CHAIN, "0:ability", "a location that left play in response (destroyed by something else) was not 'destroyed by that damage': no character pick, no follow-ups", () => {
  const game = chainBoard({ extra: [{ key: "lk", def: destroyerTactic("location"), owner: P2, zone: "hand" }] });
  const handBefore = handOf(game.engine, P1).length;
  chainCast(game);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  play(game.engine, P2, game.id("lk"), { selected: { t: [game.id("loc")] } });
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard", "the response destroyed the location");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "the damage could not destroy a location that was already gone, so I am not offered a pick");
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard");
});

clause(CHAIN, "0:ability", "a location returned to its owner's hand in response was not 'destroyed by that damage': no character pick", () => {
  const game = chainBoard({ extra: [{ key: "bn", def: bouncerTactic(), owner: P2, zone: "hand" }] });
  chainCast(game);
  play(game.engine, P2, game.id("bn"), { selected: { t: [game.id("loc")] } });
  assert.equal(zoneOf(game.engine, game.id("loc")), "hand");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "no damage was inflicted to a location that is in a hand");
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(zoneOf(game.engine, game.id("loc")), "hand");
});

clause(CHAIN, "0:ability", "it is a tactic: played in response to the opponent's attack, the follow-up questions go to me", () => {
  const game = chainBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  chainCast(game);
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
});

// --- FLIP UP: 1 [R] -------------------------------------------------------------

clause(CHAIN, "1:flipUp", "flipping up a face-down copy pays exactly 1 (not the printed cost 0) and then does its text: 3 damage to the location, then the character pick", () => {
  const game = chainBoard({ zone: "play", rage: 3, structure: 3 });
  assert.equal(ready(game.engine), 4, "three Rage and the face-down card");
  chainFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 2, "4 resources: 1 paid, and the flipped card stopped being a resource");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard", "a resolved tactic goes to my discard pile");
});

clause(CHAIN, "1:flipUp", "a flipped-up Chain Reaction does the whole chain: a destroyed character costs the opponent 1 influence and draws me a card", () => {
  const game = chainBoard({ zone: "play", rage: 3, structure: 3 });
  const handBefore = handOf(game.engine, P1).length;
  chainFlip(game);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(handOf(game.engine, P1).length, handBefore + 1, "one card drawn (the face-down card was not in my hand)");
});

clause(CHAIN, "1:flipUp", "FLIP UP costs 1 even though the printed cost is 0: a spent [R] and the face-down card itself (the only ready resource) is exactly enough", () => {
  const game = chainBoard({ zone: "play", rage: 0, spent: 1 });
  assert.equal(ready(game.engine), 1);
  chainFlip(game);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(ready(game.engine), 0);
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard", "the card resolved");
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
});

clause(CHAIN, "1:flipUp", "a face-down copy that was already spent (attached to my faction) can still be flipped up when other resources pay the 1 (CR 507.4a: any face-down resource I control)", () => {
  const game = chainBoard({ zone: "play", rage: 3, fdSpent: true });
  assert.equal(ready(game.engine), 3);
  chainFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 2, "exactly 1 paid");
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  assert.equal(zoneOf(game.engine, game.id("chain")), "discard");
});

clause(CHAIN, "1:flipUp", "FLIP UP needs [R]: plenty of other resources and no [R] is refused (the face-down card's Volition is not [R])", () => {
  const bad = chainBoard({ zone: "play", rage: 0, greed: 6 });
  refused(() => chainFlip(bad), "no [R]");
  assert.equal(bad.engine.state.cards[bad.id("chain")].faceDown, true);
  assert.equal(ready(bad.engine), 7, "nothing was paid");
});

clause(CHAIN, "1:flipUp", "the opponent's [R] do not meet the FLIP UP threshold", () => {
  const bad = chainBoard({ zone: "play", rage: 0, greed: 3, extra: bank("rage", 3, P2) });
  refused(() => chainFlip(bad), "their Rage");
  assert.equal(bad.engine.state.cards[bad.id("chain")].faceDown, true);
});

clause(CHAIN, "1:flipUp", "a flipped-up Chain Reaction still needs its location pick: none, a character and an item are refused", () => {
  const none = chainBoard({ zone: "play" });
  refused(() => flipUpRaw(none.engine, P1, none.id("chain"), { l: [] }), "no location");
  const character_ = chainBoard({ zone: "play" });
  refused(() => chainFlip(character_, "foe"), "a character");
  const thing = chainBoard({ zone: "play" });
  refused(() => chainFlip(thing, "thing"), "an item");
  assert.equal(thing.engine.state.cards[thing.id("chain")].faceDown, true);
  const good = chainBoard({ zone: "play" });
  chainFlip(good);
  assert.notEqual(good.engine.state.cards[good.id("chain")].faceDown, true, "control");
});

clause(CHAIN, "1:flipUp", "FLIP UP works at tactic times: in response to the opponent's attack", () => {
  const game = chainBoard({
    zone: "play",
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  chainFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("loc")), "discard");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
});

clause(CHAIN, "1:flipUp", "only the card's controller can flip it up", () => {
  const game = chainBoard({ zone: "play", extra: [...bank("rage", 3, P2)] });
  refused(() => chainFlip(game, "mineLoc", P2), "the opponent flipping my card");
  assert.equal(game.engine.state.cards[game.id("chain")].faceDown, true);
});

clause(CHAIN, "1:flipUp", "a face-down copy is just a resource: it provides one Volition and does nothing until flipped", () => {
  const game = chainBoard({ zone: "play", rage: 0, spent: 1 });
  assert.equal(ready(game.engine), 1, "one Volition");
  assert.equal(game.engine.state.cards[game.id("chain")].faceDown, true);
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(damageOn(game.engine, game.id("loc")), 0);
});

// =============================================================================
// Colossal Flattener
// While this card is attacking, you may assign its battle damage to the target
// of the attack instead of the blocking party.
// Character (beast), cost 7, threshold [R][R], 6 strength / 3 speed / 3 life.
// =============================================================================

const FLATTENER = "c0506479-0cf8-49f3-944e-15c3d75c5458";

function flatCardBoard(o: { rage?: number; greed?: number } = {}) {
  return devBoard(
    [{ key: "flat", def: printing(FLATTENER), owner: P1, zone: "hand" }, ...bank("rage", o.rage ?? 2, P1), ...bank("greed", o.greed ?? 5, P1)],
    { turn: 2 }
  );
}

interface FlatOpts {
  blockerStrength?: number;
  oppInfluence?: number;
  keepStructure?: number;
  extra?: CardPlacement[];
}

function flatBoard(o: FlatOpts = {}) {
  return devBoard(
    [
      { key: "flat", def: printing(FLATTENER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: o.blockerStrength ?? 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "keep", def: location({ name: "Keep", structure: o.keepStructure ?? 20 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: P1 }
  );
}

type FlatGame = ReturnType<typeof flatBoard>;

/** P1 attacks `target` with `attackers`; P2 blocks with `blockers`; stops at the first damage-assignment step. */
function flatToDamage(game: FlatGame, attackers: string[], target: "faction" | "keep", blockers: string[]) {
  declareAttackBy(game.engine, P1, attackers.map((key) => game.id(key)), target === "faction" ? toFaction(P2) : toCard(game.id("keep")));
  if (blockers.length) declareBlockers(game.engine, P2, blockers.map((key) => game.id(key)));
  else declareBlockers(game.engine, P2, []);
  return toDamageStep(game.engine);
}

clause(FLATTENER, "0:rule", "the card itself: cost 7 with [R][R] - refused at 6 resources and with one [R]; pays exactly 7; printed 6 strength / 3 speed / 3 life, a beast", () => {
  const short = flatCardBoard({ rage: 2, greed: 4 });
  refused(() => playRaw(short.engine, P1, short.id("flat")), "6 resources for cost 7");
  const oneRage = flatCardBoard({ rage: 1, greed: 8 });
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("flat")), "only one [R]");
  const ok = flatCardBoard({ rage: 2, greed: 6 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("flat"));
  assert.equal(zoneOf(ok.engine, ok.id("flat")), "play");
  assert.equal(before - ready(ok.engine), 7);
  assert.equal(ok.engine.getStat(ok.id("flat"), "strength"), 6);
  assert.equal(ok.engine.getStat(ok.id("flat"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("flat"), "life"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("flat")).subtype, ["beast"]);
});

clause(FLATTENER, "0:rule", "attacking a faction and blocked, it may assign its damage to the blocker OR to the target of the attack: both are legal targets", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", ["blk"]);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("blk"), "faction:p2"].sort());
});

clause(FLATTENER, "0:rule", "it assigns all 6 to the target of the attack instead of the blocker: the faction loses 6 influence and the blocker takes nothing", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", ["blk"]);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 6);
  assert.equal(damageOn(game.engine, game.id("blk")), 0);
  assert.equal(zoneOf(game.engine, game.id("blk")), "play");
});

clause(FLATTENER, "0:rule", "'you may': it can instead assign its damage to the blocking party as normal", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", ["blk"]);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toCard(game.id("blk")), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("blk")), 6);
  assert.equal(influenceOf(game.engine, P2), START, "the faction was not damaged");
});

clause(FLATTENER, "0:rule", "with two blockers it may send all of it past both to the target; neither blocker takes damage", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", ["blk", "blk2"]);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("blk"), game.id("blk2"), "faction:p2"].sort());
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 6);
  assert.equal(damageOn(game.engine, game.id("blk")), 0);
  assert.equal(damageOn(game.engine, game.id("blk2")), 0);
});

clause(FLATTENER, "0:rule", "with two blockers it can still divide its damage between the blockers as normal", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", ["blk", "blk2"]);
  assignNow(game.engine, [
    { sourceId: game.id("flat"), target: toCard(game.id("blk")), amount: 4 },
    { sourceId: game.id("flat"), target: toCard(game.id("blk2")), amount: 2 }
  ]);
  settleBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("blk")), 4);
  assert.equal(damageOn(game.engine, game.id("blk2")), 2);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(FLATTENER, "0:rule", "its damage goes to the target 'instead of' the blocking party: splitting it between a blocker and the target is not allowed", () => {
  const bad = flatBoard();
  flatToDamage(bad, ["flat"], "faction", ["blk"]);
  refused(
    () =>
      assignNow(bad.engine, [
        { sourceId: bad.id("flat"), target: toCard(bad.id("blk")), amount: 3 },
        { sourceId: bad.id("flat"), target: toFaction(P2), amount: 3 }
      ]),
    "half to the blocker, half to the faction"
  );
  assert.equal(damageOn(bad.engine, bad.id("blk")), 0);
  assert.equal(influenceOf(bad.engine, P2), START);
  const good = flatBoard();
  flatToDamage(good, ["flat"], "faction", ["blk"]);
  assignNow(good.engine, [{ sourceId: good.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(good.engine);
  assert.equal(influenceOf(good.engine, P2), START - 6, "control: all of it to the target is accepted");
});

clause(FLATTENER, "0:rule", "it must assign all of its strength: assigning only part of the 6 is refused", () => {
  const bad = flatBoard();
  flatToDamage(bad, ["flat"], "faction", ["blk"]);
  refused(() => assignNow(bad.engine, [{ sourceId: bad.id("flat"), target: toFaction(P2), amount: 4 }]), "4 of 6");
  assert.equal(influenceOf(bad.engine, P2), START);
});

clause(FLATTENER, "0:rule", "the target of the attack can be a location: blocked, it may assign its damage to the location instead of the blocker", () => {
  const game = flatBoard({ keepStructure: 20 });
  flatToDamage(game, ["flat"], "keep", ["blk"]);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("blk"), game.id("keep")].sort());
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toCard(game.id("keep")), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("keep")), 6);
  assert.equal(damageOn(game.engine, game.id("blk")), 0);
});

clause(FLATTENER, "0:rule", "the target of the attack can be a location: sending it all to a weak location destroys it", () => {
  const game = flatBoard({ keepStructure: 5 });
  flatToDamage(game, ["flat"], "keep", ["blk"]);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toCard(game.id("keep")), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("keep")), "discard");
  assert.equal(zoneOf(game.engine, game.id("blk")), "play");
});

clause(FLATTENER, "0:rule", "unblocked, its damage goes to the target of the attack as for any attacker", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat"], "faction", []);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), ["faction:p2"]);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 6);
});

clause(FLATTENER, "0:rule", "only the Flattener gets the option: another attacker in its party can assign only to the blocker", () => {
  const game = flatBoard();
  flatToDamage(game, ["flat", "ally"], "faction", ["blk"]);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("blk"), "faction:p2"].sort());
  assert.deepEqual(legalKeys(game.engine, game.id("ally")), [game.id("blk")], "the ally must assign to the blocking party");
  refused(
    () =>
      assignNow(game.engine, [
        { sourceId: game.id("flat"), target: toFaction(P2), amount: 6 },
        { sourceId: game.id("ally"), target: toFaction(P2), amount: 2 }
      ]),
    "the ally sending its damage past the blocker"
  );
  assert.equal(influenceOf(game.engine, P2), START);
  const good = flatBoard();
  flatToDamage(good, ["flat", "ally"], "faction", ["blk"]);
  assignNow(good.engine, [
    { sourceId: good.id("flat"), target: toFaction(P2), amount: 6 },
    { sourceId: good.id("ally"), target: toCard(good.id("blk")), amount: 2 }
  ]);
  settleBattle(good.engine);
  assert.equal(influenceOf(good.engine, P2), START - 6, "control: the Flattener to the faction, the ally to the blocker");
  assert.equal(damageOn(good.engine, good.id("blk")), 2);
});

clause(FLATTENER, "0:rule", "'while this card is attacking': when it BLOCKS it can assign damage only to the attacking party", () => {
  const game = devBoard(
    [
      { key: "flat", def: printing(FLATTENER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("flat")]);
  toDamageStep(game.engine);
  // speed 3 round: the Flattener assigns first (defender step)
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("atk")], "no faction, no 'target of the attack'");
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toCard(game.id("atk")), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("atk")), 6, "the blocking Flattener's 6 damage lands on the 9-life attacker");
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(FLATTENER, "0:rule", "'while this card is attacking': blocking an attack on a location of mine it cannot hit that location", () => {
  const game = devBoard(
    [
      { key: "flat", def: printing(FLATTENER), owner: P1, zone: "play" },
      { key: "hall", def: location({ name: "My Hall", structure: 20 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toCard(game.id("hall")));
  declareBlockers(game.engine, P1, [game.id("flat")]);
  toDamageStep(game.engine);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("atk")]);
});

clause(FLATTENER, "0:rule", "the amount is its current strength: with +2 strength it sends 8 to the faction", () => {
  const game = flatBoard({ extra: [{ key: "buff", def: buffTactic("strength", 2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("buff"), { selected: { t: [game.id("flat")] } });
  assert.equal(game.engine.getStat(game.id("flat"), "strength"), 8);
  const view = flatToDamage(game, ["flat"], "faction", ["blk"]);
  assert.equal(view.damageSources.find((s) => s.cardId === game.id("flat"))?.strength, 8);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 8 }]);
  settleBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 8);
});

clause(FLATTENER, "0:rule", "sent past the blocker at a faction with only 6 influence left, it ends the game", () => {
  const game = devBoard(
    [
      { key: "flat", def: printing(FLATTENER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  game.engine.state.players[P2].influence = 6;
  declareAttackBy(game.engine, P1, [game.id("flat")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  toDamageStep(game.engine);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(FLATTENER, "0:rule", "the blocker is not removed from the fight: it still deals its own damage to the Flattener after being bypassed", () => {
  const game = flatBoard({ blockerStrength: 2 });
  flatToDamage(game, ["flat"], "faction", ["blk"]);
  assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]);
  settleBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("flat")), 2, "the blocker's 2 strength is assigned to the attacking Flattener");
  assert.equal(zoneOf(game.engine, game.id("flat")), "play");
});

clause(FLATTENER, "0:rule", "a Flattener that is not attacking has no such option: a normal attacker's damage still goes only to the blocking party", () => {
  const game = flatBoard();
  const view = flatToDamage(game, ["ally"], "faction", ["blk"]);
  assert.deepEqual(legalKeys(game.engine, game.id("ally")), [game.id("blk")]);
  assert.equal(view.damageSources.some((s) => s.cardId === game.id("flat")), false, "the Flattener is not in the battle");
});

// =============================================================================
// Courageous Paladin
// All battle damage that could be assigned to this card must be assigned to it.
// Character (soldier), cost 3, threshold [R][R], 2 strength / 3 speed / 3 life.
// =============================================================================

const PALADIN = "85630d60-8a6f-457c-8f41-2d3e75a19d56";

function paladinCardBoard(o: { rage?: number; greed?: number } = {}) {
  return devBoard(
    [{ key: "pal", def: printing(PALADIN), owner: P1, zone: "hand" }, ...bank("rage", o.rage ?? 2, P1), ...bank("greed", o.greed ?? 1, P1)],
    { turn: 2 }
  );
}

interface PalOpts {
  atkStrength?: number;
  atkSpeed?: number;
  extra?: CardPlacement[];
}

/** P2 (active) attacks P1's faction; P1 has the Paladin and two ordinary characters. */
function palBoard(o: PalOpts = {}) {
  return devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "third", def: character({ name: "Third", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: o.atkStrength ?? 4, life: 9, speed: o.atkSpeed ?? 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker Two", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2 }
  );
}

type PalGame = ReturnType<typeof palBoard>;

/** P2 attacks with `attackers`; P1 blocks with `blockers`; stops at the first damage step. */
function palToDamage(game: PalGame, attackers: string[], blockers: string[]) {
  declareAttackBy(game.engine, P2, attackers.map((key) => game.id(key)), toFaction(P1));
  declareBlockers(game.engine, P1, blockers.map((key) => game.id(key)));
  return toDamageStep(game.engine);
}

clause(PALADIN, "0:rule", "the card itself: cost 3 with [R][R] - refused at 2 resources and with one [R]; pays exactly 3; printed 2 strength / 3 speed / 3 life, a soldier", () => {
  const short = paladinCardBoard({ rage: 2, greed: 0 });
  refused(() => playRaw(short.engine, P1, short.id("pal")), "2 resources for cost 3");
  const oneRage = paladinCardBoard({ rage: 1, greed: 5 });
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("pal")), "only one [R]");
  const ok = paladinCardBoard({ rage: 2, greed: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("pal"));
  assert.equal(zoneOf(ok.engine, ok.id("pal")), "play");
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(ok.engine.getStat(ok.id("pal"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("pal"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("pal"), "life"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("pal")).subtype, ["soldier"]);
});

clause(PALADIN, "0:rule", "blocking alongside another character: the attacker's damage may be assigned only to the Paladin", () => {
  const game = palBoard();
  palToDamage(game, ["atk"], ["pal", "other"]);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("pal")]);
});

clause(PALADIN, "0:rule", "blocking alongside another character: assigning the damage to the other blocker instead is refused", () => {
  const bad = palBoard();
  palToDamage(bad, ["atk"], ["pal", "other"]);
  refused(() => assignNow(bad.engine, [{ sourceId: bad.id("atk"), target: toCard(bad.id("other")), amount: 4 }]), "all 4 to the other blocker");
  assert.equal(damageOn(bad.engine, bad.id("other")), 0);
  const good = palBoard();
  palToDamage(good, ["atk"], ["pal", "other"]);
  assignNow(good.engine, [{ sourceId: good.id("atk"), target: toCard(good.id("pal")), amount: 4 }]);
  settleBattle(good.engine);
  assert.equal(zoneOf(good.engine, good.id("pal")), "discard", "control: 4 damage on 3 life");
  assert.equal(damageOn(good.engine, good.id("other")), 0);
});

clause(PALADIN, "0:rule", "blocking alongside another character: splitting the damage between the Paladin and the other blocker is refused ('all' battle damage)", () => {
  const bad = palBoard();
  palToDamage(bad, ["atk"], ["pal", "other"]);
  refused(
    () =>
      assignNow(bad.engine, [
        { sourceId: bad.id("atk"), target: toCard(bad.id("pal")), amount: 2 },
        { sourceId: bad.id("atk"), target: toCard(bad.id("other")), amount: 2 }
      ]),
    "2 to the Paladin, 2 to the other blocker"
  );
  assert.equal(damageOn(bad.engine, bad.id("pal")), 0);
  assert.equal(damageOn(bad.engine, bad.id("other")), 0);
});

clause(PALADIN, "0:rule", "all of it means all of it, even past lethal: a 4-strength attacker puts 4 damage on the 3-life Paladin rather than 3 on it and 1 elsewhere", () => {
  const bad = palBoard();
  palToDamage(bad, ["atk"], ["pal", "other"]);
  refused(
    () =>
      assignNow(bad.engine, [
        { sourceId: bad.id("atk"), target: toCard(bad.id("pal")), amount: 3 },
        { sourceId: bad.id("atk"), target: toCard(bad.id("other")), amount: 1 }
      ]),
    "lethal on the Paladin and the rest on the other blocker"
  );
});

clause(PALADIN, "0:rule", "with three blockers the damage still can go only to the Paladin", () => {
  const game = palBoard();
  palToDamage(game, ["atk"], ["other", "pal", "third"]);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("pal")]);
});

clause(PALADIN, "0:rule", "blocking alone: all the damage goes to the Paladin (normal), and it is destroyed by lethal damage", () => {
  const game = palBoard();
  palToDamage(game, ["atk"], ["pal"]);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("pal")]);
  assignNow(game.engine, [{ sourceId: game.id("atk"), target: toCard(game.id("pal")), amount: 4 }]);
  settleBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("pal")), "discard");
});

clause(PALADIN, "0:rule", "every attacker in the party must put its damage on the Paladin: two attackers of the same speed are both offered only the Paladin", () => {
  const game = devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker Two", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk"), game.id("atk2")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("pal"), game.id("other")]);
  toDamageStep(game.engine);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("pal")]);
  assert.deepEqual(legalKeys(game.engine, game.id("atk2")), [game.id("pal")]);
  refused(
    () =>
      assignNow(game.engine, [
        { sourceId: game.id("atk"), target: toCard(game.id("pal")), amount: 1 },
        { sourceId: game.id("atk2"), target: toCard(game.id("other")), amount: 1 }
      ]),
    "one of the two attackers hitting the other blocker"
  );
  assert.equal(damageOn(game.engine, game.id("other")), 0);
});

clause(PALADIN, "0:rule", "a slower attacker's damage must also go to the Paladin while the Paladin is still alive", () => {
  const game = devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 0, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker Two", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk"), game.id("atk2")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("pal"), game.id("other")]);
  const seen = playOut(game.engine);
  assert.deepEqual(seen.get(game.id("atk")), [game.id("pal")]);
  assert.deepEqual(seen.get(game.id("atk2")), [game.id("pal")], "the Paladin took 1 and is alive (3 life), so the slow attacker's damage must go to it too");
  assert.equal(damageOn(game.engine, game.id("other")), 0);
});

clause(PALADIN, "0:rule", "once the Paladin has been destroyed, damage assigned later is no longer forced onto it", () => {
  const game = palBoard({ atkStrength: 4, atkSpeed: 3 });
  declareAttackBy(game.engine, P2, [game.id("atk"), game.id("atk2")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("pal"), game.id("other")]);
  const seen = playOut(game.engine);
  assert.deepEqual(seen.get(game.id("atk")), [game.id("pal")]);
  assert.equal(zoneOf(game.engine, game.id("pal")), "discard", "4 damage destroyed the 3-life Paladin in the first round");
  assert.deepEqual(seen.get(game.id("atk2")), [game.id("other")], "the Paladin is gone: the slower attacker may only assign to the remaining blocker");
});

clause(PALADIN, "0:rule", "it works both ways: when the Paladin is in the ATTACKING party, a blocker's damage must go to the Paladin", () => {
  const game = devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(game.engine, P1, [game.id("pal"), game.id("ally")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  const seen = playOut(game.engine);
  assert.deepEqual(seen.get(game.id("blk")), [game.id("pal")], "the blocker's damage must be assigned to the Paladin, not the ally");
  assert.equal(damageOn(game.engine, game.id("ally")), 0);
});

clause(PALADIN, "0:rule", "it works both ways: a blocker splitting its damage between the attacking Paladin and the ally is refused", () => {
  const game = devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(game.engine, P1, [game.id("pal"), game.id("ally")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  // speed 3: the attackers (Paladin 2 str / 3 spd) assign first, then the blocker
  toDamageStep(game.engine);
  assignNow(game.engine, [{ sourceId: game.id("pal"), target: toCard(game.id("blk")), amount: 2 }]);
  toDamageStep(game.engine);
  assert.equal(game.engine.state.battle?.phase, "defenderDamageAssignment");
  refused(
    () =>
      assignNow(game.engine, [
        { sourceId: game.id("blk"), target: toCard(game.id("pal")), amount: 1 },
        { sourceId: game.id("blk"), target: toCard(game.id("ally")), amount: 1 }
      ]),
    "1 to the Paladin and 1 to the ally"
  );
  assert.equal(damageOn(game.engine, game.id("ally")), 0);
});

clause(PALADIN, "0:rule", "a Paladin that is not in the battle forces nothing: with it in play but not blocking, the attacker may assign to any blocker", () => {
  const game = palBoard();
  palToDamage(game, ["atk"], ["other", "third"]);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("other"), game.id("third")].sort());
});

clause(PALADIN, "0:rule", "an attacking party blocked by nobody is unaffected: the damage goes to the faction", () => {
  const game = palBoard();
  palToDamage(game, ["atk"], []);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), ["faction:p1"]);
});

clause(PALADIN, "0:rule", "the opponent's Paladin works for them: my attackers' damage must go to their blocking Paladin", () => {
  const game = devBoard(
    [
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "pal", def: printing(PALADIN), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(game.engine, P1, [game.id("atk")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk"), game.id("pal")]);
  toDamageStep(game.engine);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("pal")]);
});

clause(PALADIN, "0:rule", "the blockers' own damage is not redirected: my other blocker still chooses among the attackers freely", () => {
  const game = palBoard({ atkStrength: 1 });
  declareAttackBy(game.engine, P2, [game.id("atk"), game.id("atk2")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("pal"), game.id("other")]);
  const seen = playOut(game.engine);
  assert.deepEqual(seen.get(game.id("other")), [game.id("atk"), game.id("atk2")].sort(), "the Paladin has no say over where my blockers send damage");
});

clause(PALADIN, "0:rule", "Colossal Flattener cannot send its damage past a blocking Paladin to the faction: it must go to the Paladin", () => {
  const game = devBoard(
    [
      { key: "flat", def: printing(FLATTENER), owner: P1, zone: "play" },
      { key: "pal", def: printing(PALADIN), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );
  declareAttackBy(game.engine, P1, [game.id("flat")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("pal"), game.id("blk")]);
  toDamageStep(game.engine);
  assert.deepEqual(legalKeys(game.engine, game.id("flat")), [game.id("pal")]);
  refused(() => assignNow(game.engine, [{ sourceId: game.id("flat"), target: toFaction(P2), amount: 6 }]), "6 to the faction past the Paladin");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(PALADIN, "0:rule", "damage that is not battle damage is not forced onto it: a tactic can hit any character", () => {
  const game = devBoard(
    [
      { key: "pal", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", life: 5 }), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic(2), owner: P1, zone: "hand" }
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("zap"), { selected: { t: [game.id("other")] } });
  assert.equal(damageOn(game.engine, game.id("other")), 2);
  assert.equal(damageOn(game.engine, game.id("pal")), 0);
});

clause(PALADIN, "0:rule", "two Paladins in the blocking party: the attacker puts all its damage on ONE of them (its choice) and nothing on other blockers", () => {
  const game = devBoard(
    [
      { key: "palA", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "palB", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("palA"), game.id("palB"), game.id("other")]);
  toDamageStep(game.engine);
  const keys = legalKeys(game.engine, game.id("atk"));
  assert.ok(!keys.includes(game.id("other")), "never the ordinary blocker");
  assert.deepEqual(keys, [game.id("palA"), game.id("palB")].sort(), "either Paladin may be the one that takes it");
  assignNow(game.engine, [{ sourceId: game.id("atk"), target: toCard(game.id("palB")), amount: 4 }]);
  settleBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("palB")), "discard");
  assert.equal(zoneOf(game.engine, game.id("palA")), "play");
  assert.equal(damageOn(game.engine, game.id("palA")), 0);
  assert.equal(damageOn(game.engine, game.id("other")), 0);
});

clause(PALADIN, "0:rule", "two Paladins: each says ALL the damage must go to it (CR 505.2b / FAQ), so the attacker picks one - splitting it across both is refused", () => {
  const game = devBoard(
    [
      { key: "palA", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "palB", def: printing(PALADIN), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("palA"), game.id("palB")]);
  toDamageStep(game.engine);
  refused(
    () =>
      assignNow(game.engine, [
        { sourceId: game.id("atk"), target: toCard(game.id("palA")), amount: 2 },
        { sourceId: game.id("atk"), target: toCard(game.id("palB")), amount: 2 }
      ]),
    "2 to each Paladin"
  );
  assert.equal(damageOn(game.engine, game.id("palA")), 0);
  assert.equal(damageOn(game.engine, game.id("palB")), 0);
});

clause(PALADIN, "0:rule", "if the Paladin leaves the blocking party (bounced in response), the restriction is gone: the attacker may assign to the remaining blocker", () => {
  const game = palBoard({ extra: [{ key: "bn", def: bouncerTactic(), owner: P1, zone: "hand" }] });
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("pal"), game.id("other")]);
  // the declaration opened a response window: the attacker passes, then I respond
  assert.equal(game.engine.state.responseWindow?.phase, "acceptingResponses");
  if (game.engine.state.priorityPlayerId !== P1) game.engine.perform({ type: "passPriority", playerId: game.engine.state.priorityPlayerId! });
  play(game.engine, P1, game.id("bn"), { selected: { t: [game.id("pal")] } });
  assert.equal(zoneOf(game.engine, game.id("pal")), "hand");
  toDamageStep(game.engine);
  assert.deepEqual(legalKeys(game.engine, game.id("atk")), [game.id("other")]);
});

// =============================================================================
// Dragon Archer
// COST: You may pick a character.
// When this card enters play, if you picked a character as part of its cost, X
// is that character's strength and Y is this card's strength. Inflict X damage
// to this card. Inflict Y damage to that character.
// Character (dragon), cost 5, threshold [R][R], 3 strength / 3 speed / 5 life.
// =============================================================================

const ARCHER = "93e4898c-75ad-4a4f-82c0-8c21ccf9fed5";

interface ArcherOpts {
  rage?: number;
  greed?: number;
  foeStrength?: number;
  foeLife?: number;
  mineStrength?: number;
  extra?: CardPlacement[];
  zone?: "hand" | "play";
}

function archerBoard(o: ArcherOpts = {}) {
  return devBoard(
    [
      { key: "arch", def: printing(ARCHER), owner: P1, zone: o.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: o.foeStrength ?? 2, life: o.foeLife ?? 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Other Foe", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: o.mineStrength ?? 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 3, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}

type ArcherGame = ReturnType<typeof archerBoard>;
const archerPlay = (game: ArcherGame, pick?: string) =>
  playRaw(game.engine, P1, game.id("arch"), { selected: pick === undefined ? {} : { c: [game.id(pick)] } });
const archerDeploy = (game: ArcherGame, pick?: string) => {
  archerPlay(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(ARCHER, "0:ability", "the card itself: cost 5 with [R][R] - refused at 4 resources and with one [R]; pays exactly 5; printed 3 strength / 3 speed / 5 life, a dragon", () => {
  const short = archerBoard({ rage: 2, greed: 2 });
  refused(() => archerPlay(short), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("arch")), "hand");
  const oneRage = archerBoard({ rage: 1, greed: 8 });
  refused(() => archerPlay(oneRage), "only one [R]");
  const ok = archerBoard({ rage: 2, greed: 4 });
  const before = ready(ok.engine);
  archerDeploy(ok);
  assert.equal(zoneOf(ok.engine, ok.id("arch")), "play");
  assert.equal(before - ready(ok.engine), 5);
  assert.equal(ok.engine.getStat(ok.id("arch"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("arch"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("arch"), "life"), 5);
  assert.deepEqual(ok.engine.getDefinition(ok.id("arch")).subtype, ["dragon"]);
});

clause(ARCHER, "0:ability", "'you may pick': it can be played with no pick at all - nobody takes damage", () => {
  const game = archerBoard();
  archerDeploy(game);
  assert.equal(zoneOf(game.engine, game.id("arch")), "play");
  assert.equal(game.engine.state.pendingChoice, undefined);
  for (const key of ["arch", "foe", "foe2", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(ARCHER, "0:ability", "a character of the opponent's can be picked; so can one of mine", () => {
  const theirs = archerBoard();
  archerDeploy(theirs, "foe");
  assert.equal(damageOn(theirs.engine, theirs.id("foe")), 3);
  const mine = archerBoard();
  archerDeploy(mine, "mine");
  assert.equal(damageOn(mine.engine, mine.id("mine")), 3);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(ARCHER, "0:ability", `cannot pick ${why}`, () => {
    const bad = archerBoard();
    refused(() => archerPlay(bad, key), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("arch")), "hand");
    const good = archerBoard();
    archerPlay(good, "foe");
    assert.notEqual(zoneOf(good.engine, good.id("arch")), "hand", "control: a character is accepted");
  });
}

clause(ARCHER, "0:ability", "cannot pick a faction, a resource, itself (still in my hand), or two characters", () => {
  const faction = archerBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("arch"), { selected: { c: [faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = archerBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("arch"), { selected: { c: [resourceId] } }), "a resource");
  const itself = archerBoard();
  refused(() => archerPlay(itself, "arch"), "the Archer itself, which is not in play");
  const two = archerBoard();
  refused(() => playRaw(two.engine, P1, two.id("arch"), { selected: { c: [two.id("foe"), two.id("foe2")] } }), "two characters");
  assert.equal(zoneOf(two.engine, two.id("arch")), "hand");
});

clause(ARCHER, "0:ability", "the pick is part of the cost: it is made when the card is played, before responses, and nothing is damaged until the Archer enters play", () => {
  const game = archerBoard();
  archerPlay(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined, "nothing is asked later");
  assert.equal(zoneOf(game.engine, game.id("arch")), "deploying");
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
  assert.equal(damageOn(game.engine, game.id("arch")), 0);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
});

for (const [foeStrength, archerDamage] of [
  [0, 0],
  [1, 1],
  [2, 2],
  [4, 4]
] as const) {
  clause(ARCHER, "1:rule", `X = the picked character's strength (${foeStrength}): the Archer takes ${archerDamage} damage and survives`, () => {
    const game = archerBoard({ foeStrength });
    archerDeploy(game, "foe");
    assert.equal(zoneOf(game.engine, game.id("arch")), "play");
    assert.equal(damageOn(game.engine, game.id("arch")), archerDamage);
  });
}

clause(ARCHER, "1:rule", "Y = the Archer's strength (3): the picked character takes exactly 3 damage", () => {
  const game = archerBoard({ foeStrength: 2 });
  archerDeploy(game, "foe");
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
  assert.equal(damageOn(game.engine, game.id("foe2")), 0, "only the picked character");
  assert.equal(damageOn(game.engine, game.id("mine")), 0);
});

clause(ARCHER, "1:rule", "X can destroy the Archer: a picked character with 5 strength destroys the 5-life Archer", () => {
  const game = archerBoard({ foeStrength: 5 });
  archerDeploy(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("arch")), "discard", "5 damage on 5 life");
  assert.ok(discardOf(game.engine, P1).includes(game.id("arch")), "discardOf(game.engine, P1).includes(game.id(\"arch\"))");
});

clause(ARCHER, "1:rule", "...and the Archer's own damage to that character is still inflicted (Y was fixed before X was inflicted)", () => {
  const game = archerBoard({ foeStrength: 6 });
  archerDeploy(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("arch")), "discard");
  assert.equal(damageOn(game.engine, game.id("foe")), 3, "the dying Archer still dealt its 3");
});

clause(ARCHER, "1:rule", "the picked character is destroyed if Y reaches its life", () => {
  const game = archerBoard({ foeStrength: 1, foeLife: 3 });
  archerDeploy(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(damageOn(game.engine, game.id("arch")), 1);
});

clause(ARCHER, "1:rule", "Y is the Archer's CURRENT strength: with a +2 strength banner it is 5", () => {
  const game = archerBoard({ extra: [{ key: "banner", def: anthemLocation(2), owner: P1, zone: "play" }] });
  archerDeploy(game, "foe");
  assert.equal(game.engine.getStat(game.id("arch"), "strength"), 5);
  assert.equal(damageOn(game.engine, game.id("foe")), 5, "Y = 5");
  assert.equal(damageOn(game.engine, game.id("arch")), 2, "X = the foe's 2 (the banner is mine)");
});

clause(ARCHER, "1:rule", "X is the picked character's CURRENT strength: my own character under a +2 banner counts 3", () => {
  const game = archerBoard({ mineStrength: 1, extra: [{ key: "banner", def: anthemLocation(2), owner: P1, zone: "play" }] });
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 3);
  archerDeploy(game, "mine");
  assert.equal(damageOn(game.engine, game.id("arch")), 3, "X = 3");
  assert.equal(damageOn(game.engine, game.id("mine")), 5, "Y = 3 + 2 from the banner");
});

clause(ARCHER, "1:rule", "X is read when the Archer enters play: a +2 strength response on the picked character makes X = 4", () => {
  const game = archerBoard({ foeStrength: 2, extra: [{ key: "buff", def: buffTactic("strength", 2), owner: P2, zone: "hand" }] });
  archerPlay(game, "foe");
  play(game.engine, P2, game.id("buff"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("arch")), 4);
});

clause(ARCHER, "1:rule", "with no pick nothing happens even though characters are in play: put into play by an effect it does not trigger its damage", () => {
  const game = archerBoard({ zone: "hand", extra: [{ key: "pip", def: putIntoPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("arch")] } });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("arch")), "play");
  for (const key of ["arch", "foe", "foe2", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(ARCHER, "1:rule", "it triggers only for itself: another character entering play while the Archer is in play damages nobody", () => {
  const game = archerBoard({
    zone: "play",
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  for (const key of ["arch", "foe", "foe2", "mine", "newbie"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(ARCHER, "1:rule", "if the picked character left play before the Archer entered, X is still its (last known) strength: the Archer takes 2 and the effect on the missing character does nothing", () => {
  const game = archerBoard({ foeStrength: 2, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  archerPlay(game, "foe");
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe")] } });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("arch")), "play");
  assert.equal(damageOn(game.engine, game.id("arch")), 2, "'if you picked a character as part of its cost' is true; X is that character's strength");
});

clause(ARCHER, "1:rule", "if the picked character left play before the Archer entered, nobody else is damaged and nothing stalls", () => {
  const game = archerBoard({ foeStrength: 2, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  archerPlay(game, "foe");
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("arch")), "play");
  for (const key of ["foe2", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

// =============================================================================
// Drill Garrison
// UNIQUE DRILL GARRISON
// [R][R][R]: At the start of your turn, you may inflict 1 damage to your
// opponent's faction.
// [R]x5: At the start of your turn, you may pick a character. If you do, deplete it.
// [R]x7: At the start of your turn, you may pick a character. If you do, inflict
// 2 damage to it.
// Location, cost 3, threshold [R], structure 5.
// =============================================================================

const GARRISON = "0dfc144b-12b2-472c-b7af-8c7bbf815a0e";

interface GarrisonOpts {
  rage?: number;
  greed?: number;
  vol?: number;
  foeRage?: number;
  spent?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  oppInfluence?: number;
  extra?: CardPlacement[];
  active?: PlayerId;
}

function garrisonBoard(o: GarrisonOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: o.oppInfluence },
    turn: 2,
    activePlayerId: o.active ?? P2,
    cards: [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Weak Foe", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}

type GarrisonGame = ReturnType<typeof garrisonBoard>;

interface GarrisonPlan {
  /** Take the 1-damage option (default false: decline). */
  accept?: boolean;
  /** Key of the character to deplete (the 5-[R] paragraph), or null to decline. */
  deplete?: string | null;
  /** Key of the character to damage (the 7-[R] paragraph), or null to decline. */
  hurt?: string | null;
}

/** Answers every prompt the Garrison raises at the start of my turn: triggers in printed order, picks as `plan` says. Returns the kinds of prompts seen, in order. */
function garrisonDrain(game: GarrisonGame, plan: GarrisonPlan = {}): string[] {
  const seen: string[] = [];
  let targetPrompts = 0;
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 30) {
    const pc = pending(game.engine)!;
    seen.push(pc.kind);
    let choice: unknown;
    if (pc.kind === "orderTriggers") {
      const triggers = pc.triggers as Array<{ sourceId: string; abilityId: string }>;
      const next = ["t3", "t5", "t7"].map((abilityId) => triggers.find((t) => t.abilityId === abilityId)).find((t) => t !== undefined);
      choice = { kind: "orderTriggers", next: next ?? triggers[0] };
    } else if (pc.kind === "chooserSelectsOption") {
      choice = { kind: "chooserSelectsOption", index: plan.accept ? 1 : 0 };
    } else if (pc.kind === "chooserSelectsTarget") {
      const key = targetPrompts++ === 0 ? plan.deplete : plan.hurt;
      choice = { kind: "chooserSelectsTarget", selected: key ? [game.id(key)] : [] };
    } else {
      choice = declineAll(pc);
    }
    game.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(game.engine);
  }
  return seen;
}

/** The opponent ends their turn: my turn starts and my "at the start of your turn" triggers go off. */
const startMyTurn = (game: GarrisonGame): void => endTurn(game.engine, P2);

// UNIQUE

clause(GARRISON, "0:unique", "the card itself: cost 3 with [R] - refused at 2 resources and with no [R]; pays exactly 3; 5 structure", () => {
  const make = (rage: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "gar", def: printing(GARRISON), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]
    });
  const short = make(2, 0);
  refused(() => playRaw(short.engine, P1, short.id("gar")), "2 resources for cost 3");
  const noRage = make(0, 6);
  refused(() => playRaw(noRage.engine, P1, noRage.id("gar")), "no [R]");
  const ok = make(1, 3);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("gar"));
  assert.equal(zoneOf(ok.engine, ok.id("gar")), "play");
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(ok.engine.getDefinition(ok.id("gar")).structure, 5);
});

clause(GARRISON, "0:unique", "structure 5: it survives 4 damage and is destroyed by the 5th", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "z4", def: locationZapTactic(4), owner: P2, zone: "hand" },
      { key: "z1", def: locationZapTactic(1), owner: P2, zone: "hand" }
    ],
    activePlayerId: P2,
    turn: 2
  });
  play(game.engine, P2, game.id("z4"), { selected: { t: [game.id("gar")] } });
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
  assert.equal(damageOn(game.engine, game.id("gar")), 4);
  play(game.engine, P2, game.id("z1"), { selected: { t: [game.id("gar")] } });
  assert.equal(zoneOf(game.engine, game.id("gar")), "discard");
});

clause(GARRISON, "0:unique", "a second Garrison forces me to choose one to keep: keeping the new one destroys the old one", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "gar2", def: printing(GARRISON), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("gar2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("gar"), game.id("gar2")].sort());
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("gar2") } } as never);
  assert.equal(zoneOf(game.engine, game.id("gar2")), "play");
  assert.equal(zoneOf(game.engine, game.id("gar")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(GARRISON, "0:unique", "keeping the old Garrison destroys the new one", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "gar2", def: printing(GARRISON), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("gar2"));
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("gar") } } as never);
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
  assert.equal(zoneOf(game.engine, game.id("gar2")), "discard");
});

clause(GARRISON, "0:unique", "the choice must name one of the Garrisons, not another card", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "gar2", def: printing(GARRISON), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("gar2"));
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("bystander") } } as never),
    "keeping a bystander",
    /./
  );
  assert.equal(zoneOf(game.engine, game.id("bystander")), "play");
  assert.ok(game.engine.state.pendingChoice, "still waiting for a real answer");
});

clause(GARRISON, "0:unique", "UNIQUE is per player: the opponent may control their own Garrison at the same time with no choice and no destruction", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "gar2", def: printing(GARRISON), owner: P2, zone: "hand" },
      ...bank("rage", 3, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(game.engine, P2, game.id("gar2"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
  assert.equal(zoneOf(game.engine, game.id("gar2")), "play");
});

clause(GARRISON, "0:unique", "a second Garrison in my hand or discard pile is no conflict; after the first is destroyed a new one plays with no choice", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "inHand", def: printing(GARRISON), owner: P1, zone: "hand" },
      { key: "inDisc", def: printing(GARRISON), owner: P1, zone: "discard" }
    ],
    { turn: 2 }
  );
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
  const fresh = devBoard(
    [
      { key: "old", def: printing(GARRISON), owner: P1, zone: "discard" },
      { key: "gar2", def: printing(GARRISON), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(fresh.engine, P1, fresh.id("gar2"));
  assert.equal(fresh.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(fresh.engine, fresh.id("gar2")), "play");
});

clause(GARRISON, "0:unique", "a different UNIQUE designation (or none) is not a duplicate: a Garrison and Elzibeth coexist", () => {
  const game = devBoard(
    [
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" },
      { key: "elz", def: printing("d4611011-17cd-42a7-a15e-53b0ba75e23d"), owner: P1, zone: "play" }
    ],
    { turn: 2 }
  );
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
  assert.equal(zoneOf(game.engine, game.id("elz")), "play");
});

// [R][R][R]: 1 damage to the opponent's faction

clause(GARRISON, "1:rule@rrr", "with [R][R][R], at the start of my turn I may inflict 1 damage to the opponent's faction: accepting costs them exactly 1 influence", () => {
  const game = garrisonBoard({ rage: 3 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: true });
  assert.deepEqual(seen, ["chooserSelectsOption"], "a single 'may' prompt for me");
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(influenceOf(game.engine, P1), START, "not mine");
  assert.equal(game.engine.state.activePlayerId, P1);
});

clause(GARRISON, "1:rule@rrr", "'you may': declining the damage costs the opponent nothing", () => {
  const game = garrisonBoard({ rage: 3 });
  startMyTurn(game);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  garrisonDrain(game, { accept: false });
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(GARRISON, "1:rule@rrr", "the damage is only 1 and happens once: it does not repeat during the turn", () => {
  const game = garrisonBoard({ rage: 3 });
  startMyTurn(game);
  garrisonDrain(game, { accept: true });
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(GARRISON, "1:rule@rrr", "with only [R][R] (and plenty of other resources) nothing is offered", () => {
  const game = garrisonBoard({ rage: 2, greed: 6 });
  startMyTurn(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "icons count, not cards: other icons, face-down Volition and the opponent's [R] do not meet [R][R][R]", () => {
  const game = garrisonBoard({ rage: 2, greed: 4, vol: 3, foeRage: 5 });
  startMyTurn(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "[R] that are spent (attached to my faction) still meet the threshold at the start of my turn", () => {
  const game = garrisonBoard({ rage: 1, spent: 2 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: true });
  assert.deepEqual(seen, ["chooserSelectsOption"]);
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(GARRISON, "1:rule@rrr", "it is not cumulative: with four [R] it still offers exactly one 1-damage option", () => {
  const game = garrisonBoard({ rage: 4 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: true });
  assert.deepEqual(seen, ["chooserSelectsOption"]);
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(GARRISON, "1:rule@rrr", "'at the start of YOUR turn': at the start of the opponent's turn nothing is offered", () => {
  const game = garrisonBoard({ rage: 3, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(GARRISON, "1:rule@rrr", "it does not fire at any other time in my turn (only at the start): playing a card mid-turn does not raise it", () => {
  const game = garrisonBoard({ rage: 3, active: P1, extra: [{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("zap"), { selected: { t: [game.id("foe")] } });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "the opponent's faction at 1 influence: the damage brings it to 0 and I win", () => {
  const game = garrisonBoard({ rage: 3, oppInfluence: 1 });
  startMyTurn(game);
  garrisonDrain(game, { accept: true });
  assert.equal(influenceOf(game.engine, P2), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(GARRISON, "1:rule@rrr", "only while the Garrison is in play: in my hand it does nothing", () => {
  const game = garrisonBoard({ rage: 7, zone: "hand" });
  startMyTurn(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "a face-down Garrison is only a resource (CR 411.1): it does nothing", () => {
  const game = garrisonBoard({ rage: 7, faceDown: true });
  startMyTurn(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "once the Garrison is destroyed it no longer fires at the start of my turn", () => {
  const game = garrisonBoard({ rage: 3, extra: [{ key: "z5", def: locationZapTactic(5), owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("z5"), { selected: { t: [game.id("gar")] } });
  assert.equal(zoneOf(game.engine, game.id("gar")), "discard");
  startMyTurn(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(GARRISON, "1:rule@rrr", "'your turn' is its controller's: a Garrison I own but the opponent controls fires at THEIR turn start, with THEIR [R], against ME", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gar", def: printing(GARRISON), owner: P1, controller: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1),
      ...bank("rage", 3, P2)
    ]
  });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the controller is asked");
  answerPending(game.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influenceOf(game.engine, P1), START - 1, "'your opponent's faction' from the controller's view is mine");
  assert.equal(influenceOf(game.engine, P2), START);
});

// [R]x5: pick a character, deplete it

clause(GARRISON, "2:rule@rrrrr", "with [R]x5, at the start of my turn I may pick a character and deplete it", () => {
  const game = garrisonBoard({ rage: 5 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { deplete: "foe" });
  assert.ok(seen.includes("chooserSelectsTarget"), "seen.includes(\"chooserSelectsTarget\")");
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
  assert.equal(isDepleted(game.engine, game.id("foe2")), false, "only the picked character");
  assert.equal(isDepleted(game.engine, game.id("mine")), false);
});

clause(GARRISON, "2:rule@rrrrr", "'you may pick': declining leaves everybody ready", () => {
  const game = garrisonBoard({ rage: 5 });
  startMyTurn(game);
  garrisonDrain(game, { deplete: null });
  for (const key of ["foe", "foe2", "mine"]) assert.equal(isDepleted(game.engine, game.id(key)), false, key);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(GARRISON, "2:rule@rrrrr", "a character of mine can be picked and depleted too", () => {
  const game = garrisonBoard({ rage: 5 });
  startMyTurn(game);
  garrisonDrain(game, { deplete: "mine" });
  assert.equal(isDepleted(game.engine, game.id("mine")), true);
});

clause(GARRISON, "2:rule@rrrrr", "the pick prompt goes to me, and it is separate from the 1-damage option (both [R]x3 and [R]x5 apply with five [R])", () => {
  const game = garrisonBoard({ rage: 5 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: true, deplete: "foe" });
  assert.deepEqual([...seen].sort(), ["chooserSelectsOption", "chooserSelectsTarget", "orderTriggers"].sort());
  assert.equal(influenceOf(game.engine, P2), START - 1, "the [R]x3 paragraph still works");
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
});

clause(GARRISON, "2:rule@rrrrr", "with only four [R] no character pick is offered (just the 1-damage option)", () => {
  const game = garrisonBoard({ rage: 4, greed: 4 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: false, deplete: "foe" });
  assert.deepEqual(seen, ["chooserSelectsOption"]);
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(GARRISON, "2:rule@rrrrr", "icons count: other icons, Volition and the opponent's [R] do not make five [R]", () => {
  const game = garrisonBoard({ rage: 4, greed: 4, vol: 3, foeRage: 5 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { deplete: "foe" });
  assert.ok(!seen.includes("chooserSelectsTarget"), "!seen.includes(\"chooserSelectsTarget\")");
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(GARRISON, "2:rule@rrrrr", "spent [R] still count towards the five", () => {
  const game = garrisonBoard({ rage: 2, spent: 3 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { deplete: "foe" });
  assert.ok(seen.includes("chooserSelectsTarget"), "seen.includes(\"chooserSelectsTarget\")");
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(GARRISON, "2:rule@rrrrr", `the pick must be a character: ${why} is refused`, () => {
    const bad = garrisonBoard({ rage: 5 });
    startMyTurn(bad);
    // skip the 1-damage prompt: order t3 first, decline, then the pick prompt
    let pc = pending(bad.engine)!;
    while (pc.kind !== "chooserSelectsTarget") {
      if (pc.kind === "orderTriggers") {
        const triggers = pc.triggers as Array<{ sourceId: string; abilityId: string }>;
        bad.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: triggers.find((t) => t.abilityId === "t3") } } as never);
      } else {
        bad.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
      }
      resolvePendingResponses(bad.engine);
      pc = pending(bad.engine)!;
    }
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    const good = garrisonBoard({ rage: 5 });
    startMyTurn(good);
    garrisonDrain(good, { deplete: "foe" });
    assert.equal(isDepleted(good.engine, good.id("foe")), true, "control: a character is accepted");
  });
}

clause(GARRISON, "2:rule@rrrrr", "a depleted opposing blocker cannot block my attack this turn", () => {
  const game = garrisonBoard({ rage: 5 });
  startMyTurn(game);
  garrisonDrain(game, { deplete: "foe" });
  declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2));
  refused(() => game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe")] }), "a depleted character blocking");
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe2")] });
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foe2")], "control: an undepleted character can block");
});

clause(GARRISON, "2:rule@rrrrr", "picking a character that is already depleted does nothing and does not stall", () => {
  const game = garrisonBoard({ rage: 5, extra: [{ key: "tired", def: character({ name: "Tired", life: 5 }), owner: P2, zone: "play", depleted: true }] });
  startMyTurn(game);
  garrisonDrain(game, { deplete: "tired" });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.activePlayerId, P1);
});

// [R]x7: pick a character, 2 damage

clause(GARRISON, "3:rule@rrrrrrr", "with [R]x7, at the start of my turn I may pick a character and inflict exactly 2 damage to it", () => {
  const game = garrisonBoard({ rage: 7 });
  startMyTurn(game);
  garrisonDrain(game, { hurt: "foe" });
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  assert.equal(damageOn(game.engine, game.id("foe2")), 0);
  assert.equal(damageOn(game.engine, game.id("mine")), 0);
});

clause(GARRISON, "3:rule@rrrrrrr", "'you may pick': declining deals no damage", () => {
  const game = garrisonBoard({ rage: 7 });
  startMyTurn(game);
  garrisonDrain(game, { hurt: null });
  for (const key of ["foe", "foe2", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(GARRISON, "3:rule@rrrrrrr", "2 damage destroys a 2-life character", () => {
  const game = garrisonBoard({ rage: 7 });
  startMyTurn(game);
  garrisonDrain(game, { hurt: "foe2" });
  assert.equal(zoneOf(game.engine, game.id("foe2")), "discard");
});

clause(GARRISON, "3:rule@rrrrrrr", "a character of mine can be picked and takes the 2 damage", () => {
  const game = garrisonBoard({ rage: 7 });
  startMyTurn(game);
  garrisonDrain(game, { hurt: "mine" });
  assert.equal(damageOn(game.engine, game.id("mine")), 2);
});

clause(GARRISON, "3:rule@rrrrrrr", "with seven [R] all three paragraphs apply: 1 damage to the faction, a depleted character and 2 damage to a character", () => {
  const game = garrisonBoard({ rage: 7 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: true, deplete: "foe", hurt: "foe2" });
  assert.ok(seen.includes("orderTriggers"), "seen.includes(\"orderTriggers\")");
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
  assert.equal(zoneOf(game.engine, game.id("foe2")), "discard");
});

clause(GARRISON, "3:rule@rrrrrrr", "with six [R] the 2-damage paragraph is off: only the 1-damage option and the deplete pick are offered", () => {
  const game = garrisonBoard({ rage: 6 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { accept: false, deplete: "foe", hurt: "foe2" });
  assert.equal(seen.filter((kind) => kind === "chooserSelectsTarget").length, 1, "one pick prompt (deplete), not two");
  assert.equal(damageOn(game.engine, game.id("foe2")), 0);
});

clause(GARRISON, "3:rule@rrrrrrr", "icons count: other icons, Volition and the opponent's [R] do not make seven [R]", () => {
  const game = garrisonBoard({ rage: 6, greed: 4, vol: 3, foeRage: 7 });
  startMyTurn(game);
  const seen = garrisonDrain(game, { hurt: "foe2" });
  assert.equal(seen.filter((kind) => kind === "chooserSelectsTarget").length, 1);
  assert.equal(damageOn(game.engine, game.id("foe2")), 0);
});

clause(GARRISON, "3:rule@rrrrrrr", "spent [R] still count towards the seven", () => {
  const game = garrisonBoard({ rage: 3, spent: 4 });
  startMyTurn(game);
  garrisonDrain(game, { hurt: "foe" });
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(GARRISON, "3:rule@rrrrrrr", `the pick must be a character: ${why} is refused`, () => {
    const bad = garrisonBoard({ rage: 7 });
    startMyTurn(bad);
    // resolve the three triggers in order, declining the first two, and stop at the second pick prompt (the 2 damage)
    let targetPrompts = 0;
    let pc = pending(bad.engine)!;
    while (!(pc.kind === "chooserSelectsTarget" && targetPrompts === 1)) {
      let choice: unknown;
      if (pc.kind === "orderTriggers") {
        const triggers = pc.triggers as Array<{ sourceId: string; abilityId: string }>;
        const next = ["t3", "t5", "t7"].map((a) => triggers.find((t) => t.abilityId === a)).find((t) => t !== undefined);
        choice = { kind: "orderTriggers", next };
      } else {
        if (pc.kind === "chooserSelectsTarget") targetPrompts++;
        choice = declineAll(pc);
      }
      bad.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
      resolvePendingResponses(bad.engine);
      pc = pending(bad.engine)!;
    }
    targetPrompts++;
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    const good = garrisonBoard({ rage: 7 });
    startMyTurn(good);
    garrisonDrain(good, { hurt: "foe" });
    assert.equal(damageOn(good.engine, good.id("foe")), 2, "control");
  });
}

// =============================================================================
// Elzibeth, Military Sorceress
// UNIQUE ELZIBETH
// REANIMATE -- COST: Pay 2. Deplete this card. Pick a character in your discard
// pile. -- EFFECT: Put the character on the top of your deck.
// Character (sorceress), cost 4, threshold [R][R][R], 1 strength / 3 speed / 3 life.
// =============================================================================

const ELZ = "d4611011-17cd-42a7-a15e-53b0ba75e23d";

interface ElzOpts {
  rage?: number;
  greed?: number;
  spent?: number;
  zone?: "hand" | "play";
  depleted?: boolean;
  faceDown?: boolean;
  fresh?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function elzBoard(o: ElzOpts = {}) {
  return devBoard(
    [
      {
        key: "elz",
        def: printing(ELZ),
        owner: P1,
        zone: o.zone ?? "play",
        depleted: o.depleted,
        faceDown: o.faceDown ? true : undefined,
        attackEligible: o.fresh ? false : undefined
      },
      { key: "corpse", def: character({ name: "Corpse", strength: 2, life: 2 }), owner: P1, zone: "discard" },
      { key: "corpse2", def: character({ name: "Second Corpse", strength: 3, life: 4 }), owner: P1, zone: "discard" },
      { key: "relic", def: item({ name: "Relic" }), owner: P1, zone: "discard" },
      { key: "spell", def: tactic({ name: "Spent Spell", cost: 0 }), owner: P1, zone: "discard" },
      { key: "oppCorpse", def: character({ name: "Their Corpse" }), owner: P2, zone: "discard" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "alive", def: character({ name: "Alive", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type ElzGame = ReturnType<typeof elzBoard>;
const elzReanimateRaw = (game: ElzGame, pick: string[], player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("elz"), "reanimate", { c: pick.map((key) => game.id(key)) });
const elzReanimate = (game: ElzGame, pick = "corpse") => {
  elzReanimateRaw(game, [pick]);
  resolvePendingResponses(game.engine);
};

clause(ELZ, "0:unique", "the card itself: cost 4 with [R][R][R] - refused at 3 resources and with two [R]; pays exactly 4; printed 1 strength / 3 speed / 3 life, a sorceress", () => {
  const short = elzBoard({ zone: "hand", rage: 3, greed: 0 });
  refused(() => playRaw(short.engine, P1, short.id("elz")), "3 resources for cost 4");
  const twoRage = elzBoard({ zone: "hand", rage: 2, greed: 6 });
  refused(() => playRaw(twoRage.engine, P1, twoRage.id("elz")), "only two [R]");
  const ok = elzBoard({ zone: "hand", rage: 3, greed: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("elz"));
  assert.equal(zoneOf(ok.engine, ok.id("elz")), "play");
  assert.equal(before - ready(ok.engine), 4);
  assert.equal(ok.engine.getStat(ok.id("elz"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("elz"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("elz"), "life"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("elz")).subtype, ["sorceress"]);
});

clause(ELZ, "0:unique", "a second Elzibeth forces me to choose one to keep: keeping the new one destroys the old one", () => {
  const game = elzBoard({ rage: 3, greed: 2, extra: [{ key: "elz2", def: printing(ELZ), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("elz2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("elz"), game.id("elz2")].sort());
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("elz2") } } as never);
  assert.equal(zoneOf(game.engine, game.id("elz2")), "play");
  assert.equal(zoneOf(game.engine, game.id("elz")), "discard");
});

clause(ELZ, "0:unique", "keeping the old Elzibeth destroys the new one", () => {
  const game = elzBoard({ rage: 3, greed: 2, extra: [{ key: "elz2", def: printing(ELZ), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("elz2"));
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("elz") } } as never);
  assert.equal(zoneOf(game.engine, game.id("elz")), "play");
  assert.equal(zoneOf(game.engine, game.id("elz2")), "discard");
});

clause(ELZ, "0:unique", "UNIQUE is per player: the opponent may control their own Elzibeth with no choice and no destruction", () => {
  const game = elzBoard({
    active: P2,
    extra: [{ key: "elz2", def: printing(ELZ), owner: P2, zone: "hand" }, ...bank("rage", 4, P2)]
  });
  play(game.engine, P2, game.id("elz2"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("elz")), "play");
  assert.equal(zoneOf(game.engine, game.id("elz2")), "play");
});

clause(ELZ, "0:unique", "a second copy in my hand or discard pile is no conflict; a different UNIQUE (Drill Garrison) is no duplicate", () => {
  const game = elzBoard({
    extra: [
      { key: "inHandElz", def: printing(ELZ), owner: P1, zone: "hand" },
      { key: "discElz", def: printing(ELZ), owner: P1, zone: "discard" },
      { key: "gar", def: printing(GARRISON), owner: P1, zone: "play" }
    ]
  });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("elz")), "play");
  assert.equal(zoneOf(game.engine, game.id("gar")), "play");
});

clause(ELZ, "0:unique", "the choice must name one of the Elzibeths", () => {
  const game = elzBoard({ rage: 3, greed: 2, extra: [{ key: "elz2", def: printing(ELZ), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("elz2"));
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("alive") } } as never),
    "keeping a bystander",
    /./
  );
  assert.ok(game.engine.state.pendingChoice, "game.engine.state.pendingChoice");
});

// REANIMATE

clause(ELZ, "1:ability:reanimate", "REANIMATE pays exactly 2, depletes Elzibeth, and puts the picked character on the top of my deck", () => {
  const game = elzBoard({ rage: 2, greed: 3 });
  const before = ready(game.engine);
  const deckBefore = deckOf(game.engine, P1);
  elzReanimate(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(game.engine), 2, "COST: Pay 2");
  assert.equal(isDepleted(game.engine, game.id("elz")), true, "COST: Deplete this card");
  assert.equal(zoneOf(game.engine, game.id("corpse")), "deck", "EFFECT: the character goes to my deck");
  assert.deepEqual(deckOf(game.engine, P1), [game.id("corpse"), ...deckBefore], "on the TOP: every other deck card keeps its order below it");
  assert.equal(discardOf(game.engine, P1).includes(game.id("corpse")), false);
});

clause(ELZ, "1:ability:reanimate", "the costs are paid when the ability is used (before responses): 2 resources spent and Elzibeth depleted while the character is still in the discard pile", () => {
  const game = elzBoard();
  const before = ready(game.engine);
  elzReanimateRaw(game, ["corpse"]);
  assert.equal(before - ready(game.engine), 2);
  assert.equal(isDepleted(game.engine, game.id("elz")), true);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "discard");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "deck");
});

clause(ELZ, "1:ability:reanimate", "only the picked character moves: the other characters in my discard pile, and Elzibeth, stay where they are", () => {
  const game = elzBoard();
  elzReanimate(game, "corpse2");
  assert.equal(zoneOf(game.engine, game.id("corpse2")), "deck");
  assert.equal(zoneOf(game.engine, game.id("corpse")), "discard");
  assert.equal(zoneOf(game.engine, game.id("relic")), "discard");
  assert.equal(zoneOf(game.engine, game.id("elz")), "play");
  assert.equal(deckOf(game.engine, P1)[0], game.id("corpse2"));
  assert.equal(deckOf(game.engine, P1).length, 4);
});

clause(ELZ, "1:ability:reanimate", "REANIMATE needs no threshold: it works with Greed only", () => {
  const game = elzBoard({ rage: 0, greed: 2 });
  elzReanimate(game);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "deck");
});

clause(ELZ, "1:ability:reanimate", "REANIMATE is refused one resource short of its pay-2 (1 ready, the other spent) and nothing is paid or depleted", () => {
  const bad = elzBoard({ rage: 1, spent: 1 });
  assert.equal(ready(bad.engine), 1);
  refused(() => elzReanimateRaw(bad, ["corpse"]), "1 ready resource for pay 2");
  assert.equal(isDepleted(bad.engine, bad.id("elz")), false);
  assert.equal(zoneOf(bad.engine, bad.id("corpse")), "discard");
  assert.equal(ready(bad.engine), 1);
  const good = elzBoard({ rage: 2, spent: 1 });
  elzReanimate(good);
  assert.equal(zoneOf(good.engine, good.id("corpse")), "deck", "control: two ready resources");
});

clause(ELZ, "1:ability:reanimate", "a depleted Elzibeth cannot REANIMATE (a card can't be depleted again, CR 303.2)", () => {
  const bad = elzBoard({ depleted: true, rage: 4 });
  refused(() => elzReanimateRaw(bad, ["corpse"]), "REANIMATE while depleted");
  assert.equal(zoneOf(bad.engine, bad.id("corpse")), "discard");
  assert.equal(ready(bad.engine), 4, "nothing was paid");
  const good = elzBoard({ rage: 4 });
  elzReanimate(good);
  assert.equal(zoneOf(good.engine, good.id("corpse")), "deck", "control");
});

clause(ELZ, "1:ability:reanimate", "once used, Elzibeth is depleted and cannot REANIMATE again this turn; after my next turn starts she is restored and can", () => {
  const game = elzBoard({ rage: 6 });
  elzReanimate(game, "corpse");
  refused(() => elzReanimateRaw(game, ["corpse2"]), "a second REANIMATE the same turn");
  assert.equal(zoneOf(game.engine, game.id("corpse2")), "discard");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(game.engine, game.id("elz")), false, "restored at the start of my turn");
  elzReanimate(game, "corpse2");
  assert.equal(zoneOf(game.engine, game.id("corpse2")), "deck");
});

for (const [key, why] of [
  ["oppCorpse", "a character in my OPPONENT's discard pile"],
  ["alive", "a character of mine in play"],
  ["foe", "a character of the opponent's in play"],
  ["inHand", "a character card in my hand"],
  ["relic", "an item in my discard pile"],
  ["spell", "a tactic in my discard pile"]
] as const) {
  clause(ELZ, "1:ability:reanimate", `cannot pick ${why}; nothing is paid`, () => {
    const bad = elzBoard();
    refused(() => elzReanimateRaw(bad, [key]), `picking ${why}`);
    assert.equal(isDepleted(bad.engine, bad.id("elz")), false);
    assert.equal(ready(bad.engine), 2);
    const good = elzBoard();
    elzReanimate(good);
    assert.equal(zoneOf(good.engine, good.id("corpse")), "deck", "control: a character in my discard pile");
  });
}

clause(ELZ, "1:ability:reanimate", "cannot pick a deck card, a faction, or Elzibeth herself; needs exactly one pick", () => {
  const fillerBad = elzBoard();
  refused(() => elzReanimateRaw(fillerBad, ["d0"]), "a card in my deck");
  const faction = elzBoard();
  refused(() => actRaw(faction.engine, P1, faction.id("elz"), "reanimate", { c: [faction.engine.state.players[P1].factionId!] }), "my faction");
  const self = elzBoard();
  refused(() => elzReanimateRaw(self, ["elz"]), "Elzibeth herself (in play, not in my discard pile)");
  const none = elzBoard();
  refused(() => elzReanimateRaw(none, []), "no pick");
  const two = elzBoard();
  refused(() => elzReanimateRaw(two, ["corpse", "corpse2"]), "two picks");
  assert.equal(zoneOf(two.engine, two.id("corpse")), "discard");
  assert.equal(zoneOf(two.engine, two.id("corpse2")), "discard");
});

clause(ELZ, "1:ability:reanimate", "with no character in my discard pile REANIMATE cannot be used", () => {
  const game = devBoard(
    [
      { key: "elz", def: printing(ELZ), owner: P1, zone: "play" },
      { key: "relic", def: item({ name: "Relic" }), owner: P1, zone: "discard" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  refused(() => actRaw(game.engine, P1, game.id("elz"), "reanimate", { c: [game.id("relic")] }), "nothing legal to pick");
  assert.equal(isDepleted(game.engine, game.id("elz")), false);
});

clause(ELZ, "1:ability:reanimate", "a character that has just entered play can use it (abilities work on the turn a character enters play, CR 204.3a)", () => {
  const game = elzBoard({ fresh: true });
  assert.equal(game.engine.state.cards[game.id("elz")].attackEligibleTurn, undefined);
  elzReanimate(game);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "deck");
});

clause(ELZ, "1:ability:reanimate", "the card put on top is the next one I draw", () => {
  const game = elzBoard();
  elzReanimate(game);
  developDraw(game.engine, P1);
  assert.ok(handOf(game.engine, P1).includes(game.id("corpse")), "the reanimated character was drawn");
});

clause(ELZ, "1:ability:reanimate", "it is an ability: usable in response to the opponent's attack", () => {
  const game = elzBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  elzReanimate(game);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "deck");
  assert.equal(isDepleted(game.engine, game.id("elz")), true);
});

clause(ELZ, "1:ability:reanimate", "only Elzibeth's controller can use it: the opponent cannot REANIMATE with my Elzibeth", () => {
  const game = elzBoard({
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" }, ...bank("rage", 3, P2)]
  });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => elzReanimateRaw(game, ["corpse"], P2), "the opponent using my Elzibeth", /control|own|cannot|illegal|only/i);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "discard");
});

clause(ELZ, "1:ability:reanimate", "a face-down Elzibeth is only a resource (CR 411.1) and has no REANIMATE", () => {
  const bad = elzBoard({ faceDown: true });
  refused(() => elzReanimateRaw(bad, ["corpse"]), "a face-down card using the ability");
  assert.equal(zoneOf(bad.engine, bad.id("corpse")), "discard");
});

clause(ELZ, "1:ability:reanimate", "an Elzibeth in my hand cannot use it", () => {
  const bad = elzBoard({ zone: "hand" });
  refused(() => elzReanimateRaw(bad, ["corpse"]), "REANIMATE from my hand");
  assert.equal(zoneOf(bad.engine, bad.id("corpse")), "discard");
});

clause(ELZ, "1:ability:reanimate", "if the picked character leaves my discard pile in response, the effect loses track of it and does not fetch it back (CR 402.4)", () => {
  const game = elzBoard({ extra: [{ key: "dr", def: discardRemoverTactic(), owner: P2, zone: "hand" }] });
  elzReanimateRaw(game, ["corpse"]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  play(game.engine, P2, game.id("dr"), { selected: { t: [game.id("corpse")] } });
  assert.equal(zoneOf(game.engine, game.id("corpse")), "removed");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("corpse")), "removed", "it was removed from the game, so it cannot go to my deck");
  assert.equal(deckOf(game.engine, P1).includes(game.id("corpse")), false);
  assert.equal(isDepleted(game.engine, game.id("elz")), true, "the costs stay paid");
});

// =============================================================================
// Enduring Swordsman
// If this card leaves play, you may pick a character. If you do, inflict 1
// damage to it.
// Character (soldier), cost 1, threshold [R][R], 1 strength / 3 speed / 1 life.
// =============================================================================

const SWORD = "c793f1b9-b4c4-48f4-b076-8074f2e6eb30";

interface SwordOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play" | "discard";
  faceDown?: boolean;
  noOthers?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function swordBoard(o: SwordOpts = {}) {
  return devBoard(
    [
      { key: "sw", def: printing(SWORD), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      ...(o.noOthers
        ? []
        : [
            { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "foe1", def: character({ name: "Fragile Foe", strength: 1, life: 1, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" as const },
            { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" as const },
            { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" as const }
          ]),
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type SwordGame = ReturnType<typeof swordBoard>;

/** Makes the Swordsman leave play by killing it with the opponent's tactic, played in response to a dummy action of mine. */
function killSword(opts: { extra?: CardPlacement[] } = {}) {
  const game = swordBoard({ rage: 2, extra: [{ key: "dummy", def: noopCard(), owner: P1, zone: "play" }, ...(opts.extra ?? [])] });
  actRaw(game.engine, P1, game.id("dummy"), "noop");
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("sw")] } });
  return game;
}

/** A character with a free do-nothing ability (id "noop"): lets me open a response window on my own turn. */
function noopCard(): CardDefinition {
  return character({ name: "Idler", strength: 1, life: 5, speed: 2, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });
}

clause(SWORD, "0:rule", "the card itself: cost 1 with [R][R] - refused with no resources and with one [R]; pays exactly 1; printed 1 strength / 3 speed / 1 life, a soldier", () => {
  const none = swordBoard({ zone: "hand", rage: 0 });
  refused(() => playRaw(none.engine, P1, none.id("sw")), "no resources");
  const oneRage = swordBoard({ zone: "hand", rage: 1, greed: 5 });
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("sw")), "only one [R]");
  const ok = swordBoard({ zone: "hand", rage: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("sw"));
  assert.equal(zoneOf(ok.engine, ok.id("sw")), "play");
  assert.equal(before - ready(ok.engine), 1);
  assert.equal(ok.engine.getStat(ok.id("sw"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("sw"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("sw"), "life"), 1);
  assert.deepEqual(ok.engine.getDefinition(ok.id("sw")).subtype, ["soldier"]);
});

clause(SWORD, "0:rule", "destroyed: I may pick a character and it takes exactly 1 damage", () => {
  const game = killSword();
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I pick, even though my opponent destroyed it");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 1);
  assert.equal(damageOn(game.engine, game.id("mine")), 0);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(SWORD, "0:rule", "'you may pick': declining deals no damage to anyone", () => {
  const game = killSword();
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["foe", "foe1", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(SWORD, "0:rule", "1 damage destroys a 1-life character", () => {
  const game = killSword();
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe1")] });
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard");
});

clause(SWORD, "0:rule", "a character of mine can be picked", () => {
  const game = killSword();
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine")] });
  assert.equal(damageOn(game.engine, game.id("mine")), 1);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(SWORD, "0:rule", `the pick must be a character: ${why} is refused`, () => {
    const bad = killSword();
    resolvePendingResponses(bad.engine);
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    const good = killSword();
    resolvePendingResponses(good.engine);
    answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id("foe")] });
    assert.equal(damageOn(good.engine, good.id("foe")), 1, "control");
  });
}

clause(SWORD, "0:rule", "the pick cannot be a faction, a resource, the departed Swordsman itself, or two characters", () => {
  const make = () => {
    const game = killSword();
    resolvePendingResponses(game.engine);
    return game;
  };
  const faction = make();
  refused(() => answerPending(faction.engine, "chooserSelectsTarget", { selected: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const resource = make();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => answerPending(resource.engine, "chooserSelectsTarget", { selected: [resourceId] }), "a resource");
  const self = make();
  refused(() => answerPending(self.engine, "chooserSelectsTarget", { selected: [self.id("sw")] }), "the Swordsman itself, which is no longer in play");
  const two = make();
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe"), two.id("mine")] }), "two characters");
  assert.equal(damageOn(two.engine, two.id("foe")), 0);
  assert.equal(damageOn(two.engine, two.id("mine")), 0);
});

clause(SWORD, "0:rule", "it triggers when it is returned to its owner's hand", () => {
  const game = swordBoard({ extra: [{ key: "bn", def: bouncerTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bn"), { selected: { t: [game.id("sw")] } });
  assert.equal(zoneOf(game.engine, game.id("sw")), "hand");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 1);
});

clause(SWORD, "0:rule", "it triggers when it is removed from the game", () => {
  const game = swordBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("rm"), { selected: { t: [game.id("sw")] } });
  assert.equal(zoneOf(game.engine, game.id("sw")), "removed");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 1);
});

clause(SWORD, "0:rule", "it triggers when it is destroyed by my own effect too", () => {
  const game = swordBoard({ extra: [{ key: "mykill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("mykill"), { selected: { t: [game.id("sw")] } });
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe1")] });
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard");
});

clause(SWORD, "0:rule", "it triggers when it dies in battle: a blocker with 1 life destroyed by an attacker raises the pick during the fight", () => {
  const game = devBoard(
    [
      { key: "sw", def: printing(SWORD), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Fragile Foe", life: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("sw")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard", "3 damage on 1 life");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe1")] });
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard");
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined, "the battle finishes after the pick");
});

clause(SWORD, "0:rule", "it does not trigger for another card leaving play", () => {
  const game = swordBoard({ extra: [{ key: "mykill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("mykill"), { selected: { t: [game.id("foe")] } });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "the Swordsman is still in play and nothing is asked");
  assert.equal(zoneOf(game.engine, game.id("sw")), "play");
});

clause(SWORD, "0:rule", "it does not trigger when it moves between zones that are not play (discard pile to hand)", () => {
  const game = swordBoard({ zone: "discard" });
  assert.equal(game.engine.state.pendingChoice, undefined);
  for (const key of ["foe", "foe1", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(SWORD, "0:rule", "a face-down Swordsman is only a resource: when it leaves play nothing triggers (CR 411.1)", () => {
  const game = swordBoard({
    faceDown: true,
    extra: [{ key: "rk", def: destroyerTactic("resource"), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("rk"), { selected: { t: [game.id("sw")] } });
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "no pick is offered");
  for (const key of ["foe", "foe1", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(SWORD, "0:rule", "with no other character in play there is nothing to pick: no prompt and no stall", () => {
  const game = swordBoard({ noOthers: true, extra: [{ key: "mykill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("mykill"), { selected: { t: [game.id("sw")] } });
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard");
});

clause(SWORD, "0:rule", "two Swordsmen destroyed together (a sweep that spares a bystander) each ask for a pick and each deal 1 damage", () => {
  const sparing = tactic({
    name: "Sweep Soldiers",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { type: "character", name: "Enduring Swordsman" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
  const game = swordBoard({
    extra: [
      { key: "sw2", def: printing(SWORD), owner: P1, zone: "play" },
      { key: "swp", def: sparing, owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("swp"));
  let picks = 0;
  drain(game.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      picks++;
      return { kind: "chooserSelectsTarget", selected: [game.id("foe")] };
    }
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    return declineAll(pc);
  });
  assert.equal(zoneOf(game.engine, game.id("sw")), "discard");
  assert.equal(zoneOf(game.engine, game.id("sw2")), "discard");
  assert.equal(picks, 2, "each Swordsman's own trigger asks for a pick");
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
});

clause(SWORD, "0:rule", "it can pick the other Swordsman (a character in play)", () => {
  const game = swordBoard({
    extra: [{ key: "sw2", def: printing(SWORD), owner: P1, zone: "play" }, { key: "mykill", def: killTactic(), owner: P1, zone: "hand" }]
  });
  play(game.engine, P1, game.id("mykill"), { selected: { t: [game.id("sw")] } });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("sw2")] });
  assert.equal(zoneOf(game.engine, game.id("sw2")), "discard", "1 damage on its 1 life destroys it too");
});

// =============================================================================
// Essence of Rage
// Choose one of the following as this card's rules text:
// OPTION 1 -- COST: Pick a character or faction. -- EFFECT: Inflict 1 damage to the character or faction.
// OPTION 2 -- COST: Pick a character. -- EFFECT: This turn, the character gains 2 strength.
// OPTION 3 -- COST: Pick a character. -- EFFECT: Deplete the character.
// Tactic, cost 1, threshold [R][R].
// =============================================================================

const ESSENCE = "0f56196a-942c-4256-abe3-270ddc063a72";

interface EssenceOpts {
  rage?: number;
  greed?: number;
  active?: PlayerId;
  oppInfluence?: number;
  extra?: CardPlacement[];
}

function essenceBoard(o: EssenceOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: o.oppInfluence },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "ess", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Fragile Foe", strength: 1, life: 1, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

type EssenceGame = ReturnType<typeof essenceBoard>;
/** Declaration id of the pick in each mode (engine data, used only to drive the engine). */
const ESSENCE_DECL = ["t", "c", "c"] as const;
const essenceCast = (game: EssenceGame, mode: number | undefined, pick: string[], player: PlayerId = P1) =>
  playModeRaw(game.engine, player, game.id("ess"), mode, { [ESSENCE_DECL[mode ?? 0]]: pick.map((key) => game.id(key)) });
const essencePlay = (game: EssenceGame, mode: number, pick: string[]) => {
  essenceCast(game, mode, pick);
  resolvePendingResponses(game.engine);
};
const factionCast = (game: EssenceGame, mode: number, factionPlayer: PlayerId) =>
  playModeRaw(game.engine, P1, game.id("ess"), mode, { [ESSENCE_DECL[mode]]: [game.engine.state.players[factionPlayer].factionId!] });

clause(ESSENCE, "0:rule", "the card itself: cost 1 with [R][R] - refused with no resources and with one [R]; pays exactly 1 whichever option is chosen; the resolved tactic goes to my discard pile", () => {
  const none = essenceBoard({ rage: 0 });
  refused(() => essenceCast(none, 0, ["foe"]), "no resources");
  const oneRage = essenceBoard({ rage: 1, greed: 5 });
  refused(() => essenceCast(oneRage, 0, ["foe"]), "only one [R]");
  assert.equal(zoneOf(oneRage.engine, oneRage.id("ess")), "hand");
  for (const mode of [0, 1, 2]) {
    const ok = essenceBoard({ rage: 2, greed: 2 });
    const before = ready(ok.engine);
    essenceCast(ok, mode, ["foe"]);
    assert.equal(before - ready(ok.engine), 1, `option ${mode + 1} pays exactly 1`);
    resolvePendingResponses(ok.engine);
    assert.equal(zoneOf(ok.engine, ok.id("ess")), "discard");
  }
});

clause(ESSENCE, "0:rule", "there are exactly three options: a fourth (or a negative) option is refused, the three real ones are accepted", () => {
  const four = essenceBoard();
  refused(() => playModeRaw(four.engine, P1, four.id("ess"), 3, { t: [four.id("foe")], c: [four.id("foe")] }), "option 4");
  assert.equal(zoneOf(four.engine, four.id("ess")), "hand");
  const negative = essenceBoard();
  refused(() => playModeRaw(negative.engine, P1, negative.id("ess"), -1, { t: [negative.id("foe")], c: [negative.id("foe")] }), "option -1");
  assert.equal(zoneOf(negative.engine, negative.id("ess")), "hand");
  for (const mode of [0, 1, 2]) {
    const ok = essenceBoard();
    essenceCast(ok, mode, ["foe"]);
    assert.notEqual(zoneOf(ok.engine, ok.id("ess")), "hand", `control: option ${mode + 1}`);
  }
});

clause(ESSENCE, "0:rule", "only the chosen option applies: option 1 only damages, option 2 only pumps, option 3 only depletes", () => {
  const dmg = essenceBoard();
  essencePlay(dmg, 0, ["foe"]);
  assert.equal(damageOn(dmg.engine, dmg.id("foe")), 1);
  assert.equal(dmg.engine.getStat(dmg.id("foe"), "strength"), 1, "no pump");
  assert.equal(isDepleted(dmg.engine, dmg.id("foe")), false, "no deplete");
  const pump = essenceBoard();
  essencePlay(pump, 1, ["foe"]);
  assert.equal(pump.engine.getStat(pump.id("foe"), "strength"), 3);
  assert.equal(damageOn(pump.engine, pump.id("foe")), 0, "no damage");
  assert.equal(isDepleted(pump.engine, pump.id("foe")), false, "no deplete");
  const dep = essenceBoard();
  essencePlay(dep, 2, ["foe"]);
  assert.equal(isDepleted(dep.engine, dep.id("foe")), true);
  assert.equal(damageOn(dep.engine, dep.id("foe")), 0, "no damage");
  assert.equal(dep.engine.getStat(dep.id("foe"), "strength"), 1, "no pump");
});

clause(ESSENCE, "0:rule", "the chosen option's cost (the pick) is committed when played; nothing happens while it waits for responses", () => {
  for (const mode of [0, 1, 2]) {
    const game = essenceBoard();
    essenceCast(game, mode, ["foe"]);
    assert.equal(game.engine.state.pendingChoice, undefined);
    assert.equal(damageOn(game.engine, game.id("foe")), 0);
    assert.equal(game.engine.getStat(game.id("foe"), "strength"), 1);
    assert.equal(isDepleted(game.engine, game.id("foe")), false);
  }
});

clause(ESSENCE, "0:rule", "it is a tactic: any option can be played in response to the opponent's attack", () => {
  const game = essenceBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  essencePlay(game, 0, ["atk"]);
  assert.equal(damageOn(game.engine, game.id("atk")), 1);
});

// OPTION 1

clause(ESSENCE, "1:option:OPTION 1", "inflicts exactly 1 damage to a picked opposing character", () => {
  const game = essenceBoard();
  essencePlay(game, 0, ["foe"]);
  assert.equal(damageOn(game.engine, game.id("foe")), 1);
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
  assert.equal(damageOn(game.engine, game.id("mine")), 0);
});

clause(ESSENCE, "1:option:OPTION 1", "a character of mine can be picked", () => {
  const game = essenceBoard();
  essencePlay(game, 0, ["mine"]);
  assert.equal(damageOn(game.engine, game.id("mine")), 1);
});

clause(ESSENCE, "1:option:OPTION 1", "1 damage destroys a 1-life character", () => {
  const game = essenceBoard();
  essencePlay(game, 0, ["foe1"]);
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard");
});

clause(ESSENCE, "1:option:OPTION 1", "a faction can be picked: the opponent's faction takes 1 damage (loses 1 influence)", () => {
  const game = essenceBoard();
  factionCast(game, 0, P2);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 1);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(ESSENCE, "1:option:OPTION 1", "'a character or faction': my own faction can be picked too and takes the 1 damage", () => {
  const game = essenceBoard();
  factionCast(game, 0, P1);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 1);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(ESSENCE, "1:option:OPTION 1", "1 damage to a faction with 1 influence left ends the game", () => {
  const game = essenceBoard({ oppInfluence: 1 });
  factionCast(game, 0, P2);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(ESSENCE, "1:option:OPTION 1", `cannot pick ${why}`, () => {
    const bad = essenceBoard();
    refused(() => essenceCast(bad, 0, [key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ess")), "hand");
    const good = essenceBoard();
    essenceCast(good, 0, ["foe"]);
    assert.notEqual(zoneOf(good.engine, good.id("ess")), "hand", "control");
  });
}

clause(ESSENCE, "1:option:OPTION 1", "cannot pick a resource, nothing, or two targets", () => {
  const resource = essenceBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playModeRaw(resource.engine, P1, resource.id("ess"), 0, { t: [resourceId] }), "a resource");
  const none = essenceBoard();
  refused(() => essenceCast(none, 0, []), "no pick");
  const two = essenceBoard();
  refused(() => essenceCast(two, 0, ["foe", "foe1"]), "two characters");
  const mixed = essenceBoard();
  refused(() => playModeRaw(mixed.engine, P1, mixed.id("ess"), 0, { t: [mixed.id("foe"), mixed.engine.state.players[P2].factionId!] }), "a character and a faction");
  assert.equal(zoneOf(mixed.engine, mixed.id("ess")), "hand");
});

clause(ESSENCE, "1:option:OPTION 1", "if the picked character is gone when it resolves nothing else is hurt and nothing stalls", () => {
  const game = essenceBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  essenceCast(game, 0, ["foe"]);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("ess")), "discard");
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
  assert.equal(damageOn(game.engine, game.id("mine")), 0);
});

// OPTION 2

clause(ESSENCE, "2:option:OPTION 2", "the picked character gains exactly 2 strength (1 -> 3); life and speed are unchanged", () => {
  const game = essenceBoard();
  essencePlay(game, 1, ["foe"]);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 3);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("foe"), "speed"), 2);
});

clause(ESSENCE, "2:option:OPTION 2", "only the picked character gains it: my other characters and theirs keep their strength", () => {
  const game = essenceBoard();
  essencePlay(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 3);
  assert.equal(game.engine.getStat(game.id("mine2"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("foe1"), "strength"), 1);
});

clause(ESSENCE, "2:option:OPTION 2", "'this turn': the bonus is gone once the turn is over", () => {
  const game = essenceBoard();
  essencePlay(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 3);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 1, "back to printed strength");
});

clause(ESSENCE, "2:option:OPTION 2", "'this turn' on the opponent's turn: pumping my blocker lasts only through that turn", () => {
  const game = essenceBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  essencePlay(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 3);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  autoResolveBattle(game.engine);
  assert.equal(damageOn(game.engine, game.id("atk")), 3, "the pumped blocker dealt 3");
  endTurn(game.engine, P2);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 1);
});

clause(ESSENCE, "2:option:OPTION 2", "the extra strength is real battle damage: a pumped attacker assigns 3 instead of 1", () => {
  const game = essenceBoard();
  essencePlay(game, 1, ["mine"]);
  declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(ESSENCE, "2:option:OPTION 2", "it stacks with another +2 strength", () => {
  const game = essenceBoard({ extra: [{ key: "buff", def: buffTactic("strength", 2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("buff"), { selected: { t: [game.id("mine")] } });
  essencePlay(game, 1, ["mine"]);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 5);
});

clause(ESSENCE, "2:option:OPTION 2", "playing it twice on the same character is +4", () => {
  const game = essenceBoard({ rage: 4, extra: [{ key: "ess2", def: printing(ESSENCE), owner: P1, zone: "hand" }] });
  essencePlay(game, 1, ["mine"]);
  playModeRaw(game.engine, P1, game.id("ess2"), 1, { c: [game.id("mine")] });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 5);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(ESSENCE, "2:option:OPTION 2", `cannot pick ${why}`, () => {
    const bad = essenceBoard();
    refused(() => essenceCast(bad, 1, [key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ess")), "hand");
    const good = essenceBoard();
    essenceCast(good, 1, ["foe"]);
    assert.notEqual(zoneOf(good.engine, good.id("ess")), "hand", "control");
  });
}

clause(ESSENCE, "2:option:OPTION 2", "'Pick a character': unlike option 1 it cannot pick a faction", () => {
  const bad = essenceBoard();
  refused(() => factionCast(bad, 1, P2), "a faction");
  assert.equal(zoneOf(bad.engine, bad.id("ess")), "hand");
  const mine = essenceBoard();
  refused(() => factionCast(mine, 1, P1), "my own faction");
  const none = essenceBoard();
  refused(() => essenceCast(none, 1, []), "no pick");
  const two = essenceBoard();
  refused(() => essenceCast(two, 1, ["foe", "mine"]), "two characters");
});

// OPTION 3

clause(ESSENCE, "3:option:OPTION 3", "the picked character is depleted", () => {
  const game = essenceBoard();
  essencePlay(game, 2, ["foe"]);
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
  assert.equal(isDepleted(game.engine, game.id("foe1")), false, "only the picked character");
  assert.equal(isDepleted(game.engine, game.id("mine")), false);
});

clause(ESSENCE, "3:option:OPTION 3", "a character of mine can be picked and is depleted", () => {
  const game = essenceBoard();
  essencePlay(game, 2, ["mine"]);
  assert.equal(isDepleted(game.engine, game.id("mine")), true);
});

clause(ESSENCE, "3:option:OPTION 3", "a depleted opposing character can no longer block", () => {
  const game = essenceBoard();
  essencePlay(game, 2, ["foe"]);
  declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2));
  refused(() => game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe")] }), "a depleted blocker");
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe1")] });
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foe1")], "control: a ready character can block");
});

clause(ESSENCE, "3:option:OPTION 3", "a depleted character of mine cannot attack", () => {
  const game = essenceBoard();
  essencePlay(game, 2, ["mine"]);
  refused(() => declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2)), "a depleted attacker");
  declareAttackBy(game.engine, P1, [game.id("mine2")], toFaction(P2));
  assert.ok(battleOf(game.engine), "control: a ready character can attack");
});

clause(ESSENCE, "3:option:OPTION 3", "picking a character that is already depleted does nothing and does not stall", () => {
  const game = essenceBoard({ extra: [{ key: "tired", def: character({ name: "Tired", life: 5 }), owner: P2, zone: "play", depleted: true }] });
  essencePlay(game, 2, ["tired"]);
  assert.equal(isDepleted(game.engine, game.id("tired")), true);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("ess")), "discard");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(ESSENCE, "3:option:OPTION 3", `cannot pick ${why}`, () => {
    const bad = essenceBoard();
    refused(() => essenceCast(bad, 2, [key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ess")), "hand");
    const good = essenceBoard();
    essenceCast(good, 2, ["foe"]);
    assert.notEqual(zoneOf(good.engine, good.id("ess")), "hand", "control");
  });
}

clause(ESSENCE, "3:option:OPTION 3", "'Pick a character': it cannot pick a faction, nothing, or two characters", () => {
  const faction = essenceBoard();
  refused(() => factionCast(faction, 2, P2), "a faction");
  const none = essenceBoard();
  refused(() => essenceCast(none, 2, []), "no pick");
  const two = essenceBoard();
  refused(() => essenceCast(two, 2, ["foe", "mine"]), "two characters");
  assert.equal(zoneOf(two.engine, two.id("ess")), "hand");
});

// =============================================================================
// Fervent Beastslayer
// [R]x5: This card gains 3 life.
// Character (soldier), cost 5, threshold [R], 5 strength / 3 speed / 2 life.
// =============================================================================

const BEAST = "726aa869-bbaf-4c79-8dc7-eb3367282a88";

interface BeastOpts {
  rage?: number;
  greed?: number;
  vol?: number;
  foeRage?: number;
  spent?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function beastBoard(o: BeastOpts = {}) {
  return devBoard(
    [
      { key: "beast", def: printing(BEAST), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 2 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

clause(BEAST, "0:rule@rrrrr", "the card itself: cost 5 with [R] - refused at 4 resources and with no [R]; pays exactly 5; printed 5 strength / 3 speed, a soldier", () => {
  const short = beastBoard({ zone: "hand", rage: 4 });
  refused(() => playRaw(short.engine, P1, short.id("beast")), "4 resources for cost 5");
  const noRage = beastBoard({ zone: "hand", greed: 6 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("beast")), "no [R]");
  const ok = beastBoard({ zone: "hand", rage: 1, greed: 4 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("beast"));
  assert.equal(zoneOf(ok.engine, ok.id("beast")), "play");
  assert.equal(before - ready(ok.engine), 5);
  assert.equal(ok.engine.getStat(ok.id("beast"), "strength"), 5);
  assert.equal(ok.engine.getStat(ok.id("beast"), "speed"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("beast")).subtype, ["soldier"]);
});

clause(BEAST, "0:rule@rrrrr", "with fewer than five [R] it has its printed 2 life (zero to four [R], with plenty of other resources)", () => {
  for (const rage of [0, 1, 2, 4]) {
    const game = beastBoard({ rage, greed: 5 });
    assert.equal(game.engine.getStat(game.id("beast"), "life"), 2, `${rage} [R]`);
  }
});

clause(BEAST, "0:rule@rrrrr", "with [R]x5 it gains 3 life (2 -> 5); strength and speed are unchanged", () => {
  const game = beastBoard({ rage: 5 });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("beast"), "strength"), 5);
  assert.equal(game.engine.getStat(game.id("beast"), "speed"), 3);
});

clause(BEAST, "0:rule@rrrrr", "it is not cumulative: with ten [R] the bonus is still exactly +3", () => {
  const game = beastBoard({ rage: 10 });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
});

clause(BEAST, "0:rule@rrrrr", "other icons, face-down Volition and the opponent's [R] do not meet [R]x5", () => {
  const game = beastBoard({ rage: 4, greed: 6, vol: 4, foeRage: 6 });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 2);
});

clause(BEAST, "0:rule@rrrrr", "spent (attached) [R] still count: icons are never used up (CR 405.6)", () => {
  const game = beastBoard({ rage: 2, spent: 3 });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
});

clause(BEAST, "0:rule@rrrrr", "paying with exactly five [R] when deploying it: the five spent [R] still give it 5 life at once", () => {
  const game = beastBoard({ zone: "hand", rage: 5 });
  play(game.engine, P1, game.id("beast"));
  assert.equal(ready(game.engine), 0, "all five spent");
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
  assert.equal(zoneOf(game.engine, game.id("beast")), "play");
});

clause(BEAST, "0:rule@rrrrr", "it affects only the Beastslayer: another character of mine gains nothing", () => {
  const game = beastBoard({ rage: 6 });
  assert.equal(game.engine.getStat(game.id("mine"), "life"), 2);
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 2);
});

clause(BEAST, "0:rule@rrrrr", "the extra life is real: 4 damage does not destroy the 5-life Beastslayer, 5 does", () => {
  const four = beastBoard({ active: P2, rage: 5, extra: [{ key: "z", def: zapTactic(4), owner: P2, zone: "hand" }] });
  play(four.engine, P2, four.id("z"), { selected: { t: [four.id("beast")] } });
  assert.equal(zoneOf(four.engine, four.id("beast")), "play");
  assert.equal(damageOn(four.engine, four.id("beast")), 4);
  const five = beastBoard({ active: P2, rage: 5, extra: [{ key: "z", def: zapTactic(5), owner: P2, zone: "hand" }] });
  play(five.engine, P2, five.id("z"), { selected: { t: [five.id("beast")] } });
  assert.equal(zoneOf(five.engine, five.id("beast")), "discard");
});

clause(BEAST, "0:rule@rrrrr", "without five [R] 2 damage destroys it (printed 2 life)", () => {
  const game = beastBoard({ active: P2, rage: 4, greed: 2, extra: [{ key: "z", def: zapTactic(2), owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("z"), { selected: { t: [game.id("beast")] } });
  assert.equal(zoneOf(game.engine, game.id("beast")), "discard");
});

clause(BEAST, "0:rule@rrrrr", "it turns off the instant I stop meeting the threshold: losing a [R] while it has 3 damage destroys it (damage is not healed by 'gains life')", () => {
  const game = beastBoard({ active: P2,
    rage: 5,
    extra: [
      { key: "z", def: zapTactic(3), owner: P2, zone: "hand" },
      { key: "rk", def: destroyerTactic("resource"), owner: P2, zone: "hand" }
    ]
  });
  play(game.engine, P2, game.id("z"), { selected: { t: [game.id("beast")] } });
  assert.equal(zoneOf(game.engine, game.id("beast")), "play");
  assert.equal(damageOn(game.engine, game.id("beast")), 3);
  const rageId = game.engine.state.players[P1].play.find((cardId) => game.engine.isResource(cardId))!;
  play(game.engine, P2, game.id("rk"), { selected: { t: [rageId] } });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 2);
  assert.equal(zoneOf(game.engine, game.id("beast")), "discard", "3 damage on 2 life");
});

clause(BEAST, "0:rule@rrrrr", "the threshold is its controller's: a Beastslayer the opponent controls uses THEIR [R], not mine", () => {
  const game = beastBoard({ active: P2, rage: 5, foeRage: 0, extra: [{ key: "grab", def: grabTactic(), owner: P2, zone: "hand" }] });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
  play(game.engine, P2, game.id("grab"), { selected: { t: [game.id("beast")] } });
  assert.equal(game.engine.state.cards[game.id("beast")].controllerId, P2);
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 2, "the new controller has no [R]");
});

clause(BEAST, "0:rule@rrrrr", "the threshold is its controller's: a Beastslayer the opponent controls gets the bonus from THEIR five [R]", () => {
  const game = beastBoard({ active: P2, rage: 0, foeRage: 5, extra: [{ key: "grab", def: grabTactic(), owner: P2, zone: "hand" }] });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 2);
  play(game.engine, P2, game.id("grab"), { selected: { t: [game.id("beast")] } });
  assert.equal(game.engine.getStat(game.id("beast"), "life"), 5);
});

clause(BEAST, "0:rule@rrrrr", "a face-down Beastslayer is only a Volition resource (CR 411.1): no life stat bonus, not a character", () => {
  const game = beastBoard({ rage: 6, faceDown: true });
  assert.equal(game.engine.state.cards[game.id("beast")].faceDown, true);
  assert.equal(game.engine.getCardTypes(game.id("beast")).includes("character"), false);
});

// =============================================================================
// Frenzied Shriever
// If this card inflicts battle damage to a character, increase the amount by 2.
// Character (dragon), cost 2, threshold [R], 1 strength / 3 speed / 2 life.
// =============================================================================

const SHRIEVER = "9c292d45-b266-4caf-9b7d-8fd31af4efc8";

function shrBoard(extra: CardPlacement[] = [], o: { active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "shr", def: printing(SHRIEVER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "keep", def: location({ name: "Keep", structure: 20 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type ShrGame = ReturnType<typeof shrBoard>;

/** P1 attacks `target` with `attackers`, P2 blocks with `blockers`, and the battle plays out (`pick` chooses the damage; default: all to the first legal target). */
function shrFight(
  game: ShrGame,
  attackers: string[],
  target: "faction" | "keep",
  blockers: string[],
  pick?: Parameters<typeof playOut>[1]
) {
  declareAttackBy(game.engine, P1, attackers.map((key) => game.id(key)), target === "faction" ? toFaction(P2) : toCard(game.id("keep")));
  declareBlockers(game.engine, P2, blockers.map((key) => game.id(key)));
  return playOut(game.engine, pick);
}

clause(SHRIEVER, "0:rule", "the card itself: cost 2 with [R] - refused at 1 resource and with no [R]; pays exactly 2; printed 1 strength / 3 speed / 2 life, a dragon", () => {
  const make = (rage: number, greed: number) =>
    devBoard([{ key: "shr", def: printing(SHRIEVER), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)], { turn: 2 });
  const short = make(1, 0);
  refused(() => playRaw(short.engine, P1, short.id("shr")), "1 resource for cost 2");
  const noRage = make(0, 5);
  refused(() => playRaw(noRage.engine, P1, noRage.id("shr")), "no [R]");
  const ok = make(1, 2);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("shr"));
  assert.equal(zoneOf(ok.engine, ok.id("shr")), "play");
  assert.equal(before - ready(ok.engine), 2);
  assert.equal(ok.engine.getStat(ok.id("shr"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("shr"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("shr"), "life"), 2);
  assert.deepEqual(ok.engine.getDefinition(ok.id("shr")).subtype, ["dragon"]);
});

clause(SHRIEVER, "0:rule", "attacking and blocked, its 1 battle damage to the blocking character is increased by 2: the blocker takes 3", () => {
  const game = shrBoard();
  shrFight(game, ["shr"], "faction", ["blk"]);
  assert.equal(damageOn(game.engine, game.id("blk")), 3);
  assert.equal(influenceOf(game.engine, P2), START, "the faction took nothing");
});

for (const bonus of [1, 2, 4]) {
  clause(SHRIEVER, "0:rule", `the increase is always exactly 2, whatever its strength: with ${1 + bonus} strength it inflicts ${1 + bonus + 2}`, () => {
    const game = shrBoard([{ key: "buff", def: buffTactic("strength", bonus), owner: P1, zone: "hand" }]);
    play(game.engine, P1, game.id("buff"), { selected: { t: [game.id("shr")] } });
    assert.equal(game.engine.getStat(game.id("shr"), "strength"), 1 + bonus);
    shrFight(game, ["shr"], "faction", ["blk"]);
    assert.equal(damageOn(game.engine, game.id("blk")), 1 + bonus + 2);
  });
}

clause(SHRIEVER, "0:rule", "the increase is real damage: a 3-life blocker is destroyed by the 1 + 2", () => {
  const game = shrBoard([{ key: "weak", def: character({ name: "Weak", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]);
  shrFight(game, ["shr"], "faction", ["weak"]);
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard");
});

clause(SHRIEVER, "0:rule", "a 4-life blocker survives the 1 + 2 with 3 damage", () => {
  const game = shrBoard([{ key: "tough", def: character({ name: "Tough", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]);
  shrFight(game, ["shr"], "faction", ["tough"]);
  assert.equal(zoneOf(game.engine, game.id("tough")), "play");
  assert.equal(damageOn(game.engine, game.id("tough")), 3);
});

clause(SHRIEVER, "0:rule", "it works as a blocker too: its battle damage to an attacking character is increased by 2", () => {
  const game = devBoard(
    [
      { key: "shr", def: printing(SHRIEVER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("shr")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("atk")), 3);
});

clause(SHRIEVER, "0:rule", "'to a character' only: unblocked, its damage to the opponent's faction is NOT increased", () => {
  const game = shrBoard();
  shrFight(game, ["shr"], "faction", []);
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(SHRIEVER, "0:rule", "'to a character' only: its damage to a location is NOT increased", () => {
  const game = shrBoard();
  shrFight(game, ["shr"], "keep", []);
  assert.equal(damageOn(game.engine, game.id("keep")), 1);
});

clause(SHRIEVER, "0:rule", "only damage this card INFLICTS: damage inflicted to the Shriever is not increased", () => {
  const game = shrBoard([{ key: "big", def: character({ name: "Big", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]);
  shrFight(game, ["shr"], "faction", ["big"]);
  assert.equal(damageOn(game.engine, game.id("shr")), 1, "the blocker's 1 damage to the Shriever stays 1");
});

clause(SHRIEVER, "0:rule", "if it inflicts no damage (0 strength), nothing is increased: 0 damage inflicts nothing (CR 408.1)", () => {
  const game = shrBoard([{ key: "debuff", def: buffTactic("strength", -1), owner: P1, zone: "hand" }]);
  play(game.engine, P1, game.id("debuff"), { selected: { t: [game.id("shr")] } });
  assert.equal(game.engine.getStat(game.id("shr"), "strength"), 0);
  shrFight(game, ["shr"], "faction", ["blk"], (source) =>
    source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }] : []
  );
  assert.equal(damageOn(game.engine, game.id("blk")), 0, "0 damage is not raised to 2");
});

clause(SHRIEVER, "0:rule", "only the Shriever's own damage is increased: an ally in the same party hitting the same blocker adds its normal 2 (1+2 and 2 = 5)", () => {
  const game = shrBoard();
  shrFight(game, ["shr", "ally"], "faction", ["blk"]);
  assert.equal(damageOn(game.engine, game.id("blk")), 5);
});

clause(SHRIEVER, "0:rule", "a Shriever that is not in the battle increases nothing: an ally attacking alone deals its normal 2", () => {
  const game = shrBoard();
  shrFight(game, ["ally"], "faction", ["blk"]);
  assert.equal(damageOn(game.engine, game.id("blk")), 2);
});

clause(SHRIEVER, "0:rule", "two Shrievers hitting the same blocker together: the increase is applied at least once (more than the plain 2)", () => {
  const game = shrBoard([{ key: "shr2", def: printing(SHRIEVER), owner: P1, zone: "play" }]);
  shrFight(game, ["shr", "shr2"], "faction", ["blk"]);
  assert.ok(damageOn(game.engine, game.id("blk")) >= 4, "the plain sum is 2; each Shriever inflicted battle damage to a character, so the amount is increased by 2 (at least once)");
});

clause(SHRIEVER, "0:rule", "each Shriever's rule applies: two Shrievers hitting the same blocker deal 1+2 and 1+2 (6)", () => {
  const game = shrBoard([{ key: "shr2", def: printing(SHRIEVER), owner: P1, zone: "play" }]);
  shrFight(game, ["shr", "shr2"], "faction", ["blk"]);
  assert.equal(damageOn(game.engine, game.id("blk")), 6);
});

clause(SHRIEVER, "0:rule", "dividing its damage between two blockers: each blocker it inflicts damage to takes 2 extra (1 + 2 each with 2 strength)", () => {
  const game = shrBoard([{ key: "buff", def: buffTactic("strength", 1), owner: P1, zone: "hand" }]);
  play(game.engine, P1, game.id("buff"), { selected: { t: [game.id("shr")] } });
  shrFight(game, ["shr"], "faction", ["blk", "blk2"], (source) =>
    source.cardId === game.id("shr")
      ? [
          { sourceId: source.cardId, target: toCard(game.id("blk")), amount: 1 },
          { sourceId: source.cardId, target: toCard(game.id("blk2")), amount: 1 }
        ]
      : source.legalTargets.length > 0 && source.strength > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }]
        : []
  );
  assert.equal(damageOn(game.engine, game.id("blk")), 3);
  assert.equal(damageOn(game.engine, game.id("blk2")), 3);
});

clause(SHRIEVER, "0:rule", "an opposing Shriever works for its controller: it increases the damage it inflicts to MY characters", () => {
  const game = devBoard(
    [
      { key: "shr", def: printing(SHRIEVER), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 20, speed: 2 }), owner: P1, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("shr")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("mine")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine")), 3);
});

clause(SHRIEVER, "0:rule", "damage that is not battle damage is not increased: a tactic's 1 damage to the same blocker stays 1", () => {
  const game = shrBoard([{ key: "z", def: zapTactic(1), owner: P1, zone: "hand" }]);
  play(game.engine, P1, game.id("z"), { selected: { t: [game.id("blk")] } });
  assert.equal(damageOn(game.engine, game.id("blk")), 1);
});

clause(SHRIEVER, "0:rule", "a face-down Shriever is only a resource: it increases nothing", () => {
  const game = shrBoard([{ key: "fd", def: printing(SHRIEVER), owner: P1, zone: "play", faceDown: true }]);
  shrFight(game, ["ally"], "faction", ["blk"]);
  assert.equal(damageOn(game.engine, game.id("blk")), 2);
});

// =============================================================================
// Gallant Commander
// CHARGE! -- COST: Pay 2. Destroy this card. -- EFFECT: Inflict 3 damage to your
// opponent's faction.
// Character (soldier), cost 3, threshold [R], 2 strength / 3 speed / 2 life.
// =============================================================================

const COMMANDER = "53178e50-33bf-47f7-ace0-20f9e7e88c52";

interface CmdOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  fresh?: boolean;
  depleted?: boolean;
  oppInfluence?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function cmdBoard(o: CmdOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: o.oppInfluence },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      {
        key: "cmd",
        def: printing(COMMANDER),
        owner: P1,
        zone: o.zone ?? "play",
        faceDown: o.faceDown ? true : undefined,
        depleted: o.depleted,
        attackEligible: o.fresh ? false : undefined
      },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ]
  });
}

type CmdGame = ReturnType<typeof cmdBoard>;
const cmdCharge = (game: CmdGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("cmd"), "charge");

clause(COMMANDER, "0:ability:charge", "the card itself: cost 3 with [R] - refused at 2 resources and with no [R]; pays exactly 3; printed 2 strength / 3 speed / 2 life, a soldier", () => {
  const short = cmdBoard({ zone: "hand", rage: 1, greed: 1 });
  refused(() => playRaw(short.engine, P1, short.id("cmd")), "2 resources for cost 3");
  const noRage = cmdBoard({ zone: "hand", rage: 0, greed: 5 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("cmd")), "no [R]");
  const ok = cmdBoard({ zone: "hand", rage: 1, greed: 3 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("cmd"));
  assert.equal(zoneOf(ok.engine, ok.id("cmd")), "play");
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(ok.engine.getStat(ok.id("cmd"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("cmd"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("cmd"), "life"), 2);
  assert.deepEqual(ok.engine.getDefinition(ok.id("cmd")).subtype, ["soldier"]);
});

clause(COMMANDER, "0:ability:charge", "CHARGE! pays exactly 2, destroys the Commander (to its owner's discard pile) and inflicts 3 damage to the opponent's faction", () => {
  const game = cmdBoard({ greed: 5 });
  const before = ready(game.engine);
  cmdCharge(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(game.engine), 2, "COST: Pay 2");
  assert.equal(zoneOf(game.engine, game.id("cmd")), "discard", "COST: Destroy this card");
  assert.ok(discardOf(game.engine, P1).includes(game.id("cmd")), "discardOf(game.engine, P1).includes(game.id(\"cmd\"))");
  assert.equal(influenceOf(game.engine, P2), START - 3, "EFFECT: 3 damage to the opponent's faction");
  assert.equal(influenceOf(game.engine, P1), START, "not mine");
});

clause(COMMANDER, "0:ability:charge", "both costs are paid when the ability is used (before responses); the damage waits for the responses", () => {
  const game = cmdBoard({ greed: 4 });
  const before = ready(game.engine);
  cmdCharge(game);
  assert.equal(before - ready(game.engine), 2);
  assert.equal(zoneOf(game.engine, game.id("cmd")), "discard");
  assert.equal(influenceOf(game.engine, P2), START, "no damage while the ability waits for responses");
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(COMMANDER, "0:ability:charge", "the effect still happens after the Commander is gone: nothing the opponent does in response stops the 3 damage", () => {
  const game = cmdBoard({ extra: [{ key: "z", def: zapTactic(5), owner: P2, zone: "hand" }] });
  cmdCharge(game);
  play(game.engine, P2, game.id("z"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(COMMANDER, "0:ability:charge", "CHARGE! has no threshold: it works with Greed only", () => {
  const game = cmdBoard({ rage: 0, greed: 2 });
  cmdCharge(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(COMMANDER, "0:ability:charge", "CHARGE! is refused with only 1 resource: the Commander stays in play and nothing is paid", () => {
  const bad = cmdBoard({ greed: 1 });
  refused(() => cmdCharge(bad), "1 resource for pay 2");
  assert.equal(zoneOf(bad.engine, bad.id("cmd")), "play");
  assert.equal(ready(bad.engine), 1);
  assert.equal(influenceOf(bad.engine, P2), START);
  const good = cmdBoard({ greed: 2 });
  cmdCharge(good);
  resolvePendingResponses(good.engine);
  assert.equal(influenceOf(good.engine, P2), START - 3, "control: exactly 2 resources is enough");
});

clause(COMMANDER, "0:ability:charge", "a spent resource cannot pay: 2 resources of which 1 is already attached is 1 short", () => {
  const bad = cmdBoard({ greed: 1, extra: spentRage(P1, 1) });
  assert.equal(ready(bad.engine), 1);
  refused(() => cmdCharge(bad), "only 1 ready resource");
  assert.equal(zoneOf(bad.engine, bad.id("cmd")), "play");
});

clause(COMMANDER, "0:ability:charge", "it can be used the turn it enters play (CR 204.3a)", () => {
  const game = cmdBoard({ fresh: true });
  assert.equal(game.engine.state.cards[game.id("cmd")].attackEligibleTurn, undefined);
  cmdCharge(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(COMMANDER, "0:ability:charge", "a depleted Commander can still CHARGE! (there is no deplete cost)", () => {
  const game = cmdBoard({ depleted: true });
  cmdCharge(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
  assert.equal(zoneOf(game.engine, game.id("cmd")), "discard");
});

clause(COMMANDER, "0:ability:charge", "the damage is exact: from 4 influence the opponent is left on 1, from 3 on 0 (and I win)", () => {
  const four = cmdBoard({ oppInfluence: 4 });
  cmdCharge(four);
  resolvePendingResponses(four.engine);
  assert.equal(influenceOf(four.engine, P2), 1);
  assert.equal(four.engine.state.result, undefined);
  const three = cmdBoard({ oppInfluence: 3 });
  cmdCharge(three);
  resolvePendingResponses(three.engine);
  assert.equal(influenceOf(three.engine, P2), 0);
  assert.deepEqual(three.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(COMMANDER, "0:ability:charge", "it is an ability: usable in response to the opponent's attack", () => {
  const game = cmdBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  cmdCharge(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
  assert.equal(zoneOf(game.engine, game.id("cmd")), "discard");
});

clause(COMMANDER, "0:ability:charge", "only the Commander's controller can use it: the opponent cannot CHARGE! with my Commander", () => {
  const game = cmdBoard({
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" }, ...bank("greed", 4, P2)]
  });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => cmdCharge(game, P2), "the opponent using my Commander", /control|own|cannot|illegal|only/i);
  assert.equal(zoneOf(game.engine, game.id("cmd")), "play");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(COMMANDER, "0:ability:charge", "a face-down Commander is only a resource (no rules text) and a Commander in my hand has no abilities to use", () => {
  const faceDown = cmdBoard({ faceDown: true });
  refused(() => cmdCharge(faceDown), "a face-down card using the ability");
  const inHand = cmdBoard({ zone: "hand" });
  refused(() => cmdCharge(inHand), "CHARGE! from my hand");
  assert.equal(influenceOf(inHand.engine, P2), START);
});

// =============================================================================
// Gideon, the Ultimate Warrior
// UNIQUE GIDEON
// If battle damage is inflicted to this card while it's attacking, reduce the amount to 0.
// If your opponent's faction loses influence, increase the amount by 1.
// Character (gideon, sword of great justice), cost 1, threshold [R][R][R], 2 / 3 / 3.
// =============================================================================

const GIDEON = "fefe5571-41c7-4a9b-844e-88e2232f6c28";

interface GidOpts {
  zone?: "hand" | "play" | "discard";
  faceDown?: boolean;
  active?: PlayerId;
  oppInfluence?: number;
  myInfluence?: number;
  extra?: CardPlacement[];
}

function gidBoard(o: GidOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.myInfluence },
    playerB: { faction: developFaction(), influence: o.oppInfluence },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 5, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 4, life: 20, speed: 2 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

clause(GIDEON, "0:unique", "the card itself: cost 1 with [R][R][R] - refused with two [R] and with no resources; pays exactly 1; printed 2 strength / 3 speed / 3 life, subtypes gideon and sword of great justice", () => {
  const make = (rage: number, greed: number) =>
    devBoard([{ key: "gid", def: printing(GIDEON), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)], { turn: 2 });
  const twoRage = make(2, 5);
  refused(() => playRaw(twoRage.engine, P1, twoRage.id("gid")), "only two [R]");
  const none = make(0, 0);
  refused(() => playRaw(none.engine, P1, none.id("gid")), "no resources");
  const ok = make(3, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("gid"));
  assert.equal(zoneOf(ok.engine, ok.id("gid")), "play");
  assert.equal(before - ready(ok.engine), 1);
  assert.equal(ok.engine.getStat(ok.id("gid"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("gid"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("gid"), "life"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("gid")).subtype, ["gideon", "sword of great justice"]);
});

clause(GIDEON, "0:unique", "a second Gideon forces me to choose one to keep: keeping the new one destroys the old one", () => {
  const game = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "gid2", def: printing(GIDEON), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("gid2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("gid"), game.id("gid2")].sort());
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("gid2") } } as never);
  assert.equal(zoneOf(game.engine, game.id("gid2")), "play");
  assert.equal(zoneOf(game.engine, game.id("gid")), "discard");
});

clause(GIDEON, "0:unique", "keeping the old Gideon destroys the new one", () => {
  const game = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "gid2", def: printing(GIDEON), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("gid2"));
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("gid") } } as never);
  assert.equal(zoneOf(game.engine, game.id("gid")), "play");
  assert.equal(zoneOf(game.engine, game.id("gid2")), "discard");
});

clause(GIDEON, "0:unique", "UNIQUE is per player: the opponent may control their own Gideon with no choice and no destruction", () => {
  const game = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "gid2", def: printing(GIDEON), owner: P2, zone: "hand" },
      ...bank("rage", 3, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(game.engine, P2, game.id("gid2"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("gid")), "play");
  assert.equal(zoneOf(game.engine, game.id("gid2")), "play");
});

clause(GIDEON, "0:unique", "a second copy in my hand or discard pile is no conflict; stealing the opponent's Gideon while I have my own forces a choice (FAQ)", () => {
  const quiet = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "inHand", def: printing(GIDEON), owner: P1, zone: "hand" },
      { key: "inDisc", def: printing(GIDEON), owner: P1, zone: "discard" }
    ],
    { turn: 2 }
  );
  assert.equal(quiet.engine.state.pendingChoice, undefined);
  const steal = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "theirs", def: printing(GIDEON), owner: P2, zone: "play" },
      { key: "grab", def: grabTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 2 }
  );
  play(steal.engine, P1, steal.id("grab"), { selected: { t: [steal.id("theirs")] } });
  const pc = expectPending(steal.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [steal.id("gid"), steal.id("theirs")].sort());
});

// rule 1: attacking Gideon takes no battle damage

clause(GIDEON, "1:rule", "attacking and blocked by a 5-strength blocker, the battle damage inflicted to Gideon is reduced to 0: he takes nothing and survives", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
  assert.equal(zoneOf(game.engine, game.id("gid")), "play");
});

clause(GIDEON, "1:rule", "...whatever the strength: a 9-strength blocker still inflicts 0", () => {
  const game = gidBoard({ extra: [{ key: "huge", def: character({ name: "Huge", strength: 9, life: 20, speed: 2 }), owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("huge")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
  assert.equal(zoneOf(game.engine, game.id("gid")), "play");
});

clause(GIDEON, "1:rule", "two blockers both striking him: the combined damage is reduced to 0", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk"), game.id("blk2")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
  assert.equal(zoneOf(game.engine, game.id("gid")), "play");
});

clause(GIDEON, "1:rule", "only HIS damage is reduced: an ally in the same party takes the blocker's damage normally", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid"), game.id("ally")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  playOut(game.engine, (source) =>
    source.cardId === game.id("blk")
      ? [{ sourceId: source.cardId, target: toCard(game.id("ally")), amount: source.strength }]
      : source.legalTargets.length > 0 && source.strength > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }]
        : []
  );
  assert.equal(damageOn(game.engine, game.id("ally")), 5);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
});

clause(GIDEON, "1:rule", "a blocker that splits its damage between Gideon and an ally: Gideon's share is reduced to 0, the ally's is not", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid"), game.id("ally")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  playOut(game.engine, (source) =>
    source.cardId === game.id("blk")
      ? [
          { sourceId: source.cardId, target: toCard(game.id("gid")), amount: 2 },
          { sourceId: source.cardId, target: toCard(game.id("ally")), amount: 3 }
        ]
      : source.legalTargets.length > 0 && source.strength > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }]
        : []
  );
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
  assert.equal(damageOn(game.engine, game.id("ally")), 3);
});

clause(GIDEON, "1:rule", "'while it's attacking': when Gideon BLOCKS, the battle damage inflicted to him is not reduced", () => {
  const game = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 3, life: 20, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("gid")]);
  playOut(game.engine);
  assert.equal(zoneOf(game.engine, game.id("gid")), "discard", "3 damage on 3 life");
});

clause(GIDEON, "1:rule", "'while it's attacking': a smaller hit on a blocking Gideon lands in full (2 damage on 3 life)", () => {
  const game = devBoard(
    [
      { key: "gid", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 20, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("gid")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 2);
});

clause(GIDEON, "1:rule", "only BATTLE damage is reduced: a tactic's 2 damage to an attacking Gideon lands in full", () => {
  const game = gidBoard({ extra: [{ key: "z", def: zapTactic(2), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("gid")], toFaction(P2));
  assert.equal(game.engine.state.priorityPlayerId, P2);
  play(game.engine, P2, game.id("z"), { selected: { t: [game.id("gid")] } });
  assert.equal(damageOn(game.engine, game.id("gid")), 2, "non-battle damage while attacking is not reduced");
});

clause(GIDEON, "1:rule", "lethal non-battle damage kills an attacking Gideon (3 damage on 3 life)", () => {
  const game = gidBoard({ extra: [{ key: "z", def: zapTactic(3), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("gid")], toFaction(P2));
  play(game.engine, P2, game.id("z"), { selected: { t: [game.id("gid")] } });
  assert.equal(zoneOf(game.engine, game.id("gid")), "discard");
});

clause(GIDEON, "1:rule", "after the battle he is no longer attacking: the battle is over and he took no damage from it", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
  assert.equal(battleOf(game.engine), undefined);
});

clause(GIDEON, "1:rule", "a Frenzied Shriever's +2 does not get through: battle damage inflicted to an attacking Gideon is reduced to 0 whatever it was increased to", () => {
  const game = gidBoard({ extra: [{ key: "shr", def: printing(SHRIEVER), owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("shr")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("gid")), 0);
});

clause(GIDEON, "1:rule", "an unblocked Gideon still assigns his full 2 strength to the faction (he is shielded, not weakened)", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  toDamageStep(game.engine);
  const source = game.engine.getBattleView()?.damageSources.find((s) => s.cardId === game.id("gid"));
  assert.equal(source?.strength, 2);
  assert.deepEqual(legalKeys(game.engine, game.id("gid")), ["faction:p2"]);
});

clause(GIDEON, "1:rule", "a face-down Gideon is only a resource: it is not even a character", () => {
  const game = gidBoard({ faceDown: true });
  assert.equal(game.engine.getCardTypes(game.id("gid")).includes("character"), false);
});

// rule 2: the opponent's faction loses 1 more influence

clause(GIDEON, "2:rule", "unblocked, Gideon's 2 damage to the opponent's faction costs 3 influence (2 + 1)", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(GIDEON, "2:rule", "control: without Gideon the same 2 damage costs exactly 2", () => {
  const game = gidBoard({ zone: "discard", extra: [{ key: "atk", def: character({ name: "Raider", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("atk")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 2);
});

clause(GIDEON, "2:rule", "a direct influence loss ('loses 2 influence', not damage) is increased too: 3", () => {
  const game = gidBoard({ extra: [{ key: "loss", def: lossTactic(2, "opponent"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("loss"));
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(GIDEON, "2:rule", "damage from a tactic is increased as well: 2 damage costs 3 influence", () => {
  const game = gidBoard({ extra: [{ key: "burn", def: burnTactic(2, "opponent"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("burn"));
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(GIDEON, "2:rule", "the increase applies whoever causes the loss: my opponent making their OWN faction lose 2 influence loses 3", () => {
  const game = gidBoard({ active: P2, extra: [{ key: "ploss", def: lossTactic(2, "controller"), owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("ploss"));
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(GIDEON, "2:rule", "each separate loss is increased by 1: two 1-damage burns cost 2 influence each", () => {
  const game = gidBoard({
    extra: [
      { key: "b1", def: burnTactic(1, "opponent", "Burn One A"), owner: P1, zone: "hand" },
      { key: "b2", def: burnTactic(1, "opponent", "Burn One B"), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("b1"));
  assert.equal(influenceOf(game.engine, P2), START - 2);
  play(game.engine, P1, game.id("b2"));
  assert.equal(influenceOf(game.engine, P2), START - 4);
});

clause(GIDEON, "2:rule", "my own faction is not affected: when MY faction loses influence (damage or a direct loss) the amount is not increased", () => {
  const game = gidBoard({
    active: P2,
    extra: [
      { key: "burnMe", def: burnTactic(2, "opponent"), owner: P2, zone: "hand" },
      { key: "lossMe", def: lossTactic(2, "opponent"), owner: P2, zone: "hand" }
    ]
  });
  play(game.engine, P2, game.id("burnMe"));
  assert.equal(influenceOf(game.engine, P1), START - 2);
  play(game.engine, P2, game.id("lossMe"));
  assert.equal(influenceOf(game.engine, P1), START - 4);
});

clause(GIDEON, "2:rule", "my own faction losing influence by my own effect is not increased either", () => {
  const game = gidBoard({ extra: [{ key: "lossSelf", def: lossTactic(2, "controller"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("lossSelf"));
  assert.equal(influenceOf(game.engine, P1), START - 2);
});

clause(GIDEON, "2:rule", "only a LOSS is increased: when the opponent's faction gains 3 influence it gains exactly 3", () => {
  const game = gidBoard({ extra: [{ key: "gain", def: gainTactic(3, "opponent"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("gain"));
  assert.equal(influenceOf(game.engine, P2), START + 3);
});

clause(GIDEON, "2:rule", "several attackers hitting the faction together are one loss: Gideon (2) and an ally (3) unblocked cost 6 (5 + 1)", () => {
  const game = gidBoard();
  declareAttackBy(game.engine, P1, [game.id("gid"), game.id("ally")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 6);
});

clause(GIDEON, "2:rule", "if no influence is lost (the damage was reduced to 0), there is nothing to increase", () => {
  const ward = location({
    name: "Ward",
    structure: 9,
    behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction", controller: "self" }, delta: -10 }] }] }
  });
  const game = gidBoard({
    extra: [
      { key: "ward", def: ward, owner: P2, zone: "play" },
      { key: "burn", def: burnTactic(1, "opponent"), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("burn"));
  assert.equal(influenceOf(game.engine, P2), START, "no damage got through, so no influence was lost and nothing is increased");
});

clause(GIDEON, "2:rule", "only while Gideon is in play: in my hand, discard pile or face-down he increases nothing", () => {
  for (const [label, o] of [
    ["hand", { zone: "hand" as const }],
    ["discard pile", { zone: "discard" as const }],
    ["face-down", { faceDown: true }]
  ] as const) {
    const game = gidBoard({ ...o, extra: [{ key: "burn", def: burnTactic(2, "opponent"), owner: P1, zone: "hand" }] });
    play(game.engine, P1, game.id("burn"));
    assert.equal(influenceOf(game.engine, P2), START - 2, `Gideon in my ${label}`);
  }
});

clause(GIDEON, "2:rule", "it follows the controller: if my opponent takes control of Gideon, THEIR 'opponent' is me - I lose 1 more and they lose the plain amount", () => {
  const game = gidBoard({
    active: P2,
    extra: [
      { key: "grab", def: grabTactic(), owner: P2, zone: "hand" },
      { key: "burnMe", def: burnTactic(2, "opponent"), owner: P2, zone: "hand" },
      { key: "burnThem", def: burnTactic(2, "controller"), owner: P2, zone: "hand" }
    ]
  });
  play(game.engine, P2, game.id("grab"), { selected: { t: [game.id("gid")] } });
  assert.equal(game.engine.state.cards[game.id("gid")].controllerId, P2);
  play(game.engine, P2, game.id("burnMe"));
  assert.equal(influenceOf(game.engine, P1), START - 3, "Gideon now amplifies losses of the faction opposing his controller (mine)");
  play(game.engine, P2, game.id("burnThem"));
  assert.equal(influenceOf(game.engine, P2), START - 2, "their own faction is not increased");
});

clause(GIDEON, "2:rule", "the opponent's faction at 3 influence: Gideon's 2 damage + 1 brings it to 0 and I win", () => {
  const game = gidBoard({ oppInfluence: 3 });
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), 0);
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(GIDEON, "2:rule", "an influence floor: at 2 influence the 2 + 1 cannot take the faction below 0, and I win", () => {
  const game = gidBoard({ oppInfluence: 2 });
  declareAttackBy(game.engine, P1, [game.id("gid")], toFaction(P2));
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), 0, "influence stops at 0 (CR 410.4)");
  assert.deepEqual(game.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(GIDEON, "2:rule", "influence paid as a cost by the opponent's faction ('loses influence') is increased by 1 too (literal reading)", () => {
  const payTactic = tactic({
    name: "Blood Price",
    cost: 0,
    behavior: { abilities: [{ id: "pay", type: "activated", costs: [{ type: "loseInfluence", amount: 2 }], effects: [] }] }
  });
  const game = gidBoard({ active: P2, extra: [{ key: "pay", def: payTactic, owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("pay"));
  assert.equal(influenceOf(game.engine, P2), START - 3, "their faction lost influence (as a cost); the amount is increased by 1");
});

// =============================================================================
// Godwing Thunderhoof
// UNIQUE GODWING
// If this card attacks, you may pick a character. If you do, inflict X damage to
// it, where X is the number of [R] you control.
// Character (godwing, seraphim, dragon), cost 9, threshold [R], 5 / 3 / 5.
// =============================================================================

const GODWING = "6d3f7916-4277-4fc3-b037-59859c50d7f9";

interface GodOpts {
  rage?: number;
  greed?: number;
  vol?: number;
  foeRage?: number;
  spent?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  extra?: CardPlacement[];
}

function godBoard(o: GodOpts = {}) {
  return devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 20, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Other Foe", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 20 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}

type GodGame = ReturnType<typeof godBoard>;
/** P1 attacks the opponent's faction with `attackers`; the "if this card attacks" prompt (if any) is left open. */
const godAttack = (game: GodGame, attackers: string[] = ["god"]) => declareAttackBy(game.engine, P1, attackers.map((key) => game.id(key)), toFaction(P2));

clause(GODWING, "0:unique", "the card itself: cost 9 with [R] - refused at 8 resources and with no [R]; pays exactly 9; printed 5 strength / 3 speed / 5 life, subtypes godwing, seraphim, dragon", () => {
  const make = (rage: number, greed: number) =>
    devBoard([{ key: "god", def: printing(GODWING), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)], { turn: 2 });
  const short = make(2, 6);
  refused(() => playRaw(short.engine, P1, short.id("god")), "8 resources for cost 9");
  const noRage = make(0, 12);
  refused(() => playRaw(noRage.engine, P1, noRage.id("god")), "no [R]");
  const ok = make(1, 9);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("god"));
  assert.equal(zoneOf(ok.engine, ok.id("god")), "play");
  assert.equal(before - ready(ok.engine), 9);
  assert.equal(ok.engine.getStat(ok.id("god"), "strength"), 5);
  assert.equal(ok.engine.getStat(ok.id("god"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("god"), "life"), 5);
  assert.deepEqual(ok.engine.getDefinition(ok.id("god")).subtype, ["godwing", "seraphim", "dragon"]);
});

clause(GODWING, "0:unique", "a second Godwing forces me to choose one to keep: keeping the new one destroys the old one", () => {
  const game = devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: "play" },
      { key: "god2", def: printing(GODWING), owner: P1, zone: "hand" },
      ...bank("rage", 9, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("god2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [game.id("god"), game.id("god2")].sort());
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("god2") } } as never);
  assert.equal(zoneOf(game.engine, game.id("god2")), "play");
  assert.equal(zoneOf(game.engine, game.id("god")), "discard");
});

clause(GODWING, "0:unique", "keeping the old Godwing destroys the new one", () => {
  const game = devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: "play" },
      { key: "god2", def: printing(GODWING), owner: P1, zone: "hand" },
      ...bank("rage", 9, P1)
    ],
    { turn: 2 }
  );
  play(game.engine, P1, game.id("god2"));
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: game.id("god") } } as never);
  assert.equal(zoneOf(game.engine, game.id("god")), "play");
  assert.equal(zoneOf(game.engine, game.id("god2")), "discard");
});

clause(GODWING, "0:unique", "UNIQUE is per player: the opponent may control their own Godwing with no choice and no destruction", () => {
  const game = devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: "play" },
      { key: "god2", def: printing(GODWING), owner: P2, zone: "hand" },
      ...bank("rage", 9, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(game.engine, P2, game.id("god2"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("god")), "play");
  assert.equal(zoneOf(game.engine, game.id("god2")), "play");
});

clause(GODWING, "0:unique", "a second copy in my hand or discard pile is no conflict", () => {
  const game = devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: "play" },
      { key: "inHand", def: printing(GODWING), owner: P1, zone: "hand" },
      { key: "inDisc", def: printing(GODWING), owner: P1, zone: "discard" }
    ],
    { turn: 2 }
  );
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("god")), "play");
});

clause(GODWING, "1:rule", "when Godwing attacks I am asked whether to pick a character; picking one inflicts X damage, X = the number of [R] I control (4)", () => {
  const game = godBoard({ rage: 4 });
  godAttack(game);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 4);
  assert.equal(damageOn(game.engine, game.id("foe2")), 0);
  assert.equal(damageOn(game.engine, game.id("ally")), 0);
});

for (const rage of [1, 3, 7, 12]) {
  clause(GODWING, "1:rule", `X is the number of [R] I control: with ${rage} [R] the picked character takes ${rage}`, () => {
    const game = godBoard({ rage });
    godAttack(game);
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
    assert.equal(damageOn(game.engine, game.id("foe")), rage);
  });
}

clause(GODWING, "1:rule", "X counts only my [R]: other icons, face-down Volition and the opponent's [R] are not counted", () => {
  const game = godBoard({ rage: 3, greed: 4, vol: 3, foeRage: 6 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
});

clause(GODWING, "1:rule", "spent (attached) [R] still count towards X", () => {
  const game = godBoard({ rage: 2, spent: 3 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 5);
});

clause(GODWING, "1:rule", "'you may pick': declining deals no damage and the attack goes on", () => {
  const game = godBoard();
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["foe", "foe2", "ally", "god"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
  assert.ok(battleOf(game.engine), "the battle is under way");
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(GODWING, "1:rule", "a character of mine can be picked and takes the damage", () => {
  const game = godBoard({ rage: 3 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("ally")] });
  assert.equal(damageOn(game.engine, game.id("ally")), 3);
});

clause(GODWING, "1:rule", "Godwing may pick himself ('a character'): he takes X damage", () => {
  const game = godBoard({ rage: 2 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("god")] });
  assert.equal(damageOn(game.engine, game.id("god")), 2);
});

clause(GODWING, "1:rule", "X damage destroys a character with that much life", () => {
  const game = godBoard({ rage: 2 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe2")] });
  assert.equal(zoneOf(game.engine, game.id("foe2")), "discard");
});

clause(GODWING, "1:rule", "the trigger resolves when the attack is declared, before blockers: a would-be blocker killed by it cannot block", () => {
  const game = godBoard({ rage: 2 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe2")] });
  refused(() => game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe2")] }), "the destroyed character blocking");
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("foe")] });
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foe")], "control: the other character can still block");
});

clause(GODWING, "1:rule", "it is asked once however many attack with him: Godwing and an ally attacking together raise one prompt", () => {
  const game = godBoard({ rage: 3 });
  godAttack(game, ["god", "ally"]);
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(game.engine.state.pendingChoice, undefined, "no second prompt");
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
});

clause(GODWING, "1:rule", "it triggers only when HE attacks: an ally attacking alone raises nothing", () => {
  const game = godBoard();
  godAttack(game, ["ally"]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
});

clause(GODWING, "1:rule", "it triggers only when he ATTACKS: blocking an attack raises nothing", () => {
  const game = devBoard(
    [
      { key: "god", def: printing(GODWING), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("god")]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
});

clause(GODWING, "1:rule", "an attack on a location counts too", () => {
  const game = godBoard({ rage: 3 });
  declareAttackBy(game.engine, P1, [game.id("god")], toCard(game.id("place")));
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"]
] as const) {
  clause(GODWING, "1:rule", `the pick must be a character: ${why} is refused`, () => {
    const bad = godBoard();
    godAttack(bad);
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    const good = godBoard();
    godAttack(good);
    answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id("foe")] });
    assert.equal(damageOn(good.engine, good.id("foe")), 4, "control");
  });
}

clause(GODWING, "1:rule", "the pick cannot be a faction, a resource or two characters", () => {
  const faction = godBoard();
  godAttack(faction);
  refused(() => answerPending(faction.engine, "chooserSelectsTarget", { selected: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const resource = godBoard();
  godAttack(resource);
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => answerPending(resource.engine, "chooserSelectsTarget", { selected: [resourceId] }), "a resource");
  const two = godBoard();
  godAttack(two);
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe"), two.id("foe2")] }), "two characters");
  assert.equal(damageOn(two.engine, two.id("foe")), 0);
});

clause(GODWING, "1:rule", "the damage is not battle damage: it lands before any blockers, even when Godwing's attack is later unblocked", () => {
  const game = godBoard({ rage: 3 });
  godAttack(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
  declareBlockers(game.engine, P2, []);
  playOut(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 5);
  assert.equal(damageOn(game.engine, game.id("foe")), 3);
});

clause(GODWING, "1:rule", "a face-down Godwing is only a resource and cannot attack, so the rule never fires", () => {
  const game = godBoard({ faceDown: true });
  refused(() => godAttack(game), "a face-down card attacking");
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
});

// =============================================================================
// Heavy Sword
// ATTACH TO CHARACTER
// The attached character gains 2 strength.
// [R][R][R][R]: The attached character gains an additional 2 strength.
// HANDOFF -- COST: Pay 4. Deplete a character you control that is not in a
// battle. -- EFFECT: Attach this card to the character.
// Item (gear), cost 3, threshold [R].
// =============================================================================

const HSWORD = "4f12295b-4ef4-458e-95bc-55998b69dc63";

interface HswOpts {
  rage?: number;
  greed?: number;
  vol?: number;
  foeRage?: number;
  spent?: number;
  zone?: "hand" | "play";
  host?: "hostA" | "foe" | null;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function hswBoard(o: HswOpts = {}) {
  const zone = o.zone ?? "hand";
  const host = o.host === undefined ? (zone === "play" ? "hostA" : null) : o.host;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "hsw", def: printing(HSWORD), owner: P1, zone, attachedToKey: zone === "play" && host ? host : undefined },
      { key: "hostA", def: character({ name: "Host A", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "hostB", def: character({ name: "Host B", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentRage(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}

type HswGame = ReturnType<typeof hswBoard>;
const hswAttach = (game: HswGame, hostKey: string) => playRaw(game.engine, P1, game.id("hsw"), { selected: { attachTo: [game.id(hostKey)] } });
const hswHandoff = (game: HswGame, hostKey: string[], player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("hsw"), "handoff", { h: hostKey.map((key) => game.id(key)) });
const strengthOf = (game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, key: string): number => game.engine.getStat(game.id(key), "strength");

clause(HSWORD, "0:attach", "attaches to a character I control: it enters play attached to that character, the printed cost of 3 is paid", () => {
  const game = hswBoard({ rage: 1, greed: 3 });
  const before = ready(game.engine);
  hswAttach(game, "hostA");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("hsw")), "play");
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"));
  assert.equal(before - ready(game.engine), 3, "cost 3");
  assert.equal(game.engine.state.cards[game.id("hostB")].attachedTo, undefined, "no other character gets it");
  assert.deepEqual(game.engine.getCardTypes(game.id("hsw")), ["item"]);
  assert.deepEqual(game.engine.getDefinition(game.id("hsw")).subtype, ["gear"]);
});

clause(HSWORD, "0:attach", "attaches to an opponent's character too ('ATTACH TO CHARACTER' names no controller); I keep controlling the sword", () => {
  const game = hswBoard({ rage: 1, greed: 3 });
  hswAttach(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("foe"));
  assert.equal(game.engine.state.cards[game.id("hsw")].controllerId, P1);
});

clause(HSWORD, "0:attach", "the card itself: cost 3 with [R] - refused at 2 resources and with no [R]", () => {
  const short = hswBoard({ rage: 1, greed: 1 });
  refused(() => hswAttach(short, "hostA"), "2 resources for cost 3");
  const noRage = hswBoard({ rage: 0, greed: 6 });
  refused(() => hswAttach(noRage, "hostA"), "no [R]");
  assert.equal(zoneOf(noRage.engine, noRage.id("hsw")), "hand");
  const ok = hswBoard({ rage: 1, greed: 2 });
  hswAttach(ok, "hostA");
  assert.notEqual(zoneOf(ok.engine, ok.id("hsw")), "hand", "control: [R] plus enough resources");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["hidden", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(HSWORD, "0:attach", `cannot attach to ${why}`, () => {
    const bad = hswBoard({ rage: 1, greed: 3 });
    refused(() => hswAttach(bad, key), `attaching to ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("hsw")), "hand");
    const good = hswBoard({ rage: 1, greed: 3 });
    hswAttach(good, "hostA");
    assert.notEqual(zoneOf(good.engine, good.id("hsw")), "hand", "control: a character is accepted");
  });
}

clause(HSWORD, "0:attach", "cannot attach to a faction or a resource, and needs exactly one host", () => {
  const faction = hswBoard({ rage: 1, greed: 3 });
  refused(() => playRaw(faction.engine, P1, faction.id("hsw"), { selected: { attachTo: [faction.engine.state.players[P1].factionId!] } }), "my faction");
  const resource = hswBoard({ rage: 1, greed: 3 });
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("hsw"), { selected: { attachTo: [resourceId] } }), "a resource");
  const none = hswBoard({ rage: 1, greed: 3 });
  refused(() => playRaw(none.engine, P1, none.id("hsw"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(none.engine, P1, none.id("hsw"), {}), "no selection at all");
  const two = hswBoard({ rage: 1, greed: 3 });
  refused(() => playRaw(two.engine, P1, two.id("hsw"), { selected: { attachTo: [two.id("hostA"), two.id("hostB")] } }), "two hosts");
  assert.equal(zoneOf(two.engine, two.id("hsw")), "hand");
});

clause(HSWORD, "0:attach", "with no character in play at all there is nothing to attach to and it cannot be played", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hsw", def: printing(HSWORD), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(game.engine, P1, game.id("hsw"), { selected: { attachTo: [] } }), "no host available");
  assert.equal(zoneOf(game.engine, game.id("hsw")), "hand");
});

clause(HSWORD, "0:attach", "when the host is destroyed the sword goes with it, to its owner's discard pile", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("hostA")] } });
  assert.equal(zoneOf(game.engine, game.id("hostA")), "discard");
  assert.equal(zoneOf(game.engine, game.id("hsw")), "discard", "the attached card leaves play the same way (CR 301.4)");
});

clause(HSWORD, "0:attach", "when the host returns to its owner's hand the sword leaves play the same way: it goes to ITS owner's hand, not the discard pile (CR 301.4a)", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "bn", def: bouncerTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bn"), { selected: { t: [game.id("hostA")] } });
  assert.equal(zoneOf(game.engine, game.id("hostA")), "hand");
  assert.equal(zoneOf(game.engine, game.id("hsw")), "hand");
});

clause(HSWORD, "0:attach", "when the host is removed from the game the sword is removed from the game too (CR 301.4)", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("rm"), { selected: { t: [game.id("hostA")] } });
  assert.equal(zoneOf(game.engine, game.id("hostA")), "removed");
  assert.equal(zoneOf(game.engine, game.id("hsw")), "removed");
});

clause(HSWORD, "0:attach", "if the host stops being a character (turned face-down) the sword is flipped face-down with it", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "fd", def: flipDownTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("fd"), { selected: { t: [game.id("hostA")] } });
  assert.equal(game.engine.state.cards[game.id("hostA")].faceDown, true);
  assert.equal(zoneOf(game.engine, game.id("hsw")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(game.engine.state.cards[game.id("hsw")].faceDown, true, "...and is flipped face-down along with its host");
});

// +2 strength

clause(HSWORD, "1:rule", "the attached character gains exactly 2 strength (1 -> 3); life and speed are unchanged", () => {
  const game = hswBoard({ zone: "play" });
  assert.equal(strengthOf(game, "hostA"), 3);
  assert.equal(game.engine.getStat(game.id("hostA"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("hostA"), "speed"), 2);
});

clause(HSWORD, "1:rule", "only the attached character gains it: my other character and the opponent's keep their strength", () => {
  const game = hswBoard({ zone: "play" });
  assert.equal(strengthOf(game, "hostB"), 1);
  assert.equal(strengthOf(game, "foe"), 1);
});

clause(HSWORD, "1:rule", "an opponent's attached character gains it too", () => {
  const game = hswBoard({ zone: "play", host: "foe" });
  assert.equal(strengthOf(game, "foe"), 3);
  assert.equal(strengthOf(game, "hostA"), 1);
});

clause(HSWORD, "1:rule", "the bonus appears when the sword enters play (not while it waits for responses)", () => {
  const game = hswBoard({ rage: 1, greed: 3 });
  hswAttach(game, "hostA");
  assert.equal(strengthOf(game, "hostA"), 1, "still being deployed");
  resolvePendingResponses(game.engine);
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "1:rule", "two swords on one character stack: +4", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "hsw2", def: printing(HSWORD), owner: P1, zone: "play", attachedToKey: "hostA" }] });
  assert.equal(strengthOf(game, "hostA"), 5);
});

clause(HSWORD, "1:rule", "the bonus is real battle strength: the attached character assigns 3 damage", () => {
  const game = hswBoard({ zone: "play", extra: [{ key: "blk", def: character({ name: "Blocker", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("hostA")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("blk")), 3);
});

clause(HSWORD, "1:rule", "a sword in my hand attaches nothing", () => {
  const game = hswBoard({ zone: "hand" });
  assert.equal(strengthOf(game, "hostA"), 1);
});

// +2 more with [R]x4

clause(HSWORD, "2:rule@rrrr", "with [R][R][R][R] the attached character gains an additional 2 strength (1 -> 5)", () => {
  const game = hswBoard({ zone: "play", rage: 4 });
  assert.equal(strengthOf(game, "hostA"), 5);
  assert.equal(game.engine.getStat(game.id("hostA"), "life"), 5);
  assert.equal(game.engine.getStat(game.id("hostA"), "speed"), 2);
});

clause(HSWORD, "2:rule@rrrr", "with only three [R] (and plenty of other resources) it is just the plain +2", () => {
  const game = hswBoard({ zone: "play", rage: 3, greed: 6 });
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "2:rule@rrrr", "it is not cumulative: with eight [R] the bonus is still +2 +2", () => {
  const game = hswBoard({ zone: "play", rage: 8 });
  assert.equal(strengthOf(game, "hostA"), 5);
});

clause(HSWORD, "2:rule@rrrr", "other icons, face-down Volition and the opponent's [R] do not count", () => {
  const game = hswBoard({ zone: "play", rage: 3, greed: 4, vol: 4, foeRage: 6 });
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "2:rule@rrrr", "spent (attached) [R] still count", () => {
  const game = hswBoard({ zone: "play", rage: 1, spent: 3 });
  assert.equal(strengthOf(game, "hostA"), 5);
});

clause(HSWORD, "2:rule@rrrr", "it turns off the moment I stop meeting the threshold", () => {
  const game = hswBoard({ zone: "play", rage: 4, extra: [{ key: "rk", def: destroyerTactic("resource"), owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(game, "hostA"), 5);
  const rageId = game.engine.state.players[P1].play.find((cardId) => game.engine.isResource(cardId))!;
  play(game.engine, P1, game.id("rk"), { selected: { t: [rageId] } });
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "2:rule@rrrr", "the threshold is the SWORD's controller's, not the host's: my sword on the opponent's character uses MY [R]", () => {
  const mine = hswBoard({ zone: "play", host: "foe", rage: 4, foeRage: 0 });
  assert.equal(strengthOf(mine, "foe"), 5, "my four [R] power the sword on their character");
  const theirs = hswBoard({ zone: "play", host: "foe", rage: 0, foeRage: 4 });
  assert.equal(strengthOf(theirs, "foe"), 3, "their [R] do not");
});

clause(HSWORD, "2:rule@rrrr", "it only adds to the attached character, not the other characters", () => {
  const game = hswBoard({ zone: "play", rage: 4 });
  assert.equal(strengthOf(game, "hostB"), 1);
  assert.equal(strengthOf(game, "foe"), 1);
});

// HANDOFF

clause(HSWORD, "3:ability:handoff", "HANDOFF pays exactly 4, depletes the picked character and attaches the sword to it: +2 moves from the old host to the new one", () => {
  const game = hswBoard({ zone: "play", greed: 6 });
  const before = ready(game.engine);
  hswHandoff(game, ["hostB"]);
  resolvePendingResponses(game.engine);
  assert.equal(before - ready(game.engine), 4, "COST: Pay 4");
  assert.equal(isDepleted(game.engine, game.id("hostB")), true, "COST: deplete the character");
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostB"), "EFFECT: attach this card to the character");
  assert.equal(strengthOf(game, "hostB"), 3);
  assert.equal(strengthOf(game, "hostA"), 1, "the old host loses the bonus");
  assert.equal(isDepleted(game.engine, game.id("hostA")), false, "the old host is not depleted");
  assert.equal(zoneOf(game.engine, game.id("hsw")), "play");
  assert.equal(game.engine.state.cards[game.id("hsw")].controllerId, P1);
});

clause(HSWORD, "3:ability:handoff", "the costs are paid when the ability is used (before responses): 4 spent and the character depleted while the sword has not moved yet", () => {
  const game = hswBoard({ zone: "play", greed: 5 });
  const before = ready(game.engine);
  hswHandoff(game, ["hostB"]);
  assert.equal(before - ready(game.engine), 4);
  assert.equal(isDepleted(game.engine, game.id("hostB")), true);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"), "not attached yet");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostB"));
});

clause(HSWORD, "3:ability:handoff", "HANDOFF needs no threshold: it works with Greed only (no [R] at all)", () => {
  const game = hswBoard({ zone: "play", greed: 4 });
  hswHandoff(game, ["hostB"]);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostB"));
});

clause(HSWORD, "3:ability:handoff", "HANDOFF is refused one resource short of its pay-4 (3 ready): nothing is paid or depleted", () => {
  const bad = hswBoard({ zone: "play", greed: 3, spent: 1 });
  assert.equal(ready(bad.engine), 3);
  refused(() => hswHandoff(bad, ["hostB"]), "3 ready resources for pay 4");
  assert.equal(isDepleted(bad.engine, bad.id("hostB")), false);
  assert.equal(ready(bad.engine), 3);
  const good = hswBoard({ zone: "play", greed: 4, spent: 1 });
  hswHandoff(good, ["hostB"]);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("hsw")].attachedTo, good.id("hostB"), "control: 4 ready is enough");
});

clause(HSWORD, "3:ability:handoff", "'a character you control': the opponent's character cannot be the picked one", () => {
  const bad = hswBoard({ zone: "play", greed: 4 });
  refused(() => hswHandoff(bad, ["foe"]), "an opposing character");
  assert.equal(bad.engine.state.cards[bad.id("hsw")].attachedTo, bad.id("hostA"));
  assert.equal(ready(bad.engine), 4);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["hidden", "a face-down card"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(HSWORD, "3:ability:handoff", `cannot hand the sword off to ${why}`, () => {
    const bad = hswBoard({ zone: "play", greed: 4 });
    refused(() => hswHandoff(bad, [key]), `picking ${why}`);
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    assert.equal(bad.engine.state.cards[bad.id("hsw")].attachedTo, bad.id("hostA"));
    const good = hswBoard({ zone: "play", greed: 4 });
    hswHandoff(good, ["hostB"]);
    assert.equal(isDepleted(good.engine, good.id("hostB")), true, "control");
  });
}

clause(HSWORD, "3:ability:handoff", "cannot pick a faction, nothing, or two characters", () => {
  const faction = hswBoard({ zone: "play", greed: 4 });
  refused(() => actRaw(faction.engine, P1, faction.id("hsw"), "handoff", { h: [faction.engine.state.players[P1].factionId!] }), "my faction");
  const none = hswBoard({ zone: "play", greed: 4 });
  refused(() => hswHandoff(none, []), "no pick");
  const two = hswBoard({ zone: "play", greed: 4, extra: [{ key: "hostC", def: character({ name: "Host C" }), owner: P1, zone: "play" }] });
  refused(() => hswHandoff(two, ["hostB", "hostC"]), "two characters");
  assert.equal(isDepleted(two.engine, two.id("hostB")), false);
});

clause(HSWORD, "3:ability:handoff", "the character must be able to be depleted: an already-depleted character cannot be picked (CR 303.2)", () => {
  const bad = hswBoard({ zone: "play", greed: 4, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  refused(() => hswHandoff(bad, ["tired"]), "an already depleted character");
  assert.equal(ready(bad.engine), 4);
  assert.equal(bad.engine.state.cards[bad.id("hsw")].attachedTo, bad.id("hostA"));
});

clause(HSWORD, "3:ability:handoff", "'that is not in a battle': an attacking character cannot be picked", () => {
  const bad = hswBoard({ zone: "play", host: "hostA", greed: 4 });
  bad.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [bad.id("hostB")], target: toFaction(P2) });
  assert.equal(bad.engine.state.priorityPlayerId, P1, "the attacker holds priority");
  refused(() => hswHandoff(bad, ["hostB"]), "the attacking character");
  assert.equal(bad.engine.state.cards[bad.id("hsw")].attachedTo, bad.id("hostA"));
  assert.equal(ready(bad.engine), 4);
});

clause(HSWORD, "3:ability:handoff", "'that is not in a battle': a character outside the battle can be picked while another character is attacking", () => {
  const game = hswBoard({
    zone: "play",
    host: "hostA",
    greed: 4,
    extra: [{ key: "hostC", def: character({ name: "Host C", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" }]
  });
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("hostB")], target: toFaction(P2) });
  hswHandoff(game, ["hostC"]);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostC"));
  assert.equal(isDepleted(game.engine, game.id("hostC")), true);
});

clause(HSWORD, "3:ability:handoff", "'that is not in a battle': a blocking character cannot be picked, a character outside the battle can", () => {
  const make = () => {
    const game = hswBoard({
      zone: "play",
      host: "hostA",
      greed: 4,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]
    });
    declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
    declareBlockers(game.engine, P1, [game.id("hostB")]);
    // the declaration opened the battle window: the attacker passes, then I may act
    if (game.engine.state.priorityPlayerId !== P1) game.engine.perform({ type: "passPriority", playerId: game.engine.state.priorityPlayerId! });
    assert.equal(game.engine.state.priorityPlayerId, P1);
    return game;
  };
  const bad = make();
  refused(() => hswHandoff(bad, ["hostB"]), "the blocking character");
  assert.equal(ready(bad.engine), 4);
  assert.equal(isDepleted(bad.engine, bad.id("hostB")), false);
  const good = make();
  hswHandoff(good, ["hostA"]);
  assert.equal(isDepleted(good.engine, good.id("hostA")), true, "control: a character outside the battle can be picked in the same situation");
});

clause(HSWORD, "3:ability:handoff", "a sword on an opponent's character can be handed off to one of mine", () => {
  const game = hswBoard({ zone: "play", host: "foe", greed: 4 });
  assert.equal(strengthOf(game, "foe"), 3);
  hswHandoff(game, ["hostA"]);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"));
  assert.equal(strengthOf(game, "foe"), 1);
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "3:ability:handoff", "the sword's current host is a character I control: handing it to the same character is allowed (it just gets depleted)", () => {
  const game = hswBoard({ zone: "play", greed: 4 });
  hswHandoff(game, ["hostA"]);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"));
  assert.equal(isDepleted(game.engine, game.id("hostA")), true);
  assert.equal(strengthOf(game, "hostA"), 3);
});

clause(HSWORD, "3:ability:handoff", "the extra [R]x4 bonus moves along with it", () => {
  const game = hswBoard({ zone: "play", rage: 4, greed: 4 });
  assert.equal(strengthOf(game, "hostA"), 5);
  hswHandoff(game, ["hostB"]);
  resolvePendingResponses(game.engine);
  assert.equal(strengthOf(game, "hostB"), 5);
  assert.equal(strengthOf(game, "hostA"), 1);
});

clause(HSWORD, "3:ability:handoff", "it is an ability: usable in response to the opponent's attack", () => {
  const game = hswBoard({
    zone: "play",
    greed: 4,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  hswHandoff(game, ["hostB"]);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostB"));
});

clause(HSWORD, "3:ability:handoff", "only the sword's controller can use it: the opponent cannot HANDOFF my sword", () => {
  const game = hswBoard({ zone: "play", greed: 4, extra: [...bank("greed", 4, P2), { key: "oppChar", def: character({ name: "Their Own" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("hostB")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => hswHandoff(game, ["oppChar"], P2), "the opponent using my sword", /control|own|cannot|illegal|only/i);
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"));
});

clause(HSWORD, "3:ability:handoff", "a sword in my hand has no HANDOFF to use", () => {
  const bad = hswBoard({ zone: "hand", greed: 4 });
  refused(() => hswHandoff(bad, ["hostB"]), "HANDOFF from my hand");
  assert.equal(isDepleted(bad.engine, bad.id("hostB")), false);
});

clause(HSWORD, "3:ability:handoff", "if the picked character leaves play in response the sword stays where it was and nothing stalls (costs stay paid)", () => {
  const game = hswBoard({ zone: "play", greed: 4, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  hswHandoff(game, ["hostB"]);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("hostB")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("hsw")), "play");
  assert.equal(game.engine.state.cards[game.id("hsw")].attachedTo, game.id("hostA"), "it stays on its old host");
  assert.equal(ready(game.engine), 0, "the 4 are spent");
});

// =============================================================================
// Heroic Deed
// COST: Pick 2 or fewer characters.
// EFFECT: This turn, the characters cannot block.
// FLIP UP: 9 [R]
// Tactic, cost 3, threshold [R].
// =============================================================================

const DEED = "f0dbe0a2-74e2-4cbb-b6d2-2d9908b6b97e";

interface DeedOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play";
  fdSpent?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function deedBoard(o: DeedOpts = {}) {
  const zone = o.zone ?? "hand";
  return devBoard(
    [
      {
        key: "deed",
        def: printing(DEED),
        owner: P1,
        zone,
        faceDown: zone === "play" ? true : undefined,
        attachedToKey: zone === "play" && o.fdSpent ? "__factionA" : undefined
      },
      { key: "mineA", def: character({ name: "Mine A", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "mineB", def: character({ name: "Mine B", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeA", def: character({ name: "Foe A", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeB", def: character({ name: "Foe B", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeC", def: character({ name: "Foe C", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 1, P1),
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type DeedGame = ReturnType<typeof deedBoard>;
const deedCast = (game: DeedGame, picks: string[], player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("deed"), { selected: { cs: picks.map((key) => game.id(key)) } });
const deedFlip = (game: DeedGame, picks: string[], player: PlayerId = P1) =>
  flipUpRaw(game.engine, player, game.id("deed"), { cs: picks.map((key) => game.id(key)) });
const cannotBlock = (game: DeedGame, key: string): boolean => game.engine.getRestrictions(game.id(key)).includes("cannotBlock");

clause(DEED, "0:ability", "the card itself: cost 3 with [R] - refused at 2 resources and with no [R]; pays exactly 3; the resolved tactic goes to my discard pile", () => {
  const short = deedBoard({ rage: 1, greed: 1 });
  refused(() => deedCast(short, ["foeA"]), "2 resources for cost 3");
  const noRage = deedBoard({ rage: 0, greed: 6 });
  refused(() => deedCast(noRage, ["foeA"]), "no [R]");
  const ok = deedBoard({ rage: 1, greed: 3 });
  const before = ready(ok.engine);
  deedCast(ok, ["foeA"]);
  assert.equal(before - ready(ok.engine), 3);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("deed")), "discard");
});

clause(DEED, "0:ability", "the cost (the picks) is committed when played; the characters can still block while it waits for responses", () => {
  const game = deedBoard();
  deedCast(game, ["foeA", "foeB"]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(cannotBlock(game, "foeA"), false);
  resolvePendingResponses(game.engine);
  assert.equal(cannotBlock(game, "foeA"), true);
  assert.equal(cannotBlock(game, "foeB"), true);
});

clause(DEED, "0:ability", "'2 or fewer': one pick works", () => {
  const game = deedBoard();
  deedCast(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  assert.equal(cannotBlock(game, "foeA"), true);
  assert.equal(cannotBlock(game, "foeB"), false);
});

clause(DEED, "0:ability", "'2 or fewer': picking no character at all is allowed and changes nothing", () => {
  const game = deedBoard();
  deedCast(game, []);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("deed")), "discard");
  for (const key of ["mineA", "mineB", "foeA", "foeB", "foeC"]) assert.equal(cannotBlock(game, key), false, key);
});

clause(DEED, "0:ability", "'2 or fewer': three characters are refused (two are accepted)", () => {
  const bad = deedBoard();
  refused(() => deedCast(bad, ["foeA", "foeB", "foeC"]), "three picks");
  assert.equal(zoneOf(bad.engine, bad.id("deed")), "hand");
  const good = deedBoard();
  deedCast(good, ["foeA", "foeB"]);
  assert.notEqual(zoneOf(good.engine, good.id("deed")), "hand", "control");
});

clause(DEED, "0:ability", "the same character cannot be picked twice", () => {
  const bad = deedBoard();
  refused(() => deedCast(bad, ["foeA", "foeA"]), "the same character twice");
  assert.equal(zoneOf(bad.engine, bad.id("deed")), "hand");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(DEED, "0:ability", `cannot pick ${why}`, () => {
    const bad = deedBoard();
    refused(() => deedCast(bad, [key]), `picking ${why}`);
    refused(() => deedCast(deedBoard(), ["foeA", key]), `picking ${why} alongside a legal character`);
    assert.equal(zoneOf(bad.engine, bad.id("deed")), "hand");
    const good = deedBoard();
    deedCast(good, ["foeA"]);
    assert.notEqual(zoneOf(good.engine, good.id("deed")), "hand", "control");
  });
}

clause(DEED, "0:ability", "cannot pick a faction or a resource", () => {
  const faction = deedBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("deed"), { selected: { cs: [faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = deedBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("deed"), { selected: { cs: [resourceId] } }), "a resource");
});

clause(DEED, "0:ability", "the picked opposing characters cannot block my attack this turn; an unpicked character still can", () => {
  const game = deedBoard();
  deedCast(game, ["foeA", "foeB"]);
  resolvePendingResponses(game.engine);
  declareAttackBy(game.engine, P1, [game.id("mineA")], toFaction(P2));
  refused(() => declareBlockers(game.engine, P2, [game.id("foeA")]), "a picked character blocking");
  refused(() => declareBlockers(game.engine, P2, [game.id("foeB")]), "the other picked character blocking");
  refused(() => declareBlockers(game.engine, P2, [game.id("foeA"), game.id("foeC")]), "a picked character blocking alongside an unpicked one");
  declareBlockers(game.engine, P2, [game.id("foeC")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foeC")], "control: the unpicked character blocks");
});

clause(DEED, "0:ability", "with every opposing character picked or unable to block, the attack cannot be blocked at all", () => {
  const game = devBoard(
    [
      { key: "deed", def: printing(DEED), owner: P1, zone: "hand" },
      { key: "mineA", def: character({ name: "Mine A", life: 9 }), owner: P1, zone: "play" },
      { key: "foeA", def: character({ name: "Foe A", life: 9 }), owner: P2, zone: "play" },
      { key: "foeB", def: character({ name: "Foe B", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 1, P1),
      ...bank("greed", 2, P1)
    ],
    { turn: 2 }
  );
  deedCast(game as unknown as DeedGame, ["foeA", "foeB"]);
  resolvePendingResponses(game.engine);
  declareAttackBy(game.engine, P1, [game.id("mineA")], toFaction(P2));
  refused(() => declareBlockers(game.engine, P2, [game.id("foeA")]), "foeA");
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 1);
});

clause(DEED, "0:ability", "it works on my own characters too: a picked character of mine cannot block (cast in response to the opponent's attack)", () => {
  const game = deedBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  deedCast(game, ["mineA"]);
  resolvePendingResponses(game.engine);
  refused(() => declareBlockers(game.engine, P1, [game.id("mineA")]), "my picked character blocking");
  declareBlockers(game.engine, P1, [game.id("mineB")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("mineB")], "control");
});

clause(DEED, "0:ability", "it only stops BLOCKING: a picked character can still attack", () => {
  const game = deedBoard();
  deedCast(game, ["mineA"]);
  resolvePendingResponses(game.engine);
  declareAttackBy(game.engine, P1, [game.id("mineA")], toFaction(P2));
  assert.ok(battleOf(game.engine), "the picked character attacked");
});

clause(DEED, "0:ability", "'this turn': the restriction is gone at the start of the next turn, including on my own next turn", () => {
  const game = deedBoard();
  deedCast(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  assert.equal(cannotBlock(game, "foeA"), true);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(cannotBlock(game, "foeA"), false, "over at the start of their turn");
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  declareAttackBy(game.engine, P1, [game.id("mineA")], toFaction(P2));
  declareBlockers(game.engine, P2, [game.id("foeA")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foeA")], "it can block again");
});

clause(DEED, "0:ability", "only the characters picked at the time are affected: a character entering play later this turn can block", () => {
  const game = deedBoard({ extra: [{ key: "late", def: character({ name: "Late", life: 9 }), owner: P1, zone: "hand" }] });
  deedCast(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  play(game.engine, P1, game.id("late"));
  assert.equal(zoneOf(game.engine, game.id("late")), "play");
  assert.equal(cannotBlock(game, "late"), false);
  assert.equal(cannotBlock(game, "foeB"), false);
  assert.equal(cannotBlock(game, "foeA"), true);
});

// FLIP UP: 9 [R]

clause(DEED, "1:flipUp", "flipping up a face-down copy with exactly 9 ready resources (the card itself pays one) and a [R] works and does its text", () => {
  const game = deedBoard({ zone: "play", rage: 1, greed: 7 });
  assert.equal(ready(game.engine), 9, "eight resources and the face-down card");
  deedFlip(game, ["foeA", "foeB"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("deed")), "discard");
  assert.equal(cannotBlock(game, "foeA"), true);
  assert.equal(cannotBlock(game, "foeB"), true);
  assert.equal(ready(game.engine), 0, "all nine were spent");
});

clause(DEED, "1:flipUp", "FLIP UP pays 9, not more: with plenty of resources only nine are spent (and the flipped card stops being a resource)", () => {
  const game = deedBoard({ zone: "play", rage: 2, greed: 11 });
  assert.equal(ready(game.engine), 14);
  deedFlip(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  const after = ready(game.engine);
  assert.ok(after === 4 || after === 5, `14 - 9 paid, minus the flipped card itself if it was not one of the payers (ready is ${after})`);
});

clause(DEED, "1:flipUp", "FLIP UP costs 9 even though the printed cost is 3: 8 ready resources (7 plus the face-down card) is refused", () => {
  const bad = deedBoard({ zone: "play", rage: 1, greed: 6 });
  assert.equal(ready(bad.engine), 8);
  refused(() => deedFlip(bad, ["foeA"]), "8 ready resources for a FLIP UP cost of 9");
  assert.equal(bad.engine.state.cards[bad.id("deed")].faceDown, true);
  assert.equal(ready(bad.engine), 8, "nothing was paid");
  const good = deedBoard({ zone: "play", rage: 1, greed: 7 });
  deedFlip(good, ["foeA"]);
  resolvePendingResponses(good.engine);
  assert.equal(cannotBlock(good, "foeA"), true, "control: 9 ready is enough");
});

clause(DEED, "1:flipUp", "FLIP UP needs [R]: nine resources and no [R] is refused (the face-down card's Volition is not [R])", () => {
  const bad = deedBoard({ zone: "play", rage: 0, greed: 12 });
  refused(() => deedFlip(bad, ["foeA"]), "no [R]");
  assert.equal(bad.engine.state.cards[bad.id("deed")].faceDown, true);
  assert.equal(ready(bad.engine), 13);
});

clause(DEED, "1:flipUp", "the opponent's [R] do not meet the FLIP UP threshold", () => {
  const bad = deedBoard({ zone: "play", rage: 0, greed: 10, extra: bank("rage", 4, P2) });
  refused(() => deedFlip(bad, ["foeA"]), "their Rage");
  assert.equal(bad.engine.state.cards[bad.id("deed")].faceDown, true);
});

clause(DEED, "1:flipUp", "a flipped-up Heroic Deed takes the same picks: three characters, an item and a location are refused; none is allowed", () => {
  const make = () => deedBoard({ zone: "play", rage: 1, greed: 8 });
  const three = make();
  refused(() => deedFlip(three, ["foeA", "foeB", "foeC"]), "three characters");
  const thing = make();
  refused(() => deedFlip(thing, ["thing"]), "an item");
  const place = make();
  refused(() => deedFlip(place, ["place"]), "a location");
  assert.equal(place.engine.state.cards[place.id("deed")].faceDown, true);
  const none = make();
  deedFlip(none, []);
  resolvePendingResponses(none.engine);
  assert.equal(zoneOf(none.engine, none.id("deed")), "discard");
});

clause(DEED, "1:flipUp", "FLIP UP works at tactic times: in response to the opponent's attack", () => {
  const game = deedBoard({
    zone: "play",
    rage: 1,
    greed: 7,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  deedFlip(game, ["mineA"]);
  resolvePendingResponses(game.engine);
  refused(() => declareBlockers(game.engine, P1, [game.id("mineA")]), "the picked character blocking");
});

clause(DEED, "1:flipUp", "only the controller can flip it up", () => {
  const game = deedBoard({ zone: "play", rage: 1, greed: 7, extra: [...bank("rage", 3, P2), ...bank("greed", 8, P2)] });
  refused(() => deedFlip(game, ["foeA"], P2), "the opponent flipping my card");
  assert.equal(game.engine.state.cards[game.id("deed")].faceDown, true);
});

clause(DEED, "1:flipUp", "a face-down copy that was already spent (attached to my faction) can still be flipped up when other resources pay the 9 (CR 507.4a: any face-down resource I control; SYS-36)", () => {
  const game = deedBoard({ zone: "play", rage: 1, greed: 8, fdSpent: true });
  assert.equal(ready(game.engine), 9);
  deedFlip(game, ["foeA"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("deed")), "discard");
  assert.equal(cannotBlock(game, "foeA"), true);
});

// =============================================================================
// Idol Smasher
// COST: You may pick an item.
// When this card enters play, if you picked an item as part of its cost, destroy that item.
// Character (vandal), cost 4, threshold [R][R], 2 strength / 3 speed / 3 life.
// =============================================================================

const SMASHER = "c7789461-b3e1-45af-9044-4caf5f63816e";

interface SmasherOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play";
  extra?: CardPlacement[];
}

function smasherBoard(o: SmasherOpts = {}) {
  return devBoard(
    [
      { key: "sm", def: printing(SMASHER), owner: P1, zone: o.zone ?? "hand" },
      { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "theirItem2", def: item({ name: "Their Other Item" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "itemInHand", def: item({ name: "Item In Hand" }), owner: P2, zone: "hand" },
      { key: "itemInDiscard", def: item({ name: "Item In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}

type SmasherGame = ReturnType<typeof smasherBoard>;
const smasherPlay = (game: SmasherGame, pick?: string) =>
  playRaw(game.engine, P1, game.id("sm"), { selected: pick === undefined ? {} : { it: [game.id(pick)] } });
const smasherDeploy = (game: SmasherGame, pick?: string) => {
  smasherPlay(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(SMASHER, "0:ability", "the card itself: cost 4 with [R][R] - refused at 3 resources and with one [R]; pays exactly 4; printed 2 strength / 3 speed / 3 life, a vandal", () => {
  const short = smasherBoard({ rage: 2, greed: 1 });
  refused(() => smasherPlay(short), "3 resources for cost 4");
  const oneRage = smasherBoard({ rage: 1, greed: 6 });
  refused(() => smasherPlay(oneRage), "only one [R]");
  const ok = smasherBoard({ rage: 2, greed: 3 });
  const before = ready(ok.engine);
  smasherDeploy(ok);
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "play");
  assert.equal(before - ready(ok.engine), 4);
  assert.equal(ok.engine.getStat(ok.id("sm"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("sm"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("sm"), "life"), 3);
  assert.deepEqual(ok.engine.getDefinition(ok.id("sm")).subtype, ["vandal"]);
});

clause(SMASHER, "0:ability", "'you may pick': it can be played with no pick - no item is destroyed", () => {
  const game = smasherBoard();
  smasherDeploy(game);
  assert.equal(zoneOf(game.engine, game.id("sm")), "play");
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", key);
});

clause(SMASHER, "0:ability", "an item of the opponent's can be picked; so can one of mine", () => {
  const theirs = smasherBoard();
  smasherDeploy(theirs, "theirItem");
  assert.equal(zoneOf(theirs.engine, theirs.id("theirItem")), "discard");
  const mine = smasherBoard();
  smasherDeploy(mine, "myItem");
  assert.equal(zoneOf(mine.engine, mine.id("myItem")), "discard");
});

for (const [key, why] of [
  ["foe", "a character"],
  ["place", "a location"],
  ["itemInHand", "an item card in a hand"],
  ["itemInDiscard", "an item card in a discard pile"]
] as const) {
  clause(SMASHER, "0:ability", `cannot pick ${why}`, () => {
    const bad = smasherBoard();
    refused(() => smasherPlay(bad, key), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
    const good = smasherBoard();
    smasherPlay(good, "theirItem");
    assert.notEqual(zoneOf(good.engine, good.id("sm")), "hand", "control: an item is accepted");
  });
}

clause(SMASHER, "0:ability", "cannot pick a faction or a resource, or two items", () => {
  const faction = smasherBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("sm"), { selected: { it: [faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = smasherBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("sm"), { selected: { it: [resourceId] } }), "a resource");
  const two = smasherBoard();
  refused(() => playRaw(two.engine, P1, two.id("sm"), { selected: { it: [two.id("theirItem"), two.id("theirItem2")] } }), "two items");
  assert.equal(zoneOf(two.engine, two.id("sm")), "hand");
});

clause(SMASHER, "0:ability", "the pick is part of the cost: the item is picked when played and is destroyed only when the Smasher ENTERS play, not while it waits for responses", () => {
  const game = smasherBoard();
  smasherPlay(game, "theirItem");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("theirItem")), "play");
  assert.equal(zoneOf(game.engine, game.id("sm")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("theirItem")), "discard");
  assert.equal(zoneOf(game.engine, game.id("sm")), "play");
});

clause(SMASHER, "1:rule", "on entering play it destroys exactly the picked item (to its owner's discard pile); the other items stay", () => {
  const game = smasherBoard();
  smasherDeploy(game, "theirItem");
  assert.equal(zoneOf(game.engine, game.id("theirItem")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("theirItem")), "discardOf(game.engine, P2).includes(game.id(\"theirItem\"))");
  assert.equal(zoneOf(game.engine, game.id("theirItem2")), "play");
  assert.equal(zoneOf(game.engine, game.id("myItem")), "play");
});

clause(SMASHER, "1:rule", "an item of mine goes to MY discard pile", () => {
  const game = smasherBoard();
  smasherDeploy(game, "myItem");
  assert.ok(discardOf(game.engine, P1).includes(game.id("myItem")), "discardOf(game.engine, P1).includes(game.id(\"myItem\"))");
});

clause(SMASHER, "1:rule", "an item attached to a character (a gear) can be destroyed too, and the character is untouched", () => {
  const game = smasherBoard({ extra: [{ key: "gear", def: printing(HSWORD), owner: P2, zone: "play", attachedToKey: "foe" }] });
  smasherDeploy(game, "gear");
  assert.equal(zoneOf(game.engine, game.id("gear")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

clause(SMASHER, "1:rule", "'if you picked an item': with no pick, nothing is destroyed even though items are in play", () => {
  const game = smasherBoard({ rage: 2, greed: 2, extra: [{ key: "pip", def: putIntoPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("sm")] } });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("sm")), "play");
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", key);
});

clause(SMASHER, "1:rule", "it triggers only for itself: another character entering play while the Smasher is in play destroys nothing", () => {
  const game = smasherBoard({ zone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("newbie"));
  assert.equal(zoneOf(game.engine, game.id("newbie")), "play");
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", key);
});

clause(SMASHER, "1:rule", "if the picked item has left play before the Smasher enters, nothing else is destroyed and nothing stalls", () => {
  const game = smasherBoard({ extra: [{ key: "ik", def: destroyerTactic("item"), owner: P2, zone: "hand" }] });
  smasherPlay(game, "theirItem");
  play(game.engine, P2, game.id("ik"), { selected: { t: [game.id("theirItem")] } });
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("sm")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirItem2")), "play");
  assert.equal(zoneOf(game.engine, game.id("myItem")), "play");
});

clause(SMASHER, "1:rule", "the Smasher itself is not damaged or destroyed by its own trigger", () => {
  const game = smasherBoard();
  smasherDeploy(game, "theirItem");
  assert.equal(damageOn(game.engine, game.id("sm")), 0);
  assert.equal(zoneOf(game.engine, game.id("sm")), "play");
});

// =============================================================================
// Impressive Hero
// COST: You may pick a character.
// When this card enters play, if you picked a character as part of its cost, deplete that character.
// Character (soldier), cost 2, threshold [R][R], 2 strength / 3 speed / 1 life.
// =============================================================================

const HERO = "4c77f9cd-98d3-4a48-bdc9-81ae09b4867b";

interface HeroOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play";
  extra?: CardPlacement[];
}

function heroBoard(o: HeroOpts = {}) {
  return devBoard(
    [
      { key: "hero", def: printing(HERO), owner: P1, zone: o.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Other Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}

type HeroGame = ReturnType<typeof heroBoard>;
const heroPlay = (game: HeroGame, pick?: string) => playRaw(game.engine, P1, game.id("hero"), { selected: pick === undefined ? {} : { c: [game.id(pick)] } });
const heroDeploy = (game: HeroGame, pick?: string) => {
  heroPlay(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(HERO, "0:ability", "the card itself: cost 2 with [R][R] - refused at 1 resource and with one [R]; pays exactly 2; printed 2 strength / 3 speed / 1 life, a soldier", () => {
  const short = heroBoard({ rage: 1, greed: 0 });
  refused(() => heroPlay(short), "1 resource for cost 2");
  const oneRage = heroBoard({ rage: 1, greed: 5 });
  refused(() => heroPlay(oneRage), "only one [R]");
  const ok = heroBoard({ rage: 2, greed: 1 });
  const before = ready(ok.engine);
  heroDeploy(ok);
  assert.equal(zoneOf(ok.engine, ok.id("hero")), "play");
  assert.equal(before - ready(ok.engine), 2);
  assert.equal(ok.engine.getStat(ok.id("hero"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("hero"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("hero"), "life"), 1);
  assert.deepEqual(ok.engine.getDefinition(ok.id("hero")).subtype, ["soldier"]);
});

clause(HERO, "0:ability", "'you may pick': it can be played with no pick - nobody is depleted", () => {
  const game = heroBoard();
  heroDeploy(game);
  assert.equal(zoneOf(game.engine, game.id("hero")), "play");
  for (const key of ["hero", "foe", "foe2", "mine"]) assert.equal(isDepleted(game.engine, game.id(key)), false, key);
});

clause(HERO, "0:ability", "a character of the opponent's can be picked; so can one of mine", () => {
  const theirs = heroBoard();
  heroDeploy(theirs, "foe");
  assert.equal(isDepleted(theirs.engine, theirs.id("foe")), true);
  const mine = heroBoard();
  heroDeploy(mine, "mine");
  assert.equal(isDepleted(mine.engine, mine.id("mine")), true);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(HERO, "0:ability", `cannot pick ${why}`, () => {
    const bad = heroBoard();
    refused(() => heroPlay(bad, key), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("hero")), "hand");
    const good = heroBoard();
    heroPlay(good, "foe");
    assert.notEqual(zoneOf(good.engine, good.id("hero")), "hand", "control: a character is accepted");
  });
}

clause(HERO, "0:ability", "cannot pick a faction, a resource, itself (still in hand) or two characters", () => {
  const faction = heroBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("hero"), { selected: { c: [faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = heroBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("hero"), { selected: { c: [resourceId] } }), "a resource");
  const itself = heroBoard();
  refused(() => heroPlay(itself, "hero"), "the Hero itself, which is not in play");
  const two = heroBoard();
  refused(() => playRaw(two.engine, P1, two.id("hero"), { selected: { c: [two.id("foe"), two.id("foe2")] } }), "two characters");
  assert.equal(zoneOf(two.engine, two.id("hero")), "hand");
});

clause(HERO, "0:ability", "the pick is part of the cost: made when played; the character is depleted only when the Hero ENTERS play, not while it waits for responses", () => {
  const game = heroBoard();
  heroPlay(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
  assert.equal(zoneOf(game.engine, game.id("hero")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
});

clause(HERO, "1:rule", "on entering play it depletes exactly the picked character: the others and the Hero itself stay ready", () => {
  const game = heroBoard();
  heroDeploy(game, "foe");
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
  assert.equal(isDepleted(game.engine, game.id("foe2")), false);
  assert.equal(isDepleted(game.engine, game.id("mine")), false);
  assert.equal(isDepleted(game.engine, game.id("hero")), false);
});

clause(HERO, "1:rule", "a depleted opposing character cannot block (the Hero's point): it is refused, an untouched one can", () => {
  const game = heroBoard();
  heroDeploy(game, "foe");
  declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2));
  refused(() => declareBlockers(game.engine, P2, [game.id("foe")]), "a depleted blocker");
  declareBlockers(game.engine, P2, [game.id("foe2")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foe2")], "control");
});

clause(HERO, "1:rule", "the depleted character takes no damage and does not leave play", () => {
  const game = heroBoard();
  heroDeploy(game, "foe");
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

clause(HERO, "1:rule", "picking a character that is already depleted does nothing and does not stall", () => {
  const game = heroBoard({ extra: [{ key: "tired", def: character({ name: "Tired", life: 5 }), owner: P2, zone: "play", depleted: true }] });
  heroDeploy(game, "tired");
  assert.equal(isDepleted(game.engine, game.id("tired")), true);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("hero")), "play");
});

clause(HERO, "1:rule", "'if you picked a character': with no pick, nothing is depleted even though characters are in play (put into play by an effect)", () => {
  const game = heroBoard({ extra: [{ key: "pip", def: putIntoPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("pip"), { selected: { t: [game.id("hero")] } });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("hero")), "play");
  for (const key of ["foe", "foe2", "mine"]) assert.equal(isDepleted(game.engine, game.id(key)), false, key);
});

clause(HERO, "1:rule", "it triggers only for itself: another character entering play while the Hero is in play depletes nobody", () => {
  const game = heroBoard({ zone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("newbie"));
  for (const key of ["foe", "foe2", "mine", "newbie"]) assert.equal(isDepleted(game.engine, game.id(key)), false, key);
});

clause(HERO, "1:rule", "if the picked character has left play before the Hero enters, nobody else is depleted and nothing stalls", () => {
  const game = heroBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  heroPlay(game, "foe");
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("hero")), "play");
  for (const key of ["foe2", "mine"]) assert.equal(isDepleted(game.engine, game.id(key)), false, key);
});

clause(HERO, "1:rule", "a depleted character of mine cannot attack this turn", () => {
  const game = heroBoard();
  heroDeploy(game, "mine");
  refused(() => declareAttackBy(game.engine, P1, [game.id("mine")], toFaction(P2)), "a depleted attacker");
});

// =============================================================================
// Improvised Blowtorch
// COST: Pick a character.
// EFFECT: Inflict 2 damage to the character.
// FLIP UP: 1 [R]
// Tactic, cost 3, threshold [R].
// =============================================================================

const TORCH = "5d9a641c-b27b-49ab-ad03-e494b16f9774";

interface TorchOpts {
  rage?: number;
  greed?: number;
  zone?: "hand" | "play";
  fdSpent?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function torchBoard(o: TorchOpts = {}) {
  const zone = o.zone ?? "hand";
  return devBoard(
    [
      {
        key: "torch",
        def: printing(TORCH),
        owner: P1,
        zone,
        faceDown: zone === "play" ? true : undefined,
        attachedToKey: zone === "play" && o.fdSpent ? "__factionA" : undefined
      },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Fragile Foe", strength: 1, life: 1, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Two Life Foe", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe3", def: character({ name: "Three Life Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 1, P1),
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type TorchGame = ReturnType<typeof torchBoard>;
const torchCast = (game: TorchGame, picks: string[], player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("torch"), { selected: { c: picks.map((key) => game.id(key)) } });
const torchFlip = (game: TorchGame, picks: string[], player: PlayerId = P1) =>
  flipUpRaw(game.engine, player, game.id("torch"), { c: picks.map((key) => game.id(key)) });

clause(TORCH, "0:ability", "the card itself: cost 3 with [R] - refused at 2 resources and with no [R]; pays exactly 3; the resolved tactic goes to my discard pile", () => {
  const short = torchBoard({ rage: 1, greed: 1 });
  refused(() => torchCast(short, ["foe"]), "2 resources for cost 3");
  const noRage = torchBoard({ rage: 0, greed: 6 });
  refused(() => torchCast(noRage, ["foe"]), "no [R]");
  const ok = torchBoard({ rage: 1, greed: 3 });
  const before = ready(ok.engine);
  torchCast(ok, ["foe"]);
  assert.equal(before - ready(ok.engine), 3);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("torch")), "discard");
});

clause(TORCH, "0:ability", "inflicts exactly 2 damage to the picked character, and to no other", () => {
  const game = torchBoard();
  torchCast(game, ["foe"]);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  for (const key of ["foe1", "foe2", "foe3", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(TORCH, "0:ability", "the cost (the pick) is committed when played; the damage is inflicted only when it resolves", () => {
  const game = torchBoard();
  torchCast(game, ["foe"]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
});

for (const [key, destroyed] of [
  ["foe1", true],
  ["foe2", true],
  ["foe3", false]
] as const) {
  clause(TORCH, "0:ability", `2 damage ${destroyed ? "destroys" : "does not destroy"} a ${key === "foe1" ? 1 : key === "foe2" ? 2 : 3}-life character`, () => {
    const game = torchBoard();
    torchCast(game, [key]);
    resolvePendingResponses(game.engine);
    assert.equal(zoneOf(game.engine, game.id(key)), destroyed ? "discard" : "play");
    if (!destroyed) assert.equal(damageOn(game.engine, game.id(key)), 2);
  });
}

clause(TORCH, "0:ability", "damage the character already has adds to the 2: a 3-life character with 1 damage is destroyed", () => {
  const game = torchBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P2, zone: "play", damage: 1 }] });
  torchCast(game, ["hurt"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("hurt")), "discard");
});

clause(TORCH, "0:ability", "a character of mine can be picked and takes the 2 damage", () => {
  const game = torchBoard();
  torchCast(game, ["mine"]);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine")), 2);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(TORCH, "0:ability", `cannot pick ${why}`, () => {
    const bad = torchBoard();
    refused(() => torchCast(bad, [key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("torch")), "hand");
    const good = torchBoard();
    torchCast(good, ["foe"]);
    assert.notEqual(zoneOf(good.engine, good.id("torch")), "hand", "control");
  });
}

clause(TORCH, "0:ability", "cannot pick a faction or a resource; needs exactly one character (none and two are refused)", () => {
  const faction = torchBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("torch"), { selected: { c: [faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = torchBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("torch"), { selected: { c: [resourceId] } }), "a resource");
  const none = torchBoard();
  refused(() => torchCast(none, []), "no character");
  const two = torchBoard();
  refused(() => torchCast(two, ["foe", "foe2"]), "two characters");
  assert.equal(zoneOf(two.engine, two.id("torch")), "hand");
});

clause(TORCH, "0:ability", "if the picked character is gone when it resolves, nothing else is hurt and nothing stalls", () => {
  const game = torchBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  torchCast(game, ["foe"]);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("torch")), "discard");
  for (const key of ["foe1", "foe2", "foe3", "mine"]) assert.equal(damageOn(game.engine, game.id(key)), 0, key);
});

clause(TORCH, "0:ability", "it is a tactic: usable in response to the opponent's attack", () => {
  const game = torchBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  torchCast(game, ["atk"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
});

// FLIP UP: 1 [R]

clause(TORCH, "1:flipUp", "flipping up a face-down copy pays exactly 1 (not the printed 3) and then inflicts 2 damage to the picked character", () => {
  const game = torchBoard({ zone: "play", rage: 3, greed: 0 });
  assert.equal(ready(game.engine), 4, "three Rage and the face-down card");
  torchFlip(game, ["foe"]);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 2, "4 resources: 1 paid, and the flipped card stopped being a resource");
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  assert.equal(zoneOf(game.engine, game.id("torch")), "discard");
});

clause(TORCH, "1:flipUp", "the face-down card may pay for its own FLIP UP: it alone (plus a spent [R]) is enough", () => {
  const game = torchBoard({ zone: "play", rage: 0, greed: 0, extra: spentRage(P1, 1) });
  assert.equal(ready(game.engine), 1);
  torchFlip(game, ["foe"]);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
  assert.equal(ready(game.engine), 0);
});

clause(TORCH, "1:flipUp", "FLIP UP needs [R]: plenty of other resources and no [R] is refused", () => {
  const bad = torchBoard({ zone: "play", rage: 0, greed: 6 });
  refused(() => torchFlip(bad, ["foe"]), "no [R]");
  assert.equal(bad.engine.state.cards[bad.id("torch")].faceDown, true);
  assert.equal(ready(bad.engine), 7, "nothing was paid");
});

clause(TORCH, "1:flipUp", "the opponent's [R] do not meet the FLIP UP threshold", () => {
  const bad = torchBoard({ zone: "play", rage: 0, greed: 2, extra: bank("rage", 3, P2) });
  refused(() => torchFlip(bad, ["foe"]), "their Rage");
  assert.equal(bad.engine.state.cards[bad.id("torch")].faceDown, true);
});

clause(TORCH, "1:flipUp", "a flipped-up Blowtorch still needs a character pick: none, two, an item and a location are refused", () => {
  const make = () => torchBoard({ zone: "play" });
  const none = make();
  refused(() => torchFlip(none, []), "no pick");
  const two = make();
  refused(() => torchFlip(two, ["foe", "foe2"]), "two characters");
  const thing = make();
  refused(() => torchFlip(thing, ["thing"]), "an item");
  const place = make();
  refused(() => torchFlip(place, ["place"]), "a location");
  assert.equal(place.engine.state.cards[place.id("torch")].faceDown, true);
  const good = make();
  torchFlip(good, ["foe"]);
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("foe")), 2, "control");
});

clause(TORCH, "1:flipUp", "FLIP UP works at tactic times: in response to the opponent's attack", () => {
  const game = torchBoard({
    zone: "play",
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  torchFlip(game, ["atk"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
});

clause(TORCH, "1:flipUp", "only the controller can flip it up", () => {
  const game = torchBoard({ zone: "play", extra: [...bank("rage", 3, P2)] });
  refused(() => torchFlip(game, ["foe"], P2), "the opponent flipping my card");
  assert.equal(game.engine.state.cards[game.id("torch")].faceDown, true);
});

clause(TORCH, "1:flipUp", "a face-down copy that was already spent (attached to my faction) can still be flipped up when other resources pay the 1 (CR 507.4a: any face-down resource I control; SYS-36)", () => {
  const game = torchBoard({ zone: "play", rage: 3, greed: 0, fdSpent: true });
  assert.equal(ready(game.engine), 3);
  torchFlip(game, ["foe"]);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 2, "exactly 1 paid");
  assert.equal(damageOn(game.engine, game.id("foe")), 2);
});

// =============================================================================
// Lordly Stables
// If an attacking character you control inflicts battle damage to a character,
// increase the amount by 1.
// Location, cost 3, threshold [R][R], structure 3.
// =============================================================================

const STABLES = "7e50ae37-dd2d-49f6-825d-91ab278e3a4e";

interface StableOpts {
  zone?: "hand" | "play";
  faceDown?: boolean;
  owner?: PlayerId;
  extra?: CardPlacement[];
}

function stableBoard(o: StableOpts = {}) {
  return devBoard(
    [
      { key: "st", def: printing(STABLES), owner: o.owner ?? P1, zone: o.zone ?? "play", faceDown: o.faceDown ? true : undefined },
      { key: "atkA", def: character({ name: "Attacker A", strength: 2, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "atkB", def: character({ name: "Attacker B", strength: 3, life: 20, speed: 3 }), owner: P1, zone: "play" },
      { key: "blkA", def: character({ name: "Blocker A", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "blkB", def: character({ name: "Blocker B", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" },
      { key: "keep", def: location({ name: "Keep", structure: 20 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: P1 }
  );
}

type StableGame = ReturnType<typeof stableBoard>;
function stableFight(game: StableGame, attackers: string[], target: "faction" | "keep", blockers: string[], pick?: Parameters<typeof playOut>[1]) {
  declareAttackBy(game.engine, P1, attackers.map((key) => game.id(key)), target === "faction" ? toFaction(P2) : toCard(game.id("keep")));
  declareBlockers(game.engine, P2, blockers.map((key) => game.id(key)));
  return playOut(game.engine, pick);
}

clause(STABLES, "0:rule", "the card itself: cost 3 with [R][R] - refused at 2 resources and with one [R]; pays exactly 3; structure 3 (destroyed by 3 damage, not 2)", () => {
  const make = (rage: number, greed: number) =>
    devBoard([{ key: "st", def: printing(STABLES), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)], { turn: 2 });
  const short = make(2, 0);
  refused(() => playRaw(short.engine, P1, short.id("st")), "2 resources for cost 3");
  const oneRage = make(1, 6);
  refused(() => playRaw(oneRage.engine, P1, oneRage.id("st")), "only one [R]");
  const ok = make(2, 1);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("st"));
  assert.equal(zoneOf(ok.engine, ok.id("st")), "play");
  assert.equal(before - ready(ok.engine), 3);
  assert.equal(ok.engine.getDefinition(ok.id("st")).structure, 3);
  const dmg2 = devBoard([{ key: "st", def: printing(STABLES), owner: P1, zone: "play" }, { key: "z2", def: locationZapTactic(2), owner: P2, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  play(dmg2.engine, P2, dmg2.id("z2"), { selected: { t: [dmg2.id("st")] } });
  assert.equal(zoneOf(dmg2.engine, dmg2.id("st")), "play");
  const dmg3 = devBoard([{ key: "st", def: printing(STABLES), owner: P1, zone: "play" }, { key: "z3", def: locationZapTactic(3), owner: P2, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  play(dmg3.engine, P2, dmg3.id("z3"), { selected: { t: [dmg3.id("st")] } });
  assert.equal(zoneOf(dmg3.engine, dmg3.id("st")), "discard");
});

clause(STABLES, "0:rule", "my attacking character that is blocked inflicts its strength + 1 to the blocking character (2 + 1 = 3)", () => {
  const game = stableBoard();
  stableFight(game, ["atkA"], "faction", ["blkA"]);
  assert.equal(damageOn(game.engine, game.id("blkA")), 3);
});

for (const strength of [1, 3, 5]) {
  clause(STABLES, "0:rule", `the increase is exactly 1, whatever the strength: a ${strength}-strength attacker inflicts ${strength + 1}`, () => {
    const game = stableBoard({ extra: [{ key: "atkX", def: character({ name: "Attacker X", strength, life: 20, speed: 3 }), owner: P1, zone: "play" }] });
    stableFight(game, ["atkX"], "faction", ["blkA"]);
    assert.equal(damageOn(game.engine, game.id("blkA")), strength + 1);
  });
}

clause(STABLES, "0:rule", "the increase is real: a 3-life blocker is destroyed by a 2-strength attacker (2 + 1)", () => {
  const game = stableBoard({ extra: [{ key: "weak", def: character({ name: "Weak", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }] });
  stableFight(game, ["atkA"], "faction", ["weak"]);
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard");
});

clause(STABLES, "0:rule", "different targets: two attackers each hitting a different blocker each inflict +1", () => {
  const game = stableBoard();
  stableFight(game, ["atkA", "atkB"], "faction", ["blkA", "blkB"], (source) =>
    source.cardId === game.id("atkA")
      ? [{ sourceId: source.cardId, target: toCard(game.id("blkA")), amount: source.strength }]
      : source.cardId === game.id("atkB")
        ? [{ sourceId: source.cardId, target: toCard(game.id("blkB")), amount: source.strength }]
        : source.legalTargets.length > 0 && source.strength > 0
          ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }]
          : []
  );
  assert.equal(damageOn(game.engine, game.id("blkA")), 3);
  assert.equal(damageOn(game.engine, game.id("blkB")), 4);
});

clause(STABLES, "0:rule", "two attackers (2 and 3) hitting the same blocker together: the increase is applied at least once (more than the plain 5)", () => {
  const game = stableBoard();
  stableFight(game, ["atkA", "atkB"], "faction", ["blkA"]);
  assert.ok(damageOn(game.engine, game.id("blkA")) > 5, "the plain sum is 5; an attacking character of mine inflicted battle damage to a character, so the amount is increased");
});

clause(STABLES, "0:rule", "each attacking character of mine adds 1 to the damage IT inflicts: two attackers (2 and 3) hitting the same blocker inflict 2+1 and 3+1 = 7", () => {
  const game = stableBoard();
  stableFight(game, ["atkA", "atkB"], "faction", ["blkA"]);
  assert.equal(damageOn(game.engine, game.id("blkA")), 7);
});

clause(STABLES, "0:rule", "'dividing': one attacker dividing its damage between two blockers adds 1 to the damage it inflicts to each (strength 3: 1+1 and 2+1)", () => {
  const game = stableBoard();
  stableFight(game, ["atkB"], "faction", ["blkA", "blkB"], (source) =>
    source.cardId === game.id("atkB")
      ? [
          { sourceId: source.cardId, target: toCard(game.id("blkA")), amount: 1 },
          { sourceId: source.cardId, target: toCard(game.id("blkB")), amount: 2 }
        ]
      : source.legalTargets.length > 0 && source.strength > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }]
        : []
  );
  assert.equal(damageOn(game.engine, game.id("blkA")), 2);
  assert.equal(damageOn(game.engine, game.id("blkB")), 3);
});

clause(STABLES, "0:rule", "'to a character' only: unblocked, my attacker's damage to the faction is NOT increased", () => {
  const game = stableBoard();
  stableFight(game, ["atkA"], "faction", []);
  assert.equal(influenceOf(game.engine, P2), START - 2);
});

clause(STABLES, "0:rule", "'to a character' only: an attack on a location is NOT increased", () => {
  const game = stableBoard();
  stableFight(game, ["atkA"], "keep", []);
  assert.equal(damageOn(game.engine, game.id("keep")), 2);
});

clause(STABLES, "0:rule", "'attacking' only: my BLOCKER's damage to an attacking character is not increased", () => {
  const game = devBoard(
    [
      { key: "st", def: printing(STABLES), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "My Blocker", strength: 2, life: 20, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("atk")), 2, "2 strength, no increase");
});

clause(STABLES, "0:rule", "'you control': the opponent's attacking character is not increased by MY Stables", () => {
  const game = devBoard(
    [
      { key: "st", def: printing(STABLES), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "My Blocker", strength: 1, life: 20, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 20, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("blk")), 2, "the opponent's 2 strength, no increase");
});

clause(STABLES, "0:rule", "the opponent's own Stables increases THEIR attackers' damage to my characters", () => {
  const game = devBoard(
    [
      { key: "st", def: printing(STABLES), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "My Blocker", strength: 1, life: 20, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Raider", strength: 2, life: 20, speed: 3 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")], toFaction(P1));
  declareBlockers(game.engine, P1, [game.id("blk")]);
  playOut(game.engine);
  assert.equal(damageOn(game.engine, game.id("blk")), 3);
});

clause(STABLES, "0:rule", "a zero-strength attacker inflicts no damage, so nothing is increased (CR 408.1)", () => {
  const game = stableBoard({ extra: [{ key: "debuff", def: buffTactic("strength", -2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("debuff"), { selected: { t: [game.id("atkA")] } });
  assert.equal(game.engine.getStat(game.id("atkA"), "strength"), 0);
  stableFight(game, ["atkA"], "faction", ["blkA"], (source) =>
    source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0] as DamageTarget, amount: source.strength }] : []
  );
  assert.equal(damageOn(game.engine, game.id("blkA")), 0);
});

clause(STABLES, "0:rule", "damage that is not battle damage is not increased: a tactic's 2 damage stays 2", () => {
  const game = stableBoard({ extra: [{ key: "z", def: zapTactic(2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("z"), { selected: { t: [game.id("blkA")] } });
  assert.equal(damageOn(game.engine, game.id("blkA")), 2);
});

clause(STABLES, "0:rule", "two Stables each add 1: +2 (a 2-strength attacker inflicts 4)", () => {
  const game = stableBoard({ extra: [{ key: "st2", def: printing(STABLES), owner: P1, zone: "play" }] });
  stableFight(game, ["atkA"], "faction", ["blkA"]);
  assert.equal(damageOn(game.engine, game.id("blkA")), 4);
});

clause(STABLES, "0:rule", "only while the Stables is in play: in my hand or face-down it increases nothing", () => {
  for (const [label, o] of [
    ["hand", { zone: "hand" as const }],
    ["face-down", { faceDown: true }]
  ] as const) {
    const game = stableBoard(o);
    stableFight(game, ["atkA"], "faction", ["blkA"]);
    assert.equal(damageOn(game.engine, game.id("blkA")), 2, `Stables ${label}`);
  }
});

clause(STABLES, "0:rule", "once the Stables is destroyed the increase stops", () => {
  const game = stableBoard({ extra: [{ key: "z3", def: locationZapTactic(3), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("z3"), { selected: { t: [game.id("st")] } });
  assert.equal(zoneOf(game.engine, game.id("st")), "discard");
  stableFight(game, ["atkA"], "faction", ["blkA"]);
  assert.equal(damageOn(game.engine, game.id("blkA")), 2);
});

clause(STABLES, "0:rule", "the increase applies to any attacking character I control, not only a particular one: another attacker is increased too", () => {
  const game = stableBoard();
  stableFight(game, ["atkB"], "faction", ["blkA"]);
  assert.equal(damageOn(game.engine, game.id("blkA")), 4);
});

// =============================================================================
// Manful Skirmish
// COST: Pick 3 characters.
// EFFECT: Deplete one of the characters. Inflict 1 damage to another one of the
// characters. The remaining character gains 2 strength this turn. Draw a card.
// Tactic, cost 4, threshold [R][R].
// =============================================================================

const SKIRMISH = "dc6290ab-38ea-452c-9f85-99dcc44271a5";

interface SkirmishOpts {
  rage?: number;
  greed?: number;
  active?: PlayerId;
  deck?: number;
  extra?: CardPlacement[];
}

function skirmishBoard(o: SkirmishOpts = {}) {
  return devBoard(
    [
      { key: "sk", def: printing(SKIRMISH), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "Alpha", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "c", def: character({ name: "Charlie", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "d", def: character({ name: "Delta", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weakling", strength: 1, life: 1, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
      ...fillers("d", o.deck ?? 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}

type SkirmishGame = ReturnType<typeof skirmishBoard>;
const skirmishCast = (game: SkirmishGame, picks: string[], player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("sk"), { selected: { cs: picks.map((key) => game.id(key)) } });

/**
 * Casts Skirmish on `picks` and answers the "which one" prompts in text order:
 * `roles.deplete` (deplete one of them), `roles.damage` (1 damage to another one)
 * and `roles.pump` (the remaining one). Returns how many prompts were answered.
 */
function skirmishRun(game: SkirmishGame, picks: string[], roles: { deplete: string; damage: string; pump: string }): number {
  skirmishCast(game, picks);
  resolvePendingResponses(game.engine);
  const answers = [roles.deplete, roles.damage, roles.pump];
  let n = 0;
  while (game.engine.state.pendingChoice && n < 6) {
    const pc = pending(game.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", `prompt ${n + 1}`);
    assert.equal(pc.playerId, P1, "I decide which character gets which effect");
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(answers[n] ?? roles.pump)] });
    n++;
  }
  return n;
}

clause(SKIRMISH, "0:ability", "the card itself: cost 4 with [R][R] - refused at 3 resources and with one [R]; pays exactly 4; the resolved tactic goes to my discard pile", () => {
  const short = skirmishBoard({ rage: 2, greed: 1 });
  refused(() => skirmishCast(short, ["a", "b", "c"]), "3 resources for cost 4");
  const oneRage = skirmishBoard({ rage: 1, greed: 6 });
  refused(() => skirmishCast(oneRage, ["a", "b", "c"]), "only one [R]");
  const ok = skirmishBoard({ rage: 2, greed: 3 });
  const before = ready(ok.engine);
  skirmishCast(ok, ["a", "b", "c"]);
  assert.equal(before - ready(ok.engine), 4);
  resolvePendingResponses(ok.engine);
  // each of the three prompts needs a different character (deplete a, damage b, pump c)
  const roleOrder = [ok.id("a"), ok.id("b"), ok.id("c")];
  drain(ok.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [roleOrder.shift()!] } : declineAll(pc)));
  assert.equal(zoneOf(ok.engine, ok.id("sk")), "discard");
});

clause(SKIRMISH, "0:ability", "the cost (the three picks) is committed when played; nothing happens and nothing is asked while it waits for responses", () => {
  const game = skirmishBoard();
  skirmishCast(game, ["a", "b", "c"]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  for (const key of ["a", "b", "c"]) {
    assert.equal(isDepleted(game.engine, game.id(key)), false, key);
    assert.equal(damageOn(game.engine, game.id(key)), 0, key);
    assert.equal(game.engine.getStat(game.id(key), "strength"), 1, key);
  }
});

clause(SKIRMISH, "0:ability", "exactly 3 characters: two and four are refused (three are accepted)", () => {
  const two = skirmishBoard();
  refused(() => skirmishCast(two, ["a", "b"]), "two characters");
  const four = skirmishBoard();
  refused(() => skirmishCast(four, ["a", "b", "c", "d"]), "four characters");
  const none = skirmishBoard();
  refused(() => skirmishCast(none, []), "no characters");
  assert.equal(zoneOf(none.engine, none.id("sk")), "hand");
  const three = skirmishBoard();
  skirmishCast(three, ["a", "b", "c"]);
  assert.notEqual(zoneOf(three.engine, three.id("sk")), "hand", "control");
});

clause(SKIRMISH, "0:ability", "the three must be different characters", () => {
  const bad = skirmishBoard();
  refused(() => skirmishCast(bad, ["a", "a", "b"]), "a duplicate");
  const bad2 = skirmishBoard();
  refused(() => skirmishCast(bad2, ["a", "a", "a"]), "the same character three times");
  assert.equal(zoneOf(bad.engine, bad.id("sk")), "hand");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(SKIRMISH, "0:ability", `cannot pick ${why} as one of the three`, () => {
    const bad = skirmishBoard();
    refused(() => skirmishCast(bad, ["a", "b", key]), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("sk")), "hand");
    const good = skirmishBoard();
    skirmishCast(good, ["a", "b", "c"]);
    assert.notEqual(zoneOf(good.engine, good.id("sk")), "hand", "control");
  });
}

clause(SKIRMISH, "0:ability", "cannot pick a faction or a resource as one of the three", () => {
  const faction = skirmishBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("sk"), { selected: { cs: [faction.id("a"), faction.id("b"), faction.engine.state.players[P2].factionId!] } }), "a faction");
  const resource = skirmishBoard();
  const resourceId = resource.engine.state.players[P1].play.find((cardId) => resource.engine.isResource(cardId))!;
  refused(() => playRaw(resource.engine, P1, resource.id("sk"), { selected: { cs: [resource.id("a"), resource.id("b"), resourceId] } }), "a resource");
});

clause(SKIRMISH, "0:ability", "mine and theirs can be mixed in any proportion: three of mine, three of theirs", () => {
  const mine = skirmishBoard({ extra: [{ key: "e", def: character({ name: "Echo", life: 5 }), owner: P1, zone: "play" }] });
  skirmishCast(mine, ["a", "d", "e"]);
  assert.notEqual(zoneOf(mine.engine, mine.id("sk")), "hand");
  const theirs = skirmishBoard();
  skirmishCast(theirs, ["b", "c", "weak"]);
  assert.notEqual(zoneOf(theirs.engine, theirs.id("sk")), "hand");
});

const ROLE_ASSIGNMENTS = [
  { deplete: "a", damage: "b", pump: "c" },
  { deplete: "a", damage: "c", pump: "b" },
  { deplete: "b", damage: "a", pump: "c" },
  { deplete: "b", damage: "c", pump: "a" },
  { deplete: "c", damage: "a", pump: "b" },
  { deplete: "c", damage: "b", pump: "a" }
] as const;

for (const roles of ROLE_ASSIGNMENTS) {
  clause(SKIRMISH, "0:ability", `I choose who gets what: deplete ${roles.deplete}, 1 damage to ${roles.damage}, +2 strength to ${roles.pump} - each exactly once`, () => {
    const game = skirmishBoard();
    skirmishRun(game, ["a", "b", "c"], roles);
    assert.equal(game.engine.state.pendingChoice, undefined);
    for (const key of ["a", "b", "c"]) {
      assert.equal(isDepleted(game.engine, game.id(key)), key === roles.deplete, `${key} depleted`);
      assert.equal(damageOn(game.engine, game.id(key)), key === roles.damage ? 1 : 0, `${key} damage`);
      assert.equal(game.engine.getStat(game.id(key), "strength"), key === roles.pump ? 3 : 1, `${key} strength`);
    }
    assert.equal(zoneOf(game.engine, game.id("sk")), "discard");
  });
}

clause(SKIRMISH, "0:ability", "a character that is not one of the three is untouched", () => {
  const game = skirmishBoard();
  skirmishRun(game, ["a", "b", "c"], { deplete: "a", damage: "b", pump: "c" });
  assert.equal(isDepleted(game.engine, game.id("d")), false);
  assert.equal(damageOn(game.engine, game.id("d")), 0);
  assert.equal(game.engine.getStat(game.id("d"), "strength"), 1);
  assert.equal(isDepleted(game.engine, game.id("weak")), false);
});

clause(SKIRMISH, "0:ability", "'another one of the characters': the same character cannot be both depleted and damaged - choosing it twice is refused", () => {
  const game = skirmishBoard();
  skirmishCast(game, ["a", "b", "c"]);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("a")] });
  const pc = pending(game.engine);
  assert.ok(pc, "I am asked who takes the 1 damage");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("a")] }), "damaging the character that was already chosen to be depleted");
});

clause(SKIRMISH, "0:ability", "'the remaining character': the +2 strength cannot go to a character that was already depleted or damaged", () => {
  const game = skirmishBoard();
  skirmishCast(game, ["a", "b", "c"]);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("a")] });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("b")] });
  const pc = pending(game.engine);
  if (pc) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("a")] }), "pumping the depleted character");
  }
  assert.equal(game.engine.getStat(game.id("a"), "strength"), 1, "the depleted character did not get the +2");
});

clause(SKIRMISH, "0:ability", "each of the three characters gets exactly one effect: answering with the same character every time must not leave the other two with nothing", () => {
  const game = skirmishBoard();
  skirmishCast(game, ["a", "b", "c"]);
  resolvePendingResponses(game.engine);
  // Trying "a" every time: a repeat is refused (the prompt stays open), so the player is forced on to b and then c.
  const unused = ["b", "c"];
  let n = 0;
  while (game.engine.state.pendingChoice && n++ < 8) {
    try {
      answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("a")] });
    } catch {
      answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(unused.shift()!)] });
    }
  }
  assert.equal(game.engine.state.pendingChoice, undefined, "the three prompts were all answered, each with a different character");
  const touched = (key: string) => isDepleted(game.engine, game.id(key)) || damageOn(game.engine, game.id(key)) > 0 || game.engine.getStat(game.id(key), "strength") > 1;
  assert.ok(touched("b") && touched("c"), "b and c each received one of the effects");
});

clause(SKIRMISH, "0:ability", "I draw exactly one card (the top of my deck); the opponent draws nothing", () => {
  const game = skirmishBoard();
  const handBefore = handOf(game.engine, P1).length;
  const top = deckOf(game.engine, P1)[0];
  skirmishRun(game, ["a", "b", "c"], { deplete: "a", damage: "b", pump: "c" });
  assert.equal(handOf(game.engine, P1).length, handBefore, "-1 for the tactic, +1 for the draw");
  assert.ok(handOf(game.engine, P1).includes(top), "handOf(game.engine, P1).includes(top)");
  assert.equal(deckOf(game.engine, P1).length, 2);
  assert.equal(handOf(game.engine, P2).length, 1, "the opponent drew nothing");
});

clause(SKIRMISH, "0:ability", "with an empty deck nothing stalls and failing to draw does not lose the game", () => {
  const game = skirmishBoard({ deck: 0 });
  skirmishRun(game, ["a", "b", "c"], { deplete: "a", damage: "b", pump: "c" });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.result, undefined);
  assert.equal(isDepleted(game.engine, game.id("a")), true);
});

clause(SKIRMISH, "0:ability", "the 1 damage can destroy a 1-life character", () => {
  const game = skirmishBoard();
  skirmishRun(game, ["a", "weak", "c"], { deplete: "a", damage: "weak", pump: "c" });
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard");
});

clause(SKIRMISH, "0:ability", "'this turn': the +2 strength is gone once the turn is over", () => {
  const game = skirmishBoard();
  skirmishRun(game, ["a", "b", "c"], { deplete: "b", damage: "c", pump: "a" });
  assert.equal(game.engine.getStat(game.id("a"), "strength"), 3);
  endTurn(game.engine, P1);
  assert.equal(game.engine.getStat(game.id("a"), "strength"), 1);
});

clause(SKIRMISH, "0:ability", "I decide even on the opponent's turn (cast in response to an attack): the prompts go to me", () => {
  const game = skirmishBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 20, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  skirmishRun(game, ["a", "b", "atk"], { deplete: "atk", damage: "b", pump: "a" });
  assert.equal(isDepleted(game.engine, game.id("atk")), true);
  assert.equal(damageOn(game.engine, game.id("b")), 1);
  assert.equal(game.engine.getStat(game.id("a"), "strength"), 3);
});

clause(SKIRMISH, "0:ability", "a depleted opposing character cannot block, a pumped attacker hits harder: the effects are real in battle", () => {
  const game = skirmishBoard();
  skirmishRun(game, ["a", "b", "c"], { deplete: "b", damage: "c", pump: "a" });
  declareAttackBy(game.engine, P1, [game.id("a")], toFaction(P2));
  refused(() => declareBlockers(game.engine, P2, [game.id("b")]), "the depleted character blocking");
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(SKIRMISH, "0:ability", "if one of the three left play in response, the effects are still carried out as far as possible and nothing stalls", () => {
  const game = skirmishBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const handBefore = handOf(game.engine, P1).length;
  skirmishCast(game, ["a", "b", "c"]);
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("c")] } });
  resolvePendingResponses(game.engine);
  let n = 0;
  const wanted = [game.id("a"), game.id("b"), game.id("a")];
  while (game.engine.state.pendingChoice && n < 4) {
    const pc = pending(game.engine)!;
    try {
      engineAnswer(game, pc, wanted[n]);
    } catch {
      engineAnswer(game, pc, undefined);
    }
    n++;
  }
  assert.equal(game.engine.state.pendingChoice, undefined, "no prompt is left open");
  assert.equal(zoneOf(game.engine, game.id("sk")), "discard");
  assert.equal(handOf(game.engine, P1).length, handBefore, "the card is still drawn: -1 tactic, +1 draw");
});

/** Answers a chooserSelectsTarget prompt with `selected` (or an empty pick). */
function engineAnswer(game: { engine: SpoilsEngine }, pc: PendingChoiceLike, selected: CardInstanceId | undefined): void {
  game.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: selected ? [selected] : [] } } as never);
  resolvePendingResponses(game.engine);
}

// @@END@@
