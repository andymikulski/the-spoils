// -----------------------------------------------------------------------------
// Read-only queries for clients
//
// Answers a UI or bot would otherwise work out for itself. Each one calls the
// same private logic `perform()` uses (see BEHAVIORS.md, "Read-only queries
// for clients"); none of them changes the game.
// -----------------------------------------------------------------------------

import type { AbilityId, CardInstanceId, CardType, Duration, Keyword, ModifierOperation, PlayerId, Restriction, Stat, Zone } from "./ids.js";
import type { CardPlayability, ScheduledEffect } from "./state.js";
import type { ActivatedAbility } from "./cards.js";
import type { DevelopChoice } from "./cards.js";

/** Why an activated ability is not offered right now (see {@link ActivatedAbilityStatus}). */
export type AbilityUnavailableReason =
  /** Not a moment this player may use abilities (a battle, unresolved responses, not their turn / priority). */
  | "timing"
  /** The card has a `cannotUseAbilities` restriction. */
  | "restricted"
  /** The ability is switched off (it "loses all rules text"; another card suppresses it). */
  | "suppressed"
  /** A per-turn limit is used up, or the ability is locked for the turn. */
  | "usesSpent"
  /** Its cost depletes a card that is already depleted. */
  | "depleted"
  /** Its costs cannot be paid (resources, tax included, a discard, a counter, ...). */
  | "cost"
  /** Its condition is not satisfied. */
  | "condition"
  /** A mandatory target declaration has too few legal candidates. */
  | "targets"
  /** The card is a face-down resource and this ability is not usable face-down. */
  | "faceDown"
  /** Its printed threshold (the icons it needs on the board) is not met. */
  | "threshold";

/** One activated ability a player could use, and whether it is offered now (`SpoilsEngine.getActivatedAbilityStatuses`). */
export interface ActivatedAbilityStatus {
  cardId: CardInstanceId;
  ability: ActivatedAbility;
  /**
   * The zone the card is in, which is the zone the ability is used from (its `activationZone`, "play" by default):
   * "discard" for RECUR / NINE LIVES, "hand" for HELPING PAW. A UI labels non-"play" ones ("From discard").
   */
  zone: Zone;
  /** True exactly when `getAvailableActivatedAbilities` lists it. */
  available: boolean;
  /** The first gate that fails, when `available` is false. */
  unavailableBecause?: AbilityUnavailableReason;
}

/**
 * A void / removed-from-game card the player may play "as though it were in hand" — through a `grantVoidPlay`
 * effect (Cheats, Pant Swipe, Eccentric Inquisition) or a live aura (Voidal Tactician). Listed whether or not it is
 * playable right now; read `playability`. `SpoilsEngine.getPlayableFromOutsideHand`.
 */
export interface OutsideHandPlay {
  cardId: CardInstanceId;
  zone: "void" | "removed";
  /** The card lies face-down (Pant Swipe's voided cards). */
  faceDown: boolean;
  /** "grant": a persistent `voidPlayGrants` entry. "aura": a live continuous ability of a card in play. */
  source: "grant" | "aura";
  /** The card whose effect / ability gives the permission, when known. */
  grantSourceId?: CardInstanceId;
  /** The printed threshold is waived for this play (the numeric cost is still paid). */
  ignoreThreshold: boolean;
  /** `getCardPlayability(playerId, cardId)` for this card: timing, threshold, numeric cost, resources. */
  playability: CardPlayability;
}

