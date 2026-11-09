// Clause-coverage suite tooling (docs/TESTING.md).
//
//   npm run card-tests -- build              regenerate data/card-tests/clauses.json (rules groups, clauses, batches)
//   npm run card-tests -- batches            batch list with coverage status
//   npm run card-tests -- manifest <batch> [--missing] [--groups 1-8]
//                                            what a test writer needs: one batch, only uncovered clauses, or a group range
//   npm run card-tests -- show <printingId>  one printing's full definition (JSON)
//   npm run card-tests -- coverage [--batch <b>]
//                                            static coverage scan; writes data/card-tests/progress.md
//   npm run card-tests -- mark-done <batch>  record a fully covered batch in data/card-tests/done.json
//   npm run card-tests -- parts <batch> [--size 14]
//                                            split a batch's uncovered clauses into agent-sized group ranges
//   npm run card-tests -- report [--batch <b>]
//                                            run the clause tests: broken cards (written up / not yet), fixed markers, unimplemented
//   npm run card-tests -- mutate --batch <b> --file <mutations.txt>
//                                            test the tests: apply each data mutation in memory and count NEW failing
//                                            tests in the batch. A line is `label|||<js>` with `cards` and
//                                            `card(name, set?)` in scope, e.g.
//                                            `cost +1|||card("Gnat","Seed").cost += 1`. 0 new failures = SURVIVED
//                                            (a behavior change the batch's tests can't see).
//   npm run card-tests -- mp-mutate [--set <s>] [--jobs n] [--list] [--card name] [--out f] [--gaps-from f]
//                                            player-word mutation testing of the mp clause tests (docs/TESTING.md): every mutation of
//                                            an mp clause with a test must be detected by clauses/mp/, or sit on the equivalence list
//   npm run card-tests -- mp-inventory       regenerate data/card-tests/mp-inventory.{json,md}: every printed player phrase and
//                                            behavior player word per rules group / clause (joins with clauses.json)
//   npm run card-tests -- mp-worklist        regenerate data/card-tests/mp-worklist.json: the pending `edit: true` sites of data/card-tests/mp-spec,
//                                            by set; also lists `edit: true` sites changed to an invalid form and `edit: false` sites that moved
//   npm run card-tests -- status             fix-phase scoreboard: cards working as printed, broken clauses, findings
//   npm run card-tests -- findings [--sys N] [--category c] [--batch b] [--open|--fixed] [--card text]
//                                            list written findings (id, category, SYS ids, status, citing tests)
//   npm run card-tests -- close <findingId>... [--note "fix"]   |   close --all-fixed [--note "fix"]
//                                            a fixed card: check every test citing the finding now passes, turn its
//                                            clauseMismatch calls into clause, and mark the finding FIXED

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { CardDefinition } from "../../src/types/index.js";
import {
  CATALOG,
  buildRulesGroups,
  groupsByPrinting,
  hasFindingHeading,
  scanClauseReferences,
  slug,
  type ClauseReference,
  type RulesGroup
} from "../../src/engine/__tests__/clauses/_manifest.js";
import { buildMpInventory, renderMpSummary } from "../../src/engine/__tests__/clauses/_mpInventory.js";
import {
  WORKLIST_FILE,
  evaluate,
  loadSpecSites,
  renderWorklist
} from "../../src/engine/__tests__/clauses/_mpWorklist.js";
import { mpMutate } from "./mpMutate.js";
import { cardTextToPlain, parseCardText, serializeCardText } from "../../src/cardText.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "data", "card-tests");
const MANIFEST = join(DATA, "clauses.json");
const DONE = join(DATA, "done.json");
const FINDINGS = join(DATA, "findings");
const PROGRESS = join(DATA, "progress.md");
const TESTS = join(ROOT, "src", "engine", "__tests__", "clauses");
const PER_CARD = join(ROOT, "src", "engine", "__tests__", "per-card");

const BY_ID = new Map(CATALOG.map((card) => [card.id, card]));
const FIDELITY = (JSON.parse(readFileSync(join(ROOT, "data", "card-fidelity.json"), "utf8")) as { fidelity: Record<string, string> }).fidelity;

function loadGroups(): RulesGroup[] {
  if (!existsSync(MANIFEST)) throw new Error("No manifest yet — run `npm run card-tests -- build`.");
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as RulesGroup[];
}

function loadDone(): string[] {
  return existsSync(DONE) ? (JSON.parse(readFileSync(DONE, "utf8")) as string[]) : [];
}

function testFiles(): string[] {
  if (!existsSync(TESTS)) return [];
  return readdirSync(TESTS)
    .filter((name) => name.endsWith(".test.ts") && !name.startsWith("_"))
    .map((name) => join(TESTS, name));
}

/** A batch's test files: `<batch>.test.ts` plus any part files `<batch>.<part>.test.ts`. */
function batchFiles(batch: string): string[] {
  return testFiles().filter((file) => {
    const name = file.split(/[\\/]/).pop()!;
    return name === `${batch}.test.ts` || (name.startsWith(`${batch}.`) && name.endsWith(".test.ts") && !name.slice(batch.length + 1, -8).includes("."));
  });
}

