// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { Duration, Keyword, ModifierOperation, Restriction, Stat, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";

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
      /**
       * Where in the destination when `to` is `"deck"` — `"top"` or
       * `"bottom"` (default `"bottom"`). Ignored for every other zone.
       */
      position?: "top" | "bottom";
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
      options: EffectOption[];
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
    }
  | {
      /**
       * Moves the top `count` cards of `player`'s deck to their discard pile
       * ("put the top N cards of a deck into the discard pile"). Fewer than
       * `count` in the deck: mills whatever is there. No reshuffle.
       */
      type: "mill";
      player: PlayerRef;
      count: NumberExpression;
    }
  | {
      /**
       * Evaluates `value` immediately and stores it in
       * `ResolutionContext.variables[id]`, so later effects in the same
       * ability can read it via `{ type: "variable", id }` even after the
       * card it was derived from has left play — "X is that character's
       * strength" captured before a `destroy` in the same effect list.
       */
      type: "bind";
      id: string;
      value: NumberExpression;
    }
  | {
      /**
       * Removes a still-unresolved card/ability from the response stack
       * ("terminate" / "counter"). A terminated card goes to its owner's
       * discard without its effects resolving; a terminated ability is
       * dropped. No-op if the target isn't on the stack.
       *
       * - `scope: "target"` (default) — terminate the stack item whose
       *   source card is `target` (e.g. `"eventCard"`, the card just played).
       * - `scope: "othersOnStack"` — terminate every remaining stack item
       *   ("all other unresolved cards are terminated"); `target` ignored.
       */
      type: "terminate";
      scope?: "target" | "othersOnStack";
      target?: TargetRef;
    }
  | {
      /**
       * Sets (or with `value: false`, clears) `CardInstance.restoreLocked` —
       * "characters depleted by this card cannot be restored by their
       * controller's faction's restore rule". Pair with a `deplete` effect
       * on the same target. Cleared automatically when the card leaves play.
       */
      type: "setRestoreLock";
      target: TargetRef;
      value?: boolean;
    }
  | {
      /**
       * Sets `target`'s accumulated damage to `amount` (clamped >= 0) —
       * "reduce the amount of damage already inflicted to this character to
       * 0". Distinct from healing via a life modifier.
       */
      type: "setDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Pulls `target` out of the current battle's attacking/blocking party
       * ("remove it from battle"). No-op if there's no battle or the card
       * isn't in it.
       */
      type: "removeFromBattle";
      target: TargetRef;
    }
  | {
      /**
       * Resolves `effects` once per player, in turn order starting from the
       * active player (or `order: "startingWith"` + `player`), rebinding
       * `controller`/`owner` to that player. "Each player may draw a card
       * or play a resource." Nested chooser effects pause per player, the
       * same as anywhere else.
       */
      type: "forEachPlayer";
      effects: Effect[];
    }
  | {
      /**
       * Pauses for `chooser` to name a value from a closed vocabulary
       * (`kind: "subtype"` — any card subtype; `kind: "cardName"` — any
       * card name in the game). The chosen string is stored on the source
       * card instance under `counters`-adjacent `namedValues[storeAs]` and
       * read back by a `CardSelector.subtypeVar` / conditions.
       */
      type: "nameValue";
      chooser: PlayerRef;
      valueKind: "subtype" | "cardName";
      storeAs: string;
    }
  | {
      /**
       * "You may pay <costs>. If you do, <effects>; otherwise
       * <elseEffects>." Pauses for `player` to accept or decline; declines
       * (or can't afford) fall through to `elseEffects`.
       */
      type: "mayPay";
      player: PlayerRef;
      costs: Cost[];
      effects: Effect[];
      elseEffects?: Effect[];
    }
  | {
      /**
       * Puts `count` token permanents into play under `controller` — cards
       * with no deck backing that cease to exist on leaving play. `token`
       * is a minimal inline definition (name + type + optional stats /
       * subtype).
       */
      type: "createTokens";
      controller: PlayerRef;
      count: NumberExpression;
      token: TokenSpec;
    }
  | {
      /**
       * Activates one of `target`'s own activated abilities as a nested
       * sub-resolution (chosen by `chooser`), optionally resolving its
       * effects twice. "You may use one of the card's abilities. If you do,
       * the effect happens twice instead of once."
       */
      type: "useTargetAbility";
      chooser: PlayerRef;
      target: TargetRef;
      times?: number;
    };

