// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------

import type {
  AbilityId,
  BattleId,
  CardDefinitionId,
  CardInstanceId,
  Duration,
  Keyword,
  ModifierId,
  ModifierOperation,
  PlayerId,
  Restriction,
  Stat,
  Zone
} from "./ids.js";
import type { ResolutionContext, StackItem } from "./resolution.js";
import type { PendingChoice } from "./choices.js";
import type { Cost } from "./costs.js";
import type { Effect } from "./effects.js";

export interface CardInstance {
  id: CardInstanceId;
  definitionId: CardDefinitionId;

  ownerId: PlayerId;
  controllerId: PlayerId;

  zone: Zone;

  depleted: boolean;
  damage: number;

  /** Face-down cards in play are resources and provide Volition. */
  faceDown: boolean;

  /** Numeric costs attach resources to the player's faction. */
  attachedTo?: CardInstanceId;

  /**
   * When true, this card is skipped by its controller's faction turn-start
   * restore rule ("...cannot be restored by their faction's restore rule").
   * Cleared automatically when the card leaves play, like `depleted`.
   */
  restoreLocked?: boolean;

  /**
   * String values this card has named ("name a card subtype") — see the
   * `nameValue` effect and `CardSelector.subtypeVar`. Cleared on leaving play.
   */
  namedValues?: Record<string, string>;

  /** True for a token permanent (`createTokens`) — ceases to exist on leaving play. */
  isToken?: boolean;

  /**
   * The turn number on which this card started the turn in play under its
   * current controller. AGGRO ignores this restriction.
   */
  attackEligibleTurn?: number;

  counters: Record<string, number>;
}

export interface PlayerState {
  id: PlayerId;
  name: string;

  /** Runtime instance of this player's faction card. */
  factionId?: CardInstanceId;

  /** Current score. Initial value comes from faction.startingInfluence. */
  influence: number;

  deck: CardInstanceId[];
  hand: CardInstanceId[];
  play: CardInstanceId[];
  discard: CardInstanceId[];
  void: CardInstanceId[];
  /** "Removed from the game" (RULES.md §2). Owner-tracked, like discard/void. */
  removed: CardInstanceId[];
}

export interface RuntimeModifier {
  id: ModifierId;

  sourceId?: CardInstanceId;
  sourceAbilityId?: AbilityId;

  targetId: CardInstanceId;
  stat: Stat;
  operation: ModifierOperation;
  value: number;

  duration: Duration;
  createdTurn: number;
}

/** A temporary keyword grant from a `grantKeyword` effect (e.g. "this turn, the character gains COVERT"). */
export interface RuntimeKeywordGrant {
  id: ModifierId;

  sourceId?: CardInstanceId;

  targetId: CardInstanceId;
  keyword: Keyword;

  duration: Duration;
  createdTurn: number;
}

/** A temporary restriction grant from a `grantRestriction` effect (e.g. "this turn, the character cannot attack"). */
export interface RuntimeRestriction {
  id: ModifierId;

  sourceId?: CardInstanceId;

  targetId: CardInstanceId;
  restriction: Restriction;

  duration: Duration;
  createdTurn: number;
}

/** A pending "reduce the next numeric cost you pay this turn" from a `reduceNextCost` effect, consumed by one `playCard`. */
export interface RuntimeCostReduction {
  id: ModifierId;

  playerId: PlayerId;
  amount: number;

  createdTurn: number;
}

/**
 * A suspended point in an effects list — pushed when a "chooser" effect
 * (`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
 * `deployForFree`) needs a specific player's input mid-resolution.
 * `SpoilsEngine.runEffectFrame` resumes from `index` once that choice is
 * answered. `finishStackItem`, if set, is the response-stack item whose
 * post-effects bookkeeping (moving a tactic to discard, a permanent into
 * play) runs once every effect in `effects` — including anything a paused
 * chooser effect goes on to add — has finished. `finishFlipUp` plays the
 * same role for a FLIP UP resolution (which isn't a stack item): move a
 * flipped tactic to discard / send a flipped permanent into play, after
 * every effect — rider + own — has resolved.
 */