/** Whether a problem line belongs to one of `batch`'s files. */
const issueInBatch = (issue: string, batch: string): boolean =>
  new RegExp(`clauses/${batch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[^/.]+)?\\.test\\.ts`).test(issue);

function scanAll(): ClauseReference[] {
  return testFiles().flatMap((file) => scanClauseReferences(relative(ROOT, file).replace(/\\/g, "/"), readFileSync(file, "utf8")));
}

interface ClauseStatus {
  covered: number;
  mismatch: number;
  unimplemented: number;
  exempt: number;
  missing: string[];
}

function coverageByGroup(groups: RulesGroup[], refs: ClauseReference[]): Map<string, ClauseStatus> {
  const byPrinting = groupsByPrinting(groups);
  const seen = new Map<string, Map<string, Set<ClauseReference["fn"]>>>();
  for (const ref of refs) {
    const group = byPrinting.get(ref.printingId);
    if (!group) continue;
    const keys = seen.get(group.id) ?? new Map();
    for (const key of ref.keys) {
      const fns = keys.get(key) ?? new Set();
      fns.add(ref.fn);
      keys.set(key, fns);
    }
    seen.set(group.id, keys);
  }
  const out = new Map<string, ClauseStatus>();
  for (const group of groups) {
    const keys = seen.get(group.id) ?? new Map<string, Set<string>>();
    const status: ClauseStatus = { covered: 0, mismatch: 0, unimplemented: 0, exempt: 0, missing: [] };
    for (const clause of group.clauses) {
      const fns = keys.get(clause.key);
      if (!fns) status.missing.push(clause.key);
      else if (fns.has("clauseMismatch")) status.mismatch++;
      else if (fns.has("clauseUnimplemented")) status.unimplemented++;
      else if (fns.has("clause")) status.covered++;
      else status.exempt++;
    }
    out.set(group.id, status);
  }
  return out;
}

function problems(groups: RulesGroup[], refs: ClauseReference[]): string[] {
  const byPrinting = groupsByPrinting(groups);
  const findingsText = existsSync(FINDINGS)
    ? readdirSync(FINDINGS)
        .filter((name) => name.endsWith(".md"))
        .map((name) => readFileSync(join(FINDINGS, name), "utf8"))
        .join("\n")
    : "";
  const out: string[] = [];
  for (const ref of refs) {
    const where = `${ref.file}:${ref.line}`;
    const group = byPrinting.get(ref.printingId);
    if (!group) {
      out.push(`${where}: unknown printing id ${ref.printingId}`);
      continue;
    }
    for (const key of ref.keys) {
      if (!group.clauses.some((clause) => clause.key === key)) out.push(`${where}: ${group.name} has no clause "${key}"`);
    }
    if (ref.fn === "clauseMismatch" && (!ref.note || !hasFindingHeading(findingsText, ref.note))) {
      out.push(`${where}: finding ${ref.note ?? "(none)"} is not written up in data/card-tests/findings/`);
    }
    if ((ref.fn === "exempt" || ref.fn === "clauseUnimplemented") && !ref.note?.trim()) out.push(`${where}: ${ref.fn}() needs a reason`);
    if (ref.fn === "clauseUnimplemented" && !group.printings.some((id) => (FIDELITY[id] ?? "full") !== "full")) {
      out.push(`${where}: ${group.name} is full fidelity — a clause it gets wrong is a clauseMismatch, not clauseUnimplemented`);
    }
  }
  return out;
}

function batchRows(groups: RulesGroup[], status: Map<string, ClauseStatus>) {
  const done = new Set(loadDone());
  const rows = new Map<string, { batch: string; groups: number; clauses: number; covered: number; mismatch: number; unimplemented: number; exempt: number; missing: number }>();
  for (const group of groups) {
    const row = rows.get(group.batch) ?? { batch: group.batch, groups: 0, clauses: 0, covered: 0, mismatch: 0, unimplemented: 0, exempt: 0, missing: 0 };
    const s = status.get(group.id)!;
    row.groups++;
    row.clauses += group.clauses.length;
    row.covered += s.covered;
    row.mismatch += s.mismatch;
    row.unimplemented += s.unimplemented;
    row.exempt += s.exempt;
    row.missing += s.missing.length;
    rows.set(group.batch, row);
  }
  return [...rows.values()].map((row) => ({ ...row, done: done.has(row.batch) }));
}

// --- commands -----------------------------------------------------------------

function build(): void {
  const groups = buildRulesGroups();
  mkdirSync(FINDINGS, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(groups, null, 2) + "\n");
  if (!existsSync(DONE)) writeFileSync(DONE, "[]\n");
  const batches = new Set(groups.map((group) => group.batch));
  const clauses = groups.reduce((sum, group) => sum + group.clauses.length, 0);
  console.log(`${CATALOG.length} printings -> ${groups.length} rules groups, ${clauses} clauses, ${batches.size} batches. Wrote ${relative(ROOT, MANIFEST)}.`);
}

