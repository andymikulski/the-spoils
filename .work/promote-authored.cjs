#!/usr/bin/env node
/* promote-authored.cjs — flip a set's `authored` coverage entries to
 * `verified` once its `*-exercise.test.ts` (every behaviour-bearing card
 * driven through the public API) and its `*-smoke.test.ts` (hand-written
 * end-to-end scenarios) are both green.
 *
 *   node .work/promote-authored.cjs "Seed 2"
 *   node .work/promote-authored.cjs "Shade of the Devoured Emperor"
 *   node .work/promote-authored.cjs "Seed 2" --dry
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const COV_PATH = path.join(ROOT, "data", "card-coverage.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const SET = args.find(a => !a.startsWith("--"));
if (!SET) {
  console.error("usage: node .work/promote-authored.cjs <set name> [--dry]");
  process.exit(1);
}

const cov = JSON.parse(fs.readFileSync(COV_PATH, "utf8"));
const promoted = [];
for (const e of cov.cards) {
  if (e.set !== SET) continue;
  if (e.status !== "authored") continue;
  e.status = "verified";
  promoted.push(e.name);
}

console.log(`${SET}: ${promoted.length} authored -> verified`);
for (const n of promoted) console.log(`  ${n}`);

if (DRY) {
  console.log("(dry run — nothing written)");
} else {
  fs.writeFileSync(COV_PATH, JSON.stringify(cov, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, COV_PATH)}`);
}
