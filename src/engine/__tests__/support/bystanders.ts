// Bystander replay (docs/TESTING.md, "Bystander replay"; MULTIPLAYER-PLAN Phase 6 item 1).
//
// With `SPOILS_TEST_EXTRA_SEATS=1|2` the shared fixtures (`buildGame`, and the real-setup helpers that go through
// `createFactionGame`) seat one or two inert BYSTANDERS after the two original players, so every existing two-player test
// becomes a 3- or 4-seat test without being edited. Unset, none of this runs and the fixtures are byte-identical.
//
// Seating. Seats are P1, P2, then the bystanders (P3, P4). The original pair stays adjacent in turn order (P1's turn
// is followed directly by P2's) and P1 is still first. The bystanders sit between P2 and P1: P2 -> P3 (-> P4) -> P1. Any
// seating has the bystanders' turns somewhere in the cycle; this one leaves everything the pair does to each other (the
// first response offered to P1's item is P2's, an attack of P1 is answered by P2) exactly as at two seats.
//
// The harness (installed on `SpoilsEngine.prototype.perform` for every engine registered here) does what a table of
// two real players and inert bystanders would do, and nothing else:
//  * every priority or response a bystander gets is passed; a bid it cannot raise is passed (CR 413.1b), a payment it
//    is offered is declined and an option prompt takes its first option;
//  * a bystander's own turn is played through (restore / develop prompts, nothing deployed, end of turn), and while it
//    runs the original players pass every response window they are offered;
//  * whenever a player has to name "your opponent" (a `players` requirement of a play, a `choosePlayer` prompt, the
//    target of an attack) and, among the candidates, only one is not a bystander, that player is named: it is the
//    question a two-player game never asked (one opponent left = nothing to choose). A choice that still has two or
//    more original-pair candidates is the test's own to answer, as at two seats. The client queries about a play
//    (`getPlayRequirements`, `getPlaySelectionInput`, `checkPlaySelection`) name the same players the play would get.

import { SpoilsEngine as EngineClass } from "../../SpoilsEngine.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { character, noDevelopFaction } from "./fixtures.js";

/** 0 (unset), 1 or 2 bystanders. */
export const EXTRA_SEATS: number = (() => {
  const raw = process.env.SPOILS_TEST_EXTRA_SEATS;
  if (raw === undefined || raw === "" || raw === "0") return 0;
  if (raw !== "1" && raw !== "2") throw new Error(`SPOILS_TEST_EXTRA_SEATS must be 1 or 2, got '${raw}'.`);
  return Number(raw);
})();

interface Table {
  bystanders: Set<PlayerId>;
}

const tables = new WeakMap<object, Table>();

/** A bystander's name in the game state: an engine built from a copy of the state (a save, a clone) finds its bystanders by it. */
export const BYSTANDER_NAME = "bystander";
export const bystanderName = (id: PlayerId): string => `${BYSTANDER_NAME} ${id}`;

/** The harness table of `engine`: registered by a fixture, or read from the bystander names in its state. */
function tableOf(engine: SpoilsEngine): Table | undefined {
  const known = tables.get(engine);
  if (known) return known;
  const ids = Object.keys(engine.state.players).filter(id => engine.state.players[id]?.name === bystanderName(id));
  if (ids.length === 0) return undefined;
  const table: Table = { bystanders: new Set(ids) };
  tables.set(engine, table);
  return table;
}

/**
 * The bystanders' decks for a game built through the real setup path: a faction with no Develop choices, no starting
 * resources and no opening hand, and a few plain characters (so nothing a test does runs a bystander out of cards).
 */
export function bystanderSeats(count: number = EXTRA_SEATS): Array<{ id: PlayerId; faction: CardDefinition; deck: CardDefinition[] }> {
  return bystanderIds(count).map(id => ({
    id,
    faction: noDevelopFaction({ id: `${id}-bystander-faction`, name: `${id}-faction` }),
    deck: Array.from({ length: 5 }, (_, i) => character({ id: `${id}-bystander-card-${i}`, name: `${id} card ${i}` }))
  }));
}

/** The ids of the bystander seats: P3, P4. */
export const bystanderIds = (count: number = EXTRA_SEATS): PlayerId[] => ["p3", "p4"].slice(0, count);