function mpInventory(): void {
  const inventory = buildMpInventory();
  const json = join(DATA, "mp-inventory.json");
  const md = join(DATA, "mp-inventory.md");
  writeFileSync(json, JSON.stringify(inventory, null, 2) + "\n");
  writeFileSync(md, renderMpSummary(inventory));
  const clauses = inventory.flatMap((group) => group.clauses);
  console.log(
    `${inventory.length} rules groups, ${clauses.length} clauses, ${clauses.filter((c) => c.mp !== false).length} with mp set, ` +
      `${clauses.filter((c) => c.mp === "quantified").length} quantified. Wrote ${relative(ROOT, json)} and ${relative(ROOT, md)}.`
  );
}

function mpWorklist(): void {
  const { worklist, invalid, moved, unknown } = evaluate(loadSpecSites());
  writeFileSync(WORKLIST_FILE, renderWorklist(worklist));
  for (const [set, work] of Object.entries(worklist.sets)) console.log(`${set.padEnd(32)} ${String(work.sites).padStart(4)} pending sites in ${String(work.clauses).padStart(3)} clauses`);
  console.log(`${"total".padEnd(32)} ${String(worklist.total.sites).padStart(4)} pending sites in ${String(worklist.total.clauses).padStart(3)} clauses. Wrote ${relative(ROOT, WORKLIST_FILE)}.`);
  for (const [label, lines] of [["INVALID target form", invalid], ["edit:false site moved", moved], ["unknown spec entry", unknown]] as const)
    for (const line of lines) console.log(`${label}: ${line}`);
}

function batches(): void {
  const groups = loadGroups();
  const rows = batchRows(groups, coverageByGroup(groups, scanAll()));
  for (const row of rows) {
    const state = row.done ? "DONE" : row.missing === row.clauses ? "todo" : row.missing === 0 ? "covered" : "partial";
    console.log(
      `${row.batch.padEnd(40)} ${String(row.groups).padStart(3)} groups ${String(row.clauses).padStart(3)} clauses  ` +
        `pass ${row.covered} MISMATCH ${row.mismatch} unimplemented ${row.unimplemented} exempt ${row.exempt} missing ${row.missing}  [${state}]`
    );
  }
}

function existingPerCardTest(card: CardDefinition): string | undefined {
  const file = join(PER_CARD, `${slug(card.set)}.test.ts`);
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, "utf8").split("\n");
  const index = lines.findIndex((line) => line.includes(`describe("${card.set} — ${card.name}"`));
  return index === -1 ? undefined : `${relative(ROOT, file).replace(/\\/g, "/")}:${index + 1}`;
}

function engineSummary(card: CardDefinition): string[] {
  const lines: string[] = [];
  const abilities = [...(card.behavior?.abilities ?? []), ...(card.faction?.abilities ?? [])] as unknown as Array<Record<string, unknown>>;
  for (const ability of abilities) {
    const bits = [`id "${ability.id}"`, `${ability.type}`];
    if (ability.name) bits.push(`name "${ability.name}"`);
    if (ability.trigger) bits.push(`trigger ${JSON.stringify(ability.trigger)}`);
    if (ability.threshold) bits.push(`threshold "${ability.threshold}"`);
    if (ability.fromFaceDown) bits.push("fromFaceDown");
    const targets = ability.targets as Array<Record<string, unknown>> | undefined;
    if (targets?.length) bits.push(`targets ${targets.map((target) => `"${target.id}"`).join(", ")}`);
    const costs = ability.costs as Array<Record<string, unknown>> | undefined;
    if (costs?.length) bits.push(`costs ${costs.map((cost) => cost.type).join(", ")}`);
    lines.push(`  - ${bits.join(" · ")}`);
  }
  const extras: string[] = [];
  if (card.behavior?.keywords?.length) extras.push(`keywords ${JSON.stringify(card.behavior.keywords)}`);
  if (card.unique) extras.push(`unique "${card.unique}"`);
  if (card.attachTo) extras.push(`attachTo ${JSON.stringify(card.attachTo)}`);
  if (card.flipUp) extras.push(`flipUp ${JSON.stringify(card.flipUp)}`);
  if (card.resource) extras.push(`resource ${JSON.stringify(card.resource)}`);
  for (const key of ["selfDisposition", "revealFromHand", "thresholdSlack"] as const) {
    if ((card as unknown as Record<string, unknown>)[key] !== undefined) extras.push(`${key} ${JSON.stringify((card as unknown as Record<string, unknown>)[key])}`);
  }
  if (extras.length) lines.push(`  - ${extras.join(" · ")}`);
  if (card.faction) lines.push(`  - faction block present (setup / turn rules) — see \`show\``);
  return lines.length ? lines : ["  - (no behavior data)"];
}

