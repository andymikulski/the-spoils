// card-markup CLI — migration tooling for CardDefinition.markup.
// Workflow and conventions: CARD-MARKUP-PROGRESS.md.
//
//   npm run card-markup -- sets
//   npm run card-markup -- convert "<set>" [--force]
//   npm run card-markup -- show "<set>" [--range a:b] [--flagged] [--unreviewed] [--new] [--name "<card>"]...
//   npm run card-markup -- review "<set>" (--range a:b | --name "<card>"...) [--new] [--note "..."]
//   npm run card-markup -- check
//   npm run card-markup -- progress
//
// <set> is a set name ("1st Edition") or its slug ("1st-edition"). --new
// limits show/review to the set's new names (first seen in it, in work
// order), so parallel sessions each own a disjoint slice of the catalog.
// Every command that writes state holds a lock around read-modify-write and
// writes files atomically, so concurrent sessions are safe.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CardDefinition } from "../../src/types/index.js";
import { parseCardText, serializeCardText } from "../../src/cardText.js";
import { buildContext, convertCard, linkAbilityRefs, verifyMarkup, type ConvertContext } from "./convert.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARDS_PATH = join(ROOT, "data", "cards.json");
const OVERRIDES_PATH = join(ROOT, "data", "card-markup", "overrides.txt");
/** Per-set override files (`<set slug>.txt`), same format as overrides.txt. */
const OVERRIDES_DIR = join(ROOT, "data", "card-markup", "overrides");
const REVIEWED_PATH = join(ROOT, "data", "card-markup", "reviewed.json");
const LOCK_PATH = join(ROOT, "data", "card-markup", ".lock");
const PROGRESS_PATH = join(ROOT, "CARD-MARKUP-PROGRESS.md");

/** Work order: each set's reprints of earlier sets' cards come for free. */
const SET_ORDER = [
  "1st Edition",
  "1st Edition Part 2",
  "Open Beta",
  "Shade of the Devoured Emperor",
  "Seed",
  "Seed 2",
  "Seed 3",
  "2nd Edition",
  "Seed Saga",
  "Holy Heist",
  "Ungodly Mess"
];

const slug = (set: string) => set.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// -----------------------------------------------------------------------------
// State files
// -----------------------------------------------------------------------------

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Runs `fn` holding the state lock (an exclusive lock directory). A lock older
 * than two minutes is treated as left behind by a crashed run and taken over.
 */
function withLock<T>(fn: () => T): T {
  for (let waited = 0; ; waited += 100) {
    try {
      mkdirSync(LOCK_PATH);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(LOCK_PATH).mtimeMs > 120_000) rmSync(LOCK_PATH, { recursive: true, force: true });
      } catch {
        // Released between the mkdir and the stat; just retry.
      }
      if (waited > 600_000) throw new Error(`Timed out waiting for ${LOCK_PATH}`);
      sleep(100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK_PATH, { recursive: true, force: true });
  }
}

/** Write-then-rename, so a concurrent reader sees the old or the new file, never half of one. */
function writeAtomic(path: string, content: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, path);
      return;
    } catch (error) {
      // Windows refuses to replace a file another process has open for a moment.
      if (attempt >= 50 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      sleep(100);
    }
  }
}

function loadCards(): CardDefinition[] {
  return JSON.parse(readFileSync(CARDS_PATH, "utf8"));
}

/** Writes cards.json in its existing CRLF, 2-space format, then regenerates src/data/cards.js. */
function saveCards(cards: CardDefinition[]): void {
  writeAtomic(CARDS_PATH, JSON.stringify(cards, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  const sync = spawnSync(process.execPath, [join(ROOT, "scripts", "sync-cards.cjs")], { stdio: "inherit" });
  if (sync.status !== 0) throw new Error("sync-cards failed");
}

/**
 * Override files: hand-corrected markup keyed by card name. Lines before the
 * first "=== " are comments; each "=== <card name>" starts an entry whose
 * markup is everything up to the next "=== " (whitespace between blocks is
 * ignored by the parser, so entries can be pretty-printed).
 */
function parseOverrideFile(path: string, into: Map<string, string>, sources: Map<string, string>): void {
  let current: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (current === undefined) return;
    if (sources.has(current)) throw new Error(`Override for "${current}" is in both ${sources.get(current)} and ${path}`);
    into.set(current, lines.join("\n").trim());
    sources.set(current, path);
  };
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.startsWith("=== ")) {
      flush();
      current = line.slice(4).trim();
      lines = [];
    } else if (current !== undefined) lines.push(line);
  }
  flush();
}

