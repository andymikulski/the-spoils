export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type AbilityId = string;
export type ModifierId = string;
export type BattleId = string;
export type Trade = "rage" | "greed" | "deception" | "elitism" | "obsession";
export type CardType = "character" | "item" | "location" | "tactic" | "resource" | "faction";
export type Zone = "deck" | "hand" | "deploying" | "play" | "discard" | "void";
export type Stat = "strength" | "life" | "speed" | "influence";
export type ComparisonOperator = ">" | ">=" | "=" | "<=" | "<";
export type Duration = {
    type: "permanent";
} | {
    type: "untilEndOfTurn";
} | {
    type: "whileSourceInPlay";
};
export type ModifierOperation = "add" | "set" | "multiply";
export interface Threshold {
    rage?: number;
    greed?: number;
    deception?: number;
    elitism?: number;
    obsession?: number;
}
export interface CardStats {
    strength?: number;
    life?: number;
    speed?: number;
    influence?: number;
}
export interface CardDefinition {
    id: CardDefinitionId;
    name: string;
    set: string;
    type: CardType;
    trade: Trade;
    rarity: string;
    cost: number;
    threshold: string | number;
    strength?: number;
    life?: number;
    speed?: number;
    influence?: number;
    subtype: string[];
    text: string;
    behavior?: {
        abilities?: AbilityDefinition[];
    };
}
export type AbilityDefinition = ActivatedAbility | TriggeredAbility | ContinuousAbility;
export interface AbilityBase {
    id: AbilityId;
    name?: string;
}
export interface ActivatedAbility extends AbilityBase {
    type: "activated";
    condition?: Condition;
    costs?: Cost[];
    targets?: TargetDeclaration[];
    effects: Effect[];
}
export interface TriggeredAbility extends AbilityBase {
    type: "triggered";
    event: GameEventType;
    condition?: Condition;
    targets?: TargetDeclaration[];
    effects: Effect[];
}
export interface ContinuousAbility extends AbilityBase {
    type: "continuous";
    condition?: Condition;
    modifiers: ModifierDefinition[];
}
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
    target: {
        type: "faction";
        playerId: PlayerId;
    } | {
        type: "card";
        cardId: CardInstanceId;
    };
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
export type PlayerRef = "controller" | "owner" | "activePlayer" | "opponent" | {
    type: "player";
    id: PlayerId;
};
export type TargetRef = "source" | {
    type: "selected";
    id: string;
} | {
    type: "card";
    id: CardInstanceId;
};
export type NumberExpression = number | {
    type: "stat";
    target: TargetRef;
    stat: Stat;
} | {
    type: "counter";
    target: TargetRef;
    counter: string;
} | {
    type: "count";
    selector: CardSelector;
} | {
    type: "add";
    values: NumberExpression[];
} | {
    type: "multiply";
    values: NumberExpression[];
};
export interface CardSelector {
    controller?: "self" | "opponent" | "any";
    owner?: "self" | "opponent" | "any";
    zone?: Zone | Zone[];
    type?: CardType;
    subtype?: string;
    depleted?: boolean;
    conditions?: Condition[];
}
export interface TargetDeclaration {
    id: string;
    selector: CardSelector;
    count: number;
}
export type Condition = {
    type: "and";
    conditions: Condition[];
} | {
    type: "or";
    conditions: Condition[];
} | {
    type: "not";
    condition: Condition;
} | {
    type: "sourceInZone";
    zone: Zone;
} | {
    type: "sourceIsEventCard";
} | {
    type: "eventCardControlledBy";
    player: PlayerRef;
} | {
    type: "targetExists";
    target: TargetRef;
} | {
    type: "cardTypeIs";
    target: TargetRef;
    cardType: CardType;
} | {
    type: "statCompare";
    target: TargetRef;
    stat: Stat;
    operator: ComparisonOperator;
    value: NumberExpression;
} | {
    type: "counterCompare";
    target: TargetRef;
    counter: string;
    operator: ComparisonOperator;
    value: NumberExpression;
};
export type Cost = {
    type: "payResources";
    amount: NumberExpression;
} | {
    type: "deplete";
    target: TargetRef;
} | {
    type: "discard";
    player: PlayerRef;
    selector: CardSelector;
    count: number;
} | {
    type: "destroy";
    target: TargetRef;
};
export type Effect = {
    type: "draw";
    player: PlayerRef;
    amount: NumberExpression;
} | {
    type: "dealDamage";
    target: TargetRef;
    amount: NumberExpression;
} | {
    type: "modifyInfluence";
    player: PlayerRef;
    amount: NumberExpression;
} | {
    type: "moveCard";
    target: TargetRef;
    to: Zone;
} | {
    type: "destroy";
    target: TargetRef;
} | {
    type: "deplete";
    target: TargetRef;
} | {
    type: "restore";
    target: TargetRef;
} | {
    type: "addCounter";
    target: TargetRef;
    counter: string;
    amount: NumberExpression;
} | {
    type: "removeCounter";
    target: TargetRef;
    counter: string;
    amount: NumberExpression;
} | {
    type: "createModifier";
    target: TargetRef;
    stat: Stat;
    operation: ModifierOperation;
    value: NumberExpression;
    duration: Duration;
};
export interface ModifierDefinition {
    target: TargetRef;
    stat: Stat;
    operation: ModifierOperation;
    value: NumberExpression;
}
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
export interface ResolutionContext {
    sourceId: CardInstanceId;
    controllerId: PlayerId;
    abilityId?: AbilityId;
    event?: GameEvent;
    selected: Record<string, CardInstanceId[]>;
}
export interface TriggerResolution {
    sourceId: CardInstanceId;
    ability: TriggeredAbility;
    context: ResolutionContext;
}
export interface StackItem {
    id: string;
    sourceId: CardInstanceId;
    controllerId: PlayerId;
    kind: "card" | "ability";
    abilityId?: AbilityId;
    effects: Effect[];
    context: ResolutionContext;
}
export type GameAction = {
    type: "playCard";
    playerId: PlayerId;
    cardId: CardInstanceId;
    selected?: Record<string, CardInstanceId[]>;
} | {
    type: "activateAbility";
    playerId: PlayerId;
    cardId: CardInstanceId;
    abilityId: AbilityId;
    selected?: Record<string, CardInstanceId[]>;
} | {
    type: "passPriority";
    playerId: PlayerId;
} | {
    type: "endTurn";
    playerId: PlayerId;
} | {
    type: "declareAttack";
    playerId: PlayerId;
    attackerIds: CardInstanceId[];
    target: {
        type: "faction";
        playerId: PlayerId;
    } | {
        type: "card";
        cardId: CardInstanceId;
    };
} | {
    type: "declareBlockers";
    playerId: PlayerId;
    blocks: Record<CardInstanceId, CardInstanceId[]>;
};
export declare function parseThreshold(threshold: string | number): Threshold;
export declare class SpoilsEngine {
    readonly definitions: Record<CardDefinitionId, CardDefinition>;
    readonly state: GameState;
    readonly responseStack: StackItem[];
    readonly immediateQueue: TriggerResolution[];
    private consecutivePasses;
    constructor(definitions: CardDefinition[], initialState: GameState);
    perform(action: GameAction): void;
    getDefinition(cardId: CardInstanceId): CardDefinition;
    getStat(cardId: CardInstanceId, stat: Stat): number;
    getAvailableActivatedAbilities(playerId: PlayerId): Array<{
        cardId: CardInstanceId;
        ability: ActivatedAbility;
    }>;
    queryCards(selector: CardSelector, context: ResolutionContext): CardInstance[];
    private playCard;
    private getPlayTargetDeclarations;
    private getTacticEffects;
    private activateAbility;
    private passPriority;
    private resolveTopOfStack;
    emit(event: GameEvent): void;
    private findTriggers;
    private processImmediateQueue;
    evaluateCondition(condition: Condition, context: ResolutionContext): boolean;
    evaluateNumber(expression: NumberExpression, context: ResolutionContext): number;
    private validateTargetDeclarations;
    private autoSelectTargets;
    private matchesSelector;
    private resolveTargetRef;
    private resolvePlayerRef;
    private canPayCosts;
    private payCosts;
    private payCost;
    resolveEffect(effect: Effect, context: ResolutionContext): void;
    private getContinuousModifiers;
    private checkStateBasedActions;
    private moveCard;
    private destroyCard;
    private removeFromAllPlayerZones;
    private getZoneArray;
    private endTurn;
    private declareAttack;
    private declareBlockers;
    /**
     * Resolves the current battle using a deliberately small model:
     *
     * - Highest remaining speed resolves first.
     * - All characters in that speed group deal damage simultaneously.
     * - Blocked attackers damage blockers in declaration order.
     * - Blockers damage their paired attacker.
     * - Unblocked attackers damage the battle target.
     *
     * This is enough to wire UI and card triggers around combat now.
     * More exact Spoils assignment rules can replace only this method later.
     */
    resolveBattle(): void;
    private meetsThreshold;
    private getEventCardId;
    private resetPriorityAfterAction;
    private requireCard;
    private requirePlayer;
    private getOpponent;
}
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
export declare const CARD_CATALOG: CardDefinition[];
export declare function getCatalogCard(id: CardDefinitionId): CardDefinition;
export declare function findCatalogCard(name: string, set?: string): CardDefinition;
