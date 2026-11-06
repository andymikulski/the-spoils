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
import type { GameLogEntry } from "./log.js";
import type { GameEvent } from "./events.js";
import type { PendingChoice, ReplacementTrigger } from "./choices.js";
import type { AbilityDefinition, ActivatedAbility } from "./cards.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { Effect } from "./effects.js";
import type { CardSelector, NumberExpression } from "./expressions.js";
import type { CreatedAbilitySpec } from "./createdAbility.js";
import type { GameFormat, GameResult, PlayerElimination } from "./format.js";
import type { ShowdownState } from "./showdown.js";

export interface CardInstance {
  id: CardInstanceId;
  definitionId: CardDefinitionId;

  ownerId: PlayerId;
  controllerId: PlayerId;

  zone: Zone;

  /**
   * The player whose hand or deck holds this card when that is NOT its owner
   * — only ever set while `zone` is `"hand"` or `"deck"`, and only by a
   * `moveCard` effect / `moveSelected` cost with a `toPlayer` ("Put the
   * resource into YOUR hand", "shuffle this card into YOUR deck"). The card
   * sits in that player's `hand`/`deck` array and that player controls it;
   * ownership never changes (CR §407.8), so every other zone (discard, void,
   * removed) still belongs to `ownerId`. Absent means the owner holds it.
   */
  heldBy?: PlayerId;

  /**
   * The ability the players wrote for this faction card before the game
   * began (`FactionDefinition.playerCreatedAbility`; The Open R&D Faction).
   * Always an activated ability usable by either player. `spec` is the
   * structured menu choice the players agreed on, `ability` what the engine
   * built from it and `text` the rules text generated from it (for display).
   * All three are plain JSON, so a save or replay keeps them.
   */
  createdAbility?: { text: string; ability: ActivatedAbility; spec: CreatedAbilitySpec };

  /**
   * Set while in play when the card was deployed into an open response
   * window as a non-tactic — i.e. using "you may play this card whenever
   * you could play a tactic" (TACTICAL). Read by the `deployedAsResponse`
   * condition.
   */
  deployedAsResponse?: boolean;

  /**
   * While the card is being played (zone `deploying`): its numeric cost as it was paid, the running total of CR 406.3
   * (cost number + extra "pay N", then increases and reductions). Read by `cardCost`.
   */
  numericCostPaid?: number;

  /**
   * While in the void (or removed zone): the card that put it there (the
   * source of the `moveCard` effect that voided / removed it). Read by `CardSelector.voidedBySource`
   * ("a character voided by this card" — Abram Ka-darbo Alakazin). Cleared
   * when the card leaves the void.
   */
  voidedBy?: CardInstanceId;

  /**
   * While in the void (or removed zone) FACE-DOWN: the player who put it there face-down — the controller of the
   * `moveCard { faceDown: true }` effect's source (Pant Swipe's caster; the Arcane Escrow player discarding).
   * Read by `SpoilsEngine.canViewerSeeVoidedCard`. Cleared with `voidedBy`, on any move.
   */
  faceDownBy?: PlayerId;

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
   * "If that card or this card would leave play this turn, remove both cards
   * from the game instead." (Spurious Anthropologist) — set on BOTH cards by
   * a `putIntoPlay` with `pairWithSource`. Either one leaving play removes
   * both from the game; cleared for every card at the end of the turn.
   */
  pairedWith?: CardInstanceId;

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

  /**
   * The turn number on which this face-up card was already in play under its
   * current controller when the turn began (CR 204.3), for either player and
   * any card type. Lets a non-active player's characters attack through
   * Counter Attack and lets a card that became a character mid-turn attack.
   */
  startedTurnInPlay?: number;

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

  /** Set once the player is out of a game with three or more players (their faction reached 0 influence). */
  eliminated?: PlayerElimination;
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

/**
 * A standing "this turn" stat change over every card matching `selector` (the `createAreaModifier` effect). `selector`
 * is matched live on every stat read, from `controllerId`'s point of view ("opponent" = that player's opponent);
 * `id` is drawn from the same sequence as `RuntimeModifier` ids so the two interleave in creation order.
 */
export interface RuntimeAreaModifier {
  id: ModifierId;

