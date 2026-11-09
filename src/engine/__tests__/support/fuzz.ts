// Fuzz: seeded random games with real catalog decks at any number of seats, with the table-wide invariants checked
// after every action (docs/TESTING.md, "Fuzz").
//
// `fuzzGame(seats, seed)` builds the setup (`randomSetup`) and plays it with the random driver (`playRandomGame`).
// After setup and after every performed action `checkInvariants` runs; the first violated invariant stops the game
// and is reported with the seed, the step and the action. A game that reaches `maxActions` is `capped`, not a failure.
// Same seats + same seed + same catalog => the same game.
//
// Invariants (named as `Violation.invariant`):
//   zones          every card is in exactly one zone: listed once, in the array of its zone and of its holder
//   eliminated     a player who has lost owns and controls nothing, has nothing waiting (RQ-mp-3)
//   turn           a turn goes to the next player still in the game, clockwise; nobody who has lost is the active player
//   winner         a finished game has exactly one winner (a player still in the game) or is a draw; a running game
//                  has at least two players in it
//   priority       priority is never given to a player who has lost or to the controller of the top item
//   saveLoad       a save pushed through JSON and loaded is the same state (same digest) and stays the same, action by
//                  action, over the next few actions
//   redaction      no viewer's redacted view carries a card hidden from them: definition, name, own-view fields

import {
  HIDDEN_DEFINITION_ID,
  loadGame,
  redactFlowViewFor,
  redactStateFor,
  saveGame,
  type CardInstance,
  type CardInstanceId,
  type GameAction,
  type GameFlowView,
  type GameState,
  type PlayerId,
  type PlayerState,
  type SpoilsEngine
} from "../../../engine.js";
import { canonicalJson, digestState } from "./digest.js";
import { CARD_NAME_CATALOG, CATALOG, playRandomGame, randomSetup, type Finding } from "./driver.js";

export type InvariantName = "zones" | "eliminated" | "turn" | "winner" | "priority" | "saveLoad" | "redaction";

export interface Violation {
  invariant: InvariantName;
  message: string;
}

export interface FuzzOptions {
  /** Cap on performed actions (default 1500). */
  maxActions?: number;
  /** Save, JSON, load every this many actions, then follow the loaded copy for `followActions` (default 11). 0: never. */
  saveEvery?: number;
  /** How many actions the loaded copy is followed for (default 6). */
  followActions?: number;
  /** Check every viewer's redacted state every this many actions (default 1). 0: never. */
  redactEvery?: number;
  /** Also search the whole redacted view, log included, for hidden names every this many actions (default 7). 0: never. */
  textEvery?: number;
}

export interface FuzzResult {
  seats: number;
  seed: number;
  status: "gameOver" | "capped" | "finding" | "violation";
  /** Performed actions. */
  actions: number;
  turns: number;
  /** Players eliminated while the game went on (the last loss that ends a game is not counted). */
  eliminations: number;
  winner?: GameState["winner"];
  /** The driver's own finding: `perform` threw on an action `checkAction` approved, or no action was legal. */
  finding?: Finding;
  violation?: Violation & { step: number; action?: GameAction };
}

/** The driver seed a fuzz game uses for a setup seed (the formula the regression tests of the random driver use). */
export const fuzzDriverSeed = (seed: number): number => Math.imul(seed, 2654435761) >>> 0;

const ARRAY_ZONES = ["deck", "hand", "play", "discard", "void", "removed"] as const;

type Check = Violation | undefined;
const fail = (invariant: InvariantName, message: string): Violation => ({ invariant, message });

const livePlayers = (state: GameState): PlayerState[] => Object.values(state.players).filter(player => !player.eliminated);

// -----------------------------------------------------------------------------------------------------------------
// zones
// -----------------------------------------------------------------------------------------------------------------

/** The player whose array holds `card` in `zone`. */
function holderOf(card: CardInstance, zone: (typeof ARRAY_ZONES)[number]): PlayerId {
  return zone === "hand" || zone === "deck" ? (card.heldBy ?? card.ownerId) : zone === "play" ? card.controllerId : card.ownerId;
}

