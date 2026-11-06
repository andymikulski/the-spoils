// -----------------------------------------------------------------------------
// Pending choices
// -----------------------------------------------------------------------------
//
// Some state-based or reactive moments require a specific player to make a
// real decision before the engine can continue — which duplicate Unique
// card to keep, which candidate satisfies an ambiguous triggered-ability
// target. These pause the engine (see GameState.pendingChoice) exactly the
// way an open response window or battle already does: perform() rejects
// everything except a matching "resolvePendingChoice" action until it's
// answered. This is the hook a future UI drives to render "it's your call"
// moments instead of the engine silently guessing.

import type { AbilityId, CardInstanceId, PlayerId, Zone } from "./ids.js";
import type { CardSelector, TargetDeclaration } from "./expressions.js";
import type { Cost, CostAnswer } from "./costs.js";
import type { Effect, EffectOption } from "./effects.js";
import type { ResolutionContext } from "./resolution.js";
import type { GameAction } from "./actions.js";

export interface PendingUniqueSurvivorChoice {
  kind: "uniqueSurvivor";
  id: string;
  playerId: PlayerId;
  /** The shared Unique designation (CardDefinition.unique) causing the conflict. */
  unique: string;
  /** Every in-play card sharing that designation under this player's control. */
  candidates: CardInstanceId[];
}

export interface PendingTargetChoice {
  kind: "selectTargets";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  abilityId?: AbilityId;
  /** Only the declarations that were actually ambiguous (more candidates than needed). */
  declarations: TargetDeclaration[];
  /**
   * The trigger's resolution context (its `event`, picks already made), read-only for clients: pass it to
   * `getSelectionRequirements({ context })` so an event-reading pick (Totally Random Kid) is judged as the answer is.
   */
  context?: ResolutionContext;
}

/**
 * Deploying a card whose target `count` depends on an unguarded random
 * roll ("flip a coin; X is 1 or 2. Pick X or fewer items." — Hammer
 * Smash): the roll already happened (and is logged) by the time this
 * opens, but the client couldn't have known it in advance to size an
 * atomic selection. `resolvePendingChoice` re-runs `deployCard` with the
 * answer merged in and the same roll reused, never re-rolled. See
 * `findRandomSizedTargetDeclarations` / `openDeployTargetChoice` in
 * `SpoilsEngine.ts`.
 */
export interface PendingDeployTargetChoice {
  kind: "selectDeployTargets";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  /** Only the declarations whose count depends on the roll — anything else on the card already validated normally. */
  declarations: TargetDeclaration[];
  /** Already-resolved selections for any non-deferred declarations on the same card. */
  selected: Record<string, CardInstanceId[]>;
  /** The already-rolled/resolved variables (including the random roll this choice exists for) — reused verbatim on resume. */
  variables: Record<string, number>;
  free: boolean;
  fromZone: boolean;
  costOverride?: number;
  ignoreThreshold: boolean;
  mode?: number;
}

/**
 * A triggered ability whose rules text refers to "your opponent" while its
 * controller has several (three or more players, MP 2): the controller picks
 * which opponent this block of rules text is about before it resolves. Not
 * raised when the triggering event or the trigger's picks already name the
 * opponent (an opponent's action, a pick of an opponent's card).
 */
export interface PendingChooseOpponentChoice {
  kind: "chooseOpponent";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  abilityId?: AbilityId;
  /** The players that may be chosen, in turn order after the chooser. */
  candidates: PlayerId[];
}

/** Identifies one queued trigger: the card it came from and which ability. */
export interface TriggerRef {
  sourceId: CardInstanceId;
  abilityId: AbilityId;
}

export interface PendingTriggerOrderChoice {
  kind: "orderTriggers";
  id: string;
  playerId: PlayerId;
  /**
   * The triggers from one event still waiting to resolve (RULES.md §7).
   * The deciding player picks which one happens *next* (CR §503.4a); after
   * it resolves, if two or more remain this choice is re-raised for the
   * next pick.
   */
  triggers: TriggerRef[];
}

