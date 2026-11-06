// Records the classic 2-player regression oracle:
//   npx tsx scripts/record-classic-oracle.ts
// writes src/engine/__tests__/oracle/classic-oracle.snapshots.json.
//
// Only re-record when a change to classic 2-player behavior is INTENDED
// (see "Classic regression oracle" in docs/TESTING.md). Review the diff of the
// JSON first: a changed winner / action count / turn hash tells you where the
// behavior moved.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORACLE_GAMES,
  digestProjection,
  runClassicGame,
  type OracleSnapshot
} from "../src/engine/__tests__/oracle/classic-oracle.js";

const outFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "engine",
  "__tests__",
  "oracle",
  "classic-oracle.snapshots.json"
);

const snapshots: Record<string, OracleSnapshot> = {};
const started = Date.now();

for (const spec of ORACLE_GAMES) {
  const t0 = Date.now();
  const projection = runClassicGame(spec);
  const snapshot = digestProjection(projection, spec.keepFull === true);
  snapshots[spec.label] = snapshot;
  console.log(
    `${spec.label.padEnd(36)} winner=${snapshot.winner.padEnd(5)} turns=${String(projection.turns.length).padStart(3)} ` +
      `actions=${String(snapshot.actionCount).padStart(5)} log=${String(snapshot.logLines).padStart(5)} ${Date.now() - t0}ms`
  );
}

// Pretty-printed, but each turn hash list and the full projections stay compact:
// one line per array/entry keeps the file small and the git diff readable.
const lines: string[] = ["{"];
const labels = Object.keys(snapshots);
labels.forEach((label, i) => {
  const { full, turnSha, ...rest } = snapshots[label];
  lines.push(`  ${JSON.stringify(label)}: {`);
  lines.push(`    "meta": ${JSON.stringify(rest)},`);
  lines.push(`    "turnSha": ${JSON.stringify(turnSha)}${full ? "," : ""}`);
  if (full) {
    const { turns, ...fullRest } = full;
    lines.push(`    "full": {`);
    lines.push(`      "head": ${JSON.stringify(fullRest)},`);
    lines.push(`      "turns": [`);
    lines.push(turns.map(t => `        ${JSON.stringify(t)}`).join(",\n"));
    lines.push("      ]");
    lines.push("    }");
  }
  lines.push(`  }${i < labels.length - 1 ? "," : ""}`);
});
lines.push("}");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
console.log(`\nWrote ${labels.length} games to ${outFile} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