/** Registers `engine` as a game with bystanders (called by the fixtures that seat them). */
export function registerBystanders(engine: SpoilsEngine, bystanders: PlayerId[]): void {
  installHarness();
  const table: Table = { bystanders: new Set(bystanders) };
  tables.set(engine, table);
  bindLasting(engine, table, inner());
  // A created ability ("both players write it") starts applying the moment it is given: bind its opponent right then.
  const created = engine.applyCreatedFactionAbility.bind(engine);
  engine.applyCreatedFactionAbility = (...args: Parameters<typeof created>) => {
    const count = created(...args);
    bindLasting(engine, table, inner());
    return count;
  };
}

/**
 * Cards a test put straight into play (or gave an ability: `applyCreatedFactionAbility`) never started applying: text
 * that says "your opponent" selects its opponent now (RQ-mp-5), as it would have when it came into play at a two-player
 * table. Run when the game is registered and before every action.
 */
function bindLasting(engine: SpoilsEngine, table: Table, perform: Perform): void {
  rememberOpponents(engine, table);
  const held = engine as unknown as { syncLastingOpponents(): boolean };
  for (let guard = 0; guard < 100 && !engine.state.pendingChoice && held.syncLastingOpponents(); guard++) settle(engine, table, perform);
}

type Loose = Record<string, unknown> & { kind?: string; playerId?: PlayerId };
type Perform = (this: SpoilsEngine, action: unknown) => void;

/** SPOILS_SEATS_TRACE=1 logs what the harness itself does (to stderr), for finding out why a replayed test differs. */
const trace = (what: string, detail: unknown): void => {
  if (process.env.SPOILS_SEATS_TRACE) console.error(`[bystanders] ${what} ${JSON.stringify(detail)}`);
};

/** The players an elimination was traced for, and the engines whose end of game was. */
const seenEliminated = new WeakSet<object>();

let installed: Perform | undefined;
/** The engine's `getPlayRequirements` as it was before the harness wrapped it. */
let requirementsOf: (this: SpoilsEngine, action: never) => unknown;
/** The engine's `perform` as it was before the harness wrapped it. */
const inner = (): Perform => installed!;
function installHarness(): void {
  if (installed) return;
  const proto = EngineClass.prototype as unknown as { perform: Perform; checkAction: (this: SpoilsEngine, action: unknown) => unknown };
  const original = proto.perform;
  installed = original;
  // The engine's direct entry points that take a hand-made resolution context: a context that names no opponent gets the
  // controller's opponent among the original pair (the one it had at two seats).
  for (const method of ["resolveEffect", "evaluateCondition", "queryCards"] as const) {
    const direct = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
    (proto as unknown as Record<string, unknown>)[method] = function (this: SpoilsEngine, first: unknown, context: unknown, ...rest: unknown[]) {
      const table = tableOf(this);
      const given = context as { controllerId?: PlayerId; opponentId?: PlayerId } | undefined;
      if (table && given && typeof given === "object" && given.opponentId === undefined && given.controllerId !== undefined && !table.bystanders.has(given.controllerId)) {
        const opponent = originals(table, this.getOpponents(given.controllerId));
        if (opponent.length === 1) given.opponentId = opponent[0];
      }
      return direct.call(this, first, context, ...rest);
    };
  }
  // A rehearsal of an action names the same players the action itself would get.
  const check = proto.checkAction;
  proto.checkAction = function (this: SpoilsEngine, action: unknown): unknown {
    const table = tableOf(this);
    return check.call(this, table ? namePlayers(this, table, action as Loose) : action);
  };
  // What the client is asked for a play names the same players the play itself would get.
  const requirements = (proto as unknown as { getPlayRequirements: typeof requirementsOf }).getPlayRequirements;
  requirementsOf = requirements;
  (proto as unknown as { getPlayRequirements: typeof requirementsOf }).getPlayRequirements = function (this: SpoilsEngine, action: never): unknown {
    const table = tableOf(this);
    return requirements.call(this, table ? (namePlayers(this, table, action as Loose) as never) : action);
  };
  // The picks of a play name the same opponent the play itself would get (the input carries the play they belong to).
  const selectionInput = (proto as unknown as { getPlaySelectionInput: (this: SpoilsEngine, ...args: unknown[]) => { play?: Loose } }).getPlaySelectionInput;
  (proto as unknown as { getPlaySelectionInput: typeof selectionInput }).getPlaySelectionInput = function (this: SpoilsEngine, ...args: unknown[]) {
    const input = selectionInput.apply(this, args);
    const table = tableOf(this);
    return table && input.play ? { ...input, play: namePlayers(this, table, input.play) } : input;
  };
  const checkSelection = (proto as unknown as { checkPlaySelection: (this: SpoilsEngine, action: unknown, ...rest: unknown[]) => unknown }).checkPlaySelection;
  (proto as unknown as { checkPlaySelection: typeof checkSelection }).checkPlaySelection = function (this: SpoilsEngine, action: unknown, ...rest: unknown[]) {
    const table = tableOf(this);
    return checkSelection.call(this, table ? namePlayers(this, table, action as Loose) : action, ...rest);
  };
  proto.perform = function (this: SpoilsEngine, action: unknown): void {
    const table = tableOf(this);
    if (!table) {
      original.call(this, action);
      return;
    }
    bindLasting(this, table, original);
    const named = namePlayers(this, table, action as Loose);
    if (named !== action) trace("named players in", named);
    trace("perform", { type: named.type, playerId: named.playerId, kind: (named.choice as Loose | undefined)?.kind });
    original.call(this, named);
    settle(this, table, original);
    if (this.state.winner !== undefined && !seenEliminated.has(this)) {
      seenEliminated.add(this);
      trace("game over", { winner: this.state.winner });
    }
    for (const player of Object.values(this.state.players)) {
      if (player.eliminated && !seenEliminated.has(player)) {
        seenEliminated.add(player);
        trace("eliminated", { player: player.id, over: this.state.winner !== undefined });
      }
    }
    trace("settled", {
      active: this.state.activePlayerId,
      pending: this.state.pendingChoice ? { kind: this.state.pendingChoice.kind, playerId: (this.state.pendingChoice as unknown as Loose).playerId } : null,
      window: this.state.responseWindow ? { phase: this.state.responseWindow.phase, priority: this.state.responseWindow.priorityPlayerId } : null,
      stack: this.state.responseStack.length
    });
  };
}

