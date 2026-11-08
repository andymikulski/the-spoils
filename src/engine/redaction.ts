// -----------------------------------------------------------------------------
// Redaction — per-viewer hidden-information filtering for networked play
// -----------------------------------------------------------------------------
//
// Nothing in `GameState`/`GameFlowView`/`GameLogEntry` is hidden today — the
// engine has "no per-seat hidden zones" by design (RULES.md, "Fidelity pass"),
// which is exactly right for a single trusted local client. The moment a
// server broadcasts state to two separate network clients, that perfect
// information becomes a leak: an opponent's hand, deck order, and face-down
// resources must never cross the wire in the clear. These three functions are
// the outbound boundary that enforces that — called after a commit succeeds,
// never consulted for legality
// (validation always runs against the true, unredacted state).
//
// Fail-closed by design: anything this module doesn't explicitly know how to
// classify gets omitted or genericized, never passed through unexamined.

import type {
  CardInstance,
  GameState,
  GameFlowView,
  BattleView
} from "../types/state.js";
import { logMessageFor, type GameLogEntry } from "../types/log.js";
import type { PendingChoice } from "../types/choices.js";
import type { CardDefinitionId, CardInstanceId, PlayerId } from "../types/ids.js";
import { emptyEngineMemory } from "./engineMemory.js";

/** A seated player, or a neutral onlooker with no hidden information of their own. */
export type Viewer = PlayerId | "spectator";

/** Stands in for a redacted card's real `definitionId`. Never a real catalog id. */
export const HIDDEN_DEFINITION_ID = "__hidden__" as CardDefinitionId;

type Revealed = GameFlowView["revealed"];

const NOTHING_REVEALED: Revealed = { deckTop: [], hands: [] };

function isHiddenFrom(card: CardInstance, viewer: Viewer, revealed: Revealed, options: RedactStateOptions): boolean {
  // The player whose hand/deck array holds the card: its owner, unless a "put it into YOUR hand" effect moved it (`heldBy`).
  const holder: PlayerId = card.heldBy ?? card.ownerId;

  if (card.zone === "hand") {
    return holder !== viewer && !revealed.hands.includes(holder);
  }

  if (card.zone === "deck") {
    if (revealed.deckTop.some(entry => entry.playerId === holder && entry.cardId === card.id)) return false;
    if (options.visibleCardIds?.has(card.id)) return false;
    // Nobody knows their own library's order or contents unless it has been shown to them.
    return !(options.ownDeckVisible && holder === viewer);
  }

  if (card.faceDown) {
    // Face-down in the void / removed zone: seen by whoever put it there (CardInstance.faceDownBy) and the few
    // card-granted lookers `SpoilsEngine.canViewerSeeVoidedCard` knows about — pass it as `canSeeVoided`.
    if (card.zone === "void" || card.zone === "removed") {
      if (viewer === "spectator") return true;
      return options.canSeeVoided ? !options.canSeeVoided(card.id) : card.faceDownBy !== viewer;
    }
    // A face-down card (RULES.md §4 / CR §411.1) is an anonymous resource with
    // no printed characteristics to anyone but the player who controls it.
    return card.controllerId !== viewer;
  }

  return false;
}

/**
 * A hidden card keeps its real `id` (stable across redactions and safe on
 * its own — ids are opaque sequence numbers, never name-bearing — so the
 * client's existing per-card React keys/animations don't break) but loses
 * everything that would identify it: `definitionId` (the actual lookup key
 * into the public card catalog every client already has), plus any
 * player-authored values that could narrow it down (`namedValues`,
 * `linkedTargets`).
 */
function maskCard(card: CardInstance): CardInstance {
  const masked: CardInstance = { ...card, definitionId: HIDDEN_DEFINITION_ID };
  delete masked.namedValues;
  delete masked.linkedTargets;
  delete masked.createdAbility;
  return masked;
}

