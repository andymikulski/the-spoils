// -----------------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------------

import type {
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
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
 * passes its own per-game ids instead; see `createTwoPlayerFactionGame`.
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

export function createTwoPlayerGame(
  playerA: {
    id: PlayerId;
    name: string;
    influence?: number;
  },
  playerB: {
    id: PlayerId;
    name: string;
    influence?: number;
  },
  cards: CardInstance[]
): GameState {
  const players: Record<PlayerId, PlayerState> = {};

  for (const player of [playerA, playerB]) {
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
    activePlayerId: playerA.id,
    priorityPlayerId: playerA.id,
    setup: { phase: "complete" },
    started: true,
    rngState: randomSeed(),
    // Placeholder — set for real just below, once `cardMap` is in its final form.
    idSeq: 0,
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
  for (const cardId of players[playerA.id].play) {
    cardMap[cardId].attackEligibleTurn = 1;
  }

  state.idSeq = deriveIdSeq(state);

  return state;
}
