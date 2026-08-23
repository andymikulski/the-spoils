export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type AbilityId = string;
export type ModifierId = string;
export type BattleId = string;
export type Trade = "arcanist" | "banker" | "gearsmith" | "rogue" | "warlord" | "universal" | "Universal";
export type Keyword = "tactical" | "aggro" | "covert";
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
    volition?: number;
}
export type ResourceIcon = keyof Threshold;
export type DevelopChoice = {
    type: "draw";
    count: number;
} | {
    type: "playResource";
    count: number;
};
export interface FactionDefinition {
    startingInfluence: number;
    setup: {
        startingResources: {
            count: number;
            /** Optional exact resource names for factions that require specific cards. */
            names?: string[];
            /** Tournament Faction uses staple resources. */
            stapleOnly?: boolean;
        };
        openingHand: {
            goingFirst: number;
            goingSecond: number;
        };
        mulligan?: {
            count: number;
            mode: "replaceAny";
        };
    };
    turn: {
        restore: {
            clearCharacterDamage: boolean;
            detachResources: boolean;
            restoreNonResources: boolean;
        };
        develop: {
            choices: DevelopChoice[];
        };
    };
}
export interface ResourceDefinition {
    /** Explicit icon data overrides staple-name inference. */
    provides?: ResourceIcon[];
    staple?: boolean;
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
    /** Present only on faction cards. */
    faction?: FactionDefinition;
    /** Optional structured resource metadata. */
    resource?: ResourceDefinition;
    behavior?: {
        abilities?: AbilityDefinition[];
        keywords?: Keyword[];
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
    /** Face-down cards in play are resources and provide Volition. */
    faceDown: boolean;
    /** Numeric costs attach resources to the player's faction. */
    attachedTo?: CardInstanceId;
    /**
     * The turn number on which this card started the turn in play under its
     * current controller. AGGRO ignores this restriction.
     */
    attackEligibleTurn?: number;
    counters: Record<string, number>;
}
export interface PlayerState {
    id: PlayerId;
    name: string;
    /** Runtime instance of this player's faction card. */
    factionId?: CardInstanceId;
    /** Current score. Initial value comes from faction.startingInfluence. */
    influence: number;
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
export interface BattleDamageAssignment {
    sourceId: CardInstanceId;
    target: {
        type: "card";
        cardId: CardInstanceId;
    } | {
        type: "faction";
        playerId: PlayerId;
    };
    amount: number;
}
export type BattlePhase = "afterAttackersResponse" | "blocking" | "beforeDamageResponse" | "attackerDamageAssignment" | "defenderDamageAssignment" | "afterDamageResponse" | "finished";
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
    attackingParty: CardInstanceId[];
    blockingParty: CardInstanceId[];
    phase: BattlePhase;
    /** Current speed group. Undefined between groups. */
    speed?: number;
    /** Characters that have already assigned battle damage this battle. */
    assignedDamageBy: CardInstanceId[];
    /** Locked assignments for the current speed group. */
    attackerAssignments: BattleDamageAssignment[];
    defenderAssignments: BattleDamageAssignment[];
}
export interface BattleView {
    battleId: BattleId;
    phase: BattlePhase;
    speed?: number;
    attackerPlayerId: PlayerId;
    defenderPlayerId: PlayerId;
    attackingParty: CardInstanceId[];
    blockingParty: CardInstanceId[];
    actingPlayerId?: PlayerId;
    damageSources: Array<{
        cardId: CardInstanceId;
        strength: number;
        legalTargets: Array<{
            type: "card";
            cardId: CardInstanceId;
        } | {
            type: "faction";
            playerId: PlayerId;
        }>;
    }>;
    lockedAssignments: BattleDamageAssignment[];
}
export type ResponseWindowKind = "action" | "endTurn" | "battleAfterAttackers" | "battleBeforeDamage" | "battleAfterDamage";
export type ResponseContinuation = {
    type: "main";
} | {
    type: "endTurn";
    playerId: PlayerId;
} | {
    type: "battleBlocking";
    battleId: BattleId;
} | {
    type: "battleAssignDamage";
    battleId: BattleId;
} | {
    type: "battleInflictDamage";
    battleId: BattleId;
};
export interface ResponseWindowState {
    id: string;
    kind: ResponseWindowKind;
    /**
     * acceptingResponses:
     *   players may deploy tactics / TACTICAL cards and use abilities.
     *
     * resolving:
     *   no new responses may be added. advanceFlow() resolves one stack item
     *   per call until the stack is empty, then resumes the interrupted flow.
     */
    phase: "acceptingResponses" | "resolving";
    firstPlayerId: PlayerId;
    priorityPlayerId: PlayerId;
    consecutivePasses: number;
    continuation: ResponseContinuation;
}
export type TurnPhase = "develop" | "main";
export type GameSetupState = {
    phase: "mulligan";
    order: PlayerId[];
    currentIndex: number;
} | {
    phase: "complete";
};
export interface GameFlowView {
    activePlayerId: PlayerId;
    priorityPlayerId: PlayerId;
    mode: "setup" | "develop" | "main" | "response" | "resolvingResponses" | "battleChoice" | "battleFinished";
    turnPhase: TurnPhase;
    setup: GameSetupState;
    responseWindow?: ResponseWindowState;
    responseStack: StackItem[];
    battle?: BattleView;
}
export interface GameState {
    turn: number;
    activePlayerId: PlayerId;
    priorityPlayerId: PlayerId;
    turnPhase: TurnPhase;
    setup: GameSetupState;
    started: boolean;
    players: Record<PlayerId, PlayerState>;
    cards: Record<CardInstanceId, CardInstance>;
    modifiers: RuntimeModifier[];
    /** Fully serializable response/stack state for UI, replay, or networking. */
    responseStack: StackItem[];
    responseWindow?: ResponseWindowState;
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
    /**
     * Play a selected card as a resource. "auto" plays actual resource
     * cards face-up and all other cards face-down.
     */
    type: "playResource";
    target: TargetRef;
    faceDown: boolean | "auto";
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
    resourcePlayed: {
        cardId: CardInstanceId;
        playerId: PlayerId;
        faceDown: boolean;
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
    type: "mulligan";
    playerId: PlayerId;
    cardIds: CardInstanceId[];
} | {
    type: "chooseDevelop";
    playerId: PlayerId;
    choice: {
        type: "draw";
    } | {
        type: "playResource";
        cards: Array<{
            cardId: CardInstanceId;
            faceDown: boolean;
        }>;
    };
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
    blockerIds: CardInstanceId[];
} | {
    /** Resolve one automatic game-flow step. */
    type: "advanceFlow";
} | {
    /** Backward-compatible alias for advanceFlow while a battle exists. */
    type: "advanceBattle";
    playerId: PlayerId;
} | {
    type: "assignBattleDamage";
    playerId: PlayerId;
    assignments: BattleDamageAssignment[];
};
export declare function parseThreshold(threshold: string | number): Threshold;
export declare const TOURNAMENT_FACTION_DEFAULTS: FactionDefinition;
export declare const TOURNAMENT_FACTION_BEHAVIOR: NonNullable<CardDefinition["behavior"]>;
export declare class SpoilsEngine {
    readonly definitions: Record<CardDefinitionId, CardDefinition>;
    readonly state: GameState;
    readonly immediateQueue: TriggerResolution[];
    /**
     * Event batches delay triggered-ability execution until a simultaneous group
     * of mutations is complete. Battle damage uses this so one damage event
     * cannot interrupt another member of the same speed group.
     */
    private eventBatchDepth;
    constructor(definitions: CardDefinition[], initialState: GameState);
    get responseStack(): StackItem[];
    perform(action: GameAction): void;
    /**
     * Single query surface intended for a UI / renderer.
     */
    getFlowView(): GameFlowView;
    getDefinition(cardId: CardInstanceId): CardDefinition;
    getFactionCard(playerId: PlayerId): CardInstance | undefined;
    getFactionDefinition(playerId: PlayerId): FactionDefinition | undefined;
    isResource(cardId: CardInstanceId): boolean;
    getAvailableResourceIds(playerId: PlayerId): CardInstanceId[];
    getAvailableResourceCount(playerId: PlayerId): number;
    getThresholds(playerId: PlayerId): Threshold;
    getDevelopChoices(playerId: PlayerId): DevelopChoice[];
    private getResourceIcons;
    private payNumericCost;
    private drawCards;
    private playResourceCard;
    startGameAfterSetup(): void;
    private mulligan;
    private chooseDevelop;
    private applyFactionStartOfTurn;
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
    /**
     * Passing never resolves hidden work immediately. Two consecutive passes
     * switch the response window to "resolving". The renderer can animate that
     * transition and call advanceFlow() when it is ready for the next item.
     */
    private passPriority;
    /**
     * Advances exactly one automatic step:
     *
     * 1. Resolve one response-stack item, OR
     * 2. Resume the interrupted turn/battle flow once the stack is empty, OR
     * 3. Clear a finished battle after the UI has had a chance to render it.
     */
    private advanceFlow;
    private resolveTopOfStack;
    private afterStackAction;
    private openResponseWindow;
    private resumeContinuation;
    private assertCanDeployAtCurrentTiming;
    private assertCanUseAbilityAtCurrentTiming;
    private canUseAbilityAtCurrentTiming;
    private requireResponseWindow;
    emit(event: GameEvent): void;
    private beginEventBatch;
    private endEventBatch;
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
    /**
     * "End turn" is an announcement. The opponent gets a normal response window
     * before the turn actually changes.
     */
    private endTurn;
    private finishTurn;
    getBattleView(): BattleView | undefined;
    private declareAttack;
    private declareBlockers;
    private prepareNextSpeedGroupOrFinish;
    private enterDamageAssignment;
    private assignBattleDamage;
    private openPostAssignmentResponse;
    private getBattleDamageSources;
    private canAssignBattleDamage;
    private getLegalBattleDamageTargets;
    private getNextBattleSpeed;
    private inflictLockedBattleDamage;
    private pruneBattleParties;
    private isCardStillInBattle;
    private sameBattleTarget;
    private assertCovertBlockingLegality;
    private isBattleResponseWindow;
    private requireBattle;
    private requireBattleId;
    /**
     * The finished battle remains in GameState until advanceFlow() is called,
     * allowing a renderer to show/animate the final state.
     */
    private finishBattle;
    private meetsThreshold;
    private getEventCardId;
    private definitionHasKeyword;
    private hasKeyword;
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
export interface FactionPlayerSetup {
    id: PlayerId;
    name: string;
    /**
     * May be omitted when deckDefinitionIds contains exactly one faction card.
     * The faction is removed from the draw deck automatically.
     */
    factionDefinitionId?: CardDefinitionId;
    deckDefinitionIds: CardDefinitionId[];
}
export interface FactionGameSetupOptions {
    firstPlayerId?: PlayerId;
    random?: () => number;
}
/**
 * Creates a complete two-player game using faction-defined setup rules.
 *
 * Resulting flow for The Tournament Faction:
 *   faction enters play
 *   -> find 2 staple resources and put them in play
 *   -> shuffle
 *   -> first player draws 8, second draws 9
 *   -> mulligan decisions in turn order
 *   -> start turn 1 in the develop phase
 */
export declare function createTwoPlayerFactionGame(definitionsInput: CardDefinition[], playerA: FactionPlayerSetup, playerB: FactionPlayerSetup, options?: FactionGameSetupOptions): SpoilsEngine;
