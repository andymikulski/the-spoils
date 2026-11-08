// The rule-atom manifest behind the rules-coverage suite (docs/TESTING.md).
//
// The Comprehensive Rules (v2.5) and the Rules FAQ (v2.0) are split into
// *atoms*: one per numbered rule or sub-rule ("CR 408.3b") and one per FAQ
// question ("FAQ 7"). The multiplayer atoms ("MP 2", "MPX-select") are written
// by hand in data/rule-tests/source/multiplayer.txt. Every atom must be covered
// by a rule test (`_rule.ts`) or explicitly exempted with a reason;
// `_coverage.test.ts` enforces it.
//
// The CR and FAQ source text lives in data/rule-tests/source/ (extracted once
// from the PDFs in docs/ by `npm run rule-tests -- extract`), so building the
// manifest and running the gate never depend on a PDF reader.
//
// Shared by the gate test and `scripts/rule-tests/cli.ts`, so the CLI's
// manifest and the gate's idea of "every atom" can never drift.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface RuleAtom {
  /** `CR 408.3b`, `FAQ 7`, `MP 2` or `MPX-select`. */
  id: string;
  source: "CR" | "FAQ" | "MP";
  /** CR: the three-digit section ("408"). FAQ: "FAQ". Multiplayer: "MP" (printed guidelines) or "MPX" (N-player readings of two-player rules). */
  section: string;
  sectionTitle: string;
  /** CR only: the atom this one nests under ("408.3" for "408.3b"). */
  parent?: string;
  /** `heading` atoms carry only a title ("201.1 Name") and are covered by their children. */
  kind: "rule" | "heading";
  /** The rule's own wording plus any unnumbered paragraphs and examples that follow it. */
  text: string;
  /** FAQ only. */
  answer?: string;
  /** Multiplayer only: a short name for the atom. */
  title?: string;
  /** Multiplayer only: the CR / FAQ / MP atoms and rulings (`RQ-n`) the reading rests on. */
  cites?: string[];
  batch: string;
}

/** Test batches: contiguous runs of CR sections, ordered riskiest-first (docs/TESTING.md). */
export const BATCHES: readonly { batch: string; title: string; sections: readonly string[] }[] = [
  { batch: "r01-priority-responses", title: "Responding to actions, ending a turn", sections: ["607", "610"] },
  { batch: "r02-battle", title: "Attacking, resolving a battle, battle terms, unblockability", sections: ["302", "608", "609", "412"] },
  { batch: "r03-costs-effects", title: "Costs, effects, numeric cost, numbers, pay", sections: ["401", "402", "406", "410", "309", "404"] },
  { batch: "r04-damage-control", title: "Damage, control & ownership, tokens, face-down cards", sections: ["408", "407", "409", "411"] },
  { batch: "r05-abilities", title: "Abilities, triggers, conditionals, requirements, replacements, temporary text, italic text", sections: ["501", "502", "503", "504", "505", "506", "508"] },
  { batch: "r06-keywords", title: "Keywords", sections: ["507"] },
  { batch: "r07-zones-actions", title: "Game areas and key-term actions (attach, deplete, destroy, discard, draw, duplicate, free, pick, provides, search, shuffle, terminate)", sections: ["403", "301", "303", "304", "305", "306", "307", "308", "310", "311", "312", "313", "314"] },
  { batch: "r08-turn-deploy", title: "Starting a game, start of turn, during a turn, deploying, playing a resource, using an ability", sections: ["601", "602", "603", "604", "605", "606"] },
  { batch: "r09-resources-thresholds", title: "Threshold, resources, factions", sections: ["405", "202", "203"] },
  { batch: "r10-card-types", title: "Characters, tactics, items, locations, changing card types, parts of a card", sections: ["201", "204", "205", "206", "207", "208"] },
  { batch: "r11-general-loops-bidding", title: "Most important rule, object of the game, deck construction, tournaments, errata, bidding, action loops", sections: ["101", "102", "103", "104", "105", "413", "414"] },
  { batch: "r12-faq", title: "Rules FAQ", sections: ["FAQ"] },
  { batch: "mp-ffa", title: "Free-for-all multiplayer: the printed guidelines and the N-player reading of every two-player rule", sections: ["MP", "MPX"] }
];

const BATCH_OF = new Map(BATCHES.flatMap((b) => b.sections.map((s) => [s, b.batch] as const)));

