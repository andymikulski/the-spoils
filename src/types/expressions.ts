// -----------------------------------------------------------------------------
// References / expressions / selectors
// -----------------------------------------------------------------------------

import type { CardInstanceId, CardType, PlayerId, Stat, Zone } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { ResourceIcon } from "./cards.js";

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
  | { type: "random"; selector: CardSelector }
  /**
   * A card at a fixed position in a deck — `index` from the `top` or
   * `bottom` (default `index` 0, i.e. "the top card of your deck").
   * Resolves to nothing if the deck is too short. Pair with `cardCost` for
   * "gains strength equal to the numeric cost of the top card of your
   * deck", or use it as a `moveCard`/`destroy` target.
   */
  | { type: "deckPosition"; player: PlayerRef; from: "top" | "bottom"; index?: number }
  /**
   * The card being responded to — the newest `kind: "card"` item on the
   * response stack that isn't the source of the current ability. `undefined`
   * outside a response window. Pairs with the `respondingTo` condition.
   */
  | { type: "respondedToCard" }
  /** A player's faction card instance — "attach it to that player's faction". */
  | { type: "factionOf"; player: PlayerRef };

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
      /**
       * A card's printed BASE stat (`CardDefinition.strength/life/speed/
       * influence/structure`), before any runtime modifier — parallel to
       * `cardCost`, and distinct from `stat` (which is the live value). Reads
       * as 0 if the definition doesn't carry that stat. E.g. "loses life
       * equal to its printed life minus 2".
       */
      type: "printedStat";
      target: TargetRef;
      stat: Stat;
    }
  | {
      /**
       * How many of a given resource `icon` `player` controls in play — the
       * sum of `getResourceIcons` over their in-play resources (face-up
       * printed icons, plus Volition for each face-down resource). Also the
       * idiom for "while you control at least [X][X]" gates, via
       * `numberCompare` against a literal.
       */
      type: "resourceIcons";
      player: PlayerRef;
      icon: ResourceIcon;
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
    }
  | {
      /**
       * `then` when `if` holds, otherwise `else` — "X is 4 if you deployed
       * this card using FLIP UP, otherwise 2".
       */
      type: "conditional";
      if: Condition;
      then: NumberExpression;
      else: NumberExpression;
    };

export interface CardSelector {
  controller?: "self" | "opponent" | "any";
  owner?: "self" | "opponent" | "any";

  zone?: Zone | Zone[];
  type?: CardType;
  subtype?: string;
  /**
   * Match cards whose subtype list contains the string a `nameValue` effect
   * stored on the source card under this key ("cards with the named
   * subtype"). Takes precedence over `subtype` when both are set.
   */
  subtypeVar?: string;

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
