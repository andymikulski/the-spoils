// Type-level smoke test of the published surface: every entry point, imported
// by package name. See tsconfig.json in this directory.
import { SpoilsEngine, createTwoPlayerFactionGame, type GameAction, type GameState, type CardDefinition, type CardDefinitionId } from "the-spoils";
import { CARD_CATALOG, ARCANIST_DECK, WARLORD_DECK, cardFidelity, type CardFidelity } from "the-spoils/data";
import { resolveCardBackUrl, CARD_BACK_ASSET_ID } from "the-spoils/assets";
import { parseCardText, cardTextToPlain, type CardTextBlock } from "the-spoils/card-text";

const defs: CardDefinition[] = CARD_CATALOG;
const deck: CardDefinitionId[] = ARCANIST_DECK;
const fid: CardFidelity = cardFidelity(deck[0]!);
const url: string = resolveCardBackUrl("/img");
const back: "card-back" = CARD_BACK_ASSET_ID;
const blocks: CardTextBlock[] = parseCardText("x");
const plain: string = cardTextToPlain(blocks);
export type Check = [typeof SpoilsEngine, typeof createTwoPlayerFactionGame, GameAction, GameState, typeof WARLORD_DECK];
export { defs, fid, url, back, plain };
