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

import {
  GameState,
  CardInstance,
  PlayerState,
  RuntimeModifier,
  BattleState,
} from "./runtime_state.js";
import {
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  Zone,
  Stat,
  Trade,
} from "./ids_primitives.js";
import {
  Threshold,
  CardDefinition,
  ActivatedAbility,
} from "./static_card_data.js";
import {
  PlayerRef,
  TargetRef,
  NumberExpression,
  CardSelector,
  TargetDeclaration,
} from "./references_expressions_selectors.js";
import { Condition } from "./Condition.js";
import { Cost } from "./Cost.js";
import { Effect } from "./Effect.js";
import { GameEvent } from "./events.js";
import {
  StackItem,
  TriggerResolution,
  ResolutionContext,
} from "./resolution_context.js";
import { GameAction } from "./GameAction.js";
import { assert, nextId, compare, structuredClone } from "./utils.js";

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

export class SpoilsEngine {
  readonly definitions: Record<CardDefinitionId, CardDefinition>;
  readonly state: GameState;

  readonly responseStack: StackItem[] = [];
  readonly immediateQueue: TriggerResolution[] = [];

  private consecutivePasses = 0;

  constructor(definitions: CardDefinition[], initialState: GameState) {
    this.definitions = Object.fromEntries(
      definitions.map((def) => [def.id, def]),
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
      `Missing definition '${card.definitionId}' for card '${cardId}'`,
    );

    return definition;
  }

  getStat(cardId: CardInstanceId, stat: Stat): number {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    let value =
      stat === "influence"
        ? (definition.stats?.influence ?? 0)
        : (definition.stats?.[stat] ?? 0);

    const modifiers = [
      ...this.getContinuousModifiers(cardId),
      ...this.state.modifiers.filter(
        (modifier) => modifier.targetId === cardId,
      ),
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
    playerId: PlayerId,
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

      for (const ability of definition.abilities ?? []) {
        if (ability.type !== "activated") {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: playerId,
          abilityId: ability.id,
          selected: {},
        };

        if (
          (!ability.condition ||
            this.evaluateCondition(ability.condition, context)) &&
          this.canPayCosts(ability.costs ?? [], context)
        ) {
          result.push({
            cardId: card.id,
            ability,
          });
        }
      }
    }

    return result;
  }

  queryCards(
    selector: CardSelector,
    context: ResolutionContext,
  ): CardInstance[] {
    return Object.values(this.state.cards).filter((card) =>
      this.matchesSelector(card, selector, context),
    );
  }

  // ---------------------------------------------------------------------------
  // Card play / response stack
  // ---------------------------------------------------------------------------

  private playCard(action: Extract<GameAction, { type: "playCard" }>): void {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);

    assert(
      card.controllerId === action.playerId,
      "You do not control that card.",
    );

    assert(card.zone === "hand", "Card must be in your hand.");

    assert(
      this.meetsThreshold(action.playerId, definition.threshold),
      "Threshold requirements are not met.",
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      selected: action.selected ?? {},
    };

    this.validateTargetDeclarations(
      this.getPlayTargetDeclarations(definition),
      context,
    );

    const resourceCost = definition.cost ?? 0;

    assert(
      this.state.players[action.playerId].resources >= resourceCost,
      "Not enough resources.",
    );

    this.state.players[action.playerId].resources -= resourceCost;

    this.moveCard(card.id, "deploying");

    this.emit({
      type: "cardPlayed",
      cardId: card.id,
      playerId: action.playerId,
    });

    // Tactics resolve their abilities and then go to discard.
    // Permanents enter play when their stack item resolves.
    const effects =
      definition.type === "tactic" ? this.getTacticEffects(definition) : [];

    this.responseStack.push({
      id: nextId("stack"),
      sourceId: card.id,
      controllerId: action.playerId,
      kind: "card",
      effects,
      context,
    });

