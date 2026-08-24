// -----------------------------------------------------------------------------
// Resolution context
// -----------------------------------------------------------------------------

import type { AbilityId, CardInstanceId, PlayerId } from "./ids.js";
import type { GameEvent } from "./events.js";
import type { TriggeredAbility } from "./cards.js";
import type { Effect } from "./effects.js";

export interface ResolutionContext {
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  abilityId?: AbilityId;

  event?: GameEvent;

  selected: Record<string, CardInstanceId[]>;

  /** Player-chosen numeric variables ("choose a number for X"), keyed by id. Unassigned reads as 0. */
  variables?: Record<string, number>;
}

export interface TriggerResolution {
  sourceId: CardInstanceId;
  ability: TriggeredAbility;
  context: ResolutionContext;
  /**
   * Shared by every trigger found for the same emitted event (RULES.md §7:
   * "triggers occurring at once"). Reassigned to a fresh, unshared value
   * once an orderTriggers pending choice has settled that batch's order, so
   * it isn't re-detected as needing another ordering decision.
   */
  batchId: string;
}

export interface StackItem {
  id: string;

  sourceId: CardInstanceId;
  controllerId: PlayerId;

  kind: "card" | "ability";

  abilityId?: AbilityId;
  effects: Effect[];

  context: ResolutionContext;
}
