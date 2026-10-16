// card-audit CLI — compares every printing in data/cards.json against its
// card image (data/assets/<id>.jpg). Workflow and conventions:
// CARD-AUDIT-PROGRESS.md.
//
//   npm run card-audit -- batches                 list scan batches and their status
//   npm run card-audit -- manifest <batch>        print a batch's printings for a scanner
//   npm run card-audit -- check [--batch <b>]     validate scan files, list every mismatch, then run progress
//   npm run card-audit -- progress                regenerate CARD-AUDIT-PROGRESS.md tables + data/card-audit/findings.md
//   npm run card-audit -- apply-flavor            copy subtitle/flavor from finished batches onto cards.json, then sync-cards
//   npm run card-audit -- build-text [--all]      write each printing's printed rules text to corrections.json, regenerate markup
//                                                 for changed entries (--all: every corrected printing, e.g. after an override edit)
//   npm run card-audit -- sample <batch>          print a finished batch's verification sample for a second, independent reader
//   npm run card-audit -- check --verify <batch>  validate a verification file and list where it disagrees with the scan
//
// A scanner writes data/card-audit/scans/<batch>.json; nothing else writes
// there, so parallel scanners never touch the same file.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CardDefinition } from "../../src/types/index.js";
import { buildContext, convertCard, loadMarkupOverrides, overrideFor, type TextCorrection } from "../card-markup/convert.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARDS_PATH = join(ROOT, "data", "cards.json");
const AUDIT_DIR = join(ROOT, "data", "card-audit");
const BATCHES_PATH = join(AUDIT_DIR, "batches.json");
const SCANS_DIR = join(AUDIT_DIR, "scans");
/** Second, independent readings of a sample of each finished batch (phase 2). */
const VERIFY_DIR = join(AUDIT_DIR, "verify");
const SAMPLE_SIZE = 5;
const FINDINGS_PATH = join(AUDIT_DIR, "findings.md");
const PROGRESS_PATH = join(ROOT, "CARD-AUDIT-PROGRESS.md");
const CORRECTIONS_PATH = join(AUDIT_DIR, "corrections.json");
/** Printings whose image file shows another printing or card (id → note); their scans don't describe them. */
const IMAGE_PROBLEMS_PATH = join(AUDIT_DIR, "image-problems.json");
const MARKUP_REVIEW_PATH = join(AUDIT_DIR, "markup-review.md");

const SET_ORDER = [
  "Open Beta",
  "1st Edition",
  "1st Edition Part 2",
  "Shade of the Devoured Emperor",
  "Seed",
  "Seed 2",
  "Seed 3",
  "2nd Edition",
  "Holy Heist",
  "Ungodly Mess",
  "Seed Saga"
];
const BATCH_SIZE = 50;

/** Release order, oldest first, from the copyright years printed on the cards (2006 → 2015). Ties keep this order. */
const RELEASE_ORDER = [
  "Open Beta",
  "1st Edition",
  "1st Edition Part 2",
  "Seed",
  "Seed 2",
  "2nd Edition",
  "Seed 3",
  "Shade of the Devoured Emperor",
  "Holy Heist",
  "Ungodly Mess",
  "Seed Saga"
];

const slug = (set: string) => set.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

interface Batch {
  id: string;
  set: string;
  ids: string[];
}

const RULES_MATCH = ["same", "wording", "different", "unreadable"] as const;

/** One printing as read off its card image. See CARD-AUDIT-PROGRESS.md "Scan record". */
interface Scan {
  id: string;
  name: string;
  subtitle: string | null;
  cost: number | null;
  threshold: string;
  strength: number | null;
  speed: number | null;
  life: number | null;
  structure: number | null;
  influence: number | null;
  typeLine: string;
  rules: string;
  flavor: string | null;
  artist: string | null;
  rarity: string | null;
  collector: string | null;
  copyright: string | null;
  printing: string | null;
  rulesMatch: (typeof RULES_MATCH)[number];
  notes: string;
}

const SCAN_FIELDS: Record<keyof Scan, "string" | "string?" | "number?" | "match"> = {
  id: "string",
  name: "string",
  subtitle: "string?",
  cost: "number?",
  threshold: "string",
  strength: "number?",
  speed: "number?",
  life: "number?",
  structure: "number?",
  influence: "number?",
  typeLine: "string",
  rules: "string",
  flavor: "string?",
  artist: "string?",
  rarity: "string?",
  collector: "string?",
  copyright: "string?",
  printing: "string?",
  rulesMatch: "match",
  notes: "string"
};