  sourceId?: CardInstanceId;
  sourceAbilityId?: AbilityId;
  /** The controller of the effect when it resolved. */
  controllerId: PlayerId;
  /** The opponent the creating block of rules text was about (D4): its "opponent" keeps naming that player. Absent: every opponent. */
  opponentId?: PlayerId;
  selector: CardSelector;

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
  /** Only counts while this holds (the effect's `condition`), evaluated as `controllerId`'s effect from `sourceId`. */
  condition?: Condition;
  controllerId?: PlayerId;
  createdTurn: number;
  /**
   * Gained while the target had the character type: temporary rules text is
   * removed when the card later stops being a character (CR 508.3).
   */
  whileCharacter?: boolean;
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
  /** The opponent the creating block of rules text was about (D4): its "opponent" keeps naming that player. Absent: every opponent. */
  opponentId?: PlayerId;
  /** Same shape as `installReplacement.replaces`; `controlledBy` / `by` are relative to `controllerId`. */
  replaces: Extract<Effect, { type: "installReplacement" }>["replaces"];
  condition?: Condition;
  effects: Effect[];
  /** Asks the controller whether to apply it ("you may ... instead"). */
  optional?: boolean;
  /** Used up the first time it applies / is offered ("the next time"). */
  once?: boolean;
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
  /** The card whose effect installed it (read-only info for `getActiveProtections`). */
  sourceId?: CardInstanceId;
  sourceControllerId: PlayerId;
  /** The opponent the creating block of rules text was about (D4): its "opponent" keeps naming that player. Absent: every opponent. */
  opponentId?: PlayerId;
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

/**
 * A runtime "damage dealt BY this source is adjusted by `delta`" entry from a
 * `modifyOutgoingDamage` effect (Sockem Bot). With `targetId` set it is the
 * mirror image from a `modifyIncomingDamage` effect: EVERY damage instance
 * inflicted TO that card is adjusted (Fiscal Intercessor); `sourceId` is then
 * just the card that made the entry.
 */
export interface RuntimeOutgoingDamageModifier {
  id: ModifierId;
  sourceId: CardInstanceId;
  /** Only damage inflicted to this player's faction is adjusted. */
  toFactionOf?: PlayerId;
  targetId?: CardInstanceId;
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
  /** The card whose effect registered it (read-only info for `getActiveProtections`). */
  sourceId?: CardInstanceId;
  targetId: CardInstanceId;
  /** Remaining points this shield can still absorb (a positive sentinel while `wholeInstance`, until it is spent). */
  amount: number;
  mode: "reduce" | "redirect";
  redirectToId?: CardInstanceId;
  /** "Reduce the next damage instance to 0" — absorbs one whole instance, ignoring `amount`, then is spent (Visible Loaf). */
  wholeInstance?: boolean;
  /** "Reduce the NEXT damage inflicted by N" — applies to one damage instance only, however small it was, then is spent (Tiny Shiny). */
  oneInstance?: boolean;
  /** Kept across turns until spent (the effect's `persistent`). */
  persistent?: boolean;
  createdTurn: number;
}

/** A one-shot delayed effect registered by `scheduleEffect`, fired at the next matching moment then discarded. */
export interface ScheduledEffect {
  id: ModifierId;
  when: "startOfNextTurn" | "startOfOpponentNextTurn" | "startOfTheNextTurn" | "endOfTurn" | "endOfBattle";
  /** The turn on which it was scheduled — an `endOfTurn` entry fires at the end of THIS turn; a `startOfNextTurn` entry fires at the start of its controller's next turn. */
  turnScheduled: number;
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  /** The opponent the creating block of rules text was about (D4): its "opponent" keeps naming that player. Absent: every opponent. */
  opponentId?: PlayerId;
  condition?: Condition;
  effects: Effect[];
  /** The event that triggered the scheduling ability (SYS-48): a rider's `target: "eventCard"` keeps resolving when it fires later. */
  event?: GameEvent;
  /** The picks made when it was scheduled, so the rider can still name them. */
  selected?: Record<string, CardInstanceId[]>;
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
  /** The card whose effect imposed the ban (Tactician Vacation); read-only info for `CardPlayability.blockedBy`. */
  sourceId?: CardInstanceId;
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
  /** Kept across turns until a play consumes it (the effect's `persistent`). */
  persistent?: boolean;
  createdTurn: number;
}

/** A pending "reduce the next numeric cost you pay this turn" from a `reduceNextCost` effect, consumed by one `playCard`. */
export interface RuntimeCostReduction {
  id: ModifierId;

  playerId: PlayerId;
  amount: number;

  /** When set, only a play of this card type benefits from and consumes this reduction ("the next character you play"). */
  cardType?: CardType;

  /** With `cardType`: a numeric cost of an ability of a card of that type counts too ("the next item's or item's ability's numeric cost"). */
  includeAbilities?: boolean;

  /** "The next CARD you play": it reaches a card's own numeric cost, never an ability's "pay N". */
  cardsOnly?: boolean;

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
 * chooser effect goes on to add — has finished.
 */
export interface PendingEffectFrame {
  effects: Effect[];
  index: number;
  context: ResolutionContext;
  finishStackItem?: StackItem;
  /** Record where each pick is (`context.pickZones`) when this frame starts running (a stack item's resolution). */
  recordPickZones?: boolean;
  /** The effect at `index` is a deck search whose `deckSearched` announcement was already answered. */
  announcedEffect?: Effect;
}

export interface BattleDamageAssignment {
  sourceId: CardInstanceId;
  target:
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId };
  amount: number;
}

export type BattleSide = "attacking" | "blocking";

/** A character that has been part of a battle party, at any point in the battle. */
export interface BattleParticipant {
  cardId: CardInstanceId;
  side: BattleSide;
}

/**
 * One completed round of battle damage — a single speed level (CR §609.1),
 * from both sides' assignments through the damage actually landing.
 */
export interface BattleRound {
  speed: number;

  /**
   * Every character that assigned battle damage this round, both sides —
   * including ones that assigned 0 (CR §408.1b) or had no legal target.
   */
  assignedBy: CardInstanceId[];

  /** The assignments as the players locked them in (CR §609.1c–e). */
  assigned: BattleDamageAssignment[];

  /**
   * What was actually inflicted (CR §609.1f), after battle-damage
   * transforms, damage modifiers and prevention; zero amounts are dropped.
   * Damage a prevention shield redirected appears as an entry against the
   * card that took it. A faction entry's amount is the influence it lost.
   */
  inflicted: BattleDamageAssignment[];
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

