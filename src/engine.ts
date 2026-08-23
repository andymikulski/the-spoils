/* spoils-engine.ts
 *
 * Barebones, interface-first, data-driven rules engine for The Spoils.
 *
 * Goals:
 * - Card behavior is JSON-serializable.
 * - Cards never execute arbitrary callbacks.
 * - The engine owns mutation.
 * - Abilities are built from reusable costs, conditions, selectors, expressions, and effects.
 * - Triggered abilities react to engine events.
 * - Continuous abilities generate derived modifiers.
 * - Activated abilities and deployed cards can live on a response stack.
 *
 * This is intentionally UI-free. A UI can inspect GameState and submit GameAction objects.
 */

import cardsJson from "./data/cards.js";

// -----------------------------------------------------------------------------
// IDs / primitive types
// -----------------------------------------------------------------------------

export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type AbilityId = string;
export type ModifierId = string;
export type BattleId = string;

export type Trade =
  | "rage"
  | "greed"
  | "deception"
  | "elitism"
  | "obsession";

export type CardType =
  | "character"
  | "item"
  | "location"
  | "tactic"
  | "resource"
  | "faction";

export type Zone =
  | "deck"
  | "hand"
  | "deploying"
  | "play"
  | "discard"
  | "void";

export type Stat =
  | "strength"
  | "life"
  | "speed"
  | "influence";

export type ComparisonOperator = ">" | ">=" | "=" | "<=" | "<";

export type Duration =
  | { type: "permanent" }
  | { type: "untilEndOfTurn" }
  | { type: "whileSourceInPlay" };

export type ModifierOperation = "add" | "set" | "multiply";

// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

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

export type AbilityDefinition =
  | ActivatedAbility
  | TriggeredAbility
  | ContinuousAbility;

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

  phase:
    | "declared"
    | "blocking"
    | "speed"
    | "finished";
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

// -----------------------------------------------------------------------------
// References / expressions / selectors
// -----------------------------------------------------------------------------

export type PlayerRef =
  | "controller"
  | "owner"
  | "activePlayer"
  | "opponent"
  | { type: "player"; id: PlayerId };

export type TargetRef =
  | "source"
  | { type: "selected"; id: string }
  | { type: "card"; id: CardInstanceId };

export type NumberExpression =
  | number
  | {
      type: "stat";
      target: TargetRef;
      stat: Stat;
    }
  | {
      type: "counter";
      target: TargetRef;
      counter: string;
    }
  | {
      type: "count";
      selector: CardSelector;
    }
  | {
      type: "add";
      values: NumberExpression[];
    }
  | {
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

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

export type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] }
  | { type: "not"; condition: Condition }
  | { type: "sourceInZone"; zone: Zone }
  | { type: "sourceIsEventCard" }
  | { type: "eventCardControlledBy"; player: PlayerRef }
  | { type: "targetExists"; target: TargetRef }
  | {
      type: "cardTypeIs";
      target: TargetRef;
      cardType: CardType;
    }
  | {
      type: "statCompare";
      target: TargetRef;
      stat: Stat;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      type: "counterCompare";
      target: TargetRef;
      counter: string;
      operator: ComparisonOperator;
      value: NumberExpression;
    };

// -----------------------------------------------------------------------------
// Costs
// -----------------------------------------------------------------------------

export type Cost =
  | {
      type: "payResources";
      amount: NumberExpression;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "discard";
      player: PlayerRef;
      selector: CardSelector;
      count: number;
    }
  | {
      type: "destroy";
      target: TargetRef;
    };

// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

export type Effect =
  | {
      type: "draw";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      type: "modifyInfluence";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "moveCard";
      target: TargetRef;
      to: Zone;
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "restore";
      target: TargetRef;
    }
  | {
      type: "addCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
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

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

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
  [K in GameEventType]: { type: K } & GameEventMap[K];
}[GameEventType];

// -----------------------------------------------------------------------------
// Resolution context
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

let nextIdCounter = 1;

