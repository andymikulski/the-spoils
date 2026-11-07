// Type-level smoke test of the published surface: every entry point, imported
// by package name. See tsconfig.json in this directory.
import { SpoilsEngine, createTwoPlayerFactionGame, type GameAction, type GameState, type CardDefinition, type CardDefinitionId } from "the-spoils";
import { CARD_CATALOG, CARD_SETS as DATA_SETS, CARDS_1ST_EDITION, cardFidelity, type CardFidelity } from "the-spoils/data";
import { CARD_SETS, type CardSetInfo } from "the-spoils/sets";
import seedSaga from "the-spoils/sets/seed-saga";
import { resolveCardBackUrl, CARD_BACK_ASSET_ID } from "the-spoils/assets";
import { parseCardText, cardTextToPlain, type CardTextBlock } from "the-spoils/card-text";

const defs: CardDefinition[] = CARD_CATALOG;
const deck: CardDefinitionId[] = [CARD_CATALOG[0]!.id];
const oneSet: CardDefinition[] = seedSaga;
const firstEdition: CardDefinition[] = CARDS_1ST_EDITION;
const sets: readonly CardSetInfo[] = CARD_SETS;
const setIds: string[] = DATA_SETS.map((set) => set.id);
const fid: CardFidelity = cardFidelity(deck[0]!);
const url: string = resolveCardBackUrl("/img");
const back: "card-back" = CARD_BACK_ASSET_ID;
const blocks: CardTextBlock[] = parseCardText("x");
const plain: string = cardTextToPlain(blocks);
export type Check = [typeof SpoilsEngine, typeof createTwoPlayerFactionGame, GameAction, GameState];
export { defs, oneSet, firstEdition, sets, setIds, fid, url, back, plain };