function redactCards(
  cards: Record<CardInstanceId, CardInstance>,
  viewer: Viewer,
  revealed: Revealed,
  options: RedactStateOptions
): Record<CardInstanceId, CardInstance> {
  const result: Record<CardInstanceId, CardInstance> = {};
  for (const [id, card] of Object.entries(cards)) {
    result[id] = isHiddenFrom(card, viewer, revealed, options) ? maskCard(card) : card;
  }
  return result;
}

/**
 * Whether `card` is hidden from `viewer` in an unredacted state — for a caller that wants to know which cards a
 * redacted copy will mask (to skip annotating them, say) without building the copy.
 */
export function isCardHiddenFrom(card: CardInstance, viewer: Viewer, options: RedactStateOptions = {}): boolean {
  return isHiddenFrom(card, viewer, options.revealed ?? NOTHING_REVEALED, options);
}

/**
 * Only the deciding player (`pendingChoice.playerId`) gets the full choice —
 * candidate lists, declarations, and the like can themselves carry hidden
 * information (e.g. `reorderDeck` puts the real ids of the cards the
 * deciding player is looking at into `declarations`/context; those must
 * stay opaque to anyone else). Everyone else gets the same minimal
 * `{kind, playerId}` shape `SpoilsEngine`'s own `getFlowView()` summary
 * already uses elsewhere — enough for a UI to know "it's not your call
 * right now, waiting on <player>", nothing more.
 */
function redactPendingChoice(
  pendingChoice: PendingChoice | undefined,
  viewer: Viewer
): PendingChoice | { id: string; kind: string; playerId: PlayerId } | undefined {
  if (!pendingChoice) return undefined;
  if (pendingChoice.playerId === viewer) return pendingChoice;
  return { id: pendingChoice.id, kind: pendingChoice.kind, playerId: pendingChoice.playerId };
}

/**
 * A battle's `attackingParty`/`blockingParty` are cards that are, by the act
 * of attacking/blocking, already committed in-play and public — nothing to
 * redact structurally. `damageSources` only carries ids/numbers.
 */
function redactBattleView(battle: BattleView | undefined): BattleView | undefined {
  return battle;
}

export interface RedactStateOptions {
  /**
   * Active `grantsReveal` overrides (`ContinuousAbility.grantsReveal` —
   * "the top card of your deck is revealed at all times") — pass
   * `engine.getFlowView().revealed` when a live engine is available.
   * Omitted defaults to "nothing revealed", which is always safe (never
   * leaks) but won't un-hide what a `grantsReveal` card says should be public.
   */
  revealed?: Revealed;
  /**
   * `(cardId) => engine.canViewerSeeVoidedCard(viewer, cardId)`. Omitted: only the player recorded in
   * `CardInstance.faceDownBy` sees a face-down void / removed card.
   */
  canSeeVoided?: (cardId: CardInstanceId) => boolean;
  /**
   * Deck cards the viewer may see even though a deck is face-down: the cards their own pending choice lists (a
   * deck search, `reorderDeck`), cards they have looked at, their starting-resource candidates.
   */
  visibleCardIds?: ReadonlySet<CardInstanceId>;
  /**
   * Treat a player's own deck as visible to them (the earlier behaviour, for a trusted local client). Default
   * `false`: a library's contents and order are hidden from everyone, its owner included, except as above.
   */
  ownDeckVisible?: boolean;
}

/**
 * Redacts `state` for `viewer`. The true, unredacted `GameState` must remain
 * what every `perform()` call validates against — this is strictly an
 * outbound/broadcast-time transform, never consulted for legality.
 */
