// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

import type {
  ActivatedAbility,
  BattleDamageAssignment,
  BattleId,
  BattleState,
  BattleView,
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  CardSelector,
  Condition,
  Cost,
  DevelopChoice,
  Effect,
  FactionDefinition,
  GameAction,
  GameEvent,
  GameFlowView,
  GameState,
  Keyword,
  NumberExpression,
  PlayerId,
  PlayerRef,
  PlayerState,
  ResolutionContext,
  ResourceIcon,
  ResponseContinuation,
  ResponseWindowKind,
  ResponseWindowState,
  RuntimeModifier,
  StackItem,
  Stat,
  TargetDeclaration,
  TargetRef,
  Threshold,
  TriggerResolution,
  Zone
} from "../types/index.js";
import { assert, compare, nextId, parseThreshold, withBuiltInFactionDefaults } from "./utilities.js";


export class SpoilsEngine {
  readonly definitions: Record<CardDefinitionId, CardDefinition>;
  readonly state: GameState;

  readonly immediateQueue: TriggerResolution[] = [];

  /**
   * Event batches delay triggered-ability execution until a simultaneous group
   * of mutations is complete. Battle damage uses this so one damage event
   * cannot interrupt another member of the same speed group.
   */
  private eventBatchDepth = 0;

  constructor(
    definitions: CardDefinition[],
    initialState: GameState
  ) {
    this.definitions = Object.fromEntries(
      definitions.map(def => {
        const normalized = withBuiltInFactionDefaults(def);
        return [normalized.id, normalized];
      })
    );

    this.state = initialState;

    // Compatibility with states created by older versions of this monofile.
    this.state.responseStack ??= [];
    this.state.turnPhase ??= "main";
    this.state.setup ??= { phase: "complete" };
    this.state.started ??= true;

    for (const card of Object.values(this.state.cards)) {
      card.faceDown ??= false;
    }
  }

  get responseStack(): StackItem[] {
    return this.state.responseStack;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  perform(action: GameAction): void {
    if (this.state.setup.phase === "mulligan" && action.type !== "mulligan") {
      throw new Error("Opening mulligans must be completed before play begins.");
    }

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

      case "mulligan":
        this.mulligan(action.playerId, action.cardIds);
        return;

      case "chooseDevelop":
        this.chooseDevelop(action.playerId, action.choice);
        return;

      case "endTurn":
        this.endTurn(action.playerId);
        return;

      case "declareAttack":
        this.declareAttack(action.playerId, action.attackerIds, action.target);
        return;

      case "declareBlockers":
        this.declareBlockers(action.playerId, action.blockerIds);
        return;

      case "advanceFlow":
        this.advanceFlow();
        return;

      case "advanceBattle":
        assert(this.state.battle, "No battle in progress.");
        assert(
          action.playerId === this.state.battle.attackerPlayerId ||
          action.playerId === this.state.battle.defenderPlayerId,
          "Player is not part of this battle."
        );
        this.advanceFlow();
        return;

      case "assignBattleDamage":
        this.assignBattleDamage(action.playerId, action.assignments);
        return;
    }
  }

  /**
   * Single query surface intended for a UI / renderer.
   */
  getFlowView(): GameFlowView {
    let mode: GameFlowView["mode"] =
      this.state.turnPhase === "develop" ? "develop" : "main";

    if (this.state.setup.phase === "mulligan") {
      mode = "setup";
    } else if (this.state.responseWindow?.phase === "acceptingResponses") {
      mode = "response";
    } else if (this.state.responseWindow?.phase === "resolving") {
      mode = "resolvingResponses";
    } else if (this.state.battle?.phase === "finished") {
      mode = "battleFinished";
    } else if (this.state.battle) {
      mode = "battleChoice";
    }

    return {
      activePlayerId: this.state.activePlayerId,
      priorityPlayerId: this.state.priorityPlayerId,
      mode,
      turnPhase: this.state.turnPhase,
      setup: structuredClone(this.state.setup),
      responseWindow: this.state.responseWindow
        ? structuredClone(this.state.responseWindow)
        : undefined,
      responseStack: structuredClone(this.state.responseStack),
      battle: this.getBattleView()
    };
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

  getFactionCard(playerId: PlayerId): CardInstance | undefined {
    const player = this.requirePlayer(playerId);
    return player.factionId ? this.state.cards[player.factionId] : undefined;
  }

  getFactionDefinition(playerId: PlayerId): FactionDefinition | undefined {
    const faction = this.getFactionCard(playerId);
    if (!faction) return undefined;
    return this.getDefinition(faction.id).faction;
  }

  isResource(cardId: CardInstanceId): boolean {
    const card = this.requireCard(cardId);
    return card.zone === "play" &&
      (card.faceDown || this.getDefinition(cardId).type === "resource");
  }

  getAvailableResourceIds(playerId: PlayerId): CardInstanceId[] {
    const player = this.requirePlayer(playerId);
    return player.play.filter(cardId => {
      const card = this.state.cards[cardId];
      return (
        card.controllerId === playerId &&
        this.isResource(cardId) &&
        card.attachedTo === undefined
      );
    });
  }

  getAvailableResourceCount(playerId: PlayerId): number {
    return this.getAvailableResourceIds(playerId).length;
  }

  getThresholds(playerId: PlayerId): Threshold {
    const result: Threshold = {};

    for (const cardId of this.requirePlayer(playerId).play) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerId !== playerId || !this.isResource(cardId)) {
        continue;
      }

      const icons = this.getResourceIcons(cardId);
      for (const icon of icons) {
        result[icon] = (result[icon] ?? 0) + 1;
      }
    }

