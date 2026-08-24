// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { Duration, Keyword, ModifierOperation, Restriction, Stat, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
import type { Condition } from "./conditions.js";

export type Effect =
  | {
      type: "draw";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Play a selected card as a resource. "auto" plays actual resource
       * cards face-up and all other cards face-down.
       */
      type: "playResource";
      target: TargetRef;
      faceDown: boolean | "auto";
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
    }
  | {
      /** Changes who controls an in-play card (e.g. "take control of the location"). */
      type: "takeControl";
      target: TargetRef;
      controller: PlayerRef;
    }
  | {
      /** "Remove from the game" (RULES.md §2) — permanent, unlike moveCard to any tracked zone. */
      type: "removeFromGame";
      target: TargetRef;
    }
  | {
      /**
       * Resolves `effects` once per card matching `selector` (e.g. "your
       * characters gain 1 strength", "inflict 2 damage to all characters").
       * Every `TargetRef` inside `effects` should reference the current
       * card via `{ type: "selected", id: "__candidate" }` — the same
       * binding `CardSelector.conditions` uses. The match set is snapshotted
       * once up front, not re-queried per iteration, so an earlier
       * iteration destroying/moving a card can't shrink who else is hit.
       */
      type: "forEach";
      /** Exactly one of `selector`/`selected` must be set. */
      selector?: CardSelector;
      /** Iterate the cards already selected under this TargetDeclaration id instead of re-querying a selector — e.g. "destroy the items" after "pick 2 or fewer items." */
      selected?: string;
      effects: Effect[];
    }
  | {
      /**
       * Re-attaches an already-in-play "Attach to X" card to a new target
       * (e.g. an item's "HANDOFF" ability). Playing a card for the first
       * time still attaches it via its `attachTo` field + the play-time
       * target declaration — this effect is only for moving an existing
       * attachment. `checkStateBasedActions` destroys the moved card if
       * `to` isn't a legal in-play target of the card's `attachTo` type, so
       * this effect doesn't need to validate that itself.
       */
      type: "attachTo";
      target: TargetRef;
      to: TargetRef;
    }
  | {
      /**
       * Grants `keyword` to `target` for `duration` (e.g. "this turn, the
       * character gains COVERT"). For a keyword granted *while a condition
       * holds* (e.g. "the attached character gains COVERT" for as long as
       * it's attached), use `ContinuousAbility.keywords` instead — that's
       * recomputed live like `modifiers`, not stored with an expiry.
       */
      type: "grantKeyword";
      target: TargetRef;
      keyword: Keyword;
      duration: Duration;
    }
  | {
      /** Same shape as `grantKeyword`, for boolean combat restrictions (e.g. "this turn, the character cannot attack"). */
      type: "grantRestriction";
      target: TargetRef;
      restriction: Restriction;
      duration: Duration;
    }
  | {
      /**
       * Resolves `effects` only if `condition` holds — the "if you do" half
       * of an optional `TargetDeclaration` ("you may pick a character. If
       * you do, ..."): gate with `{ type: "targetExists", target: {
       * type: "selected", id: "<declarationId>" } }`.
       */
      type: "if";
      condition: Condition;
      effects: Effect[];
    }
  | {
      /** "Reshuffle" (RULES.md §2) — shuffles `player`'s deck in place. */
      type: "shuffleDeck";
      player: PlayerRef;
    }
  | {
      /**
       * Pauses ability resolution for `chooser` (not necessarily this
       * ability's controller) to pick a target matching `declaration`'s
       * selector, then resolves `effects` — reference the choice via
       * `{ type: "selected", id: declaration.id }`. E.g. "an opponent
       * discards a card" is `chooser: "opponent"`, a hand-zone declaration,
       * and a `moveCard` to `"discard"`.
       */
      type: "chooserSelectsTarget";
      chooser: PlayerRef;
      declaration: TargetDeclaration;
      effects: Effect[];
    }
  | {
      /**
       * Pauses ability resolution for `chooser` to pick exactly one of
       * `options` to resolve in full (the rest are skipped entirely). E.g.
       * "an opponent chooses one of the following effects."
       */
      type: "chooserSelectsOption";
      chooser: PlayerRef;
      options: Effect[][];
    }
  | {
      /**
       * Pauses ability resolution for `player` to reorder the top `count`
       * cards of their own deck however they like ("look at the top N
       * cards... put them back in any order"). A no-op if the deck has
       * fewer than `count` cards — reorders whatever's actually there.
       */
      type: "lookAndReorder";
      player: PlayerRef;
      count: NumberExpression;
    }
  | {
      /**
       * Reduces the numeric cost of the next card `player` deploys this
       * turn by `amount` (floored at 0), consumed by exactly one
       * subsequent `playCard` — "reduce the next numeric cost you pay this
       * turn by N." Unused reductions expire at end of turn.
       */
      type: "reduceNextCost";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Pauses ability resolution for `player` to pick a card from their
       * hand matching `selector` with printed cost <= `maxCost` (evaluated
       * once, at the time this effect resolves) and deploy it immediately
       * without paying its numeric cost — "you may deploy a non-resource
       * card with numeric cost X or less for free." Threshold and any
       * non-numeric extra costs (targets, deplete, etc.) still apply. The
       * deployed card resolves synchronously as part of this effect (like
       * any other nested consequence of an ability, e.g. `forEach`) rather
       * than opening its own response window.
       */
      type: "deployForFree";
      player: PlayerRef;
      maxCost: NumberExpression;
      selector?: CardSelector;
    }
  | {
      /**
       * Pauses ability resolution for `chooser` to divide `amount` however
       * they like among the cards already selected under `selected` (a
       * TargetDeclaration id) — "divide up to 2 damage however you want
       * among the characters." Resolves `effects` once per card that
       * received a nonzero share, with that card bound to `{ type:
       * "selected", id: "__candidate" }` and its share bound to `{ type:
       * "variable", id: "__amount" }`.
       */
      type: "distributeAmong";
      chooser: PlayerRef;
      selected: string;
      amount: NumberExpression;
      effects: Effect[];
    };

export interface ModifierDefinition {
  target: TargetRef;
  stat: Stat;
  operation: ModifierOperation;
  value: NumberExpression;
}

export interface KeywordGrantDefinition {
  target: TargetRef;
  keyword: Keyword;
}

export interface RestrictionGrantDefinition {
  target: TargetRef;
  restriction: Restriction;
}
