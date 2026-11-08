// Random legal-play driver.
//
// Plays a whole game by choosing, with a seeded PRNG, among the actions the engine says are legal. It
// reads the game only through the engine's public query surface (`getFlowView` and the per-mode option
// queries) and validates every candidate with `engine.checkAction` before `perform`: a rejected action is
// never performed. Same setup + same driver seed + same catalog => the same game, action for action.
//
// It reads the acting player from the flow view and iterates players from `state.players`, so it does not
// assume two seats.
//
// Two things are engine findings, never papered over: `perform` throwing on an action `checkAction`
// approved, and a non-gameOver state in which no candidate action is accepted. `playRandomGame` stops at
// the first one and reports it (seed, step, action, error).

import {
  answerPlayRequirement,
  createFactionGame,
  declinedKey,
  type AttackTarget,
  type BattleDamageAssignment,
  type BattleView,
  type CardInstanceId,
  type GameAction,
  type GameFlowView,
  type PendingChoice,
  type PickStep,
  type PlayAction,
  type PlayAnswer,
  type PlayerId,
  type PlayRequirement,
  type SelectionRequirementsInput,
  type SpoilsEngine
} from "../../../engine.js";
import { mulberry32 } from "./prng.js";
import {
  CARD_NAME_CATALOG,
  CATALOG,
  expandDeck,
  shuffled,
  type GameSetupInputs,
  type Random
} from "./random-decks.js";

export * from "./random-decks.js";

type PendingAnswer = Extract<GameAction, { type: "resolvePendingChoice" }>["choice"];

/** An engine problem the driver ran into (`kind` says which). */
export interface Finding {
  kind: "setupThrew" | "performThrew" | "queryThrew" | "noLegalAction";
  /** The setup seed of the game (`GameSetupInputs.seed`). */
  seed: number;
  /** Index of the action that was being chosen / performed (0 = the first action after setup). */
  step: number;
  /** The flow mode at that point. */
  mode: string;
  /** The action `checkAction` approved and `perform` then threw on (`performThrew`). */
  action?: GameAction;
  /** The engine's error message (`queryThrew`: a read-only query, or `checkAction`, threw while the driver was listing candidates). */
  error?: string;
  /** What the driver knew about the state (`noLegalAction`): setup phase / pending choice kind / battle phase. */
  detail?: string;
}

export interface DriverOptions {
  /** Hard cap on performed actions; a game that reaches it is reported `capped`, not a finding. */
  maxActions?: number;
  /** Called after every performed action. */
  onAction?(engine: SpoilsEngine, action: GameAction, index: number): void;
}

export interface DriverResult {
  setup: GameSetupInputs;
  driverSeed: number;
  actions: GameAction[];
  status: "gameOver" | "capped" | "finding";
  winner?: GameFlowView["winner"];
  turns: number;
  finding?: Finding;
}

/** Builds the game a setup describes, through the real entry point `createFactionGame`. */
export function createEngine(setup: GameSetupInputs): SpoilsEngine {
  const players = setup.players.map(player => ({
    id: player.id,
    name: player.name,
    factionDefinitionId: player.deck.factionDefinitionId,
    deckDefinitionIds: expandDeck(player.deck)
  }));

  return createFactionGame(CATALOG, {
    players,
    seed: setup.seed,
    chooseFirstPlayer: setup.chooseFirstPlayer,
    chooseStartingResources: setup.chooseStartingResources,
    cardCatalog: CARD_NAME_CATALOG,
    ...(setup.firstPlayerId !== undefined ? { firstPlayerId: setup.firstPlayerId } : {}),
    ...(setup.startingResourceX ? { startingResourceX: setup.startingResourceX } : {}),
    ...(setup.startingResourceOpponent ? { startingResourceOpponent: setup.startingResourceOpponent } : {}),
    ...(setup.createdAbility ? { createdAbility: setup.createdAbility } : {})
  });
}

const SUBTYPE_NAMES: string[] = [...new Set(CATALOG.flatMap(card => card.subtype ?? []))].sort();
const CARD_NAMES: string[] = [...new Set(CATALOG.map(card => card.name))].sort();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

class Driver {
  constructor(
    private readonly engine: SpoilsEngine,
    private readonly rng: Random
  ) {}