/** The candidates a two-player game would have offered: the bystanders are not at that table. */
const originals = (table: Table, candidates: readonly PlayerId[]): PlayerId[] => candidates.filter(id => !table.bystanders.has(id));

/** Adds the opponent the two-player action left out ("your opponent" of a play, the target of an attack). */
function namePlayers(engine: SpoilsEngine, table: Table, action: Loose): Loose {
  const type = action.type as string;
  const playerId = action.playerId;
  if (playerId === undefined || table.bystanders.has(playerId)) return action;
  if (type === "declareAttack") {
    const target = action.target as { type: string; playerId?: PlayerId } | undefined;
    if (target !== undefined && !(target.type === "faction" && target.playerId === undefined)) return action;
    const opponents = originals(table, engine.getOpponents(playerId));
    if (opponents.length !== 1) return action;
    return { ...action, target: { type: "faction", playerId: opponents[0] } };
  }
  if (type === "resolvePendingChoice") {
    // The play an answer starts ("you may deploy it for free", reveal-deploy, "use one of its abilities") names its own players.
    const choice = action.choice as Loose;
    const pending = engine.state.pendingChoice as unknown as Loose | undefined;
    if (choice.kind === "selectTargets" && pending?.kind === "selectTargets") {
      const picks = pendingPicks(engine, table, pending);
      if (Object.keys(picks).length === 0) return action;
      return { ...action, choice: { ...choice, selected: { ...picks, ...((choice.selected as Record<string, string[]>) ?? {}) } } };
    }
    let play: Loose | undefined;
    if ((choice.kind === "deployForFree" || choice.kind === "resourceReveal") && typeof choice.cardId === "string") {
      play = { type: "playCard", playerId, cardId: choice.cardId };
    } else if (choice.kind === "useTargetAbility" && typeof choice.abilityId === "string" && typeof pending?.targetCardId === "string") {
      play = { type: "activateAbility", playerId, cardId: pending.targetCardId, abilityId: choice.abilityId };
    }
    if (!play) return action;
    for (const key of ["selected", "variables", "players"]) if (choice[key] !== undefined) play[key] = choice[key];
    const named = fillPlayers(engine, table, play);
    return named === play ? action : { ...action, choice: { ...choice, players: named.players } };
  }
  if (type !== "playCard" && type !== "activateAbility" && type !== "flipUp") return action;
  return fillPlayers(engine, table, action);
}

