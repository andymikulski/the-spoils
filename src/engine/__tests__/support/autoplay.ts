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
// getFlowView() surface: setup, mulligans, the start-of-turn rules, main-turn play,
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
  type GameResult,
  type PendingChoice,
  type PlayerId,
  type ResolutionContext,
  type ResponseWindowState,
  type TargetDeclaration,
  type Threshold,
  DEVELOP_RULE_ABILITY_ID,
  parseThreshold,
  SpoilsEngine
} from "../../../engine.js";
import { mulberry32 } from "./prng.js";
import { isDevelopChoice } from "./develop.js";

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
  /** How the game ended, once it has. */
  result?: GameResult;
  /** `result` flattened for quick assertions: the sole winner's id, the winners joined with "+", or "draw". */
  winner?: PlayerId | "draw";
}

function summarizeResult(result: GameResult): PlayerId | "draw" {
  return result.outcome === "draw" ? "draw" : result.winners.join("+");
}

export interface AutoplayOptions {
  /** Hard cap on engine actions before giving up (a stuck/looping bot is a real bug, not something to silently truncate). */
  maxActions?: number;
  /** RNG driving the bot's own decisions (which card, block or not, decline-or-take an optional target, ...). Independent of the engine's own RNG. */
  botRandom?: () => number;
  /** Resources the bot keeps unspent on its own turn so it can respond on the opponent's (default 2). Set 0 for a faction whose only way to draw/develop is a paid ability the reserve would forbid (The Knitting Coalition). */
  reserve?: number;
}

// ---------------------------------------------------------------------------
// Simulate-then-commit
// ---------------------------------------------------------------------------

