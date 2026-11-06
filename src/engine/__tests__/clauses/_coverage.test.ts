// Gate for the clause-coverage suite (docs/TESTING.md): the manifest is
// current, every clause reference names a real printing and clause, every
// recorded mismatch is written up, and every batch marked done covers all of
// its clauses. Once data/card-tests/done.json lists every batch, this is the
// proof that each printed clause of every card has a test.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bareAsserts } from "../support/lint.js";
import { buildRulesGroups, groupsByPrinting, hasFindingHeading, scanClauseReferences, type RulesGroup } from "./_manifest.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = ROOT + "data/card-tests/";
const TESTS = fileURLToPath(new URL("./", import.meta.url));

const manifest = JSON.parse(readFileSync(DATA + "clauses.json", "utf8")) as RulesGroup[];
const done = existsSync(DATA + "done.json") ? (JSON.parse(readFileSync(DATA + "done.json", "utf8")) as string[]) : [];
const files = readdirSync(TESTS).filter((name) => name.endsWith(".test.ts") && !name.startsWith("_"));
const refs = files.flatMap((name) => scanClauseReferences(`clauses/${name}`, readFileSync(TESTS + name, "utf8")));
const findings = existsSync(DATA + "findings")
  ? readdirSync(DATA + "findings")
      .filter((name) => name.endsWith(".md"))
      .map((name) => readFileSync(DATA + "findings/" + name, "utf8"))
      .join("\n")
  : "";
const byPrinting = groupsByPrinting(manifest);

describe("clause coverage", () => {
  test("data/card-tests/clauses.json matches the catalog (run `npm run card-tests -- build`)", () => {
    const current = buildRulesGroups();
    assert.deepEqual(
      current.map(({ id, printings, clauses, batch }) => ({ id, printings, clauses, batch })),
      manifest.map(({ id, printings, clauses, batch }) => ({ id, printings, clauses, batch }))
    );
  });

  test("every clause reference names a real printing and one of its group's clauses", () => {
    const bad: string[] = [];
    for (const ref of refs) {
      const group = byPrinting.get(ref.printingId);
      if (!group) bad.push(`${ref.file}:${ref.line} unknown printing ${ref.printingId}`);
      else for (const key of ref.keys) if (!group.clauses.some((clause) => clause.key === key)) bad.push(`${ref.file}:${ref.line} ${group.name}: no clause "${key}"`);
    }
    assert.deepEqual(bad, []);
  });

  test("every recorded mismatch is written up, and every exemption gives a reason", () => {
    const bad: string[] = [];
    for (const ref of refs) {
      if (ref.fn === "clauseMismatch" && (!ref.note || !hasFindingHeading(findings, ref.note))) bad.push(`${ref.file}:${ref.line} finding ${ref.note ?? "?"} missing from data/card-tests/findings/`);
      if ((ref.fn === "exempt" || ref.fn === "clauseUnimplemented") && !ref.note?.trim()) bad.push(`${ref.file}:${ref.line} ${ref.fn}() without a reason`);
    }
    assert.deepEqual(bad, []);
  });

  test("clauseUnimplemented is only used for printings the engine knowingly doesn't support (stub / partial fidelity)", () => {
    // Anything else that doesn't do what its card says is a broken card: a failing clauseMismatch.
    const fidelity = (JSON.parse(readFileSync(ROOT + "data/card-fidelity.json", "utf8")) as { fidelity: Record<string, string> }).fidelity;
    const bad = refs
      .filter((ref) => ref.fn === "clauseUnimplemented")
      .filter((ref) => !(byPrinting.get(ref.printingId)?.printings ?? [ref.printingId]).some((id) => (fidelity[id] ?? "full") !== "full"))
      .map((ref) => `${ref.file}:${ref.line} ${ref.printingId} is full fidelity — use clauseMismatch`);
    assert.deepEqual(bad, []);
  });

  test("every batch marked done covers all of its clauses", () => {
    const covered = new Map<string, Set<string>>();
    for (const ref of refs) {
      const group = byPrinting.get(ref.printingId);
      if (!group) continue;
      const keys = covered.get(group.id) ?? new Set();
      for (const key of ref.keys) keys.add(key);
      covered.set(group.id, keys);
    }
    const missing = manifest
      .filter((group) => done.includes(group.batch))
      .flatMap((group) =>
        group.clauses.filter((clause) => !covered.get(group.id)?.has(clause.key)).map((clause) => `${group.batch} ${group.name}: ${clause.key}`)
      );
    assert.deepEqual(missing, []);
  });

  test("every assert.ok(x) / assert(x) has a message (a failing one without can hang the run)", () => {
    // Without a message, a failing assert.ok makes Node re-read and parse the caller's source file to quote the
    // expression. On these big TypeScript files that can spin forever: seed-saga-10.p2 hung the suite (2026-10-20).
    const bad = files.flatMap((name) => bareAsserts(readFileSync(TESTS + name, "utf8")).map((line) => `clauses/${name}:${line}`));
    assert.deepEqual(bad, []);
  });
});
