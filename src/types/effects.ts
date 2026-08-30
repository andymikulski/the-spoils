// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { CardType, Duration, Keyword, ModifierOperation, Restriction, Stat, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { ResourceIcon } from "./cards.js";

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
       * Flip an in-play card face-down under its OWNER's control. Per
       * RULES.md §2 (CR §411.3 / §411.4) the flip counts as the card
       * *leaving play* and *a brand-new card entering play* — accumulated
       * damage, counters, attachments, temporary modifiers/keywords/
       * restrictions and named values are all cleared; the result is a
       * face-down resource providing one Volition. "Leaves play" triggers
       * fire. No-op if `target` doesn't resolve to a card in play. Used
       * both directly ("flip the character face-down under its owner's
       * control") and as a "would be destroyed → flip it face-down
       * instead" replacement (bind `target` to `{ type: "selected", id:
       * "__candidate" }` there).
       */
      type: "flipFaceDown";
      target: TargetRef;
    }
  | {
      /**
       * Move a card from deck / discard / void INTO play as its real type,
       * running the normal entrance bookkeeping (`cardEnteredPlay`, the
       * attach-target requirement, attack eligibility). `faceDown: true`
       * puts it into play as an anonymous face-down resource instead. "Put
       * the card into play under your control [as a face-down resource]."
       */
      type: "putIntoPlay";
      target: TargetRef;
      controller: PlayerRef;
      faceDown?: boolean;
    }
  | {
      /**
       * "You may deploy the <card>" — deploy an already-picked card that is
       * NOT in hand (a face-down permanent/tactic in play; a card in the
       * discard pile) as its real type, waiving only its numeric cost.
       * Threshold and any non-numeric EXTRA COSTs still apply (unless
       * `ignoreThreshold`) — the player supplies the sub-card's own picks
       * when the pending `deployForFree` choice pauses. Compose with
       * `mayPay` (empty `costs`) for the "you may" prompt. Manifest /
       * Hidden Ruins / Accidental Invention / Burly Assailment (a revealed
       * face-down card), Dark Awakening (a card in your discard pile).
       */
      type: "deployFromZone";
      player: PlayerRef;
      target: TargetRef;
      /** "deploy it for free even if you cannot meet its threshold" (I Drink Your Milkshake!). */
      ignoreThreshold?: boolean;
    }
  | {
      /**
       * Adds `amount` phantom `icon` resource-icons to `player`'s threshold
       * count for `duration` — "This turn, you control an additional
       * [E][E][E][E]." (31337!). Read by `getThresholds` / the
       * `resourceIcons` expression; cleaned up like `modifiers`.
       */
      type: "grantResourceIcons";
      player: PlayerRef;
      icon: ResourceIcon;
      amount: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * Clears `target`'s attachment — a resource stops being attached to a
       * faction ("detach it from your faction"; Braggadocian Aide), or an
       * "Attach to X" item is left unattached (and cleaned up by the
       * state-based check). No-op if `target` isn't attached to anything.
       */
      type: "detach";
      target: TargetRef;
    }
  | {
      /**
       * Registers a runtime damage "shield" on `target`, consumed as
       * damage is inflicted to it this turn (expires at the next
       * start-of-turn if unused). `mode: "reduce"` absorbs up to `amount`
       * points ("Reduce the next damage inflicted to the character this
       * turn by 2" — Tiny Shiny). `mode: "redirect"` sends up to `amount`
       * of the next damage to `redirectTo` instead ("The next X damage
       * that would be inflicted to the first picked card this turn is
       * inflicted to the second picked card instead" — Delectable Boon).
       * Redirected damage lands raw (no further modifiers/shields on the
       * redirect target).
       */
      type: "preventDamage";
      target: TargetRef;
      amount: NumberExpression;
      mode: "reduce" | "redirect";
      redirectTo?: TargetRef;
    }
  | {
      /**
       * Registers a one-shot delayed effect fired at the next `endOfTurn`
       * (the current turn's end) or `startOfNextTurn` (the source
       * controller's next turn), then discarded. `condition`, if set, is
       * checked at fire time. "At the start of your next turn, if this card
       * is in play, put the voided character into play." (Gilded Yurt);
       * "At the end of the turn, ..." (Vast Mastabatorium). A chooser
       * effect inside `effects` is not supported — keep the delayed
       * effects self-resolving.
       */
      type: "scheduleEffect";
      when: "startOfNextTurn" | "endOfTurn";
      condition?: Condition;
      effects: Effect[];
    }
  | {
      /**
       * "You may use an ability" — pauses for `chooser` to pick one of
       * their in-play cards (matching `selector`, default: any card they
       * control) and then one of its activated abilities, resolved as a
       * nested sub-resolution. Generalises `useTargetAbility` (which needs
       * a fixed `target`). The Poshernacle.
       */
      type: "useAnyAbility";
      chooser: PlayerRef;
      selector?: CardSelector;
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
       * Moves the top `count` cards of `player`'s deck to `to` (default
       * `"discard"`; `"removed"` for "remove the top N cards of their deck
       * from the game"). Fewer than `count` in the deck: whatever's there.
       * No reshuffle.
       */
      type: "mill";
      player: PlayerRef;
      count: NumberExpression;
      to?: "discard" | "removed";
    }
  | {
      /**
       * Store `target`'s card id on `source`'s `linkedTargets[key]` — an
       * EXTRA-COST pick a later continuous ability keys off ("pick a
       * location you control; while THAT location is in play, this card
       * cannot attack or block"). Read back via the `{ type: "remembered",
       * key }` TargetRef or the `linkedCardInPlay` condition. Cleared on
       * leaving play.
       */
      type: "rememberTarget";
      key: string;
      target: TargetRef;
    }
  | {
      /**
       * "Duplicate the tactic." Resolve a copy of `target` (a tactic on the
       * response stack) under the current ability's controller, reusing the
       * original's already-made selections (RULES.md §12). No transient
       * card instance is created. Muddle.
       */
      type: "duplicate";
      target: TargetRef;
    }
  | {
      /**
       * The MUSTACHE SHOWDOWN primitive (Mustache Aficionado). `controller`
       * and their `opponent` each reveal the top `count` cards of their own
       * deck and split them into `piles` face-down piles (>= 1 card each);
       * each then picks one of the OTHER player's piles; the two chosen
       * piles are revealed and their total `compareBy` (`"cost"`) compared.
       * If one is strictly higher, that pile's OWNER may move up to
       * `winnerTakes` of its cards to hand. Every card not taken stays in
       * its owner's deck, which is then shuffled. Pauses on `partitionCards`
       * → `pickPile` → (`takeFromPile`) pending choices, one player at a
       * time. No-op if either player has fewer than `piles` cards to
       * reveal. See RULES.md §12.
       */
      type: "partitionAndPick";
      count: number;
      piles: number;
      compareBy: "cost";
      winnerTakes: number;
    }
  | {
      /**
       * "... its effect happens as though your opponent had picked the
       * other character instead." (Mistaken Identity). Rewrites the
       * responded-to stack item's stored EXTRA-COST pick: the in-play card
       * of `cardType` it selected is swapped for `to` everywhere it appears
       * under that item's `context.selected`, so the item resolves against
       * the new pick. No-op if there is no responded-to item, it holds no
       * such pick, or `to` is that same card. See RULES.md §7.
       */
      type: "retargetExtraCost";
      cardType: CardType;
      to: TargetRef;
    }
  | {
      /**
       * "This turn, the <card> is a <cardType> ..." (RULES.md §3.7 /
       * CR §208). For `duration`, `target` GAINS `cardType` — it keeps its
       * printed type too (CR §208.1: a card may hold several types at once;
       * §208.1a: gaining one keeps the rest). `hasCardType` /
       * `getCardTypes`, and everything keyed off them (typed selectors, the
       * lethal-damage / attach state-based checks, battle legality, the
       * `cardTypeIs` condition), see the added type. `grantStats`, if set,
       * apply as `set` stat modifiers with the same duration and source
       * (each value a `NumberExpression`, evaluated once now — e.g.
       * "strength and life equal to its numeric cost and 3 speed" is
       * `{ strength: {type:"cardCost",target}, life: {type:"cardCost",
       * target}, speed: 3 }`). When the grant ends and the card thereby
       * stops being a character it forgets the damage it took this turn
       * (CR §208.3, handled at start-of-turn) and is pulled from any battle
       * it is in (CR §208.4, via the state-based check). Contrabulous
       * Fabtraption — RUNE OF ANIMATION.
       */
      type: "setCardType";
      target: TargetRef;
      cardType: CardType;
      grantStats?: Partial<Record<Stat, NumberExpression>>;
      duration: Duration;
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
       * - `scope: "respondedItem"` — terminate the newest unresolved
       *   non-self stack item, whatever its kind ("Terminate the ability" —
       *   Cock Block); `target` ignored.
       */
      type: "terminate";
      scope?: "target" | "othersOnStack" | "respondedItem";
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
