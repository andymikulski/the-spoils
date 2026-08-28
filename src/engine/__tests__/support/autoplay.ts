// Generic, deterministic "policy bot" that drives a SpoilsEngine game to
// completion using only the engine's public API — no card-specific logic.
// It never guesses whether an action is legal: every candidate action is
// first tried against a cloned, throwaway engine (the same
// "simulate-on-a-structuredClone" pattern SpoilsEngine.canPayCosts itself
// uses internally, see CLAUDE.md) and only replayed for real once that
// simulation succeeds. That makes the bot correct-by-construction against
// the full, closed cost/condition/effect/target vocabulary in src/types —
// it doesn't need to understand what a card *does*, only what the engine
// will accept.
//
// This exists to prove a real precon-deck game (arcanist vs warlord, full
// card behaviors) can be played end to end through the public perform()/
// getFlowView() surface: setup, mulligans, the develop rule, main-turn play,
// activated/triggered abilities, multi-round battles with response windows
// on both sides, and every kind of GameState.pendingChoice — all the way to
// a winner. See full-game.test.ts.

import {
  type ActivatedAbility,
  type BattleDamageAssignment,
  type BattleView,
  type CardDefinition,
  type CardInstanceId,
  type Cost,
  type GameAction,
  type GameFlowView,
  type PendingChoice,
  type PlayerId,
  type ResolutionContext,
  type ResponseWindowState,
  type TargetDeclaration,
  type Threshold,
  parseThreshold,
  SpoilsEngine
} from "../../../engine.js";
import { mulberry32 } from "./prng.js";

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface AutoplayReport {
  turns: number;
  actions: number;
  mulligans: number;
  draws: number;
  resourcesPlayed: number;
  cardsPlayed: number;
  abilitiesActivated: number;
  attacksDeclared: number;
  blocksDeclared: number;
  totalResponses: number;
  /** The most responses added to a single response window (proves multi-response battles/actions actually happened, not just open-then-immediately-close). */
  maxResponsesInWindow: number;
  pendingChoicesResolved: Record<string, number>;
  winner?: PlayerId | "draw";
}

export interface AutoplayOptions {
  /** Hard cap on engine actions before giving up (a stuck/looping bot is a real bug, not something to silently truncate). */
  maxActions?: number;
  /** RNG driving the bot's own decisions (which card, block or not, decline-or-take an optional target, ...). Independent of the engine's own RNG. */
  botRandom?: () => number;
}

// ---------------------------------------------------------------------------
// Simulate-then-commit
// ---------------------------------------------------------------------------

function simulateLegal(engine: SpoilsEngine, action: GameAction): boolean {
  const probe = new SpoilsEngine(
    Object.values(engine.definitions),
    structuredClone(engine.state),
    () => 0.5
  );

  try {
    probe.perform(action);
    return true;
  } catch {
    return false;
  }
}

function tryCommit(engine: SpoilsEngine, action: GameAction): boolean {
  if (!simulateLegal(engine, action)) return false;
  engine.perform(action);
  return true;
}

