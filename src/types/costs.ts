// -----------------------------------------------------------------------------
// Costs
// -----------------------------------------------------------------------------

import type { CardSelector, NumberExpression, PlayerRef, TargetRef } from "./expressions.js";

export type Cost =
  | {
      type: "payResources";
      amount: NumberExpression;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "discard";
      player: PlayerRef;
      selector: CardSelector;
      count: number;
    }
  | {
      type: "destroy";
      target: TargetRef;
    };
