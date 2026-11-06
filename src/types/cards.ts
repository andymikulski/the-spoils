// -----------------------------------------------------------------------------
// Static card data
// -----------------------------------------------------------------------------

import type { AbilityId, CardDefinitionId, CardType, Keyword, Trade, Zone } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
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

  /**
   * The faction's printed MINIMUM DECK SIZE (The Society of Magical Propriety:
   * 300 cards): the least the deck may hold, not counting the faction card.
   * Absent = no minimum rule. Read by `getMinimumDeckSize`.
   */
  minimumDeckSize?: number;

  setup: {
    /**
     * "(Other side starts face-up.)" — a double-sided faction card (see
     * `flipsTo`) whose OTHER side is the one that starts the game face-up:
     * the faction instance is created already flipped, and that side's
     * startingInfluence / setup / rules apply from the start. Counter-Imperial
     * Army starts as Imperial Army.
     */
    startsFlipped?: boolean;
    startingResources: {
      count: number;
      /** Optional exact resource names for factions that require specific cards. */
      names?: string[];
      /** Tournament Faction uses staple resources. */
      stapleOnly?: boolean;
      /**
       * The `count` starting staples must be `count` *different* kinds
       * ("any 2 different staple resources" — Unlikely Heroes). Off by
       * default: the plain Tournament Faction lets you begin with two of the
       * same staple. Enforced by the `chooseStartingResources` action and
       * honoured by the deck-order auto-pick; surfaced to a UI as
       * `StartingResourceChoice.distinct`. Only meaningful with `stapleOnly`.
       */
      distinctStaples?: boolean;
      /**
       * Per-slot starting-resource program (overrides the flat
       * `count`/`names`/`stapleOnly` when set). Each slot puts one card from
       * this player's deck into play at setup: a `"resource"` slot places a
       * face-up resource (optionally `staple`-only or a specific `name`); an
       * `"anyCard"` slot places any card — face-down as a resource if it is
       * not itself a resource ("Any 1 resource, Any 1 card (if it's not a
       * resource, put it into play face-down)" — The Society of Magical
       * Propriety).
       */
      slots?: Array<
        | {
            kind: "resource";
            staple?: boolean;
            name?: string;
            /**
             * "1 face-down Obsession, 1 staple resource" (The Primitive
             * Tribes of Thabbash) — put this slot's resource into play
             * face-down (an anonymous Volition provider) instead of face-up.
             */
            faceDown?: boolean;
          }
        | { kind: "anyCard" }
      >;
      /**
       * "Choose a number for X ... you start with X staple resources" (The
       * Union of Unextraordinary Miners — MONEY FOR NOTHING). X is supplied
       * at game setup (`FactionGameSetupOptions.startingResourceX`), clamped
       * to `[min, max]` (default `min`). `plus` names always-included extra
       * resources ("...and 1 Deception").
       */
      chosenStaples?: { min: number; max: number; plus?: string[] };
      /**
       * After both players' starting resources are placed, top this
       * faction's OPPONENT up with staple resources until both players hold
       * the same number of starting resources ("...enough staple resources
       * so that both players have the same number of starting resources").
       * 2-player only.
       */
      matchOpponentCount?: boolean;
    };

    /**
     * "You may search your deck for [a card matching `selector`] that is
     * not any of your starting resources, reveal it and put it into your
     * hand." (Unlikely Heroes) — resolved automatically once starting
     * resources are placed, before the opening-hand draw: the first card in
     * deck order matching `selector` whose `CardDefinitionId` differs from
     * every starting resource just placed (a no-op if none exists). Always
     * taken — a free, strictly-beneficial card, the same "the choice is
     * never actually declined" treatment the engine gives The Society of
     * Magical Propriety's optional token.
     *
     * `reveal` — the printed text says "reveal it": the found card is shown
     * to everyone (a `cardsRevealed` event) before it goes to hand.
     */
    startingDrawSearch?: {
      selector: CardSelector;
      reveal?: boolean;
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

    /**
     * Effects run automatically at the end of this faction's controller's
     * turn — before scheduled `endOfTurn` effects and the opponent's
     * end-turn response window. `source` is the faction card. Imperial
     * Army / Counter-Imperial Army — INTERNAL CONFLICT / CONSTANT
     * IN-FIGHTING: "flip a coin. If you win, turn this card over."
     * (`flipCoin` wrapping a `flipFactionCard`).
     */
    endOfTurnEffects?: Effect[];
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
   * "Before the game begins, both players create the rules text for an
   * ability. This card has that ability and both players can use it." (The
   * Open R&D Faction -- RESEARCH & DEVELOPMENT.) Marks a faction card that
   * takes one player-made ability at setup. There is no free text: the two
   * players agree on a `CreatedAbilitySpec` built from the closed menu
   * `CREATED_ABILITY_MENU` and the host app passes it as
   * `FactionGameSetupOptions.createdAbility`; the engine validates it, builds
   * the ability and its rules text (`buildCreatedAbility`) and stores both on
   * the faction card instance (`CardInstance.createdAbility`) as an extra
   * activated ability with `usableBy: "anyPlayer"`. Without one the card
   * simply has no third ability.
   */
  playerCreatedAbility?: boolean;

  /**
   * "Turn this card over" — the OTHER side of a double-sided faction card
   * (Imperial Army <-> Counter-Imperial Army). Read by the `flipFactionCard`
   * effect, which reassigns the in-play faction `CardInstance.definitionId`
   * to this id — the same physical card, its other face now active. Both
   * sides' `CardDefinition`s must be registered with the engine (loading the
   * full catalog, as every real consumer does, guarantees this).
   */
  flipsTo?: CardDefinitionId;

  /**
   * OMNIPOTENCE (The Evil Alliance) — the controller automatically meets
   * every threshold, regardless of which resource icons they control.
   */
  meetsAllThresholds?: boolean;

  /**
   * "You must pay N more to deploy tactics using FLIP UP." (The Primitive
   * Tribes of Thabbash) — added to a card's printed FLIP UP cost for every
   * flip-up deploy by this faction's controller, `cardType`-scoped (omit
   * for "every card"). Parallel to `ContinuousAbility.searchTax`, but for
   * flip-up deployment instead of deck searches.
   */
  flipUpTax?: {
    amount: NumberExpression;
    cardType?: CardType;
  };

  /**
   * While this faction card is in play it rewrites specific sub-rules of
   * the OPPONENT's faction (The Knitting Coalition — HIDDEN INFLUENCE:
   * "your opponent ignores their faction's STARTING DRAW rule and uses
   * this card's rule instead"; PULLING STRINGS: "your opponent ignores
   * their faction's DEVELOP RULE"). Resolved before setup (opening hand)
   * and consulted live (`getDevelopChoices`). 2-player only.
   */
  overridesOpponent?: {
    /** Opponent's opening hand uses THIS faction's `setup.openingHand` sizes. */
    startingDraw?: boolean;
    /** Opponent has no Develop Rule (`getDevelopChoices` returns `[]`). */
    suppressDevelop?: boolean;
  };
}

