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
  | { type: "player"; id: PlayerId }
  /** The owner of a targeted card (e.g. "any one deck" — the caster picks a faction card, this resolves to that player). */
  | { type: "ownerOf"; target: TargetRef };

export type TargetRef =
  | "source"
  /** The card `source` is currently attached to ("Attach to X"), if any. */
  | "attachedTo"
  /**
   * The card most relevant to the current triggering event (same mapping
   * `sourceIsEventCard` compares against — e.g. the *target* for
   * `damageDealt`). Lets a condition inspect that card's own properties
   * (e.g. `cardTypeIs` to check "damage to a faction"), not just test
   * equality with `source`.
   */
  | "eventCard"
  | { type: "selected"; id: string }
  | { type: "card"; id: CardInstanceId }
  /** A uniformly random card matching `selector` (e.g. "discard a card at random"), or nothing if none match. */
  | { type: "random"; selector: CardSelector };

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
    }
  | {
      /**
       * A player-chosen numeric variable ("choose a number for X"), read
       * from `ResolutionContext.variables[id]`. Reads as 0 if never
       * assigned (RULES.md §12).
       */
      type: "variable";
      id: string;
    }
  | {
      /** A uniformly random integer in [min, max] (inclusive), e.g. a coin flip is `{ min: 1, max: 2 }`. */
      type: "random";
      min: NumberExpression;
      max: NumberExpression;
    }
  | {
      /** A card's printed numeric cost (`CardDefinition.cost`) — not a runtime `Stat`, so `stat` can't reach it. */
      type: "cardCost";
      target: TargetRef;
    }
  | {
      /** `value / by`, rounded per `rounding` (e.g. "half its numeric cost, rounded up" is `{ value: ..., by: 2, rounding: "up" }`). Division by 0 reads as 0. */
      type: "divide";
      value: NumberExpression;
      by: NumberExpression;
      rounding: "up" | "down";
    }
  | {
      /** `value % by` (always >= 0). Division by 0 reads as 0. Useful for parity, e.g. "an even number of cards" is `{ type: "numberCompare", left: { type: "modulo", value: ..., by: 2 }, operator: "=", right: 0 }`. */
      type: "modulo";
      value: NumberExpression;
      by: NumberExpression;
    }
  | {
      /** The number of cards currently bound under `ResolutionContext.selected[id]` — e.g. "X is the number of characters you depleted this way." Reads as 0 if `id` was never bound. */
      type: "selectionCount";
      id: string;
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
  /**
   * The maximum number of selections (may be a variable, e.g. a
   * `NumberExpression` tied to a coin flip — "pick X or fewer"). Without
   * `optional`, this is also the exact required count.
   */
  count: NumberExpression;
  /**
   * "You may pick..." / "N or fewer" — relaxes the requirement to
   * *between 0 and `count`* selections (inclusive) instead of exactly
   * `count`. Whenever at least one legal candidate exists, this always
   * requires a real decision (a `selectTargets` pending choice for
   * triggered abilities; an explicit `selected[id]: []`/fewer-than-count
   * array in the action for playCard/activateAbility) — it is never
   * auto-decided just because it happens to be unambiguous, the way a
   * mandatory declaration is. Gate effects that only happen "if you
   * picked at least one" with `{ type: "if", condition: { type:
   * "targetExists", target: ... } }` (checks the first selection, if any).
   */
  optional?: boolean;
}
