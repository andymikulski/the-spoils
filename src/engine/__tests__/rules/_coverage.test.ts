// Gate for the rules-coverage suite (docs/TESTING.md): the atom manifest is
// current, every rule reference names a real atom, every recorded mismatch and
// open question is written up, and every batch marked done covers all of its
// atoms. Once data/rule-tests/done.json lists every batch, this is the proof
// that each rule of the Comprehensive Rules and each FAQ ruling has a test.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bareAsserts } from "../support/lint.js";
import { BATCHES, buildAtoms, hasHeading, scanRuleReferences, type RuleAtom } from "./_atoms.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = ROOT + "data/rule-tests/";
const TESTS = fileURLToPath(new URL("./", import.meta.url));

const manifest = JSON.parse(readFileSync(DATA + "atoms.json", "utf8")) as RuleAtom[];
const done = existsSync(DATA + "done.json") ? (JSON.parse(readFileSync(DATA + "done.json", "utf8")) as string[]) : [];
const files = readdirSync(TESTS).filter((name) => name.endsWith(".test.ts") && !name.startsWith("_"));
const refs = files.flatMap((name) => scanRuleReferences(`rules/${name}`, readFileSync(TESTS + name, "utf8")));
const findings = readMarkdownDir(DATA + "findings");
const questions = readMarkdownDir(DATA + "questions");
const known = new Map(manifest.map((atom) => [atom.id, atom]));

function readMarkdownDir(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(dir + "/" + name, "utf8"))
    .join("\n");
}

describe("rules coverage", () => {
  test("data/rule-tests/atoms.json matches the source text (run `npm run rule-tests -- build`)", () => {
    const current = buildAtoms(readFileSync(DATA + "source/cr-2.5.txt", "utf8"), readFileSync(DATA + "source/faq-2.0.txt", "utf8"), readFileSync(DATA + "source/multiplayer.txt", "utf8"));
    assert.deepEqual(current, manifest);
  });

  test("every atom belongs to a batch, and every batch section and prefix exists", () => {
    assert.deepEqual(manifest.filter((atom) => atom.batch === "unassigned").map((atom) => atom.id), []);
    const sections = new Set(manifest.map((atom) => atom.section));
    const missing = [
      ...BATCHES.flatMap((b) => (b.sections ?? []).filter((s) => !sections.has(s)).map((s) => `${b.batch}: section ${s} has no atoms`)),
      ...BATCHES.flatMap((b) => (b.prefixes ?? []).filter((p) => !manifest.some((atom) => atom.batch === b.batch && atom.id.startsWith(p))).map((p) => `${b.batch}: prefix "${p}" has no atoms`))
    ];
    // CR 404 "Rule Not Found" is an empty section: it has a heading and no rules.
    assert.deepEqual(missing.filter((line) => !line.endsWith("section 404 has no atoms")), []);
  });

  test("every rule reference names a real atom", () => {
    const bad = refs.flatMap((ref) => ref.ids.filter((id) => !known.has(id)).map((id) => `${ref.file}:${ref.line} unknown atom "${id}"`));
    assert.deepEqual(bad, []);
  });

  test("every recorded mismatch and open question is written up, and every exemption gives a reason", () => {
    const bad: string[] = [];
    for (const ref of refs) {
      if (ref.fn === "ruleMismatch" && (!ref.note || !hasHeading(findings, ref.note))) bad.push(`${ref.file}:${ref.line} finding ${ref.note ?? "?"} missing from data/rule-tests/findings/`);
      if (ref.fn === "ruleOpen" && (!ref.note || !hasHeading(questions, ref.note))) bad.push(`${ref.file}:${ref.line} question ${ref.note ?? "?"} missing from data/rule-tests/questions/`);
      if (ref.fn === "ruleExempt" && !ref.note?.trim()) bad.push(`${ref.file}:${ref.line} ruleExempt() without a reason`);
    }
    assert.deepEqual(bad, []);
  });

  test("every batch marked done covers all of its atoms", () => {
    const covered = new Set(refs.flatMap((ref) => ref.ids));
    const missing = manifest
      .filter((atom) => done.includes(atom.batch) && atom.kind === "rule" && !covered.has(atom.id))
      .map((atom) => `${atom.batch} ${atom.id}`);
    assert.deepEqual(missing, []);
  });

  test("every assert.ok(x) / assert(x) has a message (a failing one without can hang the run)", () => {
    const bad = files.flatMap((name) => bareAsserts(readFileSync(TESTS + name, "utf8")).map((line) => `rules/${name}:${line}`));
    assert.deepEqual(bad, []);
  });
});