export interface ResourceDefinition {
  /** Explicit icon data overrides staple-name inference. */
  provides?: ResourceIcon[];
  staple?: boolean;
  /**
   * "This resource may only be played from your hand face-down." — the FLIP
   * IT staple-resource cycle (Elitist Upgrade, Obsessive Concentration,
   * Greedy Profiteering, Deceptive Domain, Raging Ferocity). A face-up
   * `playResource` of this card is refused; it enters as an
   * anonymous Volition resource and only shows its printed icon(s) once its
   * FLIP IT ability turns it face-up.
   */
  faceDownOnly?: boolean;
}

export interface CardStats {
  strength?: number;
  life?: number;
  speed?: number;
  influence?: number;
}

/** A printing's art attribution (docs/CARD-DATA.md). */
export interface PrintingArt {
  /** Canonical artist names, in credit order. Empty for a joke credit naming no one. */
  artists: string[];
  /** The credit exactly as printed on this printing, if it prints one. */
  credit?: string;
  /** "printed": credited on this card. "sameArt": copied from another printing of the same artwork. */
  source: "printed" | "sameArt";
  /** sameArt only: the printing whose printed credit this is. */
  fromPrintingId?: CardDefinitionId;
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
  /** Printed rules text, " -- "-separated. Archival: kept verbatim, never regenerated from `markup`. */
  text: string;
  /**
   * `text` as structured markup (keyword lines, named abilities with their
   * COST/EFFECT parts, reminder text, inline keyword references, ...) —
   * parse with `parseCardText` from the "./card-text" export. Absent on
   * cards with no rules text.
   */
  markup?: string;
  /**
   * Token definitions only: the real printing this token depicts (same name
   * and type), chosen when the token is made. Its art is that printing's, and
   * `subtitle` / `flavorText` below are copied from it.
   */
  printingId?: CardDefinitionId;
  /** The descriptive line printed under this printing's name (CR 201.1a). */
  subtitle?: string;
  /**
   * This printing's italic descriptive text (CR 201.5e). Not rules text.
   * Paragraphs and attribution lines are separated by "
".
   */
  flavorText?: string;
  /**
   * Who drew this printing's art. Absent = not known. Per printing, because
   * art (and its credit) can change between sets. Tokens copy it from
   * `printingId` along with `subtitle` / `flavorText`.
   */
  art?: PrintingArt;

  /** Present only on faction cards. */
  faction?: FactionDefinition;

