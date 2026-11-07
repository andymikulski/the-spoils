/* sets.ts
 *
 * The package's "./sets" export: which card sets exist, without loading any
 * cards. Each set's printings are their own entry point,
 * `the-spoils/sets/<id>` (default export: `CardDefinition[]`), so a consumer
 * can load one set without the rest of the catalog. `the-spoils/data`'s
 * `CARD_CATALOG` is every set concatenated in `CARD_SETS` order.
 */

import setIndex from "./data/set-index.js";

export interface CardSetInfo {
  /** The set's entry-point id: `the-spoils/sets/<id>`. */
  id: string;
  /** The set's name, as printings carry it in `CardDefinition.set`. */
  name: string;
  /** How many printings the set has. */
  cardCount: number;
}

/** Every card set, in catalog order. */
export const CARD_SETS: readonly CardSetInfo[] = setIndex;
