// Test fixtures and small synthetic decks/cards for exercising SpoilsEngine
// through its public API only. Deliberately independent of data/cards.json:
// that dataset has real gaps (see RULES.md), and coupling rules tests to it
// would make tests fail for data reasons instead of engine reasons.

import {
  createCardInstance,
  createGame,
  SpoilsEngine
} from "../../../engine.js";
import type {
  BattleDamageAssignment,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  CardType,
  FactionDefinition,
  GameFormat,
  PlayerId,
  ResponseWindowState,
  Trade,
  Zone
} from "../../../engine.js";

export const P1: PlayerId = "p1";
export const P2: PlayerId = "p2";

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
   * Every seat, in turn order, for a table of any size. Replaces
   * `playerA` / `playerB` when given. Seat i's faction instance is keyed
   * `__faction_<id>` (the first two also answer to `__factionA` / `__factionB`).
   */
  players?: PlayerSetup[];
  /** The table format; defaults from the seat count (see `resolveGameFormat`). */
  format?: GameFormat;
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
  const seats: PlayerSetup[] = options.players ?? [
    { id: P1, name: "Alice", ...options.playerA },
    { id: P2, name: "Bob", ...options.playerB }
  ];
  const factionDefs = seats.map(seat => seat.faction ?? factionCard({ name: `${seat.id}-faction` }));
  const factionKey = (i: number) => (i === 0 ? "__factionA" : i === 1 ? "__factionB" : `__faction_${seats[i].id}`);

  const placements: CardPlacement[] = [
    ...seats.map((seat, i) => ({ key: factionKey(i), def: factionDefs[i], owner: seat.id, zone: "play" as const })),
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
    seats.map((seat, i) => ({
      id: seat.id,
      name: seat.name ?? seat.id,
      influence: seat.influence ?? factionDefs[i].faction?.startingInfluence
    })),
    [...instancesByKey.values()],
    options.format ? { format: options.format } : {}
  );

  seats.forEach((seat, i) => {
    state.players[seat.id].factionId = instancesByKey.get(factionKey(i))!.id;
  });

  state.turn = options.turn ?? 1;
  state.activePlayerId = options.activePlayerId ?? seats[0].id;
  state.priorityPlayerId = options.priorityPlayerId ?? state.activePlayerId;
  state.setup = { phase: "complete" };
  state.started = true;
  state.responseWindow = options.responseWindow;

  const engine = new SpoilsEngine(definitions, state, options.random);

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