/** "An opponent discards a card" — `chooser` picks a target from `declaration`, then `effects` runs (see the `chooserSelectsTarget` effect). */
export interface PendingChooserTargetChoice {
  kind: "chooserSelectsTarget";
  id: string;
  playerId: PlayerId;
  declaration: TargetDeclaration;
  effects: Effect[];
  context: ResolutionContext;
  /**
   * Set when this pick is part of PAYING for a player action (the mandatory
   * "and play a resource" of a FLIP UP cost, CR 507.4c; "Destroy a token you
   * control" as an ability cost): nothing has been paid or changed yet.
   * Answering re-runs this action with the pick merged into its `selected`
   * under `declaration.id` (so a refused answer changes nothing).
   */
  resumeAction?: GameAction;
  /**
   * Set (with `resumeAction`) when the pick is a cost step ANOTHER player decides (`otherPlayerChooses`): the answer
   * is stored under this key, not merged into the action's `selected`, and the action is re-run.
   */
  costStepKey?: string;
  /** Answers already given for earlier steps of the same paused play (carried across prompts). */
  costAnswers?: Record<string, CostAnswer>;
}

/** "An opponent chooses one of the following effects" — `chooser` picks one of `options` to resolve in full (see the `chooserSelectsOption` effect). Each option's optional `label` is the only game-agnostic hint a UI has for describing it — see `EffectOption`. */
export interface PendingChooserOptionChoice {
  kind: "chooserSelectsOption";
  id: string;
  playerId: PlayerId;
  optionCount: number;
  options: EffectOption[];
  /** Indexes of options whose `condition` fails: they cannot be chosen (grey them out); answering with one is refused. */
  unavailableOptions?: number[];
  /**
   * What kind of question this is, so a UI need not guess from `costStepKey` / `optionCount`:
   * `"yesNo"` (the yes / decline of an `otherPlayerChooses` `may` cost step), `"costBranch"` (the branches of a
   * `oneOf` COST), `"oneOf"` (an authored list of effects, or a pile to take).
   */
  style?: "yesNo" | "oneOf" | "costBranch";

  context: ResolutionContext;
  /**
   * Set when the options are the branches of a `oneOf` COST ("Pay 1 or
   * destroy a token"): nothing has been paid yet. Answering re-runs this
   * action with `variables[resumeVariable] = index`.
   */
  resumeAction?: GameAction;
  resumeVariable?: string;
  /** Set (with `resumeAction`) for the yes / no of an `otherPlayerChooses` `may` step: the answer index is stored under this key. */
  costStepKey?: string;
  costAnswers?: Record<string, CostAnswer>;
}

/** "Look at the top N cards... put them back in any order" (see the `lookAndReorder` effect). */
export interface PendingReorderDeckChoice {
  kind: "reorderDeck";
  id: string;
  playerId: PlayerId;
  /** Whose deck is being reordered — defaults to `playerId` when omitted (the looker is usually the deck's owner). */
  deckOwnerId?: PlayerId;
  /** The cards being looked at, in their current top-to-bottom order. */
  cardIds: CardInstanceId[];
  /**
   * Where the reordered cards go — `"top"` (default) leaves them on top,
   * `"bottom"` relocates them all to the bottom. `"split"` lets the chooser
   * send *any number* to the bottom and keep the rest on top, each pile in a
   * chosen order ("put any number of those cards on the bottom of your deck
   * in any order. Put the remaining cards on the top of your deck in any
   * order." — Ignatius Gloamspike, Confessions of Countless Souls).
   */
  to?: "top" | "bottom" | "split";
  /** "Up to the top N": the answer may cover only the top K of `cardIds` (K from 0 to N), in any order. */
  upTo?: boolean;
  /**
   * With `to: "split"`: exactly this many of the looked-at cards must go on
   * the bottom ("put 1 card on the bottom of that deck and 1 on the top" -
   * Infatuated Armchair). Absent = any number.
   */
  bottomCount?: number;
  /**
   * "You may put one of those cards into your hand. Put the remaining cards
   * on the bottom of your deck in any order": between `min` and `max` of the
   * looked-at cards go into the deck owner's hand (answer field `hand`), all
   * the others to the bottom in the answer's `order`.
   */
  intoHand?: { min: number; max: number };
}

