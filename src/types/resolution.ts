// -----------------------------------------------------------------------------
// Resolution context
// -----------------------------------------------------------------------------

import type { AbilityId, CardInstanceId, PlayerId } from "./ids.js";
import type { GameEvent } from "./events.js";
import type { TriggeredAbility } from "./cards.js";
import type { Effect } from "./effects.js";
import type { Zone } from "./ids.js";

export interface ResolutionContext {
  sourceId: CardInstanceId;
  controllerId: PlayerId;
  abilityId?: AbilityId;

  /**
   * The unit this resolution belongs to for the win condition (CR 102.2): one resolving card or ability, or one
   * triggered ability, with all of its own effects. Set by the engine when the resolution starts and carried by every
   * nested effect list and parked frame, so it survives a pause on a player choice.
   */
  unitId?: string;

  /**
   * The player actually satisfying the costs when that is not `controllerId`: an ability used "as though you were
   * your opponent" pays its costs with only what that player knows (CR 401.2a).
   */
  payerId?: PlayerId;

  event?: GameEvent;

  /**
   * The block's opponent: the one player "your opponent" / "both players" mean in this block of rules text (MP 2,
   * MP 3, MP 4). Set only when the controller had two or more opponents to choose from; with exactly one opponent
   * left it is never stored and every `"opponent"` reads that player. Lasting records a block creates copy it.
   */
  opponentId?: PlayerId;

  /**
   * The acting player of a block written from another player's point of view (`opponentFrom: "acting"`, MPQ-P10):
   * "both players" is this player and `opponentId`.
   */
  actingPlayerId?: PlayerId;

  /** Players named by `playerChoices` / `choosePlayer`, keyed by choice id (`{ type: "chosenPlayer", id }`). */
  chosenPlayers?: Record<string, PlayerId>;

  selected: Record<string, CardInstanceId[]>;

  /** "the picked character" refs (`respondedToPicked`) already resolved by an earlier effect of this resolution, so a later "if you do" still sees a card that has since moved. */
  resolvedPicked?: Record<string, CardInstanceId>;

  /** Zone of every picked card when its stack item began resolving (CR 402.5: a pick a response moved away is ignored). */
  pickZones?: Record<CardInstanceId, Zone>;

  /** Picks (keyed `<declarationId>:<cardId>`) that no longer have the card type their declaration named when the stack item began resolving (CR 208.2: such a card is not affected). */
  pickTypeLost?: Record<string, true>;

  /** Player-chosen numeric variables ("choose a number for X"), keyed by id. Unassigned reads as 0. */
  variables?: Record<string, number>;

  /**
   * Values the payer named while paying `nameValue` COST steps ("Name a card"), keyed by `storeAs`; supplied by the
   * action (`named`) and written onto the source card as the cost is paid.
   */
  named?: Record<string, string>;

  /** True while resolving a card that was deployed via its FLIP UP cost (see the `deployedViaFlipUp` condition). */
  deployedViaFlipUp?: boolean;

  /**
   * The player already said, together with the pick of the card to play, whether an actual resource card goes in face-down
   * (`chooserSelectsTarget` answered with `faceDown`): `playResource` then does not open a `playResource` prompt.
   */
  resourceFaceDown?: boolean;

  /**
   * Resource cards whose "reveal a card as you play a resource" offer (`resourceReveal` prompt) was already made
   * during this resolution, so the interrupted `playResource` does not ask again for the same card.
   */
  resourceRevealOffered?: CardInstanceId[];
}

export interface TriggerResolution {
  sourceId: CardInstanceId;
  ability: TriggeredAbility;
  context: ResolutionContext;
  /**
   * Shared by every trigger found for the same emitted event (RULES.md §7:
   * "triggers occurring at once"). Reassigned to a fresh, unshared value
   * once an orderTriggers pending choice has settled that batch's order, so
   * it isn't re-detected as needing another ordering decision.
   */
  batchId: string;
  /**
   * The player who decides the order of this trigger's batch: the one player all of its triggers came from, or the
   * active player when they came from several players' cards (CR 503.4). Fixed when the batch's first ordering prompt
   * is raised, so the same player keeps deciding the rest of the batch (CR 503.4a).
   */
  orderedBy?: PlayerId;
  /**
   * Engine bookkeeping, only at tables of three or more: the opponents the controller may select for this trigger's
   * "your opponent" when its condition names the opponent through a state test (`opponentFrom: "choose"`): the ones
   * for whom the condition held when the event happened.
   */
  opponentCandidates?: PlayerId[];
  /** Engine bookkeeping: this trigger's own target picks were already announced (`cardPicked`). */
  picksAnnounced?: boolean;
  /**
   * Engine bookkeeping: this trigger was already waiting when an earlier trigger's effects paused on a player choice
   * (two Mau Caravans: the sibling copy's trigger). While that trigger's parked frames are still being resumed it must
   * not start: an event emitted by one of them (a cost paid, a card picked) would otherwise prompt over the paused pick.
   * Cleared from every trigger once the parked frames have all run.
   */
  held?: boolean;
}

export interface StackItem {
  id: string;

  sourceId: CardInstanceId;
  controllerId: PlayerId;

  kind: "card" | "ability";

  abilityId?: AbilityId;
  effects: Effect[];

  /**
   * An ability used by its card's controller: if another player gains control
   * of the card before the ability resolves, the ability's effects are
   * controlled by that player (CR 407.1a).
   */
  followsSourceController?: boolean;

  /**
   * A played card: the numeric cost it was played for, the running total of
   * CR 406.3 (cost number after reductions, plus every `pay N` extra cost).
   * `cardCost` of a card still being played reads it (Muddle's "Pay X, where
   * X is its numeric cost").
   */
  playCost?: number;

  context: ResolutionContext;
}