function manifest(batch: string, options: { missing?: boolean; groups?: string } = {}): void {
  let groups = loadGroups().filter((group) => group.batch === batch);
  if (!groups.length) throw new Error(`No batch "${batch}" — see \`npm run card-tests -- batches\`.`);
  if (options.groups) {
    // 1-based inclusive range over the batch's groups, e.g. "1-8".
    const [from, to] = options.groups.split("-").map((n) => Number(n));
    groups = groups.slice((from ?? 1) - 1, to ?? from);
  }
  if (options.missing) {
    const status = coverageByGroup(loadGroups(), scanAll());
    groups = groups
      .map((group) => ({ ...group, clauses: group.clauses.filter((clause) => status.get(group.id)!.missing.includes(clause.key)) }))
      .filter((group) => group.clauses.length > 0);
  }
  if (!groups.length) {
    console.log(`${batch}: nothing ${options.missing ? "missing" : "selected"} in that range.`);
    return;
  }
  const fidelity = JSON.parse(readFileSync(join(ROOT, "data", "card-fidelity.json"), "utf8")) as {
    fidelity: Record<string, string>;
    notes: Record<string, string>;
  };
  const clauses = groups.reduce((sum, group) => sum + group.clauses.length, 0);
  console.log(`# Batch ${batch} — ${groups.length} rules groups, ${clauses} clauses`);
  console.log(`Test file: src/engine/__tests__/clauses/${batch}.test.ts · Findings: data/card-tests/findings/${batch}.md\n`);
  for (const group of groups) {
    const card = BY_ID.get(group.id)!;
    const stats = [
      `${card.type}`,
      card.trade,
      card.subtype.length ? `subtype ${card.subtype.join(", ")}` : "",
      card.type === "faction" ? "" : `cost ${card.cost}`,
      card.threshold ? `threshold "${card.threshold}"` : "",
      card.strength !== undefined ? `str ${card.strength} / spd ${card.speed} / life ${card.life}` : "",
      card.structure !== undefined ? `structure ${card.structure}` : ""
    ].filter(Boolean);
    console.log(`## ${group.name} — use printing "${group.id}"`);
    console.log(`- printings: ${group.printings.map((id) => `${id} (${BY_ID.get(id)!.set})`).join(", ")}`);
    console.log(`- ${stats.join(" · ")}`);
    const level = fidelity.fidelity[group.id] ?? "full";
    if (level !== "full") console.log(`- engine fidelity: **${level}** — ${fidelity.notes[group.id] ?? ""}`);
    const existing = existingPerCardTest(card);
    if (existing) console.log(`- existing per-card test (board-setup patterns): ${existing}`);
    if (card.markup) {
      console.log("- printed text (markup):");
      console.log("```");
      console.log(serializeCardText(parseCardText(card.markup), { pretty: true }));
      console.log("```");
      console.log(`- printed text (plain): ${cardTextToPlain(card.markup)}`);
    } else {
      console.log("- printed text: (none)");
    }
    console.log("- clauses to cover:");
    for (const clause of group.clauses) console.log(`  - \`${clause.key}\` — ${clause.text}`);
    console.log("- engine data (to DRIVE the engine only — never to decide expected outcomes):");
    for (const line of engineSummary(card)) console.log(line);
    console.log("");
  }
}

function show(id: string): void {
  const card = BY_ID.get(id);
  if (!card) throw new Error(`No printing ${id}`);
  console.log(JSON.stringify(card, null, 2));
}

function coverage(batch?: string): void {
  const groups = loadGroups();
  const refs = scanAll();
  const status = coverageByGroup(groups, refs);
  const issues = problems(groups, refs);
  const rows = batchRows(groups, status);
  const total = rows.reduce(
    (sum, row) => ({
      clauses: sum.clauses + row.clauses,
      covered: sum.covered + row.covered,
      mismatch: sum.mismatch + row.mismatch,
      unimplemented: sum.unimplemented + row.unimplemented,
      exempt: sum.exempt + row.exempt,
      missing: sum.missing + row.missing
    }),
    { clauses: 0, covered: 0, mismatch: 0, unimplemented: 0, exempt: 0, missing: 0 }
  );
  const accounted = total.covered + total.mismatch + total.unimplemented + total.exempt;

  const md: string[] = [
    "# Clause coverage progress",
    "",
    "**Generated by `npm run card-tests -- coverage` — do not hand-edit.** Plan and rules: docs/TESTING.md.",
    "",
    `**${accounted} / ${total.clauses} clauses accounted for** — ${total.covered} pass, **${total.mismatch} MISMATCH (broken card: engine ≠ printed text, failing test)**, ${total.unimplemented} unimplemented (stub/partial fidelity), ${total.exempt} exempt, ${total.missing} missing. ${rows.filter((row) => row.done).length} / ${rows.length} batches done.`,
    "",
    "| Batch | Groups | Clauses | Pass | Mismatch | Unimpl. | Exempt | Missing | Done |",
    "|---|--:|--:|--:|--:|--:|--:|--:|:-:|",
    ...rows.map(
      (row) =>
        `| ${row.batch} | ${row.groups} | ${row.clauses} | ${row.covered} | ${row.mismatch} | ${row.unimplemented} | ${row.exempt} | ${row.missing} | ${row.done ? "✓" : ""} |`
    ),
    ""
  ];
  if (issues.length) md.push("## Problems", "", ...issues.map((issue) => `- ${issue}`), "");
  // Only a full run rewrites progress.md: batch runs come from parallel agents and would fight over it.
  if (!batch) writeFileSync(PROGRESS, md.join("\n"));

  const scope = batch ? groups.filter((group) => group.batch === batch) : [];
  if (batch) {
    if (!scope.length) throw new Error(`No batch "${batch}"`);
    const row = rows.find((candidate) => candidate.batch === batch)!;
    console.log(`${batch}: ${row.clauses} clauses — pass ${row.covered}, MISMATCH ${row.mismatch}, unimplemented ${row.unimplemented}, exempt ${row.exempt}, missing ${row.missing}`);
    for (const group of scope) {
      const missing = status.get(group.id)!.missing;
      if (missing.length) console.log(`  missing: ${group.name} (${group.id}): ${missing.join(", ")}`);
    }
    const ids = new Set(scope.flatMap((group) => group.printings));
    const batchIssues = issues.filter((issue) => [...ids].some((id) => issue.includes(id)) || issueInBatch(issue, batch));
    for (const issue of batchIssues) console.log(`  PROBLEM ${issue}`);
  } else {
    console.log(
      `${accounted}/${total.clauses} clauses accounted for (pass ${total.covered}, MISMATCH ${total.mismatch}, unimplemented ${total.unimplemented}, exempt ${total.exempt}, missing ${total.missing}); ${issues.length} problems.`
    );
    for (const issue of issues) console.log(`  PROBLEM ${issue}`);
    console.log(`Wrote ${relative(ROOT, PROGRESS)}.`);
  }
}

