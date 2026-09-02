// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

import type { ComparisonOperator } from "../types/ids.js";
import type { CardDefinition, FactionDefinition, Threshold } from "../types/cards.js";

let nextIdCounter = 1;

export function nextId(prefix: string): string {
  return `${prefix}_${nextIdCounter++}`;
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
