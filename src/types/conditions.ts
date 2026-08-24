// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

import type { CardType, ComparisonOperator, Stat, Zone } from "./ids.js";
import type { NumberExpression, PlayerRef, TargetRef } from "./expressions.js";

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
    };