/** overrides.txt plus every per-set file in overrides/; a card may be overridden in only one of them. */
function loadOverrides(): Map<string, string> {
  const overrides = new Map<string, string>();
  const sources = new Map<string, string>();
  if (existsSync(OVERRIDES_PATH)) parseOverrideFile(OVERRIDES_PATH, overrides, sources);
  if (existsSync(OVERRIDES_DIR)) {
    for (const file of readdirSync(OVERRIDES_DIR).filter((name) => name.endsWith(".txt")).sort()) {
      parseOverrideFile(join(OVERRIDES_DIR, file), overrides, sources);
    }
  }
  return overrides;
}

type Reviewed = Record<string, string>;

function loadReviewed(): Reviewed {
  return existsSync(REVIEWED_PATH) ? JSON.parse(readFileSync(REVIEWED_PATH, "utf8")) : {};
}

function saveReviewed(reviewed: Reviewed): void {
  const sorted = Object.fromEntries(Object.entries(reviewed).sort(([a], [b]) => a.localeCompare(b)));
  writeAtomic(REVIEWED_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function resolveSet(arg: string | undefined, cards: CardDefinition[]): string {
  const sets = [...new Set(cards.map((card) => card.set))];
  const match = sets.find((set) => set === arg || slug(set) === arg);
  if (!match) throw new Error(`Unknown set "${arg}". Sets: ${sets.join(", ")}`);
  return match;
}

/** `card.markup` placed right after `text`, so cards.json diffs stay local. */
function setMarkup(card: CardDefinition, markup: string | undefined): CardDefinition {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card)) {
    if (key === "markup") continue;
    out[key] = value;
    if (key === "text" && markup !== undefined) out.markup = markup;
  }
  return out as unknown as CardDefinition;
}

/** Unique card names in a set (cards with rules text only), alphabetical — the index space for --range. */
function setNames(cards: CardDefinition[], set: string): string[] {
  return [...new Set(cards.filter((card) => card.set === set && card.text.trim()).map((card) => card.name))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const names: string[] = [];
  const flags = new Set<string>();
  let range: [number, number] | undefined;
  let note = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--range") {
      const [a, b] = argv[++i].split(":").map(Number);
      range = [a, b];
    } else if (arg === "--name") names.push(argv[++i]);
    else if (arg === "--note") note = argv[++i];
    else if (arg.startsWith("--")) flags.add(arg.slice(2));
    else positional.push(arg);
  }
  return { positional, names, flags, range, note };
}

/** Names first seen in `set`, walking SET_ORDER — the slice of the catalog that set's review owns. */
function newNames(cards: CardDefinition[], set: string): Set<string> {
  const seen = new Set<string>();
  for (const candidate of SET_ORDER) {
    const names = setNames(cards, candidate);
    if (candidate === set) return new Set(names.filter((name) => !seen.has(name)));
    names.forEach((name) => seen.add(name));
  }
  throw new Error(`"${set}" is not in SET_ORDER`);
}

/** --name list, else --range slice, else everything; then narrowed to the set's new names under --new. */
function selectNames(cards: CardDefinition[], set: string, args: ReturnType<typeof parseArgs>): string[] {
  const all = setNames(cards, set);
  let selected: string[];
  if (args.names.length) {
    for (const name of args.names) if (!all.includes(name)) throw new Error(`"${name}" is not in this set`);
    selected = args.names;
  } else selected = args.range ? all.slice(args.range[0], args.range[1]) : all;
  if (!args.flags.has("new")) return selected;
  const owned = newNames(cards, set);
  return selected.filter((name) => owned.has(name));
}

