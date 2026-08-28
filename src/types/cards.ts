// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

import type { AbilityId, CardDefinitionId, CardType, Keyword, Trade, Zone } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { CardSelector, NumberExpression, TargetDeclaration } from "./expressions.js";
import type {
  CostModifierDefinition,
  DamageModifierDefinition,
  Effect,
  KeywordGrantDefinition,
  ModifierDefinition,
  RestrictionGrantDefinition
} from "./effects.js";
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

  /**
   * "FLIP UP: <cost>" — this card can be played face-down as a resource and
   * later flipped up (the `flipUp` action) by paying `cost` numeric +
   * meeting `threshold`, optionally resolving `effects` ("...and your
   * faction loses 5 influence"). Flipping up resolves the card as its real
   * type with `ResolutionContext.deployedViaFlipUp` set, which the
   * `deployedViaFlipUp` condition / ability `variables` read
   * ("If you deployed this card using FLIP UP, X is 4, otherwise 2").
   */
  flipUp?: {
    cost: number;
    threshold: string | number;
    effects?: Effect[];
  };

  behavior?: {
    abilities?: AbilityDefinition[];
    keywords?: Keyword[];
    /**
     * "EXTRA COST" / on-enter instructions for a NON-tactic permanent
     * (character/item/location) — the same role a tactic's first activated
     * ability plays. `targets`/`costs`/`condition` apply when the card is
     * played; `effects` resolve as it enters play (an inline ETB that can
     * use those `selected` picks). Tactics keep using their first activated
     * ability; don't set this on a tactic.
     */
    onPlay?: {
      condition?: Condition;
      costs?: Cost[];
      targets?: TargetDeclaration[];
      effects?: Effect[];
    };
  };
}

export type AbilityDefinition =
  | ActivatedAbility
  | TriggeredAbility
  | ContinuousAbility
  | ReplacementAbility;

export interface AbilityBase {
  id: AbilityId;
  name?: string;
}

export interface ActivatedAbility extends AbilityBase {
  type: "activated";
  /**
   * Where the source card must be for this ability to be activatable —
   * defaults to `"play"`. Set `"discard"` (RECUR / RETIRE), `"hand"`, or
   * `"void"` for abilities used from those zones. `condition` is still the
   * place for finer gates ("use this only if ...").
   */
  activationZone?: Zone;
  /**
   * An *icon* requirement to activate this ability, same shorthand as
   * `CardDefinition.threshold` (e.g. `"gg"` = two Greed icons) — a gate,
   * not a cost. Used by the "RECUR: [G][G]" / "EXHUMATION: [O][O]"-style
   * clauses on abilities used from another zone. Checked before
   * `condition` / `targets` / `costs`.
   */
  threshold?: string | number;
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

/**
 * "If <X> would happen, instead <Y>." Consulted *before* a mutation
 * commits (a card moving to a zone, or being destroyed). When it fires, the
 * original mutation is skipped and `effects` run in its place — with the
 * affected card bound to `{ type: "selected", id: "__candidate" }`.
 *
 * Both the mandatory form and the optional gate ("you may pay 1. If you do,
 * ... instead" — `optional` / `optionalCost`) are supported; the optional
 * form pauses the engine on a `replacementChoice` pending choice.
 *
 * `replaces.by` scopes the replacement to *who initiated* the event
 * ("destroyed by an opposing card or effect"): the player currently
 * resolving the effect / dealing the battle damage that would cause it,
 * relative to the replacement's source controller. Orthogonal to
 * `controlledBy`, which is about *whose card* is affected.
 */
export interface ReplacementAbility extends AbilityBase {
  type: "replacement";
  replaces:
    | {
        event: "moveToZone";
        /** The destination that triggers the replacement (e.g. `"hand"`). */
        zone: Zone;
        cardType?: CardType;
        /** Whose card — relative to the replacement's source controller. */
        controlledBy?: "self" | "opponent" | "any";
        /** Who initiated it — relative to the source controller (default `"any"`). */
        by?: "self" | "opponent" | "any";
      }
    | {
        event: "destroy";
        cardType?: CardType;
        controlledBy?: "self" | "opponent" | "any";
        /** Who initiated it — relative to the source controller (default `"any"`). */
        by?: "self" | "opponent" | "any";
      };
  condition?: Condition;
  /**
   * When true the replacement is OPTIONAL: the source's controller is asked
   * whether to apply it ("you may ... instead"). If `optionalCost` is set
   * and unaffordable, it counts as declined and the original event happens.
   */
  optional?: boolean;
  optionalCost?: Cost[];
  effects: Effect[];
}

export interface ContinuousAbility extends AbilityBase {
  type: "continuous";
  condition?: Condition;
  modifiers: ModifierDefinition[];
  /** Keywords granted to `target`/`selector` while `condition` holds (e.g. "the attached character gains COVERT"). */
  keywords?: KeywordGrantDefinition[];
  /** Restrictions granted to `target`/`selector` while `condition` holds (e.g. "the attached character cannot attack or block"). */
  restrictions?: RestrictionGrantDefinition[];
  /** Deploy-cost adjustments while `condition` holds (e.g. "opponents pay 1 more to deploy a tactic"). */
  costModifiers?: CostModifierDefinition[];
  /** Damage-amount adjustments while `condition` holds (e.g. "reduce battle damage to your characters by 2"). */
  damageModifiers?: DamageModifierDefinition[];
  /**
   * Grants a Unique designation to every in-play card matching `selector`
   * while the source is in play — "All non-resource cards gain the rules
   * text Unique X, where X is the card's name" (`designation: "cardName"`),
   * or a fixed string. Consulted by the Unique state-based check and the
   * `hasUnique` condition (`getEffectiveUnique`).
   */
  uniqueGrant?: {
    selector: CardSelector;
    designation: "cardName" | (string & {});
  };
}
