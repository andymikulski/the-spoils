// Tiny usage example
import { SpoilsEngine, createTwoPlayerFactionGame, loadGame, saveGame } from "./engine.js";
import {
  CARD_CATALOG,
  ARCANIST_DECK,
  WARLORD_DECK,
  SEED3_SAMPLER_DECK
} from "./data.js";

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

/**
 * Same bootstrap, but both players run the Seed 3 sampler (see
 * `SEED3_SAMPLER_DECK`) — every Seed 3 mechanic on the table for
 * UI / feature testing.
 */
export function seed3SamplerGame(): SpoilsEngine {
  return createTwoPlayerFactionGame(
    CARD_CATALOG,
    { id: "p1", name: "Player 1", deckDefinitionIds: SEED3_SAMPLER_DECK },
    { id: "p2", name: "Player 2", deckDefinitionIds: SEED3_SAMPLER_DECK }
  );
}

const game = exampleGame();

// Faction-driven setup already ran: each player's faction is in play with
// its starting resources, decks are shuffled, opening hands are drawn, and
// the game is sitting in whatever step comes next (mulligan, if the faction
// offers one, otherwise the start of turn 1).
for (const player of Object.values(game.state.players)) {
  console.log(
    `${player.name}: ${player.hand.length} in hand, ${player.deck.length} in deck, ${player.influence} influence`
  );
}

console.log("setup:", game.state.setup);
console.log("flow:", game.getFlowView());

// Resolve the opening mulligans (both players keep their hands) to reach the
// start of turn 1.
while (game.state.setup.phase === "mulligan") {
  const order = game.state.setup.order;
  game.perform({
    type: "mulligan",
    playerId: order[game.state.setup.currentIndex],
    cardIds: []
  });
}

// Everything that has happened so far, in order, indented by response depth.
// Recording is on by default — game.setLogEnabled(false) turns it off.
console.log("\ngame log:\n" + game.formatLog());

// -----------------------------------------------------------------------------
// Save / load
// -----------------------------------------------------------------------------
//
// `saveGame` is plain JSON data — write it to a database/file as-is. Reload
// it later (a different process, after a server restart) with `loadGame`
// plus the same card catalog the game was played with.
const save = saveGame(game);
const savedJson = JSON.stringify(save);
const resumed = loadGame(JSON.parse(savedJson), CARD_CATALOG);
console.log(`\nresumed turn ${resumed.state.turn}, mode: ${resumed.getFlowView().mode}`);