  private get state() {
    return this.engine.state;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)]!;
  }

  private int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  private subset<T>(items: readonly T[], min: number, max: number): T[] {
    const high = Math.min(max, items.length);
    const low = Math.min(min, high);
    return shuffled(items, this.rng).slice(0, this.int(low, high));
  }

  /** Categories in a weighted random order (a weighted shuffle: higher weight tends to come first). */
  private weightedOrder<T>(items: Array<{ weight: number; value: T }>): T[] {
    return items
      .map(item => ({ item, key: -Math.log(1 - this.rng()) / item.weight }))
      .sort((x, y) => x.key - y.key)
      .map(entry => entry.item.value);
  }

  // ---------------------------------------------------------------------------
  // Candidate actions per flow mode
  // ---------------------------------------------------------------------------

  *candidates(flow: GameFlowView): Generator<GameAction> {
    const actor = flow.actingPlayerId;
    switch (flow.mode) {
      case "gameOver":
        return;
      case "setup":
        yield* this.setupCandidates(flow, actor);
        return;
      case "pendingChoice":
        if (flow.pendingChoice) yield* this.pendingCandidates(flow.pendingChoice);
        return;
      case "resolvingResponses":
      case "battleFinished":
        yield { type: "advanceFlow" };
        return;
      case "battleChoice":
        if (actor && flow.battle) yield* this.battleCandidates(flow.battle, actor);
        yield { type: "advanceFlow" };
        return;
      case "main":
        if (actor) yield* this.turnCandidates(actor, false);
        return;
      case "response":
        if (actor) yield* this.turnCandidates(actor, true);
        return;
    }
  }

  // --- setup -----------------------------------------------------------------

  private *setupCandidates(flow: GameFlowView, actor: PlayerId | undefined): Generator<GameAction> {
    if (!actor) return;
    const phase = flow.setup.phase;

    if (phase === "chooseStartingResources") {
      const choice = this.engine.getStartingResourceChoice(actor);
      if (!choice) return;
      const names = (id: CardInstanceId): string => this.engine.getDefinition(id).name.toLowerCase();
      const distinctFirst = (ids: readonly CardInstanceId[], count: number, shuffle: boolean): CardInstanceId[] => {
        const seen = new Set<string>();
        const out: CardInstanceId[] = [];
        for (const id of shuffle ? shuffled(ids, this.rng) : ids) {
          if (out.length >= count) break;
          if (choice.distinct && seen.has(names(id))) continue;
          seen.add(names(id));
          out.push(id);
        }
        return out;
      };
      const answerOf = (shuffle: boolean): CardInstanceId[] => {
        if (choice.slots) {
          const used = new Set<CardInstanceId>();
          return choice.slots.map(slot => {
            const free = slot.candidateCardIds.filter(id => !used.has(id));
            const id = shuffle ? this.pick(free) : free[0]!;
            used.add(id);
            return id;
          });
        }
        return distinctFirst(choice.candidateCardIds, choice.count, shuffle);
      };
      for (let attempt = 0; attempt < 4; attempt++) {
        yield { type: "chooseStartingResources", playerId: actor, cardIds: answerOf(true) };
      }
      yield { type: "chooseStartingResources", playerId: actor, cardIds: answerOf(false) };
      return;
    }

    if (phase === "chooseFirstPlayer") {
      const choice = this.engine.getFirstPlayerChoice();
      const decider = choice?.deciderId ?? actor;
      const players = Object.keys(this.state.players) as PlayerId[];
      for (const firstPlayerId of shuffled(players, this.rng)) {
        yield { type: "chooseFirstPlayer", playerId: decider, firstPlayerId };
      }
      return;
    }

    if (phase === "mulligan") {
      const limit = this.engine.getMulliganLimit(actor);
      const hand = this.state.players[actor]!.hand;
      if (limit > 0 && hand.length > 0 && this.rng() < 0.5) {
        const cardIds = this.subset(hand, 1, Math.min(limit, hand.length));
        // `previewMulligan` throws for an answer the engine would refuse; a refusal is just skipped.
        let previewable = true;
        try {
          this.engine.previewMulligan(actor, cardIds);
        } catch {
          previewable = false;
        }
        if (previewable) yield { type: "mulligan", playerId: actor, cardIds };
      }
      yield { type: "mulligan", playerId: actor, cardIds: [] };
    }
  }

  // --- main phase / response windows -----------------------------------------

  private *turnCandidates(actor: PlayerId, response: boolean): Generator<GameAction> {
    const engine = this.engine;
    const handCards = engine.getPlayableHandCards(actor);
    const outsideCards = engine.getPlayableFromOutsideHand(actor).filter(play => play.playability.playable).map(play => play.cardId);
    const abilities = engine.getActivatedAbilityStatuses(actor).filter(status => status.available);
    const flippable = this.state.players[actor]!.play.filter(cardId => {
      const card = this.state.cards[cardId];
      return !!card && card.faceDown && card.controllerId === actor && engine.getFlipUpPlayability(actor, cardId).playable;
    });
    const attack = engine.getAttackOptions(actor);
    const canEndTurn = !response && engine.getEndTurnBlock(actor) === undefined;

    type Category = () => Generator<GameAction>;
    const categories: Array<{ weight: number; value: Category }> = [];
    if (handCards.length + outsideCards.length > 0) {
      categories.push({
        weight: response ? 3 : 5,
        value: () => this.playCandidates(actor, [...handCards, ...outsideCards])
      });
    }
    if (abilities.length > 0) {
      categories.push({
        weight: response ? 2 : 1.5,
        value: () => this.abilityCandidates(actor, abilities.map(status => ({ cardId: status.cardId, abilityId: status.ability.id })))
      });
    }
    if (flippable.length > 0) categories.push({ weight: 1, value: () => this.flipCandidates(actor, flippable) });
    if (attack.attackers.length > 0 && attack.targets.length > 0) {
      categories.push({ weight: response ? 1 : 9, value: () => this.attackCandidates(actor, attack) });
    }
    if (response) categories.push({ weight: 6, value: function* () { yield { type: "passPriority", playerId: actor }; } });
    if (canEndTurn) {
      categories.push({ weight: 2, value: function* () { yield { type: "endTurn", playerId: actor }; } });
    }

    for (const category of this.weightedOrder(categories)) yield* category();

    // Whatever was tried above was refused: the safe moves that always make progress.
    if (response) yield { type: "passPriority", playerId: actor };
    else if (canEndTurn) yield { type: "endTurn", playerId: actor };
  }

  private *playCandidates(actor: PlayerId, cardIds: CardInstanceId[]): Generator<GameAction> {
    for (const cardId of shuffled(cardIds, this.rng)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        yield this.complete({ type: "playCard", playerId: actor, cardId });
      }
    }
  }

  private *abilityCandidates(
    actor: PlayerId,
    entries: Array<{ cardId: CardInstanceId; abilityId: string }>
  ): Generator<GameAction> {
    for (const { cardId, abilityId } of shuffled(entries, this.rng)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        yield this.complete({ type: "activateAbility", playerId: actor, cardId, abilityId });
      }
    }
  }

  private *flipCandidates(actor: PlayerId, cardIds: CardInstanceId[]): Generator<GameAction> {
    for (const cardId of shuffled(cardIds, this.rng)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        yield this.complete({ type: "flipUp", playerId: actor, cardId });
      }
    }
  }

  private *attackCandidates(actor: PlayerId, options: ReturnType<SpoilsEngine["getAttackOptions"]>): Generator<GameAction> {
    const make = (attackerIds: CardInstanceId[], target: AttackTarget): GameAction => ({
      type: "declareAttack",
      playerId: actor,
      attackerIds,
      target
    });
    const must = options.mustAttack;
    for (let attempt = 0; attempt < 3; attempt++) {
      const optional = options.attackers.filter(id => !must.includes(id));
      const extra = attempt === 0 ? optional : this.subset(optional, 0, optional.length);
      const target = this.pick(options.targets);
      yield make([...must, ...extra], target);
    }
    for (const attacker of shuffled(options.attackers, this.rng)) {
      yield make([...new Set([...must, attacker])], this.pick(options.targets));
    }
    if (must.length > 0) yield make([...must], this.pick(options.targets));
  }

  /**
   * Fills in what a play, ability use or FLIP UP still needs (mode, X, picks), one requirement at a time as
   * `getPlayRequirements` lists them, then sometimes names the resources that pay (`payWith`).
   */
  private complete(base: PlayAction): PlayAction {
    let action = base;
    for (let step = 0; step < 12; step++) {
      const requirements = this.engine.getPlayRequirements(action);
      const first = requirements[0];
      if (!first) break;
      const answer = this.answerRequirement(first);
      if (!answer) break;
      action = answerPlayRequirement(action, answer);
    }
    if (this.rng() < 0.3) {
      const payment = this.engine.getPaymentOptions(action);
      if (payment && payment.candidates.length >= payment.amount) {
        action = { ...action, payWith: shuffled(payment.candidates, this.rng).slice(0, payment.amount) };
      }
    }
    return action;
  }

  private answerRequirement(requirement: PlayRequirement): PlayAnswer | undefined {
    switch (requirement.kind) {
      case "mode":
        return { kind: "mode", index: this.pick(requirement.options).index };
      case "flipUpOption": {
        const usable = requirement.options.filter(option => option.available);
        return { kind: "flipUpOption", index: this.pick(usable.length > 0 ? usable : requirement.options).index };
      }
      case "variables":
        return { kind: "variables", values: this.variableValues(requirement.variables) };
      case "pick": {
        const chosen = this.choosePick(requirement);
        return { kind: "pick", id: requirement.requirement.id, ...chosen };
      }
    }
  }

  private variableValues(variables: Array<{ id: string; min: number; max: number }>): Record<string, number> {
    const values: Record<string, number> = {};
    for (const variable of variables) {
      const min = isFiniteNumber(variable.min) ? Math.max(0, Math.ceil(variable.min)) : 0;
      const max = isFiniteNumber(variable.max) ? Math.floor(variable.max) : min + 5;
      values[variable.id] = this.int(min, Math.max(min, Math.min(max, min + 5)));
    }
    return values;
  }

  private choosePick(step: PickStep): { cardIds: CardInstanceId[]; declined?: boolean } {
    if (step.declinable && this.rng() < 0.3) return { cardIds: [], declined: true };
    if (step.forced) return { cardIds: [...step.candidates] };
    if (step.orNone && this.rng() < 0.4) return { cardIds: [] };

    const target = this.int(Math.min(step.min, step.candidates.length), Math.min(step.max, step.candidates.length));
    const names = new Set<string>();
    const trades = new Set<string>();
    const types = new Set<string>();
    const cardIds: CardInstanceId[] = [];
    for (const id of shuffled(step.candidates, this.rng)) {
      if (cardIds.length >= target) break;
      const definition = this.engine.getDefinition(id);
      if (step.distinctNames && names.has(definition.name)) continue;
      if (step.distinctTrades && trades.has(String(definition.trade))) continue;
      if (step.distinctTypes && types.has(definition.type)) continue;
      names.add(definition.name);
      trades.add(String(definition.trade));
      types.add(definition.type);
      cardIds.push(id);
    }
    return { cardIds };
  }

  // --- battle ----------------------------------------------------------------

  private *battleCandidates(battle: BattleView, actor: PlayerId): Generator<GameAction> {
    if (battle.phase === "blocking") {
      const options = this.engine.getBlockOptions();
      const player = options?.playerId ?? actor;
      const blockers = options?.blockers ?? [];
      const must = options?.mustBlock ?? [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const optional = blockers.filter(id => !must.includes(id));
        const extra = this.rng() < 0.7 ? [] : this.subset(optional, 0, optional.length);
        yield { type: "declareBlockers", playerId: player, blockerIds: [...must, ...extra] };
      }
      if (must.length > 0) yield { type: "declareBlockers", playerId: player, blockerIds: [...must] };
      yield { type: "declareBlockers", playerId: player, blockerIds: [] };
      return;
    }

    if (battle.phase === "attackerDamageAssignment" || battle.phase === "defenderDamageAssignment") {
      for (let attempt = 0; attempt < 3; attempt++) {
        yield { type: "assignBattleDamage", playerId: actor, assignments: this.damageAssignments(battle, attempt > 0) };
      }
      if (battle.forcedAssignments) {
        yield { type: "assignBattleDamage", playerId: actor, assignments: battle.forcedAssignments };
      }
      yield { type: "assignBattleDamage", playerId: actor, assignments: this.damageAssignments(battle, false, true) };
    }
  }

  private damageAssignments(battle: BattleView, allowSplit: boolean, firstTarget = false): BattleDamageAssignment[] {
    const assignments: BattleDamageAssignment[] = [];
    for (const source of battle.damageSources) {
      if (source.strength <= 0 || source.legalTargets.length === 0) continue;
      const first = firstTarget ? source.legalTargets[0]! : this.pick(source.legalTargets);
      if (allowSplit && source.strength >= 2 && source.legalTargets.length >= 2 && this.rng() < 0.5) {
        const second = this.pick(source.legalTargets.filter(target => target !== first));
        const part = this.int(1, source.strength - 1);
        assignments.push({ sourceId: source.cardId, target: first, amount: part });
        assignments.push({ sourceId: source.cardId, target: second, amount: source.strength - part });
      } else {
        assignments.push({ sourceId: source.cardId, target: first, amount: source.strength });
      }
    }
    return assignments;
  }

  // ---------------------------------------------------------------------------
  // Pending choices
  // ---------------------------------------------------------------------------

  private answer(pending: PendingChoice, choice: PendingAnswer): GameAction {
    return { type: "resolvePendingChoice", playerId: pending.playerId, choice };
  }

  /** Picks for `input`'s declarations, one requirement at a time (later picks can depend on earlier ones). */
  private fillSelection(input: SelectionRequirementsInput): {
    selected: Record<string, CardInstanceId[]>;
    variables: Record<string, number>;
  } {
    const selected = { ...input.selected };
    const variables = { ...input.variables };
    for (let step = 0; step < 12; step++) {
      const requirements = this.engine.getSelectionRequirements({ ...input, selected, variables });
      const first = requirements[0];
      if (!first || first.kind === "mode" || first.kind === "flipUpOption") break;
      if (first.kind === "variables") {
        Object.assign(variables, this.variableValues(first.variables));
        continue;
      }
      const id = first.requirement.id;
      const chosen = this.choosePick(first);
      selected[id] = chosen.declined ? [] : chosen.cardIds;
      if (chosen.declined) selected[declinedKey(id)] = [];
    }
    return { selected, variables };
  }

  private *pendingCandidates(pending: PendingChoice): Generator<GameAction> {
    const answer = (choice: PendingAnswer): GameAction => this.answer(pending, choice);

    switch (pending.kind) {
      case "uniqueSurvivor":
        for (const keep of shuffled(pending.candidates, this.rng)) yield answer({ kind: "uniqueSurvivor", keep });
        return;

      case "selectTargets": {
        const context = pending.context;
        const input: SelectionRequirementsInput = {
          sourceId: pending.sourceId,
          controllerId: context?.controllerId ?? pending.playerId,
          pickerId: pending.playerId,
          ...(pending.abilityId ? { abilityId: pending.abilityId } : {}),
          declarations: pending.declarations,
          costs: [],
          selected: {},
          variables: {},
          ...(context ? { context } : {})
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          yield answer({ kind: "selectTargets", selected: this.fillSelection(input).selected });
        }
        const empty: Record<string, CardInstanceId[]> = {};
        for (const declaration of pending.declarations) empty[declaration.id] = [];
        yield answer({ kind: "selectTargets", selected: empty });
        return;
      }

      case "selectDeployTargets": {
        const input: SelectionRequirementsInput = {
          sourceId: pending.sourceId,
          controllerId: pending.playerId,
          declarations: pending.declarations,
          costs: [],
          selected: { ...pending.selected },
          variables: { ...pending.variables }
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          const { selected } = this.fillSelection(input);
          const own: Record<string, CardInstanceId[]> = {};
          for (const declaration of pending.declarations) own[declaration.id] = selected[declaration.id] ?? [];
          yield answer({ kind: "selectDeployTargets", selected: own });
        }
        const empty: Record<string, CardInstanceId[]> = {};
        for (const declaration of pending.declarations) empty[declaration.id] = [];
        yield answer({ kind: "selectDeployTargets", selected: empty });
        return;
      }

      case "orderTriggers":
        for (const next of shuffled(pending.triggers, this.rng)) yield answer({ kind: "orderTriggers", next });
        return;

      case "chooserSelectsTarget": {
        const context = pending.context;
        const input: SelectionRequirementsInput = {
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          pickerId: pending.playerId,
          ...(context.abilityId ? { abilityId: context.abilityId } : {}),
          declarations: [pending.declaration],
          costs: [],
          selected: {},
          variables: {},
          context
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          const { selected } = this.fillSelection(input);
          const declined = selected[declinedKey(pending.declaration.id)] !== undefined;
          yield answer({
            kind: "chooserSelectsTarget",
            selected: selected[pending.declaration.id] ?? [],
            ...(declined ? { declined: true } : {})
          });
        }
        const candidates = this.engine.queryCards(pending.declaration.selector, context).map(card => card.id);
        const count = Math.max(0, Math.floor(this.engine.evaluateNumber(pending.declaration.count, context)));
        yield answer({ kind: "chooserSelectsTarget", selected: shuffled(candidates, this.rng).slice(0, count) });
        yield answer({ kind: "chooserSelectsTarget", selected: [] });
        yield answer({ kind: "chooserSelectsTarget", selected: [], declined: true });
        return;
      }

      case "chooserSelectsOption": {
        const unavailable = new Set(pending.unavailableOptions ?? []);
        const indexes = Array.from({ length: pending.optionCount }, (_, index) => index);
        const open = indexes.filter(index => !unavailable.has(index));
        for (const index of shuffled(open, this.rng)) yield answer({ kind: "chooserSelectsOption", index });
        for (const index of shuffled(indexes.filter(index => unavailable.has(index)), this.rng)) {
          yield answer({ kind: "chooserSelectsOption", index });
        }
        return;
      }

      case "reorderDeck": {
        const ids = pending.cardIds;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (pending.intoHand) {
            const hand = this.subset(ids, pending.intoHand.min, pending.intoHand.max);
            const rest = shuffled(ids.filter(id => !hand.includes(id)), this.rng);
            yield answer({ kind: "reorderDeck", order: rest, hand });
          } else if (pending.to === "split") {
            const count = pending.bottomCount ?? this.int(0, ids.length);
            const bottom = shuffled(ids, this.rng).slice(0, count);
            const top = shuffled(ids.filter(id => !bottom.includes(id)), this.rng);
            yield answer({ kind: "reorderDeck", order: top, bottom });
          } else if (pending.upTo) {
            yield answer({ kind: "reorderDeck", order: shuffled(ids.slice(0, this.int(0, ids.length)), this.rng) });
          } else {
            yield answer({ kind: "reorderDeck", order: shuffled(ids, this.rng) });
          }
        }
        yield answer({ kind: "reorderDeck", order: [...ids] });
        return;
      }

      case "deployForFree": {
        for (const cardId of shuffled(pending.candidates, this.rng).slice(0, 3)) {
          if (this.rng() < 0.25) continue;
          for (let attempt = 0; attempt < 2; attempt++) {
            const input = this.engine.getPlaySelectionInput(pending.playerId, cardId);
            const { selected, variables } = this.fillSelection(input);
            yield answer({ kind: "deployForFree", cardId, selected, variables });
          }
        }
        yield answer({ kind: "deployForFree" });
        return;
      }

      case "distributeAmong": {
        for (let attempt = 0; attempt < 3; attempt++) {
          const shares: Record<CardInstanceId, number> = {};
          const open = [...pending.targets];
          let left = pending.upTo && attempt < 2 ? this.int(0, pending.amount) : pending.amount;
          while (left > 0 && open.length > 0) {
            const target = this.pick(open);
            const taken = shares[target] ?? 0;
            const cap = pending.caps?.[target];
            if (cap !== undefined && taken >= cap) {
              open.splice(open.indexOf(target), 1);
              continue;
            }
            shares[target] = taken + 1;
            left--;
          }
          yield answer({ kind: "distributeAmong", shares });
        }
        const first = pending.targets[0];
        yield answer({ kind: "distributeAmong", shares: first ? { [first]: pending.amount } : {} });
        return;
      }

      case "pileAssignment": {
        for (let attempt = 0; attempt < 3; attempt++) {
          const pile1 = pending.cardIds.filter(() => this.rng() < 0.5);
          yield answer({ kind: "pileAssignment", pile1, pile2: pending.cardIds.filter(id => !pile1.includes(id)) });
        }
        yield answer({ kind: "pileAssignment", pile1: [...pending.cardIds], pile2: [] });
        return;
      }

      case "replacementChoice":
        for (const apply of shuffled([true, false], this.rng)) yield answer({ kind: "replacementChoice", apply });
        return;

      case "chooseReplacement":
        for (const index of shuffled(pending.options.map((_, i) => i), this.rng)) {
          yield answer({ kind: "chooseReplacement", index });
        }
        return;

      case "nameValue": {
        const names =
          pending.options ?? (pending.valueKind === "subtype" ? SUBTYPE_NAMES : CARD_NAMES);
        for (let attempt = 0; attempt < 12; attempt++) {
          const value = this.pick(names);
          if (this.engine.checkNameValue(pending, value).ok) yield answer({ kind: "nameValue", value });
        }
        for (const value of names.slice(0, 40)) {
          if (this.engine.checkNameValue(pending, value).ok) yield answer({ kind: "nameValue", value });
        }
        return;
      }

      case "chooseNumber": {
        const min = isFiniteNumber(pending.min) ? Math.ceil(pending.min) : 0;
        const max = isFiniteNumber(pending.max) ? Math.floor(pending.max) : min + 5;
        for (let attempt = 0; attempt < 3; attempt++) {
          yield answer({ kind: "chooseNumber", value: this.int(min, Math.max(min, Math.min(max, min + 6))) });
        }
        yield answer({ kind: "chooseNumber", value: min });
        return;
      }

      case "alternatingPay":
      case "anyPlayerMayPay":
      case "mayPay": {
        const pay = this.rng() < 0.35;
        yield answer({ kind: pending.kind, pay });
        yield answer({ kind: pending.kind, pay: !pay });
        return;
      }

      case "useTargetAbility": {
        const abilities = this.engine.getCardActivatedAbilities(pending.targetCardId);
        if (this.rng() < 0.6) yield answer({ kind: "useTargetAbility" });
        for (const abilityId of shuffled(pending.abilityIds, this.rng)) {
          const ability = abilities.find(candidate => candidate.id === abilityId);
          const input: SelectionRequirementsInput = {
            sourceId: pending.targetCardId,
            controllerId: pending.playerId,
            abilityId,
            declarations: ability?.targets ?? [],
            costs: [],
            selected: {},
            variables: {},
            ...(ability ? { variableSource: { variables: ability.variables, variableBounds: ability.variableBounds, condition: ability.condition } } : {})
          };
          const { selected, variables } = this.fillSelection(input);
          yield answer({ kind: "useTargetAbility", abilityId, selected, variables });
        }
        yield answer({ kind: "useTargetAbility" });
        return;
      }

      case "useAnyAbility":
        if (this.rng() < 0.6) yield answer({ kind: "useAnyAbility" });
        for (const cardId of shuffled(pending.candidateCardIds, this.rng)) yield answer({ kind: "useAnyAbility", cardId });
        yield answer({ kind: "useAnyAbility" });
        return;

      case "partitionCards": {
        const ids = shuffled(pending.cardIds, this.rng);
        const piles: CardInstanceId[][] = Array.from({ length: pending.piles }, () => []);
        ids.forEach((id, index) => {
          const slot = index < pending.piles ? index : this.int(0, pending.piles - 1);
          piles[slot]!.push(id);
        });
        yield answer({ kind: "partitionCards", piles });
        return;
      }

      case "pickPile":
        for (const index of shuffled(pending.piles.map((_, i) => i), this.rng)) yield answer({ kind: "pickPile", index });
        return;

      case "takeFromPile":
        for (let attempt = 0; attempt < 3; attempt++) {
          yield answer({ kind: "takeFromPile", cardIds: this.subset(pending.candidates, 0, pending.max) });
        }
        yield answer({ kind: "takeFromPile", cardIds: [] });
        return;

      case "chooseChosenBlockers":
        for (let attempt = 0; attempt < 3; attempt++) {
          yield answer({ kind: "chooseChosenBlockers", cardIds: this.subset(pending.candidates, 0, pending.candidates.length) });
        }
        yield answer({ kind: "chooseChosenBlockers", cardIds: [...pending.candidates] });
        yield answer({ kind: "chooseChosenBlockers", cardIds: [] });
        return;

      case "coinFlipReplace":
        for (const reflip of shuffled([true, false], this.rng)) yield answer({ kind: "coinFlipReplace", reflip });
        return;

      case "auctionBid": {
        const high = Math.max(0, Math.floor(pending.maxBid));
        const low = Math.floor(pending.highBid) + 1;
        if (low <= high && this.rng() < 0.6) yield answer({ kind: "auctionBid", bid: this.int(low, high) });
        yield answer({ kind: "auctionBid", bid: 0 });
        if (low <= high) yield answer({ kind: "auctionBid", bid: low });
        return;
      }

      case "millInsteadOfDamage":
        yield answer({ kind: "millInsteadOfDamage", count: this.int(0, pending.max) });
        yield answer({ kind: "millInsteadOfDamage", count: 0 });
        return;

      case "spendCountersMenu": {
        const total = Object.values(pending.available).reduce((sum, n) => sum + n, 0);
        const affordable = pending.options.map((option, index) => ({ option, index })).filter(({ option }) => option.cost <= total);
        if (affordable.length > 0 && this.rng() < 0.4) {
          const { option, index } = this.pick(affordable);
          const left = { ...pending.available };
          const sources: CardInstanceId[] = [];
          for (let marker = 0; marker < option.cost; marker++) {
            const holders = Object.keys(left).filter(id => (left[id] ?? 0) > 0);
            const holder = this.pick(holders);
            left[holder] = (left[holder] ?? 0) - 1;
            sources.push(holder);
          }
          yield answer({ kind: "spendCountersMenu", optionIndex: index, sources });
        }
        yield answer({ kind: "spendCountersMenu", optionIndex: null });
        return;
      }

      case "playResource": {
        const faces = pending.canFaceUp === false ? [true] : shuffled([true, false], this.rng);
        for (const faceDown of faces) yield answer({ kind: "playResource", faceDown });
        yield answer({ kind: "playResource", faceDown: true });
        return;
      }

      case "resourceReveal":
        if (this.rng() < 0.5) {
          for (const cardId of shuffled(pending.candidates, this.rng).slice(0, 2)) {
            const input = this.engine.getPlaySelectionInput(pending.playerId, cardId);
            const { selected, variables } = this.fillSelection(input);
            yield answer({ kind: "resourceReveal", cardId, selected, variables });
          }
        }
        yield answer({ kind: "resourceReveal" });
        return;
    }
  }
}

