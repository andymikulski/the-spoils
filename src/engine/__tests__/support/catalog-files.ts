// The card catalog as it sits on disk (data/sets.json + data/cards/<set id>.json,
// via scripts/lib/catalog.cjs), read directly rather than imported from
// src/data/cards.js. Tests that check the audited source data use this, so they
// never see the in-memory copy `npm run card-tests -- mutate` serves.

import { createRequire } from "node:module";
import type { CardDefinition } from "../../../engine.js";

const catalogLib = createRequire(import.meta.url)("../../../../scripts/lib/catalog.cjs") as {
  loadCatalog(): { sets: { id: string; name: string; cards: unknown[] }[]; cards: unknown[] };
};

/** Every printing, in data/sets.json order. */
export function readCatalogFiles<T = CardDefinition>(): T[] {
  return catalogLib.loadCatalog().cards as T[];
}

/** Each set's id, name and printings, in data/sets.json order. */
export function readCatalogSets<T = CardDefinition>(): { id: string; name: string; cards: T[] }[] {
  return catalogLib.loadCatalog().sets.map(({ id, name, cards }) => ({ id, name, cards: cards as T[] }));
}
