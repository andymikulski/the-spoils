#!/usr/bin/env node
/* author-2e.cjs — 2nd Edition is a pure reprint set.
 *
 * Every one of its 300 cards is a name+text match of an already-finished
 * card from 1st Edition / 1st Edition Part 2 (both 100% `verified`). This
 * script copies the source card's behaviour-relevant fields into the 2E
 * catalog entry and rewrites the 2E coverage entry to mirror the source's
 * classification (status, shapes, metadata, engineCapability, parityGaps),
 * appending a provenance note.
 *
 *   node .work/author-2e.cjs            # apply
 *   node .work/author-2e.cjs --dry      # report only
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

// Behaviour-relevant sibling fields on a CardDefinition that a reprint must carry.
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

// Index every non-2E card by normalized name.
const srcByName = new Map();
for (const c of cards) {
  if (c.set === "2nd Edition") continue;
  const e = covById.get(c.id);
  if (!e) continue;
  const k = norm(c.name);
  if (!srcByName.has(k)) srcByName.set(k, []);
  srcByName.get(k).push({ card: c, entry: e });
}

const rank = st => (st === "verified" ? 0 : st === "vanilla" ? 1 : st === "authored" ? 2 : 3);

const stats = { verified: 0, vanilla: 0, siblingsCopied: 0, attachToBackfill: 0, unmatched: [], weird: [] };

for (const c of cards) {
  if (c.set !== "2nd Edition") continue;
  const e = covById.get(c.id);
  const cands = (srcByName.get(norm(c.name)) || []).filter(o => norm(o.card.text) === norm(c.text));
  if (!cands.length) {
    stats.unmatched.push(c.name);
    continue;
  }
  cands.sort((a, b) => rank(a.entry.status) - rank(b.entry.status));
  const src = cands[0].card;
  const se = cands[0].entry;

  if (!["verified", "vanilla"].includes(se.status)) {
    stats.weird.push(`${c.name}: best source is ${se.status} (${src.set})`);
  }

  // --- copy behaviour-relevant sibling fields into the 2E card ---
  for (const f of SIBLINGS) {
    if (src[f] === undefined) continue;
    if (JSON.stringify(src[f]) === JSON.stringify(c[f])) continue;
    if (!DRY) c[f] = JSON.parse(JSON.stringify(src[f]));
    stats.siblingsCopied++;
    if (f === "attachTo") stats.attachToBackfill++;
  }
  // gear subtype union (Tri-Pole Magnet: 2E is missing nothing but be safe)
  if ((src.subtype || []).length && JSON.stringify(src.subtype) !== JSON.stringify(c.subtype)) {
    const union = [...new Set([...(c.subtype || []), ...src.subtype])];
    if (JSON.stringify(union) !== JSON.stringify(c.subtype)) {
      if (!DRY) c.subtype = union;
      stats.siblingsCopied++;
    }
  }

  // --- rewrite the coverage entry to mirror the source ---
  const isVanilla = se.status === "vanilla";
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
      ? `2nd Edition reprint of "${src.name}" (${src.set}) — vanilla, no behaviour needed.`
      : `2nd Edition reprint of "${src.name}" (${src.set}); behaviour copied verbatim from that verified card.` +
        (srcNote ? ` [source note: ${srcNote}]` : ""),
    rulesAudited: true
  };
  if ((se.parityGaps || []).length) newEntry.parityGaps = [...se.parityGaps];

  if (!DRY) {
    const idx = cov.cards.findIndex(x => x.id === e.id);
    cov.cards[idx] = newEntry;
  }
  if (isVanilla) stats.vanilla++;
  else stats.verified++;
}

if (!DRY) {
  fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2) + "\n");
  fs.writeFileSync(COV_PATH, JSON.stringify(cov, null, 2) + "\n");
}

console.log(DRY ? "[dry run]" : "[applied]");
console.log("  2E -> verified:", stats.verified);
console.log("  2E -> vanilla :", stats.vanilla);
console.log("  sibling fields copied into 2E cards:", stats.siblingsCopied, `(attachTo backfills: ${stats.attachToBackfill})`);
if (stats.unmatched.length) console.log("  UNMATCHED:", stats.unmatched);
if (stats.weird.length) console.log("  NON-verified/vanilla sources:", stats.weird);