/** "You may deploy a card with cost X or less for free" (see the `deployForFree` effect). */
export interface PendingDeployForFreeChoice {
  kind: "deployForFree";
  id: string;
  playerId: PlayerId;
  /** Legal hand cards (matching maxCost/selector) at the moment this paused. */
  candidates: CardInstanceId[];
  context: ResolutionContext;
  /**
   * Set by the `deployForFree` effect (not `deployFromZone`): the cost cap the engine resolved when it raised this
   * choice, i.e. `maxCost` evaluated (an X, a stat, a count ...), lowered to the remaining `budget` in budget mode.
   * `candidates` are exactly the hand cards whose printed cost is at most this.
   */
  resolvedMaxCost?: number;
  /**
   * Set by the `deployFromZone` effect — the single candidate is being
   * deployed from a zone OTHER than the hand (a face-down permanent/tactic
   * in play, or a card in the discard pile).
   */
  fromZone?: boolean;
  /**
   * Set by `deployFromZone.ignoreThreshold` — waive the printed-threshold
   * gate too ("deploy it for free even if you cannot meet its threshold";
   * I Drink Your Milkshake!).
   */
  ignoreThreshold?: boolean;
  /** Set by `deployFromZone.afterDeploy` — runs only when the card is deployed. */
  afterDeploy?: Effect[];
  /**
   * A claimed Showdown Hero tactic (SD 9): declining removes the card from
   * the game (SD 10) and `afterDeploy` — the rest of the claim — still runs.
   */
  heroClaim?: boolean;
  /**
   * Set by `deployFromZone.free: false` / an unmet `free` condition — the
   * player still pays the card's printed numeric cost ("...otherwise you
   * may deploy it [paying its cost]"). Default (unset) is a free deploy.
   */
  payCost?: boolean;
  /** Set by `deployFromZone.cost` — a flat numeric cost replacing the printed one ("deploy it for 1"). */
  costOverride?: number;
  /**
   * Set by `deployForFree.budget` (Reality Shift) — the remaining total-cost
   * pool. After each free deploy the choice is re-issued with this reduced
   * by the deployed card's printed cost, until it's exhausted, nothing in
   * hand still fits, or the player declines.
   */
  budgetRemaining?: number;
  /** Budget mode only — the per-card cap carried from `deployForFree.maxCost`. */
  perCardCap?: number;
  /** Budget mode only — the `deployForFree.selector`, for re-computing candidates. */
  selector?: CardSelector;
}

/** "Divide N however you want among the selected cards" (see the `distributeAmong` effect). */
export interface PendingDistributeChoice {
  kind: "distributeAmong";
  id: string;
  playerId: PlayerId;
  targets: CardInstanceId[];
  amount: number;
  /** The card says "up to N ... divided": shares may add up to less than `amount`. Otherwise they must total exactly `amount`. */
  upTo?: boolean;
  /** Per-card ceiling on a share (the effect's `maxShare`, evaluated per target). */
  caps?: Record<CardInstanceId, number>;
  effects: Effect[];
  context: ResolutionContext;
  /**
   * Set when the division is a `distribute` COST step: nothing has been paid yet. The shares are stored under
   * `costStepKey` and `resumeAction` re-run (the step's own `effects` run when the cost is paid, not now).
   */
  resumeAction?: GameAction;
  costStepKey?: string;
  costAnswers?: Record<string, CostAnswer>;
}

/** "That player separates those cards into two piles" (see the `separateIntoPiles` effect). */
export interface PendingPileAssignmentChoice {
  kind: "pileAssignment";
  id: string;
  playerId: PlayerId;
  /** The revealed cards to split; the answer must partition exactly these. */
  cardIds: CardInstanceId[];
  pile1Effects: Effect[];
  pile2Effects: Effect[];
  /** Who then chooses which pile gets `pile1Effects` (see `separateIntoPiles.picker`); absent: the first pile does. */
  pickerId?: PlayerId;
  context: ResolutionContext;
}

/** "If this card would be destroyed / bounced, you may ... instead" — an optional replacement. */
export interface PendingReplacementChoice {
  kind: "replacementChoice";
  id: string;
  playerId: PlayerId;
  sourceId: CardInstanceId;
  abilityId: AbilityId;
  /** The card the replacement would affect. */
  affectedCardId: CardInstanceId;
  /** What the original (un-replaced) event would be. */
  original: { event: "destroy" } | { event: "moveToZone"; zone: Zone };
  /** Costs to apply the replacement (may be empty). */
  cost: Cost[];
  label?: string;
}

/** The event a replacement would replace (CR 506.1): the thing that "would happen" to a card. */
export type ReplacementTrigger =
  | { event: "moveToZone"; zone: Zone; from?: Zone; viaDestroy?: boolean }
  | { event: "destroy" }
  | { event: "damage"; amount: number; battle: boolean; sourceId?: CardInstanceId };

