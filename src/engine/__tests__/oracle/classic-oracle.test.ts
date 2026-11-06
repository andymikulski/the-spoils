// Replays every classic 2-player oracle game and asserts the run is identical
// to the recording in classic-oracle.snapshots.json. See classic-oracle.ts for
// what is recorded and docs/TESTING.md ("Classic regression oracle") for when
// (and how) to re-record.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORACLE_GAMES,
  describeDivergence,
  fromStored,
  runClassicGame,
  type StoredSnapshot
} from "./classic-oracle.js";

const snapshotFile = join(dirname(fileURLToPath(import.meta.url)), "classic-oracle.snapshots.json");
const stored = JSON.parse(readFileSync(snapshotFile, "utf8")) as Record<string, StoredSnapshot>;

describe("classic 2-player regression oracle", () => {
  test("every oracle game has a recording and vice versa", () => {
    assert.deepEqual(
      Object.keys(stored).sort(),
      ORACLE_GAMES.map(g => g.label).sort(),
      "Game list and classic-oracle.snapshots.json disagree: re-record (npx tsx scripts/record-classic-oracle.ts)."
    );
  });

  test("the oracle covers the opponent-referencing factions and several base factions", () => {
    const factions = new Set(ORACLE_GAMES.flatMap(g => [g.a.faction, g.b.faction]));
    assert.ok([...factions].some(f => f.startsWith("The Knitting Coalition")));
    assert.ok([...factions].some(f => f.startsWith("The Union of Unextraordinary Miners")));
    assert.ok(factions.size >= 10);
    assert.ok(ORACLE_GAMES.length >= 24);
  });

  for (const spec of ORACLE_GAMES) {
    test(`${spec.label} replays identically`, () => {
      const expected = stored[spec.label];
      assert.ok(expected, `No recording for ${spec.label}: re-record.`);

      const divergence = describeDivergence(fromStored(expected), runClassicGame(spec));
      if (divergence) assert.fail(divergence);
    });
  }
});
