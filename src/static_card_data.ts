import { CardDefinitionId, CardType, AbilityId } from "./ids_primitives.js";
import { GameEventType } from "./events.js";
import { Effect, ModifierDefinition } from "./Effect.js";
import { Cost } from "./Cost.js";
import { Condition } from "./Condition.js";
import { TargetDeclaration } from "./references_expressions_selectors.js";

// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

export interface Threshold {
  rage?: number;
  greed?: number;
  deception?: number;
  elitism?: number;
  obsession?: number;
}

export interface CardStats {
  strength?: number;
  life?: number;
  speed?: number;
  influence?: number;
}

export interface CardDefinition {
  id: CardDefinitionId;
  name: string;
  type: CardType;
  subtypes?: string[];

  cost?: number;
  threshold?: Threshold;
  stats?: CardStats;

  abilities?: AbilityDefinition[];
}

export type AbilityDefinition =
  ActivatedAbility | TriggeredAbility | ContinuousAbility;

export interface AbilityBase {
  id: AbilityId;
  name?: string;
}

export interface ActivatedAbility extends AbilityBase {
  type: "activated";
  condition?: Condition;
  costs?: Cost[];
  targets?: TargetDeclaration[];
  effects: Effect[];
}

export interface TriggeredAbility extends AbilityBase {
  type: "triggered";
  event: GameEventType;
  condition?: Condition;
  targets?: TargetDeclaration[];
  effects: Effect[];
}

export interface ContinuousAbility extends AbilityBase {
  type: "continuous";
  condition?: Condition;
  modifiers: ModifierDefinition[];
}
