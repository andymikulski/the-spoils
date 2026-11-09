// `npm run card-tests -- mp-mutate`: player-word mutation testing of the multiplayer clause tests (docs/TESTING.md,
// "Multiplayer mutation testing"). Mutations come from `mpMutations.ts`; each runs in a child process through the same
// in-memory catalog hook as `mutate` (scripts/card-tests/mutation/). A mutation is DETECTED when a test of the mp files
// that name the card (tier 1) fails that passed unmutated; if none does, every mp file of the set is tried (tier 2, "detected
// elsewhere"); a mutation neither tier detects is a gap unless it is on the equivalence list
// (data/card-tests/mp-mutation-equivalents.json).

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMpInventory } from "../../src/engine/__tests__/clauses/_mpInventory.js";
import { generateMpMutations, mutationCode, type MpEquivalent, type MpMutation } from "./mpMutations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EQUIVALENTS_FILE = join(ROOT, "data", "card-tests", "mp-mutation-equivalents.json");
const REGISTER = `file:///${join(ROOT, "scripts", "card-tests", "mutation", "register.mjs").replace(/\\/g, "/")}`;
const TIMEOUT_MS = 90_000;

interface Run {
  failing: Set<string>;
  error?: string;
  hung?: boolean;
}

function runFile(file: string, mutation?: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...(mutation ? ["--import", REGISTER] : []), "--test-reporter=tap", file], {
      cwd: ROOT,
      env: { ...process.env, MUT: mutation ?? "" }
    });
    let stdout = "";
    let stderr = "";
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      child.kill();
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    child.on("close", (status) => {
      clearTimeout(timer);
      const failing = new Set<string>();
      if (hung) return resolve({ failing, ...(mutation ? { hung: true } : { error: "baseline run timed out" }) });
      const output = `${stdout}\n${stderr}`;
      const mutationError = output.match(/MUTATION_ERROR: ([^\n`]*)/);
      if (mutation && mutationError) return resolve({ failing, error: mutationError[1]!.trim() });
      for (const line of stdout.split("\n")) {
        const match = line.match(/^\s*not ok \d+ - (.*?)(?: # (TODO|SKIP).*)?$/);
        if (match && !match[2]) failing.add(match[1]!);
      }
      if (mutation && status !== 0 && failing.size === 0) {
        return resolve({ failing, error: `file failed to run: ${stderr.split("\n").find((line) => line.trim()) ?? "?"}` });
      }
      resolve({ failing });
    });
  });
}

/** Runs `items` through `work`, `jobs` at a time. */
async function pool<T>(items: T[], jobs: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]!, index);
      }
    })
  );
}

export type Verdict = "detected" | "detected (hang)" | "detected elsewhere" | "equivalent" | "GAP" | "ERROR";

export interface MpMutationResult {
  mutation: MpMutation;
  verdict: Verdict;
  /** A test that caught it (first), or the error. */
  note?: string;
}

export function loadEquivalents(): MpEquivalent[] {
  return existsSync(EQUIVALENTS_FILE) ? (JSON.parse(readFileSync(EQUIVALENTS_FILE, "utf8")) as MpEquivalent[]) : [];
}

export async function mpMutate(options: { set?: string; jobs: number; list: boolean; out?: string; card?: string; gapsFrom?: string }): Promise<void> {
  const { mutations: all, setFiles } = generateMpMutations(buildMpInventory());
  let mutations = options.set ? all.filter((m) => m.set === options.set) : all;
  if (options.card) mutations = mutations.filter((m) => m.cardName === options.card || m.printingId === options.card);
  if (options.gapsFrom) {
    // Rerun only the mutations a previous run (its --out file) left as GAP.
    const gaps = new Set((JSON.parse(readFileSync(options.gapsFrom, "utf8")) as Array<{ id: string; verdict: string }>).filter((r) => r.verdict === "GAP").map((r) => r.id));
    mutations = mutations.filter((m) => gaps.has(m.id));
  }
  const bySet = new Map<string, number>();
  for (const m of mutations) bySet.set(m.set, (bySet.get(m.set) ?? 0) + 1);
  console.log(`${mutations.length} mutations: ${[...bySet].map(([set, n]) => `${set} ${n}`).join(", ")}`);
  if (options.list) {
    for (const m of mutations) console.log(`${m.id}   [${m.cardName}] ${m.files.map((f) => basename(f)).join(",")}`);
    return;
  }
  const equivalents = new Map(loadEquivalents().map((e) => [`${e.printingId}|${e.path}|${e.operator}`, e.reason]));
  const files = new Set<string>();
  for (const m of mutations) {
    for (const file of m.files) files.add(file);
    for (const file of setFiles.get(m.set) ?? []) files.add(file);
  }
  const baseline = new Map<string, Set<string>>();
  await pool([...files], options.jobs, async (file) => {
    const run = await runFile(file);
    if (run.error) throw new Error(`${basename(file)}: ${run.error}`);
    baseline.set(file, run.failing);
  });
  console.log(`baseline: ${files.size} files, ${[...baseline.values()].reduce((sum, set) => sum + set.size, 0)} failing tests`);

  const results: MpMutationResult[] = [];
  const started = Date.now();
  await pool(mutations, options.jobs, async (mutation, index) => {
    const code = mutationCode(mutation);
    const tryFiles = async (list: string[]): Promise<MpMutationResult | undefined> => {
      for (const file of list) {
        const run = await runFile(file, code);
        if (run.error) return { mutation, verdict: "ERROR", note: run.error.slice(0, 160) };
        if (run.hung) return { mutation, verdict: "detected (hang)" };
        const fresh = [...run.failing].filter((name) => !baseline.get(file)!.has(name));
        if (fresh.length) return { mutation, verdict: "detected", note: fresh[0]!.slice(0, 160) };
      }
      return undefined;
    };
    let result = await tryFiles(mutation.files);
    if (!result) {
      const rest = (setFiles.get(mutation.set) ?? []).filter((file) => !mutation.files.includes(file));
      result = await tryFiles(rest);
      if (result?.verdict === "detected") result = { ...result, verdict: "detected elsewhere" };
    }
    result ??= { mutation, verdict: equivalents.has(mutation.id) ? "equivalent" : "GAP", note: equivalents.get(mutation.id) };
    // A mutation the list calls equivalent but a test detects: the entry is stale.
    if (equivalents.has(mutation.id) && result.verdict.startsWith("detected")) result = { ...result, note: `STALE equivalence entry; detected by ${result.note ?? "hang"}` };
    results.push(result);
    if ((results.length % 50 === 0) || results.length === mutations.length) {
      console.log(`  ${results.length}/${mutations.length} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    void index;
  });

  results.sort((a, b) => a.mutation.id.localeCompare(b.mutation.id));
  const out = options.out ?? join(tmpdir(), `mp-mutate-${options.set ?? "all"}.json`);
  writeFileSync(out, JSON.stringify(results.map((r) => ({ id: r.mutation.id, set: r.mutation.set, card: r.mutation.cardName, verdict: r.verdict, note: r.note, files: r.mutation.files.map((f) => basename(f)) })), null, 2));

  const sets = [...new Set(results.map((r) => r.mutation.set))];
  const verdicts: Verdict[] = ["detected", "detected (hang)", "detected elsewhere", "equivalent", "GAP", "ERROR"];
  console.log(`\nset / ${verdicts.join(" / ")}`);
  for (const set of sets) {
    const mine = results.filter((r) => r.mutation.set === set);
    console.log(`${set}: ${mine.length} generated; ${verdicts.map((v) => `${mine.filter((r) => r.verdict === v).length} ${v}`).join(", ")}`);
  }
  const byOperator = new Map<string, number>();
  for (const r of results) byOperator.set(r.mutation.operator.replace(/^(players|from) .*? -> /, "$1 -> "), (byOperator.get(r.mutation.operator.replace(/^(players|from) .*? -> /, "$1 -> ")) ?? 0) + 1);
  console.log(`operators: ${[...byOperator].map(([op, n]) => `${op} ${n}`).join("; ")}`);
  for (const r of results.filter((r) => r.verdict === "GAP" || r.verdict === "ERROR" || r.note?.startsWith("STALE"))) {
    console.log(`${r.verdict.padEnd(5)} ${r.mutation.id}  [${r.mutation.cardName}]${r.note ? `  ${r.note}` : ""}`);
  }
  console.log(`full results: ${out.startsWith(ROOT) ? relative(ROOT, out) : out}`);
  const bad = results.filter((r) => r.verdict === "GAP" || r.verdict === "ERROR").length;
  if (bad) process.exitCode = 1;
}
