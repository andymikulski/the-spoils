// -----------------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------------

import type {
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  GameFormat,
  GameState,
  PlayerId,
  PlayerState,
  Zone
} from "../types/index.js";
import { assert, deriveIdSeq, nextId } from "./utilities.js";
import { randomSeed } from "./rng.js";

/**
 * A fresh `CardInstance`. `id` defaults to the process-global counter
 * (`nextId`), which is only unique — not reproducible: the same card gets a
 * different id depending on how many instances this process minted before
 * it. Anything that must rebuild the *same* game later (saved/resumed games,
 * networked peers, replays — every `GameAction` names cards by instance id)
 * passes its own per-game ids instead; see `createFactionGame`.
 */
export function createCardInstance(
  definitionId: CardDefinitionId,
  ownerId: PlayerId,
  zone: Zone = "deck",
  id: CardInstanceId = nextId("card")
): CardInstance {
  return {
    id,
    definitionId,
    ownerId,
    controllerId: ownerId,
    zone,
    depleted: false,
    damage: 0,
    faceDown: false,
    attachedTo: undefined,
    attackEligibleTurn: undefined,
    counters: {}
  };
}

/** One seat passed to `createGame`. */
export interface GamePlayerSeat {
  id: PlayerId;
  name: string;
  influence?: number;
}

/** Options for `createGame`. */
export interface CreateGameOptions {
  /**
   * The table format. Defaults to `classic` for two seats and `freeForAll`
   * for more.
   */
  format?: GameFormat;
}

/**
 * The table format implied by `seats` when the caller names none, checked
 * against the seat count either way.
 */
export function resolveGameFormat(seats: readonly PlayerId[], format?: GameFormat): GameFormat {
  const resolved: GameFormat = format ?? (seats.length === 2 ? { kind: "classic" } : { kind: "freeForAll" });
  assert(new Set(seats).size === seats.length, "Every seat needs a distinct player id.");
  switch (resolved.kind) {
    case "classic":
      assert(seats.length === 2, `A classic game seats exactly two players (got ${seats.length}).`);
      break;
    case "freeForAll":
      assert(seats.length >= 2, `A free-for-all game seats at least two players (got ${seats.length}).`);
      break;
    case "showdown":
      assert(seats.includes(resolved.villainId), `The Villain '${resolved.villainId}' is not seated at this table.`);
      assert(seats.length >= 3, `A Showdown game seats one Villain and at least two Heroes (got ${seats.length} seats).`);
      break;
  }
  return resolved;
}

/**
 * A started game state for `seats` (in turn order — the first seat takes
 * turn 1) with `cards` already placed in their zones. The low-level
 * constructor used by tests and tools that lay out a board directly; real
 * games come from `createFactionGame`.
 */
export function createGame(
  seats: readonly GamePlayerSeat[],
  cards: CardInstance[],
  options: CreateGameOptions = {}
): GameState {
  const format = resolveGameFormat(seats.map(seat => seat.id), options.format);
  const players: Record<PlayerId, PlayerState> = {};
  const first = seats[0];

  for (const player of seats) {
    players[player.id] = {
      id: player.id,
      name: player.name,
      factionId: undefined,
      influence: player.influence ?? 0,
      deck: [],
      hand: [],
      play: [],
      discard: [],
      void: [],
      removed: []
    };
  }

  const cardMap: Record<
    CardInstanceId,
    CardInstance
  > = {};

  for (const card of cards) {
    cardMap[card.id] = card;

    const player =
      players[
        card.zone === "play"
          ? card.controllerId
          : card.ownerId
      ];

    assert(
      player,
      `Unknown player for card '${card.id}'.`
    );

    switch (card.zone) {
      case "deck":
        player.deck.push(card.id);
        break;
      case "hand":
        player.hand.push(card.id);
        break;
      case "play":
        player.play.push(card.id);
        break;
      case "discard":
        player.discard.push(card.id);
        break;
      case "void":
        player.void.push(card.id);
        break;
      case "removed":
        player.removed.push(card.id);
        break;
      case "deploying":
        break;
    }
  }

  const state: GameState = {
    turn: 1,
    activePlayerId: first.id,
    priorityPlayerId: first.id,
    setup: { phase: "complete" },
    started: true,
    rngState: randomSeed(),
    // Placeholder — set for real just below, once `cardMap` is in its final form.
    idSeq: 0,
    format,
    turnOrder: seats.map(seat => seat.id),
    players,
    cards: cardMap,
    modifiers: [],
    areaModifiers: [],
    keywordGrants: [],
    keywordSuppressions: [],
    playerKeywordGrants: [],
    abilitySuppressions: [],
    restrictions: [],
    costReductions: [],
    resourceGrants: [],
    provideGrants: [],
    playRestrictions: [],
    numericCostModifiers: [],
    outgoingDamageModifiers: [],
    thresholdReductions: [],
    cardTypeGrants: [],
    subtypeGrants: [],
    runtimeReplacements: [],
    handMoveRedirects: [],
    tacticsPlayedThisTurn: [],
    damageShields: [],
    battleDamageTransforms: [],
    controlGrants: [],
    abilityGrants: [],
    blockRestrictionGrants: [],
    partyRestrictionGrants: [],
    mustBlockGrants: [],
    voidPlayGrants: [],
    scheduledEffects: [],
    damagePreventionWindows: [],
    destructionRestrictionWindows: [],
    abilityUsesThisTurn: {},
    attacksThisTurn: {},
    attackDeclarationsThisTurn: {},
    responseStack: [],
    gameLog: [],
    pendingEffectFrames: [],
    turnEventTally: {},
    turnDeploys: {},
    turnDestroyed: [],
    damageThisTurn: {},
    factionDamageInflictedThisTurn: {},
    influenceLostThisTurn: {},
    restoreRuleSkips: {},
    mulligan: {}
  };

  // Anything already in play before turn 1 began counts as having started
  // the turn in play under the first player's control.
  for (const cardId of players[first.id].play) {
    cardMap[cardId].attackEligibleTurn = 1;
  }

  state.idSeq = deriveIdSeq(state);

  return state;
}
