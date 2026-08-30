// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

import type { CardType, ComparisonOperator, Stat, Trade, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetRef } from "./expressions.js";
import type { ResourceIcon } from "./cards.js";

export type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] }
  | { type: "not"; condition: Condition }
  | { type: "sourceInZone"; zone: Zone }
  | { type: "sourceIsEventCard" }
  | { type: "eventCardControlledBy"; player: PlayerRef }
  | { type: "targetExists"; target: TargetRef }
  | {
      type: "cardTypeIs";
      target: TargetRef;
      cardType: CardType;
    }
  | {
      /**
       * True when `target`'s printed `trade` equals `trade`. `CardSelector`
       * has no positive-trade filter and no exclusion list, so compose with
       * `not` for "a non-Rogue character" (bind `target` to
       * `{ type: "selected", id: "__candidate" }` inside a selector's
       * `conditions`).
       */
      type: "cardTradeIs";
      target: TargetRef;
      trade: Trade;
    }
  | {
      /**
       * True when `target`'s definition carries a Unique designation
       * (`CardDefinition.unique` is set) — "a character with the UNIQUE
       * keyword in its rules text".
       */
      type: "hasUnique";
      target: TargetRef;
    }
  | {
      /**
       * True when `target`'s definition has at least one ability of
       * `abilityType` (any ability if omitted) in `behavior.abilities` —
       * "a card you control with an ability in its rules text" (Notion
       * Sickness, which then uses one, so it wants `abilityType:
       * "activated"`).
       */
      type: "hasAbility";
      target: TargetRef;
      abilityType?: "activated" | "triggered" | "continuous" | "replacement";
    }
  | {
      type: "statCompare";
      target: TargetRef;
      stat: Stat;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      type: "counterCompare";
      target: TargetRef;
      counter: string;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * Generic `left <op> right` comparison between two NumberExpressions.
       * `statCompare`/`counterCompare` are for the common case of comparing
       * one specific card's stat/counter; use this when neither side is
       * anchored to a single target — most commonly a `count` expression,
       * e.g. "while an opponent controls at least 1 character".
       */
      type: "numberCompare";
      left: NumberExpression;
      operator: ComparisonOperator;
      right: NumberExpression;
    }
  | {
      /**
       * True while `target` is part of the current battle (e.g. "a blocking
       * character", "a character you control that is not in a battle" via
       * `not`). False whenever there is no active battle. Omit `role` to
       * match either side.
       */
      type: "inBattle";
      target: TargetRef;
      role?: "attacker" | "blocker";
    }
  | {
      /**
       * True when the triggering event is `damageDealt` and *this card* was
       * the source of that damage (e.g. "when this card deals damage to a
       * faction"). `sourceIsEventCard` isn't the right tool here — for
       * `damageDealt` it maps to the event's *target*, not its source.
       */
      type: "sourceIsDamageSource";
    }
  | {
      /**
       * True when the triggering event is `cardMoved` and it moved out of
       * `zone` (e.g. `{ zone: "play" }` for "when this card leaves play").
       * Combine with `sourceIsEventCard` via `and` to scope to this card
       * specifically, the same way any other self-triggered ability does.
       */
      type: "cardMovedFromZone";
      zone: Zone;
    }
  | {
      /**
       * True when the triggering event is `cardMoved` and it moved *into*
       * `zone` (e.g. `{ zone: "discard" }` for "when this card is put into a
       * discard pile"). Combine with `sourceIsEventCard` via `and` to scope
       * to this card.
       */
      type: "cardMovedToZone";
      zone: Zone;
    }
  | {
      /**
       * True while the controller is the attacker/defender of the current
       * battle (e.g. a tactic's "deploy this only while you are
       * attacking"). Unlike `inBattle`, this is about the *player's* role
       * in the battle, not whether a specific card is in a party.
       */
      type: "battleRole";
      role: "attacker" | "defender";
    }
  | {
      /**
       * True when the triggering event carries a `playerId` field (e.g.
       * `turnStarted`, `turnEnding`, `cardPlayed`) equal to `player` — "at
       * the start of *your* turn." False for any event with no `playerId`
       * field at all.
       */
      type: "eventPlayerIs";
      player: PlayerRef;
    }
  | {
      /**
       * True when `target` resolves to a card id that's a member of
       * `ResolutionContext.selected[selection]` — e.g. constraining a
       * later selector to only the cards an earlier target declaration
       * already picked ("an opponent chooses X of those [previously
       * revealed] cards"). False if `selection` was never bound.
       */
      type: "targetInSelection";
      target: TargetRef;
      selection: string;
    }
  | {
      /**
       * Compares *how many times the current triggering event has already
       * occurred this turn* (`GameState.turnEventTally`, keyed by event type
       * and — when the event has one — its `playerId`) against `value`. "The
       * first resource each opponent plays each turn" is a `resourcePlayed`
       * trigger with `and(eventPlayerIs opponent, { eventOrdinal, operator:
       * "=", value: 1 })`. False when there is no triggering event.
       */
      type: "eventOrdinal";
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * Compares the largest number of same-named cards `player` has
       * deployed *this turn* (`GameState.turnDeploys`) against `value` —
       * "an opponent deployed at least 2 cards with the same name this
       * turn" is `{ player: "opponent", operator: ">=", value: 2 }`.
       */
      type: "deploySameNameThisTurn";
      player: PlayerRef;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * True when the card is being played *into a response window* whose
       * unresolved response stack contains a card of type `cardType` (any
       * card if omitted) other than this one — "deploy this only in
       * response to a character being deployed". Pair with the
       * `respondedToCard` TargetRef to reach that card (its `cardCost`,
       * `terminate` it, ...).
       */
      type: "respondingTo";
      cardType?: CardType;
      /** `"ability"` — true when the newest unresolved non-self stack item is an activated ability ("in response to an ability"; Cock Block). Default `"card"`. */
      respondsTo?: "card" | "ability";
    }
  | {
      /**
       * True while responding to a card or ability whose stored selections
       * (`StackItem.context.selected`) include an in-play card of
       * `cardType` — it "picked a <cardType> as an extra cost". Gates
       * Mistaken Identity's EXTRA COST; pair with the `retargetExtraCost`
       * effect.
       */
      type: "respondedToPicked";
      cardType: CardType;
    }
  | {
      /**
       * True when the card currently resolving was played via its FLIP UP
       * cost (`ResolutionContext.deployedViaFlipUp`). "If you deployed this
       * card using FLIP UP, X is 4, otherwise X is 2" is an ability
       * `variables: { x: {...} }` plus an `if` branching on this.
       */
      type: "deployedViaFlipUp";
    }
  | {
      /**
       * True when `target` and `other` both resolve to a card and those
       * two cards share the same printed `name` — "search your deck for a
       * card with the same name" (bind `target` to `{ type: "selected",
       * id: "__candidate" }` in a selector's `conditions`, `other` to
       * `"eventCard"`). False if either side is missing.
       */
      type: "cardNameEquals";
      target: TargetRef;
      other: TargetRef;
    }
  | {
      /**
       * True when `target` (default `"source"`) resolves to a card that its
       * *owner* set aside to the bottom of their deck during the opening
       * mulligan (`GameState.mulligan`). For "if you ... chose to put this
       * card on the bottom of your deck as part of your mulligan"
       * (Community Chest).
       */
      type: "bottomedInMulligan";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target`'s current resource icons (`getResourceIcons` —
       * face-up printed icons / a PROVIDES line / Volition for a face-down
       * card) include at least `min` of `icon`. "A card that provides at
       * least [O]" — bind `target` to `"eventCard"` on a `resourcePlayed`
       * or `cardEnteredPlay` trigger.
       */
      type: "cardProvides";
      target: TargetRef;
      icon: ResourceIcon;
      min: NumberExpression;
    }
  | {
      /** True when `target` resolves to a staple resource (`ResourceDefinition.staple`). "...and it is a staple resource." */
      type: "isStaple";
      target: TargetRef;
    }
  | {
      /** True when `target` (default `"source"`) resolves to a depleted card. "At the end of your turn, if this card is depleted, ..." (Dying Hero). */
      type: "cardDepleted";
      target?: TargetRef;
    }
  | {
      /** True when `target` and `other` resolve to cards of the same `CardType`. "A card of the same type as the discarded card." (Perturb). */
      type: "cardTypeEquals";
      target: TargetRef;
      other: TargetRef;
    }
  | {
      /**
       * True when `target` and the ability's `source` are both in the
       * current battle on the SAME side (both attacking, or both blocking)
       * — "a character in a party with this card" (Necromantic Healer,
       * used inside a `damageModifiers` selector's `conditions` with
       * `target` bound to `__candidate`).
       */
      type: "sharesBattlePartyWithSource";
      target: TargetRef;
    }
  | {
      /**
       * True when the card `source` has "remembered" as `key` (via the
       * `rememberTarget` effect) is still in play — "while the picked
       * location is in play" (Conscientious Objector).
       */
      type: "linkedCardInPlay";
      key: string;
    }
  | {
      /** True while the ability's `source` is a face-down card in play — "use this only while this card is a face-down resource" (Fired Hand, Vorpal Sword). */
      type: "sourceIsFaceDown";
    }
  | {
      /**
       * True when no card matching `among` has a strictly lower (`"min"`) /
       * higher (`"max"`) `metric` than `target` — "the character with the
       * lowest numeric cost" (Verrucose Brains; `metric: "cost"`,
       * `direction: "min"`, `among` = all characters). Ties: every extremum
       * satisfies it, so a `count: 1` declaration lets the controller pick.
       */
      type: "isExtremum";
      target: TargetRef;
      metric: "cost" | Stat;
      direction: "min" | "max";
      among: CardSelector;
    };
