import {
  CardDefinitionId,
  PlayerId,
  Zone,
  CardInstanceId,
} from "./ids_primitives.js";
import { CardInstance, GameState, PlayerState } from "./runtime_state.js";
import { nextId, assert } from "./utils.js";

// -----------------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------------

export function createCardInstance(
  definitionId: CardDefinitionId,
  ownerId: PlayerId,
  zone: Zone = "deck",
): CardInstance {
  return {
    id: nextId("card"),
    definitionId,
    ownerId,
    controllerId: ownerId,
    zone,
    depleted: false,
    damage: 0,
    counters: {},
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
  cards: CardInstance[],
): GameState {
  const players: Record<PlayerId, PlayerState> = {};

  for (const player of [playerA, playerB]) {
    players[player.id] = {
      id: player.id,
      name: player.name,
      influence: player.influence ?? 25,
      resources: 0,
      thresholds: {},
      deck: [],
      hand: [],
      play: [],
      discard: [],
      void: [],
    };
  }

  const cardMap: Record<CardInstanceId, CardInstance> = {};

  for (const card of cards) {
    cardMap[card.id] = card;

    const player =
      players[card.zone === "play" ? card.controllerId : card.ownerId];

    assert(player, `Unknown player for card '${card.id}'.`);

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
      case "deploying":
        break;
    }
  }

  return {
    turn: 1,
    activePlayerId: playerA.id,
    priorityPlayerId: playerA.id,
    players,
    cards: cardMap,
    modifiers: [],
  };
}
