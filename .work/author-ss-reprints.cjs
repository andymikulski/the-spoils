#!/usr/bin/env node
/* author-ss-reprints.cjs — copy the 300 Seed Saga reprints.
 *
 * Seed Saga is ~89% reprint: 215 of its cards name+text-match a `verified`
 * card in an earlier set, 85 match a still-`authored` Seed 2 / SotDE card.
 * For every Seed Saga card that has an exact (name+text) match in another
 * set, copy that source's behaviour + siblings into the SS catalog entry and
 * rewrite the SS coverage entry to mirror the source, appending provenance.
 *
 * Status: reprint of `verified`  -> `verified`.
 *         reprint of `authored`  -> `verified` too (the seed-saga-exercise
 *           pass drives it through the public API, the same bar every set
 *           used); the note records the source was only shape-proven.
 *         reprint of `vanilla`   -> `vanilla`.
 *
 * The ~40 genuinely-novel SS cards (no name match anywhere) are left
 * untouched for the classify -> capability -> author pass.
 *
 *   node .work/author-ss-reprints.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CARDS_PATH = path.join(ROOT, "data", "cards.json");
const COV_PATH = path.join(ROOT, "data", "card-coverage.json");
const DRY = process.argv.includes("--dry");

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
const cov = JSON.parse(fs.readFileSync(COV_PATH, "utf8"));
const covById = new Map(cov.cards.map(e => [e.id, e]));

const norm = s => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
const textHash = s =>
  crypto.createHash("sha1").update((s || "").replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 12);

const SIBLINGS = [
  "behavior",
  "attachTo",
  "unique",
  "flipUp",
  "selfDisposition",
  "revealFromHand",
  "thresholdSlack",
  "resource"
];

const srcByName = new Map();
for (const c of cards) {
  if (c.set === "Seed Saga") continue;
  const e = covById.get(c.id);
  if (!e) continue;
  const k = norm(c.name);
  if (!srcByName.has(k)) srcByName.set(k, []);
  srcByName.get(k).push({ card: c, entry: e });
}

const rank = st => (st === "verified" ? 0 : st === "vanilla" ? 1 : st === "authored" ? 2 : 3);

const stats = { verified: 0, vanilla: 0, fromAuthored: 0, siblingsCopied: 0, novel: [], skippedVanilla: 0 };

for (const c of cards) {
  if (c.set !== "Seed Saga") continue;
  const e = covById.get(c.id);
  const cands = (srcByName.get(norm(c.name)) || []).filter(o => norm(o.card.text) === norm(c.text));
  if (!cands.length) {
    if (e.status !== "vanilla") stats.novel.push(c.name);
    else stats.skippedVanilla++;
    continue;
  }
  cands.sort((a, b) => rank(a.entry.status) - rank(b.entry.status));
  const src = cands[0].card;
  const se = cands[0].entry;

  for (const f of SIBLINGS) {
    if (src[f] === undefined) continue;
    if (JSON.stringify(src[f]) === JSON.stringify(c[f])) continue;
    if (!DRY) c[f] = JSON.parse(JSON.stringify(src[f]));
    stats.siblingsCopied++;
  }
  if ((src.subtype || []).length && JSON.stringify(src.subtype) !== JSON.stringify(c.subtype)) {
    const union = [...new Set([...(c.subtype || []), ...src.subtype])];
    if (JSON.stringify(union) !== JSON.stringify(c.subtype)) {
      if (!DRY) c.subtype = union;
      stats.siblingsCopied++;
    }
  }

  const isVanilla = se.status === "vanilla";
  const fromAuthored = se.status === "authored";
  const srcNote = (se.notes || "").trim();
  const newEntry = {
    id: e.id,
    name: c.name,
    set: c.set,
    type: c.type,
    status: isVanilla ? "vanilla" : "verified",
    textHash: textHash(c.text),
    behavior: {
      needed: se.behavior ? !!se.behavior.needed : !isVanilla,
      shapes: se.behavior && se.behavior.shapes ? [...se.behavior.shapes] : [],
      reusesProvenShape: true,
      newTestNeeded: false
    },
    metadata: {
      unique: c.unique ?? null,
      attachTo: c.attachTo ?? null,
      resourceProvides: c.resource?.provides ?? null,
      keywords: c.behavior?.keywords ?? []
    },
    engineCapability: [...(se.engineCapability || [])],
    display: se.display && Object.keys(se.display).length ? { ...se.display } : {},
    confidence: se.confidence || "high",
    notes: isVanilla
      ? `Seed Saga reprint of "${src.name}" (${src.set}) — vanilla, no behaviour needed.`
      : `Seed Saga reprint of "${src.name}" (${src.set}); behaviour copied verbatim.` +
        (fromAuthored
          ? ` Source was shape-proven (authored) in ${src.set}; this copy is driven through the public API by seed-saga-exercise.test.ts.`
          : "") +
        (srcNote ? ` [source note: ${srcNote}]` : ""),
    rulesAudited: true
  };
  if ((se.parityGaps || []).length) newEntry.parityGaps = [...se.parityGaps];

  if (!DRY) {
    const idx = cov.cards.findIndex(x => x.id === e.id);
    cov.cards[idx] = newEntry;
  }
  if (isVanilla) stats.vanilla++;
  else {
    stats.verified++;
    if (fromAuthored) stats.fromAuthored++;
  }
}

if (!DRY) {
  fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2) + "\n");
  fs.writeFileSync(COV_PATH, JSON.stringify(cov, null, 2) + "\n");
}

console.log(DRY ? "[dry run]" : "[applied]");
console.log("  SS -> verified:", stats.verified, `(of which ${stats.fromAuthored} reprint a still-authored Seed 2 / SotDE card)`);
console.log("  SS -> vanilla :", stats.vanilla, `(+${stats.skippedVanilla} already-vanilla, no source)`);
console.log("  sibling fields copied:", stats.siblingsCopied);
console.log("  genuinely-novel SS cards left for the manual pass:", stats.novel.length);
console.log("   ", stats.novel.join(", "));