/** What kind of delayed / lingering effect a {@link PendingDelayedEffect} describes. */
export type DelayedEffectKind =
  /** A `scheduleEffect` rider that has not fired yet (Gilded Yurt, Imperial Palace, Drill Instructor, Final Countdown ...). */
  | "scheduledEffect"
  /** A player's whole Restore Rule is skipped on a named turn (`GameState.restoreRuleSkips`: Monstrous Lassitude). */
  | "restoreRuleSkip"
  /** One card is skipped by its controller's next Restore Rule (`CardInstance.skipNextRestore`: Numba 1 Stunna!). */
  | "skipNextRestore"
  /** One card cannot be restored by the Restore Rule while it stays in play (`CardInstance.restoreLocked`: Wily Circumvention). */
  | "restoreLock"
  /** A timed take-control ends and the card goes back (`GameState.controlGrants`: Mutiny Grant, Cicibeo). */
  | "controlReturn"
  /** A borrowed card is removed from the game at the end of the turn (`CardInstance.borrowedUntilEndOfTurn`). */
  | "removeAtEndOfTurn";

/**
 * When a {@link PendingDelayedEffect} happens: the `scheduleEffect` moments, plus
 *  - `endOfNextTurn`: a control grant "until the end of your next turn";
 *  - `whileInPlay`: stays for as long as the affected card / source remains in play (no fixed moment).
 */
export type DelayedEffectWhen = ScheduledEffect["when"] | "endOfNextTurn" | "whileInPlay";

/**
 * One delayed or lingering effect the game is waiting on, so a UI can say "Returns at the start of your next turn".
 * `SpoilsEngine.getPendingDelayedEffects`. Read-only description: the effect bodies are not exposed.
 */
export interface PendingDelayedEffect {
  /** Stable while it is pending (the scheduled-effect / control-grant id, or `kind:cardId` / `kind:player:turn` for flags). */
  id: string;
  kind: DelayedEffectKind;
  /** The card whose effect set this up; absent when the engine did not record one (restore skips / locks, control grants). */
  sourceId?: CardInstanceId;
  /**
   * The player it belongs to: a scheduled effect's controller; the player whose Restore Rule is skipped (or whose
   * card is); for `controlReturn` the player the card goes BACK to.
   */
  controllerId: PlayerId;
  when: DelayedEffectWhen;
  /** The turn number on which it happens (the start or end of that turn, per `when`), when it is knowable. */
  turn?: number;
  /** Cards it will act on: the picks a scheduled rider remembered, the skipped / locked / returning card, the borrowed card. */
  affectedCardIds?: CardInstanceId[];
  /** Short viewer-safe description (player and card names only; a face-down card reads "a face-down card"). */
  text: string;
}

/** Which side a hand card may be played as a resource (`SpoilsEngine.getResourcePlayFaces`). */
export interface ResourcePlayFaces {
  /** `playResourceCard` would take the card face-up: a resource card that is not `faceDownOnly`, in this player's hand. */
  canFaceUp: boolean;
  /** `playResourceCard` would take the card face-down: any card in this player's hand (CR 203.2). */
  canFaceDown: boolean;
  /** Set when face-down is the only way: the card is not a resource, or is a `faceDownOnly` resource. */
  forcedFaceDown?: "notAResource" | "faceDownOnly";
  /** The engine's refusal for face-up, when `canFaceUp` is false. */
  reason?: string;
}

/** What a mulligan would do (`SpoilsEngine.previewMulligan`). */
export interface MulliganPreview {
  /** The cards that would come into the hand, in draw order. */
  incoming: CardInstanceId[];
  /** The most cards the player may send back (their hand size). */
  maxCards: number;
  /** A card the mulligan sets aside raises a prompt (Community Chest); the replacements are drawn once it is answered. */
  pausesForPrompt: boolean;
}

/** Context for {@link CostAffordability} queries. */
export interface CostAffordabilityContext {
  /** The card the cost belongs to. Defaults to the payer's faction card. */
  sourceId?: CardInstanceId;
  abilityId?: AbilityId;
  /** Who pays when it is not the asking player. Defaults to `playerId`. */
  controllerId?: PlayerId;
  selected?: Record<string, CardInstanceId[]>;
  variables?: Record<string, number>;
  named?: Record<string, string>;
  /**
   * `"mayPay"` (default): a cost the way a `mayPay` offer judges it, with the payer's pending "reduce the next
   * numeric cost" effects counted.
   * `"ability"`: the cost as using `sourceId`'s ability pays it: in-play taxes and reductions
   * (`abilityCostModifiers`, Department of Rejections) are folded in too, and `pick` steps are left to the use.
   */
  as?: "mayPay" | "ability";
}

