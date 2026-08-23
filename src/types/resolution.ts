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
}

export interface TriggerResolution {
  sourceId: CardInstanceId;
  ability: TriggeredAbility;
  context: ResolutionContext;
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
