import { GameState, CardInstance } from "./runtime_state.js";
import { CardDefinitionId, CardInstanceId, PlayerId, Stat } from "./ids_primitives.js";
import { CardDefinition, ActivatedAbility } from "./static_card_data.js";
import { NumberExpression, CardSelector } from "./references_expressions_selectors.js";
import { Condition } from "./Condition.js";
import { Effect } from "./Effect.js";
import { GameEvent } from "./events.js";
import { StackItem, TriggerResolution, ResolutionContext } from "./resolution_context.js";
import { GameAction } from "./GameAction.js";
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
