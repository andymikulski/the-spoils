import { Effect } from "./Effect.js";
import { GameEvent } from "./events.js";
import { CardInstanceId, PlayerId, AbilityId } from "./ids_primitives.js";
import { TriggeredAbility } from "./static_card_data.js";

// -----------------------------------------------------------------------------
// Resolution context
// -----------------------------------------------------------------------------

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
