// Test reporter of `npm run test:seats` (docs/TESTING.md, "Bystander replay"): prints nothing, and writes one JSON
// summary to the file named by SPOILS_SEATS_OUT: the number of passing / failing / todo leaf tests (suites are not
// counted) and, for every failing leaf test, its full title path (describe titles, then the test) and the first line of
// its error. It is used on a test file run directly, so one process has one file's tests in order.

import { writeFileSync } from "node:fs";

export default async function* seatReporter(source) {
  const names = [];
  const summary = { pass: 0, fail: 0, todo: 0, skipped: 0, failures: [] };
  for await (const event of source) {
    const { type, data } = event;
    if (type === "test:start") {
      names.length = data.nesting;
      names.push(data.name);
    } else if (type === "test:pass" || type === "test:fail") {
      if (data.details?.type === "suite") continue;
      if (type === "test:pass") {
        if (data.todo) summary.todo += 1;
        else if (data.skip) summary.skipped += 1;
        else summary.pass += 1;
        continue;
      }
      // A `todo` test (an open rules question, an unimplemented clause) is expected not to pass.
      if (data.todo) {
        summary.todo += 1;
        continue;
      }
      summary.fail += 1;
      const error = data.details?.error;
      const cause = error?.cause ?? error;
      // The first frame inside the repository's tests (not node_modules / node:internal) says where it failed.
      const frame = String(cause?.stack ?? "")
        .split("\n")
        .find(line => /__tests__.*\.ts:\d+/.test(line) && !/support[\\/]bystanders/.test(line));
      summary.failures.push({
        path: [...names.slice(0, data.nesting), data.name],
        error: String(cause?.message ?? cause ?? "").split("\n")[0].slice(0, 300),
        at: frame ? frame.trim().replace(/^at /, "").replace(/.*__tests__[\\/]/, "").slice(0, 120) : ""
      });
    }
  }
  writeFileSync(process.env.SPOILS_SEATS_OUT, JSON.stringify(summary));
}