/** Whether a cost list can be paid, and the numbers behind it (`SpoilsEngine.getCostAffordability`). */
export interface CostAffordability {
  payable: boolean;
  /** The numeric (`payResources`) cost as it would be paid, taxes and reductions counted; absent when the list has none. */
  need?: number;
  /** Ready resources the payer has. */
  have?: number;
  /** Why it cannot be paid. */
  reason?: string;
}

/** The answer to "may this value be named?" for a `nameValue` choice (`SpoilsEngine.checkNameValue`). */
export type NameValueCheck = { ok: true } | { ok: false; error: string };

// -----------------------------------------------------------------------------
// Lasting protections / redirects, rules-text suppression, provenance, stat modifiers
// -----------------------------------------------------------------------------

/** What a {@link ActiveProtection} is. All of them are effects that already resolved and now linger. */
export type ActiveProtectionKind =
  /** `preventDamage`: a "reduce the next N damage" or "redirect the next N damage" shield on one card. */
  | "damageShield"
  /** `preventAllDamage`: all inflicted damage is reduced to 0 (Limited Liability, Inconvenient Roadblock). Applies to every card. */
  | "damagePrevention"
  /** `restrictDestruction`: cards can only be destroyed by costs (Limited Liability). Applies to every card. */
  | "destructionRestriction"
  /** `installReplacement`: "if X would be destroyed / move, instead ..." (Elzibeth, Ignatious, Retreat to Mount Mulrich ...). */
  | "replacement"
  /** `modifyOutgoingDamage` / `modifyIncomingDamage`: damage dealt by / to a card is changed by `amount`. */
  | "damageModifier"
  /** `redirectHandMoves`: cards that would enter a hand go elsewhere (Quotidian Misfire). Applies to a player. */
  | "handMoveRedirect"
  /** `transformBattleDamage`: a character's battle damage is set, redirected or turned into a bounce. */
  | "battleDamageTransform"
  /** `restrictBlockers`: only some parties may block this attacker. */
  | "blockRestriction"
  /** `requireBlock`: a blocker must block an attacker if it can. */
  | "mustBlock"
  /** `restrictParty`: a party including this card must meet a size / parity rule. */
  | "partyRestriction";

/**
 * How long an {@link ActiveProtection} lasts, in a UI's words.
 * "nextTime" = the next matching damage / replacement only (it is spent then; it may also lapse at the end of the turn,
 * see `ActiveProtection.text`). "untilSpent" = a persistent shield that survives turns until used up.
 */
export type ActiveProtectionDuration =
  | "thisTurn"
  | "untilEndOfBattle"
  | "untilStartOfNextTurn"
  | "untilEndOfNextTurn"
  | "whileSourceInPlay"
  | "nextTime"
  | "untilSpent"
  | "permanent";

/**
 * One lingering protection, redirect or restriction created by an effect that has already resolved
 * (`SpoilsEngine.getActiveProtections`). Public information only: the card names in `text` are the log names (a
 * face-down card reads "a face-down card" and its id is left out of `sourceId`). Static rules text of cards in play
 * (continuous abilities) is NOT in this list.
 */