const ATOM_START = /^\s*(\d{3})\.(\d+)([a-z]?)\.?(?:\s+(.*))?$/;
const SECTION_START = /^(\d{3}) (\S.*)$/;

/** Collapses the PDF's wrapped, indented lines into single-spaced text. */
function tidy(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .split(String.fromCharCode(0xfffd))
    .join(String.fromCharCode(0x2014)) // pdftotext writes the CR's em dashes as U+FFFD
    .replace(/The SpoilsTM/g, "The Spoils")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits the Comprehensive Rules text (`pdftotext -layout`) into one atom per numbered rule. */
export function parseCr(text: string): RuleAtom[] {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/);
  // The table of contents lists every section with dot leaders; the body starts at the first heading without them.
  const start = lines.findIndex((line) => /^101 The Most Important Rule\s*$/.test(line));
  if (start < 0) throw new Error("parseCr: cannot find section 101");

  const atoms: (Omit<RuleAtom, "text" | "batch"> & { lines: string[] })[] = [];
  let section = "";
  let sectionTitle = "";
  for (const line of lines.slice(start)) {
    if (/^Section \d+ - /.test(line)) continue;
    const heading = SECTION_START.exec(line);
    if (heading && !ATOM_START.test(line)) {
      section = heading[1]!;
      sectionTitle = heading[2]!.trim();
      continue;
    }
    const atom = ATOM_START.exec(line);
    if (atom && atom[1] === section) {
      const [, , minor, letter, rest] = atom;
      atoms.push({
        id: `CR ${section}.${minor}${letter}`,
        source: "CR",
        section,
        sectionTitle,
        ...(letter ? { parent: `${section}.${minor}` } : {}),
        kind: "rule",
        lines: rest ? [rest] : []
      });
      continue;
    }
    atoms[atoms.length - 1]?.lines.push(line);
  }

  const parents = new Set(atoms.flatMap((atom) => (atom.parent ? [atom.parent] : [])));
  return atoms.map(({ lines: body, ...atom }) => {
    const wording = tidy(body);
    // "201.1 Name": a short title whose lettered sub-rules carry the actual rules.
    const heading = parents.has(atom.id.slice(3)) && wording.length < 40 && !/[.:]$/.test(wording);
    return { ...atom, kind: heading ? "heading" : "rule", text: wording, batch: BATCH_OF.get(atom.section) ?? "unassigned" } as RuleAtom;
  });
}

/** Splits the FAQ text into one atom per "Q:" / "A:" pair. */
export function parseFaq(text: string): RuleAtom[] {
  const lines = text
    .replace(/\f/g, "\n")
    .split(/\r?\n/)
    .filter((line) => !/Rules FAQ V\d/.test(line));
  const qa: { q: string[]; a: string[] }[] = [];
  let into: "q" | "a" | undefined;
  for (const line of lines) {
    const q = /^\s*Q:\s*(.*)$/.exec(line);
    const a = /^\s*A:\s*(.*)$/.exec(line);
    if (q) {
      qa.push({ q: [q[1]!], a: [] });
      into = "q";
    } else if (a && qa.length) {
      qa[qa.length - 1]!.a.push(a[1]!);
      into = "a";
    } else if (into && qa.length) {
      qa[qa.length - 1]![into].push(line);
    }
  }
  return qa.map(({ q, a }, index) => ({
    id: `FAQ ${index + 1}`,
    source: "FAQ" as const,
    section: "FAQ",
    sectionTitle: "Rules FAQ",
    kind: "rule" as const,
    text: tidy(q),
    answer: tidy(a),
    batch: BATCH_OF.get("FAQ")!
  }));
}

const MP_HEADER = /^== (MP \d+|MPX-[a-z0-9]+(?:-[a-z0-9]+)*) \| (\S.*)$/;
const RULING_HEADING = /^#{2,4}\s+(RQ-[\w-]+)/gm;

/**
 * Parses data/rule-tests/source/multiplayer.txt: records start with
 * `== <id> | <title>`, then an optional `cites:` line (continuing to the next
 * blank line), then the atom's wording. Lines starting with `#` are comments.
 * Every cite must be a real atom or a recorded ruling / written-up question.
 */