function describeState(engine: SpoilsEngine, flow: GameFlowView): string {
  const parts: string[] = [`turn ${engine.state.turn}`];
  if (flow.mode === "setup") parts.push(`setup phase ${flow.setup.phase}`);
  if (flow.pendingChoice) parts.push(`pending ${flow.pendingChoice.kind}`);
  if (flow.battle) parts.push(`battle phase ${flow.battle.phase}`);
  if (flow.responseWindow) parts.push(`window ${flow.responseWindow.kind}/${flow.responseWindow.phase}`);
  return parts.join(", ");
}

/**
 * Plays `setup` to the end (or to `maxActions`) with a driver seeded by `driverSeed`. Never throws for an
 * engine problem: that comes back as `status: "finding"` with the details.
 */
export function playRandomGame(setup: GameSetupInputs, driverSeed: number, options: DriverOptions = {}): DriverResult {
  const maxActions = options.maxActions ?? 4000;
  const actions: GameAction[] = [];
  const result = (status: DriverResult["status"], engine?: SpoilsEngine, finding?: Finding): DriverResult => ({
    setup,
    driverSeed,
    actions,
    status,
    ...(engine?.state.winner ? { winner: engine.state.winner } : {}),
    turns: engine?.state.turn ?? 0,
    ...(finding ? { finding } : {})
  });

  let engine: SpoilsEngine;
  try {
    engine = createEngine(setup);
  } catch (error) {
    return result("finding", undefined, {
      kind: "setupThrew",
      seed: setup.seed,
      step: 0,
      mode: "setup",
      error: error instanceof Error ? error.message : String(error)
    });
  }
  const driver = new Driver(engine, mulberry32(driverSeed));

  for (let step = 0; ; step++) {
    const flow = engine.getFlowView();
    if (flow.mode === "gameOver") return result("gameOver", engine);
    if (step >= maxActions) return result("capped", engine);

    let performed = false;
    let current: GameAction | undefined;
    try {
      for (const candidate of driver.candidates(flow)) {
        // `checkAction` and `perform` only read the action, so the one object is checked, performed and logged.
        const action = candidate;
        current = action;
        if (!engine.checkAction(action).ok) continue;
        try {
          engine.perform(action);
        } catch (error) {
          return result("finding", engine, {
            kind: "performThrew",
            seed: setup.seed,
            step,
            mode: flow.mode,
            action,
            error: error instanceof Error ? error.message : String(error),
            detail: describeState(engine, flow)
          });
        }
        actions.push(action);
        options.onAction?.(engine, action, step);
        performed = true;
        break;
      }
    } catch (error) {
      // The engine / driver frames of the stack, trimmed to "function (file:line)", innermost first.
      const frames =
        error instanceof Error
          ? (error.stack ?? "")
              .split("\n")
              .slice(1)
              .map(line => line.trim().replace(/^at /, ""))
              .filter(line => /SpoilsEngine|driver\.ts/.test(line))
              .map(line => line.replace(/\(?[A-Za-z]:[^)]*[\\/]([^\\/)]+:\d+):\d+\)?/, "($1)"))
              .slice(0, 10)
              .join(" < ")
          : "";
      return result("finding", engine, {
        kind: "queryThrew",
        seed: setup.seed,
        step,
        mode: flow.mode,
        ...(current ? { action: current } : {}),
        error: error instanceof Error ? error.message : String(error),
        detail: `${describeState(engine, flow)}; ${frames}`
      });
    }

    if (!performed) {
      return result("finding", engine, {
        kind: "noLegalAction",
        seed: setup.seed,
        step,
        mode: flow.mode,
        detail: describeState(engine, flow)
      });
    }
  }
}