function nextId(prefix: string): string {
  return `${prefix}_${nextIdCounter++}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function compare(
  left: number,
  op: ComparisonOperator,
  right: number
): boolean {
  switch (op) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "=":
      return left === right;
    case "<=":
      return left <= right;
    case "<":
      return left < right;
  }
}

export function parseThreshold(
  threshold: string | number
): Threshold {
  if (!threshold || threshold === 0) {
    return {};
  }

  const result: Threshold = {};

  for (const icon of String(threshold).toLowerCase()) {
    switch (icon) {
      case "r":
        result.rage = (result.rage ?? 0) + 1;
        break;
      case "g":
        result.greed = (result.greed ?? 0) + 1;
        break;
      case "d":
        result.deception = (result.deception ?? 0) + 1;
        break;
      case "e":
        result.elitism = (result.elitism ?? 0) + 1;
        break;
      case "o":
        result.obsession = (result.obsession ?? 0) + 1;
        break;
      default:
        throw new Error(`Unknown threshold icon '${icon}'.`);
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

export class SpoilsEngine {
  readonly definitions: Record<CardDefinitionId, CardDefinition>;
  readonly state: GameState;

  readonly responseStack: StackItem[] = [];
  readonly immediateQueue: TriggerResolution[] = [];

  private consecutivePasses = 0;

  constructor(
    definitions: CardDefinition[],
    initialState: GameState
  ) {
    this.definitions = Object.fromEntries(
      definitions.map(def => [def.id, def])
    );

    this.state = initialState;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  perform(action: GameAction): void {
    switch (action.type) {
      case "playCard":
        this.playCard(action);
        return;

      case "activateAbility":
        this.activateAbility(action);
        return;

      case "passPriority":
        this.passPriority(action.playerId);
        return;

      case "endTurn":
        this.endTurn(action.playerId);
        return;

      case "declareAttack":
        this.declareAttack(action.playerId, action.attackerIds, action.target);
        return;

      case "declareBlockers":
        this.declareBlockers(action.playerId, action.blocks);
        return;
    }
  }

  getDefinition(cardId: CardInstanceId): CardDefinition {
    const card = this.requireCard(cardId);
    const definition = this.definitions[card.definitionId];

    assert(
      definition,
      `Missing definition '${card.definitionId}' for card '${cardId}'`
    );

    return definition;
  }

  getStat(cardId: CardInstanceId, stat: Stat): number {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    let value =
      stat === "influence"
        ? definition.influence ?? 0
        : definition[stat] ?? 0;

    const modifiers = [
      ...this.getContinuousModifiers(cardId),
      ...this.state.modifiers.filter(modifier => modifier.targetId === cardId)
    ];

    for (const modifier of modifiers) {
      switch (modifier.operation) {
        case "add":
          value += modifier.value;
          break;

        case "set":
          value = modifier.value;
          break;

        case "multiply":
          value *= modifier.value;
          break;
      }
    }

    return value;
  }

  getAvailableActivatedAbilities(
    playerId: PlayerId
  ): Array<{ cardId: CardInstanceId; ability: ActivatedAbility }> {
    const result: Array<{
      cardId: CardInstanceId;
      ability: ActivatedAbility;
    }> = [];

    for (const card of Object.values(this.state.cards)) {
      if (card.controllerId !== playerId || card.zone !== "play") {
        continue;
      }

      const definition = this.getDefinition(card.id);

      for (const ability of definition.behavior?.abilities ?? []) {
        if (ability.type !== "activated") {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: playerId,
          abilityId: ability.id,
          selected: {}
        };

        if (
          (!ability.condition ||
            this.evaluateCondition(ability.condition, context)) &&
          this.canPayCosts(ability.costs ?? [], context)
        ) {
          result.push({
            cardId: card.id,
            ability
          });
        }
      }
    }

    return result;
  }

  queryCards(
    selector: CardSelector,
    context: ResolutionContext
  ): CardInstance[] {
    return Object.values(this.state.cards).filter(card =>
      this.matchesSelector(card, selector, context)
    );
  }

  // ---------------------------------------------------------------------------
  // Card play / response stack
  // ---------------------------------------------------------------------------

  private playCard(
    action: Extract<GameAction, { type: "playCard" }>
  ): void {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);

    assert(
      card.controllerId === action.playerId,
      "You do not control that card."
    );

    assert(card.zone === "hand", "Card must be in your hand.");

    assert(
      this.meetsThreshold(action.playerId, definition.threshold),
      "Threshold requirements are not met."
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      selected: action.selected ?? {}
    };

    this.validateTargetDeclarations(
      this.getPlayTargetDeclarations(definition),
      context
    );

    const resourceCost = definition.cost ?? 0;

    assert(
      this.state.players[action.playerId].resources >= resourceCost,
      "Not enough resources."
    );

    this.state.players[action.playerId].resources -= resourceCost;

    this.moveCard(card.id, "deploying");

    this.emit({
      type: "cardPlayed",
      cardId: card.id,
      playerId: action.playerId
    });

    // Tactics resolve their abilities and then go to discard.
    // Permanents enter play when their stack item resolves.
    const effects =
      definition.type === "tactic"
        ? this.getTacticEffects(definition)
        : [];

    this.responseStack.push({
      id: nextId("stack"),
      sourceId: card.id,
      controllerId: action.playerId,
      kind: "card",
      effects,
      context
    });

    this.resetPriorityAfterAction(action.playerId);
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition
  ): TargetDeclaration[] {
    if (definition.type !== "tactic") {
      return [];
    }

    // Barebones convention:
    // tactic cards use the first activated ability-shaped entry as their spell body.
    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.targets ?? [];
  }

  private getTacticEffects(definition: CardDefinition): Effect[] {
    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.effects ?? [];
  }

  // ---------------------------------------------------------------------------
  // Activated abilities
  // ---------------------------------------------------------------------------

  private activateAbility(
    action: Extract<GameAction, { type: "activateAbility" }>
  ): void {
    const card = this.requireCard(action.cardId);

    assert(card.zone === "play", "Source must be in play.");
    assert(
      card.controllerId === action.playerId,
      "You do not control that card."
    );

    const ability = this.getDefinition(card.id).behavior?.abilities?.find(
      ability =>
        ability.id === action.abilityId &&
        ability.type === "activated"
    ) as ActivatedAbility | undefined;

    assert(ability, "Activated ability not found.");

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      abilityId: ability.id,
      selected: action.selected ?? {}
    };

    if (ability.condition) {
      assert(
        this.evaluateCondition(ability.condition, context),
        "Ability condition is not satisfied."
      );
    }

    this.validateTargetDeclarations(ability.targets ?? [], context);

    assert(
      this.canPayCosts(ability.costs ?? [], context),
      "Ability costs cannot be paid."
    );

    this.payCosts(ability.costs ?? [], context);

    // Cost-triggered abilities resolve before the newly activated ability
    // is placed where opponents can respond to it.
    this.processImmediateQueue();

    this.responseStack.push({
      id: nextId("stack"),
      sourceId: card.id,
      controllerId: action.playerId,
      kind: "ability",
      abilityId: ability.id,
      effects: ability.effects,
      context
    });

    this.emit({
      type: "abilityActivated",
      cardId: card.id,
      abilityId: ability.id,
      playerId: action.playerId
    });

    this.resetPriorityAfterAction(action.playerId);
  }

  private passPriority(playerId: PlayerId): void {
    assert(
      this.state.priorityPlayerId === playerId,
      "It is not your priority."
    );

    this.consecutivePasses++;

    const opponent = this.getOpponent(playerId);
    this.state.priorityPlayerId = opponent.id;

    if (this.consecutivePasses < 2) {
      return;
    }

    this.consecutivePasses = 0;

    if (this.responseStack.length > 0) {
      this.resolveTopOfStack();

      this.state.priorityPlayerId =
        this.state.activePlayerId;

      return;
    }
  }

  private resolveTopOfStack(): void {
    const item = this.responseStack.pop();

    assert(item, "Response stack is empty.");

    for (const effect of item.effects) {
      this.resolveEffect(effect, item.context);
      this.processImmediateQueue();
      this.checkStateBasedActions();
    }

    if (item.kind === "card") {
      const card = this.requireCard(item.sourceId);
      const definition = this.getDefinition(card.id);

      if (definition.type === "tactic") {
        if (card.zone === "deploying") {
          this.moveCard(card.id, "discard");
        }
      } else if (card.zone === "deploying") {
        this.moveCard(card.id, "play");

        this.emit({
          type: "cardEnteredPlay",
          cardId: card.id,
          playerId: card.controllerId
        });
      }
    }

    this.processImmediateQueue();
    this.checkStateBasedActions();
  }

  // ---------------------------------------------------------------------------
  // Event / trigger system
  // ---------------------------------------------------------------------------

  emit(event: GameEvent): void {
    const triggers = this.findTriggers(event);

    for (const trigger of triggers) {
      this.immediateQueue.push(trigger);
    }

    this.processImmediateQueue();
  }

  private findTriggers(event: GameEvent): TriggerResolution[] {
    const results: TriggerResolution[] = [];

    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play") {
        continue;
      }

      const definition = this.getDefinition(card.id);

      for (const ability of definition.behavior?.abilities ?? []) {
        if (
          ability.type !== "triggered" ||
          ability.event !== event.type
        ) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: card.controllerId,
          abilityId: ability.id,
          event,
          selected: {}
        };

        if (
          !ability.condition ||
          this.evaluateCondition(ability.condition, context)
        ) {
          results.push({
            sourceId: card.id,
            ability,
            context
          });
        }
      }
    }

    return results;
  }

  private processImmediateQueue(): void {
    while (this.immediateQueue.length > 0) {
      const trigger = this.immediateQueue.shift()!;

      if (
        !this.state.cards[trigger.sourceId] &&
        trigger.context.event?.type !== "cardDestroyed"
      ) {
        continue;
      }

      if (trigger.ability.targets?.length) {
        // A real client should request choices here.
        // For engine-only deterministic operation, auto-select only when
        // each target declaration has exactly enough legal candidates.
        this.autoSelectTargets(
          trigger.ability.targets,
          trigger.context
        );
      }

      for (const effect of trigger.ability.effects) {
        this.resolveEffect(effect, trigger.context);
        this.checkStateBasedActions();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Conditions / expressions
  // ---------------------------------------------------------------------------

  evaluateCondition(
    condition: Condition,
    context: ResolutionContext
  ): boolean {
    switch (condition.type) {
      case "and":
        return condition.conditions.every(condition =>
          this.evaluateCondition(condition, context)
        );

      case "or":
        return condition.conditions.some(condition =>
          this.evaluateCondition(condition, context)
        );

      case "not":
        return !this.evaluateCondition(
          condition.condition,
          context
        );

      case "sourceInZone":
        return (
          this.state.cards[context.sourceId]?.zone ===
          condition.zone
        );

      case "sourceIsEventCard":
        return (
          this.getEventCardId(context.event) ===
          context.sourceId
        );

      case "eventCardControlledBy": {
        const eventCardId = this.getEventCardId(context.event);

        if (!eventCardId) {
          return false;
        }

        const eventCard = this.state.cards[eventCardId];

        if (!eventCard) {
          return false;
        }

        return (
          eventCard.controllerId ===
          this.resolvePlayerRef(condition.player, context).id
        );
      }

      case "targetExists":
        return this.resolveTargetRef(
          condition.target,
          context
        ) !== undefined;

      case "cardTypeIs": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        return (
          !!cardId &&
          this.getDefinition(cardId).type ===
            condition.cardType
        );
      }

      case "statCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        return compare(
          this.getStat(cardId, condition.stat),
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "counterCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        const count =
          this.requireCard(cardId).counters[
            condition.counter
          ] ?? 0;

        return compare(
          count,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }
    }
  }

  evaluateNumber(
    expression: NumberExpression,
    context: ResolutionContext
  ): number {
    if (typeof expression === "number") {
      return expression;
    }

    switch (expression.type) {
      case "stat": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        assert(cardId, "Unable to resolve stat target.");

        return this.getStat(cardId, expression.stat);
      }

      case "counter": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        assert(cardId, "Unable to resolve counter target.");

        return (
          this.requireCard(cardId).counters[
            expression.counter
          ] ?? 0
        );
      }

      case "count":
        return this.queryCards(
          expression.selector,
          context
        ).length;

      case "add":
        return expression.values.reduce(
          (sum, value) =>
            (sum as number) + this.evaluateNumber(value, context),
          0
        ) as number;

      case "multiply":
        return expression.values.reduce(
          (product, value) =>
            (product as number) * this.evaluateNumber(value, context),
          1
        ) as number;
    }
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  private validateTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): void {
    for (const declaration of declarations) {
      const selected =
        context.selected[declaration.id] ?? [];

      assert(
        selected.length === declaration.count,
        `Target '${declaration.id}' requires ${declaration.count} selection(s).`
      );

      const legal = new Set(
        this.queryCards(
          declaration.selector,
          context
        ).map(card => card.id)
      );

      for (const selectedId of selected) {
        assert(
          legal.has(selectedId),
          `Illegal target '${selectedId}' for '${declaration.id}'.`
        );
      }
    }
  }

  private autoSelectTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): void {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.queryCards(
        declaration.selector,
        context
      );

      assert(
        candidates.length === declaration.count,
        `Triggered ability '${context.abilityId}' requires a choice for target '${declaration.id}'.`
      );

      context.selected[declaration.id] =
        candidates.map(card => card.id);
    }
  }

  private matchesSelector(
    card: CardInstance,
    selector: CardSelector,
    context: ResolutionContext
  ): boolean {
    if (selector.controller) {
      const self = context.controllerId;
      const opponent = this.getOpponent(self).id;

      if (
        selector.controller === "self" &&
        card.controllerId !== self
      ) {
        return false;
      }

      if (
        selector.controller === "opponent" &&
        card.controllerId !== opponent
      ) {
        return false;
      }
    }

    if (selector.owner) {
      const self = context.controllerId;
      const opponent = this.getOpponent(self).id;

      if (
        selector.owner === "self" &&
        card.ownerId !== self
      ) {
        return false;
      }

      if (
        selector.owner === "opponent" &&
        card.ownerId !== opponent
      ) {
        return false;
      }
    }

    if (selector.zone) {
      const zones = Array.isArray(selector.zone)
        ? selector.zone
        : [selector.zone];

      if (!zones.includes(card.zone)) {
        return false;
      }
    }

    const definition = this.getDefinition(card.id);

    if (
      selector.type &&
      definition.type !== selector.type
    ) {
      return false;
    }

    if (
      selector.subtype &&
      !definition.subtype.includes(selector.subtype)
    ) {
      return false;
    }

    if (
      selector.depleted !== undefined &&
      card.depleted !== selector.depleted
    ) {
      return false;
    }

    if (
      selector.conditions &&
      !selector.conditions.every(condition =>
        this.evaluateCondition(condition, {
          ...context,
          selected: {
            ...context.selected,
            __candidate: [card.id]
          }
        })
      )
    ) {
      return false;
    }

    return true;
  }

  private resolveTargetRef(
    ref: TargetRef,
    context: ResolutionContext
  ): CardInstanceId | undefined {
    if (ref === "source") {
      return context.sourceId;
    }

    if (ref.type === "card") {
      return ref.id;
    }

    return context.selected[ref.id]?.[0];
  }

  private resolvePlayerRef(
    ref: PlayerRef,
    context: ResolutionContext
  ): PlayerState {
    if (ref === "controller") {
      return this.requirePlayer(context.controllerId);
    }

    if (ref === "owner") {
      return this.requirePlayer(
        this.requireCard(context.sourceId).ownerId
      );
    }

    if (ref === "activePlayer") {
      return this.requirePlayer(
        this.state.activePlayerId
      );
    }

    if (ref === "opponent") {
      return this.getOpponent(context.controllerId);
    }

    return this.requirePlayer(ref.id);
  }

  // ---------------------------------------------------------------------------
  // Costs
  // ---------------------------------------------------------------------------

  private canPayCosts(
    costs: Cost[],
    context: ResolutionContext
  ): boolean {
    // Simulate the costs against a cheap clone so multi-cost abilities
    // are checked transactionally.
    const clone = structuredClone(this.state);

    try {
      const engine = new SpoilsEngine(
        Object.values(this.definitions),
        clone
      );

      for (const cost of costs) {
        engine.payCost(cost, context, false);
      }

      return true;
    } catch {
      return false;
    }
  }

  private payCosts(
    costs: Cost[],
    context: ResolutionContext
  ): void {
    for (const cost of costs) {
      this.payCost(cost, context, true);
    }
  }

  private payCost(
    cost: Cost,
    context: ResolutionContext,
    emitEvents: boolean
  ): void {
    switch (cost.type) {
      case "payResources": {
        const player = this.requirePlayer(
          context.controllerId
        );

        const amount = this.evaluateNumber(
          cost.amount,
          context
        );

        assert(
          amount >= 0 &&
            player.resources >= amount,
          "Not enough resources."
        );

        player.resources -= amount;
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing depletion target.");

        const card = this.requireCard(targetId);

        assert(!card.depleted, "Card is already depleted.");

        card.depleted = true;

        if (emitEvents) {
          this.emit({
            type: "cardDepleted",
            cardId: card.id
          });
        }

        return;
      }

      case "discard": {
        const player = this.resolvePlayerRef(
          cost.player,
          context
        );

        const legal = this.queryCards(
          {
            ...cost.selector,
            controller:
              cost.selector.controller ?? "self",
            zone: cost.selector.zone ?? "hand"
          },
          context
        ).filter(card => card.controllerId === player.id);

        assert(
          legal.length >= cost.count,
          "Not enough cards available to discard."
        );

        // Barebones deterministic payment. A UI should normally supply
        // explicit selected cost cards.
        for (const card of legal.slice(0, cost.count)) {
          this.moveCard(card.id, "discard", emitEvents);
        }

        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing destroy-cost target.");

        this.destroyCard(targetId, emitEvents);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  resolveEffect(
    effect: Effect,
    context: ResolutionContext
  ): void {
    switch (effect.type) {
      case "draw": {
        const player = this.resolvePlayerRef(
          effect.player,
          context
        );

        const amount = this.evaluateNumber(
          effect.amount,
          context
        );

        for (let i = 0; i < amount; i++) {
          const cardId = player.deck.shift();

          if (!cardId) {
            break;
          }

          this.moveCard(cardId, "hand");
        }

        return;
      }

      case "dealDamage": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing damage target.");

        const target = this.requireCard(targetId);
        const amount = this.evaluateNumber(
          effect.amount,
          context
        );

        target.damage += amount;

        this.emit({
          type: "damageDealt",
          sourceId: context.sourceId,
          targetId,
          amount
        });

        return;
      }

      case "modifyInfluence": {
        const player = this.resolvePlayerRef(
          effect.player,
          context
        );

        player.influence += this.evaluateNumber(
          effect.amount,
          context
        );

        return;
      }

      case "moveCard": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing move target.");

        this.moveCard(targetId, effect.to);
        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing destroy target.");

        this.destroyCard(targetId);
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing deplete target.");

        const card = this.requireCard(targetId);

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId: card.id
          });
        }

        return;
      }

      case "restore": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing restore target.");

        const card = this.requireCard(targetId);

        if (card.depleted) {
          card.depleted = false;

          this.emit({
            type: "cardRestored",
            cardId: card.id
          });
        }

        return;
      }

      case "addCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing counter target.");

        const card = this.requireCard(targetId);

        card.counters[effect.counter] =
          (card.counters[effect.counter] ?? 0) +
          this.evaluateNumber(effect.amount, context);

        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing counter target.");

        const card = this.requireCard(targetId);

        card.counters[effect.counter] = Math.max(
          0,
          (card.counters[effect.counter] ?? 0) -
            this.evaluateNumber(effect.amount, context)
        );

        return;
      }

      case "createModifier": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        assert(targetId, "Missing modifier target.");

        this.state.modifiers.push({
          id: nextId("modifier"),
          sourceId: context.sourceId,
          sourceAbilityId: context.abilityId,
          targetId,
          stat: effect.stat,
          operation: effect.operation,
          value: this.evaluateNumber(
            effect.value,
            context
          ),
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous modifiers
  // ---------------------------------------------------------------------------

  private getContinuousModifiers(
    targetId: CardInstanceId
  ): RuntimeModifier[] {
    const results: RuntimeModifier[] = [];

    for (const source of Object.values(
      this.state.cards
    )) {
      if (source.zone !== "play") {
        continue;
      }

      const definition = this.getDefinition(
        source.id
      );

      for (const ability of definition.behavior?.abilities ?? []) {
        if (ability.type !== "continuous") {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(
            ability.condition,
            context
          )
        ) {
          continue;
        }

        for (const modifier of ability.modifiers) {
          const resolvedTarget = this.resolveTargetRef(
            modifier.target,
            context
          );

          if (resolvedTarget !== targetId) {
            continue;
          }

          results.push({
            id: `continuous:${source.id}:${ability.id}:${targetId}:${modifier.stat}`,
            sourceId: source.id,
            sourceAbilityId: ability.id,
            targetId,
            stat: modifier.stat,
            operation: modifier.operation,
            value: this.evaluateNumber(
              modifier.value,
              context
            ),
            duration: {
              type: "whileSourceInPlay"
            },
            createdTurn: this.state.turn
          });
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // State-based actions
  // ---------------------------------------------------------------------------

  private checkStateBasedActions(): void {
    let changed = true;

    while (changed) {
      changed = false;

      for (const card of Object.values(
        this.state.cards
      )) {
        if (
          card.zone !== "play" ||
          this.getDefinition(card.id).type !==
            "character"
        ) {
          continue;
        }

        const life = this.getStat(card.id, "life");

        if (life > 0 && card.damage >= life) {
          this.destroyCard(card.id);
          changed = true;
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Zones / destruction
  // ---------------------------------------------------------------------------

  private moveCard(
    cardId: CardInstanceId,
    to: Zone,
    emitEvents = true
  ): void {
    const card = this.requireCard(cardId);
    const from = card.zone;

    if (from === to) {
      return;
    }

    this.removeFromAllPlayerZones(cardId);

    card.zone = to;

    const owner = this.requirePlayer(card.ownerId);
    const controller = this.requirePlayer(
      card.controllerId
    );

    const zoneOwner =
      to === "deck" ||
      to === "hand" ||
      to === "discard" ||
      to === "void"
        ? owner
        : controller;

    const array = this.getZoneArray(zoneOwner, to);

    if (array) {
      array.push(cardId);
    }

    if (emitEvents) {
      this.emit({
        type: "cardMoved",
        cardId,
        from,
        to
      });
    }
  }

  private destroyCard(
    cardId: CardInstanceId,
    emitEvents = true
  ): void {
    const card = this.requireCard(cardId);

    if (card.zone !== "play") {
      throw new Error(
        `Cannot destroy '${cardId}' from zone '${card.zone}'.`
      );
    }

    const previousController =
      card.controllerId;

    card.damage = 0;
    card.depleted = false;

    this.moveCard(cardId, "discard", emitEvents);

    if (emitEvents) {
      this.emit({
        type: "cardDestroyed",
        cardId,
        controllerId: previousController
      });
    }
  }

  private removeFromAllPlayerZones(
    cardId: CardInstanceId
  ): void {
    for (const player of Object.values(
      this.state.players
    )) {
      player.deck = player.deck.filter(
        id => id !== cardId
      );
      player.hand = player.hand.filter(
        id => id !== cardId
      );
      player.play = player.play.filter(
        id => id !== cardId
      );
      player.discard = player.discard.filter(
        id => id !== cardId
      );
      player.void = player.void.filter(
        id => id !== cardId
      );
    }
  }

  private getZoneArray(
    player: PlayerState,
    zone: Zone
  ): CardInstanceId[] | undefined {
    switch (zone) {
      case "deck":
        return player.deck;
      case "hand":
        return player.hand;
      case "play":
        return player.play;
      case "discard":
        return player.discard;
      case "void":
        return player.void;
      case "deploying":
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Turn handling
  // ---------------------------------------------------------------------------

  private endTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player can end the turn."
    );

    assert(
      this.responseStack.length === 0,
      "Cannot end turn with unresolved responses."
    );

    this.emit({
      type: "turnEnding",
      playerId
    });

    this.state.modifiers =
      this.state.modifiers.filter(modifier => {
        if (
          modifier.duration.type ===
            "untilEndOfTurn" &&
          modifier.createdTurn <= this.state.turn
        ) {
          return false;
        }

        if (
          modifier.duration.type ===
          "whileSourceInPlay"
        ) {
          return (
            !!modifier.sourceId &&
            this.state.cards[modifier.sourceId]
              ?.zone === "play"
          );
        }

        return true;
      });

    const next = this.getOpponent(playerId);

    this.state.turn++;
    this.state.activePlayerId = next.id;
    this.state.priorityPlayerId = next.id;
    this.consecutivePasses = 0;

    for (const cardId of next.play) {
      const card = this.requireCard(cardId);
      card.depleted = false;
    }

    this.emit({
      type: "turnStarted",
      playerId: next.id
    });
  }

  // ---------------------------------------------------------------------------
  // Minimal battle system
  // ---------------------------------------------------------------------------

  private declareAttack(
    playerId: PlayerId,
    attackerIds: CardInstanceId[],
    target: BattleState["target"]
  ): void {
    assert(!this.state.battle, "Battle already in progress.");
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may attack."
    );
    assert(attackerIds.length > 0, "No attackers selected.");

    for (const attackerId of attackerIds) {
      const attacker = this.requireCard(attackerId);

      assert(
        attacker.controllerId === playerId,
        "You do not control an attacker."
      );
      assert(
        attacker.zone === "play",
        "Attacker must be in play."
      );
      assert(
        this.getDefinition(attackerId).type ===
          "character",
        "Only characters can attack."
      );
      assert(
        !attacker.depleted,
        "Depleted characters cannot attack."
      );

      attacker.depleted = true;
    }

    const defenderId =
      target.type === "faction"
        ? target.playerId
        : this.requireCard(target.cardId)
            .controllerId;

    const battle: BattleState = {
      id: nextId("battle"),
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      target,
      parties: attackerIds.map(attackerId => ({
        attackerId,
        blockerIds: []
      })),
      phase: "blocking"
    };

    this.state.battle = battle;

    this.emit({
      type: "battleStarted",
      battleId: battle.id
    });
  }

  private declareBlockers(
    playerId: PlayerId,
    blocks: Record<
      CardInstanceId,
      CardInstanceId[]
    >
  ): void {
    const battle = this.state.battle;

    assert(battle, "No battle in progress.");
    assert(
      battle.defenderPlayerId === playerId,
      "Only the defending player can block."
    );
    assert(
      battle.phase === "blocking",
      "Battle is not accepting blockers."
    );

    const usedBlockers = new Set<CardInstanceId>();

    for (const party of battle.parties) {
      const blockerIds =
        blocks[party.attackerId] ?? [];

      for (const blockerId of blockerIds) {
        const blocker = this.requireCard(blockerId);

        assert(
          blocker.controllerId === playerId,
          "You do not control that blocker."
        );
        assert(
          blocker.zone === "play",
          "Blocker must be in play."
        );
        assert(
          this.getDefinition(blockerId).type ===
            "character",
          "Only characters can block."
        );
        assert(
          !blocker.depleted,
          "Depleted characters cannot block."
        );
        assert(
          !usedBlockers.has(blockerId),
          "A character cannot block twice."
        );

        usedBlockers.add(blockerId);
      }

      party.blockerIds = [...blockerIds];
    }

    battle.phase = "speed";
  }

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
  resolveBattle(): void {
    const battle = this.state.battle;

    assert(battle, "No battle in progress.");
    assert(
      battle.phase === "speed",
      "Battle is not ready to resolve."
    );

    const participants = new Set<CardInstanceId>();

    for (const party of battle.parties) {
      participants.add(party.attackerId);

      for (const blockerId of party.blockerIds) {
        participants.add(blockerId);
      }
    }

    const speeds = [
      ...new Set(
        [...participants].map(cardId =>
          this.getStat(cardId, "speed")
        )
      )
    ].sort((a, b) => b - a);

    for (const speed of speeds) {
      const pendingDamage: Array<{
        sourceId: CardInstanceId;
        target:
          | { type: "card"; cardId: CardInstanceId }
          | { type: "faction"; playerId: PlayerId };
        amount: number;
      }> = [];

      for (const party of battle.parties) {
        const attacker =
          this.state.cards[party.attackerId];

        if (
          attacker?.zone === "play" &&
          this.getStat(attacker.id, "speed") ===
            speed
        ) {
          const livingBlockers =
            party.blockerIds.filter(
              blockerId =>
                this.state.cards[blockerId]?.zone ===
                "play"
            );

          if (livingBlockers.length > 0) {
            pendingDamage.push({
              sourceId: attacker.id,
              target: {
                type: "card",
                cardId: livingBlockers[0]
              },
              amount: this.getStat(
                attacker.id,
                "strength"
              )
            });
          } else {
            pendingDamage.push({
              sourceId: attacker.id,
              target: battle.target,
              amount: this.getStat(
                attacker.id,
                "strength"
              )
            });
          }
        }

        for (const blockerId of party.blockerIds) {
          const blocker =
            this.state.cards[blockerId];

          if (
            blocker?.zone === "play" &&
            this.getStat(blocker.id, "speed") ===
              speed &&
            this.state.cards[party.attackerId]
              ?.zone === "play"
          ) {
            pendingDamage.push({
              sourceId: blocker.id,
              target: {
                type: "card",
                cardId: party.attackerId
              },
              amount: this.getStat(
                blocker.id,
                "strength"
              )
            });
          }
        }
      }

      for (const damage of pendingDamage) {
        if (damage.target.type === "card") {
          const target =
            this.state.cards[
              damage.target.cardId
            ];

          if (!target || target.zone !== "play") {
            continue;
          }

          target.damage += damage.amount;

          this.emit({
            type: "damageDealt",
            sourceId: damage.sourceId,
            targetId: target.id,
            amount: damage.amount
          });
        } else {
          this.requirePlayer(
            damage.target.playerId
          ).influence -= damage.amount;
        }
      }

      this.checkStateBasedActions();
    }

    const battleId = battle.id;
    battle.phase = "finished";
    this.state.battle = undefined;

    this.emit({
      type: "battleEnded",
      battleId
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private meetsThreshold(
    playerId: PlayerId,
    threshold: string | number
  ): boolean {
    if (!threshold || threshold === 0 || threshold === "") {
      return true;
    }

    const required = parseThreshold(threshold);
    const player = this.requirePlayer(playerId);

    for (const trade of [
      "rage",
      "greed",
      "deception",
      "elitism",
      "obsession"
    ] as const) {
      if (
        (player.thresholds[trade] ?? 0) <
        (required[trade] ?? 0)
      ) {
        return false;
      }
    }

    return true;
  }

  private getEventCardId(
    event?: GameEvent
  ): CardInstanceId | undefined {
    if (!event) {
      return undefined;
    }

    switch (event.type) {
      case "cardPlayed":
      case "cardEnteredPlay":
      case "cardMoved":
      case "cardDestroyed":
      case "cardDepleted":
      case "cardRestored":
      case "abilityActivated":
        return event.cardId;

      case "damageDealt":
        return event.targetId;

      default:
        return undefined;
    }
  }

  private resetPriorityAfterAction(
    actingPlayerId: PlayerId
  ): void {
    this.consecutivePasses = 0;
    this.state.priorityPlayerId =
      this.getOpponent(actingPlayerId).id;
  }

  private requireCard(
    id: CardInstanceId
  ): CardInstance {
    const card = this.state.cards[id];

    assert(card, `Card '${id}' not found.`);

    return card;
  }

  private requirePlayer(
    id: PlayerId
  ): PlayerState {
    const player = this.state.players[id];

    assert(player, `Player '${id}' not found.`);

    return player;
  }

  private getOpponent(
    playerId: PlayerId
  ): PlayerState {
    const opponent = Object.values(
      this.state.players
    ).find(player => player.id !== playerId);

    assert(
      opponent,
      "This barebones engine currently expects exactly two players."
    );

    return opponent;
  }
}

// -----------------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------------

export function createCardInstance(
  definitionId: CardDefinitionId,
  ownerId: PlayerId,
  zone: Zone = "deck"
): CardInstance {
  return {
    id: nextId("card"),
    definitionId,
    ownerId,
    controllerId: ownerId,
    zone,
    depleted: false,
    damage: 0,
    counters: {}
  };
}

export function createTwoPlayerGame(
  playerA: {
    id: PlayerId;
    name: string;
    influence?: number;
  },
  playerB: {
    id: PlayerId;
    name: string;
    influence?: number;
  },
  cards: CardInstance[]
): GameState {
  const players: Record<PlayerId, PlayerState> = {};

  for (const player of [playerA, playerB]) {
    players[player.id] = {
      id: player.id,
      name: player.name,
      influence: player.influence ?? 25,
      resources: 0,
      thresholds: {},
      deck: [],
      hand: [],
      play: [],
      discard: [],
      void: []
    };
  }

  const cardMap: Record<
    CardInstanceId,
    CardInstance
  > = {};

  for (const card of cards) {
    cardMap[card.id] = card;

    const player =
      players[
        card.zone === "play"
          ? card.controllerId
          : card.ownerId
      ];

    assert(
      player,
      `Unknown player for card '${card.id}'.`
    );

    switch (card.zone) {
      case "deck":
        player.deck.push(card.id);
        break;
      case "hand":
        player.hand.push(card.id);
        break;
      case "play":
        player.play.push(card.id);
        break;
      case "discard":
        player.discard.push(card.id);
        break;
      case "void":
        player.void.push(card.id);
        break;
      case "deploying":
        break;
    }
  }

  return {
    turn: 1,
    activePlayerId: playerA.id,
    priorityPlayerId: playerA.id,
    players,
    cards: cardMap,
    modifiers: []
  };
}

// -----------------------------------------------------------------------------
// Real card catalog from cards.json
// -----------------------------------------------------------------------------

export const CARD_CATALOG = cardsJson as CardDefinition[];

export function getCatalogCard(
  id: CardDefinitionId
): CardDefinition {
  const card = CARD_CATALOG.find(card => card.id === id);

  assert(
    card,
    `Card definition '${id}' was not found in cards.json.`
  );

  return card;
}

export function findCatalogCard(
  name: string,
  set?: string
): CardDefinition {
  const matches = CARD_CATALOG.filter(
    card =>
      card.name === name &&
      (set === undefined || card.set === set)
  );

  assert(
    matches.length > 0,
    `Card '${name}'${set ? ` from '${set}'` : ""} was not found in cards.json.`
  );

  assert(
    matches.length === 1,
    `Card '${name}' matched ${matches.length} entries. Specify a set or use its id.`
  );

  return matches[0];
}


/*
Project layout:

  spoils-engine-catalog.ts
  cards.json

tsconfig.json needs:

{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}

Behavior can be attached later without changing the scraped fields:

const creeper = findCatalogCard(
  "Compulsive Creeper",
  "1st Edition"
);

creeper.behavior = {
  abilities: [
    // declarative abilities
  ]
};
*/