export function parseMultiplayer(text: string, others: readonly RuleAtom[], rulingIds: ReadonlySet<string>): RuleAtom[] {
  const records: { id: string; title: string; lines: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("== ")) {
      const header = MP_HEADER.exec(line);
      if (!header) throw new Error(`parseMultiplayer: bad header "${line}"`);
      records.push({ id: header[1]!, title: header[2]!.trim(), lines: [] });
    } else if (records.length) records[records.length - 1]!.lines.push(line);
    else if (line.trim()) throw new Error(`parseMultiplayer: text before the first header: "${line}"`);
  }

  const ids = new Set([...others.map((atom) => atom.id), ...records.map((record) => record.id)]);
  if (ids.size !== others.length + records.length) throw new Error("parseMultiplayer: duplicate atom id");
  return records.map(({ id, title, lines }) => {
    const citeLines: string[] = [];
    let at = lines.findIndex((line) => line.trim());
    if (at >= 0 && lines[at]!.startsWith("cites:")) {
      for (; at < lines.length && lines[at]!.trim(); at++) citeLines.push(lines[at]!.replace(/^cites:/, ""));
      lines = lines.slice(at);
    }
    const cites = citeLines
      .join(" ")
      .split(",")
      .map((cite) => cite.trim())
      .filter(Boolean);
    for (const cite of cites) {
      if (!ids.has(cite) && !rulingIds.has(cite)) throw new Error(`parseMultiplayer: ${id} cites unknown "${cite}"`);
    }
    const section = id.startsWith("MPX") ? "MPX" : "MP";
    return {
      id,
      source: "MP" as const,
      section,
      sectionTitle: section === "MP" ? "Multi-Player Guidelines (printed insert)" : "N-player readings of two-player rules",
      kind: "rule" as const,
      text: tidy(lines),
      title,
      ...(cites.length && { cites }),
      batch: BATCH_OF.get(section)!
    };
  });
}

/** The multiplayer source text, plus the ids of every ruling and question the atoms may cite. */
export function readMultiplayerSource(): { text: string; rulingIds: Set<string> } {
  const data = fileURLToPath(new URL("../../../../data/rule-tests/", import.meta.url));
  const headings = [data + "rulings.md", ...readdirSync(data + "questions").filter((name) => name.endsWith(".md")).map((name) => data + "questions/" + name)];
  const rulingIds = new Set(headings.flatMap((file) => [...readFileSync(file, "utf8").matchAll(RULING_HEADING)].map((match) => match[1]!)));
  return { text: readFileSync(data + "source/multiplayer.txt", "utf8"), rulingIds };
}

export function buildAtoms(crText: string, faqText: string, multiplayer: { text: string; rulingIds: ReadonlySet<string> } = readMultiplayerSource()): RuleAtom[] {
  const others = [...parseCr(crText), ...parseFaq(faqText)];
  return [...others, ...parseMultiplayer(multiplayer.text, others, multiplayer.rulingIds)];
}

// --- scanning the test sources for coverage ----------------------------------

export interface RuleReference {
  file: string;
  line: number;
  fn: "rule" | "ruleMismatch" | "ruleOpen" | "ruleExempt";
  ids: string[];
  /** `ruleMismatch`: the finding id. `ruleOpen`: the question id. `ruleExempt`: the reason. */
  note?: string;
}

// rule("CR 408.3b" | ["CR 1", "CR 2"], ...), ruleMismatch(ids, "F-1", ...), ruleOpen(ids, "RQ-1", ...), ruleExempt(ids, "reason").
const CALL = /\b(rule|ruleMismatch|ruleOpen|ruleExempt)\(\s*(\[[^\]]*\]|"[^"]*")\s*(?:,\s*"((?:[^"\\]|\\.)*)")?/g;

export function scanRuleReferences(file: string, source: string): RuleReference[] {
  const refs: RuleReference[] = [];
  for (const match of source.matchAll(CALL)) {
    const [, fn, rawIds, note] = match;
    const ids = rawIds!.startsWith("[") ? [...rawIds!.matchAll(/"([^"]*)"/g)].map((id) => id[1]!) : [rawIds!.slice(1, -1)];
    const line = source.slice(0, match.index).split("\n").length;
    refs.push({ file, line, fn: fn as RuleReference["fn"], ids, ...(note !== undefined && { note }) });
  }
  return refs;
}

/** True when `text` has a heading line `## <id> ...` for finding/question `id`. */
export function hasHeading(text: string, id: string): boolean {
  return new RegExp(`^#{2,4}\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").test(text);
}