/** `action` (a play, an ability use, a FLIP UP) with the opponent it needs named, when a two-player table would not have asked. */
function fillPlayers(engine: SpoilsEngine, table: Table, action: Loose): Loose {
  let named = action;
  for (let round = 0; round < 6; round++) {
    let requirements: Array<{ kind: string; choices?: Array<{ id: string; candidates: PlayerId[] }> }>;
    try {
      requirements = requirementsOf.call(engine, named as never) as never;
    } catch {
      return named;
    }
    const gate = requirements.find(requirement => requirement.kind === "players");
    if (!gate?.choices) {
      const picks = forcedPicks(engine, table, requirements as unknown as PickLike[]);
      if (Object.keys(picks).length === 0) return named;
      named = { ...named, selected: { ...((named.selected as Record<string, string[]> | undefined) ?? {}), ...picks } };
      continue;
    }
    const values: Record<string, PlayerId> = {};
    for (const choice of gate.choices) {
      const left = originals(table, choice.candidates);
      if (left.length === 1) values[choice.id] = left[0];
    }
    if (Object.keys(values).length === 0) return named;
    named = { ...named, players: { ...((named.players as Record<string, PlayerId> | undefined) ?? {}), ...values } };
  }
  return named;
}

type PickLike = { kind: string; requirement?: { id: string }; candidates?: string[]; min?: number; max?: number };

/**
 * The picks a two-player game would not have asked: among the candidates, the cards a bystander controls are not at that
 * table, and what is left is exactly what the pick needs ("pick an opponent's faction": the only opponent's faction).
 * A pick still ambiguous without the bystanders is the test's own.
 */
function forcedPicks(engine: SpoilsEngine, table: Table, steps: PickLike[], forTrigger = false): Record<string, string[]> {
  const picks: Record<string, string[]> = {};
  for (const step of steps) {
    if (step.kind !== "pick" || !step.requirement || !step.candidates) continue;
    // Only a pick the card never says ("pick ...") is filled in for the test: a two-player test that omits an explicit pick expects the refusal.
    if (!(step.requirement as { impliedPick?: boolean }).impliedPick && !forTrigger) continue;
    const left = step.candidates.filter(id => !table.bystanders.has(engine.state.cards[id]?.controllerId));
    if (left.length === step.candidates.length || left.length === 0) continue;
    if (left.length === step.min && (step.max ?? left.length) >= left.length) picks[step.requirement.id] = left;
  }
  return picks;
}

/** The forced picks (see `forcedPicks`) of a trigger's `selectTargets` prompt. */
function pendingPicks(engine: SpoilsEngine, table: Table, pending: Loose): Record<string, string[]> {
  try {
    const steps = engine.getSelectionRequirements({
      sourceId: pending.sourceId,
      controllerId: pending.playerId,
      ...(pending.abilityId ? { abilityId: pending.abilityId } : {}),
      declarations: pending.declarations,
      costs: [],
      selected: {},
      variables: {},
      ...(pending.context ? { context: pending.context } : {})
    } as never);
    return forcedPicks(engine, table, steps as unknown as PickLike[], true);
  } catch {
    return {};
  }
}

/**
 * A card a test put into play (or its discard pile) after "the play that remembered the opponent" ("rememberPlayer": the
 * opponent whose deck it searched) never ran that play. With one opponent left the engine reads that opponent; here the
 * remembered player is the one the two-player game had: the controller's opponent among the original pair.
 */
function rememberOpponents(engine: SpoilsEngine, table: Table): void {
  for (const card of Object.values(engine.state.cards)) {
    if (card.zone === "hand" || card.zone === "deck" || table.bystanders.has(card.controllerId)) continue;
    const behavior = engine.getDefinition(card.id).behavior;
    if (!behavior) continue;
    const text = JSON.stringify(behavior);
    if (!text.includes('"rememberedPlayer"')) continue;
    const opponent = originals(table, engine.getOpponents(card.controllerId));
    if (opponent.length !== 1) continue;
    for (const [, key] of text.matchAll(/"type":"rememberedPlayer","key":"([^"]+)"/g)) {
      if (card.rememberedPlayers?.[key] === undefined) card.rememberedPlayers = { ...(card.rememberedPlayers ?? {}), [key]: opponent[0] };
    }
  }
}

