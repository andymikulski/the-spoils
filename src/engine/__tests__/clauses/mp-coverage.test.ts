// Gate for the multiplayer clause tests (docs/TESTING.md, "Multiplayer clause gate"): every clause the manifest
// flags `mp` (data/card-tests/clauses.json, `Clause.mp`, see `_manifest.ts`) has a 3-seat test in clauses/mp/, and
// every `"quantified"` clause (each opponent / opponents / each player / all players) a 4-seat test as well.
//
// The tests are found by loading the clauses/mp/*.test.ts files with `collectMpClauses` (`_clause.ts`): their
// `mpClause(printingId, key, seats, title, fn)` calls are recorded instead of registered, so generated tests
// (a loop over seat counts) count by what they actually run. Each rules group counts once, whichever of its
// printings a test names. As in `_coverage.test.ts`, an `mpClauseMismatch` must have its finding written up in
// data/card-tests/findings/, and an `mpExempt` (covers every seat count) needs a reason (checked when it is called).

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bareAsserts } from "../support/lint.js";
import { collectMpClauses, type MpClauseRef } from "./_clause.js";
import { groupsByPrinting, hasFindingHeading, type RulesGroup } from "./_manifest.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = ROOT + "data/card-tests/";
const MP_DIR = fileURLToPath(new URL("./mp/", import.meta.url));

const manifest = JSON.parse(readFileSync(DATA + "clauses.json", "utf8")) as RulesGroup[];
const byPrinting = groupsByPrinting(manifest);
const files = readdirSync(MP_DIR).filter((name) => name.endsWith(".test.ts"));
const findings = existsSync(DATA + "findings")
  ? readdirSync(DATA + "findings")
      .filter((name) => name.endsWith(".md"))
      .map((name) => readFileSync(DATA + "findings/" + name, "utf8"))
      .join("\n")
  : "";

let refs: MpClauseRef[] = [];

describe("multiplayer clause coverage", () => {
  before(async () => {
    refs = await collectMpClauses(() => Promise.all(files.map((name) => import(pathToFileURL(MP_DIR + name).href))));
  });

  test("clauses/mp has test files, and they only use the multiplayer helpers", () => {
    assert.ok(files.length > 0, "no clauses/mp/*.test.ts files");
    assert.ok(refs.length > 0, "the mp test files registered no mpClause call");
    // A plain clause() there would run as a test but never count toward this gate.
    const plain = files.filter((name) => /^\s*clause(Mismatch|Unimplemented)?\(|^\s*exempt\(/m.test(readFileSync(MP_DIR + name, "utf8")));
    assert.deepEqual(plain, [], "use mpClause / mpClauseMismatch / mpExempt in clauses/mp");
  });

  test("every mp clause reference names a real printing and one of its group's clauses", () => {
    const bad: string[] = [];
    for (const ref of refs) {
      const group = byPrinting.get(ref.printingId);
      if (!group) bad.push(`${ref.fn} unknown printing ${ref.printingId}`);
      else for (const key of ref.keys) if (!group.clauses.some((clause) => clause.key === key)) bad.push(`${ref.fn} ${group.name}: no clause "${key}"`);
    }
    assert.deepEqual(bad, []);
  });

  test("every recorded mismatch is written up in data/card-tests/findings/", () => {
    const bad = refs
      .filter((ref) => ref.fn === "mpClauseMismatch" && (!ref.note || !hasFindingHeading(findings, ref.note)))
      .map((ref) => `${byPrinting.get(ref.printingId)?.name ?? ref.printingId} [${ref.keys.join(" ")}]: finding ${ref.note ?? "?"} missing`);
    assert.deepEqual(bad, []);
  });

  test("every mp clause has a 3-seat test, and every quantified clause also a 4-seat test", () => {
    const have = new Map<string, Set<number>>(); // `${group id}|${clause key}` -> seat counts tested
    for (const ref of refs) {
      const group = byPrinting.get(ref.printingId);
      if (!group) continue;
      for (const key of ref.keys) {
        const id = `${group.id}|${key}`;
        const seats = have.get(id) ?? new Set<number>();
        if (ref.seats === undefined) [3, 4].forEach((count) => seats.add(count)); // mpExempt
        else seats.add(ref.seats);
        have.set(id, seats);
      }
    }
    const missing: string[] = [];
    for (const group of manifest)
      for (const clause of group.clauses) {
        if (!clause.mp) continue;
        const seats = have.get(`${group.id}|${clause.key}`);
        const need = clause.mp === "quantified" ? [3, 4] : [3];
        const lacking = need.filter((count) => !seats?.has(count));
        if (lacking.length) missing.push(`${group.batch} ${group.name} (${group.id}) ${clause.key}: no ${lacking.join(" / ")}-seat mpClause`);
      }
    assert.deepEqual(missing, [], `${missing.length} mp clause(s) lack a multiplayer test`);
  });

  test("every assert.ok(x) / assert(x) in clauses/mp has a message", () => {
    const bad = files.flatMap((name) => bareAsserts(readFileSync(MP_DIR + name, "utf8")).map((line) => `clauses/mp/${name}:${line}`));
    assert.deepEqual(bad, []);
  });
});