/**
 * Several replacements apply to the same event (CR 506.4): `playerId` picks which one applies and the rest are
 * ignored, except a delayed ("the next") replacement, which keeps waiting. `playerId` is the one player controlling
 * every replacement's card, or the active player when they are under different players' control. Answer with
 * `{ kind: "chooseReplacement", index }`.
 */
export interface PendingChooseReplacementChoice {
  kind: "chooseReplacement";
  id: string;
  playerId: PlayerId;
  /** The card the replacements would affect. */
  affectedCardId: CardInstanceId;
  /** What the original (un-replaced) event would be. */
  original: ReplacementTrigger;
  options: Array<{
    sourceId: CardInstanceId;
    abilityId: AbilityId;
    label?: string;
    /** A "the next ..." replacement: not chosen, it stays installed. */
    delayed?: boolean;
  }>;
}

/** "Name a card subtype." / "Name a card." */
export interface PendingNameValueChoice {
  kind: "nameValue";
  id: string;
  playerId: PlayerId;
  valueKind: "subtype" | "cardName" | "resourceIcon" | "trade";
  /** Values that may not be named. */
  exclude?: string[];
  /** `cardName` only: the name must be an existing non-resource card (needs the engine's card catalog). */
  nonResource?: boolean;
  /**
   * The closed list of legal values for `resourceIcon` and `trade` (`exclude` already removed). Absent for `subtype`
   * and `cardName`, whose legal values come from the card catalog: ask `SpoilsEngine.checkNameValue`.
   */
  options?: string[];
  /** The card instance the named value is stored on, keyed by `storeAs`. */
  sourceId: CardInstanceId;
  storeAs: string;
  /**
   * Set when the name is a COST step of a player action ("Name a card." printed in the COST): nothing has been paid
   * yet. Answering re-runs this action with `named[storeAs]` set to the answer (a refused answer leaves the prompt open).
   */
  resumeAction?: GameAction;
}

/** "Any player may pay <cost> to ..." — offered to `playerId`; on decline it advances to `remaining[0]` (see the `anyPlayerMayPay` effect). */
export interface PendingAnyPlayerMayPayChoice {
  kind: "anyPlayerMayPay";
  id: string;
  playerId: PlayerId;
  remaining: PlayerId[];
  cost: Cost[];
  effects: Effect[];
  context: ResolutionContext;
}

/** "That character's controller chooses a number for X." (see the `chooserSelectsNumber` effect). */
export interface PendingChooseNumberChoice {
  kind: "chooseNumber";
  id: string;
  playerId: PlayerId;
  storeAs: string;
  min: number;
  max: number;
  effects: Effect[];
  context: ResolutionContext;
}

/** "You may pay <cost>. If you do, the other player may. Repeat until someone doesn't." (see the `alternatingPayLoop` effect). */
export interface PendingAlternatingPayChoice {
  kind: "alternatingPay";
  id: string;
  /** Whose turn it is to decide right now. */
  playerId: PlayerId;
  /** The two players in order. */
  players: [PlayerId, PlayerId];
  /** Index into `players` of the current decider. */
  turnIndex: 0 | 1;
  cost: Cost[];
  /** Rounds still allowed before the loop force-ends. */
  roundsLeft: number;
  /** Per-player acceptance count so far. */
  tallies: Record<PlayerId, number>;
  onEnd: Effect[];
  context: ResolutionContext;
  /**
   * Set when the loop is an `alternatingPay` COST step (Negotiation Ceremonies): each payment is spent at once, and
   * when the loop ends the tallies are stored under `costStepKey` and `resumeAction` (the paused play) is re-run.
   */
  resumeAction?: GameAction;
  costStepKey?: string;
  costAnswers?: Record<string, CostAnswer>;
  /** Resources each player must keep back for the rest of the play's cost (the card's own numeric cost). */
  reserve?: Record<PlayerId, number>;
}

/** "You may pay <cost>. If you do, ..." */
export interface PendingMayPayChoice {
  kind: "mayPay";
  id: string;
  playerId: PlayerId;
  cost: Cost[];
  label?: string;
  effects: Effect[];
  elseEffects: Effect[];
  /** The `mayPay` effect's `payAndPick`. */
  payAndPick?: boolean;
  /** `anyOf: "opponents"`: the opponents still to be offered it if this one declines, in turn order. */
  remainingPayers?: PlayerId[];
  context: ResolutionContext;
}

