// Clause tests — batch 2nd-edition-03. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-03`. Expectations come from each
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
import { clause, clauseMismatch, declineAll, drain, printing, refused, settleState, flipUpNow, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, isDevelopPrompt, developDrawLeft, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

type Pid = PlayerId;
type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 2, rage: 3 })`. */
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
const nCards = (engine: SpoilsEngine, player: PlayerId, zone: string): number =>
  Object.values(engine.state.cards).filter((c) => c.ownerId === player && c.zone === zone).length;

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

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pickTargets(engine: SpoilsEngine, player: PlayerId, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** Answers the open `mayPay` choice. */
function answerMayPay(engine: SpoilsEngine, pay: boolean): void {
  const pc = expectPending(engine, "mayPay");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(engine);
}

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** `n` of `icon` resources already attached to (spent on) `owner`'s faction. */
const spent = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** A free tactic (id "no") with no effect, used to open a response window. */
const NOOP = tactic({ id: "2nd-edition-03-noop", name: "Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });

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

/** A free tactic (id "take", pick "t"): the caster takes control of the picked character (permanently). */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "take",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
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

/** Ends `playerId`'s turn: the other player's turn starts (stops at any start-of-turn prompt). */
function startTurnOf(engine: SpoilsEngine, player: PlayerId): void {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has passed to the player");
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Resources `player` spent (attached) while `fn` ran. */
function spentBy(engine: SpoilsEngine, player: PlayerId, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

/** `kind: "orderTriggers"` answered with the first listed trigger, anything else declined. */
const orderThenDecline = (pc: PendingChoiceLike): unknown =>
  pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : declineAll(pc);

/** A small seeded LCG: a deterministic random source for `buildGame({ random })`. */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// =============================================================================
// Free Trade Agreement (2nd Edition)
// At the start of each player's turn, that player chooses one of the following:
// OPTION 1: That player may draw a card and their opponent may play a resource.
// OPTION 2: That player may play a resource and their opponent may draw a card.
// OPTION 3: Both players may draw up to 2 cards.
// OPTION 4: Both players may play up to 2 resources.
// Item, banker, cost 2, [G][G].
// =============================================================================

const FTA = "6a09105b-8cde-488e-ae5b-89ebc81beade";

/**
 * FTA (controlled by `controller`, default P1) in play. Each side holds two real
 * resource cards (`<p>res0`, `<p>res1`) and a character (`<p>chr`) in hand and 6 cards in its deck
 * (`<p>d0..5`, top first). `starting` is the player whose turn is about to begin: the board is built
 * on the other player's turn, so `startTurnOf(engine, starting)` ends it.
 */
function ftaBoard(o: { starting?: Pid; controller?: Pid; ftaInPlay?: boolean; seed?: () => number } = {}) {
  const starting = o.starting ?? P2;
  const side = (p: Pid): CardPlacement[] => [
    { key: `${p}res0`, def: resourceCard({ name: `${p}Rage0` }), owner: p, zone: "hand" },
    { key: `${p}res1`, def: resourceCard({ name: `${p}Rage1` }), owner: p, zone: "hand" },
    { key: `${p}chr`, def: character({ name: `${p}Chr` }), owner: p, zone: "hand" },
    ...fillers(`${p}d`, 6, p, "deck")
  ];
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: other(starting),
    turn: starting === P1 ? 2 : 1,
    random: o.seed,
    cards: [
      ...(o.ftaInPlay === false ? [] : [{ key: "fta", def: printing(FTA), owner: o.controller ?? P1, zone: "play" as const }]),
      ...side(P1),
      ...side(P2)
    ]
  });
}

/** Picks FTA's option `index` (the active player decides) and returns the follow-up pending choice. */
function ftaPick(engine: SpoilsEngine, index: number) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "FTA asks the active player to pick an option");
  engine.perform({ type: "resolvePendingChoice", playerId: pc!.playerId, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
  return pending(engine);
}

interface FtaPlan {
  /** How many of a player's "may draw" prompts they accept (they decline the rest). */
  draws?: Partial<Record<Pid, number>>;
  /** The cards a player puts into play when asked to pick resources. */
  plays?: Partial<Record<Pid, CardInstanceId[]>>;
}

/** Answers every follow-up prompt from `plan`; returns the prompts seen in order, e.g. "mayPay:p1". */
function ftaDrive(engine: SpoilsEngine, plan: FtaPlan): string[] {
  const draws = { ...(plan.draws ?? {}) } as Record<string, number>;
  const seen: string[] = [];
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 20) {
    const pc = pending(engine)!;
    if (pc.kind === "orderTriggers" || isDevelopPrompt(engine)) {
      settleTurnStart(engine); // the turn's other start-of-turn triggers are not what this drives
      continue;
    }
    seen.push(`${pc.kind}:${pc.playerId}`);
    let choice: unknown;
    if (pc.kind === "mayPay") {
      const left = draws[pc.playerId] ?? 0;
      draws[pc.playerId] = left - 1;
      choice = { kind: "mayPay", pay: left > 0 };
    } else if (pc.kind === "chooserSelectsTarget") {
      choice = { kind: "chooserSelectsTarget", selected: plan.plays?.[pc.playerId as Pid] ?? [] };
    } else {
      throw new Error(`unexpected prompt ${pc.kind}`);
    }
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return seen;
}

/** Declines "may draw" prompts until the next non-draw prompt (or nothing) is pending. */
function declineDrawPrompts(engine: SpoilsEngine): void {
  let guard = 0;
  while (pending(engine)?.kind === "mayPay" && guard++ < 5) {
    engine.perform({ type: "resolvePendingChoice", playerId: pending(engine)!.playerId, choice: { kind: "mayPay", pay: false } } as never);
    resolvePendingResponses(engine);
  }
}

const ftaRes = (p: Pid, n: 0 | 1) => `${p}res${n}`;
const ftaChr = (p: Pid) => `${p}chr`;
const turnOf = (p: Pid) => `${p === P1 ? "P1" : "P2"}'s turn`;

// --- 0:rule -------------------------------------------------------------------

clause(FTA, "0:rule", "at the start of the opponent's turn THAT player (not the Agreement's controller) chooses, from exactly four options", () => {
  const b = ftaBoard({ starting: P2 });
  startTurnOf(b.engine, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P2, "the player whose turn is starting chooses, not the Agreement's controller");
  assert.equal(pc?.optionCount, 4, "four options");
});

clause(FTA, "0:rule", "at the start of its controller's own turn the controller chooses, from exactly four options", () => {
  const b = ftaBoard({ starting: P1 });
  startTurnOf(b.engine, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  assert.equal(pc?.optionCount, 4);
});

clause(FTA, "0:rule", "who controls the Agreement makes no difference: each player still chooses at the start of their own turn", () => {
  for (const starting of [P1, P2] as const) {
    const b = ftaBoard({ starting, controller: P2 });
    startTurnOf(b.engine, starting);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
    assert.equal(pending(b.engine)?.playerId, starting, `${turnOf(starting)}: the active player chooses`);
    assert.equal(pending(b.engine)?.optionCount, 4);
  }
});

clause(FTA, "0:rule", "the choice is not offered before the turn starts: while the previous player's turn is still being played, nothing is asked", () => {
  const b = ftaBoard({ starting: P2 });
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt before the turn change");
});

clause(FTA, "0:rule", "the choice is mandatory: nothing else can be done until an option is chosen", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  refused(() => b.engine.perform({ type: "endTurn", playerId: P2 }), "cannot end the turn with the choice open");
  assert.equal(isDevelopPrompt(b.engine), false, "the Develop Rule cannot be used with the choice open: its own prompt waits behind it");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the choice is still pending");
  // control: once an option is chosen the game goes on
  ftaPick(b.engine, 0);
  ftaDrive(b.engine, {});
  assert.equal(b.engine.state.pendingChoice, undefined);
  developDraw(b.engine, P2);
});

clause(FTA, "0:rule", "only the player whose turn is starting chooses; an index outside the four options is refused", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } } as never),
    "the other player cannot choose"
  );
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 4 } } as never),
    "there is no fifth option"
  );
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: -1 } } as never),
    "there is no option -1"
  );
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the choice is still pending");
  ftaPick(b.engine, 3);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the proper chooser CAN choose (option 4 asks for resources)");
});

clause(FTA, "0:rule", "it happens at the start of EVERY turn, for both players, turn after turn", () => {
  const b = ftaBoard({ starting: P2 });
  const askedOf: string[] = [];
  let active: Pid = P1;
  for (let i = 0; i < 4; i++) {
    endTurn(b.engine, active);
    active = other(active);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsOption", `turn ${i + 2}`);
    askedOf.push(pc!.playerId);
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, {});
  }
  assert.deepEqual(askedOf, [P2, P1, P2, P1]);
});

clause(FTA, "0:rule", "it asks only at the start of the turn: nothing more is asked while the turn is played", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  ftaPick(b.engine, 0);
  ftaDrive(b.engine, {});
  assert.equal(b.engine.state.pendingChoice, undefined, "the turn proceeds normally");
  developDraw(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "developing asks nothing");
  assert.equal(b.engine.state.activePlayerId, P2, "still the same turn");
});

clause(FTA, "0:rule", "without the Agreement in play nothing is asked at the start of a turn", () => {
  const b = ftaBoard({ ftaInPlay: false });
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = ftaBoard({ ftaInPlay: false, starting: P1 });
  startTurnOf(c.engine, P1);
  assert.equal(c.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "once the Agreement has been destroyed nothing is asked any more", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fta", def: printing(FTA), owner: P1, zone: "play" },
      { key: "killer", def: tactic({
        name: "ItemKiller",
        cost: 0,
        behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
      }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck")
    ]
  });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("fta")] } });
  assert.equal(zoneOf(b.engine, b.id("fta")), "discard");
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "a face-down Agreement is just a resource and asks nothing", () => {
  const b = ftaBoard();
  b.engine.state.cards[b.id("fta")].faceDown = true;
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "the Agreement in the opponent's play zone (controlled by the opponent) applies to both players' turns alike", () => {
  const b = ftaBoard({ starting: P1, controller: P2 });
  startTurnOf(b.engine, P1);
  assert.equal(pending(b.engine)?.playerId, P1);
  ftaPick(b.engine, 0);
  ftaDrive(b.engine, {});
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.playerId, P2);
});

clause(FTA, "0:rule", "deploys for exactly its printed cost of 2 with [G][G]; one resource short or one [G] short is refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("fta"));
  assert.equal(zoneOf(b.engine, b.id("fta")), "play");
  assert.equal(before - ready(b.engine), 2, "pays exactly 2");

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("fta")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("fta")), "hand");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("fta")), "one [G] is not [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("fta")), "hand");
});

// For every option, all four (controller, active player) combinations are covered.

const ftaCombos: Array<[Pid, Pid]> = [
  [P1, P1],
  [P1, P2],
  [P2, P1],
  [P2, P2]
];

for (const [ctrl, active] of ftaCombos) {
  const opp = other(active);
  const tag = `Agreement controlled by ${ctrl}, ${turnOf(active)}`;

  // OPTION 1 -- That player may draw a card and their opponent may play a resource.

  clause(FTA, "1:option:OPTION 1", `${tag}: that player may draw a card; accepting draws exactly the top card of their own deck`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const top = deckOf(b.engine, active)[0];
    const handBefore = nCards(b.engine, active, "hand");
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 1 } });
    assert.ok(seen.includes(`mayPay:${active}`), "the active player is asked whether to draw");
    assert.equal(zoneOf(b.engine, top), "hand", "the top card of their deck");
    assert.equal(controllerOf(b.engine, top), active);
    assert.equal(nCards(b.engine, active, "hand"), handBefore + 1, "exactly one card");
    assert.equal(deckOf(b.engine, active).length, 5);
    assert.equal(deckOf(b.engine, opp).length, 6, "the other deck is untouched");
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: that player may decline to draw`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const handBefore = nCards(b.engine, active, "hand");
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 0 } });
    assert.ok(seen.includes(`mayPay:${active}`), "control: the active player WAS offered the draw");
    assert.equal(nCards(b.engine, active, "hand"), handBefore, "no card drawn");
    assert.equal(deckOf(b.engine, active).length, 6);
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: that player draws only ONE card, and the opponent is not offered a draw`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 5, [opp]: 5 } });
    assert.equal(seen.filter((s) => s.startsWith("mayPay")).length, 1, "a single 'may draw' prompt");
    assert.equal(seen.filter((s) => s === `mayPay:${opp}`).length, 0, "the opponent is not offered a draw");
    assert.equal(deckOf(b.engine, active).length, 5);
    assert.equal(deckOf(b.engine, opp).length, 6);
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: their opponent may play a resource: a real resource card from the opponent's own hand goes into play face-up and provides its icon`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 1 }, plays: { [opp]: [b.id(ftaRes(opp, 0))] } });
    assert.ok(seen.includes(`chooserSelectsTarget:${opp}`), "the opponent (not the active player) is asked");
    const card = b.engine.state.cards[b.id(ftaRes(opp, 0))];
    assert.equal(card.zone, "play");
    assert.equal(card.controllerId, opp);
    assert.equal(card.faceDown, false, "a real resource card is played face-up");
    assert.equal(b.engine.getThresholds(opp).rage, 1);
    assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 1))), "hand", "only one resource is played");
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: their opponent may play ANY card as a resource: a character from hand goes into play face-down (providing Volition)`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, { plays: { [opp]: [b.id(ftaChr(opp))] } });
    const card = b.engine.state.cards[b.id(ftaChr(opp))];
    assert.equal(card.zone, "play");
    assert.equal(card.faceDown, true, "a non-resource card can only be played face-down");
    assert.equal(b.engine.getThresholds(opp).volition, 1);
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: their opponent may decline to play a resource`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const playBefore = [nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")];
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { plays: { [opp]: [] } });
    assert.ok(seen.includes(`chooserSelectsTarget:${opp}`), "control: the opponent WAS offered the play");
    for (const key of [ftaRes(opp, 0), ftaRes(opp, 1), ftaChr(opp)]) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
    assert.deepEqual([nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")], playBefore, "nothing entered play");
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: their opponent plays at most ONE resource, from their own hand only`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    declineDrawPrompts(b.engine);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, opp);
    refused(() => pickTargets(b.engine, opp, [b.id(ftaRes(opp, 0)), b.id(ftaRes(opp, 1))]), "two resources are too many");
    refused(() => pickTargets(b.engine, opp, [b.id(ftaRes(active, 0))]), "the active player's hand card is not theirs to play");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "hand");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 1))), "hand");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 0))), "hand");
    pickTargets(b.engine, opp, [b.id(ftaRes(opp, 0))]);
    assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "play", "control: one resource from their own hand is legal");
  });

  clause(FTA, "1:option:OPTION 1", `${tag}: the active player does NOT get to play a resource in option 1`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, {
      draws: { [active]: 1 },
      plays: { [opp]: [b.id(ftaRes(opp, 0))], [active]: [b.id(ftaRes(active, 0))] }
    });
    assert.equal(seen.filter((s) => s === `chooserSelectsTarget:${active}`).length, 0, "the active player is never asked to pick a resource");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 0))), "hand");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "play", "control: the opponent's resource did enter play");
  });

  // OPTION 2 -- That player may play a resource and their opponent may draw a card.

  clause(FTA, "2:option:OPTION 2", `${tag}: their opponent may draw a card: accepting draws exactly the top card of THEIR deck`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const top = deckOf(b.engine, opp)[0];
    const handBefore = nCards(b.engine, opp, "hand");
    ftaPick(b.engine, 1);
    const seen = ftaDrive(b.engine, { draws: { [opp]: 1 } });
    assert.ok(seen.includes(`mayPay:${opp}`), "the opponent is asked whether to draw");
    assert.equal(zoneOf(b.engine, top), "hand");
    assert.equal(nCards(b.engine, opp, "hand"), handBefore + 1);
    assert.equal(deckOf(b.engine, opp).length, 5);
    assert.equal(deckOf(b.engine, active).length, 6, "the active player's deck is untouched");
  });

  clause(FTA, "2:option:OPTION 2", `${tag}: their opponent may decline to draw, and draws only one card (the active player is not offered a draw)`, () => {
    const declined = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(declined.engine, active);
    ftaPick(declined.engine, 1);
    const seenDeclined = ftaDrive(declined.engine, { draws: { [opp]: 0 } });
    assert.ok(seenDeclined.includes(`mayPay:${opp}`), "control: the opponent WAS offered the draw");
    assert.equal(deckOf(declined.engine, opp).length, 6);

    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 1);
    const seen = ftaDrive(b.engine, { draws: { [opp]: 5, [active]: 5 } });
    assert.equal(seen.filter((s) => s.startsWith("mayPay")).length, 1, "a single 'may draw' prompt");
    assert.equal(seen.filter((s) => s === `mayPay:${active}`).length, 0, "the active player is not offered a draw");
    assert.equal(deckOf(b.engine, opp).length, 5);
    assert.equal(deckOf(b.engine, active).length, 6);
  });

  clause(FTA, "2:option:OPTION 2", `${tag}: that player may decline to play a resource`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const playBefore = [nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")];
    ftaPick(b.engine, 1);
    const seen = ftaDrive(b.engine, { plays: { [active]: [] } });
    assert.ok(seen.includes(`chooserSelectsTarget:${active}`), "control: the active player WAS offered the play");
    for (const key of [ftaRes(active, 0), ftaRes(active, 1), ftaChr(active)]) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
    assert.deepEqual([nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")], playBefore, "nothing entered play");
  });

  // OPTION 3 -- Both players may draw up to 2 cards.

  for (const [activeDraws, otherDraws] of [
    [2, 2],
    [1, 2],
    [2, 1],
    [0, 2],
    [2, 0],
    [1, 1],
    [0, 0]
  ] as const) {
    clause(FTA, "3:option:OPTION 3", `${tag}: the active player draws ${activeDraws} and the other player draws ${otherDraws} (up to 2 each, each decides)`, () => {
      const b = ftaBoard({ starting: active, controller: ctrl });
      startTurnOf(b.engine, active);
      const topActive = deckOf(b.engine, active).slice(0, activeDraws);
      const topOpp = deckOf(b.engine, opp).slice(0, otherDraws);
      const hand = { [active]: nCards(b.engine, active, "hand"), [opp]: nCards(b.engine, opp, "hand") };
      ftaPick(b.engine, 2);
      ftaDrive(b.engine, { draws: { [active]: activeDraws, [opp]: otherDraws } });
      assert.equal(nCards(b.engine, active, "hand"), hand[active] + activeDraws);
      assert.equal(nCards(b.engine, opp, "hand"), hand[opp] + otherDraws);
      for (const cardId of [...topActive, ...topOpp]) assert.equal(zoneOf(b.engine, cardId), "hand", "the top cards of their own decks");
      assert.equal(deckOf(b.engine, active).length, 6 - activeDraws);
      assert.equal(deckOf(b.engine, opp).length, 6 - otherDraws);
    });
  }

  clause(FTA, "3:option:OPTION 3", `${tag}: nobody can draw more than 2 (each player is offered at most two draws), and nothing enters play`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const playBefore = [nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")];
    ftaPick(b.engine, 2);
    const seen = ftaDrive(b.engine, {
      draws: { [active]: 9, [opp]: 9 },
      plays: { [P1]: [b.id(ftaRes(P1, 0))], [P2]: [b.id(ftaRes(P2, 0))] }
    });
    assert.equal(seen.filter((s) => s === `mayPay:${active}`).length, 2, "two prompts for the active player");
    assert.equal(seen.filter((s) => s === `mayPay:${opp}`).length, 2, "two prompts for the other player");
    assert.equal(seen.filter((s) => s.startsWith("chooserSelectsTarget")).length, 0, "no resource prompts: this option is about drawing");
    assert.equal(deckOf(b.engine, active).length, 4);
    assert.equal(deckOf(b.engine, opp).length, 4);
    assert.deepEqual([nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")], playBefore);
  });

  clause(FTA, "3:option:OPTION 3", `${tag}: with a nearly empty deck a player draws what is there and the game goes on`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    b.engine.state.players[active].deck = b.engine.state.players[active].deck.slice(0, 1);
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 2);
    ftaDrive(b.engine, { draws: { [active]: 2, [opp]: 2 } });
    assert.equal(deckOf(b.engine, active).length, 0);
    assert.equal(deckOf(b.engine, opp).length, 4);
    assert.equal(b.engine.state.result, undefined);
  });

  // OPTION 4 -- Both players may play up to 2 resources.

  for (const [activeN, otherN] of [
    [2, 2],
    [1, 2],
    [2, 1],
    [0, 2],
    [2, 0],
    [1, 1],
    [0, 0]
  ] as const) {
    clause(FTA, "4:option:OPTION 4", `${tag}: the active player plays ${activeN} resource(s) and the other player plays ${otherN} (up to 2 each)`, () => {
      const b = ftaBoard({ starting: active, controller: ctrl });
      startTurnOf(b.engine, active);
      const activeCards = [b.id(ftaRes(active, 0)), b.id(ftaRes(active, 1))].slice(0, activeN);
      const oppCards = [b.id(ftaRes(opp, 0)), b.id(ftaRes(opp, 1))].slice(0, otherN);
      ftaPick(b.engine, 3);
      const seen = ftaDrive(b.engine, { plays: { [active]: activeCards, [opp]: oppCards } });
      assert.ok(seen.includes(`chooserSelectsTarget:${active}`) && seen.includes(`chooserSelectsTarget:${opp}`), "both players are asked");
      for (const cardId of [...activeCards, ...oppCards]) assert.equal(zoneOf(b.engine, cardId), "play");
      for (const key of [ftaRes(active, 0), ftaRes(active, 1)].slice(activeN)) assert.equal(zoneOf(b.engine, b.id(key)), "hand", "the ones not picked stay in hand");
      for (const key of [ftaRes(opp, 0), ftaRes(opp, 1)].slice(otherN)) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
      assert.equal(b.engine.getThresholds(active).rage ?? 0, activeN);
      assert.equal(b.engine.getThresholds(opp).rage ?? 0, otherN);
      assert.equal(deckOf(b.engine, P1).length, 6, "no one draws");
      assert.equal(deckOf(b.engine, P2).length, 6);
    });
  }

  clause(FTA, "4:option:OPTION 4", `${tag}: no one can play more than 2: picking three cards is refused for either player, picking two is fine`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    const playBefore = [nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")];
    ftaPick(b.engine, 3);
    for (let i = 0; i < 2; i++) {
      const pc = pending(b.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      const who = pc.playerId as Pid;
      const hand = [b.id(ftaRes(who, 0)), b.id(ftaRes(who, 1)), b.id(ftaChr(who))];
      refused(() => pickTargets(b.engine, who, hand), `three cards for ${who}`);
      pickTargets(b.engine, who, hand.slice(0, 2));
    }
    settleTurnStart(b.engine); // the turn's Develop Rule is offered once Agreement has settled: skip it
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.deepEqual([nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")], [playBefore[0] + 2, playBefore[1] + 2], "exactly two cards entered play for each player");
  });

  clause(FTA, "4:option:OPTION 4", `${tag}: each player plays only cards from their own hand`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 3);
    const who = pending(b.engine)!.playerId as Pid;
    refused(() => pickTargets(b.engine, who, [b.id(ftaRes(other(who), 0))]), "the other player's hand card");
    assert.equal(zoneOf(b.engine, b.id(ftaRes(other(who), 0))), "hand");
    pickTargets(b.engine, who, [b.id(ftaRes(who, 0))]);
    assert.equal(zoneOf(b.engine, b.id(ftaRes(who, 0))), "play", "control: their own card is fine");
  });

  clause(FTA, "4:option:OPTION 4", `${tag}: any card can be one of the two resources: a character goes in face-down next to a real resource card`, () => {
    const b = ftaBoard({ starting: active, controller: ctrl });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 3);
    ftaDrive(b.engine, {
      plays: { [active]: [b.id(ftaRes(active, 0)), b.id(ftaChr(active))], [opp]: [b.id(ftaChr(opp)), b.id(ftaRes(opp, 0))] }
    });
    for (const p of [active, opp]) {
      assert.equal(b.engine.state.cards[b.id(ftaChr(p))].faceDown, true, `${p}'s character is a face-down resource`);
      assert.equal(b.engine.state.cards[b.id(ftaRes(p, 0))].faceDown, false, `${p}'s real resource is face-up`);
      assert.equal(b.engine.getThresholds(p).volition, 1);
    }
  });
}


// OPTION 2, "That player may play a resource": driven for each (controller, active player) pair below.

function ftaOpt2Real(ctrl: Pid, active: Pid): void {
  const opp = other(active);
  const b = ftaBoard({ starting: active, controller: ctrl });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, 1);
  const seen = ftaDrive(b.engine, { draws: { [opp]: 1 }, plays: { [active]: [b.id(ftaRes(active, 0))] } });
  assert.ok(seen.includes(`chooserSelectsTarget:${active}`), "the active player is asked to pick a resource");
  const card = b.engine.state.cards[b.id(ftaRes(active, 0))];
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, active);
  assert.equal(card.faceDown, false, "a real resource card is played face-up");
  assert.equal(b.engine.getThresholds(active).rage, 1);
  assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 1))), "hand", "only one resource is played");
  assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "hand", "the other player's hand is untouched");
}

function ftaOpt2Any(ctrl: Pid, active: Pid): void {
  const b = ftaBoard({ starting: active, controller: ctrl });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, 1);
  ftaDrive(b.engine, { plays: { [active]: [b.id(ftaChr(active))] } });
  const card = b.engine.state.cards[b.id(ftaChr(active))];
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, active);
  assert.equal(card.faceDown, true);
  assert.equal(b.engine.getThresholds(active).volition, 1);
}

function ftaOpt2AtMostOne(ctrl: Pid, active: Pid): void {
  const opp = other(active);
  const b = ftaBoard({ starting: active, controller: ctrl });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, 1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, active);
  refused(() => pickTargets(b.engine, active, [b.id(ftaRes(active, 0)), b.id(ftaRes(active, 1))]), "two resources are too many");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the refusal leaves the choice open");
  refused(() => pickTargets(b.engine, active, [b.id(ftaRes(opp, 0))]), "the opponent's hand card is not theirs to play");
  assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 0))), "hand");
  assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "hand");
  pickTargets(b.engine, active, [b.id(ftaRes(active, 0))]);
  assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 0))), "play", "control: one resource from their own hand is legal");
}

function ftaOpt2OppNoPlay(ctrl: Pid, active: Pid): void {
  const opp = other(active);
  const b = ftaBoard({ starting: active, controller: ctrl });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, 1);
  const seen = ftaDrive(b.engine, {
    draws: { [opp]: 1 },
    plays: { [active]: [b.id(ftaRes(active, 0))], [opp]: [b.id(ftaRes(opp, 0))] }
  });
  assert.equal(seen.filter((s) => s === `chooserSelectsTarget:${opp}`).length, 0, "the opponent is never asked to pick a resource");
  assert.equal(zoneOf(b.engine, b.id(ftaRes(opp, 0))), "hand");
  assert.equal(zoneOf(b.engine, b.id(ftaRes(active, 0))), "play", "control: the active player's resource did enter play");
}

clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P1's turn: that player may play a resource: a real resource card from their own hand goes into play face-up and provides its icon", () => ftaOpt2Real(P1, P1));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P2's turn: that player may play a resource: a real resource card from their own hand goes into play face-up and provides its icon", () => ftaOpt2Real(P2, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P2's turn: that player may play a resource: a real resource card from their own hand goes into play face-up and provides its icon", () => ftaOpt2Real(P1, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P1's turn: that player may play a resource: a real resource card from their own hand goes into play face-up and provides its icon", () => ftaOpt2Real(P2, P1));

clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P1's turn: that player may play ANY card as a resource: a character from hand goes into play face-down (Volition)", () => ftaOpt2Any(P1, P1));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P2's turn: that player may play ANY card as a resource: a character from hand goes into play face-down (Volition)", () => ftaOpt2Any(P2, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P2's turn: that player may play ANY card as a resource: a character from hand goes into play face-down (Volition)", () => ftaOpt2Any(P1, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P1's turn: that player may play ANY card as a resource: a character from hand goes into play face-down (Volition)", () => ftaOpt2Any(P2, P1));

clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P1's turn: that player plays at most ONE resource, from their own hand only", () => ftaOpt2AtMostOne(P1, P1));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P2's turn: that player plays at most ONE resource, from their own hand only", () => ftaOpt2AtMostOne(P2, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P2's turn: that player plays at most ONE resource, from their own hand only", () => ftaOpt2AtMostOne(P1, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P1's turn: that player plays at most ONE resource, from their own hand only", () => ftaOpt2AtMostOne(P2, P1));

clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P1's turn: the opponent does NOT get to play a resource in option 2", () => ftaOpt2OppNoPlay(P1, P1));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P2's turn: the opponent does NOT get to play a resource in option 2", () => ftaOpt2OppNoPlay(P2, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P1, P2's turn: the opponent does NOT get to play a resource in option 2", () => ftaOpt2OppNoPlay(P1, P2));
clause(FTA, "2:option:OPTION 2", "Agreement controlled by P2, P1's turn: the opponent does NOT get to play a resource in option 2", () => ftaOpt2OppNoPlay(P2, P1));

// 'play a resource' lets the player choose face-up or face-down (CR 203.2, RULES.md 3.5): an actual
// resource card may be played face-down too.

function ftaFaceChoice(option: number, active: Pid, who: Pid, realKey: string): void {
  holdResourceFace(() => {
  const b = ftaBoard({ starting: active });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, option);
  declineDrawPrompts(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, who, "the player who plays the resource is asked");
  pickTargets(b.engine, who, [b.id(realKey)]);
  const asked = pending(b.engine) !== undefined && zoneOf(b.engine, b.id(realKey)) === "hand";
  const faceDown = zoneOf(b.engine, b.id(realKey)) === "play" && b.engine.state.cards[b.id(realKey)].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
  });
}

clause(FTA, "1:option:OPTION 1", "'play a resource' lets the opponent choose face-up or face-down for an actual resource card", () => ftaFaceChoice(0, P2, P1, ftaRes(P1, 0)));
clause(FTA, "2:option:OPTION 2", "'play a resource' lets that player choose face-up or face-down for an actual resource card", () => ftaFaceChoice(1, P1, P1, ftaRes(P1, 0)));
clause(FTA, "4:option:OPTION 4", "'play up to 2 resources' lets each player choose face-up or face-down for an actual resource card", () => ftaFaceChoice(3, P2, P2, ftaRes(P2, 0)));

// =============================================================================
// Gold Summit (2nd Edition)
// If you draw any number of cards, your faction gains X influence, where X is
// the number of cards drawn.
// Location, banker, cost 3, [G][G][G], structure 5.
// =============================================================================

const SUMMIT = "d1058565-20bb-4d3d-ad36-94166c4f8f55";

/** A free tactic (id "dr") that draws `n` cards for its controller. */
function drawTactic(n: number): CardDefinition {
  return tactic({ name: `Draw${n}`, cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] } });
}

/** A free tactic (id "ld", pick "t") that inflicts `n` damage to one picked location. */
function locationDamageTactic(n: number): CardDefinition {
  return tactic({
    name: `LocZap${n}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ld",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }]
        }
      ]
    }
  });
}

function summitBoard(o: { summitOwner?: Pid; deck?: number; oppDeck?: number; extra?: CardPlacement[]; faceDown?: boolean } = {}) {
  const owner = o.summitOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "gs", def: printing(SUMMIT), owner, zone: "play", faceDown: o.faceDown },
      { key: "draw1", def: drawTactic(1), owner: P1, zone: "hand" },
      { key: "draw2", def: drawTactic(2), owner: P1, zone: "hand" },
      { key: "draw3", def: drawTactic(3), owner: P1, zone: "hand" },
      { key: "oppDraw1", def: drawTactic(1), owner: P2, zone: "hand" },
      { key: "oppDraw2", def: drawTactic(2), owner: P2, zone: "hand" },
      { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("d", o.deck ?? 6, P1, "deck"),
      ...fillers("e", o.oppDeck ?? 6, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}

/** Makes `player` the active player so they can play a free tactic. */
function giveTurn(engine: SpoilsEngine, player: Pid): void {
  engine.state.activePlayerId = player;
  engine.state.priorityPlayerId = player;
}

clause(SUMMIT, "0:rule", "drawing a card (a card effect) gains your faction 1 influence (X = 1)", () => {
  const b = summitBoard();
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("draw1"));
  assert.equal(zoneOf(b.engine, top), "hand", "control: the card was drawn");
  assert.equal(influenceOf(b.engine, P1), 21);
  assert.equal(influenceOf(b.engine, P2), 20, "the opponent's faction is untouched");
});

clause(SUMMIT, "0:rule", "drawing with the Develop Rule gains 1 influence", () => {
  const b = summitBoard();
  const top = deckOf(b.engine, P1)[0];
  developDraw(b.engine, P1);
  assert.equal(zoneOf(b.engine, top), "hand", "control: the card was drawn");
  assert.equal(influenceOf(b.engine, P1), 21);
  assert.equal(influenceOf(b.engine, P2), 20);
});

clause(SUMMIT, "0:rule", "X is the number of cards drawn: drawing 2 cards gains 2, drawing 3 gains 3", () => {
  const two = summitBoard();
  play(two.engine, P1, two.id("draw2"));
  assert.equal(deckOf(two.engine, P1).length, 4, "control: two cards were drawn");
  assert.equal(influenceOf(two.engine, P1), 22);

  const three = summitBoard();
  play(three.engine, P1, three.id("draw3"));
  assert.equal(deckOf(three.engine, P1).length, 3, "control: three cards were drawn");
  assert.equal(influenceOf(three.engine, P1), 23);
});

clause(SUMMIT, "0:rule", "drawing several times gains each time: 1 + 1 + 2", () => {
  const b = summitBoard();
  play(b.engine, P1, b.id("draw1"));
  developDraw(b.engine, P1);
  play(b.engine, P1, b.id("draw2"));
  assert.equal(influenceOf(b.engine, P1), 24, "1 + 1 + 2");
});

clause(SUMMIT, "0:rule", "if no card is actually drawn (empty deck) there are no cards drawn and nothing is gained", () => {
  const b = summitBoard({ deck: 0 });
  play(b.engine, P1, b.id("draw1"));
  assert.equal(handOf(b.engine, P1).includes(b.id("draw1")), false, "control: the tactic resolved (it is no longer in hand)");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "if only some of the cards can be drawn, X is the number actually drawn (a 1-card deck, draw 2: gain 1)", () => {
  const b = summitBoard({ deck: 1 });
  play(b.engine, P1, b.id("draw2"));
  assert.equal(deckOf(b.engine, P1).length, 0, "control: the one card was drawn");
  assert.equal(influenceOf(b.engine, P1), 21, "only 1 card was actually drawn");
});

clause(SUMMIT, "0:rule", "if you do not draw (the opponent draws) you gain nothing and neither does the opponent", () => {
  const b = summitBoard();
  giveTurn(b.engine, P2);
  const top = deckOf(b.engine, P2)[0];
  play(b.engine, P2, b.id("oppDraw1"));
  assert.equal(zoneOf(b.engine, top), "hand", "control: the opponent drew");
  assert.equal(influenceOf(b.engine, P1), 20);
  assert.equal(influenceOf(b.engine, P2), 20);
  play(b.engine, P2, b.id("oppDraw2"));
  assert.equal(influenceOf(b.engine, P1), 20, "still nothing after a two-card draw");
  assert.equal(influenceOf(b.engine, P2), 20);
});

clause(SUMMIT, "0:rule", "a card put into your hand without drawing it (returned from play) gains nothing", () => {
  const b = summitBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "control: it went to hand");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "'your faction': an opponent-controlled Summit gains THEM the influence when THEY draw, not me", () => {
  const b = summitBoard({ summitOwner: P2 });
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influenceOf(b.engine, P1), 20, "my draw gains me nothing: it is not my Summit");
  assert.equal(influenceOf(b.engine, P2), 20);
  giveTurn(b.engine, P2);
  play(b.engine, P2, b.id("oppDraw2"));
  assert.equal(influenceOf(b.engine, P2), 22, "their two-card draw gains them 2 influence");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "a Summit I own but that the opponent controls pays the opponent, not me", () => {
  const b = summitBoard();
  b.engine.state.cards[b.id("gs")].controllerId = P2;
  b.engine.state.players[P1].play = b.engine.state.players[P1].play.filter((c) => c !== b.id("gs"));
  b.engine.state.players[P2].play.push(b.id("gs"));
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influenceOf(b.engine, P1), 20, "I draw but the Summit is not under my control");
  giveTurn(b.engine, P2);
  play(b.engine, P2, b.id("oppDraw1"));
  assert.equal(influenceOf(b.engine, P2), 21, "its controller gains");
});

clause(SUMMIT, "0:rule", "once the Summit has left play, drawing gains nothing", () => {
  const b = summitBoard({
    extra: [
      { key: "locKiller", def: locationDamageTactic(5), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("locKiller"), { selected: { t: [b.id("gs")] } });
  assert.equal(zoneOf(b.engine, b.id("gs")), "discard", "control: the Summit was destroyed");
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influenceOf(b.engine, P1), 20);
  developDraw(b.engine, P1);
  assert.equal(influenceOf(b.engine, P1), 20, "nor does the Develop Rule draw");
});

clause(SUMMIT, "0:rule", "a face-down Summit is only a resource and gains nothing", () => {
  const b = summitBoard({ faceDown: true });
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "two Summits each give X: drawing 2 cards with two Summits gains 4", () => {
  const b = summitBoard({ extra: [{ key: "gs2", def: printing(SUMMIT), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("draw2"));
  drain(b.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : declineAll(pc)));
  assert.equal(influenceOf(b.engine, P1), 24, "2 + 2");
});

clause(SUMMIT, "0:rule", "the gain is the faction's influence (not a card count): the opponent's draw of the same size changes nothing for me even with the Develop Rule", () => {
  const b = summitBoard();
  giveTurn(b.engine, P2);
  developDraw(b.engine, P2);
  assert.equal(influenceOf(b.engine, P1), 20);
  assert.equal(influenceOf(b.engine, P2), 20);
});

clause(SUMMIT, "0:rule", "deploys for exactly its printed cost of 3 with [G][G][G] as a location; one resource short or two [G] only is refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("gs"));
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  assert.equal(b.engine.getDefinition(b.id("gs")).type, "location");
  assert.equal(before - ready(b.engine), 3, "pays exactly 3");

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 2, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("gs")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("gs")), "hand");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("gs")), "two [G] is not [G][G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("gs")), "hand");
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 3, P1), ...bank("rage", 2, P1)]
  });
  play(exact.engine, P1, exact.id("gs"));
  assert.equal(zoneOf(exact.engine, exact.id("gs")), "play", "control: exactly [G][G][G] plus other resources is enough");
});

clause(SUMMIT, "0:rule", "has structure 5: 4 damage leaves it in play, 5 destroys it", () => {
  const four = summitBoard({ extra: [{ key: "zap", def: locationDamageTactic(4), owner: P1, zone: "hand" }] });
  play(four.engine, P1, four.id("zap"), { selected: { t: [four.id("gs")] } });
  assert.equal(damageOf(four.engine, four.id("gs")), 4, "control: 4 damage markers");
  assert.equal(zoneOf(four.engine, four.id("gs")), "play", "4 < structure 5");

  const five = summitBoard({ extra: [{ key: "zap", def: locationDamageTactic(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("gs")] } });
  assert.equal(zoneOf(five.engine, five.id("gs")), "discard", "5 = structure 5");
});

// =============================================================================
// Irresistible Bribe (2nd Edition)
// COST: Pick a character. X is its strength.
// EFFECT: Destroy the character. Your opponent's faction gains X influence.
// Tactic, banker, cost 3, [G][G].
// =============================================================================

const BRIBE = "4779dd8b-22b8-45ea-adfc-aaf6c9ce11d8";

/** A free tactic giving the picked character -`amount` strength this turn (id `d`, declaration `t`). */
function debuffTactic(amount: number): CardDefinition {
  return tactic({
    name: `Debuff${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic giving the picked character +`amount` strength this turn (id `d`, declaration `t`). */
function buffTactic(amount: number): CardDefinition {
  return tactic({
    name: `Buff${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

function bribeBoard(o: { greed?: number; rage?: number; active?: Pid; bribeOwner?: Pid } = {}) {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const nerf = item({
    name: "Nerf",
    attachTo: "character",
    behavior: { abilities: [{ id: "n", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -3 }] }] }
  });
  const owner = o.bribeOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "br", def: printing(BRIBE), owner, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2 }), owner: P1, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther", strength: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4 }), owner: P2, zone: "play" },
      { key: "foeZero", def: character({ name: "FoeZero", strength: 0 }), owner: P2, zone: "play" },
      { key: "foeBig", def: character({ name: "FoeBig", strength: 9, life: 9 }), owner: P2, zone: "play" },
      { key: "foeBuffed", def: character({ name: "FoeBuffed", strength: 3 }), owner: P2, zone: "play" },
      { key: "buff", def: buff, owner: P2, zone: "play", attachedToKey: "foeBuffed" },
      { key: "foeNerfed", def: character({ name: "FoeNerfed", strength: 1 }), owner: P2, zone: "play" },
      { key: "nerf", def: nerf, owner: P2, zone: "play", attachedToKey: "foeNerfed" },
      { key: "stolen", def: character({ name: "Stolen", strength: 3 }), owner: P2, controller: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", strength: 6 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", strength: 6 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", strength: 6 }), owner: P2, zone: "discard" },
      ...bank("greed", o.greed ?? 3, owner),
      ...bank("rage", o.rage ?? 0, owner)
    ]
  });
}

const bribePlay = (b: ReturnType<typeof bribeBoard>, key: string) => play(b.engine, P1, b.id("br"), { selected: { c: [b.id(key)] } });

clause(BRIBE, "0:ability", "destroys the picked opponent character and your opponent's faction gains X = its strength (4)", () => {
  const b = bribeBoard();
  const before = ready(b.engine);
  bribePlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(influenceOf(b.engine, P2), 24, "the opponent's faction gains 4");
  assert.equal(influenceOf(b.engine, P1), 20, "yours is untouched");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(b.engine, b.id("br")), "discard", "the tactic goes to the discard pile");
  assert.equal(zoneOf(b.engine, b.id("foeZero")), "play", "no other character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("foeBig")), "play");
});

clause(BRIBE, "0:ability", "X follows the strength: strength 9 gives the opponent 9 influence", () => {
  const b = bribeBoard();
  bribePlay(b, "foeBig");
  assert.equal(zoneOf(b.engine, b.id("foeBig")), "discard");
  assert.equal(influenceOf(b.engine, P2), 29);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(BRIBE, "0:ability", "you can pick your own character: it is destroyed and the OPPONENT's faction still gains X (its strength 2)", () => {
  const b = bribeBoard();
  bribePlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(influenceOf(b.engine, P2), 22, "'your opponent's faction' gains 2");
  assert.equal(influenceOf(b.engine, P1), 20, "your own faction gains nothing");
});

clause(BRIBE, "0:ability", "a character you control but do not own can be picked: it goes to its owner's discard pile and the opponent (of the caster) gains X", () => {
  const b = bribeBoard();
  bribePlay(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("stolen")), "owner P2's discard pile");
  assert.equal(influenceOf(b.engine, P2), 23, "'your opponent's faction' = P2's faction gains 3");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(BRIBE, "0:ability", "a character with 0 strength is destroyed and the opponent gains nothing", () => {
  const b = bribeBoard();
  bribePlay(b, "foeZero");
  assert.equal(zoneOf(b.engine, b.id("foeZero")), "discard");
  assert.equal(influenceOf(b.engine, P2), 20);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(BRIBE, "0:ability", "X is the character's current strength including bonuses: base 3 plus an attached +2 gives 5", () => {
  const b = bribeBoard();
  assert.equal(b.engine.getStat(b.id("foeBuffed"), "strength"), 5, "control");
  bribePlay(b, "foeBuffed");
  assert.equal(zoneOf(b.engine, b.id("foeBuffed")), "discard");
  assert.equal(influenceOf(b.engine, P2), 25);
});

clause(BRIBE, "0:ability", "X is never negative: a character pushed below 0 strength gives X = 0 (the opponent loses nothing)", () => {
  const b = bribeBoard();
  assert.ok(b.engine.getStat(b.id("foeNerfed"), "strength") <= 0, "control: strength 1 - 3 is 0 or below");
  bribePlay(b, "foeNerfed");
  assert.equal(zoneOf(b.engine, b.id("foeNerfed")), "discard");
  assert.equal(influenceOf(b.engine, P2), 20, "CR 410.4: a number pushed below 0 stays at 0");
});

clause(BRIBE, "0:ability", "the pick must be a character in play: not a faction, item, location, face-down card, or a card in hand or discard", () => {
  const b = bribeBoard();
  const attempt = (id: string) => () => playRaw(b.engine, P1, b.id("br"), { selected: { c: [id] } });
  refused(attempt(factionOf(b.engine, P1)), "your faction (CR 202.9)");
  refused(attempt(factionOf(b.engine, P2)), "their faction (CR 202.9)");
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("br")), "hand", "nothing was played");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(BRIBE, "0:ability", "exactly one character: none and two are refused", () => {
  const b = bribeBoard();
  refused(() => playRaw(b.engine, P1, b.id("br"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("br"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe"), b.id("mine")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("br")), "hand");
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  assert.ok(b.engine.state.responseWindow, "control: exactly one is accepted");
});

clause(BRIBE, "0:ability", "is refused one resource short of its cost of 3, and without [G][G] even with enough other resources", () => {
  const short = bribeBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("br"), { selected: { c: [short.id("foe")] } }), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");
  assert.equal(zoneOf(short.engine, short.id("br")), "hand");

  const noThreshold = bribeBoard({ greed: 1, rage: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("br"), { selected: { c: [noThreshold.id("foe")] } }), "one [G] is not [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("br")), "hand");

  const exact = bribeBoard({ greed: 2, rage: 1 });
  bribePlay(exact, "foe");
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "[G][G] plus one other resource is enough");
});

clause(BRIBE, "0:ability", "X is fixed when the character is picked (a cost): weakening it in response does not lower what the opponent gains", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "debuff", def: debuffTactic(3), owner: P2, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("debuff"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: the Bribe resolved");
  assert.equal(influenceOf(b.engine, P2), 24, "X was 4 when the character was picked, not 1 after the response");
});

clause(BRIBE, "0:ability", "X is fixed when the character is picked (a cost): strengthening it in response does not raise what the opponent gains", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "buff", def: buffTactic(5), owner: P2, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("buff"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: the Bribe resolved");
  assert.equal(influenceOf(b.engine, P2), 22, "X was 2 when the character was picked, not 7 after the response");
});

clause(BRIBE, "0:ability", "if the picked character is destroyed in response, the opponent still gains X (the instruction does not fizzle)", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: it was destroyed by the response");
  assert.equal(zoneOf(b.engine, b.id("br")), "discard");
  assert.equal(influenceOf(b.engine, P2), 24, "the Bribe still resolves: X was fixed at 4 (CR 402.5a)");
});

clause(BRIBE, "0:ability", "nothing is destroyed or gained before the Bribe resolves; the cost (pick and payment) is paid when it is played", () => {
  const b = bribeBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  assert.equal(before - ready(b.engine), 3, "paid up front");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "still in play while the opponent may respond");
  assert.equal(influenceOf(b.engine, P2), 20, "no gain yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(influenceOf(b.engine, P2), 24);
});

clause(BRIBE, "0:ability", "the opponent can play it too: then 'your opponent's faction' is the caster's opponent, who gains X", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 9 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("atk")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "the attacker was destroyed in response to its own attack");
  assert.equal(influenceOf(b.engine, P2), 23, "the caster's opponent (P2) gains X = 3");
  assert.equal(influenceOf(b.engine, P1), 20);
});

// =============================================================================
// Keen Stratagem (2nd Edition)
// Search your deck for a staple resource and reveal it. Put it into your hand.
// Tactic, banker, cost 1, [G].
// =============================================================================

const STRATAGEM = "7a8cb27e-6cf9-41ed-b051-a69557c821df";

const stapleCard = (name: string, icon: "rage" | "greed" | "deception" | "elitism" | "obsession"): CardDefinition =>
  resourceCard({ name, resource: { provides: [icon], staple: true } });

const STAPLES = [
  ["rage", "Rage"],
  ["greed", "Greed"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as const;

/** P1 holds the Stratagem and 1 [G]; the deck is (top to bottom) a non-staple resource, two characters, the five staples, a spare Greed and a character. */
function stratagemBoard(
  opts: { deck?: "full" | "noStaples" | "empty"; greed?: number; random?: () => number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const deck: CardPlacement[] =
    opts.deck === "empty"
      ? []
      : [
          { key: "fancy", def: resourceCard({ name: "Fancy Resource", resource: { provides: ["greed"], staple: false } }), owner: P1, zone: "deck" },
          { key: "dc1", def: character({ name: "Deck Char 1" }), owner: P1, zone: "deck" },
          { key: "dc2", def: character({ name: "Deck Char 2" }), owner: P1, zone: "deck" },
          ...(opts.deck === "noStaples"
            ? []
            : [
                ...STAPLES.map(([icon, name]) => ({ key: `s_${icon}`, def: stapleCard(name, icon), owner: P1, zone: "deck" as const })),
                { key: "s_greed2", def: stapleCard("Greed", "greed"), owner: P1, zone: "deck" as const }
              ]),
          { key: "dc3", def: character({ name: "Deck Char 3" }), owner: P1, zone: "deck" }
        ];
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    random: opts.random ?? (() => 0.5),
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ks", def: printing(STRATAGEM), owner: P1, zone: "hand" },
      { key: "inHandStaple", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" },
      { key: "inDiscardStaple", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" },
      { key: "oppStaple", def: stapleCard("Greed", "greed"), owner: P2, zone: "deck" },
      { key: "oppChar", def: character({ name: "Opp Char" }), owner: P2, zone: "deck" },
      ...deck,
      ...bank("greed", opts.greed ?? 1, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the Stratagem and, if a pick opens, answers it with `pickKey` (nothing when undefined). */
function stratagem(game: ReturnType<typeof stratagemBoard>, pickKey?: string): void {
  play(game.engine, P1, game.id("ks"));
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "I search my own deck");
    answerPending(game.engine, "chooserSelectsTarget", { selected: pickKey ? [game.id(pickKey)] : [] });
  }
}

for (const [icon, name] of STAPLES) {
  clause(STRATAGEM, "0:rule", `finds a staple resource (${name}) in my deck and puts it into my hand, and nothing else`, () => {
    const game = stratagemBoard();
    const deckBefore = deckOf(game.engine, P1).length;
    const handBefore = handOf(game.engine, P1).length;
    stratagem(game, `s_${icon}`);
    assert.equal(zoneOf(game.engine, game.id(`s_${icon}`)), "hand");
    assert.equal(controllerOf(game.engine, game.id(`s_${icon}`)), P1);
    assert.equal(deckBefore - deckOf(game.engine, P1).length, 1, "exactly one card left the deck");
    assert.equal(handOf(game.engine, P1).length, handBefore, "the tactic left my hand, the staple came in");
    assert.equal(zoneOf(game.engine, game.id("ks")), "discard", "the tactic goes to the discard pile");
    assert.equal(zoneOf(game.engine, game.id("fancy")), "deck", "the other resource card stays in the deck");
  });
}

clause(STRATAGEM, "0:rule", "it is revealed: a 'cards revealed' event names the found card", () => {
  const game = stratagemBoard();
  stratagem(game, "s_rage");
  const reveals = game.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.ok(
    reveals.some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(game.id("s_rage"))),
    "the found Rage was revealed"
  );
});

clause(STRATAGEM, "0:rule", "nothing is revealed when the search is failed", () => {
  const game = stratagemBoard();
  stratagem(game, undefined);
  const reveals = game.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 0, "no reveal when nothing was found");
});

clause(STRATAGEM, "0:rule", "a staple resource only: a non-staple resource card and ordinary cards in my deck are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: CardInstanceId) => () =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(game.id("fancy")), "a resource card that is not a staple");
  refused(attempt(game.id("dc1")), "a character");
  refused(attempt(game.id("dc3")), "another character");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  attempt(game.id("s_elitism"))();
  assert.equal(zoneOf(game.engine, game.id("s_elitism")), "hand", "control: a staple is accepted");
});

clause(STRATAGEM, "0:rule", "only MY deck is searched: staples in the opponent's deck, my hand and my discard pile are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  const attempt = (cardId: CardInstanceId) => () =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(game.id("oppStaple")), "a staple in the opponent's deck");
  refused(attempt(game.id("inHandStaple")), "a staple already in my hand");
  refused(attempt(game.id("inDiscardStaple")), "a staple in my discard pile");
  attempt(game.id("s_greed2"))();
  assert.equal(zoneOf(game.engine, game.id("s_greed2")), "hand", "control: the spare Greed in my deck is fine");
});

clause(STRATAGEM, "0:rule", "a staple already in play is not in the deck and cannot be found", () => {
  const game = stratagemBoard({ extra: [{ key: "inPlayStaple", def: stapleCard("Greed", "greed"), owner: P1, zone: "play" }] });
  play(game.engine, P1, game.id("ks"));
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("inPlayStaple")] } } as never),
    "a staple in play"
  );
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("s_rage")] });
  assert.equal(zoneOf(game.engine, game.id("s_rage")), "hand");
  assert.equal(zoneOf(game.engine, game.id("inPlayStaple")), "play");
});

clause(STRATAGEM, "0:rule", "exactly one card: two staples are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  refused(
    () =>
      game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("s_rage"), game.id("s_greed")] } } as never),
    "two staples"
  );
  assert.equal(zoneOf(game.engine, game.id("s_rage")), "deck");
  assert.equal(zoneOf(game.engine, game.id("s_greed")), "deck");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("s_rage")] });
  assert.equal(zoneOf(game.engine, game.id("s_rage")), "hand", "control: one is fine");
});

clause(STRATAGEM, "0:rule", "I may fail the search (CR 312.2): picking nothing leaves my hand alone", () => {
  const game = stratagemBoard();
  const handBefore = handOf(game.engine, P1).length;
  const deckBefore = deckOf(game.engine, P1).length;
  stratagem(game, undefined);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "only the tactic left my hand");
  assert.equal(deckOf(game.engine, P1).length, deckBefore);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "a deck with no staple resource: nothing to find, the tactic still resolves", () => {
  const game = stratagemBoard({ deck: "noStaples" });
  const handBefore = handOf(game.engine, P1).length;
  stratagem(game, undefined);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "an empty deck: nothing breaks", () => {
  const game = stratagemBoard({ deck: "empty" });
  stratagem(game, undefined);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "a searched deck is shuffled afterwards (CR 312.1): the remaining cards are reordered", () => {
  const game = stratagemBoard({ random: () => 0 });
  const before = [...deckOf(game.engine, P1)];
  stratagem(game, "s_rage");
  const remaining = before.filter((card) => card !== game.id("s_rage"));
  assert.deepEqual(sorted(deckOf(game.engine, P1)), sorted(remaining), "the same cards remain");
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(remaining, 0), "in a freshly shuffled order");
  assert.notDeepEqual(deckOf(game.engine, P1), remaining, "which is not the old order");
});

clause(STRATAGEM, "0:rule", "the deck is shuffled even when I fail the search (CR 312.1)", () => {
  const game = stratagemBoard({ random: () => 0 });
  const before = [...deckOf(game.engine, P1)];
  stratagem(game, undefined);
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(before, 0), "a searched deck is shuffled whether or not anything was found");
});

clause(STRATAGEM, "0:rule", "the deck is shuffled even when it holds no staple at all (CR 312.1)", () => {
  const game = stratagemBoard({ deck: "noStaples", random: () => 0 });
  const before = [...deckOf(game.engine, P1)];
  stratagem(game, undefined);
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(before, 0), "a search that finds nothing still shuffles");
});

clause(STRATAGEM, "0:rule", "the opponent's deck is not touched (not searched, not shuffled)", () => {
  const game = stratagemBoard({ random: () => 0 });
  const oppBefore = [...deckOf(game.engine, P2)];
  stratagem(game, "s_rage");
  assert.deepEqual(deckOf(game.engine, P2), oppBefore);
  assert.equal(deckOf(game.engine, P2).length, 2);
});

clause(STRATAGEM, "0:rule", "putting the staple into my hand is not drawing it: a Gold Summit gains nothing", () => {
  const game = stratagemBoard({ extra: [{ key: "summit", def: printing(SUMMIT), owner: P1, zone: "play" }] });
  stratagem(game, "s_rage");
  assert.equal(zoneOf(game.engine, game.id("s_rage")), "hand", "control: the staple was found");
  assert.equal(influenceOf(game.engine, P1), 20, "no cards were drawn");
});

clause(STRATAGEM, "0:rule", "the search happens when the tactic resolves, not while the opponent can still respond", () => {
  const game = stratagemBoard();
  playRaw(game.engine, P1, game.id("ks"));
  assert.equal(pending(game.engine), undefined, "no search yet");
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search opens when it resolves");
});

clause(STRATAGEM, "0:rule", "it can be played in response on the opponent's turn", () => {
  const game = stratagemBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  refused(() => playRaw(game.engine, P1, game.id("ks")), "nothing to respond to yet", /priority|window|respond|turn/i);
  playRaw(game.engine, P2, game.id("opp"));
  playRaw(game.engine, P1, game.id("ks"));
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("s_obsession")] });
  assert.equal(zoneOf(game.engine, game.id("s_obsession")), "hand");
  assert.equal(zoneOf(game.engine, game.id("opp")), "play");
});

clause(STRATAGEM, "0:rule", "costs 1 with [G]: pays exactly 1, refused with no resources or with only a non-[G] resource", () => {
  const exact = stratagemBoard({ greed: 1 });
  assert.equal(spentBy(exact.engine, P1, () => stratagem(exact, "s_rage")), 1, "pays exactly 1");
  const more = stratagemBoard({ greed: 3 });
  assert.equal(spentBy(more.engine, P1, () => stratagem(more, "s_rage")), 1, "pays exactly 1 even with more available");
  const none = stratagemBoard({ greed: 0 });
  refused(() => playRaw(none.engine, P1, none.id("ks")), "no resources");
  assert.equal(zoneOf(none.engine, none.id("ks")), "hand");
  const rage = stratagemBoard({ greed: 0, extra: bank("rage", 3, P1) });
  refused(() => playRaw(rage.engine, P1, rage.id("ks")), "no [G]");
  assert.equal(zoneOf(rage.engine, rage.id("ks")), "hand");
});

// =============================================================================
// Limited Liability (2nd Edition)
// This turn, cards can only be destroyed by costs, and all inflicted damage is
// reduced to 0.
// Tactic, banker, cost 2, [G].
// =============================================================================

const LIABILITY = "5f4ac8a0-c748-40dd-b591-1afabeb306fa";

/** A free tactic (id "d", pick "t") dealing `amount` damage to a chosen card of `type` in play. */
function damageOn(type: "character" | "location" | "faction", amount: number): CardDefinition {
  return tactic({
    name: `Damage${type}${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "k", pick "t") destroying a chosen card of `type` in play. */
function destroyOn(type: "character" | "item" | "location", name = `Destroy ${type}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic making the opponent's faction lose `amount` influence (not damage). */
function drainTactic(amount: number): CardDefinition {
  return tactic({ name: `Drain${amount}`, cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -amount }] }] } });
}

function liabilityBoard(o: { turn?: number; active?: Pid; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic(), owner: P1, zone: "hand" },
      { key: "killItem", def: destroyOn("item"), owner: P1, zone: "hand" },
      { key: "killPlace", def: destroyOn("location"), owner: P1, zone: "hand" },
      { key: "shoot", def: damageOn("character", 5), owner: P1, zone: "hand" },
      { key: "shootPlace", def: damageOn("location", 5), owner: P1, zone: "hand" },
      { key: "shootFaction", def: damageOn("faction", 5), owner: P1, zone: "hand" },
      { key: "drain", def: drainTactic(3), owner: P1, zone: "hand" },
      { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 2, P1),
      ...(o.extra ?? [])
    ]
  });
}

const llPlay = (b: ReturnType<typeof liabilityBoard>) => play(b.engine, P1, b.id("ll"));

clause(LIABILITY, "0:rule", "pays exactly its printed cost of 2 with [G] and goes to the discard pile; one resource short or no [G] is refused", () => {
  const b = liabilityBoard({ greed: 3 });
  const before = ready(b.engine);
  llPlay(b);
  assert.equal(before - ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("ll")), "discard");
  const short = liabilityBoard({ greed: 1 });
  refused(() => playRaw(short.engine, P1, short.id("ll")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("ll")), "hand");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ll")), "no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ll")), "hand");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 1, P1)]
  });
  playRaw(oneG.engine, P1, oneG.id("ll"));
  assert.equal(oneG.engine.state.responseWindow !== undefined, true, "control: a single [G] plus one other resource is enough");
});

clause(LIABILITY, "0:rule", "all inflicted damage is reduced to 0: a damaging effect on a character does nothing", () => {
  const control = liabilityBoard();
  play(control.engine, P1, control.id("shoot"), { selected: { t: [control.id("foe")] } });
  assert.equal(zoneOf(control.engine, control.id("foe")), "discard", "control: without Limited Liability the 5 damage kills a 3-life character");
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("foe")] } });
  assert.equal(damageOf(b.engine, b.id("foe")), 0, "no damage marked");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(LIABILITY, "0:rule", "all inflicted damage includes damage to your own characters", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(LIABILITY, "0:rule", "all inflicted damage includes damage to a location", () => {
  const control = liabilityBoard();
  play(control.engine, P1, control.id("shootPlace"), { selected: { t: [control.id("place")] } });
  assert.equal(zoneOf(control.engine, control.id("place")), "discard", "control: 5 damage destroys a 2-structure location");
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shootPlace"), { selected: { t: [b.id("place")] } });
  assert.equal(damageOf(b.engine, b.id("place")), 0);
  assert.equal(zoneOf(b.engine, b.id("place")), "play");
});

clause(LIABILITY, "0:rule", "all inflicted damage includes damage to a faction: it normally costs influence, now it costs none", () => {
  const control = liabilityBoard();
  play(control.engine, P1, control.id("shootFaction"), { selected: { t: [factionOf(control.engine, P2)] } });
  assert.equal(influenceOf(control.engine, P2), 15, "control: without Limited Liability the same hit costs 5 influence");
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shootFaction"), { selected: { t: [factionOf(b.engine, P2)] } });
  assert.equal(influenceOf(b.engine, P2), 20);
});

clause(LIABILITY, "0:rule", "cards can only be destroyed by costs: a destroy effect on a character, item or location does nothing", () => {
  const control = liabilityBoard();
  play(control.engine, P1, control.id("kill"), { selected: { t: [control.id("foe")] } });
  play(control.engine, P1, control.id("killItem"), { selected: { t: [control.id("thing")] } });
  play(control.engine, P1, control.id("killPlace"), { selected: { t: [control.id("place")] } });
  assert.equal(zoneOf(control.engine, control.id("foe")), "discard", "control: without Limited Liability the kill works");
  assert.equal(zoneOf(control.engine, control.id("thing")), "discard");
  assert.equal(zoneOf(control.engine, control.id("place")), "discard");

  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  play(b.engine, P1, b.id("killItem"), { selected: { t: [b.id("thing")] } });
  play(b.engine, P1, b.id("killPlace"), { selected: { t: [b.id("place")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "a character cannot be destroyed");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play", "nor an item");
  assert.equal(zoneOf(b.engine, b.id("place")), "play", "nor a location");
  assert.equal(zoneOf(b.engine, b.id("kill")), "discard", "control: the destroy tactics did resolve (they are in the discard pile)");
});

clause(LIABILITY, "0:rule", "it protects both players' cards: my own character cannot be destroyed either", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(LIABILITY, "0:rule", "it covers cards that enter play after it: a character deployed afterwards cannot be destroyed or damaged this turn", () => {
  const b = liabilityBoard({
    extra: [{ key: "late", def: character({ name: "Late", strength: 1, life: 2, cost: 0 }), owner: P1, zone: "hand" }]
  });
  llPlay(b);
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play", "control: it entered play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("late")] } });
  assert.equal(zoneOf(b.engine, b.id("late")), "play", "cannot be destroyed");
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("late")] } });
  assert.equal(damageOf(b.engine, b.id("late")), 0);
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
});

clause(LIABILITY, "0:rule", "damage in battle is reduced to 0 too: an unblocked attack on the faction costs it no influence", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(b.engine, P2), 20, "3 strength inflicted nothing");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "control: the battle did happen (the attacker is depleted)");
});

clause(LIABILITY, "0:rule", "damage in battle is reduced to 0: a blocked attack leaves the attacker and the blockers undamaged and alive", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, [b.id("foe"), b.id("foe2")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "3 + 1 damage would have killed my 3-life attacker");
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(damageOf(b.engine, b.id("foe")), 0);
  assert.equal(damageOf(b.engine, b.id("foe2")), 0);
  assert.equal(battleOf(b.engine), undefined, "control: the battle finished");
});

clause(LIABILITY, "0:rule", "damage in battle is reduced to 0: an attack on a location leaves it undamaged", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "card", cardId: b.id("place") }, []);
  assert.equal(damageOf(b.engine, b.id("place")), 0);
  assert.equal(zoneOf(b.engine, b.id("place")), "play", "3 damage would have destroyed the 2-structure location");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "control: the battle did happen");
});

clause(LIABILITY, "0:rule", "the opponent attacking into it: played in response to their attack nothing is hurt", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the blocker survived 4 damage");
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
  assert.equal(damageOf(b.engine, b.id("atk")), 0);
  assert.equal(influenceOf(b.engine, P1), 20);
  assert.equal(zoneOf(b.engine, b.id("ll")), "discard", "control: Limited Liability resolved");
});

clause(LIABILITY, "0:rule", "played in response to a damaging tactic, it stops that tactic's damage", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "shoot", def: damageOn("character", 5), owner: P2, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("shoot")), "discard", "control: the shot resolved");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the 5 damage inflicted nothing");
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
});

clause(LIABILITY, "0:rule", "played in response to a destroy tactic, it stops that tactic's destruction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("kill")), "discard", "control: the kill resolved");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(LIABILITY, "0:rule", "reduced damage triggers nothing (an attempt to inflict 0 damage inflicts nothing, CR 408.1)", () => {
  const retaliator = character({
    name: "Retaliator",
    strength: 1,
    life: 9,
    behavior: {
      abilities: [
        {
          id: "ret",
          type: "triggered",
          event: "damageDealt",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
        }
      ]
    }
  });
  const sink = tactic({ name: "Zap sink", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } });
  const probe = (withLimited: boolean) => {
    const b = liabilityBoard({ extra: [{ key: "ret", def: retaliator, owner: P1, zone: "play" }, { key: "sink", def: sink, owner: P1, zone: "hand" }] });
    if (withLimited) llPlay(b);
    play(b.engine, P1, b.id("sink"), { selected: { t: [b.id("ret")] } });
    return b;
  };
  const control = probe(false);
  assert.equal(damageOf(control.engine, control.id("ret")), 2, "control: the damage lands without Limited Liability");
  const b = probe(true);
  assert.equal(damageOf(b.engine, b.id("ret")), 0, "reduced to 0");
});

clause(LIABILITY, "0:rule", "losing influence is not damage: a 'loses influence' effect still works", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("drain"));
  assert.equal(influenceOf(b.engine, P2), 17, "the opponent's faction lost 3 influence (CR 408.3b)");
});

clause(LIABILITY, "0:rule", "it only stops destroying and damage: moving a card to a hand is not affected", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(LIABILITY, "0:rule", "cards can be destroyed by costs: a cost that destroys a card still destroys it", () => {
  const sacItem = item({
    name: "SacItem",
    behavior: { abilities: [{ id: "sac", type: "activated", costs: [{ type: "destroy", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "sac", def: sacItem, owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  activate(b.engine, P1, b.id("sac"), "sac");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the cost destroyed the item even under Limited Liability");
  assert.equal(deckOf(b.engine, P1).length, 2, "and the ability's effect resolved");
});

clause(LIABILITY, "0:rule", "a character can be destroyed by a cost too (its own ability's destroy-this-card cost)", () => {
  const martyr = character({
    name: "Martyr",
    life: 3,
    behavior: { abilities: [{ id: "sac", type: "activated", costs: [{ type: "destroy", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "martyr", def: martyr, owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  activate(b.engine, P1, b.id("martyr"), "sac");
  assert.equal(zoneOf(b.engine, b.id("martyr")), "discard", "destroyed as a cost");
  assert.equal(deckOf(b.engine, P1).length, 2, "the effect resolved");
});

clause(LIABILITY, "0:rule", "all inflicted damage is reduced to 0 even when the damage is a COST (literal reading: no exception for damage)", () => {
  const siphon = location({
    name: "Siphon",
    structure: 3,
    behavior: { abilities: [{ id: "sip", type: "activated", costs: [{ type: "dealDamage", target: "source", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "sip", def: siphon, owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  activate(b.engine, P1, b.id("sip"), "sip");
  assert.equal(deckOf(b.engine, P1).length, 2, "control: the ability resolved");
  assert.equal(damageOf(b.engine, b.id("sip")), 0, "the damage that was a cost is inflicted damage, reduced to 0");
});

clause(LIABILITY, "0:rule", "damage already on a card before Limited Liability stays on it (it is not healed)", () => {
  const b = liabilityBoard();
  b.engine.state.cards[b.id("foe")].damage = 2;
  llPlay(b);
  assert.equal(damageOf(b.engine, b.id("foe")), 2);
});

clause(LIABILITY, "0:rule", "cards can only be destroyed by costs: a character that would die because its life drops below its damage survives", () => {
  const shrink = tactic({
    name: "Shrink",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: -2, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "shrink", def: shrink, owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play", damage: 2 },
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  play(b.engine, P1, b.id("shrink"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 1, "control: its life is now 1 with 2 damage on it");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "but cards can only be destroyed by costs this turn");
});

clause(LIABILITY, "0:rule", "it lasts this turn only: on the next turn damage and destruction work again", () => {
  const b = liabilityBoard({ turn: 1 });
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "protected this turn");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(b.engine, b.id("shoot")), "hand", "control: the next turn's damage tactic is still in hand");
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "damage works again on the next turn");
  assert.equal(influenceOf(b.engine, P2), 20);
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("foe2")] } });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard", "destruction works again on the next turn too");
  play(b.engine, P1, b.id("shootFaction"), { selected: { t: [factionOf(b.engine, P2)] } });
  assert.equal(influenceOf(b.engine, P2), 15, "faction damage works again too");
});

clause(LIABILITY, "0:rule", "played on the opponent's turn it lasts for the rest of that turn and ends when the next turn starts", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "shoot", def: damageOn("character", 5), owner: P2, zone: "hand" },
      { key: "shoot2", def: damageOn("character", 5), owner: P2, zone: "hand" },
      { key: "shoot3", def: damageOn("character", 5), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  play(b.engine, P2, b.id("shoot2"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "still protected for the rest of that turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("shoot3"), { selected: { t: [b.id("mine2")] } });
  assert.equal(zoneOf(b.engine, b.id("mine2")), "discard", "no longer protected on the next turn");
});

// --- shared "when this card enters play" bodies --------------------------------
// Used by every character here whose trigger is an enters-play effect.
// `delta` is the signed influence change for the controller's faction.

interface EtbOptions {
  owner?: Pid;
  influence?: number;
  deck?: number;
  zone?: "hand" | "discard" | "play";
  greed?: number;
  rage?: number;
  elitism?: number;
  extra?: CardPlacement[];
}

/** A free tactic (id "r", pick "t") putting a character from your discard pile into play ("put into play", not "deployed"). */
function raiserTactic(): CardDefinition {
  return tactic({
    name: "Raiser",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/**
 * The subject card (`subject`) with a bank of resources for its owner (`icon`, default greed), a free filler
 * character in hand (`freebie`), and the opposing side. Both factions start at 20 influence.
 */
function etbBoard(printingId: string, o: EtbOptions & { icon?: StapleIcon } = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  const def = printing(printingId);
  const icon = o.icon ?? "greed";
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: owner,
    cards: [
      { key: "subject", def, owner, zone: o.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: foe, zone: "play" },
      { key: "bounce", def: moverTactic("hand"), owner, zone: "hand" },
      { key: "raise", def: raiserTactic(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...fillers("d", o.deck ?? 4, owner, "deck"),
      ...fillers("e", 4, foe, "deck"),
      ...bank(icon, o.greed ?? def.cost + 1, owner),
      ...(o.extra ?? [])
    ]
  });
  if (o.influence !== undefined) b.engine.state.players[owner].influence = o.influence;
  return b;
}

/** Deploying it pays exactly its printed cost, gives it its printed stats, and applies the influence change to the controller's faction only. */
function etbDeploys(printingId: string, delta: number, expect: { cost: number; strength: number; speed: number; life: number }, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { icon });
  const readyBefore = ready(b.engine);
  play(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(readyBefore - ready(b.engine), expect.cost, "the printed cost is paid");
  assert.equal(b.engine.getStat(b.id("subject"), "strength"), expect.strength);
  assert.equal(b.engine.getStat(b.id("subject"), "life"), expect.life);
  assert.equal(b.engine.getStat(b.id("subject"), "speed"), expect.speed);
  assert.equal(influenceOf(b.engine, P1), 20 + delta, "your faction's influence changes by exactly the printed amount");
  assert.equal(influenceOf(b.engine, P2), 20, "the opponent's faction is untouched");
}

/** Nothing happens while the card is still being deployed (the opponent may respond); it happens when the card enters play. */
function etbWaitsForEntering(printingId: string, delta: number, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { icon });
  playRaw(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "deploying");
  assert.equal(influenceOf(b.engine, P1), 20, "not yet: the card has not entered play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influenceOf(b.engine, P1), 20 + delta, "applied once it has entered play");
}

/** A different character entering play, the card sitting in hand or already in play, or the card leaving play: none of these trigger it. */
function etbNearMisses(printingId: string, icon: StapleIcon = "greed"): void {
  const inHand = etbBoard(printingId, { icon });
  play(inHand.engine, P1, inHand.id("freebie"));
  assert.equal(zoneOf(inHand.engine, inHand.id("freebie")), "play", "control: another character really entered play");
  assert.equal(influenceOf(inHand.engine, P1), 20, "another character entering play does not trigger it (card in hand)");
  assert.equal(handOf(inHand.engine, P1).includes(inHand.id("subject")), true);

  const inPlay = etbBoard(printingId, { zone: "play", icon });
  assert.equal(influenceOf(inPlay.engine, P1), 20, "a card already in play has not triggered");
  play(inPlay.engine, P1, inPlay.id("freebie"));
  assert.equal(influenceOf(inPlay.engine, P1), 20, "another character entering play does not trigger it (card in play)");
  play(inPlay.engine, P1, inPlay.id("kill"), { selected: { t: [inPlay.id("subject")] } });
  assert.equal(zoneOf(inPlay.engine, inPlay.id("subject")), "discard", "control: it left play");
  assert.equal(influenceOf(inPlay.engine, P1), 20, "leaving play does not trigger it");
}

/** It triggers every time it enters play: deploy, bounce, deploy again. */
function etbEveryEntry(printingId: string, delta: number, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { greed: 20, icon });
  play(b.engine, P1, b.id("subject"));
  assert.equal(influenceOf(b.engine, P1), 20 + delta);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("subject")] } });
  assert.equal(zoneOf(b.engine, b.id("subject")), "hand", "control: it returned to hand");
  assert.equal(influenceOf(b.engine, P1), 20 + delta, "returning to hand changes nothing");
  play(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influenceOf(b.engine, P1), 20 + 2 * delta, "entering play a second time triggers it again");
}

/** Put into play by an effect (never deployed) it still "enters play". */
function etbPutIntoPlay(printingId: string, delta: number, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { zone: "discard", icon });
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("subject")] } });
  assert.equal(zoneOf(b.engine, b.id("subject")), "play", "control: it was put into play");
  assert.equal(influenceOf(b.engine, P1), 20 + delta, "entering play by an effect triggers it");
}

/** "Your faction": when the opponent controls the card it is THEIR faction that is affected. */
function etbOpponentControlled(printingId: string, delta: number, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { owner: P2, icon });
  play(b.engine, P2, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influenceOf(b.engine, P2), 20 + delta, "the controller's faction changes");
  assert.equal(influenceOf(b.engine, P1), 20, "the other player's faction does not");
}

/** Losing influence: with exactly that much influence the faction hits 0 and its owner loses; with one more it survives on 1. */
function etbInfluenceLoss(printingId: string, loss: number, icon: StapleIcon = "greed"): void {
  const exact = etbBoard(printingId, { influence: loss, icon });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(influenceOf(exact.engine, P1), 0);
  assert.deepEqual(exact.engine.state.result, { outcome: "victory", winners: [P2] }, "a faction at 0 influence loses (CR 102)");

  const spare = etbBoard(printingId, { influence: loss + 1, icon });
  play(spare.engine, P1, spare.id("subject"));
  assert.equal(influenceOf(spare.engine, P1), 1);
  assert.equal(spare.engine.state.result, undefined, "one influence left: still in the game");
}

/** Played face-down as a resource (the Develop Rule), the card has no rules text: its enters-play effect does not happen. */
function etbFaceDown(printingId: string, icon: StapleIcon = "greed"): void {
  const b = etbBoard(printingId, { icon });
  const deckBefore = deckOf(b.engine, P1).length;
  developPlay(b.engine, P1, b.id("subject"), true);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("subject")), "play", "control: it is in play");
  assert.equal(isFaceDown(b.engine, b.id("subject")), true, "face-down");
  assert.equal(b.engine.getThresholds(P1).volition, 1, "as a resource it provides Volition");
  assert.equal(influenceOf(b.engine, P1), 20, "its enters-play effect did not happen");
  assert.equal(influenceOf(b.engine, P2), 20);
  assert.equal(deckOf(b.engine, P1).length, deckBefore, "nothing was drawn");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked");
}

// =============================================================================
// Mafia Lawyer (2nd Edition)
// When this card enters play, your faction loses 2 influence.
// If this card is destroyed during a battle, your faction gains X influence,
// where X is the total strength of the opposing party.
// Character (mercenary, lawyer, mau), banker, cost 4, [G][G], 3/3/3.
// =============================================================================

const MAFIA = "59065641-f55b-4ed9-a4db-bebf960ad677";

clause(MAFIA, "0:rule", "deploying it pays 4, gives 3 strength / 3 speed / 3 life, and costs your faction exactly 2 influence (the opponent's is untouched)", () => etbDeploys(MAFIA, -2, { cost: 4, strength: 3, speed: 3, life: 3 }));
clause(MAFIA, "0:rule", "the influence is lost when it enters play, not while it is still being deployed", () => etbWaitsForEntering(MAFIA, -2));
clause(MAFIA, "0:rule", "another character entering play, or the Lawyer leaving play, loses no influence", () => etbNearMisses(MAFIA));
clause(MAFIA, "0:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 4 in total)", () => etbEveryEntry(MAFIA, -2));
clause(MAFIA, "0:rule", "put into play by an effect it still costs 2 influence", () => etbPutIntoPlay(MAFIA, -2));
clause(MAFIA, "0:rule", "'your faction' is the controller's: the opponent's Lawyer costs the opponent 2, not me", () => etbOpponentControlled(MAFIA, -2));
clause(MAFIA, "0:rule", "with exactly 2 influence you hit 0 and lose; with 3 you survive on 1", () => etbInfluenceLoss(MAFIA, 2));
clause(MAFIA, "0:rule", "is refused one resource short of 4, and without [G][G]; fine with exactly [G][G] plus two other resources", () => {
  const short = etbBoard(MAFIA, { greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("subject")), "three resources are one short");
  assert.equal(zoneOf(short.engine, short.id("subject")), "hand");
  const noThreshold = etbBoard(MAFIA, { greed: 1, extra: bank("rage", 6, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "one [G] is not [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("subject")), "hand");
  const exact = etbBoard(MAFIA, { greed: 2, extra: bank("rage", 2, P1) });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play", "[G][G] and two more is enough");
});

/** P2 attacks P1's faction (or location) with attackers of the given strengths; the Lawyer (P1, 3/3/3) can block. Attackers are tough so they survive the Lawyer's 3 damage. */
function mafiaBlockBoard(atkStrengths: number[], o: { buffFirst?: number; nerfFirst?: number } = {}) {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: o.buffFirst ?? o.nerfFirst ?? 0 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "frail", def: character({ name: "Frail", strength: 1, life: 2 }), owner: P1, zone: "play" },
      ...atkStrengths.map((strength, i) => ({ key: `atk${i}`, def: character({ name: `Atk${i}`, strength, life: 9 }), owner: P2, zone: "play" as const })),
      ...(o.buffFirst || o.nerfFirst ? [{ key: "buff", def: buff, owner: P2, zone: "play" as const, attachedToKey: "atk0" }] : []),
      { key: "place", def: location({ name: "Place", structure: 20 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
}

clause(MAFIA, "1:rule", "destroyed while blocking: its controller's faction gains the opposing (attacking) party's strength (a single attacker of 4)", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: it was destroyed by 4 damage");
  assert.equal(influenceOf(b.engine, P1), 24, "gains X = 4");
  assert.equal(influenceOf(b.engine, P2), 20, "the opponent's faction is untouched");
});

clause(MAFIA, "1:rule", "X is the TOTAL strength of the opposing party: a party of 4 + 2 gives 6", () => {
  const b = mafiaBlockBoard([4, 2]);
  fight(b.engine, P2, [b.id("atk0"), b.id("atk1")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influenceOf(b.engine, P1), 26, "gains X = 4 + 2");
});

clause(MAFIA, "1:rule", "X counts only the OPPOSING party: allies fighting beside the Lawyer are not added", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml"), b.id("ally")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer died");
  assert.equal(influenceOf(b.engine, P1), 24, "X = 4, not 4 + the ally's 1");
});

clause(MAFIA, "1:rule", "X is the opposing party's current strength, bonuses included", () => {
  const b = mafiaBlockBoard([4], { buffFirst: 2 });
  assert.equal(b.engine.getStat(b.id("atk0"), "strength"), 6, "control");
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influenceOf(b.engine, P1), 26, "X = 6");
});

clause(MAFIA, "1:rule", "X never counts a negative strength: a party member pushed to -2 counts as 0 (CR 410.4), so 4 + (-2) gives 4", () => {
  const b = mafiaBlockBoard([1, 4], { nerfFirst: -3 });
  assert.ok(b.engine.getStat(b.id("atk0"), "strength") <= 0, "control: the first attacker is at 0 or below");
  fight(b.engine, P2, [b.id("atk0"), b.id("atk1")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer was destroyed");
  assert.equal(influenceOf(b.engine, P1), 24, "X = 0 + 4");
});

clause(MAFIA, "1:rule", "also works when the attack is on a location and the Lawyer blocks", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "card", cardId: b.id("place") }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influenceOf(b.engine, P1), 24);
});

clause(MAFIA, "1:rule", "destroyed while ATTACKING: X is the strength of the blocking party (4 + 2)", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "b0", def: character({ name: "B0", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 2, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("ml"), b.id("ally")], { type: "faction", playerId: P2 }, [b.id("b0"), b.id("b1")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer was destroyed in the battle");
  assert.equal(influenceOf(b.engine, P1), 26, "X = 4 + 2, the blocking party's strength; the ally's 1 is not counted");
  assert.equal(influenceOf(b.engine, P2), 20);
});

clause(MAFIA, "1:rule", "if it survives the battle nothing is gained", () => {
  const b = mafiaBlockBoard([2]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "play", "control: 2 damage does not kill a 3-life Lawyer");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "it triggers off ITSELF: another of my characters destroyed in a battle gains me nothing (the Lawyer is at home)", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("frail")]);
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "control: the frail ally died in the battle");
  assert.equal(zoneOf(b.engine, b.id("ml")), "play", "the Lawyer was not in the battle");
  assert.equal(influenceOf(b.engine, P1), 20, "only the Lawyer's own destruction pays");
});

clause(MAFIA, "1:rule", "destroyed outside a battle (a destroy effect in your main phase) it gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ml")] } });
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "the influence goes to the Lawyer's controller: an opponent's Lawyer destroyed in battle gains its controller, not me", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P1, zone: "play" },
      { key: "ml", def: printing(MAFIA), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influenceOf(b.engine, P2), 24, "its controller gains 4");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "destroyed by a tactic during the battle it is blocking in: that is 'destroyed during a battle', X = the attacking party's strength", () => {
  const b = mafiaBlockBoard([4]);
  declareAttackBy(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 });
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("ml")] });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer was destroyed by the tactic");
  assert.equal(influenceOf(b.engine, P1), 24, "destroyed during the battle: gains the opposing party's strength 4");
});

clause(MAFIA, "1:rule", "a Lawyer attacking unblocked and destroyed by a tactic in the declaration window faces no opposing party yet: X is 0", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  declareAttackOpenWindow(b.engine, P1, [b.id("ml")], { type: "faction", playerId: P2 });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer was destroyed");
  assert.equal(influenceOf(b.engine, P1), 20, "no blocking party exists yet: total strength 0, nothing gained (and the unblocked defender's 5 strength is not counted)");
});

clause(MAFIA, "1:rule", "a Lawyer that is not in the battle is not 'destroyed during a battle' it takes part in: destroying it with a tactic during someone else's battle gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: it was destroyed during the battle's response window");
  assert.equal(influenceOf(b.engine, P1), 20, "it was not part of the battle, so there is no opposing party and nothing is gained");
});

clause(MAFIA, "1:rule", "with a blocking party declared and the Lawyer not in it, destroying the Lawyer during that battle gains nothing (not both sides' strength added up)", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 });
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("blocker")] });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: it was destroyed during the battle");
  assert.equal(influenceOf(b.engine, P1), 20, "the Lawyer is in neither party: it faces no opposing party (and certainly not 4 + 2 = 6)");
});

clause(MAFIA, "1:rule", "X is the opposing party's strength even when the attackers die in the same damage step", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "the Lawyer took 4");
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "and the attacker took 3: both died together");
  assert.equal(influenceOf(b.engine, P1), 24, "the opposing party's total strength was 4 when the Lawyer was destroyed");
});

clause(MAFIA, "0:rule", "played face-down as a resource it is not a character and loses no influence", () => etbFaceDown(MAFIA));

// =============================================================================
// Moneychanger (2nd Edition)
// This card loses 1 strength and 1 life for each token on it.
// EXCHANGE -- COST: Deplete this card. Put a token on this card. EFFECT: Draw a card.
// Character (investor), banker, cost 3, [G][G], 2 strength / 3 speed / 2 life.
// =============================================================================

const MONEYCHANGER = "d67c9745-2f08-4f4a-a702-19ba5db75b44";

/** [strength, life, speed] */
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId): number[] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

function changerBoard(
  tokens: number,
  opts: { depleted?: boolean; deck?: number; turn?: number; active?: Pid; owner?: Pid; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mc", def: printing(MONEYCHANGER), owner, zone: "play", counters: tokens ? { token: tokens } : {}, depleted: opts.depleted },
      { key: "other", def: character({ name: "Other", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

for (const [tokens, strength, life] of [
  [0, 2, 2],
  [1, 1, 1]
] as const) {
  clause(MONEYCHANGER, "0:rule", `with ${tokens} token(s) it has ${strength} strength and ${life} life (speed unchanged at 3)`, () => {
    const { engine, id } = changerBoard(tokens);
    assert.deepEqual(statsOf(engine, id("mc")), [strength, life, 3]);
    assert.equal(zoneOf(engine, id("mc")), "play");
  });
}

clause(MONEYCHANGER, "0:rule", "the penalty applies to a Moneychanger the opponent controls just the same", () => {
  const { engine, id } = changerBoard(1, { owner: P2 });
  assert.deepEqual(statsOf(engine, id("mc")), [1, 1, 3]);
});

clause(MONEYCHANGER, "0:rule", "with 2 tokens its life is 0 and it is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = changerBoard(2);
  assert.equal(engine.getStat(id("mc"), "life"), 0, "control: 2 life - 2 tokens");
  settleState(engine);
  assert.equal(zoneOf(engine, id("mc")), "discard");
});

clause(MONEYCHANGER, "0:rule", "strength never goes below 0 (CR 410.4): with 3 tokens the penalty of 3 leaves 0 strength, not -1", () => {
  const { engine, id } = changerBoard(3);
  assert.equal(engine.getStat(id("mc"), "strength"), 0);
});

clause(MONEYCHANGER, "0:rule", "only its own tokens count: another card's tokens do not weaken it", () => {
  const { engine, id } = changerBoard(1);
  assert.deepEqual(statsOf(engine, id("mc")), [1, 1, 3]);
  assert.deepEqual(statsOf(engine, id("other")), [2, 5, 2], "the other character (3 tokens of its own) is unaffected");
});

clause(MONEYCHANGER, "0:rule", "the lost life is real: with 1 token (1 life) 1 damage destroys it, while with no token 1 damage does not", () => {
  const with1 = changerBoard(1, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(with1.engine, P1, with1.id("zap"), { selected: { t: [with1.id("mc")] } });
  assert.equal(zoneOf(with1.engine, with1.id("mc")), "discard");
  const with0 = changerBoard(0, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(with0.engine, P1, with0.id("zap"), { selected: { t: [with0.id("mc")] } });
  assert.equal(zoneOf(with0.engine, with0.id("mc")), "play");
  assert.equal(damageOf(with0.engine, with0.id("mc")), 1);
});

clause(MONEYCHANGER, "0:rule", "the lost strength is real: with 1 token a Moneychanger blocking deals 1 battle damage, with none it deals 2", () => {
  const one = changerBoard(1, {
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fight(one.engine, P2, [one.id("atk")], { type: "faction", playerId: P1 }, [one.id("mc")]);
  assert.equal(damageOf(one.engine, one.id("atk")), 1, "2 strength - 1 token");
  const none = changerBoard(0, {
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fight(none.engine, P2, [none.id("atk")], { type: "faction", playerId: P1 }, [none.id("mc")]);
  assert.equal(damageOf(none.engine, none.id("atk")), 2, "control: no tokens, full strength");
});

clause(MONEYCHANGER, "0:rule", "tokens put on it by any source count, not only EXCHANGE's: a second token from outside gives -2/-2", () => {
  const tokenTactic = tactic({
    name: "TokenSource",
    cost: 0,
    behavior: { abilities: [{ id: "tk", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }] }
  });
  const { engine, id } = changerBoard(0, { extra: [{ key: "tk", def: tokenTactic, owner: P1, zone: "hand" }, { key: "tk2", def: tokenTactic, owner: P1, zone: "hand" }] });
  play(engine, P1, id("tk"), { selected: { t: [id("mc")] } });
  assert.equal(tokensOn(engine, id("mc")), 1, "control: the token arrived");
  assert.deepEqual(statsOf(engine, id("mc")), [1, 1, 3]);
});

clause(MONEYCHANGER, "0:rule", "deploys for its printed cost of 3 with [G][G] and enters play as a 2/2/3 with no tokens; one short or only one [G] is refused", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("mc"))), 3);
  assert.deepEqual(statsOf(exact.engine, exact.id("mc")), [2, 2, 3], "no tokens on entering play");
  assert.equal(tokensOn(exact.engine, exact.id("mc")), 0);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("mc")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("mc")), "hand");
  const twoG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 1, P1)]
  });
  play(twoG.engine, P1, twoG.id("mc"));
  assert.equal(zoneOf(twoG.engine, twoG.id("mc")), "play", "control: exactly [G][G] plus one other resource is enough");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("mc")), "only one [G]");
  assert.equal(zoneOf(oneG.engine, oneG.id("mc")), "hand");
});

clause(MONEYCHANGER, "1:ability:exchange", "depletes it, puts a token on it, and draws exactly one card (the top of my deck)", () => {
  const { engine, id } = changerBoard(0);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1, "one token");
  assert.equal(isDepleted(engine, id("mc")), true, "depleted");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "one card drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(deckOf(engine, P2).length, 3, "the opponent draws nothing");
});

clause(MONEYCHANGER, "1:ability:exchange", "the Moneychanger shrinks with the token it just took (2/2 -> 1/1)", () => {
  const { engine, id } = changerBoard(0);
  activate(engine, P1, id("mc"), "exchange");
  assert.deepEqual(statsOf(engine, id("mc")), [1, 1, 3]);
});

clause(MONEYCHANGER, "1:ability:exchange", "'Deplete this card' is a cost: depleted as soon as the ability is used, with the draw waiting for resolution", () => {
  const { engine, id } = changerBoard(0);
  const handBefore = handOf(engine, P1).length;
  actRaw(engine, P1, id("mc"), "exchange");
  assert.equal(isDepleted(engine, id("mc")), true, "depleted while the ability waits for responses");
  assert.equal(handOf(engine, P1).length, handBefore, "nothing drawn yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore + 1);
});

clause(MONEYCHANGER, "1:ability:exchange", "'Put a token on this card' is a COST: the token is on the card as soon as the ability is used, before the opponent can respond", () => {
  const { engine, id } = changerBoard(0);
  actRaw(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1, "the token was put on as part of paying");
  assert.equal(handOf(engine, P1).length, 0, "while the card is still to be drawn");
});

clause(MONEYCHANGER, "1:ability:exchange", "it costs no resources", () => {
  const { engine, id } = changerBoard(0, { extra: bank("greed", 2, P1) });
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("mc"), "exchange")), 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "a depleted Moneychanger cannot use it (and nothing is put on it or drawn)", () => {
  const { engine, id } = changerBoard(0, { depleted: true });
  refused(() => actRaw(engine, P1, id("mc"), "exchange"), "depleted", /costs cannot be paid/i);
  assert.equal(tokensOn(engine, id("mc")), 0);
  assert.equal(handOf(engine, P1).length, 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used once per restore: not twice in a turn, and after its controller's restore it works again", () => {
  const { engine, id } = changerBoard(0, { turn: 1, active: P1 });
  activate(engine, P1, id("mc"), "exchange");
  refused(() => actRaw(engine, P1, id("mc"), "exchange"), "depleted: not twice in a turn", /costs cannot be paid/i);
  assert.equal(tokensOn(engine, id("mc")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(isDepleted(engine, id("mc")), false, "restored");
  const top = deckOf(engine, P1)[0];
  activate(engine, P1, id("mc"), "exchange");
  // The second token takes its life to 0 (2 life - 2 tokens), so it dies, but the ability still resolves (CR 502.4).
  assert.equal(zoneOf(engine, top), "hand", "used again after the restore: the card is drawn");
});

clause(MONEYCHANGER, "1:ability:exchange", "a Moneychanger with 1 token takes a second one: it ends at 0 life and is destroyed, but the ability still draws the card", () => {
  const { engine, id } = changerBoard(1);
  const top = deckOf(engine, P1)[0];
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(zoneOf(engine, top), "hand", "the card is still drawn: an ability resolves even if its source has left play (CR 502.4)");
  assert.equal(zoneOf(engine, id("mc")), "discard", "2 tokens: 0 life");
});

clause(MONEYCHANGER, "1:ability:exchange", "with an empty deck the token and the deplete still happen and nothing breaks", () => {
  const { engine, id } = changerBoard(0, { deck: 0 });
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1);
  assert.equal(isDepleted(engine, id("mc")), true);
  assert.equal(pending(engine), undefined);
});

clause(MONEYCHANGER, "1:ability:exchange", "the token goes on the Moneychanger only: other cards' tokens are untouched", () => {
  const { engine, id } = changerBoard(0);
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("other")), 3);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used the turn it enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...fillers("d", 2, P1, "deck"), ...bank("greed", 3, P1)]
  });
  play(engine, P1, id("mc"));
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1);
  assert.equal(handOf(engine, P1).length, 1);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = changerBoard(0, {
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  actRaw(engine, P1, id("mc"), "exchange");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(tokensOn(engine, id("mc")), 1);
  assert.equal(zoneOf(engine, id("opp")), "play");
});

clause(MONEYCHANGER, "1:ability:exchange", "only its controller can use it", () => {
  const { engine, id } = changerBoard(0, { turn: 2, active: P2 });
  refused(() => actRaw(engine, P2, id("mc"), "exchange"), "the opponent's Moneychanger", /controller|control|your|belong|own/i);
  assert.equal(tokensOn(engine, id("mc")), 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "its controller draws: a Moneychanger the opponent controls draws for that player, not for me", () => {
  const { engine, id } = changerBoard(0, { owner: P2, turn: 2, active: P2 });
  const top = deckOf(engine, P2)[0];
  activate(engine, P2, id("mc"), "exchange");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(controllerOf(engine, top), P2);
  assert.equal(deckOf(engine, P1).length, 4, "my deck is untouched");
  assert.equal(handOf(engine, P1).length, 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "tokens disappear when it leaves play (CR 409.2): returned to hand and deployed again it has none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("mc")] } });
  assert.equal(zoneOf(engine, id("mc")), "hand");
  play(engine, P1, id("mc"));
  assert.equal(zoneOf(engine, id("mc")), "play");
  assert.equal(tokensOn(engine, id("mc")), 0, "a fresh card has no tokens");
});

// =============================================================================
// Mutiny Grant (2nd Edition)
// COST: Pick a character your opponent controls. Your faction loses X influence,
//   where X is the numeric cost of that character.
// EFFECT: This turn, take control of the character. Restore it.
// Tactic, banker, cost 2, [G][G].
// =============================================================================

const MUTINY = "9d3a3181-3167-4534-baf2-f5c31764c7d3";

function mutinyBoard(opts: { greed?: number; influence?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mg", def: printing(MUTINY), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0, strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "C1", cost: 1 }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "C3", cost: 3, strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play", attackEligible: false },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P2, zone: "play" },
      { key: "dep", def: character({ name: "Dep", cost: 2 }), owner: P2, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm", cost: 2 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", cost: 2 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", cost: 2 }), owner: P2, zone: "hand" },
      ...bank("greed", opts.greed ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const [key, x] of [
  ["c0", 0],
  ["c1", 1],
  ["c3", 3],
  ["c5", 5]
] as const) {
  clause(MUTINY, "0:ability", `picking a character of numeric cost ${x}: my faction loses exactly ${x} influence (30 -> ${30 - x}) and I control the character`, () => {
    const { engine, id } = mutinyBoard();
    const spent = spentBy(engine, P1, () => play(engine, P1, id("mg"), { selected: { pick: [id(key)] } }));
    assert.equal(influenceOf(engine, P1), 30 - x, `X = ${x}`);
    assert.equal(influenceOf(engine, P2), 30, "the opponent's influence is unchanged");
    assert.equal(controllerOf(engine, id(key)), P1, "I control the character this turn");
    assert.ok(engine.state.players[P1].play.includes(id(key)), "it is among my cards in play");
    assert.equal(engine.state.players[P2].play.includes(id(key)), false, "and no longer among the opponent's");
    assert.equal(engine.state.cards[id(key)].ownerId, P2, "ownership never changes");
    assert.equal(spent, 2, "the numeric cost of 2 is paid with resources; the influence loss is separate");
    assert.equal(zoneOf(engine, id("mg")), "discard");
  });
}

clause(MUTINY, "0:ability", "only the picked character changes sides: the opponent's other characters stay theirs", () => {
  const { engine, id } = mutinyBoard();
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  for (const key of ["c0", "c1", "c5", "dep"]) assert.equal(controllerOf(engine, id(key)), P2, key);
  assert.equal(controllerOf(engine, id("mine")), P1);
});

clause(MUTINY, "0:ability", "'Restore it': a depleted character is restored (undepleted) as I take control of it", () => {
  const { engine, id } = mutinyBoard();
  assert.equal(isDepleted(engine, id("dep")), true);
  play(engine, P1, id("mg"), { selected: { pick: [id("dep")] } });
  assert.equal(isDepleted(engine, id("dep")), false);
  assert.equal(controllerOf(engine, id("dep")), P1);
  assert.equal(influenceOf(engine, P1), 28, "X = its numeric cost 2");
});

clause(MUTINY, "0:ability", "the restore is for the picked character only: another depleted character stays depleted", () => {
  const { engine, id } = mutinyBoard({ extra: [{ key: "dep2", def: character({ name: "Dep2", cost: 1 }), owner: P2, zone: "play", depleted: true }] });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(isDepleted(engine, id("c3")), false);
  assert.equal(isDepleted(engine, id("dep")), true, "the other depleted character is not restored");
  assert.equal(isDepleted(engine, id("dep2")), true);
  assert.equal(controllerOf(engine, id("dep")), P2);
});

clause(MUTINY, "0:ability", "the influence loss is a COST: it is lost when the tactic is played, before the opponent can respond; the control change waits", () => {
  const { engine, id } = mutinyBoard();
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(influenceOf(engine, P1), 27, "already lost");
  assert.equal(controllerOf(engine, id("c3")), P2, "not controlled yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("c3")), P1);
});

clause(MUTINY, "0:ability", "'This turn': control goes back to the opponent when the turn ends, and the influence stays lost", () => {
  const { engine, id } = mutinyBoard({ turn: 1, active: P1 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(controllerOf(engine, id("c3")), P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(controllerOf(engine, id("c3")), P2, "the opponent controls their character again");
  assert.ok(engine.state.players[P2].play.includes(id("c3")), "engine.state.players[P2].play.includes(id(\"c3\"))");
  assert.equal(engine.state.players[P1].play.includes(id("c3")), false);
  assert.equal(influenceOf(engine, P1), 27, "but the influence stays lost");
});

clause(MUTINY, "0:ability", "while I control it this turn it is MY card for effects (my tactic can target it as 'a character you control')", () => {
  const { engine, id } = mutinyBoard({
    turn: 1,
    active: P1,
    extra: [
      {
        key: "stolenSelector",
        def: tactic({
          name: "MyChars",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "mc",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
                effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 5, duration: { type: "untilEndOfTurn" } }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  play(engine, P1, id("stolenSelector"), { selected: { t: [id("c3")] } });
  assert.equal(engine.getStat(id("c3"), "strength"), 7, "it is a character I control");
});

clause(MUTINY, "0:ability", "a stolen character was not under my control since the start of the turn, so it cannot attack this turn (CR 608.1b)", () => {
  const { engine, id } = mutinyBoard({ turn: 1, active: P1 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(isDepleted(engine, id("c3")), false);
  refused(
    () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c3")], target: { type: "faction", playerId: P2 } }),
    "I have not controlled it since the start of the turn"
  );
  declareAttackBy(engine, P1, [id("mine")], { type: "faction", playerId: P2 });
  assert.ok(battleOf(engine), "control: my own character can attack");
});

clause(MUTINY, "0:ability", "only a character the opponent CONTROLS can be picked: my own character is refused", () => {
  const { engine, id } = mutinyBoard();
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("mine")] } }), "my own character");
  assert.equal(influenceOf(engine, P1), 30);
  assert.equal(zoneOf(engine, id("mg")), "hand");
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c1")] } });
  assert.ok(engine.state.responseWindow, "control: an opponent's character is accepted");
});

clause(MUTINY, "0:ability", "'your opponent controls' is about control: a character the opponent owns but I control is refused; one I own but they control is accepted", () => {
  const { engine, id } = mutinyBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed", cost: 2 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", cost: 2 }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("borrowed")] } }), "a character I already control");
  assert.equal(zoneOf(engine, id("mg")), "hand");
  play(engine, P1, id("mg"), { selected: { pick: [id("lent")] } });
  assert.equal(controllerOf(engine, id("lent")), P1);
  assert.equal(influenceOf(engine, P1), 28);
});

clause(MUTINY, "0:ability", "only a character can be picked: an item, a location, a face-down card, a faction and a card outside play are refused", () => {
  const { engine, id } = mutinyBoard({ extra: [{ key: "hidden", def: character({ name: "Hidden", cost: 2 }), owner: P2, zone: "play", faceDown: true }] });
  const attempt = (cardId: CardInstanceId) => () => playRaw(engine, P1, id("mg"), { selected: { pick: [cardId] } });
  refused(attempt(id("itm")), "an opponent's item");
  refused(attempt(id("loc")), "an opponent's location");
  refused(attempt(id("hidden")), "an opponent's face-down card");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("inHand")), "a character in their hand");
  assert.equal(influenceOf(engine, P1), 30, "nothing was lost");
  assert.equal(zoneOf(engine, id("mg")), "hand");
  attempt(id("c1"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(MUTINY, "0:ability", "exactly one character is picked: none, or two, is refused", () => {
  const { engine, id } = mutinyBoard();
  refused(() => playRaw(engine, P1, id("mg")), "no pick");
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("c1"), id("c3")] } }), "two picks");
  assert.equal(influenceOf(engine, P1), 30);
  assert.equal(zoneOf(engine, id("mg")), "hand");
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c1")] } });
  assert.ok(engine.state.responseWindow, "control: exactly one is accepted");
});

clause(MUTINY, "0:ability", "'loses X influence' is a cost that needs the influence: with 2 influence left a 3-cost character cannot be picked", () => {
  const { engine, id } = mutinyBoard({ influence: 2 });
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } }), "not enough influence to lose 3 (CR 401.3b)");
  assert.equal(influenceOf(engine, P1), 2);
  assert.equal(zoneOf(engine, id("mg")), "hand");
  assert.equal(ready(engine), 2, "nothing was spent");
  play(engine, P1, id("mg"), { selected: { pick: [id("c1")] } });
  assert.equal(influenceOf(engine, P1), 1, "control: a 1-cost character costs 1 influence");
});

clause(MUTINY, "0:ability", "with exactly X influence the cost can be paid (and my faction then has 0 influence, so I lose the game)", () => {
  const { engine, id } = mutinyBoard({ influence: 3 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(influenceOf(engine, P1), 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "a faction at 0 influence loses (CR 102)");
});

clause(MUTINY, "0:ability", "the influence is lost directly, not paid: it does not use up resources, and it is lost in addition to the 2 resources", () => {
  const { engine, id } = mutinyBoard({ greed: 2 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c5")] } });
  assert.equal(ready(engine), 0, "exactly the 2 resources of the numeric cost are gone");
  assert.equal(influenceOf(engine, P1), 25);
});

clause(MUTINY, "0:ability", "if the picked character left play in response, the control change does nothing but the influence is still lost", () => {
  const { engine, id } = mutinyBoard({
    extra: [{ key: "bounce", def: moverTactic("hand"), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("c3")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c3")), "hand", "it went back to its owner's hand");
  assert.equal(influenceOf(engine, P1), 27, "the cost was paid");
  assert.equal(engine.state.players[P1].play.includes(id("c3")), false);
  assert.equal(zoneOf(engine, id("mg")), "discard", "control: Mutiny Grant resolved");
});

clause(MUTINY, "0:ability", "it can be played in response on the opponent's turn: I control the character until that turn ends", () => {
  const { engine, id } = mutinyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("c3")), P1);
  assert.equal(influenceOf(engine, P1), 27);
  endTurn(engine, P2);
  assert.equal(controllerOf(engine, id("c3")), P2, "back with its controller when the turn ends");
});

clause(MUTINY, "0:ability", "taking control of an attacker in response to its attack removes it from the battle (CR 407.4)", () => {
  const { engine, id } = mutinyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", cost: 2, strength: 3, life: 9 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("atk")] } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("atk")), P1);
  assert.equal(influenceOf(engine, P1), 28, "X = 2");
  assert.equal(influenceOf(engine, P2), 30, "the attack did no damage");
  assert.equal(battleOf(engine)?.attackingParty.includes(id("atk")) ?? false, false, "no longer in the attacking party");
});

clause(MUTINY, "0:ability", "costs 2 with [G][G]: one resource short, or only one [G], is refused", () => {
  const short = mutinyBoard({ greed: 0, extra: [...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("mg"), { selected: { pick: [short.id("c1")] } }), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(influenceOf(short.engine, P1), 30);
  assert.equal(zoneOf(short.engine, short.id("mg")), "hand");
  const oneG = mutinyBoard({ greed: 1, extra: bank("rage", 3, P1) });
  refused(() => playRaw(oneG.engine, P1, oneG.id("mg"), { selected: { pick: [oneG.id("c1")] } }), "only one [G]", /Threshold requirements are not met/);
  assert.equal(influenceOf(oneG.engine, P1), 30);
  const mixed = mutinyBoard({ greed: 2, extra: bank("rage", 1, P1) });
  play(mixed.engine, P1, mixed.id("mg"), { selected: { pick: [mixed.id("c1")] } });
  assert.equal(controllerOf(mixed.engine, mixed.id("c1")), P1);
});

clause(MUTINY, "0:ability", "taking control of a UNIQUE character whose designation I already control makes me choose which to keep (CR 507.5), and the game goes on", () => {
  const uniq = (name: string) => character({ name, unique: "mutiny-test-unique", cost: 2, strength: 1, life: 3 });
  const { engine, id } = mutinyBoard({
    extra: [
      { key: "myU", def: uniq("MyU"), owner: P1, zone: "play" },
      { key: "theirU", def: uniq("TheirU"), owner: P2, zone: "play" }
    ]
  });
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("theirU")] } });
  resolvePendingResponses(engine);
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  answerPending(engine, "uniqueSurvivor", { keep: id("theirU") });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("theirU")), "play");
  assert.equal(controllerOf(engine, id("theirU")), P1);
  assert.equal(zoneOf(engine, id("myU")), "discard", "my own copy was destroyed");
});

// =============================================================================
// Pettifogger (2nd Edition)
// If this card blocks, destroy it and all members of the attacking party.
// Character (lawyer), banker, cost 3, [G], 1 strength / 3 speed / 1 life.
// =============================================================================

const PETTIFOGGER = "75e78a26-d636-48a1-9e28-38d467001f37";

/** P2 (active) attacks P1's faction. P1 has the Pettifogger `pf`, a sturdy `ally`, and `atk0..n-1` (strength 2, life 9) are P2's attackers; `home` is a P2 character that stays out of the attack. */
function pettiBoard(attackers = 1, o: { pettifoggers?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "play" },
      ...(o.pettifoggers === 2 ? [{ key: "pf2", def: printing(PETTIFOGGER), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      ...Array.from({ length: attackers }, (_, i) => ({ key: `atk${i}`, def: character({ name: `Atk${i}`, strength: 2, life: 9 }), owner: P2, zone: "play" as const })),
      { key: "home", def: character({ name: "Home", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

const pettiFight = (b: ReturnType<typeof pettiBoard>, attackers: string[], blockers: string[], target: Parameters<typeof fight>[3] = { type: "faction", playerId: P1 }) =>
  fight(b.engine, P2, attackers.map(b.id), target, blockers.map(b.id));

clause(PETTIFOGGER, "0:rule", "blocking a lone attacker destroys the Pettifogger and the attacker", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard", "it destroys itself");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard", "and the attacker");
  assert.equal(influenceOf(b.engine, P1), 20, "the attacker never gets to hit the faction");
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
});

clause(PETTIFOGGER, "0:rule", "blocking a party destroys ALL members of the attacking party", () => {
  const b = pettiBoard(3);
  pettiFight(b, ["atk0", "atk1", "atk2"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  for (const key of ["atk0", "atk1", "atk2"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was in the attacking party`);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(PETTIFOGGER, "0:rule", "only the attacking party dies: a character of theirs that did not attack is untouched", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard", "control: the attackers died");
  assert.equal(zoneOf(b.engine, b.id("home")), "play");
  assert.equal(damageOf(b.engine, b.id("home")), 0);
  assert.equal(zoneOf(b.engine, b.id("ally")), "play", "and so did my other characters");
});

clause(PETTIFOGGER, "0:rule", "blocking together with another character: the Pettifogger and the whole attacking party die, the other blocker survives unharmed", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf", "ally"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ally")), "play", "the other blocker is not destroyed");
  assert.equal(damageOf(b.engine, b.id("ally")), 0, "and takes no damage: the attackers are gone before damage");
});

clause(PETTIFOGGER, "0:rule", "it triggers when it blocks, so it is already destroyed before any battle damage is dealt", () => {
  const b = pettiBoard(1);
  declareAttackBy(b.engine, P2, [b.id("atk0")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pf")] });
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard", "destroyed as soon as it blocks");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(damageOf(b.engine, b.id("pf")), 0);
  assert.equal(damageOf(b.engine, b.id("atk0")), 0, "no damage was needed");
});

clause(PETTIFOGGER, "0:rule", "if another character blocks instead, the Pettifogger does nothing and the attackers live", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["ally"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "play");
  assert.equal(damageOf(b.engine, b.id("ally")), 4, "control: the battle really happened (2 + 2 damage on the blocker)");
});

clause(PETTIFOGGER, "0:rule", "if nobody blocks it does nothing", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], []);
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "play");
  assert.equal(influenceOf(b.engine, P1), 18, "the attacker hit the faction");
});

clause(PETTIFOGGER, "0:rule", "'if this card blocks': when the Pettifogger ATTACKS and is blocked, nothing special happens", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("pf")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "the blocker is not destroyed by the Pettifogger's attack");
  assert.equal(damageOf(b.engine, b.id("blk")), 1, "the Pettifogger just dealt its 1 strength");
});

clause(PETTIFOGGER, "0:rule", "it is symmetric: the opponent's Pettifogger blocking my attack destroys itself and my whole party", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "a0", def: character({ name: "A0", life: 9 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", life: 9 }), owner: P1, zone: "play" },
      { key: "pf", def: printing(PETTIFOGGER), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("a0"), b.id("a1")], { type: "faction", playerId: P2 }, [b.id("pf")]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
});

clause(PETTIFOGGER, "0:rule", "it works for an attack on a location as well", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf"], { type: "card", cardId: b.id("place") });
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
  assert.equal(damageOf(b.engine, b.id("place")), 0);
});

clause(PETTIFOGGER, "0:rule", "destroyed cards go to their owners' discard piles", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], ["pf"]);
  assert.ok(discardOf(b.engine, P1).includes(b.id("pf")), "discardOf(b.engine, P1).includes(b.id(\"pf\"))");
  assert.ok(discardOf(b.engine, P2).includes(b.id("atk0")), "discardOf(b.engine, P2).includes(b.id(\"atk0\"))");
});

clause(PETTIFOGGER, "0:rule", "two Pettifoggers blocking together: both are destroyed and so is the attacking party", () => {
  const b = pettiBoard(2, { pettifoggers: 2 });
  pettiFight(b, ["atk0", "atk1"], ["pf", "pf2"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pf2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
});

clause(PETTIFOGGER, "0:rule", "a Pettifogger that does not block is unaffected by another Pettifogger blocking", () => {
  const b = pettiBoard(1, { pettifoggers: 2 });
  pettiFight(b, ["atk0"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard", "control: the attacker died");
  assert.equal(zoneOf(b.engine, b.id("pf2")), "play", "the second Pettifogger did not block");
});

clause(PETTIFOGGER, "0:rule", "the destruction is an effect: under Limited Liability (cards can only be destroyed by costs) nobody is destroyed", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ll")), "discard", "control: Limited Liability resolved");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pf")] });
  assert.equal(zoneOf(b.engine, b.id("pf")), "play", "it cannot be destroyed this turn");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play", "neither can the attacker");
});

clause(PETTIFOGGER, "0:rule", "a face-down Pettifogger is only a resource: it cannot block", () => {
  const b = pettiBoard(1, { extra: [{ key: "hidden", def: printing(PETTIFOGGER), owner: P1, zone: "play", faceDown: true }] });
  declareAttackBy(b.engine, P2, [b.id("atk0")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("hidden")] }), "a face-down card cannot block");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pf")] });
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard", "control: the face-up one works");
  assert.equal(zoneOf(b.engine, b.id("hidden")), "play");
});

clause(PETTIFOGGER, "0:rule", "deploys for its printed cost of 3 with [G] as a 1 strength / 3 speed / 1 life character; one short or no [G] is refused", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  play(b.engine, P1, b.id("pf"));
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(ready(b.engine), 0, "exactly 3 paid");
  assert.deepEqual([b.engine.getStat(b.id("pf"), "strength"), b.engine.getStat(b.id("pf"), "speed"), b.engine.getStat(b.id("pf"), "life")], [1, 3, 1]);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("pf")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("pf")), "hand");
  const oneG = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 2, P1)] });
  play(oneG.engine, P1, oneG.id("pf"));
  assert.equal(zoneOf(oneG.engine, oneG.id("pf")), "play", "control: a single [G] plus two other resources is enough");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pf")), "no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pf")), "hand");
});

// =============================================================================
// Recapitulating Apparition (2nd Edition)
// If this card is put into your discard pile from play, you may pay 1. If you do,
// put it into play under your control. Deplete it.
// Character (ghost), banker, cost 3, [G][G][G], 2 strength / 3 speed / 1 life.
// =============================================================================

const APPARITION = "030521d5-7d94-4e11-8e86-647dc1c285af";

function apparitionBoard(opts: { greed?: number; extra?: CardPlacement[]; raOwner?: Pid; raController?: Pid; raFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: opts.raOwner ?? P1, controller: opts.raController, zone: "play", faceDown: opts.raFaceDown },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const killApparition = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => play(engine, P1, id("kill"), { selected: { t: [id("ra")] } });

clause(APPARITION, "0:rule", "destroyed from play, its controller is offered 'you may pay 1'", () => {
  const { engine, id } = apparitionBoard();
  killApparition(engine, id);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; cost: Array<{ type: string; amount: number }> };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cost.map((c) => [c.type, c.amount]), [["payResources", 1]], "the price is exactly 1");
  assert.equal(zoneOf(engine, id("ra")), "discard", "it is in the discard pile while the choice is open");
});

clause(APPARITION, "0:rule", "paying 1: it returns to play under your control, depleted, and exactly 1 resource is spent", () => {
  const { engine, id } = apparitionBoard({ greed: 3 });
  const before = ready(engine);
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(controllerOf(engine, id("ra")), P1);
  assert.equal(isDepleted(engine, id("ra")), true, "it comes back depleted");
  assert.equal(before - ready(engine), 1, "exactly 1 paid");
  assert.equal(discardOf(engine, P1).includes(id("ra")), false, "no longer in the discard pile");
  assert.ok(playOf(engine, P1).includes(id("ra")), "playOf(engine, P1).includes(id(\"ra\"))");
});

clause(APPARITION, "0:rule", "it comes back as a fresh card: no damage, at full life and strength", () => {
  const { engine, id } = apparitionBoard();
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(damageOf(engine, id("ra")), 0);
  assert.equal(engine.getStat(id("ra"), "life"), 1);
  assert.equal(engine.getStat(id("ra"), "strength"), 2);
  assert.equal(engine.getStat(id("ra"), "speed"), 3);
});

clause(APPARITION, "0:rule", "declining the payment: it stays in the discard pile and nothing is paid", () => {
  const { engine, id } = apparitionBoard({ greed: 3 });
  const before = ready(engine);
  killApparition(engine, id);
  answerMayPay(engine, false);
  assert.equal(zoneOf(engine, id("ra")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("ra")), "discardOf(engine, P1).includes(id(\"ra\"))");
  assert.equal(ready(engine), before, "no resource spent");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "with no resource to pay the 1, it cannot come back (it stays in the discard pile)", () => {
  const { engine, id } = apparitionBoard({ greed: 0 });
  killApparition(engine, id);
  if (engine.state.pendingChoice) {
    refused(() => answerMayPay(engine, true), "you cannot pay 1 with 0 resources");
    drain(engine, declineAll);
  }
  assert.equal(zoneOf(engine, id("ra")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "resources already spent count for nothing: with every resource attached it cannot come back", () => {
  const { engine, id } = apparitionBoard({ greed: 0, extra: spent("greed", 2) });
  assert.equal(ready(engine), 0);
  killApparition(engine, id);
  if (engine.state.pendingChoice) {
    refused(() => answerMayPay(engine, true), "nothing left to pay with");
    drain(engine, declineAll);
  }
  assert.equal(zoneOf(engine, id("ra")), "discard");
});

clause(APPARITION, "0:rule", "it recurs every time: destroy it again after it returned and it can come back again (1 resource each time)", () => {
  const { engine, id } = apparitionBoard({ greed: 3, extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  play(engine, P1, id("kill2"), { selected: { t: [id("ra")] } });
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(ready(engine), 1, "paid 1 each time");
});

clause(APPARITION, "0:rule", "destroyed in battle counts too (it is put into the discard pile from play)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: 20 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("ra")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  autoResolveBattle(b.engine);
  assert.equal(pending(b.engine)?.kind, "mayPay", "asked after it died in the battle");
  answerMayPay(b.engine, true);
  assert.equal(zoneOf(b.engine, b.id("ra")), "play");
  assert.equal(isDepleted(b.engine, b.id("ra")), true);
});

clause(APPARITION, "0:rule", "'put into your discard pile from play' also covers a plain move to the discard pile (not only destruction)", () => {
  const { engine, id } = apparitionBoard({ extra: [{ key: "toss", def: moverTactic("discard"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("toss"), { selected: { t: [id("ra")] } });
  assert.equal(pending(engine)?.kind, "mayPay", "offered after being moved to the discard pile");
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
});

clause(APPARITION, "0:rule", "only 'put into your discard pile': returned to hand (bounced) it is not offered", () => {
  const { engine, id } = apparitionBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "hand");
  assert.equal(engine.state.pendingChoice, undefined, "no 'may pay' for leaving play any other way");
  assert.equal(ready(engine), 3);
});

clause(APPARITION, "0:rule", "only 'from play': discarded from hand it does not come back, and nothing is offered", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "hand" },
      {
        key: "dump",
        def: tactic({
          name: "Dump",
          cost: 0,
          behavior: { abilities: [{ id: "dd", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
        }),
        owner: P1,
        zone: "hand"
      },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("dump"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "discard", "control: it was discarded from hand");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 3);
});

clause(APPARITION, "0:rule", "only 'from play': milled from the deck into the discard pile it does not come back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "deck" },
      {
        key: "mill",
        def: tactic({ name: "Mill", cost: 0, behavior: { abilities: [{ id: "m", type: "activated", effects: [{ type: "moveCard", target: { type: "random", selector: { owner: "self", zone: "deck" } }, to: "discard" }] }] } }),
        owner: P1,
        zone: "hand"
      },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("mill"));
  assert.equal(zoneOf(engine, id("ra")), "discard", "control: it was milled");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "it triggers off ITSELF: another character going to the discard pile from play does not offer anything", () => {
  const { engine, id } = apparitionBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("other")] } });
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ra")), "play");
});

clause(APPARITION, "0:rule", "an opposing Apparition belongs to its own controller: THEY are offered the payment and pay from THEIR resources", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 2, P2),
      ...bank("greed", 5, P1)
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("ra")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the Apparition's controller decides");
  const p1Ready = ready(engine, P1);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(controllerOf(engine, id("ra")), P2, "under ITS controller's control");
  assert.equal(ready(engine, P2), 1, "P2 paid 1");
  assert.equal(ready(engine, P1), p1Ready, "P1 paid nothing");
});

clause(APPARITION, "0:rule", "removed from the game instead (not put into the discard pile) it does not come back", () => {
  const { engine, id } = apparitionBoard({
    extra: [
      {
        key: "exile",
        def: tactic({
          name: "Exile",
          cost: 0,
          behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  play(engine, P1, id("exile"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "removed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "a face-down Apparition is only a resource with no rules text: leaving play it is not offered a return", () => {
  const { engine, id } = apparitionBoard({
    raFaceDown: true,
    extra: [{ key: "toss", def: moverTactic("discard"), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("toss"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "discard", "control: it left play");
  assert.equal(engine.state.pendingChoice, undefined, "a face-down card has no abilities (CR 411.1)");
});

clause(APPARITION, "0:rule", "'your discard pile': a stolen Apparition goes to its OWNER's discard pile when destroyed, which is not the discard pile of the player controlling it", () => {
  const { engine, id } = apparitionBoard({ raOwner: P2, raController: P1 });
  killApparition(engine, id);
  assert.ok(discardOf(engine, P2).includes(id("ra")), "control: it went to its owner's discard pile");
  assert.equal(engine.state.pendingChoice, undefined, "it was not put into the controller's discard pile, so nothing is offered");
  assert.equal(zoneOf(engine, id("ra")), "discard");
});

clause(APPARITION, "0:rule", "deploys for its printed cost of 3 with [G][G][G] as a 2 strength / 3 speed / 1 life character; one short or two [G] only is refused", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ra", def: printing(APPARITION), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ra", def: printing(APPARITION), owner: P1, zone: "hand" }, ...bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("ra")), "2 ready is one short of the cost 3 (threshold met by spent icons)", /Costs cannot be paid/);
  const noThreshold = mk(2, 5);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ra")), "two Greed is one short of [G][G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ra")), "hand");
  const ok = mk(3, 0);
  play(ok.engine, P1, ok.id("ra"));
  assert.equal(zoneOf(ok.engine, ok.id("ra")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 3 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("ra"), "strength"), ok.engine.getStat(ok.id("ra"), "speed"), ok.engine.getStat(ok.id("ra"), "life")], [2, 3, 1]);
});

// =============================================================================
// Repo Man (2nd Edition)
// When this card enters play, you may pick a location. If you do, destroy it.
// Character (lackey, mau), banker, cost 5, [G], 3 strength / 3 speed / 3 life.
// =============================================================================

const REPO = "0b1b900d-1cd4-4b94-9576-242853a08861";

function repoBoard(o: { owner?: Pid; locations?: boolean; greed?: number; zone?: "hand" | "discard" } = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "rm", def: printing(REPO), owner, zone: o.zone ?? "hand" },
      ...(o.locations === false
        ? []
        : [
            { key: "myPlace", def: location({ name: "MyPlace", structure: 3 }), owner, zone: "play" as const },
            { key: "foePlace", def: location({ name: "FoePlace", structure: 3 }), owner: foe, zone: "play" as const },
            { key: "foePlace2", def: location({ name: "FoePlace2", structure: 3 }), owner: foe, zone: "play" as const }
          ]),
      { key: "thing", def: item({ name: "Thing" }), owner: foe, zone: "play" },
      { key: "mineChar", def: character({ name: "MineChar" }), owner, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: foe, zone: "play" },
      { key: "hidden", def: location({ name: "HiddenPlace" }), owner: foe, zone: "play", faceDown: true },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "bounce", def: moverTactic("hand"), owner, zone: "hand" },
      { key: "raise", def: raiserTactic(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...bank("greed", o.greed ?? 6, owner)
    ]
  });
}

clause(REPO, "0:rule", "when it enters play its controller is asked to pick a location (optional)", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Repo Man's controller picks");
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "the Repo Man is in play");
});

clause(REPO, "0:rule", "picking an opponent's location destroys it (to its owner's discard pile), and only it", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foePlace")), "to its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "play", "another opposing location is untouched");
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "play", "so is yours");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "the Repo Man itself stays in play");
});

clause(REPO, "0:rule", "'a location' means any location: you may pick your own", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  pickTargets(b.engine, P1, [b.id("myPlace")]);
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("myPlace")), "discardOf(b.engine, P1).includes(b.id(\"myPlace\"))");
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
});

clause(REPO, "0:rule", "'you may': declining the pick destroys nothing", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the pick was offered");
  pickTargets(b.engine, P1, []);
  for (const key of ["myPlace", "foePlace", "foePlace2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "the Repo Man stays in play");
});

clause(REPO, "0:rule", "only a location can be picked: an item, a character, a faction or a face-down card is refused", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  refused(() => pickTargets(b.engine, P1, [b.id("thing")]), "an item");
  refused(() => pickTargets(b.engine, P1, [b.id("foeChar")]), "an opponent's character");
  refused(() => pickTargets(b.engine, P1, [b.id("mineChar")]), "my character");
  refused(() => pickTargets(b.engine, P1, [factionOf(b.engine, P2)]), "a faction");
  refused(() => pickTargets(b.engine, P1, [b.id("hidden")]), "a face-down card is only a resource");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard", "control: a location is accepted");
});

clause(REPO, "0:rule", "a location in a discard pile or hand cannot be picked (only locations in play)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rm", def: printing(REPO), owner: P1, zone: "hand" },
      { key: "play1", def: location({ name: "Play1" }), owner: P2, zone: "play" },
      { key: "disc", def: location({ name: "Disc" }), owner: P2, zone: "discard" },
      { key: "hand1", def: location({ name: "Hand1" }), owner: P2, zone: "hand" },
      ...bank("greed", 5, P1)
    ]
  });
  play(b.engine, P1, b.id("rm"));
  refused(() => pickTargets(b.engine, P1, [b.id("disc")]), "a location in a discard pile");
  refused(() => pickTargets(b.engine, P1, [b.id("hand1")]), "a location in a hand");
  pickTargets(b.engine, P1, [b.id("play1")]);
  assert.equal(zoneOf(b.engine, b.id("play1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("disc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("hand1")), "hand");
});

clause(REPO, "0:rule", "only ONE location: picking two is refused", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  refused(() => pickTargets(b.engine, P1, [b.id("foePlace"), b.id("foePlace2")]), "two locations");
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "play");
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard", "control: one is fine");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "play");
});

clause(REPO, "0:rule", "only the controller answers", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  refused(() => pickTargets(b.engine, P2, [b.id("foePlace")]), "the opponent cannot answer for me", /./);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(REPO, "0:rule", "with no location in play there is nothing to pick: no prompt, nothing happens", () => {
  const b = repoBoard({ locations: false });
  play(b.engine, P1, b.id("rm"));
  assert.equal(zoneOf(b.engine, b.id("rm")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(zoneOf(b.engine, b.id("foeChar")), "play");
});

clause(REPO, "0:rule", "a damaged location is destroyed just the same, and sheds its damage", () => {
  const b = repoBoard();
  b.engine.state.cards[b.id("foePlace")].damage = 2;
  play(b.engine, P1, b.id("rm"));
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.equal(damageOf(b.engine, b.id("foePlace")), 0, "damage clears when it leaves play");
});

clause(REPO, "0:rule", "the location is destroyed when the Repo Man ENTERS play, not while it is still being deployed", () => {
  const b = repoBoard();
  playRaw(b.engine, P1, b.id("rm"));
  assert.equal(zoneOf(b.engine, b.id("rm")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked before it enters play");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "asked once it has entered play");
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
});

clause(REPO, "0:rule", "put into play by an effect it still asks for a location and destroys it", () => {
  const b = repoBoard({ zone: "discard" });
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("rm")] } });
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "control: it was put into play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
});

clause(REPO, "0:rule", "another character entering play, or the Repo Man leaving play, asks nothing", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("freebie"));
  assert.equal(zoneOf(b.engine, b.id("freebie")), "play", "control: another character really entered play");
  assert.equal(b.engine.state.pendingChoice, undefined, "another character entering play (Repo Man in hand)");
  const placed = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rm", def: printing(REPO), owner: P1, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
    ]
  });
  play(placed.engine, P1, placed.id("freebie"));
  assert.equal(placed.engine.state.pendingChoice, undefined, "another character entering play (Repo Man in play)");
  play(placed.engine, P1, placed.id("kill"), { selected: { t: [placed.id("rm")] } });
  assert.equal(zoneOf(placed.engine, placed.id("rm")), "discard");
  assert.equal(placed.engine.state.pendingChoice, undefined, "leaving play asks nothing");
  assert.equal(zoneOf(placed.engine, placed.id("place")), "play");
});

clause(REPO, "0:rule", "it triggers each time it enters play: returned to hand and deployed again it destroys another location", () => {
  const b = repoBoard({ greed: 12 });
  play(b.engine, P1, b.id("rm"));
  pickTargets(b.engine, P1, [b.id("foePlace")]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("rm")] } });
  assert.equal(zoneOf(b.engine, b.id("rm")), "hand");
  play(b.engine, P1, b.id("rm"));
  pickTargets(b.engine, P1, [b.id("foePlace2")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "play");
});

clause(REPO, "0:rule", "an opponent's Repo Man is answered by the opponent: they choose and can destroy a location of mine", () => {
  const b = repoBoard({ owner: P2 });
  play(b.engine, P2, b.id("rm"));
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P2);
  refused(() => pickTargets(b.engine, P1, [b.id("myPlace")]), "I cannot answer for them", /./);
  pickTargets(b.engine, P2, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard", "'foePlace' is owned by P1 from the opponent's point of view");
});

clause(REPO, "0:rule", "under Limited Liability (cards can only be destroyed by costs) the picked location survives", () => {
  const ll = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "rm", def: printing(REPO), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 7, P1)
    ]
  });
  play(ll.engine, P1, ll.id("ll"));
  play(ll.engine, P1, ll.id("rm"));
  pickTargets(ll.engine, P1, [ll.id("place")]);
  assert.equal(zoneOf(ll.engine, ll.id("place")), "play", "it cannot be destroyed this turn");
  assert.equal(zoneOf(ll.engine, ll.id("rm")), "play", "control: the Repo Man entered play");
});

clause(REPO, "0:rule", "enters play with its printed stats 3/3/3 and pays 5 with [G]; one short or no [G] is refused", () => {
  const b = repoBoard({ locations: false, greed: 5 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rm"));
  assert.equal(before - ready(b.engine), 5);
  assert.deepEqual([b.engine.getStat(b.id("rm"), "strength"), b.engine.getStat(b.id("rm"), "speed"), b.engine.getStat(b.id("rm"), "life")], [3, 3, 3]);

  const short = repoBoard({ greed: 4 });
  refused(() => playRaw(short.engine, P1, short.id("rm")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("rm")), "hand");
  const oneG = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "rm", def: printing(REPO), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)] });
  play(oneG.engine, P1, oneG.id("rm"));
  assert.equal(zoneOf(oneG.engine, oneG.id("rm")), "play", "control: a single [G] plus four other resources is enough");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "rm", def: printing(REPO), owner: P1, zone: "hand" }, ...bank("rage", 7, P1)] });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("rm")), "no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rm")), "hand");
});

clause(REPO, "0:rule", "played face-down as a resource it asks for nothing and destroys no location", () => {
  const b = repoBoard();
  developPlay(b.engine, P1, b.id("rm"), true);
  resolvePendingResponses(b.engine);
  assert.equal(isFaceDown(b.engine, b.id("rm")), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["myPlace", "foePlace", "foePlace2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
});

// =============================================================================
// Resurrection Technician (2nd Edition)
// When this card enters play, you may pick a character in your discard pile. If
// you do, put it into your hand.
// Character (lackey), banker, cost 5, [G][G], 2 strength / 2 speed / 3 life.
// =============================================================================

const TECHNICIAN = "b57d0878-7d87-42ba-9f18-ec381ff284af";

function technicianBoard(o: { owner?: Pid; discard?: boolean; greed?: number; zone?: "hand" | "discard"; extra?: CardPlacement[] } = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "rt", def: printing(TECHNICIAN), owner, zone: o.zone ?? "hand" },
      ...(o.discard === false
        ? []
        : [
            { key: "dc1", def: character({ name: "Dc1" }), owner, zone: "discard" as const },
            { key: "dc2", def: character({ name: "Dc2" }), owner, zone: "discard" as const }
          ]),
      { key: "dItem", def: item({ name: "DItem" }), owner, zone: "discard" },
      { key: "dTactic", def: tactic({ name: "DTactic" }), owner, zone: "discard" },
      { key: "dPlace", def: location({ name: "DPlace" }), owner, zone: "discard" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: foe, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner, zone: "deck" },
      { key: "foePlay", def: character({ name: "FoePlay" }), owner: foe, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "bounce", def: moverTactic("hand"), owner, zone: "hand" },
      { key: "raise", def: raiserTactic(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...bank("greed", o.greed ?? 6, owner),
      ...(o.extra ?? [])
    ]
  });
}

clause(TECHNICIAN, "0:rule", "when it enters play its controller is asked to pick a character in their discard pile (optional)", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(b.engine, b.id("rt")), "play");
});

clause(TECHNICIAN, "0:rule", "picking a character puts it into your hand, and nothing else moves", () => {
  const b = technicianBoard();
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("rt"));
  pickTargets(b.engine, P1, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc1")), "handOf(b.engine, P1).includes(b.id(\"dc1\"))");
  assert.equal(handOf(b.engine, P1).length, handBefore, "the Technician left the hand, the character came in");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard", "the other character stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("dItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeDiscard")), "discard");
  assert.equal(zoneOf(b.engine, b.id("rt")), "play", "the Technician stays in play");
});

clause(TECHNICIAN, "0:rule", "either character in the discard pile can be picked", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  pickTargets(b.engine, P1, [b.id("dc2")]);
  assert.equal(zoneOf(b.engine, b.id("dc2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "'you may': declining leaves the discard pile as it was", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the pick was offered");
  pickTargets(b.engine, P1, []);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TECHNICIAN, "0:rule", "the pick must be a character in YOUR discard pile: an opponent's, an item / tactic / location there, or a character elsewhere are refused", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  const attempt = (id: string) => () => pickTargets(b.engine, P1, [id]);
  refused(attempt(b.id("foeDiscard")), "the opponent's discard pile");
  refused(attempt(b.id("dItem")), "an item in your discard pile");
  refused(attempt(b.id("dTactic")), "a tactic in your discard pile");
  refused(attempt(b.id("dPlace")), "a location in your discard pile");
  refused(attempt(b.id("inPlay")), "a character in play");
  refused(attempt(b.id("foePlay")), "an opponent's character in play");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDeck")), "a character in your deck");
  refused(attempt(b.id("rt")), "the Technician itself, which is in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  attempt(b.id("dc1"))();
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand", "control: a character in my discard pile is accepted");
});

clause(TECHNICIAN, "0:rule", "only ONE character: picking two is refused", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  refused(() => pickTargets(b.engine, P1, [b.id("dc1"), b.id("dc2")]), "two characters");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  pickTargets(b.engine, P1, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand", "control: one is fine");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
});

clause(TECHNICIAN, "0:rule", "only the controller answers", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  refused(() => pickTargets(b.engine, P2, [b.id("dc1")]), "the opponent cannot answer for me", /./);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(TECHNICIAN, "0:rule", "with no character in your discard pile there is nothing to pick: no prompt, nothing moves", () => {
  const b = technicianBoard({ discard: false });
  play(b.engine, P1, b.id("rt"));
  assert.equal(zoneOf(b.engine, b.id("rt")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeDiscard")), "discard");
});

clause(TECHNICIAN, "0:rule", "the character is returned when the Technician ENTERS play, not while it is still being deployed", () => {
  const b = technicianBoard();
  playRaw(b.engine, P1, b.id("rt"));
  assert.equal(zoneOf(b.engine, b.id("rt")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked before it enters play");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "put into play by an effect it still returns a character", () => {
  const b = technicianBoard({ zone: "discard" });
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("rt")] } });
  assert.equal(zoneOf(b.engine, b.id("rt")), "play", "control: it was put into play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickTargets(b.engine, P1, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
});

clause(TECHNICIAN, "0:rule", "another character entering play, or the Technician leaving play, asks nothing", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("freebie"));
  assert.equal(zoneOf(b.engine, b.id("freebie")), "play", "control: another character really entered play");
  assert.equal(b.engine.state.pendingChoice, undefined, "another character entering play (Technician in hand)");

  const inPlay = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rt", def: printing(TECHNICIAN), owner: P1, zone: "play" },
      { key: "dc1", def: character({ name: "Dc1" }), owner: P1, zone: "discard" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(inPlay.engine, P1, inPlay.id("freebie"));
  assert.equal(inPlay.engine.state.pendingChoice, undefined, "another character entering play (Technician in play)");
  play(inPlay.engine, P1, inPlay.id("kill"), { selected: { t: [inPlay.id("rt")] } });
  assert.equal(zoneOf(inPlay.engine, inPlay.id("rt")), "discard");
  assert.equal(inPlay.engine.state.pendingChoice, undefined, "leaving play asks nothing");
  assert.equal(zoneOf(inPlay.engine, inPlay.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "it triggers each time it enters play: returned to hand and deployed again it returns another character", () => {
  const b = technicianBoard({ greed: 12 });
  play(b.engine, P1, b.id("rt"));
  pickTargets(b.engine, P1, [b.id("dc1")]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("rt")] } });
  play(b.engine, P1, b.id("rt"));
  pickTargets(b.engine, P1, [b.id("dc2")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "hand");
});

clause(TECHNICIAN, "0:rule", "a character that was destroyed earlier this turn can be fetched straight away", () => {
  const b = technicianBoard({ discard: false });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("inPlay")] } });
  assert.equal(zoneOf(b.engine, b.id("inPlay")), "discard", "control: it was destroyed");
  play(b.engine, P1, b.id("rt"));
  pickTargets(b.engine, P1, [b.id("inPlay")]);
  assert.equal(zoneOf(b.engine, b.id("inPlay")), "hand");
});

clause(TECHNICIAN, "0:rule", "an opponent's Technician is answered by its controller: it can only reach THEIR discard pile and fills THEIR hand", () => {
  const b = technicianBoard({ owner: P2 });
  play(b.engine, P2, b.id("rt"));
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P2);
  refused(() => pickTargets(b.engine, P1, [b.id("foeDiscard")]), "I cannot answer for them", /./);
  refused(() => pickTargets(b.engine, P2, [b.id("foeDiscard")]), "the character in MY discard pile is not in their discard pile");
  pickTargets(b.engine, P2, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("dc1")), "handOf(b.engine, P2).includes(b.id(\"dc1\"))");
  assert.equal(handOf(b.engine, P1).includes(b.id("dc1")), false);
  assert.equal(zoneOf(b.engine, b.id("foeDiscard")), "discard", "my discard pile is untouched");
});

clause(TECHNICIAN, "0:rule", "played face-down as a resource it asks for nothing and returns no character", () => {
  const b = technicianBoard();
  developPlay(b.engine, P1, b.id("rt"), true);
  resolvePendingResponses(b.engine);
  assert.equal(isFaceDown(b.engine, b.id("rt")), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "enters play with its printed stats 2/2/3 and pays 5 with [G][G]; one short or only one [G] is refused", () => {
  const b = technicianBoard({ discard: false, greed: 5 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rt"));
  assert.equal(before - ready(b.engine), 5);
  assert.deepEqual([b.engine.getStat(b.id("rt"), "strength"), b.engine.getStat(b.id("rt"), "speed"), b.engine.getStat(b.id("rt"), "life")], [2, 2, 3]);

  const short = technicianBoard({ greed: 4 });
  refused(() => playRaw(short.engine, P1, short.id("rt")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("rt")), "hand");
  const twoG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rt", def: printing(TECHNICIAN), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 3, P1)]
  });
  play(twoG.engine, P1, twoG.id("rt"));
  assert.equal(zoneOf(twoG.engine, twoG.id("rt")), "play", "control: exactly [G][G] plus three other resources is enough");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rt", def: printing(TECHNICIAN), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 7, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("rt")), "one [G] is not [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rt")), "hand");
});

// =============================================================================
// Revivatate (2nd Edition)
// COST: Play this only during your turn. Pick 2 characters in your discard pile.
// EFFECT: Put 1 of the characters into play under your control. Put the other
//   character into your hand.
// Tactic, banker, cost 6, [G][G][G][G][G].
// =============================================================================

const REVIVATATE = "514f9887-0efa-4187-90c4-e49d079b2ad4";

/** A character with a "when this enters play, draw a card" trigger, so a test can tell "put into play" from "put into hand". */
const drawOnEnter = (name: string): CardDefinition =>
  character({
    name,
    cost: 1,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });

function revivatateBoard(opts: { greed?: number; rage?: number; active?: Pid; turn?: number; extra?: CardPlacement[]; chars?: CardDefinition[] } = {}) {
  const chars = opts.chars ?? [
    character({ name: "Alpha", strength: 3, life: 3, speed: 2 }),
    character({ name: "Beta", strength: 1, life: 5, speed: 1 }),
    character({ name: "Gamma", strength: 2, life: 2, speed: 3 })
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rev", def: printing(REVIVATATE), owner: P1, zone: "hand" },
      ...chars.map((def, i) => ({ key: `c${i}`, def, owner: P1, zone: "discard" as const })),
      { key: "tac", def: tactic({ name: "Spent Tactic", cost: 1 }), owner: P1, zone: "discard" },
      { key: "itm", def: item({ name: "Spent Item" }), owner: P1, zone: "discard" },
      { key: "oc0", def: character({ name: "Their Dead One" }), owner: P2, zone: "discard" },
      { key: "oc1", def: character({ name: "Their Dead Two" }), owner: P2, zone: "discard" },
      { key: "inplay", def: character({ name: "On Table" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "indeck", def: character({ name: "In Deck" }), owner: P1, zone: "deck" },
      ...fillers("e", 2, P2, "hand"),
      ...bank("greed", opts.greed ?? 8, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", 6, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the "which one goes into play" prompt. */
function chooseForPlay(engine: SpoilsEngine, cardId: string): void {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the caster is asked which character goes into play");
  assert.equal(pc.playerId, P1);
  pickTargets(engine, P1, [cardId]);
}

clause(REVIVATATE, "0:ability", "COST: pays 6; the two picked characters are chosen as the tactic is played and stay in the discard pile until it resolves", () => {
  const { engine, id } = revivatateBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  assert.equal(before - ready(engine), 6, "the printed cost of 6 is paid");
  assert.equal(zoneOf(engine, id("c0")), "discard", "nothing has moved while the opponent may respond");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  chooseForPlay(engine, id("c0"));
});

clause(REVIVATATE, "0:ability", "EFFECT: of the two picked characters the one you choose enters play under your control and the other goes to your hand", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c1"));
  assert.equal(zoneOf(engine, id("c1")), "play", "the chosen one is in play");
  assert.equal(controllerOf(engine, id("c1")), P1, "under your control");
  assert.ok(playOf(engine, P1).includes(id("c1")), "playOf(engine, P1).includes(id(\"c1\"))");
  assert.equal(zoneOf(engine, id("c0")), "hand", "the other one is in your hand");
  assert.ok(handOf(engine, P1).includes(id("c0")), "handOf(engine, P1).includes(id(\"c0\"))");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(REVIVATATE, "0:ability", "...and it works the other way round: choosing the first pick for play sends the second to hand", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(zoneOf(engine, id("c1")), "hand");
});

clause(REVIVATATE, "0:ability", "exactly one goes into play and exactly one into hand: neither is left in the discard pile, and an unpicked character is untouched", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("c2")), "discard", "a character that was not picked stays in the discard pile");
  assert.equal(zoneOf(engine, id("tac")), "discard");
  assert.equal(zoneOf(engine, id("itm")), "discard");
  assert.equal(zoneOf(engine, id("oc0")), "discard", "the opponent's discard pile is untouched");
  assert.equal(zoneOf(engine, id("oc1")), "discard");
  const playCount = playOf(engine, P1).filter((c) => ["c0", "c1", "c2"].some((k) => id(k) === c)).length;
  assert.equal(playCount, 1, "only one of the characters entered play");
  assert.equal(handOf(engine, P1).filter((c) => ["c0", "c1", "c2"].some((k) => id(k) === c)).length, 1, "only one came to the hand");
});

clause(REVIVATATE, "0:ability", "the caster (not the opponent) chooses which one goes into play, and the choice must be one of the two picked", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  const pc = pending(engine);
  assert.equal(pc?.playerId, P1, "the caster chooses");
  refused(() => pickTargets(engine, P1, [id("c2")]), "an unpicked character in the discard pile cannot be the one");
  refused(() => pickTargets(engine, P1, [id("oc0")]), "nor can the opponent's card");
  refused(() => pickTargets(engine, P1, [id("inhand")]), "nor a card from elsewhere");
  assert.ok(pending(engine), "the prompt is still open");
  assert.equal(zoneOf(engine, id("c2")), "discard");
  pickTargets(engine, P1, [id("c0")]);
  assert.equal(zoneOf(engine, id("c0")), "play", "control: a picked character is accepted");
});

clause(REVIVATATE, "0:ability", "exactly one character is put into play: choosing both or none is refused (the other must go to the hand)", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  refused(() => pickTargets(engine, P1, [id("c0"), id("c1")]), "both into play");
  refused(() => pickTargets(engine, P1, []), "neither into play");
  assert.equal(zoneOf(engine, id("c0")), "discard");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  pickTargets(engine, P1, [id("c1")]);
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(zoneOf(engine, id("c0")), "hand");
});

clause(REVIVATATE, "0:ability", "the tactic itself is spent: it ends up in the caster's discard pile", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("rev")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("rev")), "discardOf(engine, P1).includes(id(\"rev\"))");
});

clause(REVIVATATE, "0:ability", "the character put into play really enters play (its 'when this enters play' trigger fires); the one put into hand does not trigger", () => {
  const chars = [drawOnEnter("Drawer A"), drawOnEnter("Drawer B")];
  for (const [chosen, otherKey] of [
    ["c0", "c1"],
    ["c1", "c0"]
  ] as const) {
    const { engine, id } = revivatateBoard({ chars });
    const handBefore = handOf(engine, P1).length;
    const deckBefore = deckOf(engine, P1).length;
    play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
    chooseForPlay(engine, id(chosen));
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id(chosen)), "play");
    assert.equal(zoneOf(engine, id(otherKey)), "hand");
    assert.equal(deckOf(engine, P1).length, deckBefore - 1, "exactly one enters-play trigger fired: one card drawn");
    assert.equal(handOf(engine, P1).length, handBefore - 1 + 1 + 1, "-Revivatate, +the card put into hand, +the drawn card");
  }
});

clause(REVIVATATE, "0:ability", "COST: Pick 2 characters in YOUR discard pile: the opponent's discarded characters, items, tactics and cards elsewhere are refused", () => {
  const { engine, id } = revivatateBoard();
  const attempt = (a: string, b: string) => () => playRaw(engine, P1, id("rev"), { selected: { picks: [id(a), id(b)] } });
  refused(attempt("c0", "oc0"), "one of them in the opponent's discard pile");
  refused(attempt("oc0", "oc1"), "both in the opponent's discard pile");
  refused(attempt("c0", "tac"), "a tactic in my discard pile");
  refused(attempt("c0", "itm"), "an item in my discard pile");
  refused(attempt("c0", "inplay"), "a character in play");
  refused(attempt("c0", "inhand"), "a character in hand");
  refused(attempt("c0", "indeck"), "a character in my deck");
  assert.equal(zoneOf(engine, id("rev")), "hand", "nothing was played");
  assert.equal(ready(engine), 8, "nothing was paid");
  attempt("c0", "c1")();
  assert.ok(engine.state.responseWindow, "control: two characters in my discard pile are accepted");
});

clause(REVIVATATE, "0:ability", "COST: Pick 2: exactly two, not one and not three", () => {
  const { engine, id } = revivatateBoard();
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0")] } }), "one pick");
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1"), id("c2")] } }), "three picks");
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [] } }), "no picks");
  refused(() => playRaw(engine, P1, id("rev")), "no selection at all");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(ready(engine), 8);
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c2")] } });
  assert.ok(engine.state.responseWindow, "control: exactly two are accepted");
});

clause(REVIVATATE, "0:ability", "COST: Pick 2 characters means two different cards: picking the same character twice is refused", () => {
  const { engine, id } = revivatateBoard();
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c0")] } }), "the same character twice");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(ready(engine), 8);
});

clause(REVIVATATE, "0:ability", "COST: with only one character in my discard pile two cannot be picked, so it cannot be played", () => {
  const { engine, id } = revivatateBoard({ chars: [character({ name: "Lonely" })] });
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0")] } }), "only one character in the discard pile");
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("tac")] } }), "a tactic cannot be the second");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(ready(engine), 8);
});

clause(REVIVATATE, "0:ability", "COST: Play this only during your turn: refused in a response window on the opponent's turn", () => {
  const { engine, id } = revivatateBoard({
    active: P2,
    turn: 3,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } }), "it is not my turn", /./);
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(ready(engine), 8, "nothing was paid");
  // control: the very same play is fine on my own turn
  const own = revivatateBoard();
  play(own.engine, P1, own.id("rev"), { selected: { picks: [own.id("c0"), own.id("c1")] } });
  assert.equal(pending(own.engine)?.kind, "chooserSelectsTarget", "control: on my own turn it works");
});

clause(REVIVATATE, "0:ability", "COST: Play this only during your turn: refused outside my turn even with no window open", () => {
  const { engine, id } = revivatateBoard({ active: P2, turn: 3 });
  refused(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } }), "it is not my turn", /./);
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(REVIVATATE, "0:ability", "costs 6 with [G][G][G][G][G]: pays exactly 6; one resource short, or only four [G], is refused", () => {
  const exact = revivatateBoard({ greed: 5, rage: 1 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("rev"), { selected: { picks: [exact.id("c0"), exact.id("c1")] } });
  assert.equal(before - ready(exact.engine), 6, "[G]x5 and one other resource is enough");
  const short = revivatateBoard({ greed: 0, rage: 5, extra: bank("greed", 5, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(() => playRaw(short.engine, P1, short.id("rev"), { selected: { picks: [short.id("c0"), short.id("c1")] } }), "five ready resources are one short of 6 (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("rev")), "hand");
  const fourG = revivatateBoard({ greed: 4, rage: 4 });
  refused(() => playRaw(fourG.engine, P1, fourG.id("rev"), { selected: { picks: [fourG.id("c0"), fourG.id("c1")] } }), "four [G] is one short of [G]x5", /Threshold requirements are not met/);
  assert.equal(zoneOf(fourG.engine, fourG.id("rev")), "hand");
});

// =============================================================================
// Samuel Gristwalter (2nd Edition)
// UNIQUE SAMUEL
// Reduce all damage inflicted to your faction to 0.
// Character (lawyer, mau), banker, cost 4, [G][G][G][G], 0 strength / 1 speed / 3 life.
// =============================================================================

const SAMUEL = "2a12ebc8-8b84-4ccf-a4db-c125be6082b3";

/** A free tactic dealing `amount` damage to `who`'s faction (relative to its controller). */
const burnTactic = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Burn${who}${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }] }] }
  });

/** A free tactic making `who`'s faction LOSE `amount` influence (not damage). */
const drainTacticOf = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Drain${who}${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "drain", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] }
  });

function samuelBoard(opts: { samuel?: boolean; p2Strength?: number; extra?: CardPlacement[]; active?: Pid; samuelZone?: "play" | "hand" | "discard" } = {}) {
  const cards: CardPlacement[] = [
    { key: "atk", def: character({ name: "Attacker", strength: opts.p2Strength ?? 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
    ...(opts.extra ?? [])
  ];
  if (opts.samuel !== false) cards.push({ key: "sam", def: printing(SAMUEL), owner: P1, zone: opts.samuelZone ?? "play" });
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 2, activePlayerId: opts.active ?? P2, cards });
}

const START_INFLUENCE = 30;

const samuelHitsFaction = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => {
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, []);
};

clause(SAMUEL, "0:unique", "a second copy: its controller chooses which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("sam"), id("sam2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("sam2") });
  assert.equal(zoneOf(engine, id("sam2")), "play");
  assert.equal(zoneOf(engine, id("sam")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SAMUEL, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("sam") });
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "discard");
});

clause(SAMUEL, "0:unique", "the choice may not name a card that is not one of the copies", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "the bystander is not a copy");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(engine.state.pendingChoice, "still waiting for a real answer");
  answerPending(engine, "uniqueSurvivor", { keep: id("sam") });
  assert.equal(zoneOf(engine, id("sam")), "play", "control: a real copy is accepted");
});

clause(SAMUEL, "0:unique", "UNIQUE is per player: the opponent may control their own Samuel with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P2, zone: "hand" },
      ...bank("greed", 4, P2)
    ]
  });
  play(engine, P2, id("sam2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "play");
});

clause(SAMUEL, "0:unique", "a second copy in hand (not in play) is no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "hand");
});

clause(SAMUEL, "0:unique", "after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "discard" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam2")), "play");
});

clause(SAMUEL, "0:unique", "a face-down copy is just a resource and does not conflict with a face-up Samuel", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "hidden", def: printing(SAMUEL), owner: P1, zone: "play", faceDown: true }
    ]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("hidden")), "play");
});

clause(SAMUEL, "0:unique", "taking control of my opponent's Samuel while I control one makes me choose which to keep (FAQ), and the game goes on", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mySam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "theirSam", def: printing(SAMUEL), owner: P2, zone: "play" },
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("theirSam")] } });
  resolvePendingResponses(engine);
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "uniqueSurvivor", { keep: id("theirSam") });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("theirSam")), "play");
  assert.equal(controllerOf(engine, id("theirSam")), P1);
  assert.equal(zoneOf(engine, id("mySam")), "discard");
});

for (const amount of [1, 2, 5, 9]) {
  clause(SAMUEL, "1:rule", `an unblocked ${amount}-strength attacker's damage to my faction is reduced to 0: influence stays the same`, () => {
    const { engine, id } = samuelBoard({ p2Strength: amount });
    const before = influenceOf(engine, P1);
    samuelHitsFaction(engine, id);
    assert.equal(isDepleted(engine, id("atk")), true, "control: the battle happened");
    assert.equal(influenceOf(engine, P1), before);
    assert.equal(battleOf(engine), undefined, "the battle ran to the end");
    assert.equal(engine.state.result, undefined);
  });
}

clause(SAMUEL, "1:rule", "control: without Samuel the same attack costs the faction 5 influence", () => {
  const { engine, id } = samuelBoard({ samuel: false });
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5);
});

clause(SAMUEL, "1:rule", "an attacking party of two (3 + 4 damage) inflicts nothing to my faction", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 4, life: 9, speed: 2 }), owner: P2, zone: "play" }] });
  fight(engine, P2, [id("atk"), id("atk2")], { type: "faction", playerId: P1 }, []);
  assert.equal(isDepleted(engine, id("atk2")), true, "control: both attacked");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "damage from a card effect (not only battle damage) is also reduced to 0 for my faction", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "burn", def: burnTactic(4, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("burn"));
  assert.equal(zoneOf(engine, id("burn")), "discard", "the burn was played");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "control: the same effect damages the faction when Samuel is not in play", () => {
  const { engine, id } = samuelBoard({ samuel: false, extra: [{ key: "burn", def: burnTactic(4, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("burn"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4);
});

clause(SAMUEL, "1:rule", "my own damage effect against my own faction is also reduced to 0 ('all damage inflicted to your faction')", () => {
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "selfBurn", def: burnTactic(3, "controller"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("selfBurn"));
  assert.equal(zoneOf(engine, id("selfBurn")), "discard", "control: it resolved");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "reduced to 0 means nothing is inflicted: an attacker that triggers 'when this inflicts damage' does not trigger", () => {
  const drawer = character({
    name: "Siphon",
    strength: 3,
    life: 9,
    speed: 2,
    behavior: {
      abilities: [
        { id: "sip", type: "triggered", event: "damageDealt", condition: { type: "sourceIsDamageSource" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });
  const withSamuel = samuelBoard({ extra: [{ key: "sip", def: drawer, owner: P2, zone: "play" }, ...fillers("sd", 3, P2, "deck")] });
  fight(withSamuel.engine, P2, [withSamuel.id("sip")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(withSamuel.engine, P1), START_INFLUENCE);
  assert.equal(deckOf(withSamuel.engine, P2).length, 3, "no damage was inflicted, so nothing triggered");
  const control = samuelBoard({ samuel: false, extra: [{ key: "sip", def: drawer, owner: P2, zone: "play" }, ...fillers("sd", 3, P2, "deck")] });
  fight(control.engine, P2, [control.id("sip")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(control.engine, P1), START_INFLUENCE - 3, "control: without Samuel the damage lands");
  assert.equal(deckOf(control.engine, P2).length, 2, "control: and the trigger fires");
});

clause(SAMUEL, "1:rule", "only DAMAGE is reduced: an effect making my faction LOSE influence still works (CR 408.3b)", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "drain", def: drainTacticOf(3, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("drain"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 3);
});

clause(SAMUEL, "1:rule", "only DAMAGE is reduced: Mafia Lawyer's 'your faction loses 2 influence' still costs the Samuel player 2", () => {
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "law", def: printing(MAFIA), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
});

clause(SAMUEL, "1:rule", "gaining influence is unaffected: a +2 influence effect still gives 2", () => {
  const gain = tactic({ name: "Gain2", cost: 0, behavior: { abilities: [{ id: "g", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }] } });
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "gain", def: gain, owner: P1, zone: "hand" }] });
  play(engine, P1, id("gain"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 2);
});

clause(SAMUEL, "1:rule", "'your faction' only: the opponent's faction still takes damage from my attackers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE - 4);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "an opponent's Samuel protects THEIR faction only: mine still takes damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4);
});

clause(SAMUEL, "1:rule", "'your' faction means the controller's: a Samuel owned by P1 but controlled by P2 protects P2's faction, not P1's", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, controller: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 4, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P1, [id("a1")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE, "P2 controls Samuel: protected");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  fight(engine, P2, [id("a2")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 3, "P1 owns Samuel but does not control it: unprotected");
});

clause(SAMUEL, "1:rule", "it only protects while in play: Samuel in hand or in the discard pile does nothing", () => {
  for (const samuelZone of ["hand", "discard"] as const) {
    const { engine, id } = samuelBoard({ samuelZone });
    samuelHitsFaction(engine, id);
    assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5, `Samuel in ${samuelZone}`);
  }
});

clause(SAMUEL, "1:rule", "a face-down Samuel is just a resource: it protects nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5);
});

clause(SAMUEL, "1:rule", "once Samuel leaves play the faction can be damaged again", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(engine, P2, id("kill"), { selected: { t: [id("sam")] } });
  assert.equal(zoneOf(engine, id("sam")), "discard");
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5);
});

clause(SAMUEL, "1:rule", "a faction at 1 influence survives any amount of damage while Samuel is in play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 1 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 9, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), 1);
  assert.equal(engine.state.result, undefined);
});

clause(SAMUEL, "1:rule", "only the FACTION is protected: Samuel himself and other characters take battle damage normally", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "friend", def: character({ name: "Friend", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("sam")]);
  assert.equal(damageOf(engine, id("sam")), 2, "Samuel took the 2 damage");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  fight(engine, P2, [id("atk2")], { type: "faction", playerId: P1 }, [id("friend")]);
  assert.equal(damageOf(engine, id("friend")), 3);
});

clause(SAMUEL, "1:rule", "only the FACTION is protected: an attacked location takes its damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 5 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "card", cardId: id("place") }, []);
  assert.equal(damageOf(engine, id("place")), 3, "the location is damaged");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "the card itself: cost 4 with [G][G][G][G], printed 0 strength / 1 speed / 3 life; one short or three [G] only is refused", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sam", def: printing(SAMUEL), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sam", def: printing(SAMUEL), owner: P1, zone: "hand" }, ...bank("greed", 4, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 3, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("sam")), "3 ready is one short of the cost 4 (threshold met by spent icons)", /Costs cannot be paid/);
  const noThreshold = mk(3, 5);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("sam")), "three Greed is one short of [G][G][G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("sam")), "hand");
  const ok = mk(4, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("sam"));
  assert.equal(before - ready(ok.engine), 4);
  assert.deepEqual([ok.engine.getStat(ok.id("sam"), "strength"), ok.engine.getStat(ok.id("sam"), "speed"), ok.engine.getStat(ok.id("sam"), "life")], [0, 1, 3]);
});

// =============================================================================
// Shocking Reappearance (2nd Edition)
// COST: Play this only while you are being attacked. Pick a character in your
//   discard pile.
// EFFECT: Put the character into play under your control as a member of the
//   blocking party.
// Tactic, banker, cost 5, [G][G][G].
// =============================================================================

const REAPPEARANCE = "5c0666cc-d71f-41c3-86ef-32410cbe4e4e";

/** P2 is the active player and attacks P1's faction with `atk`; P1 holds the tactic. Returns before anyone responds. */
function reappearanceBoard(opts: { icons?: Icons; extra?: CardPlacement[]; bigAttacker?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "discard" },
      { key: "corpse2", def: character({ name: "Corpse2", strength: 1, life: 1, speed: 2 }), owner: P1, zone: "discard" },
      { key: "oppCorpse", def: character({ name: "OppCorpse" }), owner: P2, zone: "discard" },
      { key: "itemCorpse", def: item({ name: "ItemCorpse" }), owner: P1, zone: "discard" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: opts.bigAttacker ? 6 : 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 8 }),
      ...(opts.extra ?? [])
    ]
  });
}

type ReappearanceGame = ReturnType<typeof reappearanceBoard>;

/** Passes priority until it is `player`'s turn to respond in the open battle window. */
function untilPriority(engine: SpoilsEngine, player: PlayerId): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player) {
    assert.ok(guard++ < 10, "priority never reached the player");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** The attack is declared and P1 (the defender) holds priority in the declaration window: no blockers declared yet. */
function reachDeclarationWindow(g: ReappearanceGame): void {
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
}

/** The attack is declared, P1 declares `blockers`, and P1 has priority in the first damage window. */
function reachBlockingWindow(g: ReappearanceGame, blockers: string[]): void {
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers.map(g.id) });
  untilPriority(g.engine, P1);
}

const playSR = (g: ReappearanceGame, key: string) => playRaw(g.engine, P1, g.id("sr"), { selected: { c: [g.id(key)] } });

clause(REAPPEARANCE, "0:ability", "while blockers are declared: pays 5, puts the picked character from my discard pile into play under my control and adds it to the blocking party", () => {
  const g = reappearanceBoard();
  reachBlockingWindow(g, ["blk"]);
  const before = ready(g.engine);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 5, "the printed cost of 5 is paid");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play", "the character is put into play");
  assert.equal(controllerOf(g.engine, g.id("corpse")), P1, "under my control");
  assert.equal(g.engine.state.cards[g.id("corpse")].ownerId, P1);
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("corpse")), "it is added to the blocking party");
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("blk")), "the original blocker is still blocking");
  assert.equal(battleOf(g.engine)?.blockingParty.length, 2);
  assert.equal(zoneOf(g.engine, g.id("sr")), "discard", "the tactic ends in its owner's discard pile");
  assert.equal(zoneOf(g.engine, g.id("corpse2")), "discard", "a character I did not pick stays in the discard pile");
});

clause(REAPPEARANCE, "0:ability", "the character is a real member of the blocking party: it takes the attacker's damage and deals its own strength in battle", () => {
  const g = reappearanceBoard();
  reachBlockingWindow(g, ["blk"]);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  autoResolveBattle(g.engine, (source) => (source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(battleOf(g.engine), undefined, "the battle resolved");
  assert.equal(damageOf(g.engine, g.id("atk")), 3 + 1, "the attacker took the reappeared character's 3 strength plus the other blocker's 1");
});

clause(REAPPEARANCE, "0:ability", "'while you are being attacked' includes the declaration window, before blockers: the character becomes (part of) the blocking party that forms next", () => {
  const g = reappearanceBoard();
  reachDeclarationWindow(g);
  assert.equal(battleOf(g.engine)?.blockingParty.length ?? 0, 0, "setup: no blocking party yet");
  const before = ready(g.engine);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine), 5, "it could be played: I am being attacked");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play");
  assert.equal(controllerOf(g.engine, g.id("corpse")), P1);
  // the defender may still declare blockers; the reappeared character joins them when the party forms
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("blk")] });
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("corpse")), "the reappeared character is in the blocking party");
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("blk")), "alongside the declared blocker");
});

clause(REAPPEARANCE, "0:ability", "played in the declaration window with no blockers declared afterwards: the reappeared character IS the blocking party and takes the damage", () => {
  const g = reappearanceBoard();
  reachDeclarationWindow(g);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("corpse")], "it is the whole blocking party");
  autoResolveBattle(g.engine, (source) => (source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(influenceOf(g.engine, P1), 20, "the attacker's damage went to the blocking party, not my faction");
  assert.equal(damageOf(g.engine, g.id("corpse")), 2, "the attacker's 2 strength landed on the reappeared character");
  assert.equal(damageOf(g.engine, g.id("atk")), 3, "and it dealt its 3 strength back");
});

clause(REAPPEARANCE, "0:ability", "the reappeared character survives the battle as a participant: it is depleted afterwards like every surviving member (CR 609.1h)", () => {
  const g = reappearanceBoard();
  reachBlockingWindow(g, ["blk"]);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  autoResolveBattle(g.engine, (source) => (source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play");
  assert.equal(isDepleted(g.engine, g.id("corpse")), true, "depleted as a surviving member of the battle");
  assert.equal(isDepleted(g.engine, g.id("idle")), false, "a character that was not in the battle is not depleted");
});

clause(REAPPEARANCE, "0:ability", "'play this only while you are being attacked': refused when there is no battle at all", () => {
  const g = reappearanceBoard();
  refused(() => playSR(g, "corpse"), "no battle");
  assert.equal(zoneOf(g.engine, g.id("sr")), "hand");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "discard");
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

clause(REAPPEARANCE, "0:ability", "'play this only while you are being attacked': refused when I am the attacker (my opponent is the one being attacked)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 8 })
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("blk")] });
  untilPriority(g.engine, P1);
  refused(() => playRaw(g.engine, P1, g.id("sr"), { selected: { c: [g.id("corpse")] } }), "I am attacking, not being attacked");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sr")), "hand");
});

clause(REAPPEARANCE, "0:ability", "'play this only while you are being attacked': refused once the battle is over", () => {
  const g = reappearanceBoard({ extra: [{ key: "opp", def: character({ name: "Opp", cost: 0 }), owner: P2, zone: "hand" }] });
  reachBlockingWindow(g, ["blk"]);
  autoResolveBattle(g.engine);
  assert.equal(battleOf(g.engine), undefined, "setup: the battle finished");
  // give P1 a real open window (P2 deploys a character) so only the card's own condition can refuse it
  playRaw(g.engine, P2, g.id("opp"));
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "P1 holds priority in an open window");
  refused(() => playSR(g, "corpse"), "the attack is over", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("corpse")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sr")), "hand");
});

clause(REAPPEARANCE, "0:ability", "being attacked includes an attack on my LOCATION (the attacker names a location I control)", () => {
  const g = reappearanceBoard({ extra: [{ key: "home", def: location({ name: "Home", structure: 9 }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("atk")], target: { type: "card", cardId: g.id("home") } });
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("blk")] });
  untilPriority(g.engine, P1);
  playSR(g, "corpse");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play");
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("corpse")), "added to the blocking party");
});

clause(REAPPEARANCE, "0:ability", "the pick must be a CHARACTER in MY discard pile: an item in my discard, a character in the opponent's discard, in my hand, or in play are refused", () => {
  const g = reappearanceBoard({ extra: [{ key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }] });
  reachBlockingWindow(g, ["blk"]);
  const attempt = (picked: string) => () => playRaw(g.engine, P1, g.id("sr"), { selected: { c: [picked] } });
  refused(attempt(g.id("itemCorpse")), "an item in my discard pile");
  refused(attempt(g.id("oppCorpse")), "a character in the opponent's discard pile");
  refused(attempt(g.id("handChar")), "a character in my hand");
  refused(attempt(g.id("idle")), "a character already in play");
  refused(attempt(g.id("atk")), "the attacking character");
  refused(attempt(factionOf(g.engine, P1)), "my faction");
  refused(() => playRaw(g.engine, P1, g.id("sr"), { selected: {} }), "no pick at all");
  refused(() => playRaw(g.engine, P1, g.id("sr"), { selected: { c: [g.id("corpse"), g.id("corpse2")] } }), "only one character is picked");
  assert.equal(zoneOf(g.engine, g.id("sr")), "hand", "none of those attempts played the card");
  assert.equal(ready(g.engine), 8, "and nothing was paid");
  attempt(g.id("corpse2"))();
  assert.ok(g.engine.state.responseWindow, "control: a character in my discard pile is accepted");
});

clause(REAPPEARANCE, "0:ability", "with no character in my discard pile the card cannot be played", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "itemCorpse", def: item({ name: "ItemCorpse" }), owner: P1, zone: "discard" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...res({ greed: 8 })
    ]
  });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("blk")] });
  untilPriority(g.engine, P1);
  refused(() => playRaw(g.engine, P1, g.id("sr"), { selected: {} }), "nothing to pick");
  refused(() => playRaw(g.engine, P1, g.id("sr"), { selected: { c: [g.id("itemCorpse")] } }), "an item is not a character");
  assert.equal(zoneOf(g.engine, g.id("sr")), "hand");
});

clause(REAPPEARANCE, "0:ability", "the character enters play for real: its 'enters play' trigger fires", () => {
  const enterer = character({
    name: "Enterer",
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const g = reappearanceBoard({ extra: [{ key: "enterer", def: enterer, owner: P1, zone: "discard" }, ...fillers("a", 3, P1, "deck")] });
  reachBlockingWindow(g, ["blk"]);
  const handBefore = handOf(g.engine, P1).length;
  playSR(g, "enterer");
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("enterer")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "the tactic left my hand; the entered character's trigger drew a card");
});

clause(REAPPEARANCE, "0:ability", "the cost is paid when played, the character arrives only when the tactic resolves (the opponent can respond first)", () => {
  const g = reappearanceBoard();
  reachBlockingWindow(g, ["blk"]);
  const before = ready(g.engine);
  playSR(g, "corpse");
  assert.equal(before - ready(g.engine), 5, "paid up front");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "discard", "still in the discard pile while the opponent may respond");
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("corpse")), false);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play");
});

clause(REAPPEARANCE, "0:ability", "is refused one resource short of its cost of 5, and without [G][G][G] even with plenty of other resources", () => {
  const attemptWith = (icons: Icons) => {
    const g = reappearanceBoard({ icons });
    reachBlockingWindow(g, ["blk"]);
    return { g, run: () => playSR(g, "corpse") };
  };
  const short = attemptWith({ greed: 4 });
  refused(short.run, "4 resources: one short");
  assert.equal(zoneOf(short.g.engine, short.g.id("sr")), "hand");
  const twoGreed = attemptWith({ greed: 2, rage: 6 });
  refused(twoGreed.run, "only two [G]");
  assert.equal(zoneOf(twoGreed.g.engine, twoGreed.g.id("sr")), "hand");
  const exact = attemptWith({ greed: 3, rage: 2 });
  exact.run();
  resolvePendingResponses(exact.g.engine);
  assert.equal(zoneOf(exact.g.engine, exact.g.id("corpse")), "play", "[G][G][G] and exactly 5 resources is enough");
  assert.equal(ready(exact.g.engine), 0);
});

// =============================================================================
// Smear Campaign (2nd Edition)
// ATTACH TO CHARACTER
// If the attached character inflicts damage, inflict the same amount of damage
// to the character's controller's faction.
// Item (gear), banker, cost 0, [G].
// =============================================================================

const SMEAR = "ab6eb72b-595b-435a-b03b-ca9e6b1299d1";

/** A character with a free ability "zap" dealing `amount` damage to one chosen character (declaration `t`). */
const zapper = (name: string, amount: number, extra: Partial<CardDefinition> = {}) =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    },
    ...extra
  });

function smearBoard(
  opts: { smear?: "hand" | "play"; host?: "host" | "foeHost"; greed?: number; rage?: number; active?: Pid; hostDef?: CardDefinition; extra?: CardPlacement[]; influenceA?: number; influenceB?: number } = {}
) {
  const where = opts.smear ?? "play";
  const hostKey = opts.host ?? "host";
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influenceA },
    playerB: { faction: developFaction(), influence: opts.influenceB },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "smear", def: printing(SMEAR), owner: P1, zone: where, attachedToKey: where === "play" ? hostKey : undefined },
      { key: "host", def: opts.hostDef ?? character({ name: "Host", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeHost", def: character({ name: "Foe Host", strength: 3, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk1", def: character({ name: "Blocker One", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 2, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SMEAR, "0:attach", "is played onto a character: it enters play attached to the chosen host, costs nothing (cost 0) and leaves the hand", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const before = ready(engine);
  play(engine, P1, id("smear"), { selected: { attachTo: [id("host")] } });
  assert.equal(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, id("host"));
  assert.equal(before - ready(engine), 0, "cost 0: no resource is spent");
  assert.equal(handOf(engine, P1).includes(id("smear")), false);
});

clause(SMEAR, "0:attach", "the host can be any character, yours or the opponent's; the Campaign stays under its player's control", () => {
  for (const hostKey of ["host", "foeHost"] as const) {
    const { engine, id } = smearBoard({ smear: "hand" });
    play(engine, P1, id("smear"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(engine.state.cards[id("smear")].attachedTo, id(hostKey), hostKey);
    assert.equal(controllerOf(engine, id("smear")), P1);
  }
});

clause(SMEAR, "0:attach", "is refused for a host that is not a character (item, location, faction), or with no host chosen; the card stays in hand", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("smear"), { selected: { attachTo: [hostId] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(factionOf(engine, P1)), "your faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(() => playRaw(engine, P1, id("smear"), { selected: {} }), "no host");
  assert.equal(zoneOf(engine, id("smear")), "hand");
  attempt(id("other"))();
  assert.ok(engine.state.responseWindow, "control: a character host is accepted");
});

clause(SMEAR, "0:attach", "a face-down card (just a resource) is not a character host", () => {
  const { engine, id } = smearBoard({ smear: "hand", extra: [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] });
  refused(() => playRaw(engine, P1, id("smear"), { selected: { attachTo: [id("hidden")] } }), "a face-down card");
  assert.equal(zoneOf(engine, id("smear")), "hand");
  playRaw(engine, P1, id("smear"), { selected: { attachTo: [id("other")] } });
  assert.ok(engine.state.responseWindow, "control: a face-up character is accepted");
});

clause(SMEAR, "0:attach", "needs [G]: refused with no greed icon (even with resources), accepted with one", () => {
  const none = smearBoard({ smear: "hand", greed: 0, rage: 4 });
  refused(() => playRaw(none.engine, P1, none.id("smear"), { selected: { attachTo: [none.id("host")] } }), "no [G]");
  assert.equal(zoneOf(none.engine, none.id("smear")), "hand");
  const one = smearBoard({ smear: "hand", greed: 1 });
  play(one.engine, P1, one.id("smear"), { selected: { attachTo: [one.id("host")] } });
  assert.equal(zoneOf(one.engine, one.id("smear")), "play");
  assert.equal(ready(one.engine), 1, "[G] is a threshold, not a cost: the resource is not spent");
});

clause(SMEAR, "0:attach", "when its host is destroyed the Campaign is destroyed with it (to its owner's discard pile)", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("smear")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("smear")), "discardOf(engine, P1).includes(id(\"smear\"))");
});

clause(SMEAR, "0:attach", "when its host is returned to hand the Campaign leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("smear")), "hand", "an attached card leaves play the same way its host does");
  assert.ok(handOf(engine, P1).includes(id("smear")), "handOf(engine, P1).includes(id(\"smear\"))");
});

clause(SMEAR, "0:attach", "when its host is returned to hand the Campaign does not stay on the table unattached", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.notEqual(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, undefined);
});

clause(SMEAR, "0:attach", "a Campaign on an opponent's character: when that character is destroyed the Campaign goes to its OWNER's discard pile", () => {
  const { engine, id } = smearBoard({ host: "foeHost", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("foeHost")] } });
  assert.equal(zoneOf(engine, id("smear")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("smear")), "my card goes to my discard pile");
  assert.equal(discardOf(engine, P2).includes(id("smear")), false);
});

clause(SMEAR, "0:attach", "if its host stops being a character (flipped face-down into a resource) the Campaign is flipped face-down with it", () => {
  const flip = tactic({
    name: "Flip Down",
    cost: 0,
    behavior: { abilities: [{ id: "fd", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = smearBoard({ extra: [{ key: "flip", def: flip, owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("host")] } });
  assert.equal(isFaceDown(engine, id("host")), true, "control: the host is now a face-down resource");
  assert.equal(zoneOf(engine, id("smear")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("smear")].faceDown, true, "...and is flipped face-down along with its host");
});

/** The host (controlled by P1) attacks P2's faction unblocked; returns the two factions' influence changes. */
function hostHitsFaction(engine: SpoilsEngine, id: (key: string) => string, hostKey = "host") {
  const a = influenceOf(engine, P1);
  const b = influenceOf(engine, P2);
  fightThrough(engine, P1, [id(hostKey)], { type: "faction", playerId: P2 }, []);
  return { mine: a - influenceOf(engine, P1), theirs: b - influenceOf(engine, P2) };
}

clause(SMEAR, "1:rule", "control: without the Campaign the host's battle damage hurts only the defending faction", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 0);
});

clause(SMEAR, "1:rule", "the host hits a faction for 3: the defender loses 3 AND the host's controller's own faction takes an equal 3 damage", () => {
  const { engine, id } = smearBoard();
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3, "the battle damage itself");
  assert.equal(mine, 3, "an equal amount of damage to the character's controller's faction");
  assert.equal(damageOf(engine, factionOf(engine, P1)), 0, "a faction takes damage as lost influence, it holds no damage");
});

clause(SMEAR, "1:rule", "the amount is the amount inflicted: strength 5 gives 5, strength 1 gives 1", () => {
  for (const strength of [1, 5]) {
    const { engine, id } = smearBoard({ hostDef: character({ name: "Host", strength, life: 6, speed: 2 }) });
    const { mine, theirs } = hostHitsFaction(engine, id);
    assert.equal(theirs, strength);
    assert.equal(mine, strength, `strength ${strength}`);
  }
});

clause(SMEAR, "1:rule", "it triggers on damage to a CHARACTER too: a blocked host damaging the blocker costs its controller's faction the same amount", () => {
  const { engine, id } = smearBoard();
  const before = influenceOf(engine, P1);
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk2")]);
  assert.equal(damageOf(engine, id("blk2")), 3, "the blocker took 3");
  assert.equal(before - influenceOf(engine, P1), 3, "my faction took 3 for it");
});

clause(SMEAR, "1:rule", "the full amount counts even when it exceeds the blocker's life (overkill): 3 damage to a 2-life blocker is still 3", () => {
  const { engine, id } = smearBoard();
  const before = influenceOf(engine, P1);
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk1")]);
  assert.equal(zoneOf(engine, id("blk1")), "discard", "control: the blocker died");
  assert.equal(before - influenceOf(engine, P1), 3);
});

clause(SMEAR, "1:rule", "it triggers on damage to a LOCATION too", () => {
  const { engine, id } = smearBoard();
  const before = influenceOf(engine, P1);
  fight(engine, P1, [id("host")], { type: "card", cardId: id("place") }, []);
  assert.equal(damageOf(engine, id("place")), 3, "control: the location took 3");
  assert.equal(before - influenceOf(engine, P1), 3);
});

clause(SMEAR, "1:rule", "damage split between two blockers (2 + 1 of strength 3) adds up: the faction takes 3 in all", () => {
  const { engine, id } = smearBoard();
  const before = influenceOf(engine, P1);
  fightThrough(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk1"), id("blk2")], (source) => {
    if (source.cardId !== id("host")) return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
    const t1 = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("blk1"))!;
    const t2 = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("blk2"))!;
    return [
      { sourceId: source.cardId, target: t1, amount: 2 },
      { sourceId: source.cardId, target: t2, amount: 1 }
    ];
  });
  assert.equal(zoneOf(engine, id("blk1")), "discard", "control: 2 damage killed the 2-life blocker");
  assert.equal(damageOf(engine, id("blk2")), 1, "control: the other blocker took 1");
  assert.equal(before - influenceOf(engine, P1), 3, "an equal amount to the damage inflicted, in total");
});

clause(SMEAR, "1:rule", "damage the host inflicts from its ABILITY counts, not only battle damage", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influenceOf(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(damageOf(engine, id("blk2")), 2, "control: the ability dealt 2");
  assert.equal(before - influenceOf(engine, P1), 2);
});

clause(SMEAR, "1:rule", "...and damage dealt by the host to your own character counts as well", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influenceOf(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("other")] } });
  assert.equal(damageOf(engine, id("other")), 2);
  assert.equal(before - influenceOf(engine, P1), 2);
});

clause(SMEAR, "1:rule", "it triggers every time: two uses of the host's ability cost the faction 2 + 2", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influenceOf(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(before - influenceOf(engine, P1), 4);
});

clause(SMEAR, "1:rule", "only the ATTACHED character: damage inflicted by another of your characters costs nothing", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "zapOther", def: zapper("Zap Other", 2), owner: P1, zone: "play" }] });
  const before = influenceOf(engine, P1);
  activate(engine, P1, id("zapOther"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(damageOf(engine, id("blk2")), 2, "control: damage was dealt");
  assert.equal(influenceOf(engine, P1), before, "not by the attached character: no effect");
  const { mine } = hostHitsFaction(engine, id, "other");
  assert.equal(mine, 0, "battle damage by a non-host character: no effect either");
});

clause(SMEAR, "1:rule", "damage inflicted TO the host does not trigger it", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "zapFoe", def: zapper("Zap Foe", 2), owner: P2, zone: "play" }], active: P2 });
  const mineBefore = influenceOf(engine, P1);
  const theirsBefore = influenceOf(engine, P2);
  activate(engine, P2, id("zapFoe"), "zap", { selected: { t: [id("host")] } });
  assert.equal(damageOf(engine, id("host")), 2, "control: the host took 2");
  assert.equal(influenceOf(engine, P1), mineBefore);
  assert.equal(influenceOf(engine, P2), theirsBefore);
});

clause(SMEAR, "1:rule", "when the attached character deals no damage (strength 0) nothing is inflicted on the faction", () => {
  const { engine, id } = smearBoard({ hostDef: character({ name: "Host", strength: 0, life: 6, speed: 2 }) });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 0);
  assert.equal(mine, 0, "0 damage inflicts nothing and triggers nothing (CR 408.1a)");
});

clause(SMEAR, "1:rule", "it follows the CHARACTER'S controller, not the Campaign's: on an opponent's character it is the opponent's faction that takes the damage", () => {
  const { engine, id } = smearBoard({ host: "foeHost", active: P2 });
  const mineBefore = influenceOf(engine, P1);
  const theirsBefore = influenceOf(engine, P2);
  fight(engine, P2, [id("foeHost")], { type: "faction", playerId: P1 }, []);
  assert.equal(mineBefore - influenceOf(engine, P1), 3, "control: the battle damage hit my faction");
  assert.equal(theirsBefore - influenceOf(engine, P2), 3, "the foe's own faction (the host's controller) took the equal damage");
});

clause(SMEAR, "1:rule", "...and when the host changes controller the damage follows the new controller", () => {
  const { engine, id } = smearBoard({ host: "foeHost", extra: [{ key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("steal"), { selected: { t: [id("foeHost")] } });
  assert.equal(controllerOf(engine, id("foeHost")), P1, "control: I now control the host");
  assert.equal(zoneOf(engine, id("smear")), "play", "the Campaign is still attached");
  engine.state.cards[id("foeHost")].attackEligibleTurn = engine.state.turn;
  const { mine, theirs } = hostHitsFaction(engine, id, "foeHost");
  assert.equal(theirs, 3);
  assert.equal(mine, 3, "now my character: my faction takes the equal damage");
});

clause(SMEAR, "1:rule", "two Campaigns on one character both apply: 3 damage costs its controller's faction 3 + 3", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "smear2", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "host" }] });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 6);
});

clause(SMEAR, "1:rule", "a Campaign on the opponent's character and one on mine both fire for their own host only", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "smear2", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "foeHost" }] });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(mine, 3);
  assert.equal(theirs, 3, "the foe's Campaign host did not deal damage, so only my host's Campaign fired");
});

clause(SMEAR, "1:rule", "once the Campaign has left play the host's damage costs its controller nothing again", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = smearBoard({ extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  play(engine, P1, id("smash"), { selected: { t: [id("smear")] } });
  assert.equal(zoneOf(engine, id("smear")), "discard");
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 0);
});

clause(SMEAR, "1:rule", "the damage to the faction can be lethal: a faction with 3 influence reduced to 0 loses the game", () => {
  const { engine, id } = smearBoard({ influenceA: 3, influenceB: 30 });
  hostHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "the host's controller lost to their own Campaign");
});

clause(SMEAR, "1:rule", "damage the attached character inflicts to its OWN controller's faction also triggers the Campaign (it is 'damage', no exception)", () => {
  const selfHarm = character({
    name: "Self Harm",
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [{ id: "ouch", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 2 }] }]
    }
  });
  const { engine, id } = smearBoard({ hostDef: selfHarm });
  const before = influenceOf(engine, P1);
  activate(engine, P1, id("host"), "ouch");
  assert.equal(before - influenceOf(engine, P1), 4, "2 from the ability, plus an equal 2 from the Campaign");
});

clause(SMEAR, "1:rule", "the equal damage is real damage to the faction: the host controller's Samuel Gristwalter reduces it to 0 (the defender still loses 3)", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" }] });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3, "the battle damage to the defending faction");
  assert.equal(mine, 0, "Samuel reduces all damage inflicted to my faction to 0, including the Campaign's");
});

clause(SMEAR, "1:rule", "under Limited Liability all damage is reduced to 0, so the host inflicts none and the Campaign does nothing", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  play(engine, P1, id("ll"));
  assert.equal(zoneOf(engine, id("ll")), "discard", "control: Limited Liability resolved");
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 0);
  assert.equal(mine, 0);
});

clause(SMEAR, "1:rule", "a face-down Campaign (just a resource) does nothing", () => {
  const { engine, id } = smearBoard({ smear: "hand", extra: [{ key: "hiddenSmear", def: printing(SMEAR), owner: P1, zone: "play", faceDown: true }] });
  assert.equal(zoneOf(engine, id("smear")), "hand", "setup: the real Campaign stays in hand");
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 0);
});

// =============================================================================
// Snooty Doorman (2nd Edition)
// DENIED! -- COST: Use this only in response to a character being played. Destroy
//   this card.
// EFFECT: Terminate the character.
// Character (lackey), banker, cost 3, [G], 2 strength / 3 speed / 2 life.
// =============================================================================

const DOORMAN = "2cf539c6-9430-42cb-8aba-50ca05323eca";

function doormanBoard(opts: { active?: Pid; greedP1?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "door", def: printing(DOORMAN), owner: P1, zone: "play" },
      { key: "door2", def: printing(DOORMAN), owner: P1, zone: "play" },
      { key: "foeDoor", def: printing(DOORMAN), owner: P2, zone: "play" },
      { key: "cA", def: character({ name: "Newcomer", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "hand" },
      { key: "cB", def: character({ name: "Second Newcomer", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P2, zone: "hand" },
      { key: "tac", def: tactic({ name: "Their Tactic", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      { key: "itm", def: item({ name: "Their Item", cost: 1 }), owner: P2, zone: "hand" },
      { key: "loc", def: location({ name: "Their Place", cost: 1, structure: 3 }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "My Guy" }), owner: P1, zone: "play" },
      ...fillers("pd", 4, P2, "deck"),
      ...bank("greed", 10, P2),
      ...bank("greed", opts.greedP1 ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** A character with a free ability "zap" dealing `n` damage to one chosen character (declaration `t`). */
const zapperChar = (name: string, n: number): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }]
    }
  });

clause(DOORMAN, "0:ability:denied", "in response to the opponent's character being played: the character never enters play, it goes to its OWNER's discard pile", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  assert.equal(zoneOf(engine, id("cA")), "deploying", "control: it is being played");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard", "terminated: it goes to its owner's discard pile");
  assert.ok(discardOf(engine, P2).includes(id("cA")), "discardOf(engine, P2).includes(id(\"cA\"))");
  assert.equal(discardOf(engine, P1).includes(id("cA")), false, "not mine");
  assert.equal(playOf(engine, P2).includes(id("cA")), false);
  assert.equal(engine.state.responseWindow, undefined);
});

clause(DOORMAN, "0:ability:denied", "COST: the Doorman is destroyed when DENIED! is used (before it resolves), into its owner's discard pile", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard", "'Destroy this card' is a cost");
  assert.ok(discardOf(engine, P1).includes(id("door")), "discardOf(engine, P1).includes(id(\"door\"))");
  assert.equal(zoneOf(engine, id("cA")), "deploying", "the denial has not happened yet: the effect waits for responses");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "only the Doorman using it is destroyed: my other Doorman, my other characters and the opponent's Doorman stay in play", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("door")), "discard", "control: the one that was used is gone");
  assert.equal(zoneOf(engine, id("door2")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("foeDoor")), "play");
});

clause(DOORMAN, "0:ability:denied", "the denied character's cost stays paid (the opponent's resources are not refunded)", () => {
  const { engine, id } = doormanBoard();
  const before = ready(engine, P2);
  playRaw(engine, P2, id("cA"));
  assert.equal(before - ready(engine, P2), 2, "control: they paid cost 2");
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 2, "still spent");
});

clause(DOORMAN, "0:ability:denied", "it costs no resources to use and needs no threshold: usable with no resources at all", () => {
  const { engine, id } = doormanBoard({ greedP1: 0 });
  assert.equal(ready(engine, P1), 0);
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "the character never enters play: its enters-play triggers do not fire (an influence-losing one costs its owner nothing)", () => {
  const painful = character({
    name: "Painful",
    cost: 1,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: -3 }] }] }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "painful", def: painful, owner: P2, zone: "hand" }] });
  const before = influenceOf(engine, P2);
  playRaw(engine, P2, id("painful"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("painful")), "discard");
  assert.equal(influenceOf(engine, P2), before, "it never entered play");
  const control = doormanBoard({ extra: [{ key: "painful", def: painful, owner: P2, zone: "hand" }] });
  play(control.engine, P2, control.id("painful"));
  assert.equal(influenceOf(control.engine, P2), before - 3, "control: the same character not denied does cost 3");
});

clause(DOORMAN, "0:ability:denied", "...and no draw trigger fires either (a denied drawer draws nothing)", () => {
  const drawer = character({
    name: "Drawer",
    cost: 1,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "drawer", def: drawer, owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P2).length;
  const deckBefore = deckOf(engine, P2).length;
  playRaw(engine, P2, id("drawer"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("drawer")), "discard");
  assert.equal(deckOf(engine, P2).length, deckBefore, "nothing drawn");
  assert.equal(handOf(engine, P2).length, handBefore - 1);
});

clause(DOORMAN, "0:ability:denied", "terminated is not destroyed: no 'when this card is destroyed' trigger fires for the denied character", () => {
  const dies = character({
    name: "Dies Loudly",
    cost: 1,
    behavior: { abilities: [{ id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }] }] }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "dies", def: dies, owner: P2, zone: "hand" }] });
  const before = influenceOf(engine, P1);
  playRaw(engine, P2, id("dies"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("dies")), "discard");
  assert.equal(influenceOf(engine, P1), before, "it was not destroyed, merely terminated");
});

clause(DOORMAN, "0:ability:denied", "only THAT character is affected: a different character played afterwards enters play normally", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  play(engine, P2, id("cB"));
  assert.equal(zoneOf(engine, id("cB")), "play", "the next character is not denied");
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "'in response to a character being played': refused in response to a tactic, an item, a location or an ability", () => {
  const react = () => doormanBoard({ extra: [{ key: "zapper", def: zapperChar("Their Zapper", 1), owner: P2, zone: "play" }] });
  for (const key of ["tac", "itm", "loc"]) {
    const { engine, id } = react();
    playRaw(engine, P2, id(key));
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, `${key}: I may respond`);
    refused(() => actRaw(engine, P1, id("door"), "denied"), `${key} is not a character`, /costs cannot be paid|cannot be used|not available|condition|respond/i);
    assert.equal(zoneOf(engine, id("door")), "play", "the Doorman was not destroyed by a refused use");
  }
  const { engine, id } = react();
  actRaw(engine, P2, id("zapper"), "zap", { t: [id("mine")] });
  refused(() => actRaw(engine, P1, id("door"), "denied"), "an ability is not a character being played", /costs cannot be paid|cannot be used|not available|condition|respond/i);
  assert.equal(zoneOf(engine, id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "control: the same Doorman IS usable once a character is being played (it is the situation, not the Doorman, that was refused)", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard");
});

clause(DOORMAN, "0:ability:denied", "it can't be used with nothing being played, nor in response to a battle declaration", () => {
  const idle = doormanBoard({ active: P1 });
  refused(() => actRaw(idle.engine, P1, idle.id("door"), "denied"), "nothing is being played", /./);
  assert.equal(zoneOf(idle.engine, idle.id("door")), "play");
  const attack = doormanBoard({ active: P2 });
  declareAttackOpenWindow(attack.engine, P2, [attack.id("foeDoor")]);
  refused(() => actRaw(attack.engine, P1, attack.id("door"), "denied"), "an attack is not a character being played", /./);
  assert.equal(zoneOf(attack.engine, attack.id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "a character that is put into play by an effect is not 'being played': the Doorman can't respond to the tactic that raises it", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "putter", def: putter, owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("putter"), { selected: { t: [id("cA")] } });
  refused(() => actRaw(engine, P1, id("door"), "denied"), "the tactic is what is being played", /./);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "play", "the character entered play");
});

clause(DOORMAN, "0:ability:denied", "only its controller may use it: the opponent can't use my Doorman, and mine can't deny my own character", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  refused(() => actRaw(engine, P2, id("door"), "denied"), "not the controller", /./);
  assert.equal(zoneOf(engine, id("door")), "play");
  assert.equal(zoneOf(engine, id("cA")), "deploying");
  const own = doormanBoard({ active: P1, extra: [{ key: "myChar", def: character({ name: "My Newcomer", cost: 1 }), owner: P1, zone: "hand" }] });
  playRaw(own.engine, P1, own.id("myChar"));
  refused(() => actRaw(own.engine, P1, own.id("door"), "denied"), "you can never respond to your own action (CR 607.1)", /./);
  assert.equal(zoneOf(own.engine, own.id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "the opponent's Doorman works for the opponent in the same way: it denies MY character", () => {
  const { engine, id } = doormanBoard({ active: P1, extra: [{ key: "myChar", def: character({ name: "My Newcomer", cost: 1 }), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("myChar"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  actRaw(engine, P2, id("foeDoor"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("myChar")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("myChar")), "into MY discard pile, its owner's");
  assert.equal(zoneOf(engine, id("foeDoor")), "discard");
});

clause(DOORMAN, "0:ability:denied", "it is a response: once the character is terminated, my other Doorman can't deny it again, and nothing breaks", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
  assert.equal(zoneOf(engine, id("door2")), "play", "the second Doorman is still there");
  refused(() => actRaw(engine, P1, id("door2"), "denied"), "nothing is being played any more", /./);
});

clause(DOORMAN, "0:ability:denied", "a face-down Doorman is just a resource with no abilities: DENIED! is not available", () => {
  const { engine, id } = doormanBoard({ extra: [{ key: "hiddenDoor", def: printing(DOORMAN), owner: P1, zone: "play", faceDown: true }] });
  playRaw(engine, P2, id("cA"));
  refused(() => actRaw(engine, P1, id("hiddenDoor"), "denied"), "a face-down card has no abilities", /face-down card.s abilities cannot be activated/);
  assert.equal(zoneOf(engine, id("cA")), "deploying");
  actRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard", "control: a face-up Doorman works");
});

clause(DOORMAN, "0:ability:denied", "deploys for its printed cost of 3 with [G] as a 2 strength / 3 speed / 2 life character; one short or no [G] is refused", () => {
  const board = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "dm", def: printing(DOORMAN), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const ok = board(3, 0);
  play(ok.engine, P1, ok.id("dm"));
  assert.equal(zoneOf(ok.engine, ok.id("dm")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 3 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("dm"), "strength"), ok.engine.getStat(ok.id("dm"), "speed"), ok.engine.getStat(ok.id("dm"), "life")], [2, 3, 2]);
  const short = board(2, 0);
  refused(() => playRaw(short.engine, P1, short.id("dm")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("dm")), "hand");
  const oneG = board(1, 2);
  play(oneG.engine, P1, oneG.id("dm"));
  assert.equal(zoneOf(oneG.engine, oneG.id("dm")), "play", "control: a single [G] plus two other resources is enough");
  const noG = board(0, 5);
  refused(() => playRaw(noG.engine, P1, noG.id("dm")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("dm")), "hand");
});

// =============================================================================
// Subsection 5, Paragraph 12 (2nd Edition)
// Your opponent cannot respond to this card.
// COST: Play this only in response to an ability that's source was not a faction.
// EFFECT: Terminate the ability. It cannot be used again this turn. Draw a card.
// Tactic, banker, cost 2, [G][G].
// =============================================================================

const SUBSECTION = "23fe59c9-9bf1-49d1-bfc4-084c556aca80";

/** A character with two abilities: ZAP (pay 1: 2 damage to a character) and PEEK (draw a card). */
const abilityGuy = (name: string): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [{ type: "payResources", amount: 1 }],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        },
        { id: "peek", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });

const GUY = abilityGuy("Ability Guy");
const OTHER_GUY = abilityGuy("Other Guy");

const IDOL = item({
  name: "Pulse Idol",
  behavior: {
    abilities: [{ id: "pulse", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }]
  }
});

const SHRINE = location({
  name: "Quake Shrine",
  structure: 4,
  behavior: {
    abilities: [{ id: "quake", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }]
  }
});

const ABILITY_FACTION = factionCard({
  id: "2nd-edition-03-ability-faction",
  name: "Faction With Ability",
  faction: defaultFactionDefinition({
    startingInfluence: 30,
    abilities: [{ id: "fdraw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
  })
});

function s5Board(opts: { active?: Pid; greed?: number; rage?: number; deckSize?: number; foeFaction?: CardDefinition; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: opts.foeFaction ?? developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "s5", def: printing(SUBSECTION), owner: P1, zone: "hand" },
      { key: "myTac", def: tactic({ name: "My Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 8 }), owner: P1, zone: "play" },
      { key: "myGuy", def: abilityGuy("My Ability Guy"), owner: P1, zone: "play" },
      { key: "guy", def: GUY, owner: P2, zone: "play" },
      { key: "guy2", def: GUY, owner: P2, zone: "play" },
      { key: "other", def: OTHER_GUY, owner: P2, zone: "play" },
      { key: "idol", def: IDOL, owner: P2, zone: "play" },
      { key: "shrine", def: SHRINE, owner: P2, zone: "play" },
      { key: "p2tac", def: tactic({ name: "Their Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      { key: "p2char", def: character({ name: "Their Newcomer", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("d", opts.deckSize ?? 5, P1, "deck"),
      ...fillers("f", 5, P2, "deck"),
      ...bank("greed", opts.greed ?? 4, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", 8, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 activates `abilityId` of its card `cardKey` (zap at my character by default) and holds the response window open for P1. */
function foeUses(engine: SpoilsEngine, id: (key: string) => string, cardKey: string, abilityId: string): void {
  const needsTarget = abilityId !== "peek" && abilityId !== "fdraw";
  actRaw(engine, P2, id(cardKey), abilityId, needsTarget ? { t: [id("mine")] } : {});
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the ability");
}

const s5Noop = (name: string): CardDefinition => tactic({ name, cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });

clause(SUBSECTION, "0:rule", "the opponent gets no response window: the Paragraph resolves on its own, and they can respond with neither a tactic nor an ability", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  // Nobody may respond to it: it resolved at once, ended the item beneath, and the window closed on the empty stack.
  assert.equal(zoneOf(engine, id("s5")), "discard", "it resolved without the opponent being offered a response");
  assert.equal(engine.state.responseWindow, undefined, "nothing is left to respond to: the window closed");
  assert.equal(zoneOf(engine, id("p2tac")), "hand");
});

clause(SUBSECTION, "0:rule", "control: a response to the opponent's ability by an ordinary tactic can be answered", () => {
  const { engine, id } = s5Board({ extra: [{ key: "ptac", def: s5Noop("Plain Reply"), owner: P1, zone: "hand" }] });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("ptac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "an ordinary tactic leaves them room to respond");
  playRaw(engine, P2, id("p2tac"));
  assert.equal(zoneOf(engine, id("p2tac")), "deploying", "their response was accepted");
});

clause(SUBSECTION, "0:rule", "on my own turn, in answer to their ability: it resolves at once, before the opponent can answer it (the earlier card of mine stays on the stack)", () => {
  const { engine, id } = s5Board({ active: P1 });
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("myTac"));
  foeUses(engine, id, "other", "zap");
  playRaw(engine, P1, id("s5"));
  assert.equal(zoneOf(engine, id("s5")), "discard", "it already resolved: nobody could respond to it");
  assert.equal(zoneOf(engine, top), "hand", "its draw already happened");
  assert.equal(zoneOf(engine, id("myTac")), "deploying", "my earlier tactic is still waiting on the stack");
  refused(() => actRaw(engine, P2, id("other"), "zap", { t: [id("mine")] }), "the terminated ability is locked at once", /cannot be used again/i);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the zap never happened");
  assert.equal(zoneOf(engine, id("myTac")), "discard");
});

clause(SUBSECTION, "1:ability", "in response to a character's ability: pays 2, the ability is terminated (no damage), and I draw a card", () => {
  const { engine, id } = s5Board();
  const myBefore = ready(engine, P1);
  const theirBefore = ready(engine, P2);
  const top = deckOf(engine, P1)[0];
  foeUses(engine, id, "guy", "zap");
  assert.equal(theirBefore - ready(engine, P2), 1, "control: zap's cost was paid by them");
  playRaw(engine, P1, id("s5"));
  assert.equal(myBefore - ready(engine, P1), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the ability was terminated");
  assert.equal(zoneOf(engine, top), "hand", "I drew the top card");
  assert.equal(zoneOf(engine, id("s5")), "discard", "the tactic is spent");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(SUBSECTION, "1:ability", "control: without the Paragraph the same ability does its 2 damage", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(SUBSECTION, "1:ability", "the terminated ability's costs stay paid: their resource is not refunded", () => {
  const { engine, id } = s5Board();
  const before = ready(engine, P2);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 1, "they stay down the resource");
});

clause(SUBSECTION, "1:ability", "I draw exactly ONE card, not two, and the opponent's hand and deck are untouched", () => {
  const { engine, id } = s5Board();
  const [first, second] = deckOf(engine, P1).slice(0, 2);
  const theirHand = handOf(engine, P2).length;
  const theirDeck = deckOf(engine, P2).length;
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "deck");
  assert.equal(handOf(engine, P2).length, theirHand);
  assert.equal(deckOf(engine, P2).length, theirDeck);
});

clause(SUBSECTION, "1:ability", "even an ability that only draws is terminated: their PEEK draws nothing", () => {
  const { engine, id } = s5Board();
  const theirHand = handOf(engine, P2).length;
  foeUses(engine, id, "guy", "peek");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, theirHand, "terminated: they drew nothing");
  assert.equal(handOf(engine, P1).length, 2, "I drew my card: the Noop tactic plus the drawn card");
});

clause(SUBSECTION, "1:ability", "an item's ability is a legal target (its source was not a faction)", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "idol", "pulse");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the Idol's pulse was terminated");
  assert.equal(zoneOf(engine, id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "a location's ability is a legal target too", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "shrine", "quake");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the Shrine's quake was terminated");
  assert.equal(zoneOf(engine, id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "'cannot be used again this turn': the same ability of the same card is refused for the rest of the turn", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const before = ready(engine, P2);
  refused(() => actRaw(engine, P2, id("guy"), "zap", { t: [id("mine")] }), "locked for this turn", /cannot be used again/i);
  assert.equal(ready(engine, P2), before, "nothing was paid by the refused attempt");
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(SUBSECTION, "1:ability", "...and a locked ability is no longer offered as a legal activation (while an unlocked one still is)", () => {
  const { engine, id } = s5Board();
  assert.equal(
    engine.getAvailableActivatedAbilities(P2).some((a) => a.cardId === id("guy") && a.ability.id === "zap"),
    true,
    "control: before the Paragraph, ZAP is offered"
  );
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const offered = engine.getAvailableActivatedAbilities(P2).filter((a) => a.cardId === id("guy")).map((a) => a.ability.id);
  assert.deepEqual(offered, ["peek"], "only the unlocked PEEK is offered for that card");
});

clause(SUBSECTION, "1:ability", "the lock is on THAT ability only: the same card's other ability, and other cards' abilities, still work", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const handBefore = handOf(engine, P2).length;
  activate(engine, P2, id("guy"), "peek");
  assert.equal(handOf(engine, P2).length, handBefore + 1, "the same card's PEEK still works");
  activate(engine, P2, id("other"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "a different card's ZAP still works");
  activate(engine, P2, id("idol"), "pulse", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 3, "an item's ability still works");
});

clause(SUBSECTION, "1:ability", "another copy of the same card is a different card with its own ability: it can still use it this turn", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  activate(engine, P2, id("guy2"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "the second Ability Guy is not 'the ability' that was terminated");
});

clause(SUBSECTION, "1:ability", "'this turn': on the opponent's next turn the terminated ability can be used again", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  refused(() => actRaw(engine, P2, id("guy"), "zap", { t: [id("mine")] }), "still this turn", /cannot be used again/i);
  endTurn(engine, P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "their next turn");
  activate(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "the lock lasted only through the turn it was played");
});

clause(SUBSECTION, "1:ability", "the lock holds for the whole turn, also after later windows have come and gone", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  resolvePendingResponses(engine);
  refused(() => actRaw(engine, P2, id("guy"), "zap", { t: [id("mine")] }), "still locked", /cannot be used again/i);
});

clause(SUBSECTION, "1:ability", "ONLY the responded-to ability is terminated: an earlier action lower in the chain still resolves", () => {
  const { engine, id } = s5Board({ active: P1 });
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("myTac"));
  actRaw(engine, P2, id("guy"), "zap", { t: [id("mine")] });
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the zap was terminated");
  assert.equal(zoneOf(engine, id("myTac")), "discard", "my own tactic resolved afterwards as normal");
  assert.equal(handOf(engine, P1).length, handBefore - 2 + 1, "two cards played, one drawn");
});

clause(SUBSECTION, "1:ability", "it works on my own turn too, answering an ability they used in response to my action", () => {
  const { engine, id } = s5Board({ active: P1 });
  playRaw(engine, P1, id("myTac"));
  foeUses(engine, id, "other", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("s5")), "discard");
  assert.equal(zoneOf(engine, id("myTac")), "discard");
});

clause(SUBSECTION, "1:ability", "'play this only in response to an ability whose source was not a faction': a faction's ability is refused", () => {
  const { engine, id } = s5Board({ foeFaction: ABILITY_FACTION });
  const foeFactionId = factionOf(engine, P2);
  const before = ready(engine, P1);
  actRaw(engine, P2, foeFactionId, "fdraw");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I can respond to their faction's ability");
  refused(() => playRaw(engine, P1, id("s5")), "its source was a faction", /./);
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(ready(engine, P1), before, "nothing was paid");
  const theirHand = handOf(engine, P2).length;
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, theirHand + 1, "and the faction's draw does happen");
});

clause(SUBSECTION, "1:ability", "control: with the same faction on the board, a character's ability is still a legal target", () => {
  const { engine, id } = s5Board({ foeFaction: ABILITY_FACTION });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(SUBSECTION, "1:ability", "it must be a response to an ABILITY: refused in response to a tactic being played", () => {
  const { engine, id } = s5Board();
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(engine, P1, id("s5")), "a tactic is not an ability", /./);
  assert.equal(zoneOf(engine, id("s5")), "hand");
});

clause(SUBSECTION, "1:ability", "...and in response to a character being played", () => {
  const { engine, id } = s5Board();
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(engine, P1, id("s5")), "a character is not an ability", /./);
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(zoneOf(engine, id("p2char")), "deploying", "the character is unaffected");
});

clause(SUBSECTION, "1:ability", "...and with nothing to respond to (my own turn, idle): refused", () => {
  const { engine, id } = s5Board({ active: P1 });
  const before = ready(engine, P1);
  refused(() => playRaw(engine, P1, id("s5")), "nothing to respond to", /./);
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(ready(engine, P1), before);
});

clause(SUBSECTION, "1:ability", "I can't respond to my own ability with it (CR 607.1)", () => {
  const { engine, id } = s5Board({ active: P1 });
  actRaw(engine, P1, id("myGuy"), "zap", { t: [id("mine")] });
  refused(() => playRaw(engine, P1, id("s5")), "my own ability", /./);
  assert.equal(zoneOf(engine, id("s5")), "hand");
});

clause(SUBSECTION, "1:ability", "is refused one resource short of its cost of 2, and without [G][G]", () => {
  const short = s5Board({ greed: 0, rage: 1, extra: bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  foeUses(short.engine, short.id, "guy", "zap");
  refused(() => playRaw(short.engine, P1, short.id("s5")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("s5")), "hand");
  const noThreshold = s5Board({ greed: 1, rage: 6 });
  foeUses(noThreshold.engine, noThreshold.id, "guy", "zap");
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("s5")), "only one [G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("s5")), "hand");
  const exact = s5Board({ greed: 2 });
  foeUses(exact.engine, exact.id, "guy", "zap");
  playRaw(exact.engine, P1, exact.id("s5"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("s5")), "discard", "[G][G] and exactly 2 resources works");
  const mixed = s5Board({ greed: 2, rage: 1 });
  foeUses(mixed.engine, mixed.id, "guy", "zap");
  playRaw(mixed.engine, P1, mixed.id("s5"));
  resolvePendingResponses(mixed.engine);
  assert.equal(zoneOf(mixed.engine, mixed.id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "with an empty deck the draw finds nothing and nobody loses, but the ability is still terminated and locked", () => {
  const { engine, id } = s5Board({ deckSize: 0 });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(engine.state.result, undefined);
  refused(() => actRaw(engine, P2, id("guy"), "zap", { t: [id("mine")] }), "locked", /cannot be used again/i);
});

// =============================================================================
// Summary Judgment (2nd Edition)
// COST: Pick a character your opponent controls. X is its strength.
// EFFECT: Your opponent may destroy the character. If they don't, draw X cards.
// Tactic, banker, cost 4, [G][G].
// =============================================================================

const JUDGMENT = "40c6d3c3-98bd-4fb0-a5aa-7ffa0f6e8019";
const HIDDEN_SANDWICH = "a4396480-efb3-4382-bf85-51331246e5c7";

function judgmentBoard(opts: { icons?: Icons; deck?: number; foeStrength?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 4, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: opts.foeStrength ?? 3, life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 5 }), owner: P2, zone: "play" },
      ...fillers("a", opts.deck ?? 6, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...fillers("h", 1, P1, "hand"),
      ...fillers("oh", 2, P2, "hand"),
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays Summary Judgment on `target` and leaves the opponent's decision open. */
function judgmentOn(engine: SpoilsEngine, id: (key: string) => string, target: string): void {
  play(engine, P1, id("sj"), { selected: { c: [target] } });
  const pc = pending(engine);
  assert.ok(pc, "the opponent is asked");
  assert.equal(pc.kind, "mayPay");
}

clause(JUDGMENT, "0:ability", "pays 4; the opponent chooses to destroy the character: it is destroyed and I draw nothing", () => {
  const { engine, id } = judgmentBoard();
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  const deckBefore = [...deckOf(engine, P1)];
  judgmentOn(engine, id, id("foe"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("foe")), "discard", "the character is destroyed");
  assert.ok(discardOf(engine, P2).includes(id("foe")), "into its owner's discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "I drew no cards (only the tactic left my hand)");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "my deck is untouched");
  assert.equal(zoneOf(engine, id("foe2")), "play", "the other opponent character is untouched");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("sj")), "discard", "the tactic ends in my discard pile");
  assert.equal(pending(engine), undefined);
});

clause(JUDGMENT, "0:ability", "the opponent declines to destroy: the character survives untouched and I draw X = its strength (3) cards from the top of my deck", () => {
  const { engine, id } = judgmentBoard();
  const topThree = deckOf(engine, P1).slice(0, 3);
  const handBefore = handOf(engine, P1).length;
  const oppHand = [...handOf(engine, P2)];
  const oppDeck = [...deckOf(engine, P2)];
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, false);
  assert.equal(zoneOf(engine, id("foe")), "play", "not destroyed");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3, "I drew exactly 3");
  for (const cardId of topThree) assert.equal(zoneOf(engine, cardId), "hand", "the top 3 cards of my deck");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.deepEqual(handOf(engine, P2), oppHand, "the opponent's hand is untouched");
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(zoneOf(engine, id("sj")), "discard");
});

for (const strength of [1, 5]) {
  clause(JUDGMENT, "0:ability", `X is the picked character's strength: a ${strength}-strength character means I draw ${strength}`, () => {
    const { engine, id } = judgmentBoard({ foeStrength: strength, deck: 8 });
    const handBefore = handOf(engine, P1).length;
    judgmentOn(engine, id, id("foe"));
    answerMayPay(engine, false);
    assert.equal(handOf(engine, P1).length, handBefore - 1 + strength);
    assert.equal(deckOf(engine, P1).length, 8 - strength);
  });
}

clause(JUDGMENT, "0:ability", "X = 0 (a 0-strength character): declining to destroy draws nothing, and the character survives", () => {
  const { engine, id } = judgmentBoard({ foeStrength: 0 });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(JUDGMENT, "0:ability", "X is the character's CURRENT strength, including bonuses: a 3-strength character carrying +2 strength means X = 5", () => {
  const booster = item({ name: "Booster", behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }, attachTo: "character" });
  const { engine, id } = judgmentBoard({ deck: 8, extra: [{ key: "booster", def: booster, owner: P2, zone: "play", attachedToKey: "foe" }] });
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 5);
});

clause(JUDGMENT, "0:ability", "X is fixed when the cost is paid: a strength bonus the opponent adds in response does not change how many cards I draw", () => {
  const { engine, id } = judgmentBoard({ deck: 10, extra: [{ key: "buff", def: buffTactic(4), owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("sj"), { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("buff"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 7, "the response resolved first");
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3, "X was 3 when the cost was paid");
});

clause(JUDGMENT, "0:ability", "X is fixed when the cost is paid: a strength loss the opponent causes in response does not reduce how many cards I draw", () => {
  const { engine, id } = judgmentBoard({ deck: 10, extra: [{ key: "nerf", def: debuffTactic(2), owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("sj"), { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("nerf"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 1, "the response resolved first");
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3, "X was 3 when the cost was paid");
});

clause(JUDGMENT, "0:ability", "a deck with fewer than X cards: I draw what is there (no loss for drawing from an empty deck)", () => {
  const { engine, id } = judgmentBoard({ deck: 2 });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2);
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.result, undefined);
});

clause(JUDGMENT, "0:ability", "YOUR OPPONENT makes the choice, not me: it belongs to the opponent and I cannot answer it", () => {
  const { engine, id } = judgmentBoard();
  judgmentOn(engine, id, id("foe"));
  assert.equal(pending(engine)?.playerId, P2);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: false } } as never), "I may not decide for my opponent", /./);
  assert.equal(pending(engine)?.kind, "mayPay", "still waiting for the opponent");
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(JUDGMENT, "0:ability", "the character is destroyed only if THEY choose to: nothing is destroyed before they answer", () => {
  const { engine, id } = judgmentBoard();
  judgmentOn(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "play", "still in play while the choice is open");
  assert.equal(handOf(engine, P1).length, 1, "and I have not drawn yet");
  answerMayPay(engine, false);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(JUDGMENT, "0:ability", "the opponent is asked even for a character of theirs that I own: the choice follows who CONTROLS the character", () => {
  const { engine, id } = judgmentBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 4 }), owner: P1, zone: "play", controller: P2 }] });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("stolen"));
  assert.equal(pending(engine)?.playerId, P2, "its controller (my opponent) decides");
  answerMayPay(engine, false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "X = 2");
  assert.equal(zoneOf(engine, id("stolen")), "play");
});

clause(JUDGMENT, "0:ability", "a character I own but my opponent controls, once destroyed, goes to MY discard pile (its owner's)", () => {
  const { engine, id } = judgmentBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 4 }), owner: P1, zone: "play", controller: P2 }] });
  judgmentOn(engine, id, id("stolen"));
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("stolen")), "discardOf(engine, P1).includes(id(\"stolen\"))");
});

clause(JUDGMENT, "0:ability", "the pick must be a character my OPPONENT controls: my own character, a character I took from them, an item, a location, a faction, a face-down resource and a hand card are refused", () => {
  const { engine, id } = judgmentBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed", strength: 2 }), owner: P2, zone: "play", controller: P1 },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "downResource", def: character({ name: "Down" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  const attempt = (picked: string) => () => playRaw(engine, P1, id("sj"), { selected: { c: [picked] } });
  refused(attempt(id("mine")), "my own character");
  refused(attempt(id("borrowed")), "a character I control, even though they own it");
  refused(attempt(id("thing")), "item");
  refused(attempt(id("place")), "location");
  refused(attempt(factionOf(engine, P2)), "their faction (CR 202.9)");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(id("downResource")), "face-down card");
  refused(attempt(id("oh0")), "a card in their hand");
  refused(() => playRaw(engine, P1, id("sj"), { selected: {} }), "no pick");
  refused(() => playRaw(engine, P1, id("sj"), { selected: { c: [id("foe"), id("foe2")] } }), "two picks");
  assert.equal(zoneOf(engine, id("sj")), "hand", "none of those attempts played the card");
  assert.equal(ready(engine), 6, "nothing was paid");
  attempt(id("foe2"))();
  assert.ok(engine.state.responseWindow, "control: an opponent's character is accepted");
});

clause(JUDGMENT, "0:ability", "'destroy the character' is a normal destruction, so a Hidden Sandwich on the character replaces it: the Sandwich is destroyed instead and the character lives", () => {
  const { engine, id } = judgmentBoard({
    extra: [{ key: "sandwich", def: printing(HIDDEN_SANDWICH), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("foe")), "play", "the replacement saved the character");
  assert.equal(zoneOf(engine, id("sandwich")), "discard", "the Sandwich was destroyed instead");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "the opponent chose destroy, so I draw nothing");
});

clause(JUDGMENT, "0:ability", "under Limited Liability (cards can only be destroyed by costs) the opponent's 'destroy' does nothing to the character", () => {
  const { engine, id } = judgmentBoard({ extra: [{ key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  play(engine, P1, id("ll"));
  assert.equal(zoneOf(engine, id("ll")), "discard", "control: Limited Liability resolved");
  judgmentOn(engine, id, id("foe"));
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("foe")), "play", "cards can only be destroyed by costs this turn");
});

clause(JUDGMENT, "0:ability", "cannot be played when my opponent controls no character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...res({ greed: 6 })]
  });
  refused(() => playRaw(engine, P1, id("sj"), { selected: { c: [id("mine")] } }), "only my own character");
  refused(() => playRaw(engine, P1, id("sj"), { selected: {} }), "no pick");
  assert.equal(zoneOf(engine, id("sj")), "hand");
});

clause(JUDGMENT, "0:ability", "is refused one resource short of its cost of 4, and without [G][G] even with plenty of other resources", () => {
  const attempt = (icons: Icons) => {
    const board = judgmentBoard({ icons });
    return { ...board, run: () => playRaw(board.engine, P1, board.id("sj"), { selected: { c: [board.id("foe")] } }) };
  };
  const short = attempt({ greed: 3 });
  refused(short.run, "3 resources");
  assert.equal(zoneOf(short.engine, short.id("sj")), "hand");
  const oneGreed = attempt({ greed: 1, rage: 7 });
  refused(oneGreed.run, "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("sj")), "hand");
  const exact = attempt({ greed: 2, rage: 2 });
  exact.run();
  assert.ok(exact.engine.state.responseWindow, "[G][G] and exactly 4 resources is enough");
  resolvePendingResponses(exact.engine);
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Tax Attorney (2nd Edition)
// If your faction loses influence, reduce the amount by 1.
// Character (lawyer, mau), banker, cost 2, [G][G], 1 strength / 3 speed / 2 life.
// =============================================================================

const ATTORNEY = "0dfb45fa-a235-4c69-a3e3-2d63c9665dc7";

/** A free tactic: `who` loses `amount` influence (the "loses N influence" effect, not damage). */
const bleedTactic = (name: string, amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "bleed", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] } });

/** A free tactic: its controller gains `amount` influence. */
const gainTactic = (name: string, amount: number): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "gain", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount }] }] } });

/** A free tactic dealing `amount` damage to a chosen faction (id `blast`, declaration `t`). */
const blastTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "blast",
          type: "activated",
          targets: [{ id: "t", selector: { type: "faction" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

function attorneyBoard(opts: { extra?: CardPlacement[]; attorneyZone?: "play" | "hand" | "discard"; faceDown?: boolean; influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence ?? 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: opts.attorneyZone ?? "play", faceDown: opts.faceDown },
      { key: "bleed1", def: bleedTactic("Bleed1", 1, "controller"), owner: P1, zone: "hand" },
      { key: "bleed2", def: bleedTactic("Bleed2", 2, "controller"), owner: P1, zone: "hand" },
      { key: "bleed5", def: bleedTactic("Bleed5", 5, "controller"), owner: P1, zone: "hand" },
      { key: "bleedOpp3", def: bleedTactic("BleedOpp3", 3, "opponent"), owner: P1, zone: "hand" },
      { key: "gain3", def: gainTactic("Gain3", 3), owner: P1, zone: "hand" },
      { key: "blast4", def: blastTactic("Blast4", 4), owner: P1, zone: "hand" },
      { key: "blast1", def: blastTactic("Blast1", 1), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

for (const [amount, key, expected] of [
  [1, "bleed1", 0],
  [2, "bleed2", 1],
  [5, "bleed5", 4]
] as const) {
  clause(ATTORNEY, "0:rule", `a ${amount}-influence loss ("loses N influence") costs my faction ${expected}`, () => {
    const { engine, id } = attorneyBoard();
    play(engine, P1, id(key), {});
    assert.equal(zoneOf(engine, id(key)), "discard", "control: the tactic resolved");
    assert.equal(influenceOf(engine, P1), 20 - expected);
  });
}

clause(ATTORNEY, "0:rule", "control: without the Tax Attorney a 2-influence loss costs the full 2", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand" });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 18);
});

clause(ATTORNEY, "0:rule", "the reduction never turns a loss into a gain: a 1-influence loss is reduced to 0, not below", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("bleed1"), {});
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "damage to my faction is influence loss too: 4 damage to my faction costs 3 influence, 1 damage costs 0", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("blast4"), { selected: { t: [factionOf(engine, P1)] } });
  assert.equal(influenceOf(engine, P1), 20 - 3);
  play(engine, P1, id("blast1"), { selected: { t: [factionOf(engine, P1)] } });
  assert.equal(influenceOf(engine, P1), 20 - 3, "1 damage, reduced by 1, loses nothing");
});

clause(ATTORNEY, "0:rule", "battle damage to my faction: an unblocked 4-strength attacker takes only 3 influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), 20 - 3, "4 battle damage, reduced by 1");
});

clause(ATTORNEY, "0:rule", "battle damage of exactly 1 to my faction costs 0 influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, []);
  assert.equal(isDepleted(engine, id("foe")), true, "control: the battle happened");
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "my opponent's faction takes the full battle damage (the Attorney does not protect it)", () => {
  const { engine, id } = attorneyBoard();
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), 20 - 1);
});

clause(ATTORNEY, "0:rule", "it applies once per loss: two separate losses of 2 each cost 1 each (2 in total)", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "bleed2b", def: bleedTactic("Bleed2b", 2, "controller"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bleed2"), {});
  play(engine, P1, id("bleed2b"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2);
});

clause(ATTORNEY, "0:rule", "gaining influence is not affected", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("gain3"), {});
  assert.equal(influenceOf(engine, P1), 23);
});

clause(ATTORNEY, "0:rule", "only MY faction: my opponent's faction loses the full amount", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 3);
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "my opponent's faction takes full damage from an effect too", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("blast4"), { selected: { t: [factionOf(engine, P2)] } });
  assert.equal(influenceOf(engine, P2), 20 - 4);
});

clause(ATTORNEY, "0:rule", "an Attorney controlled by my opponent protects THEIR faction and not mine", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand", extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P2, zone: "play" }] });
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 2, "their Attorney reduces their loss");
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2, "my faction has no Attorney: full loss");
});

clause(ATTORNEY, "0:rule", "'your faction' is the controller's: an Attorney I own but my opponent controls protects them, not me", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand", extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P1, zone: "play", controller: P2 }] });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2, "I do not control it, so it does not protect me");
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 2, "its controller's faction is protected");
});

clause(ATTORNEY, "0:rule", "two Tax Attorneys both apply: a 5-influence loss costs 3", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P1, zone: "play" }] });
  play(engine, P1, id("bleed5"), {});
  assert.equal(influenceOf(engine, P1), 20 - 3);
});

clause(ATTORNEY, "0:rule", "off in hand and in the discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = attorneyBoard({ attorneyZone: zone });
    play(engine, P1, id("bleed2"), {});
    assert.equal(influenceOf(engine, P1), 18, zone);
  }
});

clause(ATTORNEY, "0:rule", "off while it is a face-down resource (a face-down card has no rules text)", () => {
  const { engine, id } = attorneyBoard({ faceDown: true });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 18);
});

clause(ATTORNEY, "0:rule", "off again once the Attorney leaves play (destroyed)", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 19, "with the Attorney");
  play(engine, P1, id("kill"), { selected: { t: [id("ta")] } });
  assert.equal(zoneOf(engine, id("ta")), "discard");
  play(engine, P1, id("bleed5"), {});
  assert.equal(influenceOf(engine, P1), 19 - 5, "full loss once it is gone");
});

clause(ATTORNEY, "0:rule", "it can save a faction: at 3 influence a 3-influence loss leaves 1 and the game continues, while without the Attorney the same loss is lethal", () => {
  const withAttorney = attorneyBoard({ influence: 3, extra: [{ key: "bleed3", def: bleedTactic("Bleed3", 3, "controller"), owner: P1, zone: "hand" }] });
  play(withAttorney.engine, P1, withAttorney.id("bleed3"), {});
  assert.equal(influenceOf(withAttorney.engine, P1), 1);
  assert.equal(withAttorney.engine.state.result, undefined, "still in the game");

  const without = attorneyBoard({ influence: 3, attorneyZone: "hand", extra: [{ key: "bleed3", def: bleedTactic("Bleed3", 3, "controller"), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("bleed3"), {});
  assert.equal(influenceOf(without.engine, P1), 0);
  assert.deepEqual(without.engine.state.result, { outcome: "victory", winners: [P2] }, "control: with no Attorney the same loss is lethal");
});

clause(ATTORNEY, "0:rule", "Mafia Lawyer's 'your faction loses 2 influence' is reduced to 1 by the Attorney", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "play", extra: [{ key: "law", def: printing(MAFIA), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  play(engine, P1, id("law"));
  assert.equal(zoneOf(engine, id("law")), "play", "control: the Lawyer entered play");
  assert.equal(influenceOf(engine, P1), 19, "2 lost, reduced by 1");
});

clause(ATTORNEY, "0:rule", "influence my faction loses as an ability COST ('your faction loses N influence') is a loss too, so it is reduced by 1", () => {
  const toll = character({
    name: "Toll Collector",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "toll", type: "activated", costs: [{ type: "loseInfluence", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = attorneyBoard({ extra: [{ key: "toll", def: toll, owner: P1, zone: "play" }, ...fillers("a", 2, P1, "deck")] });
  activate(engine, P1, id("toll"), "toll");
  assert.equal(influenceOf(engine, P1), 20 - 2, "the faction lost 3 influence as a cost: reduced by 1");
});

clause(ATTORNEY, "0:rule", "Mutiny Grant's 'your faction loses X influence' cost is reduced by 1 by the Attorney (X = 3 costs 2)", () => {
  const { engine, id } = attorneyBoard({
    extra: [
      { key: "mg", def: printing(MUTINY), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "C3", cost: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(controllerOf(engine, id("c3")), P1, "control: the Grant resolved");
  assert.equal(influenceOf(engine, P1), 20 - 2, "3 lost as a cost, reduced by 1");
});

clause(ATTORNEY, "0:rule", "deploys for exactly 2 with [G][G] (refused one short or with one [G]) and has its printed 1 strength / 2 life / 3 speed", () => {
  const board = (icons: Icons) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ta", def: printing(ATTORNEY), owner: P1, zone: "hand" }, ...res(icons)] });
  const short = board({ greed: 1 });
  refused(() => playRaw(short.engine, P1, short.id("ta")), "one resource");
  assert.equal(zoneOf(short.engine, short.id("ta")), "hand");
  const oneGreed = board({ greed: 1, rage: 4 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("ta")), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("ta")), "hand");
  const exactG = board({ greed: 2, rage: 1 });
  play(exactG.engine, P1, exactG.id("ta"));
  assert.equal(zoneOf(exactG.engine, exactG.id("ta")), "play", "control: exactly [G][G] plus one other resource is enough");
  const { engine, id } = board({ greed: 4 });
  play(engine, P1, id("ta"));
  assert.equal(ready(engine), 2, "exactly 2 spent");
  assert.equal(engine.getStat(id("ta"), "strength"), 1);
  assert.equal(engine.getStat(id("ta"), "life"), 2);
  assert.equal(engine.getStat(id("ta"), "speed"), 3);
  assert.deepEqual([...engine.getSubtypes(id("ta"))].sort(), ["lawyer", "mau"]);
});

// =============================================================================
// The Ministry of Other Smaller Ministries (2nd Edition)
// Your opponent must pay 2 to attack.
// Location, banker, cost 3, [G][G], structure 5.
// Reading: "to attack" is one attack, i.e. one declared party / battle: 2 per attack, not per attacker.
// =============================================================================

const MINISTRY = "ad487c7d-d286-44f4-8532-085ad2a851f1";

/** A free tactic (id "k", pick "t") destroying one card of `type` in play. */
const killAnyTactic = (type: "location" | "character" | "item"): CardDefinition =>
  tactic({
    name: `Kill ${type}`,
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

/** P2 (the attacker, turn 2) has `rage` ready resources and four 1-strength attackers; P1 controls the Ministry (unless told otherwise). */
function ministryBoard(
  opts: {
    rage?: number;
    ministry?: "play" | "hand" | "none" | "faceDown";
    ministryController?: PlayerId;
    ministryOwner?: PlayerId;
    extra?: CardPlacement[];
    attacker?: PlayerId;
    p1Resources?: number;
  } = {}
) {
  const attacker = opts.attacker ?? P2;
  const defender = attacker === P1 ? P2 : P1;
  const where = opts.ministry ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      ...(where === "none"
        ? []
        : [
            {
              key: "min",
              def: printing(MINISTRY),
              owner: opts.ministryOwner ?? opts.ministryController ?? defender,
              controller: opts.ministryController ?? defender,
              zone: where === "hand" ? ("hand" as const) : ("play" as const),
              faceDown: where === "faceDown"
            }
          ]),
      ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 5, speed: 2 }), owner: attacker, zone: "play" as const })),
      { key: "def1", def: character({ name: "Def1", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      { key: "town", def: location({ name: "Town", structure: 9 }), owner: defender, zone: "play" },
      ...res({ rage: opts.rage ?? 5 }, attacker),
      ...res({ rage: opts.p1Resources ?? 0 }, defender),
      ...(opts.extra ?? [])
    ]
  });
}

const attackWith = (engine: SpoilsEngine, who: PlayerId, ids: string[], target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: string }) =>
  declareAttackBy(engine, who, ids, target);

clause(MINISTRY, "0:rule", "my opponent's attack is legal if they pay 2: exactly 2 of their ready resources are spent (attached to their faction)", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  attackWith(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "the attack was declared");
  assert.equal(ready(engine, P2), 3, "2 of 5 resources were paid");
  assert.equal(attachedCount(engine, P2), 2, "...by attaching them to the faction");
  assert.equal(isDepleted(engine, id("a1")), true, "the attacker is depleted as usual");
});

clause(MINISTRY, "0:rule", "the cost is 2 per attack (one party), not per attacker: a party of three attackers pays 2 in total", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  attackWith(engine, P2, [id("a1"), id("a2"), id("a3")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 3);
  assert.equal(ready(engine, P2), 3, "one attack, 2 paid");
});

clause(MINISTRY, "0:rule", "an attack with only 2 ready resources and a party of four is also just 2", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  attackWith(engine, P2, [id("a1"), id("a2"), id("a3"), id("a4")]);
  assert.equal(ready(engine, P2), 0);
  assert.equal(battleOf(engine)?.attackingParty.length, 4);
});

clause(MINISTRY, "0:rule", "each attack pays: a second attack in the same turn costs another 2, and a third is refused when only 1 resource is left", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  fight(engine, P2, [id("a1")], { type: "faction", playerId: P1 }, []);
  assert.equal(ready(engine, P2), 3, "first attack paid 2");
  fight(engine, P2, [id("a2")], { type: "faction", playerId: P1 }, []);
  assert.equal(ready(engine, P2), 1, "second attack paid 2 more");
  refused(() => attackWith(engine, P2, [id("a3")]), "only 1 resource left: cannot pay 2");
  assert.equal(isDepleted(engine, id("a3")), false, "the refused attacker is not depleted");
  assert.equal(battleOf(engine), undefined);
  assert.equal(ready(engine, P2), 1, "nothing was paid");
});

clause(MINISTRY, "0:rule", "cannot attack at all with 1 ready resource, or with none; the refused attack changes nothing", () => {
  for (const rage of [1, 0]) {
    const { engine, id } = ministryBoard({ rage });
    refused(() => attackWith(engine, P2, [id("a1")]), `${rage} resources`);
    assert.equal(battleOf(engine), undefined, "no battle");
    assert.equal(isDepleted(engine, id("a1")), false, "the attacker is not depleted");
    assert.equal(ready(engine, P2), rage, "nothing was paid");
    assert.equal(engine.state.responseWindow, undefined);
  }
});

clause(MINISTRY, "0:rule", "exactly 2 ready resources is enough", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  attackWith(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "only UNSPENT resources can pay: 5 resources of which 4 are already attached leave just 1, so the attack is refused", () => {
  const { engine, id } = ministryBoard({ rage: 1, extra: spent("rage", 4, P2) });
  assert.equal(playOf(engine, P2).filter((c) => engine.isResource(c)).length, 5);
  assert.equal(ready(engine, P2), 1);
  refused(() => attackWith(engine, P2, [id("a1")]), "only one unspent resource");
  assert.equal(battleOf(engine), undefined);
});

clause(MINISTRY, "0:rule", "a face-down resource can pay the 2 as well as a face-up one", () => {
  const { engine, id } = ministryBoard({ rage: 0, extra: volition(2, P2) });
  attackWith(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "the tax applies to attacks on a location as well as on the faction", () => {
  const poor = ministryBoard({ rage: 1 });
  refused(() => attackWith(poor.engine, P2, [poor.id("a1")], { type: "card", cardId: poor.id("min") }), "cannot pay for an attack on the Ministry itself");
  refused(() => attackWith(poor.engine, P2, [poor.id("a1")], { type: "card", cardId: poor.id("town") }), "cannot pay for an attack on another location");
  const rich = ministryBoard({ rage: 4 });
  attackWith(rich.engine, P2, [rich.id("a1")], { type: "card", cardId: rich.id("town") });
  assert.ok(battleOf(rich.engine), "battleOf(rich.engine)");
  assert.equal(ready(rich.engine, P2), 2, "2 paid for the attack on a location");
});

clause(MINISTRY, "0:rule", "it is MY opponent who pays: when I attack, I pay nothing (not even with no resources at all)", () => {
  const { engine, id } = ministryBoard({ attacker: P1, ministryController: P1, rage: 0, p1Resources: 0 });
  attackWith(engine, P1, [id("a1")]);
  assert.ok(battleOf(engine), "my own Ministry does not tax me");
});

clause(MINISTRY, "0:rule", "with a few resources, my attack through my own Ministry spends none of them", () => {
  const { engine, id } = ministryBoard({ attacker: P1, ministryController: P1, rage: 4 });
  attackWith(engine, P1, [id("a1")]);
  assert.equal(ready(engine, P1), 4);
});

clause(MINISTRY, "0:rule", "a Ministry controlled by the OTHER player taxes me: I must pay 2 to attack, while they attack free", () => {
  const taxed = ministryBoard({ attacker: P1, ministryController: P2, rage: 3 });
  attackWith(taxed.engine, P1, [taxed.id("a1")]);
  assert.equal(ready(taxed.engine, P1), 1, "I paid 2");
  const broke = ministryBoard({ attacker: P1, ministryController: P2, rage: 1 });
  refused(() => attackWith(broke.engine, P1, [broke.id("a1")]), "I cannot pay 2");
  assert.equal(battleOf(broke.engine), undefined);
});

clause(MINISTRY, "0:rule", "'your opponent' follows control: a Ministry I own but my opponent controls taxes ME, not them", () => {
  const mine = ministryBoard({ attacker: P1, ministryOwner: P1, ministryController: P2, rage: 3 });
  attackWith(mine.engine, P1, [mine.id("a1")]);
  assert.equal(ready(mine.engine, P1), 1, "its controller's opponent (me) pays");
  const theirs = ministryBoard({ attacker: P2, ministryOwner: P1, ministryController: P2, rage: 3 });
  attackWith(theirs.engine, P2, [theirs.id("a1")]);
  assert.equal(ready(theirs.engine, P2), 3, "its controller attacks for free");
});

clause(MINISTRY, "0:rule", "control: with no Ministry in play the same attack is free", () => {
  const { engine, id } = ministryBoard({ ministry: "none", rage: 0 });
  attackWith(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "off in hand and when it is a face-down resource (no rules text)", () => {
  for (const where of ["hand", "faceDown"] as const) {
    const { engine, id } = ministryBoard({ ministry: where, rage: 0 });
    attackWith(engine, P2, [id("a1")]);
    assert.ok(battleOf(engine), where);
  }
});

clause(MINISTRY, "0:rule", "the tax stops once the Ministry is destroyed", () => {
  const { engine, id } = ministryBoard({ rage: 1, extra: [{ key: "kill", def: killAnyTactic("location"), owner: P1, zone: "hand" }, ...res({ rage: 2 }, P1)] });
  refused(() => attackWith(engine, P2, [id("a1")]), "taxed while the Ministry stands");
  endTurn(engine, P2);
  play(engine, P1, id("kill"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "discard");
  endTurn(engine, P1);
  engine.state.cards[id("a1")].attackEligibleTurn = engine.state.turn;
  attackWith(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "without the Ministry the attack is free");
});

clause(MINISTRY, "0:rule", "two Ministries each demand 2: the opponent needs 4 (3 is not enough)", () => {
  const extra = [{ key: "min2", def: printing(MINISTRY), owner: P1, zone: "play" } as CardPlacement];
  const three = ministryBoard({ rage: 3, extra });
  refused(() => attackWith(three.engine, P2, [three.id("a1")]), "3 resources against 2 + 2");
  const four = ministryBoard({ rage: 4, extra });
  attackWith(four.engine, P2, [four.id("a1")]);
  assert.equal(ready(four.engine, P2), 0, "2 + 2 paid");
});

clause(MINISTRY, "0:rule", "paying does not stop anything else: after a taxed attack is blocked, the battle resolves as normal", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  fight(engine, P2, [id("a1")], { type: "faction", playerId: P1 }, [id("def1")]);
  assert.equal(engine.state.battle, undefined, "the battle finished");
  assert.equal(damageOf(engine, id("def1")), 1);
});

clause(MINISTRY, "0:rule", "the tax is paid when the attack is declared, before any response", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  declareAttackOpenWindow(engine, P2, [id("a1")]);
  assert.equal(ready(engine, P2), 3, "already paid while the defender may still respond");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
});

clause(MINISTRY, "0:rule", "deploys for exactly 3 with [G][G] (refused one short or with one [G]) and is destroyed by 5 damage, not 4 (structure 5)", () => {
  const board = (icons: Icons) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "min", def: printing(MINISTRY), owner: P1, zone: "hand" },
        { key: "z4", def: tactic({ name: "Z4", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }] } }), owner: P1, zone: "hand" },
        { key: "z1", def: tactic({ name: "Z1", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }), owner: P1, zone: "hand" },
        ...res(icons)
      ]
    });
  const short = board({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("min")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("min")), "hand");
  const oneGreed = board({ greed: 1, rage: 5 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("min")), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("min")), "hand");
  const exactG = board({ greed: 2, rage: 1 });
  play(exactG.engine, P1, exactG.id("min"));
  assert.equal(zoneOf(exactG.engine, exactG.id("min")), "play", "control: exactly [G][G] plus one other resource is enough");
  const { engine, id } = board({ greed: 4 });
  play(engine, P1, id("min"));
  assert.equal(zoneOf(engine, id("min")), "play");
  assert.equal(ready(engine), 1, "exactly 3 spent");
  play(engine, P1, id("z4"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "play", "4 damage does not destroy a structure-5 location");
  play(engine, P1, id("z1"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "discard", "5 damage destroys it");
});

// =============================================================================
// Writ of Reclamation (2nd Edition)
// COST: Choose a number for X that is 3 or less. Remove X cards in your discard
//   pile from the game. Pick X other cards in your discard pile.
// EFFECT: Shuffle the other cards into your deck. Draw a card.
// Tactic, banker, cost 2, [G][G].
// =============================================================================

const WRIT = "ffb51e52-f1b7-4b92-ae9d-5e3ce17a46c1";

function writBoard(opts: { discardCards?: number; deckSize?: number; greed?: number; rage?: number; active?: Pid; random?: () => number; extra?: CardPlacement[] } = {}) {
  const n = opts.discardCards ?? 8;
  const mixed: CardDefinition[] = [
    character({ name: "Dead Character" }),
    tactic({ name: "Used Tactic", cost: 1 }),
    item({ name: "Broken Item" }),
    resourceCard({ name: "Spent Staple" })
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "writ", def: printing(WRIT), owner: P1, zone: "hand" },
      { key: "myTac", def: tactic({ name: "My Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      ...Array.from({ length: n }, (_, i) => ({ key: `x${i}`, def: i < mixed.length ? mixed[i] : character({ name: `Dead ${i}` }), owner: P1, zone: "discard" as const })),
      ...fillers("d", opts.deckSize ?? 6, P1, "deck"),
      ...fillers("fx", 4, P2, "discard"),
      ...fillers("fd", 4, P2, "deck"),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 4, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const writSel = (id: (key: string) => string, removed: string[], others: string[]) => ({ rfg: removed.map(id), others: others.map(id) });

/** Plays the Writ at `x`, removing the cards named in `removed` and picking `others`. */
function playWrit(engine: SpoilsEngine, id: (key: string) => string, x: number, removed: string[], others: string[]): void {
  play(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
}

clause(WRIT, "0:ability", "X=1: pays 2, one card of your discard pile is removed from the game as a COST, one other is picked; then it is shuffled into your deck and a card is drawn", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x1"]) });
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("x0")), "removed", "COST: removed from the game when the tactic is played");
  assert.ok(removedOf(engine, P1).includes(id("x0")), "removedOf(engine, P1).includes(id(\"x0\"))");
  assert.equal(zoneOf(engine, id("x1")), "discard", "the picked 'other' card stays in the discard pile until the effect");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.notEqual(zoneOf(engine, id("x1")), "discard", "EFFECT: shuffled into the deck (and maybe the card drawn)");
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x1"))), true);
  assert.equal(zoneOf(engine, id("writ")), "discard", "the tactic is spent");
});

for (const x of [1, 2, 3]) {
  clause(WRIT, "0:ability", `X=${x}: exactly ${x} card(s) leave the game, ${x} other card(s) go back into the deck, exactly one card is drawn`, () => {
    const { engine, id } = writBoard();
    const removed = Array.from({ length: x }, (_, i) => `x${i}`);
    const others = Array.from({ length: x }, (_, i) => `x${i + 3}`);
    const untouched = ["x6", "x7"];
    const discardBefore = discardOf(engine, P1).length;
    const deckBefore = deckOf(engine, P1).length;
    const handBefore = handOf(engine, P1).length;
    playWrit(engine, id, x, removed, others);
    for (const key of removed) assert.equal(zoneOf(engine, id(key)), "removed", `${key} removed from the game`);
    for (const key of untouched) assert.equal(zoneOf(engine, id(key)), "discard", `${key} was not picked`);
    for (const key of others) assert.equal(["deck", "hand"].includes(zoneOf(engine, id(key))), true, `${key} was shuffled into the deck (or drawn)`);
    assert.equal(discardOf(engine, P1).length, discardBefore - 2 * x + 1, "X removed, X shuffled away, and the spent Writ added");
    assert.equal(deckOf(engine, P1).length, deckBefore + x - 1, "X shuffled in, one drawn");
    assert.equal(handOf(engine, P1).length, handBefore, "the Writ was played; one card drawn");
  });
}

clause(WRIT, "0:ability", "X=0: nothing is removed or shuffled in, but a card is still drawn", () => {
  const { engine, id } = writBoard();
  const discardBefore = discardOf(engine, P1).length;
  const handBefore = handOf(engine, P1).length;
  playWrit(engine, id, 0, [], []);
  assert.equal(removedOf(engine, P1).length, 0);
  assert.equal(discardOf(engine, P1).length, discardBefore + 1, "only the spent Writ joined the discard pile");
  assert.equal(deckOf(engine, P1).length, 5, "one card drawn from the 6-card deck");
  assert.equal(handOf(engine, P1).length, handBefore, "the Writ left the hand, one card was drawn");
});

clause(WRIT, "0:ability", "...at X=0 the drawn card is the top of the deck (no shuffle has put anything in)", () => {
  const { engine, id } = writBoard({ random: () => 0 });
  const top = deckOf(engine, P1)[0];
  playWrit(engine, id, 0, [], []);
  assert.equal(zoneOf(engine, top), "hand");
});

clause(WRIT, "0:ability", "X=0 shuffles no cards into the deck, so the deck is not shuffled (CR 313.2: you only shuffle if more than 0 cards are added)", () => {
  const rotating = writBoard({ random: () => 0 });
  const identity = writBoard({ random: () => 0.9999999 });
  playWrit(rotating.engine, rotating.id, 0, [], []);
  playWrit(identity.engine, identity.id, 0, [], []);
  assert.deepEqual(
    deckOf(rotating.engine, P1).map((c) => rotating.engine.getDefinition(c).name),
    deckOf(identity.engine, P1).map((c) => identity.engine.getDefinition(c).name),
    "the deck order must not depend on the random source: no shuffle happened"
  );
});

clause(WRIT, "0:ability", "with X cards shuffled in, the deck IS shuffled afterwards (the order depends on the random source)", () => {
  const rotating = writBoard({ random: () => 0 });
  const identity = writBoard({ random: () => 0.9999999 });
  playWrit(rotating.engine, rotating.id, 2, ["x0", "x1"], ["x4", "x5"]);
  playWrit(identity.engine, identity.id, 2, ["x0", "x1"], ["x4", "x5"]);
  const names = (g: typeof rotating) => deckOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  const everything = (g: typeof rotating) => [...names(g), ...handOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name)].sort();
  assert.deepEqual(everything(rotating), everything(identity), "same cards between deck and hand");
  assert.notDeepEqual(names(rotating), names(identity), "...but the deck order depends on the random source: the deck was shuffled");
});

clause(WRIT, "0:ability", "the draw comes AFTER the shuffle: with an empty deck and X=1 the card drawn is the one just shuffled in", () => {
  const { engine, id } = writBoard({ deckSize: 0 });
  assert.equal(deckOf(engine, P1).length, 0);
  playWrit(engine, id, 1, ["x0"], ["x1"]);
  assert.equal(zoneOf(engine, id("x1")), "hand", "shuffled into the (empty) deck, then drawn");
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(WRIT, "0:ability", "with an empty deck and X=0 there is nothing to draw, nobody loses, and the tactic still resolves", () => {
  const { engine, id } = writBoard({ deckSize: 0 });
  const handBefore = handOf(engine, P1).length;
  playWrit(engine, id, 0, [], []);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("writ")), "discard");
  assert.equal(engine.state.result, undefined);
});

clause(WRIT, "0:ability", "'cards': the removed cards can be any type (character, tactic, item, resource) and so can the picked others", () => {
  const { engine, id } = writBoard();
  playWrit(engine, id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  for (const key of ["x0", "x1", "x2"]) assert.equal(zoneOf(engine, id(key)), "removed", key);
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x3"))), true, "a resource card went back to the deck");
});

clause(WRIT, "0:ability", "X is 3 or less: X=4 is refused (nothing is paid or removed), X=3 is accepted", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 4 }, selected: writSel(id, ["x0", "x1", "x2", "x3"], ["x4", "x5", "x6", "x7"]) }), "X=4");
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  playWrit(engine, id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  assert.equal(zoneOf(engine, id("x0")), "removed");
});

clause(WRIT, "0:ability", "X can't be negative", () => {
  const { engine, id } = writBoard();
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: -1 }, selected: writSel(id, [], []) }), "X=-1");
  assert.equal(zoneOf(engine, id("writ")), "hand");
});

clause(WRIT, "0:ability", "X must be a whole number (CR 410.2): X=1.5 is refused", () => {
  const { engine, id } = writBoard();
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 1.5 }, selected: writSel(id, ["x0"], ["x1"]) }), "X=1.5");
  assert.equal(zoneOf(engine, id("writ")), "hand", "a refused play leaves the card in hand");
  assert.equal(zoneOf(engine, id("x0")), "discard");
});

clause(WRIT, "0:ability", "exactly X cards are removed: fewer or more than X is refused", () => {
  const { engine, id } = writBoard();
  const attempt = (x: number, removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
  refused(attempt(2, ["x0"], ["x2", "x3"]), "X=2 but one removed");
  refused(attempt(1, ["x0", "x1"], ["x2"]), "X=1 but two removed");
  refused(attempt(1, [], ["x2"]), "X=1 but none removed");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  attempt(1, ["x0"], ["x2"])();
  assert.equal(zoneOf(engine, id("x0")), "removed", "control: exactly X is accepted");
});

clause(WRIT, "0:ability", "exactly X other cards are picked: fewer or more than X is refused", () => {
  const { engine, id } = writBoard();
  const attempt = (x: number, removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
  refused(attempt(2, ["x0", "x1"], ["x2"]), "X=2 but one other");
  refused(attempt(1, ["x0"], ["x2", "x3"]), "X=1 but two others");
  refused(attempt(1, ["x0"], []), "X=1 but no other");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  attempt(1, ["x0"], ["x2"])();
  assert.equal(zoneOf(engine, id("x0")), "removed", "control: exactly X is accepted");
});

clause(WRIT, "0:ability", "the others must be OTHER cards: a card can't be both removed and picked to be shuffled in", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x0"]) }), "the same card twice");
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 2 }, selected: writSel(id, ["x0", "x1"], ["x1", "x2"]) }), "overlap");
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("x0")), "discard");
});

clause(WRIT, "0:ability", "both groups come from YOUR discard pile: the opponent's discarded cards, and cards in your hand, deck or in play, are refused", () => {
  const { engine, id } = writBoard();
  const attempt = (removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, removed, others) });
  refused(attempt(["fx0"], ["x1"]), "removing the opponent's card");
  refused(attempt(["x0"], ["fx0"]), "shuffling the opponent's card into my deck");
  refused(attempt(["myTac"], ["x1"]), "removing a card from my hand");
  refused(attempt(["x0"], ["myTac"]), "picking a card from my hand");
  refused(attempt(["d0"], ["x1"]), "removing a card from my deck");
  refused(attempt(["x0"], ["ally"]), "picking a card in play");
  assert.equal(zoneOf(engine, id("fx0")), "discard", "the opponent's discard pile is intact");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  attempt(["x0"], ["x1"])();
  assert.ok(engine.state.responseWindow, "control: my own discarded cards are accepted");
});

clause(WRIT, "0:ability", "the opponent's discard pile, hand and deck are untouched by a successful play", () => {
  const { engine, id } = writBoard();
  const theirDiscard = discardOf(engine, P2).length;
  const theirDeck = deckOf(engine, P2).length;
  const theirHand = handOf(engine, P2).length;
  playWrit(engine, id, 2, ["x0", "x1"], ["x2", "x3"]);
  assert.equal(discardOf(engine, P2).length, theirDiscard);
  assert.equal(deckOf(engine, P2).length, theirDeck);
  assert.equal(handOf(engine, P2).length, theirHand);
});

clause(WRIT, "0:ability", "there must be enough cards: X=3 needs 6 cards in the discard pile (3 removed + 3 others); with 5 it is refused", () => {
  const { engine, id } = writBoard({ discardCards: 5 });
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 3 }, selected: writSel(id, ["x0", "x1", "x2"], ["x3", "x4"]) }), "only 2 others");
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 3 }, selected: writSel(id, ["x0", "x1", "x2"], ["x3", "x4", "x4"]) }), "the same other twice");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  playWrit(engine, id, 2, ["x0", "x1"], ["x2", "x3"]);
  assert.equal(zoneOf(engine, id("x0")), "removed", "control: X=2 needs only 4 cards");
  const six = writBoard({ discardCards: 6 });
  playWrit(six.engine, six.id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  assert.equal(zoneOf(six.engine, six.id("x0")), "removed", "exactly 6 cards is enough for X=3");
});

clause(WRIT, "0:ability", "with an empty discard pile only X=0 is possible", () => {
  const { engine, id } = writBoard({ discardCards: 0 });
  refused(() => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, [], []) }), "nothing to remove");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  playWrit(engine, id, 0, [], []);
  assert.equal(zoneOf(engine, id("writ")), "discard", "control: X=0 still works");
});

clause(WRIT, "0:ability", "is refused one resource short of its cost of 2, and without [G][G]; X does not change the price", () => {
  const short = writBoard({ greed: 0, rage: 1, extra: bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(() => playRaw(short.engine, P1, short.id("writ"), { variables: { x: 1 }, selected: writSel(short.id, ["x0"], ["x1"]) }), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("x0")), "discard", "nothing was removed");
  assert.equal(zoneOf(short.engine, short.id("writ")), "hand");
  const noThreshold = writBoard({ greed: 1, rage: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("writ"), { variables: { x: 1 }, selected: writSel(noThreshold.id, ["x0"], ["x1"]) }), "only one [G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("x0")), "discard");
  for (const x of [0, 3]) {
    const exact = writBoard({ greed: 2 });
    const removed = Array.from({ length: x }, (_, i) => `x${i}`);
    const others = Array.from({ length: x }, (_, i) => `x${i + 3}`);
    playWrit(exact.engine, exact.id, x, removed, others);
    assert.equal(zoneOf(exact.engine, exact.id("writ")), "discard", `X=${x} with exactly 2 resources`);
    assert.equal(ready(exact.engine), 0, `X=${x} still costs just 2`);
  }
});

clause(WRIT, "0:ability", "a tactic: it can be played in response on the opponent's turn", () => {
  const { engine, id } = writBoard({
    active: P2,
    extra: [{ key: "p2tac", def: tactic({ name: "Their Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x1"]) });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("x0")), "removed");
  assert.equal(zoneOf(engine, id("writ")), "discard");
});

clause(WRIT, "0:ability", "the others are chosen as a cost, so the opponent can respond knowing them; a card they remove from the game in response stays removed (CR 402.4) while the rest is shuffled in", () => {
  const exile = tactic({
    name: "Exile One",
    cost: 0,
    behavior: {
      abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "discard" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = writBoard({ extra: [{ key: "exile", def: exile, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("writ"), { variables: { x: 2 }, selected: writSel(id, ["x0", "x1"], ["x2", "x3"]) });
  playRaw(engine, P2, id("exile"), { selected: { t: [id("x2")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("x2")), "removed", "control: the response exiled one of the picked cards");
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x3"))), true, "the other picked card was still shuffled in");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(WRIT, "0:ability", "the removed cards are gone for good: they are removed from the game, not put into the void or shuffled back", () => {
  const { engine, id } = writBoard();
  playWrit(engine, id, 2, ["x0", "x1"], ["x2", "x3"]);
  for (const key of ["x0", "x1"]) {
    assert.equal(zoneOf(engine, id(key)), "removed", key);
    assert.equal(deckOf(engine, P1).includes(id(key)), false, `${key} is not in the deck`);
    assert.equal(handOf(engine, P1).includes(id(key)), false, `${key} is not in the hand`);
  }
});

// =============================================================================
// 0p3r4710n 1337 H4x0rz (2nd Edition)
// COST: Play this only during your turn.
// EFFECT: You may play up to 4 non-tactic cards for free. (You still need to meet
//   its threshold and satisfy its extra costs.)
// Tactic, gearsmith, cost 12, [E][E][E][E].
// =============================================================================

const OPERATION = "a99ce289-c288-496e-b319-861c22e63c53";

type FreePick = { card?: string; selected?: Record<string, string[]> };

function operationBoard(opts: { elitism?: number; greed?: number; rage?: number; deception?: number; active?: Pid; hand?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "leet", def: printing(OPERATION), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Big Five", cost: 5, strength: 3, life: 3 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Mid Three", cost: 3, strength: 2, life: 2 }), owner: P1, zone: "hand" },
      { key: "i3", def: item({ name: "Gadget Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "l4", def: location({ name: "Place Four", cost: 4, structure: 3 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "Dear Six", cost: 6, strength: 4, life: 4 }), owner: P1, zone: "hand" },
      { key: "t1", def: tactic({ name: "Hand Tactic One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "t2", def: tactic({ name: "Hand Tactic Two", cost: 1 }), owner: P1, zone: "hand" },
      ...(opts.hand ?? []),
      { key: "old", def: character({ name: "In The Discard", cost: 1 }), owner: P1, zone: "discard" },
      { key: "indeck", def: character({ name: "In The Deck", cost: 1 }), owner: P1, zone: "deck" },
      { key: "theirs", def: character({ name: "Their Card", cost: 1 }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "On Table" }), owner: P1, zone: "play" },
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("greed", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** The cards currently offered by the open "play for free" prompt, by key. */
function freeCandidates(engine: SpoilsEngine, id: (key: string) => string, keys: string[]): string[] {
  const pc = pending(engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "deployForFree", "the caster is asked whether to play a card for free");
  return keys.filter((key) => pc.candidates.includes(id(key)));
}

function answerFree(engine: SpoilsEngine, id: (key: string) => string, pickKey?: string, selected?: Record<string, string[]>): void {
  const pc = pending(engine);
  assert.equal(pc?.kind, "deployForFree");
  assert.equal(pc.playerId, P1, "the caster decides");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: pickKey ? id(pickKey) : undefined, selected } } as never);
  resolvePendingResponses(engine);
}

/** Plays the tactic and answers each free-play prompt with the next entry of `picks` (undefined = decline); returns how many prompts were asked. */
function runOperation(engine: SpoilsEngine, id: (key: string) => string, picks: Array<string | FreePick | undefined>): number {
  play(engine, P1, id("leet"));
  let asked = 0;
  while (pending(engine)?.kind === "deployForFree" && asked < 10) {
    const next = picks[asked++];
    const pick: FreePick = typeof next === "string" ? { card: next } : next ?? {};
    answerFree(engine, id, pick.card, pick.selected);
  }
  return asked;
}

clause(OPERATION, "0:ability", "pays 12 to play; with exactly 12 resources (four of them [E]) all are spent and the tactic is spent", () => {
  const { engine, id } = operationBoard();
  assert.equal(ready(engine), 12);
  const asked = runOperation(engine, id, []);
  assert.equal(ready(engine), 0, "the printed cost of 12 was paid");
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.ok(asked >= 1, "control: the free-play prompt appeared");
});

clause(OPERATION, "0:ability", "is refused one resource short of its cost of 12, and without [E][E][E][E] (plenty of other resources)", () => {
  const short = operationBoard({ elitism: 4, rage: 7 });
  assert.equal(ready(short.engine), 11);
  refused(() => playRaw(short.engine, P1, short.id("leet")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("leet")), "hand");
  const noThreshold = operationBoard({ elitism: 3, rage: 12 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("leet")), "only three [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("leet")), "hand");
  const exact = operationBoard({ elitism: 4, rage: 8 });
  playRaw(exact.engine, P1, exact.id("leet"));
  assert.equal(ready(exact.engine), 0);
  const plenty = operationBoard({ elitism: 5, rage: 10 });
  playRaw(plenty.engine, P1, plenty.id("leet"));
  assert.equal(ready(plenty.engine), 3, "only 12 of 15 are spent");
});

clause(OPERATION, "0:ability", "'Play this only during your turn': refused in response on the opponent's turn, accepted on mine", () => {
  const react = operationBoard({
    active: P2,
    extra: [{ key: "p2tac", def: tactic({ name: "Their Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(react.engine, P2, react.id("p2tac"));
  assert.equal(react.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  const before = ready(react.engine);
  refused(() => playRaw(react.engine, P1, react.id("leet")), "not my turn", /./);
  assert.equal(zoneOf(react.engine, react.id("leet")), "hand");
  assert.equal(ready(react.engine), before, "nothing was paid");
  const mine = operationBoard();
  playRaw(mine.engine, P1, mine.id("leet"));
  assert.equal(ready(mine.engine), 0, "control: on my own turn it is played");
});

clause(OPERATION, "0:ability", "during my own turn it can also be played in response (to an ability the opponent used against my action)", () => {
  const foeGuy = character({ name: "Foe Guy", behavior: { abilities: [{ id: "peek", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = operationBoard({
    extra: [
      { key: "myTac", def: tactic({ name: "My Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "foeGuy", def: foeGuy, owner: P2, zone: "play" },
      ...fillers("fd", 2, P2, "deck")
    ]
  });
  playRaw(engine, P1, id("myTac"));
  actRaw(engine, P2, id("foeGuy"), "peek");
  playRaw(engine, P1, id("leet"));
  assert.equal(zoneOf(engine, id("leet")), "deploying");
});

clause(OPERATION, "0:ability", "EFFECT: you may play up to four non-tactic cards for free: four chosen cards enter play and cost no resources", () => {
  const { engine, id } = operationBoard();
  const asked = runOperation(engine, id, ["c1", "c2", "i3", "l4"]);
  for (const key of ["c1", "c2", "i3", "l4"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} is in play`);
  assert.equal(zoneOf(engine, id("c6")), "hand", "a fifth card was not played");
  assert.equal(asked, 4, "exactly four prompts");
  assert.equal(ready(engine), 0, "after paying 12, the 5+3+2+4 numeric cost of the cards cost nothing");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(OPERATION, "0:ability", "'up to 4': at most four cards, even with more eligible cards in hand (a fifth is never offered)", () => {
  const { engine, id } = operationBoard();
  const asked = runOperation(engine, id, ["c1", "c2", "i3", "l4", "c6"]);
  assert.equal(asked, 4);
  assert.equal(zoneOf(engine, id("c6")), "hand");
  assert.equal(engine.state.pendingChoice, undefined, "no fifth prompt");
});

clause(OPERATION, "0:ability", "'up to': one, two or three cards are fine, and the rest stay in hand", () => {
  for (const count of [1, 2, 3]) {
    const { engine, id } = operationBoard();
    const keys = ["c1", "c2", "i3"].slice(0, count);
    runOperation(engine, id, keys);
    for (const key of keys) assert.equal(zoneOf(engine, id(key)), "play", `${key} (of ${count})`);
    for (const key of ["c1", "c2", "i3", "l4", "c6"].filter((k) => !keys.includes(k))) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand (of ${count})`);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(ready(engine), 0);
  }
});

clause(OPERATION, "0:ability", "'you may': declining plays nothing; the 12 are still spent and the tactic is spent", () => {
  const { engine, id } = operationBoard();
  runOperation(engine, id, []);
  for (const key of ["c1", "c2", "i3", "l4", "c6"]) assert.equal(zoneOf(engine, id(key)), "hand", key);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(OPERATION, "0:ability", "the cards played for free enter play under my control, from my hand (they leave it)", () => {
  const { engine, id } = operationBoard();
  const handBefore = handOf(engine, P1).length;
  runOperation(engine, id, ["c1", "c2"]);
  assert.equal(controllerOf(engine, id("c1")), P1);
  assert.ok(playOf(engine, P1).includes(id("c1")), "playOf(engine, P1).includes(id(\"c1\"))");
  assert.equal(handOf(engine, P1).includes(id("c1")), false);
  assert.equal(handOf(engine, P1).length, handBefore - 1 - 2, "the tactic and the two cards left the hand");
});

clause(OPERATION, "0:ability", "NON-tactic only: tactics in hand are not offered and can't be chosen", () => {
  const { engine, id } = operationBoard();
  play(engine, P1, id("leet"));
  const offered = freeCandidates(engine, id, ["c1", "c2", "i3", "l4", "c6", "t1", "t2"]);
  assert.deepEqual(offered.sort(), ["c1", "c2", "c6", "i3", "l4"], "characters, items and locations are offered; tactics are not");
  refused(() => answerFree(engine, id, "t1"), "a tactic");
  assert.equal(zoneOf(engine, id("t1")), "hand");
  answerFree(engine, id, "c2");
  assert.equal(zoneOf(engine, id("c2")), "play", "control: a non-tactic card is accepted");
});

clause(OPERATION, "0:ability", "characters, items and locations can each be played: a character, an item and a location enter play", () => {
  const { engine, id } = operationBoard();
  runOperation(engine, id, ["c2", "i3", "l4"]);
  assert.equal(engine.getCardTypes(id("c2")).includes("character"), true);
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(zoneOf(engine, id("i3")), "play");
  assert.equal(zoneOf(engine, id("l4")), "play");
});

clause(OPERATION, "0:ability", "only cards in MY HAND are played: the discard pile, the deck, the opponent's hand and cards already in play can't be chosen", () => {
  const { engine, id } = operationBoard();
  play(engine, P1, id("leet"));
  for (const key of ["old", "indeck", "theirs", "mine"]) refused(() => answerFree(engine, id, key), key);
  assert.equal(zoneOf(engine, id("old")), "discard");
  assert.equal(zoneOf(engine, id("indeck")), "deck");
  assert.equal(zoneOf(engine, id("theirs")), "hand");
  assert.ok(pending(engine), "the prompt is still open");
  answerFree(engine, id, "c1");
  assert.equal(zoneOf(engine, id("c1")), "play");
});

clause(OPERATION, "0:ability", "the same card can't be played twice (once it is in play it's no longer an option)", () => {
  const { engine, id } = operationBoard();
  play(engine, P1, id("leet"));
  answerFree(engine, id, "c1");
  refused(() => answerFree(engine, id, "c1"), "already in play");
  assert.deepEqual(freeCandidates(engine, id, ["c1", "c2"]), ["c2"]);
});

clause(OPERATION, "0:ability", "'for free': a high-cost card (cost 6) is played with no resources spent", () => {
  const { engine, id } = operationBoard({ elitism: 4, rage: 9 });
  const afterCost = 13 - 12;
  runOperation(engine, id, ["c6"]);
  assert.equal(zoneOf(engine, id("c6")), "play");
  assert.equal(ready(engine), afterCost, "only the tactic's own 12 was paid; the 6-cost card was free");
});

clause(OPERATION, "0:ability", "'you still need to meet its threshold': a card whose threshold I don't meet is refused; one I do meet is played", () => {
  const needRage = character({ name: "Needs Rage", cost: 1, threshold: "rr" as never });
  const needGreed = character({ name: "Needs Greed", cost: 1, threshold: "gg" as never });
  const { engine, id } = operationBoard({
    greed: 2,
    rage: 0,
    deception: 6,
    elitism: 4,
    hand: [
      { key: "nr", def: needRage, owner: P1, zone: "hand" },
      { key: "ng", def: needGreed, owner: P1, zone: "hand" }
    ]
  });
  assert.equal(ready(engine), 12);
  play(engine, P1, id("leet"));
  refused(() => answerFree(engine, id, "nr"), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
  answerFree(engine, id, "ng");
  assert.equal(zoneOf(engine, id("ng")), "play", "control: [G][G] is met");
});

clause(OPERATION, "0:ability", "...with the right icons a [R][R] card is played for free too", () => {
  const needRage = character({ name: "Needs Rage", cost: 4, threshold: "rr" as never });
  const { engine, id } = operationBoard({ elitism: 4, rage: 8, hand: [{ key: "nr", def: needRage, owner: P1, zone: "hand" }] });
  runOperation(engine, id, ["nr"]);
  assert.equal(zoneOf(engine, id("nr")), "play");
});

clause(OPERATION, "0:ability", "'satisfy its extra costs': a card with an extra 'pay 2' cost still costs 2 even though its numeric cost is free", () => {
  const costly = character({ name: "Costly Entry", cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }], effects: [] } } });
  const { engine, id } = operationBoard({ elitism: 4, rage: 10, hand: [{ key: "costly", def: costly, owner: P1, zone: "hand" }] });
  assert.equal(ready(engine), 14);
  play(engine, P1, id("leet"));
  assert.equal(ready(engine), 2, "after the tactic's 12");
  answerFree(engine, id, "costly");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("costly")), "play");
  assert.equal(ready(engine), 0, "the additional cost of 2 was paid; only the numeric cost 5 was free");
});

clause(OPERATION, "0:ability", "...and a card whose extra cost I can't pay can't be played for free", () => {
  const costly = character({ name: "Costly Entry", cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }], effects: [] } } });
  const { engine, id } = operationBoard({ elitism: 4, rage: 8, hand: [{ key: "costly", def: costly, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.equal(ready(engine), 0);
  refused(() => answerFree(engine, id, "costly"), "no resources left for the extra 'pay 2'");
  assert.equal(zoneOf(engine, id("costly")), "hand");
});

clause(OPERATION, "0:ability", "...other extra costs are paid too: a card with 'discard a card' as an extra cost makes me discard the chosen card, and is refused without one", () => {
  const discardy = character({
    name: "Discarding Entry",
    cost: 3,
    behavior: { onPlay: { costs: [{ type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }], effects: [] } }
  });
  const { engine, id } = operationBoard({ hand: [{ key: "disc", def: discardy, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  refused(() => answerFree(engine, id, "disc"), "the discard was not chosen");
  assert.equal(zoneOf(engine, id("disc")), "hand");
  answerFree(engine, id, "disc", { d: [id("c6")] });
  assert.equal(zoneOf(engine, id("disc")), "play");
  assert.equal(zoneOf(engine, id("c6")), "discard", "the extra cost was paid: c6 was discarded");
});

clause(OPERATION, "0:ability", "played cards really ENTER play: their 'when this enters play' triggers fire (influence loss, a draw)", () => {
  const painful = character({
    name: "Painful",
    cost: 5,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: -3 }] }] }
  });
  const drawer = character({
    name: "Drawer",
    cost: 4,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = operationBoard({
    elitism: 4,
    greed: 4,
    rage: 4,
    hand: [
      { key: "painful", def: painful, owner: P1, zone: "hand" },
      { key: "drawer", def: drawer, owner: P1, zone: "hand" }
    ],
    extra: fillers("d", 3, P1, "deck")
  });
  const influenceBefore = influenceOf(engine, P1);
  const deckBefore = deckOf(engine, P1).length;
  runOperation(engine, id, ["painful", "drawer"]);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("painful")), "play");
  assert.equal(zoneOf(engine, id("drawer")), "play");
  assert.equal(influenceOf(engine, P1), influenceBefore - 3, "the enters-play loss happened");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1, "the enters-play draw happened");
  assert.equal(ready(engine), 0, "the two cards (5 and 4) were free");
});

clause(OPERATION, "0:ability", "an ATTACH TO card played for free attaches to the host I pick (Smear Campaign on the opponent's character)", () => {
  const { engine, id } = operationBoard({
    greed: 1,
    hand: [{ key: "smear", def: printing(SMEAR), owner: P1, zone: "hand" }],
    extra: [{ key: "foeChar", def: character({ name: "Foe Char" }), owner: P2, zone: "play" }]
  });
  runOperation(engine, id, [{ card: "smear", selected: { attachTo: [id("foeChar")] } }]);
  assert.equal(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, id("foeChar"));
});

clause(OPERATION, "0:ability", "the tactic is spent: it ends in my discard pile once the free plays are done", () => {
  const { engine, id } = operationBoard();
  runOperation(engine, id, ["c1"]);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("leet")), "discardOf(engine, P1).includes(id(\"leet\"))");
});

clause(OPERATION, "0:ability", "with only two eligible cards in hand, those two can be played and the game does not get stuck on the other prompts", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leet", def: printing(OPERATION), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", cost: 2 }), owner: P1, zone: "hand" },
      { key: "b", def: item({ name: "B", cost: 2 }), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1),
      ...bank("rage", 8, P1)
    ]
  });
  runOperation(engine, id, ["a", "b"]);
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("b")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined);
});

clause(OPERATION, "0:ability", "with no non-tactic card in hand nothing can be played and the tactic still resolves", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leet", def: printing(OPERATION), owner: P1, zone: "hand" },
      { key: "t1", def: tactic({ name: "Only Tactic", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1),
      ...bank("rage", 8, P1)
    ]
  });
  runOperation(engine, id, []);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

// =============================================================================
// 1337! (2nd Edition)
// Reduce the numeric cost of the next card you play this turn by 4. Draw a card.
// Tactic, gearsmith, cost 3, [E].
// =============================================================================

const LEET = "45c251f2-2010-4c2b-9640-04aac62092eb";

/** A tactic with the given printed cost whose only effect is to draw a card (so we can see that it resolved). */
const cantrip = (name: string, cost: number, threshold = ""): CardDefinition =>
  tactic({ name, cost, threshold: threshold as never, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

function leetBoard(opts: { icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "leet2", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c4", def: character({ name: "C4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "c6b", def: character({ name: "C6b", cost: 6 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "I5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "loc4", def: location({ name: "Loc4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "t3", def: cantrip("T3", 3), owner: P1, zone: "hand" },
      ...fillers("a", 5, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...res(opts.icons ?? { elitism: 14 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(LEET, "0:rule", "pays its own cost of 3 with [E] and nothing more, and the tactic goes to my discard pile", () => {
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("leet"))), 3);
  assert.equal(zoneOf(engine, id("leet")), "discard");
});

for (const [key, printed, paid] of [
  ["c6", 6, 2],
  ["c5", 5, 1],
  ["c4", 4, 0],
  ["c2", 2, 0],
  ["c0", 0, 0]
] as const) {
  clause(LEET, "0:rule", `the next card (a character with cost ${printed}) costs 4 less: pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    play(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
    assert.equal(zoneOf(engine, id(key)), "play");
  });
}

clause(LEET, "0:rule", "control: without 1337! the same cost-6 character costs the full 6", () => {
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6);
});

clause(LEET, "0:rule", "the reduction is exactly 4, with no choice offered", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(engine.state.pendingChoice, undefined, "no 'how much' prompt: it is always 4");
});

for (const [key, label, printed, paid] of [
  ["i5", "an item", 5, 1],
  ["loc4", "a location", 4, 0],
  ["t3", "a tactic", 3, 0]
] as const) {
  clause(LEET, "0:rule", `works on any card type: ${label} with cost ${printed} pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    play(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
  });
}

clause(LEET, "0:rule", "only the NEXT card: the card after it costs full price", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6, "the reduction was used up");
});

clause(LEET, "0:rule", "the next card can be another 1337!: it costs 0 (3 - 4, never below 0), and ITS reduction applies to the card after", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("leet2"))), 0, "the second 1337! is the next card, so it is free");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "and its own reduction applies to the next card");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6);
});

clause(LEET, "0:rule", "it does not carry over: unused at the end of the turn, the reduction is gone", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6, "the next turn's card pays in full");
});

clause(LEET, "0:rule", "the threshold is not reduced: a discounted card that needs [R][R] is still refused without them", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  refused(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
});

clause(LEET, "0:rule", "a refused attempt does not use the reduction up: the next card that CAN be played still gets it", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  refused(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "0:rule", "a card with a threshold the player does meet still gets the reduction: cost 5 with [R][R] pays 1", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ icons: { elitism: 4, rage: 4 }, extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("nr"))), 1);
});

clause(LEET, "0:rule", "only for me: while my reduction is waiting, my opponent's tactic costs them full price, and my next card still gets the reduction", () => {
  const drawer = character({
    name: "Drawer",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "draw1", name: "Study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = leetBoard({
    extra: [
      { key: "drawer", def: drawer, owner: P1, zone: "play" },
      { key: "oppTactic", def: cantrip("OppTactic", 3), owner: P2, zone: "hand" },
      ...res({ rage: 5 }, P2)
    ]
  });
  play(engine, P1, id("leet"));
  actRaw(engine, P1, id("drawer"), "draw1");
  const theirs = spentBy(engine, P2, () => playRaw(engine, P2, id("oppTactic")));
  assert.equal(theirs, 3, "my opponent pays the full 3: my reduction is not theirs");
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "my reduction is still there for my next card");
});

clause(LEET, "0:rule", "it is a tactic: played in response on the opponent's turn it reduces the next card I play that turn", () => {
  const noop = (name: string) => tactic({ name, cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });
  const { engine, id } = leetBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "p2tac", def: noop("Their Noop"), owner: P2, zone: "hand" },
      { key: "p2tac2", def: noop("Their Noop 2"), owner: P2, zone: "hand" },
      { key: "swift", def: cantrip("Swift", 5), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("leet"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("leet")), "discard", "control: 1337! resolved");
  playRaw(engine, P2, id("p2tac2"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.equal(spentBy(engine, P1, () => playRaw(engine, P1, id("swift"))), 1, "5 - 4");
});

clause(LEET, "0:rule", "draws exactly one card, the top card of my deck, even when there is no card to play afterwards", () => {
  const { engine, id } = leetBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, handBefore, "-1 tactic, +1 drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 4);
  assert.equal(handOf(engine, P2).length, 0, "the opponent draws nothing");
});

clause(LEET, "0:rule", "with an empty deck the reduction still applies and nothing is drawn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      ...res({ elitism: 12 })
    ]
  });
  play(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "0:rule", "the reduction covers the whole numeric cost of the next card, including a 'pay N' extra cost (CR 406.3): cost 2 + pay 4 = 6, minus 4, costs 2", () => {
  const payer = character({ name: "Payer", cost: 2, behavior: { onPlay: { costs: [{ type: "payResources", amount: 4 }], effects: [] } } });
  const { engine, id } = leetBoard({ extra: [{ key: "payer", def: payer, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("payer"))), 6 - 4);
});

clause(LEET, "0:rule", "is refused one resource short of its cost of 3, and without [E] even with plenty of other resources", () => {
  const short = leetBoard({ icons: { elitism: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("leet")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("leet")), "hand");
  const noThreshold = leetBoard({ icons: { rage: 6, greed: 3 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("leet")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("leet")), "hand");
  const oneE = leetBoard({ icons: { elitism: 1, rage: 2 } });
  play(oneE.engine, P1, oneE.id("leet"));
  assert.equal(zoneOf(oneE.engine, oneE.id("leet")), "discard", "control: a single [E] plus two other resources is enough");
  const exact = leetBoard({ icons: { elitism: 3 } });
  play(exact.engine, P1, exact.id("leet"));
  assert.equal(zoneOf(exact.engine, exact.id("leet")), "discard", "[E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// 3p1ph4ny 31f (2nd Edition)
// When this card enters play, you may play a non-tactic card for free. If you do,
// your opponent may do the same. (You still need to meet its threshold and satisfy
// its extra costs.)
// Character (31f), gearsmith, cost 5, [E][E][E], 2 strength / 3 speed / 2 life.
// =============================================================================

const EPIPHANY = "3398fc6e-d1fd-487d-85f2-59486e3256eb";

function epiphanyBoard(opts: { p1Hand?: CardPlacement[]; p2Hand?: CardPlacement[]; icons?: Icons; p2Icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "e", def: printing(EPIPHANY), owner: P1, zone: "hand" },
      ...(opts.p1Hand ?? [
        { key: "pc", def: character({ name: "PChar", cost: 9 }), owner: P1, zone: "hand" as const },
        { key: "pi", def: item({ name: "PItem", cost: 3 }), owner: P1, zone: "hand" as const },
        { key: "pl", def: location({ name: "PLoc", cost: 3 }), owner: P1, zone: "hand" as const },
        { key: "pt", def: cantrip("PTactic", 1), owner: P1, zone: "hand" as const },
        { key: "pr", def: character({ name: "PNeedsRage", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" as const }
      ]),
      ...(opts.p2Hand ?? [
        { key: "oc", def: character({ name: "OChar", cost: 8 }), owner: P2, zone: "hand" as const },
        { key: "oi", def: item({ name: "OItem", cost: 2 }), owner: P2, zone: "hand" as const },
        { key: "ot", def: cantrip("OTactic", 1), owner: P2, zone: "hand" as const },
        { key: "og", def: character({ name: "ONeedsGreed", cost: 1, threshold: "gg" as never }), owner: P2, zone: "hand" as const }
      ]),
      { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { elitism: 8 }),
      ...res(opts.p2Icons ?? { rage: 2 }, P2)
    ]
  });
}

const offeredTo = (engine: SpoilsEngine, player: PlayerId): string[] => {
  const pc = pending(engine);
  assert.ok(pc, "a free-play prompt is open");
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, player, `the prompt belongs to ${player}`);
  return (pc.candidates as string[]).map((c) => engine.getDefinition(c).name).sort();
};

const freeChoice = (engine: SpoilsEngine, player: PlayerId, cardId?: string): void => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId } } as never);
  resolvePendingResponses(engine);
};
const tryFree = (engine: SpoilsEngine, player: PlayerId, cardId: string) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId } } as never);

clause(EPIPHANY, "0:rule", "pays 5 with [E][E][E]; on entering play I am offered the non-tactic cards of my hand I meet the icons for", () => {
  const { engine, id } = epiphanyBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("e"))), 5);
  assert.equal(zoneOf(engine, id("e")), "play");
  const names = offeredTo(engine, P1);
  for (const expected of ["PChar", "PItem", "PLoc"]) assert.ok(names.includes(expected), `${expected} is offered`);
  assert.ok(!names.includes("PTactic"), "a tactic is not a non-tactic card");
  for (const other of ["InDeck", "InDiscard", "OChar", "OItem"]) assert.ok(!names.includes(other), `${other} is not in my hand`);
});

for (const [key, label, type] of [
  ["pc", "character", "character"],
  ["pi", "item", "item"],
  ["pl", "location", "location"]
] as const) {
  clause(EPIPHANY, "0:rule", `I may play a ${label} from my hand for free: it enters play under my control and no resources are spent for it`, () => {
    const { engine, id } = epiphanyBoard();
    play(engine, P1, id("e"));
    const afterEpiphany = ready(engine);
    freeChoice(engine, P1, id(key));
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(controllerOf(engine, id(key)), P1);
    assert.deepEqual(engine.getCardTypes(id(key)), [type]);
    assert.equal(ready(engine), afterEpiphany, "played for free: the cost is not paid (a cost-9 character costs nothing)");
  });
}

clause(EPIPHANY, "0:rule", "a resource card is not offered and cannot be deployed: an effect that lets you deploy a card deploys only a non-resource card (CR 604.2)", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "res", def: resourceCard({ name: "Staple", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "pc", def: character({ name: "PChar", cost: 3 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  assert.ok(!offeredTo(engine, P1).includes("Staple"), "a resource card is not offered");
  refused(tryFree(engine, P1, id("res")), "deploying a resource card through a deploy effect");
  assert.equal(zoneOf(engine, id("res")), "hand");
});

clause(EPIPHANY, "0:rule", "the card chosen must be a non-tactic card of MY hand with the proper resource icons: a tactic, a card from the opponent's hand, my deck or my discard pile, and a card whose icons I lack are refused", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  refused(tryFree(engine, P1, id("pt")), "tactic");
  refused(tryFree(engine, P1, id("pr")), "needs [R][R], which I do not control");
  refused(tryFree(engine, P1, id("oc")), "opponent's hand");
  refused(tryFree(engine, P1, id("inDeck")), "my deck");
  refused(tryFree(engine, P1, id("inDiscard")), "my discard pile");
  refused(tryFree(engine, P1, id("e")), "the card itself is already in play");
  assert.equal(pending(engine)?.kind, "deployForFree", "still waiting for a legal answer");
  assert.equal(zoneOf(engine, id("pt")), "hand");
  assert.equal(zoneOf(engine, id("pr")), "hand");
  freeChoice(engine, P1, id("pi"));
  assert.equal(zoneOf(engine, id("pi")), "play");
});

clause(EPIPHANY, "0:rule", "'you still need to meet its threshold': a card needing [R][R] is offered and playable once I control [R][R]", () => {
  const { engine, id } = epiphanyBoard({ icons: { elitism: 5, rage: 2 } });
  play(engine, P1, id("e"));
  assert.ok(offeredTo(engine, P1).includes("PNeedsRage"), "offeredTo(engine, P1).includes(\"PNeedsRage\")");
  freeChoice(engine, P1, id("pr"));
  assert.equal(zoneOf(engine, id("pr")), "play");
});

clause(EPIPHANY, "0:rule", "'you may': I can decline, and then nothing from my hand is played", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  const resources = ready(engine);
  freeChoice(engine, P1, undefined);
  for (const key of ["pc", "pi", "pl", "pt", "pr"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
  assert.equal(ready(engine), resources);
});

clause(EPIPHANY, "0:rule", "if I played a card, my opponent is offered the non-tactic cards of THEIR hand whose icons they meet", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  const names = offeredTo(engine, P2);
  assert.ok(names.includes("OChar") && names.includes("OItem"), "their non-tactic cards are offered");
  assert.ok(!names.includes("OTactic"), "a tactic is not a non-tactic card");
  for (const mine of ["PChar", "PItem", "PLoc", "PTactic", "PNeedsRage"]) assert.ok(!names.includes(mine), `${mine} is in MY hand, not theirs`);
});

clause(EPIPHANY, "0:rule", "the opponent plays their chosen card for free: it enters play under THEIR control and they spend nothing", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pc"));
  const theirs = ready(engine, P2);
  freeChoice(engine, P2, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(controllerOf(engine, id("oc")), P2);
  assert.equal(ready(engine, P2), theirs, "a cost-8 character for free");
  assert.equal(zoneOf(engine, id("oi")), "hand", "only one card");
  assert.equal(pending(engine), undefined, "nothing more is asked");
});

clause(EPIPHANY, "0:rule", "'may do the same': the opponent can decline", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  freeChoice(engine, P2, undefined);
  assert.equal(zoneOf(engine, id("oc")), "hand");
  assert.equal(zoneOf(engine, id("oi")), "hand");
  assert.equal(pending(engine), undefined);
});

clause(EPIPHANY, "0:rule", "the opponent's choice is limited to their own non-tactic hand cards with icons they control (their tactic, the [G][G] card and my cards are refused)", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  refused(tryFree(engine, P2, id("ot")), "their tactic");
  refused(tryFree(engine, P2, id("og")), "they lack [G][G]");
  refused(tryFree(engine, P2, id("pc")), "a card in MY hand");
  assert.equal(zoneOf(engine, id("pc")), "hand");
  freeChoice(engine, P2, id("oi"));
  assert.equal(zoneOf(engine, id("oi")), "play");
});

clause(EPIPHANY, "0:rule", "the opponent needs the proper icons too: with [G][G] their [G][G] card is offered and playable", () => {
  const { engine, id } = epiphanyBoard({ p2Icons: { greed: 2 } });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  assert.ok(offeredTo(engine, P2).includes("ONeedsGreed"), "offeredTo(engine, P2).includes(\"ONeedsGreed\")");
  freeChoice(engine, P2, id("og"));
  assert.equal(zoneOf(engine, id("og")), "play");
});

clause(EPIPHANY, "0:rule", "the opponent's card can also be an item or a location (any non-tactic card)", () => {
  const { engine, id } = epiphanyBoard({
    p2Hand: [
      { key: "oloc", def: location({ name: "OLoc", cost: 7 }), owner: P2, zone: "hand" },
      { key: "oi", def: item({ name: "OItem", cost: 2 }), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  assert.deepEqual(offeredTo(engine, P2), ["OItem", "OLoc"]);
  freeChoice(engine, P2, id("oloc"));
  assert.equal(zoneOf(engine, id("oloc")), "play");
});

clause(EPIPHANY, "0:rule", "'If you do': when I decline to play a card, my opponent is NOT offered one", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, undefined);
  assert.equal(pending(engine), undefined, "I played nothing, so my opponent gets no offer");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "'If you do': when I have no non-tactic card I can play (so I play nothing), my opponent is NOT offered one", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [{ key: "pt", def: cantrip("PTactic", 1), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("e"));
  assert.equal(pending(engine), undefined, "I could not play anything, so my opponent gets no offer");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "it triggers when THIS card enters play, not when another card does: playing another character afterwards offers nothing", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, undefined);
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  play(engine, P1, id("later"));
  assert.equal(pending(engine), undefined, "no new offer when a different card enters play");
  assert.equal(zoneOf(engine, id("later")), "play");
  assert.equal(zoneOf(engine, id("bystander")), "hand");
});

clause(EPIPHANY, "0:rule", "a card put into play for free can itself be what I picked even if it costs more than my whole resource pool", () => {
  const { engine, id } = epiphanyBoard({ icons: { elitism: 5 } });
  play(engine, P1, id("e"));
  assert.equal(ready(engine), 0);
  assert.ok(offeredTo(engine, P1).includes("PChar"), "cost 9 with 0 resources left is still offered");
  freeChoice(engine, P1, id("pc"));
  assert.equal(zoneOf(engine, id("pc")), "play");
});

clause(EPIPHANY, "0:rule", "'satisfy its extra costs': a card with an extra 'pay 2' cost still costs 2 even though its numeric cost is free (mine and my opponent's)", () => {
  const costly = (name: string) => character({ name, cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }], effects: [] } } });
  const { engine, id } = epiphanyBoard({
    icons: { elitism: 7 },
    p2Icons: { rage: 2 },
    p1Hand: [{ key: "pcostly", def: costly("PCostly"), owner: P1, zone: "hand" }],
    p2Hand: [{ key: "ocostly", def: costly("OCostly"), owner: P2, zone: "hand" }]
  });
  play(engine, P1, id("e"));
  assert.equal(ready(engine), 2);
  freeChoice(engine, P1, id("pcostly"));
  assert.equal(zoneOf(engine, id("pcostly")), "play");
  assert.equal(ready(engine), 0, "the extra cost of 2 was paid; only the numeric cost 5 was free");
  freeChoice(engine, P2, id("ocostly"));
  assert.equal(ready(engine, P2), 0, "the opponent paid their extra 2 as well");
});

clause(EPIPHANY, "0:rule", "another extra cost (discard a card) is still paid for the free card", () => {
  const discardy = character({
    name: "Discarding Entry",
    cost: 3,
    behavior: { onPlay: { costs: [{ type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }], effects: [] } }
  });
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "disc", def: discardy, owner: P1, zone: "hand" },
      { key: "fodder", def: character({ name: "Fodder", cost: 9 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("disc"), selected: { d: [id("fodder")] } } } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("disc")), "play");
  assert.equal(zoneOf(engine, id("fodder")), "discard", "the extra cost was paid");
});

clause(EPIPHANY, "0:rule", "is refused one resource short of its cost of 5, and without [E][E][E] even with plenty of other resources", () => {
  const short = epiphanyBoard({ icons: { elitism: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("e")), "one short");
  assert.equal(zoneOf(short.engine, short.id("e")), "hand");
  const twoE = epiphanyBoard({ icons: { elitism: 2, rage: 8 } });
  refused(() => playRaw(twoE.engine, P1, twoE.id("e")), "only two [E]");
  assert.equal(zoneOf(twoE.engine, twoE.id("e")), "hand");
  const exact = epiphanyBoard({ icons: { elitism: 3, rage: 2 } });
  play(exact.engine, P1, exact.id("e"));
  assert.equal(zoneOf(exact.engine, exact.id("e")), "play", "[E][E][E] and exactly 5 resources is enough");
});

clause(EPIPHANY, "0:rule", "has its printed stats: 2 strength, 2 life, 3 speed, subtype 31f", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  assert.equal(engine.getStat(id("e"), "strength"), 2);
  assert.equal(engine.getStat(id("e"), "life"), 2);
  assert.equal(engine.getStat(id("e"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("e")), ["31f"]);
});

clause(EPIPHANY, "0:rule", "played face-down as a resource it is not a character and offers no free play", () => {
  const { engine, id } = epiphanyBoard();
  developPlay(engine, P1, id("e"), true);
  resolvePendingResponses(engine);
  assert.equal(isFaceDown(engine, id("e")), true);
  assert.equal(pending(engine), undefined, "a face-down card has no rules text");
  assert.equal(zoneOf(engine, id("pc")), "hand");
});

// =============================================================================
// 4p7 31f (2nd Edition)
// If you play a "gear" card attached to this card, you may detach a resource from
// your faction.
// While a "gear" card is attached to this card, it gains 1 strength and 1 life.
// Character (31f), gearsmith, cost 3, [E][E], 2 strength / 3 speed / 2 life.
// =============================================================================

const ELF = "9086bac4-d006-47f1-8e6f-726a886c393b";

const GEAR = (name = "Test Gear", cost = 0): CardDefinition => item({ name, cost, subtype: ["gear"], attachTo: "character" } as Partial<CardDefinition>);
const TRINKET = (name = "Test Trinket"): CardDefinition => item({ name, cost: 0, subtype: ["trinket"], attachTo: "character" } as Partial<CardDefinition>);

function elfBoard(
  opts: { elf?: "hand" | "play"; spent?: number; unspent?: number; attachedGear?: number; attachedTrinket?: boolean; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const gearAttached: CardPlacement[] = Array.from({ length: opts.attachedGear ?? 0 }, (_, i) => ({
    key: `agear${i}`,
    def: GEAR(`Attached Gear ${i}`),
    owner: P1,
    zone: "play" as const,
    attachedToKey: "elf"
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "elf", def: printing(ELF), owner: P1, zone: opts.elf ?? "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: GEAR("Hand Gear"), owner: P1, zone: "hand" },
      { key: "gear2", def: GEAR("Second Hand Gear"), owner: P1, zone: "hand" },
      { key: "trinket", def: TRINKET(), owner: P1, zone: "hand" },
      { key: "foeGear", def: GEAR("Foe Gear"), owner: P2, zone: "hand" },
      ...gearAttached,
      ...(opts.attachedTrinket ? [{ key: "atrinket", def: TRINKET("Attached Trinket"), owner: P1, zone: "play" as const, attachedToKey: "elf" }] : []),
      ...spent("elitism", opts.spent ?? 0, P1).map((p, i) => ({ ...p, key: `s${i}` })),
      ...bank("elitism", opts.unspent ?? 3, P1).map((p, i) => ({ ...p, key: `u${i}` })),
      ...spent("rage", 2, P2).map((p, i) => ({ ...p, key: `fs${i}` })),
      ...(opts.extra ?? [])
    ]
  });
}

const attachedToOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo;
const isSpentRes = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo !== undefined;
const elfStats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** Answers the "you may detach" prompt: accept (picking `resourceKey` if asked which) or decline. */
function answerDetach(engine: SpoilsEngine, id: (key: string) => string, accept: boolean, resourceKey?: string): void {
  const first = pending(engine);
  assert.ok(first, "a 'you may detach a resource' prompt is open");
  assert.equal(first.playerId, P1, "the elf's controller decides");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    const index = options.findIndex((o) => (accept ? !/decline|no\b|nothing/i.test(o.label ?? "") : /decline|no\b|nothing/i.test(o.label ?? "")));
    assert.ok(index >= 0, "the prompt offers both an accept and a decline option");
    answerPending(engine, "chooserSelectsOption", { index });
  } else if (first.kind === "mayPay") {
    answerPending(engine, "mayPay", { pay: accept });
  } else {
    assert.fail(`unexpected prompt ${first.kind}`);
  }
  if (accept && pending(engine)?.kind === "chooserSelectsTarget") {
    assert.ok(resourceKey, "the test must name the resource to detach");
    pickTargets(engine, P1, [id(resourceKey)]);
  }
}

clause(ELF, "1:rule", "with no gear attached it has its printed 2 strength, 2 life and 3 speed", () => {
  const { engine, id } = elfBoard();
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "with a 'gear' card attached it gains exactly 1 strength and 1 life (speed unchanged)", () => {
  const { engine, id } = elfBoard({ attachedGear: 1 });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "it is the gear subtype that counts: an attached card that is not gear gives nothing", () => {
  const { engine, id } = elfBoard({ attachedTrinket: true });
  assert.equal(attachedToOf(engine, id("atrinket")), id("elf"), "control: the trinket is attached");
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "a non-gear attachment next to a gear one doesn't add anything: still +1/+1", () => {
  const { engine, id } = elfBoard({ attachedGear: 1, attachedTrinket: true });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "the bonus is not per gear: two or three gear cards attached still give +1 strength and +1 life ('while a gear card is attached')", () => {
  const { engine, id } = elfBoard({ attachedGear: 2 });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
  const three = elfBoard({ attachedGear: 3 });
  assert.deepEqual(elfStats(three.engine, three.id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "gear attached to ANOTHER character doesn't buff the elf", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "ogear", def: GEAR("Other Gear"), owner: P1, zone: "play", attachedToKey: "other" }] });
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3]);
  assert.deepEqual(elfStats(engine, id("other")), [2, 4, 2], "control: the other character has no gear rule of its own");
});

clause(ELF, "1:rule", "an opponent's gear attached to the elf counts too (it is 'a gear card attached to this card')", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "foeAttached", def: GEAR("Foe Attached"), owner: P2, zone: "play", attachedToKey: "elf" }] });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "a real gear card (Smear Campaign, subtype gear) attached to the elf gives the bonus", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "smear", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "elf" }] });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "playing a gear card onto the elf turns the bonus on", () => {
  const { engine, id } = elfBoard();
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3]);
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, false);
  assert.equal(attachedToOf(engine, id("gear")), id("elf"));
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "the bonus ends when the gear leaves play", () => {
  const smash = tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = elfBoard({ attachedGear: 1, extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3]);
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.equal(zoneOf(engine, id("agear0")), "discard");
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "with two gear cards, destroying one keeps the bonus; destroying both ends it", () => {
  const smash = tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = elfBoard({ attachedGear: 2, extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }, { key: "smash2", def: smash, owner: P1, zone: "hand" }] });
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.deepEqual(elfStats(engine, id("elf")), [3, 3, 3], "one gear left: still buffed");
  play(engine, P1, id("smash2"), { selected: { t: [id("agear1")] } });
  assert.deepEqual(elfStats(engine, id("elf")), [2, 2, 3], "no gear left: back to printed");
});

clause(ELF, "1:rule", "the bonus is real in battle: an elf with a gear attached deals 3 damage (not 2) to the faction", () => {
  const withGear = elfBoard({ attachedGear: 1 });
  const before = influenceOf(withGear.engine, P2);
  fight(withGear.engine, P1, [withGear.id("elf")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influenceOf(withGear.engine, P2), 3);
  const bare = elfBoard();
  const beforeBare = influenceOf(bare.engine, P2);
  fight(bare.engine, P1, [bare.id("elf")], { type: "faction", playerId: P2 }, []);
  assert.equal(beforeBare - influenceOf(bare.engine, P2), 2, "control: without gear it hits for 2");
});

clause(ELF, "1:rule", "the extra life is real: with a gear attached 2 damage doesn't destroy it, and losing the gear then destroys an elf that is carrying 2 damage", () => {
  const dmg2 = tactic({ name: "Zap2", cost: 0, behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } });
  const smash = tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = elfBoard({ attachedGear: 1, extra: [{ key: "zap", def: dmg2, owner: P1, zone: "hand" }, { key: "smash", def: smash, owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap"), { selected: { t: [id("elf")] } });
  assert.equal(zoneOf(engine, id("elf")), "play", "2 damage against 3 life");
  assert.equal(damageOf(engine, id("elf")), 2);
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.equal(zoneOf(engine, id("elf")), "discard", "life back to 2 with 2 damage on it: destroyed");
});

clause(ELF, "1:rule", "a face-down elf is just a resource: a gear card cannot be attached to it and it has no bonus", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "hiddenElf", def: printing(ELF), owner: P1, zone: "play", faceDown: true }] });
  refused(() => playRaw(engine, P1, id("gear"), { selected: { attachTo: [id("hiddenElf")] } }), "a face-down card is not a character");
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

// --- the detach rule ------------------------------------------------------------

clause(ELF, "0:rule", "playing a gear card attached to the elf lets me detach a resource of my faction: accepting detaches the chosen spent resource (one more resource is available)", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 2 });
  assert.equal(ready(engine), 2);
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedToOf(engine, id("gear")), id("elf"));
  answerDetach(engine, id, true, "s1");
  resolvePendingResponses(engine);
  assert.equal(isSpentRes(engine, id("s1")), false, "the chosen resource is detached");
  assert.equal(isSpentRes(engine, id("s0")), true, "the others stay attached");
  assert.equal(isSpentRes(engine, id("s2")), true);
  assert.equal(ready(engine), 3, "exactly one more resource is available");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ELF, "0:rule", "'you may': declining detaches nothing", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 2 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, false);
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 2);
  for (const key of ["s0", "s1", "s2"]) assert.equal(isSpentRes(engine, id(key)), true, key);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedToOf(engine, id("gear")), id("elf"), "the gear stays attached either way");
});

clause(ELF, "0:rule", "it is one resource: a single detach, not all of them, and the prompt does not come twice for one gear", () => {
  const { engine, id } = elfBoard({ spent: 4, unspent: 0 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "a second prompt for the same gear would be a second detach");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "the resource is chosen by me from my faction's attached resources: the opponent's attached resource, a character and the faction are refused", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    answerPending(engine, "chooserSelectsOption", { index: options.findIndex((o) => !/decline/i.test(o.label ?? "")) });
  }
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "which resource?");
  refused(() => pickTargets(engine, P1, [id("fs0")]), "the opponent's resource");
  refused(() => pickTargets(engine, P1, [id("other")]), "a character is not a resource");
  refused(() => pickTargets(engine, P1, [factionOf(engine, P1)]), "the faction itself is not a resource");
  pickTargets(engine, P1, [id("s0")]);
  assert.equal(isSpentRes(engine, id("s0")), false, "control: my own attached resource is accepted");
});

clause(ELF, "0:rule", "'detach a resource from your faction': a resource that is NOT attached to the faction (an unspent one) cannot be picked", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 2 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    answerPending(engine, "chooserSelectsOption", { index: options.findIndex((o) => !/decline/i.test(o.label ?? "")) });
  }
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  refused(() => pickTargets(engine, P1, [id("u0")]), "an unspent resource is not attached to the faction");
  pickTargets(engine, P1, [id("s0")]);
  assert.equal(isSpentRes(engine, id("s0")), false);
});

clause(ELF, "0:rule", "'If YOU play': a gear card the OPPONENT plays attached to my elf does not let me detach a resource", () => {
  const { engine, id } = elfBoard({ active: P2, spent: 2, unspent: 1 });
  play(engine, P2, id("foeGear"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedToOf(engine, id("foeGear")), id("elf"), "control: their gear is on my elf");
  assert.equal(engine.state.pendingChoice, undefined, "I did not play it, so no detach is offered");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "gear played attached to ANOTHER character doesn't trigger the elf (the elf has none of it)", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("other")] } });
  assert.equal(attachedToOf(engine, id("gear")), id("other"));
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: nothing was attached to the elf");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "...even when the elf already carries a gear card: a second gear card played onto ANOTHER character is still no trigger for the elf", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, attachedGear: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("other")] } });
  assert.equal(attachedToOf(engine, id("gear")), id("other"));
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: the new gear is not attached to the elf");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "only GEAR triggers it: a non-gear card played attached to the elf doesn't", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  play(engine, P1, id("trinket"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedToOf(engine, id("trinket")), id("elf"), "control: the trinket attached");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "only GEAR triggers it, also when the elf already carries a gear: a non-gear card played attached to the elf doesn't", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, attachedGear: 1 });
  play(engine, P1, id("trinket"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedToOf(engine, id("trinket")), id("elf"), "control: the trinket attached");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: a trinket is not gear");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "each gear that is played onto the elf triggers it again: two gear cards in turn give two chances to detach", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 2);
  play(engine, P1, id("gear2"), { selected: { attachTo: [id("elf")] } });
  assert.ok(pending(engine), "the second gear prompts again");
  answerDetach(engine, id, true, "s1");
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 3);
});

clause(ELF, "0:rule", "the gear is played (deployed) before the detach: the detach happens when the gear enters play, not while it is still being deployed", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  playRaw(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  assert.equal(engine.state.pendingChoice, undefined, "no detach prompt while the gear is still on the stack");
  assert.equal(ready(engine), 1);
  resolvePendingResponses(engine);
  assert.ok(pending(engine), "the detach is offered once the gear has entered play");
});

clause(ELF, "0:rule", "a gear card played onto a DIFFERENT elf of mine only triggers that elf (not the other copy)", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 1, extra: [{ key: "elf2", def: printing(ELF), owner: P1, zone: "play" }] });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf2")] } });
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "only one prompt: the other elf did not trigger");
  assert.equal(ready(engine), 2);
});

clause(ELF, "0:rule", "deploys for its printed cost of 3 with [E][E] as a 2 strength / 3 speed / 2 life character; one short or one [E] is refused", () => {
  const board = (icons: Icons) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "elf", def: printing(ELF), owner: P1, zone: "hand" }, ...res(icons)] });
  const exactE = board({ elitism: 2, rage: 1 });
  play(exactE.engine, P1, exactE.id("elf"));
  assert.equal(zoneOf(exactE.engine, exactE.id("elf")), "play", "control: exactly [E][E] plus one other resource is enough");
  const ok = board({ elitism: 3 });
  play(ok.engine, P1, ok.id("elf"));
  assert.equal(zoneOf(ok.engine, ok.id("elf")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 3 paid");
  assert.deepEqual(elfStats(ok.engine, ok.id("elf")), [2, 2, 3]);
  assert.deepEqual([...ok.engine.getSubtypes(ok.id("elf"))], ["31f"]);
  const short = board({ elitism: 2 });
  refused(() => playRaw(short.engine, P1, short.id("elf")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("elf")), "hand");
  const oneE = board({ elitism: 1, rage: 5 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("elf")), "only one [E]");
  assert.equal(zoneOf(oneE.engine, oneE.id("elf")), "hand");
});

// =============================================================================
// 700160x 31f (2nd Edition)
// When this card enters play, you may search your deck for a gear card with
// numeric cost 5 or less and reveal it. If you do, put it into play attached to
// this card.
// Character (31f), gearsmith, cost 3, [E][E], 1 strength / 3 speed / 1 life.
// =============================================================================

const GEARFINDER = "d17c2c61-97a1-4290-b612-c8035c9de9be";

/** A "gear" item that attaches to a character and gives it +2 strength. */
const gearItem = (name: string, cost: number, over: Partial<CardDefinition> = {}): CardDefinition =>
  item({
    name,
    cost,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "gearbonus", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] },
    ...over
  });

function gearfinderBoard(opts: { elitism?: number; noGearInDeck?: boolean; random?: () => number; extra?: CardPlacement[] } = {}) {
  const deck: CardPlacement[] = opts.noGearInDeck
    ? []
    : [
        { key: "gear0", def: gearItem("Gear0", 0), owner: P1, zone: "deck" },
        { key: "gear5", def: gearItem("Gear5", 5), owner: P1, zone: "deck" },
        { key: "gear6", def: gearItem("Gear6", 6), owner: P1, zone: "deck" },
        { key: "gearRage", def: gearItem("GearRage", 4, { threshold: "rr" as never }), owner: P1, zone: "deck" }
      ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: opts.random,
    cards: [
      { key: "gf", def: printing(GEARFINDER), owner: P1, zone: "hand" },
      ...deck,
      { key: "tool", def: item({ name: "Tool", cost: 1, subtype: ["tool"], attachTo: "character" }), owner: P1, zone: "deck" },
      { key: "chump", def: character({ name: "Chump", cost: 1 }), owner: P1, zone: "deck" },
      ...fillers("f", 6, P1, "deck"),
      { key: "gearHand", def: gearItem("GearHand", 2), owner: P1, zone: "hand" },
      { key: "gearDiscard", def: gearItem("GearDiscard", 2), owner: P1, zone: "discard" },
      { key: "oppGear", def: gearItem("OppGear", 1), owner: P2, zone: "deck" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: P2, zone: "deck" },
      ...bank("elitism", opts.elitism ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const searchPick = (engine: SpoilsEngine, player: Pid, ids: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(engine);
};

clause(GEARFINDER, "0:rule", "enters play for 3 with [E][E] as a 1 / 3 / 1, and its controller is asked what to fetch", () => {
  const { engine, id } = gearfinderBoard();
  const before = ready(engine);
  play(engine, P1, id("gf"));
  assert.equal(zoneOf(engine, id("gf")), "play");
  assert.equal(before - ready(engine), 3);
  assert.equal(engine.getStat(id("gf"), "strength"), 1);
  assert.equal(engine.getStat(id("gf"), "speed"), 3);
  assert.equal(engine.getStat(id("gf"), "life"), 1);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(GEARFINDER, "0:rule", "a gear with cost 5 is put into play attached to this card and gives it its bonus (strength 1 + 2)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  assert.equal(zoneOf(engine, id("gear5")), "play");
  assert.equal(engine.state.cards[id("gear5")].attachedTo, id("gf"), "attached to the 700160x");
  assert.equal(controllerOf(engine, id("gear5")), P1);
  assert.equal(engine.getStat(id("gf"), "strength"), 3, "the gear's +2 strength applies to its host");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "a gear with cost 0 qualifies as well ('5 or less')", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear0")])();
  assert.equal(zoneOf(engine, id("gear0")), "play");
  assert.equal(engine.state.cards[id("gear0")].attachedTo, id("gf"));
});

clause(GEARFINDER, "0:rule", "a gear with cost 6 is too expensive and cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  refused(searchPick(engine, P1, [id("gear6")]), "cost 6 > 5");
  assert.equal(zoneOf(engine, id("gear6")), "deck");
  assert.ok(pending(engine), "still waiting for a legal pick");
  searchPick(engine, P1, [id("gear5")])();
  assert.equal(zoneOf(engine, id("gear5")), "play", "control: cost 5 is fine");
});

clause(GEARFINDER, "0:rule", "only a 'gear': an item of another subtype and a plain character in the deck cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  refused(searchPick(engine, P1, [id("tool")]), "a non-gear item");
  refused(searchPick(engine, P1, [id("chump")]), "a non-gear character");
  assert.equal(zoneOf(engine, id("tool")), "deck");
  assert.ok(pending(engine), "pending(engine)");
});

clause(GEARFINDER, "0:rule", "only from YOUR DECK: a gear in your hand, your discard pile or the opponent's deck cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  refused(searchPick(engine, P1, [id("gearHand")]), "hand");
  refused(searchPick(engine, P1, [id("gearDiscard")]), "discard pile");
  refused(searchPick(engine, P1, [id("oppGear")]), "the opponent's deck");
  assert.equal(zoneOf(engine, id("oppGear")), "deck");
  assert.equal(zoneOf(engine, id("gearHand")), "hand");
});

clause(GEARFINDER, "0:rule", "only ONE card: two gears are refused", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  refused(searchPick(engine, P1, [id("gear0"), id("gear5")]), "two gears");
  assert.equal(zoneOf(engine, id("gear0")), "deck");
  assert.equal(zoneOf(engine, id("gear5")), "deck");
});

clause(GEARFINDER, "0:rule", "the found gear is revealed: a 'cards revealed' event names it", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.ok(reveals.some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(id("gear5"))), "the found gear was revealed");
});

clause(GEARFINDER, "0:rule", "nothing is revealed when the search is declined", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [])();
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 0);
});

clause(GEARFINDER, "0:rule", "the gear is put into play, not deployed: its own cost and threshold are not required ([R][R] gear with no Rage)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  const after = ready(engine);
  searchPick(engine, P1, [id("gearRage")])();
  assert.equal(zoneOf(engine, id("gearRage")), "play");
  assert.equal(engine.state.cards[id("gearRage")].attachedTo, id("gf"));
  assert.equal(ready(engine), after, "no cost was paid for the gear");
});

clause(GEARFINDER, "0:rule", "'may': its controller can decline; nothing is put into play", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [])();
  for (const key of ["gear0", "gear5", "gear6", "gearRage"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "the deck is shuffled after the search (CR 312.1): same cards, new order", () => {
  const { engine, id } = gearfinderBoard({ random: () => 0 });
  play(engine, P1, id("gf"));
  const before = deckOf(engine, P1).filter((c) => c !== id("gear5"));
  searchPick(engine, P1, [id("gear5")])();
  const after = deckOf(engine, P1);
  assert.deepEqual(sorted(after), sorted(before));
  assert.deepEqual(after, shuffledWithConstant(before, 0), "freshly shuffled");
  assert.notDeepEqual(after, before, "the deck was shuffled");
});

clause(GEARFINDER, "0:rule", "searching and taking nothing (a search that fails, CR 312.2) still shuffles the searched deck", () => {
  const { engine, id } = gearfinderBoard({ random: () => 0 });
  play(engine, P1, id("gf"));
  const before = deckOf(engine, P1);
  searchPick(engine, P1, [])();
  const after = deckOf(engine, P1);
  assert.deepEqual(after, shuffledWithConstant(before, 0), "a searched deck is shuffled even when nothing was taken");
});

clause(GEARFINDER, "0:rule", "'you may search': declining is no search at all, so the deck is NOT shuffled (Q2, CR 312.1)", () => {
  const { engine, id } = gearfinderBoard({ random: () => 0 });
  play(engine, P1, id("gf"));
  const before = deckOf(engine, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P1), before, "nothing was searched, so the deck keeps its order");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "the opponent's deck is not searched or shuffled", () => {
  const { engine, id } = gearfinderBoard({ random: () => 0 });
  const oppDeck = deckOf(engine, P2);
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(GEARFINDER, "0:rule", "a search that finds no legal gear still shuffles the deck (CR 312.1)", () => {
  const { engine, id } = gearfinderBoard({ noGearInDeck: true, random: () => 0 });
  const before = deckOf(engine, P1);
  play(engine, P1, id("gf"));
  drain(engine, declineAll);
  const after = deckOf(engine, P1);
  assert.deepEqual(sorted(after), sorted(before));
  assert.deepEqual(after, shuffledWithConstant(before, 0), "the deck was searched (and found nothing), so it is shuffled");
});

clause(GEARFINDER, "0:rule", "if the host leaves play the fetched gear leaves with it (an Attach-to card cannot stay behind)", () => {
  const { engine, id } = gearfinderBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  play(engine, P1, id("kill"), { selected: { t: [id("gf")] } });
  assert.equal(zoneOf(engine, id("gf")), "discard");
  assert.notEqual(zoneOf(engine, id("gear5")), "play", "the gear left play with its host");
});

clause(GEARFINDER, "0:rule", "it searches only when THIS card enters play: another character entering play asks nothing", () => {
  const { engine, id } = gearfinderBoard({
    extra: [
      { key: "gfInPlay", def: printing(GEARFINDER), owner: P1, zone: "play" },
      { key: "newcomer", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("newcomer"));
  assert.equal(zoneOf(engine, id("newcomer")), "play", "control: the newcomer entered play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "the fetched gear's own enters-play text runs and the gear is a real card in play (e.g. it buffs the host in battle)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  engine.state.cards[id("gf")].attackEligibleTurn = engine.state.turn;
  const before = influenceOf(engine, P2);
  fight(engine, P1, [id("gf")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influenceOf(engine, P2), 3, "1 strength + 2 from the gear");
});

clause(GEARFINDER, "0:rule", "put into play by an effect it still searches (the trigger is 'enters play', not 'is played')", () => {
  const { engine, id } = gearfinderBoard({
    extra: [{ key: "raise", def: raiserTactic(), owner: P1, zone: "hand" }]
  });
  engine.state.cards[id("gf")].zone = "discard";
  engine.state.players[P1].hand = engine.state.players[P1].hand.filter((c) => c !== id("gf"));
  engine.state.players[P1].discard.push(id("gf"));
  play(engine, P1, id("raise"), { selected: { t: [id("gf")] } });
  assert.equal(zoneOf(engine, id("gf")), "play", "control: it was put into play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is offered");
  searchPick(engine, P1, [id("gear0")])();
  assert.equal(engine.state.cards[id("gear0")].attachedTo, id("gf"));
});

clause(GEARFINDER, "0:rule", "played face-down as a resource it is not a character and searches nothing", () => {
  const { engine, id } = gearfinderBoard();
  developPlay(engine, P1, id("gf"), true);
  resolvePendingResponses(engine);
  assert.equal(isFaceDown(engine, id("gf")), true);
  assert.equal(engine.state.pendingChoice, undefined, "no search");
  assert.equal(zoneOf(engine, id("gear5")), "deck");
});

clause(GEARFINDER, "0:rule", "is refused one resource short of 3, and without [E][E]", () => {
  const short = gearfinderBoard({ elitism: 0, extra: [...bank("elitism", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 2, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("gf")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("gf")), "hand");
  const exact = gearfinderBoard({ elitism: 2, extra: bank("rage", 1, P1) });
  play(exact.engine, P1, exact.id("gf"));
  assert.equal(zoneOf(exact.engine, exact.id("gf")), "play", "control: exactly [E][E] plus one other resource is enough");
  const noThreshold = gearfinderBoard({ elitism: 1, extra: bank("rage", 5, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("gf")), "one [E] is short of [E][E]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("gf")), "hand");
});

