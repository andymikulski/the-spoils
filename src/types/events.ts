// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

import type { AbilityId, BattleId, CardInstanceId, PlayerId, Zone } from "./ids.js";

export interface GameEventMap {
  turnStarted: {
    playerId: PlayerId;
  };

  turnEnding: {
    playerId: PlayerId;
  };

  cardPlayed: {
    cardId: CardInstanceId;
    playerId: PlayerId;
  };

  cardEnteredPlay: {
    cardId: CardInstanceId;
    playerId: PlayerId;
  };

  cardMoved: {
    cardId: CardInstanceId;
    from: Zone;
    to: Zone;
  };

  cardDestroyed: {
    cardId: CardInstanceId;
    controllerId: PlayerId;
  };

  cardDepleted: {
    cardId: CardInstanceId;
  };

  cardRestored: {
    cardId: CardInstanceId;
  };

  resourcePlayed: {
    cardId: CardInstanceId;
    playerId: PlayerId;
    faceDown: boolean;
  };

  /** "When a player draws any number of cards" — one event per completed draw batch. */
  cardsDrawn: {
    playerId: PlayerId;
    count: number;
  };

  damageDealt: {
    sourceId?: CardInstanceId;
    targetId: CardInstanceId;
    amount: number;
  };

  abilityActivated: {
    cardId: CardInstanceId;
    abilityId: AbilityId;
    playerId: PlayerId;
  };

  battleStarted: {
    battleId: BattleId;
  };

  battleEnded: {
    battleId: BattleId;
  };

  /** "When this card attacks" — once per attacker, at declareAttack. */
  characterAttacked: {
    cardId: CardInstanceId;
    battleId: BattleId;
  };

  /** "When this card blocks" — once per blocker, at declareBlockers. */
  characterBlocked: {
    cardId: CardInstanceId;
    battleId: BattleId;
  };
}

export type GameEventType = keyof GameEventMap;

export type GameEvent = {
  [K in GameEventType]: { type: K } & GameEventMap[K];
}[GameEventType];