function writeAtomic(path: string, content: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function loadCards(): CardDefinition[] {
  return JSON.parse(readFileSync(CARDS_PATH, "utf8"));
}

/** Batches are fixed once written: per set, ordered by trade then name, split evenly into chunks of at most BATCH_SIZE. */
function loadBatches(cards: CardDefinition[]): Batch[] {
  if (existsSync(BATCHES_PATH)) return JSON.parse(readFileSync(BATCHES_PATH, "utf8"));
  const batches: Batch[] = [];
  for (const set of SET_ORDER) {
    const printings = cards
      .filter((card) => card.set === set)
      .sort((a, b) => a.trade.toLowerCase().localeCompare(b.trade.toLowerCase()) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const chunks = Math.ceil(printings.length / BATCH_SIZE);
    const size = Math.ceil(printings.length / chunks);
    for (let i = 0; i < chunks; i++) {
      batches.push({
        id: `${slug(set)}-${String(i + 1).padStart(2, "0")}`,
        set,
        ids: printings.slice(i * size, (i + 1) * size).map((card) => card.id)
      });
    }
  }
  const covered = new Set(batches.flatMap((batch) => batch.ids));
  const stray = cards.filter((card) => !covered.has(card.id));
  if (stray.length) throw new Error(`Printings in no batch (set missing from SET_ORDER?): ${stray.map((c) => `${c.name} (${c.set})`).join(", ")}`);
  writeAtomic(BATCHES_PATH, JSON.stringify(batches, null, 2) + "\n");
  return batches;
}

function scanPath(batchId: string): string {
  return join(SCANS_DIR, `${batchId}.json`);
}

function findBatch(batches: Batch[], id: string | undefined): Batch {
  const batch = batches.find((candidate) => candidate.id === id);
  if (!batch) throw new Error(`Unknown batch "${id}". Run \`batches\` for the list.`);
  return batch;
}

// -----------------------------------------------------------------------------
// Validation and comparison
// -----------------------------------------------------------------------------

interface BatchResult {
  batch: Batch;
  scanned: number;
  errors: string[];
  scans: Scan[];
}

function validateBatch(batch: Batch, dir = SCANS_DIR, ids = batch.ids): BatchResult {
  const path = join(dir, `${batch.id}.json`);
  const result: BatchResult = { batch, scanned: 0, errors: [], scans: [] };
  if (!existsSync(path)) return result;
  let records: unknown;
  try {
    records = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    result.errors.push(`not valid JSON: ${(error as Error).message}`);
    return result;
  }
  if (!Array.isArray(records)) {
    result.errors.push("must be a JSON array of scan records");
    return result;
  }
  const wanted = new Set(ids);
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const errorsBefore = result.errors.length;
    const where = `record ${index}${record && typeof record.id === "string" ? ` (${record.id})` : ""}`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      result.errors.push(`${where}: not an object`);
      return;
    }
    for (const key of Object.keys(record)) {
      if (!(key in SCAN_FIELDS)) result.errors.push(`${where}: unknown field "${key}"`);
    }
    for (const [key, kind] of Object.entries(SCAN_FIELDS)) {
      const value = (record as Record<string, unknown>)[key];
      const ok =
        kind === "string"
          ? typeof value === "string"
          : kind === "string?"
            ? value === null || (typeof value === "string" && value.trim() !== "")
            : kind === "number?"
              ? value === null || (typeof value === "number" && Number.isInteger(value))
              : RULES_MATCH.includes(value as Scan["rulesMatch"]);
      if (!ok) result.errors.push(`${where}: "${key}" must be ${kind === "match" ? RULES_MATCH.join(" | ") : kind.replace("?", " or null (no empty strings)")}`);
    }
    const scan = record as Scan;
    if (typeof scan.threshold === "string" && !/^[gredov]*$/.test(scan.threshold)) result.errors.push(`${where}: threshold must be lowercase letters from g r e d o v`);
    if ((scan.rulesMatch === "different" || scan.rulesMatch === "unreadable") && !scan.notes?.trim()) {
      result.errors.push(`${where}: rulesMatch "${scan.rulesMatch}" needs notes explaining it`);
    }
    if (!wanted.has(scan.id)) result.errors.push(`${where}: id is not one of the printings expected in this file`);
    else if (seen.has(scan.id)) result.errors.push(`${where}: id appears twice`);
    if (result.errors.length > errorsBefore) return;
    seen.add(scan.id);
    result.scans.push(scan);
  });
  result.scanned = seen.size;
  return result;
}

