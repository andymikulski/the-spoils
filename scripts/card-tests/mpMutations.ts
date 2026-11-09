// Player-word mutations for `npm run card-tests -- mp-mutate` (docs/TESTING.md, "Multiplayer mutation testing").
//
// For every multiplayer clause that has a test in src/engine/__tests__/clauses/mp/ this module lists the mutations of its
// behavior data that change what the card does at three or more seats: a player word swapped for another ("opponent" <->
// "opponents", "opponent" -> "any" / "self"), a `forEachPlayer.players` scope swapped, `{type:"chosenPlayer"}` replaced by
// "opponent", `offerTo` dropped, `opponentFrom` dropped, a `choosePlayer.from` swapped. A mutant is only built from words the
// same field already takes elsewhere in the catalog, so a mutant is always well-formed data (a crash is never "detected").
//
// Self-side words (`self`, `controller`, `owner`, `ownerOf`, `controllerOf`, `activePlayer`, ...) are not mutated: they name
// the acting player, who is the same player at every table size, so a swap there is not a multiplayer behavior.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG, scanClauseReferences } from "../../src/engine/__tests__/clauses/_manifest.js";
import { PLAYER_FIELDS, type MpGroup } from "../../src/engine/__tests__/clauses/_mpInventory.js";

export type PathStep = string | number;

/** One edit: set a value at a path, or delete the key there. */
export type Op = { path: PathStep[]; kind: "set"; value: unknown } | { path: PathStep[]; kind: "delete" };

export interface MpMutation {
  /** `<printing id>|<path>|<operator>`: stable, the key of the equivalence list. */
  id: string;
  /** The set the group's tests are filed under (`open-beta`, `1st-edition-part-2`, ...). */
  set: string;
  operator: string;
  /** Every printing of the rules group (identical data), mutated together. */
  printingIds: string[];
  /** The printing the tests (and the equivalence list) name. */
  printingId: string;
  cardName: string;
  /** The first edit's path. */
  path: PathStep[];
  /** The edits, in order (almost always one). */
  ops: Op[];
  /** The mp test files that name one of the group's printings (tier 1). */
  files: string[];
}

export interface MpEquivalent {
  printingId: string;
  /** The path as printed in `MpMutation.id`. */
  path: string;
  operator: string;
  reason: string;
}

const MP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "engine", "__tests__", "clauses", "mp");

/** Player words a mutant may take. Everything else in a field is left alone. */
const WORDS = new Set(["opponent", "opponents", "self", "any", "controller", "anyPlayer", "all"]);
/** `forEachPlayer.players` values. */
const SCOPES = new Set(["opponents", "all", "others", "pair", "selfAndOpponents"]);

export const pathText = (path: PathStep[]): string =>
  path.reduce<string>((text, step) => (typeof step === "number" ? `${text}[${step}]` : text ? `${text}.${step}` : String(step)), "");

/** The unit of a path: one ability (`behavior.abilities[2]`), one behavior field (`behavior.onPlay`), flipUp, ... */
export function unitOf(path: string): string {
  return path.match(/^(behavior\.abilities\[\d+\]|behavior\.\w+|[^.[]+)/)![1]!;
}

/** Every mp test file with the printings and (printing|key) clauses it tests. */
function mpTests(): Array<{ file: string; printings: Set<string>; clauses: Set<string> }> {
  return readdirSync(MP_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => {
      const refs = scanClauseReferences(name, readFileSync(join(MP_DIR, name), "utf8")).filter((ref) => ref.fn === "clause" || ref.fn === "clauseMismatch");
      return {
        file: join(MP_DIR, name),
        printings: new Set(refs.map((ref) => ref.printingId)),
        clauses: new Set(refs.flatMap((ref) => ref.keys.map((key) => `${ref.printingId}|${key}`)))
      };
    });
}

/** The vocabulary key of a string-valued key on `record`, or undefined when it is not a player field. */
function fieldOf(key: string, record: Record<string, unknown>, parentKey: string): string | undefined {
  if (key === "players" && record.type === "forEachPlayer") return "forEachPlayer.players";
  if (key === "from" && (record.type === "choosePlayer" || parentKey === "playerChoices")) return "choosePlayer.from";
  return PLAYER_FIELDS.has(key) ? key : undefined;
}

/** The vocabulary key of a field on a typed node (`eventPlayerIs.player`). */
const typed = (record: Record<string, unknown>, key: string): string => `${String(record.type)}.${key}`;

/** Field name (and `type.field`) -> the player words it takes anywhere in the catalog. */
function observedVocabulary(): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  const visit = (value: unknown, parentKey = ""): void => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, parentKey));
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string") {
        const field = fieldOf(key, record, parentKey);
        if (field && (WORDS.has(child) || SCOPES.has(child) || child === "players")) {
          for (const name of [field, typed(record, key)]) (seen.get(name) ?? seen.set(name, new Set()).get(name)!).add(child);
        }
      } else visit(child, key);
    }
  };
  for (const card of CATALOG) visit(card as unknown);
  return seen;
}

interface Site {
  operator: string;
  ops: Op[];
}