function simulateLegal(engine: SpoilsEngine, action: GameAction): boolean {
  const probe = new SpoilsEngine(
    Object.values(engine.definitions),
    // The probe never reads or needs the (informational, ever-growing) game log; dropping it keeps each probe cheap late in a game.
    structuredClone({ ...engine.state, gameLog: [] }),
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

/**
 * `reserve` keeps a cushion of unspent resources on the bot's own turn so it
 * can actually answer its opponent later (CR §607) — the engine no longer
 * lets a player respond to their *own* action, so responses only happen when
 * the non-acting player has resources banked.
 */
function roughlyAffordable(
  engine: SpoilsEngine,
  playerId: PlayerId,
  definition: CardDefinition,
  reserve = 0
): boolean {
  return (definition.cost ?? 0) + reserve <= engine.getAvailableResourceCount(playerId);
}

function meetsThresholdRoughly(engine: SpoilsEngine, playerId: PlayerId, definition: CardDefinition): boolean {
  const required = parseThreshold(definition.threshold);
  const have = engine.getThresholds(playerId);
  return (Object.keys(required) as (keyof Threshold)[]).every(
    icon => (have[icon] ?? 0) >= (required[icon] ?? 0)
  );
}

function abilityRoughlyAffordable(
  engine: SpoilsEngine,
  playerId: PlayerId,
  ability: ActivatedAbility,
  reserve = 0
): boolean {
  const resourceCost = (ability.costs ?? [])
    .filter(cost => cost.type === "payResources")
    .reduce((sum, cost) => sum + (typeof cost.amount === "number" ? cost.amount : 0), 0);
  return resourceCost + reserve <= engine.getAvailableResourceCount(playerId);
}

function isTacticalOrTactic(definition: CardDefinition): boolean {
  return definition.type === "tactic" || !!definition.behavior?.keywords?.includes("tactical");
}

function handCardCandidates(
  engine: SpoilsEngine,
  playerId: PlayerId,
  filter?: (definition: CardDefinition) => boolean,
  reserve = 0
): CardInstanceId[] {
  return engine.state.players[playerId].hand.filter(cardId => {
    const definition = engine.getDefinition(cardId);
    if (definition.type === "resource") return false;
    if (filter && !filter(definition)) return false;
    if (!meetsThresholdRoughly(engine, playerId, definition)) return false;
    if (!roughlyAffordable(engine, playerId, definition, reserve)) return false;
    return true;
  });
}

interface AbilityCandidate {
  cardId: CardInstanceId;
  ability: ActivatedAbility;
}

function abilityCandidates(
  engine: SpoilsEngine,
  playerId: PlayerId,
  reserve = 0
): AbilityCandidate[] {
  const result: AbilityCandidate[] = [];

  // Own cards, then the opponent's faction (some faction abilities are
  // `usableBy: "anyPlayer"` -- The Knitting Coalition's "Both players may use this ability").
  const opponentFactions = Object.values(engine.state.players)
    .filter(p => p.id !== playerId && p.factionId)
    .map(p => p.factionId!);
  const ownCards = engine.state.players[playerId].play.filter(id => engine.state.cards[id].controllerId === playerId);

  for (const cardId of [...ownCards, ...opponentFactions]) {
    const card = engine.state.cards[cardId];
    if (card.faceDown) continue;
    const isOwn = card.controllerId === playerId;

    const definition = engine.getDefinition(cardId);
    // Faction cards keep their abilities in `faction.abilities` (RULES.md §3.6); a faction may repeat one in `behavior.abilities`.
    const seen = new Set<string>();
    for (const ability of [...(definition.behavior?.abilities ?? []), ...(definition.faction?.abilities ?? [])]) {
      if (ability.type !== "activated" || seen.has(ability.id)) continue;
      seen.add(ability.id);
      if (!isOwn && ability.usableBy !== "anyPlayer") continue;
      if (!abilityRoughlyAffordable(engine, playerId, ability, reserve)) continue;
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

/**
 * The Develop Rule's option prompt (a start-of-turn trigger, CR §202.8): play a resource while the bot is short of
 * resources, otherwise draw. The pick of the card (preferring a real resource) and its face are the ordinary
 * `chooserSelectsTarget` / `playResource` prompts that follow.
 */
function handleDevelopOptions(
  engine: SpoilsEngine,
  pending: Extract<PendingChoice, { kind: "chooserSelectsOption" }>,
  report: AutoplayReport
): void {
  const playerId = pending.playerId;
  const labels = pending.options.map(option => option.label ?? "");
  const playIndex = labels.findIndex(label => /^Play /.test(label));
  const drawIndex = labels.findIndex(label => /^Draw /.test(label));

  let index = drawIndex;
  if (playIndex >= 0 && (drawIndex < 0 || engine.getAvailableResourceCount(playerId) < 9)) {
    index = playIndex;
    report.resourcesPlayed += pending.options[playIndex].effects.filter(effect => effect.type === "playResource").length;
  } else if (drawIndex >= 0) {
    report.draws += 1;
  } else {
    throw new Error(`Player '${playerId}' has no usable develop choice.`);
  }

  engine.perform({
    type: "resolvePendingChoice",
    playerId,
    choice: { kind: "chooserSelectsOption", index }
  });
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
      // Start from the prompt's own resolution context when it has one: a trigger's picks can read its `event`.
      const context: ResolutionContext = pending.context
        ? { ...pending.context, selected: { ...pending.context.selected }, variables: { ...pending.context.variables } }
        : {
            sourceId: pending.sourceId,
            controllerId: pending.playerId,
            selected: {},
            variables: {}
          };

      // The engine can refuse a pick the selector lists (an untargetable card, a name already taken), so
      // retry with a fresh random pick a few times before falling back to declining.
      for (let attempt = 0; attempt < 12; attempt++) {
        const selected: Record<string, CardInstanceId[]> = {};
        context.selected = { ...(pending.context?.selected ?? {}) };
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

    case "selectDeployTargets": {
      // Same shape as `selectTargets`, but the count almost always depends
      // on a roll that already happened (Hammer Smash) — `pending.variables`
      // carries it, unlike the trigger-sourced case above.
      const context: ResolutionContext = {
        sourceId: pending.sourceId,
        controllerId: pending.playerId,
        selected: { ...pending.selected },
        variables: { ...pending.variables }
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
          choice: { kind: "selectDeployTargets", selected }
        })
      ) {
        return;
      }

      const decline2: Record<string, CardInstanceId[]> = {};
      for (const declaration of pending.declarations) decline2[declaration.id] = [];
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "selectDeployTargets", selected: decline2 }
      });
      return;
    }

    case "chooserSelectsTarget": {
      const candidates = engine.queryCards(pending.declaration.selector, pending.context);
      const wanted = engine.evaluateNumber(pending.declaration.count, pending.context);
      const take = pending.declaration.optional
        ? (Math.min(wanted, candidates.length) > 0 && rng() < 0.5 ? Math.min(wanted, candidates.length) : 0)
        : wanted;
      // The Develop Rule's resource: prefer a real resource card over a card played face-down as Volition.
      const ordered =
        pending.context.abilityId === DEVELOP_RULE_ABILITY_ID
          ? [...candidates].sort(
              (a, b) =>
                Number(engine.getDefinition(b.id).type === "resource") -
                Number(engine.getDefinition(a.id).type === "resource")
            )
          : shuffled(candidates, rng);
      const picked = ordered.slice(0, take).map(card => card.id);

      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: picked }
      });
      return;
    }

    case "chooserSelectsOption": {
      if (isDevelopChoice(pending)) {
        handleDevelopOptions(engine, pending, report);
        return;
      }
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

    case "playResource": {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "playResource", faceDown: rng() < 0.5 }
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

    // The remaining kinds are rarer, card-specific prompts. The policy is
    // deliberately simple (and, where an answer can be refused, always
    // simulate-first with a guaranteed-legal decline as the fallback) so that
    // real-catalog decks never wedge the driver on a prompt it can't answer.
    case "pileAssignment": {
      const half = Math.ceil(pending.cardIds.length / 2);
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: {
          kind: "pileAssignment",
          pile1: pending.cardIds.slice(0, half),
          pile2: pending.cardIds.slice(half)
        }
      });
      return;
    }

    case "replacementChoice": {
      answerWithFallback(
        engine,
        pending.playerId,
        rng() < 0.5 ? { kind: "replacementChoice", apply: true } : { kind: "replacementChoice", apply: false },
        { kind: "replacementChoice", apply: false }
      );
      return;
    }

    case "chooseReplacement": {
      const index = Math.floor(rng() * pending.options.length);
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "chooseReplacement", index },
        { kind: "chooseReplacement", index: 0 }
      );
      return;
    }

    case "nameValue": {
      const candidates = nameValueCandidates(engine, pending);
      for (const value of shuffled(candidates, rng).slice(0, 40)) {
        if (tryCommit(engine, resolveAction(pending.playerId, { kind: "nameValue", value }))) return;
      }
      // Nothing the engine accepts was found: surface that as a real failure rather than spinning.
      engine.perform(resolveAction(pending.playerId, { kind: "nameValue", value: candidates[0] ?? "" }));
      return;
    }

    case "resourceReveal": {
      engine.perform(resolveAction(pending.playerId, { kind: "resourceReveal" }));
      return;
    }

    case "chooseNumber": {
      const span = Math.max(0, pending.max - pending.min);
      const value = pending.min + Math.floor(rng() * (Math.min(span, 4) + 1));
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "chooseNumber", value },
        { kind: "chooseNumber", value: pending.min }
      );
      return;
    }

    case "mayPay":
    case "alternatingPay":
    case "anyPlayerMayPay": {
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: pending.kind, pay: rng() < 0.7 },
        { kind: pending.kind, pay: false }
      );
      return;
    }

    case "useTargetAbility": {
      const abilityId = pending.abilityIds.length > 0 && rng() < 0.5 ? pending.abilityIds[0] : undefined;
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "useTargetAbility", abilityId },
        { kind: "useTargetAbility" }
      );
      return;
    }

    case "useAnyAbility": {
      const cardId = pending.candidateCardIds.length > 0 && rng() < 0.5 ? pending.candidateCardIds[0] : undefined;
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "useAnyAbility", cardId },
        { kind: "useAnyAbility" }
      );
      return;
    }

    case "partitionCards": {
      const piles: CardInstanceId[][] = Array.from({ length: pending.piles }, () => []);
      pending.cardIds.forEach((id, i) => piles[i % pending.piles].push(id));
      engine.perform(resolveAction(pending.playerId, { kind: "partitionCards", piles }));
      return;
    }

    case "pickPile": {
      engine.perform(
        resolveAction(pending.playerId, { kind: "pickPile", index: Math.floor(rng() * pending.piles.length) })
      );
      return;
    }

    case "takeFromPile": {
      engine.perform(
        resolveAction(pending.playerId, {
          kind: "takeFromPile",
          cardIds: pending.candidates.slice(0, pending.max)
        })
      );
      return;
    }

    case "chooseChosenBlockers": {
      const cardIds = shuffled(pending.candidates, rng).slice(0, Math.floor(rng() * (pending.candidates.length + 1)));
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "chooseChosenBlockers", cardIds },
        { kind: "chooseChosenBlockers", cardIds: [] }
      );
      return;
    }

    case "coinFlipReplace": {
      answerWithFallback(
        engine,
        pending.playerId,
        { kind: "coinFlipReplace", reflip: rng() < 0.5 },
        { kind: "coinFlipReplace", reflip: false }
      );
      return;
    }

    case "millInsteadOfDamage": {
      engine.perform(resolveAction(pending.playerId, { kind: "millInsteadOfDamage", count: 0 }));
      return;
    }

    case "auctionBid": {
      engine.perform(resolveAction(pending.playerId, { kind: "auctionBid", bid: 0 }));
      return;
    }

    case "spendCountersMenu": {
      engine.perform(resolveAction(pending.playerId, { kind: "spendCountersMenu", optionIndex: null }));
      return;
    }

    case "chooseOpponent": {
      engine.perform(resolveAction(pending.playerId, { kind: "chooseOpponent", opponentId: pending.candidates[0] }));
      return;
    }

    default: {
      // A prompt kind this driver doesn't know: fail loudly instead of looping forever on it.
      const unhandled: never = pending;
      throw new Error(`autoplay has no handler for pending choice ${JSON.stringify(unhandled).slice(0, 200)}`);
    }
  }
}

