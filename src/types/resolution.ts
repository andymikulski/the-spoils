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
   * The player actually satisfying the costs when that is not `controllerId`: an ability used "as though you were
   * your opponent" pays its costs with only what that player knows (CR 401.2a).
   */
  payerId?: PlayerId;

  /**
   * The opponent this block of rules text is about (MP 2, SD 13–15): every
   * "your opponent" / "opponent" reference in the resolution names this
   * player. Absent while unbound — a reference then means every opponent of
   * `controllerId` (a static reading), and a reference that needs exactly
   * one player resolves only when there is a single candidate.
   */
  opponentId?: PlayerId;

  event?: GameEvent;

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

  /**
   * Set while a replacement's effects resolve (CR §506): the card whose event
   * it replaces and the replacement's key. They happen instead of the event,
   * as one — no state-based check and no trigger processing between them, in
   * nested effect lists too (those run once it has finished) — and, while any
   * of them is still to run (across a pause too), the replacement is not
   * applied to that card again (CR §506.5).
   */
  replacing?: { cardId: CardInstanceId; key: string };
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
  /** Engine bookkeeping: this trigger's own target picks were already announced (`cardPicked`). */
  picksAnnounced?: boolean;
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

  /**
   * Players who may not respond to this item while it is on top of the stack
   * ("your opponent cannot respond to this card", `noResponse: "opponent"`).
   */
  unanswerableBy?: PlayerId[];

  context: ResolutionContext;
}
