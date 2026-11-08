// The two-player test freeze (docs/TESTING.md): every test file recorded in
// data/test-freeze.json must still exist with exactly its recorded content.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const freeze = createRequire(import.meta.url)("../../../scripts/test-freeze.cjs") as {
  drift(): string[];
};

test("every frozen two-player test file is present and unmodified", () => {
  const problems = freeze.drift();
  assert.deepEqual(problems, [], `Frozen test files changed:\n${problems.join("\n")}`);
});
