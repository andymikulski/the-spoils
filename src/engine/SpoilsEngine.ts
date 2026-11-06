// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

import type {
  AbilityDefinition,
  AbilityId,
  ActivatedAbility,
  BattleDamageAssignment,
  BattleId,
  BattleRound,
  BattleSide,
  BattleState,
  BattleView,
  CardCatalogEntry,
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  AttackOptions,
  AttackTarget,
  BlockOptions,
  CardPlayability,
  CardPlayBlock,
  FlipUpBlockedBy,
  FlipUpPlayability,
  ActivatedAbilityStatus,
  AbilitySuppressionSource,
  ActiveProtection,
  ActiveProtectionDuration,
  KeywordGrantSource,
  ProvenanceKind,
  RestrictionSource,
  StatModifierEntry,
  OutsideHandPlay,
  PendingDelayedEffect,
  PlayerEffect,
  DelayedEffectWhen,
  ScheduledEffect,
  AbilityUnavailableReason,
  CostAffordability,
  CostAffordabilityContext,
  MulliganPreview,
  NameValueCheck,
  ResourcePlayFaces,
  CreatedAbilitySpec,
  CardSelector,
  CardType,
  Condition,
  Cost,
  NumericCostAdjust,
  CostAnswer,
  DevelopChoice,
  Duration,
  Effect,
  EffectOption,
  FactionDefinition,
  GameAction,
  GameEvent,
  GameFlowView,
  GameLogEntry,
  GameLogKind,
  GameState,
  GameStateSnapshot,
  Keyword,
  NumberExpression,
  PendingChoice,
  PendingEffectFrame,
  PlayerId,
  PlayerRef,
  PlayerState,
  ResolutionContext,
  ReplacementTrigger,
  ResourceIcon,
  ResponseContinuation,
  ResponseWindowKind,
  ResponseWindowState,
  GameResult,
  PlayerElimination,
  Restriction,
  RuntimeCostReduction,
  RuntimeModifier,
  SeatSwapState,
  SnapshotCard,
  SnapshotPlayer,
  StackItem,
  StartingResourceChoice,
  FirstPlayerChoice,
  Stat,
  TargetDeclaration,
  TargetRef,
  TokenSpec,
  Threshold,
  TriggerResolution,
  Zone
} from "../types/index.js";
import {
  assert,
  compare,
  declinedKey,
  deriveIdSeq,
  isStapleResourceDefinition,
  parseThreshold,
  startingStaplesMustDiffer,
  withBuiltInFactionDefaults
} from "./utilities.js";
import { cardTextToPlain } from "../cardText.js";
import { buildCreatedAbility } from "./createdAbility.js";
import { drawRandom, randomSeed } from "./rng.js";
import { resolveGameFormat, startingOpponentCountsOf } from "./setup.js";
import { getLoyalty, heroesOf, isHero, revealAllAllegiances, villainOf } from "./showdown.js";
import { conditionNodeRefersToOpponent, opponentRefsOf } from "./opponentRefs.js";
import {
  isLiving,
  isOpponentOf,
  livingSeats,
  nextLivingSeat,
  opponentsOf,
  otherLivingSeats
} from "./seating.js";
import type {
  DeclarationRequirement,
  PickStep,
  PlayAction,
  PlayRequirement,
  SelectionCheck,
  SelectionRequirementsInput
} from "./playRequirements.js";
// Call-time-only cycle: factionSetup.ts imports SpoilsEngine for its own
// construction path; this back-edge is used solely inside a method body, well
// after both modules have finished evaluating.
import {
  continueSetupAfterFirstPlayer,
  continueStartingDrawSearch,
  finishFactionSetup,
  openingDrawFor,
  startingSlotPlan
} from "./factionSetup.js";

/** Every keyword `getKeywords` / `getKeywordGrantSources` report on. */
const ALL_KEYWORDS: readonly Keyword[] = [
  "tactical",
  "aggro",
  "covert",
  "cannotBeBlocked",
  "redirectDamage",
  "forceRedirectDamage",
  "canBlockCovert",
  "canBlockAnyParty"
];

/** Every restriction `getRestrictions` / `getRestrictionSources` report on. */
const ALL_RESTRICTIONS: readonly Restriction[] = [
  "cannotAttack",
  "cannotBlock",
  "mustAttack",
  "mustBlock",
  "cannotBeRestored",
  "cannotBeRestoredByRule",
  "cannotBePicked",
  "cannotBePickedByOpponents",
  "mustBePicked",
  "attackOncePerTurn",
  "cannotBeTakenControl"
];

/** Plain printed text of a `markup` string (parsed once), for `textMentionsIcon`. */
const MARKUP_PLAIN_TEXT = new Map<string, string>();

/**
 * A card's printed rules text for the `textMentionsIcon` condition: its audited
 * `markup` projected to plain text (reminder text, ability COST / EFFECT
 * parts and `[X]` icon gates included). A definition without `markup` (a
 * synthetic fixture card) falls back to its `text`.
 */
function printedText(definition: CardDefinition): string {
  if (definition.markup === undefined) return definition.text ?? "";
  let plain = MARKUP_PLAIN_TEXT.get(definition.markup);
  if (plain === undefined) {
    plain = cardTextToPlain(definition.markup);
    MARKUP_PLAIN_TEXT.set(definition.markup, plain);
  }
  return plain;
}

/** Key of the `CostAnswer` that records how many cost steps a paused play already paid (see `payCosts`). */
const COST_COMMITTED_KEY = "__committed";

/** Reserved target-declaration id for an "Attach to X" card's play-time target. */
export const ATTACH_TARGET_ID = "attachTo";

/** The resource icons a `nameValue` of kind `resourceIcon` may name (staples plus Volition). */
/** Ability ids of the faction's start-of-turn rule triggers (`factionStartTriggers`). */
export const RESTORE_RULE_ABILITY_ID = "restoreRule";
export const DEVELOP_RULE_ABILITY_ID = "developRule";
/** Prefixes of the ids of the faction's printed start-of-turn / end-of-turn effect triggers (suffixed `:<index>`). */
export const FACTION_START_EFFECT_ABILITY_ID = "factionStartEffect";
export const FACTION_END_EFFECT_ABILITY_ID = "factionEndEffect";

const NAMEABLE_ICONS = ["rage", "greed", "deception", "elitism", "obsession", "volition"];

/** The trades a `nameValue` of kind `trade` may name. */
const NAMEABLE_TRADES = ["arcanist", "banker", "gearsmith", "rogue", "warlord", "universal"];

/** True when a number expression (or anything nested in it) would roll: a `random` / `coinFlip` number, or a `random` target. */
function expressionRolls(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(expressionRolls);
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === "random" || record.type === "coinFlip") return true;
    return Object.values(record).some(expressionRolls);
  }
  return false;
}

/** True when a condition tree contains a condition of `type` anywhere (under `and` / `or` / `not` included). */
function conditionMentions(node: unknown, type: string): boolean {
  if (Array.isArray(node)) return node.some(child => conditionMentions(child, type));
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === type) return true;
    return Object.values(record).some(child => conditionMentions(child, type));
  }
  return false;
}

/** Whether `node` (plain card data) carries the property `key` anywhere inside it. */
function objectMentionsKey(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return node.some(child => objectMentionsKey(child, key));
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (key in record) return true;
    return Object.values(record).some(child => objectMentionsKey(child, key));
  }
  return false;
}

/** The conditions a condition tree requires all at once: itself, or the members of a (nested) `and`. */
function conditionConjuncts(condition: Condition | undefined): Condition[] {
  if (!condition) return [];
  return condition.type === "and" ? condition.conditions.flatMap(conditionConjuncts) : [condition];
}

type IgnorableTriggerKind = NonNullable<
  Extract<AbilityDefinition, { type: "continuous" }>["ignoresTriggers"]
>[number];

/**
 * Which "ignore these triggers" kind (`ContinuousAbility.ignoresTriggers`) a triggered ability is, if any: a trigger
 * that begins "when this card enters play" (`cardEnteredPlay` requiring `sourceIsEventCard`) or "when this card leaves
 * play" (`cardMoved` requiring `sourceIsEventCard` and `cardMovedFromZone: play`, with no destination named).
 */
function ignorableTriggerKind(
  ability: Extract<AbilityDefinition, { type: "triggered" }>
): IgnorableTriggerKind | undefined {
  if (ability.triggerFromAnyZone || (ability.triggerZone ?? "play") !== "play") return undefined;
  // A combined printed "When this card enters or leaves play" begins with neither quoted phrase.
  if (ability.printedLead !== undefined) return undefined;
  const parts = conditionConjuncts(ability.condition);
  if (!parts.some(part => part.type === "sourceIsEventCard")) return undefined;
  if (ability.event === "cardEnteredPlay") return "thisCardEntersPlay";
  if (
    ability.event === "cardMoved" &&
    parts.some(part => part.type === "cardMovedFromZone" && part.zone === "play") &&
    !parts.some(part => part.type === "cardMovedToZone")
  ) {
    return "thisCardLeavesPlay";
  }
  return undefined;
}

/** The block a play reads its costs, targets, condition, variables and effects from (a tactic's play source, a non-tactic's `onPlay`). */
interface PlaySourceBlock {
  condition?: Condition;
  costs?: Cost[];
  costAdjust?: NumberExpression;
  targets?: TargetDeclaration[];
  variables?: Record<string, NumberExpression>;
  variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
  effects?: Effect[];
}

/** What a play reads its picks, costs and numbers from (`playBlockOf`). */
interface PlayBlockInputs {
  source: PlaySourceBlock | undefined;
  rolls: Record<string, NumberExpression> | undefined;
  bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined;
  abilityId: AbilityId | undefined;
  /** Who the play is paid and judged as (the card's controller, for a borrowed ability). */
  controllerId: PlayerId;
  declarations: TargetDeclaration[];
  costs: Cost[];
}

/** Reserved `variables` key: the answer (1 = face-down) to the face-up / face-down question of a resource a FLIP UP line plays. */
const RESOURCE_FACE_DOWN_VARIABLE = "__resourceFaceDown";

/**
 * A cost step (a `pick` made after earlier costs, a `nameValue`) refused the play: its own message is the
 * reason shown, instead of the generic "Costs cannot be paid." (see `assertCostsPayable`).
 */
class CostRefusal extends Error {}

/** Thrown on the probe of `getPaymentOptions` the moment the play reaches its real "Pay N": the answer is already recorded. */
class PaymentCaptured extends Error {}

/**
 * Thrown where mandatory effects are found to repeat without end (CR 414.1):
 * it unwinds the whole resolution to `perform`, which ends the game as a draw.
 */
class EndlessLoopError extends Error {}

/** How many trigger resolutions may be nested inside one another before they count as an endless loop. */
const MAX_TRIGGER_NESTING = 200;

/**
 * Key prefix, in `GameState.abilityUsesThisTurn`, of the per-turn use counts
 * of triggered abilities with `usesPerTurn` (`<prefix><cardId>:<abilityId>`).
 * Separate from an activated ability's `<cardId>:<abilityId>` so a card
 * entering play (a new object) can forget its triggers' uses without touching
 * its activated abilities.
 */
const TRIGGER_USES_PREFIX = "trigger:";

/** What a player chooses when paying a play's, ability's or FLIP UP's numeric cost ("Pay N"): see `getPaymentOptions`. */
export interface PaymentOptions {
  /** How many resources the cost takes (every increase and reduction already applied). */
  amount: number;
  /** The unattached resources that may pay it. For a FLIP UP this includes the card being flipped, when it is one. */
  candidates: CardInstanceId[];
}

/** Bracketed rules-text token for each resource icon (`[V]` etc.) — used by the `textMentionsIcon` condition. */
const ICON_TEXT_TOKEN: Record<ResourceIcon, string> = {
  rage: "[R]",
  greed: "[G]",
  deception: "[D]",
  elitism: "[E]",
  obsession: "[O]",
  volition: "[V]"
};

/**
 * Single-target mutating effects that "an effect from an ignored card type"
 * must not apply to its target (Parkour Hoodlum — `ignoresRulesTextFrom`).
 * Deliberately excludes effects whose `target` is a not-yet-in-play card
 * (`playResource`, `putIntoPlay`, `deployFromZone`) or a stack item
 * (`terminate`, `duplicate`) — the guard would be a harmless no-op there
 * anyway, since the check requires an in-play, face-up target.
 */
const SOURCE_CLASS_GUARDED_EFFECTS = new Set<Effect["type"]>([
  "dealDamage",
  "destroy",
  "deplete",
  "restore",
  "moveCard",
  "flipFaceDown",
  "addCounter",
  "removeCounter",
  "createModifier",
  "takeControl",
  "grantKeyword",
  "grantRestriction",
  "grantProvides",
  "setDamage",
  "setCardType",
  "removeCardType",
  "modifyNumericCost",
  "preventDamage",
  "detach",
  "setRestoreLock",
  "skipNextRestore",
  "attachTo"
]);

/** One damage step's assignments to a single target (see `SpoilsEngine.battleDamageGroups`). */
interface BattleDamageGroup {
  target: BattleDamageAssignment["target"];
  /** The in-play card the modifier lookup / damage / triggers hang off — the faction card itself for a faction target (CR §408.3). */
  cardId: CardInstanceId | undefined;
  contributors: BattleDamageAssignment[];
}
type BattleDamageGroups = Map<string, BattleDamageGroup>;

export class SpoilsEngine {
  readonly definitions: Record<CardDefinitionId, CardDefinition>;
  readonly state: GameState;

  readonly immediateQueue: TriggerResolution[] = [];

  /**
   * Event batches delay triggered-ability execution until a simultaneous group
   * of mutations is complete. Battle damage uses this so one damage event
   * cannot interrupt another member of the same speed group.
   */
  private eventBatchDepth = 0;

  /**
   * Whether `emit()` and the flow markers append to `state.gameLog`. On by
   * default; `setLogEnabled(false)` turns recording off (the already-recorded
   * entries stay). Not serialized — it's an engine-run setting, not game
   * state.
   */
  private logEnabled = true;

  /**
   * Whose vantage a log line is being described from: `undefined` names
   * every card (the entry's own `message`), `null` is public information
   * only, a player id is that player's view. See `describeEventFor`.
   */
  private logViewer: PlayerId | null | undefined;

  /** The line being described named a hidden card (hand, deck, face-down) — so it gets per-vantage `redacted` lines. */
  private logNamedHidden = false;

  /**
   * A game-log line is being described. Only then does an all-seeing
   * `logCardName` name a face-down card; its other readers (the pending
   * delayed-effect descriptions) keep it anonymous.
   */
  private logDescribing = false;

  /** The replacements (by key) currently running their effects against a card: CR 506.5 — each applies at most once to the same thing, so a replacement already in a card's chain is not offered again for it. */
  private readonly appliedReplacements = new Map<CardInstanceId, Set<string>>();

  /**
   * Damage each card has taken, tallied per source (key: the source card id,
   * `""` when unknown), so a replaced destruction can reduce only the damage
   * from the source of that destruction (CR 506.6). `last` is the source(s) of
   * the most recent damage. Starts afresh whenever the card holds no damage.
   */
  private readonly damageSources = new Map<
    CardInstanceId,
    { bySource: Map<string, number>; last: Set<string> }
  >();

  /** The card the state check is destroying because of lethal damage right now; the source of that destruction is whoever dealt the last damage. */
  private destroyingByLethalDamage: CardInstanceId | undefined;

  /** Guards continuous keyword/restriction resolution against a self-
   * referential grant — e.g. "while a player controls a COVERT character,
   * this gains COVERT" (Torchlight Sarcophyle): evaluating the grant's
   * condition counts COVERT characters, which re-asks whether cards (incl.
   * the grant's own source) have COVERT, which re-evaluates the same grant.
   * Keyed by `${sourceId}:${abilityId}` of the continuous ability whose
   * condition/binding is currently being evaluated; a re-entrant hit skips
   * that ability (it can't bootstrap off its own evaluation). Cross-ability
   * chains (A's grant depends on B's *different* grant) still resolve. */
  private readonly resolvingContinuousGrant = new Set<string>();

  /**
   * Answers to `hasKeyword` within one top-level keyword read, keyed by the
   * set of continuous abilities `resolvingContinuousGrant` is guarding, the
   * card, and the keyword. With several abilities whose conditions read
   * keywords (Torchlight Sarcophyle copies), the guarded recursion re-asks the
   * same sub-question once per *ordering* of those guards — factorial in
   * copies. The answer depends only on the guard *set*, so it's computed once.
   * The memo exists only while a read is running (reads don't mutate state)
   * and is dropped when the outermost read returns.
   */
  private keywordReadMemo: Map<string, boolean> | undefined;

  /**
   * The opt-in "read scope" memo (see {@link withReadMemo}): derived reads that scan the whole board
   * (`getThresholds`, `getStat`, the continuous modifier / keyword / restriction scans, `hasKeyword`,
   * `getActiveProtections`) keep their answer here, keyed by table + arguments + the re-entrancy guard
   * set the read ran under. `undefined` outside a scope, so nothing is ever cached by default.
   *
   * Why it is safe: those reads are pure functions of `state` (+ the guard sets below), so between two
   * mutations the same question has the same answer. Every engine mutation path (`perform`,
   * `startGameAfterSetup`, `applyCreatedFactionAbility`, `resolveEffect`, `emit`) drops the memo, so an
   * action performed inside a scope simply turns memoizing off for the rest of it. The memo is an
   * instance field: `cloneForProbe` / a bot's `new SpoilsEngine(...)` start with none, and a state
   * loaded into a new engine never sees an old one. It is *not* automatic because `engine.state` is a
   * public mutable object (tests and hosts poke it directly); only the caller of `withReadMemo` knows
   * it will not.
   */
  private readMemo: Map<string, unknown> | undefined;

  /** Above 0 while `withCardFaceUp` has a face-down card temporarily face-up: the state is hypothetical, so nothing is cached. */
  private hypotheticalDepth = 0;

  /**
   * Runs `read` with the per-version read memo on (nested calls share the outer scope). The caller
   * promises not to mutate `engine.state` directly inside `read`; `perform` and the other engine
   * mutators end the memo themselves.
   */
  withReadMemo<T>(read: () => T): T {
    if (this.readMemo) return read();
    this.readMemo = new Map();
    try {
      return read();
    } finally {
      this.readMemo = undefined;
    }
  }

  /**
   * `compute()`, or its memoized answer while a read scope is open and the engine is not in a context-
   * dependent state: a hypothetical face-up card, a `thresholdExcludedCard`, or an area-modifier read
   * in progress (whose cycle-break changes nested answers). The `resolvingContinuousGrant` guard set
   * is part of the key, the same way `keywordReadMemo` keys it. A throw is not cached.
   */
  private scopedRead<T>(table: string, key: string, compute: () => T): T {
    const memo = this.readMemo;
    if (
      !memo ||
      this.hypotheticalDepth > 0 ||
      this.thresholdExcludedCard !== undefined ||
      this.areaModifierReads.size > 0
    ) {
      return compute();
    }
    const full =
      this.resolvingContinuousGrant.size === 0
        ? `${table}|${key}`
        : `${table}|${[...this.resolvingContinuousGrant].sort().join(",")}|${key}`;
    if (memo.has(full)) return memo.get(full) as T;
    const answer = compute();
    // `compute` may have ended the scope (it never should for a read, but never store into a dropped memo).
    if (this.readMemo === memo) memo.set(full, answer);
    return answer;
  }

  /**
   * The player currently *causing* mutations — the controller of the effect
   * being resolved, or the player who dealt the battle damage. Read by
   * `applyReplacement` to honor `ReplacementAbility.replaces.by` ("destroyed
   * by an opposing card or effect"). `undefined` when nothing is driving
   * (e.g. a state-based check with no preceding effect), which never
   * satisfies a scoped `by: "self" | "opponent"`.
   */
  private currentCause: PlayerId | undefined;

  /** The card whose effect is driving `currentCause`, when there is one. Read for `replaces.bySource`. */
  private currentCauseSourceId: CardInstanceId | undefined;

  /**
   * Per-card "who last dealt it damage" — set while battle damage is
   * applied (which happens outside `resolveEffect`, so the `currentCause`
   * hook there doesn't cover it), read by `checkStateBasedActions` so a
   * character dying to *lethal battle damage* attributes the destruction to
   * the attacker/blocker that dealt it. Non-battle `dealDamage` is already
   * covered by the `resolveEffect` cause hook.
   */
  private readonly lethalDamageCause = new Map<CardInstanceId, PlayerId>();
  /**
   * The card whose destruction (by lethal BATTLE damage) is being checked
   * for replacements right now — lets the `destroyedByBattleDamage`
   * condition answer before any `cardDestroyed` event exists.
   */
  private destroyingByBattleDamage: CardInstanceId | undefined;
  /**
   * The effect that follows the one being resolved in its list (set by
   * `runEffectFrame` / `if`): lets a `putIntoPlay` of an ATTACH TO card see
   * that the very next effect attaches it to its host ("put it into play, then
   * attach it to X"), so the engine doesn't also ask for a host (CR 507.2b).
   */
  private followingEffect: Effect | undefined;
  /** Cards the state check destroyed because of lethal damage; cleared when a `dealDamage` effect next targets the card (`destroyedByDamage`). */
  private readonly destroyedByDamage = new Set<CardInstanceId>();

  /**
   * Snapshot of a card's `attachedTo` / `linkedTargets` taken the instant it
   * leaves play, so a "when this card leaves play" trigger resolving later
   * in the same action (queued behind an event batch) can still read
   * `"attachedTo"` / `{ remembered }`. Cleared at the top of every
   * `perform()`.
   */
  private readonly departedLinks = new Map<
    CardInstanceId,
    { attachedTo?: CardInstanceId; linkedTargets?: Record<string, CardInstanceId> }
  >();

  /**
   * Abilities a card had copied onto it (Skin Suit's snapshot grants) when it
   * left play, so its own "leaves play / is destroyed" triggers can still be
   * found for the event that took it out. Cleared at the top of every
   * `perform()`, like `departedLinks`.
   */
  private readonly departedAbilityGrants = new Map<
    CardInstanceId,
    AbilityDefinition[]
  >();

  /**
   * Last-known stats of cards that left play, captured the instant they
   * left (CR last-known information). Read only by a `stat` expression
   * targeting the event card while that card is out of play — "a character
   * with less strength than that character had" (Gosche's Restoration
   * Fortress), whose self-buffs no longer apply once it has left.
   */
  private readonly lastKnownCounters = new Map<CardInstanceId, Record<string, number>>();

  /**
   * Counters on `cardId` for a rules read: the live counters while it is in
   * play, the last-known counters it had in play once it has left. Counters
   * themselves are wiped when a card leaves play (CR 409.2), but "a character
   * with a token that leaves play" (Gosche's cards) and a self-destroying
   * cost followed by "X is the number of tokens on it" (Runic Distribulator)
   * still see what it had. Forgotten when the card enters play again.
   */
  private counterCountFor(
    cardId: CardInstanceId,
    counter: string
  ): number {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play") {
      const known = this.lastKnownCounters.get(cardId);
      if (known) return known[counter] ?? 0;
    }
    return card?.counters?.[counter] ?? 0;
  }

  private readonly lastKnownStats = new Map<CardInstanceId, Record<"strength" | "life" | "speed" | "structure", number>>();

  /**
   * Who controlled a card in play at the instant it left (CR last-known
   * information). A card outside play is controlled by its holder, so "that
   * character's controller" read after the card was destroyed ("destroy that
   * character. That character's controller's faction gains X", Caboodling
   * Gladhander) would otherwise see the owner. Forgotten when the card enters
   * play again.
   */
  private readonly lastKnownController = new Map<CardInstanceId, PlayerId>();

  /**
   * Last-known information for token instances that have ceased to exist.
   * A token leaving play is deleted from `state.cards` outright (see
   * `moveCard`), but the `cardDestroyed` / `cardMoved` event about it is
   * emitted *after* that — so a trigger whose condition inspects the event
   * card ("when a character an opponent controls is destroyed": Octo-Ba-Ba,
   * the Devourer) would otherwise read a card that is no longer there and
   * throw, stalling the battle mid-resolution. Only `getDefinition` and the
   * `eventCardControlledBy` condition consult it (reads of what the token
   * *was*); nothing else treats a departed token as present. Kept for the
   * whole game rather than per-`perform()`, since a queued trigger can
   * resolve in a later action.
   */
  private readonly departedTokens = new Map<CardInstanceId, CardInstance>();

  /**
   * Cards whose `faceDown` flag a caller cleared *before* the `moveCard`
   * that takes them out of play — i.e. `deployCard` flipping a face-down
   * resource face-up to deploy it (CR §411.3). `moveCard` ORs this into the
   * `cardMoved` event's `faceDown` snapshot so the departing resource is
   * still recognised as having had no rules text (its "leaves play" trigger
   * stays suppressed). Cleared at the top of every `perform()`.
   */
  private readonly faceDownDeparture = new Set<CardInstanceId>();
  /**
   * Cards that entered play during the current top-level action (and the
   * choice answers continuing it). The UNIQUE rule treats a removed *new*
   * copy as never having entered play (user ruling Q53 follow-up).
   */
  private readonly recentlyEntered = new Set<CardInstanceId>();
  /**
   * A new UNIQUE copy being removed by the rule: its departure (destroyed /
   * leaves play) raises no triggers — its own or anyone else's — because it
   * never entered play.
   */
  private readonly silentDepartures = new Set<CardInstanceId>();
  /**
   * The copies a `uniqueSurvivor` answer is destroying right now: they no
   * longer count as controlled copies, so destroying the first of several
   * does not open a second question over the rest (CR 507.5a).
   */
  private readonly uniqueDoomed = new Set<CardInstanceId>();
  /**
   * Extra copies whose Unique destruction an effect replaced, with that
   * effect's source. Unique does not try to destroy such a copy again while
   * the source is still there (CR 507.5b).
   */
  private readonly uniquePrevented = new Map<CardInstanceId, { cardId?: CardInstanceId; runtimeId?: string }>();
  /** The source of the replacement that most recently took over an event in `applyReplacement`. */
  private lastReplacer: { cardId?: CardInstanceId; runtimeId?: string } | undefined;

  /**
   * The `{ sourceId, abilityId }` of the ability most recently removed from
   * the response stack by a `terminate` this action — a fallback so
   * `respondedAbilitySource` / `lockAbilityThisTurn "respondedAbility"` still
   * resolve after "Terminate the ability. Destroy the character / It cannot
   * be used again this turn." (Exploding Sock Puppet!, Subsection 5).
   * Cleared at the top of every `perform()`.
   */
  private lastTerminatedAbility:
    | { sourceId: CardInstanceId; abilityId: AbilityId }
    | undefined;

  /**
   * The card most recently removed from the response stack by a `terminate`
   * this action — the `kind: "card"` parallel of `lastTerminatedAbility`, so
   * `respondedToCard` still resolves after "Terminate the card, then <do
   * something with its owner>." (Voidal Interference). Cleared each `perform()`.
   */
  private lastTerminatedCard: CardInstanceId | undefined;

  /**
   * A permanent's `behavior.onPlay` EXTRA-COST target picks, keyed by card
   * id, kept alive across the `cardEnteredPlay` emit so that card's *own*
   * `cardEnteredPlay` triggered ability (a separate `behavior.abilities`
   * entry, not `onPlay.effects`) can still read `selected["<onPlay pick id>"]`
   * — "EXTRA COST: pick a card. When this card enters play, remove a token
   * from it." (Abecedarian Investor). Cleared right after that emit resolves.
   */
  private entrySelections: Record<
    CardInstanceId,
    Record<string, CardInstanceId[]>
  > = {};
  private entryPickZones: Record<CardInstanceId, Record<CardInstanceId, Zone>> = {};

  /**
   * Explicit override for `random`, as passed to the constructor. Threaded
   * through to `canPayCosts`'s simulate-on-a-clone probe so a test's
   * scripted sequence applies there too — `undefined` (the production
   * default) instead lets that probe derive its own stream from the clone's
   * own `rngState`, so a dry-run affordability check can never advance the
   * real game's RNG.
   */
  private readonly randomOverride?: () => number;

  /** Backs `shuffleDeck` and any random-valued expression/target. Defaults to the seeded, serializable stream on `state.rngState`. */
  private readonly random: () => number;

  /**
   * Optional list of real cards (name + type), supplied by the host app. Only
   * used to validate "name a non-resource card"; without it any text is
   * accepted. Not part of the saved state: pass it again after a load.
   */
  private cardCatalog?: CardCatalogEntry[];

  /**
   * The card being played right now (CR 604.1: it is in Being Deployed, not in the hand or wherever it came from,
   * before any cost is paid). While set, `queryCards` skips it, so a cost or pick can never use the card being
   * played ("discard a character" cannot discard this one). Cleared as soon as the costs are paid.
   */
  private beingDeployedId?: CardInstanceId;

  /** Above 0 while an `effects` cost step runs: nobody can be asked a question, so a lost coin flip offers no replacement (Two-Headed Coin). */
  private costEffectDepth = 0;

  /** True on the throw-away clone that rehearses a payment (see `costProblem`): prompts are not raised there. */
  private dryRun = false;

  /**
   * The resources the player named to pay the running action's numeric cost (`payWith`), and the card that action
   * belongs to. Taken by the first "Pay N" of that card's own cost (`takePayWith`) so nothing later in the
   * resolution can spend them.
   */
  private payWith?: { sourceId: CardInstanceId; ids: CardInstanceId[] };

  /** Set on the probe of `getPaymentOptions`: the first real "Pay N" is recorded here and stops the run. */
  private paymentCapture?: { amount: number; candidates: CardInstanceId[] };

  /** Gives the engine a card catalog (see `cardCatalog`); `undefined` removes it. */
  setCardCatalog(catalog: readonly CardCatalogEntry[] | undefined): void {
    this.cardCatalog = catalog ? [...catalog] : undefined;
  }

  constructor(
    definitions: CardDefinition[],
    initialState: GameState,
    random?: () => number,
    cardCatalog?: readonly CardCatalogEntry[]
  ) {
    this.randomOverride = random;
    if (cardCatalog) this.cardCatalog = [...cardCatalog];
    this.random = random ?? (() => drawRandom(this.state));

    this.definitions = Object.fromEntries(
      definitions.map(def => {
        const normalized = withBuiltInFactionDefaults(def);
        return [normalized.id, normalized];
      })
    );

    this.state = initialState;

    // Normalize partially-specified states (test fixtures, hand-built saves).
    this.state.turnOrder ??= Object.keys(this.state.players);
    this.state.format ??= resolveGameFormat(this.state.turnOrder);
    this.state.startingOpponentCounts ??= startingOpponentCountsOf(this.state);
    this.state.responseStack ??= [];
    this.state.gameLog ??= [];
    this.state.setup ??= { phase: "complete" };
    this.state.started ??= true;
    this.state.rngState ??= randomSeed();
    this.state.idSeq ??= deriveIdSeq(this.state);
    this.state.turnEventTally ??= {};
    this.state.turnDeploys ??= {};
    this.state.turnDestroyed ??= [];
    this.state.damageThisTurn ??= {};
    this.state.factionDamageInflictedThisTurn ??= {};
    this.state.influenceLostThisTurn ??= {};
    this.state.restoreRuleSkips ??= {};
    this.state.resourceGrants ??= [];
    this.state.provideGrants ??= [];
    this.state.areaModifiers ??= [];
    this.state.playRestrictions ??= [];
    this.state.numericCostModifiers ??= [];
    this.state.outgoingDamageModifiers ??= [];
    this.state.thresholdReductions ??= [];
    this.state.cardTypeGrants ??= [];
    this.state.subtypeGrants ??= [];
    this.state.runtimeReplacements ??= [];
    this.state.handMoveRedirects ??= [];
    this.state.partyRestrictionGrants ??= [];
    this.state.mustBlockGrants ??= [];
    this.state.damageShields ??= [];
    this.state.battleDamageTransforms ??= [];
    this.state.voidPlayGrants ??= [];
    this.state.scheduledEffects ??= [];
    this.state.playerKeywordGrants ??= [];
    this.state.keywordSuppressions ??= [];
    this.state.abilitySuppressions ??= [];
    this.state.abilityUsesThisTurn ??= {};
    this.state.attacksThisTurn ??= {};
    this.state.attackDeclarationsThisTurn ??= {};
    this.state.damagePreventionWindows ??= [];
    this.state.destructionRestrictionWindows ??= [];

    for (const card of Object.values(this.state.cards)) {
      card.faceDown ??= false;
    }
  }

  /**
   * Mints a fresh `${prefix}_<n>` id, `n` drawn from `state.idSeq`. Backed by
   * `GameState` (not a process-global counter) so ids minted after loading a
   * saved game in a fresh process never collide with one already in the
   * save — see `GameState.idSeq`.
   */
  private nextId(prefix: string): string {
    this.state.idSeq += 1;
    return `${prefix}_${this.state.idSeq}`;
  }

  get responseStack(): StackItem[] {
    return this.state.responseStack;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  perform(action: GameAction): void {
    this.readMemo = undefined;
    try {
      this.performAndSettle(action);
    } catch (error) {
      if (!(error instanceof EndlessLoopError)) throw error;
      this.endGameAsEndlessLoop();
    }
  }

  /**
   * Set from the moment an endless loop of mandatory effects is found until
   * `endGameAsEndlessLoop` has run: nothing queued resolves meanwhile, so the
   * stack unwinds without starting the loop again.
   */
  private endlessLoopFound = false;

  /** Nesting depth of `processImmediateQueue`: reentrant trigger resolution. */
  private triggerNesting = 0;

  /**
   * CR 414.1: a series of effects that repeats without end and that neither
   * player can end ends the game as a draw. Whatever was still resolving is dropped.
   */
  private endGameAsEndlessLoop(): void {
    this.immediateQueue.splice(0);
    this.queueGuard = undefined;
    this.eventBatchDepth = 0;
    this.triggerNesting = 0;
    const state = this.state;
    state.pendingEffectFrames = [];
    state.responseStack.splice(0);
    state.responseWindow = undefined;
    state.pendingChoice = undefined;
    state.pendingPartition = undefined;
    state.pendingCoinFlip = undefined;
    state.pendingAuction = undefined;
    state.pendingReplacement = undefined;
    state.pendingReplacementPick = undefined;
    state.battle = undefined;
    this.endlessLoopFound = false;
    if (state.result) return;
    this.endGame({ outcome: "draw", winners: [] });
  }

  private performAndSettle(action: GameAction): void {
    this.performAction(action);
    {
      const setup = this.state.setup;
      if (setup.phase === "mulligan" && setup.pendingDraw && !this.state.pendingChoice) {
        this.finishMulligan(setup.pendingDraw.playerId, setup.pendingDraw.count);
      } else if (setup.phase === "startingDrawSearch" && !this.state.pendingChoice) {
        // The seat's "you may search" is answered: ask the next one, or finish setup.
        continueStartingDrawSearch(this);
      }
    }
    // A turn whose end-of-turn effects waited on a choice passes once they settle.
    this.completeTurnEnd();
    // A turn whose start-of-turn triggers waited on a choice finishes starting.
    this.completeTurnStart();
    // The turn of a player knocked out mid-turn passes once things settle.
    this.completeEliminatedTurn();
  }

  /**
   * The game-wide gates every action passes before its own checks, as the
   * refusal message (or `undefined` when the action may go on). `performAction`
   * throws it; the read-only queries (`getAttackOptions`, `getEndTurnBlock`,
   * `getFlipUpPlayability`) report it, so they cannot disagree.
   */
  private actionGateProblem(actionType: GameAction["type"]): string | undefined {
    // Once the game has ended, only let already-in-flight resolution (a
    // battle finishing, a response window closing) drain to a clean stop —
    // block anything that would start something new.
    const isDraining =
      !!this.state.responseWindow ||
      !!this.state.battle ||
      !!this.state.pendingChoice ||
      this.responseStack.length > 0;

    if (this.state.result && !isDraining) return "The game has already ended.";

    if (this.state.pendingChoice && actionType !== "resolvePendingChoice") {
      return "A pending choice must be resolved before any other action.";
    }

    if (
      this.state.setup.phase === "chooseStartingResources" &&
      actionType !== "chooseStartingResources"
    ) {
      return "Starting resources must be chosen before setup continues.";
    }

    if (this.state.setup.phase === "chooseFirstPlayer" && actionType !== "chooseFirstPlayer") {
      return "Who goes first must be chosen before setup continues.";
    }

    // A prompt a mulligan raised (Community Chest's "you may reveal it") is answered during the mulligan step.
    if (
      this.state.setup.phase === "mulligan" &&
      actionType !== "mulligan" &&
      !(actionType === "resolvePendingChoice" && this.state.pendingChoice)
    ) {
      return "Opening mulligans must be completed before play begins.";
    }

    return undefined;
  }

  private performAction(action: GameAction): void {
    // A pending-choice answer continues the action that raised the choice,
    // so "entered play during this action" must survive it.
    if (action.type !== "resolvePendingChoice") {
      this.recentlyEntered.clear();
      this.silentDepartures.clear();
    }
    this.beingDeployedId = undefined;
    this.costAnswers = {};
    this.departedLinks.clear();
    this.departedAbilityGrants.clear();
    this.faceDownDeparture.clear();
    this.lastTerminatedAbility = undefined;
    this.lastTerminatedCard = undefined;
    this.payWith =
      (action.type === "playCard" || action.type === "activateAbility" || action.type === "flipUp") &&
      action.payWith?.length
        ? { sourceId: action.cardId, ids: [...action.payWith] }
        : undefined;

    // The game-wide gates every action passes first (also read by the
    // read-only queries, `getAttackOptions` / `getEndTurnBlock` ...).
    const gateProblem = this.actionGateProblem(action.type);
    if (gateProblem) throw new Error(gateProblem);

    // Baseline "who is causing this" for replacement `by` scoping; effect
    // resolution and battle damage refine it as they go.
    if ("playerId" in action && action.playerId) {
      this.currentCause = action.playerId;
      this.currentCauseSourceId = undefined;
    }

    switch (action.type) {
      case "playCard":
        this.playCard(action);
        return;

      case "activateAbility":
        this.activateAbility(action);
        return;

      case "flipUp":
        this.flipUpCard(action);
        return;

      case "passPriority":
        this.passPriority(action.playerId);
        return;

      case "mulligan":
        this.mulligan(action.playerId, action.cardIds);
        return;

      case "chooseStartingResources":
        this.chooseStartingResources(action.playerId, action.cardIds);
        return;

      case "chooseFirstPlayer":
        this.chooseFirstPlayer(action.playerId, action.firstPlayerId);
        return;

      case "endTurn":
        this.endTurn(action.playerId);
        return;

      case "declareAttack":
        this.declareAttack(action.playerId, action.attackerIds, action.target);
        return;

      case "declareBlockers":
        this.declareBlockers(action.playerId, action.blockerIds);
        return;

      case "advanceFlow":
        this.advanceFlow();
        return;

      case "advanceBattle":
        assert(this.state.battle, "No battle in progress.");
        assert(
          action.playerId === this.state.battle.attackerPlayerId ||
          action.playerId === this.state.battle.defenderPlayerId,
          "Player is not part of this battle."
        );
        this.advanceFlow();
        return;

      case "assignBattleDamage":
        this.assignBattleDamage(action.playerId, action.assignments);
        return;

      case "resolvePendingChoice":
        this.resolvePendingChoice(action.playerId, action.choice);
        // The state-based sweep is frozen while a choice is open (so the
        // UNIQUE check below can't run mid-trigger); once the answer left
        // nothing pending, run it for whatever entered play meanwhile
        // (duplicate Crests each triggering on the other).
        if (!this.state.pendingChoice) this.checkStateBasedActions();
        return;
    }
  }

  /**
   * Single query surface intended for a UI / renderer.
   */
  getFlowView(): GameFlowView {
    let mode: GameFlowView["mode"] = "main";

    if (this.state.result) {
      mode = "gameOver";
    } else if (this.state.pendingChoice) {
      mode = "pendingChoice";
    } else if (
      this.state.setup.phase === "mulligan" ||
      this.state.setup.phase === "chooseStartingResources" ||
      this.state.setup.phase === "chooseFirstPlayer"
    ) {
      mode = "setup";
    } else if (this.state.responseWindow?.phase === "acceptingResponses") {
      mode = "response";
    } else if (this.state.responseWindow?.phase === "resolving") {
      mode = "resolvingResponses";
    } else if (this.state.battle?.phase === "finished") {
      mode = "battleFinished";
    } else if (this.state.battle) {
      mode = "battleChoice";
    }

    const battleView = this.getBattleView();

    return {
      activePlayerId: this.state.activePlayerId,
      priorityPlayerId: this.state.priorityPlayerId,
      mode,
      actingPlayerId: this.actingPlayerFor(mode, battleView),
      setup: structuredClone(this.state.setup),
      responseWindow: this.state.responseWindow
        ? structuredClone(this.state.responseWindow)
        : undefined,
      responseStack: structuredClone(this.state.responseStack),
      battle: battleView,
      result: this.state.result,
      pendingChoice: this.state.pendingChoice
        ? structuredClone(this.state.pendingChoice)
        : undefined,
      seatsSwapped: this.state.seatSwap !== undefined,
      revealed: this.getRevealedZones()
    };
  }

  /**
   * Whose decision it is in flow mode `mode` (`GameFlowView.actingPlayerId`), read from the engine's own state:
   * the setup seat, the active player, the player holding priority, the battle's acting player, the chooser of the
   * pending choice. `undefined` where the one legal action is the seat-less `advanceFlow`, and at game over.
   */
  private actingPlayerFor(mode: GameFlowView["mode"], battle: BattleView | undefined): PlayerId | undefined {
    switch (mode) {
      case "setup": {
        const setup = this.state.setup;
        return setup.phase === "mulligan" ||
          setup.phase === "chooseStartingResources" ||
          setup.phase === "chooseFirstPlayer" ||
          setup.phase === "startingDrawSearch"
          ? setup.order[setup.currentIndex]
          : undefined;
      }
      case "main":
        return this.state.activePlayerId;
      case "response":
        return this.state.responseWindow?.priorityPlayerId;
      case "battleChoice":
        return battle?.actingPlayerId;
      case "pendingChoice":
        return this.state.pendingChoice?.playerId;
      case "resolvingResponses":
      case "battleFinished":
      case "gameOver":
        return undefined;
    }
  }

  /**
   * Which players' deck-top / hand is currently public via a `grantsReveal`
   * continuous ability. Derived, renderer-facing only (RULES.md §5 — the
   * engine has perfect information and no rule keys off it).
   */
  private getRevealedZones(): GameFlowView["revealed"] {
    const deckTopFor = new Set<PlayerId>();
    const handFor = new Set<PlayerId>();
    this.forEachActiveContinuous((source, ability) => {
      const rule = ability.grantsReveal;
      if (!rule) return;
      for (const playerId of Object.keys(this.state.players) as PlayerId[]) {
        if (!this.scopeMatchesPlayer(rule.of, source.controllerId, playerId)) continue;
        (rule.zone === "hand" ? handFor : deckTopFor).add(playerId);
      }
    });
    return {
      deckTop: [...deckTopFor]
        .map(playerId => ({ playerId, cardId: this.state.players[playerId].deck[0] }))
        .filter((e): e is { playerId: PlayerId; cardId: CardInstanceId } => !!e.cardId),
      hands: [...handFor]
    };
  }

  // ---------------------------------------------------------------------------
  // Game log (RULES.md §12 "Fidelity pass" — informational only)
  // ---------------------------------------------------------------------------

  /** Turn the running game log (`state.gameLog`) on or off. Already-recorded entries are kept. */
  setLogEnabled(enabled: boolean): void {
    this.logEnabled = enabled;
  }

  /** Whether new game-log entries are currently being recorded. */
  isLogEnabled(): boolean {
    return this.logEnabled;
  }

  /** The running game log, oldest entry first. The live array — treat as read-only. */
  getLog(): readonly GameLogEntry[] {
    return this.state.gameLog;
  }

  /**
   * The game log rendered as plain text, one line per entry, indented by
   * `depth` so responses (and responses to responses) read as nested under
   * what they answer. `sinceSeq` skips everything up to and including that
   * sequence number (for tailing an in-progress game); `indent` is the
   * per-level prefix (default two spaces).
   */
  formatLog(options: { sinceSeq?: number; indent?: string } = {}): string {
    const indent = options.indent ?? "  ";
    const sinceSeq = options.sinceSeq ?? 0;

    return this.state.gameLog
      .filter(entry => entry.seq > sinceSeq)
      .map(entry => {
        const prefix = entry.kind === "turn" ? "" : indent.repeat(entry.depth + 1);
        return `${prefix}${entry.message}`;
      })
      .join("\n");
  }

  /**
   * A complete, JSON-serializable, name-resolved picture of the game right
   * now — every zone's contents, influence, and the response-stack / pending
   * choice in flight. Pairs with `getLog()` for replay and debugging tools:
   * the log says how the game got here, this says where everything stands.
   * Informational only (no rule keys off it); it carries perfect
   * information, opponent hands included.
   */
  exportState(): GameStateSnapshot {
    // Reverse index: the cards attached to each host. Scanned across every
    // card, not one play zone — an "Attach to X" item can sit on a card its
    // controller does not own (gear on an opponent's character).
    const attachmentsByHost = new Map<CardInstanceId, CardInstanceId[]>();
    for (const card of Object.values(this.state.cards)) {
      if (card.zone === "play" && card.attachedTo) {
        const list = attachmentsByHost.get(card.attachedTo);
        if (list) list.push(card.id);
        else attachmentsByHost.set(card.attachedTo, [card.id]);
      }
    }

    const nameOf = (cardId: CardInstanceId): string => {
      const card = this.state.cards[cardId];
      if (!card) return cardId;
      return this.definitions[card.definitionId]?.name ?? cardId;
    };

    const describe = (
      cardId: CardInstanceId,
      zoneOwnerId: PlayerId
    ): SnapshotCard => {
      const card = this.requireCard(cardId);
      const definition = this.getDefinition(cardId);
      const snap: SnapshotCard = {
        id: cardId,
        definitionId: card.definitionId,
        name: definition.name,
        type: definition.type
      };
      if (card.zone !== "play") return snap;

      if (card.faceDown) snap.faceDown = true;
      if (card.depleted) snap.depleted = true;
      if (card.damage > 0) snap.damage = card.damage;
      if (card.counters && Object.keys(card.counters).length > 0) {
        snap.counters = { ...card.counters };
      }
      if (this.hasCardType(cardId, "character")) {
        snap.strength = this.getStat(cardId, "strength");
        snap.life = this.getStat(cardId, "life");
      }
      if (card.attachedTo) {
        snap.attachedTo = { id: card.attachedTo, name: nameOf(card.attachedTo) };
      }
      const attached = attachmentsByHost.get(cardId);
      if (attached && attached.length > 0) snap.attachments = [...attached];
      if (card.controllerId !== zoneOwnerId) snap.controllerId = card.controllerId;
      return snap;
    };

    const players: SnapshotPlayer[] = Object.values(this.state.players).map(
      player => ({
        id: player.id,
        name: player.name,
        influence: player.influence,
        deckCount: player.deck.length,
        ...(player.factionId
          ? { faction: describe(player.factionId, player.id) }
          : {}),
        hand: player.hand.map(id => describe(id, player.id)),
        play: player.play
          .filter(id => id !== player.factionId)
          .map(id => describe(id, player.id)),
        discard: player.discard.map(id => describe(id, player.id)),
        void: player.void.map(id => describe(id, player.id)),
        removed: player.removed.map(id => describe(id, player.id))
      })
    );

    return {
      turn: this.state.turn,
      activePlayerId: this.state.activePlayerId,
      priorityPlayerId: this.state.priorityPlayerId,
      mode: this.getFlowView().mode,
      ...(this.state.result !== undefined ? { result: this.state.result } : {}),
      ...(this.state.seatSwap ? { seatsSwapped: true as const } : {}),
      responseStack: this.state.responseStack.map(item => ({
        label: this.logStackItemLabel(item),
        controllerId: item.controllerId
      })),
      ...(this.state.pendingChoice
        ? {
            pendingChoice: {
              kind: this.state.pendingChoice.kind,
              playerId: this.state.pendingChoice.playerId
            }
          }
        : {}),
      players
    };
  }

  private recordLogEvent(event: GameEvent): void {
    if (!this.logEnabled) return;

    // The log is informational — a gap in a message must never abort a real
    // mutation, so a describe failure degrades to a bare event tag.
    let described: { kind: GameLogKind; message: string } | undefined;
    this.logNamedHidden = false;
    this.logDescribing = true;
    try {
      described = this.describeEvent(event);
    } catch {
      described = { kind: "info", message: `(${event.type})` };
    } finally {
      this.logDescribing = false;
    }
    if (!described) return;

    // A line that named a hidden card (in a hand or deck, or face-down) is re-described
    // from each vantage: the public reader's, then each player's.
    let redacted: GameLogEntry["redacted"];
    if (this.logNamedHidden) {
      const publicMessage = this.describeEventFor(event, null) ?? described.message;
      if (publicMessage !== described.message) {
        const byPlayer: Partial<Record<PlayerId, string>> = {};
        for (const playerId of Object.keys(this.state.players)) {
          const own = this.describeEventFor(event, playerId) ?? publicMessage;
          if (own !== publicMessage) byPlayer[playerId] = own;
        }
        redacted = {
          public: publicMessage,
          ...(Object.keys(byPlayer).length > 0 ? { byPlayer } : {})
        };
      }
    }

    // A destroy's own zone move (`cardMoved`, emitted immediately before
    // this by `destroyCard`'s `moveCard` call) reads as a near-duplicate of
    // "is destroyed" — fold the pair into one line instead of two
    // back-to-back entries that say the same thing.
    if (event.type === "cardDestroyed") {
      const prior = this.state.gameLog[this.state.gameLog.length - 1];
      if (
        prior?.event?.type === "cardMoved" &&
        prior.event.cardId === event.cardId &&
        prior.depth === this.responseStack.length
      ) {
        this.state.gameLog.pop();
        // The "is destroyed" line, from every vantage, gains where it went.
        const to = prior.event.to;
        const fold = (message: string): string => `${message} and moves to ${to}`;
        described = { kind: described.kind, message: fold(described.message) };
        if (redacted) {
          redacted = {
            public: fold(redacted.public),
            ...(redacted.byPlayer
              ? {
                  byPlayer: Object.fromEntries(
                    Object.entries(redacted.byPlayer).map(([id, message]) => [id, fold(message!)])
                  )
                }
              : {})
          };
        }
      }
    }

    this.state.gameLog.push({
      seq: this.state.gameLog.length + 1,
      turn: this.state.turn,
      activePlayerId: this.state.activePlayerId,
      depth: this.responseStack.length,
      kind: described.kind,
      message: described.message,
      ...(redacted ? { redacted } : {}),
      event
    });
  }

  /**
   * `describeEvent` from `viewer`'s vantage (`null`: public information
   * only): a card in a hand or deck reads as "a card" unless the viewer holds
   * it. A describe failure reads as "no different line".
   */
  private describeEventFor(event: GameEvent, viewer: PlayerId | null): string | undefined {
    this.logViewer = viewer;
    try {
      return this.describeEvent(event)?.message;
    } catch {
      return undefined;
    } finally {
      this.logViewer = undefined;
    }
  }

  private recordLogMarker(
    marker: NonNullable<GameLogEntry["marker"]>,
    kind: GameLogKind,
    message: string,
    depth: number
  ): void {
    if (!this.logEnabled) return;

    this.state.gameLog.push({
      seq: this.state.gameLog.length + 1,
      turn: this.state.turn,
      activePlayerId: this.state.activePlayerId,
      depth,
      kind,
      message,
      marker
    });
  }

  /** Player display name for a log line, falling back to the id. */
  private logPlayerName(playerId: PlayerId): string {
    return this.state.players[playerId]?.name || playerId;
  }

  /**
   * Card display name for a log line, falling back to the instance id.
   * `forceFaceDown` keeps a card anonymous on its own leave/destroy line —
   * `moveCard` has already cleared `faceDown` by the time that event is
   * described, so the caller passes the snapshot from the event.
   */
  private logCardName(
    cardId: CardInstanceId | undefined,
    forceFaceDown = false,
    knownPublic = false
  ): string {
    if (!cardId) return "something";
    const card = this.state.cards[cardId];
    if (!card) return cardId;
    const name = this.definitions[card.definitionId]?.name ?? cardId;
    // A face-down card is named only to whoever may look at it: its
    // controller in play, its holder once it has left (`forceFaceDown`), the
    // voider (or an Arcane Escrow) in the void.
    if (forceFaceDown || card.faceDown) {
      if (this.logViewer === undefined) {
        if (!this.logDescribing) return "a face-down card";
        this.logNamedHidden = true;
      } else {
        const viewer = this.logViewer;
        const mayLook =
          viewer !== null &&
          (forceFaceDown
            ? viewer === this.zoneHolderId(card)
            : card.zone === "play"
              ? viewer === card.controllerId
              : card.zone === "void" || card.zone === "removed"
                ? this.canViewerSeeVoidedCard(viewer, cardId)
                : viewer === this.zoneHolderId(card));
        if (!mayLook) return "a face-down card";
      }
      return `a face-down card (${name})`;
    }
    // A card in a hand or deck is hidden from all but its holder — unless
    // the line itself shows it was public a moment ago (`knownPublic`).
    if (!knownPublic && (card.zone === "hand" || card.zone === "deck")) {
      if (this.logViewer === undefined) this.logNamedHidden = true;
      else if (this.logViewer !== this.zoneHolderId(card)) return "a card";
    }
    return name;
  }

  /** "the faction" line label — "Alice's faction". */
  private logFactionOwnerName(cardId: CardInstanceId): string {
    const card = this.state.cards[cardId];
    return card ? `${this.logPlayerName(card.ownerId)}'s faction` : "a faction";
  }

  /** A battle-damage target as a log label — "Bob's faction" / a card name. */
  private logBattleTargetName(
    target: BattleDamageAssignment["target"]
  ): string {
    return target.type === "faction"
      ? `${this.logPlayerName(target.playerId)}'s faction`
      : this.logCardName(target.cardId);
  }

  /**
   * How a response-stack item reads in the log — `"Ability Name" on Card`
   * for an ability, the plain card name for a card. Source may have left
   * play since the item was pushed (RULES.md §10), so look everything up
   * defensively; the log must never abort resolution.
   */
  private logStackItemLabel(item: StackItem): string {
    const sourceDef = this.state.cards[item.sourceId]
      ? this.definitions[this.state.cards[item.sourceId].definitionId]
      : undefined;
    const abilityName = sourceDef?.behavior?.abilities?.find(
      a => a.id === item.abilityId
    )?.name;
    // Whatever is on the response stack was shown to play it.
    return item.kind === "ability"
      ? `${abilityName ? `"${abilityName}"` : "an ability"} on ${this.logCardName(item.sourceId, false, true)}`
      : this.logCardName(item.sourceId, false, true);
  }

  /**
   * The "… — <what for>" tail on a `priorityPassed` log line. A battle opens
   * three response windows back to back and normal play opens one per stack
   * item; without this a reader sees a wall of identical "X passes" lines
   * and can't tell which window each decline belonged to. A pass made while
   * a response is on the stack is a decline of *that* item, whatever window
   * it sits in — "the attack" only names the empty-stack, top-level pass.
   */
  private passContextSuffix(window: ResponseWindowState): string {
    const top = this.responseStack[this.responseStack.length - 1];
    if (top) return ` — no response to ${this.logStackItemLabel(top)}`;

    switch (window.kind) {
      case "battleAfterAttackers":
        return " — no response to the attack";
      case "battleBeforeDamage":
        return " — no response before battle damage is assigned";
      case "battleAfterDamage":
        return " — no response before battle damage is dealt";
      case "endTurn":
        return " — no response to the turn ending";
      case "action":
        return "";
    }
  }

  /**
   * One-line rendering + category for an emitted event. Returns `undefined`
   * for events with no reader value (a degenerate same-zone self-move).
   */
  private describeEvent(event: GameEvent): { kind: GameLogKind; message: string } | undefined {
    const responding = this.responseStack.length > 0;

    switch (event.type) {
      case "turnStarted":
        return {
          kind: "turn",
          message: `— Turn ${this.state.turn}: ${this.logPlayerName(event.playerId)} —`
        };

      case "turnEnding":
        return { kind: "turn", message: `${this.logPlayerName(event.playerId)} ends their turn` };

      case "gameEnded":
        return {
          kind: "turn",
          message:
            event.result.outcome === "draw"
              ? `Game over — a draw`
              : `Game over — ${event.result.winners.map(id => this.logPlayerName(id)).join(" and ")} ${event.result.winners.length === 1 ? "wins" : "win"}`
        };

      case "playerEliminated":
        return {
          kind: "turn",
          message: `${this.logPlayerName(event.playerId)} is out of the game`
        };

      case "cardPlayed": {
        const suffix = responding ? " in response" : "";
        return {
          kind: responding ? "response" : "action",
          message: `${this.logPlayerName(event.playerId)} plays ${this.logCardName(event.cardId)}${suffix}`
        };
      }

      case "abilityActivated": {
        const def = this.state.cards[event.cardId]
          ? this.definitions[this.state.cards[event.cardId].definitionId]
          : undefined;
        const ability = def?.behavior?.abilities?.find(a => a.id === event.abilityId);
        const label = ability?.name ? `"${ability.name}"` : "an ability";
        const suffix = responding ? " in response" : "";
        // Activating an ability shows the card it is on, wherever it sits.
        return {
          kind: responding ? "response" : "action",
          message: `${this.logPlayerName(event.playerId)} activates ${label} on ${this.logCardName(event.cardId, false, true)}${suffix}`
        };
      }

      case "cardEnteredPlay": {
        const hostId = this.state.cards[event.cardId]?.attachedTo;
        const host =
          hostId && this.state.cards[hostId] ? ` attached to ${this.logCardName(hostId)}` : "";
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} enters play${host}`
        };
      }

      case "cardAttached":
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} attaches to ${this.logCardName(event.hostId)}`
        };

      case "influenceChanged": {
        const faction = `${this.logPlayerName(event.playerId)}'s faction`;
        const verb = event.delta < 0 ? "loses" : "gains";
        return {
          kind: "damage",
          message: `${faction} ${verb} ${Math.abs(event.delta)} influence (now ${event.total})`
        };
      }

      case "statModified": {
        const sign = event.operation === "add" && event.value >= 0 ? "+" : "";
        const change =
          event.operation === "set"
            ? `${event.stat} set to ${event.value}`
            : event.operation === "multiply"
              ? `${event.stat} ×${event.value}`
              : `${sign}${event.value} ${event.stat}`;
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} gets ${change}`
        };
      }

      case "cardMoved": {
        if (event.from === event.to) return undefined;
        // The `play -> deploying` waypoint that opens a deploy is mechanical
        // noise, and a permanent's `deploying -> play` on resolution is
        // already carried by `cardEnteredPlay`. But a resolved tactic still
        // leaves `deploying` for its owner's discard pile (the norm) or,
        // via `selfDisposition`, their hand — that IS the reader-visible
        // outcome of the tactic, so keep it (labelling the origin `play`).
        if (event.to === "deploying") return undefined;
        if (event.from === "deploying" && event.to === "play") return undefined;
        const from = event.from === "deploying" ? "play" : event.from;
        // Leaving a face-up spot in play, or the discard pile, it was public
        // a moment ago; leaving a hand, a deck or the void it may not have been.
        const wasPublic =
          ((event.from === "play" || event.from === "deploying") && !event.faceDown) ||
          event.from === "discard";
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId, event.faceDown, wasPublic)} moves from ${from} to ${event.to}`
        };
      }

      case "cardPicked":
        return {
          kind: "zone",
          message: `${this.logPlayerName(event.playerId)} picks ${this.logCardName(event.cardId)}`
        };

      case "cardDestroyed":
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId, event.faceDown)} is destroyed`
        };

      case "cardDepleted":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} is depleted` };

      case "cardRestored":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} is restored` };

      case "counterChanged": {
        const count = this.state.cards[event.cardId]?.counters?.[event.counter] ?? 0;
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} now has ${count} ${event.counter} counter(s)`
        };
      }

      case "resourcePlayed":
        return {
          kind: "resource",
          message: `${this.logPlayerName(event.playerId)} plays ${this.logCardName(event.cardId)} as a ${
            event.faceDown ? "face-down" : "face-up"
          } resource`
        };

      case "cardsDrawn":
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.playerId)} draws ${event.count} card${
            event.count === 1 ? "" : "s"
          }`
        };

      case "cardsDiscarded":
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.playerId)} discards a card`
        };

      case "cardsMulliganed":
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.playerId)} puts ${event.cardIds.length} card${
            event.cardIds.length === 1 ? "" : "s"
          } on the bottom of their deck in the mulligan`
        };

      case "cardsRevealed": {
        // A reveal names its cards to whoever it was shown to — everyone, or
        // `viewerId` (and the holder, for their own hand). Anyone else only
        // learns that the look happened.
        const shownTo =
          this.logViewer === undefined ||
          event.viewerId === "all" ||
          this.logViewer === event.viewerId ||
          (event.zone === "hand" && this.logViewer === event.ownerId);
        if (!shownTo) {
          const count = event.cardIds.length;
          const lookerId = event.viewerId as PlayerId;
          const whose = lookerId === event.ownerId ? "their" : `${this.logPlayerName(event.ownerId)}'s`;
          return {
            kind: "draw",
            message: `${this.logPlayerName(lookerId)} looks at ${count} card${count === 1 ? "" : "s"} from ${whose} ${event.zone}`
          };
        }
        const names = event.cardIds.map(id => this.logCardName(id, false, true)).join(", ") || "no cards";
        if (this.logViewer === undefined && event.viewerId !== "all") this.logNamedHidden = true;
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.ownerId)} reveals ${names} from ${event.zone}`
        };
      }

      case "deckSearched":
        return { kind: "draw", message: `${this.logPlayerName(event.playerId)} searches their deck` };

      case "deckShuffled":
        return { kind: "draw", message: `${this.logPlayerName(event.playerId)} shuffles their deck` };

      case "effectScheduled":
        return {
          kind: "info",
          message: `${this.logCardName(event.sourceId)} sets up a delayed effect for ${this.describeDelayedWhen(
            event.when,
            event.controllerId
          )}`
        };

      case "damageDealt": {
        const target = this.state.cards[event.targetId];
        const targetLabel =
          target && this.getDefinition(event.targetId).type === "faction"
            ? this.logFactionOwnerName(event.targetId)
            : this.logCardName(event.targetId);
        const from = event.sourceId ? ` from ${this.logCardName(event.sourceId)}` : "";
        return {
          kind: "damage",
          message: `${targetLabel} takes ${event.amount} damage${from}`
        };
      }

      case "battleStarted": {
        const battle = this.state.battle;
        const targetLabel = !battle
          ? "the opponent"
          : battle.target.type === "faction"
            ? this.logPlayerName(battle.target.playerId) + "'s faction"
            : this.logCardName(battle.target.cardId);
        const attackers = (battle?.attackingParty ?? [])
          .map(id => this.logCardName(id))
          .join(", ");
        return {
          kind: "battle",
          message: `Battle: ${attackers || "attackers"} attack ${targetLabel}`
        };
      }

      case "battleEnded":
        return { kind: "battle", message: `Battle ends` };

      case "characterLeftBattle": {
        // The card is face-down by the time this fires (that is usually why
        // it left), but it was a public attacker/blocker an instant ago and
        // its activation was just logged by name — so name it here too
        // rather than the anonymous "a face-down card" `logCardName` gives.
        const c = this.state.cards[event.cardId];
        const name = c
          ? this.definitions[c.definitionId]?.name ?? event.cardId
          : event.cardId;
        return { kind: "battle", message: `${name} leaves the battle` };
      }

      case "characterAttacked":
        return { kind: "battle", message: `${this.logCardName(event.cardId)} attacks` };

      case "characterBlocked":
        return { kind: "battle", message: `${this.logCardName(event.cardId)} blocks` };

      case "blockingPartyFormed":
        return {
          kind: "battle",
          message: `${this.logPlayerName(event.playerId)} forms a blocking party of ${event.blockerCount}`
        };

      case "attackerBlocked":
        return {
          kind: "battle",
          message: `${this.logCardName(event.cardId)} is blocked by ${event.blockerCount} character(s)`
        };

      case "firstPlayerDecider":
        return {
          kind: "info",
          message: `${this.logPlayerName(event.playerId)} wins the opening coin flip and decides who goes first`
        };

      case "firstPlayerChosen":
        return {
          kind: "info",
          message: `${this.logPlayerName(event.playerId)} chooses to go ${
            event.firstPlayerId === event.playerId ? "first" : "second"
          }`
        };

      case "coinFlipped":
        return {
          kind: "info",
          message: `${this.logPlayerName(event.playerId)} flips a coin and ${
            event.won ? "wins" : "loses"
          }`
        };

      case "seatsSwapped":
        return {
          kind: "info",
          message: event.swapped
            ? "The players switch seats — each controls the other's side"
            : "The players switch back to their own sides"
        };

      case "factionCardFlipped": {
        const fromName = this.definitions[event.fromDefinitionId]?.name ?? event.fromDefinitionId;
        const toName = this.definitions[event.toDefinitionId]?.name ?? event.toDefinitionId;
        return {
          kind: "trigger",
          message: `${this.logPlayerName(event.playerId)}'s faction card turns over: ${fromName} becomes ${toName}`
        };
      }

      case "variableRolled": {
        const source = this.logCardName(event.sourceId);
        const label = event.name.toUpperCase();
        // The 1–2 roll is the printed "flip a coin" idiom; anything else reads
        // as a die roll over its range.
        return {
          kind: "info",
          message:
            event.min === 1 && event.max === 2
              ? `${source} flips a coin: ${label} is ${event.value}`
              : `${source} rolls ${label} = ${event.value} (${event.min}–${event.max})`
        };
      }

      case "variableChosen": {
        const source = this.logCardName(event.sourceId);
        const label = event.name.toUpperCase();
        return {
          kind: "info",
          message: `${this.logPlayerName(event.playerId)} picks ${label} = ${event.value} for ${source} (${event.min}–${event.max})`
        };
      }
    }

    return undefined;
  }

  getDefinition(cardId: CardInstanceId): CardDefinition {
    const card = this.state.cards[cardId] ?? this.departedTokens.get(cardId);
    assert(card, `Card '${cardId}' not found.`);
    const definition = this.definitions[card.definitionId];

    assert(
      definition,
      `Missing definition '${card.definitionId}' for card '${cardId}'`
    );

    return definition;
  }

  /**
   * Every card type a card currently has (RULES.md §3.7 / CR §208). Its
   * printed `definition.type` plus any type ADDED by a live `setCardType`
   * grant ("this turn, the item is a golem character" — CR §208.1: a card
   * may have several types at once; §208.1a: gaining one keeps the rest).
   * Everything that keys a *rules* decision off type — typed selectors, the
   * lethal-damage / attach-to state-based checks, battle legality, the
   * `cardTypeIs` condition, start-of-turn damage-clear and attack
   * eligibility — asks `hasCardType`. Play-time resolution (tactic vs.
   * permanent) still reads `definition.type` directly, since a type change
   * only applies to a card already in play.
   */
  getCardTypes(cardId: CardInstanceId): CardType[] {
    // CR §411.1: every face-down card in play is *only* a resource — it has
    // no name, no other type, and no rules text. Its real (hidden) type is
    // irrelevant to every type-keyed rules decision until it is flipped
    // face-up as "a completely new card" (§411.3). `matchesSelector`'s
    // `selector.type` path already special-cases this; routing it through
    // here covers the `cardTypeIs` condition path too (e.g. a "destroy
    // another character or item you control" cost must not see a face-down
    // resource as a character).
    const card = this.state.cards[cardId];
    if (card?.faceDown && card.zone === "play") {
      return ["resource"];
    }

    const types = new Set<CardType>([this.getDefinition(cardId).type]);

    // `untilEndOfTurn` / `permanent` grants apply while they sit in the
    // array (the start-of-turn sweep drops the expired ones, exactly like
    // `state.modifiers`); `whileSourceInPlay` needs the live check here
    // since nothing else prunes it.
    for (const grant of this.state.cardTypeGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || !this.sourceActiveInPlay(grant.sourceId))
      ) {
        continue;
      }
      types.add(grant.cardType);
    }

    return [...types];
  }

  /**
   * A card's current subtype list — printed subtypes plus any still-active
   * `grantSubtype` grant ("it gains the sarcophyle subtype"). The single
   * read path for every subtype consumer (`cardSubtypeIs`, selector
   * `subtype` / `subtypeVar`, `distinctCount by: "subtype"`,
   * `hasAttachment.ofSubtype`).
   */
  getSubtypes(cardId: CardInstanceId): string[] {
    // CR 411.1: a face-down card has no subtype.
    if (this.isFaceDownInPlay(cardId)) return [];
    return this.getSubtypesIncludingHidden(cardId);
  }

  /** Subtype list ignoring face-down status (the hidden front's subtypes). */
  private getSubtypesIncludingHidden(cardId: CardInstanceId): string[] {
    const subs = new Set<string>(this.getDefinition(cardId).subtype ?? []);
    for (const grant of this.state.subtypeGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || !this.sourceActiveInPlay(grant.sourceId))
      ) {
        continue;
      }
      subs.add(grant.subtype);
    }
    return [...subs];
  }

  /**
   * The triggering event is `cardId` moving / being destroyed out of play
   * while face-down: at that instant it was only a Volition resource (CR
   * 411.1), whatever its hidden front says ("when a character you control
   * leaves play" does not see it).
   */
  private leftPlayFaceDown(
    cardId: CardInstanceId,
    context: ResolutionContext
  ): boolean {
    const event = context.event as
      | { type: string; cardId?: CardInstanceId; faceDown?: boolean }
      | undefined;
    return (
      !!event &&
      (event.type === "cardMoved" || event.type === "cardDestroyed") &&
      event.cardId === cardId &&
      event.faceDown === true
    );
  }

  /** A face-down card in play: only a Volition resource, no name / subtype / trade / rules text (CR 411.1, 203.4a). */
  private isFaceDownInPlay(cardId: CardInstanceId): boolean {
    const card = this.state.cards[cardId];
    return !!card && card.faceDown && card.zone === "play";
  }

  /**
   * "While the source is in play" for a duration: the source must still be in
   * play AND face-up - a face-down card has no rules text, so a rule bound to
   * it stops applying (Q40, CR 411.1).
   */
  private sourceActiveInPlay(sourceId: CardInstanceId): boolean {
    const card = this.state.cards[sourceId];
    return !!card && card.zone === "play" && !card.faceDown;
  }

  /** Whether `cardId` currently has `type` (printed or added — see `getCardTypes`). */
  hasCardType(cardId: CardInstanceId, type: CardType): boolean {
    return this.getCardTypes(cardId).includes(type);
  }

  /**
   * Puts a token permanent into play under `playerId` — a synthetic
   * `CardDefinition` registered on the fly plus a `CardInstance` marked
   * `isToken` (so `moveCard` deletes it outright when it leaves play).
   */
  /**
   * A card's Unique designation, including one granted live by a
   * `ContinuousAbility.uniqueGrant` (God's Autograph). `"cardName"` grants
   * resolve to the card's own name.
   */
  getEffectiveUnique(cardId: CardInstanceId): string | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;

    const printed = this.getDefinition(cardId).unique;
    if (printed) return printed;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.uniqueGrant) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, ctx)
        ) {
          continue;
        }
        if (!this.matchesSelector(card, ability.uniqueGrant.selector, ctx)) {
          continue;
        }
        return ability.uniqueGrant.designation === "cardName"
          ? this.getDefinition(cardId).name
          : ability.uniqueGrant.designation;
      }
    }

    return undefined;
  }

  /**
   * A card's FLIP UP option: its own printed `flipUp`, or one granted by an
   * in-play `ContinuousAbility.grantFlipUp` aura (Woadenworm Gloamspike —
   * "all your face-down tactics gain FLIP UP with cost & threshold equal to
   * their regular cost & threshold"). A card with its own `flipUp` keeps it.
   */
  getEffectiveFlipUp(
    cardId: CardInstanceId
  ): { cost: number; threshold: string | number; effects?: Effect[] } | undefined {
    return this.getFlipUpOptions(cardId)[0];
  }

  /**
   * Every FLIP UP a face-down card can use: its own printed one first, then
   * one granted by an in-play `ContinuousAbility.grantFlipUp` aura
   * (Woadenworm Gloamspike — "all your face-down tactics gain FLIP UP with
   * cost & threshold equal to their regular cost & threshold"). The grant is
   * additive (Q35): a card with its own printed FLIP UP may use either.
   */
  getFlipUpOptions(
    cardId: CardInstanceId
  ): Array<{ cost: number; threshold: string | number; effects?: Effect[] }> {
    const definition = this.getDefinition(cardId);
    const options: Array<{ cost: number; threshold: string | number; effects?: Effect[] }> = [];
    if (definition.flipUp) options.push(definition.flipUp);

    const card = this.state.cards[cardId];
    if (!card) return options;

    outer: for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantFlipUp) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        if (!this.matchesSelector(card, ability.grantFlipUp.selector, ctx)) {
          continue;
        }
        options.push({
          cost: definition.cost ?? 0,
          threshold: definition.threshold
        });
        break outer;
      }
    }

    return options;
  }

  /** Printed (non-token) definitions by card name, built on first token and kept for the game. */
  private printingsByName: Map<string, CardDefinition[]> | undefined;

  /**
   * The real printing a token depicts: one of the printed cards sharing the
   * token's name and type (Micromajig has nine, each with its own art,
   * subtitle and flavor text). Picked by hashing the token's definition id, so
   * a swarm spreads across the printings while a replay, a resume and an AI
   * clone all land on the same one without touching the RNG stream.
   */
  private pickTokenPrinting(
    token: TokenSpec,
    tokenDefId: CardDefinitionId
  ): CardDefinition | undefined {
    if (!this.printingsByName) {
      this.printingsByName = new Map();
      for (const definition of Object.values(this.definitions)) {
        if (definition.set === "Token") continue;
        const list = this.printingsByName.get(definition.name);
        if (list) list.push(definition);
        else this.printingsByName.set(definition.name, [definition]);
      }
    }
    const printings = this.printingsByName
      .get(token.name)
      ?.filter(definition => definition.type === token.cardType);
    if (!printings?.length) return undefined;

    let hash = 0;
    for (let i = 0; i < tokenDefId.length; i++) {
      hash = (hash * 31 + tokenDefId.charCodeAt(i)) | 0;
    }
    return printings[Math.abs(hash) % printings.length];
  }

  /**
   * Puts a new Card Token into play under `playerId`'s control. Its owner is
   * `ownerId`, the controller of the effect that created it (CR 409.3b).
   */
  private createTokenPermanent(
    playerId: PlayerId,
    token: TokenSpec,
    ownerId: PlayerId = playerId
  ): CardInstanceId {
    const defId = this.nextId("token-def");
    this.grantingDefinitionIds = undefined;
    const printing = this.pickTokenPrinting(token, defId);
    this.definitions[defId] = {
      id: defId,
      name: token.name,
      set: "Token",
      printingId: printing?.id,
      subtitle: printing?.subtitle,
      flavorText: printing?.flavorText,
      art: printing?.art,
      type: token.cardType,
      trade:
        token.trade ??
        ((token.subtype ?? []).some((s) => s.toLowerCase() === "majig")
          ? "gearsmith"
          : "universal"),
      rarity: "",
      cost: 0,
      threshold: 0,
      subtype: token.subtype ?? [],
      text: "",
      strength: token.strength,
      life: token.life,
      speed: token.speed,
      structure: token.structure
    };

    const instance: CardInstance = {
      id: this.nextId("card"),
      definitionId: defId,
      ownerId,
      controllerId: playerId,
      zone: "play",
      depleted: false,
      damage: 0,
      faceDown: false,
      attackEligibleTurn: undefined,
      counters: {},
      isToken: true
    };
    this.state.cards[instance.id] = instance;
    this.requirePlayer(playerId).play.push(instance.id);

    this.emit({
      type: "cardEnteredPlay",
      cardId: instance.id,
      playerId
    });

    return instance.id;
  }

  getFactionCard(playerId: PlayerId): CardInstance | undefined {
    const player = this.requirePlayer(playerId);
    return player.factionId ? this.state.cards[player.factionId] : undefined;
  }

  getFactionDefinition(playerId: PlayerId): FactionDefinition | undefined {
    const faction = this.getFactionCard(playerId);
    if (!faction) return undefined;
    return this.getDefinition(faction.id).faction;
  }

  /**
   * The player whose `factionId` / `influence` pool `factionCard` sits in —
   * the player who controls it. That is its owner, except while a seat swap
   * (`GameState.seatSwap`) has the players holding each other's factions.
   */
  private factionHolderId(factionCard: CardInstance): PlayerId {
    const holder = Object.values(this.state.players).find(
      player => player.factionId === factionCard.id
    );
    return holder?.id ?? factionCard.ownerId;
  }

  /** The owner of the faction `player` currently holds (CR §102.1: who loses at 0 influence). */
  private factionOwnerId(player: PlayerState): PlayerId {
    const faction = player.factionId ? this.state.cards[player.factionId] : undefined;
    return faction?.ownerId ?? player.id;
  }

  isResource(cardId: CardInstanceId): boolean {
    const card = this.requireCard(cardId);
    return card.zone === "play" &&
      (card.faceDown || this.getDefinition(cardId).type === "resource");
  }

  getAvailableResourceIds(playerId: PlayerId): CardInstanceId[] {
    const player = this.requirePlayer(playerId);
    return player.play.filter(cardId => {
      const card = this.state.cards[cardId];
      return (
        card.controllerId === playerId &&
        this.isResource(cardId) &&
        card.attachedTo === undefined
      );
    });
  }

  getAvailableResourceCount(playerId: PlayerId): number {
    return this.getAvailableResourceIds(playerId).length;
  }

  /** While set, `getThresholds` ignores this card (a FLIP UP card's own icons, checked after flipping). */
  private thresholdExcludedCard: CardInstanceId | undefined;

  getThresholds(playerId: PlayerId): Threshold {
    // Callers may mutate what they get, so a memoized answer is handed out as a copy.
    return { ...this.scopedRead("thresholds", playerId, () => this.computeThresholds(playerId)) };
  }

  private computeThresholds(playerId: PlayerId): Threshold {
    const result: Threshold = {};

    for (const cardId of this.requirePlayer(playerId).play) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerId !== playerId) {
        continue;
      }
      if (cardId === this.thresholdExcludedCard) continue;

      // Resources (face-up printed icons, or Volition for face-down) AND
      // any other in-play card that prints "PROVIDES: [X]" (a crest item, a
      // character) — `getResourceIcons` returns `[]` for everything else.
      const icons = this.getResourceIcons(cardId);
      for (const icon of icons) {
        result[icon] = (result[icon] ?? 0) + 1;
      }
    }

    // "This turn, you control an additional [E][E][E][E]" (31337!) and other
    // temporary phantom-icon grants.
    for (const grant of this.state.resourceGrants) {
      if (grant.playerId !== playerId) continue;
      result[grant.icon] = (result[grant.icon] ?? 0) + grant.amount;
    }

    return result;
  }

  getDevelopChoices(playerId: PlayerId): DevelopChoice[] {
    // "Your opponent ignores their faction's DEVELOP RULE." (The Knitting
    // Coalition — PULLING STRINGS): an opposing in-play faction can suppress
    // this player's Develop Rule entirely.
    if (
      opponentsOf(this.state, playerId).some(
        opponentId => this.getFactionDefinition(opponentId)?.overridesOpponent?.suppressDevelop
      )
    ) {
      return [];
    }
    return structuredClone(
      this.getFactionDefinition(playerId)?.turn.develop.choices ?? []
    );
  }

  /**
   * How many times `playerId`'s faction may use its Develop Rule per turn
   * (default 1; "OVERTIME" = 2; The Evil Alliance's "Repeat this X-1 times"
   * = one per opponent at the start of the game).
   */
  private developsAllowed(playerId: PlayerId): number {
    const develop = this.getFactionDefinition(playerId)?.turn.develop;
    const uses = develop?.usesPerTurn ?? 1;
    return develop?.usesPerOpponent ? uses * Math.max(1, this.state.startingOpponentCounts[playerId] ?? 1) : uses;
  }

  /**
   * The in-play card `playerId` controls that carries
   * `behavior.developDrawReplacement` ("If you would draw a card as part of
   * your Develop Rule, you may ... instead"; Arcane Escrow), or `undefined`.
   */
  private developDrawReplacementCardFor(
    playerId: PlayerId
  ): CardInstanceId | undefined {
    for (const cardId of this.requirePlayer(playerId).play) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerId !== playerId || card.faceDown) continue;
      if (this.getDefinition(cardId).behavior?.developDrawReplacement) {
        return cardId;
      }
    }
    return undefined;
  }

  /**
   * Every resource icon `cardId` provides right now: its own (`ownResourceIcons`) plus what in-play
   * `ContinuousAbility.providesGrants` give it. The single read behind `getThresholds`, the `cardProvides`
   * condition and the `resourceIcons` expression.
   */
  private getResourceIcons(cardId: CardInstanceId): ResourceIcon[] {
    const own = this.ownResourceIcons(cardId);
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || !this.anyDefinitionProvidesGrants()) return own;

    let icons: ResourceIcon[] | undefined;
    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.providesGrants) continue;

        // The grant's own condition / selector / suppression check may ask for icons again (a condition counting
        // its controller's [D]): a re-entrant read skips this ability instead of bootstrapping off itself.
        const guardKey = `${source.id}:${ability.id}:provides`;
        if (this.resolvingContinuousGrant.has(guardKey)) continue;
        this.resolvingContinuousGrant.add(guardKey);
        try {
          if (this.abilitySuppressed(source.id, ability.id)) continue;
          const context: ResolutionContext = {
            sourceId: source.id,
            controllerId: source.controllerId,
            abilityId: ability.id,
            selected: { __candidate: [cardId] }
          };
          if (ability.condition && !this.evaluateCondition(ability.condition, context)) continue;

          for (const grant of ability.providesGrants) {
            if (!this.matchesSelector(card, grant.selector, context)) continue;
            icons ??= [...own];
            if (grant.onlyIfLacking && icons.includes(grant.icon)) continue;
            for (let i = 0; i < (grant.amount ?? 1); i++) icons.push(grant.icon);
          }
        } finally {
          this.resolvingContinuousGrant.delete(guardKey);
        }
      }
    }
    return icons ?? own;
  }

  /** Whether any card definition in this game prints a `providesGrants` block (almost never): when none does, icon reads skip the board scan. */
  private anyProvidesGrants: boolean | undefined;

  private anyDefinitionProvidesGrants(): boolean {
    this.anyProvidesGrants ??= Object.values(this.definitions).some(
      definition =>
        objectMentionsKey(definition.behavior, "providesGrants") || objectMentionsKey(definition.faction, "providesGrants")
    );
    return this.anyProvidesGrants;
  }

  private ownResourceIcons(cardId: CardInstanceId): ResourceIcon[] {
    const card = this.requireCard(cardId);

    // "This turn, this card gains PROVIDES: [X]" — a card-scoped runtime
    // grant, stacked on top of the printed icons / Volition below. Live-read
    // like `state.modifiers` (present == active); expiry is the start-of-turn
    // sweep + the leave-play cleanup, not `durationStillActive` (whose
    // `<=` turn check only makes sense at that sweep).
    const granted: ResourceIcon[] = [];
    for (const grant of this.state.provideGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || !this.sourceActiveInPlay(grant.sourceId))
      ) {
        continue;
      }
      for (let i = 0; i < grant.amount; i++) granted.push(grant.icon);
    }

    if (card.faceDown) {
      return ["volition", ...granted];
    }

    const definition = this.getDefinition(cardId);

    if (definition.resource?.provides?.length) {
      return [...definition.resource.provides, ...granted];
    }

    switch (definition.name.toLowerCase()) {
      case "rage":
        return ["rage", ...granted];
      case "greed":
        return ["greed", ...granted];
      case "deception":
        return ["deception", ...granted];
      case "elitism":
        return ["elitism", ...granted];
      case "obsession":
        return ["obsession", ...granted];
      default:
        return granted;
    }
  }

  /** Numeric cost paid by the `payResources` steps of the play being made (read by `deployCardInner` for CR 406.3). */
  private lastNumericCostPaid = 0;

  /**
   * One increase or reduction of a running numeric cost (CR 406.3). A value is never pushed below 0 (CR 406.6, 410.4).
   * A reduction "to a minimum of N" does not apply to a value that was already below N (CR 410.5: a cost of 0 reduced
   * by 1 to a minimum of 1 stays 0); an increase "to a minimum of N" does raise it.
   */
  private applyNumericAdjust(total: number, adjust: NumericCostAdjust): number {
    const raw = total + adjust.delta;
    if (adjust.minCost === undefined) return Math.max(0, raw);
    if (adjust.delta < 0 && total < adjust.minCost) return Math.max(0, raw);
    return Math.max(0, adjust.minCost, raw);
  }

  private applyNumericAdjusts(total: number, adjusts: readonly NumericCostAdjust[]): number {
    return adjusts.reduce((sum, adjust) => this.applyNumericAdjust(sum, adjust), Math.max(0, total));
  }

  /** CR 406.3: every increase applies before any reduction. */
  private orderNumericAdjusts(adjusts: readonly NumericCostAdjust[]): NumericCostAdjust[] {
    const isIncrease = (a: NumericCostAdjust): boolean => a.delta > 0 || (a.delta === 0 && a.minCost !== undefined);
    return [...adjusts.filter(isIncrease), ...adjusts.filter(a => !isIncrease(a))];
  }

  /** What a `payResources` step costs when it is paid: its amount, adjusted (CR 406.3), never below 0. */
  private payAmount(
    cost: Extract<Cost, { type: "payResources" }>,
    context: ResolutionContext
  ): number {
    // Each "pay N" is floored at 0 on its own (CR 410.4): "Pay Y-X" with X above Y adds nothing to the total.
    const total = [cost.amount, ...(cost.plus ?? [])].reduce<number>(
      (sum, amount) => sum + Math.max(0, this.evaluateNumber(amount, context)),
      0
    );
    return this.applyNumericAdjusts(total, cost.adjust ?? []);
  }

  /** The numeric cost a cost list asks for, if it can be told before the steps run (else undefined). */
  private previewNumericCost(costs: readonly Cost[], context: ResolutionContext): number | undefined {
    try {
      return costs.reduce(
        (sum, cost) => (cost.type === "payResources" ? sum + this.payAmount(cost, context) : sum),
        0
      );
    } catch {
      return undefined;
    }
  }

  /**
   * CR 406.3: all of a play's numeric costs (the card's own cost number and every "pay N" extra cost) are ONE running
   * total, then the adjustments apply. Merges the top-level `payResources` steps into one step carrying `adjust`.
   * Without a numeric cost nothing is reduced (a reduction has no cost to reduce), but an increase CREATES one
   * ("must pay 2 to use a character's ability" taxes even an ability with no printed cost).
   */
  private foldNumericCost(costs: readonly Cost[], adjusts: readonly NumericCostAdjust[]): Cost[] {
    const pays = costs.filter((c): c is Extract<Cost, { type: "payResources" }> => c.type === "payResources");
    const rest = costs.filter(c => c.type !== "payResources");
    const ordered = this.orderNumericAdjusts(adjusts);
    if (pays.length === 0 && !ordered.some(a => a.delta > 0)) return [...costs];
    if (pays.length === 1 && ordered.length === 0) return [...costs];
    const amounts = pays.flatMap(p => [p.amount, ...(p.plus ?? [])]);
    const own = pays.flatMap(p => p.adjust ?? []);
    return [
      ...rest,
      {
        type: "payResources",
        amount: amounts[0] ?? 0,
        ...(amounts.length > 1 ? { plus: amounts.slice(1) } : {}),
        ...(own.length + ordered.length > 0 ? { adjust: [...own, ...ordered] } : {})
      }
    ];
  }

  /**
   * The pending "reduce the next numeric cost you pay this turn" effects that reach a numeric cost `playerId` pays
   * for a card of `cardType` (`isAbility`: for an ability of that card). Every one of them applies to the one next
   * cost (Q1). A card-type-specific reduction ("the next character you play") reaches a card's own cost, and an
   * ability's only when it says so ("item's ability", CR 406.5b).
   */
  private pendingCostReductions(
    playerId: PlayerId,
    cardType: CardType | undefined,
    isAbility: boolean
  ): RuntimeCostReduction[] {
    return this.state.costReductions.filter(
      reduction =>
        reduction.playerId === playerId &&
        !(isAbility && reduction.cardsOnly) &&
        (reduction.cardType === undefined ||
          (reduction.cardType === cardType && (!isAbility || reduction.includeAbilities === true)))
    );
  }

  private consumeCostReductions(used: readonly RuntimeCostReduction[]): void {
    if (used.length === 0) return;
    const consumed = new Set(used.map(r => r.id));
    this.state.costReductions = this.state.costReductions.filter(r => !consumed.has(r.id));
  }

  /** The reductions as numeric-cost adjustments (they come last, after the modifiers' own minimums). */
  private reductionAdjusts(reductions: readonly RuntimeCostReduction[]): NumericCostAdjust[] {
    const amount = reductions.reduce((n, r) => n + r.amount, 0);
    return amount === 0 ? [] : [{ delta: -amount }];
  }

  /** All the adjustments of deploying `cardId` (CR 406.3): continuous modifiers, a selection-based EXTRA COST adjust, pending reductions. */
  private deployCostAdjusts(
    playerId: PlayerId,
    cardId: CardInstanceId,
    onPlayAdjust: number,
    reductions: readonly RuntimeCostReduction[]
  ): NumericCostAdjust[] {
    return this.orderNumericAdjusts([
      ...this.costModifierAdjusts(playerId, cardId),
      ...(onPlayAdjust === 0 ? [] : [{ delta: onPlayAdjust }]),
      ...this.reductionAdjusts(reductions)
    ]);
  }

  /**
   * A cost list paid outside a play of its own (an ability's "you may pay 5", a replacement's cost): folds the payer's
   * pending reductions in (CR 406.5). `used` are the reductions to consume when it really is paid.
   */
  private withPendingReductions(
    costs: Cost[],
    context: ResolutionContext
  ): { costs: Cost[]; used: RuntimeCostReduction[] } {
    if (!costs.some(c => c.type === "payResources")) return { costs, used: [] };
    const sourceType = this.state.cards[context.sourceId]
      ? this.getDefinition(context.sourceId).type
      : undefined;
    const used = this.pendingCostReductions(context.controllerId, sourceType, true);
    if (used.length === 0) return { costs, used: [] };
    return { costs: this.foldNumericCost(costs, this.reductionAdjusts(used)), used };
  }

  /** `canPayCosts` for a cost paid outside a play of its own: the payer's pending reductions count (CR 406.5). */
  private canPayWithReductions(costs: Cost[], context: ResolutionContext): boolean {
    return this.canPayCosts(this.withPendingReductions(costs, context).costs, context);
  }

  /** `payCosts` for a cost paid outside a play of its own: the payer's pending reductions apply and are used up (CR 406.5). */
  private payWithReductions(costs: Cost[], context: ResolutionContext): void {
    const folded = this.withPendingReductions(costs, context);
    this.consumeCostReductions(folded.used);
    this.payCosts(folded.costs, context);
  }

  /**
   * "Your opponents must pay 1 to pick a character you control" (`ContinuousAbility.pickTax`): the `payResources`
   * step a play or ability use owes for the cards its declared picks name. It joins the numeric cost as a "pay N"
   * extra cost (CR 406.3).
   */
  private pickTaxCosts(
    pickerId: PlayerId,
    declarations: readonly TargetDeclaration[],
    context: ResolutionContext
  ): Cost[] {
    const picked = declarations.flatMap(declaration => context.selected[declaration.id] ?? []);
    if (picked.length === 0) return [];
    let total = 0;
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.pickTax) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const sourceContext: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, sourceContext)) continue;
        for (const tax of ability.pickTax) {
          if (this.resolvePlayerRef(tax.affects, sourceContext).id !== pickerId) continue;
          for (const cardId of picked) {
            const card = this.state.cards[cardId];
            if (!card) continue;
            if (
              tax.selector &&
              !this.matchesSelector(card, tax.selector, { ...sourceContext, selected: { __candidate: [cardId] } })
            ) {
              continue;
            }
            total += this.evaluateNumber(tax.amount, sourceContext);
          }
        }
      }
    }
    return total > 0 ? [{ type: "payResources", amount: total }] : [];
  }

  private payNumericCost(
    playerId: PlayerId,
    amount: number,
    exclude?: readonly CardInstanceId[],
    /** Resources the player named to pay with: spent first, the rest of the amount is filled in the usual order. */
    chosen: readonly CardInstanceId[] = []
  ): void {
    assert(Number.isInteger(amount) && amount >= 0, "Numeric costs must be non-negative integers.");

    const player = this.requirePlayer(playerId);
    assert(player.factionId, "Player has no faction to attach resources to.");

    const resources = this.getAvailableResourceIds(playerId).filter(
      id => !exclude?.includes(id)
    );
    assert(resources.length >= amount, "Not enough unattached resources.");
    assert(chosen.length <= amount, "More resources were chosen than the cost needs.");
    assert(new Set(chosen).size === chosen.length, "A resource can only be spent once.");
    assert(
      chosen.every(id => resources.includes(id)),
      "That card can't be spent to pay: it is not an unattached resource you control."
    );

    const ordered = [...chosen, ...resources.filter(id => !chosen.includes(id))];
    for (const cardId of ordered.slice(0, amount)) {
      this.requireCard(cardId).attachedTo = player.factionId;
    }
  }

  /**
   * Apply an influence change to `playerId`'s faction, first running it
   * through any in-play `ContinuousAbility.influenceModifiers` (Tax
   * Attorney — "when your faction loses influence, reduce the amount by
   * 1"). The single choke point for the `modifyInfluence` effect and every
   * CR §408.3 damage→influence path. An explicit `loseInfluence` COST goes
   * through the same modifiers (`modifiedInfluenceDelta`): "your faction
   * loses influence" has no exception for costs (Q24).
   */
  private applyInfluenceDelta(playerId: PlayerId, delta: number): void {
    const d = this.modifiedInfluenceDelta(playerId, delta);
    // A number an effect would push below 0 stays at 0 (CR 410.4).
    const target = this.requirePlayer(playerId);
    const before = target.influence;
    target.influence = Math.max(0, target.influence + d);
    this.noteInfluenceLost(playerId, before - target.influence);
  }

  /**
   * Records influence `playerId`'s faction actually lost (an amount after the
   * modifiers and the floor at 0) for `GameState.influenceLostThisTurn`.
   */
  private noteInfluenceLost(playerId: PlayerId, lost: number): void {
    if (lost <= 0) return;
    this.state.influenceLostThisTurn[playerId] =
      (this.state.influenceLostThisTurn[playerId] ?? 0) + lost;
  }

  /** `delta` after every in-play `influenceModifiers` ability (Tax Attorney, Gideon) has had its say. */
  private modifiedInfluenceDelta(playerId: PlayerId, delta: number): number {
    let d = delta;
    if (d !== 0) {
      const dir: "loss" | "gain" = d < 0 ? "loss" : "gain";
      this.forEachActiveContinuous((source, ability, context) => {
        for (const mod of ability.influenceModifiers ?? []) {
          if (mod.direction !== "any" && mod.direction !== dir) continue;
          if (
            !this.scopeMatchesPlayer(mod.player, source.controllerId, playerId)
          )
            continue;
          // `delta` is subtracted from the magnitude: positive reduces it
          // (Tax Attorney), negative increases it (Gideon, "increase the
          // amount by 1").
          const reduce = this.evaluateNumber(mod.delta, context);
          const newMag = Math.max(mod.minAmount ?? 0, Math.abs(d) - reduce);
          d = dir === "loss" ? -newMag : newMag;
        }
      });
    }
    return d;
  }

  private drawCards(playerId: PlayerId, amount: number): void {
    const player = this.requirePlayer(playerId);

    // ContinuousAbility.drawModifiers — "increase the amount by 1" /
    // "you cannot draw cards" (Beatrix Winterbottom). Only a real draw
    // (amount > 0) counts as "drawing any number of cards".
    let effective = amount;
    if (amount > 0) {
      this.forEachActiveContinuous((source, ability, context) => {
        for (const mod of ability.drawModifiers ?? []) {
          if (
            !this.scopeMatchesPlayer(mod.player, source.controllerId, playerId)
          )
            continue;
          if (mod.prevent) {
            effective = 0;
            continue;
          }
          if (mod.delta !== undefined) {
            effective += this.evaluateNumber(mod.delta, context);
          }
        }
      });
    }
    effective = Math.max(0, effective);

    const drawn = player.deck.splice(0, effective);
    let redirected = 0;

    this.beginEventBatch();
    try {
      for (const cardId of drawn) {
        const card = this.requireCard(cardId);
        // "If a character would be put into a hand, destroy it instead"
        // (The Stone of Shame): drawing is putting the top card into your
        // hand (CR 306.1), so the replacement applies to it as well.
        if (
          this.applyReplacement(cardId, {
            event: "moveToZone",
            zone: "hand",
            from: "deck"
          })
        ) {
          continue;
        }
        // "This turn, if a card would be put into a player's hand, put it
        // into their discard pile instead" (Quotidian Misfire) covers drawing
        // too: the card never reaches the hand, so it was not drawn.
        const redirect = this.handMoveRedirectFor(cardId, playerId);
        if (redirect && redirect !== "hand") {
          this.moveCard(cardId, redirect, true, "bottom", true);
          redirected++;
          continue;
        }
        card.zone = "hand";
        card.faceDown = false;
        card.attachedTo = undefined;
        player.hand.push(cardId);

        this.emit({
          type: "cardMoved",
          cardId,
          from: "deck",
          to: "hand"
        });
      }

      if (drawn.length - redirected > 0) {
        this.emit({ type: "cardsDrawn", playerId, count: drawn.length - redirected });
      }
    } finally {
      this.endEventBatch();
    }
  }

  private shuffleInPlace<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  /**
   * Shuffles `playerId`'s deck and records the log-only `deckShuffled` event (so a UI knows any knowledge of the old
   * order is void). Same RNG draws as a bare `shuffleInPlace`; the event is never emitted through the trigger system.
   * Game-setup shuffles (factionSetup) deliberately do not go through here.
   */
  private shuffleDeckOf(playerId: PlayerId, record = true): void {
    this.shuffleInPlace(this.requirePlayer(playerId).deck);
    if (record) this.recordLogEvent({ type: "deckShuffled", playerId });
  }

  /**
   * Zone a card was in when it began a deploy (hand, discard, play for a
   * face-down card flipped up, ...), read when `cardEnteredPlay` is emitted
   * so the event can report where the card came from (`from`).
   */
  private enterOrigin = new Map<CardInstanceId, Zone>();

  /**
   * Hand cards of `playerId` that offer "reveal this card as you are playing
   * a resource" (`CardDefinition.revealFromHand`) and whose reveal-deploy
   * looks affordable now (icons met, enough ready resources for the flat
   * cost). Extra costs and picks are only checked when the deploy is made.
   */
  private resourceRevealCandidates(
    playerId: PlayerId,
    resourceCardId: CardInstanceId
  ): CardInstanceId[] {
    return Object.values(this.state.cards)
      .filter(card => {
        if (card.id === resourceCardId || card.zone !== "hand") return false;
        if (this.zoneHolderId(card) !== playerId || card.controllerId !== playerId) return false;
        const definition = this.getDefinition(card.id);
        if (!definition.revealFromHand) return false;
        return (
          this.revealGateProblem(playerId, card.id) === undefined &&
          this.revealPlayProblem(playerId, card.id) === undefined
        );
      })
      .map(card => card.id);
  }

  /** The resource whose "while you play a resource" triggers are resolving ahead of its entry into play (CR 605.1c), and the host an `attachTo` among them chose for it. */
  private resourceEntering: { cardId: CardInstanceId; attachTo?: CardInstanceId } | undefined;

  private playResourceCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    faceDown: boolean,
    emitPlayed = true,
    attachedToFaction = false
  ): void {
    const card = this.requireCard(cardId);
    const faceProblem = this.resourceFaceProblem(playerId, cardId, faceDown);
    if (faceProblem) throw new Error(faceProblem);

    card.faceDown = faceDown;
    card.attachedTo = undefined;
    // It enters play under the player who played it (a card held in a
    // non-owner's hand is theirs to play).
    card.controllerId = playerId;
    const playedFrom = card.zone;

    // CR 605.1c: "while you play a resource" effects happen after the card
    // is selected but before the resource enters play, so the triggers this
    // event queues resolve now, ahead of the move.
    let entersAttachedTo: CardInstanceId | undefined;
    if (emitPlayed) {
      const waiting = this.immediateQueue.splice(0);
      const previousEntering = this.resourceEntering;
      this.resourceEntering = { cardId };
      try {
        this.emit({
          type: "resourcePlayed",
          cardId,
          playerId,
          faceDown
        });
        this.processImmediateQueue();
      } finally {
        entersAttachedTo = this.resourceEntering?.attachTo;
        this.resourceEntering = previousEntering;
        this.immediateQueue.push(...waiting);
      }
      if (card.zone !== playedFrom) return;
    }

    this.moveCard(cardId, "play");
    if (attachedToFaction) {
      // Already spent (CR 203.7): attached to its player's faction.
      const factionId = this.requirePlayer(playerId).factionId;
      if (factionId) card.attachedTo = factionId;
    } else if (entersAttachedTo && this.state.cards[entersAttachedTo]?.zone === "play") {
      // "Enters play attached to ..." (Vilghame Manewaft): an `attachTo` that
      // a "while you play a resource" trigger aimed at the card before it
      // entered play takes hold as it enters.
      card.attachedTo = entersAttachedTo;
      this.emit({ type: "cardAttached", cardId, hostId: entersAttachedTo });
    }
    // A resource entering play (develop, a `playResource` effect, put into
    // play) is a card entering play under its player's control: SYS-49.
    this.emit({ type: "cardEnteredPlay", cardId, playerId, from: "hand" });
  }

  startGameAfterSetup(): void {
    this.readMemo = undefined;
    assert(this.state.setup.phase === "complete", "Opening setup is not complete.");
    assert(!this.state.started, "The game has already started.");

    this.state.started = true;
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.state.turnEventTally = {};
    this.state.turnDeploys = {};
    this.state.turnDestroyed = [];
    this.state.damageThisTurn = {};
    this.state.factionDamageInflictedThisTurn = {};
    this.state.influenceLostThisTurn = {};
    this.applyFactionStartOfTurn(this.state.activePlayerId);

    this.state.startingTurnFor = this.state.activePlayerId;
    this.emit({
      type: "turnStarted",
      playerId: this.state.activePlayerId
    });
    this.completeTurnStart();
  }

  /**
   * What `playerId` is choosing from in the `chooseStartingResources` setup
   * phase — the staple resource instances in their own deck, and how many to
   * pick. `null` when it isn't this seat's turn in that phase (or the phase
   * isn't running). See {@link GameSetupState} `"chooseStartingResources"`.
   */
  getStartingResourceChoice(playerId: PlayerId): StartingResourceChoice | null {
    const setup = this.state.setup;
    if (setup.phase !== "chooseStartingResources") return null;
    if (setup.order[setup.currentIndex] !== playerId) return null;

    const player = this.requirePlayer(playerId);
    const candidateCardIds = player.deck.filter(cardId =>
      isStapleResourceDefinition(this.getDefinition(cardId))
    );

    const rule = this.getFactionDefinition(playerId)?.setup.startingResources;

    // A `slots` program (Society of Magical Propriety, "1 Obsession, 1 staple
    // resource"): the player picks only the free slots; named slots are fixed.
    if (!setup.topUp && rule?.slots?.length) {
      const plan = startingSlotPlan(this, playerId, rule.slots);
      const free = plan.slots.filter(slot => slot.cardId === undefined);
      return {
        count: free.length,
        candidateCardIds: [...new Set(free.flatMap(slot => slot.candidates))],
        fixedCardIds: plan.slots.flatMap(slot => (slot.cardId ? [slot.cardId] : [])),
        distinct: false,
        slots: free.map(slot => ({ kind: slot.kind, candidateCardIds: slot.candidates }))
      };
    }
    const distinctKinds = new Set(
      candidateCardIds.map(cardId => this.getDefinition(cardId).id)
    ).size;
    // "Any N *different* staple resources" — only a real constraint on the
    // pick when the deck actually runs that many kinds.
    const distinct = Boolean(
      !setup.topUp && rule && startingStaplesMustDiffer(rule) && distinctKinds >= (setup.counts[playerId] ?? 0)
    );

    // `chosenStaples.plus` — always-included extras ("...and 1 Deception"),
    // shown alongside but not chosen. Re-resolved for real in
    // `chooseStartingResources`; here it's a display hint.
    const plus = setup.topUp
      ? []
      : this.getFactionDefinition(playerId)?.setup.startingResources.chosenStaples?.plus ?? [];
    const fixedCardIds: CardInstanceId[] = [];
    const shown = new Set<CardInstanceId>();
    for (const name of plus) {
      const lower = name.toLowerCase();
      const match = player.deck.find(
        cardId =>
          !shown.has(cardId) &&
          this.getDefinition(cardId).type === "resource" &&
          this.getDefinition(cardId).name.toLowerCase() === lower
      );
      if (match) {
        shown.add(match);
        fixedCardIds.push(match);
      }
    }

    return { count: setup.counts[playerId] ?? 0, candidateCardIds, fixedCardIds, distinct };
  }

  private chooseStartingResources(playerId: PlayerId, cardIds: CardInstanceId[]): void {
    const setup = this.state.setup;

    assert(
      setup.phase === "chooseStartingResources",
      "The starting-resource step is over."
    );
    assert(
      setup.order[setup.currentIndex] === playerId,
      "It is not this player's starting-resource decision."
    );

    const player = this.requirePlayer(playerId);
    const count = setup.counts[playerId] ?? 0;

    const slotRule = this.getFactionDefinition(playerId)?.setup.startingResources;
    if (!setup.topUp && slotRule?.slots?.length) {
      // Placed apart from the staple-only path below: one card per FREE slot,
      // in slot order; named slots ("1 Obsession") take their card themselves.
      const plan = startingSlotPlan(this, playerId, slotRule.slots);
      const free = plan.slots.filter(slot => slot.cardId === undefined);
      assert(
        cardIds.length === free.length,
        `Choose exactly ${free.length} starting card${free.length === 1 ? "" : "s"}, one per open slot.`
      );
      assert(new Set(cardIds).size === cardIds.length, "A starting resource was selected twice.");
      free.forEach((slot, i) => {
        assert(
          slot.candidates.includes(cardIds[i]),
          slot.kind === "anyCard"
            ? "A starting card must come from your deck."
            : slot.kind === "staple"
              ? "That slot takes a staple resource from your deck."
              : "That slot takes a resource from your deck."
        );
      });
      const chosen = new Map(free.map((slot, i) => [slot.slotIndex, cardIds[i]] as const));
      for (const slot of plan.slots) {
        const cardId = slot.cardId ?? chosen.get(slot.slotIndex)!;
        const card = this.requireCard(cardId);
        player.deck = player.deck.filter(id => id !== cardId);
        card.zone = "play";
        card.faceDown =
          slot.kind === "anyCard"
            ? this.getDefinition(cardId).type !== "resource"
            : (slot.faceDown ?? false);
        card.attachedTo = undefined;
        player.play.push(cardId);
      }
      setup.currentIndex++;
      if (setup.currentIndex >= setup.order.length) {
        finishFactionSetup(this, setup.askStartingDrawSearch === true);
      }
      return;
    }

    assert(
      cardIds.length === count,
      `Choose exactly ${count} starting staple resource${count === 1 ? "" : "s"}.`
    );
    assert(new Set(cardIds).size === cardIds.length, "A starting resource was selected twice.");
    for (const cardId of cardIds) {
      assert(player.deck.includes(cardId), "Starting resources must be chosen from your deck.");
      assert(
        isStapleResourceDefinition(this.getDefinition(cardId)),
        "Starting resources must be staple resources."
      );
    }

    // "Any N *different* staple resources" (Unlikely Heroes — the
    // `distinctStaples` flag; the plain Tournament Faction allows repeats).
    // Enforced only when the deck runs at least `count` kinds — a deck with
    // just one staple kind can only ever start with repeats.
    const rule = this.getFactionDefinition(playerId)?.setup.startingResources;
    if (!setup.topUp && rule && startingStaplesMustDiffer(rule)) {
      const kindsInDeck = new Set(
        player.deck
          .filter(id => isStapleResourceDefinition(this.getDefinition(id)))
          .map(id => this.getDefinition(id).id)
      ).size;
      if (kindsInDeck >= count) {
        const chosenKinds = new Set(cardIds.map(id => this.getDefinition(id).id));
        assert(
          chosenKinds.size === cardIds.length,
          `Your ${count} starting staple resources must be different from each other.`
        );
      }
    }

    // `chosenStaples.plus` — always-included extras ("...and 1 Deception"),
    // drawn from the deck after the player's own picks are reserved.
    const placed = new Set<CardInstanceId>(cardIds);
    const plus = setup.topUp
      ? []
      : this.getFactionDefinition(playerId)?.setup.startingResources.chosenStaples?.plus ?? [];
    for (const name of plus) {
      const lower = name.toLowerCase();
      const match = player.deck.find(
        cardId =>
          !placed.has(cardId) &&
          this.getDefinition(cardId).type === "resource" &&
          this.getDefinition(cardId).name.toLowerCase() === lower
      );
      assert(match, `Faction setup: no '${name}' left in ${playerId}'s deck for a starting resource.`);
      placed.add(match);
    }

    for (const cardId of placed) {
      player.deck = player.deck.filter(id => id !== cardId);
      const card = this.requireCard(cardId);
      card.zone = "play";
      card.faceDown = false;
      card.attachedTo = undefined;
      player.play.push(cardId);
    }

    setup.currentIndex++;
    if (setup.currentIndex >= setup.order.length) {
      finishFactionSetup(this, setup.askStartingDrawSearch === true);
    }
  }

  /**
   * The CR 601.1c decision while the `chooseFirstPlayer` setup phase is
   * running: who decides, and each player's opening draw for either answer.
   * `null` in every other phase. The same for every viewer.
   */
  getFirstPlayerChoice(): FirstPlayerChoice | null {
    const setup = this.state.setup;
    if (setup.phase !== "chooseFirstPlayer") return null;
    const playerIds = Object.keys(this.state.players) as PlayerId[];
    const openingDraw: FirstPlayerChoice["openingDraw"] = {};
    for (const firstPlayerId of playerIds) {
      openingDraw[firstPlayerId] = Object.fromEntries(
        playerIds.map(playerId => [playerId, openingDrawFor(this, playerId, playerId === firstPlayerId)])
      );
    }
    return { deciderId: setup.order[setup.currentIndex], openingDraw };
  }

  private chooseFirstPlayer(playerId: PlayerId, firstPlayerId: PlayerId): void {
    const setup = this.state.setup;
    assert(setup.phase === "chooseFirstPlayer", "Who goes first has already been decided.");
    assert(setup.order[setup.currentIndex] === playerId, "This player does not decide who goes first.");
    this.requirePlayer(firstPlayerId);

    this.state.activePlayerId = firstPlayerId;
    this.state.priorityPlayerId = firstPlayerId;
    this.emit({ type: "firstPlayerChosen", playerId, firstPlayerId });
    continueSetupAfterFirstPlayer(this, setup.askStartingDrawSearch === true);
  }

  /** The faction rule behind `mulligan`: "replace any number of cards" (the Tournament Faction's). */
  private hasReplaceAnyMulligan(playerId: PlayerId): boolean {
    const mulliganRule = this.getFactionDefinition(playerId)?.setup.mulligan;
    return mulliganRule?.mode === "replaceAny" && (mulliganRule.count ?? 0) > 0;
  }

  /**
   * The most cards `playerId` may send back in the mulligan, whether or not it is their seat's turn to decide yet
   * (`previewMulligan` only answers for the seat that is up): their hand size when the setup is in the mulligan
   * step, their faction offers a replace-any mulligan and their decision has not been made; 0 otherwise (not the
   * mulligan step, a faction with no such mulligan, a seat that has already decided or is not in the game).
   * `previewMulligan(...).maxCards` is this number.
   */
  getMulliganLimit(playerId: PlayerId): number {
    const setup = this.state.setup;
    if (setup.phase !== "mulligan") return 0;
    const seat = setup.order.indexOf(playerId);
    if (seat < 0 || seat < setup.currentIndex) return 0;
    if (!this.hasReplaceAnyMulligan(playerId)) return 0;
    return this.requirePlayer(playerId).hand.length;
  }

  private mulligan(playerId: PlayerId, cardIds: CardInstanceId[]): void {
    const setup = this.state.setup;

    assert(setup.phase === "mulligan", "The mulligan step is over.");
    assert(
      setup.order[setup.currentIndex] === playerId,
      "It is not this player's mulligan decision."
    );

    assert(
      this.hasReplaceAnyMulligan(playerId),
      "This faction does not provide a replace-any mulligan."
    );

    const unique = new Set(cardIds);
    assert(unique.size === cardIds.length, "A mulligan card was selected twice.");

    const player = this.requirePlayer(playerId);

    for (const cardId of cardIds) {
      assert(player.hand.includes(cardId), "Mulligan cards must be in your hand.");
    }

    // Put the selected cards on the bottom in the supplied order, then draw
    // the same number. There is no shuffle during the Tournament mulligan.
    for (const cardId of cardIds) {
      player.hand = player.hand.filter(id => id !== cardId);
      const card = this.requireCard(cardId);
      card.zone = "deck";
      player.deck.push(cardId);
    }

    // Record what was set aside — the `bottomedInMulligan` condition reads
    // this (Community Chest's "if you chose to put this card on the bottom
    // of your deck as part of your mulligan").
    if (cardIds.length) {
      (this.state.mulligan[playerId] ??= []).push(...cardIds);
      // Before the replacements are drawn: a card that reacts to being
      // bottomed (Community Chest's reveal) sees the deck as it was set aside.
      this.emit({ type: "cardsMulliganed", playerId, cardIds: [...cardIds] });
    }

    if (this.state.pendingChoice) {
      // A prompt that card raised ("you may reveal it") comes first: the
      // replacements are drawn once it is answered (`finishMulligan`).
      setup.pendingDraw = { playerId, count: cardIds.length };
      return;
    }

    this.finishMulligan(playerId, cardIds.length);
  }

  /** Draws the replacements for a mulligan and moves to the next seat (or starts the game). */
  private finishMulligan(playerId: PlayerId, drawCount: number): void {
    const setup = this.state.setup;
    if (setup.phase !== "mulligan") return;
    delete setup.pendingDraw;

    this.drawCards(playerId, drawCount);

    setup.currentIndex++;

    if (setup.currentIndex >= setup.order.length) {
      this.state.setup = { phase: "complete" };
      this.startGameAfterSetup();
    }
  }

  /**
   * Whether `playerId` may play the card `cardId` as a resource with this side up, the rule `playResourceCard`
   * (the Develop Rule, a `playResource` effect, a FLIP UP rider) holds every resource play to: the refusal, or
   * `undefined`. The card is in that player's hand; face-up needs a resource card that is not `faceDownOnly`;
   * face-down takes any card (CR 203.2).
   */
  private resourceFaceProblem(playerId: PlayerId, cardId: CardInstanceId, faceDown: boolean): string | undefined {
    const card = this.requireCard(cardId);
    if (this.zoneHolderId(card) !== playerId) return "That card is not in this player's hand.";
    if (card.zone !== "hand") return "A resource must be played from hand.";
    if (!faceDown) {
      const forced = this.forcedFaceDownReason(this.getDefinition(cardId));
      if (forced === "notAResource") return "Only a resource card can be played face-up as a resource.";
      if (forced === "faceDownOnly") return "This resource may only be played from your hand face-down.";
    }
    return undefined;
  }

  /**
   * Which side `playerId` may play the hand card `cardId` as a resource, read-only: the `playResourceCard` rule for
   * any card, not only inside the Develop Rule (`getDevelopOptions` lists the same answer per hand card). `canFaceUp`
   * and `canFaceDown` are exactly whether `playResourceCard` would take that side; `forcedFaceDown` says why
   * face-down is the only way (a card that is not a resource, or a `faceDownOnly` staple); `reason` is the engine's
   * refusal for face-up when it is not allowed (a card not in that player's hand allows neither side).
   */
  getResourcePlayFaces(playerId: PlayerId, cardId: CardInstanceId): ResourcePlayFaces {
    if (!this.state.cards[cardId]) {
      return { canFaceUp: false, canFaceDown: false, reason: `Card '${cardId}' not found.` };
    }
    const upProblem = this.resourceFaceProblem(playerId, cardId, false);
    const canFaceDown = this.resourceFaceProblem(playerId, cardId, true) === undefined;
    const forced = canFaceDown ? this.forcedFaceDownReason(this.getDefinition(cardId)) : undefined;
    return {
      canFaceUp: upProblem === undefined,
      canFaceDown,
      ...(forced ? { forcedFaceDown: forced } : {}),
      ...(upProblem !== undefined ? { reason: upProblem } : {})
    };
  }

  /** `getResourcePlayFaces(...).canFaceUp`: whether `playResourceCard` would take this card face-up. */
  canPlayResourceFaceUp(playerId: PlayerId, cardId: CardInstanceId): boolean {
    return this.getResourcePlayFaces(playerId, cardId).canFaceUp;
  }

  /** `getResourcePlayFaces(...).canFaceDown`: whether `playResourceCard` would take this card face-down. */
  canPlayResourceFaceDown(playerId: PlayerId, cardId: CardInstanceId): boolean {
    return this.getResourcePlayFaces(playerId, cardId).canFaceDown;
  }

  /**
   * Why a card can only be played as a resource face-down: `"notAResource"` (it is not a resource card; any card
   * may be played face-down as Volition, CR 203.2) or `"faceDownOnly"` (the Holy Heist FLIP IT staples).
   * `undefined` when it may also go face-up.
   */
  private forcedFaceDownReason(definition: CardDefinition): "notAResource" | "faceDownOnly" | undefined {
    if (definition.type !== "resource") return "notAResource";
    if (definition.resource?.faceDownOnly) return "faceDownOnly";
    return undefined;
  }

  /**
   * The reveal gate `chooseDevelop` checks BEFORE the resource is played: the extra icon gate of the reveal deploy
   * (FINE PRINT: [G][G][G][G]). Returns the refusal, or `undefined`.
   */
  private revealGateProblem(playerId: PlayerId, cardId: CardInstanceId): string | undefined {
    const reveal = this.getDefinition(cardId).revealFromHand;
    if (!reveal) return "That card has no 'reveal from hand' deploy option.";
    if (reveal.threshold !== undefined && !this.meetsThreshold(playerId, reveal.threshold)) {
      return "Threshold requirements for the reveal deploy are not met.";
    }
    return undefined;
  }

  /**
   * What the reveal DEPLOY needs once the resource is in play: the card's own threshold and the flat reveal cost
   * (`deployCard` with a cost override), judged on the board as it stands. Returns the refusal, or `undefined`.
   */
  private revealPlayProblem(playerId: PlayerId, cardId: CardInstanceId): string | undefined {
    const definition = this.getDefinition(cardId);
    const reveal = definition.revealFromHand;
    if (!reveal) return "That card has no 'reveal from hand' deploy option.";
    return (
      this.deployThresholdProblem(playerId, definition, cardId) ??
      this.deployNumericCostProblem(playerId, reveal.cost)
    );
  }

  /** The printed-threshold gate of a deploy (`deployCard`, and the reveal deploy's `revealPlayProblem`): the refusal, or `undefined`. */
  private deployThresholdProblem(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId: CardInstanceId
  ): string | undefined {
    return this.meetsThreshold(playerId, definition.threshold, { definition, cardId })
      ? undefined
      : "Threshold requirements are not met.";
  }

  /**
   * The numeric-cost gate of a deploy: the refusal when `numericCost` (`undefined`: not known yet, so nothing
   * to judge) is more than the resources available, else `undefined`.
   */
  private deployNumericCostProblem(playerId: PlayerId, numericCost: number | undefined): string | undefined {
    if (numericCost === undefined) return undefined;
    const available = this.getAvailableResourceCount(playerId);
    return available >= numericCost
      ? undefined
      : `Costs cannot be paid: this play costs ${numericCost} resource${numericCost === 1 ? "" : "s"}, but only ${available} ${available === 1 ? "is" : "are"} available.`;
  }

  /**
   * What a mulligan of `cardIds` would do, found by making it on a throw-away copy of the game (the live game is
   * untouched): the cards that would come in, the most cards that may be sent back, and whether a card set aside
   * raises a prompt (Community Chest's "you may reveal it") that holds the redraw. Refuses what `mulligan`
   * refuses (not this seat's turn, a card not in hand, a card twice).
   */
  previewMulligan(playerId: PlayerId, cardIds: CardInstanceId[]): MulliganPreview {
    const probe = this.cloneForProbe();
    const before = new Set(probe.requirePlayer(playerId).hand);
    probe.perform({ type: "mulligan", playerId, cardIds: [...cardIds] });

    const setup = probe.state.setup;
    // A prompt raised once setup is over is the first turn's start-of-turn triggers, not the mulligan's own.
    const paused = probe.state.pendingChoice !== undefined && setup.phase !== "complete";
    const incoming =
      setup.phase === "mulligan" && setup.pendingDraw
        ? // The prompt holds the draw: it would take the top of the deck, with the set-aside cards at the bottom.
          probe.requirePlayer(playerId).deck.slice(0, setup.pendingDraw.count)
        : probe.requirePlayer(playerId).hand.filter(id => !before.has(id));
    return {
      incoming,
      maxCards: this.getMulliganLimit(playerId),
      pausesForPrompt: paused
    };
  }

  /**
   * Whether `costs` can be paid by `playerId`, with the numbers: `need` is the numeric cost AS IT WOULD BE PAID,
   * `have` the ready resources. See {@link CostAffordabilityContext.as}: by default the way a `mayPay` offer judges
   * it (the payer's pending "reduce the next numeric cost" counted); with `as: "ability"` the way using
   * `sourceId`'s ability pays it, in-play taxes and reductions (Department of Rejections) included. Read-only.
   */
  getCostAffordability(
    playerId: PlayerId,
    costs: Cost[],
    context: CostAffordabilityContext = {}
  ): CostAffordability {
    const payerId = context.controllerId ?? playerId;
    const sourceId = context.sourceId ?? this.requirePlayer(payerId).factionId ?? "";
    const resolution: ResolutionContext = {
      sourceId,
      controllerId: payerId,
      ...(context.abilityId ? { abilityId: context.abilityId } : {}),
      selected: structuredClone(context.selected ?? {}),
      variables: { ...(context.variables ?? {}) },
      ...(context.named ? { named: { ...context.named } } : {})
    };

    let effective: Cost[];
    if (context.as === "ability" && this.state.cards[sourceId]) {
      effective = this.applyAbilityCostModifiers(
        sourceId,
        costs,
        payerId,
        resolution,
        this.reductionAdjusts(this.pendingCostReductions(payerId, this.getDefinition(sourceId).type, true)),
        playerId
      );
    } else {
      effective = this.withPendingReductions(costs, resolution).costs;
    }

    const hasNumeric = effective.some(cost => cost.type === "payResources");
    const need = hasNumeric ? this.previewNumericCost(effective, resolution) : undefined;
    const have = this.getAvailableResourceCount(payerId);

    let problem: Error | undefined;
    if (context.as === "ability") {
      // The way the ability listing judges a cost: provisional picks for discards, `pick` steps left to the use.
      const payable = effective.filter(cost => cost.type !== "pick");
      problem = this.provisionalProbeDiscardCosts(payable, resolution)
        ? this.costProblem(payable, resolution)
        : new Error("There are not enough cards to discard.");
    } else {
      problem = this.costProblem(effective, resolution);
    }

    const short = need !== undefined && have < need;
    return {
      payable: problem === undefined,
      ...(need !== undefined ? { need } : {}),
      have,
      ...(problem !== undefined
        ? {
            reason: short
              ? `Costs cannot be paid: this costs ${need} resource${need === 1 ? "" : "s"}, but only ${have} ${have === 1 ? "is" : "are"} available.`
              : problem.message
          }
        : {})
    };
  }

  /**
   * How much life a character (or structure a location) has left: its effective `life` / `structure` minus the
   * damage on it, floored at 0. 0 for any other card.
   */
  getLifeRemaining(cardId: CardInstanceId): number {
    const card = this.requireCard(cardId);
    const stat: Stat | undefined = this.hasCardType(cardId, "character")
      ? "life"
      : this.hasCardType(cardId, "location")
        ? "structure"
        : undefined;
    if (!stat) return 0;
    return Math.max(0, this.getStat(cardId, stat) - (card.damage ?? 0));
  }

  /**
   * Whether `value` may be named for a `nameValue` choice (a pending choice or a cost step), by the very check
   * `resolvePendingChoice` makes: a non-empty string, a real icon / trade, not excluded, and (for a non-resource
   * card name, when the engine has a card catalog) the name of a real non-resource card. Read-only.
   */
  checkNameValue(
    choice: { valueKind: "subtype" | "cardName" | "resourceIcon" | "trade"; exclude?: readonly string[]; nonResource?: boolean },
    value: unknown
  ): NameValueCheck {
    try {
      this.assertNameable(choice.valueKind, value, choice.exclude, choice.nonResource);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** `{ options }` for a `nameValue` choice of a closed kind, else nothing (spread into the pending choice). */
  private nameOptionsField(
    valueKind: "subtype" | "cardName" | "resourceIcon" | "trade",
    exclude?: readonly string[]
  ): { options?: string[] } {
    const options = this.nameableOptions(valueKind, exclude);
    return options ? { options } : {};
  }

  /** The closed list of values a `resourceIcon` / `trade` name may take, `exclude` removed; `undefined` for the open kinds. */
  private nameableOptions(
    valueKind: "subtype" | "cardName" | "resourceIcon" | "trade",
    exclude?: readonly string[]
  ): string[] | undefined {
    const list =
      valueKind === "resourceIcon" ? NAMEABLE_ICONS : valueKind === "trade" ? NAMEABLE_TRADES : undefined;
    return list?.filter(value => !exclude?.some(excluded => excluded.toLowerCase() === value.toLowerCase()));
  }

  /**
   * The faction's Develop Rule (CR §202.8), carried out as the effect of its start-of-turn trigger: its
   * controller picks one of the faction's choices (draw / play a resource) — a
   * `chooserSelectsOption`; the resource play is the ordinary `playResource` effect, with its own picks and
   * prompts. `uses` counts the uses left, this one included (default: the faction's `usesPerTurn`).
   */
  private offerDevelopRule(context: ResolutionContext, uses?: number): void {
    const playerId = context.controllerId;
    // Judged now, not when the trigger was queued: a Knitting Coalition may have come into play since.
    const choices = this.getDevelopChoices(playerId);
    const left = uses ?? this.developsAllowed(playerId);
    const again: Effect[] = left > 1 ? [{ type: "developRule", remaining: left - 1 }] : [];

    const options: EffectOption[] = [];
    for (const choice of choices) {
      if (choice.type === "draw") {
        options.push({
          label: `Draw ${choice.count} card${choice.count === 1 ? "" : "s"}`,
          effects: [{ type: "developRule", draw: choice.count }, ...again]
        });
      } else if (this.requirePlayer(playerId).hand.length > 0) {
        options.push({
          label: choice.count === 1 ? "Play a resource" : `Play ${choice.count} resources`,
          effects: [...Array.from({ length: choice.count }, (): Effect => ({ type: "playResource" })), ...again]
        });
      }
    }
    if (options.length === 0) return;

    this.state.pendingChoice = {
      kind: "chooserSelectsOption",
      id: this.nextId("choice"),
      playerId,
      optionCount: options.length,
      options,
      style: "oneOf",
      context
    };
  }

  /**
   * The draw choice of the Develop Rule. "If you would draw a card as part of your Develop Rule, you may
   * <instead> ..." (Arcane Escrow): the substitution is offered before drawing. A `mayPay` may pause here; the
   * plain-draw fall-through is its `elseEffects`.
   */
  private developDraw(playerId: PlayerId, count: number): void {
    let substitute = this.developDrawReplacementCardFor(playerId);
    if (substitute) {
      // Only offered when there is something to put into hand instead.
      const available = this.getDefinition(substitute).behavior!.developDrawReplacement!.available;
      if (
        available &&
        this.queryCards(available, {
          sourceId: substitute,
          controllerId: playerId,
          selected: {}
        }).length === 0
      ) {
        substitute = undefined;
      }
    }
    if (!substitute) {
      this.drawCards(playerId, count);
      return;
    }
    const replacement = this.getDefinition(substitute).behavior!.developDrawReplacement!;
    this.resolveEffect(
      {
        type: "mayPay",
        player: "controller",
        costs: replacement.cost ?? [],
        effects: replacement.effects,
        elseEffects: [{ type: "draw", player: "controller", amount: count }]
      },
      { sourceId: substitute, controllerId: playerId, selected: {} }
    );
  }

  /**
   * The faction's own "at the start of your turn" triggers (CR §202.7, §202.8, §602.2): its Restore Rule, its
   * Develop Rule, and its printed `startOfTurnEffects` (Imperial Army's discount, the Society of Magical
   * Propriety's token). Queued with the turn's other `turnStarted` triggers as one batch, so their controller
   * orders them together with everything else (Poshernacle and the like) through the usual `orderTriggers`
   * choice. Nothing the faction does at the start of the turn happens on its own.
   */
  private factionStartTriggers(
    event: Extract<GameEvent, { type: "turnStarted" }>,
    batchId: string
  ): TriggerResolution[] {
    const playerId = event.playerId;
    const factionId = this.requirePlayer(playerId).factionId;
    const faction = this.getFactionDefinition(playerId);
    if (!factionId || !faction || !this.state.cards[factionId]) return [];

    const rules: Array<{ id: string; name: string; effect: Effect }> = [];
    if (faction.turn.restore.detachResources || faction.turn.restore.restoreNonResources) {
      rules.push({ id: RESTORE_RULE_ABILITY_ID, name: "Restore Rule", effect: { type: "restoreRule" } });
    }
    if (this.getDevelopChoices(playerId).length > 0) {
      rules.push({ id: DEVELOP_RULE_ABILITY_ID, name: "Develop Rule", effect: { type: "developRule" } });
    }
    (faction.turn.startOfTurnEffects ?? []).forEach((effect, index) => {
      rules.push({ id: `${FACTION_START_EFFECT_ABILITY_ID}:${index}`, name: "Start of turn", effect });
    });
    return rules.map(rule => ({
      sourceId: factionId,
      ability: {
        type: "triggered",
        id: rule.id,
        name: rule.name,
        event: "turnStarted",
        effects: [rule.effect]
      },
      context: { sourceId: factionId, controllerId: playerId, abilityId: rule.id, event, selected: {} },
      batchId
    }));
  }

  /**
   * The faction's printed `endOfTurnEffects` (Imperial Army's coin-flip side swap) as "at the end of your turn"
   * triggers, queued with the turn's other `turnEnding` triggers as one batch.
   */
  private factionEndTriggers(
    event: Extract<GameEvent, { type: "turnEnding" }>,
    batchId: string
  ): TriggerResolution[] {
    const playerId = event.playerId;
    const factionId = this.requirePlayer(playerId).factionId;
    const effects = this.getFactionDefinition(playerId)?.turn.endOfTurnEffects ?? [];
    if (!factionId || !this.state.cards[factionId]) return [];
    return effects.map((effect, index) => {
      const id = `${FACTION_END_EFFECT_ABILITY_ID}:${index}`;
      return {
        sourceId: factionId,
        ability: { type: "triggered", id, name: "End of turn", event: "turnEnding", effects: [effect] },
        context: { sourceId: factionId, controllerId: playerId, abilityId: id, event, selected: {} },
        batchId
      };
    });
  }

  /**
   * The faction Restore Rule (CR §202.7), the effect of its start-of-turn trigger: the faction's resources are
   * detached and its controller's non-resource permanents restore. A skipped rule (Monstrous Lassitude) uses up
   * its charge and does nothing.
   */
  private applyRestoreRule(playerId: PlayerId): void {
    const player = this.requirePlayer(playerId);
    const restore = this.getFactionDefinition(playerId)?.turn.restore;

    // "On your next turn, skip your faction's RESTORE RULE." (Monstrous
    // Lassitude) — a whole-rule skip for this turn, consuming one charge.
    const skipTurns = this.state.restoreRuleSkips[playerId] ?? [];
    const skipRestore = skipTurns.includes(this.state.turn);
    this.state.restoreRuleSkips[playerId] = skipTurns.filter(
      turn => turn > this.state.turn
    );

    if (!skipRestore && restore?.detachResources && player.factionId) {
      for (const cardId of player.play) {
        const card = this.requireCard(cardId);
        if (card.attachedTo === player.factionId && this.isResource(cardId)) {
          card.attachedTo = undefined;
        }
      }
    }

    if (!skipRestore && restore?.restoreNonResources) {
      for (const cardId of [...player.play]) {
        const card = this.requireCard(cardId);
        // "that character does not restore during its controller's next
        // RESTORE RULE" (Numba 1 Stunna!) — a one-shot per-card skip.
        if (card.skipNextRestore) {
          card.skipNextRestore = undefined;
          continue;
        }
        if (
          !this.isResource(cardId) &&
          !card.restoreLocked &&
          !this.hasRestriction(cardId, "cannotBeRestored") &&
          !this.hasRestriction(cardId, "cannotBeRestoredByRule")
        ) {
          if (card.depleted) {
            card.depleted = false;
            this.emit({ type: "cardRestored", cardId });
          } else {
            card.depleted = false;
          }
        }
      }
    }
  }

  /**
   * The start-of-turn point (CR §602) — a single instant, not a phase.
   * Applies the three core start-of-turn rules (clear all character damage,
   * end all "this turn" effects, set attack eligibility). The faction's Restore
   * Rule (CR §202.7) and Develop Rule (CR §202.8) are start-of-turn triggers
   * (`factionStartTriggers`), not part of this.
   */
  private applyFactionStartOfTurn(playerId: PlayerId): void {
    const player = this.requirePlayer(playerId);

    // CR §602.1b — all "this turn" effects end at this same instant.
    // Expire `setCardType` grants first, so the loops below see reverted
    // types; a card that loses the character type this way forgets the
    // damage it took this turn (CR §208.3) — which §602.1a would clear for
    // it anyway *if* it were still a character, so clear it explicitly.
    const lostCharacterType = new Set<CardInstanceId>();
    this.state.cardTypeGrants = this.state.cardTypeGrants.filter(grant => {
      if (this.durationStillActive(grant)) return true;
      if (grant.cardType === "character") lostCharacterType.add(grant.targetId);
      return false;
    });

    // CR §602.1a — all damage on characters is cleared, everywhere, every
    // turn. Not part of any faction's Restore Rule.
    for (const card of Object.values(this.state.cards)) {
      if (
        card.zone === "play" &&
        !card.faceDown &&
        (this.hasCardType(card.id, "character") ||
          lostCharacterType.has(card.id))
      ) {
        card.damage = 0;
      }
    }

    this.state.modifiers = this.state.modifiers.filter(modifier =>
      this.durationStillActive(modifier)
    );
    this.state.areaModifiers = this.state.areaModifiers.filter(modifier =>
      this.durationStillActive(modifier)
    );
    this.state.keywordGrants = this.state.keywordGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.keywordSuppressions =this.state.keywordSuppressions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.playerKeywordGrants = this.state.playerKeywordGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.abilitySuppressions = this.state.abilitySuppressions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.restrictions = this.state.restrictions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.resourceGrants = this.state.resourceGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.provideGrants = this.state.provideGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.playRestrictions = this.state.playRestrictions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.numericCostModifiers = this.state.numericCostModifiers.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.outgoingDamageModifiers = this.state.outgoingDamageModifiers.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.battleDamageTransforms = this.state.battleDamageTransforms.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.blockRestrictionGrants = this.state.blockRestrictionGrants.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.partyRestrictionGrants = this.state.partyRestrictionGrants.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.mustBlockGrants = this.state.mustBlockGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.damagePreventionWindows = this.state.damagePreventionWindows.filter(
      w => this.durationStillActive(w)
    );
    this.state.destructionRestrictionWindows =
      this.state.destructionRestrictionWindows.filter(w =>
        this.durationStillActive(w)
      );
    this.state.subtypeGrants = this.state.subtypeGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.handMoveRedirects = this.state.handMoveRedirects.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.runtimeReplacements = this.state.runtimeReplacements.filter(
      grant =>
        grant.duration.type === "endOfBattle"
          ? true
          : this.durationStillActive(
              grant as { duration: Duration; createdTurn: number }
            )
    );
    // "This turn, take control of the character." (Mutiny Grant) — when the
    // grant lapses, control snaps back to whoever held it before.
    this.state.controlGrants = this.state.controlGrants.filter(grant => {
      if (this.durationStillActive(grant)) return true;
      if (this.state.cards[grant.cardId]) {
        this.reassignControl(grant.cardId, grant.previousControllerId);
      }
      return false;
    });
    this.state.costReductions = [];
    this.state.thresholdReductions = this.state.thresholdReductions.filter(reduction => reduction.persistent);
    this.state.damageShields = this.state.damageShields.filter(shield => shield.persistent);

    // CR §602.1c — start-of-turn attack eligibility is a core rule, not a
    // faction ability.
    for (const card of Object.values(this.state.cards)) {
      card.attackEligibleTurn = undefined;
      card.startedTurnInPlay = undefined;
    }

    for (const cardId of player.play) {
      const card = this.requireCard(cardId);

      if (
        !card.faceDown &&
        this.hasCardType(cardId, "character") &&
        card.controllerId === playerId
      ) {
        card.attackEligibleTurn = this.state.turn;
      }
    }

    // CR 204.3: "started the turn in play under your control" for EVERY
    // player's face-up permanents (not only the active player's characters).
    // Counter Attack lets the non-active player attack, and a card that
    // becomes a character mid-turn (Contrabulous Fabtraption) may attack if
    // it was in play, under its controller, when the turn began.
    for (const holder of Object.values(this.state.players)) {
      for (const cardId of holder.play) {
        const card = this.requireCard(cardId);
        if (!card.faceDown && card.controllerId === holder.id) {
          card.startedTurnInPlay = this.state.turn;
        }
      }
    }
  }

  /** A definition's printed `stat` (0 when it has none) — the starting value `getStat` / `getStatModifiers` build on. */
  private printedStat(definition: CardDefinition, stat: Stat): number {
    return stat === "influence" ? definition.influence ?? 0 : definition[stat] ?? 0;
  }

  /** The stat modifiers `getStat` applies to `cardId`'s `stat`, in order: continuous (aura) terms first, then runtime ones. */
  private statModifiersFor(cardId: CardInstanceId, stat: Stat): RuntimeModifier[] {
    const continuous = this.getContinuousModifiers(cardId, stat);
    const runtime = this.state.modifiers.filter(
      modifier =>
        modifier.targetId === cardId &&
        // "for as long as this card is in play": live check, not left to
        // the end-of-turn sweep (CR 409.2: nothing outlives its source).
        (modifier.duration.type !== "whileSourceInPlay" ||
          (!!modifier.sourceId && this.state.cards[modifier.sourceId]?.zone === "play"))
    );
    const area = this.areaModifiersFor(cardId, stat);
    if (area.length === 0) return [...continuous, ...runtime].filter(modifier => modifier.stat === stat);

    // Card-scoped and area modifiers share one id sequence: apply them in the order they were created.
    const seq = (modifier: RuntimeModifier) => Number(modifier.id.split("_").pop());
    const lasting = [...runtime.filter(modifier => modifier.stat === stat), ...area].sort((a, b) => seq(a) - seq(b));
    return [...continuous.filter(modifier => modifier.stat === stat), ...lasting];
  }

  /** Stat read in progress per `cardId:stat`, so an area modifier whose selector reads that same stat cannot recurse into itself. */
  private areaModifierReads = new Set<string>();

  /**
   * The `createAreaModifier` terms that currently reach `cardId` for `stat`, as modifiers targeting it: each live
   * entry's selector is matched against the card now, from the controller the effect resolved under.
   */
  private areaModifiersFor(cardId: CardInstanceId, stat: Stat): RuntimeModifier[] {
    if (this.state.areaModifiers.length === 0) return [];
    const card = this.state.cards[cardId];
    if (!card) return [];
    const guard = `${cardId}:${stat}`;
    if (this.areaModifierReads.has(guard)) return [];
    this.areaModifierReads.add(guard);
    try {
      const results: RuntimeModifier[] = [];
      for (const area of this.state.areaModifiers) {
        if (area.stat !== stat) continue;
        if (
          area.duration.type === "whileSourceInPlay" &&
          (!area.sourceId || this.state.cards[area.sourceId]?.zone !== "play")
        ) {
          continue;
        }
        if (area.sourceId && this.sourceClassIgnoredByTarget(cardId, area.sourceId)) continue;
        const context: ResolutionContext = {
          sourceId: area.sourceId ?? cardId,
          controllerId: area.controllerId,
          ...(area.opponentId !== undefined ? { opponentId: area.opponentId } : {}),
          abilityId: area.sourceAbilityId,
          selected: { __candidate: [cardId] }
        };
        if (!this.matchesSelector(card, area.selector, context)) continue;
        results.push({
          id: area.id,
          sourceId: area.sourceId,
          sourceAbilityId: area.sourceAbilityId,
          targetId: cardId,
          stat: area.stat,
          operation: area.operation,
          value: area.value,
          duration: area.duration,
          createdTurn: area.createdTurn
        });
      }
      return results;
    } finally {
      this.areaModifierReads.delete(guard);
    }
  }

  getStat(cardId: CardInstanceId, stat: Stat): number {
    this.requireCard(cardId);
    return this.scopedRead("stat", `${cardId}|${stat}`, () => this.computeStat(cardId, stat));
  }

  private computeStat(cardId: CardInstanceId, stat: Stat): number {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    // A faction card's "influence" is its owner's live influence pool (what
    // "an opponent's faction has 10 influence or less" — Trophy Collector,
    // Needless Beating — is asking about), not the printed CardDefinition
    // value.
    if (stat === "influence" && definition.type === "faction") {
      const owner = Object.values(this.state.players).find(
        player => player.factionId === cardId
      );
      if (owner) return owner.influence;
    }

    let value = this.printedStat(definition, stat);

    const modifiers = this.statModifiersFor(cardId, stat);

    for (const modifier of modifiers) {
      switch (modifier.operation) {
        case "add":
          value += modifier.value;
          break;

        case "set":
          value = modifier.value;
          break;

        case "multiply":
          value *= modifier.value;
          break;
      }
    }

    // CR 410.4 / 406.6: a stat an effect would push below 0 stays at 0.
    return Math.max(0, value);
  }

  /**
   * A card's activatable abilities — its `behavior.abilities` plus, for a
   * faction card, its `faction.abilities` (RULES.md §3.6), plus the abilities
   * other cards grant it and the one the players created for it
   * (RESEARCH & DEVELOPMENT), minus any that are suppressed. Read-only.
   */
  getCardActivatedAbilities(
    cardId: CardInstanceId
  ): ActivatedAbility[] {
    return this.activatedAbilityEntries(cardId)
      .filter(entry => !entry.suppressed)
      .map(entry => entry.ability);
  }

  /**
   * Every activated ability of a card, printed / faction first, then granted, then created, each with whether it is
   * suppressed (only the printed and faction ones can be). `getCardActivatedAbilities` is the unsuppressed ones.
   */
  private activatedAbilityEntries(
    cardId: CardInstanceId
  ): Array<{ ability: ActivatedAbility; suppressed: boolean }> {
    const definition = this.getDefinition(cardId);
    const printed = [
      ...(definition.behavior?.abilities ?? []),
      ...(definition.faction?.abilities ?? [])
    ]
      .filter((a): a is ActivatedAbility => a.type === "activated")
      .map(ability => ({ ability, suppressed: this.abilitySuppressed(cardId, ability.id) }));
    const others = this.getGrantedActivatedAbilities(cardId)
      // The ability the players wrote before the game (RESEARCH & DEVELOPMENT).
      .concat(this.state.cards[cardId]?.createdAbility ? [this.state.cards[cardId].createdAbility!.ability] : [])
      .map(ability => ({ ability, suppressed: false }));
    return [...printed, ...others];
  }

  /**
   * "Before the game begins, both players create the rules text for an
   * ability. This card has that ability and both players can use it." Gives
   * every faction card whose definition has `faction.playerCreatedAbility`
   * the ability the players agreed on. The input is a `CreatedAbilitySpec`
   * from the closed menu (`CREATED_ABILITY_MENU`), never free text or a raw
   * ability: an invalid spec throws (`validateCreatedAbilitySpec` lists the
   * problems). The engine builds the ability and its rules text
   * (`buildCreatedAbility`); it becomes an activated ability of that faction
   * card with `usableBy: "anyPlayer"`, so either player may use it, paying
   * its costs and resolving it as themselves. Returns how many faction
   * cards received it. Call before the game starts (setup does, from
   * `FactionGameSetupOptions.createdAbility`).
   */
  applyCreatedFactionAbility(spec: CreatedAbilitySpec): number {
    this.readMemo = undefined;
    const built = buildCreatedAbility(spec);
    let given = 0;
    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play" || !this.getDefinition(card.id).faction?.playerCreatedAbility) continue;
      card.createdAbility = {
        text: built.text,
        ability: structuredClone(built.ability),
        spec: structuredClone(spec)
      };
      given++;
    }
    return given;
  }

  /**
   * How `playerId` may borrow their opponent's activated abilities
   * (`ContinuousAbility.canUseOpponentAbilities`, The Billionaire), from the
   * in-play sources they control: `"ownNumeric"` (the activator pays the
   * numeric cost), `"asOpponent"` (the opponent pays every cost), or
   * `undefined` when no live source grants it. `"ownNumeric"` wins when
   * live sources disagree.
   */
  private opponentAbilityBorrowMode(
    playerId: PlayerId
  ): "ownNumeric" | "asOpponent" | undefined {
    let mode: "ownNumeric" | "asOpponent" | undefined;
    this.forEachActiveContinuous((source, ability) => {
      if (!ability.canUseOpponentAbilities || source.controllerId !== playerId) {
        return;
      }
      if (ability.canUseOpponentAbilities === "asOpponent") {
        mode ??= "asOpponent";
      } else {
        mode = "ownNumeric";
      }
    });
    return mode;
  }

  /**
   * The borrow mode `playerId` uses `ability` on `card` under, or
   * `undefined` when it isn't a borrowed use: their own card, or one marked
   * for both players / only an opponent (`usableBy`), which the activator
   * uses as themselves.
   */
  private borrowedAbilityMode(
    playerId: PlayerId,
    card: CardInstance,
    ability: ActivatedAbility
  ): "ownNumeric" | "asOpponent" | undefined {
    if (
      card.controllerId === playerId ||
      ability.usableBy === "anyPlayer" ||
      ability.usableBy === "opponent" ||
      ability.usableBy === "heroes"
    ) {
      return undefined;
    }
    return this.opponentAbilityBorrowMode(playerId);
  }

  /**
   * Splits a borrowed ability's costs for `"ownNumeric"` mode: the numeric
   * (`payResources`) total the activator pays, and the remaining costs the
   * opponent satisfies.
   */
  private splitBorrowedNumericCost(
    costs: Cost[],
    context: ResolutionContext
  ): { numeric: number; rest: Cost[] } {
    const numeric = costs
      .filter(
        (c): c is Extract<Cost, { type: "payResources" }> =>
          c.type === "payResources"
      )
      .reduce((sum, c) => sum + this.payAmount(c, context), 0);
    return { numeric, rest: costs.filter(c => c.type !== "payResources") };
  }

  /**
   * The activated abilities `playerId` could use right now: exactly the
   * {@link getActivatedAbilityStatuses} entries that are available.
   */
  getAvailableActivatedAbilities(
    playerId: PlayerId
  ): Array<{ cardId: CardInstanceId; ability: ActivatedAbility }> {
    return this.abilityStatuses(playerId, true).map(({ cardId, ability }) => ({ cardId, ability }));
  }

  /**
   * Every activated ability `playerId` may use on a card in play (their own, ones marked for both players or for
   * an opponent, borrowed ones), each with whether it is offered now and, if not, the first gate that fails.
   * `getAvailableActivatedAbilities` is the available ones. A face-down card of the opponent's is not listed.
   */
  getActivatedAbilityStatuses(playerId: PlayerId): ActivatedAbilityStatus[] {
    return this.abilityStatuses(playerId, false);
  }

  /**
   * The one walk behind both ability listings. With `onlyAvailable`, abilities that are out are skipped without
   * working out why (the hot path of the bots); otherwise every ability the player may use is reported.
   */
  private abilityStatuses(playerId: PlayerId, onlyAvailable: boolean): ActivatedAbilityStatus[] {
    const timingOk = this.canUseAbilityAtCurrentTiming(playerId);
    if (!timingOk && onlyAvailable) {
      return [];
    }

    const result: ActivatedAbilityStatus[] = [];

    for (const card of Object.values(this.state.cards)) {
      const zone = card.zone;
      // Abilities are used from the card's own zone (`abilityActivationZone`): the board for most, the discard pile
      // / hand / void for RECUR, NINE LIVES, HELPING PAW and the like. Other zones list nothing.
      if (zone !== "play" && zone !== "hand" && zone !== "discard" && zone !== "void") continue;
      if (zone !== "play" && !this.hasPrintedAbilityActivatedFrom(card.id, zone)) continue;
      const restricted = this.hasRestriction(card.id, "cannotUseAbilities");
      if (restricted && onlyAvailable) continue;
      const controlsIt = card.controllerId === playerId;

      for (const { ability, suppressed } of this.activatedAbilityEntries(card.id)) {
        // The same zone gate `activateAbility` makes: an in-play card lists none of its discard-pile abilities, a
        // card in the discard pile none of its in-play ones.
        if (this.abilityActivationZone(ability) !== zone) continue;
        if (suppressed && onlyAvailable) continue;
        // A face-down card is an anonymous resource — only its abilities
        // marked `fromFaceDown` are live (FLIP IT on the staple-resource
        // cycle; Fired Hand PETTY VENGEANCE; Vorpal Sword SNICKER SNACK).
        // Mirrors the same gate in `activateAbility` (which applies it to
        // `play`-zone abilities only).
        const faceDownInert = zone === "play" && card.faceDown && !ability.fromFaceDown;
        // (A card hidden from the asker is not described.)
        if (faceDownInert && (onlyAvailable || !controlsIt)) continue;
        // A non-controlled card only offers abilities marked "both players
        // may use this" (The Knitting Coalition — INFLATIONARY FORCES) or
        // "only an opponent may use this" (iDumb De-Itemizer — RESET) —
        // unless the player borrows opponent abilities (The Billionaire).
        const borrowMode = this.borrowedAbilityMode(playerId, card, ability);
        if (
          !controlsIt &&
          ability.usableBy !== "anyPlayer" &&
          ability.usableBy !== "opponent" &&
          ability.usableBy !== "heroes" &&
          !borrowMode
        ) {
          continue;
        }
        // "Only an opponent may use this ability" — hidden from the controller.
        if (controlsIt && ability.usableBy === "opponent") continue;
        // "All Heroes can use abilities on this card" (SD-SLE 1) — only Heroes.
        if (ability.usableBy === "heroes" && !isHero(this.state, playerId)) continue;

        const because: AbilityUnavailableReason | undefined = !timingOk
          ? "timing"
          : restricted
            ? "restricted"
            : suppressed
              ? "suppressed"
              : faceDownInert
                ? "faceDown"
                : this.abilityCostReason(playerId, card, ability, borrowMode);
        if (because && onlyAvailable) continue;

        result.push({
          cardId: card.id,
          ability,
          zone,
          available: because === undefined,
          ...(because ? { unavailableBecause: because } : {})
        });
      }
    }

    return result;
  }

  /** The zone an activated ability is used from: its `activationZone`, else the board (`activateAbility`'s zone gate). */
  private abilityActivationZone(ability: ActivatedAbility): Zone {
    return ability.activationZone ?? "play";
  }

  /** Whether the card's printed (or faction) abilities include an activated one used from `zone`. Cheap pre-filter for the listing. */
  private hasPrintedAbilityActivatedFrom(cardId: CardInstanceId, zone: Zone): boolean {
    const definition = this.getDefinition(cardId);
    const printed = definition.behavior?.abilities;
    const factionAbilities = definition.faction?.abilities;
    if (printed) {
      for (const a of printed) if (a.type === "activated" && this.abilityActivationZone(a) === zone) return true;
    }
    if (factionAbilities) {
      for (const a of factionAbilities) if (a.type === "activated" && this.abilityActivationZone(a) === zone) return true;
    }
    return false;
  }

  /**
   * The per-ability gates of the listing that need the board: per-turn uses, the numeric cost as it will be paid
   * (taxes, reductions, a pending "reduce the next numeric cost"), the condition, the declared targets and the
   * rest of the costs. Returns the first that fails, or `undefined` when the ability is offered.
   */
  private abilityCostReason(
    playerId: PlayerId,
    card: CardInstance,
    ability: ActivatedAbility,
    borrowMode: "ownNumeric" | "asOpponent" | undefined
  ): AbilityUnavailableReason | undefined {
    // The printed threshold, judged for the player the ability resolves as: the first gate `activateAbility` makes
    // after the timing ones.
    if (!this.abilityThresholdMet(borrowMode ? card.controllerId : playerId, ability)) return "threshold";

    // Not offered once it is locked for the turn ("it cannot be used
    // again this turn") or its per-turn uses are spent: the same gates
    // `activateAbility` refuses on.
    {
      const usesKey = `${card.id}:${ability.id}`;
      const uses = this.state.abilityUsesThisTurn[usesKey] ?? 0;
      if (uses >= Number.MAX_SAFE_INTEGER) return "usesSpent";
      if (ability.usesPerTurn !== undefined && uses >= ability.usesPerTurn) {
        return "usesSpent";
      }
    }

    // A borrowed opponent ability resolves "as if your opponent used
    // it" — condition / costs are checked as that opponent, except the
    // numeric cost in "ownNumeric" mode, which the borrower pays.
    const asPlayerId = borrowMode ? card.controllerId : playerId;

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: asPlayerId,
      abilityId: ability.id,
      ...(borrowMode ? { payerId: playerId } : {}),
      selected: {}
    };

    // Offered only if the numeric cost AS IT WILL BE PAID (taxes, reductions, a pending "reduce the next numeric
    // cost") can be paid: the same fold `activateAbility` makes.
    let costs = this.applyAbilityCostModifiers(
      card.id,
      ability.costs ?? [],
      asPlayerId,
      context,
      this.reductionAdjusts(
        this.pendingCostReductions(
          borrowMode === "ownNumeric" ? playerId : asPlayerId,
          this.getDefinition(card.id).type,
          true
        )
      ),
      playerId
    );
    if (borrowMode === "ownNumeric") {
      const split = this.splitBorrowedNumericCost(costs, context);
      if (this.getAvailableResourceIds(playerId).length < split.numeric) return "cost";
      costs = split.rest;
    }

    if (ability.condition && !this.evaluateCondition(ability.condition, context)) {
      return "condition";
    }
    if (
      !this.provisionalProbeTargets(
        ability.targets ?? [],
        context,
        this.pickStepIds(costs)
      )
    ) {
      return "targets";
    }
    if (!this.provisionalProbeDiscardCosts(costs, context)) return "cost";
    // A `pick` step is judged on the board after the costs before it, which a listing cannot
    // know yet (the pick may only become legal once a cost has been paid): leave it to the play.
    const payable = costs.filter(c => c.type !== "pick");
    if (!this.canPayCosts(payable, context)) {
      return this.costDepletesDepletedCard(payable, context) ? "depleted" : "cost";
    }
    return undefined;
  }

  /** True when one of `costs` depletes a card that is already depleted (a "tap" cost on a tapped source). */
  private costDepletesDepletedCard(costs: readonly Cost[], context: ResolutionContext): boolean {
    return costs.some(cost => {
      if (cost.type !== "deplete") return false;
      try {
        const targetId = this.resolveTargetRef(cost.target, context);
        return targetId !== undefined && this.state.cards[targetId]?.depleted === true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Read-only availability probe helper: provisionally bind each of an
   * ability's own `targets` declarations to a plausible legal pick, so a
   * cost that references one (`{ type: "selected", id }` — Hollow Moose
   * INFILTRATE destroys the item/character you choose) can be simulated by
   * `canPayCosts` instead of failing on a missing target and hiding the
   * whole ability. Returns false only when a mandatory declaration has
   * fewer legal candidates than it requires — the ability genuinely can't
   * be used right now. Mutates `context.selected`; the caller passes a
   * throwaway context.
   */
  private provisionalProbeTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext,
    /** Declarations a `pick` cost step positions after earlier costs: no candidate is needed yet. */
    orderedPickIds: ReadonlySet<string> = new Set()
  ): boolean {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) continue;

      const candidates = this.targetCandidates(declaration.selector, context);
      const count = this.evaluateNumber(declaration.count, context);

      if (
        !declaration.optional &&
        candidates.length < count &&
        !orderedPickIds.has(declaration.id)
      ) {
        return false;
      }

      context.selected[declaration.id] = candidates
        .slice(0, count)
        .map(candidate => candidate.id);
    }

    return true;
  }

  /**
   * Read-only availability probe helper, sibling to `provisionalProbeTargets`:
   * a `discard` cost carries its own `selector`/`count` rather than pointing
   * at an ability `targets` declaration (see `Cost` in
   * src/types/costs.ts), so nothing else fills `context.selected[cost.id]`
   * before `canPayCosts` simulates it — without this, `payCost`'s "requires
   * selecting exactly N card(s)" assert always fails and the ability never
   * shows as available (Tad Disingenuous UNDERHANDED DEAL: "discard a card"
   * with a legal card in hand). Mirrors the selector defaults `payCost`
   * itself applies. Mutates `context.selected`; the caller passes a
   * throwaway context.
   */
  private provisionalProbeDiscardCosts(
    costs: Cost[],
    context: ResolutionContext
  ): boolean {
    for (const cost of costs) {
      if (cost.type !== "discard") continue;
      if (context.selected[cost.id]?.length) continue;

      const candidates = this.costPickCandidates(cost, context);

      const discardCount = Math.max(0, this.evaluateNumber(cost.count, context));
      if (candidates.length < discardCount) return false;

      context.selected[cost.id] = candidates.slice(0, discardCount);
    }

    return true;
  }

  /**
   * The cards a `discard` / `moveSelected` cost step takes, judged: exactly its count, none twice, each one a
   * legal candidate (`costPickCandidates`). Returns the selection (a "this card" move with nothing picked takes the
   * source itself). The check behind paying the step and the read-only `checkSelection`.
   */
  private assertCostPickSelection(
    cost: Extract<Cost, { type: "discard" | "moveSelected" }>,
    context: ResolutionContext
  ): CardInstanceId[] {
    const legal = new Set(this.costPickCandidates(cost, context));
    // `selector.name === "__self"` is the sentinel for "this card itself" (Key to the City's UNLOCK POTENTIAL,
    // Quilt of Old Banners' HAND IT DOWN): a self-discard / self-shuffle cost never needs an explicit `selected`.
    const isSelf = cost.type === "moveSelected" && cost.selector.name === "__self";
    const selected =
      context.selected[cost.id]?.length
        ? context.selected[cost.id]
        : isSelf && context.sourceId
          ? [context.sourceId]
          : context.selected[cost.id] ?? [];
    const count = Math.max(0, this.evaluateNumber(cost.count, context));
    const label = cost.type === "discard" ? "Discard cost" : "Move-selected cost";
    const illegalLabel = cost.type === "discard" ? "discard-cost" : "move-selected-cost";
    assert(
      selected.length === count,
      `${label} '${cost.id}' requires selecting exactly ${count} card(s).`
    );
    assert(
      new Set(selected).size === selected.length,
      `${label} '${cost.id}' selected the same card more than once.`
    );
    for (const cardId of selected) {
      assert(
        legal.has(cardId),
        `Illegal ${illegalLabel} selection '${cardId}' for '${cost.id}'.`
      );
    }
    return selected;
  }

  /**
   * The cards a `discard` / `moveSelected` cost step may take, in board order: the cost's selector with the
   * defaults `payCost` applies (yours; the hand for a discard, play for a move), held by the cost's player. A
   * "this card" move (`selector.name === "__self"`) takes the source itself. The one definition behind paying
   * the step, the availability probe and the candidates `getPlayRequirements` offers for it.
   */
  private costPickCandidates(
    cost: Extract<Cost, { type: "discard" | "moveSelected" }>,
    context: ResolutionContext
  ): CardInstanceId[] {
    if (cost.type === "moveSelected" && cost.selector.name === "__self") {
      return context.sourceId ? [context.sourceId] : [];
    }
    const player = this.resolvePlayerRef(cost.player, context);
    const zone = cost.selector.zone ?? (cost.type === "discard" ? "hand" : "play");
    // CR 401.2a: paying as though one were the opponent uses only what one knows, so another player's hand is
    // open to the pick only while an ongoing effect reveals it.
    if (
      zone === "hand" &&
      context.payerId !== undefined &&
      context.payerId !== player.id &&
      !this.getRevealedZones().hands.includes(player.id)
    ) {
      return [];
    }
    return this.queryCards(
      {
        ...cost.selector,
        controller: cost.selector.controller ?? "self",
        zone
      },
      context
    )
      .filter(card => card.controllerId === player.id)
      .map(card => card.id);
  }

  /**
   * Whether `cardId` (which must be in `playerId`'s hand) could be deployed right now — the same
   * timing/threshold/numeric-cost gates `playCard` itself enforces, exposed read-only so a UI can
   * warn (or grey a card out) *before* walking the player through target selection for something
   * that was never payable, instead of only finding out from `perform()` rejecting it at the end.
   * Doesn't cover a card's targets or extra costs (deplete/discard/destroy/depleteSelected) —
   * those depend on selections the player hasn't made yet, so `perform()` is still the last word
   * on whether a specific play actually goes through.
   */
  getCardPlayability(playerId: PlayerId, cardId: CardInstanceId): CardPlayability {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    // A void / removed card the player may deploy "as though it were in hand" (Cheats, Pant Swipe, Voidal
    // Tactician) is judged like a hand card — the same gate `deployCard` uses (`outsideHandPlayAccess`).
    const outsideAccess = this.outsideHandPlayAccess(cardId, playerId);

    let legalTiming = false;
    let blockedBy: CardPlayBlock | undefined;
    if ((card.controllerId === playerId && card.zone === "hand") || outsideAccess) {
      // The same gate `deployCard` throws from (`assertCanDeployAtCurrentTiming`), kept as a structured reason.
      blockedBy = this.deployBlock(playerId, definition, cardId);
      legalTiming = !blockedBy;
    }

    // A card can also carry a play-timing restriction beyond the normal
    // phase / response-window rules — "EXTRA COST: Deploy this only on your
    // turn" (Hasty Pursuit, modeled as an `isActivePlayer` condition),
    // "deploy this only while you are the defender" (Ambuscade), "only if
    // you've deployed 2+ non-resources this turn" (633fy 31f). `deployCard`
    // rejects a failing one outright ("This card cannot be deployed right
    // now"), so it belongs in `legalTiming` too — otherwise a UI shows the
    // card as castable and only the dispatched play reveals it wasn't.
    // Skipped for a modal card (which mode, hence which condition, isn't
    // chosen yet) and for a condition gated on a not-yet-picked "choose a
    // number for X" (Cowslaw's "X > 0"); `perform()` stays the last word on
    // both, same as it already is for targets and extra costs.
    if (legalTiming && !this.playConditionHolds(playerId, cardId, definition)) {
      legalTiming = false;
      blockedBy = { kind: "condition", sourceId: cardId, text: "This card cannot be deployed right now." };
    }

    const thresholdMet =
      outsideAccess?.ignoreThreshold ||
      this.meetsThreshold(playerId, definition.threshold, {
        definition,
        cardId
      });

    const pendingReductions = this.pendingCostReductions(playerId, definition.type, false);

    // Best-case "EXTRA COST: reduce this card's numeric cost by..." adjust —
    // see `getBestCaseCostAdjust`. Optimistic because a selection-based
    // reduction isn't locked in until the player makes that selection;
    // `deployCard` re-evaluates for real once it has one.
    const costAdjust = this.getBestCaseCostAdjust(definition, playerId, cardId);

    const numericCost = this.applyNumericAdjusts(
      definition.cost ?? 0,
      this.deployCostAdjusts(playerId, cardId, costAdjust, pendingReductions)
    );
    const availableResources = this.getAvailableResourceCount(playerId);

    return {
      playable: legalTiming && thresholdMet && availableResources >= numericCost,
      legalTiming,
      thresholdMet,
      numericCost,
      availableResources,
      ...(blockedBy ? { blockedBy } : {}),
      ...(outsideAccess
        ? {
            fromZone: card.zone,
            thresholdWaived: outsideAccess.ignoreThreshold,
            ...(outsideAccess.grantSourceId ? { grantSourceId: outsideAccess.grantSourceId } : {})
          }
        : {})
    };
  }

  /**
   * Every void / removed-from-game card `playerId` may currently deploy "as though it were in hand": a persistent
   * play grant (Cheats, the Dirty Rotten; Pant Swipe; Eccentric Inquisition) or a live aura (Voidal Tactician, only
   * while it is depleted). All of them are listed, playable now or not — `playability` says whether and why not
   * (it is `getCardPlayability`, so a missing threshold the grant waives reads as met, the numeric cost is still
   * charged). Deploy one with a normal `playCard` action. `getPlayableHandCards` stays hand-only.
   */
  getPlayableFromOutsideHand(playerId: PlayerId): OutsideHandPlay[] {
    this.requirePlayer(playerId);
    const result: OutsideHandPlay[] = [];
    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "void" && card.zone !== "removed") continue;
      const access = this.outsideHandPlayAccess(card.id, playerId);
      if (!access) continue;
      result.push({
        cardId: card.id,
        zone: card.zone,
        faceDown: !!card.faceDown,
        source: access.source,
        ...(access.grantSourceId ? { grantSourceId: access.grantSourceId } : {}),
        ignoreThreshold: access.ignoreThreshold,
        playability: this.getCardPlayability(playerId, card.id)
      });
    }
    return result;
  }

  /**
   * What `cardId` has named ("name a card" / "name a subtype": Incriminating Photograph, Port Manteau), by variable
   * key — `CardInstance.namedValues` as a copy. The card that named a value is the card itself, so a UI shows
   * "Incriminating Photograph named X" from `getNamedValues(photographId)`. Empty when it has named nothing.
   * A play ban made from such a name reports itself in `CardPlayability.blockedBy` (`kind: "namedBan"`).
   */
  getNamedValues(cardId: CardInstanceId): Record<string, string> {
    return { ...(this.requireCard(cardId).namedValues ?? {}) };
  }

  /**
   * Whether `viewerId` may look at the card in the void / removed-from-game zone. A face-up card is visible to
   * everyone. A card put there FACE-DOWN by a card's own effect (Pant Swipe, Arcane Escrow) is visible to the player
   * who put it there (`CardInstance.faceDownBy`: the effect source's controller), or the controller of an in-play card
   * with `ContinuousAbility.mayLookAtVoided` matching it (Arcane Escrow); both cards' text allow it ("You are still allowed to look at them", "You may look at cards voided by this card").
   *
   * LIMITS: nothing in the card data says who else, if anyone, may look (the owner of a card an opponent voided, a
   * face-down card with no recorded voider), so they read `false`. Other zones
   * (hand, deck, a face-down card in play) are not modelled here and read `true` — apply the usual hidden-zone rules.
   */
  canViewerSeeVoidedCard(viewerId: PlayerId, cardId: CardInstanceId): boolean {
    this.requirePlayer(viewerId);
    const card = this.requireCard(cardId);
    if (card.zone !== "void" && card.zone !== "removed") return true;
    if (!card.faceDown) return true;
    if (card.faceDownBy === viewerId) return true;
    // A standing "you may look at cards voided by this card" (Arcane Escrow): its controller, while it is in play.
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown || source.controllerId !== viewerId) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.mayLookAtVoided) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, context)) continue;
        if (this.matchesSelector(card, ability.mayLookAtVoided.selector, context)) return true;
      }
    }
    return false;
  }

  /**
   * Every delayed or lingering effect the game is waiting on (see {@link PendingDelayedEffect}): `scheduleEffect`
   * riders, skipped Restore Rules, restore locks, timed take-controls and end-of-turn removals of borrowed cards.
   * With `playerId`, only the ones it owns (the effect's controller) or that act on a card that player controls.
   * Descriptions are viewer-safe (names only; a face-down card stays "a face-down card"). `terminateEndOfTurn`
   * (Lost on Floor 3) is immediate, not delayed, so it never appears.
   */
  getPendingDelayedEffects(playerId?: PlayerId): PendingDelayedEffect[] {
    if (playerId !== undefined) this.requirePlayer(playerId);
    const result: PendingDelayedEffect[] = [];
    const activeId = this.state.activePlayerId;
    // The next turn belonging to `owner`; the current turn's start has already passed.
    const nextTurnOf = (owner: PlayerId): number => this.turnNumberOfNextTurn(owner);

    for (const s of this.state.scheduledEffects) {
      const affected = new Set<CardInstanceId>();
      for (const ids of Object.values(s.selected ?? {})) {
        for (const id of ids) if (this.state.cards[id]) affected.add(id);
      }
      const turn =
        s.when === "endOfTurn"
          ? s.turnScheduled
          : s.when === "startOfNextTurn"
            ? nextTurnOf(s.controllerId)
            : s.when === "startOfOpponentNextTurn" || s.when === "startOfTheNextTurn"
              ? s.turnScheduled + 1
              : undefined;
      result.push({
        id: s.id,
        kind: "scheduledEffect",
        sourceId: s.sourceId,
        controllerId: s.controllerId,
        when: s.when,
        ...(turn !== undefined ? { turn } : {}),
        ...(affected.size > 0 ? { affectedCardIds: [...affected] } : {}),
        text: `${this.logCardName(s.sourceId)}: ${this.describeDelayedWhen(s.when, s.controllerId)}`
      });
    }

    for (const [owner, turns] of Object.entries(this.state.restoreRuleSkips)) {
      for (const turn of turns) {
        result.push({
          id: `restoreRuleSkip:${owner}:${turn}`,
          kind: "restoreRuleSkip",
          controllerId: owner,
          when: "startOfNextTurn",
          turn,
          text: `${this.logPlayerName(owner)}'s Restore Rule is skipped on turn ${turn}`
        });
      }
    }

    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play") continue;
      const name = this.logCardName(card.id);
      if (card.skipNextRestore) {
        result.push({
          id: `skipNextRestore:${card.id}`,
          kind: "skipNextRestore",
          controllerId: card.controllerId,
          when: "startOfNextTurn",
          turn: nextTurnOf(card.controllerId),
          affectedCardIds: [card.id],
          text: `${name} does not restore in ${this.logPlayerName(card.controllerId)}'s next Restore Rule`
        });
      }
      if (card.restoreLocked) {
        result.push({
          id: `restoreLock:${card.id}`,
          kind: "restoreLock",
          controllerId: card.controllerId,
          when: "whileInPlay",
          affectedCardIds: [card.id],
          text: `${name} cannot be restored by the Restore Rule`
        });
      }
      if (card.borrowedUntilEndOfTurn) {
        result.push({
          id: `removeAtEndOfTurn:${card.id}`,
          kind: "removeAtEndOfTurn",
          controllerId: card.controllerId,
          when: "endOfTurn",
          turn: this.state.turn,
          affectedCardIds: [card.id],
          text: `${name} is removed from the game at the end of the turn`
        });
      }
    }

    for (const grant of this.state.controlGrants) {
      const duration = grant.duration;
      const when: DelayedEffectWhen =
        duration.type === "untilEndOfTurn"
          ? "endOfTurn"
          : duration.type === "untilStartOfNextTurn"
            ? "startOfNextTurn"
            : duration.type === "untilEndOfNextTurn"
              ? "endOfNextTurn"
              : duration.type === "endOfBattle"
                ? "endOfBattle"
                : "whileInPlay";
      const turn =
        duration.type === "untilEndOfTurn"
          ? grant.createdTurn
          : duration.type === "untilStartOfNextTurn" || duration.type === "untilEndOfNextTurn"
            ? duration.untilTurn
            : undefined;
      const moment =
        when === "endOfBattle"
          ? "the end of the battle"
          : when === "whileInPlay"
            ? "the source leaves play"
            : when === "endOfNextTurn"
              ? "the end of the next turn"
              : when === "endOfTurn"
                ? "the end of the turn"
                : "the start of the next turn";
      result.push({
        id: grant.id,
        kind: "controlReturn",
        controllerId: grant.previousControllerId,
        when,
        ...(turn !== undefined ? { turn } : {}),
        affectedCardIds: [grant.cardId],
        text: `${this.logCardName(grant.cardId)} returns to ${this.logPlayerName(grant.previousControllerId)} at ${moment}`
      });
    }

    if (playerId === undefined) return result;
    return result.filter(
      e =>
        e.controllerId === playerId ||
        (e.affectedCardIds ?? []).some(id => this.state.cards[id]?.controllerId === playerId)
    );
  }

  /**
   * Every effect that applies to a whole player rather than to a card (see {@link PlayerEffect}), built from the very
   * state the rules read: pending `reduceNextCost` / `reduceThreshold` reductions (1337!, Clockman Skydocks ...),
   * `grantResourceIcons` grants (31337!), runtime `restrictPlay` bans (the ones `CardPlayability.blockedBy` reports),
   * `grantKeywordToPlayer` grants (Hasty Pursuit), skipped Restore Rules (Monstrous Lassitude), and the in-play
   * continuous `drawModifiers` (Beatrix Winterbottom), `preventsDefeat` (Armored Keep) and `emptyDeckLoses`
   * (Trickster's Globe) abilities, read through the same `forEachActiveContinuous` gate (face-up, not suppressed,
   * condition holding) the mutating paths use. Descriptions are viewer-safe: a face-down card is "a face-down card"
   * and its id is left out of `sourceId`.
   *
   * NOT covered: the other static rules text of cards in play (attack limits / attack taxes such as Narrow Passage and
   * the Ministry, search taxes, influence modifiers, `playRestrictions` of Geldale / Lockbox ...) - it is printed on the
   * face-up card, and a hand card those bans stop already says so through `blockedBy`.
   */
  getPlayerEffects(playerId: PlayerId): PlayerEffect[] {
    this.requirePlayer(playerId);
    const result: PlayerEffect[] = [];
    const who = this.logPlayerName(playerId);
    const prefix = (source: CardInstanceId | undefined): string =>
      source && this.state.cards[source] ? `${this.logCardName(source)}: ` : "";
    const suffix = (d: ActiveProtectionDuration): string =>
      d === "thisTurn"
        ? " this turn"
        : d === "untilEndOfBattle"
          ? " this battle"
          : d === "untilStartOfNextTurn"
            ? " until the start of the next turn"
            : d === "untilEndOfNextTurn"
              ? " until the end of the next turn"
              : d === "whileSourceInPlay"
                ? " while its source stays in play"
                : "";
    const add = (entry: Omit<PlayerEffect, "playerId">, rawSource?: CardInstanceId): void => {
      const sourceId = this.publicSourceId(rawSource);
      const full: PlayerEffect = { ...entry, playerId };
      if (sourceId) full.sourceId = sourceId;
      result.push(full);
    };
    const tail = (duration: Duration): { duration: ActiveProtectionDuration; untilTurn?: number; end: string } => {
      const d = this.protectionDuration(duration);
      return { ...d, end: suffix(d.duration) };
    };

    // reduceNextCost: pending, consumed by the next matching play, cleared at end of turn.
    for (const r of this.state.costReductions) {
      if (r.playerId !== playerId) continue;
      const less = r.amount >= 0 ? `${r.amount} less` : `${-r.amount} more`;
      const text = r.cardType
        ? `${who}'s next ${r.cardType}${r.includeAbilities ? " (and its abilities)" : ""} costs ${less}`
        : r.cardsOnly
          ? `${who}'s next card costs ${less} to play`
          : `${who}'s next numeric cost is ${less}`;
      add({
        id: r.id,
        kind: "costReduction",
        duration: "nextTime",
        text,
        amount: r.amount,
        ...(r.cardType ? { cardType: r.cardType } : {})
      });
    }

    // reduceThreshold: Clockman Skydocks.
    for (const r of this.state.thresholdReductions) {
      if (r.playerId !== playerId) continue;
      add({
        id: r.id,
        kind: "thresholdReduction",
        duration: r.persistent ? "untilSpent" : "nextTime",
        text: `${who}'s next card needs ${r.amount} fewer ${r.icon} in its threshold`,
        amount: r.amount,
        icon: r.icon
      });
    }

    // grantResourceIcons: 31337!.
    for (const g of this.state.resourceGrants) {
      if (g.playerId !== playerId) continue;
      const t = tail(g.duration);
      add({
        id: g.id,
        kind: "resourceGrant",
        duration: t.duration,
        ...(t.untilTurn !== undefined ? { untilTurn: t.untilTurn } : {}),
        text: `${who} controls an additional ${g.amount} ${g.icon}${t.end}`,
        amount: g.amount,
        icon: g.icon
      });
    }

    // restrictPlay: the runtime bans `blockedBy` / the flip-up gate read.
    for (const r of this.state.playRestrictions) {
      if (r.playerId !== playerId) continue;
      const t = tail(r.duration);
      add(
        {
          id: r.id,
          kind: "playRestriction",
          duration: t.duration,
          ...(t.untilTurn !== undefined ? { untilTurn: t.untilTurn } : {}),
          text: `${prefix(this.publicSourceId(r.sourceId))}${who} cannot play ${
            r.kind === "flipUp" ? "cards using FLIP UP" : `${r.cardType ?? "such"} cards`
          }${t.end}`,
          ...(r.cardType ? { cardType: r.cardType } : {})
        },
        r.sourceId
      );
    }

    // grantKeywordToPlayer: Hasty Pursuit, Crushjaw Oceanhide.
    for (const g of this.state.playerKeywordGrants) {
      if (g.playerId !== playerId) continue;
      const t = tail(g.duration);
      add(
        {
          id: g.id,
          kind: "keywordGrant",
          duration: t.duration,
          ...(t.untilTurn !== undefined ? { untilTurn: t.untilTurn } : {}),
          text: `${prefix(this.publicSourceId(g.sourceId))}Characters ${who} controls have ${g.keyword.toUpperCase()}${t.end}`,
          keyword: g.keyword
        },
        g.sourceId
      );
    }

    // skipRestoreRule: Monstrous Lassitude (the same list `getPendingDelayedEffects` reports).
    for (const turn of this.state.restoreRuleSkips[playerId] ?? []) {
      add({
        id: `restoreRuleSkip:${playerId}:${turn}`,
        kind: "restoreRuleSkip",
        duration: "nextTime",
        untilTurn: turn,
        text: `${who}'s Restore Rule is skipped on turn ${turn}`
      });
    }

    // In-play continuous abilities that act on the player as a whole.
    this.forEachActiveContinuous((source, ability, context) => {
      const idBase = `${source.id}:${ability.id}`;
      const named = prefix(source.id);
      (ability.drawModifiers ?? []).forEach((mod, index) => {
        if (!this.scopeMatchesPlayer(mod.player, source.controllerId, playerId)) return;
        if (mod.prevent) {
          add(
            {
              id: `${idBase}:drawModifier:${index}`,
              kind: "drawModifier",
              duration: "whileSourceInPlay",
              text: `${named}${who} cannot draw cards`
            },
            source.id
          );
          return;
        }
        if (mod.delta === undefined) return;
        const delta = this.evaluateNumber(mod.delta, context);
        add(
          {
            id: `${idBase}:drawModifier:${index}`,
            kind: "drawModifier",
            duration: "whileSourceInPlay",
            text: `${named}${who} draws ${delta >= 0 ? `${delta} extra` : `${-delta} fewer`} card${Math.abs(delta) === 1 ? "" : "s"} whenever they draw`,
            amount: delta
          },
          source.id
        );
      });
      const rule = ability.preventsDefeat;
      if (rule && this.scopeMatchesPlayer(rule.player, source.controllerId, playerId)) {
        add(
          {
            id: `${idBase}:preventsDefeat`,
            kind: "preventsDefeat",
            duration: "whileSourceInPlay",
            text: `${named}${who} does not lose the game for having 0 influence`
          },
          source.id
        );
      }
      if (ability.emptyDeckLoses) {
        add(
          {
            id: `${idBase}:emptyDeckLoses`,
            kind: "emptyDeckLoses",
            duration: "whileSourceInPlay",
            text: `${named}${who} loses the game if their deck is empty`
          },
          source.id
        );
      }
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Lasting protections, rules-text suppression, provenance, stat modifiers (read-only)
  // ---------------------------------------------------------------------------

  /** `id` if that card exists and is not face-down (a hidden card is never named to a viewer), else `undefined`. */
  private publicSourceId(id: CardInstanceId | undefined): CardInstanceId | undefined {
    const card = id ? this.state.cards[id] : undefined;
    return card && !card.faceDown ? card.id : undefined;
  }

  /** A `Duration` (or a battle-scoped replacement's) in a UI's words. */
  private protectionDuration(duration: Duration | { type: "endOfBattle" }): {
    duration: ActiveProtectionDuration;
    untilTurn?: number;
  } {
    switch (duration.type) {
      case "permanent":
        return { duration: "permanent" };
      case "untilEndOfTurn":
        return { duration: "thisTurn" };
      case "endOfBattle":
        return { duration: "untilEndOfBattle" };
      case "whileSourceInPlay":
        return { duration: "whileSourceInPlay" };
      case "untilStartOfNextTurn":
        return { duration: "untilStartOfNextTurn", ...(duration.untilTurn !== undefined ? { untilTurn: duration.untilTurn } : {}) };
      case "untilEndOfNextTurn":
        return { duration: "untilEndOfNextTurn", ...(duration.untilTurn !== undefined ? { untilTurn: duration.untilTurn } : {}) };
    }
  }

  /**
   * Every lasting protection, redirect and restriction that an effect which already resolved left on the table
   * (see {@link ActiveProtection}): `preventDamage` shields (A Series of Tubes, Delectable Boon, Tiny Shiny ...),
   * `preventAllDamage` and `restrictDestruction` windows (Limited Liability, Inconvenient Roadblock),
   * `installReplacement` replacements (Elzibeth, Ignatious, Retreat to Mount Mulrich, Sarcophyle Matriculation),
   * outgoing / incoming damage modifiers, `redirectHandMoves` (Quotidian Misfire), `transformBattleDamage`
   * (Don't Trip, Ocular Dispersal, Spiky Atlasphere, Vexing Nullifier) and the block / must-block / party grants.
   * An entry is listed exactly while the engine still applies it (the same state the damage / destruction / replacement
   * / battle code reads, with the same `whileSourceInPlay` and block-condition gates).
   *
   * With `cardId`, only the entries that act on that card: a blanket window counts for every card; a replacement
   * counts when its card type and condition accept the card; a hand redirect counts when it covers the card's owner.
   * Without it, all of them. Descriptions are viewer-safe: a face-down card is "a face-down card" and its id is left
   * out of `sourceId`. NOT covered: the static rules text of cards in play (their continuous abilities).
   */
  getActiveProtections(cardId?: CardInstanceId): ActiveProtection[] {
    if (cardId !== undefined) this.requireCard(cardId);
    // Handed out as a deep copy: the entries are plain data a caller may keep or edit.
    return structuredClone(
      this.scopedRead("protections", cardId ?? "*", () => this.computeActiveProtections(cardId))
    );
  }

  private computeActiveProtections(cardId?: CardInstanceId): ActiveProtection[] {
    const result: ActiveProtection[] = [];
    const name = (id: CardInstanceId | undefined): string => this.logCardName(id);
    const sourceLive = (duration: Duration | { type: "endOfBattle" }, sourceId?: CardInstanceId): boolean =>
      duration.type !== "whileSourceInPlay" || (!!sourceId && this.sourceActiveInPlay(sourceId));
    const prefix = (sourceId: CardInstanceId | undefined): string => (sourceId ? `${name(sourceId)}: ` : "");
    const turnSuffix = (d: ActiveProtectionDuration): string =>
      d === "thisTurn"
        ? " this turn"
        : d === "untilEndOfBattle"
          ? " this battle"
          : d === "untilStartOfNextTurn"
            ? " until the start of the next turn"
            : d === "untilEndOfNextTurn"
              ? " until the end of the next turn"
              : d === "whileSourceInPlay"
                ? " while its source stays in play"
                : "";
    const add = (entry: ActiveProtection, source?: CardInstanceId): void => {
      const sourceId = this.publicSourceId(source);
      if (sourceId) entry.sourceId = sourceId;
      result.push(entry);
    };
    /** Whether an entry scoped to `ids` (undefined = unscoped) acts on the asked-about card. */
    const covers = (ids: CardInstanceId[] | undefined): boolean =>
      cardId === undefined || ids === undefined || ids.includes(cardId);

    // preventDamage shields (consumed as damage lands; spent ones are already gone).
    for (const shield of this.state.damageShields) {
      if (shield.amount <= 0 || !this.state.cards[shield.targetId]) continue;
      const appliesToCardIds = [shield.targetId];
      if (!covers(appliesToCardIds)) continue;
      const duration: ActiveProtectionDuration = shield.persistent
        ? "untilSpent"
        : shield.wholeInstance || shield.oneInstance
          ? "nextTime"
          : "thisTurn";
      const when = shield.persistent ? "" : " this turn";
      const target = name(shield.targetId);
      let text: string;
      if (shield.mode === "redirect") {
        const to = name(shield.redirectToId);
        text = `The next ${shield.amount} damage to ${target} is inflicted to ${to} instead${when}`;
      } else if (shield.wholeInstance) {
        text = `The next damage to ${target} is reduced to 0${when}`;
      } else if (shield.oneInstance) {
        text = `The next damage to ${target} is reduced by ${shield.amount}${when}`;
      } else {
        text = `Prevents the next ${shield.amount} damage to ${target}${when}`;
      }
      add(
        {
          id: shield.id,
          kind: "damageShield",
          mode: shield.mode === "redirect" ? "redirect" : shield.oneInstance && !shield.wholeInstance ? "reduce" : "prevent",
          direction: "incoming",
          appliesToCardIds,
          duration,
          ...(shield.wholeInstance ? {} : { amount: shield.amount }),
          text: `${prefix(this.publicSourceId(shield.sourceId))}${text}`
        },
        shield.sourceId
      );
    }

    // preventAllDamage / restrictDestruction windows: blanket, so they count for every card.
    for (const w of this.state.damagePreventionWindows) {
      if (!sourceLive(w.duration, w.sourceId)) continue;
      const d = this.protectionDuration(w.duration);
      add(
        {
          id: w.id,
          kind: "damagePrevention",
          mode: "prevent",
          direction: "incoming",
          ...d,
          text: `${prefix(this.publicSourceId(w.sourceId))}All ${w.battleOnly ? "battle " : ""}damage is reduced to 0${
            w.exceptCosts ? " (except damage paid as a cost)" : ""
          }${turnSuffix(d.duration)}`
        },
        w.sourceId
      );
    }
    for (const w of this.state.destructionRestrictionWindows) {
      if (!sourceLive(w.duration, w.sourceId)) continue;
      const d = this.protectionDuration(w.duration);
      add(
        {
          id: w.id,
          kind: "destructionRestriction",
          mode: "prevent",
          ...d,
          text: `${prefix(this.publicSourceId(w.sourceId))}Cards can only be destroyed by costs${turnSuffix(d.duration)}`
        },
        w.sourceId
      );
    }

    // installReplacement: "if X would be destroyed / move, instead ...". Who it covers is a card type + condition.
    for (const rr of this.state.runtimeReplacements) {
      if (!sourceLive(rr.duration, rr.sourceId)) continue;
      if (cardId !== undefined && this.state.cards[cardId]) {
        if (rr.replaces.cardType && rr.replaces.cardType !== this.replacementAffectedType(cardId)) continue;
        if (rr.replaces.event === "destroy") {
          const rel = rr.replaces.controlledBy ?? "any";
          const affectedController = this.state.cards[cardId].controllerId;
          if (rel === "self" && affectedController !== rr.controllerId) continue;
          if (rel === "opponent" && !this.opponentIdsFor(rr).includes(affectedController)) continue;
        }
        if (rr.condition) {
          let holds = true;
          try {
            holds = this.evaluateCondition(rr.condition, this.runtimeReplacementContext(rr, cardId));
          } catch {
            holds = true;
          }
          if (!holds) continue;
        }
      }
      const d = this.protectionDuration(rr.duration);
      const heldBy =
        rr.replaces.event !== "destroy" || !rr.replaces.controlledBy || rr.replaces.controlledBy === "any"
          ? ""
          : rr.replaces.controlledBy === "self"
            ? " its controller controls"
            : " an opponent of its controller controls";
      const what = `${rr.replaces.cardType ? `a ${rr.replaces.cardType}` : "a card"}${heldBy}`;
      const destroyedBy =
        rr.replaces.event !== "destroy"
          ? ""
          : rr.replaces.by === "opponent"
            ? rr.replaces.bySource
              ? " by an opposing card or ability"
              : " by an opposing card, ability or battle damage"
            : rr.replaces.by === "self"
              ? " by its controller's own card or ability"
              : rr.replaces.bySource
                ? " by a matching card or ability"
                : "";
      const event =
        rr.replaces.event === "destroy"
          ? `would be destroyed${destroyedBy}`
          : rr.replaces.zone === "any"
            ? "would leave play"
            : `would be put into the ${rr.replaces.zone}`;
      add(
        {
          id: rr.id,
          kind: "replacement",
          mode: "replace",
          replacementKind:
            rr.replaces.event === "destroy" ? "destroy" : rr.replaces.zone === "any" ? "leavePlay" : "moveToZone",
          ...(rr.replaces.event === "moveToZone" && rr.replaces.zone !== "any" ? { replacementZone: rr.replaces.zone } : {}),
          controllerId: rr.controllerId,
          duration: rr.once ? "nextTime" : d.duration,
          ...(d.untilTurn !== undefined ? { untilTurn: d.untilTurn } : {}),
          text: `${prefix(this.publicSourceId(rr.sourceId))}${rr.once ? "The next time " : "If "}${what} ${event}${
            turnSuffix(d.duration)
          }, ${rr.optional ? "its controller may have" : "it is replaced by"} something else instead`
        },
        rr.sourceId
      );
    }

    // modifyOutgoingDamage / modifyIncomingDamage.
    for (const mod of this.state.outgoingDamageModifiers) {
      if (!sourceLive(mod.duration, mod.sourceId)) continue;
      const incoming = mod.targetId !== undefined;
      const appliesToCardIds = [incoming ? mod.targetId! : mod.sourceId];
      if (!this.state.cards[appliesToCardIds[0]] || !covers(appliesToCardIds)) continue;
      const d = this.protectionDuration(mod.duration);
      const change = mod.delta < 0 ? `reduced by ${-mod.delta}` : `increased by ${mod.delta}`;
      const text = incoming
        ? `Damage inflicted to ${name(mod.targetId)} is ${change}${turnSuffix(d.duration)}`
        : `Damage inflicted by ${name(mod.sourceId)} is ${change}${
            mod.toFactionOf !== undefined ? ` to ${this.logPlayerName(mod.toFactionOf)}'s faction` : ""
          }${turnSuffix(d.duration)}`;
      add(
        {
          id: mod.id,
          kind: "damageModifier",
          mode: mod.delta < 0 ? "reduce" : "increase",
          direction: incoming ? "incoming" : "outgoing",
          appliesToCardIds,
          ...d,
          amount: mod.delta,
          text: incoming ? `${prefix(this.publicSourceId(mod.sourceId))}${text}` : text
        },
        incoming ? mod.sourceId : undefined
      );
    }

    // redirectHandMoves: cards entering a hand go elsewhere (a player-scoped window).
    for (const w of this.state.handMoveRedirects) {
      if (!sourceLive(w.duration, w.sourceId)) continue;
      const owner = cardId !== undefined ? this.state.cards[cardId]?.ownerId : undefined;
      if (owner !== undefined && !this.redirectReaches(w, owner)) continue;
      const d = this.protectionDuration(w.duration);
      const redirectOpponents = this.opponentIdsFor({ controllerId: w.sourceControllerId, opponentId: w.opponentId });
      const whose =
        w.who === "any"
          ? "any player's hand"
          : w.who === "self"
            ? `${this.logPlayerName(w.sourceControllerId)}'s hand`
            : redirectOpponents.length === 1
              ? `${this.logPlayerName(redirectOpponents[0])}'s hand`
              : "an opponent's hand";
      add(
        {
          id: w.id,
          kind: "handMoveRedirect",
          mode: "redirect",
          controllerId: w.sourceControllerId,
          ...(w.who === "self"
            ? { playerId: w.sourceControllerId }
            : w.who === "opponent" && redirectOpponents.length === 1
              ? { playerId: redirectOpponents[0] }
              : {}),
          ...d,
          text: `${prefix(this.publicSourceId(w.sourceId))}Cards that would enter ${whose} go to the ${w.to} instead${turnSuffix(d.duration)}`
        },
        w.sourceId
      );
    }

    // transformBattleDamage: only while the character is in play (as the battle code gates it).
    for (const t of this.state.battleDamageTransforms) {
      if (this.state.cards[t.cardId]?.zone !== "play" || !sourceLive(t.duration, t.sourceId)) continue;
      const appliesToCardIds = [t.cardId];
      if (!covers(appliesToCardIds)) continue;
      const d = this.protectionDuration(t.duration);
      const who = name(t.cardId);
      const text =
        t.kind === "setAmount"
          ? `${who} assigns ${t.amount ?? 0} battle damage instead of its strength`
          : t.kind === "redirectToSelf"
            ? `The battle damage ${who} deals is dealt to ${who} instead`
            : t.kind === "bounceOther"
              ? `${who} deals no battle damage; the character it damages returns to its owner's hand instead`
              : `A character that damages ${who} in battle deals no damage; ${who} returns to its owner's hand instead`;
      add(
        {
          id: t.id,
          kind: "battleDamageTransform",
          mode: "transform",
          direction: t.role === "receiver" ? "incoming" : "outgoing",
          appliesToCardIds,
          ...d,
          ...(t.amount !== undefined ? { amount: t.amount } : {}),
          text: `${prefix(this.publicSourceId(t.sourceId))}${text}${turnSuffix(d.duration)}`
        },
        t.sourceId
      );
    }

    // restrictBlockers / requireBlock / restrictParty grants.
    for (const g of this.state.blockRestrictionGrants) {
      if (!sourceLive(g.duration, g.sourceId)) continue;
      const appliesToCardIds = [g.targetId];
      if (!covers(appliesToCardIds)) continue;
      const ctx: ResolutionContext = {
        sourceId: g.sourceId,
        controllerId: this.state.cards[g.sourceId]?.controllerId ?? this.state.activePlayerId,
        selected: {}
      };
      // The same gate declareBlockers applies: a failed condition means the restriction does not bite.
      if (g.condition && !this.evaluateCondition(g.condition, ctx)) continue;
      const minParty = g.minPartySize !== undefined ? this.evaluateNumber(g.minPartySize, ctx) : undefined;
      const minSpeed = g.minSpeed !== undefined ? this.evaluateNumber(g.minSpeed, ctx) : undefined;
      const d = this.protectionDuration(g.duration);
      const parts = [
        ...(minParty !== undefined ? [`a blocking party of at least ${minParty}`] : []),
        ...(minSpeed !== undefined ? [`blockers with speed ${minSpeed} or more`] : [])
      ];
      add(
        {
          id: g.id,
          kind: "blockRestriction",
          appliesToCardIds,
          ...d,
          ...(minParty !== undefined ? { amount: minParty } : minSpeed !== undefined ? { amount: minSpeed } : {}),
          text: `${prefix(this.publicSourceId(g.sourceId))}Only ${parts.join(" and ") || "some blockers"} may block ${name(g.targetId)}${turnSuffix(d.duration)}`
        },
        g.sourceId
      );
    }
    for (const g of this.state.mustBlockGrants) {
      if (!sourceLive(g.duration, g.sourceId)) continue;
      const appliesToCardIds = g.blockerId ? [g.attackerId, g.blockerId] : [g.attackerId];
      if (!covers(appliesToCardIds)) continue;
      const d = this.protectionDuration(g.duration);
      add(
        {
          id: g.id,
          kind: "mustBlock",
          appliesToCardIds,
          ...d,
          text: `${prefix(this.publicSourceId(g.sourceId))}${
            g.blockerId ? `${name(g.blockerId)} must block ${name(g.attackerId)} if able` : `Each character able to must block ${name(g.attackerId)}`
          }${turnSuffix(d.duration)}`
        },
        g.sourceId
      );
    }
    for (const g of this.state.partyRestrictionGrants) {
      if (!sourceLive(g.duration, g.sourceId)) continue;
      const appliesToCardIds = [g.targetId];
      if (!covers(appliesToCardIds)) continue;
      const ctx: ResolutionContext = {
        sourceId: g.sourceId,
        controllerId: this.state.cards[g.sourceId]?.controllerId ?? this.state.activePlayerId,
        selected: {}
      };
      const min = g.minMembers !== undefined ? this.evaluateNumber(g.minMembers, ctx) : undefined;
      const max = g.maxMembers !== undefined ? this.evaluateNumber(g.maxMembers, ctx) : undefined;
      const d = this.protectionDuration(g.duration);
      const rules = [
        ...(min !== undefined ? [`at least ${min} members`] : []),
        ...(max !== undefined ? [`at most ${max} members`] : []),
        ...(g.parity ? [`an ${g.parity} number of members`] : [])
      ];
      const role = g.role === "any" ? "A party" : g.role === "attacking" ? "An attacking party" : "A blocking party";
      add(
        {
          id: g.id,
          kind: "partyRestriction",
          appliesToCardIds,
          ...d,
          text: `${prefix(this.publicSourceId(g.sourceId))}${role} including ${name(g.targetId)} must have ${rules.join(" and ") || "a legal size"}${turnSuffix(d.duration)}`
        },
        g.sourceId
      );
    }

    return result;
  }

  /**
   * Whether `cardId`'s rules text is switched off right now. With `abilityId`, that one ability (activated, triggered,
   * continuous or replacement): the same test every ability-enumeration site uses, including the suppressing
   * ability's own exemption. Without it, the card as a whole: that is the test that also removes the card's PRINTED
   * KEYWORDS (`hasKeyword`). Both forms of suppression are modelled: a continuous `suppressAllAbilities` aura
   * (Subversion Matrix, Mud Prison, Inhibit, Heavy Fists of Robotic Pounding) and a lasting `suppressAbilities`
   * effect (iDumb De-Itemizer). It is all-or-nothing per card: the engine has no "loses only its triggered text".
   */
  isAbilitySuppressed(cardId: CardInstanceId, abilityId?: AbilityId): boolean {
    this.requireCard(cardId);
    return this.abilitySuppressed(cardId, abilityId);
  }

  /**
   * The ids of every ability on `cardId` that is switched off right now (see `isAbilitySuppressed`): its printed
   * and faction abilities of every type, the abilities copied onto it (`grantAbilitiesFrom`) and the one the players
   * created for it. Empty when nothing is suppressed. A card that lost its rules text also lost its printed keywords:
   * check `isAbilitySuppressed(cardId)` (no ability id) for that.
   */
  getSuppressedAbilityIds(cardId: CardInstanceId): AbilityId[] {
    this.requireCard(cardId);
    const definition = this.getDefinition(cardId);
    const abilities: AbilityDefinition[] = [
      ...(definition.behavior?.abilities ?? []),
      ...(definition.faction?.abilities ?? []),
      ...this.state.abilityGrants.filter(g => g.cardId === cardId).flatMap(g => g.abilities)
    ];
    const created = this.state.cards[cardId]?.createdAbility?.ability;
    if (created) abilities.push(created);
    const ids = new Set<AbilityId>();
    for (const ability of abilities) {
      if (this.abilitySuppressed(cardId, ability.id)) ids.add(ability.id);
    }
    return [...ids];
  }

  /** Who is switching `cardId`'s rules text off (see `isAbilitySuppressed`): the auras and lasting effects, one entry each. Empty when none. */
  getAbilitySuppressionSources(cardId: CardInstanceId): AbilitySuppressionSource[] {
    this.requireCard(cardId);
    const collected: AbilitySuppressionSource[] = [];
    this.scanAbilitySuppression(cardId, undefined, collected);
    return collected;
  }

  /**
   * Where each restriction `cardId` has comes from, from the data `getRestrictions` / `hasRestriction` read: a lasting
   * `grantRestriction` effect ("runtime", with its duration), or a continuous ability, which is "printed" when it is on
   * the card itself and "aura" when another card in play grants it. One entry per source, so a restriction with two
   * causes appears twice. Only restrictions the card currently has are listed.
   */
  getRestrictionSources(cardId: CardInstanceId): RestrictionSource[] {
    this.requireCard(cardId);
    const result: RestrictionSource[] = [];
    const continuous = this.getContinuousRestrictionGrantEntries(cardId);
    for (const restriction of ALL_RESTRICTIONS) {
      for (const grant of this.state.restrictions) {
        if (grant.targetId !== cardId || grant.restriction !== restriction) continue;
        const sourceId = this.publicSourceId(grant.sourceId);
        result.push({
          restriction,
          kind: "runtime",
          ...(sourceId ? { sourceId } : {}),
          duration: structuredClone(grant.duration)
        });
      }
      for (const entry of continuous) {
        if (entry.restriction !== restriction) continue;
        result.push({
          restriction,
          kind: entry.sourceId === cardId ? "printed" : "aura",
          sourceId: entry.sourceId,
          abilityId: entry.abilityId
        });
      }
    }
    return result;
  }

  /**
   * Where each keyword `cardId` has comes from, from the data `hasKeyword` / `getKeywords` read: the card's own
   * printed keywords ("printed", sourceId = the card), a lasting `grantKeyword` / `grantKeywordToPlayer` effect
   * ("runtime", with its duration; `playerWide` for the player-wide form), or a continuous ability ("printed" when on
   * the card itself, "aura" when another card in play grants it). Only keywords the card currently has are listed,
   * one entry per source; a keyword switched off by a suppression has none.
   */
  getKeywordGrantSources(cardId: CardInstanceId): KeywordGrantSource[] {
    this.requireCard(cardId);
    return this.withKeywordReadMemo(() => {
      const result: KeywordGrantSource[] = [];
      const definition = this.getDefinition(cardId);
      const continuous = this.getContinuousKeywordGrantEntries(cardId);
      const controllerId = this.state.cards[cardId]?.controllerId;
      for (const keyword of ALL_KEYWORDS) {
        if (!this.hasKeyword(cardId, keyword)) continue;
        if (this.definitionHasKeyword(definition, keyword) && !this.abilitySuppressed(cardId)) {
          result.push({ keyword, kind: "printed", sourceId: cardId });
        }
        for (const grant of this.state.keywordGrants) {
          if (grant.targetId !== cardId || grant.keyword !== keyword) continue;
          if (!this.runtimeKeywordGrantHolds(grant, cardId)) continue;
          const sourceId = this.publicSourceId(grant.sourceId);
          result.push({
            keyword,
            kind: "runtime",
            ...(sourceId ? { sourceId } : {}),
            duration: structuredClone(grant.duration)
          });
        }
        for (const grant of this.state.playerKeywordGrants) {
          if (grant.playerId !== controllerId || grant.keyword !== keyword) continue;
          const sourceId = this.publicSourceId(grant.sourceId);
          result.push({
            keyword,
            kind: "runtime",
            playerWide: true,
            ...(sourceId ? { sourceId } : {}),
            duration: structuredClone(grant.duration)
          });
        }
        for (const entry of continuous) {
          if (entry.keyword !== keyword) continue;
          result.push({
            keyword,
            kind: entry.sourceId === cardId ? "printed" : "aura",
            sourceId: entry.sourceId,
            abilityId: entry.abilityId
          });
        }
      }
      return result;
    });
  }

  /**
   * The terms behind `getStat(cardId, stat)`: every modifier it applies, in its order, with what causes it
   * ("printed": a continuous ability on the card itself; "aura": another card's continuous ability; "runtime": a
   * lasting effect, with its real duration) and what it changed. Built from the very list `getStat` folds
   * (`statModifiersFor`), so printed base + the sum of every `amount` is `getStat` before its floor of 0.
   * Empty for a faction card's influence (that is its owner's live influence pool, not a modified stat).
   */
  getStatModifiers(cardId: CardInstanceId, stat: Stat): StatModifierEntry[] {
    const definition = this.getDefinition(cardId);
    this.requireCard(cardId);
    if (stat === "influence" && definition.type === "faction") {
      if (Object.values(this.state.players).some(player => player.factionId === cardId)) return [];
    }
    let value = this.printedStat(definition, stat);
    const entries: StatModifierEntry[] = [];
    for (const modifier of this.statModifiersFor(cardId, stat)) {
      const before = value;
      switch (modifier.operation) {
        case "add":
          value += modifier.value;
          break;
        case "set":
          value = modifier.value;
          break;
        case "multiply":
          value *= modifier.value;
          break;
      }
      const continuous = modifier.id.startsWith("continuous:");
      const sourceId = this.publicSourceId(modifier.sourceId);
      entries.push({
        id: modifier.id,
        stat,
        kind: continuous ? (modifier.sourceId === cardId ? "printed" : "aura") : "runtime",
        ...(sourceId ? { sourceId } : {}),
        ...(modifier.sourceAbilityId ? { abilityId: modifier.sourceAbilityId } : {}),
        operation: modifier.operation,
        value: modifier.value,
        amount: value - before,
        duration: structuredClone(modifier.duration)
      });
    }
    return entries;
  }

  /** "the start of Alice's next turn" — the moment phrase shared by the delayed-effect log line and `getPendingDelayedEffects`. */
  private describeDelayedWhen(when: ScheduledEffect["when"], controllerId: PlayerId): string {
    const who = this.logPlayerName(controllerId);
    switch (when) {
      case "startOfNextTurn":
        return `the start of ${who}'s next turn`;
      case "startOfOpponentNextTurn":
        return opponentsOf(this.state, controllerId).length === 1
          ? `the start of ${this.logPlayerName(opponentsOf(this.state, controllerId)[0])}'s next turn`
          : "the start of an opponent's next turn";
      case "startOfTheNextTurn":
        return "the start of the next turn";
      case "endOfTurn":
        return "the end of the turn";
      case "endOfBattle":
        return "the end of the battle";
    }
  }

  /**
   * Whether the card's own play condition (see `getTacticCondition`) holds as a
   * read-only probe. `true` when there is none, when the card is modal (which
   * mode, hence which condition, isn't chosen yet), when it is gated on a
   * not-yet-picked "choose a number for X", or when it can't be evaluated
   * without selections we don't have — `perform()` stays the last word then.
   */
  private playConditionHolds(
    playerId: PlayerId,
    cardId: CardInstanceId,
    definition: CardDefinition,
    extraContext: Partial<ResolutionContext> = {}
  ): boolean {
    if (definition.behavior?.modes?.length) return true;
    const playCondition = this.getTacticCondition(definition);
    if (!playCondition || this.nodeReferencesVariable(playCondition)) return true;
    try {
      const probeContext: ResolutionContext = {
        sourceId: cardId,
        controllerId: playerId,
        selected: {},
        ...extraContext
      };
      return this.evaluateCondition(playCondition, probeContext);
    } catch {
      // Not evaluable as a read-only probe (needs selections/state we
      // don't have yet) — leave the call to `perform()`.
      return true;
    }
  }

  /**
   * The lowest `costAdjust` (see `getPlayCostAdjust`) the player could end up
   * with for this card right now — used only to decide *playability*, never
   * to actually pay a cost. A modal card takes the best of its modes.
   *
   * Two shapes: an automatic board-state adjust ("if you control [O]x6",
   * "by the number of [E] you control", "if you have 4+ characters in your
   * discard pile") is simply evaluated; a pick-based one ("by the number of
   * cards removed") depends on how many cards the player chooses, so every
   * pick size each referenced (`selectionCount`) declaration could legally
   * take — 0..N for an optional one, where N is its own printed `count`
   * capped by how many candidates exist — is tried and the cheapest outcome
   * wins. Nothing here assumes bigger picks are cheaper, or that the adjust
   * is negative. An adjust that depends on *which* cards are picked rather
   * than how many isn't modeled (no card has one).
   */
  private getBestCaseCostAdjust(
    definition: CardDefinition,
    playerId: PlayerId,
    cardId: CardInstanceId
  ): number {
    const modeCount = definition.behavior?.modes?.length ?? 0;
    const modes: Array<number | undefined> =
      modeCount > 0 ? [...Array(modeCount).keys()] : [undefined];

    let best: number | undefined;
    for (const mode of modes) {
      const adjust = this.getPlayCostAdjust(definition, mode);
      const value = adjust
        ? this.getBestCaseModeCostAdjust(adjust, definition, mode, playerId, cardId)
        : 0;
      best = best === undefined ? value : Math.min(best, value);
    }
    return best ?? 0;
  }

  private getBestCaseModeCostAdjust(
    adjust: NumberExpression,
    definition: CardDefinition,
    mode: number | undefined,
    playerId: PlayerId,
    cardId: CardInstanceId
  ): number {
    const context: ResolutionContext = {
      sourceId: cardId,
      controllerId: playerId,
      selected: {}
    };

    const referenced = new Set<string>();
    this.collectSelectionCountIds(adjust, referenced);

    const axes: Array<{
      id: string;
      candidates: CardInstanceId[];
      min: number;
      max: number;
    }> = [];
    for (const declaration of this.getPlayTargetDeclarations(definition, mode)) {
      if (!referenced.has(declaration.id)) continue;
      try {
        const candidates = this.targetCandidates(
          declaration.selector,
          context,
          playerId
        ).map(candidate => candidate.id);
        const wanted = Math.max(0, this.evaluateNumber(declaration.count, context));
        const max = Math.min(wanted, candidates.length);
        axes.push({ id: declaration.id, candidates, min: declaration.optional ? 0 : max, max });
      } catch {
        // Selector/count needs a not-yet-made pick — leave it unselected.
      }
    }

    let best: number | undefined;
    const sweep = (axis: number): void => {
      if (axis === axes.length) {
        try {
          const value = this.evaluateNumber(adjust, context);
          best = best === undefined ? value : Math.min(best, value);
        } catch {
          // Not evaluable as a read-only probe — this combination doesn't count.
        }
        return;
      }
      const { id, candidates, min, max } = axes[axis];
      for (let size = min; size <= max; size++) {
        context.selected[id] = candidates.slice(0, size);
        sweep(axis + 1);
      }
    };
    sweep(0);

    return best ?? 0;
  }

  /** Deep-scans an expression for `{ type: "selectionCount", id }` nodes, adding each `id`. */
  private collectSelectionCountIds(node: unknown, into: Set<string>): void {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "selectionCount" && typeof record.id === "string") {
      into.add(record.id);
    }
    for (const value of Object.values(record)) {
      this.collectSelectionCountIds(value, into);
    }
  }

  /** Convenience filter over `getCardPlayability` — every card in `playerId`'s hand that's currently deployable. */
  getPlayableHandCards(playerId: PlayerId): CardInstanceId[] {
    return this.requirePlayer(playerId).hand.filter(
      cardId => this.getCardPlayability(playerId, cardId).playable
    );
  }

  /**
   * Deep-scans a condition / number-expression sub-tree for a
   * `{ type: "variable" }` node — a "choose a number for X" value the player
   * supplies as part of playing the card. `getCardPlayability` uses this to
   * leave a play-timing `condition` it can't yet evaluate read-only
   * (Cowslaw's "X > 0") to `perform()`, rather than probe it with an
   * unassigned X and wrongly report the card unplayable.
   */
  private nodeReferencesVariable(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    if (record.type === "variable" && typeof record.id === "string") return true;
    return Object.values(record).some(value =>
      this.nodeReferencesVariable(value)
    );
  }

  queryCards(
    selector: CardSelector,
    context: ResolutionContext
  ): CardInstance[] {
    return Object.values(this.state.cards).filter(
      card => card.id !== this.beingDeployedId && this.matchesSelector(card, selector, context)
    );
  }

  /**
   * The cards a player may offer for the pick `declarationId` of a play they are about to make, judged where the
   * card's written cost order puts the pick (Q15): a pick with a `pick` cost step is judged AFTER the cost steps
   * written before it ("Destroy this card. Pick a character" no longer offers this card; "Deplete this card.
   * Pick a depleted character" offers it), any other pick against the board as it is now. The card being played
   * is never offered (it is Being Deployed). Earlier picks / chosen numbers the steps need come from `action`
   * (`selected`, `variables`, `named`); a step that cannot be rehearsed with what is supplied is skipped.
   * A FLIP UP line's own steps ("and play a resource") are not rehearsed.
   */
  getPickCandidates(
    action: Extract<GameAction, { type: "playCard" | "activateAbility" | "flipUp" }>,
    declarationId: string
  ): CardInstanceId[] {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);
    let declarations: TargetDeclaration[];
    let costs: Cost[];
    let abilityId: AbilityId | undefined;
    if (action.type === "activateAbility") {
      const ability = this.getCardActivatedAbilities(card.id).find(a => a.id === action.abilityId);
      assert(ability, "Activated ability not found.");
      declarations = ability.targets ?? [];
      costs = ability.costs ?? [];
      abilityId = ability.id;
    } else {
      declarations = this.getPlayTargetDeclarations(definition, action.mode);
      costs = this.getTacticCosts(definition, action.mode);
    }
    const declaration = declarations.find(d => d.id === declarationId);
    assert(declaration, `'${definition.name}' has no pick '${declarationId}'.`);
    const beingPlayed = action.type !== "activateAbility";
    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      ...(abilityId ? { abilityId } : {}),
      selected: { ...(action.selected ?? {}) },
      variables: { ...(action.variables ?? {}) },
      ...(action.named ? { named: { ...action.named } } : {}),
      ...(action.type === "flipUp" ? { deployedViaFlipUp: true } : {})
    };
    const probe = this.cloneForProbe();
    probe.beingDeployedId = beingPlayed ? card.id : undefined;
    probe.rehearseCostsBefore(costs, declarations, declarationId, context);
    const count = Math.max(0, probe.evaluateNumber(declaration.count, context));
    return probe
      .targetCandidates(declaration.selector, context, action.playerId, count)
      .map(candidate => candidate.id);
  }

  /**
   * Pays, on THIS engine (always a throw-away copy), the cost steps written before the `pick` step of
   * `declarationId`, so the pick can be judged against the board as it stands after them (Q15). A step that cannot
   * be rehearsed with what is supplied (an earlier pick is still missing) is skipped. Nothing when the
   * declaration has no `pick` cost step.
   */
  private rehearseCostsBefore(
    costs: readonly Cost[],
    declarations: readonly TargetDeclaration[],
    declarationId: string,
    context: ResolutionContext
  ): void {
    const position = costs.findIndex(c => c.type === "pick" && c.declarationId === declarationId);
    if (position < 0) return;
    for (const step of this.withPickDeclarations(
      this.orderCosts(costs.slice(0, position)),
      declarations
    )) {
      try {
        this.payCost(step, context, false);
      } catch {
        // Not enough was supplied to rehearse this step (an earlier pick is still missing): skip it.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only queries for clients
  //
  // Each runs on a throw-away copy of the game (`cloneForProbe`), so asking can never change the live state, its
  // random stream or its log. They call the same private rules `perform()` validates a play with.
  // ---------------------------------------------------------------------------

  /**
   * What a play, an ability use or a FLIP UP still needs from the player, in the order the engine asks for it.
   * `action` is the action built so far (everything answered rides in it: `mode`, `flipUpOption`, `variables`,
   * `selected`, `named`); the result lists only what is missing, and `[]` means the action can be dispatched as
   * it stands. One gate at a time: (1) `mode` for a modal card, alone; (2) `flipUpOption` and `variables` (the X
   * numbers that size later picks); (3) every remaining pick, up-front declarations first, then the cost steps in
   * written order (a `pick` step places its declaration among them).
   *
   * Never listed: a count of 0, an implied pick with no real choice, an optional pick with nothing to pick, a
   * random-sized pick (Hammer Smash: the engine opens `selectDeployTargets` after rolling), and the prompts the
   * ENGINE asks after the dispatch (`nameValue`, `oneOf`, `otherPlayerChooses`, `distribute`, `alternatingPay`, a
   * FLIP UP rider pick).
   */
  getPlayRequirements(action: PlayAction): PlayRequirement[] {
    if (!this.state.cards[action.cardId]) return [];
    const probe = this.cloneForProbe();
    // The card being played is Being Deployed (CR 604.1): no pick or cost may use it.
    probe.beingDeployedId = action.type === "activateAbility" ? undefined : action.cardId;
    return probe.collectPlayRequirements(action);
  }

  /**
   * The picks of a pending-choice sub-selection that has no play to read them from (`selectTargets`,
   * `chooserSelectsTarget`, `useTargetAbility`): `declarations` and `costs` as given, `pickerId` choosing. Same
   * shapes and rules as `getPlayRequirements`; a `pick` cost step is judged against the board as it is now (no
   * action to rehearse the earlier steps with).
   */
  getSelectionRequirements(input: SelectionRequirementsInput): PlayRequirement[] {
    const probe = this.cloneForProbe();
    probe.beingDeployedId = this.beingDeployedIdOf(input);
    const { context, gates } = probe.selectionBasis(input);
    if (gates.length > 0) return gates;
    return probe.collectPickSteps(input.declarations, input.costs, context, {
      pickerId: input.pickerId ?? input.controllerId,
      ...(input.play ? { action: input.play } : {})
    });
  }

  /** The card a selection's play has Being Deployed (CR 604.1): the card played or flipped up; none for an ability use or a prompt. */
  private beingDeployedIdOf(input: SelectionRequirementsInput): CardInstanceId | undefined {
    return input.play && input.play.type !== "activateAbility" ? input.play.cardId : undefined;
  }

  /**
   * The resolution context a selection is judged in, and the "choose a number" gate when one is still open. Run on
   * the throw-away copy: `getSelectionRequirements` and `checkSelection` build it the same way.
   */
  private selectionBasis(input: SelectionRequirementsInput): { context: ResolutionContext; gates: PlayRequirement[] } {
    const base = input.context ? structuredClone(input.context) : undefined;
    // The picks being asked are not answered yet, whatever the prompt's context still holds for them.
    const asked = new Set(input.declarations.map(declaration => declaration.id));
    const baseSelected = Object.fromEntries(Object.entries(base?.selected ?? {}).filter(([id]) => !asked.has(id)));
    const named = base?.named || input.named ? { ...(base?.named ?? {}), ...(input.named ?? {}) } : undefined;
    const context: ResolutionContext = {
      ...(base ?? {}),
      sourceId: input.sourceId,
      controllerId: input.controllerId,
      ...(input.abilityId ? { abilityId: input.abilityId } : {}),
      selected: { ...baseSelected, ...input.selected },
      variables: { ...(base?.variables ?? {}), ...input.variables },
      ...(named ? { named } : {})
    };
    const gates: PlayRequirement[] = [];
    if (input.variableSource) {
      const source = {
        costs: input.costs,
        targets: input.declarations,
        condition: input.variableSource.condition,
        variables: input.variableSource.variables,
        variableBounds: input.variableSource.variableBounds
      };
      const chosen = this.playerChosenVariableIds(source);
      const rolled = this.previewRolledVariables(source.variables, chosen, context);
      context.variables = { ...rolled, ...input.variables };
      const gate = this.variablesGate(chosen, source.variableBounds, context, input.variables);
      if (gate) gates.push(gate);
    }
    return { context, gates };
  }

  /**
   * The engine's own check of one pick: would `cardIds` be accepted as the answer to the pick `declarationId` of
   * `input` (a declaration, or a `discard` / `moveSelected` cost step that takes cards)? The same checks `perform`
   * makes of a play's picks (`validateDeclarationPick`: count range, no card twice, only legal candidates, the
   * card that must be picked, distinct names / trades / types; `assertCostPickSelection` for a cost step), judged
   * in `input.context` when given, for `input.pickerId`. The answer is `{ ok: true }` or the engine's own words.
   * Everything else in `input` (`selected`, `variables`, `named`) is what the other picks and numbers already are;
   * the entry for `declarationId` in them is replaced by `cardIds`. One pick at a time: a "choose a number" still
   * open or another pick still missing is not this query's concern. Pass `input.play` (or use
   * `checkPlaySelection`) for a pick written after a cost step, which is judged on the board after the earlier
   * steps; without it, on the board as it stands. The live game is untouched.
   */
  checkSelection(
    input: SelectionRequirementsInput,
    declarationId: string,
    cardIds: readonly CardInstanceId[]
  ): SelectionCheck {
    const probe = this.cloneForProbe();
    probe.beingDeployedId = this.beingDeployedIdOf(input);
    try {
      const declaration = input.declarations.find(candidate => candidate.id === declarationId);
      const costPick = declaration
        ? undefined
        : input.costs.find(
            (cost): cost is Extract<Cost, { type: "discard" | "moveSelected" }> =>
              (cost.type === "discard" || cost.type === "moveSelected") && cost.id === declarationId
          );
      assert(declaration || costPick, `This selection has no pick '${declarationId}'.`);

      const { context } = probe.selectionBasis(input);
      context.selected = { ...context.selected, [declarationId]: [...cardIds] };
      const pickerId = input.pickerId ?? input.controllerId;

      if (costPick) {
        probe.assertCostPickSelection(costPick, context);
      } else {
        // A pick with a `pick` cost step is judged alone, after the steps written before it (as `payCost` does);
        // every other pick is judged with the up-front picks before anything is paid (as the play does).
        const afterCost = probe.pickStepIds(input.costs).has(declarationId);
        if (afterCost && input.play) {
          probe.rehearseCostsBefore(input.costs, input.declarations, declarationId, context);
        }
        const judged = afterCost ? [declaration!] : probe.upFrontDeclarations(input.declarations, input.costs);
        probe.assertPicksDifferent(judged, context);
        const noInputNeeded = probe.resolveImpliedPicks(judged, context);
        probe.validateDeclarationPick(
          declaration!,
          context,
          probe.costBoundDeclarationIds(input.costs),
          noInputNeeded,
          pickerId
        );
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * `checkSelection` for a play, an ability use or a FLIP UP that has not been dispatched: the picks, costs and
   * "choose a number" source come from the card (as `getPlayRequirements` reads them), and the answers already
   * given from `action` (`selected`, `variables`, `named`; the entry for `declarationId` is replaced by
   * `cardIds`). A pick written after a cost step is judged on the board after the earlier steps are rehearsed.
   * `{ ok: false }` also for a modal card with no `mode` yet and for an ability the card does not have.
   */
  checkPlaySelection(
    action: PlayAction,
    declarationId: string,
    cardIds: readonly CardInstanceId[]
  ): SelectionCheck {
    const built = this.selectionInputOfPlay(action);
    if ("error" in built) return { ok: false, error: built.error };
    return this.checkSelection(built.input, declarationId, cardIds);
  }

  /**
   * The `SelectionRequirementsInput` for playing `cardId` from `playerId`'s side: the card's own play block (its
   * `mode`'s, the first for a card that is not modal or when none is given), built by the engine: the picks
   * (including the ATTACH TO host pick, with `attachToController`), the extra costs, and the "choose a number"
   * source and play condition. For plays there is no action to read yet (a reveal-from-hand deploy, a free
   * deploy, a play the client builds from a prompt). Handed to `getSelectionRequirements` it lists the same picks
   * as `getPlayRequirements({ type: "playCard", playerId, cardId, mode })`: the `play` it carries makes the card
   * Being Deployed and judges a pick written after a cost step on the board after the earlier steps. Nothing is
   * answered yet (`selected` and `variables` are empty); throws for a card that is not in the game or a mode the
   * card does not have.
   */
  getPlaySelectionInput(playerId: PlayerId, cardId: CardInstanceId, mode?: number): SelectionRequirementsInput {
    const card = this.requireCard(cardId);
    const modes = this.getDefinition(card.id).behavior?.modes;
    // A modal card with no mode given: the first, as `getTacticSource` reads it.
    const action: PlayAction = { type: "playCard", playerId, cardId, mode: mode ?? (modes && modes.length > 0 ? 0 : undefined) };
    const built = this.selectionInputOfPlay(action);
    if ("error" in built) throw new Error(built.error);
    return built.input;
  }

  /** A play's picks, costs and number source as a `SelectionRequirementsInput` (answers already in `action` ride along). */
  private selectionInputOfPlay(action: PlayAction): { input: SelectionRequirementsInput } | { error: string } {
    if (!this.state.cards[action.cardId]) return { error: `Card '${action.cardId}' not found.` };
    const block = this.playBlockOf(action);
    if (Array.isArray(block)) {
      const name = this.getDefinition(action.cardId).name;
      return {
        error: block.some(requirement => requirement.kind === "mode")
          ? `'${name}' is modal: choose a mode first.`
          : action.type === "activateAbility"
            ? `'${name}' has no ability '${action.abilityId}'.`
            : `Modal card '${name}' has no mode ${action.mode}.`
      };
    }
    const { source, rolls, bounds, abilityId, controllerId, costs } = block;
    // A pick sized by an unguarded roll is the engine's to ask once it has rolled (Hammer Smash): never listed,
    // exactly as `getPlayRequirements` leaves it out.
    const deferred =
      action.type === "playCard"
        ? new Set(this.findRandomSizedTargetDeclarations(block.declarations, rolls, bounds).map(d => d.id))
        : new Set<string>();
    const declarations = block.declarations.filter(declaration => !deferred.has(declaration.id));
    return {
      input: {
        sourceId: action.cardId,
        controllerId,
        ...(abilityId ? { abilityId } : {}),
        declarations,
        costs,
        selected: structuredClone(action.selected ?? {}),
        variables: { ...(action.variables ?? {}) },
        ...(action.named ? { named: { ...action.named } } : {}),
        variableSource: { variables: rolls, variableBounds: bounds, condition: source?.condition },
        ...(action.type === "flipUp"
          ? {
              context: {
                sourceId: action.cardId,
                controllerId,
                selected: {},
                deployedViaFlipUp: true
              } satisfies ResolutionContext
            }
          : {}),
        play: action
      }
    };
  }

  /**
   * A dry run of `action` on a copy of the game: `{ ok: true }` when `perform(action)` would accept it,
   * `{ ok: false, error }` with the engine's own reason when it would refuse. The live game, its random stream
   * and its log are untouched. (A prompt the action raises, such as a name still to be given, counts as accepted.)
   */
  checkAction(action: GameAction): { ok: true } | { ok: false; error: string } {
    const probe = this.cloneForProbe();
    // The copy plays for real (it is `perform`ing, not rehearsing a payment), with the triggers waiting on the live game.
    probe.dryRun = false;
    probe.immediateQueue.push(...structuredClone(this.immediateQueue));
    try {
      probe.perform(action);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * What paying this play's / ability's / FLIP UP's numeric cost ("Pay N") asks of the player: how many resources,
   * and which may pay. `undefined` when the action costs no resources, or cannot be taken yet (a pick or X still
   * missing, or the engine would refuse it). Read without any side effect, on a copy of the game. The answer is
   * sent back as `payWith`; a client that does not ask the player leaves it off and the engine chooses.
   */
  getPaymentOptions(action: PlayAction): PaymentOptions | undefined {
    if (!this.state.cards[action.cardId]) return undefined;
    const probe = this.cloneForProbe();
    probe.dryRun = false;
    probe.immediateQueue.push(...structuredClone(this.immediateQueue));
    probe.paymentCapture = { amount: 0, candidates: [] };
    const { payWith: _ignored, ...bare } = action;
    try {
      probe.perform(bare as PlayAction);
    } catch (error) {
      if (!(error instanceof PaymentCaptured)) return undefined;
    }
    const { amount, candidates } = probe.paymentCapture;
    if (amount === 0) return undefined;
    // A FLIP UP pays while the card is still a face-down resource (CR 507.4b), so it may be one of the payers.
    if (action.type === "flipUp" && !candidates.includes(action.cardId)) {
      if (this.getAvailableResourceIds(action.playerId).includes(action.cardId)) candidates.unshift(action.cardId);
    }
    return { amount, candidates };
  }

  /** The resources named for the running action's own "Pay N" (once: nothing later in the resolution gets them). */
  private takePayWith(context: ResolutionContext): CardInstanceId[] {
    if (!this.payWith || this.payWith.sourceId !== context.sourceId) return [];
    const { ids } = this.payWith;
    this.payWith = undefined;
    return ids;
  }

  /**
   * The value of `expression` in `context`, read without any side effect: evaluated on a copy of the game, so
   * the random stream and the event log are untouched. `undefined` for anything that rolls (`random`,
   * `coinFlip`, a random target) and for an expression that cannot be read yet (it needs a pick not made).
   */
  previewNumber(expression: NumberExpression, context: ResolutionContext): number | undefined {
    if (typeof expression === "number") return expression;
    if (expressionRolls(expression)) return undefined;
    const probe = this.cloneForProbe();
    const rngBefore = probe.state.rngState;
    try {
      const value = probe.evaluateNumber(expression, context);
      // Belt and braces: a roll hidden somewhere the walk above cannot see is not a preview.
      return probe.state.rngState === rngBefore && Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The block a play, an ability use or a FLIP UP reads its picks, costs and numbers from, with who it is paid as:
   * the one place `getPlayRequirements` and the selection queries (`getPlaySelectionInput`, `checkPlaySelection`)
   * take them from. Returns the requirements to give back instead when there is nothing to read yet (a modal
   * card with no mode chosen: the `mode` gate alone) or nothing to ask (no such ability, no such mode: `[]`).
   */
  private playBlockOf(action: PlayAction): PlayBlockInputs | PlayRequirement[] {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);

    let source: PlaySourceBlock | undefined;
    let rolls: Record<string, NumberExpression> | undefined;
    let bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined;
    let abilityId: AbilityId | undefined;
    let controllerId: PlayerId = action.playerId;
    let declarations: TargetDeclaration[];
    let costs: Cost[];
    if (action.type === "activateAbility") {
      const ability = this.getCardActivatedAbilities(card.id).find(a => a.id === action.abilityId);
      if (!ability) return [];
      source = ability;
      rolls = ability.variables;
      bounds = ability.variableBounds;
      abilityId = ability.id;
      declarations = ability.targets ?? [];
      costs = ability.costs ?? [];
      // The Billionaire: a borrowed ability is used as the card's own controller.
      if (this.borrowedAbilityMode(action.playerId, card, ability) !== undefined) controllerId = card.controllerId;
    } else {
      const modes = definition.behavior?.modes;
      if (modes && modes.length > 1 && action.mode === undefined) {
        return [
          {
            kind: "mode",
            options: modes.map((mode, index) => ({ index, label: mode.label ?? `Mode ${index + 1}` }))
          }
        ];
      }
      // A mode the card does not have: nothing to ask, the play itself is refused.
      if (modes && modes.length > 0 && modes[action.mode ?? 0] === undefined) return [];
      source = this.getPlayVariableSource(definition, action.mode);
      rolls = this.getTacticVariableRolls(definition, action.mode);
      bounds = this.getTacticVariableBounds(definition, action.mode);
      declarations = this.getPlayTargetDeclarations(definition, action.mode);
      costs = this.getTacticCosts(definition, action.mode);
    }
    return { source, rolls, bounds, abilityId, controllerId, declarations, costs };
  }

  /** `getPlayRequirements`, run on the throw-away copy. */
  private collectPlayRequirements(action: PlayAction): PlayRequirement[] {
    const card = this.requireCard(action.cardId);
    const block = this.playBlockOf(action);
    if (Array.isArray(block)) return block;
    const { source, rolls, bounds, abilityId, controllerId, declarations, costs } = block;

    const gates: PlayRequirement[] = [];

    if (action.type === "flipUp" && action.flipUpOption === undefined) {
      const options = this.getFlipUpOptions(card.id);
      if (options.length > 1) {
        const described = options.map((option, index) => {
          const block = this.flipUpOptionBlock(action.playerId, card.id, index);
          return {
            index,
            cost: option.cost,
            threshold: option.threshold,
            available: block === undefined,
            ...(block ? { reason: block } : {})
          };
        });
        // With only one option payable there is nothing to ask: the engine takes the first it can pay.
        if (described.filter(option => option.available).length > 1) {
          gates.push({ kind: "flipUpOption", options: described });
        }
      }
    }

    // "Your opponent" with several to choose from (MP 2): ask, unless the picks already settle it.
    if (action.opponentId === undefined) {
      const probeContext: ResolutionContext = {
        sourceId: card.id,
        controllerId,
        selected: { ...(action.selected ?? {}) }
      };
      const unsettled = this.bindBlockOpponent(probeContext, { source, targets: declarations, costs }, declarations);
      if (unsettled) gates.push({ kind: "opponent", candidates: unsettled });
    }

    const supplied = action.variables ?? {};
    const baseContext: ResolutionContext = {
      sourceId: card.id,
      controllerId,
      ...(action.opponentId !== undefined ? { opponentId: action.opponentId } : {}),
      ...(abilityId ? { abilityId } : {}),
      selected: { ...(action.selected ?? {}) },
      variables: { ...supplied },
      ...(action.named ? { named: { ...action.named } } : {}),
      ...(action.type === "flipUp" ? { deployedViaFlipUp: true } : {})
    };
    const chosen = this.playerChosenVariableIds(source);
    const context: ResolutionContext = {
      ...baseContext,
      variables: { ...this.previewRolledVariables(rolls, chosen, baseContext), ...supplied }
    };
    const variables = this.variablesGate(chosen, bounds, context, supplied);
    if (variables) gates.push(variables);
    if (gates.length > 0) return gates;

    // Variables are all known now, so counts can be evaluated. A pick sized by an unguarded roll is the engine's
    // to ask once it has rolled (Hammer Smash: `selectDeployTargets`).
    const deferred =
      action.type === "playCard"
        ? new Set(this.findRandomSizedTargetDeclarations(declarations, rolls, bounds).map(d => d.id))
        : new Set<string>();
    return this.collectPickSteps(
      declarations.filter(declaration => !deferred.has(declaration.id)),
      costs,
      context,
      { pickerId: controllerId, action, siblings: declarations }
    );
  }

  /**
   * Variables the source computes itself and that picks' counts or bounds may read (`variables: { y: <count of
   * ...> }`), evaluated without rolling: a `random` / `coinFlip` is the engine's to roll (`applyVariableRolls`)
   * and an id the player chooses is theirs.
   */
  private previewRolledVariables(
    rolls: Record<string, NumberExpression> | undefined,
    chosen: readonly string[],
    context: ResolutionContext
  ): Record<string, number> {
    return this.walkVariableRolls(rolls, undefined, context, { preview: { chosen } }).resolved;
  }
  /** The "choose a number for X" gate: every chosen id not yet supplied, with the bounds `assertVariableBounds` will hold it to. */
  private variablesGate(
    chosen: readonly string[],
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined,
    context: ResolutionContext,
    supplied: Record<string, number>
  ): PlayRequirement | undefined {
    const missing = chosen.filter(id => !Object.prototype.hasOwnProperty.call(supplied, id));
    if (missing.length === 0) return undefined;
    return {
      kind: "variables",
      variables: missing.map(id => {
        const bound = bounds?.[id];
        let min = 0;
        let max = Number.POSITIVE_INFINITY;
        try {
          if (bound?.min !== undefined) min = Math.max(0, this.evaluateNumber(bound.min, context));
          if (bound?.max !== undefined) max = this.evaluateNumber(bound.max, context);
        } catch {
          // A bound that reads a pick not made yet: leave it open, the engine still has the last word on dispatch.
        }
        return { id, min, max: Math.max(min, max) };
      })
    };
  }

  /**
   * Why FLIP UP option `index` of the face-down `cardId` cannot be used right now, or `undefined` when it can:
   * the answer of `getFlipUpPlayability` for that option, so the option gate of `getPlayRequirements` and the
   * playability query cannot disagree.
   */
  private flipUpOptionBlock(playerId: PlayerId, cardId: CardInstanceId, index: number): string | undefined {
    const playability = this.getFlipUpPlayability(playerId, cardId, index);
    return playability.playable ? undefined : playability.reason;
  }

  /**
   * The picks still to make for `declarations` + `costs`, in the order the engine asks for them: declarations with
   * no `pick` cost step first (they are judged before anything is paid), then the cost steps in written order (a
   * `pick` step marks where its declaration falls; `discard` / `moveSelected` take cards of their own). Each pick
   * carries the cards the engine would accept (`targetCandidates`, or `getPickCandidates` after a cost step), the
   * ones it would refuse, and the bounds `validateTargetDeclarations` holds the answer to.
   */
  private collectPickSteps(
    declarations: TargetDeclaration[],
    costs: Cost[],
    context: ResolutionContext,
    options: {
      pickerId: PlayerId;
      /** The play being built: lets a pick after a cost step rehearse the steps before it. */
      action?: PlayAction;
      /** Every declaration of the source (a deferred one included) for the `distinctPicks` rule. */
      siblings?: TargetDeclaration[];
    }
  ): PickStep[] {
    const { pickerId, action } = options;
    const siblings = options.siblings ?? declarations;
    const costBound = this.costBoundDeclarationIds(costs);
    const ordered = this.orderCosts(costs);
    const upFront = this.upFrontDeclarations(declarations, costs);

    // Implied picks (Verrucose Brains): found the way `validateTargetDeclarations` finds them, on a copy.
    const impliedContext: ResolutionContext = { ...context, selected: { ...context.selected } };
    let noInputNeeded = new Set<string>();
    try {
      noInputNeeded = this.resolveImpliedPicks(upFront, impliedContext);
    } catch {
      // A count that needs a pick not made yet: nothing is implied.
    }
    const impliedDone = new Set(
      upFront
        .filter(d => context.selected[d.id] === undefined && impliedContext.selected[d.id] !== undefined)
        .map(d => d.id)
    );

    type Slot = { requirement: DeclarationRequirement; declaration?: TargetDeclaration };
    const slots: Slot[] = [];
    const targetSlot = (declaration: TargetDeclaration, afterCost: boolean): void => {
      slots.push({ declaration, requirement: this.targetRequirement(declaration, context, afterCost) });
    };
    for (const declaration of upFront) targetSlot(declaration, false);
    for (const cost of ordered) {
      if (cost.type === "pick") {
        const declaration = declarations.find(candidate => candidate.id === cost.declarationId);
        if (declaration) targetSlot(declaration, true);
      } else if (cost.type === "discard" || cost.type === "moveSelected") {
        // "Shuffle this card into your deck": the card itself is the cost, nothing to pick.
        if (cost.type === "moveSelected" && cost.selector.name === "__self") continue;
        slots.push({ requirement: this.costPickRequirement(cost, context) });
      }
    }

    const steps: PickStep[] = [];
    for (const { requirement, declaration } of slots) {
      if (requirement.count <= 0) continue;
      if (context.selected[requirement.id] !== undefined) continue;
      if (impliedDone.has(requirement.id)) continue;

      let candidates: CardInstanceId[];
      if (!declaration) {
        const cost = costs.find(
          (step): step is Extract<Cost, { type: "discard" | "moveSelected" }> =>
            (step.type === "discard" || step.type === "moveSelected") && step.id === requirement.id
        )!;
        candidates = this.costPickCandidates(cost, context);
      } else if (requirement.afterCost && action) {
        try {
          candidates = this.getPickCandidates(
            {
              ...action,
              selected: context.selected,
              variables: context.variables ?? {},
              ...(context.named ? { named: context.named } : {})
            },
            requirement.id
          );
        } catch {
          // A step before the pick can't be rehearsed with what is supplied yet: fall back to the board as it is.
          candidates = this.targetCandidates(requirement.selector, context, pickerId, requirement.count).map(c => c.id);
        }
      } else {
        candidates = this.targetCandidates(requirement.selector, context, pickerId, requirement.count).map(c => c.id);
      }
      const offered = new Set(candidates);
      let blocked = this.queryCards(requirement.selector, context)
        .map(card => card.id)
        .filter(id => !offered.has(id));

      // "Pick 2 characters" as two declarations: the first pick's card is not on offer for the second.
      if (declaration?.distinctPicks) {
        const used = new Set(this.distinctPickCards(siblings, context, requirement.id));
        if (used.size > 0) {
          blocked = [...blocked, ...candidates.filter(id => used.has(id))];
          candidates = candidates.filter(id => !used.has(id));
        }
      }

      // A rule-named pick with no real choice: the engine fills it in itself.
      if (declaration && requirement.afterCost && this.impliedPickApplies(declaration, context) && candidates.length <= requirement.count) {
        continue;
      }
      // An optional pick with nothing to pick asks nobody.
      if (requirement.optional && candidates.length === 0) continue;

      let min: number;
      let max: number;
      let orNone = false;
      if (declaration) {
        try {
          const range = this.pickRange(declaration, context, costBound, noInputNeeded, pickerId);
          ({ min, max } = range);
          orNone = range.orNone === true;
        } catch {
          continue;
        }
      } else {
        min = max = requirement.count;
      }
      // "None, or at least N" with fewer than N cards to take: the only legal answer is none, so nobody is asked.
      if (orNone && candidates.length < min) continue;
      // A mandatory pick can ask for more than exist (the engine will say so on dispatch): take what is there.
      if (candidates.length > 0) min = Math.min(min, candidates.length);

      const distinctNames = requirement.distinctNames;
      const distinctTrades = requirement.distinctTrades === true;
      const distinctTypes = requirement.distinctTypes === true;
      steps.push({
        kind: "pick",
        requirement,
        candidates,
        blocked,
        min,
        max,
        declinable: requirement.declinable ?? false,
        // Every candidate has to be taken and no distinct rule can refuse them.
        ...(orNone ? { orNone: true } : {}),
        forced:
          candidates.length > 0 && min === candidates.length && !orNone && !distinctNames && !distinctTrades && !distinctTypes,
        distinctNames,
        distinctTrades,
        distinctTypes
      });
    }
    return steps;
  }

  /** One targeting declaration as a pick requirement (its count evaluated; an expression that cannot be read yet counts 0). */
  private targetRequirement(
    declaration: TargetDeclaration,
    context: ResolutionContext,
    afterCost: boolean
  ): DeclarationRequirement {
    let count = 0;
    try {
      count = Math.max(0, Math.floor(this.evaluateNumber(declaration.count, context)));
    } catch {
      // Reads a pick not made yet.
    }
    return {
      id: declaration.id,
      selector: declaration.selector,
      count,
      optional: declaration.optional ?? false,
      distinctNames: declaration.distinctNames ?? false,
      ...(declaration.distinctTrades ? { distinctTrades: true } : {}),
      ...(declaration.distinctTypes ? { distinctTypes: true } : {}),
      ...(declaration.distinctPicks ? { distinctPicks: true } : {}),
      ...(declaration.impliedPick ? { impliedPick: true } : {}),
      source: "target",
      ...(afterCost ? { afterCost: true } : {}),
      ...(declaration.optional &&
      this.selectorNamesZone(declaration.selector, "deck") &&
      (declaration.selector as { fromTop?: unknown }).fromTop === undefined
        ? { declinable: true }
        : {})
    };
  }

  /** A `discard` / `moveSelected` cost step as a pick requirement: the selector with the defaults `payCost` applies, exactly `count` cards. */
  private costPickRequirement(
    cost: Extract<Cost, { type: "discard" | "moveSelected" }>,
    context: ResolutionContext
  ): DeclarationRequirement {
    let count = 0;
    try {
      count = Math.max(0, Math.floor(this.evaluateNumber(cost.count, context)));
    } catch {
      // Reads a pick not made yet.
    }
    return {
      id: cost.id,
      selector: {
        ...cost.selector,
        controller: cost.selector.controller ?? "self",
        zone: cost.selector.zone ?? (cost.type === "discard" ? "hand" : "play")
      },
      count,
      optional: false,
      distinctNames: false,
      source: cost.type === "discard" ? "discardCost" : "moveCost",
      costLabel:
        cost.type === "discard"
          ? "discard"
          : cost.shuffle && cost.to === "deck"
            ? "shuffle into your deck"
            : cost.to === "hand"
              ? "return to your hand"
              : cost.to === "deck"
                ? "put into your deck"
                : cost.to === "discard"
                  ? "discard"
                  : "move"
    };
  }

  /**
   * The card that damage / a leave-play targeting `cardId` should be
   * redirected onto, from an active `ContinuousAbility.redirects` entry
   * ("...deal damage to this card instead ... this character leaves play in
   * that way instead"; 6r4wny 60dy9u4rd5). `undefined` if none — or if the
   * redirect target isn't itself a live in-play card.
   */
  private redirectTargetFor(
    cardId: CardInstanceId
  ): CardInstanceId | undefined {
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.redirects) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const redirect of ability.redirects) {
          if (this.resolveTargetRef(redirect.from, ctx) !== cardId) continue;
          const toId = this.resolveTargetRef(redirect.to, ctx);
          if (toId && toId !== cardId && this.state.cards[toId]?.zone === "play") {
            return toId;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * `queryCards` restricted to cards that may legally be *picked* as a
   * target — drops anything with the `cannotBePicked` restriction ("this
   * card cannot be picked"). Used by every player-or-chooser target
   * declaration; `forEach` / `count` / aura / random selectors keep using
   * `queryCards` directly (RULES.md §12: "cannot be picked" only blocks
   * choosing it, not being swept up by an "all X" effect).
   *
   * `pickerId` is the player actually making the pick (defaults to the
   * ability's controller; differs for a `chooserSelectsTarget` whose chooser
   * is someone else) — `cannotBePickedByOpponents` is judged against it.
   *
   * Public: this is the exact check the engine applies to a submitted
   * selection, so a renderer can offer (and grey out) precisely what would
   * be accepted instead of re-deriving the pick rules.
   */
  targetCandidates(
    selector: CardSelector,
    context: ResolutionContext,
    pickerId: PlayerId = context.controllerId,
    /**
     * How many cards the pick takes. A single pick collapses onto a
     * `mustBePicked` card; a bigger pick keeps the whole pool and the caller
     * checks the forced card is one of the picks (`assertMustBePicked`).
     */
    pickCount = 1
  ): CardInstance[] {
    const pickingSourceTypes = this.state.cards[context.sourceId]
      ? this.getCardTypes(context.sourceId)
      : [];
    // "Choosing" a card that the text never says to PICK (CR 310.1: pick is a
    // distinct action) is not restricted by "cannot be picked" and friends.
    if (selector.chosenNotPicked) {
      return this.queryCards(selector, context);
    }
    const eligible = this.queryCards(selector, context).filter(card => {
      if (this.hasRestriction(card.id, "cannotBePicked", pickingSourceTypes)) return false;
      if (
        card.controllerId !== pickerId &&
        this.hasRestriction(card.id, "cannotBePickedByOpponents")
      ) {
        return false;
      }
      // "this card cannot be picked by <cardType>s" (Parkour Hoodlum) —
      // scoped on the card/ability doing the picking.
      for (const type of this.ignoredSourceTypesFor(card.id)) {
        if (pickingSourceTypes.includes(type)) return false;
      }
      return true;
    });

    // "Anything that can pick this card must pick it" (Ferret Oil Coating) —
    // if the legal pool contains any `mustBePicked` card, it collapses to
    // just those. (Forces *which* card, not *whether* to pick for a
    // fully-optional declaration.) A pick of several cards keeps the rest of
    // the pool: the forced card only has to be one of them.
    const forced = eligible.filter(card =>
      this.hasRestriction(card.id, "mustBePicked")
    );
    return forced.length > 0 && pickCount <= 1 ? forced : eligible;
  }

  /**
   * "Anything that could pick this card must pick it" (Ferrous Ferret) for a
   * pick of several cards: the selection has to include every forced card the
   * pool offers, up to the number of cards picked.
   */
  private assertMustBePicked(
    declarationId: string,
    pool: CardInstance[],
    selected: CardInstanceId[],
    pickCount: number
  ): void {
    if (pickCount <= 1) return;
    const forced = pool
      .filter(c => this.hasRestriction(c.id, "mustBePicked"))
      .map(c => c.id);
    if (forced.length === 0) return;
    const need = Math.min(forced.length, pickCount, selected.length || pickCount);
    const have = selected.filter(id => forced.includes(id)).length;
    assert(
      have >= need,
      `Target '${declarationId}' must include the card that has to be picked.`
    );
  }

  /**
   * Card types whose rules text `cardId` currently ignores — an in-play,
   * face-up `ContinuousAbility.ignoresRulesTextFrom` on `cardId` itself
   * whose `condition` (if any) holds. "This card ignores all rules text on
   * locations." (Parkour Hoodlum). A card of one of these types cannot pick
   * `cardId` as a target, and its single-target effects / auras skip it.
   */
  private ignoredSourceTypesFor(cardId: CardInstanceId): CardType[] {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || card.faceDown) return [];

    const result: CardType[] = [];
    for (const ability of this.getDefinition(cardId).behavior?.abilities ?? []) {
      if (ability.type !== "continuous" || !ability.ignoresRulesTextFrom) {
        continue;
      }
      if (this.abilitySuppressed(cardId, ability.id)) continue;
      const ctx: ResolutionContext = {
        sourceId: cardId,
        controllerId: card.controllerId,
        abilityId: ability.id,
        selected: {}
      };
      if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
        continue;
      }
      result.push(ability.ignoresRulesTextFrom);
    }
    return result;
  }

  /** True when `selector.zone` explicitly names `zone` (a bare selector defaults to in-play only, so it doesn't). */
  private selectorNamesZone(selector: CardSelector, zone: Zone): boolean {
    const z = selector.zone;
    if (z === undefined || z === "any") return false;
    return Array.isArray(z) ? z.includes(zone) : z === zone;
  }

  /** True when a mutation whose origin is `sourceId` must not affect `targetId` ("effects from <cardType> do not affect this card"; Parkour Hoodlum). */
  private sourceClassIgnoredByTarget(
    targetId: CardInstanceId,
    sourceId: CardInstanceId | undefined
  ): boolean {
    if (!sourceId || !this.state.cards[sourceId]) return false;
    const ignored = this.ignoredSourceTypesFor(targetId);
    if (ignored.length === 0) return false;
    const sourceTypes = this.getCardTypes(sourceId);
    return ignored.some(type => sourceTypes.includes(type));
  }

  // ---------------------------------------------------------------------------
  // Card play / response stack
  // ---------------------------------------------------------------------------

  private playCard(
    action: Extract<GameAction, { type: "playCard" }>
  ): void {
    this.assertCanDeployAtCurrentTiming(
      action.playerId,
      this.getDefinition(action.cardId),
      action.cardId
    );

    {
      // Q12: a modal card ("choose one") must be played with a mode, and a
      // "choose a number for X" card with an X (an explicit X = 0 is legal).
      // Free plays by effects never come through here and keep X = 0.
      const playedDef = this.getDefinition(action.cardId);
      const modes = playedDef.behavior?.modes;
      assert(
        !(modes && modes.length > 1) || action.mode !== undefined,
        `'${playedDef.name}' is modal: choose a mode to play it.`
      );
      this.assertChosenVariablesPresent(
        this.playerChosenVariableIds(this.getPlayVariableSource(playedDef, action.mode)),
        action.variables,
        playedDef.name
      );
    }

    this.costResume = action;
    this.costChoicePaused = false;
    try {
      this.deployCard(
        action.playerId,
        action.cardId,
        action.selected ?? {},
        action.variables ?? {},
        false,
        false,
        undefined,
        false,
        action.mode,
        undefined,
        action.named
      );
    } finally {
      this.costResume = undefined;
    }
    // A cost choice paused the play (nothing paid, the card is still in hand).
    if (this.costChoicePaused) {
      this.costChoicePaused = false;
      return;
    }

    // "Your opponents cannot respond to this card." (Swindle) — resolve the
    // just-pushed stack item straight away, no response window of its own.
    if (this.getDefinition(action.cardId).behavior?.noResponse) {
      this.resolveTopOfStack();
      this.checkStateBasedActions();

      // If it was itself a response, the window is still open for the item
      // beneath it — hand priority to whoever may still respond to that
      // (CR §607.2).
      const w = this.state.responseWindow;
      if (
        w &&
        w.phase === "acceptingResponses" &&
        !this.state.pendingChoice &&
        this.responseStack.length > 0
      ) {
        const top = this.responseStack[this.responseStack.length - 1];
        this.offerTopOfStack(w, top.controllerId);
      }
      return;
    }

    this.afterStackAction(action.playerId);
  }

  /**
   * The core "put a hand card on the response stack" logic shared by a
   * normal playCard action and a `deployForFree` effect's nested play.
   * Timing (priority/response-window) legality is the caller's
   * responsibility — `deployForFree` deploys synchronously as part of
   * resolving another effect, not as a fresh player-initiated action, so it
   * deliberately skips `assertCanDeployAtCurrentTiming`.
   */
  private deployCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    free: boolean,
    fromZone = false,
    costOverride?: number,
    ignoreThreshold = false,
    mode?: number,
    trustedVariables?: Record<string, number>,
    named?: Record<string, string>
  ): void {
    try {
      this.deployCardInner(
        playerId,
        cardId,
        selected,
        variables,
        free,
        fromZone,
        costOverride,
        ignoreThreshold,
        mode,
        trustedVariables,
        named
      );
    } finally {
      this.beingDeployedId = undefined;
    }
  }

  private deployCardInner(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    free: boolean,
    fromZone = false,
    /**
     * A flat numeric cost that replaces `definition.cost` (and any
     * reductions / cost modifiers) — the "deploy this card for N"
     * alternative cost of a `revealFromHand` deploy (Witty Worm).
     */
    costOverride?: number,
    /**
     * Skip the printed-threshold gate — "deploy it for free even if you
     * cannot meet its threshold" (`deployFromZone.ignoreThreshold`; I Drink
     * Your Milkshake!).
     */
    ignoreThreshold = false,
    /** Chosen mode index for a modal tactic (`behavior.modes`). */
    mode?: number,
    /**
     * Engine-internal only, never derived from a raw `GameAction`: set when
     * resuming a `selectDeployTargets` pending choice, so `applyVariableRolls`
     * reuses the roll already made (and logged) when the choice was opened
     * instead of rolling again. See `openDeployTargetChoice`.
     */
    trustedVariables?: Record<string, number>,
    /** `nameValue` cost answers, keyed by `storeAs` (see `GameAction` `named`). */
    named?: Record<string, string>
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(card.id);

    if (fromZone) {
      // "You may deploy the <card>" — a face-down permanent/tactic in play,
      // or a card in the discard pile. Flipping a face-down card face-up is
      // a leaves-play/enters-play boundary in its own right (RULES.md §2);
      // `moveCard` to "deploying" below fires that.
      assert(
        card.ownerId === playerId || card.controllerId === playerId,
        "You cannot deploy that card."
      );
      if (card.faceDown && card.zone === "play") {
        // The threshold is judged before anything changes (a refused play
        // must leave the card face-down), without the card's own icon: once
        // flipped up it no longer provides Volition.
        if (!ignoreThreshold) {
          this.thresholdExcludedCard = card.id;
          try {
            const thresholdProblem = this.deployThresholdProblem(playerId, definition, card.id);
            if (thresholdProblem) throw new Error(thresholdProblem);
          } finally {
            this.thresholdExcludedCard = undefined;
          }
        }
        // Flip it up now so threshold / cost / target resolution below sees
        // its real characteristics, but record that the thing about to
        // leave play (via `moveCard` to "deploying") was a face-down
        // resource with no rules text — its "leaves play" trigger must not
        // fire on the way out (CR §411.3).
        card.faceDown = false;
        this.faceDownDeparture.add(card.id);
      }
      card.controllerId = playerId;
    } else {
      // "You may deploy the voided cards as though they were in your hand"
      // (Cheats) — a matching `voidPlayGrant` lets a void-zone card be
      // deployed like a hand card (optionally ignoring its threshold), even
      // one an opponent owns; the deploying player takes control of it.
      // The same grant covers cards "removed from the game" by the granting
      // card (Eccentric Inquisition, Pant Swipe): they sit in the Out of Game
      // area (CR 403.6), which nothing else can reach into.
      // "While this card is depleted, you may deploy tactics in the void as
      // though they were in your hand" (Voidal Tactician) — a live
      // ContinuousAbility.voidPlay grant, not a persisted per-card entry.
      // (Both kinds: `outsideHandPlayAccess`.)
      const outsideAccess = this.outsideHandPlayAccess(card.id, playerId);
      if (outsideAccess) {
        card.controllerId = playerId;
        if (outsideAccess.ignoreThreshold) {
          ignoreThreshold = true;
        }
      } else {
        assert(
          card.controllerId === playerId,
          "You do not control that card."
        );
        assert(card.zone === "hand", "Card must be in your hand.");
      }
    }

    if (!ignoreThreshold && this.costCommitted() === 0) {
      const thresholdProblem = this.deployThresholdProblem(playerId, definition, card.id);
      if (thresholdProblem) throw new Error(thresholdProblem);
    }

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: playerId,
      selected,
      variables,
      ...(named ? { named } : {})
    };

    // The card is in Being Deployed from here on (CR 604.1): no cost or pick can use it.
    this.beingDeployedId = card.id;

    const tacticRolls = this.getTacticVariableRolls(definition, mode);
    const tacticBounds = this.getTacticVariableBounds(definition, mode);

    // Resolved before condition/targets/costs — e.g. "flip a coin; X is 1
    // or 2" has to be settled before "pick X or fewer items" can even be
    // validated.
    this.applyVariableRolls(
      tacticRolls,
      tacticBounds,
      context,
      trustedVariables,
      // A pick sized by the roll follows (Hammer Smash): a lost coin may stop for its reflip first.
      !trustedVariables &&
        this.findRandomSizedTargetDeclarations(this.getPlayTargetDeclarations(definition, mode), tacticRolls, tacticBounds)
          .length > 0
    );
    this.assertVariableBounds(tacticBounds, context, tacticRolls);

    const tacticCondition = this.getTacticCondition(definition, mode);
    assert(
      !tacticCondition || this.evaluateCondition(tacticCondition, context),
      "This card cannot be deployed right now."
    );

    const targetDeclarations = this.getPlayTargetDeclarations(definition, mode);

    // The opponent this play's rules text is about (MP 2): named by the play
    // action, or settled by its picks. A deploy an effect makes, with nobody
    // to ask, takes the first candidate in turn order.
    {
      const resumed = this.costResume;
      const announced =
        (resumed?.type === "playCard" || resumed?.type === "flipUp") && resumed.cardId === cardId ? resumed : undefined;
      const unsettled = this.bindBlockOpponent(
        context,
        {
          targets: targetDeclarations,
          costs: this.getTacticCosts(definition, mode),
          condition: tacticCondition,
          effects: definition.type === "tactic" ? this.getTacticEffects(definition, mode) : [],
          // "Both players switch seats": the card is played against one opponent.
          ...(this.continuousAbilitiesOf(definition).some(ability => ability.swapsSides) ? { against: "opponent" } : {})
        },
        targetDeclarations,
        announced?.opponentId
      );
      if (unsettled) {
        assert(!announced, `Choose which opponent '${definition.name}' is about (opponentId).`);
        context.opponentId = unsettled[0];
      }
    }

    // "Flip a coin; if you win, X is 2, otherwise 1. Pick X or fewer
    // items." (Hammer Smash) — the only card today whose target count
    // depends on an unguarded random roll. A client can't size that
    // selection correctly until the engine itself has rolled, so on the
    // FIRST attempt (not a resumed choice — `trustedVariables` is unset)
    // this pays no costs and instead pauses for a follow-up pick with the
    // count already fixed. See `findRandomSizedTargetDeclarations`.
    if (!trustedVariables) {
      const deferred = this.findRandomSizedTargetDeclarations(targetDeclarations, tacticRolls, tacticBounds);
      if (deferred.length > 0) {
        const immediate = targetDeclarations.filter(d => !deferred.includes(d));
        this.validateTargetDeclarations(immediate, context);
        this.openDeployTargetChoice(
          playerId,
          cardId,
          context,
          deferred,
          free,
          fromZone,
          costOverride,
          ignoreThreshold,
          mode
        );
        return;
      }
    }

    // Picks written after a cost step (`pick` steps) are validated as that step is paid.
    // (A re-run after another player's answer has paid its first steps already: they were validated before.)
    this.validateTargetDeclarations(
      this.costCommitted() > 0
        ? []
        : this.upFrontDeclarations(targetDeclarations, this.getTacticCosts(definition, mode)),
      context,
      this.getTacticCosts(definition, mode)
    );

    // Deploying for free waives only the numeric cost — every extra cost the
    // card prints (targets, deplete, "Pay 2", "Pay X+X") still applies
    // (CR 308.1a), matching cards like Spontaneous Displacement's "you still
    // need to... satisfy its extra costs" reminder text.
    const extraCosts = this.getTacticCosts(definition, mode);

    // A pending "reduce the next numeric cost you pay this turn" is only
    // actually consumed once the whole payment is confirmed affordable —
    // peeked here, spliced out below, not before. A `costOverride` (Witty
    // Worm's flat alt cost) bypasses reductions and cost modifiers alike.
    // Every pending "reduce the next card" for this player stacks on that one
    // card (two Organists: the same next card costs 2 less) and all are
    // consumed together.
    const pendingReductions =
      free || costOverride !== undefined
        ? []
        : this.pendingCostReductions(playerId, definition.type, false);

    // "reduce this card's numeric cost by the number of cards removed [as an
    // EXTRA COST]" (Opportunistic Pirate, Moment of Annihilation) — evaluated
    // in the play context so it can read the EXTRA-COST selections.
    const playCostAdjust = this.getPlayCostAdjust(definition, mode);
    const onPlayAdjust =
      !free && costOverride === undefined && playCostAdjust
        ? this.evaluateNumber(playCostAdjust, context)
        : 0;

    // CR 406.3: the running total starts at the cost number, every extra "pay N" adds to it, then all the
    // increases and then all the reductions apply; what is left is paid, LAST (CR 406.3a, 604.1d). A play for
    // free has a cost number of 0 and no adjustment; a flat alternative cost (`costOverride`) bypasses them.
    const baseCost = free ? 0 : costOverride !== undefined ? Math.max(0, costOverride) : (definition.cost ?? 0);
    const numericAdjusts =
      free || costOverride !== undefined
        ? []
        : this.deployCostAdjusts(playerId, cardId, onPlayAdjust, pendingReductions);

    // Extra costs in written order, the numeric cost LAST.
    let costs: Cost[] = this.withPickDeclarations(
      this.orderCosts(
        this.foldNumericCost(
          [
            { type: "payResources", amount: baseCost },
            ...extraCosts,
            ...this.pickTaxCosts(playerId, targetDeclarations, context)
          ],
          numericAdjusts
        )
      ),
      targetDeclarations
    );

    // Name the shortfall when it's the numeric cost — with a selection-based
    // reduction (Opportunistic Pirate) "how many did you pick" decides it, so
    // a bare "Costs cannot be paid." leaves the player guessing.
    const numericShortfall = this.deployNumericCostProblem(playerId, this.previewNumericCost(costs, context));
    if (numericShortfall) throw new Error(numericShortfall);
    this.assertChosenVariables(context.variables);
    if (this.costCommitted() === 0) this.assertInfluenceAffordable(costs, context);
    this.assertCostsPayable(costs, context, "Costs cannot be paid.");
    {
      // Payable at all: now ask the payer about the choices inside the cost.
      const bound = this.bindCostChoices(costs, context, this.costResume);
      if (!bound) return;
      costs = bound;
    }

    this.consumeCostReductions(pendingReductions);

    this.lastNumericCostPaid = 0;
    if (this.payCosts(costs, context, this.costResume)) {
      // Stopped to ask another player about a cost step (E3c): the steps before it are paid, the reductions
      // are still to be used by the re-run.
      this.state.costReductions.push(...pendingReductions);
      return;
    }
    const numericCostPaid = this.lastNumericCostPaid;
    const playCost = numericCostPaid;
    this.beingDeployedId = undefined;

    // A cost can leave something lethal (Homewrecker's 2 damage to a
    // location): it is destroyed now, while the card is still being played
    // (CR 502.4, 408.5), before any aura it gives is on.
    this.checkStateBasedActions();

    if (definition.type !== "tactic") {
      card.deployedAsResponse = this.state.responseWindow !== undefined;
    }

    // "reduce the threshold requirement of the NEXT card you deploy" —
    // consumed now (its threshold gate was already checked above).
    this.state.thresholdReductions = this.state.thresholdReductions.filter(
      r => r.playerId !== playerId
    );

    this.enterOrigin.set(card.id, card.zone);
    this.moveCard(card.id, "deploying");
    // Its numeric cost while it is being played is the running total (CR 406.3): what the cards that respond
    // to it ("pay X, where X is its numeric cost") read.
    card.numericCostPaid = numericCostPaid;

    const effects =
      definition.type === "tactic"
        ? this.getTacticEffects(definition, mode)
        : [];

    // "an opponent deployed at least 2 cards with the same name this turn" /
    // "an opponent deployed a character this turn" (deploysThisTurn)
    (this.state.turnDeploys[playerId] ??= []).push({
      name: definition.name,
      type: definition.type
    });
    if (definition.type === "tactic") {
      (this.state.tacticsPlayedThisTurn ??= []).push(card.id);
      (this.state.tacticPlayVariables ??= {})[card.id] = { ...(context.variables ?? {}) };
    }

    // The `cardPlayed` event and the stack push are one step: a
    // `cardPlayed` trigger (e.g. "terminate the tactic") must see the card
    // already on the response stack. Batching defers the trigger until the
    // push below has happened.
    this.beginEventBatch();
    try {
      this.emit({
        type: "cardPlayed",
        cardId: card.id,
        playerId,
        ...(context.deployedViaFlipUp ? { viaFlipUp: true } : {})
      });

      this.responseStack.push({
        id: this.nextId("stack"),
        sourceId: card.id,
        controllerId: playerId,
        kind: "card",
        effects,
        context,
        playCost
      });

      // The extra-cost picks were made as the card was played: "if this card
      // is picked" triggers (Ferrous Ferret) see them before the card resolves.
      this.emitCardPicked(context.selected, playerId, targetDeclarations.map(d => d.id));
    } finally {
      this.endEventBatch();
    }
  }

  /** Hand cards `playerId` could deploy via a `deployForFree` effect right now. */
  private deployForFreeCandidates(
    playerId: PlayerId,
    maxCost: number,
    selector: CardSelector | undefined,
    context: ResolutionContext
  ): CardInstanceId[] {
    return Object.values(this.state.cards)
      .filter(card => {
        if (card.zone !== "hand" || card.controllerId !== playerId) return false;
        // CR 604.2: an effect that lets you deploy a card never deploys a resource.
        if (this.getDefinition(card.id).type === "resource") return false;
        if ((this.getDefinition(card.id).cost ?? 0) > maxCost) return false;
        // The hand-zone gate is already applied; don't let the selector's
        // in-play zone default fight it.
        return (
          !selector ||
          this.matchesSelector(card, { ...selector, zone: "any" }, context)
        );
      })
      .map(card => card.id);
  }

  /**
   * Resolves the chosen card from a `deployForFree` effect: deploys it
   * (waiving its numeric cost) and resolves it synchronously — like any
   * other nested consequence of an effect, it does not open its own
   * response window — before continuing whatever ability the
   * `deployForFree` effect itself belonged to.
   */
  private deployCardForFree(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    fromZone = false,
    ignoreThreshold = false,
    payCost = false,
    after?: { effects: Effect[]; context: ResolutionContext },
    costOverride?: number
  ): void {
    // An engine-offered candidate the deployer doesn't own or control — an
    // opponent's card parked out of play ("you may deploy it for free" — I
    // Drink Your Milkshake!) — is deployed under the deployer's control.
    const card = this.requireCard(cardId);
    const previousController = card.controllerId;
    const wasFaceDownInPlay = card.faceDown && card.zone === "play";
    if (fromZone && card.zone !== "play" && card.ownerId !== playerId && card.controllerId !== playerId) {
      card.controllerId = playerId;
    }
    try {
      this.deployCard(
        playerId,
        cardId,
        selected,
        variables,
        !payCost,
        fromZone,
        costOverride,
        ignoreThreshold
      );
    } catch (error) {
      card.controllerId = previousController;
      // A refused play is atomic (CR 604.1e): a face-down card that was
      // flipped up to be checked (threshold, cost) goes back face-down.
      if (wasFaceDownInPlay && card.zone === "play" && !card.faceDown) {
        card.faceDown = true;
        this.faceDownDeparture.delete(card.id);
      }
      throw error;
    }

    // Only reached once deployCard has committed (it throws before
    // mutating anything on a validation failure) — this IS the "deployed
    // for free" pendingChoice being answered, so clear it now.
    this.state.pendingChoice = undefined;

    // "...and terminate your opponent's card" rides on the deploy actually
    // happening (Q22); it runs when the frames resume.
    if (after) {
      this.state.pendingEffectFrames.push({
        effects: after.effects,
        index: 0,
        context: after.context
      });
    }

    // If the newly-deployed card's own resolution (e.g. its ETB trigger)
    // needs a chooser's input, that pause takes priority — the ability
    // that originally paused on `deployForFree` must stay parked in
    // pendingEffectFrames until this new pause is answered too, not get
    // resumed out from under it.
    // A tactic played by an effect is played like any other (CR 604.1g): it
    // waits on the response stack and the opponent may respond to it once the
    // effect that played it has finished (`resumeEffectFrames` opens the
    // window). Only "your opponent cannot respond to this card" resolves at once.
    const played = this.getDefinition(cardId);
    if (played.type === "tactic" && !played.behavior?.noResponse) {
      this.resumeEffectFrames();
      return;
    }
    if (this.resolveTopOfStack()) {
      this.resumeEffectFrames();
    }
  }

  /**
   * The play-time instruction block for a tactic — its first
   * activated-ability-shaped behavior, or, when the card is a modal tactic
   * (`behavior.modes`) and `mode` is supplied, that chosen mode. Non-tactic
   * permanents use `behavior.onPlay` instead (handled by each getter).
   */
  private getTacticSource(
    definition: CardDefinition,
    mode?: number
  ): {
    condition?: Condition;
    costs?: Cost[];
    costAdjust?: NumberExpression;
    targets?: TargetDeclaration[];
    variables?: Record<string, NumberExpression>;
    variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
    effects?: Effect[];
  } | undefined {
    const modes = definition.behavior?.modes;
    if (modes && modes.length > 0) {
      const picked = modes[mode ?? 0];
      assert(picked, `Modal card '${definition.name}' has no mode ${mode}.`);
      return picked;
    }
    return definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;
  }

  /**
   * The card's own "reduce this card's numeric cost by..." expression, wherever
   * its type keeps it: a tactic's play source (first activated ability, or
   * the chosen mode) or a non-tactic's `behavior.onPlay`.
   */
  private getPlayCostAdjust(
    definition: CardDefinition,
    mode?: number
  ): NumberExpression | undefined {
    return definition.type === "tactic"
      ? this.getTacticSource(definition, mode)?.costAdjust
      : definition.behavior?.onPlay?.costAdjust;
  }

  /**
   * The block whose costs, targets and play condition name the numbers the PLAYER chooses when this card is
   * played (`playerChosenVariableIds`): a tactic's play source (its first activated ability or the chosen mode), a
   * non-tactic's `behavior.onPlay`.
   */
  private getPlayVariableSource(
    definition: CardDefinition,
    mode?: number
  ): PlaySourceBlock | undefined {
    return definition.type === "tactic"
      ? this.getTacticSource(definition, mode)
      : definition.behavior?.onPlay;
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition,
    mode?: number
  ): TargetDeclaration[] {
    const declarations: TargetDeclaration[] = [];

    if (definition.type === "tactic") {
      declarations.push(...(this.getTacticSource(definition, mode)?.targets ?? []));
    } else if (definition.behavior?.onPlay?.targets) {
      // A non-tactic permanent's "EXTRA COST: Pick ..." picks.
      declarations.push(...definition.behavior.onPlay.targets);
    }

    if (definition.attachTo) {
      declarations.push({
        id: ATTACH_TARGET_ID,
        selector: {
          type: definition.attachTo,
          ...(definition.attachToController ? { controller: definition.attachToController } : {})
        },
        count: 1
      });
    }

    return declarations;
  }

  private getTacticEffects(definition: CardDefinition, mode?: number): Effect[] {
    return this.getTacticSource(definition, mode)?.effects ?? [];
  }

  /** Extra costs beyond the printed numeric cost (e.g. "EXTRA COST: Choose a number for X. Pay X+X."). */
  private getTacticCosts(definition: CardDefinition, mode?: number): Cost[] {
    if (definition.type !== "tactic") {
      return definition.behavior?.onPlay?.costs ?? [];
    }
    return this.getTacticSource(definition, mode)?.costs ?? [];
  }

  /** A play-timing restriction beyond the normal response-window rules (e.g. "deploy this only while you are attacking"). */
  private getTacticCondition(
    definition: CardDefinition,
    mode?: number
  ): Condition | undefined {
    if (definition.type !== "tactic") {
      return definition.behavior?.onPlay?.condition;
    }
    return this.getTacticSource(definition, mode)?.condition;
  }

  private getTacticVariableRolls(
    definition: CardDefinition,
    mode?: number
  ): Record<string, NumberExpression> | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }
    return this.getTacticSource(definition, mode)?.variables;
  }

  /**
   * The one walk over a source's `variables` block, behind both `applyVariableRolls` (which rolls) and
   * `previewRolledVariables` (which never does): every entry in written order, evaluated against `context` as it
   * stands (a value computed here is not visible to the next entry; the caller merges them).
   *
   * Rolling mode returns the value of every entry plus the ids that are an UNGUARDED `random` / `coinFlip` (no
   * paired entry in `bounds`): a trusted roll from `options.trustedRolls` stands in for the roll, and a coin flip
   * the play will hold (`options.canHoldCoin`) goes through `rollCoinVariable`.
   *
   * Preview mode (`options.preview`) leaves out the ids the player chooses and anything that rolls, and an entry
   * that cannot be read yet (it needs a pick not made) is left out rather than failing.
   */
  private walkVariableRolls(
    rolls: Record<string, NumberExpression> | undefined,
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined,
    context: ResolutionContext,
    options: {
      preview?: { chosen: readonly string[] };
      trustedRolls?: Record<string, number>;
      canHoldCoin?: boolean;
    }
  ): { resolved: Record<string, number>; unguarded: Set<string> } {
    const resolved: Record<string, number> = {};
    const unguarded = new Set<string>();

    for (const [id, expression] of Object.entries(rolls ?? {})) {
      if (options.preview) {
        if (options.preview.chosen.includes(id) || expressionRolls(expression)) continue;
        try {
          resolved[id] = this.evaluateNumber(expression, context);
        } catch {
          // Reads something not known yet; counts that depend on it read 0 until it is.
        }
        continue;
      }

      const isUnguardedRandom =
        typeof expression !== "number" &&
        (expression.type === "random" || expression.type === "coinFlip") &&
        !(bounds && Object.prototype.hasOwnProperty.call(bounds, id));
      if (isUnguardedRandom) unguarded.add(id);

      const { trustedRolls, canHoldCoin } = options;
      if (isUnguardedRandom && trustedRolls && Object.prototype.hasOwnProperty.call(trustedRolls, id)) {
        resolved[id] = trustedRolls[id];
      } else if (typeof expression !== "number" && expression.type === "coinFlip" && canHoldCoin && !this.dryRun) {
        resolved[id] = this.rollCoinVariable(id, expression, context);
      } else {
        resolved[id] = this.evaluateNumber(expression, context);
      }
    }

    return { resolved, unguarded };
  }
  /**
   * Evaluates `rolls` once and merges them into `context.variables`.
   *
   * A caller-supplied value in `context.variables` wins for everything
   * EXCEPT an unguarded `random` roll — one with no paired entry in
   * `bounds` (a "the game rolls" variable, e.g. a coin flip or damage
   * variance, as opposed to a `variableBounds`-validated "player chooses a
   * number" one). Trusting a caller's value there would let a network
   * client fake any unguarded dice roll.
   *
   * `trustedRolls` is engine-internal only (never derived from a raw
   * `GameAction`): the resume half of a deferred target pick (see
   * `findRandomSizedTargetDeclarations` / `openDeployTargetChoice`) passes
   * back the roll that was already made and logged when the choice was
   * opened, so re-evaluating a `random` expression here doesn't consume
   * fresh entropy and disagree with what the player already saw.
   */
  private applyVariableRolls(
    rolls: Record<string, NumberExpression> | undefined,
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined,
    context: ResolutionContext,
    trustedRolls?: Record<string, number>,
    /** The play is about to ask for a pick sized by the roll, so a lost coin may stop to offer its reflip (see `heldCoinRoll`). */
    canHoldCoin = false
  ): void {
    if (!rolls) {
      return;
    }

    const callerVariables = context.variables ?? {};
    const merged: Record<string, number> = { ...callerVariables };
    const { resolved, unguarded } = this.walkVariableRolls(rolls, bounds, context, { trustedRolls, canHoldCoin });

    for (const id of Object.keys(rolls)) {
      merged[id] = unguarded.has(id) ? resolved[id] : (callerVariables[id] ?? resolved[id]);
    }

    context.variables = merged;

    // Surface every `random`-typed roll ("flip a coin; X is 1 or 2") so the
    // log / a renderer can show how it landed. Always the authoritative
    // value now (`context.variables[id]`, per the merge above) — never a
    // client-fabricated one.
    for (const [id, expression] of Object.entries(rolls)) {
      if (typeof expression === "number" || expression.type !== "random") continue;
      this.recordLogEvent({
        type: "variableRolled",
        sourceId: context.sourceId,
        name: id,
        value: context.variables[id] ?? resolved[id],
        min: this.evaluateNumber(expression.min, context),
        max: this.evaluateNumber(expression.max, context)
      });
    }
  }

  /** A lost `coinFlip` roll held back (not yet logged) because a "you may reflip" replacement is on offer; see `rollCoinVariable`. */
  private heldCoinRoll?: {
    id: string;
    flipperId: PlayerId;
    winValue: number;
    loseValue: number;
    replacement: { sourceId: CardInstanceId; cost: Cost[]; effects: Effect[] };
  };

  /**
   * Flips the coin of a `coinFlip` variable roll. A LOSS the flipper can undo with a coin-flip replacement
   * (Two-Headed Coin) is held back, not logged: the play opens the `coinFlipReplace` prompt before the pick that
   * the roll sizes (`openDeployTargetChoice`). Everything else is a plain, logged flip.
   */
  private rollCoinVariable(
    id: string,
    expression: Extract<NumberExpression, { type: "coinFlip" }>,
    context: ResolutionContext
  ): number {
    const flipper = this.resolvePlayerRef(expression.player ?? "controller", context);
    const won = this.random() < 0.5;
    const winValue = this.evaluateNumber(expression.win, context);
    const loseValue = this.evaluateNumber(expression.lose, context);
    if (!won) {
      const replacement = this.findCoinFlipLossReplacement(flipper.id, context);
      if (replacement) {
        this.heldCoinRoll = { id, flipperId: flipper.id, winValue, loseValue, replacement };
        return loseValue;
      }
    }
    this.emit({ type: "coinFlipped", playerId: flipper.id, won });
    return won ? winValue : loseValue;
  }

  /**
   * Which of `declarations` have a `count` that (transitively) depends on
   * an unguarded random roll — the one shape that can't be sized correctly
   * by a client submitting one atomic action, since the true roll isn't
   * decided until the engine itself makes it. See `applyVariableRolls`.
   */
  private findRandomSizedTargetDeclarations(
    declarations: TargetDeclaration[],
    rolls: Record<string, NumberExpression> | undefined,
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined
  ): TargetDeclaration[] {
    if (!rolls) return [];

    const unguardedRandomIds = new Set(
      Object.entries(rolls)
        .filter(
          ([id, expression]) =>
            typeof expression !== "number" &&
            (expression.type === "random" || expression.type === "coinFlip") &&
            !(bounds && Object.prototype.hasOwnProperty.call(bounds, id))
        )
        .map(([id]) => id)
    );

    if (unguardedRandomIds.size === 0) return [];

    return declarations.filter(declaration =>
      this.numberExpressionReferencesAny(declaration.count, unguardedRandomIds)
    );
  }

  /** Walks a `NumberExpression` tree for a `{type:"variable"}` reference to any id in `ids`. */
  private numberExpressionReferencesAny(expression: NumberExpression, ids: ReadonlySet<string>): boolean {
    if (typeof expression === "number") return false;

    switch (expression.type) {
      case "variable":
        return ids.has(expression.id);
      case "add":
      case "multiply":
        return expression.values.some(value => this.numberExpressionReferencesAny(value, ids));
      case "divide":
      case "modulo":
        return (
          this.numberExpressionReferencesAny(expression.value, ids) ||
          this.numberExpressionReferencesAny(expression.by, ids)
        );
      case "conditional":
        return (
          this.numberExpressionReferencesAny(expression.then, ids) ||
          this.numberExpressionReferencesAny(expression.else, ids)
        );
      default:
        return false;
    }
  }

  /**
   * Pauses `deployCard` on a `selectDeployTargets` pending choice for
   * `deferred` declarations (a random-sized target count — see
   * `findRandomSizedTargetDeclarations`). Nothing has been paid or mutated
   * yet at this point, so this is a plain early-return, not a suspend of
   * in-progress work. `resolvePendingChoice` resumes by re-invoking
   * `deployCard` with the same arguments, the newly-chosen selection merged
   * in, and `context.variables` (which already holds the roll this choice
   * was opened with) passed back as `trustedVariables` so it isn't rolled
   * again.
   */
  private openDeployTargetChoice(
    playerId: PlayerId,
    cardId: CardInstanceId,
    context: ResolutionContext,
    deferred: TargetDeclaration[],
    free: boolean,
    fromZone: boolean,
    costOverride: number | undefined,
    ignoreThreshold: boolean,
    mode: number | undefined
  ): void {
    const picks: PendingChoice = {
      kind: "selectDeployTargets",
      id: this.nextId("choice"),
      playerId,
      sourceId: cardId,
      declarations: deferred,
      selected: context.selected,
      variables: context.variables ?? {},
      free,
      fromZone,
      costOverride,
      ignoreThreshold,
      mode
    };
    const held = this.heldCoinRoll;
    this.heldCoinRoll = undefined;
    if (held) {
      // The coin was lost and the flipper holds a "may reflip" replacement (Two-Headed Coin): offer it before the pick.
      this.state.pendingCoinFlip = {
        context,
        flipperId: held.flipperId,
        winEffects: [],
        loseEffects: [],
        replacementCost: structuredClone(held.replacement.cost),
        replacementEffects: structuredClone(held.replacement.effects),
        replacementSourceId: held.replacement.sourceId,
        then: picks,
        rollId: held.id,
        winValue: held.winValue,
        loseValue: held.loseValue
      };
      this.state.pendingChoice = {
        kind: "coinFlipReplace",
        id: this.nextId("choice"),
        playerId: held.flipperId,
        cost: structuredClone(held.replacement.cost),
        sourceId: held.replacement.sourceId,
        flipSourceId: context.sourceId,
        won: false
      };
      return;
    }
    this.state.pendingChoice = picks;
  }

  /**
   * "Pick a number for X, where X is <= the number of [O] you control."
   * Validates a player-chosen `variable` against its declared bounds
   * (beyond plain affordability). Throws before any mutation.
   *
   * `rolls` is the paired `variables` map (if any) — an id that resolves via
   * a `random` roll there is already surfaced by `applyVariableRolls` as a
   * `variableRolled`, so it's skipped by the `variableChosen` logging below.
   */
  /**
   * A number the player chooses (X, Y...) is never negative: it is refused,
   * not floored. Only a number an EFFECT computes is floored at 0 (CR 410.4).
   */
  private assertChosenVariables(variables: Record<string, number> | undefined): void {
    for (const [id, value] of Object.entries(variables ?? {})) {
      assert(value >= 0, `The chosen number for '${id}' cannot be negative.`);
    }
  }

  /**
   * Ids of the variables the PLAYER chooses when playing/using this source:
   * those with `variableBounds`, plus any variable the costs or play-time
   * targets read that the card does not compute itself ("Choose a number for
   * X. Pay X."). A `variables` placeholder number counts as player-chosen;
   * a computed/random definition does not.
   */
  private playerChosenVariableIds(
    source:
      | {
          costs?: unknown;
          targets?: unknown;
          condition?: unknown;
          variables?: Record<string, NumberExpression>;
          variableBounds?: Record<string, unknown>;
        }
      | undefined
  ): string[] {
    if (!source) return [];
    const ids = new Set<string>(Object.keys(source.variableBounds ?? {}));
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        // `__amount` and the like are the engine's own (a `distribute` cost's share), never the player's to choose.
        if (o.type === "variable" && typeof o.id === "string" && !o.id.startsWith("__")) {
          const def = source.variables?.[o.id];
          if (def === undefined || typeof def === "number") ids.add(o.id);
        }
        Object.values(o).forEach(walk);
      }
    };
    walk(source.costs);
    walk(source.targets);
    walk(source.condition);
    // A variable a cost step computes itself ("X is its strength": `bindVariable`, or a `bind` effect inside
    // an `effects` step such as a coin flip) is not the player's to choose.
    const computed = new Set<string>();
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collect);
      } else if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        if ((o.type === "bindVariable" || o.type === "bind") && typeof o.id === "string") {
          computed.add(o.id);
        }
        Object.values(o).forEach(collect);
      }
    };
    collect(source.costs);
    return [...ids].filter(id => !computed.has(id) || Object.prototype.hasOwnProperty.call(source.variableBounds ?? {}, id));
  }

  /** A player-chosen variable must be supplied; 0 is a legal choice but "nothing chosen" is not (Q12). */
  private assertChosenVariablesPresent(
    ids: string[],
    supplied: Record<string, number> | undefined,
    name: string
  ): void {
    for (const id of ids) {
      assert(
        supplied !== undefined && Object.prototype.hasOwnProperty.call(supplied, id),
        `'${name}': choose a number for ${id.toUpperCase()}.`
      );
      const value = supplied![id];
      assert(
        Number.isInteger(value) && value >= 0,
        `'${name}': ${id.toUpperCase()} must be a non-negative whole number.`
      );
    }
  }

  private assertVariableBounds(
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined,
    context: ResolutionContext,
    rolls?: Record<string, NumberExpression>
  ): void {
    if (!bounds) return;

    for (const [id, bound] of Object.entries(bounds)) {
      const value = context.variables?.[id] ?? 0;
      // CR 410.2: a chosen X is a non-negative whole number.
      assert(
        Number.isInteger(value) && value >= 0,
        `Chosen value for '${id}' must be a non-negative whole number.`
      );
      if (bound.min !== undefined) {
        assert(
          value >= this.evaluateNumber(bound.min, context),
          `Chosen value for '${id}' is below its minimum.`
        );
      }
      if (bound.max !== undefined) {
        assert(
          value <= this.evaluateNumber(bound.max, context),
          `Chosen value for '${id}' is above its maximum.`
        );
      }
    }

    // Surface the player's pick the same way `applyVariableRolls` surfaces a
    // roll — logged straight (nothing triggers off it), only after every
    // bound above has held, so a rejected choice leaves no trace.
    for (const [id, bound] of Object.entries(bounds)) {
      const roll = rolls?.[id];
      if (roll !== undefined && typeof roll !== "number" && (roll.type === "random" || roll.type === "coinFlip")) {
        continue;
      }
      const value = context.variables?.[id] ?? 0;
      this.recordLogEvent({
        type: "variableChosen",
        sourceId: context.sourceId,
        playerId: context.controllerId,
        name: id,
        value,
        min: bound.min !== undefined ? this.evaluateNumber(bound.min, context) : 0,
        max: bound.max !== undefined ? this.evaluateNumber(bound.max, context) : value
      });
    }
  }

  private getTacticVariableBounds(
    definition: CardDefinition,
    mode?: number
  ): Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }
    return this.getTacticSource(definition, mode)?.variableBounds;
  }

  // ---------------------------------------------------------------------------
  // Activated abilities
  // ---------------------------------------------------------------------------

  /**
   * An ability's printed threshold, judged for the player the ability resolves as (CR 502.2). The one check behind
   * ctivateAbility and the ability listings (getActivatedAbilityStatuses).
   */
  private abilityThresholdMet(controllerId: PlayerId, ability: ActivatedAbility): boolean {
    return ability.threshold === undefined || ability.threshold === 0 || this.meetsThreshold(controllerId, ability.threshold);
  }

  private activateAbility(
    action: Extract<GameAction, { type: "activateAbility" }>
  ): void {
    const card = this.requireCard(action.cardId);

    const ability = this.getCardActivatedAbilities(card.id).find(
      a => a.id === action.abilityId
    );

    assert(ability, "Activated ability not found.");

    // The Billionaire — "You may use abilities on your opponent's cards ...
    // the ability's effect happens as if your opponent used it." The
    // opponent is the ability's controller. 2nd Edition ("ownNumeric") pays
    // the numeric cost from the activator's resources; 1st Edition / Open
    // Beta ("asOpponent": "as though you were your opponent") pays every
    // cost as the opponent.
    const borrowMode = this.borrowedAbilityMode(action.playerId, card, ability);
    const borrowed = borrowMode !== undefined;
    const abilityControllerId = borrowed ? card.controllerId : action.playerId;

    assert(
      borrowed ||
        ability.usableBy === "anyPlayer" ||
        (ability.usableBy === "heroes"
          ? isHero(this.state, action.playerId)
          : ability.usableBy === "opponent"
            ? card.controllerId !== action.playerId
            : card.controllerId === action.playerId),
      ability.usableBy === "heroes" ? "Only a Hero can use this ability." : "You do not control that card."
    );

    // Most abilities are usable only from `play`; RECUR / RETIRE-style ones
    // declare `activationZone: "discard"` (or hand/void) and are used from
    // there instead.
    const requiredZone = this.abilityActivationZone(ability);
    assert(
      card.zone === requiredZone,
      `Source must be in zone '${requiredZone}' to use this ability.`
    );
    // A face-down card is an anonymous resource (RULES.md §4) — its own
    // printed abilities are inert while face-down, same as triggered
    // abilities (findTriggers) and continuous ones (getContinuousModifiers
    // et al.) already treat it. (Only meaningful for a `play`-zone source.)
    if (requiredZone === "play" && !ability.fromFaceDown) {
      assert(!card.faceDown, "A face-down card's abilities cannot be activated.");
    }

    assert(
      !this.hasRestriction(card.id, "cannotUseAbilities"),
      "This card's abilities cannot be used."
    );

    this.assertCanUseAbilityAtCurrentTiming(action.playerId);

    if (this.costCommitted() === 0) {
      assert(this.abilityThresholdMet(abilityControllerId, ability), "Ability threshold requirements are not met.");
    }

    {
      // "It cannot be used again this turn." (Subsection 5, Paragraph 12) —
      // a `lockAbilityThisTurn` effect parks the sentinel here.
      const key = `${card.id}:${ability.id}`;
      assert(
        (this.state.abilityUsesThisTurn[key] ?? 0) < Number.MAX_SAFE_INTEGER,
        "This ability cannot be used again this turn."
      );
    }

    if (ability.usesPerTurn !== undefined) {
      const key = `${card.id}:${ability.id}`;
      assert(
        (this.state.abilityUsesThisTurn[key] ?? 0) < ability.usesPerTurn,
        `This ability can be used only ${ability.usesPerTurn} time(s) each turn.`
      );
    }

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: abilityControllerId,
      abilityId: ability.id,
      ...(borrowed ? { payerId: action.playerId } : {}),
      selected: action.selected ?? {},
      variables: action.variables ?? {},
      ...(action.named ? { named: action.named } : {})
    };

    // The opponent this ability's rules text is about (MP 2). A borrowed ability
    // (The Billionaire: "as if your opponent used it") is about the borrower.
    const namedOpponent =
      borrowed && isOpponentOf(this.state, abilityControllerId, action.playerId) ? action.playerId : action.opponentId;
    assert(
      !this.bindBlockOpponent(context, ability, ability.targets ?? [], namedOpponent),
      `Choose which opponent '${ability.name ?? ability.id}' is about (opponentId).`
    );

    this.assertChosenVariablesPresent(
      this.playerChosenVariableIds(ability),
      action.variables,
      this.getDefinition(card.id).name
    );
    this.applyVariableRolls(ability.variables, ability.variableBounds, context);
    this.assertVariableBounds(ability.variableBounds, context, ability.variables);

    if (ability.condition && this.costCommitted() === 0) {
      assert(
        this.evaluateCondition(ability.condition, context),
        "Ability condition is not satisfied."
      );
    }

    // Cards the cost "picks" without a player decision (the card this one is
    // attached to): recorded now, before the costs change anything.
    for (const capture of ability.captures ?? []) {
      const capturedId = this.resolveTargetRef(capture.target, context);
      if (capturedId && this.state.cards[capturedId]) {
        context.selected = { ...context.selected, [capture.id]: [capturedId] };
      }
    }

    // No activated (non-tactic) ability currently sizes a target's `count`
    // off an unguarded random roll (see `findRandomSizedTargetDeclarations`
    // — `deployCard` is the one place that needs the deferred-pick flow,
    // for Hammer Smash). If one ever does, this needs the same treatment.
    // Picks written after a cost step (`pick` steps) are validated as that step is paid.
    this.validateTargetDeclarations(
      this.costCommitted() > 0 ? [] : this.upFrontDeclarations(ability.targets ?? [], ability.costs ?? []),
      context,
      ability.costs
    );

    // "Reduce the numeric cost of your faction's abilities by 1, to a
    // minimum of 1." (First Unified Market of Abstract Secure Theoreticals) —
    // fold any `abilityCostModifiers` into the `payResources` costs.
    // "Reduce the next numeric cost you pay" reaches an ability's "pay N" too (CR 406.5) and is used up by it.
    const abilityPayerId = borrowMode === "ownNumeric" ? action.playerId : abilityControllerId;
    const pendingReductions = this.pendingCostReductions(
      abilityPayerId,
      this.getDefinition(card.id).type,
      true
    );
    let effectiveCosts = this.withPickDeclarations(
      this.orderCosts(
        this.applyAbilityCostModifiers(
          card.id,
          [...(ability.costs ?? []), ...this.pickTaxCosts(action.playerId, ability.targets ?? [], context)],
          abilityControllerId,
          context,
          this.reductionAdjusts(pendingReductions),
          action.playerId
        )
      ),
      ability.targets ?? []
    );

    const hasNumericCost = effectiveCosts.some(c => c.type === "payResources");

    // A borrowed ability in "ownNumeric" mode (The Billionaire, 2nd Edition):
    // the numeric cost is paid from the ACTIVATOR's resources, after the
    // other costs; the rest is satisfied as the opponent.
    let borrowedNumeric = 0;
    if (borrowMode === "ownNumeric") {
      const split = this.splitBorrowedNumericCost(effectiveCosts, context);
      assert(
        this.getAvailableResourceIds(action.playerId).length >= split.numeric,
        "Ability costs cannot be paid."
      );
      borrowedNumeric = split.numeric;
      effectiveCosts = split.rest;
    }

    this.assertChosenVariables(context.variables);
    if (this.costCommitted() === 0) this.assertInfluenceAffordable(effectiveCosts, context);
    this.assertCostsPayable(effectiveCosts, context, "Ability costs cannot be paid.");
    {
      // Payable at all: now ask the payer about the choices inside the cost.
      const bound = this.bindCostChoices(effectiveCosts, context, action);
      if (!bound) return;
      effectiveCosts = bound;
    }

    if (hasNumericCost) this.consumeCostReductions(pendingReductions);
    // Stops to ask another player about a cost step (E3c): the steps before it are paid, the action re-runs.
    if (this.payCosts(effectiveCosts, context, action)) {
      if (hasNumericCost) this.state.costReductions.push(...pendingReductions);
      return;
    }
    if (borrowedNumeric > 0) this.payNumericCost(action.playerId, borrowedNumeric);

    // Paying the cost may leave a card lethal (e.g. its last tokens
    // removed): it is destroyed now; the ability still resolves (CR 502.4).
    this.checkStateBasedActions();

    // "Reveal this card" — using an ability from a face-down resource (FLIP
    // IT, REUSE, ...) shows that resource as part of paying for it.
    if (ability.fromFaceDown && card.faceDown) {
      this.emitReveal(
        [card.id],
        "all",
        card.id,
        undefined,
        this.pickedByRevealer(action.playerId)
      );
    }

    if (ability.usesPerTurn !== undefined) {
      const key = `${card.id}:${ability.id}`;
      this.state.abilityUsesThisTurn[key] =
        (this.state.abilityUsesThisTurn[key] ?? 0) + 1;
    }

    // The ability's picks are made as it is used: "if this card is picked"
    // triggers (Ferrous Ferret) fire before the ability resolves.
    this.emitCardPicked(
      context.selected,
      abilityControllerId,
      (ability.targets ?? []).map(d => d.id)
    );

    // Cost-triggered abilities happen immediately before the ability itself
    // enters the response chain.
    this.processImmediateQueue();

    this.responseStack.push({
      id: this.nextId("stack"),
      sourceId: card.id,
      controllerId: abilityControllerId,
      kind: "ability",
      abilityId: ability.id,
      effects: ability.effects,
      context,
      ...(abilityControllerId === card.controllerId ? { followsSourceController: true } : {})
    });

    this.emit({
      type: "abilityActivated",
      cardId: card.id,
      abilityId: ability.id,
      playerId: action.playerId
    });

    this.afterStackAction(action.playerId);
  }

  /**
   * A FLIP UP threshold is checked once the card is flipped (CR 507.4b, R3):
   * the card is no longer a face-down resource then, so its own Volition
   * icon doesn't count toward it.
   */
  private meetsThresholdAfterFlip(
    cardId: CardInstanceId,
    playerId: PlayerId,
    threshold: string | number
  ): boolean {
    this.thresholdExcludedCard = cardId;
    try {
      return this.meetsThreshold(playerId, threshold);
    } finally {
      this.thresholdExcludedCard = undefined;
    }
  }

  /** Runs `fn` with `card` face-up (its real characteristics), then puts it back face-down. */
  private withCardFaceUp<T>(card: CardInstance, fn: () => T): T {
    const was = card.faceDown;
    card.faceDown = false;
    this.hypotheticalDepth++;
    try {
      return fn();
    } finally {
      this.hypotheticalDepth--;
      card.faceDown = was;
    }
  }

  /** A standing ban on playing cards using FLIP UP, as the refusal message. */
  private flipUpBanProblem(playerId: PlayerId): string | undefined {
    return this.state.playRestrictions.some(r => r.playerId === playerId && r.kind === "flipUp") ||
      this.continuousPlayRestricted(playerId, { kind: "flipUp" })
      ? "You cannot play cards using FLIP UP right now."
      : undefined;
  }

  /**
   * Which of a card's FLIP UP options a `flipUp` uses (Q35): the one named
   * (`requested`; throws when it does not exist), else the first whose
   * threshold is met and whose cost the player can cover, else the first.
   */
  private chooseFlipUpOption(
    cardId: CardInstanceId,
    playerId: PlayerId,
    flipUpOptions: Array<{ cost: number; threshold: string | number; effects?: Effect[] }>,
    requested: number | undefined
  ): { option: { cost: number; threshold: string | number; effects?: Effect[] }; index: number } {
    const resourcePool = this.getAvailableResourceIds(playerId).length;
    if (requested !== undefined) {
      assert(
        Number.isInteger(requested) && requested >= 0 && requested < flipUpOptions.length,
        `Unknown FLIP UP option ${String(requested)}: that card has ${flipUpOptions.length}.`
      );
      return { option: flipUpOptions[requested], index: requested };
    }
    const found = flipUpOptions.findIndex(
      option =>
        this.meetsThresholdAfterFlip(cardId, playerId, option.threshold) &&
        resourcePool >= option.cost
    );
    const index = found >= 0 ? found : 0;
    return { option: flipUpOptions[index], index };
  }

  /** A FLIP UP line's own mandatory pick out of the hand ("...and play a resource" / "...and discard a card") that is not part of a cost pick. */
  private isFlipUpHandRider(
    effect: Effect
  ): effect is Extract<Effect, { type: "chooserSelectsTarget" }> {
    return (
      effect.type === "chooserSelectsTarget" &&
      !effect.asCost &&
      !effect.declaration.optional &&
      this.selectorNamesZone(effect.declaration.selector, "hand")
    );
  }

  /** The cards a FLIP UP hand rider could take (none: the flip cannot be paid, CR 507.4c). */
  private flipUpRiderCandidates(
    effect: Extract<Effect, { type: "chooserSelectsTarget" }>,
    context: ResolutionContext
  ): CardInstance[] {
    const chooser = this.resolvePlayerRef(effect.chooser, context);
    return this.targetCandidates(effect.declaration.selector, context, chooser.id);
  }

  /**
   * The numeric part of a FLIP UP's cost: the option's cost plus the faction's
   * per-flip surcharge ("You must pay 2 to deploy tactics using FLIP UP", The
   * Primitive Tribes of Thabbash), run through the deploy cost modifiers
   * (Foreclosure Overseer's "+1", Canny Bailiff's "at least 3") against the
   * card's real (face-up) type. Pending "reduce the next cost" effects and
   * the card's extra "pay N" steps are folded in by the caller.
   */
  private flipUpNumericPay(
    card: CardInstance,
    playerId: PlayerId,
    flipUp: { cost: number },
    context: ResolutionContext
  ): number {
    // `definition.type` (the card's real printed type), not `hasCardType` —
    // the card is still face-down here, and `getCardTypes` reports a
    // face-down in-play card as a bare resource (CR §411.1).
    const definition = this.getDefinition(card.id);
    const flipUpTax = this.getFactionDefinition(playerId)?.flipUpTax;
    const flipUpTaxAmount =
      flipUpTax && (!flipUpTax.cardType || definition.type === flipUpTax.cardType)
        ? this.evaluateNumber(flipUpTax.amount, context)
        : 0;
    return this.withCardFaceUp(card, () =>
      this.applyCostModifiers(playerId, card.id, flipUp.cost + flipUpTaxAmount)
    );
  }

  /**
   * Whether `playerId` could flip up the face-down card `cardId` right now,
   * read-only: the gates `perform({type: "flipUp"})` applies, in its order
   * (control, FLIP UP ban, deploy timing and restrictions with the card
   * face-up, the threshold with the card's own icons left out, the rider's
   * hand card, the numeric cost). The threshold and cost are counted exactly as
   * `flipUp` counts them: the flipped card's own icons do not count toward the
   * threshold (CR 507.4b, R3) but, as an unattached resource, it may help pay.
   * Like `getCardPlayability` it does not cover the card's targets or extra
   * costs; `perform` is the last word on those.
   *
   * `optionIndex` names one of `getFlipUpOptions(cardId)`; omitted, the first
   * affordable one (as `flipUp` picks).
   */
  getFlipUpPlayability(
    playerId: PlayerId,
    cardId: CardInstanceId,
    optionIndex?: number
  ): FlipUpPlayability {
    const availableResources = this.getAvailableResourceCount(playerId);
    const refused = (
      blockedBy: FlipUpBlockedBy,
      reason: string,
      parts: Partial<FlipUpPlayability> = {}
    ): FlipUpPlayability => ({
      playable: false,
      legalTiming: false,
      thresholdMet: false,
      numericCost: 0,
      availableResources,
      ...parts,
      blockedBy,
      reason
    });

    const card = this.state.cards[cardId];
    if (!card) return refused("notFaceDown", "Only a face-down resource you control can be flipped up.");
    if (card.controllerId !== playerId) return refused("notFaceDown", "You do not control that card.");
    if (card.zone !== "play" || !card.faceDown) {
      return refused("notFaceDown", "Only a face-down resource you control can be flipped up.");
    }
    const gate = this.actionGateProblem("flipUp");
    if (gate) return refused("timing", gate);

    const definition = this.getDefinition(cardId);
    const flipUpOptions = this.getFlipUpOptions(cardId);
    if (flipUpOptions.length === 0) return refused("noFlipUp", "That card has no FLIP UP cost.");
    let chosen: { option: (typeof flipUpOptions)[number]; index: number };
    try {
      chosen = this.chooseFlipUpOption(cardId, playerId, flipUpOptions, optionIndex);
    } catch (error) {
      return refused("noFlipUp", error instanceof Error ? error.message : String(error));
    }
    const { option: flipUp, index } = chosen;

    const ban = this.flipUpBanProblem(playerId);
    const { restrictionProblem, timingProblem } = this.withCardFaceUp(card, () => ({
      restrictionProblem: this.deployRestrictionProblem(playerId, definition),
      timingProblem: this.deployTimingProblem(playerId, definition, cardId)
    }));
    const conditionHolds = this.playConditionHolds(playerId, cardId, definition, {
      deployedViaFlipUp: true
    });
    const legalTiming =
      ban === undefined &&
      restrictionProblem === undefined &&
      timingProblem === undefined &&
      conditionHolds;

    const thresholdMet = this.meetsThresholdAfterFlip(cardId, playerId, flipUp.threshold);

    const context: ResolutionContext = {
      sourceId: cardId,
      controllerId: playerId,
      selected: {},
      variables: {},
      deployedViaFlipUp: true
    };
    // The card being flipped up cannot be picked or used by its own costs (CR 604.1).
    const previousBeingDeployed = this.beingDeployedId;
    this.beingDeployedId = cardId;
    let riderProblem: string | undefined;
    let numericCost: number;
    try {
      for (const effect of flipUp.effects ?? []) {
        if (this.isFlipUpHandRider(effect) && this.flipUpRiderCandidates(effect, context).length === 0) {
          riderProblem =
            "FLIP UP costs cannot be paid: there is no card in your hand to play as a resource or discard for its cost.";
          break;
        }
      }
      const flipUpPay = this.flipUpNumericPay(card, playerId, flipUp, context);
      const reductions = this.reductionAdjusts(this.pendingCostReductions(playerId, definition.type, false));
      numericCost =
        this.previewNumericCost(
          this.foldNumericCost(
            [
              ...this.getTacticCosts(definition),
              { type: "payResources", amount: flipUpPay }
            ],
            reductions
          ),
          context
        ) ?? this.applyNumericAdjusts(flipUpPay, reductions);
    } finally {
      this.beingDeployedId = previousBeingDeployed;
    }
    const costMet = availableResources >= numericCost;

    const parts: Partial<FlipUpPlayability> = {
      legalTiming,
      thresholdMet,
      numericCost,
      optionIndex: index
    };
    if (ban) return refused("restriction", ban, parts);
    if (restrictionProblem) return refused("restriction", restrictionProblem, parts);
    if (timingProblem) return refused("timing", timingProblem, parts);
    if (!thresholdMet) return refused("threshold", "FLIP UP threshold requirements are not met.", parts);
    if (riderProblem) return refused("riderCard", riderProblem, parts);
    if (!conditionHolds) return refused("timing", "This card cannot be flipped up right now.", parts);
    if (!costMet) return refused("cost", "FLIP UP costs cannot be paid.", parts);
    return {
      playable: true,
      legalTiming: true,
      thresholdMet: true,
      numericCost,
      availableResources,
      optionIndex: index
    };
  }

  /**
   * Flip up a face-down resource by paying its `flipUp` cost and resolve it
   * as its real card type, with `deployedViaFlipUp` set on the context. The
   * flipped card is deployed like a hand play (CR 507.4a): it goes onto the
   * response stack and the opponent may respond (SYS-42 / R1). Its effects
   * (rider + the card's own) run through `runEffectFrame` when it resolves,
   * so one that pauses on a chooser suspends cleanly and the post-effects
   * bookkeeping (discard a flipped tactic / send a flipped permanent into
   * play) waits for it.
   */
  private flipUpCard(
    action: Extract<GameAction, { type: "flipUp" }>
  ): void {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);

    assert(
      card.controllerId === action.playerId,
      "You do not control that card."
    );
    assert(
      card.zone === "play" && card.faceDown,
      "Only a face-down resource you control can be flipped up."
    );
    // Q12: a modal card ("choose one") is flipped up with a mode, like a hand play.
    assert(
      !((definition.behavior?.modes?.length ?? 0) > 1) || action.mode !== undefined,
      `'${definition.name}' is modal: choose a mode to flip it up.`
    );
    const flipUpOptions = this.getFlipUpOptions(card.id);
    assert(flipUpOptions.length > 0, "That card has no FLIP UP cost.");
    // Printed and granted FLIP UP are both usable (Q35): the player may name
    // the option (`flipUpOption`); otherwise take the first one whose
    // threshold is met and whose cost the player can cover.
    const flipUp = this.chooseFlipUpOption(card.id, action.playerId, flipUpOptions, action.flipUpOption).option;
    const flipUpBan = this.flipUpBanProblem(action.playerId);
    if (flipUpBan) throw new Error(flipUpBan);
    // A spent (attached) face-down card can still be flipped up (SYS-36 / R5).

    // Flipping up is deploying the card (CR 507.4a, Q30): the same timing,
    // card-type restrictions and "cannot be deployed" locks as a hand play
    // apply, and a non-tactic needs a deploy-legal moment (CR 507.4d, SYS-34).
    // Checked with the card's real characteristics (face-up).
    this.withCardFaceUp(card, () =>
      this.assertCanDeployAtCurrentTiming(action.playerId, definition, card.id)
    );
    assert(
      this.meetsThresholdAfterFlip(card.id, action.playerId, flipUp.threshold),
      "FLIP UP threshold requirements are not met."
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      selected: action.selected ?? {},
      variables: action.variables ?? {},
      ...(action.named ? { named: action.named } : {}),
      deployedViaFlipUp: true
    };
    // The opponent the flipped card's rules text is about (MP 2).
    {
      const declarations = this.getPlayTargetDeclarations(definition, action.mode);
      assert(
        !this.bindBlockOpponent(
          context,
          {
            flipUp,
            targets: declarations,
            costs: this.getTacticCosts(definition, action.mode),
            effects: definition.type === "tactic" ? this.getTacticEffects(definition, action.mode) : []
          },
          declarations,
          action.opponentId
        ),
        `Choose which opponent '${definition.name}' is about (opponentId).`
      );
    }
    // The card being flipped up cannot be picked or used by its own costs (CR 604.1; it is Being Deployed).
    this.beingDeployedId = card.id;

    // "...and play a resource" / "...and discard a card" in a FLIP UP line is
    // part of the cost (CR 507.4c, Q14): a mandatory pick out of the hand
    // that cannot be made (empty hand) means the flip cannot be paid.
    let flipUpEffects: Effect[] = flipUp.effects ?? [];
    let riderPick: { declaration: TargetDeclaration; chooserId: PlayerId } | undefined;
    const riderCostEffects: Effect[] = [];
    for (const effect of flipUpEffects) {
      if (effect.type === "chooserSelectsTarget" && effect.asCost) {
        // A pick that is part of the FLIP UP cost: made before the card flips
        // (CR 507.4c). Its follow-up effects stay with the card's resolution.
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const costCandidates = this.targetCandidates(
          effect.declaration.selector,
          context,
          chooser.id
        );
        const picked = context.selected[effect.declaration.id];
        if (picked === undefined) {
          if (costCandidates.length === 0) {
            context.selected[effect.declaration.id] = [];
          } else {
            riderPick = { declaration: effect.declaration, chooserId: chooser.id };
          }
          continue;
        }
        const legalIds = new Set(costCandidates.map(c => c.id));
        assert(
          picked.length <=
            Math.max(0, this.evaluateNumber(effect.declaration.count, context)) &&
            new Set(picked).size === picked.length &&
            picked.every(id => legalIds.has(id)),
          `Illegal pick '${effect.declaration.id}' for this card's FLIP UP cost.`
        );
        flipUpEffects = flipUpEffects.flatMap(e => (e === effect ? effect.effects : [e]));
        continue;
      }
      if (this.isFlipUpHandRider(effect)) {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const riderCandidates = this.flipUpRiderCandidates(effect, context);
        assert(
          riderCandidates.length > 0,
          "FLIP UP costs cannot be paid: there is no card in your hand to play as a resource or discard for its cost."
        );
        const declared = context.selected[effect.declaration.id];
        if (declared === undefined) {
          // The rider's pick is part of the cost: it is asked for BEFORE
          // anything changes (a refused answer leaves the card face-down),
          // once the rest of the flip is known to be legal and payable (below).
          riderPick = { declaration: effect.declaration, chooserId: chooser.id };
          continue;
        }
        // Already picked: the rider's own follow-up effects ("play it as a
        // resource", "discard it") are part of paying the cost — they happen
        // right after the payment, before the opponent can respond.
        flipUpEffects = flipUpEffects.filter(e => e !== effect);
        riderCostEffects.push(...effect.effects);
      }
    }

    this.applyVariableRolls(
      this.getTacticVariableRolls(definition, action.mode),
      this.getTacticVariableBounds(definition, action.mode),
      context
    );
    this.assertVariableBounds(
      this.getTacticVariableBounds(definition, action.mode),
      context,
      this.getTacticVariableRolls(definition, action.mode)
    );

    const condition = this.getTacticCondition(definition, action.mode);
    assert(
      !condition || this.evaluateCondition(condition, context),
      "This card cannot be flipped up right now."
    );

    // No FLIP UP tactic currently sizes a target's `count` off an unguarded
    // random roll — see the same note in `activateAbility`.
    // Picks written after a cost step (`pick` steps) are validated as that step is paid.
    const flipDeclarations = this.getPlayTargetDeclarations(definition, action.mode);
    const regularCosts = this.getTacticCosts(definition, action.mode);
    this.validateTargetDeclarations(
      this.upFrontDeclarations(flipDeclarations, regularCosts),
      context,
      regularCosts
    );

    // "You must pay 2 to deploy tactics using FLIP UP." (The Primitive
    // Tribes of Thabbash) — a per-faction surcharge on top of the card's own
    // printed FLIP UP cost.
    // `definition.type` (the card's real printed type), not `hasCardType` —
    // the card is still face-down at this point, and `getCardTypes` reports
    // a face-down in-play card as a bare resource (CR §411.1) regardless of
    // what it's about to be flipped up into.
    // Flipping up is deploying (Q30): continuous cost modifiers on deploys
    // (Foreclosure Overseer's "+1", Canny Bailiff's "at least 3") apply to the
    // running total, computed against the card's real (face-up) type.
    const flipUpPay = this.flipUpNumericPay(card, action.playerId, flipUp, context);

    // CR 507.4c: the FLIP UP line's own steps ("and play a resource") come directly before the card's regular
    // extra costs, and the numeric cost is paid last (CR 406.3a). A rider prompt the step raises (the
    // face-up / face-down question of a played resource) stays open, as it always did.
    // FLIP UP is a deploy, so "reduce the next numeric cost you pay" reaches (and is used up by) its numeric cost.
    const flipPendingReductions = this.pendingCostReductions(action.playerId, definition.type, false);
    let costs: Cost[] = this.withPickDeclarations(
      this.orderCosts(this.foldNumericCost([
        ...(riderCostEffects.length > 0
          ? [
              {
                type: "effects" as const,
                effects: riderCostEffects,
                allowPending: true,
                // A resource the line plays goes in face-up unless the pick said otherwise (no question mid-cost).
                resourceFaceDown: context.variables?.[RESOURCE_FACE_DOWN_VARIABLE] === 1
              }
            ]
          : []),
        ...regularCosts,
        ...this.pickTaxCosts(action.playerId, flipDeclarations, context),
        { type: "payResources", amount: flipUpPay }
      ], this.reductionAdjusts(flipPendingReductions))),
      flipDeclarations
    );

    if (costs.some(c => c.type === "otherPlayerChooses" || c.type === "distribute" || c.type === "alternatingPay")) {
      this.beingDeployedId = undefined;
      throw new Error("A FLIP UP whose cost another player decides (or the payer divides) is not supported.");
    }

    if (riderPick) {
      // Everything refusable has been checked except paying: confirm it can be
      // paid, then ask for the rider's pick (a cost, CR 507.4c) before the
      // card flips. Answering re-runs this action with the pick merged in.
      // A `pick` cost step is judged on the board after the FLIP UP line's own steps (which this pick feeds),
      // so only the shape of those picks (how many, no repeats) is checked now; the cards wait for the re-run.
      for (const declaration of flipDeclarations) {
        if (!this.pickStepIds(costs).has(declaration.id) || this.nodeReferencesVariable(declaration.count)) continue;
        const picked = context.selected[declaration.id] ?? [];
        const max = Math.max(0, this.evaluateNumber(declaration.count, context));
        assert(
          picked.length <= max && (declaration.optional || picked.length >= max) && new Set(picked).size === picked.length,
          `Target '${declaration.id}' requires ${max} selection(s).`
        );
      }
      const withoutPicks = costs.filter(c => c.type !== "pick");
      card.faceDown = false;
      let payable = this.canPayCosts(withoutPicks, context);
      card.faceDown = true;
      if (!payable) {
        this.assertChosenVariables(context.variables);
        this.assertInfluenceAffordable(withoutPicks, context);
        payable = this.canPayCosts(withoutPicks, context);
      }
      assert(payable, "FLIP UP costs cannot be paid.");
      this.state.pendingChoice = {
        kind: "chooserSelectsTarget",
        id: this.nextId("choice"),
        playerId: riderPick.chooserId,
        declaration: riderPick.declaration,
        effects: [],
        context,
        resumeAction: action
      };
      this.beingDeployedId = undefined;
      return;
    }

    // (CR §507.4b) You pay the Flip Up cost before flipping, so the card
    // *may* count toward its own cost — but only reach for it as a last
    // resort. Check affordability with the card already excluded (real
    // type, not a resource) first; only fall back to paying while it's
    // still face-down (and therefore eligible via `isResource`) if other
    // resources alone can't cover it. This keeps a normal flip (where
    // other resources suffice) from wastefully spending the very card
    // that's about to leave the resource pool anyway.
    // A player who names the card among the payers (`payWith`) has chosen to spend it: it pays face-down.
    const spendsItself = this.payWith?.ids.includes(card.id) ?? false;
    card.faceDown = false;
    if (spendsItself || this.costProblem(costs, context)) {
      card.faceDown = true;
      this.assertChosenVariables(context.variables);
      this.assertInfluenceAffordable(costs, context);
      this.assertCostsPayable(costs, context, "FLIP UP costs cannot be paid.");
    }
    {
      // "...and play a resource" with an actual resource card (CR 203.2): the payer says face-up or face-down
      // now, before anything is paid (unless the pick already said).
      const playedCardId = this.riderPlayedResource(riderCostEffects, context);
      if (playedCardId !== undefined && context.variables?.[RESOURCE_FACE_DOWN_VARIABLE] === undefined) {
        this.state.pendingChoice = {
          kind: "playResource",
          id: this.nextId("choice"),
          playerId: action.playerId,
          cardId: playedCardId,
          canFaceUp: this.forcedFaceDownReason(this.getDefinition(playedCardId)) === undefined,
          emitPlayed: true,
          resumeAction: action
        };
        card.faceDown = true;
        this.beingDeployedId = undefined;
        return;
      }
    }
    {
      // Payable at all: now ask the payer about the choices inside the cost.
      const bound = this.bindCostChoices(costs, context, action);
      if (!bound) {
        card.faceDown = true;
        this.beingDeployedId = undefined;
        return;
      }
      costs = bound;
    }
    // "...and play a resource" / "...and discard a card" (the rider steps) come first, then the card's own
    // extra costs in written order, the numeric cost last.
    this.consumeCostReductions(flipPendingReductions);
    this.lastNumericCostPaid = 0;
    this.payCosts(costs, context);
    const flipNumericCostPaid = this.lastNumericCostPaid;
    const playCost = flipNumericCostPaid;
    this.beingDeployedId = undefined;
    card.faceDown = false;

    // The face-down resource leaves play and the face-up card is deployed
    // as a brand-new object (CR §411.3, §507.4a): it goes onto the response
    // stack like any hand play, so the opponent may respond (SYS-42 / R1).
    // Its rider effects ("...and your faction loses 5 influence") run first,
    // then the tactic's own effects; a permanent's inline ETB runs when it
    // enters play (`finishStackItem`).
    card.attachedTo = undefined;
    card.faceDown = false;
    this.faceDownDeparture.add(card.id);

    const effects: Effect[] = [
      ...flipUpEffects,
      ...(definition.type === "tactic" ? this.getTacticEffects(definition, action.mode) : [])
    ];

    if (definition.type !== "tactic") {
      card.deployedAsResponse = this.state.responseWindow !== undefined;
    }
    this.state.thresholdReductions = this.state.thresholdReductions.filter(
      r => r.playerId !== action.playerId
    );
    this.enterOrigin.set(card.id, card.zone);
    this.moveCard(card.id, "deploying");
    card.numericCostPaid = flipNumericCostPaid;
    (this.state.turnDeploys[action.playerId] ??= []).push({
      name: definition.name,
      type: definition.type
    });
    if (definition.type === "tactic") {
      (this.state.tacticsPlayedThisTurn ??= []).push(card.id);
      (this.state.tacticPlayVariables ??= {})[card.id] = { ...(context.variables ?? {}) };
    }

    this.beginEventBatch();
    try {
      this.emit({
        type: "cardPlayed",
        cardId: card.id,
        playerId: action.playerId,
        ...(context.deployedViaFlipUp ? { viaFlipUp: true } : {})
      });

      this.responseStack.push({
        id: this.nextId("stack"),
        sourceId: card.id,
        controllerId: action.playerId,
        kind: "card",
        effects,
        context,
        playCost
      });

      this.emitCardPicked(
        context.selected,
        action.playerId,
        this.getPlayTargetDeclarations(definition).map(d => d.id)
      );
    } finally {
      this.endEventBatch();
    }

    if (definition.behavior?.noResponse) {
      this.resolveTopOfStack();
      this.checkStateBasedActions();
      return;
    }
    this.afterStackAction(action.playerId);
  }

  /**
   * The entitled player declines to respond. The Spoils has no
   * priority-passing system (CR §607.2b): the player being responded to
   * never gets a pass of their own, so one decline is enough.
   *
   * - If an item is on the response stack, it now resolves (LIFO). The
   *   window flips to "resolving"; advanceFlow() pops it and then re-opens
   *   the window for whoever may still respond (CR §607.2).
   * - Otherwise this responder simply opened no chain. In a two-sided
   *   battle response window (CR §608.1c / §609.1a) hand off to the other
   *   side; once everyone has passed, the window closes.
   */
  private passPriority(playerId: PlayerId): void {
    const window = this.requireResponseWindow();

    assert(
      window.phase === "acceptingResponses",
      "Responses are currently resolving."
    );
    assert(
      window.priorityPlayerId === playerId,
      "It is not your priority."
    );

    // Log every decline so a game can be read end-to-end — a passed window
    // is often *why* nothing happened (the app auto-passes windows the
    // player can't act in), and that needs to be visible in the log. Name
    // what was on offer so three battle windows in a row don't read alike.
    this.recordLogMarker(
      "priorityPassed",
      "info",
      `${this.logPlayerName(playerId)} passes${this.passContextSuffix(window)}`,
      this.responseStack.length
    );

    if (this.responseStack.length > 0) {
      // Every other player gets a turn at the item on top before it resolves
      // (D6); this one has declined.
      const remaining = (window.stackResponders ?? [playerId]).filter(id => id !== playerId && isLiving(this.state, id));
      window.stackResponders = remaining;
      if (remaining.length > 0) {
        window.priorityPlayerId = remaining[0];
        this.state.priorityPlayerId = window.priorityPlayerId;
        return;
      }
      window.phase = "resolving";
      return;
    }

    // Empty stack: this responder is finished making top-level responses.
    // (`priorityPlayerId === playerId` is asserted above, and an empty-stack
    // window always tracks `pendingResponders[0]`, so this drops exactly
    // this player.)
    window.pendingResponders.shift();

    if (window.pendingResponders.length > 0) {
      window.priorityPlayerId = window.pendingResponders[0];
      this.state.priorityPlayerId = window.priorityPlayerId;
      return;
    }

    window.phase = "resolving";
  }

  /**
   * Advances exactly one automatic step:
   *
   * 1. Resolve the top response-stack item, then re-open the window for
   *    whoever may still respond (CR §607.2 / §607.2a), OR
   * 2. Hand a two-sided battle window to its next responder / close it and
   *    resume the interrupted turn/battle flow once nobody has anything
   *    left to add, OR
   * 3. Clear a finished battle after the UI has had a chance to render it.
   */
  /** Drops a finished battle from the state and resumes an interrupted end of turn (see `advanceFlow`). */
  private clearFinishedBattle(): void {
    const battle = this.state.battle;
    if (!battle || battle.phase !== "finished") return;
    const resume = battle.resumeEndTurn;
    this.state.battle = undefined;
    this.state.priorityPlayerId = this.state.activePlayerId;
    if (resume) {
      // The end of turn announced before the battle is still pending: the
      // opponent answers it again (and the turn ends once they are done).
      const responders =
        resume.pendingResponders.length > 0 ? resume.pendingResponders : this.respondersTo(resume.playerId);
      this.openResponseWindow(
        "endTurn",
        responders[0] ?? resume.playerId,
        { type: "endTurn", playerId: resume.playerId },
        responders
      );
    }
  }

  private advanceFlow(): void {
    const window = this.state.responseWindow;

    if (window) {
      assert(
        window.phase === "resolving",
        "Players must finish responding before the flow can advance."
      );

      if (this.responseStack.length > 0) {
        const settled = this.resolveTopOfStack();
        // A chooser mid-resolution parks the item; its pendingChoice's
        // resolution path resumes the frame and then re-enters this flow.
        if (settled && !this.state.pendingChoice) {
          this.reopenOrCloseResponseWindow();
        }
        return;
      }

      this.reopenOrCloseResponseWindow();
      return;
    }

    if (this.state.battle?.phase === "finished") {
      this.clearFinishedBattle();
      return;
    }

    throw new Error("There is no automatic game-flow step to advance.");
  }

  /**
   * Run after a response-stack item finishes resolving (inline via
   * advanceFlow, or after a chooser pause once its effect frames drain).
   * Re-opens the response window for whoever may respond next — the opponent
   * of the new top item's controller (CR §607.1 — never the controller
   * themselves), or the next queued top-level responder — or closes it and
   * resumes the interrupted flow once the stack and the responder queue are
   * both empty.
   */
  private reopenOrCloseResponseWindow(): void {
    const window = this.state.responseWindow;
    if (!window || window.phase !== "resolving") return;
    // Still mid-resolution somewhere up the call chain — don't act yet.
    if (this.state.pendingChoice) return;
    if (this.state.pendingEffectFrames.length > 0) return;

    if (this.responseStack.length > 0) {
      const top = this.responseStack[this.responseStack.length - 1];
      window.phase = "acceptingResponses";
      this.offerTopOfStack(window, top.controllerId);
      return;
    }

    if (window.pendingResponders.length > 0) {
      window.phase = "acceptingResponses";
      window.priorityPlayerId = window.pendingResponders[0];
      this.state.priorityPlayerId = window.priorityPlayerId;
      return;
    }

    const continuation = structuredClone(window.continuation);
    this.state.responseWindow = undefined;
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.resumeContinuation(continuation);
  }

  /** Returns true if the popped item's effects (and any bookkeeping after them) ran to completion without pausing on a chooser effect. */
  private resolveTopOfStack(): boolean {
    const item = this.responseStack.pop();

    assert(item, "Response stack is empty.");

    if (this.logEnabled) {
      this.recordLogMarker(
        "stackItemResolving",
        "resolution",
        `${this.logStackItemLabel(item)} resolves`,
        this.responseStack.length
      );
    }

    // CR 407.1a: an ability used by its card's controller, whose card has
    // since come under another player's control, is controlled by that player.
    if (item.followsSourceController) {
      const source = this.state.cards[item.sourceId];
      if (source && source.zone === "play" && source.controllerId !== item.controllerId) {
        item.controllerId = source.controllerId;
        item.context.controllerId = source.controllerId;
      }
    }

    // "If a player would search their deck you may pay 1 instead..." (Golden
    // Charm): a search whose card was named up front (`targets` on the deck
    // zone: INVEST, SERAPHIM FUSION) is announced before it is carried out, so
    // the draw comes first. If that raises a prompt, the resolution resumes
    // once it is answered (the picks' zones are recorded then).
    this.announceDeckSearches(item.context);
    if (this.state.pendingChoice) {
      this.state.pendingEffectFrames.push({
        effects: item.effects,
        index: 0,
        context: item.context,
        finishStackItem: item,
        recordPickZones: true
      });
      return false;
    }

    return this.runEffectFrame({
      effects: item.effects,
      index: 0,
      context: item.context,
      finishStackItem: item,
      recordPickZones: true
    });
  }

  /**
   * Emits `deckSearched` for each deck search the resolving ability (or
   * tactic) declared as a pre-chosen target, and runs the triggers it
   * queues. An optional search the player declined is no search.
   */
  private announceDeckSearches(context: ResolutionContext): void {
    const behavior = this.state.cards[context.sourceId]
      ? this.getDefinition(context.sourceId).behavior
      : undefined;
    if (!behavior) return;
    const ability = context.abilityId
      ? (behavior.abilities ?? []).find(a => a.id === context.abilityId)
      : undefined;
    const declarations: TargetDeclaration[] =
      (ability as { targets?: TargetDeclaration[] } | undefined)?.targets ??
      (context.abilityId === undefined
        ? this.getPlayTargetDeclarations(this.getDefinition(context.sourceId))
        : []);
    for (const declaration of declarations) {
      const selector = declaration.selector;
      if (!this.selectorNamesZone(selector, "deck")) continue;
      if (selector.fromTop !== undefined) continue;
      if (context.selected[declinedKey(declaration.id)] !== undefined) continue;
      const who = selector.owner ?? selector.controller;
      if (who === "any") continue;
      const searchedIds = who === "opponent" ? this.opponentIdsFor(context) : [context.controllerId];
      for (const searchedId of searchedIds) {
        this.announceDeckSearch(searchedId);
        if (this.state.pendingChoice) return;
      }
    }
  }

  /**
   * Emits `deckSearched` and resolves just the triggers it queued (Golden
   * Charm), leaving triggers that were already waiting (a second copy of the
   * card whose search this is) queued behind it.
   */
  private announceDeckSearch(searcherId: PlayerId): void {
    const waiting = this.immediateQueue.splice(0);
    try {
      this.emit({ type: "deckSearched", playerId: searcherId });
      this.processImmediateQueue();
    } finally {
      this.immediateQueue.unshift(...waiting);
    }
  }

  private recordResolutionPickZones(context: ResolutionContext): void {
    // Where each pick is as resolution begins: a pick a response moved out
    // of its declared zone is ignored (CR 402.5); one an earlier effect of
    // this very resolution moved is not (see `pickedCardMovedAway`).
    const pickZones: Record<CardInstanceId, Zone> = {};
    for (const ids of Object.values(context.selected)) {
      for (const id of ids) {
        const z = this.state.cards[id]?.zone;
        if (z) pickZones[id] = z;
      }
    }
    context.pickZones = pickZones;

    // A pick that no longer has the card type its declaration named is not
    // affected by the effect (CR 208.2).
    const pickTypeLost: Record<string, true> = {};
    for (const decl of this.pickDeclarations(context)) {
      const type = decl.selector.type;
      if (!type || type === "resource" || decl.selector.faceDown !== undefined) continue;
      for (const id of context.selected[decl.id] ?? []) {
        const card = this.state.cards[id];
        if (card && !card.faceDown && !this.hasCardType(id, type)) {
          pickTypeLost[`${decl.id}:${id}`] = true;
        }
      }
    }
    context.pickTypeLost = pickTypeLost;
  }

  /** The target declarations of the ability (or `onPlay`) a resolution context belongs to. */
  private pickDeclarations(context: ResolutionContext): TargetDeclaration[] {
    const behavior = this.getDefinition(context.sourceId).behavior;
    return [
      ...(behavior?.onPlay?.targets ?? []),
      ...(behavior?.abilities ?? [])
        .filter(a => !context.abilityId || a.id === context.abilityId)
        .flatMap(a => (a as { targets?: TargetDeclaration[] }).targets ?? [])
    ];
  }

  private finishStackItem(item: StackItem): void {
    if (item.kind === "card") {
      const card = this.requireCard(item.sourceId);
      const definition = this.getDefinition(card.id);

      if (definition.type === "tactic") {
        if (card.zone === "deploying") {
          this.applyTacticDisposition(card.id, item.context);
        }
      } else if (card.zone === "deploying" && definition.attachTo && this.state.cards[item.context.selected[ATTACH_TARGET_ID]?.[0] ?? ""]?.zone !== "play") {
        // CR 507.2c: its target is no longer in play when it tries to enter
        // play, so it never enters play: it goes to its owner's discard pile.
        this.moveCard(card.id, "discard");
      } else if (card.zone === "deploying") {
        // The opponent it was played against stays with it while in play (D4).
        if (item.context.opponentId !== undefined) card.chosenOpponentId = item.context.opponentId;
        this.moveCard(card.id, "play");

        if (definition.attachTo) {
          card.attachedTo = item.context.selected[ATTACH_TARGET_ID]?.[0];
        }

        // A card entering during the active turn did not start that turn in
        // play, so it is not attack-eligible unless it has AGGRO.
        card.attackEligibleTurn = undefined;
        card.startedTurnInPlay = undefined;

        // Keep the `onPlay` EXTRA-COST picks reachable for this card's own
        // `cardEnteredPlay` triggered ability (Abecedarian Investor).
        this.entrySelections[card.id] = { ...item.context.selected };
        this.entryPickZones[card.id] = { ...item.context.pickZones };
        try {
          const enteredFrom = this.enterOrigin.get(card.id) ?? "hand";
          this.enterOrigin.delete(card.id);
          this.emit({
            type: "cardEnteredPlay",
            cardId: card.id,
            playerId: card.controllerId,
            from: enteredFrom,
            ...(item.context.deployedViaFlipUp ? { viaFlipUp: true } : {})
          });

          // A non-tactic's `behavior.onPlay.effects` are its inline ETB —
          // they resolve here, with the play-time context (so the EXTRA COST
          // picks in `item.context.selected` are available).
          for (const effect of definition.behavior?.onPlay?.effects ?? []) {
            this.resolveEffect(effect, item.context);
          }
        } finally {
          delete this.entrySelections[card.id];
          delete this.entryPickZones[card.id];
        }
      }
    }

    this.processImmediateQueue();
    this.checkStateBasedActions();
  }

  /**
   * Resolves `frame.effects` from `frame.index`, pausing (leaving a
   * `pendingChoice` set and re-pushing the remainder onto
   * `state.pendingEffectFrames`) the moment a "chooser" effect
   * (`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
   * `deployForFree`) needs a specific player's input. Returns true if the
   * frame ran to completion (and `finishStackItem`, if set, has already
   * been handled).
   */
  /** The effect list currently being run (index = the next effect), so a search can see sibling shuffles. */
  private runningFrame?: { effects: Effect[]; index: number };

  /** The search effect whose `deckSearched` announcement was already answered (see `chooserSelectsTarget`). */
  private announcedSearch?: Effect;
  /** Set by a search effect that paused on its own announcement: the running frame re-runs it (on top of its own remainder). */
  private retrySearchFrame?: PendingEffectFrame;

  private runEffectFrame(frame: PendingEffectFrame): boolean {
    if (frame.recordPickZones) {
      this.recordResolutionPickZones(frame.context);
      frame = { ...frame, recordPickZones: undefined };
    }
    // CR 313.2: "shuffle cards into a deck" only shuffles if more than 0 cards
    // were added. Tracks the net cards added by an immediately preceding
    // forEach/moveCard-to-deck step.
    let addedToDecks: number | undefined;
    const deckTotal = (): number =>
      Object.values(this.state.players).reduce((n, pl) => n + pl.deck.length, 0);
    for (let i = frame.index; i < frame.effects.length; i++) {
      const current = frame.effects[i];
      this.runningFrame = { effects: frame.effects, index: i + 1 };
      this.followingEffect = frame.effects[i + 1];
      if (current.type === "shuffleDeck" && addedToDecks === 0) {
        addedToDecks = undefined;
        continue;
      }
      const intoDeck =
        (current.type === "forEach" || current.type === "moveCard") &&
        JSON.stringify(current).includes('"to":"deck"');
      const totalBefore = intoDeck ? deckTotal() : 0;
      if (frame.announcedEffect === current) {
        this.announcedSearch = current;
      }
      const framesBefore = this.state.pendingEffectFrames.length;
      this.resolveEffect(frame.effects[i], frame.context);
      addedToDecks = intoDeck ? deckTotal() - totalBefore : undefined;
      this.processImmediateQueue();
      this.checkStateBasedActions();

      if (this.state.pendingChoice) {
        // The rest of this list waits BELOW whatever the paused effect parked
        // for itself (a `forEachPlayer`'s remaining players): that finishes first.
        const rest: PendingEffectFrame[] = [{ ...frame, index: i + 1 }];
        if (this.retrySearchFrame) {
          // The search paused on its own announcement: run it again (with the
          // announcement marked answered) before the rest of this list.
          rest.push(this.retrySearchFrame);
          this.retrySearchFrame = undefined;
        }
        this.state.pendingEffectFrames.splice(Math.min(framesBefore, this.state.pendingEffectFrames.length), 0, ...rest);
        return false;
      }

      // "Attack that player. ... resolve the battle immediately and before
      // you draw the card." (Counter Attack) — an `initiateAttack` that
      // actually started a battle hands off to the normal battle flow; the
      // rest of this list runs as an `endOfBattle` rider.
      if (
        frame.effects[i].type === "initiateAttack" &&
        this.state.battle &&
        this.state.battle.phase !== "finished"
      ) {
        const rest = frame.effects.slice(i + 1);
        if (rest.length > 0) {
          this.state.scheduledEffects.push({
            id: this.nextId("scheduled"),
            when: "endOfBattle",
            turnScheduled: this.state.turn,
            sourceId: frame.context.sourceId,
            controllerId: frame.context.controllerId,
            effects: rest,
            event: frame.context.event ? structuredClone(frame.context.event) : undefined,
            selected: structuredClone(frame.context.selected)
          });
        }
        if (frame.finishStackItem) this.finishStackItem(frame.finishStackItem);
        return true;
      }
    }

    if (frame.finishStackItem) {
      this.finishStackItem(frame.finishStackItem);
    }

    return true;
  }

  /**
   * Continues whatever was suspended in `state.pendingEffectFrames`, most
   * recently-paused first (LIFO — a chooser effect's own `effects` finish
   * before the outer ability they were nested in resumes). Call once a
   * chooser-style pendingChoice has been answered and its immediate
   * follow-up effects (if any) have been pushed as a new frame.
   */
  private resumeEffectFrames(): void {
    while (this.state.pendingEffectFrames.length > 0) {
      const frame = this.state.pendingEffectFrames.pop()!;
      const completed = this.runEffectFrame(frame);
      if (!completed) return;
    }
    // Every parked frame of the trigger that was resolving has run: the
    // triggers that were queued behind it may go on now.
    this.queueGuard = undefined;

    // Triggers queued behind the one that just finished (two copies of the
    // same card, SYS-62) are still waiting: carry on with them before the
    // response flow continues. They may pause on a choice of their own.
    this.processImmediateQueue();
    if (this.state.pendingChoice) return;

    // An item put on the stack from inside an effect (an ability "used" by a
    // start-of-turn trigger, Q34) with no window open yet: the opponent gets
    // to respond to it now that nothing else is waiting.
    if (!this.state.responseWindow && this.responseStack.length > 0) {
      const top = this.responseStack[this.responseStack.length - 1];
      this.openStackResponseWindow(top.controllerId);
      return;
    }

    // A response-stack item that had paused on a chooser has now finished
    // draining — continue the response flow (re-open the window for the next
    // responder, or close it). A no-op outside a resolving response window.
    this.reopenOrCloseResponseWindow();
  }

  private afterStackAction(actingPlayerId: PlayerId): void {
    const existing = this.state.responseWindow;

    if (existing) {
      assert(
        existing.phase === "acceptingResponses",
        "Cannot add a response while the chain is resolving."
      );

      // A fresh item is on top of the stack; only the opponent of whoever
      // just acted may respond to it (CR §607.1). The stack itself carries
      // the LIFO ordering — no priority hand-back to the actor.
      this.offerTopOfStack(existing, actingPlayerId);
      return;
    }

    // A main-phase deploy / ability: its stack item drives the whole
    // window. Only the other players respond and it closes once the item
    // resolves — there is no top-level responder queue (CR §607.2b).
    this.openStackResponseWindow(actingPlayerId);
  }

  /** Opens an `action` window over the item `actorId` just put on the stack, offering it to every other living player in turn. */
  private openStackResponseWindow(actorId: PlayerId): void {
    const responders = this.respondersTo(actorId);
    this.openResponseWindow("action", responders[0] ?? actorId, { type: "main" }, []);
    this.state.responseWindow!.stackResponders = responders;
  }

  private openResponseWindow(
    kind: ResponseWindowKind,
    firstPlayerId: PlayerId,
    continuation: ResponseContinuation,
    pendingResponders: PlayerId[]
  ): void {
    assert(
      !this.state.responseWindow,
      "A response window is already open."
    );

    this.state.responseWindow = {
      id: this.nextId("response"),
      kind,
      phase: "acceptingResponses",
      priorityPlayerId: firstPlayerId,
      pendingResponders: [...pendingResponders],
      continuation
    };

    this.state.priorityPlayerId = firstPlayerId;

    // Only bracket the "respond to your opponent's action / turn-end"
    // windows; the battle response points open constantly during resolution
    // and the battle events themselves already carry the sequence.
    if (kind === "action" || kind === "endTurn") {
      this.recordLogMarker(
        "responseWindowOpened",
        "info",
        `${this.logPlayerName(firstPlayerId)} may respond`,
        this.responseStack.length
      );
    }
  }

  private resumeContinuation(
    continuation: ResponseContinuation
  ): void {
    // A battle that ended while its window was open (a side was eliminated, D8)
    // has no step left to resume.
    if ("battleId" in continuation) {
      const battle = this.state.battle;
      if (!battle || battle.id !== continuation.battleId || battle.phase === "finished") {
        this.state.priorityPlayerId = this.state.activePlayerId;
        return;
      }
    }
    switch (continuation.type) {
      case "main":
        this.state.priorityPlayerId = this.state.activePlayerId;
        return;

      case "endTurn":
        this.finishTurn(continuation.playerId);
        return;

      case "battleBlocking": {
        const battle = this.requireBattleId(continuation.battleId);
        // Every attacker may have been removed from the battle during the
        // §608.1c window (destroyed, control changed, or — Backdoor Brigand
        // — turned face-down by its own ability). With no attacking party
        // there is nothing left to block or resolve, so the battle just
        // ends (CR §302.15) rather than prompting the defender for blockers
        // against an empty party.
        this.pruneBattleParties(battle);
        if (battle.attackingParty.length === 0) {
          this.finishBattle(battle);
          // Nothing happened in this battle (no damage to show): it is over
          // at once, and the turn can go on.
          this.clearFinishedBattle();
          return;
        }
        battle.phase = "blocking";
        this.state.priorityPlayerId = battle.defenderPlayerId;
        return;
      }

      case "battleAssignDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.enterDamageAssignment(battle);
        return;
      }

      case "battleInflictDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.inflictBattleDamageStep(battle);
        return;
      }
    }
  }

  private assertCanDeployAtCurrentTiming(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId?: CardInstanceId
  ): void {
    const problem = this.deployBlock(playerId, definition, cardId);
    if (problem) throw new Error(problem.text);
  }

  /**
   * The first gate `assertCanDeployAtCurrentTiming` refuses `definition` at (play bans, then the legal moment),
   * structured: `deployCard` throws its `text`, `getCardPlayability` reports it as `blockedBy`. One function, so
   * the refusal and the reason a UI shows cannot drift.
   */
  private deployBlock(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId?: CardInstanceId
  ): CardPlayBlock | undefined {
    return (
      this.deployRestrictionBlock(playerId, definition) ??
      this.deployTimingBlock(playerId, definition, cardId)
    );
  }

  /**
   * The "may this card be deployed at all" half of
   * `assertCanDeployAtCurrentTiming` (type, play bans), as the refusal message.
   * `getFlipUpPlayability` reads it too.
   */
  private deployRestrictionProblem(
    playerId: PlayerId,
    definition: CardDefinition
  ): string | undefined {
    return this.deployRestrictionBlock(playerId, definition)?.text;
  }

  /** `deployRestrictionProblem`, structured (kind + the card that imposes the ban, when one does). */
  private deployRestrictionBlock(
    playerId: PlayerId,
    definition: CardDefinition
  ): CardPlayBlock | undefined {
    // CR §203.1: a resource is played only when an effect instructs you to
    // (the faction Develop Rule via `chooseDevelop`, or a card effect) —
    // never as a normal card deploy.
    if (definition.type === "resource") {
      return {
        kind: "other",
        text: "Resource cards can only be played when an effect instructs you to (e.g. the develop rule)."
      };
    }

    const runtimeBan = this.state.playRestrictions.find(
      r =>
        r.playerId === playerId &&
        r.kind === "cardType" &&
        r.cardType === definition.type
    );
    if (runtimeBan) {
      return {
        kind: "playRestriction",
        ...(runtimeBan.sourceId ? { sourceId: runtimeBan.sourceId } : {}),
        text: `You cannot play ${definition.type} cards right now.`
      };
    }

    // Standing "you may not play X" from an in-play ContinuousAbility.
    // playRestrictions (Geldale, City-Fortress).
    const typeBan = this.continuousPlayRestrictor(playerId, { cardType: definition.type });
    if (typeBan) {
      return {
        kind: "playRestriction",
        sourceId: typeBan.sourceId,
        text: `You cannot play ${definition.type} cards right now.`
      };
    }

    // "The named card cannot be deployed." (Incriminating Photograph).
    const nameBan = this.continuousPlayRestrictor(playerId, { name: definition.name });
    if (nameBan) {
      return {
        kind: "namedBan",
        sourceId: nameBan.sourceId,
        ...(nameBan.namedValue ? { namedValue: nameBan.namedValue } : {}),
        text: `'${definition.name}' cannot be deployed right now.`
      };
    }

    return undefined;
  }

  /** The "is this a legal moment" half of `assertCanDeployAtCurrentTiming` (priority, response window, battle, stack), as the refusal message. */
  private deployTimingProblem(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId?: CardInstanceId
  ): string | undefined {
    return this.deployTimingBlock(playerId, definition, cardId)?.text;
  }

  /** `deployTimingProblem`, structured. */
  private deployTimingBlock(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId?: CardInstanceId
  ): CardPlayBlock | undefined {
    const window = this.state.responseWindow;
    const timing = (text: string): CardPlayBlock => ({ kind: "timing", text });

    if (window) {
      if (window.phase !== "acceptingResponses") return timing("Responses are already resolving.");
      if (window.priorityPlayerId !== playerId) return timing("It is not your priority.");
      if (
        !(
          definition.type === "tactic" ||
          (cardId
            ? this.hasKeyword(cardId, "tactical")
            : this.definitionHasKeyword(definition, "tactical"))
        )
      ) {
        return timing("Only tactics or TACTICAL cards may be deployed as responses.");
      }
      // A TACTICAL card is playable here only "whenever you could play a
      // tactic": a ban on playing tactics (Tactician Vacation) closes the
      // window for it too (FAQ).
      if (definition.type !== "tactic") {
        const runtimeBan = this.state.playRestrictions.find(
          r =>
            r.playerId === playerId &&
            r.kind === "cardType" &&
            r.cardType === "tactic"
        );
        const continuousBan = runtimeBan
          ? undefined
          : this.continuousPlayRestrictor(playerId, { cardType: "tactic" });
        if (runtimeBan || continuousBan) {
          const sourceId = runtimeBan?.sourceId ?? continuousBan?.sourceId;
          return {
            kind: "playRestriction",
            ...(sourceId ? { sourceId } : {}),
            text: "You cannot play tactics right now."
          };
        }
      }
      return undefined;
    }

    if (this.state.battle) return timing("Cards may only be deployed during a battle in a response window.");
    if (this.responseStack.length !== 0) return timing("Cannot begin a new action while responses are unresolved.");
    if (playerId !== this.state.activePlayerId) return timing("Only the active player may deploy a normal turn action.");
    return undefined;
  }

  private assertCanUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): void {
    assert(
      this.canUseAbilityAtCurrentTiming(playerId),
      "Ability cannot be used at the current timing."
    );
  }

  private canUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): boolean {
    const window = this.state.responseWindow;

    if (window) {
      return (
        window.phase === "acceptingResponses" &&
        window.priorityPlayerId === playerId
      );
    }

    return (
      !this.state.battle &&
      this.responseStack.length === 0 &&
      playerId === this.state.activePlayerId
    );
  }

  private requireResponseWindow(): ResponseWindowState {
    const window = this.state.responseWindow;
    assert(window, "No response window is open.");
    return window;
  }

  // ---------------------------------------------------------------------------
  // Event / trigger system
  // ---------------------------------------------------------------------------

  emit(event: GameEvent): void {
    this.readMemo = undefined;
    // A card entering play is a new object: forget its last-known counters.
    if (
      (event.type === "cardMoved" && event.to === "play") ||
      event.type === "cardEnteredPlay"
    ) {
      this.lastKnownCounters.delete(event.cardId);
      this.lastKnownController.delete(event.cardId);
    }
    if (event.type === "cardEnteredPlay") this.recentlyEntered.add(event.cardId);
    // Same new object: its once-per-turn triggers have not fired yet this turn.
    if (
      (event.type === "cardMoved" && event.to === "play") ||
      event.type === "cardEnteredPlay"
    ) {
      const prefix = `${TRIGGER_USES_PREFIX}${event.cardId}:`;
      for (const key of Object.keys(this.state.abilityUsesThisTurn)) {
        if (key.startsWith(prefix)) delete this.state.abilityUsesThisTurn[key];
      }
    }

    // A new UNIQUE copy the rule removes never entered play: its departure
    // is not an event anyone can trigger on (nor counts toward "this turn").
    const silent = this.isSilentDeparture(event);
    const tallyKey =
      "playerId" in event && event.playerId
        ? `${event.type}:${event.playerId}`
        : event.type;
    if (!silent) {
      this.state.turnEventTally[tallyKey] =
        (this.state.turnEventTally[tallyKey] ?? 0) + 1;
    }

    // Per-turn damage history — "a character that inflicted damage to your
    // faction this turn" (Drive By Boobing), "has not assigned damage this
    // turn" (Backdoor Brigand).
    if (event.type === "damageDealt" && event.sourceId) {
      const rec = (this.state.damageThisTurn[event.sourceId] ??= {
        assigned: false,
        toFactionOf: [],
        toCards: []
      });
      rec.assigned = true;
      if (!rec.toCards.includes(event.targetId)) {
        rec.toCards.push(event.targetId);
      }
      const victim = this.state.cards[event.targetId];
      if (victim && this.getDefinition(event.targetId).type === "faction") {
        const holderId = this.factionHolderId(victim);
        if (!rec.toFactionOf.includes(holderId)) {
          rec.toFactionOf.push(holderId);
        }
        // Per-player history: survives the source card leaving play (a
        // token's record is deleted). The source is still in state.cards here.
        const inflicter = this.state.cards[event.sourceId]?.controllerId;
        if (inflicter) {
          const hit = (this.state.factionDamageInflictedThisTurn[inflicter] ??= []);
          if (!hit.includes(holderId)) hit.push(holderId);
        }
      }
    }

    this.recordLogEvent(event);

    const batchId = this.nextId("batch");
    const triggers = silent ? [] : this.findTriggers(event, batchId);
    if (!silent && event.type === "damageDealt") {
      triggers.push(...this.daringGambitTriggers(event, batchId));
    }
    if (!silent && event.type === "turnStarted") {
      triggers.push(...this.factionStartTriggers(event, batchId));
    }
    if (!silent && event.type === "turnEnding") {
      triggers.push(...this.factionEndTriggers(event, batchId));
    }

    for (const trigger of triggers) {
      this.immediateQueue.push(trigger);
    }

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  /** `event` is the departure (destroyed / leaves play) of a card in `silentDepartures`. */
  private isSilentDeparture(event: GameEvent): boolean {
    if (this.silentDepartures.size === 0) return false;
    if (event.type === "cardDestroyed") return this.silentDepartures.has(event.cardId);
    return (
      event.type === "cardMoved" &&
      event.from === "play" &&
      this.silentDepartures.has(event.cardId)
    );
  }

  private beginEventBatch(): void {
    this.eventBatchDepth++;
  }

  private endEventBatch(): void {
    assert(this.eventBatchDepth > 0, "No event batch is active.");

    this.eventBatchDepth--;

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  /**
   * The trigger kinds every live `ContinuousAbility.ignoresTriggers` currently tells the engine to ignore (Unwelcome
   * Hero), for either player's cards. Only the two events those kinds are about can be affected.
   */
  private ignoredTriggerKinds(event: GameEvent): Set<IgnorableTriggerKind> {
    if (event.type !== "cardEnteredPlay" && !(event.type === "cardMoved" && event.from === "play")) {
      return new Set<IgnorableTriggerKind>();
    }
    const kinds = this.liveIgnoredTriggerKinds();
    // Cards that leave play in one simultaneous action (Wrath of the Mau's "destroy all characters") leave together
    // (CR 305.2): an ignore source that left earlier in the same action was still in play when the others left.
    if (this.simultaneousIgnoredKinds?.has("thisCardLeavesPlay") && event.type === "cardMoved") {
      kinds.add("thisCardLeavesPlay");
    }
    return kinds;
  }

  /** The kinds ignored as of the start of the simultaneous `forEach` now resolving (`undefined` outside one). */
  private simultaneousIgnoredKinds: Set<IgnorableTriggerKind> | undefined;

  private liveIgnoredTriggerKinds(): Set<IgnorableTriggerKind> {
    const kinds = new Set<IgnorableTriggerKind>();

    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.ignoresTriggers?.length) continue;
        const guardKey = `${source.id}:${ability.id}:ignoresTriggers`;
        if (this.resolvingContinuousGrant.has(guardKey)) continue;
        this.resolvingContinuousGrant.add(guardKey);
        try {
          if (this.abilitySuppressed(source.id, ability.id)) continue;
          if (
            ability.condition &&
            !this.evaluateCondition(ability.condition, {
              sourceId: source.id,
              controllerId: source.controllerId,
              abilityId: ability.id,
              selected: {}
            })
          ) {
            continue;
          }
          for (const kind of ability.ignoresTriggers) kinds.add(kind);
        } finally {
          this.resolvingContinuousGrant.delete(guardKey);
        }
      }
    }
    return kinds;
  }

  private findTriggers(event: GameEvent, batchId: string): TriggerResolution[] {
    const results: TriggerResolution[] = [];

    const eventCardId = this.getEventCardId(event);
    const ignoredKinds = this.ignoredTriggerKinds(event);

    for (const card of Object.values(this.state.cards)) {
      // A card's own "leaves play" trigger (cardDestroyed, or cardMoved out
      // of `play`) must still be considered even though `moveCard` already
      // updated this card's zone before emit() was called — otherwise the
      // zone check below would always filter out the one card the event is
      // actually about.
      const isLeavingPlayEventSource =
        eventCardId === card.id &&
        (event.type === "cardDestroyed" ||
          (event.type === "cardMoved" && event.from === "play"));

      const definition = this.getDefinition(card.id);

      const ownAbilities = (definition.behavior?.abilities ?? []).filter(
        (a): a is Extract<AbilityDefinition, { type: "triggered" }> =>
          a.type === "triggered"
      );
      // Abilities granted to this card by an in-play continuous
      // `grantedAbilities` aura ("all characters gain the rules text ...").
      const grantedAbilities =
        card.zone === "play" && !card.faceDown
          ? this.getGrantedTriggeredAbilities(card.id)
          : isLeavingPlayEventSource
            ? (this.departedAbilityGrants.get(card.id) ?? []).filter(
                (a): a is Extract<AbilityDefinition, { type: "triggered" }> =>
                  a.type === "triggered"
              )
            : [];

      for (const ability of [...ownAbilities, ...grantedAbilities]) {
        if (ability.event !== event.type) {
          continue;
        }

        if (this.abilitySuppressed(card.id, ability.id)) {
          continue;
        }

        // "Ignore all triggers that begin with "when this card enters play" / "... leaves play"" (Unwelcome Hero).
        if (ignoredKinds.size > 0) {
          const kind = ignorableTriggerKind(ability);
          if (kind !== undefined && ignoredKinds.has(kind)) continue;
        }

        // "Once per turn, when ..." — `usesPerTurn` caps how many times this
        // trigger fires; a trigger already spent for the turn is not offered.
        const usesKey =
          ability.usesPerTurn !== undefined
            ? `${TRIGGER_USES_PREFIX}${card.id}:${ability.id}`
            : undefined;
        if (
          usesKey !== undefined &&
          (this.state.abilityUsesThisTurn[usesKey] ?? 0) >= ability.usesPerTurn!
        ) {
          continue;
        }

        // A resource entering play now emits `cardEnteredPlay` as well as
        // `resourcePlayed` (SYS-49). Cards authored before that carry a twin
        // pair (a `resourcePlayed` ability for develops, a `cardEnteredPlay`
        // one for deploys) with identical effects; fire only the
        // `cardEnteredPlay` twin so the entry isn't counted twice.
        if (
          event.type === "resourcePlayed" &&
          this.hasCardEnteredPlayTwin(definition, ability)
        ) {
          continue;
        }

        // **(user ruling 2026-10-27)** A trigger on *a* card entering play
        // ("When a card that provides at least [O] enters play under your
        // control" — Crests, Banners, Merbegon) needs its source already in
        // play when that card enters, so it does not see its own source's
        // entry. Only a "this card" trigger (`sourceIsEventCard`) does.
        if (
          event.type === "cardEnteredPlay" &&
          eventCardId === card.id &&
          !conditionMentions(ability.condition, "sourceIsEventCard")
        ) {
          continue;
        }

        // A trigger is normally live only while its source is face-up in
        // play; `triggerZone` moves that to another zone ("while this card
        // is in your discard pile, when ...").
        const triggerZone = ability.triggerZone ?? "play";
        if (ability.triggerFromAnyZone) {
          // A lasting effect ("for the rest of the game") that does not
          // depend on where its card is now; the ability's own condition and
          // selectors tie it to what the card did (`voidedBySource`).
        } else if (triggerZone === "play") {
          // For the card this very event just took out of play, `card.zone`
          // / `card.faceDown` are already updated — consult the face-down
          // state captured on the event. A card that left play *while
          // face-down* was an anonymous Volition resource with no rules
          // text (CR §411.1), so its "leaves play" trigger does not fire; a
          // face-up card flipped face-down (CR §411.4) reports `false` and
          // does fire it.
          const sourceFaceDown =
            isLeavingPlayEventSource &&
            (event.type === "cardMoved" || event.type === "cardDestroyed")
              ? event.faceDown === true
              : card.faceDown;
          if (
            (card.zone !== "play" && !isLeavingPlayEventSource) ||
            sourceFaceDown
          ) {
            continue;
          }
        } else if (card.zone !== triggerZone) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: this.controllerAtEvent(event, card),
          abilityId: ability.id,
          event,
          selected:
            eventCardId === card.id && this.entrySelections[card.id]
              ? { ...this.entrySelections[card.id] }
              : {},
          ...(eventCardId === card.id && this.entryPickZones[card.id]
            ? { pickZones: this.entryPickZones[card.id] }
            : {})
        };

        if (
          !ability.condition ||
          this.evaluateCondition(ability.condition, context)
        ) {
          // An opponent's action names the opponent this trigger is about (E3).
          if (opponentsOf(this.state, context.controllerId).length > 1) {
            const refs = opponentRefsOf(ability);
            const fromEvent = refs.inPicks || refs.elsewhere ? this.eventOpponent(event, context.controllerId) : undefined;
            if (fromEvent !== undefined) context.opponentId = fromEvent;
          }
          // Spent when it fires (queued), not when it resolves: a second
          // matching event before this one resolves must not fire it again.
          if (usesKey !== undefined) {
            this.state.abilityUsesThisTurn[usesKey] =
              (this.state.abilityUsesThisTurn[usesKey] ?? 0) + 1;
          }
          results.push({
            sourceId: card.id,
            ability,
            context,
            batchId
          });
        }
      }
    }

    return results;
  }

  private hasCardEnteredPlayTwin(
    definition: CardDefinition,
    ability: Extract<AbilityDefinition, { type: "triggered" }>
  ): boolean {
    if (ability.event !== "resourcePlayed") return false;
    const key = JSON.stringify([ability.effects, ability.targets ?? null]);
    return (definition.behavior?.abilities ?? []).some(
      other =>
        other.type === "triggered" &&
        other.event === "cardEnteredPlay" &&
        JSON.stringify([other.effects, other.targets ?? null]) === key
    );
  }

  /**
   * Triggered abilities granted to `cardId` by every in-play, face-up
   * `ContinuousAbility.grantedAbilities` aura whose `condition` holds and
   * whose per-block `selector` matches `cardId`. The granted abilities fire
   * for `cardId` itself (not the granting source).
   */
  private getGrantedTriggeredAbilities(
    cardId: CardInstanceId
  ): Array<Extract<AbilityDefinition, { type: "triggered" }>> {
    const results: Array<Extract<AbilityDefinition, { type: "triggered" }>> = [];
    const target = this.state.cards[cardId];
    if (!target) return results;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantedAbilities) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }

        for (const block of ability.grantedAbilities) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const granted of block.abilities) {
            if (granted.type === "triggered") results.push(granted);
          }
        }
      }
    }

    // "gains all rules text of the removed character" (Skin Suit) — a
    // permanent snapshot on `state.abilityGrants`, live while the recipient
    // is in play.
    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const granted of grant.abilities) {
        if (granted.type === "triggered") results.push(granted);
      }
    }

    return results;
  }

  /**
   * Activated abilities granted to `cardId` by an in-play
   * `ContinuousAbility.grantedAbilities` aura (the parallel of
   * `getGrantedTriggeredAbilities`) — "each character you control gains
   * 'RESEARCH — ...'." (Jo Ciendeilio). They activate with `cardId` as
   * their source.
   */
  private getGrantedActivatedAbilities(
    cardId: CardInstanceId
  ): ActivatedAbility[] {
    const results: ActivatedAbility[] = [];
    const target = this.state.cards[cardId];
    if (!target || target.zone !== "play" || target.faceDown) return results;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantedAbilities) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const block of ability.grantedAbilities) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const granted of block.abilities) {
            if (granted.type === "activated") results.push(granted);
          }
        }
      }
    }

    // Skin Suit's "gains all rules text of the removed character".
    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const granted of grant.abilities) {
        if (
          granted.type === "activated" &&
          !this.abilitySuppressed(cardId, granted.id)
        ) {
          results.push(granted);
        }
      }
    }
    return results;
  }

  /**
   * `cardId`'s own continuous abilities PLUS any continuous ability granted
   * to it — by an in-play `ContinuousAbility.grantedAbilities` block whose
   * per-block `selector` matches it (God's Blessing of ___), or a permanent
   * `state.abilityGrants` snapshot (Skin Suit). A granted continuous
   * ability is resolved with `cardId` as its source, so "All your
   * characters gain 1 strength" inside the granted text scopes to the
   * recipient's controller. The parallel of `getGrantedTriggeredAbilities`
   * / `getGrantedActivatedAbilities` for the continuous recompute.
   */
  /**
   * A definition's continuous abilities, memoized per definition object. The
   * returned array is shared — callers only iterate it.
   */
  private readonly continuousAbilityCache = new WeakMap<
    CardDefinition,
    Array<Extract<AbilityDefinition, { type: "continuous" }>>
  >();

  private continuousAbilitiesOf(
    definition: CardDefinition
  ): Array<Extract<AbilityDefinition, { type: "continuous" }>> {
    let own = this.continuousAbilityCache.get(definition);
    if (!own) {
      own = (definition.behavior?.abilities ?? []).filter(
        (a): a is Extract<AbilityDefinition, { type: "continuous" }> =>
          a.type === "continuous"
      );
      this.continuousAbilityCache.set(definition, own);
    }
    return own;
  }

  /**
   * A definition's continuous abilities that carry a `grantedAbilities`
   * block, memoized per definition object (definitions never change under a
   * live engine, and keying on the object stays correct if one is swapped).
   */
  private readonly grantingAbilityCache = new WeakMap<
    CardDefinition,
    Array<Extract<AbilityDefinition, { type: "continuous" }>>
  >();

  private grantingAbilitiesOf(
    definition: CardDefinition
  ): Array<Extract<AbilityDefinition, { type: "continuous" }>> {
    let granting = this.grantingAbilityCache.get(definition);
    if (!granting) {
      granting = (definition.behavior?.abilities ?? []).filter(
        (a): a is Extract<AbilityDefinition, { type: "continuous" }> =>
          a.type === "continuous" && !!a.grantedAbilities
      );
      this.grantingAbilityCache.set(definition, granting);
    }
    return granting;
  }

  /**
   * Face-up in-play cards that print an ability which grants abilities to
   * other cards — almost always none. Pass the result to every
   * {@link getEffectiveContinuousAbilities} call in one read-only sweep over
   * the board: recomputing it per source made a single `getStat` cost
   * O(cards^2), which dominated the whole engine's runtime on wide boards.
   */
  private grantingSources(): CardInstance[] {
    // Read-only for every caller (they iterate), so the memoized list is shared, not copied.
    return this.scopedRead("granters", "", () => this.computeGrantingSources());
  }

  private computeGrantingSources(): CardInstance[] {
    const ids = this.grantingDefinitionSet();
    // No definition in this game grants anything (true of nearly every game):
    // nothing on the board can either, so skip the walk over every card.
    if (ids.size === 0) return [];
    const out: CardInstance[] = [];
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (ids.has(source.definitionId)) out.push(source);
    }
    return out;
  }

  /**
   * Ids of the definitions that print a `grantedAbilities` block. Built once
   * (definitions are fixed after construction) and dropped whenever a token
   * definition is minted, the one place `definitions` grows at runtime.
   */
  private grantingDefinitionIds: Set<CardDefinitionId> | undefined;

  private grantingDefinitionSet(): Set<CardDefinitionId> {
    if (!this.grantingDefinitionIds) {
      const ids = new Set<CardDefinitionId>();
      for (const [id, definition] of Object.entries(this.definitions)) {
        if (this.grantingAbilitiesOf(definition).length > 0) ids.add(id);
      }
      this.grantingDefinitionIds = ids;
    }
    return this.grantingDefinitionIds;
  }

  private getEffectiveContinuousAbilities(
    cardId: CardInstanceId,
    granters?: CardInstance[]
  ): Array<Extract<AbilityDefinition, { type: "continuous" }>> {
    // `granters` is only a shortcut for the same list `grantingSources()` returns, so it is not part of the key.
    // The array is read-only for callers (it is already the shared per-definition list when nothing is granted).
    return this.scopedRead("effectiveContinuous", cardId, () => this.computeEffectiveContinuousAbilities(cardId, granters));
  }

  private computeEffectiveContinuousAbilities(
    cardId: CardInstanceId,
    granters?: CardInstance[]
  ): Array<Extract<AbilityDefinition, { type: "continuous" }>> {
    const own = this.continuousAbilitiesOf(this.getDefinition(cardId));

    const target = this.state.cards[cardId];
    if (!target || target.zone !== "play" || target.faceDown) return own;

    const granted: Array<Extract<AbilityDefinition, { type: "continuous" }>> = [];

    for (const source of granters ?? this.grantingSources()) {
      if (source.id === cardId) continue;
      for (const ability of this.grantingAbilitiesOf(
        this.getDefinition(source.id)
      )) {
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, ctx)
        ) {
          continue;
        }
        for (const block of ability.grantedAbilities ?? []) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const g of block.abilities) {
            if (g.type === "continuous") granted.push(g);
          }
        }
      }
    }

    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const g of grant.abilities) {
        if (g.type === "continuous") granted.push(g);
      }
    }

    return granted.length ? [...own, ...granted] : own;
  }

  /**
   * Visit every in-play, face-up card's live continuous abilities (own +
   * granted) whose `condition` currently holds, with a resolution context
   * rooted on that source. The generic loop behind the newer
   * `ContinuousAbility` fields (`preventsDefeat`, `drawModifiers`,
   * `influenceModifiers`, `attackTax`, …).
   */
  private forEachActiveContinuous(
    visit: (
      source: CardInstance,
      ability: Extract<AbilityDefinition, { type: "continuous" }>,
      context: ResolutionContext
    ) => void
  ): void {
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }
        visit(source, ability, context);
      }
    }
  }

  /**
   * Total `ContinuousAbility.searchTax` levied on `playerId` searching their
   * own deck (0 = no tax). `searchTax` with `amount` omitted / evaluating to
   * 0 still returns 0 here — a hard "cannot search" is authored as a large
   * `amount` the player can't afford, or handled by the caller.
   */
  private searchTaxFor(playerId: PlayerId): number {
    let tax = 0;
    this.forEachActiveContinuous((source, ability, context) => {
      const rule = ability.searchTax;
      if (!rule) return;
      if (!this.scopeMatchesPlayer(rule.player, source.controllerId, playerId)) {
        return;
      }
      tax += Math.max(
        0,
        rule.amount === undefined ? 0 : this.evaluateNumber(rule.amount, context)
      );
    });
    return tax;
  }

  /** Resolve a `"self" | "opponent" | "any"` player scope against a source. */
  private scopeMatchesPlayer(
    scope: "self" | "opponent" | "any",
    sourceControllerId: PlayerId,
    playerId: PlayerId
  ): boolean {
    if (scope === "any") return true;
    if (scope === "self") return sourceControllerId === playerId;
    return isOpponentOf(this.state, sourceControllerId, playerId);
  }

  /**
   * The triggers that were already queued when a trigger's effects paused on a
   * player choice (two Mau Caravans: the sibling copy's trigger). While the
   * paused trigger's parked frames are still being resumed, an event emitted by
   * one of them (a cost paid, a card picked) must not start those siblings in
   * the middle: they would prompt over the paused trigger's pick. Cleared when
   * `resumeEffectFrames` has run every parked frame.
   */
  private queueGuard: Set<TriggerResolution> | undefined;

  private processImmediateQueue(): void {
    if (this.endlessLoopFound) return;
    // Triggers that re-trigger themselves through the effects they resolve
    // nest one resolution inside the next.
    if (this.triggerNesting >= MAX_TRIGGER_NESTING) {
      this.endlessLoopFound = true;
      throw new EndlessLoopError("Triggered abilities are looping without end.");
    }
    this.triggerNesting++;
    try {
      this.drainImmediateQueue();
    } finally {
      this.triggerNesting--;
    }
  }

  private drainImmediateQueue(): void {
    // Triggers that keep re-triggering each other (two cards each reacting
    // to the other's damage) would loop here forever (CR 414.1).
    let resolvedHere = 0;
    while (this.immediateQueue.length > 0) {
      if (++resolvedHere >= 5000) {
        this.endlessLoopFound = true;
        throw new EndlessLoopError("Triggered abilities are looping without end.");
      }
      // A pendingChoice already outstanding (set by whatever called into
      // this — directly, or several frames up a reentrant call chain) must
      // be answered before anything else in the queue is touched. Without
      // this guard, a reentrant call reached via a *different* path (e.g.
      // finishBattle's own beginEventBatch/endEventBatch, entered from
      // resumeContinuation right after this same queue produced the still-
      // unanswered choice) can reach the next queued trigger and resolve it
      // — and if that trigger's own effects set pendingChoice too, it
      // silently overwrites the first one before anyone ever saw or
      // answered it, permanently losing that trigger's effects.
      if (this.state.pendingChoice) return;

      // Peeked, not shifted: if this trigger turns out to need a player
      // choice, it must stay at the head of the queue so resolvePendingChoice
      // can resume exactly here afterward.
      const trigger = this.immediateQueue[0];
      if (this.queueGuard?.has(trigger)) return;

      // CR §507.5 (Unique) is enforced immediately: a second copy that just
      // entered play makes its controller keep one BEFORE any queued trigger
      // (including that copy's own "enters play" trigger) resolves.
      if (this.raiseUniqueConflict()) return;

      if (
        !this.state.cards[trigger.sourceId] &&
        trigger.context.event?.type !== "cardDestroyed"
      ) {
        this.immediateQueue.shift();
        continue;
      }

      // RULES.md §7: triggers firing "at once" (from the same event) are
      // ordered by their common controller, or by the active player if
      // they belong to different players — never by iteration order.
      const batch = this.getUnorderedTriggerBatch(trigger.batchId);

      // Several copies of one ability on one card (the triggers of a cost payment, CR 503.3) have no order to decide.
      const indistinguishable = batch.every(
        queued => queued.sourceId === trigger.sourceId && queued.ability.id === trigger.ability.id
      );

      if (batch.length > 1 && !indistinguishable) {
        const controllerIds = new Set(
          batch.map(queued => queued.context.controllerId)
        );

        this.state.pendingChoice = {
          kind: "orderTriggers",
          id: this.nextId("choice"),
          playerId:
            controllerIds.size === 1
              ? [...controllerIds][0]
              : this.state.activePlayerId,
          triggers: batch.map(queued => ({
            sourceId: queued.sourceId,
            abilityId: queued.ability.id
          }))
        };

        return;
      }

      const declarations = trigger.ability.targets ?? [];
      const unresolved = this.findUnresolvedTargetDeclarations(
        declarations,
        trigger.context
      );

      if (unresolved.length > 0) {
        this.state.pendingChoice = {
          kind: "selectTargets",
          id: this.nextId("choice"),
          playerId: trigger.context.controllerId,
          sourceId: trigger.sourceId,
          abilityId: trigger.ability.id,
          declarations: unresolved,
          context: structuredClone(trigger.context)
        };

        return;
      }

      if (declarations.length) {
        // Only unambiguous declarations reach here — exactly enough legal
        // candidates to fill every slot, nothing left to decide.
        this.autoSelectTargets(declarations, trigger.context);

        // The trigger's picks are made now: "if this card is picked"
        // triggers (Ferrous Ferret) must resolve BEFORE this trigger's own
        // effects, so they are queued at the head and this trigger waits.
        if (!trigger.picksAnnounced) {
          trigger.picksAnnounced = true;
          const queued = this.immediateQueue.length;
          this.beginEventBatch();
          try {
            this.emitCardPicked(
              trigger.context.selected,
              trigger.context.controllerId,
              declarations.map(d => d.id)
            );
          } finally {
            this.eventBatchDepth--;
          }
          const added = this.immediateQueue.splice(queued);
          if (added.length > 0) {
            this.immediateQueue.unshift(...added);
            continue;
          }
        }
      }

      // Its picks are made: the opponent its rules text is about, if neither
      // the event nor a pick named one (MP 2).
      const opponentCandidates = this.bindBlockOpponent(trigger.context, trigger.ability, declarations);
      if (opponentCandidates) {
        this.state.pendingChoice = {
          kind: "chooseOpponent",
          id: this.nextId("choice"),
          playerId: trigger.context.controllerId,
          sourceId: trigger.sourceId,
          abilityId: trigger.ability.id,
          candidates: opponentCandidates
        };
        return;
      }

      // Committed: remove before resolving effects. An effect can itself
      // emit an event (e.g. dealDamage → damageDealt), reentrantly calling
      // processImmediateQueue — this trigger must not still be at the head
      // when that happens, or it gets resolved again and recurses forever.
      this.immediateQueue.shift();

      const triggerLabel = trigger.ability.name
        ? `"${trigger.ability.name}"`
        : "triggered ability";
      this.recordLogMarker(
        "triggerResolving",
        "trigger",
        `${this.logCardName(trigger.sourceId)}'s ${triggerLabel} resolves`,
        this.responseStack.length
      );

      const completed = this.runEffectFrame({
        effects: trigger.ability.effects,
        index: 0,
        context: trigger.context
      });

      if (!completed) {
        this.queueGuard = new Set(this.immediateQueue);
        return;
      }
    }
  }

  /** The leading run of immediateQueue entries sharing one batchId (same emitted event). */
  private getUnorderedTriggerBatch(batchId: string): TriggerResolution[] {
    const batch: TriggerResolution[] = [];

    for (const trigger of this.immediateQueue) {
      if (trigger.batchId !== batchId) break;
      batch.push(trigger);
    }

    return batch;
  }

  /**
   * Target declarations a triggered ability can't fill on its own — more
   * legal candidates than slots, so a real decision is needed (RULES.md §7's
   * "a real client should request choices here"). A declaration with too
   * few candidates is left for autoSelectTargets to reject as before; that's
   * a genuinely unplayable trigger, not a choice.
   */
  private findUnresolvedTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): TargetDeclaration[] {
    const unresolved: TargetDeclaration[] = [];

    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.targetCandidates(declaration.selector, context);
      const max = this.evaluateNumber(declaration.count, context);

      // An optional declaration is always a real decision when at least
      // one legal candidate exists — the controller might decline (or, for
      // an "N or fewer" range, pick fewer than the max) even when there's
      // exactly one, unlike a mandatory declaration (which is only
      // "unresolved" when genuinely ambiguous).
      if (
        candidates.length > max ||
        (declaration.optional && candidates.length > 0)
      ) {
        unresolved.push(declaration);
      }
    }

    return unresolved;
  }

  // ---------------------------------------------------------------------------
  // Conditions / expressions
  // ---------------------------------------------------------------------------

  evaluateCondition(
    condition: Condition,
    context: ResolutionContext
  ): boolean {
    // E4: with no opponent bound and several to consider, a condition about
    // "your opponent" ("an opponent controls more characters than you", "an
    // opponent lost influence this turn") holds when it holds for some one of
    // them — each opponent judged on their own, not all of them summed.
    if (context.opponentId === undefined && conditionNodeRefersToOpponent(condition)) {
      const opponents = opponentsOf(this.state, context.controllerId);
      if (opponents.length > 1) {
        return opponents.some(opponentId => this.evaluateConditionNode(condition, { ...context, opponentId }));
      }
    }
    return this.evaluateConditionNode(condition, context);
  }

  private evaluateConditionNode(
    condition: Condition,
    context: ResolutionContext
  ): boolean {
    switch (condition.type) {
      case "and":
        return condition.conditions.every(condition =>
          this.evaluateCondition(condition, context)
        );

      case "or":
        return condition.conditions.some(condition =>
          this.evaluateCondition(condition, context)
        );

      case "not":
        return !this.evaluateCondition(
          condition.condition,
          context
        );

      case "sourceInZone":
        return (
          this.state.cards[context.sourceId]?.zone ===
          condition.zone
        );

      case "sourceIsEventCard":
        return (
          this.getEventCardId(context.event) ===
          context.sourceId
        );

      case "eventCardIs":
        return (
          this.getEventCardId(context.event) ===
          this.resolveTargetRef(condition.target, context)
        );

      case "targetInZone": {
        const cardId = this.resolveTargetRef(condition.target, context);
        return !!cardId && this.state.cards[cardId]?.zone === condition.zone;
      }

      case "targetOwnedBy": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        const ownerId = this.state.cards[cardId]?.ownerId;
        return !!ownerId && ownerId === this.resolvePlayerRef(condition.player, context).id;
      }

      case "targetControlledBy": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        const controllerId = this.state.cards[cardId]?.controllerId;
        return (
          !!controllerId &&
          controllerId === this.resolvePlayerRef(condition.player, context).id
        );
      }

      case "isToken": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        // A token that has already ceased to exist (it left play) is still a
        // token for the "leaves play" trigger that asks (last-known information).
        return (
          !!cardId &&
          (!!this.state.cards[cardId]?.isToken || this.departedTokens.has(cardId))
        );
      }

      case "battleDamageAssigned": {
        const battle = this.state.battle;
        if (!battle) return false;
        return compare(
          battle.assignedDamageBy.length,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "battleTargetIs": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished" || battle.target.type !== "card") {
          return false;
        }
        const targetId = battle.target.cardId;
        if (
          condition.cardType &&
          !this.hasCardType(targetId, condition.cardType)
        ) {
          return false;
        }
        if (condition.controlledBy) {
          const who = this.resolvePlayerRef(condition.controlledBy, context).id;
          if (this.state.cards[targetId]?.controllerId !== who) return false;
        }
        return true;
      }

      case "eventCardControlledBy": {
        const eventCardId = this.getEventCardId(context.event);

        if (!eventCardId) {
          return false;
        }

        // A destroyed token no longer exists — judge it by who controlled
        // it when it left play (see `departedTokens`).
        const eventCard =
          this.state.cards[eventCardId] ?? this.departedTokens.get(eventCardId);

        if (!eventCard) {
          return false;
        }

        return (
          this.controllerAtEvent(context.event, eventCard) ===
          this.resolvePlayerRef(condition.player, context).id
        );
      }

      case "targetExists":
        return this.resolveTargetRef(
          condition.target,
          context
        ) !== undefined;

      case "cardTypeIs": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (cardId && condition.printed) {
          // Looks through a face-down card: its printed (hidden) type.
          return this.getDefinition(cardId).type === condition.cardType;
        }
        if (cardId && this.leftPlayFaceDown(cardId, context)) {
          return condition.cardType === "resource";
        }
        return !!cardId && this.hasCardType(cardId, condition.cardType);
      }

      case "cardTradeIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (cardId && this.leftPlayFaceDown(cardId, context)) return false;
        return (
          !!cardId &&
          !this.isFaceDownInPlay(cardId) &&
          this.getDefinition(cardId).trade === condition.trade
        );
      }

      case "sharesTradeWithAny": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        const trade = this.getDefinition(cardId).trade;
        return this.queryCards(condition.among, context).some(
          card => card.id !== cardId && this.getDefinition(card.id).trade === trade
        );
      }

      case "hasUnique": {
        const cardId = this.resolveTargetRef(condition.target, context);
        return !!cardId && this.getEffectiveUnique(cardId) != null;
      }

      case "hasAbility": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) return false;
        const definition = this.getDefinition(cardId);
        const abilities = [
          ...(definition.behavior?.abilities ?? []),
          ...(definition.faction?.abilities ?? [])
        ].filter(a => !this.abilitySuppressed(cardId, a.id));
        return condition.abilityType
          ? abilities.some(a => a.type === condition.abilityType)
          : abilities.length > 0;
      }

      case "statCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        return compare(
          this.getStat(cardId, condition.stat),
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "counterCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        const count = this.counterCountFor(
          cardId,
          condition.counter
        );

        return compare(
          count,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "numberCompare": {
        return compare(
          this.evaluateNumber(condition.left, context),
          condition.operator,
          this.evaluateNumber(condition.right, context)
        );
      }

      case "inBattle": {
        const cardId = this.resolveTargetRef(condition.target, context);
        const battle = this.state.battle;

        if (!cardId || !battle) {
          return false;
        }

        if (condition.role === "attacker") {
          return battle.attackingParty.includes(cardId);
        }

        if (condition.role === "blocker") {
          return battle.blockingParty.includes(cardId);
        }

        return (
          battle.attackingParty.includes(cardId) ||
          battle.blockingParty.includes(cardId)
        );
      }

      case "sourceIsDamageSource": {
        return (
          context.event?.type === "damageDealt" &&
          context.event.sourceId === context.sourceId
        );
      }

      case "enteredPlayFrom": {
        return (
          context.event?.type === "cardEnteredPlay" &&
          context.event.from === condition.zone
        );
      }

      case "damageIsBattle":
        return context.event?.type === "damageDealt" && !!context.event.battle;

      case "damageSourceIs": {
        if (context.event?.type !== "damageDealt") return false;
        const wanted = this.resolveTargetRef(condition.target, context);
        return !!wanted && context.event.sourceId === wanted;
      }

      case "cardMovedFromZone": {
        return (
          context.event?.type === "cardMoved" &&
          context.event.from === condition.zone
        );
      }

      case "cardMovedToZone": {
        return (
          context.event?.type === "cardMoved" &&
          context.event.to === condition.zone
        );
      }

      case "eventOrdinal": {
        const event = context.event;
        if (!event) return false;
        const key =
          "playerId" in event && event.playerId
            ? `${event.type}:${event.playerId}`
            : event.type;
        return compare(
          this.state.turnEventTally[key] ?? 0,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "deploySameNameThisTurn": {
        const player = this.resolvePlayerRef(condition.player ?? "controller", context);
        const names = (this.state.turnDeploys[player.id] ?? []).map(d => d.name);
        const counts = new Map<string, number>();
        let max = 0;
        for (const name of names) {
          const n = (counts.get(name) ?? 0) + 1;
          counts.set(name, n);
          if (n > max) max = n;
        }
        return compare(
          max,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "respondingTo": {
        if (condition.respondsTo === "ability") {
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (item.sourceId === context.sourceId) continue;
            if (item.kind !== "ability") return false;
            // "in response to a CHARACTER's ability": the ability's source
            // card must be of that type (SYS-45).
            return (
              !condition.cardType ||
              (!!this.state.cards[item.sourceId] &&
                this.hasCardType(item.sourceId, condition.cardType))
            );
          }
          return false;
        }
        const targetId = this.getRespondedToCardId(context);
        if (!targetId) return false;
        if (condition.viaFlipUp !== undefined) {
          // The newest unresolved stack item for that card.
          const item = [...this.responseStack]
            .reverse()
            .find(i => i.kind === "card" && i.sourceId === targetId);
          if ((item?.context.deployedViaFlipUp === true) !== condition.viaFlipUp) return false;
        }
        return (
          !condition.cardType ||
          this.hasCardType(targetId, condition.cardType)
        );
      }

      case "respondedToPicked": {
        const item = this.getRespondedToStackItem(context);
        if (!item) return false;
        return this.pickedCardOfType(item, condition.cardType) !== undefined;
      }

      case "pickableByRespondedTo": {
        const item = this.getRespondedToStackItem(context);
        const candidateId = context.selected.__candidate?.[0];
        if (!item || !candidateId) return false;
        const fromId = this.pickedCardOfType(item, condition.cardType);
        if (candidateId === fromId) return false;
        const selected = item.context.selected ?? {};
        const declaration = this.stackItemTargetDeclarations(item).find(d =>
          (selected[d.id] ?? []).includes(fromId ?? "")
        );
        // Picked some other way (an effect-time pick): no declaration to match.
        if (!declaration) return true;
        const itemContext: ResolutionContext = {
          ...item.context,
          sourceId: item.sourceId,
          controllerId: item.controllerId,
          selected: { ...selected }
        };
        return this.targetCandidates(declaration.selector, itemContext, item.controllerId)
          .some(c => c.id === candidateId);
      }

      case "deployedViaFlipUp": {
        return (
          context.deployedViaFlipUp === true ||
          (context.event?.type === "cardEnteredPlay" &&
            context.event.viaFlipUp === true)
        );
      }

      case "deployedAsResponse": {
        const cardId = this.resolveTargetRef(condition.target ?? "source", context);
        const card = cardId ? this.state.cards[cardId] : undefined;
        return card?.zone === "play" && card.deployedAsResponse === true;
      }

      case "cardNameEquals": {
        const a = this.resolveTargetRef(condition.target, context);
        const b = this.resolveTargetRef(condition.other, context);
        return (
          !!a &&
          !!b &&
          this.getDefinition(a).name === this.getDefinition(b).name
        );
      }

      case "cardNameIs": {
        const a = this.resolveTargetRef(condition.target, context);
        return !!a && this.getDefinition(a).name === condition.name;
      }

      case "bottomedInMulligan": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const ownerId = this.state.cards[cardId]?.ownerId;
        if (!ownerId) return false;
        return (this.state.mulligan[ownerId] ?? []).includes(cardId);
      }

      case "cardProvides": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId || !this.state.cards[cardId]) return false;
        const min = this.evaluateNumber(condition.min, context);
        const count = this.getResourceIcons(cardId).filter(
          icon => icon === condition.icon
        ).length;
        return count >= min;
      }

      case "isStaple": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId || !this.state.cards[cardId]) return false;
        return (
          !this.isFaceDownInPlay(cardId) &&
          isStapleResourceDefinition(this.getDefinition(cardId))
        );
      }

      case "cardDepleted": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && !!this.state.cards[cardId]?.depleted;
      }

      case "hasKeyword": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return (
          !!cardId &&
          this.state.cards[cardId]?.zone === "play" &&
          this.hasKeyword(cardId, condition.keyword)
        );
      }

      case "textMentionsIcon": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const token = ICON_TEXT_TOKEN[condition.icon];
        return printedText(this.getDefinition(cardId)).includes(token);
      }

      case "cardTypeEquals": {
        const a = this.resolveTargetRef(condition.target, context);
        const b = this.resolveTargetRef(condition.other, context);
        if (!a || !b) return false;
        // "a card of the same type as ..." — they share at least one type
        // (matters only if a `setCardType` grant has given one card an
        // extra type; normally each card has exactly one).
        const bTypes = new Set(this.getCardTypes(b));
        return this.getCardTypes(a).some(t => bTypes.has(t));
      }

      case "sharesBattlePartyWithSource": {
        const battle = this.state.battle;
        if (!battle) return false;
        const targetId = this.resolveTargetRef(condition.target, context);
        const sourceId = context.sourceId;
        if (!targetId) return false;
        const inAttack =
          battle.attackingParty.includes(targetId) &&
          battle.attackingParty.includes(sourceId);
        const inBlock =
          battle.blockingParty.includes(targetId) &&
          battle.blockingParty.includes(sourceId);
        return inAttack || inBlock;
      }

      case "linkedCardInPlay": {
        const linkedId =
          this.state.cards[context.sourceId]?.linkedTargets?.[condition.key];
        return !!linkedId && this.state.cards[linkedId]?.zone === "play";
      }

      case "sourceIsFaceDown": {
        return !!this.state.cards[context.sourceId]?.faceDown;
      }

      case "isExtremum": {
        const targetId = this.resolveTargetRef(condition.target, context);
        if (!targetId || !this.state.cards[targetId]) return false;

        const metricOf = (cardId: CardInstanceId): number =>
          condition.metric === "cost"
            ? this.getDefinition(cardId).cost ?? 0
            : this.getStat(cardId, condition.metric);

        const mine = metricOf(targetId);
        const pool = this.queryCards(condition.among, context);

        return !pool.some(other =>
          other.id !== targetId &&
          (condition.direction === "min"
            ? metricOf(other.id) < mine
            : metricOf(other.id) > mine)
        );
      }

      case "battleRole": {
        const battle = this.state.battle;
        if (!battle) {
          return false;
        }

        return condition.role === "attacker"
          ? battle.attackerPlayerId === context.controllerId
          : battle.defenderPlayerId === context.controllerId;
      }

      case "eventPlayerIs": {
        const event = context.event;

        if (!event || !("playerId" in event)) {
          return false;
        }

        return event.playerId === this.resolvePlayerRef(condition.player, context).id;
      }

      case "targetInSelection": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }

        return (context.selected[condition.selection] ?? []).includes(cardId);
      }

      case "isActivePlayer":
        return (
          this.resolvePlayerRef(condition.player ?? "controller", context).id ===
          this.state.activePlayerId
        );

      case "endOfTurnDeclared": {
        const playerId = this.resolvePlayerRef(condition.player ?? "controller", context).id;
        const continuation = this.state.responseWindow?.continuation;
        return (
          (continuation?.type === "endTurn" && continuation.playerId === playerId) ||
          this.state.battle?.resumeEndTurn?.playerId === playerId
        );
      }

      case "battleActive":
        return !!this.state.battle && this.state.battle.phase !== "finished";

      case "cardSubtypeIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }
        if (this.leftPlayFaceDown(cardId, context)) return false;
        return this.getSubtypes(cardId).includes(condition.subtype);
      }

      case "inPlaySinceTurnStart": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        const card = cardId ? this.state.cards[cardId] : undefined;
        return (
          !!card &&
          card.zone === "play" &&
          card.attackEligibleTurn === this.state.turn
        );
      }

      case "uniqueIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }
        const designation = this.getDefinition(cardId).unique;
        return !!designation && condition.designations.includes(designation);
      }

      case "assignedDamageThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && !!this.state.damageThisTurn[cardId]?.assigned;
      }

      case "lostInfluenceThisTurn": {
        const owner = this.resolvePlayerRef(condition.player, context).id;
        return (this.state.influenceLostThisTurn[owner] ?? 0) > 0;
      }

      case "inflictedDamageToFactionThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const owner = this.resolvePlayerRef(condition.player, context).id;
        return (
          this.state.damageThisTurn[cardId]?.toFactionOf.includes(owner) ?? false
        );
      }

      case "playerInflictedDamageToFactionThisTurn": {
        const victim = this.resolvePlayerRef(condition.player, context).id;
        const by = this.resolvePlayerRef(condition.by ?? "controller", context).id;
        return (
          this.state.factionDamageInflictedThisTurn[by]?.includes(victim) ??
          false
        );
      }

      case "hasAttachment": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        return Object.values(this.state.cards).some(
          c =>
            c.attachedTo === cardId &&
            c.zone === "play" &&
            (!condition.ofType || this.hasCardType(c.id, condition.ofType)) &&
            (!condition.ofSubtype ||
              this.getSubtypes(c.id).includes(condition.ofSubtype))
        );
      }

      case "isCard": {
        const a = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        const b = this.resolveTargetRef(condition.other ?? "source", context);
        return !!a && a === b;
      }

      case "damagedThisTurn": {
        const targetId = this.resolveTargetRef(condition.target, context);
        if (!targetId) return false;
        if (condition.by === "any") {
          return Object.values(this.state.damageThisTurn).some(rec =>
            rec.toCards.includes(targetId)
          );
        }
        const byId = this.resolveTargetRef(condition.by ?? "source", context);
        if (!byId) return false;
        return (
          this.state.damageThisTurn[byId]?.toCards.includes(targetId) ?? false
        );
      }

      case "attackedThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && (this.state.attacksThisTurn[cardId] ?? 0) > 0;
      }

      case "destroyedByBattleDamage": {
        if (context.event?.type !== "cardDestroyed") {
          // Replacement time ("would be destroyed by battle damage"): no
          // event exists yet; `destroyCard` records the pending instance.
          const pendingId = this.resolveTargetRef(condition.target ?? "source", context);
          return !!pendingId && this.destroyingByBattleDamage === pendingId;
        }
        const targetId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return (
          !!context.event.byBattleDamage &&
          (targetId === undefined || context.event.cardId === targetId)
        );
      }

      case "destroyedByDamage": {
        const targetId = this.resolveTargetRef(condition.target, context);
        if (!targetId) return false;
        if (this.destroyedByDamage.has(targetId)) return true;
        const card = this.state.cards[targetId];
        if (!card || card.zone !== "play") return false;
        const isChar = this.hasCardType(targetId, "character");
        const isLoc = this.hasCardType(targetId, "location");
        if (!isChar && !isLoc) return false;
        return card.damage >= this.getStat(targetId, isChar ? "life" : "structure");
      }

      case "destroyedByOpposing": {
        if (context.event?.type !== "cardDestroyed") return false;
        const targetId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return (
          context.event.causePlayerId !== undefined &&
          context.event.causePlayerId !== context.event.controllerId &&
          (targetId === undefined || context.event.cardId === targetId)
        );
      }

      case "meetsThreshold":
        return this.meetsParagraphThreshold(
          this.resolvePlayerRef(condition.player ?? "controller", context).id,
          condition.threshold
        );
    }
  }

  evaluateNumber(
    expression: NumberExpression,
    context: ResolutionContext
  ): number {
    if (typeof expression === "number") {
      return expression;
    }

    switch (expression.type) {
      case "opponentCountAtStart": {
        const playerId = this.resolvePlayerRef(expression.player ?? "controller", context).id;
        return this.state.startingOpponentCounts[playerId] ?? 0;
      }

      case "stat": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        // An unresolved target (a not-yet-picked declaration read from an
        // ability's `variables`, a card that has since left play) has no
        // stat — read as 0, like `battlePartySize` / `extremumStat`.
        if (!cardId) return 0;

        // The event card has left play: use what it had (last-known
        // information, CR 503.1). That includes "this card" when this card
        // is the event card ("When this card is destroyed, X is this card's
        // strength"), whose attachments have already followed it out.
        const lastKnown = this.lastKnownStats.get(cardId);
        if (
          (expression.target === "eventCard" ||
            cardId === this.getEventCardId(context.event)) &&
          lastKnown &&
          this.state.cards[cardId]?.zone !== "play" &&
          expression.stat in lastKnown
        ) {
          return lastKnown[expression.stat as keyof typeof lastKnown];
        }

        return this.getStat(cardId, expression.stat);
      }

      case "counter": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        if (!cardId) return 0;
        if (!this.state.cards[cardId] && !this.lastKnownCounters.has(cardId)) {
          return 0;
        }

        return this.counterCountFor(
          cardId,
          expression.counter
        );
      }

      case "count":
        return this.queryCards(
          expression.selector,
          context
        ).length;

      case "add":
        return expression.values.reduce<number>(
          (sum, value) =>
            sum + this.evaluateNumber(value, context),
          0
        );

      case "multiply":
        return expression.values.reduce<number>(
          (product, value) =>
            product * this.evaluateNumber(value, context),
          1
        );

      case "variable":
        return context.variables?.[expression.id] ?? 0;

      case "random": {
        const min = this.evaluateNumber(expression.min, context);
        const max = this.evaluateNumber(expression.max, context);
        return min + Math.floor(this.random() * (max - min + 1));
      }

      case "coinFlip": {
        // A real coin flip whose result is a number (Hammer Smash's X): recorded like any other flip.
        const flipper = this.resolvePlayerRef(expression.player ?? "controller", context);
        const won = this.random() < 0.5;
        this.emit({ type: "coinFlipped", playerId: flipper.id, won });
        return this.evaluateNumber(won ? expression.win : expression.lose, context);
      }

      case "cardCost": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId || !this.state.cards[cardId]) return 0;
        const costCard = this.state.cards[cardId];
        // While a card is being played its numeric cost is the running total (CR 406.3); a character in play
        // has its printed number plus what cards like Guileful Astucion gave it (CR 406.1, 101.1).
        if (costCard.zone === "deploying" && costCard.numericCostPaid !== undefined) {
          return costCard.numericCostPaid;
        }
        const printedCost = this.getDefinition(cardId).cost ?? 0;
        if (costCard.zone !== "play") return printedCost;
        return Math.max(
          0,
          this.state.numericCostModifiers.reduce(
            (sum, mod) => (mod.targetId === cardId ? sum + mod.delta : sum),
            printedCost
          )
        );
      }

      case "printedStat": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId || !this.state.cards[cardId]) return 0;
        return this.getDefinition(cardId)[expression.stat] ?? 0;
      }

      case "resourceIcons": {
        const player = this.resolvePlayerRef(expression.player, context);
        return this.getThresholds(player.id)[expression.icon] ?? 0;
      }

      case "divide": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return expression.rounding === "up"
          ? Math.ceil(value / by)
          : Math.floor(value / by);
      }

      case "modulo": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return ((value % by) + by) % by;
      }

      case "selectionCount": {
        return (context.selected[expression.id] ?? []).length;
      }

      case "opposingPartyStat": {
        const battle = this.state.battle;
        if (!battle) return 0;
        const mine = battle.participants.find(p => p.cardId === context.sourceId);
        if (!mine) return 0;
        const opposite: BattleSide = mine.side === "attacking" ? "blocking" : "attacking";
        const party = opposite === "attacking" ? battle.attackingParty : battle.blockingParty;
        let total = 0;
        const counted = new Set<CardInstanceId>();
        for (const id of party) {
          if (!this.isCardStillInBattle(id, battle)) continue;
          counted.add(id);
          total += this.getStat(id, expression.stat);
        }
        for (const [id, known] of Object.entries(battle.lastKnown ?? {})) {
          if (counted.has(id) || known.side !== opposite) continue;
          const value = (known as Record<string, unknown>)[expression.stat];
          if (typeof value === "number") total += value;
        }
        return total;
      }

      case "sumStat": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + this.getStat(card.id, expression.stat),
          0
        );
      }

      case "sumCounters": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + (card.counters?.[expression.counter] ?? 0),
          0
        );
      }

      case "sumCost": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + (this.getDefinition(card.id).cost ?? 0),
          0
        );
      }

      case "thresholdIconCount": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId) {
          return 0;
        }
        const threshold = this.getDefinition(cardId).threshold;
        if (typeof threshold === "number") {
          return threshold;
        }
        return (threshold ?? "").replace(/[^a-z]/gi, "").length;
      }

      case "eventDamageAmount": {
        return context.event?.type === "damageDealt"
          ? context.event.amount
          : 0;
      }

      case "eventDrawAmount": {
        return context.event?.type === "cardsDrawn"
          ? context.event.count
          : 0;
      }

      case "deploysThisTurn": {
        const wanted = expression.player
          ? [this.resolvePlayerRef(expression.player, context).id]
          : Object.keys(this.state.turnDeploys);
        let n = 0;
        for (const pid of wanted) {
          for (const d of this.state.turnDeploys[pid] ?? []) {
            if (expression.cardType && d.type !== expression.cardType) continue;
            if (expression.notCardType && d.type === expression.notCardType)
              continue;
            n++;
          }
        }
        return n;
      }

      case "factionStartingInfluence": {
        // The printed starting influence of the faction side currently face
        // up (CR 202.3a): a flipped faction card reads its other side.
        const player = this.resolvePlayerRef(expression.player, context);
        if (!player.factionId) return 0;
        return this.getDefinition(player.factionId).faction?.startingInfluence ?? 0;
      }

      case "destroyedThisTurn": {
        const wantedPlayer = expression.player
          ? this.resolvePlayerRef(expression.player, context).id
          : undefined;
        let n = 0;
        for (const d of this.state.turnDestroyed) {
          if (wantedPlayer !== undefined && d.controllerId !== wantedPlayer) continue;
          if (expression.cardType && !d.types.includes(expression.cardType)) continue;
          n++;
        }
        return n;
      }

      case "conditional": {
        return this.evaluateCondition(expression.if, context)
          ? this.evaluateNumber(expression.then, context)
          : this.evaluateNumber(expression.else, context);
      }

      case "battlePartySize": {
        const battle = this.state.battle;
        if (!battle) return 0;

        if (expression.controlledBy) {
          // A party belongs to the player who is attacking / defending.
          const partyOwner =
            expression.side === "attacking"
              ? battle.attackerPlayerId
              : expression.side === "blocking"
                ? battle.defenderPlayerId
                : undefined;
          if (partyOwner !== undefined) {
            const mine = partyOwner === context.controllerId;
            if (mine !== (expression.controlledBy === "self")) return 0;
          }
        }
        if (expression.side === "attacking") return battle.attackingParty.length;
        if (expression.side === "blocking") return battle.blockingParty.length;

        const ofId = this.resolveTargetRef(expression.of ?? "source", context);
        if (!ofId) return 0;
        const inAttacking = battle.attackingParty.includes(ofId);
        const inBlocking = battle.blockingParty.includes(ofId);
        if (!inAttacking && !inBlocking) return 0;

        const own = inAttacking ? battle.attackingParty : battle.blockingParty;
        const opposing = inAttacking ? battle.blockingParty : battle.attackingParty;
        return expression.side === "ownParty" ? own.length : opposing.length;
      }

      case "extremumStat": {
        const cards = this.queryCards(expression.selector, context);
        if (cards.length === 0) return 0;
        const values = cards.map(card => this.getStat(card.id, expression.stat));
        return expression.direction === "max"
          ? Math.max(...values)
          : Math.min(...values);
      }

      case "distinctCount": {
        const seen = new Set<string>();
        for (const card of this.queryCards(expression.selector, context)) {
          const def = this.getDefinition(card.id);
          if (expression.by === "subtype") {
            for (const s of this.getSubtypes(card.id)) seen.add(s.toLowerCase());
          } else if (expression.by === "trade") {
            // A face-down card has no trade or name (CR 411.1).
            if (def.trade && !this.isFaceDownInPlay(card.id)) {
              seen.add(def.trade.toLowerCase());
            }
          } else if (expression.by === "type") {
            seen.add(this.isFaceDownInPlay(card.id) ? "resource" : def.type);
          } else if (!this.isFaceDownInPlay(card.id)) {
            seen.add(def.name.toLowerCase());
          }
        }
        return seen.size;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  /**
   * Ids of the declarations a cost step takes as its own ("Deplete X characters you control"): such a pick is part
   * of paying the cost, so it cannot be left optional or short. Shared by `validateTargetDeclarations` and the
   * read-only `getPlayRequirements`.
   */
  private costBoundDeclarationIds(costs: readonly Cost[]): Set<string> {
    const costBound = new Set<string>();
    for (const cost of costs as ReadonlyArray<Record<string, unknown>>) {
      const ref = cost.declarationId ?? cost.id;
      if (
        typeof ref === "string" &&
        (cost.type === "depleteSelected" || cost.type === "sacrificeSelected")
      ) {
        costBound.add(ref);
      }
    }
    return costBound;
  }

  /**
   * The cards already picked under the `distinctPicks`-flagged declarations of one list ("Pick 2 characters",
   * authored as two single-pick declarations, means two DIFFERENT cards: Q20). `exceptId` leaves out one
   * declaration (the pick being offered, when a client asks which cards the siblings have used).
   */
  private distinctPickCards(
    declarations: readonly TargetDeclaration[],
    context: ResolutionContext,
    exceptId?: string
  ): CardInstanceId[] {
    return declarations
      .filter(d => d.distinctPicks && d.id !== exceptId)
      .flatMap(d => context.selected[d.id] ?? []);
  }

  /**
   * Q13 (`TargetDeclaration.impliedPick`): a card that prints no "pick" (Subordinate Demotivation: "destroy the
   * character ... with the lowest numeric cost") asks for no input unless there is a real choice. True when
   * `declaration` is such a pick and is still unanswered.
   */
  private impliedPickApplies(declaration: TargetDeclaration, context: ResolutionContext): boolean {
    if (!declaration.impliedPick) return false;
    if (declaration.optional || context.selected[declaration.id]?.length) return false;
    // Only "the one with the lowest/highest ..." style selections.
    return JSON.stringify(declaration.selector).includes('"isExtremum"');
  }

  /**
   * Fills in the implied picks (see `impliedPickApplies`): with no more candidates than the count, they are simply
   * the targets (none at all: the card resolves and does nothing). Writes them into `context.selected` and returns
   * the ids that need no input at all (no candidate).
   */
  private resolveImpliedPicks(declarations: readonly TargetDeclaration[], context: ResolutionContext): Set<string> {
    const noInputNeeded = new Set<string>();
    for (const declaration of declarations) {
      if (!this.impliedPickApplies(declaration, context)) continue;
      const count = this.evaluateNumber(declaration.count, context);
      const candidates = this.targetCandidates(declaration.selector, context);
      if (candidates.length === 0) noInputNeeded.add(declaration.id);
      if (candidates.length <= count) {
        context.selected = {
          ...context.selected,
          [declaration.id]: candidates.map(c => c.id)
        };
      }
    }
    return noInputNeeded;
  }

  /**
   * `TargetDeclaration.minCount` as the answer checks of the pending picks (`selectTargets`, `selectDeployTargets`,
   * `chooserSelectsTarget`) read it: the fewest a non-empty pick takes, floored at 0 (undefined: the declaration has
   * none). An OPTIONAL declaration with a floor also accepts an empty answer.
   */
  private declaredPickFloor(declaration: TargetDeclaration, context: ResolutionContext): number | undefined {
    if (declaration.minCount === undefined) return undefined;
    return Math.max(0, Math.floor(this.evaluateNumber(declaration.minCount, context)));
  }

  /**
   * How many cards a declaration takes: the most (its count, floored at 0: CR 410.4) and the fewest. An optional
   * pick may take none, unless it feeds a cost with a count that is an expression, or a "must be picked" card is a
   * legal pick while it takes any at all (Q19). `pickerId` is who picks (the controller, unless a chooser does).
   * The one rule behind `validateTargetDeclarations` and the min/max of `getPlayRequirements`.
   */
  private pickRange(
    declaration: TargetDeclaration,
    context: ResolutionContext,
    costBound: ReadonlySet<string>,
    noInputNeeded: ReadonlySet<string>,
    pickerId: PlayerId = context.controllerId
  ): { min: number; max: number; orNone?: true } {
    // A count an effect would push below 0 stays at 0 (CR 410.4).
    const max = Math.max(0, this.evaluateNumber(declaration.count, context));
    const mayBeEmpty =
      noInputNeeded.has(declaration.id) ||
      (declaration.optional === true && !(costBound.has(declaration.id) && typeof declaration.count !== "number"));
    let min = mayBeEmpty ? 0 : max;
    // `minCount`: a non-empty pick takes at least that many. An optional pick then is "none, or minCount..count"
    // (`orNone`); a mandatory one just has a lower floor than its count.
    let orNone = false;
    if (declaration.minCount !== undefined && !noInputNeeded.has(declaration.id)) {
      const floor = Math.min(max, Math.max(0, Math.floor(this.evaluateNumber(declaration.minCount, context))));
      orNone = mayBeEmpty && floor > 0;
      min = floor;
    }
    // "Anything that can pick this card must pick it": while such a card
    // is a legal pick, an optional pick still has to take it (Q19).
    if (
      (min === 0 || orNone) &&
      max >= 1 &&
      this.targetCandidates(declaration.selector, context, pickerId).some(c =>
        this.hasRestriction(c.id, "mustBePicked")
      )
    ) {
      min = Math.max(min, 1);
      orNone = false;
    }
    return orNone ? { min, max, orNone: true } : { min, max };
  }

  private validateTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext,
    costs: Cost[] = []
  ): void {
    // A pick that feeds a cost ("Deplete X characters you control") is part
    // of paying it, so it cannot be left optional or short.
    const costBound = this.costBoundDeclarationIds(costs);
    this.assertPicksDifferent(declarations, context);
    // A card that prints no "pick" (Subordinate Demotivation: "destroy the
    // character ... with the lowest numeric cost") asks for no input unless
    // there is a real choice: with no more candidates than the count, they
    // are simply the targets (none at all: the card resolves and does
    // nothing). Q13. (`TargetDeclaration.impliedPick`.)
    const noInputNeeded = this.resolveImpliedPicks(declarations, context);
    for (const declaration of declarations) {
      this.validateDeclarationPick(declaration, context, costBound, noInputNeeded);
    }
  }

  /** "Pick 2 characters ...", authored as two single-pick declarations, means two DIFFERENT cards (Q20). */
  private assertPicksDifferent(declarations: readonly TargetDeclaration[], context: ResolutionContext): void {
    if (declarations.length >= 2) {
      const chosen = this.distinctPickCards(declarations, context);
      assert(
        new Set(chosen).size === chosen.length,
        "Pick 2: the two picks must be different cards."
      );
    }
  }

  /**
   * One declaration's pick, judged: its count range, no card twice, only legal candidates, the card that must be
   * picked, distinct names / trades / types. The check behind `validateTargetDeclarations` and the read-only
   * `checkSelection`. `pickerId` is who picks (the controller, unless a chooser does).
   */
  private validateDeclarationPick(
    declaration: TargetDeclaration,
    context: ResolutionContext,
    costBound: ReadonlySet<string>,
    noInputNeeded: ReadonlySet<string>,
    pickerId: PlayerId = context.controllerId
  ): void {
    const selected =
      context.selected[declaration.id] ?? [];

    const { min, max, orNone } = this.pickRange(declaration, context, costBound, noInputNeeded, pickerId);

    assert(
      (orNone === true && selected.length === 0) || (selected.length >= min && selected.length <= max),
      `Target '${declaration.id}' requires ` +
        (orNone ? "none, or " : "") +
        (min === max ? `${max}` : `${min}-${max}`) +
        " selection(s)."
    );

    assert(
      new Set(selected).size === selected.length,
      `Target '${declaration.id}' selected the same card more than once.`
    );

    const legalPool = this.targetCandidates(
      declaration.selector,
      context,
      pickerId,
      max
    );
    const legal = new Set(legalPool.map(card => card.id));

    for (const selectedId of selected) {
      assert(
        legal.has(selectedId),
        `Illegal target '${selectedId}' for '${declaration.id}'.`
      );
    }
    this.assertMustBePicked(declaration.id, legalPool, selected, max);

    this.assertDistinctNames(declaration, selected);
    this.assertDistinctTrades(declaration, selected);
    this.assertDistinctTypes(declaration, selected);
  }

  /**
   * Emit a `cardPicked` event for every in-play card just chosen as a
   * target: of a `chooserSelectsTarget` effect ("you may pick a character.
   * If you do, ..."), of a played card's or activated ability's declared
   * targets (as the card is played / the ability used), and of a triggered
   * ability's `targets` (announced at the head of the trigger queue, so the
   * Ferret's token lands before the picking trigger's effect). "When this
   * card is picked, put a token on it" (Ferrous Ferret; SYS-19).
   */
  private emitCardPicked(
    selectedMap: Record<string, readonly CardInstanceId[]>,
    pickerId: PlayerId,
    onlyKeys?: string[]
  ): void {
    const keys = onlyKeys ?? Object.keys(selectedMap);
    for (const key of keys) {
      if (key === "__candidate") continue;
      for (const cardId of selectedMap[key] ?? []) {
        if (this.state.cards[cardId]?.zone === "play") {
          this.emit({ type: "cardPicked", cardId, playerId: pickerId });
        }
      }
    }
  }

  /**
   * Open (or re-open) a `spendCountersMenu` pending choice — snapshots the
   * current marker count on each pool card; if no option is affordable it
   * just resumes the suspended frames. (Voidal Poisoning.)
   */
  private openSpendCountersMenu(
    playerId: PlayerId,
    pool: CardSelector,
    counter: string,
    options: Array<{ cost: number; label?: string; effects: Effect[] }>,
    context: ResolutionContext
  ): void {
    const available: Record<CardInstanceId, number> = {};
    let total = 0;
    for (const card of this.queryCards(pool, context)) {
      const n = card.counters?.[counter] ?? 0;
      if (n > 0) {
        available[card.id] = n;
        total += n;
      }
    }
    const minCost = Math.min(...options.map(o => o.cost));
    if (total < minCost) {
      this.resumeEffectFrames();
      return;
    }
    this.state.pendingChoice = {
      kind: "spendCountersMenu",
      id: this.nextId("choice"),
      playerId,
      pool,
      counter,
      options,
      available,
      context
    };
  }

  /** "N cards with different names" — `TargetDeclaration.distinctNames`. */
  private assertDistinctNames(
    declaration: TargetDeclaration,
    selected: readonly CardInstanceId[]
  ): void {
    if (!declaration.distinctNames) return;
    const names = selected.map(id => this.getDefinition(id).name);
    assert(
      new Set(names).size === names.length,
      `Target '${declaration.id}' requires cards with different names.`
    );
  }

  /** "a location, item and/or character" (at most one of each kind) — `TargetDeclaration.distinctTypes`. */
  private assertDistinctTypes(
    declaration: TargetDeclaration,
    selected: readonly CardInstanceId[]
  ): void {
    if (!declaration.distinctTypes) return;
    const types = selected.map(id => this.getDefinition(id).type);
    assert(
      new Set(types).size === types.length,
      `Target '${declaration.id}' requires cards of different types.`
    );
  }

  /** "N characters that don't share a trade" — `TargetDeclaration.distinctTrades`. */
  private assertDistinctTrades(
    declaration: TargetDeclaration,
    selected: readonly CardInstanceId[]
  ): void {
    if (!declaration.distinctTrades) return;
    const trades = selected.map(id => this.getDefinition(id).trade);
    assert(
      new Set(trades).size === trades.length,
      `Target '${declaration.id}' requires cards that don't share a trade.`
    );
  }

  private autoSelectTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): void {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.targetCandidates(
        declaration.selector,
        context
      );

      // findUnresolvedTargetDeclarations already routes any optional
      // declaration with a legal candidate to a pendingChoice — reaching
      // here means it has none, i.e. an automatic decline.
      if (declaration.optional && candidates.length === 0) {
        context.selected[declaration.id] = [];
        continue;
      }

      // CR 402.5: a mandatory pick with nothing at all to pick can't be
      // carried out, so it is done as far as possible (not at all): the
      // trigger resolves with an empty pick instead of throwing mid-resolution
      // (Sin Against Nature put into play while its controller has no
      // resource).
      if (candidates.length === 0) {
        context.selected[declaration.id] = [];
        continue;
      }

      assert(
        candidates.length === this.evaluateNumber(declaration.count, context),
        `Triggered ability '${context.abilityId}' requires a choice for target '${declaration.id}'.`
      );

      context.selected[declaration.id] =
        candidates.map(card => card.id);
    }
  }

  /**
   * CR 402.5: a picked card that has since left the zone its declaration
   * named (a response destroyed / removed / bounced it) is a different object
   * now; an instruction that can't be carried out on it is ignored. True when
   * `ref` is a `selected` pick whose declaration names a zone the card is no
   * longer in, or a card type (CR 208.2) it no longer has.
   */
  private pickedCardMovedAway(
    ref: TargetRef,
    cardId: CardInstanceId,
    context: ResolutionContext
  ): boolean {
    if (typeof ref !== "object" || ref === null || ref.type !== "selected") {
      return false;
    }
    const startZone = context.pickZones?.[cardId];
    if (!startZone) return false;
    const declarations = this.pickDeclarations(context);
    // The declaration this card was picked under: by the ref's id, or (a
    // forEach candidate) by whichever declaration's picks include it.
    const decl =
      declarations.find(
        d => d.id === (ref as { id?: string }).id && context.selected[d.id]?.includes(cardId)
      ) ?? declarations.find(d => context.selected[d.id]?.includes(cardId));
    if (!decl) return false;
    // CR 208.2: a card that is no longer the type the declaration named is not affected.
    if (context.pickTypeLost?.[`${decl.id}:${cardId}`]) return true;
    const zone = decl.selector.zone;
    if (zone === "any") return false;
    const zones: Zone[] =
      zone === undefined ? ["play"] : Array.isArray(zone) ? zone : [zone];
    return !zones.includes(startZone);
  }

  /**
   * Whether `selector` explicitly opts into faction cards. A faction is
   * otherwise unpickable / unmatched (CR §202.9 / §402.9): either the
   * selector names `type: "faction"` directly, or one of its `conditions`
   * positively allows the faction type via a `cardTypeIs` check (the
   * "character or faction" `or`-group pattern — Bask Bile, Boorish Boar,
   * Prime Titan). A `cardTypeIs: "faction"` sitting under a `not` doesn't
   * count — that's an exclusion, and the faction was already dropped.
   */
  private selectorAdmitsFaction(selector: CardSelector): boolean {
    if (selector.type === "faction") return true;

    const positivelyNamesFaction = (
      condition: Condition,
      negated: boolean
    ): boolean => {
      switch (condition.type) {
        case "and":
        case "or":
          return condition.conditions.some(c =>
            positivelyNamesFaction(c, negated)
          );
        case "not":
          return positivelyNamesFaction(condition.condition, !negated);
        case "cardTypeIs":
          return !negated && condition.cardType === "faction";
        default:
          return false;
      }
    };

    return (selector.conditions ?? []).some(c =>
      positivelyNamesFaction(c, false)
    );
  }

  /**
   * Evaluate a selector's `owner` / `controller` value (SYS-6): "self" /
   * "opponent" / "any", or a PlayerRef object (`ownerOf` / `controllerOf` a
   * target: "the picked player's hand"). Returns the players the card may
   * belong to, or "any" for no restriction. "opponent" is the opponent the
   * block bound, or every opponent while none is bound (D4). An empty list —
   * a value that can't be evaluated (an unresolved ref or an unknown value)
   * — matches nothing rather than silently matching every card.
   */
  private selectorPlayerMatch(
    value: unknown,
    context: ResolutionContext
  ): PlayerId[] | "any" {
    if (value === "any") return "any";
    if (value === "self") return [context.controllerId];
    if (value === "opponent") return this.opponentIdsFor(context);
    if (value === "otherHero") {
      return heroesOf(this.state).filter(id => id !== context.controllerId && isLiving(this.state, id));
    }
    if (value && typeof value === "object") {
      try {
        return [this.resolvePlayerRef(value as PlayerRef, context).id];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * A selector's object-valued `owner` / `controller` (`ownerOf` a responded-to
   * card ...) depends on stack state that is gone by the time a pending pick
   * is validated, so bind it to the concrete player when the choice opens.
   */
  private freezeDeclarationPlayers<D extends { selector: CardSelector }>(
    declaration: D,
    context: ResolutionContext
  ): D {
    const sel = declaration.selector as unknown as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    for (const key of ["owner", "controller"]) {
      const v = sel[key];
      if (v && typeof v === "object") {
        const who = this.selectorPlayerMatch(v, context);
        out ??= { ...sel };
        out[key] = who !== "any" && who.length === 1 ? { type: "player", id: who[0] } : "__none__";
      }
    }
    return out
      ? { ...declaration, selector: out as unknown as CardSelector }
      : declaration;
  }

  private matchesSelector(
    card: CardInstance,
    selector: CardSelector,
    context: ResolutionContext
  ): boolean {
    if (selector.showdownPile) {
      const pile = selector.showdownPile === "heroDeck" ? this.state.showdown?.heroDeck : this.state.showdown?.temptationPile;
      if (!pile?.includes(card.id)) return false;
    }

    if (selector.controller) {
      const wanted = this.selectorPlayerMatch(selector.controller, context);
      if (wanted !== "any" && !wanted.includes(card.controllerId)) return false;
    }

    if (selector.owner) {
      // "A card in your hand/deck" is the holder's, which is the owner unless
      // a `toPlayer` put someone else's card there.
      const ownerId = this.zoneHolderId(card);
      const wanted = this.selectorPlayerMatch(selector.owner, context);
      if (wanted !== "any" && !wanted.includes(ownerId)) return false;
    }

    // CR §402.3 / §402.3a: a selector that doesn't name a game area affects
    // only the In-Play area ("pick a character" = a character in play). An
    // explicit `zone: "any"` opts a selector out of that default (used by
    // the few contexts that legitimately span zones — deployForFree,
    // cost modifiers, a chooser targeting a prior search result).
    if (selector.zone !== "any") {
      const zones: Zone[] =
        selector.zone === undefined
          ? ["play"]
          : Array.isArray(selector.zone)
            ? selector.zone
            : [selector.zone];

      if (!zones.includes(card.zone)) {
        return false;
      }
    }

    const definition = this.getDefinition(card.id);

    // CR §202.9 / §402.9 (RULES.md §3.6): a faction is unaffected by any
    // effect that doesn't name factions, and can never be *picked* unless
    // the selector explicitly admits factions — `type: "faction"` ("pick
    // an opponent", a faction-target damage modifier, "any one deck"), or
    // a `cardTypeIs: "faction"` in its `conditions` ("pick a character or
    // faction" — Bask Bile, Boorish Boar). Every generic selector — "pick
    // a non-resource card", "pick a character", a bare "pick a card" —
    // skips the faction card.
    if (
      this.hasCardType(card.id, "faction") &&
      !this.selectorAdmitsFaction(selector)
    ) {
      return false;
    }

    if (selector.faceDown !== undefined && card.faceDown !== selector.faceDown) {
      return false;
    }

    // CR 403.7b: a face-down card in the void is only ever picked or chosen
    // by a selector that expressly asks for a face-down card.
    if (selector.faceDown === undefined && card.faceDown && card.zone === "void") {
      return false;
    }

    // CR 411.1 / 203.4a: a face-down card in play has no name, no trade, no
    // unique designation and is not a staple - only a Volition resource.
    // A selector that expressly asks for a FACE-DOWN card ("a face-down
    // card with subtype gear", Gang Weapon Dealer) looks at its hidden front.
    const anonymous =
      selector.faceDown !== true && this.isFaceDownInPlay(card.id);

    if (
      selector.name !== undefined &&
      (anonymous || definition.name !== selector.name)
    ) {
      return false;
    }

    if (selector.voidedBySource && card.voidedBy !== context.sourceId) {
      return false;
    }

    if (selector.nameNotControlledBy !== undefined) {
      const wantedControl = selector.nameNotControlledBy;
      const taken = Object.values(this.state.cards).some(other => {
        if (other.zone !== "play" || this.isFaceDownInPlay(other.id)) return false;
        const sameSide = other.controllerId === context.controllerId;
        if (wantedControl === "self" && !sameSide) return false;
        if (wantedControl === "opponent" && sameSide) return false;
        return this.getDefinition(other.id).name === definition.name;
      });
      if (anonymous || taken) return false;
    }

    if (selector.nameVar !== undefined) {
      const named =
        this.state.cards[context.sourceId]?.namedValues?.[selector.nameVar];
      if (!named || anonymous || definition.name !== named) {
        return false;
      }
    }

    if (selector.uniqueDesignation !== undefined) {
      const want = Array.isArray(selector.uniqueDesignation)
        ? selector.uniqueDesignation
        : [selector.uniqueDesignation];
      if (anonymous || !definition.unique || !want.includes(definition.unique)) {
        return false;
      }
    }

    if (selector.type) {
      if (selector.type === "resource") {
        // A resource *card* is a resource in any zone; a face-down card is
        // an anonymous resource only while it's in play. (`isResource` is
        // deliberately play-only for icon/threshold math — a selector that
        // names `deck`/`hand`/`discard` still needs to reach real resource
        // cards there, e.g. "search your deck for a staple resource".)
        const isRes =
          definition.type === "resource" ||
          (card.faceDown && card.zone === "play");
        if (!isRes) return false;
      } else if (selector.faceDown === true) {
        // "a face-down tactic/item/… you control" — match on the card's
        // real (hidden) type, since a face-down card is otherwise an
        // anonymous resource.
        if (definition.type !== selector.type) return false;
      } else if (card.faceDown || !this.hasCardType(card.id, selector.type)) {
        return false;
      }
    }

    const subtypesOf = (id: CardInstanceId): string[] =>
      anonymous ? this.getSubtypes(id) : this.getSubtypesIncludingHidden(id);

    if (selector.subtypeVar) {
      const named = this.state.cards[context.sourceId]?.namedValues?.[
        selector.subtypeVar
      ];
      if (!named || !subtypesOf(card.id).includes(named)) {
        return false;
      }
    } else if (
      selector.subtype &&
      !subtypesOf(card.id).includes(selector.subtype)
    ) {
      return false;
    }

    if (selector.tradeVar) {
      const keys = Array.isArray(selector.tradeVar)
        ? selector.tradeVar
        : [selector.tradeVar];
      const named = this.state.cards[context.sourceId]?.namedValues ?? {};
      const wanted = keys
        .map(k => named[k]?.toLowerCase())
        .filter((v): v is string => !!v);
      if (anonymous || !wanted.includes(definition.trade.toLowerCase())) {
        return false;
      }
    }

    if (
      selector.depleted !== undefined &&
      card.depleted !== selector.depleted
    ) {
      return false;
    }

    if (selector.fromTop !== undefined) {
      const deck = this.state.players[this.zoneHolderId(card)]?.deck ?? [];
      const index = deck.indexOf(card.id);
      const depth =
        typeof selector.fromTop === "number"
          ? selector.fromTop
          : this.evaluateNumber(selector.fromTop, context);
      if (index < 0 || index >= depth) return false;
    }

    if (
      selector.staple !== undefined &&
      (!anonymous && isStapleResourceDefinition(definition)) !== selector.staple
    ) {
      return false;
    }

    if (selector.attachedToFaction !== undefined) {
      const host = card.attachedTo
        ? this.state.cards[card.attachedTo]
        : undefined;
      const attachedToFaction =
        !!host && this.getDefinition(host.id).type === "faction";
      if (attachedToFaction !== selector.attachedToFaction) {
        return false;
      }
    }

    if (
      selector.conditions &&
      !selector.conditions.every(condition =>
        this.evaluateCondition(condition, {
          ...context,
          selected: {
            ...context.selected,
            __candidate: [card.id]
          }
        })
      )
    ) {
      return false;
    }

    return true;
  }

  private resolveTargetRef(
    ref: TargetRef,
    context: ResolutionContext
  ): CardInstanceId | undefined {
    // A malformed/omitted TargetRef resolves to nothing rather than
    // crashing on a property read.
    if (ref === undefined || ref === null) {
      return undefined;
    }

    if (ref === "source") {
      return context.sourceId;
    }

    if (ref === "attachedTo") {
      return (
        this.state.cards[context.sourceId]?.attachedTo ??
        this.departedLinks.get(context.sourceId)?.attachedTo
      );
    }

    if (ref === "eventCard") {
      return this.getEventCardId(context.event);
    }

    // Bare-string aliases for the object TargetRefs below — some catalog
    // entries author `"target": "respondedToCard"` rather than
    // `{ "type": "respondedToCard" }`.
    if (ref === "respondedToCard") {
      return this.getRespondedToCardId(context);
    }

    if (ref === "respondedAbilitySource") {
      for (let i = this.responseStack.length - 1; i >= 0; i--) {
        const item = this.responseStack[i];
        if (item.kind === "ability" && item.sourceId !== context.sourceId) {
          return item.sourceId;
        }
      }
      return this.lastTerminatedAbility?.sourceId;
    }

    if (ref.type === "card") {
      return ref.id;
    }

    if (ref.type === "random") {
      const candidates = this.queryCards(ref.selector, context);
      if (candidates.length === 0) {
        return undefined;
      }
      return candidates[Math.floor(this.random() * candidates.length)].id;
    }

    if (ref.type === "deckPosition") {
      const deck = this.resolvePlayerRef(ref.player, context).deck;
      const index = ref.index ?? 0;
      return ref.from === "top"
        ? deck[index]
        : deck[deck.length - 1 - index];
    }

    if (ref.type === "respondedToCard") {
      return this.getRespondedToCardId(context);
    }

    if (ref.type === "respondedToPicked") {
      const remembered = context.resolvedPicked?.[ref.cardType];
      if (remembered) return remembered;
      const item = this.getRespondedToStackItem(context);
      return item ? this.pickedCardOfType(item, ref.cardType) : undefined;
    }

    if (ref.type === "factionOf") {
      return this.resolvePlayerRef(ref.player, context).factionId;
    }

    if (ref.type === "remembered") {
      return (
        this.state.cards[context.sourceId]?.linkedTargets?.[ref.key] ??
        this.departedLinks.get(context.sourceId)?.linkedTargets?.[ref.key]
      );
    }

    if (ref.type === "damageSource") {
      return context.event?.type === "damageDealt"
        ? context.event.sourceId
        : undefined;
    }

    if (ref.type === "lastDeployedTactic") {
      // The most recent tactic played this turn other than the card that is
      // asking (a tactic is "played" the moment it goes on the stack, and
      // "the last tactic played" is never the duplicate itself).
      const played = this.state.tacticsPlayedThisTurn ?? [];
      for (let i = played.length - 1; i >= 0; i--) {
        if (played[i] !== context.sourceId) return played[i];
      }
      return undefined;
    }

    if (ref.type === "attachmentHost") {
      const cardId = this.resolveTargetRef(ref.target, context);
      return cardId ? this.state.cards[cardId]?.attachedTo : undefined;
    }

    if (ref.type === "respondedAbilitySource") {
      for (let i = this.responseStack.length - 1; i >= 0; i--) {
        const item = this.responseStack[i];
        if (item.kind === "ability" && item.sourceId !== context.sourceId) {
          return item.sourceId;
        }
      }
      // "Terminate the ability. Destroy the character." — the ability was
      // just pulled off the stack; fall back to what `terminate` stashed.
      return this.lastTerminatedAbility?.sourceId;
    }

    return context.selected[ref.id]?.[0];
  }

  /**
   * The card currently being responded to — the newest `kind: "card"` item
   * on the response stack that isn't the current ability's own source.
   * `undefined` outside a response window / with nothing else on the stack.
   */
  private getRespondedToCardId(
    context: ResolutionContext
  ): CardInstanceId | undefined {
    // Once the responded-to card has been terminated (it just left the stack),
    // "the card" / "its owner" still mean THAT card, not whatever older card
    // is now at the top of a longer chain (Voidal Interference).
    if (this.lastTerminatedCard) return this.lastTerminatedCard;
    for (let i = this.responseStack.length - 1; i >= 0; i--) {
      const item = this.responseStack[i];
      if (item.kind === "card" && item.sourceId !== context.sourceId) {
        return item.sourceId;
      }
    }
    // "Terminate the card, then <act on its owner>." — it was just pulled
    // off the stack; fall back to what `terminate` stashed (Voidal
    // Interference), mirroring `respondedAbilitySource`.
    return this.lastTerminatedCard;
  }

  /**
   * The newest unresolved stack item that isn't the current ability's own
   * source — card OR ability. `getRespondedToCardId` is the `kind: "card"`
   * -only version; this one is for effects/conditions that must reach a
   * responded-to *ability* too (Mistaken Identity, Cock Block).
   */
  /** The extra-cost target declarations of the card or ability a stack item belongs to. */
  private stackItemTargetDeclarations(item: StackItem): TargetDeclaration[] {
    const def = this.getDefinition(item.sourceId);
    if (item.kind === "ability") {
      const ability = def.behavior?.abilities?.find(a => a.id === item.abilityId);
      return (ability as { targets?: TargetDeclaration[] } | undefined)?.targets ?? [];
    }
    const modes = def.behavior?.modes;
    if (modes && modes.length > 0) {
      return modes.flatMap((_, i) => this.getPlayTargetDeclarations(def, i));
    }
    return this.getPlayTargetDeclarations(def);
  }

  private getRespondedToStackItem(
    context: ResolutionContext
  ): StackItem | undefined {
    for (let i = this.responseStack.length - 1; i >= 0; i--) {
      const item = this.responseStack[i];
      if (item.sourceId !== context.sourceId) return item;
    }
    return undefined;
  }

  /**
   * Emits `cardsRevealed` for `cardIds`, one event per zone holder + zone
   * so a reveal spanning two decks stays legible. The event's `ownerId` is
   * the holder of the zone the cards are shown from (`zoneHolderId`): a card
   * sitting in a non-owner's hand or deck is revealed from that player's
   * zone. `shownFrom` names where the cards were shown from when that
   * differs from where they sit now (Auction House sets revealed cards aside
   * while the bidding runs). `knownToRevealer` says which of the cards the
   * revealing player already knew; an event is marked `knownToRevealer` only
   * when every card in it qualifies.
   */
  private emitReveal(
    cardIds: CardInstanceId[],
    viewerId: PlayerId | "all",
    byCardId?: CardInstanceId,
    shownFrom?: { zone: Zone; holderId: PlayerId },
    knownToRevealer?: (card: CardInstance) => boolean
  ): void {
    const groups = new Map<string, { ownerId: PlayerId; zone: Zone; cardIds: CardInstanceId[] }>();
    for (const cardId of cardIds) {
      const card = this.state.cards[cardId];
      if (!card) continue;
      const zone = shownFrom?.zone ?? card.zone;
      const holderId = shownFrom?.holderId ?? this.zoneHolderId(card);
      const key = `${holderId}:${zone}`;
      const group = groups.get(key) ?? { ownerId: holderId, zone, cardIds: [] };
      group.cardIds.push(cardId);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const known =
        knownToRevealer !== undefined &&
        group.cardIds.every(cardId => knownToRevealer(this.state.cards[cardId]));
      this.emit({
        type: "cardsRevealed",
        cardIds: group.cardIds,
        zone: group.zone,
        ownerId: group.ownerId,
        viewerId,
        byCardId,
        ...(known ? { knownToRevealer: true } : {})
      });
    }
  }

  /**
   * For a reveal of cards `playerId` picked or paid with — a search result,
   * a card from their own hand, their own face-down resource: they could
   * already see every card but another player's face-down card in play.
   */
  private pickedByRevealer(playerId: PlayerId): (card: CardInstance) => boolean {
    return card =>
      !(card.zone === "play" && card.faceDown) ||
      card.ownerId === playerId ||
      card.controllerId === playerId;
  }

  /** The other player in an in-flight MUSTACHE SHOWDOWN. */
  private partitionOpponent(
    pp: NonNullable<GameState["pendingPartition"]>,
    playerId: PlayerId
  ): PlayerId {
    return pp.order[0] === playerId ? pp.order[1] : pp.order[0];
  }

  /**
   * MUSTACHE SHOWDOWN resolution once both players have partitioned and
   * picked: compare the two chosen piles' total cost; if one is strictly
   * higher, pause for its owner to take up to `winnerTakes` of its cards
   * (`takeFromPile`); otherwise shuffle both decks and resume.
   */
  private settleMustacheShowdown(
    pp: NonNullable<GameState["pendingPartition"]>
  ): void {
    // Each player's chosen pile is the pile of THEIR cards that their
    // opponent selected.
    const chosenPile = (owner: PlayerId): CardInstanceId[] => {
      const picker = this.partitionOpponent(pp, owner);
      return pp.partitions[owner][pp.picks[picker]] ?? [];
    };
    const totalCost = (ids: CardInstanceId[]): number =>
      ids.reduce((sum, id) => sum + (this.getDefinition(id).cost ?? 0), 0);

    const [a, b] = pp.order;
    const costA = totalCost(chosenPile(a));
    const costB = totalCost(chosenPile(b));

    // "Reveal the chosen piles."
    for (const owner of pp.order) {
      // A pile is known to the player who split it, not to the one who picked it.
      this.emitReveal(
        chosenPile(owner),
        "all",
        pp.sourceId,
        undefined,
        card => card.ownerId === pp.controllerId
      );
    }

    if (costA !== costB) {
      const winner = costA > costB ? a : b;
      const winningPile = chosenPile(winner);
      this.state.pendingChoice = {
        kind: "takeFromPile",
        id: this.nextId("choice"),
        playerId: winner,
        candidates: [...winningPile],
        max: Math.min(pp.winnerTakes, winningPile.length)
      };
      return;
    }

    // "If one pile has a higher total ..." — a tie means nobody takes.
    this.state.pendingChoice = undefined;
    this.state.pendingPartition = undefined;
    for (const p of pp.order) {
      this.shuffleDeckOf(p);
    }
    this.resumeEffectFrames();
  }

  /**
   * The first id under `item.context.selected` that resolves to an in-play
   * card of `cardType` — "the <cardType> it picked as an extra cost". Used
   * by `respondedToPicked` / `retargetExtraCost` (Mistaken Identity).
   */
  private pickedCardOfType(
    item: StackItem,
    cardType: CardType,
    anyZone = false
  ): CardInstanceId | undefined {
    for (const ids of Object.values(item.context.selected ?? {})) {
      for (const id of ids) {
        const card = this.state.cards[id];
        if (card && (anyZone || card.zone === "play") && this.hasCardType(id, cardType)) {
          return id;
        }
      }
    }
    return undefined;
  }

  resolvePlayerRef(
    ref: PlayerRef,
    context: ResolutionContext
  ): PlayerState {
    if (ref === "controller") {
      return this.requirePlayer(context.controllerId);
    }

    if (ref === "owner") {
      return this.requirePlayer(
        this.requireCard(context.sourceId).ownerId
      );
    }

    if (ref === "activePlayer") {
      return this.requirePlayer(
        this.state.activePlayerId
      );
    }

    if (ref === "opponent") {
      return this.requirePlayer(this.soleOpponentFor(context));
    }

    if (ref === "villain") {
      const villainId = villainOf(this.state);
      assert(villainId !== undefined, "There is no Villain outside a Showdown game.");
      return this.requirePlayer(villainId);
    }

    if (ref.type === "ownerOf") {
      const cardId = this.resolveTargetRef(ref.target, context);
      assert(cardId, "Unable to resolve ownerOf target.");
      return this.requirePlayer(this.requireCard(cardId).ownerId);
    }

    if (ref.type === "controllerOf") {
      const cardId = this.resolveTargetRef(ref.target, context);
      assert(cardId, "Unable to resolve controllerOf target.");
      const target = this.requireCard(cardId);
      const known =
        target.zone !== "play" && target.zone !== "deploying"
          ? this.lastKnownController.get(cardId)
          : undefined;
      return this.requirePlayer(known ?? target.controllerId);
    }

    return this.requirePlayer(ref.id);
  }

  // ---------------------------------------------------------------------------
  // Costs
  // ---------------------------------------------------------------------------

  /**
   * True when the ability identified by `context` (its `sourceId` +
   * `abilityId`) has a `flipFaceUp` effect aimed at its own source and that
   * source is still a face-down resource in play — i.e. the "FLIP IT"
   * staple-resource cycle (Elitist Upgrade, Obsessive Concentration, Greedy
   * Profiteering, Deceptive Domain, Raging Ferocity).
   *
   * Such an ability's source is technically an unattached resource while its
   * `payResources` cost ("Reveal this card. Pay N.") is paid, but it's
   * committed to being flipped face-up by the ability's own EFFECT — it
   * can't *also* be spent as a generic resource to fund that cost. So it's
   * excluded from the payment pool: the "Pay N" must come from N *other*
   * resources, and the flip is offered/legal only when the player has them.
   * (FLIP UP sidesteps the same problem the other way — `flipUpCard` clears
   * `faceDown` before it pays, so the card is no longer a face-down resource
   * by the time its cost is settled.)
   */
  private abilityFlipsOwnSource(context: ResolutionContext): boolean {
    const sourceId = context.sourceId;
    if (!sourceId || !context.abilityId) return false;

    const source = this.state.cards[sourceId];
    if (!source || source.zone !== "play" || !source.faceDown) return false;

    const ability = this.getCardActivatedAbilities(sourceId).find(
      a => a.id === context.abilityId
    );
    return (ability?.effects ?? []).some(
      effect =>
        effect.type === "flipFaceUp" &&
        this.resolveTargetRef(effect.target, context) === sourceId
    );
  }

  /** Names an unaffordable "lose N influence" cost (SYS-26) instead of a bare "costs cannot be paid". */
  private assertInfluenceAffordable(
    costs: readonly Cost[],
    context: ResolutionContext
  ): void {
    for (const cost of costs) {
      if (cost.type !== "loseInfluence") continue;
      const player = this.resolvePlayerRef(cost.player ?? "controller", context);
      const amount = -this.modifiedInfluenceDelta(
        player.id,
        -this.evaluateNumber(cost.amount, context)
      );
      assert(
        player.influence >= amount,
        `Costs cannot be paid: losing ${amount} influence needs at least ${amount}, but the faction has only ${player.influence}.`
      );
    }
  }

  /**
   * Q2: the ability this effect belongs to declared an OPTIONAL deck search
   * ("you may search your deck for ...") and its pick was left empty while
   * the deck had a legal card — the player declined to search. (A search that
   * fails because nothing matches is a real search and still shuffles,
   * CR 312.2; that case has no legal candidate.)
   */
  private shuffleFollowsDeclinedSearch(context: ResolutionContext): boolean {
    const behavior = this.state.cards[context.sourceId]
      ? this.getDefinition(context.sourceId).behavior
      : undefined;
    if (!behavior) return false;
    const ability = context.abilityId
      ? (behavior.abilities ?? []).find(a => a.id === context.abilityId)
      : undefined;
    const declarations: TargetDeclaration[] = [
      ...((ability as { targets?: TargetDeclaration[] } | undefined)?.targets ??
        // A tactic (or a permanent's EXTRA COST) declares its searches at play time.
        (context.abilityId === undefined
          ? this.getPlayTargetDeclarations(this.getDefinition(context.sourceId))
          : []))
    ];
    for (const declaration of declarations) {
      if (
        declaration.optional &&
        this.selectorNamesZone(declaration.selector, "deck") &&
        (context.selected[declaration.id] ?? []).length === 0 &&
        context.selected[declinedKey(declaration.id)] !== undefined
      ) {
        return true;
      }
    }
    return false;
  }


  /** Re-runs a paused action with an answer merged in; a refused answer (nothing changed) leaves the question open. */
  private rerunPausedAction(pending: PendingChoice, action: GameAction): void {
    try {
      this.rerunAction(action);
    } catch (error) {
      if (!this.state.pendingChoice) this.state.pendingChoice = pending;
      throw error;
    }
  }

  /** Re-runs a player action whose payment was paused for a cost choice (see `bindCostChoices`). */
  private rerunAction(action: GameAction): void {
    this.beingDeployedId = undefined;
    // The play is its player's, even when another player's answer (a cost the opponent decides) re-runs it.
    if ("playerId" in action && action.playerId) {
      this.currentCause = action.playerId;
      this.currentCauseSourceId = undefined;
    }
    this.departedLinks.clear();
    this.faceDownDeparture.clear();
    switch (action.type) {
      case "playCard":
        this.playCard(action);
        return;
      case "activateAbility":
        this.activateAbility(action);
        return;
      case "flipUp":
        this.flipUpCard(action);
        return;
      default:
        throw new Error(`Cannot resume a paused ${action.type} action.`);
    }
  }

  /**
   * What other players (and the payer's division) already answered for the cost steps of the play being paused and
   * re-run (`otherPlayerChooses` / `distribute` / `alternatingPay`), keyed by the step's `answerKey`. Reset by every
   * action; the prompts carry it between questions, so a client's own action can never supply an answer.
   */
  private costAnswers: Record<string, CostAnswer> = {};

  /** The player action currently being paid for, so a cost choice can pause it and re-run it (see `bindCostChoices`). */
  private costResume?: GameAction;
  /** Set when `bindCostChoices` opened a prompt for a play-time cost choice (the play is paused, not made). */
  private costChoicePaused = false;

  private describeCostBranch(branch: Cost[]): string {
    return branch
      .map(cost => {
        if (cost.type === "payResources") {
          const amount = typeof cost.amount === "number" ? String(cost.amount) : "X";
          return `Pay ${amount}`;
        }
        if (cost.type === "destroy" && typeof cost.target === "object" && cost.target.type === "random") {
          const sel = cost.target.selector;
          return `Destroy ${sel.name ?? (Array.isArray(sel.subtype) ? sel.subtype[0] : sel.subtype) ?? sel.type ?? "a card"}`;
        }
        return cost.type;
      })
      .join(", ");
  }

  /**
   * A cost the PLAYER decides is a real prompt, not a random pick (SYS-54,
   * Q16): "Destroy a token / resource you control" (authored as a `destroy`
   * cost on a `random` target) asks the payer which card, and a `oneOf` cost
   * ("Pay 1 or destroy a token") asks which branch when more than one can be
   * paid. Choices already made ride in `context.selected` / `variables` (the
   * paused action is re-run with them merged in); a lone legal answer is
   * taken without asking. Returns the costs with every choice bound, or
   * `undefined` after opening the prompt (nothing has been paid or changed).
   * Without a paused action to resume (a cost paid from inside an effect)
   * the old auto behaviour stays.
   */
  private bindCostChoices(
    costs: Cost[],
    context: ResolutionContext,
    resume: GameAction | undefined,
    path = "",
    taken: Set<CardInstanceId> = new Set()
  ): Cost[] | undefined {
    if (!resume) {
      // A play made from inside an effect has no action to pause and re-run: it cannot ask for a name.
      for (const cost of costs) {
        assert(
          cost.type !== "nameValue" || context.named?.[cost.storeAs] !== undefined,
          "That card needs a value named as part of its cost, so it cannot be played from an effect."
        );
        assert(
          (cost.type !== "otherPlayerChooses" && cost.type !== "distribute" && cost.type !== "alternatingPay") ||
            (cost.answerKey !== undefined && this.costAnswers[cost.answerKey] !== undefined) ||
            (cost.type === "otherPlayerChooses" && !this.costStepNeedsAnswer(cost, context)),
          "That card's cost needs another player's decision, so it cannot be played from an effect."
        );
      }
      return costs;
    }
    const out: Cost[] = [];
    // Steps an earlier run of this paused play already paid for real are not asked about again.
    const paidAlready = path === "" ? this.costCommitted() : 0;
    for (let i = 0; i < costs.length; i++) {
      const cost = costs[i];
      const p = `${path}${i}`;
      if (i < paidAlready) {
        out.push(cost);
        continue;
      }
      if (cost.type === "oneOf" && cost.options.length > 1) {
        const key = `__oneOf${p}`;
        let branch = context.variables?.[key];
        if (branch === undefined) {
          // The payer already named a branch by supplying the pick only that
          // branch asks for ("discard a Rogue card" in `Pay 4 or discard a
          // Rogue card`): that is the branch they chose.
          const named = cost.options
            .map((b, j) =>
              b.some(c => {
                const id = (c as { id?: unknown }).id;
                return typeof id === "string" && (context.selected[id]?.length ?? 0) > 0;
              })
                ? j
                : -1
            )
            .filter(j => j >= 0);
          if (named.length === 1) branch = named[0];
        }
        if (branch === undefined) {
          const payable = cost.options
            .map((b, j) => (this.canPayCosts(b, context) ? j : -1))
            .filter(j => j >= 0);
          if (payable.length === 0) {
            out.push(cost);
            continue;
          }
          if (payable.length === 1) {
            branch = payable[0];
          } else {
            this.state.pendingChoice = {
              kind: "chooserSelectsOption",
              id: this.nextId("choice"),
              playerId: context.controllerId,
              optionCount: cost.options.length,
              options: cost.options.map((b, j) => ({
                label: cost.labels?.[j] ?? this.describeCostBranch(b),
                effects: []
              })),
              context,
              style: "costBranch",
              resumeAction: resume,
              resumeVariable: key
            };
            this.costChoicePaused = true;
            return undefined;
          }
        }
        assert(
          Number.isInteger(branch) && branch >= 0 && branch < cost.options.length,
          "Invalid cost option."
        );
        assert(this.canPayCosts(cost.options[branch], context), "That cost option cannot be paid.");
        const bound = this.bindCostChoices(cost.options[branch], context, resume, `${p}.${branch}.`, taken);
        if (!bound) return undefined;
        out.push({ type: "oneOf", options: [bound] });
        continue;
      }
      if (cost.type === "nameValue") {
        // "Name a card." in the COST: the payer names it now, before anything is paid.
        if (context.named?.[cost.storeAs] === undefined) {
          this.state.pendingChoice = {
            kind: "nameValue",
            id: this.nextId("choice"),
            playerId: context.controllerId,
            valueKind: cost.valueKind,
            ...(cost.exclude ? { exclude: cost.exclude } : {}),
            ...(cost.nonResource ? { nonResource: true } : {}),
            ...this.nameOptionsField(cost.valueKind, cost.exclude),
            sourceId: context.sourceId,
            storeAs: cost.storeAs,
            resumeAction: resume
          };
          this.costChoicePaused = true;
          return undefined;
        }
        out.push(cost);
        continue;
      }
      if (cost.type === "destroy" && typeof cost.target === "object" && cost.target.type === "random") {
        const key = `__costDestroy${p}`;
        const selector = { zone: "play" as const, ...cost.target.selector };
        const candidates = this.queryCards(selector, context)
          .map(c => c.id)
          .filter(id => !taken.has(id));
        let picked = context.selected[key]?.[0];
        if (picked === undefined) {
          if (candidates.length === 0) {
            out.push(cost);
            continue;
          }
          if (candidates.length === 1) {
            picked = candidates[0];
          } else {
            this.state.pendingChoice = {
              kind: "chooserSelectsTarget",
              id: this.nextId("choice"),
              playerId: context.controllerId,
              declaration: { id: key, selector, count: 1, optional: false },
              effects: [],
              context,
              resumeAction: resume
            };
            this.costChoicePaused = true;
            return undefined;
          }
        }
        assert(candidates.includes(picked), "That card cannot be destroyed to pay this cost.");
        taken.add(picked);
        context.selected = { ...context.selected, [key]: [picked] };
        out.push({ type: "destroy", target: { type: "selected", id: key } });
        continue;
      }
      out.push(cost);
    }
    return out;
  }

  /** True when an `otherPlayerChooses` step still has a question to put to its chooser (a `may`, or a pick with something to pick). */
  private costStepNeedsAnswer(
    cost: Extract<Cost, { type: "otherPlayerChooses" }>,
    context: ResolutionContext
  ): boolean {
    if (cost.answerKey !== undefined && this.costAnswers[cost.answerKey] !== undefined) return false;
    const declaration = cost.declaration;
    if (!declaration) return true;
    const requested = Math.max(0, this.evaluateNumber(declaration.count, context));
    if (requested === 0) return false;
    const chooser = this.resolvePlayerRef(cost.chooser, context);
    return this.targetCandidates(declaration.selector, context, chooser.id, requested).length > 0;
  }

  /** Per-card ceilings on a `distribute` cost's shares (`maxShare` evaluated for each card), if the step has any. */
  private distributeCaps(
    cost: Extract<Cost, { type: "distribute" }>,
    targets: readonly CardInstanceId[],
    context: ResolutionContext
  ): Record<CardInstanceId, number> | undefined {
    const maxShare = cost.maxShare;
    if (!maxShare) return undefined;
    return Object.fromEntries(
      targets.map(id => [
        id,
        Math.max(0, this.evaluateNumber(maxShare, { ...context, selected: { ...context.selected, __candidate: [id] } }))
      ])
    );
  }

  /** Whether `decider` can still pay one round of an `alternatingPay` loop, keeping `reserve` resources back for the rest of the play's cost. */
  private alternatingPayCanPay(
    cost: readonly Cost[],
    decider: PlayerId,
    context: ResolutionContext,
    reserve: Record<PlayerId, number> | undefined
  ): boolean {
    const deciderContext: ResolutionContext = { ...context, controllerId: decider };
    if (!this.canPayCosts([...cost], deciderContext)) return false;
    let numeric = 0;
    for (const step of cost) {
      if (step.type === "payResources") numeric += Math.max(0, this.evaluateNumber(step.amount, deciderContext));
    }
    return this.getAvailableResourceCount(decider) - numeric >= (reserve?.[decider] ?? 0);
  }

  /**
   * CR 406.3a / 604.1d: the numeric ("pay N") cost is always paid LAST, after every other cost step (SYS-23: a
   * resource destroyed as a cost cannot also count toward N). The steps keep their written order; only the
   * top-level `payResources` steps move to the end. Idempotent.
   */
  private orderCosts(costs: readonly Cost[]): Cost[] {
    return [
      ...costs.filter(cost => cost.type !== "payResources"),
      ...costs.filter(cost => cost.type === "payResources")
    ];
  }

  /** Ids of the declarations a `pick` cost step positions in the written cost order (they are not validated up front). */
  private pickStepIds(costs: readonly Cost[]): Set<string> {
    const ids = new Set<string>();
    for (const cost of costs) {
      if (cost.type === "pick") ids.add(cost.declarationId);
    }
    return ids;
  }

  /** The declarations validated before any cost is paid: every one that has no `pick` cost step. */
  private upFrontDeclarations(
    declarations: readonly TargetDeclaration[],
    costs: readonly Cost[]
  ): TargetDeclaration[] {
    const ordered = this.pickStepIds(costs);
    return declarations.filter(declaration => !ordered.has(declaration.id));
  }

  /** Hands each `pick` cost step its declaration, so the step can validate the pick wherever the cost is paid (also on a clone). */
  private withPickDeclarations(
    costs: readonly Cost[],
    declarations: readonly TargetDeclaration[]
  ): Cost[] {
    let asked = 0;
    return costs.map(cost => {
      // A step another player (or a division) answers gets its slot in the paused play's answers.
      if (
        cost.type === "otherPlayerChooses" ||
        cost.type === "distribute" ||
        cost.type === "alternatingPay"
      ) {
        return { ...cost, answerKey: `__ask${asked++}` };
      }
      if (cost.type !== "pick") return cost;
      const declaration = declarations.find(d => d.id === cost.declarationId);
      assert(
        declaration,
        `Cost step 'pick' names '${cost.declarationId}', which is not one of this card's target declarations.`
      );
      const consumed = costs.some(other => {
        const ref = (other as { declarationId?: string }).declarationId;
        return (
          ref === declaration.id &&
          (other.type === "depleteSelected" || other.type === "sacrificeSelected")
        );
      });
      return { ...cost, declaration, costBound: consumed };
    });
  }

  /** The actual resource card (one that may go in either way up) a FLIP UP line's cost steps play, if any. */
  private riderPlayedResource(
    effects: readonly Effect[],
    context: ResolutionContext
  ): CardInstanceId | undefined {
    const find = (list: readonly Effect[]): CardInstanceId | undefined => {
      for (const effect of list) {
        if (
          effect.type === "playResource" &&
          typeof effect.target === "object" &&
          effect.target.type === "selected" &&
          (effect.faceDown ?? "auto") === "auto"
        ) {
          const id = context.selected[effect.target.id]?.[0];
          const def = id && this.state.cards[id] ? this.getDefinition(id) : undefined;
          if (def && def.type === "resource" && def.resource?.faceDownOnly !== true) return id;
        }
        const inner = (effect as { effects?: Effect[] }).effects;
        const found = inner ? find(inner) : undefined;
        if (found) return found;
      }
      return undefined;
    };
    return find(effects);
  }

  /** Refuses a name that cannot be named for a `nameValue` effect / cost step (a bad icon or trade, an excluded value, a non-card). */
  private assertNameable(
    valueKind: "subtype" | "cardName" | "resourceIcon" | "trade",
    value: unknown,
    exclude?: readonly string[],
    nonResource?: boolean
  ): asserts value is string {
    assert(typeof value === "string" && value.length > 0, "A non-empty value must be named.");
    assert(
      valueKind !== "resourceIcon" || NAMEABLE_ICONS.includes(value),
      "A resource icon must be named."
    );
    assert(
      !exclude?.some(excluded => excluded.toLowerCase() === value.toLowerCase()),
      `'${value}' cannot be named.`
    );
    if (valueKind === "cardName" && nonResource && this.cardCatalog) {
      // "Name a non-resource card": the name has to belong to a real card
      // that is not a resource (checked only when a catalog was supplied).
      const wanted = value.trim().toLowerCase();
      assert(
        this.cardCatalog.some(
          entry => entry.name.toLowerCase() === wanted && entry.cardType !== "resource"
        ),
        `'${value}' is not the name of a non-resource card.`
      );
    }
    assert(
      valueKind !== "trade" || NAMEABLE_TRADES.includes(value.toLowerCase()),
      "A trade must be named."
    );
  }

  /** A throw-away copy of the game that shares nothing with this one: payments are rehearsed on it. */
  private cloneForProbe(): SpoilsEngine {
    // Drop `gameLog` before the deep clone — the probe never appends to it
    // and it grows unbounded over a game.
    const clone = structuredClone({ ...this.state, gameLog: [] });
    // The clone draws from its own copy of rngState, so a rehearsal can never advance the real game's
    // stream. A caller-supplied random function (a scripted test stream) is shared state we cannot copy:
    // the rehearsal gets a fixed one, so it never eats the values the real payment is about to draw.
    // The definitions are already normalized (`withBuiltInFactionDefaults`, idempotent), so copy the map instead of
    // re-normalizing every catalog entry for each rehearsal. A fresh map: a token minted on the probe stays on it.
    const engine = new SpoilsEngine([], clone, this.randomOverride ? () => 0.5 : undefined);
    Object.assign(engine.definitions, this.definitions);
    engine.dryRun = true;
    engine.beingDeployedId = this.beingDeployedId;
    engine.payWith = this.payWith && { ...this.payWith, ids: [...this.payWith.ids] };
    engine.costAnswers = structuredClone(this.costAnswers);
    engine.cardCatalog = this.cardCatalog;
    return engine;
  }

  /**
   * Rehearses paying `costs` in order on a clone (so a multi-step payment is
   * all-or-nothing), including the `pick` / `bindVariable` / `effects` /
   * `nameValue` steps. Returns the reason it cannot be paid, or `undefined`.
   * The rehearsal gets its own copy of the context: values the steps bind
   * (`variables`) never leak into the real play.
   */
  private costProblem(
    costs: Cost[],
    context: ResolutionContext,
    /** Steps (in the ordered list) an earlier run of this paused play already paid for real. */
    skip = 0
  ): Error | undefined {
    const engine = this.cloneForProbe();
    const rehearsal: ResolutionContext = {
      ...context,
      selected: { ...context.selected },
      variables: { ...(context.variables ?? {}) },
      ...(context.named ? { named: { ...context.named } } : {})
    };
    try {
      return engine.rehearseSteps(this.orderCosts(costs).slice(skip), rehearsal);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Pays `steps` in order on this (throw-away) engine. A mandatory single pick that ANOTHER player will make
   * (`otherPlayerChooses`), not yet answered, is tried with each legal card: the play is payable if some answer
   * leaves the rest payable (otherwise the chooser could be left with no legal answer after the steps before it
   * were paid). Returns the last reason it cannot be paid, or undefined.
   */
  private rehearseSteps(steps: readonly Cost[], context: ResolutionContext): Error | undefined {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (
        step.type === "otherPlayerChooses" &&
        step.declaration &&
        !step.declaration.optional &&
        step.answerKey !== undefined &&
        this.costAnswers[step.answerKey] === undefined &&
        Math.max(0, this.evaluateNumber(step.declaration.count, context)) === 1
      ) {
        const chooser = this.resolvePlayerRef(step.chooser, context);
        const candidates = this.targetCandidates(step.declaration.selector, context, chooser.id, 1);
        if (candidates.length > 0) {
          let last: Error | undefined;
          for (const candidate of candidates) {
            const probe = this.cloneForProbe();
            probe.costAnswers = { ...probe.costAnswers, [step.answerKey]: { ids: [candidate.id] } };
            const branch: ResolutionContext = {
              ...context,
              selected: { ...context.selected },
              variables: { ...(context.variables ?? {}) },
              ...(context.named ? { named: { ...context.named } } : {})
            };
            try {
              const problem = probe.rehearseSteps(steps.slice(i), branch);
              if (!problem) return undefined;
              last = problem;
            } catch (error) {
              last = error instanceof Error ? error : new Error(String(error));
            }
          }
          return last;
        }
      }
      this.payCost(step, context, false);
    }
    return undefined;
  }

  private canPayCosts(
    costs: Cost[],
    context: ResolutionContext
  ): boolean {
    return this.costProblem(costs, context) === undefined;
  }

  /** Refuses the play if `costs` cannot be paid: a `pick` / `nameValue` step gives its own reason, anything else `message`. */
  private assertCostsPayable(
    costs: Cost[],
    context: ResolutionContext,
    message: string
  ): void {
    const problem = this.costProblem(costs, context, this.costCommitted());
    if (!problem) return;
    throw problem instanceof CostRefusal ? new Error(problem.message) : new Error(message);
  }

  /**
   * Pays the steps in order. Given the paused-able action (`resume`, a play or an ability use), a step that needs
   * ANOTHER player's decision (`otherPlayerChooses`), a division (`distribute`) or a pay loop (`alternatingPay`)
   * stops the payment where it stands: the steps written before it are paid (a Trinket is already depleted when
   * its opponent chooses), the question is put to its chooser with `resume` as the action to re-run, and the
   * re-run skips the steps already paid (`costCommitted`). Returns true when it stopped to ask.
   */
  private payCosts(
    costs: Cost[],
    context: ResolutionContext,
    resume?: GameAction
  ): boolean {
    const ordered = this.orderCosts(costs);
    // CR 503.3: a trigger caused by paying a cost step waits until every cost is satisfied, then the triggers
    // of the whole payment happen together as one batch (CR 604.1f, 606.1e). A payment that stops to ask a
    // question leaves them queued for the re-run; an illegal payment terminates them (CR 604.1e, 606.1d).
    const queuedBefore = new Set(this.immediateQueue);
    const mine = (): TriggerResolution[] => this.immediateQueue.filter(queued => !queuedBefore.has(queued));
    this.beginEventBatch();
    try {
      for (let i = resume ? this.costCommitted() : 0; i < ordered.length; i++) {
        if (resume && this.openCostQuestion(ordered, i, context, resume)) {
          this.eventBatchDepth--;
          return true;
        }
        this.payCost(ordered[i], context, true);
      }
    } catch (error) {
      this.eventBatchDepth--;
      for (const queued of mine()) this.immediateQueue.splice(this.immediateQueue.indexOf(queued), 1);
      throw error;
    }
    const paymentBatchId = this.nextId("batch");
    for (const queued of mine()) queued.batchId = paymentBatchId;
    this.endEventBatch();
    if (resume) this.costAnswers = {};
    return false;
  }

  /** How many steps of the paused play's ordered cost list were already paid by an earlier run of it. */
  private costCommitted(): number {
    return this.costAnswers[COST_COMMITTED_KEY]?.committed ?? 0;
  }

  /**
   * Puts the question of cost step `index` to the player who answers it, if it has one: an `otherPlayerChooses`
   * step with something to pick (or a `may`), a `distribute` step with an amount to divide, an `alternatingPay`
   * loop. Sets `pendingChoice` (carrying `resumeAction`, the answers so far and how many steps are paid) and
   * returns true; false when the step needs no answer (already given, or nothing to decide).
   */
  private openCostQuestion(
    ordered: readonly Cost[],
    index: number,
    context: ResolutionContext,
    resume: GameAction
  ): boolean {
    const cost = ordered[index];
    const carried = (): Record<string, CostAnswer> => ({
      ...structuredClone(this.costAnswers),
      [COST_COMMITTED_KEY]: { committed: index }
    });
    if (cost.type === "otherPlayerChooses") {
      if (!this.costStepNeedsAnswer(cost, context)) return false;
      const key = cost.answerKey as string;
      const chooser = this.resolvePlayerRef(cost.chooser, context);
      if (cost.declaration) {
        this.state.pendingChoice = {
          kind: "chooserSelectsTarget",
          id: this.nextId("choice"),
          playerId: chooser.id,
          declaration: this.freezeDeclarationPlayers(cost.declaration, context),
          effects: [],
          context,
          resumeAction: resume,
          costStepKey: key,
          costAnswers: carried()
        };
      } else {
        this.state.pendingChoice = {
          kind: "chooserSelectsOption",
          id: this.nextId("choice"),
          playerId: chooser.id,
          optionCount: 2,
          options: [
            { label: "Decline", effects: [] },
            { label: "Yes", effects: [] }
          ],
          style: "yesNo",
          context,
          resumeAction: resume,
          costStepKey: key,
          costAnswers: carried()
        };
      }
      this.costChoicePaused = true;
      return true;
    }
    if (cost.type === "distribute") {
      // "Remove X tokens from cards you control": the payer divides the X among the cards.
      const key = cost.answerKey as string;
      const targets = context.selected[cost.selected] ?? [];
      const amount = Math.max(0, this.evaluateNumber(cost.amount, context));
      if (this.costAnswers[key]?.shares !== undefined || amount <= 0 || targets.length === 0) return false;
      this.state.pendingChoice = {
        kind: "distributeAmong",
        id: this.nextId("choice"),
        playerId: context.controllerId,
        targets: [...targets],
        amount,
        caps: this.distributeCaps(cost, targets, context),
        effects: [],
        context,
        resumeAction: resume,
        costStepKey: key,
        costAnswers: carried()
      };
      this.costChoicePaused = true;
      return true;
    }
    if (cost.type === "alternatingPay") {
      const key = cost.answerKey as string;
      if (this.costAnswers[key]?.tallies !== undefined) return false;
      const first = this.resolvePlayerRef(cost.first, context).id;
      const second = this.resolvePlayerRef(cost.opponent, context).id;
      // The card's own numeric cost is paid last, so the caster must keep that many resources back.
      const reserve: Record<PlayerId, number> = { [first]: 0, [second]: 0 };
      for (const other of ordered) {
        if (other.type === "payResources") {
          reserve[context.controllerId] =
            (reserve[context.controllerId] ?? 0) + Math.max(0, this.evaluateNumber(other.amount, context));
        }
      }
      if (!this.alternatingPayCanPay(cost.cost, first, context, reserve)) {
        // The first player cannot pay even once: the loop ends before it starts.
        this.costAnswers = { ...this.costAnswers, [key]: { tallies: [0, 0] } };
        return false;
      }
      this.state.pendingChoice = {
        kind: "alternatingPay",
        id: this.nextId("choice"),
        playerId: first,
        players: [first, second],
        turnIndex: 0,
        cost: structuredClone(cost.cost),
        roundsLeft: (cost.maxRounds ?? 20) * 2,
        tallies: { [first]: 0, [second]: 0 },
        onEnd: [],
        context,
        resumeAction: resume,
        costStepKey: key,
        costAnswers: carried(),
        reserve
      };
      this.costChoicePaused = true;
      return true;
    }
    return false;
  }

  private payCost(
    cost: Cost,
    context: ResolutionContext,
    emitEvents: boolean
  ): void {
    // CR §506.2: replacements never apply to something happening as part of
    // an extra cost — a card destroyed / discarded / removed as a cost is
    // really gone, its own "if this would be destroyed …" replacement
    // notwithstanding. (A replacement on a card *attached* to it still
    // applies — CR §506.2a — but that's handled when the attachment's own
    // leave-play is processed, not here.)
    switch (cost.type) {
      case "pick": {
        // A pick positioned in the written cost order (Q15, SYS-16): judged against the board as it is NOW,
        // after the cost steps written before it.
        const declaration = cost.declaration;
        assert(declaration, `Cost step 'pick' for '${cost.declarationId}' was not bound to its declaration.`);
        try {
          this.validateTargetDeclarations(
            [declaration],
            context,
            cost.costBound ? [{ type: "depleteSelected", declarationId: declaration.id }] : []
          );
        } catch (error) {
          throw new CostRefusal(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      case "bindVariable": {
        // "X is its strength." (Q8): locked into the play's variables as the cost is paid.
        context.variables = {
          ...(context.variables ?? {}),
          [cost.id]: this.evaluateNumber(cost.value, context)
        };
        return;
      }

      case "effects": {
        const faceBefore = context.resourceFaceDown;
        if (cost.resourceFaceDown !== undefined) context.resourceFaceDown = cost.resourceFaceDown;
        this.costEffectDepth++;
        try {
          for (const effect of cost.effects) {
            this.resolveEffect(effect, context);
            if (!cost.allowPending && this.state.pendingChoice) {
              throw new CostRefusal(
                "A cost step cannot ask anybody a question; use a typed cost step for a choice."
              );
            }
          }
        } finally {
          this.costEffectDepth--;
          context.resourceFaceDown = faceBefore;
        }
        return;
      }

      case "nameValue": {
        const value = context.named?.[cost.storeAs];
        // The prompt for a missing name is raised before anything is paid (`bindCostChoices`).
        if (value === undefined) {
          assert(this.dryRun, `A value must be named for '${cost.storeAs}'.`);
          return;
        }
        try {
          this.assertNameable(cost.valueKind, value, cost.exclude, cost.nonResource);
        } catch (error) {
          throw new CostRefusal(error instanceof Error ? error.message : String(error));
        }
        const source = this.state.cards[context.sourceId];
        if (source) (source.namedValues ??= {})[cost.storeAs] = value;
        return;
      }

      case "otherPlayerChooses": {
        // A cost another player decides (E3c). The question was put to them before anything was paid
        // (`bindCostChoices`); their answer is in `costAnswers`, never in the action.
        const key = cost.answerKey;
        assert(key, "That card's cost needs another player's decision, so it cannot be played from an effect.");
        const answer = this.costAnswers[key];
        const declaration = cost.declaration;
        let picked: CardInstanceId[] | undefined;
        if (declaration) {
          const chooser = this.resolvePlayerRef(cost.chooser, context);
          const requested = Math.max(0, this.evaluateNumber(declaration.count, context));
          const candidates = this.targetCandidates(declaration.selector, context, chooser.id, requested).map(
            card => card.id
          );
          if (answer?.ids !== undefined) {
            const ids = answer.ids;
            const legal = new Set(candidates);
            const needed = declaration.optional ? 0 : Math.min(requested, candidates.length);
            if (
              ids.length < needed ||
              ids.length > requested ||
              new Set(ids).size !== ids.length ||
              ids.some(id => !legal.has(id))
            ) {
              throw new CostRefusal(`The pick for '${declaration.id}' is not legal any more.`);
            }
            picked = ids;
          } else if (requested === 0 || candidates.length === 0) {
            // Nothing to pick: an optional pick needs no answer, a mandatory one cannot be paid.
            if (requested > 0 && !declaration.optional) {
              throw new CostRefusal("The player who has to pick for this cost has nothing legal to pick.");
            }
            picked = [];
          } else {
            assert(this.dryRun, "The player who decides this cost has not been asked.");
            return;
          }
        } else if (answer?.index === undefined) {
          assert(this.dryRun, "The player who decides this cost has not been asked.");
          return;
        } else if (answer.index !== 1) {
          return; // "may": declined (option 0)
        }
        if (declaration && picked) {
          context.selected = { ...context.selected, [declaration.id]: picked };
        }
        this.costEffectDepth++;
        try {
          for (const effect of cost.effects) {
            this.resolveEffect(effect, context);
            if (this.state.pendingChoice) {
              throw new CostRefusal("A cost step cannot ask anybody a question; use a typed cost step for a choice.");
            }
          }
        } finally {
          this.costEffectDepth--;
        }
        return;
      }

      case "distribute": {
        // "Remove X tokens from cards you control", divided by the payer (E3c).
        const key = cost.answerKey;
        assert(key, "That card's cost needs a division, so it cannot be played from an effect.");
        const targets = context.selected[cost.selected] ?? [];
        const amount = Math.max(0, this.evaluateNumber(cost.amount, context));
        if (amount === 0) return;
        const caps = this.distributeCaps(cost, targets, context);
        const capacity = targets.reduce((sum, id) => sum + (caps ? (caps[id] ?? 0) : Number.POSITIVE_INFINITY), 0);
        if (capacity < amount) {
          throw new CostRefusal(`The picked cards cannot give ${amount} (they hold ${capacity}).`);
        }
        const shares = this.costAnswers[key]?.shares;
        if (shares === undefined) {
          assert(this.dryRun, "The division for this cost has not been made.");
          return;
        }
        const total = Object.values(shares).reduce((sum, share) => sum + share, 0);
        if (total !== amount || Object.keys(shares).some(id => !targets.includes(id) || (caps && shares[id] > (caps[id] ?? 0)))) {
          throw new CostRefusal("The division of this cost is not legal any more.");
        }
        this.costEffectDepth++;
        try {
          for (const [cardId, share] of Object.entries(shares)) {
            if (share <= 0) continue;
            const nested: ResolutionContext = {
              ...context,
              selected: { ...context.selected, __candidate: [cardId] },
              variables: { ...(context.variables ?? {}), __amount: share }
            };
            for (const effect of cost.effects) this.resolveEffect(effect, nested);
          }
        } finally {
          this.costEffectDepth--;
        }
        return;
      }

      case "alternatingPay": {
        // The pay loop was run before anything else was paid (`bindCostChoices`); lock its tallies in.
        const key = cost.answerKey;
        assert(key, "That card's cost needs a pay loop, so it cannot be played from an effect.");
        const tallies = this.costAnswers[key]?.tallies;
        if (tallies === undefined) {
          assert(this.dryRun, "The pay loop for this cost has not been run.");
          return;
        }
        const first = this.resolvePlayerRef(cost.first, context).id;
        const second = this.resolvePlayerRef(cost.opponent, context).id;
        context.variables = {
          ...(context.variables ?? {}),
          __paidByFirst: tallies[0],
          __paidByOpponent: tallies[1],
          [`paid:${first}`]: tallies[0],
          [`paid:${second}`]: tallies[1]
        };
        return;
      }

      case "oneOf": {
        // "Pay 1 or destroy a Micromajig token you control." Auto-selects
        // the first branch that is fully payable (a player-choice variant
        // is future work — no current card meaningfully needs the choice).
        for (const branch of cost.options) {
          let payable = true;
          try {
            const probe = this.cloneForProbe();
            for (const c of branch) probe.payCost(c, context, false);
          } catch {
            payable = false;
          }
          if (payable) {
            for (const c of branch) this.payCost(c, context, emitEvents);
            return;
          }
        }
        throw new Error("None of the alternative cost branches can be paid.");
      }

      case "payResources": {
        // "Pay 10-X" with X above 10 is a cost of 0, never a negative one (CR 410.4).
        const amount = this.payAmount(cost, context);
        this.lastNumericCostPaid += amount;

        // A "FLIP IT" ability prefers other resources, but the face-down
        // card MAY help pay its own cost (SYS-53 / R6, like CR 507.4b for
        // FLIP UP) when nothing else covers it.
        const allAvailable = this.getAvailableResourceIds(
          context.controllerId
        );
        const ownId = this.abilityFlipsOwnSource(context)
          ? (context.sourceId as CardInstanceId)
          : undefined;
        // A player who names the card itself among the payers has chosen to let it help (the rule above).
        const named = this.payWith?.sourceId === context.sourceId ? this.payWith.ids : [];
        const exclude =
          ownId && !named.includes(ownId) && allAvailable.filter(id => id !== ownId).length >= amount
            ? [ownId]
            : undefined;
        const available = allAvailable.length - (exclude ? 1 : 0);
        assert(available >= amount, "Not enough unattached resources.");

        for (const id of named) {
          if (!allAvailable.includes(id)) {
            throw new CostRefusal("That card can't be spent to pay: it is not an unattached resource you control.");
          }
        }
        if (named.length > amount) throw new CostRefusal(`This costs ${amount}: choose no more than that many resources.`);

        if (this.paymentCapture && emitEvents) {
          if (amount === 0) return;
          this.paymentCapture = {
            amount,
            candidates: allAvailable.filter(id => !exclude?.includes(id))
          };
          throw new PaymentCaptured();
        }

        this.payNumericCost(context.controllerId, amount, exclude, this.takePayWith(context));
        return;
      }

      case "loseInfluence": {
        const player = this.resolvePlayerRef(cost.player ?? "controller", context);
        const printedAmount = this.evaluateNumber(cost.amount, context);
        assert(printedAmount >= 0, "Influence payment cannot be negative.");
        // "Your faction loses N influence" is a loss like any other, so
        // Tax Attorney / Gideon-style modifiers change a cost too (Q24).
        const amount = -this.modifiedInfluenceDelta(player.id, -printedAmount);
        // A cost that cannot be paid in full is refused (SYS-26).
        assert(player.influence >= amount, "Not enough influence to pay the cost.");
        player.influence -= amount;
        this.noteInfluenceLost(player.id, amount);
        if (emitEvents && amount > 0) {
          this.emit({
            type: "influenceChanged",
            playerId: player.id,
            delta: -amount,
            total: player.influence
          });
        }
        return;
      }

      case "shuffleDeck": {
        const player = this.resolvePlayerRef(cost.player ?? "controller", context);
        this.shuffleDeckOf(player.id, emitEvents);
        return;
      }

      case "revealSelf": {
        // "Reveal this card from your hand." Pure information (the engine has
        // perfect information); the card stays where it is.
        const revealed = this.requireCard(context.sourceId);
        if (emitEvents) {
          this.emitReveal(
            [revealed.id],
            "all",
            revealed.id,
            undefined,
            this.pickedByRevealer(context.controllerId)
          );
        }
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing depletion target.");

        const card = this.requireCard(targetId);

        assert(!card.depleted, "Card is already depleted.");

        card.depleted = true;

        if (emitEvents) {
          this.emit({
            type: "cardDepleted",
            cardId: card.id
          });
        }

        return;
      }

      case "discard": {
        const selected = this.assertCostPickSelection(cost, context);

        for (const cardId of selected) {
          this.moveCard(cardId, "discard", emitEvents, "bottom", true);
        }

        return;
      }

      case "moveSelected": {
        // `selector.name === "__self"` is the sentinel for "this card itself"
        // — a self-discard / self-shuffle cost (Key to the City's UNLOCK
        // POTENTIAL, Quilt of Old Banners' HAND IT DOWN) that never needs an
        // explicit `selected` entry from the activation.
        const selected = this.assertCostPickSelection(cost, context);

        const toPlayerId = cost.toPlayer
          ? this.resolvePlayerRef(cost.toPlayer, context).id
          : undefined;
        if (cost.reveal && emitEvents) {
          this.emitReveal(
            selected,
            "all",
            context.sourceId,
            undefined,
            this.pickedByRevealer(context.controllerId)
          );
        }
        for (const cardId of selected) {
          this.moveCard(
            cardId,
            cost.to,
            emitEvents,
            cost.position ?? "bottom",
            true,
            toPlayerId
          );
        }
        if (cost.shuffle && cost.to === "deck") {
          // Reshuffle the deck(s) the cards actually went into.
          const decks = new Set<PlayerId>();
          for (const cardId of selected) {
            const moved = this.state.cards[cardId];
            if (moved?.zone === "deck") decks.add(this.zoneHolderId(moved));
          }
          for (const deckOwnerId of decks) {
            this.shuffleDeckOf(deckOwnerId, emitEvents);
          }
        }

        return;
      }

      case "destroy": {
        let targetId: CardInstanceId | undefined;
        if (typeof cost.target === "object" && cost.target.type === "random") {
          // "Destroy a resource you control" with nobody to ask (a play made from inside an effect, or the
          // rehearsal of a payment): take a spent (attached) card first, so the ready ones stay available for
          // the numeric cost, which is paid last (SYS-23). Otherwise any matching card.
          const pool = this.queryCards({ zone: "play", ...cost.target.selector }, context);
          const spent = pool.filter(card => card.attachedTo !== undefined);
          const from = spent.length > 0 ? spent : pool;
          targetId = from.length > 0 ? from[Math.floor(this.random() * from.length)].id : undefined;
        } else {
          targetId = this.resolveTargetRef(cost.target, context);
        }

        assert(targetId, "Missing destroy-cost target.");

        this.destroyCard(targetId, emitEvents, "cost");
        return;
      }

      case "removeFromGame": {
        const targetId = this.resolveTargetRef(cost.target, context);
        assert(targetId, "Missing removeFromGame-cost target.");
        assert(
          this.state.cards[targetId],
          "removeFromGame-cost target is not a real card."
        );
        this.moveCard(targetId, "removed", emitEvents, "bottom", true);
        return;
      }

      case "dealDamage": {
        const targetId = this.resolveTargetRef(cost.target, context);
        assert(targetId, "Missing dealDamage-cost target.");
        const card = this.requireCard(targetId);
        const base = this.evaluateNumber(cost.amount, context);
        const amount = Math.max(
          0,
          base +
            this.damageDeltaFor(
              targetId,
              false,
              context.sourceId,
              base,
              undefined,
              true
            )
        );
        // CR §408.3 — a faction loses influence instead of taking markers.
        if (this.getDefinition(targetId).type === "faction") {
          this.applyInfluenceDelta(this.factionHolderId(card), -amount);
        } else {
          this.noteDamage(card, [{ sourceId: context.sourceId, amount }]);
          card.damage += amount;
          if (amount > 0) this.lethalDamageCause.delete(targetId);
        }
        if (emitEvents && amount > 0) {
          this.emit({
            type: "damageDealt",
            sourceId: context.sourceId,
            targetId,
            amount
          });
        }
        return;
      }

      case "sacrificeSelected": {
        const targetIds = context.selected[cost.declarationId] ?? [];
        const zone =
          cost.disposition === "removeFromGame"
            ? "removed"
            : "discard";

        for (const targetId of targetIds) {
          const card = this.state.cards[targetId];
          assert(card, "sacrificeSelected target is not a real card.");
          if (cost.disposition === "destroy" && card.zone === "play") {
            this.destroyCard(targetId, emitEvents, "cost");
          } else {
            this.moveCard(targetId, zone, emitEvents, "bottom", true);
          }
        }
        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing removeCounter-cost target.");

        const card = this.requireCard(targetId);
        const amount = this.evaluateNumber(cost.amount, context);
        const current = card.counters[cost.counter] ?? 0;

        assert(current >= amount, `Not enough '${cost.counter}' counters to remove.`);

        card.counters[cost.counter] = current - amount;
        if (emitEvents && amount > 0) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: cost.counter });
        }
        return;
      }

      case "depleteSelected": {
        const targetIds =
          context.selected[
            cost.declarationId ?? (cost as unknown as { id: string }).id
          ] ?? [];
        const cards = targetIds.map(targetId => this.requireCard(targetId));

        for (const card of cards) {
          assert(!card.depleted, "Card is already depleted.");
        }

        for (const card of cards) {
          card.depleted = true;

          if (emitEvents) {
            this.emit({
              type: "cardDepleted",
              cardId: card.id
            });
          }
        }

        return;
      }
    }
  }

  /**
   * Move an in-play card's control to `newControllerId`, keeping the
   * per-player `play` arrays (which `getAvailableResourceIds` / `getThresholds`
   * / attack-eligibility loops iterate) in sync. No-op if control is
   * unchanged or the card isn't in play.
   */
  /**
   * Fold every in-play `ContinuousAbility.abilityCostModifiers` that targets
   * this ability into its `payResources` costs (floored at each modifier's
   * `minCost`). First Unified Market of Abstract Secure Theoreticals.
   */
  private applyAbilityCostModifiers(
    sourceCardId: CardInstanceId,
    costs: Cost[],
    playerId: PlayerId,
    context: ResolutionContext,
    /** Further adjustments of the same numeric cost (the payer's pending "reduce the next numeric cost"). */
    extra: readonly NumericCostAdjust[] = [],
    /** Who is USING the ability (it can sit on a card the other player controls): the one a tax lands on. */
    userId: PlayerId = playerId
  ): Cost[] {
    const adjusts: NumericCostAdjust[] = [];

    const isFactionAbility = this.getDefinition(sourceCardId).type === "faction";
    const isControlledCharacter =
      this.hasCardType(sourceCardId, "character") &&
      this.state.cards[sourceCardId]?.controllerId === playerId;

    for (const src of Object.values(this.state.cards)) {
      if (src.zone !== "play" || src.faceDown) continue;
      for (const ability of this.getDefinition(src.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.abilityCostModifiers) continue;
        if (this.abilitySuppressed(src.id, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: src.id,
          controllerId: src.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const m of ability.abilityCostModifiers) {
          const applies =
            (m.scope === "factionAbilities" &&
              isFactionAbility &&
              src.controllerId === playerId) ||
            (m.scope === "self" && src.id === sourceCardId) ||
            (m.scope === "controlledCharacters" &&
              isControlledCharacter &&
              src.controllerId === playerId) ||
            (m.scope === "opponentCharacters" &&
              this.hasCardType(sourceCardId, "character") &&
              isOpponentOf(this.state, src.controllerId, userId));
          if (!applies) continue;
          adjusts.push({
            delta: this.evaluateNumber(m.delta, ctx),
            ...(m.minCost !== undefined ? { minCost: m.minCost } : {})
          });
        }
      }
    }

    // One running numeric cost (CR 406.3): an increase CREATES a cost when the ability printed none.
    return this.foldNumericCost(costs, [...adjusts, ...extra]);
  }

  /**
   * Hands an in-play card to `newControllerId`. Control only exists in play
   * (CR §407.3): outside it the holder controls a card
   * (`releaseControlOutsidePlay`), so this does nothing for any other zone.
   */
  private reassignControl(
    cardId: CardInstanceId,
    newControllerId: PlayerId
  ): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || card.controllerId === newControllerId) {
      return;
    }

    const oldController = this.requirePlayer(card.controllerId);
    oldController.play = oldController.play.filter(id => id !== cardId);
    this.requirePlayer(newControllerId).play.push(cardId);

    card.controllerId = newControllerId;
    // It did not start this turn under its new controller (CR 204.3), and a
    // control change breaks "controlled since the start of the turn" (CR 608.1b)
    // even when the card comes straight back.
    card.startedTurnInPlay = undefined;
    card.attackEligibleTurn = undefined;

    // CR 407.4: a character whose controller changes during a battle is
    // removed from it immediately (no longer part of its battle party).
    const battle = this.state.battle;
    if (battle) {
      battle.attackingParty = battle.attackingParty.filter(id => id !== cardId);
      battle.blockingParty = battle.blockingParty.filter(id => id !== cardId);
    }
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  resolveEffect(
    effect: Effect,
    context: ResolutionContext
  ): void {
    this.readMemo = undefined;
    effect = this.normalizeEffectDuration(effect, context);
    // Whatever effect is resolving, its controller is the "cause" of any
    // destroy / move / damage it goes on to perform (and of the state-based
    // check that immediately follows in `runEffectFrame`). Read by
    // `applyReplacement` for `replaces.by` ("by an opposing card or effect").
    this.currentCause = context.controllerId;
    this.currentCauseSourceId = context.sourceId;

    // "Any effects from <cardType> do not affect this card." (Parkour
    // Hoodlum) — a single-target mutation whose origin is a card of an
    // ignored type is a no-op against that card. Targeted picks are already
    // filtered by `targetCandidates`; this covers the non-pick vectors
    // (`"eventCard"`, `"attachedTo"`, a remembered ref). A `{random}` target
    // is skipped — resolving it here would consume the RNG twice.
    if (SOURCE_CLASS_GUARDED_EFFECTS.has(effect.type) && "target" in effect) {
      // Every effect in SOURCE_CLASS_GUARDED_EFFECTS carries a `target:
      // TargetRef` — the cast is safe (the union widens once effects with a
      // non-TargetRef `target`, e.g. `initiateAttack`, joined the type).
      const rawTarget = (effect as { target?: TargetRef }).target;
      if (
        rawTarget !== undefined &&
        !(typeof rawTarget === "object" && rawTarget.type === "random")
      ) {
        const guardedId = this.resolveTargetRef(rawTarget, context);
        if (
          guardedId &&
          this.sourceClassIgnoredByTarget(guardedId, context.sourceId)
        ) {
          return;
        }
      }
    }

    switch (effect.type) {
      case "draw": {
        const player = this.resolvePlayerRef(
          effect.player,
          context
        );

        const amount = this.evaluateNumber(
          effect.amount,
          context
        );

        this.drawCards(player.id, amount);
        return;
      }

      case "playResource": {
        const resourcePlayerId = effect.player
          ? this.resolvePlayerRef(effect.player, context).id
          : context.controllerId;
        if (!effect.target) {
          // "Play a resource" with no card named (SYS-33): the player picks
          // one from their own hand now. A hand of exactly one card has
          // nothing to pick; with no card there is nothing to play.
          const handCards = this.targetCandidates(
            { owner: "self", zone: "hand" },
            context,
            resourcePlayerId
          );
          if (handCards.length === 0) return;
          if (handCards.length === 1) {
            this.resolveEffect(
              {
                ...effect,
                target: { type: "card", id: handCards[0].id },
                player: { type: "player", id: resourcePlayerId }
              },
              context
            );
            return;
          }
          this.resolveEffect(
            {
              type: "chooserSelectsTarget",
              chooser: { type: "player", id: resourcePlayerId },
              declaration: {
                id: "__playResource",
                selector: { owner: "self", zone: "hand" },
                count: 1,
                optional: false
              },
              effects: [
                {
                  ...effect,
                  target: { type: "selected", id: "__playResource" },
                  player: { type: "player", id: resourcePlayerId }
                }
              ]
            },
            context
          );
          return;
        }
        const targetId = this.resolveTargetRef(effect.target, context);
        // RULES.md §12: an effect whose target can't be resolved (e.g. a
        // `{type:"random"}` selector matching nothing) is carried out as far
        // as possible — here, not at all — rather than aborting resolution.
        // The zone check (mirroring `destroy`) additionally covers a target
        // that resolved fine at activation time but left hand before this
        // effect actually reached the front of the response stack (RULES.md
        // §7's LIFO resolution can leave a lot of daylight between the two).
        if (!targetId || this.state.cards[targetId]?.zone !== "hand") return;

        // "...you may reveal this card as you are playing a resource" (Witty
        // Worm, CR 605.1c): after the card is chosen and before it enters
        // play, the player may reveal-deploy a hand card that offers it.
        // "Put a resource into play" isn't playing one.
        if (
          !effect.putIntoPlay &&
          !(context.resourceRevealOffered ?? []).includes(targetId)
        ) {
          const revealable = this.resourceRevealCandidates(resourcePlayerId, targetId);
          if (revealable.length > 0) {
            this.state.pendingChoice = {
              kind: "resourceReveal",
              id: this.nextId("choice"),
              playerId: resourcePlayerId,
              resourceCardId: targetId,
              candidates: revealable,
              effect: {
                ...effect,
                target: { type: "card", id: targetId },
                player: { type: "player", id: resourcePlayerId }
              },
              context
            };
            return;
          }
        }

        const definition = this.getDefinition(targetId);
        // "auto" = real resource cards face-up, everything else face-down. A
        // `faceDownOnly` resource (the Holy Heist FLIP IT staples — Elitist
        // Upgrade et al.) is "everything else" here: it can ONLY enter from
        // hand face-down, so an "auto" play must flip it rather than pass
        // faceDown:false and trip the face-up guard in `playResourceCard`
        // (which bricks mid-resolution, after the ability's cost is paid).
        const faceDownSetting = effect.faceDown ?? "auto";
        const mustBeFaceDown = this.forcedFaceDownReason(definition) !== undefined;

        // CR 203.2 (SYS-7, Q18): any card may be played face-down as Volition,
        // so playing an actual resource card is the player's call (made with
        // the pick, or asked right after it).
        if (
          faceDownSetting === "auto" &&
          !mustBeFaceDown &&
          context.resourceFaceDown === undefined &&
          this.zoneHolderId(this.requireCard(targetId)) === resourcePlayerId
        ) {
          this.state.pendingChoice = {
            kind: "playResource",
            id: this.nextId("choice"),
            playerId: resourcePlayerId,
            cardId: targetId,
            canFaceUp: this.forcedFaceDownReason(definition) === undefined,
            emitPlayed: !effect.putIntoPlay,
            ...(effect.attachedToFaction ? { attachedToFaction: true } : {})
          };
          return;
        }
        const faceDown =
          faceDownSetting === "auto"
            ? mustBeFaceDown || (context.resourceFaceDown ?? false)
            : faceDownSetting;

        this.playResourceCard(
          resourcePlayerId,
          targetId,
          faceDown,
          !effect.putIntoPlay,
          effect.attachedToFaction === true
        );
        return;
      }

      case "dealDamage": {
        const rawTargetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!rawTargetId) return;
        if (this.pickedCardMovedAway(effect.target, rawTargetId, context)) return;

        // "If the picked character would be dealt damage, deal damage to
        // this card instead." (6r4wny 60dy9u4rd5).
        const targetId = this.redirectTargetFor(rawTargetId) ?? rawTargetId;
        this.destroyedByDamage.delete(targetId);

        const target = this.requireCard(targetId);

        // The target left play (e.g. bounced by a response) before this
        // effect resolved — same "no longer there, no damage lands" rule
        // battle damage already enforces (CR §302.15). Without this, damage
        // marked here would stick on a card that's supposed to be undamaged
        // outside of play (see the zone-leave reset below).
        if (target.zone !== "play") return;

        const base = this.evaluateNumber(effect.amount, context);
        const raw = Math.max(
          0,
          base + this.damageDeltaFor(targetId, false, context.sourceId, base)
        );

        // "If damage would be inflicted to this card, <effects> instead."
        if (this.damageReplaced(targetId, raw, false, context.sourceId)) return;

        // "... you may put up to that many cards from the top of its owner's
        // deck into their discard pile instead" (Trickster's Globe): pause for
        // the split; the answer inflicts the rest.
        const offer = this.factionMillOffer(targetId, raw, context.controllerId);
        if (offer) {
          this.state.pendingChoice = {
            kind: "millInsteadOfDamage",
            id: this.nextId("choice"),
            ...offer,
            damageSourceId: context.sourceId,
            amount: raw,
            battle: false,
            resume: { targetId, context: structuredClone(context) }
          };
          return;
        }

        this.inflictEffectDamage(targetId, raw, context);
        return;
      }

      case "simultaneousDamage": {
        // All hits land before anything is destroyed (the state check runs
        // after this whole effect), so "if only 1 of the characters is
        // destroyed by this damage" can be judged on the final damage totals.
        this.beginEventBatch();
        try {
          for (const hit of effect.hits) {
            this.resolveEffect(
              { type: "dealDamage", target: hit.target, amount: hit.amount },
              context
            );
          }
          if (effect.loneVictimRemovedFromGame) {
            const lethal = effect.hits
              .map(hit => this.resolveTargetRef(hit.target, context))
              .filter((id): id is CardInstanceId => {
                if (!id) return false;
                const card = this.state.cards[id];
                if (!card || card.zone !== "play") return false;
                if (!this.hasCardType(id, "character")) return false;
                return card.damage >= this.getStat(id, "life");
              });
            // "Instead": the lone victim is never destroyed, it leaves the
            // game straight from play (no cardDestroyed event).
            if (new Set(lethal).size === 1) {
              this.moveCard(lethal[0], "removed");
            }
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "claimHeroCards": {
        const showdown = this.state.showdown;
        if (!showdown) return;
        const claimerId = this.resolvePlayerRef(effect.claimer, context).id;
        const count = effect.count ?? 1;
        let cardIds: CardInstanceId[];
        if (effect.from === "heroDeckTop") {
          cardIds = showdown.heroDeck.slice(0, count === "all" ? undefined : count);
          // "Reveal the top card of the Hero deck and claim it." (SD-SLE 3)
          if (cardIds.length > 0) this.emitReveal(cardIds, "all", context.sourceId);
        } else if (effect.from === "temptationPile") {
          cardIds = showdown.temptationPile.slice(0, count === "all" ? undefined : count);
        } else {
          // A pick from a pile, or the rest of a claim waiting behind a claimed tactic: Hero cards still on the table.
          cardIds = (context.selected[effect.selected ?? ""] ?? []).filter(
            id => this.state.cards[id]?.zone === "table" && this.state.cards[id].heroCard === true
          );
        }
        this.claimHeroCards(cardIds, claimerId, context);
        return;
      }

      case "heroDeckToTemptationPile": {
        const showdown = this.state.showdown;
        if (!showdown) return;
        const moved = showdown.heroDeck.splice(0, Math.max(0, effect.count ?? 1));
        showdown.temptationPile.push(...moved);
        // The Temptation Pile stays face-up on the table (SD 11).
        if (moved.length > 0) this.emitReveal(moved, "all", context.sourceId);
        return;
      }

      case "revealAllegiances": {
        const turned = revealAllAllegiances(this.state);
        if (turned.length > 0) this.emit({ type: "allegiancesRevealed", playerIds: turned });
        return;
      }

      case "modifyInfluence": {
        const player = this.resolvePlayerRef(effect.player, context);
        const before = player.influence;
        this.applyInfluenceDelta(
          player.id,
          this.evaluateNumber(effect.amount, context)
        );
        const delta = player.influence - before;
        if (delta !== 0) {
          this.emit({
            type: "influenceChanged",
            playerId: player.id,
            delta,
            total: player.influence
          });
        }
        return;
      }

      case "setInfluence": {
        // "Set <player>'s influence to N": the faction ends at exactly N (not
        // below 0, CR 410.4). Neither a gain nor a loss, so no
        // `influenceModifiers` ability applies and nothing is recorded as
        // lost influence this turn; the change is still reported.
        const player = this.resolvePlayerRef(effect.player, context);
        const before = player.influence;
        player.influence = Math.max(0, this.evaluateNumber(effect.amount, context));
        const delta = player.influence - before;
        if (delta !== 0) {
          this.emit({
            type: "influenceChanged",
            playerId: player.id,
            delta,
            total: player.influence
          });
        }
        return;
      }

      case "mill": {
        const player = this.resolvePlayerRef(effect.player, context);
        const count = this.evaluateNumber(effect.count, context);
        const top = player.deck.slice(0, Math.max(0, count));
        const to = effect.to ?? "discard";

        this.beginEventBatch();
        try {
          for (const cardId of top) {
            this.moveCard(cardId, to);
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "reveal": {
        const owner = this.resolvePlayerRef(effect.of, context);
        const n =
          effect.zone === "hand"
            ? owner.hand.length
            : Math.max(0, this.evaluateNumber(effect.count ?? 1, context));
        const cardIds =
          effect.zone === "hand" ? [...owner.hand] : owner.deck.slice(0, n);
        if (cardIds.length === 0) return;
        // The revealer already knows their own hand; the top of any deck and
        // an opponent's hand are news to them.
        const knownToRevealer =
          effect.zone === "hand" && owner.id === context.controllerId;
        this.emit({
          type: "cardsRevealed",
          cardIds,
          zone: effect.zone === "hand" ? "hand" : "deck",
          ownerId: owner.id,
          viewerId:
            effect.viewer === "all"
              ? "all"
              : effect.viewer
                ? this.resolvePlayerRef(effect.viewer, context).id
                : this.resolvePlayerRef("controller", context).id,
          byCardId: context.sourceId,
          ...(knownToRevealer ? { knownToRevealer: true } : {})
        });
        return;
      }

      case "revealCards": {
        // "...search your deck for X and reveal it" — show the cards from
        // wherever they sit right now (the deck, for a search). One event per
        // owner + zone so a reveal spanning two decks stays legible.
        const viewerId =
          effect.viewer === undefined || effect.viewer === "all"
            ? "all"
            : this.resolvePlayerRef(effect.viewer, context).id;
        const targetId = effect.target
          ? this.resolveTargetRef(effect.target, context)
          : undefined;
        const cardIds = effect.selected
          ? context.selected[effect.selected] ?? []
          : effect.selector
            ? this.queryCards(effect.selector, context).map(card => card.id)
            : targetId
              ? [targetId]
              : [];
        this.emitReveal(
          cardIds,
          viewerId,
          context.sourceId,
          undefined,
          this.pickedByRevealer(context.controllerId)
        );
        return;
      }

      case "revealFromTopUntil": {
        const player = this.resolvePlayerRef(effect.player, context);
        const others: CardInstanceId[] = [];
        const revealed: CardInstanceId[] = [];
        let matchId: CardInstanceId | undefined;
        while (player.deck.length > 0) {
          const cardId = player.deck[0];
          revealed.push(cardId);
          const matched = this.evaluateCondition(effect.match, {
            ...context,
            selected: { ...context.selected, __candidate: [cardId] }
          });
          if (matched) {
            matchId = cardId;
            break;
          }
          others.push(player.deck.shift()!);
        }

        if (revealed.length > 0) {
          this.emit({
            type: "cardsRevealed",
            cardIds: revealed,
            zone: "deck",
            ownerId: player.id,
            viewerId: "all",
            byCardId: context.sourceId
          });
        }

        this.beginEventBatch();
        try {
          if (matchId) {
            const matchCtx: ResolutionContext = {
              ...context,
              selected: { ...context.selected, [effect.bindAs]: [matchId] }
            };
            for (const sub of effect.onMatch) this.resolveEffect(sub, matchCtx);
          } else {
            for (const sub of effect.onEmpty ?? []) this.resolveEffect(sub, context);
          }

          const rest = effect.rest ?? "shuffle";
          if (rest === "shuffle") {
            for (const id of others) player.deck.push(id);
            if (others.length > 0) this.shuffleDeckOf(player.id);
          } else {
            for (const id of others) {
              this.moveCard(id, rest === "bottom" ? "deck" : rest, true, "bottom");
            }
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "rememberTarget": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const source = this.state.cards[context.sourceId];
        if (
          source &&
          targetId &&
          !this.pickedCardMovedAway(effect.target, targetId, context)
        ) {
          (source.linkedTargets ??= {})[effect.key] = targetId;
        }
        return;
      }

      case "duplicate": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        const stackItem = this.responseStack.find(
          item => item.sourceId === targetId && item.kind === "card"
        );
        const definition = this.getDefinition(targetId);
        if (definition.type !== "tactic") return;

        // CR 307.3: a duplicate made while the duplicator is restricted from
        // playing tactics is terminated immediately.
        if (
          this.state.playRestrictions.some(
            r => r.playerId === context.controllerId && r.kind === "cardType" && r.cardType === "tactic"
          ) ||
          this.continuousPlayRestrictor(context.controllerId, { cardType: "tactic" })
        ) {
          return;
        }

        // The copy has all the original's rules text (CR 307.1): it asks for
        // its play-time picks anew from the duplicator, and a tactic with
        // several labelled options lets the duplicator choose a new option
        // (CR 307.2) -- with that option's own picks. It also keeps the
        // original's EXTRA COSTS ("Pay twice X", "Discard a card", ...): the
        // duplicator makes the cost's own picks and pays them again, and a
        // copy whose extra costs cannot be paid is invalid and has no effect.
        const duplicator: PlayerRef = { type: "player", id: context.controllerId };
        const withPicks = (
          source: { targets?: TargetDeclaration[]; costs?: Cost[]; effects?: Effect[] } | undefined
        ): Effect[] => {
          const declarations: TargetDeclaration[] = [...(source?.targets ?? [])];
          const preludes: Effect[] = [];
          const costs: Cost[] = [];
          (source?.costs ?? []).forEach((cost, index) => {
            if (cost.type === "nameValue") {
              // The duplicator names its own value.
              preludes.push({
                type: "nameValue",
                chooser: duplicator,
                valueKind: cost.valueKind,
                storeAs: cost.storeAs,
                ...(cost.exclude ? { exclude: cost.exclude } : {}),
                ...(cost.nonResource ? { nonResource: true } : {})
              });
              return;
            }
            if (cost.type === "discard") {
              declarations.push({
                id: cost.id,
                selector: { ...cost.selector, controller: cost.selector.controller ?? "self", zone: cost.selector.zone ?? "hand" },
                count: cost.count
              });
            } else if (cost.type === "moveSelected" && cost.selector.name !== "__self") {
              declarations.push({
                id: cost.id,
                selector: { ...cost.selector, controller: cost.selector.controller ?? "self", zone: cost.selector.zone ?? "play" },
                count: cost.count
              });
            } else if (cost.type === "destroy" && typeof cost.target === "object" && cost.target.type === "random") {
              const id = `__dupDestroy${index}`;
              declarations.push({
                id,
                selector: { zone: "play", ...cost.target.selector },
                count: 1
              });
              costs.push({ type: "destroy", target: { type: "selected", id } });
              return;
            }
            costs.push(cost);
          });
          const effects = source?.effects ?? [];
          const inner: Effect[] =
            costs.length > 0
              ? [{ type: "payCosts", costs, declarations: source?.targets ?? [], effects }]
              : effects;
          const picks = declarations.reduceRight<Effect[]>(
            (rest, declaration) => [
              { type: "chooserSelectsTarget", chooser: duplicator, declaration, effects: rest }
            ],
            inner
          );
          return [...preludes, ...picks];
        };
        const modes = definition.behavior?.modes;
        const dupEffects: Effect[] =
          modes && modes.length > 1
            ? [
                {
                  type: "chooserSelectsOption",
                  chooser: duplicator,
                  options: modes.map((mode, index) => ({
                    label: mode.label ?? `Option ${index + 1}`,
                    effects: withPicks(mode)
                  }))
                }
              ]
            : withPicks(this.getTacticSource(definition));
        if (dupEffects.length === 0) return;

        // The copy resolves the same effects with the same choices, under
        // the duplicator's control (RULES.md §12 — a copy uses the
        // original's already-made selections).
        const dupContext: ResolutionContext = {
          sourceId: targetId,
          controllerId: context.controllerId,
          ...(stackItem?.context.opponentId !== undefined ? { opponentId: stackItem.context.opponentId } : {}),
          abilityId: stackItem?.context.abilityId,
          selected: { ...(stackItem?.context.selected ?? {}) },
          variables: {
            ...(stackItem?.context.variables ?? this.state.tacticPlayVariables?.[targetId] ?? {})
          },
          deployedViaFlipUp: stackItem?.context.deployedViaFlipUp
        };
        this.runEffectFrame({ effects: dupEffects, index: 0, context: dupContext });
        return;
      }

      case "payCosts": {
        // A copy's extra costs (see `duplicate`): rehearsed first, so an
        // unpayable set pays nothing and the copy has no effect.
        const costs = this.withPickDeclarations(
          this.orderCosts(effect.costs),
          effect.declarations ?? []
        );
        if (this.costProblem(costs, context)) return;
        this.payCosts(costs, context);
        this.checkStateBasedActions();
        this.runEffectFrame({ effects: effect.effects, index: 0, context });
        return;
      }


      case "partitionAndPick": {
        const a = context.controllerId;
        const b = this.soleOpponentFor(context);
        const revealed: Record<PlayerId, CardInstanceId[]> = {
          [a]: this.requirePlayer(a).deck.slice(0, effect.count),
          [b]: this.requirePlayer(b).deck.slice(0, effect.count)
        };

        // "divide them into N piles containing at least 1 card each" is
        // impossible for a player with fewer than N revealed cards — the
        // whole showdown fizzles rather than half-resolving.
        if (revealed[a].length < effect.piles || revealed[b].length < effect.piles) {
          return;
        }

        this.state.pendingPartition = {
          sourceId: context.sourceId,
          controllerId: a,
          compareBy: effect.compareBy,
          winnerTakes: effect.winnerTakes,
          order: [a, b],
          revealed,
          partitions: {},
          picks: {},
          phase: "partition"
        };

        this.state.pendingChoice = {
          kind: "partitionCards",
          id: this.nextId("choice"),
          playerId: a,
          cardIds: [...revealed[a]],
          piles: effect.piles
        };
        return;
      }

      case "retargetExtraCost": {
        const item = this.getRespondedToStackItem(context);
        if (!item) return;
        // The first pick may have left play in response (CR 402.5a): the
        // recorded selection still names it.
        const fromId =
          this.pickedCardOfType(item, effect.cardType) ??
          this.pickedCardOfType(item, effect.cardType, true);
        const toId = this.resolveTargetRef(effect.to, context);
        if (!fromId || !toId || fromId === toId) return;

        for (const [key, ids] of Object.entries(item.context.selected ?? {})) {
          item.context.selected[key] = ids.map(id => (id === fromId ? toId : id));
        }
        return;
      }

      case "setCardType": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        this.state.cardTypeGrants.push({
          id: this.nextId("cardTypeGrant"),
          sourceId: context.sourceId,
          targetId,
          cardType: effect.cardType,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        for (const [stat, expr] of Object.entries(effect.grantStats ?? {})) {
          this.state.modifiers.push({
            id: this.nextId("modifier"),
            sourceId: context.sourceId,
            sourceAbilityId: context.abilityId,
            targetId,
            stat: stat as Stat,
            operation: "set",
            value: this.evaluateNumber(expr as NumberExpression, context),
            duration: effect.duration,
            createdTurn: this.state.turn
          });
        }

        this.checkStateBasedActions();
        return;
      }

      case "removeCardType": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        const dropped = this.state.cardTypeGrants.filter(
          g => g.targetId === targetId && g.cardType === effect.cardType
        );
        if (dropped.length === 0) return;

        this.state.cardTypeGrants = this.state.cardTypeGrants.filter(
          g => !dropped.includes(g)
        );
        // Drop the `set` stat modifiers that `setCardType.grantStats` pushed
        // alongside each removed grant (same source + target).
        const sources = new Set(dropped.map(g => g.sourceId));
        this.state.modifiers = this.state.modifiers.filter(
          m =>
            !(
              m.targetId === targetId &&
              m.operation === "set" &&
              sources.has(m.sourceId)
            )
        );

        // A card that is no longer a character forgets the damage it took
        // this turn (CR 208.3), and the temporary rules text it gained while
        // it was a character is removed (CR 508.3).
        const card = this.state.cards[targetId];
        if (
          effect.cardType === "character" &&
          card &&
          !this.hasCardType(targetId, "character")
        ) {
          card.damage = 0;
          this.state.keywordGrants = this.state.keywordGrants.filter(
            g => !(g.targetId === targetId && g.whileCharacter)
          );
        }

        this.checkStateBasedActions();
        return;
      }

      case "bind": {
        if (!context.variables) context.variables = {};
        context.variables[effect.id] = this.evaluateNumber(effect.value, context);
        return;
      }

      case "setRestoreLock": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card) card.restoreLocked = effect.value ?? true;
        return;
      }

      case "skipRestoreRule": {
        const player = this.resolvePlayerRef(effect.player, context);
        // "On your next turn" names a specific turn: the player's next one.
        // Several skips naming the same turn skip it once (Q32).
        const skips = new Set(this.state.restoreRuleSkips[player.id] ?? []);
        for (let i = 0; i < (effect.turns ?? 1); i++) skips.add(this.turnNumberOfNextTurn(player.id, i + 1));
        this.state.restoreRuleSkips[player.id] = [...skips].sort((a, b) => a - b);
        return;
      }

      case "skipNextRestore": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const card = targetId ? this.state.cards[targetId] : undefined;
        if (card) card.skipNextRestore = true;
        return;
      }

      case "modifyNumericCost": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        this.state.numericCostModifiers.push({
          id: this.nextId("numericCostMod"),
          targetId,
          delta: this.evaluateNumber(effect.delta, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "terminateEndOfTurn": {
        const playerId = context.controllerId;
        const window = this.state.responseWindow;
        if (window?.continuation.type === "endTurn" && window.continuation.playerId === playerId) {
          // The announcement is gone: what is left of the window is the
          // response chain in it, after which play goes on (CR 314.2).
          window.kind = "action";
          window.continuation = { type: "main" };
          window.pendingResponders = [];
        }
        const battle = this.state.battle;
        if (battle?.resumeEndTurn?.playerId === playerId) battle.resumeEndTurn = undefined;
        return;
      }

      case "chooserSelectsNumber": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.state.pendingChoice = {
          kind: "chooseNumber",
          id: this.nextId("choice"),
          playerId: chooser.id,
          storeAs: effect.storeAs,
          min: effect.min ? this.evaluateNumber(effect.min, context) : 0,
          max: effect.max ? this.evaluateNumber(effect.max, context) : 99,
          effects: effect.effects,
          context
        };
        return;
      }

      case "terminate": {
        const doomed = new Set<string>();

        if (effect.scope === "othersOnStack") {
          for (const item of this.responseStack) {
            if (item.sourceId !== context.sourceId) doomed.add(item.id);
          }
        } else if (effect.scope === "respondedItem") {
          // "Terminate the ability" / "terminate the card" — the newest
          // unresolved non-self stack item, whatever its kind.
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (item.sourceId !== context.sourceId) {
              doomed.add(item.id);
              break;
            }
          }
        } else {
          const targetId = effect.target
            ? this.resolveTargetRef(effect.target, context)
            : undefined;
          if (!targetId) return;
          for (const item of this.responseStack) {
            if (item.sourceId === targetId) doomed.add(item.id);
          }
        }

        if (doomed.size === 0) return;

        const removed = this.responseStack.filter(item => doomed.has(item.id));
        this.state.responseStack = this.responseStack.filter(
          item => !doomed.has(item.id)
        );

        for (const item of removed) {
          if (item.kind === "ability" && item.abilityId) {
            this.lastTerminatedAbility = {
              sourceId: item.sourceId,
              abilityId: item.abilityId
            };
          }
          if (item.kind !== "card") continue;
          this.lastTerminatedCard = item.sourceId;
          const card = this.state.cards[item.sourceId];
          if (
            card &&
            effect.disposition !== "hold" &&
            (card.zone === "deploying" || card.zone === "play")
          ) {
            // "Terminate the card, but put it into its owner's hand instead
            // of their discard pile." (Voidal Interference). A `"hold"`
            // terminate only takes the card off the stack: a following effect
            // moves it (Forced Recruitment puts it into play, never touching
            // a discard pile).
            this.moveCard(
              item.sourceId,
              effect.disposition === "hand" ? "hand" : "discard"
            );
          }
        }
        return;
      }

      case "moveCard": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;
        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;
        if (
          typeof effect.target === "object" &&
          effect.target.type === "respondedToPicked"
        ) {
          (context.resolvedPicked ??= {})[effect.target.cardType] = targetId;
        }

        const toPlayerId = effect.toPlayer
          ? this.resolvePlayerRef(effect.toPlayer, context).id
          : undefined;
        this.moveCard(
          targetId,
          effect.to,
          true,
          effect.position,
          false,
          toPlayerId
        );
        // Remember what voided it ("a character voided by this card").
        const voided = this.state.cards[targetId];
        if ((effect.to === "void" || effect.to === "removed") && voided?.zone === effect.to) voided.voidedBy = context.sourceId;
        if (effect.faceDown && voided && (voided.zone === "void" || voided.zone === "removed")) {
          voided.faceDown = true;
          voided.faceDownBy = context.controllerId;
        }
        return;
      }

      case "flipFaceDown": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (targetId) this.flipCardFaceDown(targetId);
        return;
      }

      case "flipFaceUp": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (targetId) this.flipCardFaceUp(targetId);
        return;
      }

      case "flipFactionCard": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const card = targetId ? this.state.cards[targetId] : undefined;
        if (!card || card.zone !== "play") return;

        const definition = this.getDefinition(card.id);
        const flipsTo = definition.faction?.flipsTo;
        if (!flipsTo || !this.definitions[flipsTo]) return;

        card.definitionId = flipsTo;
        this.emit({
          type: "factionCardFlipped",
          playerId: context.controllerId,
          cardId: card.id,
          fromDefinitionId: definition.id,
          toDefinitionId: flipsTo
        });
        return;
      }

      case "putIntoPlay": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;

        const controller = this.resolvePlayerRef(effect.controller, context);
        const following = this.followingEffect;
        const attachedNext =
          following?.type === "attachTo" &&
          JSON.stringify(following.target) === JSON.stringify(effect.target);

        // ATTACH TO card (CR 507.2b/c): the effect names its host, or the new
        // controller picks one as the card enters play (a prompt, as for any
        // pick, even with a single legal host); no legal host sends
        // it to its owner's discard pile.
        const card = this.state.cards[targetId];
        const def = card ? this.getDefinition(targetId) : undefined;
        let hostId: CardInstanceId | undefined;
        if (card && def?.attachTo && card.zone !== "play" && !effect.faceDown && !(attachedNext && !effect.attachTo)) {
          if (effect.attachTo) {
            hostId = this.resolveTargetRef(effect.attachTo, context);
            if (!hostId || !this.isLegalAttachHost(targetId, hostId, controller.id)) {
              if (card.zone !== "discard") this.moveCard(targetId, "discard");
              return;
            }
          } else {
            const hosts = this.legalAttachHosts(targetId, controller.id);
            if (hosts.length === 0) {
              if (card.zone !== "discard") this.moveCard(targetId, "discard");
              return;
            }
            {
              const sameController = controller.id === context.controllerId;
              this.resolveEffect(
                {
                  type: "chooserSelectsTarget",
                  chooser: effect.controller,
                  declaration: {
                    id: ATTACH_TARGET_ID,
                    selector: {
                      zone: "play",
                      type: def.attachTo,
                      ...(def.attachToController
                        ? { controller: sameController ? "self" : "opponent" }
                        : {})
                    },
                    count: 1
                  },
                  effects: [
                    {
                      ...effect,
                      target: { type: "selected", id: "__attachee" },
                      attachTo: { type: "selected", id: ATTACH_TARGET_ID }
                    }
                  ]
                },
                { ...context, selected: { ...context.selected, __attachee: [targetId] } }
              );
              return;
            }
          }
        }
        // A card without ATTACH TO still ends up attached when the effect
        // says so ("put the gear card into play attached to the character").
        if (card && def && !def.attachTo && effect.attachTo && !effect.faceDown) {
          const named = this.resolveTargetRef(effect.attachTo, context);
          if (named && this.state.cards[named]?.zone === "play") hostId = named;
        }
        this.putCardIntoPlay(
          targetId,
          controller.id,
          effect.faceDown ?? false,
          hostId ? { ...context, selected: { ...context.selected, [ATTACH_TARGET_ID]: [hostId] } } : context,
          effect.borrowed ?? false,
          hostId,
          effect.pairWithSource ?? false
        );
        return;
      }

      case "deployFromZone": {
        const player = this.resolvePlayerRef(effect.player, context);
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        // CR 604.2: an effect that lets you deploy a card never deploys a resource.
        if (this.getDefinition(targetId).type === "resource") return;

        const freeSpec = effect.free ?? true;
        const isFree =
          typeof freeSpec === "boolean"
            ? freeSpec
            : this.evaluateCondition(freeSpec, {
                ...context,
                selected: { ...context.selected, __candidate: [targetId] }
              });

        this.state.pendingChoice = {
          kind: "deployForFree",
          id: this.nextId("choice"),
          playerId: player.id,
          candidates: [targetId],
          context,
          fromZone: true,
          ignoreThreshold: effect.ignoreThreshold ?? false,
          ...(effect.afterDeploy ? { afterDeploy: effect.afterDeploy } : {}),
          // "Deploy it for N": a flat alternative cost, paid only on the deploy.
          ...(effect.cost !== undefined
            ? { costOverride: Math.max(0, this.evaluateNumber(effect.cost, context)) }
            : {}),
          payCost: !isFree || effect.cost !== undefined
        };
        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;
        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;

        // "This turn, cards ... can only be destroyed by costs." (Limited
        // Liability) — the `destroy` EFFECT is inert; the `destroy` COST,
        // lethal-damage SBA and `removeFromGame` still work.
        if (this.state.destructionRestrictionWindows.length > 0) {
          return;
        }

        // RULES.md §12: destroying a card no longer in play is carried out
        // "as far as possible" — i.e. it's simply already done. An earlier
        // effect in the same ability (or a batched trigger) may well have
        // already destroyed this exact target.
        if (this.state.cards[targetId]?.zone === "play") {
          this.destroyCard(targetId);
        } else if (
          context.selected.__candidate?.[0] === targetId &&
          this.state.cards[targetId] &&
          ["hand", "deck"].includes(this.state.cards[targetId].zone)
        ) {
          // A replacement ("destroy it instead", The Stone of Shame) for a
          // card that was about to enter a hand from a deck / hand: it ends
          // in its owner's discard pile (CR 304.1) and never reaches the hand.
          this.moveCard(targetId, "discard", true, "bottom", true);
        }

        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);

        // Resources never deplete (CR §203.7); a face-down card is a resource.
        if (this.isResource(targetId)) return;
        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId: targetId
          });
        }

        return;
      }

      case "preventDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        const redirectToId =
          effect.mode === "redirect" && effect.redirectTo
            ? this.resolveTargetRef(effect.redirectTo, context)
            : undefined;

        this.state.damageShields.push({
          id: this.nextId("shield"),
          sourceId: context.sourceId,
          targetId,
          amount: effect.wholeInstance
            ? 1
            : Math.max(0, this.evaluateNumber(effect.amount, context)),
          mode: effect.mode,
          redirectToId,
          wholeInstance: effect.wholeInstance,
          ...(effect.oneInstance ? { oneInstance: true } : {}),
          ...(effect.persistent ? { persistent: true } : {}),
          createdTurn: this.state.turn
        });
        return;
      }

      case "restore": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);

        if (
          card.depleted &&
          !this.hasRestriction(targetId, "cannotBeRestored")
        ) {
          card.depleted = false;
          // A restore lock ("depleted by this card cannot be restored by the
          // RESTORE RULE", Intriguing Mezzanine) covers only that one
          // depletion: once the card has been restored it is gone (Q39).
          card.restoreLocked = undefined;

          this.emit({
            type: "cardRestored",
            cardId: targetId
          });
        }

        return;
      }

      case "restoreRule": {
        this.applyRestoreRule(context.controllerId);
        return;
      }

      case "developRule": {
        if (effect.draw !== undefined) this.developDraw(context.controllerId, effect.draw);
        else this.offerDevelopRule(context, effect.remaining);
        return;
      }

      case "addCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;
        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;

        const card = this.requireCard(targetId);
        // Tokens / counters exist only on cards in play (CR 409.1, 409.2): a
        // card that has left play can't take any (CR 402.5).
        if (
          card.zone !== "play" &&
          card.zone !== "deploying" &&
          (effect.counter === "token" || effect.counter === "scream")
        ) {
          return;
        }
        const delta = this.evaluateNumber(effect.amount, context);

        // A counter total an effect would push below 0 stays at 0 (CR 410.4).
        card.counters[effect.counter] = Math.max(
          0,
          (card.counters[effect.counter] ?? 0) + delta
        );

        if (delta !== 0) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: effect.counter });
        }

        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const before = card.counters[effect.counter] ?? 0;

        card.counters[effect.counter] = Math.max(
          0,
          before - this.evaluateNumber(effect.amount, context)
        );

        if (card.counters[effect.counter] !== before) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: effect.counter });
        }

        return;
      }

      case "createModifier": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const value = this.evaluateNumber(effect.value, context);

        this.state.modifiers.push({
          id: this.nextId("modifier"),
          sourceId: context.sourceId,
          sourceAbilityId: context.abilityId,
          targetId,
          stat: effect.stat,
          operation: effect.operation,
          value,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        this.emit({
          type: "statModified",
          cardId: targetId,
          stat: effect.stat,
          operation: effect.operation,
          value
        });

        return;
      }

      case "createAreaModifier": {
        // Standing form of `createModifier`: the selector is not resolved to cards here, only the number is.
        this.state.areaModifiers.push({
          id: this.nextId("modifier"),
          sourceId: context.sourceId,
          sourceAbilityId: context.abilityId,
          controllerId: context.controllerId,
          ...(context.opponentId !== undefined ? { opponentId: context.opponentId } : {}),
          selector: effect.selector,
          stat: effect.stat,
          operation: effect.operation,
          value: this.evaluateNumber(effect.value, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "takeControl": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const newController = this.resolvePlayerRef(effect.controller, context);

        // Only a card in play can be taken (CR §407.3).
        if (card.zone !== "play") return;

        // A permanent grab is the most recent control effect (CR §407.3a): an
        // older "this turn" grab no longer reverts the card when it lapses —
        // even when the permanent grab changes nothing (same controller).
        const permanentGrab = !effect.duration || effect.duration.type === "permanent";
        const dropOlderGrants = () => {
          this.state.controlGrants = this.state.controlGrants.filter(g => g.cardId !== targetId);
        };
        if (card.controllerId === newController.id) {
          if (permanentGrab) dropOlderGrants();
          return;
        }

        // "Opponents cannot take control of this card." (Gigantitect's Giant
        // Giant) — the grab fizzles when the current controller and the
        // would-be controller differ.
        if (
          this.hasRestriction(targetId, "cannotBeTakenControl") &&
          card.controllerId !== newController.id
        ) {
          return;
        }

        if (permanentGrab) dropOlderGrants();

        // "This turn, take control of the character." (Mutiny Grant) —
        // record the reversion target before we overwrite it. A card can be
        // grabbed durationally only once at a time; a fresh grab replaces
        // the pending reversion (keeping the *original* previous controller).
        if (effect.duration && effect.duration.type !== "permanent") {
          const existing = this.state.controlGrants.find(
            g => g.cardId === targetId
          );
          if (!existing) {
            this.state.controlGrants.push({
              id: this.nextId("controlGrant"),
              cardId: targetId,
              previousControllerId: card.controllerId,
              duration: effect.duration,
              createdTurn: this.state.turn
            });
          }
        }

        // A card in play is filed under its controller's `play` array
        // (see moveCard) — that bookkeeping has to move with it, or
        // getAvailableResourceIds/getThresholds/attack-eligibility loops
        // (all of which iterate a specific player's `play`) go stale.
        // A permanent grab is the most recent effect to set this card's
        // control (CR §407.3a), so the seat swap no longer decides where the
        // card goes when it is lifted. A durationed grab reverts to the
        // swapped-to controller, which lifting the swap still knows how to undo.
        if (
          this.state.seatSwap &&
          (!effect.duration || effect.duration.type === "permanent")
        ) {
          this.state.seatSwap.exchanged = this.state.seatSwap.exchanged.filter(
            e => e.cardId !== targetId
          );
        }
        this.reassignControl(targetId, newController.id);
        return;
      }

      case "removeFromGame": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        // RULES.md §12: impossible to fully carry out if it's already gone
        // — as far as "removed from the game" is concerned, that's already
        // true, so this is a no-op rather than an error.
        if (
          this.state.cards[targetId] &&
          !this.pickedCardMovedAway(effect.target, targetId, context)
        ) {
          this.moveCard(targetId, "removed");
          // Remember what removed it ("a tactic removed by this card": `voidedBySource`).
          const removed = this.state.cards[targetId];
          if (removed?.zone === "removed") removed.voidedBy = context.sourceId;
        }

        return;
      }

      case "forEach": {
        // Snapshot the match set before resolving anything — an earlier
        // iteration destroying/moving a card must not shrink who else is
        // hit by this same effect (RULES.md-style "simultaneous" resolution).
        let candidateIds = effect.selected
          ? context.selected[effect.selected] ?? []
          : this.queryCards(effect.selector!, context).map(card => card.id);

        // CR 507.2d: cards put into play by this one effect enter at the same
        // time, so an ATTACH TO card may pick a card entering with it as its
        // host. The cards that can host are put in first, the attaching cards
        // after them.
        if (effect.effects.some(e => e.type === "putIntoPlay")) {
          const attachesOnEntry = (id: CardInstanceId): boolean => {
            const candidate = this.state.cards[id];
            return !!candidate && candidate.zone !== "play" && !!this.getDefinition(id).attachTo;
          };
          candidateIds = [
            ...candidateIds.filter(id => !attachesOnEntry(id)),
            ...candidateIds.filter(attachesOnEntry)
          ];
        }

        const nestedCtx = (id: CardInstanceId): ResolutionContext => ({
          ...context,
          selected: { ...context.selected, __candidate: [id] }
        });

        // `sequential` — one iteration at a time through the suspendable
        // effect-frame path, so a per-iteration chooser pauses / resumes
        // (Degenerate Molestation). Mirrors `forEachPlayer`.
        if (effect.sequential) {
          for (let ci = 0; ci < candidateIds.length; ci++) {
            const done = this.runEffectFrame({
              effects: effect.effects,
              index: 0,
              context: nestedCtx(candidateIds[ci])
            });
            if (!done) {
              const remainder = this.state.pendingEffectFrames.pop()!;
              for (let rj = candidateIds.length - 1; rj > ci; rj--) {
                this.state.pendingEffectFrames.push({
                  effects: effect.effects,
                  index: 0,
                  context: nestedCtx(candidateIds[rj])
                });
              }
              this.state.pendingEffectFrames.push(remainder);
              return;
            }
          }
          return;
        }

        // "Destroy all ..." takes its cards out together (CR 305.2): judge "ignore leaves-play triggers" (Unwelcome
        // Hero) against the board as it was before the first of them moved.
        const ownsSimultaneousSnapshot =
          this.simultaneousIgnoredKinds === undefined && effect.effects.some(e => e.type === "destroy");
        if (ownsSimultaneousSnapshot) this.simultaneousIgnoredKinds = this.liveIgnoredTriggerKinds();
        this.beginEventBatch();
        try {
          for (let ci = 0; ci < candidateIds.length; ci++) {
            for (let ni = 0; ni < effect.effects.length; ni++) {
              this.resolveEffect(effect.effects[ni], nestedCtx(candidateIds[ci]));
              // An iteration raised a player choice (an optional replacement
              // such as Arcane Escrow's): the rest of this iteration and the
              // remaining candidates wait for the answer, then resume.
              if (this.state.pendingChoice) {
                for (let rj = candidateIds.length - 1; rj > ci; rj--) {
                  this.state.pendingEffectFrames.push({
                    effects: effect.effects,
                    index: 0,
                    context: nestedCtx(candidateIds[rj])
                  });
                }
                if (ni + 1 < effect.effects.length) {
                  this.state.pendingEffectFrames.push({
                    effects: effect.effects,
                    index: ni + 1,
                    context: nestedCtx(candidateIds[ci])
                  });
                }
                return;
              }
            }
          }
        } finally {
          if (ownsSimultaneousSnapshot) this.simultaneousIgnoredKinds = undefined;
          this.endEventBatch();
        }

        return;
      }

      case "repeatWhile": {
        // Judged before every pass, on the board as it is now. A pass that
        // pauses on a player choice leaves the loop itself (with the passes
        // still allowed) parked beneath the pass's own remainder.
        const maxPasses = effect.maxPasses ?? 1000;
        for (let pass = 0; pass < maxPasses; pass++) {
          if (!this.evaluateCondition(effect.condition, context)) return;
          const done = this.runEffectFrame({
            effects: effect.effects,
            index: 0,
            context: { ...context, selected: { ...context.selected } }
          });
          if (!done) {
            const remainder = this.state.pendingEffectFrames.pop()!;
            this.state.pendingEffectFrames.push({
              effects: [{ ...effect, maxPasses: maxPasses - pass - 1 }],
              index: 0,
              context
            });
            this.state.pendingEffectFrames.push(remainder);
            return;
          }
        }
        // Out of passes with the condition still holding and no choice that could
        // end it: the repetition is endless (CR 414.1).
        if (this.evaluateCondition(effect.condition, context)) {
          this.endlessLoopFound = true;
          throw new EndlessLoopError("A repeat-while effect is looping without end.");
        }
        return;
      }

      case "grantVoidPlay": {
        const player = this.resolvePlayerRef(effect.player, context);
        const granted: CardInstanceId[] = effect.selector
          ? this.queryCards(effect.selector, context).map(card => card.id)
          : context.selected[effect.selected ?? ""] ?? [];
        for (const cardId of granted) {
          const grantZone = this.state.cards[cardId]?.zone;
          if (grantZone !== "void" && grantZone !== "removed") continue;
          if (
            this.state.voidPlayGrants.some(
              g => g.cardId === cardId && g.playerId === player.id
            )
          ) {
            continue;
          }
          this.state.voidPlayGrants.push({
            cardId,
            playerId: player.id,
            ignoreThreshold: effect.ignoreThreshold ?? false,
            ...(context.sourceId ? { sourceId: context.sourceId } : {})
          });
        }
        return;
      }

      case "randomFromSelection": {
        const pool = [...(context.selected[effect.selected] ?? [])];
        const take = Math.min(
          pool.length,
          Math.max(0, this.evaluateNumber(effect.count, context))
        );
        // Fisher–Yates prefix using the seeded RNG.
        for (let i = 0; i < take; i++) {
          const j = i + Math.floor(this.random() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const chosen = pool.slice(0, take);

        this.beginEventBatch();
        try {
          for (const candidateId of chosen) {
            const nestedContext: ResolutionContext = {
              ...context,
              selected: { ...context.selected, __candidate: [candidateId] }
            };
            for (const nested of effect.effects) {
              this.resolveEffect(nested, nestedContext);
            }
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "attachTo": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const toId = this.resolveTargetRef(effect.to, context);
        if (!targetId || !toId) return;

        const card = this.requireCard(targetId);
        if (card.attachedTo === toId) return;
        if (
          this.resourceEntering?.cardId === targetId &&
          card.zone !== "play" &&
          this.state.cards[toId]?.zone === "play"
        ) {
          this.resourceEntering.attachTo = toId;
          return;
        }
        // "Attach ... if you can": a new host (or card) that already left
        // play can't be attached to; the card stays where it was (CR 402.5).
        if (card.zone !== "play" || this.state.cards[toId]?.zone !== "play") {
          return;
        }
        card.attachedTo = toId;
        this.emit({ type: "cardAttached", cardId: targetId, hostId: toId });
        return;
      }

      case "grantKeyword": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.keywordGrants.push({
          id: this.nextId("keywordGrant"),
          sourceId: context.sourceId,
          targetId,
          keyword: effect.keyword,
          duration: effect.duration,
          ...(effect.condition ? { condition: effect.condition, controllerId: context.controllerId } : {}),
          ...(this.hasCardType(targetId, "character") ? { whileCharacter: true } : {}),
          createdTurn: this.state.turn
        });

        return;
      }

      case "suppressKeyword": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.keywordSuppressions.push({
          id: this.nextId("keywordSuppression"),
          sourceId: context.sourceId,
          targetId,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "grantRestriction": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.restrictions.push({
          id: this.nextId("restriction"),
          sourceId: context.sourceId,
          targetId,
          restriction: effect.restriction,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "transformBattleDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        this.state.battleDamageTransforms.push({
          id: this.nextId("bdTransform"),
          sourceId: context.sourceId,
          cardId: targetId,
          role: effect.role,
          kind: effect.kind,
          amount:
            effect.amount !== undefined
              ? Math.max(0, this.evaluateNumber(effect.amount, context))
              : undefined,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "suppressAbilities": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        this.state.abilitySuppressions.push({
          id: this.nextId("abilitySuppression"),
          sourceId: context.sourceId,
          targetId,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantKeywordToPlayer": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.state.playerKeywordGrants.push({
          id: this.nextId("playerKeywordGrant"),
          sourceId: context.sourceId,
          playerId: player.id,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "modifyOutgoingDamage": {
        const sourceId = this.resolveTargetRef(effect.source, context);
        if (!sourceId) return;
        this.state.outgoingDamageModifiers.push({
          id: this.nextId("outgoingDmgMod"),
          sourceId,
          toFactionOf: effect.toFaction
            ? this.resolvePlayerRef(effect.toFaction, context).id
            : undefined,
          delta: this.evaluateNumber(effect.delta, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "modifyIncomingDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        this.state.outgoingDamageModifiers.push({
          id: this.nextId("incomingDmgMod"),
          sourceId: context.sourceId,
          targetId,
          delta: this.evaluateNumber(effect.delta, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantResourceIcons": {
        const player = this.resolvePlayerRef(effect.player, context);

        this.state.resourceGrants.push({
          id: this.nextId("resourceGrant"),
          playerId: player.id,
          icon: effect.icon,
          amount: this.evaluateNumber(effect.amount, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "reduceThreshold": {
        const player = this.resolvePlayerRef(effect.player, context);
        const icon: ResourceIcon | undefined =
          typeof effect.icon === "string"
            ? effect.icon
            : (this.state.cards[context.sourceId]?.namedValues?.[
                effect.icon.fromNamed
              ] as ResourceIcon | undefined);
        if (!icon) return;

        this.state.thresholdReductions.push({
          id: this.nextId("thresholdReduction"),
          playerId: player.id,
          icon,
          amount: Math.max(0, this.evaluateNumber(effect.amount, context)),
          ...(effect.persistent ? { persistent: true } : {}),
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantProvides": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        const icon: ResourceIcon | undefined =
          typeof effect.icon === "string"
            ? effect.icon
            : (this.state.cards[context.sourceId]?.namedValues?.[
                effect.icon.fromNamed
              ] as ResourceIcon | undefined);
        if (!icon) return;

        const amount = this.evaluateNumber(effect.amount, context);
        if (amount <= 0) return;

        // "each ... that doesn't have PROVIDES: X, gains PROVIDES: X".
        if (effect.onlyIfLacking && this.getResourceIcons(targetId).includes(icon)) {
          return;
        }

        this.state.provideGrants.push({
          id: this.nextId("provideGrant"),
          sourceId: context.sourceId,
          targetId,
          icon,
          amount,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "detach": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (targetId && this.state.cards[targetId]) {
          this.state.cards[targetId].attachedTo = undefined;
        }
        return;
      }

      case "restrictPlay": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.state.playRestrictions.push({
          id: this.nextId("playRestriction"),
          playerId: player.id,
          kind: effect.kind,
          cardType: effect.cardType,
          duration: effect.duration,
          createdTurn: this.state.turn,
          sourceId: context.sourceId
        });
        return;
      }

      case "preventAllDamage": {
        this.state.damagePreventionWindows.push({
          id: this.nextId("damagePreventionWindow"),
          sourceId: context.sourceId,
          battleOnly: effect.battleOnly,
          duration: effect.duration,
          createdTurn: this.state.turn,
          ...(effect.exceptCosts ? { exceptCosts: true } : {})
        });
        return;
      }

      case "restrictDestruction": {
        this.state.destructionRestrictionWindows.push({
          id: this.nextId("destructionRestrictionWindow"),
          sourceId: context.sourceId,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantSubtype": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        this.state.subtypeGrants.push({
          id: this.nextId("subtypeGrant"),
          sourceId: context.sourceId,
          targetId,
          subtype: effect.subtype,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "redirectHandMoves": {
        this.state.handMoveRedirects.push({
          id: this.nextId("handMoveRedirect"),
          sourceId: context.sourceId,
          sourceControllerId: context.controllerId,
          ...(context.opponentId !== undefined ? { opponentId: context.opponentId } : {}),
          who: effect.who,
          to: effect.to,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "installReplacement": {
        this.state.runtimeReplacements.push({
          id: this.nextId("runtimeReplacement"),
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          ...(context.opponentId !== undefined ? { opponentId: context.opponentId } : {}),
          replaces: effect.replaces,
          condition: effect.condition,
          effects: effect.effects,
          optional: effect.optional,
          once: effect.once,
          selected: structuredClone(context.selected ?? {}),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "spendCountersMenu": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.openSpendCountersMenu(
          chooser.id,
          effect.pool,
          effect.counter,
          effect.options,
          context
        );
        return;
      }

      case "scheduleEffect": {
        this.state.scheduledEffects.push({
          id: this.nextId("scheduled"),
          when: effect.when,
          turnScheduled: this.state.turn,
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          ...(context.opponentId !== undefined ? { opponentId: context.opponentId } : {}),
          condition: effect.condition,
          effects: effect.effects,
          event: context.event ? structuredClone(context.event) : undefined,
          selected: structuredClone(context.selected)
        });
        // Log-only (`recordLogEvent`, not `emit`): no trigger, tally or queue effect — the game plays exactly as before.
        const scheduled = this.state.scheduledEffects[this.state.scheduledEffects.length - 1];
        this.recordLogEvent({
          type: "effectScheduled",
          scheduledId: scheduled.id,
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          when: scheduled.when
        });
        return;
      }

      case "useAnyAbility": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        // The faction card is a card the player controls too (FAQ: "You can use
        // your Faction's abilities any time you can legally use an ability").
        const ownFaction = this.requirePlayer(chooser.id).factionId;
        const anyAbilityPool = this.requirePlayer(chooser.id).play.includes(ownFaction as CardInstanceId)
          ? this.requirePlayer(chooser.id).play
          : [...this.requirePlayer(chooser.id).play, ...(ownFaction ? [ownFaction] : [])];
        const candidates = anyAbilityPool.filter(cardId => {
          const card = this.state.cards[cardId];
          if (!card || card.controllerId !== chooser.id || card.faceDown) {
            return false;
          }
          if (
            effect.selector &&
            !this.matchesSelector(card, effect.selector, context)
          ) {
            return false;
          }
          return this.getCardActivatedAbilities(cardId).length > 0;
        });

        if (candidates.length === 0) return;

        this.state.pendingChoice = {
          kind: "useAnyAbility",
          id: this.nextId("choice"),
          playerId: chooser.id,
          candidateCardIds: candidates,
          context
        };
        return;
      }

      case "if": {
        const branch = this.evaluateCondition(effect.condition, context)
          ? effect.effects
          : effect.elseEffects ?? [];

        for (let n = 0; n < branch.length; n++) {
          this.followingEffect = branch[n + 1];
          this.resolveEffect(branch[n], context);
          // A nested effect opened a choice (its own, or one from a trigger
          // it set off): the rest of the branch waits for the answer instead
          // of overwriting it (two Milkshakes echoing one deploy, SYS-62).
          if (this.state.pendingChoice && n < branch.length - 1) {
            this.state.pendingEffectFrames.push({
              effects: branch.slice(n + 1),
              index: 0,
              context
            });
            return;
          }
        }

        return;
      }

      case "shuffleDeck": {
        // Q2: a "may search" that was declined is no search, so there is
        // nothing to shuffle after it.
        if (this.shuffleFollowsDeclinedSearch(context)) return;
        const player = this.resolvePlayerRef(effect.player, context);
        this.shuffleDeckOf(player.id);
        return;
      }

      case "chooserSelectsTarget": {
        // RULES.md §12: an instruction impossible to fully carry out (no
        // legal candidate at all, e.g. an empty hand to discard from) is
        // carried out as far as possible, not left as an unanswerable
        // pendingChoice requiring a selection that can't exist.
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const cstCandidates = this.targetCandidates(
          effect.declaration.selector,
          context,
          chooser.id
        );
        if (cstCandidates.length === 0) {
          // CR 312.1/312.2: a deck search that finds nothing is still a search,
          // so the searched deck is shuffled afterwards.
          const peeksTopOnly = (effect.declaration.selector as { fromTop?: unknown }).fromTop !== undefined;
          if (this.selectorNamesZone(effect.declaration.selector, "deck") && !peeksTopOnly) {
            const authored = effect.effects.some(e => e.type === "shuffleDeck");
            const laterShuffle =
              this.state.pendingEffectFrames.some(f =>
                JSON.stringify(f.effects.slice(f.index)).includes('"shuffleDeck"')
              ) ||
              (this.runningFrame !== undefined &&
                JSON.stringify(
                  this.runningFrame.effects.slice(this.runningFrame.index)
                ).includes('"shuffleDeck"'));
            if (!authored && !laterShuffle) {
              // No shuffle authored anywhere: the engine shuffles the searched deck.
              const sel = effect.declaration.selector as { owner?: string; controller?: string };
              const who = sel.owner ?? sel.controller;
              if (who === undefined || who === "self" || who === "opponent") {
                const shuffled =
                  who !== "opponent"
                    ? [chooser.id]
                    : chooser.id === context.controllerId
                      ? this.opponentIdsFor(context)
                      : opponentsOf(this.state, chooser.id);
                for (const playerId of shuffled) this.shuffleDeckOf(playerId);
              }
            }
            for (const nested of effect.effects) {
              if (nested.type !== "shuffleDeck") continue;
              // The deck to shuffle may be named by the (absent) picked card.
              try {
                this.resolveEffect(nested, context);
              } catch {
                /* unresolvable owner: nothing to shuffle */
              }
            }
          }
          // SYS-13: an OPTIONAL pick with nothing to pick is the same as
          // declining it, so the sibling "if you don't / otherwise" effects
          // authored beside the `targetExists` guard still run.
          if (
            effect.declaration.optional &&
            (!this.selectorNamesZone(effect.declaration.selector, "deck") || peeksTopOnly)
          ) {
            const noneContext: ResolutionContext = {
              ...context,
              selected: { ...context.selected, [effect.declaration.id]: [] }
            };
            for (const nested of effect.effects) {
              this.resolveEffect(nested, noneContext);
            }
          }
          return;
        }

        // "Choose X ..." with X = 0 (or a search for X-1 = 0 cards): nothing
        // to choose, so no prompt is opened (and nothing is searched).
        if (this.evaluateNumber(effect.declaration.count, context) <= 0) {
          // The follow-up effects still run, with an empty selection (Arcana
          // Experiment's unpicked cards still go to the discard pile).
          const emptyContext: ResolutionContext = {
            ...context,
            selected: { ...context.selected, [effect.declaration.id]: [] }
          };
          for (const nested of effect.effects) {
            this.resolveEffect(nested, emptyContext);
          }
          return;
        }

        if (effect.declaration.random) {
          // "… at random": the engine draws; no prompt.
          const pool = cstCandidates.map(c => c.id);
          const wanted = Math.min(
            this.evaluateNumber(effect.declaration.count, context),
            pool.length
          );
          const randomPicks: CardInstanceId[] = [];
          while (randomPicks.length < wanted) {
            const k = Math.floor(this.random() * pool.length);
            randomPicks.push(pool.splice(k, 1)[0]);
          }
          const randomContext: ResolutionContext = {
            ...context,
            selected: { ...context.selected, [effect.declaration.id]: randomPicks }
          };
          for (const nested of effect.effects) {
            this.resolveEffect(nested, randomContext);
          }
          return;
        }

        // `autoWhenForced`: a mandatory pick with no more candidates than
        // slots is no decision at all, so nobody is prompted (Subordinate
        // Demotivation with a single lowest-cost character).
        if (effect.autoWhenForced && !effect.declaration.optional) {
          const need = this.evaluateNumber(effect.declaration.count, context);
          if (cstCandidates.length <= need) {
            const forced = cstCandidates.map(card => card.id);
            const forcedContext: ResolutionContext = {
              ...context,
              selected: { ...context.selected, [effect.declaration.id]: forced }
            };
            this.emitCardPicked({ [effect.declaration.id]: forced }, chooser.id);
            for (const nested of effect.effects) {
              this.resolveEffect(nested, forcedContext);
            }
            return;
          }
        }

        const searchesDeck = this.selectorNamesZone(
          effect.declaration.selector,
          "deck"
        );
        const deckOwnerId =
          searchesDeck && cstCandidates[0]
            ? this.zoneHolderId(cstCandidates[0])
            : undefined;

        // "Your opponents must pay N to search their deck." (Department of
        // Rejections) — an in-play `ContinuousAbility.searchTax` on a player
        // searching their OWN deck. Unpayable => the search does nothing.
        if (deckOwnerId && deckOwnerId === chooser.id) {
          const tax = this.searchTaxFor(chooser.id);
          if (tax > 0) {
            if (this.getAvailableResourceIds(chooser.id).length < tax) {
              return;
            }
            this.payNumericCost(chooser.id, tax);
          }
        }

        // "If a player would search their deck you may pay 1 instead. If you
        // do, draw a card and then that player searches" (Golden Charm) —
        // picking a card from a deck IS the search, and it is announced
        // BEFORE the pick is offered. A prompt the announcement raises is
        // answered first; `runEffectFrame` then runs this effect again.
        // (A prompt already open - an earlier trigger of the same batch - is
        // not interrupted: the announcement then follows the pick, as before.)
        let announced = this.announcedSearch === effect;
        if (deckOwnerId && !announced && !this.state.pendingChoice) {
          announced = true;
          this.announceDeckSearch(deckOwnerId);
          if (this.state.pendingChoice) {
            this.retrySearchFrame = {
              effects: [effect],
              index: 0,
              context,
              announcedEffect: effect
            };
            return;
          }
        }
        this.announcedSearch = undefined;

        this.state.pendingChoice = {
          kind: "chooserSelectsTarget",
          id: this.nextId("choice"),
          playerId: chooser.id,
          declaration: this.freezeDeclarationPlayers(effect.declaration, context),
          effects: effect.effects,
          context
        };

        if (deckOwnerId && !announced) {
          this.emit({ type: "deckSearched", playerId: deckOwnerId });
        }

        return;
      }

      case "chooserSelectsOption": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);

        const unavailableOptions = effect.options
          .map((option, index) =>
            option.condition && !this.evaluateCondition(option.condition, context) ? index : -1
          )
          .filter(index => index >= 0);
        // Every option unavailable: there is nothing to choose.
        if (unavailableOptions.length === effect.options.length) return;
        this.state.pendingChoice = {
          kind: "chooserSelectsOption",
          id: this.nextId("choice"),
          playerId: chooser.id,
          optionCount: effect.options.length,
          options: effect.options,
          ...(unavailableOptions.length > 0 ? { unavailableOptions } : {}),
          style: "oneOf",
          context
        };

        return;
      }

      case "setDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card && card.zone === "play") {
          card.damage = Math.max(0, this.evaluateNumber(effect.amount, context));
        }
        return;
      }

      case "healDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card && card.zone === "play") {
          card.damage = Math.max(
            0,
            (card.damage ?? 0) - Math.max(0, this.evaluateNumber(effect.amount, context))
          );
        }
        return;
      }

      case "removeFromBattle": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const battle = this.state.battle;
        if (!targetId || !battle) return;
        battle.attackingParty = battle.attackingParty.filter(x => x !== targetId);
        battle.blockingParty = battle.blockingParty.filter(x => x !== targetId);
        return;
      }

      case "addToBattle": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const battle = this.state.battle;
        if (!targetId || !battle || battle.phase === "finished") return;

        const card = this.state.cards[targetId];
        if (
          !card ||
          card.zone !== "play" ||
          card.faceDown ||
          !this.hasCardType(targetId, "character")
        ) {
          return;
        }

        const side =
          effect.side === "attacking" ? battle.attackingParty : battle.blockingParty;
        const sideOwner =
          effect.side === "attacking"
            ? battle.attackerPlayerId
            : battle.defenderPlayerId;
        if (card.controllerId !== sideOwner) return;
        if (!side.includes(targetId)) side.push(targetId);
        this.recordBattleParticipants(battle, [targetId], effect.side === "attacking" ? "attacking" : "blocking");
        return;
      }

      case "nameValue": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.state.pendingChoice = {
          kind: "nameValue",
          id: this.nextId("choice"),
          playerId: chooser.id,
          valueKind: effect.valueKind,
          ...(effect.exclude ? { exclude: effect.exclude } : {}),
          ...(effect.nonResource ? { nonResource: true } : {}),
          ...this.nameOptionsField(effect.valueKind, effect.exclude),
          sourceId: context.sourceId,
          storeAs: effect.storeAs
        };
        return;
      }

      case "mayPay": {
        if (effect.anyOf === "opponents") {
          // "Any opponent may pay ..." (E5): every opponent who can afford it, in turn order.
          const payers = opponentsOf(this.state, context.controllerId).filter(id => {
            const payCtx = { ...context, controllerId: id };
            return this.canPayCosts(this.withPendingReductions(effect.costs, payCtx).costs, payCtx);
          });
          if (payers.length === 0) {
            for (const e of effect.elseEffects ?? []) this.resolveEffect(e, context);
            return;
          }
          this.state.pendingChoice = {
            kind: "mayPay",
            id: this.nextId("choice"),
            playerId: payers[0],
            cost: structuredClone(effect.costs),
            effects: effect.effects,
            elseEffects: effect.elseEffects ?? [],
            remainingPayers: payers.slice(1),
            context
          };
          return;
        }
        const player = this.resolvePlayerRef(effect.player, context);
        // The prospective payer isn't always the ability's controller
        // ("that player may pay 2", "any opponent may pay 3") — check
        // affordability against, and later pay from, THEIR resources.
        const payCtx =
          player.id === context.controllerId
            ? context
            : { ...context, controllerId: player.id };
        if (!this.canPayCosts(this.withPendingReductions(effect.costs, payCtx).costs, payCtx)) {
          for (const e of effect.elseEffects ?? []) this.resolveEffect(e, context);
          return;
        }
        // "you may pay 2 and pick a character": nothing to pick means the
        // elected action can't be carried out, so nothing is offered or paid.
        {
          const firstEffect = effect.effects[0];
          if (
            firstEffect?.type === "chooserSelectsTarget" &&
            effect.payAndPick &&
            this.targetCandidates(
              firstEffect.declaration.selector,
              payCtx,
              this.resolvePlayerRef(firstEffect.chooser, payCtx).id
            ).length === 0
          ) {
            for (const e of effect.elseEffects ?? []) this.resolveEffect(e, context);
            return;
          }
        }
        this.state.pendingChoice = {
          kind: "mayPay",
          id: this.nextId("choice"),
          playerId: player.id,
          cost: structuredClone(effect.costs),
          effects: effect.effects,
          elseEffects: effect.elseEffects ?? [],
          ...(effect.payAndPick ? { payAndPick: true } : {}),
          context
        };
        return;
      }

      case "createTokens": {
        const controller = this.resolvePlayerRef(effect.controller, context);
        const count = Math.max(0, this.evaluateNumber(effect.count, context));
        const made: CardInstanceId[] = [];
        for (let i = 0; i < count; i++) {
          made.push(
            this.createTokenPermanent(controller.id, effect.token, context.controllerId)
          );
        }
        // "... This turn, all damage inflicted to that token is reduced to
        // 0." — per-token follow-up effects, the new token bound to
        // `__candidate` (Micromajigmakermachinemajig, Micromajig Recycling).
        for (const tokenId of made) {
          for (const sub of effect.effects ?? []) {
            this.resolveEffect(sub, {
              ...context,
              selected: { ...context.selected, __candidate: [tokenId] }
            });
          }
        }
        return;
      }

      case "useTargetAbility": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        // CR 402.5: a pick a response destroyed or moved away is no longer there to use.
        if (this.pickedCardMovedAway(effect.target, targetId, context)) return;
        const abilities = this.getCardActivatedAbilities(targetId);
        if (abilities.length === 0) return;
        this.state.pendingChoice = {
          kind: "useTargetAbility",
          id: this.nextId("choice"),
          playerId: chooser.id,
          targetCardId: targetId,
          abilityIds: abilities.map(a => a.id),
          times: effect.times ?? 1
        };
        return;
      }

      case "forEachPlayer": {
        // "Each player": every living seat from the active player, each one
        // resolving as its own controller. "Each opponent" (E1): every
        // opponent of the resolving controller, bound as its opponent in turn.
        const eachOpponent = effect.players === "opponents";
        // "Both players" (MP 3): the controller and the opponent this block is about, in turn order.
        const both =
          effect.players === "controllerAndOpponent"
            ? new Set([context.controllerId, ...this.opponentIdsFor(context).slice(0, 1)])
            : undefined;
        const order = eachOpponent
          ? opponentsOf(this.state, context.controllerId)
          : livingSeats(this.state).filter(id => !both || both.has(id));
        const contextFor = (playerId: PlayerId): ResolutionContext =>
          eachOpponent
            ? { ...context, opponentId: playerId }
            : { ...context, controllerId: playerId, opponentId: undefined };
        for (let pi = 0; pi < order.length; pi++) {
          const pctx = contextFor(order[pi]);
          const framesBefore = this.state.pendingEffectFrames.length;
          const done = this.runEffectFrame({
            effects: effect.effects,
            index: 0,
            context: pctx
          });
          if (!done) {
            // A nested effect paused for this player. runEffectFrame just
            // pushed this player's remainder (and a search to re-run, see
            // `retrySearchFrame`) on top of pendingEffectFrames; move them
            // above the still-to-go players so resume order is
            // [this player's remainder, next player, ...].
            const remainder = this.state.pendingEffectFrames.splice(framesBefore);
            for (let rj = order.length - 1; rj > pi; rj--) {
              this.state.pendingEffectFrames.push({
                effects: effect.effects,
                index: 0,
                context: contextFor(order[rj])
              });
            }
            this.state.pendingEffectFrames.push(...remainder);
            return;
          }
        }
        return;
      }

      case "lookAndReorder": {
        const player = this.resolvePlayerRef(effect.player, context);
        const chooser = effect.chooser
          ? this.resolvePlayerRef(effect.chooser, context)
          : player;
        const count = this.evaluateNumber(effect.count, context);
        const cardIds = player.deck.slice(0, Math.max(0, count));

        if (cardIds.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "reorderDeck",
          id: this.nextId("choice"),
          playerId: chooser.id,
          deckOwnerId: player.id,
          cardIds,
          to: effect.intoHand ? "bottom" : (effect.to ?? "top"),
          ...(effect.intoHand
            ? {
                intoHand: {
                  min: Math.min(effect.intoHand.min, cardIds.length),
                  max: Math.min(effect.intoHand.max, cardIds.length)
                }
              }
            : {}),
          ...(effect.upTo ? { upTo: true } : {}),
          ...(effect.bottomCount !== undefined
            ? {
                bottomCount: Math.min(
                  cardIds.length,
                  Math.max(0, this.evaluateNumber(effect.bottomCount, context))
                )
              }
            : {})
        };

        return;
      }

      case "reduceNextCost": {
        const player = this.resolvePlayerRef(effect.player, context);
        const amount = this.evaluateNumber(effect.amount, context);

        this.state.costReductions.push({
          id: this.nextId("costReduction"),
          playerId: player.id,
          amount,
          cardType: effect.cardType,
          ...(effect.includeAbilities ? { includeAbilities: true } : {}),
          ...(effect.cardsOnly ? { cardsOnly: true } : {}),
          createdTurn: this.state.turn
        });

        return;
      }

      case "deployForFree": {
        const player = this.resolvePlayerRef(effect.player, context);
        const perCardCap = this.evaluateNumber(effect.maxCost, context);
        const budget =
          effect.budget === undefined
            ? undefined
            : Math.max(0, this.evaluateNumber(effect.budget, context));
        const cap = budget === undefined ? perCardCap : Math.min(perCardCap, budget);

        const candidates = this.deployForFreeCandidates(
          player.id,
          cap,
          effect.selector,
          context
        );

        if (candidates.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "deployForFree",
          id: this.nextId("choice"),
          playerId: player.id,
          candidates,
          resolvedMaxCost: cap,
          payCost: effect.free === false,
          budgetRemaining: budget,
          perCardCap: budget === undefined ? undefined : perCardCap,
          selector: budget === undefined ? undefined : effect.selector,
          context
        };

        return;
      }

      case "distributeAmong": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        // CR 402.4/402.5a: a picked card that changed areas in response is
        // lost track of, so it is no longer one of the recipients.
        const targets = effect.among
          ? this.queryCards(effect.among, context).map(card => card.id)
          : (context.selected[effect.selected ?? ""] ?? []).filter(
              id =>
                !this.pickedCardMovedAway(
                  { type: "selected", id: effect.selected ?? "" },
                  id,
                  context
                )
            );
        const amount = this.evaluateNumber(effect.amount, context);

        if (targets.length === 0 || amount <= 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "distributeAmong",
          id: this.nextId("choice"),
          playerId: chooser.id,
          targets,
          amount,
          // "Inflict up to 2 damage divided however you want": whether the
          // whole amount must be given.
          upTo: effect.upTo === true,
          caps: effect.maxShare
            ? Object.fromEntries(
                targets.map(id => [
                  id,
                  Math.max(
                    0,
                    this.evaluateNumber(effect.maxShare!, {
                      ...context,
                      selected: { ...context.selected, __candidate: [id] }
                    })
                  )
                ])
              )
            : undefined,
          effects: effect.effects,
          context
        };

        return;
      }

      case "separateIntoPiles": {
        const splitter = this.resolvePlayerRef(effect.splitter, context);
        const cardIds = context.selected[effect.selected] ?? [];
        if (cardIds.length === 0) return;
        this.state.pendingChoice = {
          kind: "pileAssignment",
          id: this.nextId("choice"),
          playerId: splitter.id,
          cardIds: [...cardIds],
          pile1Effects: effect.pile1,
          pile2Effects: effect.pile2,
          ...(effect.picker ? { pickerId: this.resolvePlayerRef(effect.picker, context).id } : {}),
          context
        };
        return;
      }

      case "anyPlayerMayPay": {
        const order =
          effect.players === "opponents" ? opponentsOf(this.state, context.controllerId) : livingSeats(this.state);
        if (order.length === 0) return;
        this.state.pendingChoice = {
          kind: "anyPlayerMayPay",
          id: this.nextId("choice"),
          playerId: order[0],
          remaining: order.slice(1),
          cost: structuredClone(effect.costs),
          effects: effect.effects,
          context
        };
        return;
      }

      case "alternatingPayLoop": {
        const a = this.resolvePlayerRef(effect.first, context).id;
        const b = this.resolvePlayerRef(effect.opponent, context).id;
        this.state.pendingChoice = {
          kind: "alternatingPay",
          id: this.nextId("choice"),
          playerId: a,
          players: [a, b],
          turnIndex: 0,
          cost: structuredClone(effect.cost),
          roundsLeft: (effect.maxRounds ?? 20) * 2,
          tallies: { [a]: 0, [b]: 0 },
          onEnd: effect.onEnd,
          context
        };
        return;
      }

      case "lockAbilityThisTurn": {
        const locks: string[] = [];
        if (effect.target === "respondedAbility") {
          let found: { sourceId: string; abilityId: string } | undefined;
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (
              item.kind === "ability" &&
              item.abilityId &&
              item.sourceId !== context.sourceId
            ) {
              found = { sourceId: item.sourceId, abilityId: item.abilityId };
              break;
            }
          }
          found ??= this.lastTerminatedAbility;
          if (found) locks.push(`${found.sourceId}:${found.abilityId}`);
        } else {
          const cardId = this.resolveTargetRef(effect.target, context);
          if (cardId) {
            for (const a of this.getDefinition(cardId).behavior?.abilities ?? []) {
              if (a.type === "activated") locks.push(`${cardId}:${a.id}`);
            }
          }
        }
        for (const key of locks) {
          this.state.abilityUsesThisTurn[key] = Number.MAX_SAFE_INTEGER;
        }
        return;
      }

      case "flipCoin": {
        const flipper = this.resolvePlayerRef(
          effect.player ?? "controller",
          context
        );
        const won = this.random() < 0.5;

        if (!won && this.costEffectDepth === 0) {
          const repl = this.findCoinFlipLossReplacement(flipper.id, context);
          if (repl) {
            this.state.pendingCoinFlip = {
              context,
              flipperId: flipper.id,
              winEffects: structuredClone(effect.winEffects),
              loseEffects: structuredClone(effect.loseEffects),
              replacementCost: structuredClone(repl.cost),
              replacementEffects: structuredClone(repl.effects),
              replacementSourceId: repl.sourceId
            };
            this.state.pendingChoice = {
              kind: "coinFlipReplace",
              id: this.nextId("choice"),
              playerId: flipper.id,
              cost: structuredClone(repl.cost),
              sourceId: repl.sourceId,
              flipSourceId: context.sourceId,
              won: false
            };
            return;
          }
        }

        this.emit({ type: "coinFlipped", playerId: flipper.id, won });
        for (const sub of won ? effect.winEffects : effect.loseEffects) {
          this.resolveEffect(sub, context);
          this.checkStateBasedActions();
        }
        return;
      }

      case "restrictBlockers": {
        const targetId = this.resolveTargetRef(effect.target ?? "source", context);
        if (!targetId) return;
        this.state.blockRestrictionGrants.push({
          id: this.nextId("blockRestriction"),
          sourceId: context.sourceId,
          targetId,
          minPartySize: effect.minPartySize,
          minSpeed: effect.minSpeed,
          condition: effect.condition,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "requireBlock": {
        const attackerId = this.resolveTargetRef(effect.target ?? "source", context);
        if (!attackerId) return;
        let blockerId: CardInstanceId | undefined;
        if (effect.blocker) {
          // A named blocker that did not get picked / left play: no obligation.
          blockerId = this.resolveTargetRef(effect.blocker, context);
          if (!blockerId) return;
        }
        this.state.mustBlockGrants.push({
          id: this.nextId("mustBlock"),
          sourceId: context.sourceId,
          attackerId,
          blockerId,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restrictParty": {
        const targetId = this.resolveTargetRef(effect.target ?? "source", context);
        if (!targetId) return;
        this.state.partyRestrictionGrants.push({
          id: this.nextId("partyRestriction"),
          sourceId: context.sourceId,
          targetId,
          role: effect.role,
          minMembers: effect.minMembers,
          maxMembers: effect.maxMembers,
          parity: effect.parity,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restrictBlockersToChosen": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished") return;
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const candidates = this.targetCandidates(
          effect.declaration.selector,
          { ...context, controllerId: chooser.id }
        ).map(card => card.id);
        this.state.pendingChoice = {
          kind: "chooseChosenBlockers",
          id: this.nextId("choice"),
          playerId: chooser.id,
          candidates,
          sourceId: context.sourceId
        };
        return;
      }

      case "grantAbilitiesFrom": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const fromId = this.resolveTargetRef(effect.from, context);
        if (!targetId || !fromId) return;
        // "All rules text": activated, triggered and continuous abilities
        // (a granted continuous ability is resolved with the recipient as its
        // source) plus the printed keywords.
        const fromBehavior = this.getDefinition(fromId).behavior;
        const abilities = (fromBehavior?.abilities ?? []).filter(
          a =>
            a.type === "activated" ||
            a.type === "triggered" ||
            a.type === "continuous"
        );
        if (abilities.length > 0) {
          this.state.abilityGrants.push({
            id: this.nextId("abilityGrant"),
            cardId: targetId,
            sourceId: context.sourceId,
            abilities: structuredClone(abilities)
          });
        }
        for (const keyword of fromBehavior?.keywords ?? []) {
          this.state.keywordGrants.push({
            id: this.nextId("keywordGrant"),
            sourceId: context.sourceId,
            targetId,
            keyword,
            duration: { type: "permanent" },
            createdTurn: this.state.turn
          });
        }
        return;
      }

      case "redirectAttackTarget": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished") return;
        const toId = this.resolveTargetRef(effect.to, context);
        const toCard = toId ? this.state.cards[toId] : undefined;
        if (!toCard || toCard.zone !== "play") return;
        battle.target = { type: "card", cardId: toId! };
        battle.defenderPlayerId = toCard.controllerId;
        return;
      }

      case "initiateAttack": {
        const attackerIds = (context.selected[effect.attackerSelection] ?? [])
          .filter(id => {
            const c = this.state.cards[id];
            return (
              c &&
              c.zone === "play" &&
              !c.faceDown &&
              this.hasCardType(id, "character") &&
              !c.depleted &&
              !this.hasRestriction(id, "cannotAttack") &&
              // "Attack your opponent" still follows CR 204.3 (Q28).
              this.startedTurnInPlayUnderControl(id)
            );
          });
        if (attackerIds.length === 0) return;
        const defender = this.resolvePlayerRef(effect.target, context);
        this.runInitiatedAttack(attackerIds, defender.id);
        return;
      }

      case "auctionForCard": {
        const deckOwner = this.resolvePlayerRef(effect.revealFor, context);
        this.beginAuction(context, deckOwner.id);
        return;
      }
    }
  }

  /**
   * The `alternatingPay` loop step: `paid` records this decider's choice.
   * On accept, pay + tally + hand to the other player; on decline (or when
   * rounds run out) end the loop — merge the tallies into
   * `context.variables["paid:<playerId>"]` and queue `onEnd`.
   */
  private advanceAlternatingPay(
    pending: Extract<PendingChoice, { kind: "alternatingPay" }>,
    paid: boolean
  ): void {
    const decider = pending.players[pending.turnIndex];
    const asCost = pending.resumeAction !== undefined && pending.costStepKey !== undefined;

    if (
      paid &&
      (asCost
        ? this.alternatingPayCanPay(pending.cost, decider, pending.context, pending.reserve)
        : this.canPayWithReductions(pending.cost, { ...pending.context, controllerId: decider }))
    ) {
      this.payWithReductions(pending.cost, { ...pending.context, controllerId: decider });
      pending.tallies[decider] = (pending.tallies[decider] ?? 0) + 1;

      const nextIndex = (pending.turnIndex === 0 ? 1 : 0) as 0 | 1;
      // As a cost, a player who cannot pay again is not asked: the loop is over for them.
      const nextPlayer = pending.players[nextIndex];
      if (
        pending.roundsLeft > 1 &&
        (!asCost || this.alternatingPayCanPay(pending.cost, nextPlayer, pending.context, pending.reserve))
      ) {
        this.state.pendingChoice = {
          ...pending,
          id: this.nextId("choice"),
          playerId: pending.players[nextIndex],
          turnIndex: nextIndex,
          roundsLeft: pending.roundsLeft - 1
        };
        return;
      }
    }

    // Loop over — resume with the tallies bound. Both a role-keyed pair
    // (`__paidByFirst` / `__paidByOpponent`) and per-id keys
    // (`paid:<playerId>`) are exposed.
    this.state.pendingChoice = undefined;
    if (pending.resumeAction && pending.costStepKey) {
      // The loop was a COST of the paused play: keep the tallies and re-run it (the payments are already spent).
      this.costAnswers = {
        ...(pending.costAnswers ?? {}),
        [pending.costStepKey]: {
          tallies: [pending.tallies[pending.players[0]] ?? 0, pending.tallies[pending.players[1]] ?? 0]
        }
      };
      this.rerunPausedAction(pending, pending.resumeAction);
      return;
    }
    const merged: Record<string, number> = { ...pending.context.variables };
    merged.__paidByFirst = pending.tallies[pending.players[0]] ?? 0;
    merged.__paidByOpponent = pending.tallies[pending.players[1]] ?? 0;
    for (const p of pending.players) merged[`paid:${p}`] = pending.tallies[p] ?? 0;
    this.state.pendingEffectFrames.push({
      effects: pending.onEnd,
      index: 0,
      context: { ...pending.context, variables: merged }
    });
    this.resumeEffectFrames();
  }

  // ---------------------------------------------------------------------------
  // Continuous modifiers
  // ---------------------------------------------------------------------------

  /**
   * Decides whether a continuous modifier/keyword/restriction binding
   * (`{ target?, selector? }`) applies to `targetId`, and returns the
   * resolution context its `value` should be evaluated against, or
   * `undefined` if it doesn't apply.
   *
   * - `selector` form (an aura): applies to every in-play card the selector
   *   matches, with the candidate bound to `{ selected: "__candidate" }` so
   *   per-target amounts (`printedStat`/`stat` of `__candidate`) resolve.
   * - `target` form (the original): applies only to the one card
   *   `resolveTargetRef(target)` points at.
   * - neither set: malformed — applies to nothing.
   */
  private continuousBindingContext(
    binding: { target?: TargetRef; selector?: CardSelector },
    context: ResolutionContext,
    targetId: CardInstanceId
  ): ResolutionContext | undefined {
    if (binding.selector) {
      const auraContext: ResolutionContext = {
        ...context,
        selected: { ...context.selected, __candidate: [targetId] }
      };
      const card = this.state.cards[targetId];
      return card && this.matchesSelector(card, binding.selector, auraContext)
        ? auraContext
        : undefined;
    }

    // A bare grant (no `selector`, no `target`) applies to the ability's own
    // source — "this card gains COVERT" / "this character cannot attack".
    const ref = binding.target ?? "source";
    if (this.resolveTargetRef(ref, context) === targetId) {
      return context;
    }

    return undefined;
  }

  /**
   * Runs `baseCost` through every in-play `ContinuousAbility.costModifiers`
   * entry that targets `playerId`'s deploy of `cardId` — "opponents pay 1
   * more to deploy a tactic", "characters you play cost 2 less (min 1)".
   * Each modifier clamps the running total to its own `minCost` (default 0).
   */
  private applyCostModifiers(
    playerId: PlayerId,
    cardId: CardInstanceId,
    baseCost: number
  ): number {
    return this.applyNumericAdjusts(baseCost, this.costModifierAdjusts(playerId, cardId));
  }

  /** The in-play cost modifiers on `playerId`'s deploy of `cardId`, as numeric-cost adjustments (increases first, CR 406.3). */
  private costModifierAdjusts(playerId: PlayerId, cardId: CardInstanceId): NumericCostAdjust[] {
    const card = this.state.cards[cardId];
    if (!card) return [];

    const adjusts: NumericCostAdjust[] = [];

    // Per-card "this turn, the character loses/gains N numeric cost"
    // (`modifyNumericCost` — Guileful Astucion).
    for (const mod of this.state.numericCostModifiers) {
      if (mod.targetId === cardId) adjusts.push({ delta: mod.delta });
    }

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.costModifiers) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const mod of ability.costModifiers) {
          if (this.resolvePlayerRef(mod.affects, context).id !== playerId) {
            continue;
          }
          if (mod.selector && !this.matchesSelector(card, mod.selector, context)) {
            continue;
          }
          adjusts.push({
            delta: this.evaluateNumber(mod.delta, context),
            ...(mod.minCost !== undefined ? { minCost: mod.minCost } : {})
          });
        }
      }
    }

    return this.orderNumericAdjusts(adjusts);
  }

  /**
   * The net adjustment every in-play `ContinuousAbility.damageModifiers`
   * entry makes to a single instance of damage being inflicted to
   * `targetId` — "reduce battle damage to your characters by 2". The caller
   * floors the final amount at 0.
   */
  private damageDeltaFor(
    targetId: CardInstanceId,
    isBattle: boolean,
    damageSourceId?: CardInstanceId,
    incomingAmount?: number,
    /**
     * When several characters deal damage to the same thing in one speed
     * step (SYS-41) the modifiers split: `"sourced"` = only those gated on
     * ONE source (a `sourceSelector`, an outgoing modifier), applied to that
     * source's own share; `"unsourced"` = everything else, applied once to
     * the summed amount. Absent = all of them (a single dealer).
     */
    part?: "sourced" | "unsourced",
    /** Damage inflicted as a COST is outside a blanket window that says "this does not affect paying costs". */
    isCost = false
  ): number {
    const target = this.state.cards[targetId];
    if (!target) return 0;

    // Damage modifiers act on damage that is actually inflicted: an attempt
    // to inflict 0 stays 0, however much a modifier would add (CR 408.1).
    if (incomingAmount !== undefined && incomingAmount <= 0) return 0;

    // "This turn ... all inflicted damage is reduced to 0." (Limited
    // Liability) — a blanket window; drive every incoming instance to 0.
    if (
      part !== "sourced" &&
      this.state.damagePreventionWindows.some(w => !(isCost && w.exceptCosts) && (!w.battleOnly || isBattle))
    ) {
      return -(incomingAmount ?? 1e9);
    }

    let delta = 0;
    // "When any amount of damage greater than 4 is inflicted to this card,
    // reduce it to 0." (Class Action Defender) — `{ minAmount, setTo }`
    // clamps applied after the additive delta.
    let clampTo: number | undefined;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.damageModifiers) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [targetId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const mod of ability.damageModifiers) {
          if (mod.battleOnly && !isBattle) continue;
          if (part === "sourced" && !mod.sourceSelector) continue;
          if (part === "unsourced" && mod.sourceSelector) continue;
          if (!this.matchesSelector(target, mod.selector, context)) continue;
          if (mod.sourceSelector) {
            const dealer = damageSourceId
              ? this.state.cards[damageSourceId]
              : undefined;
            // `sourceSelector.conditions` bind `__candidate` to the DEALER,
            // not the damaged card.
            if (
              !dealer ||
              !this.matchesSelector(dealer, mod.sourceSelector, {
                ...context,
                selected: { ...context.selected, __candidate: [dealer.id] }
              })
            ) {
              continue;
            }
          }
          delta += this.evaluateNumber(mod.delta, context);

          if (mod.minAmount !== undefined && incomingAmount !== undefined) {
            const min = this.evaluateNumber(mod.minAmount, context);
            if (incomingAmount + delta >= min) {
              const setTo =
                mod.setTo !== undefined
                  ? this.evaluateNumber(mod.setTo, context)
                  : 0;
              clampTo = clampTo === undefined ? setTo : Math.min(clampTo, setTo);
            }
          }
        }
      }
    }

    // "This turn, reduce damage inflicted BY <card> by N." (Sockem Bot).
    if (damageSourceId && part !== "unsourced") {
      for (const mod of this.state.outgoingDamageModifiers) {
        if (mod.targetId) continue;
        if (mod.sourceId !== damageSourceId) continue;
        // "damage ... to your faction": only a faction of that player.
        if (
          mod.toFactionOf !== undefined &&
          !(
            this.getDefinition(targetId).type === "faction" &&
            this.factionHolderId(target) === mod.toFactionOf
          )
        ) {
          continue;
        }
        delta += mod.delta;
      }
    }

    // "If damage is inflicted to the character this turn, reduce the amount
    // by 1." (Fiscal Intercessor) — every instance, whoever deals it.
    if (part !== "sourced") {
      for (const mod of this.state.outgoingDamageModifiers) {
        if (mod.targetId === targetId) delta += mod.delta;
      }
    }

    if (clampTo !== undefined && incomingAmount !== undefined && part !== "sourced") {
      return clampTo - incomingAmount;
    }

    return delta;
  }

  /**
   * Damage a `preventDamage` redirect moves onto another card: a faction
   * loses influence instead of taking markers (CR 408.3).
   */
  private applyRedirectedDamage(card: CardInstance, amount: number, sourceId?: CardInstanceId): void {
    if (this.getDefinition(card.id).type === "faction") {
      this.applyInfluenceDelta(this.factionHolderId(card), -amount);
    } else {
      this.noteDamage(card, [{ sourceId, amount }]);
      card.damage += amount;
    }
  }

  /**
   * Records `sources` (who dealt how much, as one simultaneous batch) as the
   * latest damage `card` is about to take. Call before adding the damage.
   */
  private noteDamage(
    card: CardInstance,
    sources: Array<{ sourceId?: CardInstanceId; amount: number }>
  ): void {
    const dealt = sources.filter(s => s.amount > 0);
    if (dealt.length === 0) return;
    let tally = this.damageSources.get(card.id);
    if (!tally || card.damage <= 0) {
      tally = { bySource: new Map(), last: new Set() };
      this.damageSources.set(card.id, tally);
    }
    tally.last = new Set();
    for (const { sourceId, amount } of dealt) {
      const key = sourceId ?? "";
      tally.bySource.set(key, (tally.bySource.get(key) ?? 0) + amount);
      tally.last.add(key);
    }
  }

  /**
   * CR 506.6 / 408.4b / 408.5c: a replaced destruction reduces to 0 the damage
   * the card received from the source of the destruction — for a destruction
   * by lethal damage, whoever dealt the last of it; otherwise the card whose
   * effect destroys it (which has dealt none unless it also damaged the card).
   */
  private reduceDamageFromDestruction(
    cardId: CardInstanceId,
    destroyerId: CardInstanceId | undefined,
    lethal: boolean
  ): void {
    const card = this.state.cards[cardId];
    if (!card || card.damage <= 0) return;
    const tally = this.damageSources.get(cardId);
    if (lethal && (!tally || tally.last.size === 0)) {
      // No record of who dealt it (damage the card was set up with): all of it.
      card.damage = 0;
      return;
    }
    const sources = lethal
      ? [...tally!.last]
      : destroyerId !== undefined
        ? [destroyerId]
        : [];
    for (const key of sources) {
      const dealt = Math.min(tally?.bySource.get(key) ?? 0, card.damage);
      if (dealt <= 0) continue;
      card.damage -= dealt;
      tally!.bySource.set(key, 0);
    }
    if (lethal) {
      // Still at or over its limit (the limit dropped since): it would re-die
      // forever, so nothing is left.
      const isCharacter = this.hasCardType(cardId, "character");
      const isLocation = this.hasCardType(cardId, "location");
      if (
        (isCharacter || isLocation) &&
        card.damage >= this.getStat(cardId, isCharacter ? "life" : "structure")
      ) {
        card.damage = 0;
      }
    }
  }

  /**
   * Consume `preventDamage` shields on `targetId` against `amount` incoming
   * points (after `damageDeltaFor`). Returns how much still lands on the
   * target, plus any redirected chunks (which are applied raw — no further
   * modifiers/shields on the redirect target). Shields are consumed in
   * registration order and dropped once emptied.
   */
  private absorbDamage(
    targetId: CardInstanceId,
    amount: number
  ): { toTarget: number; redirects: Array<{ cardId: CardInstanceId; amount: number }> } {
    const redirects: Array<{ cardId: CardInstanceId; amount: number }> = [];
    let remaining = amount;

    for (const shield of this.state.damageShields) {
      if (remaining <= 0) break;
      if (shield.targetId !== targetId || shield.amount <= 0) continue;

      // "Reduce the next damage instance to 0" — swallow the whole instance,
      // then the shield is spent (Visible Loaf).
      if (shield.wholeInstance) {
        remaining = 0;
        shield.amount = 0;
        continue;
      }

      const absorbed = Math.min(shield.amount, remaining);
      shield.amount = shield.oneInstance ? 0 : shield.amount - absorbed;
      remaining -= absorbed;

      if (shield.mode === "redirect" && shield.redirectToId) {
        redirects.push({ cardId: shield.redirectToId, amount: absorbed });
      }
    }

    this.state.damageShields = this.state.damageShields.filter(s => s.amount > 0);

    return { toTarget: Math.max(0, remaining), redirects };
  }

  private getContinuousModifiers(
    targetId: CardInstanceId,
    onlyStat?: Stat
  ): RuntimeModifier[] {
    return [...this.scopedRead("contMods", `${targetId}|${onlyStat ?? ""}`, () => this.computeContinuousModifiers(targetId, onlyStat))];
  }

  private computeContinuousModifiers(
    targetId: CardInstanceId,
    onlyStat?: Stat
  ): RuntimeModifier[] {
    const results: RuntimeModifier[] = [];

    const granters = this.grantingSources();
    for (const source of Object.values(
      this.state.cards
    )) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }
      // "Effects from <cardType> do not affect this card." (Parkour Hoodlum)
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        // No modifier for this stat means nothing to add, whatever the
        // condition says, so don't evaluate it. A keyword-only ability with a
        // board-wide condition (Torchlight Sarcophyle) would otherwise run that
        // condition on every stat read of every card.
        if (!ability.modifiers?.some((modifier) => onlyStat === undefined || modifier.stat === onlyStat)) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(
            ability.condition,
            context
          )
        ) {
          continue;
        }

        for (const modifier of ability.modifiers ?? []) {
          // Skip modifiers for other stats up front — evaluating their
          // `value` can recurse back into `getStat` for the requested stat
          // (Martial Arts Master's strength modifier reads its own speed).
          if (onlyStat !== undefined && modifier.stat !== onlyStat) {
            continue;
          }

          const auraContext = this.continuousBindingContext(
            modifier,
            context,
            targetId
          );

          if (!auraContext) {
            continue;
          }

          results.push({
            id: `continuous:${source.id}:${ability.id}:${targetId}:${modifier.stat}`,
            sourceId: source.id,
            sourceAbilityId: ability.id,
            targetId,
            stat: modifier.stat,
            operation: modifier.operation,
            value: this.evaluateNumber(
              modifier.value,
              auraContext
            ),
            duration: {
              type: "whileSourceInPlay"
            },
            createdTurn: this.state.turn
          });
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousModifiers, but for `ContinuousAbility.keywords`. */
  private getContinuousKeywordGrants(
    targetId: CardInstanceId
  ): Keyword[] {
    return this.getContinuousKeywordGrantEntries(targetId).map(entry => entry.keyword);
  }

  /** `getContinuousKeywordGrants` with the card and ability each grant comes from (`getKeywordGrantSources`). */
  private getContinuousKeywordGrantEntries(
    targetId: CardInstanceId
  ): Array<{ keyword: Keyword; sourceId: CardInstanceId; abilityId: AbilityId }> {
    return [...this.scopedRead("contKeywords", targetId, () => this.computeContinuousKeywordGrantEntries(targetId))];
  }

  private computeContinuousKeywordGrantEntries(
    targetId: CardInstanceId
  ): Array<{ keyword: Keyword; sourceId: CardInstanceId; abilityId: AbilityId }> {
    const results: Array<{ keyword: Keyword; sourceId: CardInstanceId; abilityId: AbilityId }> = [];

    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.keywords) {
          continue;
        }
        // A continuous ability is live only while its source sits in
        // `activeZone` (default "play", face-up) — "while this card is in
        // your hand, it gains TACTICAL" (Parkour Hoodlum); "all characters
        // in your hand gain TACTICAL" (Gloamspike-Gosche Bridge, an aura).
        const activeZone = ability.activeZone ?? "play";
        if (activeZone === "play") {
          if (source.zone !== "play" || source.faceDown) continue;
        } else if (source.zone !== activeZone) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const guardKey = `${source.id}:${ability.id}`;
        if (this.resolvingContinuousGrant.has(guardKey)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        this.resolvingContinuousGrant.add(guardKey);
        try {
          // Which grants reach this card at all, before the (possibly
          // board-wide) condition: "this character gains COVERT" never reaches
          // anyone else, so their keyword reads must not evaluate it. Torchlight
          // Sarcophyle's condition asks every character for COVERT, and with
          // several copies in play each read re-ran every copy's condition —
          // exponential in copies.
          const bound = ability.keywords.filter((grant) => this.continuousBindingContext(grant, context, targetId));
          if (bound.length === 0) {
            continue;
          }
          if (
            ability.condition &&
            !this.evaluateCondition(ability.condition, context)
          ) {
            continue;
          }

          for (const grant of bound) {
            results.push({ keyword: grant.keyword, sourceId: source.id, abilityId: ability.id });
          }
        } finally {
          this.resolvingContinuousGrant.delete(guardKey);
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousKeywordGrants, but for `ContinuousAbility.suppressKeywords` ("it loses COVERT"). */
  private getContinuousKeywordSuppressions(
    targetId: CardInstanceId
  ): Keyword[] {
    return [...this.scopedRead("contSuppress", targetId, () => this.computeContinuousKeywordSuppressions(targetId))];
  }

  private computeContinuousKeywordSuppressions(
    targetId: CardInstanceId
  ): Keyword[] {
    const results: Keyword[] = [];

    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.suppressKeywords) {
          continue;
        }

        const guardKey = `${source.id}:${ability.id}`;
        if (this.resolvingContinuousGrant.has(guardKey)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { target: [targetId] }
        };

        this.resolvingContinuousGrant.add(guardKey);
        try {
          // Bind before the condition, as in getContinuousKeywordGrants.
          const bound = ability.suppressKeywords.filter((grant) => this.continuousBindingContext(grant, context, targetId));
          if (bound.length === 0) continue;
          if (
            ability.condition &&
            !this.evaluateCondition(ability.condition, context)
          ) {
            continue;
          }

          for (const grant of bound) {
            results.push(grant.keyword);
          }
        } finally {
          this.resolvingContinuousGrant.delete(guardKey);
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousKeywordGrants, but for `ContinuousAbility.restrictions`. */
  private getContinuousRestrictionGrants(
    targetId: CardInstanceId,
    pickerTypes?: readonly CardType[]
  ): Restriction[] {
    return this.getContinuousRestrictionGrantEntries(targetId, pickerTypes).map(entry => entry.restriction);
  }

  /** `getContinuousRestrictionGrants` with the card and ability each grant comes from (`getRestrictionSources`). */
  private getContinuousRestrictionGrantEntries(
    targetId: CardInstanceId,
    pickerTypes?: readonly CardType[]
  ): Array<{ restriction: Restriction; sourceId: CardInstanceId; abilityId: AbilityId }> {
    return [
      ...this.scopedRead("contRestrictions", `${targetId}|${pickerTypes?.join(",") ?? ""}`, () =>
        this.computeContinuousRestrictionGrantEntries(targetId, pickerTypes)
      )
    ];
  }

  private computeContinuousRestrictionGrantEntries(
    targetId: CardInstanceId,
    pickerTypes?: readonly CardType[]
  ): Array<{ restriction: Restriction; sourceId: CardInstanceId; abilityId: AbilityId }> {
    const results: Array<{ restriction: Restriction; sourceId: CardInstanceId; abilityId: AbilityId }> = [];

    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.restrictions) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const guardKey = `${source.id}:${ability.id}`;
        if (this.resolvingContinuousGrant.has(guardKey)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        this.resolvingContinuousGrant.add(guardKey);
        try {
          // Bind before the condition, as in getContinuousKeywordGrants.
          const bound = ability.restrictions.filter(
            (grant) =>
              this.continuousBindingContext(grant, context, targetId) &&
              // "cannot be picked by NON-ITEM cards": exempt picks by an item.
              !(grant.exceptPickerType && pickerTypes?.includes(grant.exceptPickerType))
          );
          if (bound.length === 0) {
            continue;
          }
          if (
            ability.condition &&
            !this.evaluateCondition(ability.condition, context)
          ) {
            continue;
          }

          for (const grant of bound) {
            results.push({ restriction: grant.restriction, sourceId: source.id, abilityId: ability.id });
          }
        } finally {
          this.resolvingContinuousGrant.delete(guardKey);
        }
      }
    }

    return results;
  }

  /**
   * Whether `playerId` may deploy `cardId` from the void / removed zone "as though it were in hand", and on what
   * terms: a persistent `voidPlayGrants` entry (Cheats, Pant Swipe, Eccentric Inquisition) or, for a void card, a
   * live `ContinuousAbility.voidPlay` aura (Voidal Tactician). The one gate `deployCard` and the play queries
   * (`getCardPlayability`, `getPlayableFromOutsideHand`) share, so listing and playing cannot drift.
   */
  private outsideHandPlayAccess(
    cardId: CardInstanceId,
    playerId: PlayerId
  ):
    | { source: "grant" | "aura"; ignoreThreshold: boolean; grantSourceId?: CardInstanceId }
    | undefined {
    const card = this.state.cards[cardId];
    if (!card || (card.zone !== "void" && card.zone !== "removed")) return undefined;
    const grant = this.state.voidPlayGrants.find(g => g.cardId === cardId && g.playerId === playerId);
    if (grant) {
      return {
        source: "grant",
        ignoreThreshold: grant.ignoreThreshold,
        ...(grant.sourceId ? { grantSourceId: grant.sourceId } : {})
      };
    }
    const aura = card.zone === "void" ? this.continuousVoidPlayGrantFor(cardId, playerId) : undefined;
    if (aura) {
      return { source: "aura", ignoreThreshold: aura.ignoreThreshold, grantSourceId: aura.sourceId };
    }
    return undefined;
  }

  /**
   * A live `ContinuousAbility.voidPlay` grant (Voidal Tactician) that lets
   * `playerId` deploy the void-zone card `cardId` as though from hand — or
   * `undefined`. The granting source must be in play, face-up, controlled
   * by `playerId`, its `condition` (if any) holding, and its
   * `voidPlay.selector` matching `cardId`.
   */
  private continuousVoidPlayGrantFor(
    cardId: CardInstanceId,
    playerId: PlayerId
  ): { ignoreThreshold: boolean; sourceId: CardInstanceId } | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (source.controllerId !== playerId) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.voidPlay) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }
        if (!this.matchesSelector(card, ability.voidPlay.selector, context)) {
          continue;
        }
        return { ignoreThreshold: !!ability.voidPlay.ignoreThreshold, sourceId: source.id };
      }
    }

    return undefined;
  }

  /**
   * True when an in-play `ContinuousAbility.playRestrictions` entry (Lockbox
   * of the Aeons, Geldale City-Fortress, Incriminating Photograph) currently
   * forbids `playerId` from the given play — `{ kind: "flipUp" }`,
   * `{ cardType }`, or `{ name }` (a named-card ban).
   */
  private continuousPlayRestricted(
    playerId: PlayerId,
    query: { kind: "flipUp" } | { cardType: CardType } | { name: string }
  ): boolean {
    return this.continuousPlayRestrictor(playerId, query) !== undefined;
  }

  /**
   * `continuousPlayRestricted`, naming the first restricting source: its id, and for a named-card ban the value
   * it named (`namedValue`, e.g. the card Incriminating Photograph named).
   */
  private continuousPlayRestrictor(
    playerId: PlayerId,
    query: { kind: "flipUp" } | { cardType: CardType } | { name: string }
  ): { sourceId: CardInstanceId; namedValue?: string } | undefined {
    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        if (!ability.playRestrictions) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, {
            sourceId: source.id,
            controllerId: source.controllerId,
            abilityId: ability.id,
            selected: {}
          })
        ) {
          continue;
        }

        for (const entry of ability.playRestrictions) {
          const targeted =
            entry.player === "any"
              ? true
              : entry.player === "self"
                ? source.controllerId === playerId
                : isOpponentOf(this.state, source.controllerId, playerId);
          if (!targeted) continue;
          if (
            entry.timing === "notActivePlayer" &&
            playerId === this.state.activePlayerId
          ) {
            continue;
          }
          if ("kind" in query) {
            if (entry.kind === "flipUp") return { sourceId: source.id };
          } else if (typeof entry.kind === "object" && "cardType" in entry.kind) {
            if (
              "cardType" in query &&
              entry.kind.cardType === query.cardType
            ) {
              return { sourceId: source.id };
            }
          } else if (typeof entry.kind === "object" && "named" in entry.kind) {
            const banned = source.namedValues?.[entry.kind.named];
            if ("name" in query && banned && banned === query.name) {
              return { sourceId: source.id, namedValue: banned };
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * The zone a card that would enter a hand should go to instead, per an
   * active `redirectHandMoves` window (Quotidian Misfire — `"discard"`), or
   * `undefined` if none applies. The most-recently-installed window wins.
   */
  private handMoveRedirectFor(
    cardId: CardInstanceId,
    handOwnerId: PlayerId
  ): Zone | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;
    let redirect: Zone | undefined;
    for (const w of this.state.handMoveRedirects) {
      if (this.redirectReaches(w, handOwnerId)) {
        redirect = w.to;
      }
    }
    return redirect;
  }

  /** Whether a hand-move redirect reaches `playerId`'s hand — "your opponent's" names the opponent its block was about (D4). */
  private redirectReaches(w: GameState["handMoveRedirects"][number], playerId: PlayerId): boolean {
    if (w.who === "opponent") return this.opponentIdsFor({ controllerId: w.sourceControllerId, opponentId: w.opponentId }).includes(playerId);
    return this.scopeMatchesPlayer(w.who, w.sourceControllerId, playerId);
  }

  /**
   * True when an in-play `ContinuousAbility.restrictReturnToHand` entry
   * (Lockbox of the Aeons) forbids moving `cardId` into `handOwnerId`'s hand
   * from `fromZone` — whose hand receives it is the card's owner unless a
   * `toPlayer` put it into someone else's.
   */
  private returnToHandRestricted(
    cardId: CardInstanceId,
    fromZone: Zone,
    handOwnerId: PlayerId
  ): boolean {
    const card = this.state.cards[cardId];
    if (!card) return false;

    const granters = this.grantingSources();
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id, granters)) {
        const rule = ability.restrictReturnToHand;
        if (!rule) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, {
            sourceId: source.id,
            controllerId: source.controllerId,
            abilityId: ability.id,
            selected: {}
          })
        ) {
          continue;
        }
        const targeted =
          rule.player === "any"
            ? true
            : rule.player === "self"
              ? source.controllerId === handOwnerId
              : isOpponentOf(this.state, source.controllerId, handOwnerId);
        if (targeted && rule.fromZones.includes(fromZone)) return true;
      }
    }
    return false;
  }

  /** Public: a renderer needs a card's live restriction set; same check battle legality uses. */
  hasRestriction(
    cardId: CardInstanceId,
    restriction: Restriction,
    pickerTypes?: readonly CardType[]
  ): boolean {
    if (
      this.state.restrictions.some(
        grant => grant.targetId === cardId && grant.restriction === restriction
      )
    ) {
      return true;
    }

    return this.getContinuousRestrictionGrants(cardId, pickerTypes).includes(restriction);
  }

  /** Every restriction `cardId` currently has (see `hasRestriction`). */
  getRestrictions(cardId: CardInstanceId): Restriction[] {
    return ALL_RESTRICTIONS.filter(restriction => this.hasRestriction(cardId, restriction));
  }

  /**
   * True when some in-play `ContinuousAbility.suppressAllAbilities` (whose
   * `condition` holds and whose `target`/`selector` resolves to `cardId`)
   * turns off `cardId`'s ability `abilityId` — "this card loses all other
   * rules text" / "the attached character has no rules text". The
   * suppressing ability itself is never suppressed (so a paragraph like
   * "loses all other rules text and loses 1 speed" keeps its own -1 speed).
   * Consulted by every ability-enumeration site (activated, triggered,
   * continuous recompute, replacement scan, `hasAbility`).
   */
  private abilitySuppressed(
    cardId: CardInstanceId,
    abilityId?: AbilityId
  ): boolean {
    return this.scopedRead("suppressed", `${cardId}|${abilityId ?? ""}`, () => this.scanAbilitySuppression(cardId, abilityId));
  }

  /**
   * The one scan behind `abilitySuppressed` (first match wins, no allocation) and `getAbilitySuppressionSources`
   * (`collect` given: every match is recorded, the scan runs on). Returns whether anything suppresses it.
   */
  private scanAbilitySuppression(
    cardId: CardInstanceId,
    abilityId?: AbilityId,
    collect?: AbilitySuppressionSource[]
  ): boolean {
    let found = false;
    // Duration'd "this card loses all rules text" (iDumb De-Itemizer: RESET).
    // Entries sit in the list (like `keywordGrants`) until the start-of-turn
    // sweep clears them; only `whileSourceInPlay` needs a live source check.
    for (const s of this.state.abilitySuppressions) {
      if (
        s.targetId === cardId &&
        (s.duration.type !== "whileSourceInPlay" ||
          (!!s.sourceId && this.sourceActiveInPlay(s.sourceId)))
      ) {
        if (!collect) return true;
        found = true;
        const sourceId = this.publicSourceId(s.sourceId);
        collect.push({
          kind: "runtime",
          ...(sourceId ? { sourceId } : {}),
          duration: structuredClone(s.duration)
        });
      }
    }

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      // A source that has itself lost all its rules text (iDumb De-Itemizer
      // after RESET) no longer mutes anything.
      if (
        this.state.abilitySuppressions.some(
          s =>
            s.targetId === source.id &&
            (s.duration.type !== "whileSourceInPlay" ||
              (!!s.sourceId && this.sourceActiveInPlay(s.sourceId)))
        )
      ) {
        continue;
      }
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.suppressAllAbilities) {
          continue;
        }
        if (abilityId !== undefined && source.id === cardId && ability.id === abilityId) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        const spec = ability.suppressAllAbilities;
        const hits = spec.selector
          ? this.queryCards(spec.selector, context).some(c => c.id === cardId)
          : this.resolveTargetRef(spec.target ?? "source", context) === cardId;
        if (hits) {
          if (!collect) return true;
          found = true;
          collect.push({ kind: "aura", sourceId: source.id, abilityId: ability.id });
        }
      }
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // State-based actions
  // ---------------------------------------------------------------------------

  /**
   * Whether any card that could be a seat-swap source is in play. A cheap
   * pre-filter so the full continuous-ability scan in `seatSwapWanted` only
   * runs when a printed `swapsSides` ability (or a granted one) is on the
   * table, or a swap is already in effect and may need lifting.
   */
  private mayHaveSeatSwapSource(): boolean {
    if (this.state.seatSwap || this.state.abilityGrants.length > 0) return true;
    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play" || card.faceDown) continue;
      if (
        this.continuousAbilitiesOf(this.getDefinition(card.id)).some(
          ability => ability.swapsSides
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * True when the seats should currently be swapped: an odd number of live
   * `swapsSides` abilities are in play. Two swaps cancel — the players are
   * back in their own seats.
   */
  private seatSwapWanted(): boolean {
    let sources = 0;
    this.forEachActiveContinuous((_source, ability) => {
      if (ability.swapsSides) sources += 1;
    });
    return sources % 2 === 1;
  }

  /**
   * The two players a seat swap exchanges (MP 3 "both players"): the first
   * live source's controller and the opponent it was played against (or that
   * controller's only opponent). `undefined` when no such pair exists.
   */
  private seatSwapPair(): [PlayerId, PlayerId] | undefined {
    let pair: [PlayerId, PlayerId] | undefined;
    this.forEachActiveContinuous((source, ability) => {
      if (pair || !ability.swapsSides) return;
      const sole = opponentsOf(this.state, source.controllerId);
      const other =
        source.chosenOpponentId !== undefined && isLiving(this.state, source.chosenOpponentId)
          ? source.chosenOpponentId
          : sole.length === 1
            ? sole[0]
            : undefined;
      if (other !== undefined) pair = [source.controllerId, other];
    });
    return pair;
  }

  /**
   * Brings `GameState.seatSwap` in line with `seatSwapWanted()` — applying the
   * swap when the first source enters play, lifting it when the last one
   * leaves. Returns whether anything changed.
   */
  private syncSeatSwap(): boolean {
    if (!this.mayHaveSeatSwapSource()) return false;
    const pair = this.seatSwapWanted() ? this.seatSwapPair() : undefined;
    const swapped = this.state.seatSwap !== undefined;
    if ((pair !== undefined) === swapped) return false;
    if (pair) this.applySeatSwap(pair);
    else this.liftSeatSwap();
    return true;
  }

  /**
   * The players switch seats (RULES.md §12 "Seat swap"): every card in play,
   * both factions included, passes to the opposing player, and the players
   * exchange their `factionId` / `influence` so "your faction" follows
   * control. A card that "cannot be taken control of" keeps its controller.
   */
  private applySeatSwap(pair: [PlayerId, PlayerId]): void {
    const [a, b] = pair;
    const exchanged: SeatSwapState["exchanged"] = [];
    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play") continue;
      if (card.controllerId !== a && card.controllerId !== b) continue;
      if (this.hasRestriction(card.id, "cannotBeTakenControl")) continue;
      exchanged.push({ cardId: card.id, previousControllerId: card.controllerId });
    }
    for (const { cardId, previousControllerId } of exchanged) {
      this.reassignControl(cardId, previousControllerId === a ? b : a);
    }
    this.exchangeFactionSeats(a, b);
    this.state.seatSwap = { exchanged, players: [a, b] };
    this.emit({ type: "seatsSwapped", swapped: true });
  }

  /**
   * The players switch back. Each exchanged card still in play and still
   * under the controller the swap gave it returns to its previous controller;
   * a card whose control something else changed since (a later "take
   * control", CR §407.3a) or that entered play after the swap is left alone.
   */
  private liftSeatSwap(): void {
    const swap = this.state.seatSwap;
    this.state.seatSwap = undefined;
    if (!swap) return;
    const [a, b] = swap.players ?? (this.state.turnOrder.slice(0, 2) as [PlayerId, PlayerId]);
    for (const { cardId, previousControllerId } of swap.exchanged) {
      const card = this.state.cards[cardId];
      if (!card || card.zone !== "play") continue;
      if (card.controllerId === (previousControllerId === a ? b : a)) {
        this.reassignControl(cardId, previousControllerId);
      }
    }
    this.exchangeFactionSeats(a, b);
    this.emit({ type: "seatsSwapped", swapped: false });
  }

  /** Swap which faction (and influence pool) the two players hold. */
  private exchangeFactionSeats(a: PlayerId, b: PlayerId): void {
    const first = this.requirePlayer(a);
    const second = this.requirePlayer(b);
    [first.factionId, second.factionId] = [second.factionId, first.factionId];
    [first.influence, second.influence] = [second.influence, first.influence];
  }

  /**
   * True when one of the card's own live `destroysSource` continuous
   * abilities currently holds (its `condition` is met and nothing has
   * suppressed it).
   */
  private hasActiveSelfDestruct(card: CardInstance): boolean {
    for (const ability of this.continuousAbilitiesOf(
      this.getDefinition(card.id)
    )) {
      if (!ability.destroysSource) continue;
      if (this.abilitySuppressed(card.id, ability.id)) continue;
      const context: ResolutionContext = {
        sourceId: card.id,
        controllerId: card.controllerId,
        abilityId: ability.id,
        selected: {}
      };
      if (
        !ability.condition ||
        this.evaluateCondition(ability.condition, context)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * CR §507.5 (Unique): when a player controls more than one face-up in-play
   * card with the same Unique designation, pause on a `uniqueSurvivor`
   * choice. Returns true if a choice was raised. Called both from the
   * state-based check and — so the rule is enforced IMMEDIATELY (the user's
   * ruling, Q53) — before any queued triggered ability is resolved: a second
   * copy's own "when this enters play" trigger waits for the keep-one choice.
   */
  private raiseUniqueConflict(): boolean {
    if (this.state.pendingChoice) return false;

    const groups = new Map<
      string,
      { controllerId: PlayerId; unique: string; cardIds: CardInstanceId[] }
    >();

    for (const [cardId, replacer] of this.uniquePrevented) {
      const copy = this.state.cards[cardId];
      const source = replacer.cardId ? this.state.cards[replacer.cardId] : undefined;
      const preventionLasts =
        copy?.zone === "play" &&
        (replacer.runtimeId
          ? this.state.runtimeReplacements.some(rr => rr.id === replacer.runtimeId)
          : source?.zone === "play" && !source.faceDown);
      if (!preventionLasts) this.uniquePrevented.delete(cardId);
    }

    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play" || card.faceDown) continue;
      if (this.uniqueDoomed.has(card.id) || this.uniquePrevented.has(card.id)) continue;

      const unique = this.getEffectiveUnique(card.id);
      if (!unique) continue;

      const key = `${card.controllerId} ${unique}`;
      const group = groups.get(key) ?? {
        controllerId: card.controllerId,
        unique,
        cardIds: []
      };

      group.cardIds.push(card.id);
      groups.set(key, group);
    }

    const conflict = [...groups.values()].find(
      group => group.cardIds.length > 1
    );

    if (!conflict) return false;

    this.state.pendingChoice = {
      kind: "uniqueSurvivor",
      id: this.nextId("choice"),
      playerId: conflict.controllerId,
      unique: conflict.unique,
      candidates: conflict.cardIds
    };

    return true;
  }

  private checkStateBasedActions(): void {
    let changed = true;

    while (changed) {
      changed = false;

      // A pending choice freezes the whole engine until it's answered — and
      // in particular an *optional replacement* awaiting accept/decline
      // leaves its would-be-destroyed card sitting with lethal damage. Don't
      // keep re-triggering the replacement (or anything else) here; every
      // `resolvePendingChoice` branch re-runs this check once it's settled.
      if (this.state.pendingChoice) return;

      // The seats swap (or swap back) the moment a `swapsSides` source enters
      // (or leaves) play, before anything below is judged against who controls
      // what.
      if (this.syncSeatSwap()) {
        changed = true;
        continue;
      }

      for (const card of Object.values(this.state.cards)) {
        if (card.zone !== "play") {
          continue;
        }

        // CR §208.4 / §302.15 — a card that has lost the character type
        // while in a battle is pulled from its party immediately, whatever
        // caused the loss: a `setCardType` grant expiring, its source
        // leaving play, or the card being turned face-down mid-battle by its
        // own ability (Backdoor Brigand's EXIT STAGE RIGHT). A face-down
        // card is only a resource (CR §411.1), so this MUST run before the
        // face-down skip below — otherwise a former attacker that flipped
        // itself over stays in the party and goes on to assign and inflict
        // battle damage it no longer shows.
        if (this.state.battle && !this.hasCardType(card.id, "character")) {
          const b = this.state.battle;
          if (
            b.attackingParty.includes(card.id) ||
            b.blockingParty.includes(card.id)
          ) {
            b.attackingParty = b.attackingParty.filter(x => x !== card.id);
            b.blockingParty = b.blockingParty.filter(x => x !== card.id);
            this.emit({
              type: "characterLeftBattle",
              cardId: card.id,
              battleId: b.id
            });
            changed = true;
            break;
          }
        }

        if (card.faceDown) {
          continue;
        }

        const definition = this.getDefinition(card.id);
        const isCharacter = this.hasCardType(card.id, "character");
        const isLocation = this.hasCardType(card.id, "location");

        // Lethal damage: characters clear it every turn, locations carry it
        // across turns (see RULES.md §3), but both die the same way once
        // accumulated damage reaches their capacity — `life` for a
        // character, `structure` for a location (distinct stats/fields).
        if (isCharacter || isLocation) {
          const capacity = this.getStat(
            card.id,
            isCharacter ? "life" : "structure"
          );

          // "No cards can be destroyed" this turn (Limited Liability): lethal
          // damage already marked waits until the window ends.
          if (
            card.damage >= capacity &&
            this.state.destructionRestrictionWindows.length === 0
          ) {
            // Attribute the destruction to whoever last dealt the damage, so
            // a `replaces.by: "opponent"` guard (Giada) fires for a lethal
            // hit from an opposing character. Battle damage records this;
            // non-battle `dealDamage` leaves `currentCause` set from its
            // effect's controller.
            const battleCause = this.lethalDamageCause.get(card.id);
            if (card.damage === 0 && !battleCause) {
              // Dying with no damage at all (0 life): nothing damaged it, so
              // a stale cause from an earlier effect must not attribute it.
              this.currentCause = undefined;
              this.currentCauseSourceId = undefined;
            }
            if (battleCause) {
              this.currentCause = battleCause;
              this.currentCauseSourceId = undefined;
            }
            this.destroyedByDamage.add(card.id);
            const previousLethal = this.destroyingByLethalDamage;
            this.destroyingByLethalDamage = card.id;
            try {
              this.destroyCard(card.id, true, false, battleCause !== undefined);
            } finally {
              this.destroyingByLethalDamage = previousLethal;
            }
            this.lethalDamageCause.delete(card.id);
            changed = true;
            break;
          }
        }

        // A threshold paragraph that says "Destroy this card" (CR §405.4 —
        // Boorish Boar's [R][R][R]) destroys the card the moment it is
        // active. A replacement that keeps the card in play must not
        // re-trigger this pass forever, so only a card that actually left
        // (or a choice the replacement opened) counts as a change.
        if (this.hasActiveSelfDestruct(card)) {
          // Its own ability, under its controller's control (not whatever effect resolved last).
          this.destroyCardCausedBy(card.id, card.controllerId, card.id);
          if (this.state.pendingChoice || card.zone !== "play") {
            changed = true;
            break;
          }
        }

        // Attach to X (RULES.md §9): two different outcomes —
        //  - host still in play but no longer the required type: CR §507.2e,
        //    destroy the attaching card;
        //  - no valid host at all (none was pickable on entry, or the host
        //    has since left play): CR §507.2c, put the attaching card into
        //    its owner's discard pile — a move, not a destruction (fires
        //    `cardMoved`, honours discard replacements).
        if (definition.attachTo) {
          const target = card.attachedTo
            ? this.state.cards[card.attachedTo]
            : undefined;

          const hostInPlay = !!target && target.zone === "play";
          const hostRightType =
            hostInPlay &&
            this.hasCardType(target!.id, definition.attachTo);

          if (hostInPlay && !hostRightType) {
            // CR 507.2e: the game rules destroy it, no player or card does.
            this.destroyCardCausedBy(card.id, undefined, undefined);
            changed = true;
            break;
          }

          if (!hostInPlay) {
            // "This card does not leave play if the attached card leaves
            // play" (Everlasting Blade of Light) — it stays in play,
            // unattached, instead of going to the discard pile.
            if (definition.behavior?.keepOnHostLeave) {
              if (card.attachedTo !== undefined) {
                card.attachedTo = undefined;
                changed = true;
                break;
              }
            } else {
              this.moveCard(card.id, "discard");
              changed = true;
              break;
            }
          }
        }
      }

      if (changed) continue;

      // Unique: a player may not control more than one in-play card per
      // Unique designation (RULES.md §9). Which copy survives is the
      // player's decision, so this pauses the engine on a pendingChoice
      // rather than guessing — see resolvePendingChoice.
      if (!this.state.pendingChoice) {
        if (this.raiseUniqueConflict()) return;
      }

      // Victory: a faction at 0 influence ends the game (RULES.md §1) —
      // unless an in-play `preventsDefeat` ability shields that faction
      // (Armored Keep — "You do not lose the game because your faction has
      // 0 influence").
      if (!this.state.result) {
        const shielded = new Set<PlayerId>();
        this.forEachActiveContinuous((source, ability) => {
          const rule = ability.preventsDefeat;
          if (!rule) return;
          for (const p of Object.values(this.state.players)) {
            if (
              this.scopeMatchesPlayer(rule.player, source.controllerId, p.id)
            ) {
              shielded.add(p.id);
            }
          }
        });

        // The loser is the faction's *owner* (CR §102.1), which differs from
        // the player holding it while the seats are swapped — "the owner of
        // the winning deck wins the game" (Emergency Obfuscation).
        const losers = new Map<PlayerId, PlayerElimination["reason"]>();
        for (const player of Object.values(this.state.players)) {
          if (player.influence > 0) continue;
          const loserId = this.factionOwnerId(player);
          if (!shielded.has(loserId)) losers.set(loserId, "influence");
        }

        // "When a player has no cards in their deck, they lose the game."
        // (Trickster's Globe — overrides CR §102.1a while it is in play.)
        let emptyDeckLoses = false;
        this.forEachActiveContinuous((_source, ability) => {
          if (ability.emptyDeckLoses) emptyDeckLoses = true;
        });
        if (emptyDeckLoses) {
          for (const player of Object.values(this.state.players)) {
            if (player.deck.length === 0 && !losers.has(player.id)) losers.set(player.id, "emptyDeck");
          }
        }

        this.settleDefeats(losers);
      }
    }
  }

  private resolvePendingChoice(
    playerId: PlayerId,
    choice: Extract<GameAction, { type: "resolvePendingChoice" }>["choice"]
  ): void {
    const pending = this.state.pendingChoice;

    assert(pending, "There is no pending choice.");
    assert(
      pending.kind === choice.kind,
      "This choice does not match the pending decision."
    );
    assert(pending.playerId === playerId, "It is not your decision to make.");

    switch (choice.kind) {
      case "uniqueSurvivor": {
        assert(pending.kind === "uniqueSurvivor", "This choice does not match the pending decision.");
        assert(
          pending.candidates.includes(choice.keep),
          "That card is not one of the Unique candidates."
        );

        this.state.pendingChoice = undefined;

        // A copy the Unique rule removes (destroyed, or flipped face-down by
        // its own replacement) never entered play: its still-queued "when
        // this card enters play" triggers do not happen (Q53). They are
        // lifted out of the queue BEFORE the destruction (which may itself
        // run the queue) and put back only if the card is still face-up in
        // play afterwards (a replacement that kept it there).
        const liftedEntryTriggers: TriggerResolution[] = [];
        for (const cardId of pending.candidates) {
          if (cardId === choice.keep) continue;
          for (let i = this.immediateQueue.length - 1; i >= 0; i--) {
            const queued = this.immediateQueue[i];
            if (
              queued.sourceId === cardId &&
              queued.context.event?.type === "cardEnteredPlay" &&
              queued.context.event.cardId === cardId
            ) {
              liftedEntryTriggers.unshift(...this.immediateQueue.splice(i, 1));
            }
          }
        }

        for (const cardId of pending.candidates) {
          if (cardId !== choice.keep) this.uniqueDoomed.add(cardId);
        }
        try {
          for (const cardId of pending.candidates) {
            if (cardId !== choice.keep) {
              // A NEW copy (entered play this action) never entered play, so
              // its removal raises no "destroyed / leaves play" triggers —
              // its own or anyone else's (Q53 follow-up). The old copy is
              // destroyed normally. If its replacement paused for a choice the
              // mark stays until the next top-level action.
              const isNewCopy = this.recentlyEntered.has(cardId);
              if (isNewCopy) this.silentDepartures.add(cardId);
              this.lastReplacer = undefined;
              // CR 507.5: the Unique rule destroys it, no player or card does.
              this.destroyCardCausedBy(cardId, undefined, undefined);
              // CR 507.5b: an effect took over this destruction and the copy
              // stays; Unique tries again only once that effect is gone.
              const stays = this.state.cards[cardId];
              if (this.lastReplacer && stays?.zone === "play") {
                this.uniquePrevented.set(cardId, this.lastReplacer);
              }
              this.lastReplacer = undefined;
              if (isNewCopy && !this.state.pendingChoice) this.silentDepartures.delete(cardId);
            }
          }
        } finally {
          this.uniqueDoomed.clear();
        }

        for (const lifted of liftedEntryTriggers) {
          const card = this.state.cards[lifted.sourceId];
          if (card && card.zone === "play" && !card.faceDown) {
            this.immediateQueue.unshift(lifted);
          }
        }

        // Pick up whatever the pause interrupted: triggers queued by the
        // destruction, the rest of the resolving effect, the response window.
        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "chooseOpponent": {
        assert(pending.kind === "chooseOpponent", "This choice does not match the pending decision.");
        const trigger = this.immediateQueue[0];
        assert(
          trigger && trigger.sourceId === pending.sourceId && trigger.ability.id === pending.abilityId,
          "The pending trigger is no longer waiting to resolve."
        );
        assert(pending.candidates.includes(choice.opponentId), `'${choice.opponentId}' is not one of the opponents on offer.`);
        trigger.context.opponentId = choice.opponentId;
        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        if (!this.state.pendingChoice) this.resumeEffectFrames();
        return;
      }

      case "selectTargets": {
        assert(pending.kind === "selectTargets", "This choice does not match the pending decision.");

        const trigger = this.immediateQueue[0];

        assert(
          trigger &&
            trigger.sourceId === pending.sourceId &&
            trigger.ability.id === pending.abilityId,
          "The pending trigger is no longer waiting to resolve."
        );

        for (const declaration of pending.declarations) {
          const selection = choice.selected[declaration.id];

          assert(selection, `Missing selection for target '${declaration.id}'.`);

          const max = Math.max(0, this.evaluateNumber(declaration.count, trigger.context));
          const floor = this.declaredPickFloor(declaration, trigger.context);
          const min = floor !== undefined ? Math.min(floor, max) : declaration.optional ? 0 : max;

          assert(
            (declaration.optional === true && floor !== undefined && selection.length === 0) ||
              (selection.length >= min && selection.length <= max),
            `Target '${declaration.id}' requires ` +
              (min === max ? `${max}` : `${min}-${max}`) +
              " selection(s)."
          );
          assert(
            new Set(selection).size === selection.length,
            `Target '${declaration.id}' selected the same card more than once.`
          );

          const legal = new Set(
            this.targetCandidates(declaration.selector, trigger.context).map(card => card.id)
          );

          for (const cardId of selection) {
            assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
          }

          this.assertDistinctNames(declaration, selection);
          this.assertDistinctTrades(declaration, selection);
          this.assertDistinctTypes(declaration, selection);
        }

        // Only the declarations the prompt offered are taken: a pick for one
        // that was left out (no legal candidate) is not a pick at all.
        const offered: Record<string, CardInstanceId[]> = {};
        for (const declaration of pending.declarations) {
          offered[declaration.id] = choice.selected[declaration.id];
          // The Q2 decline marker of an offered search travels with its pick.
          const declined = declinedKey(declaration.id);
          if (choice.selected[declined] !== undefined) offered[declined] = choice.selected[declined];
        }
        for (const [declId, picks] of Object.entries(choice.selected)) {
          assert(
            declId in offered || picks.length === 0,
            `Illegal target '${picks[0]}' for '${declId}'.`
          );
        }
        trigger.context.selected = {
          ...trigger.context.selected,
          ...offered
        };

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        // This trigger may have fired reentrantly from inside an effect
        // frame that is still parked (e.g. the tactic whose `destroy` killed
        // the source, mid-resolution). Drain those frames and resume the
        // response window, the same way `chooserSelectsTarget` does. Without
        // this the window is left stuck in "resolving".
        if (!this.state.pendingChoice) this.resumeEffectFrames();
        return;
      }

      case "selectDeployTargets": {
        assert(pending.kind === "selectDeployTargets", "This choice does not match the pending decision.");

        // The same shape/context `deployCard` itself validates against —
        // built here (not just left to `deployCard`'s own re-validation)
        // so a bad answer throws BEFORE `pendingChoice` is cleared below,
        // rather than destroying the choice with no way to retry it.
        const previewContext: ResolutionContext = {
          sourceId: pending.sourceId,
          controllerId: pending.playerId,
          selected: pending.selected,
          variables: pending.variables
        };

        const mergedSelected: Record<string, CardInstanceId[]> = { ...pending.selected };
        for (const declaration of pending.declarations) {
          const selection = choice.selected[declaration.id];
          assert(selection, `Missing selection for target '${declaration.id}'.`);

          const max = Math.max(0, this.evaluateNumber(declaration.count, previewContext));
          const floor = this.declaredPickFloor(declaration, previewContext);
          const min = floor !== undefined ? Math.min(floor, max) : declaration.optional ? 0 : max;
          assert(
            (declaration.optional === true && floor !== undefined && selection.length === 0) ||
              (selection.length >= min && selection.length <= max),
            `Target '${declaration.id}' requires ` +
              (min === max ? `${max}` : `${min}-${max}`) +
              " selection(s)."
          );
          assert(
            new Set(selection).size === selection.length,
            `Target '${declaration.id}' selected the same card more than once.`
          );

          const legal = new Set(
            this.targetCandidates(declaration.selector, previewContext).map(card => card.id)
          );
          for (const cardId of selection) {
            assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
          }

          this.assertDistinctNames(declaration, selection);
          this.assertDistinctTrades(declaration, selection);
          this.assertDistinctTypes(declaration, selection);
          mergedSelected[declaration.id] = selection;
        }

        this.state.pendingChoice = undefined;

        // Re-runs `deployCard` in full — safe because nothing was paid or
        // mutated before this choice was opened (see `openDeployTargetChoice`)
        // and the engine accepts no other action while a choice is pending,
        // so nothing about the board could have changed in between.
        // `pending.variables` is passed as both the resolved variables and
        // `trustedVariables`, so the roll already made isn't repeated.
        this.deployCard(
          pending.playerId,
          pending.sourceId,
          mergedSelected,
          pending.variables,
          pending.free,
          pending.fromZone,
          pending.costOverride,
          pending.ignoreThreshold,
          pending.mode,
          pending.variables
        );
        return;
      }

      case "orderTriggers": {
        assert(pending.kind === "orderTriggers", "This choice does not match the pending decision.");

        const batchId = this.immediateQueue[0]?.batchId;
        const batch = batchId ? this.getUnorderedTriggerBatch(batchId) : [];

        // CR §503.4a: the order is decided one trigger at a time — the
        // deciding player picks which happens *next*, it resolves fully,
        // then (if 2+ remain) they pick again. Not a full permutation up
        // front, since resolving one trigger can change another's legality
        // or targets.
        const pickIndex = batch.findIndex(
          queued =>
            queued.sourceId === choice.next.sourceId &&
            queued.ability.id === choice.next.abilityId
        );

        assert(
          pickIndex !== -1,
          `'${choice.next.sourceId}:${choice.next.abilityId}' is not one of the triggers waiting to resolve.`
        );

        const [picked] = batch.splice(pickIndex, 1);
        // Fresh, unshared batch id so the picked trigger resolves alone and
        // isn't re-detected as needing an ordering decision.
        picked.batchId = this.nextId("batch");

        // Queue head becomes: picked, then the still-unordered rest (their
        // shared batch id intact, so 2+ of them re-prompt after `picked`).
        this.immediateQueue.splice(0, 1 + batch.length, picked, ...batch);

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        // The ordering prompt can be raised from inside another trigger's
        // effect frame (its `processImmediateQueue` found the rest of the
        // batch), which parks that frame's remainder. Resume it once the
        // queue has drained, exactly as the chooser choices do — otherwise a
        // finished frame is left parked and `reopenOrCloseResponseWindow`
        // never closes the window (the game stalls on an empty stack).
        if (!this.state.pendingChoice) this.resumeEffectFrames();
        return;
      }

      case "chooserSelectsTarget": {
        assert(pending.kind === "chooserSelectsTarget", "This choice does not match the pending decision.");

        const declaration = pending.declaration;
        const selection = choice.selected;

        const requested = Math.max(0, this.evaluateNumber(declaration.count, pending.context));
        const legalCandidates = this.targetCandidates(
          declaration.selector,
          pending.context,
          pending.playerId,
          requested
        );
        const legal = new Set(legalCandidates.map(card => card.id));
        // RULES.md §12: an instruction impossible to fully carry out is carried
        // out as far as possible. A mandatory pick of N when only K < N legal
        // candidates exist (e.g. "discard 2" with one card in hand) requires K,
        // not an unsatisfiable N. Mirrors the clamp the UI's ActionFlow applies.
        const max = Math.min(requested, legalCandidates.length);
        const floor = this.declaredPickFloor(declaration, pending.context);
        let min = floor !== undefined ? Math.min(floor, max) : declaration.optional ? 0 : max;
        let noneOk = declaration.optional === true && floor !== undefined;
        if (
          (min === 0 || noneOk) &&
          max >= 1 &&
          legalCandidates.some(c => this.hasRestriction(c.id, "mustBePicked"))
        ) {
          min = Math.max(min, 1); // Q19: a card that must be picked is picked even in an optional pick
          noneOk = false;
        }

        // "None, or at least N" with fewer than N legal cards: only none is left.
        const shortOfFloor = noneOk && floor !== undefined && floor > max;
        assert(
          (noneOk && selection.length === 0) ||
            (!shortOfFloor && selection.length >= min && selection.length <= max),
          `Target '${declaration.id}' requires ` +
            (min === max ? `${max}` : `${min}-${max}`) +
            " selection(s)."
        );
        assert(
          new Set(selection).size === selection.length,
          `Target '${declaration.id}' selected the same card more than once.`
        );

        for (const cardId of selection) {
          assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
        }
        this.assertMustBePicked(declaration.id, legalCandidates, selection, max);

        this.assertDistinctNames(declaration, selection);
        this.assertDistinctTrades(declaration, selection);
        this.assertDistinctTypes(declaration, selection);

        assert(
          !choice.declined || (declaration.optional && selection.length === 0),
          "Only an optional pick can be declined, and a declined pick takes no card."
        );
        pending.context.selected = {
          ...pending.context.selected,
          [declaration.id]: selection,
          ...(choice.declined ? { [declinedKey(declaration.id)]: [] } : {})
        };
        if (typeof choice.faceDown === "boolean") {
          pending.context.resourceFaceDown = choice.faceDown;
        }

        this.state.pendingChoice = undefined;
        if (pending.resumeAction && pending.costStepKey) {
          // A cost step ANOTHER player decides (`otherPlayerChooses`): their pick is kept by the engine (never in the
          // action), and the paused play re-runs.
          this.emitCardPicked({ [declaration.id]: selection }, pending.playerId);
          this.costAnswers = { ...(pending.costAnswers ?? {}), [pending.costStepKey]: { ids: [...selection] } };
          this.rerunPausedAction(pending, pending.resumeAction);
          return;
        }
        if (pending.resumeAction) {
          // A cost pick (see `flipUpCard` / `bindCostChoices`): nothing has
          // been paid yet, so re-run the action with the pick merged in.
          this.emitCardPicked({ [declaration.id]: selection }, pending.playerId);
          const resumedVariables = (pending.resumeAction as { variables?: Record<string, number> }).variables;
          this.rerunPausedAction(pending, {
            ...pending.resumeAction,
            selected: {
              ...((pending.resumeAction as { selected?: Record<string, CardInstanceId[]> }).selected ?? {}),
              [declaration.id]: selection
            },
            // "Play a resource" in a FLIP UP line: the face-up / face-down answer given with the pick.
            ...(typeof choice.faceDown === "boolean"
              ? { variables: { ...(resumedVariables ?? {}), [RESOURCE_FACE_DOWN_VARIABLE]: choice.faceDown ? 1 : 0 } }
              : {})
          } as GameAction);
          return;
        }
        this.emitCardPicked({ [declaration.id]: selection }, pending.playerId);
        let followUps = pending.effects;
        if (
          this.selectorNamesZone(declaration.selector, "deck") &&
          (declaration.selector as { fromTop?: unknown }).fromTop === undefined &&
          legalCandidates[0]
        ) {
          // CR 312.1: a searched deck is shuffled afterwards, found or not.
          // Q2: a declined "may search" is not a search, so no shuffle. The
          // engine has one optional pick and no separate yes/no step, so only
          // a search with NO criteria (any card; it cannot fail, CR 312.2)
          // answered with nothing is known to be a decline. A search with
          // criteria answered with nothing is treated as a failed search
          // (CR 312.2), which still shuffles.
          // Q2 (user): a "may search" the player DECLINES (`declined: true`) is
          // no search at all: no shuffle. Answering with no card without it is
          // a search that found nothing, which still shuffles (CR 312.1/312.2).
          const declined = choice.declined === true && selection.length === 0 && declaration.optional === true;
          if (declined) {
            followUps = followUps.filter(e => e.type !== "shuffleDeck");
          } else {
            const text = JSON.stringify(followUps);
            // A shuffle already authored after the search (a sibling effect of
            // the same ability) does the job; do not shuffle twice.
            const laterShuffle = this.state.pendingEffectFrames.some(f =>
              JSON.stringify(f.effects.slice(f.index)).includes('"shuffleDeck"')
            );
            if (!laterShuffle && !text.includes('"shuffleDeck"') && !text.includes('"to":"deck"')) {
              followUps = [
                ...followUps,
                {
                  type: "shuffleDeck",
                  player: { type: "player", id: this.zoneHolderId(legalCandidates[0]) }
                }
              ];
            }
          }
        }
        this.state.pendingEffectFrames.push({
          effects: followUps,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        // A `deckSearched` trigger deferred while this search was
        // outstanding (Golden Charm) may still be queued if the search's
        // follow-up effects didn't themselves emit anything.
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "chooserSelectsOption": {
        assert(pending.kind === "chooserSelectsOption", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.index) &&
            choice.index >= 0 &&
            choice.index < pending.optionCount,
          "Invalid option index."
        );
        assert(
          !pending.unavailableOptions?.includes(choice.index),
          "That option is not available."
        );

        this.state.pendingChoice = undefined;
        if (pending.resumeAction && pending.costStepKey) {
          // The yes / no of a cost step another player decides (`otherPlayerChooses` with `may`): 0 = decline, 1 = yes.
          this.costAnswers = { ...(pending.costAnswers ?? {}), [pending.costStepKey]: { index: choice.index } };
          this.rerunPausedAction(pending, pending.resumeAction);
          return;
        }
        if (pending.resumeAction && pending.resumeVariable) {
          // A `oneOf` cost branch (see `bindCostChoices`): re-run the action.
          const resumed = pending.resumeAction as { variables?: Record<string, number> };
          this.rerunPausedAction(pending, {
            ...pending.resumeAction,
            variables: { ...(resumed.variables ?? {}), [pending.resumeVariable]: choice.index }
          } as GameAction);
          return;
        }
        this.state.pendingEffectFrames.push({
          effects: pending.options[choice.index].effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        // A sibling trigger from the same batch (Carnival Ringmaster's
        // cr-join + cr-token) may still be queued — resume it, mirroring the
        // `chooserSelectsTarget` case. Needed when the chosen option's
        // effects didn't themselves emit anything (e.g. a "Decline" branch).
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "replacementChoice": {
        assert(pending.kind === "replacementChoice", "This choice does not match the pending decision.");
        const pr = this.state.pendingReplacement;
        assert(pr, "No pending replacement to resolve.");

        this.state.pendingChoice = undefined;
        this.state.pendingReplacement = undefined;

        const ctx: ResolutionContext = {
          sourceId: pr.sourceId,
          controllerId: playerId,
          abilityId: pr.abilityId,
          selected: { ...(pr.selected ?? {}), __candidate: [pr.affectedCardId] }
        };

        if (choice.apply) {
          this.payWithReductions(pr.cost, ctx);
          this.runReplacementEffects(
            pr.affectedCardId,
            pr.key ?? `${pr.sourceId}:${pr.abilityId}`,
            pr.effects,
            ctx
          );

          // CR §506.6 / §408.4b / §408.5c: replacing a card's destruction
          // reduces to 0 the damage it took from that destruction's source,
          // so a replaced-lethal card doesn't immediately re-die on the
          // next state-based check.
          if (pr.original.event === "destroy") {
            this.reduceDamageFromDestruction(
              pr.affectedCardId,
              pr.causeSourceId,
              pr.byLethalDamage === true
            );
          }
        } else if (
          this.state.cards[pr.affectedCardId] &&
          (this.state.cards[pr.affectedCardId].zone === "play" ||
            (pr.original.event === "moveToZone" &&
              !["play", "deploying", pr.original.zone].includes(
                this.state.cards[pr.affectedCardId].zone
              )))
        ) {
          // Declined — carry out the original event, bypassing the
          // replacement check this time.
          if (pr.original.event === "destroy") {
            this.destroyCard(pr.affectedCardId, true, true);
          } else {
            this.moveCard(
              pr.affectedCardId,
              pr.original.zone,
              true,
              "bottom",
              true
            );
          }
        }

        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "chooseReplacement": {
        assert(pending.kind === "chooseReplacement", "This choice does not match the pending decision.");
        const pick = this.state.pendingReplacementPick;
        assert(pick, "No pending replacement pick to resolve.");
        const chosenKey = pick.keys[choice.index];
        assert(chosenKey !== undefined, `Replacement ${choice.index} is not one of the options.`);

        this.state.pendingChoice = undefined;
        this.state.pendingReplacementPick = undefined;

        // Apply the chosen one under the cause the replaced event had.
        const saved = {
          cause: this.currentCause,
          causeSource: this.currentCauseSourceId,
          battle: this.destroyingByBattleDamage,
          lethal: this.destroyingByLethalDamage
        };
        this.currentCause = pick.cause;
        this.currentCauseSourceId = pick.causeSourceId;
        this.destroyingByBattleDamage = pick.byBattleDamage ? pick.affectedCardId : undefined;
        this.destroyingByLethalDamage = pick.byLethalDamage ? pick.affectedCardId : undefined;
        try {
          this.applyReplacement(pick.affectedCardId, pick.trigger, pick.scope, chosenKey);
        } finally {
          this.currentCause = saved.cause;
          this.currentCauseSourceId = saved.causeSource;
          this.destroyingByBattleDamage = saved.battle;
          this.destroyingByLethalDamage = saved.lethal;
        }

        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "nameValue": {
        assert(pending.kind === "nameValue", "This choice does not match the pending decision.");
        this.assertNameable(pending.valueKind, choice.value, pending.exclude, pending.nonResource);

        if (pending.resumeAction) {
          // The name is a COST step of a player action: nothing has been paid yet, so re-run the
          // action with the answer merged in (a refused answer leaves the prompt open).
          this.state.pendingChoice = undefined;
          const resumed = pending.resumeAction as { named?: Record<string, string> };
          this.rerunPausedAction(pending, {
            ...pending.resumeAction,
            named: { ...(resumed.named ?? {}), [pending.storeAs]: choice.value }
          } as GameAction);
          return;
        }

        const src = this.state.cards[pending.sourceId];
        if (src) {
          (src.namedValues ??= {})[pending.storeAs] = choice.value;
        }

        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "mayPay": {
        assert(pending.kind === "mayPay", "This choice does not match the pending decision.");

        // "Any opponent may pay": a decline passes the offer to the next opponent.
        if (!choice.pay && pending.remainingPayers && pending.remainingPayers.length > 0) {
          this.state.pendingChoice = {
            ...pending,
            id: this.nextId("choice"),
            playerId: pending.remainingPayers[0],
            remainingPayers: pending.remainingPayers.slice(1)
          };
          return;
        }

        this.state.pendingChoice = undefined;

        // Pay from the decider's resources ("that player may pay 2"), while
        // the chosen branch still resolves under the ability's controller.
        const mayPayCtx =
          pending.playerId === pending.context.controllerId
            ? pending.context
            : { ...pending.context, controllerId: pending.playerId };

        const branch =
          choice.pay && this.canPayWithReductions(pending.cost, mayPayCtx)
            ? (() => {
                this.payWithReductions(pending.cost, mayPayCtx);
                // "you may pay 2 and pick a character": the pick is part of
                // the elected action, so once paid it cannot come up empty
                // (Q19).
                return pending.payAndPick
                  ? pending.effects.map(e =>
                      e.type === "chooserSelectsTarget" && e.declaration.optional
                        ? { ...e, declaration: { ...e.declaration, optional: false } }
                        : e
                    )
                  : pending.effects;
              })()
            : pending.elseEffects;

        // "If they do, ..." after "any opponent may pay": "they" is the payer.
        const paidByAnOpponent =
          pending.remainingPayers !== undefined && branch !== pending.elseEffects && pending.playerId !== pending.context.controllerId;
        this.state.pendingEffectFrames.push({
          effects: branch,
          index: 0,
          context: paidByAnOpponent ? { ...pending.context, opponentId: pending.playerId } : pending.context
        });
        this.resumeEffectFrames();
        // A sibling trigger from the same "fires at once" batch (one
        // the-gangs-all-here per Party Clowns copy) may still be queued — its
        // ordering / resolution only continues if the immediate queue is
        // pumped again. The chosen branch is usually the empty decline path,
        // which emits nothing to pump it for us. Mirrors `chooserSelectsTarget`
        // / `chooserSelectsOption`.
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "alternatingPay": {
        assert(pending.kind === "alternatingPay", "This choice does not match the pending decision.");
        this.advanceAlternatingPay(pending, choice.pay);
        return;
      }

      case "spendCountersMenu": {
        assert(
          pending.kind === "spendCountersMenu",
          "This choice does not match the pending decision."
        );

        // Stop the loop.
        if (choice.optionIndex === null || choice.optionIndex === undefined) {
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        assert(
          Number.isInteger(choice.optionIndex) &&
            choice.optionIndex >= 0 &&
            choice.optionIndex < pending.options.length,
          "Invalid spend-counters option."
        );
        const option = pending.options[choice.optionIndex];
        const sources = choice.sources ?? [];
        assert(
          sources.length === option.cost,
          `That option costs ${option.cost} ${pending.counter}(s); name one card per marker.`
        );
        // Tally how many markers to pull from each named pool card and
        // validate against what's actually available.
        const pull: Record<CardInstanceId, number> = {};
        for (const id of sources) pull[id] = (pull[id] ?? 0) + 1;
        for (const [id, n] of Object.entries(pull)) {
          assert(
            (pending.available[id] ?? 0) >= n,
            `Not enough ${pending.counter} markers on '${id}'.`
          );
        }

        this.state.pendingChoice = undefined;
        for (const [id, n] of Object.entries(pull)) {
          this.resolveEffect(
            {
              type: "removeCounter",
              target: { type: "card", id },
              counter: pending.counter,
              amount: n
            },
            pending.context
          );
        }

        // Run the option's effects, then re-open the menu (LIFO: push the
        // re-opener first so the option's effects finish — and any pause
        // resumes — before it fires).
        this.state.pendingEffectFrames.push({
          effects: [
            {
              type: "spendCountersMenu",
              chooser: { type: "player", id: pending.playerId },
              pool: pending.pool,
              counter: pending.counter,
              options: pending.options
            }
          ],
          index: 0,
          context: pending.context
        });
        this.state.pendingEffectFrames.push({
          effects: option.effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "anyPlayerMayPay": {
        assert(pending.kind === "anyPlayerMayPay", "This choice does not match the pending decision.");

        // The payer resolves the paid effects as their controller; the card's
        // own controller, when someone else pays, is that payer's opponent.
        const original = pending.context.controllerId;
        const payCtx: ResolutionContext = {
          ...pending.context,
          controllerId: pending.playerId,
          opponentId:
            pending.playerId !== original && isOpponentOf(this.state, pending.playerId, original) ? original : undefined
        };
        if (choice.pay && this.canPayWithReductions(pending.cost, payCtx)) {
          this.state.pendingChoice = undefined;
          this.payWithReductions(pending.cost, payCtx);
          this.state.pendingEffectFrames.push({
            effects: pending.effects,
            index: 0,
            context: payCtx
          });
          this.resumeEffectFrames();
          // A sibling trigger from the same batch may still be queued — see
          // the `mayPay` case.
          if (!this.state.pendingChoice) this.processImmediateQueue();
          return;
        }

        // Declined — offer to the next player, or end.
        if (pending.remaining.length > 0) {
          this.state.pendingChoice = {
            ...pending,
            id: this.nextId("choice"),
            playerId: pending.remaining[0],
            remaining: pending.remaining.slice(1)
          };
          return;
        }
        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        // A sibling trigger from the same batch may still be queued — see
        // the `mayPay` case.
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "resourceReveal": {
        assert(pending.kind === "resourceReveal", "This choice does not match the pending decision.");

        // The interrupted `playResource` carries on afterwards (CR 605.1c:
        // the resource still enters play) -- parked below anything the
        // reveal-deploy itself raises, and told this card's offer is made.
        const carryOn: PendingEffectFrame = {
          effects: [pending.effect],
          index: 0,
          context: {
            ...pending.context,
            resourceRevealOffered: [
              ...(pending.context.resourceRevealOffered ?? []),
              pending.resourceCardId
            ]
          }
        };

        if (!choice.cardId) {
          this.state.pendingChoice = undefined;
          this.state.pendingEffectFrames.push(carryOn);
          this.resumeEffectFrames();
          if (!this.state.pendingChoice) this.processImmediateQueue();
          return;
        }

        assert(
          pending.candidates.includes(choice.cardId),
          "That card cannot be revealed while playing this resource."
        );
        const revealed = this.requireCard(choice.cardId);
        const revealDef = this.getDefinition(revealed.id);
        assert(revealDef.revealFromHand, `'${revealDef.name}' has no 'reveal from hand' deploy option.`);

        // Rehearse the deploy first: it throws before changing anything when the
        // deploy is not legal (a missing extra-cost pick), leaving this choice open.
        this.cloneForProbe().deployCard(
          pending.playerId,
          revealed.id,
          choice.selected ?? {},
          choice.variables ?? {},
          false,
          false,
          revealDef.revealFromHand.cost
        );
        // The card is revealed from the hand (CR 605.1c: "while this card is in your hand"), then deployed.
        this.state.pendingChoice = undefined;
        this.emitReveal(
          [revealed.id],
          "all",
          revealed.id,
          undefined,
          this.pickedByRevealer(pending.playerId)
        );
        this.deployCard(
          pending.playerId,
          revealed.id,
          choice.selected ?? {},
          choice.variables ?? {},
          false,
          false,
          revealDef.revealFromHand.cost
        );
        for (const effect of revealDef.revealFromHand.effects ?? []) {
          this.resolveEffect(effect, {
            sourceId: revealed.id,
            controllerId: pending.playerId,
            selected: {}
          });
        }

        // Another hand card may offer the reveal too: the carry-on play asks
        // again (it only stops asking once the offer is declined or no card
        // is left to reveal).
        if (
          this.resourceRevealCandidates(pending.playerId, pending.resourceCardId).length > 0
        ) {
          carryOn.context = pending.context;
        }
        this.state.pendingEffectFrames.push(carryOn);
        // The deployed card resolves now, like any effect-made deploy; a
        // pause of its own (its enters-play prompt) holds the carry-on frame.
        if (this.resolveTopOfStack()) this.resumeEffectFrames();
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "playResource": {
        assert(pending.kind === "playResource", "This choice does not match the pending decision.");
        assert(typeof choice.faceDown === "boolean", "Say whether the resource is played face-down or face-up.");
        this.state.pendingChoice = undefined;
        if (pending.resumeAction) {
          // The resource a FLIP UP line plays is part of the cost: nothing has been paid yet, so re-run the action with the answer.
          const resumed = pending.resumeAction as { variables?: Record<string, number> };
          this.rerunPausedAction(pending, {
            ...pending.resumeAction,
            variables: { ...(resumed.variables ?? {}), [RESOURCE_FACE_DOWN_VARIABLE]: choice.faceDown ? 1 : 0 }
          } as GameAction);
          return;
        }
        const played = this.state.cards[pending.cardId];
        if (played && played.zone === "hand" && this.zoneHolderId(played) === pending.playerId) {
          this.playResourceCard(
            pending.playerId,
            pending.cardId,
            choice.faceDown,
            pending.emitPlayed,
            pending.attachedToFaction === true
          );
        }
        // The resource entering play can set off a trigger that pauses mid-effect-list (a name, a pick): the frames
        // it parked wait for that answer, whose own case resumes them in order (nested-pause-resume.test.ts).
        if (!this.state.pendingChoice) this.resumeEffectFrames();
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "chooseNumber": {
        assert(pending.kind === "chooseNumber", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.value) &&
            choice.value >= pending.min &&
            choice.value <= pending.max,
          `Choose an integer in [${pending.min}, ${pending.max}].`
        );

        this.state.pendingChoice = undefined;
        if (pending.effects) {
          // Self-contained sub-list to run with the chosen number bound.
          this.state.pendingEffectFrames.push({
            effects: pending.effects,
            index: 0,
            context: {
              ...pending.context,
              variables: {
                ...pending.context.variables,
                [pending.storeAs]: choice.value
              }
            }
          });
        } else {
          // `chooserSelectsNumber` interrupted mid-frame just to store a
          // value ("each player draws up to 2" — Thabbashite Wizard). The
          // rest of that frame is already parked; inject the value into
          // every parked frame's context so the following effects
          // (`draw amount: {variable n}`) see it. When the chooser is
          // nested inside `forEachPlayer`, the outer ability frame is
          // re-parked on top of the frame that actually needs the value,
          // so a "top frame only" write would miss it.
          for (const parked of this.state.pendingEffectFrames) {
            parked.context = {
              ...parked.context,
              variables: {
                ...parked.context.variables,
                [pending.storeAs]: choice.value
              }
            };
          }
        }
        this.resumeEffectFrames();
        return;
      }

      case "useTargetAbility": {
        assert(pending.kind === "useTargetAbility", "This choice does not match the pending decision.");

        // Validated before the prompt is consumed, so a refused answer
        // leaves the prompt open ("You can't use an ability unless you've
        // met its threshold" — CR 502.2).
        const chosenAbility = choice.abilityId
          ? this.getCardActivatedAbilities(pending.targetCardId).find(
              a => a.id === choice.abilityId
            )
          : undefined;
        if (chosenAbility?.threshold !== undefined && chosenAbility.threshold !== 0) {
          assert(
            this.meetsThreshold(playerId, chosenAbility.threshold),
            "Ability threshold requirements are not met."
          );
        }

        this.state.pendingChoice = undefined;

        if (choice.abilityId) {
          assert(
            pending.abilityIds.includes(choice.abilityId),
            "That ability is not one of the target card's abilities."
          );

          const ability = chosenAbility;

          if (ability) {
            const ctx: ResolutionContext = {
              sourceId: pending.targetCardId,
              controllerId: playerId,
              abilityId: ability.id,
              selected: choice.selected ?? {},
              variables: choice.variables ?? {}
            };
            this.applyVariableRolls(ability.variables, ability.variableBounds, ctx);
            this.validateTargetDeclarations(ability.targets ?? [], ctx);
            this.payWithReductions(ability.costs ?? [], ctx);
            // "Use an ability" (Poshernacle, Notion Sickness) follows the
            // ability rules (CR 606.1f, Q34): the costs are paid now, the
            // effect goes on the stack and the opponent may respond before
            // it happens. (Only the trigger that granted the use cannot be
            // responded to, CR 503.2.)
            this.processImmediateQueue();
            const repeated: Effect[] = [];
            for (let n = 0; n < Math.max(1, pending.times); n++) {
              repeated.push(...ability.effects);
            }
            this.responseStack.push({
              id: this.nextId("stack"),
              sourceId: pending.targetCardId,
              controllerId: playerId,
              kind: "ability",
              abilityId: ability.id,
              effects: repeated,
              context: ctx
            });
            this.emit({
              type: "abilityActivated",
              cardId: pending.targetCardId,
              abilityId: ability.id,
              playerId
            });
          }
        }

        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "useAnyAbility": {
        assert(pending.kind === "useAnyAbility", "This choice does not match the pending decision.");

        this.state.pendingChoice = undefined;

        if (!choice.cardId) {
          this.resumeEffectFrames();
          return;
        }

        assert(
          pending.candidateCardIds.includes(choice.cardId),
          "That card is not one you may use an ability of."
        );

        const abilities = this.getCardActivatedAbilities(choice.cardId);

        // Narrow to a follow-up "use one of THIS card's abilities" choice,
        // reusing the useTargetAbility resolution path.
        this.state.pendingChoice = {
          kind: "useTargetAbility",
          id: this.nextId("choice"),
          playerId: pending.playerId,
          targetCardId: choice.cardId,
          abilityIds: abilities.map(a => a.id),
          times: 1
        };
        return;
      }

      case "partitionCards": {
        assert(pending.kind === "partitionCards", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp && pp.phase === "partition", "No MUSTACHE SHOWDOWN is waiting for a partition.");

        assert(
          choice.piles.length === pending.piles,
          `Split into exactly ${pending.piles} piles.`
        );
        assert(
          choice.piles.every(pile => pile.length >= 1),
          "Every pile must contain at least 1 card."
        );
        const flat = choice.piles.flat();
        const expected = [...pending.cardIds].sort();
        assert(
          flat.length === pending.cardIds.length &&
            new Set(flat).size === flat.length &&
            [...flat].sort().every((cardId, i) => cardId === expected[i]),
          "The piles must partition exactly the revealed cards, each once."
        );

        pp.partitions[playerId] = choice.piles.map(pile => [...pile]);

        const nextToPartition = pp.order.find(p => !pp.partitions[p]);
        if (nextToPartition) {
          this.state.pendingChoice = {
            kind: "partitionCards",
            id: this.nextId("choice"),
            playerId: nextToPartition,
            cardIds: [...pp.revealed[nextToPartition]],
            piles: pending.piles
          };
          return;
        }

        pp.phase = "pick";
        const firstPicker = pp.order[0];
        this.state.pendingChoice = {
          kind: "pickPile",
          id: this.nextId("choice"),
          playerId: firstPicker,
          piles: pp.partitions[this.partitionOpponent(pp, firstPicker)].map(p => [...p])
        };
        return;
      }

      case "pickPile": {
        assert(pending.kind === "pickPile", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp && pp.phase === "pick", "No MUSTACHE SHOWDOWN is waiting for a pile pick.");
        assert(
          Number.isInteger(choice.index) &&
            choice.index >= 0 &&
            choice.index < pending.piles.length,
          "Invalid pile index."
        );

        pp.picks[playerId] = choice.index;

        const nextToPick = pp.order.find(p => pp.picks[p] === undefined);
        if (nextToPick) {
          this.state.pendingChoice = {
            kind: "pickPile",
            id: this.nextId("choice"),
            playerId: nextToPick,
            piles: pp.partitions[this.partitionOpponent(pp, nextToPick)].map(p => [...p])
          };
          return;
        }

        this.settleMustacheShowdown(pp);
        return;
      }

      case "takeFromPile": {
        assert(pending.kind === "takeFromPile", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp, "No MUSTACHE SHOWDOWN is waiting to finish.");
        assert(
          choice.cardIds.length <= pending.max &&
            new Set(choice.cardIds).size === choice.cardIds.length &&
            choice.cardIds.every(cardId => pending.candidates.includes(cardId)),
          `Take up to ${pending.max} card(s) from the winning pile.`
        );

        for (const cardId of choice.cardIds) {
          this.moveCard(cardId, "hand");
        }

        this.state.pendingChoice = undefined;
        this.state.pendingPartition = undefined;
        // "Shuffle the remaining cards into their owner's deck."
        for (const p of pp.order) {
          this.shuffleDeckOf(p);
        }
        this.resumeEffectFrames();
        return;
      }

      case "reorderDeck": {
        assert(pending.kind === "reorderDeck", "This choice does not match the pending decision.");

        const original = new Set(pending.cardIds);
        const player = this.requirePlayer(pending.deckOwnerId ?? pending.playerId);

        if (pending.intoHand) {
          // Some of the looked-at cards go into the hand; every other one goes
          // on the bottom of the deck in the answer's `order`.
          const taken = choice.hand ?? [];
          const rest = choice.order;
          const seen = new Set([...taken, ...rest]);
          assert(
            taken.length >= pending.intoHand.min && taken.length <= pending.intoHand.max,
            `Put ${pending.intoHand.min === pending.intoHand.max ? pending.intoHand.max : `${pending.intoHand.min}-${pending.intoHand.max}`} of the looked-at card(s) into your hand.`
          );
          assert(
            taken.length + rest.length === pending.cardIds.length &&
              seen.size === original.size &&
              [...original].every(cardId => seen.has(cardId)),
            "The cards taken into the hand and the cards sent to the bottom must be exactly the looked-at cards, each once."
          );
          this.state.pendingChoice = undefined;
          player.deck.splice(0, pending.cardIds.length);
          player.deck.push(...rest);
          for (const cardId of taken) this.moveCard(cardId, "hand");
          this.resumeEffectFrames();
          return;
        }

        if ((pending.to ?? "top") === "split") {
          const top = choice.order;
          const bottom = choice.bottom ?? [];
          const seen = new Set([...top, ...bottom]);
          assert(
            top.length + bottom.length === pending.cardIds.length &&
              seen.size === original.size &&
              [...original].every(cardId => seen.has(cardId)),
            "The top and bottom piles together must be exactly the looked-at cards, each once."
          );
          assert(
            pending.bottomCount === undefined || bottom.length === pending.bottomCount,
            `Exactly ${pending.bottomCount} card(s) must go on the bottom.`
          );
          // SYS-43: only cards still in the deck are placed, and the looked-at
          // cards are taken out wherever they now are, so a deck that changed
          // since the look is never corrupted (no card lost or duplicated).
          const inDeck = new Set(player.deck);
          player.deck = player.deck.filter(id => !original.has(id));
          player.deck.unshift(...top.filter(id => inDeck.has(id)));
          player.deck.push(...bottom.filter(id => inDeck.has(id)));
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        const reordered = new Set(choice.order);
        // "Up to the top N": the top K cards (K from 0 to N) may be rearranged.
        const lookedAt = pending.upTo ? choice.order.length : pending.cardIds.length;
        const lookedSet = new Set(pending.cardIds.slice(0, lookedAt));
        assert(
          choice.order.length === lookedAt &&
            reordered.size === lookedSet.size &&
            [...lookedSet].every(cardId => reordered.has(cardId)),
          "The new order must contain exactly the same cards, each once."
        );

        // SYS-43: see the split case above. Only the looked-at cards the answer covers move ("up to": the rest stay put).
        const stillInDeck = new Set(player.deck);
        player.deck = player.deck.filter(id => !lookedSet.has(id));
        const placed = choice.order.filter(id => stillInDeck.has(id));
        if ((pending.to ?? "top") === "bottom") {
          player.deck.push(...placed);
        } else {
          player.deck.unshift(...placed);
        }

        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "deployForFree": {
        assert(pending.kind === "deployForFree", "This choice does not match the pending decision.");

        if (!choice.cardId) {
          assert(
            !pending.heroClaim ||
              !pending.candidates.some(cardId => this.claimedTacticDryRunPlays(cardId, pending.playerId)),
            "A claimed Hero tactic that can be played must be played (SD 9)."
          );
          this.state.pendingChoice = undefined;
          // A claimed Hero tactic that is not played is removed from the game
          // (SD 10); the rest of the claim carries on.
          if (pending.heroClaim) {
            for (const cardId of pending.candidates) {
              const card = this.state.cards[cardId];
              if (card && card.zone === "table") this.moveCard(cardId, "removed");
            }
            if (pending.afterDeploy) {
              this.state.pendingEffectFrames.push({ effects: pending.afterDeploy, index: 0, context: pending.context });
            }
          }
          this.resumeEffectFrames();
          return;
        }

        assert(
          pending.candidates.includes(choice.cardId),
          "That card is not a legal free-deploy candidate."
        );

        // "Deploy any number of cards for free with total numeric cost X or
        // less." (Reality Shift) — deploy this pick, then re-prompt with the
        // pool reduced by its printed cost until it's spent / nothing fits /
        // the player declines.
        if (pending.budgetRemaining !== undefined) {
          const printedCost = this.getDefinition(choice.cardId).cost ?? 0;
          this.deployCard(
            pending.playerId,
            choice.cardId,
            choice.selected ?? {},
            choice.variables ?? {},
            !(pending.payCost ?? false),
            false,
            undefined,
            false
          );
          this.state.pendingChoice = undefined;
          const settled = this.resolveTopOfStack();
          // A chooser pause from the deployed card's own resolution takes
          // priority and ends the free-deploy loop; the ability that paused
          // on `deployForFree` resumes once that choice is answered.
          if (this.state.pendingChoice) return;

          const remaining = Math.max(0, pending.budgetRemaining - printedCost);
          const cap = Math.min(pending.perCardCap ?? remaining, remaining);
          const next = this.deployForFreeCandidates(
            pending.playerId,
            cap,
            pending.selector,
            pending.context
          );
          if (next.length > 0) {
            this.state.pendingChoice = {
              kind: "deployForFree",
              id: this.nextId("choice"),
              playerId: pending.playerId,
              candidates: next,
              resolvedMaxCost: cap,
              payCost: pending.payCost,
              budgetRemaining: remaining,
              perCardCap: pending.perCardCap,
              selector: pending.selector,
              context: pending.context
            };
            return;
          }
          if (settled) this.resumeEffectFrames();
          return;
        }

        // Deliberately not clearing pendingChoice here: deployCardForFree
        // validates (throwing before any mutation, e.g. a missing
        // extra-cost target) before it commits — see deployCard. If it
        // throws, this same choice must still be answerable, so the player
        // can retry with a corrected answer instead of getting stuck.
        this.deployCardForFree(
          pending.playerId,
          choice.cardId,
          choice.selected ?? {},
          choice.variables ?? {},
          pending.fromZone ?? false,
          pending.ignoreThreshold ?? false,
          pending.payCost ?? false,
          pending.afterDeploy
            ? { effects: pending.afterDeploy, context: pending.context }
            : undefined,
          pending.costOverride
        );
        return;
      }

      case "pileAssignment": {
        assert(pending.kind === "pileAssignment", "This choice does not match the pending decision.");

        const all = [...choice.pile1, ...choice.pile2];
        const original = new Set(pending.cardIds);
        assert(
          all.length === pending.cardIds.length &&
            new Set(all).size === all.length &&
            all.every(cardId => original.has(cardId)),
          "The two piles together must be exactly the revealed cards, each once."
        );

        this.state.pendingChoice = undefined;

        if (pending.pickerId) {
          // The splitter only separated the cards; the picker now takes a pile
          // (option 0: the first pile gets `pile1`, option 1: the second does).
          const piles = { __pileA: [...choice.pile1], __pileB: [...choice.pile2] };
          const apply = (first: string, second: string): Effect[] => [
            { type: "forEach", selected: first, effects: pending.pile1Effects },
            { type: "forEach", selected: second, effects: pending.pile2Effects }
          ];
          this.state.pendingChoice = {
            kind: "chooserSelectsOption",
            id: this.nextId("choice"),
            playerId: pending.pickerId,
            optionCount: 2,
            options: [
              { label: `Take the first pile (${piles.__pileA.length} card${piles.__pileA.length === 1 ? "" : "s"})`, effects: apply("__pileA", "__pileB") },
              { label: `Take the second pile (${piles.__pileB.length} card${piles.__pileB.length === 1 ? "" : "s"})`, effects: apply("__pileB", "__pileA") }
            ],
            style: "oneOf",
            context: { ...pending.context, selected: { ...pending.context.selected, ...piles } }
          };
          return;
        }

        const runPile = (ids: CardInstanceId[], effects: Effect[]) => {
          this.beginEventBatch();
          try {
            for (const cardId of ids) {
              const nestedContext: ResolutionContext = {
                ...pending.context,
                selected: { ...pending.context.selected, __candidate: [cardId] }
              };
              for (const nested of effects) {
                this.resolveEffect(nested, nestedContext);
                this.checkStateBasedActions();
              }
            }
          } finally {
            this.endEventBatch();
          }
        };
        runPile(choice.pile1, pending.pile1Effects);
        runPile(choice.pile2, pending.pile2Effects);

        this.resumeEffectFrames();
        return;
      }

      case "distributeAmong": {
        assert(pending.kind === "distributeAmong", "This choice does not match the pending decision.");

        for (const [cardId, share] of Object.entries(choice.shares)) {
          assert(
            Number.isInteger(share) && share >= 0,
            `Share for '${cardId}' must be a non-negative whole number.`
          );
        }
        const entries = Object.entries(choice.shares).filter(([, share]) => share > 0);

        for (const [cardId, share] of entries) {
          assert(
            pending.targets.includes(cardId),
            `'${cardId}' is not one of the distribution targets.`
          );
          assert(
            Number.isInteger(share) && share > 0,
            `Share for '${cardId}' must be a positive integer.`
          );
          assert(
            pending.caps === undefined || share <= (pending.caps[cardId] ?? 0),
            `Share for '${cardId}' is more than it can give (at most ${pending.caps?.[cardId] ?? 0}).`
          );
        }

        const total = entries.reduce((sum, [, share]) => sum + share, 0);
        assert(
          pending.upTo ? total <= pending.amount : total === pending.amount,
          `Shares must add up to ${pending.upTo ? "at most " : "exactly "}${pending.amount}, got ${total}.`
        );

        this.state.pendingChoice = undefined;

        if (pending.resumeAction && pending.costStepKey) {
          // The division of a `distribute` COST: nothing is paid yet; the shares are kept and the play re-runs.
          this.costAnswers = {
            ...(pending.costAnswers ?? {}),
            [pending.costStepKey]: { shares: Object.fromEntries(entries) }
          };
          this.rerunPausedAction(pending, pending.resumeAction);
          return;
        }

        this.beginEventBatch();

        try {
          for (const [cardId, share] of entries) {
            const nestedContext: ResolutionContext = {
              ...pending.context,
              selected: { ...pending.context.selected, __candidate: [cardId] },
              variables: { ...pending.context.variables, __amount: share }
            };

            for (const nested of pending.effects) {
              this.resolveEffect(nested, nestedContext);
              this.checkStateBasedActions();
            }
          }
        } finally {
          this.endEventBatch();
        }

        this.resumeEffectFrames();
        return;
      }

      case "chooseChosenBlockers": {
        assert(
          pending.kind === "chooseChosenBlockers",
          "This choice does not match the pending decision."
        );
        assert(
          new Set(choice.cardIds).size === choice.cardIds.length &&
            choice.cardIds.every(id => pending.candidates.includes(id)),
          "Chosen blockers must be a subset of the candidates."
        );
        if (this.state.battle && this.state.battle.phase !== "finished") {
          this.state.battle.chosenBlockers = [...choice.cardIds];
        }
        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "coinFlipReplace": {
        assert(
          pending.kind === "coinFlipReplace",
          "This choice does not match the pending decision."
        );
        const cf = this.state.pendingCoinFlip;
        assert(cf, "No coin flip is waiting on a reflip decision.");

        this.state.pendingChoice = undefined;
        this.state.pendingCoinFlip = undefined;

        // The reflip cost / rider effects resolve with the replacement card
        // as `source` ("Shuffle THIS card into its owner's deck").
        const replContext: ResolutionContext = {
          sourceId: cf.replacementSourceId,
          controllerId: cf.flipperId,
          selected: {}
        };

        let won = false;
        let rider: Effect[] = [];
        if (choice.reflip && this.canPayCosts(cf.replacementCost, replContext)) {
          this.payCosts(cf.replacementCost, replContext);
          won = this.random() < 0.5;
          rider = cf.replacementEffects;
        }

        // CR 506.5: each Coin applies to each lost flip, so a reflip that
        // loses again may use another Coin (the used one has left play).
        if (!won && rider.length > 0) {
          const next = this.findCoinFlipLossReplacement(cf.flipperId, cf.context);
          if (next) {
            this.state.pendingEffectFrames.push({
              effects: rider,
              index: 0,
              context: replContext
            });
            this.state.pendingCoinFlip = {
              ...cf,
              replacementCost: structuredClone(next.cost),
              replacementEffects: structuredClone(next.effects),
              replacementSourceId: next.sourceId
            };
            this.state.pendingChoice = {
              kind: "coinFlipReplace",
              id: this.nextId("choice"),
              playerId: cf.flipperId,
              cost: structuredClone(next.cost),
              sourceId: next.sourceId,
              flipSourceId: cf.context.sourceId,
              won: false
            };
            return;
          }
        }

        this.emit({ type: "coinFlipped", playerId: cf.flipperId, won });
        if (cf.then && cf.rollId !== undefined) {
          // A coin that sized a pick (Hammer Smash): the settled flip gives X, the rider runs, then the pick is asked.
          if (rider.length > 0) {
            this.state.pendingEffectFrames.push({ effects: rider, index: 0, context: replContext });
          }
          const picks = cf.then;
          if (picks.kind === "selectDeployTargets") {
            picks.variables = { ...picks.variables, [cf.rollId]: won ? (cf.winValue ?? 0) : (cf.loseValue ?? 0) };
          }
          this.resumeEffectFrames();
          if (!this.state.pendingChoice) this.state.pendingChoice = { ...picks, id: this.nextId("choice") };
          return;
        }
        // LIFO: the coin-flip branch resolves, then the replacement's rider.
        if (rider.length > 0) {
          this.state.pendingEffectFrames.push({
            effects: rider,
            index: 0,
            context: replContext
          });
        }
        this.state.pendingEffectFrames.push({
          effects: won ? cf.winEffects : cf.loseEffects,
          index: 0,
          context: cf.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "millInsteadOfDamage": {
        assert(pending.kind === "millInsteadOfDamage", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.count) && choice.count >= 0 && choice.count <= pending.max,
          `Choose an integer in [0, ${pending.max}].`
        );

        this.state.pendingChoice = undefined;
        if (pending.battle) {
          // Battle damage: the step is inflicted now, with this share of the
          // faction's damage put from the deck instead.
          const battle = this.state.battle;
          assert(battle, "No battle to inflict damage in.");
          battle.factionMill = { ...battle.factionMill, [pending.factionPlayerId]: choice.count };
          this.inflictBattleDamageStep(battle);
          return;
        }

        const resume = pending.resume;
        assert(resume, "No damage to resume.");
        this.millTop(pending.deckOwnerId, choice.count);
        const rest = pending.amount - choice.count;
        if (rest > 0 && this.state.cards[resume.targetId]?.zone === "play") {
          this.inflictEffectDamage(resume.targetId, rest, resume.context);
        }
        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "auctionBid": {
        assert(
          pending.kind === "auctionBid",
          "This choice does not match the pending decision."
        );
        this.advanceAuction(playerId, choice.bid);
        return;
      }
    }
  }

  /**
   * The optional "if you would lose a coin flip, you may <cost> to reflip"
   * replacement (Two-Headed Coin) available to `flipperId` — an in-play,
   * face-up card they control with a `replaces: { event: "coinFlip",
   * result: "lose" }` replacement ability whose `condition` holds and whose
   * `optionalCost` is affordable. `undefined` if none.
   */
  private findCoinFlipLossReplacement(
    flipperId: PlayerId,
    context: ResolutionContext
  ): { sourceId: CardInstanceId; cost: Cost[]; effects: Effect[] } | undefined {
    for (const source of Object.values(this.state.cards)) {
      if (
        source.zone !== "play" ||
        source.faceDown ||
        source.controllerId !== flipperId
      ) {
        continue;
      }
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "replacement") continue;
        if (ability.replaces.event !== "coinFlip") continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: flipperId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        const cost = ability.optionalCost ?? [];
        if (cost.length && !this.canPayCosts(cost, ctx)) continue;
        return {
          sourceId: source.id,
          cost,
          effects: ability.effects
        };
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Zones / destruction
  // ---------------------------------------------------------------------------

  private destroyingCardId: CardInstanceId | undefined;

  /**
   * The player whose hand or deck holds `card` while it is in one — its
   * owner, unless a `toPlayer` put it into someone else's (`heldBy`). For
   * every other zone this is just the owner.
   */
  private zoneHolderId(card: CardInstance): PlayerId {
    return (card.zone === "hand" || card.zone === "deck") && card.heldBy
      ? card.heldBy
      : card.ownerId;
  }

  /**
   * Moves `cardId` to zone `to`. A hand or deck destination is the card's
   * OWNER's unless `toPlayerId` names another player ("Put the resource into
   * your hand"): the card then sits in that player's array, is controlled by
   * them and records `heldBy` (CR §407.7–407.8: ownership never changes, so
   * discard/void/removed stay with the owner).
   */
  private moveCard(
    cardId: CardInstanceId,
    to: Zone,
    emitEvents = true,
    position: "top" | "bottom" = "bottom",
    skipReplacement = false,
    toPlayerId?: PlayerId
  ): void {
    const card = this.requireCard(cardId);
    const from = card.zone;
    const intoPlayerZone = to === "hand" || to === "deck";
    const fromHolderId = this.zoneHolderId(card);
    // Any move forgets which card removed it from the game (`voidedBy`).
    delete card.voidedBy;
    delete card.faceDownBy;
    // Set by `destroyCard` for the move it is about to make: the cards
    // attached to the host are then destroyed too (CR 301.4a).
    const viaDestroy = this.destroyingCardId === cardId;
    if (viaDestroy) this.destroyingCardId = undefined;
    const toHolderId = toPlayerId ?? card.ownerId;

    // Snapshot the face-down state for the emitted `cardMoved` before the
    // cleanup below wipes it — plus the `deployCard` case where the caller
    // already flipped it up (CR §411.3). Only meaningful for a move that
    // originates in play; a `cardMoved` with `from !== "play"` reports no
    // `faceDown`.
    const wasFaceDown =
      from === "play" &&
      (card.faceDown || this.faceDownDeparture.has(cardId));
    this.faceDownDeparture.delete(cardId);

    if (from === "play" && to !== "play") {
      delete card.deployedAsResponse;
      this.lastKnownCounters.set(cardId, { ...card.counters });
      this.lastKnownController.set(cardId, card.controllerId);
      this.lastKnownStats.set(cardId, {
        strength: this.getStat(cardId, "strength"),
        life: this.getStat(cardId, "life"),
        speed: this.getStat(cardId, "speed"),
        structure: this.getStat(cardId, "structure")
      });
    }

    if (
      from === to &&
      (toPlayerId === undefined || !intoPlayerZone || toPlayerId === fromHolderId)
    ) {
      // Every zone but the deck is an unordered set, so a same-zone move is
      // a no-op. The deck is ordered: "put the top card of your deck on the
      // bottom" (Cheats McGuillicutty, Bottlebeard, Flimflam Man, …) is a
      // real reposition within the holder's deck. (Only an explicit
      // `toPlayer` naming a DIFFERENT player's hand/deck is a real move,
      // handled below.)
      if (to === "deck") {
        const deck = this.state.players[fromHolderId]?.deck;
        const at = deck?.indexOf(cardId) ?? -1;
        if (deck && at !== -1) {
          deck.splice(at, 1);
          if (position === "top") deck.unshift(cardId);
          else deck.push(cardId);
        }
      }
      return;
    }

    // "cards cannot be put into your opponents' hands from the void, discard
    // pile or play" (Lockbox of the Aeons) — the move simply fizzles.
    if (to === "hand" && this.returnToHandRestricted(cardId, from, toHolderId)) {
      return;
    }

    // "This turn, if a card would be put into a player's hand, put it into
    // their discard pile instead." (Quotidian Misfire) — a `redirectHandMoves`
    // window. Applies to a card entering a hand from ANY zone.
    if (to === "hand" && !skipReplacement) {
      const redirect = this.handMoveRedirectFor(cardId, toHolderId);
      if (redirect && redirect !== "hand") {
        this.moveCard(cardId, redirect, emitEvents, position, true, toPlayerId);
        return;
      }
    }

    // "If a character would be put into a player's hand, destroy it instead."
    // A card entering play from `deploying` is the deploy resolving, not a
    // zone change a replacement can take over, so only RUNTIME replacements
    // see that move. A resolved tactic (CR 205.2) or a permanent that never
    // enters play (CR 507.2c) lands in its owner's discard pile like any other
    // card: every replacement sees it, and `replaces.from` (unset = "from
    // anywhere": Purifier of the Fallen, Resurrection Emporium) decides which
    // of them reach it ("from: play" / "from: hand" do not).
    const deployResolvingIntoPlay = from === "deploying" && to === "play";
    if (
      !skipReplacement &&
      this.applyReplacement(
        cardId,
        {
          event: "moveToZone",
          zone: to,
          from,
          viaDestroy
        },
        deployResolvingIntoPlay ? "runtime" : "all"
      )
    ) {
      return;
    }

    // "If the picked character would leave play, THIS character leaves play
    // in that way instead." (6r4wny 60dy9u4rd5).
    if (from === "play" && to !== "play") {
      const redirected = this.redirectTargetFor(cardId);
      if (redirected) {
        this.moveCard(
          redirected,
          to,
          emitEvents,
          position,
          skipReplacement,
          toPlayerId
        );
        return;
      }
    }

    // Paired cards (Spurious Anthropologist and the character it added): if
    // either would leave play this turn, both are removed from the game.
    if (card.pairedWith && from === "play" && to !== "play") {
      const partnerId = card.pairedWith;
      const partner = this.state.cards[partnerId];
      card.pairedWith = undefined;
      if (partner) partner.pairedWith = undefined;
      to = "removed";
      if (partner && partner.zone === "play") {
        this.moveCard(partnerId, "removed", emitEvents);
      }
    }

    // A borrowed card (Barracks of Precipitancy) is removed from the game
    // the moment it would otherwise leave play.
    if (
      card.borrowedUntilEndOfTurn &&
      from === "play" &&
      to !== "play" &&
      to !== "removed"
    ) {
      to = "removed";
    }

    // A Showdown Hero card is removed from the game when it leaves play or is
    // done resolving (SD 10) — it never reaches a hand, deck, discard or void.
    if (card.heroCard && to !== "play" && to !== "deploying" && to !== "removed") {
      to = "removed";
    }

    // A token permanent leaving play ceases to exist outright.
    // CR 301.4a: cards attached to a host follow it out of play.
    const followers =
      from === "play" && to !== "play" ? this.attachmentsFollowing(cardId) : [];

    if (card.isToken && from === "play" && to !== "play") {
      this.departedTokens.set(cardId, { ...card, zone: to });
      this.removeFromAllPlayerZones(cardId);
      for (const other of Object.values(this.state.cards)) {
        if (other.attachedTo === cardId) other.attachedTo = undefined;
      }
      delete this.state.cards[cardId];
      if (emitEvents) {
        this.emit({
          type: "cardMoved",
          cardId,
          from,
          to,
          ...(wasFaceDown ? { faceDown: true } : {})
        });
      }
      this.followHost(followers, to, emitEvents, position, toPlayerId, viaDestroy);
      return;
    }

    this.removeFromAllPlayerZones(cardId);

    card.zone = to;
    if (to !== "void" && to !== "removed") delete card.voidedBy;

    // `heldBy` is only for a hand/deck that isn't the owner's; any other move
    // (including back to the owner) clears it.
    card.heldBy =
      intoPlayerZone && toHolderId !== card.ownerId ? toHolderId : undefined;
    // A card in a hand or deck is controlled by whoever holds it. Moving out
    // of play by default keeps the last controller until the move's events
    // have been emitted (its own "leaves play" triggers read it; see
    // `releaseControlOutsidePlay`), so only a move from elsewhere, or one that
    // names the receiving player, resets it here.
    if (intoPlayerZone && (from !== "play" || toPlayerId !== undefined)) {
      card.controllerId = toHolderId;
    }

    if (to !== "play") {
      card.faceDown = false;
      // Depletion and damage are play-zone concepts (a "tapped" or damaged
      // card in hand/deck/discard is meaningless) — leaving play clears
      // both, the same way a location's turn-spanning damage still resets
      // once it's no longer in play at all.
      card.depleted = false;
      card.damage = 0;
      card.restoreLocked = undefined;
      // Tokens / counters vanish when a card leaves play; a card that comes
      // back is a new object with none (CR 409.2).
      card.counters = {};
      delete card.chosenOpponentId;
      this.lethalDamageCause.delete(cardId);
      // Snapshot the card's own links before clearing them, so a "when this
      // card leaves play" trigger (which may resolve later, behind an event
      // batch) can still read `"attachedTo"` / `{ remembered }` via the
      // `departedLinks` fallback in `resolveTargetRef`.
      if (from === "play" && (card.attachedTo || card.linkedTargets)) {
        this.departedLinks.set(cardId, {
          attachedTo: card.attachedTo,
          linkedTargets: card.linkedTargets
            ? { ...card.linkedTargets }
            : undefined
        });
      }
      card.attachedTo = undefined;
      card.linkedTargets = undefined;

      // Snapshot-copied abilities (Skin Suit) and a pending durationed
      // take-control reversion / block restriction die with the card.
      if (from === "play") {
        const copied = this.state.abilityGrants
          .filter(g => g.cardId === cardId)
          .flatMap(g => g.abilities);
        if (copied.length > 0) this.departedAbilityGrants.set(cardId, copied);
      }
      this.state.abilityGrants = this.state.abilityGrants.filter(
        g => g.cardId !== cardId
      );
      this.state.controlGrants = this.state.controlGrants.filter(
        g => g.cardId !== cardId
      );
      if (this.state.seatSwap) {
        this.state.seatSwap.exchanged = this.state.seatSwap.exchanged.filter(
          e => e.cardId !== cardId
        );
      }
      this.state.blockRestrictionGrants = this.state.blockRestrictionGrants.filter(
        g => g.targetId !== cardId && g.sourceId !== cardId
      );
      this.state.partyRestrictionGrants = this.state.partyRestrictionGrants.filter(
        g => g.targetId !== cardId
      );
      this.state.mustBlockGrants = this.state.mustBlockGrants.filter(
        g => g.attackerId !== cardId && g.blockerId !== cardId
      );
      this.state.subtypeGrants = this.state.subtypeGrants.filter(
        g => g.targetId !== cardId
      );
      // Temporary rules text lives on a card only until it enters another
      // game area (CR 508.1): a granted keyword doesn't survive a card
      // leaving play.
      if (from === "play") {
        this.state.keywordGrants = this.state.keywordGrants.filter(
          g => g.targetId !== cardId
        );
      }
      // `runtimeReplacements` (installReplacement) are NOT pruned here — a
      // tactic installs one and then goes to the discard; they expire only
      // by their own `duration` (untilEndOfTurn / endOfBattle).
    }

    // If a target leaves play, its attachments become unattached. This is
    // sufficient for faction/resource bookkeeping; card-specific attachment
    // departure effects can be layered on later. Snapshot each detaching
    // card's `attachedTo` into `departedLinks` first, so a "when the
    // attached character leaves play" trigger (Luteoderm Prototype, Key to
    // the City) can still resolve `"attachedTo"` while it processes the same
    // `cardMoved` event emitted just below.
    if (from === "play" && to !== "play") {
      for (const other of Object.values(this.state.cards)) {
        if (other.attachedTo === cardId) {
          this.departedLinks.set(other.id, {
            attachedTo: cardId,
            linkedTargets: other.linkedTargets
              ? { ...other.linkedTargets }
              : this.departedLinks.get(other.id)?.linkedTargets
          });
          other.attachedTo = undefined;
        }
      }
    }

    const owner = this.requirePlayer(card.ownerId);
    const controller = this.requirePlayer(
      card.controllerId
    );

    const zoneOwner = intoPlayerZone
      ? this.requirePlayer(toHolderId)
      : to === "discard" || to === "void" || to === "removed"
        ? owner
        : controller;

    const array = this.getZoneArray(zoneOwner, to);

    if (array) {
      // Deck index 0 is the top (see `drawCards`); everything else only has
      // one meaningful end, so `position` is deck-only.
      if (to === "deck" && position === "top") {
        array.unshift(cardId);
      } else {
        array.push(cardId);
      }
    }

    if (emitEvents) {
      this.emit({
        type: "cardMoved",
        cardId,
        from,
        to,
        ...(wasFaceDown ? { faceDown: true } : {})
      });

      // "When a player discards ... cards" (Bewilderbeast) — a hand→discard
      // move is a discard. Emitted once per card (a multi-card discard =
      // several events); a "+X for each discarded" trigger sums correctly.
      if (from === "hand" && to === "discard") {
        this.emit({ type: "cardsDiscarded", playerId: fromHolderId, count: 1 });
      }
    }

    // A "deploy this from the void" grant (Cheats) dies once the card
    // actually leaves the void (deployed, milled elsewhere, ...).
    if ((from === "void" || from === "removed") && this.state.voidPlayGrants.length) {
      this.state.voidPlayGrants = this.state.voidPlayGrants.filter(
        g => g.cardId !== cardId
      );
    }

    this.releaseControlOutsidePlay(card);
    this.followHost(followers, to, emitEvents, position, toPlayerId, viaDestroy);
  }

  /** In-play cards attached to `hostId` that leave play with it (CR 301.4a). */
  private attachmentsFollowing(hostId: CardInstanceId): CardInstanceId[] {
    const out: CardInstanceId[] = [];
    for (const other of Object.values(this.state.cards)) {
      if (other.attachedTo !== hostId || other.zone !== "play") continue;
      const def = this.getDefinition(other.id);
      // Any card attached to the leaving host follows it (CR 301.4), whether it
      // carries the ATTACH TO keyword or was attached by an effect (MOVE,
      // EQUIP). A spent resource is attached to its faction, not a host.
      if (other.faceDown || def.type === "resource") continue;
      if (def.behavior?.keepOnHostLeave) continue;
      out.push(other.id);
    }
    return out;
  }

  /**
   * CR 301.4a: a card attached to a host that leaves play leaves play the
   * same way — destroyed with a destroyed host, otherwise moved to the same
   * zone (hand, deck, removed, ...). Each one goes through its own
   * replacement effects (CR 301.4b).
   */
  private followHost(
    followers: CardInstanceId[],
    to: Zone,
    emitEvents: boolean,
    position: "top" | "bottom",
    toPlayerId: PlayerId | undefined,
    viaDestroy: boolean
  ): void {
    // A choice the host's own leave-play triggers raised does not stop the
    // attachments from leaving with it; a replacement prompt raised by one
    // attachment does (the SBA sweep handles the rest afterwards).
    const baseline = this.state.pendingChoice;
    for (const id of followers) {
      const att = this.state.cards[id];
      if (!att || att.zone !== "play") continue;
      if (this.state.pendingChoice !== baseline) return;
      if (viaDestroy || to === "discard") this.destroyCard(id, emitEvents);
      else this.moveCard(id, to, emitEvents, position, false, toPlayerId);
    }
  }

  /**
   * CR §407.3: a taken card stays under its new controller only until it
   * leaves play, so a card sitting in a hand, deck, discard pile, the void or
   * out of the game is controlled by whoever holds it (see `zoneHolderId`).
   * Run once the move's events have been emitted — the card's own "leaves
   * play" triggers read the controller it had in play when they are found.
   * `play` and `deploying` keep whoever is playing it.
   */
  private releaseControlOutsidePlay(card: CardInstance): void {
    if (card.zone === "play" || card.zone === "deploying") return;
    card.controllerId = this.zoneHolderId(card);
  }

  /**
   * Which zones a "would be put into <zone>" replacement reaches. The data
   * may name a `from` zone (`ReplacementAbility.replaces.from`): "play" limits
   * it to a card leaving play (Geiseric, Dethmürderblüdgeon); "hand" ("if you
   * would discard", CR 305.1) is a card leaving a HAND, never a destroyed
   * permanent (CR 304.1; Arcane Escrow, Phalludrix); unset names no zone and
   * reaches the card from wherever it comes (The Stone of Shame,
   * Resurrection Emporium — "from anywhere").
   */
  private replacementReachesFrom(
    replacesFrom: Zone | undefined,
    trigger: { from?: Zone; viaDestroy?: boolean }
  ): boolean {
    const from = trigger.from;
    if (!from || !replacesFrom) return true;
    if (replacesFrom === "hand") return from === "hand" && !trigger.viaDestroy;
    return from === replacesFrom;
  }

  /**
   * "If <X> would happen to `cardId`, instead <Y>." Collects every matching
   * `ReplacementAbility` (and runtime replacement) that applies; with one,
   * runs its effects (with `cardId` bound to `{ selected: "__candidate" }`)
   * and returns true so the caller skips the original mutation. With several
   * distinct ones it raises a `chooseReplacement` pick (CR 506.4). Each
   * replacement applies at most once to the same thing (CR 506.5), tracked
   * by `this.appliedReplacements`.
   */
  /** The card type a typed replacement sees for `cardId`: a face-down card in play is only a resource (CR 411.1). */
  private replacementAffectedType(cardId: CardInstanceId): CardType {
    const affected = this.state.cards[cardId];
    return affected && affected.faceDown && affected.zone === "play"
      ? "resource"
      : this.getDefinition(cardId).type;
  }

  /**
   * Whether the event being replaced was caused the way a replacement's scope asks. `by` is who caused it
   * ("destroyed by an opposing card or effect"), relative to `sourceControllerId` (the replacement's source
   * controller / installer): an unknown cause (`currentCause` undefined: the game rules, a bare state-based
   * check) satisfies neither `"self"` nor `"opponent"`. `bySource` needs an originating card (the
   * `currentCauseSourceId`) matching the selector, relative to the replacement's source: battle damage and
   * the game rules have none. The one place a destroy replacement's cause scope is judged, for a card's
   * `ReplacementAbility` and a runtime `installReplacement` alike.
   */
  private causeFitsReplacement(
    by: "self" | "opponent" | "any" | undefined,
    bySource: CardSelector | undefined,
    sourceId: CardInstanceId,
    sourceControllerId: PlayerId
  ): boolean {
    if (bySource) {
      const causeCard = this.currentCauseSourceId ? this.state.cards[this.currentCauseSourceId] : undefined;
      if (
        !causeCard ||
        !this.matchesSelector(causeCard, bySource, {
          sourceId,
          controllerId: sourceControllerId,
          selected: { __candidate: [causeCard.id] }
        })
      ) {
        return false;
      }
    }
    if (by !== undefined && by !== "any") {
      const causedBySelf = this.currentCause === sourceControllerId;
      if (by === "self" && !causedBySelf) return false;
      if (by === "opponent" && (causedBySelf || this.currentCause === undefined)) return false;
    }
    return true;
  }

  /** The context a runtime replacement's `condition` / effects resolve in for the affected card `cardId` (bound to `__candidate`). */
  private runtimeReplacementContext(
    rr: GameState["runtimeReplacements"][number],
    cardId: CardInstanceId
  ): ResolutionContext {
    // Unbound, an opponent's card being replaced names that opponent (as E3 does for a trigger).
    const affectedController = this.state.cards[cardId]?.controllerId;
    const opponentId =
      rr.opponentId ??
      (affectedController !== undefined && isOpponentOf(this.state, rr.controllerId, affectedController)
        ? affectedController
        : undefined);
    return {
      sourceId: rr.sourceId,
      controllerId: rr.controllerId,
      ...(opponentId !== undefined && opponentsOf(this.state, rr.controllerId).length > 1 ? { opponentId } : {}),
      selected: { ...rr.selected, __candidate: [cardId] }
    };
  }

  /**
   * Runs `effects` as replacement `key` of `cardId`'s event: while they run the
   * replacement is not offered again for that card (CR 506.5).
   */
  private runReplacementEffects(
    cardId: CardInstanceId,
    key: string,
    effects: Effect[],
    context: ResolutionContext
  ): void {
    let chain = this.appliedReplacements.get(cardId);
    if (!chain) {
      chain = new Set();
      this.appliedReplacements.set(cardId, chain);
    }
    chain.add(key);
    // The replacement's effects are caused by the replacement's controller, but the event they replaced
    // keeps its own cause for whatever the caller does next (a second target, the state-based check).
    const savedCause = { cause: this.currentCause, source: this.currentCauseSourceId };
    try {
      for (const effect of effects) this.resolveEffect(effect, context);
    } finally {
      this.currentCause = savedCause.cause;
      this.currentCauseSourceId = savedCause.source;
      chain.delete(key);
      if (chain.size === 0) this.appliedReplacements.delete(cardId);
    }
  }

  private applyReplacement(
    cardId: CardInstanceId,
    trigger: ReplacementTrigger,
    scope: "all" | "attached" | "runtime" = "all",
    /** Set when answering a CR 506.4 pick: the key of the replacement that was chosen. */
    chosenKey?: string
  ): boolean {
    const attachedOnly = scope === "attached";
    const chain = this.appliedReplacements.get(cardId);
    /** Every replacement that applies to this event now (CR 506.4 chooses among them). */
    const candidates: Array<{
      key: string;
      /** Replacements with the same text under one controller (copies of a card) are interchangeable: they share a signature. */
      signature: string;
      controllerId: PlayerId;
      sourceId: CardInstanceId;
      abilityId: AbilityId;
      label?: string;
      runtime?: GameState["runtimeReplacements"][number];
      optional?: { chooserId: PlayerId; cost: Cost[] };
      effects: Effect[];
      context: ResolutionContext;
    }> = [];

    const affected = this.state.cards[cardId];
    if (!affected) return false;
    // A face-down card in play is only a resource (CR 411.1): its hidden
    // printed type is not what a typed replacement sees.
    const affectedType = this.replacementAffectedType(cardId);

    // Runtime replacements installed by an `installReplacement` effect
    // (Sarcophyle Matriculation — "if the character would be destroyed
    // during this battle, take control of it instead").
    for (const rr of this.state.runtimeReplacements) {
      // CR 506.2: an extra cost isn't replaced (only attached cards' are).
      if (attachedOnly) break;
      if (trigger.event === "damage") continue;
      if (rr.replaces.event !== trigger.event) continue;
      if (rr.replaces.event === "moveToZone") {
        const dest = (trigger as { zone: Zone }).zone;
        if (rr.replaces.zone === "any") {
          if (dest === "play" || dest === "hand" || dest === "deploying") continue;
        } else if (rr.replaces.zone !== dest) {
          continue;
        }
        if (rr.replaces.from && rr.replaces.from !== (trigger as { from?: Zone }).from) {
          continue;
        }
      }
      if (rr.replaces.cardType && rr.replaces.cardType !== affectedType) continue;
      if (rr.replaces.event === "destroy") {
        // Whose card, and who caused it: both relative to the installer.
        const rel = rr.replaces.controlledBy ?? "any";
        if (rel === "self" && affected.controllerId !== rr.controllerId) continue;
        if (rel === "opponent" && !this.opponentIdsFor(rr).includes(affected.controllerId)) continue;
        if (!this.causeFitsReplacement(rr.replaces.by, rr.replaces.bySource, rr.sourceId, rr.controllerId)) continue;
      }

      const context = this.runtimeReplacementContext(rr, cardId);
      if (rr.condition && !this.evaluateCondition(rr.condition, context)) continue;

      const key = `runtime:${rr.id}`;
      if (chain?.has(key)) continue;
      candidates.push({
        key,
        signature: key,
        controllerId: rr.controllerId,
        sourceId: rr.sourceId,
        abilityId: "runtime-replacement",
        runtime: rr,
        // "you may ... instead": ask the installer's controller.
        ...(rr.optional ? { optional: { chooserId: rr.controllerId, cost: [] } } : {}),
        effects: rr.effects,
        context
      });
    }

    for (const source of Object.values(this.state.cards)) {
      // A face-down card in play has no rules text; any other card is scanned
      // (a replacement is live only in its `activeZone`, default play).
      if (source.zone === "play" && source.faceDown) continue;
      // CR 506.2a: a destroy paid as an extra cost is still replaced by the
      // replacements of cards ATTACHED to the destroyed card.
      if (attachedOnly && source.attachedTo !== cardId) continue;
      if (scope === "runtime") break;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "replacement") continue;
        const liveIn = ability.activeZone ?? "play";
        if (liveIn === "any" ? source.zone === "removed" : source.zone !== liveIn) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const r = ability.replaces;
        if (r.event !== trigger.event) continue;
        if (r.event === "damage" && trigger.event === "damage") {
          if (r.battleOnly && !trigger.battle) continue;
        }
        if (r.event === "moveToZone" && r.zone !== (trigger as { zone: Zone }).zone) {
          continue;
        }
        if (
          r.event === "moveToZone" &&
          !this.replacementReachesFrom(
            r.from,
            trigger as { from?: Zone; viaDestroy?: boolean }
          )
        ) {
          continue;
        }
        if (r.cardType && r.cardType !== affectedType) continue;

        const rel = r.controlledBy ?? "any";
        if (rel !== "any") {
          // A card put into a discard pile / hand / deck goes to its OWNER's
          // (CR 305.1, 407.7), so "your discard pile" is judged by the
          // affected card's owner, not whoever controls it right now.
          const ownerZone =
            r.event === "moveToZone" &&
            (r.zone === "discard" || r.zone === "hand" || r.zone === "deck");
          const sameController =
            (ownerZone ? affected.ownerId : affected.controllerId) ===
            source.controllerId;
          if (rel === "self" && !sameController) continue;
          if (rel === "opponent" && sameController) continue;
        }

        if (
          !this.causeFitsReplacement(
            "by" in r ? r.by : undefined,
            r.event === "destroy" ? r.bySource : undefined,
            source.id,
            source.controllerId
          )
        ) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] },
          ...(trigger.event === "damage"
            ? {
                event: {
                  type: "damageDealt" as const,
                  sourceId: trigger.sourceId,
                  targetId: cardId,
                  amount: trigger.amount,
                  battle: trigger.battle || undefined
                }
              }
            : {})
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        const key = `${source.id}:${ability.id}`;
        if (chain?.has(key)) continue;

        // Optional replacement ("you may pay/choose ... instead"): the
        // chooser is the source's controller by default, or a `PlayerRef`
        // resolved relative to the affected card's controller — Phantasmagoric
        // Tollbooth / Unloyal Necromorph.
        let optional: { chooserId: PlayerId; cost: Cost[] } | undefined;
        if (ability.optional && trigger.event !== "damage") {
          const cost = ability.optionalCost ?? [];
          const chooserId = ability.chooser
            ? this.resolvePlayerRef(ability.chooser, {
                ...context,
                controllerId:
                  this.state.cards[cardId]?.controllerId ?? source.controllerId
              }).id
            : source.controllerId;
          const chooserContext: ResolutionContext = {
            ...context,
            controllerId: chooserId
          };
          if (cost.length && !this.canPayCosts(cost, chooserContext)) {
            continue;
          }
          optional = { chooserId, cost };
        }

        candidates.push({
          key,
          signature: `${source.controllerId}|${JSON.stringify({ ...ability, name: undefined })}`,
          controllerId: source.controllerId,
          sourceId: source.id,
          abilityId: ability.id,
          label: ability.name,
          ...(optional ? { optional } : {}),
          effects: ability.effects,
          context
        });
      }
    }

    if (candidates.length === 0) return false;

    // CR 506.4: with several replacements for the one event, their
    // controller (the active player when they differ) picks which applies and
    // the rest are ignored. Identically worded replacements (copies of a
    // card) are interchangeable, so they are not a choice.
    const distinct = candidates.filter(
      (c, i) => candidates.findIndex(o => o.signature === c.signature) === i
    );
    let pick = distinct[0];
    if (chosenKey !== undefined) {
      pick = candidates.find(c => c.key === chosenKey) ?? pick;
    } else if (distinct.length > 1) {
      const controllers = new Set(candidates.map(c => c.controllerId));
      this.state.pendingChoice = {
        kind: "chooseReplacement",
        id: this.nextId("choice"),
        playerId: controllers.size === 1 ? [...controllers][0] : this.state.activePlayerId,
        affectedCardId: cardId,
        original: structuredClone(trigger),
        options: distinct.map(c => ({
          sourceId: c.sourceId,
          abilityId: c.abilityId,
          ...(c.label ? { label: c.label } : {}),
          ...(c.runtime?.once ? { delayed: true } : {})
        }))
      };
      this.state.pendingReplacementPick = {
        affectedCardId: cardId,
        trigger: structuredClone(trigger),
        scope,
        keys: distinct.map(c => c.key),
        cause: this.currentCause,
        causeSourceId: this.currentCauseSourceId,
        byBattleDamage: this.destroyingByBattleDamage === cardId,
        byLethalDamage: this.destroyingByLethalDamage === cardId
      };
      return true;
    }

    // "The next time ...": used up once it is the replacement that applies
    // (or is offered); an unchosen one keeps waiting (CR 506.4).
    const runtime = pick.runtime;
    if (runtime?.once) {
      this.state.runtimeReplacements = this.state.runtimeReplacements.filter(
        other => other.id !== runtime.id
      );
    }

    // `state.pendingReplacement` carries what to do on accept (pay + effects)
    // or decline (the original event).
    if (pick.optional) {
      const original: { event: "destroy" } | { event: "moveToZone"; zone: Zone } =
        trigger.event === "destroy"
          ? { event: "destroy" }
          : { event: "moveToZone", zone: (trigger as { zone: Zone }).zone };
      this.state.pendingChoice = {
        kind: "replacementChoice",
        id: this.nextId("choice"),
        playerId: pick.optional.chooserId,
        sourceId: pick.sourceId,
        abilityId: pick.abilityId,
        affectedCardId: cardId,
        original,
        cost: structuredClone(pick.optional.cost),
        ...(pick.label ? { label: pick.label } : {})
      };
      this.state.pendingReplacement = {
        affectedCardId: cardId,
        sourceId: pick.sourceId,
        abilityId: pick.abilityId,
        original,
        cost: structuredClone(pick.optional.cost),
        effects: structuredClone(pick.effects),
        ...(runtime ? { selected: structuredClone(runtime.selected) } : {}),
        key: pick.key,
        causeSourceId: this.currentCauseSourceId,
        byLethalDamage: this.destroyingByLethalDamage === cardId
      };
      return true;
    }

    // Read before the effects run: they become the current cause themselves.
    const destructionSourceId = this.currentCauseSourceId;
    const byLethalDamage = this.destroyingByLethalDamage === cardId;
    this.runReplacementEffects(cardId, pick.key, pick.effects, pick.context);

    // CR §506.6 / §408.4b / §408.5c: replacing a card's destruction
    // reduces to 0 the damage it took from that destruction's source,
    // so a replaced-lethal card doesn't immediately re-die on the next
    // state-based check.
    if (trigger.event === "destroy") {
      this.reduceDamageFromDestruction(cardId, destructionSourceId, byLethalDamage);
    }

    this.lastReplacer = runtime ? { runtimeId: runtime.id } : { cardId: pick.sourceId };
    return true;
  }

  /**
   * The tail of a `dealDamage` effect once its amount is final and no
   * replacement took it: prevention shields, then the damage itself (a
   * faction loses that much influence, CR 408.3) and any redirected share.
   */
  private inflictEffectDamage(
    targetId: CardInstanceId,
    raw: number,
    context: ResolutionContext
  ): void {
    const target = this.requireCard(targetId);
    const { toTarget: amount, redirects } = this.absorbDamage(targetId, raw);

    // CR §408.3: damage inflicted on a faction makes it lose an equal
    // amount of influence (after the same damage-modification pass —
    // only a direct "loses N influence" effect bypasses that). A
    // faction carries no damage markers.
    if (this.getDefinition(targetId).type === "faction") {
      if (amount > 0) {
        this.applyInfluenceDelta(this.factionHolderId(target), -amount);
        this.emit({
          type: "damageDealt",
          sourceId: context.sourceId,
          targetId,
          amount
        });
      }
    } else {
      this.noteDamage(target, [{ sourceId: context.sourceId, amount }]);
      target.damage += amount;
      // Non-battle damage supersedes an earlier battle-damage cause: a
      // card it then destroys was not "destroyed by battle damage".
      if (amount > 0) this.lethalDamageCause.delete(targetId);

      if (amount > 0) {
        this.emit({
          type: "damageDealt",
          sourceId: context.sourceId,
          targetId,
          amount
        });
      }
    }

    for (const r of redirects) {
      const rc = this.state.cards[r.cardId];
      if (!rc || rc.zone !== "play") continue;
      this.applyRedirectedDamage(rc, r.amount, context.sourceId);
      this.emit({
        type: "damageDealt",
        sourceId: context.sourceId,
        targetId: r.cardId,
        amount: r.amount
      });
    }
  }

  /**
   * The `millInsteadOfFactionDamage` offer (Trickster's Globe) for `amount`
   * damage `inflictorId` would inflict to `targetId`: set when the target is a
   * faction held by someone else and `inflictorId` controls a live Globe-style
   * ability, and the faction owner's deck has a card to put. `max` caps the
   * swap at the cards in that deck.
   */
  private factionMillOffer(
    targetId: CardInstanceId,
    amount: number,
    inflictorId: PlayerId
  ):
    | { playerId: PlayerId; sourceId: CardInstanceId; factionPlayerId: PlayerId; deckOwnerId: PlayerId; max: number }
    | undefined {
    if (amount <= 0) return undefined;
    const target = this.state.cards[targetId];
    if (!target || target.zone !== "play" || this.getDefinition(targetId).type !== "faction") {
      return undefined;
    }
    const factionPlayerId = this.factionHolderId(target);
    if (factionPlayerId === inflictorId) return undefined;
    const deckOwnerId = target.ownerId;
    const max = Math.min(amount, this.requirePlayer(deckOwnerId).deck.length);
    if (max <= 0) return undefined;
    let sourceId: CardInstanceId | undefined;
    this.forEachActiveContinuous((source, ability) => {
      if (sourceId || !ability.millInsteadOfFactionDamage) return;
      if (source.controllerId === inflictorId) sourceId = source.id;
    });
    if (!sourceId) return undefined;
    return { playerId: inflictorId, sourceId, factionPlayerId, deckOwnerId, max };
  }

  /** Puts the top `count` cards of `playerId`'s deck into their discard pile, as one batch. */
  private millTop(playerId: PlayerId, count: number): void {
    const top = this.requirePlayer(playerId).deck.slice(0, Math.max(0, count));
    if (top.length === 0) return;
    this.beginEventBatch();
    try {
      for (const cardId of top) this.moveCard(cardId, "discard");
    } finally {
      this.endEventBatch();
    }
  }

  /**
   * Runs any `damage` replacement (`ReplacementAbility.replaces.event ===
   * "damage"`) for an instance of `amount` damage about to be inflicted to
   * `cardId`; true when one applied (the caller then inflicts nothing).
   */
  private damageReplaced(
    cardId: CardInstanceId,
    amount: number,
    battle: boolean,
    sourceId?: CardInstanceId
  ): boolean {
    if (amount <= 0) return false;
    return this.applyReplacement(cardId, { event: "damage", amount, battle, sourceId });
  }

  /**
   * Destroys `cardId` with the cause stated outright, for destructions the state-based check performs on its
   * own (a self-destroying threshold paragraph, an attachment on the wrong host, the Unique rule): without
   * this the cause would be whichever effect resolved last, and a `replaces.by` / `bySource` scope
   * (Escort Ally) would misattribute the destruction. `playerId` / `sourceId` undefined = the game rules.
   * Every other destroy path already runs under its own cause: `resolveEffect` (effects, triggers, options),
   * the action baseline (costs), `checkStateBasedActions` (lethal damage: the damage dealer's controller).
   */
  private destroyCardCausedBy(
    cardId: CardInstanceId,
    playerId: PlayerId | undefined,
    sourceId: CardInstanceId | undefined
  ): void {
    const saved = { cause: this.currentCause, source: this.currentCauseSourceId };
    this.currentCause = playerId;
    this.currentCauseSourceId = sourceId;
    try {
      this.destroyCard(cardId);
    } finally {
      this.currentCause = saved.cause;
      this.currentCauseSourceId = saved.source;
    }
  }

  private destroyCard(
    cardId: CardInstanceId,
    emitEvents = true,
    skipReplacement: boolean | "cost" = false,
    byBattleDamage = false
  ): void {
    const card = this.requireCard(cardId);

    if (card.zone !== "play") {
      throw new Error(
        `Cannot destroy '${cardId}' from zone '${card.zone}'.`
      );
    }

    // "If the picked character would leave play, THIS character leaves play
    // in that way instead." (6r4wny 60dy9u4rd5) — the destroy lands on the
    // redirect target, and the originally-doomed card is spared.
    const redirected = this.redirectTargetFor(cardId);
    if (redirected) {
      this.destroyCard(redirected, emitEvents, skipReplacement, byBattleDamage);
      return;
    }

    // "If this card would be destroyed, ... instead." Checked before the
    // discard move so the replacement effects run in its place.
    // A destroy paid as an extra cost (`"cost"`) skips the card's own
    // replacements (CR 506.2) but not those of cards attached to it (506.2a).
    let replaced = false;
    if (skipReplacement !== true) {
      const previousBattleDestroy = this.destroyingByBattleDamage;
      this.destroyingByBattleDamage = byBattleDamage ? cardId : undefined;
      try {
        replaced = this.applyReplacement(cardId, { event: "destroy" }, skipReplacement === "cost" ? "attached" : "all");
      } finally {
        this.destroyingByBattleDamage = previousBattleDestroy;
      }
    }
    if (replaced) return;

    const previousController =
      card.controllerId;
    // Captured before `moveCard` clears it: a face-down resource has no
    // rules text, so its "when destroyed / leaves play" trigger must not
    // fire (CR §411.1).
    const wasFaceDown = card.faceDown;
    // Read before the move: a `setCardType` grant ends when the card leaves play.
    const typesWhenDestroyed = this.getCardTypes(cardId);

    this.destroyingCardId = cardId;
    this.moveCard(cardId, "discard", emitEvents);
    this.destroyingCardId = undefined;

    if (emitEvents) {
      // The per-turn destroyed list (`destroyedThisTurn`): face-up cards only.
      if (!wasFaceDown) {
        this.state.turnDestroyed.push({
          cardId,
          types: typesWhenDestroyed,
          controllerId: previousController
        });
      }
      this.emit({
        type: "cardDestroyed",
        cardId,
        controllerId: previousController,
        byBattleDamage: byBattleDamage || undefined,
        ...(this.currentCause !== undefined ? { causePlayerId: this.currentCause } : {}),
        ...(wasFaceDown ? { faceDown: true } : {})
      });
    }
  }

  /**
   * "Flip <cardId> face-down under its owner's control" (RULES.md §2, CR
   * §411.3 / §411.4). The card stays in the In-Play area but becomes an
   * anonymous face-down resource: this is a leaves-play / enters-play
   * boundary, so accumulated damage, counters, attachments, temporary
   * modifiers / keyword grants / restrictions and named values are all
   * wiped, and control reverts to the owner. "Leaves play" triggers key
   * off the emitted `cardMoved` with `from: "play"`.
   */
  /**
   * Turning a card face-up or face-down makes it a brand-new object (CR
   * 411.3): whatever an item waiting on the response stack picked for it is
   * gone, so that item no longer finds it. The item's own source is left alone.
   */
  private forgetPicksOfFlippedCard(cardId: CardInstanceId): void {
    for (const item of this.responseStack) {
      for (const [key, ids] of Object.entries(item.context.selected)) {
        if (key === ATTACH_TARGET_ID || !ids.includes(cardId)) continue;
        if (item.sourceId === cardId) continue;
        item.context.selected = {
          ...item.context.selected,
          [key]: ids.filter(id => id !== cardId)
        };
      }
    }
  }

  private flipCardFaceDown(cardId: CardInstanceId): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || card.faceDown) return;
    this.forgetPicksOfFlippedCard(cardId);

    // Detach anything attached to this card; drop its own attachment. Cards
    // attached to it leave play the same way it does (CR 301.4 / 301.4a), so
    // each one is flipped face-down too once the host is done (user ruling:
    // Node in a Box + Luteoderm Prototype leaves two face-down resources).
    // `departedLinks` keeps their `"attachedTo"` readable by the host's
    // "when the attached character leaves play" triggers.
    const orphaned = this.attachmentsFollowing(cardId);
    for (const other of Object.values(this.state.cards)) {
      if (other.attachedTo !== cardId) continue;
      this.departedLinks.set(other.id, {
        attachedTo: cardId,
        linkedTargets: other.linkedTargets
          ? { ...other.linkedTargets }
          : this.departedLinks.get(other.id)?.linkedTargets
      });
      other.attachedTo = undefined;
    }

    this.state.modifiers = this.state.modifiers.filter(m => m.targetId !== cardId);
    this.state.keywordGrants = this.state.keywordGrants.filter(g => g.targetId !== cardId);
    this.state.keywordSuppressions = this.state.keywordSuppressions.filter(g => g.targetId !== cardId);
    this.state.abilitySuppressions = this.state.abilitySuppressions.filter(g => g.targetId !== cardId);
    this.state.restrictions = this.state.restrictions.filter(g => g.targetId !== cardId);
    this.state.provideGrants = this.state.provideGrants.filter(g => g.targetId !== cardId);

    card.counters = {};
    card.namedValues = undefined;
    card.linkedTargets = undefined;
    card.damage = 0;
    card.depleted = false;
    card.restoreLocked = undefined;
    card.attackEligibleTurn = undefined;
    card.startedTurnInPlay = undefined;
    card.attachedTo = undefined;
    this.lethalDamageCause.delete(cardId);

    // Move it into the owner's play area (it may have been under opposing
    // control) and flip it.
    const controllerBeforeFlip = card.controllerId;
    this.removeFromAllPlayerZones(cardId);
    card.controllerId = card.ownerId;
    card.faceDown = true;
    card.zone = "play";
    this.requirePlayer(card.ownerId).play.push(cardId);

    // The card that left play here was face-up (its real self), so this is
    // a genuine "leaves play" for its printed triggers (CR §411.4): the
    // event carries no `faceDown`, even though the card is face-down
    // immediately after.
    this.emit({
      type: "cardMoved",
      cardId,
      from: "play",
      to: "play",
      controllerId: controllerBeforeFlip
    });
    // Flipping face-down is a new card entering play (RULES.md §2, CR 411.3).
    this.emit({ type: "cardEnteredPlay", cardId, playerId: card.controllerId, from: "play" });

    for (const attachmentId of orphaned) {
      this.flipCardFaceDown(attachmentId);
    }
  }

  /**
   * "Put <cardId> into play face-up" — flip an in-play FACE-DOWN card
   * face-up in place (RULES.md §2, CR §411.3 / §411.4). The inverse of
   * `flipCardFaceDown`, used by the FLIP IT staple-resource cycle. The
   * face-down resource leaves play (a `cardMoved` marked `faceDown`, so its
   * own printed triggers stay dormant while other cards see it go) and its
   * real self enters play as a completely new card (`cardEnteredPlay`):
   * tokens, depletion, damage, the faction attachment and effects on the old
   * card are gone, and `getResourceIcons` returns its printed icons rather
   * than Volition. No-op unless it's a face-down card in play.
   */
  private flipCardFaceUp(cardId: CardInstanceId): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || !card.faceDown) return;
    this.forgetPicksOfFlippedCard(cardId);

    this.state.modifiers = this.state.modifiers.filter(m => m.targetId !== cardId);
    this.state.keywordGrants = this.state.keywordGrants.filter(g => g.targetId !== cardId);
    this.state.keywordSuppressions = this.state.keywordSuppressions.filter(g => g.targetId !== cardId);
    this.state.abilitySuppressions = this.state.abilitySuppressions.filter(g => g.targetId !== cardId);
    this.state.restrictions = this.state.restrictions.filter(g => g.targetId !== cardId);
    this.state.provideGrants = this.state.provideGrants.filter(g => g.targetId !== cardId);
    card.counters = {};
    card.namedValues = undefined;
    card.linkedTargets = undefined;
    card.damage = 0;
    card.depleted = false;
    card.restoreLocked = undefined;
    card.attachedTo = undefined;
    this.lethalDamageCause.delete(cardId);

    card.faceDown = false;
    card.attackEligibleTurn = undefined;
    card.startedTurnInPlay = undefined;

    this.emit({
      type: "cardMoved",
      cardId,
      from: "play",
      to: "play",
      controllerId: card.controllerId,
      faceDown: true
    });
    this.emit({
      type: "cardEnteredPlay",
      cardId,
      playerId: card.controllerId,
      from: "play"
    });
  }

  /**
   * Move `cardId` from a non-play zone (deck / discard / void) INTO play
   * under `controllerId`. `faceDown` puts it in as an anonymous face-down
   * resource; otherwise it enters as its real type with the normal
   * entrance bookkeeping (attach-target from `context`, attack
   * eligibility, `cardEnteredPlay`).
   */
  /** Whether `hostId` may host the ATTACH TO card `cardId` entering play under `controllerId` (CR 507.2). */
  private isLegalAttachHost(
    cardId: CardInstanceId,
    hostId: CardInstanceId,
    controllerId: PlayerId
  ): boolean {
    const def = this.getDefinition(cardId);
    const host = this.state.cards[hostId];
    if (!def.attachTo || !host || host.zone !== "play" || hostId === cardId) return false;
    if (!this.hasCardType(hostId, def.attachTo)) return false;
    if (def.attachToController === "self" && host.controllerId !== controllerId) return false;
    return true;
  }

  private legalAttachHosts(cardId: CardInstanceId, controllerId: PlayerId): CardInstanceId[] {
    return Object.values(this.state.cards)
      .filter(c => this.isLegalAttachHost(cardId, c.id, controllerId))
      .map(c => c.id);
  }

  private putCardIntoPlay(
    cardId: CardInstanceId,
    controllerId: PlayerId,
    faceDown: boolean,
    context: ResolutionContext,
    borrowed = false,
    hostId?: CardInstanceId,
    pairWithSource = false
  ): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone === "play") return;

    const definition = this.getDefinition(cardId);
    const from = card.zone;

    this.removeFromAllPlayerZones(cardId);
    card.zone = "play";
    card.heldBy = undefined;
    card.controllerId = controllerId;
    card.faceDown = faceDown;
    card.attachedTo = undefined;
    card.depleted = false;
    card.damage = 0;
    card.counters = {};
    card.attackEligibleTurn = undefined;
    card.startedTurnInPlay = undefined;
    // "If that card would leave play or is in play at the end of the turn,
    // remove it from the game instead." (Barracks of Precipitancy).
    if (borrowed) card.borrowedUntilEndOfTurn = true;
    if (pairWithSource) {
      const pairSource = this.state.cards[context.sourceId];
      if (pairSource && pairSource.zone === "play") {
        card.pairedWith = pairSource.id;
        pairSource.pairedWith = cardId;
      }
    }
    this.requirePlayer(controllerId).play.push(cardId);

    this.emit({ type: "cardMoved", cardId, from, to: "play" });

    if (faceDown) {
      // A face-down card put into play is an anonymous resource entering
      // play (SYS-49): triggers watching "a card that provides [V] enters
      // play" see it; it has no rules of its own and runs no `onPlay`.
      this.emit({ type: "cardEnteredPlay", cardId, playerId: controllerId, from });
      return;
    }

    if (hostId) {
      card.attachedTo = hostId;
    } else if (definition.attachTo) {
      card.attachedTo = context.selected[ATTACH_TARGET_ID]?.[0];
    }

    this.emit({
      type: "cardEnteredPlay",
      cardId,
      playerId: controllerId,
      from
    });

    for (const effect of definition.behavior?.onPlay?.effects ?? []) {
      this.resolveEffect(effect, {
        ...context,
        sourceId: cardId,
        controllerId
      });
    }
  }

  /**
   * Where a resolved tactic goes once its effects finish — the discard
   * pile unless its `selfDisposition` (and any gate on it) says otherwise.
   */
  private applyTacticDisposition(
    cardId: CardInstanceId,
    context: ResolutionContext
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);
    const disp = definition.selfDisposition;

    // "ATTACH TO CHARACTER (put this card into play attached to that
    // character instead of into its owner's discard pile)" — a tactic whose
    // `attachTo` is set enters play attached to the host it picked at play
    // time (the reserved `attachTo` extra-cost target). Its triggered /
    // continuous abilities are then live while it sits in play.
    if (definition.attachTo && !disp) {
      const hostId = context.selected[ATTACH_TARGET_ID]?.[0];
      const host = hostId ? this.state.cards[hostId] : undefined;
      if (host && host.zone === "play") {
        const from = card.zone;
        this.removeFromAllPlayerZones(cardId);
        // The caster keeps control of the attached card, even on an
        // opponent's character (Q43, CR 204.2a); the rules text it grants is
        // used by the host's controller (the grant lives on the host).
        card.controllerId = context.controllerId;
        card.faceDown = false;
        card.attachedTo = hostId;
        card.zone = "play";
        this.requirePlayer(card.controllerId).play.push(cardId);
        this.emit({ type: "cardMoved", cardId, from, to: "play" });
        this.emit({ type: "cardEnteredPlay", cardId, playerId: card.controllerId, from });
        return;
      }
      // No legal host survived — falls through to the discard pile.
      this.moveCard(cardId, "discard");
      return;
    }

    if (
      disp &&
      (!disp.condition || this.evaluateCondition(disp.condition, context))
    ) {
      if (disp.to === "hand") {
        this.moveCard(cardId, "hand");
        return;
      }

      // faceDownResource — enter play as an anonymous face-down resource
      // under the owner.
      const from = card.zone;
      this.removeFromAllPlayerZones(cardId);
      card.controllerId = card.ownerId;
      card.faceDown = true;
      card.attachedTo = undefined;
      card.zone = "play";
      this.requirePlayer(card.ownerId).play.push(cardId);
      this.emit({ type: "cardMoved", cardId, from, to: "play" });
      this.emit({ type: "cardEnteredPlay", cardId, playerId: card.controllerId, from });
      return;
    }

    this.moveCard(cardId, "discard");
  }

  private removeFromAllPlayerZones(
    cardId: CardInstanceId
  ): void {
    for (const player of Object.values(
      this.state.players
    )) {
      player.deck = player.deck.filter(
        id => id !== cardId
      );
      player.hand = player.hand.filter(
        id => id !== cardId
      );
      player.play = player.play.filter(
        id => id !== cardId
      );
      player.discard = player.discard.filter(
        id => id !== cardId
      );
      player.void = player.void.filter(
        id => id !== cardId
      );
      player.removed = player.removed.filter(
        id => id !== cardId
      );
    }
  }

  private getZoneArray(
    player: PlayerState,
    zone: Zone
  ): CardInstanceId[] | undefined {
    switch (zone) {
      case "deck":
        return player.deck;
      case "hand":
        return player.hand;
      case "play":
        return player.play;
      case "discard":
        return player.discard;
      case "void":
        return player.void;
      case "removed":
        return player.removed;
      case "deploying":
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Turn handling
  // ---------------------------------------------------------------------------

  /**
   * Why `playerId` cannot end the turn right now (the refusal `endTurn` throws,
   * after the game-wide gates), or `undefined` when they can. Read-only.
   * Besides the timing refusals (not your turn, a battle, a response window or
   * unresolved responses) this is where "All characters must attack if they
   * can" (Silent Sentinels, Q44) shows up: `'X' must attack if it can; the turn
   * cannot end yet.`
   */
  getEndTurnBlock(playerId: PlayerId): string | undefined {
    return this.actionGateProblem("endTurn") ?? this.endTurnProblem(playerId);
  }

  /** The checks `endTurn` makes, in its order, as the refusal message. One code path for `endTurn` and `getEndTurnBlock`. */
  private endTurnProblem(playerId: PlayerId): string | undefined {
    if (playerId !== this.state.activePlayerId) return "Only the active player can end the turn.";
    if (this.state.battle) return "Cannot end the turn during a battle.";
    if (this.state.responseWindow) return "A response window is already open.";
    // "All characters must attack if they can" (Silent Sentinels, Q44): a
    // turn cannot end while an eligible character has not attacked.
    for (const cardId of this.requirePlayer(playerId).play) {
      if (this.mustStillAttack(cardId)) {
        return `'${this.getDefinition(cardId).name}' must attack if it can; the turn cannot end yet.`;
      }
    }
    if (this.responseStack.length !== 0) return "Cannot end turn with unresolved responses.";
    return undefined;
  }

  /**
   * "End turn" is an announcement. The opponent gets a normal response window
   * before the turn actually changes.
   */
  private endTurn(playerId: PlayerId): void {
    const problem = this.endTurnProblem(playerId);
    if (problem) throw new Error(problem);

    // The end of the turn is only ANNOUNCED here (CR 610.1). The
    // `turnEnding` event, the faction / scheduled end-of-turn effects and
    // every "at the end of your turn" trigger fire when the turn ACTUALLY
    // ends (CR 610.1a), after the opponent's response window: `finishTurn`.
    // CR §607.1 — only the other players respond to "I end my turn".
    const responders = this.respondersTo(playerId);
    this.openResponseWindow(
      "endTurn",
      responders[0] ?? playerId,
      {
        type: "endTurn",
        playerId
      },
      responders
    );
  }

  /**
   * Engine-side normalisation of an effect's `duration` as it resolves:
   * a bare string (`"untilEndOfTurn"`, SYS-32) becomes `{ type }`, and
   * "until the start of your next turn" is stamped with the turn number it
   * ends on = the next turn of the effect's CONTROLLER (SYS-30).
   */
  private normalizeEffectDuration(effect: Effect, context: ResolutionContext): Effect {
    const raw = (effect as { duration?: unknown }).duration;
    if (raw === undefined) return effect;
    let duration: Duration | undefined;
    if (typeof raw === "string") {
      duration = { type: raw } as Duration;
    } else if (raw && typeof raw === "object") {
      duration = raw as Duration;
    }
    if (!duration) return effect;
    if (duration.type === "untilStartOfNextTurn" && duration.untilTurn === undefined) {
      duration = {
        type: "untilStartOfNextTurn",
        untilTurn: this.turnNumberOfNextTurn(context.controllerId)
      };
    }
    if (duration.type === "untilEndOfNextTurn" && duration.untilTurn === undefined) {
      duration = {
        type: "untilEndOfNextTurn",
        untilTurn: this.turnNumberOfNextTurn(context.controllerId) + 1
      };
    }
    if (duration === raw) return effect;
    return { ...effect, duration } as Effect;
  }

  /** Shared "should this durationed entry survive end-of-turn cleanup" check for modifiers and keyword grants. */
  private durationStillActive(entry: {
    duration: Duration;
    createdTurn: number;
    sourceId?: CardInstanceId;
  }): boolean {
    if (
      entry.duration.type === "untilEndOfTurn" &&
      entry.createdTurn <= this.state.turn
    ) {
      return false;
    }

    // "until the start of your next turn" — ends at the start of the
    // controller's next turn (`untilTurn`, stamped when the effect resolved).
    if (entry.duration.type === "untilStartOfNextTurn") {
      const until = entry.duration.untilTurn;
      return until !== undefined
        ? this.state.turn < until
        : entry.createdTurn > this.state.turn - 2;
    }

    // "until the end of your next turn" — gone at the start-of-turn point
    // right after the controller's next turn.
    if (entry.duration.type === "untilEndOfNextTurn") {
      const until = entry.duration.untilTurn;
      return until !== undefined ? this.state.turn < until : true;
    }

    // "until the end of the battle" — only while that battle is running;
    // `finishBattle` sweeps them, and any left over expire at turn start.
    if (entry.duration.type === "endOfBattle") {
      return !!this.state.battle && this.state.battle.phase !== "finished";
    }

    if (entry.duration.type === "whileSourceInPlay") {
      return !!entry.sourceId && this.sourceActiveInPlay(entry.sourceId);
    }

    return true;
  }

  /**
   * Fires any `scheduleEffect`-registered delayed effects due at `when`:
   * an `endOfTurn` entry scheduled *this* turn, or a `startOfNextTurn`
   * entry whose controller is `forActivePlayer` and which was scheduled on
   * an earlier turn. Each fires once (self-resolving — no chooser pauses),
   * then is discarded.
   */
  private fireScheduledEffects(
    when: GameState["scheduledEffects"][number]["when"],
    forActivePlayer?: PlayerId
  ): void {
    const due = this.state.scheduledEffects.filter(s => {
      if (s.when !== when) return false;
      if (when === "endOfBattle") return true;
      if (when === "startOfTheNextTurn") {
        // Q32 (literal): "the next turn" = whichever turn starts next.
        return this.state.turn === s.turnScheduled + 1;
      }
      if (when === "endOfTurn") return s.turnScheduled === this.state.turn;
      if (when === "startOfOpponentNextTurn") {
        // With an opponent bound (three or more players): that player's next turn.
        if (s.opponentId !== undefined) {
          return s.opponentId === forActivePlayer && this.state.turn > s.turnScheduled;
        }
        // The turn immediately after it was scheduled, which (turns strictly
        // alternate) belongs to the scheduler's opponent = `forActivePlayer`.
        return (
          s.controllerId !== forActivePlayer &&
          this.state.turn === s.turnScheduled + 1
        );
      }
      return s.controllerId === forActivePlayer && this.state.turn > s.turnScheduled;
    });

    if (due.length === 0) return;

    const dueIds = new Set(due.map(s => s.id));
    this.state.scheduledEffects = this.state.scheduledEffects.filter(
      s => !dueIds.has(s.id)
    );

    for (const s of due) {
      const ctx: ResolutionContext = {
        sourceId: s.sourceId,
        controllerId: s.controllerId,
        ...(s.opponentId !== undefined ? { opponentId: s.opponentId } : {}),
        event: s.event,
        selected: s.selected ? structuredClone(s.selected) : {}
      };
      if (s.condition && !this.evaluateCondition(s.condition, ctx)) continue;

      // Route through the suspendable effect-frame path so a chooser effect
      // inside a scheduled rider (Final Countdown — pick which staples to
      // detach / which characters to buff and restore) pauses correctly
      // instead of resolving the rest of the list out from under it.
      this.runEffectFrame({ effects: s.effects, index: 0, context: ctx });
      this.checkStateBasedActions();
    }
  }

  private finishTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Turn owner changed before end-turn resolution."
    );

    // CR 610.1a — the turn actually ends now: end-of-turn triggers and
    // delayed effects fire, and the turn passes once they have settled.
    this.state.endingTurnFor = playerId;
    this.runTurnEndEffects(playerId);
    this.completeTurnEnd();
  }

  /** Something from the turn's start / end wave is still unresolved: a choice, parked effects, a queued trigger, the stack or a battle. */
  private turnWaveBlocked(): boolean {
    return !!(
      this.state.pendingChoice ||
      this.state.pendingEffectFrames.length > 0 ||
      this.immediateQueue.length > 0 ||
      this.state.responseWindow ||
      this.state.battle
    );
  }

  /** Called after every action: finishes a turn whose end-of-turn effects were waiting on a choice. */
  private completeTurnEnd(): void {
    const playerId = this.state.endingTurnFor;
    if (!playerId) return;
    if (this.turnWaveBlocked()) return;
    // The end-of-turn triggers (the faction's among them) have all settled: the delayed effects follow, and may
    // themselves wait on a choice.
    this.finishTurnEndTail();
    if (this.turnWaveBlocked()) return;
    this.state.endingTurnFor = undefined;
    if (this.state.result) return;
    this.passTurn(playerId);
  }

  private runTurnEndEffects(playerId: PlayerId): void {
    this.emit({
      type: "turnEnding",
      playerId
    });

  }

  /** What follows the end-of-turn triggers once they have all settled: the turn's delayed effects and cleanups. */
  private finishTurnEndTail(): void {
    // "At the end of the turn, ..." delayed effects resolve as part of the
    // turn ending, before the opponent's end-of-turn response window.
    this.fireScheduledEffects("endOfTurn");

    // Borrowed cards (Barracks of Precipitancy) that survived to end of
    // turn are removed from the game.
    for (const card of Object.values(this.state.cards)) {
      if (card.borrowedUntilEndOfTurn && card.zone === "play") {
        this.moveCard(card.id, "removed");
      }
    }
    // A pairing lasts "this turn" only.
    for (const card of Object.values(this.state.cards)) card.pairedWith = undefined;
    this.checkStateBasedActions();
  }

  private passTurn(playerId: PlayerId): void {
    const next = this.requirePlayer(nextLivingSeat(this.state, playerId));

    this.state.turn++;
    this.state.activePlayerId = next.id;
    this.state.priorityPlayerId = next.id;
    if (this.state.showdown) this.state.showdown.heroDamageThisTurn = {};
    this.state.turnEventTally = {};
    this.state.turnDeploys = {};
    this.state.turnDestroyed = [];
    this.state.tacticsPlayedThisTurn = [];
    this.state.tacticPlayVariables = {};
    this.state.damageThisTurn = {};
    this.state.factionDamageInflictedThisTurn = {};
    this.state.influenceLostThisTurn = {};
    this.state.abilityUsesThisTurn = {};
    this.state.attacksThisTurn = {};
    this.state.attackDeclarationsThisTurn = {};

    // The start-of-turn point (CR §602): clears character damage, ends all
    // "this turn" effects, resets attack eligibility, runs the Restore Rule.
    this.applyFactionStartOfTurn(next.id);
    // "This turn" effects ending can leave an attached card on a host that is
    // no longer the right type (CR 507.2e): settle it at once.
    this.checkStateBasedActions();

    // The "at the start of your turn" triggers (CR §602.2) — the faction's
    // Restore Rule and Develop Rule among them (see `factionStartTriggers`) —
    // are ordered and resolved by the turn's player; the delayed effects wait.
    this.state.startingTurnFor = next.id;
    this.emit({
      type: "turnStarted",
      playerId: next.id
    });
    this.completeTurnStart();
  }

  /**
   * Called after every action: once the start-of-turn trigger wave has fully
   * settled (no choice, no queued trigger, nothing on the stack), the delayed
   * effects of the turn's start fire.
   */
  private completeTurnStart(): void {
    const playerId = this.state.startingTurnFor;
    if (!playerId) return;
    if (this.turnWaveBlocked()) return;
    this.state.startingTurnFor = undefined;
    if (this.state.result) return;

    // "At the start of your next turn, ..." delayed effects, after the
    // start-of-turn point and the turnStarted trigger wave.
    this.fireScheduledEffects("startOfNextTurn", playerId);
    // "At the start of your opponent's next turn, ..." (Final Countdown) —
    // fires now, on the turn right after it was scheduled.
    this.fireScheduledEffects("startOfOpponentNextTurn", playerId);
    // "At the start of the next turn, ..." (Drill Instructor) — whoever's turn that is.
    this.fireScheduledEffects("startOfTheNextTurn", playerId);
  }

  // ---------------------------------------------------------------------------
  // Battle system
  // ---------------------------------------------------------------------------

  getBattleView(): BattleView | undefined {
    const battle = this.state.battle;

    if (!battle) {
      return undefined;
    }

    let actingPlayerId: PlayerId | undefined;

    if (
      this.state.responseWindow &&
      this.isBattleResponseWindow(this.state.responseWindow) &&
      this.state.responseWindow.phase === "acceptingResponses"
    ) {
      actingPlayerId = this.state.responseWindow.priorityPlayerId;
    } else if (battle.phase === "blocking") {
      actingPlayerId = battle.defenderPlayerId;
    } else if (battle.phase === "attackerDamageAssignment") {
      actingPlayerId = battle.attackerPlayerId;
    } else if (battle.phase === "defenderDamageAssignment") {
      actingPlayerId = battle.defenderPlayerId;
    }

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    // The stored parties are only pruned at battle step boundaries, so a
    // character a tactic destroyed or bounced mid-battle is still listed until
    // damage. The view reads through the same "still in the battle" check the
    // prune uses, so it shows the loss the moment it happens (read-only: the
    // stored parties are untouched).
    const attackingParty = battle.attackingParty.filter(cardId =>
      this.isCardStillInBattle(cardId, battle)
    );
    const blockingParty = battle.blockingParty.filter(cardId =>
      this.isCardStillInBattle(cardId, battle)
    );

    const sourceParty = attackerAssigning
      ? attackingParty
      : defenderAssigning
        ? blockingParty
        : [];

    const damageSources = sourceParty
      .filter(cardId => this.canAssignBattleDamage(cardId, battle))
      .filter(cardId =>
        battle.speed === undefined
          ? false
          : this.getStat(cardId, "speed") === battle.speed
      )
      .map(cardId => ({
        cardId,
        // A character assigns damage equal to its strength, floored at 0
        // (CR §410.4 — a value pushed below 0 stays at 0).
        strength: Math.max(0, this.getStat(cardId, "strength")),
        legalTargets: this.getLegalBattleDamageTargets(
          cardId,
          attackerAssigning,
          battle
        )
      }));

    // A damage step where nobody has a choice: every source that deals damage has exactly one legal target.
    let forcedAssignments: BattleDamageAssignment[] | null = null;
    if (attackerAssigning || defenderAssigning) {
      const dealing = damageSources.filter(source => source.strength > 0 && source.legalTargets.length > 0);
      if (!dealing.some(source => source.legalTargets.length > 1)) {
        forcedAssignments = dealing.map(source => ({
          sourceId: source.cardId,
          target: source.legalTargets[0],
          amount: source.strength
        }));
      }
    }

    // The speed levels still to come (CR 609.1): characters in the battle that have not assigned yet, slower than now.
    const upcomingSpeeds = [
      ...new Set(
        [...attackingParty, ...blockingParty]
          .filter(cardId => this.canAssignBattleDamage(cardId, battle))
          .map(cardId => this.getStat(cardId, "speed"))
          .filter(speed => battle.speed === undefined || speed < battle.speed)
      )
    ].sort((a, b) => b - a);

    return {
      battleId: battle.id,
      phase: battle.phase,
      speed: battle.speed,
      attackerPlayerId: battle.attackerPlayerId,
      defenderPlayerId: battle.defenderPlayerId,
      target: structuredClone(battle.target),
      attackingParty,
      blockingParty,
      participants: structuredClone(battle.participants),
      assignedDamageBy: [...battle.assignedDamageBy],
      rounds: structuredClone(battle.rounds),
      actingPlayerId,
      damageSources,
      lockedAssignments: [
        ...battle.attackerAssignments,
        ...battle.defenderAssignments
      ].map(assignment => structuredClone(assignment)),
      forcedAssignments,
      upcomingSpeeds
    };
  }

  /**
   * CR 204.3: a character may attack if it started the turn in play under
   * its controller (as a character, or as any face-up permanent that has
   * since become one), or has AGGRO.
   */
  private startedTurnInPlayUnderControl(cardId: CardInstanceId): boolean {
    const c = this.state.cards[cardId];
    if (!c) return false;
    return (
      c.attackEligibleTurn === this.state.turn ||
      c.startedTurnInPlay === this.state.turn ||
      this.hasKeyword(cardId, "aggro")
    );
  }

  /** "must attack if it can": an un-depleted, attack-eligible character with `mustAttack` (and nothing stopping it). */
  private mustStillAttack(cardId: CardInstanceId): boolean {
    const c = this.state.cards[cardId];
    if (!c || c.zone !== "play" || c.faceDown || c.depleted) return false;
    if (!this.hasCardType(cardId, "character")) return false;
    if (!this.hasRestriction(cardId, "mustAttack")) return false;
    if (this.hasRestriction(cardId, "cannotAttack")) return false;
    if (
      this.hasRestriction(cardId, "attackOncePerTurn") &&
      (this.state.attacksThisTurn[cardId] ?? 0) >= 1
    ) {
      return false;
    }
    return this.startedTurnInPlayUnderControl(cardId);
  }

  /** The timing checks `declareAttack` makes first, as the refusal message. */
  private attackTimingProblem(playerId: PlayerId): string | undefined {
    if (this.state.battle) return "Battle already in progress.";
    if (this.state.responseWindow) return "Cannot attack during a response window.";
    if (this.responseStack.length !== 0) return "Responses are unresolved.";
    if (playerId !== this.state.activePlayerId) return "Only the active player may attack.";
    return undefined;
  }

  /** The per-attacker checks of `declareAttack` (in its order), as the refusal message. The card must exist. */
  private attackerProblem(playerId: PlayerId, attackerId: CardInstanceId): string | undefined {
    const attacker = this.requireCard(attackerId);
    if (attacker.controllerId !== playerId) return "You do not control an attacker.";
    if (attacker.zone !== "play") return "Attacker must be in play.";
    if (!this.hasCardType(attackerId, "character")) return "Only characters can attack.";
    if (attacker.depleted) return "Depleted characters cannot attack.";
    if (this.hasRestriction(attackerId, "cannotAttack")) return "Character cannot attack.";
    if (!this.startedTurnInPlayUnderControl(attackerId)) {
      return "Character did not start the turn in play under your control and does not have AGGRO.";
    }
    if (
      this.hasRestriction(attackerId, "attackOncePerTurn") &&
      (this.state.attacksThisTurn[attackerId] ?? 0) >= 1
    ) {
      return "This character can attack only once each turn.";
    }
    return undefined;
  }

  /**
   * The target checks of `declareAttack`: whose faction or location is hit
   * (`defenderId`), or the refusal message.
   */
  private resolveAttackTarget(
    playerId: PlayerId,
    target: BattleState["target"]
  ): { defenderId: PlayerId } | { problem: string } {
    if (target.type === "faction") {
      if (target.playerId === playerId) return { problem: "You cannot attack your own faction." };
      if (!isLiving(this.state, target.playerId)) return { problem: "That player is out of the game." };
      return { defenderId: target.playerId };
    }
    const targetCard = this.requireCard(target.cardId);
    if (targetCard.zone !== "play") return { problem: "Attack target must be in play." };
    if (this.getDefinition(target.cardId).type !== "location") {
      return { problem: "Battles may target an opposing faction or location." };
    }
    if (targetCard.controllerId === playerId) return { problem: "You cannot attack your own location." };
    return { defenderId: targetCard.controllerId };
  }

  /**
   * "Your opponents cannot attack your faction." (High Court of Demands,
   * Theocratic Senate of Marduun): whether an in-play
   * `ContinuousAbility.preventsAttackOnFaction` bars this party from
   * attacking `defenderId`'s faction.
   */
  private factionAttackPrevented(defenderId: PlayerId, attackerIds: CardInstanceId[]): boolean {
    let prevented = false;
    this.forEachActiveContinuous((source, ability, context) => {
      if (prevented) return;
      const rule = ability.preventsAttackOnFaction;
      if (!rule) return;
      if (!this.scopeMatchesPlayer(rule.player, source.controllerId, defenderId)) return;
      const partyMatches =
        !rule.partyAllMatch ||
        attackerIds.every(attackerId =>
          this.matchesSelector(this.requireCard(attackerId), rule.partyAllMatch!, {
            ...context,
            selected: { ...context.selected, __candidate: [attackerId] }
          })
        );
      if (partyMatches) prevented = true;
    });
    return prevented;
  }

  /** "Players can attack only once each turn." (Narrow Passage): the refusal when `playerId` has used up the tightest `attackLimitPerTurn`. */
  private attackLimitProblem(playerId: PlayerId): string | undefined {
    let attackLimit = Infinity;
    this.forEachActiveContinuous((_source, ability, context) => {
      if (ability.attackLimitPerTurn === undefined) return;
      attackLimit = Math.min(
        attackLimit,
        Math.max(0, this.evaluateNumber(ability.attackLimitPerTurn, context))
      );
    });
    return (this.state.attackDeclarationsThisTurn[playerId] ?? 0) < attackLimit
      ? undefined
      : "You have already attacked the maximum number of times this turn.";
  }

  /** An attack tax `playerId` cannot pay makes the declaration illegal. */
  private attackTaxProblem(playerId: PlayerId, attackTax: number): string | undefined {
    return this.getAvailableResourceIds(playerId).length >= attackTax
      ? undefined
      : `You must pay ${attackTax} to attack.`;
  }

  /**
   * What `playerId` could declare as an attack right now, read-only: the
   * characters that pass `declareAttack`'s per-attacker checks, the ones that
   * must attack ("must attack if it can": Silent Sentinels), the factions and
   * locations that can be named, and the attack tax. The same private checks
   * `declareAttack` runs answer it, so it cannot disagree with `perform`; the
   * exact combination (party composition, a particular target) is still the
   * last word of `perform`.
   *
   * `attackerIds` is the party the targets and tax are worked out for
   * (default: every attacker, so `targets` is what some party could name and
   * `tax` is the tax if all of them go).
   */
  getAttackOptions(playerId: PlayerId, attackerIds?: CardInstanceId[]): AttackOptions {
    const nothing = (blockedReason: string): AttackOptions => ({
      attackers: [],
      mustAttack: [],
      targets: [],
      tax: 0,
      blockedReason
    });

    const player = this.requirePlayer(playerId);
    const blocked =
      this.actionGateProblem("declareAttack") ??
      this.attackTimingProblem(playerId) ??
      this.attackLimitProblem(playerId);
    if (blocked) return nothing(blocked);

    const attackers = player.play.filter(
      cardId => !!this.state.cards[cardId] && this.attackerProblem(playerId, cardId) === undefined
    );
    const mustAttack = attackers.filter(cardId => this.mustStillAttack(cardId));
    const party = attackerIds ?? attackers;

    const targets: AttackTarget[] = [];
    if (party.length > 0) {
      // Any other player's faction (SD 12: Heroes may attack each other).
      for (const otherId of otherLivingSeats(this.state, playerId)) {
        if (this.factionAttackPrevented(otherId, party)) continue;
        targets.push({ type: "faction", playerId: otherId });
      }
      for (const card of Object.values(this.state.cards)) {
        if (card.zone !== "play") continue;
        const target: AttackTarget = { type: "card", cardId: card.id };
        if ("problem" in this.resolveAttackTarget(playerId, target)) continue;
        targets.push(target);
      }
    }

    const tax = party.length > 0 ? this.attackTaxFor(playerId, party) : 0;
    // The cheapest legal declaration decides whether an attack can be paid for at all: tax only grows with the party.
    const cheapest =
      attackerIds !== undefined
        ? tax
        : mustAttack.length > 0
          ? this.attackTaxFor(playerId, mustAttack)
          : attackers.length > 0
            ? Math.min(...attackers.map(cardId => this.attackTaxFor(playerId, [cardId])))
            : 0;

    const result: AttackOptions = { attackers, mustAttack, targets, tax };
    const reason =
      (attackers.length === 0 ? "No character can attack." : undefined) ??
      (targets.length === 0 ? "There is nothing this party can attack." : undefined) ??
      (cheapest > 0 ? this.attackTaxProblem(playerId, cheapest) : undefined);
    if (reason) result.blockedReason = reason;
    return result;
  }

  /**
   * The requirements on forming an attacking party (CR 505): every character that
   * "must attack if it can" is to be among the attackers, and every in-play party
   * restriction that applies is to hold. One requirement that is not met makes the
   * attack illegal (CR 505.1). With several, the party must satisfy at least one
   * and as many as any other attack could (CR 505.2, 505.2c) - characters that
   * must attack and party limits that cannot all be honoured still leave an
   * attack possible. The refusal names the first requirement the party breaks.
   */
  private assertAttackRequirements(playerId: PlayerId, attackerIds: CardInstanceId[]): void {
    const playCards = this.requirePlayer(playerId).play;
    const mustAttack = playCards.filter(cardId => this.mustStillAttack(cardId));
    const unmetFor = (party: CardInstanceId[]): { total: number; problems: string[] } => {
      const partySet = new Set(party);
      const report = this.partyCompositionReport(party, "attacking");
      const leftOut = mustAttack
        .filter(cardId => !partySet.has(cardId))
        .map(cardId => `'${this.getDefinition(cardId).name}' must attack if it can and was left out.`);
      return { total: mustAttack.length + report.total, problems: [...leftOut, ...report.problems] };
    };

    const declared = unmetFor(attackerIds);
    if (declared.problems.length === 0) return;
    // A lone unmet requirement, or a party that meets none, is not a best effort.
    if (declared.total < 2 || declared.problems.length >= declared.total) {
      throw new Error(declared.problems[0]);
    }

    // The fewest requirements any attack by this player leaves unmet; parties are
    // searched exhaustively while the field is small.
    const candidates = playCards.filter(
      cardId => !!this.state.cards[cardId] && this.attackerProblem(playerId, cardId) === undefined
    );
    if (candidates.length > 12) throw new Error(declared.problems[0]);
    let fewest = declared.problems.length;
    for (let mask = 1; mask < 1 << candidates.length; mask += 1) {
      const party = candidates.filter((_, index) => (mask & (1 << index)) !== 0);
      fewest = Math.min(fewest, unmetFor(party).problems.length);
    }
    if (declared.problems.length > fewest) throw new Error(declared.problems[0]);
  }

  private declareAttack(
    playerId: PlayerId,
    attackerIds: CardInstanceId[],
    declaredTarget: BattleState["target"] | undefined
  ): void {
    const timingProblem = this.attackTimingProblem(playerId);
    if (timingProblem) throw new Error(timingProblem);
    assert(attackerIds.length > 0, "No attackers selected.");
    assert(
      new Set(attackerIds).size === attackerIds.length,
      "An attacker was selected more than once."
    );

    // An announcement that names no target attacks the opponent's faction (CR 608.1a).
    let target = declaredTarget;
    if (!target) {
      const opponents = otherLivingSeats(this.state, playerId);
      assert(opponents.length === 1, "Choose a target for the attack.");
      target = { type: "faction", playerId: opponents[0]! };
    }

    const resolvedTarget = this.resolveAttackTarget(playerId, target);
    if ("problem" in resolvedTarget) throw new Error(resolvedTarget.problem);
    const defenderId = resolvedTarget.defenderId;

    const battleId = this.nextId("battle");

    // "must attack if it can": any eligible, un-depleted controlled
    // character with `mustAttack` and at least one legal target has to be
    // among the declared attackers. Checked BEFORE anything is depleted so a
    // rejected declaration leaves the board untouched. (A turn with no
    // declared attack at all is not policed here.)
    // Party size / parity requirements are weighed together with those.
    this.assertAttackRequirements(playerId, attackerIds);

    // Validate every declared attacker before anything else is mutated (tax
    // paid, declaration counted, characters depleted) so a declaration that
    // includes one illegal attacker (e.g. a character with Mittens of
    // Muffled Thought's `cannotAttack` restriction) is rejected atomically
    // instead of partially applying — depleting the legal attackers ahead of
    // the illegal one in the array — before throwing.
    for (const attackerId of attackerIds) {
      const attackerProblem = this.attackerProblem(playerId, attackerId);
      if (attackerProblem) throw new Error(attackerProblem);
    }

    // "Your opponents cannot attack your faction." (High Court of Demands,
    // Theocratic Senate of Marduun) — an in-play
    // `ContinuousAbility.preventsAttackOnFaction`.
    if (target.type === "faction") {
      assert(
        !this.factionAttackPrevented(defenderId, attackerIds),
        "That faction cannot be attacked."
      );
    }

    // "Players can attack only once each turn." (Narrow Passage) — an in-play
    // `ContinuousAbility.attackLimitPerTurn`. The tightest limit wins.
    const attackLimitProblem = this.attackLimitProblem(playerId);
    if (attackLimitProblem) throw new Error(attackLimitProblem);

    // "Each opponent must pay N to attack." (The Ministry of Other Smaller
    // Ministries) — an in-play `ContinuousAbility.attackTax`. Charged before
    // anything is depleted; unaffordable => the attack is illegal.
    const attackTax = this.attackTaxFor(playerId, attackerIds);
    if (attackTax > 0) {
      const attackTaxProblem = this.attackTaxProblem(playerId, attackTax);
      if (attackTaxProblem) throw new Error(attackTaxProblem);
      this.payNumericCost(playerId, attackTax);
    }

    this.state.attackDeclarationsThisTurn[playerId] =
      (this.state.attackDeclarationsThisTurn[playerId] ?? 0) + 1;

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        const attacker = this.requireCard(attackerId);

        attacker.depleted = true;
        this.state.attacksThisTurn[attackerId] =
          (this.state.attacksThisTurn[attackerId] ?? 0) + 1;

        this.emit({
          type: "cardDepleted",
          cardId: attackerId
        });
      }
    } finally {
      this.endEventBatch();
    }

    const battle: BattleState = {
      id: battleId,
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      target,
      attackingParty: [...attackerIds],
      blockingParty: [],
      participants: attackerIds.map(cardId => ({ cardId, side: "attacking" as const })),
      rounds: [],
      phase: "afterAttackersResponse",
      assignedDamageBy: [],
      attackerAssignments: [],
      defenderAssignments: []
    };

    this.state.battle = battle;

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        this.emit({
          type: "characterAttacked",
          cardId: attackerId,
          battleId
        });
      }
    } finally {
      this.endEventBatch();
    }

    this.emit({
      type: "battleStarted",
      battleId: battle.id
    });

    // CR §608.1c: the attacking player may use tactics/abilities as many
    // times as they want, then the defending player may do the same.
    this.openResponseWindow(
      "battleAfterAttackers",
      battle.attackerPlayerId,
      {
        type: "battleBlocking",
        battleId: battle.id
      },
      this.battleResponders(battle)
    );
  }

  /**
   * The total `attackTax` `playerId` must pay to attack with `attackerIds`
   * (The Ministry of Other Smaller Ministries, Auspicious Tax). Shared by a
   * declared attack and one made by an effect (`initiateAttack`).
   */
  private attackTaxFor(
    playerId: PlayerId,
    attackerIds: CardInstanceId[]
  ): number {
    let attackTax = 0;
    this.forEachActiveContinuous((source, ability, context) => {
      const rule = ability.attackTax;
      if (!rule) return;
      if (rule.player === "activePlayer") {
        // charged to whoever is declaring the attack, regardless of source
      } else if (
        !this.scopeMatchesPlayer(rule.player, source.controllerId, playerId)
      ) {
        return;
      }
      if (rule.requiresAttackerMatch) {
        const matches = attackerIds.some(id => {
          const card = this.state.cards[id];
          return (
            !!card &&
            this.matchesSelector(
              card,
              { ...rule.requiresAttackerMatch!, zone: "any" },
              context
            )
          );
        });
        if (!matches) return;
      }
      attackTax += Math.max(0, this.evaluateNumber(rule.amount, context));
    });
    return attackTax;
  }

  /**
   * "Attack that player." (Counter Attack) — start a battle from inside an
   * effect, bypassing normal turn/eligibility timing. The `attackerIds`
   * (already vetted as controlled, in-play, un-depleted characters) deplete
   * and form the attacking party against `defenderId`'s faction; the
   * resolving response window this was reached through is discarded and the
   * standard battle flow takes over. The caller (`runEffectFrame`) parks the
   * rest of the effect list as an `endOfBattle` rider.
   */
  private runInitiatedAttack(
    attackerIds: CardInstanceId[],
    defenderId: PlayerId
  ): void {
    if (this.state.battle) return;

    // An attack made by an effect pays the same attack tax; one that can't
    // be paid isn't made (an effect does what it can).
    const tax = this.attackTaxFor(this.state.cards[attackerIds[0]].controllerId, attackerIds);
    if (tax > 0) {
      const payer = this.state.cards[attackerIds[0]].controllerId;
      if (this.getAvailableResourceIds(payer).length < tax) return;
      this.payNumericCost(payer, tax);
    }

    const battleId = this.nextId("battle");

    this.beginEventBatch();
    try {
      for (const attackerId of attackerIds) {
        const attacker = this.requireCard(attackerId);
        if (!attacker.depleted) {
          attacker.depleted = true;
          this.state.attacksThisTurn[attackerId] =
            (this.state.attacksThisTurn[attackerId] ?? 0) + 1;
          this.emit({ type: "cardDepleted", cardId: attackerId });
        }
      }
    } finally {
      this.endEventBatch();
    }

    const battle: BattleState = {
      id: battleId,
      attackerPlayerId: this.state.cards[attackerIds[0]].controllerId,
      defenderPlayerId: defenderId,
      target: { type: "faction", playerId: defenderId },
      attackingParty: [...attackerIds],
      blockingParty: [],
      participants: attackerIds.map(cardId => ({ cardId, side: "attacking" as const })),
      rounds: [],
      phase: "afterAttackersResponse",
      assignedDamageBy: [],
      attackerAssignments: [],
      defenderAssignments: []
    };

    this.state.battle = battle;

    // The action/response window this effect resolved inside is superseded
    // by the battle flow — its continuation was "resume normal play", which
    // is exactly where the battle leaves off. An announced end of turn is
    // different: it still has to complete once the battle is over.
    const supersededWindow = this.state.responseWindow;
    if (supersededWindow?.continuation.type === "endTurn") {
      battle.resumeEndTurn = {
        playerId: supersededWindow.continuation.playerId,
        pendingResponders: [...supersededWindow.pendingResponders]
      };
    }
    this.state.responseWindow = undefined;

    this.beginEventBatch();
    try {
      for (const attackerId of attackerIds) {
        this.emit({ type: "characterAttacked", cardId: attackerId, battleId });
      }
    } finally {
      this.endEventBatch();
    }

    this.emit({ type: "battleStarted", battleId });

    this.openResponseWindow(
      "battleAfterAttackers",
      battle.attackerPlayerId,
      { type: "battleBlocking", battleId },
      this.battleResponders(battle)
    );
  }

  /**
   * Auction House — reveal from the top of `deckOwnerId`'s deck until a
   * character (or the deck runs out). No character => reshuffle and done.
   * Otherwise pull the revealed cards aside and open the bidding
   * (`auctionBid` pending choice, active player first).
   */
  private beginAuction(
    context: ResolutionContext,
    deckOwnerId: PlayerId
  ): void {
    if (this.state.pendingAuction) return;
    const deck = this.requirePlayer(deckOwnerId).deck;

    const revealed: CardInstanceId[] = [];
    let characterId: CardInstanceId | undefined;
    while (deck.length > 0) {
      const top = deck[0];
      revealed.push(top);
      deck.shift();
      const c = this.state.cards[top];
      if (c) c.zone = "deploying"; // held aside while the auction runs
      if (this.getDefinition(top).type === "character") {
        characterId = top;
        break;
      }
    }

    // The cards were turned over from the top of the deck, even though they
    // are held aside now. (With a character found the auction is opened
    // BEFORE the reveal is announced: the open bid parks every other trigger,
    // a second Auction House's included, until this auction is settled.)
    const announceReveal = () =>
      this.emitReveal(revealed, "all", context.sourceId, {
        zone: "deck",
        holderId: deckOwnerId
      });

    if (!characterId) {
      announceReveal();
      // "Shuffle all other revealed cards into their owner's deck."
      for (const id of revealed) {
        const c = this.state.cards[id];
        if (c) c.zone = "deck";
        deck.push(id);
      }
      this.shuffleDeckOf(deckOwnerId);
      return;
    }

    const otherRevealed = revealed.filter(id => id !== characterId);
    const order = livingSeats(this.state);

    this.state.pendingAuction = {
      sourceId: context.sourceId,
      controllerId: context.controllerId,
      deckOwnerId,
      characterId,
      otherRevealed,
      order,
      turn: order[0],
      highBid: 0,
      passed: []
    };

    this.state.pendingChoice = {
      kind: "auctionBid",
      id: this.nextId("choice"),
      playerId: order[0],
      characterId,
      highBid: 0,
      maxBid: this.getAvailableResourceCount(order[0])
    };
    announceReveal();
  }

  /** One bid / pass in the Auction House sequence (`auctionBid` pending choice). */
  private advanceAuction(playerId: PlayerId, bid: number): void {
    const a = this.state.pendingAuction;
    assert(a, "No auction is in progress.");
    assert(playerId === a.turn, "It is not your turn to bid.");
    assert(Number.isInteger(bid) && bid >= 0, "A bid must be a non-negative integer.");

    // The players still in the bidding after `playerId`, clockwise (CR 413.1).
    const stillIn = () => {
      const start = a.order.indexOf(playerId);
      return [...a.order.slice(start + 1), ...a.order.slice(0, start)].filter(p => !a.passed.includes(p));
    };
    const offerTo = (next: PlayerId) => {
      a.turn = next;
      this.state.pendingChoice = {
        kind: "auctionBid",
        id: this.nextId("choice"),
        playerId: next,
        characterId: a.characterId,
        highBid: a.highBid,
        maxBid: this.getAvailableResourceCount(next)
      };
    };

    if (bid > 0) {
      assert(bid > a.highBid, `A bid must exceed the current high bid (${a.highBid}).`);
      assert(
        bid <= this.getAvailableResourceCount(playerId),
        "You cannot bid more than the detached resources you control."
      );
      a.highBid = bid;
      a.highBidder = playerId;
      // A player who has passed may not bid again (CR 413.1b): the bidding
      // is over as soon as only one player is left.
      const next = stillIn()[0];
      if (next === undefined) {
        this.settleAuction();
        return;
      }
      offerTo(next);
      return;
    }

    // A pass. The auction ends unless another player still has a live raise
    // to make — they haven't passed yet and aren't the sole remaining player
    // holding the high bid (a pass against a standing high bid concedes it).
    a.passed.push(playerId);
    const remaining = stillIn();
    const someoneCanStillAct =
      remaining.length > 1 || (remaining.length === 1 && remaining[0] !== a.highBidder);

    if (someoneCanStillAct) {
      offerTo(remaining[0]);
      return;
    }

    this.settleAuction();
  }

  private settleAuction(): void {
    const a = this.state.pendingAuction;
    if (!a) return;
    this.state.pendingChoice = undefined;
    this.state.pendingAuction = undefined;

    const context: ResolutionContext = {
      sourceId: a.sourceId,
      controllerId: a.controllerId,
      selected: {}
    };

    if (a.highBidder && a.highBid > 0) {
      this.payNumericCost(a.highBidder, a.highBid);
      this.putCardIntoPlay(a.characterId, a.highBidder, false, context, false);
    } else {
      const c = this.state.cards[a.characterId];
      if (c) c.zone = "deck";
      this.requirePlayer(a.deckOwnerId).deck.push(a.characterId);
    }

    // Read the deck AFTER the character moved: moving a card between zones
    // replaces the zone arrays, so an earlier reference would be stale.
    const deck = this.requirePlayer(a.deckOwnerId).deck;
    for (const id of a.otherRevealed) {
      const c = this.state.cards[id];
      if (c) c.zone = "deck";
      deck.push(id);
    }
    this.shuffleDeckOf(a.deckOwnerId);

    this.checkStateBasedActions();
    this.resumeEffectFrames();
  }

  /** The per-blocker checks of `declareBlockers` (in its order), as the refusal message. The card must exist. */
  private blockerProblem(playerId: PlayerId, blockerId: CardInstanceId): string | undefined {
    const blocker = this.requireCard(blockerId);
    if (blocker.controllerId !== playerId) return "You do not control that blocker.";
    if (blocker.zone !== "play") return "Blocker must be in play.";
    if (blocker.faceDown) return "A face-down resource cannot block.";
    if (!this.hasCardType(blockerId, "character")) return "Only characters can block.";
    if (blocker.depleted) return "Depleted characters cannot block.";
    if (this.hasRestriction(blockerId, "cannotBlock")) return "Character cannot block.";
    return undefined;
  }

  /**
   * CR §412.1 — while every member of the attacking party "cannot be
   * blocked", the defending player may not form a blocking party.
   */
  private attackingPartyUnblockable(battle: BattleState): boolean {
    return (
      battle.attackingParty.length > 0 &&
      battle.attackingParty.every(cardId => this.hasKeyword(cardId, "cannotBeBlocked"))
    );
  }

  /**
   * Whether `cardId` (a card of the defender) is obliged to be in the blocking
   * party: a non-depleted controlled character with the `mustBlock` restriction,
   * or one a `requireBlock` grant obliges to block an attacker in THIS battle,
   * that could legally join some block (SYS-39).
   */
  private mustBlockObliged(cardId: CardInstanceId, battle: BattleState): boolean {
    const c = this.state.cards[cardId];
    if (!c || c.zone !== "play" || c.faceDown || c.depleted) return false;
    if (!this.hasCardType(cardId, "character")) return false;
    if (this.hasRestriction(cardId, "cannotBlock")) return false;
    const obliged =
      this.hasRestriction(cardId, "mustBlock") ||
      this.state.mustBlockGrants.some(
        g =>
          battle.attackingParty.includes(g.attackerId) &&
          (g.blockerId === undefined || g.blockerId === cardId)
      );
    if (!obliged) return false;
    return this.couldJoinBlock(cardId, battle);
  }

  /** A character the attacker's ability chose to block this battle ("each must block if it can"): whether it still has to be declared. */
  private chosenBlockerObliged(battle: BattleState, id: CardInstanceId): boolean {
    const attackerIsCovert = battle.attackingParty.every(partyId =>
      this.hasKeyword(partyId, "covert")
    );
    const c = this.state.cards[id];
    if (!c || c.zone !== "play" || c.faceDown || c.depleted) return false;
    if (!this.hasCardType(id, "character")) return false;
    if (this.hasRestriction(id, "cannotBlock")) return false;
    if (
      attackerIsCovert &&
      !this.hasKeyword(id, "covert") &&
      !this.hasKeyword(id, "canBlockCovert") &&
      !this.hasKeyword(id, "canBlockAnyParty")
    ) {
      return false;
    }
    return true;
  }

  /**
   * Who could block in the battle that is waiting for blockers, read-only
   * (`undefined` when no battle is). `blockers` is each character that could be
   * declared on its own (the per-blocker checks, COVERT legality and the block
   * restrictions); `mustBlock` the ones the declaration cannot leave out; an
   * attacking party that cannot be blocked leaves nobody. Whole-party rules
   * (a minimum blocking party, party composition) are still `perform`'s call.
   */
  getBlockOptions(): BlockOptions | undefined {
    const battle = this.state.battle;
    if (!battle || battle.phase !== "blocking") return undefined;
    const playerId = battle.defenderPlayerId;
    const none = (reason: string): BlockOptions => ({
      playerId,
      blockers: [],
      mustBlock: [],
      canBlock: false,
      reason
    });

    if (this.state.responseWindow) return none("Responses must finish before blockers are declared.");
    const gate = this.actionGateProblem("declareBlockers");
    if (gate) return none(gate);
    if (this.attackingPartyUnblockable(battle)) return none("The attacking party cannot be blocked.");

    const play = this.requirePlayer(playerId).play;
    const blockers = play.filter(
      cardId =>
        !!this.state.cards[cardId] &&
        this.blockerProblem(playerId, cardId) === undefined &&
        this.couldJoinBlock(cardId, battle)
    );
    const mustBlock = [
      ...play.filter(cardId => this.mustBlockObliged(cardId, battle)),
      ...(battle.chosenBlockers ?? []).filter(cardId => this.chosenBlockerObliged(battle, cardId))
    ].filter((cardId, index, all) => all.indexOf(cardId) === index);

    return {
      playerId,
      blockers,
      mustBlock,
      canBlock: blockers.length > 0,
      ...(blockers.length === 0 ? { reason: "No character can block." } : {})
    };
  }

  /**
   * `getBlockOptions` for an attack that has not been declared: who could block `attackerIds` if
   * `attackerPlayerId` attacked `target` with them right now. The attack is declared on a throw-away copy of the
   * game (`declareAttack` itself, so its checks, the attack tax and anything the declaration triggers all apply),
   * both sides pass on the response windows, and the copy's blocking step is read with `getBlockOptions`.
   * `undefined` when `declareAttack` would refuse the declaration (not their turn, a depleted attacker, a
   * must-attack character left out, ...), or when the copy does not reach the blocking step (the attack ends the
   * battle, or raises a prompt that has to be answered first). The live game, its random stream and its log are
   * untouched.
   */
  previewBlockOptions(
    attackerPlayerId: PlayerId,
    attackerIds: CardInstanceId[],
    target: AttackTarget
  ): BlockOptions | undefined {
    const probe = this.cloneForProbe();
    // The copy plays for real, with the triggers waiting on the live game (as `checkAction` does).
    probe.dryRun = false;
    probe.immediateQueue.push(...structuredClone(this.immediateQueue));
    try {
      probe.perform({ type: "declareAttack", playerId: attackerPlayerId, attackerIds: [...attackerIds], target });
      // Nobody responds: the attacker, then the defender, pass; the window closes into the blocking step.
      for (let step = 0; step < 12; step++) {
        const battle = probe.state.battle;
        if (!battle || battle.phase === "blocking" || probe.state.pendingChoice) break;
        const window = probe.state.responseWindow;
        if (window?.phase === "acceptingResponses") {
          probe.perform({ type: "passPriority", playerId: window.priorityPlayerId });
        } else {
          probe.perform({ type: "advanceFlow" });
        }
      }
      return probe.getBlockOptions();
    } catch {
      return undefined;
    }
  }

  private declareBlockers(
    playerId: PlayerId,
    blockerIds: CardInstanceId[]
  ): void {
    const battle = this.requireBattle();

    assert(!this.state.responseWindow, "Responses must finish before blockers are declared.");
    assert(
      battle.defenderPlayerId === playerId,
      "Only the defending player can block."
    );
    assert(
      battle.phase === "blocking",
      "Battle is not accepting blockers."
    );

    const unique = new Set(blockerIds);
    assert(
      unique.size === blockerIds.length,
      "A blocker was selected more than once."
    );

    for (const blockerId of blockerIds) {
      const blockerProblem = this.blockerProblem(playerId, blockerId);
      if (blockerProblem) throw new Error(blockerProblem);
    }

    this.assertCovertBlockingLegality(
      battle.attackingParty,
      blockerIds
    );

    // CR §412.1 — while every member of the attacking party "cannot be
    // blocked", the defending player may not form a blocking party.
    // (Effects that *add* a character into the blocking party still work,
    // but that's not a defender-declared block.)
    const attackingPartyUnblockable = this.attackingPartyUnblockable(battle);
    assert(
      !attackingPartyUnblockable || blockerIds.length === 0,
      "The attacking party cannot be blocked."
    );

    // "must block if it can": a non-depleted controlled character with the
    // `mustBlock` restriction, or one a `requireBlock` grant obliges to block
    // an attacker in THIS battle, that could legally join this block has to
    // be declared. A character that has no legal block (covert either way,
    // a block restriction, depleted ...) is not obliged (SYS-39).
    for (const cardId of this.requirePlayer(playerId).play) {
      if (attackingPartyUnblockable) break;
      if (unique.has(cardId)) continue;
      if (!this.mustBlockObliged(cardId, battle)) continue;
      throw new Error(
        `'${this.getDefinition(cardId).name}' must block if it can and was left out.`
      );
    }

    this.assertPartyComposition(blockerIds, "blocking");
    this.assertBlockRestrictions(battle, blockerIds);

    // CR 608.1c — a character already put into the blocking party before
    // blockers were declared (Surprise!, Shocking Reappearance, Carnival
    // Ringmaster) stays in it; the declared blockers join it.
    const alreadyBlocking = battle.blockingParty.filter(
      cardId => !unique.has(cardId) && this.isCardStillInBattle(cardId, battle)
    );
    battle.blockingParty = [...blockerIds, ...alreadyBlocking];
    this.recordBattleParticipants(battle, blockerIds, "blocking");

    // Declaring blockers is a player action and must show in the log. A
    // non-empty party is covered by the `blockingPartyFormed` /
    // `characterBlocked` events below; declaring *none* emits nothing, so
    // record that decision explicitly here.
    if (blockerIds.length === 0 && alreadyBlocking.length === 0) {
      this.recordLogMarker(
        "blockersDeclared",
        "battle",
        `${this.logPlayerName(playerId)} declares no blockers`,
        this.responseStack.length
      );
    }

    this.beginEventBatch();

    try {
      // "When you form a blocking party with at least 1 character ..." — one
      // event for the whole party, mapped to the defending player
      // (Microdefense Autosystem). Emitted before the per-blocker events.
      if (blockerIds.length > 0) {
        this.emit({
          type: "blockingPartyFormed",
          playerId: battle.defenderPlayerId,
          blockerCount: blockerIds.length
        });
      }
      for (const blockerId of blockerIds) {
        this.emit({
          type: "characterBlocked",
          cardId: blockerId,
          battleId: battle.id
        });
      }
      // "When this card is blocked ..." — once per still-in-battle attacker,
      // when a non-empty blocking party is declared (Timid Mau).
      if (blockerIds.length > 0) {
        for (const attackerId of battle.attackingParty) {
          this.emit({
            type: "attackerBlocked",
            cardId: attackerId,
            battleId: battle.id,
            blockerCount: blockerIds.length
          });
        }
      }
    } finally {
      this.endEventBatch();
    }

    // The block can leave a party member lethal (Cowering Golem loses life
    // for each blocker, down to 0): it is destroyed now (0 damage >= 0 life).
    this.checkStateBasedActions();

    this.prepareNextSpeedGroupOrFinish(battle);
  }

  private prepareNextSpeedGroupOrFinish(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    // CR §609.1g: keep repeating rounds only while some battle character
    // still has to assign. Once everyone has, the loop ends (§609.1h).
    const nextSpeed = this.getNextBattleSpeed(battle);

    if (nextSpeed === undefined) {
      this.finishBattle(battle);
      return;
    }

    // Provisional — the real speed level X is fixed at CR §609.1b, i.e.
    // *after* the §609.1a response window below. `enterDamageAssignment`
    // recomputes it so an instant-speed effect played in that window is
    // honoured. Set here only so `getBattleView()` has something to show.
    battle.speed = nextSpeed;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
    battle.phase = "beforeDamageResponse";

    // CR §609.1a: attacker gets first opportunity, then the defender.
    this.openResponseWindow(
      "battleBeforeDamage",
      battle.attackerPlayerId,
      {
        type: "battleAssignDamage",
        battleId: battle.id
      },
      this.battleResponders(battle)
    );
  }

  private enterDamageAssignment(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    // CR §609.1b: find X (the speed level) now — after the §609.1a response
    // window has closed — not when the round was set up. A tactic/ability
    // played in that window can add or remove speed and change which
    // characters share the top speed this round.
    const speed = this.getNextBattleSpeed(battle);
    if (speed === undefined) {
      // Every remaining battle character left play during the §609.1a
      // window; nothing is left to assign (CR §609.1g).
      this.finishBattle(battle);
      return;
    }
    battle.speed = speed;

    if (this.getBattleDamageSources(true, battle).length > 0) {
      battle.phase = "attackerDamageAssignment";
      this.state.priorityPlayerId = battle.attackerPlayerId;
      return;
    }

    if (this.getBattleDamageSources(false, battle).length > 0) {
      battle.phase = "defenderDamageAssignment";
      this.state.priorityPlayerId = battle.defenderPlayerId;
      return;
    }

    this.openPostAssignmentResponse(battle);
  }

  private assignBattleDamage(
    playerId: PlayerId,
    assignments: BattleDamageAssignment[]
  ): void {
    assert(
      !this.state.responseWindow,
      "Cannot assign battle damage while a response window is open."
    );

    const battle = this.requireBattle();

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    assert(
      attackerAssigning || defenderAssigning,
      "Battle is not accepting damage assignments."
    );

    const expectedPlayerId = attackerAssigning
      ? battle.attackerPlayerId
      : battle.defenderPlayerId;

    assert(
      playerId === expectedPlayerId,
      "It is not this player's damage assignment."
    );

    const sources = this.getBattleDamageSources(
      attackerAssigning,
      battle
    );

    for (const sourceId of sources) {
      const sourceAssignments = assignments.filter(
        assignment => assignment.sourceId === sourceId
      );

      const legalTargets = this.getLegalBattleDamageTargets(
        sourceId,
        attackerAssigning,
        battle
      );

      if (legalTargets.length === 0) {
        assert(
          sourceAssignments.length === 0,
          `Source '${sourceId}' has no legal damage target.`
        );
        continue;
      }

      // Strength is floored at 0 for assignment (CR §410.4): a character
      // with 0 or negative strength assigns nothing but still counts as
      // having assigned (CR §408.1b / §609.2).
      const strength = Math.max(0, this.getStat(sourceId, "strength"));
      const total = sourceAssignments.reduce(
        (sum, assignment) => sum + assignment.amount,
        0
      );

      assert(
        total === strength,
        `Source '${sourceId}' must assign exactly ${strength} damage; received ${total}.`
      );

      for (const assignment of sourceAssignments) {
        assert(
          Number.isInteger(assignment.amount) &&
          assignment.amount > 0,
          "Damage assignments must be positive integers."
        );

        assert(
          legalTargets.some(target =>
            this.sameBattleTarget(target, assignment.target)
          ),
          `Illegal battle-damage target for '${sourceId}'.`
        );
      }

      // Several damage magnets (two Courageous Paladins): each demands ALL the
      // damage, which can't all be met, so the source meets as many as it can
      // (CR 505.2b / FAQ): everything on ONE magnet, never split between them.
      {
        const party = (attackerAssigning ? battle.blockingParty : battle.attackingParty).filter(
          cardId => this.isCardStillInBattle(cardId, battle)
        );
        const magnets = party.filter(id => this.cardMustReceiveBattleDamage(id));
        if (magnets.length > 1) {
          const hit = new Set(
            sourceAssignments.flatMap(a =>
              a.target.type === "card" && magnets.includes(a.target.cardId)
                ? [a.target.cardId]
                : []
            )
          );
          assert(
            hit.size <= 1,
            `Source '${sourceId}' must assign all of its damage to one card that must receive it.`
          );
        }
      }

      // "you may assign its battle damage to the target of the attack INSTEAD
      // OF the blocking party" (Colossal Flattener, Q37): all of it goes to
      // the target or all of it to the blocking party, never a split.
      if (attackerAssigning && this.hasKeyword(sourceId, "redirectDamage")) {
        const attackTargets = this.getAttackTargetAsBattleDamageTarget(battle);
        const toTarget = sourceAssignments.some(a =>
          attackTargets.some(t => this.sameBattleTarget(t, a.target))
        );
        const toBlockers = sourceAssignments.some(
          a => !attackTargets.some(t => this.sameBattleTarget(t, a.target))
        );
        assert(
          !(toTarget && toBlockers),
          `'${this.getDefinition(sourceId).name}' assigns all of its damage to the target of the attack or all to the blocking party, not both.`
        );
      }
    }

    for (const assignment of assignments) {
      assert(
        sources.includes(assignment.sourceId),
        `Source '${assignment.sourceId}' is not part of the current speed group.`
      );
    }

    // Assigning battle damage is a player action (or an auto-assign the
    // consumer made on their behalf) — it decides the round's outcome
    // before the `battleAfterDamage` window, so it has to be in the log.
    for (const assignment of assignments) {
      this.recordLogMarker(
        "battleDamageAssigned",
        "battle",
        `${this.logCardName(assignment.sourceId)} assigns ${assignment.amount} battle damage to ${this.logBattleTargetName(
          assignment.target
        )}`,
        this.responseStack.length
      );
    }

    battle.assignedDamageBy.push(...sources);

    if (attackerAssigning) {
      battle.attackerAssignments = structuredClone(assignments);

      if (this.getBattleDamageSources(false, battle).length > 0) {
        battle.phase = "defenderDamageAssignment";
        this.state.priorityPlayerId = battle.defenderPlayerId;
      } else {
        this.openPostAssignmentResponse(battle);
      }
    } else {
      battle.defenderAssignments = structuredClone(assignments);
      this.openPostAssignmentResponse(battle);
    }
  }

  private openPostAssignmentResponse(
    battle: BattleState
  ): void {
    battle.phase = "afterDamageResponse";

    // Damage is now locked. Tactics/abilities can still change the game, but
    // the assignments themselves are immutable and survive source removal.
    this.openResponseWindow(
      "battleAfterDamage",
      battle.attackerPlayerId,
      {
        type: "battleInflictDamage",
        battleId: battle.id
      },
      this.battleResponders(battle)
    );
  }

  private getBattleDamageSources(
    attackerSide: boolean,
    battle: BattleState
  ): CardInstanceId[] {
    if (battle.speed === undefined) {
      return [];
    }

    const party = attackerSide
      ? battle.attackingParty
      : battle.blockingParty;

    return party.filter(
      cardId =>
        this.canAssignBattleDamage(cardId, battle) &&
        this.getStat(cardId, "speed") === battle.speed
    );
  }

  private canAssignBattleDamage(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    return (
      !!card &&
      card.zone === "play" &&
      !battle.assignedDamageBy.includes(cardId)
    );
  }

  /**
   * "All battle damage that could be assigned to this card must be assigned
   * to it." (Courageous Paladin) — true while `cardId` has a live
   * `ContinuousAbility.mustReceiveBattleDamage` and is in a battle.
   */
  private cardMustReceiveBattleDamage(cardId: CardInstanceId): boolean {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play") return false;
    for (const ability of this.getEffectiveContinuousAbilities(cardId)) {
      if (!ability.mustReceiveBattleDamage) continue;
      if (this.abilitySuppressed(cardId, ability.id)) continue;
      const context: ResolutionContext = {
        sourceId: cardId,
        controllerId: card.controllerId,
        abilityId: ability.id,
        selected: {}
      };
      if (ability.condition && !this.evaluateCondition(ability.condition, context)) {
        continue;
      }
      return true;
    }
    return false;
  }

  private getLegalBattleDamageTargets(
    sourceId: CardInstanceId,
    attackerSide: boolean,
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
    if (!attackerSide) {
      const attackers = battle.attackingParty.filter(cardId =>
        this.isCardStillInBattle(cardId, battle)
      );
      // "All battle damage that could be assigned to this card must be
      // assigned to it." (Courageous Paladin) — a damage magnet in the party
      // narrows the legal set to just the magnets.
      const magnets = attackers.filter(id => this.cardMustReceiveBattleDamage(id));
      return (magnets.length > 0 ? magnets : attackers).map(cardId => ({
        type: "card" as const,
        cardId
      }));
    }

    const blockers = battle.blockingParty.filter(cardId =>
      this.isCardStillInBattle(cardId, battle)
    );

    if (blockers.length > 0) {
      const magnets = blockers.filter(id => this.cardMustReceiveBattleDamage(id));
      const blockerTargets = (magnets.length > 0 ? magnets : blockers).map(
        cardId => ({
          type: "card" as const,
          cardId
        })
      );

      // "May assign its battle damage to the target of the attack instead
      // of the blocking party" — an extra option alongside the blockers,
      // not a forced redirect. Suppressed while a magnet is in the party
      // (the damage "could be assigned" to it, so it "must be").
      if (magnets.length === 0 && this.hasKeyword(sourceId, "redirectDamage")) {
        return [...blockerTargets, ...this.getAttackTargetAsBattleDamageTarget(battle)];
      }

      // "...assign it to the target of the attack instead" (Penetrate): a
      // forced redirect — the blocking party is no longer a legal target
      // (unless the attack's target is gone, leaving nothing to redirect to).
      if (magnets.length === 0 && this.hasKeyword(sourceId, "forceRedirectDamage")) {
        const redirected = this.getAttackTargetAsBattleDamageTarget(battle);
        if (redirected.length > 0) return redirected;
      }

      return blockerTargets;
    }

    return this.getAttackTargetAsBattleDamageTarget(battle);
  }

  /** The attack's original target (faction or location), if it's still a legal damage target — [] if a targeted location has already left play. */
  private getAttackTargetAsBattleDamageTarget(
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
    if (battle.target.type === "faction") {
      return [
        {
          type: "faction",
          playerId: battle.target.playerId
        }
      ];
    }

    const target = this.state.cards[battle.target.cardId];

    if (!target || target.zone !== "play") {
      return [];
    }

    // CR 407.5: a location whose controller changed during the battle stops
    // being the target of the attack.
    if (target.controllerId !== battle.defenderPlayerId) {
      return [];
    }

    return [
      {
        type: "card",
        cardId: battle.target.cardId
      }
    ];
  }

  /**
   * CR 302.15 / 407.4a: battle damage assigned to a character that is no
   * longer part of its battle party — or to a location that stopped being the
   * attack's target (CR 407.5) — is not inflicted.
   */
  private battleDamageTargetStillInBattle(
    target: { type: "card"; cardId: CardInstanceId } | { type: "faction"; playerId: PlayerId },
    battle: BattleState
  ): boolean {
    if (target.type === "faction") return true;
    if (battle.target.type !== "faction" && battle.target.cardId === target.cardId) {
      return this.getAttackTargetAsBattleDamageTarget(battle).length > 0;
    }
    return this.isCardStillInBattle(target.cardId, battle);
  }

  private getNextBattleSpeed(
    battle: BattleState
  ): number | undefined {
    const candidates = [
      ...battle.attackingParty,
      ...battle.blockingParty
    ].filter(cardId => this.canAssignBattleDamage(cardId, battle));

    if (!candidates.length) {
      return undefined;
    }

    return Math.max(
      ...candidates.map(cardId => this.getStat(cardId, "speed"))
    );
  }

  /**
   * Rewrite locked battle-damage assignments per any active
   * `transformBattleDamage` entries (Don't Trip / Ocular Dispersal / Vexing
   * Nullifier) — before they're grouped and inflicted. Bounced cards are
   * moved to hand here; their assignments are zeroed so nothing else lands.
   */
  private applyBattleDamageTransforms(
    assignments: BattleDamageAssignment[],
    /** Rewrite the assignments only; the bounces are left undone (a read-ahead). */
    dryRun = false
  ): void {
    if (this.state.battleDamageTransforms.length === 0) return;

    // Entries sit in the list (like keyword grants) until the start-of-turn
    // sweep; only `whileSourceInPlay` needs a live source check here.
    const active = this.state.battleDamageTransforms.filter(
      t =>
        this.state.cards[t.cardId]?.zone === "play" &&
        (t.duration.type !== "whileSourceInPlay" ||
          (!!t.sourceId && this.sourceActiveInPlay(t.sourceId)))
    );
    if (active.length === 0) return;

    const toBounce = new Set<CardInstanceId>();

    for (const a of assignments) {
      for (const t of active) {
        if (t.role === "dealer" && t.cardId === a.sourceId) {
          if (t.kind === "setAmount" && t.amount !== undefined) {
            a.amount = t.amount;
          } else if (t.kind === "redirectToSelf") {
            a.target = { type: "card", cardId: a.sourceId };
          } else if (
            t.kind === "bounceOther" &&
            a.target.type === "card" &&
            // "…damage to a CHARACTER": a location it damages is unaffected.
            this.hasCardType(a.target.cardId, "character")
          ) {
            toBounce.add(a.target.cardId);
            a.amount = 0;
          }
        }
        if (
          t.role === "receiver" &&
          a.target.type === "card" &&
          t.cardId === a.target.cardId &&
          t.kind === "bounceSelf" &&
          this.hasCardType(a.sourceId, "character")
        ) {
          toBounce.add(a.target.cardId);
          a.amount = 0;
        }
      }
    }

    if (dryRun) return;
    for (const cardId of toBounce) {
      if (this.state.cards[cardId]?.zone === "play") {
        this.moveCard(cardId, "hand");
      }
    }
  }

  /**
   * CR §609.1f: one damage step's assignments grouped by what they hit — the
   * damage from several characters to the same thing is a single amount.
   */
  private battleDamageGroups(assignments: BattleDamageAssignment[]): BattleDamageGroups {
    // CR §609.1f: damage from several characters to the same thing this
    // round is inflicted as a *single amount*. CR §408.2: damage increase
    // and reduction effects apply to that amount. So group by target, sum
    // the raw assignments, then apply any `damageModifiers` delta once to
    // the sum (floored at 0) — not per assignment.
    const groups: BattleDamageGroups = new Map();

    for (const assignment of assignments) {
      const key =
        assignment.target.type === "faction"
          ? `faction:${assignment.target.playerId}`
          : `card:${assignment.target.cardId}`;

      const cardId =
        assignment.target.type === "faction"
          ? this.requirePlayer(assignment.target.playerId).factionId
          : assignment.target.cardId;

      const group = groups.get(key) ?? {
        target: assignment.target,
        cardId,
        contributors: []
      };
      group.contributors.push(assignment);
      groups.set(key, group);
    }

    return groups;
  }

  /**
   * A damage group's amount after every damage modifier (CR §408.2), before
   * replacements and prevention. Rewrites the contributors' shares for a
   * per-source modifier, as the inflicting pass expects.
   */
  private battleGroupAmount(group: BattleDamageGroup): number {
    const rawSum = group.contributors.reduce(
      (sum, a) => sum + a.amount,
      0
    );

    // When a single character deals the whole hit, thread its id into
    // `damageDeltaFor` so both a `damageModifiers.sourceSelector` gate
    // ("all damage to this card BY a COVERT character is reduced" —
    // Top-Secret Subterranean Goofarium; Enlightened Mau) and a
    // `modifyOutgoingDamage` ("reduce damage inflicted BY this card" —
    // Sockem Bot) can see the dealer. With multiple contributors there is
    // no single source, so a source-gated modifier is skipped.
    const sources = [...new Set(group.contributors.map(c => c.sourceId))];
    const soleSource = sources.length === 1 ? sources[0] : undefined;

    // CR §408.2 modification applies to combat damage against a faction
    // too, before it converts to influence loss (CR §408.3).
    let final: number;
    if (sources.length <= 1) {
      final = Math.max(
        0,
        rawSum + this.damageDeltaFor(group.cardId!, true, soleSource, rawSum)
      );
    } else {
      // Several dealers in one speed step (SYS-41): a modifier gated on
      // one SOURCE adjusts that source's own share ("this card's damage
      // is increased by 2"); the rest adjust the summed amount once.
      let summed = 0;
      for (const sourceId of sources) {
        const mine = group.contributors.filter(c => c.sourceId === sourceId);
        const own = mine.reduce((sum, a) => sum + a.amount, 0);
        if (own <= 0) continue;
        const delta = this.damageDeltaFor(group.cardId!, true, sourceId, own, "sourced");
        const adjusted = Math.max(0, own + delta);
        // The adjustment lands on that source's first assignment.
        mine[0].amount += adjusted - own;
        summed += adjusted;
      }
      final = Math.max(
        0,
        summed + this.damageDeltaFor(group.cardId!, true, undefined, summed, "unsourced")
      );
    }

    return final;
  }

  /**
   * One locked damage step, inflicted. Damage to an opponent's faction that a
   * `millInsteadOfFactionDamage` ability may swap for milled cards (Trickster's
   * Globe) pauses the step on a `millInsteadOfDamage` choice first, one faction
   * at a time; the answer comes back here.
   */
  private inflictBattleDamageStep(battle: BattleState): void {
    if (this.raiseBattleFactionMill(battle)) return;
    this.inflictLockedBattleDamage(battle);
    this.prepareNextSpeedGroupOrFinish(battle);
  }

  /** Raises the next unanswered `millInsteadOfDamage` choice for this damage step; true when it did. */
  private raiseBattleFactionMill(battle: BattleState): boolean {
    const assignments = structuredClone([
      ...battle.attackerAssignments,
      ...battle.defenderAssignments
    ]);
    this.applyBattleDamageTransforms(assignments, true);
    for (const group of this.battleDamageGroups(assignments).values()) {
      if (group.target.type !== "faction" || !group.cardId) continue;
      const factionPlayerId = group.target.playerId;
      if (battle.factionMill?.[factionPlayerId] !== undefined) continue;
      const dealers = [...new Set(group.contributors.map(c => c.sourceId))];
      const inflictorId = battle.attackerAssignments.some(a => dealers.includes(a.sourceId))
        ? battle.attackerPlayerId
        : battle.defenderPlayerId;
      const amount = this.battleGroupAmount(group);
      const offer = this.factionMillOffer(group.cardId, amount, inflictorId);
      if (!offer) continue;
      this.state.pendingChoice = {
        kind: "millInsteadOfDamage",
        id: this.nextId("choice"),
        ...offer,
        ...(dealers.length === 1 ? { damageSourceId: dealers[0] } : {}),
        amount,
        battle: true
      };
      return true;
    }
    return false;
  }

  private inflictLockedBattleDamage(
    battle: BattleState
  ): void {
    const assignments = [
      ...battle.attackerAssignments,
      ...battle.defenderAssignments
    ];

    // The transforms below and the per-source redistribution rewrite these
    // entries in place — keep the as-assigned version for the round record.
    const round: BattleRound = {
      speed: battle.speed ?? 0,
      assignedBy: battle.assignedDamageBy.filter(
        id => !battle.rounds.some(r => r.assignedBy.includes(id))
      ),
      assigned: structuredClone(assignments),
      inflicted: []
    };

    this.applyBattleDamageTransforms(assignments);

    const groups = this.battleDamageGroups(assignments);

    this.beginEventBatch();
    let batchEnded = false;

    try {
      // Apply every final amount before any triggered ability resolves.
      for (const group of groups.values()) {
        // Damage assigned to a character removed from the battle (or to a
        // location that stopped being the target) is not inflicted — judged
        // on the assigned target, before any redirection.
        if (!this.battleDamageTargetStillInBattle(group.target, battle)) {
          group.contributors = [];
          continue;
        }

        // "If the picked character would be dealt damage, deal damage to
        // this card instead." (6r4wny 60dy9u4rd5) — battle damage too.
        if (group.cardId && group.target.type === "card") {
          const redirectedTo = this.redirectTargetFor(group.cardId);
          if (redirectedTo) {
            group.cardId = redirectedTo;
            group.target = { type: "card", cardId: redirectedTo };
          }
        }

        // Locking protects the source assignments, not a target that has
        // already left play — or lost the character type, e.g. flipped
        // face-down (CR §302.15: "battle damage already assigned to it is
        // not inflicted") — before damage is inflicted.
        const targetCard = group.cardId
          ? this.state.cards[group.cardId]
          : undefined;
        if (!targetCard || targetCard.zone !== "play" || targetCard.faceDown) {
          group.contributors = [];
          continue;
        }

        const sources = [...new Set(group.contributors.map(c => c.sourceId))];
        const soleSource = sources.length === 1 ? sources[0] : undefined;
        let final = this.battleGroupAmount(group);

        // "If battle damage would be inflicted to this card, <effects>
        // instead" (Expert Debater): the damage never lands.
        if (final > 0 && this.damageReplaced(group.cardId!, final, true, soleSource)) {
          final = 0;
        }

        // Trickster's Globe: the answered share of a faction's damage is put
        // from the top of its owner's deck into their discard pile instead.
        if (group.target.type === "faction") {
          const milled = Math.min(battle.factionMill?.[group.target.playerId] ?? 0, final);
          if (milled > 0) {
            this.millTop(targetCard.ownerId, milled);
            final -= milled;
          }
        }

        // `preventDamage` shields (Tiny Shiny / Delectable Boon / Purifying
        // Priest) — the faction card carries one too: battle damage to a
        // faction is damage like any other (CR 408.3).
        let battleRedirects: Array<{ cardId: CardInstanceId; amount: number }> = [];
        {
          const absorbed = this.absorbDamage(group.cardId!, final);
          final = absorbed.toTarget;
          battleRedirects = absorbed.redirects;
        }

        // Redistribute the adjusted final amount back across the
        // contributing sources so each still emits its own `damageDealt`
        // (CR §408.7 — every assigning character is a source), while the
        // total inflicted stays the single summed amount. Any leftover from
        // an increase, or shortfall from a reduction, lands on the last
        // contributor.
        let remaining = final;
        group.contributors.forEach((contributor, i) => {
          const isLast = i === group.contributors.length - 1;
          const share = isLast
            ? Math.max(0, remaining)
            : Math.min(contributor.amount, remaining);
          contributor.amount = share;
          remaining -= share;
        });

        for (const contributor of group.contributors) {
          if (contributor.amount > 0) {
            round.inflicted.push({
              sourceId: contributor.sourceId,
              target: structuredClone(group.target),
              amount: contributor.amount
            });
          }
        }

        if (group.target.type === "faction") {
          // A faction takes no damage markers; it loses influence equal to
          // the final adjusted amount (CR §408.3 / §202.4).
          this.applyInfluenceDelta(group.target.playerId, -final);
        } else {
          this.noteDamage(targetCard, group.contributors);
          targetCard.damage += final;

          if (final > 0) {
            const cause = group.contributors.find(c => c.amount > 0)
              ?? group.contributors[0];
            const source = cause && this.state.cards[cause.sourceId];
            if (source) {
              this.lethalDamageCause.set(
                group.cardId!,
                source.controllerId
              );
            }
          }
        }

        for (const r of battleRedirects) {
          const rc = this.state.cards[r.cardId];
          if (!rc || rc.zone !== "play") continue;
          this.applyRedirectedDamage(rc, r.amount, group.contributors[0]?.sourceId);
          const cause = group.contributors[0];
          if (cause && r.amount > 0) {
            round.inflicted.push({
              sourceId: cause.sourceId,
              target: { type: "card", cardId: r.cardId },
              amount: r.amount
            });
          }
          this.emit({
            type: "damageDealt",
            sourceId: cause?.sourceId,
            targetId: r.cardId,
            amount: r.amount,
            battle: true
          });
        }
      }

      // A faction hit fires "when this card deals/takes damage" triggers
      // (sourceIsDamageSource / sourceIsEventCard) against the faction card,
      // exactly like character/location damage.
      for (const group of groups.values()) {
        if (!group.cardId) continue;
        const targetCard = this.state.cards[group.cardId];
        if (!targetCard || targetCard.zone !== "play") continue;

        for (const contributor of group.contributors) {
          if (contributor.amount <= 0) continue;
          this.emit({
            type: "damageDealt",
            sourceId: contributor.sourceId,
            targetId: group.cardId,
            amount: contributor.amount,
            battle: true
          });
        }
      }

      // Lethal characters leave play only after the entire speed group's
      // damage has been applied. Remember the parties as they stood so
      // triggers of the characters destroyed now can read the opposing
      // party's last-known stats (Q27).
      battle.lastKnown = {};
      for (const [cardIds, side] of [
        [battle.attackingParty, "attacking"],
        [battle.blockingParty, "blocking"]
      ] as const) {
        for (const id of cardIds) {
          if (!this.state.cards[id]) continue;
          battle.lastKnown[id] = {
            side,
            strength: Math.max(0, this.getStat(id, "strength")),
            speed: this.getStat(id, "speed"),
            life: this.getStat(id, "life")
          };
        }
      }
      // The damage events' triggers get to resolve BEFORE the lethal check
      // (CR 408.2: a "reduce the amount" ward like Cathedrale de Mau's acts
      // before the damage is final). A prompt they raise freezes the check
      // until it is answered.
      this.endEventBatch();
      batchEnded = true;
      // Everything that is lethal now dies together: the destroy events are
      // batched so no leave-play trigger's prompt freezes the check halfway.
      if (!this.state.pendingChoice) {
        this.beginEventBatch();
        try {
          this.checkStateBasedActions();
        } finally {
          this.endEventBatch();
        }
      }
    } finally {
      if (!batchEnded) this.endEventBatch();
      battle.lastKnown = undefined;
    }

    battle.rounds.push(round);
    this.pruneBattleParties(battle);
    battle.factionMill = undefined;
    battle.speed = undefined;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
  }

  private recordBattleParticipants(
    battle: BattleState,
    cardIds: CardInstanceId[],
    side: BattleSide
  ): void {
    for (const cardId of cardIds) {
      if (!battle.participants.some(p => p.cardId === cardId && p.side === side)) {
        battle.participants.push({ cardId, side });
      }
    }
  }

  private pruneBattleParties(
    battle: BattleState
  ): void {
    battle.attackingParty = battle.attackingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );

    battle.blockingParty = battle.blockingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );
  }

  private isCardStillInBattle(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    if (!card || card.zone !== "play") {
      return false;
    }

    // CR §208.4 / §302.15 — a party member that has lost the character type
    // (a `setCardType` grant lapsing, or the card flipped face-down by
    // something like Backdoor Brigand's EXIT STAGE RIGHT) is no longer in
    // the battle. `checkStateBasedActions` drops it from the party the
    // instant this happens; keeping the check here too means every derived
    // read — `pruneBattleParties`, legal-damage-target lists — stays
    // correct even if it is consulted before that sweep runs.
    if (!this.hasCardType(cardId, "character")) {
      return false;
    }

    if (battle.attackingParty.includes(cardId)) {
      return card.controllerId === battle.attackerPlayerId;
    }

    if (battle.blockingParty.includes(cardId)) {
      return card.controllerId === battle.defenderPlayerId;
    }

    return false;
  }

  private sameBattleTarget(
    a:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId },
    b:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId }
  ): boolean {
    if (a.type !== b.type) {
      return false;
    }

    if (a.type === "card" && b.type === "card") {
      return a.cardId === b.cardId;
    }

    return (
      a.type === "faction" &&
      b.type === "faction" &&
      a.playerId === b.playerId
    );
  }

  /** Whether `cardId` could legally be part of SOME block of this battle (covert rule, block restrictions). */
  private couldJoinBlock(cardId: CardInstanceId, battle: BattleState): boolean {
    try {
      this.assertCovertBlockingLegality(battle.attackingParty, [cardId]);
      this.assertBlockRestrictions(battle, [cardId], "trial");
      return true;
    } catch {
      return false;
    }
  }

  private assertCovertBlockingLegality(
    attackerIds: CardInstanceId[],
    blockerIds: CardInstanceId[]
  ): void {
    if (blockerIds.length === 0) {
      return;
    }

    // A blocker with `canBlockAnyParty` (Guardbeast) never triggers the
    // "a COVERT character can only block a COVERT party" restriction.
    const blockersContainCovert = blockerIds.some(
      cardId =>
        this.hasKeyword(cardId, "covert") &&
        !this.hasKeyword(cardId, "canBlockAnyParty")
    );

    const attackingPartyIsCovert = attackerIds.every(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    // "Can block COVERT parties" (canBlockCovert / canBlockAnyParty) counts
    // as Covert for the purpose of forming a legal blocking party against a
    // Covert attack.
    const blockingPartyCanBlockCovert = blockerIds.every(
      cardId =>
        this.hasKeyword(cardId, "covert") ||
        this.hasKeyword(cardId, "canBlockCovert") ||
        this.hasKeyword(cardId, "canBlockAnyParty")
    );

    if (attackingPartyIsCovert) {
      assert(
        blockingPartyCanBlockCovert,
        "A COVERT attacking party can only be blocked by a COVERT party."
      );
    }

    if (blockersContainCovert) {
      assert(
        attackingPartyIsCovert,
        "A COVERT character can only block a COVERT party."
      );
    }
  }

  /**
   * "When an attacking / blocking party is formed including this card, it
   * must have <constraint>." (Insect Appreciator, Anxious Oaf) — reject a
   * forming party that includes a member whose `ContinuousAbility.partyRestriction`
   * (condition holding) it violates.
   */
  private assertPartyComposition(
    partyIds: CardInstanceId[],
    role: "attacking" | "blocking"
  ): void {
    const { problems } = this.partyCompositionReport(partyIds, role);
    if (problems.length > 0) throw new Error(problems[0]);
  }

  /**
   * The party requirements that apply to `partyIds` forming as `role`: how many
   * there are (`total`) and, for each one the party breaks, the refusal message
   * (`problems`). Each requirement counts once however many of its constraints
   * (size bounds, parity) the party breaks.
   */
  private partyCompositionReport(
    partyIds: CardInstanceId[],
    role: "attacking" | "blocking"
  ): { total: number; problems: string[] } {
    const report = { total: 0, problems: [] as string[] };
    if (partyIds.length === 0) return report;
    const size = partyIds.length;
    const memberSet = new Set(partyIds);

    const check = (
      pr: NonNullable<
        Extract<AbilityDefinition, { type: "continuous" }>["partyRestriction"]
      >,
      ctx: ResolutionContext,
      name: string
    ): void => {
      if (pr.role !== "any" && pr.role !== role) return;
      report.total += 1;
      let problem: string | undefined;
      if (pr.minMembers !== undefined) {
        const min = this.evaluateNumber(pr.minMembers, ctx);
        if (size < min) problem ??= `A ${role} party with '${name}' must have at least ${min} member(s).`;
      }
      if (pr.maxMembers !== undefined) {
        const max = this.evaluateNumber(pr.maxMembers, ctx);
        if (size > max) problem ??= `A ${role} party with '${name}' must have at most ${max} member(s).`;
      }
      if (pr.parity === "even" && size % 2 !== 0) {
        problem ??= `A ${role} party with '${name}' must have an even number of members.`;
      }
      if (pr.parity === "odd" && size % 2 !== 1) {
        problem ??= `A ${role} party with '${name}' must have an odd number of members.`;
      }
      if (problem) report.problems.push(problem);
    };

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      // Own continuous text plus any granted to it (Skin Suit: "all rules text").
      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (!ability.partyRestriction) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const pr = ability.partyRestriction;
        const scope = pr.scope ?? "selfParty";
        // "selfParty" restrictions only bite a party the source is in;
        // "attachedParty" only bites a party the source's host is in.
        if (scope === "selfParty" && !memberSet.has(source.id)) continue;
        if (scope === "attachedParty") {
          const host = source.attachedTo;
          if (!host || !memberSet.has(host)) continue;
        }

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx))
          continue;

        check(pr, ctx, this.getDefinition(source.id).name);
      }
    }

    // "This turn, a party including <target> must ..." — `restrictParty`
    // effect grants (Carnival King).
    for (const grant of this.state.partyRestrictionGrants) {
      if (!memberSet.has(grant.targetId)) continue;
      const ctx: ResolutionContext = {
        sourceId: grant.sourceId,
        controllerId: this.state.cards[grant.sourceId]?.controllerId ?? "",
        selected: {}
      };
      check(
        {
          role: grant.role,
          minMembers: grant.minMembers,
          maxMembers: grant.maxMembers,
          parity: grant.parity
        },
        ctx,
        this.getDefinition(grant.targetId).name
      );
    }
    return report;
  }

  /**
   * Enforce `ContinuousAbility.blockRestriction` / the `restrictBlockers`
   * ("this turn") effect / a `restrictBlockersToChosen` pick (`battle.chosenBlockers`)
   * against a declared blocking party. LeoKaiser, Wild Boars, Wyrmfang
   * Deathskull.
   */
  private assertBlockRestrictions(
    battle: BattleState,
    blockerIds: CardInstanceId[],
    /** `"trial"`: "could this one character join SOME legal block?" — skips the whole-party rules (minimum party size, chosen blockers who must all be declared). */
    mode: "declare" | "trial" = "declare"
  ): void {
    // "Only those characters can block, and each must block if it can."
    if (battle.chosenBlockers) {
      const allowed = new Set(battle.chosenBlockers);
      for (const id of blockerIds) {
        assert(
          allowed.has(id),
          "Only the characters chosen by the attacker's ability may block this battle."
        );
      }
      const declared = new Set(blockerIds);
      for (const id of battle.chosenBlockers) {
        if (mode === "trial") break;
        if (declared.has(id)) continue;
        if (!this.chosenBlockerObliged(battle, id)) continue;
        throw new Error(
          `'${this.getDefinition(id).name}' was chosen to block this battle and must.`
        );
      }
    }

    if (blockerIds.length === 0) return;

    const checks: Array<{
      minPartySize?: NumberExpression;
      minSpeed?: NumberExpression;
      blockerMustNotMatch?: CardSelector;
      ctx: ResolutionContext;
    }> = [];

    for (const attackerId of battle.attackingParty) {
      const card = this.state.cards[attackerId];
      if (!card) continue;
      for (const ability of this.getDefinition(attackerId).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.blockRestriction) continue;
        if (this.abilitySuppressed(attackerId, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: attackerId,
          controllerId: card.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        checks.push({
          minPartySize: ability.blockRestriction.minBlockingPartySize,
          minSpeed: ability.blockRestriction.minBlockerSpeed,
          blockerMustNotMatch: ability.blockRestriction.blockerMustNotMatch,
          ctx
        });
      }
    }

    for (const grant of this.state.blockRestrictionGrants) {
      if (!battle.attackingParty.includes(grant.targetId)) continue;
      const ctx: ResolutionContext = {
        sourceId: grant.sourceId,
        controllerId:
          this.state.cards[grant.sourceId]?.controllerId ?? battle.attackerPlayerId,
        selected: {}
      };
      if (grant.condition && !this.evaluateCondition(grant.condition, ctx)) continue;
      checks.push({
        minPartySize: grant.minPartySize,
        minSpeed: grant.minSpeed,
        ctx
      });
    }

    for (const check of checks) {
      if (check.minPartySize !== undefined && mode !== "trial") {
        const min = this.evaluateNumber(check.minPartySize, check.ctx);
        assert(
          blockerIds.length >= min,
          `Only a blocking party of at least ${min} may block this battle.`
        );
      }
      if (check.minSpeed !== undefined) {
        const min = this.evaluateNumber(check.minSpeed, check.ctx);
        for (const id of blockerIds) {
          assert(
            this.getStat(id, "speed") >= min,
            `Only characters with speed ${min} or more may block this battle.`
          );
        }
      }
      if (check.blockerMustNotMatch) {
        for (const id of blockerIds) {
          const c = this.state.cards[id];
          assert(
            !c ||
              !this.matchesSelector(c, check.blockerMustNotMatch, {
                ...check.ctx,
                selected: { ...check.ctx.selected, __candidate: [id] }
              }),
            `'${this.getDefinition(id).name}' cannot block this battle.`
          );
        }
      }
    }
  }

  private isBattleResponseWindow(
    window: ResponseWindowState
  ): boolean {
    return (
      window.kind === "battleAfterAttackers" ||
      window.kind === "battleBeforeDamage" ||
      window.kind === "battleAfterDamage"
    );
  }

  private requireBattle(): BattleState {
    const battle = this.state.battle;
    assert(battle, "No battle in progress.");
    return battle;
  }

  private requireBattleId(
    battleId: BattleId
  ): BattleState {
    const battle = this.requireBattle();
    assert(
      battle.id === battleId,
      `Expected battle '${battleId}', found '${battle.id}'.`
    );
    return battle;
  }

  /**
   * The finished battle remains in GameState until advanceFlow() is called,
   * allowing a renderer to show/animate the final state.
   */
  private finishBattle(
    battle: BattleState
  ): void {
    this.beginEventBatch();

    try {
      for (const cardId of [
        ...battle.attackingParty,
        ...battle.blockingParty
      ]) {
        const card = this.state.cards[cardId];

        if (!card || card.zone !== "play") {
          continue;
        }

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId
          });
        }
      }
    } finally {
      this.endEventBatch();
    }

    battle.phase = "finished";
    battle.speed = undefined;

    this.emit({
      type: "battleEnded",
      battleId: battle.id
    });

    // "Restore it at the end of the battle" and other `scheduleEffect`
    // (`when: "endOfBattle"`) riders registered during this battle.
    this.fireScheduledEffects("endOfBattle");

    // `installReplacement` grants scoped to this battle expire now
    // (Sarcophyle Matriculation — "would be destroyed during this battle").
    this.state.runtimeReplacements = this.state.runtimeReplacements.filter(
      g => g.duration.type !== "endOfBattle"
    );

    // Every other effect "until the end of the battle" ends here too
    // (modifiers, keyword grants, battle-damage transforms, ...). Control
    // and card-type grants need their revert logic, so the next turn-start
    // sweep (which treats a finished battle as over) handles those.
    const stateRecord = this.state as unknown as Record<string, unknown>;
    for (const key of Object.keys(stateRecord)) {
      if (key === "controlGrants" || key === "cardTypeGrants") continue;
      const value = stateRecord[key];
      if (!Array.isArray(value)) continue;
      if (
        !value.some(
          item => (item as { duration?: { type?: string } } | null)?.duration?.type === "endOfBattle"
        )
      ) {
        continue;
      }
      stateRecord[key] = value.filter(
        item => (item as { duration?: { type?: string } } | null)?.duration?.type !== "endOfBattle"
      );
    }

    this.state.priorityPlayerId = this.state.activePlayerId;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * OMNIPOTENCE (The Evil Alliance): `playerId` automatically meets every
   * threshold, whatever resource icons they control.
   */
  private hasOmnipotence(playerId: PlayerId): boolean {
    return !!this.getFactionDefinition(playerId)?.meetsAllThresholds;
  }

  /**
   * Whether `playerId` currently meets `threshold` as a standing condition
   * (CR §405.4 — a threshold paragraph is active only while its controller
   * meets it): OMNIPOTENCE, or at least the required count of every icon.
   * The `meetsThreshold` condition reads this. Deploy-only adjustments
   * (`reduceThreshold`, FEALTY slack) belong to the deploy check below, not
   * to this.
   */
  private meetsParagraphThreshold(playerId: PlayerId, threshold: string): boolean {
    if (!threshold) return true;
    if (this.hasOmnipotence(playerId)) return true;

    const required = parseThreshold(threshold);
    const available = this.getThresholds(playerId);
    return (Object.keys(required) as ResourceIcon[]).every(
      icon => (available[icon] ?? 0) >= (required[icon] ?? 0)
    );
  }

  private meetsThreshold(
    playerId: PlayerId,
    threshold: string | number,
    /**
     * The card being deployed — when it carries `behavior`/`thresholdSlack`
     * (FEALTY) and its `condition` holds, the requirement is satisfied
     * whenever the player is at most `amount` icons short in TOTAL across
     * every icon type. Passed from `deployCard` / `getCardPlayability`.
     */
    slackFor?: { definition: CardDefinition; cardId: CardInstanceId }
  ): boolean {
    if (!threshold || threshold === 0 || threshold === "") {
      return true;
    }

    // OMNIPOTENCE (The Evil Alliance) — meet every threshold regardless of icons.
    if (this.hasOmnipotence(playerId)) {
      return true;
    }

    const required = parseThreshold(threshold);
    const available = this.getThresholds(playerId);

    const slack = slackFor?.definition.thresholdSlack;
    let slackBudget = 0;
    if (
      slack &&
      this.evaluateCondition(slack.condition, {
        sourceId: slackFor!.cardId,
        controllerId: playerId,
        selected: {}
      })
    ) {
      slackBudget = slack.amount;
    }

    let deficit = 0;
    for (const icon of [
      "rage",
      "greed",
      "deception",
      "elitism",
      "obsession",
      "volition"
    ] as const) {
      // "This turn, reduce the threshold requirement of the next card you
      // deploy by N of the named icon." (Clockman Skydocks).
      const reduction = this.state.thresholdReductions
        .filter(r => r.playerId === playerId && r.icon === icon)
        .reduce((n, r) => n + r.amount, 0);
      const shortfall =
        Math.max(0, (required[icon] ?? 0) - reduction) - (available[icon] ?? 0);
      if (shortfall > 0) {
        deficit += shortfall;
        // Without FEALTY slack, any single-icon shortfall fails outright.
        if (slackBudget === 0) return false;
      }
    }

    // "reduce this card's threshold requirement by any N resource icons"
    // (FEALTY) — a total-deficit allowance across all icon types.
    return deficit <= slackBudget;
  }

  private getEventCardId(
    event?: GameEvent
  ): CardInstanceId | undefined {
    if (!event) {
      return undefined;
    }

    switch (event.type) {
      case "cardPlayed":
      case "cardEnteredPlay":
      case "cardMoved":
      case "cardAttached":
      case "cardDestroyed":
      case "cardDepleted":
      case "cardRestored":
      case "resourcePlayed":
      case "abilityActivated":
      case "characterAttacked":
      case "characterBlocked":
      case "attackerBlocked":
      case "counterChanged":
      case "statModified":
      case "cardPicked":
        return event.cardId;

      case "damageDealt":
        return event.targetId;

      default:
        return undefined;
    }
  }

  /**
   * Who controlled `card` when `event` happened. `cardDestroyed` is emitted
   * after the destroyed card has moved to its owner's discard pile, where its
   * controller is no longer the one it had (`releaseControlOutsidePlay`), so
   * the event carries the controller the card had in play.
   */
  private controllerAtEvent(
    event: GameEvent | undefined,
    card: CardInstance
  ): PlayerId {
    if (event?.type === "cardDestroyed" && event.cardId === card.id) {
      return event.controllerId;
    }
    if (
      event?.type === "cardMoved" &&
      event.cardId === card.id &&
      event.controllerId !== undefined
    ) {
      return event.controllerId;
    }
    return card.controllerId;
  }

  private definitionHasKeyword(
    definition: CardDefinition,
    keyword: Keyword
  ): boolean {
    return definition.behavior?.keywords?.includes(keyword) ?? false;
  }

  /**
   * Whether `cardId` currently has `keyword` — printed statically, granted
   * temporarily (`grantKeyword`), or granted live by a continuous ability
   * (incl. an aura). Public: a renderer needs a card's live keyword set, and
   * it's the same check battle legality already uses.
   */
  hasKeyword(cardId: CardInstanceId, keyword: Keyword): boolean {
    return this.withKeywordReadMemo(() => {
      const memo = this.keywordReadMemo!;
      const key = `${[...this.resolvingContinuousGrant].sort().join(",")}|${cardId}|${keyword}`;
      const known = memo.get(key);
      if (known !== undefined) return known;
      const answer = this.scopedRead("keyword", `${cardId}|${keyword}`, () => this.computeHasKeyword(cardId, keyword));
      memo.set(key, answer);
      return answer;
    });
  }

  /** Runs a keyword read inside one `keywordReadMemo` scope, opening it if this is the outermost read. */
  private withKeywordReadMemo<T>(read: () => T): T {
    if (this.keywordReadMemo) return read();
    this.keywordReadMemo = new Map();
    try {
      return read();
    } finally {
      this.keywordReadMemo = undefined;
    }
  }

  /** Whether a `grantKeyword` entry on `cardId` counts right now (its `condition`, if any, holds). */
  private runtimeKeywordGrantHolds(
    grant: GameState["keywordGrants"][number],
    cardId: CardInstanceId
  ): boolean {
    return (
      !grant.condition ||
      this.evaluateCondition(grant.condition, {
        sourceId: grant.sourceId ?? cardId,
        controllerId: grant.controllerId ?? this.state.cards[cardId]?.controllerId ?? this.state.activePlayerId,
        selected: { __candidate: [cardId] }
      })
    );
  }

  private computeHasKeyword(cardId: CardInstanceId, keyword: Keyword): boolean {
    // A face-down card has no rules text, so no keywords (CR 411.1) —
    // except tactical, which is active even as a face-down resource
    // (CR 507.6b).
    if (this.isFaceDownInPlay(cardId)) {
      return keyword === "tactical" && this.definitionHasKeyword(this.getDefinition(cardId), keyword);
    }

    // A suppression ("it loses COVERT") beats every grant, printed or
    // otherwise — both the continuous form and the duration'd
    // `suppressKeyword` effect (I See You!).
    if (this.getContinuousKeywordSuppressions(cardId).includes(keyword)) {
      return false;
    }
    if (
      this.state.keywordSuppressions.some(
        g => g.targetId === cardId && g.keyword === keyword
      )
    ) {
      return false;
    }

    // "Loses all rules text" also removes the printed keywords (SYS-31).
    if (
      this.definitionHasKeyword(
        this.getDefinition(cardId),
        keyword
      ) &&
      !this.abilitySuppressed(cardId)
    ) {
      return true;
    }

    if (
      this.state.keywordGrants.some(
        grant => grant.targetId === cardId && grant.keyword === keyword && this.runtimeKeywordGrantHolds(grant, cardId)
      )
    ) {
      return true;
    }

    // "Characters you control [and deploy] gain <keyword>" (Hasty Pursuit).
    const controllerId = this.state.cards[cardId]?.controllerId;
    if (
      controllerId &&
      this.state.playerKeywordGrants.some(
        grant => grant.playerId === controllerId && grant.keyword === keyword
      )
    ) {
      return true;
    }

    return this.getContinuousKeywordGrants(cardId).includes(keyword);
  }

  /** Every keyword `cardId` currently has (see `hasKeyword`). */
  getKeywords(cardId: CardInstanceId): Keyword[] {
    // One memo scope for all eight reads: they share most sub-questions.
    return this.withKeywordReadMemo(() => ALL_KEYWORDS.filter(keyword => this.hasKeyword(cardId, keyword)));
  }

  private requireCard(
    id: CardInstanceId
  ): CardInstance {
    const card = this.state.cards[id];

    assert(card, `Card '${id}' not found.`);

    return card;
  }

  private requirePlayer(
    id: PlayerId
  ): PlayerState {
    const player = this.state.players[id];

    assert(player, `Player '${id}' not found.`);

    return player;
  }

  /**
   * Every living player who may respond to an action by `playerId`, in turn
   * order from the next seat (in a two-player game, the opponent). Not
   * limited to opponents: any other player may respond (engine-derived, D6).
   */
  private respondersTo(playerId: PlayerId): PlayerId[] {
    return otherLivingSeats(this.state, playerId);
  }

  /**
   * Who gets a battle response window, in order: the attacking player, then
   * the defending player (CR §608.1c / §609.1a), then every other living
   * player in turn order from the attacker (engine-derived, D6).
   */
  private battleResponders(battle: BattleState): PlayerId[] {
    const lead = [battle.attackerPlayerId, battle.defenderPlayerId];
    return [...lead, ...otherLivingSeats(this.state, battle.attackerPlayerId).filter(id => !lead.includes(id))];
  }

  /** Hands priority on the item now on top of the response stack to the first player who may respond to `actorId`. */
  private offerTopOfStack(window: ResponseWindowState, actorId: PlayerId): void {
    window.stackResponders = this.respondersTo(actorId);
    window.priorityPlayerId = window.stackResponders[0] ?? actorId;
    this.state.priorityPlayerId = window.priorityPlayerId;
  }

  /**
   * The players an "opponent" reference in `context` names: the opponent the
   * block of rules text bound (`context.opponentId`, while still in the
   * game), or every opponent of its controller when nothing is bound.
   */
  private opponentIdsFor(context: Pick<ResolutionContext, "controllerId" | "opponentId">): PlayerId[] {
    if (context.opponentId !== undefined) {
      // Bound to a player who has since left the game: the text still names
      // them, so it reaches nobody else (D8).
      return isLiving(this.state, context.opponentId) ? [context.opponentId] : [];
    }
    return opponentsOf(this.state, context.controllerId);
  }

  /**
   * The single player an "opponent" reference in `context` names — the bound
   * opponent, or the only candidate. A reference that needs one player
   * cannot resolve while several opponents are unbound.
   */
  private soleOpponentFor(context: Pick<ResolutionContext, "controllerId" | "opponentId">): PlayerId {
    // An eliminated bound opponent is still the one named; acting on them does nothing (their cards are gone).
    if (context.opponentId !== undefined && !isLiving(this.state, context.opponentId)) return context.opponentId;
    const ids = this.opponentIdsFor(context);
    assert(ids.length > 0, `'${context.controllerId}' has no opponent left in the game.`);
    // Several opponents and none bound, mid-resolution with nobody to ask (a
    // replacement, a nested effect): the first in turn order (RULES.md §16).
    return ids[0];
  }

  /**
   * The `GameState.turn` number on which `playerId`'s `nth` next turn
   * begins, counting the living seats in turn order from the active player
   * (the current turn's start has already passed). In a two-player game:
   * two turns on for the active player, one for the other.
   */
  private turnNumberOfNextTurn(playerId: PlayerId, nth = 1): number {
    const seats = livingSeats(this.state);
    const offset = seats.indexOf(playerId);
    assert(offset >= 0, `'${playerId}' is not in the game.`);
    return this.state.turn + (offset === 0 ? seats.length : offset) + (nth - 1) * seats.length;
  }

  /**
   * Binds the opponent a block of rules text is about (MP 2; D4), once its
   * picks are known. Nothing to do when the block names no opponent, or its
   * controller has at most one: "opponent" then already means that player (or
   * nobody). Otherwise, in order: `explicit` (the action's `opponentId`, which
   * must be one of the candidates); the owner / controller of a card picked
   * through an "opponent" selector (E2: "pick a character an opponent
   * controls" settles which). Returns the candidates when the block still needs
   * the opponent chosen — some reference outside its picks — and nothing
   * settled it.
   */
  private bindBlockOpponent(
    context: ResolutionContext,
    block: unknown,
    declarations: readonly TargetDeclaration[],
    explicit?: PlayerId
  ): PlayerId[] | undefined {
    const candidates = opponentsOf(this.state, context.controllerId);
    if (explicit !== undefined) {
      assert(candidates.includes(explicit), `'${explicit}' is not one of your opponents.`);
      context.opponentId = explicit;
      return undefined;
    }
    if (context.opponentId !== undefined && candidates.includes(context.opponentId)) return undefined;
    if (candidates.length <= 1) return undefined;
    const refs = opponentRefsOf(block);
    if (!refs.inPicks && !refs.elsewhere) return undefined;
    const picked = this.opponentFromPicks(declarations, context, candidates);
    if (picked !== undefined) {
      context.opponentId = picked;
      return undefined;
    }
    return refs.elsewhere ? candidates : undefined;
  }

  /** The first candidate opponent who controls (or, for an `owner` selector, holds) a card picked through an "opponent" selector. */
  private opponentFromPicks(
    declarations: readonly TargetDeclaration[],
    context: ResolutionContext,
    candidates: readonly PlayerId[]
  ): PlayerId | undefined {
    for (const declaration of declarations) {
      const selector = declaration.selector as { controller?: unknown; owner?: unknown };
      const byController = selector.controller === "opponent";
      const byOwner = selector.owner === "opponent";
      if (!byController && !byOwner) continue;
      for (const cardId of context.selected[declaration.id] ?? []) {
        const card = this.state.cards[cardId];
        if (!card) continue;
        const playerId = byController ? card.controllerId : this.zoneHolderId(card);
        if (candidates.includes(playerId)) return playerId;
      }
    }
    return undefined;
  }

  /**
   * E3: the opponent a triggering event is about — the player who acted, or
   * the controller of the card it concerns — when that player is one of
   * `controllerId`'s opponents ("when an opponent deploys a character, that
   * player ...").
   */
  private eventOpponent(event: GameEvent | undefined, controllerId: PlayerId): PlayerId | undefined {
    if (!event) return undefined;
    const candidates = opponentsOf(this.state, controllerId);
    const record = event as unknown as Record<string, unknown>;
    const players: unknown[] = [record.playerId, record.attackerPlayerId, record.defenderPlayerId];
    const cardId = this.getEventCardId(event);
    if (cardId !== undefined && this.state.cards[cardId]) players.push(this.state.cards[cardId].controllerId);
    // A battle event is about the battle's two sides ("when this card attacks, your opponent ..." — the defender).
    const battle = this.state.battle;
    if (battle && ("battleId" in record || /attack|block|battle/i.test(event.type))) {
      players.push(battle.defenderPlayerId, battle.attackerPlayerId);
    }
    return players.find((id): id is PlayerId => typeof id === "string" && candidates.includes(id));
  }

  /**
   * Hands claimed Hero cards to `claimerId` (SD 8–10): each leaves its table
   * pile and becomes theirs. A non-tactic is put into play under them; the
   * first tactic is offered to them to play for free, ignoring threshold (a
   * `deployForFree` choice marked `heroClaim`), with the rest of the claim
   * continuing once that is settled.
   */
  private claimHeroCards(cardIds: readonly CardInstanceId[], claimerId: PlayerId, context: ResolutionContext): void {
    const showdown = this.state.showdown;
    if (!showdown) return;
    const claimed = cardIds.filter(id => this.state.cards[id]?.zone === "table");
    showdown.heroDeck = showdown.heroDeck.filter(id => !claimed.includes(id));
    showdown.temptationPile = showdown.temptationPile.filter(id => !claimed.includes(id));
    for (const cardId of claimed) {
      const card = this.requireCard(cardId);
      card.ownerId = claimerId;
      card.controllerId = claimerId;
    }
    if (claimed.length > 0) this.emit({ type: "heroCardsClaimed", playerId: claimerId, cardIds: [...claimed] });

    for (let i = 0; i < claimed.length; i++) {
      const cardId = claimed[i];
      if (this.getDefinition(cardId).type !== "tactic") {
        this.putCardIntoPlay(cardId, claimerId, false, { ...context, controllerId: claimerId });
        continue;
      }
      // "...plays it for free if they can (ignoring threshold)"; one that cannot be played is removed (SD 9, SD 10).
      if (!this.claimedTacticPlayable(cardId, claimerId)) {
        this.moveCard(cardId, "removed");
        continue;
      }
      const rest = claimed.slice(i + 1);
      const restKey = "__heroClaimRest";
      const claimContext: ResolutionContext = {
        ...context,
        controllerId: claimerId,
        selected: { ...context.selected, [restKey]: rest }
      };
      this.state.pendingChoice = {
        kind: "deployForFree",
        id: this.nextId("choice"),
        playerId: claimerId,
        candidates: [cardId],
        context: claimContext,
        fromZone: true,
        ignoreThreshold: true,
        heroClaim: true,
        ...(rest.length > 0
          ? {
              afterDeploy: [
                { type: "claimHeroCards", claimer: { type: "player", id: claimerId }, from: "selected", selected: restKey }
              ]
            }
          : {})
      };
      return;
    }
  }

  /**
   * DARING GAMBIT (SD-EA 10): tallies a Hero's damage to another Hero's
   * faction this turn and, the moment one Hero's total against one other
   * Hero reaches the Villain faction's `daringGambit.damage`, queues the
   * damaging Hero's claim of the entire Temptation Pile — the Villain
   * faction's rule, so it is a trigger of that faction card.
   */
  private daringGambitTriggers(
    event: Extract<GameEvent, { type: "damageDealt" }>,
    batchId: string
  ): TriggerResolution[] {
    const showdown = this.state.showdown;
    const villainId = villainOf(this.state);
    if (!showdown || villainId === undefined || !event.sourceId || event.amount <= 0) return [];
    const gambit = this.getFactionDefinition(villainId)?.daringGambit;
    const villainFactionId = this.state.players[villainId]?.factionId;
    if (!gambit || !villainFactionId || !this.state.cards[villainFactionId]) return [];
    const target = this.state.cards[event.targetId];
    const source = this.state.cards[event.sourceId];
    if (!target || !source || this.getDefinition(target.id).type !== "faction") return [];
    const victimId = this.factionHolderId(target);
    const heroId = source.controllerId;
    if (heroId === victimId || !isHero(this.state, heroId) || !isHero(this.state, victimId)) return [];

    const tally = ((showdown.heroDamageThisTurn ??= {})[heroId] ??= {});
    const before = tally[victimId] ?? 0;
    tally[victimId] = before + event.amount;
    if (before >= gambit.damage || tally[victimId] < gambit.damage) return [];

    const abilityId = "showdown-daring-gambit";
    return [
      {
        sourceId: villainFactionId,
        ability: {
          type: "triggered",
          id: abilityId,
          name: "Daring Gambit",
          event: "damageDealt",
          effects: [{ type: "claimHeroCards", claimer: { type: "player", id: heroId }, from: "temptationPile", count: "all" }]
        },
        context: { sourceId: villainFactionId, controllerId: villainId, abilityId, event, selected: {} },
        batchId
      }
    ];
  }

  /**
   * Whether `claimerId` can play the claimed Hero tactic `cardId` (SD 9): its
   * condition holds and every pick it must make has enough candidates, in at
   * least one of its modes. Threshold and numeric cost are waived.
   */
  private claimedTacticPlayable(cardId: CardInstanceId, claimerId: PlayerId): boolean {
    const definition = this.getDefinition(cardId);
    const modeCount = Math.max(1, definition.behavior?.modes?.length ?? 0);
    const context: ResolutionContext = { sourceId: cardId, controllerId: claimerId, selected: {} };
    for (let mode = 0; mode < modeCount; mode++) {
      try {
        const condition = this.getTacticCondition(definition, mode);
        if (condition && !this.evaluateCondition(condition, context)) continue;
        const fits = this.getPlayTargetDeclarations(definition, mode).every(declaration => {
          if (declaration.optional) return true;
          const needed = Math.max(0, this.evaluateNumber(declaration.count, context));
          return this.targetCandidates(declaration.selector, context, claimerId, needed).length >= needed;
        });
        if (fits) return true;
      } catch {
        // A mode that cannot even be evaluated here is not playable.
      }
    }
    return false;
  }

  /**
   * Whether playing the claimed Hero tactic \`cardId\` (now the pending
   * `deployForFree` choice) actually succeeds on a dry run, taking the first
   * legal cards for every pick it must make — the test for refusing to let
   * the claimer decline it (SD 9: "plays it for free if they can").
   */
  private claimedTacticDryRunPlays(cardId: CardInstanceId, playerId: PlayerId): boolean {
    if (!this.claimedTacticPlayable(cardId, playerId)) return false;
    const definition = this.getDefinition(cardId);
    const context: ResolutionContext = { sourceId: cardId, controllerId: playerId, selected: {} };
    const selected: Record<string, CardInstanceId[]> = {};
    for (const declaration of this.getPlayTargetDeclarations(definition, 0)) {
      const needed = declaration.optional ? 0 : Math.max(0, this.evaluateNumber(declaration.count, context));
      selected[declaration.id] = this.targetCandidates(declaration.selector, context, playerId, needed)
        .slice(0, needed)
        .map(card => card.id);
      context.selected[declaration.id] = selected[declaration.id];
    }
    return this.checkAction({
      type: "resolvePendingChoice",
      playerId,
      choice: { kind: "deployForFree", cardId, selected }
    }).ok;
  }

  /** Sets the game's result and announces it. */
  private endGame(result: GameResult): void {
    this.state.result = result;
    this.emit({ type: "gameEnded", result });
  }

  /**
   * Applies the players who just lost (RULES.md §1; D3): ends the game if
   * they leave a single player — or, in Showdown, a single side — standing
   * (a draw if nobody is left), and otherwise eliminates them while the
   * others play on.
   */
  private settleDefeats(losers: ReadonlyMap<PlayerId, PlayerElimination["reason"]>): void {
    const out = [...losers.keys()].filter(id => isLiving(this.state, id));
    if (out.length === 0) return;
    const result = this.resultIfOut(out);
    if (result) {
      this.endGame(result);
      return;
    }
    for (const playerId of out) this.eliminatePlayer(playerId, losers.get(playerId)!);
  }

  /** The game's result if every player in `out` left it now, or `undefined` if it would go on. */
  private resultIfOut(out: readonly PlayerId[]): GameResult | undefined {
    const living = livingSeats(this.state).filter(id => !out.includes(id));
    if (this.state.format.kind === "showdown") {
      // The Villain's side is the Villain and every Hero secretly loyal to
      // them; a side wins once the other has no one left (D3), including its
      // members already knocked out.
      const villainSide = this.state.turnOrder.filter(id => getLoyalty(this.state, id) === "villain");
      const heroSide = this.state.turnOrder.filter(id => getLoyalty(this.state, id) === "heroes");
      const villainLeft = living.includes(this.state.format.villainId);
      const heroesLeft = heroSide.some(id => living.includes(id));
      if (!villainLeft && !heroesLeft) return { outcome: "draw", winners: [] };
      if (!villainLeft) return { outcome: "victory", winners: heroSide };
      if (!heroesLeft) return { outcome: "victory", winners: villainSide };
      return undefined;
    }
    if (living.length === 0) return { outcome: "draw", winners: [] };
    if (living.length === 1) return { outcome: "victory", winners: [living[0]] };
    return undefined;
  }

  /**
   * Takes `playerId` out of a game that goes on without them (D8): cards
   * they control but do not own return to their owners, every card they own
   * leaves the game, and their actions still on the response stack, their
   * queued triggers and their delayed effects are dropped. They no longer
   * respond, take turns or count as anyone's opponent. If it is their turn,
   * the turn passes once whatever is still resolving settles
   * (`completeEliminatedTurn`).
   */
  private eliminatePlayer(playerId: PlayerId, reason: PlayerElimination["reason"]): void {
    const player = this.requirePlayer(playerId);
    const seatsBefore = livingSeats(this.state);
    player.eliminated = { turn: this.state.turn, reason };
    this.restampFutureTurns(seatsBefore, playerId);

    for (const card of Object.values(this.state.cards)) {
      if (card.zone === "play" && card.controllerId === playerId && card.ownerId !== playerId) {
        this.reassignControl(card.id, card.ownerId);
      }
    }
    for (const card of Object.values(this.state.cards)) {
      if (card.ownerId === playerId && card.zone !== "removed") {
        this.moveCard(card.id, "removed", false, "bottom", true);
      }
    }

    const stack = this.state.responseStack;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].controllerId === playerId) stack.splice(i, 1);
    }
    for (let i = this.immediateQueue.length - 1; i >= 0; i--) {
      if (this.immediateQueue[i].context.controllerId === playerId) this.immediateQueue.splice(i, 1);
    }
    this.state.scheduledEffects = this.state.scheduledEffects.filter(entry => entry.controllerId !== playerId);

    // A battle one side of which left the game is over (D8): it finishes as any
    // battle does, and its pending steps are skipped (`resumeContinuation`).
    const battle = this.state.battle;
    if (
      battle &&
      battle.phase !== "finished" &&
      (battle.attackerPlayerId === playerId || battle.defenderPlayerId === playerId)
    ) {
      this.finishBattle(battle);
    }

    const window = this.state.responseWindow;
    if (window) {
      window.pendingResponders = window.pendingResponders.filter(id => id !== playerId);
      if (window.stackResponders) window.stackResponders = window.stackResponders.filter(id => id !== playerId);
      if (window.priorityPlayerId === playerId) {
        const next = (stack.length > 0 ? window.stackResponders : window.pendingResponders)?.[0];
        if (next !== undefined && window.phase === "acceptingResponses") {
          window.priorityPlayerId = next;
        } else {
          window.phase = "resolving";
          window.priorityPlayerId = this.state.activePlayerId;
        }
        this.state.priorityPlayerId = window.priorityPlayerId;
      }
    }

    this.emit({ type: "playerEliminated", playerId, reason });
  }

  /**
   * Turn numbers stamped ahead of time ("until the start of your next turn" —
   * `Duration.untilTurn`; skipped Restore Rules) were counted with
   * `seatsBefore` in the rotation. With `outId` gone, each future turn number
   * is moved to the turn on which the same seat (or, for the eliminated
   * seat's own turn, the next seat after it) now comes up.
   */
  private restampFutureTurns(seatsBefore: readonly PlayerId[], outId: PlayerId): void {
    const turn = this.state.turn;
    const seatsAfter = seatsBefore.filter(id => id !== outId);
    if (seatsAfter.length === 0) return;
    const restamp = (future: number): number => {
      const k = future - turn;
      if (k <= 0) return future;
      let cycle = Math.floor(k / seatsBefore.length);
      let index = k % seatsBefore.length;
      if (seatsBefore[index] === outId) {
        index++;
        if (index === seatsBefore.length) {
          index = 0;
          cycle++;
        }
      }
      // When the active player is the one out, the next seat's turn is the next turn.
      const shift = seatsBefore[0] === outId ? 1 : 0;
      return turn + shift + cycle * seatsAfter.length + seatsAfter.indexOf(seatsBefore[index]);
    };
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (typeof record.untilTurn === "number") record.untilTurn = restamp(record.untilTurn);
      for (const [key, value] of Object.entries(record)) {
        if (key !== "untilTurn") visit(value);
      }
    };
    for (const [key, value] of Object.entries(this.state)) {
      if (key === "gameLog" || key === "cards" || key === "restoreRuleSkips") continue;
      visit(value);
    }
    for (const [owner, turns] of Object.entries(this.state.restoreRuleSkips)) {
      this.state.restoreRuleSkips[owner] = turns.map(restamp);
    }
  }

  /**
   * Called after every action: an eliminated active player's turn passes to
   * the next seat once nothing is left resolving — no choice, queued
   * trigger, response window, stack item or battle.
   */
  private completeEliminatedTurn(): void {
    const activeId = this.state.activePlayerId;
    if (this.state.result || isLiving(this.state, activeId) || !this.state.started) return;
    if (this.turnWaveBlocked() || this.state.responseWindow) return;
    this.state.endingTurnFor = undefined;
    this.state.startingTurnFor = undefined;
    this.passTurn(activeId);
  }
}