const norm = (value: string) => value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const sortedLetters = (value: string | number) => (typeof value === "string" ? value.toLowerCase().split("").sort().join("") : "");

/** Mechanical differences between a scan and its catalog entry (everything except rules text, which the scanner judges). */
function fieldDiffs(card: CardDefinition, scan: Scan): string[] {
  const diffs: string[] = [];
  const numbers: Array<[string, number | undefined, number | null]> = [
    ["cost", card.type === "faction" || card.type === "resource" ? undefined : card.cost, scan.cost],
    ["strength", card.strength, scan.strength],
    ["speed", card.speed, scan.speed],
    ["life", card.life, scan.life],
    ["structure", card.structure, scan.structure],
    ["influence", card.faction?.startingInfluence, scan.influence]
  ];
  if (norm(card.name) !== norm(scan.name)) diffs.push(`name: catalog "${card.name}", card "${scan.name}"`);
  if (card.type === "item" && [scan.strength, scan.speed, scan.life].some((value) => value !== null)) {
    diffs.push(`item badges: str ${scan.strength ?? "-"} / spd ${scan.speed ?? "-"} / life ${scan.life ?? "-"} (attach modifiers: check behavior)`);
  }
  for (const [field, stored, printed] of numbers) {
    if (field === "cost" && stored === 0 && printed === null) continue;
    if (card.type === "item" && (field === "strength" || field === "speed" || field === "life")) continue;
    if ((stored ?? null) !== printed) diffs.push(`${field}: catalog ${stored ?? "none"}, card ${printed ?? "none"}`);
  }
  if (sortedLetters(card.threshold) !== sortedLetters(scan.threshold)) diffs.push(`threshold: catalog "${card.threshold}", card "${scan.threshold}"`);
  const rarity = norm(card.rarity).replace(/-/g, " ");
  if (scan.rarity !== null && !(rarity === "" && ["token", "staple"].includes(norm(scan.rarity))) && rarity !== norm(scan.rarity).replace(/-/g, " ")) diffs.push(`rarity: catalog "${card.rarity}", card "${scan.rarity}"`);
  const [head, ...tail] = scan.typeLine.split(/\s+[–—-]\s+/);
  const printedSubtypes = norm(tail.join(" "));
  if (printedSubtypes.split(/\s*,\s*/).filter(Boolean).join(",") !== card.subtype.map(norm).join(",")) {
    diffs.push(`subtype: catalog [${card.subtype.join(", ")}], card "${printedSubtypes}"`);
  }
  const words = norm(head).split(" ");
  if (card.type !== "faction" && !(card.type === "resource" && !scan.typeLine.trim()) && !words.includes(card.type)) diffs.push(`type: catalog ${card.type}, card "${head}"`);
  if (card.type !== "faction" && card.type !== "resource" && !words.includes(card.trade.toLowerCase())) diffs.push(`trade: catalog ${card.trade}, card "${head}"`);
  return diffs;
}

/** The batch's verification sample: SAMPLE_SIZE printings picked by id hash, skipping manual-review placeholders. */
function sampleIds(batch: Batch, scans: Scan[]): string[] {
  const manual = new Set(scans.filter(isManualReview).map((scan) => scan.id));
  const hash = (id: string) => createHash("sha1").update(`${batch.id}:${id}`).digest("hex");
  return batch.ids
    .filter((id) => !manual.has(id))
    .sort((a, b) => hash(a).localeCompare(hash(b)))
    .slice(0, SAMPLE_SIZE);
}

/** Words only: case, punctuation, separators and dash/quote styles never count as a disagreement. */
const loose = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9\[\]]+/g, " ").trim();

/** Fields where two independent readings of the same image disagree. */
function compareScans(first: Scan, second: Scan): string[] {
  const out: string[] = [];
  for (const field of ["name", "subtitle", "typeLine", "rules", "flavor", "artist", "rarity", "collector"] as const) {
    if (loose(first[field]) !== loose(second[field])) out.push(`${field}: scan "${first[field] ?? ""}" / verify "${second[field] ?? ""}"`);
  }
  for (const field of ["cost", "strength", "speed", "life", "structure", "influence"] as const) {
    if (first[field] !== second[field]) out.push(`${field}: scan ${first[field]} / verify ${second[field]}`);
  }
  if (sortedLetters(first.threshold) !== sortedLetters(second.threshold)) out.push(`threshold: scan "${first.threshold}" / verify "${second.threshold}"`);
  const severity = (match: Scan["rulesMatch"]) => (match === "same" || match === "wording" ? "ok" : match);
  if (severity(first.rulesMatch) !== severity(second.rulesMatch)) out.push(`rulesMatch: scan ${first.rulesMatch} / verify ${second.rulesMatch}`);
  return out;
}

