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
    }
  | {
      type: "activateAbility";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityId: AbilityId;
      selected?: Record<string, CardInstanceId[]>;
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
        | { kind: "orderTriggers"; order: TriggerRef[] };
    };
