// Test fixtures and small synthetic decks/cards for exercising SpoilsEngine
// through its public API only. Deliberately independent of data/cards/:
// that dataset has real gaps (see RULES.md), and coupling rules tests to it
// would make tests fail for data reasons instead of engine reasons.

import {
  createCardInstance,
  createGame,
  SpoilsEngine
} from "../../../engine.js";
import { bystanderIds, bystanderName, EXTRA_SEATS, registerBystanders } from "./bystanders.js";
import type {
  BattleDamageAssignment,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  CardType,
  FactionDefinition,
  PlayerId,
  ResponseWindowState,
  Trade,
  Zone
} from "../../../engine.js";

export const P1: PlayerId = "p1";
export const P2: PlayerId = "p2";
export const P3: PlayerId = "p3";
export const P4: PlayerId = "p4";
export const P5: PlayerId = "p5";
export const P6: PlayerId = "p6";

let defCounter = 0;

function nextDefId(prefix: string): string {
  defCounter += 1;
  return `${prefix}-${defCounter}`;
}

function baseDef(
  type: CardType,
  overrides: Partial<CardDefinition>
): CardDefinition {
  const id = overrides.id ?? nextDefId(type);

  return {
    set: "Test",
    trade: "universal" as Trade,
    rarity: "common",
    cost: 0,
    threshold: 0,
    subtype: [],
    text: "",
    ...overrides,
    id,
    type,
    name: overrides.name ?? id
  };
}

export function character(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("character", {
    strength: 1,
    life: 3,
    speed: 1,
    ...overrides
  });
}

export function item(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("item", overrides);
}

export function location(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("location", {
    structure: 3,
    ...overrides
  });
}

export function tactic(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("tactic", overrides);
}

export function resourceCard(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("resource", {
    resource: { provides: ["rage"], staple: true },
    ...overrides
  });
}

export function defaultFactionDefinition(
  overrides: Partial<FactionDefinition> = {}
): FactionDefinition {
  return {
    startingInfluence: 25,
    setup: {
      startingResources: { count: 0 },
      openingHand: { goingFirst: 0, goingSecond: 0 }
    },
    turn: {
      restore: {
        detachResources: true,
        restoreNonResources: true
      },
      develop: {
        choices: [{ type: "draw", count: 1 }]
      }
    },
    ...overrides
  };
}

export function factionCard(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return baseDef("faction", {
    faction: defaultFactionDefinition(),
    ...overrides
  });
}

/**
 * A faction whose Develop Rule has no choices, so no Develop trigger is queued at its turn start (CR 202.8). For tests
 * about something else, whose hands and decks the Develop Rule's draw (it cannot be skipped) would otherwise change.
 */
export function noDevelopFaction(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return factionCard({
    faction: defaultFactionDefinition({
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [] }
      }
    }),
    ...overrides
  });
}

export interface CardPlacement {
  /** Test-chosen label used to look up the resulting CardInstanceId. Must be unique per game. */
  key: string;
  def: CardDefinition;
  owner: PlayerId;
  zone?: Zone;
  controller?: PlayerId;
  faceDown?: boolean;
  damage?: number;
  depleted?: boolean;
  attachedToKey?: string;
  counters?: Record<string, number>;
  /**
   * Whether this card counts as having started the turn under its
   * controller's control (RULES.md §6). Defaults to true for characters
   * placed directly into play, matching a settled board; set to false to
   * simulate a card that just entered play this turn.
   */
  attackEligible?: boolean;
}

export interface PlayerSetup {
  id: PlayerId;
  name?: string;
  faction?: CardDefinition;
  influence?: number;
}

export interface BuildGameOptions {
  playerA?: Partial<PlayerSetup>;
  playerB?: Partial<PlayerSetup>;
  /**
   * More seats after `playerA` and `playerB`, clockwise. Ids default to P3, P4, ... in order. Omitted: a two-player
   * game, exactly as before.
   */
  extraPlayers?: Partial<PlayerSetup>[];
  cards?: CardPlacement[];
  turn?: number;
  activePlayerId?: PlayerId;
  priorityPlayerId?: PlayerId;
  responseWindow?: ResponseWindowState;
  /** Overrides the engine's RNG (shuffling, coin flips, random targets) for deterministic tests. Defaults to the seeded stream on `GameState.rngState`. */
  random?: () => number;
}

