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

import type { AbilityId, CardInstanceId, PlayerId } from "./ids.js";
import type { TargetDeclaration } from "./expressions.js";
import type { Effect } from "./effects.js";
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
  /** The triggers that fired at once and need a resolution order (RULES.md §7). */
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

/** "An opponent chooses one of the following effects" — `chooser` picks one of `options` to resolve in full (see the `chooserSelectsOption` effect). */
export interface PendingChooserOptionChoice {
  kind: "chooserSelectsOption";
  id: string;
  playerId: PlayerId;
  optionCount: number;
  options: Effect[][];
  context: ResolutionContext;
}

/** "Look at the top N cards... put them back in any order" (see the `lookAndReorder` effect). */
export interface PendingReorderDeckChoice {
  kind: "reorderDeck";
  id: string;
  playerId: PlayerId;
  /** The cards being looked at, in their current top-to-bottom order. */
  cardIds: CardInstanceId[];
}

/** "You may deploy a card with cost X or less for free" (see the `deployForFree` effect). */
export interface PendingDeployForFreeChoice {
  kind: "deployForFree";
  id: string;
  playerId: PlayerId;
  /** Legal hand cards (matching maxCost/selector) at the moment this paused. */
  candidates: CardInstanceId[];
  context: ResolutionContext;
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

export type PendingChoice =
  | PendingUniqueSurvivorChoice
  | PendingTargetChoice
  | PendingTriggerOrderChoice
  | PendingChooserTargetChoice
  | PendingChooserOptionChoice
  | PendingReorderDeckChoice
  | PendingDeployForFreeChoice
  | PendingDistributeChoice;