/** Simulate-only greedy filter: keep adding candidates while the joint action stays legal, never touching the real engine. */
function greedyLegalSubset(
  engine: SpoilsEngine,
  buildAction: (ids: CardInstanceId[]) => GameAction,
  candidates: CardInstanceId[]
): CardInstanceId[] {
  const kept: CardInstanceId[] = [];
  for (const id of candidates) {
    const trial = [...kept, id];
    if (simulateLegal(engine, buildAction(trial))) {
      kept.push(id);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function collectVariableIds(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  if (obj.type === "variable" && typeof obj.id === "string") {
    ids.add(obj.id);
  }

  for (const value of Object.values(obj)) {
    collectVariableIds(value, ids);
  }
}

/** Variable ids the *player* must choose a value for (RULES.md §12's "choose a number for X"), as opposed to ones an ability rolls itself via `variables`. */
function playerChosenVariableIds(ability: {
  costs?: Cost[];
  targets?: TargetDeclaration[];
  variables?: Record<string, unknown>;
}): string[] {
  const ids = new Set<string>();
  collectVariableIds(ability.costs, ids);
  collectVariableIds(ability.targets, ids);

  for (const autoRolled of Object.keys(ability.variables ?? {})) {
    ids.delete(autoRolled);
  }

  return [...ids];
}

function* variableAssignments(varIds: string[]): Generator<Record<string, number>> {
  if (varIds.length === 0 || varIds.length > 2) {
    // Unbounded search space isn't worth it — 0 (RULES.md §12's documented
    // default for an unassigned cost variable) is always legal.
    yield Object.fromEntries(varIds.map(id => [id, 0]));
    return;
  }

  const candidateValues = [2, 1, 0];

  function* rec(i: number, acc: Record<string, number>): Generator<Record<string, number>> {
    if (i === varIds.length) {
      yield { ...acc };
      return;
    }
    for (const value of candidateValues) {
      acc[varIds[i]] = value;
      yield* rec(i + 1, acc);
    }
  }

  yield* rec(0, {});
}

function firstActivatedAbility(definition: CardDefinition): ActivatedAbility | undefined {
  return definition.behavior?.abilities?.find(
    (ability): ability is ActivatedAbility => ability.type === "activated"
  );
}

function costDeclarations(costs: Cost[] | undefined): TargetDeclaration[] {
  return (costs ?? [])
    .filter((cost): cost is Extract<Cost, { type: "discard" }> => cost.type === "discard")
    .map(cost => ({ id: cost.id, selector: cost.selector, count: cost.count }));
}

/** Mirrors SpoilsEngine's private getPlayTargetDeclarations (tactic-ability targets + a synthetic "Attach to X" declaration). */
function playTimeDeclarations(definition: CardDefinition): TargetDeclaration[] {
  const declarations: TargetDeclaration[] = [];

  if (definition.type === "tactic") {
    declarations.push(...(firstActivatedAbility(definition)?.targets ?? []));
  }

  if (definition.attachTo) {
    declarations.push({ id: "attachTo", selector: { type: definition.attachTo }, count: 1 });
  }

  return declarations;
}

/**
 * Fills in `selected` for a set of target declarations using only the
 * engine's public, side-effect-free readers (`queryCards`, `evaluateNumber`)
 * — both are pure given `variables`/`selected` that don't reference a
 * not-yet-rolled `{type:"random"}` expression, which holds for every
 * declaration these two decks' cards actually use (see full-game.test.ts's
 * companion investigation notes). Returns null if a mandatory declaration
 * has too few legal candidates right now.
 */
function buildSelected(
  engine: SpoilsEngine,
  playerId: PlayerId,
  sourceId: CardInstanceId,
  declarations: TargetDeclaration[],
  variables: Record<string, number>,
  rng: () => number
): Record<string, CardInstanceId[]> | null {
  const context: ResolutionContext = {
    sourceId,
    controllerId: playerId,
    selected: {},
    variables
  };

  for (const declaration of declarations) {
    const candidates = engine.queryCards(declaration.selector, context);
    const wanted = engine.evaluateNumber(declaration.count, context);

    if (!declaration.optional && candidates.length < wanted) {
      return null;
    }

    const take = declaration.optional
      ? (Math.min(wanted, candidates.length) > 0 && rng() < 0.5 ? Math.min(wanted, candidates.length) : 0)
      : wanted;

    context.selected[declaration.id] = shuffled(candidates, rng)
      .slice(0, take)
      .map(card => card.id);
  }

  return context.selected;
}

function roughlyAffordable(engine: SpoilsEngine, playerId: PlayerId, definition: CardDefinition): boolean {
  return (definition.cost ?? 0) <= engine.getAvailableResourceCount(playerId);
}

function meetsThresholdRoughly(engine: SpoilsEngine, playerId: PlayerId, definition: CardDefinition): boolean {
  const required = parseThreshold(definition.threshold);
  const have = engine.getThresholds(playerId);
  return (Object.keys(required) as (keyof Threshold)[]).every(
    icon => (have[icon] ?? 0) >= (required[icon] ?? 0)
  );
}

function abilityRoughlyAffordable(engine: SpoilsEngine, playerId: PlayerId, ability: ActivatedAbility): boolean {
  const resourceCost = (ability.costs ?? [])
    .filter(cost => cost.type === "payResources")
    .reduce((sum, cost) => sum + (typeof cost.amount === "number" ? cost.amount : 0), 0);
  return resourceCost <= engine.getAvailableResourceCount(playerId);
}

function isTacticalOrTactic(definition: CardDefinition): boolean {
  return definition.type === "tactic" || !!definition.behavior?.keywords?.includes("tactical");
}

function handCardCandidates(
  engine: SpoilsEngine,
  playerId: PlayerId,
  filter?: (definition: CardDefinition) => boolean
): CardInstanceId[] {
  return engine.state.players[playerId].hand.filter(cardId => {
    const definition = engine.getDefinition(cardId);
    if (definition.type === "resource") return false;
    if (filter && !filter(definition)) return false;
    if (!meetsThresholdRoughly(engine, playerId, definition)) return false;
    if (!roughlyAffordable(engine, playerId, definition)) return false;
    return true;
  });
}

interface AbilityCandidate {
  cardId: CardInstanceId;
  ability: ActivatedAbility;
}

function abilityCandidates(engine: SpoilsEngine, playerId: PlayerId): AbilityCandidate[] {
  const result: AbilityCandidate[] = [];

  for (const cardId of engine.state.players[playerId].play) {
    const card = engine.state.cards[cardId];
    if (card.controllerId !== playerId) continue;
    if (card.faceDown) continue;

    const definition = engine.getDefinition(cardId);
    for (const ability of definition.behavior?.abilities ?? []) {
      if (ability.type !== "activated") continue;
      if (!abilityRoughlyAffordable(engine, playerId, ability)) continue;
      result.push({ cardId, ability });
    }
  }

  return result;
}

function tryPlayCard(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, rng: () => number): boolean {
  const definition = engine.getDefinition(cardId);
  const ability = firstActivatedAbility(definition);
  const declarations = [...costDeclarations(ability?.costs), ...playTimeDeclarations(definition)];
  const varIds = playerChosenVariableIds(ability ?? {});

  for (const variables of variableAssignments(varIds)) {
    const selected = buildSelected(engine, playerId, cardId, declarations, variables, rng);
    if (!selected) continue;

    const action: GameAction = { type: "playCard", playerId, cardId, selected, variables };
    if (tryCommit(engine, action)) return true;
  }

  return false;
}

function tryActivateAbility(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  ability: ActivatedAbility,
  rng: () => number
): boolean {
  const declarations = [...costDeclarations(ability.costs), ...(ability.targets ?? [])];
  const varIds = playerChosenVariableIds(ability);

  for (const variables of variableAssignments(varIds)) {
    const selected = buildSelected(engine, playerId, cardId, declarations, variables, rng);
    if (!selected) continue;

    const action: GameAction = {
      type: "activateAbility",
      playerId,
      cardId,
      abilityId: ability.id,
      selected,
      variables
    };
    if (tryCommit(engine, action)) return true;
  }

  return false;
}

type AttackTarget = Extract<GameAction, { type: "declareAttack" }>["target"];

function tryDeclareAttack(
  engine: SpoilsEngine,
  playerId: PlayerId,
  opponentId: PlayerId,
  rng: () => number,
  report: AutoplayReport
): boolean {
  const candidates = engine.state.players[playerId].play.filter(cardId => {
    const card = engine.state.cards[cardId];
    return !card.depleted && !card.faceDown && engine.getDefinition(cardId).type === "character";
  });

  if (candidates.length === 0) return false;

  const opponentLocations = engine.state.players[opponentId].play.filter(
    cardId => !engine.state.cards[cardId].faceDown && engine.getDefinition(cardId).type === "location"
  );

  const target: AttackTarget =
    opponentLocations.length > 0 && rng() < 0.3
      ? { type: "card", cardId: opponentLocations[0] }
      : { type: "faction", playerId: opponentId };

  const buildAction = (ids: CardInstanceId[]): GameAction => ({
    type: "declareAttack",
    playerId,
    attackerIds: ids,
    target
  });

  const finalIds = simulateLegal(engine, buildAction(candidates))
    ? candidates
    : greedyLegalSubset(engine, buildAction, candidates);

  if (finalIds.length === 0) return false;

  engine.perform(buildAction(finalIds));
  report.attacksDeclared += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Per-mode handlers
// ---------------------------------------------------------------------------

function handleMulligan(
  engine: SpoilsEngine,
  setup: Extract<GameFlowView["setup"], { phase: "mulligan" }>,
  rng: () => number,
  report: AutoplayReport
): void {
  const playerId = setup.order[setup.currentIndex];
  const hand = engine.state.players[playerId].hand;

  let cardIds: CardInstanceId[] = [];
  if (hand.length >= 2 && rng() < 0.5) {
    const sorted = [...hand].sort(
      (a, b) => (engine.getDefinition(b).cost ?? 0) - (engine.getDefinition(a).cost ?? 0)
    );
    cardIds = sorted.slice(0, 2);
  }

  engine.perform({ type: "mulligan", playerId, cardIds });
  report.mulligans += 1;
}

function handleDevelop(engine: SpoilsEngine, playerId: PlayerId, rng: () => number, report: AutoplayReport): void {
  const choices = engine.getDevelopChoices(playerId);
  const resourceRule = choices.find(choice => choice.type === "playResource");
  const drawRule = choices.find(choice => choice.type === "draw");

  const hand = engine.state.players[playerId].hand;

  if (resourceRule && hand.length >= resourceRule.count && engine.getAvailableResourceCount(playerId) < 9) {
    const preferredResource = hand.find(cardId => engine.getDefinition(cardId).type === "resource");
    const pick: CardInstanceId[] = preferredResource ? [preferredResource] : [];

    for (const cardId of hand) {
      if (pick.length >= resourceRule.count) break;
      if (!pick.includes(cardId)) pick.push(cardId);
    }

    if (pick.length === resourceRule.count) {
      const cards = pick.map(cardId => ({
        cardId,
        faceDown: engine.getDefinition(cardId).type !== "resource"
      }));

      if (
        tryCommit(engine, {
          type: "chooseDevelop",
          playerId,
          choice: { type: "playResource", cards }
        })
      ) {
        report.resourcesPlayed += cards.length;
        return;
      }
    }
  }

  if (drawRule) {
    engine.perform({ type: "chooseDevelop", playerId, choice: { type: "draw" } });
    report.draws += 1;
    return;
  }

  throw new Error(`Player '${playerId}' has no usable develop choice.`);
}

function handleResponse(
  engine: SpoilsEngine,
  window: ResponseWindowState,
  rng: () => number,
  report: AutoplayReport,
  responsesByWindow: Map<string, number>
): void {
  const playerId = window.priorityPlayerId;
  const used = responsesByWindow.get(window.id) ?? 0;

  if (used < 4) {
    for (const cardId of shuffled(handCardCandidates(engine, playerId, isTacticalOrTactic), rng)) {
      if (tryPlayCard(engine, playerId, cardId, rng)) {
        responsesByWindow.set(window.id, used + 1);
        report.totalResponses += 1;
        report.maxResponsesInWindow = Math.max(report.maxResponsesInWindow, used + 1);
        return;
      }
    }

    for (const { cardId, ability } of shuffled(abilityCandidates(engine, playerId), rng)) {
      if (tryActivateAbility(engine, playerId, cardId, ability, rng)) {
        responsesByWindow.set(window.id, used + 1);
        report.totalResponses += 1;
        report.maxResponsesInWindow = Math.max(report.maxResponsesInWindow, used + 1);
        return;
      }
    }
  }

  engine.perform({ type: "passPriority", playerId });
}

function handleBattleChoice(
  engine: SpoilsEngine,
  battle: BattleView,
  rng: () => number,
  report: AutoplayReport
): void {
  if (battle.phase === "blocking") {
    const defenderId = battle.defenderPlayerId;
    const candidates = engine.state.players[defenderId].play.filter(cardId => {
      const card = engine.state.cards[cardId];
      return !card.depleted && !card.faceDown && engine.getDefinition(cardId).type === "character";
    });

    const buildAction = (ids: CardInstanceId[]): GameAction => ({
      type: "declareBlockers",
      playerId: defenderId,
      blockerIds: ids
    });

    const finalIds =
      candidates.length > 0 && simulateLegal(engine, buildAction(candidates))
        ? candidates
        : greedyLegalSubset(engine, buildAction, candidates);

    engine.perform(buildAction(finalIds));
    if (finalIds.length > 0) report.blocksDeclared += 1;
    return;
  }

  const actingPlayerId = battle.actingPlayerId;
  if (!actingPlayerId) {
    throw new Error(`battleChoice in phase '${battle.phase}' has no acting player.`);
  }

  const assignments: BattleDamageAssignment[] = [];
  for (const source of battle.damageSources) {
    // A source with 0 (or negative, clamped) strength must assign exactly
    // that much — i.e. no assignment entries at all; the engine rejects a
    // literal `amount: 0` entry as not a positive integer.
    if (source.legalTargets.length === 0 || source.strength <= 0) continue;
    assignments.push({
      sourceId: source.cardId,
      target: source.legalTargets[0],
      amount: source.strength
    });
  }

  engine.perform({ type: "assignBattleDamage", playerId: actingPlayerId, assignments });
}

function handlePendingChoice(
  engine: SpoilsEngine,
  pending: PendingChoice,
  rng: () => number,
  report: AutoplayReport
): void {
  report.pendingChoicesResolved[pending.kind] = (report.pendingChoicesResolved[pending.kind] ?? 0) + 1;

  switch (pending.kind) {
    case "uniqueSurvivor": {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "uniqueSurvivor", keep: pending.candidates[0] }
      });
      return;
    }

    case "orderTriggers": {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "orderTriggers", next: pending.triggers[0] }
      });
      return;
    }

    case "selectTargets": {
      const context: ResolutionContext = {
        sourceId: pending.sourceId,
        controllerId: pending.playerId,
        selected: {},
        variables: {}
      };

      const selected: Record<string, CardInstanceId[]> = {};
      for (const declaration of pending.declarations) {
        const candidates = engine.queryCards(declaration.selector, context);
        const wanted = engine.evaluateNumber(declaration.count, context);
        const take = declaration.optional
          ? (Math.min(wanted, candidates.length) > 0 && rng() < 0.5 ? Math.min(wanted, candidates.length) : 0)
          : wanted;
        const picked = shuffled(candidates, rng).slice(0, take).map(card => card.id);
        selected[declaration.id] = picked;
        context.selected[declaration.id] = picked;
      }

      if (
        tryCommit(engine, {
          type: "resolvePendingChoice",
          playerId: pending.playerId,
          choice: { kind: "selectTargets", selected }
        })
      ) {
        return;
      }

      const decline: Record<string, CardInstanceId[]> = {};
      for (const declaration of pending.declarations) decline[declaration.id] = [];
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "selectTargets", selected: decline }
      });
      return;
    }

    case "chooserSelectsTarget": {
      const candidates = engine.queryCards(pending.declaration.selector, pending.context);
      const wanted = engine.evaluateNumber(pending.declaration.count, pending.context);
      const take = pending.declaration.optional
        ? (Math.min(wanted, candidates.length) > 0 && rng() < 0.5 ? Math.min(wanted, candidates.length) : 0)
        : wanted;
      const picked = shuffled(candidates, rng).slice(0, take).map(card => card.id);

      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: picked }
      });
      return;
    }

    case "chooserSelectsOption": {
      const index = Math.floor(rng() * pending.optionCount);
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsOption", index }
      });
      return;
    }

    case "reorderDeck": {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "reorderDeck", order: pending.cardIds }
      });
      return;
    }

    case "deployForFree": {
      for (const cardId of pending.candidates) {
        const definition = engine.getDefinition(cardId);
        const declarations = playTimeDeclarations(definition);
        const selected = buildSelected(engine, pending.playerId, cardId, declarations, {}, rng);
        if (!selected) continue;

        if (
          tryCommit(engine, {
            type: "resolvePendingChoice",
            playerId: pending.playerId,
            choice: { kind: "deployForFree", cardId, selected }
          })
        ) {
          return;
        }
      }

      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "deployForFree" }
      });
      return;
    }

    case "distributeAmong": {
      const shares: Record<CardInstanceId, number> = {};
      if (pending.targets.length > 0) {
        shares[pending.targets[0]] = pending.amount;
      }

      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "distributeAmong", shares }
      });
      return;
    }
  }
}