/** Every mutation of one card's behavior data (all units; the caller keeps the units of tested clauses). */
function sitesOf(card: unknown, vocabulary: Map<string, Set<string>>): Site[] {
  const sites: Site[] = [];
  const observed = (field: string, word: string): boolean => vocabulary.get(field)?.has(word) ?? false;
  const swap = (path: PathStep[], field: string, operator: string, to: string, strict: string | false): void => {
    // A typed node in a condition (`eventPlayerIs`, `ownerIs`, ...) takes only the words its own type takes elsewhere: a
    // PlayerRef there is one player (`"opponents"` / `"any"` would throw, not change the card).
    if (observed(strict || field, to)) sites.push({ operator, ops: [{ path, kind: "set", value: to }] });
  };
  const visit = (value: unknown, path: PathStep[], parentKey: string, inCondition = false): void => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...path, index], parentKey, inCondition));
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const strict = inCondition && record.type !== undefined;
    for (const [key, child] of Object.entries(record)) {
      const at = [...path, key];
      // `forEach` over a `selected` set never reads its own selector: a dead field, so a swap there is a no-op by construction.
      if (key === "selector" && record.type === "forEach" && record.selected !== undefined) continue;
      if (key === "offerTo") {
        sites.push({ operator: "offerTo removed", ops: [{ path: at, kind: "delete" }] });
        sites.push({ operator: "offerTo -> player opponent", ops: [{ path: at, kind: "delete" }, { path: [...path, "player"], kind: "set", value: "opponent" }] });
        continue;
      }
      if (key === "opponentFrom") {
        sites.push({ operator: "opponentFrom removed", ops: [{ path: at, kind: "delete" }] });
        continue;
      }
      if (typeof child === "string") {
        const field = fieldOf(key, record, parentKey);
        if (!field) continue;
        if (field === "forEachPlayer.players") {
          for (const to of SCOPES) if (to !== child) swap(at, field, `players ${child} -> ${to}`, to, strict ? typed(record, key) : false);
        } else if (field === "choosePlayer.from") {
          const to = child === "opponents" ? "players" : "opponents";
          swap(at, field, `from ${child} -> ${to}`, to, strict ? typed(record, key) : false);
        } else if (child === "opponent") {
          swap(at, field, "opponent -> opponents", "opponents", strict ? typed(record, key) : false);
          swap(at, field, "opponent -> any", "any", strict ? typed(record, key) : false);
          swap(at, field, "opponent -> self", observed(field, "self") ? "self" : "controller", strict ? typed(record, key) : false);
        } else if (child === "opponents") {
          swap(at, field, "opponents -> opponent", "opponent", strict ? typed(record, key) : false);
          swap(at, field, "opponents -> any", "any", strict ? typed(record, key) : false);
        } else if (child === "any") {
          swap(at, field, "any -> opponent", "opponent", strict ? typed(record, key) : false);
          swap(at, field, "any -> self", observed(field, "self") ? "self" : "controller", strict ? typed(record, key) : false);
        } else if (child === "anyPlayer" || child === "all") {
          swap(at, field, `${child} -> opponent`, "opponent", strict ? typed(record, key) : false);
        }
      } else if (child && typeof child === "object" && !Array.isArray(child) && (child as { type?: unknown }).type === "chosenPlayer" && PLAYER_FIELDS.has(key)) {
        swap(at, key, "chosenPlayer -> opponent", "opponent", false);
        visit(child, at, key, inCondition);
      } else visit(child, at, key, inCondition || /^(condition|conditions|w+Condition)$/.test(key));
    }
  };
  visit(card, [], "");
  return sites;
}

/** The mutations of every mp clause that has a test (all sets; filter with `.set`). */
export function generateMpMutations(inventory: MpGroup[]): { mutations: MpMutation[]; setFiles: Map<string, string[]> } {
  const byId = new Map(CATALOG.map((card) => [card.id, card]));
  const vocabulary = observedVocabulary();
  const tests = mpTests();
  const out: MpMutation[] = [];
  const setFiles = new Map<string, Set<string>>();
  for (const group of inventory) {
    const units = new Set<string>();
    for (const clause of group.clauses) {
      if (!group.printings.some((id) => tests.some((test) => test.clauses.has(`${id}|${clause.key}`)))) continue;
      for (const word of clause.behavior) units.add(unitOf(word.path));
    }
    if (!units.size) continue;
    const printingIds = group.printings.filter((id) => byId.has(id));
    const named = printingIds.find((id) => tests.some((test) => test.printings.has(id))) ?? printingIds[0]!;
    const files = tests.filter((test) => printingIds.some((id) => test.printings.has(id))).map((test) => test.file);
    const set = group.batch.replace(/-\d+$/, "");
    for (const file of files) (setFiles.get(set) ?? setFiles.set(set, new Set()).get(set)!).add(file);
    const card = byId.get(named)!;
    for (const site of sitesOf(card, vocabulary)) {
      const path = pathText(site.ops[0]!.path);
      if (!units.has(unitOf(path))) continue;
      out.push({ id: `${named}|${path}|${site.operator}`, set, operator: site.operator, printingIds, printingId: named, cardName: card.name, path: site.ops[0]!.path, ops: site.ops, files });
    }
  }
  return { mutations: out, setFiles: new Map([...setFiles].map(([set, files]) => [set, [...files]])) };
}

/** The JavaScript `hooks.mjs` runs against the whole catalog: applies one mutation to every printing of its group. */
export function mutationCode(mutation: MpMutation): string {
  return `const ids = new Set(${JSON.stringify(mutation.printingIds)});
const ops = ${JSON.stringify(mutation.ops)};
for (const c of cards) {
  if (!ids.has(c.id)) continue;
  for (const op of ops) {
    let o = c;
    for (const step of op.path.slice(0, -1)) {
      o = o?.[step];
      if (o === undefined) throw new Error("no path " + op.path.join("."));
    }
    const last = op.path[op.path.length - 1];
    if (op.kind === "delete") { if (!(last in o)) throw new Error("no key " + op.path.join(".")); delete o[last]; }
    else o[last] = op.value;
  }
}`;
}
