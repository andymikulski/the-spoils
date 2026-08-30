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
    /**
     * The faction's Restore Rule (CR §202.7) — what it replenishes at the
     * start of its controller's turn. (Clearing character damage is a core
     * start-of-turn rule, CR §602.1a, not part of this.)
     */
    restore: {
      detachResources: boolean;
      restoreNonResources: boolean;
    };

    develop: {
      choices: DevelopChoice[];
      /**
       * How many times per turn the Develop Rule may be used — default 1.
       * The Union of Unextraordinary Miners' "OVERTIME" clause gives a
       * second develop, so `usesPerTurn: 2`.
       */
      usesPerTurn?: number;
    };

    /**
     * Effects run automatically at the start of this faction's
     * controller's turn — after the core start-of-turn rules (CR §602.1)
     * and this faction's Restore Rule, before "at the start of your turn"
     * triggers. `source` is the faction card. Imperial Army — "reduce the
     * numeric cost of the next character you play this turn by 2"
     * (`reduceNextCost` with `cardType: "character"`); The Society of
     * Magical Propriety — accrue a token.
     */
    startOfTurnEffects?: Effect[];
  };

  /**
   * Activated abilities printed on the faction card, usable any time its
   * controller could use an ability (RULES.md §3.6 / FAQ). E.g. The Open
   * R&D Faction's "DRAW — COST: Pay 3. EFFECT: Draw a card." Merged with
   * any `CardDefinition.behavior.abilities` for ability lookup. An ability
   * with `usableBy: "anyPlayer"` is offered to the opponent too (The
   * Knitting Coalition's "Both players may use this ability").
   */
  abilities?: ActivatedAbility[];

  /**
   * OMNIPOTENCE (The Evil Alliance) — the controller automatically meets
   * every threshold, regardless of which resource icons they control.
   */
  meetsAllThresholds?: boolean;
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

  /**
   * "While this card is in your hand you may reveal this card as you are
   * playing a resource. If you do, you may deploy this card for <cost>."
   * (Witty Worm). A hand-sourced alternative deploy taken *instead of* the
   * faction Develop Rule's resource play for the turn — the `chooseDevelop`
   * action's `playResource` choice carries a `revealFromHand` payload that
   * routes here. Threshold and any EXTRA COSTs still apply; only the numeric
   * cost is replaced by `cost`.
   */
  revealFromHand?: {
    cost: number;
  };

  /**
   * Where a resolving TACTIC goes AFTER its effects instead of the discard
   * pile — "Put this card into play under its owner's control as a
   * face-down resource instead of into their discard pile"
   * (`to: "faceDownResource"`), or "...into its owner's hand instead..."
   * (`to: "hand"`, Clam Hash). `condition`, when set, is evaluated in the
   * tactic's own resolution context (so it can read `deployedViaFlipUp`);
   * if it fails, the tactic goes to the discard pile as normal.
   */
  selfDisposition?: {
    to: "faceDownResource" | "hand";
    condition?: Condition;
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
   * Who may activate this ability — `"controller"` (default) or
   * `"anyPlayer"`. An `"anyPlayer"` faction ability (The Knitting
   * Coalition — "Both players may use this ability") is offered to the
   * opponent too and resolves under whoever activated it.
   */
  usableBy?: "controller" | "anyPlayer";
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
  /**
   * Bounds on a player-chosen `variable` beyond plain affordability — the
   * action's `variables[id]` must satisfy `min <= v <= max` (each an
   * optional `NumberExpression`). "Pick a number for X, where X is less
   * than or equal to the number of [O] you control." (Desolate).
   */
  variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
  /**
   * "Use this only N times each turn." — a per-turn cap on activations of
   * this ability (tracked in `GameState.abilityUsesThisTurn`). Vast
   * Mastabatorium.
   */
  usesPerTurn?: number;
  /**
   * Allow this ability to be activated while its source is a face-down
   * resource in play (bypasses the "a face-down card's abilities cannot be
   * activated" rule for this ability only). Pair with a `sourceIsFaceDown`
   * condition. "Use this only while this card is a face-down resource"
   * (Fired Hand PETTY VENGEANCE, Vorpal Sword SNICKER SNACK). The card
   * stays face-down unless an effect flips it.
   */
  fromFaceDown?: boolean;
}

export interface TriggeredAbility extends AbilityBase {
  type: "triggered";
  event: GameEventType;
  /**
   * Where the source card must be for this trigger to be live — defaults to
   * `"play"`. Set another zone for "while this card is in your <zone>, when
   * <event> ..." abilities: `"discard"` (Manifest, Hidden Ruins),
   * `"void"` (I Drink Your Milkshake!), `"deck"` (Community Chest's
   * mulligan-draw clause). The triggered-ability parallel of
   * `ActivatedAbility.activationZone`. `condition` still carries any finer
   * gate ("... under your control", "... if you bottomed it in your
   * mulligan").
   */
  triggerZone?: Zone;
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
  /** Keywords SUPPRESSED on `target`/`selector` while `condition` holds — `hasKeyword` returns false even for a statically-printed keyword ("it loses COVERT"). Nattering Stoopswaggler. */
  suppressKeywords?: KeywordGrantDefinition[];
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
  /**
   * Grants whole ability bodies to every in-play card matching `selector`
   * while the source is in play — "All characters gain the rules text «At
   * the start of your turn, you may pay 1. If you don't, destroy this
   * card.»" (Lodge Dock Florist). Granted **triggered** abilities fire for
   * the recipient card (its own `source`); granted **activated** abilities
   * are not yet usable via `activateAbility` (flag if a card needs it).
   */
  grantedAbilities?: Array<{
    selector: CardSelector;
    abilities: AbilityDefinition[];
  }>;
  /**
   * Grants a FLIP UP path to every in-play face-down card matching
   * `selector` that lacks its own — the granted cost/threshold are the
   * card's printed `cost`/`threshold`. "All your face-down tactics gain
   * FLIP UP with numeric cost and threshold equal to their regular numeric
   * cost and threshold." (Woadenworm Gloamspike).
   */
  grantFlipUp?: {
    selector: CardSelector;
  };
}
