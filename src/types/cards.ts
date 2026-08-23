// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

import type { AbilityId, CardDefinitionId, CardType, Keyword, Trade } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { TargetDeclaration } from "./expressions.js";
import type { Effect, ModifierDefinition } from "./effects.js";
import type { GameEventType } from "./events.js";

export interface Threshold {
  rage?: number;
  greed?: number;
  deception?: number;
  elitism?: number;
  obsession?: number;
  volition?: number;
}

export type ResourceIcon = keyof Threshold;

export type DevelopChoice =
  | { type: "draw"; count: number }
  | { type: "playResource"; count: number };

export interface FactionDefinition {
  startingInfluence: number;

  setup: {
    startingResources: {
      count: number;
      /** Optional exact resource names for factions that require specific cards. */
      names?: string[];
      /** Tournament Faction uses staple resources. */
      stapleOnly?: boolean;
    };

    openingHand: {
      goingFirst: number;
      goingSecond: number;
    };

    mulligan?: {
      count: number;
      mode: "replaceAny";
    };
  };

  turn: {
    restore: {
      clearCharacterDamage: boolean;
      detachResources: boolean;
      restoreNonResources: boolean;
    };

    develop: {
      choices: DevelopChoice[];
    };
  };
}

export interface ResourceDefinition {
  /** Explicit icon data overrides staple-name inference. */
  provides?: ResourceIcon[];
  staple?: boolean;
}

export interface CardStats {
  strength?: number;
  life?: number;
  speed?: number;
  influence?: number;
}

export interface CardDefinition {
  id: CardDefinitionId;
  name: string;
  set: string;
  type: CardType;
  trade: Trade;
  rarity: string;
  cost: number;
  threshold: string | number;

  strength?: number;
  life?: number;
  speed?: number;
  influence?: number;

  subtype: string[];
  text: string;

  /** Present only on faction cards. */
  faction?: FactionDefinition;

  /** Optional structured resource metadata. */
  resource?: ResourceDefinition;

  behavior?: {
    abilities?: AbilityDefinition[];
    keywords?: Keyword[];
  };
}

export type AbilityDefinition =
  | ActivatedAbility
  | TriggeredAbility
  | ContinuousAbility;

export interface AbilityBase {
  id: AbilityId;
  name?: string;
}

export interface ActivatedAbility extends AbilityBase {
  type: "activated";
  condition?: Condition;
  costs?: Cost[];
  targets?: TargetDeclaration[];
  effects: Effect[];
}

export interface TriggeredAbility extends AbilityBase {
  type: "triggered";
  event: GameEventType;
  condition?: Condition;
  targets?: TargetDeclaration[];
  effects: Effect[];
}

export interface ContinuousAbility extends AbilityBase {
  type: "continuous";
  condition?: Condition;
  modifiers: ModifierDefinition[];
}
