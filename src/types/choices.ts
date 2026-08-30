// -----------------------------------------------------------------------------
// Pending choices
// -----------------------------------------------------------------------------
//
// Some state-based or reactive moments require a specific player to make a
// real decision before the engine can continue — which duplicate Unique
// card to keep, which candidate satisfies an ambiguous triggered-ability
// target. These pause the engine (see GameState.pendingChoice) exactly the
// way an open response window or battle already does: perform() rejects
// everything except a matching "resolvePendingChoice" action until it's
// answered. This is the hook a future UI drives to render "it's your call"
// moments instead of the engine silently guessing.

import type { AbilityId, CardInstanceId, PlayerId, Zone } from "./ids.js";
import type { TargetDeclaration } from "./expressions.js";
import type { Cost } from "./costs.js";
import type { Effect, EffectOption } from "./effects.js";
import type { ResolutionContext } from "./resolution.js";

export interface PendingUniqueSurvivorChoice {
  kind: "uniqueSurvivor";
  id: string;
  playerId: PlayerId;
  /** The shared Unique designation (CardDefinition.unique) causing the conflict. */
  unique: string;
  /** Every in-play card sharing that designation under this player's control. */
  candidates: CardInstanceId[];
}

export interface PendingTargetChoice {
  kind: "selectTargets";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  abilityId?: AbilityId;
  /** Only the declarations that were actually ambiguous (more candidates than needed). */
  declarations: TargetDeclaration[];
}

/** Identifies one queued trigger: the card it came from and which ability. */
export interface TriggerRef {
  sourceId: CardInstanceId;
  abilityId: AbilityId;
}

export interface PendingTriggerOrderChoice {
  kind: "orderTriggers";
  id: string;
  playerId: PlayerId;
  /**
   * The triggers from one event still waiting to resolve (RULES.md §7).
   * The deciding player picks which one happens *next* (CR §503.4a); after
   * it resolves, if two or more remain this choice is re-raised for the
   * next pick.
   */
  triggers: TriggerRef[];
}

/** "An opponent discards a card" — `chooser` picks a target from `declaration`, then `effects` runs (see the `chooserSelectsTarget` effect). */
export interface PendingChooserTargetChoice {
  kind: "chooserSelectsTarget";
  id: string;
  playerId: PlayerId;
  declaration: TargetDeclaration;
  effects: Effect[];
  context: ResolutionContext;
}

/** "An opponent chooses one of the following effects" — `chooser` picks one of `options` to resolve in full (see the `chooserSelectsOption` effect). Each option's optional `label` is the only game-agnostic hint a UI has for describing it — see `EffectOption`. */
export interface PendingChooserOptionChoice {
  kind: "chooserSelectsOption";
  id: string;
  playerId: PlayerId;
  optionCount: number;
  options: EffectOption[];
  context: ResolutionContext;
}

/** "Look at the top N cards... put them back in any order" (see the `lookAndReorder` effect). */
export interface PendingReorderDeckChoice {
  kind: "reorderDeck";
  id: string;
  playerId: PlayerId;
  /** The cards being looked at, in their current top-to-bottom order. */
  cardIds: CardInstanceId[];
  /** Where the reordered cards go — `"top"` (default) leaves them on top, `"bottom"` relocates them to the bottom of the deck. */
  to?: "top" | "bottom";
}

/** "You may deploy a card with cost X or less for free" (see the `deployForFree` effect). */
export interface PendingDeployForFreeChoice {
  kind: "deployForFree";
  id: string;
  playerId: PlayerId;
  /** Legal hand cards (matching maxCost/selector) at the moment this paused. */
  candidates: CardInstanceId[];
  context: ResolutionContext;
  /**
   * Set by the `deployFromZone` effect — the single candidate is being
   * deployed from a zone OTHER than the hand (a face-down permanent/tactic
   * in play, or a card in the discard pile).
   */
  fromZone?: boolean;
  /**
   * Set by `deployFromZone.ignoreThreshold` — waive the printed-threshold
   * gate too ("deploy it for free even if you cannot meet its threshold";
   * I Drink Your Milkshake!).
   */
  ignoreThreshold?: boolean;
  /**
   * Set by `deployFromZone.free: false` / an unmet `free` condition — the
   * player still pays the card's printed numeric cost ("...otherwise you
   * may deploy it [paying its cost]"). Default (unset) is a free deploy.
   */
  payCost?: boolean;
}

/** "Divide N however you want among the selected cards" (see the `distributeAmong` effect). */
export interface PendingDistributeChoice {
  kind: "distributeAmong";
  id: string;
  playerId: PlayerId;
  targets: CardInstanceId[];
  amount: number;
  effects: Effect[];
  context: ResolutionContext;
}

/** "If this card would be destroyed / bounced, you may ... instead" — an optional replacement. */
export interface PendingReplacementChoice {
  kind: "replacementChoice";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  abilityId: AbilityId;
  /** The card the replacement would affect. */
  affectedCardId: CardInstanceId;
  /** What the original (un-replaced) event would be. */
  original: { event: "destroy" } | { event: "moveToZone"; zone: Zone };
  /** Costs to apply the replacement (may be empty). */
  cost: Cost[];
  label?: string;
}