  /**
   * Deck-construction exception printed on the card (CR 103.1): "unlimited" =
   * "You may include as many copies of this card in your deck as you want"
   * (Party Clowns, Crow With Fists). Absent = the normal copy limit. Staple
   * resources are unlimited too, but that is read from the card itself (see
   * `getMaxCopies`), not from this field. Not game behavior: only
   * `getMaxCopies` / `findDeckConstructionIssues` read it.
   */
  deckLimit?: "unlimited";

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
   * "ATTACH TO CHARACTER YOU CONTROL": the host must be controlled by the
   * attaching card's controller (the player deploying it, or gaining
   * control of it as it enters play). Honoured by the reserved `attachTo`
   * extra-cost pick and by the host pick of a card put into play by an
   * effect (CR 507.2b). Extremely Tiny Bonnet of Invisibility, Sharpey.
   */
  attachToController?: "self";

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
   * "FEALTY: While this card is in your hand and <condition>, reduce this
   * card's threshold requirement by any N resource icons." While
   * `condition` holds — evaluated with the card in hand, controller = its
   * holder — `meetsThreshold` for THIS card is satisfied whenever the
   * holder is at most `amount` icons short **summed across all icon
   * types** (CR reads "by any N icons" as a pure total-deficit slack, with
   * no per-icon choice). The "blade of questionable morality" cycle
   * (Abram Ka-darbo Alakazin, Eustace Sensible Glutton, Ignatious Tactician
   * Crafter, Jo Ciendeilio Iron Born, Rudo Mangod Fightful Adonis).
   */
  thresholdSlack?: {
    condition: Condition;
    amount: number;
  };

  /**
   * "While this card is in your hand you may reveal this card as you are
   * playing a resource. If you do, you may deploy this card for <cost>."
   * (Witty Worm). A hand-sourced alternative deploy taken *instead of* the
   * faction Develop Rule's resource play for the turn — offered as a
   * `resourceReveal` prompt when the Develop Rule's resource is played. Threshold and any EXTRA COSTs still apply; only the numeric
   * cost is replaced by `cost`.
   */
  revealFromHand?: {
    cost: number;
    /** Extra icon gate for the reveal deploy (e.g. FINE PRINT: [G][G][G][G]). */
    threshold?: string | number;
    /** Rider effects that resolve alongside the deploy ("your faction loses 2 influence"). Unexpected Codicil — FINE PRINT. */
    effects?: Effect[];
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
      /**
       * Added (usually negative) to the numeric cost actually paid,
       * evaluated in the play context, floored at 0 — "reduce this card's
       * numeric cost by the number of cards removed [as an EXTRA COST]"
       * (Opportunistic Pirate: `{ type: "multiply", values: [{ type:
       * "selectionCount", id: "removed" }, -1] }`). A TACTIC declares the
       * same thing on its play source instead (`ActivatedAbility.costAdjust`
       * / `modes[].costAdjust`).
       */
      costAdjust?: NumberExpression;
    };
    /**
     * "Your opponents cannot respond to this card." — a tactic that opens
     * no response window when it's played; it resolves immediately. Swindle.
     */
    noResponse?: boolean;
    /**
     * "This card does not leave play if the attached card leaves play."
     * (Everlasting Blade of Light). An "Attach to X" card is normally put
     * into its owner's discard pile by the state-based check once it has no
     * valid host (CR §507.2c); with this set it instead stays in play,
     * unattached, and can be re-attached by an EQUIP-style ability.
     */
    keepOnHostLeave?: boolean;
    /**
     * "If you would draw a card as part of your Develop Rule, you may
     * <instead> ..." (Arcane Escrow). While the developing player controls
     * an in-play card carrying this, choosing the `draw` develop option
     * offers them `effects` (gated by the optional `cost`) *instead of*
     * drawing; declining draws as normal. Resolved with this card as
     * `source`.
     */
    developDrawReplacement?: {
      cost?: Cost[];
      /**
       * The replacement is offered only while this selector matches at least
       * one card (evaluated with this card as source): with nothing to put
       * into hand "instead", the Develop Rule just draws.
       */
      available?: CardSelector;
      effects: Effect[];
    };
    /**
     * "Choose one of the following as this card's rules text." — a modal
     * **tactic**: the controller picks a mode index on the `playCard`
     * action (`mode`), and only that mode's `condition` / `costs` /
     * `targets` / `variables` / `variableBounds` / `effects` apply (in place
     * of the first activated ability's). Distinct from a `chooserSelectsOption`
     * effect, which needs shared cost/targets and picks *after* they resolve.
     * Expedition Endeavour, Shriever Breeding Program, Surreptitious Larceny.
     */
    modes?: Array<{
      label?: string;
      condition?: Condition;
      costs?: Cost[];
      /** This mode's own "reduce this card's numeric cost by..." — see `onPlay.costAdjust`. */
      costAdjust?: NumberExpression;
      targets?: TargetDeclaration[];
      variables?: Record<string, NumberExpression>;
      variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
      effects?: Effect[];
    }>;
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
   * Who may activate this ability — `"controller"` (default), `"anyPlayer"`
   * (The Knitting Coalition — "Both players may use this ability"; offered
   * to the opponent too and resolved under whoever activated it), or
   * `"opponent"` (iDumb De-Itemizer — "Only an opponent may use this
   * ability"; hidden from the controller, resolved under the opponent).
   */
  usableBy?: "controller" | "anyPlayer" | "opponent";
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
  /**
   * Only meaningful on a TACTIC's play source (its first activated ability),
   * where it is the tactic's own "EXTRA COST: ... reduce this card's numeric
   * cost by..." — added (usually negative) to the numeric cost paid when the
   * card is deployed, evaluated in the play context so it can read that
   * play's picks (`selectionCount`). Same semantics as
   * `behavior.onPlay.costAdjust` on a non-tactic; ignored when the ability
   * is merely activated. Moment of Annihilation, Haunting Execution.
   */
  costAdjust?: NumberExpression;
  targets?: TargetDeclaration[];
  /**
   * Cards fixed at activation, before the costs are paid, and stored in
   * `selected[id]` for the effects to read ("Pick a Micromajig token ... that
   * this card is attached to. ... Destroy this card. EFFECT: Inflict 7 damage
   * to the picked characters": the host must outlive the cost that destroys
   * the source). No player decision: the ref just resolves then. Pwny Bomb.
   */
  captures?: Array<{ id: string; target: TargetRef }>;
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
  /**
   * The trigger is live wherever its source card is (hand, deck, discard,
   * void, removed, ...), not only in `triggerZone`. For a lasting effect a
   * card creates when it resolves ("for the rest of the game, if your
   * opponent plays a card, you may reveal the removed card ..." — I Drink
   * Your Milkshake!, Seed 2): the effect doesn't care what later happens to
   * the card, so `condition` / the selectors tie it to what the card did
   * (`CardSelector.voidedBySource`).
   */
  triggerFromAnyZone?: boolean;
  /**
   * How the printed trigger actually begins, when that is NOT the plain "When this card enters play" / "When this card
   * leaves play" its event and condition look like. `"entersOrLeavesPlay"`: one printed trigger "When this card enters
   * or leaves play, ..." authored as two abilities (an enters half and a leaves half, same effects). Such a trigger
   * begins with neither quoted phrase, so Unwelcome Hero's `ignoresTriggers` does not ignore either half. Nothing else
   * reads it.
   */
  printedLead?: "entersOrLeavesPlay";
  /**
   * "Once per turn, when ..." — the trigger fires at most this many times
   * each turn (the triggered parallel of `ActivatedAbility.usesPerTurn`).
   * Counted per card and per ability in `GameState.abilityUsesThisTurn`
   * (under a `trigger:` key), spent when the trigger is queued and only if
   * its `event` and `condition` held, so an event that does not satisfy the
   * condition uses nothing. Cleared at the start of every turn, and when the
   * card enters play (a new object). A granted triggered ability counts on
   * the card that has it. Nothing else resets it.
   */
  usesPerTurn?: number;
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
  /**
   * Where the source card must be for this replacement to apply (default
   * `"play"`). `"any"` is every zone but "removed from the game": "If this
   * character would be put into your discard pile from anywhere, ..."
   * (Marauding Madster) works while the card sits in a hand, deck or void.
   */
  activeZone?: Zone | "any";
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
        /**
         * Only a card moving FROM this zone: `"play"` for "from play"
         * (Geiseric, Dethmürderblüdgeon), `"hand"` for "if you would discard"
         * (CR 305.1: a card leaving a HAND, never a destroyed permanent,
         * CR 304.1; Arcane Escrow, Phalludrix). Unset names no zone: it
         * reaches the card from wherever it comes (The Stone of Shame,
         * Resurrection Emporium: "from anywhere").
         */
        from?: Zone;
      }
    | {
        event: "destroy";
        cardType?: CardType;
        controlledBy?: "self" | "opponent" | "any";
        /** Who initiated it — relative to the source controller (default `"any"`). */
        by?: "self" | "opponent" | "any";
        /**
         * Only a destruction by an effect whose source card matches this
         * selector (candidate bound to `{ type: "selected", id:
         * "__candidate" }`) — "This card cannot be destroyed by other "node"
         * cards." (Lugubrious Node). Never matches a destruction with no
         * originating card (battle damage, a bare state-based check).
         */
        bySource?: CardSelector;
      }
    | {
        /**
         * "If <damage> would be inflicted to this card, <effects> instead."
         * Consulted when damage is about to land on the affected card (a
         * `dealDamage` effect, or a battle damage step), after the damage
         * modifiers: if one applies the damage is NOT inflicted and its
         * `effects` run instead, with the affected card bound to
         * `{ type: "selected", id: "__candidate" }` and a synthetic
         * `damageDealt` event so `eventDamageAmount` / `damageSourceIs` /
         * `damageIsBattle` read the replaced instance. Mandatory only (no
         * `optional`). "If battle damage would be inflicted to this card while
         * it's blocking, add that many tokens to it instead" (Expert Debater).
         */
        event: "damage";
        /** Only BATTLE damage is replaced. */
        battleOnly?: boolean;
        cardType?: CardType;
        /** Whose card — relative to the replacement's source controller. */
        controlledBy?: "self" | "opponent" | "any";
      }
    | {
        /**
         * "If you would lose a coin flip, you may <optionalCost> to reflip
         * that coin and use the new result." (Two-Headed Coin). Fires
         * mid-`flipCoin`, before the `coinFlipped` event, only on a losing
         * flip for the source's controller. The replacement `effects` run
         * in place of accepting the loss — re-roll and adopt the new result
         * (`{ type: "flipCoin", ... }` again, plus any rider).
         */
        event: "coinFlip";
        result: "lose";
      };
  condition?: Condition;
  /**
   * When true the replacement is OPTIONAL: a player is asked whether to
   * apply it ("you may ... instead"). If `optionalCost` is set and
   * unaffordable, it counts as declined and the original event happens.
   */
  optional?: boolean;
  optionalCost?: Cost[];
  /**
   * Who makes the optional choice and pays `optionalCost` — a `PlayerRef`
   * resolved relative to the **affected card's controller**. Defaults to
   * the *source's* controller (the historical behaviour). `"controller"`
   * targets the affected card's own controller ("if a character would enter
   * play under an opponent's control, THEY may pay 1" — Phantasmagoric
   * Tollbooth); `"opponent"` targets that controller's opponent ("if this
   * would be destroyed, any opponent may pay 2" — Unloyal Necromorph).
   * Effects then resolve with `controller` = whoever answered.
   */
  chooser?: PlayerRef;
  effects: Effect[];
}