/** "You may use one of the card's abilities." */
export interface PendingUseTargetAbilityChoice {
  kind: "useTargetAbility";
  id: string;
  playerId: PlayerId;
  /** The card whose abilities may be used. */
  targetCardId: CardInstanceId;
  /** The ids of that card's activated abilities. */
  abilityIds: AbilityId[];
  /** How many times the chosen ability's effects resolve. */
  times: number;
}

/**
 * "You may use an ability" (of any card you control) — The Poshernacle.
 * Answering with a `cardId` narrows to a follow-up `useTargetAbility`
 * choice for that card's abilities; omitting it declines.
 */
export interface PendingUseAnyAbilityChoice {
  kind: "useAnyAbility";
  id: string;
  playerId: PlayerId;
  /** In-play cards `playerId` controls that have at least one activated ability. */
  candidateCardIds: CardInstanceId[];
  context: ResolutionContext;
}

/** MUSTACHE SHOWDOWN, step 1 — `playerId` splits `cardIds` into `piles` non-empty face-down piles (see the `partitionAndPick` effect). */
export interface PendingPartitionCardsChoice {
  kind: "partitionCards";
  id: string;
  playerId: PlayerId;
  cardIds: CardInstanceId[];
  piles: number;
}

/** MUSTACHE SHOWDOWN, step 2 — `playerId` picks one of their opponent's face-down `piles` by index. */
export interface PendingPickPileChoice {
  kind: "pickPile";
  id: string;
  playerId: PlayerId;
  piles: CardInstanceId[][];
}

/** MUSTACHE SHOWDOWN, step 3 — the higher-total-cost pile's owner may move up to `max` of its `candidates` to hand. */
export interface PendingTakeFromPileChoice {
  kind: "takeFromPile";
  id: string;
  playerId: PlayerId;
  candidates: CardInstanceId[];
  max: number;
}

/**
 * Wyrmfang Deathskull — `playerId` (the defender) picks any subset of
 * `candidates` (characters they control); for the rest of this battle only
 * those may block, and each that can legally block must. Answered with
 * `{ kind: "chooseChosenBlockers", cardIds }`.
 */
export interface PendingChooseChosenBlockersChoice {
  kind: "chooseChosenBlockers";
  id: string;
  playerId: PlayerId;
  candidates: CardInstanceId[];
  /** The card whose effect is asking (Wyrmfang Deathskull); always set by the engine. */
  sourceId?: CardInstanceId;
}

/**
 * Two-Headed Coin — `playerId` lost a coin flip and may pay `cost` to
 * reflip and adopt the new result. Answered with
 * `{ kind: "coinFlipReplace", reflip: boolean }`.
 */
export interface PendingCoinFlipReplaceChoice {
  kind: "coinFlipReplace";
  id: string;
  playerId: PlayerId;
  cost: Cost[];
  /** The card offering the reflip (Two-Headed Coin); always set by the engine. */
  sourceId?: CardInstanceId;
  /** The card whose effect flipped the coin, when it has one. */
  flipSourceId?: CardInstanceId;
  /** The flip result: always `false` here, since the reflip is only offered for a LOST flip. */
  won?: false;
}

/**
 * Trickster's Globe (`ContinuousAbility.millInsteadOfFactionDamage`) — `playerId`
 * is about to inflict `amount` damage to `factionPlayerId`'s faction and may turn
 * up to `max` of it (the amount, capped at the cards in `deckOwnerId`'s deck) into
 * cards put from the top of `deckOwnerId`'s deck into their discard pile, one card
 * per point; the rest is inflicted. Answered with
 * `{ kind: "millInsteadOfDamage", count }`, `count` in [0, `max`].
 */
export interface PendingMillInsteadOfDamageChoice {
  kind: "millInsteadOfDamage";
  id: string;
  playerId: PlayerId;
  /** The card whose ability offers the swap. */
  sourceId: CardInstanceId;
  /** The card inflicting the damage (absent for several battle dealers at once). */
  damageSourceId?: CardInstanceId;
  /** The player holding the faction that would take the damage. */
  factionPlayerId: PlayerId;
  /** The faction's owner, whose deck is milled. */
  deckOwnerId: PlayerId;
  amount: number;
  max: number;
  battle: boolean;
  /** Effect damage only: what the damage resumes with once answered. */
  resume?: { targetId: CardInstanceId; context: ResolutionContext };
}

/**
 * Auction House — `playerId` names a bid for `characterId`. The bid must be
 * `0` (pass) or an integer strictly greater than `highBid` and no more than
 * `maxBid` (their detached-resource count). Answered with
 * `{ kind: "auctionBid", bid: number }`.
 */
