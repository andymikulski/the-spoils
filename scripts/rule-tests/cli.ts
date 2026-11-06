// CLI for the rules-coverage suite (docs/TESTING.md). Run: npm run rule-tests -- <command>
//
//   extract                  re-extract data/rule-tests/source/*.txt: the CR and FAQ from the PDFs in docs/ (needs pdftotext),
//                            multiplayer.txt from the "## Atoms" sections of docs/rules/*.md
//   build                    regenerate data/rule-tests/atoms.json from the source text
//   batches                  one line per batch: atoms, covered, done
//   manifest <batch>         the batch's atoms with their full wording and coverage state
//   show <id>                one atom, e.g. `show "CR 408.3b"`
//   coverage [--batch b]     coverage summary; writes data/rule-tests/progress.md
//   mark-done <batch>        add a fully covered batch to done.json
//   report                   mismatches, open questions and exemptions, with their notes

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BATCHES, buildAtoms, extractGuidelineAtoms, scanRuleReferences, type RuleAtom, type RuleReference } from "../../src/engine/__tests__/rules/_atoms.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DATA = ROOT + "data/rule-tests/";
const TESTS = ROOT + "src/engine/__tests__/rules/";

function readAtoms(): RuleAtom[] {
  return JSON.parse(readFileSync(DATA + "atoms.json", "utf8")) as RuleAtom[];
}

function readDone(): string[] {
  return existsSync(DATA + "done.json") ? (JSON.parse(readFileSync(DATA + "done.json", "utf8")) as string[]) : [];
}

function readRefs(): RuleReference[] {
  return readdirSync(TESTS)
    .filter((name) => name.endsWith(".test.ts") && !name.startsWith("_"))
    .flatMap((name) => scanRuleReferences(`rules/${name}`, readFileSync(TESTS + name, "utf8")));
}

type State = "test" | "mismatch" | "open" | "exempt" | "uncovered" | "heading";

/** The strongest coverage each atom has: a passing test beats a mismatch beats an open question beats an exemption. */
function states(atoms: RuleAtom[], refs: RuleReference[]): Map<string, State> {
  const rank: Record<RuleReference["fn"], State> = { rule: "test", ruleMismatch: "mismatch", ruleOpen: "open", ruleExempt: "exempt" };
  const order: State[] = ["test", "mismatch", "open", "exempt"];
  const out = new Map<string, State>();
  for (const atom of atoms) out.set(atom.id, atom.kind === "heading" ? "heading" : "uncovered");
  for (const ref of refs) {
    for (const id of ref.ids) {
      const now = out.get(id);
      if (now === "heading" || !now) continue;
      const next = rank[ref.fn];
      if (now === "uncovered" || order.indexOf(next) < order.indexOf(now)) out.set(id, next);
    }
  }
  return out;
}