type ResolveChoice = Extract<GameAction, { type: "resolvePendingChoice" }>["choice"];

function resolveAction(playerId: PlayerId, choice: ResolveChoice): GameAction {
  return { type: "resolvePendingChoice", playerId, choice };
}

/** Commits `preferred` when the engine accepts it, else `fallback` (which must always be legal). */
function answerWithFallback(
  engine: SpoilsEngine,
  playerId: PlayerId,
  preferred: ResolveChoice,
  fallback: ResolveChoice
): void {
  if (tryCommit(engine, resolveAction(playerId, preferred))) return;
  engine.perform(resolveAction(playerId, fallback));
}

/** Values a `nameValue` prompt could be answered with: its closed `options`, else subtypes / card names from the loaded definitions (sorted, so the choice is deterministic). */
function nameValueCandidates(
  engine: SpoilsEngine,
  pending: Extract<PendingChoice, { kind: "nameValue" }>
): string[] {
  const exclude = new Set(pending.exclude ?? []);
  if (pending.options) return pending.options.filter(option => !exclude.has(option));

  const values = new Set<string>();
  for (const definition of Object.values(engine.definitions)) {
    if (pending.valueKind === "subtype") {
      for (const subtype of definition.subtype ?? []) values.add(subtype);
    } else if (!pending.nonResource || definition.type !== "resource") {
      values.add(definition.name);
    }
  }
  return [...values].filter(value => !exclude.has(value)).sort();
}

