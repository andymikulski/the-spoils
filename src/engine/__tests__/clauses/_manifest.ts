// The clause manifest behind the clause-coverage suite (docs/TESTING.md).
//
// Every printing belongs to a *rules group*: the printings of one name that
// are identical in everything the engine reads (printed markup, behavior,
// costs, stats, FLIP UP, ...) — set, rarity, subtitle, flavor, art credit and the
// archival `text` aside. A group is tested once; its other printings are
// the same card to the engine by construction.
//
// Each group's printed text (`markup`) is split into *clauses* — one per
// thing the card says it does: a keyword, a rules paragraph, a named
// ability, an option, each paragraph of a grant, FLIP UP, PROVIDES, FEALTY.
// A card that prints no rules text has the single clause `vanilla`. Every
// clause must be covered by a clause test (`_clause.ts`) or explicitly
// exempted with a reason; `_coverage.test.ts` enforces it.
//
// Shared by that gate test and `scripts/card-tests/cli.ts`, so the CLI's
// manifest and the gate's idea of "every clause" can never drift.

import cardsJson from "../../../data/cards.js";
import { cardTextToPlain, parseCardText, type CardTextBlock } from "../../../cardText.js";
import type { CardDefinition, ResourceIcon } from "../../../engine.js";

export const RELEASE_ORDER = [
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
] as const;

export const CATALOG = cardsJson as CardDefinition[];

export interface Clause {
  /** Stable within the group: `<block index>[.<inner index>]:<kind>[:<detail>]`, e.g. `0:kw:COVERT`, `2:ability:make-vanish`, `3.1:grant-rule`. */
  key: string;
  kind: string;
  /** The clause's printed wording (plain text). */
  text: string;
}

export interface RulesGroup {
  /** The representative printing — the earliest-released one. Tests may name any printing of the group. */
  id: string;
  name: string;
  /** Every printing id in the group, representative first. */
  printings: string[];
  sets: string[];
  clauses: Clause[];
  batch: string;
}

/** Fields that never change what the engine does — left out of the grouping key. */
const NON_RULES_FIELDS = new Set(["id", "set", "rarity", "subtitle", "flavorText", "art", "text"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function rulesKey(card: CardDefinition): string {
  const rules: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card)) if (!NON_RULES_FIELDS.has(key)) rules[key] = value;
  return canonical(rules);
}

const LETTER: Record<ResourceIcon, string> = { rage: "r", greed: "g", deception: "d", elitism: "e", obsession: "o", volition: "v" };

