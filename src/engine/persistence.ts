// -----------------------------------------------------------------------------
// Save / load
// -----------------------------------------------------------------------------
//
// Pairs with the engine/data split (see CLAUDE.md): a save is just
// `SpoilsEngine.state` plus a format tag, never the card catalog it was
// played with. Round trip:
//
//   const save = saveGame(engine);              // -> write save to a DB/file
//   const restored = loadGame(save, CARD_CATALOG); // <- read it back later
//
// `getSaveSummary` is a separate, much smaller extract meant to sit in
// indexed database columns alongside the (opaque, JSON-blob) save, so a
// caller can list/filter in-progress games without deserializing every one.

import type {
  CardCatalogEntry,
  CardDefinition,
  CardDefinitionId,
  GameFlowView,
  GameResult,
  GameState,
  PlayerId,
  SerializedGame
} from "../types/index.js";
import { CURRENT_SAVE_FORMAT_VERSION } from "../types/index.js";
import { SpoilsEngine } from "./SpoilsEngine.js";
import { assert } from "./utilities.js";

/**
 * The complete, JSON-serializable save for `engine`'s current state —
 * mid-resolution state included (an open response stack, a pending choice,
 * a battle in progress). Write the result straight to a database/file: it
 * is already plain data, so `JSON.stringify(saveGame(engine))` round-trips
 * losslessly. Pairs with `loadGame` and `getSaveSummary`.
 */
export function saveGame(engine: SpoilsEngine): SerializedGame {
  const runtimeDefinitions = collectRuntimeDefinitions(engine);
  const state = structuredClone(engine.state);
  const sharedObjects = sharedObjectsOf(state);

  return {
    formatVersion: CURRENT_SAVE_FORMAT_VERSION,
    state,
    ...(runtimeDefinitions.length ? { runtimeDefinitions: structuredClone(runtimeDefinitions) } : {}),
    ...(sharedObjects.length ? { sharedObjects } : {})
  };
}

/**
 * Every place in `state` that holds an object already reached at an earlier place, paired with that place
 * (`SerializedGame.sharedObjects`). Walked depth-first in key order, so the earlier place and every place above
 * either one hold objects of their own: both paths stay valid once JSON has made separate copies.
 */
function sharedObjectsOf(state: GameState): Array<[string[], string[]]> {
  const firstSeen = new Map<object, string[]>();
  const shared: Array<[string[], string[]]> = [];
  const walk = (value: unknown, path: string[]): void => {
    if (value === null || typeof value !== "object") return;
    const seen = firstSeen.get(value);
    if (seen) {
      shared.push([path, seen]);
      return;
    }
    firstSeen.set(value, path);
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
  };
  walk(state, []);
  return shared;
}

/** Links up again the places `sharedObjects` says held one object (see `SerializedGame.sharedObjects`). */
function relinkSharedObjects(state: GameState, sharedObjects: Array<[string[], string[]]>): void {
  const at = (path: string[]): unknown =>
    path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], state);
  for (const [path, original] of sharedObjects) {
    const parent = at(path.slice(0, -1)) as Record<string, unknown> | undefined;
    const target = at(original);
    assert(parent !== undefined && target !== undefined, `The save's shared object at '${path.join(".")}' is missing.`);
    parent[path[path.length - 1]] = target;
  }
}

/**
 * Definitions in `engine.definitions` that exist only because a token
 * permanent (`createTokens`) synthesized them at runtime — every card
 * currently on the board with `isToken: true` (a token vanishes entirely on
 * leaving play, so this is exactly the set still needed to reconstruct the
 * board; see `CardInstance.isToken`) and every token that has left play, deduped by `definitionId`.
 */
function collectRuntimeDefinitions(engine: SpoilsEngine): CardDefinition[] {
  const seen = new Set<CardDefinitionId>();
  const result: CardDefinition[] = [];

  // The tokens that have left play too: what they were is still read (`EngineBookkeeping.departedTokens`).
  const tokens = [...Object.values(engine.state.cards), ...Object.values(engine.state.bookkeeping.departedTokens)];
  for (const card of tokens) {
    if (!card.isToken || seen.has(card.definitionId)) continue;
    seen.add(card.definitionId);
    const definition = engine.definitions[card.definitionId];
    if (definition) result.push(definition);
  }

  return result;
}