export interface ContinuousAbility extends AbilityBase {
  type: "continuous";
  /**
   * The zone the source must sit in for this ability to be live — defaults
   * to `"play"` (face-up). `"hand"` for "while this card is in your hand,
   * ..." effects (Parkour Hoodlum's TACTICAL-in-hand; Gloamspike-Gosche
   * Bridge's "all characters in your hand gain TACTICAL" aura). Currently
   * honoured for `keywords` grants.
   */
  activeZone?: Zone;
  condition?: Condition;
  /**
   * "This card ignores all rules text on <cardType>s." While the source is
   * in play (and `condition` holds), the source card cannot be *picked* as
   * a target by a card of this type, and a single-target mutating effect
   * or a continuous aura whose origin is a card of this type does not
   * affect it. Aggregate ("all X" / `count`) effects still see it (CR — a
   * "cannot be picked"-style exclusion only blocks choosing, not being
   * swept up). Parkour Hoodlum — "ignores all rules text on locations".
   */
  ignoresRulesTextFrom?: CardType;
  modifiers: ModifierDefinition[];
  /** Keywords granted to `target`/`selector` while `condition` holds (e.g. "the attached character gains COVERT"). */
  keywords?: KeywordGrantDefinition[];
  /** Keywords SUPPRESSED on `target`/`selector` while `condition` holds — `hasKeyword` returns false even for a statically-printed keyword ("it loses COVERT"). Nattering Stoopswaggler. */
  suppressKeywords?: KeywordGrantDefinition[];
  /**
   * While `condition` holds, the `target` (default `"source"`) / `selector`
   * cards lose **every other ability** — activated, triggered, continuous,
   * replacement, and granted — keeping only this suppressing ability itself.
   * "This card loses all other rules text" (Monstrous Lassitude, Rushing
   * Crushing Blockhead — where the same paragraph also grants a -1 speed
   * that survives); "the attached character ... has no rules text" (Mittens
   * of Muffled Thought, `target: "attachedTo"`).
   */
  suppressAllAbilities?: { target?: TargetRef; selector?: CardSelector };
  /**
   * While `condition` holds, all damage that would be dealt to `from`, and
   * any way `from` would leave play, is redirected onto `to` instead —
   * "If the picked character would be dealt damage, deal damage to this
   * card instead. If the picked character would leave play, this character
   * leaves play in that way instead." (6r4wny 60dy9u4rd5 — `from` a
   * `{ remembered }` EXTRA-COST pick, `to: "source"`). Unbounded; distinct
   * from `preventDamage` (bounded/self) and the `redirectDamage` keyword
   * (battle-only).
   */
  redirects?: Array<{ from: TargetRef; to: TargetRef }>;
  /** Restrictions granted to `target`/`selector` while `condition` holds (e.g. "the attached character cannot attack or block"). */
  restrictions?: RestrictionGrantDefinition[];
  /** Deploy-cost adjustments while `condition` holds (e.g. "opponents pay 1 more to deploy a tactic"). */
  costModifiers?: CostModifierDefinition[];
  /**
   * Adjustments to the `payResources` portion of *activated abilities*
   * (not deploys) while the source is in play — "Reduce the numeric cost of
   * your faction's abilities by 1, to a minimum of 1" (First Unified Market
   * of Abstract Secure Theoreticals). `scope`: `"factionAbilities"` (the
   * controller's faction card's abilities), `"self"` (this card's own),
   * `"controlledCharacters"` (abilities on characters the controller
   * controls), `"opponentCharacters"` (abilities on characters the
   * source-controller's *opponent* controls — "Your opponents must pay 2 to
   * use a character's ability", including abilities used while the character
   * is not in play; Department of Rejections).
   */
  abilityCostModifiers?: Array<{
    scope:
      | "factionAbilities"
      | "self"
      | "controlledCharacters"
      | "opponentCharacters";
    delta: NumberExpression;
    minCost?: number;
  }>;
  /** Damage-amount adjustments while `condition` holds (e.g. "reduce battle damage to your characters by 2"). */
  damageModifiers?: DamageModifierDefinition[];
  /**
   * "When an attacking / blocking party is formed including this card, it
   * must have <constraint>." — a legality check on a *forming* party that
   * includes the source (`declareAttack` / `declareBlockers` reject a
   * declaration that violates it). Insect Appreciator (`parity: "even"`),
   * Anxious Oaf (`minMembers: 2`).
   */
  partyRestriction?: {
    role: "any" | "attacking" | "blocking";
    minMembers?: NumberExpression;
    maxMembers?: NumberExpression;
    parity?: "even" | "odd";
    /**
     * `"selfParty"` (default) — bites only a forming party that includes the
     * source (Insect Appreciator, Anxious Oaf). `"allParties"` — bites EVERY
     * forming attacking/blocking party regardless of whether the source is a
     * member: a location that dictates party composition (Arcana Department —
     * even members; Hangdog Alley — `minMembers: 1, maxMembers: 1`).
     * `"attachedParty"` — bites a forming party that includes the card the
     * source is attached to (a gear item constraining its host's party;
     * Spiky Atlasphere — "an attacking party including the attached
     * character must have only 1 member").
     */
    scope?: "selfParty" | "allParties" | "attachedParty";
  };