export interface BuiltGame {
  engine: SpoilsEngine;
  /** Resolve a placement's key to the CardInstanceId the engine assigned it. */
  id: (key: string) => CardInstanceId;
}

export function buildGame(options: BuildGameOptions = {}): BuiltGame {
  const playerA: PlayerSetup = { id: P1, name: "Alice", ...options.playerA };
  const playerB: PlayerSetup = { id: P2, name: "Bob", ...options.playerB };

  const extraIds = [P3, P4, P5, P6];
  // SPOILS_TEST_EXTRA_SEATS (support/bystanders.ts): a game that names no extra seats gets inert bystanders.
  const bystanders = options.extraPlayers === undefined ? bystanderIds(EXTRA_SEATS) : [];
  const seated: Partial<PlayerSetup>[] =
    options.extraPlayers ?? bystanders.map(id => ({ id, name: bystanderName(id), faction: noDevelopFaction({ name: `${id}-faction` }) }));
  const extraPlayers: PlayerSetup[] = seated.map((setup, i) => {
    const id = setup.id ?? extraIds[i] ?? `p${i + 3}`;
    return { id, name: id, ...setup };
  });
  const extraFactionDefs = extraPlayers.map(player => player.faction ?? factionCard({ name: `${player.id}-faction` }));

  const factionDefA = playerA.faction ?? factionCard({ name: `${playerA.id}-faction` });
  const factionDefB = playerB.faction ?? factionCard({ name: `${playerB.id}-faction` });

  const placements: CardPlacement[] = [
    { key: "__factionA", def: factionDefA, owner: playerA.id, zone: "play" },
    { key: "__factionB", def: factionDefB, owner: playerB.id, zone: "play" },
    ...extraPlayers.map((player, i): CardPlacement => ({
      key: `__faction_${player.id}`,
      def: extraFactionDefs[i],
      owner: player.id,
      zone: "play"
    })),
    ...(options.cards ?? [])
  ];

  const definitions: CardDefinition[] = [];
  const seenDefIds = new Set<string>();

  for (const placement of placements) {
    if (!seenDefIds.has(placement.def.id)) {
      seenDefIds.add(placement.def.id);
      definitions.push(placement.def);
    }
  }

  const instancesByKey = new Map<string, CardInstance>();

  for (const placement of placements) {
    const instance = createCardInstance(
      placement.def.id,
      placement.owner,
      placement.zone ?? "play"
    );

    instance.controllerId = placement.controller ?? placement.owner;
    instance.faceDown = placement.faceDown ?? false;
    instance.damage = placement.damage ?? 0;
    instance.depleted = placement.depleted ?? false;
    instance.counters = placement.counters ?? {};

    instancesByKey.set(placement.key, instance);
  }

  for (const placement of placements) {
    if (!placement.attachedToKey) continue;

    const target = instancesByKey.get(placement.attachedToKey);
    if (!target) {
      throw new Error(`Unknown attachedToKey '${placement.attachedToKey}' for '${placement.key}'.`);
    }

    instancesByKey.get(placement.key)!.attachedTo = target.id;
  }

  const state = createGame(
    [
      { id: playerA.id, name: playerA.name ?? playerA.id, influence: playerA.influence ?? factionDefA.faction?.startingInfluence },
      { id: playerB.id, name: playerB.name ?? playerB.id, influence: playerB.influence ?? factionDefB.faction?.startingInfluence },
      ...extraPlayers.map((player, i) => ({
        id: player.id,
        name: player.name ?? player.id,
        influence: player.influence ?? extraFactionDefs[i].faction?.startingInfluence
      }))
    ],
    [...instancesByKey.values()]
  );

  state.players[playerA.id].factionId = instancesByKey.get("__factionA")!.id;
  state.players[playerB.id].factionId = instancesByKey.get("__factionB")!.id;
  for (const player of extraPlayers) {
    state.players[player.id].factionId = instancesByKey.get(`__faction_${player.id}`)!.id;
  }

  state.turn = options.turn ?? 1;
  state.activePlayerId = options.activePlayerId ?? playerA.id;
  state.priorityPlayerId = options.priorityPlayerId ?? state.activePlayerId;
  state.setup = { phase: "complete" };
  state.started = true;
  state.responseWindow = options.responseWindow;

  const engine = new SpoilsEngine(definitions, state, options.random);
  if (bystanders.length > 0) registerBystanders(engine, bystanders);

  // createGame forces attackEligibleTurn = 1 for anything already
  // in player A's play zone (see setup.ts) — override that explicitly for
  // every placement rather than conditionally skipping, so `attackEligible`
  // is authoritative regardless of which player owns the card or what
  // `state.turn` was set to above.
  for (const placement of placements) {
    if (placement.zone !== undefined && placement.zone !== "play") continue;
    if (placement.faceDown) continue;

    const instance = instancesByKey.get(placement.key)!;
    const definition = engine.getDefinition(instance.id);

    if (definition.type === "character") {
      instance.attackEligibleTurn =
        placement.attackEligible === false ? undefined : state.turn;
    }
  }

  return {
    engine,
    id: (key: string) => {
      const instance = instancesByKey.get(key);
      if (!instance) {
        throw new Error(`Unknown card placement key '${key}'.`);
      }
      return instance.id;
    }
  };
}

