// Save / load at every action of the oracle games, shard 3 of 4 (see save-load-equivalence.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { saveLoadDivergence, saveLoadShard } from "./save-load-equivalence.js";

describe("a game saved and loaded before any action plays on as the original (shard 3 of 4)", () => {
  for (const spec of saveLoadShard(2, 4)) {
    test(spec.label, () => {
      const divergence = saveLoadDivergence(spec);
      if (divergence) assert.fail(divergence);
    });
  }
});