  /**
   * "You do not lose the game because your faction has 0 influence."
   * (Armored Keep). While the source is in play and `condition` holds, the
   * standard "faction at <= 0 influence loses" state-based check is
   * suppressed for the matching faction.
   */
  preventsDefeat?: { player: "self" | "opponent" | "any" };

  /**
   * "When a player has no cards in their deck, they lose the game." (Trickster's
   * Globe). While the source is in play (and `condition` holds), a state-based
   * check makes every player whose deck is empty lose — the card overrides CR
   * 102.1a. Checked with the 0-influence check, so two losers at once is a draw.
   * `preventsDefeat` does not shield it (that only covers 0 influence).
   */
  emptyDeckLoses?: true;

  /**
   * "If you would inflict damage to an opponent's faction, for each damage you
   * would inflict, you may put up to that many cards from the top of its owner's
   * deck into their discard pile instead." (Trickster's Globe). While the source
   * is in play (and `condition` holds), damage its controller would inflict to an
   * opponent's faction — battle damage, or an effect of a card they control —
   * pauses on a `millInsteadOfDamage` choice once its amount is final (after
   * damage modifiers and other damage replacements). The controller picks how
   * many points (0 up to the amount, and no more than the cards in the faction
   * owner's deck) become cards put from the top of that deck into its owner's
   * discard pile; the rest is inflicted as usual.
   */
  millInsteadOfFactionDamage?: true;

