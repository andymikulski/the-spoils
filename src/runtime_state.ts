import {
  CardInstanceId,
  CardDefinitionId,
  PlayerId,
  Zone,
  ModifierId,
  AbilityId,
  Stat,
  ModifierOperation,
  Duration,
  BattleId,
} from "./ids_primitives.js";
import { Threshold } from "./static_card_data.js";

// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------

export interface CardInstance {
  id: CardInstanceId;
  definitionId: CardDefinitionId;

  ownerId: PlayerId;
  controllerId: PlayerId;

  zone: Zone;

  depleted: boolean;
  damage: number;

  counters: Record<string, number>;
}

export interface PlayerState {
  id: PlayerId;
  name: string;

  influence: number;
  resources: number;

  thresholds: Threshold;

  deck: CardInstanceId[];
  hand: CardInstanceId[];
  play: CardInstanceId[];
  discard: CardInstanceId[];
  void: CardInstanceId[];
}

export interface RuntimeModifier {
  id: ModifierId;

  sourceId?: CardInstanceId;
  sourceAbilityId?: AbilityId;

  targetId: CardInstanceId;
  stat: Stat;
  operation: ModifierOperation;
  value: number;

  duration: Duration;
  createdTurn: number;
}

export interface BattleParty {
  attackerId: CardInstanceId;
  blockerIds: CardInstanceId[];
}

export interface BattleState {
  id: BattleId;
  attackerPlayerId: PlayerId;
  defenderPlayerId: PlayerId;

  target:
    | { type: "faction"; playerId: PlayerId }
    | { type: "card"; cardId: CardInstanceId };

  parties: BattleParty[];

  phase: "declared" | "blocking" | "speed" | "finished";
}

export interface GameState {
  turn: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;

  players: Record<PlayerId, PlayerState>;
  cards: Record<CardInstanceId, CardInstance>;

  modifiers: RuntimeModifier[];

  battle?: BattleState;
}
