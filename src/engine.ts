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

export {
  parseThreshold,
  TOURNAMENT_FACTION_DEFAULTS,
  TOURNAMENT_FACTION_BEHAVIOR,
  isStapleResourceDefinition,
  withBuiltInFactionDefaults,
  declinedKey
} from "./engine/utilities.js";
export {
  answerPlayRequirement,
  type DeclarationRequirement,
  type PickStep,
  type PlayAction,
  type PlayAnswer,
  type PlayRequirement,
  type SelectionCheck,
  type SelectionRequirementsInput
} from "./engine/playRequirements.js";
export { randomSeed } from "./engine/rng.js";
export {
  SpoilsEngine,
  ATTACH_TARGET_ID,
  RESTORE_RULE_ABILITY_ID,
  DEVELOP_RULE_ABILITY_ID,
  FACTION_START_EFFECT_ABILITY_ID,
  FACTION_END_EFFECT_ABILITY_ID,
  type PaymentOptions
} from "./engine/SpoilsEngine.js";
export {
  buildCreatedAbility,
  validateCreatedAbilitySpec,
  CREATED_ABILITY_MENU,
  CREATED_ABILITY_ID
} from "./engine/createdAbility.js";
export {
  createCardInstance,
  createGame,
  resolveGameFormat,
  type GamePlayerSeat,
  type CreateGameOptions
} from "./engine/setup.js";
export {
  isLiving,
  seatsFrom,
  livingSeats,
  livingSeatsFrom,
  otherLivingSeats,
  nextLivingSeat,
  opponentsOf,
  isOpponentOf
} from "./engine/seating.js";
export {
  villainOf,
  isVillain,
  isHero,
  heroesOf,
  getLoyalty,
  isAllegianceRevealed,
  canSeeAllegiance,
  defaultAllegianceDeck
} from "./engine/showdown.js";
export {
  createFactionGame,
  findFactionDeckIssues,
  type FactionPlayerSetup,
  type FactionGameSetupOptions
} from "./engine/factionSetup.js";
export {
  findDeckConstructionIssues,
  getMaxCopies,
  getMinimumDeckSize,
  isEpicCard,
  deckFactionFace,
  resolveDeckCards,
  DEFAULT_MAX_COPIES,
  EPIC_MAX_COPIES,
  type DeckConstructionIssue,
  type DeckConstructionIssueKind,
  type DeckConstructionOptions
} from "./engine/deckRules.js";
export {
  saveGame,
  loadGame,
  getSaveSummary,
  type GameSaveSummary
} from "./engine/persistence.js";
export {
  redactStateFor,
  redactFlowViewFor,
  redactLogFor,
  isCardHiddenFrom,
  HIDDEN_DEFINITION_ID,
  type Viewer,
  type RedactStateOptions,
  type RedactLogOptions
} from "./engine/redaction.js";