  /**
   * "The top card of your deck is revealed at all times", "each opponent's
   * hand is revealed at all times" — while the source is in play (and
   * `condition` holds), the named zone of the matching player(s) is public.
   * The engine already has perfect information, so this only populates
   * `GameState.revealed` for a renderer / AI to consult; no rule keys off
   * it (cards that buff off "the revealed top card" read `deckPosition`
   * directly). Cheats McGuillicutty, Odious Diva, Bottlebeard Brandyshanks.
   */
  grantsReveal?: {
    zone: "deckTop" | "hand";
    of: "self" | "opponent" | "any";
  };

  /**
   * Changes how many cards a player draws while the source is in play
   * (`condition`, if set, must hold). Consulted in the single `drawCards`
   * choke point. "When you draw any number of cards, increase the amount by
   * 1" (`{ player: "self", delta: 1 }`); "While you have at least 10 cards
   * in your hand, you cannot draw cards" (`{ player: "self", prevent: true }`
   * gated by a hand-size `condition`) — Beatrix Winterbottom.
   */
  drawModifiers?: Array<{
    player: "self" | "opponent" | "any";
    delta?: NumberExpression;
    prevent?: boolean;
  }>;

  /**
   * Tunes the magnitude of influence changes to a faction while the source
   * is in play. `direction` selects which changes ("loss" / "gain" / "any");
   * `delta` is subtracted from the magnitude, floored so a loss can't flip
   * to a gain (or vice versa). "When your faction loses influence, reduce
   * the amount by 1" — Tax Attorney (`{ player: "self", direction: "loss",
   * delta: 1 }`).
   */
  influenceModifiers?: Array<{
    player: "self" | "opponent" | "any";
    direction: "loss" | "gain" | "any";
    delta: NumberExpression;
    minAmount?: number;
  }>;

  /**
   * "Each opponent must pay N to attack." (The Ministry of Other Smaller
   * Ministries). While the source is in play, the matching player pays
   * `amount` resources as part of declaring an attack — an unpayable tax
   * makes the attack illegal. `player: "activePlayer"` charges whoever is
   * declaring the attack regardless of the source's controller (a
   * per-character tax carried by an "Attach to X" item — Auspicious Tax).
   * With `requiresAttackerMatch`, the tax is only levied when the declared
   * attacking party contains a card matching that selector (candidate bound
   * to `{ type: "selected", id: "__candidate" }`).
   */
  attackTax?: {
    player: "opponent" | "any" | "activePlayer";
    amount: NumberExpression;
    requiresAttackerMatch?: CardSelector;
  };

  /**
   * "Your opponents cannot search their deck [without paying N]." — while
   * the source is in play, the matching player pays `amount` resources each
   * time an effect would have them search their own deck; if they can't pay,
   * the search does nothing. `amount: 0` (or omitted) is a hard "cannot
   * search". Department of Rejections (`player: "opponent"`, `amount: 2`).
   */
  searchTax?: {
    player: "self" | "opponent" | "any";
    amount?: NumberExpression;
  };

