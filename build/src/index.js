// Tiny usage example
import cardsJson from "./data/cards.js";
import { SpoilsEngine, createTwoPlayerGame, createCardInstance, getCatalogCard } from "./engine.js";
export const CARD_CATALOG = cardsJson;
const CARD_DATABASE_URL = "/data/cards.json";
const CARD_IMAGE_ROOT = "/data/assets";
// -----------------------------------------------------------------------------
// Example game bootstrap
// -----------------------------------------------------------------------------
// These are your real preconstructed decklists.
// Duplicates are expected if a deck contains multiple copies of a card.
export const PLAYER_1_DECK = [
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "0c287282-82cf-4602-b37d-35d1bbea519c",
    "c6ea7e77-6ac0-4baa-9ba2-866726230426",
    "fd944597-35f5-4188-974b-2d318a31a3b8",
    "fd944597-35f5-4188-974b-2d318a31a3b8",
    "975a3794-1969-4b92-b3ff-bb91a0817d39",
    "975a3794-1969-4b92-b3ff-bb91a0817d39",
    "38205b8d-5512-43c9-b564-2a6877420fae",
    "38205b8d-5512-43c9-b564-2a6877420fae",
    "c8ecd7ab-d7d8-4749-b821-980f09c58edc",
    "c8ecd7ab-d7d8-4749-b821-980f09c58edc",
    "93a19b9e-4943-4e8b-b5e1-b73202812019",
    "93a19b9e-4943-4e8b-b5e1-b73202812019",
    "37693f37-621a-404c-b2ca-b11070e98782",
    "37693f37-621a-404c-b2ca-b11070e98782",
    "a3637139-2bb0-4041-acd4-cfe39fd3ceaa",
    "a3637139-2bb0-4041-acd4-cfe39fd3ceaa",
    "309b38b2-6cad-44f7-bddc-e55846d912bc",
    "6b2f22f0-755f-4418-84bd-cb8d44746980",
    "6b2f22f0-755f-4418-84bd-cb8d44746980",
    "5f6c6574-27db-4149-a19b-fd67dc589c1b",
    "5f6c6574-27db-4149-a19b-fd67dc589c1b",
    "9ce984e8-ccd1-40d8-9be7-1889f9493330",
    "9ce984e8-ccd1-40d8-9be7-1889f9493330",
    "e0abaa9e-7077-451b-a7e0-48d2f603dc28",
    "e0abaa9e-7077-451b-a7e0-48d2f603dc28",
    "3145aa6b-d8c6-4b7b-88cf-3a3e3e5cd9c2",
    "7ddb348a-e80a-4e3b-8cd7-c455924d9dea",
    "0b976c66-bf76-40f5-b6c0-b2faea2b9f39",
    "11dc7067-5dac-4a44-9761-6ff6af9d8895",
    "1d8d7483-283a-45d5-b04f-5edaf7c9fe78",
    "1069cb92-6fbb-4ef2-a2b5-9d0270763130",
    "fbfb201f-0928-4dd4-a6a1-c378fbfd3bb1",
    "c45a94f4-651e-43c0-9472-f5d8f48725f3",
    "302db228-b2b9-48df-8fd0-288219ffcf16",
    "977b96ef-93fb-4902-bde1-24469e94d9ab",
    "d652c320-e75b-420b-8a95-fd5be9edcc03"
];
export const PLAYER_2_DECK = [
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "3be26b3f-2c78-4d0c-8849-0b4ca48951fd",
    "c6ea7e77-6ac0-4baa-9ba2-866726230426",
    "e91b2120-8731-427d-81bb-a9c9d5429120",
    "91bc411b-c8f7-48dd-b544-7232d091b9de",
    "47335830-af69-48a3-9b0a-2c26d528ced5",
    "c8a04083-3f59-49b0-92d4-d2932e76a7d0",
    "2e1c148e-b056-4dc9-adc4-89232ff6cb50",
    "0d3e0b3b-ab3a-4217-927c-8221e4c00622",
    "2a9daa10-ec29-4d9f-b578-f86028adcce3",
    "9457ab04-726b-49b3-8ac4-f15a160fb7fe",
    "8e22ced3-6d0a-44d6-9f6e-0fa24b9a8872",
    "e2fd3c94-526a-4bbf-a27c-822d6ad1b2b0",
    "e2fd3c94-526a-4bbf-a27c-822d6ad1b2b0",
    "0f8f178d-72e2-465c-8275-9b8a3dea0420",
    "0f8f178d-72e2-465c-8275-9b8a3dea0420",
    "f15b0f13-6b31-484a-8c92-196ca8279c30",
    "f15b0f13-6b31-484a-8c92-196ca8279c30",
    "5bec2993-a7b0-4ad5-9561-ff218c61de11",
    "5bec2993-a7b0-4ad5-9561-ff218c61de11",
    "b026bc3b-ef8a-4a97-9a63-a8fcb33f9207",
    "b026bc3b-ef8a-4a97-9a63-a8fcb33f9207",
    "d0b6ce1f-3d8a-4cf4-8804-a4dfb1524f18",
    "d0b6ce1f-3d8a-4cf4-8804-a4dfb1524f18",
    "b737b07a-6d80-47cd-b27e-c0406883ca20",
    "b737b07a-6d80-47cd-b27e-c0406883ca20",
    "7bf1038d-38f7-4300-8922-e3f7884ef712",
    "7bf1038d-38f7-4300-8922-e3f7884ef712",
    "4fdcb48c-e495-429b-9d44-b3cb15e1f381",
    "5205a3f4-c16c-4194-a6d5-9c1422b2371a",
    "075dd510-edd1-412a-aff3-a162effd41f6",
    "075dd510-edd1-412a-aff3-a162effd41f6",
    "075dd510-edd1-412a-aff3-a162effd41f6",
    "b05b484f-458b-45c6-bb4f-cc72e7b3b921",
    "f1a9e770-6efd-4b5c-ac3a-bea69ec68d11"
];
function createDeckInstances(definitionIds, ownerId) {
    return definitionIds.map(definitionId => {
        // Fail immediately if the deck references a card that is not
        // present in cards.json.
        getCatalogCard(definitionId);
        return createCardInstance(definitionId, ownerId, "deck");
    });
}
function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [
            items[j],
            items[i]
        ];
    }
}
function drawOpeningHand(state, playerId, count) {
    const player = state.players[playerId];
    for (let i = 0; i < count; i++) {
        const cardId = player.deck.shift();
        if (!cardId) {
            break;
        }
        const card = state.cards[cardId];
        card.zone = "hand";
        player.hand.push(cardId);
    }
}
export function exampleGame() {
    const player1Cards = createDeckInstances(PLAYER_1_DECK, "p1");
    const player2Cards = createDeckInstances(PLAYER_2_DECK, "p2");
    const allCards = [
        ...player1Cards,
        ...player2Cards
    ];
    const state = createTwoPlayerGame({
        id: "p1",
        name: "Player 1"
    }, {
        id: "p2",
        name: "Player 2"
    }, allCards);
    // Shuffle the runtime instance IDs, not the definitions.
    shuffle(state.players.p1.deck);
    shuffle(state.players.p2.deck);
    // Temporary setup scaffolding.
    //
    // Once faction behavior / game setup rules are represented by the
    // engine, this should move into proper game initialization.
    drawOpeningHand(state, "p1", 7);
    drawOpeningHand(state, "p2", 7);
    return new SpoilsEngine(CARD_CATALOG, state);
}
const game = exampleGame();
console.log(game);