  /** Current party members. A character that leaves the battle is dropped. */
  attackingParty: CardInstanceId[];
  blockingParty: CardInstanceId[];

  /**
   * Every character that has joined either party this battle, in join order —
   * including ones that have since left it (destroyed, bounced, removed from
   * battle). `attackingParty` / `blockingParty` hold who is still in.
   */
  participants: BattleParticipant[];

  /** Completed damage rounds, in order. The round in progress isn't here yet. */
  rounds: BattleRound[];

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

  /**
   * An attack started by an effect (Counter Attack) while an end-of-turn
   * announcement was being answered: once the battle is cleared the
   * `endTurn` window re-opens, so the announced end of turn is not lost
   * (CR 610.1).
   */
  resumeEndTurn?: { playerId: PlayerId; pendingResponders: PlayerId[] };

  /**
   * The current damage step's answered `millInsteadOfDamage` choices (Trickster's
   * Globe), keyed by the player holding the faction: how many points of the damage
   * to that faction become milled cards. Cleared once the step is inflicted.
   */
  factionMill?: Partial<Record<PlayerId, number>>;

  /**
   * Last-known information for the damage step being inflicted (Q27): the
   * side and stats every party member had just before the step's lethal
   * damage destroyed some of them, so "destroyed in the same damage step"
   * triggers still see the opposing party as it was. Set while a damage step
   * is inflicted, cleared right after.
   */
  lastKnown?: Record<CardInstanceId, { side: BattleSide; strength: number; speed: number; life: number }>;
}

export interface BattleView {
  battleId: BattleId;
  phase: BattlePhase;
  speed?: number;

  attackerPlayerId: PlayerId;
  defenderPlayerId: PlayerId;

  target: BattleState["target"];

  attackingParty: CardInstanceId[];
  blockingParty: CardInstanceId[];

  /** See `BattleState.participants`. */
  participants: BattleParticipant[];

  /** Characters that have already assigned battle damage this battle. */
  assignedDamageBy: CardInstanceId[];

  /** See `BattleState.rounds`. */
  rounds: BattleRound[];

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

  /**
   * In a damage-assignment step: the assignment that is the only legal one (every source that deals damage has
   * exactly one legal target, so it assigns its full strength there), ready to submit as `assignBattleDamage`;
   * `[]` when no source deals anything. `null` when someone has a real choice, and outside a damage step.
   */
  forcedAssignments?: BattleDamageAssignment[] | null;

  /**
   * The speed levels still to strike after the current one (highest first): the speeds of battle characters that
   * have not assigned yet. Display only; effects can change speeds before the level comes up (CR 609.1b).
   */
  upcomingSpeeds?: number[];
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
   *   the player in `priorityPlayerId` may deploy a tactic / TACTICAL card or
   *   use an ability as a response (CR §607.2).
   *
   * resolving:
   *   the entitled player has declined. advanceFlow() resolves the item on
   *   top of the response stack, then the window re-opens for whoever may
   *   respond next (CR §607.2 / §607.2a) — or closes and resumes the
   *   interrupted flow once nobody has anything left to add.
   */
  phase: "acceptingResponses" | "resolving";

  /**
   * The one player entitled to act right now. The Spoils has no
   * priority-passing system (CR §607.2b): while the response stack has
   * items this is the head of `stackResponders` — a player other than the
   * one whose action is on top; you never respond to your own action (CR
   * §607.1). While the stack is empty it is the head of `pendingResponders`.
   */
  priorityPlayerId: PlayerId;

  /**
   * While the response stack has items: the players who may still respond
   * to the item now on top, in turn order from the seat after whoever put it
   * there (in a two-player game, just the opponent). Each pass shifts the
   * head off; when it empties the top item resolves. A response replaces the
   * list with the players who may respond to *that* response (engine-derived,
   * D6). Absent on a window saved before this field existed: the single
   * `priorityPlayerId` is then the only responder.
   */
  stackResponders?: PlayerId[];

  /**
   * Players who still get a top-level opportunity to respond once the
   * response stack drains, in order. A single-responder `action` window is
   * driven entirely by its stack item and leaves this empty; an `endTurn`
   * window holds every other living player from the seat after the
   * turn-ender; a battle response window (CR §608.1c / §609.1a — "the
   * attacking player may deploy tactics and use abilities as many times as
   * they want, then the defending player may do the same") holds
   * `[attacker, defender]`, then every other living player in turn order.
   * A player is shifted off once they pass with an empty stack; when it
   * empties and the stack is empty the window closes.
   */
  pendingResponders: PlayerId[];

