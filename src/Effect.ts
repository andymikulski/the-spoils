import { Zone, Stat, ModifierOperation, Duration } from "./ids_primitives.js";
import {
  PlayerRef,
  NumberExpression,
  TargetRef,
} from "./references_expressions_selectors.js";

// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

export type Effect =
  | {
      type: "draw";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      type: "modifyInfluence";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "moveCard";
      target: TargetRef;
      to: Zone;
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "restore";
      target: TargetRef;
    }
  | {
      type: "addCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "createModifier";
      target: TargetRef;
      stat: Stat;
      operation: ModifierOperation;
      value: NumberExpression;
      duration: Duration;
    };

export interface ModifierDefinition {
  target: TargetRef;
  stat: Stat;
  operation: ModifierOperation;
  value: NumberExpression;
}