export interface PendingEffectFrame {
  effects: Effect[];
  index: number;
  context: ResolutionContext;
  finishStackItem?: StackItem;
  finishFlipUp?: { cardId: CardInstanceId; attachTargetId?: CardInstanceId };
}

export interface BattleDamageAssignment {
  sourceId: CardInstanceId;
  target:
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId };
  amount: number;
}

export type BattlePhase =
  | "afterAttackersResponse"
  | "blocking"
  | "beforeDamageResponse"
  | "attackerDamageAssignment"
  | "defenderDamageAssignment"
  | "afterDamageResponse"
  | "finished";

export interface BattleState {
  id: BattleId;
  attackerPlayerId: PlayerId;
  defenderPlayerId: PlayerId;

  target:
    | { type: "faction"; playerId: PlayerId }
    | { type: "card"; cardId: CardInstanceId };

  attackingParty: CardInstanceId[];
  blockingParty: CardInstanceId[];

  phase: BattlePhase;

  /** Current speed group. Undefined between groups. */
  speed?: number;

  /** Characters that have already assigned battle damage this battle. */
  assignedDamageBy: CardInstanceId[];

  /** Locked assignments for the current speed group. */
  attackerAssignments: BattleDamageAssignment[];
  defenderAssignments: BattleDamageAssignment[];
}

export interface BattleView {
  battleId: BattleId;
  phase: BattlePhase;
  speed?: number;

  attackerPlayerId: PlayerId;
  defenderPlayerId: PlayerId;

  attackingParty: CardInstanceId[];
  blockingParty: CardInstanceId[];

  actingPlayerId?: PlayerId;

  damageSources: Array<{
    cardId: CardInstanceId;
    strength: number;
    legalTargets: Array<
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId }
    >;
  }>;

  lockedAssignments: BattleDamageAssignment[];
}

export type ResponseWindowKind =
  | "action"
  | "endTurn"
  | "battleAfterAttackers"
  | "battleBeforeDamage"
  | "battleAfterDamage";

export type ResponseContinuation =
  | { type: "main" }
  | { type: "endTurn"; playerId: PlayerId }
  | { type: "battleBlocking"; battleId: BattleId }
  | { type: "battleAssignDamage"; battleId: BattleId }
  | { type: "battleInflictDamage"; battleId: BattleId };

export interface ResponseWindowState {
  id: string;
  kind: ResponseWindowKind;

  /**
   * acceptingResponses:
   *   players may deploy tactics / TACTICAL cards and use abilities.
   *
   * resolving:
   *   no new responses may be added. advanceFlow() resolves one stack item
   *   per call until the stack is empty, then resumes the interrupted flow.
   */
  phase: "acceptingResponses" | "resolving";

  firstPlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  consecutivePasses: number;

  continuation: ResponseContinuation;
}

export type GameSetupState =
  | {
      phase: "mulligan";
      order: PlayerId[];
      currentIndex: number;
    }
  | { phase: "complete" };

/** The player who won, or "draw" if both factions hit 0 influence together. */
export type GameWinner = PlayerId | "draw";

/**
 * Whether a hand card could be deployed right now, broken down by which gate it's failing —
 * deliberately public (see `SpoilsEngine.getCardPlayability`/`getPlayableHandCards`) so a UI
 * doesn't have to reimplement the engine's own private timing/threshold/cost checks just to
 * grey out or explain unplayable cards. Doesn't account for a card's *targets* or extra costs
 * (deplete/discard/destroy/depleteSelected) — those depend on selections the player hasn't made
 * yet, so they're still only validated for real once `perform()` runs.
 */
export interface CardPlayability {
  /** True only when every other field here is true/satisfied. */
  playable: boolean;
  /** False if it's simply not a legal moment to deploy anything (wrong phase/priority), or — in a response window — this particular card isn't a tactic or TACTICAL. */
  legalTiming: boolean;
  /** False if the card's printed threshold isn't currently met. */
  thresholdMet: boolean;
  /** The card's printed numeric cost, after any pending "reduce next cost" effect. */
  numericCost: number;
  /** Currently unattached resources available to pay with. */
  availableResources: number;
}