  continuation: ResponseContinuation;
}

export type GameSetupState =
  | {
      /**
       * A player whose deck runs more than one kind of staple resource picks
       * which staples their faction starts with in play (most factions —
       * "find 2 staple resources"). Runs before `mulligan`; the deck shuffle
       * and opening-hand draw wait until every `order` seat has answered.
       * Absent entirely when no player has a choice (single staple type, or a
       * name-pinned faction) — setup goes straight to `mulligan` / `complete`.
       */
      phase: "chooseStartingResources";
      order: PlayerId[];
      currentIndex: number;
      /** How many staples each `order` seat must pick. */
      counts: Record<PlayerId, number>;
      /** Ask each `STARTING DRAW` search ("You may search ...") as a real prompt afterwards (see `startingDrawSearch`). */
      askStartingDrawSearch?: boolean;
      /**
       * This round is the staple top-up of an opponent's `matchOpponentCount`
       * rule (The Union of Unextraordinary Miners — "enough staple resources
       * so that both players have the same number"): `counts` is the number of
       * extra staples the seat picks, with none of its faction's own
       * starting-resource rules applied.
       */
      topUp?: boolean;
    }
  | {
      /**
       * A faction's optional STARTING DRAW search ("You may search your deck
       * for a staple resource that is not any of your starting resources,
       * reveal it and put it into your hand", Unlikely Heroes) is asked as a
       * `chooserSelectsTarget` pending choice, one `order` seat at a time
       * (declined = `declined: true`, nothing is searched). Only with the
       * setup option `chooseStartingResources`; otherwise setup fetches the
       * first match without asking. Runs after the starting resources are in
       * play and before the shuffle / opening hands.
       */
      phase: "startingDrawSearch";
      order: PlayerId[];
      currentIndex: number;
    }
  | {
      /**
       * CR 601.1c: "Randomly determine which player will decide who takes
       * the first turn of the game. That player chooses who goes first."
       * The random draw picked `order[0]`, the deciding player, who answers
       * with a `chooseFirstPlayer` action naming either player. Runs once the
       * starting resources are in play (601.1b) and before the STARTING DRAW
       * (search, shuffle, opening hands: 601.1e). Only with the setup option
       * `chooseFirstPlayer`; otherwise the caller's `firstPlayerId` goes first.
       */
      phase: "chooseFirstPlayer";
      order: PlayerId[];
      currentIndex: number;
      /** Carried over from `chooseStartingResources`: ask each STARTING DRAW search as a prompt afterwards. */
      askStartingDrawSearch?: boolean;
    }
  | {
      phase: "mulligan";
      order: PlayerId[];
      currentIndex: number;
      /**
       * Set while a prompt raised by this player's mulligan ("you may reveal
       * it") is open: the replacement draw waits for the answer.
       */
      pendingDraw?: { playerId: PlayerId; count: number };
    }
  | { phase: "complete" };

/**
 * What a seat in the `chooseStartingResources` setup phase is choosing from —
 * the staple resource instances in their own deck, and how many to pick.
 * `SpoilsEngine.getStartingResourceChoice`.
 */
export interface StartingResourceChoice {
  /** Exactly this many of `candidateCardIds` must be chosen. */
  count: number;
  /** Every staple resource instance currently in this player's deck (repeats are distinct ids). */
  candidateCardIds: CardInstanceId[];
  /**
   * Extra resources placed alongside the chosen staples, not chosen by the
   * player — `chosenStaples.plus` ("...and 1 Deception"). Display-only here;
   * the engine re-resolves them at placement time.
   */
  fixedCardIds: CardInstanceId[];
  /**
   * The chosen staples must be `count` *different* kinds ("any 2 different
   * staple resources" — Unlikely Heroes, the faction's `distinctStaples`
   * flag). A UI should stop the player picking a second copy of an
   * already-chosen kind; the engine rejects it too. `false` for the plain
   * Tournament Faction (repeats allowed), the pinned / `chosenStaples`
   * forms, and when the deck runs fewer than `count` kinds.
   */
  distinct: boolean;
  /**
   * A faction whose STARTING RESOURCES is a `slots` program (The Society of
   * Magical Propriety "Any 1 resource, Any 1 card"; "1 Obsession, 1 staple
   * resource"): one entry per slot the player picks for, in order. The answer's
   * `cardIds` are one card per entry, in the same order; each must come from
   * that entry's `candidateCardIds`. Named slots ("1 Obsession") are not
   * listed: they are placed automatically (`fixedCardIds`).
   */
  slots?: Array<{ kind: "staple" | "resource" | "anyCard"; candidateCardIds: CardInstanceId[] }>;
}

/**
 * The CR 601.1c decision in the `chooseFirstPlayer` setup phase: who decides,
 * and what each answer means for the opening hands (each player's STARTING
 * DRAW for going first or second, The Knitting Coalition's override
 * included). `SpoilsEngine.getFirstPlayerChoice`.
 */
export interface FirstPlayerChoice {
  /** The player the random draw picked to decide who goes first. */
  deciderId: PlayerId;
  /**
   * The number of cards each player draws for their opening hand, keyed by
   * the player who goes first: `openingDraw[firstPlayerId][playerId]`.
   */
  openingDraw: Record<PlayerId, Record<PlayerId, number>>;
}


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
  /**
   * The card's printed numeric cost, after any pending "reduce next cost"
   * effect and — for a card whose own "EXTRA COST: reduce this card's
   * numeric cost by..." depends on a selection not made yet (Opportunistic
   * Pirate) — the best case for that reduction. `deployCard` re-evaluates
   * for real once an actual selection exists.
   */
  numericCost: number;
  /** Currently unattached resources available to pay with. */
  availableResources: number;
  /**
   * Set only when the card is not in hand but may be played "as though it were in hand": the zone it sits in
   * ("void" | "removed"). See `SpoilsEngine.getPlayableFromOutsideHand`.
   */
  fromZone?: Zone;
  /** Set only alongside `fromZone`: whether the grant / aura waives the card's printed threshold (the numeric cost is still paid). */
  thresholdWaived?: boolean;
  /** The card that granted this play from outside the hand (a `grantVoidPlay` effect's source, or the aura's source). */
  grantSourceId?: CardInstanceId;
  /**
   * Why `legalTiming` is false, from the very gates `deployCard` refuses at (`CardPlayBlock`). Absent when the
   * card is deployable at this moment, and when it simply is not a card the player can play (not in hand, no
   * outside-hand grant). A threshold or cost shortfall is NOT reported here: `thresholdMet` / `numericCost` /
   * `availableResources` already say so.
   */
  blockedBy?: CardPlayBlock;
}

/**
 * Why a card cannot be deployed right now (`CardPlayability.blockedBy`).
 *  - `timing`: not a legal moment (wrong phase / no priority / not a response-legal card / battle / stack).
 *  - `playRestriction`: a player-level ban on this card's TYPE — a runtime `restrictPlay` effect (Tactician
 *    Vacation, Study Disturbance, Surreptitious Larceny) or an in-play continuous ban (Lockbox of the Aeons, Geldale).
 *  - `namedBan`: an in-play card banned this card BY NAME (Incriminating Photograph, Port Manteau); `namedValue` is
 *    the name it chose, `sourceId` the card that chose it (see `SpoilsEngine.getNamedValues`).
 *  - `condition`: the card's own printed play condition ("deploy this only on your turn ...") does not hold.
 *  - `other`: any remaining hard rule (e.g. a resource card is never deployed as a normal play).
 */
export interface CardPlayBlock {
  kind: "timing" | "playRestriction" | "namedBan" | "condition" | "other";
  /** The card imposing the ban / condition, when one does (absent for plain timing). */
  sourceId?: CardInstanceId;
  /** For `namedBan`: the card name the source named. */
  namedValue?: string;
  /** The engine's own refusal message, as `deployCard` would throw it. */
  text: string;
}

/** Why a FLIP UP is not playable right now (see `FlipUpPlayability`). */
export type FlipUpBlockedBy =
  /** Not a face-down card the player controls in play. */
  | "notFaceDown"
  /** The card has no FLIP UP option (or the named `optionIndex` does not exist). */
  | "noFlipUp"
  /** A play restriction bans FLIP UP, or playing this card's type / name. */
  | "restriction"
  /** Not a legal moment to deploy it (wrong phase, no priority, not a tactic in a response window, its play condition fails). */
  | "timing"
  /** The FLIP UP threshold is not met by the other cards in play (the flipped card's own icons do not count). */
  | "threshold"
  /** The player cannot pay the numeric FLIP UP cost. */
  | "cost"
  /** The FLIP UP line plays or discards a card from the hand and the hand has none. */
  | "riderCard";

/**
 * What `getFlipUpPlayability` reports: the same gates `perform({type: "flipUp"})`
 * applies, read-only. Like `CardPlayability` it does not cover a card's targets
 * or extra costs (those need picks the player has not made yet).
 */
export interface FlipUpPlayability {
  /** True only when no gate below blocks the flip. */
  playable: boolean;
  /** False if it is not a legal moment to deploy the card (wrong phase or priority, a response window that wants a tactic, a play ban). */
  legalTiming: boolean;
  /** False if the FLIP UP threshold is not met once the card has flipped (CR 507.4b: its own icons do not count). */
  thresholdMet: boolean;
  /** The numeric cost the flip would ask for: the FLIP UP cost plus a faction surcharge, run through the deploy cost modifiers and pending reductions. */
  numericCost: number;
  /** Unattached resources that could pay. The flipped card counts when it is one: it may pay for itself (CR 507.4b). */
  availableResources: number;
  /** The first gate that blocks it (in the order `flipUp` checks them), when not `playable`. */
  blockedBy?: FlipUpBlockedBy;
  /** The engine's own refusal text for that gate, when not `playable`. */
  reason?: string;
  /** Which of `getFlipUpOptions(cardId)` was judged (the one named, else the first that is affordable, else the first). */
  optionIndex?: number;
}

/** A battle's target: a faction or an in-play location. */
export type AttackTarget = BattleState["target"];

/** What `getAttackOptions` reports for one player at this moment. */
export interface AttackOptions {
  /** Every character that could be named in a declaration (each passes the per-attacker checks of `declareAttack`), `mustAttack` ones included. */
  attackers: CardInstanceId[];
  /** The characters that must be in any declaration ("must attack if it can": Silent Sentinels). A subset of `attackers`. */
  mustAttack: CardInstanceId[];
  /** The factions and locations that can be named as the target (for the party asked about). */
  targets: AttackTarget[];
  /** The resources the declaration costs (attack tax, e.g. The Ministry of Other Smaller Ministries), for the party asked about. */
  tax: number;
  /** Why nothing can be declared right now (a gate, timing, the attack limit, an unpayable tax, no attacker, no target). */
  blockedReason?: string;
}

/** What `getBlockOptions` reports for a battle waiting for blockers. */
export interface BlockOptions {
  /** The defending player (the only one who may declare). */
  playerId: PlayerId;
  /** Every character that could be declared as a blocker on its own: it passes the per-blocker checks, COVERT legality and the block restrictions. Empty while the attacking party cannot be blocked. */
  blockers: CardInstanceId[];
  /** The characters that must be in the declaration ("must block if it can", a `requireBlock` grant, a blocker the attacker's ability chose). */
  mustBlock: CardInstanceId[];
  /** False when no block can be declared at all (nobody can block, the attacking party cannot be blocked, or responses are still open). Declining to block is always allowed unless `mustBlock` is not empty. */
  canBlock: boolean;
  /** Why `canBlock` is false. */
  reason?: string;
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
   * Whose decision it is, in every mode: the setup seat (mulligan, starting resources), the active player in
   * `main`, the player holding priority in `response`, the battle's acting player in `battleChoice`, the
   * chooser of a `pendingChoice`. `undefined` where the only legal action is the seat-less `advanceFlow`
   * (`resolvingResponses`, `battleFinished`) and at `gameOver`.
   */
  actingPlayerId?: PlayerId;