/** Markup copied from a reviewed printing onto another printing of the same card, refs relinked for it. */
function copyMarkup(markup: string, card: CardDefinition): { markup: string; flags: string[] } {
  const blocks = parseCardText(markup);
  const flags: string[] = [];
  linkAbilityRefs(blocks, card, flags);
  return { markup: serializeCardText(blocks), flags };
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

function cmdSets(cards: CardDefinition[]): void {
  for (const set of SET_ORDER) console.log(`${slug(set).padEnd(32)} ${set} (${setNames(cards, set).length} names with text)`);
}

function cmdConvert(cards: CardDefinition[], set: string, force: boolean): void {
  const ctx = buildContext(cards);
  const overrides = loadOverrides();
  const reviewed = loadReviewed();
  const reviewedMarkup = new Map<string, string>();
  for (const card of cards) if (card.markup && card.name in reviewed && !reviewedMarkup.has(card.name)) reviewedMarkup.set(card.name, card.markup);

  const flagged = new Map<string, string[]>();
  const errors = new Map<string, string[]>();
  const changedReviewed = new Set<string>();
  let written = 0;
  const next = cards.map((card) => {
    if (card.set !== set) return card;
    if (!card.text.trim()) return setMarkup(card, undefined);
    if (card.name in reviewed && !force) {
      if (card.markup) return card;
      const source = reviewedMarkup.get(card.name);
      if (!source) return card;
      const copied = copyMarkup(source, card);
      if (copied.flags.length) flagged.set(card.name, copied.flags);
      written++;
      return setMarkup(card, copied.markup);
    }
    const conversion = convertCard(card, ctx, overrides.get(card.name))!;
    if (conversion.errors.length) {
      errors.set(card.name, conversion.errors);
      return card;
    }
    if (conversion.flags.length) flagged.set(card.name, conversion.flags);
    if (card.name in reviewed && card.markup !== conversion.markup) changedReviewed.add(card.name);
    written++;
    return setMarkup(card, conversion.markup);
  });
  saveCards(next);

  console.log(`\n${set}: wrote markup on ${written} printings (${setNames(next, set).length} names with text).`);
  if (changedReviewed.size) console.log(`\n!! --force changed REVIEWED markup: ${[...changedReviewed].join(", ")}`);
  if (errors.size) {
    console.log(`\nERRORS (not written) — ${errors.size}:`);
    for (const [name, list] of errors) console.log(`  ${name}: ${list.join(" | ")}`);
  }
  if (flagged.size) {
    console.log(`\nFlagged — ${flagged.size}:`);
    for (const [name, list] of flagged) console.log(`  ${name}: ${list.join(" | ")}`);
  }
}

function cmdShow(cards: CardDefinition[], set: string, args: ReturnType<typeof parseArgs>): void {
  const ctx: ConvertContext = buildContext(cards);
  const overrides = loadOverrides();
  const reviewed = loadReviewed();
  const all = setNames(cards, set);
  const selected = new Set(selectNames(cards, set, args));
  for (const [index, name] of all.entries()) {
    if (!selected.has(name)) continue;
    const card = cards.find((candidate) => candidate.set === set && candidate.name === name)!;
    const isReviewed = name in reviewed;
    if (args.flags.has("unreviewed") && isReviewed) continue;
    const conversion = convertCard(card, ctx, overrides.get(name));
    const errors = card.markup ? verifyMarkup(card.markup, card) : ["not converted"];
    const flags = isReviewed ? [] : (conversion?.flags ?? []);
    if (args.flags.has("flagged") && !flags.length && !errors.length) continue;
    const abilities = (card.behavior?.abilities ?? []).map((ability) => `${ability.id}:${ability.type}${ability.name ? `:${ability.name}` : ""}`);
    const tags = [card.type, isReviewed ? "reviewed" : "unreviewed", overrides.has(name) && "override"].filter(Boolean).join(", ");
    console.log(`\n[${index}] ${name} (${tags})${abilities.length ? `  abilities: ${abilities.join(" ")}` : ""}`);
    console.log(`  text: ${card.text}`);
    if (card.markup) {
      for (const line of serializeCardText(parseCardText(card.markup), { pretty: true }).split("\n")) console.log(`  | ${line}`);
    }
    if (isReviewed && reviewed[name]) console.log(`  note: ${reviewed[name]}`);
    for (const flag of flags) console.log(`  ? ${flag}`);
    for (const error of errors) console.log(`  !! ${error}`);
  }
}

function cmdReview(cards: CardDefinition[], set: string, args: ReturnType<typeof parseArgs>): void {
  const reviewed = loadReviewed();
  if (!args.range && !args.names.length) throw new Error("review needs --range a:b or --name");
  const names = selectNames(cards, set, args);
  if (!names.length) {
    console.log(`Nothing to mark in ${set} for that selection.`);
    return;
  }
  const problems: string[] = [];
  for (const name of names) {
    for (const card of cards.filter((candidate) => candidate.set === set && candidate.name === name)) {
      const errors = card.markup ? verifyMarkup(card.markup, card) : ["not converted"];
      if (errors.length) problems.push(`${name}: ${errors.join(" | ")}`);
    }
  }
  if (problems.length) throw new Error(`Not marking reviewed — fix first:\n  ${problems.join("\n  ")}`);
  for (const name of names) reviewed[name] = args.note || reviewed[name] || "";
  saveReviewed(reviewed);
  console.log(`Marked ${names.length} names reviewed in ${set}: ${names[0]} … ${names[names.length - 1]}`);
}

function cmdCheck(cards: CardDefinition[]): number {
  const reviewed = loadReviewed();
  const byName = new Map<string, CardDefinition[]>();
  for (const card of cards) byName.set(card.name, [...(byName.get(card.name) ?? []), card]);
  let errorCount = 0;
  const awaitingCopy = new Set<string>();
  for (const card of cards) {
    if (!card.markup) {
      if (card.name in reviewed && card.text.trim()) awaitingCopy.add(card.set);
      continue;
    }
    if (!card.text.trim()) {
      console.log(`!! ${card.name} (${card.set}): markup on a card with no text`);
      errorCount++;
    }
    for (const error of verifyMarkup(card.markup, card)) {
      console.log(`!! ${card.name} (${card.set}): ${error}`);
      errorCount++;
    }
  }
  const stripRefs = (markup: string) => markup.replace(/ ref="[^"]*"/g, "");
  for (const [name, printings] of byName) {
    const variants = new Set(printings.filter((card) => card.markup).map((card) => stripRefs(card.markup!)));
    if (variants.size > 1) console.log(`  drift: ${name} has ${variants.size} different markups across printings`);
  }
  const withMarkup = cards.filter((card) => card.markup).length;
  if (awaitingCopy.size) console.log(`  reprints of reviewed cards still unconverted in: ${[...awaitingCopy].join(", ")} (convert copies them)`);
  console.log(`\ncheck: ${withMarkup} printings with markup, ${errorCount} errors.`);
  return errorCount ? 1 : 0;
}

function cmdProgress(cards: CardDefinition[]): void {
  const reviewed = loadReviewed();
  const overrides = loadOverrides();
  const seen = new Set<string>();
  const rows: string[] = [];
  let totalNames = 0;
  let totalReviewed = 0;
  for (const set of SET_ORDER) {
    const printings = cards.filter((card) => card.set === set);
    const withText = printings.filter((card) => card.text.trim());
    const names = setNames(cards, set);
    const fresh = names.filter((name) => !seen.has(name));
    names.forEach((name) => seen.add(name));
    const converted = withText.filter((card) => card.markup).length;
    const reviewedFresh = fresh.filter((name) => name in reviewed).length;
    const reviewedAll = names.filter((name) => name in reviewed).length;
    totalNames += fresh.length;
    totalReviewed += reviewedFresh;
    const status =
      reviewedAll === names.length
        ? converted === withText.length
          ? "done"
          : "all reviewed — run convert to copy markup"
        : converted === 0 && reviewedFresh === 0
          ? "not started"
          : "in progress";
    rows.push(
      `| ${set} | \`${slug(set)}\` | ${printings.length} | ${withText.length} | ${fresh.length} | ${reviewedFresh} / ${fresh.length} | ${converted} / ${withText.length} | ${status} |`
    );
  }
  const table = [
    `**Overall: ${totalReviewed} / ${totalNames} unique cards reviewed** (${overrides.size} hand overrides).`,
    "",
    "| Set (work order) | Slug | Printings | With text | New names | Reviewed (new) | Printings with markup | Status |",
    "|---|---|--:|--:|--:|--:|--:|---|",
    ...rows
  ].join("\n");
  const doc = readFileSync(PROGRESS_PATH, "utf8");
  const start = "<!-- progress:start -->";
  const end = "<!-- progress:end -->";
  const from = doc.indexOf(start);
  const to = doc.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`${PROGRESS_PATH} is missing the ${start} / ${end} markers`);
  writeAtomic(PROGRESS_PATH, `${doc.slice(0, from + start.length)}\n${table}\n${doc.slice(to)}`);
  console.log(table);
}

// -----------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const setArg = (cards: CardDefinition[]) => resolveSet(args.positional[0], cards);
switch (command) {
  case "sets":
    cmdSets(loadCards());
    break;
  case "convert":
    withLock(() => {
      const cards = loadCards();
      cmdConvert(cards, setArg(cards), args.flags.has("force"));
    });
    break;
  case "show": {
    const cards = loadCards();
    cmdShow(cards, setArg(cards), args);
    break;
  }
  case "review":
    withLock(() => {
      const cards = loadCards();
      cmdReview(cards, setArg(cards), args);
    });
    break;
  case "check":
    process.exitCode = cmdCheck(loadCards());
    break;
  case "progress":
    withLock(() => cmdProgress(loadCards()));
    break;
  default:
    console.log("usage: npm run card-markup -- (sets | convert <set> | show <set> | review <set> | check | progress)");
    process.exitCode = 1;
}