    this.resetPriorityAfterAction(action.playerId);
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition,
  ): TargetDeclaration[] {
    if (definition.type !== "tactic") {
      return [];
    }

    // Barebones convention:
    // tactic cards use the first activated ability-shaped entry as their spell body.
    const tacticAbility = definition.abilities?.find(
      (ability) => ability.type === "activated",
    ) as ActivatedAbility | undefined;

    return tacticAbility?.targets ?? [];
  }

  private getTacticEffects(definition: CardDefinition): Effect[] {
    const tacticAbility = definition.abilities?.find(
      (ability) => ability.type === "activated",
    ) as ActivatedAbility | undefined;

    return tacticAbility?.effects ?? [];
  }

  // ---------------------------------------------------------------------------
  // Activated abilities
  // ---------------------------------------------------------------------------

  private activateAbility(
    action: Extract<GameAction, { type: "activateAbility" }>,
  ): void {
    const card = this.requireCard(action.cardId);

    assert(card.zone === "play", "Source must be in play.");
    assert(
      card.controllerId === action.playerId,
      "You do not control that card.",
    );

    const ability = this.getDefinition(card.id).abilities?.find(
      (ability) =>
        ability.id === action.abilityId && ability.type === "activated",
    ) as ActivatedAbility | undefined;

    assert(ability, "Activated ability not found.");

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      abilityId: ability.id,
      selected: action.selected ?? {},
    };

    if (ability.condition) {
      assert(
        this.evaluateCondition(ability.condition, context),
        "Ability condition is not satisfied.",
      );
    }

    this.validateTargetDeclarations(ability.targets ?? [], context);

    assert(
      this.canPayCosts(ability.costs ?? [], context),
      "Ability costs cannot be paid.",
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
      context,
    });

    this.emit({
      type: "abilityActivated",
      cardId: card.id,
      abilityId: ability.id,
      playerId: action.playerId,
    });

    this.resetPriorityAfterAction(action.playerId);
  }

  private passPriority(playerId: PlayerId): void {
    assert(
      this.state.priorityPlayerId === playerId,
      "It is not your priority.",
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

      this.state.priorityPlayerId = this.state.activePlayerId;

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
          playerId: card.controllerId,
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

      for (const ability of definition.abilities ?? []) {
        if (ability.type !== "triggered" || ability.event !== event.type) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: card.controllerId,
          abilityId: ability.id,
          event,
          selected: {},
        };

        if (
          !ability.condition ||
          this.evaluateCondition(ability.condition, context)
        ) {
          results.push({
            sourceId: card.id,
            ability,
            context,
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
        this.autoSelectTargets(trigger.ability.targets, trigger.context);
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

  evaluateCondition(condition: Condition, context: ResolutionContext): boolean {
    switch (condition.type) {
      case "and":
        return condition.conditions.every((condition) =>
          this.evaluateCondition(condition, context),
        );

      case "or":
        return condition.conditions.some((condition) =>
          this.evaluateCondition(condition, context),
        );

      case "not":
        return !this.evaluateCondition(condition.condition, context);

      case "sourceInZone":
        return this.state.cards[context.sourceId]?.zone === condition.zone;

      case "sourceIsEventCard":
        return this.getEventCardId(context.event) === context.sourceId;

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
        return this.resolveTargetRef(condition.target, context) !== undefined;

      case "cardTypeIs": {
        const cardId = this.resolveTargetRef(condition.target, context);

        return (
          !!cardId && this.getDefinition(cardId).type === condition.cardType
        );
      }

      case "statCompare": {
        const cardId = this.resolveTargetRef(condition.target, context);

        if (!cardId) {
          return false;
        }

        return compare(
          this.getStat(cardId, condition.stat),
          condition.operator,
          this.evaluateNumber(condition.value, context),
        );
      }

      case "counterCompare": {
        const cardId = this.resolveTargetRef(condition.target, context);

        if (!cardId) {
          return false;
        }

        const count = this.requireCard(cardId).counters[condition.counter] ?? 0;

        return compare(
          count,
          condition.operator,
          this.evaluateNumber(condition.value, context),
        );
      }
    }
  }

  evaluateNumber(
    expression: NumberExpression,
    context: ResolutionContext,
  ): number {
    if (typeof expression === "number") {
      return expression;
    }

    switch (expression.type) {
      case "stat": {
        const cardId = this.resolveTargetRef(expression.target, context);

        assert(cardId, "Unable to resolve stat target.");

        return this.getStat(cardId, expression.stat);
      }

      case "counter": {
        const cardId = this.resolveTargetRef(expression.target, context);

        assert(cardId, "Unable to resolve counter target.");

        return this.requireCard(cardId).counters[expression.counter] ?? 0;
      }

      case "count":
        return this.queryCards(expression.selector, context).length;

      case "add":
        return expression.values.reduce(
          (sum, value) => (sum as number) + this.evaluateNumber(value, context),
          0,
        ) as number;

      case "multiply":
        return expression.values.reduce(
          (product, value) =>
            (product as number) * this.evaluateNumber(value, context),
          1,
        ) as number;
    }
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  private validateTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext,
  ): void {
    for (const declaration of declarations) {
      const selected = context.selected[declaration.id] ?? [];

      assert(
        selected.length === declaration.count,
        `Target '${declaration.id}' requires ${declaration.count} selection(s).`,
      );

      const legal = new Set(
        this.queryCards(declaration.selector, context).map((card) => card.id),
      );

      for (const selectedId of selected) {
        assert(
          legal.has(selectedId),
          `Illegal target '${selectedId}' for '${declaration.id}'.`,
        );
      }
    }
  }

  private autoSelectTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext,
  ): void {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.queryCards(declaration.selector, context);

      assert(
        candidates.length === declaration.count,
        `Triggered ability '${context.abilityId}' requires a choice for target '${declaration.id}'.`,
      );

      context.selected[declaration.id] = candidates.map((card) => card.id);
    }
  }

  private matchesSelector(
    card: CardInstance,
    selector: CardSelector,
    context: ResolutionContext,
  ): boolean {
    if (selector.controller) {
      const self = context.controllerId;
      const opponent = this.getOpponent(self).id;

      if (selector.controller === "self" && card.controllerId !== self) {
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

      if (selector.owner === "self" && card.ownerId !== self) {
        return false;
      }

      if (selector.owner === "opponent" && card.ownerId !== opponent) {
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

    if (selector.type && definition.type !== selector.type) {
      return false;
    }

    if (selector.subtype && !definition.subtypes?.includes(selector.subtype)) {
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
      !selector.conditions.every((condition) =>
        this.evaluateCondition(condition, {
          ...context,
          selected: {
            ...context.selected,
            __candidate: [card.id],
          },
        }),
      )
    ) {
      return false;
    }

    return true;
  }

  private resolveTargetRef(
    ref: TargetRef,
    context: ResolutionContext,
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
    context: ResolutionContext,
  ): PlayerState {
    if (ref === "controller") {
      return this.requirePlayer(context.controllerId);
    }

    if (ref === "owner") {
      return this.requirePlayer(this.requireCard(context.sourceId).ownerId);
    }

    if (ref === "activePlayer") {
      return this.requirePlayer(this.state.activePlayerId);
    }

    if (ref === "opponent") {
      return this.getOpponent(context.controllerId);
    }

    return this.requirePlayer(ref.id);
  }

  // ---------------------------------------------------------------------------
  // Costs
  // ---------------------------------------------------------------------------

  private canPayCosts(costs: Cost[], context: ResolutionContext): boolean {
    // Simulate the costs against a cheap clone so multi-cost abilities
    // are checked transactionally.
    const clone = structuredClone(this.state);

    try {
      const engine = new SpoilsEngine(Object.values(this.definitions), clone);

      for (const cost of costs) {
        engine.payCost(cost, context, false);
      }

      return true;
    } catch {
      return false;
    }
  }

  private payCosts(costs: Cost[], context: ResolutionContext): void {
    for (const cost of costs) {
      this.payCost(cost, context, true);
    }
  }

  private payCost(
    cost: Cost,
    context: ResolutionContext,
    emitEvents: boolean,
  ): void {
    switch (cost.type) {
      case "payResources": {
        const player = this.requirePlayer(context.controllerId);

        const amount = this.evaluateNumber(cost.amount, context);

        assert(
          amount >= 0 && player.resources >= amount,
          "Not enough resources.",
        );

        player.resources -= amount;
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(cost.target, context);

        assert(targetId, "Missing depletion target.");

        const card = this.requireCard(targetId);

        assert(!card.depleted, "Card is already depleted.");

        card.depleted = true;

        if (emitEvents) {
          this.emit({
            type: "cardDepleted",
            cardId: card.id,
          });
        }

        return;
      }

      case "discard": {
        const player = this.resolvePlayerRef(cost.player, context);

        const legal = this.queryCards(
          {
            ...cost.selector,
            controller: cost.selector.controller ?? "self",
            zone: cost.selector.zone ?? "hand",
          },
          context,
        ).filter((card) => card.controllerId === player.id);

        assert(
          legal.length >= cost.count,
          "Not enough cards available to discard.",
        );

        // Barebones deterministic payment. A UI should normally supply
        // explicit selected cost cards.
        for (const card of legal.slice(0, cost.count)) {
          this.moveCard(card.id, "discard", emitEvents);
        }

        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(cost.target, context);

        assert(targetId, "Missing destroy-cost target.");

        this.destroyCard(targetId, emitEvents);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  resolveEffect(effect: Effect, context: ResolutionContext): void {
    switch (effect.type) {
      case "draw": {
        const player = this.resolvePlayerRef(effect.player, context);

        const amount = this.evaluateNumber(effect.amount, context);

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
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing damage target.");

        const target = this.requireCard(targetId);
        const amount = this.evaluateNumber(effect.amount, context);

        target.damage += amount;

        this.emit({
          type: "damageDealt",
          sourceId: context.sourceId,
          targetId,
          amount,
        });

        return;
      }

      case "modifyInfluence": {
        const player = this.resolvePlayerRef(effect.player, context);

        player.influence += this.evaluateNumber(effect.amount, context);

        return;
      }

      case "moveCard": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing move target.");

        this.moveCard(targetId, effect.to);
        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing destroy target.");

        this.destroyCard(targetId);
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing deplete target.");

        const card = this.requireCard(targetId);

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId: card.id,
          });
        }

        return;
      }

      case "restore": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing restore target.");

        const card = this.requireCard(targetId);

        if (card.depleted) {
          card.depleted = false;

          this.emit({
            type: "cardRestored",
            cardId: card.id,
          });
        }

        return;
      }

      case "addCounter": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing counter target.");

        const card = this.requireCard(targetId);

        card.counters[effect.counter] =
          (card.counters[effect.counter] ?? 0) +
          this.evaluateNumber(effect.amount, context);

        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing counter target.");

        const card = this.requireCard(targetId);

        card.counters[effect.counter] = Math.max(
          0,
          (card.counters[effect.counter] ?? 0) -
            this.evaluateNumber(effect.amount, context),
        );

        return;
      }

      case "createModifier": {
        const targetId = this.resolveTargetRef(effect.target, context);

        assert(targetId, "Missing modifier target.");

        this.state.modifiers.push({
          id: nextId("modifier"),
          sourceId: context.sourceId,
          sourceAbilityId: context.abilityId,
          targetId,
          stat: effect.stat,
          operation: effect.operation,
          value: this.evaluateNumber(effect.value, context),
          duration: effect.duration,
          createdTurn: this.state.turn,
        });

        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous modifiers
  // ---------------------------------------------------------------------------

  private getContinuousModifiers(targetId: CardInstanceId): RuntimeModifier[] {
    const results: RuntimeModifier[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play") {
        continue;
      }

      const definition = this.getDefinition(source.id);

      for (const ability of definition.abilities ?? []) {
        if (ability.type !== "continuous") {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId],
          },
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const modifier of ability.modifiers) {
          const resolvedTarget = this.resolveTargetRef(
            modifier.target,
            context,
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
            value: this.evaluateNumber(modifier.value, context),
            duration: {
              type: "whileSourceInPlay",
            },
            createdTurn: this.state.turn,
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

      for (const card of Object.values(this.state.cards)) {
        if (
          card.zone !== "play" ||
          this.getDefinition(card.id).type !== "character"
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

  private moveCard(cardId: CardInstanceId, to: Zone, emitEvents = true): void {
    const card = this.requireCard(cardId);
    const from = card.zone;

    if (from === to) {
      return;
    }

    this.removeFromAllPlayerZones(cardId);

    card.zone = to;

    const owner = this.requirePlayer(card.ownerId);
    const controller = this.requirePlayer(card.controllerId);

    const zoneOwner =
      to === "deck" || to === "hand" || to === "discard" || to === "void"
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
        to,
      });
    }
  }

  private destroyCard(cardId: CardInstanceId, emitEvents = true): void {
    const card = this.requireCard(cardId);

    if (card.zone !== "play") {
      throw new Error(`Cannot destroy '${cardId}' from zone '${card.zone}'.`);
    }

    const previousController = card.controllerId;

    card.damage = 0;
    card.depleted = false;

    this.moveCard(cardId, "discard", emitEvents);

    if (emitEvents) {
      this.emit({
        type: "cardDestroyed",
        cardId,
        controllerId: previousController,
      });
    }
  }

  private removeFromAllPlayerZones(cardId: CardInstanceId): void {
    for (const player of Object.values(this.state.players)) {
      player.deck = player.deck.filter((id) => id !== cardId);
      player.hand = player.hand.filter((id) => id !== cardId);
      player.play = player.play.filter((id) => id !== cardId);
      player.discard = player.discard.filter((id) => id !== cardId);
      player.void = player.void.filter((id) => id !== cardId);
    }
  }

  private getZoneArray(
    player: PlayerState,
    zone: Zone,
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
      "Only the active player can end the turn.",
    );

    assert(
      this.responseStack.length === 0,
      "Cannot end turn with unresolved responses.",
    );

    this.emit({
      type: "turnEnding",
      playerId,
    });

    this.state.modifiers = this.state.modifiers.filter((modifier) => {
      if (
        modifier.duration.type === "untilEndOfTurn" &&
        modifier.createdTurn <= this.state.turn
      ) {
        return false;
      }

      if (modifier.duration.type === "whileSourceInPlay") {
        return (
          !!modifier.sourceId &&
          this.state.cards[modifier.sourceId]?.zone === "play"
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
      playerId: next.id,
    });
  }

  // ---------------------------------------------------------------------------
  // Minimal battle system
  // ---------------------------------------------------------------------------

  private declareAttack(
    playerId: PlayerId,
    attackerIds: CardInstanceId[],
    target: BattleState["target"],
  ): void {
    assert(!this.state.battle, "Battle already in progress.");
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may attack.",
    );
    assert(attackerIds.length > 0, "No attackers selected.");

    for (const attackerId of attackerIds) {
      const attacker = this.requireCard(attackerId);

      assert(
        attacker.controllerId === playerId,
        "You do not control an attacker.",
      );
      assert(attacker.zone === "play", "Attacker must be in play.");
      assert(
        this.getDefinition(attackerId).type === "character",
        "Only characters can attack.",
      );
      assert(!attacker.depleted, "Depleted characters cannot attack.");

      attacker.depleted = true;
    }

    const defenderId =
      target.type === "faction"
        ? target.playerId
        : this.requireCard(target.cardId).controllerId;

    const battle: BattleState = {
      id: nextId("battle"),
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      target,
      parties: attackerIds.map((attackerId) => ({
        attackerId,
        blockerIds: [],
      })),
      phase: "blocking",
    };

    this.state.battle = battle;

    this.emit({
      type: "battleStarted",
      battleId: battle.id,
    });
  }

  private declareBlockers(
    playerId: PlayerId,
    blocks: Record<CardInstanceId, CardInstanceId[]>,
  ): void {
    const battle = this.state.battle;

    assert(battle, "No battle in progress.");
    assert(
      battle.defenderPlayerId === playerId,
      "Only the defending player can block.",
    );
    assert(battle.phase === "blocking", "Battle is not accepting blockers.");

    const usedBlockers = new Set<CardInstanceId>();

    for (const party of battle.parties) {
      const blockerIds = blocks[party.attackerId] ?? [];

      for (const blockerId of blockerIds) {
        const blocker = this.requireCard(blockerId);

        assert(
          blocker.controllerId === playerId,
          "You do not control that blocker.",
        );
        assert(blocker.zone === "play", "Blocker must be in play.");
        assert(
          this.getDefinition(blockerId).type === "character",
          "Only characters can block.",
        );
        assert(!blocker.depleted, "Depleted characters cannot block.");
        assert(!usedBlockers.has(blockerId), "A character cannot block twice.");

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
    assert(battle.phase === "speed", "Battle is not ready to resolve.");

    const participants = new Set<CardInstanceId>();

    for (const party of battle.parties) {
      participants.add(party.attackerId);

      for (const blockerId of party.blockerIds) {
        participants.add(blockerId);
      }
    }

    const speeds = [
      ...new Set(
        [...participants].map((cardId) => this.getStat(cardId, "speed")),
      ),
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
        const attacker = this.state.cards[party.attackerId];

        if (
          attacker?.zone === "play" &&
          this.getStat(attacker.id, "speed") === speed
        ) {
          const livingBlockers = party.blockerIds.filter(
            (blockerId) => this.state.cards[blockerId]?.zone === "play",
          );

          if (livingBlockers.length > 0) {
            pendingDamage.push({
              sourceId: attacker.id,
              target: {
                type: "card",
                cardId: livingBlockers[0],
              },
              amount: this.getStat(attacker.id, "strength"),
            });
          } else {
            pendingDamage.push({
              sourceId: attacker.id,
              target: battle.target,
              amount: this.getStat(attacker.id, "strength"),
            });
          }
        }

        for (const blockerId of party.blockerIds) {
          const blocker = this.state.cards[blockerId];

          if (
            blocker?.zone === "play" &&
            this.getStat(blocker.id, "speed") === speed &&
            this.state.cards[party.attackerId]?.zone === "play"
          ) {
            pendingDamage.push({
              sourceId: blocker.id,
              target: {
                type: "card",
                cardId: party.attackerId,
              },
              amount: this.getStat(blocker.id, "strength"),
            });
          }
        }
      }

      for (const damage of pendingDamage) {
        if (damage.target.type === "card") {
          const target = this.state.cards[damage.target.cardId];

          if (!target || target.zone !== "play") {
            continue;
          }

          target.damage += damage.amount;

          this.emit({
            type: "damageDealt",
            sourceId: damage.sourceId,
            targetId: target.id,
            amount: damage.amount,
          });
        } else {
          this.requirePlayer(damage.target.playerId).influence -= damage.amount;
        }
      }

      this.checkStateBasedActions();
    }

    const battleId = battle.id;
    battle.phase = "finished";
    this.state.battle = undefined;

    this.emit({
      type: "battleEnded",
      battleId,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private meetsThreshold(playerId: PlayerId, threshold?: Threshold): boolean {
    if (!threshold) {
      return true;
    }

    const player = this.requirePlayer(playerId);

    for (const trade of [
      "rage",
      "greed",
      "deception",
      "elitism",
      "obsession",
    ] as Trade[]) {
      if ((player.thresholds[trade] ?? 0) < (threshold[trade] ?? 0)) {
        return false;
      }
    }

    return true;
  }

  private getEventCardId(event?: GameEvent): CardInstanceId | undefined {
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

  private resetPriorityAfterAction(actingPlayerId: PlayerId): void {
    this.consecutivePasses = 0;
    this.state.priorityPlayerId = this.getOpponent(actingPlayerId).id;
  }

  private requireCard(id: CardInstanceId): CardInstance {
    const card = this.state.cards[id];

    assert(card, `Card '${id}' not found.`);

    return card;
  }

  private requirePlayer(id: PlayerId): PlayerState {
    const player = this.state.players[id];

    assert(player, `Player '${id}' not found.`);

    return player;
  }

  private getOpponent(playerId: PlayerId): PlayerState {
    const opponent = Object.values(this.state.players).find(
      (player) => player.id !== playerId,
    );

    assert(
      opponent,
      "This barebones engine currently expects exactly two players.",
    );

    return opponent;
  }
}
