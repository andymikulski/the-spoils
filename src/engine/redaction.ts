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
// never consulted for legality (see the "Hard ordering requirement" in
// docs/multiplayer-architecture.md: validation always runs against the true,
// unredacted state).
//
// Fail-closed by design: anything this module doesn't explicitly know how to
// classify gets omitted or genericized, never passed through unexamined.

import type {
  CardInstance,
  GameState,
  GameFlowView,
  BattleView
} from "../types/state.js";
import type { GameLogEntry } from "../types/log.js";
import type { PendingChoice } from "../types/choices.js";
import type { CardDefinitionId, CardInstanceId, PlayerId } from "../types/ids.js";

/** A seated player, or a neutral onlooker with no hidden information of their own. */
export type Viewer = PlayerId | "spectator";

/** Stands in for a redacted card's real `definitionId`. Never a real catalog id. */
export const HIDDEN_DEFINITION_ID = "__hidden__" as CardDefinitionId;

type Revealed = GameFlowView["revealed"];

const NOTHING_REVEALED: Revealed = { deckTop: [], hands: [] };

function isHiddenFrom(card: CardInstance, viewer: Viewer, revealed: Revealed): boolean {
  if (card.zone === "hand" || card.zone === "deck") {
    if (card.ownerId === viewer) return false;
    if (card.zone === "deck" && revealed.deckTop.some(r => r.playerId === card.ownerId && r.cardId === card.id)) {
      return false;
    }
    if (card.zone === "hand" && revealed.hands.includes(card.ownerId)) {
      return false;
    }
    return true;
  }

  // A face-down card (RULES.md §4 / CR §411.1) is an anonymous resource with
  // no printed characteristics to anyone but the player who controls it —
  // regardless of zone (face-down cards can sit in play or the void).
  if (card.faceDown) {
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
  return masked;
}

function redactCards(
  cards: Record<CardInstanceId, CardInstance>,
  viewer: Viewer,
  revealed: Revealed
): Record<CardInstanceId, CardInstance> {
  const result: Record<CardInstanceId, CardInstance> = {};
  for (const [id, card] of Object.entries(cards)) {
    result[id] = isHiddenFrom(card, viewer, revealed) ? maskCard(card) : card;
  }
  return result;
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
): PendingChoice | { kind: string; playerId: PlayerId } | undefined {
  if (!pendingChoice) return undefined;
  if (pendingChoice.playerId === viewer) return pendingChoice;
  return { kind: pendingChoice.kind, playerId: pendingChoice.playerId };
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
  const cards = redactCards(state.cards, viewer, revealed);

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
    pendingPartition: undefined
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
    if (typeof value === "string" && value in cards && isHiddenFrom(cards[value], viewer, revealed)) {
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
 * Redacts a game log for `viewer`. Every entry's structured `event` only
 * ever carries ids (safe — see `redactStateFor`'s card masking), but
 * `message` is a precomputed, human-readable string that can bake a real
 * card name straight in (`describeEvent()`); that's the actual leak
 * surface. An entry whose event touches a card currently hidden from
 * `viewer` gets its `message` replaced wholesale with a generic stand-in
 * rather than attempting to surgically edit the rendered string.
 *
 * Marker entries (`responseWindowOpened`, `stackItemResolving`, ...) carry
 * no structured payload to check in this type, but describe stack/response
 * mechanics that are inherently already-public actions (declaring an
 * attack, activating an ability, a response window opening) by the time
 * they're logged — nothing here is a card still sitting in a hidden zone —
 * so they pass through unredacted.
 */
export function redactLogFor(
  log: readonly GameLogEntry[],
  cards: Record<CardInstanceId, CardInstance>,
  viewer: Viewer,
  options: RedactLogOptions = {}
): GameLogEntry[] {
  const revealed = options.revealed ?? NOTHING_REVEALED;

  return log.map(entry => {
    if (!entry.event) return entry;
    if (!eventReferencesHiddenCard(entry.event, cards, viewer, revealed)) return entry;
    return { ...entry, message: "(hidden)" };
  });
}
