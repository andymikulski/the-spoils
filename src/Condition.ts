import { Zone, CardType, Stat, ComparisonOperator } from "./ids_primitives.js";
import {
  PlayerRef,
  TargetRef,
  NumberExpression,
} from "./references_expressions_selectors.js";

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

export type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] }
  | { type: "not"; condition: Condition }
  | { type: "sourceInZone"; zone: Zone }
  | { type: "sourceIsEventCard" }
  | { type: "eventCardControlledBy"; player: PlayerRef }
  | { type: "targetExists"; target: TargetRef }
  | {
      type: "cardTypeIs";
      target: TargetRef;
      cardType: CardType;
    }
  | {
      type: "statCompare";
      target: TargetRef;
      stat: Stat;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      type: "counterCompare";
      target: TargetRef;
      counter: string;
      operator: ComparisonOperator;
      value: NumberExpression;
    };
