// Tiny usage example
import cardsJson from "./data/cards.js";
import arcanistDeckIds from "./data/decks/arcanist-ids.js";
import warlordDeckIds from "./data/decks/warlord-ids.js";
import { CardDefinition, CardDefinitionId, SpoilsEngine, createTwoPlayerFactionGame } from "./engine.js";

export const CARD_CATALOG = cardsJson as CardDefinition[];

const CARD_DATABASE_URL = "/data/cards.json";
const CARD_IMAGE_ROOT = "/data/assets";

// -----------------------------------------------------------------------------
// Example game bootstrap
// -----------------------------------------------------------------------------

// These are real preconstructed decklists (each includes one copy of its
// faction card, mixed in with the rest). Duplicates are expected wherever a
// deck contains multiple copies of a card.
export const PLAYER_1_DECK: CardDefinitionId[] = arcanistDeckIds;
export const PLAYER_2_DECK: CardDefinitionId[] = warlordDeckIds;

export function exampleGame(): SpoilsEngine {
  return createTwoPlayerFactionGame(
    CARD_CATALOG,
    { id: "p1", name: "Player 1", deckDefinitionIds: PLAYER_1_DECK },
    { id: "p2", name: "Player 2", deckDefinitionIds: PLAYER_2_DECK }
  );
}

const game = exampleGame();

// Faction-driven setup already ran: each player's faction is in play with
// its starting resources, decks are shuffled, opening hands are drawn, and
// the game is sitting in whatever step comes next (mulligan, if the faction
// offers one, otherwise turn 1's develop step).
for (const player of Object.values(game.state.players)) {
  console.log(
    `${player.name}: ${player.hand.length} in hand, ${player.deck.length} in deck, ${player.influence} influence`
  );
}

console.log("setup:", game.state.setup);
console.log("flow:", game.getFlowView());