  setup: GameSetupState;

  responseWindow?: ResponseWindowState;
  responseStack: StackItem[];
  battle?: BattleView;
  /** How the game ended, once it has. */
  result?: GameResult;
  pendingChoice?: PendingChoice;

  /**
   * True while a seat swap is in effect (`GameState.seatSwap`, Emergency
   * Obfuscation): each player's `play` zone and faction are the opponent's
   * side. A renderer can label the board accordingly; cards still report
   * their real `ownerId`.
   */
  seatsSwapped: boolean;

  /**
   * Zones currently public because of a `grantsReveal` continuous ability
   * ("the top card of your deck is revealed at all times" — Cheats
   * McGuillicutty; "each opponent's hand is revealed at all times" — Odious
   * Diva). A renderer shows these face-up; the engine itself has perfect
   * information and keys no rule off this.
   */
  revealed: {
    /** Players whose top deck card is public (and that card's id). */
    deckTop: Array<{ playerId: PlayerId; cardId: CardInstanceId }>;
    /** Players whose hand is public. */
    hands: PlayerId[];
  };
}

// -----------------------------------------------------------------------------
// State snapshot (SpoilsEngine.exportState — replay / debugging, informational)
// -----------------------------------------------------------------------------

/**
 * A card as it appears in a {@link GameStateSnapshot}: name-resolved, with
 * only the status a reader needs to picture the board. Cards outside play
 * carry just `id` / `name` / `type`; the in-play fields (`attachedTo`,
 * `attachments`, `damage`, `depleted`, `strength`, `life`, `counters`,
 * `faceDown`) are populated only for cards actually in play.
 */
export interface SnapshotCard {
  id: CardInstanceId;
  definitionId: CardDefinitionId;
  /** Printed card name — given even for a face-down card (`faceDown` flags it). */
  name: string;
  /** Printed type; runtime-added types (`setCardType`) are not reflected. */
  type: CardType;