  /**
   * "Your opponents must pay 1 to pick a character you control." — while the source is in play (and `condition`
   * holds), the matching player pays `amount` more (a "pay N" extra cost, CR 406.3) for EACH card matching
   * `selector` that a card or ability they play or use picks through its declared picks (`targets`); if they
   * cannot pay, they cannot make that pick. `affects` is relative to the source's controller and `selector` is
   * matched against the picked card with "self" = the source's controller. Lucky Charm. (A pick made while an
   * effect resolves is not taxed.)
   */
  pickTax?: Array<{
    affects: PlayerRef;
    amount: NumberExpression;
    selector?: CardSelector;
  }>;

  /**
   * "Your opponents cannot attack your faction." — while the source is in
   * play and `condition` holds, a `declareAttack` whose target is the
   * matching faction is illegal. `player` names whose faction is protected
   * relative to the source's controller. High Court of Demands, Theocratic
   * Senate of Marduun (`player: "self"`).
   */
  preventsAttackOnFaction?: {
    player: "self" | "opponent" | "any";
    /**
     * Only attacking parties whose every member matches this selector are
     * stopped (candidate bound to `{ type: "selected", id: "__candidate" }`).
     * "COVERT parties cannot attack your faction." (Hypnotic Plafond, 1st
     * Edition / Open Beta; a covert party is one whose members all have
     * COVERT, CR 507.3a).
     */
    partyAllMatch?: CardSelector;
  };

  /**
   * "Players can attack only once each turn." — while the source is in play,
   * no player may declare more than `attackLimitPerTurn` separate attacks in
   * a turn (`GameState.attackDeclarationsThisTurn`). Narrow Passage
   * (`{ type: "number", value: 1 }`).
   */
  attackLimitPerTurn?: NumberExpression;

  /**
   * "All battle damage that could be assigned to this card must be assigned
   * to it." — while the source is in play, if a battle party being assigned
   * into contains one or more cards carrying this flag, the only legal
   * battle-damage targets in that party are those cards. Courageous Paladin.
   */
  mustReceiveBattleDamage?: boolean;

  /**
   * "You may use abilities on your opponent's cards" (The Billionaire).
   * While the source is in play, its controller may activate activated
   * abilities on cards the opponent controls. The effect always resolves
   * with the opponent as the ability's controller; the two printings differ
   * on who pays for it:
   * - `true` — "you must pay any numeric cost with your own resources. Any
   *   additional costs must be satisfied as though your opponent is using
   *   the ability" (2nd Edition): the numeric (`payResources`) portion is
   *   charged to the activator, every other cost is the opponent's.
   * - `"asOpponent"` — "as though you were your opponent. (The effect still
   *   happens to your opponent.)" (1st Edition, Open Beta): every cost,
   *   numeric included, is paid by the opponent, out of the opponent's
   *   resources and cards.
   * When several live sources disagree, `true` wins.
   */
  canUseOpponentAbilities?: boolean | "asOpponent";
  /**
   * "Only parties with at least N members / characters with at least N
   * speed can block this card." — enforced in `declareBlockers` against a
   * block on the source (while `condition`, if set, holds). LeoKaiser
   * (`minBlockingPartySize`), Wild Boars (`minBlockerSpeed`). Whole-party
   * "cannot be blocked" stays the `cannotBeBlocked` keyword.
   */
  blockRestriction?: {
    minBlockingPartySize?: NumberExpression;
    minBlockerSpeed?: NumberExpression;
    /**
     * A character matching this selector is not a legal blocker against the
     * source (checked in `declareBlockers` alongside the size / speed
     * gates). "This character cannot be blocked by characters with a [V]
     * icon in its rules text" (Feckless Chronicler —
     * `conditions: [{ type: "textMentionsIcon", icon: "volition" }]`);
     * "Characters with a token on them cannot block this card" (Silencer —
     * `conditions: [{ type: "counterCompare", ... }]`).
     */
    blockerMustNotMatch?: CardSelector;
  };
  /**
   * Grants PROVIDES to every in-play card matching `selector` for as long as the source is in play (and `condition`
   * holds, and the ability is not suppressed): the continuous form of the `grantProvides` effect. "Each resource you
   * control that doesn't have "PROVIDES: [D]", gains "PROVIDES: [D]"." (Black Market Broker:
   * `{ selector: { type: "resource", controller: "self" }, icon: "deception", onlyIfLacking: true }`).
   *
   * Read live by the one place a card's icons are computed (`getResourceIcons`), so thresholds (`getThresholds`,
   * deploy / FLIP UP / ability gates), the `cardProvides` condition and the `resourceIcons` expression all count it.
   * It is re-evaluated on every read, so it reaches a resource that enters later (developed, played face-down,
   * flipped face-down, CR 411.4), stops reaching one that flips face-up (no longer a resource, CR 411.3), follows a
   * change of control (`controller` is relative to the source's controller) and ends when the source leaves play or
   * is flipped face-down. A face-down resource is a resource: it provides [V] (CR 411.1) and lacks anything else.
   *
   * `amount` defaults to 1. `onlyIfLacking`: the card gains the icon only if its icons so far (printed, face-down
   * Volition, a lasting `grantProvides`, and an earlier grant of this kind) do not already include it, so two sources
   * give a resource one [D], not two. Grants are applied in board order.
   */
  providesGrants?: Array<{
    selector: CardSelector;
    icon: ResourceIcon;
    amount?: number;
    onlyIfLacking?: boolean;
  }>;
  /**
   * "While this card is in play, ignore all triggers that begin with "when this card enters play" or "when this card
   * leaves play"." (Unwelcome Hero.) While the source is in play (face-up, ability not suppressed, `condition`
   * holding), the engine does not create the triggers of the listed kinds for ANY card in the game, either player's:
   * - `"thisCardEntersPlay"`: a `cardEnteredPlay` triggered ability whose condition requires `sourceIsEventCard`
   *   ("When this card enters play, ...", including "... as a response" and threshold-gated variants).
   * - `"thisCardLeavesPlay"`: a `cardMoved` triggered ability whose condition requires both `sourceIsEventCard` and
   *   `cardMovedFromZone: play` and names no destination (`cardMovedToZone`): "When this card leaves play, ...".
   *   "When this card is destroyed" and "When this card is put into your discard pile from play" are different
   *   words and are not ignored.
   * Judged when the event happens: a trigger already created is not recalled, and a card that leaves play is judged
   * by the cards in play after it left (the source is not in play for its own departure). Develop / Restore, faction
   * start-of-turn text and every other kind of trigger are untouched.
   */
  ignoresTriggers?: Array<"thisCardEntersPlay" | "thisCardLeavesPlay">;
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