/**
 * Rebuilds a `SpoilsEngine` from a `saveGame` result. `definitions` is the
 * card catalog the game was played with — saves never embed card data, so
 * the caller supplies it fresh each time (typically `CARD_CATALOG` from this
 * package's `./data` export, or a synthetic test catalog). `random`, as with
 * `new SpoilsEngine(...)`, overrides the RNG stream for tests; omit it in
 * production so the resumed game continues its own seeded stream.
 *
 * Throws if `save.formatVersion` is newer than this engine understands, or
 * if `state` references a card definition missing from `definitions` (the
 * caller passed the wrong catalog, or an out-of-date one).
 */
export function loadGame(
  save: SerializedGame,
  definitions: CardDefinition[],
  random?: () => number,
  cardCatalog?: readonly CardCatalogEntry[]
): SpoilsEngine {
  const state = migrate(save);
  if (save.sharedObjects) relinkSharedObjects(state, save.sharedObjects);
  const fullDefinitions = [...definitions, ...(save.runtimeDefinitions ?? [])];
  assertDefinitionsCoverState(state, fullDefinitions);
  return new SpoilsEngine(fullDefinitions, state, random, cardCatalog);
}

function migrate(save: SerializedGame): GameState {
  assert(
    save.formatVersion <= CURRENT_SAVE_FORMAT_VERSION,
    `Save format version ${save.formatVersion} is newer than this engine supports ` +
      `(${CURRENT_SAVE_FORMAT_VERSION}). Load it with a newer version of this package.`
  );

  // Migrations chain here, each rewriting `state` from one format version to
  // the next, so `loadGame` always hands `SpoilsEngine` a current-shape state.
  let state = save.state;
  if (save.formatVersion < 2) state = migrateV1ToV2(state);
  return state;
}

/**
 * Format 2 replaced `GameState.winner` (a player id or `"draw"`) with
 * `GameState.result` (a `GameResult`). Every format-1 save is a two-player
 * game, so the table format and seating come from the constructor defaults.
 */
function migrateV1ToV2(state: GameState): GameState {
  const { winner, ...rest } = state as GameState & { winner?: string };
  if (winner === undefined) return rest as GameState;
  const result: GameResult = winner === "draw" ? { outcome: "draw", winners: [] } : { outcome: "victory", winners: [winner] };
  return { ...(rest as GameState), result };
}

function assertDefinitionsCoverState(state: GameState, definitions: CardDefinition[]): void {
  const known = new Set(definitions.map(def => def.id));
  const missing = new Set<CardDefinitionId>();

  for (const card of Object.values(state.cards)) {
    if (!known.has(card.definitionId)) missing.add(card.definitionId);
  }

  assert(
    missing.size === 0,
    `Save references card definitions not present in the supplied catalog: ` +
      `${[...missing].join(", ")}. Pass the full catalog this game was played with.`
  );
}

/** Small, JSON-serializable metadata about one game, for indexing/listing without deserializing a full save. */
export interface GameSaveSummary {
  turn: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  mode: GameFlowView["mode"];
  result?: GameResult;
  players: Array<{ id: PlayerId; name: string; influence: number }>;
}

/**
 * A small, JSON-serializable extract of `engine`'s current state — turn
 * number, whose priority it is, the flow `mode`, the result (once decided),
 * and each player's name/influence. Meant to live in indexed database
 * columns alongside the opaque `saveGame` blob (e.g. "list this player's
 * in-progress games", "find games awaiting a response from player X")
 * without deserializing every save just to read them.
 */
export function getSaveSummary(engine: SpoilsEngine): GameSaveSummary {
  const flow = engine.getFlowView();

  return {
    turn: engine.state.turn,
    activePlayerId: flow.activePlayerId,
    priorityPlayerId: flow.priorityPlayerId,
    mode: flow.mode,
    result: flow.result,
    players: Object.values(engine.state.players).map(player => ({
      id: player.id,
      name: player.name,
      influence: player.influence
    }))
  };
}