  /** In play and face-down (a resource, or a set-aside card). */
  faceDown?: boolean;
  /** In play and depleted (tapped). */
  depleted?: boolean;
  /** Marked damage, when non-zero. */
  damage?: number;
  /** Effective strength / life — only for a card that is currently a character in play. */
  strength?: number;
  life?: number;
  /** Counters (tokens) on the card, when it has any. */
  counters?: Record<string, number>;

  /**
   * The host this card is attached to — an "Attach to X" item/aura on its
   * host, or a spent resource on its controller's faction. `name` is the
   * host's card name (`"faction"` for a faction card with no name).
   */
  attachedTo?: { id: CardInstanceId; name: string };
  /** Ids of the cards attached to this one — set on hosts that have attachments. */
  attachments?: CardInstanceId[];

  /**
   * The card's controller, given only when it differs from the player whose
   * zone the card is listed under (e.g. gear attached to an opponent's
   * character stays in the gear controller's play zone).
   */
  controllerId?: PlayerId;
}

/** One player's zones in a {@link GameStateSnapshot}. */
export interface SnapshotPlayer {
  id: PlayerId;
  name: string;
  influence: number;
  /** The deck is private — only its size is snapshotted. */
  deckCount: number;
  /**
   * The player's faction card — carried separately from `play` (where it
   * lives in `GameState`), with `attachments` listing any spent resources
   * currently on it. Absent only in a game set up without faction cards.
   */
  faction?: SnapshotCard;
  hand: SnapshotCard[];
  /** In-play cards, faction card excluded (see `faction`). */
  play: SnapshotCard[];
  discard: SnapshotCard[];
  void: SnapshotCard[];
  removed: SnapshotCard[];
}

/**
 * A complete, JSON-serializable, human-readable picture of a game at one
 * instant — every zone's contents by card name, plus turn / priority /
 * response-stack context. Produced by `SpoilsEngine.exportState()` for
 * replay and debugging tools; pairs with `getLog()` (the "how we got here"
 * to this "where things stand"). Not a rules surface — nothing keys off it,
 * and it carries perfect information (opponent hands included).
 */
export interface GameStateSnapshot {
  turn: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  /** `getFlowView().mode` at snapshot time. */
  mode: GameFlowView["mode"];
  result?: GameResult;
  /** Outermost (first-played) response-stack item first. */
  responseStack: Array<{ label: string; controllerId: PlayerId }>;
  pendingChoice?: { kind: string; playerId: PlayerId };
  /** Present (and true) only while a seat swap is in effect — see `GameState.seatSwap`. */
  seatsSwapped?: true;
  players: SnapshotPlayer[];
}

/**
 * The bookkeeping for a seat swap (Emergency Obfuscation). "Seats" are the
 * engine's players; a player's *side* is the faction they control plus every
 * card in play under their control. Entering the swap hands each in-play card
 * to the opposing player and exchanges the players' `factionId` / `influence`,
 * so every "your faction", "your characters", "your resources" lookup follows
 * control. Ownership never changes (CR §407.8); hands, decks, discard piles,
 * voids and the removed zone are untouched.
 */
export interface SeatSwapState {
  /**
   * Every card that was in play when the seats swapped, with the controller it
   * had just before. Lifting the swap returns each one that is still in play
   * and still under the controller the swap gave it; a card that entered play
   * later was never part of the exchange and keeps whoever controls it.
   */
  exchanged: Array<{ cardId: CardInstanceId; previousControllerId: PlayerId }>;
}

export interface GameState {
  turn: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  setup: GameSetupState;
  started: boolean;
  /**
   * Set by the setup option `chooseFirstPlayer` until setup reaches CR
   * 601.1c (after the starting resources), where the random draw and the
   * `chooseFirstPlayer` setup phase replace it.
   */
  decideFirstPlayer?: boolean;