    return result;
  }

  getDevelopChoices(playerId: PlayerId): DevelopChoice[] {
    return structuredClone(
      this.getFactionDefinition(playerId)?.turn.develop.choices ?? []
    );
  }

  private getResourceIcons(cardId: CardInstanceId): ResourceIcon[] {
    const card = this.requireCard(cardId);

    if (card.faceDown) {
      return ["volition"];
    }

    const definition = this.getDefinition(cardId);

    if (definition.resource?.provides?.length) {
      return [...definition.resource.provides];
    }

    switch (definition.name.toLowerCase()) {
      case "rage":
        return ["rage"];
      case "greed":
        return ["greed"];
      case "deception":
        return ["deception"];
      case "elitism":
        return ["elitism"];
      case "obsession":
        return ["obsession"];
      default:
        return [];
    }
  }

  private payNumericCost(playerId: PlayerId, amount: number): void {
    assert(Number.isInteger(amount) && amount >= 0, "Numeric costs must be non-negative integers.");

    const player = this.requirePlayer(playerId);
    assert(player.factionId, "Player has no faction to attach resources to.");

    const resources = this.getAvailableResourceIds(playerId);
    assert(resources.length >= amount, "Not enough unattached resources.");

    for (const cardId of resources.slice(0, amount)) {
      this.requireCard(cardId).attachedTo = player.factionId;
    }
  }

  private drawCards(playerId: PlayerId, amount: number): void {
    const player = this.requirePlayer(playerId);
    const drawn = player.deck.splice(0, Math.max(0, amount));

    this.beginEventBatch();
    try {
      for (const cardId of drawn) {
        const card = this.requireCard(cardId);
        card.zone = "hand";
        card.faceDown = false;
        card.attachedTo = undefined;
        player.hand.push(cardId);

        this.emit({
          type: "cardMoved",
          cardId,
          from: "deck",
          to: "hand"
        });
      }
    } finally {
      this.endEventBatch();
    }
  }

  private playResourceCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    faceDown: boolean
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    assert(card.ownerId === playerId, "That card is not in this player's hand.");
    assert(card.zone === "hand", "A resource must be played from hand.");

    if (!faceDown) {
      assert(
        definition.type === "resource",
        "Only a resource card can be played face-up as a resource."
      );
    }

    card.faceDown = faceDown;
    card.attachedTo = undefined;
    this.moveCard(cardId, "play");

    this.emit({
      type: "resourcePlayed",
      cardId,
      playerId,
      faceDown
    });
  }

  startGameAfterSetup(): void {
    assert(this.state.setup.phase === "complete", "Opening setup is not complete.");
    assert(!this.state.started, "The game has already started.");

    this.state.started = true;
    this.state.turnPhase = "develop";
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.applyFactionStartOfTurn(this.state.activePlayerId);

    this.emit({
      type: "turnStarted",
      playerId: this.state.activePlayerId
    });
  }

  private mulligan(playerId: PlayerId, cardIds: CardInstanceId[]): void {
    const setup = this.state.setup;

    assert(setup.phase === "mulligan", "The mulligan step is over.");
    assert(
      setup.order[setup.currentIndex] === playerId,
      "It is not this player's mulligan decision."
    );

    const faction = this.getFactionDefinition(playerId);
    const mulliganRule = faction?.setup.mulligan;

    assert(
      mulliganRule?.mode === "replaceAny" && (mulliganRule.count ?? 0) > 0,
      "This faction does not provide a replace-any mulligan."
    );

    const unique = new Set(cardIds);
    assert(unique.size === cardIds.length, "A mulligan card was selected twice.");

    const player = this.requirePlayer(playerId);

    for (const cardId of cardIds) {
      assert(player.hand.includes(cardId), "Mulligan cards must be in your hand.");
    }

    // Put the selected cards on the bottom in the supplied order, then draw
    // the same number. There is no shuffle during the Tournament mulligan.
    for (const cardId of cardIds) {
      player.hand = player.hand.filter(id => id !== cardId);
      const card = this.requireCard(cardId);
      card.zone = "deck";
      player.deck.push(cardId);
    }

    this.drawCards(playerId, cardIds.length);

    setup.currentIndex++;

    if (setup.currentIndex >= setup.order.length) {
      this.state.setup = { phase: "complete" };
      this.startGameAfterSetup();
    }
  }

  private chooseDevelop(
    playerId: PlayerId,
    choice: Extract<GameAction, { type: "chooseDevelop" }>["choice"]
  ): void {
    assert(this.state.setup.phase === "complete", "Game setup is not complete.");
    assert(playerId === this.state.activePlayerId, "Only the active player develops.");
    assert(this.state.turnPhase === "develop", "The develop decision has already been made.");
    assert(!this.state.responseWindow && !this.state.battle, "Cannot develop during another flow.");

    const available = this.getDevelopChoices(playerId);
    const rule = available.find(candidate => candidate.type === choice.type);
    assert(rule, `Faction does not allow develop choice '${choice.type}'.`);

    if (choice.type === "draw") {
      assert(rule.type === "draw", "Invalid draw develop rule.");
      this.drawCards(playerId, rule.count);
    } else {
      assert(rule.type === "playResource", "Invalid resource develop rule.");
      assert(
        choice.cards.length === rule.count,
        `Develop requires exactly ${rule.count} resource play(s).`
      );

      for (const resource of choice.cards) {
        this.playResourceCard(playerId, resource.cardId, resource.faceDown);
      }
    }

    this.state.turnPhase = "main";
    this.state.priorityPlayerId = playerId;
  }

  private applyFactionStartOfTurn(playerId: PlayerId): void {
    const player = this.requirePlayer(playerId);
    const faction = this.getFactionDefinition(playerId);
    const restore = faction?.turn.restore;

    // Start-of-turn attack eligibility is a core rule, not a faction ability.
    for (const card of Object.values(this.state.cards)) {
      card.attackEligibleTurn = undefined;
    }

    for (const cardId of player.play) {
      const card = this.requireCard(cardId);
      const definition = this.getDefinition(cardId);

      if (
        !card.faceDown &&
        definition.type === "character" &&
        card.controllerId === playerId
      ) {
        card.attackEligibleTurn = this.state.turn;
      }
    }

    if (!restore) return;

    if (restore.clearCharacterDamage) {
      for (const card of Object.values(this.state.cards)) {
        if (
          card.zone === "play" &&
          !card.faceDown &&
          this.getDefinition(card.id).type === "character"
        ) {
          card.damage = 0;
        }
      }
    }

    if (restore.detachResources && player.factionId) {
      for (const cardId of player.play) {
        const card = this.requireCard(cardId);
        if (card.attachedTo === player.factionId && this.isResource(cardId)) {
          card.attachedTo = undefined;
        }
      }
    }

    if (restore.restoreNonResources) {
      for (const cardId of player.play) {
        if (!this.isResource(cardId)) {
          this.requireCard(cardId).depleted = false;
        }
      }
    }
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
    if (!this.canUseAbilityAtCurrentTiming(playerId)) {
      return [];
    }

    const result: Array<{
      cardId: CardInstanceId;
      ability: ActivatedAbility;
    }> = [];

    for (const card of Object.values(this.state.cards)) {
      if (card.controllerId !== playerId || card.zone !== "play" || card.faceDown) {
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

    this.assertCanDeployAtCurrentTiming(action.playerId, definition);

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
      this.getAvailableResourceCount(action.playerId) >= resourceCost,
      "Not enough unattached resources."
    );

    this.payNumericCost(action.playerId, resourceCost);

    this.moveCard(card.id, "deploying");

    this.emit({
      type: "cardPlayed",
      cardId: card.id,
      playerId: action.playerId
    });

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

    this.afterStackAction(action.playerId);
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition
  ): TargetDeclaration[] {
    if (definition.type !== "tactic") {
      return [];
    }

    // Barebones convention:
    // tactic cards use the first activated-ability-shaped behavior as the
    // instructions that resolve when the tactic finishes being deployed.
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

    this.assertCanUseAbilityAtCurrentTiming(action.playerId);

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

    // Cost-triggered abilities happen immediately before the ability itself
    // enters the response chain.
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

    this.afterStackAction(action.playerId);
  }

  /**
   * Passing never resolves hidden work immediately. Two consecutive passes
   * switch the response window to "resolving". The renderer can animate that
   * transition and call advanceFlow() when it is ready for the next item.
   */
  private passPriority(playerId: PlayerId): void {
    const window = this.requireResponseWindow();

    assert(
      window.phase === "acceptingResponses",
      "Responses are currently resolving."
    );
    assert(
      window.priorityPlayerId === playerId,
      "It is not your priority."
    );

    window.consecutivePasses++;

    const opponent = this.getOpponent(playerId);
    window.priorityPlayerId = opponent.id;
    this.state.priorityPlayerId = opponent.id;

    if (window.consecutivePasses >= 2) {
      window.phase = "resolving";
    }
  }

  /**
   * Advances exactly one automatic step:
   *
   * 1. Resolve one response-stack item, OR
   * 2. Resume the interrupted turn/battle flow once the stack is empty, OR
   * 3. Clear a finished battle after the UI has had a chance to render it.
   */
  private advanceFlow(): void {
    const window = this.state.responseWindow;

    if (window) {
      assert(
        window.phase === "resolving",
        "Players must finish responding before the flow can advance."
      );

      if (this.responseStack.length > 0) {
        this.resolveTopOfStack();
        return;
      }

      const continuation = structuredClone(window.continuation);
      this.state.responseWindow = undefined;
      this.state.priorityPlayerId = this.state.activePlayerId;

      this.resumeContinuation(continuation);
      return;
    }

    if (this.state.battle?.phase === "finished") {
      this.state.battle = undefined;
      this.state.priorityPlayerId = this.state.activePlayerId;
      return;
    }

    throw new Error("There is no automatic game-flow step to advance.");
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

        // A card entering during the active turn did not start that turn in
        // play, so it is not attack-eligible unless it has AGGRO.
        card.attackEligibleTurn = undefined;

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

  private afterStackAction(actingPlayerId: PlayerId): void {
    const existing = this.state.responseWindow;

    if (existing) {
      assert(
        existing.phase === "acceptingResponses",
        "Cannot add a response while the chain is resolving."
      );

      existing.consecutivePasses = 0;
      existing.priorityPlayerId = this.getOpponent(actingPlayerId).id;
      this.state.priorityPlayerId = existing.priorityPlayerId;
      return;
    }

    this.openResponseWindow(
      "action",
      this.getOpponent(actingPlayerId).id,
      { type: "main" }
    );
  }

  private openResponseWindow(
    kind: ResponseWindowKind,
    firstPlayerId: PlayerId,
    continuation: ResponseContinuation
  ): void {
    assert(
      !this.state.responseWindow,
      "A response window is already open."
    );

    this.state.responseWindow = {
      id: nextId("response"),
      kind,
      phase: "acceptingResponses",
      firstPlayerId,
      priorityPlayerId: firstPlayerId,
      consecutivePasses: 0,
      continuation
    };

    this.state.priorityPlayerId = firstPlayerId;
  }

  private resumeContinuation(
    continuation: ResponseContinuation
  ): void {
    switch (continuation.type) {
      case "main":
        this.state.priorityPlayerId = this.state.activePlayerId;
        return;

      case "endTurn":
        this.finishTurn(continuation.playerId);
        return;

      case "battleBlocking": {
        const battle = this.requireBattleId(continuation.battleId);
        battle.phase = "blocking";
        this.state.priorityPlayerId = battle.defenderPlayerId;
        return;
      }

      case "battleAssignDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.enterDamageAssignment(battle);
        return;
      }

      case "battleInflictDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.inflictLockedBattleDamage(battle);
        this.prepareNextSpeedGroupOrFinish(battle);
        return;
      }
    }
  }

  private assertCanDeployAtCurrentTiming(
    playerId: PlayerId,
    definition: CardDefinition
  ): void {
    const window = this.state.responseWindow;

    if (window) {
      assert(
        window.phase === "acceptingResponses",
        "Responses are already resolving."
      );
      assert(
        window.priorityPlayerId === playerId,
        "It is not your priority."
      );
      assert(
        definition.type === "tactic" ||
          this.definitionHasKeyword(definition, "tactical"),
        "Only tactics or TACTICAL cards may be deployed as responses."
      );
      return;
    }

    assert(
      !this.state.battle,
      "Cards may only be deployed during a battle in a response window."
    );
    assert(
      this.responseStack.length === 0,
      "Cannot begin a new action while responses are unresolved."
    );
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may deploy a normal turn action."
    );
    assert(
      this.state.turnPhase === "main",
      "Complete the faction's develop rule before taking normal turn actions."
    );
  }

  private assertCanUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): void {
    assert(
      this.canUseAbilityAtCurrentTiming(playerId),
      "Ability cannot be used at the current timing."
    );
  }

  private canUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): boolean {
    const window = this.state.responseWindow;

    if (window) {
      return (
        window.phase === "acceptingResponses" &&
        window.priorityPlayerId === playerId
      );
    }

    return (
      !this.state.battle &&
      this.responseStack.length === 0 &&
      playerId === this.state.activePlayerId &&
      this.state.turnPhase === "main"
    );
  }

  private requireResponseWindow(): ResponseWindowState {
    const window = this.state.responseWindow;
    assert(window, "No response window is open.");
    return window;
  }

  // ---------------------------------------------------------------------------
  // Event / trigger system
  // ---------------------------------------------------------------------------

  emit(event: GameEvent): void {
    const triggers = this.findTriggers(event);

    for (const trigger of triggers) {
      this.immediateQueue.push(trigger);
    }

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  private beginEventBatch(): void {
    this.eventBatchDepth++;
  }

  private endEventBatch(): void {
    assert(this.eventBatchDepth > 0, "No event batch is active.");

    this.eventBatchDepth--;

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  private findTriggers(event: GameEvent): TriggerResolution[] {
    const results: TriggerResolution[] = [];

    const eventCardId = this.getEventCardId(event);

    for (const card of Object.values(this.state.cards)) {
      const isDestroyedEventSource =
        event.type === "cardDestroyed" &&
        eventCardId === card.id;

      if ((card.zone !== "play" && !isDestroyedEventSource) || card.faceDown) {
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
        return expression.values.reduce<number>(
          (sum, value) =>
            sum + this.evaluateNumber(value, context),
          0
        );

      case "multiply":
        return expression.values.reduce<number>(
          (product, value) =>
            product * this.evaluateNumber(value, context),
          1
        );
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

    if (selector.type) {
      if (selector.type === "resource") {
        if (!this.isResource(card.id)) return false;
      } else if (card.faceDown || definition.type !== selector.type) {
        return false;
      }
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
        const amount = this.evaluateNumber(
          cost.amount,
          context
        );

        assert(amount >= 0, "Resource payment cannot be negative.");
        assert(
          this.getAvailableResourceCount(context.controllerId) >= amount,
          "Not enough unattached resources."
        );

        this.payNumericCost(context.controllerId, amount);
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

        this.drawCards(player.id, amount);
        return;
      }

      case "playResource": {
        const targetId = this.resolveTargetRef(effect.target, context);
        assert(targetId, "Missing resource target.");

        const definition = this.getDefinition(targetId);
        const faceDown = effect.faceDown === "auto"
          ? definition.type !== "resource"
          : effect.faceDown;

        this.playResourceCard(context.controllerId, targetId, faceDown);
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
            cardId: targetId
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
            cardId: targetId
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
      if (source.zone !== "play" || source.faceDown) {
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
          card.faceDown ||
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

    if (to !== "play") {
      card.faceDown = false;
      card.attachedTo = undefined;
    }

    // If a target leaves play, its attachments become unattached. This is
    // sufficient for faction/resource bookkeeping; card-specific attachment
    // departure effects can be layered on later.
    if (from === "play" && to !== "play") {
      for (const other of Object.values(this.state.cards)) {
        if (other.attachedTo === cardId) other.attachedTo = undefined;
      }
    }

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

  /**
   * "End turn" is an announcement. The opponent gets a normal response window
   * before the turn actually changes.
   */
  private endTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player can end the turn."
    );
    assert(
      this.state.turnPhase === "main",
      "Complete the faction's develop rule before ending the turn."
    );
    assert(!this.state.battle, "Cannot end the turn during a battle.");
    assert(!this.state.responseWindow, "A response window is already open.");
    assert(
      this.responseStack.length === 0,
      "Cannot end turn with unresolved responses."
    );

    this.emit({
      type: "turnEnding",
      playerId
    });

    this.openResponseWindow(
      "endTurn",
      this.getOpponent(playerId).id,
      {
        type: "endTurn",
        playerId
      }
    );
  }

  private finishTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Turn owner changed before end-turn resolution."
    );

    this.state.modifiers =
      this.state.modifiers.filter(modifier => {
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
    this.state.turnPhase = "develop";

    this.applyFactionStartOfTurn(next.id);

    this.emit({
      type: "turnStarted",
      playerId: next.id
    });
  }

  // ---------------------------------------------------------------------------
  // Battle system
  // ---------------------------------------------------------------------------

  getBattleView(): BattleView | undefined {
    const battle = this.state.battle;

    if (!battle) {
      return undefined;
    }

    let actingPlayerId: PlayerId | undefined;

    if (
      this.state.responseWindow &&
      this.isBattleResponseWindow(this.state.responseWindow) &&
      this.state.responseWindow.phase === "acceptingResponses"
    ) {
      actingPlayerId = this.state.responseWindow.priorityPlayerId;
    } else if (battle.phase === "blocking") {
      actingPlayerId = battle.defenderPlayerId;
    } else if (battle.phase === "attackerDamageAssignment") {
      actingPlayerId = battle.attackerPlayerId;
    } else if (battle.phase === "defenderDamageAssignment") {
      actingPlayerId = battle.defenderPlayerId;
    }

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    const sourceParty = attackerAssigning
      ? battle.attackingParty
      : defenderAssigning
        ? battle.blockingParty
        : [];

    const damageSources = sourceParty
      .filter(cardId => this.canAssignBattleDamage(cardId, battle))
      .filter(cardId =>
        battle.speed === undefined
          ? false
          : this.getStat(cardId, "speed") === battle.speed
      )
      .map(cardId => ({
        cardId,
        strength: this.getStat(cardId, "strength"),
        legalTargets: this.getLegalBattleDamageTargets(
          cardId,
          attackerAssigning,
          battle
        )
      }));

    return {
      battleId: battle.id,
      phase: battle.phase,
      speed: battle.speed,
      attackerPlayerId: battle.attackerPlayerId,
      defenderPlayerId: battle.defenderPlayerId,
      attackingParty: [...battle.attackingParty],
      blockingParty: [...battle.blockingParty],
      actingPlayerId,
      damageSources,
      lockedAssignments: [
        ...battle.attackerAssignments,
        ...battle.defenderAssignments
      ].map(assignment => structuredClone(assignment))
    };
  }

  private declareAttack(
    playerId: PlayerId,
    attackerIds: CardInstanceId[],
    target: BattleState["target"]
  ): void {
    assert(!this.state.battle, "Battle already in progress.");
    assert(!this.state.responseWindow, "Cannot attack during a response window.");
    assert(this.responseStack.length === 0, "Responses are unresolved.");
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may attack."
    );
    assert(
      this.state.turnPhase === "main",
      "Complete the faction's develop rule before attacking."
    );
    assert(attackerIds.length > 0, "No attackers selected.");
    assert(
      new Set(attackerIds).size === attackerIds.length,
      "An attacker was selected more than once."
    );

    let defenderId: PlayerId;

    if (target.type === "faction") {
      defenderId = target.playerId;
      assert(
        defenderId !== playerId,
        "You cannot attack your own faction."
      );
    } else {
      const targetCard = this.requireCard(target.cardId);
      assert(targetCard.zone === "play", "Attack target must be in play.");
      assert(
        this.getDefinition(target.cardId).type === "location",
        "Battles may target an opposing faction or location."
      );
      assert(
        targetCard.controllerId !== playerId,
        "You cannot attack your own location."
      );
      defenderId = targetCard.controllerId;
    }

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        const attacker = this.requireCard(attackerId);
        const definition = this.getDefinition(attackerId);

        assert(attacker.controllerId === playerId, "You do not control an attacker.");
        assert(attacker.zone === "play", "Attacker must be in play.");
        assert(definition.type === "character", "Only characters can attack.");
        assert(!attacker.depleted, "Depleted characters cannot attack.");
        assert(
          attacker.attackEligibleTurn === this.state.turn ||
            this.definitionHasKeyword(definition, "aggro"),
          "Character did not start the turn in play under your control and does not have AGGRO."
        );

        attacker.depleted = true;

        this.emit({
          type: "cardDepleted",
          cardId: attackerId
        });
      }
    } finally {
      this.endEventBatch();
    }

    const battle: BattleState = {
      id: nextId("battle"),
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      target,
      attackingParty: [...attackerIds],
      blockingParty: [],
      phase: "afterAttackersResponse",
      assignedDamageBy: [],
      attackerAssignments: [],
      defenderAssignments: []
    };

    this.state.battle = battle;

    this.emit({
      type: "battleStarted",
      battleId: battle.id
    });

    // Spoils battle step: attacker may use tactics/abilities, then defender.
    this.openResponseWindow(
      "battleAfterAttackers",
      battle.attackerPlayerId,
      {
        type: "battleBlocking",
        battleId: battle.id
      }
    );
  }

  private declareBlockers(
    playerId: PlayerId,
    blockerIds: CardInstanceId[]
  ): void {
    const battle = this.requireBattle();

    assert(!this.state.responseWindow, "Responses must finish before blockers are declared.");
    assert(
      battle.defenderPlayerId === playerId,
      "Only the defending player can block."
    );
    assert(
      battle.phase === "blocking",
      "Battle is not accepting blockers."
    );

    const unique = new Set(blockerIds);
    assert(
      unique.size === blockerIds.length,
      "A blocker was selected more than once."
    );

    for (const blockerId of blockerIds) {
      const blocker = this.requireCard(blockerId);

      assert(blocker.controllerId === playerId, "You do not control that blocker.");
      assert(blocker.zone === "play", "Blocker must be in play.");
      assert(!blocker.faceDown, "A face-down resource cannot block.");
      assert(this.getDefinition(blockerId).type === "character", "Only characters can block.");
      assert(!blocker.depleted, "Depleted characters cannot block.");
    }

    this.assertCovertBlockingLegality(
      battle.attackingParty,
      blockerIds
    );

    battle.blockingParty = [...blockerIds];

    this.prepareNextSpeedGroupOrFinish(battle);
  }

  private prepareNextSpeedGroupOrFinish(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    const nextSpeed = this.getNextBattleSpeed(battle);

    if (nextSpeed === undefined) {
      this.finishBattle(battle);
      return;
    }

    battle.speed = nextSpeed;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
    battle.phase = "beforeDamageResponse";

    // Battle resolution step 2: attacker gets first opportunity.
    this.openResponseWindow(
      "battleBeforeDamage",
      battle.attackerPlayerId,
      {
        type: "battleAssignDamage",
        battleId: battle.id
      }
    );
  }

  private enterDamageAssignment(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    if (this.getBattleDamageSources(true, battle).length > 0) {
      battle.phase = "attackerDamageAssignment";
      this.state.priorityPlayerId = battle.attackerPlayerId;
      return;
    }

    if (this.getBattleDamageSources(false, battle).length > 0) {
      battle.phase = "defenderDamageAssignment";
      this.state.priorityPlayerId = battle.defenderPlayerId;
      return;
    }

    this.openPostAssignmentResponse(battle);
  }

  private assignBattleDamage(
    playerId: PlayerId,
    assignments: BattleDamageAssignment[]
  ): void {
    assert(
      !this.state.responseWindow,
      "Cannot assign battle damage while a response window is open."
    );

    const battle = this.requireBattle();

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    assert(
      attackerAssigning || defenderAssigning,
      "Battle is not accepting damage assignments."
    );

    const expectedPlayerId = attackerAssigning
      ? battle.attackerPlayerId
      : battle.defenderPlayerId;

    assert(
      playerId === expectedPlayerId,
      "It is not this player's damage assignment."
    );

    const sources = this.getBattleDamageSources(
      attackerAssigning,
      battle
    );

    for (const sourceId of sources) {
      const sourceAssignments = assignments.filter(
        assignment => assignment.sourceId === sourceId
      );

      const legalTargets = this.getLegalBattleDamageTargets(
        sourceId,
        attackerAssigning,
        battle
      );

      if (legalTargets.length === 0) {
        assert(
          sourceAssignments.length === 0,
          `Source '${sourceId}' has no legal damage target.`
        );
        continue;
      }

      const strength = this.getStat(sourceId, "strength");
      const total = sourceAssignments.reduce(
        (sum, assignment) => sum + assignment.amount,
        0
      );

      assert(
        total === strength,
        `Source '${sourceId}' must assign exactly ${strength} damage; received ${total}.`
      );

      for (const assignment of sourceAssignments) {
        assert(
          Number.isInteger(assignment.amount) &&
          assignment.amount > 0,
          "Damage assignments must be positive integers."
        );

        assert(
          legalTargets.some(target =>
            this.sameBattleTarget(target, assignment.target)
          ),
          `Illegal battle-damage target for '${sourceId}'.`
        );
      }
    }

    for (const assignment of assignments) {
      assert(
        sources.includes(assignment.sourceId),
        `Source '${assignment.sourceId}' is not part of the current speed group.`
      );
    }

    battle.assignedDamageBy.push(...sources);

    if (attackerAssigning) {
      battle.attackerAssignments = structuredClone(assignments);

      if (this.getBattleDamageSources(false, battle).length > 0) {
        battle.phase = "defenderDamageAssignment";
        this.state.priorityPlayerId = battle.defenderPlayerId;
      } else {
        this.openPostAssignmentResponse(battle);
      }
    } else {
      battle.defenderAssignments = structuredClone(assignments);
      this.openPostAssignmentResponse(battle);
    }
  }

  private openPostAssignmentResponse(
    battle: BattleState
  ): void {
    battle.phase = "afterDamageResponse";

    // Damage is now locked. Tactics/abilities can still change the game, but
    // the assignments themselves are immutable and survive source removal.
    this.openResponseWindow(
      "battleAfterDamage",
      battle.attackerPlayerId,
      {
        type: "battleInflictDamage",
        battleId: battle.id
      }
    );
  }

  private getBattleDamageSources(
    attackerSide: boolean,
    battle: BattleState
  ): CardInstanceId[] {
    if (battle.speed === undefined) {
      return [];
    }

    const party = attackerSide
      ? battle.attackingParty
      : battle.blockingParty;

    return party.filter(
      cardId =>
        this.canAssignBattleDamage(cardId, battle) &&
        this.getStat(cardId, "speed") === battle.speed
    );
  }

  private canAssignBattleDamage(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    return (
      !!card &&
      card.zone === "play" &&
      !battle.assignedDamageBy.includes(cardId)
    );
  }

  private getLegalBattleDamageTargets(
    _sourceId: CardInstanceId,
    attackerSide: boolean,
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
    if (!attackerSide) {
      return battle.attackingParty
        .filter(cardId => this.isCardStillInBattle(cardId, battle))
        .map(cardId => ({
          type: "card" as const,
          cardId
        }));
    }

    const blockers = battle.blockingParty.filter(cardId =>
      this.isCardStillInBattle(cardId, battle)
    );

    if (blockers.length > 0) {
      return blockers.map(cardId => ({
        type: "card" as const,
        cardId
      }));
    }

    if (battle.target.type === "faction") {
      return [
        {
          type: "faction",
          playerId: battle.target.playerId
        }
      ];
    }

    const target = this.state.cards[battle.target.cardId];

    if (!target || target.zone !== "play") {
      return [];
    }

    return [
      {
        type: "card",
        cardId: battle.target.cardId
      }
    ];
  }

  private getNextBattleSpeed(
    battle: BattleState
  ): number | undefined {
    const candidates = [
      ...battle.attackingParty,
      ...battle.blockingParty
    ].filter(cardId => this.canAssignBattleDamage(cardId, battle));

    if (!candidates.length) {
      return undefined;
    }

    return Math.max(
      ...candidates.map(cardId => this.getStat(cardId, "speed"))
    );
  }

  private inflictLockedBattleDamage(
    battle: BattleState
  ): void {
    const assignments = [
      ...battle.attackerAssignments,
      ...battle.defenderAssignments
    ];

    this.beginEventBatch();

    try {
      // Apply every locked amount before any triggered ability resolves.
      for (const assignment of assignments) {
        if (assignment.target.type === "faction") {
          this.requirePlayer(
            assignment.target.playerId
          ).influence -= assignment.amount;

          continue;
        }

        const target = this.state.cards[
          assignment.target.cardId
        ];

        // Locking protects the source assignment, not a target which has
        // already left play before damage is inflicted.
        if (!target || target.zone !== "play") {
          continue;
        }

        target.damage += assignment.amount;
      }

      for (const assignment of assignments) {
        if (assignment.target.type !== "card") {
          continue;
        }

        const target = this.state.cards[
          assignment.target.cardId
        ];

        if (!target || target.zone !== "play") {
          continue;
        }

        this.emit({
          type: "damageDealt",
          sourceId: assignment.sourceId,
          targetId: assignment.target.cardId,
          amount: assignment.amount
        });
      }

      // Lethal characters leave play only after the entire speed group's raw
      // damage has been applied.
      this.checkStateBasedActions();
    } finally {
      this.endEventBatch();
    }

    this.pruneBattleParties(battle);
    battle.speed = undefined;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
  }

  private pruneBattleParties(
    battle: BattleState
  ): void {
    battle.attackingParty = battle.attackingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );

    battle.blockingParty = battle.blockingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );
  }

  private isCardStillInBattle(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    if (!card || card.zone !== "play") {
      return false;
    }

    if (battle.attackingParty.includes(cardId)) {
      return card.controllerId === battle.attackerPlayerId;
    }

    if (battle.blockingParty.includes(cardId)) {
      return card.controllerId === battle.defenderPlayerId;
    }

    return false;
  }

  private sameBattleTarget(
    a:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId },
    b:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId }
  ): boolean {
    if (a.type !== b.type) {
      return false;
    }

    if (a.type === "card" && b.type === "card") {
      return a.cardId === b.cardId;
    }

    return (
      a.type === "faction" &&
      b.type === "faction" &&
      a.playerId === b.playerId
    );
  }

  private assertCovertBlockingLegality(
    attackerIds: CardInstanceId[],
    blockerIds: CardInstanceId[]
  ): void {
    if (blockerIds.length === 0) {
      return;
    }

    const attackersContainCovert = attackerIds.some(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    const blockersContainCovert = blockerIds.some(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    const attackingPartyIsCovert = attackerIds.every(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    const blockingPartyIsCovert = blockerIds.every(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    if (attackersContainCovert) {
      assert(
        blockingPartyIsCovert,
        "A party containing a COVERT character can only be blocked by a COVERT party."
      );
    }

    if (blockersContainCovert) {
      assert(
        attackingPartyIsCovert,
        "A COVERT character can only block a COVERT party."
      );
    }
  }

  private isBattleResponseWindow(
    window: ResponseWindowState
  ): boolean {
    return (
      window.kind === "battleAfterAttackers" ||
      window.kind === "battleBeforeDamage" ||
      window.kind === "battleAfterDamage"
    );
  }

  private requireBattle(): BattleState {
    const battle = this.state.battle;
    assert(battle, "No battle in progress.");
    return battle;
  }

  private requireBattleId(
    battleId: BattleId
  ): BattleState {
    const battle = this.requireBattle();
    assert(
      battle.id === battleId,
      `Expected battle '${battleId}', found '${battle.id}'.`
    );
    return battle;
  }

  /**
   * The finished battle remains in GameState until advanceFlow() is called,
   * allowing a renderer to show/animate the final state.
   */
  private finishBattle(
    battle: BattleState
  ): void {
    this.beginEventBatch();

    try {
      for (const cardId of [
        ...battle.attackingParty,
        ...battle.blockingParty
      ]) {
        const card = this.state.cards[cardId];

        if (!card || card.zone !== "play") {
          continue;
        }

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId
          });
        }
      }
    } finally {
      this.endEventBatch();
    }

    battle.phase = "finished";
    battle.speed = undefined;

    this.emit({
      type: "battleEnded",
      battleId: battle.id
    });

    this.state.priorityPlayerId = this.state.activePlayerId;
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
    const available = this.getThresholds(playerId);

    for (const icon of [
      "rage",
      "greed",
      "deception",
      "elitism",
      "obsession",
      "volition"
    ] as const) {
      if (
        (available[icon] ?? 0) <
        (required[icon] ?? 0)
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
      case "resourcePlayed":
      case "abilityActivated":
        return event.cardId;

      case "damageDealt":
        return event.targetId;

      default:
        return undefined;
    }
  }


  private definitionHasKeyword(
    definition: CardDefinition,
    keyword: Keyword
  ): boolean {
    return definition.behavior?.keywords?.includes(keyword) ?? false;
  }

  private hasKeyword(
    cardId: CardInstanceId,
    keyword: Keyword
  ): boolean {
    return this.definitionHasKeyword(
      this.getDefinition(cardId),
      keyword
    );
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