export function redactStateFor(
  state: GameState,
  viewer: Viewer,
  options: RedactStateOptions = {}
): GameState {
  const revealed = options.revealed ?? NOTHING_REVEALED;
  const cards = redactCards(state.cards, viewer, revealed, options);

  return {
    ...state,
    cards,
    // `state.gameLog` is otherwise a raw, unredacted copy riding along inside
    // an otherwise-safe `GameState` — redact it the same way `redactLogFor`
    // is meant to be called standalone (e.g. against `GameController.getLog()`,
    // which can include renderer-only annotations never `emit`ed into
    // `state.gameLog` at all), just inline here so nothing consuming
    // `redactStateFor`'s output alone can miss it.
    gameLog: redactLogFor(state.gameLog, cards, viewer, { revealed }),
    // The entire future shuffle/roll sequence is recoverable from this one
    // number (see `GameState.rngState`'s own doc comment) — never send it to
    // any viewer, including the player whose turn it is.
    rngState: 0,
    pendingChoice: redactPendingChoice(state.pendingChoice, viewer) as GameState["pendingChoice"],
    // Engine-internal continuation state for a handful of niche cards
    // (Auction House, MUSTACHE SHOWDOWN, Two-Headed Coin) — a client only
    // ever needs `pendingChoice` to know what to prompt for; if a future
    // card's UI genuinely needs more than that, extend the matching
    // `PendingChoice` type instead of exposing this raw internal state.
    pendingReplacement: undefined,
    pendingCoinFlip: undefined,
    pendingAuction: undefined,
    pendingPartition: undefined,
    // Waiting triggers' contexts and last-known card information: engine bookkeeping, never needed to draw the game.
    engineMemory: emptyEngineMemory()
  };
}

/**
 * Redacts an already-computed `GameFlowView` (`SpoilsEngine.getFlowView()`)
 * for `viewer`. Everything else on `GameFlowView` — `responseStack`,
 * `battle`, `revealed`, `winner`, `mode` — only ever carries ids/counts, not
 * card identities, so nothing else needs touching.
 */
export function redactFlowViewFor(flow: GameFlowView, viewer: Viewer): GameFlowView {
  return {
    ...flow,
    pendingChoice: redactPendingChoice(flow.pendingChoice, viewer) as GameFlowView["pendingChoice"],
    battle: redactBattleView(flow.battle)
  };
}

function eventReferencesHiddenCard(
  event: unknown,
  cards: Record<CardInstanceId, CardInstance>,
  viewer: Viewer,
  revealed: Revealed
): boolean {
  if (event == null || typeof event !== "object") return false;
  if (Array.isArray(event)) return event.some(v => eventReferencesHiddenCard(v, cards, viewer, revealed));

  for (const value of Object.values(event as Record<string, unknown>)) {
    if (typeof value === "string" && value in cards && isHiddenFrom(cards[value], viewer, revealed, {})) {
      return true;
    }
    if (typeof value === "object" && eventReferencesHiddenCard(value, cards, viewer, revealed)) {
      return true;
    }
  }
  return false;
}

export interface RedactLogOptions {
  revealed?: Revealed;
}

/**
 * Redacts a game log for `viewer`. An entry the engine marked with per-vantage text (`GameLogEntry.redacted`)
 * gets the line that vantage may read (`logMessageFor`) and loses the alternatives, so the full line never rides
 * along; that is exact (the public line "a card moves from deck to hand" stays readable).
 *
 * Fail-closed backstop: an entry with NO per-vantage text whose structured `event` still references a card that
 * is hidden from `viewer` right now can only be an event the engine did not mark, and its `message` may bake a
 * name in — it is replaced wholesale with a generic stand-in. Marker entries (`responseWindowOpened`,
 * `stackItemResolving`, ...) carry no event and pass through: they describe already-public stack mechanics.
 */
export function redactLogFor(
  log: readonly GameLogEntry[],
  cards: Record<CardInstanceId, CardInstance>,
  viewer: Viewer,
  options: RedactLogOptions = {}
): GameLogEntry[] {
  const revealed = options.revealed ?? NOTHING_REVEALED;
  const vantage: PlayerId | null = viewer === "spectator" ? null : viewer;

  return log.map(entry => {
    if (entry.redacted) {
      const { redacted: _redacted, ...rest } = entry;
      return { ...rest, message: logMessageFor(entry, vantage) };
    }
    if (!entry.event) return entry;
    if (!eventReferencesHiddenCard(entry.event, cards, viewer, revealed)) return entry;
    return { ...entry, message: "(hidden)" };
  });
}