interface Verification {
  batch: Batch;
  errors: string[];
  checked: number;
  disagreements: Array<{ id: string; name: string; fields: string[] }>;
}

function verifyBatch(batch: Batch, scans: Scan[]): Verification | null {
  if (!existsSync(join(VERIFY_DIR, `${batch.id}.json`))) return null;
  const result = validateBatch(batch, VERIFY_DIR, sampleIds(batch, scans));
  const byId = new Map(scans.map((scan) => [scan.id, scan]));
  const disagreements = result.scans.flatMap((second) => {
    const first = byId.get(second.id);
    const fields = first ? compareScans(first, second) : ["no scan record to compare with"];
    return fields.length ? [{ id: second.id, name: second.name, fields }] : [];
  });
  return { batch, errors: result.errors, checked: result.scanned, disagreements };
}

/** A placeholder for a card no scanner could process (content filter); a human reads the image instead. */
const isManualReview = (scan: Scan) => scan.notes.startsWith("MANUAL REVIEW");

interface Finding {
  card: CardDefinition;
  scan: Scan;
  diffs: string[];
}

function collect(cards: CardDefinition[], batches: Batch[]) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const results = batches.map((batch) => validateBatch(batch));
  const findings: Finding[] = [];
  for (const result of results) {
    for (const scan of result.scans) {
      const card = byId.get(scan.id);
      if (card) findings.push({ card, scan, diffs: isManualReview(scan) ? [] : fieldDiffs(card, scan) });
    }
  }
  return { results, findings };
}

/** Collector numbers per set: which of 1..N are missing, which appear on more than one printing. */
function collectorCoverage(findings: Finding[]) {
  const bySet = new Map<string, { totals: Set<string>; numbers: Map<number, string[]>; unnumbered: string[] }>();
  for (const { card, scan } of findings) {
    const entry = bySet.get(card.set) ?? { totals: new Set(), numbers: new Map(), unnumbered: [] };
    bySet.set(card.set, entry);
    const match = scan.collector?.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) {
      entry.unnumbered.push(`${card.name}${scan.collector ? ` "${scan.collector}"` : ""}`);
      continue;
    }
    entry.totals.add(match[2]);
    const number = Number(match[1]);
    entry.numbers.set(number, [...(entry.numbers.get(number) ?? []), card.name]);
  }
  return bySet;
}

/** A finding that needs a look: rules not same/wording, or a field diff other than item badges. */
const isFlagged = ({ scan, diffs }: Finding) =>
  scan.rulesMatch === "different" || scan.rulesMatch === "unreadable" || diffs.some((diff) => !diff.startsWith("item badges"));

/**
 * Every flagged name with all its scanned printings in release order. Each
 * printing plays as its own card says, so every flagged printing needs its
 * own fix; the unflagged printings show what the catalog text matches.
 */
