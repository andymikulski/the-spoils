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
      /** Referenced via ResolutionContext.selected[id], same as a target declaration. */
      id: string;
      player: PlayerRef;
      selector: CardSelector;
      count: number;
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      /**
       * "Remove N tokens from this card" as a cost (e.g. an EJECT-style
       * ability). Unlike the `removeCounter` *effect* (RULES.md §12:
       * post-commitment resolution clamps to what's actually there), a cost
       * must be fully payable or the whole activation fails — this throws
       * if the card doesn't have `amount` counters to remove.
       */
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      /**
       * Depletes every card already selected under `declarationId` (a
       * TargetDeclaration whose `count` may be variable/plural) — "deplete
       * X characters you control" as a cost. All-or-nothing like any other
       * cost: throws (nothing depleted) if any of them is already
       * depleted, rather than partially paying.
       */
      type: "depleteSelected";
      declarationId: string;
    };
