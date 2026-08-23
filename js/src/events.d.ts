import { PlayerId, CardInstanceId, Zone, AbilityId, BattleId } from "./ids_primitives.js";
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
}
export type GameEventType = keyof GameEventMap;
export type GameEvent = {
    [K in GameEventType]: {
        type: K;
    } & GameEventMap[K];
}[GameEventType];