function triageLines(findings: Finding[]): string[] {
  const byName = new Map<string, Finding[]>();
  for (const finding of findings) byName.set(finding.card.name, [...(byName.get(finding.card.name) ?? []), finding]);
  const flaggedNames = [...byName].filter(([, printings]) => printings.some(isFlagged)).sort((a, b) => a[0].localeCompare(b[0]));
  const lines = [
    `## Triage by name (${flaggedNames.length} names, ${findings.filter(isFlagged).length} flagged printings)`,
    "",
    "Every printing plays as printed on its own card, so each `!!` printing needs its own fix.",
    ""
  ];
  for (const [name, printings] of flaggedNames) {
    lines.push(`- **${name}**`);
    for (const finding of [...printings].sort((a, b) => RELEASE_ORDER.indexOf(a.card.set) - RELEASE_ORDER.indexOf(b.card.set))) {
      const fields = finding.diffs.filter((diff) => !diff.startsWith("item badges"));
      lines.push(`  - ${isFlagged(finding) ? "!! " : ""}${finding.card.set} \`${finding.card.id}\`: ${finding.scan.rulesMatch}${fields.length ? `; ${fields.join("; ")}` : ""}`);
      if (finding.scan.rulesMatch === "different" || finding.scan.rulesMatch === "unreadable") lines.push(`    - ${finding.scan.notes}`);
    }
  }
  lines.push("");
  return lines;
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

function cmdBatches(cards: CardDefinition[]): void {
  for (const result of loadBatches(cards).map((batch) => validateBatch(batch))) {
    const status = !existsSync(scanPath(result.batch.id))
      ? "todo"
      : result.errors.length
        ? `${result.errors.length} errors`
        : result.scanned === result.batch.ids.length
          ? "done"
          : `partial ${result.scanned}/${result.batch.ids.length}`;
    console.log(`${result.batch.id.padEnd(36)} ${String(result.batch.ids.length).padStart(3)}  ${status}`);
  }
}

function cmdManifest(cards: CardDefinition[], batchId: string | undefined, sample = false): void {
  const batch = findBatch(loadBatches(cards), batchId);
  const byId = new Map(cards.map((card) => [card.id, card]));
  let ids = batch.ids;
  if (sample) {
    const result = validateBatch(batch);
    if (result.errors.length || result.scanned !== batch.ids.length) throw new Error(`${batch.id} is not finished scanning yet`);
    ids = sampleIds(batch, result.scans);
    console.log(`Verification sample for ${batch.id}: ${ids.length} printings from ${batch.set}. Write data/card-audit/verify/${batch.id}.json.\n`);
  } else {
    console.log(`Batch ${batch.id}: ${batch.ids.length} printings from ${batch.set}. Write data/card-audit/scans/${batch.id}.json.\n`);
  }
  ids.forEach((id, index) => {
    const card = byId.get(id)!;
    const stats = [
      card.type === "faction" || card.type === "resource" ? null : `cost ${card.cost}`,
      card.threshold ? `threshold "${card.threshold}"` : null,
      card.strength !== undefined ? `str ${card.strength} / spd ${card.speed} / life ${card.life}` : null,
      card.structure !== undefined ? `structure ${card.structure}` : null,
      card.faction ? `influence ${card.faction.startingInfluence}` : null
    ].filter(Boolean);
    console.log(`#${index + 1} ${card.name}`);
    console.log(`  id: ${id}`);
    console.log(`  image: data/assets/${id}.jpg`);
    console.log(`  catalog: ${card.trade} ${card.type}${card.subtype.length ? ` – ${card.subtype.join(", ")}` : ""}; rarity "${card.rarity}"; ${stats.join("; ")}`);
    console.log(`  catalog text: ${card.text || "(none)"}`);
    console.log("");
  });
}

function cmdCheckVerify(cards: CardDefinition[], batchId: string | undefined): number {
  const batch = findBatch(loadBatches(cards), batchId);
  const verification = verifyBatch(batch, validateBatch(batch).scans);
  if (!verification) throw new Error(`No data/card-audit/verify/${batch.id}.json yet`);
  for (const error of verification.errors) console.log(`ERROR ${batch.id}: ${error}`);
  const missing = SAMPLE_SIZE - verification.checked;
  if (missing > 0) console.log(`${batch.id}: ${missing} sample printings not read yet`);
  for (const { id, name, fields } of verification.disagreements) {
    console.log(`${name} ${id}`);
    for (const field of fields) console.log(`  ${field}`);
  }
  console.log(`\n${verification.checked} sample printings read, ${verification.disagreements.length} disagree with the scan, ${verification.errors.length} errors.`);
  cmdProgress(cards);
  return verification.errors.length ? 1 : 0;
}

function cmdCheck(cards: CardDefinition[], batchId: string | undefined): number {
  const batches = loadBatches(cards);
  const selected = batchId ? [findBatch(batches, batchId)] : batches;
  const { results, findings } = collect(cards, selected);
  let errors = 0;
  for (const result of results) {
    for (const error of result.errors) console.log(`ERROR ${result.batch.id}: ${error}`);
    errors += result.errors.length;
    if (batchId) {
      const missing = result.batch.ids.length - result.scanned;
      if (missing) console.log(`${result.batch.id}: ${missing} of ${result.batch.ids.length} printings not scanned yet`);
    }
  }
  for (const { card, scan, diffs } of findings) {
    const flagged = scan.rulesMatch === "different" || scan.rulesMatch === "unreadable";
    if (!diffs.length && !flagged) continue;
    console.log(`${card.name} (${card.set}) ${card.id}`);
    if (flagged) console.log(`  rules ${scan.rulesMatch}: ${scan.notes}`);
    for (const diff of diffs) console.log(`  ${diff}`);
  }
  console.log(`\n${findings.length} printings scanned, ${errors} errors.`);
  cmdProgress(cards);
  return errors ? 1 : 0;
}

function cmdProgress(cards: CardDefinition[]): void {
  const batches = loadBatches(cards);
  const { results, findings } = collect(cards, batches);
  const printings = cards.length;
  const scanned = findings.length;
  const verifications = results.flatMap((result) => {
    const verification = verifyBatch(result.batch, result.scans);
    return verification ? [verification] : [];
  });

  const rows = SET_ORDER.map((set) => {
    const setResults = results.filter((result) => result.batch.set === set);
    const setFindings = findings.filter((finding) => finding.card.set === set);
    const total = setResults.reduce((sum, result) => sum + result.batch.ids.length, 0);
    const done = setResults.filter((result) => !result.errors.length && result.scanned === result.batch.ids.length).length;
    const count = (match: Scan["rulesMatch"]) => setFindings.filter((finding) => finding.scan.rulesMatch === match).length;
    const setVerified = verifications.filter((verification) => verification.batch.set === set);
    const sampled = setVerified.reduce((sum, verification) => sum + verification.checked, 0);
    const disagreeing = setVerified.reduce((sum, verification) => sum + verification.disagreements.length, 0);
    return `| ${set} | ${total} | ${done}/${setResults.length} | ${setFindings.length} | ${count("same")} | ${count("wording")} | ${count("different")} | ${count("unreadable")} | ${setFindings.filter((finding) => finding.diffs.length).length} | ${setFindings.filter((finding) => finding.scan.flavor).length} | ${setVerified.length}/${setResults.length} | ${sampled ? `${sampled - disagreeing}/${sampled}` : "-"} |`;
  });
  const table = [
    `**Scanned: ${scanned} / ${printings} printings.** Regenerate with \`npm run card-audit -- progress\`.`,
    "",
    "| Set | Printings | Batches done | Scanned | Rules same | Wording | Different | Unreadable | Field diffs | Flavor text | Batches verified | Sample agrees |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...rows
  ].join("\n");

  const doc = readFileSync(PROGRESS_PATH, "utf8");
  const start = "<!-- progress:start -->";
  const end = "<!-- progress:end -->";
  const from = doc.indexOf(start);
  const to = doc.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`${PROGRESS_PATH} is missing the ${start} / ${end} markers`);
  writeAtomic(PROGRESS_PATH, `${doc.slice(0, from + start.length)}\n${table}\n${doc.slice(to)}`);

  const lines = ["# Card audit findings", "", "Generated by `npm run card-audit -- progress` from the scan files. Do not hand-edit.", ""];
  const section = (title: string, items: Finding[], render: (finding: Finding) => string[]) => {
    lines.push(`## ${title} (${items.length})`, "");
    for (const item of items) lines.push(...render(item));
    lines.push("");
  };
  const label = ({ card }: Finding) => `- **${card.name}** (${card.set}) \`${card.id}\``;
  section(
    "Rules text different",
    findings.filter((finding) => finding.scan.rulesMatch === "different"),
    (finding) => [label(finding), `  - card: ${finding.scan.rules}`, `  - catalog: ${finding.card.text}`, `  - notes: ${finding.scan.notes}`]
  );
  section(
    "Unreadable",
    findings.filter((finding) => finding.scan.rulesMatch === "unreadable"),
    (finding) => [label(finding), `  - notes: ${finding.scan.notes}`]
  );
  section(
    "Field differences",
    findings.filter((finding) => finding.diffs.length),
    (finding) => [label(finding), ...finding.diffs.map((diff) => `  - ${diff}`)]
  );
  section(
    "Wording only (same play; typos to correct)",
    findings.filter((finding) => finding.scan.rulesMatch === "wording"),
    (finding) => [`${label(finding)}: ${finding.scan.notes || "(no note)"}`]
  );
  section(
    "Other scanner notes",
    findings.filter((finding) => finding.scan.rulesMatch === "same" && finding.scan.notes.trim()),
    (finding) => [`${label(finding)}: ${finding.scan.notes}`]
  );
  section(
    "Special printings",
    findings.filter((finding) => finding.scan.printing),
    (finding) => [`${label(finding)}: ${finding.scan.printing}`]
  );
  const disagreements = verifications.flatMap((verification) => verification.disagreements.map((entry) => ({ ...entry, batch: verification.batch.id })));
  lines.push(`## Verification disagreements (${disagreements.length})`, "");
  lines.push("A second reader re-read a random sample of each finished batch without seeing the first scan. Every disagreement gets settled against the image.", "");
  for (const { id, name, fields, batch } of disagreements) {
    lines.push(`- **${name}** \`${id}\` (${batch})`, ...fields.map((field) => `  - ${field}`));
  }
  lines.push("");
  lines.push(...triageLines(findings));
  lines.push("## Collector numbers", "");
  for (const [set, coverage] of [...collectorCoverage(findings)].sort((a, b) => SET_ORDER.indexOf(a[0]) - SET_ORDER.indexOf(b[0]))) {
    const totals = [...coverage.totals];
    const max = Math.max(0, ...totals.map(Number));
    const missing = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !coverage.numbers.has(n));
    const shared = [...coverage.numbers].filter(([, names]) => names.length > 1).sort((a, b) => a[0] - b[0]);
    lines.push(`### ${set}`, "");
    lines.push(`- set size printed: ${totals.join(", ") || "none read"}`);
    lines.push(`- numbers missing from the catalog: ${missing.length ? missing.join(", ") : "none"}`);
    lines.push(`- numbers on more than one printing: ${shared.length ? shared.map(([n, names]) => `${n} (${names.join(" / ")})`).join("; ") : "none"}`);
    lines.push(`- no collector number: ${coverage.unnumbered.length ? coverage.unnumbered.join(", ") : "none"}`);
    lines.push("");
  }
  writeAtomic(FINDINGS_PATH, lines.join("\n"));
  console.log(`Updated ${PROGRESS_PATH} and ${FINDINGS_PATH} (${scanned}/${printings} scanned).`);
}

