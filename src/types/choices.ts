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

export type PendingChoice =
  | PendingUniqueSurvivorChoice
  | PendingTargetChoice
  | PendingTriggerOrderChoice;
