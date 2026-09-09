// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

import type { ComparisonOperator } from "../types/ids.js";
import type { CardDefinition, FactionDefinition, Threshold } from "../types/cards.js";
import type { GameState } from "../types/state.js";

let nextIdCounter = 1;

/**
 * Mints an id from a process-global counter. Used only to build a game's
 * *initial* `CardInstance`s (`createCardInstance`, faction setup) — before a
 * `GameState`/`SpoilsEngine` exists, ids can't yet draw from
 * `GameState.idSeq`. Once an engine exists, its own ids are minted by
 * `SpoilsEngine.nextId` instead, which persists its counter on `state.idSeq`
 * so it survives save/load across process restarts (this module-global one
 * does not).
 */
export function nextId(prefix: string): string {
  return `${prefix}_${nextIdCounter++}`;
}

/**
 * The highest numeric `_<n>` suffix found anywhere in a serialized
 * `GameState`, or 0 if none. Used to backfill `GameState.idSeq` for a state
 * built (or saved) before that field existed — a fresh `createTwoPlayerGame`
 * state, a hand-built test fixture, or a pre-migration save — so
 * `SpoilsEngine.nextId` starts past every id already in play. Scans the
 * whole serialized state (rather than enumerating each id-bearing
 * collection by hand) so it never goes stale as new collections are added.
 */
export function deriveIdSeq(state: GameState): number {
  let max = 0;
  const pattern = /"[A-Za-z][A-Za-z0-9]*_(\d+)"/g;
  const json = JSON.stringify(state);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(json))) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max;
}

/**
 * The five basic ("staple") resources. Printed staples don't carry any
 * distinguishing field in the card data, so staple-ness is recognised by
 * name as a fallback — see {@link isStapleResourceDefinition}.
 */
export const STAPLE_RESOURCE_NAMES = new Set([
  "obsession",
  "greed",
  "elitism",
  "deception",
  "rage"
]);

/**
 * Whether a card is a staple resource: an explicit `resource.staple` flag,
 * or (for real card data, which doesn't set that flag) one of the five
 * {@link STAPLE_RESOURCE_NAMES}. Used by faction setup ("start with 2
 * staple resources"), the `staple` card selector ("search your deck for a
 * staple resource"), and the `isStaple` condition — they must all agree.
 */
export function isStapleResourceDefinition(definition: CardDefinition): boolean {
  return (
    definition.type === "resource" &&
    (definition.resource?.staple === true ||
      STAPLE_RESOURCE_NAMES.has(definition.name.toLowerCase()))
  );
}

/**
 * Whether a faction's starting-staple rule means "any N *different* staple
 * resources" (Unlikely Heroes — the `distinctStaples` flag). This is a
 * per-card property, NOT the norm: the plain Tournament Faction and the
 * other `stapleOnly` faction cards let a player begin with two of the same
 * staple. Consulted by both the deck-order auto-pick in faction setup and
 * the interactive `chooseStartingResources` action so they agree.
 */
export function startingStaplesMustDiffer(
  rule: FactionDefinition["setup"]["startingResources"]
): boolean {
  return rule.distinctStaples === true && Boolean(rule.stapleOnly);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function compare(
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
      case "v":
        result.volition = (result.volition ?? 0) + 1;
        break;
      default:
        throw new Error(`Unknown threshold icon '${icon}'.`);
    }
  }

  return result;
}

export const TOURNAMENT_FACTION_DEFAULTS: FactionDefinition = {
  startingInfluence: 25,
  setup: {
    startingResources: {
      count: 2,
      stapleOnly: true
    },
    openingHand: {
      goingFirst: 8,
      goingSecond: 9
    },
    mulligan: {
      count: 1,
      mode: "replaceAny"
    }
  },
  turn: {
    restore: {
      detachResources: true,
      restoreNonResources: true
    },
    develop: {
      choices: [
        { type: "draw", count: 1 },
        { type: "playResource", count: 1 }
      ]
    }
  }
};

export const TOURNAMENT_FACTION_BEHAVIOR: NonNullable<CardDefinition["behavior"]> = {
  abilities: [
    {
      id: "tournament-draw",
      name: "Draw",
      type: "activated",
      costs: [
        { type: "payResources", amount: 3 }
      ],
      effects: [
        { type: "draw", player: "controller", amount: 1 }
      ]
    },
    {
      id: "tournament-resource",
      name: "Resource",
      type: "activated",
      costs: [
        { type: "payResources", amount: 4 }
      ],
      targets: [
        {
          id: "resource",
          count: 1,
          selector: {
            controller: "self",
            zone: "hand"
          }
        }
      ],
      effects: [
        {
          type: "playResource",
          target: { type: "selected", id: "resource" },
          faceDown: "auto"
        }
      ]
    }
  ]
};

export function withBuiltInFactionDefaults(definition: CardDefinition): CardDefinition {
  if (
    definition.type !== "faction" ||
    definition.name.toLowerCase() !== "the tournament faction"
  ) {
    return definition;
  }

  return {
    ...definition,
    faction: definition.faction ?? structuredClone(TOURNAMENT_FACTION_DEFAULTS),
    behavior: definition.behavior ?? structuredClone(TOURNAMENT_FACTION_BEHAVIOR)
  };
}