function checkZones(state: GameState): Check {
  const listed = new Map<CardInstanceId, string>();
  for (const player of Object.values(state.players)) {
    for (const zone of ARRAY_ZONES) {
      for (const id of player[zone]) {
        const card = state.cards[id];
        if (!card) return fail("zones", `${player.id}.${zone} lists ${id}, which is not a card of the game`);
        const earlier = listed.get(id);
        if (earlier) return fail("zones", `${id} is listed twice: ${earlier} and ${player.id}.${zone}`);
        listed.set(id, `${player.id}.${zone}`);
        if (card.zone !== zone) return fail("zones", `${id} is in ${player.id}.${zone} but says zone ${card.zone}`);
        if (holderOf(card, zone) !== player.id) {
          return fail("zones", `${id} (owner ${card.ownerId}, controller ${card.controllerId}, heldBy ${card.heldBy ?? "-"}) is in ${player.id}.${zone}`);
        }
      }
    }
  }
  for (const card of Object.values(state.cards)) {
    if (card.id in state.players) return fail("zones", `a card has a player's id ${card.id}`);
    if (card.zone === "deploying") {
      if (listed.has(card.id)) return fail("zones", `${card.id} is deploying and also listed in ${listed.get(card.id)}`);
    } else if (!listed.has(card.id)) {
      return fail("zones", `${card.id} (zone ${card.zone}) is in no player's array`);
    }
  }
  return undefined;
}

// -----------------------------------------------------------------------------------------------------------------
// eliminated players (RQ-mp-3)
// -----------------------------------------------------------------------------------------------------------------

/** Lists on `GameState` whose records say who created them. */
const RECORDS_BY_CREATOR = [
  "modifiers", "keywordGrants", "keywordSuppressions", "playerKeywordGrants", "abilitySuppressions", "restrictions",
  "costReductions", "thresholdReductions", "numericCostModifiers", "outgoingDamageModifiers", "playRestrictions",
  "resourceGrants", "provideGrants", "cardTypeGrants", "subtypeGrants", "damageShields", "battleDamageTransforms",
  "damagePreventionWindows", "destructionRestrictionWindows", "abilityGrants", "blockRestrictionGrants",
  "mustBlockGrants", "partyRestrictionGrants", "voidPlayGrants", "controlGrants"
] as const;

/** Lists whose records name their controller. */
const RECORDS_BY_CONTROLLER = ["areaModifiers", "runtimeReplacements", "scheduledEffects"] as const;

function checkEliminated(state: GameState, flow: GameFlowView): Check {
  const out = Object.values(state.players).filter(player => player.eliminated);
  if (out.length === 0) return undefined;
  const outIds = new Set(out.map(player => player.id));

  for (const card of Object.values(state.cards)) {
    if (outIds.has(card.ownerId) && card.zone !== "removed") {
      return fail("eliminated", `${card.ownerId} has lost but still owns ${card.id} in ${card.zone}`);
    }
    if (outIds.has(card.controllerId) && card.zone !== "removed") {
      return fail("eliminated", `${card.controllerId} has lost but still controls ${card.id} in ${card.zone} (owner ${card.ownerId})`);
    }
    if (card.heldBy !== undefined && outIds.has(card.heldBy) && (card.zone === "hand" || card.zone === "deck")) {
      return fail("eliminated", `${card.heldBy} has lost but still holds ${card.id} (owner ${card.ownerId}) in their ${card.zone}`);
    }
  }
  for (const player of out) {
    for (const zone of ARRAY_ZONES) {
      if (zone === "removed") continue;
      if (player[zone].length > 0) return fail("eliminated", `${player.id} has lost but ${zone} still lists ${player[zone].length} card(s)`);
    }
    if (state.pendingChoice?.playerId === player.id) return fail("eliminated", `${player.id} has lost but is still asked ${state.pendingChoice.kind}`);
  }
  for (const item of flow.responseStack) {
    if (outIds.has(item.controllerId)) return fail("eliminated", `${item.controllerId} has lost but still has the ${item.kind} ${item.sourceId} on the stack`);
  }
  for (const list of RECORDS_BY_CREATOR) {
    for (const record of state[list] as Array<{ createdBy?: PlayerId; previousControllerId?: PlayerId }>) {
      if (record.createdBy !== undefined && outIds.has(record.createdBy)) {
        return fail("eliminated", `${record.createdBy} has lost but a record in ${list} is still theirs`);
      }
    }
  }
  for (const list of RECORDS_BY_CONTROLLER) {
    for (const record of state[list] as Array<{ controllerId: PlayerId }>) {
      if (outIds.has(record.controllerId)) return fail("eliminated", `${record.controllerId} has lost but a record in ${list} is still theirs`);
    }
  }
  const window = state.responseWindow;
  if (window) {
    for (const id of [...window.pendingResponders, ...(window.passed ?? [])]) {
      if (outIds.has(id)) return fail("eliminated", `${id} has lost but is still listed in the response window`);
    }
  }
  return undefined;
}