/**
 * Copies `subtitle` and `flavorText` from every finished, error-free batch
 * onto its printings (key order: right after `markup`/`text`). Manual-review
 * placeholders are skipped. Idempotent.
 */
function cmdApplyFlavor(cards: CardDefinition[]): void {
  const finished = loadBatches(cards)
    .map((batch) => validateBatch(batch))
    .filter((result) => !result.errors.length && result.scanned === result.batch.ids.length);
  const scans = new Map(finished.flatMap((result) => result.scans.filter((scan) => !isManualReview(scan)).map((scan) => [scan.id, scan] as const)));
  let changed = 0;
  const next = cards.map((card) => {
    const scan = scans.get(card.id);
    if (!scan) return card;
    const rebuilt: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(card)) {
      if (key === "subtitle" || key === "flavorText") continue;
      rebuilt[key] = value;
      if (key === (card.markup !== undefined ? "markup" : "text")) {
        if (scan.subtitle) rebuilt.subtitle = scan.subtitle;
        if (scan.flavor) rebuilt.flavorText = scan.flavor;
      }
    }
    if (JSON.stringify(rebuilt) !== JSON.stringify(card)) changed++;
    return rebuilt as unknown as CardDefinition;
  });
  writeAtomic(CARDS_PATH, JSON.stringify(next, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  console.log(`apply-flavor: ${finished.length} finished batches, ${scans.size} printings, ${changed} cards changed.`);
  const sync = spawnSync(process.execPath, [join(ROOT, "scripts", "sync-cards.cjs")], { stdio: "inherit" });
  if (sync.status !== 0) throw new Error("sync-cards failed");
}

// -----------------------------------------------------------------------------
// Printed rules text (decision 2026-10-15: display each printing's exact printed words)
// -----------------------------------------------------------------------------

/** Labels whose printed dash becomes the catalog's colon. */
const COLON_LABELS = /\b(EXTRA COST|COST|EFFECT|FLIP UP|FLIP IT|PROVIDES|STARTING RESOURCES|STARTING DRAW|RESTORE RULE|DEVELOP RULE)\s*(?:--|[–—-])\s*/g;
/** OPTION labels stay their own " -- " segment, as in the catalog. */
const OPTION_LABEL_DASH = /\b(OPTION \d+)\s*(?:--|[–—-])\s*/g;

/**
 * A scan's `rules` transcription in the catalog's text format: the printed
 * words untouched, label punctuation (`COST –`) and threshold-paragraph
 * prefixes (`[R][R] –`) in the catalog's form (`COST:`, `[R][R]:`).
 */
export function printedRulesText(rules: string): string {
  const text = rules
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(COLON_LABELS, "$1: ")
    .replace(OPTION_LABEL_DASH, "$1 -- ");
  return text
    .split(" -- ")
    .map((segment) =>
      segment
        .trim()
        .replace(/^((?:\[[A-Z]\])+)\s*(?:--|[–—:-])\s*/, "$1: ")
        .replace(/^([^a-z[]+?)\s+(?:--|[–—-])\s+((?:\[[A-Z]\])+)$/, "$1: $2")
    )
    .filter(Boolean)
    .join(" -- ");
}

type Corrections = Record<string, TextCorrection & { source?: "scan" | "lead" }>;

/**
 * For every scanned printing whose printed words differ from its archival
 * `text`, writes a scan-sourced corrections.json entry (lead-written entries
 * are kept as they are), drops stale scan entries, then regenerates the
 * markup of every printing whose rules text changed. Conversions that need a
 * look go to data/card-audit/markup-review.md.
 */
function cmdBuildText(cards: CardDefinition[], all: boolean): void {
  const batches = loadBatches(cards);
  const scans = new Map(batches.flatMap((batch) => validateBatch(batch).scans).map((scan) => [scan.id, scan] as const));
  const imageProblems: Record<string, string> = existsSync(IMAGE_PROBLEMS_PATH) ? JSON.parse(readFileSync(IMAGE_PROBLEMS_PATH, "utf8")) : {};
  const previous: Corrections = existsSync(CORRECTIONS_PATH) ? JSON.parse(readFileSync(CORRECTIONS_PATH, "utf8")) : {};
  const next: Corrections = {};
  for (const [id, entry] of Object.entries(previous)) if (entry.source === "lead") next[id] = entry;
  for (const card of cards) {
    const scan = scans.get(card.id);
    if (!scan || isManualReview(scan) || card.id in imageProblems || next[card.id]) continue;
    const text = printedRulesText(scan.rules);
    if (loose(text) === loose(card.text)) continue;
    next[card.id] = { text, reason: `${scan.rulesMatch}: ${scan.notes || "printed words differ from text"}`, source: "scan" };
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeAtomic(CORRECTIONS_PATH, JSON.stringify(sorted, null, 2) + "\n");

  const touched = new Set([...Object.keys(previous), ...Object.keys(next)].filter((id) => all || previous[id]?.text !== next[id]?.text));
  const ctx = buildContext(cards);
  const overrides = loadMarkupOverrides();
  const review: string[] = [];
  let written = 0;
  const updated = cards.map((card) => {
    if (!touched.has(card.id)) return card;
    const override = overrideFor(overrides, card);
    const overridden = override === undefined ? null : convertCard(card, ctx, override);
    const conversion = overridden && !overridden.errors.length ? overridden : convertCard(card, ctx);
    if (!conversion) {
      const { markup: _dropped, ...rest } = card;
      return rest as CardDefinition;
    }
    if (conversion.errors.length || conversion.flags.length) {
      review.push(`- **${card.name}** (${card.set}) \`${card.id}\``, ...[...conversion.errors.map((e) => `!! ${e}`), ...conversion.flags.map((f) => `? ${f}`)].map((line) => `  - ${line}`));
    }
    if (conversion.errors.length) return card;
    written++;
    return { ...card, markup: conversion.markup };
  });
  writeAtomic(CARDS_PATH, JSON.stringify(updated, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  writeAtomic(
    MARKUP_REVIEW_PATH,
    ["# Markup review for printed-text corrections", "", "Generated by `npm run card-audit -- build-text`. `!!` = not written (fix by hand), `?` = written, needs a look.", "", ...review, ""].join("\n")
  );
  const errorCount = review.filter((line) => line.startsWith("  - !!")).length;
  console.log(`build-text: ${Object.keys(sorted).length} corrections (${Object.values(sorted).filter((entry) => entry.source === "lead").length} by lead); ${touched.size} printings changed, ${written} markups written, ${errorCount} errors; review list in ${MARKUP_REVIEW_PATH}.`);
  const sync = spawnSync(process.execPath, [join(ROOT, "scripts", "sync-cards.cjs")], { stdio: "inherit" });
  if (sync.status !== 0) throw new Error("sync-cards failed");
}

// -----------------------------------------------------------------------------

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const cards = loadCards();
  mkdirSync(SCANS_DIR, { recursive: true });
  mkdirSync(VERIFY_DIR, { recursive: true });
  switch (command) {
    case "batches":
      cmdBatches(cards);
      return 0;
    case "manifest":
      cmdManifest(cards, rest[0]);
      return 0;
    case "check":
      return flag("--verify") ? cmdCheckVerify(cards, flag("--verify")) : cmdCheck(cards, flag("--batch"));
    case "sample":
      cmdManifest(cards, rest[0], true);
      return 0;
    case "progress":
      cmdProgress(cards);
      return 0;
    case "apply-flavor":
      cmdApplyFlavor(cards);
      return 0;
    case "build-text":
      cmdBuildText(cards, rest.includes("--all"));
      return 0;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 10).join("\n"));
      return command ? 1 : 0;
  }
}

process.exitCode = main(process.argv.slice(2));