function markDone(batch: string): void {
  const groups = loadGroups();
  const refs = scanAll();
  const status = coverageByGroup(groups, refs);
  const scope = groups.filter((group) => group.batch === batch);
  if (!scope.length) throw new Error(`No batch "${batch}"`);
  const missing = scope.flatMap((group) => status.get(group.id)!.missing.map((key) => `${group.name}: ${key}`));
  const ids = new Set(scope.flatMap((group) => group.printings));
  const issues = problems(groups, refs).filter((issue) => [...ids].some((id) => issue.includes(id)) || issueInBatch(issue, batch));
  if (missing.length || issues.length) {
    console.log(`${batch} is not complete:`);
    for (const line of [...missing, ...issues]) console.log(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  const done = new Set(loadDone());
  done.add(batch);
  writeFileSync(DONE, JSON.stringify([...done].sort(), null, 2) + "\n");
  console.log(`${batch} marked done.`);
}

function report(batch?: string): void {
  const files = batch ? batchFiles(batch) : testFiles();
  if (!files.length) throw new Error("No clause test files to run.");
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  const recorded: string[] = [];
  const fixed: string[] = [];
  const unrecorded: string[] = [];
  const unimplemented: string[] = [];
  let passed = 0;
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*(not ok|ok) \d+ - (.*?)(?: # (TODO|SKIP)(.*))?$/);
    if (!match) continue;
    const [, verdict, name, directive] = match;
    if (directive === "TODO") unimplemented.push(name!);
    else if (/ — MISMATCH \S+$/.test(name!)) (verdict === "ok" ? fixed : recorded).push(name!);
    else if (verdict === "not ok") unrecorded.push(name!);
    else passed++;
  }
  const list = (title: string, names: string[]) => {
    console.log(`${title}: ${names.length}`);
    for (const name of names) console.log(`  - ${name}`);
  };
  console.log(`Passing clause tests: ${passed}`);
  list("BROKEN CARDS — failing, written up (engine ≠ printed text)", recorded);
  list("FAILING WITHOUT A WRITE-UP — triage: broken card or broken test?", unrecorded);
  list("Mismatch tests now PASSING — card fixed? close the finding and drop the marker", fixed);
  list("Unimplemented (stub/partial fidelity, todo)", unimplemented);
  if (recorded.length || unrecorded.length) process.exitCode = 1;
}

interface MutationRun {
  failing: Set<string>;
  /** The mutation itself threw (wrong JSON path, unknown card): it never applied. */
  error?: string;
  /** The run timed out: the mutation made the engine hang (counts as detected). */
  hung?: boolean;
}

function runTests(file: string, mutation?: string): MutationRun {
  const register = join(ROOT, "scripts", "card-tests", "mutation", "register.mjs");
  const result = spawnSync(
    process.execPath,
    // Run the file directly (no `--test`), so the tests run in this ONE process and a timeout
    // kills everything (on Windows `--test`'s child processes outlive a killed parent).
    ["--import", "tsx", ...(mutation ? ["--import", `file:///${register.replace(/\\/g, "/")}`] : []), "--test-reporter=tap", file],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: mutation ? 180_000 : 0, env: { ...process.env, MUT: mutation ?? "" } }
  );
  const failing = new Set<string>();
  if (mutation && result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return { failing, hung: true };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const mutationError = output.match(/MUTATION_ERROR: ([^\n`]*)/);
  if (mutation && mutationError) return { failing, error: mutationError[1]!.trim() };
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*not ok \d+ - (.*?)(?: # (TODO|SKIP).*)?$/);
    if (match && !match[2]) failing.add(match[1]!);
  }
  // Anything else that stops the file loading under a mutation is reported, not counted as detection.
  if (mutation && result.status !== 0 && failing.size === 0) {
    return { failing, error: `file failed to run: ${(result.stderr ?? "").split("\n").find((l) => l.trim()) ?? "?"}` };
  }
  return { failing };
}

function mutate(batch: string | undefined, listFile: string | undefined, part?: string): void {
  if (!batch || !listFile) throw new Error("usage: mutate --batch <b> [--part <p>] --file <mutations.txt>");
  // --part runs only that part's file, so other agents' in-progress parts of the same batch can't add noise.
  const files = part ? batchFiles(batch).filter((file) => file.endsWith(`${batch}.${part}.test.ts`)) : batchFiles(batch);
  if (!files.length) throw new Error(`No test file for ${batch}`);
  const runAll = (mutation?: string): MutationRun => {
    const merged: MutationRun = { failing: new Set() };
    for (const file of files) {
      const run = runTests(file, mutation);
      if (run.error) return run;
      if (run.hung) return run;
      for (const name of run.failing) merged.failing.add(name);
    }
    return merged;
  };
  const baseline = runAll().failing;
  console.log(`baseline: ${baseline.size} failing tests (recorded mismatches)`);
  const tally = { detected: 0, survived: 0, errors: 0, fixesMismatch: 0 };
  for (const line of readFileSync(listFile, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [label, code] = line.includes("|||") ? [line.slice(0, line.indexOf("|||")), line.slice(line.indexOf("|||") + 3)] : [line, line];
    const run = runAll(code);
    if (run.error) {
      tally.errors++;
      console.log(`   ERROR     ${label.trim()}  -- the mutation didn't apply: ${run.error.slice(0, 140)}`);
      continue;
    }
    if (run.hung) {
      tally.detected++;
      console.log(`   detected  ${label.trim()}  (the engine hung)`);
      continue;
    }
    const fresh = [...run.failing].filter((name) => !baseline.has(name));
    const nowPassing = [...baseline].filter((name) => !run.failing.has(name));
    if (fresh.length > 0) {
      tally.detected++;
      console.log(`${String(fresh.length).padStart(4)} new failing  ${label.trim()}`);
      if (fresh.length <= 2) for (const name of fresh) console.log(`        -> ${name.slice(0, 160)}`);
    } else if (nowPassing.length > 0) {
      // Not a test gap: the mutation moved the data toward the printed card and turned recorded mismatch tests green.
      tally.fixesMismatch++;
      console.log(`   FIXES ${nowPassing.length} recorded mismatch test(s)  ${label.trim()}  (not a gap)`);
    } else {
      tally.survived++;
      console.log(`   SURVIVED  ${label.trim()}`);
    }
  }
  console.log(
    `${tally.detected} detected, ${tally.survived} SURVIVED (a test is missing), ${tally.fixesMismatch} fix a recorded mismatch, ${tally.errors} didn't apply (fix the mutation).`
  );
}

/**
 * Splits a batch's still-uncovered clauses into agent-sized parts (`--size`
 * clauses each, default 14; a group is never split), as group ranges for
 * `manifest <batch> --groups a-b --missing`.
 */
function parts(batch: string | undefined, size: number): void {
  if (!batch) throw new Error("usage: parts <batch> [--size 14]");
  const groups = loadGroups().filter((group) => group.batch === batch);
  if (!groups.length) throw new Error(`No batch "${batch}"`);
  const status = coverageByGroup(loadGroups(), scanAll());
  const out: Array<{ from: number; to: number; clauses: number }> = [];
  groups.forEach((group, index) => {
    const missing = status.get(group.id)!.missing.length;
    if (!missing) return;
    const last = out[out.length - 1];
    if (last && last.clauses + missing <= size) {
      last.to = index + 1;
      last.clauses += missing;
    } else {
      out.push({ from: index + 1, to: index + 1, clauses: missing });
    }
  });
  if (!out.length) console.log(`${batch}: nothing missing.`);
  out.forEach((part, i) => console.log(`p${i + 1}  --groups ${part.from}-${part.to}  (${part.clauses} clauses)`));
}


interface Finding {
  id: string;
  title: string;
  file: string;
  category: string;
  sys: string[];
  status: "open" | "fixed" | "parked" | "withdrawn";
  tests: number;
}

const FINDING_HEADING = /^#{2,4} ([a-z0-9-]+-[0-9]+) [—-] (.*)$/;
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const quotedId = (id: string, flags = "") => new RegExp(`["'\`]${escapeRe(id)}["'\`]`, flags);

/** Every finding block in data/card-tests/findings/*.md, with the number of clause tests that cite it. */
function loadFindings(): Finding[] {
  const sources = testFiles().map((file) => readFileSync(file, "utf8"));
  const out: Finding[] = [];
  for (const name of readdirSync(FINDINGS).filter((n) => n.endsWith(".md")).sort()) {
    const text = readFileSync(join(FINDINGS, name), "utf8");
    for (const block of text.split(/\n(?=#{2,4} [a-z0-9-]+-[0-9]+ )/)) {
      const heading = block.trim().split(/\r?\n/)[0]!.trimEnd();
      const match = heading.match(FINDING_HEADING);
      if (!match) continue;
      const id = match[1]!;
      const category = (block.match(/Category:\s*\**\s*([a-z-]+)/i)?.[1] ?? "?").toLowerCase();
      const sys = [...new Set(block.match(/SYS-\d+/g) ?? [])];
      const status = /WITHDRAWN/.test(heading)
        ? "withdrawn"
        : / — FIXED /.test(heading)
          ? "fixed"
          : / — PARKED /.test(heading)
            ? "parked"
            : "open";
      const tests = sources.reduce((n, src) => n + (src.match(quotedId(id, "g"))?.length ?? 0), 0);
      out.push({ id, title: match[2]!, file: name, category, sys, status, tests });
    }
  }
  return out;
}

function findings(options: { sys?: string; category?: string; batch?: string; open?: boolean; fixed?: boolean; card?: string }): void {
  let list = loadFindings();
  if (options.sys) list = list.filter((f) => f.sys.includes(`SYS-${options.sys!.replace(/^SYS-/i, "")}`));
  if (options.category) list = list.filter((f) => f.category === options.category);
  if (options.batch) list = list.filter((f) => f.file === `${options.batch}.md` || f.file.startsWith(`${options.batch}.`));
  if (options.open) list = list.filter((f) => f.status === "open");
  if (options.fixed) list = list.filter((f) => f.status === "fixed");
  if (options.card) list = list.filter((f) => f.title.toLowerCase().includes(options.card!.toLowerCase()));
  for (const f of list) console.log(`${f.id}  [${f.category}]  ${f.status}  tests:${f.tests}  ${f.sys.join(",")}  — ${f.title}`);
  const by = (key: (f: Finding) => string) =>
    Object.entries(list.reduce<Record<string, number>>((acc, f) => ((acc[key(f)] = (acc[key(f)] ?? 0) + 1), acc), {}))
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  console.log(`\n${list.length} findings — status: ${by((f) => f.status)} — category: ${by((f) => f.category)}`);
}

/** Runs clause test files and returns each test's verdict by name. */
function verdicts(files: string[]): Map<string, boolean> {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  const out = new Map<string, boolean>();
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*(not ok|ok) \d+ - (.*?)(?: # (TODO|SKIP).*)?$/);
    if (match) out.set(match[2]!, match[1] === "ok");
  }
  return out;
}

/** Turns `clauseMismatch(ID, KEYS, "<fid>", TITLE, fn)` into `clause(ID, KEYS, TITLE, fn)`; drops an unused import. */
function unmarkMismatch(source: string, findingId: string): { text: string; count: number } {
  const arg = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[A-Za-z_$][\w$.]*)`;
  const re = new RegExp(String.raw`clauseMismatch\(\s*(${arg})\s*,\s*(${arg})\s*,\s*["'` + "`" + String.raw`]${escapeRe(findingId)}["'` + "`" + String.raw`]\s*,`, "g");
  let count = 0;
  let text = source.replace(re, (_all, id: string, keys: string) => {
    count++;
    return `clause(${id}, ${keys},`;
  });
  if (count && !/clauseMismatch\(/.test(text)) {
    text = text.replace(/(import\s*\{[^}]*?)\bclauseMismatch\s*,\s*/, "$1").replace(/(import\s*\{[^}]*?),\s*clauseMismatch\b/, "$1");
  }
  return { text, count };
}

function markFindingFixed(f: Finding, note: string): void {
  const path = join(FINDINGS, f.file);
  const text = readFileSync(path, "utf8");
  const date = new Date().toISOString().slice(0, 10);
  const re = new RegExp(`^(#{2,4} ${escapeRe(f.id)} [—-] [^\r\n]*)`, "m");
  writeFileSync(path, text.replace(re, `$1 — FIXED ${date}${note ? `: ${note}` : ""}`));
}

/**
 * Closes fixed findings: every clause test citing the finding must now pass. Then its `clauseMismatch` calls become
 * `clause`, and the finding heading gets "— FIXED <date>: <note>". `--all-fixed` runs the whole clause suite and
 * closes every open finding whose tests all pass.
 */
function close(ids: string[], options: { note?: string; allFixed?: boolean }): void {
  const all = loadFindings();
  const byId = new Map(all.map((f) => [f.id, f]));
  const files = testFiles();
  const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const citing = (id: string) => files.filter((file) => quotedId(id).test(sources.get(file)!));
  const runFiles = options.allFixed ? files : [...new Set(ids.flatMap(citing))];
  if (!runFiles.length) throw new Error("No clause test cites those finding ids.");
  const verdict = verdicts(runFiles);
  const mismatchTests = (id: string) => [...verdict.entries()].filter(([name]) => name.endsWith(` — MISMATCH ${id}`));
  let targets = ids;
  if (options.allFixed) {
    targets = all
      .filter((f) => f.status === "open")
      .map((f) => f.id)
      .filter((id) => {
        const tests = mismatchTests(id);
        return tests.length > 0 && tests.every(([, ok]) => ok);
      });
    if (!targets.length) {
      console.log("No open finding has all of its tests passing.");
      return;
    }
  }
  const closed: string[] = [];
  for (const id of targets) {
    const f = byId.get(id);
    if (!f) {
      console.log(`SKIP ${id}: no such finding`);
      continue;
    }
    if (f.status !== "open") {
      console.log(`SKIP ${id}: already ${f.status}`);
      continue;
    }
    const tests = mismatchTests(id);
    if (!tests.length) {
      console.log(`SKIP ${id}: no MISMATCH test cites it`);
      continue;
    }
    const failing = tests.filter(([, ok]) => !ok).map(([name]) => name);
    if (failing.length) {
      console.log(`REFUSED ${id}: ${failing.length} of ${tests.length} test(s) still fail:\n  - ${failing.join("\n  - ")}`);
      continue;
    }
    let converted = 0;
    for (const file of citing(id)) {
      // Re-read right before writing: another lane may have edited this test file since the run started.
      const { text, count } = unmarkMismatch(readFileSync(file, "utf8"), id);
      if (count) {
        sources.set(file, text);
        writeFileSync(file, text);
        converted += count;
      }
    }
    if (converted !== tests.length) console.log(`WARN ${id}: ${tests.length} passing test(s) but ${converted} call(s) converted; check by hand`);
    markFindingFixed(f, options.note ?? "");
    closed.push(id);
    console.log(`FIXED ${id} (${converted} test(s) → clause)`);
  }
  console.log(`\nClosed ${closed.length} finding(s). Now run: npm run typecheck && npm run card-tests -- report`);
}


/**
 * Scoreboard: how many cards play exactly as printed, how many clauses are still broken,
 * and the findings ledger. Static (no test run), so it's instant; `report` is the runtime check.
 */
function status(): void {
  const groups = loadGroups();
  const byGroup = coverageByGroup(groups, scanAll());
  let cardsOk = 0;
  let cardsBroken = 0;
  let cardsUnsupported = 0;
  let printingsOk = 0;
  let printingsTotal = 0;
  let clausesOk = 0;
  let clausesBroken = 0;
  let clausesOther = 0;
  for (const group of groups) {
    const st = byGroup.get(group.id)!;
    const n = group.printings.length;
    printingsTotal += n;
    clausesOk += st.covered;
    clausesBroken += st.mismatch;
    clausesOther += st.unimplemented + st.exempt + st.missing.length;
    if (st.mismatch > 0 || st.missing.length) cardsBroken++;
    else if (st.unimplemented > 0) cardsUnsupported++;
    else {
      cardsOk++;
      printingsOk += n;
    }
  }
  const all = loadFindings();
  const count = (pred: (f: Finding) => boolean) => all.filter(pred).length;
  const pct = (a: number, b: number) => `${b ? Math.round((1000 * a) / b) / 10 : 0}%`;
  const open = all.filter((f) => f.status === "open");
  const openBy = (c: string) => open.filter((f) => f.category === c).length;
  console.log(`Cards (rules groups) working exactly as printed: ${cardsOk} / ${groups.length} (${pct(cardsOk, groups.length)})`);
  console.log(`  printings: ${printingsOk} / ${printingsTotal}; cards with a broken clause: ${cardsBroken}; known-unsupported: ${cardsUnsupported}`);
  console.log(`Clauses passing: ${clausesOk} / ${clausesOk + clausesBroken + clausesOther} (${pct(clausesOk, clausesOk + clausesBroken + clausesOther)}); broken: ${clausesBroken}`);
  console.log(
    `Findings: fixed ${count((f) => f.status === "fixed")}, open ${open.length} ` +
      `(engine ${openBy("engine")}, data ${openBy("data")}, rules-question ${openBy("rules-question")}, unimplemented ${openBy("unimplemented")}), ` +
      `parked ${count((f) => f.status === "parked")}, withdrawn ${count((f) => f.status === "withdrawn")}`
  );
}

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
switch (command) {
  case "build":
    build();
    break;
  case "mp-inventory":
    mpInventory();
    break;
  case "mp-mutate":
    void mpMutate({ set: flag("--set"), jobs: Number(flag("--jobs") ?? 10), list: args.includes("--list"), out: flag("--out"), card: flag("--card"), gapsFrom: flag("--gaps-from") });
    break;
  case "mp-worklist":
    mpWorklist();
    break;
  case "batches":
    batches();
    break;
  case "manifest":
    manifest(args[0] ?? "", { missing: args.includes("--missing"), groups: flag("--groups") });
    break;
  case "show":
    show(args[0] ?? "");
    break;
  case "coverage":
    coverage(flag("--batch"));
    break;
  case "mark-done":
    markDone(args[0] ?? "");
    break;
  case "report":
    report(flag("--batch"));
    break;
  case "mutate":
    mutate(flag("--batch"), flag("--file"), flag("--part"));
    break;
  case "parts":
    parts(args[0], Number(flag("--size") ?? 14));
    break;
  case "status":
    status();
    break;
  case "findings":
    findings({
      sys: flag("--sys"),
      category: flag("--category"),
      batch: flag("--batch"),
      open: args.includes("--open"),
      fixed: args.includes("--fixed"),
      card: flag("--card")
    });
    break;
  case "close": {
    const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--note");
    close(ids, { note: flag("--note"), allFixed: args.includes("--all-fixed") });
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 34).join("\n"));
}