// -----------------------------------------------------------------------------------------------------------------
// turn, winner, priority
// -----------------------------------------------------------------------------------------------------------------

interface TurnMemory {
  turn: number;
  activePlayerId: PlayerId;
  seatSwapped: boolean;
}

function checkTurn(state: GameState, before: TurnMemory | undefined): Check {
  const active = state.players[state.activePlayerId];
  if (!active) return fail("turn", `the active player ${state.activePlayerId} is not a player`);
  if (state.winner !== undefined) return undefined;
  if (active.eliminated) return fail("turn", `${active.id} has lost but it is their turn (turn ${state.turn})`);
  if (!before || before.turn === state.turn) return undefined;
  if (before.seatSwapped || state.seatSwap) return undefined;
  const seats = state.seats;
  const from = seats.indexOf(before.activePlayerId);
  if (from < 0) return fail("turn", `${before.activePlayerId} has no seat`);
  for (let step = 1; step <= seats.length; step++) {
    const candidate = seats[(from + step) % seats.length]!;
    if (state.players[candidate]!.eliminated) continue;
    if (candidate !== state.activePlayerId) {
      return fail("turn", `after ${before.activePlayerId}'s turn the turn passed to ${state.activePlayerId}, not to ${candidate} (the next seat still in the game)`);
    }
    return undefined;
  }
  return undefined;
}

function checkWinner(state: GameState): Check {
  const living = livePlayers(state);
  const winner = state.winner;
  if (winner === undefined) {
    if (living.length < 2) return fail("winner", `no winner, but ${living.length} player(s) are still in the game`);
    return undefined;
  }
  // The players whose loss ended the game are not marked eliminated (nobody is left to play on), but their faction is at 0.
  const standing = living.filter(player => player.influence > 0);
  if (winner === "draw") {
    return standing.length > 0 ? fail("winner", `a draw while ${standing.map(player => player.id).join(", ")} still have influence`) : undefined;
  }
  const player = state.players[winner];
  if (!player) return fail("winner", `the winner ${winner} is not a player`);
  if (player.eliminated) return fail("winner", `the winner ${winner} was eliminated`);
  if (player.influence <= 0) return fail("winner", `the winner ${winner} has ${player.influence} influence`);
  const others = standing.filter(other => other.id !== winner);
  if (others.length > 0) return fail("winner", `${winner} won while ${others.map(other => other.id).join(", ")} are still in the game`);
  return undefined;
}

function checkFlow(state: GameState, flow: GameFlowView): Check {
  if (flow.mode === "gameOver") {
    return state.winner === undefined ? fail("winner", "the flow is gameOver but there is no winner") : undefined;
  }
  if (state.winner !== undefined) return fail("winner", `the game has a winner (${state.winner}) but the flow is ${flow.mode}`);
  if (flow.actingPlayerId !== undefined && state.players[flow.actingPlayerId]?.eliminated) {
    return fail("priority", `the decision (${flow.mode}) is ${flow.actingPlayerId}'s, who has lost`);
  }
  const window = state.responseWindow;
  if (window && window.phase === "acceptingResponses") {
    const holder = window.priorityPlayerId;
    if (!state.players[holder]) return fail("priority", `priority is with ${holder}, who is not a player`);
    if (state.players[holder]!.eliminated) return fail("priority", `priority is with ${holder}, who has lost`);
    if (state.priorityPlayerId !== holder) return fail("priority", `state.priorityPlayerId ${state.priorityPlayerId} differs from the window's ${holder}`);
    const top = flow.responseStack[flow.responseStack.length - 1];
    if (top && top.controllerId === holder) return fail("priority", `priority is with ${holder}, who controls the top item ${top.sourceId}`);
    if (flow.mode === "response" && flow.actingPlayerId !== holder) {
      return fail("priority", `the response decision is ${flow.actingPlayerId}'s but priority is ${holder}'s`);
    }
  }
  return undefined;
}