/** Most times the bot activates one card's one ability in a single turn. */
const MAX_USES_PER_ABILITY_PER_TURN = 3;

function handleMain(
  engine: SpoilsEngine,
  playerId: PlayerId,
  opponentId: PlayerId,
  rng: () => number,
  report: AutoplayReport,
  reserve: number,
  abilityUses: Map<string, number>
): void {
  // Keep a small cushion (`reserve`) of unspent resources and hold tactics back, so this
  // player can still answer the opponent's turn (CR §607 — the engine no
  // longer permits responding to your own action, so the reactive game only
  // gets exercised when the non-acting player kept something in reserve).

  for (const cardId of shuffled(
    handCardCandidates(engine, playerId, def => def.type !== "tactic", reserve),
    rng
  )) {
    if (tryPlayCard(engine, playerId, cardId, rng)) {
      report.cardsPlayed += 1;
      return;
    }
  }

  // A free, repeatable ability (e.g. a no-cost "put a counter") would otherwise be spammed for the whole
  // turn; cap each (card, ability) at a few uses per turn so the game always moves on.
  const usesKey = (cardId: CardInstanceId, abilityId: string): string =>
    `${engine.state.turn}:${cardId}:${abilityId}`;
  const usable = abilityCandidates(engine, playerId, reserve).filter(
    ({ cardId, ability }) => (abilityUses.get(usesKey(cardId, ability.id)) ?? 0) < MAX_USES_PER_ABILITY_PER_TURN
  );
  for (const { cardId, ability } of shuffled(usable, rng)) {
    if (tryActivateAbility(engine, playerId, cardId, ability, rng)) {
      const key = usesKey(cardId, ability.id);
      abilityUses.set(key, (abilityUses.get(key) ?? 0) + 1);
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
  const reserve = options.reserve ?? 2;
  const abilityUses = new Map<string, number>();

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

    if (engine.state.result) {
      report.result = engine.state.result;
      report.winner = summarizeResult(engine.state.result);
      return report;
    }

    const flow = engine.getFlowView();

    switch (flow.mode) {
      case "gameOver": {
        report.result = flow.result;
        report.winner = flow.result ? summarizeResult(flow.result) : undefined;
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
        handleMain(engine, flow.activePlayerId, opponentOf(flow.activePlayerId), rng, report, reserve, abilityUses);
        break;
      }
    }
  }

  throw new Error(
    `playGameToCompletion did not reach a winner within ${maxActions} engine actions ` +
      `(stopped at turn ${engine.state.turn}).`
  );
}