export interface ActiveProtection {
  /** The state entry's id (shield / window / grant id); stable while it is in force. */
  id: string;
  kind: ActiveProtectionKind;
  /** The card whose effect created it, when the engine recorded one and the card is not hidden. */
  sourceId?: CardInstanceId;
  /** The player who controls the effect (replacements, hand redirects), when known. */
  controllerId?: PlayerId;
  /**
   * The cards it acts on. Absent = it is not scoped to particular cards (a blanket window, or a replacement whose
   * scope is a condition); then it counts for every card when asked about one card.
   */
  appliesToCardIds?: CardInstanceId[];
  /** The player it acts on (hand-move redirects). */
  playerId?: PlayerId;
  duration: ActiveProtectionDuration;
  /** The turn number the end is stamped for (`untilStartOfNextTurn` / `untilEndOfNextTurn`), when known. */
  untilTurn?: number;
  /** Points left on a shield, the damage delta of a modifier, or the fixed battle damage amount. */
  amount?: number;
  /**
   * What it does, structurally (so a UI need not parse `text`). Only set on kinds where it is meaningful:
   * - damageShield: "redirect" (inflicted elsewhere), "reduce" (a one-instance "reduced by N"), else "prevent".
   * - damagePrevention / destructionRestriction: "prevent".
   * - replacement: "replace".
   * - damageModifier: "reduce" (delta < 0) or "increase" (delta >= 0).
   * - handMoveRedirect: "redirect".
   * - battleDamageTransform: "transform".
   * Absent on blockRestriction / mustBlock / partyRestriction.
   */
  mode?: ActiveProtectionMode;
  /** Whether damage-related entries act on damage a card receives or deals. Shields / windows / replacements-of-damage are "incoming". */
  direction?: "incoming" | "outgoing";
  /** `replacement` entries only, from the stored replacement: "destroy" (would be destroyed), "leavePlay" (would move to any zone) or "moveToZone" (would be put into `replacementZone`). */
  replacementKind?: "destroy" | "leavePlay" | "moveToZone";
  /** `replacement` entries with `replacementKind: "moveToZone"`: the zone the replaced move targets. */
  replacementZone?: string;
  /** A short viewer-safe sentence, e.g. "Tiny Shiny: prevents the next 2 damage to Mordecai this turn". */
  text: string;
}

/** See {@link ActiveProtection.mode}. */
export type ActiveProtectionMode = "prevent" | "redirect" | "reduce" | "increase" | "replace" | "transform";

/** Where a rules-text suppression comes from (`SpoilsEngine.getAbilitySuppressionSources`). */
export interface AbilitySuppressionSource {
  /** "aura": a continuous `suppressAllAbilities` of a card in play (Subversion Matrix, Mud Prison ...). "runtime": a lasting `suppressAbilities` effect (iDumb De-Itemizer). */
  kind: "aura" | "runtime";
  /** The card doing it (absent when hidden). */
  sourceId?: CardInstanceId;
  /** The continuous ability (aura only). */
  abilityId?: AbilityId;
  /** How long a runtime suppression lasts. */
  duration?: Duration;
}

/** Where a restriction, keyword or stat modifier comes from. */
export type ProvenanceKind =
  /** The card's own text (an ability on the card that has it, or printed keywords). */
  | "printed"
  /** A continuous ability of ANOTHER card in play (an aura, equipment, a lord). */
  | "aura"
  /** A lasting effect that resolved earlier (`grantKeyword`, `grantRestriction`, a +N/-N from a tactic ...). */
  | "runtime";

/** One reason a card currently has a restriction (`SpoilsEngine.getRestrictionSources`). */
export interface RestrictionSource {
  restriction: Restriction;
  kind: ProvenanceKind;
  /** The card responsible (absent when hidden, or when the engine did not record one). */
  sourceId?: CardInstanceId;
  /** The continuous ability that grants it (printed / aura). */
  abilityId?: AbilityId;
  /** How long a runtime grant lasts. */
  duration?: Duration;
}

/** One reason a card currently has a keyword (`SpoilsEngine.getKeywordGrantSources`). */
export interface KeywordGrantSource {
  keyword: Keyword;
  kind: ProvenanceKind;
  /** The card responsible; for printed keywords, the card itself. Absent when hidden or not recorded. */
  sourceId?: CardInstanceId;
  abilityId?: AbilityId;
  duration?: Duration;
  /** True for a player-wide grant (Hasty Pursuit: "characters you control gain AGGRO"). */
  playerWide?: boolean;
}