// -----------------------------------------------------------------------------------------------------------------
// redaction
// -----------------------------------------------------------------------------------------------------------------

type Viewer = PlayerId | "spectator";

/**
 * Whether `card` must be hidden from `viewer`, written from the rules (RULES.md §15 "Views, saves and the log"): a hand
 * is its holder's alone (unless a card reveals it), a deck nobody's (unless a card reveals its top), a face-down card in
 * play or the discard pile its controller's, a face-down card in the void or removed zone whoever may look at it.
 */
function mustHide(state: GameState, engine: SpoilsEngine, flow: GameFlowView, card: CardInstance, viewer: Viewer): boolean {
  const holder = card.heldBy ?? card.ownerId;
  if (card.zone === "hand") return holder !== viewer && !flow.revealed.hands.includes(holder);
  if (card.zone === "deck") return !flow.revealed.deckTop.some(entry => entry.playerId === holder && entry.cardId === card.id);
  if (!card.faceDown) return false;
  if (card.zone === "void" || card.zone === "removed") return viewer === "spectator" ? true : !engine.canViewerSeeVoidedCard(viewer, card.id);
  return card.controllerId !== viewer;
}

const wordPattern = (name: string): RegExp => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const catalogNames = [...new Set(CATALOG.map(card => card.name))];
const longerNames = new Map<string, RegExp | null>();

/** `message` with every catalog name that contains `name` and is longer than it taken out. */
function withoutLongerNames(name: string, message: string): string {
  let pattern = longerNames.get(name);
  if (pattern === undefined) {
    const lower = name.toLowerCase();
    const longer = catalogNames.filter(other => other.length > name.length && other.toLowerCase().includes(lower));
    pattern = longer.length === 0 ? null : new RegExp(longer.sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "giu");
    longerNames.set(name, pattern);
  }
  return pattern ? message.replace(pattern, " ") : message;
}

/** What each viewer has seen, over the game: the names of the cards they have been shown, and how much of the log was checked. */
interface ViewerMemory {
  names: Set<string>;
  logChecked: number;
  /** Names of the cards hidden from the viewer, and shown to them nowhere, at the previous check. */
  hiddenBefore: Set<string>;
}

