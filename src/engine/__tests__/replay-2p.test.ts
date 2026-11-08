// Two-player replay digests (docs/TESTING.md "Replay digests").
//
// data/replays/2p/game-*.json holds seeded random two-player games recorded by scripts/record-replays.ts:
// the setup inputs, every performed action, and a digest of the rules state after setup and after each
// action. Each game is rebuilt from its setup and replayed here; the digest after every action must equal the
// recorded one, including across a saveGame -> JSON -> loadGame round trip at a few points. A difference means
// two-player behavior changed. Re-record only for an intended, explained change.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIGEST_LENGTH } from "./support/digest.js";
import { ELIGIBLE_FACTIONS, SET_NAMES, definitionOf } from "./support/driver.js";
import { REPLAY_FORMAT_VERSION, replayAgainstDigests, type ReplayFile } from "./support/replay.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "replays", "2p");

const names = fs
  .readdirSync(DIR)
  .filter(name => /^game-\d+\.json$/.test(name))
  .sort();
const games = names.map(name => ({ name, file: JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as ReplayFile }));

test("the recorded corpus covers at least 100 games, every set and every full-fidelity faction", () => {
  assert.ok(games.length >= 100, `only ${games.length} recorded games in data/replays/2p`);

  const sets = new Set<string>();
  const factions = new Set<string>();
  for (const { file } of games) {
    for (const player of file.setup.players) {
      factions.add(player.deck.factionDefinitionId);
      for (const [id] of player.deck.cards) sets.add(definitionOf(id).set);
    }
  }
  const missingSets = SET_NAMES.filter(name => !sets.has(name));
  const missingFactions = ELIGIBLE_FACTIONS.filter(card => !factions.has(card.id)).map(card => `${card.name} (${card.set})`);
  assert.deepEqual(missingSets, [], `sets with no card in any recorded deck: ${missingSets.join(", ")}`);
  assert.deepEqual(missingFactions, [], `factions never played: ${missingFactions.join(", ")}`);
});

for (const { name, file } of games) {
  test(`replay ${name}: digest after every action matches the recording (${file.actions.length} actions)`, () => {
    assert.equal(file.formatVersion, REPLAY_FORMAT_VERSION, `${name}: unknown replay format`);
    assert.ok(file.roundTripAfter.length >= 1, `${name} records no save/load round-trip point`);
    assert.equal(file.digests.length, (file.actions.length + 1) * DIGEST_LENGTH, `${name}: digest count does not match the action count`);

    const mismatch = replayAgainstDigests(file, { roundTripAfter: file.roundTripAfter });
    assert.equal(
      mismatch,
      undefined,
      mismatch === undefined
        ? "replay matches"
        : `${name} (slot ${file.slot}, engine seed ${file.setup.seed}) diverged at step ${mismatch.index} ` +
          `(${mismatch.index === 0 ? "setup" : `after action ${mismatch.index - 1}: ${JSON.stringify(mismatch.action)}`}): ` +
          `expected digest ${mismatch.expected}, got ${mismatch.actual}` +
          `${mismatch.error ? `; ${mismatch.error}` : ""}`
    );
  });
}
