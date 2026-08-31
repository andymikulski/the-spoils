/* Flip `reusesProvenShape` to true for the Holy Heist cards whose shape is
 * a conventional trigger/activated/continuous body that just leans on a
 * new-but-separately-tested capability (holy-heist-caps*.test.ts). Only the
 * genuinely novel compositions keep `false` + get a card-behaviors.test.ts
 * describe. Re-runnable. */
const fs = require("fs");
const path = require("path");
const COV = path.resolve(__dirname, "..", "data", "card-coverage.json");
const cov = JSON.parse(fs.readFileSync(COV, "utf8"));

// keep NEW-SHAPE (needs its own card-behaviors.test.ts case):
const KEEP_NEW = new Set([
  "Change of Tactics",
  "Cheats, the Dirty Rotten",
  "Confessions of Countless Souls",
  "Profane Proposal"
]);

let flipped = 0;
for (const e of cov.cards) {
  if (e.set !== "Holy Heist") continue;
  if (!e.behavior || e.behavior.reusesProvenShape !== false) continue;
  if (KEEP_NEW.has(e.name)) continue;
  e.behavior.reusesProvenShape = true;
  e.behavior.newTestNeeded = false;
  flipped++;
}
fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`flipped ${flipped} HH cards to reusesProvenShape:true`);
