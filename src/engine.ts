/* engine.ts
 *
 * Barebones, interface-first, data-driven rules engine for The Spoils.
 *
 * Goals:
 * - Card behavior is JSON-serializable.
 * - Cards never execute arbitrary callbacks.
 * - The engine owns mutation.
 * - Abilities are built from reusable costs, conditions, selectors, expressions, and effects.
 * - Triggered abilities react to engine events.
 * - Continuous abilities generate derived modifiers.
 * - Activated abilities and deployed cards can live on a response stack.
 *
 * This is intentionally UI-free. A UI can inspect GameState and submit GameAction objects.
 *
 * This file re-exports the engine's public surface. Implementation lives in
 * ./types (data model) and ./engine (rules engine + setup helpers).
 */

export * from "./types/index.js";

export { parseThreshold, TOURNAMENT_FACTION_DEFAULTS, TOURNAMENT_FACTION_BEHAVIOR } from "./engine/utilities.js";
export { randomSeed } from "./engine/rng.js";
export { SpoilsEngine } from "./engine/SpoilsEngine.js";
export { createCardInstance, createTwoPlayerGame } from "./engine/setup.js";
export {
  createTwoPlayerFactionGame,
  type FactionPlayerSetup,
  type FactionGameSetupOptions
} from "./engine/factionSetup.js";
export {
  saveGame,
  loadGame,
  getSaveSummary,
  type GameSaveSummary
} from "./engine/persistence.js";
