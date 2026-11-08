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
  GameState,
  GameWinner,
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

  return {
    formatVersion: CURRENT_SAVE_FORMAT_VERSION,
    state: structuredClone(engine.state),
    ...(runtimeDefinitions.length ? { runtimeDefinitions: structuredClone(runtimeDefinitions) } : {})
  };
}

/**
 * Definitions in `engine.definitions` that exist only because a token
 * permanent (`createTokens`) synthesized them at runtime — every card
 * currently on the board with `isToken: true` (a token vanishes entirely on
 * leaving play, so this is exactly the set still needed to reconstruct the
 * board; see `CardInstance.isToken`), deduped by `definitionId`.
 */
function collectRuntimeDefinitions(engine: SpoilsEngine): CardDefinition[] {
  const seen = new Set<CardDefinitionId>();
  const result: CardDefinition[] = [];

  for (const card of Object.values(engine.state.cards)) {
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

  // Format 1 is the initial format — nothing to migrate yet. Future
  // migrations chain here, each rewriting `state` from one format version to
  // the next, so `loadGame` always hands `SpoilsEngine` a current-shape state.
  return save.state;
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
  winner?: GameWinner;
  /** Every player, in the order the game was set up; `eliminated` is set (and true) only for a player who has lost and is out of the game. */
  players: Array<{ id: PlayerId; name: string; influence: number; eliminated?: true }>;
}

/**
 * A small, JSON-serializable extract of `engine`'s current state — turn
 * number, whose priority it is, the flow `mode`, the winner (once decided),
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
    winner: flow.winner,
    players: Object.values(engine.state.players).map(player => ({
      id: player.id,
      name: player.name,
      influence: player.influence,
      ...(player.eliminated ? { eliminated: true as const } : {})
    }))
  };
}