/**
 * One branch of a `chooserSelectsOption` effect. `label` is an optional,
 * game-agnostic human-readable description of what picking this branch
 * does (e.g. "Put a token on this card") — a renderer has no other way to
 * turn a bare `Effect[]` into UI copy, since effects are structured data,
 * not text. Card-authored branches without a meaningful description (e.g.
 * "decline" as an empty `effects: []`) may omit it.
 */
export interface EffectOption {
  label?: string;
  effects: Effect[];
}

/**
 * A continuous ability's stat modifier. Set **either** `target` (a single
 * `TargetRef`, e.g. `"attachedTo"` or `{ type: "selected", id: "target" }`)
 * **or** `selector` (an aura: applies to *every* in-play card matching it,
 * recomputed live — "all your characters lose 1 strength", "every character
 * loses life equal to its printed life minus 2"). With `selector`, `value`
 * is evaluated per affected card with that card bound to
 * `{ type: "selected", id: "__candidate" }`, so per-target derived amounts
 * (`printedStat`/`stat` of `__candidate`) work.
 */
/** A minimal inline card definition for a token permanent (see `createTokens`). */
export interface TokenSpec {
  name: string;
  cardType: "character" | "item" | "location";
  subtype?: string[];
  strength?: number;
  life?: number;
  speed?: number;
  /** For a location token. */
  structure?: number;
}

export interface ModifierDefinition {
  target?: TargetRef;
  selector?: CardSelector;
  stat: Stat;
  operation: ModifierOperation;
  value: NumberExpression;
}

export interface KeywordGrantDefinition {
  target?: TargetRef;
  /** Aura form — grant to every in-play card matching this (see ModifierDefinition). */
  selector?: CardSelector;
  keyword: Keyword;
}

export interface RestrictionGrantDefinition {
  target?: TargetRef;
  /** Aura form — grant to every in-play card matching this (see ModifierDefinition). */
  selector?: CardSelector;
  restriction: Restriction;
}

/**
 * A continuous ability's effect on how much it costs to deploy a card —
 * "your opponents must pay 1 more to deploy a tactic", "reduce the numeric
 * cost of characters you play by 2, to a minimum of 1". Recomputed live
 * while the source is in play; feeds both `getCardPlayability` and the
 * actual payment in `playCard`.
 */
export interface CostModifierDefinition {
  /** Whose deploys this affects (`controller` = the source's controller). */
  affects: PlayerRef;
  /** Added to the printed numeric cost — negative discounts, positive taxes. */
  delta: NumberExpression;
  /** The modified cost can't drop below this (default 0). */
  minCost?: number;
  /**
   * Which cards this applies to, matched against the card being deployed.
   * Omit for "any card". Don't constrain `zone` (the card is in hand) —
   * use `type` / `subtype` / `conditions` (`cardTradeIs`, etc.).
   */
  selector?: CardSelector;
}

/**
 * A continuous ability's adjustment to damage amounts as they're inflicted —
 * "when battle damage is inflicted to a character you control, reduce the
 * amount by 2". Applied in `dealDamage`; not a replacement effect (it tunes
 * an amount, it can't cancel).
 */
export interface DamageModifierDefinition {
  /** Match the card being damaged. Omit `zone` (it's in play by definition). */
  selector: CardSelector;
  /** Only battle damage, or all damage. Default: all. */
  battleOnly?: boolean;
  /** Added to each incoming damage amount — negative reduces. Floors the amount at 0. */
  delta: NumberExpression;
}
