// -----------------------------------------------------------------------------
// References / expressions / selectors
// -----------------------------------------------------------------------------

import type { CardInstanceId, CardType, PlayerId, Stat, Zone } from "./ids.js";
import type { Condition } from "./conditions.js";

export type PlayerRef =
  | "controller"
  | "owner"
  | "activePlayer"
  | "opponent"
  | { type: "player"; id: PlayerId };

export type TargetRef =
  | "source"
  | { type: "selected"; id: string }
  | { type: "card"; id: CardInstanceId };

export type NumberExpression =
  | number
  | {
      type: "stat";
      target: TargetRef;
      stat: Stat;
    }
  | {
      type: "counter";
      target: TargetRef;
      counter: string;
    }
  | {
      type: "count";
      selector: CardSelector;
    }
  | {
      type: "add";
      values: NumberExpression[];
    }
  | {
      type: "multiply";
      values: NumberExpression[];
    };

export interface CardSelector {
  controller?: "self" | "opponent" | "any";
  owner?: "self" | "opponent" | "any";

  zone?: Zone | Zone[];
  type?: CardType;
  subtype?: string;

  depleted?: boolean;

  conditions?: Condition[];
}

export interface TargetDeclaration {
  id: string;
  selector: CardSelector;
  count: number;
}