  /**
   * Current position in the game's single deterministic RNG stream (deck
   * shuffles, coin flips, `{type:"random"}` expressions/targets). Part of
   * `GameState` — not engine-internal — so it travels with everything else
   * through save/replay/structuredClone/JSON: resuming a saved game
   * continues its random sequence exactly where it left off, and replaying
   * a fresh game from the same starting seed reproduces it bit-for-bit.
   */
  rngState: number;

  /**
   * Running counter this game's own runtime ids (cards, modifiers, response-
   * stack items, pending choices, battles, ...) are minted from — one shared
   * sequence, like the pre-existing `${prefix}_<n>` scheme, but carried on
   * `GameState` (like `rngState`) instead of a process-global counter. That
   * makes id minting resumable: reloading a saved game in a fresh process
   * (a new server, after a crash) continues from exactly where it left off,
   * so a newly-minted id (a token entering play, a fresh modifier) can never
   * collide with one already baked into the save. See
   * `SpoilsEngine.nextId`/`deriveIdSeq`.
   */
  idSeq: number;

  /** The table format, fixed at setup (`classic`, `freeForAll`, `showdown`). */
  format: GameFormat;

  /**
   * Every seat in turn order, starting with the seat that took the first
   * turn. Eliminated players keep their seat here (and are skipped); the
   * order never changes after setup.
   */
  turnOrder: PlayerId[];

  players: Record<PlayerId, PlayerState>;
  cards: Record<CardInstanceId, CardInstance>;

  /** Showdown's shared table state; present exactly when `format.kind === "showdown"`. */
  showdown?: ShowdownState;

  modifiers: RuntimeModifier[];
  /** Standing "this turn" stat changes over a selector's cards (`createAreaModifier` — Rasputin Unleashed). */
  areaModifiers: RuntimeAreaModifier[];
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
   * Set while the active player's turn is ACTUALLY ending (CR 610.1a): the
   * end-of-turn triggers and delayed effects are being resolved, and the turn
   * passes once they are done (including any choices they ask for).
   */
  endingTurnFor?: PlayerId;

  /**
   * Set while a turn's start-of-turn triggers (CR §602.2 — including the
   * faction's Restore Rule and Develop Rule) are still resolving: the "at the
   * start of your next turn" delayed effects wait until they have settled.
   */
  startingTurnFor?: PlayerId;

  /**
   * Runtime "all inflicted damage is reduced to 0" windows from a
   * `preventAllDamage` effect (Limited Liability). While any is active,
   * every `dealDamage` / battle-damage assignment resolves to 0. Swept by
   * `durationStillActive`.
   */
  damagePreventionWindows: Array<{ id: ModifierId; duration: Duration; createdTurn: number; exceptCosts?: boolean; battleOnly?: boolean; sourceId?: CardInstanceId }>;