export interface GameFlowView {
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  mode:
    | "setup"
    | "main"
    | "response"
    | "resolvingResponses"
    | "battleChoice"
    | "battleFinished"
    | "pendingChoice"
    | "gameOver";

  /**
   * Whether the active player has yet to exercise their faction's Develop
   * Rule this turn (CR §202.8) — a UI hint only. The develop rule is an
   * optional once-per-turn action (`chooseDevelop`), not a phase, so this
   * never blocks anything.
   */
  developAvailable: boolean;
  setup: GameSetupState;

  responseWindow?: ResponseWindowState;
  responseStack: StackItem[];
  battle?: BattleView;
  winner?: GameWinner;
  pendingChoice?: PendingChoice;
}

export interface GameState {
  turn: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  setup: GameSetupState;
  started: boolean;

  /**
   * Set once the active player has used their faction's Develop Rule
   * (CR §202.8) this turn — the develop rule is an optional, once-per-turn
   * action (`chooseDevelop`) usable any time during the active player's
   * turn, not a phase. Reset to `false` at the start of every turn.
   */
  developedThisTurn: boolean;

  /**
   * Current position in the game's single deterministic RNG stream (deck
   * shuffles, coin flips, `{type:"random"}` expressions/targets). Part of
   * `GameState` — not engine-internal — so it travels with everything else
   * through save/replay/structuredClone/JSON: resuming a saved game
   * continues its random sequence exactly where it left off, and replaying
   * a fresh game from the same starting seed reproduces it bit-for-bit.
   */
  rngState: number;

  players: Record<PlayerId, PlayerState>;
  cards: Record<CardInstanceId, CardInstance>;

  modifiers: RuntimeModifier[];
  keywordGrants: RuntimeKeywordGrant[];
  restrictions: RuntimeRestriction[];
  costReductions: RuntimeCostReduction[];

  /** Fully serializable response/stack state for UI, replay, or networking. */
  responseStack: StackItem[];
  responseWindow?: ResponseWindowState;

  /** Suspended effect-list resumption points — see PendingEffectFrame. Only the top of the stack is "live." */
  pendingEffectFrames: PendingEffectFrame[];

  battle?: BattleState;

  /** Set once a player's faction reaches 0 influence (or both do, for a draw). */
  winner?: GameWinner;

  /** Blocks perform() except resolvePendingChoice until a player answers it. */
  pendingChoice?: PendingChoice;

  /**
   * The continuation for an outstanding optional replacement (paired with a
   * `pendingChoice` of kind `"replacementChoice"`) — what to do on accept
   * (pay `cost`, run `effects`) vs decline (perform `original`).
   */
  pendingReplacement?: {
    affectedCardId: CardInstanceId;
    sourceId: CardInstanceId;
    abilityId: AbilityId;
    original: { event: "destroy" } | { event: "moveToZone"; zone: Zone };
    cost: Cost[];
    effects: Effect[];
  };

  /**
   * Per-turn count of emitted events, keyed `"<eventType>"` or
   * `"<eventType>:<playerId>"` when the event carries a `playerId`. Reset at
   * the start of every turn. Read by the `eventOrdinal` condition for "the
   * first resource each player plays each turn" style triggers.
   */
  turnEventTally: Record<string, number>;

  /**
   * Per-turn list of card *names* each player has deployed (via `playCard`),
   * in order. Reset at the start of every turn. Read by the
   * `deploySameNameThisTurn` condition ("an opponent deployed at least 2
   * cards with the same name this turn").
   */
  turnDeploys: Record<PlayerId, string[]>;

  /**
   * Cards each player set aside to the bottom of their deck during the
   * *opening* mulligan (absent / empty if they kept their hand or had no
   * mulligan). Written once, in `mulligan()`; never mutated afterward. Read
   * by the `bottomedInMulligan` condition — a card whose text keys off "if
   * you ... chose to put this card on the bottom of your deck as part of
   * your mulligan" (Community Chest).
   */
  mulligan: Record<PlayerId, CardInstanceId[]>;
}
