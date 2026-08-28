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
    }
  | {
      /**
       * "Remove <target> from the game" as a cost — typically `"source"`
       * (e.g. a RECUR ability that exiles itself from the discard pile).
       * Throws if `target` doesn't resolve to a real card, like the other
       * card-consuming costs.
       */
      type: "removeFromGame";
      target: TargetRef;
    }
  | {
      /**
       * Consumes every card already selected under `declarationId` by the
       * given `disposition` — "remove X tactics in your discard pile from
       * the game" as a cost. All-or-nothing.
       */
      type: "sacrificeSelected";
      declarationId: string;
      disposition: "removeFromGame" | "destroy" | "discard";
    }
  | {
      /**
       * "Inflict N damage to <target>" as a cost — typically `"source"`, for
       * a location that spends its own structure to activate an ability
       * (e.g. "Inflict 1 damage to this location. If you do, ..."). Always
       * payable (a card can always take damage); the resulting destruction,
       * if any, is handled by the normal state-based check after the
       * ability resolves.
       */
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    };
