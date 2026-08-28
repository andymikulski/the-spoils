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
        | { kind: "orderTriggers"; order: TriggerRef[] }
        | { kind: "chooserSelectsTarget"; selected: CardInstanceId[] }
        | { kind: "chooserSelectsOption"; index: number }
        | { kind: "reorderDeck"; order: CardInstanceId[] }
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
        | { kind: "replacementChoice"; apply: boolean }
        | { kind: "nameValue"; value: string }
        | { kind: "mayPay"; pay: boolean }
        | {
            kind: "useTargetAbility";
            /** Omit to decline. */
            abilityId?: AbilityId;
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
          };
    };