function checkRedaction(
  engine: SpoilsEngine,
  flow: GameFlowView,
  memory: Map<Viewer, ViewerMemory>,
  searchText: boolean
): Check {
  const state = engine.state;
  const viewers: Viewer[] = [...state.seats, "spectator"];
  let spectatorCards: Record<CardInstanceId, CardInstance> | undefined;
  for (const viewer of viewers.slice().reverse()) {
    const view = redactStateFor(state, viewer, {
      revealed: flow.revealed,
      canSeeVoided: cardId => (viewer === "spectator" ? false : engine.canViewerSeeVoidedCard(viewer, cardId))
    });
    if (viewer === "spectator") spectatorCards = view.cards;

    const known = memory.get(viewer) ?? { names: new Set<string>(), logChecked: 0, hiddenBefore: new Set<string>() };
    memory.set(viewer, known);
    const shownDefinitions = new Set<string>();
    const hiddenDefinitions = new Set<string>();

    for (const card of Object.values(state.cards)) {
      const seen = view.cards[card.id];
      if (!seen) return fail("redaction", `${viewer}'s view lacks card ${card.id}`);
      const hide = mustHide(state, engine, flow, card, viewer);
      if (seen.definitionId === HIDDEN_DEFINITION_ID) {
        if (!hide && card.zone !== "void" && card.zone !== "removed") {
          return fail("redaction", `${viewer}'s view hides ${card.id} (${card.zone}, owner ${card.ownerId}), which is public to them`);
        }
        for (const field of ["namedValues", "linkedTargets", "rememberedPlayers", "createdAbility"] as const) {
          if (seen[field] !== undefined) return fail("redaction", `${viewer}'s view of hidden ${card.id} still carries ${field}`);
        }
        if (!hide) continue;
        hiddenDefinitions.add(card.definitionId);
      } else {
        if (hide) return fail("redaction", `${viewer}'s view shows ${card.id} (${card.zone}, owner ${card.ownerId}) as ${card.definitionId}`);
        shownDefinitions.add(seen.definitionId);
        known.names.add(engine.definitions[seen.definitionId]?.name.toLowerCase() ?? "");
        if (card.ownerId === viewer) known.names.add(engine.definitions[card.definitionId]?.name.toLowerCase() ?? "");
      }
    }
    // Everyone knows what is in their own deck list.
    for (const card of Object.values(state.cards)) {
      if (card.ownerId === viewer) known.names.add(engine.definitions[card.definitionId]?.name.toLowerCase() ?? "");
    }

    if (viewer !== "spectator" && state.players[viewer]!.eliminated && spectatorCards) {
      // A player who has lost sees what a spectator sees (RULES.md §15).
      for (const card of Object.values(state.cards)) {
        if (view.cards[card.id]!.definitionId !== spectatorCards[card.id]!.definitionId) {
          return fail("redaction", `${viewer} has lost but sees ${card.id} differently from a spectator`);
        }
      }
      if (flow.revealed.hands.includes(viewer) || flow.revealed.deckTop.some(entry => entry.playerId === viewer)) {
        return fail("redaction", `${viewer} has lost but getFlowView().revealed still lists them`);
      }
    }

    // The deciding player's prompt is theirs alone.
    const flowView = redactFlowViewFor(flow, viewer);
    if (flowView.pendingChoice && flowView.pendingChoice.playerId !== viewer) {
      const keys = Object.keys(flowView.pendingChoice).sort().join(",");
      if (keys !== "id,kind,playerId") return fail("redaction", `${viewer} is sent the details of ${flowView.pendingChoice.playerId}'s ${flowView.pendingChoice.kind} prompt (${keys})`);
    }
    if (view.pendingChoice && view.pendingChoice.playerId !== viewer && Object.keys(view.pendingChoice).sort().join(",") !== "id,kind,playerId") {
      return fail("redaction", `${viewer}'s state carries the details of ${view.pendingChoice.playerId}'s prompt`);
    }
    if (view.rngState !== 0) return fail("redaction", `${viewer}'s state carries the rng state`);

    if (!searchText) {
      known.logChecked = view.gameLog.length;
      continue;
    }
    // Text: no hidden card's definition id anywhere in the view, and its name in no log line, unless the viewer has
    // been shown a card with that definition / name.
    const text = JSON.stringify(view) + JSON.stringify(flowView);
    for (const definitionId of hiddenDefinitions) {
      if (shownDefinitions.has(definitionId)) continue;
      if (text.includes(JSON.stringify(definitionId))) {
        return fail("redaction", `${viewer}'s view names the definition ${definitionId} of a card hidden from them`);
      }
    }
    // A line may name a card that was public while the line was written (a trigger of a card in the discard pile
    // that then went to the deck) or that the line itself reveals: only a name hidden from the viewer before and after
    // the action, never shown to them, that no reveal in these lines shows them counts.
    const hiddenNames = new Set<string>();
    const newLines = state.gameLog.slice(known.logChecked);
    const revealed = new Set<string>();
    for (const line of newLines) {
      const event = line.event;
      if (event?.type !== "cardsRevealed" || (event.viewerId !== "all" && event.viewerId !== viewer)) continue;
      for (const id of event.cardIds) {
        const definitionId = state.cards[id]?.definitionId;
        const name = definitionId === undefined ? undefined : engine.definitions[definitionId]?.name;
        if (name) revealed.add(name.toLowerCase());
      }
    }
    for (const definitionId of hiddenDefinitions) {
      if (shownDefinitions.has(definitionId)) continue;
      const name = engine.definitions[definitionId]?.name;
      if (!name) continue;
      const lower = name.toLowerCase();
      hiddenNames.add(lower);
      if (name.length < 4 || known.names.has(lower) || revealed.has(lower) || !known.hiddenBefore.has(lower)) continue;
      for (const offset of newLines.keys()) {
        // "Greed" inside "Crest of Greed" is the other card's name.
        const message = withoutLongerNames(name, view.gameLog[known.logChecked + offset]!.message);
        if (wordPattern(name).test(message)) {
          return fail("redaction", `${viewer}'s log line ${known.logChecked + offset} names "${name}", a card hidden from them: ${message}`);
        }
      }
    }
    known.hiddenBefore = hiddenNames;
    known.logChecked = view.gameLog.length;
  }
  return undefined;
}

