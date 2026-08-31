// -----------------------------------------------------------------------------
// Player actions
// -----------------------------------------------------------------------------

import type { AbilityId, CardInstanceId, PlayerId } from "./ids.js";
import type { BattleDamageAssignment } from "./state.js";
import type { TriggerRef } from "./choices.js";

export type GameAction =
  | {
      type: "playCard";
      playerId: PlayerId;
      cardId: CardInstanceId;
      selected?: Record<string, CardInstanceId[]>;
      /** Player-chosen numeric variables ("choose a number for X"), see NumberExpression's "variable" case. */
      variables?: Record<string, number>;
      /**
       * For a modal tactic (`CardDefinition.behavior.modes`) — the chosen
       * mode index ("Choose one of the following as this card's rules
       * text"). Defaults to 0.
       */
      mode?: number;
    }
  | {
      type: "activateAbility";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityId: AbilityId;
      selected?: Record<string, CardInstanceId[]>;
      variables?: Record<string, number>;
    }
  | {
      /**
       * Flip up a face-down resource this player controls, paying its
       * `CardDefinition.flipUp` cost, and resolve it as its real card type
       * with `deployedViaFlipUp` set. `selected`/`variables` supply any
       * EXTRA COST picks / chosen numbers the flipped card needs.
       */
      type: "flipUp";
      playerId: PlayerId;
      cardId: CardInstanceId;
      selected?: Record<string, CardInstanceId[]>;
      variables?: Record<string, number>;
    }
  | {
      type: "passPriority";
      playerId: PlayerId;
    }
  | {
      type: "mulligan";
      playerId: PlayerId;
      cardIds: CardInstanceId[];
    }
  | {
      type: "chooseDevelop";
      playerId: PlayerId;
      choice:
        | { type: "draw" }
        | {
            type: "playResource";
            cards: Array<{ cardId: CardInstanceId; faceDown: boolean }>;
            /**
             * Instead of playing the resource(s): reveal this hand card
             * (which must carry `CardDefinition.revealFromHand`) and deploy
             * it for its `revealFromHand.cost`, consuming this turn's
             * develop resource play. `cards` must be empty when set.
             * "You may reveal this card as you are playing a resource; if
             * you do, you may deploy it for N." (Witty Worm).
             */
            revealFromHand?: {
              cardId: CardInstanceId;
              selected?: Record<string, CardInstanceId[]>;
              variables?: Record<string, number>;
            };
          };
    }
  | {
      type: "endTurn";
      playerId: PlayerId;
    }
  | {
      type: "declareAttack";
      playerId: PlayerId;
      attackerIds: CardInstanceId[];
      target:
        | { type: "faction"; playerId: PlayerId }
        | { type: "card"; cardId: CardInstanceId };
    }
  | {
      type: "declareBlockers";
      playerId: PlayerId;
      blockerIds: CardInstanceId[];
    }
  | {
      /** Resolve one automatic game-flow step. */
      type: "advanceFlow";
    }
  | {
      /** Backward-compatible alias for advanceFlow while a battle exists. */
      type: "advanceBattle";
      playerId: PlayerId;
    }
  | {
      type: "assignBattleDamage";
      playerId: PlayerId;
      assignments: BattleDamageAssignment[];
    }
  | {
      /** Answers the currently open GameState.pendingChoice. */
      type: "resolvePendingChoice";
      playerId: PlayerId;
      choice:
        | { kind: "uniqueSurvivor"; keep: CardInstanceId }
        | { kind: "selectTargets"; selected: Record<string, CardInstanceId[]> }
        /**
         * Pick the *next* trigger to resolve out of the batch still waiting
         * (CR §503.4a — the order is decided one at a time, resolving one
         * before choosing the next, not as a full permutation up front).
         */
        | { kind: "orderTriggers"; next: TriggerRef }
        | { kind: "chooserSelectsTarget"; selected: CardInstanceId[] }
        | { kind: "chooserSelectsOption"; index: number }
        | {
            kind: "reorderDeck";
            /**
             * For `to: "top"` / `"bottom"` — the full set of looked-at cards
             * in the chosen order. For `to: "split"` — the cards to LEAVE ON
             * TOP, in order; `bottom` names the rest, in order (the two must
             * partition the looked-at set).
             */
            order: CardInstanceId[];
            /** `to: "split"` only — the looked-at cards to send to the deck bottom, in order. */
            bottom?: CardInstanceId[];
          }
        | {
            kind: "deployForFree";
            /** Omit to decline. */
            cardId?: CardInstanceId;
            /** The chosen card's own extra-cost target declarations, same shape as playCard's `selected`. */
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
          }
        | {
            kind: "distributeAmong";
            /** Per-card shares; omitted/zero cards receive nothing. Must sum to the pending amount. */
            shares: Record<CardInstanceId, number>;
          }
        | {
            kind: "pileAssignment";
            /** The two piles — together they must be exactly the pending cards, disjoint. Either may be empty. */
            pile1: CardInstanceId[];
            pile2: CardInstanceId[];
          }
        | { kind: "replacementChoice"; apply: boolean }
        | { kind: "nameValue"; value: string }
        | { kind: "chooseNumber"; value: number }
        | { kind: "mayPay"; pay: boolean }
        | { kind: "alternatingPay"; pay: boolean }
        | { kind: "anyPlayerMayPay"; pay: boolean }
        | {
            kind: "useTargetAbility";
            /** Omit to decline. */
            abilityId?: AbilityId;
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
          }
        | {
            kind: "useAnyAbility";
            /** Which controlled card's ability to use; omit to decline. Leads to a follow-up `useTargetAbility` choice. */
            cardId?: CardInstanceId;
          }
        /** MUSTACHE SHOWDOWN — `piles` must partition the revealed cards into the pending choice's `piles` non-empty groups. */
        | { kind: "partitionCards"; piles: CardInstanceId[][] }
        /** MUSTACHE SHOWDOWN — index into the opponent's piles. */
        | { kind: "pickPile"; index: number }
        /** MUSTACHE SHOWDOWN — 0..`max` of the winning pile's cards to move to hand. */
        | { kind: "takeFromPile"; cardIds: CardInstanceId[] };
    };
