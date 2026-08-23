// Tiny usage example
import cardsJson from "./data/cards.js";
import { SpoilsEngine, createTwoPlayerGame, createCardInstance, findCatalogCard } from "./engine.js";
export const CARD_CATALOG = cardsJson;
export function exampleGame() {
    const rage = findCatalogCard("Rage", "1st Edition");
    console.log('rage', rage);
    const creeper = findCatalogCard("Compulsive Creeper", "1st Edition");
    console.log('creeper', creeper);
    const rage1 = createCardInstance(rage.id, "p1", "play");
    console.log(rage1);
    const creeper1 = createCardInstance(creeper.id, "p1", "play");
    console.log(creeper1);
    const state = createTwoPlayerGame({ id: "p1", name: "Player 1" }, { id: "p2", name: "Player 2" }, [rage1, creeper1]);
    console.log(state);
    const engine = new SpoilsEngine(CARD_CATALOG, state);
    return engine;
}
exampleGame();
