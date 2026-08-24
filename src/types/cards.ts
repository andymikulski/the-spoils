// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

import type { AbilityId, CardDefinitionId, CardType, Keyword, Trade } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { NumberExpression, TargetDeclaration } from "./expressions.js";
import type { Effect, KeywordGrantDefinition, ModifierDefinition, RestrictionGrantDefinition } from "./effects.js";
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
  /** Location damage capacity (RULES.md §3). Locations use this, not `life`. */
  structure?: number;

  subtype: string[];
  text: string;

  /** Present only on faction cards. */
  faction?: FactionDefinition;

  /** Optional structured resource metadata. */
  resource?: ResourceDefinition;

  /**
   * Unique designation (e.g. "eldridge" for "Unique Eldridge"). A player may
   * not control more than one in-play card sharing the same designation.
   */
  unique?: string;

  /**
   * "Attach to X" — this card must be given a legal target of this type when
   * played, and is destroyed if that target ever stops being a legal
   * in-play target of this type.
   */
  attachTo?: CardType;

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
  /**
   * Evaluated once, before `condition`/`targets`/`costs`, and merged into
   * the resolution context's `variables` — for a value that has to be
   * settled before targeting can even be validated, e.g. "flip a coin; X
   * is 1 or 2. Pick X or fewer items" (`{ x: { type: "random", min: 1,
   * max: 2 } } }`). An explicit `variables[id]` on the action itself still
   * takes precedence over the same id here.
   */
  variables?: Record<string, NumberExpression>;
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
  /** Keywords granted to `target` while `condition` holds (e.g. "the attached character gains COVERT"). */
  keywords?: KeywordGrantDefinition[];
  /** Restrictions granted to `target` while `condition` holds (e.g. "the attached character cannot attack or block"). */
  restrictions?: RestrictionGrantDefinition[];
}
