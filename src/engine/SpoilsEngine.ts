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
  CardPlayability,
  CardSelector,
  Condition,
  Cost,
  DevelopChoice,
  Duration,
  Effect,
  FactionDefinition,
  GameAction,
  GameEvent,
  GameFlowView,
  GameState,
  Keyword,
  NumberExpression,
  PendingChoice,
  PendingEffectFrame,
  PlayerId,
  PlayerRef,
  PlayerState,
  ResolutionContext,
  ResourceIcon,
  ResponseContinuation,
  ResponseWindowKind,
  ResponseWindowState,
  Restriction,
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
import { drawRandom, randomSeed } from "./rng.js";

/** Reserved target-declaration id for an "Attach to X" card's play-time target. */
const ATTACH_TARGET_ID = "attachTo";

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

  /**
   * Explicit override for `random`, as passed to the constructor. Threaded
   * through to `canPayCosts`'s simulate-on-a-clone probe so a test's
   * scripted sequence applies there too — `undefined` (the production
   * default) instead lets that probe derive its own stream from the clone's
   * own `rngState`, so a dry-run affordability check can never advance the
   * real game's RNG.
   */
  private readonly randomOverride?: () => number;

  /** Backs `shuffleDeck` and any random-valued expression/target. Defaults to the seeded, serializable stream on `state.rngState`. */
  private readonly random: () => number;

  constructor(
    definitions: CardDefinition[],
    initialState: GameState,
    random?: () => number
  ) {
    this.randomOverride = random;
    this.random = random ?? (() => drawRandom(this.state));

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
    this.state.rngState ??= randomSeed();

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
    // Once the game has ended, only let already-in-flight resolution (a
    // battle finishing, a response window closing) drain to a clean stop —
    // block anything that would start something new.
    const isDraining =
      !!this.state.responseWindow ||
      !!this.state.battle ||
      this.responseStack.length > 0;

    assert(!this.state.winner || isDraining, "The game has already ended.");

    assert(
      !this.state.pendingChoice || action.type === "resolvePendingChoice",
      "A pending choice must be resolved before any other action."
    );

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

      case "resolvePendingChoice":
        this.resolvePendingChoice(action.playerId, action.choice);
        return;
    }
  }

  /**
   * Single query surface intended for a UI / renderer.
   */
  getFlowView(): GameFlowView {
    let mode: GameFlowView["mode"] =
      this.state.turnPhase === "develop" ? "develop" : "main";

    if (this.state.winner) {
      mode = "gameOver";
    } else if (this.state.pendingChoice) {
      mode = "pendingChoice";
    } else if (this.state.setup.phase === "mulligan") {
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
      battle: this.getBattleView(),
      winner: this.state.winner,
      pendingChoice: this.state.pendingChoice
        ? structuredClone(this.state.pendingChoice)
        : undefined
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

  private shuffleInPlace<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
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
    ].filter(modifier => modifier.stat === stat);

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

  /**
   * Whether `cardId` (which must be in `playerId`'s hand) could be deployed right now — the same
   * timing/threshold/numeric-cost gates `playCard` itself enforces, exposed read-only so a UI can
   * warn (or grey a card out) *before* walking the player through target selection for something
   * that was never payable, instead of only finding out from `perform()` rejecting it at the end.
   * Doesn't cover a card's targets or extra costs (deplete/discard/destroy/depleteSelected) —
   * those depend on selections the player hasn't made yet, so `perform()` is still the last word
   * on whether a specific play actually goes through.
   */
  getCardPlayability(playerId: PlayerId, cardId: CardInstanceId): CardPlayability {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    let legalTiming = false;
    if (card.controllerId === playerId && card.zone === "hand") {
      try {
        this.assertCanDeployAtCurrentTiming(playerId, definition);
        legalTiming = true;
      } catch {
        legalTiming = false;
      }
    }

    const thresholdMet = this.meetsThreshold(playerId, definition.threshold);

    const pendingReduction = this.state.costReductions.find(
      reduction => reduction.playerId === playerId
    );
    const numericCost = Math.max(
      0,
      (definition.cost ?? 0) - (pendingReduction?.amount ?? 0)
    );
    const availableResources = this.getAvailableResourceCount(playerId);

    return {
      playable: legalTiming && thresholdMet && availableResources >= numericCost,
      legalTiming,
      thresholdMet,
      numericCost,
      availableResources
    };
  }

  /** Convenience filter over `getCardPlayability` — every card in `playerId`'s hand that's currently deployable. */
  getPlayableHandCards(playerId: PlayerId): CardInstanceId[] {
    return this.requirePlayer(playerId).hand.filter(
      cardId => this.getCardPlayability(playerId, cardId).playable
    );
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
    this.assertCanDeployAtCurrentTiming(
      action.playerId,
      this.getDefinition(action.cardId)
    );

    this.deployCard(
      action.playerId,
      action.cardId,
      action.selected ?? {},
      action.variables ?? {},
      false
    );

    this.afterStackAction(action.playerId);
  }

  /**
   * The core "put a hand card on the response stack" logic shared by a
   * normal playCard action and a `deployForFree` effect's nested play.
   * Timing (priority/response-window) legality is the caller's
   * responsibility — `deployForFree` deploys synchronously as part of
   * resolving another effect, not as a fresh player-initiated action, so it
   * deliberately skips `assertCanDeployAtCurrentTiming`.
   */
  private deployCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    free: boolean
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(card.id);

    assert(
      card.controllerId === playerId,
      "You do not control that card."
    );
    assert(card.zone === "hand", "Card must be in your hand.");

    assert(
      this.meetsThreshold(playerId, definition.threshold),
      "Threshold requirements are not met."
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: playerId,
      selected,
      variables
    };

    // Resolved before condition/targets/costs — e.g. "flip a coin; X is 1
    // or 2" has to be settled before "pick X or fewer items" can even be
    // validated.
    this.applyVariableRolls(this.getTacticVariableRolls(definition), context);

    const tacticCondition = this.getTacticCondition(definition);
    assert(
      !tacticCondition || this.evaluateCondition(tacticCondition, context),
      "This card cannot be deployed right now."
    );

    this.validateTargetDeclarations(
      this.getPlayTargetDeclarations(definition),
      context
    );

    // Deploying for free waives only the numeric cost — any other extra
    // costs (targets, deplete, etc.) still apply, matching cards like
    // Spontaneous Displacement's "you still need to... satisfy its extra
    // costs" reminder text.
    const extraCosts = this.getTacticCosts(definition).filter(
      cost => !free || cost.type !== "payResources"
    );

    // A pending "reduce the next numeric cost you pay this turn" is only
    // actually consumed once the whole payment is confirmed affordable —
    // peeked here, spliced out below, not before.
    const pendingReduction = free
      ? undefined
      : this.state.costReductions.find(
          reduction => reduction.playerId === playerId
        );

    const numericCost = free
      ? 0
      : Math.max(0, (definition.cost ?? 0) - (pendingReduction?.amount ?? 0));

    const costs: Cost[] = [
      { type: "payResources", amount: numericCost },
      ...extraCosts
    ];

    assert(this.canPayCosts(costs, context), "Costs cannot be paid.");

    if (pendingReduction) {
      this.state.costReductions = this.state.costReductions.filter(
        reduction => reduction.id !== pendingReduction.id
      );
    }

    this.payCosts(costs, context);

    this.moveCard(card.id, "deploying");

    this.emit({
      type: "cardPlayed",
      cardId: card.id,
      playerId
    });

    const effects =
      definition.type === "tactic"
        ? this.getTacticEffects(definition)
        : [];

    this.responseStack.push({
      id: nextId("stack"),
      sourceId: card.id,
      controllerId: playerId,
      kind: "card",
      effects,
      context
    });
  }

  /**
   * Resolves the chosen card from a `deployForFree` effect: deploys it
   * (waiving its numeric cost) and resolves it synchronously — like any
   * other nested consequence of an effect, it does not open its own
   * response window — before continuing whatever ability the
   * `deployForFree` effect itself belonged to.
   */
  private deployCardForFree(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>
  ): void {
    this.deployCard(playerId, cardId, selected, variables, true);

    // Only reached once deployCard has committed (it throws before
    // mutating anything on a validation failure) — this IS the "deployed
    // for free" pendingChoice being answered, so clear it now.
    this.state.pendingChoice = undefined;

    // If the newly-deployed card's own resolution (e.g. its ETB trigger)
    // needs a chooser's input, that pause takes priority — the ability
    // that originally paused on `deployForFree` must stay parked in
    // pendingEffectFrames until this new pause is answered too, not get
    // resumed out from under it.
    if (this.resolveTopOfStack()) {
      this.resumeEffectFrames();
    }
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition
  ): TargetDeclaration[] {
    const declarations: TargetDeclaration[] = [];

    if (definition.type === "tactic") {
      // Barebones convention:
      // tactic cards use the first activated-ability-shaped behavior as the
      // instructions that resolve when the tactic finishes being deployed.
      const tacticAbility = definition.behavior?.abilities?.find(
        ability => ability.type === "activated"
      ) as ActivatedAbility | undefined;

      declarations.push(...(tacticAbility?.targets ?? []));
    }

    if (definition.attachTo) {
      declarations.push({
        id: ATTACH_TARGET_ID,
        selector: { type: definition.attachTo },
        count: 1
      });
    }

    return declarations;
  }

  private getTacticEffects(definition: CardDefinition): Effect[] {
    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.effects ?? [];
  }

  /** Extra costs beyond the printed numeric cost (e.g. "EXTRA COST: Choose a number for X. Pay X+X."). */
  private getTacticCosts(definition: CardDefinition): Cost[] {
    if (definition.type !== "tactic") {
      return [];
    }

    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.costs ?? [];
  }

  /** A play-timing restriction beyond the normal response-window rules (e.g. "deploy this only while you are attacking"). */
  private getTacticCondition(definition: CardDefinition): Condition | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }

    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.condition;
  }

  private getTacticVariableRolls(
    definition: CardDefinition
  ): Record<string, NumberExpression> | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }

    const tacticAbility = definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;

    return tacticAbility?.variables;
  }

  /** Evaluates `rolls` once and merges them into `context.variables`, without overwriting anything already explicitly supplied there. */
  private applyVariableRolls(
    rolls: Record<string, NumberExpression> | undefined,
    context: ResolutionContext
  ): void {
    if (!rolls) {
      return;
    }

    const resolved: Record<string, number> = {};

    for (const [id, expression] of Object.entries(rolls)) {
      resolved[id] = this.evaluateNumber(expression, context);
    }

    context.variables = { ...resolved, ...context.variables };
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
    // A face-down card is an anonymous resource (RULES.md §4) — its own
    // printed abilities are inert while face-down, same as triggered
    // abilities (findTriggers) and continuous ones (getContinuousModifiers
    // et al.) already treat it.
    assert(!card.faceDown, "A face-down card's abilities cannot be activated.");

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
      selected: action.selected ?? {},
      variables: action.variables ?? {}
    };

    this.applyVariableRolls(ability.variables, context);

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

  /** Returns true if the popped item's effects (and any bookkeeping after them) ran to completion without pausing on a chooser effect. */
  private resolveTopOfStack(): boolean {
    const item = this.responseStack.pop();

    assert(item, "Response stack is empty.");

    return this.runEffectFrame({
      effects: item.effects,
      index: 0,
      context: item.context,
      finishStackItem: item
    });
  }

  private finishStackItem(item: StackItem): void {
    if (item.kind === "card") {
      const card = this.requireCard(item.sourceId);
      const definition = this.getDefinition(card.id);

      if (definition.type === "tactic") {
        if (card.zone === "deploying") {
          this.moveCard(card.id, "discard");
        }
      } else if (card.zone === "deploying") {
        this.moveCard(card.id, "play");

        if (definition.attachTo) {
          card.attachedTo = item.context.selected[ATTACH_TARGET_ID]?.[0];
        }

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

  /**
   * Resolves `frame.effects` from `frame.index`, pausing (leaving a
   * `pendingChoice` set and re-pushing the remainder onto
   * `state.pendingEffectFrames`) the moment a "chooser" effect
   * (`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
   * `deployForFree`) needs a specific player's input. Returns true if the
   * frame ran to completion (and `finishStackItem`, if set, has already
   * been handled).
   */
  private runEffectFrame(frame: PendingEffectFrame): boolean {
    for (let i = frame.index; i < frame.effects.length; i++) {
      this.resolveEffect(frame.effects[i], frame.context);
      this.processImmediateQueue();
      this.checkStateBasedActions();

      if (this.state.pendingChoice) {
        this.state.pendingEffectFrames.push({ ...frame, index: i + 1 });
        return false;
      }
    }

    if (frame.finishStackItem) {
      this.finishStackItem(frame.finishStackItem);
    }

    return true;
  }

  /**
   * Continues whatever was suspended in `state.pendingEffectFrames`, most
   * recently-paused first (LIFO — a chooser effect's own `effects` finish
   * before the outer ability they were nested in resumes). Call once a
   * chooser-style pendingChoice has been answered and its immediate
   * follow-up effects (if any) have been pushed as a new frame.
   */
  private resumeEffectFrames(): void {
    while (this.state.pendingEffectFrames.length > 0) {
      const frame = this.state.pendingEffectFrames.pop()!;
      const completed = this.runEffectFrame(frame);
      if (!completed) return;
    }
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
    // RULES.md §6: playing a resource happens only via the develop step's
    // "play resource" choice (or a card effect that explicitly does so) —
    // never as a normal card play, which would bypass the once-per-turn limit.
    assert(
      definition.type !== "resource",
      "Resource cards can only be played during the develop step."
    );

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
    const batchId = nextId("batch");
    const triggers = this.findTriggers(event, batchId);

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

  private findTriggers(event: GameEvent, batchId: string): TriggerResolution[] {
    const results: TriggerResolution[] = [];

    const eventCardId = this.getEventCardId(event);

    for (const card of Object.values(this.state.cards)) {
      // A card's own "leaves play" trigger (cardDestroyed, or cardMoved out
      // of `play`) must still be considered even though `moveCard` already
      // updated this card's zone before emit() was called — otherwise the
      // zone check below would always filter out the one card the event is
      // actually about.
      const isLeavingPlayEventSource =
        eventCardId === card.id &&
        (event.type === "cardDestroyed" ||
          (event.type === "cardMoved" && event.from === "play"));

      if ((card.zone !== "play" && !isLeavingPlayEventSource) || card.faceDown) {
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
            context,
            batchId
          });
        }
      }
    }

    return results;
  }

  private processImmediateQueue(): void {
    while (this.immediateQueue.length > 0) {
      // A pendingChoice already outstanding (set by whatever called into
      // this — directly, or several frames up a reentrant call chain) must
      // be answered before anything else in the queue is touched. Without
      // this guard, a reentrant call reached via a *different* path (e.g.
      // finishBattle's own beginEventBatch/endEventBatch, entered from
      // resumeContinuation right after this same queue produced the still-
      // unanswered choice) can reach the next queued trigger and resolve it
      // — and if that trigger's own effects set pendingChoice too, it
      // silently overwrites the first one before anyone ever saw or
      // answered it, permanently losing that trigger's effects.
      if (this.state.pendingChoice) return;

      // Peeked, not shifted: if this trigger turns out to need a player
      // choice, it must stay at the head of the queue so resolvePendingChoice
      // can resume exactly here afterward.
      const trigger = this.immediateQueue[0];

      if (
        !this.state.cards[trigger.sourceId] &&
        trigger.context.event?.type !== "cardDestroyed"
      ) {
        this.immediateQueue.shift();
        continue;
      }

      // RULES.md §7: triggers firing "at once" (from the same event) are
      // ordered by their common controller, or by the active player if
      // they belong to different players — never by iteration order.
      const batch = this.getUnorderedTriggerBatch(trigger.batchId);

      if (batch.length > 1) {
        const controllerIds = new Set(
          batch.map(queued => queued.context.controllerId)
        );

        this.state.pendingChoice = {
          kind: "orderTriggers",
          id: nextId("choice"),
          playerId:
            controllerIds.size === 1
              ? [...controllerIds][0]
              : this.state.activePlayerId,
          triggers: batch.map(queued => ({
            sourceId: queued.sourceId,
            abilityId: queued.ability.id
          }))
        };

        return;
      }

      const declarations = trigger.ability.targets ?? [];
      const unresolved = this.findUnresolvedTargetDeclarations(
        declarations,
        trigger.context
      );

      if (unresolved.length > 0) {
        this.state.pendingChoice = {
          kind: "selectTargets",
          id: nextId("choice"),
          playerId: trigger.context.controllerId,
          sourceId: trigger.sourceId,
          abilityId: trigger.ability.id,
          declarations: unresolved
        };

        return;
      }

      if (declarations.length) {
        // Only unambiguous declarations reach here — exactly enough legal
        // candidates to fill every slot, nothing left to decide.
        this.autoSelectTargets(declarations, trigger.context);
      }

      // Committed: remove before resolving effects. An effect can itself
      // emit an event (e.g. dealDamage → damageDealt), reentrantly calling
      // processImmediateQueue — this trigger must not still be at the head
      // when that happens, or it gets resolved again and recurses forever.
      this.immediateQueue.shift();

      const completed = this.runEffectFrame({
        effects: trigger.ability.effects,
        index: 0,
        context: trigger.context
      });

      if (!completed) return;
    }
  }

  /** The leading run of immediateQueue entries sharing one batchId (same emitted event). */
  private getUnorderedTriggerBatch(batchId: string): TriggerResolution[] {
    const batch: TriggerResolution[] = [];

    for (const trigger of this.immediateQueue) {
      if (trigger.batchId !== batchId) break;
      batch.push(trigger);
    }

    return batch;
  }

  /**
   * Target declarations a triggered ability can't fill on its own — more
   * legal candidates than slots, so a real decision is needed (RULES.md §7's
   * "a real client should request choices here"). A declaration with too
   * few candidates is left for autoSelectTargets to reject as before; that's
   * a genuinely unplayable trigger, not a choice.
   */
  private findUnresolvedTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): TargetDeclaration[] {
    const unresolved: TargetDeclaration[] = [];

    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.queryCards(declaration.selector, context);
      const max = this.evaluateNumber(declaration.count, context);

      // An optional declaration is always a real decision when at least
      // one legal candidate exists — the controller might decline (or, for
      // an "N or fewer" range, pick fewer than the max) even when there's
      // exactly one, unlike a mandatory declaration (which is only
      // "unresolved" when genuinely ambiguous).
      if (
        candidates.length > max ||
        (declaration.optional && candidates.length > 0)
      ) {
        unresolved.push(declaration);
      }
    }

    return unresolved;
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

      case "numberCompare": {
        return compare(
          this.evaluateNumber(condition.left, context),
          condition.operator,
          this.evaluateNumber(condition.right, context)
        );
      }

      case "inBattle": {
        const cardId = this.resolveTargetRef(condition.target, context);
        const battle = this.state.battle;

        if (!cardId || !battle) {
          return false;
        }

        if (condition.role === "attacker") {
          return battle.attackingParty.includes(cardId);
        }

        if (condition.role === "blocker") {
          return battle.blockingParty.includes(cardId);
        }

        return (
          battle.attackingParty.includes(cardId) ||
          battle.blockingParty.includes(cardId)
        );
      }

      case "sourceIsDamageSource": {
        return (
          context.event?.type === "damageDealt" &&
          context.event.sourceId === context.sourceId
        );
      }

      case "cardMovedFromZone": {
        return (
          context.event?.type === "cardMoved" &&
          context.event.from === condition.zone
        );
      }

      case "battleRole": {
        const battle = this.state.battle;
        if (!battle) {
          return false;
        }

        return condition.role === "attacker"
          ? battle.attackerPlayerId === context.controllerId
          : battle.defenderPlayerId === context.controllerId;
      }

      case "eventPlayerIs": {
        const event = context.event;

        if (!event || !("playerId" in event)) {
          return false;
        }

        return event.playerId === this.resolvePlayerRef(condition.player, context).id;
      }

      case "targetInSelection": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }

        return (context.selected[condition.selection] ?? []).includes(cardId);
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

      case "variable":
        return context.variables?.[expression.id] ?? 0;

      case "random": {
        const min = this.evaluateNumber(expression.min, context);
        const max = this.evaluateNumber(expression.max, context);
        return min + Math.floor(this.random() * (max - min + 1));
      }

      case "cardCost": {
        const cardId = this.resolveTargetRef(expression.target, context);
        assert(cardId, "Unable to resolve cardCost target.");
        return this.getDefinition(cardId).cost ?? 0;
      }

      case "divide": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return expression.rounding === "up"
          ? Math.ceil(value / by)
          : Math.floor(value / by);
      }

      case "modulo": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return ((value % by) + by) % by;
      }

      case "selectionCount": {
        return (context.selected[expression.id] ?? []).length;
      }
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

      const max = this.evaluateNumber(declaration.count, context);
      const min = declaration.optional ? 0 : max;

      assert(
        selected.length >= min && selected.length <= max,
        `Target '${declaration.id}' requires ` +
          (min === max ? `${max}` : `${min}-${max}`) +
          " selection(s)."
      );

      assert(
        new Set(selected).size === selected.length,
        `Target '${declaration.id}' selected the same card more than once.`
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

      // findUnresolvedTargetDeclarations already routes any optional
      // declaration with a legal candidate to a pendingChoice — reaching
      // here means it has none, i.e. an automatic decline.
      if (declaration.optional && candidates.length === 0) {
        context.selected[declaration.id] = [];
        continue;
      }

      assert(
        candidates.length === this.evaluateNumber(declaration.count, context),
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

    if (ref === "attachedTo") {
      return this.state.cards[context.sourceId]?.attachedTo;
    }

    if (ref === "eventCard") {
      return this.getEventCardId(context.event);
    }

    if (ref.type === "card") {
      return ref.id;
    }

    if (ref.type === "random") {
      const candidates = this.queryCards(ref.selector, context);
      if (candidates.length === 0) {
        return undefined;
      }
      return candidates[Math.floor(this.random() * candidates.length)].id;
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

    if (ref.type === "ownerOf") {
      const cardId = this.resolveTargetRef(ref.target, context);
      assert(cardId, "Unable to resolve ownerOf target.");
      return this.requirePlayer(this.requireCard(cardId).ownerId);
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
    // are checked transactionally. Pass randomOverride (not `this.random`,
    // which is bound to *this* engine's state) so a dry-run probe draws
    // from the clone's own rngState and can never advance the real game's.
    const clone = structuredClone(this.state);

    try {
      const engine = new SpoilsEngine(
        Object.values(this.definitions),
        clone,
        this.randomOverride
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

        const legal = new Set(
          this.queryCards(
            {
              ...cost.selector,
              controller:
                cost.selector.controller ?? "self",
              zone: cost.selector.zone ?? "hand"
            },
            context
          )
            .filter(card => card.controllerId === player.id)
            .map(card => card.id)
        );

        const selected = context.selected[cost.id] ?? [];

        assert(
          selected.length === cost.count,
          `Discard cost '${cost.id}' requires selecting exactly ${cost.count} card(s).`
        );
        assert(
          new Set(selected).size === selected.length,
          `Discard cost '${cost.id}' selected the same card more than once.`
        );

        for (const cardId of selected) {
          assert(
            legal.has(cardId),
            `Illegal discard-cost selection '${cardId}' for '${cost.id}'.`
          );
        }

        for (const cardId of selected) {
          this.moveCard(cardId, "discard", emitEvents);
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

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing removeCounter-cost target.");

        const card = this.requireCard(targetId);
        const amount = this.evaluateNumber(cost.amount, context);
        const current = card.counters[cost.counter] ?? 0;

        assert(current >= amount, `Not enough '${cost.counter}' counters to remove.`);

        card.counters[cost.counter] = current - amount;
        return;
      }

      case "depleteSelected": {
        const targetIds = context.selected[cost.declarationId] ?? [];
        const cards = targetIds.map(targetId => this.requireCard(targetId));

        for (const card of cards) {
          assert(!card.depleted, "Card is already depleted.");
        }

        for (const card of cards) {
          card.depleted = true;

          if (emitEvents) {
            this.emit({
              type: "cardDepleted",
              cardId: card.id
            });
          }
        }

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
        // RULES.md §12: an effect whose target can't be resolved (e.g. a
        // `{type:"random"}` selector matching nothing) is carried out as far
        // as possible — here, not at all — rather than aborting resolution.
        // The zone check (mirroring `destroy`) additionally covers a target
        // that resolved fine at activation time but left hand before this
        // effect actually reached the front of the response stack (RULES.md
        // §7's LIFO resolution can leave a lot of daylight between the two).
        if (!targetId || this.state.cards[targetId]?.zone !== "hand") return;

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

        if (!targetId) return;

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

        if (!targetId) return;

        this.moveCard(targetId, effect.to);
        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        // RULES.md §12: destroying a card no longer in play is carried out
        // "as far as possible" — i.e. it's simply already done. An earlier
        // effect in the same ability (or a batched trigger) may well have
        // already destroyed this exact target.
        if (this.state.cards[targetId]?.zone === "play") {
          this.destroyCard(targetId);
        }

        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

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

        if (!targetId) return;

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

        if (!targetId) return;

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

        if (!targetId) return;

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

        if (!targetId) return;

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

      case "takeControl": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const newController = this.resolvePlayerRef(effect.controller, context);

        if (card.controllerId === newController.id) {
          return;
        }

        // A card in play is filed under its controller's `play` array
        // (see moveCard) — that bookkeeping has to move with it, or
        // getAvailableResourceIds/getThresholds/attack-eligibility loops
        // (all of which iterate a specific player's `play`) go stale.
        if (card.zone === "play") {
          const oldController = this.requirePlayer(card.controllerId);
          oldController.play = oldController.play.filter(cardId => cardId !== targetId);
          newController.play.push(targetId);
        }

        card.controllerId = newController.id;
        return;
      }

      case "removeFromGame": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        // RULES.md §12: impossible to fully carry out if it's already gone
        // — as far as "removed from the game" is concerned, that's already
        // true, so this is a no-op rather than an error.
        if (this.state.cards[targetId]) {
          this.moveCard(targetId, "removed");
        }

        return;
      }

      case "forEach": {
        // Snapshot the match set before resolving anything — an earlier
        // iteration destroying/moving a card must not shrink who else is
        // hit by this same effect (RULES.md-style "simultaneous" resolution).
        const candidateIds = effect.selected
          ? context.selected[effect.selected] ?? []
          : this.queryCards(effect.selector!, context).map(card => card.id);

        this.beginEventBatch();

        try {
          for (const candidateId of candidateIds) {
            const nestedContext: ResolutionContext = {
              ...context,
              selected: {
                ...context.selected,
                __candidate: [candidateId]
              }
            };

            for (const nested of effect.effects) {
              this.resolveEffect(nested, nestedContext);
            }
          }
        } finally {
          this.endEventBatch();
        }

        return;
      }

      case "attachTo": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const toId = this.resolveTargetRef(effect.to, context);
        if (!targetId || !toId) return;

        this.requireCard(targetId).attachedTo = toId;
        return;
      }

      case "grantKeyword": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.keywordGrants.push({
          id: nextId("keywordGrant"),
          sourceId: context.sourceId,
          targetId,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "grantRestriction": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.restrictions.push({
          id: nextId("restriction"),
          sourceId: context.sourceId,
          targetId,
          restriction: effect.restriction,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "if": {
        if (!this.evaluateCondition(effect.condition, context)) {
          return;
        }

        for (const nested of effect.effects) {
          this.resolveEffect(nested, context);
        }

        return;
      }

      case "shuffleDeck": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.shuffleInPlace(player.deck);
        return;
      }

      case "chooserSelectsTarget": {
        // RULES.md §12: an instruction impossible to fully carry out (no
        // legal candidate at all, e.g. an empty hand to discard from) is
        // carried out as far as possible, not left as an unanswerable
        // pendingChoice requiring a selection that can't exist.
        if (this.queryCards(effect.declaration.selector, context).length === 0) {
          return;
        }

        const chooser = this.resolvePlayerRef(effect.chooser, context);

        this.state.pendingChoice = {
          kind: "chooserSelectsTarget",
          id: nextId("choice"),
          playerId: chooser.id,
          declaration: effect.declaration,
          effects: effect.effects,
          context
        };

        return;
      }

      case "chooserSelectsOption": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);

        this.state.pendingChoice = {
          kind: "chooserSelectsOption",
          id: nextId("choice"),
          playerId: chooser.id,
          optionCount: effect.options.length,
          options: effect.options,
          context
        };

        return;
      }

      case "lookAndReorder": {
        const player = this.resolvePlayerRef(effect.player, context);
        const count = this.evaluateNumber(effect.count, context);
        const cardIds = player.deck.slice(0, Math.max(0, count));

        if (cardIds.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "reorderDeck",
          id: nextId("choice"),
          playerId: player.id,
          cardIds
        };

        return;
      }

      case "reduceNextCost": {
        const player = this.resolvePlayerRef(effect.player, context);
        const amount = this.evaluateNumber(effect.amount, context);

        this.state.costReductions.push({
          id: nextId("costReduction"),
          playerId: player.id,
          amount,
          createdTurn: this.state.turn
        });

        return;
      }

      case "deployForFree": {
        const player = this.resolvePlayerRef(effect.player, context);
        const maxCost = this.evaluateNumber(effect.maxCost, context);

        const candidates = Object.values(this.state.cards)
          .filter(card => {
            if (card.zone !== "hand" || card.controllerId !== player.id) {
              return false;
            }

            const definition = this.getDefinition(card.id);

            if ((definition.cost ?? 0) > maxCost) {
              return false;
            }

            return !effect.selector || this.matchesSelector(card, effect.selector, context);
          })
          .map(card => card.id);

        if (candidates.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "deployForFree",
          id: nextId("choice"),
          playerId: player.id,
          candidates,
          context
        };

        return;
      }

      case "distributeAmong": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const targets = context.selected[effect.selected] ?? [];
        const amount = this.evaluateNumber(effect.amount, context);

        if (targets.length === 0 || amount <= 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "distributeAmong",
          id: nextId("choice"),
          playerId: chooser.id,
          targets,
          amount,
          effects: effect.effects,
          context
        };

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

  /** Mirrors getContinuousModifiers, but for `ContinuousAbility.keywords`. */
  private getContinuousKeywordGrants(
    targetId: CardInstanceId
  ): Keyword[] {
    const results: Keyword[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }

      const definition = this.getDefinition(source.id);

      for (const ability of definition.behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.keywords) {
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
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const grant of ability.keywords) {
          const resolvedTarget = this.resolveTargetRef(
            grant.target,
            context
          );

          if (resolvedTarget !== targetId) {
            continue;
          }

          results.push(grant.keyword);
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousKeywordGrants, but for `ContinuousAbility.restrictions`. */
  private getContinuousRestrictionGrants(
    targetId: CardInstanceId
  ): Restriction[] {
    const results: Restriction[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }

      const definition = this.getDefinition(source.id);

      for (const ability of definition.behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.restrictions) {
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
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const grant of ability.restrictions) {
          const resolvedTarget = this.resolveTargetRef(
            grant.target,
            context
          );

          if (resolvedTarget !== targetId) {
            continue;
          }

          results.push(grant.restriction);
        }
      }
    }

    return results;
  }

  private hasRestriction(
    cardId: CardInstanceId,
    restriction: Restriction
  ): boolean {
    if (
      this.state.restrictions.some(
        grant => grant.targetId === cardId && grant.restriction === restriction
      )
    ) {
      return true;
    }

    return this.getContinuousRestrictionGrants(cardId).includes(restriction);
  }

  // ---------------------------------------------------------------------------
  // State-based actions
  // ---------------------------------------------------------------------------

  private checkStateBasedActions(): void {
    let changed = true;

    while (changed) {
      changed = false;

      for (const card of Object.values(this.state.cards)) {
        if (card.zone !== "play" || card.faceDown) {
          continue;
        }

        const definition = this.getDefinition(card.id);

        // Lethal damage: characters clear it every turn, locations carry it
        // across turns (see RULES.md §3), but both die the same way once
        // accumulated damage reaches their capacity — `life` for a
        // character, `structure` for a location (distinct stats/fields).
        if (definition.type === "character" || definition.type === "location") {
          const capacity = this.getStat(
            card.id,
            definition.type === "location" ? "structure" : "life"
          );

          if (capacity > 0 && card.damage >= capacity) {
            this.destroyCard(card.id);
            changed = true;
            break;
          }
        }

        // Attach to X: destroyed once its target is no longer a legal,
        // in-play card of the required type (RULES.md §9).
        if (definition.attachTo) {
          const target = card.attachedTo
            ? this.state.cards[card.attachedTo]
            : undefined;

          const validTarget =
            !!target &&
            target.zone === "play" &&
            this.getDefinition(target.id).type === definition.attachTo;

          if (!validTarget) {
            this.destroyCard(card.id);
            changed = true;
            break;
          }
        }
      }

      if (changed) continue;

      // Unique: a player may not control more than one in-play card per
      // Unique designation (RULES.md §9). Which copy survives is the
      // player's decision, so this pauses the engine on a pendingChoice
      // rather than guessing — see resolvePendingChoice.
      if (!this.state.pendingChoice) {
        const groups = new Map<
          string,
          { controllerId: PlayerId; unique: string; cardIds: CardInstanceId[] }
        >();

        for (const card of Object.values(this.state.cards)) {
          if (card.zone !== "play" || card.faceDown) continue;

          const definition = this.getDefinition(card.id);
          if (!definition.unique) continue;

          const key = `${card.controllerId} ${definition.unique}`;
          const group = groups.get(key) ?? {
            controllerId: card.controllerId,
            unique: definition.unique,
            cardIds: []
          };

          group.cardIds.push(card.id);
          groups.set(key, group);
        }

        const conflict = [...groups.values()].find(
          group => group.cardIds.length > 1
        );

        if (conflict) {
          this.state.pendingChoice = {
            kind: "uniqueSurvivor",
            id: nextId("choice"),
            playerId: conflict.controllerId,
            unique: conflict.unique,
            candidates: conflict.cardIds
          };

          return;
        }
      }

      // Victory: a faction at 0 influence ends the game (RULES.md §1).
      if (!this.state.winner) {
        const losers = Object.values(this.state.players).filter(
          player => player.influence <= 0
        );

        if (losers.length >= 2) {
          this.state.winner = "draw";
        } else if (losers.length === 1) {
          this.state.winner = this.getOpponent(losers[0].id).id;
        }
      }
    }
  }

  private resolvePendingChoice(
    playerId: PlayerId,
    choice: Extract<GameAction, { type: "resolvePendingChoice" }>["choice"]
  ): void {
    const pending = this.state.pendingChoice;

    assert(pending, "There is no pending choice.");
    assert(
      pending.kind === choice.kind,
      "This choice does not match the pending decision."
    );
    assert(pending.playerId === playerId, "It is not your decision to make.");

    switch (choice.kind) {
      case "uniqueSurvivor": {
        assert(pending.kind === "uniqueSurvivor", "This choice does not match the pending decision.");
        assert(
          pending.candidates.includes(choice.keep),
          "That card is not one of the Unique candidates."
        );

        this.state.pendingChoice = undefined;

        for (const cardId of pending.candidates) {
          if (cardId !== choice.keep) {
            this.destroyCard(cardId);
          }
        }

        this.checkStateBasedActions();
        return;
      }

      case "selectTargets": {
        assert(pending.kind === "selectTargets", "This choice does not match the pending decision.");

        const trigger = this.immediateQueue[0];

        assert(
          trigger &&
            trigger.sourceId === pending.sourceId &&
            trigger.ability.id === pending.abilityId,
          "The pending trigger is no longer waiting to resolve."
        );

        for (const declaration of pending.declarations) {
          const selection = choice.selected[declaration.id];

          assert(selection, `Missing selection for target '${declaration.id}'.`);

          const max = this.evaluateNumber(declaration.count, trigger.context);
          const min = declaration.optional ? 0 : max;

          assert(
            selection.length >= min && selection.length <= max,
            `Target '${declaration.id}' requires ` +
              (min === max ? `${max}` : `${min}-${max}`) +
              " selection(s)."
          );
          assert(
            new Set(selection).size === selection.length,
            `Target '${declaration.id}' selected the same card more than once.`
          );

          const legal = new Set(
            this.queryCards(declaration.selector, trigger.context).map(card => card.id)
          );

          for (const cardId of selection) {
            assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
          }
        }

        trigger.context.selected = {
          ...trigger.context.selected,
          ...choice.selected
        };

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        return;
      }

      case "orderTriggers": {
        assert(pending.kind === "orderTriggers", "This choice does not match the pending decision.");

        const batchId = this.immediateQueue[0]?.batchId;
        const batch = batchId ? this.getUnorderedTriggerBatch(batchId) : [];

        assert(
          choice.order.length === batch.length,
          "Order must include every triggered ability in the batch, exactly once."
        );

        const remaining = [...batch];
        const reordered: TriggerResolution[] = [];

        for (const ref of choice.order) {
          const index = remaining.findIndex(
            queued => queued.sourceId === ref.sourceId && queued.ability.id === ref.abilityId
          );

          assert(
            index !== -1,
            `'${ref.sourceId}:${ref.abilityId}' is not part of this batch, or was already placed.`
          );

          reordered.push(remaining[index]);
          remaining.splice(index, 1);
        }

        // Fresh, unshared batch ids so this same group isn't re-detected as
        // needing another ordering decision once we resume.
        for (const queued of reordered) {
          queued.batchId = nextId("batch");
        }

        this.immediateQueue.splice(0, batch.length, ...reordered);

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        return;
      }

      case "chooserSelectsTarget": {
        assert(pending.kind === "chooserSelectsTarget", "This choice does not match the pending decision.");

        const declaration = pending.declaration;
        const selection = choice.selected;

        const max = this.evaluateNumber(declaration.count, pending.context);
        const min = declaration.optional ? 0 : max;

        assert(
          selection.length >= min && selection.length <= max,
          `Target '${declaration.id}' requires ` +
            (min === max ? `${max}` : `${min}-${max}`) +
            " selection(s)."
        );
        assert(
          new Set(selection).size === selection.length,
          `Target '${declaration.id}' selected the same card more than once.`
        );

        const legal = new Set(
          this.queryCards(declaration.selector, pending.context).map(card => card.id)
        );

        for (const cardId of selection) {
          assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
        }

        pending.context.selected = {
          ...pending.context.selected,
          [declaration.id]: selection
        };

        this.state.pendingChoice = undefined;
        this.state.pendingEffectFrames.push({
          effects: pending.effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "chooserSelectsOption": {
        assert(pending.kind === "chooserSelectsOption", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.index) &&
            choice.index >= 0 &&
            choice.index < pending.optionCount,
          "Invalid option index."
        );

        this.state.pendingChoice = undefined;
        this.state.pendingEffectFrames.push({
          effects: pending.options[choice.index].effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "reorderDeck": {
        assert(pending.kind === "reorderDeck", "This choice does not match the pending decision.");

        const original = new Set(pending.cardIds);
        const reordered = new Set(choice.order);

        assert(
          choice.order.length === pending.cardIds.length &&
            reordered.size === original.size &&
            [...original].every(cardId => reordered.has(cardId)),
          "The new order must contain exactly the same cards, each once."
        );

        const player = this.requirePlayer(pending.playerId);
        player.deck.splice(0, pending.cardIds.length, ...choice.order);

        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "deployForFree": {
        assert(pending.kind === "deployForFree", "This choice does not match the pending decision.");

        if (!choice.cardId) {
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        assert(
          pending.candidates.includes(choice.cardId),
          "That card is not a legal free-deploy candidate."
        );

        // Deliberately not clearing pendingChoice here: deployCardForFree
        // validates (throwing before any mutation, e.g. a missing
        // extra-cost target) before it commits — see deployCard. If it
        // throws, this same choice must still be answerable, so the player
        // can retry with a corrected answer instead of getting stuck.
        this.deployCardForFree(
          pending.playerId,
          choice.cardId,
          choice.selected ?? {},
          choice.variables ?? {}
        );
        return;
      }

      case "distributeAmong": {
        assert(pending.kind === "distributeAmong", "This choice does not match the pending decision.");

        const entries = Object.entries(choice.shares).filter(([, share]) => share > 0);

        for (const [cardId, share] of entries) {
          assert(
            pending.targets.includes(cardId),
            `'${cardId}' is not one of the distribution targets.`
          );
          assert(
            Number.isInteger(share) && share > 0,
            `Share for '${cardId}' must be a positive integer.`
          );
        }

        const total = entries.reduce((sum, [, share]) => sum + share, 0);
        assert(
          total <= pending.amount,
          `Shares must add up to at most ${pending.amount}, got ${total}.`
        );

        this.state.pendingChoice = undefined;

        this.beginEventBatch();

        try {
          for (const [cardId, share] of entries) {
            const nestedContext: ResolutionContext = {
              ...pending.context,
              selected: { ...pending.context.selected, __candidate: [cardId] },
              variables: { ...pending.context.variables, __amount: share }
            };

            for (const nested of pending.effects) {
              this.resolveEffect(nested, nestedContext);
              this.checkStateBasedActions();
            }
          }
        } finally {
          this.endEventBatch();
        }

        this.resumeEffectFrames();
        return;
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
      // Depletion and damage are play-zone concepts (a "tapped" or damaged
      // card in hand/deck/discard is meaningless) — leaving play clears
      // both, the same way a location's turn-spanning damage still resets
      // once it's no longer in play at all.
      card.depleted = false;
      card.damage = 0;
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
      to === "void" ||
      to === "removed"
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
      player.removed = player.removed.filter(
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
      case "removed":
        return player.removed;
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

  /** Shared "should this durationed entry survive end-of-turn cleanup" check for modifiers and keyword grants. */
  private durationStillActive(entry: {
    duration: Duration;
    createdTurn: number;
    sourceId?: CardInstanceId;
  }): boolean {
    if (
      entry.duration.type === "untilEndOfTurn" &&
      entry.createdTurn <= this.state.turn
    ) {
      return false;
    }

    if (entry.duration.type === "whileSourceInPlay") {
      return (
        !!entry.sourceId &&
        this.state.cards[entry.sourceId]?.zone === "play"
      );
    }

    return true;
  }

  private finishTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Turn owner changed before end-turn resolution."
    );

    this.state.modifiers = this.state.modifiers.filter(modifier =>
      this.durationStillActive(modifier)
    );
    this.state.keywordGrants = this.state.keywordGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.restrictions = this.state.restrictions.filter(grant =>
      this.durationStillActive(grant)
    );
    // Always "this turn only" — no permanent/whileSourceInPlay variant.
    this.state.costReductions = [];

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

    const battleId = nextId("battle");

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
          !this.hasRestriction(attackerId, "cannotAttack"),
          "Character cannot attack."
        );
        assert(
          attacker.attackEligibleTurn === this.state.turn ||
            this.hasKeyword(attackerId, "aggro"),
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
      id: battleId,
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

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        this.emit({
          type: "characterAttacked",
          cardId: attackerId,
          battleId
        });
      }
    } finally {
      this.endEventBatch();
    }

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
      assert(
        !this.hasRestriction(blockerId, "cannotBlock"),
        "Character cannot block."
      );
    }

    this.assertCovertBlockingLegality(
      battle.attackingParty,
      blockerIds
    );

    battle.blockingParty = [...blockerIds];

    this.beginEventBatch();

    try {
      for (const blockerId of blockerIds) {
        this.emit({
          type: "characterBlocked",
          cardId: blockerId,
          battleId: battle.id
        });
      }
    } finally {
      this.endEventBatch();
    }

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
    sourceId: CardInstanceId,
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
      const blockerTargets = blockers.map(cardId => ({
        type: "card" as const,
        cardId
      }));

      // "May assign its battle damage to the target of the attack instead
      // of the blocking party" — an extra option alongside the blockers,
      // not a forced redirect.
      if (this.hasKeyword(sourceId, "redirectDamage")) {
        return [...blockerTargets, ...this.getAttackTargetAsBattleDamageTarget(battle)];
      }

      return blockerTargets;
    }

    return this.getAttackTargetAsBattleDamageTarget(battle);
  }

  /** The attack's original target (faction or location), if it's still a legal damage target — [] if a targeted location has already left play. */
  private getAttackTargetAsBattleDamageTarget(
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
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
        // A faction hit is damage to that player's faction *card* — resolve
        // it the same way so "when this card deals/takes damage" triggers
        // (sourceIsDamageSource / sourceIsEventCard) fire for faction
        // damage exactly like they do for character/location damage.
        const targetId =
          assignment.target.type === "faction"
            ? this.requirePlayer(assignment.target.playerId).factionId
            : assignment.target.cardId;

        if (!targetId) {
          continue;
        }

        const target = this.state.cards[targetId];

        if (!target || target.zone !== "play") {
          continue;
        }

        this.emit({
          type: "damageDealt",
          sourceId: assignment.sourceId,
          targetId,
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
      case "characterAttacked":
      case "characterBlocked":
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
    if (
      this.definitionHasKeyword(
        this.getDefinition(cardId),
        keyword
      )
    ) {
      return true;
    }

    if (
      this.state.keywordGrants.some(
        grant => grant.targetId === cardId && grant.keyword === keyword
      )
    ) {
      return true;
    }

    return this.getContinuousKeywordGrants(cardId).includes(keyword);
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