/** The answer a harness-driven player gives to `pending`, or undefined when it is not the harness's to answer. */
function answerFor(engine: SpoilsEngine, table: Table, pending: Loose, bystanderTurn: boolean): Record<string, unknown> | undefined {
  const kind = pending.kind;
  const owner = pending.playerId as PlayerId;
  if (kind === "choosePlayer") {
    const left = originals(table, pending.candidates as PlayerId[]);
    if (left.length === 1 && !table.bystanders.has(owner)) return { kind, playerId: left[0] };
    return undefined;
  }
  if (kind === "selectTargets" && !table.bystanders.has(owner)) {
    const picks = pendingPicks(engine, table, pending);
    const declarations = pending.declarations as Array<{ id: string }>;
    return declarations.every(declaration => picks[declaration.id] !== undefined) ? { kind, selected: picks } : undefined;
  }
  // An inert bystander has no resources: it passes a bid it cannot raise (CR 413.1b) and declines a payment it is offered.
  if (table.bystanders.has(owner)) {
    if (kind === "auctionBid") return { kind, bid: 0 };
    if (kind === "mayPay" || kind === "anyPlayerMayPay") return { kind, pay: false };
    if (kind === "chooserSelectsOption" && !bystanderTurn) return { kind, index: 0 };
  }
  if (!bystanderTurn) return undefined;
  if (kind === "orderTriggers") {
    const triggers = pending.triggers as Array<{ abilityId?: string }>;
    return { kind, next: triggers.find(trigger => trigger.abilityId === "restoreRule") ?? triggers[0] };
  }
  if (kind === "chooserSelectsOption") {
    const options = pending.options as Array<{ label?: string }>;
    const draw = options.findIndex(option => /^Draw /.test(option.label ?? ""));
    return { kind, index: draw >= 0 ? draw : 0 };
  }
  void engine;
  return undefined;
}

/** Passes for the bystanders, plays their turns through, and names the opponent: until the table waits for a test's player. */
function settle(engine: SpoilsEngine, table: Table, inner: Perform): void {
  let advancedUnseen = false;
  for (let guard = 0; guard < 500; guard++) {
    const state = engine.state;
    if (state.winner) return;
    // Both original players are out (MPX-elim) and only inert bystanders remain: nothing is left for the table to wait for.
    if (Object.values(state.players).every(player => player.eliminated || table.bystanders.has(player.id))) return;
    const setup = state.setup as { phase: string; order?: PlayerId[]; currentIndex?: number };
    if (setup.phase !== "complete") {
      // A bystander keeps the opening hand (no mulligan); the other setup steps are the test's, as at two seats.
      const seat = setup.order?.[setup.currentIndex ?? 0];
      if (setup.phase === "mulligan" && seat !== undefined && table.bystanders.has(seat)) {
        trace("keeps the hand", seat);
        inner.call(engine, { type: "mulligan", playerId: seat, cardIds: [] });
        continue;
      }
      return;
    }
    const bystanderTurn = table.bystanders.has(state.activePlayerId);
    if (bystanderTurn) trace("bystander turn", state.activePlayerId);
    const pending = state.pendingChoice as unknown as Loose | undefined;
    if (pending) {
      const choice = answerFor(engine, table, pending, bystanderTurn);
      if (!choice) {
        trace("leaves pending", { kind: pending.kind, playerId: pending.playerId });
        return;
      }
      trace("answers", { kind: pending.kind, playerId: pending.playerId, choice });
      inner.call(engine, { type: "resolvePendingChoice", playerId: pending.playerId, choice });
      continue;
    }
    const window = state.responseWindow;
    if (window) {
      if (window.phase === "acceptingResponses") {
        if (!bystanderTurn && !table.bystanders.has(window.priorityPlayerId)) return;
        trace("passes for", window.priorityPlayerId);
        inner.call(engine, { type: "passPriority", playerId: window.priorityPlayerId });
      } else {
        // A window only the bystanders were ever offered (the original opponent cannot respond: "your opponent cannot
        // respond") never existed at two seats: the item resolves now. Otherwise the test advances it, as it would there.
        const passed = window.passed ?? [];
        // Only the item this action put on the stack: what is under it was offered to the original players before.
        const unseen = !advancedUnseen && passed.length > 0 && passed.every(id => table.bystanders.has(id));
        if (!bystanderTurn && !unseen) return;
        if (unseen) advancedUnseen = true;
        trace("advances", { phase: window.phase, passed, stack: state.responseStack.length });
        inner.call(engine, { type: "advanceFlow" });
      }
      continue;
    }
    if (bystanderTurn && !state.battle) {
      trace("plays the turn of", state.activePlayerId);
      inner.call(engine, { type: "endTurn", playerId: state.activePlayerId });
      continue;
    }
    return;
  }
  throw new Error("bystander harness: the table did not settle (possible loop).");
}

// Installed as soon as a test file imports the fixtures, so engines made from a copy of a bystander game are covered too.
if (EXTRA_SEATS > 0) installHarness();