// -----------------------------------------------------------------------------------------------------------------
// save and load
// -----------------------------------------------------------------------------------------------------------------

const fullDigest = (state: GameState): string => canonicalJson(state);

/** The state a server restoring the game from `save` would hold. */
function reload(engine: SpoilsEngine): SpoilsEngine {
  const save = JSON.parse(JSON.stringify(saveGame(engine)));
  return loadGame(save, CATALOG, undefined, CARD_NAME_CATALOG);
}

function sameState(a: SpoilsEngine, b: SpoilsEngine): Check {
  if (digestState(a.state) !== digestState(b.state)) return fail("saveLoad", "the digests differ");
  if (fullDigest(a.state) !== fullDigest(b.state)) return fail("saveLoad", "the digests agree but the whole states differ (multiplayer bookkeeping)");
  return undefined;
}

// -----------------------------------------------------------------------------------------------------------------
// Whole games
// -----------------------------------------------------------------------------------------------------------------

class Stop extends Error {
  constructor(readonly violation: Violation) {
    super(violation.message);
  }
}

export function fuzzGame(seats: number, seed: number, options: FuzzOptions = {}): FuzzResult {
  const saveEvery = options.saveEvery ?? 11;
  const followActions = options.followActions ?? 6;
  const redactEvery = options.redactEvery ?? 1;
  const textEvery = options.textEvery ?? 7;
  const setup = randomSetup(seed, { seats });

  const memory = new Map<Viewer, ViewerMemory>();
  let turnMemory: TurnMemory | undefined;
  let shadow: SpoilsEngine | undefined;
  let following = 0;
  let violation: (Violation & { step: number; action?: GameAction }) | undefined;
  let performed = 0;
  let eliminations = 0;

  const check = (engine: SpoilsEngine, step: number, action: GameAction | undefined): void => {
    const state = engine.state;
    const flow = engine.getFlowView();
    eliminations = Math.max(eliminations, Object.values(state.players).filter(player => player.eliminated).length);
    const found =
      checkZones(state) ??
      checkEliminated(state, flow) ??
      checkTurn(state, turnMemory) ??
      checkWinner(state) ??
      checkFlow(state, flow) ??
      (redactEvery > 0 && step % redactEvery === 0 ? checkRedaction(engine, flow, memory, textEvery > 0 && step % textEvery === 0) : undefined);
    turnMemory = { turn: state.turn, activePlayerId: state.activePlayerId, seatSwapped: state.seatSwap !== undefined };
    if (found) throw new Stop(found);

    if (shadow && following > 0) {
      shadow.perform(JSON.parse(JSON.stringify(action)) as GameAction);
      following--;
      const different = sameState(engine, shadow);
      if (different) throw new Stop({ invariant: "saveLoad", message: `${different.message} ${followActions - following} action(s) after loading a save` });
    }
    if (saveEvery > 0 && step % saveEvery === 0) {
      shadow = reload(engine);
      following = followActions;
      const different = sameState(engine, shadow);
      if (different) throw new Stop({ invariant: "saveLoad", message: `${different.message} straight after loading a save` });
    }
  };

  const result = playRandomGame(setup, fuzzDriverSeed(seed), {
    maxActions: options.maxActions ?? 1500,
    onAction(engine, action, step) {
      performed = step + 1;
      try {
        check(engine, step, action);
      } catch (error) {
        if (error instanceof Stop) {
          violation = { ...error.violation, step, action };
          throw error;
        }
        // A throw from a save, a load or the loaded copy's `perform` is itself a saveLoad violation.
        violation = { invariant: "saveLoad", message: `threw: ${error instanceof Error ? error.message : String(error)}`, step, action };
        throw error;
      }
    }
  });

  const base = { seats, seed, actions: performed, turns: result.turns, eliminations, ...(result.winner !== undefined ? { winner: result.winner } : {}) };
  if (violation) return { ...base, status: "violation", violation };
  if (result.status === "finding") return { ...base, status: "finding", ...(result.finding ? { finding: result.finding } : {}) };
  return { ...base, status: result.status };
}