  /**
   * While the source is in play and `condition` holds, the source's
   * controller may deploy cards matching `selector` (typically
   * `{ zone: "void", type: "tactic", owner: "self" }`) as though they were
   * in hand — the continuous / conditional form of the one-shot
   * `grantVoidPlay` effect. "While this card is depleted, you may deploy
   * tactics in the void as though they were in your hand without meeting
   * their threshold" (Voidal Tactician — `condition: { type: "cardDepleted",
   * target: "source" }`, `ignoreThreshold: true`).
   */
  voidPlay?: {
    selector: CardSelector;
    ignoreThreshold?: boolean;
  };

  /**
   * While the source is in play (face-up) and `condition` holds, its controller may look at the face-down cards in
   * the void / removed zone that match `selector`, evaluated with this card as source — so `voidedBySource: true`
   * reads "cards voided by this card". "You may look at cards voided by this card" (Arcane Escrow). Read by
   * `SpoilsEngine.canViewerSeeVoidedCard`; it grants sight only, never play.
   */
  mayLookAtVoided?: {
    selector: CardSelector;
  };

  /**
   * While the source is in play and `condition` holds, a standing "you may
   * not play X" restriction — the continuous form of the `restrictPlay`
   * effect, consulted by `assertCanDeployAtCurrentTiming` / the `flipUp`
   * action. `kind: "flipUp"` blocks the FLIP UP action; `kind: { cardType }`
   * blocks deploying that card type. `timing: "notActivePlayer"` narrows it
   * to "only while `player` is NOT the active player" ("opponents may only
   * play tactics during their own turn"). "Your opponents cannot use FLIP
   * UP" (Lockbox of the Aeons), "Your opponents may only play tactics
   * during their own turn" (Geldale, City-Fortress).
   */
  playRestrictions?: Array<{
    player: "self" | "opponent" | "any";
    /**
     * `{ named }` — no player may deploy a card whose printed name equals
     * the `nameValue` (`valueKind: "cardName"`) stored on the source under
     * this key. "name a non-resource card. The named card cannot be
     * deployed" (Incriminating Photograph).
     */
    kind: "flipUp" | { cardType: CardType } | { named: string };
    timing?: "notActivePlayer";
  }>;

  /**
   * While the source is in play, a card owned by `player` cannot be moved
   * to a hand from any zone in `fromZones` — the `moveCard` / `terminate`
   * `to: "hand"` path checks it and the move simply fails (CR: an
   * impossible move does nothing). "cards cannot be put into your
   * opponents' hands from the void, discard pile or play" (Lockbox of the
   * Aeons — `player: "opponent"`, `fromZones: ["void", "discard", "play"]`).
   */
  restrictReturnToHand?: {
    player: "self" | "opponent" | "any";
    fromZones: Zone[];
  };

  /**
   * While `condition` holds, the source card is destroyed — a state-based
   * check, not an activated ability or a trigger: it happens the moment
   * `condition` becomes true, including when the card enters play with it
   * already true. A threshold paragraph that reads "Destroy this card" (CR
   * §405.4 / §201.5d) is this field gated on that threshold ("[R][R][R]:
   * Destroy this card." — Boorish Boar). Read from the card's own printed
   * abilities only.
   */
  destroysSource?: boolean;

  /**
   * While the source is in play (and `condition` holds), the two players
   * switch seats and each is in control of the other's side: control of every
   * card in play — both factions included — passes to the other player
   * (`GameState.seatSwap`; RULES.md §12 "Seat swap"). Hands, decks, discard
   * piles, voids and the removed-from-game zone stay with their owners, and a
   * faction at 0 influence still costs its *owner* the game (CR §102.1), so
   * "the owner of the winning deck wins". An odd number of live sources leaves
   * the seats swapped; an even number cancels out. Emergency Obfuscation.
   */
  swapsSides?: boolean;
}