/** "Name a card subtype." / "Name a card." */
export interface PendingNameValueChoice {
  kind: "nameValue";
  id: string;
  playerId: PlayerId;
  valueKind: "subtype" | "cardName" | "resourceIcon";
  /** The card instance the named value is stored on, keyed by `storeAs`. */
  sourceId: CardInstanceId;
  storeAs: string;
}

/** "Any player may pay <cost> to ..." — offered to `playerId`; on decline it advances to `remaining[0]` (see the `anyPlayerMayPay` effect). */
export interface PendingAnyPlayerMayPayChoice {
  kind: "anyPlayerMayPay";
  id: string;
  playerId: PlayerId;
  remaining: PlayerId[];
  cost: Cost[];
  effects: Effect[];
  context: ResolutionContext;
}

/** "That character's controller chooses a number for X." (see the `chooserSelectsNumber` effect). */
export interface PendingChooseNumberChoice {
  kind: "chooseNumber";
  id: string;
  playerId: PlayerId;
  storeAs: string;
  min: number;
  max: number;
  effects: Effect[];
  context: ResolutionContext;
}

/** "You may pay <cost>. If you do, the other player may. Repeat until someone doesn't." (see the `alternatingPayLoop` effect). */
export interface PendingAlternatingPayChoice {
  kind: "alternatingPay";
  id: string;
  /** Whose turn it is to decide right now. */
  playerId: PlayerId;
  /** The two players in order. */
  players: [PlayerId, PlayerId];
  /** Index into `players` of the current decider. */
  turnIndex: 0 | 1;
  cost: Cost[];
  /** Rounds still allowed before the loop force-ends. */
  roundsLeft: number;
  /** Per-player acceptance count so far. */
  tallies: Record<PlayerId, number>;
  onEnd: Effect[];
  context: ResolutionContext;
}

/** "You may pay <cost>. If you do, ..." */
export interface PendingMayPayChoice {
  kind: "mayPay";
  id: string;
  playerId: PlayerId;
  cost: Cost[];
  label?: string;
  effects: Effect[];
  elseEffects: Effect[];
  context: ResolutionContext;
}

/** "You may use one of the card's abilities." */
export interface PendingUseTargetAbilityChoice {
  kind: "useTargetAbility";
  id: string;
  playerId: PlayerId;
  /** The card whose abilities may be used. */
  targetCardId: CardInstanceId;
  /** The ids of that card's activated abilities. */
  abilityIds: AbilityId[];
  /** How many times the chosen ability's effects resolve. */
  times: number;
}

/**
 * "You may use an ability" (of any card you control) — The Poshernacle.
 * Answering with a `cardId` narrows to a follow-up `useTargetAbility`
 * choice for that card's abilities; omitting it declines.
 */
export interface PendingUseAnyAbilityChoice {
  kind: "useAnyAbility";
  id: string;
  playerId: PlayerId;
  /** In-play cards `playerId` controls that have at least one activated ability. */
  candidateCardIds: CardInstanceId[];
  context: ResolutionContext;
}

/** MUSTACHE SHOWDOWN, step 1 — `playerId` splits `cardIds` into `piles` non-empty face-down piles (see the `partitionAndPick` effect). */
export interface PendingPartitionCardsChoice {
  kind: "partitionCards";
  id: string;
  playerId: PlayerId;
  cardIds: CardInstanceId[];
  piles: number;
}

/** MUSTACHE SHOWDOWN, step 2 — `playerId` picks one of their opponent's face-down `piles` by index. */
export interface PendingPickPileChoice {
  kind: "pickPile";
  id: string;
  playerId: PlayerId;
  piles: CardInstanceId[][];
}

/** MUSTACHE SHOWDOWN, step 3 — the higher-total-cost pile's owner may move up to `max` of its `candidates` to hand. */
export interface PendingTakeFromPileChoice {
  kind: "takeFromPile";
  id: string;
  playerId: PlayerId;
  candidates: CardInstanceId[];
  max: number;
}

export type PendingChoice =
  | PendingUniqueSurvivorChoice
  | PendingTargetChoice
  | PendingTriggerOrderChoice
  | PendingChooserTargetChoice
  | PendingChooserOptionChoice
  | PendingReorderDeckChoice
  | PendingDeployForFreeChoice
  | PendingDistributeChoice
  | PendingReplacementChoice
  | PendingNameValueChoice
  | PendingChooseNumberChoice
  | PendingAlternatingPayChoice
  | PendingAnyPlayerMayPayChoice
  | PendingMayPayChoice
  | PendingUseTargetAbilityChoice
  | PendingUseAnyAbilityChoice
  | PendingPartitionCardsChoice
  | PendingPickPileChoice
  | PendingTakeFromPileChoice;
