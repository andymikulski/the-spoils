import { PlayerId, CardInstanceId, AbilityId } from "./ids_primitives";

// -----------------------------------------------------------------------------
// Player actions
// -----------------------------------------------------------------------------

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
      blocks: Record<CardInstanceId, CardInstanceId[]>;
    };