function summary(atoms: RuleAtom[], state: Map<string, State>): Record<State, number> {
  const counts: Record<State, number> = { test: 0, mismatch: 0, open: 0, exempt: 0, uncovered: 0, heading: 0 };
  for (const atom of atoms) counts[state.get(atom.id)!]++;
  return counts;
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "extract": {
    mkdirSync(DATA + "source", { recursive: true });
    for (const [pdf, out] of [
      ["Comprehensive-Rules-2.5.pdf", "cr-2.5.txt"],
      ["The-Spoils-Rules-FAQ-2.0.pdf", "faq-2.0.txt"]
    ] as const) {
      const result = spawnSync("pdftotext", ["-layout", ROOT + "docs/" + pdf, DATA + "source/" + out], { stdio: "inherit" });
      if (result.status !== 0) throw new Error(`pdftotext failed for ${pdf}`);
    }
    const guidelines = ["multiplayer-guidelines", "showdown-rules", "epic-rules"].flatMap((name) => extractGuidelineAtoms(readFileSync(ROOT + `docs/rules/${name}.md`, "utf8")));
    writeFileSync(DATA + "source/multiplayer.txt", guidelines.join("\n") + "\n");
    console.log("extracted; now run `build`");
    break;
  }
  case "build": {
    const atoms = buildAtoms(readFileSync(DATA + "source/cr-2.5.txt", "utf8"), readFileSync(DATA + "source/faq-2.0.txt", "utf8"), readFileSync(DATA + "source/multiplayer.txt", "utf8"));
    writeFileSync(DATA + "atoms.json", JSON.stringify(atoms, null, 1) + "\n");
    console.log(`${atoms.length} atoms (${atoms.filter((a) => a.kind === "heading").length} headings) -> data/rule-tests/atoms.json`);
    break;
  }
  case "batches": {
    const atoms = readAtoms();
    const state = states(atoms, readRefs());
    const done = readDone();
    for (const { batch, title } of BATCHES) {
      const mine = atoms.filter((a) => a.batch === batch && a.kind === "rule");
      const covered = mine.filter((a) => state.get(a.id) !== "uncovered").length;
      console.log(`${done.includes(batch) ? "DONE" : "    "} ${batch.padEnd(28)} ${String(covered).padStart(3)}/${String(mine.length).padEnd(3)} ${title}`);
    }
    break;
  }
  case "manifest": {
    const batch = args[0];
    if (!BATCHES.some((b) => b.batch === batch)) throw new Error(`unknown batch ${batch}; try \`batches\``);
    const atoms = readAtoms();
    const state = states(atoms, readRefs());
    for (const atom of atoms.filter((a) => a.batch === batch)) {
      console.log(`${atom.id}${atom.kind === "heading" ? " (heading)" : ""} [${state.get(atom.id)}]\n  ${atom.text}${atom.answer ? `\n  A: ${atom.answer}` : ""}\n`);
    }
    break;
  }
  case "show": {
    const atom = readAtoms().find((a) => a.id === args[0]);
    if (!atom) throw new Error(`no atom ${args[0]}`);
    console.log(JSON.stringify(atom, null, 2));
    break;
  }
  case "coverage": {
    const atoms = readAtoms();
    const state = states(atoms, readRefs());
    const batchFlag = args.indexOf("--batch");
    const only = batchFlag >= 0 ? args[batchFlag + 1] : undefined;
    const total = summary(atoms.filter((a) => !only || a.batch === only), state);
    console.log(JSON.stringify(total));
    if (!only) {
      const done = readDone();
      const lines = ["# Rules coverage (generated by `npm run rule-tests -- coverage`)", "", `Totals: ${JSON.stringify(total)}`, "", "| Batch | Atoms | Test | Mismatch | Open | Exempt | Uncovered | Done |", "|---|---|---|---|---|---|---|---|"];
      for (const { batch } of BATCHES) {
        const c = summary(atoms.filter((a) => a.batch === batch && a.kind === "rule"), state);
        lines.push(`| ${batch} | ${c.test + c.mismatch + c.open + c.exempt + c.uncovered} | ${c.test} | ${c.mismatch} | ${c.open} | ${c.exempt} | ${c.uncovered} | ${done.includes(batch) ? "yes" : ""} |`);
      }
      writeFileSync(DATA + "progress.md", lines.join("\n") + "\n");
    } else {
      for (const atom of atoms.filter((a) => a.batch === only && state.get(a.id) === "uncovered")) console.log(`uncovered: ${atom.id}`);
    }
    break;
  }
  case "mark-done": {
    const batch = args[0];
    const atoms = readAtoms();
    const state = states(atoms, readRefs());
    const missing = atoms.filter((a) => a.batch === batch && state.get(a.id) === "uncovered");
    if (missing.length) throw new Error(`${batch} is not fully covered: ${missing.map((a) => a.id).join(", ")}`);
    const done = [...new Set([...readDone(), batch!])];
    writeFileSync(DATA + "done.json", JSON.stringify(done, null, 2) + "\n");
    console.log(`${batch} marked done (${done.length}/${BATCHES.length})`);
    break;
  }
  case "report": {
    for (const ref of readRefs().filter((r) => r.fn !== "rule")) console.log(`${ref.fn.padEnd(13)} ${ref.ids.join(", ")}  ${ref.note ?? ""}  (${ref.file}:${ref.line})`);
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
}
