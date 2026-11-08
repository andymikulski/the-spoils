// No object of a `GameState` is reachable by two paths (authored ability data aside, see `findAliases`): checked after
// every action of a sample of the recorded games, and again on a copy that went through save -> JSON -> load.
// The engine keeps what a resolution shares (one context read by several parked effect lists and the open choice) once,
// by id, so a state and its JSON copy are the same game.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aliasScanner } from "../support/aliases.js";
import { createEngine } from "../support/driver.js";
import type { ReplayFile } from "../support/replay.js";

const REPLAYS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "data", "replays", "2p");

test("after every action of every fifth recorded game, nothing in the state is reachable twice", () => {
  const names = fs
    .readdirSync(REPLAYS)
    .filter(name => /^game-\d+\.json$/.test(name))
    .sort()
    .filter((_, index) => index % 5 === 0 || process.env.ALIAS_SCAN === "all");
  let checked = 0;
  let parked = 0;
  const found: string[] = [];
  for (const name of names) {
    const file = JSON.parse(fs.readFileSync(path.join(REPLAYS, name), "utf8")) as ReplayFile;
    const engine = createEngine(file.setup);
    const scan = aliasScanner(engine.definitions);
    for (let i = 0; i < file.actions.length; i++) {
      engine.perform(file.actions[i]!);
      checked++;
      if (engine.state.pendingEffectFrames.length > 0 || engine.state.pendingChoice) parked++;
      for (const alias of scan(engine.state)) {
        found.push(`${name} after action ${i + 1}: ${alias.paths.join(" == ")}`);
        if (found.length >= 20) break;
      }
      if (found.length >= 20) break;
    }
    if (found.length >= 20) break;
  }
  assert.deepEqual(found, []);
  assert.ok(checked > 2000, `only ${checked} states scanned`);
  assert.ok(parked > 200, `only ${parked} of them had a resolution parked`);
});