/**
 * Drives passPriority/advanceFlow until any open response window fully
 * resolves and the game returns to normal turn flow. Assumes neither side
 * wants to add further responses — call `engine.perform` directly first for
 * tests that need a response actually played into the window.
 *
 * Stops early (without throwing) if a pendingChoice appears mid-drain — a
 * real decision is needed before the engine can continue. Resolve it with
 * `engine.perform({ type: "resolvePendingChoice", ... })` and call this
 * again to keep draining.
 */
export function resolvePendingResponses(engine: SpoilsEngine): void {
  let guard = 0;

  while (engine.state.responseWindow && !engine.state.pendingChoice) {
    if (++guard > 1000) {
      throw new Error("resolvePendingResponses did not converge — possible infinite loop.");
    }

    const window = engine.state.responseWindow;

    if (window.phase === "acceptingResponses") {
      engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    } else {
      engine.perform({ type: "advanceFlow" });
    }
  }
}

export type DamageSource =
  NonNullable<ReturnType<SpoilsEngine["getBattleView"]>>["damageSources"][number];

/**
 * Drives a declared battle (after declareAttack + declareBlockers) through
 * every response window and speed group to completion, auto-passing all
 * responses and, by default, sending each damage source's full strength to
 * its first legal target. Pass `chooseSplit` to control how a given source
 * divides its damage (e.g. across multiple blockers).
 */
export function autoResolveBattle(
  engine: SpoilsEngine,
  chooseSplit?: (source: DamageSource) => BattleDamageAssignment[]
): void {
  let guard = 0;

  while (engine.state.battle && !engine.state.pendingChoice) {
    if (++guard > 2000) {
      throw new Error("autoResolveBattle did not converge — possible infinite loop.");
    }

    if (engine.state.responseWindow) {
      resolvePendingResponses(engine);
      continue;
    }

    const battle = engine.state.battle;

    if (battle.phase === "attackerDamageAssignment" || battle.phase === "defenderDamageAssignment") {
      const view = engine.getBattleView();
      if (!view || !view.actingPlayerId) {
        throw new Error("autoResolveBattle: expected an acting player during damage assignment.");
      }

      const assignments: BattleDamageAssignment[] = [];

      for (const source of view.damageSources) {
        const split = chooseSplit
          ? chooseSplit(source)
          : source.legalTargets.length > 0 && source.strength > 0
            ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }]
            : [];

        assignments.push(...split);
      }

      engine.perform({
        type: "assignBattleDamage",
        playerId: view.actingPlayerId,
        assignments
      });
      continue;
    }

    if (battle.phase === "finished") {
      engine.perform({ type: "advanceFlow" });
      continue;
    }

    throw new Error(`autoResolveBattle: unexpected battle phase '${battle.phase}'.`);
  }
}
