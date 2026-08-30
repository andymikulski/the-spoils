#!/usr/bin/env node
/* Merge .work/author-*.json patches into data/cards.json + flip the coverage
 * entries to "authored". Pass the slice files to merge as args, e.g.
 *   node .work/merge-authored.cjs 1 3
 * Re-runnable. Normalizes data/cards.json to JSON.stringify(_, null, 2)+LF.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const COV = path.join(ROOT, "data", "card-coverage.json");

const slices = process.argv.slice(2);
if (slices.length === 0) {
  console.error("usage: merge-authored.cjs <slice-number>...");
  process.exit(2);
}

const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const cardById = new Map(cards.map(c => [c.id, c]));
const covById = new Map(cov.cards.map(e => [e.id, e]));

const CARD_PATCH_KEYS = new Set([
  "unique",
  "attachTo",
  "flipUp",
  "revealFromHand",
  "selfDisposition"
]);

let merged = 0;
for (const n of slices) {
  const p = path.join(ROOT, ".work", `author-${n}.json`);
  const patch = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [id, entry] of Object.entries(patch)) {
    const card = cardById.get(id);
    if (!card) throw new Error(`author-${n}.json: unknown card id ${id}`);
    if (!entry.behavior) throw new Error(`${card.name}: no behavior in patch`);

    card.behavior = entry.behavior;

    for (const [k, v] of Object.entries(entry.cardPatch ?? {})) {
      if (!CARD_PATCH_KEYS.has(k)) {
        throw new Error(`${card.name}: illegal cardPatch key ${k}`);
      }
      card[k] = v;
    }

    const ce = covById.get(id);
    ce.status = "authored";
    // mirror metadata the card now carries
    ce.metadata = {
      unique: card.unique ?? null,
      attachTo: card.attachTo ?? null,
      resourceProvides: card.resource?.provides ?? null,
      keywords: card.behavior?.keywords ?? []
    };
    merged++;
  }
}

fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`merged ${merged} authored cards from slices ${slices.join(", ")}`);