  /**
   * Runtime "cards can only be destroyed by costs" windows from a
   * `restrictDestruction` effect (Limited Liability). While any is active,
   * the `destroy` effect is a no-op (cost / lethal-damage / removeFromGame
   * paths are unaffected). Swept by `durationStillActive`.
   */
  destructionRestrictionWindows: Array<{ id: ModifierId; duration: Duration; createdTurn: number; sourceId?: CardInstanceId }>;

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
   * Present exactly while the seats are swapped (an odd number of live
   * `ContinuousAbility.swapsSides` sources are in play — Emergency
   * Obfuscation). `checkStateBasedActions` applies and lifts the swap, so it
   * takes effect the moment the card enters play and ends the moment it
   * leaves. Absent otherwise.
   */
  seatSwap?: SeatSwapState;

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
   * Durationed "this turn, <blocker> must block <attacker> if it can"
   * grants from a `requireBlock` effect. `blockerId` absent = every
   * character able to block `attackerId`. Consulted in `declareBlockers`;
   * swept by `durationStillActive`.
   */
  mustBlockGrants: Array<{
    id: ModifierId;
    sourceId: CardInstanceId;
    attackerId: CardInstanceId;
    blockerId?: CardInstanceId;
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
    /** The card whose effect granted it (Cheats, Pant Swipe, ...), when known. */
    sourceId?: CardInstanceId;
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

  /**
   * Per-turn count of how many separate attacks each player has *declared*
   * this turn, keyed by `PlayerId`. Reset at the start of every turn. Read
   * by `ContinuousAbility.attackLimitPerTurn` ("players can attack only once
   * each turn" — Narrow Passage).
   */
  attackDeclarationsThisTurn: Record<string, number>;

  /** Fully serializable response/stack state for UI, replay, or networking. */
  responseStack: StackItem[];
  responseWindow?: ResponseWindowState;

  /**
   * Running, human-readable log of everything that has happened, in order —
   * every emitted event plus a couple of structural markers, each tagged
   * with the response-stack `depth` it occurred at so a renderer can show
   * responses (and responses to responses) nested under what they answer.
   * Informational only; no rule reads it. Recording can be turned off with
   * `SpoilsEngine.setLogEnabled(false)`. See `GameLogEntry`.
   */
  gameLog: GameLogEntry[];

  /** Suspended effect-list resumption points — see PendingEffectFrame. Only the top of the stack is "live." */
  pendingEffectFrames: PendingEffectFrame[];

  battle?: BattleState;

  /**
   * Set once the game is over: the last player standing (or, in Showdown,
   * the last side standing) won, or the last players fell together (a
   * draw). Players knocked out earlier carry `PlayerState.eliminated`.
   */
  result?: GameResult;

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
    /**
     * A coin flipped as a VARIABLE roll while a card is played (`coinFlip` expression, Hammer Smash): once the
     * flip is settled, `rollId` gets `winValue` / `loseValue` in `then.variables` and `then` (the pick prompt the play
     * was about to open) is opened.
     */
    then?: PendingChoice;
    rollId?: string;
    winValue?: number;
    loseValue?: number;
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
    /** A runtime replacement's `selected` snapshot (its picks stay readable). */
    selected?: Record<string, CardInstanceId[]>;
    /** Identifies the replacement for CR 506.5 (each applies at most once to the same thing). */
    key?: string;
    /** For a replaced destruction: the card whose effect destroys it, and whether lethal damage does (CR 506.6). */
    causeSourceId?: CardInstanceId;
    byLethalDamage?: boolean;
  };

  /**
   * The continuation for an outstanding CR 506.4 pick (paired with a
   * `pendingChoice` of kind `"chooseReplacement"`): the replaced event, who
   * caused it, and the key of each offered replacement in `options` order.
   */
  pendingReplacementPick?: {
    affectedCardId: CardInstanceId;
    trigger: ReplacementTrigger;
    scope: "all" | "attached" | "runtime";
    keys: string[];
    /** The cause bookkeeping the replaced event was running under. */
    cause?: PlayerId;
    causeSourceId?: CardInstanceId;
    byBattleDamage: boolean;
    byLethalDamage: boolean;
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
   * Per-turn list of the face-up cards destroyed so far this turn, in order
   * (pushed when the `cardDestroyed` event is emitted): the card, every card
   * type it had at that moment (a `setCardType` grant is gone once it leaves
   * play) and the player who controlled it. Reset at the start of every turn.
   * Read by the `destroyedThisTurn` expression ("X is the number of
   * characters that were destroyed this turn").
   */
  turnDestroyed: Array<{
    cardId: CardInstanceId;
    types: CardType[];
    controllerId: PlayerId;
  }>;

  /**
   * Every tactic played this turn, oldest first (pushed the moment a tactic
   * is played, so one still on the stack counts). The `lastDeployedTactic`
   * TargetRef reads the most recent one other than the card resolving it.
   * Cleared at the start of each turn.
   */
  tacticsPlayedThisTurn?: CardInstanceId[];

  /**
   * The chosen variables (X) each tactic in `tacticsPlayedThisTurn` was
   * played with, so a duplicate made after it resolved (Voidal Replication,
   * Ectypal Stave) copies the same X and pays the same X-based extra costs.
   * Cleared at the start of each turn.
   */
  tacticPlayVariables?: Record<CardInstanceId, Record<string, number>>;

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
   * Per-player record of who inflicted damage to whose faction this turn:
   * inflicting player (the damage source's controller when the damage was
   * dealt) -> the players whose faction they damaged. Unlike
   * `damageThisTurn` it does not depend on the source card still existing
   * (a token is deleted when it leaves play). Populated from `damageDealt`
   * events in `emit`, reset at the start of every turn. Read by the
   * `playerInflictedDamageToFactionThisTurn` condition.
   */
  factionDamageInflictedThisTurn: Record<PlayerId, PlayerId[]>;

  /**
   * Per-player influence the faction has actually LOST so far this turn,
   * whatever the cause: damage inflicted to it (battle or effect, CR 408.3 /
   * 202.4), a `modifyInfluence` effect with a negative amount, an influence
   * cost, a redirect. It is the amount after every `influenceModifiers`
   * ability (Tax Attorney) and after the floor at 0 (CR 410.4), so a loss that
   * was reduced to nothing, or that hit a faction already at 0, is not
   * recorded; a gain, and a `setInfluence` effect, never are. Absent / 0 = no
   * loss. Reset at the start of every turn. Read by the
   * `lostInfluenceThisTurn` condition.
   */
  influenceLostThisTurn: Record<PlayerId, number>;

  /**
   * Per-player turn NUMBERS whose faction Restore Rule is skipped entirely
   * ("on your next turn, skip your faction's RESTORE RULE" — Monstrous
   * Lassitude). Two copies naming the same turn skip it once (Q32); entries
   * are dropped as their turn starts.
   */
  restoreRuleSkips: Record<PlayerId, number[]>;

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