/**
 * One term of a card's stat (`SpoilsEngine.getStatModifiers`), in the order `getStat` applies them.
 * `amount` is what this term changed the running value by, so printed base + the sum of every `amount` is what
 * `getStat` returns (before its floor of 0).
 */
export interface StatModifierEntry {
  /** Runtime modifier id, or `continuous:<source>:<ability>:<target>:<stat>` for an aura term. */
  id: string;
  stat: Stat;
  kind: ProvenanceKind;
  sourceId?: CardInstanceId;
  abilityId?: AbilityId;
  operation: ModifierOperation;
  /** The modifier's own value (`+2` add, `3` set, `2` multiply). */
  value: number;
  /** The change it made to the running stat. */
  amount: number;
  /** `whileSourceInPlay` for continuous terms; the effect's own duration otherwise. */
  duration: Duration;
}

// -----------------------------------------------------------------------------
// Player-wide effects (`SpoilsEngine.getPlayerEffects`)
// -----------------------------------------------------------------------------

/** What a {@link PlayerEffect} is. */
export type PlayerEffectKind =
  /** `reduceNextCost`: a pending "the next card / numeric cost you pay costs N less" (1337!, Acuminous Gigantitect, Adjunct Artisan, Beefy Researcher ...). */
  | "costReduction"
  /** `reduceThreshold`: a pending "reduce the threshold requirement of the next card you deploy" (Clockman Skydocks). */
  | "thresholdReduction"
  /** `grantResourceIcons`: phantom resource icons a player controls for a while (31337!). */
  | "resourceGrant"
  /** `restrictPlay`: a runtime ban on playing a card type or using FLIP UP (Tactician Vacation, Study Disturbance, Surreptitious Larceny). */
  | "playRestriction"
  /** `grantKeywordToPlayer`: every character the player controls has a keyword for a while (Hasty Pursuit, Crushjaw Oceanhide). */
  | "keywordGrant"
  /** `skipRestoreRule`: the player's Restore Rule is skipped on a coming turn (Monstrous Lassitude). */
  | "restoreRuleSkip"
  /** An in-play `drawModifiers` ability: draws are increased or prevented (Beatrix Winterbottom). */
  | "drawModifier"
  /** An in-play `preventsDefeat` ability: 0 influence does not lose the game (Armored Keep). */
  | "preventsDefeat"
  /** An in-play `emptyDeckLoses` ability: a player with an empty deck loses (Trickster's Globe). */
  | "emptyDeckLoses";

/**
 * One effect that applies to a whole player rather than to a card (`SpoilsEngine.getPlayerEffects`). Public
 * information only: names in `text` are the log names (a face-down card reads "a face-down card" and its id is left out
 * of `sourceId`). An entry is listed exactly while the engine still reads it.
 */
export interface PlayerEffect {
  /** The state entry's id (runtime effects) or `source:ability:kind` (in-play continuous abilities); stable while in force. */
  id: string;
  kind: PlayerEffectKind;
  /** The card responsible, when the engine recorded one and the card is not hidden. Pending cost / threshold reductions and resource grants record none. */
  sourceId?: CardInstanceId;
  /** The player the effect applies to. */
  playerId: PlayerId;
  /**
   * How long it lasts: "nextTime" = consumed by the next play (and gone at end of turn); "untilSpent" = a persistent
   * reduction kept across turns until a play uses it; "whileSourceInPlay" for a continuous ability.
   */
  duration: ActiveProtectionDuration;
  /** The turn number the end is stamped for (`untilStartOfNextTurn` / `untilEndOfNextTurn`, a skipped Restore Rule), when known. */
  untilTurn?: number;
  /** A short viewer-safe sentence, e.g. "Alice cannot play tactics this turn". */
  text: string;
  /** The size of the effect: the reduction, the icons granted, the draw delta. */
  amount?: number;
  /** The card type it is limited to (cost reductions, play restrictions). */
  cardType?: CardType;
  /** The resource icon (threshold reductions, resource grants). */
  icon?: string;
  /** The keyword granted (keyword grants). */
  keyword?: Keyword;
}
