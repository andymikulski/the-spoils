// Tiny usage example
import { SpoilsEngine, createTwoPlayerFactionGame } from "./engine.js";
import { CARD_CATALOG, ARCANIST_DECK, WARLORD_DECK } from "./data.js";

const CARD_DATABASE_URL = "/data/cards.json";
const CARD_IMAGE_ROOT = "/data/assets";

// -----------------------------------------------------------------------------
// Example game bootstrap
// -----------------------------------------------------------------------------

export function exampleGame(): SpoilsEngine {
  return createTwoPlayerFactionGame(
    CARD_CATALOG,
    { id: "p1", name: "Player 1", deckDefinitionIds: ARCANIST_DECK },
    { id: "p2", name: "Player 2", deckDefinitionIds: WARLORD_DECK }
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