export interface PendingAuctionBidChoice {
  kind: "auctionBid";
  id: string;
  playerId: PlayerId;
  characterId: CardInstanceId;
  highBid: number;
  maxBid: number;
}

/**
 * "Remove any number of tokens from cards you control. Use the tokens to
 * generate the following effects any number of times." (Voidal Poisoning —
 * the `spendCountersMenu` effect). Each answer either picks an
 * `optionIndex` to fire (with `sources` naming which pool cards to pull the
 * option's `cost` markers from — one id per marker), or `optionIndex: null`
 * to stop. Repeats until stopped or no option is affordable.
 */
export interface PendingSpendCountersMenuChoice {
  kind: "spendCountersMenu";
  id: string;
  playerId: PlayerId;
  pool: CardSelector;
  counter: string;
  options: Array<{ cost: number; label?: string; effects: Effect[] }>;
  /** Current marker count available on each pool card. */
  available: Record<CardInstanceId, number>;
  context: ResolutionContext;
}

/**
 * "Play a resource" with an actual resource card (CR 203.2, SYS-7): any card
 * may be played face-down as Volition, so the player who plays it says which
 * way. Answered with `{ kind: "playResource", faceDown: boolean }`.
 */
export interface PendingResourceFaceChoice {
  kind: "playResource";
  id: string;
  playerId: PlayerId;
  cardId: CardInstanceId;
  /** Whether the card may be played face-up (a resource card that is not `faceDownOnly`). Face-down is always allowed (CR 203.2). */
  canFaceUp?: boolean;
  /** False for "put a resource into play" (no `resourcePlayed` event). */
  emitPlayed: boolean;
  /** The resource enters already attached to its player's faction (spent). */
  attachedToFaction?: boolean;
  /**
   * Set when the resource is played as part of a FLIP UP line's COST ("and play a resource"): nothing has been
   * paid yet. Answering re-runs this action with the answer merged in (a refused answer leaves the question open).
   */
  resumeAction?: GameAction;
}

/**
 * "While this card is in your hand you may reveal this card as you are
 * playing a resource" (Witty Worm; CR 605.1c). Opened by a `playResource`
 * effect after the card to play has been chosen and before it enters play,
 * when the player holds hand cards carrying `CardDefinition.revealFromHand`
 * they could pay for. Answered with `{ kind: "resourceReveal", cardId?,
 * selected?, variables? }`: a `cardId` from `candidates` reveals that card
 * and deploys it for its `revealFromHand.cost` (the opponent does not get a
 * response window, like any effect-made deploy), after which the resource
 * play carries on (and the choice is offered again for the other
 * candidates); omit `cardId` to decline and just play the resource.
 */
export interface PendingResourceRevealChoice {
  kind: "resourceReveal";
  id: string;
  playerId: PlayerId;
  /** The hand card being played as a resource (still in hand). */
  resourceCardId: CardInstanceId;
  /** Hand cards with `revealFromHand` whose reveal-deploy looks affordable right now. */
  candidates: CardInstanceId[];
  /** The interrupted `playResource` effect, carried on after the choice. */
  effect: Effect;
  context: ResolutionContext;
}

export type PendingChoice =
  | PendingResourceFaceChoice
  | PendingResourceRevealChoice
  | PendingUniqueSurvivorChoice
  | PendingTargetChoice
  | PendingChooseOpponentChoice
  | PendingDeployTargetChoice
  | PendingTriggerOrderChoice
  | PendingChooserTargetChoice
  | PendingChooserOptionChoice
  | PendingReorderDeckChoice
  | PendingDeployForFreeChoice
  | PendingDistributeChoice
  | PendingPileAssignmentChoice
  | PendingReplacementChoice
  | PendingChooseReplacementChoice
  | PendingNameValueChoice
  | PendingChooseNumberChoice
  | PendingAlternatingPayChoice
  | PendingAnyPlayerMayPayChoice
  | PendingMayPayChoice
  | PendingUseTargetAbilityChoice
  | PendingUseAnyAbilityChoice
  | PendingPartitionCardsChoice
  | PendingPickPileChoice
  | PendingTakeFromPileChoice
  | PendingChooseChosenBlockersChoice
  | PendingCoinFlipReplaceChoice
  | PendingAuctionBidChoice
  | PendingMillInsteadOfDamageChoice
  | PendingSpendCountersMenuChoice;
