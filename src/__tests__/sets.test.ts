import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as data from "../data.js";
import { CARD_CATALOG, CARD_SETS as DATA_CARD_SETS } from "../data.js";
import { CARD_SETS } from "../sets.js";
import type { CardDefinition } from "../engine.js";
import { readCatalogSets } from "../engine/__tests__/support/catalog-files.js";

const repoRoot = new URL("../../", import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8"));

const loadSet = async (id: string): Promise<CardDefinition[]> =>
  ((await import(`../data/sets/${id}.js`)) as { default: CardDefinition[] }).default;

test("CARD_SETS lists data/sets.json in order, with each set file's card count", () => {
  const onDisk = readCatalogSets();
  assert.deepEqual(
    CARD_SETS.map(({ id, name, cardCount }) => ({ id, name, cardCount })),
    onDisk.map(({ id, name, cards }) => ({ id, name, cardCount: cards.length }))
  );
  assert.equal(DATA_CARD_SETS, CARD_SETS, "the-spoils/data re-exports the same set index");
});

test("each set module holds exactly its set's printings, matching data/cards/<id>.json", async () => {
  for (const set of readCatalogSets()) {
    const cards = await loadSet(set.id);
    assert.deepEqual(cards, set.cards, `src/data/sets/${set.id}.js is out of sync — run npm run sync-cards`);
    assert.ok(cards.length > 0, `${set.name} has no printings`);
    for (const card of cards) assert.equal(card.set, set.name, `${card.name} (${card.id}) is filed under ${set.id}`);
  }
});

test("CARD_CATALOG is every set module concatenated in CARD_SETS order", async () => {
  const concatenated = (await Promise.all(CARD_SETS.map((set) => loadSet(set.id)))).flat();
  assert.equal(CARD_CATALOG.length, concatenated.length);
  CARD_CATALOG.forEach((card, index) => assert.equal(card, concatenated[index], `catalog position ${index}`));
  assert.equal(new Set(CARD_CATALOG.map((card) => card.id)).size, CARD_CATALOG.length, "printing ids are unique across sets");
});

test("the-spoils/data exports each set as CARDS_<ID>, the same array as its set module", async () => {
  const exports = data as unknown as Record<string, unknown>;
  const setExports = Object.keys(exports).filter((name) => name.startsWith("CARDS_")).sort();
  const expected = CARD_SETS.map((set) => `CARDS_${set.id.toUpperCase().replace(/-/g, "_")}`);
  assert.deepEqual(setExports, [...expected].sort(), "one named export per set, and no others");
  for (const [index, set] of CARD_SETS.entries()) {
    assert.equal(exports[expected[index]!], await loadSet(set.id), `${expected[index]} is src/data/sets/${set.id}.js`);
  }
});

test("every set is a package entry point, and the set files ship", () => {
  const pkg = readJson("package.json");
  assert.deepEqual(pkg.exports["./sets/*"], { types: "./build/src/data/sets/*.d.ts", default: "./build/src/data/sets/*.js" });
  assert.deepEqual(pkg.typesVersions["*"]["sets/*"], ["./build/src/data/sets/*.d.ts"]);
  assert.deepEqual(pkg.exports["./sets"], { types: "./build/src/sets.d.ts", default: "./build/src/sets.js" });
  assert.deepEqual(pkg.typesVersions["*"]["sets"], ["./build/src/sets.d.ts"]);
  assert.ok(pkg.files.includes("data/cards") && pkg.files.includes("data/sets.json"));
});