/** A printed label as a key fragment: quote marks dropped (`"OVERTIME"` → `OVERTIME`) so every key fits in a double-quoted string literal. */
const keyPart = (label: string): string => label.replace(/["'‘’“”]/g, "");

function blockClauses(block: CardTextBlock, path: string, prefix: string): Clause[] {
  const text = cardTextToPlain([block]);
  switch (block.type) {
    case "keywords": {
      const out: Clause[] = [];
      for (const node of block.children) {
        if (node.type === "keyword") out.push({ key: `${path}:${prefix}kw:${node.text.toUpperCase()}`, kind: `${prefix}keyword`, text: node.text.toUpperCase() });
        else if (node.type === "unique") out.push({ key: `${path}:${prefix}unique`, kind: `${prefix}unique`, text: `UNIQUE ${node.text}` });
        else if (node.type === "attach") out.push({ key: `${path}:${prefix}attach`, kind: `${prefix}attach`, text: `ATTACH TO ${node.text}` });
      }
      return out;
    }
    case "rule": {
      const gate = block.when ? `@${block.when.map((icon) => LETTER[icon]).join("")}` : "";
      const name = block.name ? `:${keyPart(block.name)}` : "";
      return [{ key: `${path}:${prefix}rule${gate}${name}`, kind: `${prefix}rule`, text }];
    }
    case "ability":
      return [{ key: `${path}:${prefix}ability${block.ref ? `:${block.ref}` : ""}`, kind: `${prefix}ability`, text }];
    case "option":
      return [{ key: `${path}:${prefix}option:${keyPart(block.label)}`, kind: `${prefix}option`, text }];
    case "grant":
      // Never nested (the parser forbids it) — handled by the caller.
      return [];
    default:
      return [{ key: `${path}:${prefix}${block.type}`, kind: `${prefix}${block.type}`, text }];
  }
}

/** The clauses a printing's printed text makes — see the file header. */
export function clausesFor(card: Pick<CardDefinition, "markup">): Clause[] {
  if (!card.markup) {
    return [{ key: "vanilla", kind: "vanilla", text: "No rules text: plays for its printed cost and threshold, with its printed stats." }];
  }
  const out: Clause[] = [];
  parseCardText(card.markup).forEach((block, index) => {
    if (block.type === "grant") {
      block.blocks.forEach((inner, innerIndex) => out.push(...blockClauses(inner, `${index}.${innerIndex}`, "grant-")));
    } else {
      out.push(...blockClauses(block, String(index), ""));
    }
  });
  return out;
}

export const slug = (set: string): string => set.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Clauses per batch to aim for; a group is never split across batches. */
export const BATCH_CLAUSE_TARGET = 40;

/**
 * Every rules group, in release order of its representative printing, each
 * assigned to a batch of about {@link BATCH_CLAUSE_TARGET} clauses within its
 * home set (`<set-slug>-NN`). Deterministic for a given catalog.
 */
export function buildRulesGroups(catalog: CardDefinition[] = CATALOG): RulesGroup[] {
  const releaseIndex = (set: string) => {
    const index = (RELEASE_ORDER as readonly string[]).indexOf(set);
    return index === -1 ? RELEASE_ORDER.length : index;
  };
  const catalogIndex = new Map(catalog.map((card, index) => [card.id, index]));
  const ordered = [...catalog].sort(
    (a, b) => releaseIndex(a.set) - releaseIndex(b.set) || catalogIndex.get(a.id)! - catalogIndex.get(b.id)!
  );
  const byKey = new Map<string, CardDefinition[]>();
  for (const card of ordered) {
    const key = `${card.name}\u0000${rulesKey(card)}`;
    const members = byKey.get(key) ?? [];
    members.push(card);
    byKey.set(key, members);
  }

  const groups: RulesGroup[] = [];
  const bySet = new Map<string, RulesGroup[]>();
  for (const members of byKey.values()) {
    const rep = members[0]!;
    const group: RulesGroup = {
      id: rep.id,
      name: rep.name,
      printings: members.map((card) => card.id),
      sets: [...new Set(members.map((card) => card.set))],
      clauses: clausesFor(rep),
      batch: ""
    };
    groups.push(group);
    const list = bySet.get(rep.set) ?? [];
    list.push(group);
    bySet.set(rep.set, list);
  }

  for (const [set, list] of bySet) {
    let batch = 1;
    let size = 0;
    for (const group of list) {
      if (size > 0 && size + group.clauses.length > BATCH_CLAUSE_TARGET) {
        batch++;
        size = 0;
      }
      group.batch = `${slug(set)}-${String(batch).padStart(2, "0")}`;
      size += group.clauses.length;
    }
    // A small tail batch folds into the one before it.
    if (batch > 1 && size < BATCH_CLAUSE_TARGET / 3) {
      const previous = `${slug(set)}-${String(batch - 1).padStart(2, "0")}`;
      const tail = `${slug(set)}-${String(batch).padStart(2, "0")}`;
      for (const group of list) if (group.batch === tail) group.batch = previous;
    }
  }
  return groups;
}

/** printing id -> its rules group. */
export function groupsByPrinting(groups: RulesGroup[]): Map<string, RulesGroup> {
  const map = new Map<string, RulesGroup>();
  for (const group of groups) for (const id of group.printings) map.set(id, group);
  return map;
}

/**
 * Whether `findingId` is written up in the findings text — as its own
 * `### <id> —` heading, so `seed-3-03-1` isn't satisfied by `seed-3-03-10`.
 */
export function hasFindingHeading(findingsText: string, findingId: string): boolean {
  const escaped = findingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^###\\s+${escaped}(?![\\w-])`, "m").test(findingsText);
}

// --- Static scan of the clause test files -----------------------------------

export interface ClauseReference {
  file: string;
  line: number;
  fn: "clause" | "clauseMismatch" | "clauseUnimplemented" | "exempt";
  printingId: string;
  keys: string[];
  /** clauseMismatch: the finding id. clauseUnimplemented / exempt: the reason. */
  note?: string;
}

const CALL = /\b(clause|clauseMismatch|clauseUnimplemented|exempt)\(\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*,\s*(\[[^\]]*\]|"[^"]*")(?:\s*,\s*"([^"]*)")?/g;
const STRING_CONST = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"/g;

/**
 * Every `clause(...)` / `clauseMismatch(...)` / `clauseUnimplemented(...)` /
 * `exempt(...)` call in a test file's source. The printing id must be a
 * string literal or a `const NAME = "<id>"` declared in the same file; the
 * clause key(s) must be a string literal or an array of them; a mismatch's
 * finding id and an unimplemented / exempt reason must be string literals. That's what makes coverage checkable
 * without running anything.
 */
export function scanClauseReferences(file: string, source: string): ClauseReference[] {
  const constants = new Map<string, string>();
  for (const [, name, value] of source.matchAll(STRING_CONST)) constants.set(name!, value!);
  const refs: ClauseReference[] = [];
  for (const match of source.matchAll(CALL)) {
    const [, fn, literalId, constantName, rawKeys, note] = match;
    const printingId = literalId ?? constants.get(constantName!) ?? `<unresolved constant ${constantName}>`;
    const keys = rawKeys!.startsWith("[")
      ? [...rawKeys!.matchAll(/"([^"]*)"/g)].map((key) => key[1]!)
      : [rawKeys!.slice(1, -1)];
    const line = source.slice(0, match.index).split("\n").length;
    refs.push({ file, line, fn: fn as ClauseReference["fn"], printingId, keys, ...(note !== undefined && { note }) });
  }
  return refs;
}
