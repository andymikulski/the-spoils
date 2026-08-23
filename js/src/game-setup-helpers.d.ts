import { CardDefinitionId, PlayerId, Zone } from "./ids_primitives.js";
import { CardInstance, GameState } from "./runtime_state.js";
export declare function createCardInstance(definitionId: CardDefinitionId, ownerId: PlayerId, zone?: Zone): CardInstance;
export declare function createTwoPlayerGame(playerA: {
    id: PlayerId;
    name: string;
    influence?: number;
}, playerB: {
    id: PlayerId;
    name: string;
    influence?: number;
}, cards: CardInstance[]): GameState;