function handleMain(
  engine: SpoilsEngine,
  playerId: PlayerId,
  opponentId: PlayerId,
  rng: () => number,
  report: AutoplayReport
): void {
  // The develop rule is an optional, once-per-turn action available any
  // time during the turn — take it up front here.
  if (engine.canDevelopNow(playerId)) {
    handleDevelop(engine, playerId, rng, report);
    return;
  }

  for (const cardId of shuffled(handCardCandidates(engine, playerId), rng)) {
    if (tryPlayCard(engine, playerId, cardId, rng)) {
      report.cardsPlayed += 1;
      return;
    }
  }

  for (const { cardId, ability } of shuffled(abilityCandidates(engine, playerId), rng)) {
    if (tryActivateAbility(engine, playerId, cardId, ability, rng)) {
      report.abilitiesActivated += 1;
      return;
    }
  }

  if (tryDeclareAttack(engine, playerId, opponentId, rng, report)) {
    return;
  }

  engine.perform({ type: "endTurn", playerId });
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function playGameToCompletion(engine: SpoilsEngine, options: AutoplayOptions = {}): AutoplayReport {
  const rng = options.botRandom ?? mulberry32(0xc0ffee);
  const maxActions = options.maxActions ?? 50000;

  const report: AutoplayReport = {
    turns: engine.state.turn,
    actions: 0,
    mulligans: 0,
    draws: 0,
    resourcesPlayed: 0,
    cardsPlayed: 0,
    abilitiesActivated: 0,
    attacksDeclared: 0,
    blocksDeclared: 0,
    totalResponses: 0,
    maxResponsesInWindow: 0,
    pendingChoicesResolved: {}
  };

  const responsesByWindow = new Map<string, number>();

  const playerIds = Object.keys(engine.state.players) as PlayerId[];
  if (playerIds.length !== 2) {
    throw new Error("playGameToCompletion expects exactly two players.");
  }
  const [playerA, playerB] = playerIds;
  const opponentOf = (playerId: PlayerId): PlayerId => (playerId === playerA ? playerB : playerA);

  for (let i = 0; i < maxActions; i++) {
    report.actions = i;
    report.turns = engine.state.turn;

    if (engine.state.winner) {
      report.winner = engine.state.winner;
      return report;
    }

    const flow = engine.getFlowView();

    switch (flow.mode) {
      case "gameOver": {
        report.winner = flow.winner;
        return report;
      }

      case "setup": {
        if (flow.setup.phase !== "mulligan") {
          throw new Error("Unexpected setup phase outside mulligan.");
        }
        handleMulligan(engine, flow.setup, rng, report);
        break;
      }

      case "pendingChoice": {
        if (!flow.pendingChoice) throw new Error("pendingChoice mode with no pendingChoice.");
        handlePendingChoice(engine, flow.pendingChoice, rng, report);
        break;
      }

      case "response": {
        if (!flow.responseWindow) throw new Error("response mode with no responseWindow.");
        handleResponse(engine, flow.responseWindow, rng, report, responsesByWindow);
        break;
      }

      case "resolvingResponses": {
        engine.perform({ type: "advanceFlow" });
        break;
      }

      case "battleFinished": {
        engine.perform({ type: "advanceFlow" });
        break;
      }

      case "battleChoice": {
        if (!flow.battle) throw new Error("battleChoice mode with no battle.");
        handleBattleChoice(engine, flow.battle, rng, report);
        break;
      }

      case "main": {
        handleMain(engine, flow.activePlayerId, opponentOf(flow.activePlayerId), rng, report);
        break;
      }
    }
  }

  throw new Error(
    `playGameToCompletion did not reach a winner within ${maxActions} engine actions ` +
      `(stopped at turn ${engine.state.turn}).`
  );
}
