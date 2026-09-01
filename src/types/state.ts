// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------

import type {
  AbilityId,
  BattleId,
  CardDefinitionId,
  CardInstanceId,
  CardType,
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
import type { AbilityDefinition } from "./cards.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { Effect } from "./effects.js";
import type { NumberExpression } from "./expressions.js";

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
   * One-shot: this card is skipped by its controller's *next* faction
   * turn-start restore, then the flag clears — "that character does not
   * restore during its controller's next RESTORE RULE" (Numba 1 Stunna!).
   * Unlike `restoreLocked`, which persists for as long as the card is in
   * play.
   */
  skipNextRestore?: boolean;

  /**
   * "If that card would leave play or is in play at the end of the turn,
   * remove it from the game instead." (Barracks of Precipitancy) — set by a
   * borrowed `putIntoPlay`. `moveCard` redirects any leave-play to
   * `removed`; `finishTurn` removes any still carrying the flag.
   */
  borrowedUntilEndOfTurn?: boolean;

  /**
   * String values this card has named ("name a card subtype") — see the
   * `nameValue` effect and `CardSelector.subtypeVar`. Cleared on leaving play.
   */
  namedValues?: Record<string, string>;

  /**
   * Card ids this card has "remembered" as part of an EXTRA COST / ability
   * ("pick a location you control; while THAT location is in play, ...") —
   * see the `rememberTarget` effect and the `{ type: "remembered", key }`
   * TargetRef. Cleared on leaving play.
   */
  linkedTargets?: Record<string, CardInstanceId>;

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

/**
 * A temporary keyword grant to *every character a player controls* (now and
 * entering later this turn) from a `grantKeywordToPlayer` effect — "this
 * turn, characters you control and deploy can attack even if they have not
 * been in play under your control since the start of the turn" (Hasty
 * Pursuit) grants `aggro`. Consulted by `hasKeyword`; swept by
 * `durationStillActive`.
 */
export interface RuntimePlayerKeywordGrant {
  id: ModifierId;
  sourceId?: CardInstanceId;
  playerId: PlayerId;
  keyword: Keyword;
  duration: Duration;
  createdTurn: number;
}

/**
 * A temporary "this card loses ALL its rules text" from a `suppressAbilities`
 * effect — the duration'd counterpart of `ContinuousAbility.suppressAllAbilities`.
 * While active (`durationStillActive`) every ability on `targetId` is
 * inert (`abilitySuppressed`). "This turn, this card loses all rules text."
 * (iDumb De-Itemizer — RESET).
 */
export interface RuntimeAbilitySuppression {
  id: ModifierId;
  sourceId?: CardInstanceId;
  targetId: CardInstanceId;
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

/**
 * A temporary ADDED card type from a `setCardType` effect ("this turn, the
 * item is a golem character" — RULES.md §3.7 / CR §208.1: a card may hold
 * several types at once). While active (see `durationStillActive`) the
 * card has `cardType` *in addition to* its printed type, everywhere
 * `getCardTypes` / `hasCardType` are consulted. The stat grants that ride
 * along are separate `RuntimeModifier`s with a matching duration/source.
 */
export interface RuntimeCardTypeGrant {
  id: ModifierId;
  sourceId?: CardInstanceId;
  targetId: CardInstanceId;
  cardType: CardType;
  duration: Duration;
  createdTurn: number;
}

/**
 * A temporary ADDED subtype from a `grantSubtype` effect ("it gains the
 * sarcophyle subtype" — Sarcophyle Matriculation, Vander Malagut). While
 * active (see `durationStillActive`) the card lists `subtype` in addition
 * to its printed subtypes, everywhere `getSubtypes` is consulted.
 */
export interface RuntimeSubtypeGrant {
  id: ModifierId;
  sourceId?: CardInstanceId;
  targetId: CardInstanceId;
  subtype: string;
  duration: Duration;
  createdTurn: number;
}

/**
 * A runtime "if X would happen, instead Y" installed by an
 * `installReplacement` effect (the one-shot form of a `ReplacementAbility`).
 * Consulted by `applyReplacement`; `condition` is evaluated with the
 * affected card bound to `__candidate`. Swept by `durationStillActive`;
 * `endOfBattle` entries are cleared when the current battle ends.
 */
export interface RuntimeReplacement {
  id: ModifierId;
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  replaces:
    | { event: "destroy"; cardType?: CardType }
    | { event: "moveToZone"; zone: Zone; cardType?: CardType };
  condition?: Condition;
  effects: Effect[];
  /**
   * The installing ability's `context.selected` snapshot — so a `condition`
   * / `effects` referencing the tactic's picks ("if the picked character
   * would be destroyed") still resolve after the tactic is gone. The
   * affected card is additionally bound to `__candidate`.
   */
  selected: Record<string, CardInstanceId[]>;
  duration: Duration | { type: "endOfBattle" };
  createdTurn: number;
}

/**
 * A runtime "cards entering a hand go elsewhere instead" window from a
 * `redirectHandMoves` effect (Quotidian Misfire). While active, `moveCard`
 * to `"hand"` is rerouted to `to` for cards whose owner matches `who`
 * (relative to `sourceControllerId`). Swept by `durationStillActive`.
 */
export interface RuntimeHandMoveRedirect {
  id: ModifierId;
  sourceControllerId: PlayerId;
  who: "self" | "opponent" | "any";
  to: Zone;
  duration: Duration;
  createdTurn: number;
}

/**
 * A temporary card-level PROVIDES grant from a `grantProvides` effect
 * ("This turn, this card gains PROVIDES: [O][O][O]"). Consulted by
 * `getResourceIcons` while `targetId` is in play; swept by
 * `durationStillActive` / cleared when the card leaves play.
 */
export interface RuntimeProvideGrant {
  id: ModifierId;
  sourceId?: CardInstanceId;
  targetId: CardInstanceId;
  icon: "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
  amount: number;
  duration: Duration;
  createdTurn: number;
}

/** A temporary phantom resource-icon grant ("this turn, you control an additional [E][E][E][E]" — 31337!). */
export interface RuntimeResourceGrant {
  id: ModifierId;
  playerId: PlayerId;
  icon: "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
  amount: number;
  duration: Duration;
  createdTurn: number;
}

/** A runtime "damage dealt BY this source is adjusted by `delta`" entry from a `modifyOutgoingDamage` effect (Sockem Bot). */
export interface RuntimeOutgoingDamageModifier {
  id: ModifierId;
  sourceId: CardInstanceId;
  delta: number;
  duration: Duration;
  createdTurn: number;
}

/**
 * A runtime transform of how a character assigns / receives *battle damage*,
 * registered by a `transformBattleDamage` effect and consulted as locked
 * assignments are inflicted (`inflictLockedBattleDamage`). `cardId` is the
 * character it applies to; `role` says whether that's the assignment's
 * dealer or its target.
 * - `setAmount` — the dealer assigns `amount` instead of its strength
 *   (Ocular Dispersal — `amount` = the host's numeric cost).
 * - `redirectToSelf` — the dealer's damage is dealt to the dealer instead
 *   (Don't Trip).
 * - `bounceOther` — the dealer inflicts no damage; the target card is put
 *   into its owner's hand instead (Vexing Nullifier, dealer side).
 * - `bounceSelf` — a character dealing damage to `cardId` inflicts none;
 *   `cardId` is put into its owner's hand instead (Vexing Nullifier,
 *   receiver side).
 */
export interface BattleDamageTransform {
  id: ModifierId;
  sourceId?: CardInstanceId;
  cardId: CardInstanceId;
  role: "dealer" | "receiver";
  kind: "setAmount" | "redirectToSelf" | "bounceOther" | "bounceSelf";
  amount?: number;
  duration: Duration;
  createdTurn: number;
}

/** A runtime damage "shield" registered by `preventDamage`, consumed as damage is inflicted this turn. */
export interface DamageShield {
  id: ModifierId;
  targetId: CardInstanceId;
  /** Remaining points this shield can still absorb (a positive sentinel while `wholeInstance`, until it is spent). */
  amount: number;
  mode: "reduce" | "redirect";
  redirectToId?: CardInstanceId;
  /** "Reduce the next damage instance to 0" — absorbs one whole instance, ignoring `amount`, then is spent (Visible Loaf). */
  wholeInstance?: boolean;
  createdTurn: number;
}

/** A one-shot delayed effect registered by `scheduleEffect`, fired at the next matching moment then discarded. */
export interface ScheduledEffect {
  id: ModifierId;
  when: "startOfNextTurn" | "startOfOpponentNextTurn" | "endOfTurn" | "endOfBattle";
  /** The turn on which it was scheduled — an `endOfTurn` entry fires at the end of THIS turn; a `startOfNextTurn` entry fires at the start of its controller's next turn. */
  turnScheduled: number;
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  condition?: Condition;
  effects: Effect[];
}

/**
 * A temporary "you may not play X this turn" from a `restrictPlay` effect.
 * `kind: "cardType"` blocks deploying a card of `cardType`; `kind: "flipUp"`
 * blocks the FLIP UP action. Consulted by `assertCanDeployAtCurrentTiming` /
 * the `flipUp` handler; swept by `durationStillActive`.
 */
export interface RuntimePlayRestriction {
  id: ModifierId;
  playerId: PlayerId;
  kind: "cardType" | "flipUp";
  cardType?: CardType;
  duration: Duration;
  createdTurn: number;
}

/**
 * A temporary per-card adjustment to a card's numeric deploy cost from a
 * `modifyNumericCost` effect ("this turn, the character loses 1 numeric
 * cost"). Folded into `applyCostModifiers`; swept by `durationStillActive`.
 */
export interface RuntimeNumericCostModifier {
  id: ModifierId;
  targetId: CardInstanceId;
  delta: number;
  duration: Duration;
  createdTurn: number;
}

/**
 * A pending "reduce the threshold requirement of the next card you deploy
 * this turn by N of `icon`" from a `reduceThreshold` effect (Clockman
 * Skydocks). Consulted by `meetsThreshold`; cleared by the next deploy and
 * at end of turn.
 */
export interface RuntimeThresholdReduction {
  id: ModifierId;
  playerId: PlayerId;
  icon: "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
  amount: number;
  createdTurn: number;
}

/** A pending "reduce the next numeric cost you pay this turn" from a `reduceNextCost` effect, consumed by one `playCard`. */
export interface RuntimeCostReduction {
  id: ModifierId;

  playerId: PlayerId;
  amount: number;

  /** When set, only a play of this card type benefits from and consumes this reduction ("the next character you play"). */
  cardType?: CardType;

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
  finishFlipUp?: {
    cardId: CardInstanceId;
    attachTargetId?: CardInstanceId;
    context?: ResolutionContext;
  };
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

  /**
   * "Only those characters can block." — when set (by a
   * `restrictBlockersToChosen` effect on a `characterAttacked` trigger),
   * the defender-declared blocking party for this battle may contain only
   * these ids, and each of them that can legally block must. Wyrmfang
   * Deathskull.
   */
  chosenBlockers?: CardInstanceId[];
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
   * How many times the active player has used their faction's Develop Rule
   * (CR §202.8) this turn — the develop rule is an optional action
   * (`chooseDevelop`) usable any time during the active player's turn, not
   * a phase. Capped by `faction.turn.develop.usesPerTurn` (default 1; the
   * Union of Unextraordinary Miners' "OVERTIME" gives 2). Reset to 0 at
   * the start of every turn.
   */
  developsUsedThisTurn: number;

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
  /** Duration'd "loses <keyword>" from a `suppressKeyword` effect — mirrors `keywordGrants` but removes (lose beats grant). I See You!. */
  keywordSuppressions: RuntimeKeywordGrant[];
  playerKeywordGrants: RuntimePlayerKeywordGrant[];
  abilitySuppressions: RuntimeAbilitySuppression[];
  restrictions: RuntimeRestriction[];
  costReductions: RuntimeCostReduction[];
  thresholdReductions: RuntimeThresholdReduction[];
  numericCostModifiers: RuntimeNumericCostModifier[];
  outgoingDamageModifiers: RuntimeOutgoingDamageModifier[];
  playRestrictions: RuntimePlayRestriction[];
  resourceGrants: RuntimeResourceGrant[];
  provideGrants: RuntimeProvideGrant[];
  cardTypeGrants: RuntimeCardTypeGrant[];
  subtypeGrants: RuntimeSubtypeGrant[];
  runtimeReplacements: RuntimeReplacement[];
  handMoveRedirects: RuntimeHandMoveRedirect[];
  damageShields: DamageShield[];
  battleDamageTransforms: BattleDamageTransform[];
  scheduledEffects: ScheduledEffect[];

  /**
   * Runtime "all inflicted damage is reduced to 0" windows from a
   * `preventAllDamage` effect (Limited Liability). While any is active,
   * every `dealDamage` / battle-damage assignment resolves to 0. Swept by
   * `durationStillActive`.
   */
  damagePreventionWindows: Array<{ id: ModifierId; duration: Duration; createdTurn: number }>;

  /**
   * Runtime "cards can only be destroyed by costs" windows from a
   * `restrictDestruction` effect (Limited Liability). While any is active,
   * the `destroy` effect is a no-op (cost / lethal-damage / removeFromGame
   * paths are unaffected). Swept by `durationStillActive`.
   */
  destructionRestrictionWindows: Array<{ id: ModifierId; duration: Duration; createdTurn: number }>;

  /**
   * Durationed "take control" grants (`takeControl` effect with a
   * `duration`). When one expires (swept at the start-of-turn point), the
   * card's control reverts to `previousControllerId`. Mutiny Grant.
   */
  controlGrants: Array<{
    id: ModifierId;
    cardId: CardInstanceId;
    previousControllerId: PlayerId;
    duration: Duration;
    createdTurn: number;
  }>;

  /**
   * Ability bodies granted to a card by a `grantAbilitiesFrom` effect
   * ("gains all rules text of the removed character" — Skin Suit). Merged
   * into the recipient's ability lookups; entries for a card are dropped
   * when it leaves play.
   */
  abilityGrants: Array<{
    id: ModifierId;
    cardId: CardInstanceId;
    sourceId: CardInstanceId;
    abilities: AbilityDefinition[];
  }>;

  /**
   * Durationed "only <constraint> can block <target>" restrictions from a
   * `restrictBlockers` effect (the "this turn" form of
   * `ContinuousAbility.blockRestriction`). Consulted in `declareBlockers`;
   * swept by `durationStillActive`. LeoKaiser.
   */
  blockRestrictionGrants: Array<{
    id: ModifierId;
    sourceId: CardInstanceId;
    targetId: CardInstanceId;
    minPartySize?: NumberExpression;
    minSpeed?: NumberExpression;
    condition?: Condition;
    duration: Duration;
    createdTurn: number;
  }>;

  /**
   * Durationed "this turn, a forming party that includes `targetId` must
   * <constraint>" grants from a `restrictParty` effect — the "this turn"
   * form of `ContinuousAbility.partyRestriction` (parallel to how
   * `blockRestrictionGrants` is the "this turn" form of
   * `blockRestriction`). Consulted in `assertPartyComposition`; swept by
   * `durationStillActive`. Carnival King (CONGA LINE).
   */
  partyRestrictionGrants: Array<{
    id: ModifierId;
    sourceId: CardInstanceId;
    targetId: CardInstanceId;
    role: "any" | "attacking" | "blocking";
    minMembers?: NumberExpression;
    maxMembers?: NumberExpression;
    parity?: "even" | "odd";
    duration: Duration;
    createdTurn: number;
  }>;

  /**
   * "For the rest of the game, you may deploy the voided cards as though
   * they were in your hand [even if you cannot meet their threshold]"
   * (Cheats, the Dirty Rotten). Each entry lets `playerId` play `cardId`
   * from the void as though it were a hand card. Persistent; an entry is
   * pruned when its card leaves the void.
   */
  voidPlayGrants: Array<{
    cardId: CardInstanceId;
    playerId: PlayerId;
    ignoreThreshold: boolean;
  }>;

  /**
   * Per-turn count of how many times each activated ability has been used,
   * keyed `"<cardId>:<abilityId>"`. Reset at the start of every turn. Read
   * by `ActivatedAbility.usesPerTurn` ("use this only N times each turn").
   */
  abilityUsesThisTurn: Record<string, number>;

  /**
   * Per-turn count of how many times each character has been declared as an
   * attacker this turn, keyed by `CardInstanceId`. Reset at the start of
   * every turn. Read by the `attackOncePerTurn` restriction ("this card can
   * attack only once each turn").
   */
  attacksThisTurn: Record<string, number>;

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
   * The in-flight MUSTACHE SHOWDOWN (`partitionAndPick` effect), advanced
   * one player at a time by the `partitionCards` → `pickPile` →
   * `takeFromPile` pending choices. Cleared when the showdown resolves.
   */
  pendingPartition?: {
    sourceId: CardInstanceId;
    controllerId: PlayerId;
    compareBy: "cost";
    winnerTakes: number;
    /** The two players, in the order they act (controller first). */
    order: PlayerId[];
    /** Top-`count` cards each player revealed (still sitting on top of their deck). */
    revealed: Record<PlayerId, CardInstanceId[]>;
    /** Each player's split of their own revealed cards, once made. */
    partitions: Record<PlayerId, CardInstanceId[][]>;
    /** Which of the OTHER player's piles each player chose (index), once made. */
    picks: Record<PlayerId, number>;
    phase: "partition" | "pick";
  };

  /**
   * A coin flip (`flipCoin` effect) paused on a "you may reflip" replacement
   * (Two-Headed Coin) — paired with a `coinFlipReplace` pending choice. On
   * accept: pay `replacementCost`, reroll once, run the matching branch then
   * `replacementEffects`. On decline: run `loseEffects`.
   */
  pendingCoinFlip?: {
    context: ResolutionContext;
    flipperId: PlayerId;
    winEffects: Effect[];
    loseEffects: Effect[];
    replacementCost: Cost[];
    replacementEffects: Effect[];
    replacementSourceId: CardInstanceId;
  };

  /**
   * The in-flight Auction House auction (`auctionForCard` effect), advanced
   * by the `auctionBid` pending choice. `characterId` is the card up for
   * bid; `otherRevealed` are the non-character cards revealed above it (all
   * shuffled back once the auction settles). `bids` records each player's
   * standing bid; `turn` is whose turn it is to bid or pass; `highBid` /
   * `highBidder` track the current lead.
   */
  pendingAuction?: {
    sourceId: CardInstanceId;
    controllerId: PlayerId;
    deckOwnerId: PlayerId;
    characterId: CardInstanceId;
    otherRevealed: CardInstanceId[];
    order: PlayerId[];
    turn: PlayerId;
    highBid: number;
    highBidder?: PlayerId;
    passed: PlayerId[];
  };

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
   * Per-turn list of the cards each player has deployed (via `playCard`), in
   * order — printed `name` + `type`. Reset at the start of every turn. Read
   * by the `deploySameNameThisTurn` condition ("an opponent deployed at
   * least 2 cards with the same name this turn") and the `deploysThisTurn`
   * expression ("2 other non-resource cards this turn", "an opponent
   * deployed a character this turn").
   */
  turnDeploys: Record<PlayerId, Array<{ name: string; type: CardType }>>;

  /**
   * The most recently RESOLVED tactic this turn (set as a tactic finishes
   * resolving), read by the `lastDeployedTactic` TargetRef. `undefined` at
   * the start of each turn / until a tactic resolves.
   */
  lastDeployedTacticId?: CardInstanceId;

  /**
   * Per-turn record, keyed by damage-source `CardInstanceId`: whether that
   * card has inflicted any damage this turn (`assigned`), the owners of
   * every faction it damaged (`toFactionOf`), and the ids of every card it
   * damaged (`toCards`). Populated from `damageDealt` events in `emit`,
   * reset at the start of every turn. Read by the `assignedDamageThisTurn` /
   * `inflictedDamageToFactionThisTurn` / `damagedThisTurn` conditions.
   */
  damageThisTurn: Record<
    string,
    { assigned: boolean; toFactionOf: PlayerId[]; toCards: CardInstanceId[] }
  >;

  /**
   * Per-player count of upcoming faction Restore Rules to skip entirely
   * ("on your next turn, skip your faction's RESTORE RULE" — Monstrous
   * Lassitude). Decremented each time a skip is consumed at start of turn.
   */
  restoreRuleSkips: Record<PlayerId, number>;

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
